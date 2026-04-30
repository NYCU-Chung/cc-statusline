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
    const fp = i.tool_input?.file_path;
    if (!fp) { process.stdout.write(d); return; }
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
    const file = path.join(os.homedir(), '.claude', 'cc-statusline', `files-${sid}.json`);
    let files = [];
    try { files = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    const name = path.basename(fp);
    files = [name, ...files.filter(f => f !== name)].slice(0, 8);
    atomicWrite(file, JSON.stringify(files));
  } catch (e) {}
  process.stdout.write(d);
});
