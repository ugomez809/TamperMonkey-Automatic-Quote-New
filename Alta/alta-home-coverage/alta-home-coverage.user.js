// ==UserScript==
// @name         Alta Home Coverage
// @namespace    homebot.alta-home-coverage
// @version      0.1.15
// @description  Auto-runs the Alta home-coverage page. Sets All Perils to 5000, Split Water to 5 percent, captures pricing, and publishes the Alta home payload.
// @author       OpenAI
// @match        https://alta.farmers.com/*
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
  const VERSION = '0.1.15';
  const KEYS = {
    currentJob: 'tm_alta_current_job_v1',
    payload: 'tm_alta_home_quote_grab_payload_v1',
    panelPos: 'tm_alta_home_coverage_panel_pos_v1',
    logs: 'tm_alta_home_coverage_logs_v1',
    errorFixerLock: 'tm_alta_error_fixer_flow_lock_v1',
    waterDeviceDecision: 'tm_alta_water_device_added_v1'
  };
  const CFG = { maxLogLines: 40, waitMs: 12000, loadWaitMs: 25000, settleMs: 1600, pollMs: 200, autoScanMs: 800, recalcWaitMs: 8000, recalcNudgeMs: 15000, recalcRetryWaitMs: 3000, recalcClickCooldownMs: 10000, priceWaitMs: 60000, discountControlWaitMs: 5000, pricingScenarioAttempts: 2 };
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
    window.__ALTA_HOME_COVERAGE_CLEANUP__ = cleanup;
  }

  function cleanup() {
    state.destroyed = true;
    if (state.autoTimer) clearInterval(state.autoTimer);
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_HOME_COVERAGE_CLEANUP__; } catch {}
  }

  async function runPage({ publish = true } = {}) {
    try {
      setStatus('Running home coverage');
      await waitForPageReady(() => isHomeCoverageReady(), 'Home coverage page');

      const pricing = await captureAllPricing();
      const coverageData = captureCoverageData();
      const capturedCount = Object.values(pricing.rowUpdates).filter(Boolean).length;
      const complete = capturedCount === 4;
      const submissionNumber = captureSubmissionNumber();
      const result = complete
        ? 'Grabbed 4/4 Alta prices'
        : capturedCount
        ? `Grabbed ${capturedCount}/4 Alta price${capturedCount === 1 ? '' : 's'}`
        : 'Alta pricing unavailable: no valid prices captured';
      const rowUpdates = {
        ...pricing.rowUpdates,
        'Auto Discount': pricing.autoDiscountSeen ? 'Yes' : 'No',
        'Date Processed?': formatDate(new Date()),
        'Done?': complete ? 'Yes' : 'No',
        Result: result,
        'Water Device?': waterDeviceAnswer()
      };
      if (submissionNumber) rowUpdates['Submission Number'] = submissionNumber;
      const payload = updatePayload(rowUpdates, { homeCoverageComplete: complete, finalRefreshComplete: complete }, publish && complete, {
        altaCoverage: {
          price: pricing.lastPrice || {},
          coverageData,
          pricingRuns: pricing.runs
        }
      });
      log(result);
      log(publish ? `Published payload for AZ ${payload['AZ ID'] || '(unknown)'}` : 'Capture only complete');
      setStatus(publish ? 'Published' : 'Captured');
    } catch (err) {
      setStatus('Error');
      log(`Error: ${err?.message || err}`);
      updatePayload({
        'Done?': 'No',
        Result: `Alta coverage error: ${err?.message || err}`,
        'Water Device?': waterDeviceAnswer()
      }, { homeCoverageComplete: false }, false, {});
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
    if (!isHomeCoverageReady()) {
      state.lastAutoKey = '';
      return;
    }

    const key = autoPageKey();
    if (state.lastAutoKey === key) return;
    state.lastAutoKey = key;
    log('Auto-run triggered');
    startRun({ publish: true });
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
    const btn = state.panel?.querySelector('#alta-home-coverage-pause');
    if (!btn) return;
    btn.textContent = state.paused ? 'Resume Auto' : 'Pause Auto';
    btn.style.background = state.paused ? '#b45309' : '#2563eb';
  }

  function autoPageKey() {
    return `${location.pathname}${location.search}|home-coverage`;
  }

  async function setMatSelectByAria(ariaLabel, wantedText, required = true) {
    const select = await waitFor(() => findMatSelectByAria(ariaLabel), required ? CFG.waitMs : 1500).catch(() => null);
    return setMatSelectValue(select, wantedText, ariaLabel, required);
  }

  async function setCoverageTemplate(wantedText, required = true) {
    const select = await waitFor(() => findCoverageTemplateSelect(), required ? CFG.waitMs : 1500).catch(() => null);
    return setMatSelectValue(select, wantedText, 'Coverage template', required);
  }

  async function setMatSelectValue(select, wantedText, label, required = true) {
    if (!select) {
      if (required) throw new Error(`Select not found: ${label}`);
      log(`Skipped missing select: ${label}`);
      return false;
    }
    if (normalize(select.textContent).toLowerCase().includes(wantedText.toLowerCase())) {
      log(`${label} already ${wantedText}`);
      return true;
    }
    select.click();
    const option = await waitFor(() => findOption(wantedText), 3000).catch(() => null);
    if (!option) {
      if (required) throw new Error(`Option not found: ${wantedText}`);
      log(`Skipped missing option ${wantedText} for ${label}`);
      document.body.click();
      return false;
    }
    option.click();
    await sleep(350);
    log(`Select set: ${label} = ${wantedText}`);
    return true;
  }

  function findMatSelectByAria(ariaLabel) {
    const wanted = normalize(ariaLabel).toLowerCase();
    return [...document.querySelectorAll('mat-select[aria-label]')]
      .find((el) => normalize(el.getAttribute('aria-label')).toLowerCase().includes(wanted));
  }

  function findCoverageTemplateSelect() {
    return document.querySelector('mat-select[formfieldmodifiedsegmentreporter="coverage_template"]') ||
      [...document.querySelectorAll('mat-select')].find((el) => /standard|enhance/i.test(normalize(el.textContent)));
  }

  function findOption(text) {
    const wanted = normalize(text).toLowerCase();
    return [...document.querySelectorAll('mat-option,[role="option"]')]
      .find((el) => normalize(el.textContent).toLowerCase().includes(wanted));
  }

  async function captureAllPricing() {
    const scenarios = [
      { field: 'Enhance Pricing No Auto Discount', template: 'Enhanced', autoDiscount: false },
      { field: 'Enhance Pricing Auto Discount', template: 'Enhanced', autoDiscount: true },
      { field: 'Standard Pricing No Auto Discount', template: 'Standard', autoDiscount: false },
      { field: 'Standard Pricing Auto Discount', template: 'Standard', autoDiscount: true }
    ];
    const rowUpdates = {};
    const runs = [];
    let lastPrice = null;
    let lastAmount = '';
    const amountsByTemplate = {};
    let autoDiscountSeen = false;

    await clearInitialHomeAutoDiscount();

    for (const scenario of scenarios) {
      const run = {
        field: scenario.field,
        template: scenario.template,
        autoDiscount: scenario.autoDiscount,
        ok: false,
        amount: '',
        error: ''
      };

      for (let attempt = 1; attempt <= CFG.pricingScenarioAttempts; attempt += 1) {
        try {
          run.attempts = attempt;
          log(`Pricing step: ${scenario.field}${attempt > 1 ? ` (retry ${attempt})` : ''}`);
          await waitForCoverageControls();
          await setCoverageTemplate(scenario.template, true);
          await setHomeAutoDiscount(scenario.autoDiscount, true);
          await applyCoverageDefaults();
          const price = await recalculateAndCapturePrice(lastAmount, scenario.autoDiscount);
          const amount = price.totalWithFees || price.termPremium || '';
          lastPrice = price;

          if (!price.valid || !amount) throw new Error(price.reason || 'price not found');
          const templateKey = scenario.template.toLowerCase();
          if (scenario.autoDiscount && amountsByTemplate[templateKey] === amount) {
            throw new Error('auto discount premium did not change after recalculation');
          }
          rowUpdates[scenario.field] = amount;
          run.ok = true;
          run.amount = amount;
          run.error = '';
          lastAmount = amount;
          if (!scenario.autoDiscount) amountsByTemplate[templateKey] = amount;
          autoDiscountSeen = autoDiscountSeen || scenario.autoDiscount;
          log(`${scenario.field}: ${amount}`);
          break;
        } catch (err) {
          run.error = err?.message || String(err);
          if (attempt < CFG.pricingScenarioAttempts && shouldRetryPricingScenario(run.error)) {
            log(`Retrying ${scenario.field}: ${run.error}`);
            await waitForCoverageControls(CFG.discountControlWaitMs * 2);
            continue;
          }
          log(`Skipped ${scenario.field}: ${run.error}`);
          break;
        }
      }

      runs.push(run);
    }

    return { rowUpdates, runs, lastPrice, autoDiscountSeen };
  }

  async function clearInitialHomeAutoDiscount() {
    log('Preflight: checking Home/Auto discount before first recalculation');
    await setHomeAutoDiscount(false, true);
  }

  async function applyCoverageDefaults() {
    await setMatSelectByAria('Policy deductibles-All perils-', '$5,000', false);
    await setMatSelectByAria('Policy deductibles-Split water-', '(5.0%)', false);
  }

  async function recalculateAndCapturePrice(previousAmount = '', targetAutoDiscount = false) {
    const before = capturePrice();
    const beforeAmount = previousAmount || before.totalWithFees || before.termPremium || '';
    const start = Date.now();
    let nextNudgeAt = start + CFG.recalcNudgeMs;
    let lastRecalcClickAt = 0;
    if (await clickRecalculateIfAvailable(CFG.recalcWaitMs)) {
      lastRecalcClickAt = Date.now();
      nextNudgeAt = lastRecalcClickAt + CFG.recalcNudgeMs;
    }

    while (Date.now() - start < CFG.priceWaitMs) {
      const price = capturePrice();
      const amount = price.totalWithFees || price.termPremium || '';
      if (price.valid && amount && (!beforeAmount || amount !== beforeAmount)) return price;

      if (isPageBusy()) {
        await sleep(CFG.pollMs);
        continue;
      }
      if (isErrorFixerFlowActive()) {
        await sleep(CFG.pollMs);
        continue;
      }

      const recalc = findRecalculateButton();
      const now = Date.now();
      if (recalc && now - lastRecalcClickAt >= CFG.recalcClickCooldownMs) {
        clickElement(recalc);
        lastRecalcClickAt = now;
        log(`Clicked recalculation CTA: ${normalize(recalc.textContent) || 'button'}`);
        await sleep(CFG.settleMs);
        nextNudgeAt = Date.now() + CFG.recalcNudgeMs;
        continue;
      }

      if (now >= nextNudgeAt) {
        await cycleHomeAutoDiscount(targetAutoDiscount);
        nextNudgeAt = Date.now() + CFG.recalcNudgeMs;
        if (await clickRecalculateIfAvailable(CFG.recalcRetryWaitMs)) {
          lastRecalcClickAt = Date.now();
          nextNudgeAt = lastRecalcClickAt + CFG.recalcNudgeMs;
        }
      }

      await sleep(CFG.pollMs);
    }

    const current = capturePrice();
    const currentAmount = current.totalWithFees || current.termPremium || '';
    if (beforeAmount && currentAmount === beforeAmount) {
      return {
        ...current,
        valid: false,
        reason: `premium stayed ${currentAmount || 'unchanged'} after ${Math.round(CFG.priceWaitMs / 1000)}s`
      };
    }
    if (current.valid && currentAmount) {
      log('Premium wait timed out; using current price');
    }
    return current;
  }

  async function clickRecalculateIfAvailable(waitMs = CFG.recalcWaitMs) {
    const cta = await waitFor(() => findRecalculateButton(), waitMs).catch(() => null);
    if (cta) {
      clickElement(cta);
      log(`Clicked recalculation CTA: ${normalize(cta.textContent) || 'button'}`);
      await sleep(1500);
      return true;
    }

    const quoteCta = document.querySelector('button[data-test-id="TUI_REVIEW_COVERAGE_CARD_CTA"]');
    const label = normalize(quoteCta?.textContent);
    log(label && /^go$/i.test(label)
      ? 'Recalculate button not available; leaving Go alone'
      : 'Recalculate button not available; reading current price');
    return false;
  }

  async function cycleHomeAutoDiscount(targetEnabled) {
    const first = !targetEnabled;
    log(`Recalculate still unavailable; cycling Home/Auto discount ${first ? 'on' : 'off'} then ${targetEnabled ? 'on' : 'off'}`);
    const firstChanged = await setHomeAutoDiscount(first, false);
    if (!firstChanged) {
      log('Home/Auto discount control unavailable during nudge; continuing price wait');
      return false;
    }
    await sleep(700);
    const targetChanged = await setHomeAutoDiscount(targetEnabled, false);
    if (!targetChanged) {
      log('Home/Auto discount control unavailable during nudge reset; continuing price wait');
      return false;
    }
    await sleep(700);
    return true;
  }

  function findRecalculateButton() {
    const buttons = [
      document.querySelector('button[data-test-id="TUI_REVIEW_COVERAGE_CARD_CTA"]'),
      document.querySelector('button[data-test-id="ReCalculate_Button"]'),
      ...document.querySelectorAll('button')
    ].filter(Boolean);
    return buttons.find((button) => isVisible(button) && !isDisabled(button) && /^recalculate$/i.test(normalize(button.textContent)));
  }

  async function setHomeAutoDiscount(enabled, required = true) {
    const control = await waitForBundleDiscountControl('Home/Auto', required ? CFG.discountControlWaitMs : 0);
    if (!control) {
      if (!enabled) {
        log('Home/Auto discount control not found; capturing no-auto price');
        return true;
      }
      if (required) throw new Error('Home/Auto discount control not found');
      log('Skipped missing Home/Auto discount control');
      return false;
    }

    const current = getToggleState(control);
    if (current === enabled) {
      log(`Home/Auto discount already ${enabled ? 'on' : 'off'}`);
      return true;
    }
    if (current == null && !enabled && !isToggleLikelyChecked(control)) {
      log('Home/Auto discount state unknown; no checked marker found, treating as off');
      return true;
    }

    clickElement(findClickableToggle(control));
    await sleep(500);
    const after = getToggleState(control);
    if (after === enabled || (after == null && !enabled && !isToggleLikelyChecked(control))) {
      log(`Home/Auto discount set ${enabled ? 'on' : 'off'}`);
      return true;
    }

    const message = `Home/Auto discount did not switch ${enabled ? 'on' : 'off'}`;
    if (!required) {
      log(`${message}; continuing without nudge`);
      return false;
    }
    throw new Error(message);
  }

  function findBundleDiscountControl(label) {
    const wantedId = `BUNDLE_DISCOUNT_${label}`;
    const direct = document.querySelector(`[data-test-id="${cssAttr(wantedId)}"]`) ||
      [...document.querySelectorAll('[data-test-id]')].find((el) => normalize(el.getAttribute('data-test-id')).includes(wantedId));
    if (direct) return direct;

    const labelRe = /home\s*(?:\/\s*)?auto/i;
    const candidates = [...document.querySelectorAll('mat-checkbox, mat-slide-toggle, label, [role="checkbox"], [role="switch"]')]
      .filter((el) => !state.panel?.contains?.(el) && isVisible(el) && labelRe.test(normalize(el.textContent)));
    for (const candidate of candidates) {
      const root = candidate.closest?.('mat-checkbox, mat-slide-toggle, .mat-mdc-checkbox, .mat-checkbox, [role="checkbox"], [role="switch"], .row, [class*="discount"]') || candidate;
      if (root && hasToggleControl(root) && labelRe.test(normalize(root.textContent || candidate.textContent))) return root;
    }
    return null;
  }

  function hasToggleControl(root) {
    if (!root) return false;
    const selector = 'mat-checkbox, mat-slide-toggle, input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="switch"], .mat-mdc-checkbox-touch-target, .mat-checkbox-inner-container, .mdc-checkbox';
    return !!(root.matches?.(selector) || root.querySelector?.(selector));
  }

  async function waitForBundleDiscountControl(label, timeoutMs = CFG.discountControlWaitMs) {
    const immediate = findBundleDiscountControl(label);
    if (immediate || !timeoutMs) return immediate;
    return waitFor(() => {
      if (isErrorFixerFlowActive() || isPageBusy()) return null;
      return findBundleDiscountControl(label);
    }, timeoutMs).catch(() => null);
  }

  async function waitForCoverageControls(timeoutMs = CFG.discountControlWaitMs) {
    if (isErrorFixerFlowActive()) {
      log('Error fixer active; waiting for coverage controls');
    }
    const control = await waitForBundleDiscountControl('Home/Auto', timeoutMs);
    return !!control;
  }

  function shouldRetryPricingScenario(message) {
    return /home\/auto discount control|timed out waiting|premium stayed|price not found|placeholder|score error/i.test(normalize(message));
  }

  function findClickableToggle(control) {
    return control.querySelector('label, .mat-mdc-checkbox-touch-target, [role="checkbox"], [role="switch"], button, input[type="checkbox"], input[type="radio"]') || control;
  }

  function getToggleState(control) {
    const input = control.matches?.('input[type="checkbox"], input[type="radio"]')
      ? control
      : control.querySelector('input[type="checkbox"], input[type="radio"]');
    if (input) return !!input.checked;

    const aria = control.getAttribute('aria-checked') || control.querySelector('[aria-checked]')?.getAttribute('aria-checked');
    if (/^(true|false)$/i.test(String(aria || ''))) return /^true$/i.test(aria);

    if (isToggleLikelyChecked(control)) return true;
    return null;
  }

  function isToggleLikelyChecked(control) {
    if (!control) return false;
    const checkedSelector = [
      '.mat-mdc-checkbox-checked',
      '.mat-checkbox-checked',
      '.mdc-checkbox--selected',
      '[aria-checked="true"]',
      'input[type="checkbox"]:checked',
      'input[type="radio"]:checked'
    ].join(',');
    if (control.matches?.(checkedSelector) || control.querySelector?.(checkedSelector)) return true;

    const clickable = findClickableToggle(control);
    const classes = `${control.className || ''} ${clickable?.className || ''}`;
    return /\b(mat-mdc-checkbox-checked|mat-checkbox-checked|mdc-checkbox--selected)\b/i.test(classes);
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
    const valid = !!(totalWithFees || termPremium) && !hasPlaceholder;
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
      submissionNumber: captureSubmissionNumber(),
      template: normalize(document.querySelector('mat-select[formfieldmodifiedsegmentreporter="coverage_template"]')?.textContent),
      allPerils: currentSelectValue('Policy deductibles-All perils-'),
      splitWater: currentSelectValue('Policy deductibles-Split water-'),
      payPlan: normalize(document.querySelector('[data-test-id="TUI_REVIEW_COVERAGE_PAYPLAN_VALUE"]')?.textContent),
      policyStartDate: normalize(document.querySelector('[data-test-id="TUI_REVIEW_COVERAGE_POLICY_DATE_VALUE"]')?.textContent),
      autoDiscount: detectAutoDiscount()
    };
  }

  function captureSubmissionNumber() {
    const candidates = [
      ...document.querySelectorAll('.tui-caption-text, [class*="caption"], span, div')
    ];
    for (const el of candidates) {
      const text = normalize(el.textContent);
      const match = text.match(/\bAlta\s*#\s*([A-Za-z0-9-]+)/i);
      if (match) return match[1];
    }
    const text = normalize(document.body.textContent);
    const match = text.match(/\bAlta\s*#\s*([A-Za-z0-9-]+)/i);
    return match ? match[1] : '';
  }

  function detectAutoDiscount() {
    const direct = normalize(document.querySelector('[data-test-id*="AUTO"][data-test-id*="DISCOUNT"], [data-test-id*="Auto"][data-test-id*="Discount"]')?.textContent);
    if (direct) return direct;

    const text = normalize(document.body.textContent);
    const match = text.match(/auto\s+discount\s*[:\-]?\s*(yes|no|applied|not applied|\$?\s*\d[\d,.]*%?)/i);
    return match ? normalize(match[1]) : 'No';
  }

  function currentSelectValue(ariaLabel) {
    const select = findMatSelectByAria(ariaLabel);
    return normalize(select?.querySelector('.mat-mdc-select-min-line')?.textContent || select?.textContent || '');
  }

  function money(text) {
    const candidates = moneyCandidates(text);
    return candidates[0] || '';
  }

  function moneyCandidates(text) {
    const value = normalize(text);
    const matches = value.match(/\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})|\$?\s*\d+(?:\.\d{2})/g) || [];
    return matches
      .map(normalizeMoney)
      .filter(Boolean);
  }

  function normalizeMoney(token) {
    const digits = normalize(token).replace(/\$/g, '').replace(/\s+/g, '');
    if (!/\d/.test(digits)) return '';
    return digits;
  }

  function updatePayload(rowUpdates, progressUpdates, ready, extraMeta) {
    const old = readJson(KEYS.payload) || {};
    const job = readJob();
    const waterDevice = normalize(rowUpdates?.['Water Device?']) || waterDeviceAnswer(job);
    const row = {
      ...defaultRow(job),
      ...(old.row || {}),
      ...rowUpdates,
      'Water Device?': waterDevice
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

  function waterDeviceAnswer(job = readJob()) {
    const decision = readJson(KEYS.waterDeviceDecision);
    const currentAzId = normalize(job['AZ ID'] || job.ticketId || job.azId || '');
    const decisionAzId = normalize(decision?.azId || '');
    return decision?.added === true && currentAzId && decisionAzId === currentAzId ? 'Yes' : 'No';
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
      ['alta-home-coverage-pause', 'Pause Auto'],
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
    state.panel.querySelector('#alta-home-coverage-pause')?.addEventListener('click', togglePause);
    state.panel.querySelector('#alta-home-coverage-run')?.addEventListener('click', () => {
      state.lastAutoKey = autoPageKey();
      startRun({ publish: true });
    });
    state.panel.querySelector('#alta-home-coverage-capture')?.addEventListener('click', () => {
      state.lastAutoKey = autoPageKey();
      startRun({ publish: false });
    });
    state.panel.querySelector('#alta-home-coverage-copy')?.addEventListener('click', copyLogs);
    makeDraggable(state.panel, KEYS.panelPos);
    updatePauseButton();
  }

  function panelCss(id) {
    return `#${id}-panel{position:fixed;right:14px;bottom:14px;width:330px;z-index:2147483647;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;font-family:Arial,sans-serif;font-size:12px;box-shadow:0 10px 28px rgba(0,0,0,.35)}#${id}-panel header{display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #374151;cursor:move}#${id}-panel main{padding:8px 10px}#${id}-panel button{border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;padding:6px 8px;cursor:pointer;margin:0 6px 6px 0}#${id}-panel button:last-child{background:#374151}.hb-status{color:#d1d5db;margin-bottom:8px}.hb-log{white-space:pre-wrap;max-height:160px;overflow:auto;background:#030712;border:1px solid #374151;border-radius:6px;padding:6px;color:#d1d5db}`;
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
    try { el.scrollIntoView?.({ block: 'center', inline: 'nearest' }); } catch {}
    try { el.focus?.({ preventScroll: true }); } catch {}

    const win = el.ownerDocument?.defaultView || window;
    const rect = el.getBoundingClientRect?.();
    const clientX = rect ? rect.left + (rect.width / 2) : 0;
    const clientY = rect ? rect.top + (rect.height / 2) : 0;
    const mouseBase = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: win,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button: 0
    };
    const fireMouse = (type, extra = {}) => {
      try {
        return el.dispatchEvent(new (win.MouseEvent || MouseEvent)(type, { ...mouseBase, ...extra }));
      } catch {
        return false;
      }
    };
    const firePointer = (type, extra = {}) => {
      const PointerEventCtor = win.PointerEvent || window.PointerEvent;
      if (!PointerEventCtor) return false;
      try {
        return el.dispatchEvent(new PointerEventCtor(type, {
          ...mouseBase,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          ...extra
        }));
      } catch {
        return false;
      }
    };

    try {
      firePointer('pointerover', { buttons: 0 });
      fireMouse('mouseover', { buttons: 0 });
      firePointer('pointermove', { buttons: 0 });
      fireMouse('mousemove', { buttons: 0 });
      firePointer('pointerdown', { buttons: 1 });
      fireMouse('mousedown', { buttons: 1 });
      firePointer('pointerup', { buttons: 0 });
      fireMouse('mouseup', { buttons: 0 });
      el.click();
      return true;
    } catch {}

    firePointer('pointerup', { buttons: 0 });
    fireMouse('mouseup', { buttons: 0 });
    return fireMouse('click', { buttons: 0 });
  }

  function isDisabled(el) {
    return !!el?.disabled || el?.getAttribute?.('aria-disabled') === 'true' || el?.classList?.contains('disabled');
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  function findByText(selector, text) {
    const wanted = normalize(text).toLowerCase();
    return [...document.querySelectorAll(selector)].find((el) => normalize(el.textContent).toLowerCase().includes(wanted));
  }

  function isHomeCoverageReady() {
    const pageMarker = document.querySelector('mat-select[formfieldmodifiedsegmentreporter="coverage_template"]') ||
      document.querySelector('#quoteCardCoverageCard') ||
      findByText('h1,h2,.pageTitle,.tui-subtitle', 'Home coverage');
    return !!pageMarker &&
      (!document.querySelector('.sidenav-current-step') || isCurrentSideNavStep('Home coverage'));
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

  function cssAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
})();
