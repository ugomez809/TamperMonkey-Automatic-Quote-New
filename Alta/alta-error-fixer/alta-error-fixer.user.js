// ==UserScript==
// @name         Alta Error Fixer
// @namespace    homebot.alta-error-fixer
// @version      0.1.0
// @description  Watches Alta knockout dialogs and applies known Home quote fixes.
// @author       OpenAI
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-error-fixer/alta-error-fixer.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-error-fixer/alta-error-fixer.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__ALTA_ERROR_FIXER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Alta Error Fixer';
  const VERSION = '0.1.0';
  const KEYS = {
    panelPos: 'tm_alta_error_fixer_panel_pos_v1',
    logs: 'tm_alta_error_fixer_logs_v1'
  };
  const CFG = {
    maxLogLines: 30,
    scanMs: 900,
    pollMs: 200,
    waitMs: 12000,
    optionWaitMs: 4000,
    recalcWaitMs: 5000
  };

  const state = {
    busy: false,
    destroyed: false,
    scanTimer: null,
    scanTimeout: null,
    observer: null,
    panel: null,
    ui: {},
    logs: [],
    lastUnknownSignature: ''
  };

  const RULES = [
    {
      id: 'roof-valuation-acv',
      label: 'Roof valuation to Actual Cash Value',
      matches(dialog) {
        const text = normalize(dialog.textContent).toLowerCase();
        return text.includes('ineligible for farmers home') &&
          text.includes('change roof valuation method to actual cash value');
      },
      fix: fixRoofValuationActualCashValue
    }
  ];

  init();

  function init() {
    buildPanel();
    bindPanel();
    restorePanelPos();
    loadLogs();
    log(`Loaded v${VERSION}`);
    startWatcher();
    scanForErrors('init');
    window.__ALTA_ERROR_FIXER_CLEANUP__ = cleanup;
  }

  function cleanup() {
    state.destroyed = true;
    if (state.scanTimer) clearInterval(state.scanTimer);
    if (state.scanTimeout) clearTimeout(state.scanTimeout);
    try { state.observer?.disconnect(); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_ERROR_FIXER_CLEANUP__; } catch {}
  }

  function startWatcher() {
    state.scanTimer = setInterval(() => scanForErrors('interval'), CFG.scanMs);
    state.observer = new MutationObserver((mutations) => {
      if (mutations.every(isOwnPanelMutation)) return;
      scheduleScan('mutation');
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function scheduleScan(reason) {
    if (state.destroyed || state.scanTimeout) return;
    state.scanTimeout = setTimeout(() => {
      state.scanTimeout = null;
      scanForErrors(reason);
    }, 150);
  }

  function scanForErrors(reason) {
    if (state.destroyed || state.busy) return;
    const dialog = findKnockoutDialog();
    if (!dialog) {
      setStatus('Watching for Alta errors');
      return;
    }

    const rule = RULES.find((entry) => entry.matches(dialog));
    if (!rule) {
      logUnknownKnockout(dialog);
      setStatus('Unknown knockout found');
      return;
    }

    handleRule(rule, dialog, reason).catch((err) => {
      setStatus('Fix error');
      log(`Fix error: ${err?.message || err}`);
      state.busy = false;
    });
  }

  async function handleRule(rule, dialog, reason) {
    state.busy = true;
    setStatus(`Fixing: ${rule.label}`);
    log(`Matched ${rule.label} (${reason})`);
    try {
      await rule.fix(dialog);
      setStatus(`Fixed: ${rule.label}`);
      log(`Fixed ${rule.label}`);
    } finally {
      state.busy = false;
      scheduleScan('after-fix');
    }
  }

  async function fixRoofValuationActualCashValue(dialog) {
    const goBack = actionByText('Go back and edit', dialog) || actionByText('Go back and edit');
    if (!goBack) throw new Error('Go back and edit action not found');

    clickElement(goBack);
    log('Clicked Go back and edit');
    await waitFor(() => !findKnockoutDialog(), 8000).catch(() => null);
    await sleep(750);

    const select = await waitFor(() => findRoofValuationSelect(), CFG.waitMs);
    await setMatSelectValue(select, 'Actual Cash Value', 'Roof valuation');

    const recalc = await waitFor(() => findRecalculateButton(), CFG.recalcWaitMs).catch(() => null);
    if (recalc) {
      clickElement(recalc);
      log('Clicked Recalculate after roof valuation fix');
      await sleep(750);
    } else {
      log('Roof valuation fixed; Recalculate button not visible');
    }
  }

  async function setMatSelectValue(select, wantedText, label) {
    const wanted = normalize(wantedText).toLowerCase();
    if (normalize(select.textContent).toLowerCase().includes(wanted)) {
      log(`${label} already ${wantedText}`);
      return true;
    }

    if (isDisabled(select)) throw new Error(`${label} select is disabled`);
    try { select.scrollIntoView?.({ block: 'center', inline: 'nearest' }); } catch {}
    clickElement(select);

    const option = await waitFor(() => findOption(wantedText), CFG.optionWaitMs);
    clickElement(option);
    await sleep(600);

    const refreshed = findRoofValuationSelect() || select;
    if (!normalize(refreshed.textContent).toLowerCase().includes(wanted)) {
      throw new Error(`${label} did not change to ${wantedText}`);
    }

    log(`Select set: ${label} = ${wantedText}`);
    return true;
  }

  function findKnockoutDialog() {
    const dialogs = [
      ...document.querySelectorAll('[role="dialog"], mat-dialog-container, .mat-mdc-dialog-surface, .ko-container')
    ];
    return dialogs.find((dialog) => {
      const text = normalize(dialog.textContent).toLowerCase();
      return text.includes('ineligible for farmers home');
    });
  }

  function findRoofValuationSelect() {
    const selects = [...document.querySelectorAll('mat-select')];
    return selects.find((select) => normalize(select.getAttribute('aria-label')).toLowerCase().includes('roof valuation')) ||
      selects.find((select) => normalize(select.closest('.input-main-section, [class*="input-main-section"], [class*="coverage"]')?.textContent).toLowerCase().includes('roof valuation'));
  }

  function findOption(text) {
    const wanted = normalize(text).toLowerCase();
    return [...document.querySelectorAll('mat-option,[role="option"]')]
      .find((option) => normalize(option.textContent).toLowerCase().includes(wanted));
  }

  function findRecalculateButton() {
    const buttons = [
      document.querySelector('button[data-test-id="TUI_REVIEW_COVERAGE_CARD_CTA"]'),
      document.querySelector('button[data-test-id="ReCalculate_Button"]'),
      ...document.querySelectorAll('button')
    ].filter(Boolean);
    return buttons.find((button) => isVisible(button) && !isDisabled(button) && /^recalculate$/i.test(normalize(button.textContent)));
  }

  function actionByText(text, root = document) {
    const wanted = normalize(text).toLowerCase();
    return [...root.querySelectorAll('a,button,[role="button"]')]
      .find((el) => normalize(el.textContent).toLowerCase() === wanted);
  }

  function logUnknownKnockout(dialog) {
    const signature = normalize(dialog.textContent).slice(0, 220);
    if (signature === state.lastUnknownSignature) return;
    state.lastUnknownSignature = signature;
    log(`Unknown knockout: ${signature}`);
  }

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = panelCss('alta-error-fixer');
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'alta-error-fixer-panel';
    panel.innerHTML = panelHtml(SCRIPT_NAME, VERSION, [
      ['alta-error-fixer-scan', 'Scan Now'],
      ['alta-error-fixer-copy', 'Copy Logs']
    ]);
    document.body.appendChild(panel);
    state.panel = panel;
    state.ui.status = panel.querySelector('.hb-status');
    state.ui.log = panel.querySelector('.hb-log');
  }

  function bindPanel() {
    state.panel.querySelector('#alta-error-fixer-scan')?.addEventListener('click', () => scanForErrors('manual'));
    state.panel.querySelector('#alta-error-fixer-copy')?.addEventListener('click', copyLogs);
    makeDraggable(state.panel, KEYS.panelPos);
  }

  function panelCss(id) {
    return `#${id}-panel{position:fixed;right:14px;bottom:14px;width:310px;z-index:2147483647;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;font-family:Arial,sans-serif;font-size:12px;box-shadow:0 10px 28px rgba(0,0,0,.35)}#${id}-panel header{display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #374151;cursor:move}#${id}-panel main{padding:8px 10px}#${id}-panel button{border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;padding:6px 8px;cursor:pointer;margin:0 6px 6px 0}#${id}-panel button:nth-child(2){background:#374151}.hb-status{color:#d1d5db;margin-bottom:8px}.hb-log{white-space:pre-wrap;max-height:140px;overflow:auto;background:#030712;border:1px solid #374151;border-radius:6px;padding:6px;color:#d1d5db}`;
  }

  function panelHtml(name, version, buttons) {
    return `<header><strong>${escapeHtml(name)}</strong><span>v${escapeHtml(version)}</span></header><main><div class="hb-status">Ready</div><div>${buttons.map(([id, text]) => `<button id="${escapeHtml(id)}" type="button">${escapeHtml(text)}</button>`).join('')}</div><div class="hb-log"></div></main>`;
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
    if (state.ui.status && state.ui.status.textContent !== message) state.ui.status.textContent = message;
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

  function isDisabled(el) {
    return !!(el?.disabled || el?.getAttribute?.('aria-disabled') === 'true' || el?.classList?.contains('mat-mdc-select-disabled'));
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isOwnPanelMutation(mutation) {
    const target = mutation?.target;
    const el = target?.nodeType === 1 ? target : target?.parentElement;
    return !!el?.closest?.('#alta-error-fixer-panel');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalize(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
