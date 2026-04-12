# cc-statusline

**English · [繁體中文](./README.zh-TW.md)**

A comprehensive statusline dashboard for Claude Code. See everything at a glance — no slash commands needed.

![Demo](./images/demo-en.png)

## What it shows

| Section | Info |
|---------|------|
| **session** | Auto-generated summary of what this session is about (updated by Claude every ~10 messages) |
| **directory** | Current working directory + git branch + uncommitted file count |
| **model** | Active model name, session cost, duration, thinking effort level |
| **code** | Lines added/removed, total tokens consumed, compaction count |
| **quotas** | Context window, 5h quota, 7d quota — each with a color-coded progress bar (green → yellow → red) + 5h reset countdown |
| **agents** | Which subagents ran recently — ✓ done (with time ago) or ○ currently running |
| **memory** | Which CLAUDE.md scopes are loaded (global / project / rules) |
| **mcp** | MCP server health — how many active, which ones are down |
| **edited** | Recently edited files in this session, newest first |
| **history** | Right column showing the last 7 message exchanges (▶ you, ◀ Claude) |

## Install

### One-command (plugin)

```
claude plugin marketplace add NYCU-Chung/cc-statusline
claude plugin install cc-statusline@cc-statusline
```

Hooks are registered automatically. You still need to add the statusLine config manually:

Add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.js",
    "refreshInterval": 30
  }
}
```

Then copy the files:

```bash
git clone https://github.com/NYCU-Chung/cc-statusline ~/cc-statusline

# Main statusline script
cp ~/cc-statusline/statusline.js ~/.claude/statusline.js

# Supporting hooks (optional but recommended — they feed data to the statusline)
cp ~/cc-statusline/hooks/*.js ~/.claude/hooks/
```

### Hook wiring

Add these to your `~/.claude/settings.json` hooks section to enable all statusline features:

```json
{
  "hooks": {
    "SubagentStart": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/subagent-tracker.js" }] }],
    "SubagentStop": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/subagent-tracker.js" }] }],
    "PreCompact": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/compact-monitor.js" }] }],
    "UserPromptSubmit": [{ "hooks": [
      { "type": "command", "command": "node ~/.claude/hooks/message-tracker.js" },
      { "type": "command", "command": "node ~/.claude/hooks/summary-updater.js" }
    ]}],
    "Stop": [{ "matcher": "*", "hooks": [
      { "type": "command", "command": "node ~/.claude/hooks/message-tracker.js" }
    ]}],
    "PostToolUse": [{ "matcher": "Write|Edit", "hooks": [
      { "type": "command", "command": "node ~/.claude/hooks/file-tracker.js" }
    ]}]
  }
}
```

## What each hook does

| Hook | Event | Purpose |
|------|-------|---------|
| `subagent-tracker.js` | SubagentStart / SubagentStop | Tracks which agents are running or finished |
| `compact-monitor.js` | PreCompact | Counts how many times context was compacted |
| `file-tracker.js` | PostToolUse (Write/Edit) | Records recently edited files |
| `message-tracker.js` | UserPromptSubmit / Stop | Caches recent messages for the history column |
| `summary-updater.js` | UserPromptSubmit | Every ~10 messages, asks Claude to write a short session summary |

## Without hooks

The statusline works without the hooks — you just won't see agents, edited files, message history, compact count, or session summary. Quotas, cost, model, git, tokens, memory, and MCP all work from the built-in statusline JSON payload.

## Known limitation

Claude Code currently does not pass terminal width to statusline commands ([issue #22115](https://github.com/anthropics/claude-code/issues/22115)). On Windows, the script uses PowerShell as a fallback to detect width. The right border may not perfectly align with the terminal edge until this is fixed upstream.

## Credits

Part of the [my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam) ecosystem — 12 specialized subagents + 15 automation hooks + P7/P9/P10 methodology for Claude Code.

## License

MIT
