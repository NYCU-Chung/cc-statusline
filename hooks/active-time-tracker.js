// UserPromptSubmit + Stop hook: maintain "active session time" — the
// total wall-clock time Claude was actually working on your turns. Slice
// per turn: from UserPromptSubmit until the matching Stop. Inter-turn
// idle is excluded automatically because it falls outside any open turn.
// No idle threshold required.
//
// State lives in its OWN file `claude-active-<sid>.json`, NOT the shared
// `claude-cum-<sid>.json`. This isolation is intentional: when this hook
// fires before statusline has rendered a brand-new sid, it must not
// accidentally write a partial cum file (which would erase cost / dur /
// tokens accumulated by future statusline writes).
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
    const event = i.hook_event_name;
    if (event !== 'UserPromptSubmit' && event !== 'Stop') {
      process.stdout.write(d); return;
    }

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
    try { fs.mkdirSync(path.join(os.homedir(), '.claude', 'cc-statusline'), { recursive: true }); } catch (e) {}
    const activePath = path.join(os.homedir(), '.claude', 'cc-statusline', `active-${sid}.json`);

    let active = {};
    try { active = JSON.parse(fs.readFileSync(activePath, 'utf8')); } catch (e) {}

    const NOW_MS = Date.now();

    // Bootstrap once: scan transcript JSONL and sum (assistant.ts - user.ts)
    // for each turn pair. Same turn-bounded model as the live path so no
    // threshold is needed.
    if (active.activeMs === undefined) {
      active.activeMs = 0;
      if (i.transcript_path) {
        try {
          const raw = fs.readFileSync(i.transcript_path, 'utf8');
          let lastUserTs = null;
          for (const line of raw.split('\n')) {
            if (!line) continue;
            try {
              const entry = JSON.parse(line);
              const t = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
              if (!t) continue;
              if (entry.type === 'user') {
                lastUserTs = t;
              } else if (entry.type === 'assistant' && lastUserTs) {
                if (t > lastUserTs) active.activeMs += t - lastUserTs;
                lastUserTs = null;
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
    }

    if (event === 'UserPromptSubmit') {
      // Turn opens — stamp when the prompt was submitted.
      active.turnStartAt = NOW_MS;
    } else {
      // Stop — turn closes; add the elapsed slice if a turn was open.
      // Sanity cap: drop slices >24 h. If Claude Code crashed without firing
      // Stop, the next Stop after a resume could otherwise close a turn
      // started days ago and inflate active by the entire wall-clock gap.
      if (active.turnStartAt) {
        const dur = NOW_MS - active.turnStartAt;
        if (dur > 0 && dur < 24 * 60 * 60 * 1000) active.activeMs += dur;
        active.turnStartAt = null;
      }
    }

    atomicWrite(activePath, JSON.stringify(active));
  } catch (e) {}
  process.stdout.write(d);
});
