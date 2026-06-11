// ==UserScript==
// @name         GWPC Payload Mirror + Non-AZ Tab Closer
// @namespace    homebot.payload-mirror-non-az-tab-closer
// @version      1.0.27
// @description  After HOME webhook success, mirrors the final GWPC Home payload into shared GM storage, waits 5 seconds, then best-effort closes non-AZ tabs from the shared close signal while leaving AgencyZoom available with mirrored Home state.
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://app.agencyzoom.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/payload-mirror-non-az-tab-closer/payload-mirror-non-az-tab-closer.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/payload-mirror-non-az-tab-closer/payload-mirror-non-az-tab-closer.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'GWPC Payload Mirror + Non-AZ Tab Closer';
  const VERSION = '1.0.27';
  const LEGACY_TIMEOUT_SCRIPT_NAME = 'GWPC Header Timeout Monitor';

  // Log-export integration — runs on 4 origins; pick one key per origin.
  const LOG_PERSIST_KEY = (() => {
    const host = String(location.host || '');
    if (host.includes('agencyzoom.com')) return 'tm_az_payload_mirror_logs_v1';
    if (host.includes('lightning.force.com')) return 'tm_apex_payload_mirror_logs_v1';
    return 'tm_pc_payload_mirror_logs_v1';
  })();
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';

  const GM_KEYS = {
    success: 'tm_pc_webhook_post_success_v1',
    successConsumed: 'tm_pc_webhook_post_success_consumed_v1',
    finalPayload: 'tm_az_gwpc_final_payload_v1',
    finalReady: 'tm_az_gwpc_final_payload_ready_v1',
    closeSignal: 'tm_pc_payload_mirror_close_signal_v1',
    lexCloseConsumed: 'tm_pc_payload_mirror_lex_close_consumed_signal_v1',
    ignoreCloseLease: 'tm_pc_payload_mirror_ignore_close_lease_v1',
    webhookFatalHold: 'tm_pc_webhook_fatal_error_hold_v1',
    tabHeartbeats: 'tm_payload_mirror_tab_heartbeats_v1',
    apexWakeState: 'tm_payload_mirror_apex_wake_state_v1',
    runtimeCleanupRequest: 'tm_pc_runtime_cleanup_request_v1',
    homePayload: 'tm_pc_home_quote_grab_payload_v1',
    missingPayloadTrigger: 'tm_az_missing_payload_fallback_trigger_v1',
    azCurrentJob: 'tm_az_current_job_v1',
    currentJob: 'tm_pc_current_job_v1',
    sharedJob: 'tm_shared_az_job_v1'
  };

  const LS_KEYS = {
    running: 'tm_pc_payload_mirror_running_v1',
    apexWakeEnabled: 'tm_payload_mirror_apex_wake_enabled_v1',
    panelPos: 'tm_pc_payload_mirror_panel_pos_v1'
  };

  const SS_KEYS = {
    handledSignal: 'tm_pc_payload_mirror_last_handled_signal_v1',
    closeAttempted: 'tm_pc_payload_mirror_close_attempted_v1'
  };

  const GWPC_KEYS = [
    'tm_pc_webhook_bundle_v1',
    'tm_pc_current_job_v1',
    'tm_pc_home_quote_grab_payload_v1',
    'tm_pc_header_timeout_runtime_v2',
    'tm_pc_header_timeout_sent_events_v2'
  ];

  const GWPC_LOCAL_RUNTIME_CLEANUP_KEYS = [
    'tm_pc_home_quote_grab_payload_v1',
    'tm_pc_auto_quote_grab_payload_v1',
    'tm_pc_webhook_bundle_v1',
    'tm_pc_current_job_v1',
    'tm_pc_webhook_submit_sent_meta_v17',
    'tm_pc_webhook_submit_stopped_v17',
    'tm_pc_webhook_post_success_v1',
    'tm_pc_flow_stage_v1',
    'tm_pc_payload_mirror_close_signal_v1',
    'tm_pc_payload_mirror_lex_close_consumed_signal_v1',
    'tm_pc_payload_mirror_ignore_close_lease_v1',
    'tm_pc_header_timeout_runtime_v2',
    'tm_pc_header_timeout_sent_events_v2',
    'tm_pc_header_timeout_retry_state_v1',
    'tm_pc_header_timeout_retry_request_v1',
    'tm_pc_header_timeout_retry_requested_context_v1',
    'tm_pc_header_timeout_pending_post_v2',
    'tm_pc_header_timeout_watch_pending_v1',
    'tm_pc_webhook_fatal_error_hold_v1',
    'tm_az_gwpc_final_payload_v1',
    'tm_az_gwpc_final_payload_ready_v1',
    'tm_az_missing_payload_fallback_trigger_v1',
    'tm_az_current_job_v1',
    'tm_shared_az_job_v1'
  ];

  const GWPC_SHARED_RUNTIME_CLEANUP_KEYS = [
    GM_KEYS.success,
    GM_KEYS.finalPayload,
    GM_KEYS.finalReady,
    GM_KEYS.closeSignal,
    GM_KEYS.lexCloseConsumed,
    GM_KEYS.ignoreCloseLease,
    GM_KEYS.webhookFatalHold,
    GM_KEYS.tabHeartbeats,
    GM_KEYS.apexWakeState,
    GM_KEYS.homePayload,
    GM_KEYS.missingPayloadTrigger,
    GM_KEYS.azCurrentJob,
    GM_KEYS.currentJob,
    GM_KEYS.sharedJob,
    'tm_pc_auto_quote_grab_payload_v1',
    'tm_pc_webhook_bundle_v1',
    'tm_pc_webhook_submit_sent_meta_v17',
    'tm_pc_webhook_submit_stopped_v17',
    'tm_pc_flow_stage_v1',
    'tm_pc_header_timeout_runtime_v2',
    'tm_pc_header_timeout_sent_events_v2',
    'tm_pc_header_timeout_retry_state_v1',
    'tm_pc_header_timeout_retry_request_v1',
    'tm_pc_header_timeout_retry_requested_context_v1',
    'tm_pc_header_timeout_pending_post_v2',
    'tm_pc_header_timeout_watch_pending_v1'
  ];

  const GWPC_SESSION_RUNTIME_CLEANUP_KEYS = [
    SS_KEYS.handledSignal,
    SS_KEYS.closeAttempted
  ];

  const CFG = {
    tickMs: 400,
    maxSignalAgeMs: 90000,
    closeSignalMaxAgeMs: 20000,
    runtimeCleanupRequestMaxAgeMs: 10 * 60 * 1000,
    closeDelayMs: 5000,
    samePageCloseMs: 5 * 60 * 1000,
    tabHeartbeatMs: 5000,
    apexWakeMissingMs: 2 * 60 * 1000,
    apexWakeOpenMs: 20000,
    apexWakeCooldownMs: 60000,
    apexWakeMaxWithoutOpenMs: 10 * 60 * 1000,
    apexWakeUrls: [
      'https://farmersagent.lightning.force.com/',
      'https://farmersagent.lightning.force.com/lightning/page/home'
    ],
    ignoreCloseLeaseTtlMs: 8000,
    ignoreCloseLeaseHeartbeatMs: 1500,
    maxLogLines: 70,
    zIndex: 2147483647,
    panelWidth: 330,
    closeRetryMs: 1200,
    maxCloseAttempts: 6
  };

  const state = {
    destroyed: false,
    tabStartedAt: Date.now(),
    running: loadRunning(),
    logs: [],
    panel: null,
    ui: {},
    tickTimer: null,
    gmSuccessListener: null,
    gmReadyListener: null,
    gmRuntimeCleanupListener: null,
    activeSignal: null,
    activeSignalKey: '',
    activeSuccessRunKey: '',
    countdownEndsAt: 0,
    mirrored: false,
    closeAttempted: false,
    closeAttempts: 0,
    closeSignalKey: '',
    logsIntervalTimer: null,
    tabId: `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    apexWakeEnabled: loadApexWakeEnabled(),
    apexWakeMonitorStartedAt: Date.now(),
    apexWakeTab: null,
    apexWakeCloseAt: 0,
    apexWakeStatus: '',
    lastTabHeartbeatAt: 0,
    lastApexWakeLogKey: '',
    lastIgnoreCloseLeaseHeartbeatAt: 0,
    lastIgnoreCloseSignalKey: '',
    lastWebhookFatalHoldLogKey: '',
    lastRuntimeCleanupDeferredKey: '',
    samePageSignature: '',
    samePageSinceAt: 0,
    samePageCloseAttempted: false,
    samePageLoggedArmed: false,
    lexSnagHandledKey: ''
  };

  init();

  function init() {
    buildUi();
    bindUi();
    restorePanelPos();
    renderAll();

    log(`Loaded v${VERSION}`);
    log(`Host: ${location.hostname}`);
    consumeRuntimeCleanupRequest('init-bootstrap');
    writeTabHeartbeat(true);
    if (isAzHost()) log(`APEX wake monitor ${state.apexWakeEnabled ? 'ON' : 'OFF'}`);
    setStatus(state.running ? 'Watching for webhook success' : 'Stopped');

    if (typeof GM_addValueChangeListener === 'function') {
      try {
        state.gmSuccessListener = GM_addValueChangeListener(GM_KEYS.success, () => {
          scheduleImmediateCheck('gm-success');
        });
      } catch {}

      try {
        state.gmReadyListener = GM_addValueChangeListener(GM_KEYS.finalReady, () => {
          scheduleImmediateCheck('gm-ready');
        });
      } catch {}

      try {
        state.gmRuntimeCleanupListener = GM_addValueChangeListener(GM_KEYS.runtimeCleanupRequest, () => {
          scheduleImmediateCheck('gm-runtime-cleanup');
        });
      } catch {}

      try {
        GM_addValueChangeListener(GM_KEYS.closeSignal, () => {
          scheduleImmediateCheck('gm-close');
        });
      } catch {}

      try {
        GM_addValueChangeListener(GM_KEYS.ignoreCloseLease, () => {
          scheduleImmediateCheck('gm-ignore-close');
        });
      } catch {}
    }

    state.tickTimer = setInterval(() => tick(), CFG.tickMs);
    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('beforeunload', handlePageUnload, true);
    window.addEventListener('pagehide', handlePageUnload, true);
    window.addEventListener('resize', keepPanelInView, true);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();

    tick();
    window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { clearIgnoreCloseLeaseIfOwned(); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { window.removeEventListener('beforeunload', handlePageUnload, true); } catch {}
    try { window.removeEventListener('pagehide', handlePageUnload, true); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__; } catch {}
  }

  function loadRunning() {
    // Close handling should re-arm after refresh. Stop is only for this page session.
    try { localStorage.removeItem(LS_KEYS.running); } catch {}
    return true;
  }

  function saveRunning(on) {
    try {
      if (on) localStorage.removeItem(LS_KEYS.running);
      else localStorage.setItem(LS_KEYS.running, '0');
    } catch {}
  }

  function loadApexWakeEnabled() {
    try { return localStorage.getItem(LS_KEYS.apexWakeEnabled) !== '0'; }
    catch { return true; }
  }

  function saveApexWakeEnabled(on) {
    try { localStorage.setItem(LS_KEYS.apexWakeEnabled, on ? '1' : '0'); } catch {}
  }

  function readJson(raw, fallback = null) {
    try {
      if (raw == null || raw === '') return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return value; }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function hashString(value) {
    let hash = 0;
    const text = String(value == null ? '' : value);
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return `h${Math.abs(hash)}`;
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function timeNow() {
    try { return new Date().toLocaleTimeString(); }
    catch { return nowIso(); }
  }

  function isGwpcHost() {
    return /^policycenter(?:-2|-3)?\.farmersinsurance\.com$/i.test(location.hostname);
  }

  function isLexHost() {
    return /^farmersagent\.lightning\.force\.com$/i.test(location.hostname);
  }

  function isAzHost() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function readGM(key, fallback = null) {
    try { return readJson(GM_getValue(key, fallback), fallback); }
    catch { return fallback; }
  }

  function writeGM(key, value) {
    try { GM_setValue(key, value); } catch {}
  }

  function readLocalJson(key) {
    try { return readJson(localStorage.getItem(key), null); }
    catch { return null; }
  }

  function writeSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch {}
  }

  function readSession(key) {
    try { return sessionStorage.getItem(key) || ''; }
    catch { return ''; }
  }

  function clearLocalKey(key) {
    if (!key) return;
    try { localStorage.removeItem(key); } catch {}
  }

  function clearSessionKey(key) {
    if (!key) return;
    try { sessionStorage.removeItem(key); } catch {}
  }

  function clearSharedKey(key) {
    if (!key) return;
    clearLocalKey(key);
    writeGM(key, null);
  }

  function readRuntimeCleanupRequest() {
    const value = readGM(GM_KEYS.runtimeCleanupRequest, null);
    return isPlainObject(value) ? value : null;
  }

  function buildRuntimeCleanupRequestKey(request) {
    return [
      norm(request?.azId || ''),
      norm(request?.requestedAt || ''),
      norm(request?.nonce || '')
    ].join('|');
  }

  function clearRuntimeCleanupRequest(request = null) {
    const current = readRuntimeCleanupRequest();
    const currentKey = buildRuntimeCleanupRequestKey(current);
    const requestKey = buildRuntimeCleanupRequestKey(request || current);
    if (requestKey && currentKey && requestKey !== currentKey) return false;
    clearLocalKey(GM_KEYS.runtimeCleanupRequest);
    writeGM(GM_KEYS.runtimeCleanupRequest, null);
    return true;
  }

  function readLocalGwpcAzIdForRuntimeCleanup() {
    if (!isGwpcHost()) return '';
    const keys = [
      'tm_pc_current_job_v1',
      'tm_pc_webhook_bundle_v1',
      'tm_pc_home_quote_grab_payload_v1',
      'tm_pc_auto_quote_grab_payload_v1'
    ];
    for (const key of keys) {
      const value = readLocalJson(key);
      const data = isPlainObject(value?.data) ? value.data : value;
      const azId = norm(
        value?.['AZ ID']
        || value?.azId
        || value?.ticketId
        || value?.currentJob?.['AZ ID']
        || value?.currentJob?.azId
        || data?.['AZ ID']
        || data?.azId
        || data?.ticketId
        || data?.currentJob?.['AZ ID']
        || ''
      );
      if (azId) return azId;
    }
    return '';
  }

  function extractSubmissionNumber(value) {
    const data = isPlainObject(value?.data) ? value.data : value;
    return norm(
      value?.SubmissionNumber
      || value?.submissionNumber
      || value?.currentJob?.SubmissionNumber
      || data?.SubmissionNumber
      || data?.submissionNumber
      || data?.currentJob?.SubmissionNumber
      || ''
    );
  }

  function readCurrentGwpcIdentity() {
    const currentJob = readLocalJson(GM_KEYS.currentJob);
    const homePayload = readLocalJson(GM_KEYS.homePayload);
    const bundle = readLocalJson('tm_pc_webhook_bundle_v1');

    const azId = norm(
      currentJob?.['AZ ID']
      || extractProductAzId(homePayload)
      || bundle?.['AZ ID']
      || ''
    );

    const submissionNumber = norm(
      currentJob?.SubmissionNumber
      || extractSubmissionNumber(homePayload)
      || extractSubmissionNumber(bundle)
      || ''
    );

    return { azId, submissionNumber };
  }

  function extractMirroredFinalPayloadSubmissionNumber(payload) {
    return norm(
      extractSubmissionNumber(payload)
      || extractSubmissionNumber(payload?.currentJob)
      || extractSubmissionNumber(payload?.bundle)
      || extractSubmissionNumber(payload?.homePayload)
      || ''
    );
  }

  function clearStaleMirroredFinalHandoff(reason = '') {
    if (!isGwpcHost()) return false;

    const finalPayload = readGM(GM_KEYS.finalPayload, null);
    const finalReady = readGM(GM_KEYS.finalReady, null);
    const mirroredAzId = norm(finalPayload?.azId || finalReady?.azId || '');
    if (!mirroredAzId) return false;

    const current = readCurrentGwpcIdentity();
    if (!current.azId) return false;

    const mirroredSubmissionNumber = extractMirroredFinalPayloadSubmissionNumber(finalPayload);
    let staleReason = '';

    if (current.azId !== mirroredAzId) {
      staleReason = `current AZ ${current.azId} != mirrored AZ ${mirroredAzId}`;
    } else if (
      current.submissionNumber
      && mirroredSubmissionNumber
      && current.submissionNumber !== mirroredSubmissionNumber
    ) {
      staleReason = `current submission ${current.submissionNumber} != mirrored submission ${mirroredSubmissionNumber}`;
    }

    if (!staleReason) return false;

    for (const key of [
      GM_KEYS.success,
      GM_KEYS.successConsumed,
      GM_KEYS.finalPayload,
      GM_KEYS.finalReady,
      GM_KEYS.closeSignal,
      GM_KEYS.lexCloseConsumed,
      GM_KEYS.ignoreCloseLease
    ]) {
      clearSharedKey(key);
    }
    resetRuntimeCloseState();
    log(`Cleared stale mirrored final handoff | ${staleReason}${reason ? ` | ${reason}` : ''}`);
    setStatus('Cleared stale mirrored handoff');
    return true;
  }

  function resetRuntimeCloseState() {
    state.activeSignal = null;
    state.activeSignalKey = '';
    state.activeSuccessRunKey = '';
    state.countdownEndsAt = 0;
    state.mirrored = false;
    state.closeAttempted = false;
    state.closeAttempts = 0;
    state.closeSignalKey = '';
    state.lastIgnoreCloseSignalKey = '';
    state.lastWebhookFatalHoldLogKey = '';
    state.lexSnagHandledKey = '';
    resetSamePageWatch('');
    clearSessionKey(SS_KEYS.handledSignal);
    clearSessionKey(SS_KEYS.closeAttempted);
  }

  function applyGwpcRuntimeCleanup(request, reason = '') {
    const cleanAzId = norm(request?.azId || '');
    let cleared = 0;

    for (const key of GWPC_LOCAL_RUNTIME_CLEANUP_KEYS) {
      clearLocalKey(key);
      cleared += 1;
    }
    for (const key of GWPC_SESSION_RUNTIME_CLEANUP_KEYS) {
      clearSessionKey(key);
      cleared += 1;
    }
    for (const key of GWPC_SHARED_RUNTIME_CLEANUP_KEYS) {
      clearSharedKey(key);
      cleared += 1;
    }

    resetRuntimeCloseState();
    clearRuntimeCleanupRequest(request);
    log(
      `GWPC runtime cleanup applied | AZ ${cleanAzId || '(unknown)'} | ${cleared} keys` +
      `${reason ? ` | ${reason}` : ''}`
    );
    setStatus(cleanAzId ? `Runtime cleaned for ${cleanAzId}` : 'Runtime cleaned');
    return true;
  }

  function consumeRuntimeCleanupRequest(reason = 'runtime-cleanup') {
    if (!isGwpcHost()) return false;

    const request = readRuntimeCleanupRequest();
    const requestKey = buildRuntimeCleanupRequestKey(request);
    if (!request || !requestKey) {
      state.lastRuntimeCleanupDeferredKey = '';
      return false;
    }

    const requestedAtMs = parseTimeMs(request.requestedAt);
    if (requestedAtMs && (Date.now() - requestedAtMs) > CFG.runtimeCleanupRequestMaxAgeMs) {
      clearRuntimeCleanupRequest(request);
      log(`Discarded stale runtime cleanup request | AZ ${norm(request.azId || '(unknown)')}`);
      state.lastRuntimeCleanupDeferredKey = '';
      return false;
    }

    const requestAzId = norm(request.azId || '');
    if (!requestAzId) {
      clearRuntimeCleanupRequest(request);
      state.lastRuntimeCleanupDeferredKey = '';
      return false;
    }

    const pageAzId = readLocalGwpcAzIdForRuntimeCleanup();
    if (pageAzId && pageAzId !== requestAzId) {
      const deferredKey = `${requestKey}|${pageAzId}`;
      if (state.lastRuntimeCleanupDeferredKey !== deferredKey) {
        state.lastRuntimeCleanupDeferredKey = deferredKey;
        log(`GWPC runtime cleanup deferred | request AZ ${requestAzId} | page AZ ${pageAzId}`);
      }
      return false;
    }

    state.lastRuntimeCleanupDeferredKey = '';
    return applyGwpcRuntimeCleanup(request, reason);
  }

  function log(message) {
    const line = `[${timeNow()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    renderLogs();
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
    try { GM_setValue(LOG_PERSIST_KEY, payload); } catch {}
  }

  function checkLogClearRequest() {
    if (state.destroyed) return;
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
    if (state.destroyed) return;
    persistLogsThrottled();
    checkLogClearRequest();
  }

  function setStatus(text) {
    if (state.ui.status) state.ui.status.textContent = text;
  }

  function handlePageUnload() {
    clearIgnoreCloseLeaseIfOwned();
    persistPanelPos();
  }

  function parseTimeMs(value) {
    const ms = Date.parse(norm(value || ''));
    return Number.isFinite(ms) ? ms : 0;
  }

  function formatAge(ms) {
    const safe = Math.max(0, Number(ms || 0));
    if (safe < 1000) return '0s';
    const seconds = Math.floor(safe / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const restSeconds = seconds % 60;
    if (minutes < 60) return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
  }

  function buildSignalKey(signal) {
    const explicit = norm(signal?.signalKey || '');
    if (explicit) return explicit;
    return `${norm(signal?.azId || '')}|${norm(signal?.postedAt || signal?.signalPostedAt || '')}`;
  }

  function buildSuccessSignalKey(signal) {
    if (!isPlainObject(signal)) return '';
    return [
      norm(signal?.azId || ''),
      norm(signal?.postedAt || ''),
      norm(signal?.signature || '')
    ].join('|');
  }

  function buildSuccessRunKey(signal) {
    if (!isPlainObject(signal)) return '';
    const azId = norm(signal?.azId || '');
    const signature = norm(signal?.signature || '');
    if (azId && signature) return `${azId}|${signature}`;
    return buildSuccessSignalKey(signal);
  }

  function isFreshSuccessSignal(signal) {
    if (!isPlainObject(signal) || signal.ok !== true) return false;
    const azId = norm(signal.azId || '');
    const postedAt = norm(signal.postedAt || '');
    if (!azId || !postedAt) return false;
    const postedMs = Date.parse(postedAt);
    if (!Number.isFinite(postedMs)) return false;
    return (Date.now() - postedMs) <= CFG.maxSignalAgeMs;
  }

  function readConsumedSuccessSignal() {
    const value = readGM(GM_KEYS.successConsumed, null);
    return isPlainObject(value) ? value : null;
  }

  function isConsumedSuccessSignal(signal) {
    const currentKey = buildSuccessSignalKey(signal);
    if (!currentKey) return false;
    const consumed = readConsumedSuccessSignal();
    if (!isPlainObject(consumed)) return false;
    return buildSuccessSignalKey(consumed) === currentKey;
  }

  function markSuccessSignalConsumed(signal) {
    const signalKey = buildSuccessSignalKey(signal);
    if (!signalKey) return false;
    writeGM(GM_KEYS.successConsumed, {
      azId: norm(signal?.azId || ''),
      postedAt: norm(signal?.postedAt || ''),
      signature: norm(signal?.signature || ''),
      consumedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    });
    return true;
  }

  function readSuccessSignal() {
    const gmValue = readGM(GM_KEYS.success, null);
    if (isFreshSuccessSignal(gmValue) && !isConsumedSuccessSignal(gmValue)) return gmValue;

    const localValue = readLocalJson(GM_KEYS.success);
    if (isFreshSuccessSignal(localValue) && !isConsumedSuccessSignal(localValue)) return localValue;

    return null;
  }

  function readReadySignal() {
    const ready = readGM(GM_KEYS.finalReady, null);
    return isPlainObject(ready) ? ready : null;
  }

  function readMirroredPayloadMeta() {
    const payload = readGM(GM_KEYS.finalPayload, null);
    const ready = readGM(GM_KEYS.finalReady, null);
    const azId = norm(payload?.azId || ready?.azId || '');
    const savedAt = norm(payload?.savedAt || ready?.savedAt || '');
    const signalPostedAt = norm(payload?.signalPostedAt || ready?.signalPostedAt || '');
    if (!azId) return null;
    return {
      azId,
      savedAt,
      signalPostedAt,
      ready: ready?.ready === true
    };
  }

  function pickPreferredPayload(localValue, gmValue, getId, getSavedMs) {
    const localOk = isPlainObject(localValue) && norm(getId(localValue));
    const gmOk = isPlainObject(gmValue) && norm(getId(gmValue));
    if (localOk && !gmOk) return localValue;
    if (!localOk && gmOk) return gmValue;
    if (!localOk && !gmOk) return null;

    const localMs = Number(getSavedMs(localValue) || 0);
    const gmMs = Number(getSavedMs(gmValue) || 0);
    if (localMs && gmMs && localMs !== gmMs) return localMs > gmMs ? localValue : gmValue;
    return localValue;
  }

  function readPreferredMirroredFinalPayload() {
    const localPayload = readLocalJson(GM_KEYS.finalPayload);
    const gmPayload = readGM(GM_KEYS.finalPayload, null);
    return pickPreferredPayload(
      localPayload,
      gmPayload,
      (value) => norm(value?.azId || ''),
      (value) => {
        const candidates = [value?.savedAt, value?.signalPostedAt];
        let best = 0;
        for (const candidate of candidates) {
          const ms = Date.parse(norm(candidate || ''));
          if (Number.isFinite(ms) && ms > best) best = ms;
        }
        return best;
      }
    );
  }

  function readPreferredMirroredProductPayload(key) {
    const localPayload = readLocalJson(key);
    const gmPayload = readGM(key, null);
    return pickPreferredPayload(
      isLegacyTimeoutOwnedProductPayload(localPayload) ? null : localPayload,
      isLegacyTimeoutOwnedProductPayload(gmPayload) ? null : gmPayload,
      (value) => extractProductAzId(value),
      (value) => getProductSavedMs(value)
    );
  }

  function readDownloadableMirrorSnapshot() {
    const finalPayload = readPreferredMirroredFinalPayload();
    const finalReady = readGM(GM_KEYS.finalReady, null);
    const homePayload = readPreferredMirroredProductPayload(GM_KEYS.homePayload);

    const azId = norm(
      finalPayload?.azId
      || finalReady?.azId
      || extractProductAzId(homePayload)
      || ''
    );

    if (!azId && !isPlainObject(finalPayload) && !isPlainObject(homePayload)) {
      return null;
    }

    return {
      exportedAt: nowIso(),
      host: location.hostname,
      origin: location.origin,
      sourceScript: SCRIPT_NAME,
      sourceVersion: VERSION,
      azId,
      finalPayload: isPlainObject(finalPayload) ? deepClone(finalPayload) : {},
      finalReady: isPlainObject(finalReady) ? deepClone(finalReady) : {},
      homePayload: isPlainObject(homePayload) ? deepClone(homePayload) : {}
    };
  }

  function readCopyableMirrorSnapshotWithLogs() {
    const snapshot = readDownloadableMirrorSnapshot();
    if (!snapshot) return null;
    return {
      ...snapshot,
      copiedAt: nowIso(),
      logs: Array.isArray(state.logs) ? state.logs.slice() : []
    };
  }

  function buildDownloadFilename(snapshot) {
    const azId = norm(snapshot?.azId || 'unknown');
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z')
      .replace('T', '_');
    return `gwpc-payload-mirror_${azId}_${stamp}.json`;
  }

  function downloadMirrorSnapshot() {
    const snapshot = readDownloadableMirrorSnapshot();
    if (!snapshot) {
      log('Download skipped: no mirrored payload available yet');
      setStatus('No mirrored payload to download');
      return;
    }

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildDownloadFilename(snapshot);
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    log(`Mirror downloaded for AZ ${snapshot.azId || '(unknown)'}`);
    setStatus('Mirror downloaded');
  }

  async function copyMirrorSnapshotWithLogs() {
    const snapshot = readCopyableMirrorSnapshotWithLogs();
    if (!snapshot) {
      log('Copy skipped: no mirrored payload available yet');
      setStatus('No mirrored payload to copy');
      return false;
    }

    const text = JSON.stringify(snapshot, null, 2);
    let copied = false;

    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {}
    }

    if (!copied) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'readonly');
      Object.assign(textarea.style, {
        position: 'fixed',
        top: '-1000px',
        left: '-1000px',
        opacity: '0'
      });
      document.documentElement.appendChild(textarea);
      try {
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        copied = document.execCommand('copy');
      } catch {}
      textarea.remove();
    }

    if (!copied) {
      log('Copy failed: clipboard access was blocked');
      setStatus('Copy failed');
      return false;
    }

    log(`Mirror + logs copied for AZ ${snapshot.azId || '(unknown)'}`);
    setStatus('Mirror + logs copied');
    return true;
  }

  function readCloseSignal() {
    const value = readGM(GM_KEYS.closeSignal, null);
    return isPlainObject(value) ? value : null;
  }

  function getVisibleGuidewireHeader() {
    const selectors = [
      '.gw-TitleBar--title[role="heading"]',
      '.gw-TitleBar--title',
      '.gw-WizardScreen-title',
      '.gw-Wizard--Title',
      '[role="heading"][aria-level="1"]'
    ];
    for (const selector of selectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          if (!visible(node)) continue;
          const text = norm(node.textContent || '');
          if (text) return text;
        }
      } catch {}
    }
    return '';
  }

  function readCurrentAzIdForCloseFallback() {
    const keys = [
      'tm_pc_current_job_v1',
      'tm_pc_webhook_bundle_v1',
      'tm_pc_home_quote_grab_payload_v1'
    ];
    for (const key of keys) {
      const value = readLocalJson(key);
      const data = isPlainObject(value?.data) ? value.data : value;
      const azId = norm(
        value?.['AZ ID']
        || value?.azId
        || value?.currentJob?.['AZ ID']
        || data?.['AZ ID']
        || data?.azId
        || data?.currentJob?.['AZ ID']
        || ''
      );
      if (azId) return azId;
    }
    return norm(state.activeSignal?.azId || readMirroredPayloadMeta()?.azId || '');
  }

  function extractAzIdFromJobValue(value) {
    if (!isPlainObject(value)) return '';
    const data = isPlainObject(value.data) ? value.data : value;
    return norm(
      value?.['AZ ID']
      || value?.azId
      || value?.ticketId
      || value?.currentJob?.['AZ ID']
      || value?.currentJob?.azId
      || value?.currentJob?.ticketId
      || value?.az?.['AZ ID']
      || value?.az?.azId
      || value?.az?.ticketId
      || data?.['AZ ID']
      || data?.azId
      || data?.ticketId
      || data?.currentJob?.['AZ ID']
      || data?.currentJob?.azId
      || data?.currentJob?.ticketId
      || ''
    );
  }

  function readCurrentAzIdForLexFailure() {
    const keys = [
      GM_KEYS.azCurrentJob,
      GM_KEYS.sharedJob,
      GM_KEYS.currentJob
    ];

    for (const key of keys) {
      const azId = extractAzIdFromJobValue(readGM(key, null));
      if (azId) return azId;
    }

    for (const key of keys) {
      const azId = extractAzIdFromJobValue(readLocalJson(key));
      if (azId) return azId;
    }

    return '';
  }

  function findLexSnagMessage() {
    if (!isLexHost()) return null;
    const selectors = [
      'h1[title]',
      'h2[title]',
      'h3[title]',
      '.slds-card__header-title[title]',
      '.slds-truncate[title]',
      'h1',
      'h2',
      'h3'
    ];

    for (const selector of selectors) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(selector)); } catch {}
      for (const node of nodes) {
        if (!visible(node)) continue;
        const text = norm(node.getAttribute('title') || node.textContent || '');
        if (/^we hit a snag\.?$/i.test(text) || /we hit a snag\./i.test(text)) return node;
      }
    }
    return null;
  }

  function publishMissingPayloadTrigger(ticketId, reason = 'APEX/LEX HIT A SNAG') {
    const cleanTicketId = norm(ticketId || '');
    if (!cleanTicketId) return false;

    const trigger = {
      ready: true,
      ticketId: cleanTicketId,
      azId: cleanTicketId,
      reason: norm(reason || 'APEX/LEX HIT A SNAG') || 'APEX/LEX HIT A SNAG',
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };

    try { localStorage.setItem(GM_KEYS.missingPayloadTrigger, JSON.stringify(trigger)); } catch {}
    writeGM(GM_KEYS.missingPayloadTrigger, trigger);
    log(`Triggered missing payload fallback from LEX snag | ${cleanTicketId} | ${trigger.reason}`);
    return true;
  }

  function closeLexTabAfterSnag(azId = '') {
    state.closeAttempted = true;
    writeSession(SS_KEYS.closeAttempted, '1');
    state.closeAttempts += 1;

    log(`LEX snag detected. Closing tab${azId ? ` | AZ ${azId}` : ''} (${state.closeAttempts}/${CFG.maxCloseAttempts})`);
    setStatus('LEX snag -> failed path');
    tryCloseCurrentTab();

    setTimeout(() => {
      if (state.destroyed || window.closed) return;
      if (state.closeAttempts < CFG.maxCloseAttempts) {
        closeLexTabAfterSnag(azId);
        return;
      }
      log('Close blocked by browser after LEX snag');
      setStatus('Close blocked');
    }, CFG.closeRetryMs);
  }

  function checkLexSnagFailure() {
    const snag = findLexSnagMessage();
    if (!snag) return false;

    const azId = readCurrentAzIdForLexFailure();
    const snagText = norm(snag.getAttribute('title') || snag.textContent || 'We hit a snag.');
    const handledKey = `${azId || '(missing)'}|${snagText}`;
    if (state.lexSnagHandledKey === handledKey) return false;
    state.lexSnagHandledKey = handledKey;

    if (azId) {
      publishMissingPayloadTrigger(azId, 'APEX/LEX HIT A SNAG');
    } else {
      log('LEX snag detected, but no current AZ ID was available; closing tab without fallback trigger');
    }

    closeLexTabAfterSnag(azId);
    return true;
  }

  function getHeartbeatKind() {
    if (isAzHost()) return 'az';
    if (isLexHost()) return 'lex';
    if (isGwpcHost()) return 'gwpc';
    return '';
  }

  function readTabHeartbeats() {
    const gmValue = readGM(GM_KEYS.tabHeartbeats, null);
    if (isPlainObject(gmValue)) return gmValue;
    return {};
  }

  function saveTabHeartbeats(next) {
    writeGM(GM_KEYS.tabHeartbeats, isPlainObject(next) ? next : {});
  }

  function writeTabHeartbeat(force = false) {
    const kind = getHeartbeatKind();
    if (!kind) return;
    const now = Date.now();
    if (!force && (now - Number(state.lastTabHeartbeatAt || 0)) < CFG.tabHeartbeatMs) return;
    state.lastTabHeartbeatAt = now;

    const heartbeats = readTabHeartbeats();
    heartbeats[kind] = {
      kind,
      tabId: state.tabId,
      host: location.hostname,
      url: location.href,
      title: document.title,
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    saveTabHeartbeats(heartbeats);
  }

  function getLastHeartbeatMsForKind(kind, heartbeats = null) {
    const value = isPlainObject(heartbeats) ? heartbeats : readTabHeartbeats();
    return parseTimeMs(value?.[kind]?.updatedAt);
  }

  function readApexWakeState() {
    const value = readGM(GM_KEYS.apexWakeState, null);
    return isPlainObject(value) ? value : {};
  }

  function saveApexWakeState(next) {
    writeGM(GM_KEYS.apexWakeState, isPlainObject(next) ? next : {});
  }

  function chooseApexWakeUrl() {
    const urls = Array.isArray(CFG.apexWakeUrls) ? CFG.apexWakeUrls.filter(Boolean) : [];
    if (!urls.length) return 'https://farmersagent.lightning.force.com/';
    return urls[Math.floor(Math.random() * urls.length)];
  }

  function isWakeStateActive(wakeState) {
    if (!isPlainObject(wakeState) || wakeState.wakeActive !== true) return false;
    const closeAtMs = parseTimeMs(wakeState.wakeCloseAt);
    if (!closeAtMs) return false;
    return Date.now() < (closeAtMs + CFG.apexWakeOpenMs);
  }

  function closeOwnedApexWakeTabIfReady() {
    if (!state.apexWakeCloseAt || Date.now() < state.apexWakeCloseAt) return;

    let closeOk = false;
    try {
      if (state.apexWakeTab && typeof state.apexWakeTab.close === 'function') {
        state.apexWakeTab.close();
        closeOk = true;
      }
    } catch {}

    const wakeState = readApexWakeState();
    if (norm(wakeState.ownerTabId || '') === state.tabId) {
      saveApexWakeState({
        ...wakeState,
        wakeActive: false,
        wakeClosedAt: nowIso(),
        closeOk,
        missingSinceAt: nowIso(),
        source: SCRIPT_NAME,
        version: VERSION
      });
    }

    state.apexWakeTab = null;
    state.apexWakeCloseAt = 0;
    state.apexWakeStatus = closeOk ? 'Wake tab closed' : 'Wake close attempted';
    log(closeOk ? 'APEX wake tab closed after 20s' : 'APEX wake tab close attempted, but no closable tab handle was available');
  }

  function openApexWakeTab() {
    if (typeof GM_openInTab !== 'function') {
      state.apexWakeStatus = 'GM_openInTab unavailable';
      log('APEX wake skipped: GM_openInTab unavailable');
      return false;
    }

    const now = Date.now();
    const startedAt = nowIso();
    const wakeUrl = chooseApexWakeUrl();
    const closeAt = new Date(now + CFG.apexWakeOpenMs).toISOString();
    const wakeState = {
      wakeActive: true,
      ownerTabId: state.tabId,
      ownerHost: location.hostname,
      ownerUrl: location.href,
      wakeUrl,
      wakeStartedAt: startedAt,
      wakeCloseAt: closeAt,
      lastWakeAt: startedAt,
      source: SCRIPT_NAME,
      version: VERSION
    };

    saveApexWakeState(wakeState);

    try {
      state.apexWakeTab = GM_openInTab(wakeUrl, {
        active: false,
        insert: true,
        setParent: true
      });
      state.apexWakeCloseAt = now + CFG.apexWakeOpenMs;
      state.apexWakeStatus = 'Wake tab open';
      log(`APEX wake opened for 20s | ${wakeUrl}`);
      return true;
    } catch (err) {
      saveApexWakeState({
        ...wakeState,
        wakeActive: false,
        wakeFailedAt: nowIso(),
        error: norm(err?.message || err || 'open failed')
      });
      state.apexWakeStatus = 'Wake open failed';
      log(`APEX wake open failed: ${err?.message || err}`);
      return false;
    }
  }

  function checkApexWakeMonitor() {
    closeOwnedApexWakeTabIfReady();
    if (!isAzHost()) {
      state.apexWakeStatus = 'AZ only';
      return;
    }
    if (!state.apexWakeEnabled) {
      state.apexWakeStatus = 'Off';
      return;
    }

    const heartbeats = readTabHeartbeats();
    const lastLexMs = getLastHeartbeatMsForKind('lex', heartbeats);
    const lastGwpcMs = getLastHeartbeatMsForKind('gwpc', heartbeats);
    const wakeState = readApexWakeState();

    if (lastLexMs && (Date.now() - lastLexMs) < CFG.apexWakeMissingMs) {
      if (norm(wakeState.missingSinceAt || '')) {
        saveApexWakeState({
          ...wakeState,
          missingSinceAt: '',
          lastHealthyAt: nowIso(),
          source: SCRIPT_NAME,
          version: VERSION
        });
      }
      state.apexWakeStatus = `LEX healthy ${formatAge(Date.now() - lastLexMs)} ago`;
      state.lastApexWakeLogKey = '';
      return;
    }

    let missingSinceMs = parseTimeMs(wakeState.missingSinceAt);
    const derivedMissingSinceMs = Math.max(lastLexMs || missingSinceMs || Date.now(), Number(state.apexWakeMonitorStartedAt || 0));
    if (!missingSinceMs || Math.abs(missingSinceMs - derivedMissingSinceMs) > 1000) {
      missingSinceMs = derivedMissingSinceMs;
      saveApexWakeState({
        ...wakeState,
        missingSinceAt: new Date(missingSinceMs).toISOString(),
        source: SCRIPT_NAME,
        version: VERSION
      });
    }

    const now = Date.now();
    const missingMs = now - missingSinceMs;
    const lastWakeMs = parseTimeMs(wakeState.lastWakeAt || wakeState.wakeStartedAt);
    const maxGapRemainingMs = lastWakeMs
      ? Math.max(0, CFG.apexWakeMaxWithoutOpenMs - (now - lastWakeMs))
      : Number.POSITIVE_INFINITY;
    const remainingMs = Math.max(0, Math.min(CFG.apexWakeMissingMs - missingMs, maxGapRemainingMs));
    const gwpcTail = lastGwpcMs
      ? ` | GWPC healthy ${formatAge(now - lastGwpcMs)} ago`
      : ' | GWPC missing';
    if (remainingMs > 0) {
      state.apexWakeStatus = `LEX missing, wake in ${formatAge(remainingMs)}${gwpcTail}`;
      return;
    }

    if (isWakeStateActive(wakeState)) {
      state.apexWakeStatus = `Wake already active${gwpcTail}`;
      return;
    }

    const lastWakeAgeMs = lastWakeMs ? now - lastWakeMs : Number.POSITIVE_INFINITY;
    if (lastWakeMs && lastWakeAgeMs < CFG.apexWakeCooldownMs && lastWakeAgeMs < CFG.apexWakeMaxWithoutOpenMs) {
      state.apexWakeStatus = `Cooldown ${formatAge(CFG.apexWakeCooldownMs - lastWakeAgeMs)}${gwpcTail}`;
      return;
    }

    const logKey = `missing-${Math.floor(missingSinceMs / 1000)}`;
    if (state.lastApexWakeLogKey !== logKey) {
      state.lastApexWakeLogKey = logKey;
      log(`No APEX/LEX heartbeat; opening APEX wake tab (max ${Math.round(CFG.apexWakeMaxWithoutOpenMs / 60000)}m without wake)`);
    }
    openApexWakeTab();
  }

  function readWebhookFatalHold() {
    const gmValue = readGM(GM_KEYS.webhookFatalHold, null);
    if (isPlainObject(gmValue) && gmValue.active === true) return gmValue;
    const localValue = readLocalJson(GM_KEYS.webhookFatalHold);
    if (isPlainObject(localValue) && localValue.active === true) return localValue;
    return null;
  }

  function getActiveWebhookFatalHold() {
    if (!isGwpcHost()) return null;
    const hold = readWebhookFatalHold();
    if (!hold) return null;

    const holdAzId = norm(hold.azId || '');
    const currentAzId = readCurrentAzIdForCloseFallback();
    if (holdAzId && currentAzId && holdAzId !== currentAzId) return null;

    return hold;
  }

  function shouldHoldOpenForWebhookFatalError() {
    const hold = getActiveWebhookFatalHold();
    if (!hold) {
      state.lastWebhookFatalHoldLogKey = '';
      return false;
    }

    const logKey = `${norm(hold.azId || '')}|${norm(hold.createdAt || '')}|${norm(hold.error || '')}`;
    if (state.lastWebhookFatalHoldLogKey !== logKey) {
      state.lastWebhookFatalHoldLogKey = logKey;
      log(`Webhook fatal error hold active; close disabled | AZ ${norm(hold.azId || '(blank)')} | submission ${norm(hold.submissionNumber || '(blank)')} | error="${norm(hold.error || 'HTTP 404')}"`);
    }
    setStatus('Webhook error hold - not closing');
    return true;
  }

  function getSamePageSignature() {
    return [
      location.origin,
      location.pathname,
      location.search,
      location.hash,
      getVisibleGuidewireHeader() || document.title || ''
    ].map(norm).join('|');
  }

  function resetSamePageWatch(signature = '') {
    state.samePageSignature = signature;
    state.samePageSinceAt = signature ? Date.now() : 0;
    state.samePageCloseAttempted = false;
    state.samePageLoggedArmed = false;
  }

  function checkGwpcSamePageCloseWatchdog() {
    if (!isGwpcHost()) return;
    if (shouldHoldOpenForWebhookFatalError()) return;
    if (getActiveIgnoreCloseLease()) return;
    if (state.countdownEndsAt || state.closeAttempted || state.samePageCloseAttempted) return;

    const signature = getSamePageSignature();
    if (!signature) {
      resetSamePageWatch('');
      return;
    }

    if (state.samePageSignature !== signature) {
      resetSamePageWatch(signature);
      return;
    }

    const ageMs = Date.now() - Number(state.samePageSinceAt || Date.now());
    if (!state.samePageLoggedArmed && ageMs >= 1000) {
      state.samePageLoggedArmed = true;
      log('GWPC same-page close watchdog armed for 5m');
    }
    if (ageMs < CFG.samePageCloseMs) return;

    const signal = {
      ok: true,
      azId: readCurrentAzIdForCloseFallback() || 'unknown',
      postedAt: nowIso(),
      signalKey: `same-page|${hashString(signature)}|${state.samePageSinceAt}`,
      source: SCRIPT_NAME,
      version: VERSION,
      reason: 'same-page-watchdog'
    };

    state.samePageCloseAttempted = true;
    state.activeSignal = signal;
    state.activeSignalKey = buildSignalKey(signal);
    log(`GWPC same-page watchdog reached 5m; closing tab | header="${getVisibleGuidewireHeader() || '(unknown)'}" | AZ ${signal.azId}`);
    attemptClose(signal);
  }

  function readIgnoreCloseLease() {
    const value = readGM(GM_KEYS.ignoreCloseLease, null);
    return isPlainObject(value) ? value : null;
  }

  function getActiveIgnoreCloseLease() {
    const lease = readIgnoreCloseLease();
    if (!isPlainObject(lease)) return null;
    const ownerTabId = norm(lease.ownerTabId || '');
    const updatedAt = norm(lease.updatedAt || lease.claimedAt || '');
    if (!ownerTabId || !updatedAt) return null;
    const updatedMs = Date.parse(updatedAt);
    if (!Number.isFinite(updatedMs)) return null;
    if ((Date.now() - updatedMs) > CFG.ignoreCloseLeaseTtlMs) return null;
    return lease;
  }

  function isIgnoreCloseLeaseOwnedByThisTab(lease = null) {
    const current = isPlainObject(lease) ? lease : getActiveIgnoreCloseLease();
    return !!current && norm(current.ownerTabId || '') === state.tabId;
  }

  function claimIgnoreCloseLease() {
    const lease = {
      ownerTabId: state.tabId,
      ownerHost: location.hostname,
      ownerUrl: location.href,
      claimedAt: nowIso(),
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeGM(GM_KEYS.ignoreCloseLease, lease);
    state.lastIgnoreCloseLeaseHeartbeatAt = Date.now();
    return lease;
  }

  function refreshIgnoreCloseLeaseHeartbeat() {
    const current = getActiveIgnoreCloseLease();
    if (!current || norm(current.ownerTabId || '') !== state.tabId) return false;
    if ((Date.now() - Number(state.lastIgnoreCloseLeaseHeartbeatAt || 0)) < CFG.ignoreCloseLeaseHeartbeatMs) return true;
    const next = {
      ...current,
      ownerHost: location.hostname,
      ownerUrl: location.href,
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeGM(GM_KEYS.ignoreCloseLease, next);
    state.lastIgnoreCloseLeaseHeartbeatAt = Date.now();
    return true;
  }

  function clearIgnoreCloseLeaseIfOwned() {
    const current = readIgnoreCloseLease();
    if (!current) return false;
    if (norm(current.ownerTabId || '') !== state.tabId) return false;
    writeGM(GM_KEYS.ignoreCloseLease, null);
    return true;
  }

  function setIgnoreCloseEnabledForThisPage(enabled) {
    if (enabled) {
      const previous = getActiveIgnoreCloseLease();
      const lease = claimIgnoreCloseLease();
      if (previous && norm(previous.ownerTabId || '') && norm(previous.ownerTabId || '') !== state.tabId) {
        log(`Ignore close ON for this page load | took over from ${norm(previous.ownerHost || 'another tab') || 'another tab'}`);
      } else {
        log('Ignore close ON for this page load');
      }
      setStatus('Ignoring shared close until refresh');
      renderAll();
      return lease;
    }

    const cleared = clearIgnoreCloseLeaseIfOwned();
    if (cleared) {
      log('Ignore close OFF for this page load');
    } else {
      log('Ignore close OFF skipped: this page is not the owner');
    }
    setStatus(state.running ? 'Watching for webhook success' : 'Stopped');
    renderAll();
    return null;
  }

  function logIgnoreCloseActive(signal) {
    const signalKey = buildSignalKey(signal);
    if (!signalKey || state.lastIgnoreCloseSignalKey === signalKey) return;
    state.lastIgnoreCloseSignalKey = signalKey;
    const lease = getActiveIgnoreCloseLease();
    const ownerHost = norm(lease?.ownerHost || '') || '(unknown)';
    const ownerUrl = norm(lease?.ownerUrl || '') || '(unknown)';
    log(`Ignoring close signal until owner page refresh | signalKey=${signalKey} | ownerHost=${ownerHost} | ownerUrl=${ownerUrl}`);
  }

  function shouldIgnoreCloseForActiveLease(signal = null) {
    const lease = getActiveIgnoreCloseLease();
    if (!lease) {
      state.lastIgnoreCloseSignalKey = '';
      return false;
    }
    logIgnoreCloseActive(signal);
    setStatus('Ignoring shared close until refresh');
    return true;
  }

  function readLexCloseConsumedSignal() {
    const value = readGM(GM_KEYS.lexCloseConsumed, null);
    return isPlainObject(value) ? value : null;
  }

  function readLexCloseClaimForSignal(signal) {
    const signalKey = buildSignalKey(signal);
    if (!signalKey) return null;
    const value = readLexCloseConsumedSignal();
    return buildSignalKey(value) === signalKey ? value : null;
  }

  function isFreshCloseSignal(signal) {
    if (!isPlainObject(signal)) return false;
    const azId = norm(signal.azId || '');
    const postedAt = norm(signal.postedAt || '');
    if (!azId || !postedAt) return false;
    const postedMs = Date.parse(postedAt);
    if (!Number.isFinite(postedMs)) return false;
    if (postedMs + 1000 < state.tabStartedAt) return false;
    return (Date.now() - postedMs) <= CFG.closeSignalMaxAgeMs;
  }

  function isLexCloseConsumedForSignal(signal) {
    return !!readLexCloseClaimForSignal(signal);
  }

  function isLexCloseConsumedByOtherTab(signal) {
    const claim = readLexCloseClaimForSignal(signal);
    return !!claim && norm(claim.claimedBy || '') !== state.tabId;
  }

  function claimLexCloseSignal(signal) {
    if (!isLexHost()) return true;
    const signalKey = buildSignalKey(signal);
    if (!signalKey) return false;
    const existing = readLexCloseClaimForSignal(signal);
    if (existing) return norm(existing.claimedBy || '') === state.tabId;

    writeGM(GM_KEYS.lexCloseConsumed, {
      signalKey,
      azId: norm(signal?.azId || ''),
      postedAt: norm(signal?.postedAt || signal?.signalPostedAt || ''),
      claimedAt: nowIso(),
      claimedBy: state.tabId,
      source: SCRIPT_NAME,
      version: VERSION
    });

    const latest = readLexCloseConsumedSignal();
    return buildSignalKey(latest) === signalKey && norm(latest?.claimedBy || '') === state.tabId;
  }

  function readyMatchesSignal(signal) {
    const ready = readReadySignal();
    if (!ready || ready.ready !== true) return false;
    return buildSignalKey(ready) === buildSignalKey(signal);
  }

  function unwrapProductPayload(raw) {
    if (!isPlainObject(raw)) return {};
    return isPlainObject(raw.data) ? raw.data : raw;
  }

  function isLegacyTimeoutOwnedProductPayload(raw) {
    if (!isPlainObject(raw)) return false;
    const data = unwrapProductPayload(raw);
    const latestError = isPlainObject(raw?.latestError)
      ? raw.latestError
      : (isPlainObject(data?.latestError) ? data.latestError : {});

    if (norm(raw?.script || data?.script || '') === LEGACY_TIMEOUT_SCRIPT_NAME) return true;
    if (norm(raw?.event || data?.event || '') === 'gwpc_timeout_gathered') return true;
    return norm(latestError?.source || '') === LEGACY_TIMEOUT_SCRIPT_NAME;
  }

  function extractProductAzId(raw) {
    const data = unwrapProductPayload(raw);
    return norm(
      raw?.['AZ ID']
      || data?.['AZ ID']
      || raw?.currentJob?.['AZ ID']
      || data?.currentJob?.['AZ ID']
      || ''
    );
  }

  function getProductSavedMs(raw) {
    const data = unwrapProductPayload(raw);
    const candidates = [
      raw?.savedAt,
      data?.savedAt,
      raw?.meta?.updatedAt,
      data?.meta?.updatedAt,
      raw?.currentJob?.updatedAt,
      data?.currentJob?.updatedAt
    ];
    let best = 0;
    for (const value of candidates) {
      const ms = Date.parse(norm(value || ''));
      if (Number.isFinite(ms) && ms > best) best = ms;
    }
    return best;
  }

  function getProductRow(raw) {
    const data = unwrapProductPayload(raw);
    if (isPlainObject(raw?.row)) return raw.row;
    if (isPlainObject(data?.row)) return data.row;
    return {};
  }

  function scoreProductPayload(product, raw) {
    if (!isPlainObject(raw)) return -1;
    const data = unwrapProductPayload(raw);
    const row = getProductRow(raw);
    let score = 0;

    if (raw.ready === true || data.ready === true) score += 20;
    if (norm(raw?.currentJob?.SubmissionNumber || data?.currentJob?.SubmissionNumber || '')) score += 4;

    if (product === 'home') {
      score += countFilledKeys(row, [
        'CFP?',
        'Reconstruction Cost',
        'Year Built',
        'Square FT',
        '# of Story',
        'Water Device?',
        'Standard Pricing No Auto Discount',
        'Enhance Pricing No Auto Discount',
        'Standard Pricing Auto Discount',
        'Enhance Pricing Auto Discount',
        'Submission Number',
        'Done?'
      ]) * 3;
    }

    return score;
  }

  function shouldReplaceProductPayload(product, existing, next) {
    if (!isPlainObject(next) || !extractProductAzId(next)) return false;
    if (!isPlainObject(existing) || !extractProductAzId(existing)) return true;

    const existingMs = getProductSavedMs(existing);
    const nextMs = getProductSavedMs(next);
    if (existingMs && nextMs && existingMs !== nextMs) return nextMs > existingMs;
    if (!existingMs && nextMs) return true;

    const existingScore = scoreProductPayload(product, existing);
    const nextScore = scoreProductPayload(product, next);
    if (existingScore !== nextScore) return nextScore > existingScore;

    const existingKey = `${extractProductAzId(existing)}|${existingMs}|${existingScore}`;
    const nextKey = `${extractProductAzId(next)}|${nextMs}|${nextScore}`;
    return existingKey !== nextKey;
  }

  function syncMirroredProductPayload(product, key) {
    if (!isGwpcHost()) return false;
    const localPayload = readLocalJson(key);
    const existing = readGM(key, null);
    if (isLegacyTimeoutOwnedProductPayload(localPayload)) {
      try { localStorage.removeItem(key); } catch {}
      if (isLegacyTimeoutOwnedProductPayload(existing)) writeGM(key, null);
      log(`Purged legacy timeout-owned ${product === 'home' ? 'Home' : 'Auto'} payload`);
      return true;
    }

    if (!isPlainObject(localPayload) || !extractProductAzId(localPayload)) {
      if (isLegacyTimeoutOwnedProductPayload(existing)) {
        writeGM(key, null);
        log(`Cleared mirrored legacy timeout-owned ${product === 'home' ? 'Home' : 'Auto'} payload`);
        return true;
      }
      return false;
    }

    if (isLegacyTimeoutOwnedProductPayload(existing)) {
      writeGM(key, null);
    }

    if (!shouldReplaceProductPayload(product, existing, localPayload)) return false;

    writeGM(key, localPayload);
    log(`${product === 'home' ? 'Home' : 'Auto'} payload mirrored for AZ ${extractProductAzId(localPayload)}`);
    return true;
  }

  function countFilledKeys(value, keys) {
    if (!isPlainObject(value)) return 0;
    let count = 0;
    for (const key of keys) {
      if (norm(value[key] || '')) count += 1;
    }
    return count;
  }

  function scoreMirroredPayload(payload) {
    if (!isPlainObject(payload)) return -1;
    const bundle = isPlainObject(payload.bundle) ? payload.bundle : {};
    const homePayloadRaw = isPlainObject(payload.homePayload) ? payload.homePayload : {};
    const homePayload = isLegacyTimeoutOwnedProductPayload(homePayloadRaw) ? {} : homePayloadRaw;
    const homeData = isPlainObject(bundle.home?.data) ? bundle.home.data : homePayload;
    const homeRow = isPlainObject(homeData?.row) ? homeData.row : {};
    const scoreKeysHome = [
      'CFP?',
      'Reconstruction Cost',
      'Year Built',
      'Square FT',
      '# of Story',
      'Water Device?',
      'Standard Pricing No Auto Discount',
      'Enhance Pricing No Auto Discount',
      'Standard Pricing Auto Discount',
      'Enhance Pricing Auto Discount',
      'Submission Number',
      'Done?'
    ];

    let score = 0;
    if (norm(payload.currentJob?.['SubmissionNumber'] || '')) score += 5;
    if (bundle.home?.ready === true || homePayload.ready === true) score += 20;
    score += countFilledKeys(homeRow, scoreKeysHome) * 3;
    if (Array.isArray(bundle.timeout?.events) && bundle.timeout.events.length) score += 2;
    return score;
  }

  function collectGwpcPayloads(signal) {
    const rawKeysFound = [];
    const currentJob = readLocalKey('tm_pc_current_job_v1', rawKeysFound) || {};
    const bundle = readLocalKey('tm_pc_webhook_bundle_v1', rawKeysFound) || {};
    const homePayloadRaw = readLocalKey('tm_pc_home_quote_grab_payload_v1', rawKeysFound) || {};
    const homePayload = isLegacyTimeoutOwnedProductPayload(homePayloadRaw) ? {} : homePayloadRaw;
    const timeoutRuntime = readLocalKey('tm_pc_header_timeout_runtime_v2', rawKeysFound);
    const timeoutSentEvents = readLocalKey('tm_pc_header_timeout_sent_events_v2', rawKeysFound);

    const timeoutPayload = {};
    if (isPlainObject(bundle?.timeout) || Array.isArray(bundle?.timeout?.events)) {
      timeoutPayload.bundleTimeout = deepClone(bundle.timeout);
    }
    if (isPlainObject(timeoutRuntime)) {
      timeoutPayload.runtime = timeoutRuntime;
    }
    if (isPlainObject(timeoutSentEvents)) {
      timeoutPayload.sentEvents = timeoutSentEvents;
    }

    return {
      azId: norm(signal?.azId || currentJob?.['AZ ID'] || bundle?.['AZ ID'] || homePayload?.['AZ ID'] || ''),
      savedAt: nowIso(),
      signalPostedAt: norm(signal?.postedAt || ''),
      signalKey: buildSignalKey(signal),
      source: 'GWPC',
      currentJob: isPlainObject(currentJob) ? currentJob : {},
      bundle: isPlainObject(bundle) ? bundle : {},
      homePayload: isPlainObject(homePayload) ? homePayload : {},
      timeoutPayload: Object.keys(timeoutPayload).length ? timeoutPayload : {},
      rawKeysFound
    };
  }

  function readLocalKey(key, foundKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return null;
      foundKeys.push(key);
      return readJson(raw, null);
    } catch {
      return null;
    }
  }

  function mirrorPayloadFromGwpc(signal) {
    if (!isGwpcHost()) return false;

    const payload = collectGwpcPayloads(signal);
    if (!payload.azId) {
      log('Mirror skipped: AZ ID not found in GWPC payload keys');
      return false;
    }

    const existing = readGM(GM_KEYS.finalPayload, null);
    const existingKey = norm(existing?.signalKey || '');
    const nextKey = norm(payload.signalKey || '');
    if (isPlainObject(existing) && norm(existing.azId || '') === payload.azId) {
      const existingSignalMs = Date.parse(norm(existing.signalPostedAt || ''));
      const nextSignalMs = Date.parse(norm(payload.signalPostedAt || ''));
      if (existingKey && nextKey && existingKey === nextKey) {
        const existingScore = scoreMirroredPayload(existing);
        const nextScore = scoreMirroredPayload(payload);
        if (nextScore < existingScore) {
          log(`Mirror skipped: existing payload score ${existingScore} is better than ${nextScore}`);
          state.mirrored = true;
          return false;
        }
      } else if (Number.isFinite(existingSignalMs) && Number.isFinite(nextSignalMs) && existingSignalMs > nextSignalMs) {
        log('Mirror skipped: existing payload is from a newer webhook success');
        state.mirrored = true;
        return false;
      }
    }

    writeGM(GM_KEYS.finalPayload, payload);
    writeGM(GM_KEYS.finalReady, {
      ready: true,
      azId: payload.azId,
      savedAt: payload.savedAt,
      signalPostedAt: payload.signalPostedAt,
      signalKey: payload.signalKey
    });

    state.mirrored = true;
    log(`Final payload mirrored for AZ ${payload.azId}`);
    return true;
  }

  function syncMirroredProductPayloadsFromGwpc() {
    if (!isGwpcHost()) return false;
    return syncMirroredProductPayload('home', GM_KEYS.homePayload);
  }

  function bridgePayloadToAzLocal() {
    if (!isAzHost()) return false;
    const payload = readGM(GM_KEYS.finalPayload, null);
    const ready = readGM(GM_KEYS.finalReady, null);
    if (!isPlainObject(payload)) return false;
    try { localStorage.setItem(GM_KEYS.finalPayload, JSON.stringify(payload, null, 2)); } catch {}
    if (isPlainObject(ready)) {
      try { localStorage.setItem(GM_KEYS.finalReady, JSON.stringify(ready, null, 2)); } catch {}
    }
    state.mirrored = true;
    return true;
  }

  function bridgeProductPayloadsToAzLocal() {
    if (!isAzHost()) return false;
    let bridged = false;
    for (const key of [GM_KEYS.homePayload]) {
      const localPayload = readLocalJson(key);
      const payload = readGM(key, null);
      if (isLegacyTimeoutOwnedProductPayload(payload)) {
        try { localStorage.removeItem(key); } catch {}
        writeGM(key, null);
        bridged = true;
        continue;
      }
      if ((!isPlainObject(payload) || !extractProductAzId(payload)) && isLegacyTimeoutOwnedProductPayload(localPayload)) {
        try { localStorage.removeItem(key); } catch {}
        bridged = true;
        continue;
      }
      if (!isPlainObject(payload) || !extractProductAzId(payload)) continue;
      try {
        localStorage.setItem(key, JSON.stringify(payload, null, 2));
        bridged = true;
      } catch {}
    }
    return bridged;
  }

  function scheduleImmediateCheck(reason) {
    try { tick(reason); } catch {}
  }

  function shouldIgnoreSignal(signalKey) {
    return !!signalKey && readSession(SS_KEYS.handledSignal) === signalKey;
  }

  function markSignalHandled(signalKey) {
    writeSession(SS_KEYS.handledSignal, signalKey);
  }

  function startCountdown(signal) {
    if (!signal || !buildSignalKey(signal)) return;
    if (state.countdownEndsAt) return;

    state.countdownEndsAt = Date.now() + CFG.closeDelayMs;
    state.closeAttempted = false;
    state.closeAttempts = 0;
    state.mirrored = readyMatchesSignal(signal);
    state.activeSuccessRunKey = buildSuccessRunKey(signal);
    markSignalHandled(buildSignalKey(signal));
    markSuccessSignalConsumed(signal);
    log(`Close countdown started for AZ ${signal.azId}`);
    setStatus('Closing non-AZ tab soon');
  }

  function publishCloseSignal(signal) {
    const signalKey = buildSignalKey(signal);
    if (!signalKey || state.closeSignalKey === signalKey) return;
    state.closeSignalKey = signalKey;
    writeGM(GM_KEYS.closeSignal, {
      azId: norm(signal.azId || ''),
      postedAt: norm(signal.postedAt || ''),
      closeAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    });
    log(`Close signal published for AZ ${signal.azId}`);
  }

  function closeSignalMatches(signal) {
    const closeSignal = readCloseSignal();
    if (!closeSignal) return false;
    return buildSignalKey(closeSignal) === buildSignalKey(signal);
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

  function attemptClose(signal = null) {
    const effectiveSignal = isPlainObject(signal) ? signal : (state.activeSignal || readCloseSignal());
    if (!state.activeSignal && !isFreshCloseSignal(effectiveSignal)) return;
    if (shouldHoldOpenForWebhookFatalError()) return;
    if (shouldIgnoreCloseForActiveLease(effectiveSignal)) return;

    const signalKey = buildSignalKey(effectiveSignal);
    if (isLexHost()) {
      if (!signalKey) return;
      if (!claimLexCloseSignal(effectiveSignal)) {
        state.closeAttempted = true;
        writeSession(SS_KEYS.closeAttempted, '1');
        markSignalHandled(signalKey);
        log('LEX close already consumed for this signal');
        setStatus('LEX close already consumed');
        return;
      }
    }

    state.closeAttempted = true;
    writeSession(SS_KEYS.closeAttempted, '1');
    if (signalKey) markSignalHandled(signalKey);

    state.closeAttempts += 1;

    if (state.closeAttempts === 1) {
      const postedMs = Date.parse(norm(effectiveSignal?.postedAt || ''));
      const signalAgeSec = Number.isFinite(postedMs) ? Math.round((Date.now() - postedMs) / 1000) : -1;
      const successSig = readSuccessSignal();
      const successPostedMs = Date.parse(norm(successSig?.postedAt || ''));
      const successAgeSec = Number.isFinite(successPostedMs) ? Math.round((Date.now() - successPostedMs) / 1000) : -1;
      const closeSig = readCloseSignal();
      const closePostedMs = Date.parse(norm(closeSig?.postedAt || ''));
      const closeAgeSec = Number.isFinite(closePostedMs) ? Math.round((Date.now() - closePostedMs) / 1000) : -1;
      log(`[CLOSE-TAB-DIAG] payload-mirror FIRING close | signalKey=${signalKey || '(none)'} | azId=${norm(effectiveSignal?.azId || '(none)')} | signalPostedAt=${norm(effectiveSignal?.postedAt || '(none)')} | signalAgeSec=${signalAgeSec} | successAgeSec=${successAgeSec} | closeSignalAgeSec=${closeAgeSec} | hadCountdown=${Boolean(state.countdownEndsAt)} | host=${location.hostname} | url=${location.href}`);
      _lastLogPersistAt = 0;
      persistLogsThrottled();
    }

    log(`Attempting to close current non-AZ tab (${state.closeAttempts}/${CFG.maxCloseAttempts})`);
    setStatus(`Attempting to close tab (${state.closeAttempts})`);
    tryCloseCurrentTab();

    setTimeout(() => {
      if (state.destroyed || window.closed) return;
      if (state.closeAttempts < CFG.maxCloseAttempts) {
        attemptClose();
        return;
      }
      log('Close blocked by browser after repeated attempts');
      setStatus('Close blocked');
    }, CFG.closeRetryMs);
  }

  function activateForSignal(signal, reason = '') {
    const signalKey = buildSignalKey(signal);
    if (!signalKey || shouldIgnoreSignal(signalKey)) return;
    const successRunKey = buildSuccessRunKey(signal);

    if (
      state.countdownEndsAt
      && successRunKey
      && state.activeSuccessRunKey
      && successRunKey === state.activeSuccessRunKey
    ) {
      return;
    }

    if (state.activeSignalKey !== signalKey) {
      state.activeSignal = signal;
      state.activeSignalKey = signalKey;
      state.activeSuccessRunKey = successRunKey;
      state.countdownEndsAt = 0;
      state.mirrored = false;
      state.closeAttempted = false;
      state.closeAttempts = 0;
      log(`Webhook success detected for AZ ${signal.azId}${reason ? ` | ${reason}` : ''}`);
    }

    if (isGwpcHost() && !readyMatchesSignal(signal)) {
      mirrorPayloadFromGwpc(signal);
    }
    if (isAzHost()) {
      bridgePayloadToAzLocal();
    }

    if (readyMatchesSignal(signal)) {
      startCountdown(signal);
    } else {
      setStatus('Waiting for mirrored payload');
    }
  }

  function tick(reason = 'tick') {
    if (state.destroyed) return;
    if (consumeRuntimeCleanupRequest(reason)) {
      renderAll();
      return;
    }
    writeTabHeartbeat();
    closeOwnedApexWakeTabIfReady();
    refreshIgnoreCloseLeaseHeartbeat();
    if (checkLexSnagFailure()) {
      renderAll();
      return;
    }
    checkApexWakeMonitor();
    if (!state.running) {
      setStatus('Stopped');
      renderAll();
      return;
    }

    if (isGwpcHost()) syncMirroredProductPayloadsFromGwpc();
    if (clearStaleMirroredFinalHandoff(reason)) {
      renderAll();
      return;
    }

    const signal = readSuccessSignal();
    const closeSignal = readCloseSignal();
    const mirroredMeta = readMirroredPayloadMeta();
    if (isAzHost()) {
      const bridged = bridgePayloadToAzLocal();
      bridgeProductPayloadsToAzLocal();
      if (mirroredMeta?.azId && (!state.activeSignal || !norm(state.activeSignal.azId))) {
        state.activeSignal = {
          azId: mirroredMeta.azId,
          postedAt: mirroredMeta.savedAt || ''
        };
      }
      if ((bridged || mirroredMeta?.azId) && !signal) {
        setStatus('Mirrored payload available in AZ');
        state.mirrored = true;
      }
    }
    if (signal) {
      activateForSignal(signal, reason);
    }

    if (state.countdownEndsAt) {
      if (Date.now() >= state.countdownEndsAt) {
        publishCloseSignal(state.activeSignal || signal);
        if (closeSignalMatches(state.activeSignal || signal)) {
          if (shouldIgnoreCloseForActiveLease(state.activeSignal || signal)) {
            renderAll();
            return;
          }
          attemptClose(state.activeSignal || signal);
        }
      }
    } else if (!isAzHost() && isFreshCloseSignal(closeSignal) && !state.closeAttempted) {
      if (shouldIgnoreCloseForActiveLease(closeSignal)) {
        renderAll();
        return;
      }
      const signalKey = buildSignalKey(closeSignal);
      if (signalKey && state.activeSignalKey !== signalKey) {
        state.activeSignal = {
          azId: norm(closeSignal.azId || ''),
          postedAt: norm(closeSignal.postedAt || '')
        };
        state.activeSignalKey = signalKey;
        state.closeAttempted = false;
        state.closeAttempts = 0;
      }
      if (isLexHost() && isLexCloseConsumedByOtherTab(closeSignal)) {
        state.closeAttempted = true;
        writeSession(SS_KEYS.closeAttempted, '1');
        markSignalHandled(signalKey);
        setStatus('LEX close already consumed');
        renderAll();
        return;
      }
      log('Shared close signal received');
      attemptClose(closeSignal);
    } else if (!signal && isAzHost() && mirroredMeta?.azId) {
      setStatus('Mirrored payload available in AZ');
    } else if (!signal) {
      if (!getActiveIgnoreCloseLease()) state.lastIgnoreCloseSignalKey = '';
      setStatus(getActiveIgnoreCloseLease() ? 'Ignoring shared close until refresh' : 'Watching for webhook success');
    } else if (closeSignalMatches(state.activeSignal || signal) && !state.closeAttempted) {
      if (shouldIgnoreCloseForActiveLease(state.activeSignal || signal)) {
        renderAll();
        return;
      }
      if (isLexHost() && isLexCloseConsumedByOtherTab(state.activeSignal || signal)) {
        state.closeAttempted = true;
        writeSession(SS_KEYS.closeAttempted, '1');
        markSignalHandled(buildSignalKey(state.activeSignal || signal));
        setStatus('LEX close already consumed');
        renderAll();
        return;
      }
      log('Shared close signal received');
      attemptClose(state.activeSignal || signal);
    }

    checkGwpcSamePageCloseWatchdog();
    renderAll();
  }

  function renderAll() {
    const mirroredMeta = readMirroredPayloadMeta();
    if (state.ui.azId) state.ui.azId.textContent = norm(state.activeSignal?.azId || mirroredMeta?.azId || '-') || '-';
    if (state.ui.mirrored) state.ui.mirrored.textContent = state.mirrored || readyMatchesSignal(state.activeSignal) ? 'Yes' : 'No';

    if (state.ui.countdown) {
      if (state.countdownEndsAt) {
        const remaining = Math.max(0, state.countdownEndsAt - Date.now());
        state.ui.countdown.textContent = `${(remaining / 1000).toFixed(1)}s`;
      } else {
        state.ui.countdown.textContent = '-';
      }
    }

    if (state.ui.toggle) {
      state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
      state.ui.toggle.style.background = state.running ? '#b91c1c' : '#15803d';
    }

    const canDownload = !!readDownloadableMirrorSnapshot();
    if (state.ui.download) {
      state.ui.download.disabled = !canDownload;
      state.ui.download.style.opacity = canDownload ? '1' : '.55';
      state.ui.download.style.cursor = canDownload ? 'pointer' : 'not-allowed';
    }

    if (state.ui.copy) {
      state.ui.copy.disabled = !canDownload;
      state.ui.copy.style.opacity = canDownload ? '1' : '.55';
      state.ui.copy.style.cursor = canDownload ? 'pointer' : 'not-allowed';
    }

    if (state.ui.ignoreClose) {
      const lease = getActiveIgnoreCloseLease();
      const active = !!lease;
      const owned = isIgnoreCloseLeaseOwnedByThisTab(lease);
      state.ui.ignoreClose.textContent = owned
        ? 'IGNORE CLOSE ON'
        : (active ? 'IGNORE CLOSE ACTIVE' : 'IGNORE CLOSE OFF');
      state.ui.ignoreClose.style.background = owned ? '#b45309' : (active ? '#7c2d12' : '#475569');
      state.ui.ignoreClose.style.opacity = active && !owned ? '.92' : '1';
    }

    if (state.ui.apexWake) {
      state.ui.apexWake.textContent = state.apexWakeEnabled ? 'APEX WAKE ON' : 'APEX WAKE OFF';
      state.ui.apexWake.style.background = state.apexWakeEnabled ? '#0f766e' : '#475569';
      state.ui.apexWake.disabled = !isAzHost();
      state.ui.apexWake.style.opacity = isAzHost() ? '1' : '.55';
      state.ui.apexWake.style.cursor = isAzHost() ? 'pointer' : 'not-allowed';
    }

    if (state.ui.apexWakeStatus) {
      state.ui.apexWakeStatus.textContent = state.apexWakeStatus || (isAzHost() ? 'Watching' : 'AZ only');
    }

    renderLogs();
  }

  function renderLogs() {
    if (!state.ui.logs) return;
    state.ui.logs.value = state.logs.join('\n');
    state.ui.logs.scrollTop = 0;
  }

  function buildUi() {
    const panel = document.createElement('div');
    panel.id = 'tm-payload-mirror-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: `${CFG.panelWidth}px`,
      zIndex: String(CFG.zIndex),
      background: 'rgba(15, 23, 42, 0.97)',
      color: '#e5e7eb',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '14px',
      boxShadow: '0 18px 48px rgba(0,0,0,0.38)',
      font: '12px/1.45 Segoe UI, Tahoma, Arial, sans-serif',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div id="tm-payload-mirror-head" style="padding:10px 12px;background:linear-gradient(90deg,#111827,#1f2937);display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move;">
        <div>
          <div style="font-weight:800;">${SCRIPT_NAME}</div>
          <div style="font-size:11px;opacity:.72;">Webhook mirror + non-AZ tab closer</div>
        </div>
        <div style="font-size:11px;opacity:.72;">v${VERSION}</div>
      </div>
      <div style="padding:12px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button id="tm-payload-mirror-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#15803d;color:#fff;font-weight:800;cursor:pointer;">START</button>
          <button id="tm-payload-mirror-download" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#1d4ed8;color:#fff;font-weight:800;cursor:pointer;">DOWNLOAD MIRROR</button>
          <button id="tm-payload-mirror-copy" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;">COPY MIRROR + LOGS</button>
          <button id="tm-payload-mirror-ignore-close" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">IGNORE CLOSE OFF</button>
          <button id="tm-payload-mirror-apex-wake" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">APEX WAKE ON</button>
        </div>
        <div id="tm-payload-mirror-status" style="font-weight:800;color:#86efac;margin-bottom:10px;">Watching for webhook success</div>
        <div style="display:grid;grid-template-columns:110px 1fr;gap:6px 8px;margin-bottom:10px;">
          <div style="opacity:.72;">AZ ID</div><div id="tm-payload-mirror-azid">-</div>
          <div style="opacity:.72;">Payload mirrored</div><div id="tm-payload-mirror-mirrored">No</div>
          <div style="opacity:.72;">Close countdown</div><div id="tm-payload-mirror-countdown">-</div>
          <div style="opacity:.72;">APEX wake</div><div id="tm-payload-mirror-apex-wake-status">Watching</div>
        </div>
        <textarea id="tm-payload-mirror-logs" readonly style="width:100%;min-height:140px;max-height:190px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:12px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('#tm-payload-mirror-head');
    state.ui.toggle = panel.querySelector('#tm-payload-mirror-toggle');
    state.ui.download = panel.querySelector('#tm-payload-mirror-download');
    state.ui.copy = panel.querySelector('#tm-payload-mirror-copy');
    state.ui.ignoreClose = panel.querySelector('#tm-payload-mirror-ignore-close');
    state.ui.apexWake = panel.querySelector('#tm-payload-mirror-apex-wake');
    state.ui.status = panel.querySelector('#tm-payload-mirror-status');
    state.ui.azId = panel.querySelector('#tm-payload-mirror-azid');
    state.ui.mirrored = panel.querySelector('#tm-payload-mirror-mirrored');
    state.ui.countdown = panel.querySelector('#tm-payload-mirror-countdown');
    state.ui.apexWakeStatus = panel.querySelector('#tm-payload-mirror-apex-wake-status');
    state.ui.logs = panel.querySelector('#tm-payload-mirror-logs');

    makeDraggable(panel, state.ui.head);
  }

  function bindUi() {
    state.ui.toggle?.addEventListener('click', () => {
      state.running = !state.running;
      saveRunning(state.running);
      if (!state.running) {
        state.countdownEndsAt = 0;
        setStatus('Stopped');
        log('Monitoring stopped');
      } else {
        setStatus('Watching for webhook success');
        log('Monitoring started');
        tick('manual-start');
      }
      renderAll();
    });

    state.ui.download?.addEventListener('click', () => {
      downloadMirrorSnapshot();
      renderAll();
    });

    state.ui.copy?.addEventListener('click', async () => {
      await copyMirrorSnapshotWithLogs();
      renderAll();
    });

    state.ui.ignoreClose?.addEventListener('click', () => {
      const lease = getActiveIgnoreCloseLease();
      const owned = isIgnoreCloseLeaseOwnedByThisTab(lease);
      setIgnoreCloseEnabledForThisPage(!owned);
      tick('manual-ignore-close');
    });

    state.ui.apexWake?.addEventListener('click', () => {
      if (!isAzHost()) {
        log('APEX wake toggle is only active on AgencyZoom');
        return;
      }
      state.apexWakeEnabled = !state.apexWakeEnabled;
      saveApexWakeEnabled(state.apexWakeEnabled);
      if (!state.apexWakeEnabled) {
        state.apexWakeStatus = 'Off';
        log('APEX wake monitor OFF');
      } else {
        state.apexWakeMonitorStartedAt = Date.now();
        state.apexWakeStatus = 'Watching';
        log('APEX wake monitor ON');
        checkApexWakeMonitor();
      }
      renderAll();
    });
  }

  function persistPanelPos() {
    if (!state.panel) return;
    try {
      localStorage.setItem(LS_KEYS.panelPos, JSON.stringify({
        left: state.panel.style.left || '',
        top: state.panel.style.top || '',
        right: state.panel.style.right || '',
        bottom: state.panel.style.bottom || ''
      }));
    } catch {}
  }

  function restorePanelPos() {
    try {
      const saved = readJson(localStorage.getItem(LS_KEYS.panelPos), null);
      if (!isPlainObject(saved) || !state.panel) return;
      if (saved.left) state.panel.style.left = saved.left;
      if (saved.top) state.panel.style.top = saved.top;
      if (saved.right) state.panel.style.right = saved.right;
      if (saved.bottom) state.panel.style.bottom = saved.bottom;
      keepPanelInView();
    } catch {}
  }

  function keepPanelInView() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    const margin = 8;

    if (rect.right > window.innerWidth - margin) left -= (rect.right - (window.innerWidth - margin));
    if (rect.bottom > window.innerHeight - margin) top -= (rect.bottom - (window.innerHeight - margin));
    if (left < margin) left = margin;
    if (top < margin) top = margin;

    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    persistPanelPos();
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;
    let drag = null;

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      drag = {
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top
      };
      event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
      if (!drag) return;
      panel.style.left = `${Math.max(8, event.clientX - drag.dx)}px`;
      panel.style.top = `${Math.max(8, event.clientY - drag.dy)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }, true);

    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      keepPanelInView();
    }, true);
  }
})();
