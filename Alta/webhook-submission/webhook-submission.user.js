// ==UserScript==
// @name         GWPC Webhook Submission
// @namespace    homebot.webhook-submission
// @version      1.18.12
// @description  HOME-only GWPC sender. Waits for tm_pc_current_job_v1 handoff and final-ready Home payload flow, keeps the compatibility auto branch disabled, then sends one webhook payload while retaining stored Home payloads for reuse/testing.
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @connect      127.0.0.1
// @connect      localhost
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/webhook-submission/webhook-submission.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/webhook-submission/webhook-submission.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_TO_GWPC_WEBHOOK_SUBMISSION_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'GWPC Webhook Submission';
  const VERSION = '1.18.12';

  // Log-export integration: persist state.logLines to a tracked key so
  // storage-tools' LOGS TXT/CLEAR LOGS buttons can reach this script's
  // buffer from any origin. Key matches suffix `_logs_v1` + tracked prefix.
  const LOG_PERSIST_KEY = 'tm_pc_webhook_submission_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  const SCRIPT_ACTIVITY_KEY = 'tm_ui_script_activity_v1';
  const SCRIPT_ID = 'webhook-submission';
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';
  const FORCE_SEND_KEY = 'tm_pc_force_send_now_v1';
  const FLOW_STAGE_KEY = 'tm_pc_flow_stage_v1';
  const WEBHOOK_FATAL_HOLD_KEY = 'tm_pc_webhook_fatal_error_hold_v1';

  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';
  const LEGACY_SHARED_JOB_KEY = 'tm_shared_az_job_v1';
  const BUNDLE_KEY = 'tm_pc_webhook_bundle_v1';
  const HOME_KEY = 'tm_pc_home_quote_grab_payload_v1';

  const CFG = {
    webhookUrlKey: 'tm_pc_webhook_submit_url_v17',
    agencyNameKey: 'tm_pc_webhook_submit_agency_name_v1',
    sentMetaKey: 'tm_pc_webhook_submit_sent_meta_v17',
    postSuccessKey: 'tm_pc_webhook_post_success_v1',
    panelPosKey: 'tm_pc_webhook_submit_panel_pos_v17',
    stoppedKey: 'tm_pc_webhook_submit_stopped_v17',

    tickMs: 900,
    quoteVisibleDelayMs: 5000,
    requestTimeoutMs: 45000,
    maxSendAttempts: 3,
    maxLogLines: 140,
    panelWidth: 430,
    zIndex: 2147483647
  };

  const state = {
    running: true,
    busy: false,
    quoteSeenAt: 0,
    destroyed: false,
    tickTimer: null,
    logsIntervalTimer: null,
    panel: null,
    statusEl: null,
    logsEl: null,
    webhookUrlEl: null,
    agencyNameEl: null,
    activeUrlEl: null,
    toggleBtn: null,
    sendBtn: null,
    testBtn: null,
    unpauseBtn: null,
    copyLogsBtn: null,
    clearLogsBtn: null,
    logLines: [],
    drag: null,
    fatalOverlay: null,
    savedWebhookUrl: '',
    savedAgencyName: '',
    lastWaitKey: '',
    lastStatus: '',
    activityState: 'idle',
    activityMessage: 'Waiting for current job handoff'
  };

  init();

  function init() {
    clearStoppedForPageLoad();
    clearStaleSharedPause();
    hydrateWebhookStorage();
    hydrateAgencyNameStorage();
    buildUI();
    syncWebhookUi();
    renderButtons();
    log('Script loaded');
    log('Single sender armed');
    log(`Active webhook: ${getWebhookUrl() || '(empty)'}`);
    setStatus('Waiting for current job handoff');
    writeActivityState('waiting', 'Waiting for current job handoff');

    state.tickTimer = setInterval(tick, CFG.tickMs);
    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);

    window.addEventListener('beforeunload', persistWebhookBeforeUnload, { once: true, capture: true });
    window.addEventListener('pagehide', persistWebhookBeforeUnload, true);
    window.addEventListener('resize', keepPanelInView, true);
    document.addEventListener('visibilitychange', onVisibilityChange, true);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();

    tick();
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { writeActivityState('stopped', 'Cleanup'); } catch {}

    try { persistWebhookFromUi(false); } catch {}
    try { persistAgencyNameFromUi(false); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    try { window.removeEventListener('pagehide', persistWebhookBeforeUnload, true); } catch {}
    try { document.removeEventListener('visibilitychange', onVisibilityChange, true); } catch {}
    try { removeFatalWebhookOverlay(); } catch {}
    try { state.panel?.remove(); } catch {}
  }

  window.__AZ_TO_GWPC_WEBHOOK_SUBMISSION_CLEANUP__ = cleanup;

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
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

  function normalizeSpace(v) {
    return String(v == null ? '' : v).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(v) {
    return normalizeSpace(v);
  }

  function normalizeCompare(v) {
    return normalizeSpace(v)
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
    if (!aa || !bb) return false;
    return aa === bb || aa.includes(bb) || bb.includes(aa);
  }

  function isVisible(el) {
    if (!el) return false;
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

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return `h${Math.abs(h)}`;
  }

  function log(msg) {
    const line = `[${timeNow()}] ${msg}`;
    state.logLines.unshift(line);
    state.logLines = state.logLines.slice(0, CFG.maxLogLines);
    renderLogs();
    persistLogsThrottled();
    console.log(`[${SCRIPT_NAME}] ${msg}`);
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
    state.logLines.length = 0;
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

  function logWait(key, msg) {
    if (state.lastWaitKey === key) return;
    state.lastWaitKey = key;
    log(msg);
  }

  function clearWaitLog() {
    state.lastWaitKey = '';
  }

  function renderLogs() {
    if (!state.logsEl) return;
    state.logsEl.value = state.logLines.join('\n');
    state.logsEl.scrollTop = 0;
  }

  function clearLogs() {
    state.logLines = [];
    renderLogs();
    log('Logs cleared');
  }

  function setStatus(text) {
    state.lastStatus = text;
    if (state.statusEl) state.statusEl.textContent = text;
    writeActivityState(state.activityState, text);
  }

  function clearStoppedForPageLoad() {
    try { sessionStorage.removeItem(CFG.stoppedKey); } catch {}
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

  function writeActivityState(nextState, message = '') {
    state.activityState = normalizeText(nextState).toLowerCase() || 'idle';
    state.activityMessage = normalizeText(message || state.lastStatus || state.activityMessage || '') || '';

    const job = readCurrentJob();
    const current = readScriptActivityMap();
    current[SCRIPT_ID] = {
      scriptId: SCRIPT_ID,
      scriptName: SCRIPT_NAME,
      state: state.activityState,
      message: state.activityMessage,
      azId: normalizeText(job['AZ ID'] || ''),
      updatedAt: new Date().toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeScriptActivityMap(current);
  }

  function readWebhookUrlFromGM() {
    try {
      return normalizeText(GM_getValue(CFG.webhookUrlKey, ''));
    } catch {
      return '';
    }
  }

  function readWebhookUrlFromLocal() {
    try {
      return normalizeText(localStorage.getItem(CFG.webhookUrlKey) || '');
    } catch {
      return '';
    }
  }

  function mirrorWebhookUrl(url) {
    const normalized = normalizeText(url);

    try { GM_setValue(CFG.webhookUrlKey, normalized); } catch {}
    try { localStorage.setItem(CFG.webhookUrlKey, normalized); } catch {}
    try { sessionStorage.setItem(CFG.webhookUrlKey, normalized); } catch {}

    state.savedWebhookUrl = normalized;
    return normalized;
  }

  function hydrateWebhookStorage() {
    const gmUrl = readWebhookUrlFromGM();
    const localUrl = readWebhookUrlFromLocal();
    const resolved = gmUrl || localUrl || '';

    if (resolved) mirrorWebhookUrl(resolved);
    else state.savedWebhookUrl = '';
  }

  function getWebhookUrl() {
    const gmUrl = readWebhookUrlFromGM();
    const localUrl = readWebhookUrlFromLocal();
    const resolved = gmUrl || localUrl || state.savedWebhookUrl || '';

    if (resolved && (gmUrl !== resolved || localUrl !== resolved || state.savedWebhookUrl !== resolved)) {
      mirrorWebhookUrl(resolved);
    } else {
      state.savedWebhookUrl = resolved;
    }

    return resolved;
  }

  function getCurrentWebhookUrlFromUi() {
    const uiValue = normalizeSpace(state.webhookUrlEl?.value || '');
    return uiValue || getWebhookUrl();
  }

  function readAgencyNameFromGM() {
    try {
      return normalizeText(GM_getValue(CFG.agencyNameKey, ''));
    } catch {
      return '';
    }
  }

  function readAgencyNameFromLocal() {
    try {
      return normalizeText(localStorage.getItem(CFG.agencyNameKey) || '');
    } catch {
      return '';
    }
  }

  function mirrorAgencyName(name) {
    const normalized = normalizeText(name);

    try { GM_setValue(CFG.agencyNameKey, normalized); } catch {}
    try { localStorage.setItem(CFG.agencyNameKey, normalized); } catch {}
    try { sessionStorage.setItem(CFG.agencyNameKey, normalized); } catch {}

    state.savedAgencyName = normalized;
    return normalized;
  }

  function hydrateAgencyNameStorage() {
    const gmName = readAgencyNameFromGM();
    const localName = readAgencyNameFromLocal();
    const resolved = gmName || localName || '';

    if (resolved) mirrorAgencyName(resolved);
    else state.savedAgencyName = '';
  }

  function getAgencyName() {
    const gmName = readAgencyNameFromGM();
    const localName = readAgencyNameFromLocal();
    const resolved = gmName || localName || state.savedAgencyName || '';

    if (resolved && (gmName !== resolved || localName !== resolved || state.savedAgencyName !== resolved)) {
      mirrorAgencyName(resolved);
    } else {
      state.savedAgencyName = resolved;
    }

    return resolved;
  }

  function persistAgencyNameFromUi(withLog = false) {
    const current = normalizeSpace(state.agencyNameEl?.value || '');
    const before = getAgencyName();
    const saved = mirrorAgencyName(current);

    if (withLog && saved !== before) {
      log(saved ? 'Agency Name saved' : 'Agency Name cleared');
    }

    return saved;
  }

  function persistWebhookFromUi(withLog = false) {
    const current = normalizeSpace(state.webhookUrlEl?.value || '');
    const before = getWebhookUrl();
    const saved = mirrorWebhookUrl(current);
    updateActiveWebhookUi(saved);

    if (withLog && saved !== before) {
      log(saved ? 'Webhook URL saved' : 'Webhook URL cleared');
    }

    return saved;
  }

  function persistWebhookBeforeUnload() {
    try { persistWebhookFromUi(false); } catch {}
    try { persistAgencyNameFromUi(false); } catch {}
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      try { persistWebhookFromUi(false); } catch {}
      try { persistAgencyNameFromUi(false); } catch {}
    }
  }

  function isValidHttpUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function isLoopbackWebhookUrl(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
    } catch {
      return false;
    }
  }

  function truncateMiddle(text, max = 100) {
    const value = String(text || '');
    if (value.length <= max) return value;
    const part = Math.max(12, Math.floor((max - 3) / 2));
    return `${value.slice(0, part)}...${value.slice(-part)}`;
  }

  function updateActiveWebhookUi(url) {
    const current = normalizeText(url);
    if (state.activeUrlEl) {
      state.activeUrlEl.textContent = current ? truncateMiddle(current, 110) : '(empty)';
      state.activeUrlEl.title = current || '';
    }
  }

  function syncWebhookUi() {
    const url = getWebhookUrl();
    if (state.webhookUrlEl && state.webhookUrlEl.value !== url) state.webhookUrlEl.value = url;
    const agencyName = getAgencyName();
    if (state.agencyNameEl && state.agencyNameEl.value !== agencyName) state.agencyNameEl.value = agencyName;
    updateActiveWebhookUi(url);
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
    const legacyName = [az['AZ Name'], az['AZ Last']].map(v => normalizeText(v)).filter(Boolean).join(' ').trim();
    const legacyAddress = [
      normalizeText(az['AZ Street Address']),
      normalizeText(az['AZ City']),
      normalizeText(az['AZ State']) && normalizeText(az['AZ Postal Code']) ? `${normalizeText(az['AZ State'])} ${normalizeText(az['AZ Postal Code'])}` : ''
    ].filter(Boolean).join(', ');

    out['AZ ID'] = normalizeText(raw['AZ ID'] || raw.ticketId || raw.masterId || raw.id || az['AZ ID'] || '');
    out['Name'] = normalizeText(raw['Name'] || raw.name || legacyName || '');
    out['Mailing Address'] = normalizeText(raw['Mailing Address'] || raw.mailingAddress || legacyAddress || '');
    out['SubmissionNumber'] = normalizeText(raw['SubmissionNumber'] || raw.submissionNumber || raw['Submission Number'] || '');
    out['updatedAt'] = normalizeText(raw['updatedAt'] || raw.lastUpdatedAt || raw?.meta?.lastUpdatedAt || raw?.meta?.createdAt || '');
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
    let raw = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    let job = normalizeCurrentJob(raw);
    if (job['AZ ID']) return job;

    try { raw = GM_getValue(CURRENT_JOB_KEY, null); } catch { raw = null; }
    job = normalizeCurrentJob(raw);
    if (job['AZ ID']) return job;

    try { raw = GM_getValue(LEGACY_SHARED_JOB_KEY, null); } catch { raw = null; }
    job = normalizeCurrentJob(raw);
    return job;
  }

  function readFlowStage() {
    const stage = safeJsonParse(localStorage.getItem(FLOW_STAGE_KEY), null);
    return isPlainObject(stage) ? stage : {};
  }

  function matchesStage(product, step, azId = '') {
    const stage = readFlowStage();
    if (normalizeText(stage.product) !== normalizeText(product)) return false;
    if (normalizeText(stage.step) !== normalizeText(step)) return false;
    if (!normalizeText(stage.azId) || !normalizeText(azId)) return true;
    return normalizeText(stage.azId) === normalizeText(azId);
  }

  function writeFlowStage(product, step, azId = '') {
    const next = {
      product: normalizeText(product),
      step: normalizeText(step),
      azId: normalizeText(azId),
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    localStorage.setItem(FLOW_STAGE_KEY, JSON.stringify(next, null, 2));
    return next;
  }

  function readBundleRaw() {
    return safeJsonParse(localStorage.getItem(BUNDLE_KEY), null);
  }

  function readHomePayload() {
    return safeJsonParse(localStorage.getItem(HOME_KEY), null);
  }

  function hasMeaningfulHome(bundle) {
    return !!(bundle?.home?.ready && isPlainObject(bundle?.home?.data));
  }

  function hasMeaningfulAuto(bundle) {
    return false;
  }

  function hasPendingTimeout(bundle) {
    return !!(bundle?.timeout?.ready && Array.isArray(bundle?.timeout?.events) && bundle.timeout.events.length);
  }

  function getTimeoutEvents(bundle) {
    return Array.isArray(bundle?.timeout?.events) ? bundle.timeout.events : [];
  }

  function hasSectionErrors(section) {
    if (!isPlainObject(section?.data)) return false;
    if (Array.isArray(section.data.errors) && section.data.errors.length) return true;
    return !!(isPlainObject(section.data.latestError) && normalizeText(section.data.latestError.errorType || section.data.latestError.errorName || section.data.latestError.errorText));
  }

  function hasHomeError(bundle) {
    if (hasSectionErrors(bundle?.home)) return true;
    return getTimeoutEvents(bundle).some((event) => normalizeText(event?.product).toLowerCase() === 'home');
  }

  function hasAutoError(bundle) {
    return false;
  }

  function hasHomeSuccess(bundle) {
    return hasMeaningfulHome(bundle) && !hasHomeError(bundle);
  }

  function normalizeHomeOnlyBundle(bundle) {
    if (!isPlainObject(bundle)) return bundle;
    const next = deepClone(bundle);
    next.auto = { ready: false, data: null };
    return next;
  }

  function buildHomeOnlySyntheticBundle(job, homePayload) {
    const row = isPlainObject(homePayload?.row) ? homePayload.row : null;
    if (!row) return null;
    if (homePayload?.ready !== true) return null;

    const payloadAzId = normalizeText(homePayload?.['AZ ID'] || homePayload?.currentJob?.['AZ ID'] || '');
    if (!payloadAzId || payloadAzId !== job['AZ ID']) return null;

    const name = normalizeText(row['Name'] || row.name || '');
    const address = normalizeText(row['Mailing Address'] || row.mailingAddress || '');

    if (!name || !address) return null;
    if (!namesLikelySame(job['Name'], name)) return null;
    if (!addressesLikelySame(job['Mailing Address'], address)) return null;

    return {
      'AZ ID': job['AZ ID'],
      home: {
        ready: true,
        data: deepClone(row),
        sourcePayload: deepClone(homePayload),
        sourceKey: HOME_KEY
      },
      auto: {
        ready: false,
        data: null
      },
      timeout: {
        ready: false,
        events: []
      },
      meta: {
        synthetic: true,
        builtFrom: HOME_KEY,
        builtAt: nowIso()
      }
    };
  }

  function getEffectiveBundle(job) {
    const rawBundle = readBundleRaw();

    if (isPlainObject(rawBundle) &&
        normalizeText(rawBundle['AZ ID']) === job['AZ ID'] &&
        (hasMeaningfulHome(rawBundle) || hasPendingTimeout(rawBundle))) {
      return {
        bundle: normalizeHomeOnlyBundle(rawBundle),
        source: 'bundle'
      };
    }

    const homePayload = readHomePayload();
    const synthetic = buildHomeOnlySyntheticBundle(job, homePayload);
    if (synthetic) {
      return {
        bundle: synthetic,
        source: 'home-payload'
      };
    }

    return {
      bundle: null,
      source: ''
    };
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

  function getSentMeta() {
    return safeJsonParse(localStorage.getItem(CFG.sentMetaKey), null);
  }

  function setSentMeta(meta) {
    localStorage.setItem(CFG.sentMetaKey, JSON.stringify(meta));
  }

  function clearSentMeta() {
    localStorage.removeItem(CFG.sentMetaKey);
  }

  function setPostSuccess(job, signature) {
    const payload = {
      ok: true,
      azId: normalizeText(job?.['AZ ID'] || ''),
      postedAt: nowIso(),
      signature: normalizeText(signature || ''),
      source: SCRIPT_NAME,
      version: VERSION
    };

    try { GM_setValue(CFG.postSuccessKey, payload); } catch {}
    try { localStorage.setItem(CFG.postSuccessKey, JSON.stringify(payload)); } catch {}
    return payload;
  }

  function readFatalWebhookHold() {
    let value = null;
    try { value = safeJsonParse(localStorage.getItem(WEBHOOK_FATAL_HOLD_KEY), null); } catch {}
    if (isPlainObject(value)) return value;
    try { value = GM_getValue(WEBHOOK_FATAL_HOLD_KEY, null); } catch { value = null; }
    return isPlainObject(value) ? value : null;
  }

  function writeFatalWebhookHold(record) {
    try { GM_setValue(WEBHOOK_FATAL_HOLD_KEY, record); } catch {}
    try { localStorage.setItem(WEBHOOK_FATAL_HOLD_KEY, JSON.stringify(record)); } catch {}
  }

  function clearFatalWebhookHold(azId = '') {
    const current = readFatalWebhookHold();
    if (!current) return;
    const wantedAzId = normalizeText(azId || '');
    const currentAzId = normalizeText(current.azId || '');
    if (wantedAzId && currentAzId && wantedAzId !== currentAzId) return;
    try { GM_setValue(WEBHOOK_FATAL_HOLD_KEY, null); } catch {}
    try { localStorage.removeItem(WEBHOOK_FATAL_HOLD_KEY); } catch {}
    removeFatalWebhookOverlay();
  }

  function makeWebhookHttpError(status, raw) {
    const statusCode = Number(status || 0);
    const responseText = String(raw == null ? '' : raw);
    const snippet = normalizeSpace(responseText).slice(0, 300);
    const err = new Error(`HTTP ${statusCode}${snippet ? ` | ${snippet}` : ''}`);
    err.webhookHttpStatus = statusCode;
    err.responseText = responseText;
    return err;
  }

  function isFatalWebhook404(err) {
    return Number(err?.webhookHttpStatus || err?.status || 0) === 404;
  }

  function buildFatalWebhookHoldRecord(err, job, endpoint, signature) {
    return {
      active: true,
      kind: 'webhook-http-404',
      status: 404,
      error: normalizeText(err?.message || 'HTTP 404'),
      responseText: String(err?.responseText || '').slice(0, 1200),
      endpoint: normalizeText(endpoint || ''),
      azId: normalizeText(job?.['AZ ID'] || ''),
      submissionNumber: normalizeText(job?.SubmissionNumber || ''),
      signature: normalizeText(signature || ''),
      pageUrl: location.href,
      pageTitle: document.title,
      createdAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
  }

  function removeFatalWebhookOverlay() {
    try { state.fatalOverlay?.remove(); } catch {}
    state.fatalOverlay = null;
    try { document.getElementById('hb-webhook-fatal-error-overlay')?.remove(); } catch {}
  }

  function addFatalOverlayLine(parent, label, value) {
    const row = document.createElement('div');
    row.style.marginTop = '8px';

    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    row.appendChild(strong);

    const span = document.createElement('span');
    span.textContent = normalizeText(value || '(blank)');
    row.appendChild(span);

    parent.appendChild(row);
  }

  function showFatalWebhookOverlay(record) {
    removeFatalWebhookOverlay();

    const box = document.createElement('div');
    box.id = 'hb-webhook-fatal-error-overlay';
    box.setAttribute('data-hb-script-id', SCRIPT_ID);
    Object.assign(box.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: String(CFG.zIndex),
      width: 'min(580px, calc(100vw - 32px))',
      maxHeight: 'calc(100vh - 48px)',
      overflow: 'auto',
      background: '#7f1d1d',
      color: '#fff',
      border: '3px solid #fca5a5',
      borderRadius: '18px',
      boxShadow: '0 24px 80px rgba(0,0,0,.55)',
      padding: '18px',
      font: '14px/1.45 Arial, sans-serif'
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'X';
    Object.assign(close.style, {
      position: 'absolute',
      top: '10px',
      right: '10px',
      border: '0',
      borderRadius: '999px',
      width: '30px',
      height: '30px',
      background: '#fee2e2',
      color: '#7f1d1d',
      fontWeight: '900',
      cursor: 'pointer'
    });
    close.addEventListener('click', () => removeFatalWebhookOverlay(), true);

    const title = document.createElement('div');
    title.textContent = 'Error with webhook';
    title.style.fontSize = '22px';
    title.style.fontWeight = '900';
    title.style.paddingRight = '42px';

    const message = document.createElement('div');
    message.textContent = 'The webhook returned HTTP 404. This tab will stay open so the payload is not lost.';
    message.style.marginTop = '8px';

    const pre = document.createElement('pre');
    pre.textContent = normalizeText(record.responseText || record.error || 'HTTP 404');
    Object.assign(pre.style, {
      margin: '12px 0 0',
      padding: '12px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      background: 'rgba(0,0,0,.28)',
      border: '1px solid rgba(255,255,255,.28)',
      borderRadius: '12px',
      maxHeight: '220px',
      overflow: 'auto'
    });

    box.appendChild(close);
    box.appendChild(title);
    box.appendChild(message);
    addFatalOverlayLine(box, 'AZ ID', record.azId);
    addFatalOverlayLine(box, 'Submission', record.submissionNumber);
    addFatalOverlayLine(box, 'Endpoint', record.endpoint);
    addFatalOverlayLine(box, 'Error', record.error);
    box.appendChild(pre);
    document.documentElement.appendChild(box);
    state.fatalOverlay = box;
  }

  function handleFatalWebhook404(err, job, endpoint, signature) {
    const record = buildFatalWebhookHoldRecord(err, job, endpoint, signature);
    writeFatalWebhookHold(record);
    showFatalWebhookOverlay(record);
    clearForceSendRequest();
    state.running = false;
    try { sessionStorage.setItem(CFG.stoppedKey, '1'); } catch {}
    state.busy = false;
    state.quoteSeenAt = 0;
    setStatus('Error with webhook - tab held open');
    writeActivityState('error', `Webhook HTTP 404 | ${record.error}`);
    renderButtons();
    log(`Webhook fatal 404 hold active | AZ ${record.azId || '(blank)'} | submission ${record.submissionNumber || '(blank)'} | error="${record.error}"`);
  }

  function isGloballyPaused() {
    try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch { return false; }
  }

  function readForceSendRequest() {
    return safeJsonParse(localStorage.getItem(FORCE_SEND_KEY), null);
  }

  function hasForceSendRequest() {
    const request = readForceSendRequest();
    return !!(request && typeof request === 'object' && request.requestedAt);
  }

  function requestForceSend(reason = 'manual-send') {
    const request = {
      requestedAt: nowIso(),
      reason: normalizeText(reason || 'manual-send'),
      source: SCRIPT_NAME
    };
    try { localStorage.setItem(GLOBAL_PAUSE_KEY, '1'); } catch {}
    try { localStorage.setItem(FORCE_SEND_KEY, JSON.stringify(request, null, 2)); } catch {}
    log(`Force send requested: ${request.reason}`);
    setStatus('Force send requested');
    state.quoteSeenAt = 0;
    return request;
  }

  function clearForceSendRequest() {
    try { localStorage.removeItem(FORCE_SEND_KEY); } catch {}
    try { localStorage.removeItem(GLOBAL_PAUSE_KEY); } catch {}
  }

  function clearStaleSharedPause() {
    if (hasForceSendRequest()) return;
    try {
      if (localStorage.getItem(GLOBAL_PAUSE_KEY) === '1') {
        localStorage.removeItem(GLOBAL_PAUSE_KEY);
      }
    } catch {}
  }

  function isSameBundleAlreadySent(job, bundle) {
    const meta = getSentMeta();
    if (!meta || !meta.signature) return false;
    return meta.signature === buildSignatureJobBundle(job, bundle);
  }

  function getAllDocs() {
    const docs = [];
    const seen = new Set();

    function walk(win) {
      try {
        if (!win || seen.has(win)) return;
        seen.add(win);
        if (win.document) docs.push(win.document);
        for (let i = 0; i < win.frames.length; i++) walk(win.frames[i]);
      } catch {}
    }

    walk(window);
    return docs;
  }

  function extractSubmissionNumberFromPage() {
    for (const doc of getAllDocs()) {
      let nodes = [];
      try { nodes = Array.from(doc.querySelectorAll('.gw-Wizard--Title, .gw-TitleBar--title, .gw-TitleBar--Title, [role="heading"], h1, h2')); } catch {}
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const text = normalizeText(el.textContent || '');
        const match = text.match(/Submission\s+(\d{6,})/i);
        if (match) return match[1];
      }
    }
    return '';
  }

  function getExpectedSubmissionNumber(job, bundle) {
    return normalizeText(
      job?.['SubmissionNumber'] ||
      bundle?.['SubmissionNumber'] ||
      bundle?.home?.data?.row?.['Submission Number'] ||
      bundle?.home?.submissionNumber ||
      ''
    );
  }

  function getSubmissionGuard(job, bundle) {
    const expected = getExpectedSubmissionNumber(job, bundle);
    const active = extractSubmissionNumberFromPage();
    if (!expected || !active || expected === active) {
      return { ok: true, expected, active };
    }
    return {
      ok: false,
      expected,
      active,
      reason: `Submission mismatch: page ${active}, current job ${expected}`
    };
  }

  function findQuoteHeader() {
    for (const doc of getAllDocs()) {
      let nodes = [];
      try { nodes = Array.from(doc.querySelectorAll('div.gw-TitleBar--title, .gw-TitleBar--title[role="heading"]')); } catch {}
      for (const el of nodes) {
        if (normalizeSpace(el.textContent) === 'Quote' && isVisible(el)) return el;
      }
    }
    return null;
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

  function validateCurrentJobAndBundle(job, bundle) {
    if (!job['AZ ID']) return { ok: false, reason: 'Waiting for tm_pc_current_job_v1 / AZ ID' };
    if (!job['Name'] || !job['Mailing Address']) return { ok: false, reason: 'Waiting for full tm_pc_current_job_v1 identity' };
    if (!isPlainObject(bundle)) return { ok: false, reason: 'Waiting for home payload / bundle' };
    if (normalizeText(bundle['AZ ID']) !== job['AZ ID']) return { ok: false, reason: 'Bundle AZ ID mismatch' };
    if (!(hasMeaningfulHome(bundle) || hasPendingTimeout(bundle))) {
      return { ok: false, reason: 'Waiting for gathered data' };
    }
    return { ok: true };
  }

  function buildRequestBody(job, bundle, signature, test = false) {
    return {
      'Agency Name': getAgencyName(),
      event: test ? 'az_to_gwpc_bundle_test' : 'az_to_gwpc_bundle',
      test,
      sender: {
        script: SCRIPT_NAME,
        version: VERSION,
        sentAt: nowIso(),
        pageUrl: location.href,
        pageTitle: document.title,
        signature
      },
      currentJob: deepClone(job),
      bundle: deepClone(bundle),
      summary: {
        hasHome: hasMeaningfulHome(bundle),
        hasAuto: hasMeaningfulAuto(bundle),
        hasTimeout: hasPendingTimeout(bundle),
        hasHomeError: hasHomeError(bundle),
        hasAutoError: hasAutoError(bundle),
        timeoutCount: Array.isArray(bundle?.timeout?.events) ? bundle.timeout.events.length : 0
      }
    };
  }

  async function fetchPostJson(url, data, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const local = isLoopbackWebhookUrl(url);
    try {
      const res = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        headers: { 'Content-Type': local ? 'text/plain;charset=UTF-8' : 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      return {
        status: res.status,
        responseText: await res.text()
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function gmPostJson(url, data, timeoutMs) {
    return new Promise((resolve, reject) => {
      const tryLocalFetchFallback = async () => {
        if (!isLoopbackWebhookUrl(url) || typeof fetch !== 'function') {
          reject(new Error('Network error'));
          return;
        }
        try {
          resolve(await fetchPostJson(url, data, timeoutMs));
        } catch (err) {
          reject(new Error(`Network error; local fetch fallback failed: ${err?.message || err}`));
        }
      };

      if (typeof GM_xmlhttpRequest !== 'function') {
        tryLocalFetchFallback();
        return;
      }

      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': isLoopbackWebhookUrl(url) ? 'text/plain;charset=UTF-8' : 'application/json' },
        data: JSON.stringify(data),
        timeout: timeoutMs,
        onload: (res) => resolve(res),
        onerror: tryLocalFetchFallback,
        ontimeout: () => reject(new Error('Request timeout'))
      });
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function afterSuccess(job, bundle) {
    writeFlowStage('home', 'done', job['AZ ID']);

    state.running = false;
    sessionStorage.setItem(CFG.stoppedKey, '1');
    clearForceSendRequest();
    renderButtons();
    log('Stored payloads retained after send');
    writeActivityState('done', 'Sent | Payload retained | Stopped');
    setStatus('Sent | Payload retained | Stopped');
  }

  async function sendTestWebhook() {
    if (state.busy) {
      log('Test skipped: already busy');
      return;
    }

    const endpoint = getCurrentWebhookUrlFromUi();
    if (!isValidHttpUrl(endpoint)) {
      setStatus('Webhook URL missing');
      log('Test failed: webhook URL missing or invalid');
      return;
    }

    persistWebhookFromUi(false);
    persistAgencyNameFromUi(false);

    const job = readCurrentJob();
    const resolved = getEffectiveBundle(job);
    const bundle = resolved.bundle || {
      'AZ ID': job['AZ ID'] || '',
      home: { ready: false, data: null },
      auto: { ready: false, data: null },
      timeout: { ready: false, events: [] },
      meta: { synthetic: true, builtAt: nowIso(), builtFrom: 'test-fallback' }
    };

    const requestBody = buildRequestBody(job, bundle, `test_${Date.now()}`, true);

    state.busy = true;
    renderButtons();
    setStatus('Sending test...');
    log(`TEST POST ${endpoint}`);

    try {
      const res = await gmPostJson(endpoint, requestBody, CFG.requestTimeoutMs);
      const raw = typeof res?.responseText === 'string' ? res.responseText : '';
      const json = safeJsonParse(raw, null);

      if (res.status < 200 || res.status >= 400) {
        throw new Error(`HTTP ${res.status}${raw ? ` | ${raw.slice(0, 300)}` : ''}`);
      }
      if (json && json.ok === false) {
        throw new Error(json.error || json.message || 'Receiver returned ok:false');
      }

      setStatus('Test sent');
      log('Test webhook success');
    } catch (err) {
      setStatus('Test failed');
      log(`Test failed: ${err?.message || err}`);
    } finally {
      state.busy = false;
      renderButtons();
    }
  }

  function shouldSendNow(bundle) {
    if (hasHomeError(bundle)) return true;
    if (hasPendingTimeout(bundle)) return true;

    if (!hasMeaningfulHome(bundle)) {
      state.quoteSeenAt = 0;
      return false;
    }

    state.quoteSeenAt = 0;
    return true;
  }

  async function sendBundle(force = false) {
    if (state.busy) {
      log('Send skipped: already busy');
      return;
    }
    if (isGloballyPaused() && !force) {
      setStatus('Paused by shared selector');
      return;
    }
    if (!state.running && !force) return;

    const endpoint = getCurrentWebhookUrlFromUi();
    if (!isValidHttpUrl(endpoint)) {
      setStatus('Webhook URL missing');
      log('Send failed: webhook URL missing or invalid');
      return;
    }

    persistWebhookFromUi(false);
    persistAgencyNameFromUi(false);

    const job = readCurrentJob();
    const resolved = getEffectiveBundle(job);
    const bundle = resolved.bundle;
    const source = resolved.source || 'none';
    const shouldClearForceSendAfterFailure = force || hasForceSendRequest();

    const valid = validateCurrentJobAndBundle(job, bundle);
    if (!valid.ok) {
      setStatus(valid.reason);
      if (force) log(`Send blocked: ${valid.reason}`);
      return;
    }

    const submissionGuard = getSubmissionGuard(job, bundle);
    if (!submissionGuard.ok) {
      setStatus(submissionGuard.reason);
      if (force) log(`Send blocked: ${submissionGuard.reason}`);
      return;
    }

    if (!force && !shouldSendNow(bundle)) return;

    clearWaitLog();

    const signature = buildSignatureJobBundle(job, bundle);
    if (!force && isSameBundleAlreadySent(job, bundle)) {
      setStatus('Already sent');
      log('Same bundle already sent');
      return;
    }

    state.busy = true;
    renderButtons();
    writeActivityState('working', force ? 'Sending force webhook' : 'Sending webhook');
    setStatus('Sending...');
    log(`POST ${endpoint}`);
    log(`Current Job AZ ID: ${job['AZ ID']}`);
    log(`Current Job Submission: ${job['SubmissionNumber'] || '(blank)'}`);
    log(`Bundle source: ${source}`);
    log(`Bundle sections -> home:${hasMeaningfulHome(bundle) ? 'yes' : 'no'} auto:${hasMeaningfulAuto(bundle) ? 'yes' : 'no'} timeout:${hasPendingTimeout(bundle) ? 'yes' : 'no'}`);
    log(`Bundle errors -> home:${hasHomeError(bundle) ? 'yes' : 'no'} auto:${hasAutoError(bundle) ? 'yes' : 'no'}`);

    const requestBody = buildRequestBody(job, bundle, signature, false);

    let lastErr = null;
    for (let attempt = 1; attempt <= CFG.maxSendAttempts; attempt++) {
      try {
        log(`Send attempt ${attempt}/${CFG.maxSendAttempts}`);
        const res = await gmPostJson(endpoint, requestBody, CFG.requestTimeoutMs);
        const raw = typeof res?.responseText === 'string' ? res.responseText : '';
        const json = safeJsonParse(raw, null);

        if (res.status < 200 || res.status >= 400) {
          throw makeWebhookHttpError(res.status, raw);
        }
        if (json && json.ok === false) {
          throw new Error(json.error || json.message || 'Receiver returned ok:false');
        }

        clearFatalWebhookHold(job['AZ ID']);
        setSentMeta({ signature, sentAt: nowIso(), azId: job['AZ ID'] });
        setPostSuccess(job, signature);
        log('Webhook send success');
        await afterSuccess(job, bundle);
        state.busy = false;
        renderButtons();
        return;
      } catch (err) {
        lastErr = err;
        if (isFatalWebhook404(err)) {
          log(`Send attempt failed with fatal HTTP 404: ${err?.message || err}`);
          handleFatalWebhook404(err, job, endpoint, signature);
          return;
        }
        log(`Send attempt failed: ${err?.message || err}`);
      }
    }

    setStatus('Send failed');
    state.busy = false;
    // Release the pause flag + force-send request so the pipeline can continue
    // with the next ticket. Without this the shared pause stays set and every
    // downstream script sees "paused" forever after a transient network error.
    if (shouldClearForceSendAfterFailure) {
      clearForceSendRequest();
      log('Cleared force-send request after exhausted retries');
    }
    writeActivityState('error', lastErr?.message || 'Send failed');
    renderButtons();
    log(`Send failed: ${lastErr?.message || lastErr || 'Unknown error'}`);
  }

  function tick() {
    if (state.destroyed) return;
    if (state.busy) {
      writeActivityState('working', state.lastStatus || 'Sending webhook');
      return;
    }
    const forceSend = hasForceSendRequest();
    if (isGloballyPaused() && !forceSend) {
      writeActivityState('paused', 'Paused by shared selector');
      setStatus('Paused by shared selector');
      return;
    }
    if (!state.running && !forceSend) {
      writeActivityState('stopped', 'Stopped');
      setStatus('Stopped');
      return;
    }

    writeActivityState('waiting', state.lastStatus || 'Waiting for sender trigger');

    const job = readCurrentJob();
    const resolved = getEffectiveBundle(job);
    const bundle = resolved.bundle;

    if (!job['AZ ID']) {
      state.quoteSeenAt = 0;
      setStatus(forceSend ? 'Force send waiting for current job handoff' : 'Waiting for current job handoff');
      logWait(forceSend ? 'force-wait-job' : 'wait-job', 'Waiting for tm_pc_current_job_v1 / AZ ID');
      return;
    }

    if (!job['Name'] || !job['Mailing Address']) {
      state.quoteSeenAt = 0;
      setStatus(forceSend ? 'Force send waiting for full current job' : 'Waiting for full current job');
      logWait(forceSend ? 'force-wait-job-identity' : 'wait-job-identity', 'Waiting for tm_pc_current_job_v1 identity');
      return;
    }

    if (!bundle) {
      state.quoteSeenAt = 0;
      setStatus(forceSend ? 'Force send waiting for payload / bundle' : 'Waiting for home payload / bundle');
      logWait(forceSend ? 'force-wait-payload' : 'wait-payload', 'Waiting for tm_pc_home_quote_grab_payload_v1 or tm_pc_webhook_bundle_v1');
      return;
    }

    clearWaitLog();

    const submissionGuard = getSubmissionGuard(job, bundle);
    if (!submissionGuard.ok) {
      state.quoteSeenAt = 0;
      setStatus(submissionGuard.reason);
      logWait(
        `wait-submission:${submissionGuard.expected}:${submissionGuard.active}`,
        `Holding send: page submission ${submissionGuard.active} != current job ${submissionGuard.expected}`
      );
      return;
    }

    if (!forceSend) {
      const stageReady = matchesStage('home', 'sender', job['AZ ID']);
      if (!stageReady) {
        state.quoteSeenAt = 0;
        setStatus('Waiting for sender trigger');
        logWait('wait-stage-sender', 'Waiting for shared sender trigger');
        return;
      }
    }

    if (forceSend) {
      setStatus('Force send ready');
      sendBundle(true);
      return;
    }

    if (hasHomeError(bundle)) {
      setStatus('Home error ready');
      sendBundle(false);
      return;
    }

    if (hasPendingTimeout(bundle)) {
      setStatus('Timeout bundle ready');
      sendBundle(false);
      return;
    }

    if (hasMeaningfulHome(bundle)) {
      sendBundle(false);
      return;
    }

    state.quoteSeenAt = 0;
    setStatus('Waiting for gathered data');
    logWait('wait-gathered', 'Waiting for gathered data');
  }

  function keepPanelInView() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;

    if (rect.right > window.innerWidth) left = Math.max(0, window.innerWidth - rect.width - 8);
    if (rect.bottom > window.innerHeight) top = Math.max(0, window.innerHeight - rect.height - 8);
    if (left < 0) left = 0;
    if (top < 0) top = 0;

    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
  }

  function savePanelPos() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    localStorage.setItem(CFG.panelPosKey, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  function restorePanelPos() {
    if (!state.panel) return;
    const saved = safeJsonParse(localStorage.getItem(CFG.panelPosKey), null);
    if (!saved || typeof saved.left !== 'number' || typeof saved.top !== 'number') return;
    state.panel.style.left = `${Math.max(0, saved.left)}px`;
    state.panel.style.top = `${Math.max(0, saved.top)}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    keepPanelInView();
  }

  function beginDrag(ev) {
    if (!state.panel || ev.target.closest('button, input, textarea')) return;
    const rect = state.panel.getBoundingClientRect();
    state.drag = {
      startX: ev.clientX,
      startY: ev.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      prevUserSelect: document.body.style.userSelect || ''
    };
    state.panel.style.left = `${rect.left}px`;
    state.panel.style.top = `${rect.top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onDragMove, true);
    window.addEventListener('mouseup', endDrag, true);
    ev.preventDefault();
  }

  function onDragMove(ev) {
    if (!state.drag || !state.panel) return;
    const dx = ev.clientX - state.drag.startX;
    const dy = ev.clientY - state.drag.startY;
    let left = state.drag.startLeft + dx;
    let top = state.drag.startTop + dy;
    left = Math.max(0, Math.min(window.innerWidth - state.panel.offsetWidth, left));
    top = Math.max(0, Math.min(window.innerHeight - state.panel.offsetHeight, top));
    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
  }

  function endDrag() {
    if (!state.drag) return;
    document.body.style.userSelect = state.drag.prevUserSelect || '';
    state.drag = null;
    window.removeEventListener('mousemove', onDragMove, true);
    window.removeEventListener('mouseup', endDrag, true);
    savePanelPos();
  }

  function renderButtons() {
    if (state.toggleBtn) {
      state.toggleBtn.textContent = state.running ? 'STOP' : 'START';
      state.toggleBtn.style.background = state.running ? '#dc2626' : '#16a34a';
    }
    if (state.sendBtn) state.sendBtn.disabled = state.busy;
    if (state.testBtn) state.testBtn.disabled = state.busy;
    if (state.unpauseBtn) state.unpauseBtn.disabled = state.busy || (!isGloballyPaused() && !hasForceSendRequest());
  }

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = `
      #az-to-gwpc-webhook-panel{position:fixed;right:12px;bottom:12px;width:${CFG.panelWidth}px;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.35);z-index:${CFG.zIndex};font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #az-to-gwpc-webhook-panel *{box-sizing:border-box}
      #az-to-gwpc-webhook-panel .hb-head{padding:10px 12px;background:#0f172a;border-bottom:1px solid #374151;cursor:move;font-weight:700}
      #az-to-gwpc-webhook-panel .hb-body{padding:10px 12px}
      #az-to-gwpc-webhook-panel .hb-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
      #az-to-gwpc-webhook-panel button,#az-to-gwpc-webhook-panel input,#az-to-gwpc-webhook-panel textarea{font:12px Arial,sans-serif}
      #az-to-gwpc-webhook-panel button{border:0;border-radius:8px;padding:7px 10px;font-weight:700;cursor:pointer;color:#fff}
      #az-to-gwpc-webhook-panel .hb-btn-blue{background:#2563eb}
      #az-to-gwpc-webhook-panel .hb-btn-gray{background:#4b5563}
      #az-to-gwpc-webhook-panel .hb-btn-orange{background:#d97706}
      #az-to-gwpc-webhook-panel .hb-btn-red{background:#dc2626}
      #az-to-gwpc-webhook-panel .hb-status{margin-bottom:8px;padding:6px 8px;border-radius:8px;background:#1f2937;word-break:break-word}
      #az-to-gwpc-webhook-panel .hb-field{display:flex;flex-direction:column;gap:4px;flex:1 1 100%}
      #az-to-gwpc-webhook-panel .hb-label{opacity:.85;font-size:11px}
      #az-to-gwpc-webhook-panel input{width:100%;border:1px solid #374151;border-radius:8px;background:#0b1220;color:#f9fafb;padding:7px 8px}
      #az-to-gwpc-webhook-panel textarea{width:100%;height:220px;border:1px solid #243041;border-radius:8px;background:#0b1220;color:#f9fafb;padding:8px;resize:vertical}
      #az-to-gwpc-webhook-panel .hb-active{padding:6px 8px;border-radius:8px;background:#0b1220;border:1px solid #243041;word-break:break-all}
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'az-to-gwpc-webhook-panel';
    panel.setAttribute('data-hb-script-id', SCRIPT_ID);
    panel.innerHTML = `
      <div class="hb-head">${SCRIPT_NAME} V${VERSION}</div>
      <div class="hb-body">
        <div class="hb-row">
          <button id="hb-toggle" class="hb-btn-red">STOP</button>
          <button id="hb-send" class="hb-btn-blue">SEND NOW</button>
          <button id="hb-test" class="hb-btn-orange">TEST SEND</button>
          <button id="hb-unpause" class="hb-btn-gray">UNPAUSE</button>
        </div>
        <div class="hb-field" style="margin-bottom:8px">
          <div class="hb-label">Paste your webhook here</div>
          <input id="hb-webhook-url" type="text" placeholder="https://...">
        </div>
        <div class="hb-field" style="margin-bottom:8px">
          <div class="hb-label">Agency Name</div>
          <input id="hb-agency-name" type="text" placeholder="Carlos Perez Agency">
        </div>
        <div class="hb-field" style="margin-bottom:8px">
          <div class="hb-label">Active webhook</div>
          <div id="hb-active-url" class="hb-active">(empty)</div>
        </div>
        <div id="hb-status" class="hb-status">Waiting for current job handoff</div>
        <div class="hb-row">
          <button id="hb-copy-logs" class="hb-btn-gray">COPY LOGS</button>
          <button id="hb-clear-logs" class="hb-btn-gray">CLEAR LOGS</button>
        </div>
        <textarea id="hb-logs" spellcheck="false" readonly></textarea>
      </div>
    `;
    document.documentElement.appendChild(panel);

    state.panel = panel;
    state.statusEl = panel.querySelector('#hb-status');
    state.logsEl = panel.querySelector('#hb-logs');
    state.webhookUrlEl = panel.querySelector('#hb-webhook-url');
    state.agencyNameEl = panel.querySelector('#hb-agency-name');
    state.activeUrlEl = panel.querySelector('#hb-active-url');
    state.toggleBtn = panel.querySelector('#hb-toggle');
    state.sendBtn = panel.querySelector('#hb-send');
    state.testBtn = panel.querySelector('#hb-test');
    state.unpauseBtn = panel.querySelector('#hb-unpause');
    state.copyLogsBtn = panel.querySelector('#hb-copy-logs');
    state.clearLogsBtn = panel.querySelector('#hb-clear-logs');

    panel.querySelector('.hb-head').addEventListener('mousedown', beginDrag, true);

    state.toggleBtn.addEventListener('click', () => {
      state.running = !state.running;
      if (state.running) sessionStorage.removeItem(CFG.stoppedKey);
      else sessionStorage.setItem(CFG.stoppedKey, '1');
      if (state.running) {
        clearSentMeta();
        clearFatalWebhookHold(readCurrentJob()?.['AZ ID'] || '');
      }
      renderButtons();
      writeActivityState(state.running ? 'idle' : 'stopped', state.running ? 'Running' : 'Stopped');
      setStatus(state.running ? 'Running' : 'Stopped');
      log(state.running ? 'Sender resumed' : 'Stopped for this page session');
      clearWaitLog();
      state.quoteSeenAt = 0;
    });

    state.sendBtn.addEventListener('click', () => {
      clearFatalWebhookHold(readCurrentJob()?.['AZ ID'] || '');
      requestForceSend('manual-send');
      state.running = true;
      sessionStorage.removeItem(CFG.stoppedKey);
      renderButtons();
      tick();
    });
    state.testBtn.addEventListener('click', sendTestWebhook);
    state.unpauseBtn.addEventListener('click', () => {
      const hadPause = isGloballyPaused() || hasForceSendRequest();
      clearForceSendRequest();
      clearWaitLog();
      state.quoteSeenAt = 0;
      renderButtons();
      writeActivityState(state.running ? 'idle' : 'stopped', state.running ? 'Running' : 'Stopped');
      setStatus(state.running ? 'Running' : 'Stopped');
      if (hadPause) log('Shared pause cleared manually');
      tick();
    });

    state.webhookUrlEl.addEventListener('input', () => { persistWebhookFromUi(false); });
    state.webhookUrlEl.addEventListener('change', () => { persistWebhookFromUi(true); });
    state.webhookUrlEl.addEventListener('blur', () => { persistWebhookFromUi(true); });
    state.webhookUrlEl.addEventListener('paste', () => {
      setTimeout(() => persistWebhookFromUi(true), 0);
    });
    state.webhookUrlEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        persistWebhookFromUi(true);
        try { state.webhookUrlEl.blur(); } catch {}
      }
    });

    state.agencyNameEl.addEventListener('input', () => { persistAgencyNameFromUi(false); });
    state.agencyNameEl.addEventListener('change', () => { persistAgencyNameFromUi(true); });
    state.agencyNameEl.addEventListener('blur', () => { persistAgencyNameFromUi(true); });
    state.agencyNameEl.addEventListener('paste', () => {
      setTimeout(() => persistAgencyNameFromUi(true), 0);
    });
    state.agencyNameEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        persistAgencyNameFromUi(true);
        try { state.agencyNameEl.blur(); } catch {}
      }
    });

    state.copyLogsBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(state.logLines.join('\n'));
        log('Logs copied');
      } catch {
        log('Copy logs failed');
      }
    });

    state.clearLogsBtn.addEventListener('click', clearLogs);

    restorePanelPos();
  }
})();
