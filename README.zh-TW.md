# cc-statusline

**[English](./README.md) · 繁體中文**

Claude Code 的完整 statusline 儀表板。所有資訊一目瞭然 — 不再需要斜線指令。

![Demo](./images/demo-zh-TW.png)

## 顯示的資訊

| 區塊 | 內容 |
|------|------|
| **session summary** | 整個 session 的自動摘要（Claude 每 ~10 則訊息重寫一次，內建壓縮規則控制在 ~120 字內）|
| **directory** | 當前工作目錄 + `+新增 -刪除 lines` |
| **repo + branch** | `owner/repo`（從 `git remote` 解析）+ branch + `(N changed)` |
| **cost** | `cost $全部 ($本 session this session) · 持續時間` — 跨 session 累積總開銷 + 當前 session ticker |
| **model** | 當前模型名稱 + effort 等級（5 色階：`low` 灰 / `medium` 綠 / `high` 黃 / `xhigh` 橘 / `max` 紅）|
| **tokens / context / compact** | `tokens 全部 (本 session this session)`（跟 cost 一樣雙顯）· context window 用量 · 壓縮次數（`compact 1 time` / `compact N times`）|
| **5h-quota** | 顏色進度條（綠 → 黃 → 紅）+ 自動 rolling `resets Xh Ym` 倒數；`resets_at` 過期自動歸零，不會卡在舊值 |
| **7d-quota** | 顏色進度條 + 自動 rolling `resets Xd Yh` 倒數（同 rollover 行為）|
| **agents** | 本 session 跑過的 subagent — `critic ✓ 5m ago`，並行多個會合併成 `critic ○×3`（執行中）或 `critic ✓×2 5m ago`（完成）|
| **memory** | 目前載入的 CLAUDE.md 範圍（global / project / rules）|
| **mcp** | MCP server 健康狀態（透過 `claude mcp list` probe）— active 數 + 不健康 server 的狀態（`✘ failed`、`△ needs auth`）|
| **edited** | 本 session 最近編輯的檔案，新到舊（過長檔名前綴用 `…` 截斷）|
| **history** | 右欄訊息歷史（▶ 你、◀ Claude），會自動填滿剩餘終端機寬度 |

## 安裝

### 一鍵安裝（plugin）

```
claude plugin marketplace add NYCU-Chung/cc-statusline
claude plugin install cc-statusline@cc-statusline
```

Hooks 會自動註冊。你只需要手動加入 statusLine 設定：

在 `~/.claude/settings.json` 加入：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.js",
    "refreshInterval": 30
  }
}
```

然後複製檔案：

```bash
git clone https://github.com/NYCU-Chung/cc-statusline ~/cc-statusline

# 主腳本
cp ~/cc-statusline/statusline.js ~/.claude/statusline.js

