// ==UserScript==
// @name         AgencyZoom Ticket Finisher + Tagger
// @namespace    homebot.az-ticket-finisher-tagger
// @version      1.0.61
// @description  Reads the mirrored Alta final payload in AgencyZoom, clicks Main, fills ticket fields, clicks Update, adds a pinned note, applies the correct tag, and marks the ticket complete.
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @run-at       document-end
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-ticket-finisher-tagger/az-ticket-finisher-tagger.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-ticket-finisher-tagger/az-ticket-finisher-tagger.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_TICKET_FINISHER_TAGGER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'AgencyZoom Ticket Finisher + Tagger';
  const VERSION = '1.0.61';
  const UI_ATTR = 'data-tm-az-finisher-ui';
  const CLEANUP_REQUEST_KEY = 'tm_az_workflow_cleanup_request_v1';
  const FINISHER_CLOSE_SIGNAL_KEY = 'tm_az_finisher_ticket_closed_signal_v1';
  // Persist state.logs to a tracked key so storage-tools.user.js can export
  // every script's logs in one click, and listen for a cross-origin clear
  // signal so CLEAR LOGS empties every running script's buffer at once.
  const LOG_PERSIST_KEY = 'tm_az_ticket_finisher_tagger_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  const SCRIPT_ACTIVITY_KEY = 'tm_ui_script_activity_v1';
  const SCRIPT_ID = 'az-ticket-finisher-tagger';
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';

  const GM_KEYS = {
    finalPayload: 'tm_az_alta_final_payload_v1',
    finalReady: 'tm_az_alta_final_payload_ready_v1',
    homePayload: 'tm_alta_home_quote_grab_payload_v1',
    autoPayload: 'tm_alta_auto_quote_grab_payload_v1',
    webhookBundle: 'tm_alta_webhook_bundle_v1',
    azCurrentJob: 'tm_az_current_job_v1',
    currentJob: 'tm_alta_current_job_v1',
    sharedJob: 'tm_shared_az_job_v1',
    missingPayloadTrigger: 'tm_az_missing_payload_fallback_trigger_v1',
    fieldTargets: 'tm_az_ticket_finisher_field_targets_v1',
    tagTargets: 'tm_az_ticket_finisher_tag_targets_v1',
    runs: 'tm_az_ticket_finisher_runs_v1',
    webhookSubmitSentMeta: 'tm_alta_webhook_submit_sent_meta_v17',
    webhookSubmitStopped: 'tm_alta_webhook_submit_stopped_v17',
    webhookSuccess: 'tm_alta_webhook_post_success_v1',
    finisherWake: 'tm_az_ticket_finisher_wake_v1',
    flowStage: 'tm_alta_flow_stage_v1',
    closeSignal: 'tm_alta_payload_mirror_close_signal_v1',
    lexCloseConsumed: 'tm_alta_payload_mirror_lex_close_consumed_signal_v1',
    ignoreCloseLease: 'tm_alta_payload_mirror_ignore_close_lease_v1',
    lastHandledSignal: 'tm_alta_payload_mirror_last_handled_signal_v1',
    closeAttempted: 'tm_alta_payload_mirror_close_attempted_v1',
    runtimeCleanupRequest: 'tm_alta_runtime_cleanup_request_v1',
    webhookFatalHold: 'tm_alta_webhook_fatal_error_hold_v1',
    timeoutRuntime: 'tm_alta_header_timeout_runtime_v2',
    timeoutSentEvents: 'tm_alta_header_timeout_sent_events_v2',
    timeoutRetryState: 'tm_alta_header_timeout_retry_state_v1',
    timeoutRetryRequest: 'tm_alta_header_timeout_retry_request_v1',
    timeoutRetryRequestedContext: 'tm_alta_header_timeout_retry_requested_context_v1',
    timeoutPendingPost: 'tm_alta_header_timeout_pending_post_v2',
    timeoutWatchPending: 'tm_alta_header_timeout_watch_pending_v1'
  };

  const SHARED_RUNTIME_CLEANUP_KEYS = [
    GM_KEYS.finalPayload,
    GM_KEYS.finalReady,
    GM_KEYS.homePayload,
    GM_KEYS.autoPayload,
    GM_KEYS.webhookBundle,
    GM_KEYS.currentJob,
    GM_KEYS.azCurrentJob,
    GM_KEYS.sharedJob,
    GM_KEYS.missingPayloadTrigger,
    GM_KEYS.runs,
    GM_KEYS.webhookSubmitSentMeta,
    GM_KEYS.webhookSubmitStopped,
    GM_KEYS.webhookSuccess,
    GM_KEYS.finisherWake,
    GM_KEYS.flowStage,
    GM_KEYS.closeSignal,
    GM_KEYS.lexCloseConsumed,
    GM_KEYS.ignoreCloseLease,
    GM_KEYS.lastHandledSignal,
    GM_KEYS.closeAttempted,
    GM_KEYS.runtimeCleanupRequest,
    GM_KEYS.webhookFatalHold,
    GM_KEYS.timeoutRuntime,
    GM_KEYS.timeoutSentEvents,
    GM_KEYS.timeoutRetryState,
    GM_KEYS.timeoutRetryRequest,
    GM_KEYS.timeoutRetryRequestedContext,
    GM_KEYS.timeoutPendingPost,
    GM_KEYS.timeoutWatchPending,
    'tm_payload_mirror_tab_heartbeats_v1',
    'tm_payload_mirror_apex_wake_state_v1'
  ];

  const LS_KEYS = {
    running: 'tm_az_ticket_finisher_running_v1',
    panelPos: 'tm_az_ticket_finisher_panel_pos_v1'
  };

  const DECLINE_REASON_FIELD = 'Decline Reason';

  const FIELD_ORDER = [
    'CFP?',
    'Reconstruction Cost',
    'Year Built',
    'Home Sqft',
    '# of Story',
    'Home Roof Type',
    'Bedrooms',
    'Bathrooms',
    'Home Type',
    'Water Device?',
    'Standard Pricing No Auto Discount',
    'Enhance Pricing No Auto Discount',
    'Standard Pricing Auto Discount',
    'Enhance Pricing Auto Discount',
    'Home Submission Number',
    'Account Number',
    DECLINE_REASON_FIELD
  ];

  const TAG_ORDER = [
    { key: 'successfulTag', label: 'Success tag' },
    { key: 'failedTag', label: 'Failed tag' }
  ];

  const NUMERIC_ONLY_FIELDS = new Set([
    'Reconstruction Cost',
    'Year Built',
    'Home Sqft',
    '# of Story',
    'Standard Pricing No Auto Discount',
    'Enhance Pricing No Auto Discount',
    'Standard Pricing Auto Discount',
    'Enhance Pricing Auto Discount'
  ]);

  const SEL = {
    dockRoot: '.az-dock, #serviceDetailDock, #notePanelContainer, .az-dock__top',
    dockTop: '.az-dock__top',
    topName: 'h3.currentCustomerName',
    topTags: '.az-dock__display-tags .az-def-badge, .az-dock__display-tags .az-def-badge.tag',
    vendorSync: '.origin-vendor-sync, [class*="vendor-sync"], [class*="origin-vendor"]',
    mainTab: 'a[href="#tabDetail"][data-toggle="tab"]',
    mainPane: '#tabDetail',
    detailForm: '#detailDockform',
    updateButton: 'button.btn.btn-primary.action[onclick*="leadDetailTab.doSave"], button.action[onclick*="doSave"]',
    noteOpener: 'a.btn-note.az-tooltip.tooltipstered, a.btn-note',
    noteEditor: 'div.ql-editor[contenteditable="true"], div[data-placeholder="Add note here"][contenteditable="true"], .ql-editor',
    pinTop: 'a.pin-top[data-value="0"], a.pin-top, a.d-flex.align-items-center.pin-top',
    saveNote: 'button#add-note, button.btn-primary#add-note',
    tagOpener: 'a.btn-tag.az-tooltip.tooltipstered, a.btn-tag',
    tagForm: '#add-tag-form',
    tagDropdown: '#add-tag-form > div > div > div.az-form-group.az-tags-select.mb-2 > div > button, button.btn.dropdown-toggle.btn-light[data-toggle="dropdown"][role="combobox"], button.dropdown-toggle.btn-light[role="combobox"], button.dropdown-toggle[role="combobox"]',
    dockClose: '#serviceDetailDock .az-dock__close, #notePanelContainer .az-dock__close, .az-dock__close'
  };

  const CFG = {
    tickMs: 800,
    stepPollMs: 150,
    mainReadyMs: 10000,
    bigActionDelayMs: 500,
    actionSettleMs: 900,
    noteSettleMs: 1200,
    updateSettleMs: 1200,
    closeWaitMs: 5000,
    closeRetryMs: 700,
    closeAttempts: 4,
    stalePayloadSlackMs: 1500,
    payloadMismatchFailMs: 20 * 1000,
    minTicketOpenBeforeCloseMs: 5000,
    minMainClickBeforeCloseMs: 5000,
    launcherDataMissingFailMs: 20 * 1000,
    maxLogLines: 90,
    zIndex: 2147483647,
    panelWidth: 360,
    observerThrottleMs: 60
  };

  const state = {
    destroyed: false,
    running: loadRunning(),
    busy: false,
    forceRunRequested: false,
    logs: [],
    panel: null,
    ui: {},
    tickTimer: null,
    logsIntervalTimer: null,
    picker: null,
    hoverBox: null,
    hoveredEl: null,
    pickerMove: null,
    pickerPrimerClick: null,
    pickerClick: null,
    pickerKeydown: null,
    activeAzId: '',
    lastPayloadSeenKey: '',
    lastPayloadSourceSignature: '',
    lastStatus: '',
    waitingTicketMismatchKey: '',
    waitingTicketMismatchSince: 0,
    waitingTicketMismatchTriggeredKey: '',
    launcherDataMissingKey: '',
    launcherDataMissingSince: 0,
    launcherDataMissingTriggeredKey: '',
    rejectedFinalPayloadKey: '',
    rejectedFinalPayloadSince: 0,
    rejectedFinalPayloadReason: '',
    rejectedFinalPayloadTriggeredKey: '',
    lastFinalPayloadRejectLogKey: '',
    lastMissingPayloadTriggerLogKey: '',
    lastOpenTicketFallbackKey: '',
    lastRuntimeWakeKey: '',
    openTicketId: '',
    openTicketOpenedAt: 0,
    lastMainClickedTicketId: '',
    lastMainClickedAt: 0,
    frontSession: 1,
    wasFrontActive: isFrontActive(),
    completedFrontRunKeys: new Set(),
    activityState: 'idle',
    activityMessage: 'Waiting for mirrored payload'
  };

  init();

  function init() {
    buildUi();
    bindUi();
    restorePanelPos();
    ensureHoverBox();
    renderAll();

    log(`Loaded v${VERSION}`);
    setStatus(state.running ? 'Waiting for mirrored payload' : 'Stopped');
    writeActivityState(state.running ? 'waiting' : 'stopped', state.running ? 'Waiting for mirrored payload' : 'Stopped');

    state.tickTimer = setInterval(() => tick(), CFG.tickMs);
    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('beforeunload', persistPanelPos, true);
    window.addEventListener('pagehide', persistPanelPos, true);
    window.addEventListener('resize', keepPanelInView, true);
    document.addEventListener('visibilitychange', onFrontStateChange, true);
    window.addEventListener('focus', onFrontStateChange, true);
    window.addEventListener('blur', onFrontStateChange, true);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    window.addEventListener('storage', handleRuntimeWakeStorageEvent, true);
    window.addEventListener('tm-az-finisher-wake', handleRuntimeWakeEvent, true);
    document.addEventListener('tm-az-finisher-wake', handleRuntimeWakeEvent, true);
    persistLogsThrottled();

    tick();
    window.__AZ_TICKET_FINISHER_TAGGER_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { writeActivityState('stopped', 'Cleanup'); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { window.removeEventListener('beforeunload', persistPanelPos, true); } catch {}
    try { window.removeEventListener('pagehide', persistPanelPos, true); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { document.removeEventListener('visibilitychange', onFrontStateChange, true); } catch {}
    try { window.removeEventListener('focus', onFrontStateChange, true); } catch {}
    try { window.removeEventListener('blur', onFrontStateChange, true); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    try { window.removeEventListener('storage', handleRuntimeWakeStorageEvent, true); } catch {}
    try { window.removeEventListener('tm-az-finisher-wake', handleRuntimeWakeEvent, true); } catch {}
    try { document.removeEventListener('tm-az-finisher-wake', handleRuntimeWakeEvent, true); } catch {}
    stopPicker('', false);
    try { state.hoverBox?.remove(); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__AZ_TICKET_FINISHER_TAGGER_CLEANUP__; } catch {}
  }

  function loadRunning() {
    // Always re-arm after refresh. Stop is only for the current page session.
    try { localStorage.removeItem(LS_KEYS.running); } catch {}
    return true;
  }

  function saveRunning(on) {
    try {
      if (on) localStorage.removeItem(LS_KEYS.running);
      else localStorage.setItem(LS_KEYS.running, '0');
    } catch {}
  }

  function readJson(raw, fallback = null) {
    try {
      if (raw == null || raw === '') return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  }

  function writeGM(key, value) {
    try { GM_setValue(key, value); } catch {}
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function readGM(key, fallback = null) {
    let localValue = fallback;
    try {
      const local = readJson(localStorage.getItem(key), fallback);
      localValue = local == null ? fallback : local;
    } catch {}

    try {
      const gmValue = GM_getValue(key, undefined);
      const parsed = readJson(gmValue, gmValue);
      return parsed == null ? localValue : parsed;
    } catch {
      return localValue;
    }
  }

  function readLocalOnly(key, fallback = null) {
    try {
      const value = readJson(localStorage.getItem(key), fallback);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function readGmOnly(key, fallback = null) {
    try {
      const value = readJson(GM_getValue(key, undefined), fallback);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function clearMissingPayloadTrigger(ticketId = '') {
    const wantedId = norm(ticketId || '');
    const current = readMissingPayloadTrigger();
    const currentId = norm(current?.ticketId || current?.azId || '');
    if (wantedId && currentId && currentId !== wantedId) return;
    try { localStorage.removeItem(GM_KEYS.missingPayloadTrigger); } catch {}
    try { GM_setValue(GM_KEYS.missingPayloadTrigger, null); } catch {}
  }

  function chooseNewerSignal(localSignal, gmSignal) {
    const localOk = isPlainObject(localSignal) && norm(localSignal.ticketId || localSignal.azId || '');
    const gmOk = isPlainObject(gmSignal) && norm(gmSignal.ticketId || gmSignal.azId || '');
    if (localOk && !gmOk) return localSignal;
    if (!localOk && gmOk) return gmSignal;
    if (!localOk && !gmOk) return null;

    const localMs = Date.parse(norm(localSignal.requestedAt || ''));
    const gmMs = Date.parse(norm(gmSignal.requestedAt || ''));
    if (Number.isFinite(localMs) && Number.isFinite(gmMs) && localMs !== gmMs) {
      return localMs > gmMs ? localSignal : gmSignal;
    }
    return localSignal;
  }

  function readMissingPayloadTrigger() {
    const local = readLocalOnly(GM_KEYS.missingPayloadTrigger, null);
    const gm = readGmOnly(GM_KEYS.missingPayloadTrigger, null);
    return chooseNewerSignal(local, gm);
  }

  function buildMissingPayloadTriggerKey(signal) {
    return `${norm(signal?.ticketId || signal?.azId || '')}|${norm(signal?.requestedAt || '')}`;
  }

  function getActiveMissingPayloadTrigger(openTicketId = '') {
    const signal = readMissingPayloadTrigger();
    if (!isPlainObject(signal) || signal.ready !== true) {
      state.lastMissingPayloadTriggerLogKey = '';
      return null;
    }

    const ticketId = norm(signal.ticketId || signal.azId || '');
    if (!ticketId) {
      clearMissingPayloadTrigger();
      state.lastMissingPayloadTriggerLogKey = '';
      return null;
    }

    const requestedMs = Date.parse(norm(signal.requestedAt || ''));
    if (Number.isFinite(requestedMs) && (Date.now() - requestedMs) > (10 * 60 * 1000)) {
      clearMissingPayloadTrigger(ticketId);
      state.lastMissingPayloadTriggerLogKey = '';
      return null;
    }

    const openId = norm(openTicketId || '');
    if (openId && openId !== ticketId) return null;

    return {
      ...signal,
      ticketId,
      triggerKey: buildMissingPayloadTriggerKey(signal)
    };
  }

  function requestWorkflowCleanup(azId) {
    const cleanAzId = norm(azId || '');
    if (!cleanAzId) return;
    writeGM(CLEANUP_REQUEST_KEY, {
      ready: true,
      azId: cleanAzId,
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    });
    log(`Requested workflow cleanup for AZ ${cleanAzId}`);
  }

  function sendTicketClosedSignal(azId) {
    const cleanAzId = norm(azId || '');
    if (!cleanAzId) return;
    writeGM(FINISHER_CLOSE_SIGNAL_KEY, {
      ready: true,
      azId: cleanAzId,
      ticketId: cleanAzId,
      closedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    });
    log(`Sent launcher close trigger for AZ ${cleanAzId}`);
  }

  // Clear the mirrored final payload handoff so the next ticket starts clean.
  // If left in place, ticket N+1 can read the ready flag from ticket N before
  // the mirror rewrites it, and race into fallback/wrong-tag territory.
  function clearFinalPayloadHandoff(azId) {
    const cleanAzId = norm(azId || '');
    try { GM_setValue(GM_KEYS.finalPayload, null); } catch {}
    try { GM_setValue(GM_KEYS.finalReady, null); } catch {}
    try { localStorage.removeItem(GM_KEYS.finalPayload); } catch {}
    try { localStorage.removeItem(GM_KEYS.finalReady); } catch {}
    log(`Cleared mirrored final payload handoff${cleanAzId ? ` | ${cleanAzId}` : ''}`);
  }

  function clearSharedRuntimeKey(key) {
    if (!key) return;
    try { localStorage.removeItem(key); } catch {}
    try { GM_setValue(key, null); } catch {}
  }

  function publishRuntimeCleanupRequest(azId, reason = '') {
    const cleanAzId = norm(azId || '');
    if (!cleanAzId) return null;

    const request = {
      azId: cleanAzId,
      requestedAt: nowIso(),
      nonce: `cleanup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: SCRIPT_NAME,
      version: VERSION,
      reason: norm(reason || 'finisher cleanup') || 'finisher cleanup'
    };

    writeGM(GM_KEYS.runtimeCleanupRequest, request);
    log(`Published Alta runtime cleanup request | AZ ${cleanAzId} | ${request.reason}`);
    return request;
  }

  function resetLocalRuntimeCleanupState() {
    state.lastPayloadSeenKey = '';
    state.lastPayloadSourceSignature = '';
    state.lastFinalPayloadRejectLogKey = '';
    state.lastMissingPayloadTriggerLogKey = '';
    state.lastOpenTicketFallbackKey = '';
    state.lastRuntimeWakeKey = '';
    clearRejectedFinalPayloadState();
    resetWaitingTicketMismatch();
    resetLauncherDataMissing();
  }

  function clearSharedRuntimeForAz(azId, options = {}) {
    const cleanAzId = norm(azId || '');
    if (!cleanAzId) return 0;

    const reason = norm(options?.reason || '') || 'finisher cleanup';
    const publishAltaRequest = options?.publishAltaRequest !== false;
    let cleared = 0;

    for (const key of SHARED_RUNTIME_CLEANUP_KEYS) {
      clearSharedRuntimeKey(key);
      cleared += 1;
    }

    resetLocalRuntimeCleanupState();
    if (publishAltaRequest) publishRuntimeCleanupRequest(cleanAzId, reason);
    log(`Cleared shared runtime state | AZ ${cleanAzId} | ${cleared} keys`);
    return cleared;
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return value; }
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

  function norm(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return norm(value).toLowerCase();
  }

  function cleanTagText(value) {
    return String(value == null ? '' : value)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\sâœ“âœ”]+/g, '')
      .trim();
  }

  function lowerTagText(value) {
    return cleanTagText(value).toLowerCase();
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
    try { renderAll(); } catch {}
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
    state.lastStatus = text;
    if (state.ui.status) state.ui.status.textContent = text;
    writeActivityState(deriveActivityStateFromStatus(text), text);
  }

  function readScriptActivityMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SCRIPT_ACTIVITY_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeScriptActivityMap(nextMap) {
    try { localStorage.setItem(SCRIPT_ACTIVITY_KEY, JSON.stringify(nextMap, null, 2)); } catch {}
  }

  function deriveActivityStateFromStatus(text) {
    const status = norm(text).toLowerCase();
    if (!state.running && !state.busy) return 'stopped';
    if (status.includes('paused')) return 'paused';
    if (status.includes('running') || status.includes('closing') || status.includes('force running') || status.includes('picker:')) return 'working';
    if (status.includes('failed')) return 'error';
    if (status.includes('completed')) return 'done';
    if (status.includes('stopped')) return 'stopped';
    if (status.includes('waiting') || status.includes('required') || status.includes('missing')) return 'waiting';
    return state.busy ? 'working' : 'idle';
  }

  function writeActivityState(nextState, message = '') {
    state.activityState = norm(nextState).toLowerCase() || 'idle';
    state.activityMessage = norm(message || state.lastStatus || state.activityMessage || '') || '';

    const current = readScriptActivityMap();
    current[SCRIPT_ID] = {
      scriptId: SCRIPT_ID,
      scriptName: SCRIPT_NAME,
      state: state.activityState,
      message: state.activityMessage,
      azId: norm(state.activeAzId || ''),
      updatedAt: new Date().toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeScriptActivityMap(current);
  }

  function isFrontActive() {
    try {
      return document.visibilityState === 'visible' && document.hasFocus();
    } catch {
      return document.visibilityState !== 'hidden';
    }
  }

  function getFrontRunKey(ticketId = '') {
    const cleanTicketId = norm(ticketId || '');
    if (!cleanTicketId) return '';
    return `${state.frontSession}|${cleanTicketId}`;
  }

  function hasCompletedFrontRun(ticketId = '') {
    const key = getFrontRunKey(ticketId);
    return !!(key && state.completedFrontRunKeys.has(key));
  }

  function markFrontRunCompleted(ticketId = '') {
    const key = getFrontRunKey(ticketId);
    if (!key) return;
    state.completedFrontRunKeys.add(key);
  }

  function syncFrontSession() {
    const frontActive = isFrontActive();
    if (frontActive && !state.wasFrontActive) {
      state.frontSession += 1;
      state.completedFrontRunKeys.clear();
      state.lastPayloadSeenKey = '';
      resetWaitingTicketMismatch();
      log(`AgencyZoom returned to front; finisher re-armed for session ${state.frontSession}`);
    }
    state.wasFrontActive = frontActive;
    return frontActive;
  }

  function onFrontStateChange() {
    const frontActive = syncFrontSession();
    renderAll();
    if (!frontActive || state.destroyed || !state.running || state.busy || state.picker) return;
    setTimeout(() => {
      if (!state.destroyed) tick();
    }, 0);
  }

  function getRuntimeWakeKey(signal, reason = '') {
    const azId = norm(signal?.azId || signal?.ticketId || '');
    const marker = norm(
      signal?.signalKey ||
      signal?.payloadKey ||
      signal?.savedAt ||
      signal?.postedAt ||
      signal?.bridgedAt ||
      signal?.wokeAt ||
      ''
    );
    if (!azId && !marker) return norm(reason || '');
    return `${azId}|${marker || reason}`;
  }

  function scheduleRuntimeWake(reason = '', signal = null) {
    if (state.destroyed) return;
    const cleanReason = norm(reason || 'runtime wake') || 'runtime wake';
    const cleanSignal = isPlainObject(signal) ? signal : {};
    const wakeKey = `${cleanReason}|${getRuntimeWakeKey(cleanSignal, cleanReason)}`;
    const azId = norm(cleanSignal.azId || cleanSignal.ticketId || '');

    if (wakeKey && state.lastRuntimeWakeKey !== wakeKey) {
      state.lastRuntimeWakeKey = wakeKey;
      log(`Finisher wake received${azId ? ` | AZ ${azId}` : ''} | ${cleanReason}`);
    }

    if (!state.running) {
      state.running = true;
      saveRunning(true);
      setStatus('Resuming for mirrored payload');
    }

    window.setTimeout(() => {
      if (!state.destroyed && !state.busy && !state.picker) tick();
    }, 0);
  }

  function handleRuntimeWakeEvent(event) {
    scheduleRuntimeWake('same-page handoff', event?.detail || null);
  }

  function handleRuntimeWakeStorageEvent(event) {
    if (event?.storageArea !== localStorage) return;
    if (event.newValue == null || event.newValue === '') return;
    if (![
      GM_KEYS.finisherWake,
      GM_KEYS.finalReady,
      GM_KEYS.finalPayload,
      GM_KEYS.homePayload,
      GM_KEYS.missingPayloadTrigger
    ].includes(event.key)) return;
    const signal = readJson(event.newValue, null);
    scheduleRuntimeWake(`storage:${event.key}`, signal);
  }

  function resetWaitingTicketMismatch() {
    state.waitingTicketMismatchKey = '';
    state.waitingTicketMismatchSince = 0;
    state.waitingTicketMismatchTriggeredKey = '';
  }

  function resetLauncherDataMissing() {
    state.launcherDataMissingKey = '';
    state.launcherDataMissingSince = 0;
    state.launcherDataMissingTriggeredKey = '';
  }

  function updateOpenTicketTracking(openTicket) {
    const openId = norm(openTicket?.ticketId || '');
    if (!openId) {
      state.openTicketId = '';
      state.openTicketOpenedAt = 0;
      resetLauncherDataMissing();
      return;
    }

    if (state.openTicketId !== openId) {
      state.openTicketId = openId;
      state.openTicketOpenedAt = Date.now();
      resetWaitingTicketMismatch();
      resetLauncherDataMissing();
      log(`Open ticket tracked | ${openId}`);
    }
  }

  function getWaitingTicketMismatchState(openTicketId, targetTicketId) {
    const openId = norm(openTicketId || '');
    const targetId = norm(targetTicketId || '');

    // Not-active cases:
    //   - No open ticket in AZ â†’ nothing to wait on
    //   - No final payload yet â†’ wait for Home/webhook or explicit launcher failure
    //   - Open ticket matches the payload's AZ ID â†’ payload is ready, run normally
    if (!openId || !targetId || openId === targetId) {
      resetWaitingTicketMismatch();
      return { active: false, ready: false };
    }

    if (!isFrontActive()) {
      resetWaitingTicketMismatch();
      return { active: false, ready: false };
    }

    const key = `${openId}|${targetId}`;
    const now = Date.now();
    if (state.waitingTicketMismatchKey !== key) {
      state.waitingTicketMismatchKey = key;
      state.waitingTicketMismatchSince = now;
      state.waitingTicketMismatchTriggeredKey = '';
      log(`Open ticket ${openId} is waiting for final Home payload for this ticket; current mirrored payload is for ${targetId}`);
    }

    const elapsedMs = Math.max(0, now - state.waitingTicketMismatchSince);
    const ready = elapsedMs >= CFG.payloadMismatchFailMs;
    if (ready && state.waitingTicketMismatchTriggeredKey !== key) {
      state.waitingTicketMismatchTriggeredKey = key;
      log(`Payload mismatch held for ${Math.round(elapsedMs / 1000)}s; running failed path for open ticket ${openId} instead of mirrored ticket ${targetId}`);
    }

    return {
      active: true,
      ready,
      key,
      openTicketId: openId,
      targetTicketId: targetId,
      elapsedMs,
      remainingMs: Math.max(0, CFG.payloadMismatchFailMs - elapsedMs)
    };
  }

  function getRejectedFinalPayloadState(openTicketId) {
    const openId = norm(openTicketId || '');
    if (!openId || !state.rejectedFinalPayloadKey.startsWith(`${openId}|`)) {
      return { active: false, ready: false };
    }

    const since = Number(state.rejectedFinalPayloadSince || 0);
    if (!since) return { active: false, ready: false };

    const elapsedMs = Math.max(0, Date.now() - since);
    const ready = elapsedMs >= CFG.payloadMismatchFailMs;
    if (ready && state.rejectedFinalPayloadTriggeredKey !== state.rejectedFinalPayloadKey) {
      state.rejectedFinalPayloadTriggeredKey = state.rejectedFinalPayloadKey;
      log(`Rejected final payload held for ${Math.round(elapsedMs / 1000)}s; running failed path for open ticket ${openId} | ${state.rejectedFinalPayloadReason}`);
    }

    return {
      active: true,
      ready,
      openTicketId: openId,
      reason: state.rejectedFinalPayloadReason,
      elapsedMs,
      remainingMs: Math.max(0, CFG.payloadMismatchFailMs - elapsedMs)
    };
  }

  function getLauncherDataMissingState(openTicketId) {
    const openId = norm(openTicketId || '');
    if (!openId || !isFrontActive()) {
      resetLauncherDataMissing();
      return { active: false, ready: false };
    }

    const currentJob = getBestCurrentJobForAz(openId);
    if (currentJob) {
      resetLauncherDataMissing();
      return { active: false, ready: false };
    }

    const key = `launcher-missing|${openId}`;
    const now = Date.now();
    if (state.launcherDataMissingKey !== key) {
      state.launcherDataMissingKey = key;
      state.launcherDataMissingSince = now;
      state.launcherDataMissingTriggeredKey = '';
      log(`Launcher data missing for open ticket ${openId}; waiting before failed path`);
    }

    const elapsedMs = Math.max(0, now - state.launcherDataMissingSince);
    const ready = elapsedMs >= CFG.launcherDataMissingFailMs;
    if (ready && state.launcherDataMissingTriggeredKey !== key) {
      state.launcherDataMissingTriggeredKey = key;
      log(`Launcher data missing for ${Math.round(elapsedMs / 1000)}s; running failed path for open ticket ${openId}`);
    }

    return {
      active: true,
      ready,
      openTicketId: openId,
      elapsedMs,
      remainingMs: Math.max(0, CFG.launcherDataMissingFailMs - elapsedMs)
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function pickFirst(...values) {
    for (const value of values) {
      const text = norm(value);
      if (text) return text;
    }
    return '';
  }

  function cleanNumericValue(value, { integerOnly = false } = {}) {
    const raw = norm(value);
    if (!raw) return '';
    let cleaned = raw.replace(/[^0-9.\-]/g, '');
    const minus = cleaned.startsWith('-') ? '-' : '';
    cleaned = minus + cleaned.replace(/-/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot >= 0) {
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    }
    if (integerOnly) {
      cleaned = cleaned.split('.')[0];
    } else if (cleaned.includes('.')) {
      cleaned = cleaned.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.$/, '');
    }
    return cleaned;
  }

  function formatFieldValue(label, value) {
    const text = norm(value);
    if (!text) return '';
    if (!NUMERIC_ONLY_FIELDS.has(label)) return text;
    const integerOnly = label === 'Year Built' || label === 'Home Sqft' || label === '# of Story' || label === 'Reconstruction Cost';
    return cleanNumericValue(text, { integerOnly }) || text;
  }

  function getNormalizedWorkflowFields(fields) {
    const normalized = {};
    for (const label of FIELD_ORDER) {
      const value = formatFieldValue(label, fields?.[label] || '');
      if (value) normalized[label] = value;
    }
    return normalized;
  }

  function normalizeYes(value) {
    const text = lower(value);
    return text === 'yes' || text === 'true' || text === 'completed' || text === 'done' || text === 'y';
  }

  function getEventFailureReason(event) {
    if (!isPlainObject(event)) return '';
    return pickFirst(
      event.resultValue,
      event.errorText,
      event.errorMessage,
      event.errorName,
      event.sentError,
      event.label,
      event.reason
    );
  }

  function getBundleFailureReason(payload) {
    const timeout = payload?.bundle?.timeout;
    const homeData = payload?.bundle?.home?.data;
    const events = Array.isArray(timeout?.events) ? timeout.events : [];
    const newestEvent = events.slice().reverse().find((event) => norm(getEventFailureReason(event)));

    return pickFirst(
      getEventFailureReason(timeout?.lastEvent),
      getEventFailureReason(newestEvent),
      homeData?.errorText,
      homeData?.errorMessage,
      homeData?.errorName,
      homeData?.resultValue,
      homeData?.result
    );
  }

  function normalizeDeclineReason(value) {
    const text = norm(value);
    if (!text || normalizeYes(text)) return '';
    return text;
  }

  function getDeclineReasonForWorkflow({ payload, homeRaw, home, homeRow, doneValue, forceFailedTag, missingPayloadReason }) {
    const fallbackReason = forceFailedTag ? getMissingPayloadNoteText(missingPayloadReason) : '';
    const doneReason = normalizeDeclineReason(doneValue);

    return pickFirst(
      homeRow?.[DECLINE_REASON_FIELD],
      homeRaw?.[DECLINE_REASON_FIELD],
      home?.[DECLINE_REASON_FIELD],
      homeRow?.Result,
      homeRaw?.Result,
      home?.Result,
      getBundleFailureReason(payload),
      homeRow?.['Done?'],
      homeRaw?.['Done?'],
      home?.['Done?'],
      doneReason,
      fallbackReason
    );
  }

  function strongClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: el.ownerDocument?.defaultView || window
        }));
      } catch {}
    }
    try { el.click(); return true; } catch { return false; }
  }

  function dtClick(el) {
    if (!(el instanceof Element)) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const view = el.ownerDocument?.defaultView || window;

    for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view,
          clientX,
          clientY
        }));
      } catch {}
    }

    return true;
  }

  function showBootstrapTab(anchor) {
    if (!anchor) return false;

    try {
      const $ = window.jQuery;
      if ($ && typeof $(anchor).tab === 'function') {
        $(anchor).tab('show');
        return true;
      }
    } catch {}

    strongClick(anchor);

    try {
      const href = anchor.getAttribute('href');
      if (href && href.startsWith('#')) {
        document.querySelectorAll('a[data-toggle="tab"]').forEach((a) => a.classList.remove('active'));
        anchor.classList.add('active');
        document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active', 'show'));
        const target = document.querySelector(href);
        if (target) target.classList.add('active', 'show');
      }
    } catch {}

    return true;
  }

  function waitFor(fn, timeoutMs, intervalMs = CFG.stepPollMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const loop = () => {
        if (state.destroyed) return resolve(null);
        try {
          const result = fn();
          if (result) return resolve(result);
        } catch {}
        if ((Date.now() - start) >= timeoutMs) return resolve(null);
        setTimeout(loop, intervalMs);
      };
      loop();
    });
  }

  function findVisibleElements(selector) {
    try {
      return Array.from(document.querySelectorAll(selector)).filter(visible);
    } catch {
      return [];
    }
  }

  function findByText(tagNames, text) {
    const want = lower(text);
    const tags = Array.isArray(tagNames) ? tagNames : [tagNames];
    const nodes = Array.from(document.querySelectorAll(tags.join(','))).filter(visible);
    return nodes.find((node) => lower(node.textContent || '').includes(want)) || null;
  }

  function extractTicketIdFromText(text) {
    const clean = norm(text || '');
    if (!clean) return '';
    const match = clean.match(/\bID[\s:#-]*?(\d{5,})\b/i) || clean.match(/\b(\d{5,})\b/);
    return match ? match[1] : '';
  }

  function scoreDockRoot(root) {
    if (!(root instanceof Element) || !visible(root)) return -1;
    let score = 0;
    if (root.matches('#serviceDetailDock')) score += 8;
    if (root.querySelector(SEL.detailForm)) score += 6;
    if (root.querySelector(SEL.topName)) score += 5;
    if (root.querySelector(SEL.vendorSync)) score += 5;
    if (extractTicketIdFromText(root.textContent || '')) score += 4;
    if (root.querySelector(SEL.noteOpener)) score += 2;
    if (root.querySelector(SEL.tagOpener)) score += 2;
    if (root.querySelector(SEL.mainTab)) score += 2;
    if (root.matches('#notePanelContainer')) score -= 4;
    if (root.matches('.az-dock__top')) score -= 2;
    return score;
  }

  function getOpenDockRoot() {
    const seen = new Set();
    const candidates = [];
    for (const root of Array.from(document.querySelectorAll(SEL.dockRoot))) {
      if (!(root instanceof Element) || seen.has(root)) continue;
      seen.add(root);
      candidates.push(root);
    }
    if (!candidates.length) return null;

    let best = null;
    let bestScore = -1;
    for (const root of candidates) {
      const score = scoreDockRoot(root);
      if (score > bestScore) {
        best = root;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function applyOpenTicketFallback(info, fallbackTicketId = '') {
    const fallbackId = norm(fallbackTicketId || '');
    if (!isPlainObject(info) || info.ticketId || !info.root || !fallbackId) return info;
    return {
      ...info,
      ticketId: fallbackId,
      inferredTicketId: true
    };
  }

  function getOpenTicketInfo(options = {}) {
    const fallbackTicketId = norm(options?.fallbackTicketId || '');
    const root = getOpenDockRoot();
    if (!root) return { ticketId: '', name: '', tags: [], root: null, inferredTicketId: false };

    const top = document.querySelector(SEL.dockTop) || root;
    const h3 = top.querySelector(SEL.topName) || root.querySelector(SEL.topName);

    let name = '';
    if (h3) {
      const clone = h3.cloneNode(true);
      clone.querySelector('.origin-vendor-sync')?.remove();
      name = norm(clone.textContent || '');
    }

    let ticketId = '';
    const syncNode = root.querySelector(SEL.vendorSync);
    ticketId = extractTicketIdFromText(syncNode?.textContent || '');
    if (!ticketId) ticketId = extractTicketIdFromText(root.textContent || '');
    if (!ticketId) {
      const topText = norm((document.querySelector(SEL.dockTop)?.textContent || ''));
      ticketId = extractTicketIdFromText(topText);
    }

    const tags = Array.from(root.querySelectorAll(SEL.topTags))
      .map((el) => norm(el.textContent))
      .filter(Boolean);

    return applyOpenTicketFallback({
      ticketId,
      name,
      tags,
      root,
      inferredTicketId: false
    }, fallbackTicketId);
  }

  function readTargets(key) {
    const value = readGM(key, {});
    return isPlainObject(value) ? value : {};
  }

  function saveTargets(key, value) {
    writeGM(key, value);
  }

  function getFieldTargets() {
    const targets = readTargets(GM_KEYS.fieldTargets);
    let changed = false;

    if (!isPlainObject(targets['Home Sqft']) && isPlainObject(targets['Square FT'])) {
      targets['Home Sqft'] = deepClone(targets['Square FT']);
      changed = true;
    }

    if (!isPlainObject(targets['Account Number']) && isPlainObject(targets['Account number'])) {
      targets['Account Number'] = deepClone(targets['Account number']);
      changed = true;
    }

    if (changed) saveTargets(GM_KEYS.fieldTargets, targets);
    return targets;
  }

  function getTagTargets() {
    return readTargets(GM_KEYS.tagTargets);
  }

  function getTagTargetSignature(kind) {
    const record = getTagTargets()[kind];
    if (!isPlainObject(record)) return `${kind}|`;
    const label = lowerTagText(record.label || '');
    const value = norm(record.value || '');
    return `${kind}|${label || value}`;
  }

  function runRecordMatchesTagTarget(record, kind, signature) {
    if (!isPlainObject(record) || !record.tagAppliedAt) return false;
    return norm(record.tagTargetKey || '') === kind
      && norm(record.tagTargetSignature || '') === signature;
  }

  function hasAllFieldTargets() {
    const targets = getFieldTargets();
    return FIELD_ORDER.every((label) => isPlainObject(targets[label]) && norm(targets[label].selector));
  }

  function getMissingFieldTargetLabels() {
    const targets = getFieldTargets();
    return FIELD_ORDER.filter((label) => !(isPlainObject(targets[label]) && norm(targets[label].selector)));
  }

  function getFieldTargetStatusText() {
    const missing = getMissingFieldTargetLabels();
    if (!missing.length) return 'Saved';
    return `Missing ${missing.length}/${FIELD_ORDER.length}`;
  }

  function hasAllTagTargets() {
    const targets = getTagTargets();
    return ['successfulTag', 'failedTag'].every((key) => {
      const record = targets[key];
      return isPlainObject(record) && (norm(record.value) || cleanTagText(record.label));
    });
  }

  function readRuns() {
    const value = readGM(GM_KEYS.runs, {});
    return isPlainObject(value) ? value : {};
  }

  function saveRuns(runs) {
    writeGM(GM_KEYS.runs, runs);
  }

  function extractPayloadAzId(raw) {
    const data = unwrapProductPayload(raw);
    return norm(
      raw?.azId
      || raw?.['AZ ID']
      || data?.azId
      || data?.['AZ ID']
      || raw?.currentJob?.['AZ ID']
      || data?.currentJob?.['AZ ID']
      || ''
    );
  }

  function getPayloadSavedMs(raw) {
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

  function getCurrentJobUpdatedMs(job) {
    const ms = Date.parse(norm(job?.updatedAt || ''));
    return Number.isFinite(ms) ? ms : 0;
  }

  function getSignalSavedMs(signal) {
    const candidates = [
      signal?.savedAt,
      signal?.updatedAt,
      signal?.requestedAt,
      signal?.sentAt
    ];

    for (const value of candidates) {
      const ms = Date.parse(norm(value || ''));
      if (Number.isFinite(ms)) return ms;
    }

    return 0;
  }

  function chooseBetterReadySignal(localReady, gmReady) {
    const localOk = isPlainObject(localReady) && (localReady.ready === true || norm(localReady.azId || localReady.ticketId || ''));
    const gmOk = isPlainObject(gmReady) && (gmReady.ready === true || norm(gmReady.azId || gmReady.ticketId || ''));
    if (localOk && !gmOk) return localReady;
    if (!localOk && gmOk) return gmReady;
    if (!localOk && !gmOk) return null;

    const localMs = getSignalSavedMs(localReady);
    const gmMs = getSignalSavedMs(gmReady);
    if (localMs && gmMs && localMs !== gmMs) return localMs > gmMs ? localReady : gmReady;
    return localReady;
  }

  function getBestCurrentJobForAz(azId) {
    const wantedAzId = norm(azId || '');
    if (!wantedAzId) return null;

    const candidates = [
      readLocalOnly(GM_KEYS.azCurrentJob, null),
      readLocalOnly(GM_KEYS.currentJob, null),
      readGmOnly(GM_KEYS.azCurrentJob, null),
      readGmOnly(GM_KEYS.currentJob, null)
    ].filter(isPlainObject);

    let best = null;
    let bestMs = 0;

    for (const candidate of candidates) {
      const candidateAzId = norm(candidate?.['AZ ID'] || candidate?.azId || candidate?.ticketId || '');
      if (candidateAzId !== wantedAzId) continue;
      const candidateMs = getCurrentJobUpdatedMs(candidate);
      if (!best || candidateMs > bestMs) {
        best = candidate;
        bestMs = candidateMs;
      }
    }

    return best;
  }

  function isPayloadStaleForCurrentJob(azId, payloadSavedMs) {
    const currentJob = getBestCurrentJobForAz(azId);
    const currentJobMs = getCurrentJobUpdatedMs(currentJob);
    if (!currentJobMs) return false;
    if (!payloadSavedMs) return true;
    return (payloadSavedMs + CFG.stalePayloadSlackMs) < currentJobMs;
  }

  function logFinalPayloadRejected(azId, reason, details = {}) {
    const cleanAzId = norm(azId || '');
    const key = [
      cleanAzId,
      reason,
      details.payloadSavedMs || 0,
      details.readySavedMs || 0,
      details.currentJobMs || 0
    ].join('|');

    const rejectedKey = cleanAzId ? `${cleanAzId}|${reason}` : reason;
    if (!state.rejectedFinalPayloadSince || state.rejectedFinalPayloadKey !== rejectedKey) {
      state.rejectedFinalPayloadSince = Date.now();
    }
    state.rejectedFinalPayloadKey = rejectedKey;
    state.rejectedFinalPayloadReason = reason;

    if (state.lastFinalPayloadRejectLogKey === key) return;
    state.lastFinalPayloadRejectLogKey = key;

    const parts = [];
    if (details.payloadSavedMs) parts.push(`payload=${new Date(details.payloadSavedMs).toISOString()}`);
    if (details.readySavedMs) parts.push(`ready=${new Date(details.readySavedMs).toISOString()}`);
    if (details.currentJobMs) parts.push(`launcher=${new Date(details.currentJobMs).toISOString()}`);
    log(`Final payload rejected for AZ ${cleanAzId || '(unknown)'}: ${reason}${parts.length ? ` | ${parts.join(' | ')}` : ''}`);
  }

  function clearRejectedFinalPayloadState() {
    state.rejectedFinalPayloadKey = '';
    state.rejectedFinalPayloadSince = 0;
    state.rejectedFinalPayloadReason = '';
    state.rejectedFinalPayloadTriggeredKey = '';
  }

  function validateFinalPayloadForActiveLauncher(payload, readyLike, azId) {
    const cleanAzId = norm(azId || '');
    const readyAzId = norm(readyLike?.azId || readyLike?.ticketId || '');
    const readySavedMs = getSignalSavedMs(readyLike);
    const payloadSavedMs = getPayloadSavedMs(payload);
    const currentJob = getBestCurrentJobForAz(cleanAzId);
    const currentJobMs = getCurrentJobUpdatedMs(currentJob);

    if (!readyLike || readyLike.ready !== true) {
      return { ok: false, reason: 'final ready flag missing', payloadSavedMs, readySavedMs, currentJobMs };
    }

    if (readyAzId && readyAzId !== cleanAzId) {
      return { ok: false, reason: `final ready flag belongs to AZ ${readyAzId}`, payloadSavedMs, readySavedMs, currentJobMs };
    }

    return {
      ok: true,
      currentJob,
      currentJobMs,
      payloadSavedMs,
      readySavedMs,
      minSavedMs: 0
    };
  }

  function countFilledKeys(value, keys) {
    if (!isPlainObject(value)) return 0;
    let count = 0;
    for (const key of keys) {
      if (norm(value[key] || '')) count += 1;
    }
    return count;
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
        'Home Roof Type',
        'Bedrooms',
        'Bathrooms',
        'Home Type',
        'Account Number',
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

  function readDirectProductPayload(key) {
    const local = readLocalOnly(key, null);
    if (isPlainObject(local) && extractPayloadAzId(local)) return local;
    const gm = readGmOnly(key, null);
    if (isPlainObject(gm) && extractPayloadAzId(gm)) return gm;
    return null;
  }

  function chooseBetterFinalPayload(localPayload, gmPayload) {
    const localOk = isPlainObject(localPayload) && norm(localPayload.azId || '');
    const gmOk = isPlainObject(gmPayload) && norm(gmPayload.azId || '');
    if (localOk && !gmOk) return localPayload;
    if (!localOk && gmOk) return gmPayload;
    if (!localOk && !gmOk) return null;

    const localMs = getPayloadSavedMs(localPayload);
    const gmMs = getPayloadSavedMs(gmPayload);
    if (localMs && gmMs && localMs !== gmMs) return localMs > gmMs ? localPayload : gmPayload;
    return localPayload;
  }

  function getFinalPayload() {
    const localPayload = readLocalOnly(GM_KEYS.finalPayload, null);
    const gmPayload = readGmOnly(GM_KEYS.finalPayload, null);
    const payload = chooseBetterFinalPayload(localPayload, gmPayload);
    if (!isPlainObject(payload)) return null;
    const localReady = readLocalOnly(GM_KEYS.finalReady, null);
    const gmReady = readGmOnly(GM_KEYS.finalReady, null);
    const ready = chooseBetterReadySignal(localReady, gmReady);
    const readyLike = isPlainObject(ready) ? ready : {};
    const readyOk = readyLike.ready === true;
    const azId = norm(payload.azId || readyLike.azId || '');
    const savedAt = norm(payload.savedAt || readyLike.savedAt || '');
    const payloadSavedMs = getPayloadSavedMs(payload);
    if (!azId) return null;
    const validation = validateFinalPayloadForActiveLauncher(payload, readyLike, azId);
    if (!validation.ok) {
      logFinalPayloadRejected(azId, validation.reason, validation);
      return null;
    }

    clearRejectedFinalPayloadState();
    return {
      ready: readyOk ? readyLike : { ready: true, azId, savedAt },
      payload,
      azId,
      payloadKey: `${azId}|${savedAt}`,
      payloadSavedMs,
      currentJob: validation.currentJob,
      currentJobMs: validation.currentJobMs,
      readySavedMs: validation.readySavedMs,
      minSavedMs: validation.minSavedMs
    };
  }

  function unwrapProductPayload(raw) {
    if (!isPlainObject(raw)) return {};
    return isPlainObject(raw.data) ? raw.data : raw;
  }

  function choosePreferredProductPayload(product, expectedAzId, candidates, minSavedMs = 0) {
    const ranked = candidates
      .map((candidate) => {
        const raw = candidate?.raw;
        if (!isPlainObject(raw)) return null;
        const azId = extractPayloadAzId(raw);
        if (expectedAzId && azId && azId !== expectedAzId) return null;
        const savedMs = getPayloadSavedMs(raw);
        if (minSavedMs && (!savedMs || (savedMs + CFG.stalePayloadSlackMs) < minSavedMs)) return null;
        return {
          raw,
          source: norm(candidate?.source || `${product}`) || `${product}`,
          savedMs,
          score: scoreProductPayload(product, raw),
          sourceRank: Number(candidate?.sourceRank || 0)
        };
      })
      .filter(Boolean);

    if (!ranked.length) {
      return {
        raw: {},
        source: `${product}:none`,
        savedAt: '',
        score: -1
      };
    }

    ranked.sort((a, b) => {
      if (a.savedMs !== b.savedMs) return b.savedMs - a.savedMs;
      if (a.score !== b.score) return b.score - a.score;
      return b.sourceRank - a.sourceRank;
    });

    return {
      raw: ranked[0].raw,
      source: ranked[0].source,
      savedAt: ranked[0].savedMs ? new Date(ranked[0].savedMs).toISOString() : '',
      score: ranked[0].score
    };
  }

  function formatProductChoiceSource(choice, fallback) {
    const source = norm(choice?.source || fallback || '') || fallback || '';
    const savedAt = norm(choice?.savedAt || '');
    return savedAt ? `${source} @ ${savedAt}` : source;
  }

  function buildAltaAccountUrl(accountNumber) {
    const cleanAccount = norm(accountNumber || '');
    if (!cleanAccount) return '';
    return '';
  }

  function buildWorkflowNoteData({ homeSubmission = '', accountNumber = '', doneValue = '' } = {}) {
    const cleanSubmission = norm(homeSubmission || '');
    const cleanAccount = norm(accountNumber || '');
    const cleanDone = norm(doneValue || '');
    const accountLinkUrl = buildAltaAccountUrl(cleanAccount);
    const linkText = cleanAccount ? `Account Link: ${cleanAccount}` : '';
    const accountDisplayLine = linkText || `Account Number: ${cleanAccount}`;
    const fallbackAccountLine = accountLinkUrl
      ? `Account Link: ${accountLinkUrl}`
      : accountDisplayLine;

    const lines = [
      `Home Submission Number: ${cleanSubmission}`,
      accountDisplayLine
    ];

    const fallbackLines = [
      `Home Submission Number: ${cleanSubmission}`,
      fallbackAccountLine
    ];

    return {
      homeSubmission: cleanSubmission,
      accountNumber: cleanAccount,
      doneValue: cleanDone,
      accountLinkUrl,
      linkText,
      text: lines.join('\n'),
      fallbackText: fallbackLines.join('\n')
    };
  }

  function buildWorkflowDataFromProductChoices(options = {}) {
    const azId = norm(options.azId || '');
    if (!azId) return null;

    const payload = isPlainObject(options.payload) ? options.payload : {};
    const homeChoice = options.homeChoice || {};
    const homeRaw = isPlainObject(homeChoice.raw) ? homeChoice.raw : {};
    const home = unwrapProductPayload(homeRaw);
    const homeRow = getProductRow(homeRaw);

    const doneValue = pickFirst(
      homeRaw['Done?'],
      home['Done?'],
      homeRow['Done?'],
      payload.bundle?.home?.data?.row?.['Done?'],
      payload.bundle?.home?.ready ? 'Yes' : ''
    );

    const homeSubmission = pickFirst(
      homeRaw['Submission Number'],
      home['Submission Number'],
      homeRow['Submission Number'],
      homeRaw.submissionNumber,
      home.submissionNumber,
      home.currentJob?.SubmissionNumber,
      payload.bundle?.home?.submissionNumber
    );

    const accountNumber = pickFirst(
      payload.currentJob?.['Account Number'],
      payload.currentJob?.AccountNumber,
      payload.bundle?.['Account Number'],
      payload.bundle?.AccountNumber,
      homeRaw['Account Number'],
      home['Account Number'],
      homeRow['Account Number'],
      home.currentJob?.['Account Number'],
      payload.bundle?.home?.data?.row?.['Account Number'],
      payload.bundle?.home?.data?.currentJob?.['Account Number']
    );
    const homeReady = homeRaw.ready === true || home.ready === true || payload.bundle?.home?.ready === true;
    const tabsUsed = isPlainObject(home.tabsUsed) ? home.tabsUsed : {};
    const exclusionsChecked = tabsUsed.exclusionsAndConditions === true;
    const cfpDetectedFlag = tabsUsed.fairPlanCompanionEndorsementDetected;
    const cfpFromTabs = cfpDetectedFlag === true
      ? 'YES'
      : (homeReady && exclusionsChecked && cfpDetectedFlag === false ? 'NO' : '');
    const cfpValue = pickFirst(homeRow['CFP?'], cfpFromTabs);
    // Fallback handling can still bypass final-payload gating, but a positive
    // Done flag means the quote completed and should keep the success tag.
    const chooseSuccessfulTag = normalizeYes(doneValue);
    const declineReason = chooseSuccessfulTag ? '' : getDeclineReasonForWorkflow({
      payload,
      homeRaw,
      home,
      homeRow,
      doneValue,
      forceFailedTag: options.forceFailedTag === true,
      missingPayloadReason: options.missingPayloadReason || ''
    });

    const fields = {
      'CFP?': cfpValue,
      'Reconstruction Cost': pickFirst(homeRow['Reconstruction Cost']),
      'Year Built': pickFirst(homeRow['Year Built']),
      'Home Sqft': pickFirst(homeRow['Home Sqft'], homeRow['Square FT']),
      '# of Story': pickFirst(homeRow['# of Story']),
      'Home Roof Type': pickFirst(homeRow['Home Roof Type']),
      'Bedrooms': pickFirst(homeRow['Bedrooms']),
      'Bathrooms': pickFirst(homeRow['Bathrooms']),
      'Home Type': pickFirst(homeRow['Home Type']),
      'Water Device?': pickFirst(homeRow['Water Device?']),
      'Standard Pricing No Auto Discount': pickFirst(homeRow['Standard Pricing No Auto Discount']),
      'Enhance Pricing No Auto Discount': pickFirst(homeRow['Enhance Pricing No Auto Discount']),
      'Standard Pricing Auto Discount': pickFirst(homeRow['Standard Pricing Auto Discount']),
      'Enhance Pricing Auto Discount': pickFirst(homeRow['Enhance Pricing Auto Discount']),
      'Home Submission Number': homeSubmission,
      'Account Number': accountNumber,
      [DECLINE_REASON_FIELD]: declineReason
    };

    const note = buildWorkflowNoteData({
      homeSubmission,
      accountNumber,
      cfpValue,
      doneValue
    });

    const hasSubstantiveProductData = (
      Number(homeChoice.score || 0) > 0 ||
      Object.keys(getNormalizedWorkflowFields(fields)).length > 0 ||
      !!norm(doneValue)
    );

    if (!hasSubstantiveProductData) return null;

    return {
      azId,
      payloadSavedAt: norm(options.payloadSavedAt || ''),
      fields,
      note,
      sources: {
        home: formatProductChoiceSource(homeChoice, options.homeSourceFallback || 'missing-payload')
      },
      chooseSuccessfulTag,
      missingPayloadFallback: options.missingPayloadFallback === true
    };
  }

  function getMissingPayloadNoteText(reason = '') {
    const text = norm(reason || '');
    if (!text) return 'SKIPPED, NOT ENOUGH INFO TO START A QUOTE';

    const lowerText = text.toLowerCase();
    const generic =
      lowerText === 'main/payload failed' ||
      lowerText === 'payload does not match after 20 seconds' ||
      lowerText.startsWith('launcher error:') ||
      lowerText.includes('missing launcher data');

    return generic ? 'SKIPPED, NOT ENOUGH INFO TO START A QUOTE' : text;
  }

  function buildBlankMissingWorkflowData(ticketId, reason = '') {
    const azId = norm(ticketId || '');
    const noteText = getMissingPayloadNoteText(reason);
    return {
      azId,
      payloadSavedAt: '',
      fields: {
        'CFP?': '',
        'Reconstruction Cost': '',
        'Year Built': '',
        'Home Sqft': '',
        '# of Story': '',
        'Home Roof Type': '',
        'Bedrooms': '',
        'Bathrooms': '',
        'Home Type': '',
        'Water Device?': '',
        'Standard Pricing No Auto Discount': '',
        'Enhance Pricing No Auto Discount': '',
        'Standard Pricing Auto Discount': '',
        'Enhance Pricing Auto Discount': '',
        'Home Submission Number': '',
        'Account Number': '',
        [DECLINE_REASON_FIELD]: noteText
      },
      note: {
        homeSubmission: '',
        accountNumber: '',
        doneValue: noteText,
        accountLinkUrl: '',
        linkText: '',
        text: noteText,
        fallbackText: noteText
      },
      sources: {
        home: 'missing-payload'
      },
      chooseSuccessfulTag: false,
      missingPayloadFallback: true
    };
  }

  function extractWorkflowData(finalPayload) {
    const payload = finalPayload.payload;
    const minSavedMs = Math.max(0, Number(finalPayload.minSavedMs || 0) || 0);
    const homeChoice = choosePreferredProductPayload('home', finalPayload.azId, [
      { source: 'bridged-home', raw: readDirectProductPayload(GM_KEYS.homePayload), sourceRank: 3 },
      { source: 'final-home-payload', raw: isPlainObject(payload.homePayload) ? payload.homePayload : null, sourceRank: 2 },
      { source: 'final-home-bundle', raw: payload.bundle?.home?.data, sourceRank: 1 }
    ], minSavedMs);

    return buildWorkflowDataFromProductChoices({
      azId: finalPayload.azId,
      payloadSavedAt: norm(payload.savedAt || finalPayload.ready.savedAt || ''),
      payload,
      homeChoice
    }) || buildMissingPayloadWorkflowData(finalPayload.azId);
  }

  function buildMissingPayloadWorkflowData(ticketId, reason = '') {
    const azId = norm(ticketId || '');
    if (getMissingPayloadNoteText(reason) !== 'SKIPPED, NOT ENOUGH INFO TO START A QUOTE') {
      return buildBlankMissingWorkflowData(azId, reason);
    }

    const minSavedMs = 0;
    const homeChoice = choosePreferredProductPayload('home', azId, [
      { source: 'bridged-home', raw: readDirectProductPayload(GM_KEYS.homePayload), sourceRank: 2 }
    ], minSavedMs);

    return buildWorkflowDataFromProductChoices({
      azId,
      payloadSavedAt: '',
      payload: {},
      homeChoice,
      forceFailedTag: true,
      missingPayloadReason: reason,
      missingPayloadFallback: true
    }) || buildBlankMissingWorkflowData(azId, reason);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|\/@])/g, '\\$1');
  }

  function getStableClassTokens(el) {
    return Array.from(el.classList || [])
      .filter((token) => /^az-|^btn-|^ql-|^dropdown|^tag|^form|^input/.test(token))
      .slice(0, 4);
  }

  function buildFingerprint(el) {
    if (!(el instanceof Element)) return {};
    return {
      tag: String(el.tagName || '').toLowerCase(),
      id: norm(el.id || ''),
      name: norm(el.getAttribute('name') || ''),
      role: norm(el.getAttribute('role') || ''),
      ariaLabel: norm(el.getAttribute('aria-label') || ''),
      classTokens: getStableClassTokens(el),
      textFingerprint: norm((el.innerText || el.textContent || '').slice(0, 160))
    };
  }

  function isUniqueSelector(selector) {
    try { return document.querySelectorAll(selector).length === 1; }
    catch { return false; }
  }

  function buildStableSelector(el) {
    if (!(el instanceof Element)) return '';

    const insideTagForm = !!el.closest(SEL.tagForm);
    const role = norm(el.getAttribute('role') || '');
    const classList = Array.from(el.classList || []);
    const isDropdownOption = insideTagForm && (
      role === 'option' ||
      classList.includes('dropdown-item') ||
      !!el.closest('.dropdown-menu')
    );

    if (isDropdownOption) {
      const tag = el.tagName.toLowerCase();
      const classSelector = classList.includes('dropdown-item') ? '.dropdown-item' : '';
      return `${SEL.tagForm} ${tag}${classSelector}${role ? `[role="${cssEscape(role)}"]` : ''}`;
    }

    if (el.id) return `#${cssEscape(el.id)}`;

    const name = norm(el.getAttribute('name') || '');
    if (name) {
      const selector = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

    const aria = norm(el.getAttribute('aria-label') || '');
    if (role && aria) {
      const selector = `${el.tagName.toLowerCase()}[role="${cssEscape(role)}"][aria-label="${cssEscape(aria)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

    let current = el;
    const parts = [];
    while (current && current.nodeType === 1 && current !== document.body && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${cssEscape(current.id)}`;
        parts.unshift(part);
        break;
      }

      const classes = getStableClassTokens(current);
      if (classes.length) part += '.' + classes.map(cssEscape).join('.');

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }

      parts.unshift(part);
      const selector = parts.join(' > ');
      if (isUniqueSelector(selector)) return selector;
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function matchFingerprint(record, el) {
    if (!(el instanceof Element)) return false;
    const saved = isPlainObject(record.fingerprint) ? record.fingerprint : {};
    const current = buildFingerprint(el);

    if (saved.id && current.id && saved.id === current.id) return true;

    let score = 0;
    let required = 0;

    if (saved.tag) { required += 1; if (saved.tag === current.tag) score += 1; }
    if (saved.name) { required += 1; if (saved.name === current.name) score += 1; }
    if (saved.role) { required += 1; if (saved.role === current.role) score += 1; }
    if (saved.ariaLabel) { required += 1; if (saved.ariaLabel === current.ariaLabel) score += 1; }
    if (Array.isArray(saved.classTokens) && saved.classTokens.length) {
      required += 1;
      const currentSet = new Set(current.classTokens || []);
      if (saved.classTokens.every((token) => currentSet.has(token))) score += 1;
    }
    if (saved.textFingerprint) {
      required += 1;
      const a = lower(saved.textFingerprint);
      const b = lower(current.textFingerprint);
      if (a && b && (a.includes(b) || b.includes(a))) score += 1;
    }

    if (required === 0) return true;
    if (required === 1) return score === 1;
    return score >= 2;
  }

  function findSavedElement(record) {
    if (!isPlainObject(record)) return null;
    const selector = norm(record.selector || '');
    if (!selector) return null;

    let nodes = [];
    try { nodes = Array.from(document.querySelectorAll(selector)); } catch {}
    const visibleNodes = nodes.filter(visible);
    for (const node of visibleNodes) {
      if (matchFingerprint(record, node)) return node;
    }
    return visibleNodes[0] || nodes[0] || null;
  }

  function resolveEditableTarget(baseEl) {
    if (!(baseEl instanceof Element)) return null;
    const selectors = [
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '.editable-container input:not([type="hidden"]):not([disabled])',
      '.editable-container textarea:not([disabled])',
      '.editable-container select:not([disabled])',
      '.editableform input:not([type="hidden"]):not([disabled])',
      '.editableform textarea:not([disabled])',
      '.editableform select:not([disabled])',
      '.popover input:not([type="hidden"]):not([disabled])',
      '.popover textarea:not([disabled])',
      '.popover select:not([disabled])'
    ].join(', ');

    const candidates = [];
    const add = (el) => {
      if (el && el instanceof Element && !candidates.includes(el)) candidates.push(el);
    };
    const group = baseEl.closest('.form-group, .form-row, .row, .col, td, tr, label, .input-group, .bootstrap-select, .form-control');
    const bootstrapSelect = baseEl.closest('.bootstrap-select') || group?.querySelector?.('.bootstrap-select');

    try { baseEl.matches(selectors) && add(baseEl); } catch {}
    try { baseEl.querySelectorAll(selectors).forEach(add); } catch {}
    try { group?.querySelectorAll(selectors).forEach(add); } catch {}
    try { baseEl.parentElement?.querySelectorAll(selectors).forEach(add); } catch {}
    try { bootstrapSelect?.parentElement?.querySelectorAll('select:not([disabled])').forEach(add); } catch {}
    try { document.querySelectorAll('.editable-container input:not([type="hidden"]):not([disabled]), .editable-container textarea:not([disabled]), .editable-container select:not([disabled]), .editableform input:not([type="hidden"]):not([disabled]), .editableform textarea:not([disabled]), .editableform select:not([disabled]), .popover input:not([type="hidden"]):not([disabled]), .popover textarea:not([disabled]), .popover select:not([disabled])').forEach(add); } catch {}
    try {
      const active = document.activeElement;
      if (active instanceof Element && (active === baseEl || baseEl.contains(active) || active.closest('.form-group, .form-row, .row, .col, td, tr, label, .input-group, .bootstrap-select, .form-control') === group)) {
        add(active);
      }
    } catch {}

    const score = (el) => {
      if (!(el instanceof Element)) return -1;
      let points = 0;
      if (el instanceof HTMLSelectElement) points += 8;
      else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) points += 7;
      else if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') points += 6;
      else points += 1;
      if (visible(el)) points += 3;
      if (el === document.activeElement) points += 5;
      if (el !== baseEl) points += 2;
      if (bootstrapSelect && (bootstrapSelect.contains(el) || el.closest('.bootstrap-select') === bootstrapSelect)) points += 2;
      if (el.closest('.editable-container, .editableform, .popover')) points += 4;
      return points;
    };

    return candidates.sort((a, b) => score(b) - score(a))[0] || baseEl;
  }

  function dispatchFieldEvents(target) {
    for (const type of ['focus', 'input', 'change', 'blur']) {
      try {
        const event = type === 'blur' || type === 'focus'
          ? new FocusEvent(type, { bubbles: true, composed: true })
          : new Event(type, { bubbles: true, composed: true });
        target.dispatchEvent(event);
      } catch {}
    }
  }

  function setNativeValue(target, value) {
    const proto = Object.getPrototypeOf(target);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(target, value);
    else target.value = value;
  }

  function verifyFieldValue(target, expected) {
    const want = norm(expected);

    if (target instanceof HTMLSelectElement) {
      return lower(target.value) === lower(expected) || lower(target.selectedOptions?.[0]?.textContent || '') === lower(expected) || (!want && !norm(target.value));
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return norm(target.value) === want;
    }

    if (target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox') {
      return norm(target.innerText || target.textContent || '') === want;
    }

    return norm(target.textContent || '') === want;
  }

  async function waitForEditableTarget(base) {
    const started = Date.now();
    let chosen = null;
    while ((Date.now() - started) < 2200) {
      chosen = resolveEditableTarget(base) || base;
      if (chosen instanceof HTMLInputElement || chosen instanceof HTMLTextAreaElement || chosen instanceof HTMLSelectElement || chosen.getAttribute?.('contenteditable') === 'true' || chosen.getAttribute?.('role') === 'textbox') {
        return chosen;
      }
      await sleep(120);
    }
    return chosen || base;
  }

  async function setFieldValue(record, value) {
    const base = findSavedElement(record);
    if (!base) return { ok: false, reason: 'saved field target not found' };

    const nextValue = norm(value);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try { strongClick(base); } catch {}
      await sleep(180);
      const target = await waitForEditableTarget(base);
      const editableTarget = target instanceof HTMLSelectElement
        || target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target.getAttribute?.('contenteditable') === 'true'
        || target.getAttribute?.('role') === 'textbox';

      if (!editableTarget) {
        await sleep(220);
        continue;
      }

      if (target instanceof HTMLSelectElement) {
        const options = Array.from(target.options || []);
        let match = options.find((opt) => lower(opt.textContent || '') === lower(nextValue) || lower(opt.value || '') === lower(nextValue));
        if (!match && nextValue) {
          match = options.find((opt) => lower(opt.textContent || '').includes(lower(nextValue)) || lower(nextValue).includes(lower(opt.textContent || '')));
        }
        target.value = match ? match.value : '';
        if (match) match.selected = true;
        try { target.setAttribute('value', target.value); } catch {}
        dispatchFieldEvents(target);
      } else if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        try { target.focus({ preventScroll: true }); } catch {}
        setNativeValue(target, '');
        try { target.setAttribute('value', ''); } catch {}
        dispatchFieldEvents(target);
        setNativeValue(target, nextValue);
        try { target.setAttribute('value', nextValue); } catch {}
        dispatchFieldEvents(target);
      } else if (target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox') {
        target.innerHTML = nextValue ? `<p>${escapeHtml(nextValue)}</p>` : '<p><br></p>';
        dispatchFieldEvents(target);
      }

      await sleep(220);
      if (verifyFieldValue(target, nextValue)) return { ok: true };
    }

    return { ok: false, reason: 'editable target not found or value did not stick' };
  }

  async function ensureMainTab() {
    const mainTab = document.querySelector(SEL.mainTab);
    if (!mainTab || !visible(mainTab)) {
      log('Main tab button not found');
      return false;
    }

    showBootstrapTab(mainTab);
    const openTicketId = norm(getOpenTicketInfo().ticketId || state.activeAzId || '');
    if (openTicketId) {
      state.lastMainClickedTicketId = openTicketId;
      state.lastMainClickedAt = Date.now();
    }
    log('Clicked: Main tab');
    await sleep(CFG.bigActionDelayMs);

    const ready = await waitFor(() => {
      const pane = document.querySelector(SEL.mainPane);
      const form = document.querySelector(SEL.detailForm);
      const tab = document.querySelector(SEL.mainTab);
      const paneReady = !!(pane && (pane.classList.contains('active') || pane.classList.contains('show') || visible(pane)));
      const formReady = !!(form && visible(form));
      const tabReady = !!(tab && tab.classList.contains('active'));
      return paneReady || formReady || tabReady;
    }, CFG.mainReadyMs);

    if (!ready) {
      log('Main tab did not become ready');
      return false;
    }

    return true;
  }

  function findUpdateButton() {
    const bySelector = findVisibleElements(SEL.updateButton)[0];
    if (bySelector) return bySelector;
    return findByText(['button', 'a'], 'Update');
  }

  async function clickUpdateButton() {
    const button = findUpdateButton();
    if (!button) {
      log('Update button not found');
      return false;
    }
    strongClick(button);
    log('Clicked: Update');
    await sleep(CFG.updateSettleMs);
    return true;
  }

  function findNoteOpener() {
    let el = findVisibleElements(SEL.noteOpener)[0];
    if (el) return el;

    const icon = Array.from(document.querySelectorAll('i.fal.fa-sticky-note')).find(visible);
    if (icon) return icon.closest('a,button,[role="button"]');

    return null;
  }

  async function openNotePanel() {
    const opener = findNoteOpener();
    if (!opener) {
      log('Note opener not found');
      return false;
    }

    strongClick(opener);
    log('Clicked: Note opener');
    await sleep(CFG.bigActionDelayMs);
    const editor = await waitFor(() => findVisibleElements(SEL.noteEditor)[0], 8000);
    if (!editor) {
      log('Note editor not found');
      return false;
    }
    return true;
  }

  function normalizeNoteInput(noteInput) {
    if (!isPlainObject(noteInput)) {
      const text = String(noteInput == null ? '' : noteInput);
      return {
        text,
        fallbackText: text,
        accountLinkUrl: '',
        linkText: ''
      };
    }

    const text = String(noteInput.text == null ? '' : noteInput.text);
    const fallbackText = String(noteInput.fallbackText == null ? text : noteInput.fallbackText);
    return {
      ...noteInput,
      text,
      fallbackText,
      accountLinkUrl: norm(noteInput.accountLinkUrl || ''),
      linkText: String(noteInput.linkText == null ? '' : noteInput.linkText)
    };
  }

  function findNoteQuill(editor) {
    if (!(editor instanceof Element)) return null;

    let node = editor;
    while (node && node instanceof Element) {
      const quill = node.__quill;
      if (quill && typeof quill.insertText === 'function') return quill;
      node = node.parentElement;
    }

    return null;
  }

  function fillNoteEditorFallback(editor, noteText) {
    const lines = String(noteText == null ? '' : noteText).split('\n');
    editor.innerHTML = lines.map((line) => `<p>${escapeHtml(line || '') || '<br>'}</p>`).join('');
    editor.classList.remove('ql-blank');
    dispatchFieldEvents(editor);
  }

  function fillNoteEditorWithQuill(editor, note) {
    const quill = findNoteQuill(editor);
    if (!quill || !note.linkText || !note.accountLinkUrl) return false;

    try { quill.focus(); } catch {}

    try {
      if (typeof quill.setText === 'function') quill.setText('', 'silent');
      else if (typeof quill.deleteText === 'function' && typeof quill.getLength === 'function') quill.deleteText(0, quill.getLength(), 'silent');
      else editor.innerHTML = '<p><br></p>';
    } catch {
      editor.innerHTML = '<p><br></p>';
    }

    const lines = note.text.split('\n');
    let index = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = String(lines[i] == null ? '' : lines[i]);
      if (i > 0) {
        quill.insertText(index, '\n', 'user');
        index += 1;
      }
      if (!line) continue;
      if (line === note.linkText) quill.insertText(index, line, { link: note.accountLinkUrl }, 'user');
      else quill.insertText(index, line, 'user');
      index += line.length;
    }

    const root = quill.root instanceof Element ? quill.root : editor;
    try { root.classList.remove('ql-blank'); } catch {}
    dispatchFieldEvents(root);
    return true;
  }

  async function fillNoteEditor(noteInput) {
    const editor = await waitFor(() => findVisibleElements(SEL.noteEditor)[0], 4000);
    if (!editor) return false;

    const note = normalizeNoteInput(noteInput);
    const usedQuill = fillNoteEditorWithQuill(editor, note);
    if (!usedQuill) {
      fillNoteEditorFallback(editor, note.fallbackText || note.text);
      if (note.accountLinkUrl) log('Quill note API unavailable; used plain Alta account URL fallback');
    } else if (note.accountLinkUrl) {
      log('Filled note editor via Quill account link formatting');
    }

    await sleep(150);
    const expectedText = usedQuill ? note.text : (note.fallbackText || note.text);
    return norm(editor.innerText || editor.textContent || '') === norm(expectedText);
  }

  function findPinToTop() {
    let el = findVisibleElements('a.pin-top, a.d-flex.align-items-center.pin-top')
      .find((candidate) => lower(candidate.textContent).includes('pin to top'));
    if (el) return el;

    el = findVisibleElements(SEL.pinTop)[0];
    if (el) return el;

    const icon = Array.from(document.querySelectorAll('i.fas.fa-thumbtack')).find(visible);
    if (icon) return icon.closest('a,button,[role="button"]');

    return findByText(['a', 'button'], 'Pin to top');
  }

  function clickPinToTop(pin) {
    if (!(pin instanceof Element)) return false;

    const text = lower(pin.textContent || '');
    if (pin.matches('a.pin-top, a.d-flex.align-items-center.pin-top') && text.includes('pin to top')) {
      dtClick(pin);
      log('Clicked: Pin to top (DT fallback)');
      return true;
    }

    strongClick(pin);
    log('Clicked: Pin to top');
    return true;
  }

  function findSaveNoteButton() {
    let el = findVisibleElements(SEL.saveNote)[0];
    if (el) return el;
    return findByText(['button', 'a'], 'Save Note');
  }

  async function addPinnedNote(noteInput) {
    const opened = await openNotePanel();
    if (!opened) return false;

    const filled = await fillNoteEditor(noteInput);
    if (!filled) log('Note editor value did not fully stick');
    else log('Filled note editor');

    const pin = findPinToTop();
    if (pin) {
      clickPinToTop(pin);
      await sleep(CFG.bigActionDelayMs);
    } else {
      log('Pin to top not found');
    }

    const saveBtn = findSaveNoteButton();
    if (!saveBtn) {
      log('Save Note button not found');
      return false;
    }

    strongClick(saveBtn);
    log('Clicked: Save Note');
    await sleep(CFG.noteSettleMs);
    return true;
  }

  function findTagOpener() {
    let el = findVisibleElements(SEL.tagOpener)[0];
    if (el) return el;

    const icon = Array.from(document.querySelectorAll('i.fal.fa-tag')).find(visible);
    if (icon) return icon.closest('a,button,[role="button"]');

    return null;
  }

  function findTagDropdown() {
    const form = findVisibleElements(SEL.tagForm)[0];
    if (form) {
      const exactCandidates = [
        '#add-tag-form > div > div > div.az-form-group.az-tags-select.mb-2 > div > button',
        'div.az-form-group.az-tags-select.mb-2 > div > button',
        '.az-form-group.az-tags-select button.dropdown-toggle.btn-light',
        'button.dropdown-toggle.btn-light[data-toggle="dropdown"][role="combobox"]',
        'button.dropdown-toggle.btn-light[role="combobox"]',
        'button[role="combobox"]',
        'button.dropdown-toggle'
      ];

      for (const selector of exactCandidates) {
        try {
          const el = selector.startsWith('#add-tag-form')
            ? document.querySelector(selector)
            : form.querySelector(selector);
          if (visible(el)) return el;
        } catch {}
      }
    }
    return null;
  }

  function findTagSelect(form) {
    if (!(form instanceof Element)) return null;
    const selects = Array.from(form.querySelectorAll('select'));
    if (!selects.length) return null;
    selects.sort((a, b) => ((b.options?.length || 0) - (a.options?.length || 0)));
    return selects[0] || null;
  }

  function getTagOptionLabel(option) {
    if (!(option instanceof HTMLOptionElement)) return '';
    return cleanTagText(option.textContent || option.label || '');
  }

  function valueForExactTagLabel(selectEl, label) {
    if (!(selectEl instanceof HTMLSelectElement)) return '';
    const wanted = lowerTagText(label);
    if (!wanted) return '';
    for (const option of Array.from(selectEl.options || [])) {
      if (option.disabled) continue;
      if (lowerTagText(getTagOptionLabel(option)) === wanted) {
        return norm(option.value || '');
      }
    }
    return '';
  }

  function optionLabelForValue(selectEl, value) {
    if (!(selectEl instanceof HTMLSelectElement)) return '';
    const wanted = norm(value);
    if (!wanted) return '';
    for (const option of Array.from(selectEl.options || [])) {
      if (norm(option.value || '') === wanted) return getTagOptionLabel(option);
    }
    return '';
  }

  function selectHasOptionValue(selectEl, value) {
    return !!optionLabelForValue(selectEl, value);
  }

  function getSelectedTagValues(selectEl) {
    if (!(selectEl instanceof HTMLSelectElement)) return [];
    const values = [];
    for (const option of Array.from(selectEl.options || [])) {
      if (!option.selected) continue;
      const value = norm(option.value || '');
      if (value) values.push(value);
    }
    return values;
  }

  function refreshTagSelectpicker(selectEl) {
    try {
      const $ = window.jQuery || window.$;
      if ($ && typeof $.fn?.selectpicker === 'function') {
        $(selectEl).selectpicker('refresh');
      }
    } catch {}
  }

  function mergeTagValues(selectEl, valuesToAdd) {
    if (!(selectEl instanceof HTMLSelectElement)) return false;
    const addSet = new Set((valuesToAdd || []).map((value) => norm(value)).filter(Boolean));
    if (!addSet.size) return false;

    const current = new Set(getSelectedTagValues(selectEl));
    let changed = false;

    for (const value of addSet) {
      if (!current.has(value)) changed = true;
      current.add(value);
    }

    for (const option of Array.from(selectEl.options || [])) {
      const value = norm(option.value || '');
      if (!value) continue;
      option.selected = current.has(value);
    }

    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    refreshTagSelectpicker(selectEl);
    return changed;
  }

  function getTagMenuItems(root = null) {
    const scope = root instanceof Element ? root : document;
    return Array.from(scope.querySelectorAll('.dropdown-item, a[id^="bs-select-"], li[role="option"], a[role="option"], [role="option"]'))
      .filter((el) => visible(el) && cleanTagText(el.textContent || ''));
  }

  function getTagPickerItemFromTarget(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('.dropdown-item, a[id^="bs-select-"], li[role="option"], a[role="option"], [role="option"]');
  }

  function buildTagTargetRecord(target) {
    const optionEl = getTagPickerItemFromTarget(target);
    if (!optionEl) return null;

    const labelNode = optionEl.querySelector('span.text, .text');
    const clickedLabel = cleanTagText(labelNode?.textContent || optionEl.textContent || '');
    if (!clickedLabel) return null;

    const form = optionEl.closest(SEL.tagForm) || findVisibleElements(SEL.tagForm)[0] || document.querySelector(SEL.tagForm);
    const selectEl = findTagSelect(form);
    if (!(selectEl instanceof HTMLSelectElement)) return null;

    const value = valueForExactTagLabel(selectEl, clickedLabel);
    if (!value) return null;

    return {
      label: clickedLabel,
      value,
      selector: buildStableSelector(optionEl),
      fingerprint: buildFingerprint(optionEl),
      savedAt: nowIso()
    };
  }

  function getTagDropdownMenu(dropdown) {
    if (!(dropdown instanceof Element)) return null;

    const owns = norm(dropdown.getAttribute('aria-owns') || dropdown.getAttribute('aria-controls') || '');
    if (owns) {
      const owned = document.getElementById(owns);
      if (owned) {
        const menu = owned.closest('.dropdown-menu');
        if (menu) return menu;
        return owned;
      }
    }

    const wrapper = dropdown.closest('.bootstrap-select, .dropdown, .btn-group, .az-tags-select');
    if (wrapper) {
      const menu = wrapper.querySelector('.dropdown-menu, .inner[role="listbox"], [role="listbox"]');
      if (menu) return menu;
    }

    return findVisibleElements('#add-tag-form .dropdown-menu, .bootstrap-select .dropdown-menu, .dropdown-menu').find(Boolean) || null;
  }

  function isTagDropdownOpen(dropdown) {
    if (!(dropdown instanceof Element)) return false;

    const expanded = String(dropdown.getAttribute('aria-expanded') || '').toLowerCase() === 'true';
    if (expanded) return true;

    const wrapper = dropdown.closest('.bootstrap-select, .dropdown, .btn-group');
    if (wrapper?.classList.contains('show')) return true;

    const menu = getTagDropdownMenu(dropdown);
    if (menu && visible(menu)) return true;

    return false;
  }

  function dispatchKeySequence(el, key) {
    if (!(el instanceof Element)) return;
    const view = el.ownerDocument?.defaultView || window;
    for (const type of ['keydown', 'keyup']) {
      try {
        el.dispatchEvent(new KeyboardEvent(type, {
          key,
          code: key === ' ' ? 'Space' : key,
          bubbles: true,
          cancelable: true,
          composed: true,
          view
        }));
      } catch {}
    }
  }

  function dispatchMouseBurst(el) {
    if (!(el instanceof Element)) return;
    const view = el.ownerDocument?.defaultView || window;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view
        }));
      } catch {}
    }
  }

  function getUnderlyingTagSelect(dropdown) {
    if (!(dropdown instanceof Element)) return null;
    const wrapper = dropdown.closest('.bootstrap-select, .dropdown, .btn-group, .az-tags-select');
    if (!wrapper) return null;
    return wrapper.querySelector('select') ||
      (wrapper.previousElementSibling instanceof HTMLSelectElement ? wrapper.previousElementSibling : null);
  }

  async function tryOpenTagDropdown(dropdown) {
    if (!(dropdown instanceof Element)) return false;
    if (isTagDropdownOpen(dropdown)) return true;

    const waitAfterAttempt = async () => {
      await sleep(450);
      return isTagDropdownOpen(dropdown);
    };

    try {
      dropdown.click();
      if (await waitAfterAttempt()) {
        log('Tag dropdown open method: direct click');
        return true;
      }
    } catch {}

    dispatchMouseBurst(dropdown);
    if (await waitAfterAttempt()) {
      log('Tag dropdown open method: mouse events');
      return true;
    }

    try {
      const $ = window.jQuery || window.$;
      if ($) {
        const jqDropdown = $(dropdown);
        if (typeof jqDropdown.dropdown === 'function') {
          jqDropdown.dropdown('toggle');
          if (await waitAfterAttempt()) {
            log('Tag dropdown open method: jQuery dropdown toggle');
            return true;
          }
        }

        const selectEl = getUnderlyingTagSelect(dropdown);
        const jqSelect = selectEl ? $(selectEl) : null;
        if (jqSelect?.length && typeof jqSelect.selectpicker === 'function') {
          jqSelect.selectpicker('toggle');
          if (await waitAfterAttempt()) {
            log('Tag dropdown open method: selectpicker toggle');
            return true;
          }
        }
      }
    } catch {}

    try { dropdown.focus({ preventScroll: true }); } catch {}
    dispatchKeySequence(dropdown, 'ArrowDown');
    if (await waitAfterAttempt()) {
      log('Tag dropdown open method: keyboard ArrowDown');
      return true;
    }

    return false;
  }

  async function openTagPanel() {
    const existingForm = findVisibleElements(SEL.tagForm)[0];
    if (existingForm) return existingForm;

    const opener = findTagOpener();
    if (!opener) {
      log('Tag opener not found');
      return null;
    }

    strongClick(opener);
    log('Clicked: Tag opener');
    await sleep(CFG.bigActionDelayMs);

    const tagForm = await waitFor(() => findVisibleElements(SEL.tagForm)[0], 3000);
    if (!tagForm) {
      log('Tag form not visible after opening tag panel');
      return null;
    }

    return tagForm;
  }

  function maybeTagAlreadyPresent(targetRecord) {
    const label = lowerTagText(targetRecord?.label || '');
    if (!label) return false;
    return getOpenTicketInfo().tags.some((tag) => lowerTagText(tag) === label);
  }

  function getOpenTicketTagLabels() {
    return Array.from(new Set(
      (getOpenTicketInfo().tags || [])
        .map((tag) => cleanTagText(tag))
        .filter(Boolean)
    ));
  }

  function findTagMenuItemByLabel(label, root = null) {
    const wanted = lowerTagText(label);
    if (!wanted) return null;
    const items = getTagMenuItems(root);
    for (const item of items) {
      const text = lowerTagText(item.textContent || '');
      if (text === wanted) return item;
    }
    for (const item of items) {
      const text = lowerTagText(item.textContent || '');
      if (text.includes(wanted) || wanted.includes(text)) return item;
    }
    return null;
  }

  function resolveTagValuesByLabels(selectEl, labels) {
    const values = [];
    const missingLabels = [];
    const seen = new Set();
    for (const label of Array.isArray(labels) ? labels : []) {
      const cleanLabel = cleanTagText(label);
      if (!cleanLabel) continue;
      const value = valueForExactTagLabel(selectEl, cleanLabel);
      if (!value) {
        missingLabels.push(cleanLabel);
        continue;
      }
      if (seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
    return { values, missingLabels };
  }

  function setSelectedTagValues(selectEl, values) {
    if (!(selectEl instanceof HTMLSelectElement)) return false;
    const wanted = Array.from(new Set((values || []).map((value) => norm(value)).filter(Boolean)));
    const wantedSet = new Set(wanted);
    const current = getSelectedTagValues(selectEl);
    const currentSet = new Set(current);
    const changed = currentSet.size !== wantedSet.size || wanted.some((value) => !currentSet.has(value));

    for (const option of Array.from(selectEl.options || [])) {
      const value = norm(option.value || '');
      if (!value) continue;
      option.selected = wantedSet.has(value);
    }

    try {
      const $ = window.jQuery || window.$;
      if ($ && typeof $.fn?.selectpicker === 'function') {
        $(selectEl).selectpicker('val', wanted);
      }
    } catch {}

    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    refreshTagSelectpicker(selectEl);
    return changed;
  }

  function resolveStoredTagValue(selectEl, kind, record) {
    if (!(selectEl instanceof HTMLSelectElement) || !isPlainObject(record)) {
      return { value: '', label: cleanTagText(record?.label || '') };
    }

    const label = cleanTagText(record.label || '');
    if (label) {
      const resolvedValue = valueForExactTagLabel(selectEl, label);
      if (resolvedValue) {
        const targets = getTagTargets();
        targets[kind] = {
          ...record,
          label,
          value: resolvedValue,
          savedAt: record.savedAt || nowIso()
        };
        saveTargets(GM_KEYS.tagTargets, targets);
        return { value: resolvedValue, label };
      }
    }

    const directValue = norm(record.value || '');
    if (directValue && selectHasOptionValue(selectEl, directValue)) {
      return {
        value: directValue,
        label: cleanTagText(record.label || optionLabelForValue(selectEl, directValue))
      };
    }

    return { value: '', label };
  }

  async function applyStoredTagTarget(kind, tagForm = null) {
    const targets = getTagTargets();
    const record = targets[kind];
    if (!isPlainObject(record)) {
      log(`Saved tag target missing: ${kind}`);
      return false;
    }

    if (maybeTagAlreadyPresent(record)) {
      log(`Tag already present: ${record.label || kind}`);
      return true;
    }

    const form = (tagForm instanceof Element ? tagForm : findVisibleElements(SEL.tagForm)[0]) || await waitFor(() => findVisibleElements(SEL.tagForm)[0], 3000);
    if (!(form instanceof Element)) {
      log('Tag form not available for tag selection');
      return false;
    }

    const dropdown = findTagDropdown();
    if (!(dropdown instanceof Element)) {
      log('Tag dropdown not found');
      return false;
    }

    const dropdownOpen = await tryOpenTagDropdown(dropdown);
    if (!dropdownOpen) {
      log('Tag dropdown did not open');
      return false;
    }

    const selectEl = findTagSelect(form);
    if (!(selectEl instanceof HTMLSelectElement)) {
      log('Tag select not found in tag form');
      return false;
    }

    const resolved = resolveStoredTagValue(selectEl, kind, record);
    if (!resolved.value) {
      log(`Stored tag value missing for ${record.label || kind}`);
      return false;
    }

    const openTagLabels = getOpenTicketTagLabels();
    const preserveInfo = resolveTagValuesByLabels(
      selectEl,
      openTagLabels.filter((label) => lowerTagText(label) !== lowerTagText(resolved.label || record.label || ''))
    );
    if (preserveInfo.missingLabels.length) {
      log(`Could not map current ticket tags in selector: ${preserveInfo.missingLabels.join(', ')}`);
    }

    const nextValues = [
      ...getSelectedTagValues(selectEl),
      ...preserveInfo.values,
      resolved.value
    ];
    setSelectedTagValues(selectEl, nextValues);
    log(`Applied tag selection: ${resolved.label || kind}`);
    await sleep(CFG.bigActionDelayMs);
    return true;
  }

  function findTagApplyButton() {
    const candidates = Array.from(document.querySelectorAll('button,a,[role="button"]')).filter(visible);
    return candidates.find((el) => {
      const text = lower(el.textContent || '');
      if (!text) return false;
      if (text.includes('save note')) return false;
      return text.includes('apply') || text === 'save' || text === 'done';
    }) || null;
  }

  async function maybeClickTagApplyButton() {
    const button = findTagApplyButton();
    if (!button) {
      log('No tag apply button detected, continuing');
      return true;
    }

    strongClick(button);
    log(`Clicked tag apply button: ${norm(button.textContent || '') || 'button'}`);
    await sleep(CFG.actionSettleMs);
    return true;
  }

  function fireEscape() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true
      }));
      document.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true
      }));
    } catch {}
  }

  function getDockRootTicketId(root) {
    if (!(root instanceof Element)) return '';
    const syncNode = root.querySelector(SEL.vendorSync);
    return extractTicketIdFromText(syncNode?.textContent || '') || extractTicketIdFromText(root.textContent || '');
  }

  function getTicketDockRoots() {
    const roots = [
      document.querySelector('#serviceDetailDock'),
      document.querySelector('#notePanelContainer'),
      getOpenDockRoot(),
      ...Array.from(document.querySelectorAll('.az-dock'))
    ].filter((root, index, list) => root instanceof Element && list.indexOf(root) === index);

    return roots.filter((root) => visible(root) || root.querySelector('.az-dock__close'));
  }

  function getTicketDockRoot(ticketId = '') {
    const wantedId = norm(ticketId || '');
    const roots = getTicketDockRoots();
    if (wantedId) {
      const exact = roots.find((root) => getDockRootTicketId(root) === wantedId);
      if (exact) return exact;
    }
    return roots.find((root) => root.id === 'serviceDetailDock') || roots[0] || null;
  }

  function isTicketDockClosed(ticketId = '') {
    const wantedId = norm(ticketId || '');
    const root = getTicketDockRoot(wantedId);
    if (!root || !visible(root)) return true;

    const info = getOpenTicketInfo({ fallbackTicketId: wantedId });
    const openId = norm(info.ticketId || '');
    if (!openId) return true;
    if (wantedId && openId !== wantedId) return true;

    return false;
  }

  function findDockCloseButton(ticketId = '') {
    const preferredRoot = getTicketDockRoot(ticketId);
    if (preferredRoot) {
      const scoped = Array.from(preferredRoot.querySelectorAll('.az-dock__close')).find(visible);
      if (scoped) return scoped;
    }

    const exact = findVisibleElements(SEL.dockClose)[0];
    if (exact) return exact;

    for (const root of getTicketDockRoots()) {
      const found = Array.from(root.querySelectorAll('.az-dock__close')).find(visible);
      if (found) return found;
    }

    return null;
  }

  async function closeTicketDockAtEnd(ticketId = '') {
    const wantedId = norm(ticketId || '');
    if (isTicketDockClosed(wantedId)) {
      log(`Ticket drawer already closed${wantedId ? ` | ${wantedId}` : ''}`);
      return true;
    }

    for (let attempt = 1; attempt <= CFG.closeAttempts; attempt += 1) {
      const button = findDockCloseButton(wantedId);
      const root = getTicketDockRoot(wantedId);
      const rootLabel = root?.id || root?.className || 'dock';

      if (button) {
        strongClick(button);
        log(`Clicked: Ticket close | attempt ${attempt} | root ${norm(rootLabel) || 'dock'}`);
      } else {
        log(`Ticket close button not found | attempt ${attempt} | sending Escape`);
        fireEscape();
      }

      const closed = await waitFor(() => isTicketDockClosed(wantedId), CFG.closeWaitMs);
      if (closed) {
        log(`Ticket drawer closed${wantedId ? ` | ${wantedId}` : ''}`);
        return true;
      }

      fireEscape();
      const closedAfterEscape = await waitFor(() => isTicketDockClosed(wantedId), 1200);
      if (closedAfterEscape) {
        log(`Ticket drawer closed with Escape${wantedId ? ` | ${wantedId}` : ''}`);
        return true;
      }

      await sleep(CFG.closeRetryMs);
    }

    log(`Ticket drawer did not close after ${CFG.closeAttempts} attempts${wantedId ? ` | ${wantedId}` : ''}`);
    return false;
  }

  function computeRunRecord(runs, azId) {
    return isPlainObject(runs[azId]) ? deepClone(runs[azId]) : {};
  }

  function getRunRecordProgressMs(record) {
    if (!isPlainObject(record)) return 0;
    const keys = ['fieldsUpdatedAt', 'noteSavedAt', 'tagAppliedAt', 'closeBlockedAt', 'closeFailedAt', 'completedAt'];
    let newest = 0;
    for (const key of keys) {
      const ms = Date.parse(norm(record[key] || ''));
      if (Number.isFinite(ms) && ms > newest) newest = ms;
    }
    return newest;
  }

  function hasRunRecordProgress(record) {
    return getRunRecordProgressMs(record) > 0;
  }

  function isRunRecordFromCurrentOpen(record, azId) {
    const cleanAzId = norm(azId || '');
    const openedMs = state.openTicketId === cleanAzId ? Number(state.openTicketOpenedAt || 0) : 0;
    const progressMs = getRunRecordProgressMs(record);
    return !!(openedMs && progressMs && progressMs >= (openedMs - 1000));
  }

  function saveRunRecord(runs, azId, record) {
    runs[azId] = deepClone(record);
    saveRuns(runs);
  }

  function evaluateFinishCloseGate({ data, finalPayload, missingPayloadTriggerKey, forceRun }) {
    const cleanAzId = norm(data?.azId || '');
    const openTicket = getOpenTicketInfo({ fallbackTicketId: data?.missingPayloadFallback ? cleanAzId : '' });
    const openId = norm(openTicket.ticketId || '');
    const now = Date.now();

    if (!cleanAzId) {
      return { allowed: false, reason: 'AZ ID missing from workflow data', status: 'Close blocked: missing AZ ID', stopLoop: true };
    }

    if (!openId) {
      return { allowed: false, reason: 'no open ticket drawer is available', status: 'Close blocked: no open ticket' };
    }

    if (openId !== cleanAzId) {
      return { allowed: false, reason: `open ticket ${openId} does not match workflow AZ ${cleanAzId}`, status: 'Close blocked: ticket changed' };
    }

    const openAgeMs = state.openTicketId === cleanAzId && state.openTicketOpenedAt
      ? now - state.openTicketOpenedAt
      : Number.POSITIVE_INFINITY;
    if (openAgeMs < CFG.minTicketOpenBeforeCloseMs) {
      return {
        allowed: false,
        reason: `ticket was just opened ${Math.round(openAgeMs / 1000)}s ago`,
        status: 'Close blocked: ticket just opened'
      };
    }

    const mainAgeMs = state.lastMainClickedTicketId === cleanAzId && state.lastMainClickedAt
      ? now - state.lastMainClickedAt
      : Number.POSITIVE_INFINITY;
    if (mainAgeMs < CFG.minMainClickBeforeCloseMs) {
      return {
        allowed: false,
        reason: `Main tab was just clicked ${Math.round(mainAgeMs / 1000)}s ago`,
        status: 'Close blocked: Main just clicked'
      };
    }

    if (forceRun) {
      return { allowed: true, reason: 'manual force run requested' };
    }

    if (data?.missingPayloadFallback) {
      if (norm(missingPayloadTriggerKey || '')) {
        return { allowed: true, reason: `confirmed failed/missing payload path (${missingPayloadTriggerKey})` };
      }
      return {
        allowed: false,
        reason: 'missing payload fallback has no current launcher trigger key',
        status: 'Close blocked: missing launcher failure trigger',
        stopLoop: true
      };
    }

    if (!isPlainObject(finalPayload)) {
      return {
        allowed: false,
        reason: 'final payload object missing at close gate',
        status: 'Close blocked: final payload missing',
        stopLoop: true
      };
    }

    if (norm(finalPayload.azId || '') !== cleanAzId) {
      return {
        allowed: false,
        reason: `final payload belongs to ${norm(finalPayload.azId || '') || '(blank)'}`,
        status: 'Close blocked: payload mismatch',
        stopLoop: true
      };
    }

    const payloadSavedMs = Number(finalPayload.payloadSavedMs || 0);

    return {
      allowed: true,
      reason: payloadSavedMs
        ? `final payload confirmed | payload=${new Date(payloadSavedMs).toISOString()}`
        : 'final payload confirmed for matching AZ ID'
    };
  }

  async function fillTicketFields(data, runRecord, forceRun) {
    const targets = getFieldTargets();
    let changed = false;

    for (const label of FIELD_ORDER) {
      const rawValue = norm(data.fields[label] || '');
      const value = formatFieldValue(label, rawValue);
      if (!value) {
        log(`Skipped blank field: ${label}`);
        await sleep(CFG.bigActionDelayMs);
        continue;
      }
      const result = await setFieldValue(targets[label], value);
      if (result.ok) {
        log(`Filled field: ${label} = ${value || '(blank)'}${rawValue && rawValue !== value ? ` (from ${rawValue})` : ''}`);
        changed = true;
      } else {
        log(`Field failed: ${label} | ${result.reason} | wanted ${value || '(blank)'}`);
      }
      await sleep(CFG.bigActionDelayMs);
    }

    const updateOk = await clickUpdateButton();
    if (!updateOk) {
      log('Update step failed, continuing');
    }

    if (changed || updateOk || forceRun) {
      runRecord.fieldsUpdatedAt = nowIso();
    }
  }

  async function runWorkflow(options = {}) {
    const {
      forceRun = false,
      finalPayload = null,
      fallbackTicketId = '',
      fallbackReason = '',
      runTicketId = '',
      missingPayloadTriggerKey = ''
    } = options;

    const data = finalPayload
      ? extractWorkflowData(finalPayload)
      : buildMissingPayloadWorkflowData(fallbackTicketId, fallbackReason);

    if (!data.azId) {
      setStatus('Payload missing');
      return;
    }

    state.activeAzId = data.azId;
    const sourceSignature = `${data.sources.home}`;
    if (state.lastPayloadSourceSignature !== sourceSignature) {
      state.lastPayloadSourceSignature = sourceSignature;
      log(`Payload source | Home=${data.sources.home}`);
    }

    if (!data.missingPayloadFallback && !hasAllFieldTargets()) {
      setStatus('Field setup required');
      return;
    }
    if (!hasAllTagTargets()) {
      setStatus('Tag setup required');
      return;
    }

    const openTicket = getOpenTicketInfo({ fallbackTicketId: data.missingPayloadFallback ? data.azId : '' });
    if (!openTicket.ticketId) {
      setStatus('Waiting for open ticket');
      return;
    }
    if (data.azId && openTicket.ticketId !== data.azId) {
      setStatus(`Waiting for ticket ${data.azId}`);
      return;
    }

    const runs = readRuns();
    const priorRunRecord = computeRunRecord(runs, data.azId);
    const runRecord = isRunRecordFromCurrentOpen(priorRunRecord, data.azId) ? priorRunRecord : {};
    if (!forceRun && hasRunRecordProgress(priorRunRecord) && runRecord !== priorRunRecord) {
      log(`Previous run history found for AZ ${data.azId}; ignoring stored dedupe and running fresh`);
    } else if (!forceRun && hasRunRecordProgress(runRecord)) {
      log(`Continuing current open-ticket finisher attempt for AZ ${data.azId}; old dedupe still ignored`);
    }
    const normalizedFields = getNormalizedWorkflowFields(data.fields);
    const fieldSignature = JSON.stringify(normalizedFields);
    const hasFieldValues = Object.keys(normalizedFields).length > 0;
    const targetKey = data.chooseSuccessfulTag ? 'successfulTag' : 'failedTag';
    const targetSignature = getTagTargetSignature(targetKey);
    const targetLabel = data.chooseSuccessfulTag ? 'Successful Quote' : 'Failed Quote';
    const missingPayloadRunKey = data.missingPayloadFallback
      ? norm(missingPayloadTriggerKey || `missing-payload|${data.azId}|${data.sources.home || ''}`)
      : '';
    const mustRunMissingPayloadNote = !!(
      data.missingPayloadFallback
      && missingPayloadRunKey
      && norm(runRecord.missingPayloadNoteTriggerKey || '') !== missingPayloadRunKey
    );
    const mustRunMissingPayloadTag = !!(
      data.missingPayloadFallback
      && missingPayloadRunKey
      && norm(runRecord.missingPayloadTagTriggerKey || '') !== missingPayloadRunKey
    );
    const tagMatchesCurrentTarget = runRecordMatchesTagTarget(runRecord, targetKey, targetSignature);
    const mustRunCurrentTag = forceRun || mustRunMissingPayloadTag || !tagMatchesCurrentTarget;
    state.busy = true;
    renderAll();
    setStatus(forceRun ? 'Force running' : 'Running finisher');
    log(`Running finisher for AZ ${data.azId}${forceRun ? ' (force)' : ''}`);

    try {
      const mainOk = await ensureMainTab();
      if (!mainOk) {
        setStatus('Main tab failed');
        return;
      }
      await sleep(CFG.bigActionDelayMs);

      if (data.missingPayloadFallback) {
        log(`Missing payload fallback active for AZ ${data.azId}`);
      }

      if (hasFieldValues && (forceRun || runRecord.fieldsSignature !== fieldSignature || !runRecord.fieldsUpdatedAt)) {
        await fillTicketFields(data, runRecord, forceRun);
        runRecord.fieldsSignature = fieldSignature;
        saveRunRecord(runs, data.azId, runRecord);
      } else if (!hasFieldValues) {
        if (!runRecord.fieldsUpdatedAt) {
          runRecord.fieldsUpdatedAt = nowIso();
          runRecord.fieldsSignature = fieldSignature;
          saveRunRecord(runs, data.azId, runRecord);
        }
        log(`No Main field values available for AZ ${data.azId}; continuing with note/tag flow`);
      } else {
        log('Main fields already match current payload, skipping field fill');
      }

      if (forceRun || mustRunMissingPayloadNote || !runRecord.noteSavedAt) {
        if (data.missingPayloadFallback) {
          log(`Note data | Missing payload failure${mustRunMissingPayloadNote ? ' | forcing failed note for current trigger' : ''}`);
        } else {
          log(`Note data | Home Submission=${data.note.homeSubmission || '(blank)'} | Account=${data.note.accountNumber || '(blank)'} | Done=${data.note.doneValue || '(blank)'}`);
        }
        const noteOk = await addPinnedNote(data.note);
        if (noteOk) {
          runRecord.noteSavedAt = nowIso();
          if (data.missingPayloadFallback && missingPayloadRunKey) {
            runRecord.missingPayloadNoteTriggerKey = missingPayloadRunKey;
          }
          saveRunRecord(runs, data.azId, runRecord);
          log('Pinned note saved');
        } else {
          log('Pinned note step failed');
        }
      } else {
        log('Pinned note already saved for this AZ ID, skipping note step');
      }

      if (mustRunCurrentTag) {
        if (runRecord.tagAppliedAt && !tagMatchesCurrentTarget && !mustRunMissingPayloadTag) {
          log(`Stored tag state is stale for AZ ${data.azId}; applying ${targetLabel}`);
        }
        const tagForm = await openTagPanel();
        if (tagForm) {
          const tagOk = await applyStoredTagTarget(targetKey, tagForm);
          if (tagOk) {
            await maybeClickTagApplyButton();
            runRecord.tagAppliedAt = nowIso();
            runRecord.tagTargetKey = targetKey;
            runRecord.tagTargetSignature = targetSignature;
            if (data.missingPayloadFallback && missingPayloadRunKey) {
              runRecord.missingPayloadTagTriggerKey = missingPayloadRunKey;
            }
            saveRunRecord(runs, data.azId, runRecord);
            log(`Applied tag: ${targetLabel}${data.missingPayloadFallback ? ' (missing payload)' : ''} | AZ ${data.azId}`);
          } else {
            log('Tag selection failed');
          }
        }
      } else {
        log(`Tag already applied for this AZ ID and current result (${targetLabel}), skipping tag step`);
      }

      const noteComplete = !!runRecord.noteSavedAt && (
        !data.missingPayloadFallback
        || !missingPayloadRunKey
        || norm(runRecord.missingPayloadNoteTriggerKey || '') === missingPayloadRunKey
      );
      const tagComplete = runRecordMatchesTagTarget(runRecord, targetKey, targetSignature) && (
        !data.missingPayloadFallback
        || !missingPayloadRunKey
        || norm(runRecord.missingPayloadTagTriggerKey || '') === missingPayloadRunKey
      );

      if (runRecord.fieldsUpdatedAt && noteComplete && tagComplete) {
        const closeGate = evaluateFinishCloseGate({ data, finalPayload, missingPayloadTriggerKey, forceRun });
        if (!closeGate.allowed) {
          runRecord.closeBlockedAt = nowIso();
          runRecord.closeBlockedReason = closeGate.reason;
          saveRunRecord(runs, data.azId, runRecord);
          setStatus(closeGate.status || 'Close blocked');
          log(`Close blocked for AZ ${data.azId}: ${closeGate.reason}`);
          if (closeGate.stopLoop) {
            state.running = false;
            saveRunning(false);
            setStatus('Stopped: missing launcher data');
            log(`Finisher stopped for AZ ${data.azId}: required launcher/final data missing or stale`);
          }
          return;
        }

        log(`Close allowed for AZ ${data.azId}: ${closeGate.reason}`);
        setStatus('Closing ticket');
        await sleep(CFG.actionSettleMs);

        const closeOk = await closeTicketDockAtEnd(data.azId);
        if (!closeOk) {
          runRecord.closeFailedAt = nowIso();
          saveRunRecord(runs, data.azId, runRecord);
          setStatus('Close failed');
          log(`Ticket close failed for AZ ${data.azId}; will retry`);
          return;
        }

        delete runRecord.closeFailedAt;
        delete runRecord.closeBlockedAt;
        delete runRecord.closeBlockedReason;
        runRecord.completedAt = nowIso();
        runRecord.payloadSavedAt = data.payloadSavedAt;
        if (data.missingPayloadFallback) {
          runRecord.missingPayloadFallback = true;
          if (missingPayloadRunKey) runRecord.missingPayloadCompletedTriggerKey = missingPayloadRunKey;
        }
        saveRunRecord(runs, data.azId, runRecord);
        markFrontRunCompleted(runTicketId || data.azId);
        clearSharedRuntimeForAz(data.azId, {
          reason: data.missingPayloadFallback ? 'finisher completed after missing payload fallback' : 'finisher completed',
          publishAltaRequest: true
        });
        sendTicketClosedSignal(data.azId);
        requestWorkflowCleanup(data.azId);
        setStatus('Completed');
        log(`Ticket finishing complete for AZ ${data.azId}`);
      } else {
        setStatus('Partial completion');
      }
    } finally {
      state.busy = false;
      state.forceRunRequested = false;
      renderAll();
    }
  }

  function tick() {
    syncFrontSession();

    if (state.destroyed || state.busy || state.picker) {
      renderAll();
      return;
    }

    const wakeMissingPayloadTrigger = !state.running ? getActiveMissingPayloadTrigger() : null;
    if (!state.running) {
      if (wakeMissingPayloadTrigger) {
        state.running = true;
        saveRunning(true);
        setStatus('Resuming for direct failed path');
        log(`Direct missing payload trigger auto-resumed finisher | AZ ${wakeMissingPayloadTrigger.ticketId}`);
      } else {
        setStatus('Stopped');
        renderAll();
        return;
      }
    }

    const detectedOpenTicket = getOpenTicketInfo();
    const missingPayloadTrigger = getActiveMissingPayloadTrigger(detectedOpenTicket.ticketId);
    const openTicket = applyOpenTicketFallback(detectedOpenTicket, missingPayloadTrigger?.ticketId || '');
    if (openTicket.inferredTicketId && openTicket.root) {
      const fallbackKey = `trigger|${openTicket.ticketId}`;
      if (state.lastOpenTicketFallbackKey !== fallbackKey) {
        state.lastOpenTicketFallbackKey = fallbackKey;
        log(`Open ticket ID not readable from dock; using direct failed-path AZ ${openTicket.ticketId} for the current open ticket`);
      }
    } else {
      state.lastOpenTicketFallbackKey = '';
    }
    updateOpenTicketTracking(openTicket);
    const finalPayload = missingPayloadTrigger ? null : getFinalPayload();
    const mismatchWait = missingPayloadTrigger
      ? { active: false, ready: false }
      : getWaitingTicketMismatchState(openTicket.ticketId, finalPayload?.azId || '');
    const rejectedFinalPayload = missingPayloadTrigger || finalPayload
      ? { active: false, ready: false }
      : getRejectedFinalPayloadState(openTicket.ticketId);
    const launcherDataMissing = missingPayloadTrigger || finalPayload || rejectedFinalPayload.active
      ? { active: false, ready: false }
      : getLauncherDataMissingState(openTicket.ticketId);
    let workflowPayload = finalPayload;
    let mismatchMissingPayloadTriggerKey = '';
    let fallbackTicketId = missingPayloadTrigger
      ? (missingPayloadTrigger.ticketId || openTicket.ticketId)
      : (state.forceRunRequested && !finalPayload && !!openTicket.ticketId ? openTicket.ticketId : '');

    if (missingPayloadTrigger) {
      resetWaitingTicketMismatch();
      if (state.lastMissingPayloadTriggerLogKey !== missingPayloadTrigger.triggerKey) {
        state.lastMissingPayloadTriggerLogKey = missingPayloadTrigger.triggerKey;
        log(`Direct missing payload fallback trigger received | AZ ${missingPayloadTrigger.ticketId} | reason=${norm(missingPayloadTrigger.reason || 'MAIN/PAYLOAD FAILED') || 'MAIN/PAYLOAD FAILED'}`);
      }
    } else if (mismatchWait.active && !mismatchWait.ready) {
      const targetLabel = mismatchWait.targetTicketId ? `ticket ${mismatchWait.targetTicketId}` : 'final Home payload';
      setStatus(`Waiting for matching Home payload (${targetLabel} currently mirrored; ${Math.ceil(mismatchWait.remainingMs / 1000)}s before failed path)`);
      renderAll();
      return;
    } else if (mismatchWait.active && mismatchWait.ready) {
      workflowPayload = null;
      fallbackTicketId = mismatchWait.openTicketId || openTicket.ticketId;
      mismatchMissingPayloadTriggerKey = `payload-mismatch|${fallbackTicketId}|mirrored-${mismatchWait.targetTicketId}|front-session-${state.frontSession}`;
    } else if (rejectedFinalPayload.active && !rejectedFinalPayload.ready) {
      setStatus(`Rejected stale final payload (${Math.ceil(rejectedFinalPayload.remainingMs / 1000)}s before failed path)`);
      renderAll();
      return;
    } else if (rejectedFinalPayload.active && rejectedFinalPayload.ready) {
      workflowPayload = null;
      fallbackTicketId = rejectedFinalPayload.openTicketId || openTicket.ticketId;
      mismatchMissingPayloadTriggerKey = `rejected-final-payload|${fallbackTicketId}|${norm(rejectedFinalPayload.reason || 'stale-final')}`;
    } else if (launcherDataMissing.active && !launcherDataMissing.ready) {
      setStatus(`Waiting for launcher data (${Math.ceil(launcherDataMissing.remainingMs / 1000)}s before failed path)`);
      renderAll();
      return;
    } else if (launcherDataMissing.active && launcherDataMissing.ready) {
      workflowPayload = null;
      fallbackTicketId = launcherDataMissing.openTicketId || openTicket.ticketId;
      mismatchMissingPayloadTriggerKey = `missing-launcher-data|${fallbackTicketId}|front-session-${state.frontSession}`;
    }

    if (!missingPayloadTrigger && (!openTicket.ticketId || (finalPayload && openTicket.ticketId === norm(finalPayload.azId || '')))) {
      resetWaitingTicketMismatch();
    }

    const fallbackMissingPayload = !workflowPayload && !!fallbackTicketId;
    const effectiveAzId = norm(workflowPayload?.azId || fallbackTicketId || openTicket.ticketId || '');

    state.activeAzId = effectiveAzId;

    if (!openTicket.ticketId && !finalPayload) {
      resetWaitingTicketMismatch();
      setStatus('Waiting for open ticket');
      renderAll();
      return;
    }

    if (!workflowPayload && !fallbackMissingPayload && !missingPayloadTrigger && !state.forceRunRequested) {
      setStatus(openTicket.ticketId ? 'Waiting for final Home payload' : 'Waiting for open ticket');
      renderAll();
      return;
    }

    if (!fallbackMissingPayload && !hasAllFieldTargets()) {
      setStatus('Field setup required');
      renderAll();
      return;
    }

    if (!hasAllTagTargets()) {
      setStatus('Tag setup required');
      renderAll();
      return;
    }

    if (!openTicket.ticketId) {
      resetWaitingTicketMismatch();
      setStatus('Waiting for open ticket');
      renderAll();
      return;
    }

    const currentFrontRunTicketId = norm(openTicket.ticketId || effectiveAzId || '');
    const completedThisFrontSession = hasCompletedFrontRun(currentFrontRunTicketId);
    if (completedThisFrontSession && !state.forceRunRequested) {
      log(`Current front-session completion exists for ${currentFrontRunTicketId}; ignoring dedupe because rerun-on-open is enabled`);
    }

    const payloadKey = workflowPayload?.payloadKey || (
      missingPayloadTrigger
        ? `missing-payload-trigger|${missingPayloadTrigger.triggerKey}`
        : `missing-payload|${fallbackTicketId || openTicket.ticketId}`
    );
    const shouldRun = true;
    if (shouldRun) {
      state.lastPayloadSeenKey = payloadKey;
      runWorkflow({
        forceRun: state.forceRunRequested,
        finalPayload: workflowPayload,
        fallbackTicketId: fallbackMissingPayload ? (fallbackTicketId || openTicket.ticketId) : '',
        fallbackReason: missingPayloadTrigger?.reason || rejectedFinalPayload.reason || (launcherDataMissing.ready ? 'MISSING LAUNCHER DATA' : ''),
        runTicketId: currentFrontRunTicketId,
        missingPayloadTriggerKey: missingPayloadTrigger?.triggerKey || mismatchMissingPayloadTriggerKey || ''
      }).catch((err) => {
        log(`Workflow failed: ${err?.message || err}`);
        setStatus('Workflow failed');
        state.busy = false;
        state.forceRunRequested = false;
        renderAll();
      });
    }

    renderAll();
  }

  function ensureHoverBox() {
    if (state.hoverBox) return;
    const box = document.createElement('div');
    box.setAttribute(UI_ATTR, '1');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: String(CFG.zIndex),
      pointerEvents: 'none',
      border: '2px solid rgba(248,113,113,0.95)',
      background: 'rgba(252,165,165,0.16)',
      borderRadius: '6px',
      display: 'none'
    });
    document.documentElement.appendChild(box);
    state.hoverBox = box;
  }

  function isUiElement(el) {
    return !!(el instanceof Element && el.closest(`[${UI_ATTR}="1"]`));
  }

  function getSelectableTargetFromPath(path) {
    for (const item of path || []) {
      if (item instanceof Element && !isUiElement(item) && visible(item)) {
        return item;
      }
    }
    return null;
  }

  function updateHoverBox(target) {
    if (!state.hoverBox) return;
    if (!target || !(target instanceof Element)) {
      state.hoverBox.style.display = 'none';
      return;
    }

    const rect = target.getBoundingClientRect();
    state.hoverBox.style.display = 'block';
    state.hoverBox.style.left = `${rect.left}px`;
    state.hoverBox.style.top = `${rect.top}px`;
    state.hoverBox.style.width = `${rect.width}px`;
    state.hoverBox.style.height = `${rect.height}px`;
  }

  function startPicker(type, options = {}) {
    if (state.busy || state.picker) return;

    if (type === 'tags') {
      const existing = getTagTargets();
      if (isPlainObject(existing) && Object.prototype.hasOwnProperty.call(existing, 'tagDropdown')) {
        delete existing.tagDropdown;
        saveTargets(GM_KEYS.tagTargets, existing);
      }
    }

    const fieldLabels = Array.isArray(options.fieldLabels) && options.fieldLabels.length
      ? options.fieldLabels
      : FIELD_ORDER;

    state.picker = {
      type,
      items: type === 'fields' ? fieldLabels.map((label) => ({ key: label, label })) : TAG_ORDER.map((item) => deepClone(item)),
      index: 0,
      primerPending: type === 'tags'
    };

    ensureHoverBox();
    state.pickerMove = (event) => {
      const target = getSelectableTargetFromPath(event.composedPath ? event.composedPath() : [event.target]);
      state.hoveredEl = target;
      updateHoverBox(target);
    };

    state.pickerClick = (event) => {
      const target = getSelectableTargetFromPath(event.composedPath ? event.composedPath() : [event.target]);
      if (!target) return;
      if (state.picker?.type === 'tags' && state.picker?.primerPending) {
        state.picker.primerPending = false;
        const current = state.picker.items[state.picker.index];
        setStatus(`Picker: click ${current.label}`);
        log(`First click ignored by design. Now click ${current.label}`);
        renderAll();
        return;
      }
      if (state.picker?.type !== 'tags') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      handlePickerSelection(target);
    };

    state.pickerKeydown = (event) => {
      if (event.key === 'Escape') {
        stopPicker('Picker canceled');
      }
    };

    document.addEventListener('mousemove', state.pickerMove, true);
    document.addEventListener('keydown', state.pickerKeydown, true);

    if (type === 'tags') {
      setTimeout(() => {
        if (!state.picker) return;
        document.addEventListener('click', state.pickerClick, true);
      }, 0);
    } else {
      document.addEventListener('click', state.pickerClick, true);
    }

    const current = state.picker.items[state.picker.index];
    if (type === 'tags') {
      setStatus(`Picker: click ${current.label}`);
      log(`Tag picker started: first click ignored without blocking. Use it to open tags, then click ${current.label}`);
    } else {
      setStatus(`Picker: click ${current.label}`);
      log(`Picker started: click ${current.label}`);
    }
    renderAll();
  }

  function startMissingFieldPicker() {
    const missing = getMissingFieldTargetLabels();
    if (!missing.length) {
      log('No missing field targets to add');
      setStatus('Field targets already saved');
      renderAll();
      return;
    }

    log(`Adding missing field targets: ${missing.join(', ')}`);
    startPicker('fields', { fieldLabels: missing });
  }

  function stopPicker(message, logIt = true) {
    if (!state.picker) return;

    document.removeEventListener('mousemove', state.pickerMove, true);
    document.removeEventListener('click', state.pickerPrimerClick, true);
    document.removeEventListener('click', state.pickerClick, true);
    document.removeEventListener('keydown', state.pickerKeydown, true);
    state.pickerMove = null;
    state.pickerPrimerClick = null;
    state.pickerClick = null;
    state.pickerKeydown = null;
    state.picker = null;
    state.hoveredEl = null;
    updateHoverBox(null);

    if (logIt && message) log(message);
    setStatus(state.running ? 'Waiting for mirrored payload' : 'Stopped');
    renderAll();
  }

  function handlePickerSelection(target) {
    if (!state.picker) return;
    const item = state.picker.items[state.picker.index];
    if (state.picker.type === 'fields') {
      const selector = buildStableSelector(target);
      if (!selector) {
        log('Picker failed: could not build stable selector');
        return;
      }

      const record = {
        selector,
        fingerprint: buildFingerprint(target),
        label: norm(target.innerText || target.textContent || '') || item.label,
        savedAt: nowIso()
      };

      const targets = getFieldTargets();
      targets[item.key] = record;
      saveTargets(GM_KEYS.fieldTargets, targets);
    } else {
      const record = buildTagTargetRecord(target);
      if (!record) {
        log('Picker failed: click the real tag option in the open dropdown');
        return;
      }
      const targets = getTagTargets();
      targets[item.key] = record;
      saveTargets(GM_KEYS.tagTargets, targets);
    }

    const currentTargets = state.picker.type === 'tags' ? getTagTargets() : null;
    const extra = state.picker.type === 'tags' ? ` = ${currentTargets?.[item.key]?.label || ''}` : '';
    log(`Saved target: ${item.label}${extra}`);

    state.picker.index += 1;
    if (state.picker.index >= state.picker.items.length) {
      stopPicker(state.picker.type === 'fields' ? 'Field targets saved' : 'Tag targets saved');
      return;
    }

    const next = state.picker.items[state.picker.index];
    setStatus(`Picker: click ${next.label}`);
    log(`Next target: ${next.label}`);
  }

  function resetFieldTargets() {
    saveTargets(GM_KEYS.fieldTargets, {});
    log('Field targets reset');
    renderAll();
  }

  function resetTagTargets() {
    saveTargets(GM_KEYS.tagTargets, {});
    log('Tag targets reset');
    renderAll();
  }

  function runManualRuntimeCleanup() {
    const openTicket = getOpenTicketInfo();
    const ticketId = norm(openTicket.ticketId || '');
    if (!ticketId) {
      setStatus('Open ticket required');
      log('Manual runtime cleanup skipped: open ticket not detected');
      renderAll();
      return;
    }

    clearSharedRuntimeForAz(ticketId, {
      reason: 'manual finisher panel cleanup',
      publishAltaRequest: true
    });
    state.activeAzId = ticketId;
    setStatus(`Runtime cleaned for ${ticketId}`);
    log(`Manual runtime cleanup completed | AZ ${ticketId}`);
    renderAll();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildUi() {
    const panel = document.createElement('div');
    panel.id = 'tm-az-ticket-finisher-panel';
    panel.setAttribute(UI_ATTR, '1');
    panel.setAttribute('data-hb-script-id', SCRIPT_ID);
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
      boxShadow: '0 18px 48px rgba(0,0,0,0.38)',
      font: '12px/1.45 Segoe UI, Tahoma, Arial, sans-serif',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div ${UI_ATTR}="1" id="tm-az-ticket-finisher-head" style="padding:10px 12px;background:linear-gradient(90deg,#111827,#1f2937);display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move;">
        <div ${UI_ATTR}="1">
          <div ${UI_ATTR}="1" style="font-weight:800;">${SCRIPT_NAME}</div>
          <div ${UI_ATTR}="1" style="font-size:11px;opacity:.72;">MAIN + fields + note + tag finisher</div>
        </div>
        <div ${UI_ATTR}="1" style="font-size:11px;opacity:.72;">v${VERSION}</div>
      </div>
      <div ${UI_ATTR}="1" style="padding:12px;">
        <div ${UI_ATTR}="1" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#15803d;color:#fff;font-weight:800;cursor:pointer;">START</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-force" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;">FORCE RUN</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-clean-runtime" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#b45309;color:#fff;font-weight:800;cursor:pointer;">CLEAN RUNTIME</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-set-missing-fields" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0d9488;color:#fff;font-weight:800;cursor:pointer;">ADD MISSING FIELDS</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-set-fields" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0891b2;color:#fff;font-weight:800;cursor:pointer;">REDO ALL FIELDS</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-reset-fields" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">RESET FIELD TARGETS</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-set-tags" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#f59e0b;color:#111827;font-weight:800;cursor:pointer;">SET TAG TARGETS</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-reset-tags" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">RESET TAG TARGETS</button>
        </div>
        <div ${UI_ATTR}="1" id="tm-az-ticket-finisher-status" style="font-weight:800;color:#86efac;margin-bottom:10px;">Waiting for mirrored payload</div>
        <div ${UI_ATTR}="1" style="display:grid;grid-template-columns:110px 1fr;gap:6px 8px;margin-bottom:10px;">
          <div ${UI_ATTR}="1" style="opacity:.72;">AZ ID</div><div ${UI_ATTR}="1" id="tm-az-ticket-finisher-azid">-</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Payload</div><div ${UI_ATTR}="1" id="tm-az-ticket-finisher-payload">Missing</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Field targets</div><div ${UI_ATTR}="1" id="tm-az-ticket-finisher-fields">Missing</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Tag targets</div><div ${UI_ATTR}="1" id="tm-az-ticket-finisher-tags">Missing</div>
        </div>
        <textarea ${UI_ATTR}="1" id="tm-az-ticket-finisher-logs" readonly style="width:100%;min-height:160px;max-height:220px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:12px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('#tm-az-ticket-finisher-head');
    state.ui.toggle = panel.querySelector('#tm-az-ticket-finisher-toggle');
    state.ui.force = panel.querySelector('#tm-az-ticket-finisher-force');
    state.ui.cleanRuntime = panel.querySelector('#tm-az-ticket-finisher-clean-runtime');
    state.ui.setMissingFields = panel.querySelector('#tm-az-ticket-finisher-set-missing-fields');
    state.ui.setFields = panel.querySelector('#tm-az-ticket-finisher-set-fields');
    state.ui.resetFields = panel.querySelector('#tm-az-ticket-finisher-reset-fields');
    state.ui.setTags = panel.querySelector('#tm-az-ticket-finisher-set-tags');
    state.ui.resetTags = panel.querySelector('#tm-az-ticket-finisher-reset-tags');
    state.ui.status = panel.querySelector('#tm-az-ticket-finisher-status');
    state.ui.azId = panel.querySelector('#tm-az-ticket-finisher-azid');
    state.ui.payload = panel.querySelector('#tm-az-ticket-finisher-payload');
    state.ui.fields = panel.querySelector('#tm-az-ticket-finisher-fields');
    state.ui.tags = panel.querySelector('#tm-az-ticket-finisher-tags');
    state.ui.logs = panel.querySelector('#tm-az-ticket-finisher-logs');

    makeDraggable(panel, state.ui.head);
  }

  function bindUi() {
    state.ui.toggle?.addEventListener('click', () => {
      state.running = !state.running;
      saveRunning(state.running);
      if (!state.running) {
        setStatus('Stopped');
        log('Monitoring stopped');
      } else {
        setStatus('Waiting for mirrored payload');
        log('Monitoring started');
        tick();
      }
      renderAll();
    });

    state.ui.force?.addEventListener('click', () => {
      state.forceRunRequested = true;
      if (!state.running) {
        state.running = true;
        saveRunning(true);
        log('Force run requested; monitoring started');
      } else {
        log('Force run requested');
      }
      setStatus('Force run requested');
      renderAll();
      tick();
    });

    state.ui.cleanRuntime?.addEventListener('click', runManualRuntimeCleanup);
    state.ui.setMissingFields?.addEventListener('click', startMissingFieldPicker);
    state.ui.setFields?.addEventListener('click', () => startPicker('fields'));
    state.ui.resetFields?.addEventListener('click', resetFieldTargets);
    state.ui.setTags?.addEventListener('click', () => startPicker('tags'));
    state.ui.resetTags?.addEventListener('click', resetTagTargets);
  }

  function renderLogs() {
    if (!state.ui.logs) return;
    state.ui.logs.value = state.logs.join('\n');
    state.ui.logs.scrollTop = 0;
  }

  function renderAll() {
    const payload = getFinalPayload();
    const openTicket = getOpenTicketInfo();
    const canCleanRuntime = !state.busy && !!norm(openTicket.ticketId || '');
    if (state.ui.azId) state.ui.azId.textContent = norm(state.activeAzId || payload?.azId || '-') || '-';
    if (state.ui.payload) state.ui.payload.textContent = payload ? 'Found' : 'Missing';
    if (state.ui.fields) state.ui.fields.textContent = getFieldTargetStatusText();
    if (state.ui.tags) state.ui.tags.textContent = hasAllTagTargets() ? 'Saved' : 'Missing';

    if (state.ui.toggle) {
      state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
      state.ui.toggle.style.background = state.running ? '#b91c1c' : '#15803d';
    }

    if (state.ui.force) {
      state.ui.force.disabled = state.busy;
      state.ui.force.style.opacity = state.busy ? '0.65' : '1';
    }

    if (state.ui.cleanRuntime) {
      state.ui.cleanRuntime.disabled = !canCleanRuntime;
      state.ui.cleanRuntime.style.opacity = canCleanRuntime ? '1' : '0.5';
      state.ui.cleanRuntime.title = canCleanRuntime
        ? 'Clear transient runtime state for the current open ticket'
        : 'Open an AZ ticket to clean runtime state';
    }

    renderLogs();
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


