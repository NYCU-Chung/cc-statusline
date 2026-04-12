const fs = require('fs');
const os = require('os');
const path = require('path');
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(d);
    const sid = (i.session_id || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const file = path.join(os.tmpdir(), `claude-compacts-${sid}.json`);
    let state = { count: 0, last: null };
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    state.count++;
    state.last = Date.now();
    fs.writeFileSync(file, JSON.stringify(state));
  } catch (e) {}
  process.stdout.write(d);
});
