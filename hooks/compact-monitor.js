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
    const sid = (i.session_id || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const file = path.join(os.tmpdir(), `claude-compacts-${sid}.json`);
    let state = { count: 0, last: null };
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    state.count++;
    state.last = Date.now();
    atomicWrite(file, JSON.stringify(state));
  } catch (e) {}
  process.stdout.write(d);
});
