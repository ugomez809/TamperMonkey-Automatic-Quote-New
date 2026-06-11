// ==UserScript==
// @name         GWPC Unsaved Change Discard Clicker
// @namespace    homebot.gwpc-discard-unsaved-change
// @version      1.0.3
// @description  When the GWPC "Discard Unsaved Change" action becomes visible, clicks it automatically.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-discard-unsaved-change/gwpc-discard-unsaved-change.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-discard-unsaved-change/gwpc-discard-unsaved-change.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = 'GWPC Unsaved Change Discard Clicker';
  const VERSION = '1.0.3';

  // Log-export integration — matches storage-tools.user.js discovery rules.
  const LOG_PERSIST_KEY = 'tm_pc_discard_unsaved_change_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  const LOG_MAX_LINES = 140;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';
  let _logs = [];

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    _logs.unshift(line);
    if (_logs.length > LOG_MAX_LINES) _logs.length = LOG_MAX_LINES;
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
      lines: _logs.slice()
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
    _logs.length = 0;
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

  const TARGET_TEXT = 'Discard Unsaved Change';
  const ERROR_NEEDLE = 'Please cancel and retry your change.';
  const SCAN_MS = 300;
  const CLICK_COOLDOWN_MS = 1200;

  let lastClickAt = 0;
  let observer = null;
  let scanTimer = null;

  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width === 0 || rect.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    if (el.closest?.('[aria-hidden="true"]')) return false;
    return true;
  };

  function* allDocs() {
    yield document;
    for (const f of document.querySelectorAll('iframe, frame')) {
      try {
        const d = f.contentDocument || f.contentWindow?.document;
        if (d) yield d;
      } catch {}
    }
  }

  function norm(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function strongClick(el) {
    try {
      el.scrollIntoView?.({ block: 'center', inline: 'center' });
      el.focus?.({ preventScroll: true });
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.click?.();
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
      return true;
    } catch {
      return false;
    }
  }

  function findDiscardAction() {
    for (const doc of allDocs()) {
      const nodes = Array.from(doc.querySelectorAll('.gw-message--action-suffix'));
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        if (norm(el.textContent) !== TARGET_TEXT) continue;

        const msgWrap =
          el.closest('.gw-message--displayable') ||
          el.closest('.gw-WebMessage') ||
          el.closest('.gw-message-and-suffix') ||
          el.parentElement;

        const wrapText = norm(msgWrap?.textContent || '');
        if (wrapText.includes(ERROR_NEEDLE) || wrapText.includes(TARGET_TEXT)) {
          return el;
        }
      }
    }
    return null;
  }

  function tick() {
    const now = Date.now();
    if (now - lastClickAt < CLICK_COOLDOWN_MS) return;

    const target = findDiscardAction();
    if (!target) return;

    if (strongClick(target)) {
      lastClickAt = now;
      log('Clicked "Discard Unsaved Change" action');
    }
  }

  function init() {
    log(`Loaded v${VERSION}`);
    scanTimer = setInterval(tick, SCAN_MS);
    setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();

    observer = new MutationObserver(() => {
      tick();
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    document.addEventListener('visibilitychange', tick, true);
    window.addEventListener('focus', tick, true);

    tick();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
