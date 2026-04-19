---
description: Configure which rows cc-statusline shows (or turn it off entirely)
argument-hint: [on|off] | [hide|show|only|toggle <row>...] | [reset] | (no args to list)
---

# cc-statusline :: row configuration

Manage cc-statusline. Config lives at `~/.claude/cc-statusline-rows.json`; statusline.js reads it on every render.

A top-level `enabled` flag acts as the master switch — when `enabled: false`, the statusline prints nothing at all. Individual row flags control which sections appear when the statusline IS enabled.

## Valid row keys

| key | what it controls |
|-----|------------------|
| `summary`    | Top session-summary row (auto-written by Claude) |
| `dir`        | 📁 directory + `+added -removed lines` |
| `repo`       | `owner/repo branch (N changed)` row |
| `model`      | Model name + effort level |
| `cost`       | `cost $TOTAL ($SESSION this session) · duration` |
| `usage`      | `tokens ... context ... compact ...` row |
| `quota`      | `5h-quota` + `7d-quota` row with countdowns |
| `agents`     | Subagent activity row |
| `memory_mcp` | Combined `memory │ mcp` row |
| `edited`     | Recently edited files row |
| `history`    | Right-side message history column |

## User input

$ARGUMENTS

## What to do

1. **Read** `~/.claude/cc-statusline-rows.json`. If it doesn't exist, treat `enabled` and every row as `true`.
2. **Parse user input** from above:
   - No args → just list current state (step 4, no write).
   - `off` (no rows listed) → set `enabled: false` (master switch off). Keep row flags intact.
   - `on` (no rows listed) → set `enabled: true`. Keep row flags intact.
   - `reset` → set `enabled: true` and every row key to `true`.
   - `only <rows...>` → every listed row becomes `true`, every other key becomes `false`.
   - `hide <rows...>` → every listed row becomes `false`. Others unchanged.
   - `show <rows...>` → every listed row becomes `true`. Others unchanged.
   - `toggle <rows...>` → flip each listed row's current value.
   - Accept row names comma/space separated, case-insensitive. Reject unknown keys with a message but still proceed with valid ones.
3. **Write** the merged config back to the same file using the Write tool (pretty-printed JSON, keys in the canonical order shown in the table above).
4. **Print** a short table of the resulting state — one line per key like:

```
  summary     ✓ shown
  dir         ✓ shown
  repo        ✗ hidden
  ...
```

Use ✓ and ✗ with colors (green / dim red) if your output renders them. Keep the reply concise — no more than the table plus one short confirmation sentence. Do not open the file, do not paste the JSON, do not run statusline.js.
