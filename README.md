# cc-statusline

**English · [繁體中文](./README.zh-TW.md)**

A comprehensive statusline dashboard for Claude Code. See everything at a glance — no slash commands needed.

![Demo](./images/demo-en.png)

## What it shows

| Section | Info |
|---------|------|
| **session summary** | Auto-generated whole-session summary (Claude rewrites it every ~10 messages with built-in compression so it stays under ~120 chars) |
| **directory** | Current working directory + `+added -removed lines` |
| **repo + branch** | `owner/repo` (parsed from `git remote`) + branch + `(N changed)` |
| **cost** | `cost $TOTAL ($SESSION this session) · duration` — all-session lifetime spend (aggregated across every per-session cum file) plus current-session ticker |
| **model** | Active model name + thinking effort level |
| **tokens / context / compact** | Total tokens consumed · context window % · compact count (`compact 1 time` / `compact N times`) |
| **5h-quota** | Color-coded bar (green → yellow → red) + auto-rolling `resets Xh Ym` countdown |
| **7d-quota** | Color-coded bar + auto-rolling `resets Xd Yh` countdown |
| **agents** | Subagents that ran in this session — `critic ✓ 5m ago`, parallel runs collapse to `critic ○×3` (running) or `critic ✓×2 5m ago` (done) |
| **memory** | Which CLAUDE.md scopes are loaded (global / project / rules) |
| **mcp** | MCP server health probed via `claude mcp list` — count of active + each unhealthy server with its state (`✘ failed`, `△ needs auth`) |
| **edited** | Recently edited files in this session, newest first (long names front-truncated with `…`) |
| **history** | Right column showing the last messages (▶ you, ◀ Claude), grows to fill terminal width |

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
| `subagent-tracker.js` | SubagentStart / SubagentStop | Tracks which agents are running or finished, including concurrent invocations |
| `compact-monitor.js` | PreCompact | Counts how many times context was compacted |
| `file-tracker.js` | PostToolUse (Write/Edit) | Records recently edited files |
| `message-tracker.js` | UserPromptSubmit / Stop | Caches recent messages for the history column |
| `summary-updater.js` | UserPromptSubmit | Every ~10 messages, asks Claude to rewrite the whole-session summary with compression rules |
| `mcp-status-refresh.js` | (none — auto-spawned) | Statusline launches this in the background each render to refresh `~/.claude/mcp-status-cache.json` from `claude mcp list`. Self-skips if cache is fresh (<90s). |

## How it survives resets and multi-session

**Delta-based cost / duration / lines / tokens.** Claude Code occasionally resets `cost.total_cost_usd`, `total_duration_ms`, etc. mid-session (context compaction, auto-recovery, etc.). The statusline tracks deltas in `/tmp/claude-cum-<sid>.json` — when the payload value drops, only the baseline is reset; the cumulative total never goes backward. Survives `--continue` and `--resume` because the cum file is keyed by session_id.

**Cross-session quota aggregation.** Quotas are global across all your Claude Code sessions, but each session's payload only reflects its own cached observation. The statusline writes a snapshot to `~/.claude/rate-limit-snapshots.json` on every render and aggregates across sessions: it picks the snapshot with the latest live `resets_at` (most recent API observation) and shows MAX `used_percentage` from that group. All sessions converge on the same displayed %.

**All-session cost.** The `cost $TOTAL ($SESSION this session)` figure aggregates `cost.total` across every `claude-cum-*.json` in tmpdir, so you see lifetime spend and current spend side by side.

**Whole-session summary with compression.** The summary is meant to capture the entire session arc, not the latest topic. The summary-updater prompt enforces a 120-char cap with explicit compression rules (merge related sub-topics, drop the least-significant older item) so new topics displace less-significant old ones rather than the most-recent work being truncated.

## Without hooks

The statusline works without the hooks — you just won't see agents, edited files, message history, compact count, or session summary. Quotas, cost, model, git, tokens, memory, and MCP all work from the built-in statusline JSON payload + the auto-spawned MCP refresher.

## Known limitations

- Claude Code does not pass terminal width to statusline commands ([issue #22115](https://github.com/anthropics/claude-code/issues/22115)). On Windows, the script uses PowerShell as a fallback to detect width. The right border may not perfectly align with the terminal edge until this is fixed upstream.
- MCP server state shown by the statusline comes from `claude mcp list` (a fresh probe at refresh time). Claude Code's `/mcp` UI shows the running session's cached state. The two can disagree if a server's connection has changed since the session started — the statusline reflects the latest probe, the UI reflects the session's view.
- `claude mcp list` does not expose all built-in bridges (e.g. `claude-in-chrome`), so the statusline's MCP count can be lower than what `/mcp` shows.
- Claude Code does not currently expose live MCP state in the statusline JSON payload ([issue #5511](https://github.com/anthropics/claude-code/issues/5511)) — once it does, the auto-spawned refresher won't be needed.

## License

MIT
