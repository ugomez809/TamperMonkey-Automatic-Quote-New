// ==UserScript==
// @name         Alta Replacement Cost
// @namespace    homebot.alta-replacement-cost
// @version      0.1.0
// @description  Manual Alta replacement-cost page runner. Captures replacement cost and 360Value details, stores them in the Alta home payload, and continues.
// @author       OpenAI
// @match        https://alta.farmers.com/quote/home/replacement-cost*
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
  const VERSION = '0.1.0';
  const KEYS = {
    currentJob: 'tm_alta_current_job_v1',
    payload: 'tm_alta_home_quote_grab_payload_v1',
    panelPos: 'tm_alta_replacement_cost_panel_pos_v1',
    logs: 'tm_alta_replacement_cost_logs_v1'
  };
  const CFG = { maxLogLines: 24, waitMs: 12000, pollMs: 200 };
  const state = { panel: null, ui: {}, logs: [] };

  init();

  function init() {
    buildPanel();
    bindPanel();
    restorePanelPos();
    loadLogs();
    log(`Loaded v${VERSION}`);
    updatePayload({}, { replacementCostLoaded: true }, {});
    window.__ALTA_REPLACEMENT_COST_CLEANUP__ = cleanup;
  }

  function cleanup() {
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_REPLACEMENT_COST_CLEANUP__; } catch {}
  }

  async function runPage({ continueAfter = true } = {}) {
    try {
      setStatus('Capturing replacement cost');
      await waitFor(() => document.querySelector('[data-test-id="Currency"]') || findByText('h2,div', 'Primary home characteristics'));

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
    } catch (err) {
      setStatus('Error');
      log(`Error: ${err?.message || err}`);
    }
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
    return readJson(KEYS.currentJob) || readJson('tm_pc_current_job_v1') || readJson('tm_shared_az_job_v1') || {};
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
      ['alta-replacement-cost-run', 'Run Page'],
      ['alta-replacement-cost-capture', 'Capture Only'],
      ['alta-replacement-cost-copy', 'Copy Logs']
    ]);
    document.body.appendChild(panel);
    state.panel = panel;
    state.ui.status = panel.querySelector('.hb-status');
    state.ui.log = panel.querySelector('.hb-log');
  }

  function bindPanel() {
    state.panel.querySelector('#alta-replacement-cost-run')?.addEventListener('click', () => runPage({ continueAfter: true }));
    state.panel.querySelector('#alta-replacement-cost-capture')?.addEventListener('click', () => runPage({ continueAfter: false }));
    state.panel.querySelector('#alta-replacement-cost-copy')?.addEventListener('click', copyLogs);
    makeDraggable(state.panel, KEYS.panelPos);
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
