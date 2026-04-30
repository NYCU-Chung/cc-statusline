// UserPromptSubmit: every N user messages, nudge Claude to update session
// summary. N defaults to 10 and can be overridden via `summaryInterval` in
// ~/.claude/cc-statusline-rows.json.
// Also on every trigger, sync the latest summary into the transcript as a
// `custom-title` entry so /resume picker shows a meaningful name instead of
// "first user message" fallback.
const fs = require('fs');
const os = require('os');
const path = require('path');
const atomicWrite = (f, data) => {
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); }
  catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} }
};
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(d);
    // Sid keyed by transcript filename UUID — invariant for the logical session.
    // Falls back to i.session_id when no transcript path is available.
    let _logicalSid = i.session_id;
    try {
      if (i.transcript_path) {
        const m = path.basename(i.transcript_path).match(/^([0-9a-fA-F-]+)\.jsonl$/);
        if (m) _logicalSid = m[1];
      }
    } catch (e) {}
    const sid = (_logicalSid || 'default').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 24);
    const countFile = path.join(os.tmpdir(), `claude-msgcount-${sid}`);
    const summaryFile = path.join(os.tmpdir(), `claude-summary-${sid}.txt`);

    // Sync current summary → transcript custom-title (takes effect in /resume picker).
    // Skip if no transcript path or no summary yet. Only rewrite when it would change,
    // so we don't bloat the transcript with duplicate entries.
    try {
      if (i.transcript_path && fs.existsSync(i.transcript_path) && fs.existsSync(summaryFile)) {
        const sumRaw = fs.readFileSync(summaryFile, 'utf8').trim().split('\n')[0];
        const title = sumRaw.length > 40 ? sumRaw.slice(0, 39) + '\u2026' : sumRaw;
        if (title && _logicalSid) {
          // Read only the tail (256 KB) of the transcript instead of the
          // whole file \u2014 a long session can have a 100 MB+ transcript and
          // re-reading it on every UserPromptSubmit was the dominant per-
          // turn cost. Custom-title entries always land in the tail.
          const stat = fs.statSync(i.transcript_path);
          const tailSize = Math.min(stat.size, 256 * 1024);
          const buf = Buffer.alloc(tailSize);
          const fd = fs.openSync(i.transcript_path, 'r');
          fs.readSync(fd, buf, 0, tailSize, stat.size - tailSize);
          fs.closeSync(fd);
          const raw = buf.toString('utf8');
          let lastTitle = null;
          const idx = raw.lastIndexOf('"type":"custom-title"');
          if (idx >= 0) {
            const lineStart = raw.lastIndexOf('\n', idx) + 1;
            const lineEnd = raw.indexOf('\n', idx);
            const line = lineEnd > 0 ? raw.slice(lineStart, lineEnd) : raw.slice(lineStart);
            try { lastTitle = JSON.parse(line).customTitle; } catch (e) {}
          }
          if (lastTitle !== title) {
            // Use the logical sid (transcript-derived) so the /resume picker
            // matches the same key statusline and other hooks use.
            const entry = JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: _logicalSid });
            fs.appendFileSync(i.transcript_path, entry + '\n');
          }
        }
      }
    } catch (e) {}

    let count = 0;
    try { count = parseInt(fs.readFileSync(countFile, 'utf8').trim(), 10) || 0; } catch (e) {}
    count++;
    atomicWrite(countFile, String(count));

    // User-configurable update interval. Clamp to >=1 so we never hit a
    // divide-by-zero in the modulo check, and Math.floor coerces fractional
    // values (e.g. 3.7 → 3) rather than silently rejecting them.
    let interval = 10;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'cc-statusline-rows.json'), 'utf8'));
      if (typeof cfg.summaryInterval === 'number' && cfg.summaryInterval >= 1) {
        interval = Math.floor(cfg.summaryInterval);
      }
    } catch (e) {}

    if (count % interval === 0) {
      const output = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: `[Session summary update] Update the WHOLE-SESSION summary in ${summaryFile} using the Write tool.

A session-spanning summary, not just the most recent topic. Capture the session's overall trajectory from start to now.

Steps:
1. Read ${summaryFile} (may not exist).
2. Mentally add the new topic(s) from recent activity.
3. Rewrite so the result stays within HARD LIMIT 120 characters, single line, comma-separated phrases.

Compression rules when adding would exceed 120 chars (MANDATORY — this is not optional):
- Merge related sub-topics into a broader theme (e.g. "A 修正, A 優化, A 測試" → "A 全面整理")
- Drop the least-significant older item (small tweaks, minor fixes) to make room for the new one
- Keep at least ONE earlier theme to preserve trajectory — do NOT collapse into just-the-latest
- The most recent meaningful topic MUST appear

Format: one line, comma-separated phrases, ≤120 chars. User's language. Write tool, silent — do not mention this in chat.`
        }
      };
      process.stdout.write(JSON.stringify(output));
      return;
    }
  } catch (e) {}
  process.stdout.write(d);
});
