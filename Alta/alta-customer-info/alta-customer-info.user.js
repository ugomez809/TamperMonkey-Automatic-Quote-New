// ==UserScript==
// @name         Alta Customer Info
// @namespace    homebot.alta-customer-info
// @version      0.1.7
// @description  Auto-runs the Alta customer-info page. Sets today's policy start date, confirms default customer questions, acknowledges disclosures, and continues.
// @author       OpenAI
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-customer-info/alta-customer-info.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-customer-info/alta-customer-info.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__ALTA_CUSTOMER_INFO_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Alta Customer Info';
  const VERSION = '0.1.7';
  const KEYS = {
    currentJob: 'tm_alta_current_job_v1',
    payload: 'tm_alta_home_quote_grab_payload_v1',
    panelPos: 'tm_alta_customer_info_panel_pos_v1',
    logs: 'tm_alta_customer_info_logs_v1'
  };
  const CFG = { maxLogLines: 24, waitMs: 12000, pollMs: 200, autoScanMs: 800 };
  const state = {
    panel: null,
    ui: {},
    logs: [],
    destroyed: false,
    paused: false,
    running: false,
    autoTimer: null,
    lastAutoKey: ''
  };

  init();

  function init() {
    buildPanel();
    bindPanel();
    restorePanelPos();
    loadLogs();
    log(`Loaded v${VERSION}`);
    updatePayload({}, { customerInfoLoaded: true });
    startAutoRun();
    window.__ALTA_CUSTOMER_INFO_CLEANUP__ = cleanup;
  }

  function cleanup() {
    state.destroyed = true;
    if (state.autoTimer) clearInterval(state.autoTimer);
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_CUSTOMER_INFO_CLEANUP__; } catch {}
  }

  async function runPage({ continueAfter = true } = {}) {
    let step = 'starting';
    try {
      setStatus('Running customer info');
      step = 'waiting for Customer information page';
      await waitFor(() => findByText('h1', 'Customer information'));

      step = 'reading Alta job';
      const job = readJob();
      if (job['AZ ID']) log(`Job loaded: ${job['AZ ID']} ${job.Name || ''}`);
      else log('No Alta job found; using page/default values');

      step = 'setting policy start date';
      const policyDate = formatDate(new Date());
      await setInput('#policyStartDate', policyDate);
      log(`Policy start date set to ${policyDate}`);

      step = 'setting marital status';
      await clickRadio('Marital status', 'S', false);
      step = 'setting primary residence';
      await clickRadio('Is the home their current or soon-to-be primary residence?', 'yes', false);
      step = 'setting business owner';
      await clickRadio({
        label: 'Is the customer a business owner?',
        fieldClass: 'isCustomerBusinessOwner'
      }, 'no', true);
      step = 'setting specialty units';
      await clickRadio({
        label: 'Does the customer own any specialty units?',
        fieldClass: 'doesCustomerOwnSpecialtyVehicles'
      }, 'no', true);

      step = 'updating payload';
      updatePayload({
        Name: job.Name || fullName(job),
        'Mailing Address': job['Mailing Address'] || mailingAddress(job),
        'Date Processed?': formatDate(new Date()),
        'Water Device?': ''
      }, { customerInfoComplete: true });

      if (continueAfter) {
        step = 'clicking Continue';
        await clickContinue();
        log('Clicked Continue');
      } else {
        log('Fill only complete');
      }
      setStatus('Done');
      return true;
    } catch (err) {
      setStatus('Error');
      log(`Error during ${step}: ${err?.message || err}`);
      if (err?.stack) console.error(`[${SCRIPT_NAME}] Error during ${step}`, err);
      return false;
    }
  }

  function startAutoRun() {
    setStatus('Auto-run watching');
    state.autoTimer = setInterval(autoRunTick, CFG.autoScanMs);
    autoRunTick();
  }

  function autoRunTick() {
    if (state.destroyed || state.running) return;
    if (state.paused) {
      setStatus('Paused for this tab');
      return;
    }
    if (!isCustomerInfoReady()) {
      state.lastAutoKey = '';
      return;
    }

    const key = autoPageKey();
    if (state.lastAutoKey === key) return;
    state.lastAutoKey = key;
    log('Auto-run triggered');
    startRun({ continueAfter: true });
  }

  async function startRun(options) {
    if (state.running) {
      log('Run already in progress');
      return false;
    }
    state.running = true;
    updatePauseButton();
    try {
      return await runPage(options);
    } finally {
      state.running = false;
      updatePauseButton();
    }
  }

  function togglePause() {
    state.paused = !state.paused;
    log(state.paused ? 'Paused auto-run for this tab' : 'Auto-run resumed');
    setStatus(state.paused ? 'Paused for this tab' : 'Auto-run watching');
    updatePauseButton();
    if (!state.paused) autoRunTick();
  }

  function updatePauseButton() {
    const btn = state.panel?.querySelector('#alta-customer-info-pause');
    if (!btn) return;
    btn.textContent = state.paused ? 'Resume Auto' : 'Pause Auto';
    btn.style.background = state.paused ? '#b45309' : '#2563eb';
  }

  function autoPageKey() {
    return `${location.pathname}${location.search}|customer-info`;
  }

  async function clickContinue() {
    const btn = await waitFor(() => document.querySelector('button[data-test-id="CONTINUE_BUTTON"]') || buttonByText('Continue'));
    clickElement(btn);
    await sleep(500);
    const dialog = await waitFor(() => findInformationUpdatedDialog(), 2500).catch(() => null);
    if (!dialog) return;

    const confirm = buttonByText('Yes, continue quote', dialog);
    if (!confirm) throw new Error('Information updated dialog shown, but confirm button was not found');
    log('Information updated dialog shown; confirming changes');
    clickElement(confirm);
    await waitFor(() => !findInformationUpdatedDialog(), 5000).catch(() => null);
    await sleep(500);

    const secondContinue = await waitFor(() => document.querySelector('button[data-test-id="CONTINUE_BUTTON"]') || buttonByText('Continue'));
    clickElement(secondContinue);
    log('Clicked Continue after information update confirmation');
    await sleep(500);
  }

  async function setInput(selector, value) {
    const input = await waitFor(() => findInputTarget(selector));
    try { input.focus(); } catch {}
    setNativeValue(input, value);
    dispatchInputEvents(input);
    try { input.blur(); } catch {}
    await sleep(150);
  }

  async function clickRadio(groupLabel, value, required = true) {
    const labelText = typeof groupLabel === 'object' ? groupLabel.label : groupLabel;
    const group = await waitFor(() => findRadioGroup(groupLabel), required ? CFG.waitMs : 1500).catch(() => null);
    if (!group) {
      if (required) throw new Error(`Radio group not found: ${labelText}`);
      log(`Skipped missing radio group: ${labelText}`);
      return false;
    }
    const input = findRadioInput(group, value);
    if (!input) {
      if (required) throw new Error(`Radio value ${value} not found for ${labelText}`);
      log(`Skipped missing radio value ${value}: ${labelText}`);
      return false;
    }
    if (!input.checked) {
      const radio = input.closest('mat-radio-button') || input;
      const target = findRadioClickTarget(radio, input);
      try { target.scrollIntoView?.({ block: 'center', inline: 'nearest' }); } catch {}
      clickElement(target);
      await sleep(250);
      if (!input.checked) {
        clickElement(input);
        dispatchInputEvents(input);
        await sleep(250);
      }
    }
    if (!input.checked) {
      if (required) throw new Error(`Radio value ${value} did not stick for ${labelText}`);
      log(`Radio did not stick: ${labelText} = ${value}`);
      return false;
    }
    log(`Radio set: ${labelText} = ${value}`);
    return true;
  }

  function findRadioGroup(target) {
    const label = typeof target === 'object' ? target.label : target;
    const fieldClass = typeof target === 'object' ? target.fieldClass : '';
    const wanted = normalize(label).toLowerCase();
    const groups = [...document.querySelectorAll('mat-radio-group')];
    if (fieldClass) {
      const byClass = document.querySelector(`.${cssEscape(fieldClass)} mat-radio-group`);
      if (byClass) return byClass;
    }
    return groups.find((group) => normalize(group.getAttribute('aria-label')).toLowerCase().includes(wanted)) ||
      groups.find((group) => normalize(group.closest('.dynamic-personal-info-field-item, .dynamic-grid-label-and-field, form')?.textContent).toLowerCase().includes(wanted));
  }

  function findRadioInput(group, value) {
    const wanted = normalize(value).toLowerCase();
    return [...group.querySelectorAll('input[type="radio"]')].find((input) => normalize(input.value).toLowerCase() === wanted) ||
      [...group.querySelectorAll('mat-radio-button')].find((radio) => normalize(radio.textContent).toLowerCase() === wanted)?.querySelector('input[type="radio"]');
  }

  function findRadioClickTarget(radio, input) {
    if (input?.id) {
      const label = radio.querySelector(`label[for="${cssAttr(input.id)}"]`);
      if (label) return label;
    }
    return radio.querySelector('.mat-mdc-radio-touch-target, .mdc-radio, label') || radio || input;
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
      'Date Processed?': '',
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

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = panelCss('alta-customer-info');
    document.documentElement.appendChild(style);
    const panel = document.createElement('div');
    panel.id = 'alta-customer-info-panel';
    panel.innerHTML = panelHtml(SCRIPT_NAME, VERSION, [
      ['alta-customer-info-pause', 'Pause Auto'],
      ['alta-customer-info-fill', 'Fill Only'],
      ['alta-customer-info-copy', 'Copy Logs']
    ]);
    document.body.appendChild(panel);
    state.panel = panel;
    state.ui.status = panel.querySelector('.hb-status');
    state.ui.log = panel.querySelector('.hb-log');
  }

  function bindPanel() {
    state.panel.querySelector('#alta-customer-info-pause')?.addEventListener('click', togglePause);
    state.panel.querySelector('#alta-customer-info-fill')?.addEventListener('click', () => {
      state.lastAutoKey = autoPageKey();
      startRun({ continueAfter: false });
    });
    state.panel.querySelector('#alta-customer-info-copy')?.addEventListener('click', copyLogs);
    makeDraggable(state.panel, KEYS.panelPos);
    updatePauseButton();
  }

  function panelCss(id) {
    return `#${id}-panel{position:fixed;right:14px;bottom:14px;width:310px;z-index:2147483647;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;font-family:Arial,sans-serif;font-size:12px;box-shadow:0 10px 28px rgba(0,0,0,.35)}#${id}-panel header{display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #374151;cursor:move}#${id}-panel main{padding:8px 10px}#${id}-panel button{border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;padding:6px 8px;cursor:pointer;margin:0 6px 6px 0}#${id}-panel button:nth-child(3){background:#374151}.hb-status{color:#d1d5db;margin-bottom:8px}.hb-log{white-space:pre-wrap;max-height:140px;overflow:auto;background:#030712;border:1px solid #374151;border-radius:6px;padding:6px;color:#d1d5db}`;
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

  function setNativeValue(el, value) {
    const win = el?.ownerDocument?.defaultView || window;
    const setters = [
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set,
      Object.getOwnPropertyDescriptor(win.HTMLInputElement?.prototype || {}, 'value')?.set,
      Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement?.prototype || {}, 'value')?.set,
      Object.getOwnPropertyDescriptor(win.HTMLSelectElement?.prototype || {}, 'value')?.set
    ].filter(Boolean);

    for (const setter of setters) {
      try {
        setter.call(el, value);
        if (String(el.value ?? '') === String(value)) return;
      } catch {}
    }

    try { el.value = value; } catch (err) {
      throw new Error(`Unable to set ${el?.id || el?.name || el?.tagName || 'input'}: ${err?.message || err}`);
    }
  }

  function findInputTarget(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    if (isValueControl(el)) return el;
    return el.querySelector('input:not([hidden]):not([readonly]), textarea, select') || el.querySelector('input, textarea, select');
  }

  function isValueControl(el) {
    const tag = String(el?.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function dispatchInputEvents(el) {
    const win = el?.ownerDocument?.defaultView || window;
    const EventCtor = win.Event || Event;
    el.dispatchEvent(new EventCtor('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new EventCtor('change', { bubbles: true, composed: true }));
  }

  function clickElement(el) {
    if (!el) return false;
    try {
      el.click();
      return true;
    } catch {}

    const win = el.ownerDocument?.defaultView || window;
    const MouseEventCtor = win.MouseEvent || MouseEvent;
    return el.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true, composed: true }));
  }

  function buttonByText(text, root = document) {
    const wanted = normalize(text).toLowerCase();
    return [...root.querySelectorAll('button')].find((btn) => normalize(btn.textContent).toLowerCase() === wanted);
  }

  function findInformationUpdatedDialog() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], mat-dialog-container, .personal-info-popup-container')];
    return dialogs.find((dialog) => {
      const label = normalize(dialog.getAttribute('aria-label')).toLowerCase();
      const text = normalize(dialog.textContent).toLowerCase();
      return label === 'information updated' || (text.includes('information updated') && text.includes('yes, continue quote'));
    });
  }

  function findByText(selector, text) {
    const wanted = normalize(text).toLowerCase();
    return [...document.querySelectorAll(selector)].find((el) => normalize(el.textContent).toLowerCase().includes(wanted));
  }

  function isCustomerInfoReady() {
    return !!findByText('h1,.pageTitle,.tui-subtitle,h2', 'Customer information') ||
      (location.pathname.includes('/quote/auto/personal-info') && !!document.querySelector('#policyStartDate'));
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

  function cssAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
})();
