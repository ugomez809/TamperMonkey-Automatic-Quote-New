// ==UserScript==
// @name         Alta Shared Failure Selector
// @namespace    homebot.shared-failure-selector
// @version      0.1.0
// @description  Shared selector recorder/monitor for LEX and Alta failure messages. Publishes failed-path triggers to AgencyZoom and Alta webhook state.
// @author       OpenAI
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Apex-LEX/shared-failure-selector/shared-failure-selector.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Apex-LEX/shared-failure-selector/shared-failure-selector.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__ALTA_SHARED_FAILURE_SELECTOR_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Alta Shared Failure Selector';
  const VERSION = '0.1.0';
  const UI_ATTR = 'data-tm-alta-shared-failure-selector-ui';

  const RULES_KEY = 'tm_alta_header_timeout_selector_rules_v1';
  const CLIENT_ID_KEY = 'tm_alta_shared_failure_selector_client_id_v1';
  const SENT_KEY = 'tm_alta_shared_failure_selector_sent_v1';
  const LOG_KEY = 'tm_alta_shared_failure_selector_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const MISSING_TRIGGER_KEY = 'tm_az_missing_payload_fallback_trigger_v1';
  const BUNDLE_KEY = 'tm_alta_webhook_bundle_v1';
  const FORCE_SEND_KEY = 'tm_alta_force_send_now_v1';

  const CURRENT_JOB_KEYS = [
    'tm_alta_current_job_v1',
    'tm_az_current_job_v1',
    'tm_shared_az_job_v1',
    'tm_apex_home_bot_active_row_v1',
    'tm_apex_home_bot_payload_v1'
  ];

  const CFG = {
    scanMs: 700,
    syncMs: 60 * 60 * 1000,
    requestTimeoutMs: 20000,
    maxLogs: 120,
    maxSent: 250,
    panelWidth: 340,
    zIndex: 2147483647,
    selectorOutlineColor: '#38bdf8',
    selectorFillColor: 'rgba(56,189,248,0.14)',
    sharedRulesEndpoint: 'https://script.google.com/macros/s/AKfycbxBYCjRnS9aRQoWqlE_fiTOnUGIVyrgU1mabIVCk4YtYThbRd4nSKIDf4gqnRXm-m3TGw/exec',
    sharedRulesKey: 'alta-timeout-rules-17jun2026-jkira-91x7p'
  };

  const state = {
    destroyed: false,
    rules: [],
    selectorMode: false,
    selectorListeners: [],
    hoverBox: null,
    panel: null,
    ui: {},
    scanTimer: 0,
    syncTimer: 0,
    logs: [],
    lastLogClearAt: '',
    syncBusy: false,
    bootSyncPending: false,
    lastMatchLogKey: ''
  };

  init();

  function init() {
    buildPanel();
    readLocalRules();
    loadLogs();
    log(`Loaded v${VERSION}`);
    if (!isAzHost()) {
      state.bootSyncPending = true;
      setStatus('Waiting for shared rules sync...');
      syncSharedRules('boot').catch((err) => {
        state.bootSyncPending = false;
        setStatus(`${hostLabel()} | ${state.rules.length} rule(s)`);
        log(`Shared sync failed; using local rules | ${err?.message || err}`);
      });
    } else {
      setStatus('AgencyZoom bridge active');
    }

    state.scanTimer = window.setInterval(scan, CFG.scanMs);
    state.syncTimer = window.setInterval(() => {
      if (!isAzHost()) syncSharedRules('interval').catch((err) => log(`Shared sync failed: ${err?.message || err}`));
    }, CFG.syncMs);
    window.addEventListener('storage', handleStorage, true);
    scan();
    window.__ALTA_SHARED_FAILURE_SELECTOR_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { clearInterval(state.scanTimer); } catch {}
    try { clearInterval(state.syncTimer); } catch {}
    try { window.removeEventListener('storage', handleStorage, true); } catch {}
    stopSelectorMode('', { logIt: false });
    try { state.hoverBox?.remove(); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__ALTA_SHARED_FAILURE_SELECTOR_CLEANUP__; } catch {}
  }

  function scan() {
    if (state.destroyed) return;
    if (isAzHost()) {
      bridgeTriggerToAgencyZoom();
      return;
    }
    scanRules();
  }

  function bridgeTriggerToAgencyZoom() {
    const trigger = readGMJson(MISSING_TRIGGER_KEY, null);
    if (!isActiveTrigger(trigger)) return;
    const existing = readLocalJson(MISSING_TRIGGER_KEY, null);
    const existingKey = buildTriggerKey(existing);
    const triggerKey = buildTriggerKey(trigger);
    if (existingKey === triggerKey) {
      setStatus(`AZ failed-path trigger ready ${trigger.ticketId || trigger.azId}`);
      return;
    }
    writeLocalJson(MISSING_TRIGGER_KEY, trigger);
    log(`Bridged failed-path trigger into AZ | ${trigger.ticketId || trigger.azId} | ${trigger.reason || ''}`);
    setStatus(`AZ trigger bridged ${trigger.ticketId || trigger.azId}`);
  }

  function scanRules() {
    if (state.selectorMode || state.syncBusy || state.bootSyncPending || !state.rules.length) return;
    const kind = hostKind();
    if (kind !== 'lex' && kind !== 'alta') return;

    for (const rule of state.rules) {
      if (!rule || rule.enabled === false) continue;
      const scopeKind = norm(rule.scopeHostKind || rule.fingerprint?.scopeHostKind || '');
      if (scopeKind && scopeKind !== kind) continue;

      const match = findRuleMatch(rule);
      if (!match) continue;

      const azId = readCurrentAzId();
      const sentKey = `${kind}|${azId || 'no-az'}|${rule.ruleId}`;
      if (hasSent(sentKey)) return;

      if (kind === 'lex') {
        if (azId && publishMissingPayloadTrigger(azId, rule.savedErrorText, rule, 'lex')) {
          markSent(sentKey);
          tryCloseCurrentTab();
        } else {
          logOnce(`lex-no-az|${rule.ruleId}`, `LEX selector matched but no AZ ID was available | ${rule.ruleId}`);
        }
        return;
      }

      if (kind === 'alta') {
        if (saveAltaSelectorEvent(rule, match)) {
          markSent(sentKey);
        }
        return;
      }
    }
  }

  function saveAltaSelectorEvent(rule, matchedEl) {
    const job = readCurrentJob();
    const azId = extractAzId(job);
    if (!azId) {
      logOnce(`alta-no-az|${rule.ruleId}`, `Alta selector matched but no AZ ID was available | ${rule.ruleId}`);
      return false;
    }

    const message = norm(rule.savedErrorText || '');
    if (!message) return false;
    const eventId = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const event = {
      eventId,
      id: eventId,
      dedupeKey: ['selector', azId, 'home', rule.ruleId].join('|'),
      actionKey: 'home_saved_selector_error',
      triggerType: 'selector',
      product: 'home',
      productLabel: 'Home',
      errorType: 'SavedSelectorMatch',
      errorName: norm(rule.label || 'Saved selector error'),
      errorMessage: message,
      errorText: message,
      resultField: 'Done?',
      resultValue: message,
      selectorRuleId: norm(rule.ruleId || ''),
      selector: norm(rule.selector || ''),
      detectedAt: nowIso(),
      source: SCRIPT_NAME,
      sourceVersion: VERSION,
      capturedElementHtml: truncate(matchedEl?.outerHTML || '', 4000),
      capturedText: truncate(matchedEl?.innerText || matchedEl?.textContent || '', 600),
      page: { url: location.href, title: document.title },
      identity: {
        'AZ ID': azId,
        Name: norm(job.Name || ''),
        'Mailing Address': norm(job['Mailing Address'] || ''),
        SubmissionNumber: norm(job.SubmissionNumber || '')
      }
    };

    const bundle = readLocalJson(BUNDLE_KEY, {}) || {};
    const next = isPlainObject(bundle) ? bundle : {};
    next['AZ ID'] = azId;
    next.Name = norm(next.Name || job.Name || '');
    next['Mailing Address'] = norm(next['Mailing Address'] || job['Mailing Address'] || '');
    next.SubmissionNumber = norm(next.SubmissionNumber || job.SubmissionNumber || '');
    next.home = isPlainObject(next.home) ? next.home : { ready: false, data: null };
    next.home.data = isPlainObject(next.home.data) ? next.home.data : {};
    next.home.data.latestError = event;
    next.home.data.errors = Array.isArray(next.home.data.errors) ? next.home.data.errors : [];
    if (!next.home.data.errors.some((item) => norm(item?.dedupeKey || '') === event.dedupeKey)) {
      next.home.data.errors.push(event);
    }
    next.timeout = isPlainObject(next.timeout) ? next.timeout : {};
    next.timeout.ready = true;
    next.timeout.events = Array.isArray(next.timeout.events) ? next.timeout.events : [];
    if (!next.timeout.events.some((item) => norm(item?.dedupeKey || '') === event.dedupeKey)) {
      next.timeout.events.push(event);
    }
    next.timeout.lastEvent = event;
    next.timeout.events = next.timeout.events.slice(-50);
    next.auto = { ready: false, data: null };
    next.meta = isPlainObject(next.meta) ? next.meta : {};
    next.meta.updatedAt = nowIso();
    next.meta.lastWriter = SCRIPT_NAME;
    next.meta.version = VERSION;
    next.meta.stage = 'selector_error';

    writeLocalJson(BUNDLE_KEY, next);
    writeLocalJson(FORCE_SEND_KEY, {
      azId,
      product: 'home',
      eventId,
      triggerType: 'selector',
      reason: `selector:${eventId}`,
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    });
    publishMissingPayloadTrigger(azId, message, rule, 'alta');
    log(`Saved Alta selector event to webhook bundle | ${rule.ruleId} | ${message}`);
    return true;
  }

  function publishMissingPayloadTrigger(azId, reason, rule, originKind) {
    const cleanAzId = norm(azId);
    const message = norm(reason);
    if (!cleanAzId || !message) return false;
    const trigger = {
      ready: true,
      ticketId: cleanAzId,
      azId: cleanAzId,
      reason: message,
      triggerType: 'selector',
      originKind: originKind || hostKind(),
      label: norm(rule?.label || ''),
      selectorRuleId: norm(rule?.ruleId || ''),
      pageUrl: location.href,
      pageTitle: norm(document.title || ''),
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeBoth(MISSING_TRIGGER_KEY, trigger);
    log(`Triggered failed path | ${cleanAzId} | ${message}`);
    return true;
  }

  function startSelectorMode() {
    if (isAzHost()) {
      log('Selector save is only active on LEX or Alta pages');
      return;
    }
    state.selectorMode = true;
    setStatus('Click an error element...');
    log('Selector mode started');

    const onMove = (event) => updateHover(selectableAt(event.clientX, event.clientY, event));
    const onClick = (event) => {
      if (isUi(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const target = selectableAt(event.clientX, event.clientY, event);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      saveRuleFromElement(target).catch((err) => log(`Save selector failed: ${err?.message || err}`));
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      stopSelectorMode('Selector canceled');
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    state.selectorListeners = [
      () => document.removeEventListener('mousemove', onMove, true),
      () => document.removeEventListener('click', onClick, true),
      () => document.removeEventListener('keydown', onKey, true)
    ];
  }

  function stopSelectorMode(message = '', options = {}) {
    state.selectorMode = false;
    for (const fn of state.selectorListeners) {
      try { fn(); } catch {}
    }
    state.selectorListeners = [];
    try { state.hoverBox && (state.hoverBox.style.display = 'none'); } catch {}
    if (options.logIt !== false && message) log(message);
    setStatus(`${hostLabel()} | ${state.rules.length} rule(s)`);
  }

  async function saveRuleFromElement(el) {
    stopSelectorMode('', { logIt: false });
    const target = chooseRuleTarget(el);
    const selector = buildSelector(target);
    const fingerprint = buildFingerprint(target);
    if (!selector) {
      log('Could not build selector for clicked element');
      return;
    }

    const defaultReason = norm(target.innerText || target.textContent || '');
    const reason = norm(window.prompt('What should be written in the failed note when this selector is visible?', defaultReason));
    if (!reason) {
      log('Selector save canceled: no note message');
      return;
    }
    const label = norm(window.prompt('Short label for this shared selector rule?', reason)) || reason;
    const rule = {
      ruleId: buildRuleId(selector, fingerprint.textFingerprint || reason),
      enabled: true,
      label,
      savedErrorText: reason,
      selector,
      fingerprint: { ...fingerprint, scopeHostKind: hostKind() },
      scopeHostKind: hostKind(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const saved = await upsertSharedRule(rule).catch((err) => {
      log(`Remote save failed; saved local only | ${err?.message || err}`);
      const normalized = normalizeRule(rule);
      const next = state.rules.filter((item) => item.ruleId !== normalized.ruleId);
      next.push(normalized);
      writeLocalRules(next);
      return normalized;
    });
    if (hostKind() === 'lex') suppressCurrentMatch(saved);
  }

  function suppressCurrentMatch(rule) {
    const ruleId = norm(rule?.ruleId || '');
    const azId = readCurrentAzId();
    if (!ruleId || !azId) return;
    markSent(`lex|${azId}|${ruleId}`);
    log(`Saved selector without auto-triggering current AZ | ${azId} | ${ruleId}`);
  }

  async function syncSharedRules(reason = '') {
    if (state.syncBusy) return;
    state.syncBusy = true;
    setStatus('Syncing shared rules...');
    try {
      const response = await requestSharedRules('GET', buildSharedRulesUrl({
        action: 'listRules',
        key: CFG.sharedRulesKey,
        includeDisabled: 'true'
      }));
      const rules = Array.isArray(response.rules) ? response.rules.map(normalizeRule).filter(Boolean) : [];
      writeLocalRules(rules.filter((rule) => rule.enabled !== false));
      state.bootSyncPending = false;
      log(`Shared rules sync complete | ${state.rules.length} rule(s)${reason ? ` | ${reason}` : ''}`);
    } finally {
      state.syncBusy = false;
      setStatus(`${hostLabel()} | ${state.rules.length} rule(s)`);
    }
  }

  async function upsertSharedRule(rule) {
    const clientId = getClientId();
    const normalized = normalizeRule({
      ...rule,
      enabled: true,
      sourceScript: SCRIPT_NAME,
      sourceVersion: VERSION,
      updatedBy: clientId,
      clientId
    });
    if (!normalized) throw new Error('Invalid selector rule');

    await requestSharedRules('POST', CFG.sharedRulesEndpoint, {
      action: 'upsertRule',
      key: CFG.sharedRulesKey,
      rule: {
        ruleId: normalized.ruleId,
        enabled: true,
        label: normalized.label,
        savedErrorText: normalized.savedErrorText,
        selector: normalized.selector,
        fingerprint: normalized.fingerprint,
        scopeHostKind: normalized.scopeHostKind,
        createdAt: normalized.createdAt,
        sourceScript: SCRIPT_NAME,
        sourceVersion: VERSION,
        updatedBy: clientId,
        clientId
      }
    });

    const next = state.rules.filter((item) => item.ruleId !== normalized.ruleId);
    next.push(normalized);
    writeLocalRules(next);
    log(`Saved shared selector rule | ${normalized.ruleId} | ${normalized.savedErrorText}`);
    return normalized;
  }

  function normalizeRule(raw) {
    if (!isPlainObject(raw)) return null;
    const enabled = raw.enabled === false ? false : String(raw.enabled ?? 'true').toLowerCase() !== 'false';
    const selector = norm(raw.selector || raw.cssSelector || '');
    const savedErrorText = norm(raw.savedErrorText || raw.errorText || raw.customMessage || raw.resultValue || raw.textSample || raw.errorName || '');
    const fingerprintRaw = isPlainObject(raw.fingerprint) ? raw.fingerprint : {};
    const scopeHostKind = norm(raw.scopeHostKind || fingerprintRaw.scopeHostKind || raw.hostKind || '').toLowerCase();
    const fingerprint = {
      tag: norm(fingerprintRaw.tag || ''),
      id: norm(fingerprintRaw.id || ''),
      name: norm(fingerprintRaw.name || ''),
      role: norm(fingerprintRaw.role || ''),
      ariaLabel: norm(fingerprintRaw.ariaLabel || ''),
      classTokens: Array.isArray(fingerprintRaw.classTokens) ? fingerprintRaw.classTokens.map(norm).filter(Boolean).slice(0, 4) : [],
      textFingerprint: truncate(fingerprintRaw.textFingerprint || raw.textFingerprint || raw.textSample || '', 160),
      scopeHostKind
    };
    const ruleId = norm(raw.ruleId || raw.id || buildRuleId(selector, fingerprint.textFingerprint));
    if (!ruleId || !selector || !savedErrorText) return null;
    return {
      ruleId,
      enabled,
      selector,
      label: norm(raw.label || raw.errorName || savedErrorText || 'Saved selector error'),
      savedErrorText,
      fingerprint,
      scopeHostKind,
      createdAt: norm(raw.createdAt || nowIso()),
      updatedAt: norm(raw.updatedAt || raw.createdAt || nowIso()),
      sourceScript: norm(raw.sourceScript || ''),
      sourceVersion: norm(raw.sourceVersion || '')
    };
  }

  function findRuleMatch(rule) {
    const selector = norm(rule?.selector || '');
    if (!selector) return null;
    for (const node of queryAllDeep(selector)) {
      if (!visible(node)) continue;
      if (!fingerprintMatches(rule, node)) continue;
      return node;
    }
    return null;
  }

  function fingerprintMatches(rule, el) {
    const saved = isPlainObject(rule?.fingerprint) ? rule.fingerprint : {};
    const current = buildFingerprint(el);
    if (saved.id && current.id && saved.id === current.id) return true;

    let required = 0;
    let score = 0;
    let textRequired = false;
    let textMatches = false;
    if (saved.tag) { required += 1; if (saved.tag === current.tag) score += 1; }
    if (saved.name) { required += 1; if (saved.name === current.name) score += 1; }
    if (saved.role) { required += 1; if (saved.role === current.role) score += 1; }
    if (saved.ariaLabel) { required += 1; if (saved.ariaLabel === current.ariaLabel) score += 1; }
    if (Array.isArray(saved.classTokens) && saved.classTokens.length) {
      required += 1;
      const currentSet = new Set(current.classTokens || []);
      if (saved.classTokens.every((token) => currentSet.has(token))) score += 1;
    }
    if (saved.textFingerprint) {
      required += 1;
      textRequired = true;
      const a = lower(saved.textFingerprint);
      const b = lower(current.textFingerprint);
      if (a && b && b.includes(a)) {
        score += 1;
        textMatches = true;
      }
    }
    if (required === 0) return true;
    if (textRequired && !textMatches) return false;
    if (required === 1) return score === 1;
    if (textRequired && required <= 3) return score === required;
    return score >= 2;
  }

  function readCurrentJob() {
    for (const key of CURRENT_JOB_KEYS) {
      const value = readGMJson(key, null);
      if (isPlainObject(value) && extractAzId(value)) return normalizeJob(value);
    }
    for (const key of CURRENT_JOB_KEYS) {
      const value = readLocalJson(key, null);
      if (isPlainObject(value) && extractAzId(value)) return normalizeJob(value);
    }
    return {};
  }

  function readCurrentAzId() {
    return extractAzId(readCurrentJob());
  }

  function normalizeJob(value) {
    const raw = isPlainObject(value) ? value : {};
    const az = isPlainObject(raw.az) ? raw.az : {};
    const first = pickFirst(raw['First Name'], raw.firstName, az['First Name'], az['AZ Name']);
    const last = pickFirst(raw['Last Name'], raw.lastName, az['Last Name'], az['AZ Last']);
    return {
      'AZ ID': extractAzId(raw),
      Name: pickFirst(raw.Name, raw.name, `${first} ${last}`),
      'Mailing Address': pickFirst(raw['Mailing Address'], raw.mailingAddress, az['Mailing Address'], [az['AZ Street Address'], az['AZ City'], az['AZ State'], az['AZ Postal Code']].filter(Boolean).join(' ')),
      SubmissionNumber: pickFirst(raw.SubmissionNumber, raw.submissionNumber, raw['Submission Number'])
    };
  }

  function extractAzId(value) {
    if (!isPlainObject(value)) return '';
    return norm(value.azId || value.ticketId || value['AZ ID'] || value.currentJob?.['AZ ID'] || value.az?.['AZ ID'] || value.data?.currentJob?.['AZ ID'] || value.data?.['AZ ID'] || '');
  }

  function buildSelector(el) {
    if (!(el instanceof Element)) return '';
    if (hasStableId(el)) return `#${cssEscape(el.id)}`;
    const name = norm(el.getAttribute('name') || '');
    if (name) {
      const byName = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      try { if (document.querySelectorAll(byName).length === 1) return byName; } catch {}
    }
    const role = norm(el.getAttribute('role') || '');
    const aria = norm(el.getAttribute('aria-label') || '');
    if (role && aria) {
      const byRole = `${el.tagName.toLowerCase()}[role="${cssEscape(role)}"][aria-label="${cssEscape(aria)}"]`;
      try { if (document.querySelectorAll(byRole).length === 1) return byRole; } catch {}
    }
    const parts = [];
    let cur = el;
    while (cur && cur instanceof Element && cur !== document.body && cur !== document.documentElement && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (hasStableId(cur)) {
        part += `#${cssEscape(cur.id)}`;
        parts.unshift(part);
        break;
      }
      const classes = stableClassTokens(cur);
      if (classes.length) part += `.${classes.map(cssEscape).join('.')}`;
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((node) => node.tagName === cur.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      const selector = parts.join(' > ');
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
      cur = parent;
    }
    return parts.join(' > ');
  }

  function buildFingerprint(el) {
    return {
      tag: String(el?.tagName || '').toLowerCase(),
      id: norm(el?.id || ''),
      name: norm(el?.getAttribute?.('name') || ''),
      role: norm(el?.getAttribute?.('role') || ''),
      ariaLabel: norm(el?.getAttribute?.('aria-label') || ''),
      classTokens: stableClassTokens(el),
      textFingerprint: truncate(el?.innerText || el?.textContent || '', 160)
    };
  }

  function chooseRuleTarget(el) {
    if (!(el instanceof Element)) return el;
    let best = el;
    let bestScore = scoreRuleTarget(el);
    let cur = el.parentElement;
    let depth = 0;
    while (cur && cur !== document.body && cur !== document.documentElement && depth < 6) {
      const score = scoreRuleTarget(cur);
      if (score > bestScore) {
        best = cur;
        bestScore = score;
      }
      cur = cur.parentElement;
      depth += 1;
    }
    return best;
  }

  function scoreRuleTarget(el) {
    if (!(el instanceof Element) || !visible(el) || isUi(el)) return Number.NEGATIVE_INFINITY;
    const text = norm(el.innerText || el.textContent || '');
    let score = 0;
    if (/insert failed|cannot_execute_flow_trigger|too many soql queries|error id:|exception|declined|knockout|error|failed/i.test(text)) score += 40;
    if (el.matches('li,[role="alert"],.slds-popover__body,.slds-notify,.slds-form-element__help,.mat-mdc-snack-bar-label,.mat-mdc-dialog-content')) score += 15;
    if (stableClassTokens(el).length) score += 5;
    if (hasStableId(el)) score += 6;
    if (looksGeneratedId(el.id)) score -= 8;
    if (text.length >= 40) score += Math.min(18, Math.floor(text.length / 40));
    if (text.length > 900) score -= 8;
    return score;
  }

  function getAllRoots(root = document) {
    const out = [];
    const seen = new WeakSet();
    function walk(candidate) {
      if (!candidate || seen.has(candidate)) return;
      seen.add(candidate);
      out.push(candidate);
      let nodes = [];
      try { nodes = Array.from(candidate.querySelectorAll('*')); } catch {}
      for (const node of nodes) {
        try { if (node.shadowRoot) walk(node.shadowRoot); } catch {}
        try { if (node.tagName === 'IFRAME' && node.contentDocument) walk(node.contentDocument); } catch {}
      }
    }
    walk(root);
    return out;
  }

  function queryAllDeep(selector) {
    const found = [];
    const seen = new WeakSet();
    for (const root of getAllRoots()) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch {}
      for (const node of nodes) {
        if (!(node instanceof Element) || seen.has(node)) continue;
        seen.add(node);
        found.push(node);
      }
    }
    return found;
  }

  function selectableAt(clientX, clientY, event = null) {
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (isUi(node)) return null;
      if (!visible(node)) continue;
      if (node === document.body || node === document.documentElement) continue;
      return node;
    }
    const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(clientX, clientY) : [];
    for (const node of stack) {
      if (!(node instanceof Element)) continue;
      if (isUi(node)) return null;
      if (!visible(node)) continue;
      if (node === document.body || node === document.documentElement) continue;
      return node;
    }
    return null;
  }

  function ensureHoverBox() {
    if (state.hoverBox && document.contains(state.hoverBox)) return state.hoverBox;
    const box = document.createElement('div');
    box.setAttribute(UI_ATTR, '1');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: String(CFG.zIndex - 1),
      pointerEvents: 'none',
      border: `2px solid ${CFG.selectorOutlineColor}`,
      background: CFG.selectorFillColor,
      borderRadius: '4px',
      boxSizing: 'border-box',
      display: 'none'
    });
    document.documentElement.appendChild(box);
    state.hoverBox = box;
    return box;
  }

  function updateHover(el) {
    const box = ensureHoverBox();
    if (!(el instanceof Element) || !visible(el)) {
      box.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top)}px`,
      width: `${Math.max(0, rect.width)}px`,
      height: `${Math.max(0, rect.height)}px`
    });
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'tm-alta-shared-failure-selector-panel';
    panel.setAttribute(UI_ATTR, '1');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: `${CFG.panelWidth}px`,
      zIndex: String(CFG.zIndex),
      background: 'rgba(15,23,42,.96)',
      color: '#fff',
      border: '1px solid rgba(148,163,184,.45)',
      borderRadius: '8px',
      boxShadow: '0 10px 30px rgba(0,0,0,.35)',
      fontFamily: 'Arial,sans-serif',
      fontSize: '12px',
      overflow: 'hidden'
    });
    panel.innerHTML = `
      <div ${UI_ATTR}="1" style="padding:10px 12px;background:#0f172a;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div ${UI_ATTR}="1" style="font-weight:800;">Alta Shared Failure Selector</div>
        <div ${UI_ATTR}="1" style="font-size:11px;opacity:.75;">v${VERSION}</div>
      </div>
      <div ${UI_ATTR}="1" style="padding:10px 12px;">
        <div ${UI_ATTR}="1" data-status style="margin-bottom:8px;color:#bae6fd;">Starting</div>
        <div ${UI_ATTR}="1" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          <button ${UI_ATTR}="1" data-save type="button" style="border:0;border-radius:6px;padding:7px 8px;background:#0284c7;color:#fff;font-weight:800;cursor:pointer;">SAVE SELECTOR</button>
          <button ${UI_ATTR}="1" data-sync type="button" style="border:0;border-radius:6px;padding:7px 8px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">SYNC</button>
          <button ${UI_ATTR}="1" data-copy type="button" style="border:0;border-radius:6px;padding:7px 8px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">COPY LOGS</button>
        </div>
        <div ${UI_ATTR}="1" data-log style="max-height:155px;overflow:auto;font-size:11px;line-height:1.35;"></div>
      </div>
    `;
    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.status = panel.querySelector('[data-status]');
    state.ui.log = panel.querySelector('[data-log]');
    panel.querySelector('[data-save]')?.addEventListener('click', () => {
      if (state.selectorMode) stopSelectorMode('Selector canceled');
      else startSelectorMode();
    });
    panel.querySelector('[data-sync]')?.addEventListener('click', () => {
      syncSharedRules('manual').catch((err) => log(`Shared sync failed: ${err?.message || err}`));
    });
    panel.querySelector('[data-copy]')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.logs.join('\n')); log('Logs copied'); }
      catch { log('Copy logs failed'); }
    });
  }

  function renderLogs() {
    if (!state.ui.log) return;
    state.ui.log.innerHTML = state.logs.slice(0, 14).map((line) => `<div ${UI_ATTR}="1" style="margin-bottom:3px;word-break:break-word;">${escapeHtml(line)}</div>`).join('');
  }

  function loadLogs() {
    const saved = readLocalJson(LOG_KEY, null);
    if (Array.isArray(saved?.lines)) state.logs = saved.lines.slice(0, CFG.maxLogs);
    renderLogs();
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogs);
    const payload = { script: SCRIPT_NAME, version: VERSION, origin: location.origin, updatedAt: nowIso(), lines: state.logs };
    try { localStorage.setItem(LOG_KEY, JSON.stringify(payload)); } catch {}
    try { GM_setValue(LOG_KEY, payload); } catch {}
    console.info(`[${SCRIPT_NAME}] ${message}`);
    renderLogs();
  }

  function logOnce(key, message) {
    if (state.lastMatchLogKey === key) return;
    state.lastMatchLogKey = key;
    log(message);
  }

  function setStatus(message) {
    if (state.ui.status) state.ui.status.textContent = message;
  }

  function handleStorage(event) {
    if (event?.key !== LOG_CLEAR_SIGNAL_KEY) return;
    const req = safeJsonParse(event.newValue, null);
    const at = norm(req?.requestedAt || '');
    if (!at || at === state.lastLogClearAt) return;
    state.lastLogClearAt = at;
    state.logs = [];
    renderLogs();
  }

  function readLocalRules() {
    const parsed = readLocalJson(RULES_KEY, []);
    state.rules = Array.isArray(parsed) ? parsed.map(normalizeRule).filter(Boolean) : [];
    setStatus(`${hostLabel()} | ${state.rules.length} rule(s)`);
    return state.rules;
  }

  function writeLocalRules(rules) {
    state.rules = (Array.isArray(rules) ? rules : []).map(normalizeRule).filter(Boolean);
    try { localStorage.setItem(RULES_KEY, JSON.stringify(state.rules, null, 2)); } catch {}
    setStatus(`${hostLabel()} | ${state.rules.length} rule(s)`);
  }

  function readSentMap() {
    const value = readLocalJson(SENT_KEY, {});
    return isPlainObject(value) ? value : {};
  }

  function writeSentMap(map) {
    const entries = Object.entries(isPlainObject(map) ? map : {})
      .sort((a, b) => String(b[1] || '').localeCompare(String(a[1] || '')))
      .slice(0, CFG.maxSent);
    try { localStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(entries), null, 2)); } catch {}
  }

  function hasSent(key) {
    return !!readSentMap()[key];
  }

  function markSent(key) {
    const map = readSentMap();
    map[key] = nowIso();
    writeSentMap(map);
  }

  function isActiveTrigger(trigger) {
    if (!isPlainObject(trigger) || trigger.ready !== true) return false;
    const azId = norm(trigger.ticketId || trigger.azId || '');
    if (!azId) return false;
    const ms = Date.parse(norm(trigger.requestedAt || ''));
    return !Number.isFinite(ms) || Date.now() - ms < 10 * 60 * 1000;
  }

  function buildTriggerKey(trigger) {
    if (!isPlainObject(trigger)) return '';
    return [norm(trigger.ticketId || trigger.azId || ''), norm(trigger.requestedAt || ''), norm(trigger.reason || '')].join('|');
  }

  function requestSharedRules(method, url, payload = null) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method,
          url,
          headers: payload ? { 'Content-Type': 'application/json' } : {},
          data: payload ? JSON.stringify(payload) : undefined,
          timeout: CFG.requestTimeoutMs,
          onload: (response) => {
            const status = Number(response?.status || 0);
            if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status || 'request failed'}`));
            const parsed = safeJsonParse(response?.responseText || '', null);
            if (!isPlainObject(parsed)) return reject(new Error('Invalid JSON response'));
            if (parsed.ok === false) return reject(new Error(norm(parsed.error || 'Remote request failed') || 'Remote request failed'));
            resolve(parsed);
          },
          onerror: () => reject(new Error('Network error')),
          ontimeout: () => reject(new Error('Request timeout'))
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function buildSharedRulesUrl(params = {}) {
    const url = new URL(CFG.sharedRulesEndpoint);
    Object.entries(params).forEach(([key, value]) => {
      if (value == null || value === '') return;
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function getClientId() {
    try {
      const current = norm(localStorage.getItem(CLIENT_ID_KEY) || '');
      if (current) return current;
      const created = `alta_selector_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
      localStorage.setItem(CLIENT_ID_KEY, created);
      return created;
    } catch {
      return `alta_selector_${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  function hostKind() {
    if (isAzHost()) return 'az';
    if (/^farmersagent\.lightning\.force\.com$/i.test(location.hostname)) return 'lex';
    if (/^alta\.farmers\.com$/i.test(location.hostname)) return 'alta';
    return 'other';
  }

  function hostLabel() {
    const kind = hostKind();
    if (kind === 'az') return 'Bridging AZ';
    if (kind === 'lex') return 'Watching LEX';
    if (kind === 'alta') return 'Watching Alta';
    return 'Watching';
  }

  function isAzHost() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function isUi(el) {
    return !!(el instanceof Element && el.closest(`[${UI_ATTR}="1"]`));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|\/@])/g, '\\$1');
  }

  function looksGeneratedId(value) {
    const id = norm(value || '');
    if (!id) return false;
    if (/^dialog-(?:body|title)-id-\d+(?:-\d+)+$/i.test(id)) return true;
    if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+-\d+(?:-\d+)+$/i.test(id)) return true;
    return false;
  }

  function hasStableId(el) {
    const id = norm(el?.id || '');
    return !!id && !looksGeneratedId(id);
  }

  function stableClassTokens(el) {
    return Array.from(el.classList || [])
      .filter((token) => /^[a-zA-Z0-9_-]{2,}$/.test(token))
      .filter((token) => !/^ng-|^slds-is-|^active$|^show$/.test(token))
      .slice(0, 4);
  }

  function buildRuleId(selector, text) {
    const basis = `${selector}|${text}`;
    let hash = 0;
    for (let i = 0; i < basis.length; i += 1) {
      hash = ((hash << 5) - hash + basis.charCodeAt(i)) | 0;
    }
    return `rule_h${Math.abs(hash)}`;
  }

  function tryCloseCurrentTab() {
    try { window.close(); } catch {}
    if (window.closed) return;
    try { window.open('', '_self'); } catch {}
    try { window.close(); } catch {}
  }

  function writeBoth(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    try { GM_setValue(key, value); } catch {}
  }

  function readLocalJson(key, fallback = null) {
    try { return safeJsonParse(localStorage.getItem(key), fallback); }
    catch { return fallback; }
  }

  function writeLocalJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value, null, 2)); } catch {}
  }

  function readGMJson(key, fallback = null) {
    try { return safeJsonParse(GM_getValue(key, fallback), fallback); }
    catch { return fallback; }
  }

  function safeJsonParse(raw, fallback = null) {
    try {
      if (raw == null || raw === '') return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return norm(value).toLowerCase();
  }

  function pickFirst(...values) {
    for (const value of values) {
      const text = norm(value);
      if (text) return text;
    }
    return '';
  }

  function truncate(value, max) {
    const text = norm(value);
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
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
