// ==UserScript==
// @name         AgencyZoom Quote Launcher + Payload Grabber
// @namespace    homebot.az-stage-runner
// @version      2.5.43
// @description  HOME-only AZ stage runner. Always boots through a fresh clear+reload cycle, restores after its own reload token, switches to Ignored tags from the saved-query filter, opens one ticket per page refresh, and launches the Home quote path only.
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @run-at       document-end
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-stage-runner/az-stage-runner.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-stage-runner/az-stage-runner.user.js
// ==/UserScript==

(function () {
  'use strict';

  try { window.__HB_AZ_STAGE_RUNNER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'AgencyZoom Quote Launcher + Payload Grabber';
  const VERSION = '2.5.43';

  // Persist state.logs to a tracked key so storage-tools.user.js can export
  // every script's logs in one click, and listen for a cross-origin clear
  // signal so CLEAR LOGS empties every running script's buffer at once.
  const LOG_PERSIST_KEY = 'tm_az_stage_runner_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  const SCRIPT_ACTIVITY_KEY = 'tm_ui_script_activity_v1';
  const SCRIPT_ID = 'az-stage-runner';
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';

  const CFG = {
    stageLabelFallback: 'First visible',
    savedQueryName: 'Ignored tags',

    openTryMs: 4200,
    openTotalMs: 12000,
    openCheckAfterClickMs: 2000,
    closeWaitMs: 5000,
    detailWaitMs: 12000,
    quoteTabWaitMs: 7000,
    pageWaitMs: 1500,
    filterSettleMs: 1500,
    quotePreWaitMs: 5000,
    frontStableMs: 3000,
    waitForHideAfterQuoteMs: 10000,
    ticketClosePollMs: 1200,
    ticketCloseLogEveryMs: 8000,
    payloadMismatchFailMs: 20 * 1000,
    missingPayloadFinisherMaxWaitMs: 90 * 1000,
    maxMainPayloadFailureAttempts: 1,
    nextRunAfterCloseMs: 3000,
    frontIdleReloadMs: 40 * 1000,
    frontIdlePollMs: 1000,
    gapMs: 220,
    maxLogLines: 18,

    panelRight: 12,
    panelBottom: 12,
    zIndex: 2147483647
  };

  const KEYS = {
    PANEL_POS: 'tm_az_stage_runner_panel_pos_v19',
    MODE: 'tm_az_stage_runner_mode_v19',
    RUNNING: 'tm_az_stage_runner_running_v23',

    LAST_PAYLOAD: 'tm_az_payload_v1',
    PAYLOAD_MAP: 'tm_az_payload_map_v1',
    LAST_SAVED_ID: 'tm_az_last_saved_ticket_id_v1',
    SCAN_STATE: 'tm_az_stage_scan_state_v1',

    SHARED_JOB: 'tm_shared_az_job_v1',
    CURRENT_JOB: 'tm_alta_current_job_v1',
    AZ_CURRENT_JOB: 'tm_az_current_job_v1',
    WORKFLOW_CLEANUP_REQUEST: 'tm_az_workflow_cleanup_request_v1',
    FINISHER_CLOSE_SIGNAL: 'tm_az_finisher_ticket_closed_signal_v1',
    MISSING_PAYLOAD_TRIGGER: 'tm_az_missing_payload_fallback_trigger_v1',
    TIMEOUT_RETRY_STATE: 'tm_alta_header_timeout_retry_state_v1',
    TIMEOUT_RETRY_REQUEST: 'tm_alta_header_timeout_retry_request_v1',
    MAIN_PAYLOAD_FAILURES: 'tm_az_stage_runner_main_payload_failures_v1',
    FINAL_PAYLOAD: 'tm_az_alta_final_payload_v1',
    FINAL_READY: 'tm_az_alta_final_payload_ready_v1',
    AUTH_HOLD: 'tm_shared_auth_hold_v1',
    ANCHOR_STATE: 'tm_shared_anchor_state_v1'
  };

  const SS_KEYS = {
    BOOTSTRAP_RELOAD_TOKEN: 'tm_az_stage_runner_bootstrap_reload_token_v1',
    BOOTSTRAP_RELOAD_MODE: 'tm_az_stage_runner_bootstrap_reload_mode_v1',
    MISSING_PAYLOAD_HANDOFF_PAUSE: 'tm_az_stage_runner_missing_payload_handoff_pause_v1',
    LAST_WORKFLOW_CLEANUP_REQUEST_HANDLED: 'tm_az_stage_runner_last_workflow_cleanup_request_handled_v1',
    LAST_TIMEOUT_RETRY_REQUEST_HANDLED: 'tm_az_stage_runner_last_timeout_retry_request_handled_v1'
  };

  const SEL = {
    stageWrap: '.dd-heading-wrapper',
    stageCards: '.dd-card.referral-container[data-id]',
    customerLink: 'a.customer[rel], a.customer',

    mainTab: 'a[href="#tabDetail"][data-toggle="tab"]',
    mainPane: '#tabDetail',
    detailForm: '#detailDockform',
    initialValues: '#detailDockform input[name="initialValues"]',

    quotesTab: 'a#policyTabTitle[href="#tabQuote"][data-toggle="tab"]',
    quotePane: '#tabQuote',
    homeLink: '#tabQuote > div > div.ml-4 > a:nth-child(3)',

    dockRoot: '.az-dock, #serviceDetailDock, #notePanelContainer, .az-dock__top',
    dockTop: '.az-dock__top',
    dockSideActions: '.az-dock__side-actions',
    topName: 'h3.currentCustomerName',
    topTags: '.az-dock__display-tags .az-def-badge, .az-dock__display-tags .az-def-badge.tag',

    savedQueryButton: '#currentPipelineFilter .savedQueryDropdown > button.dropdown-toggle',
    savedQueryLabel: '#currentPipelineFilter .savedQueryDropdown .editing_filter_name',
    savedQueryWrap: '#currentPipelineFilter .dropdown.savedQueryDropdown',
    savedQueryItems: '#currentPipelineFilter .saved-query-item, #currentPipelineFilter .dropdown-item.saved-query-item',

    closeCandidates: 'button, a, [role="button"], .close, .btn-close, .az-dock__close'
  };

  const CLEAR_EXACT_KEYS = new Set([
    'tm_az_home_auto_payload_v1',
    'tm_az_stage_runner_payload_v1',
    KEYS.LAST_PAYLOAD,
    KEYS.PAYLOAD_MAP,
    KEYS.LAST_SAVED_ID,
    KEYS.SCAN_STATE,
    KEYS.SHARED_JOB,
    KEYS.CURRENT_JOB,
    KEYS.AZ_CURRENT_JOB,
    'tm_apex_home_bot_payload_v1',
    'tm_apex_home_bot_ready_v1',
    'tm_apex_home_bot_active_row_v1',
    'tm_alta_home_quote_grab_payload_v1',
    'tm_alta_auto_quote_grab_payload_v1',
    'tm_alta_webhook_bundle_v1',
    'tm_alta_header_timeout_retry_state_v1',
    'tm_alta_header_timeout_retry_request_v1',
    'tm_alta_webhook_submit_sent_meta_v17',
    'tm_alta_webhook_submit_stopped_v17',
    'tm_alta_webhook_post_success_v1',
    'tm_alta_webhook_post_success_consumed_v1',
    'tm_az_ticket_finisher_wake_v1',
    'tm_alta_force_send_now_v1',
    'tm_alta_shared_failure_selector_sent_v1',
    'tm_alta_payload_mirror_close_signal_v1',
    'tm_alta_payload_mirror_lex_close_consumed_signal_v1',
    'tm_alta_payload_mirror_ignore_close_lease_v1',
    'tm_alta_payload_mirror_last_handled_signal_v1',
    'tm_alta_payload_mirror_close_attempted_v1',
    'tm_az_alta_final_payload_v1',
    'tm_az_alta_final_payload_ready_v1',
    KEYS.MAIN_PAYLOAD_FAILURES,
    'tm_alta_header_timeout_runtime_v2',
    'tm_alta_header_timeout_sent_events_v2',
    'tm_alta_header_timeout_retry_requested_context_v1',
    'tm_alta_header_timeout_pending_post_v2',
    'tm_alta_header_timeout_watch_pending_v1',
    'tm_alta_webhook_fatal_error_hold_v1',
    'tm_alta_flow_stage_v1',
    'tm_az_ticket_finisher_runs_v1',
    KEYS.WORKFLOW_CLEANUP_REQUEST,
    KEYS.FINISHER_CLOSE_SIGNAL,
    KEYS.MISSING_PAYLOAD_TRIGGER,
    'tm_payload_mirror_tab_heartbeats_v1',
    'tm_payload_mirror_apex_wake_state_v1',
    'tm_shared_cache_az_payload_v1',
    'tm_shared_cache_apex_payload_v1',
    'tm_shared_cache_apex_ready_v1',
    'tm_shared_cache_apex_active_row_v1',
    'tm_shared_cache_alta_home_quote_payload_v1',
    'tm_shared_cache_alta_auto_quote_payload_v1',
    'hb_shared_az_to_alta_ticket_handoff_v1',
    'hb_shared_az_to_alta_ticket_handoff_last_applied_v1',
    'hb_shared_az_to_alta_ticket_handoff_stop_v1'
  ]);

  const CLEAR_PREFIXES = [
    'aqb_'
  ];

  const FIELD_ORDER = [
    'AZ ID',
    'AZ Lead Source',
    'AZ Producer',
    'AZ Name',
    'AZ Last',
    'AZ DOB',
    'AZ Phone',
    'AZ Email',
    'AZ Street Address',
    'AZ City',
    'AZ Country',
    'AZ State',
    'AZ Postal Code',
    'First Name',
    'Last Name',
    'Email',
    'Phone',
    'DOB',
    'Street Address',
    'City',
    'State',
    'Zip'
  ];

  const state = {
    running: loadRunning(),
    busy: false,
    destroyed: false,
    mode: loadMode(),
    processedIds: new Set(),
    logs: [],
    ui: {},
    keyHandler: null,
    persistHandler: null,
    visibilityPersistHandler: null,
    bgPauseLogged: false,
    frontIdleInterval: null,
    frontIdleActivityHandler: null,
    frontIdleFocusHandler: null,
    frontIdleBlurHandler: null,
    frontIdleFrontSinceAt: 0,
    frontIdleLastActivityAt: Date.now(),
    frontIdleLastSignature: '',
    frontIdleArmedLogged: false,
    frontIdleReloadPending: false,
    frontIdleBusyLogged: false,
    refreshRequiredThisLoad: false,
    activeTicketId: '',
    fatalFallbackInFlight: false,
    handoffPauseMonitorInterval: null,
    externalWakeTick: 0,
    storageWakeHandler: null,
    pendingStartTimer: 0,
    pendingReloadTimer: 0,
    logsIntervalTimer: null,
    lastStatus: '',
    authGateLogKey: '',
    activityState: 'idle',
    activityMessage: 'Idle'
  };

  init();

  function init() {
    buildUi();
    bindUi();
    restorePanelPos();
    syncUi();
    renderLogs();

    if (!state.mode) {
      state.mode = 'home';
      saveMode(state.mode);
      syncUi();
      log('Default mode set: Home', 'info');
    }

    log(`${SCRIPT_NAME} V${VERSION} loaded`, 'ok');
    log(`Home-only start enabled | mode=${state.mode.toUpperCase()}`, 'info');
    log(`Main must return ${FIELD_ORDER.length}/${FIELD_ORDER.length} AZ fields before Quotes`, 'info');
    log(`Home start clears workflow data, reloads, and resumes automatically with ${CFG.savedQueryName}`, 'info');
    log('Ticket is only done when the finisher closes it', 'info');
    log('ESC stops the run', 'info');
    writeActivityState(state.running ? 'idle' : 'stopped', state.running ? 'Idle' : 'Stopped');

    state.keyHandler = (e) => {
      if (e.key === 'Escape' && state.running) stopRun('ESC stop', { manual: true });
    };
    window.addEventListener('keydown', state.keyHandler, true);

    state.persistHandler = () => {
      armRefreshResumeToken();
      persistState();
    };
    window.addEventListener('beforeunload', state.persistHandler, true);
    window.addEventListener('pagehide', state.persistHandler, true);

    state.visibilityPersistHandler = () => {
      if (document.visibilityState === 'hidden') persistState();
    };
    document.addEventListener('visibilitychange', state.visibilityPersistHandler, true);

    state.storageWakeHandler = (event) => {
      if (event?.storageArea !== localStorage) return;
      if (
        event.key !== KEYS.FINISHER_CLOSE_SIGNAL
        && event.key !== KEYS.WORKFLOW_CLEANUP_REQUEST
        && event.key !== KEYS.TIMEOUT_RETRY_REQUEST
        && event.key !== KEYS.AUTH_HOLD
        && event.key !== KEYS.ANCHOR_STATE
        && event.key !== KEYS.FINAL_READY
        && event.key !== KEYS.FINAL_PAYLOAD
      ) return;
      const reason = event.key === KEYS.FINISHER_CLOSE_SIGNAL
        ? 'finisher-close'
        : event.key === KEYS.WORKFLOW_CLEANUP_REQUEST
          ? 'workflow-cleanup'
          : event.key === KEYS.TIMEOUT_RETRY_REQUEST
            ? 'timeout-quote-retry'
            : event.key === KEYS.AUTH_HOLD
              ? 'auth-hold'
              : event.key === KEYS.ANCHOR_STATE
                ? 'anchor-state'
          : 'final-home-payload';
      markExternalWake(reason);
    };
    window.addEventListener('storage', state.storageWakeHandler, true);

    setupFrontIdleReloadWatchdog();
    startLogPersistenceHooks();

    window.__HB_AZ_STAGE_RUNNER_CLEANUP__ = cleanup;

    const handoffPause = readMissingPayloadHandoffPause();
    if (handoffPause) {
      if (!shouldKeepMissingPayloadHandoffPause(handoffPause)) {
        clearMissingPayloadHandoffPause();
        log(`Missing payload handoff pause cleared; finisher already completed | ${handoffPause.ticketId || 'unknown ticket'}`, 'ok');
      } else {
        state.running = false;
        state.busy = false;
        state.refreshRequiredThisLoad = false;
        saveRunning(false);
        setBootstrapReloadMode('');
        clearBootstrapReloadToken();
        syncUi();
        setStatus('MISSING PAYLOAD HANDOFF PAUSED');
        log(`Missing payload handoff pause active; launcher stopped for finisher | ${handoffPause.ticketId || 'unknown ticket'}`, 'warn');
        startMissingPayloadHandoffMonitor(handoffPause);
        return;
      }
    }

    if (hasBootstrapReloadToken()) {
      const restoreMode = consumeBootstrapReloadMode();
      clearBootstrapReloadToken();
      if (restoreMode) {
        state.mode = restoreMode;
        saveMode(state.mode);
        syncUi();
      }
      state.running = true;
      saveRunning(true);
      setStatus(`RESTORING (${state.mode.toUpperCase()})`);
      log(`Continuing after fresh reload | mode=${state.mode.toUpperCase()}`, 'ok');
      schedulePendingStart(() => {
        if (!state.destroyed && state.running && !state.busy) {
          startRun(true);
        }
      }, 0);
      return;
    }

    state.running = true;
    saveRunning(true);
    syncUi();
    setStatus('HOME STARTING');
    log('Fresh home bootstrap | mode=HOME', 'ok');
    schedulePendingStart(() => {
      if (!state.destroyed && state.running && !state.busy && !state.refreshRequiredThisLoad) {
        startRun(false);
      }
    }, 0);
  }

  function cleanup() {
    state.destroyed = true;
    state.busy = false;
    try { writeActivityState('stopped', 'Cleanup'); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}

    try { window.removeEventListener('keydown', state.keyHandler, true); } catch {}
    try { window.removeEventListener('beforeunload', state.persistHandler, true); } catch {}
    try { window.removeEventListener('pagehide', state.persistHandler, true); } catch {}
    try { document.removeEventListener('visibilitychange', state.visibilityPersistHandler, true); } catch {}
    try { window.removeEventListener('storage', state.storageWakeHandler, true); } catch {}
    try { clearInterval(state.frontIdleInterval); } catch {}
    try { clearInterval(state.handoffPauseMonitorInterval); } catch {}
    try { document.removeEventListener('click', state.frontIdleActivityHandler, true); } catch {}
    try { document.removeEventListener('keydown', state.frontIdleActivityHandler, true); } catch {}
    try { document.removeEventListener('input', state.frontIdleActivityHandler, true); } catch {}
    try { document.removeEventListener('pointerdown', state.frontIdleActivityHandler, true); } catch {}
    try { window.removeEventListener('scroll', state.frontIdleActivityHandler, true); } catch {}
    try { window.removeEventListener('focus', state.frontIdleFocusHandler, true); } catch {}
    try { window.removeEventListener('blur', state.frontIdleBlurHandler, true); } catch {}
    clearPendingActionTimers();

    const panel = document.getElementById('hb-az-stage-runner-panel');
    if (panel) panel.remove();

    try { delete window.__HB_AZ_STAGE_RUNNER_CLEANUP__; } catch {}
  }

  function loadMode() {
    try {
      const v = localStorage.getItem(KEYS.MODE);
      if (v === 'auto') {
        localStorage.setItem(KEYS.MODE, 'home');
        return 'home';
      }
      return 'home';
    } catch {
      return 'home';
    }
  }

  function saveMode(mode) {
    try { localStorage.setItem(KEYS.MODE, 'home'); } catch {}
  }

  function loadRunning() {
    // Always re-arm after refresh. Stop is only for the current page session.
    try { localStorage.removeItem(KEYS.RUNNING); } catch {}
    return true;
  }

  function saveRunning(on) {
    try {
      if (on) localStorage.removeItem(KEYS.RUNNING);
      else localStorage.setItem(KEYS.RUNNING, '0');
    } catch {}
  }

  function hasBootstrapReloadToken() {
    try { return !!sessionStorage.getItem(SS_KEYS.BOOTSTRAP_RELOAD_TOKEN); } catch { return false; }
  }

  function setBootstrapReloadToken() {
    try { sessionStorage.setItem(SS_KEYS.BOOTSTRAP_RELOAD_TOKEN, String(Date.now())); } catch {}
  }

  function setBootstrapReloadMode(mode) {
    try {
      if (mode === 'home') sessionStorage.setItem(SS_KEYS.BOOTSTRAP_RELOAD_MODE, 'home');
      else sessionStorage.removeItem(SS_KEYS.BOOTSTRAP_RELOAD_MODE);
    } catch {}
  }

  function clearBootstrapReloadToken() {
    try { sessionStorage.removeItem(SS_KEYS.BOOTSTRAP_RELOAD_TOKEN); } catch {}
  }

  function readMissingPayloadHandoffPause() {
    try {
      const raw = sessionStorage.getItem(SS_KEYS.MISSING_PAYLOAD_HANDOFF_PAUSE);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setMissingPayloadHandoffPause(ticketId, reason) {
    const payload = {
      ticketId: norm(ticketId || ''),
      reason: norm(reason || ''),
      savedAt: nowIso()
    };
    try { sessionStorage.setItem(SS_KEYS.MISSING_PAYLOAD_HANDOFF_PAUSE, JSON.stringify(payload)); } catch {}
    return payload;
  }

  function clearMissingPayloadHandoffPause() {
    try { sessionStorage.removeItem(SS_KEYS.MISSING_PAYLOAD_HANDOFF_PAUSE); } catch {}
  }

  function getSignalTimeMs(signal, keys) {
    for (const key of keys) {
      const ms = Date.parse(norm(signal?.[key] || ''));
      if (Number.isFinite(ms)) return ms;
    }
    return 0;
  }

  function signalMatchesPause(signal, pause, timeKeys) {
    const ticketId = norm(pause?.ticketId || '');
    if (!ticketId || !signal || signal.ready !== true) return false;
    const signalId = norm(signal.ticketId || signal.azId || '');
    if (signalId !== ticketId) return false;

    const pauseMs = Date.parse(norm(pause?.savedAt || ''));
    const signalMs = getSignalTimeMs(signal, timeKeys);
    if (!Number.isFinite(pauseMs) || !signalMs) return true;
    return signalMs >= (pauseMs - 1000);
  }

  function getActiveMissingPayloadTriggerForTicket(ticketId = '') {
    const wantedId = norm(ticketId || '');
    const trigger = readSharedJson(KEYS.MISSING_PAYLOAD_TRIGGER, null);
    if (!trigger || trigger.ready !== true) return null;
    const triggerId = norm(trigger.ticketId || trigger.azId || '');
    if (!triggerId) return null;
    if (wantedId && triggerId !== wantedId) return null;

    const requestedAtMs = Date.parse(norm(trigger.requestedAt || ''));
    if (Number.isFinite(requestedAtMs) && (Date.now() - requestedAtMs) > (10 * 60 * 1000)) return null;
    return trigger;
  }

  function hasActiveMissingPayloadTriggerForPause(pause) {
    const ticketId = norm(pause?.ticketId || '');
    if (!ticketId) return false;
    return !!getActiveMissingPayloadTriggerForTicket(ticketId);
  }

  function hasCompletedMissingPayloadHandoff(pause) {
    if (signalMatchesPause(readFinisherCloseSignal(), pause, ['closedAt', 'requestedAt'])) return true;
    if (signalMatchesPause(readWorkflowCleanupRequest(), pause, ['requestedAt', 'closedAt'])) return true;
    return false;
  }

  function shouldKeepMissingPayloadHandoffPause(pause) {
    const ticketId = norm(pause?.ticketId || '');
    if (!ticketId) return false;
    if (hasCompletedMissingPayloadHandoff(pause)) return false;
    if (hasActiveMissingPayloadTriggerForPause(pause)) return true;

    const pauseMs = Date.parse(norm(pause?.savedAt || ''));
    if (Number.isFinite(pauseMs) && (Date.now() - pauseMs) < 15000) return true;
    return false;
  }

  function startMissingPayloadHandoffMonitor(pause) {
    try { clearInterval(state.handoffPauseMonitorInterval); } catch {}
    state.handoffPauseMonitorInterval = window.setInterval(() => {
      const currentPause = readMissingPayloadHandoffPause();
      if (!currentPause || shouldKeepMissingPayloadHandoffPause(currentPause)) return;

      try { clearInterval(state.handoffPauseMonitorInterval); } catch {}
      state.handoffPauseMonitorInterval = null;
      clearMissingPayloadHandoffPause();
      setBootstrapReloadMode('home');
      setBootstrapReloadToken();
      state.mode = 'home';
      state.running = true;
      saveMode(state.mode);
      saveRunning(true);
      syncUi();
      setStatus('RELOADING AFTER FINISHER');
      log(`Missing payload handoff finished; reloading for next ticket | ${norm(currentPause.ticketId || pause?.ticketId || '')}`, 'ok');
      schedulePendingReload(() => {
        if (!state.destroyed) reloadToPipelineRoot();
      }, 120);
    }, 1000);
  }

  function armRefreshResumeToken() {
    // Only active launcher-controlled reloads should resume automatically.
    // A missing-payload handoff must stay stopped so the finisher can own it.
    if (state.destroyed) return;
    if (readMissingPayloadHandoffPause()) return;
    if (!state.running && !state.refreshRequiredThisLoad) return;
    setBootstrapReloadMode(state.mode || 'home');
    setBootstrapReloadToken();
  }

  function startLogPersistenceHooks() {
    if (!state.logsIntervalTimer) {
      state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);
    }
    window.removeEventListener('storage', handleLogClearStorageEvent, true);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();
  }

  function clearPendingActionTimers() {
    try { if (state.pendingStartTimer) clearTimeout(state.pendingStartTimer); } catch {}
    try { if (state.pendingReloadTimer) clearTimeout(state.pendingReloadTimer); } catch {}
    state.pendingStartTimer = 0;
    state.pendingReloadTimer = 0;
    syncUi();
  }

  function resetFrontIdleReloadState() {
    state.frontIdleFrontSinceAt = 0;
    state.frontIdleArmedLogged = false;
    state.frontIdleReloadPending = false;
    state.frontIdleBusyLogged = false;
    state.frontIdleLastActivityAt = Date.now();
    state.frontIdleLastSignature = getFrontIdleSignature();
  }

  function schedulePendingStart(fn, delay = 0) {
    try { if (state.pendingStartTimer) clearTimeout(state.pendingStartTimer); } catch {}
    state.pendingStartTimer = window.setTimeout(() => {
      state.pendingStartTimer = 0;
      syncUi();
      fn();
    }, delay);
    syncUi();
  }

  function schedulePendingReload(fn, delay = 120) {
    try { if (state.pendingReloadTimer) clearTimeout(state.pendingReloadTimer); } catch {}
    state.pendingReloadTimer = window.setTimeout(() => {
      state.pendingReloadTimer = 0;
      syncUi();
      fn();
    }, delay);
    syncUi();
  }

  // Every automatic reload must land on the clean pipeline URL. A plain
  // location.reload() keeps whatever the operator drifted to (e.g. a
  // ticket-drawer hash state). Normalize the URL bar with replaceState
  // (silent same-origin update) and then reload so the new page loads
  // at the canonical URL regardless of starting state. If reload() is
  // ignored by the browser/app shell, fall back to a hard navigation.
  const PIPELINE_ROOT_URL = 'https://app.agencyzoom.com/referral/pipeline';

  function reloadToPipelineRoot() {
    let fallbackTimer = 0;
    const clearFallback = () => {
      try {
        if (fallbackTimer) clearTimeout(fallbackTimer);
      } catch {}
      fallbackTimer = 0;
    };

    try { window.addEventListener('beforeunload', clearFallback, { capture: true, once: true }); } catch {}
    try { window.addEventListener('pagehide', clearFallback, { capture: true, once: true }); } catch {}

    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = 0;
      log('Reload fallback fired; forcing navigation to AgencyZoom pipeline root', 'warn');
      try {
        location.replace(PIPELINE_ROOT_URL);
        return;
      } catch {}
      try { location.href = PIPELINE_ROOT_URL; } catch {}
    }, 1500);

    try {
      if (location.href !== PIPELINE_ROOT_URL) {
        history.replaceState(null, '', PIPELINE_ROOT_URL);
      }
    } catch {}
    try {
      location.reload();
      return;
    } catch {}

    clearFallback();
    try {
      location.replace(PIPELINE_ROOT_URL);
      return;
    } catch {}
    try { location.href = PIPELINE_ROOT_URL; } catch {}
  }

  function consumeBootstrapReloadMode() {
    try {
      const mode = sessionStorage.getItem(SS_KEYS.BOOTSTRAP_RELOAD_MODE) || '';
      sessionStorage.removeItem(SS_KEYS.BOOTSTRAP_RELOAD_MODE);
      return mode === 'home' ? 'home' : '';
    } catch {
      return '';
    }
  }

  function isPipelinePage() {
    return /\/referral\/pipeline(?:$|[?#/])/i.test(`${location.pathname}${location.search}${location.hash}`);
  }

  function markFrontIdleActivity() {
    state.frontIdleLastActivityAt = Date.now();
    state.frontIdleArmedLogged = false;
    state.frontIdleReloadPending = false;
  }

  function getFrontIdleSignature() {
    const info = getOpenTicketInfo();
    const stageLabel = norm(getStagePageLabel() || '');
    const savedQuery = norm(getCurrentSavedQueryLabel() || '');
    return [
      location.pathname,
      location.search,
      location.hash,
      isTicketDrawerOpen() ? 'open' : 'closed',
      norm(info.ticketId || ''),
      stageLabel,
      savedQuery
    ].join('|');
  }

  function setupFrontIdleReloadWatchdog() {
    const onTrustedActivity = (event) => {
      if (!event?.isTrusted) return;
      markFrontIdleActivity();
    };
    state.frontIdleActivityHandler = onTrustedActivity;
    document.addEventListener('click', onTrustedActivity, true);
    document.addEventListener('keydown', onTrustedActivity, true);
    document.addEventListener('input', onTrustedActivity, true);
    document.addEventListener('pointerdown', onTrustedActivity, true);
    window.addEventListener('scroll', onTrustedActivity, true);

    state.frontIdleFocusHandler = () => {
      state.frontIdleFrontSinceAt = 0;
      state.frontIdleArmedLogged = false;
      state.frontIdleReloadPending = false;
    };
    state.frontIdleBlurHandler = () => {
      state.frontIdleFrontSinceAt = 0;
      state.frontIdleArmedLogged = false;
      state.frontIdleReloadPending = false;
    };
    window.addEventListener('focus', state.frontIdleFocusHandler, true);
    window.addEventListener('blur', state.frontIdleBlurHandler, true);

    state.frontIdleLastSignature = getFrontIdleSignature();
    state.frontIdleLastActivityAt = Date.now();
    state.frontIdleInterval = setInterval(runFrontIdleReloadWatchdog, CFG.frontIdlePollMs);
  }

  function runFrontIdleReloadWatchdog() {
    if (state.destroyed) return;

    const openTicket = getOpenTicketInfo();
    const drawerOpen = isTicketDrawerOpen();
    const openTicketId = norm(openTicket.ticketId || '');
    const onPipelinePage = isPipelinePage();

    if (drawerOpen && openTicketId) {
      state.frontIdleFrontSinceAt = 0;
      state.frontIdleArmedLogged = false;
      state.frontIdleReloadPending = false;
      state.frontIdleBusyLogged = false;
      state.frontIdleLastActivityAt = Date.now();
      state.frontIdleLastSignature = getFrontIdleSignature();
      return;
    }

    if (state.fatalFallbackInFlight) {
      state.frontIdleFrontSinceAt = 0;
      state.frontIdleArmedLogged = false;
      state.frontIdleReloadPending = false;
      state.frontIdleLastActivityAt = Date.now();
      state.frontIdleLastSignature = getFrontIdleSignature();
      if (!state.frontIdleBusyLogged) {
        state.frontIdleBusyLogged = true;
        log('Front idle reload suppressed: launcher is handing the ticket to finisher', 'info');
      }
      return;
    }

    const watchdogReason = !onPipelinePage
      ? 'off-pipeline page'
      : drawerOpen
        ? 'drawer open without ticket id'
        : state.busy
          ? 'busy/no open ticket'
          : !state.running
            ? (state.refreshRequiredThisLoad ? 'refresh required' : 'stopped/no open ticket')
            : 'idle';
    state.frontIdleBusyLogged = false;

    const signature = getFrontIdleSignature();
    if (signature !== state.frontIdleLastSignature) {
      state.frontIdleLastSignature = signature;
      markFrontIdleActivity();
    }

    if (!isFrontTab()) {
      state.frontIdleFrontSinceAt = 0;
      state.frontIdleArmedLogged = false;
      state.frontIdleReloadPending = false;
      state.frontIdleBusyLogged = false;
      return;
    }

    if (!state.frontIdleFrontSinceAt) {
      state.frontIdleFrontSinceAt = Date.now();
      state.frontIdleArmedLogged = false;
    }

    const now = Date.now();
    const frontForMs = now - state.frontIdleFrontSinceAt;
    const idleForMs = now - state.frontIdleLastActivityAt;

    if (!state.frontIdleArmedLogged && frontForMs >= 1000) {
      state.frontIdleArmedLogged = true;
      log(`Front idle reload armed: 40s unchanged on visible AZ page | ${watchdogReason}`, 'info');
    }

    if (frontForMs < CFG.frontIdleReloadMs || idleForMs < CFG.frontIdleReloadMs) return;

    if (state.frontIdleReloadPending) return;

    state.frontIdleReloadPending = true;
    setBootstrapReloadMode('home');
    setBootstrapReloadToken();
    state.mode = 'home';
    saveMode(state.mode);
    syncUi();
    setStatus('RELOADING (HOME)');
    log(`Front idle timeout reached: reloading AgencyZoom pipeline page | ${watchdogReason}`, 'warn');
    persistState();
    schedulePendingReload(() => {
      if (!state.destroyed) reloadToPipelineRoot();
    }, 120);
  }

  function persistState() {
    saveMode(state.mode || '');
    saveRunning(!!state.running);
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function readSharedJson(key, fallback = null) {
    const local = readJson(key, undefined);
    if (local !== undefined && local !== null) return local;
    try {
      const value = GM_getValue(key, undefined);
      if (value === undefined || value === null || value === '') return fallback;
      if (typeof value === 'string') return JSON.parse(value);
      return value;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function readSession(key, fallback = '') {
    try {
      const value = sessionStorage.getItem(key);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeSession(key, value) {
    try { sessionStorage.setItem(key, String(value == null ? '' : value)); } catch {}
  }

  function parseIsoMs(value) {
    const ms = Date.parse(norm(value || ''));
    return Number.isFinite(ms) ? ms : 0;
  }

  function readAuthHold() {
    const hold = readJson(KEYS.AUTH_HOLD, null);
    return hold && typeof hold === 'object' && !Array.isArray(hold) ? hold : null;
  }

  function readAnchorState() {
    const value = readJson(KEYS.ANCHOR_STATE, null);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function isAuthHoldActive(hold) {
    if (!hold || typeof hold !== 'object') return false;
    const holdState = norm(hold.state || '').toLowerCase();
    if (holdState !== 'recovering' && holdState !== 'blocked') return false;

    const expiresAtMs = parseIsoMs(hold.expiresAt || '');
    if (expiresAtMs && Date.now() > expiresAtMs) return false;

    const updatedAtMs = parseIsoMs(hold.updatedAt || hold.claimedAt || '');
    if (!updatedAtMs) return false;
    return (Date.now() - updatedAtMs) <= 30000;
  }

  function buildAuthGateSnapshot() {
    const hold = readAuthHold();
    if (isAuthHoldActive(hold)) {
      const holdState = norm(hold.state || '').toLowerCase();
      return {
        state: holdState === 'blocked' ? 'blocked' : 'recovering',
        message: norm(hold.reason || hold.system || 'Auth recovery in progress') || 'Auth recovery in progress'
      };
    }

    const anchors = readAnchorState();
    const systems = ['apex', 'alta'];
    let blockedMessage = '';
    const recoveringMessages = [];

    for (const system of systems) {
      const entry = anchors?.[system];
      if (!entry || typeof entry !== 'object') continue;
      const sessionState = norm(entry.sessionState || '').toLowerCase();
      if (!sessionState) continue;
      const label = `${system.toUpperCase()} ${norm(entry.authMarker || entry.pageKind || sessionState) || sessionState}`;
      if (sessionState === 'blocked') {
        blockedMessage = label;
        break;
      }
      if (sessionState === 'recovering' || sessionState === 'login_required') {
        recoveringMessages.push(label);
      }
    }

    if (blockedMessage) {
      return {
        state: 'blocked',
        message: blockedMessage
      };
    }

    if (recoveringMessages.length) {
      return {
        state: 'recovering',
        message: recoveringMessages.join(' | ')
      };
    }

    return {
      state: 'healthy',
      message: ''
    };
  }

  async function waitForAuthHealthy(contextLabel = 'auth') {
    let lastLogAt = 0;

    while (state.running && !state.destroyed) {
      const gate = buildAuthGateSnapshot();
      const gateKey = `${gate.state}|${gate.message}`;

      if (gate.state === 'healthy') {
        state.authGateLogKey = '';
        if (state.lastStatus === 'AUTH RECOVERING') {
          setStatus(`RUNNING (${state.mode ? state.mode.toUpperCase() : 'HOME'})`);
        }
        return true;
      }

      if (gate.state === 'blocked') {
        if (state.authGateLogKey !== gateKey) {
          state.authGateLogKey = gateKey;
          log(`Auth blocked while ${contextLabel}: ${gate.message || 'manual login required'}`, 'error');
        }
        stopRun('AUTH BLOCKED');
        return false;
      }

      setStatus('AUTH RECOVERING');
      if (state.authGateLogKey !== gateKey || (Date.now() - lastLogAt) >= 8000) {
        state.authGateLogKey = gateKey;
        lastLogAt = Date.now();
        log(`Waiting for auth recovery while ${contextLabel}: ${gate.message || 'anchor recovery in progress'}`, 'warn');
      }

      const ok = await waitForWakeOrTimeout(1000);
      if (!ok) return false;
    }

    return false;
  }

  function clearFinisherCloseSignal() {
    try {
      localStorage.removeItem(KEYS.FINISHER_CLOSE_SIGNAL);
    } catch {}
    try {
      GM_deleteValue(KEYS.FINISHER_CLOSE_SIGNAL);
    } catch {}
  }

  function clearMissingPayloadTrigger() {
    try {
      localStorage.removeItem(KEYS.MISSING_PAYLOAD_TRIGGER);
    } catch {}
    try {
      GM_deleteValue(KEYS.MISSING_PAYLOAD_TRIGGER);
    } catch {}
  }

  function clearTimeoutRetryRequest() {
    try {
      localStorage.removeItem(KEYS.TIMEOUT_RETRY_REQUEST);
    } catch {}
    try {
      GM_deleteValue(KEYS.TIMEOUT_RETRY_REQUEST);
    } catch {}
  }

  function clearMirroredFinalPayloadForNewRun(ticketId = '') {
    const cleanTicketId = norm(ticketId || '');
    try {
      localStorage.removeItem(KEYS.FINAL_PAYLOAD);
    } catch {}
    try {
      localStorage.removeItem(KEYS.FINAL_READY);
    } catch {}
    try {
      GM_deleteValue(KEYS.FINAL_PAYLOAD);
    } catch {}
    try {
      GM_deleteValue(KEYS.FINAL_READY);
    } catch {}
    log(`Cleared mirrored final payload handoff before Home quote run${cleanTicketId ? ` | ${cleanTicketId}` : ''}`, 'ok');
  }

  function markTimeoutRetryLaunched(request) {
    const timeoutContextKey = norm(request?.timeoutContextKey || '');
    const scope = norm(request?.scope || '');
    if (!timeoutContextKey || !scope) return;

    const current = readSharedJson(KEYS.TIMEOUT_RETRY_STATE, null);
    const next = current && typeof current === 'object' && !Array.isArray(current)
      ? { ...current }
      : {};

    next.scope = scope;
    next.retries = Math.max(0, Number(request?.attempt || next.retries || 0) || 0);
    next.azId = norm(request?.azId || request?.ticketId || next.azId || '');
    next.product = norm(request?.product || next.product || '');
    next.submission = norm(request?.submission || next.submission || '');
    next.header = norm(request?.header || next.header || '');
    next.lastLaunchedContextKey = timeoutContextKey;
    next.lastLaunchedAt = nowIso();
    next.updatedAt = nowIso();

    try { localStorage.setItem(KEYS.TIMEOUT_RETRY_STATE, JSON.stringify(next)); } catch {}
    try { GM_setValue(KEYS.TIMEOUT_RETRY_STATE, next); } catch {}
  }

  function publishMissingPayloadTrigger(ticketId, reason = 'MAIN/PAYLOAD FAILED') {
    const cleanTicketId = norm(ticketId || '');
    if (!cleanTicketId) return false;

    const trigger = {
      ready: true,
      ticketId: cleanTicketId,
      azId: cleanTicketId,
      reason: norm(reason || 'MAIN/PAYLOAD FAILED') || 'MAIN/PAYLOAD FAILED',
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };

    try { localStorage.setItem(KEYS.MISSING_PAYLOAD_TRIGGER, JSON.stringify(trigger)); } catch {}
    try { GM_setValue(KEYS.MISSING_PAYLOAD_TRIGGER, trigger); } catch {}
    log(`Triggered missing payload fallback | ${cleanTicketId} | ${trigger.reason}`, 'warn');
    return true;
  }

  function readMainPayloadFailures() {
    const value = readJson(KEYS.MAIN_PAYLOAD_FAILURES, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function writeMainPayloadFailures(value) {
    writeJson(KEYS.MAIN_PAYLOAD_FAILURES, value && typeof value === 'object' ? value : {});
  }

  function recordMainPayloadFailure(ticketId, reason = 'MAIN/PAYLOAD FAILED') {
    const cleanTicketId = norm(ticketId || '');
    if (!cleanTicketId) return { count: 0, repeated: false };

    const failures = readMainPayloadFailures();
    const current = failures[cleanTicketId] && typeof failures[cleanTicketId] === 'object'
      ? failures[cleanTicketId]
      : {};
    const count = Number(current.count || 0) + 1;
    failures[cleanTicketId] = {
      count,
      reason: norm(reason || 'MAIN/PAYLOAD FAILED') || 'MAIN/PAYLOAD FAILED',
      updatedAt: nowIso()
    };
    writeMainPayloadFailures(failures);
    return {
      count,
      repeated: count > CFG.maxMainPayloadFailureAttempts
    };
  }

  function clearMainPayloadFailure(ticketId) {
    const cleanTicketId = norm(ticketId || '');
    if (!cleanTicketId) return;
    const failures = readMainPayloadFailures();
    if (!Object.prototype.hasOwnProperty.call(failures, cleanTicketId)) return;
    delete failures[cleanTicketId];
    writeMainPayloadFailures(failures);
  }

  function readFinisherCloseSignal() {
    const signal = readJson(KEYS.FINISHER_CLOSE_SIGNAL, null);
    return signal && typeof signal === 'object' ? signal : null;
  }

  function readWorkflowCleanupRequest() {
    const request = readJson(KEYS.WORKFLOW_CLEANUP_REQUEST, null);
    return request && typeof request === 'object' ? request : null;
  }

  function readTimeoutRetryRequest() {
    const request = readSharedJson(KEYS.TIMEOUT_RETRY_REQUEST, null);
    return request && typeof request === 'object' ? request : null;
  }

  function buildWorkflowCleanupRequestKey(request) {
    return `${norm(request?.azId || request?.ticketId || '')}|${norm(request?.requestedAt || '')}`;
  }

  function buildTimeoutRetryRequestKey(request) {
    return [
      norm(request?.scope || ''),
      norm(request?.timeoutContextKey || ''),
      String(Math.max(0, Number(request?.attempt || 0) || 0)),
      norm(request?.requestedAt || '')
    ].join('|');
  }

  function markExternalWake(reason = 'external') {
    state.externalWakeTick = Date.now();
    if (reason) {
      log(`Wake trigger noticed | ${reason}`, 'info');
    }
  }

  function consumeFinisherCloseSignal(ticketId) {
    const wantedId = norm(ticketId || '');
    const signal = readFinisherCloseSignal();
    if (!signal || signal.ready !== true) return false;

    const signalId = norm(signal.ticketId || signal.azId || '');
    const closedAtMs = Date.parse(norm(signal.closedAt || ''));
    if (!signalId) {
      clearFinisherCloseSignal();
      return false;
    }

    if (Number.isFinite(closedAtMs) && (Date.now() - closedAtMs) > (10 * 60 * 1000)) {
      clearFinisherCloseSignal();
      return false;
    }

    if (wantedId && signalId !== wantedId) {
      // Mismatched signal is for a previous ticket. Clear if older than 60s so
      // it doesn't linger all the way to the 10-min emergency cutoff and pollute
      // every subsequent wait loop poll.
      if (Number.isFinite(closedAtMs) && (Date.now() - closedAtMs) > 60 * 1000) {
        clearFinisherCloseSignal();
        log(`Discarded stale finisher close signal | ${signalId}`, 'info');
      }
      return false;
    }

    clearFinisherCloseSignal();
    log(`Received finisher close trigger | ${signalId}`, 'ok');
    return true;
  }

  function consumeWorkflowCleanupRequest(ticketId) {
    const wantedId = norm(ticketId || '');
    const request = readWorkflowCleanupRequest();
    if (!request || request.ready !== true) return false;

    const requestId = norm(request.azId || request.ticketId || '');
    const requestKey = buildWorkflowCleanupRequestKey(request);
    const requestedAtMs = Date.parse(norm(request.requestedAt || ''));
    if (!requestId || !requestKey) return false;

    if (Number.isFinite(requestedAtMs) && (Date.now() - requestedAtMs) > (10 * 60 * 1000)) {
      return false;
    }

    if (wantedId && requestId !== wantedId) return false;
    if (readSession(SS_KEYS.LAST_WORKFLOW_CLEANUP_REQUEST_HANDLED) === requestKey) return false;

    writeSession(SS_KEYS.LAST_WORKFLOW_CLEANUP_REQUEST_HANDLED, requestKey);
    log(`Received workflow cleanup trigger | ${requestId}`, 'ok');
    return true;
  }

  function consumeTimeoutRetryRequest(ticketId) {
    const wantedId = norm(ticketId || '');
    const request = readTimeoutRetryRequest();
    if (!request || request.ready !== true) return null;

    const requestId = norm(request.azId || request.ticketId || '');
    const requestKey = buildTimeoutRetryRequestKey(request);
    const requestedAtMs = Date.parse(norm(request.requestedAt || ''));
    if (!requestId || !requestKey) return null;

    if (Number.isFinite(requestedAtMs) && (Date.now() - requestedAtMs) > (10 * 60 * 1000)) {
      clearTimeoutRetryRequest();
      return null;
    }

    if (wantedId && requestId !== wantedId) return null;
    if (readSession(SS_KEYS.LAST_TIMEOUT_RETRY_REQUEST_HANDLED) === requestKey) return null;

    writeSession(SS_KEYS.LAST_TIMEOUT_RETRY_REQUEST_HANDLED, requestKey);
    clearTimeoutRetryRequest();
    log(
      `Received timeout quote retry trigger | ${requestId} | ` +
      `attempt ${Math.max(0, Number(request.attempt || 0) || 0)}/${Math.max(0, Number(request.maxAttempts || 0) || 0)}`,
      'warn'
    );
    return request;
  }

  function consumeFinalPayloadReady(ticketId, minSignalMs = 0) {
    const wantedId = norm(ticketId || '');
    if (!wantedId) return false;

    const ready = readSharedJson(KEYS.FINAL_READY, null);
    const payload = readSharedJson(KEYS.FINAL_PAYLOAD, null);
    const finalId = norm(ready?.azId || payload?.azId || '');
    if (!finalId || finalId !== wantedId) return false;

    const timeCandidates = [
      ready?.savedAt,
      ready?.signalPostedAt,
      payload?.savedAt,
      payload?.signalPostedAt
    ].map((value) => Date.parse(norm(value || ''))).filter(Number.isFinite);

    if (minSignalMs && timeCandidates.length && Math.max(...timeCandidates) < (minSignalMs - 2000)) {
      return false;
    }

    return true;
  }

  function consumeFinisherWakeTrigger(ticketId) {
    if (consumeFinisherCloseSignal(ticketId)) return true;
    if (consumeWorkflowCleanupRequest(ticketId)) return true;
    return false;
  }

  async function relaunchHomeQuoteAfterTimeout(ticketId, options = {}, request = null) {
    const cleanTicketId = norm(ticketId || '');
    const attempt = Math.max(0, Number(request?.attempt || 0) || 0);
    const maxAttempts = Math.max(0, Number(request?.maxAttempts || 0) || 0);
    const attemptLabel = attempt && maxAttempts ? ` (${attempt}/${maxAttempts})` : '';

    clearFinisherCloseSignal();
    clearMissingPayloadTrigger();

    const openInfo = getOpenTicketInfo();
    if (
      options.card instanceof Element
      && (!isTicketDrawerOpen() || String(openInfo.ticketId || '') !== String(cleanTicketId))
    ) {
      const reopened = await openCard(options.card, cleanTicketId);
      log(
        reopened
          ? `Reopened ticket for timeout retry${attemptLabel} | ${cleanTicketId}`
          : `Could not reopen ticket for timeout retry${attemptLabel} | ${cleanTicketId}`,
        reopened ? 'ok' : 'error'
      );
      if (!reopened) return false;
    }

    clearMirroredFinalPayloadForNewRun(cleanTicketId);
    log(`Retrying Farmers Home Quote after Alta timeout${attemptLabel} | ${cleanTicketId}`, 'warn');
    const quoteStarted = await startQuoteFlow();
    if (!quoteStarted) {
      log(`Timeout retry quote click failed${attemptLabel} | ${cleanTicketId}`, 'error');
      return false;
    }

    markTimeoutRetryLaunched(request);
    log(`Timeout retry quote relaunched${attemptLabel} | ${cleanTicketId}`, 'ok');
    return true;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForWakeOrTimeout(ms) {
    const wakeTick = state.externalWakeTick;
    const end = Date.now() + ms;
    while (state.running && !state.destroyed && Date.now() < end) {
      if (state.externalWakeTick !== wakeTick) return true;
      await sleep(Math.min(120, Math.max(0, end - Date.now())));
    }
    return state.running && !state.destroyed;
  }

  function norm(v) {
    return String(v || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lower(v) {
    return norm(v).toLowerCase();
  }

  function shouldClearWorkflowKey(key) {
    if (!key) return false;
    if (CLEAR_EXACT_KEYS.has(key)) return true;
    return CLEAR_PREFIXES.some(prefix => key.startsWith(prefix));
  }

  function clearStorageWorkflowKeys(storageObj) {
    if (!storageObj) return 0;
    const keys = [];
    try {
      for (let i = 0; i < storageObj.length; i++) {
        const key = storageObj.key(i);
        if (key && shouldClearWorkflowKey(key)) keys.push(key);
      }
    } catch {}

    let cleared = 0;
    for (const key of keys) {
      try {
        storageObj.removeItem(key);
        cleared += 1;
      } catch {}
    }
    return cleared;
  }

  function clearTransientWorkflowData() {
    let cleared = 0;
    cleared += clearStorageWorkflowKeys(localStorage);
    cleared += clearStorageWorkflowKeys(sessionStorage);

    for (const key of CLEAR_EXACT_KEYS) {
      try {
        GM_deleteValue(key);
        cleared += 1;
      } catch {}
    }

    return cleared;
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isFrontTab() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  async function waitUntilFrontStable(ms = CFG.frontStableMs) {
    let stableSince = 0;

    while (state.running && !state.destroyed) {
      if (isFrontTab()) {
        if (!stableSince) {
          stableSince = Date.now();
          state.bgPauseLogged = false;
        }
        if ((Date.now() - stableSince) >= ms) {
          setStatus(`RUNNING (${state.mode ? state.mode.toUpperCase() : 'â€”'})`);
          return true;
        }
      } else {
        stableSince = 0;
        setStatus('PAUSED BACKGROUND');
        if (!state.bgPauseLogged) {
          log('Paused in background. Waiting to return to front...', 'warn');
          state.bgPauseLogged = true;
        }
      }
      await sleep(120);
    }

    return false;
  }

  async function foregroundSleep(ms) {
    const end = Date.now() + ms;
    while (state.running && !state.destroyed && Date.now() < end) {
      const ok = await waitUntilFrontStable(0);
      if (!ok) return false;
      await sleep(Math.min(120, Math.max(0, end - Date.now())));
    }
    return state.running && !state.destroyed;
  }

  async function waitForHiddenThenFrontStable() {
    const start = Date.now();

    while (state.running && !state.destroyed && (Date.now() - start) < CFG.waitForHideAfterQuoteMs) {
      if (!isFrontTab()) {
        log('Quote click sent tab/background transition detected', 'info');
        return await waitUntilFrontStable(CFG.frontStableMs);
      }
      await sleep(120);
    }

    return await waitUntilFrontStable(CFG.frontStableMs);
  }

  function strongClick(el) {
    if (!el) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}

    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
    }

    try { el.click(); } catch {}
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
        document.querySelectorAll('a[data-toggle="tab"]').forEach(a => a.classList.remove('active'));
        anchor.classList.add('active');

        document.querySelectorAll('.tab-pane').forEach(p => {
          p.classList.remove('active', 'show');
        });

        const pane = document.querySelector(href);
        if (pane) pane.classList.add('active', 'show');
      }
    } catch {}

    return true;
  }

  function log(msg, kind = 'info') {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift({ line, kind });
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    renderLogs();
    persistLogsThrottled();

    if (kind === 'error') console.error(`[${SCRIPT_NAME}] ${msg}`);
    else console.log(`[${SCRIPT_NAME}] ${msg}`);
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

  function renderLogs() {
    if (!state.ui.logs) return;
    state.ui.logs.innerHTML = state.logs.map(item =>
      `<div class="hb-az-log ${item.kind}">${escapeHtml(item.line)}</div>`
    ).join('');
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

  function getActivityAzId() {
    return norm(state.ui?.lastId?.textContent || '');
  }

  function deriveActivityStateFromStatus(text) {
    const status = norm(text).toLowerCase();
    if (!state.running && !state.busy) return 'stopped';
    if (status.includes('paused')) return 'paused';
    if (status.includes('running') || status.includes('starting') || status.includes('restoring') || status.includes('reloading')) return 'working';
    if (status.includes('waiting') || status.includes('refresh required')) return 'waiting';
    if (status.includes('failed') || status.includes('fatal')) return 'error';
    if (status.includes('complete') || status.includes('done')) return 'done';
    if (status.includes('stopped')) return 'stopped';
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
      azId: getActivityAzId(),
      updatedAt: new Date().toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeScriptActivityMap(current);
  }

  function updateLastId(id) {
    if (state.ui.lastId) state.ui.lastId.textContent = id || 'â€”';
  }

  function buildUi() {
    if (document.getElementById('hb-az-stage-runner-panel')) return;

    const style = document.createElement('style');
    style.id = 'hb-az-stage-runner-style';
    style.textContent = `
      #hb-az-stage-runner-panel{
        position:fixed;
        right:${CFG.panelRight}px;
        bottom:${CFG.panelBottom}px;
        width:270px;
        max-width:calc(100vw - 24px);
        max-height:calc(100vh - 24px);
        background:rgba(16,20,27,.96);
        color:#eef3f7;
        border:1px solid rgba(255,255,255,.12);
        border-radius:12px;
        box-shadow:0 8px 20px rgba(0,0,0,.28);
        z-index:${CFG.zIndex};
        font:12px/1.35 Arial,sans-serif;
        overflow:hidden;
      }
      #hb-az-stage-runner-panel *{ box-sizing:border-box; }
      #hb-az-stage-runner-head{
        padding:8px 10px;
        background:rgba(255,255,255,.06);
        cursor:move;
        user-select:none;
        display:flex;
        justify-content:space-between;
        gap:8px;
      }
      #hb-az-stage-runner-title{ font-weight:700; }
      #hb-az-stage-runner-ver{ font-size:11px; opacity:.8; }
      #hb-az-stage-runner-body{ padding:10px; }
      #hb-az-stage-runner-mini{
        display:flex;
        gap:6px;
        margin-bottom:8px;
      }
      #hb-az-stage-runner-mini button{
        flex:1;
        border:1px solid rgba(255,255,255,.12);
        color:#eef3f7;
        border-radius:8px;
        padding:7px 8px;
        cursor:pointer;
        font-weight:700;
        font-size:12px;
        background:#1f2937;
      }
      #hb-az-stage-runner-mini button:hover{ filter:brightness(1.08); }
      #hb-az-stage-runner-mini button[data-active="1"]{
        background:rgba(80,160,255,.25);
        border-color:rgba(120,180,255,.65);
      }
      #hb-az-stage-runner-start[data-running="1"]{ background:#991b1b; }
      #hb-az-stage-runner-start[data-running="0"]{ background:#166534; }
      #hb-az-stage-runner-stop{ background:#991b1b; }
      #hb-az-stage-runner-mini button:disabled{
        opacity:.65;
        cursor:not-allowed;
        filter:none;
      }
      #hb-az-stage-runner-status{
        font-weight:700;
        color:#93c5fd;
        margin-bottom:8px;
      }
      #hb-az-stage-runner-meta{
        display:grid;
        grid-template-columns:60px 1fr;
        gap:4px 8px;
        margin-bottom:8px;
      }
      #hb-az-stage-runner-meta .k{ opacity:.82; }
      #hb-az-stage-runner-logs{
        max-height:160px;
        overflow:auto;
        background:rgba(0,0,0,.18);
        border:1px solid rgba(255,255,255,.08);
        border-radius:8px;
        padding:8px;
        white-space:pre-wrap;
        word-break:break-word;
        font-family:Consolas, monospace;
        font-size:11px;
      }
      .hb-az-log{
        padding:3px 0;
        border-top:1px solid rgba(255,255,255,.06);
      }
      .hb-az-log:first-child{ border-top:0; }
      .hb-az-log.ok{ color:#86efac; }
      .hb-az-log.warn{ color:#fcd34d; }
      .hb-az-log.error{ color:#fca5a5; }
      .hb-az-log.info{ color:#dbeafe; }
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'hb-az-stage-runner-panel';
    panel.setAttribute('data-hb-script-id', SCRIPT_ID);
    panel.innerHTML = `
      <div id="hb-az-stage-runner-head">
        <div id="hb-az-stage-runner-title">${SCRIPT_NAME}</div>
        <div id="hb-az-stage-runner-ver">V${VERSION}</div>
      </div>
      <div id="hb-az-stage-runner-body">
        <div id="hb-az-stage-runner-mini">
          <button type="button" id="hb-az-stage-runner-home">Home</button>
          <button type="button" id="hb-az-stage-runner-start" data-running="0">Start</button>
          <button type="button" id="hb-az-stage-runner-stop">Stop</button>
        </div>
        <div id="hb-az-stage-runner-status">STOPPED</div>
        <div id="hb-az-stage-runner-meta">
          <div class="k">Stage</div><div id="hb-az-stage-runner-stage">${escapeHtml(CFG.stageLabelFallback)}</div>
          <div class="k">Mode</div><div id="hb-az-stage-runner-mode">â€”</div>
          <div class="k">Page</div><div id="hb-az-stage-runner-page">â€”</div>
          <div class="k">Last ID</div><div id="hb-az-stage-runner-lastid">â€”</div>
        </div>
        <div id="hb-az-stage-runner-logs"></div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    state.ui.root = panel;
    state.ui.head = panel.querySelector('#hb-az-stage-runner-head');
    state.ui.home = panel.querySelector('#hb-az-stage-runner-home');
    state.ui.start = panel.querySelector('#hb-az-stage-runner-start');
    state.ui.stop = panel.querySelector('#hb-az-stage-runner-stop');
    state.ui.status = panel.querySelector('#hb-az-stage-runner-status');
    state.ui.stage = panel.querySelector('#hb-az-stage-runner-stage');
    state.ui.mode = panel.querySelector('#hb-az-stage-runner-mode');
    state.ui.page = panel.querySelector('#hb-az-stage-runner-page');
    state.ui.lastId = panel.querySelector('#hb-az-stage-runner-lastid');
    state.ui.logs = panel.querySelector('#hb-az-stage-runner-logs');

    makeDraggable(panel, state.ui.head);
  }

  function bindUi() {
    state.ui.home?.addEventListener('click', () => {
      state.mode = 'home';
      saveMode(state.mode);
      syncUi();
      log('Mode set: Home', 'info');
    });

    state.ui.start?.addEventListener('click', () => {
      if (state.running || state.busy || state.pendingStartTimer || state.pendingReloadTimer) return;
      startRun(false);
    });

    state.ui.stop?.addEventListener('click', () => {
      stopRun('Stopped', { manual: true });
    });
  }

  function syncUi() {
    if (!state.ui.root) return;

    const hasPendingTimers = !!state.pendingStartTimer || !!state.pendingReloadTimer;
    const canStart = !state.running && !state.busy && !hasPendingTimers;
    const canStop = state.running || state.busy || hasPendingTimers || state.refreshRequiredThisLoad || state.frontIdleReloadPending;

    state.ui.home.dataset.active = '1';
    state.ui.start.dataset.running = state.running ? '1' : '0';
    state.ui.start.textContent = 'Start';
    state.ui.start.disabled = !canStart;
    state.ui.stop.disabled = !canStop;
    state.ui.stage.textContent = getCurrentStageName() || CFG.stageLabelFallback;
    state.ui.mode.textContent = state.mode ? state.mode.toUpperCase() : 'â€”';
  }

  function startRun(isRestore = false) {
    if (!isRestore) clearMissingPayloadHandoffPause();

    if (state.refreshRequiredThisLoad) {
      state.running = false;
      saveRunning(false);
      persistState();
      syncUi();
      setStatus('REFRESH REQUIRED');
      log('Refresh required before next ticket on this page load', 'warn');
      return;
    }

    if (!state.mode) {
      state.running = false;
      saveRunning(false);
      syncUi();
      state.mode = 'home';
      saveMode(state.mode);
      setStatus('Home mode restored');
      log('Home mode restored', 'warn');
      return;
    }

    state.running = true;
    saveRunning(true);
    persistState();

    if (!isRestore) {
      state.processedIds.clear();
      state.bgPauseLogged = false;
      syncUi();
      state.mode = 'home';
      saveMode(state.mode);
      setStatus('RELOADING (HOME)');
      const cleared = clearTransientWorkflowData();
      log(`Cleared ${cleared} transient workflow key${cleared === 1 ? '' : 's'} before fresh run`, 'ok');
      log('Reloading before run | mode=HOME', 'info');
      setBootstrapReloadToken();
      schedulePendingReload(() => {
        if (!state.destroyed) reloadToPipelineRoot();
      }, 120);
      return;
    }

    if (state.busy) {
      syncUi();
      return;
    }

    state.busy = false;
    state.bgPauseLogged = false;
    syncUi();
    state.mode = 'home';
    saveMode(state.mode);
    setStatus('RUNNING (HOME)');
    log(isRestore ? 'Restored | mode=HOME' : 'Started | mode=HOME', 'ok');

    runLoop().catch(err => {
      handleRunLoopFatal(err).catch(fallbackErr => {
        log(`Fatal fallback failed: ${fallbackErr?.message || fallbackErr}`, 'error');
        stopRun('Error');
      });
    });
  }

  async function handleRunLoopFatal(err) {
    if (state.fatalFallbackInFlight) return;

    const message = norm(err?.message || err || 'Unknown launcher error') || 'Unknown launcher error';
    log(`Fatal: ${message}`, 'error');

    const openTicket = getOpenTicketInfo();
    const activeTicketId = norm(state.activeTicketId || openTicket.ticketId || '');
    const openTicketId = norm(openTicket.ticketId || '');
    const canFailCurrentTicket = !!(
      activeTicketId
      && openTicketId
      && openTicketId === activeTicketId
      && isTicketDrawerOpen()
    );

    if (!canFailCurrentTicket) {
      stopRun('Error');
      return;
    }

    state.fatalFallbackInFlight = true;
    state.busy = true;
    syncUi();

    try {
      clearFinisherCloseSignal();
      clearMissingPayloadTrigger();
      publishMissingPayloadTrigger(activeTicketId, `LAUNCHER ERROR: ${message}`);
      const handoffPause = setMissingPayloadHandoffPause(activeTicketId, `LAUNCHER ERROR: ${message}`);
      setStatus('LAUNCHER ERROR HANDED TO FINISHER');
      clearDockHighlight();
      startMissingPayloadHandoffMonitor(handoffPause);
      stopRun('Launcher error handed to finisher', { manual: true });
    } finally {
      state.fatalFallbackInFlight = false;
      if (!state.running) state.busy = false;
      syncUi();
    }
  }

  function stopRun(reason = 'Stopped', { manual = false } = {}) {
    clearPendingActionTimers();
    resetFrontIdleReloadState();
    if (manual) {
      state.refreshRequiredThisLoad = false;
      setBootstrapReloadMode('');
      clearBootstrapReloadToken();
    }
    state.running = false;
    saveRunning(false);
    persistState();
    state.busy = false;
    syncUi();
    setStatus(reason.toUpperCase());
    log(reason, 'warn');
  }

  function blockUntilRefresh(ticketId = '') {
    const cleanTicketId = norm(ticketId || '');
    state.refreshRequiredThisLoad = true;
    state.running = false;
    state.busy = false;
    state.mode = 'home';
    saveMode(state.mode);
    setBootstrapReloadMode('home');
    setBootstrapReloadToken();
    saveRunning(false);
    persistState();
    syncUi();
    setStatus('REFRESH REQUIRED');
    updateLastId(cleanTicketId || '');
    markFrontIdleActivity();
    state.frontIdleLastSignature = getFrontIdleSignature();
    log(`Refresh required before next ticket${cleanTicketId ? ` | ${cleanTicketId}` : ''}`, 'warn');
    schedulePendingReload(() => {
      if (!state.destroyed) reloadToPipelineRoot();
    }, 120);
  }

  async function runLoop() {
    if (state.busy) return;
    state.busy = true;

    try {
      while (state.running && !state.destroyed) {
        await waitUntilFrontStable(CFG.frontStableMs);

        const stageWrap = getStageWrap();
        if (!stageWrap) {
          setStatus('Waiting stage');
          log('Stage not found: first visible pipeline stage is missing', 'warn');
          await sleep(1000);
          continue;
        }

        const filterReady = await ensureIgnoredTagsFilter();
        if (!filterReady) {
          setStatus('Ignored tags failed');
          log(`Failed to apply ${CFG.savedQueryName} filter`, 'error');
          await sleep(1000);
          continue;
        }

        const cards = getStageCards();
        const pageLabel = getStagePageLabel();
        if (state.ui.page) state.ui.page.textContent = pageLabel || 'â€”';

        if (!cards.length) {
          const moved = await goNextPage();
          if (!moved) {
            log(`Done. No cards found with ${CFG.savedQueryName}.`, 'ok');
            stopRun('Done');
            return;
          }
          log(`Next page | ${getStagePageLabel() || '...'}`, 'info');
          await foregroundSleep(CFG.pageWaitMs);
          continue;
        }

        const card = cards.find((candidate) => {
          const ticketId = norm(candidate.getAttribute('data-id'));
          return ticketId && !state.processedIds.has(ticketId);
        });

        if (!card) {
          const moved = await goNextPage();
          if (!moved) {
            log(`Done. No unprocessed cards left in ${CFG.savedQueryName}.`, 'ok');
            stopRun('Done');
            return;
          }
          log(`Next page | ${getStagePageLabel() || '...'}`, 'info');
          await foregroundSleep(CFG.pageWaitMs);
          continue;
        }

        const ticketId = norm(card.getAttribute('data-id'));
        const cardName = norm(card.querySelector(SEL.customerLink)?.textContent);

        state.activeTicketId = ticketId;
        updateLastId(ticketId);
        highlightCard(card, 'checking');
        log(`Opening | ${ticketId} | ${cardName || 'Unknown'}`, 'info');

        const opened = await openCard(card, ticketId);
        if (!opened) {
          highlightCard(card, 'error');
          log(`OPEN FAILED | ${ticketId}`, 'error');
          stopRun('OPEN FAILED');
          return;
        }

        highlightDock('grab');

        const ready = await ensureMainAndPayloadReady({ ticketId, cardName, pageLabel });
        if (!ready) {
          highlightCard(card, 'error');
          log(`MAIN/PAYLOAD FAILED | ${ticketId}`, 'error');
          const failure = recordMainPayloadFailure(ticketId, 'MAIN/PAYLOAD FAILED');
          log(`Main payload failure count | ${ticketId} | ${failure.count}`, failure.repeated ? 'error' : 'warn');
          clearFinisherCloseSignal();
          clearMissingPayloadTrigger();
          publishMissingPayloadTrigger(ticketId, 'MAIN/PAYLOAD FAILED');
          const handoffPause = setMissingPayloadHandoffPause(ticketId, 'MAIN/PAYLOAD FAILED');
          setStatus('MAIN/PAYLOAD FAILED HANDED TO FINISHER');
          clearDockHighlight();
          log(`Launcher stopped after missing Main data; finisher owns failed note/tag/close for ${ticketId}`, 'warn');
          startMissingPayloadHandoffMonitor(handoffPause);
          stopRun('Missing payload handed to finisher', { manual: true });
          return;
        }

        clearMainPayloadFailure(ticketId);
        savePayload(ready.payload);
        saveSharedJob(ready.payload);
        highlightCard(card, 'saved');
        writeScanState('payload-saved', ready.payload.ticketId, pageLabel);
        log(`Payload saved + shared | ${ready.payload.ticketId} | ${ready.filledCount}/${FIELD_ORDER.length}`, 'ok');
        clearFinisherCloseSignal();
        clearMirroredFinalPayloadForNewRun(ticketId);

        const quoteStarted = await startQuoteFlow();
        if (!quoteStarted) {
          highlightCard(card, 'error');
          log(`QUOTES FAILED | ${ticketId}`, 'error');
          stopRun('QUOTES FAILED');
          return;
        }

        const ticketClosed = await waitForTicketClosedByFinisher(ticketId, { card });
        if (!ticketClosed) return;

        state.processedIds.add(ticketId);
        clearMissingPayloadTrigger();
        clearDockHighlight();
        blockUntilRefresh(ticketId);
        return;
      }
    } finally {
      state.busy = false;
    }
  }

  async function startQuoteFlow() {
    await waitUntilFrontStable(CFG.frontStableMs);

    log(`Waiting ${Math.ceil(CFG.quotePreWaitMs / 1000)}s before Quotes click`, 'info');
    const okWait = await foregroundSleep(CFG.quotePreWaitMs);
    if (!okWait) return false;

    const quotesOk = await ensureQuotesAreaReady();
    if (!quotesOk) return false;

    await foregroundSleep(450);

    const modeLabel = 'Farmers Home Quote';
    const modeOk = await clickHomeQuoteLinkWithRetry(modeLabel, 8);
    if (!modeOk) return false;

    log(`${modeLabel} clicked. Waiting for background/return...`, 'info');
    await waitForHiddenThenFrontStable();

    log('Returned to front and stable for 3s', 'ok');
    return true;
  }

  async function waitForTicketClosedByFinisher(ticketId, options = {}) {
    let lastLogAt = 0;
    let drawerHiddenLogged = false;
    let finalPayloadReadyLogged = false;
    let mismatchFallbackSent = false;
    let directFailureHandoffStarted = false;
    let waitStartedAt = Date.now();
    const maxWaitMs = Math.max(0, Number(options.maxWaitMs || 0));
    const timeoutLabel = norm(options.timeoutLabel || 'finisher');

    while (state.running && !state.destroyed) {
      if (!(await waitForAuthHealthy('waiting for finisher'))) return false;
      if (maxWaitMs && (Date.now() - waitStartedAt) >= maxWaitMs) {
        log(`Timed out waiting for ${timeoutLabel} close trigger | ${ticketId}`, 'error');
        return false;
      }

      const timeoutRetryRequest = consumeTimeoutRetryRequest(ticketId);
      if (timeoutRetryRequest) {
        const relaunched = await relaunchHomeQuoteAfterTimeout(ticketId, options, timeoutRetryRequest);
        if (relaunched) {
          lastLogAt = 0;
          drawerHiddenLogged = false;
          finalPayloadReadyLogged = false;
          mismatchFallbackSent = false;
          waitStartedAt = Date.now();
          continue;
        }
      }

      if (consumeFinisherWakeTrigger(ticketId)) {
        return true;
      }

      const directMissingPayloadTrigger = getActiveMissingPayloadTriggerForTicket(ticketId);
      if (directMissingPayloadTrigger) {
        const reason = norm(directMissingPayloadTrigger.reason || 'MAIN/PAYLOAD FAILED') || 'MAIN/PAYLOAD FAILED';
        if (!directFailureHandoffStarted) {
          directFailureHandoffStarted = true;
          log(`Direct missing payload trigger received while waiting for finisher | ${ticketId} | ${reason}`, 'warn');
        }

        let openInfo = getOpenTicketInfo();
        let ticketReadyForFinisher = isTicketDrawerOpen() && String(openInfo.ticketId || '') === String(ticketId);
        if (!ticketReadyForFinisher && options.card instanceof Element) {
          const reopened = await openCard(options.card, ticketId);
          log(reopened ? `Reopened ticket for direct failed path | ${ticketId}` : `Could not reopen ticket for direct failed path | ${ticketId}`, reopened ? 'ok' : 'error');
          openInfo = getOpenTicketInfo();
          ticketReadyForFinisher = isTicketDrawerOpen() && String(openInfo.ticketId || '') === String(ticketId);
        }

        if (!ticketReadyForFinisher) {
          setStatus('Waiting to reopen failed ticket');
          await waitForWakeOrTimeout(CFG.ticketClosePollMs);
          continue;
        }

        clearFinisherCloseSignal();
        const handoffPause = setMissingPayloadHandoffPause(ticketId, reason);
        setStatus('DIRECT FAIL HANDOFF ACTIVE');
        clearDockHighlight();
        log(`Launcher handed direct failed path to finisher | ${ticketId}`, 'warn');
        startMissingPayloadHandoffMonitor(handoffPause);
        stopRun('Missing payload handed to finisher', { manual: true });
        return false;
      }

      if (!finalPayloadReadyLogged && consumeFinalPayloadReady(ticketId, waitStartedAt)) {
        finalPayloadReadyLogged = true;
        log(`Final Home payload ready for AZ ${ticketId}; waiting for finisher to fill fields/tag/close`, 'ok');
      }

      if (!finalPayloadReadyLogged && !mismatchFallbackSent && (Date.now() - waitStartedAt) >= CFG.payloadMismatchFailMs) {
        mismatchFallbackSent = true;
        clearFinisherCloseSignal();
        clearMissingPayloadTrigger();
        publishMissingPayloadTrigger(ticketId, 'PAYLOAD DOES NOT MATCH AFTER 20 SECONDS');
        log(`No matching final Home payload after 20s; failed path owns ticket ${ticketId}`, 'warn');

        if (options.card instanceof Element && (!isTicketDrawerOpen() || String(getOpenTicketInfo().ticketId || '') !== String(ticketId))) {
          const reopened = await openCard(options.card, ticketId);
          log(reopened ? `Reopened ticket for failed path | ${ticketId}` : `Could not reopen ticket for failed path | ${ticketId}`, reopened ? 'ok' : 'error');
        }
      }

      const info = getOpenTicketInfo();
      if (!isTicketDrawerOpen() || !String(info.ticketId || '')) {
        if (!drawerHiddenLogged) {
          drawerHiddenLogged = true;
          log(`Ticket drawer hidden before finisher signal; waiting for finisher close trigger | ${ticketId}`, 'warn');
        }
        await waitForWakeOrTimeout(CFG.ticketClosePollMs);
        continue;
      }

      if (String(info.ticketId || '') !== String(ticketId) && String(info.ticketId || '') !== '') {
        log(`Ticket changed while waiting for finisher close | expected ${ticketId} got ${info.ticketId}`, 'error');
        stopRun('TICKET CHANGED');
        return false;
      }

      const now = Date.now();
      if (!lastLogAt || (now - lastLogAt) >= CFG.ticketCloseLogEveryMs) {
        log(`Waiting for finisher to close ${ticketId}...`, 'warn');
        lastLogAt = now;
      }

      const ok = await waitForWakeOrTimeout(CFG.ticketClosePollMs);
      if (!ok) return false;
    }

    return false;
  }

  function getCurrentSavedQueryLabel() {
    return norm(document.querySelector(SEL.savedQueryLabel)?.textContent || document.querySelector(SEL.savedQueryButton)?.textContent || '');
  }

  function isIgnoredTagsSelected() {
    return lower(getCurrentSavedQueryLabel()) === lower(CFG.savedQueryName);
  }

  function isSavedQueryDropdownOpen() {
    const wrap = document.querySelector(SEL.savedQueryWrap);
    const btn = document.querySelector(SEL.savedQueryButton);
    return !!(
      wrap?.classList.contains('show') ||
      String(btn?.getAttribute('aria-expanded') || '').toLowerCase() === 'true'
    );
  }

  function findIgnoredTagsOption() {
    return [...document.querySelectorAll(SEL.savedQueryItems)]
      .filter(visible)
      .find((el) => lower(el.textContent) === lower(CFG.savedQueryName)) || null;
  }

  async function openSavedQueryDropdown() {
    const btn = document.querySelector(SEL.savedQueryButton);
    if (!btn || !visible(btn)) {
      log('Saved query filter button not found', 'error');
      return false;
    }

    if (isSavedQueryDropdownOpen()) return true;

    strongClick(btn);
    await sleep(220);
    if (isSavedQueryDropdownOpen()) return true;

    try {
      const $ = window.jQuery || window.$;
      if ($ && typeof $(btn).dropdown === 'function') {
        $(btn).dropdown('toggle');
        await sleep(220);
        if (isSavedQueryDropdownOpen()) return true;
      }
    } catch {}

    return isSavedQueryDropdownOpen();
  }

  async function ensureIgnoredTagsFilter() {
    if (isIgnoredTagsSelected()) return true;

    const opened = await openSavedQueryDropdown();
    if (!opened) {
      log(`Could not open saved query dropdown for ${CFG.savedQueryName}`, 'error');
      return false;
    }

    const item = findIgnoredTagsOption();
    if (!item) {
      log(`Saved query option not found: ${CFG.savedQueryName}`, 'error');
      return false;
    }

    strongClick(item);
    log(`Selected saved query: ${CFG.savedQueryName}`, 'info');

    const started = Date.now();
    while ((Date.now() - started) < 6000) {
      if (!state.running || state.destroyed) return false;
      if (isIgnoredTagsSelected()) {
        await foregroundSleep(CFG.filterSettleMs);
        return true;
      }
      await sleep(120);
    }

    log(`Saved query did not switch to ${CFG.savedQueryName}`, 'error');
    return false;
  }

  function getQuoteActionText(el) {
    if (!el) return '';

    const imgAlts = [...el.querySelectorAll?.('img[alt]') || []]
      .map(img => img.getAttribute('alt'))
      .filter(Boolean);

    return norm([
      el.textContent,
      el.getAttribute?.('title'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('data-original-title'),
      el.getAttribute?.('href'),
      ...imgAlts
    ].filter(Boolean).join(' '));
  }

  function scoreHomeQuoteAction(el, quotePane) {
    const haystack = lower(getQuoteActionText(el));
    if (!haystack || haystack.includes('auto')) return 0;

    let score = 0;
    if (haystack.includes('farmers home quote')) score += 120;
    if (haystack.includes('home quote')) score += 80;
    if (haystack.includes('farmers home')) score += 60;
    if (haystack.includes('homeowners quote')) score += 60;
    if (haystack.includes('home') && haystack.includes('quote')) score += 45;
    if (quotePane && quotePane.contains(el)) score += 20;
    if (el.matches?.('a[href], button, [role="button"]')) score += 5;

    return score;
  }

  function findHomeQuoteAction() {
    const quotePane = document.querySelector(SEL.quotePane);
    const roots = [quotePane, getOpenDockRoot(), document].filter(Boolean);
    const seen = new Set();
    let best = null;

    for (const root of roots) {
      const candidates = root.querySelectorAll('a, button, [role="button"], .btn, [onclick]');
      for (const el of candidates) {
        if (seen.has(el) || !visible(el)) continue;
        seen.add(el);

        const score = scoreHomeQuoteAction(el, quotePane);
        if (score <= 0) continue;

        if (!best || score > best.score) {
          best = { el, score, text: getQuoteActionText(el) };
        }
      }
    }

    return best;
  }

  async function ensureQuotesAreaReady() {
    const quotesTab = document.querySelector(SEL.quotesTab);
    if (!quotesTab || !visible(quotesTab)) {
      log('Quotes tab button not found', 'error');
      return false;
    }

    showBootstrapTab(quotesTab);
    log('Clicked: Quotes tab', 'info');

    const started = Date.now();
    while (Date.now() - started < CFG.quoteTabWaitMs) {
      if (!state.running || state.destroyed) return false;

      const pane = document.querySelector(SEL.quotePane);
      const homeQuoteAction = findHomeQuoteAction();

      if (pane && (pane.classList.contains('active') || pane.classList.contains('show') || visible(pane))) {
        if (homeQuoteAction?.el && visible(homeQuoteAction.el)) {
          log(`Quotes area ready | ${homeQuoteAction.text || 'Home quote action'}`, 'ok');
          return true;
        }
      }

      if ((Date.now() - started) > 1200 && (Date.now() - started) < 1800) {
        showBootstrapTab(quotesTab);
      }

      await sleep(120);
    }

    log('Quotes area did not become ready', 'error');
    return false;
  }

  async function clickHomeQuoteLinkWithRetry(label, tries = 4) {
    for (let i = 0; i < tries; i++) {
      const found = findHomeQuoteAction();
      if (found?.el && visible(found.el)) {
        strongClick(found.el);
        log(`Clicked: ${label}${found.text ? ` | ${found.text}` : ''}`, 'info');
        return true;
      }
      await foregroundSleep(250 + (i * 100));
    }

    log(`Not found: ${label}`, 'error');
    return false;
  }

  async function clickSelectorWithRetry(selector, label, tries = 4) {
    for (let i = 0; i < tries; i++) {
      const el = document.querySelector(selector);
      if (el && visible(el)) {
        strongClick(el);
        log(`Clicked: ${label}`, 'info');
        return true;
      }
      await foregroundSleep(220 + (i * 80));
    }

    log(`Not found: ${label}`, 'error');
    return false;
  }

  function getStageLabel(stageWrap = null) {
    const wrap = stageWrap instanceof Element ? stageWrap : null;
    return norm(wrap?.querySelector('.dd-header h2')?.textContent || '');
  }

  function getCurrentStageName() {
    return getStageLabel(getStageWrap()) || CFG.stageLabelFallback;
  }

  function getStageWrap() {
    return [...document.querySelectorAll(SEL.stageWrap)]
      .find((wrap) => visible(wrap) && !!wrap.parentElement) || null;
  }

  function getStageContainer() {
    return getStageWrap()?.parentElement || null;
  }

  function getStageCards() {
    const stage = getStageContainer();
    return stage ? [...stage.querySelectorAll(SEL.stageCards)] : [];
  }

  function getStagePageLabel() {
    return norm(getStageWrap()?.querySelector('.dd-pagination span')?.textContent || '');
  }

  function getStageNextPageBtn() {
    const btn = getStageWrap()?.querySelector('.dd-pagination a.next.paging.dd-pagination-arrow');
    if (!btn || !visible(btn) || btn.classList.contains('inactive')) return null;
    return btn;
  }

  function getCardTags(card) {
    return [...card.querySelectorAll('.dd-card-bottom .az-def-badges .az-def-badge')]
      .map(el => norm(el.textContent))
      .filter(Boolean);
  }

  function cardHasTag(card, tagText) {
    return getCardTags(card).some(t => lower(t) === lower(tagText));
  }

  function highlightCard(card, kind) {
    if (!card) return;
    card.style.outline = '';
    card.style.boxShadow = '';

    if (kind === 'skip') {
      card.style.outline = '3px solid #ef4444';
      card.style.boxShadow = '0 0 0 3px rgba(239,68,68,.20)';
    } else if (kind === 'checking') {
      card.style.outline = '3px solid #facc15';
      card.style.boxShadow = '0 0 0 3px rgba(250,204,21,.22)';
    } else if (kind === 'saved') {
      card.style.outline = '3px solid #22c55e';
      card.style.boxShadow = '0 0 0 3px rgba(34,197,94,.22)';
    } else if (kind === 'error') {
      card.style.outline = '3px solid #f97316';
      card.style.boxShadow = '0 0 0 3px rgba(249,115,22,.22)';
    }
  }

  function isTicketDrawerOpen() {
    const side = document.querySelector(SEL.dockSideActions);
    return !!(side && visible(side));
  }

  async function openCard(card, ticketId) {
    const currentOpen = getOpenTicketInfo().ticketId;
    if (currentOpen && currentOpen !== ticketId) {
      await closeTicket();
      await foregroundSleep(CFG.gapMs);
    }
    if (currentOpen && currentOpen === ticketId && isTicketDrawerOpen()) return true;
    if (isTicketDrawerOpen()) return true;

    const link = card.querySelector(SEL.customerLink);
    const targets = [link, card].filter(Boolean);
    const overallStart = Date.now();

    while (state.running && !state.destroyed && (Date.now() - overallStart) < CFG.openTotalMs) {
      await waitUntilFrontStable(CFG.frontStableMs);

      for (const target of targets) {
        if (!target) continue;

        strongClick(target);
        log(`Clicked ticket target, waiting 2s for drawer...`, 'info');

        const ok = await waitForOpenTicket(ticketId, CFG.openTryMs);
        if (ok) return true;
      }

      await foregroundSleep(220);
    }

    return false;
  }

  async function waitForOpenTicket(ticketId, timeoutMs) {
    const started = Date.now();
    let afterClickMark = 0;

    while (Date.now() - started < timeoutMs) {
      if (!state.running || state.destroyed) return false;

      const info = getOpenTicketInfo();

      if (String(info.ticketId || '') === String(ticketId)) {
        return true;
      }

      if (isTicketDrawerOpen()) {
        if (!afterClickMark) afterClickMark = Date.now();
        if ((Date.now() - afterClickMark) >= CFG.openCheckAfterClickMs) {
          log(`Drawer detected open from side-actions after 2s | ${ticketId}`, 'ok');
          return true;
        }
      } else {
        afterClickMark = 0;
      }

      await sleep(120);
    }

    return false;
  }

  function getOpenDockRoot() {
    return document.querySelector(SEL.dockRoot) || null;
  }

  function getOpenTicketInfo() {
    const root = getOpenDockRoot();
    if (!root) return { ticketId: '', name: '', tags: [] };

    const top = document.querySelector(SEL.dockTop) || root;
    const h3 = top.querySelector(SEL.topName) || root.querySelector(SEL.topName);

    let name = '';
    if (h3) {
      const clone = h3.cloneNode(true);
      clone.querySelector('.origin-vendor-sync')?.remove();
      name = norm(clone.textContent || '');
    }

    let ticketId = '';
    const syncNode = root.querySelector('.origin-vendor-sync');
    const syncText = norm(syncNode?.textContent || '');
    const m = syncText.match(/\bID:\s*(\d+)\b/i);
    if (m) ticketId = m[1];

    const tags = [...root.querySelectorAll(SEL.topTags)]
      .map(el => norm(el.textContent))
      .filter(Boolean);

    return { ticketId, name, tags };
  }

  function openTicketHasTag(tagText) {
    return getOpenTicketInfo().tags.some(t => lower(t) === lower(tagText));
  }

  function highlightDock(kind) {
    const root = getOpenDockRoot();
    if (!root) return;
    root.style.outline = '';
    root.style.boxShadow = '';

    if (kind === 'tagged') {
      root.style.outline = '3px solid #ef4444';
      root.style.boxShadow = '0 0 0 3px rgba(239,68,68,.20)';
    } else if (kind === 'grab') {
      root.style.outline = '3px solid #22c55e';
      root.style.boxShadow = '0 0 0 3px rgba(34,197,94,.22)';
    }
  }

  function clearDockHighlight() {
    const root = getOpenDockRoot();
    if (!root) return;
    root.style.outline = '';
    root.style.boxShadow = '';
  }

  function parseInitialValuesJson() {
    const input = document.querySelector(SEL.initialValues);
    if (!input) return null;

    const raw = input.value || input.getAttribute('value') || '';
    if (!raw) return null;

    let parsed = safeJsonParse(raw, null);
    if (parsed) return parsed;

    parsed = safeJsonParse(htmlDecode(raw), null);
    return parsed || null;
  }

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function htmlDecode(text) {
    const ta = document.createElement('textarea');
    ta.innerHTML = String(text || '');
    return ta.value;
  }

  function getSelectedText(select) {
    if (!select) return '';
    const opt = select.options?.[select.selectedIndex];
    if (opt && norm(opt.textContent)) return norm(opt.textContent);

    const bs = select.closest('.bootstrap-select');
    const txt = bs?.querySelector('.filter-option, .filter-option-inner-inner');
    return norm(txt?.textContent || '');
  }

  function readVal(selector) {
    const el = document.querySelector(selector);
    return norm(el?.value || el?.textContent || '');
  }

  function resolveLeadSourceText(initial) {
    const direct = getSelectedText(document.querySelector('#otherBaseLeadSourceId'));
    if (direct) return direct;
    return norm(initial?.otherLeadSourceText || '');
  }

  function resolveProducerText(initial) {
    const direct = getSelectedText(document.querySelector('#assignedTo'));
    if (direct) return direct;

    const badgeTitle = norm(document.querySelector('.dd-card-avatar .badge[title]')?.getAttribute('title'));
    if (badgeTitle) return badgeTitle;

    return norm(initial?.assignedToText || '');
  }

  function readAzFieldSnapshot(fallbackTicketId = '') {
    const initial = parseInitialValuesJson() || {};
    const cr = initial?.CustomerReferral || {};
    const openInfo = getOpenTicketInfo();

    const fields = {
      'AZ ID': firstNonEmpty(initial?.id, initial?.instaId, openInfo.ticketId, fallbackTicketId),
      'AZ Lead Source': firstNonEmpty(resolveLeadSourceText(initial)),
      'AZ Producer': firstNonEmpty(resolveProducerText(initial)),
      'AZ Name': firstNonEmpty(cr.firstname, readVal('#customerreferral-firstname')),
      'AZ Last': firstNonEmpty(cr.lastname, readVal('#customerreferral-lastname')),
      'AZ DOB': firstNonEmpty(cr.birthday, readVal('input[name="CustomerReferral[birthday]"]')),
      'AZ Phone': firstNonEmpty(cr.phone, readVal('#customerreferral-phone')),
      'AZ Email': firstNonEmpty(cr.email, readVal('#customerreferral-email')),
      'AZ Street Address': firstNonEmpty(cr.address1, readVal('#customerreferral-address1')),
      'AZ City': firstNonEmpty(cr.city, readVal('#customerreferral-city')),
      'AZ Country': firstNonEmpty(cr.country, readVal('#customerreferral-country')),
      'AZ State': firstNonEmpty(cr.state, readVal('#state')),
      'AZ Postal Code': firstNonEmpty(cr.zip, readVal('#customerreferral-zip')),
      'First Name': firstNonEmpty(cr.firstname, readVal('#customerreferral-firstname')),
      'Last Name': firstNonEmpty(cr.lastname, readVal('#customerreferral-lastname')),
      'Email': firstNonEmpty(cr.email, readVal('#customerreferral-email')),
      'Phone': firstNonEmpty(cr.phone, readVal('#customerreferral-phone')),
      'DOB': firstNonEmpty(cr.birthday, readVal('input[name="CustomerReferral[birthday]"]')),
      'Street Address': firstNonEmpty(cr.address1, readVal('#customerreferral-address1')),
      'City': firstNonEmpty(cr.city, readVal('#customerreferral-city')),
      'State': firstNonEmpty(cr.state, readVal('#state')),
      'Zip': firstNonEmpty(cr.zip, readVal('#customerreferral-zip'))
    };

    let filledCount = 0;
    for (const k of FIELD_ORDER) {
      if (norm(fields[k])) filledCount += 1;
    }

    return { fields, filledCount };
  }

  async function ensureMainAndPayloadReady(ctx) {
    const formReady = () => {
      const form = document.querySelector(SEL.detailForm);
      return !!(form && visible(form));
    };
    const paneReady = () => {
      const pane = document.querySelector(SEL.mainPane);
      return !!(pane && (pane.classList.contains('active') || pane.classList.contains('show') || visible(pane)));
    };
    const mainTabActive = () => {
      const mainTab = document.querySelector(SEL.mainTab);
      return !!(mainTab && mainTab.classList.contains('active'));
    };

    const mainTab = document.querySelector(SEL.mainTab);
    if (!mainTab || !visible(mainTab)) {
      log('Main tab button not found', 'error');
      return null;
    }

    showBootstrapTab(mainTab);
    log('Clicked: Main tab', 'info');

    const started = Date.now();
    let lastCount = -1;

    while (Date.now() - started < CFG.detailWaitMs) {
      if (!state.running || state.destroyed) return null;

      const snapshot = readAzFieldSnapshot(ctx.ticketId);
      const activeEnough = mainTabActive() || paneReady() || formReady();

      if (snapshot.filledCount !== lastCount) {
        lastCount = snapshot.filledCount;
        log(`Main payload count: ${snapshot.filledCount}/${FIELD_ORDER.length}`, snapshot.filledCount === FIELD_ORDER.length ? 'ok' : 'warn');
      }

      if (activeEnough && snapshot.filledCount === FIELD_ORDER.length) {
        log(`Main payload ready ${FIELD_ORDER.length}/${FIELD_ORDER.length}`, 'ok');
        return {
          filledCount: snapshot.filledCount,
          payload: {
            ticketId: snapshot.fields['AZ ID'],
            az: snapshot.fields,
            meta: {
              stageName: getCurrentStageName(),
              mode: state.mode,
              page: ctx.pageLabel || '',
              savedAt: nowIso(),
              url: location.href,
              openTicketName: getOpenTicketInfo().name || ctx.cardName || '',
              source: {
                initialValues: !!parseInitialValuesJson(),
                detailForm: !!document.querySelector(SEL.detailForm)
              }
            }
          }
        };
      }

      if ((Date.now() - started) > 1200 && (Date.now() - started) < 1800) {
        showBootstrapTab(mainTab);
      }

      await sleep(120);
    }

    return null;
  }

  function firstNonEmpty(...values) {
    for (const v of values) {
      const s = norm(v);
      if (s) return s;
    }
    return '';
  }

  function savePayload(payload) {
    const map = readJson(KEYS.PAYLOAD_MAP, {}) || {};
    map[payload.ticketId] = payload;

    writeJson(KEYS.PAYLOAD_MAP, map);
    writeJson(KEYS.LAST_PAYLOAD, payload);
    localStorage.setItem(KEYS.LAST_SAVED_ID, payload.ticketId);
    updateLastId(payload.ticketId);
  }

  function saveSharedJob(payload) {
    const shared = {
      ticketId: payload.ticketId,
      mode: state.mode,
      az: payload.az,
      altaHome: null,
      altaAuto: null,
      meta: {
        createdAt: payload.meta.savedAt,
        lastUpdatedAt: payload.meta.savedAt,
        source: 'az_stage_runner',
        url: payload.meta.url,
        stageName: payload.meta.stageName,
        page: payload.meta.page
      }
    };

    const currentJob = {
      'AZ ID': firstNonEmpty(payload.az?.['AZ ID'], payload.ticketId),
      'Name': [payload.az?.['AZ Name'], payload.az?.['AZ Last']].map(v => norm(v)).filter(Boolean).join(' ').trim(),
      'Mailing Address': [
        norm(payload.az?.['AZ Street Address']),
        norm(payload.az?.['AZ City']),
        norm(payload.az?.['AZ State']) && norm(payload.az?.['AZ Postal Code']) ? `${norm(payload.az?.['AZ State'])} ${norm(payload.az?.['AZ Postal Code'])}` : '',
      ].filter(Boolean).join(', ').replace('undefined', '').trim(),
      'SubmissionNumber': '',
      'updatedAt': payload.meta.savedAt,
      'First Name': firstNonEmpty(payload.az?.['First Name'], payload.az?.['AZ Name']),
      'Last Name': firstNonEmpty(payload.az?.['Last Name'], payload.az?.['AZ Last']),
      'Email': firstNonEmpty(payload.az?.['Email'], payload.az?.['AZ Email']),
      'Phone': firstNonEmpty(payload.az?.['Phone'], payload.az?.['AZ Phone']),
      'DOB': firstNonEmpty(payload.az?.['DOB'], payload.az?.['AZ DOB']),
      'Street Address': firstNonEmpty(payload.az?.['Street Address'], payload.az?.['AZ Street Address']),
      'City': firstNonEmpty(payload.az?.['City'], payload.az?.['AZ City']),
      'State': firstNonEmpty(payload.az?.['State'], payload.az?.['AZ State']),
      'Zip': firstNonEmpty(payload.az?.['Zip'], payload.az?.['AZ Postal Code'])
    };

    if (!currentJob['Mailing Address']) {
      currentJob['Mailing Address'] = [
        norm(payload.az?.['AZ Street Address']),
        norm(payload.az?.['AZ City']),
        norm(payload.az?.['AZ State']),
        norm(payload.az?.['AZ Postal Code'])
      ].filter(Boolean).join(', ').replace(/, ([A-Z]{2}), (\d{5}(?:-\d{4})?)$/, ', $1 $2').trim();
    }

    // Real localStorage mirrors on AZ origin
    try { writeJson(KEYS.SHARED_JOB, shared); } catch (err) {
      log(`Shared localStorage save failed: ${err?.message || err}`, 'error');
    }

    try { writeJson(KEYS.AZ_CURRENT_JOB, currentJob); } catch (err) {
      log(`AZ current job localStorage save failed: ${err?.message || err}`, 'error');
    }

    try { writeJson(KEYS.CURRENT_JOB, currentJob); } catch (err) {
      log(`Current job localStorage save failed: ${err?.message || err}`, 'error');
    }

    // Keep GM mirrors too
    try { GM_setValue(KEYS.SHARED_JOB, shared); } catch (err) {
      log(`Shared GM save failed: ${err?.message || err}`, 'error');
    }

    try { GM_setValue(KEYS.AZ_CURRENT_JOB, currentJob); } catch (err) {
      log(`AZ current job GM save failed: ${err?.message || err}`, 'error');
    }

    try { GM_setValue(KEYS.CURRENT_JOB, currentJob); } catch (err) {
      log(`Current job GM save failed: ${err?.message || err}`, 'error');
    }

    log(`Saved shared/current job | Ticket ID ${currentJob['AZ ID'] || payload.ticketId}`, 'ok');
  }

  function writeScanState(action, ticketId, pageLabel) {
    writeJson(KEYS.SCAN_STATE, {
      action,
      ticketId,
      page: pageLabel || '',
      stageName: getCurrentStageName(),
      mode: state.mode,
      at: nowIso(),
      url: location.href
    });
  }

  function findCloseButton() {
    const roots = [
      document.querySelector('#serviceDetailDock'),
      document.querySelector('#notePanelContainer'),
      document.querySelector('.az-dock'),
      document
    ].filter(Boolean);

    for (const root of roots) {
      const els = [...root.querySelectorAll(SEL.closeCandidates)].filter(visible);

      for (const el of els) {
        const txt = norm([
          el.textContent,
          el.getAttribute?.('title'),
          el.getAttribute?.('aria-label'),
          el.getAttribute?.('data-original-title')
        ].filter(Boolean).join(' '));
        const cls = String(el.className || '').toLowerCase();

        if (
          lower(txt) === 'close' ||
          lower(txt).includes('close') ||
          lower(txt) === 'x' ||
          cls.includes('close')
        ) {
          return el;
        }
      }
    }

    return null;
  }

  async function closeTicket() {
    if (!isTicketDrawerOpen()) return true;

    const before = getOpenTicketInfo().ticketId;
    const btn = findCloseButton();

    if (btn) {
      strongClick(btn);
    } else {
      fireEscape();
    }

    const started = Date.now();
    while (Date.now() - started < CFG.closeWaitMs) {
      if (!state.running || state.destroyed) return true;
      if (!isTicketDrawerOpen()) {
        log(`Closed | ${before || 'drawer'}`, 'info');
        return true;
      }
      await sleep(120);
    }

    log(`Close timed out | ${before || 'drawer'}`, 'warn');
    return false;
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

  async function goNextPage() {
    const btn = getStageNextPageBtn();
    if (!btn) return false;

    const beforeLabel = getStagePageLabel();
    const beforeFirstId = getStageCards()[0]?.getAttribute('data-id') || '';

    strongClick(btn);

    const started = Date.now();
    while (Date.now() - started < 12000) {
      if (!state.running || state.destroyed) return false;

      const nowLabel = getStagePageLabel();
      const nowFirstId = getStageCards()[0]?.getAttribute('data-id') || '';

      if ((nowLabel && nowLabel !== beforeLabel) || (nowFirstId && nowFirstId !== beforeFirstId)) {
        if (state.ui.page) state.ui.page.textContent = nowLabel || 'â€”';
        return true;
      }

      await sleep(180);
    }

    return false;
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let sl = 0;
    let st = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;

      const r = panel.getBoundingClientRect();
      dragging = true;
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
      savePanelPos();
    });

    window.addEventListener('resize', () => {
      clampPanel();
      savePanelPos();
    });
  }

  function restorePanelPos() {
    try {
      const raw = localStorage.getItem(KEYS.PANEL_POS);
      if (!raw || !state.ui.root) return;
      const pos = JSON.parse(raw);
      if (typeof pos.left !== 'number' || typeof pos.top !== 'number') return;

      state.ui.root.style.left = `${Math.max(0, pos.left)}px`;
      state.ui.root.style.top = `${Math.max(0, pos.top)}px`;
      state.ui.root.style.right = 'auto';
      state.ui.root.style.bottom = 'auto';
      clampPanel();
    } catch {}
  }

  function savePanelPos() {
    if (!state.ui.root) return;
    try {
      const r = state.ui.root.getBoundingClientRect();
      localStorage.setItem(KEYS.PANEL_POS, JSON.stringify({ left: r.left, top: r.top }));
    } catch {}
  }

  function clampPanel() {
    if (!state.ui.root) return;
    const r = state.ui.root.getBoundingClientRect();
    const left = Math.max(0, Math.min(window.innerWidth - r.width, r.left));
    const top = Math.max(0, Math.min(window.innerHeight - r.height, r.top));
    state.ui.root.style.left = `${left}px`;
    state.ui.root.style.top = `${top}px`;
    state.ui.root.style.right = 'auto';
    state.ui.root.style.bottom = 'auto';
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();


