// ==UserScript==
// @name         GWPC Policy Info Prefill
// @namespace    homebot.gwpc-policy-info
// @version      2.3.5
// @description  HOME-only Policy Info flow. Keeps the Home Bot Policy Info actions without clicking Home Auto discount, switches Gender to Male if the Non-Binary/Flex error appears, uses DT2 Next retry if stuck, and hard stops if Submission (Quoted) appears.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-policy-info/gwpc-policy-info.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-policy-info/gwpc-policy-info.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = 'GWPC Policy Info Prefill';
  const VERSION = '2.3.5';

  // Log-export integration — matches storage-tools.user.js discovery rules.
  const LOG_PERSIST_KEY = 'tm_pc_policy_info_logs_v1';
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
  const TRIGGER_TITLE_STARTS_WITH = 'Policy Info';
  const PERSONAL_AUTO_LABEL = 'Personal Auto';
  const HARD_STOP_LABEL = 'Submission (Quoted)';
  const POLICY_INFO_TAB_TEXT = 'Policy Info';
  const TAB_NUDGE_COOLDOWN_MS = 1500;
  const TAB_NUDGE_SETTLE_MS = 2500;

  // ----- HOME MODE -----
  const SEL_GENDER =
    'select[name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-Gender_Ext"]';
  const SEL_MARITAL =
    'select[name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-MartialStatus_Ext"]';

  const GENDER_VALUE = 'X';
  const GENDER_FALLBACK_VALUE = 'M';
  const GENDER_FALLBACK_ERROR_TEXT =
    'Non-Binary gender is only available for Farmers Flex products.';
  const MARITAL_VALUE = 'S';

  // ----- AQB MODE -----
  const SEL_AQB_CHECKBOX =
    'input[name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-MultiLineDiscounts_ExtInputSet-MultiLineDiscounts_ExtLV-1-DiscountSelected"]';
  const ID_SIGNAL_NO =
    'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-SignalEnrollPolicyInd_1';
  const SEL_EFFECTIVE_DATE =
    'input[name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-PolicyInfoInputSet-EffectiveDate"]';

  // ----- SHARED -----
  const SEL_ESIGNATURE =
    'input[type="checkbox"][name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-PolicyInfo_PaperlessOptions_ExtInputSet-PaperlessOptionEditMode-ESignature"]';
  const SEL_PAPERLESS_POLICY =
    'input[type="checkbox"][name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-PolicyInfo_PaperlessOptions_ExtInputSet-PaperlessOptionEditMode-PaperlessPolicy"]';

  const RETRY_EVERY_MS = 250;
  const WAIT_BEFORE_NEXT_MS = 2000;
  const STUCK_CHECK_WAIT_MS = 3000;
  const MAX_NEXT_ATTEMPTS = 3;

  const NEXT_HOST_ID = 'SubmissionWizard-Next';

  let armed = true;
  let done = false;
  let running = false;

  let mo = null;
  let workTimer = null;
  let nextTimer = null;
  let stuckTimer = null;
  let lastTabNudgeAt = 0;

  let nextAttempts = 0;

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function readCurrentAzId() {
    const job = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    return normText(job?.['AZ ID'] || '');
  }

  function readFlowStage() {
    const stage = safeJsonParse(localStorage.getItem(FLOW_STAGE_KEY), null);
    return stage && typeof stage === 'object' && !Array.isArray(stage) ? stage : {};
  }

  function matchesStage(product, step) {
    const stage = readFlowStage();
    if (normText(stage.product) !== product || normText(stage.step) !== step) return false;
    if (!normText(stage.azId)) return true;
    return normText(stage.azId) === readCurrentAzId();
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

  function mountToggle() {
    const btn = document.createElement('button');
    btn.textContent = 'HB PI: STOP';
    btn.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:999999;' +
      'border:0;border-radius:10px;padding:8px 12px;' +
      'background:#2f80ed;color:#fff;font:12px/1 system-ui,Segoe UI,Arial;font-weight:700;' +
      'cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25);';

    btn.addEventListener('click', () => {
      armed = !armed;
      btn.textContent = armed ? 'HB PI: STOP' : 'HB PI: START';
      if (!armed) hardStop();
      else tick();
    });

    document.body.appendChild(btn);
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

  function normText(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
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
        .some(n => (n.textContent || '').trim() === txt && isVisible(n));
      if (ok) return true;
    }
    return false;
  }

  function hasTextAnyDoc(txt) {
    const want = normText(txt).toLowerCase();
    if (!want) return false;

    for (const doc of allDocs()) {
      const candidates = Array.from(
        doc.querySelectorAll('.gw-message, .gw-WebMessage, .gw-MessagesWidget, .gw-message-and-suffix')
      );

      for (const el of candidates) {
        const text = normText(el.textContent || '').toLowerCase();
        if (!text) continue;
        if (!isVisible(el) && !isVisible(el.closest?.('.gw-message--displayable') || el.parentElement)) continue;
        if (text.includes(want)) return true;
      }
    }

    return false;
  }

  function gateOK() {
    return REQUIRED_LABELS.every(hasLabelExactAnyDoc);
  }

  function isPersonalAutoMode() {
    return hasLabelExactAnyDoc(PERSONAL_AUTO_LABEL);
  }

  function hasQuotedLabel() {
    return hasLabelExactAnyDoc(HARD_STOP_LABEL);
  }

  function hasHomeownersLabel() {
    return hasLabelExactAnyDoc(HOME_LABEL);
  }

  function getActiveFlow() {
    if (isPersonalAutoMode()) return '';
    if (matchesStage('home', 'policy_info')) return 'home';
    if (titleIsPolicyInfoAnyDoc()) return 'home';
    return '';
  }

  function hasGenderFallbackErrorAnyDoc() {
    return hasTextAnyDoc(GENDER_FALLBACK_ERROR_TEXT);
  }

  function getWantedHomeGenderValue() {
    return hasGenderFallbackErrorAnyDoc() ? GENDER_FALLBACK_VALUE : GENDER_VALUE;
  }

  function titleIsPolicyInfoAnyDoc() {
    for (const doc of allDocs()) {
      const titles = Array.from(doc.querySelectorAll('.gw-TitleBar--title'));
      if (titles.some(t => {
        const txt = (t.textContent || '').trim();
        return txt.startsWith(TRIGGER_TITLE_STARTS_WITH) && isVisible(t);
      })) return true;
    }
    return false;
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  function formatMMDDYYYY(d) {
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
  }

  function targetDatePlus21() {
    const d = new Date();
    d.setDate(d.getDate() + 21);
    return formatMMDDYYYY(d);
  }

  function dispatchAll(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { el.blur?.(); } catch {}
  }

  function safeCheck(el) {
    if (!el || el.disabled) return false;
    if (!el.checked) {
      try { el.click(); } catch {}
      if (!el.checked) {
        try { el.checked = true; } catch {}
      }
      dispatchAll(el);
      return true;
    }
    return false;
  }

  function safeUncheck(el) {
    if (!el || el.disabled) return false;
    if (el.checked) {
      try { el.click(); } catch {}
      if (el.checked) {
        try { el.checked = false; } catch {}
      }
      dispatchAll(el);
      return true;
    }
    return false;
  }

  function safeRadio(el) {
    if (!el || el.disabled) return false;
    if (!el.checked) {
      try { el.click(); } catch {}
      if (!el.checked) {
        try { el.checked = true; } catch {}
      }
      dispatchAll(el);
      return true;
    }
    return false;
  }

  function safeSetSelect(el, value) {
    if (!el || el.disabled) return false;
    if (el.value === value) return false;

    try { el.focus(); } catch {}
    el.value = value;
    dispatchAll(el);
    return true;
  }

  function safeSetDate(el, value) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.value !== value) {
      try { el.focus(); } catch {}
      el.value = value;
      dispatchAll(el);
      return true;
    }
    return false;
  }

  function* deepChildren(root) {
    if (!root) return;
    const kids = root.children || [];
    for (const el of kids) {
      yield el;
      if (el.shadowRoot) {
        yield el.shadowRoot;
        yield* deepChildren(el.shadowRoot);
      }
      yield* deepChildren(el);
    }
  }

  function deepGetElementById(root, id) {
    try {
      const hit = root.getElementById?.(id);
      if (hit) return hit;
    } catch {}

    for (const node of deepChildren(root)) {
      try {
        const hit = node.getElementById?.(id);
        if (hit) return hit;
      } catch {}
    }

    return null;
  }

  function applyHomePolicyInfoOnce(doc) {
    const wantedGender = getWantedHomeGenderValue();

    try { safeSetSelect(doc.querySelector(SEL_GENDER), wantedGender); } catch {}
    try { safeSetSelect(doc.querySelector(SEL_MARITAL), MARITAL_VALUE); } catch {}

    try { safeUncheck(doc.querySelector(SEL_ESIGNATURE)); } catch {}
    try { safeUncheck(doc.querySelector(SEL_PAPERLESS_POLICY)); } catch {}
  }

  function applyAqbPolicyInfoOnce(doc) {
    const wanted = targetDatePlus21();

    try { safeCheck(doc.querySelector(SEL_AQB_CHECKBOX)); } catch {}
    try { safeRadio(doc.getElementById?.(ID_SIGNAL_NO)); } catch {}
    try { safeSetDate(doc.querySelector(SEL_EFFECTIVE_DATE), wanted); } catch {}

    if (hasGenderFallbackErrorAnyDoc()) {
      try { safeSetSelect(doc.querySelector(SEL_GENDER), GENDER_FALLBACK_VALUE); } catch {}
    }

    try { safeUncheck(doc.querySelector(SEL_ESIGNATURE)); } catch {}
    try { safeUncheck(doc.querySelector(SEL_PAPERLESS_POLICY)); } catch {}
  }

  function applyPolicyInfoOnce() {
    if (isPersonalAutoMode()) return;

    for (const doc of allDocs()) {
      applyHomePolicyInfoOnce(doc);
    }
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

  function findActionByTextAnyDoc(text) {
    const want = normText(text).toLowerCase();
    if (!want) return null;

    for (const doc of allDocs()) {
      const candidates = Array.from(doc.querySelectorAll('.gw-action--inner, [role="tab"], [role="menuitem"], .gw-TabWidget, .gw-label'));
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const value = normText(el.getAttribute?.('aria-label') || el.textContent || '').toLowerCase();
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
    }

    return null;
  }

  function nudgePolicyInfoTabIfNeeded() {
    const flow = getActiveFlow();
    if (!flow || titleIsPolicyInfoAnyDoc()) return false;
    if ((Date.now() - lastTabNudgeAt) < TAB_NUDGE_COOLDOWN_MS) return false;

    const target = findActionByTextAnyDoc(POLICY_INFO_TAB_TEXT);
    if (!target) return false;

    lastTabNudgeAt = Date.now();
    clickLikeUser(target);
    return true;
  }

  function getNextTarget(doc) {
    const host = deepGetElementById(doc, NEXT_HOST_ID);
    if (!host || !isVisible(host)) return null;

    return (
      host.querySelector('.gw-action--inner[aria-disabled="false"]') ||
      host.querySelector('.gw-action--inner') ||
      host.querySelector('.gw-label[aria-label="Next"]') ||
      host
    );
  }

  function clickNextDt2Once() {
    for (const doc of allDocs()) {
      const target = getNextTarget(doc);
      if (!target || !isVisible(target)) continue;
      clickLikeUser(target);
      return true;
    }

    return false;
  }

  function hardStopAndFinish() {
    log('Hard stop — Submission (Quoted) reached or pass complete');
    if (workTimer) clearInterval(workTimer);
    if (nextTimer) clearTimeout(nextTimer);
    if (stuckTimer) clearTimeout(stuckTimer);
    workTimer = null;
    nextTimer = null;
    stuckTimer = null;
    running = false;
    done = true;
    if (mo) {
      try { mo.disconnect(); } catch {}
      mo = null;
    }
  }

  function finalizeIfLeftPolicyInfo() {
    if (hasQuotedLabel()) {
      hardStopAndFinish();
      return true;
    }

    if (!titleIsPolicyInfoAnyDoc()) {
      const flow = getActiveFlow();
      if (flow === 'home') writeFlowStage('home', 'dwelling');
      done = true;
      running = false;
      if (mo) { try { mo.disconnect(); } catch {} mo = null; }
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
      return true;
    }
    return false;
  }

  function attemptNextAndCheck() {
    if (!armed || done) return;

    if (hasQuotedLabel()) {
      hardStopAndFinish();
      return;
    }

    if (finalizeIfLeftPolicyInfo()) return;

    if (nextAttempts >= MAX_NEXT_ATTEMPTS) {
      done = true;
      running = false;
      if (mo) { try { mo.disconnect(); } catch {} mo = null; }
      return;
    }

    applyPolicyInfoOnce();

    if (clickNextDt2Once()) {
      nextAttempts++;
    }

    if (stuckTimer) clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => {
      if (!armed || done) return;
      if (hasQuotedLabel()) {
        hardStopAndFinish();
        return;
      }
      if (titleIsPolicyInfoAnyDoc()) attemptNextAndCheck();
      else finalizeIfLeftPolicyInfo();
    }, STUCK_CHECK_WAIT_MS);
  }

  function hardStop() {
    if (workTimer) clearInterval(workTimer);
    if (nextTimer) clearTimeout(nextTimer);
    if (stuckTimer) clearTimeout(stuckTimer);
    workTimer = null;
    nextTimer = null;
    stuckTimer = null;
    running = false;
  }

  function runSequence() {
    if (!armed || done || running) return;
    if (hasQuotedLabel()) {
      hardStopAndFinish();
      return;
    }
    if (!getActiveFlow()) return;
    if (!gateOK()) return;
    if (!titleIsPolicyInfoAnyDoc()) return;

    running = true;
    nextAttempts = 0;

    applyPolicyInfoOnce();

    workTimer = setInterval(() => {
      if (!armed || done) return;
      if (hasQuotedLabel()) {
        hardStopAndFinish();
        return;
      }
      applyPolicyInfoOnce();
    }, RETRY_EVERY_MS);

    nextTimer = setTimeout(() => {
      if (workTimer) clearInterval(workTimer);
      workTimer = null;
      if (hasQuotedLabel()) {
        hardStopAndFinish();
        return;
      }
      attemptNextAndCheck();
    }, WAIT_BEFORE_NEXT_MS);
  }

  function tick() {
    if (!armed || done) return;
    if (hasQuotedLabel()) {
      hardStopAndFinish();
      return;
    }
    const stage = readFlowStage();
    if (!normText(stage.product) && titleIsPolicyInfoAnyDoc()) {
      if (!isPersonalAutoMode()) writeFlowStage('home', 'policy_info');
    }
    if ((Date.now() - lastTabNudgeAt) < TAB_NUDGE_SETTLE_MS) return;
    if (nudgePolicyInfoTabIfNeeded()) return;
    runSequence();
  }

  function init() {
    mountToggle();
    log(`Loaded v${VERSION}`);

    mo = new MutationObserver(tick);
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });

    document.addEventListener('visibilitychange', tick);

    setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();

    tick();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else window.addEventListener('DOMContentLoaded', init, { once: true });
})();
