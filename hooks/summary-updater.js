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
          additionalContext: `[Session summary update] Update the WHOLE-SESSION summary in ${summaryFile} using the Write tool.

Not the most recent topic — a compact summary covering the entire session from its start to now. Include all major themes/tasks accomplished, in rough order. If the session started on topic A, moved to B, then C, the summary should list A/B/C — earlier items are NOT less important.

First Read ${summaryFile} (may not exist, that's fine) to see the prior summary. Then Write a new version that PRESERVES everything already captured and APPENDS any new topics that have emerged since. Never drop old topics just because recent activity is on a different subject.

Format: one line, comma-separated phrases. Target 60–120 chars. User's language. Silent — do not mention this in chat.`
        }
      };
      process.stdout.write(JSON.stringify(output));
      return;
    }
  } catch (e) {}
  process.stdout.write(d);
});
