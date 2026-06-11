// ==UserScript==
// @name         GWPC Disclosure Qualification
// @namespace    homebot.gwpc-disclosure-qualification
// @version      2.3.5
// @description  HOME-only Disclosure & Qualification flow. On Submission (Draft) + Disclosure & Qualification, click Yes if present, accept readonly Yes if already answered, then use DT2 Next click with retry if stuck. Hard stops if Submission (Quoted) appears.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-disclosure-qualification/gwpc-disclosure-qualification.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-disclosure-qualification/gwpc-disclosure-qualification.user.js
// ==/UserScript==

(function () {
  'use strict';

  try { window.__HB_GW_DISCLOSURE_QUAL_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'GWPC Disclosure Qualification';
  const VERSION = '2.3.5';

  // Log-export integration — matches storage-tools.user.js discovery rules.
  const LOG_PERSIST_KEY = 'tm_pc_disclosure_qualification_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  const LOG_MAX_LINES = 140;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';
  let _logs = [];

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    _logs.unshift(line);
    if (_logs.length > LOG_MAX_LINES) _logs.length = LOG_MAX_LINES;
    persistLogsThrottled();
    try { console.log(`[${SCRIPT_NAME}] ${msg}`); } catch {}
  }

  function persistLogsThrottled() {
    const now = Date.now();
    if (now - _lastLogPersistAt < LOG_PERSIST_THROTTLE_MS) return;
    _lastLogPersistAt = now;
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      origin: location.origin,
      updatedAt: new Date().toISOString(),
      lines: _logs.slice()
    };
    try { localStorage.setItem(LOG_PERSIST_KEY, JSON.stringify(payload)); } catch {}
    try { if (typeof GM_setValue === 'function') GM_setValue(LOG_PERSIST_KEY, payload); } catch {}
  }

  function checkLogClearRequest() {
    let req = null;
    try { req = JSON.parse(localStorage.getItem(LOG_CLEAR_SIGNAL_KEY) || 'null'); } catch {}
    if (!req) {
      try { if (typeof GM_getValue === 'function') req = GM_getValue(LOG_CLEAR_SIGNAL_KEY, null); } catch {}
    }
    const at = typeof req?.requestedAt === 'string' ? req.requestedAt : '';
    if (!at || at === _lastLogClearHandledAt) return;
    _lastLogClearHandledAt = at;
    _logs.length = 0;
    _lastLogPersistAt = 0;
    persistLogsThrottled();
  }

  function handleLogClearStorageEvent(event) {
    if (!event || event.key !== LOG_CLEAR_SIGNAL_KEY) return;
    checkLogClearRequest();
  }

  function logsTick() {
    persistLogsThrottled();
    checkLogClearRequest();
  }
  const FLOW_STAGE_KEY = 'tm_pc_flow_stage_v1';
  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';

  const REQUIRED_LABELS = ['Submission (Draft)'];
  const HOME_LABEL = 'Homeowners';
  const PERSONAL_AUTO_LABEL = 'Personal Auto';
  const HARD_STOP_LABEL_QUOTED = 'Submission (Quoted)';
  const TRIGGER_TITLE_STARTS_WITH = 'Disclosure & Qualification';

  const PRIMARY_YES_INPUT_ID =
    'SubmissionWizard-SubmissionWizard_PreQualificationScreen-PreQualQuestionSetsDV-QuestionSetsDV-7-QuestionSetLV-0-QuestionModalInput-BooleanRadioInput_0';
  const PRIMARY_YES_INPUT_NAME =
    'SubmissionWizard-SubmissionWizard_PreQualificationScreen-PreQualQuestionSetsDV-QuestionSetsDV-7-QuestionSetLV-0-QuestionModalInput-BooleanRadioInput';

  const EXTRA_AUTO_YES_IDS = [
    'SubmissionWizard-SubmissionWizard_PreQualificationScreen-PreQualQuestionSetsDV-QuestionSetsDV-3-QuestionSetLV-0-QuestionModalInput-BooleanRadioInput_0',
    'SubmissionWizard-SubmissionWizard_PreQualificationScreen-PreQualQuestionSetsDV-QuestionSetsDV-3-QuestionSetLV-1-QuestionModalInput-BooleanRadioInput_0'
  ];

  const WAIT_BEFORE_FIRST_ACTION_MS = 900;
  const RETRY_AFTER_YES_MS = 300;
  const STUCK_CHECK_WAIT_MS = 3000;
  const MAX_NEXT_ATTEMPTS = 3;

  const NEXT_HOST_ID = 'SubmissionWizard-Next';

  let done = false;
  let running = false;
  let nextAttempts = 0;

  let mo = null;
  let startTimer = null;
  let retryTimer = null;
  let stuckTimer = null;

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function readCurrentAzId() {
    const job = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    return norm(job?.['AZ ID'] || '');
  }

  function readFlowStage() {
    const stage = safeJsonParse(localStorage.getItem(FLOW_STAGE_KEY), null);
    return stage && typeof stage === 'object' && !Array.isArray(stage) ? stage : {};
  }

  function matchesStage(product, step) {
    const stage = readFlowStage();
    if (norm(stage.product) !== product || norm(stage.step) !== step) return false;
    if (!norm(stage.azId)) return true;
    return norm(stage.azId) === readCurrentAzId();
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
    return next;
  }

  function cssEscapeSafe(value) {
    try { return CSS.escape(value); } catch { return String(value).replace(/["\\]/g, '\\$&'); }
  }

  function norm(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function* allDocs() {
    yield document;
    for (const f of document.querySelectorAll('iframe, frame')) {
      try {
        const d = f.contentDocument || f.contentWindow?.document;
        if (d) yield d;
      } catch {}
    }
  }

  function hasLabelExactAnyDoc(txt) {
    for (const doc of allDocs()) {
      const ok = Array.from(doc.querySelectorAll('.gw-label'))
        .some(n => norm(n.textContent) === txt && isVisible(n));
      if (ok) return true;
    }
    return false;
  }

  function gateOK() {
    return REQUIRED_LABELS.every(hasLabelExactAnyDoc);
  }

  function hasPersonalAutoAnyDoc() {
    return hasLabelExactAnyDoc(PERSONAL_AUTO_LABEL);
  }

  function hasHomeownersAnyDoc() {
    return hasLabelExactAnyDoc(HOME_LABEL);
  }

  function getActiveFlow() {
    if (hasPersonalAutoAnyDoc() && !hasHomeownersAnyDoc()) return '';
    if (matchesStage('home', 'disclosure')) return 'home';
    if (titleIsDisclosureAnyDoc()) return 'home';
    return '';
  }

  function hasQuotedAnyDoc() {
    return hasLabelExactAnyDoc(HARD_STOP_LABEL_QUOTED);
  }

  function titleIsDisclosureAnyDoc() {
    const selectors = [
      '.gw-TitleBar--title[role="heading"]',
      '.gw-TitleBar--title',
      '.gw-WizardScreen-title',
      '.gw-Wizard--Title',
      '[role="heading"][aria-level="1"]'
    ];

    for (const doc of allDocs()) {
      for (const sel of selectors) {
        const titles = Array.from(doc.querySelectorAll(sel));
        const ok = titles.some(t => {
          const txt = norm(t.textContent);
          return txt.startsWith(TRIGGER_TITLE_STARTS_WITH) && isVisible(t);
        });
        if (ok) return true;
      }
    }

    return false;
  }

  function dispatchAll(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch {}
  }

  function strongRadioClick(el) {
    if (!el || el.disabled) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {
      try { el.focus(); } catch {}
    }

    try { el.click(); } catch {}
    dispatchAll(el);

    if (!el.checked) {
      try { el.checked = true; } catch {}
      dispatchAll(el);
    }

    return !!el.checked;
  }

  function makeReadonlyIdsFromInputId(inputId) {
    const baseId = String(inputId || '').replace(/_0$/, '');
    return {
      readonlyId: baseId,
      readonlyCellId: `${baseId}_Cell`
    };
  }

  function findQuestionInputById(doc, inputId) {
    try {
      const el = doc.getElementById?.(inputId);
      if (el && isVisible(el)) return el;
    } catch {}
    return null;
  }

  function hasReadonlyYesForInputId(doc, inputId) {
    const ids = makeReadonlyIdsFromInputId(inputId);

    for (const id of [ids.readonlyId, ids.readonlyCellId]) {
      try {
        const el = doc.getElementById?.(id);
        if (!el || !isVisible(el)) continue;

        const txt = norm(el.textContent);
        const ownGwValue = el.getAttribute?.('data-gw-value');
        const nestedTrue = el.querySelector?.('.gw-RangeValue[data-gw-value="true"]');

        if (txt.includes('Yes') || ownGwValue === 'true' || nestedTrue) return true;
      } catch {}
    }

    return false;
  }

  function findPrimaryYesInput(doc) {
    let yes = findQuestionInputById(doc, PRIMARY_YES_INPUT_ID);
    if (yes) return yes;

    try {
      yes = doc.querySelector(`input[type="radio"][name="${cssEscapeSafe(PRIMARY_YES_INPUT_NAME)}"]`);
      if (yes && isVisible(yes)) return yes;
    } catch {}

    try {
      yes = doc.querySelector('input[type="radio"][aria-label="Yes"]');
      if (yes && isVisible(yes)) return yes;
    } catch {}

    return null;
  }

  function ensurePrimaryYesHandled() {
    let sawAnything = false;
    let handled = false;

    for (const doc of allDocs()) {
      const yesInput = findPrimaryYesInput(doc);

      if (yesInput) {
        sawAnything = true;

        if (yesInput.checked) {
          handled = true;
          continue;
        }

        if (strongRadioClick(yesInput)) {
          handled = true;
          continue;
        }
      }

      if (hasReadonlyYesForInputId(doc, PRIMARY_YES_INPUT_ID)) {
        sawAnything = true;
        handled = true;
      }
    }

    return { sawAnything, handled };
  }

  function ensureExtraAutoYesHandled() {
    if (!hasPersonalAutoAnyDoc()) {
      return { required: false, sawAnything: true, handled: true };
    }

    let sawAnything = false;
    let handledAll = true;

    for (const inputId of EXTRA_AUTO_YES_IDS) {
      let questionHandled = false;
      let questionSeen = false;

      for (const doc of allDocs()) {
        const input = findQuestionInputById(doc, inputId);

        if (input) {
          questionSeen = true;
          sawAnything = true;

          if (input.checked) {
            questionHandled = true;
            continue;
          }

          if (strongRadioClick(input)) {
            questionHandled = true;
            continue;
          }
        }

        if (hasReadonlyYesForInputId(doc, inputId)) {
          questionSeen = true;
          sawAnything = true;
          questionHandled = true;
        }
      }

      if (!questionSeen || !questionHandled) {
        handledAll = false;
      }
    }

    return { required: true, sawAnything, handled: handledAll };
  }

  function fireMouse(el, type) {
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    }));
  }

  function clickLikeUser(target) {
    if (!target || !isVisible(target)) return false;

    try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { target.focus({ preventScroll: true }); } catch {
      try { target.focus(); } catch {}
    }

    fireMouse(target, 'pointerover');
    fireMouse(target, 'mouseover');
    fireMouse(target, 'pointerdown');
    fireMouse(target, 'mousedown');
    fireMouse(target, 'pointerup');
    fireMouse(target, 'mouseup');
    fireMouse(target, 'click');

    try { target.click(); } catch {}
    return true;
  }

  function getNextTarget(doc) {
    const host = doc.getElementById(NEXT_HOST_ID);
    if (!host || !isVisible(host)) return null;

    return (
      host.querySelector('.gw-action--inner[aria-disabled="false"]') ||
      host.querySelector('.gw-action--inner') ||
      host.querySelector('.gw-label[aria-label="Next"]') ||
      host
    );
  }

  async function clickNextDt2Once() {
    for (const doc of allDocs()) {
      const target = getNextTarget(doc);
      if (!target || !isVisible(target)) continue;
      clickLikeUser(target);
      await sleep(120);
      return true;
    }

    return false;
  }

  function clearTimers() {
    if (startTimer) clearTimeout(startTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (stuckTimer) clearTimeout(stuckTimer);

    startTimer = null;
    retryTimer = null;
    stuckTimer = null;
  }

  function stopRun() {
    clearTimers();
    running = false;
  }

  function hardFinish() {
    done = true;
    stopRun();

    if (mo) {
      try { mo.disconnect(); } catch {}
      mo = null;
    }

    return true;
  }

  function finalizeIfLeftDisclosure() {
    if (!titleIsDisclosureAnyDoc()) {
      const flow = getActiveFlow();
      if (flow === 'home') writeFlowStage('home', 'policy_info');
      return hardFinish();
    }
    return false;
  }

  function hardStopIfQuoted() {
    if (hasQuotedAnyDoc()) {
      log('Submission (Quoted) detected — hard stop');
      return hardFinish();
    }
    return false;
  }

  function scheduleRetry(ms) {
    if (retryTimer) clearTimeout(retryTimer);

    retryTimer = setTimeout(() => {
      retryTimer = null;
      step();
    }, ms);
  }

  async function step() {
    if (done) return;
    if (hardStopIfQuoted()) return;
    if (finalizeIfLeftDisclosure()) return;

    if (!gateOK()) {
      stopRun();
      return;
    }

    if (!titleIsDisclosureAnyDoc()) {
      stopRun();
      return;
    }

    const primaryYesState = ensurePrimaryYesHandled();
    if (!primaryYesState.sawAnything || !primaryYesState.handled) {
      scheduleRetry(RETRY_AFTER_YES_MS);
      return;
    }

    if (nextAttempts >= MAX_NEXT_ATTEMPTS) {
      return hardFinish();
    }

    const clicked = await clickNextDt2Once();

    if (!clicked) {
      scheduleRetry(RETRY_AFTER_YES_MS);
      return;
    }

    nextAttempts++;

    if (stuckTimer) clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => {
      stuckTimer = null;

      if (done) return;
      if (hardStopIfQuoted()) return;

      if (titleIsDisclosureAnyDoc()) {
        step();
      } else {
        finalizeIfLeftDisclosure();
      }
    }, STUCK_CHECK_WAIT_MS);
  }

  function runSequence() {
    if (done || running) return;
    if (hardStopIfQuoted()) return;
    if (!gateOK()) return;
    if (!getActiveFlow()) return;
    if (!titleIsDisclosureAnyDoc()) return;

    running = true;
    nextAttempts = 0;
    clearTimers();

    startTimer = setTimeout(() => {
      startTimer = null;
      step();
    }, WAIT_BEFORE_FIRST_ACTION_MS);
  }

  function tick() {
    if (done) return;
    if (hardStopIfQuoted()) return;
    const stage = readFlowStage();
    if (!norm(stage.product) && titleIsDisclosureAnyDoc()) {
      if (!hasPersonalAutoAnyDoc() || hasHomeownersAnyDoc()) writeFlowStage('home', 'disclosure');
    }
    runSequence();
  }

  function cleanup() {
    try { stopRun(); } catch {}
    try {
      if (mo) {
        mo.disconnect();
        mo = null;
      }
    } catch {}
    try { delete window.__HB_GW_DISCLOSURE_QUAL_CLEANUP__; } catch {}
  }

  function init() {
    log(`Loaded v${VERSION}`);
    mo = new MutationObserver(tick);
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });

    document.addEventListener('visibilitychange', tick);
    window.addEventListener('pagehide', cleanup);

    setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();

    tick();
  }

  window.__HB_GW_DISCLOSURE_QUAL_CLEANUP__ = cleanup;

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
