// ==UserScript==
// @name         APEX Multi-Agency Continue
// @namespace    homebot.apex-multi-agency-continue
// @version      1.0.2
// @description  Detects the Salesforce Multi-Agency flow and clicks Next automatically when it appears.
// @match        https://farmersagent.my.salesforce.com/*
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Apex-LEX/apex-multi-agency-continue/apex-multi-agency-continue.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Apex-LEX/apex-multi-agency-continue/apex-multi-agency-continue.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'APEX Multi-Agency Continue';
  const VERSION = '1.0.2';

  // Log-export integration â€” matches storage-tools.user.js discovery rules.
  const LOG_PERSIST_KEY = 'tm_apex_multi_agency_continue_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  const LOG_MAX_LINES = 140;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';
  const PROMPT_NEEDLES = [
    'you have been identified as a multi-agency user',
    'please choose the agency you would like to work in for this'
  ];
  const BUTTON_LABEL = 'next';
  const SCAN_MS = 400;
  const ROUTE_WATCH_MS = 700;
  const CLICK_COOLDOWN_MS = 3000;

  const state = {
    observer: null,
    routeTimer: 0,
    scanTimer: 0,
    queuedTick: 0,
    lastUrl: location.href,
    lastAttemptSignature: '',
    lastAttemptAt: 0,
    logs: [],
    logsIntervalTimer: null
  };

  boot();

  function boot() {
    log(`Started v${VERSION}`);

    queueTick();
    state.scanTimer = setInterval(queueTick, SCAN_MS);
    state.routeTimer = setInterval(watchRoute, ROUTE_WATCH_MS);

    document.addEventListener('visibilitychange', queueTick, true);
    window.addEventListener('focus', queueTick, true);
    window.addEventListener('pageshow', queueTick, true);

    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();

    installObserver();
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift(line);
    if (state.logs.length > LOG_MAX_LINES) state.logs.length = LOG_MAX_LINES;
    persistLogsThrottled();
    try { console.log(`[${SCRIPT_NAME}] ${msg}`); } catch {}
  }

  function persistLogsThrottled() {
    const now = Date.now();
    if (now - _lastLogPersistAt < LOG_PERSIST_THROTTLE_MS) return;
    _lastLogPersistAt = now;
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      origin: location.origin,
      updatedAt: new Date().toISOString(),
      lines: state.logs.slice()
    };
    try { localStorage.setItem(LOG_PERSIST_KEY, JSON.stringify(payload)); } catch {}
    try { if (typeof GM_setValue === 'function') GM_setValue(LOG_PERSIST_KEY, payload); } catch {}
  }

  function checkLogClearRequest() {
    let req = null;
    try { req = JSON.parse(localStorage.getItem(LOG_CLEAR_SIGNAL_KEY) || 'null'); } catch {}
    if (!req) {
      try { if (typeof GM_getValue === 'function') req = GM_getValue(LOG_CLEAR_SIGNAL_KEY, null); } catch {}
    }
    const at = typeof req?.requestedAt === 'string' ? req.requestedAt : '';
    if (!at || at === _lastLogClearHandledAt) return;
    _lastLogClearHandledAt = at;
    state.logs.length = 0;
    _lastLogPersistAt = 0;
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

  function now() {
    return Date.now();
  }

  function norm(value) {
    return String(value || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lower(value) {
    return norm(value).toLowerCase();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element) || !el.isConnected) return false;

    try {
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function isEnabled(el) {
    if (!el || !(el instanceof Element)) return false;
    return !(
      el.disabled ||
      el.getAttribute('disabled') !== null ||
      el.getAttribute('aria-disabled') === 'true'
    );
  }

  function getButtonLabel(el) {
    if (!el || !(el instanceof Element)) return '';
    return lower([
      el.textContent,
      el.value,
      el.getAttribute('title'),
      el.getAttribute('aria-label'),
      el.getAttribute('label'),
      el.getAttribute('name')
    ].filter(Boolean).join(' '));
  }

  function getAllRoots(startRoot = document) {
    const out = [];
    const seen = new WeakSet();

    function walk(root) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      out.push(root);

      let nodes = [];
      try {
        if (
          root instanceof Document ||
          root instanceof ShadowRoot ||
          root instanceof Element
        ) {
          nodes = Array.from(root.querySelectorAll('*'));
        }
      } catch {
        nodes = [];
      }

      for (const node of nodes) {
        try {
          if (node.shadowRoot) walk(node.shadowRoot);
        } catch {}
      }
    }

    walk(startRoot);
    return out;
  }

  function deepQueryAll(selector, startRoot = document) {
    const out = [];
    const seen = new WeakSet();

    for (const root of getAllRoots(startRoot)) {
      let found = [];
      try {
        found = root.querySelectorAll(selector);
      } catch {}

      for (const el of found) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
    }

    return out;
  }

  function findAncestorAcrossRoots(el, predicate) {
    let cur = el;

    while (cur) {
      if (cur instanceof Element && predicate(cur)) return cur;

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

    return null;
  }

  function matchesPromptText(text) {
    const haystack = lower(text);
    return PROMPT_NEEDLES.every(needle => haystack.includes(needle));
  }

  function findNextButton(scope) {
    const candidates = deepQueryAll('button, [role="button"], input[type="button"], input[type="submit"]', scope);

    for (const el of candidates) {
      if (!isVisible(el) || !isEnabled(el)) continue;
      if (getButtonLabel(el) !== BUTTON_LABEL) continue;
      return el;
    }

    return null;
  }

  function selectedOptionText(select) {
    try {
      const option = select?.selectedOptions?.[0] || select?.options?.[select.selectedIndex] || null;
      return norm(option?.textContent || option?.label || '');
    } catch {
      return '';
    }
  }

  function buildPromptSignature(container, select) {
    return [
      location.pathname,
      location.search,
      location.hash,
      norm(select?.value || ''),
      selectedOptionText(select),
      norm(container?.textContent || '').slice(0, 240)
    ].join('|');
  }

  function findPrompt() {
    const selects = deepQueryAll('select[name="prodIdSel"]');

    for (const select of selects) {
      if (!isVisible(select) || !isEnabled(select)) continue;

      const container = findAncestorAcrossRoots(select, (el) => {
        if (!(el instanceof Element) || !isVisible(el)) return false;
        if (!matchesPromptText(el.textContent || '')) return false;
        return !!findNextButton(el);
      });

      if (!container) continue;

      const button = findNextButton(container);
      if (!button) continue;

      return {
        container,
        select,
        button,
        signature: buildPromptSignature(container, select)
      };
    }

    return null;
  }

  function strongClick(el) {
    if (!el) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + Math.max(2, Math.min(rect.width / 2, Math.max(2, rect.width - 2)));
    const clientY = rect.top + Math.max(2, Math.min(rect.height / 2, Math.max(2, rect.height - 2)));

    const mouseInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: 0
    };

    try {
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        clientX,
        clientY,
        button: 0
      }));
    } catch {}

    try { el.dispatchEvent(new MouseEvent('mousedown', mouseInit)); } catch {}

    try {
      el.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        clientX,
        clientY,
        button: 0
      }));
    } catch {}

    try { el.dispatchEvent(new MouseEvent('mouseup', mouseInit)); } catch {}
    try { el.dispatchEvent(new MouseEvent('click', mouseInit)); } catch {}

    try {
      el.click?.();
      return true;
    } catch {
      return false;
    }
  }

  function queueTick() {
    clearTimeout(state.queuedTick);
    state.queuedTick = setTimeout(tick, 50);
  }

  function watchRoute() {
    if (location.href === state.lastUrl) return;
    state.lastUrl = location.href;
    state.lastAttemptSignature = '';
    state.lastAttemptAt = 0;
    queueTick();
  }

  function installObserver() {
    try { state.observer?.disconnect(); } catch {}

    state.observer = new MutationObserver(() => {
      queueTick();
    });

    const root = document.documentElement || document.body;
    if (!root) return;

    state.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }

  function tick() {
    const prompt = findPrompt();

    if (!prompt) {
      state.lastAttemptSignature = '';
      state.lastAttemptAt = 0;
      return;
    }

    if (
      prompt.signature === state.lastAttemptSignature &&
      (now() - state.lastAttemptAt) < CLICK_COOLDOWN_MS
    ) {
      return;
    }

    state.lastAttemptSignature = prompt.signature;
    state.lastAttemptAt = now();

    const selected = selectedOptionText(prompt.select);
    log(`Multi-Agency flow detected${selected ? ` for ${selected}` : ''}. Clicking Next.`);
    strongClick(prompt.button);
  }
})();

