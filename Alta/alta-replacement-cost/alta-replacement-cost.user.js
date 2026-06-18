// ==UserScript==
// @name         Alta Replacement Cost
// @namespace    homebot.alta-replacement-cost
// @version      0.1.8
// @description  Auto-runs the Alta replacement-cost page. Captures replacement cost and 360Value details, stores them in the Alta home payload, and continues.
// @author       OpenAI
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-replacement-cost/alta-replacement-cost.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-replacement-cost/alta-replacement-cost.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__ALTA_REPLACEMENT_COST_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Alta Replacement Cost';
  const VERSION = '0.1.8';
  const KEYS = {
    currentJob: 'tm_alta_current_job_v1',
    payload: 'tm_alta_home_quote_grab_payload_v1',
    panelPos: 'tm_alta_replacement_cost_panel_pos_v1',
    logs: 'tm_alta_replacement_cost_logs_v1',
    errorFixerLock: 'tm_alta_error_fixer_flow_lock_v1'
  };
  const CFG = { maxLogLines: 24, waitMs: 12000, loadWaitMs: 25000, settleMs: 1600, pollMs: 200, autoScanMs: 800 };
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
    window.__ALTA_REPLACEMENT_COST_CLEANUP__ = cleanup;
  }

  function cleanup() {
    state.destroyed = true;
    if (state.autoTimer) clearInterval(state.autoTimer);
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_REPLACEMENT_COST_CLEANUP__; } catch {}
  }

  async function runPage({ continueAfter = true } = {}) {
    try {
      setStatus('Capturing replacement cost');
      await waitForPageReady(() => isReplacementCostReady(), 'Replacement cost page');

      const replacementCost = normalize(document.querySelector('[data-test-id="Currency"]')?.textContent);
      const details = capture360Value();
      const characteristics = captureCharacteristics();
      const stories = characteristics['Stories above ground'] || '';
      const fullBaths = characteristics['Number of Full Baths'] || '';

      updatePayload(removeEmpty({
        'Reconstruction Cost': replacementCost,
        '# of Story': stories,
        Bathrooms: fullBaths,
        'Water Device?': ''
      }), { replacementCostComplete: true }, {
        altaReplacementCost: {
          replacementCost,
          ...details,
          characteristics
        }
      });

      log(`Replacement cost captured: ${replacementCost || '(blank)'}`);
      if (details.valueId) log(`360Value ID: ${details.valueId}`);

      if (continueAfter) {
        await clickContinue();
        log('Clicked Continue');
      } else {
        log('Capture only complete');
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
    if (!isReplacementCostReady()) {
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
    const btn = state.panel?.querySelector('#alta-replacement-cost-pause');
    if (!btn) return;
    btn.textContent = state.paused ? 'Resume Auto' : 'Pause Auto';
    btn.style.background = state.paused ? '#b45309' : '#2563eb';
  }

  function autoPageKey() {
    return `${location.pathname}${location.search}|replacement-cost`;
  }

  function capture360Value() {
    const text = normalize(document.body.textContent);
    const aria = normalize(document.querySelector('[aria-label*="Open 360Value"]')?.getAttribute('aria-label'));
    const valueId = (text.match(/360Value ID:\s*([A-Z0-9-]+)/i) || aria.match(/id\s+([A-Z0-9-]+)/i) || [])[1] || '';
    const version = (text.match(/360Value ID Version:\s*([0-9]+)/i) || aria.match(/version id\s+([0-9]+)/i) || [])[1] || '';
    return { valueId, valueVersion: version };
  }

  function captureCharacteristics() {
    const out = {};
    for (const row of document.querySelectorAll('[data-test-id^="Property_Name "]')) {
      const name = normalize(row.getAttribute('data-test-id')).replace(/^Property_Name\s+/, '');
      if (!name) continue;
      const value = normalize(
        row.querySelector('input')?.value ||
        row.querySelector('.mat-mdc-select-min-line')?.textContent ||
        row.querySelector('mat-select')?.textContent ||
        ''
      );
      out[name] = value;
    }
    return out;
  }

  async function clickContinue() {
    const btn = await waitFor(() => document.querySelector('button[data-test-id="Continue_Button"]') || buttonByText('Continue'));
    btn.click();
    await sleep(500);
  }

  function updatePayload(rowUpdates, progressUpdates, extraMeta) {
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
        ...extraMeta,
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

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = panelCss('alta-replacement-cost');
    document.documentElement.appendChild(style);
    const panel = document.createElement('div');
    panel.id = 'alta-replacement-cost-panel';
    panel.innerHTML = panelHtml(SCRIPT_NAME, VERSION, [
      ['alta-replacement-cost-pause', 'Pause Auto'],
      ['alta-replacement-cost-capture', 'Capture Only'],
      ['alta-replacement-cost-copy', 'Copy Logs']
    ]);
    document.body.appendChild(panel);
    state.panel = panel;
    state.ui.status = panel.querySelector('.hb-status');
    state.ui.log = panel.querySelector('.hb-log');
  }

  function bindPanel() {
    state.panel.querySelector('#alta-replacement-cost-pause')?.addEventListener('click', togglePause);
    state.panel.querySelector('#alta-replacement-cost-capture')?.addEventListener('click', () => {
      state.lastAutoKey = autoPageKey();
      startRun({ continueAfter: false });
    });
    state.panel.querySelector('#alta-replacement-cost-copy')?.addEventListener('click', copyLogs);
    makeDraggable(state.panel, KEYS.panelPos);
    updatePauseButton();
  }

  function panelCss(id) {
    return `#${id}-panel{position:fixed;right:14px;bottom:14px;width:320px;z-index:2147483647;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;font-family:Arial,sans-serif;font-size:12px;box-shadow:0 10px 28px rgba(0,0,0,.35)}#${id}-panel header{display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #374151;cursor:move}#${id}-panel main{padding:8px 10px}#${id}-panel button{border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;padding:6px 8px;cursor:pointer;margin:0 6px 6px 0}#${id}-panel button:nth-child(3){background:#374151}.hb-status{color:#d1d5db;margin-bottom:8px}.hb-log{white-space:pre-wrap;max-height:145px;overflow:auto;background:#030712;border:1px solid #374151;border-radius:6px;padding:6px;color:#d1d5db}`;
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

  function buttonByText(text) {
    const wanted = normalize(text).toLowerCase();
    return [...document.querySelectorAll('button')].find((btn) => normalize(btn.textContent).toLowerCase() === wanted);
  }

  function findByText(selector, text) {
    const wanted = normalize(text).toLowerCase();
    return [...document.querySelectorAll(selector)].find((el) => normalize(el.textContent).toLowerCase().includes(wanted));
  }

  function isReplacementCostReady() {
    const pageMarker = document.querySelector('[data-test-id="Currency"], [data-test-id^="Property_Name "]') || findByText('h2,div', 'Primary home characteristics');
    const characteristicCount = document.querySelectorAll('[data-test-id^="Property_Name "]').length;
    return !!pageMarker &&
      !!document.querySelector('[data-test-id="Currency"]') &&
      characteristicCount >= 3 &&
      !!(document.querySelector('button[data-test-id="Continue_Button"]') || buttonByText('Continue')) &&
      (!document.querySelector('.sidenav-current-step') || isCurrentSideNavStep('Est replacement cost'));
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
    while (Date.now() - start < CFG.loadWaitMs && isPageBusy()) {
      await sleep(CFG.pollMs);
    }

    await sleep(CFG.settleMs);
    await waitFor(readyFn, 2500);
    log(`${label} loaded`);
    return true;
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
})();
