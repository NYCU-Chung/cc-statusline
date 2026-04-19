// UserPromptSubmit + Stop: cache recent messages for statusline
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
    const file = path.join(os.tmpdir(), `claude-msgs-${sid}.json`);

    // Dedup: Stop can fire multiple times per assistant turn, and duplicate user prompts
    // can happen if the same text is submitted twice. Re-read fresh state inside
    // pushUnique so two concurrent hook processes don't both pass the dedup check
    // and then overwrite each other's append.
    const pushUnique = (r, t) => {
      let msgs = [];
      try { msgs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
      const last = msgs[msgs.length - 1];
      if (last && last.r === r && last.t === t) return false;
      msgs.push({ r, t });
      msgs = msgs.slice(-30);
      atomicWrite(file, JSON.stringify(msgs));
      return true;
    };

    if (i.hook_event_name === 'UserPromptSubmit' && i.prompt) {
      const text = i.prompt.replace(/\n/g, ' ').trim();
      if (text.length > 2) pushUnique('u', text);
    } else if (i.hook_event_name === 'Stop') {
      // Read last assistant message from transcript tail
      const tp = i.transcript_path;
      if (tp && fs.existsSync(tp)) {
        const stat = fs.statSync(tp);
        // Assistant entries can be very long (tool_results + long markdown).
        // Read a generous tail so we definitely capture the full last assistant line.
        const readSize = Math.min(stat.size, 500000);
        const buf = Buffer.alloc(readSize);
        const fd = fs.openSync(tp, 'r');
        fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
        fs.closeSync(fd);
        const lines = buf.toString('utf8').split('\n');
        // Walk backwards through assistant entries until we find one with real text content.
        // Multi-step responses split into alternating text/tool_use entries — the very last
        // line is often a pure tool_use with no text.
        for (let j = lines.length - 1; j >= 0; j--) {
          try {
            const entry = JSON.parse(lines[j]);
            if (entry.type !== 'assistant') continue;
            const c = entry.message?.content;
            let text = '';
            if (Array.isArray(c)) text = c.filter(b => b.type === 'text').map(b => b.text).join(' ');
            else if (typeof c === 'string') text = c;
            text = text.replace(/\n/g, ' ').trim();
            if (text.length > 5) {
              pushUnique('a', text);
              break;
            }
            // else keep looking — this assistant entry had only tool_use blocks
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  process.stdout.write(d);
});
