const fs = require('fs');
const os = require('os');
const path = require('path');
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(d);
    const fp = i.tool_input?.file_path;
    if (!fp) { process.stdout.write(d); return; }
    const sid = (i.session_id || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const file = path.join(os.tmpdir(), `claude-files-${sid}.json`);
    let files = [];
    try { files = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    const name = path.basename(fp);
    files = [name, ...files.filter(f => f !== name)].slice(0, 8);
    fs.writeFileSync(file, JSON.stringify(files));
  } catch (e) {}
  process.stdout.write(d);
});
