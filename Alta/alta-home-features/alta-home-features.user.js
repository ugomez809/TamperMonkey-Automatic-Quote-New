// ==UserScript==
// @name         Alta Home Features
// @namespace    homebot.alta-home-features
// @version      0.1.4
// @description  Manual Alta home-features page runner. Applies Alta safe defaults, leaves water leak protection untouched, and continues.
// @author       OpenAI
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-home-features/alta-home-features.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-home-features/alta-home-features.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__ALTA_HOME_FEATURES_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Alta Home Features';
  const VERSION = '0.1.4';
  const KEYS = {
    currentJob: 'tm_alta_current_job_v1',
    payload: 'tm_alta_home_quote_grab_payload_v1',
    panelPos: 'tm_alta_home_features_panel_pos_v1',
    logs: 'tm_alta_home_features_logs_v1'
  };
  const CFG = { maxLogLines: 26, waitMs: 12000, pollMs: 200 };
  const state = { panel: null, ui: {}, logs: [] };

  init();

  function init() {
    buildPanel();
    bindPanel();
    restorePanelPos();
    loadLogs();
    log(`Loaded v${VERSION}`);
    window.__ALTA_HOME_FEATURES_CLEANUP__ = cleanup;
  }

  function cleanup() {
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_HOME_FEATURES_CLEANUP__; } catch {}
  }

  async function runPage({ continueAfter = true } = {}) {
    try {
      setStatus('Running home features');
      await waitFor(() => isHomeFeaturesReady());

      await setMatSelectByFormControl('firmAlarm', 'No device', false);
      await setMatSelectByFormControl('burglarAlarm', 'No device', false);
      log('Water leak protection intentionally left untouched');
      await setMatSelectByFormControl('fortifiedHomeCertification', 'Not certified', false);
      await setMatSelectByFormControl('plumbing', 'Copper', false);

      await clickRadioByFormControl('locatedWildFireCommunityInd', 'no', false);
      await clickRadioByFormControl('propertyLevelInd', 'no', false);
      await clickRadioByFormControl('construction', 'no', false);
      await clickRadioByFormControl('unrepairedStructuralDamage', 'no', false);
      await clickRadioByFormControl('plumbingReplacedLast20Years', 'no', false);
      await clickRadioByFormControl('solarPanelPresent', 'no', false);

      await ensureUnchecked('#trampolinecheckbox-input', 'Trampoline');
      await ensureUnchecked('#poolcheckbox-input', 'Pool');

      const rowUpdates = captureHomeFeatureRow();
      updatePayload(rowUpdates, { homeFeaturesComplete: true });

      if (continueAfter) {
        await clickContinue();
        log('Clicked Continue');
      } else {
        log('Fill only complete');
      }
      setStatus('Done');
    } catch (err) {
      setStatus('Error');
      log(`Error: ${err?.message || err}`);
    }
  }

  function captureHomeFeatureRow() {
    const address = textOf(document.querySelector('.address-line'));
    const yearBuilt = valueOf(document.querySelector('#yearBuilt'));
    const squareFt = valueOf(document.querySelector('[data-test-id="LIVABLE_SQUARE_FEET_INPUT"]'));
    const roofMaterial = valueNearLabel('Roof materials');
    const homeType = '';
    return removeEmpty({
      'Risk Address': address,
      'Year Built': yearBuilt,
      'Square FT': squareFt,
      'Home Roof Type': roofMaterial,
      'Home Type': homeType,
      'Water Device?': ''
    });
  }

  async function setMatSelectByFormControl(name, wantedText, required = true) {
    const select = await waitFor(() => document.querySelector(`mat-select[formcontrolname="${cssEscape(name)}"]`), required ? CFG.waitMs : 1500).catch(() => null);
    if (!select) {
      if (required) throw new Error(`Select not found: ${name}`);
      log(`Skipped missing select: ${name}`);
      return false;
    }
    if (normalize(select.textContent).toLowerCase().includes(wantedText.toLowerCase())) {
      log(`${name} already ${wantedText}`);
      return true;
    }
    select.click();
    const option = await waitFor(() => findOption(wantedText), 3000).catch(() => null);
    if (!option) {
      if (required) throw new Error(`Option not found: ${wantedText}`);
      log(`Skipped missing option ${wantedText} for ${name}`);
      document.body.click();
      return false;
    }
    option.click();
    await sleep(300);
    log(`Select set: ${name} = ${wantedText}`);
    return true;
  }

  function findOption(text) {
    const wanted = normalize(text).toLowerCase();
    return [...document.querySelectorAll('mat-option,[role="option"]')]
      .find((el) => normalize(el.textContent).toLowerCase().includes(wanted));
  }

  async function clickRadioByFormControl(name, value, required = true) {
    const group = await waitFor(() => document.querySelector(`mat-radio-group[formcontrolname="${cssEscape(name)}"]`), required ? CFG.waitMs : 1500).catch(() => null);
    if (!group) {
      if (required) throw new Error(`Radio group not found: ${name}`);
      log(`Skipped missing radio group: ${name}`);
      return false;
    }
    const input = group.querySelector(`input[type="radio"][value="${cssEscape(value)}"]`);
    if (!input) {
      if (required) throw new Error(`Radio value not found: ${name}=${value}`);
      log(`Skipped missing radio value: ${name}=${value}`);
      return false;
    }
    if (!input.checked) (input.closest('mat-radio-button') || input).click();
    await sleep(150);
    log(`Radio set: ${name} = ${value}`);
    return true;
  }

  async function ensureUnchecked(selector, label) {
    const input = document.querySelector(selector);
    if (!input) {
      log(`Skipped missing checkbox: ${label}`);
      return false;
    }
    if (input.checked) {
      (input.closest('mat-checkbox') || input).click();
      await sleep(150);
      log(`${label} unchecked`);
    } else {
      log(`${label} already unchecked`);
    }
    return true;
  }

  async function clickContinue() {
    const btn = await waitFor(() => buttonByText('Continue'));
    btn.click();
    await sleep(500);
  }

  function updatePayload(rowUpdates, progressUpdates) {
    const old = readJson(KEYS.payload) || {};
    const job = readJob();
    const row = {
      ...defaultRow(job),
      ...(old.row || {}),
      ...rowUpdates,
      'Water Device?': ''
    };
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      event: 'home_quote_gathered',
      product: 'home',
      ready: false,
      'AZ ID': job['AZ ID'] || old['AZ ID'] || '',
      currentJob: { ...job, updatedAt: new Date().toISOString() },
      savedAt: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      flow: 'manual',
      meta: {
        ...(old.meta || {}),
        product: 'home',
        source: 'Alta page scripts',
        phase: 'in-progress',
        progress: { ...(old?.meta?.progress || {}), ...progressUpdates },
        lastWriter: SCRIPT_NAME,
        updatedAt: new Date().toISOString()
      },
      customFields: old.customFields || {},
      row
    };
    writeJson(KEYS.payload, payload);
    return payload;
  }

  function defaultRow(job) {
    return {
      Name: job.Name || fullName(job),
      'Mailing Address': job['Mailing Address'] || mailingAddress(job),
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
      'Date Processed?': formatDate(new Date()),
      'Done?': '',
      Result: ''
    };
  }

  function readJob() {
    return readJson(KEYS.currentJob) || readJson('tm_shared_az_job_v1') || {};
  }

  function fullName(job) {
    return normalize(`${job['First Name'] || ''} ${job['Last Name'] || ''}`);
  }

  function mailingAddress(job) {
    return normalize([job['Street Address'], job.City, job.State, job.Zip].filter(Boolean).join(' '));
  }

  function valueNearLabel(label) {
    const wanted = normalize(label).toLowerCase();
    const labelEl = [...document.querySelectorAll('p,div,label')].find((el) => normalize(el.textContent).toLowerCase() === wanted);
    const row = labelEl?.closest('.row') || labelEl?.parentElement;
    return normalize(row?.querySelector('input')?.value || row?.querySelector('.mat-mdc-select-min-line')?.textContent || '');
  }

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = panelCss('alta-home-features');
    document.documentElement.appendChild(style);
    const panel = document.createElement('div');
    panel.id = 'alta-home-features-panel';
    panel.innerHTML = panelHtml(SCRIPT_NAME, VERSION, [
      ['alta-home-features-run', 'Run Page'],
      ['alta-home-features-fill', 'Fill Only'],
      ['alta-home-features-copy', 'Copy Logs']
    ]);
    document.body.appendChild(panel);
    state.panel = panel;
    state.ui.status = panel.querySelector('.hb-status');
    state.ui.log = panel.querySelector('.hb-log');
  }

  function bindPanel() {
    state.panel.querySelector('#alta-home-features-run')?.addEventListener('click', () => runPage({ continueAfter: true }));
    state.panel.querySelector('#alta-home-features-fill')?.addEventListener('click', () => runPage({ continueAfter: false }));
    state.panel.querySelector('#alta-home-features-copy')?.addEventListener('click', copyLogs);
    makeDraggable(state.panel, KEYS.panelPos);
  }

  function panelCss(id) {
    return `#${id}-panel{position:fixed;right:14px;bottom:14px;width:320px;z-index:2147483647;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;font-family:Arial,sans-serif;font-size:12px;box-shadow:0 10px 28px rgba(0,0,0,.35)}#${id}-panel header{display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #374151;cursor:move}#${id}-panel main{padding:8px 10px}#${id}-panel button{border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;padding:6px 8px;cursor:pointer;margin:0 6px 6px 0}#${id}-panel button:nth-child(3){background:#374151}.hb-status{color:#d1d5db;margin-bottom:8px}.hb-log{white-space:pre-wrap;max-height:150px;overflow:auto;background:#030712;border:1px solid #374151;border-radius:6px;padding:6px;color:#d1d5db}`;
  }

  function panelHtml(name, version, buttons) {
    return `<header><strong>${name}</strong><span>v${version}</span></header><main><div class="hb-status">Ready</div><div>${buttons.map(([id, text]) => `<button id="${id}">${text}</button>`).join('')}</div><div class="hb-log"></div></main>`;
  }

  function makeDraggable(panel, key) {
    const header = panel.querySelector('header');
    let drag = null;
    header.addEventListener('mousedown', (event) => {
      drag = { x: event.clientX, y: event.clientY, left: panel.offsetLeft, top: panel.offsetTop };
      event.preventDefault();
    });
    window.addEventListener('mousemove', (event) => {
      if (!drag) return;
      panel.style.left = `${Math.max(0, drag.left + event.clientX - drag.x)}px`;
      panel.style.top = `${Math.max(0, drag.top + event.clientY - drag.y)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      writeJson(key, { left: panel.style.left, top: panel.style.top, right: panel.style.right, bottom: panel.style.bottom });
    });
  }

  function restorePanelPos() {
    const pos = readJson(KEYS.panelPos);
    if (!pos) return;
    for (const prop of ['left', 'top', 'right', 'bottom']) if (pos[prop]) state.panel.style[prop] = pos[prop];
  }

  function loadLogs() {
    const saved = readJson(KEYS.logs);
    if (Array.isArray(saved?.lines)) state.logs = saved.lines.slice(0, CFG.maxLogLines);
    renderLogs();
  }

  function log(message) {
    state.logs.unshift(`[${new Date().toLocaleTimeString()}] ${message}`);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    writeJson(KEYS.logs, { script: SCRIPT_NAME, version: VERSION, updatedAt: new Date().toISOString(), lines: state.logs });
    renderLogs();
  }

  function setStatus(message) {
    if (state.ui.status) state.ui.status.textContent = message;
  }

  function renderLogs() {
    if (state.ui.log) state.ui.log.textContent = state.logs.join('\n');
  }

  async function copyLogs() {
    try { await navigator.clipboard.writeText(state.logs.join('\n')); log('Copied logs'); } catch { log('Copy failed'); }
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value, null, 2)); } catch {}
  }

  function buttonByText(text) {
    const wanted = normalize(text).toLowerCase();
    return [...document.querySelectorAll('button')].find((btn) => normalize(btn.textContent).toLowerCase() === wanted);
  }

  function findByText(selector, text) {
    const wanted = normalize(text).toLowerCase();
    return [...document.querySelectorAll(selector)].find((el) => normalize(el.textContent).toLowerCase().includes(wanted));
  }

  function isHomeFeaturesReady() {
    const pageMarker = findByText('.pageTitle,.tui-subtitle,h1,h2', 'Home features') ||
      document.querySelector('mat-select[formcontrolname="firmAlarm"], mat-select[formcontrolname="burglarAlarm"], #yearBuilt, [data-test-id="LIVABLE_SQUARE_FEET_INPUT"]');
    return pageMarker && (!document.querySelector('.sidenav-current-step') || isCurrentSideNavStep('Home features'));
  }

  function isCurrentSideNavStep(label) {
    const wanted = normalize(label).toLowerCase();
    return [...document.querySelectorAll('.sidenav-current-step')]
      .some((el) => normalize(el.textContent).toLowerCase().includes(wanted));
  }

  function waitFor(fn, timeoutMs = CFG.waitMs) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        const value = fn();
        if (value) return resolve(value);
        if (Date.now() - start >= timeoutMs) return reject(new Error('Timed out waiting for element'));
        setTimeout(tick, CFG.pollMs);
      };
      tick();
    });
  }

  function valueOf(el) {
    return normalize(el?.value || el?.getAttribute?.('value') || '');
  }

  function textOf(el) {
    return normalize(el?.textContent || '');
  }

  function removeEmpty(obj) {
    const out = {};
    for (const [key, value] of Object.entries(obj || {})) if (normalize(value)) out[key] = value;
    return out;
  }

  function formatDate(date) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${date.getFullYear()}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalize(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }
})();
