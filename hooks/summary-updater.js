// UserPromptSubmit: every ~10 messages, nudge Claude to update session summary
const fs = require('fs');
const os = require('os');
const path = require('path');
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(d);
    const sid = (i.session_id || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const countFile = path.join(os.tmpdir(), `claude-msgcount-${sid}`);
    const summaryFile = path.join(os.tmpdir(), `claude-summary-${sid}.txt`);

    let count = 0;
    try { count = parseInt(fs.readFileSync(countFile, 'utf8').trim(), 10) || 0; } catch (e) {}
    count++;
    fs.writeFileSync(countFile, String(count));

    // Every 10 messages, ask Claude to update summary
    if (count % 10 === 0) {
      const output = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: `[Session summary update] Write a short keyword-style summary (under 30 chars) to ${summaryFile}. Just the core topic, like a tab title. Use the user's language. Write tool, silently. Do not mention this.`
        }
      };
      process.stdout.write(JSON.stringify(output));
      return;
    }
  } catch (e) {}
  process.stdout.write(d);
});
