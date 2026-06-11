// ==UserScript==
// @name         GWPC Popup Blocker
// @namespace    homebot.gwpc-popup-blocker
// @version      1.1.3
// @description  Blocks GWPC alert/confirm/prompt and beforeunload leave-reload prompts across all 3 PolicyCenter hosts.
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-start
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-popup-blocker/gwpc-popup-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-popup-blocker/gwpc-popup-blocker.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = 'GWPC Popup Blocker';
  const VERSION = '1.1.3';
  const PATCH_FLAG = '__HB_GWPC_POPUP_BLOCKER_PATCHED__';
  const LOOP_MS = 250;

  // Only the top frame persists logs (this script runs in every frame via
  // @all-frames for dialog patching). Sub-frames still patch dialogs,
  // they just don't write to the shared log buffer.
  const IS_TOP_FRAME = (() => { try { return window.top === window.self; } catch { return false; } })();

  // Log-export integration — matches storage-tools.user.js discovery rules.
  const LOG_PERSIST_KEY = 'tm_pc_popup_blocker_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  const LOG_MAX_LINES = 60;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';
  let _logs = [];

  function log(msg) {
    if (!IS_TOP_FRAME) return;
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    _logs.unshift(line);
    if (_logs.length > LOG_MAX_LINES) _logs.length = LOG_MAX_LINES;
    persistLogsThrottled();
    try { console.log(`[${SCRIPT_NAME}] ${msg}`); } catch {}
  }

  function persistLogsThrottled() {
    if (!IS_TOP_FRAME) return;
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
    if (!IS_TOP_FRAME) return;
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
    if (!IS_TOP_FRAME) return;
    persistLogsThrottled();
    checkLogClearRequest();
  }

  boot();

  function boot() {
    patchWindow(window);
    if (IS_TOP_FRAME) {
      log(`Loaded v${VERSION}`);
      setInterval(logsTick, LOG_TICK_MS);
      window.addEventListener('storage', handleLogClearStorageEvent, true);
      persistLogsThrottled();
    }

    setInterval(() => {
      try {
        for (const win of getAllWindows()) {
          patchWindow(win);
          clearUnloadHooks(win);
        }
      } catch {}
    }, LOOP_MS);
  }

  function getAllWindows(root = null, out = []) {
    const base = root || safeTopWindow() || window;
    out.push(base);

    let frames = [];
    try {
      frames = Array.from(base.frames || []);
    } catch {}

    for (const fr of frames) {
      try {
        if (!fr || fr === base) continue;
        void fr.document;
        getAllWindows(fr, out);
      } catch {}
    }

    return dedupeWindows(out);
  }

  function dedupeWindows(list) {
    const out = [];
    const seen = new Set();

    for (const win of list) {
      try {
        const key = String(win.location.href) + '|' + String(Math.random());
        if (seen.has(win)) continue;
        seen.add(win);
        out.push(win);
        void key;
      } catch {
        if (!seen.has(win)) {
          seen.add(win);
          out.push(win);
        }
      }
    }

    return out;
  }

  function safeTopWindow() {
    try {
      return window.top || window;
    } catch {
      return window;
    }
  }

  function patchWindow(win) {
    if (!win) return;

    try {
      if (!win[PATCH_FLAG]) {
        win[PATCH_FLAG] = true;

        patchDialogs(win);
        patchBeforeUnloadProperty(win);
        patchWindowAddEventListener(win);
        installCaptureBlocker(win);
      }

      clearUnloadHooks(win);
      patchDialogs(win);
    } catch {}
  }

  function patchDialogs(win) {
    try {
      win.alert = function () {};
    } catch {}

    try {
      win.confirm = function () {
        return true;
      };
    } catch {}

    try {
      win.prompt = function (_msg, defValue = '') {
        return String(defValue ?? '');
      };
    } catch {}
  }

  function patchBeforeUnloadProperty(win) {
    try {
      Object.defineProperty(win, 'onbeforeunload', {
        configurable: true,
        enumerable: true,
        get() {
          return null;
        },
        set(_value) {
          return true;
        }
      });
    } catch {
      try { win.onbeforeunload = null; } catch {}
    }
  }

  function patchWindowAddEventListener(win) {
    try {
      if (win.__HB_GWPC_POPUP_BLOCKER_ADD_LISTENER_PATCHED__) return;
      win.__HB_GWPC_POPUP_BLOCKER_ADD_LISTENER_PATCHED__ = true;

      const nativeAdd = win.addEventListener.bind(win);
      const nativeRemove = win.removeEventListener.bind(win);

      win.addEventListener = function (type, listener, options) {
        const t = String(type || '').toLowerCase();

        if (t === 'beforeunload') {
          return;
        }

        return nativeAdd(type, listener, options);
      };

      win.removeEventListener = function (type, listener, options) {
        const t = String(type || '').toLowerCase();

        if (t === 'beforeunload') {
          return;
        }

        return nativeRemove(type, listener, options);
      };
    } catch {}
  }

  function installCaptureBlocker(win) {
    try {
      if (win.__HB_GWPC_POPUP_BLOCKER_CAPTURE_INSTALLED__) return;
      win.__HB_GWPC_POPUP_BLOCKER_CAPTURE_INSTALLED__ = true;

      win.addEventListener('beforeunload', function (e) {
        try { e.stopImmediatePropagation(); } catch {}
        try { e.stopPropagation(); } catch {}
        try { e.preventDefault(); } catch {}
        try { e.returnValue = undefined; } catch {}
        return undefined;
      }, true);
    } catch {}
  }

  function clearUnloadHooks(win) {
    try { win.onbeforeunload = null; } catch {}

    try {
      if (win.document) {
        win.document.onbeforeunload = null;
      }
    } catch {}

    try {
      if (win.document && win.document.body) {
        win.document.body.onbeforeunload = null;
      }
    } catch {}

    try {
      if (win.document && win.document.documentElement) {
        win.document.documentElement.onbeforeunload = null;
      }
    } catch {}
  }

  try {
    console.log(`[${SCRIPT_NAME}] running`);
  } catch {}

})();
