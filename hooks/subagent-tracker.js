const fs = require('fs');
const os = require('os');
const path = require('path');
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(d);
    const event = i.hook_event_name;
    if (event !== 'SubagentStart' && event !== 'SubagentStop') { process.stdout.write(d); return; }
    const sid = (i.session_id || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const file = path.join(os.tmpdir(), `claude-agents-${sid}.json`);
    let state = {};
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    let name = i.agent_type;
    // Fallback for system subagents without agent_type — recognize known id prefixes
    if (!name && typeof i.agent_id === 'string') {
      if (i.agent_id.startsWith('acompact-')) name = 'compact';
    }
    // Still unknown (anonymous hex id) → skip, don't pollute display
    if (!name) { process.stdout.write(d); return; }
    if (event === 'SubagentStart') {
      state[name] = { status: 'running', started: Date.now() };
    } else {
      state[name] = { status: 'done', finished: Date.now() };
    }
    fs.writeFileSync(file, JSON.stringify(state));
  } catch (e) {}
  process.stdout.write(d);
});
