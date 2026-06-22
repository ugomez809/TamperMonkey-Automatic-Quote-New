// ==UserScript==
// @name         Alta Payload Mirror + Non-AZ Tab Closer
// @namespace    homebot.payload-mirror-non-az-tab-closer
// @version      0.1.4
// @description  After Alta HOME webhook success, mirrors the final Alta payload into AgencyZoom, closes non-AZ tabs, and lets the finisher complete the ticket.
// @author       OpenAI
// @match        https://alta.farmers.com/*
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
  try { window.__ALTA_PAYLOAD_MIRROR_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Alta Payload Mirror + Non-AZ Tab Closer';
  const VERSION = '0.1.4';

  const LOG_KEY = isAzHost()
    ? 'tm_az_payload_mirror_logs_v1'
    : isApexHost()
      ? 'tm_apex_payload_mirror_logs_v1'
      : 'tm_alta_payload_mirror_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';

  const KEYS = {
    success: 'tm_alta_webhook_post_success_v1',
    successConsumed: 'tm_alta_webhook_post_success_consumed_v1',
    finalPayload: 'tm_az_alta_final_payload_v1',
    finalReady: 'tm_az_alta_final_payload_ready_v1',
    finisherWake: 'tm_az_ticket_finisher_wake_v1',
    homePayload: 'tm_alta_home_quote_grab_payload_v1',
    webhookBundle: 'tm_alta_webhook_bundle_v1',
    currentJob: 'tm_alta_current_job_v1',
    sharedJob: 'tm_shared_az_job_v1',
    runtimeCleanupRequest: 'tm_alta_runtime_cleanup_request_v1',
    closeSignal: 'tm_alta_payload_mirror_close_signal_v1',
    lexCloseConsumed: 'tm_alta_payload_mirror_lex_close_consumed_signal_v1',
    ignoreCloseLease: 'tm_alta_payload_mirror_ignore_close_lease_v1',
    handledSignal: 'tm_alta_payload_mirror_last_handled_signal_v1',
    closeAttempted: 'tm_alta_payload_mirror_close_attempted_v1',
    tabHeartbeats: 'tm_payload_mirror_tab_heartbeats_v1',
    panelPos: 'tm_alta_payload_mirror_panel_pos_v1',
    running: 'tm_alta_payload_mirror_running_v1'
  };

  const CFG = {
    tickMs: 500,
    maxSignalAgeMs: 90000,
    maxCloseSignalAgeMs: 10 * 60 * 1000,
    closeSignalTabStartSlackMs: 2000,
    closeDelayMs: 1200,
    tabHeartbeatMs: 5000,
    maxLogLines: 80,
    zIndex: 2147483647,
    panelWidth: 330
  };

  const state = {
    destroyed: false,
    running: loadRunning(),
    logs: [],
    panel: null,
    ui: {},
    tickTimer: 0,
    logsTimer: 0,
    activeSignal: null,
    activeSignalKey: '',
    mirrored: false,
    manualDoneReady: false,
    finalizedSignalKey: '',
    closeTimer: 0,
    closing: false,
    lastLogClearAt: '',
    lastRuntimeCleanupKey: '',
    lastIgnoredCloseSignalKey: '',
    openedAtMs: Date.now(),
    lastHeartbeatAt: 0,
    tabId: `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  };

  init();

  function init() {
    buildPanel();
    restorePanelPos();
    bindPanel();
    loadLogs();
    log(`Loaded v${VERSION}`);
    log(`Host: ${location.hostname}`);
    clearStaleCloseSignals();
    log(isAzHost() ? 'AgencyZoom bridge mode active' : 'Auto close enabled for non-AgencyZoom tabs');
    setStatus(state.running ? 'Watching for webhook success' : 'Stopped');
    if (typeof GM_addValueChangeListener === 'function') {
      for (const key of [KEYS.success, KEYS.finalPayload, KEYS.finalReady, KEYS.closeSignal]) {
        try { GM_addValueChangeListener(key, () => window.setTimeout(() => tick(`gm:${key}`), 0)); } catch {}
      }
    }
    state.tickTimer = window.setInterval(() => tick('tick'), CFG.tickMs);
    state.logsTimer = window.setInterval(logsTick, 2000);
    window.addEventListener('beforeunload', handleUnload, true);
    window.addEventListener('pagehide', handleUnload, true);
    window.addEventListener('resize', keepPanelInView, true);
    window.addEventListener('storage', handleStorage, true);
    tick('init');
    window.__ALTA_PAYLOAD_MIRROR_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.logsTimer); } catch {}
    try { window.removeEventListener('beforeunload', handleUnload, true); } catch {}
    try { window.removeEventListener('pagehide', handleUnload, true); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { window.removeEventListener('storage', handleStorage, true); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_PAYLOAD_MIRROR_CLEANUP__; } catch {}
  }

  function tick(reason = 'tick') {
    if (state.destroyed) return;
    writeTabHeartbeat();

    if (isAzHost()) {
      consumeRuntimeCleanupRequest();
      const bridged = bridgePayloadsToAzLocal();
      if (bridged) state.mirrored = true;
    }

    const closeSignal = readCloseSignal();
    if (closeSignal && shouldCloseThisTab(closeSignal)) {
      activateCloseSignal(closeSignal, reason);
      renderAll();
      return;
    }

    if (!state.running) {
      setStatus('Stopped');
      renderAll();
      return;
    }

    const success = readSuccessSignal();
    if (success) activateForSuccess(success, reason);

    if (!success && !state.manualDoneReady) {
      setStatus(isAzHost() && readMirroredMeta()?.azId ? 'Mirrored payload available in AZ' : 'Watching for webhook success');
    }

    renderAll();
  }

  function activateForSuccess(signal, reason = '') {
    const key = buildSignalKey(signal);
    if (!key || key === readSession(KEYS.handledSignal)) return;

    if (state.activeSignalKey !== key) {
      state.activeSignal = signal;
      state.activeSignalKey = key;
      state.mirrored = false;
      state.manualDoneReady = false;
      log(`Webhook success detected for AZ ${signal.azId}${reason ? ` | ${reason}` : ''}`);
    }

    if (isAltaHost()) mirrorPayloadFromAlta(signal);
    if (isAzHost()) bridgePayloadsToAzLocal();

    if (readyMatchesSignal(signal)) {
      if (!state.manualDoneReady) {
        state.manualDoneReady = true;
        log(`Payload ready for AZ ${signal.azId}; finalizing handoff`);
      }
      finalizeSuccessfulHandoff(signal);
    } else {
      setStatus('Waiting for mirrored payload');
    }
  }

  function mirrorPayloadFromAlta(signal) {
    if (!isAltaHost()) return false;
    const payload = collectAltaPayload(signal);
    if (!payload.azId) {
      log('Mirror skipped: AZ ID not found in Alta payload keys');
      return false;
    }

    writeShared(KEYS.finalPayload, payload);
    writeShared(KEYS.finalReady, {
      ready: true,
      azId: payload.azId,
      savedAt: payload.savedAt,
      signalPostedAt: payload.signalPostedAt,
      signalKey: payload.signalKey,
      source: SCRIPT_NAME,
      version: VERSION
    });
    if (isPlainObject(payload.homePayload) && extractPayloadAzId(payload.homePayload)) {
      writeShared(KEYS.homePayload, payload.homePayload);
    }
    writeJson(KEYS.finalPayload, payload);
    writeJson(KEYS.finalReady, {
      ready: true,
      azId: payload.azId,
      savedAt: payload.savedAt,
      signalPostedAt: payload.signalPostedAt,
      signalKey: payload.signalKey,
      source: SCRIPT_NAME,
      version: VERSION
    });

    state.mirrored = true;
    log(`Final payload mirrored for AZ ${payload.azId}`);
    return true;
  }

  function collectAltaPayload(signal) {
    const currentJob = readJson(KEYS.currentJob) || readJson(KEYS.sharedJob) || {};
    const homePayload = readJson(KEYS.homePayload) || {};
    const bundle = readJson(KEYS.webhookBundle) || buildBundleFromHome(currentJob, homePayload);
    const existingFinal = readJson(KEYS.finalPayload) || {};
    const azId = normalizeText(
      signal?.azId ||
      existingFinal?.azId ||
      extractPayloadAzId(homePayload) ||
      bundle?.['AZ ID'] ||
      currentJob?.['AZ ID'] ||
      ''
    );
    const savedAt = nowIso();
    const signalPostedAt = normalizeText(signal?.postedAt || '');
    const signalKey = buildSignalKey(signal) || `${azId}|${signalPostedAt || savedAt}`;

    return {
      azId,
      savedAt,
      signalPostedAt,
      signalKey,
      source: 'Alta',
      currentJob: isPlainObject(currentJob) ? currentJob : {},
      bundle: isPlainObject(bundle) ? bundle : {},
      homePayload: isPlainObject(homePayload) ? homePayload : {},
      timeoutPayload: {
        bundleTimeout: isPlainObject(bundle?.timeout) ? bundle.timeout : { ready: false, events: [] }
      },
      rawKeysFound: Object.entries({
        currentJob: !!currentJob?.['AZ ID'],
        homePayload: !!extractPayloadAzId(homePayload),
        webhookBundle: !!bundle?.['AZ ID'],
        finalPayload: !!existingFinal?.azId
      }).filter((entry) => entry[1]).map((entry) => entry[0])
    };
  }

  function buildBundleFromHome(currentJob, homePayload) {
    if (!isPlainObject(homePayload)) return {};
    const row = isPlainObject(homePayload.row) ? homePayload.row : homePayload;
    const azId = extractPayloadAzId(homePayload) || normalizeText(currentJob?.['AZ ID'] || '');
    if (!azId) return {};
    return {
      'AZ ID': azId,
      Name: normalizeText(currentJob?.Name || row.Name || ''),
      'Mailing Address': normalizeText(currentJob?.['Mailing Address'] || row['Mailing Address'] || ''),
      SubmissionNumber: normalizeText(currentJob?.SubmissionNumber || row['Submission Number'] || ''),
      home: {
        ready: homePayload.ready === true,
        data: row,
        sourcePayload: homePayload,
        sourceKey: KEYS.homePayload
      },
      auto: { ready: false, data: null },
      timeout: { ready: false, events: [] },
      meta: { synthetic: true, builtFrom: KEYS.homePayload, builtAt: nowIso(), lastWriter: SCRIPT_NAME, version: VERSION }
    };
  }

  function bridgePayloadsToAzLocal() {
    if (!isAzHost()) return false;
    let bridged = false;
    for (const key of [KEYS.finalPayload, KEYS.finalReady, KEYS.homePayload]) {
      const value = readShared(key);
      if (!isPlainObject(value)) continue;
      writeJson(key, value);
      bridged = true;
    }
    if (bridged) {
      const meta = readMirroredMeta();
      if (meta?.azId) {
        publishFinisherWake(meta);
        setStatus(`Mirrored payload available in AZ ${meta.azId}`);
      }
    }
    return bridged;
  }

  function buildRuntimeCleanupKey(request) {
    if (!isPlainObject(request)) return '';
    return [
      normalizeText(request.azId || request.ticketId || ''),
      normalizeText(request.requestedAt || ''),
      normalizeText(request.nonce || '')
    ].join('|');
  }

  function consumeRuntimeCleanupRequest() {
    if (!isAzHost()) return false;
    const request = readJson(KEYS.runtimeCleanupRequest) || readShared(KEYS.runtimeCleanupRequest);
    const key = buildRuntimeCleanupKey(request);
    if (!key || key === state.lastRuntimeCleanupKey) return false;

    const azId = normalizeText(request?.azId || request?.ticketId || '');
    const requestedMs = Date.parse(normalizeText(request?.requestedAt || ''));
    if (!azId || !Number.isFinite(requestedMs) || Date.now() - requestedMs > CFG.maxCloseSignalAgeMs) return false;

    const meta = readMirroredMeta();
    if (!meta?.azId || meta.azId !== azId) return false;

    const savedMs = Date.parse(normalizeText(meta.savedAt || meta.signalPostedAt || ''));
    if (Number.isFinite(savedMs) && savedMs > requestedMs + 1000) return false;

    state.lastRuntimeCleanupKey = key;
    clearMirroredRuntimeHandoff(azId);
    log(`Runtime cleanup consumed for AZ ${azId}`);
    return true;
  }

  function clearMirroredRuntimeHandoff(azId = '') {
    const keys = [
      KEYS.finalPayload,
      KEYS.finalReady,
      KEYS.finisherWake,
      KEYS.homePayload,
      KEYS.webhookBundle,
      KEYS.success,
      KEYS.successConsumed,
      KEYS.closeSignal,
      KEYS.closeAttempted
    ];
    for (const key of keys) {
      writeShared(key, null);
      try { localStorage.removeItem(key); } catch {}
      try { sessionStorage.removeItem(key); } catch {}
    }
    state.activeSignal = null;
    state.activeSignalKey = '';
    state.mirrored = false;
    state.manualDoneReady = false;
    state.finalizedSignalKey = '';
    if (azId) setStatus(`Runtime cleaned for AZ ${azId}`);
  }

  function publishFinisherWake(meta) {
    const azId = normalizeText(meta?.azId || '');
    if (!azId) return null;
    const wake = {
      ready: true,
      azId,
      ticketId: azId,
      savedAt: normalizeText(meta?.savedAt || ''),
      signalPostedAt: normalizeText(meta?.signalPostedAt || ''),
      signalKey: `${azId}|${normalizeText(meta?.savedAt || meta?.signalPostedAt || '')}`,
      bridgedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeJson(KEYS.finisherWake, wake);
    try {
      window.dispatchEvent(new CustomEvent('tm-az-finisher-wake', { detail: wake }));
    } catch {}
    try {
      document.dispatchEvent(new CustomEvent('tm-az-finisher-wake', { detail: wake }));
    } catch {}
    return wake;
  }

  function clearCloseSignals() {
    for (const key of [KEYS.closeSignal, KEYS.lexCloseConsumed, KEYS.ignoreCloseLease, KEYS.closeAttempted]) {
      writeShared(key, null);
      try { localStorage.removeItem(key); } catch {}
      try { sessionStorage.removeItem(key); } catch {}
    }
  }

  function clearStaleCloseSignals() {
    const signal = readShared(KEYS.closeSignal) || readJson(KEYS.closeSignal);
    if (!signal) return;
    const requestedMs = Date.parse(normalizeText(signal.requestedAt || signal.closedAt || ''));
    if (Number.isFinite(requestedMs) && Date.now() - requestedMs <= CFG.maxCloseSignalAgeMs) return;
    clearCloseSignals();
    log('Cleared stale close signals');
  }

  function finalizeSuccessfulHandoff(signal) {
    const key = buildSignalKey(signal);
    if (!key || state.finalizedSignalKey === key) return true;
    if (!readyMatchesSignal(signal)) return false;

    state.finalizedSignalKey = key;
    markSuccessConsumed(signal);
    writeSession(KEYS.handledSignal, key);
    publishCloseSignal(signal);
    state.manualDoneReady = false;

    if (isAzHost()) {
      setStatus(`Payload mirrored for AZ ${signal.azId}; finisher ready`);
      log(`Final handoff ready in AgencyZoom for AZ ${signal.azId}`);
      return true;
    }

    setStatus('Payload mirrored; closing tab');
    scheduleCurrentTabClose(signal, 'webhook success mirrored');
    return true;
  }

  function publishCloseSignal(signal) {
    const azId = normalizeText(signal?.azId || '');
    if (!azId) return null;
    const closeSignal = {
      ready: true,
      azId,
      ticketId: azId,
      requestedAt: nowIso(),
      signalKey: buildSignalKey(signal),
      source: SCRIPT_NAME,
      version: VERSION,
      closeNonAzTabs: true
    };
    writeShared(KEYS.closeSignal, closeSignal);
    writeJson(KEYS.closeSignal, closeSignal);
    log(`Published non-AZ close signal for AZ ${azId}`);
    return closeSignal;
  }

  function readCloseSignal() {
    const signal = readShared(KEYS.closeSignal) || readJson(KEYS.closeSignal);
    if (!isFreshCloseSignal(signal)) return null;
    return signal;
  }

  function isFreshCloseSignal(signal) {
    if (!isPlainObject(signal) || signal.ready !== true) return false;
    const azId = normalizeText(signal.azId || signal.ticketId || '');
    const requestedAt = normalizeText(signal.requestedAt || signal.closedAt || '');
    if (!azId || !requestedAt) return false;
    const ms = Date.parse(requestedAt);
    return Number.isFinite(ms) && Date.now() - ms <= CFG.maxCloseSignalAgeMs;
  }

  function shouldCloseThisTab(signal) {
    if (isAzHost() || state.closing) return false;
    const signalAzId = normalizeText(signal?.azId || signal?.ticketId || '');
    const requestedMs = Date.parse(normalizeText(signal?.requestedAt || signal?.closedAt || ''));
    if (Number.isFinite(requestedMs) && requestedMs < (state.openedAtMs - CFG.closeSignalTabStartSlackMs)) {
      logIgnoredCloseSignal(signal, 'signal predates this tab');
      return false;
    }

    const contextAzId = getContextAzId();
    if (!contextAzId) {
      logIgnoredCloseSignal(signal, 'tab AZ context not ready');
      return false;
    }

    if (signalAzId !== contextAzId) {
      logIgnoredCloseSignal(signal, `signal AZ ${signalAzId || '(blank)'} does not match tab AZ ${contextAzId}`);
      return false;
    }

    return true;
  }

  function logIgnoredCloseSignal(signal, reason) {
    const key = `${buildSignalKey(signal)}|${reason}`;
    if (!key || state.lastIgnoredCloseSignalKey === key) return;
    state.lastIgnoredCloseSignalKey = key;
    log(`Ignoring close signal: ${reason}`);
  }

  function getContextAzId() {
    const currentJob = readJson(KEYS.currentJob) || readJson(KEYS.sharedJob) || {};
    const homePayload = readJson(KEYS.homePayload) || {};
    const finalPayload = readJson(KEYS.finalPayload) || {};
    return normalizeText(
      currentJob?.['AZ ID'] ||
      extractPayloadAzId(homePayload) ||
      finalPayload?.azId ||
      ''
    );
  }

  function activateCloseSignal(signal, reason = '') {
    const key = buildSignalKey(signal);
    if (!key || state.finalizedSignalKey === `close:${key}`) return;
    state.finalizedSignalKey = `close:${key}`;
    setStatus('Closing non-AZ tab');
    log(`Close signal received for AZ ${signal.azId || signal.ticketId}${reason ? ` | ${reason}` : ''}`);
    scheduleCurrentTabClose(signal, 'close signal');
  }

  function scheduleCurrentTabClose(signal, reason = '') {
    if (isAzHost() || state.closing) return;
    state.closing = true;
    writeCloseAttempt(signal, reason);
    if (state.closeTimer) clearTimeout(state.closeTimer);
    state.closeTimer = window.setTimeout(() => closeCurrentTab(reason), CFG.closeDelayMs);
  }

  function writeCloseAttempt(signal, reason = '') {
    const payload = {
      azId: normalizeText(signal?.azId || signal?.ticketId || ''),
      attemptedAt: nowIso(),
      reason,
      host: location.hostname,
      href: location.href,
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeShared(KEYS.closeAttempted, payload);
    writeJson(KEYS.closeAttempted, payload);
  }

  function closeCurrentTab(reason = '') {
    log(`Closing current non-AZ tab${reason ? ` | ${reason}` : ''}`);
    setStatus('Closing tab');
    try { window.open('', '_self'); } catch {}
    try { window.close(); } catch {}
    window.setTimeout(() => {
      if (document.visibilityState === 'hidden') return;
      setStatus('Close attempted; browser may require manual close');
      log('Browser did not close this tab automatically; manual close may be required');
    }, 1500);
  }

  function acknowledgeManualDone() {
    const signal = state.activeSignal || readSuccessSignal();
    if (!isPlainObject(signal)) {
      setStatus('No posted payload ready');
      log('Manual done skipped: no webhook success signal found');
      return false;
    }

    if (!readyMatchesSignal(signal)) {
      setStatus('Waiting for mirrored payload');
      log(`Manual done skipped: mirrored payload not ready for AZ ${signal.azId || '(blank)'}`);
      return false;
    }

    const key = buildSignalKey(signal);
    if (key) state.finalizedSignalKey = '';
    finalizeSuccessfulHandoff(signal);
    renderAll();
    return true;
  }

  function readSuccessSignal() {
    const gm = readShared(KEYS.success);
    if (isFreshSuccess(gm) && !isConsumed(gm)) return gm;
    const local = readJson(KEYS.success);
    if (isFreshSuccess(local) && !isConsumed(local)) return local;
    return null;
  }

  function isFreshSuccess(signal) {
    if (!isPlainObject(signal) || signal.ok !== true) return false;
    const azId = normalizeText(signal.azId || '');
    const postedAt = normalizeText(signal.postedAt || '');
    if (!azId || !postedAt) return false;
    const ms = Date.parse(postedAt);
    return Number.isFinite(ms) && Date.now() - ms <= CFG.maxSignalAgeMs;
  }

  function markSuccessConsumed(signal) {
    const consumed = {
      azId: normalizeText(signal?.azId || ''),
      postedAt: normalizeText(signal?.postedAt || ''),
      signature: normalizeText(signal?.signature || ''),
      consumedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeShared(KEYS.successConsumed, consumed);
    writeJson(KEYS.successConsumed, consumed);
  }

  function isConsumed(signal) {
    const key = buildSuccessKey(signal);
    const consumed = readShared(KEYS.successConsumed) || readJson(KEYS.successConsumed);
    return !!key && buildSuccessKey(consumed) === key;
  }

  function readyMatchesSignal(signal) {
    const ready = readShared(KEYS.finalReady) || readJson(KEYS.finalReady);
    const payload = readShared(KEYS.finalPayload) || readJson(KEYS.finalPayload);
    const signalAzId = normalizeText(signal?.azId || '');
    return !!(
      signalAzId &&
      isPlainObject(ready) &&
      ready.ready === true &&
      normalizeText(ready.azId || payload?.azId || '') === signalAzId
    );
  }

  function readMirroredMeta() {
    const payload = readShared(KEYS.finalPayload) || readJson(KEYS.finalPayload);
    const ready = readShared(KEYS.finalReady) || readJson(KEYS.finalReady);
    const azId = normalizeText(payload?.azId || ready?.azId || '');
    if (!azId) return null;
    return {
      azId,
      savedAt: normalizeText(payload?.savedAt || ready?.savedAt || ''),
      signalPostedAt: normalizeText(payload?.signalPostedAt || ready?.signalPostedAt || ''),
      ready: ready?.ready === true
    };
  }

  function writeTabHeartbeat() {
    if (Date.now() - state.lastHeartbeatAt < CFG.tabHeartbeatMs) return;
    state.lastHeartbeatAt = Date.now();
    const map = readShared(KEYS.tabHeartbeats) || {};
    map[state.tabId] = {
      tabId: state.tabId,
      host: location.hostname,
      href: location.href,
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeShared(KEYS.tabHeartbeats, map);
  }

  function handleUnload() {
    persistPanelPos();
  }

  function loadRunning() {
    try { localStorage.removeItem(KEYS.running); } catch {}
    return true;
  }

  function saveRunning(on) {
    try {
      if (on) localStorage.removeItem(KEYS.running);
      else localStorage.setItem(KEYS.running, '0');
    } catch {}
  }

  function buildSignalKey(signal) {
    const explicit = normalizeText(signal?.signalKey || '');
    if (explicit) return explicit;
    return `${normalizeText(signal?.azId || '')}|${normalizeText(signal?.postedAt || signal?.signalPostedAt || '')}`;
  }

  function buildSuccessKey(signal) {
    if (!isPlainObject(signal)) return '';
    return [normalizeText(signal.azId || ''), normalizeText(signal.postedAt || ''), normalizeText(signal.signature || '')].join('|');
  }

  function extractPayloadAzId(value) {
    if (!isPlainObject(value)) return '';
    return normalizeText(value['AZ ID'] || value.azId || value.ticketId || value.currentJob?.['AZ ID'] || value.row?.['AZ ID'] || '');
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'tm-alta-payload-mirror-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: `${CFG.panelWidth}px`,
      zIndex: String(CFG.zIndex),
      background: 'rgba(15,23,42,.97)',
      color: '#e5e7eb',
      border: '1px solid rgba(255,255,255,.12)',
      borderRadius: '8px',
      boxShadow: '0 18px 48px rgba(0,0,0,.38)',
      font: '12px/1.45 Segoe UI,Tahoma,Arial,sans-serif',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div data-head style="padding:10px 12px;background:#111827;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move;">
        <div><div style="font-weight:800;">${SCRIPT_NAME}</div><div style="font-size:11px;opacity:.72;">Webhook mirror; auto closes non-AZ</div></div>
        <div style="font-size:11px;opacity:.72;">v${VERSION}</div>
      </div>
      <div style="padding:12px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button data-toggle type="button" style="border:0;border-radius:6px;padding:8px 10px;background:#15803d;color:#fff;font-weight:800;cursor:pointer;">START</button>
          <button data-copy type="button" style="border:0;border-radius:6px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;">COPY MIRROR + LOGS</button>
          <button data-manual-done type="button" style="border:0;border-radius:6px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">FINALIZE NOW</button>
        </div>
        <div data-status style="font-weight:800;color:#86efac;margin-bottom:10px;">Watching for webhook success</div>
        <div style="display:grid;grid-template-columns:110px 1fr;gap:6px 8px;margin-bottom:10px;">
          <div style="opacity:.72;">AZ ID</div><div data-azid>-</div>
          <div style="opacity:.72;">Payload mirrored</div><div data-mirrored>No</div>
          <div style="opacity:.72;">Final handoff</div><div data-manual-status>-</div>
        </div>
        <textarea data-logs readonly style="width:100%;min-height:150px;max-height:210px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:6px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;
    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('[data-head]');
    state.ui.toggle = panel.querySelector('[data-toggle]');
    state.ui.copy = panel.querySelector('[data-copy]');
    state.ui.manualDone = panel.querySelector('[data-manual-done]');
    state.ui.status = panel.querySelector('[data-status]');
    state.ui.azId = panel.querySelector('[data-azid]');
    state.ui.mirrored = panel.querySelector('[data-mirrored]');
    state.ui.manualStatus = panel.querySelector('[data-manual-status]');
    state.ui.logs = panel.querySelector('[data-logs]');
  }

  function bindPanel() {
    state.ui.toggle?.addEventListener('click', () => {
      state.running = !state.running;
      saveRunning(state.running);
      if (!state.running) {
        state.manualDoneReady = false;
        setStatus('Stopped');
        log('Monitoring stopped');
      } else {
        setStatus('Watching for webhook success');
        log('Monitoring started');
        tick('manual-start');
      }
      renderAll();
    });
    state.ui.copy?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify({ mirror: readMirrorSnapshot(), logs: state.logs }, null, 2));
        log('Mirror + logs copied');
      } catch {
        log('Copy failed');
      }
    });
    state.ui.manualDone?.addEventListener('click', acknowledgeManualDone);
    makeDraggable(state.panel, state.ui.head);
  }

  function renderAll() {
    const meta = readMirroredMeta();
    if (state.ui.azId) state.ui.azId.textContent = normalizeText(state.activeSignal?.azId || meta?.azId || '-') || '-';
    if (state.ui.mirrored) state.ui.mirrored.textContent = state.mirrored || meta?.ready ? 'Yes' : 'No';
    if (state.ui.manualStatus) {
      state.ui.manualStatus.textContent = state.closing ? 'Closing' : (state.manualDoneReady ? 'Ready' : '-');
    }
    if (state.ui.toggle) {
      state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
      state.ui.toggle.style.background = state.running ? '#b91c1c' : '#15803d';
    }
    if (state.ui.manualDone) {
      state.ui.manualDone.style.background = state.manualDoneReady || state.closing ? '#0f766e' : '#475569';
    }
    renderLogs();
  }

  function setStatus(message) {
    if (state.ui.status) state.ui.status.textContent = message;
  }

  function readMirrorSnapshot() {
    return {
      exportedAt: nowIso(),
      host: location.hostname,
      finalPayload: readShared(KEYS.finalPayload) || readJson(KEYS.finalPayload) || {},
      finalReady: readShared(KEYS.finalReady) || readJson(KEYS.finalReady) || {},
      homePayload: readShared(KEYS.homePayload) || readJson(KEYS.homePayload) || {}
    };
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    persistLogs();
    renderLogs();
    console.info(`[${SCRIPT_NAME}] ${message}`);
  }

  function loadLogs() {
    const saved = readJson(LOG_KEY);
    if (Array.isArray(saved?.lines)) state.logs = saved.lines.slice(0, CFG.maxLogLines);
    renderLogs();
  }

  function persistLogs() {
    const payload = { script: SCRIPT_NAME, version: VERSION, origin: location.origin, updatedAt: nowIso(), lines: state.logs };
    writeJson(LOG_KEY, payload);
    try { GM_setValue(LOG_KEY, payload); } catch {}
  }

  function logsTick() {
    persistLogs();
    checkLogClearRequest();
  }

  function handleStorage(event) {
    if (event?.key === LOG_CLEAR_SIGNAL_KEY) checkLogClearRequest();
  }

  function checkLogClearRequest() {
    const req = readJson(LOG_CLEAR_SIGNAL_KEY) || readShared(LOG_CLEAR_SIGNAL_KEY);
    const at = normalizeText(req?.requestedAt || '');
    if (!at || at === state.lastLogClearAt) return;
    state.lastLogClearAt = at;
    state.logs = [];
    renderLogs();
    persistLogs();
  }

  function renderLogs() {
    if (state.ui.logs) {
      state.ui.logs.value = state.logs.join('\n');
      state.ui.logs.scrollTop = 0;
    }
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;
    let drag = null;
    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
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
      persistPanelPos();
    }, true);
  }

  function persistPanelPos() {
    if (!state.panel) return;
    writeJson(KEYS.panelPos, {
      left: state.panel.style.left || '',
      top: state.panel.style.top || '',
      right: state.panel.style.right || '',
      bottom: state.panel.style.bottom || ''
    });
  }

  function restorePanelPos() {
    const saved = readJson(KEYS.panelPos);
    if (!isPlainObject(saved) || !state.panel) return;
    for (const prop of ['left', 'top', 'right', 'bottom']) if (saved[prop]) state.panel.style[prop] = saved[prop];
  }

  function keepPanelInView() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, rect.left));
    const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, rect.top));
    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    persistPanelPos();
  }

  function isAzHost() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function isApexHost() {
    return /^farmersagent\.lightning\.force\.com$/i.test(location.hostname);
  }

  function isAltaHost() {
    return /^alta\.farmers\.com$/i.test(location.hostname);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function safeJsonParse(raw, fallback = null) {
    try {
      if (raw == null || raw === '') return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  }

  function readJson(key) {
    try { return safeJsonParse(localStorage.getItem(key), null); }
    catch { return null; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value, null, 2)); } catch {}
  }

  function readShared(key) {
    try { return safeJsonParse(GM_getValue(key, null), null); }
    catch { return null; }
  }

  function writeShared(key, value) {
    try { GM_setValue(key, value); } catch {}
  }

  function readSession(key) {
    try { return sessionStorage.getItem(key) || ''; }
    catch { return ''; }
  }

  function writeSession(key, value) {
    try { sessionStorage.setItem(key, String(value)); } catch {}
  }
})();
