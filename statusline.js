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

    // Row visibility config (see /cc-statusline:rows). Missing file = everything on.
    const rowDefaults = { summary:1, dir:1, repo:1, model:1, duration:1, cost:1, usage:1, quota:1, agents:1, memory_mcp:1, edited:1, history:1 };
    let rowCfg = { ...rowDefaults };
    let cfgEnabled = true;
    try {
      const stored = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'cc-statusline-rows.json'), 'utf8'));
      for (const k of Object.keys(rowDefaults)) if (k in stored) rowCfg[k] = !!stored[k];
      if (stored.enabled === false) cfgEnabled = false;
    } catch (e) {}
    // Master switch off — print nothing (Claude Code shows blank status area)
    if (!cfgEnabled) { process.stdout.write(''); return; }
    const showRow = k => !!rowCfg[k];

    const R = '\x1b[0m', DIM = '\x1b[2m';
    const CYAN = '\x1b[36m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', MAGENTA = '\x1b[35m', BLUE = '\x1b[34m';

    // Atomic write: write to a per-pid temp file then rename. On both POSIX
    // (rename(2)) and Windows (MoveFileEx with REPLACE_EXISTING) this is a
    // single atomic filesystem op, so concurrent readers never see a half-
    // written file and the target is either the old content or the new.
    const atomicWrite = (f, data) => {
      const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
      try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); }
      catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} }
    };

    // CAS-style merge: read → mutate → atomic write → re-read → verify. If
    // another writer raced past us between our write and the verify read,
    // our change is gone and we retry with fresh state. Bounded to 5 tries
    // to stay cheap under pathological contention; each round is ≈ 1ms.
    // Returns the final state observed after verification.
    const casMerge = (file, mutate, verify, maxRetries = 10) => {
      let finalState = {};
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let cur = {};
        try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
        mutate(cur);
        atomicWrite(file, JSON.stringify(cur));
        let after = {};
        try { after = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
        finalState = after;
        if (verify(after)) return finalState;
      }
      return finalState;
    };

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
    // Wrap a styled string into an array of pieces, each ≤ `w` display columns,
    // preserving ANSI escape sequences (they take no width). Does not try to
    // honour word boundaries — wraps at exact column count. Used by the
    // fit-to-width pass when LEFT_W would otherwise exceed the terminal.
    const wrap = (s, w) => {
      if (dw(s) <= w) return [s];
      const out = [];
      let rw = 0, cur = '', inEsc = false;
      for (let j = 0; j < s.length; j++) {
        if (s[j] === '\x1b') { inEsc = true; cur += s[j]; continue; }
        if (inEsc) { cur += s[j]; if (/[a-zA-Z]/.test(s[j])) inEsc = false; continue; }
        const cw = isWide(s.codePointAt(j)) ? 2 : 1;
        if (rw + cw > w && rw > 0) {
          out.push(cur);
          cur = ''; rw = 0;
        }
        cur += s[j]; rw += cw;
      }
      if (cur) out.push(cur);
      return out;
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
    // Defensive sid derivation from transcript filename. The transcript
    // filename is the canonical UUID for the logical session and stays
    // invariant for its entire lifetime, so per-session tmp files keyed
    // off it are robust against any future change to how `i.session_id`
    // is reported. Empirically on the current Claude Code build the two
    // are already identical, so this is a future-proofing measure rather
    // than a fix for an observed drift. Falls back to `i.session_id`
    // only when no transcript path is available.
    let _logicalSid = i.session_id;
    try {
      if (i.transcript_path) {
        const m = path.basename(i.transcript_path).match(/^([0-9a-fA-F-]+)\.jsonl$/);
        if (m) _logicalSid = m[1];
      }
    } catch (e) {}
    const sid = (_logicalSid || 'default').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 24);

    // Per-session state lives under ~/.claude/cc-statusline/ rather than
    // os.tmpdir(). tmpdir is treated as throwaway by every modern OS
    // (Windows Storage Sense clears it on a 30-day cycle, cleanmgr /
    // antivirus on whim, /tmp resets on Linux reboot, macOS occasionally
    // sweeps), which is the root cause of every cost-loss and active-
    // time-reset story we've chased so far. Only true ephemeral caches
    // (e.g. resolved terminal width) belong in tmpdir.
    const stateDir = path.join(os.homedir(), '.claude', 'cc-statusline');
    try { fs.mkdirSync(stateDir, { recursive: true }); } catch (e) {}
    // One-shot migration from the old tmpdir layout. Marker file stops us
    // doing this on every render. Skips silently on any error so we never
    // block the statusline render path.
    const migrateMarker = path.join(stateDir, '.migrated-from-tmpdir');
    if (!fs.existsSync(migrateMarker)) {
      try {
        const tmp = os.tmpdir();
        const re = /^claude-(cum|active|msgs|msgcount|summary|agents|files|compacts)-([0-9a-z]+)(\.json|\.txt)?$/;
        for (const f of fs.readdirSync(tmp)) {
          const m = f.match(re);
          if (!m) continue;
          const dest = path.join(stateDir, f.replace(/^claude-/, ''));
          try { fs.renameSync(path.join(tmp, f), dest); } catch (e) {}
        }
        fs.writeFileSync(migrateMarker, String(Date.now()));
      } catch (e) {}
    }

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
    const cumPath = path.join(stateDir, `cum-${sid}.json`);
    // Each step field: { total: cumulative, base: last-observed payload value }.
    // INVARIANT: only statusline.js writes this file. Hooks must NEVER write
    // to claude-cum-*.json — they keep their own per-feature state files
    // (e.g. claude-active-<sid>.json for active-time-tracker). This is
    // critical: when stored.cost is missing because some hook wrote a
    // partial cum file, the fallback below would otherwise reset cost.total
    // to 0 and statusline would silently lose accumulated spend.
    const STEP_KEYS = ['cost', 'dur', 'add', 'rm', 'tok'];
    const fieldCur = { cost: curCost, dur: curDur, add: curAdd, rm: curRm, tok: curTok };
    let cum = {};
    // Default: total = 0, base = current payload value. Setting base = cur
    // (instead of 0) means a fresh / partial cum file does NOT make the
    // first step() add the entire curCost into total — which would double-
    // count any prior accumulated value that legitimately lives elsewhere.
    for (const k of STEP_KEYS) cum[k] = { total: 0, base: fieldCur[k] };
    try {
      const stored = JSON.parse(fs.readFileSync(cumPath, 'utf8'));
      Object.assign(cum, stored);
      for (const k of STEP_KEYS) {
        if (stored[k] && typeof stored[k] === 'object') {
          cum[k] = {
            total: typeof stored[k].total === 'number' ? stored[k].total : 0,
            base: typeof stored[k].base === 'number' ? stored[k].base : fieldCur[k],
          };
        } else if (typeof stored[k] === 'number') {
          // Migration from old flat-number format.
          cum[k] = { total: stored[k], base: stored[k] };
        }
        // else: leave the defensive default { total: 0, base: cur } above —
        // do NOT reset total to 0 with base 0, that's the corruption path.
      }
    } catch (e) {}
    const step = (key, cur) => {
      const c = cum[key];
      if (cur >= c.base) { c.total += (cur - c.base); c.base = cur; }
      else { c.base = cur; } // reset detected — new baseline, don't touch total
    };
    step('cost', curCost); step('dur', curDur); step('add', curAdd); step('rm', curRm); step('tok', curTok);

    // ── Stability layer ────────────────────────────────────────────
    // The state files outside tmpdir mean the OS can no longer eat them,
    // but we still defend against future bugs (or manual edits) that
    // might somehow drop cost.total. Three layers:
    //
    //   1. Monotonic invariant — re-read the on-disk cum right before
    //      write and never let our in-memory total go below it. cost,
    //      add, rm, tok are all monotonic by definition.
    //   2. Snapshot backup — keep one .bak.json copy of the previous
    //      cum file content, so a wrong write can be hand-recovered.
    //   3. Audit log — append one JSON line per significant cost change
    //      to ~/.claude/cc-statusline/audit.log; rotate at ~1 MB.
    let priorOnDisk = null;
    try { priorOnDisk = JSON.parse(fs.readFileSync(cumPath, 'utf8')); } catch (e) {}
    if (priorOnDisk) {
      for (const k of STEP_KEYS) {
        const stTotal = priorOnDisk[k]?.total;
        if (typeof stTotal === 'number' && stTotal > cum[k].total) {
          // Disk has higher accumulation than memory — likely a concurrent
          // writer or a partial in-memory state. Preserve the higher value.
          cum[k].total = stTotal;
        }
      }
    }
    // Snapshot the prior content before overwriting.
    try {
      if (priorOnDisk) {
        atomicWrite(cumPath.replace(/\.json$/, '.bak.json'), JSON.stringify(priorOnDisk));
      }
    } catch (e) {}
    atomicWrite(cumPath, JSON.stringify(cum));
    // Audit log for cost movements. Only log meaningful deltas (>=$0.01)
    // to keep the file tractable. Rotate at ~1 MB.
    try {
      const oldCost = priorOnDisk?.cost?.total || 0;
      const newCost = cum.cost.total;
      if (Math.abs(newCost - oldCost) >= 0.01) {
        const auditPath = path.join(stateDir, 'audit.log');
        const line = JSON.stringify({
          ts: new Date().toISOString(),
          sid: sid,
          kind: 'cost',
          before: oldCost,
          after: newCost,
          delta: +(newCost - oldCost).toFixed(4),
        }) + '\n';
        fs.appendFileSync(auditPath, line);
        // Single-step rotate at ~1 MB.
        try {
          const st = fs.statSync(auditPath);
          if (st.size > 1024 * 1024) {
            try { fs.renameSync(auditPath, auditPath + '.1'); } catch (e) {}
          }
        } catch (e) {}
      }
    } catch (e) {}
    const cost = '$' + cum.cost.total.toFixed(2);
    // Active session time lives in its own state file written by
    // hooks/active-time-tracker.js. Decoupled from cum so that hook can
    // never accidentally drop cost.total via a partial overwrite.
    let activeMs = 0;
    try {
      const aPath = path.join(stateDir, `active-${sid}.json`);
      const a = JSON.parse(fs.readFileSync(aPath, 'utf8'));
      if (typeof a.activeMs === 'number') activeMs = a.activeMs;
    } catch (e) {}
    const dur = fmtDur(Math.round((activeMs > 0 ? activeMs : cum.dur.total) / 60000));
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
    const mySnap = {
      t: _nowSec,
      five_hour: i.rate_limits?.five_hour || null,
      seven_day: i.rate_limits?.seven_day || null,
    };
    const STALE_SEC = 300;
    // CAS merge: multiple sessions hit this file every 30s so last-writer-
    // wins would drop ~5% of entries under load (see commit 5b75b09). We
    // retry until our own sid entry is visible after write.
    const rlSnaps = casMerge(rlSnapFile,
      (snaps) => {
        snaps[sid] = mySnap;
        for (const k of Object.keys(snaps)) {
          if (!snaps[k]?.t || _nowSec - snaps[k].t > STALE_SEC) delete snaps[k];
        }
      },
      (after) => after[sid]?.t === mySnap.t
    );
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
    // Sanity cap: 5h window resets within 5h, 7d within 7d. Anything >8d in
    // the future is garbage (malformed payload or bad test data) and would
    // otherwise win the "latest resets_at" tiebreak and poison the display.
    const MAX_FUTURE_SEC = 8 * 86400;
    const aggMax = (field) => {
      const myRL = i.rate_limits?.[field];
      const liveSnaps = [];
      for (const snap of Object.values(rlSnaps)) {
        const s = snap?.[field];
        if (s && typeof s.used_percentage === 'number'
            && s.resets_at > _nowSec
            && s.resets_at - _nowSec <= MAX_FUTURE_SEC) {
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

    // Compute seconds remaining for a rolling-window reset. If resets_at has
    // already passed (payload stale), roll into the next window of period_sec.
    const countdownSec = (resetAt, period_sec) => {
      if (!resetAt) return null;
      const nowSec = Math.floor(Date.now() / 1000);
      if (resetAt > nowSec) return resetAt - nowSec;
      return period_sec - ((nowSec - resetAt) % period_sec);
    };
    let resetInfo = '';
    {
      const s = countdownSec(i.rate_limits?.five_hour?.resets_at, 5 * 3600);
      if (s != null) resetInfo = `${DIM}resets${R} ${Math.floor(s/3600)}h${Math.floor((s%3600)/60)}m`;
    }
    let reset7dInfo = '';
    {
      const s = countdownSec(i.rate_limits?.seven_day?.resets_at, 7 * 86400);
      if (s != null) reset7dInfo = `${DIM}resets${R} ${Math.floor(s/86400)}d${Math.floor((s%86400)/3600)}h`;
    }

    let effort = '';
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
      const lvl = settings.effortLevel || 'default';
      const ORANGE = '\x1b[38;5;208m';
      const effortColor = {
        low: DIM,
        default: GREEN,
        medium: GREEN,
        high: YELLOW,
        xhigh: ORANGE,
        max: RED,
      }[lvl] || GREEN;
      effort = `${DIM}effort${R} ${effortColor}${lvl}${R}`;
    } catch (e) {}

    let agentLine = '';
    try {
      const agents = JSON.parse(fs.readFileSync(path.join(stateDir, `agents-${sid}.json`), 'utf8'));
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
    try { compactCount = JSON.parse(fs.readFileSync(path.join(stateDir, `compacts-${sid}.json`), 'utf8')).count; } catch (e) {}

    let fileParts = [];
    try { fileParts = JSON.parse(fs.readFileSync(path.join(stateDir, `files-${sid}.json`), 'utf8')); } catch (e) {}

    let msgHistory = [];
    try {
      msgHistory = JSON.parse(fs.readFileSync(path.join(stateDir, `msgs-${sid}.json`), 'utf8'));
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
    const mcpCachePath = path.join(os.homedir(), '.claude', 'mcp-status-cache.json');
    let mcpParts = [], mcpTotal = 0, mcpHealthy = 0;
    try {
      const mcpCache = JSON.parse(fs.readFileSync(mcpCachePath, 'utf8'));
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
    // Fire background refresh so next render has fresh data — but only if
    // the cache is actually stale. The refresher itself is also self-
    // skipping, but the wrapper spawn (node + module load + statSync) used
    // to run every render = ~960 spawns per 8h. Cheap stale check up front
    // collapses that to a handful of real refreshes per hour.
    const MCP_REFRESH_INTERVAL_MS = 90 * 1000;
    let mcpCacheStale = true;
    try {
      const cacheStat = fs.statSync(mcpCachePath);
      mcpCacheStale = (Date.now() - cacheStat.mtimeMs) > MCP_REFRESH_INTERVAL_MS;
    } catch(e) { /* no cache yet — definitely stale */ }
    if (mcpCacheStale) {
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
    }

    // ── Build left-side content ──
    const gitParts = [];
    if (repoName) gitParts.push(`${CYAN}${repoName}${R}`);
    if (branch) gitParts.push(`${MAGENTA}${branch}${R}${dirty ? ` ${DIM}(${dirty} changed)${R}` : ''}`);
    const gitInfo = gitParts.join(' ');

    // Aggregate cost + tokens across per-session cum files. Two filters:
    //   1. Filename must match `claude-cum-<24-hex>.json` so stale test
    //      fixtures or stray files can't poison the number.
    //   2. mtime must be within the configured window (aggWindowDays, default
    //      30, `0` = all time). Default picks 30 because Windows Storage
    //      Sense clears tmpdir at 30 days anyway — matching that window
    //      means the displayed total doesn't silently drop when the OS
    //      evicts older files. Aligns with typical monthly billing view.
    // Re-read config for aggWindowDays (rowCfg above holds only row flags).
    // Default 0 = all time. Per-session state lives under
    // ~/.claude/cc-statusline/ which the OS does not auto-clean, so the
    // earlier 30-day default (chosen to match Windows Storage Sense's
    // tmpdir eviction window) is no longer needed. Users who want a
    // rolling view can still set aggWindowDays explicitly.
    let _aggDays = 0;
    try {
      const stored = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'cc-statusline-rows.json'), 'utf8'));
      if (typeof stored.aggWindowDays === 'number' && stored.aggWindowDays >= 0) {
        _aggDays = Math.floor(stored.aggWindowDays);
      }
    } catch (e) {}
    const AGG_MAX_AGE_MS = _aggDays > 0 ? _aggDays * 86400 * 1000 : Infinity;
    const CUM_FILE_RE = /^cum-[0-9a-f]{24}\.json$/;
    const _aggNow = Date.now();
    let allCost = 0, allTok = 0;
    try {
      for (const f of fs.readdirSync(stateDir)) {
        if (!CUM_FILE_RE.test(f)) continue;
        const full = path.join(stateDir, f);
        try {
          if (_aggNow - fs.statSync(full).mtimeMs > AGG_MAX_AGE_MS) continue;
          const c = JSON.parse(fs.readFileSync(full, 'utf8'));
          allCost += c.cost?.total || 0;
          allTok += c.tok?.total || 0;
        } catch (e) {}
      }
    } catch (e) {}
    const allCostStr = '$' + allCost.toFixed(2);
    // Window label rendered inside parens as an annotation: "(past 30 days)",
    // "(past 7 days)", "(past 1 day)", or "(all time)". Parallels the
    // "(this session)" annotation on the per-session figure.
    const windowLabel = _aggDays === 0 ? 'all time'
                      : _aggDays === 1 ? 'past 1 day'
                      : `past ${_aggDays} days`;

    // Split rows: [leftCol, rightCol] — each cell gated by /cc-statusline:rows config.
    // Empty cells collapse: if a whole column (left OR right across both rows) is empty,
    // the remaining cells merge into full-width rows (no empty grid cells).
    const linesInfo = `${GREEN}+${added}${R} ${RED}-${removed}${R} ${DIM}lines${R}`;
    let splitRow1L = showRow('dir')   ? `\u{1f4c1} ${shortDir}  ${linesInfo}` : '';
    // Independent visibility for model (name+effort) and duration. When both
    // shown: `Sonnet  effort xhigh  \u00b7 17d 17hr`. If user hides model, duration
    // still shows on its own. If user hides duration, model still shows.
    const _modelPart = showRow('model') ? `${CYAN}${model}${R}  ${effort}` : '';
    const _durPart   = showRow('duration') ? `${R}${dur}${R}` : '';
    let splitRow1R = _modelPart && _durPart ? `${_modelPart}  ${DIM}\u00b7${R} ${_durPart}`
                   : _modelPart ? _modelPart
                   : _durPart;
    let splitRow2L = showRow('repo')  ? (gitInfo || '') : '';
    let splitRow2R = showRow('cost')  ? `${DIM}cost${R} ${allCostStr} ${DIM}(${windowLabel})${R} ${DIM}·${R} ${cost} ${DIM}(this session)${R}` : '';

    // Collapsed "top rows" — full-width rows rendered BEFORE the split block (if any).
    // Used when a whole column is empty (one side totally unused → no point in 2-cell layout).
    const preSplitRows = [];
    const leftEmpty = !splitRow1L && !splitRow2L;
    const rightEmpty = !splitRow1R && !splitRow2R;
    if (leftEmpty && (splitRow1R || splitRow2R)) {
      if (splitRow1R) preSplitRows.push(splitRow1R);
      if (splitRow2R) preSplitRows.push(splitRow2R);
      splitRow1L = splitRow1R = splitRow2L = splitRow2R = '';
    } else if (rightEmpty && (splitRow1L || splitRow2L)) {
      if (splitRow1L) preSplitRows.push(splitRow1L);
      if (splitRow2L) preSplitRows.push(splitRow2L);
      splitRow1L = splitRow1R = splitRow2L = splitRow2R = '';
    }
    // Whole-empty row skip: if both cells of a row are empty, don't emit that row at all.
    // These are `let` because the fit-to-width pass below may collapse the split block
    // into stacked rows when LEFT_INNER overflows the terminal.
    let hasRow1 = !!(splitRow1L || splitRow1R);
    let hasRow2 = !!(splitRow2L || splitRow2R);
    let hasSplitBlock = hasRow1 || hasRow2;

    // Full-width left rows — each row gated by /cc-statusline:rows config
    const compactLabel = `${compactCount} time${compactCount === 1 ? '' : 's'}`;
    const ctxLine = `${DIM}tokens${R} ${fmtTok(allTok)} ${DIM}(${windowLabel})${R} ${DIM}·${R} ${fmtTok(tokTotal)} ${DIM}(this session)${R}  ${DIM}context${R} ${cc(ctx)}${bar(ctx)} ${ctx}%${R}  ${DIM}compact${R} ${compactLabel}`;
    // Wider gap between 5h and 7d so the row breathes
    const quotaLine = `${DIM}5h-quota${R} ${cc(r5h)}${bar(r5h)} ${r5h}%${R} ${resetInfo}     ${DIM}7d-quota${R} ${cc(r7d)}${bar(r7d)} ${r7d}%${R} ${reset7dInfo}`;
    const fullLeftRows = [];
    if (showRow('usage')) fullLeftRows.push(ctxLine);
    if (showRow('quota')) fullLeftRows.push(quotaLine);
    if (showRow('agents') && agentLine) fullLeftRows.push(`${DIM}agents${R}  ${agentLine}`);
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
    if (showRow('memory_mcp') && (memStr || mcpStr)) {
      if (memStr && mcpStr) {
        memMcpCol = dw(memStr) + 1; // offset inside padded content area (after "memStr ")
      }
      memMcpRowIdx = fullLeftRows.length;
      const combined = [memStr, mcpStr].filter(Boolean).join(` ${DIM}\u2502${R} `);
      fullLeftRows.push(combined);
    }
    const sep = ` ${DIM}\u2192${R} `;
    if (showRow('edited') && fileParts.length) {
      // Per-filename cap: keep last chars so extension stays visible; truncate front with …
      const shortFile = f => f.length > 25 ? '\u2026' + f.slice(-24) : f;
      let fitted = [], usedW = 8; // "edited  " label width
      for (const f of fileParts) {
        const sf = shortFile(f);
        const fw = sf.length + (fitted.length ? 3 : 0);
        if (usedW + fw > 70) break; // tighter row width so LEFT_W stays lean
        fitted.push(sf); usedW += fw;
      }
      if (fitted.length) fullLeftRows.push(`${DIM}edited${R}  ${fitted.join(sep)}`);
    }

    // Session summary — Claude-written file > session_name > first msg > sid
    // Gated by /cc-statusline:rows — empty summary = summary block skipped entirely later
    let summary = '';
    if (showRow('summary')) {
      try {
        const sf = path.join(stateDir, `summary-${sid}.txt`);
        summary = fs.readFileSync(sf, 'utf8').trim().split('\n')[0].slice(0, 500);
      } catch (e) {}
      if (!summary) summary = sessionName || '';
      if (!summary && msgHistory.length) {
        const firstUser = msgHistory.find(m => m.r === 'u');
        if (firstUser) summary = firstUser.t.replace(/\n/g, ' ').trim().slice(0, 60);
      }
      if (!summary) summary = `session ${sid.slice(0, 8)}`;
    }
    const hasSummary = !!summary;

    // ── Measure widths ──
    let maxLL = Math.max(dw(splitRow1L), dw(splitRow2L));
    let maxLR = Math.max(dw(splitRow1R), dw(splitRow2R));
    const LLW = maxLL + 2;
    const LRW = maxLR + 2;
    const LEFT_INNER = LLW + 1 + LRW;

    let maxFull = 0;
    for (const f of fullLeftRows) maxFull = Math.max(maxFull, dw(f) + 2);
    let LEFT_W = Math.max(LEFT_INNER, maxFull);
    // ── Terminal width ────────────────────────────────────────────
    // Detection inside a Claude Code statusline hook is largely futile:
    //   * stdio is a pipe, so `process.stdout.columns` is undefined
    //   * `$COLUMNS` is not exported
    //   * `tput cols` is hardcoded to 80
    //   * spawning PowerShell on Windows reports the spawned subprocess's
    //     own hidden-window width, not the user's terminal
    //   * `/dev/tty` is not accessible from this subprocess on most setups
    //   * Claude Code itself declines to pass the width — the request was
    //     filed and closed as not planned:
    //     https://github.com/anthropics/claude-code/issues/5430
    //
    // We make a best-effort attempt at the cheap signals (process.stdout
    // .columns and `$COLUMNS`) so this works automatically if Anthropic
    // ever changes the stdio contract. Otherwise the user is the source
    // of truth: set `statuslineWidth` in ~/.claude/cc-statusline-rows.json
    // to your terminal's actual column count. Default 120 is a safe
    // conservative box size that fits most terminals without overflowing.
    let widthOffset = 4;
    let userStatuslineWidth = 0;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'cc-statusline-rows.json'), 'utf8'));
      if (typeof cfg.statuslineWidthOffset === 'number' && cfg.statuslineWidthOffset >= 0) {
        widthOffset = Math.floor(cfg.statuslineWidthOffset);
      }
      if (typeof cfg.statuslineWidth === 'number' && cfg.statuslineWidth > 0) {
        userStatuslineWidth = Math.floor(cfg.statuslineWidth);
      }
    } catch (e) {}
    let TERM_W = 0;
    if (userStatuslineWidth > 0) {
      // User-supplied width wins. They measured it; trust it.
      TERM_W = userStatuslineWidth;
    } else {
      // Best-effort cheap signals only. No PowerShell spawn, no /dev/tty,
      // no on-disk cache — those persisted wrong values across renders.
      TERM_W = process.stdout.columns || process.stderr.columns || 0;
      if (!TERM_W) { try { TERM_W = parseInt(process.env.COLUMNS, 10) || 0; } catch (e) {} }
      if (!TERM_W) TERM_W = 120;
    }
    TERM_W = Math.max(20, TERM_W - widthOffset);

    // ── Fit to width ──────────────────────────────────────────────
    // statuslineWidth caps the box's outer width. The left side is content-
    // driven (LEFT_W = max(LEFT_INNER, maxFull)) and can exceed TERM_W on
    // small terminals or sessions with long rows (cost / quota / summary).
    // When that happens Claude Code's statusline area truncates the box
    // with `…` and the user sees a blank statusline.
    //
    // Degrade gracefully without dropping information:
    //   1. If the 2-column split block (LEFT_INNER) overflows, collapse it
    //      to stacked single-column rows via preSplitRows.
    //   2. Wrap any row whose content still exceeds the target inner width.
    //      ANSI styling is preserved per chunk via `wrap()` above.
    //   3. Recompute LEFT_W from the wrapped row set so the border draws
    //      to the new width.
    const TARGET_INNER_W = Math.max(40, TERM_W - 2); // -2 for box border (│ … │)
    if (LEFT_W > TARGET_INNER_W) {
      if (LEFT_INNER > TARGET_INNER_W && hasSplitBlock) {
        if (splitRow1L) preSplitRows.push(splitRow1L);
        if (splitRow1R) preSplitRows.push(splitRow1R);
        if (splitRow2L) preSplitRows.push(splitRow2L);
        if (splitRow2R) preSplitRows.push(splitRow2R);
        splitRow1L = splitRow1R = splitRow2L = splitRow2R = '';
        hasRow1 = hasRow2 = hasSplitBlock = false;
      }
      const wrappedFull = [];
      for (const row of fullLeftRows) {
        for (const piece of wrap(row, TARGET_INNER_W - 2)) wrappedFull.push(piece);
      }
      fullLeftRows.length = 0;
      fullLeftRows.push(...wrappedFull);
      const wrappedPre = [];
      for (const row of preSplitRows) {
        for (const piece of wrap(row, TARGET_INNER_W - 2)) wrappedPre.push(piece);
      }
      preSplitRows.length = 0;
      preSplitRows.push(...wrappedPre);
      maxFull = 0;
      for (const f of [...preSplitRows, ...fullLeftRows]) {
        maxFull = Math.max(maxFull, dw(f) + 2);
      }
      LEFT_W = Math.max(hasSplitBlock ? LEFT_INNER : 0, maxFull);
      LEFT_W = Math.min(LEFT_W, TARGET_INNER_W);
    }

    // Left = content-driven (never truncated). Right = fills remaining terminal space.
    const MSG_W = Math.max(0, TERM_W - LEFT_W - 3);
    const showMsgs = showRow('history') && MSG_W >= 15; // hide right column if too narrow or user disabled
    const LRW_RECALC = LEFT_W - LLW - 1;
    const TOTAL = LEFT_W + 1 + MSG_W;

    // Summary wrap (character-level, matching actual render width = LEFT_W - 18)
    // "session summary " label is 16 chars; subsequent rows indent 16 spaces.
    // Content area on each row is LEFT_W - 2 (inside │ │) minus 16 label/indent.
    const MAX_SUM_LINES = 4;
    const maxSumW_calc = LEFT_W - 18;
    const sumLines = [];
    if (hasSummary) { let curLine = '', curW = 0, truncated = false;
      const chars = [...summary];
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
        if (curW + cw > maxSumW_calc && curLine) {
          if (sumLines.length + 1 >= MAX_SUM_LINES) {
            const rest = chars.slice(i).join('');
            if (rest.length > 0) {
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

    // Count total rows for right-column slot allocation.
    // Split-open divider can be absorbed by the top border when split is the first section;
    // bottom border can absorb the split-close when split is the last section.
    const topMergeSplitSlot = hasSplitBlock && !hasSummary && preSplitRows.length === 0; // same condition as topMergeSplit
    const splitContentRows = (hasRow1 ? 1 : 0) + (hasRow2 ? 1 : 0);
    const splitOpenDivider = (hasSplitBlock && !topMergeSplitSlot) ? 1 : 0;
    const splitCloseDivider = (hasSplitBlock && fullLeftRows.length > 0) ? 1 : 0;
    const allFullRows = preSplitRows.length + fullLeftRows.length;
    const fullDividers = Math.max(0, preSplitRows.length - 1) + (fullLeftRows.length > 1 ? fullLeftRows.length - 1 : 0);
    let sectionDividers = 0;
    if (hasSummary && (preSplitRows.length || hasSplitBlock || fullLeftRows.length)) sectionDividers++;
    if (preSplitRows.length && fullLeftRows.length && !hasSplitBlock) sectionDividers++;
    const totalSlots = sumLines.length + splitContentRows + allFullRows + splitOpenDivider + splitCloseDivider + fullDividers + sectionDividers;

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

    // Top border — if the FIRST section is the split block, merge the split-open into
    // the top border so there's no redundant ├─┬─┤ right after ┌─┐.
    const topMergeSplit = hasSplitBlock && !hasSummary && preSplitRows.length === 0;
    if (topMergeSplit) {
      // top border with split column divider baked in: ┌───┬───┬───┐ (or ┌───┬───┐ if no msgs)
      if (showMsgs) output.push(`${h('\u250c')}${h(hl(LLW))}${h('\u252c')}${h(hl(LRW_RECALC))}${h('\u252c')}${h(hl(MSG_W))}${h('\u2510')}`);
      else          output.push(`${h('\u250c')}${h(hl(LLW))}${h('\u252c')}${h(hl(LRW_RECALC))}${h('\u2510')}`);
    } else if (showMsgs) {
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

    // Summary rows
    if (hasSummary) {
      for (let si = 0; si < sumLines.length; si++) {
        const label = si === 0 ? `${DIM}session summary${R} ` : ' '.repeat(16);
        output.push(`${h('\u2502')} ${label}${pad(sumLines[si], LEFT_W - 18)} ${h('\u2502')}${rcell()}`);
      }
    }

    // pre-split full-width rows (when an entire split column collapsed to single-cell)
    if (preSplitRows.length > 0) {
      if (hasSummary) output.push(`${h('\u251c')}${h(hl(LEFT_W))}${h('\u2524')}${rcell()}`);
      for (let j = 0; j < preSplitRows.length; j++) {
        if (j > 0) output.push(`${h('\u251c')}${h(hl(LEFT_W))}${h('\u2524')}${rcell()}`);
        output.push(`${h('\u2502')} ${pad(preSplitRows[j], LEFT_W - 2)} ${h('\u2502')}${rcell()}`);
      }
    }

    // Split block — skip individual rows if both cells empty
    if (hasSplitBlock) {
      // Emit split-open divider only if NOT merged with top border
      if (!topMergeSplit) {
        output.push(`${h('\u251c')}${h(hl(LLW))}${h('\u252c')}${h(hl(LRW_RECALC))}${h('\u2524')}${rcell()}`);
      }
      if (hasRow1) output.push(`${h('\u2502')} ${pad(splitRow1L, LLW - 2)} ${h('\u2502')} ${pad(splitRow1R, LRW_RECALC - 2)} ${h('\u2502')}${rcell()}`);
      if (hasRow2) output.push(`${h('\u2502')} ${pad(splitRow2L, LLW - 2)} ${h('\u2502')} ${pad(splitRow2R, LRW_RECALC - 2)} ${h('\u2502')}${rcell()}`);
      if (fullLeftRows.length > 0) {
        output.push(`${h('\u251c')}${h(hl(LLW))}${h('\u2534')}${h(hl(LRW_RECALC))}${h('\u2524')}${rcell()}`);
      }
    } else if (!preSplitRows.length && hasSummary && fullLeftRows.length > 0) {
      output.push(`${h('\u251c')}${h(hl(LEFT_W))}${h('\u2524')}${rcell()}`);
    } else if (preSplitRows.length > 0 && fullLeftRows.length > 0) {
      output.push(`${h('\u251c')}${h(hl(LEFT_W))}${h('\u2524')}${rcell()}`);
    }

    // Full-width left rows
    for (let j = 0; j < fullLeftRows.length; j++) {
      output.push(`${h('\u2502')} ${pad(fullLeftRows[j], LEFT_W - 2)} ${h('\u2502')}${rcell()}`);
      if (j < fullLeftRows.length - 1) {
        const marks = {};
        if (mcpHlIdx >= 0) {
          if (j + 1 === memMcpRowIdx) marks[mcpHlIdx] = '\u252c'; // ┬
          else if (j === memMcpRowIdx) marks[mcpHlIdx] = '\u2534'; // ┴
        }
        output.push(`${h('\u251c')}${h(hlm(LEFT_W, marks))}${h('\u2524')}${rcell()}`);
      }
    }

    // Bottom border
    const bottomMarks = {};
    // If mem/mcp is the last full row, extend its ┴ down to the bottom
    if (mcpHlIdx >= 0 && memMcpRowIdx === fullLeftRows.length - 1) bottomMarks[mcpHlIdx] = '\u2534';
    // If split block was the last thing emitted (no full rows after), the split divider lands on bottom
    if (hasSplitBlock && fullLeftRows.length === 0) {
      if (showMsgs) {
        output.push(`${h('\u2514')}${h(hl(LLW))}${h('\u2534')}${h(hl(LRW_RECALC))}${h('\u2534')}${h(hl(MSG_W))}${h('\u2518')}`);
      } else {
        output.push(`${h('\u2514')}${h(hl(LLW))}${h('\u2534')}${h(hl(LRW_RECALC))}${h('\u2518')}`);
      }
    } else {
      if (showMsgs) {
        output.push(`${h('\u2514')}${h(hlm(LEFT_W, bottomMarks))}${h('\u2534')}${h(hl(MSG_W))}${h('\u2518')}`);
      } else {
        output.push(`${h('\u2514')}${h(hlm(LEFT_W, bottomMarks))}${h('\u2518')}`);
      }
    }

    process.stdout.write(output.join('\n'));
  } catch (e) {
    process.stdout.write('statusline error: ' + e.message);
  }
});
