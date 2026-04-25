// UserPromptSubmit + Stop hook: maintain "active session time" — the
// total time Claude was actually working on your turns. Per-turn slice:
// from the moment the user submits a prompt until the Stop event fires.
// Inter-turn idle (you reading, thinking, walking away) is automatically
// excluded because it falls outside any turn.
//
// No idle threshold, no transcript scan — just two timestamps in cum.json.
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

    // Stable sid from transcript filename (survives --continue / --resume).
    let _logicalSid = i.session_id;
    try {
      if (i.transcript_path) {
        const m = path.basename(i.transcript_path).match(/^([0-9a-fA-F-]+)\.jsonl$/);
        if (m) _logicalSid = m[1];
      }
    } catch (e) {}
    const sid = (_logicalSid || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const cumPath = path.join(os.tmpdir(), `claude-cum-${sid}.json`);

    let cum = {};
    try { cum = JSON.parse(fs.readFileSync(cumPath, 'utf8')); } catch (e) {}

    // Bootstrap once from transcript: sum (assistant.ts - user.ts) for each
    // user→assistant pair. Same turn-bounded model as the live path, so no
    // threshold needed. Subsequent runs find activeMs already populated and
    // skip this scan.
    if (cum.activeMs === undefined) {
      cum.activeMs = 0;
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
                if (t > lastUserTs) cum.activeMs += t - lastUserTs;
                lastUserTs = null;
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
    }

    const NOW_MS = Date.now();

    if (event === 'UserPromptSubmit') {
      // Turn opens — stamp when the prompt was submitted.
      cum.turnStartAt = NOW_MS;
    } else {
      // Stop — turn closes; add the elapsed slice if a turn was open.
      if (cum.turnStartAt) {
        const dur = NOW_MS - cum.turnStartAt;
        if (dur > 0) cum.activeMs += dur;
        cum.turnStartAt = null;
      }
    }

    atomicWrite(cumPath, JSON.stringify(cum));
  } catch (e) {}
  process.stdout.write(d);
});
