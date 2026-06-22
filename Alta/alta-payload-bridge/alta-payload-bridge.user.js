// ==UserScript==
// @name         Alta Payload Bridge
// @namespace    homebot.alta-payload-bridge
// @version      0.1.4
// @description  Mirrors AgencyZoom/APEX job data into Alta and mirrors Alta home quote results back to AgencyZoom.
// @author       OpenAI
// @match        https://app.agencyzoom.com/*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-payload-bridge/alta-payload-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-payload-bridge/alta-payload-bridge.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__ALTA_PAYLOAD_BRIDGE_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Alta Payload Bridge';
  const VERSION = '0.1.4';

  const SHARED = {
    currentJob: 'tm_alta_bridge_current_job_v1',
    azPayload: 'tm_alta_bridge_az_payload_v1',
    apexPayload: 'tm_alta_bridge_apex_payload_v1',
    homePayload: 'tm_alta_bridge_home_quote_payload_v1',
    finalPayload: 'tm_alta_bridge_final_payload_v1',
    finalReady: 'tm_alta_bridge_final_payload_ready_v1'
  };

  const LOCAL = {
    azPayload: 'tm_az_payload_v1',
    azCurrentJob: 'tm_az_current_job_v1',
    apexPayload: 'tm_apex_home_bot_payload_v1',
    apexReady: 'tm_apex_home_bot_ready_v1',
    apexActiveRow: 'tm_apex_home_bot_active_row_v1',
    altaCurrentJob: 'tm_alta_current_job_v1',
    altaHomePayload: 'tm_alta_home_quote_grab_payload_v1',
    altaFinalPayload: 'tm_az_alta_final_payload_v1',
    altaFinalReady: 'tm_az_alta_final_payload_ready_v1',
    finisherWake: 'tm_az_ticket_finisher_wake_v1',
    runtimeCleanupRequest: 'tm_alta_runtime_cleanup_request_v1',
    panelPos: 'tm_alta_payload_bridge_panel_pos_v1',
    logs: 'tm_alta_payload_bridge_logs_v1'
  };

  const CFG = {
    tickMs: 1200,
    maxLogLines: 40,
    staleReadyMs: 24 * 60 * 60 * 1000
  };

  const state = {
    destroyed: false,
    tickTimer: null,
    listeners: [],
    panel: null,
    ui: {},
    logs: [],
    lastRuntimeCleanupKey: '',
    lastFinisherWakeDispatchKey: ''
  };

  init();

  function init() {
    buildPanel();
    bindPanel();
    restorePanelPos();
    loadLogs();
    log(`Loaded v${VERSION} on ${location.hostname}`);
    runSync('init');
    state.tickTimer = setInterval(() => runSync('tick'), CFG.tickMs);
    addSharedListeners();
    window.__ALTA_PAYLOAD_BRIDGE_CLEANUP__ = cleanup;
  }

  function cleanup() {
    state.destroyed = true;
    if (state.tickTimer) clearInterval(state.tickTimer);
    for (const id of state.listeners) {
      try { GM_removeValueChangeListener?.(id); } catch {}
    }
    state.listeners = [];
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_PAYLOAD_BRIDGE_CLEANUP__; } catch {}
  }

  function addSharedListeners() {
    if (typeof GM_addValueChangeListener !== 'function') return;
    for (const key of [SHARED.currentJob, SHARED.finalPayload, SHARED.finalReady]) {
      try {
        const id = GM_addValueChangeListener(key, () => runSync(`shared:${key}`));
        state.listeners.push(id);
      } catch {}
    }
  }

  function runSync(reason) {
    try {
      if (isAzHost()) syncAgencyZoom(reason);
      else if (isApexHost()) syncApex(reason);
      else if (isAltaHost()) syncAlta(reason);
      renderStatus();
    } catch (err) {
      log(`Sync error: ${err?.message || err}`);
    }
  }

  function syncAgencyZoom(reason) {
    consumeRuntimeCleanupRequest();

    const azPayload = readLocalJson(LOCAL.azPayload);
    if (azPayload) {
      const job = normalizeJob(azPayload);
      if (job['AZ ID']) {
        writeShared(SHARED.azPayload, withBridgeMeta(azPayload, 'AgencyZoom payload'));
        writeShared(SHARED.currentJob, withBridgeMeta(job, 'AgencyZoom job'));
        writeLocalJson(LOCAL.azCurrentJob, job);
        logOnce(`az-job-${job['AZ ID']}`, `Mirrored AZ job ${job['AZ ID']} (${reason})`);
      }
    }

    const finalPayload = readShared(SHARED.finalPayload);
    const finalReady = readShared(SHARED.finalReady);
    if (isFreshReady(finalReady) && finalPayload?.azId) {
      writeLocalJson(LOCAL.altaFinalPayload, finalPayload);
      writeLocalJson(LOCAL.altaFinalReady, finalReady);
      publishFinisherWake(finalPayload, finalReady);
      logOnce(`az-final-${finalReady.signalKey || finalReady.savedAt}`, `Wrote Alta final payload for AZ ${finalPayload.azId}`);
    }
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
    const request = readLocalJson(LOCAL.runtimeCleanupRequest);
    const key = buildRuntimeCleanupKey(request);
    if (!key || key === state.lastRuntimeCleanupKey) return false;

    const azId = normalizeText(request?.azId || request?.ticketId || '');
    const requestedMs = Date.parse(normalizeText(request?.requestedAt || ''));
    if (!azId || !Number.isFinite(requestedMs) || Date.now() - requestedMs > (10 * 60 * 1000)) return false;

    const finalPayload = readShared(SHARED.finalPayload);
    const finalReady = readShared(SHARED.finalReady);
    const finalAzId = normalizeText(finalPayload?.azId || finalReady?.azId || '');
    if (!finalAzId || finalAzId !== azId) return false;

    const savedMs = Date.parse(normalizeText(finalPayload?.savedAt || finalReady?.savedAt || finalPayload?.signalPostedAt || ''));
    if (Number.isFinite(savedMs) && savedMs > requestedMs + 1000) return false;

    state.lastRuntimeCleanupKey = key;
    clearMirroredRuntimeHandoff(azId);
    logOnce(`cleanup-${key}`, `Runtime cleanup consumed for AZ ${azId}`);
    return true;
  }

  function clearMirroredRuntimeHandoff(azId = '') {
    writeShared(SHARED.homePayload, null);
    writeShared(SHARED.finalPayload, null);
    writeShared(SHARED.finalReady, null);
    for (const key of [LOCAL.altaHomePayload, LOCAL.altaFinalPayload, LOCAL.altaFinalReady, LOCAL.finisherWake]) {
      try { localStorage.removeItem(key); } catch {}
    }
    if (azId) logOnce(`cleanup-local-${azId}`, `Cleared local final handoff for AZ ${azId}`);
  }

  function publishFinisherWake(finalPayload, finalReady) {
    const azId = normalizeText(finalPayload?.azId || finalReady?.azId || '');
    if (!azId) return null;
    const wake = {
      ready: true,
      azId,
      ticketId: azId,
      savedAt: normalizeText(finalPayload?.savedAt || finalReady?.savedAt || ''),
      signalPostedAt: normalizeText(finalPayload?.signalPostedAt || finalReady?.signalPostedAt || ''),
      signalKey: normalizeText(finalPayload?.signalKey || finalReady?.signalKey || `${azId}|${finalPayload?.savedAt || finalReady?.savedAt || ''}`),
      bridgedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeLocalJson(LOCAL.finisherWake, wake);
    const dispatchKey = normalizeText(wake.signalKey || `${azId}|${wake.savedAt || wake.signalPostedAt || ''}`);
    if (dispatchKey && state.lastFinisherWakeDispatchKey !== dispatchKey) {
      state.lastFinisherWakeDispatchKey = dispatchKey;
      try {
        document.dispatchEvent(new CustomEvent('tm-az-finisher-wake', { detail: wake }));
      } catch {}
    }
    return wake;
  }

  function syncApex(reason) {
    const payload = readLocalJson(LOCAL.apexPayload);
    const ready = readLocalJson(LOCAL.apexReady);
    const activeRow = readLocalJson(LOCAL.apexActiveRow);
    if (payload || ready || activeRow) {
      const bundle = { payload, ready, activeRow, savedAt: nowIso(), source: SCRIPT_NAME, version: VERSION };
      writeShared(SHARED.apexPayload, bundle);
      const job = normalizeJob(payload || activeRow || {});
      if (job['AZ ID']) writeShared(SHARED.currentJob, withBridgeMeta(job, 'APEX job'));
      logOnce(`apex-${normalizeText(job['AZ ID'] || bundle.savedAt)}`, `Mirrored APEX payload (${reason})`);
    }
  }

  function syncAlta(reason) {
    const sharedJob = readShared(SHARED.currentJob);
    if (sharedJob?.['AZ ID']) {
      const job = stripBridgeMeta(sharedJob);
      writeLocalJson(LOCAL.altaCurrentJob, job);
      logOnce(`alta-job-${job['AZ ID']}`, `Loaded job ${job['AZ ID']} into Alta (${reason})`);
    }

    const homePayload = readLocalJson(LOCAL.altaHomePayload);
    if (homePayload?.['AZ ID']) {
      writeShared(SHARED.homePayload, withBridgeMeta(homePayload, 'Alta home payload'));
      if (homePayload.ready) {
        const finalSignalKey = buildFinalSignalKey(homePayload);
        const existingReady = readShared(SHARED.finalReady);
        if (existingReady?.ready && normalizeText(existingReady.signalKey) === finalSignalKey) return;

        const finalPayload = buildFinalPayload(homePayload, finalSignalKey);
        const finalReady = {
          ready: true,
          azId: finalPayload.azId,
          savedAt: finalPayload.savedAt,
          signalPostedAt: finalPayload.signalPostedAt,
          signalKey: finalPayload.signalKey,
          homePayloadSavedAt: normalizeText(homePayload.savedAt || ''),
          source: SCRIPT_NAME,
          version: VERSION
        };
        writeLocalJson(LOCAL.altaFinalPayload, finalPayload);
        writeLocalJson(LOCAL.altaFinalReady, finalReady);
        writeShared(SHARED.finalPayload, finalPayload);
        writeShared(SHARED.finalReady, finalReady);
        logOnce(`alta-final-${finalPayload.signalKey}`, `Shared Alta final payload for AZ ${finalPayload.azId}`);
      }
    }
  }

  function buildFinalSignalKey(homePayload) {
    const azId = normalizeText(homePayload['AZ ID'] || homePayload?.currentJob?.['AZ ID'] || '');
    const homePayloadSavedAt = normalizeText(homePayload.savedAt || homePayload?.meta?.updatedAt || '');
    return `${azId}|${homePayloadSavedAt || 'ready'}`;
  }

  function buildFinalPayload(homePayload, signalKey = '') {
    const azId = normalizeText(homePayload['AZ ID'] || homePayload?.currentJob?.['AZ ID'] || '');
    const savedAt = normalizeText(homePayload.savedAt || homePayload?.meta?.updatedAt || nowIso());
    const signalPostedAt = nowIso();
    const finalSignalKey = normalizeText(signalKey) || `${azId}|${savedAt}`;
    const currentJob = homePayload.currentJob || readLocalJson(LOCAL.altaCurrentJob) || {};
    const home = {
      ready: !!homePayload.ready,
      savedAt: normalizeText(homePayload.savedAt || savedAt),
      script: normalizeText(homePayload.script || 'Alta Home Quote'),
      version: normalizeText(homePayload.version || VERSION),
      payloadKey: LOCAL.altaHomePayload,
      submissionNumber: normalizeText(homePayload?.row?.['Submission Number'] || currentJob.SubmissionNumber || ''),
      data: homePayload,
      meta: homePayload.meta || {}
    };
    return {
      azId,
      savedAt,
      signalPostedAt,
      signalKey: finalSignalKey,
      source: 'Alta',
      currentJob,
      bundle: {
        'AZ ID': azId,
        Name: normalizeText(currentJob.Name || homePayload?.row?.Name || ''),
        'Mailing Address': normalizeText(currentJob['Mailing Address'] || homePayload?.row?.['Mailing Address'] || ''),
        SubmissionNumber: normalizeText(home.submissionNumber || ''),
        home,
        auto: { ready: false, data: null },
        timeout: { ready: false, events: [] },
        meta: {
          updatedAt: savedAt,
          lastWriter: normalizeText(homePayload.script || 'Alta Home Quote'),
          version: normalizeText(homePayload.version || VERSION),
          stage: 'alta_complete',
          stageWriter: SCRIPT_NAME
        }
      },
      homePayload,
      timeoutPayload: {
        bundleTimeout: { ready: false, events: [] },
        runtime: null,
        sentEvents: {}
      }
    };
  }

  function normalizeJob(raw) {
    const source = raw?.az && typeof raw.az === 'object' ? raw.az : raw || {};
    const first = pick(source, ['First Name', 'AZ Name', 'firstName']);
    const last = pick(source, ['Last Name', 'AZ Last', 'lastName']);
    const azId = pick(raw, ['ticketId', 'AZ ID', 'azId']) || pick(source, ['AZ ID', 'ticketId', 'azId']);
    const street = pick(source, ['Street Address', 'AZ Street Address', 'street']);
    const city = pick(source, ['City', 'AZ City', 'city']);
    const state = pick(source, ['State', 'AZ State', 'state']);
    const zip = pick(source, ['Zip', 'AZ Postal Code', 'Postal Code', 'zip']);
    const name = normalizeText(pick(source, ['Name']) || `${first} ${last}`);
    const mailingAddress = normalizeText(pick(source, ['Mailing Address']) || [street, city, state, zip].filter(Boolean).join(' '));
    return removeEmpty({
      'AZ ID': azId,
      Name: name,
      'Mailing Address': mailingAddress,
      SubmissionNumber: pick(source, ['SubmissionNumber', 'Submission Number']),
      updatedAt: nowIso(),
      'First Name': first,
      'Last Name': last,
      Email: pick(source, ['Email', 'AZ Email', 'email']),
      Phone: pick(source, ['Phone', 'AZ Phone', 'phone']),
      DOB: pick(source, ['DOB', 'AZ DOB', 'Date of Birth']),
      'Street Address': street,
      City: city,
      State: state,
      Zip: zip
    });
  }

  function pick(obj, keys) {
    for (const key of keys) {
      const value = normalizeText(obj?.[key]);
      if (value) return value;
    }
    return '';
  }

  function removeEmpty(obj) {
    const out = {};
    for (const [key, value] of Object.entries(obj || {})) {
      if (normalizeText(value)) out[key] = value;
    }
    return out;
  }

  function withBridgeMeta(value, label) {
    const stableSavedAt = normalizeText(value?.bridgeMeta?.savedAt || value?.savedAt || value?.updatedAt || value?.meta?.updatedAt || '');
    return {
      ...(isPlainObject(value) ? value : { value }),
      bridgeMeta: {
        label,
        source: SCRIPT_NAME,
        version: VERSION,
        host: location.hostname,
        url: location.href,
        savedAt: stableSavedAt || nowIso()
      }
    };
  }

  function stripBridgeMeta(value) {
    const next = { ...(value || {}) };
    delete next.bridgeMeta;
    return next;
  }

  function isFreshReady(value) {
    if (!value?.ready) return false;
    const ms = Date.parse(value.savedAt || value.signalPostedAt || '');
    if (!Number.isFinite(ms)) return true;
    return Date.now() - ms < CFG.staleReadyMs;
  }

  function readLocalJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeLocalJson(key, value) {
    try {
      const next = JSON.stringify(value, null, 2);
      if (localStorage.getItem(key) === next) return false;
      localStorage.setItem(key, next);
      return true;
    } catch {
      return false;
    }
  }

  function readShared(key) {
    try {
      const raw = GM_getValue(key, null);
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch { return null; }
  }

  function writeShared(key, value) {
    try {
      const next = JSON.stringify(value);
      const current = GM_getValue(key, null);
      const currentText = typeof current === 'string' ? current : JSON.stringify(current);
      if (currentText === next) return false;
      GM_setValue(key, next);
      return true;
    } catch {
      return false;
    }
  }

  function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function isAzHost() {
    return /(^|\.)agencyzoom\.com$/i.test(location.hostname);
  }

  function isApexHost() {
    return /(^|\.)lightning\.force\.com$/i.test(location.hostname);
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

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    writeLocalJson(LOCAL.logs, { script: SCRIPT_NAME, version: VERSION, updatedAt: nowIso(), lines: state.logs });
    renderLogs();
  }

  function logOnce(key, message) {
    const memoryKey = `__logged_${key}`;
    if (state[memoryKey]) return;
    state[memoryKey] = true;
    log(message);
  }

  function loadLogs() {
    const stored = readLocalJson(LOCAL.logs);
    if (Array.isArray(stored?.lines)) state.logs = stored.lines.slice(0, CFG.maxLogLines);
    renderLogs();
  }

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = `
      #alta-payload-bridge-panel{position:fixed;right:14px;bottom:14px;width:320px;z-index:2147483647;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;font-family:Arial,sans-serif;font-size:12px;box-shadow:0 10px 28px rgba(0,0,0,.35)}
      #alta-payload-bridge-panel header{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid #374151;cursor:move}
      #alta-payload-bridge-panel strong{font-size:12px}
      #alta-payload-bridge-panel main{padding:8px 10px}
      #alta-payload-bridge-panel button{border:0;border-radius:6px;background:#2563eb;color:white;font-weight:700;padding:6px 8px;cursor:pointer}
      #alta-payload-bridge-panel button.secondary{background:#374151}
      #alta-payload-bridge-status{margin-bottom:8px;color:#d1d5db}
      #alta-payload-bridge-log{white-space:pre-wrap;max-height:150px;overflow:auto;background:#030712;border:1px solid #374151;border-radius:6px;padding:6px;color:#d1d5db}
    `;
    document.documentElement.appendChild(style);
    const panel = document.createElement('div');
    panel.id = 'alta-payload-bridge-panel';
    panel.innerHTML = `
      <header><strong>${SCRIPT_NAME}</strong><span>v${VERSION}</span></header>
      <main>
        <div id="alta-payload-bridge-status"></div>
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <button id="alta-payload-bridge-sync">Sync Now</button>
          <button id="alta-payload-bridge-copy" class="secondary">Copy Logs</button>
        </div>
        <div id="alta-payload-bridge-log"></div>
      </main>
    `;
    document.body.appendChild(panel);
    state.panel = panel;
    state.ui.status = panel.querySelector('#alta-payload-bridge-status');
    state.ui.log = panel.querySelector('#alta-payload-bridge-log');
  }

  function bindPanel() {
    state.panel.querySelector('#alta-payload-bridge-sync')?.addEventListener('click', () => runSync('manual'));
    state.panel.querySelector('#alta-payload-bridge-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.logs.join('\n')); log('Copied logs'); } catch { log('Copy failed'); }
    });
    const header = state.panel.querySelector('header');
    let drag = null;
    header.addEventListener('mousedown', (event) => {
      drag = { x: event.clientX, y: event.clientY, left: state.panel.offsetLeft, top: state.panel.offsetTop };
      event.preventDefault();
    });
    window.addEventListener('mousemove', (event) => {
      if (!drag) return;
      state.panel.style.left = `${Math.max(0, drag.left + event.clientX - drag.x)}px`;
      state.panel.style.top = `${Math.max(0, drag.top + event.clientY - drag.y)}px`;
      state.panel.style.right = 'auto';
      state.panel.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      writeLocalJson(LOCAL.panelPos, {
        left: state.panel.style.left,
        top: state.panel.style.top,
        right: state.panel.style.right,
        bottom: state.panel.style.bottom
      });
    });
  }

  function restorePanelPos() {
    const pos = readLocalJson(LOCAL.panelPos);
    if (!pos) return;
    for (const prop of ['left', 'top', 'right', 'bottom']) {
      if (pos[prop]) state.panel.style[prop] = pos[prop];
    }
  }

  function renderStatus() {
    if (!state.ui.status) return;
    const job = isAltaHost() ? readLocalJson(LOCAL.altaCurrentJob) : readShared(SHARED.currentJob);
    const finalReady = isAzHost() ? readLocalJson(LOCAL.altaFinalReady) : readShared(SHARED.finalReady);
    state.ui.status.textContent = `Host: ${location.hostname} | AZ: ${normalizeText(job?.['AZ ID'] || '-')} | Final: ${finalReady?.ready ? 'ready' : 'waiting'}`;
  }

  function renderLogs() {
    if (state.ui.log) state.ui.log.textContent = state.logs.join('\n');
    renderStatus();
  }
})();
