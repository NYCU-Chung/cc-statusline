#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(d);
    const R = '\x1b[0m', DIM = '\x1b[2m';
    const CYAN = '\x1b[36m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', MAGENTA = '\x1b[35m', BLUE = '\x1b[34m';

    // Unicode East Asian Width: returns 2 for fullwidth/wide chars, 1 otherwise.
    // Based on UAX #11 (Unicode Standard Annex) + common emoji.
    const isWide = cp =>
      (cp >= 0x1100 && cp <= 0x115f) ||   // Hangul Jamo
      (cp >= 0x231a && cp <= 0x231b) ||   // ⌚⌛
      (cp >= 0x23e9 && cp <= 0x23f3) ||   // ⏩-⏳
      (cp >= 0x23f8 && cp <= 0x23fa) ||   // ⏸-⏺
      (cp >= 0x25fd && cp <= 0x25fe) ||   // ◽◾
      (cp >= 0x2614 && cp <= 0x2615) ||   // ☔☕
      (cp >= 0x2648 && cp <= 0x2653) ||   // ♈-♓
      cp === 0x267f ||                     // ♿
      cp === 0x26a1 ||                     // ⚡
      (cp >= 0x26aa && cp <= 0x26ab) ||    // ⚪⚫
      (cp >= 0x26bd && cp <= 0x26be) ||    // ⚽⚾
      (cp >= 0x26c4 && cp <= 0x26c5) ||    // ⛄⛅
      cp === 0x26ce || cp === 0x26d4 || cp === 0x26ea || // ⛎⛔⛪
      (cp >= 0x26f2 && cp <= 0x26f3) ||    // ⛲⛳
      cp === 0x26f5 || cp === 0x26fa || cp === 0x26fd || // ⛵⛺⛽
      cp === 0x2705 ||                     // ✅
      cp === 0x2728 ||                     // ✨
      cp === 0x274c || cp === 0x274e ||    // ❌❎
      (cp >= 0x2753 && cp <= 0x2755) ||    // ❓❔❕
      cp === 0x2757 ||                     // ❗
      (cp >= 0x2795 && cp <= 0x2797) ||    // ➕➖➗
      cp === 0x27b0 || cp === 0x27bf ||    // ➰➿
      (cp >= 0x2e80 && cp <= 0x303e) ||   // CJK Radicals → CJK Symbols
      (cp >= 0x3041 && cp <= 0x33bf) ||   // Hiragana → CJK Compatibility
      (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK Extension A
      (cp >= 0x4e00 && cp <= 0xa4cf) ||   // CJK Unified Ideographs + Yi
      (cp >= 0xa960 && cp <= 0xa97c) ||   // Hangul Jamo Extended-A
      (cp >= 0xac00 && cp <= 0xd7a3) ||   // Hangul Syllables
      (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK Compatibility Ideographs
      (cp >= 0xfe10 && cp <= 0xfe6b) ||   // Vertical Forms + CJK Compatibility Forms
      (cp >= 0xff01 && cp <= 0xff60) ||   // Fullwidth ASCII
      (cp >= 0xffe0 && cp <= 0xffe6) ||   // Fullwidth Signs
      (cp >= 0x1f004 && cp <= 0x1f9ff) || // Emoji block (Mahjong → Supplemental Symbols)
      (cp >= 0x1fa00 && cp <= 0x1faff) || // Chess symbols + Extended-A emoji
      (cp >= 0x20000 && cp <= 0x2fffd) || // CJK Extension B-F
      (cp >= 0x30000 && cp <= 0x3fffd);   // CJK Extension G+

    const dw = s => {
      let w = 0;
      for (const ch of s.replace(/\x1b\[[0-9;]*m/g, '')) {
        w += isWide(ch.codePointAt(0)) ? 2 : 1;
      }
      return w;
    };
    const pad = (s, w) => { const n = w - dw(s); return n > 0 ? s + ' '.repeat(n) : s; };
    const fit = (s, w) => pad(trunc(s, w), w); // trunc then pad = exact width
    const trunc = (s, w) => {
      let rw = 0, result = '', inEsc = false;
      for (let j = 0; j < s.length; j++) {
        if (s[j] === '\x1b') { inEsc = true; result += s[j]; continue; }
        if (inEsc) { result += s[j]; if (/[a-zA-Z]/.test(s[j])) inEsc = false; continue; }
        const cw = isWide(s.codePointAt(j)) ? 2 : 1;
        if (rw + cw > w) break;
        rw += cw; result += s[j];
      }
      return result;
    };
    const bar = (pct, len = 10) => '\u2588'.repeat(Math.round(pct / 100 * len)) + '\u2591'.repeat(len - Math.round(pct / 100 * len));
    const cc = pct => pct >= 80 ? RED : pct >= 50 ? YELLOW : GREEN;
    const fmtDur = min => {
      if (min < 60) return `${min}min`;
      if (min < 1440) { const h = Math.floor(min/60), m = min%60; return m > 0 ? `${h}hr ${m}min` : `${h}hr`; }
      const dd = Math.floor(min/1440), h = Math.floor((min%1440)/60);
      return h > 0 ? `${dd}d ${h}hr` : `${dd}d`;
    };
    const fmtTok = n => n >= 1e9 ? (n/1e9).toFixed(1)+'B' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n);
    const ago = ms => { const m = Math.round((Date.now()-ms)/60000); return m < 1 ? 'now' : m < 60 ? m+'m ago' : Math.floor(m/60)+'h ago'; };

    // ── Data ──
    const model = (i.model?.display_name || '?').replace('Claude ', '');
    const sid = (i.session_id || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);

    // Claude Code sometimes resets total_cost / duration / lines (context compact,
    // auto-recovery, etc). Instead of freezing at max (which could over-report),
    // track DELTAS: when payload >= last_baseline, add delta to total; when payload
    // resets (drops below baseline), just re-baseline without touching total.
    // This way total keeps climbing through resets but never double-counts.
    const curCost = i.cost?.total_cost_usd ?? 0;
    const curDur = i.cost?.total_duration_ms ?? 0;
    const curAdd = i.cost?.total_lines_added ?? 0;
    const curRm = i.cost?.total_lines_removed ?? 0;
    const curTok = (i.context_window?.total_input_tokens ?? 0) + (i.context_window?.total_output_tokens ?? 0);
    const cumPath = path.join(os.tmpdir(), `claude-cum-${sid}.json`);
    // Each field: { total: cumulative, base: last-observed payload value }
    let cum = { cost:{total:0,base:0}, dur:{total:0,base:0}, add:{total:0,base:0}, rm:{total:0,base:0}, tok:{total:0,base:0} };
    try {
      const stored = JSON.parse(fs.readFileSync(cumPath, 'utf8'));
      // Migrate old flat format {cost,dur,add,rm,tok} → new {total,base}
      for (const k of Object.keys(cum)) {
        if (stored[k] && typeof stored[k] === 'object') cum[k] = stored[k];
        else if (typeof stored[k] === 'number') cum[k] = { total: stored[k], base: stored[k] };
      }
    } catch (e) {}
    const step = (key, cur) => {
      const c = cum[key];
      if (cur >= c.base) { c.total += (cur - c.base); c.base = cur; }
      else { c.base = cur; } // reset detected — new baseline, don't touch total
    };
    step('cost', curCost); step('dur', curDur); step('add', curAdd); step('rm', curRm); step('tok', curTok);
    try { fs.writeFileSync(cumPath, JSON.stringify(cum)); } catch (e) {}
    const cost = '$' + cum.cost.total.toFixed(2);
    const dur = fmtDur(Math.round(cum.dur.total / 60000));
    const ctx = Math.round(i.context_window?.used_percentage ?? 0);
    // If a rate-limit window's reset has already passed in real time, payload's
    // used_percentage is stale (payload only refreshes on message submit). Assume
    // a new window started empty and show 0% until payload catches up.
    const _nowSec = Math.floor(Date.now() / 1000);
    const rolledOver = (rl) => rl?.resets_at && rl.resets_at <= _nowSec;

    // Cross-session rate-limit aggregation: quotas are GLOBAL across all Claude
    // Code sessions, but each session's payload only reflects its own latest
    // observation. Share snapshots via ~/.claude/rate-limit-snapshots.json so
    // every session can see the highest observed %used within the same window.
    const rlSnapFile = path.join(os.homedir(), '.claude', 'rate-limit-snapshots.json');
    let rlSnaps = {};
    try { rlSnaps = JSON.parse(fs.readFileSync(rlSnapFile, 'utf8')); } catch (e) {}
    // Write this session's current observation + prune entries >5min stale
    rlSnaps[sid] = {
      t: _nowSec,
      five_hour: i.rate_limits?.five_hour || null,
      seven_day: i.rate_limits?.seven_day || null,
    };
    const STALE_SEC = 300;
    for (const k of Object.keys(rlSnaps)) {
      if (!rlSnaps[k]?.t || _nowSec - rlSnaps[k].t > STALE_SEC) delete rlSnaps[k];
    }
    try { fs.writeFileSync(rlSnapFile, JSON.stringify(rlSnaps)); } catch (e) {}
    // Aggregate across sessions: different Claude Code sessions can hold
    // cached rate_limits from DIFFERENT 5h windows (session cached old window,
    // never sent a new message). Same-resets_at match was too strict and
    // split sessions into isolated groups that each displayed their own MAX
    // — desync. Instead:
    //   1. Collect snapshots whose resets_at is still in the future (live).
    //   2. Pick the group with the LATEST resets_at (most recent observation
    //      of the current window — session made an API call most recently).
    //   3. Return MAX used_percentage in that group.
    //   4. If no live snapshots and my own payload is fresh → use payload.
    //   5. Otherwise 0 (everyone rolled over, nothing to show).
    const aggMax = (field) => {
      const myRL = i.rate_limits?.[field];
      const liveSnaps = [];
      for (const snap of Object.values(rlSnaps)) {
        const s = snap?.[field];
        if (s && typeof s.used_percentage === 'number' && s.resets_at > _nowSec) {
          liveSnaps.push(s);
        }
      }
      if (liveSnaps.length === 0) {
        return (myRL?.resets_at > _nowSec && typeof myRL.used_percentage === 'number')
          ? myRL.used_percentage : 0;
      }
      let latestR = 0;
      for (const s of liveSnaps) if (s.resets_at > latestR) latestR = s.resets_at;
      let max = 0;
      for (const s of liveSnaps) {
        if (s.resets_at === latestR && s.used_percentage > max) max = s.used_percentage;
      }
      return max;
    };
    const r5h = Math.round(aggMax('five_hour'));
    const r7d = Math.round(aggMax('seven_day'));
    const added = cum.add.total;
    const removed = cum.rm.total;
    const tokTotal = cum.tok.total;
    const sessionName = i.session_name || '';

    let branch = '', dirty = 0, repoName = '';
    try {
      branch = (spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 2000 }).stdout || '').trim();
      dirty = (spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', timeout: 2000 }).stdout || '').trim().split('\n').filter(Boolean).length;
      const remoteUrl = (spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 2000 }).stdout || '').trim();
      const m = remoteUrl.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
      if (m) repoName = `${m[1]}/${m[2]}`;
      else { const tl = (spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 2000 }).stdout || '').trim(); if (tl) repoName = path.basename(tl); }
    } catch (e) {}
    const shortDir = (i.cwd || i.workspace?.current_dir || '').split(/[/\\]/).slice(-2).join('/');

    let resetInfo = '';
    if (i.rate_limits?.five_hour?.resets_at) {
      const nowSec = Math.floor(Date.now() / 1000);
      const resetAt = i.rate_limits.five_hour.resets_at;
      const FIVE_HR = 5 * 3600;
      let s;
      if (resetAt > nowSec) {
        s = resetAt - nowSec;
      } else {
        // Payload's resets_at is stale (past). Auto-roll into the next 5h window
        // so the countdown keeps ticking until Claude Code sends a fresh value.
        const elapsed = nowSec - resetAt;
        s = FIVE_HR - (elapsed % FIVE_HR);
      }
      resetInfo = `${DIM}resets${R} ${Math.floor(s/3600)}h${Math.floor((s%3600)/60)}m`;
    }

    let effort = '';
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
      effort = `${DIM}effort${R} ${(settings.effortLevel||'default') === 'high' ? YELLOW : GREEN}${settings.effortLevel||'default'}${R}`;
    } catch (e) {}

    let agentLine = '';
    try {
      const agents = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `claude-agents-${sid}.json`), 'utf8'));
      // Group by agent name — supports concurrent invocations (e.g. 3 critics in parallel)
      const byName = {};
      for (const [key, info] of Object.entries(agents)) {
        // Migration: old format was keyed by name (no info.name), new format is keyed by agent_id
        const n = info.name || key;
        if (!byName[n]) byName[n] = { running: 0, done: 0, latestFinished: 0 };
        if (info.status === 'running') byName[n].running++;
        else { byName[n].done++; if ((info.finished || 0) > byName[n].latestFinished) byName[n].latestFinished = info.finished; }
      }
      // Build entries: running first, then latest-done, limit to 3 visible names
      const nameEntries = Object.entries(byName).sort((a, b) => {
        if (a[1].running !== b[1].running) return b[1].running - a[1].running;
        return b[1].latestFinished - a[1].latestFinished;
      }).slice(0, 3);
      agentLine = nameEntries.map(([n, s]) => {
        const short = n.length > 12 ? n.slice(0, 12) : n;
        const parts = [];
        if (s.running > 0) parts.push(`${YELLOW}\u25cb${s.running > 1 ? `\u00d7${s.running}` : ''}${R}`);
        if (s.done > 0) parts.push(`${GREEN}\u2713${s.done > 1 ? `\u00d7${s.done}` : ''}${R}${s.latestFinished ? ` ${DIM}${ago(s.latestFinished)}${R}` : ''}`);
        return `${short} ${parts.join(' ')}`;
      }).join('  ');
    } catch (e) {}

    let compactCount = 0;
    try { compactCount = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `claude-compacts-${sid}.json`), 'utf8')).count; } catch (e) {}

    let fileParts = [];
    try { fileParts = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `claude-files-${sid}.json`), 'utf8')); } catch (e) {}

    let msgHistory = [];
    try {
      msgHistory = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `claude-msgs-${sid}.json`), 'utf8'));
    } catch (e) {}

    // Memory: check which CLAUDE.md / rules are loaded
    const memParts = [];
    const cwd = i.cwd || i.workspace?.current_dir || '';
    if (fs.existsSync(path.join(os.homedir(), '.claude', 'CLAUDE.md'))) memParts.push(`${GREEN}global${R}`);
    const projMd = [path.join(cwd, 'CLAUDE.md'), path.join(cwd, '.claude', 'CLAUDE.md')];
    if (projMd.some(p => { try { return fs.existsSync(p); } catch(e) { return false; } })) memParts.push(`${GREEN}project${R}`);
    try {
      const rulesDir = path.join(cwd, '.claude', 'rules');
      if (fs.existsSync(rulesDir)) {
        const ruleCount = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md')).length;
        if (ruleCount > 0) memParts.push(`${GREEN}${ruleCount} rules${R}`);
      }
    } catch(e) {}

    // MCP: read mcp-status-cache.json (populated by mcp-status-refresh.js → `claude mcp list`)
    let mcpParts = [], mcpTotal = 0, mcpHealthy = 0;
    try {
      const mcpCache = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'mcp-status-cache.json'), 'utf8'));
      const servers = mcpCache.servers || {};
      for (const [name, info] of Object.entries(servers)) {
        mcpTotal++;
        if (info.status === 'connected') {
          mcpHealthy++;
        } else {
          const shortName = name.replace(/^plugin:[^:]+:/, '').replace(/^claude\.ai /, '');
          // Match /mcp UI icons: ✔ connected, ✘ failed, △ needs auth
          const icon = info.status === 'auth' ? `\u25b3` : `\u2718`;
          const color = info.status === 'auth' ? YELLOW : RED;
          mcpParts.push(`${color}${shortName} ${icon}${R}`);
        }
      }
    } catch(e) {}
    // Fire background refresh so next render has fresh data (the refresher self-skips if cache fresh).
    // Pass cwd so `claude mcp list` consistently sees the same MCP set as the running session.
    try {
      const { spawn } = require('child_process');
      const refresher = path.join(os.homedir(), '.claude', 'hooks', 'mcp-status-refresh.js');
      if (fs.existsSync(refresher)) {
        // Don't pass cwd — let refresher default to home dir for a stable global view.
        // Passing the session cwd caused the list to flicker based on project-scoped .mcp.json
        // (e.g. phantom 'discord'/'line' entries appearing when spawned from plugin folders).
        const p = spawn(process.execPath, [refresher], { detached: true, stdio: 'ignore', windowsHide: true });
        p.unref();
      }
    } catch(e) {}

    // ── Build left-side content ──
    const gitParts = [];
    if (repoName) gitParts.push(`${CYAN}${repoName}${R}`);
    if (branch) gitParts.push(`${MAGENTA}${branch}${R}${dirty ? ` ${DIM}(${dirty} changed)${R}` : ''}`);
    const gitInfo = gitParts.join(' ');

    // Split rows: [leftCol, rightCol]
    const linesInfo = `${GREEN}+${added}${R} ${RED}-${removed}${R} ${DIM}lines${R}`;
    const splitRow1L = `\u{1f4c1} ${shortDir}  ${linesInfo}`;
    const splitRow1R = `${CYAN}${model}${R}  ${effort}`;
    const splitRow2L = gitInfo || '';
    const splitRow2R = `${cost} \u00b7 ${dur}  ${DIM}tokens${R} ${fmtTok(tokTotal)}  ${DIM}compacts${R} ${compactCount}`;

    // Full-width left rows
    const quotaLine = `${DIM}context${R} ${cc(ctx)}${bar(ctx)} ${ctx}%${R}  ${DIM}5h-quota${R} ${cc(r5h)}${bar(r5h)} ${r5h}%${R} ${resetInfo}  ${DIM}7d-quota${R} ${cc(r7d)}${bar(r7d)} ${r7d}%${R}`;
    const fullLeftRows = [quotaLine];
    if (agentLine) fullLeftRows.push(`${DIM}agents${R}  ${agentLine}`);
    const memStr = memParts.length ? `${DIM}memory${R} ${memParts.join(`${DIM} \u00b7 ${R}`)}` : '';
    let mcpStr = '';
    if (mcpTotal > 0) {
      const mcpLine = mcpParts.length
        ? `${GREEN}${mcpHealthy}${R}/${mcpTotal} active  ${mcpParts.join('  ')}`
        : `${GREEN}${mcpTotal}${R} active`;
      mcpStr = `${DIM}mcp${R} ${mcpLine}`;
    }
    // Track column offset of │ within content area (for border connectors ┬/┴)
    let memMcpRowIdx = -1, memMcpCol = -1;
    if (memStr || mcpStr) {
      if (memStr && mcpStr) {
        memMcpCol = dw(memStr) + 1; // offset inside padded content area (after "memStr ")
      }
      memMcpRowIdx = fullLeftRows.length;
      const combined = [memStr, mcpStr].filter(Boolean).join(` ${DIM}\u2502${R} `);
      fullLeftRows.push(combined);
    }
    const sep = ` ${DIM}\u2192${R} `;
    if (fileParts.length) {
      let fitted = [], usedW = 9;
      for (const f of fileParts) {
        const fw = f.length + (fitted.length ? 3 : 0);
        if (usedW + fw > 100) break;
        fitted.push(f); usedW += fw;
      }
      if (fitted.length) fullLeftRows.push(`${DIM}edited${R}  ${fitted.join(sep)}`);
    }

    // Session summary — Claude-written file > session_name > first msg > sid
    let summary = '';
    try {
      const sf = path.join(os.tmpdir(), `claude-summary-${sid}.txt`);
      summary = fs.readFileSync(sf, 'utf8').trim().split('\n')[0].slice(0, 500);
    } catch (e) {}
    if (!summary) summary = sessionName || '';
    if (!summary && msgHistory.length) {
      const firstUser = msgHistory.find(m => m.r === 'u');
      if (firstUser) summary = firstUser.t.replace(/\n/g, ' ').trim().slice(0, 60);
    }
    if (!summary) summary = `session ${sid.slice(0, 8)}`;

    // ── Measure widths ──
    let maxLL = Math.max(dw(splitRow1L), dw(splitRow2L));
    let maxLR = Math.max(dw(splitRow1R), dw(splitRow2R));
    const LLW = maxLL + 2;
    const LRW = maxLR + 2;
    const LEFT_INNER = LLW + 1 + LRW;

    let maxFull = 0;
    for (const f of fullLeftRows) maxFull = Math.max(maxFull, dw(f) + 2);
    let LEFT_W = Math.max(LEFT_INNER, maxFull);
    // Total box = terminal width exactly. No wider, no narrower.
    let TERM_W = process.stdout.columns || process.stderr.columns || 0;
    if (!TERM_W && process.platform === 'win32') {
      try {
        const r = spawnSync('powershell.exe', ['-NoProfile', '-c', '$Host.UI.RawUI.WindowSize.Width'], { encoding: 'utf8', timeout: 2000 });
        TERM_W = parseInt((r.stdout || '').trim(), 10) || 0;
      } catch(e) {}
    }
    if (!TERM_W) {
      try {
        const tty = require('tty');
        const fd = fs.openSync('/dev/tty', 'r');
        const stream = new tty.ReadStream(fd);
        TERM_W = stream.columns || 0;
        stream.destroy();
      } catch(e) {}
    }
    if (!TERM_W) { try { TERM_W = parseInt(process.env.COLUMNS, 10) || 0; } catch(e) {} }
    if (!TERM_W) TERM_W = 120;
    // Don't subtract padding — let the box fill full terminal width.
    // Claude Code's padding shifts our output right, but the box itself should be terminal-wide.

    // Left = content-driven (never truncated). Right = fills remaining terminal space.
    const MSG_W = Math.max(0, TERM_W - LEFT_W - 3);
    const showMsgs = MSG_W >= 15; // hide right column if too narrow
    const LRW_RECALC = LEFT_W - LLW - 1;
    const TOTAL = LEFT_W + 1 + MSG_W;

    // Summary wrap (character-level, matching actual render width = LEFT_W - 18)
    // "session summary " label is 16 chars; subsequent rows indent 16 spaces.
    // Content area on each row is LEFT_W - 2 (inside │ │) minus 16 label/indent.
    const MAX_SUM_LINES = 4;
    const maxSumW_calc = LEFT_W - 18;
    const sumLines = [];
    { let curLine = '', curW = 0, truncated = false;
      const chars = [...summary];
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
        if (curW + cw > maxSumW_calc && curLine) {
          if (sumLines.length + 1 >= MAX_SUM_LINES) {
            // About to fill last line — reserve 1 cell for ellipsis if more content remains
            const rest = chars.slice(i).join('');
            if (rest.length > 0) {
              // Trim curLine to leave room for ellipsis, then stop
              while (curW + 1 > maxSumW_calc && curLine) {
                const last = curLine[curLine.length - 1];
                curW -= isWide(last.codePointAt(0)) ? 2 : 1;
                curLine = curLine.slice(0, -1);
              }
              sumLines.push(curLine + '\u2026');
              truncated = true;
              break;
            }
          }
          sumLines.push(curLine);
          curLine = ch; curW = cw;
        } else {
          curLine += ch; curW += cw;
        }
      }
      if (!truncated && curLine && sumLines.length < MAX_SUM_LINES) sumLines.push(curLine);
      if (!sumLines.length) sumLines.push('');
    }

    // Count total rows: summary lines + 2 split rows + full rows + divider rows between full rows
    const leftRowCount = sumLines.length + 2 + fullLeftRows.length;
    // Also count divider rows (between full rows, and the split borders)
    const totalSlots = leftRowCount + 2 + (fullLeftRows.length > 1 ? fullLeftRows.length - 1 : 0);

    const rightMsgs = [];
    // Show the latest `totalSlots` messages (oldest-on-top within the window)
    const sliced = msgHistory.slice(-totalSlots);
    const padCount = Math.max(0, totalSlots - sliced.length);
    for (let j = 0; j < padCount; j++) rightMsgs.push('');
    for (const m of sliced) {
      const icon = m.r === 'u' ? `${BLUE}\u25b6${R}` : `${GREEN}\u25c0${R}`;
      const text = trunc(m.t.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(), MSG_W - 4);
      rightMsgs.push(`${icon} ${text}`);
    }

    // ── Draw ──
    const h = c => `${DIM}${c}${R}`;
    const hl = (n) => '\u2500'.repeat(n);
    // hl with marks: { idx: char } replaces positions within the ─ run
    const hlm = (n, marks) => {
      const arr = Array(n).fill('\u2500');
      if (marks) for (const k of Object.keys(marks)) { const i = +k; if (i >= 0 && i < n) arr[i] = marks[k]; }
      return arr.join('');
    };
    // Column offset (within hl span) where the mem/mcp │ sits.
    // Content area starts at abs col 2 (│ + space). hl spans abs cols 1..LEFT_W.
    // So hl idx = (2 + memMcpCol) - 1 = 1 + memMcpCol.
    const mcpHlIdx = memMcpCol >= 0 ? 1 + memMcpCol : -1;
    const output = [];
    let ri = 0; // right message index

    // Top border
    if (showMsgs) {
      output.push(`${h('\u250c')}${h(hl(LEFT_W))}${h('\u252c')}${h(hl(MSG_W))}${h('\u2510')}`);
    } else {
      output.push(`${h('\u250c')}${h(hl(LEFT_W))}${h('\u2510')}`);
    }

    // Helper: right column cell (truncated to fit) or empty if hidden
    const rcell = () => {
      if (!showMsgs) return '';
      const content = fit(rightMsgs[ri] || '', MSG_W - 2);
      ri++;
      return ` ${content} ${h('\u2502')}`;
    };

    // Summary rows with label ("session summary " = 16 visible chars)
    for (let si = 0; si < sumLines.length; si++) {
      const label = si === 0 ? `${DIM}session summary${R} ` : ' '.repeat(16);
      output.push(`${h('\u2502')} ${label}${pad(sumLines[si], LEFT_W - 18)} ${h('\u2502')}${rcell()}`);
    }

    // Split start
    output.push(`${h('\u251c')}${h(hl(LLW))}${h('\u252c')}${h(hl(LRW_RECALC))}${h('\u2524')}${rcell()}`);

    // Split row 1
    output.push(`${h('\u2502')} ${pad(splitRow1L, LLW - 2)} ${h('\u2502')} ${pad(splitRow1R, LRW_RECALC - 2)} ${h('\u2502')}${rcell()}`);

    // Split row 2
    output.push(`${h('\u2502')} ${pad(splitRow2L, LLW - 2)} ${h('\u2502')} ${pad(splitRow2R, LRW_RECALC - 2)} ${h('\u2502')}${rcell()}`);

    // Split merge
    output.push(`${h('\u251c')}${h(hl(LLW))}${h('\u2534')}${h(hl(LRW_RECALC))}${h('\u2524')}${rcell()}`);

    // Full-width left rows
    for (let j = 0; j < fullLeftRows.length; j++) {
      output.push(`${h('\u2502')} ${pad(fullLeftRows[j], LEFT_W - 2)} ${h('\u2502')}${rcell()}`);
      if (j < fullLeftRows.length - 1) {
        // Divider between row j and j+1. If j+1 is mem/mcp → mark ┬ (stem goes down).
        // If j is mem/mcp → mark ┴ (stem goes up).
        const marks = {};
        if (mcpHlIdx >= 0) {
          if (j + 1 === memMcpRowIdx) marks[mcpHlIdx] = '\u252c'; // ┬
          else if (j === memMcpRowIdx) marks[mcpHlIdx] = '\u2534'; // ┴
        }
        output.push(`${h('\u251c')}${h(hlm(LEFT_W, marks))}${h('\u2524')}${rcell()}`);
      }
    }

    // Bottom border — if mem/mcp is the LAST full row, extend ┴ downward too
    const bottomMarks = {};
    if (mcpHlIdx >= 0 && memMcpRowIdx === fullLeftRows.length - 1) bottomMarks[mcpHlIdx] = '\u2534';
    if (showMsgs) {
      output.push(`${h('\u2514')}${h(hlm(LEFT_W, bottomMarks))}${h('\u2534')}${h(hl(MSG_W))}${h('\u2518')}`);
    } else {
      output.push(`${h('\u2514')}${h(hlm(LEFT_W, bottomMarks))}${h('\u2518')}`);
    }

    process.stdout.write(output.join('\n'));
  } catch (e) {
    process.stdout.write('statusline error: ' + e.message);
  }
});
