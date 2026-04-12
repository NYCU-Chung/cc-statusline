// UserPromptSubmit + Stop: cache recent messages for statusline
const fs = require('fs');
const os = require('os');
const path = require('path');
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(d);
    const sid = (i.session_id || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const file = path.join(os.tmpdir(), `claude-msgs-${sid}.json`);
    let msgs = [];
    try { msgs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}

    if (i.hook_event_name === 'UserPromptSubmit' && i.prompt) {
      const text = i.prompt.replace(/\n/g, ' ').trim();
      if (text.length > 2) {
        msgs.push({ r: 'u', t: text });
        msgs = msgs.slice(-14); // keep last 14 (7 pairs)
        fs.writeFileSync(file, JSON.stringify(msgs));
      }
    } else if (i.hook_event_name === 'Stop') {
      // Read last assistant message from transcript tail
      const tp = i.transcript_path;
      if (tp && fs.existsSync(tp)) {
        const stat = fs.statSync(tp);
        const readSize = Math.min(stat.size, 20000);
        const buf = Buffer.alloc(readSize);
        const fd = fs.openSync(tp, 'r');
        fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
        fs.closeSync(fd);
        const lines = buf.toString('utf8').split('\n');
        for (let j = lines.length - 1; j >= 0; j--) {
          try {
            const entry = JSON.parse(lines[j]);
            if (entry.type === 'assistant') {
              const c = entry.message?.content;
              let text = '';
              if (Array.isArray(c)) text = c.filter(b => b.type === 'text').map(b => b.text).join(' ');
              else if (typeof c === 'string') text = c;
              text = text.replace(/\n/g, ' ').trim();
              if (text.length > 5) {
                msgs.push({ r: 'a', t: text });
                msgs = msgs.slice(-14);
                fs.writeFileSync(file, JSON.stringify(msgs));
              }
              break;
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  process.stdout.write(d);
});
