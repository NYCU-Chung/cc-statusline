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
    if (event !== 'SubagentStart' && event !== 'SubagentStop') { process.stdout.write(d); return; }
    const sid = (i.session_id || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const file = path.join(os.tmpdir(), `claude-agents-${sid}.json`);

    let name = i.agent_type;
    if (!name && typeof i.agent_id === 'string') {
      if (i.agent_id.startsWith('acompact-')) name = 'compact';
    }
    if (!name) { process.stdout.write(d); return; }

    // Per-instance key: prefer agent_id (stable), fallback to name + timestamp to avoid collision
    const key = (typeof i.agent_id === 'string' && i.agent_id) ? i.agent_id : `${name}-${Date.now()}`;

    // Read-modify-write with late re-read: two subagents finishing at the same
    // time both land here; the re-read immediately before merge ensures we see
    // the other hook's write and only mutate our own key.
    let state = {};
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}

    if (event === 'SubagentStart') {
      state[key] = { name, status: 'running', started: Date.now() };
    } else {
      // Preserve original 'name' and 'started' if the start event was recorded
      const prev = state[key] || {};
      state[key] = { name, status: 'done', started: prev.started, finished: Date.now() };
    }

    // Prune: keep running entries + last 20 finished
    const entries = Object.entries(state);
    const running = entries.filter(([_, v]) => v.status === 'running');
    const done = entries.filter(([_, v]) => v.status === 'done').sort((a, b) => b[1].finished - a[1].finished).slice(0, 20);
    state = Object.fromEntries([...running, ...done]);

    atomicWrite(file, JSON.stringify(state));
  } catch (e) {}
  process.stdout.write(d);
});