# 輔助 hooks（可選但建議安裝 — 它們把資料餵給 statusline）
cp ~/cc-statusline/hooks/*.js ~/.claude/hooks/
```

### Hook 接線

在 `~/.claude/settings.json` 的 hooks 區段加入以下設定，啟用完整 statusline 功能：

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

## 每個 hook 的功能

| Hook | 事件 | 用途 |
|------|------|------|
| `subagent-tracker.js` | SubagentStart / SubagentStop | 追蹤哪些 agent 在跑或已完成，支援並行多個 invocation |
| `compact-monitor.js` | PreCompact | 計數 context 壓縮次數 |
| `file-tracker.js` | PostToolUse (Write/Edit) | 記錄最近編輯的檔案 |
| `message-tracker.js` | UserPromptSubmit / Stop | 快取最近的對話供歷史欄顯示 |
| `summary-updater.js` | UserPromptSubmit | 每 ~10 則訊息請 Claude 用壓縮規則重寫 whole-session 摘要 |
| `mcp-status-refresh.js` | （沒有事件 — 自動觸發）| Statusline 在每次 render 時於背景 spawn，從 `claude mcp list` 更新 `~/.claude/mcp-status-cache.json`。cache 新於 90 秒就自動跳過 |

## 它如何撐過 reset 與多 session

**Delta-based 累積 cost / duration / lines / tokens。** Claude Code 偶爾會在 session 中途 reset `cost.total_cost_usd`、`total_duration_ms` 等（context compact、auto-recovery 等）。Statusline 在 `/tmp/claude-cum-<sid>.json` 追蹤增量 — payload 值掉下時只重設 baseline，累積總值絕不倒退。`--continue`、`--resume` 都能延續，因為 cum 檔以 session_id 為 key。

**跨 session quota 聚合。** Quota 是跨所有 Claude Code session 共享的，但每個 session 的 payload 只反映自己當下的快照。Statusline 在每次 render 把 snapshot 寫入 `~/.claude/rate-limit-snapshots.json`，並做跨 session 聚合 — 取出 `resets_at` 最晚（= 最近 API 觀察）的 snapshot 那組，取 MAX `used_percentage`。所有 session 都會收斂到同一個顯示值。

**全 session 累積 cost + tokens。** `cost $TOTAL ($SESSION this session)` 和 `tokens TOTAL (SESSION this session)` 兩個欄位都把 tmpdir 裡所有 `claude-cum-*.json` 加總，能同時看見**終身**花費/用量 + **本 session** 當下值。

**時間型 rate-limit 自動 rollover。** Claude Code 的 `rate_limits.*.resets_at` 凍結在最後一次 API 回應的那刻 — 如果你閒置過了 reset 邊界，payload 還是會說「已用 87%」，但實際上窗口早就 reset 了。Statusline 會比對 `resets_at` 跟實際時間，過期就自動歸零 bar 並接續倒數到下個 5h/7d 邊界。

**自動 session 命名 for `/resume` picker。** Claude Code 的 transcript JSONL 支援 `{"type":"custom-title","customTitle":"..."}` entry，`/resume` picker 會讀它顯示名字。`summary-updater.js` 每次寫 summary 時會把前 40 字當成 `custom-title` 注入 transcript — `/resume` 裡每個 session 都有有意義的名字，不再是一排 UUID。

**全 session 摘要 + 壓縮機制。** 摘要是要捕捉整個 session 的軌跡，不是最近話題。Summary-updater 的 prompt 強制 120 字上限並有明確壓縮規則（合併相關子話題、丟棄最不重要的舊項），讓新話題擠掉小事而不是讓最新工作被截斷。

## 自訂要顯示哪些行

不想看某些資訊？用 `/cc-statusline:rows` 斜線指令控制（plugin 裝起來自動註冊；設定存到 `~/.claude/cc-statusline-rows.json`）：

```
/cc-statusline:rows                      — 列出當前狀態
/cc-statusline:rows off                  — 總開關：整個 statusline 不顯示
/cc-statusline:rows on                   — 總開關：重新啟用
/cc-statusline:rows hide agents edited   — 關掉指定 row
/cc-statusline:rows show agents          — 開啟指定 row
/cc-statusline:rows only cost quota      — 只開這些、其他全關
/cc-statusline:rows toggle history       — 翻轉狀態
/cc-statusline:rows reset                — 全開
/cc-statusline:rows compact              — 切換 compact 模式（隱藏 summary、quota、agents、memory_mcp、usage）
/cc-statusline:rows compact on           — 啟用 compact 模式
/cc-statusline:rows autocompact on       — 當終端機高度 < 40 行時自動啟用 compact 模式
```

11 個 row key：`summary`、`dir`、`repo`、`model`、`cost`、`usage`、`quota`、`agents`、`memory_mcp`、`edited`、`history`。

空格子會自動合併 — 關掉一整欄會把 split 兩列合成全寬；整個 split 區塊全關，頂部邊框會融入下一個區塊（不會留多餘的水平線）。

### 直立式螢幕的 Compact 模式

如果你使用直立式螢幕（portrait monitor）或終端機高度有限，可以啟用 **compact 模式**來節省垂直空間：

- **手動 compact 模式**: `/cc-statusline:rows compact on` — 隱藏較不重要的 row（summary、quota、agents、memory_mcp、usage），只保留 dir、repo、model、cost、edited、history
- **自動 compact 模式**: `/cc-statusline:rows autocompact on` — 當終端機高度 < 40 行時自動啟用 compact 模式（非常適合直立式螢幕或小視窗）

Compact 模式可以將 statusline 從 ~12-15 行壓縮到 ~6-8 行，非常適合直立式螢幕或終端機視窗高度受限的情況。

## 不裝 hooks

Statusline 不裝 hooks 也能用 — 只是看不到 agents、編輯檔案、訊息歷史、壓縮次數和 session 摘要。配額、成本、模型、git、tokens、memory、MCP 都能從內建的 statusline JSON payload + 自動 spawn 的 MCP refresher 取得。

## 已知限制

- Claude Code 目前不會把終端機寬度傳給 statusline 指令（[issue #22115](https://github.com/anthropics/claude-code/issues/22115)）。在 Windows 上腳本用 PowerShell 作為 fallback 偵測寬度。在上游修復之前，右邊框線可能無法完美貼齊終端機邊緣。
- Statusline 顯示的 MCP server 狀態來自 `claude mcp list`（每次 refresh 重新 probe）。Claude Code 的 `/mcp` UI 顯示的是當前 session 啟動時的快取狀態。如果 server 連線在 session 啟動後改變，兩邊會不一致 — statusline 反映最新 probe，UI 反映 session 視角。
- `claude mcp list` 不會列出所有 built-in bridge（例如 `claude-in-chrome`），所以 statusline 的 MCP count 可能比 `/mcp` 少。
- Claude Code 目前還沒在 statusline JSON payload 暴露即時 MCP 狀態（[issue #5511](https://github.com/anthropics/claude-code/issues/5511)）— 一旦支援，自動 spawn 的 refresher 就不再需要。

## License

MIT
