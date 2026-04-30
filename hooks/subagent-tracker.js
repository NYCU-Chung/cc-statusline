const fs = require('fs');
const os = require('os');
const path = require('path');
const atomicWrite = (f, data) => {
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); }
  catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} }
};
// CAS merge: retry until our change is visible in a fresh re-read. Guards
// against two concurrent SubagentStop hooks overwriting each other's entry.
const casMerge = (file, mutate, verify, maxRetries = 10) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    mutate(cur);
    atomicWrite(file, JSON.stringify(cur));
    let after = {};
    try { after = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    if (verify(after)) return;
  }
};
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(d);
    const event = i.hook_event_name;
    if (event !== 'SubagentStart' && event !== 'SubagentStop') { process.stdout.write(d); return; }
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
    const file = path.join(os.tmpdir(), `claude-agents-${sid}.json`);

    let name = i.agent_type;
    if (!name && typeof i.agent_id === 'string') {
      if (i.agent_id.startsWith('acompact-')) name = 'compact';
    }
    if (!name) { process.stdout.write(d); return; }

    // Per-instance key: prefer agent_id (stable), fallback to name + timestamp to avoid collision
    const key = (typeof i.agent_id === 'string' && i.agent_id) ? i.agent_id : `${name}-${Date.now()}`;
    const myStamp = Date.now();

    casMerge(file,
      (state) => {
        if (event === 'SubagentStart') {
          state[key] = { name, status: 'running', started: myStamp };
        } else {
          const prev = state[key] || {};
          state[key] = { name, status: 'done', started: prev.started, finished: myStamp };
        }
        // Prune: keep running entries + last 20 finished
        const entries = Object.entries(state);
        const running = entries.filter(([_, v]) => v.status === 'running');
        const done = entries.filter(([_, v]) => v.status === 'done').sort((a, b) => b[1].finished - a[1].finished).slice(0, 20);
        for (const k of Object.keys(state)) delete state[k];
        for (const [k, v] of [...running, ...done]) state[k] = v;
      },
      (after) => {
        const e = after[key];
        if (!e) return false;
        return event === 'SubagentStart' ? e.started === myStamp : e.finished === myStamp;
      }
    );
  } catch (e) {}
  process.stdout.write(d);
});
