// ==UserScript==
// @name         APEX Duplicate Check Continue
// @namespace    homebot.apex-duplicates-continue
// @version      1.8.5
// @description  Detects Duplicates Found inside APEX, selects the first duplicate, waits for Continue to enable, then clicks Continue. Keeps the same flow, with stronger Chrome-safe detection and fallback scanning, and force-closes the tab after one minute.
// @author       OpenAI
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Apex-LEX/apex-duplicates-continue/apex-duplicates-continue.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Apex-LEX/apex-duplicates-continue/apex-duplicates-continue.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__APEX_DUPLICATES_CONTINUE_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'APEX Duplicate Check Continue';
  const VERSION = '1.8.5';

  // Log-export integration â€” this script's log() renders directly to DOM
  // without an in-memory array, so we add state.logLines below in parallel
  // and persist it to a tracked key for storage-tools to discover.
  const LOG_PERSIST_KEY = 'tm_apex_duplicates_continue_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';

  const KEYS = {
    PANEL_POS: 'tm_apex_duplicates_continue_panel_pos_v18',
    LAST_HANDLED: 'tm_apex_duplicates_continue_last_handled_v18'
  };

  const CFG = {
    scanMs: 700,
    debounceMs: 100,
    afterRadioMs: 220,
    continueWaitMs: 7000,
    continuePollMs: 120,
    handledCooldownMs: 15000,
    routeWatchMs: 700,
    observerRefreshMs: 4000,
    maxLogs: 14,
    forceCloseAfterMs: 60000,
    forceClosePollMs: 1000,
    forceCloseRetryMs: 900,
    maxCloseAttempts: 4
  };

  const state = {
    running: true,
    busy: false,
    destroyed: false,
    waitingLogged: false,
    scanTimer: null,
    scanIntervalTimer: null,
    logsIntervalTimer: null,
    ui: null,
    observers: [],
    lastUrl: location.href,
    observerHeartbeat: null,
    routeTimer: null,
    forceCloseDeadlineAt: 0,
    forceCloseTriggered: false,
    forceCloseAttempts: 0,
    forceCloseTimer: null,
    logLines: []
  };

  /******************************************************************
   * UI
   ******************************************************************/
  function createUI() {
    if (document.getElementById('hb-dup-v18-panel')) return;

    const style = document.createElement('style');
    style.id = 'hb-dup-v18-style';
    style.textContent = `
      #hb-dup-v18-panel{
        position:fixed;
        right:12px;
        bottom:12px;
        width:320px;
        background:rgba(18,22,28,.97);
        color:#fff;
        border:1px solid rgba(255,255,255,.14);
        border-radius:12px;
        z-index:2147483647;
        font:12px/1.35 Arial,sans-serif;
        box-shadow:0 10px 26px rgba(0,0,0,.34);
        overflow:hidden;
      }
      #hb-dup-v18-head{
        padding:8px 10px;
        background:rgba(255,255,255,.06);
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        cursor:move;
        user-select:none;
      }
      #hb-dup-v18-title{font-weight:700}
      #hb-dup-v18-ver{font-size:11px;opacity:.8}
      #hb-dup-v18-status{font-size:11px;font-weight:700}
      #hb-dup-v18-body{padding:8px 10px 10px}
      #hb-dup-v18-toggle{
        width:100%;
        border:0;
        border-radius:8px;
        padding:7px 10px;
        font-weight:700;
        color:#fff;
        cursor:pointer;
      }
      #hb-dup-v18-logs{
        margin-top:8px;
        max-height:150px;
        overflow:auto;
      }
      .hb-dup-v18-log{
        padding:5px 0;
        border-top:1px solid rgba(255,255,255,.08);
        word-break:break-word;
      }
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'hb-dup-v18-panel';
    panel.innerHTML = `
      <div id="hb-dup-v18-head">
        <div>
          <div id="hb-dup-v18-title">${SCRIPT_NAME}</div>
          <div id="hb-dup-v18-ver">V${VERSION}</div>
        </div>
        <div id="hb-dup-v18-status">RUNNING</div>
      </div>
      <div id="hb-dup-v18-body">
        <button id="hb-dup-v18-toggle" type="button">STOP</button>
        <div id="hb-dup-v18-logs"></div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    state.ui = {
      panel,
      head: panel.querySelector('#hb-dup-v18-head'),
      status: panel.querySelector('#hb-dup-v18-status'),
      toggle: panel.querySelector('#hb-dup-v18-toggle'),
      logs: panel.querySelector('#hb-dup-v18-logs')
    };

    state.ui.toggle.addEventListener('click', () => {
      setRunning(!state.running);
    });

    makeDraggable(state.ui.panel, state.ui.head);
    restorePanelPosition(state.ui.panel);
    syncUI();
  }

  function syncUI() {
    if (!state.ui) return;
    state.ui.status.textContent = state.running ? 'RUNNING' : 'STOPPED';
    state.ui.status.style.color = state.running ? '#8df0a1' : '#ffb0b0';
    state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
    state.ui.toggle.style.background = state.running ? '#c62828' : '#2e7d32';
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
    }, true);

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      savePanelPosition(panel);
    }, true);
  }

  function savePanelPosition(panel) {
    try {
      const r = panel.getBoundingClientRect();
      localStorage.setItem(KEYS.PANEL_POS, JSON.stringify({ left: r.left, top: r.top }));
    } catch {}
  }

  function restorePanelPosition(panel) {
    try {
      const raw = localStorage.getItem(KEYS.PANEL_POS);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
      panel.style.left = `${Math.max(0, pos.left)}px`;
      panel.style.top = `${Math.max(0, pos.top)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    } catch {}
  }

  /******************************************************************
   * Helpers
   ******************************************************************/
  function setRunning(next) {
    state.running = !!next;
    syncUI();
    log(state.running ? 'Started' : 'Stopped for this page load');
    if (state.running) queueScan(30);
  }

  function log(msg) {
    try { console.log(`[${SCRIPT_NAME}] ${msg}`); } catch {}

    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logLines.unshift(line);
    if (state.logLines.length > CFG.maxLogs) state.logLines.length = CFG.maxLogs;
    persistLogsThrottled();

    if (!state.ui?.logs) return;

    const row = document.createElement('div');
    row.className = 'hb-dup-v18-log';
    row.textContent = line;
    state.ui.logs.prepend(row);

    while (state.ui.logs.children.length > CFG.maxLogs) {
      state.ui.logs.removeChild(state.ui.logs.lastChild);
    }
  }

  function persistLogsThrottled() {
    if (state.destroyed) return;
    const now = Date.now();
    if (now - _lastLogPersistAt < LOG_PERSIST_THROTTLE_MS) return;
    _lastLogPersistAt = now;
    const raw = Array.isArray(state.logLines) ? state.logLines : [];
    const lines = raw.map(entry => (typeof entry === 'string' ? entry : (entry?.line || '')));
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      origin: location.origin,
      updatedAt: new Date().toISOString(),
      lines
    };
    try { localStorage.setItem(LOG_PERSIST_KEY, JSON.stringify(payload)); } catch {}
    try { if (typeof GM_setValue === 'function') GM_setValue(LOG_PERSIST_KEY, payload); } catch {}
  }

  function checkLogClearRequest() {
    if (state.destroyed) return;
    let req = null;
    try { req = JSON.parse(localStorage.getItem(LOG_CLEAR_SIGNAL_KEY) || 'null'); } catch {}
    if (!req) {
      try { if (typeof GM_getValue === 'function') req = GM_getValue(LOG_CLEAR_SIGNAL_KEY, null); } catch {}
    }
    const at = typeof req?.requestedAt === 'string' ? req.requestedAt : '';
    if (!at || at === _lastLogClearHandledAt) return;
    _lastLogClearHandledAt = at;
    state.logLines.length = 0;
    _lastLogPersistAt = 0;
    if (state.ui?.logs) {
      while (state.ui.logs.firstChild) state.ui.logs.removeChild(state.ui.logs.firstChild);
    }
    persistLogsThrottled();
  }

  function handleLogClearStorageEvent(event) {
    if (!event || event.key !== LOG_CLEAR_SIGNAL_KEY) return;
    checkLogClearRequest();
  }

  function logsTick() {
    if (state.destroyed) return;
    persistLogsThrottled();
    checkLogClearRequest();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function tryCloseCurrentTab() {
    const wasClosed = !!window.closed;
    try { window.close(); } catch {}
    if (window.closed || wasClosed) return;

    try { window.open(location.href, '_self'); } catch {}
    try { window.close(); } catch {}
    if (window.closed) return;

    try { window.open('', '_self'); } catch {}
    try { window.close(); } catch {}
    if (window.closed) return;

    try { window.top?.close?.(); } catch {}
    if (window.closed) return;

    setTimeout(() => {
      if (window.closed) return;
      try { location.replace('about:blank'); } catch {}
      setTimeout(() => {
        try { window.close(); } catch {}
      }, 100);
    }, 350);
  }

  function triggerForceClose(reason = '') {
    if (!state.forceCloseTriggered) {
      state.forceCloseTriggered = true;
      if (reason) log(reason);
    }

    state.forceCloseAttempts += 1;
    log(`Force-close attempt ${state.forceCloseAttempts}/${CFG.maxCloseAttempts}`);
    tryCloseCurrentTab();

    if (state.forceCloseAttempts >= CFG.maxCloseAttempts) return;

    setTimeout(() => {
      if (window.closed) return;
      triggerForceClose('');
    }, CFG.forceCloseRetryMs);
  }

  function maybeTriggerForceClose() {
    if (state.forceCloseTriggered) return;
    if (!state.forceCloseDeadlineAt) return;
    if (Date.now() < state.forceCloseDeadlineAt) return;
    triggerForceClose('1-minute failsafe reached. Closing tab.');
  }

  function armForceCloseFailsafe() {
    if (state.forceCloseDeadlineAt) return;
    state.forceCloseDeadlineAt = Date.now() + CFG.forceCloseAfterMs;
    state.forceCloseTriggered = false;
    state.forceCloseAttempts = 0;
    log('1-minute failsafe armed');

    clearInterval(state.forceCloseTimer);
    state.forceCloseTimer = setInterval(maybeTriggerForceClose, CFG.forceClosePollMs);

    document.addEventListener('visibilitychange', maybeTriggerForceClose, true);
    window.addEventListener('focus', maybeTriggerForceClose, true);
    window.addEventListener('pageshow', maybeTriggerForceClose, true);
  }

  function textOf(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function lower(v) {
    return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    try {
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (style.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch {
      return false;
    }
  }

  function isEnabled(el) {
    return !!(el && !el.disabled && el.getAttribute('disabled') == null && el.getAttribute('aria-disabled') !== 'true');
  }

  function isRadioChecked(radio) {
    return !!(radio && radio.checked);
  }

  function wasHandledRecently(token) {
    try {
      const raw = sessionStorage.getItem(KEYS.LAST_HANDLED);
      if (!raw) return false;
      const last = JSON.parse(raw);
      return !!(last && last.token === token && (Date.now() - last.at) < CFG.handledCooldownMs);
    } catch {
      return false;
    }
  }

  function markHandled(token) {
    try {
      sessionStorage.setItem(KEYS.LAST_HANDLED, JSON.stringify({ token, at: Date.now() }));
    } catch {}
  }

  function safePointerEvent(type, view) {
    try {
      if (typeof view.PointerEvent === 'function') {
        return new view.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
          buttons: 1,
          pointerType: 'mouse'
        });
      }
    } catch {}
    return null;
  }

  function strongClick(el) {
    if (!el) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }

    const doc = el.ownerDocument || document;
    const view = doc.defaultView || window;

    const events = [
      safePointerEvent('pointerover', view),
      new view.MouseEvent('mouseover', { bubbles: true, cancelable: true, composed: true, view }),
      safePointerEvent('pointerdown', view),
      new view.MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, view }),
      safePointerEvent('pointerup', view),
      new view.MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, view }),
      new view.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view })
    ].filter(Boolean);

    try {
      for (const ev of events) el.dispatchEvent(ev);
      if (typeof el.click === 'function') el.click();
      return true;
    } catch {
      return false;
    }
  }

  function getAllRoots() {
    const roots = [];
    const seen = new WeakSet();

    function walk(root) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      roots.push(root);

      let els = [];
      try {
        els = Array.from(root.querySelectorAll('*'));
      } catch {
        els = [];
      }

      for (const el of els) {
        try {
          if (el.shadowRoot) walk(el.shadowRoot);
        } catch {}
        try {
          if (el.tagName === 'IFRAME' && el.contentDocument) walk(el.contentDocument);
        } catch {}
      }
    }

    walk(document);
    return roots;
  }

  function deepQueryAll(selector, preferredRoot = null) {
    const out = [];
    const seen = new WeakSet();
    const roots = preferredRoot ? [preferredRoot] : getAllRoots();

    for (const root of roots) {
      let found = [];
      try {
        found = Array.from(root.querySelectorAll(selector));
      } catch {
        found = [];
      }

      for (const el of found) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
    }

    return out;
  }

  function firstVisible(nodes) {
    return nodes.find(isVisible) || null;
  }

  function findClosestClickable(el) {
    let cur = el;
    while (cur) {
      if (cur instanceof Element && cur.matches('button, a, label, [role="button"], tr, td, span, div')) {
        return cur;
      }
      if (cur instanceof Element && cur.parentElement) {
        cur = cur.parentElement;
        continue;
      }
      const root = cur?.getRootNode?.();
      if (root instanceof ShadowRoot) {
        cur = root.host;
        continue;
      }
      break;
    }
    return el instanceof Element ? el : null;
  }

  /******************************************************************
   * Exact path first
   ******************************************************************/
  function getExactTargets() {
    const host1 = document.querySelector('c-home-prime-segment-new');
    const sr1 = host1?.shadowRoot;
    const host2 = sr1?.querySelector('c-quote-new-account');
    const sr2 = host2?.shadowRoot;
    const dupHost = sr2?.querySelector('c-duplicate-prospects-component, c-duplicateprospectscomponent');
    const dupRoot = dupHost?.shadowRoot || dupHost || null;

    if (!dupHost || !dupRoot) return null;
    if (!isVisible(dupHost)) return null;

    const firstRow = dupRoot.querySelector('tbody tr') || null;
    const radio =
      firstRow?.querySelector('input[type="radio"][data-name="prospect"][name="radioGrp"]') ||
      firstRow?.querySelector('input[type="radio"][data-name="prospect"]') ||
      firstRow?.querySelector('input[type="radio"]') ||
      dupRoot.querySelector('input[type="radio"][data-name="prospect"][name="radioGrp"]') ||
      dupRoot.querySelector('input[type="radio"]') ||
      null;

    const continueBtn = Array.from(dupRoot.querySelectorAll('button')).find(btn => /^continue$/i.test(textOf(btn))) || null;

    return {
      mode: 'exact',
      container: dupRoot,
      firstRow,
      radio,
      continueBtn
    };
  }

  /******************************************************************
   * Deep fallback
   ******************************************************************/
  function looksLikeDuplicateContainer(el) {
    if (!el || !isVisible(el)) return false;
    const txt = lower(textOf(el));
    if (!txt) return false;
    const hasDupTitle = txt.includes('duplicate accounts') || txt.includes('duplicates found');
    const hasRadio = deepQueryAll('input[type="radio"]', el).length > 0;
    const hasContinue = deepQueryAll('button, a, [role="button"]', el).some(btn => /\bcontinue\b/i.test(textOf(btn)));
    return hasDupTitle && (hasRadio || hasContinue);
  }

  function findFallbackContainer() {
    const directHost = document.querySelector('c-duplicate-prospects-component, c-duplicateprospectscomponent');
    if (directHost && isVisible(directHost)) {
      return directHost.shadowRoot || directHost;
    }

    const candidates = deepQueryAll('section.slds-modal, .slds-modal, lightning-card, .slds-card, [role="dialog"], c-quote-new-account, div');

    for (const el of candidates) {
      if (looksLikeDuplicateContainer(el)) return el;
    }

    const tables = deepQueryAll('table');
    for (const table of tables) {
      if (!isVisible(table)) continue;
      const hasRadio = !!firstVisible(Array.from(table.querySelectorAll('input[type="radio"]')));
      if (!hasRadio) continue;

      let cur = table;
      for (let i = 0; i < 8 && cur; i += 1) {
        if (looksLikeDuplicateContainer(cur)) return cur;
        cur = cur.parentElement || cur.getRootNode?.()?.host || null;
      }
    }

    return null;
  }

  function getFallbackTargets() {
    const container = findFallbackContainer();
    if (!container) return null;

    const tbody = firstVisible(deepQueryAll('tbody', container));
    const firstRow = tbody ? firstVisible(Array.from(tbody.querySelectorAll('tr'))) : null;
    const radio =
      firstRow?.querySelector('input[type="radio"][data-name="prospect"][name="radioGrp"]') ||
      firstRow?.querySelector('input[type="radio"][name="radioGrp"]') ||
      firstRow?.querySelector('input[type="radio"]') ||
      firstVisible(deepQueryAll('input[type="radio"][data-name="prospect"][name="radioGrp"]', container)) ||
      firstVisible(deepQueryAll('input[type="radio"]', container)) ||
      null;

    const continueBtn = firstVisible(
      deepQueryAll('button, a, [role="button"]', container).filter(el => /^continue$/i.test(textOf(el)) || /\bcontinue\b/i.test(textOf(el)))
    );

    if (!radio && !continueBtn) return null;

    return {
      mode: 'fallback',
      container,
      firstRow,
      radio,
      continueBtn
    };
  }

  function getTargets() {
    return getExactTargets() || getFallbackTargets();
  }

  function makeToken(targets) {
    const rowText = textOf(targets?.firstRow || targets?.container).slice(0, 180);
    const title = targets?.radio?.getAttribute('data-title') || '';
    const hhid = targets?.radio?.getAttribute('data-hhid') || '';
    return `duplicates|${targets?.mode || 'unknown'}|${title}|${hhid}|${rowText}`;
  }

  function forceSelectRadio(radio) {
    if (!radio) return false;

    const doc = radio.ownerDocument || document;
    const view = doc.defaultView || window;

    try {
      const proto = Object.getPrototypeOf(radio);
      const desc = Object.getOwnPropertyDescriptor(proto, 'checked');
      if (desc?.set) desc.set.call(radio, true);
      else radio.checked = true;
    } catch {
      try { radio.checked = true; } catch {}
    }

    try {
      radio.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
    } catch {}

    try {
      radio.dispatchEvent(new view.Event('change', { bubbles: true, composed: true }));
    } catch {}

    strongClick(radio);
    return isRadioChecked(radio);
  }

  async function selectFirstRadio(targets) {
    const radio = targets?.radio;
    if (!radio) return false;

    const row = targets.firstRow || radio.closest('tr') || null;
    const label =
      row?.querySelector('label') ||
      row?.querySelector('span') ||
      row?.querySelector('td:nth-child(3) a') ||
      findClosestClickable(radio);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      log(`Selecting first radio attempt ${attempt}`);

      if (forceSelectRadio(radio)) return true;

      if (label) strongClick(label);
      await sleep(CFG.afterRadioMs);

      if (forceSelectRadio(radio)) return true;
      await sleep(CFG.afterRadioMs);
    }

    return isRadioChecked(radio);
  }

  function findContinueIn(targets) {
    const local = targets?.container
      ? deepQueryAll('button, a, [role="button"]', targets.container).filter(el => /^continue$/i.test(textOf(el)) || /\bcontinue\b/i.test(textOf(el)))
      : [];

    return firstVisible(local.filter(isEnabled)) || firstVisible(local) || null;
  }

  async function waitForContinueEnabled(targets) {
    const end = Date.now() + CFG.continueWaitMs;

    while (Date.now() < end) {
      const btn = findContinueIn(targets) || targets?.continueBtn || null;

      if (btn && isVisible(btn) && isEnabled(btn)) {
        return btn;
      }

      if (targets?.radio && !isRadioChecked(targets.radio)) {
        forceSelectRadio(targets.radio);
      }

      await sleep(CFG.continuePollMs);
    }

    return null;
  }

  async function clickContinue(btn) {
    if (!btn) return false;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      log(`Clicking Continue attempt ${attempt}`);
      if (strongClick(btn)) return true;
      await sleep(180);
    }

    return false;
  }

  /******************************************************************
   * Observers
   ******************************************************************/
  function disconnectObservers() {
    for (const obs of state.observers) {
      try { obs.disconnect(); } catch {}
    }
    state.observers = [];
  }

  function installObservers() {
    disconnectObservers();

    for (const root of getAllRoots()) {
      try {
        const obs = new MutationObserver(() => queueScan(40));
        obs.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
        state.observers.push(obs);
      } catch {}
    }
  }

  /******************************************************************
   * Main
   ******************************************************************/
  async function processModal(targets) {
    if (!targets) return false;

    const token = makeToken(targets);
    if (wasHandledRecently(token)) return false;

    if (!targets.radio) {
      log('Duplicates detected, first radio missing');
      return false;
    }

    log(`Duplicates detected (${targets.mode})`);

    const selected = await selectFirstRadio(targets);
    if (!selected) {
      log('Failed to select first radio');
      return false;
    }

    log('First radio selected');
    await sleep(CFG.afterRadioMs);

    const enabledBtn = await waitForContinueEnabled(targets);
    if (!enabledBtn) {
      log('Continue did not enable');
      return false;
    }

    log('Continue enabled');

    const clicked = await clickContinue(enabledBtn);
    if (!clicked) {
      log('Failed to click Continue');
      return false;
    }

    markHandled(token);
    log('Continue clicked');
    return true;
  }

  async function scan() {
    if (!state.running || state.busy) return;
    state.busy = true;

    try {
      const targets = getTargets();
      if (!targets) {
        if (!state.waitingLogged) {
          log('Waiting for Duplicates Found');
          state.waitingLogged = true;
        }
        return;
      }

      state.waitingLogged = false;
      await processModal(targets);
    } catch (err) {
      log(`Error: ${err?.message || err}`);
    } finally {
      state.busy = false;
    }
  }

  function queueScan(delay = CFG.debounceMs) {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(() => {
      scan().catch(err => log(`Scan error: ${err?.message || err}`));
    }, delay);
  }

  function watchRoute() {
    clearInterval(state.routeTimer);
    state.routeTimer = setInterval(() => {
      if (location.href === state.lastUrl) return;
      state.lastUrl = location.href;
      state.waitingLogged = false;
      log('Route changed');
      installObservers();
      queueScan(60);
    }, CFG.routeWatchMs);
  }

  function startObserverHeartbeat() {
    clearInterval(state.observerHeartbeat);
    state.observerHeartbeat = setInterval(() => {
      if (!state.running) return;
      installObservers();
      if (!state.busy) queueScan(30);
    }, CFG.observerRefreshMs);
  }

  function init() {
    createUI();
    syncUI();
    log('Script started');
    armForceCloseFailsafe();
    installObservers();
    watchRoute();
    startObserverHeartbeat();
    state.scanIntervalTimer = setInterval(() => {
      if (state.destroyed) return;
      queueScan(20);
    }, CFG.scanMs);
    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();
    queueScan(20);
    window.__APEX_DUPLICATES_CONTINUE_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { clearInterval(state.scanIntervalTimer); } catch {}
    try { clearInterval(state.routeTimer); } catch {}
    try { clearInterval(state.observerHeartbeat); } catch {}
    try { clearInterval(state.forceCloseTimer); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { clearTimeout(state.scanTimer); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    state.scanIntervalTimer = null;
    state.routeTimer = null;
    state.observerHeartbeat = null;
    state.forceCloseTimer = null;
    state.logsIntervalTimer = null;
    state.scanTimer = null;
    disconnectObservers();
    try { delete window.__APEX_DUPLICATES_CONTINUE_CLEANUP__; } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

