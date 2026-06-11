// ==UserScript==
// @name         GWPC Header Timeout Monitor
// @namespace    homebot.gwpc-header-timeout
// @version      2.3.23
// @description  Fresh HOME-only GWPC timeout gatherer. Watches the live Guidewire Home header, starts timeout actions ON at page load, clears stale saved-selector artifacts on boot, and raises the shared webhook send signal without closing tabs.
// @author       OpenAI
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-header-timeout/gwpc-header-timeout.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-header-timeout/gwpc-header-timeout.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__TM_GWPC_HEADER_TIMEOUT_CLEANUP__?.(); } catch {}
  if (isAnchorTab()) return;

  const SCRIPT_NAME = 'GWPC Header Timeout Monitor';
  const VERSION = '2.3.23';
  const UI_MARKER_ATTR = 'data-tm-timeout-ui';

  // Log-export integration — matches storage-tools.user.js discovery rules.
  const LOG_PERSIST_KEY = 'tm_pc_header_timeout_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';

  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';
  const LEGACY_SHARED_JOB_KEY = 'tm_shared_az_job_v1';
  const BUNDLE_KEY = 'tm_pc_webhook_bundle_v1';
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';
  const FORCE_SEND_KEY = 'tm_pc_force_send_now_v1';
  const WATCH_ALERT_MESSAGE = 'Bot is not botting. Check it.';

  const KEYS = {
    panelPos: 'tm_pc_header_timeout_panel_pos_v112',
    identityCache: 'tm_pc_header_timeout_identity_cache_v2',
    selectorRules: 'tm_pc_header_timeout_selector_rules_v1',
    homePayload: 'tm_pc_home_quote_grab_payload_v1',
    runtime: 'tm_pc_header_timeout_runtime_v2',
    pendingPost: 'tm_pc_header_timeout_pending_post_v2',
    sentEvents: 'tm_pc_header_timeout_sent_events_v2',
    selectorPauseState: 'tm_pc_header_timeout_selector_pause_state_v1',
    timeoutEnabled: 'tm_pc_header_timeout_enabled_v1',
    watchModeEnabled: 'tm_pc_header_timeout_watch_mode_v1',
    watchPending: 'tm_pc_header_timeout_watch_pending_v1',
    selectorRuleTombstones: 'tm_pc_header_timeout_selector_rule_tombstones_v1',
    sharedRulesClientId: 'tm_pc_header_timeout_shared_rules_client_id_v1',
    watchAlertWebhookUrl: 'tm_pc_header_timeout_watch_alert_webhook_url_v1',
    timeoutTextWebhookUrl: 'tm_pc_header_timeout_text_webhook_url_v1',
    timeoutRetryState: 'tm_pc_header_timeout_retry_state_v1',
    timeoutRetryRequest: 'tm_pc_header_timeout_retry_request_v1',
    timeoutRetryRequestedContext: 'tm_pc_header_timeout_retry_requested_context_v1'
  };

  const CFG = {
    scanMs: 500,
    uiMs: 250,
    bootstrapRetryMs: 500,
    timeoutMs: 120000,
    timeoutRetryLimit: 3,
    timeoutRetryRequestMaxWaitMs: 10000,
    timeoutRetryCloseDelayMs: 800,
    timeoutRetryCloseRetryMs: 1200,
    timeoutRetryCloseAttempts: 6,
    maxLogLines: 140,
    maxSentEvents: 300,
    maxRuleText: 280,
    sharedRulesRefreshMs: 60 * 60 * 1000,
    sharedRulesRequestTimeoutMs: 20000,
    sharedRulesEnabled: true,
    sharedRulesEndpoint: 'https://script.google.com/macros/s/AKfycbxBYCjRnS9aRQoWqlE_fiTOnUGIVyrgU1mabIVCk4YtYThbRd4nSKIDf4gqnRXm-m3TGw/exec',
    sharedRulesKey: 'gwpc-timeout-rules-24apr2026-jkira-91x7p',
    zIndex: 2147483647,
    panelWidth: 320,
    selectorRulesEnabled: true,
    selectorOutlineColor: '#fca5a5',
    selectorFillColor: 'rgba(252,165,165,0.14)',
    observerThrottleMs: 60
  };

  const state = {
    runtimeStarted: false,
    destroyed: false,
    running: true,
    timeoutEnabled: true,
    watchModeEnabled: false,
    watchAlertWebhookBusy: false,
    timeoutTextWebhookBusy: false,
    logs: [],
    els: {},
    panel: null,
    bootstrapTimer: null,
    tickTimer: null,
    uiTimer: null,
    logsIntervalTimer: null,
    sharedRulesSyncTimer: null,
    mutationObserver: null,
    scanQueued: false,
    observeScheduled: false,
    selectorMode: false,
    modalOpen: false,
    manageRulesOpen: false,
    watchAlertOpen: false,
    selectorListeners: [],
    hoverBoxEl: null,
    hoveredEl: null,
    current: {
      azId: '',
      submission: '',
      product: '',
      productLabel: '',
      header: '',
      headerSinceMs: 0,
      pageName: '',
      pageAddress: ''
    },
    lastStatus: '',
    lastHeaderLogKey: '',
    lastStageLogKey: '',
    lastWaitLogKey: '',
    lastUnknownStageKey: '',
    lastSharedRulesSyncAt: 0,
    sharedRulesSyncing: false,
    sharedRulesSyncQueued: false,
    lastSharedRulesSyncError: '',
    bootSharedRulesPending: false,
    savedWatchAlertWebhookUrl: '',
    savedTimeoutTextWebhookUrl: '',
    lastScanAt: 0,
    lastRuntimePersistKey: '',
    pausedAtMs: 0,
    frozenElapsedMs: 0,
    timeoutDispatchInFlightKey: '',
    timeoutRetryCloseAttemptedKey: '',
    selectorSkipLogKeys: new Map(),
    last360ValueLogKeys: new Set()
  };

  function isAnchorTab() {
    try {
      if (sessionStorage.getItem('tm_anchor_role_v1')) return true;
    } catch {}

    try {
      return new URL(location.href).searchParams.get('hb_anchor') === '1';
    } catch {
      return false;
    }
  }

  boot();

  function boot() {
    tryStartRuntime();
    if (state.runtimeStarted) return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryStartRuntime, { once: true });
    }
    window.addEventListener('load', tryStartRuntime, { once: true });
    window.addEventListener('pageshow', tryStartRuntime, { once: true });

    if (state.bootstrapTimer) clearInterval(state.bootstrapTimer);
    state.bootstrapTimer = setInterval(() => {
      tryStartRuntime();
      if (state.runtimeStarted && state.bootstrapTimer) {
        clearInterval(state.bootstrapTimer);
        state.bootstrapTimer = null;
      }
    }, CFG.bootstrapRetryMs);
  }

  function tryStartRuntime() {
    if (state.destroyed) return;
    if (!document.documentElement) return;
    if (!buildUi()) return;

    if (state.runtimeStarted) {
      renderAll();
      return;
    }

    state.runtimeStarted = true;
    const timeoutWasEnabled = readTimeoutEnabled();
    state.timeoutEnabled = true;
    state.watchModeEnabled = readWatchModeEnabled();
    hydrateWatchAlertWebhookStorage();
    hydrateTimeoutTextWebhookStorage();
    restoreStaleSelectorPause();
    clearOwnedSendArtifacts();
    clearLegacyTimeoutProductPayloads();
    clearLegacySelectorRules();
    clearLegacySelectorSentEvents();
    clearLegacySelectorBundleArtifacts();
    clearRuntimeStateForPageLoad();
    writeTimeoutEnabled(true);
    log(`Script started v${VERSION}`);
    log(`Origin: ${location.origin}`);
    if (!timeoutWasEnabled) {
      log('Timeout actions reset to ON at page load');
    }
    log('Fresh timeout gatherer armed');
    if (state.watchModeEnabled) {
      log('Watch mode restored: ON');
    }
    state.bootSharedRulesPending = sharedRulesSyncEnabled();

    scheduleObserve();
    scheduleScan('start');

    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = setInterval(() => {
      try {
        if (state.running) scheduleScan('tick');
      } catch (err) {
        log(`Tick failed: ${err?.message || err}`);
        setStatus('Tick failed');
      }
    }, CFG.scanMs);

    if (state.uiTimer) clearInterval(state.uiTimer);
    state.uiTimer = setInterval(renderAll, CFG.uiMs);

    if (state.logsIntervalTimer) clearInterval(state.logsIntervalTimer);
    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);

    ensureSharedRulesClientId();
    if (state.sharedRulesSyncTimer) clearInterval(state.sharedRulesSyncTimer);
    state.sharedRulesSyncTimer = setInterval(() => {
      scheduleSharedRulesSync('interval');
    }, CFG.sharedRulesRefreshMs);

    window.addEventListener('beforeunload', handleBeforeUnload, true);
    window.addEventListener('pagehide', handleBeforeUnload, true);
    window.addEventListener('resize', keepPanelInView, true);
    document.addEventListener('visibilitychange', handleVisibilityChange, true);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();

    window.__TM_GWPC_HEADER_TIMEOUT_CLEANUP__ = cleanup;
    scheduleSharedRulesSync('boot', { force: true });
    setStatus('Watching header');
    syncWatchAlertFromStorage();
    syncWatchAlertWebhookUi();
    syncTimeoutTextWebhookUi();
    renderAll();
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;

    try { clearInterval(state.bootstrapTimer); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.uiTimer); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { clearInterval(state.sharedRulesSyncTimer); } catch {}
    try { state.mutationObserver?.disconnect(); } catch {}

    try { window.removeEventListener('beforeunload', handleBeforeUnload, true); } catch {}
    try { window.removeEventListener('pagehide', handleBeforeUnload, true); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { document.removeEventListener('visibilitychange', handleVisibilityChange, true); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    try { persistWatchAlertWebhookFromUi(false); } catch {}
    try { persistTimeoutTextWebhookFromUi(false); } catch {}

    closeSelectorSession('', { logIt: false, restorePause: true });
    closeManageRulesModal('', { logIt: false });
    closeWatchAlert('', { logIt: false, preservePending: true });

    try { state.hoverBoxEl?.remove(); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__TM_GWPC_HEADER_TIMEOUT_CLEANUP__; } catch {}
  }

  function $(selector, root = document) {
    try { return root.querySelector(selector); } catch { return null; }
  }

  function $$(selector, root = document) {
    try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
  }

  function safeJsonParse(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function timeNow() {
    try { return new Date().toLocaleTimeString(); }
    catch { return nowIso(); }
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toBoolean(value, fallback = false) {
    const text = String(value == null ? '' : value).toLowerCase().trim();
    if (!text) return !!fallback;
    if (text === 'true' || text === '1' || text === 'yes') return true;
    if (text === 'false' || text === '0' || text === 'no') return false;
    return !!fallback;
  }

  function normalizeCompare(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[\.,#]/g, ' ')
      .replace(/\bstreet\b/g, 'st')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bdrive\b/g, 'dr')
      .replace(/\bcircle\b/g, 'cir')
      .replace(/\bboulevard\b/g, 'blvd')
      .replace(/\blane\b/g, 'ln')
      .replace(/\bplace\b/g, 'pl')
      .replace(/\bcourt\b/g, 'ct')
      .replace(/\bhighway\b/g, 'hwy')
      .replace(/\btrail\b/g, 'trl')
      .replace(/\bterrace\b/g, 'ter')
      .replace(/\bnorth\b/g, 'n')
      .replace(/\bsouth\b/g, 's')
      .replace(/\beast\b/g, 'e')
      .replace(/\bwest\b/g, 'w')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function namesLikelySame(a, b) {
    const aa = normalizeCompare(a);
    const bb = normalizeCompare(b);
    return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
  }

  function addressesLikelySame(a, b) {
    const aa = normalizeCompare(a);
    const bb = normalizeCompare(b);
    return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
  }

  function hashString(str) {
    let h = 0;
    const input = String(str || '');
    for (let i = 0; i < input.length; i += 1) {
      h = ((h << 5) - h) + input.charCodeAt(i);
      h |= 0;
    }
    return `h${Math.abs(h)}`;
  }

  function createEventId() {
    return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function cssEscape(value) {
    const input = String(value || '');
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(input);
    }
    return input.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    try {
      const style = (el.ownerDocument?.defaultView || window).getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '00:00';
    const total = Math.floor(ms / 1000);
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function truncateText(value, max = CFG.maxRuleText) {
    const text = normalizeText(value);
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}...`;
  }

  function truncateMiddle(text, max = 100) {
    const value = String(text || '');
    if (value.length <= max) return value;
    const part = Math.max(12, Math.floor((max - 3) / 2));
    return `${value.slice(0, part)}...${value.slice(-part)}`;
  }

  function normalizeScreenText(value) {
    const raw = String(value == null ? '' : value)
      .replace(/\u00A0/g, ' ')
      .replace(/\r/g, '');
    const lines = raw
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim());

    const out = [];
    let lastBlank = false;
    for (const line of lines) {
      if (!line) {
        if (!lastBlank && out.length) {
          out.push('');
        }
        lastBlank = true;
        continue;
      }
      out.push(line);
      lastBlank = false;
    }
    return out.join('\n').trim();
  }

  function log(message) {
    const line = `[${timeNow()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    if (state.els.logs) {
      state.els.logs.value = state.logs.join('\n');
      state.els.logs.scrollTop = 0;
    }
    persistLogsThrottled();
    console.log(`[${SCRIPT_NAME}] ${message}`);
  }

  function persistLogsThrottled() {
    if (state.destroyed) return;
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
    state.logs.length = 0;
    _lastLogPersistAt = 0;
    if (state.els.logs) state.els.logs.value = '';
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

  function readTimeoutEnabled() {
    try {
      const raw = localStorage.getItem(KEYS.timeoutEnabled);
      if (raw == null || raw === '') return true;
      if (raw === '1' || raw === 'true') return true;
      if (raw === '0' || raw === 'false') return false;
      return true;
    } catch {
      return true;
    }
  }

  function writeTimeoutEnabled(enabled) {
    state.timeoutEnabled = !!enabled;
    try { localStorage.setItem(KEYS.timeoutEnabled, state.timeoutEnabled ? '1' : '0'); } catch {}
    renderButtons();
    renderAll();
    return state.timeoutEnabled;
  }

  function readWatchModeEnabled() {
    try {
      const raw = localStorage.getItem(KEYS.watchModeEnabled);
      if (raw == null || raw === '') return false;
      return raw === '1' || raw === 'true';
    } catch {
      return false;
    }
  }

  function writeWatchModeEnabled(enabled) {
    state.watchModeEnabled = !!enabled;
    try { localStorage.setItem(KEYS.watchModeEnabled, state.watchModeEnabled ? '1' : '0'); } catch {}
    renderButtons();
    renderAll();
    return state.watchModeEnabled;
  }

  function readWatchAlertWebhookUrlFromGM() {
    try {
      return normalizeText(GM_getValue(KEYS.watchAlertWebhookUrl, ''));
    } catch {
      return '';
    }
  }

  function readWatchAlertWebhookUrlFromLocal() {
    try {
      return normalizeText(localStorage.getItem(KEYS.watchAlertWebhookUrl) || '');
    } catch {
      return '';
    }
  }

  function mirrorWatchAlertWebhookUrl(url) {
    const normalized = normalizeText(url);
    try { GM_setValue(KEYS.watchAlertWebhookUrl, normalized); } catch {}
    try { localStorage.setItem(KEYS.watchAlertWebhookUrl, normalized); } catch {}
    try { sessionStorage.setItem(KEYS.watchAlertWebhookUrl, normalized); } catch {}
    state.savedWatchAlertWebhookUrl = normalized;
    return normalized;
  }

  function hydrateWatchAlertWebhookStorage() {
    const gmUrl = readWatchAlertWebhookUrlFromGM();
    const localUrl = readWatchAlertWebhookUrlFromLocal();
    const resolved = gmUrl || localUrl || '';
    if (resolved) mirrorWatchAlertWebhookUrl(resolved);
    else state.savedWatchAlertWebhookUrl = '';
  }

  function getWatchAlertWebhookUrl() {
    const gmUrl = readWatchAlertWebhookUrlFromGM();
    const localUrl = readWatchAlertWebhookUrlFromLocal();
    const resolved = gmUrl || localUrl || state.savedWatchAlertWebhookUrl || '';
    if (resolved && (gmUrl !== resolved || localUrl !== resolved || state.savedWatchAlertWebhookUrl !== resolved)) {
      mirrorWatchAlertWebhookUrl(resolved);
    } else {
      state.savedWatchAlertWebhookUrl = resolved;
    }
    return resolved;
  }

  function getCurrentWatchAlertWebhookUrlFromUi() {
    const uiValue = normalizeText(state.els.watchAlertWebhookUrl?.value || '');
    return uiValue || getWatchAlertWebhookUrl();
  }

  function isValidHttpUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function updateWatchAlertWebhookActiveUi(url) {
    const current = normalizeText(url);
    if (state.els.watchAlertWebhookActive) {
      state.els.watchAlertWebhookActive.textContent = current ? truncateMiddle(current, 110) : '(empty)';
      state.els.watchAlertWebhookActive.title = current || '';
    }
  }

  function syncWatchAlertWebhookUi() {
    const url = getWatchAlertWebhookUrl();
    if (state.els.watchAlertWebhookUrl && state.els.watchAlertWebhookUrl.value !== url) {
      state.els.watchAlertWebhookUrl.value = url;
    }
    updateWatchAlertWebhookActiveUi(url);
  }

  function persistWatchAlertWebhookFromUi(withLog = false) {
    const current = normalizeText(state.els.watchAlertWebhookUrl?.value || '');
    const before = getWatchAlertWebhookUrl();
    const saved = mirrorWatchAlertWebhookUrl(current);
    updateWatchAlertWebhookActiveUi(saved);
    if (withLog && saved !== before) {
      log(saved ? 'Watch alert webhook URL saved' : 'Watch alert webhook URL cleared');
    }
    return saved;
  }

  function readTimeoutTextWebhookUrlFromGM() {
    try {
      return normalizeText(GM_getValue(KEYS.timeoutTextWebhookUrl, ''));
    } catch {
      return '';
    }
  }

  function readTimeoutTextWebhookUrlFromLocal() {
    try {
      return normalizeText(localStorage.getItem(KEYS.timeoutTextWebhookUrl) || '');
    } catch {
      return '';
    }
  }

  function mirrorTimeoutTextWebhookUrl(url) {
    const normalized = normalizeText(url);
    try { GM_setValue(KEYS.timeoutTextWebhookUrl, normalized); } catch {}
    try { localStorage.setItem(KEYS.timeoutTextWebhookUrl, normalized); } catch {}
    try { sessionStorage.setItem(KEYS.timeoutTextWebhookUrl, normalized); } catch {}
    state.savedTimeoutTextWebhookUrl = normalized;
    return normalized;
  }

  function hydrateTimeoutTextWebhookStorage() {
    const gmUrl = readTimeoutTextWebhookUrlFromGM();
    const localUrl = readTimeoutTextWebhookUrlFromLocal();
    const resolved = gmUrl || localUrl || '';
    if (resolved) mirrorTimeoutTextWebhookUrl(resolved);
    else state.savedTimeoutTextWebhookUrl = '';
  }

  function readSharedJsonValue(key, fallback = null) {
    const local = safeJsonParse(localStorage.getItem(key), undefined);
    if (local !== undefined && local !== null) return local;
    try {
      const raw = GM_getValue(key, undefined);
      if (raw === undefined || raw === null || raw === '') return fallback;
      return typeof raw === 'string' ? safeJsonParse(raw, fallback) : raw;
    } catch {
      return fallback;
    }
  }

  function writeSharedJsonValue(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value, null, 2)); } catch {}
    try { GM_setValue(key, value); } catch {}
    return value;
  }

  function clearSharedJsonValue(key) {
    try { localStorage.removeItem(key); } catch {}
    try { GM_setValue(key, null); } catch {}
  }

  function readTimeoutRetryState() {
    const raw = readSharedJsonValue(KEYS.timeoutRetryState, null);
    if (!isPlainObject(raw)) return null;
    return {
      scope: normalizeText(raw.scope || ''),
      retries: Math.max(0, Number(raw.retries || 0) || 0),
      azId: normalizeText(raw.azId || ''),
      product: normalizeText(raw.product || ''),
      submission: normalizeText(raw.submission || ''),
      header: normalizeText(raw.header || ''),
      lastLaunchedContextKey: normalizeText(raw.lastLaunchedContextKey || ''),
      lastLaunchedAt: normalizeText(raw.lastLaunchedAt || ''),
      updatedAt: normalizeText(raw.updatedAt || '')
    };
  }

  function writeTimeoutRetryState(value) {
    if (!isPlainObject(value)) return null;
    const next = {
      scope: normalizeText(value.scope || ''),
      retries: Math.max(0, Number(value.retries || 0) || 0),
      azId: normalizeText(value.azId || ''),
      product: normalizeText(value.product || ''),
      submission: normalizeText(value.submission || ''),
      header: normalizeText(value.header || ''),
      lastLaunchedContextKey: normalizeText(value.lastLaunchedContextKey || ''),
      lastLaunchedAt: normalizeText(value.lastLaunchedAt || ''),
      updatedAt: normalizeText(value.updatedAt || nowIso())
    };
    return writeSharedJsonValue(KEYS.timeoutRetryState, next);
  }

  function clearTimeoutRetryState() {
    clearSharedJsonValue(KEYS.timeoutRetryState);
  }

  function buildTimeoutRetryScope(context) {
    return [
      normalizeText(context?.job?.['AZ ID'] || ''),
      normalizeText(context?.product || '')
    ].join('|');
  }

  function readTimeoutRetryRequest() {
    const raw = readSharedJsonValue(KEYS.timeoutRetryRequest, null);
    if (!isPlainObject(raw)) return null;
    return {
      ready: raw.ready === true,
      scope: normalizeText(raw.scope || ''),
      timeoutContextKey: normalizeText(raw.timeoutContextKey || ''),
      ticketId: normalizeText(raw.ticketId || raw.azId || ''),
      azId: normalizeText(raw.azId || raw.ticketId || ''),
      product: normalizeText(raw.product || ''),
      submission: normalizeText(raw.submission || ''),
      header: normalizeText(raw.header || ''),
      attempt: Math.max(0, Number(raw.attempt || 0) || 0),
      maxAttempts: Math.max(0, Number(raw.maxAttempts || 0) || 0),
      requestedAt: normalizeText(raw.requestedAt || ''),
      source: normalizeText(raw.source || ''),
      version: normalizeText(raw.version || '')
    };
  }

  function writeTimeoutRetryRequest(value) {
    if (!isPlainObject(value)) return null;
    const next = {
      ready: value.ready === true,
      scope: normalizeText(value.scope || ''),
      timeoutContextKey: normalizeText(value.timeoutContextKey || ''),
      ticketId: normalizeText(value.ticketId || value.azId || ''),
      azId: normalizeText(value.azId || value.ticketId || ''),
      product: normalizeText(value.product || ''),
      submission: normalizeText(value.submission || ''),
      header: normalizeText(value.header || ''),
      attempt: Math.max(0, Number(value.attempt || 0) || 0),
      maxAttempts: Math.max(0, Number(value.maxAttempts || 0) || 0),
      requestedAt: normalizeText(value.requestedAt || nowIso()),
      source: normalizeText(value.source || SCRIPT_NAME),
      version: normalizeText(value.version || VERSION)
    };
    return writeSharedJsonValue(KEYS.timeoutRetryRequest, next);
  }

  function clearTimeoutRetryRequest() {
    clearSharedJsonValue(KEYS.timeoutRetryRequest);
  }

  function buildTimeoutRetryRequestKey(request) {
    return [
      normalizeText(request?.scope || ''),
      normalizeText(request?.timeoutContextKey || ''),
      String(Math.max(0, Number(request?.attempt || 0) || 0)),
      normalizeText(request?.requestedAt || '')
    ].join('|');
  }

  function readTimeoutRetryRequestedContext() {
    try { return normalizeText(sessionStorage.getItem(KEYS.timeoutRetryRequestedContext) || ''); }
    catch { return ''; }
  }

  function writeTimeoutRetryRequestedContext(value) {
    const next = normalizeText(value || '');
    try {
      if (next) sessionStorage.setItem(KEYS.timeoutRetryRequestedContext, next);
      else sessionStorage.removeItem(KEYS.timeoutRetryRequestedContext);
    } catch {}
    return next;
  }

  function readTimeoutRetryStateForContext(context) {
    const scope = buildTimeoutRetryScope(context);
    if (!scope) {
      clearTimeoutRetryState();
      return { scope: '', retries: 0 };
    }

    const current = readTimeoutRetryState();
    if (!current || current.scope !== scope) {
      if (current?.scope) clearTimeoutRetryState();
      return { scope, retries: 0 };
    }

    return current;
  }

  function rememberTimeoutRetry(context, retries) {
    const scope = buildTimeoutRetryScope(context);
    if (!scope) return null;
    return writeTimeoutRetryState({
      scope,
      retries,
      azId: normalizeText(context?.job?.['AZ ID'] || ''),
      product: normalizeText(context?.product || ''),
      submission: normalizeText(context?.submission || ''),
      header: normalizeText(context?.header || '')
    });
  }

  function tryTimeoutLauncherRecovery(context) {
    const timeoutContextKey = buildTimeoutContextKey(context);
    if (!timeoutContextKey) return false;
    const current = readTimeoutRetryStateForContext(context);
    const activeRequest = readTimeoutRetryRequest();
    const activeRequestScope = normalizeText(activeRequest?.scope || '');
    const requestedContextKey = readTimeoutRetryRequestedContext();

    if (current.retries >= CFG.timeoutRetryLimit) {
      if (activeRequest?.ready === true && activeRequestScope === current.scope) {
        clearTimeoutRetryRequest();
      }
      return false;
    }

    if (activeRequest?.ready === true && activeRequestScope === current.scope) {
      const requestedMs = Date.parse(normalizeText(activeRequest.requestedAt || ''));
      const requestAgeMs = Number.isFinite(requestedMs) ? (Date.now() - requestedMs) : 0;
      if (requestAgeMs >= CFG.timeoutRetryRequestMaxWaitMs) {
        log(
          `Launcher retry wait exceeded ${Math.round(CFG.timeoutRetryRequestMaxWaitMs / 1000)}s; ` +
          `continuing normal timeout flow | ${context.product.toUpperCase()} | AZ ${context.job['AZ ID']} | ${context.header}`
        );
        clearTimeoutRetryRequest();
        writeTimeoutRetryRequestedContext('');
        return false;
      }
      setStatus(`Waiting for launcher retry (${Math.max(1, activeRequest.attempt || current.retries)}/${CFG.timeoutRetryLimit})`);
      return true;
    }

    if (requestedContextKey && requestedContextKey === timeoutContextKey) {
      if (normalizeText(current.lastLaunchedContextKey || '') === timeoutContextKey) {
        closeTimedOutTabAfterLauncherRetry(context, current);
        return true;
      }
      writeTimeoutRetryRequestedContext('');
      return false;
    }

    const nextRetry = current.retries + 1;
    if (nextRetry > CFG.timeoutRetryLimit) return false;

    rememberTimeoutRetry(context, nextRetry);
    writeTimeoutRetryRequest({
      ready: true,
      scope: current.scope,
      timeoutContextKey,
      ticketId: normalizeText(context.job?.['AZ ID'] || ''),
      azId: normalizeText(context.job?.['AZ ID'] || ''),
      product: normalizeText(context.product || ''),
      submission: normalizeText(context.submission || ''),
      header: normalizeText(context.header || ''),
      attempt: nextRetry,
      maxAttempts: CFG.timeoutRetryLimit,
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    });
    writeTimeoutRetryRequestedContext(timeoutContextKey);
    setStatus(`Requesting launcher retry (${nextRetry}/${CFG.timeoutRetryLimit})`);
    log(
      `Header timeout retry requested (${nextRetry}/${CFG.timeoutRetryLimit}) | ` +
      `${context.product.toUpperCase()} | AZ ${context.job['AZ ID']} | ${context.header}`
    );
    return true;
  }

  function tryCloseCurrentTimedOutTab() {
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

  function attemptTimedOutTabClose(timeoutContextKey, attempt = 1) {
    if (state.destroyed) return;
    if (state.timeoutRetryCloseAttemptedKey !== timeoutContextKey) return;
    if (window.closed) return;

    setStatus(`Closing timed-out tab (${attempt}/${CFG.timeoutRetryCloseAttempts})`);
    tryCloseCurrentTimedOutTab();

    setTimeout(() => {
      if (state.destroyed || window.closed) return;
      if (state.timeoutRetryCloseAttemptedKey !== timeoutContextKey) return;
      if (attempt < CFG.timeoutRetryCloseAttempts) {
        attemptTimedOutTabClose(timeoutContextKey, attempt + 1);
        return;
      }
      log('Timed-out GWPC tab close was blocked by the browser after launcher retry');
      setStatus('Timed-out tab close blocked');
    }, CFG.timeoutRetryCloseRetryMs);
  }

  function closeTimedOutTabAfterLauncherRetry(context, retryState) {
    const timeoutContextKey = buildTimeoutContextKey(context);
    if (!timeoutContextKey) {
      setStatus(`Launcher retry launched (${retryState.retries}/${CFG.timeoutRetryLimit})`);
      return;
    }

    if (state.timeoutRetryCloseAttemptedKey === timeoutContextKey) {
      setStatus('Closing timed-out tab');
      return;
    }

    state.timeoutRetryCloseAttemptedKey = timeoutContextKey;
    state.running = false;
    renderButtons();
    setStatus(`Launcher retry launched (${retryState.retries}/${CFG.timeoutRetryLimit})`);
    log(
      `Launcher retry confirmed; closing timed-out GWPC tab | ` +
      `${context.product.toUpperCase()} | AZ ${context.job['AZ ID']} | ${context.header}`
    );
    setTimeout(() => {
      attemptTimedOutTabClose(timeoutContextKey, 1);
    }, CFG.timeoutRetryCloseDelayMs);
  }

  function getTimeoutTextWebhookUrl() {
    const gmUrl = readTimeoutTextWebhookUrlFromGM();
    const localUrl = readTimeoutTextWebhookUrlFromLocal();
    const resolved = gmUrl || localUrl || state.savedTimeoutTextWebhookUrl || '';
    if (resolved && (gmUrl !== resolved || localUrl !== resolved || state.savedTimeoutTextWebhookUrl !== resolved)) {
      mirrorTimeoutTextWebhookUrl(resolved);
    } else {
      state.savedTimeoutTextWebhookUrl = resolved;
    }
    return resolved;
  }

  function getCurrentTimeoutTextWebhookUrlFromUi() {
    const uiValue = normalizeText(state.els.timeoutTextWebhookUrl?.value || '');
    return uiValue || getTimeoutTextWebhookUrl();
  }

  function updateTimeoutTextWebhookActiveUi(url) {
    const current = normalizeText(url);
    if (state.els.timeoutTextWebhookActive) {
      state.els.timeoutTextWebhookActive.textContent = current ? truncateMiddle(current, 110) : '(empty)';
      state.els.timeoutTextWebhookActive.title = current || '';
    }
  }

  function syncTimeoutTextWebhookUi() {
    const url = getTimeoutTextWebhookUrl();
    if (state.els.timeoutTextWebhookUrl && state.els.timeoutTextWebhookUrl.value !== url) {
      state.els.timeoutTextWebhookUrl.value = url;
    }
    updateTimeoutTextWebhookActiveUi(url);
  }

  function persistTimeoutTextWebhookFromUi(withLog = false) {
    const current = normalizeText(state.els.timeoutTextWebhookUrl?.value || '');
    const before = getTimeoutTextWebhookUrl();
    const saved = mirrorTimeoutTextWebhookUrl(current);
    updateTimeoutTextWebhookActiveUi(saved);
    if (withLog && saved !== before) {
      log(saved ? 'Timeout text webhook URL saved' : 'Timeout text webhook URL cleared');
    }
    return saved;
  }

  function readPendingWatchPost() {
    const raw = safeJsonParse(localStorage.getItem(KEYS.watchPending), null);
    if (!isPlainObject(raw)) return null;
    if (!isPlainObject(raw.event) || !normalizeText(raw.dedupeKey || raw.event?.dedupeKey || '')) return null;
    return raw;
  }

  function writePendingWatchPost(record) {
    if (!isPlainObject(record)) return null;
    localStorage.setItem(KEYS.watchPending, JSON.stringify(record, null, 2));
    return record;
  }

  function clearPendingWatchPost() {
    try { localStorage.removeItem(KEYS.watchPending); } catch {}
    renderButtons();
    renderAll();
  }

  function hasPendingWatchPost() {
    return !!readPendingWatchPost();
  }

  function buildTimeoutContextKey(context) {
    if (!context?.job?.['AZ ID'] || !context?.product || !context?.header) return '';
    return [
      'timeout',
      context.job['AZ ID'],
      context.product,
      context.header,
      String(context.headerSinceMs || '')
    ].join('|');
  }

  function timeoutActionsEnabled() {
    state.timeoutEnabled = readTimeoutEnabled();
    return state.timeoutEnabled;
  }

  function raiseWebhookSendSignal(event, context) {
    if (!event || !context?.job?.['AZ ID']) return false;
    const request = {
      azId: context.job['AZ ID'],
      product: context.product || '',
      eventId: event.eventId || event.id || '',
      triggerType: event.triggerType || '',
      reason: `${event.triggerType || 'timeout'}:${event.eventId || event.id || 'event'}`,
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    try {
      writeSharedJsonValue(FORCE_SEND_KEY, request);
      if (event.triggerType === 'selector') {
        log(
          `Raised webhook send signal for ${String(context.product || '').toUpperCase()} selector | ` +
          `rule=${getRuleLogLabel(event)} | sentError=${quoteLogValue(event.errorText || '', 280)}`
        );
      } else {
        log(`Raised webhook send signal for ${String(context.product || '').toUpperCase()} ${event.triggerType || 'event'}`);
      }
      return true;
    } catch (err) {
      log(`Failed to raise webhook send signal: ${err?.message || err}`);
      return false;
    }
  }

  function logWait(key, message) {
    if (state.lastWaitLogKey === key) return;
    state.lastWaitLogKey = key;
    log(message);
  }

  function clearWaitLog() {
    state.lastWaitLogKey = '';
  }

  function quoteLogValue(value, maxChars = 320) {
    return JSON.stringify(truncateText(normalizeText(value || ''), maxChars));
  }

  function getRuleLogLabel(ruleLike) {
    return normalizeText(ruleLike?.label || ruleLike?.errorName || ruleLike?.savedErrorText || ruleLike?.selectorRuleId || 'Saved selector rule');
  }

  function getVisibleElementLogText(el, maxChars = 320) {
    if (!(el instanceof Element)) return '';
    return truncateText(normalizeText(el.innerText || el.textContent || ''), maxChars);
  }

  function buildElementLogMeta(el) {
    if (!(el instanceof Element)) {
      return {
        tag: '',
        id: '',
        className: '',
        text: '',
        summary: '(none)'
      };
    }

    const tag = String(el.tagName || '').toLowerCase();
    const id = normalizeText(el.id || '');
    const className = truncateText(normalizeText(Array.from(el.classList || []).join(' ')), 160);
    const text = getVisibleElementLogText(el, 320);
    const summary = [
      tag || '(unknown)',
      id ? `#${id}` : '',
      className ? `.${className.split(/\s+/).filter(Boolean).join('.')}` : ''
    ].join('');

    return {
      tag,
      id,
      className,
      text,
      summary: summary || '(none)'
    };
  }

  function selectorFailurePriority(reason) {
    const normalized = normalizeText(reason).toLowerCase();
    if (!normalized) return 0;
    if (normalized === 'text fingerprint not found on visible element') return 100;
    if (normalized === 'rule missing text fingerprint') return 95;
    if (normalized === 'visible element text empty') return 90;
    if (normalized === 'fingerprint score mismatch') return 80;
    if (normalized === 'candidate not visible') return 60;
    if (normalized === 'selector found no elements') return 40;
    if (normalized === 'selector missing') return 30;
    if (normalized === 'selector query failed') return 20;
    return 10;
  }

  function pickBetterSelectorFailure(current, next) {
    if (!next) return current || null;
    if (!current) return next;
    return selectorFailurePriority(next.reason) >= selectorFailurePriority(current.reason) ? next : current;
  }

  function logSelectorRuleSkipped(context, rule, matchInfo) {
    const header = normalizeText(context?.header || state.current.header || '');
    const baseKey = [
      normalizeText(rule?.ruleId || ''),
      header
    ].join('|');
    const reason = normalizeText(matchInfo?.reason || 'no visible element matched selector');
    const nextPriority = selectorFailurePriority(reason);
    const lastPriority = Number(state.selectorSkipLogKeys.get(baseKey) || 0);
    if (lastPriority >= nextPriority) return;
    state.selectorSkipLogKeys.set(baseKey, nextPriority);

    const ruleLabel = getRuleLogLabel(rule);
    const product = normalizeText(context?.product || state.current.product || '');
    const stage = normalizeText(context?.productLabel || state.current.productLabel || '');
    const azId = normalizeText(context?.job?.['AZ ID'] || state.current.azId || '');
    const submission = normalizeText(context?.submission || state.current.submission || '');
    const selector = normalizeText(rule?.selector || '');

    log(
      `Selector rule skipped | ${ruleLabel} | ${reason} | ` +
      `ruleId=${normalizeText(rule?.ruleId || '')} | selector=${quoteLogValue(selector, 260)} | header=${quoteLogValue(header, 120)} | ` +
      `product=${quoteLogValue(product, 60)} | stage=${quoteLogValue(stage, 120)} | AZ ID=${quoteLogValue(azId, 80)} | submission=${quoteLogValue(submission, 80)}`
    );
  }

  function logSelectorRuleMatchReady(context, rule, matchInfo) {
    const ruleLabel = getRuleLogLabel(rule);
    const meta = buildElementLogMeta(matchInfo?.element);
    const matchedText = normalizeText(matchInfo?.matchedText || meta.text || '');
    const sentError = normalizeText(rule?.savedErrorText || rule?.errorText || '');
    const header = normalizeText(context?.header || '');
    const product = normalizeText(context?.product || '');
    const stage = normalizeText(context?.productLabel || '');
    const azId = normalizeText(context?.job?.['AZ ID'] || '');
    const submission = normalizeText(context?.submission || '');
    const selector = normalizeText(rule?.selector || '');

    log(
      `Selector rule matched | ruleId=${normalizeText(rule?.ruleId || '')} | label=${quoteLogValue(ruleLabel, 160)} | ` +
      `sentError=${quoteLogValue(sentError, 280)} | selector=${quoteLogValue(selector, 260)} | ` +
      `matchedTag=${quoteLogValue(meta.tag, 80)} | matchedClass=${quoteLogValue(meta.className, 160)} | matchedId=${quoteLogValue(meta.id, 120)} | ` +
      `matchedText=${quoteLogValue(matchedText, 320)} | header=${quoteLogValue(header, 120)} | ` +
      `product=${quoteLogValue(product, 60)} | stage=${quoteLogValue(stage, 120)} | AZ ID=${quoteLogValue(azId, 80)} | submission=${quoteLogValue(submission, 80)}`
    );
  }

  function setStatus(text) {
    state.lastStatus = normalizeText(text);
    if (state.els.status) state.els.status.textContent = state.lastStatus || 'Idle';
  }

  function getAllDocs() {
    const docs = [];
    const seen = new Set();

    function walk(win) {
      try {
        if (!win || seen.has(win)) return;
        seen.add(win);
        if (win.document) docs.push(win.document);
        for (let i = 0; i < win.frames.length; i += 1) walk(win.frames[i]);
      } catch {}
    }

    walk(window);
    return docs;
  }

  function queryAllDeep(root, selector) {
    const out = [];
    const seenRoots = new Set();

    function scan(searchRoot) {
      if (!searchRoot || seenRoots.has(searchRoot)) return;
      seenRoots.add(searchRoot);

      try {
        out.push(...Array.from(searchRoot.querySelectorAll(selector)));
      } catch {}

      let descendants = [];
      try { descendants = Array.from(searchRoot.querySelectorAll('*')); } catch {}
      for (const el of descendants) {
        if (el?.shadowRoot) scan(el.shadowRoot);
      }
    }

    scan(root);
    return out;
  }

  function firstVisibleTextBySelectors(selectors) {
    for (const doc of getAllDocs()) {
      for (const selector of selectors) {
        const el = $(selector, doc);
        if (!el || !isVisible(el)) continue;
        const text = normalizeText(el.textContent);
        if (text) return text;
      }
    }
    return '';
  }

  function getGuidewireHeader() {
    return firstVisibleTextBySelectors([
      '.gw-TitleBar--title[role="heading"]',
      '.gw-TitleBar--title',
      '.gw-WizardScreen-title',
      '.gw-Wizard--Title',
      '[role="heading"][aria-level="1"]',
      '#iv360-valuationContainer .iv360-page-title-container .iv360-page-header',
      '#iv360-valuationContainer .iv360-page-title-container h1',
      '.iv360-page-title-container .iv360-page-header',
      '.iv360-page-title-container h1'
    ]);
  }

  function getSubmissionNumber() {
    const titleText = firstVisibleTextBySelectors([
      '.gw-Wizard--Title',
      '.gw-TitleBar--title[role="heading"]',
      '.gw-TitleBar--title',
      '.gw-WizardScreen-title',
      '[role="heading"][aria-level="1"]'
    ]);
    const match = titleText.match(/Submission\s+(\d{6,})/i);
    return match ? match[1] : '';
  }

  function hasLabelExactAnyDoc(labelText) {
    const wanted = normalizeText(labelText);
    if (!wanted) return false;
    for (const doc of getAllDocs()) {
      const hits = $$('.gw-label, .gw-LabelWidget, .gw-vw--value, .gw-infoValue', doc)
        .some((el) => isVisible(el) && normalizeText(el.textContent) === wanted);
      if (hits) return true;
    }
    return false;
  }

  function detectProduct() {
    const hasHome = hasLabelExactAnyDoc('Homeowners');
    if (hasHome) return { product: 'home', label: 'Homeowners' };
    return { product: '', label: '' };
  }

  function getAccountNameFromPage() {
    for (const doc of getAllDocs()) {
      const exact = $('div#SubmissionWizard-JobWizardInfoBar-AccountName > div.gw-label.gw-infoValue:nth-of-type(2)', doc);
      const exactText = normalizeText(exact?.textContent || '');
      if (exactText) return exactText;

      const wrap = $('#SubmissionWizard-JobWizardInfoBar-AccountName', doc);
      if (!wrap) continue;

      const values = $$('.gw-label.gw-infoValue, .gw-infoValue', wrap)
        .map((el) => normalizeText(el.textContent))
        .filter(Boolean);

      if (values[1]) return values[1];
      if (values[0]) return values[0];
    }
    return '';
  }

  function looksLikeAddress(value) {
    return /\d{1,6}\s+.+,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/.test(normalizeText(value));
  }

  function getMailingAddressFromPage() {
    const selectors = [
      'div#SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HODwellingLocationHOEInputSet-HODwellingLocationInput > div.gw-vw--value.gw-align-h--left:nth-of-type(1)',
      '#SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HODwellingLocationHOEInputSet-HODwellingLocationInput .gw-vw--value.gw-align-h--left:nth-of-type(1)',
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress .gw-infoValue',
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress .gw-label.gw-infoValue'
    ];

    for (const doc of getAllDocs()) {
      for (const selector of selectors) {
        const el = $(selector, doc);
        const text = normalizeText(el?.textContent || '');
        if (text && looksLikeAddress(text)) return text;
      }
    }

    for (const doc of getAllDocs()) {
      const nodes = [
        ...$$('.gw-infoValue', doc),
        ...$$('.gw-label.gw-infoValue', doc),
        ...$$('.gw-vw--value', doc)
      ];
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const text = normalizeText(el.textContent);
        if (text && looksLikeAddress(text)) return text;
      }
    }

    return '';
  }

  function getIdentityCache() {
    return safeJsonParse(sessionStorage.getItem(KEYS.identityCache), {}) || {};
  }

  function setIdentityCache(cache) {
    try { sessionStorage.setItem(KEYS.identityCache, JSON.stringify(cache)); } catch {}
  }

  function updateIdentityCache(submission) {
    const sub = normalizeText(submission);
    if (!sub) return;
    const name = normalizeText(getAccountNameFromPage());
    const mailingAddress = normalizeText(getMailingAddressFromPage());
    if (!name || !mailingAddress) return;

    const cache = getIdentityCache();
    cache[sub] = {
      'Name': name,
      'Mailing Address': mailingAddress,
      'SubmissionNumber': sub,
      seenAt: nowIso()
    };
    setIdentityCache(cache);
  }

  function getPageIdentity(submission) {
    const sub = normalizeText(submission);
    const cache = getIdentityCache();
    const cached = isPlainObject(cache[sub]) ? cache[sub] : {};
    return {
      name: normalizeText(getAccountNameFromPage()) || normalizeText(cached['Name'] || ''),
      mailingAddress: normalizeText(getMailingAddressFromPage()) || normalizeText(cached['Mailing Address'] || ''),
      submissionNumber: sub || normalizeText(cached['SubmissionNumber'] || '')
    };
  }

  function normalizeCurrentJob(raw) {
    const out = {
      'AZ ID': '',
      'Name': '',
      'Mailing Address': '',
      'SubmissionNumber': '',
      'updatedAt': '',
      'First Name': '',
      'Last Name': '',
      'Email': '',
      'Phone': '',
      'DOB': '',
      'Street Address': '',
      'City': '',
      'State': '',
      'Zip': ''
    };

    if (!isPlainObject(raw)) return out;

    const az = isPlainObject(raw.az) ? raw.az : {};
    const legacyName = [az['AZ Name'], az['AZ Last']]
      .map((v) => normalizeText(v))
      .filter(Boolean)
      .join(' ')
      .trim();
    const legacyAddress = [
      normalizeText(az['AZ Street Address']),
      normalizeText(az['AZ City']),
      normalizeText(az['AZ State']),
      normalizeText(az['AZ Postal Code'])
    ].filter(Boolean).join(', ');

    out['AZ ID'] = normalizeText(raw['AZ ID'] || raw.ticketId || raw.masterId || raw.id || az['AZ ID'] || '');
    out['Name'] = normalizeText(raw['Name'] || raw.name || legacyName || '');
    out['Mailing Address'] = normalizeText(raw['Mailing Address'] || raw.mailingAddress || legacyAddress || '');
    out['SubmissionNumber'] = normalizeText(raw['SubmissionNumber'] || raw.submissionNumber || raw['Submission Number'] || '');
    out['updatedAt'] = normalizeText(raw['updatedAt'] || raw.lastUpdatedAt || raw?.meta?.updatedAt || '');
    out['First Name'] = normalizeText(raw['First Name'] || raw.firstName || az['First Name'] || az['AZ Name'] || '');
    out['Last Name'] = normalizeText(raw['Last Name'] || raw.lastName || az['Last Name'] || az['AZ Last'] || '');
    out['Email'] = normalizeText(raw['Email'] || raw.email || az['Email'] || az['AZ Email'] || '');
    out['Phone'] = normalizeText(raw['Phone'] || raw.phone || az['Phone'] || az['AZ Phone'] || '');
    out['DOB'] = normalizeText(raw['DOB'] || raw.dob || az['DOB'] || az['AZ DOB'] || '');
    out['Street Address'] = normalizeText(raw['Street Address'] || raw.streetAddress || az['Street Address'] || az['AZ Street Address'] || '');
    out['City'] = normalizeText(raw['City'] || raw.city || az['City'] || az['AZ City'] || '');
    out['State'] = normalizeText(raw['State'] || raw.state || az['State'] || az['AZ State'] || '');
    out['Zip'] = normalizeText(raw['Zip'] || raw.zip || raw.zipCode || az['Zip'] || az['AZ Postal Code'] || '');
    return out;
  }

  function readCurrentJob() {
    const candidates = [
      safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null),
      safeJsonParse(localStorage.getItem(LEGACY_SHARED_JOB_KEY), null),
      safeJsonParse(localStorage.getItem(BUNDLE_KEY), null),
      safeJsonParse(localStorage.getItem(KEYS.homePayload), null)?.currentJob
    ];

    for (const candidate of candidates) {
      const job = normalizeCurrentJob(candidate);
      if (job['AZ ID']) return job;
    }
    return normalizeCurrentJob(null);
  }

  function writeCurrentJob(job) {
    const next = normalizeCurrentJob(job);
    if (!next['AZ ID']) return next;
    next.updatedAt = nowIso();
    try { localStorage.setItem(CURRENT_JOB_KEY, JSON.stringify(next, null, 2)); } catch {}
    return next;
  }

  function mergeCurrentJob(update) {
    const current = readCurrentJob();
    const incoming = normalizeCurrentJob(update || {});
    if (current['AZ ID'] && incoming['AZ ID'] && current['AZ ID'] !== incoming['AZ ID']) {
      return current;
    }

    const next = {
      'AZ ID': incoming['AZ ID'] || current['AZ ID'] || '',
      'Name': incoming['Name'] || current['Name'] || '',
      'Mailing Address': incoming['Mailing Address'] || current['Mailing Address'] || '',
      'SubmissionNumber': incoming['SubmissionNumber'] || current['SubmissionNumber'] || '',
      'updatedAt': nowIso(),
      'First Name': incoming['First Name'] || current['First Name'] || '',
      'Last Name': incoming['Last Name'] || current['Last Name'] || '',
      'Email': incoming['Email'] || current['Email'] || '',
      'Phone': incoming['Phone'] || current['Phone'] || '',
      'DOB': incoming['DOB'] || current['DOB'] || '',
      'Street Address': incoming['Street Address'] || current['Street Address'] || '',
      'City': incoming['City'] || current['City'] || '',
      'State': incoming['State'] || current['State'] || '',
      'Zip': incoming['Zip'] || current['Zip'] || ''
    };
    return writeCurrentJob(next);
  }

  function readBundle() {
    return safeJsonParse(localStorage.getItem(BUNDLE_KEY), null);
  }

  function writeBundle(bundle) {
    localStorage.setItem(BUNDLE_KEY, JSON.stringify(bundle, null, 2));
    return bundle;
  }

  function emptyBundleForJob(job) {
    return {
      'AZ ID': normalizeText(job?.['AZ ID']),
      'Name': normalizeText(job?.['Name']),
      'Mailing Address': normalizeText(job?.['Mailing Address']),
      'SubmissionNumber': normalizeText(job?.['SubmissionNumber']),
      home: {},
      auto: { ready: false, data: null },
      timeout: {
        ready: false,
        events: []
      },
      meta: {
        updatedAt: nowIso(),
        lastWriter: SCRIPT_NAME,
        version: VERSION
      }
    };
  }

  function ensureBundleForJob(job) {
    const azId = normalizeText(job?.['AZ ID']);
    if (!azId) return null;

    const current = readBundle();
    if (!isPlainObject(current) || normalizeText(current['AZ ID']) !== azId) {
      return writeBundle(emptyBundleForJob(job));
    }

    current['Name'] = normalizeText(job['Name']) || current['Name'] || '';
    current['Mailing Address'] = normalizeText(job['Mailing Address']) || current['Mailing Address'] || '';
    current['SubmissionNumber'] = normalizeText(job['SubmissionNumber']) || current['SubmissionNumber'] || '';
    current.timeout = isPlainObject(current.timeout) ? current.timeout : { ready: false, events: [] };
    if (!Array.isArray(current.timeout.events)) current.timeout.events = [];
    current.meta = isPlainObject(current.meta) ? current.meta : {};
    current.meta.updatedAt = nowIso();
    current.meta.lastWriter = SCRIPT_NAME;
    current.meta.version = VERSION;
    return writeBundle(current);
  }

  function mergeEventList(list, event) {
    const next = Array.isArray(list) ? list.map((item) => deepClone(item)) : [];
    const idx = next.findIndex((item) => normalizeText(item?.eventId || item?.id) === normalizeText(event.eventId));
    if (idx >= 0) next[idx] = deepClone(event);
    else next.push(deepClone(event));
    return next;
  }

  function saveEventToBundle(product, job, event) {
    const bundle = ensureBundleForJob(job);
    if (!bundle) throw new Error('Missing current AZ job');

    const next = deepClone(bundle);
    const eventSubmission = normalizeText(event?.submissionNumber || '');
    next.timeout = isPlainObject(next.timeout) ? next.timeout : { ready: false, events: [] };
    next.timeout.ready = true;
    next.timeout.events = mergeEventList(next.timeout.events, event);
    next.timeout.lastEvent = deepClone(event);

    const section = isPlainObject(next[product]) ? deepClone(next[product]) : {};
    section.ready = section.ready === true;
    section.savedAt = nowIso();
    section.script = SCRIPT_NAME;
    section.version = VERSION;
    section.data = isPlainObject(section.data) ? section.data : {};
    section.data.errors = mergeEventList(section.data.errors, event);
    section.data.latestError = deepClone(event);

    if (product === 'home') {
      section.data['Done?'] = event.resultValue;
      section.data['Result'] = event.errorText;
      if (isPlainObject(section.data.row)) {
        section.data.row['Done?'] = event.resultValue;
        section.data.row['Result'] = event.errorText;
        if (eventSubmission) section.data.row['Submission Number'] = eventSubmission;
      }
      if (eventSubmission) section.submissionNumber = eventSubmission;
    }

    next[product] = section;
    next['AZ ID'] = job['AZ ID'];
    next['Name'] = normalizeText(job['Name']) || next['Name'] || '';
    next['Mailing Address'] = normalizeText(job['Mailing Address']) || next['Mailing Address'] || '';
    next['SubmissionNumber'] = normalizeText(job['SubmissionNumber']) || next['SubmissionNumber'] || '';
    next.meta = isPlainObject(next.meta) ? next.meta : {};
    next.meta.updatedAt = nowIso();
    next.meta.lastWriter = SCRIPT_NAME;
    next.meta.version = VERSION;

    localStorage.setItem(BUNDLE_KEY, JSON.stringify(next, null, 2));
    return next;
  }

  function isLegacyTimeoutProductPayload(payload) {
    if (!isPlainObject(payload)) return false;
    if (normalizeText(payload.script || '') === SCRIPT_NAME) return true;
    if (normalizeText(payload.event || '') === 'gwpc_timeout_gathered') return true;
    const latestError = isPlainObject(payload.latestError) ? payload.latestError : {};
    return normalizeText(latestError.source || '') === SCRIPT_NAME;
  }

  function clearLegacyTimeoutProductPayloads() {
    for (const [label, key] of [
      ['HOME', KEYS.homePayload]
    ]) {
      const payload = safeJsonParse(localStorage.getItem(key), null);
      if (!isLegacyTimeoutProductPayload(payload)) continue;
      try { localStorage.removeItem(key); } catch {}
      log(`Cleared legacy timeout-owned ${label} payload`);
    }
  }

  function savedSelectorRulesEnabled() {
    return CFG.selectorRulesEnabled === true;
  }

  function isSelectorEvent(event) {
    if (!isPlainObject(event)) return false;
    const triggerType = normalizeText(event.triggerType || '').toLowerCase();
    const errorType = normalizeText(event.errorType || '').toLowerCase();
    const actionKey = normalizeText(event.actionKey || '').toLowerCase();
    const selectorRuleId = normalizeText(event.selectorRuleId || '');
    return triggerType === 'selector'
      || errorType === 'savedselectormatch'
      || actionKey.includes('saved_selector')
      || (!!selectorRuleId && normalizeText(event.source || '') === SCRIPT_NAME);
  }

  function clearLegacySelectorRules() {
    const parsed = safeJsonParse(localStorage.getItem(KEYS.selectorRules), []);
    const rules = Array.isArray(parsed) ? parsed : [];
    if (!rules.length) return 0;
    try { localStorage.removeItem(KEYS.selectorRules); } catch {}
    log(`Cleared ${rules.length} legacy saved selector rule(s)`);
    return rules.length;
  }

  function clearLegacySelectorSentEvents() {
    const store = readSentEventsStore();
    const next = { byId: {}, byDedupeKey: {}, order: [] };
    let removed = 0;

    for (const eventId of Array.isArray(store.order) ? store.order : []) {
      const record = isPlainObject(store.byId?.[eventId]) ? deepClone(store.byId[eventId]) : null;
      if (!record) continue;
      const source = normalizeText(record.source || '').toLowerCase();
      const ruleId = normalizeText(record.ruleId || '');
      if (source === 'selector' || ruleId) {
        removed += 1;
        continue;
      }
      next.byId[eventId] = record;
      if (record.dedupeKey) next.byDedupeKey[record.dedupeKey] = eventId;
      next.order.push(eventId);
    }

    if (!removed) return 0;
    writeSentEventsStore(next);
    log(`Cleared ${removed} legacy selector sent-event record(s)`);
    return removed;
  }

  function clearFieldIfRemovedValue(container, fieldName, removedValues) {
    if (!isPlainObject(container)) return false;
    if (!removedValues.size) return false;
    const current = normalizeText(container[fieldName] || '');
    if (!current || !removedValues.has(current)) return false;
    container[fieldName] = '';
    return true;
  }

  function clearRemovedSelectorFields(container, product, removedEvents) {
    if (!isPlainObject(container) || !Array.isArray(removedEvents) || !removedEvents.length) return false;
    const removedValues = new Set(
      removedEvents
        .map((event) => normalizeText(event?.resultValue || event?.errorText || event?.errorMessage || ''))
        .filter(Boolean)
    );

    let changed = false;
    if (product === 'home') {
      changed = clearFieldIfRemovedValue(container, 'Done?', removedValues) || changed;
      changed = clearFieldIfRemovedValue(container, 'Result', removedValues) || changed;
    } else if (product === 'auto') {
      changed = clearFieldIfRemovedValue(container, 'Auto', removedValues) || changed;
    }
    return changed;
  }

  function clearSelectorArtifactsFromSection(section, product) {
    if (!isPlainObject(section)) {
      return { changed: false, removedCount: 0, nextSection: section };
    }

    const nextSection = deepClone(section);
    nextSection.data = isPlainObject(nextSection.data) ? nextSection.data : {};

    const currentErrors = Array.isArray(nextSection.data.errors) ? nextSection.data.errors : [];
    const keptErrors = currentErrors.filter((event) => !isSelectorEvent(event));
    const removedErrors = currentErrors.filter((event) => isSelectorEvent(event));

    let changed = keptErrors.length !== currentErrors.length;
    if (changed) {
      if (keptErrors.length) nextSection.data.errors = keptErrors;
      else delete nextSection.data.errors;
    }

    if (isSelectorEvent(nextSection.data.latestError)) {
      changed = true;
      if (keptErrors.length) nextSection.data.latestError = deepClone(keptErrors[keptErrors.length - 1]);
      else delete nextSection.data.latestError;
    }

    changed = clearRemovedSelectorFields(nextSection.data, product, removedErrors) || changed;
    if (isPlainObject(nextSection.data.row)) {
      changed = clearRemovedSelectorFields(nextSection.data.row, product, removedErrors) || changed;
    }

    return {
      changed,
      removedCount: removedErrors.length,
      nextSection
    };
  }

  function clearLegacySelectorBundleArtifacts() {
    const bundle = readBundle();
    if (!isPlainObject(bundle)) return 0;

    const next = deepClone(bundle);
    let changed = false;
    let removedCount = 0;

    for (const product of ['home']) {
      const result = clearSelectorArtifactsFromSection(next[product], product);
      if (result.changed) {
        next[product] = result.nextSection;
        changed = true;
      }
      removedCount += result.removedCount;
    }

    const timeoutEvents = Array.isArray(next.timeout?.events) ? next.timeout.events : [];
    const keptTimeoutEvents = timeoutEvents.filter((event) => !isSelectorEvent(event));
    const removedTimeoutEvents = timeoutEvents.length - keptTimeoutEvents.length;
    const removedTimeoutLastEvent = isSelectorEvent(next.timeout?.lastEvent);
    if (removedTimeoutEvents || removedTimeoutLastEvent) {
      next.timeout = isPlainObject(next.timeout) ? next.timeout : {};
      next.timeout.events = keptTimeoutEvents;
      next.timeout.ready = keptTimeoutEvents.length > 0;
      if (removedTimeoutLastEvent) {
        if (keptTimeoutEvents.length) next.timeout.lastEvent = deepClone(keptTimeoutEvents[keptTimeoutEvents.length - 1]);
        else delete next.timeout.lastEvent;
      }
      changed = true;
      removedCount += removedTimeoutEvents + (removedTimeoutLastEvent ? 1 : 0);
    }

    if (!changed) return 0;

    next.meta = isPlainObject(next.meta) ? next.meta : {};
    next.meta.updatedAt = nowIso();
    next.meta.lastWriter = SCRIPT_NAME;
    next.meta.version = VERSION;
    writeBundle(next);
    log(`Cleared ${removedCount} legacy selector bundle artifact(s)`);
    return removedCount;
  }

  function buildSignatureJobBundle(job, bundle) {
    const sigObj = {
      'AZ ID': job['AZ ID'] || '',
      currentJob: deepClone(job),
      home: bundle?.home?.data || null,
      auto: bundle?.auto?.data || null,
      timeout: Array.isArray(bundle?.timeout?.events) ? bundle.timeout.events : []
    };
    return hashString(JSON.stringify(sigObj));
  }

  function readRuntimeState() {
    const runtime = safeJsonParse(localStorage.getItem(KEYS.runtime), null);
    return isPlainObject(runtime) ? runtime : {};
  }

  function writeRuntimeState(runtime) {
    localStorage.setItem(KEYS.runtime, JSON.stringify(runtime, null, 2));
    return runtime;
  }

  function clearRuntimeStateForPageLoad() {
    try { localStorage.removeItem(KEYS.runtime); } catch {}
    state.lastRuntimePersistKey = '';
  }

  function shiftCurrentRuntimeByPauseDelta(pauseDeltaMs) {
    if (!pauseDeltaMs || pauseDeltaMs <= 0) return;
    if (!state.current.header || !Number.isFinite(Number(state.current.headerSinceMs))) return;

    state.current.headerSinceMs = Number(state.current.headerSinceMs) + pauseDeltaMs;

    const runtime = readRuntimeState();
    const runtimeKey = normalizeText(runtime.key || '');
    if (runtimeKey && runtimeKey === normalizeText(state.lastRuntimePersistKey || '')) {
      runtime.headerSinceMs = Number(runtime.headerSinceMs || state.current.headerSinceMs) + pauseDeltaMs;
      runtime.updatedAt = nowIso();
      runtime.source = SCRIPT_NAME;
      runtime.version = VERSION;
      writeRuntimeState(runtime);
    }
  }

  function clearOwnedSendArtifacts() {
    try { localStorage.removeItem(KEYS.pendingPost); } catch {}
  }

  function readSentEventsStore() {
    const current = safeJsonParse(localStorage.getItem(KEYS.sentEvents), null);
    if (!isPlainObject(current)) {
      return { byId: {}, byDedupeKey: {}, order: [] };
    }
    current.byId = isPlainObject(current.byId) ? current.byId : {};
    current.byDedupeKey = isPlainObject(current.byDedupeKey) ? current.byDedupeKey : {};
    current.order = Array.isArray(current.order) ? current.order : [];
    return current;
  }

  function writeSentEventsStore(store) {
    localStorage.setItem(KEYS.sentEvents, JSON.stringify(store, null, 2));
    return store;
  }

  function pruneSentEventsStore(store) {
    const next = deepClone(store);
    while (next.order.length > CFG.maxSentEvents) {
      const oldestId = next.order.shift();
      const record = next.byId[oldestId];
      delete next.byId[oldestId];
      if (record?.dedupeKey && next.byDedupeKey[record.dedupeKey] === oldestId) {
        delete next.byDedupeKey[record.dedupeKey];
      }
    }
    return next;
  }

  function rememberDispatchedEvent(event) {
    const store = readSentEventsStore();
    const record = {
      eventId: event.eventId,
      dedupeKey: event.dedupeKey,
      azId: event.identity?.['AZ ID'] || '',
      product: event.product,
      ruleId: normalizeText(event.selectorRuleId || ''),
      signature: '',
      requestAt: normalizeText(event.detectedAt || nowIso()),
      sentAt: '',
      source: normalizeText(event.triggerType || SCRIPT_NAME)
    };
    store.byId[event.eventId] = record;
    if (event.dedupeKey) store.byDedupeKey[event.dedupeKey] = event.eventId;
    store.order = Array.isArray(store.order) ? store.order.filter((id) => id !== event.eventId) : [];
    store.order.push(event.eventId);
    writeSentEventsStore(pruneSentEventsStore(store));
  }

  function hasSentOrPendingDedupe(dedupeKey) {
    const normalized = normalizeText(dedupeKey);
    if (!normalized) return false;
    const store = readSentEventsStore();
    return !!normalizeText(store.byDedupeKey[normalized] || '');
  }

  function handleBeforeUnload() {
    if (state.selectorMode || state.modalOpen) {
      restoreSelectorPause();
    }
    try { persistWatchAlertWebhookFromUi(false); } catch {}
    try { persistTimeoutTextWebhookFromUi(false); } catch {}
    persistPanelPos();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      try { persistWatchAlertWebhookFromUi(false); } catch {}
      try { persistTimeoutTextWebhookFromUi(false); } catch {}
      return;
    }
    if (document.visibilityState === 'visible') {
      scheduleObserve();
      scheduleScan('visible');
      if ((Date.now() - Number(state.lastSharedRulesSyncAt || 0)) >= CFG.sharedRulesRefreshMs) {
        scheduleSharedRulesSync('visible');
      }
    }
  }

  function scheduleObserve() {
    if (state.observeScheduled || state.destroyed) return;
    state.observeScheduled = true;
    setTimeout(() => {
      state.observeScheduled = false;
      installMutationObserver();
    }, 0);
  }

  function installMutationObserver() {
    if (state.destroyed || !document.documentElement) return;
    try { state.mutationObserver?.disconnect(); } catch {}
    state.mutationObserver = new MutationObserver(() => {
      if (state.destroyed) return;
      if (state.scanQueued) return;
      state.scanQueued = true;
      setTimeout(() => {
        state.scanQueued = false;
        scheduleScan('mutation');
      }, CFG.observerThrottleMs);
    });
    try {
      state.mutationObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-hidden', 'aria-label']
      });
    } catch {}
  }

  function scheduleScan(reason) {
    if (state.destroyed) return;
    try {
      scanPage(reason);
    } catch (err) {
      log(`Scan failed: ${err?.message || err}`);
      setStatus('Scan failed');
    }
  }

  function scanPage(reason) {
    state.lastScanAt = Date.now();

    const job = readCurrentJob();
    const productInfo = detectProduct();
    const header = normalizeText(getGuidewireHeader());
    const submission = normalizeText(getSubmissionNumber());

    updateIdentityCache(submission);
    const pageIdentity = getPageIdentity(submission);

    if (submission && job['AZ ID']) {
      mergeCurrentJob({
        'AZ ID': job['AZ ID'],
        'Name': job['Name'] || pageIdentity.name,
        'Mailing Address': job['Mailing Address'] || pageIdentity.mailingAddress,
        'SubmissionNumber': submission || job['SubmissionNumber']
      });
    }

    syncCurrentContext({
      job: readCurrentJob(),
      product: productInfo.product,
      productLabel: productInfo.label,
      header,
      submission,
      pageIdentity
    });

    if (!state.running || state.selectorMode || state.modalOpen) {
      renderAll();
      return;
    }

    if (!state.current.product && state.current.header) {
      const key = `${state.current.header}|${state.current.azId || ''}`;
      if (state.lastUnknownStageKey !== key) {
        state.lastUnknownStageKey = key;
        log(`Unknown stage for header "${state.current.header}"`);
      }
    } else {
      state.lastUnknownStageKey = '';
    }

    processSelectorMatches();
    processHeaderTimeout();
    renderAll();
  }

  function syncCurrentContext(context) {
    const nextAzId = normalizeText(context.job?.['AZ ID'] || '');
    const nextSubmission = normalizeText(context.submission || context.job?.['SubmissionNumber'] || '');
    const nextProduct = normalizeText(context.product || '');
    const nextProductLabel = normalizeText(context.productLabel || '');
    const nextHeader = normalizeText(context.header || '');
    const pageName = normalizeText(context.pageIdentity?.name || '');
    const pageAddress = normalizeText(context.pageIdentity?.mailingAddress || '');

    const stored = readRuntimeState();
    const runtimeKey = nextAzId && nextProduct && nextHeader
      ? [nextAzId, nextProduct, nextSubmission || '(no-submission)', nextHeader].join('|')
      : '';
    let headerSinceMs = nextHeader ? Date.now() : 0;
    const canResumeStoredTimer = !!(
      runtimeKey
      && normalizeText(stored.key || '') === runtimeKey
      && normalizeText(state.lastRuntimePersistKey) === runtimeKey
      && Number.isFinite(Number(stored.headerSinceMs))
    );

    if (canResumeStoredTimer) {
      headerSinceMs = Number(stored.headerSinceMs) || headerSinceMs;
    }

    if (runtimeKey && normalizeText(state.lastRuntimePersistKey) !== runtimeKey) {
      headerSinceMs = Date.now();
      writeRuntimeState({
        key: runtimeKey,
        azId: nextAzId,
        product: nextProduct,
        productLabel: nextProductLabel,
        header: nextHeader,
        submissionNumber: nextSubmission,
        headerSinceMs,
        updatedAt: nowIso(),
        source: SCRIPT_NAME,
        version: VERSION
      });
      state.lastRuntimePersistKey = runtimeKey;
    } else if (runtimeKey) {
      const maybeUpdate = !stored.updatedAt || (Date.now() - Date.parse(stored.updatedAt || '')) > 5000 || normalizeText(stored.submissionNumber || '') !== nextSubmission;
      if (maybeUpdate) {
        writeRuntimeState({
          ...stored,
          key: runtimeKey,
          azId: nextAzId,
          product: nextProduct,
          productLabel: nextProductLabel,
          header: nextHeader,
          submissionNumber: nextSubmission,
          headerSinceMs,
          updatedAt: nowIso(),
          source: SCRIPT_NAME,
          version: VERSION
        });
      }
      state.lastRuntimePersistKey = runtimeKey;
    } else {
      state.lastRuntimePersistKey = '';
    }

    const headerLogKey = [nextAzId, nextProduct, nextHeader, headerSinceMs].join('|');
    if (nextHeader && state.lastHeaderLogKey !== headerLogKey) {
      state.lastHeaderLogKey = headerLogKey;
      log(`Header change: ${nextHeader}`);
    }

    const stageLogKey = [nextAzId, nextProduct, nextProductLabel].join('|');
    if (nextProductLabel && state.lastStageLogKey !== stageLogKey) {
      state.lastStageLogKey = stageLogKey;
      log(`Stage: ${nextProductLabel}`);
    }

    state.current = {
      azId: nextAzId,
      submission: nextSubmission,
      product: nextProduct,
      productLabel: nextProductLabel,
      header: nextHeader,
      headerSinceMs,
      pageName,
      pageAddress
    };

    maybeClearStalePendingWatchPost();
  }

  function buildEventContext() {
    const job = readCurrentJob();
    if (!job['AZ ID']) {
      return { ok: false, reason: 'Waiting for tm_pc_current_job_v1 / AZ ID' };
    }

    if (!state.current.product) {
      return { ok: false, reason: 'Unknown stage' };
    }
    if (!state.current.header) {
      return { ok: false, reason: 'Waiting for Guidewire header' };
    }

    const identity = getPageIdentity(state.current.submission);
    if (job['Name'] && identity.name && !namesLikelySame(job['Name'], identity.name)) {
      return { ok: false, reason: `Blocked save: current job Name mismatch | job=${job['Name']} | page=${identity.name}` };
    }
    if (job['Mailing Address'] && identity.mailingAddress && !addressesLikelySame(job['Mailing Address'], identity.mailingAddress)) {
      return { ok: false, reason: 'Blocked save: current job address mismatch' };
    }

    const mergedJob = mergeCurrentJob({
      'AZ ID': job['AZ ID'],
      'Name': job['Name'] || identity.name,
      'Mailing Address': job['Mailing Address'] || identity.mailingAddress,
      'SubmissionNumber': state.current.submission || job['SubmissionNumber']
    });

    return {
      ok: true,
      job: mergedJob,
      identity,
      product: state.current.product,
      productLabel: state.current.productLabel,
      header: state.current.header,
      headerSinceMs: Number(state.current.headerSinceMs) || Date.now(),
      submission: state.current.submission || mergedJob['SubmissionNumber'] || ''
    };
  }

  function buildTimeoutEvent(context) {
    const resultValue = `Header "${context.header}" did not change for 120 seconds`;
    const eventId = createEventId();
    const dedupeKey = buildTimeoutContextKey(context);

    return {
      eventId,
      id: eventId,
      dedupeKey,
      actionKey: `${context.product}_header_timeout`,
      triggerType: 'timeout',
      product: context.product,
      productLabel: context.productLabel,
      errorType: 'HeaderTimeout',
      errorName: 'HOME timeout',
      errorMessage: resultValue,
      errorText: resultValue,
      resultField: 'Done?',
      resultValue,
      headerText: context.header,
      submissionNumber: context.submission,
      selectorRuleId: '',
      detectedAt: nowIso(),
      source: SCRIPT_NAME,
      sourceVersion: VERSION,
      page: {
        url: location.href,
        title: document.title
      },
      identity: {
        'AZ ID': context.job['AZ ID'],
        'Name': context.job['Name'] || context.identity.name || '',
        'Mailing Address': context.job['Mailing Address'] || context.identity.mailingAddress || '',
        'SubmissionNumber': context.submission || context.job['SubmissionNumber'] || ''
      }
    };
  }

  function buildSelectorEvent(context, rule, matchInfo) {
    const savedErrorText = normalizeText(rule.savedErrorText || rule.errorText || '');
    const matchedElement = matchInfo?.element instanceof Element ? matchInfo.element : null;
    const matchedText = normalizeText(matchInfo?.matchedText || getVisibleElementLogText(matchedElement, 600));
    const eventId = createEventId();
    const dedupeKey = [
      'selector',
      context.job['AZ ID'],
      context.product,
      normalizeText(rule.ruleId || rule.id || '')
    ].join('|');

    return {
      eventId,
      id: eventId,
      dedupeKey,
      actionKey: `${context.product}_saved_selector_error`,
      triggerType: 'selector',
      product: context.product,
      productLabel: context.productLabel,
      errorType: 'SavedSelectorMatch',
      errorName: normalizeText(rule.label || 'Saved selector error'),
      errorMessage: savedErrorText,
      errorText: savedErrorText,
      resultField: context.product === 'home' ? 'Done?' : 'Auto',
      resultValue: savedErrorText,
      headerText: context.header,
      submissionNumber: context.submission,
      selectorRuleId: normalizeText(rule.ruleId || rule.id || ''),
      selector: normalizeText(rule.selector || ''),
      detectedAt: nowIso(),
      source: SCRIPT_NAME,
      sourceVersion: VERSION,
      capturedElementHtml: truncateText(matchedElement?.outerHTML || '', 4000),
      capturedText: truncateText(matchedText, 600),
      page: {
        url: location.href,
        title: document.title
      },
      identity: {
        'AZ ID': context.job['AZ ID'],
        'Name': context.job['Name'] || context.identity.name || '',
        'Mailing Address': context.job['Mailing Address'] || context.identity.mailingAddress || '',
        'SubmissionNumber': context.submission || context.job['SubmissionNumber'] || ''
      }
    };
  }

  function dispatchEvent(event, contextOverride = null, options = {}) {
    if (!options.manual && !timeoutActionsEnabled()) {
      log('Timeout actions are OFF. Event skipped.');
      setStatus(state.running ? 'Watching header' : 'Stopped');
      return false;
    }

    const context = isPlainObject(contextOverride) ? contextOverride : buildEventContext();
    if (!context.ok) {
      log(context.reason);
      return false;
    }

    if (hasSentOrPendingDedupe(event.dedupeKey)) {
      return false;
    }

    try {
      saveEventToBundle(context.product, context.job, event);
      rememberDispatchedEvent(event);
      if (event.triggerType === 'selector') {
        log(
          `Saved ${context.product.toUpperCase()} selector event to bundle | ` +
          `rule=${getRuleLogLabel(event)} | sentError=${quoteLogValue(event.errorText || '', 280)} | ` +
          `matchedText=${quoteLogValue(event.capturedText || '', 320)}`
        );
      } else {
        log(`Saved ${context.product.toUpperCase()} ${event.triggerType} event to bundle`);
      }
      raiseWebhookSendSignal(event, context);
      setStatus(state.running ? 'Watching header' : 'Stopped');
      renderAll();
      return true;
    } catch (err) {
      log(`Save failed: ${err?.message || err}`);
      setStatus('Save failed');
      renderAll();
      return false;
    }
  }

  function buildPendingWatchRecord(event, context) {
    return {
      mode: 'watch-timeout',
      status: 'pending',
      savedAt: nowIso(),
      alertWebhookSentAt: '',
      alertWebhookError: '',
      dedupeKey: normalizeText(event?.dedupeKey || ''),
      event: deepClone(event),
      context: {
        ok: true,
        job: deepClone(context?.job || {}),
        identity: deepClone(context?.identity || {}),
        product: normalizeText(context?.product || ''),
        productLabel: normalizeText(context?.productLabel || ''),
        header: normalizeText(context?.header || ''),
        headerSinceMs: Number(context?.headerSinceMs || 0),
        submission: normalizeText(context?.submission || '')
      }
    };
  }

  function buildWatchAlertWebhookBody(record, options = {}) {
    const test = options.test === true;
    return {
      message: WATCH_ALERT_MESSAGE,
      event: test ? 'gwpc_watch_mode_alert_test' : 'gwpc_watch_mode_alert',
      test,
      source: SCRIPT_NAME,
      version: VERSION,
      azId: normalizeText(record?.context?.job?.['AZ ID'] || record?.event?.identity?.['AZ ID'] || ''),
      product: normalizeText(record?.context?.productLabel || record?.context?.product || record?.event?.productLabel || record?.event?.product || ''),
      submissionNumber: normalizeText(record?.context?.submission || record?.event?.submissionNumber || ''),
      detectedAt: normalizeText(record?.event?.detectedAt || nowIso())
    };
  }

  function captureSelectableScreenText(maxChars = 50000) {
    const docs = getAllDocs();
    const blocks = [];
    const seen = new Set();

    for (const doc of docs) {
      let raw = '';
      try {
        raw = String(doc?.body?.innerText || doc?.documentElement?.innerText || '');
      } catch {}
      const text = normalizeScreenText(raw);
      if (!text || seen.has(text)) continue;
      seen.add(text);

      let urlLabel = '';
      try {
        const docUrl = normalizeText(doc?.location?.href || doc?.URL || '');
        if (docUrl && docUrl !== normalizeText(location.href)) {
          urlLabel = `URL: ${docUrl}\n`;
        }
      } catch {}

      blocks.push(`${urlLabel}${text}`);
    }

    const joined = blocks.join('\n\n-----\n\n').trim();
    if (!joined) {
      return {
        text: '',
        length: 0,
        truncated: false
      };
    }

    if (joined.length <= maxChars) {
      return {
        text: joined,
        length: joined.length,
        truncated: false
      };
    }

    const suffix = '\n\n[truncated]';
    return {
      text: `${joined.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`,
      length: joined.length,
      truncated: true
    };
  }

  function buildTimeoutTextWebhookBody(event, context, options = {}) {
    const test = options.test === true;
    const snapshot = captureSelectableScreenText(50000);
    return {
      message: test ? 'GWPC timeout text snapshot test' : normalizeText(event?.errorText || 'Header timeout'),
      event: test ? 'gwpc_timeout_text_snapshot_test' : 'gwpc_timeout_text_snapshot',
      test,
      source: SCRIPT_NAME,
      version: VERSION,
      azId: normalizeText(context?.job?.['AZ ID'] || event?.identity?.['AZ ID'] || ''),
      product: normalizeText(context?.productLabel || context?.product || event?.productLabel || event?.product || ''),
      header: normalizeText(context?.header || event?.headerText || ''),
      submissionNumber: normalizeText(context?.submission || event?.submissionNumber || ''),
      detectedAt: normalizeText(event?.detectedAt || nowIso()),
      url: location.href,
      title: document.title,
      screenText: snapshot.text,
      screenTextLength: snapshot.length,
      screenTextTruncated: snapshot.truncated
    };
  }

  function updatePendingWatchPostAlertState(patch) {
    const current = readPendingWatchPost();
    if (!current) return null;
    const next = {
      ...current,
      ...patch
    };
    writePendingWatchPost(next);
    return next;
  }

  async function sendWatchAlertWebhook(record, options = {}) {
    if (state.watchAlertWebhookBusy) {
      if (options.test === true) log('Alert webhook test skipped: already busy');
      return false;
    }

    const endpoint = options.url || getCurrentWatchAlertWebhookUrlFromUi();
    if (!isValidHttpUrl(endpoint)) {
      if (options.test === true) {
        setStatus('Alert webhook missing');
        log('Alert webhook test failed: webhook URL missing or invalid');
        renderButtons();
        renderAll();
      } else if (record?.dedupeKey) {
        updatePendingWatchPostAlertState({
          alertWebhookError: 'Webhook URL missing or invalid'
        });
        log('Watch alert webhook skipped: webhook URL missing or invalid');
      }
      return false;
    }

    persistWatchAlertWebhookFromUi(false);

    state.watchAlertWebhookBusy = true;
    renderButtons();
    if (options.test === true) {
      setStatus('Sending alert test...');
      log(`TEST ALERT POST ${endpoint}`);
    }

    try {
      const res = await gmPostJson(endpoint, buildWatchAlertWebhookBody(record, options), CFG.sharedRulesRequestTimeoutMs);
      const raw = typeof res?.responseText === 'string' ? res.responseText : '';
      const json = safeJsonParse(raw, null);
      if (Number(res?.status || 0) < 200 || Number(res?.status || 0) >= 400) {
        throw new Error(`HTTP ${res.status}${raw ? ` | ${raw.slice(0, 300)}` : ''}`);
      }
      if (json && json.ok === false) {
        throw new Error(json.error || json.message || 'Receiver returned ok:false');
      }

      if (options.test === true) {
        setStatus('Alert test sent');
        log('Alert webhook test success');
      } else if (record?.dedupeKey) {
        updatePendingWatchPostAlertState({
          alertWebhookSentAt: nowIso(),
          alertWebhookError: ''
        });
        log('Watch alert webhook sent');
      }
      return true;
    } catch (err) {
      const message = normalizeText(err?.message || err || 'Alert webhook failed') || 'Alert webhook failed';
      if (options.test === true) {
        setStatus('Alert test failed');
        log(`Alert webhook test failed: ${message}`);
      } else if (record?.dedupeKey) {
        updatePendingWatchPostAlertState({
          alertWebhookError: message
        });
        log(`Watch alert webhook failed: ${message}`);
      }
      return false;
    } finally {
      state.watchAlertWebhookBusy = false;
      renderButtons();
      renderAll();
    }
  }

  function maybeSendWatchAlertWebhook(record) {
    if (!isPlainObject(record?.event)) return;
    if (normalizeText(record.alertWebhookSentAt || '')) return;
    sendWatchAlertWebhook(record, { test: false }).catch(() => {});
  }

  async function sendTimeoutTextWebhookSnapshot(event, context, options = {}) {
    if (state.timeoutTextWebhookBusy) {
      if (options.test === true) log('Timeout text webhook test skipped: already busy');
      return false;
    }

    const endpoint = options.url || getCurrentTimeoutTextWebhookUrlFromUi();
    if (!isValidHttpUrl(endpoint)) {
      if (options.test === true) {
        setStatus('Text webhook missing');
        log('Timeout text webhook test failed: webhook URL missing or invalid');
        renderButtons();
        renderAll();
      }
      return false;
    }

    persistTimeoutTextWebhookFromUi(false);

    state.timeoutTextWebhookBusy = true;
    renderButtons();
    if (options.test === true) {
      setStatus('Sending text test...');
      log(`TEST TEXT POST ${endpoint}`);
    }

    try {
      const res = await gmPostJson(endpoint, buildTimeoutTextWebhookBody(event, context, options), 8000);
      const raw = typeof res?.responseText === 'string' ? res.responseText : '';
      const json = safeJsonParse(raw, null);
      if (Number(res?.status || 0) < 200 || Number(res?.status || 0) >= 400) {
        throw new Error(`HTTP ${res.status}${raw ? ` | ${raw.slice(0, 300)}` : ''}`);
      }
      if (json && json.ok === false) {
        throw new Error(json.error || json.message || 'Receiver returned ok:false');
      }

      if (options.test === true) {
        setStatus('Text test sent');
        log('Timeout text webhook test success');
      } else {
        log('Timeout text webhook sent');
      }
      return true;
    } catch (err) {
      const message = normalizeText(err?.message || err || 'Timeout text webhook failed') || 'Timeout text webhook failed';
      if (options.test === true) {
        setStatus('Text test failed');
        log(`Timeout text webhook test failed: ${message}`);
      } else {
        log(`Timeout text webhook failed: ${message}`);
      }
      return false;
    } finally {
      state.timeoutTextWebhookBusy = false;
      renderButtons();
      renderAll();
    }
  }

  function queueTimeoutTextWebhookThenDispatch(event, context) {
    const dedupeKey = normalizeText(event?.dedupeKey || '');
    if (dedupeKey && state.timeoutDispatchInFlightKey === dedupeKey) return;
    state.timeoutDispatchInFlightKey = dedupeKey;

    (async () => {
      try {
        await sendTimeoutTextWebhookSnapshot(event, context, { test: false });
      } catch {}
      try {
        dispatchEvent(event, context);
      } finally {
        if (!dedupeKey || state.timeoutDispatchInFlightKey === dedupeKey) {
          state.timeoutDispatchInFlightKey = '';
        }
        renderButtons();
        renderAll();
      }
    })().catch((err) => {
      log(`Timeout dispatch queue failed: ${err?.message || err}`);
      if (!dedupeKey || state.timeoutDispatchInFlightKey === dedupeKey) {
        state.timeoutDispatchInFlightKey = '';
      }
      dispatchEvent(event, context);
      renderButtons();
      renderAll();
    });
  }

  function closeWatchAlert(message = '', options = {}) {
    state.watchAlertOpen = false;
    const overlay = $('#tm-timeout-watch-alert-overlay');
    if (overlay) overlay.remove();

    if (options.preservePending !== false) {
      const pending = readPendingWatchPost();
      if (pending && pending.status === 'pending' && options.dismissPending === true) {
        writePendingWatchPost({
          ...pending,
          status: 'dismissed',
          dismissedAt: nowIso()
        });
      }
    } else {
      clearPendingWatchPost();
    }

    if (options.logIt !== false && normalizeText(message)) log(message);
    if (!state.destroyed) {
      setStatus(options.dismissPending === true ? 'Idle' : (state.running ? 'Watching header' : 'Stopped'));
      renderButtons();
      renderAll();
    }
  }

  function openWatchAlert(record) {
    if (!isPlainObject(record?.event)) return;
    if (state.watchAlertOpen && $('#tm-timeout-watch-alert-overlay')) return;

    const existing = $('#tm-timeout-watch-alert-overlay');
    if (existing) existing.remove();

    state.watchAlertOpen = true;
    const overlay = document.createElement('div');
    overlay.id = 'tm-timeout-watch-alert-overlay';
    overlay.setAttribute(UI_MARKER_ATTR, '1');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: String(CFG.zIndex),
      background: 'rgba(15, 23, 42, 0.35)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    });

    overlay.innerHTML = `
      <div ${UI_MARKER_ATTR}="1" style="position:relative;width:min(360px,90vw);min-height:220px;border:3px solid rgba(248,113,113,0.95);background:#7f1d1d;color:#fee2e2;border-radius:18px;box-shadow:0 22px 60px rgba(0,0,0,.45);padding:20px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:12px;">
        <button ${UI_MARKER_ATTR}="1" id="tm-timeout-watch-alert-close" type="button" style="position:absolute;top:10px;right:10px;border:0;background:transparent;color:#fff;font-size:24px;line-height:1;cursor:pointer;">X</button>
        <div ${UI_MARKER_ATTR}="1" style="font-size:20px;font-weight:900;">TIMEOUT CAPTURED</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:14px;font-weight:700;">${escapeHtml(String(record.context?.productLabel || record.event?.product || '').toUpperCase() || 'TIMEOUT')}</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:13px;line-height:1.5;max-width:280px;">${escapeHtml(record.event?.errorText || 'Header timeout captured in watch mode.')}</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:12px;opacity:.92;">Manual push is available in the panel while watch mode stays ON.</div>
      </div>
    `;

    document.documentElement.appendChild(overlay);
    $('#tm-timeout-watch-alert-close', overlay)?.addEventListener('click', () => {
      closeWatchAlert('Watch alert dismissed', { dismissPending: true });
    });

    setStatus('Watch mode timeout');
    renderButtons();
    renderAll();
  }

  function syncWatchAlertFromStorage() {
    const pending = readPendingWatchPost();
    if (!state.watchModeEnabled || !pending) {
      closeWatchAlert('', { logIt: false, preservePending: true });
      return;
    }
    if (pending.status === 'pending') {
      maybeSendWatchAlertWebhook(pending);
      openWatchAlert(pending);
      return;
    }
    state.watchAlertOpen = false;
    const overlay = $('#tm-timeout-watch-alert-overlay');
    if (overlay) overlay.remove();
    renderButtons();
    renderAll();
  }

  function maybeClearStalePendingWatchPost() {
    const pending = readPendingWatchPost();
    if (!pending) return;
    const currentKey = buildTimeoutContextKey({
      job: { 'AZ ID': state.current.azId || '' },
      product: state.current.product || '',
      header: state.current.header || '',
      headerSinceMs: state.current.headerSinceMs || 0
    });
    const pendingKey = normalizeText(pending.dedupeKey || '');
    if (!currentKey || !pendingKey || currentKey === pendingKey) return;
    closeWatchAlert('', { logIt: false, preservePending: false });
    log('Cleared stale watch-mode timeout payload');
  }

  function dispatchPendingWatchPost() {
    const pending = readPendingWatchPost();
    if (!state.watchModeEnabled || !pending?.event) return false;

    const ok = dispatchEvent(pending.event, pending.context, { manual: true });
    if (ok) {
      closeWatchAlert('Watch payload pushed manually', { logIt: false, preservePending: false });
      log('Watch payload pushed manually');
      return true;
    }

    setStatus('Manual push blocked');
    renderButtons();
    renderAll();
    return false;
  }

  function processHeaderTimeout() {
    if (!timeoutActionsEnabled()) return;
    const context = buildEventContext();
    if (!context.ok) {
      logWait(`timeout:${context.reason}`, context.reason);
      return;
    }

    clearWaitLog();

    const ageMs = Date.now() - Number(context.headerSinceMs || Date.now());
    if (ageMs < CFG.timeoutMs) return;

    const event = buildTimeoutEvent(context);
    if (hasSentOrPendingDedupe(event.dedupeKey)) return;

    if (state.watchModeEnabled) {
      const pending = readPendingWatchPost();
      if (!pending || normalizeText(pending.dedupeKey || '') !== normalizeText(event.dedupeKey)) {
        writePendingWatchPost(buildPendingWatchRecord(event, context));
        log(`Watch mode captured ${context.product.toUpperCase()} timeout; waiting for manual push or dismiss`);
        const saved = readPendingWatchPost();
        maybeSendWatchAlertWebhook(saved);
        openWatchAlert(saved);
      } else if (pending.status === 'pending') {
        maybeSendWatchAlertWebhook(pending);
        openWatchAlert(pending);
      }
      return;
    }

    if (tryTimeoutLauncherRecovery(context)) return;

    queueTimeoutTextWebhookThenDispatch(event, context);
  }

  function sharedRulesSyncEnabled() {
    return CFG.sharedRulesEnabled === true
      && savedSelectorRulesEnabled()
      && !!normalizeText(CFG.sharedRulesEndpoint)
      && !!normalizeText(CFG.sharedRulesKey)
      && typeof GM_xmlhttpRequest === 'function';
  }

  function createSharedRulesClientId() {
    return `timeout_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
  }

  function ensureSharedRulesClientId() {
    try {
      const current = normalizeText(localStorage.getItem(KEYS.sharedRulesClientId) || '');
      if (current) return current;
      const created = createSharedRulesClientId();
      localStorage.setItem(KEYS.sharedRulesClientId, created);
      return created;
    } catch {
      return createSharedRulesClientId();
    }
  }

  function readSelectorRuleTombstones() {
    const raw = safeJsonParse(localStorage.getItem(KEYS.selectorRuleTombstones), {});
    const source = isPlainObject(raw) ? raw : {};
    const out = {};
    Object.entries(source).forEach(([ruleId, value]) => {
      const id = normalizeText(ruleId || value?.ruleId || '');
      if (!id) return;
      out[id] = {
        ruleId: id,
        disabledAt: normalizeText(value?.disabledAt || value?.updatedAt || ''),
        updatedBy: normalizeText(value?.updatedBy || ''),
        clientId: normalizeText(value?.clientId || '')
      };
    });
    return out;
  }

  function writeSelectorRuleTombstones(tombstones) {
    const next = {};
    Object.values(isPlainObject(tombstones) ? tombstones : {}).forEach((value) => {
      const id = normalizeText(value?.ruleId || '');
      if (!id) return;
      next[id] = {
        ruleId: id,
        disabledAt: normalizeText(value?.disabledAt || nowIso()),
        updatedBy: normalizeText(value?.updatedBy || ''),
        clientId: normalizeText(value?.clientId || '')
      };
    });
    localStorage.setItem(KEYS.selectorRuleTombstones, JSON.stringify(next, null, 2));
    return next;
  }

  function clearSelectorRuleTombstonesForIds(ruleIds) {
    const ids = Array.isArray(ruleIds) ? ruleIds.map((value) => normalizeText(value)).filter(Boolean) : [];
    if (!ids.length) return;
    const tombstones = readSelectorRuleTombstones();
    let changed = false;
    ids.forEach((id) => {
      if (!tombstones[id]) return;
      delete tombstones[id];
      changed = true;
    });
    if (changed) writeSelectorRuleTombstones(tombstones);
  }

  function addSelectorRuleTombstones(ruleIds) {
    const ids = Array.isArray(ruleIds) ? ruleIds.map((value) => normalizeText(value)).filter(Boolean) : [];
    if (!ids.length) return;
    const tombstones = readSelectorRuleTombstones();
    const clientId = ensureSharedRulesClientId();
    ids.forEach((id) => {
      tombstones[id] = {
        ruleId: id,
        disabledAt: nowIso(),
        updatedBy: clientId,
        clientId
      };
    });
    writeSelectorRuleTombstones(tombstones);
  }

  function ruleTimestampMs(rule) {
    if (!isPlainObject(rule)) return 0;
    const updatedMs = Date.parse(normalizeText(rule.updatedAt || ''));
    if (Number.isFinite(updatedMs) && updatedMs > 0) return updatedMs;
    const createdMs = Date.parse(normalizeText(rule.createdAt || ''));
    return Number.isFinite(createdMs) && createdMs > 0 ? createdMs : 0;
  }

  function tombstoneTimestampMs(tombstone) {
    if (!isPlainObject(tombstone)) return 0;
    const ms = Date.parse(normalizeText(tombstone.disabledAt || ''));
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  function buildRulesSignature(rules) {
    const normalized = (Array.isArray(rules) ? rules : [])
      .map((rule) => ({
        ruleId: normalizeText(rule?.ruleId || ''),
        selector: normalizeText(rule?.selector || ''),
        label: normalizeText(rule?.label || ''),
        savedErrorText: normalizeText(rule?.savedErrorText || ''),
        enabled: rule?.enabled === false ? false : true,
        updatedAt: normalizeText(rule?.updatedAt || ''),
        createdAt: normalizeText(rule?.createdAt || ''),
        fingerprint: isPlainObject(rule?.fingerprint) ? {
          tag: normalizeText(rule.fingerprint.tag || ''),
          id: normalizeText(rule.fingerprint.id || ''),
          name: normalizeText(rule.fingerprint.name || ''),
          role: normalizeText(rule.fingerprint.role || ''),
          ariaLabel: normalizeText(rule.fingerprint.ariaLabel || ''),
          classTokens: Array.isArray(rule.fingerprint.classTokens) ? rule.fingerprint.classTokens.map((value) => normalizeText(value)).filter(Boolean) : [],
          textFingerprint: normalizeText(rule.fingerprint.textFingerprint || '')
        } : {}
      }))
      .filter((rule) => rule.ruleId)
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    return JSON.stringify(normalized);
  }

  function buildTombstonesSignature(tombstones) {
    const normalized = Object.values(isPlainObject(tombstones) ? tombstones : {})
      .map((value) => ({
        ruleId: normalizeText(value?.ruleId || ''),
        disabledAt: normalizeText(value?.disabledAt || ''),
        updatedBy: normalizeText(value?.updatedBy || ''),
        clientId: normalizeText(value?.clientId || '')
      }))
      .filter((value) => value.ruleId)
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    return JSON.stringify(normalized);
  }

  function writeSelectorRulesLocal(rules) {
    if (!savedSelectorRulesEnabled()) {
      try { localStorage.removeItem(KEYS.selectorRules); } catch {}
      renderManageRulesModal();
      renderAll();
      return;
    }
    localStorage.setItem(KEYS.selectorRules, JSON.stringify(rules, null, 2));
    renderManageRulesModal();
    renderAll();
  }

  function buildSharedRulesUrl(params = {}) {
    const url = new URL(CFG.sharedRulesEndpoint);
    Object.entries(params).forEach(([key, value]) => {
      if (value == null || value === '') return;
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function requestSharedRules(method, url, payload = null) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method,
          url,
          headers: payload ? { 'Content-Type': 'application/json' } : {},
          data: payload ? JSON.stringify(payload) : undefined,
          timeout: CFG.sharedRulesRequestTimeoutMs,
          onload: (response) => {
            const status = Number(response?.status || 0);
            if (status < 200 || status >= 300) {
              reject(new Error(`HTTP ${status || 'request failed'}`));
              return;
            }
            const parsed = safeJsonParse(response?.responseText || '', null);
            if (!isPlainObject(parsed)) {
              reject(new Error('Invalid JSON response'));
              return;
            }
            if (parsed.ok === false) {
              reject(new Error(normalizeText(parsed.error || 'Remote request failed') || 'Remote request failed'));
              return;
            }
            resolve(parsed);
          },
          onerror: () => reject(new Error('Network error')),
          ontimeout: () => reject(new Error('Request timeout'))
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function gmPostJson(url, data, timeoutMs) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: 'POST',
          url,
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify(data),
          timeout: timeoutMs,
          onload: (res) => resolve(res),
          onerror: () => reject(new Error('Network error')),
          ontimeout: () => reject(new Error('Request timeout'))
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async function fetchSharedSelectorRules() {
    const response = await requestSharedRules('GET', buildSharedRulesUrl({
      action: 'listRules',
      key: CFG.sharedRulesKey,
      includeDisabled: 'true'
    }));
    const rules = Array.isArray(response.rules) ? response.rules : [];
    return rules.map(normalizeRule).filter(Boolean);
  }

  async function upsertSharedSelectorRule(rule) {
    const clientId = ensureSharedRulesClientId();
    const normalizedRule = normalizeRule({
      ...rule,
      enabled: true,
      sourceScript: SCRIPT_NAME,
      sourceVersion: VERSION,
      updatedBy: clientId,
      clientId
    });
    if (!normalizedRule || !normalizedRule.ruleId) return;
    await requestSharedRules('POST', CFG.sharedRulesEndpoint, {
      action: 'upsertRule',
      key: CFG.sharedRulesKey,
      rule: {
        ruleId: normalizedRule.ruleId,
        enabled: true,
        label: normalizedRule.label,
        savedErrorText: normalizedRule.savedErrorText,
        selector: normalizedRule.selector,
        fingerprint: normalizedRule.fingerprint,
        createdAt: normalizedRule.createdAt,
        sourceScript: SCRIPT_NAME,
        sourceVersion: VERSION,
        updatedBy: clientId,
        clientId
      }
    });
  }

  async function disableSharedSelectorRule(ruleId) {
    const id = normalizeText(ruleId || '');
    if (!id) return;
    const clientId = ensureSharedRulesClientId();
    await requestSharedRules('POST', CFG.sharedRulesEndpoint, {
      action: 'disableRule',
      key: CFG.sharedRulesKey,
      ruleId: id,
      updatedBy: clientId,
      clientId
    });
  }

  function reconcileSharedSelectorRules(localRules, remoteRules, tombstones, options = {}) {
    const preferRemoteDisabled = options.preferRemoteDisabled === true;
    const localMap = new Map((Array.isArray(localRules) ? localRules : []).map((rule) => [normalizeText(rule.ruleId || ''), rule]).filter(([id]) => id));
    const remoteMap = new Map((Array.isArray(remoteRules) ? remoteRules : []).map((rule) => [normalizeText(rule.ruleId || ''), rule]).filter(([id]) => id));
    const tombstoneMap = new Map(Object.entries(isPlainObject(tombstones) ? tombstones : {}).map(([id, value]) => [normalizeText(id), value]).filter(([id]) => id));

    const nextRules = [];
    const nextTombstones = {};
    const upserts = [];
    const disables = new Set();

    const allRuleIds = new Set([
      ...localMap.keys(),
      ...remoteMap.keys(),
      ...tombstoneMap.keys()
    ]);

    for (const ruleId of allRuleIds) {
      const localRule = localMap.get(ruleId) || null;
      const remoteRule = remoteMap.get(ruleId) || null;
      const tombstone = tombstoneMap.get(ruleId) || null;

      const localMs = ruleTimestampMs(localRule);
      const remoteMs = ruleTimestampMs(remoteRule);
      const tombstoneMs = tombstoneTimestampMs(tombstone);
      const remoteEnabled = remoteRule ? remoteRule.enabled !== false : false;

      if (remoteRule && remoteEnabled === false) {
        if (preferRemoteDisabled) {
          nextTombstones[ruleId] = {
            ruleId,
            disabledAt: normalizeText(remoteRule.updatedAt || tombstone?.disabledAt || nowIso()),
            updatedBy: normalizeText(remoteRule.updatedBy || tombstone?.updatedBy || ''),
            clientId: normalizeText(remoteRule.clientId || tombstone?.clientId || '')
          };
          continue;
        }
        if (localRule && localMs > Math.max(remoteMs, tombstoneMs)) {
          nextRules.push(localRule);
          upserts.push(localRule);
        } else {
          nextTombstones[ruleId] = {
            ruleId,
            disabledAt: normalizeText(remoteRule.updatedAt || tombstone?.disabledAt || nowIso()),
            updatedBy: normalizeText(remoteRule.updatedBy || tombstone?.updatedBy || ''),
            clientId: normalizeText(remoteRule.clientId || tombstone?.clientId || '')
          };
        }
        continue;
      }

      if (tombstone && tombstoneMs >= Math.max(localMs, remoteMs)) {
        if (remoteRule && remoteEnabled) disables.add(ruleId);
        nextTombstones[ruleId] = tombstone;
        continue;
      }

      if (localRule && remoteRule && remoteEnabled) {
        if (remoteMs > localMs) nextRules.push(remoteRule);
        else {
          nextRules.push(localRule);
          if (localMs > remoteMs) upserts.push(localRule);
        }
        continue;
      }

      if (localRule) {
        nextRules.push(localRule);
        upserts.push(localRule);
        continue;
      }

      if (remoteRule && remoteEnabled) {
        nextRules.push(remoteRule);
      }
    }

    nextRules.sort((a, b) => ruleTimestampMs(b) - ruleTimestampMs(a));

    return {
      rules: nextRules,
      tombstones: nextTombstones,
      upserts,
      disables: Array.from(disables)
    };
  }

  async function syncSharedRules(options = {}) {
    if (!sharedRulesSyncEnabled()) return false;
    const force = options.force === true;
    const isBootSync = normalizeText(options.reason || '') === 'boot';
    if (!force && state.lastSharedRulesSyncAt && (Date.now() - state.lastSharedRulesSyncAt) < CFG.sharedRulesRefreshMs) {
      return false;
    }

    state.sharedRulesSyncing = true;
    renderButtons();

    try {
      const localRules = getSelectorRules();
      const tombstones = readSelectorRuleTombstones();
      const remoteRules = await fetchSharedSelectorRules();
      const reconciled = reconcileSharedSelectorRules(localRules, remoteRules, tombstones, {
        preferRemoteDisabled: isBootSync
      });

      const localSignature = buildRulesSignature(localRules);
      const nextSignature = buildRulesSignature(reconciled.rules);
      if (localSignature !== nextSignature) {
        writeSelectorRulesLocal(reconciled.rules);
      }

      const tombstoneSignature = buildTombstonesSignature(tombstones);
      const nextTombstoneSignature = buildTombstonesSignature(reconciled.tombstones);
      if (tombstoneSignature !== nextTombstoneSignature) {
        writeSelectorRuleTombstones(reconciled.tombstones);
      }

      for (const rule of reconciled.upserts) {
        await upsertSharedSelectorRule(rule);
      }

      for (const ruleId of reconciled.disables) {
        await disableSharedSelectorRule(ruleId);
      }

      state.lastSharedRulesSyncAt = Date.now();
      state.lastSharedRulesSyncError = '';

      const pulledCount = localSignature !== nextSignature ? reconciled.rules.length : 0;
      const changedCount = reconciled.upserts.length + reconciled.disables.length;
      if (options.manual === true || options.reason === 'boot' || pulledCount || changedCount) {
        log(`Shared rules sync complete | local=${reconciled.rules.length} | pushed=${reconciled.upserts.length} | disabled=${reconciled.disables.length}`);
      }
      return true;
    } catch (err) {
      const message = normalizeText(err?.message || err || 'Shared rules sync failed') || 'Shared rules sync failed';
      if (state.lastSharedRulesSyncError !== message) {
        state.lastSharedRulesSyncError = message;
        log(`Shared rules sync failed: ${message}`);
      }
      return false;
    } finally {
      const releaseBootGate = isBootSync && state.bootSharedRulesPending;
      if (releaseBootGate) {
        state.bootSharedRulesPending = false;
      }
      state.sharedRulesSyncing = false;
      renderButtons();
      if (releaseBootGate && !state.destroyed) {
        setTimeout(() => {
          scheduleScan('boot-shared-rules-ready');
        }, 0);
      }
      if (state.sharedRulesSyncQueued) {
        state.sharedRulesSyncQueued = false;
        setTimeout(() => {
          syncSharedRules({ force: true, reason: 'queued' }).catch(() => {});
        }, 0);
      }
    }
  }

  function scheduleSharedRulesSync(reason, options = {}) {
    if (!sharedRulesSyncEnabled()) return;
    if (state.sharedRulesSyncing) {
      state.sharedRulesSyncQueued = true;
      return;
    }
    syncSharedRules({
      force: options.force === true,
      manual: options.manual === true,
      reason: normalizeText(reason || '')
    }).catch(() => {});
  }

  function buildRuleId(selector, textFingerprint) {
    return `rule_${hashString([normalizeText(selector), normalizeText(textFingerprint)].join('|'))}`;
  }

  function getStableClassTokens(el) {
    return Array.from(el.classList || [])
      .filter((name) => /^gw-|^iv360-|^mat-|^mdc-/.test(name))
      .slice(0, 4);
  }

  function buildElementFingerprint(el) {
    if (!(el instanceof Element)) return {};
    return {
      tag: String(el.tagName || '').toLowerCase(),
      id: normalizeText(el.id || ''),
      name: normalizeText(el.getAttribute('name') || ''),
      role: normalizeText(el.getAttribute('role') || ''),
      ariaLabel: normalizeText(el.getAttribute('aria-label') || ''),
      classTokens: getStableClassTokens(el),
      textFingerprint: truncateText(el.innerText || el.textContent || '', 160)
    };
  }

  function isUniqueSelector(selector, doc) {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function buildStableSelector(el) {
    if (!(el instanceof Element)) return '';
    const doc = el.ownerDocument || document;

    if (el.id) return `#${cssEscape(el.id)}`;

    const name = normalizeText(el.getAttribute('name') || '');
    if (name) {
      const selector = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      if (isUniqueSelector(selector, doc)) return selector;
    }

    const aria = normalizeText(el.getAttribute('aria-label') || '');
    if (aria) {
      const selector = `${el.tagName.toLowerCase()}[aria-label="${cssEscape(aria)}"]`;
      if (isUniqueSelector(selector, doc)) return selector;
    }

    const role = normalizeText(el.getAttribute('role') || '');
    if (role && aria) {
      const selector = `${el.tagName.toLowerCase()}[role="${cssEscape(role)}"][aria-label="${cssEscape(aria)}"]`;
      if (isUniqueSelector(selector, doc)) return selector;
    }

    let current = el;
    const parts = [];
    while (current && current.nodeType === 1 && current !== doc.body && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${cssEscape(current.id)}`;
        parts.unshift(part);
        break;
      }

      const classes = getStableClassTokens(current);
      if (classes.length) {
        part += `.${classes.map(cssEscape).join('.')}`;
      } else if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children)
          .filter((node) => node.tagName === current.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      const candidate = parts.join(' > ');
      if (isUniqueSelector(candidate, doc)) return candidate;
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function normalizeRule(raw) {
    if (!isPlainObject(raw)) return null;
    const enabled = raw.enabled === false ? false : toBoolean(raw.enabled, true);
    const selector = normalizeText(raw.selector || raw.cssSelector || '');
    const fingerprintRaw = isPlainObject(raw.fingerprint) ? raw.fingerprint : {};
    const fingerprintScopeRaw = isPlainObject(fingerprintRaw.scope) ? fingerprintRaw.scope : {};
    const scopeProduct = normalizeText(
      raw.scopeProduct ||
      raw.product ||
      fingerprintRaw.scopeProduct ||
      fingerprintScopeRaw.product ||
      ''
    ).toLowerCase();
    const scopeHeader = normalizeText(
      raw.scopeHeader ||
      raw.header ||
      fingerprintRaw.scopeHeader ||
      fingerprintScopeRaw.header ||
      ''
    );
    const savedErrorText = normalizeText(
      raw.savedErrorText ||
      raw.errorText ||
      raw.customMessage ||
      raw.resultValue ||
      raw.textSample ||
      raw.errorName ||
      ''
    );

    const textFingerprint = truncateText(
      raw.fingerprint?.textFingerprint ||
      raw.textFingerprint ||
      raw.textSample ||
      '',
      160
    );

    const fingerprint = isPlainObject(raw.fingerprint)
      ? {
          tag: normalizeText(fingerprintRaw.tag || ''),
          id: normalizeText(fingerprintRaw.id || ''),
          name: normalizeText(fingerprintRaw.name || ''),
          role: normalizeText(fingerprintRaw.role || ''),
          ariaLabel: normalizeText(fingerprintRaw.ariaLabel || ''),
          classTokens: Array.isArray(fingerprintRaw.classTokens)
            ? fingerprintRaw.classTokens.map((value) => normalizeText(value)).filter(Boolean).slice(0, 4)
            : [],
          textFingerprint,
          scope: {
            product: scopeProduct,
            header: scopeHeader
          }
        }
      : {
          tag: '',
          id: '',
          name: '',
          role: '',
          ariaLabel: '',
          classTokens: [],
          textFingerprint,
          scope: {
            product: scopeProduct,
            header: scopeHeader
          }
        };

    const ruleId = normalizeText(raw.ruleId || raw.id || buildRuleId(selector, textFingerprint));
    if (!ruleId) return null;
    if (enabled && !selector) return null;
    if (enabled && !savedErrorText) return null;

    return {
      ruleId,
      enabled,
      selector,
      label: normalizeText(raw.label || raw.errorName || 'Saved selector error'),
      savedErrorText,
      fingerprint,
      scopeProduct,
      scopeHeader,
      createdAt: normalizeText(raw.createdAt || nowIso()),
      updatedAt: normalizeText(raw.updatedAt || raw.createdAt || nowIso()),
      sourceScript: normalizeText(raw.sourceScript || ''),
      sourceVersion: normalizeText(raw.sourceVersion || ''),
      updatedBy: normalizeText(raw.updatedBy || ''),
      clientId: normalizeText(raw.clientId || '')
    };
  }

  function getSelectorRules() {
    if (!savedSelectorRulesEnabled()) return [];
    const parsed = safeJsonParse(localStorage.getItem(KEYS.selectorRules), []);
    const list = Array.isArray(parsed) ? parsed : [];
    const normalized = list.map(normalizeRule).filter((rule) => !!rule && rule.enabled !== false);
    return normalized;
  }

  function buildRuleFingerprintWithScope(fingerprint, context = {}) {
    const base = isPlainObject(fingerprint) ? { ...fingerprint } : {};
    base.scope = {
      product: normalizeText(context?.product || '').toLowerCase(),
      header: normalizeText(context?.header || '')
    };
    return base;
  }

  function getSelectorRuleScopeFailure(rule, context) {
    const scopeProduct = normalizeText(rule?.scopeProduct || '').toLowerCase();
    const scopeHeader = normalizeText(rule?.scopeHeader || '');
    const selector = normalizeText(rule?.selector || '');
    const textFingerprint = normalizeText(rule?.fingerprint?.textFingerprint || '');
    const currentProduct = normalizeText(context?.product || '').toLowerCase();
    const currentHeader = normalizeText(context?.header || '');

    if (scopeProduct && scopeProduct !== currentProduct) {
      return `rule scoped to ${scopeProduct}`;
    }
    if (scopeHeader && scopeHeader !== currentHeader) {
      return `rule scoped to header "${scopeHeader}"`;
    }
    if (!textFingerprint && !is360ValueRule(rule, selector)) {
      return 'rule missing text fingerprint';
    }
    if (!scopeProduct && !scopeHeader && !textFingerprint) {
      return 'legacy rule missing scope and text fingerprint';
    }
    return '';
  }

  function saveSelectorRules(rules, options = {}) {
    if (!savedSelectorRulesEnabled()) {
      try { localStorage.removeItem(KEYS.selectorRules); } catch {}
      renderManageRulesModal();
      renderAll();
      return;
    }
    const normalizedRules = (Array.isArray(rules) ? rules : []).map(normalizeRule).filter((rule) => !!rule && rule.enabled !== false);
    writeSelectorRulesLocal(normalizedRules);
    clearSelectorRuleTombstonesForIds(normalizedRules.map((rule) => rule.ruleId));
    if (options.sync !== false) {
      scheduleSharedRulesSync(options.reason || 'local-rules-changed', { force: true, manual: options.manual === true });
    }
  }

  function isScriptUiElement(el) {
    return !!(el instanceof Element && el.closest(`[${UI_MARKER_ATTR}="1"]`));
  }

  function resolveSelectableElementAtPoint(clientX, clientY) {
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [];

    for (const node of stack) {
      if (!(node instanceof Element)) continue;
      if (isScriptUiElement(node)) return null;
      if (!isVisible(node)) continue;
      if (node === document.documentElement || node === document.body) continue;
      return node;
    }
    return null;
  }

  function ensureHoverBox() {
    if (state.hoverBoxEl && document.contains(state.hoverBoxEl)) return state.hoverBoxEl;
    const box = document.createElement('div');
    box.setAttribute(UI_MARKER_ATTR, '1');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: String(CFG.zIndex - 1),
      pointerEvents: 'none',
      border: `1px solid ${CFG.selectorOutlineColor}`,
      background: CFG.selectorFillColor,
      boxSizing: 'border-box',
      borderRadius: '4px',
      display: 'none'
    });
    document.documentElement.appendChild(box);
    state.hoverBoxEl = box;
    return box;
  }

  function hideHoverBox() {
    state.hoveredEl = null;
    if (state.hoverBoxEl) state.hoverBoxEl.style.display = 'none';
  }

  function updateHoverBox(target) {
    if (!(target instanceof Element) || !isVisible(target) || isScriptUiElement(target)) {
      hideHoverBox();
      return;
    }
    const box = ensureHoverBox();
    const rect = target.getBoundingClientRect();
    const inset = 2;
    state.hoveredEl = target;
    Object.assign(box.style, {
      display: 'block',
      top: `${Math.max(0, rect.top + inset)}px`,
      left: `${Math.max(0, rect.left + inset)}px`,
      width: `${Math.max(0, rect.width - (inset * 2))}px`,
      height: `${Math.max(0, rect.height - (inset * 2))}px`
    });
  }

  function bindSelectorListeners() {
    unbindSelectorListeners();

    const onMove = (event) => {
      if (!state.selectorMode) return;
      if (isScriptUiElement(event.target)) {
        hideHoverBox();
        return;
      }
      updateHoverBox(resolveSelectableElementAtPoint(event.clientX, event.clientY));
    };

    const onClick = (event) => {
      if (!state.selectorMode) return;
      if (isScriptUiElement(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const target = resolveSelectableElementAtPoint(event.clientX, event.clientY);
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();
      openSaveRuleModal(target);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSelectorSession('Selector canceled');
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);

    state.selectorListeners = [
      () => document.removeEventListener('mousemove', onMove, true),
      () => document.removeEventListener('click', onClick, true),
      () => document.removeEventListener('keydown', onKeyDown, true)
    ];
  }

  function unbindSelectorListeners() {
    for (const cleanupFn of state.selectorListeners) {
      try { cleanupFn(); } catch {}
    }
    state.selectorListeners = [];
  }

  function publishSelectorPause() {
    const alreadyPaused = localStorage.getItem(GLOBAL_PAUSE_KEY) === '1';
    const pauseState = {
      active: true,
      createdPause: !alreadyPaused,
      previousPause: alreadyPaused,
      savedAt: nowIso(),
      source: SCRIPT_NAME
    };

    try {
      localStorage.setItem(KEYS.selectorPauseState, JSON.stringify(pauseState, null, 2));
      localStorage.setItem(GLOBAL_PAUSE_KEY, '1');
    } catch {}
  }

  function restoreSelectorPause() {
    const pauseState = safeJsonParse(localStorage.getItem(KEYS.selectorPauseState), null);
    if (!isPlainObject(pauseState)) return;

    try {
      if (pauseState.createdPause) {
        localStorage.removeItem(GLOBAL_PAUSE_KEY);
      }
    } catch {}

    try { localStorage.removeItem(KEYS.selectorPauseState); } catch {}
  }

  function restoreStaleSelectorPause() {
    const pauseState = safeJsonParse(localStorage.getItem(KEYS.selectorPauseState), null);
    if (!isPlainObject(pauseState)) return;
    if (!pauseState.active) {
      try { localStorage.removeItem(KEYS.selectorPauseState); } catch {}
      return;
    }
    restoreSelectorPause();
  }

  function startSelectorMode() {
    if (!savedSelectorRulesEnabled()) {
      log('Saved selector rules are disabled in this version');
      setStatus(state.running ? 'Watching header' : 'Stopped');
      renderButtons();
      renderAll();
      return;
    }
    if (state.selectorMode || state.modalOpen) return;

    publishSelectorPause();
    state.selectorMode = true;
    state.modalOpen = false;
    bindSelectorListeners();
    hideHoverBox();
    setStatus('Selector mode');
    log('Selector mode enabled');
    renderButtons();
    renderAll();
  }

  function closeSelectorSession(message, options = {}) {
    state.selectorMode = false;
    state.modalOpen = false;
    unbindSelectorListeners();
    hideHoverBox();
    removeSaveRuleModal();
    if (options.restorePause !== false) restoreSelectorPause();
    if (options.logIt !== false && normalizeText(message)) log(message);
    if (!state.destroyed) setStatus(state.running ? 'Watching header' : 'Stopped');
    renderButtons();
    renderAll();
  }

  function openSaveRuleModal(target) {
    if (!savedSelectorRulesEnabled()) {
      closeSelectorSession('Saved selector rules are disabled in this version');
      return;
    }
    if (!(target instanceof Element)) return;

    state.selectorMode = false;
    state.modalOpen = true;
    unbindSelectorListeners();
    hideHoverBox();

    const draft = {
      selector: buildStableSelector(target),
      fingerprint: buildElementFingerprint(target),
      previewText: truncateText(target.innerText || target.textContent || '', 400),
      previewHtml: truncateText(target.outerHTML || '', 1200)
    };

    if (!draft.selector) {
      closeSelectorSession('Selector save failed: could not build a stable selector');
      return;
    }

    removeSaveRuleModal();

    const overlay = document.createElement('div');
    overlay.id = 'tm-timeout-save-rule-overlay';
    overlay.setAttribute(UI_MARKER_ATTR, '1');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: String(CFG.zIndex),
      background: 'rgba(2, 6, 23, 0.78)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    });

    overlay.innerHTML = `
      <div ${UI_MARKER_ATTR}="1" style="width:min(560px,100%);background:#0f172a;color:#e5e7eb;border:1px solid rgba(255,255,255,0.12);border-radius:16px;box-shadow:0 22px 60px rgba(0,0,0,.45);padding:18px;">
        <div ${UI_MARKER_ATTR}="1" style="font-size:16px;font-weight:800;margin-bottom:10px;">Save the error message for this element</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:12px;opacity:.85;margin-bottom:8px;">Selector</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:12px;line-height:1.45;background:#111827;border:1px solid #243041;border-radius:10px;padding:10px;margin-bottom:10px;word-break:break-all;">${escapeHtml(draft.selector)}</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:12px;opacity:.85;margin-bottom:8px;">Element preview</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:12px;line-height:1.45;background:#111827;border:1px solid #243041;border-radius:10px;padding:10px;max-height:110px;overflow:auto;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(draft.previewText || '(no visible text found)')}</div>
        <label ${UI_MARKER_ATTR}="1" for="tm-timeout-saved-error-text" style="display:block;font-size:12px;font-weight:700;margin-bottom:6px;">Saved error text</label>
        <textarea ${UI_MARKER_ATTR}="1" id="tm-timeout-saved-error-text" rows="4" style="width:100%;padding:10px;border-radius:10px;border:1px solid #334155;background:#111827;color:#e5e7eb;resize:vertical;"></textarea>
        <div ${UI_MARKER_ATTR}="1" id="tm-timeout-save-rule-error" style="display:none;color:#fca5a5;font-size:12px;margin-top:8px;">Error text is required.</div>
        <div ${UI_MARKER_ATTR}="1" style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-save-rule-cancel" type="button" style="border:0;border-radius:10px;padding:8px 12px;background:#475569;color:#fff;font-weight:700;cursor:pointer;">Cancel</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-save-rule-save" type="button" style="border:0;border-radius:10px;padding:8px 12px;background:#16a34a;color:#fff;font-weight:700;cursor:pointer;">Save Rule</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    const textarea = $('#tm-timeout-saved-error-text', overlay);
    const errorEl = $('#tm-timeout-save-rule-error', overlay);
    const cancelBtn = $('#tm-timeout-save-rule-cancel', overlay);
    const saveBtn = $('#tm-timeout-save-rule-save', overlay);

    try { textarea?.focus(); } catch {}

    const closeModal = (message) => closeSelectorSession(message);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeModal('Selector canceled');
      }
    });

    cancelBtn?.addEventListener('click', () => closeModal('Selector canceled'));

    saveBtn?.addEventListener('click', () => {
      const savedErrorText = normalizeText(textarea?.value || '');
      if (!savedErrorText) {
        if (errorEl) errorEl.style.display = 'block';
        return;
      }

      const rules = getSelectorRules();
      const ruleId = buildRuleId(draft.selector, draft.fingerprint.textFingerprint || draft.previewText || '');
      const nextRule = {
        ruleId,
        selector: draft.selector,
        label: savedErrorText,
        savedErrorText,
        fingerprint: buildRuleFingerprintWithScope(draft.fingerprint, {
          product: state.current.product,
          header: state.current.header
        }),
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      const existingIdx = rules.findIndex((rule) => normalizeText(rule.ruleId) === ruleId || normalizeText(rule.selector) === draft.selector);
      if (existingIdx >= 0) {
        nextRule.createdAt = normalizeText(rules[existingIdx].createdAt || nowIso());
        rules[existingIdx] = nextRule;
      } else {
        rules.push(nextRule);
      }

      saveSelectorRules(rules, { reason: 'rule-saved' });
      closeSelectorSession('Selector rule saved');
      scheduleScan('rule-saved');
    });

    setStatus('Selector config');
    renderButtons();
    renderAll();
  }

  function removeSaveRuleModal() {
    const overlay = $('#tm-timeout-save-rule-overlay');
    if (overlay) overlay.remove();
  }

  function removeManageRulesModal() {
    const overlay = $('#tm-timeout-manage-rules-overlay');
    if (overlay) overlay.remove();
  }

  function deleteSelectorRule(ruleId) {
    const id = normalizeText(ruleId);
    if (!id) return false;
    const currentRules = getSelectorRules();
    const nextRules = currentRules.filter((rule) => normalizeText(rule.ruleId) !== id);
    if (nextRules.length === currentRules.length) return false;
    addSelectorRuleTombstones([id]);
    saveSelectorRules(nextRules, { reason: 'rule-deleted' });
    return true;
  }

  function clearSelectorRules() {
    addSelectorRuleTombstones(getSelectorRules().map((rule) => rule.ruleId));
    saveSelectorRules([], { reason: 'rules-cleared' });
  }

  function renderManageRulesModal() {
    if (!state.manageRulesOpen) return;
    const overlay = $('#tm-timeout-manage-rules-overlay');
    const body = $('#tm-timeout-manage-rules-body', overlay);
    const countEl = $('#tm-timeout-manage-rules-count', overlay);
    if (!overlay || !body) return;

    const rules = getSelectorRules()
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));

    if (countEl) countEl.textContent = `${rules.length} saved`;

    if (!rules.length) {
      body.innerHTML = `
        <div ${UI_MARKER_ATTR}="1" style="padding:14px;border:1px solid #243041;border-radius:12px;background:#111827;color:#cbd5e1;">
          No saved selector rules.
        </div>
      `;
      return;
    }

    body.innerHTML = rules.map((rule) => `
      <div ${UI_MARKER_ATTR}="1" style="border:1px solid #243041;border-radius:12px;background:#111827;padding:12px;">
        <div ${UI_MARKER_ATTR}="1" style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px;">
          <div ${UI_MARKER_ATTR}="1" style="font-weight:800;color:#f8fafc;word-break:break-word;">${escapeHtml(rule.label || rule.savedErrorText || 'Saved selector rule')}</div>
          <button ${UI_MARKER_ATTR}="1" type="button" data-timeout-delete-rule="${escapeHtml(rule.ruleId)}" style="border:0;border-radius:10px;padding:7px 10px;background:#dc2626;color:#fff;font-weight:800;cursor:pointer;white-space:nowrap;">DELETE</button>
        </div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:11px;opacity:.8;margin-bottom:6px;">Saved error text</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:12px;line-height:1.45;background:#020617;border:1px solid #243041;border-radius:10px;padding:8px;margin-bottom:8px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(rule.savedErrorText || '')}</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:11px;opacity:.8;margin-bottom:6px;">Selector</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:11px;line-height:1.45;background:#020617;border:1px solid #243041;border-radius:10px;padding:8px;word-break:break-all;">${escapeHtml(rule.selector || '')}</div>
      </div>
    `).join('');

    body.querySelectorAll('[data-timeout-delete-rule]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ruleId = normalizeText(btn.getAttribute('data-timeout-delete-rule') || '');
        if (!ruleId) return;
        if (deleteSelectorRule(ruleId)) {
          log(`Deleted saved rule: ${ruleId}`);
        }
      });
    });
  }

  function closeManageRulesModal(message, options = {}) {
    state.manageRulesOpen = false;
    removeManageRulesModal();
    if (options.logIt !== false && normalizeText(message)) log(message);
    if (!state.destroyed) setStatus(state.running ? 'Watching header' : 'Stopped');
    renderButtons();
    renderAll();
  }

  function openManageRulesModal() {
    if (!savedSelectorRulesEnabled()) {
      const removed = clearLegacySelectorRules();
      log(removed ? 'Saved selector rules are disabled. Legacy rules were cleared.' : 'Saved selector rules are disabled in this version');
      setStatus(state.running ? 'Watching header' : 'Stopped');
      renderButtons();
      renderAll();
      return;
    }
    if (state.manageRulesOpen) return;
    if (state.selectorMode || state.modalOpen) {
      closeSelectorSession('', { logIt: false, restorePause: true });
    }

    removeManageRulesModal();
    state.manageRulesOpen = true;

    const overlay = document.createElement('div');
    overlay.id = 'tm-timeout-manage-rules-overlay';
    overlay.setAttribute(UI_MARKER_ATTR, '1');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: String(CFG.zIndex),
      background: 'rgba(2, 6, 23, 0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    });

    overlay.innerHTML = `
      <div ${UI_MARKER_ATTR}="1" style="width:min(760px,100%);max-height:min(82vh,900px);background:#0f172a;color:#e5e7eb;border:1px solid rgba(255,255,255,0.12);border-radius:16px;box-shadow:0 22px 60px rgba(0,0,0,.45);padding:18px;display:flex;flex-direction:column;gap:12px;">
        <div ${UI_MARKER_ATTR}="1" style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
          <div ${UI_MARKER_ATTR}="1">
            <div ${UI_MARKER_ATTR}="1" style="font-size:16px;font-weight:800;">Saved Selector Rules</div>
            <div ${UI_MARKER_ATTR}="1" id="tm-timeout-manage-rules-count" style="font-size:12px;opacity:.8;">0 saved</div>
          </div>
          <div ${UI_MARKER_ATTR}="1" style="display:flex;gap:10px;align-items:center;">
            <button ${UI_MARKER_ATTR}="1" id="tm-timeout-clear-rules" type="button" style="border:0;border-radius:10px;padding:8px 12px;background:#b91c1c;color:#fff;font-weight:800;cursor:pointer;">CLEAR ALL</button>
            <button ${UI_MARKER_ATTR}="1" id="tm-timeout-close-rules" type="button" style="border:0;border-radius:10px;padding:8px 12px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">CLOSE</button>
          </div>
        </div>
        <div ${UI_MARKER_ATTR}="1" id="tm-timeout-manage-rules-body" style="display:flex;flex-direction:column;gap:10px;overflow:auto;padding-right:4px;"></div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    $('#tm-timeout-close-rules', overlay)?.addEventListener('click', () => closeManageRulesModal('Rule manager closed'));
    $('#tm-timeout-clear-rules', overlay)?.addEventListener('click', () => {
      clearSelectorRules();
      log('Cleared all saved selector rules');
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeManageRulesModal('Rule manager closed');
    });

    renderManageRulesModal();
    setStatus('Rule manager');
    renderButtons();
    renderAll();
  }

  function matchRuleToElement(rule, el) {
    const meta = buildElementLogMeta(el);
    const fail = (reason) => ({
      ok: false,
      reason,
      element: el instanceof Element ? el : null,
      matchedText: meta.text,
      elementTag: meta.tag,
      elementId: meta.id,
      elementClass: meta.className
    });

    if (!(el instanceof Element)) return fail('candidate is not an element');
    if (isScriptUiElement(el)) return fail('candidate is script UI');
    if (!isVisible(el)) return fail('candidate not visible');

    const matchedText = getVisibleElementLogText(el, 600);
    const fingerprint = isPlainObject(rule.fingerprint) ? rule.fingerprint : {};
    const current = buildElementFingerprint(el);

    let required = 0;
    let score = 0;
    let textRequired = false;
    let textMatches = false;

    if (fingerprint.tag) {
      required += 1;
      if (fingerprint.tag === current.tag) {
        score += 1;
      }
    }
    if (fingerprint.id) {
      required += 1;
      if (fingerprint.id === current.id) {
        score += 1;
      }
    }
    if (fingerprint.name) {
      required += 1;
      if (fingerprint.name === current.name) {
        score += 1;
      }
    }
    if (fingerprint.role) {
      required += 1;
      if (fingerprint.role === current.role) {
        score += 1;
      }
    }
    if (fingerprint.ariaLabel) {
      required += 1;
      if (fingerprint.ariaLabel === current.ariaLabel) {
        score += 1;
      }
    }
    if (Array.isArray(fingerprint.classTokens) && fingerprint.classTokens.length) {
      required += 1;
      const currentSet = new Set(current.classTokens || []);
      const allFound = fingerprint.classTokens.every((token) => currentSet.has(token));
      if (allFound) {
        score += 1;
      }
    }
    if (fingerprint.textFingerprint) {
      required += 1;
      textRequired = true;
      const savedText = normalizeText(fingerprint.textFingerprint);
      const currentText = normalizeText(matchedText || current.textFingerprint);
      if (savedText && currentText && currentText.includes(savedText)) {
        score += 1;
        textMatches = true;
      }
    }

    if (required === 0) return fail('fingerprint empty');

    if (textRequired && !textMatches) {
      return fail(matchedText ? 'text fingerprint not found on visible element' : 'visible element text empty');
    }

    let ok = false;
    if (textRequired) {
      if (required === 1) ok = score === 1;
      else if (required <= 3) ok = score === required;
      else ok = score >= (required - 1);
    } else if (required === 1) {
      ok = score === 1;
    } else {
      ok = score === required || (required >= 3 && score >= (required - 1));
    }

    if (!ok) return fail('fingerprint score mismatch');

    return {
      ok: true,
      reason: '',
      element: el,
      matchedText,
      elementTag: meta.tag,
      elementId: meta.id,
      elementClass: meta.className
    };
  }

  function is360ValueRule(rule, selector = '') {
    const fingerprint = isPlainObject(rule?.fingerprint) ? rule.fingerprint : {};
    const haystack = [
      selector,
      rule?.ruleId,
      rule?.id,
      rule?.label,
      rule?.errorName,
      rule?.savedErrorText,
      rule?.errorText,
      fingerprint?.id,
      fingerprint?.tag,
      fingerprint?.textFingerprint
    ].map(normalizeText).join(' ').toLowerCase();

    return /360\s*value|360-value|360value|div360value|iv360|rule_360value_frame/.test(haystack);
  }

  function log360ValueOnce(kind, message) {
    const key = [
      kind,
      state.current.azId,
      state.current.submission,
      state.current.header
    ].map(normalizeText).join('|');
    if (state.last360ValueLogKeys.has(key)) return;
    state.last360ValueLogKeys.add(key);
    log(message);
  }

  function build360ValueRuleFailure(selector, reason, element = null, matchedText = '') {
    const meta = buildElementLogMeta(element);
    return {
      ok: false,
      reason,
      selector,
      element: element instanceof Element ? element : null,
      matchedText: normalizeText(matchedText || meta.text || ''),
      elementTag: meta.tag,
      elementId: meta.id,
      elementClass: meta.className
    };
  }

  function find360ValueResultsMarker(doc) {
    const marker = queryAllDeep(doc, '#iv360-results, #iv360-ercValue, #iv360-finish')[0];
    if (marker) return marker;

    const bodyText = normalizeText(doc?.body?.innerText || doc?.body?.textContent || '');
    if (/estimated reconstruction cost/i.test(bodyText)) {
      return doc.body || doc.documentElement || null;
    }
    return null;
  }

  function find360ValueContinueMarker(doc) {
    return queryAllDeep(doc, '#iv360-continue')[0] || null;
  }

  function get360ValueContinueMatchText(el) {
    const directText = getVisibleElementLogText(el, 600);
    return normalizeText(directText || el?.textContent || el?.getAttribute?.('title') || 'Continue') || 'Continue';
  }

  function find360ValueDocumentMatch(rule, selector) {
    if (!is360ValueRule(rule, selector)) return null;

    let continueMarker = null;
    for (const doc of getAllDocs()) {
      const resultsMarker = find360ValueResultsMarker(doc);
      if (resultsMarker) {
        log360ValueOnce('results-suppressed', '360Value Results page detected — close suppressed');
        log360ValueOnce('rule-skipped-results', '360Value rule skipped because completed results page is present');
        return build360ValueRuleFailure(
          selector,
          '360Value rule skipped because completed results page is present',
          resultsMarker,
          '360Value Results page detected'
        );
      }

      if (!continueMarker) continueMarker = find360ValueContinueMarker(doc);
    }

    if (!continueMarker) {
      return build360ValueRuleFailure(
        selector,
        '360Value Continue page not detected',
        null,
        ''
      );
    }

    log360ValueOnce('bad-continue', '360Value bad/stuck Continue page detected');
    const meta = buildElementLogMeta(continueMarker);
    return {
      ok: true,
      reason: '',
      selector,
      element: continueMarker,
      matchedText: get360ValueContinueMatchText(continueMarker),
      elementTag: meta.tag,
      elementId: meta.id,
      elementClass: meta.className
    };
  }

  function findRuleMatch(rule) {
    const selector = normalizeText(rule.selector || '');
    if (!selector) {
      return {
        ok: false,
        reason: 'selector missing',
        selector,
        element: null,
        matchedText: '',
        elementTag: '',
        elementId: '',
        elementClass: ''
      };
    }

    const special360Match = find360ValueDocumentMatch(rule, selector);
    if (special360Match) return special360Match;

    let bestFailure = null;
    let sawNodes = false;
    for (const doc of getAllDocs()) {
      let nodes = [];
      try {
        nodes = Array.from(doc.querySelectorAll(selector));
      } catch {
        bestFailure = pickBetterSelectorFailure(bestFailure, {
          ok: false,
          reason: 'selector query failed',
          selector,
          element: null,
          matchedText: '',
          elementTag: '',
          elementId: '',
          elementClass: ''
        });
        continue;
      }
      if (nodes.length) sawNodes = true;
      for (const node of nodes) {
        const result = matchRuleToElement(rule, node);
        if (result.ok) {
          return {
            ...result,
            selector
          };
        }
        bestFailure = pickBetterSelectorFailure(bestFailure, {
          ...result,
          selector
        });
      }
    }

    return bestFailure || {
      ok: false,
      reason: sawNodes ? 'no visible element matched selector' : 'selector found no elements',
      selector,
      element: null,
      matchedText: '',
      elementTag: '',
      elementId: '',
      elementClass: ''
    };
  }

  function processSelectorMatches() {
    if (!savedSelectorRulesEnabled()) return;
    if (state.bootSharedRulesPending) return;
    const context = buildEventContext();
    if (!context.ok) return;
    if (!context.product || !context.productLabel) return;

    for (const rule of getSelectorRules()) {
      const scopeFailure = getSelectorRuleScopeFailure(rule, context);
      if (scopeFailure) {
        logSelectorRuleSkipped(context, rule, { reason: scopeFailure });
        continue;
      }
      const dedupeKey = ['selector', context.job['AZ ID'], context.product, normalizeText(rule.ruleId || '')].join('|');
      if (hasSentOrPendingDedupe(dedupeKey)) continue;
      const match = findRuleMatch(rule);
      if (!match?.ok) {
        logSelectorRuleSkipped(context, rule, match);
        continue;
      }
      logSelectorRuleMatchReady(context, rule, match);
      const event = buildSelectorEvent(context, rule, match);
      dispatchEvent(event);
      return;
    }
  }

  function buildUi() {
    if (!document.documentElement) return false;

    const existing = $('#tm-pc-header-timeout-panel');
    if (existing) {
      state.panel = existing;
      bindUi(existing);
      return true;
    }

    const panel = document.createElement('div');
    panel.id = 'tm-pc-header-timeout-panel';
    panel.setAttribute(UI_MARKER_ATTR, '1');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: `${CFG.panelWidth}px`,
      zIndex: String(CFG.zIndex),
      background: 'rgba(15, 23, 42, 0.97)',
      color: '#e5e7eb',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '16px',
      boxShadow: '0 18px 48px rgba(0,0,0,0.42)',
      font: '12px/1.45 Segoe UI, Tahoma, Arial, sans-serif',
      overflow: 'hidden',
      backdropFilter: 'blur(10px)'
    });

    panel.innerHTML = `
      <div ${UI_MARKER_ATTR}="1" id="tm-pc-header-timeout-handle" style="padding:10px 12px;background:linear-gradient(90deg,#0f172a,#1e293b);cursor:move;display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div ${UI_MARKER_ATTR}="1">
          <div ${UI_MARKER_ATTR}="1" style="font-weight:800;letter-spacing:.2px;">${SCRIPT_NAME}</div>
          <div ${UI_MARKER_ATTR}="1" style="font-size:11px;opacity:.72;">Live header timeout monitor</div>
        </div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:11px;opacity:.7;">v${VERSION}</div>
      </div>
      <div ${UI_MARKER_ATTR}="1" style="padding:12px;">
        <div ${UI_MARKER_ATTR}="1" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#16a34a;color:#fff;font-weight:800;cursor:pointer;">STOP</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-enable-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#16a34a;color:#fff;font-weight:800;cursor:pointer;">TIMEOUT ON</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-watch-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">WATCH MODE OFF</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-watch-push" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#991b1b;color:#fff;font-weight:800;cursor:pointer;">PUSH WATCH PAYLOAD</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-watch-alert-test" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;">TEST ALERT</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-text-webhook-test" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">TEST TEXT WEBHOOK</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-selector" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0891b2;color:#fff;font-weight:800;cursor:pointer;">SELECTOR MODE</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-manage-rules" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#7c3aed;color:#fff;font-weight:800;cursor:pointer;">MANAGE RULES</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-sync-rules" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">SYNC NOW</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-copy-logs" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">COPY LOGS</button>
        </div>
        <div ${UI_MARKER_ATTR}="1" style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
          <div ${UI_MARKER_ATTR}="1" style="opacity:.75;font-size:11px;">Watch Alert Webhook</div>
          <input ${UI_MARKER_ATTR}="1" id="tm-timeout-watch-alert-webhook-url" type="text" spellcheck="false" placeholder="https://your-webhook.example/..." style="width:100%;border:1px solid #374151;border-radius:10px;background:#0b1220;color:#f9fafb;padding:8px 10px;" />
          <div ${UI_MARKER_ATTR}="1" style="display:grid;grid-template-columns:44px 1fr;gap:5px 8px;">
            <div ${UI_MARKER_ATTR}="1" style="opacity:.75;">Active</div>
            <div ${UI_MARKER_ATTR}="1" id="tm-timeout-watch-alert-webhook-active" style="word-break:break-all;">(empty)</div>
          </div>
        </div>
        <div ${UI_MARKER_ATTR}="1" style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
          <div ${UI_MARKER_ATTR}="1" style="opacity:.75;font-size:11px;">Timeout Text Webhook</div>
          <input ${UI_MARKER_ATTR}="1" id="tm-timeout-text-webhook-url" type="text" spellcheck="false" placeholder="https://your-webhook.example/..." style="width:100%;border:1px solid #374151;border-radius:10px;background:#0b1220;color:#f9fafb;padding:8px 10px;" />
          <div ${UI_MARKER_ATTR}="1" style="display:grid;grid-template-columns:44px 1fr;gap:5px 8px;">
            <div ${UI_MARKER_ATTR}="1" style="opacity:.75;">Active</div>
            <div ${UI_MARKER_ATTR}="1" id="tm-timeout-text-webhook-active" style="word-break:break-all;">(empty)</div>
          </div>
        </div>
        <div ${UI_MARKER_ATTR}="1" id="tm-timeout-status" style="font-weight:800;color:#86efac;margin-bottom:10px;">Watching header</div>
        <div ${UI_MARKER_ATTR}="1" style="display:grid;grid-template-columns:72px 1fr;gap:5px 8px;margin-bottom:10px;">
          <div ${UI_MARKER_ATTR}="1" style="opacity:.75;">Header</div>
          <div ${UI_MARKER_ATTR}="1" id="tm-timeout-header" style="word-break:break-word;">-</div>
          <div ${UI_MARKER_ATTR}="1" style="opacity:.75;">Timer</div>
          <div ${UI_MARKER_ATTR}="1" id="tm-timeout-live-timer">00:00</div>
        </div>
        <textarea ${UI_MARKER_ATTR}="1" id="tm-timeout-logs" readonly style="width:100%;min-height:150px;max-height:190px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:12px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    loadPanelPos();
    makeDraggable(panel, $('#tm-pc-header-timeout-handle', panel));
    bindUi(panel);
    return true;
  }

  function bindUi(panel) {
    state.panel = panel;
    state.els.toggle = $('#tm-timeout-toggle', panel);
    state.els.timeoutEnableToggle = $('#tm-timeout-enable-toggle', panel);
    state.els.watchModeToggle = $('#tm-timeout-watch-toggle', panel);
    state.els.watchPush = $('#tm-timeout-watch-push', panel);
    state.els.watchAlertTest = $('#tm-timeout-watch-alert-test', panel);
    state.els.watchAlertWebhookUrl = $('#tm-timeout-watch-alert-webhook-url', panel);
    state.els.watchAlertWebhookActive = $('#tm-timeout-watch-alert-webhook-active', panel);
    state.els.timeoutTextTest = $('#tm-timeout-text-webhook-test', panel);
    state.els.timeoutTextWebhookUrl = $('#tm-timeout-text-webhook-url', panel);
    state.els.timeoutTextWebhookActive = $('#tm-timeout-text-webhook-active', panel);
    state.els.selector = $('#tm-timeout-selector', panel);
    state.els.manageRules = $('#tm-timeout-manage-rules', panel);
    state.els.syncRules = $('#tm-timeout-sync-rules', panel);
    state.els.copyLogs = $('#tm-timeout-copy-logs', panel);
    state.els.status = $('#tm-timeout-status', panel);
    state.els.header = $('#tm-timeout-header', panel);
    state.els.liveTimer = $('#tm-timeout-live-timer', panel);
    state.els.logs = $('#tm-timeout-logs', panel);

    state.els.toggle.onclick = () => {
      state.running = !state.running;
      if (!state.running) {
        state.pausedAtMs = Date.now();
        state.frozenElapsedMs = state.current.header
          ? Math.max(0, Date.now() - Number(state.current.headerSinceMs || Date.now()))
          : 0;
        closeSelectorSession('', { logIt: false, restorePause: true });
        setStatus('Stopped');
        log('Monitoring stopped');
      } else {
        if (state.pausedAtMs) {
          shiftCurrentRuntimeByPauseDelta(Date.now() - state.pausedAtMs);
        }
        state.pausedAtMs = 0;
        state.frozenElapsedMs = 0;
        setStatus('Watching header');
        log('Monitoring started');
        scheduleScan('manual-start');
      }
      renderButtons();
      renderAll();
    };

    state.els.timeoutEnableToggle.onclick = () => {
      const enabled = writeTimeoutEnabled(!timeoutActionsEnabled());
      if (!enabled) {
        clearOwnedSendArtifacts();
        log('Timeout actions OFF');
      } else {
        log('Timeout actions ON');
        scheduleScan('timeout-enabled');
      }
      setStatus(state.running ? 'Watching header' : 'Stopped');
      renderButtons();
      renderAll();
    };

    state.els.watchModeToggle.onclick = () => {
      const enabled = writeWatchModeEnabled(!state.watchModeEnabled);
      if (!enabled) {
        closeWatchAlert('Watch mode OFF', { logIt: false, preservePending: false });
        log('Watch mode OFF');
      } else {
        log('Watch mode ON');
        syncWatchAlertFromStorage();
      }
      setStatus(state.running ? 'Watching header' : 'Stopped');
      renderButtons();
      renderAll();
    };

    state.els.watchPush.onclick = () => {
      dispatchPendingWatchPost();
    };

    state.els.watchAlertTest.onclick = () => {
      const testRecord = {
        event: {
          detectedAt: nowIso(),
          product: state.current.product || '',
          productLabel: state.current.productLabel || '',
          submissionNumber: state.current.submission || ''
        },
        context: {
          job: {
            'AZ ID': state.current.azId || ''
          },
          product: state.current.product || '',
          productLabel: state.current.productLabel || '',
          submission: state.current.submission || ''
        }
      };
      sendWatchAlertWebhook(testRecord, { test: true }).catch(() => {});
    };

    state.els.watchAlertWebhookUrl.onchange = () => {
      persistWatchAlertWebhookFromUi(true);
      renderButtons();
      renderAll();
    };

    state.els.timeoutTextTest.onclick = () => {
      const context = buildEventContext();
      const fallbackContext = context.ok ? context : {
        ok: true,
        job: { 'AZ ID': state.current.azId || '' },
        identity: {},
        product: state.current.product || '',
        productLabel: state.current.productLabel || '',
        header: state.current.header || '',
        headerSinceMs: Number(state.current.headerSinceMs || Date.now()),
        submission: state.current.submission || ''
      };
      const testEvent = {
        detectedAt: nowIso(),
        errorText: 'Header timeout text snapshot test',
        product: fallbackContext.product || '',
        productLabel: fallbackContext.productLabel || '',
        headerText: fallbackContext.header || '',
        submissionNumber: fallbackContext.submission || '',
        identity: {
          'AZ ID': fallbackContext.job?.['AZ ID'] || ''
        }
      };
      sendTimeoutTextWebhookSnapshot(testEvent, fallbackContext, { test: true }).catch(() => {});
    };

    state.els.timeoutTextWebhookUrl.onchange = () => {
      persistTimeoutTextWebhookFromUi(true);
      renderButtons();
      renderAll();
    };

    state.els.selector.onclick = () => {
      if (!savedSelectorRulesEnabled()) {
        log('Saved selector rules are disabled in this version');
        setStatus(state.running ? 'Watching header' : 'Stopped');
        renderButtons();
        renderAll();
        return;
      }
      if (state.selectorMode || state.modalOpen) {
        closeSelectorSession('Selector canceled');
      } else {
        startSelectorMode();
      }
    };

    state.els.manageRules.onclick = () => {
      if (!savedSelectorRulesEnabled()) {
        const removed = clearLegacySelectorRules();
        log(removed ? 'Saved selector rules are disabled. Legacy rules were cleared.' : 'Saved selector rules are disabled in this version');
        setStatus(state.running ? 'Watching header' : 'Stopped');
        renderButtons();
        renderAll();
        return;
      }
      if (state.manageRulesOpen) {
        closeManageRulesModal('Rule manager closed');
      } else {
        openManageRulesModal();
      }
    };

    state.els.syncRules.onclick = () => {
      log('Shared rules sync requested');
      scheduleSharedRulesSync('manual-button', { force: true, manual: true });
    };

    state.els.copyLogs.onclick = () => copyLogsToClipboard();

    syncWatchAlertWebhookUi();
    syncTimeoutTextWebhookUi();
    renderButtons();
    renderAll();
  }

  function renderButtons() {
    if (!state.els.toggle) return;
    state.els.toggle.textContent = state.running ? 'STOP' : 'START';
    state.els.toggle.style.background = state.running ? '#dc2626' : '#16a34a';

    if (state.els.timeoutEnableToggle) {
      state.els.timeoutEnableToggle.textContent = state.timeoutEnabled ? 'TIMEOUT ON' : 'TIMEOUT OFF';
      state.els.timeoutEnableToggle.style.background = state.timeoutEnabled ? '#16a34a' : '#475569';
      state.els.timeoutEnableToggle.style.color = '#fff';
    }

    if (state.els.watchModeToggle) {
      state.els.watchModeToggle.textContent = state.watchModeEnabled ? 'WATCH MODE ON' : 'WATCH MODE OFF';
      state.els.watchModeToggle.style.background = state.watchModeEnabled ? '#b91c1c' : '#475569';
      state.els.watchModeToggle.style.color = '#fff';
    }

    if (state.els.watchPush) {
      const enabled = state.watchModeEnabled && hasPendingWatchPost();
      state.els.watchPush.disabled = !enabled;
      state.els.watchPush.style.background = enabled ? '#991b1b' : '#334155';
      state.els.watchPush.style.color = enabled ? '#fff' : '#cbd5e1';
      state.els.watchPush.style.opacity = enabled ? '1' : '.7';
      state.els.watchPush.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    if (state.els.watchAlertTest) {
      const hasUrl = isValidHttpUrl(getCurrentWatchAlertWebhookUrlFromUi());
      const enabled = !state.watchAlertWebhookBusy && hasUrl;
      state.els.watchAlertTest.textContent = state.watchAlertWebhookBusy ? 'SENDING ALERT...' : 'TEST ALERT';
      state.els.watchAlertTest.disabled = !enabled;
      state.els.watchAlertTest.style.background = state.watchAlertWebhookBusy ? '#2563eb' : (hasUrl ? '#2563eb' : '#334155');
      state.els.watchAlertTest.style.color = hasUrl ? '#fff' : '#cbd5e1';
      state.els.watchAlertTest.style.opacity = enabled || state.watchAlertWebhookBusy ? '1' : '.75';
      state.els.watchAlertTest.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    if (state.els.timeoutTextTest) {
      const hasUrl = isValidHttpUrl(getCurrentTimeoutTextWebhookUrlFromUi());
      const enabled = !state.timeoutTextWebhookBusy && hasUrl;
      state.els.timeoutTextTest.textContent = state.timeoutTextWebhookBusy ? 'SENDING TEXT...' : 'TEST TEXT WEBHOOK';
      state.els.timeoutTextTest.disabled = !enabled;
      state.els.timeoutTextTest.style.background = state.timeoutTextWebhookBusy ? '#0f766e' : (hasUrl ? '#0f766e' : '#334155');
      state.els.timeoutTextTest.style.color = hasUrl ? '#fff' : '#cbd5e1';
      state.els.timeoutTextTest.style.opacity = enabled || state.timeoutTextWebhookBusy ? '1' : '.75';
      state.els.timeoutTextTest.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    if (state.els.selector) {
      if (!savedSelectorRulesEnabled()) {
        state.els.selector.textContent = 'SELECTOR DISABLED';
        state.els.selector.style.background = '#475569';
        state.els.selector.disabled = true;
        state.els.selector.style.opacity = '.75';
        state.els.selector.style.cursor = 'not-allowed';
      } else {
        state.els.selector.textContent = state.selectorMode || state.modalOpen ? 'CANCEL SELECTOR' : 'SELECTOR MODE';
        state.els.selector.style.background = state.selectorMode || state.modalOpen ? '#f59e0b' : '#0891b2';
        state.els.selector.disabled = false;
        state.els.selector.style.opacity = '1';
        state.els.selector.style.cursor = 'pointer';
      }
    }

    if (state.els.manageRules) {
      if (!savedSelectorRulesEnabled()) {
        state.els.manageRules.textContent = 'RULES DISABLED';
        state.els.manageRules.style.background = '#334155';
        state.els.manageRules.style.color = '#cbd5e1';
        state.els.manageRules.disabled = true;
        state.els.manageRules.style.opacity = '.75';
        state.els.manageRules.style.cursor = 'not-allowed';
      } else {
        const ruleCount = getSelectorRules().length;
        state.els.manageRules.textContent = state.manageRulesOpen
          ? 'CLOSE RULES'
          : `MANAGE RULES${ruleCount ? ` (${ruleCount})` : ''}`;
        state.els.manageRules.style.background = state.manageRulesOpen ? '#f59e0b' : '#7c3aed';
        state.els.manageRules.style.color = '#fff';
        state.els.manageRules.disabled = false;
        state.els.manageRules.style.opacity = '1';
        state.els.manageRules.style.cursor = 'pointer';
      }
    }

    if (state.els.syncRules) {
      const enabled = sharedRulesSyncEnabled() && !state.sharedRulesSyncing;
      state.els.syncRules.textContent = state.sharedRulesSyncing ? 'SYNCING...' : 'SYNC NOW';
      state.els.syncRules.disabled = !enabled;
      state.els.syncRules.style.background = state.sharedRulesSyncing ? '#0f766e' : (sharedRulesSyncEnabled() ? '#0f766e' : '#334155');
      state.els.syncRules.style.color = sharedRulesSyncEnabled() ? '#fff' : '#cbd5e1';
      state.els.syncRules.style.opacity = enabled || state.sharedRulesSyncing ? '1' : '.75';
      state.els.syncRules.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

  }

  function renderAll() {
    if (!state.panel) return;

    const liveMs = !state.running && state.pausedAtMs
      ? Math.max(0, Number(state.frozenElapsedMs || 0))
      : state.current.header
        ? Math.max(0, Date.now() - Number(state.current.headerSinceMs || Date.now()))
        : 0;

    if (state.els.status) {
      const statusText =
        state.watchAlertOpen ? 'Watch mode timeout' :
        state.manageRulesOpen ? 'Rule manager' :
        state.modalOpen ? 'Selector config' :
        state.selectorMode ? 'Selector mode' :
        state.running ? (state.lastStatus || 'Watching header') :
        'Stopped';

      state.els.status.textContent = statusText;
      state.els.status.style.color =
        state.watchAlertOpen ? '#fca5a5' :
        state.manageRulesOpen ? '#c4b5fd' :
        state.selectorMode || state.modalOpen ? '#67e8f9' :
        state.running ? '#86efac' : '#fca5a5';
    }

    if (state.els.header) state.els.header.textContent = state.current.header || '-';
    if (state.els.liveTimer) state.els.liveTimer.textContent = state.current.header ? formatDuration(liveMs) : '--:--';
    if (state.els.logs) state.els.logs.value = state.logs.join('\n');
    renderButtons();
  }

  function copyLogsToClipboard() {
    const text = state.logs.join('\n');
    if (!text) return;

    const fallbackCopy = () => {
      const ta = document.createElement('textarea');
      ta.setAttribute(UI_MARKER_ATTR, '1');
      ta.value = text;
      Object.assign(ta.style, {
        position: 'fixed',
        left: '-9999px',
        top: '0'
      });
      document.documentElement.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => log('Logs copied'))
        .catch(() => {
          fallbackCopy();
          log('Logs copied');
        });
      return;
    }

    fallbackCopy();
    log('Logs copied');
  }

  function loadPanelPos() {
    const saved = safeJsonParse(localStorage.getItem(KEYS.panelPos), null);
    if (!isPlainObject(saved) || !state.panel) return;
    if (saved.left) state.panel.style.left = saved.left;
    if (saved.top) state.panel.style.top = saved.top;
    if (saved.right) state.panel.style.right = saved.right;
    if (saved.bottom) state.panel.style.bottom = saved.bottom;
    keepPanelInView();
  }

  function persistPanelPos() {
    if (!state.panel) return;
    localStorage.setItem(KEYS.panelPos, JSON.stringify({
      left: state.panel.style.left || '',
      top: state.panel.style.top || '',
      right: state.panel.style.right || '',
      bottom: state.panel.style.bottom || ''
    }, null, 2));
  }

  function keepPanelInView() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    let nextLeft = rect.left;
    let nextTop = rect.top;

    if (rect.right > window.innerWidth) nextLeft = Math.max(0, window.innerWidth - rect.width - 8);
    if (rect.bottom > window.innerHeight) nextTop = Math.max(0, window.innerHeight - rect.height - 8);
    if (rect.left < 0) nextLeft = 8;
    if (rect.top < 0) nextTop = 8;

    state.panel.style.left = `${nextLeft}px`;
    state.panel.style.top = `${nextTop}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    persistPanelPos();
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;
    let drag = null;

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = {
        startX: event.clientX,
        startY: event.clientY,
        left: panel.getBoundingClientRect().left,
        top: panel.getBoundingClientRect().top
      };
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const nextLeft = drag.left + (event.clientX - drag.startX);
      const nextTop = drag.top + (event.clientY - drag.startY);
      panel.style.left = `${Math.max(0, nextLeft)}px`;
      panel.style.top = `${Math.max(0, nextTop)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    const endDrag = () => {
      if (!drag) return;
      drag = null;
      keepPanelInView();
      persistPanelPos();
    };

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }
})();
