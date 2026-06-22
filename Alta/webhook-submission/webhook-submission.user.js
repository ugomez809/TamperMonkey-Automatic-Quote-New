// ==UserScript==
// @name         Alta Webhook Submission
// @namespace    homebot.webhook-submission
// @version      0.1.1
// @description  HOME-only Alta sender. Waits for the Alta current job and final Home payload, then posts one webhook bundle and raises the Alta webhook success signal.
// @author       OpenAI
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @noframes
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
  try { window.__ALTA_WEBHOOK_SUBMISSION_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Alta Webhook Submission';
  const VERSION = '0.1.1';
  const SCRIPT_ID = 'webhook-submission';
  const LOG_KEY = 'tm_alta_webhook_submission_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const ACTIVITY_KEY = 'tm_ui_script_activity_v1';

  const KEYS = {
    currentJob: 'tm_alta_current_job_v1',
    sharedJob: 'tm_shared_az_job_v1',
    homePayload: 'tm_alta_home_quote_grab_payload_v1',
    webhookBundle: 'tm_alta_webhook_bundle_v1',
    finalPayload: 'tm_az_alta_final_payload_v1',
    finalReady: 'tm_az_alta_final_payload_ready_v1',
    forceSend: 'tm_alta_force_send_now_v1',
    flowStage: 'tm_alta_flow_stage_v1',
    fatalHold: 'tm_alta_webhook_fatal_error_hold_v1',
    webhookUrl: 'tm_alta_webhook_submit_url_v17',
    agencyName: 'tm_alta_webhook_submit_agency_name_v1',
    sentMeta: 'tm_alta_webhook_submit_sent_meta_v17',
    postSuccess: 'tm_alta_webhook_post_success_v1',
    stopped: 'tm_alta_webhook_submit_stopped_v17',
    panelPos: 'tm_alta_webhook_submit_panel_pos_v17'
  };

  const CFG = {
    tickMs: 900,
    requestTimeoutMs: 45000,
    maxSendAttempts: 3,
    maxLogLines: 140,
    panelWidth: 430,
    zIndex: 2147483647
  };

  const state = {
    running: true,
    busy: false,
    destroyed: false,
    tickTimer: 0,
    logsTimer: 0,
    panel: null,
    ui: {},
    logs: [],
    lastWaitKey: '',
    lastLogClearAt: '',
    drag: null
  };

  init();

  function init() {
    try { sessionStorage.removeItem(KEYS.stopped); } catch {}
    hydrateTextKey(KEYS.webhookUrl);
    hydrateTextKey(KEYS.agencyName);
    buildPanel();
    restorePanelPos();
    bindPanel();
    loadLogs();
    syncInputs();
    log(`Loaded v${VERSION}`);
    log(`Active webhook: ${getWebhookUrl() || '(empty)'}`);
    setStatus('Waiting for current job handoff');
    writeActivity('waiting', 'Waiting for current job handoff');

    state.tickTimer = window.setInterval(tick, CFG.tickMs);
    state.logsTimer = window.setInterval(logsTick, 2000);
    window.addEventListener('beforeunload', persistBeforeUnload, true);
    window.addEventListener('pagehide', persistBeforeUnload, true);
    window.addEventListener('resize', keepPanelInView, true);
    window.addEventListener('storage', handleStorage, true);
    document.addEventListener('visibilitychange', handleVisibility, true);
    tick();
    window.__ALTA_WEBHOOK_SUBMISSION_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { persistBeforeUnload(); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.logsTimer); } catch {}
    try { window.removeEventListener('beforeunload', persistBeforeUnload, true); } catch {}
    try { window.removeEventListener('pagehide', persistBeforeUnload, true); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { window.removeEventListener('storage', handleStorage, true); } catch {}
    try { document.removeEventListener('visibilitychange', handleVisibility, true); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_WEBHOOK_SUBMISSION_CLEANUP__; } catch {}
  }

  function tick() {
    if (state.destroyed) return;
    if (state.busy) {
      writeActivity('working', 'Sending webhook');
      return;
    }

    const force = readForceSend();
    if (!state.running && !force) {
      setStatus('Stopped');
      writeActivity('stopped', 'Stopped');
      return;
    }

    const job = readCurrentJob();
    const resolved = getEffectiveBundle(job);
    const bundle = resolved.bundle;

    if (!job['AZ ID']) {
      waitOnce(force ? 'force-wait-job' : 'wait-job', force ? 'Force send waiting for current job' : 'Waiting for current job handoff');
      return;
    }

    if (!bundle) {
      waitOnce(force ? 'force-wait-bundle' : 'wait-bundle', force ? 'Force send waiting for Alta payload' : 'Waiting for final Home payload');
      return;
    }

    const valid = validateJobAndBundle(job, bundle);
    if (!valid.ok) {
      waitOnce(`invalid-${valid.reason}`, valid.reason);
      return;
    }

    if (force) {
      setStatus('Force send ready');
      sendBundle(true, resolved.source).catch((err) => log(`Force send failed: ${err?.message || err}`));
      return;
    }

    if (!shouldSendNow(bundle)) {
      waitOnce('wait-gathered', 'Waiting for gathered data');
      return;
    }

    sendBundle(false, resolved.source).catch((err) => log(`Send failed: ${err?.message || err}`));
  }

  async function sendBundle(force = false, source = '') {
    if (state.busy) {
      log('Send skipped: already busy');
      return;
    }

    const endpoint = getCurrentWebhookUrl();
    if (!isValidHttpUrl(endpoint)) {
      setStatus('Webhook URL missing');
      log('Send blocked: webhook URL missing or invalid');
      return;
    }

    persistWebhookFromUi(false);
    persistAgencyNameFromUi(false);

    const job = readCurrentJob();
    const resolved = getEffectiveBundle(job);
    const bundle = resolved.bundle;
    const valid = validateJobAndBundle(job, bundle);
    if (!valid.ok) {
      setStatus(valid.reason);
      if (force) log(`Send blocked: ${valid.reason}`);
      return;
    }

    const signature = buildSignature(job, bundle);
    const endpointSignature = buildEndpointSignature(endpoint);
    if (!force && isSameBundleAlreadySent(job, bundle, signature, endpointSignature)) {
      setStatus('Already sent');
      log('Same bundle already sent to this webhook URL');
      return;
    }

    clearWait();
    state.busy = true;
    renderButtons();
    setStatus('Sending...');
    writeActivity('working', force ? 'Force sending webhook' : 'Sending webhook');
    log(`${force ? 'FORCE ' : ''}QUOTE POST ${endpoint}`);
    log(`Current Job AZ ID: ${job['AZ ID']}`);
    log(`Bundle source: ${source || resolved.source || 'unknown'}`);
    log(`Bundle sections -> home:${hasMeaningfulHome(bundle) ? 'yes' : 'no'} timeout:${hasPendingTimeout(bundle) ? 'yes' : 'no'}`);

    const requestBody = buildRequestBody(job, bundle, signature, false);
    let lastErr = null;

    for (let attempt = 1; attempt <= CFG.maxSendAttempts; attempt += 1) {
      try {
        log(`Send attempt ${attempt}/${CFG.maxSendAttempts}`);
        const response = await postJson(endpoint, requestBody, CFG.requestTimeoutMs);
        const raw = String(response?.responseText || '');
        const parsed = safeJsonParse(raw, null);

        if (Number(response?.status || 0) < 200 || Number(response?.status || 0) >= 400) {
          throw new Error(`HTTP ${response?.status || 'request failed'}${raw ? ` | ${raw.slice(0, 300)}` : ''}`);
        }
        if (parsed && parsed.ok === false) throw new Error(parsed.error || parsed.message || 'Receiver returned ok:false');

        clearFatalHold(job['AZ ID']);
        setSentMeta({ signature, endpointSignature, endpoint: normalizeEndpoint(endpoint), sentAt: nowIso(), azId: job['AZ ID'] });
        setPostSuccess(job, signature, endpointSignature);
        clearForceSend();
        writeFlowStage('home', 'done', job['AZ ID']);
        state.running = false;
        try { sessionStorage.setItem(KEYS.stopped, '1'); } catch {}
        log('Webhook send success');
        log('Stored Alta payloads retained after send');
        setStatus('Sent | Payload retained | Stopped');
        writeActivity('done', 'Sent | Payload retained | Stopped');
        state.busy = false;
        renderButtons();
        return;
      } catch (err) {
        lastErr = err;
        log(`Send attempt failed: ${err?.message || err}`);
      }
    }

    setStatus('Send failed');
    writeActivity('error', lastErr?.message || 'Send failed');
    state.busy = false;
    renderButtons();
  }

  async function sendTestWebhook() {
    if (state.busy) return;
    const endpoint = getCurrentWebhookUrl();
    if (!isValidHttpUrl(endpoint)) {
      setStatus('Webhook URL missing');
      log('Test blocked: webhook URL missing or invalid');
      return;
    }

    const job = readCurrentJob();
    const bundle = getEffectiveBundle(job).bundle || {
      'AZ ID': job['AZ ID'] || '',
      home: { ready: false, data: null },
      auto: { ready: false, data: null },
      timeout: { ready: false, events: [] },
      meta: { synthetic: true, builtAt: nowIso(), builtFrom: 'test-fallback' }
    };
    const body = buildRequestBody(job, bundle, `test_${Date.now()}`, true);

    state.busy = true;
    renderButtons();
    setStatus('Sending test...');
    log(`TEST POST ${endpoint}`);

    try {
      const response = await postJson(endpoint, body, CFG.requestTimeoutMs);
      const raw = String(response?.responseText || '');
      const parsed = safeJsonParse(raw, null);
      if (Number(response?.status || 0) < 200 || Number(response?.status || 0) >= 400) throw new Error(`HTTP ${response?.status || 'request failed'}${raw ? ` | ${raw.slice(0, 300)}` : ''}`);
      if (parsed && parsed.ok === false) throw new Error(parsed.error || parsed.message || 'Receiver returned ok:false');
      setStatus('Test sent');
      log('Test webhook success');
      log('Test send does not mark the quote bundle sent; use SEND NOW for the real bundle');
    } catch (err) {
      setStatus('Test failed');
      log(`Test failed: ${err?.message || err}`);
    } finally {
      state.busy = false;
      renderButtons();
    }
  }

  function getEffectiveBundle(job) {
    const azId = normalizeText(job?.['AZ ID'] || '');
    const rawBundle = readJson(KEYS.webhookBundle);
    if (isPlainObject(rawBundle) && normalizeText(rawBundle['AZ ID']) === azId && (hasMeaningfulHome(rawBundle) || hasPendingTimeout(rawBundle) || hasHomeError(rawBundle))) {
      return { bundle: normalizeHomeOnlyBundle(rawBundle), source: 'webhook-bundle' };
    }

    const finalPayload = readPreferredFinalPayload();
    if (isPlainObject(finalPayload) && normalizeText(finalPayload.azId) === azId && isPlainObject(finalPayload.bundle)) {
      return { bundle: normalizeHomeOnlyBundle(finalPayload.bundle), source: 'final-payload' };
    }

    const homePayload = readJson(KEYS.homePayload);
    const synthetic = buildHomeBundle(job, homePayload);
    if (synthetic) return { bundle: synthetic, source: 'home-payload' };

    return { bundle: null, source: '' };
  }

  function buildHomeBundle(job, homePayload) {
    if (!isPlainObject(homePayload) || homePayload.ready !== true) return null;
    const azId = extractPayloadAzId(homePayload);
    if (!azId || azId !== job['AZ ID']) return null;
    const row = isPlainObject(homePayload.row) ? homePayload.row : homePayload;
    return {
      'AZ ID': job['AZ ID'],
      Name: job.Name || row.Name || '',
      'Mailing Address': job['Mailing Address'] || row['Mailing Address'] || '',
      SubmissionNumber: job.SubmissionNumber || row['Submission Number'] || '',
      home: {
        ready: true,
        data: deepClone(row),
        sourcePayload: deepClone(homePayload),
        sourceKey: KEYS.homePayload
      },
      auto: { ready: false, data: null },
      timeout: { ready: false, events: [] },
      meta: { synthetic: true, builtFrom: KEYS.homePayload, builtAt: nowIso(), lastWriter: SCRIPT_NAME, version: VERSION }
    };
  }

  function readPreferredFinalPayload() {
    const local = readJson(KEYS.finalPayload);
    const gm = gmGetJson(KEYS.finalPayload);
    return chooseNewerPayload(local, gm, (value) => normalizeText(value?.azId || ''), getPayloadSavedMs);
  }

  function chooseNewerPayload(local, gm, getId, getMs) {
    const localOk = isPlainObject(local) && getId(local);
    const gmOk = isPlainObject(gm) && getId(gm);
    if (localOk && !gmOk) return local;
    if (!localOk && gmOk) return gm;
    if (!localOk && !gmOk) return null;
    const localMs = Number(getMs(local) || 0);
    const gmMs = Number(getMs(gm) || 0);
    if (localMs && gmMs && localMs !== gmMs) return localMs > gmMs ? local : gm;
    return local;
  }

  function normalizeHomeOnlyBundle(bundle) {
    const next = deepClone(bundle);
    next.auto = { ready: false, data: null };
    if (!isPlainObject(next.timeout)) next.timeout = { ready: false, events: [] };
    return next;
  }

  function validateJobAndBundle(job, bundle) {
    if (!job['AZ ID']) return { ok: false, reason: 'Waiting for tm_alta_current_job_v1 / AZ ID' };
    if (!isPlainObject(bundle)) return { ok: false, reason: 'Waiting for final Home payload' };
    if (normalizeText(bundle['AZ ID']) !== job['AZ ID']) return { ok: false, reason: 'Bundle AZ ID mismatch' };
    if (!(hasMeaningfulHome(bundle) || hasPendingTimeout(bundle) || hasHomeError(bundle))) return { ok: false, reason: 'Waiting for gathered data' };
    return { ok: true };
  }

  function shouldSendNow(bundle) {
    return hasMeaningfulHome(bundle) || hasPendingTimeout(bundle) || hasHomeError(bundle);
  }

  function hasMeaningfulHome(bundle) {
    return !!(bundle?.home?.ready && isPlainObject(bundle?.home?.data));
  }

  function hasPendingTimeout(bundle) {
    return !!(bundle?.timeout?.ready && Array.isArray(bundle.timeout.events) && bundle.timeout.events.length);
  }

  function hasHomeError(bundle) {
    if (hasSectionErrors(bundle?.home)) return true;
    return (Array.isArray(bundle?.timeout?.events) ? bundle.timeout.events : [])
      .some((event) => normalizeText(event?.product || '').toLowerCase() === 'home');
  }

  function hasSectionErrors(section) {
    if (!isPlainObject(section?.data)) return false;
    if (Array.isArray(section.data.errors) && section.data.errors.length) return true;
    return !!(isPlainObject(section.data.latestError) && normalizeText(section.data.latestError.errorType || section.data.latestError.errorName || section.data.latestError.errorText));
  }

  function buildRequestBody(job, bundle, signature, test = false) {
    return {
      'Agency Name': getAgencyName(),
      event: test ? 'az_to_alta_bundle_test' : 'az_to_alta_bundle',
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
        hasAuto: false,
        hasTimeout: hasPendingTimeout(bundle),
        hasHomeError: hasHomeError(bundle),
        hasAutoError: false,
        timeoutCount: Array.isArray(bundle?.timeout?.events) ? bundle.timeout.events.length : 0
      }
    };
  }

  function postJson(url, body, timeoutMs) {
    return new Promise((resolve, reject) => {
      const fallbackFetch = async () => {
        if (!isLoopbackUrl(url) || typeof fetch !== 'function') {
          reject(new Error('Network error'));
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(url, {
            method: 'POST',
            mode: 'cors',
            cache: 'no-store',
            credentials: 'omit',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify(body),
            signal: controller.signal
          });
          resolve({ status: response.status, responseText: await response.text() });
        } catch (err) {
          reject(new Error(`Network error; local fetch fallback failed: ${err?.message || err}`));
        } finally {
          clearTimeout(timer);
        }
      };

      if (typeof GM_xmlhttpRequest !== 'function') {
        fallbackFetch();
        return;
      }

      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': isLoopbackUrl(url) ? 'text/plain;charset=UTF-8' : 'application/json' },
        data: JSON.stringify(body),
        timeout: timeoutMs,
        onload: resolve,
        onerror: fallbackFetch,
        ontimeout: () => reject(new Error('Request timeout'))
      });
    });
  }

  function readCurrentJob() {
    let job = normalizeJob(readJson(KEYS.currentJob));
    if (job['AZ ID']) return job;
    job = normalizeJob(gmGetJson(KEYS.currentJob));
    if (job['AZ ID']) return job;
    job = normalizeJob(readJson(KEYS.sharedJob));
    return job;
  }

  function normalizeJob(raw) {
    const value = isPlainObject(raw) ? raw : {};
    const az = isPlainObject(value.az) ? value.az : {};
    const first = pickFirst(value['First Name'], value.firstName, az['First Name'], az['AZ Name']);
    const last = pickFirst(value['Last Name'], value.lastName, az['Last Name'], az['AZ Last']);
    const street = pickFirst(value['Street Address'], value.streetAddress, az['Street Address'], az['AZ Street Address']);
    const city = pickFirst(value.City, value.city, az.City, az['AZ City']);
    const stateValue = pickFirst(value.State, value.state, az.State, az['AZ State']);
    const zip = pickFirst(value.Zip, value.zip, value.zipCode, az.Zip, az['AZ Postal Code']);
    return {
      'AZ ID': pickFirst(value['AZ ID'], value.azId, value.ticketId, value.masterId, value.id, az['AZ ID']),
      Name: pickFirst(value.Name, value.name, `${first} ${last}`),
      'Mailing Address': pickFirst(value['Mailing Address'], value.mailingAddress, [street, city, stateValue, zip].filter(Boolean).join(' ')),
      SubmissionNumber: pickFirst(value.SubmissionNumber, value.submissionNumber, value['Submission Number']),
      updatedAt: pickFirst(value.updatedAt, value.savedAt, value?.meta?.savedAt),
      'First Name': first,
      'Last Name': last,
      Email: pickFirst(value.Email, value.email, az.Email, az['AZ Email']),
      Phone: pickFirst(value.Phone, value.phone, az.Phone, az['AZ Phone']),
      DOB: pickFirst(value.DOB, value.dob, az.DOB, az['AZ DOB']),
      'Street Address': street,
      City: city,
      State: stateValue,
      Zip: zip
    };
  }

  function setPostSuccess(job, signature, endpointSignature = '') {
    const payload = {
      ok: true,
      azId: normalizeText(job?.['AZ ID'] || ''),
      postedAt: nowIso(),
      signature: normalizeText(signature || ''),
      endpointSignature: normalizeText(endpointSignature || ''),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeJson(KEYS.postSuccess, payload);
    try { GM_setValue(KEYS.postSuccess, payload); } catch {}
    return payload;
  }

  function setSentMeta(meta) {
    writeJson(KEYS.sentMeta, meta);
    try { GM_setValue(KEYS.sentMeta, meta); } catch {}
  }

  function isSameBundleAlreadySent(job, bundle, signature, endpointSignature) {
    const sent = readJson(KEYS.sentMeta) || gmGetJson(KEYS.sentMeta);
    return normalizeText(sent?.azId || '') === normalizeText(job?.['AZ ID'] || '') &&
      normalizeText(sent?.signature || '') === normalizeText(signature || '') &&
      normalizeText(sent?.endpointSignature || '') === normalizeText(endpointSignature || '');
  }

  function buildSignature(job, bundle) {
    return hashString(JSON.stringify({
      'AZ ID': normalizeText(job['AZ ID'] || bundle?.['AZ ID'] || ''),
      SubmissionNumber: pickFirst(job.SubmissionNumber, bundle?.SubmissionNumber, bundle?.home?.submissionNumber),
      home: getHomeSignatureData(bundle),
      timeout: stableSignatureValue(Array.isArray(bundle?.timeout?.events) ? bundle.timeout.events : [])
    }));
  }

  function getHomeSignatureData(bundle) {
    const data = bundle?.home?.data;
    if (isPlainObject(data?.row)) return stableSignatureValue(data.row);
    return stableSignatureValue(data || null);
  }

  function stableSignatureValue(value) {
    if (Array.isArray(value)) return value.map(stableSignatureValue);
    if (!isPlainObject(value)) return value;
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (/^(updatedAt|savedAt|sentAt|postedAt|signalPostedAt|builtAt|sourcePayload|currentJob|page)$/i.test(key)) continue;
      out[key] = stableSignatureValue(value[key]);
    }
    return out;
  }

  function buildEndpointSignature(endpoint) {
    return hashString(normalizeEndpoint(endpoint));
  }

  function readForceSend() {
    const force = readJson(KEYS.forceSend) || gmGetJson(KEYS.forceSend);
    return isPlainObject(force) && normalizeText(force.requestedAt || '');
  }

  function requestForceSend(reason = 'manual-send') {
    const job = readCurrentJob();
    const request = {
      azId: normalizeText(job['AZ ID'] || ''),
      reason,
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeJson(KEYS.forceSend, request);
    try { GM_setValue(KEYS.forceSend, request); } catch {}
  }

  function clearForceSend() {
    try { localStorage.removeItem(KEYS.forceSend); } catch {}
    try { GM_setValue(KEYS.forceSend, null); } catch {}
  }

  function writeFlowStage(product, step, azId) {
    writeJson(KEYS.flowStage, { product, step, azId: normalizeText(azId), updatedAt: nowIso(), source: SCRIPT_NAME, version: VERSION });
  }

  function clearFatalHold(azId) {
    const current = readJson(KEYS.fatalHold) || gmGetJson(KEYS.fatalHold);
    if (current && normalizeText(current.azId || '') && normalizeText(current.azId || '') !== normalizeText(azId || '')) return;
    try { localStorage.removeItem(KEYS.fatalHold); } catch {}
    try { GM_setValue(KEYS.fatalHold, null); } catch {}
  }

  function waitOnce(key, message) {
    setStatus(message);
    writeActivity('waiting', message);
    if (state.lastWaitKey === key) return;
    state.lastWaitKey = key;
    log(message);
  }

  function clearWait() {
    state.lastWaitKey = '';
  }

  function getWebhookUrl() {
    return pickFirst(gmGetText(KEYS.webhookUrl), safeGet(KEYS.webhookUrl));
  }

  function getCurrentWebhookUrl() {
    return normalizeText(state.ui.webhookUrl?.value || '') || getWebhookUrl();
  }

  function getAgencyName() {
    return pickFirst(gmGetText(KEYS.agencyName), safeGet(KEYS.agencyName));
  }

  function hydrateTextKey(key) {
    const resolved = pickFirst(gmGetText(key), safeGet(key));
    if (resolved) mirrorTextKey(key, resolved);
  }

  function mirrorTextKey(key, value) {
    const text = normalizeText(value);
    try { localStorage.setItem(key, text); } catch {}
    try { sessionStorage.setItem(key, text); } catch {}
    try { GM_setValue(key, text); } catch {}
    return text;
  }

  function persistWebhookFromUi(withLog) {
    const before = getWebhookUrl();
    const saved = mirrorTextKey(KEYS.webhookUrl, state.ui.webhookUrl?.value || '');
    updateActiveUrl(saved);
    if (withLog && saved !== before) log(saved ? `Webhook URL saved: ${truncateMiddle(saved, 110)}` : 'Webhook URL cleared');
  }

  function persistAgencyNameFromUi(withLog) {
    const before = getAgencyName();
    const saved = mirrorTextKey(KEYS.agencyName, state.ui.agencyName?.value || '');
    if (withLog && saved !== before) log(saved ? 'Agency Name saved' : 'Agency Name cleared');
  }

  function persistBeforeUnload() {
    persistWebhookFromUi(false);
    persistAgencyNameFromUi(false);
    persistPanelPos();
  }

  function handleVisibility() {
    if (document.visibilityState === 'hidden') persistBeforeUnload();
  }

  function syncInputs() {
    if (state.ui.webhookUrl) state.ui.webhookUrl.value = getWebhookUrl();
    if (state.ui.agencyName) state.ui.agencyName.value = getAgencyName();
    updateActiveUrl(getWebhookUrl());
  }

  function writeActivity(status, message) {
    const map = readJson(ACTIVITY_KEY) || {};
    const job = readCurrentJob();
    map[SCRIPT_ID] = {
      scriptId: SCRIPT_ID,
      scriptName: SCRIPT_NAME,
      state: normalizeText(status).toLowerCase() || 'idle',
      message: normalizeText(message || ''),
      azId: normalizeText(job['AZ ID'] || ''),
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeJson(ACTIVITY_KEY, map);
  }

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = `
      #alta-webhook-panel{position:fixed;right:12px;bottom:12px;width:${CFG.panelWidth}px;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;box-shadow:0 10px 28px rgba(0,0,0,.35);z-index:${CFG.zIndex};font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #alta-webhook-panel *{box-sizing:border-box}
      #alta-webhook-panel .hb-head{padding:10px 12px;background:#0f172a;border-bottom:1px solid #374151;cursor:move;font-weight:700}
      #alta-webhook-panel .hb-body{padding:10px 12px}
      #alta-webhook-panel .hb-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
      #alta-webhook-panel button,#alta-webhook-panel input,#alta-webhook-panel textarea{font:12px Arial,sans-serif}
      #alta-webhook-panel button{border:0;border-radius:6px;padding:7px 10px;font-weight:700;cursor:pointer;color:#fff}
      #alta-webhook-panel input{width:100%;border:1px solid #374151;border-radius:6px;background:#0b1220;color:#f9fafb;padding:7px 8px}
      #alta-webhook-panel textarea{width:100%;height:210px;border:1px solid #243041;border-radius:6px;background:#0b1220;color:#f9fafb;padding:8px;resize:vertical}
      #alta-webhook-panel .hb-status{margin-bottom:8px;padding:6px 8px;border-radius:6px;background:#1f2937;word-break:break-word}
      #alta-webhook-panel .hb-label{opacity:.85;font-size:11px;margin-bottom:4px}
      #alta-webhook-panel .hb-active{padding:6px 8px;border-radius:6px;background:#0b1220;border:1px solid #243041;word-break:break-all}
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'alta-webhook-panel';
    panel.setAttribute('data-hb-script-id', SCRIPT_ID);
    panel.innerHTML = `
      <div class="hb-head">${SCRIPT_NAME} v${VERSION}</div>
      <div class="hb-body">
        <div class="hb-row">
          <button data-toggle style="background:#dc2626">STOP</button>
          <button data-send style="background:#2563eb">SEND NOW</button>
          <button data-test style="background:#d97706">TEST SEND</button>
          <button data-unpause style="background:#4b5563">UNPAUSE</button>
        </div>
        <div style="margin-bottom:8px"><div class="hb-label">Paste your webhook here</div><input data-webhook type="text" placeholder="https://..."></div>
        <div style="margin-bottom:8px"><div class="hb-label">Agency Name</div><input data-agency type="text" placeholder="Carlos Perez Agency"></div>
        <div style="margin-bottom:8px"><div class="hb-label">Active webhook</div><div data-active-url class="hb-active">(empty)</div></div>
        <div data-status class="hb-status">Waiting for current job handoff</div>
        <div class="hb-row">
          <button data-copy style="background:#4b5563">COPY LOGS</button>
          <button data-clear style="background:#4b5563">CLEAR LOGS</button>
        </div>
        <textarea data-logs spellcheck="false" readonly></textarea>
      </div>
    `;
    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('.hb-head');
    state.ui.toggle = panel.querySelector('[data-toggle]');
    state.ui.send = panel.querySelector('[data-send]');
    state.ui.test = panel.querySelector('[data-test]');
    state.ui.unpause = panel.querySelector('[data-unpause]');
    state.ui.webhookUrl = panel.querySelector('[data-webhook]');
    state.ui.agencyName = panel.querySelector('[data-agency]');
    state.ui.activeUrl = panel.querySelector('[data-active-url]');
    state.ui.status = panel.querySelector('[data-status]');
    state.ui.copy = panel.querySelector('[data-copy]');
    state.ui.clear = panel.querySelector('[data-clear]');
    state.ui.logs = panel.querySelector('[data-logs]');
  }

  function bindPanel() {
    state.ui.head?.addEventListener('mousedown', beginDrag, true);
    state.ui.toggle?.addEventListener('click', () => {
      state.running = !state.running;
      if (state.running) {
        try { sessionStorage.removeItem(KEYS.stopped); } catch {}
        clearFatalHold(readCurrentJob()['AZ ID']);
        log('Sender resumed');
      } else {
        try { sessionStorage.setItem(KEYS.stopped, '1'); } catch {}
        log('Stopped for this page session');
      }
      setStatus(state.running ? 'Running' : 'Stopped');
      writeActivity(state.running ? 'idle' : 'stopped', state.running ? 'Running' : 'Stopped');
      clearWait();
      renderButtons();
      tick();
    });
    state.ui.send?.addEventListener('click', () => { requestForceSend('manual-send'); state.running = true; renderButtons(); tick(); });
    state.ui.test?.addEventListener('click', sendTestWebhook);
    state.ui.unpause?.addEventListener('click', () => { clearForceSend(); clearWait(); setStatus(state.running ? 'Running' : 'Stopped'); log('Shared force-send request cleared manually'); tick(); });
    state.ui.webhookUrl?.addEventListener('input', () => persistWebhookFromUi(false));
    state.ui.webhookUrl?.addEventListener('change', () => persistWebhookFromUi(true));
    state.ui.webhookUrl?.addEventListener('blur', () => persistWebhookFromUi(true));
    state.ui.agencyName?.addEventListener('input', () => persistAgencyNameFromUi(false));
    state.ui.agencyName?.addEventListener('change', () => persistAgencyNameFromUi(true));
    state.ui.agencyName?.addEventListener('blur', () => persistAgencyNameFromUi(true));
    state.ui.copy?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.logs.join('\n')); log('Logs copied'); }
      catch { log('Copy logs failed'); }
    });
    state.ui.clear?.addEventListener('click', () => { state.logs = []; renderLogs(); persistLogs(); });
  }

  function renderButtons() {
    if (state.ui.toggle) {
      state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
      state.ui.toggle.style.background = state.running ? '#dc2626' : '#16a34a';
    }
    if (state.ui.send) state.ui.send.disabled = state.busy;
    if (state.ui.test) state.ui.test.disabled = state.busy;
  }

  function setStatus(message) {
    if (state.ui.status) state.ui.status.textContent = message;
  }

  function updateActiveUrl(url) {
    if (!state.ui.activeUrl) return;
    const text = normalizeText(url);
    state.ui.activeUrl.textContent = text ? truncateMiddle(text, 110) : '(empty)';
    state.ui.activeUrl.title = text;
  }

  function loadLogs() {
    const saved = readJson(LOG_KEY);
    if (Array.isArray(saved?.lines)) state.logs = saved.lines.slice(0, CFG.maxLogLines);
    renderLogs();
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    renderLogs();
    persistLogs();
    console.info(`[${SCRIPT_NAME}] ${message}`);
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
    const req = readJson(LOG_CLEAR_SIGNAL_KEY) || gmGetJson(LOG_CLEAR_SIGNAL_KEY);
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

  function beginDrag(event) {
    if (!state.panel || event.target.closest('button, input, textarea')) return;
    const rect = state.panel.getBoundingClientRect();
    state.drag = { startX: event.clientX, startY: event.clientY, startLeft: rect.left, startTop: rect.top };
    event.preventDefault();
    window.addEventListener('mousemove', dragMove, true);
    window.addEventListener('mouseup', endDrag, true);
  }

  function dragMove(event) {
    if (!state.drag || !state.panel) return;
    const left = Math.max(0, Math.min(window.innerWidth - state.panel.offsetWidth, state.drag.startLeft + event.clientX - state.drag.startX));
    const top = Math.max(0, Math.min(window.innerHeight - state.panel.offsetHeight, state.drag.startTop + event.clientY - state.drag.startY));
    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
  }

  function endDrag() {
    state.drag = null;
    window.removeEventListener('mousemove', dragMove, true);
    window.removeEventListener('mouseup', endDrag, true);
    persistPanelPos();
  }

  function keepPanelInView() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    const left = Math.max(0, Math.min(window.innerWidth - rect.width - 8, rect.left));
    const top = Math.max(0, Math.min(window.innerHeight - rect.height - 8, rect.top));
    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    persistPanelPos();
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

  function isValidHttpUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function isLoopbackUrl(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
    } catch {
      return false;
    }
  }

  function normalizeEndpoint(url) {
    const text = normalizeText(url);
    try {
      const parsed = new URL(text);
      parsed.hash = '';
      return parsed.href.replace(/\/$/, '');
    } catch {
      return text;
    }
  }

  function extractPayloadAzId(value) {
    if (!isPlainObject(value)) return '';
    return normalizeText(value['AZ ID'] || value.azId || value.ticketId || value.currentJob?.['AZ ID'] || value.row?.['AZ ID'] || '');
  }

  function getPayloadSavedMs(value) {
    const candidates = [value?.savedAt, value?.signalPostedAt, value?.meta?.updatedAt, value?.currentJob?.updatedAt];
    let best = 0;
    for (const candidate of candidates) {
      const ms = Date.parse(normalizeText(candidate || ''));
      if (Number.isFinite(ms) && ms > best) best = ms;
    }
    return best;
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

  function truncateMiddle(text, max) {
    const value = String(text || '');
    if (value.length <= max) return value;
    const part = Math.max(12, Math.floor((max - 3) / 2));
    return `${value.slice(0, part)}...${value.slice(-part)}`;
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return value; }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function pickFirst(...values) {
    for (const value of values) {
      const text = normalizeText(value);
      if (text) return text;
    }
    return '';
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

  function gmGetJson(key) {
    try { return safeJsonParse(GM_getValue(key, null), null); }
    catch { return null; }
  }

  function gmGetText(key) {
    try { return normalizeText(GM_getValue(key, '')); }
    catch { return ''; }
  }

  function safeGet(key) {
    try { return normalizeText(localStorage.getItem(key) || ''); }
    catch { return ''; }
  }
})();
