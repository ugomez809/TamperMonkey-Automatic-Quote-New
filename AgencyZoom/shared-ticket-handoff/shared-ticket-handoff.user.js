// ==UserScript==
// @name         Alta Shared Ticket Handoff
// @namespace    homebot.shared-ticket-handoff
// @version      0.1.0
// @description  Shared AZ -> Alta Ticket ID handoff. Captures the AgencyZoom payload and seeds Alta current job, Home payload, and webhook bundle state.
// @author       OpenAI
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/shared-ticket-handoff/shared-ticket-handoff.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/shared-ticket-handoff/shared-ticket-handoff.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__ALTA_SHARED_TICKET_HANDOFF_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Alta Shared Ticket Handoff';
  const VERSION = '0.1.0';
  const SCRIPT_ID = 'shared-ticket-handoff';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const ACTIVITY_KEY = 'tm_ui_script_activity_v1';

  const LOG_KEY = isAzHost()
    ? 'tm_az_shared_ticket_handoff_logs_v1'
    : 'tm_alta_shared_ticket_handoff_logs_v1';

  const GM_KEYS = {
    handoff: 'hb_shared_az_to_alta_ticket_handoff_v1'
  };

  const KEYS = {
    azPayload: 'tm_az_payload_v1',
    azCurrentJob: 'tm_az_current_job_v1',
    altaCurrentJob: 'tm_alta_current_job_v1',
    sharedJob: 'tm_shared_az_job_v1',
    homePayload: 'tm_alta_home_quote_grab_payload_v1',
    webhookBundle: 'tm_alta_webhook_bundle_v1',
    flowStage: 'tm_alta_flow_stage_v1',
    lastApplied: 'hb_shared_az_to_alta_ticket_handoff_last_applied_v1',
    panelPos: 'hb_shared_az_to_alta_ticket_handoff_panel_pos_v1'
  };

  const CFG = {
    tickMs: 1000,
    handoffMaxAgeMs: 6 * 60 * 60 * 1000,
    maxLogs: 28,
    zIndex: 2147483647
  };

  const state = {
    running: true,
    busy: false,
    logs: [],
    panel: null,
    ui: {},
    tickTimer: 0,
    lastAzSignature: '',
    lastIdleKey: '',
    lastLogClearAt: ''
  };

  init();

  function init() {
    buildPanel();
    restorePanelPos();
    bindPanel();
    loadLogs();
    log(`Loaded v${VERSION}`);
    log(isAzHost() ? 'Mode: AgencyZoom capture' : isAltaHost() ? 'Mode: Alta apply' : 'Mode: idle');
    state.tickTimer = window.setInterval(tick, CFG.tickMs);
    window.addEventListener('storage', handleStorage, true);
    window.addEventListener('beforeunload', persistPanelPos, true);
    window.addEventListener('pagehide', persistPanelPos, true);
    tick();
    window.__ALTA_SHARED_TICKET_HANDOFF_CLEANUP__ = cleanup;
  }

  function cleanup() {
    try { clearInterval(state.tickTimer); } catch {}
    try { window.removeEventListener('storage', handleStorage, true); } catch {}
    try { window.removeEventListener('beforeunload', persistPanelPos, true); } catch {}
    try { window.removeEventListener('pagehide', persistPanelPos, true); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_SHARED_TICKET_HANDOFF_CLEANUP__; } catch {}
  }

  function tick() {
    if (!state.running || state.busy) {
      writeActivity(state.running ? 'idle' : 'stopped', state.running ? 'Running' : 'Stopped');
      return;
    }

    state.busy = true;
    try {
      if (isAzHost()) captureAzPayload();
      else if (isAltaHost()) applyAltaHandoff();
      else setIdle('unsupported', 'Unsupported origin');
    } catch (err) {
      log(`Error: ${err?.message || err}`);
      setStatus('Error');
      writeActivity('error', err?.message || 'Error');
    } finally {
      state.busy = false;
      renderStatus();
    }
  }

  function captureAzPayload() {
    const payload = readJson(KEYS.azPayload);
    if (!isPlainObject(payload)) {
      setIdle('az-wait-payload', 'AZ waiting for tm_az_payload_v1');
      return;
    }

    const job = normalizeJob(payload);
    if (!job['AZ ID']) {
      setIdle('az-wait-ticket', 'AZ payload missing Ticket ID');
      return;
    }

    const handoff = {
      ticketId: job['AZ ID'],
      azId: job['AZ ID'],
      name: job.Name,
      mailingAddress: job['Mailing Address'],
      firstName: job['First Name'],
      lastName: job['Last Name'],
      email: job.Email,
      phone: job.Phone,
      dob: job.DOB,
      streetAddress: job['Street Address'],
      city: job.City,
      state: job.State,
      zip: job.Zip,
      savedAt: pickFirst(payload?.meta?.savedAt, payload?.savedAt, job.updatedAt, nowIso()),
      source: {
        script: SCRIPT_NAME,
        version: VERSION,
        origin: location.origin,
        href: location.href
      },
      rawAzPayload: payload
    };

    const signature = stableStringify(handoff);
    if (signature === state.lastAzSignature) {
      setIdle(`az-ready-${handoff.ticketId}`, `AZ handoff ready ${handoff.ticketId}`);
      return;
    }

    GM_setValue(GM_KEYS.handoff, handoff);
    writeJson(KEYS.azCurrentJob, job);
    state.lastAzSignature = signature;
    log(`AZ handoff saved | Ticket ID ${handoff.ticketId}`);
    if (handoff.name) log(`AZ Name: ${handoff.name}`);
    if (handoff.mailingAddress) log(`AZ Address: ${handoff.mailingAddress}`);
    setStatus(`AZ saved ${handoff.ticketId}`);
    writeActivity('idle', `AZ saved ${handoff.ticketId}`);
  }

  function applyAltaHandoff() {
    const handoff = readHandoff();
    if (!handoff) {
      setIdle('alta-wait-handoff', 'Alta waiting for AZ handoff');
      return;
    }

    const ageMs = Date.now() - toMs(handoff.savedAt);
    if (!Number.isFinite(ageMs) || ageMs > CFG.handoffMaxAgeMs) {
      setIdle('alta-stale-handoff', 'Alta waiting for fresh AZ handoff');
      return;
    }

    const seedJob = normalizeJob({
      'AZ ID': handoff.ticketId || handoff.azId,
      Name: handoff.name,
      'Mailing Address': handoff.mailingAddress,
      'First Name': handoff.firstName,
      'Last Name': handoff.lastName,
      Email: handoff.email,
      Phone: handoff.phone,
      DOB: handoff.dob,
      'Street Address': handoff.streetAddress,
      City: handoff.city,
      State: handoff.state,
      Zip: handoff.zip,
      updatedAt: nowIso()
    });

    if (!seedJob['AZ ID']) {
      setIdle('alta-handoff-missing-id', 'Alta handoff missing AZ ID');
      return;
    }

    const currentJob = normalizeJob(readJson(KEYS.altaCurrentJob));
    const sameAz = currentJob['AZ ID'] && currentJob['AZ ID'] === seedJob['AZ ID'];
    const nextJob = {
      ...seedJob,
      Name: sameAz ? pickFirst(currentJob.Name, seedJob.Name) : seedJob.Name,
      'Mailing Address': sameAz ? pickFirst(currentJob['Mailing Address'], seedJob['Mailing Address']) : seedJob['Mailing Address'],
      SubmissionNumber: sameAz ? pickFirst(currentJob.SubmissionNumber, seedJob.SubmissionNumber) : pickFirst(seedJob.SubmissionNumber, ''),
      updatedAt: nowIso()
    };

    const applySignature = [
      nextJob['AZ ID'],
      normalizeCompare(nextJob.Name),
      normalizeCompare(nextJob['Mailing Address']),
      nextJob.SubmissionNumber
    ].join('|');

    const lastApplied = safeGet(KEYS.lastApplied);
    writeJson(KEYS.altaCurrentJob, nextJob);
    writeJson(KEYS.sharedJob, {
      ticketId: nextJob['AZ ID'],
      mode: 'home',
      az: normalizeAzFields(nextJob),
      altaHome: null,
      altaAuto: null,
      meta: {
        createdAt: handoff.savedAt || nowIso(),
        lastUpdatedAt: nowIso(),
        source: SCRIPT_NAME,
        url: location.href
      }
    });
    try { GM_setValue(KEYS.altaCurrentJob, nextJob); } catch {}

    ensureSeedPayload(nextJob);
    ensureSeedBundle(nextJob);
    maybeAdvanceFlow(nextJob);

    if (lastApplied !== applySignature) {
      safeSet(KEYS.lastApplied, applySignature);
      log(`Alta current job written | AZ ID ${nextJob['AZ ID']}`);
      if (nextJob.Name) log(`Alta Name: ${nextJob.Name}`);
      if (nextJob['Mailing Address']) log(`Alta Address: ${nextJob['Mailing Address']}`);
    }

    setStatus(`Alta linked ${nextJob['AZ ID']}`);
    writeActivity('idle', `Alta linked ${nextJob['AZ ID']}`);
  }

  function ensureSeedPayload(job) {
    const current = readJson(KEYS.homePayload);
    const currentAzId = extractAzId(current);
    if (currentAzId === job['AZ ID']) return current;

    const now = nowIso();
    const next = {
      script: SCRIPT_NAME,
      version: VERSION,
      event: 'home_payload_seeded',
      product: 'home',
      ready: false,
      'AZ ID': job['AZ ID'],
      currentJob: { ...job },
      savedAt: now,
      page: { url: location.href, title: document.title },
      flow: 'handoff',
      meta: {
        product: 'home',
        phase: 'seeded',
        source: SCRIPT_NAME,
        updatedAt: now
      },
      row: defaultHomeRow(job)
    };

    writeJson(KEYS.homePayload, next);
    return next;
  }

  function ensureSeedBundle(job) {
    const current = readJson(KEYS.webhookBundle);
    if (isPlainObject(current) && normalizeText(current['AZ ID']) === job['AZ ID']) {
      const next = {
        ...current,
        'Name': pickFirst(current.Name, job.Name),
        'Mailing Address': pickFirst(current['Mailing Address'], job['Mailing Address']),
        SubmissionNumber: pickFirst(current.SubmissionNumber, job.SubmissionNumber),
        home: isPlainObject(current.home) ? current.home : { ready: false, data: null },
        auto: { ready: false, data: null },
        timeout: isPlainObject(current.timeout) ? current.timeout : { ready: false, events: [] },
        meta: {
          ...(isPlainObject(current.meta) ? current.meta : {}),
          updatedAt: nowIso(),
          lastWriter: SCRIPT_NAME,
          version: VERSION
        }
      };
      writeJson(KEYS.webhookBundle, next);
      return next;
    }

    const now = nowIso();
    const bundle = {
      'AZ ID': job['AZ ID'],
      Name: job.Name,
      'Mailing Address': job['Mailing Address'],
      SubmissionNumber: job.SubmissionNumber || '',
      home: {
        ready: false,
        data: null,
        meta: { product: 'home', step: 'seeded', savedAt: now, source: SCRIPT_NAME, version: VERSION }
      },
      auto: { ready: false, data: null },
      timeout: { ready: false, events: [] },
      meta: {
        updatedAt: now,
        lastWriter: SCRIPT_NAME,
        version: VERSION,
        stage: 'entry_seeded',
        stageWriter: SCRIPT_NAME
      }
    };
    writeJson(KEYS.webhookBundle, bundle);
    return bundle;
  }

  function maybeAdvanceFlow(job) {
    const azId = job['AZ ID'];
    if (!azId) return;
    const home = readJson(KEYS.homePayload);
    if (extractAzId(home) === azId && home?.ready === true) {
      writeJson(KEYS.flowStage, { product: 'home', step: 'sender', azId, updatedAt: nowIso(), source: SCRIPT_NAME, version: VERSION });
      return;
    }
    const stage = readJson(KEYS.flowStage);
    if (!isPlainObject(stage) || !stage.product || normalizeText(stage.azId) !== azId) {
      writeJson(KEYS.flowStage, { product: 'home', step: 'handoff', azId, updatedAt: nowIso(), source: SCRIPT_NAME, version: VERSION });
    }
  }

  function readHandoff() {
    const gm = gmGetJson(GM_KEYS.handoff);
    if (isPlainObject(gm)) return gm;
    const local = readJson(GM_KEYS.handoff);
    return isPlainObject(local) ? local : null;
  }

  function normalizeJob(raw) {
    const value = isPlainObject(raw) ? raw : {};
    const az = isPlainObject(value.az) ? value.az : {};
    const first = pickFirst(value['First Name'], value.firstName, az['First Name'], az['AZ Name'], value['AZ Name']);
    const last = pickFirst(value['Last Name'], value.lastName, az['Last Name'], az['AZ Last'], value['AZ Last']);
    const street = pickFirst(value['Street Address'], value.streetAddress, az['Street Address'], az['AZ Street Address'], value['AZ Street Address']);
    const city = pickFirst(value.City, value.city, az.City, az['AZ City'], value['AZ City']);
    const stateValue = pickFirst(value.State, value.state, az.State, az['AZ State'], value['AZ State']);
    const zip = pickFirst(value.Zip, value.zip, value.zipCode, az.Zip, az['AZ Postal Code'], value['AZ Postal Code']);
    const name = pickFirst(value.Name, value.name, `${first} ${last}`);
    const mailingAddress = pickFirst(value['Mailing Address'], value.mailingAddress, buildMailingAddress({ street, city, state: stateValue, zip }));

    return removeEmpty({
      'AZ ID': pickFirst(value['AZ ID'], value.azId, value.ticketId, value.masterId, value.id, az['AZ ID']),
      Name: name,
      'Mailing Address': mailingAddress,
      SubmissionNumber: pickFirst(value.SubmissionNumber, value.submissionNumber, value['Submission Number']),
      updatedAt: pickFirst(value.updatedAt, value.savedAt, value?.meta?.savedAt, nowIso()),
      'First Name': first,
      'Last Name': last,
      Email: pickFirst(value.Email, value.email, az.Email, az['AZ Email']),
      Phone: pickFirst(value.Phone, value.phone, az.Phone, az['AZ Phone']),
      DOB: pickFirst(value.DOB, value.dob, value['Date of Birth'], az.DOB, az['AZ DOB']),
      'Street Address': street,
      City: city,
      State: stateValue,
      Zip: zip
    });
  }

  function normalizeAzFields(job) {
    return {
      'AZ ID': job['AZ ID'] || '',
      'AZ Name': job['First Name'] || '',
      'AZ Last': job['Last Name'] || '',
      'AZ DOB': job.DOB || '',
      'AZ Phone': job.Phone || '',
      'AZ Email': job.Email || '',
      'AZ Street Address': job['Street Address'] || '',
      'AZ City': job.City || '',
      'AZ State': job.State || '',
      'AZ Postal Code': job.Zip || '',
      'First Name': job['First Name'] || '',
      'Last Name': job['Last Name'] || '',
      Email: job.Email || '',
      Phone: job.Phone || '',
      DOB: job.DOB || '',
      'Street Address': job['Street Address'] || '',
      City: job.City || '',
      State: job.State || '',
      Zip: job.Zip || ''
    };
  }

  function defaultHomeRow(job) {
    return {
      Name: job.Name || '',
      'Mailing Address': job['Mailing Address'] || '',
      'Risk Address': '',
      'Account Number': '',
      'Fire Code': '',
      'Protection Class': '',
      'CFP?': '',
      'Reconstruction Cost': '',
      'Year Built': '',
      'Square FT': '',
      '# of Story': '',
      'Home Roof Type': '',
      Bedrooms: '',
      Bathrooms: '',
      'Home Type': '',
      'Water Device?': '',
      'Standard Pricing No Auto Discount': '',
      'Enhance Pricing No Auto Discount': '',
      'Standard Pricing Auto Discount': '',
      'Enhance Pricing Auto Discount': '',
      'Submission Number': job.SubmissionNumber || '',
      'Auto Discount': '',
      'Date Processed?': '',
      'Done?': '',
      Result: ''
    };
  }

  function buildMailingAddress({ street, city, state, zip }) {
    const cityState = [city, state].map(normalizeText).filter(Boolean).join(', ');
    const tail = [cityState, zip].map(normalizeText).filter(Boolean).join(' ');
    return [street, tail].map(normalizeText).filter(Boolean).join(', ');
  }

  function extractAzId(value) {
    if (!isPlainObject(value)) return '';
    return normalizeText(value['AZ ID'] || value.azId || value.ticketId || value.currentJob?.['AZ ID'] || value.row?.['AZ ID'] || '');
  }

  function setIdle(key, message) {
    if (state.lastIdleKey === key) return;
    state.lastIdleKey = key;
    setStatus(message);
    writeActivity('waiting', message);
    log(message);
  }

  function readActivityMap() {
    return readJson(ACTIVITY_KEY) || {};
  }

  function writeActivity(status, message) {
    const map = readActivityMap();
    map[SCRIPT_ID] = {
      scriptId: SCRIPT_ID,
      scriptName: SCRIPT_NAME,
      state: normalizeText(status).toLowerCase() || 'idle',
      message: normalizeText(message || state.ui.status?.textContent || ''),
      azId: getActivityAzId(),
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeJson(ACTIVITY_KEY, map);
  }

  function getActivityAzId() {
    if (isAltaHost()) return normalizeText(readJson(KEYS.altaCurrentJob)?.['AZ ID'] || '');
    const handoff = readHandoff();
    return normalizeText(handoff?.ticketId || handoff?.azId || '');
  }

  function handleStorage(event) {
    if (event?.key !== LOG_CLEAR_SIGNAL_KEY) return;
    const req = safeJsonParse(event.newValue, null);
    const at = normalizeText(req?.requestedAt || '');
    if (!at || at === state.lastLogClearAt) return;
    state.lastLogClearAt = at;
    state.logs = [];
    persistLogs();
    renderLogs();
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogs);
    persistLogs();
    renderLogs();
    console.info(`[${SCRIPT_NAME}] ${message}`);
  }

  function loadLogs() {
    const saved = readJson(LOG_KEY);
    if (Array.isArray(saved?.lines)) state.logs = saved.lines.slice(0, CFG.maxLogs);
    renderLogs();
  }

  function persistLogs() {
    writeJson(LOG_KEY, { script: SCRIPT_NAME, version: VERSION, origin: location.origin, updatedAt: nowIso(), lines: state.logs });
    try { GM_setValue(LOG_KEY, { script: SCRIPT_NAME, version: VERSION, origin: location.origin, updatedAt: nowIso(), lines: state.logs }); } catch {}
  }

  function setStatus(message) {
    if (state.ui.status) state.ui.status.textContent = message;
  }

  function renderStatus() {
    const handoff = readHandoff();
    const azId = isAltaHost()
      ? normalizeText(readJson(KEYS.altaCurrentJob)?.['AZ ID'] || handoff?.ticketId || '')
      : normalizeText(handoff?.ticketId || '');
    if (state.ui.azId) state.ui.azId.textContent = azId || '-';
    if (state.ui.mode) state.ui.mode.textContent = isAzHost() ? 'AZ capture' : isAltaHost() ? 'Alta apply' : 'Idle';
  }

  function renderLogs() {
    if (state.ui.logs) state.ui.logs.textContent = state.logs.join('\n');
    renderStatus();
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'hb-shared-az-alta-panel';
    panel.setAttribute('data-hb-script-id', SCRIPT_ID);
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: '340px',
      zIndex: String(CFG.zIndex),
      background: 'rgba(17,24,39,.96)',
      color: '#f9fafb',
      border: '1px solid rgba(255,255,255,.12)',
      borderRadius: '8px',
      boxShadow: '0 10px 28px rgba(0,0,0,.35)',
      font: '12px/1.35 Arial,sans-serif',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div data-head style="padding:8px 10px;background:rgba(255,255,255,.06);cursor:move;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <strong>${SCRIPT_NAME}</strong><span style="opacity:.75;">v${VERSION}</span>
      </div>
      <div style="padding:10px;">
        <div data-status style="font-weight:700;color:#93c5fd;margin-bottom:8px;">Starting</div>
        <div style="display:grid;grid-template-columns:70px 1fr;gap:4px 8px;margin-bottom:8px;">
          <span style="opacity:.75;">Mode</span><span data-mode>-</span>
          <span style="opacity:.75;">AZ ID</span><span data-azid>-</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <button data-toggle type="button" style="border:0;border-radius:6px;padding:7px 9px;background:#b91c1c;color:#fff;font-weight:700;cursor:pointer;">STOP</button>
          <button data-copy type="button" style="border:0;border-radius:6px;padding:7px 9px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;">COPY LOGS</button>
        </div>
        <div data-logs style="max-height:170px;overflow:auto;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:7px;white-space:pre-wrap;word-break:break-word;font-family:Consolas,monospace;font-size:11px;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('[data-head]');
    state.ui.status = panel.querySelector('[data-status]');
    state.ui.mode = panel.querySelector('[data-mode]');
    state.ui.azId = panel.querySelector('[data-azid]');
    state.ui.toggle = panel.querySelector('[data-toggle]');
    state.ui.copy = panel.querySelector('[data-copy]');
    state.ui.logs = panel.querySelector('[data-logs]');
  }

  function bindPanel() {
    state.ui.toggle?.addEventListener('click', () => {
      state.running = !state.running;
      state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
      state.ui.toggle.style.background = state.running ? '#b91c1c' : '#166534';
      setStatus(state.running ? 'Running' : 'Stopped');
      writeActivity(state.running ? 'idle' : 'stopped', state.running ? 'Running' : 'Stopped');
      log(state.running ? 'Resumed' : 'Stopped');
    });

    state.ui.copy?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText([...state.logs].reverse().join('\n'));
        log('Logs copied');
      } catch {
        log('Copy logs failed');
      }
    });

    makeDraggable(state.panel, state.ui.head);
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
    for (const prop of ['left', 'top', 'right', 'bottom']) {
      if (saved[prop]) state.panel.style[prop] = saved[prop];
    }
  }

  function isAzHost() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function isAltaHost() {
    return /^alta\.farmers\.com$/i.test(location.hostname);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function toMs(value) {
    const ms = Date.parse(normalizeText(value));
    return Number.isFinite(ms) ? ms : NaN;
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeCompare(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[\.,#]/g, ' ')
      .replace(/\bstreet\b/g, 'st')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bdrive\b/g, 'dr')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pickFirst(...values) {
    for (const value of values) {
      const text = normalizeText(value);
      if (text) return text;
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

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function safeJsonParse(text, fallback = null) {
    try {
      if (text == null || text === '') return fallback;
      return typeof text === 'string' ? JSON.parse(text) : text;
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

  function safeGet(key) {
    try { return localStorage.getItem(key) || ''; }
    catch { return ''; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, String(value)); } catch {}
  }

  function stableStringify(value) {
    try { return JSON.stringify(value); }
    catch { return String(value); }
  }
})();
