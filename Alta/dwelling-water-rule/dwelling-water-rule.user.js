// ==UserScript==
// @name         GWPC Dwelling Water Rule
// @namespace    homebot.dwelling-water-rule
// @version      3.9.5
// @description  Dwelling step with Submission (Draft) gate, optional Get Location Reports, optional Create Valuation, optional Plumbing Replaced field, Year Built water-device rule, one 360Value retry if Quote stays on Dwelling, active heartbeat, and success recovery after header move.
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/dwelling-water-rule/dwelling-water-rule.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/dwelling-water-rule/dwelling-water-rule.user.js
// ==/UserScript==

(function () {
  'use strict';

  try { window.__HB_DWELLING_WATER_RULE_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'GWPC Dwelling Water Rule';
  const VERSION = '3.9.5';

  // Log-export integration — matches storage-tools.user.js discovery rules.
  const LOG_PERSIST_KEY = 'tm_pc_dwelling_water_rule_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';
  const FLOW_STAGE_KEY = 'tm_pc_flow_stage_v1';
  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';
  const PANEL_POS_KEY = 'tm_pc_dwelling_water_rule_panel_pos_v1';
  const SCRIPT_ACTIVITY_KEY = 'tm_ui_script_activity_v1';
  const SCRIPT_ID = 'dwelling-water-rule';

  const CFG = {
    tickMs: 900,
    clickPauseMs: 400,
    beforeRunDelayMs: 2000,
    fieldWaitMs: 25000,
    optionalFieldWaitMs: 2500,
    fieldsWaitAfterCreateMs: 30000,
    afterLocationReportsMs: 3000,
    afterCreateValuationClickMs: 5000,
    beforeQuoteWaitMs: 5000,
    afterQuoteWaitMs: 10000,
    afterGarageFixMs: 1200,
    garageErrorWaitMs: 7000,
    maxCreateAttempts: 3,
    tabNudgeCooldownMs: 1500,
    tabNudgeSettleMs: 2500,
    maxLogLines: 14,
    panelRight: 12,
    panelBottom: 12,
    zIndex: 2147483647
  };

  const REQUIRED_LABELS = ['Submission (Draft)', 'Homeowners'];
  const HEADER_STUCK_EXACT = 'Dwelling';

  const IDS = {
    createWrap:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-VRsikDV-createvaluation2',

    poolNo:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-SwimmingPool_1',

    solarNo:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-SolarPanels_1',

    trampolineNo:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-Trampoline_1',

    plumbingReplacedNo:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-PlmbngRplcdInLast20YrsNB_Ext_1'
  };

  const NAMES = {
    plumbing:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-PlumbingSystem',

    water:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-HoWaterProtectionDevice',

    yearBuilt:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-YearBuilt',

    garageType:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-GarageType'
  };

  const state = {
    running: true,
    busy: false,
    destroyed: false,
    done: false,
    createAttempts: 0,
    lastQuoteClickAt: 0,
    logs: [],
    intervalId: null,
    heartbeatIntervalId: null,
    logsIntervalTimer: null,
    panel: null,
    statusEl: null,
    logEl: null,
    btn: null,
    styleEl: null,
    lastTabNudgeAt: 0,
    quoteRetryUsed: false,
    activityState: 'idle',
    activityMessage: 'Armed'
  };

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function readCurrentAzId() {
    const job = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    return normalizeText(job?.['AZ ID'] || '');
  }

  function readFlowStage() {
    const stage = safeJsonParse(localStorage.getItem(FLOW_STAGE_KEY), null);
    return stage && typeof stage === 'object' && !Array.isArray(stage) ? stage : {};
  }

  function matchesStage(product, step) {
    const stage = readFlowStage();
    if (normalizeText(stage.product) !== product || normalizeText(stage.step) !== step) return false;
    if (!normalizeText(stage.azId)) return true;
    return normalizeText(stage.azId) === readCurrentAzId();
  }

  function writeFlowStage(product, step) {
    const next = {
      product,
      step,
      azId: readCurrentAzId(),
      updatedAt: new Date().toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    try { localStorage.setItem(FLOW_STAGE_KEY, JSON.stringify(next, null, 2)); } catch {}
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    if (state.logEl) state.logEl.textContent = state.logs.join('\n');
    persistLogsThrottled();
    console.log(`${SCRIPT_NAME}: ${msg}`);
  }

  function persistLogsThrottled() {
    if (state.destroyed) return;
    const now = Date.now();
    if (now - _lastLogPersistAt < LOG_PERSIST_THROTTLE_MS) return;
    _lastLogPersistAt = now;
    const raw = Array.isArray(state.logs) ? state.logs : [];
    const lines = raw.map(entry => (typeof entry === 'string' ? entry : (entry?.line || '')));
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      origin: location.origin,
      updatedAt: new Date().toISOString(),
      lines
    };
    try { localStorage.setItem(LOG_PERSIST_KEY, JSON.stringify(payload)); } catch {}
    try { if (typeof GM_setValue === 'function') GM_setValue(LOG_PERSIST_KEY, payload); } catch {}
  }

  function checkLogClearRequest() {
    if (state.destroyed) return;
    let req = null;
    try { req = JSON.parse(localStorage.getItem(LOG_CLEAR_SIGNAL_KEY) || 'null'); } catch {}
    if (!req) {
      try { if (typeof GM_getValue === 'function') req = GM_getValue(LOG_CLEAR_SIGNAL_KEY, null); } catch {}
    }
    const at = typeof req?.requestedAt === 'string' ? req.requestedAt : '';
    if (!at || at === _lastLogClearHandledAt) return;
    _lastLogClearHandledAt = at;
    state.logs.length = 0;
    _lastLogPersistAt = 0;
    if (state.logEl) state.logEl.textContent = '';
    persistLogsThrottled();
  }

  function handleLogClearStorageEvent(event) {
    if (!event || event.key !== LOG_CLEAR_SIGNAL_KEY) return;
    checkLogClearRequest();
  }

  function logsTick() {
    if (state.destroyed) return;
    persistLogsThrottled();
    checkLogClearRequest();
  }

  function setStatus(msg) {
    if (state.statusEl) state.statusEl.textContent = msg;
  }

  function readScriptActivityMap() {
    return safeJsonParse(localStorage.getItem(SCRIPT_ACTIVITY_KEY), {}) || {};
  }

  function writeScriptActivityMap(nextMap) {
    try { localStorage.setItem(SCRIPT_ACTIVITY_KEY, JSON.stringify(nextMap, null, 2)); } catch {}
  }

  function writeActivityState(nextState, message = '') {
    state.activityState = normalizeText(nextState).toLowerCase() || 'idle';
    state.activityMessage = normalizeText(message) || state.activityMessage || '';

    const current = readScriptActivityMap();
    current[SCRIPT_ID] = {
      scriptId: SCRIPT_ID,
      state: state.activityState,
      updatedAt: new Date().toISOString(),
      message: state.activityMessage,
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeScriptActivityMap(current);
  }

  function refreshActiveHeartbeat() {
    if (state.activityState !== 'active') return;
    writeActivityState('active', state.activityMessage);
  }

  function q(sel, root = document) {
    try { return root.querySelector(sel); } catch { return null; }
  }

  function byId(id) {
    try { return document.getElementById(id); } catch { return null; }
  }

  function escAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function byName(name, tag = '') {
    return q(`${tag || ''}[name="${escAttr(name)}"]`);
  }

  function getTitleBarText() {
    return q('.gw-TitleBar--title')?.textContent?.trim() || '';
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect?.();
      if (!r || r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (el.closest?.('[aria-hidden="true"]')) return false;
      return true;
    } catch {
      return false;
    }
  }

  function hasLabelExact(txt) {
    return Array.from(document.querySelectorAll('.gw-label'))
      .some(el => (el.textContent || '').trim() === txt && isVisible(el));
  }

  function isDwellingHere() {
    if (getTitleBarText() === 'Dwelling') return true;
    if (byId(IDS.createWrap)) return true;
    if (byName(NAMES.yearBuilt, 'input')) return true;
    return false;
  }

  function gateOk() {
    return matchesStage('home', 'dwelling') && REQUIRED_LABELS.every(hasLabelExact) && isDwellingHere();
  }

  function stageReadyForDwelling() {
    if (!REQUIRED_LABELS.every(hasLabelExact)) return false;
    return matchesStage('home', 'dwelling') || getTitleBarText() === 'Dwelling';
  }

  function scrollFocus(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {
      try { el.focus(); } catch {}
    }
  }

  function strongClick(el) {
    try {
      el.scrollIntoView?.({ block: 'center', inline: 'center' });
      el.focus?.({ preventScroll: true });
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.click?.();
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  function findActionByText(text) {
    const want = normalizeText(text).toLowerCase();
    if (!want) return null;

    const candidates = Array.from(document.querySelectorAll('.gw-action--inner, [role="tab"], [role="menuitem"], .gw-TabWidget, .gw-label'));
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const value = normalizeText(el.getAttribute?.('aria-label') || el.textContent || '').toLowerCase();
      if (!value || !value.includes(want)) continue;

      let cur = el;
      for (let i = 0; i < 8 && cur; i++, cur = cur.parentElement) {
        if (!isVisible(cur)) continue;
        if (cur.matches?.('.gw-action--inner, [role="tab"], [role="menuitem"], .gw-TabWidget, button, a')) {
          return cur;
        }
      }

      return el;
    }

    return null;
  }

  function nudgeDwellingTabIfNeeded() {
    if (!stageReadyForDwelling() || isDwellingHere()) return false;
    if ((Date.now() - state.lastTabNudgeAt) < CFG.tabNudgeCooldownMs) return false;

    const target = findActionByText('Dwelling');
    if (!target) return false;

    state.lastTabNudgeAt = Date.now();
    strongClick(target);
    log('Clicked Dwelling tab helper');
    return true;
  }

  function dispatchChange(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch {}
  }

  async function waitFor(fn, timeoutMs, label) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!state.running) throw new Error('Stopped');
      const result = fn();
      if (result) return result;
      await sleep(250);
    }
    throw new Error(`Timeout waiting for ${label}`);
  }

  async function waitForOptional(fn, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!state.running) return null;
      const result = fn();
      if (result) return result;
      await sleep(250);
    }
    return null;
  }

  function fieldsReady() {
    return !!(
      byId(IDS.poolNo) &&
      byId(IDS.solarNo) &&
      byId(IDS.trampolineNo) &&
      byName(NAMES.plumbing, 'select') &&
      byName(NAMES.yearBuilt, 'input')
    );
  }

  function getCreateTargets() {
    const wrap = byId(IDS.createWrap);
    if (!wrap) return [];

    const exactRoleBtn = q(
      `#${CSS.escape(IDS.createWrap)} > div.gw-action--inner.gw-hasDivider[role="button"]`
    );
    const roleBtn = wrap.querySelector('div.gw-action--inner.gw-hasDivider[role="button"]');
    const inner = wrap.querySelector('div.gw-action--inner.gw-hasDivider');
    const label = wrap.querySelector('[aria-label="Create Valuation"], .gw-label');

    return [exactRoleBtn, roleBtn, inner, label, wrap].filter(Boolean);
  }

  function getBestCreateTarget() {
    return getCreateTargets()[0] || null;
  }

  function hasCreateValuationButton() {
    return !!getBestCreateTarget();
  }

  function hasConfirmRiskAddressPrompt() {
    return Array.from(document.querySelectorAll('.gw-VerbatimWidget--inner'))
      .some(el => normalizeText(el.textContent) === 'Confirm Risk Address. Then click "Get Location Reports" to proceed.' && isVisible(el));
  }

  function getLocationReportTargets() {
    const exact = Array.from(document.querySelectorAll('.gw-action--inner[role="button"], .gw-label'))
      .filter(el => isVisible(el) && normalizeText(el.getAttribute?.('aria-label') || el.textContent) === 'Get Location Reports');

    if (exact.length) return exact;

    const fallback = findActionByText('Get Location Reports');
    return fallback ? [fallback] : [];
  }

  async function clickGetLocationReportsIfNeeded() {
    if (!hasConfirmRiskAddressPrompt()) return false;

    const targets = getLocationReportTargets();
    if (!targets.length) {
      log('Confirm Risk Address prompt found but Get Location Reports button was not found');
      return false;
    }

    for (const el of targets) {
      const txt = normalizeText(el.textContent || el.getAttribute?.('aria-label') || '');
      log(`Trying Get Location Reports -> ${txt || el.tagName.toLowerCase()}`);
      if (!strongClick(el)) continue;
      await sleep(CFG.afterLocationReportsMs);
      log('Clicked Get Location Reports and waited 3s');
      return true;
    }

    log('Get Location Reports click did not succeed');
    return false;
  }

  async function clickCreateValuation() {
    await clickGetLocationReportsIfNeeded();
    const el = getBestCreateTarget();

    if (!el) {
      log('Create Valuation not available. Going straight to fill');
      return false;
    }

    const txt = normalizeText(el.textContent || el.getAttribute?.('aria-label') || '');
    const tag = el.tagName.toLowerCase();
    const cls = String(el.className || '').trim().replace(/\s+/g, '.');
    log(`Trying Create Valuation -> ${tag}${cls ? '.' + cls : ''}${txt ? ` [${txt}]` : ''}`);

    if (!strongClick(el)) {
      log('Create Valuation click did not succeed');
      return false;
    }

    log('Clicked Create Valuation once');
    log('Waiting 5s after Create Valuation click');
    await sleep(CFG.afterCreateValuationClickMs);

    if (fieldsReady()) {
      log('Dwelling fields appeared after Create Valuation');
    } else {
      log('Dwelling fields not ready yet after 5s wait');
    }

    return true;
  }

  async function ensureRadioChecked(id, label) {
    const el = await waitFor(() => byId(id), CFG.fieldWaitMs, label);

    if (el.checked) {
      log(`${label} already set`);
      return;
    }

    strongClick(el);
    await sleep(CFG.clickPauseMs);

    if (!el.checked) {
      try { el.checked = true; } catch {}
      dispatchChange(el);
      await sleep(CFG.clickPauseMs);
    }

    if (!el.checked) throw new Error(`Could not set ${label}`);
    log(`${label} set`);
  }

  async function ensureRadioCheckedOptional(id, label) {
    const el = await waitForOptional(() => byId(id), CFG.optionalFieldWaitMs);

    if (!el) {
      log(`${label} missing. Continuing`);
      return false;
    }

    if (el.checked) {
      log(`${label} already set`);
      return true;
    }

    strongClick(el);
    await sleep(CFG.clickPauseMs);

    if (!el.checked) {
      try { el.checked = true; } catch {}
      dispatchChange(el);
      await sleep(CFG.clickPauseMs);
    }

    if (!el.checked) {
      log(`${label} found but not set. Continuing`);
      return false;
    }

    log(`${label} set`);
    return true;
  }

  async function ensureSelectValue(name, value, label) {
    const el = await waitFor(() => byName(name, 'select'), CFG.fieldWaitMs, label);

    if (el.value === value) {
      log(`${label} already set`);
      return;
    }

    scrollFocus(el);
    el.value = value;
    dispatchChange(el);
    await sleep(CFG.clickPauseMs);

    if (el.value !== value) {
      const opt = [...el.options].find(o => o.value === value);
      if (!opt) throw new Error(`${label} option not found: ${value}`);
      opt.selected = true;
      el.value = value;
      dispatchChange(el);
      await sleep(CFG.clickPauseMs);
    }

    if (el.value !== value) throw new Error(`Failed setting ${label}`);
    log(`${label} set`);
  }

  async function ensureSelectValueOptional(name, value, label) {
    const el = await waitForOptional(() => byName(name, 'select'), CFG.optionalFieldWaitMs);

    if (!el) {
      log(`${label} missing. Continuing`);
      return false;
    }

    if (el.value === value) {
      log(`${label} already set`);
      return true;
    }

    scrollFocus(el);
    el.value = value;
    dispatchChange(el);
    await sleep(CFG.clickPauseMs);

    if (el.value !== value) {
      const opt = [...el.options].find(o => o.value === value);
      if (!opt) {
        log(`${label} option not found. Continuing`);
        return false;
      }
      opt.selected = true;
      el.value = value;
      dispatchChange(el);
      await sleep(CFG.clickPauseMs);
    }

    if (el.value !== value) {
      log(`${label} not set. Continuing`);
      return false;
    }

    log(`${label} set`);
    return true;
  }

  async function getYearBuiltWait() {
    const el = await waitFor(() => byName(NAMES.yearBuilt, 'input'), CFG.fieldWaitMs, 'Year Built input');
    const start = Date.now();

    while (Date.now() - start < CFG.fieldWaitMs) {
      const raw = String(el.value || '').trim();
      const match = raw.match(/\d{4}/);
      if (match) {
        const year = parseInt(match[0], 10);
        if (Number.isFinite(year)) return year;
      }
      await sleep(250);
    }

    throw new Error('Year Built value not found');
  }

  function headerStillDwelling() {
    const titles = Array.from(document.querySelectorAll('.gw-TitleBar--title')).filter(isVisible);
    return titles.some(t => ((t.textContent || '').trim() === HEADER_STUCK_EXACT));
  }

  function quoteRecentlyClicked() {
    return Date.now() - state.lastQuoteClickAt < 1500;
  }

  function markQuoteClicked() {
    state.lastQuoteClickAt = Date.now();
  }

  function findQuoteCandidates() {
    const out = [];

    const exactInner = q('#SubmissionWizard-Quote > div.gw-action--inner.gw-hasDivider');
    if (exactInner) out.unshift(exactInner);

    const host = byId('SubmissionWizard-Quote');
    if (host) out.unshift(host);

    out.push(...document.querySelectorAll('.gw-label[aria-label="Quote"]'));

    const nextLab = document.querySelector('.gw-label[aria-label="Next"]');
    if (nextLab) {
      let p = nextLab;
      for (let i = 0; i < 10 && p; i++, p = p.parentElement) {
        const qEl = p.querySelector?.('.gw-label[aria-label="Quote"]');
        if (qEl) {
          out.unshift(qEl);
          break;
        }
      }
    }

    return Array.from(new Set(out));
  }

  function upgradeToClickable(el) {
    if (!el) return null;

    if (el.matches?.('.gw-action--inner') && el.getAttribute('aria-disabled') !== 'true' && isVisible(el)) {
      return el;
    }

    if (el.querySelector) {
      const inner = el.querySelector('.gw-action--inner[aria-disabled="false"]');
      if (inner && isVisible(inner)) return inner;
    }

    let p = el;
    for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
      if (p.matches?.('.gw-action--inner') && p.getAttribute('aria-disabled') !== 'true' && isVisible(p)) {
        return p;
      }
    }

    return isVisible(el) ? el : null;
  }

  function clickQuoteOnce() {
    if (quoteRecentlyClicked()) return false;

    const candidates = findQuoteCandidates();
    for (const el of candidates) {
      const target = upgradeToClickable(el);
      if (target && strongClick(target)) {
        markQuoteClicked();
        log('Quote clicked');
        return true;
      }
    }

    log('Quote target not found');
    return false;
  }

  function hasGarageTypeRequiredMessage() {
    const nodes = Array.from(document.querySelectorAll('.gw-message, .gw-message-and-suffix'))
      .filter(isVisible);

    return nodes.some(el => {
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return txt.includes('garage type') && txt.includes('missing required field');
    });
  }

  async function waitForGarageError(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!state.running) return false;
      if (hasGarageTypeRequiredMessage()) return true;
      await sleep(250);
    }
    return false;
  }

  async function setGarageTypeNoneExact() {
    const sel = await waitForOptional(() => byName(NAMES.garageType, 'select'), CFG.optionalFieldWaitMs);

    if (!sel) {
      log('Garage Type select missing');
      return false;
    }

    const opt = [...sel.options].find(o =>
      o.value === 'None' || (o.textContent || '').trim() === 'None'
    );

    if (!opt) {
      log('Garage Type option None not found');
      return false;
    }

    if (sel.value === opt.value) {
      log('Garage Type already set to None');
      return true;
    }

    scrollFocus(sel);

    try { sel.value = opt.value; } catch {}
    opt.selected = true;
    dispatchChange(sel);
    await sleep(CFG.clickPauseMs);

    if (sel.value !== opt.value) {
      try { sel.selectedIndex = opt.index; } catch {}
      try { sel.value = opt.value; } catch {}
      opt.selected = true;
      dispatchChange(sel);
      await sleep(CFG.clickPauseMs);
    }

    const selectedText = sel.options[sel.selectedIndex]?.textContent?.trim() || '';
    const ok = sel.value === opt.value && selectedText === 'None';

    if (!ok) {
      log(`Garage Type did not stick. value="${sel.value}" text="${selectedText}"`);
      return false;
    }

    log(`Garage Type set to None. value="${sel.value}" text="${selectedText}"`);
    return true;
  }

  async function fixGarageTypeIfNeeded() {
    setStatus('Waiting for Garage error');
    const sawError = await waitForGarageError(CFG.garageErrorWaitMs);

    if (!sawError) {
      log('Garage Type required message not found in time');
      return false;
    }

    log('Garage Type required message detected');
    setStatus('Fixing Garage Type');

    const fixed = await setGarageTypeNoneExact();

    if (fixed) {
      await sleep(CFG.afterGarageFixMs);
      return true;
    }

    log('Garage Type fix failed');
    return false;
  }

  async function waitForQuoteTransition() {
    const start = Date.now();
    while (Date.now() - start < CFG.afterQuoteWaitMs) {
      if (!state.running) throw new Error('Stopped');
      if (!headerStillDwelling()) return true;
      await sleep(250);
    }
    return !headerStillDwelling();
  }

  async function clickQuoteAndWaitForTransition() {
    setStatus('Clicking Quote');
    if (!clickQuoteOnce()) throw new Error('Quote target not found');
    setStatus('Waiting for Quote to settle');
    const moved = await waitForQuoteTransition();
    if (moved) {
      log('Quote succeeded');
      return true;
    }
    log('Quote stayed on Dwelling after 10s');
    return false;
  }

  async function fillDwellingFields() {
    await ensureRadioChecked(IDS.poolNo, 'Swimming Pool = No');
    await ensureRadioChecked(IDS.solarNo, 'Solar Panels = No');
    await ensureRadioChecked(IDS.trampolineNo, 'Trampoline = No');
    await ensureSelectValue(NAMES.plumbing, 'copper', 'Plumbing System = Copper');

    await ensureRadioCheckedOptional(
      IDS.plumbingReplacedNo,
      'Plumbing replaced in last 20 years = No'
    );

    const yearBuilt = await getYearBuiltWait();
    log(`Year Built detected: ${yearBuilt}`);

    if (yearBuilt <= 1996) {
      await ensureSelectValueOptional(
        NAMES.water,
        'O',
        'Water Protection Device = Whole House Water Detection and Shutoff'
      );
    } else {
      log('Year Built is 1997 or newer. Water device left unchanged');
    }
  }

  async function rerunAfterStuckQuote() {
    if (state.quoteRetryUsed) return false;
    state.quoteRetryUsed = true;

    log('Dwelling header did not move. Trying one 360Value retry');
    setStatus('Retrying after 360Value');

    const clicked = await clickCreateValuation();
    if (clicked) {
      const start = Date.now();
      while (Date.now() - start < CFG.fieldsWaitAfterCreateMs) {
        if (!state.running) throw new Error('Stopped');
        if (fieldsReady()) break;
        await sleep(300);
      }
    } else {
      log('360Value button not available for retry. Re-running current Dwelling fields');
    }

    if (hasGarageTypeRequiredMessage()) {
      await fixGarageTypeIfNeeded();
    }

    setStatus('Repeating Dwelling one more time');
    await fillDwellingFields();
    return clickQuoteAndWaitForTransition();
  }

  async function quoteFlow() {
    setStatus('Waiting 5s before Quote');
    log('Waiting 5s before Quote');
    await sleep(CFG.beforeQuoteWaitMs);

    let quoteOK = await clickQuoteAndWaitForTransition();
    if (!quoteOK) {
      await fixGarageTypeIfNeeded();
      quoteOK = await rerunAfterStuckQuote();
    }
    if (!quoteOK) throw new Error('Quote click did not move off Dwelling');
  }

  async function fillDwellingFlow() {
    state.quoteRetryUsed = false;
    await fillDwellingFields();
    await quoteFlow();
  }

  function finishDwellingSuccess(message = 'Dwelling step complete') {
    writeFlowStage('home', 'coverages');
    state.done = true;
    writeActivityState('done', 'Dwelling complete');
    setStatus('Done');
    log(message);
  }

  async function waitBeforeDwellingRun() {
    setStatus('Waiting 2s before Dwelling run');
    log('Waiting 2s before Dwelling run');
    await sleep(CFG.beforeRunDelayMs);
    if (!state.running) throw new Error('Stopped');
  }

  async function tick() {
    if (!state.running || state.busy || state.done) return;
    if ((Date.now() - state.lastTabNudgeAt) < CFG.tabNudgeSettleMs) {
      setStatus('Waiting for Dwelling tab to load');
      return;
    }

    if (!stageReadyForDwelling()) {
      setStatus('Waiting for Submission (Draft) + Dwelling');
      return;
    }

    if (!isDwellingHere()) {
      if (nudgeDwellingTabIfNeeded()) {
        setStatus('Opening Dwelling tab');
      } else {
        setStatus('Waiting for Dwelling tab');
      }
      return;
    }

    state.busy = true;
    writeActivityState('active', 'Working Dwelling');
    try {
      await waitBeforeDwellingRun();

      if (!isDwellingHere()) {
        setStatus('Waiting for Dwelling tab');
        return;
      }

      if (fieldsReady()) {
        setStatus('Filling Dwelling');
        await fillDwellingFlow();
        finishDwellingSuccess('Dwelling step complete');
        return;
      }

      if (hasCreateValuationButton()) {
        if (state.createAttempts >= CFG.maxCreateAttempts) {
          setStatus('Failed');
          log('Create Valuation max attempts reached');
          state.done = true;
          writeActivityState('error', 'Create Valuation max attempts reached');
          return;
        }

        setStatus(`Clicking Create Valuation (${state.createAttempts + 1}/${CFG.maxCreateAttempts})`);
        const clicked = await clickCreateValuation();
        state.createAttempts += 1;

        if (clicked) {
          const start = Date.now();
          setStatus('Waiting for Dwelling fields');

          while (Date.now() - start < CFG.fieldsWaitAfterCreateMs) {
            if (!state.running) throw new Error('Stopped');
            if (fieldsReady()) {
              setStatus('Filling Dwelling');
              await fillDwellingFlow();
              finishDwellingSuccess('Dwelling step complete');
              return;
            }
            await sleep(300);
          }

          log('Fields did not appear after Create Valuation');
          return;
        }

        log(`Create attempt ${state.createAttempts}/${CFG.maxCreateAttempts} did not open fields`);
        return;
      }

      log('Create Valuation missing. Going straight to fill');
      setStatus('Filling Dwelling');
      await fillDwellingFlow();
      finishDwellingSuccess('Dwelling step complete');
    } catch (err) {
      if (!headerStillDwelling()) {
        finishDwellingSuccess(`Dwelling header already moved; treating as success after: ${err.message}`);
        return;
      }
      setStatus('Failed');
      log(`Failed: ${err.message}`);
      state.done = true;
      writeActivityState('error', err.message || 'Dwelling failed');
    } finally {
      state.busy = false;
      if (!state.done && state.running) writeActivityState('idle', state.statusEl?.textContent || 'Armed');
    }
  }

  function buildUi() {
    const style = document.createElement('style');
    style.id = 'hb-dwelling-water-rule-style';
    style.textContent = `
      #hb-dwelling-water-rule-panel{
        position:fixed;right:${CFG.panelRight}px;bottom:${CFG.panelBottom}px;width:360px;
        background:#111827;color:#f9fafb;border:1px solid #374151;
        border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:${CFG.zIndex};
        font:12px/1.35 Arial,sans-serif;overflow:hidden;user-select:none
      }
      #hb-dwelling-water-rule-head{
        padding:8px 10px;cursor:move;border-bottom:1px solid #374151;
        background:#0f172a
      }
      #hb-dwelling-water-rule-title{font-weight:700;font-size:12px}
      #hb-dwelling-water-rule-sub{font-size:11px;opacity:.8}
      #hb-dwelling-water-rule-controls{
        display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px
      }
      #hb-dwelling-water-rule-btn,
      #hb-dwelling-water-rule-copy{
        border:0;border-radius:8px;padding:7px 8px;cursor:pointer;font-weight:700;color:#fff
      }
      #hb-dwelling-water-rule-btn{background:#dc2626}
      #hb-dwelling-water-rule-copy{background:#2563eb}
      #hb-dwelling-water-rule-body{padding:8px 10px}
      #hb-dwelling-water-rule-status{
        margin-bottom:8px;padding:6px 8px;border-radius:8px;background:#1f2937
      }
      #hb-dwelling-water-rule-log{
        white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;
        background:#0b1220;border:1px solid #243041;border-radius:8px;padding:8px
      }
    `;
    document.documentElement.appendChild(style);
    state.styleEl = style;

    const panel = document.createElement('div');
    panel.id = 'hb-dwelling-water-rule-panel';
    const saved = loadPanelPos();
    if (saved) {
      panel.style.left = saved.left;
      panel.style.top = saved.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
    panel.innerHTML = `
      <div id="hb-dwelling-water-rule-head">
        <div>
          <div id="hb-dwelling-water-rule-title">${SCRIPT_NAME}</div>
          <div id="hb-dwelling-water-rule-sub">V${VERSION}</div>
        </div>
      </div>
      <div id="hb-dwelling-water-rule-body">
        <div id="hb-dwelling-water-rule-controls">
          <button id="hb-dwelling-water-rule-btn" type="button">STOP</button>
          <button id="hb-dwelling-water-rule-copy" type="button">COPY LOGS</button>
        </div>
        <div id="hb-dwelling-water-rule-status">Starting</div>
        <div id="hb-dwelling-water-rule-log"></div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    state.panel = panel;
    state.statusEl = panel.querySelector('#hb-dwelling-water-rule-status');
    state.logEl = panel.querySelector('#hb-dwelling-water-rule-log');
    state.btn = panel.querySelector('#hb-dwelling-water-rule-btn');
    const head = panel.querySelector('#hb-dwelling-water-rule-head');
    const copyBtn = panel.querySelector('#hb-dwelling-water-rule-copy');

    state.btn.addEventListener('click', () => {
      state.running = !state.running;
      state.btn.textContent = state.running ? 'STOP' : 'START';
      state.btn.style.background = state.running ? '#dc2626' : '#16a34a';

      if (state.running) {
        state.done = false;
        state.createAttempts = 0;
        state.quoteRetryUsed = false;
        writeActivityState('idle', 'Resumed');
        log('Script resumed');
        setStatus('Resumed');
      } else {
        writeActivityState('stopped', 'Stopped');
        log('Script stopped for this page session');
        setStatus('Stopped');
      }
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText([...state.logs].reverse().join('\n'));
        log('Logs copied');
      } catch {
        log('Copy logs failed');
      }
    });

    makeDraggable(panel, head);
  }

  function makeDraggable(panel, handle) {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });

    function onMove(e) {
      if (!dragging) return;
      panel.style.left = `${Math.max(0, startLeft + (e.clientX - startX))}px`;
      panel.style.top = `${Math.max(0, startTop + (e.clientY - startY))}px`;
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      savePanelPos({ left: panel.style.left, top: panel.style.top });
    }
  }

  function savePanelPos(pos) {
    try { localStorage.setItem(PANEL_POS_KEY, JSON.stringify(pos)); } catch {}
  }

  function loadPanelPos() {
    try { return JSON.parse(localStorage.getItem(PANEL_POS_KEY) || 'null'); } catch { return null; }
  }

  function cleanup() {
    state.destroyed = true;
    try { clearInterval(state.intervalId); } catch {}
    try { clearInterval(state.heartbeatIntervalId); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    try { writeActivityState(state.running ? 'idle' : 'stopped', 'Cleanup'); } catch {}
    try { state.panel?.remove?.(); } catch {}
    try { state.styleEl?.remove?.(); } catch {}
    delete window.__HB_DWELLING_WATER_RULE_CLEANUP__;
  }

  function init() {
    buildUi();
    log('Script start');
    setStatus('Armed');
    writeActivityState('idle', 'Armed');

    state.intervalId = setInterval(() => {
      tick().catch(err => {
        setStatus('Failed');
        log(`Tick error: ${err.message}`);
        state.busy = false;
        state.done = true;
        writeActivityState('error', err.message || 'Tick error');
      });
    }, CFG.tickMs);

    state.heartbeatIntervalId = setInterval(() => {
      try { refreshActiveHeartbeat(); } catch {}
    }, 1000);

    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();
  }

  window.__HB_DWELLING_WATER_RULE_CLEANUP__ = cleanup;
  init();
})();
