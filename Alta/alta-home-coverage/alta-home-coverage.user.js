// ==UserScript==
// @name         Alta Home Coverage
// @namespace    homebot.alta-home-coverage
// @version      0.1.1
// @description  Manual Alta home-coverage page runner. Sets All Perils to 5000, Split Water to 5 percent, captures pricing, and publishes the Alta home payload.
// @author       OpenAI
// @match        https://alta.farmers.com/quote/home/home-coverage*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-home-coverage/alta-home-coverage.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-home-coverage/alta-home-coverage.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__ALTA_HOME_COVERAGE_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Alta Home Coverage';
  const VERSION = '0.1.1';
  const KEYS = {
    currentJob: 'tm_alta_current_job_v1',
    payload: 'tm_alta_home_quote_grab_payload_v1',
    panelPos: 'tm_alta_home_coverage_panel_pos_v1',
    logs: 'tm_alta_home_coverage_logs_v1'
  };
  const CFG = { maxLogLines: 30, waitMs: 12000, pollMs: 200, priceWaitMs: 20000 };
  const state = { panel: null, ui: {}, logs: [] };

  init();

  function init() {
    buildPanel();
    bindPanel();
    restorePanelPos();
    loadLogs();
    log(`Loaded v${VERSION}`);
    updatePayload({}, { homeCoverageLoaded: true }, false, {});
    window.__ALTA_HOME_COVERAGE_CLEANUP__ = cleanup;
  }

  function cleanup() {
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_HOME_COVERAGE_CLEANUP__; } catch {}
  }

  async function runPage({ publish = true, clickQuote = true } = {}) {
    try {
      setStatus('Running home coverage');
      await waitFor(() => findByText('h1', 'Home coverages') || document.querySelector('#quoteCardCoverageCard'));

      await setMatSelectByAria('Policy deductibles-All perils-', '$5,000', false);
      await setMatSelectByAria('Policy deductibles-Split water-', '(5.0%)', false);

      if (clickQuote) {
        const cta = document.querySelector('button[data-test-id="TUI_REVIEW_COVERAGE_CARD_CTA"]');
        if (cta && /recalculate|go/i.test(normalize(cta.textContent))) {
          cta.click();
          log(`Clicked quote CTA: ${normalize(cta.textContent) || 'button'}`);
          await sleep(1500);
          await waitFor(() => {
            const price = capturePrice();
            return price.valid ? price : null;
          }, CFG.priceWaitMs).catch(() => null);
        } else {
          log('Quote CTA not available; extracting current page state');
        }
      }

      const price = capturePrice();
      const coverageData = captureCoverageData();
      const result = price.valid ? 'Grabbed (Alta)' : `Alta pricing unavailable${price.reason ? `: ${price.reason}` : ''}`;
      const rowUpdates = {
        'Standard Pricing No Auto Discount': price.valid ? price.termPremium : '',
        'Enhance Pricing No Auto Discount': '',
        'Standard Pricing Auto Discount': '',
        'Enhance Pricing Auto Discount': '',
        'Auto Discount': '',
        'Date Processed?': formatDate(new Date()),
        'Done?': price.valid ? 'Yes' : 'No',
        Result: result,
        'Water Device?': ''
      };
      const payload = updatePayload(rowUpdates, { homeCoverageComplete: true, finalRefreshComplete: true }, publish, {
        altaCoverage: {
          price,
          coverageData
        }
      });
      log(price.valid ? `Captured price ${price.termPremium}` : result);
      log(publish ? `Published payload for AZ ${payload['AZ ID'] || '(unknown)'}` : 'Capture only complete');
      setStatus(publish ? 'Published' : 'Captured');
    } catch (err) {
      setStatus('Error');
      log(`Error: ${err?.message || err}`);
      updatePayload({
        'Done?': 'No',
        Result: `Alta coverage error: ${err?.message || err}`,
        'Water Device?': ''
      }, { homeCoverageComplete: false }, false, {});
    }
  }

  async function setMatSelectByAria(ariaLabel, wantedText, required = true) {
    const select = await waitFor(() => findMatSelectByAria(ariaLabel), required ? CFG.waitMs : 1500).catch(() => null);
    if (!select) {
      if (required) throw new Error(`Select not found: ${ariaLabel}`);
      log(`Skipped missing select: ${ariaLabel}`);
      return false;
    }
    if (normalize(select.textContent).toLowerCase().includes(wantedText.toLowerCase())) {
      log(`${ariaLabel} already ${wantedText}`);
      return true;
    }
    select.click();
    const option = await waitFor(() => findOption(wantedText), 3000).catch(() => null);
    if (!option) {
      if (required) throw new Error(`Option not found: ${wantedText}`);
      log(`Skipped missing option ${wantedText} for ${ariaLabel}`);
      document.body.click();
      return false;
    }
    option.click();
    await sleep(350);
    log(`Select set: ${ariaLabel} = ${wantedText}`);
    return true;
  }

  function findMatSelectByAria(ariaLabel) {
    const wanted = normalize(ariaLabel).toLowerCase();
    return [...document.querySelectorAll('mat-select[aria-label]')]
      .find((el) => normalize(el.getAttribute('aria-label')).toLowerCase().includes(wanted));
  }

  function findOption(text) {
    const wanted = normalize(text).toLowerCase();
    return [...document.querySelectorAll('mat-option,[role="option"]')]
      .find((el) => normalize(el.textContent).toLowerCase().includes(wanted));
  }

  function capturePrice() {
    const card = document.querySelector('#quoteCardCoverageCard') || document;
    const risk = normalize(card.querySelector('[data-test-id="TUI_QUOTE_PRESENTMENT_indicator"]')?.textContent);
    const main = normalize(card.querySelector('.price-main:not(.price-main-strike), .price-main')?.textContent);
    const strike = normalize(card.querySelector('.price-main-strike')?.textContent);
    const captions = [...card.querySelectorAll('.tui-caption.tui-text-primary')].map((el) => normalize(el.textContent)).filter(Boolean);
    const text = normalize(card.textContent);
    const termPremium = money(main) || money(strike);
    const totalWithFees = money(captions.join(' '));
    const hasPlaceholder = /\$--|---|<\$-->|score err/i.test(text);
    const valid = !!termPremium && !hasPlaceholder;
    return {
      valid,
      termPremium,
      totalWithFees,
      riskSegment: risk,
      rawMain: main || strike,
      rawFees: captions.join(' '),
      reason: valid ? '' : (hasPlaceholder ? 'placeholder/score error' : 'price not found')
    };
  }

  function captureCoverageData() {
    return {
      template: normalize(document.querySelector('mat-select[formfieldmodifiedsegmentreporter="coverage_template"]')?.textContent),
      allPerils: currentSelectValue('Policy deductibles-All perils-'),
      splitWater: currentSelectValue('Policy deductibles-Split water-'),
      payPlan: normalize(document.querySelector('[data-test-id="TUI_REVIEW_COVERAGE_PAYPLAN_VALUE"]')?.textContent),
      policyStartDate: normalize(document.querySelector('[data-test-id="TUI_REVIEW_COVERAGE_POLICY_DATE_VALUE"]')?.textContent)
    };
  }

  function currentSelectValue(ariaLabel) {
    const select = findMatSelectByAria(ariaLabel);
    return normalize(select?.querySelector('.mat-mdc-select-min-line')?.textContent || select?.textContent || '');
  }

  function money(text) {
    const match = normalize(text).match(/\$[\d,]+(?:\.\d{2})?/);
    return match ? match[0] : '';
  }

  function updatePayload(rowUpdates, progressUpdates, ready, extraMeta) {
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
      ready: !!ready,
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
        phase: ready ? 'complete' : 'in-progress',
        progress: { ...(old?.meta?.progress || {}), ...progressUpdates },
        lastWriter: SCRIPT_NAME,
        updatedAt: new Date().toISOString()
      },
      customFields: old.customFields || {},
      quoteAfterDiscount: old.quoteAfterDiscount || {},
      tabsUsed: {
        ...(old.tabsUsed || {}),
        altaCustomerInfo: true,
        altaHomeFeatures: true,
        altaReplacementCost: true,
        altaHomeCoverage: true
      },
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
    style.textContent = panelCss('alta-home-coverage');
    document.documentElement.appendChild(style);
    const panel = document.createElement('div');
    panel.id = 'alta-home-coverage-panel';
    panel.innerHTML = panelHtml(SCRIPT_NAME, VERSION, [
      ['alta-home-coverage-run', 'Run + Publish'],
      ['alta-home-coverage-capture', 'Capture Only'],
      ['alta-home-coverage-copy', 'Copy Logs']
    ]);
    document.body.appendChild(panel);
    state.panel = panel;
    state.ui.status = panel.querySelector('.hb-status');
    state.ui.log = panel.querySelector('.hb-log');
  }

  function bindPanel() {
    state.panel.querySelector('#alta-home-coverage-run')?.addEventListener('click', () => runPage({ publish: true, clickQuote: true }));
    state.panel.querySelector('#alta-home-coverage-capture')?.addEventListener('click', () => runPage({ publish: false, clickQuote: false }));
    state.panel.querySelector('#alta-home-coverage-copy')?.addEventListener('click', copyLogs);
    makeDraggable(state.panel, KEYS.panelPos);
  }

  function panelCss(id) {
    return `#${id}-panel{position:fixed;right:14px;bottom:14px;width:330px;z-index:2147483647;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;font-family:Arial,sans-serif;font-size:12px;box-shadow:0 10px 28px rgba(0,0,0,.35)}#${id}-panel header{display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #374151;cursor:move}#${id}-panel main{padding:8px 10px}#${id}-panel button{border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;padding:6px 8px;cursor:pointer;margin:0 6px 6px 0}#${id}-panel button:nth-child(3){background:#374151}.hb-status{color:#d1d5db;margin-bottom:8px}.hb-log{white-space:pre-wrap;max-height:160px;overflow:auto;background:#030712;border:1px solid #374151;border-radius:6px;padding:6px;color:#d1d5db}`;
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
