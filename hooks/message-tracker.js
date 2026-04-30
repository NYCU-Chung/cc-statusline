// UserPromptSubmit + Stop: cache recent messages for statusline
const fs = require('fs');
const os = require('os');
const path = require('path');
const atomicWrite = (f, data) => {
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); }
  catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} }
};
// CAS merge: Stop fires multiple times per turn and two hooks can race.
// Retry until our appended entry is visible at the tail of a fresh read.
const casMerge = (file, mutate, verify, maxRetries = 10) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let cur = [];
    try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    const next = mutate(cur);
    if (next === null) return false; // dedup rejected — no write needed
    atomicWrite(file, JSON.stringify(next));
    let after = [];
    try { after = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    if (verify(after)) return true;
  }
  return false;
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
    const file = path.join(os.tmpdir(), `claude-msgs-${sid}.json`);

    // Dedup: Stop can fire multiple times per assistant turn, and duplicate user prompts
    // can happen if the same text is submitted twice. CAS wraps read-check-write
    // so two concurrent hook processes can't both pass the dedup gate and then
    // overwrite each other's append.
    const pushUnique = (r, t) => casMerge(file,
      (msgs) => {
        const last = msgs[msgs.length - 1];
        if (last && last.r === r && last.t === t) return null; // dedup reject
        msgs.push({ r, t });
        return msgs.slice(-30);
      },
      (after) => {
        const last = after[after.length - 1];
        return last && last.r === r && last.t === t;
      }
    );

    if (i.hook_event_name === 'UserPromptSubmit' && i.prompt) {
      const text = i.prompt.replace(/\n/g, ' ').trim();
      if (text.length > 2) pushUnique('u', text);
    } else if (i.hook_event_name === 'Stop') {
      // Read last assistant message from transcript tail
      const tp = i.transcript_path;
      if (tp && fs.existsSync(tp)) {
        const stat = fs.statSync(tp);
        // Assistant entries can be very long (tool_results + long markdown).
        // Read a generous tail so we definitely capture the full last assistant line.
        const readSize = Math.min(stat.size, 500000);
        const buf = Buffer.alloc(readSize);
        const fd = fs.openSync(tp, 'r');
        fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
        fs.closeSync(fd);
        const lines = buf.toString('utf8').split('\n');
        // Walk backwards through assistant entries until we find one with real text content.
        // Multi-step responses split into alternating text/tool_use entries — the very last
        // line is often a pure tool_use with no text.
        for (let j = lines.length - 1; j >= 0; j--) {
          try {
            const entry = JSON.parse(lines[j]);
            if (entry.type !== 'assistant') continue;
            const c = entry.message?.content;
            let text = '';
            if (Array.isArray(c)) text = c.filter(b => b.type === 'text').map(b => b.text).join(' ');
            else if (typeof c === 'string') text = c;
            text = text.replace(/\n/g, ' ').trim();
            if (text.length > 5) {
              pushUnique('a', text);
              break;
            }
            // else keep looking — this assistant entry had only tool_use blocks
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  process.stdout.write(d);
});
