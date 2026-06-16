// ==UserScript==
// @name         Alta Home Features
// @namespace    homebot.alta-home-features
// @version      0.1.9
// @description  Auto-runs the Alta home-features page. Applies Alta safe defaults, leaves water leak protection untouched, and continues.
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
  const VERSION = '0.1.9';
  const KEYS = {
    currentJob: 'tm_alta_current_job_v1',
    payload: 'tm_alta_home_quote_grab_payload_v1',
    panelPos: 'tm_alta_home_features_panel_pos_v1',
    logs: 'tm_alta_home_features_logs_v1',
    errorFixerLock: 'tm_alta_error_fixer_flow_lock_v1'
  };
  const CFG = { maxLogLines: 26, waitMs: 12000, loadWaitMs: 25000, settleMs: 1600, pollMs: 200, autoScanMs: 800 };
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
    startAutoRun();
    window.__ALTA_HOME_FEATURES_CLEANUP__ = cleanup;
  }

  function cleanup() {
    state.destroyed = true;
    if (state.autoTimer) clearInterval(state.autoTimer);
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_HOME_FEATURES_CLEANUP__; } catch {}
  }

  async function runPage({ continueAfter = true } = {}) {
    try {
      setStatus('Running home features');
      await waitForPageReady(() => isHomeFeaturesReady(), 'Home features page');

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
      return true;
    } catch (err) {
      setStatus('Error');
      log(`Error: ${err?.message || err}`);
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
    if (isErrorFixerFlowActive()) {
      state.lastAutoKey = '';
      setStatus('Error fixer active');
      return;
    }
    if (!isHomeFeaturesReady()) {
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
    const btn = state.panel?.querySelector('#alta-home-features-pause');
    if (!btn) return;
    btn.textContent = state.paused ? 'Resume Auto' : 'Pause Auto';
    btn.style.background = state.paused ? '#b45309' : '#2563eb';
  }

  function autoPageKey() {
    return `${location.pathname}${location.search}|home-features`;
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
    if (!isCheckboxChecked(input, label)) {
      log(`${label} already unchecked`);
      return true;
    }

    for (const target of checkboxClickTargets(input, label)) {
      clickElement(target);
      await sleep(450);
      if (!isCheckboxChecked(document.querySelector(selector) || input, label)) {
        log(`${label} unchecked`);
        return true;
      }
    }

    throw new Error(`${label} stayed checked after uncheck attempts`);
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
      ['alta-home-features-pause', 'Pause Auto'],
      ['alta-home-features-fill', 'Fill Only'],
      ['alta-home-features-copy', 'Copy Logs']
    ]);
    document.body.appendChild(panel);
    state.panel = panel;
    state.ui.status = panel.querySelector('.hb-status');
    state.ui.log = panel.querySelector('.hb-log');
  }

  function bindPanel() {
    state.panel.querySelector('#alta-home-features-pause')?.addEventListener('click', togglePause);
    state.panel.querySelector('#alta-home-features-fill')?.addEventListener('click', () => {
      state.lastAutoKey = autoPageKey();
      startRun({ continueAfter: false });
    });
    state.panel.querySelector('#alta-home-features-copy')?.addEventListener('click', copyLogs);
    makeDraggable(state.panel, KEYS.panelPos);
    updatePauseButton();
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

  function isErrorFixerFlowActive() {
    const lock = readJson(KEYS.errorFixerLock);
    if (!lock?.active) return false;
    if (Number(lock.expiresAt || 0) > Date.now()) return true;
    try { localStorage.removeItem(KEYS.errorFixerLock); } catch {}
    return false;
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value, null, 2)); } catch {}
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

  function checkboxClickTargets(input, label) {
    const root = findCheckboxRoot(input, label);
    const targets = [];
    if (input.id) {
      targets.push(document.querySelector(`label[for="${cssAttr(input.id)}"]`));
      targets.push(root.querySelector?.(`label[for="${cssAttr(input.id)}"]`));
    }
    targets.push(
      root.querySelector?.('.mat-mdc-checkbox-touch-target'),
      root.querySelector?.('.mdc-checkbox'),
      root.querySelector?.('.mat-checkbox-inner-container'),
      root.querySelector?.('label'),
      root,
      input
    );
    return [...new Set(targets.filter(Boolean))].concat([...new Set(targets.filter(Boolean))]);
  }

  function isCheckboxChecked(input, label) {
    if (!input) return false;
    const root = findCheckboxRoot(input, label);
    const positiveSelector = [
      '.mat-mdc-checkbox-checked',
      '.mat-checkbox-checked',
      '.mdc-checkbox--selected',
      '[aria-checked="true"]',
      'input[type="checkbox"]:checked'
    ].join(',');
    if (root?.matches?.(positiveSelector) || root?.querySelector?.(positiveSelector)) return true;
    if ('checked' in input) return !!input.checked;
    const aria = input.getAttribute?.('aria-checked');
    return /^true$/i.test(String(aria || ''));
  }

  function findCheckboxRoot(input, label) {
    const direct = input?.closest?.('mat-checkbox, mat-mdc-checkbox, .mat-mdc-checkbox, .mat-checkbox, .mdc-form-field');
    if (direct) return direct;
    const inputContainer = input?.closest?.('[class*="checkbox"], label, li') || input?.parentElement;
    if (inputContainer && inputContainer !== document.body) return inputContainer;

    const wanted = normalize(label).toLowerCase();
    const labelEl = [...document.querySelectorAll('label,p,span,div')]
      .filter((el) => normalize(el.textContent).toLowerCase().includes(wanted))
      .sort((a, b) => normalize(a.textContent).length - normalize(b.textContent).length)[0];
    return labelEl?.closest?.('mat-checkbox, mat-mdc-checkbox, .mat-mdc-checkbox, .mat-checkbox, .mdc-form-field, .row, [class*="row"]') ||
      input;
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
    const requiredSelectors = [
      'mat-select[formcontrolname="firmAlarm"]',
      'mat-select[formcontrolname="burglarAlarm"]',
      'mat-select[formcontrolname="fortifiedHomeCertification"]',
      'mat-select[formcontrolname="plumbing"]',
      'mat-radio-group[formcontrolname="propertyLevelInd"]',
      'mat-radio-group[formcontrolname="construction"]',
      'mat-radio-group[formcontrolname="unrepairedStructuralDamage"]',
      'mat-radio-group[formcontrolname="plumbingReplacedLast20Years"]',
      'mat-radio-group[formcontrolname="solarPanelPresent"]',
      '#trampolinecheckbox-input',
      '#poolcheckbox-input'
    ];
    return !!pageMarker &&
      requiredSelectors.every((selector) => !!document.querySelector(selector)) &&
      !!buttonByText('Continue') &&
      (!document.querySelector('.sidenav-current-step') || isCurrentSideNavStep('Home features'));
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

  async function waitForPageReady(readyFn, label) {
    setStatus(`Waiting for ${label} to load`);
    await waitFor(readyFn, CFG.loadWaitMs);
    const start = Date.now();
    let lastSignature = '';
    let stableSince = 0;

    while (Date.now() - start < CFG.loadWaitMs) {
      if (!readyFn() || isPageBusy()) {
        lastSignature = '';
        stableSince = 0;
        await sleep(CFG.pollMs);
        continue;
      }

      const signature = pageLoadSignature();
      if (signature === lastSignature) {
        if (Date.now() - stableSince >= CFG.settleMs) {
          log(`${label} loaded`);
          return true;
        }
      } else {
        lastSignature = signature;
        stableSince = Date.now();
      }
      await sleep(CFG.pollMs);
    }

    throw new Error(`${label} did not finish loading`);
  }

  function pageLoadSignature() {
    const controls = [...document.querySelectorAll('input,textarea,select,mat-select,mat-radio-group,mat-checkbox,button')]
      .filter((el) => !state.panel?.contains(el));
    const controlState = controls.map((el) => [
      el.tagName,
      el.id || el.getAttribute('formcontrolname') || el.getAttribute('aria-label') || '',
      'value' in el ? el.value : normalize(el.textContent).slice(0, 40),
      'checked' in el ? String(el.checked) : ''
    ].join(':')).join('|');
    const textLength = normalize([...document.body.children]
      .filter((el) => el !== state.panel)
      .map((el) => el.textContent)
      .join(' ')).length;
    return `${document.readyState}|${controls.length}|${textLength}|${controlState}`;
  }

  function isPageBusy() {
    return [...document.querySelectorAll('mat-spinner,mat-progress-spinner,.mat-mdc-progress-spinner,.mat-progress-spinner,.spinner,[aria-busy="true"]')]
      .some((el) => !state.panel?.contains(el) && isVisible(el));
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
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

  function cssAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
})();
