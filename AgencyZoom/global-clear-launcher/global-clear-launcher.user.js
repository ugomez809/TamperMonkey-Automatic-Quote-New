// ==UserScript==
// @name         Cross-Origin Global Clear Launcher
// @namespace    homebot.global-clear-launcher
// @version      1.0.5
// @description  One click: clears current origin now, clears GM mirrored caches, opens AZ + APEX + Alta, each opened tab clears itself, then auto-closes.
// @match        https://app.agencyzoom.com/*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/global-clear-launcher/global-clear-launcher.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/global-clear-launcher/global-clear-launcher.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'Cross-Origin Global Clear Launcher';
  const VERSION = '1.0.5';

  // Log-export integration â€” key picked by origin since this runs on all 3.
  const LOG_PERSIST_KEY = (() => {
    const host = String(location.host || '');
    if (host.includes('agencyzoom.com')) return 'tm_az_global_clear_launcher_logs_v1';
    if (host.includes('lightning.force.com')) return 'tm_apex_global_clear_launcher_logs_v1';
    return 'tm_alta_global_clear_launcher_logs_v1';
  })();
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';

  const GM_KEYS = {
    RESET_PACKET: 'hb_global_clear_packet_v1',
    LAST_ACTION: 'hb_global_clear_last_action_v1'
  };

  const LS_KEYS = {
    APPLIED_TOKEN: 'hb_global_clear_applied_token_v1',
    PANEL_POS: 'hb_global_clear_panel_pos_v1'
  };

  const CFG = {
    zIndex: 2147483647,
    panelRight: 12,
    panelBottom: 12,
    maxLogs: 18,
    autoCloseMs: 1200,
    packetMaxAgeMs: 10 * 60 * 1000
  };

  const OPEN_TARGETS = [
    'https://app.agencyzoom.com/referral/pipeline#',
    'https://farmersagent.lightning.force.com/lightning/page/home',
    'https://alta.farmers.com/quote/auto/personal-info'
  ];

  const PROJECT_PREFIXES = [
    'tm_az_',
    'tm_apex_',
    'tm_alta_',
    'tm_shared_',
    'aqb_'
  ];

  const PROJECT_EXACT_KEYS = [
    '__hb_apex_qna_stop_this_session__',
    'az_ha_panel_left_v12',
    'hb_shared_az_to_alta_ticket_handoff_v1',
    'hb_shared_az_to_alta_ticket_handoff_last_applied_v1',
    'hb_shared_az_to_alta_ticket_handoff_stop_v1'
  ];

  const state = {
    logs: [],
    ui: null,
    busy: false,
    logsIntervalTimer: null
  };

  init();

  async function init() {
    buildUI();
    log(`Loaded ${SCRIPT_NAME} V${VERSION}`);
    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();
    await applyPendingResetIfNeeded();
  }

  function buildUI() {
    const old = document.getElementById('hb-global-clear-launcher-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'hb-global-clear-launcher-panel';
    panel.style.cssText = [
      'position:fixed',
      `right:${CFG.panelRight}px`,
      `bottom:${CFG.panelBottom}px`,
      'width:380px',
      `z-index:${CFG.zIndex}`,
      'background:rgba(17,24,39,.96)',
      'color:#f9fafb',
      'border:1px solid rgba(255,255,255,.12)',
      'border-radius:12px',
      'box-shadow:0 10px 28px rgba(0,0,0,.35)',
      'font:12px/1.35 Arial,sans-serif',
      'overflow:hidden'
    ].join(';');

    const saved = loadPanelPos();
    if (saved) {
      panel.style.left = saved.left;
      panel.style.top = saved.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    panel.innerHTML = `
      <div id="hb-gcl-head" style="padding:8px 10px;background:rgba(255,255,255,.06);cursor:move;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:700;">${SCRIPT_NAME}</div>
        <div style="opacity:.75;">V${VERSION}</div>
      </div>
      <div style="padding:10px;">
        <div id="hb-gcl-status" style="font-weight:700;color:#93c5fd;margin-bottom:8px;">Ready</div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <button id="hb-gcl-run" type="button" style="border:0;border-radius:8px;padding:8px 10px;background:#b91c1c;color:#fff;font-weight:700;cursor:pointer;">GLOBAL CLEAR + OPEN</button>
          <button id="hb-gcl-copy" type="button" style="border:0;border-radius:8px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;">COPY LOGS</button>
        </div>

        <div style="font-size:11px;opacity:.82;margin-bottom:8px;">
          Opens AZ + APEX + Alta. Each opened tab clears itself and auto-closes.
        </div>

        <div id="hb-gcl-logs" style="max-height:180px;overflow:auto;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px;white-space:pre-wrap;word-break:break-word;font-family:Consolas,monospace;font-size:11px;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);

    const head = panel.querySelector('#hb-gcl-head');
    const runBtn = panel.querySelector('#hb-gcl-run');
    const copyBtn = panel.querySelector('#hb-gcl-copy');

    runBtn.addEventListener('click', async () => {
      if (state.busy) return;
      state.busy = true;
      setStatus('Running...');
      try {
        await runGlobalClearAndOpen();
        setStatus('Global clear armed');
      } catch (err) {
        log(`Failed: ${err?.message || err}`);
        setStatus('Failed');
      } finally {
        state.busy = false;
      }
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText([...state.logs].reverse().join('\n'));
        log('Logs copied');
      } catch {
        log('Copy logs failed');
      }
    });

    makeDraggable(panel, head);

    state.ui = {
      panel,
      status: panel.querySelector('#hb-gcl-status'),
      logs: panel.querySelector('#hb-gcl-logs')
    };

    renderLogs();
  }

  async function runGlobalClearAndOpen() {
    const token = `reset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const packet = {
      token,
      createdAt: Date.now(),
      closeAfterApply: true,
      urls: OPEN_TARGETS.slice()
    };

    const gmRemoved = clearProjectGmKeys();
    log(`GM cache keys removed: ${gmRemoved}`);

    GM_setValue(GM_KEYS.RESET_PACKET, packet);
    GM_setValue(GM_KEYS.LAST_ACTION, {
      token,
      at: new Date().toISOString(),
      origin: location.origin,
      href: location.href
    });

    const localRemoved = clearProjectStore(localStorage);
    const sessionRemoved = clearProjectStore(sessionStorage);

    localStorage.setItem(LS_KEYS.APPLIED_TOKEN, token);

    log(`Current origin cleared: ${location.origin}`);
    log(`localStorage removed: ${localRemoved}`);
    log(`sessionStorage removed: ${sessionRemoved}`);

    let opened = 0;
    let blocked = 0;

    for (const baseUrl of OPEN_TARGETS) {
      const finalUrl = addResetParams(baseUrl, token);
      const isCurrentOrigin = new URL(finalUrl).origin === location.origin;

      if (isCurrentOrigin) {
        log(`Skip open current origin: ${new URL(finalUrl).origin}`);
        continue;
      }

      try {
        const w = window.open(finalUrl, '_blank');
        if (w) {
          opened++;
          log(`Opened: ${finalUrl}`);
        } else {
          blocked++;
          log(`Popup blocked: ${finalUrl}`);
        }
      } catch {
        blocked++;
        log(`Open failed: ${finalUrl}`);
      }
    }

    log(`Open results -> opened: ${opened}, blocked: ${blocked}`);
    log('Now wait a few seconds for spawned tabs to clear and close.');
  }

  async function applyPendingResetIfNeeded() {
    const packet = readResetPacket();
    if (!packet) {
      setStatus('Ready');
      return;
    }

    if ((Date.now() - Number(packet.createdAt || 0)) > CFG.packetMaxAgeMs) {
      setStatus('Ready');
      return;
    }

    const token = String(packet.token || '').trim();
    if (!token) {
      setStatus('Ready');
      return;
    }

    const applied = String(localStorage.getItem(LS_KEYS.APPLIED_TOKEN) || '').trim();
    if (applied === token) {
      setStatus('Ready');
      return;
    }

    const localRemoved = clearProjectStore(localStorage);
    const sessionRemoved = clearProjectStore(sessionStorage);

    localStorage.setItem(LS_KEYS.APPLIED_TOKEN, token);

    log(`Pending reset applied on ${location.origin}`);
    log(`localStorage removed: ${localRemoved}`);
    log(`sessionStorage removed: ${sessionRemoved}`);
    setStatus('Pending reset applied');

    const shouldAutoClose =
      packet.closeAfterApply === true &&
      hasResetParam() &&
      !isSameOriginAsLastAction();

    const packetAgeSec = Math.round((Date.now() - Number(packet.createdAt || 0)) / 1000);
    const urlResetParam = (() => {
      try { return new URL(location.href).searchParams.get('hb_global_reset') || '(none)'; }
      catch { return '(url-parse-error)'; }
    })();

    if (shouldAutoClose) {
      log(`[CLOSE-TAB-DIAG] global-clear-launcher FIRING close | packetAgeSec=${packetAgeSec} | token=${token.slice(-8)} | url_hb_global_reset=${urlResetParam} | sameOriginAsLastAction=${isSameOriginAsLastAction()} | url=${location.href}`);
      _lastLogPersistAt = 0;
      persistLogsThrottled();
      setTimeout(() => tryCloseTab(), CFG.autoCloseMs);
    } else {
      log(`[CLOSE-TAB-DIAG] global-clear-launcher reset applied but close NOT fired | packetAgeSec=${packetAgeSec} | hasResetParam=${hasResetParam()} | closeAfterApply=${packet.closeAfterApply === true} | sameOriginAsLastAction=${isSameOriginAsLastAction()} | url_hb_global_reset=${urlResetParam}`);
      _lastLogPersistAt = 0;
      persistLogsThrottled();
    }
  }

  function readResetPacket() {
    try {
      const packet = GM_getValue(GM_KEYS.RESET_PACKET, null);
      return packet && typeof packet === 'object' ? packet : null;
    } catch {
      return null;
    }
  }

  function isSameOriginAsLastAction() {
    try {
      const action = GM_getValue(GM_KEYS.LAST_ACTION, null);
      if (!action || typeof action !== 'object') return false;
      return String(action.origin || '') === location.origin;
    } catch {
      return false;
    }
  }

  function hasResetParam() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('hb_global_reset') === '1';
    } catch {
      return false;
    }
  }

  function addResetParams(url, token) {
    const u = new URL(url);
    u.searchParams.set('hb_global_reset', '1');
    u.searchParams.set('hb_reset_token', token);
    u.searchParams.set('_hbts', String(Date.now()));
    return u.toString();
  }

  function clearProjectStore(store) {
    let removed = 0;
    const keys = [];

    try {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k) keys.push(k);
      }
    } catch {}

    for (const key of keys) {
      if (!isProjectKey(key)) continue;
      if (Object.values(LS_KEYS).includes(key)) continue;
      try {
        store.removeItem(key);
        removed++;
      } catch {}
    }

    return removed;
  }

  function clearProjectGmKeys() {
    let removed = 0;
    let keys = [];

    try {
      keys = GM_listValues() || [];
    } catch {
      keys = [];
    }

    for (const key of keys) {
      if (!isProjectKey(key)) continue;
      try {
        GM_deleteValue(key);
        removed++;
      } catch {}
    }

    return removed;
  }

  function isProjectKey(key) {
    if (!key) return false;
    if (Object.values(GM_KEYS).includes(key)) return false;
    if (PROJECT_EXACT_KEYS.includes(key)) return true;
    return PROJECT_PREFIXES.some(prefix => key.startsWith(prefix));
  }

  function tryCloseTab() {
    try { window.open('', '_self'); } catch {}
    try { window.close(); } catch {}

    setTimeout(() => {
      if (!document.hidden) {
        try { location.replace('about:blank'); } catch {}
        setTimeout(() => {
          try { window.close(); } catch {}
        }, 100);
      }
    }, 350);
  }

  function setStatus(text) {
    if (state.ui?.status) state.ui.status.textContent = text;
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift(line);
    if (state.logs.length > CFG.maxLogs) state.logs.length = CFG.maxLogs;
    console.log(`[${SCRIPT_NAME}] ${msg}`);
    renderLogs();
    persistLogsThrottled();
  }

  function persistLogsThrottled() {
    const now = Date.now();
    if (now - _lastLogPersistAt < LOG_PERSIST_THROTTLE_MS) return;
    _lastLogPersistAt = now;
    const raw = Array.isArray(state.logs) ? state.logs : [];
    const lines = raw.map(entry => (typeof entry === 'string' ? entry : (entry?.line || '')));
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      origin: location.origin,
      updatedAt: new Date().toISOString(),
      lines
    };
    try { localStorage.setItem(LOG_PERSIST_KEY, JSON.stringify(payload)); } catch {}
    try { GM_setValue(LOG_PERSIST_KEY, payload); } catch {}
  }

  function checkLogClearRequest() {
    let req = null;
    try { req = JSON.parse(localStorage.getItem(LOG_CLEAR_SIGNAL_KEY) || 'null'); } catch {}
    if (!req) { try { req = GM_getValue(LOG_CLEAR_SIGNAL_KEY, null); } catch {} }
    const at = typeof req?.requestedAt === 'string' ? req.requestedAt : '';
    if (!at || at === _lastLogClearHandledAt) return;
    _lastLogClearHandledAt = at;
    state.logs.length = 0;
    _lastLogPersistAt = 0;
    try { renderLogs(); } catch {}
    persistLogsThrottled();
  }

  function handleLogClearStorageEvent(event) {
    if (!event || event.key !== LOG_CLEAR_SIGNAL_KEY) return;
    checkLogClearRequest();
  }

  function logsTick() {
    persistLogsThrottled();
    checkLogClearRequest();
  }

  function renderLogs() {
    if (!state.ui?.logs) return;
    state.ui.logs.innerHTML = state.logs.map(x => `<div style="margin-bottom:4px;">${escapeHtml(x)}</div>`).join('');
  }

  function loadPanelPos() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEYS.PANEL_POS) || 'null');
    } catch {
      return null;
    }
  }

  function savePanelPos(panel) {
    try {
      localStorage.setItem(LS_KEYS.PANEL_POS, JSON.stringify({
        left: panel.style.left || '',
        top: panel.style.top || ''
      }));
    } catch {}
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let sl = 0;
    let st = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true;

      const r = panel.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      sl = r.left;
      st = r.top;

      panel.style.left = `${r.left}px`;
      panel.style.top = `${r.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, sl + (e.clientX - sx)));
      const top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, st + (e.clientY - sy)));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      savePanelPos(panel);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();


