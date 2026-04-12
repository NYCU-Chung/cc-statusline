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
    const cost = '$' + (i.cost?.total_cost_usd ?? 0).toFixed(2);
    const dur = fmtDur(Math.round((i.cost?.total_duration_ms ?? 0) / 60000));
    const ctx = Math.round(i.context_window?.used_percentage ?? 0);
    const r5h = Math.round(i.rate_limits?.five_hour?.used_percentage ?? 0);
    const r7d = Math.round(i.rate_limits?.seven_day?.used_percentage ?? 0);
    const added = i.cost?.total_lines_added ?? 0;
    const removed = i.cost?.total_lines_removed ?? 0;
    const tokTotal = (i.context_window?.total_input_tokens ?? 0) + (i.context_window?.total_output_tokens ?? 0);
    const sid = (i.session_id || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const sessionName = i.session_name || '';

    let branch = '', dirty = 0;
    try {
      branch = (spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 2000 }).stdout || '').trim();
      dirty = (spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', timeout: 2000 }).stdout || '').trim().split('\n').filter(Boolean).length;
    } catch (e) {}
    const shortDir = (i.cwd || i.workspace?.current_dir || '').split(/[/\\]/).slice(-2).join('/');

    let resetInfo = '';
    if (i.rate_limits?.five_hour?.resets_at) {
      const s = Math.max(0, i.rate_limits.five_hour.resets_at - Math.floor(Date.now() / 1000));
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
      agentLine = Object.entries(agents).map(([n, info]) => {
        const short = n.length > 12 ? n.slice(0, 12) : n;
        return info.status === 'running' ? `${short} ${YELLOW}\u25cb${R}` : `${short} ${GREEN}\u2713${R} ${DIM}${ago(info.finished)}${R}`;
      }).slice(-3).join('  ');
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

    // MCP: read health cache for unhealthy servers
    let mcpParts = [];
    try {
      const mcpCache = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'mcp-health-cache.json'), 'utf8'));
      const servers = mcpCache.servers || {};
      for (const [name, info] of Object.entries(servers)) {
        if (info.status === 'unhealthy') {
          mcpParts.push(`${RED}${name} \u2717${R}`);
        }
      }
    } catch(e) {}
    // Also count active MCP servers from plugin .mcp.json files
    let mcpTotal = 0;
    try {
      const pluginDir = path.join(os.homedir(), '.claude', 'plugins', 'cache');
      if (fs.existsSync(pluginDir)) {
        const walk = (dir) => { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isFile() && e.name === '.mcp.json') { try { const c = JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8')); mcpTotal += Object.keys(c.mcpServers || {}).length; } catch(e2) {} } else if (e.isDirectory() && e.name !== 'node_modules') walk(path.join(dir, e.name)); } } catch(e3) {} };
        walk(pluginDir);
      }
    } catch(e) {}

    // ── Build left-side content ──
    const gitInfo = branch ? `${MAGENTA}${branch}${R}${dirty ? ` ${DIM}(${dirty} changed)${R}` : ''}` : '';

    // Split rows: [leftCol, rightCol]
    const splitRow1L = `\u{1f4c1} ${shortDir}`;
    const splitRow1R = `${CYAN}${model}${R} \u00b7 ${cost} \u00b7 ${dur}  ${effort}`;
    const linesInfo = `${GREEN}+${added}${R} ${RED}-${removed}${R} ${DIM}lines${R}`;
    const splitRow2L = gitInfo ? `${gitInfo}  ${linesInfo}` : linesInfo;
    const splitRow2R = `${DIM}tokens${R} ${fmtTok(tokTotal)}  ${DIM}compacts${R} ${compactCount}`;

    // Full-width left rows
    const quotaLine = `${DIM}context${R} ${cc(ctx)}${bar(ctx)} ${ctx}%${R}  ${DIM}5h-quota${R} ${cc(r5h)}${bar(r5h)} ${r5h}%${R} ${resetInfo}  ${DIM}7d-quota${R} ${cc(r7d)}${bar(r7d)} ${r7d}%${R}`;
    const fullLeftRows = [quotaLine];
    if (agentLine) fullLeftRows.push(`${DIM}agents${R}  ${agentLine}`);
    if (memParts.length) fullLeftRows.push(`${DIM}memory${R}  ${memParts.join(`  `)}`);
    const mcpHealthy = mcpTotal - mcpParts.length;
    if (mcpTotal > 0) {
      const mcpLine = mcpParts.length
        ? `${GREEN}${mcpHealthy}${R}/${mcpTotal} active  ${mcpParts.join('  ')}`
        : `${GREEN}${mcpTotal}${R} active`;
      fullLeftRows.push(`${DIM}mcp${R}     ${mcpLine}`);
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
      summary = fs.readFileSync(sf, 'utf8').trim().split('\n')[0].slice(0, 70);
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

    // Summary wrap (character-level, within LEFT_W - 2)
    const maxSumW_calc = LEFT_W - 2;
    const sumLines = [];
    { let curLine = '', curW = 0;
      for (const ch of summary) {
        const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
        if (curW + cw > maxSumW_calc && curLine) { sumLines.push(curLine); curLine = ch; curW = cw; }
        else { curLine += ch; curW += cw; }
        if (sumLines.length >= 4) break;
      }
      if (curLine && sumLines.length < 4) sumLines.push(curLine);
      if (!sumLines.length) sumLines.push('');
    }

    // Count total rows: summary lines + 2 split rows + full rows + divider rows between full rows
    const leftRowCount = sumLines.length + 2 + fullLeftRows.length;
    // Also count divider rows (between full rows, and the split borders)
    const totalSlots = leftRowCount + 2 + (fullLeftRows.length > 1 ? fullLeftRows.length - 1 : 0);

    const rightMsgs = [];
    for (let j = 0; j < totalSlots; j++) {
      if (j < msgHistory.length) {
        const m = msgHistory[j];
        const icon = m.r === 'u' ? `${BLUE}\u25b6${R}` : `${GREEN}\u25c0${R}`;
        const text = trunc(m.t.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(), MSG_W - 4);
        rightMsgs.push(`${icon} ${text}`);
      } else {
        rightMsgs.push('');
      }
    }

    // ── Draw ──
    const h = c => `${DIM}${c}${R}`;
    const hl = (n) => '\u2500'.repeat(n);
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

    // Summary rows with label
    for (let si = 0; si < sumLines.length; si++) {
      const label = si === 0 ? `${DIM}session${R} ` : '         ';
      output.push(`${h('\u2502')} ${label}${pad(sumLines[si], LEFT_W - 10)} ${h('\u2502')}${rcell()}`);
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
        output.push(`${h('\u251c')}${h(hl(LEFT_W))}${h('\u2524')}${rcell()}`);
      }
    }

    // Bottom border
    if (showMsgs) {
      output.push(`${h('\u2514')}${h(hl(LEFT_W))}${h('\u2534')}${h(hl(MSG_W))}${h('\u2518')}`);
    } else {
      output.push(`${h('\u2514')}${h(hl(LEFT_W))}${h('\u2518')}`);
    }

    process.stdout.write(output.join('\n'));
  } catch (e) {
    process.stdout.write('statusline error: ' + e.message);
  }
});
