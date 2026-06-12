// ==UserScript==
// @name         13 AUTO AgencyZoom Zillow Ticket Enricher
// @namespace    autoflow.az-zillow-ticket-enricher
// @version      1.3.7
// @description  AUTO-only Zillow enricher. It stays on by default, switches AgencyZoom to Ingored v2, opens the next visible ticket, then continues through the Zillow enrichment flow.
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @match        https://www.zillow.com/*
// @match        https://zillow.com/*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-end
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      *
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-zillow-ticket-enricher/az-zillow-ticket-enricher.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-zillow-ticket-enricher/az-zillow-ticket-enricher.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_ZILLOW_TICKET_ENRICHER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = '13 AUTO AgencyZoom Zillow Ticket Enricher';
  const VERSION = getScriptVersion();
  const UI_ATTR = 'data-tm-az-zillow-ticket-enricher-ui';
  const PIPELINE_ROOT_URL = 'https://app.agencyzoom.com/referral/pipeline';
  const SHARED_TAB_ID_KEY = 'tm_auto_shared_tab_id_v1';

  const GM_KEYS = {
    job: 'tm_az_zillow_ticket_enricher_job_v4',
    fieldTargets: 'tm_az_zillow_ticket_enricher_field_targets_v1',
    tagTargets: 'tm_az_zillow_ticket_enricher_tag_targets_v1',
    customFields: 'tm_az_zillow_ticket_enricher_custom_fields_v1',
    providerPicker: 'tm_az_zillow_ticket_enricher_provider_picker_v1',
    zillowOpenLease: 'tm_az_zillow_ticket_enricher_zillow_open_lease_v1',
    zillowTabHeartbeat: 'tm_az_zillow_ticket_enricher_zillow_tab_heartbeat_v1'
  };

  const LEGACY_GM_JOB_KEYS = [
    'tm_az_zillow_ticket_enricher_job_v1',
    'tm_az_zillow_ticket_enricher_job_v2',
    'tm_az_zillow_ticket_enricher_job_v3'
  ];

  const LS_KEYS = {
    running: 'tm_az_zillow_ticket_enricher_running_v1',
    panelPos: 'tm_az_zillow_ticket_enricher_panel_pos_v1',
    lastZillowOpenAt: 'tm_az_zillow_ticket_enricher_last_zillow_open_at_v1',
    webhookUrl: 'tm_az_zillow_ticket_enricher_webhook_url_v1',
    azTabSlot: 'tm_auto_single_agencyzoom_tab_slot_v1',
    zillowTabSlot: 'tm_auto_single_zillow_tab_slot_v1'
  };

  const SS_KEYS = {
    bootstrapReload: 'tm_az_zillow_ticket_enricher_bootstrap_reload_v1',
    zillowTabJobId: 'tm_az_zillow_ticket_enricher_zillow_tab_job_id_v1'
  };

  const ZILLOW_JOB_HASH_KEY = 'tm-az-zillow-job';

  const FIELD_ORDER = [
    'Zillow URL',
    'Bedrooms',
    'Bathrooms',
    'Home Type'
  ];

  const TAG_ORDER = [
    { key: 'addTag', label: 'What Tag will be added?' },
    { key: 'removeTag', label: 'What tag will be removed?' }
  ];

  const CFG = {
    filterOnly: false,
    openTicketOnly: false,
    savedQueryName: 'Ingored v2',
    savedQueryAliases: ['Ingored v2', 'Ignored v2'],
    savedQueryDataId: '79210',
    savedQueryUrlNeedle: 'tags=310769,310770',
    tickMs: 900,
    stepPollMs: 150,
    openTryMs: 4200,
    openTotalMs: 12000,
    openCheckAfterClickMs: 2000,
    frontStableMs: 1200,
    gapMs: 2000,
    majorStepDelayMs: 2000,
    mainReadyMs: 10000,
    filterSettleMs: 2000,
    actionSettleMs: 2000,
    updateSettleMs: 2000,
    closeWaitMs: 5000,
    zillowWaitMs: 30000,
    zillowCaptchaRefreshMs: 180000,
    zillowFactSettleMs: 9000,
    zillowStaleMs: 15000,
    zillowMaxLaunches: 0,
    zillowDeadPageMs: 12000,
    zillowSearchFallbackMs: 4000,
    azRefreshIfNoZillowOpenMs: 60000,
    pageSlotTtlMs: 12000,
    zillowOpenLeaseMs: 20000,
    zillowTabHeartbeatStaleMs: 15000,
    maxLogLines: 80,
    panelWidth: 390,
    zIndex: 2147483647
  };

  const SEL = {
    stageWrap: '.dd-heading-wrapper',
    stageCards: '.dd-card.referral-container[data-id]',
    customerLink: 'a.customer[rel], a.customer',

    savedQueryButton: '#currentPipelineFilter .savedQueryDropdown > button.dropdown-toggle',
    savedQueryLabel: '#currentPipelineFilter .savedQueryDropdown .editing_filter_name',
    savedQueryWrap: '#currentPipelineFilter .dropdown.savedQueryDropdown',
    savedQueryItems: '#currentPipelineFilter .saved-query-item, #currentPipelineFilter .dropdown-item.saved-query-item',

    dockRoot: '.az-dock, #serviceDetailDock, #notePanelContainer, .az-dock__top',
    dockTop: '.az-dock__top',
    dockSideActions: '.az-dock__side-actions',
    topName: 'h3.currentCustomerName',
    topTags: '.az-dock__display-tags .az-def-badge, .az-dock__display-tags .az-def-badge.tag',
    vendorSync: '.origin-vendor-sync, [class*="vendor-sync"], [class*="origin-vendor"]',

    mainTab: 'a[href="#tabDetail"][data-toggle="tab"]',
    mainPane: '#tabDetail',
    detailForm: '#detailDockform',
    initialValues: '#detailDockform input[name="initialValues"]',
    updateButton: 'button.btn.btn-primary.action[onclick*="leadDetailTab.doSave"], button.action[onclick*="doSave"]',

    tagOpener: 'a.btn-tag.az-tooltip.tooltipstered, a.btn-tag',
    tagForm: '#add-tag-form',
    tagDropdown: '#add-tag-form > div > div > div.az-form-group.az-tags-select.mb-2 > div > button, button.btn.dropdown-toggle.btn-light[data-toggle="dropdown"][role="combobox"], button.dropdown-toggle.btn-light[role="combobox"], button.dropdown-toggle[role="combobox"]',

    closeCandidates: 'button, a, [role="button"], .close, .btn-close, .az-dock__close'
  };

  const state = {
    destroyed: false,
    tabId: getSharedTabId(),
    running: loadRunning(),
    busy: false,
    logs: [],
    panel: null,
    ui: {},
    picker: null,
    pickerMove: null,
    pickerClick: null,
    pickerKeydown: null,
    hoverBox: null,
    hoveredEl: null,
    providerBanner: null,
    tickTimer: null,
    activeTicketId: '',
    currentAddress: '',
    zillowSummary: '',
    lastStatus: '',
    mainReadyTicketId: '',
    lastWrongAzUrl: '',
    lastSingletonLog: ''
  };

  init();

  function getScriptVersion() {
    try {
      const info = typeof GM_info !== 'undefined' ? GM_info : null;
      return String(info?.script?.version || '').trim() || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function init() {
    window.__AZ_ZILLOW_TICKET_ENRICHER_CLEANUP__ = cleanup;
    if (isAgencyZoomLoginPage()) return;
    if (!claimSingletonPageSlot()) return;

    const legacyJobStateCleared = clearLegacyJobState();
    const resumedAfterReload = consumeBootstrapReloadToken();
    const azJobReset = '';
    const staleJobReset = resetStaleActiveJobOnBoot();
    if (isZillowOrigin()) syncZillowTabJobIdFromLocation();
    if (isAzOrigin() && !getLastZillowOpenAt()) setLastZillowOpenAt();

    if (isAzOrigin()) {
      buildUi();
      bindUi();
      restorePanelPos();
      ensureHoverBox();
      syncWebhookUi();
      renderAll();
    }

    log(`Loaded v${VERSION} on ${location.hostname}`);
    if (legacyJobStateCleared) {
      log('Cleared legacy Zillow job state');
    }
    if (azJobReset) {
      log(azJobReset);
    }
    if (staleJobReset) {
      log(staleJobReset);
    }
    if (resumedAfterReload) {
      log('Resumed after bootstrap reload');
    }

    if (isAzOrigin()) {
      setStatus(state.running ? 'Ready' : 'Stopped');
      state.tickTimer = setInterval(tick, CFG.tickMs);
      tick();
    } else if (isZillowOrigin()) {
      state.tickTimer = setInterval(zillowTick, CFG.tickMs);
      zillowTick();
    }
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { clearInterval(state.tickTimer); } catch {}
    stopPicker('', false);
    try { state.hoverBox?.remove(); } catch {}
    try { state.providerBanner?.remove(); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__AZ_ZILLOW_TICKET_ENRICHER_CLEANUP__; } catch {}
  }

  function stopAutomation(reason = 'Automation stopped') {
    state.running = false;
    saveRunning(false);
    state.busy = false;
    setStatus('Stopped');
    if (reason) log(reason);
    renderAll();
  }

  function isAzOrigin() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function isAgencyZoomLoginPage() {
    return isAzOrigin() && /^\/login(?:\/|$)/i.test(String(location.pathname || ''));
  }

  function isZillowOrigin() {
    return /(^|\.)zillow\.com$/i.test(location.hostname);
  }

  function isPipelinePage() {
    return /\/referral\/pipeline/i.test(location.pathname + location.search);
  }

  function isLeadDetailPage() {
    return /\/lead\/index(?:$|[/?#])/i.test(location.pathname);
  }

  function loadRunning() {
    try {
      const saved = localStorage.getItem(LS_KEYS.running);
      if (saved === '1') return true;
      if (saved === '0') {
        localStorage.removeItem(LS_KEYS.running);
      }
    } catch {}
    return true;
  }

  function saveRunning(on) {
    try {
      if (on) localStorage.setItem(LS_KEYS.running, '1');
      else localStorage.removeItem(LS_KEYS.running);
    } catch {}
  }

  function getLastZillowOpenAt() {
    try {
      return norm(localStorage.getItem(LS_KEYS.lastZillowOpenAt) || '');
    } catch {
      return '';
    }
  }

  function setLastZillowOpenAt(value = nowIso()) {
    const next = norm(value || nowIso()) || nowIso();
    try { localStorage.setItem(LS_KEYS.lastZillowOpenAt, next); } catch {}
    return next;
  }

  function getLastZillowOpenAgeMs() {
    return getIsoAgeMs(getLastZillowOpenAt() || nowIso());
  }

  function normalizeWebhookUrl(value) {
    const text = norm(value);
    if (!text) return '';
    try {
      const parsed = new URL(text);
      if (!/^https?:$/i.test(parsed.protocol || '')) return '';
      return parsed.toString();
    } catch {
      return '';
    }
  }

  function readWebhookUrl() {
    try {
      return normalizeWebhookUrl(localStorage.getItem(LS_KEYS.webhookUrl) || '');
    } catch {
      return '';
    }
  }

  function saveWebhookUrl(value) {
    const normalized = normalizeWebhookUrl(value);
    try {
      if (normalized) localStorage.setItem(LS_KEYS.webhookUrl, normalized);
      else localStorage.removeItem(LS_KEYS.webhookUrl);
    } catch {}
    return normalized;
  }

  function updateActiveWebhookUi(url = readWebhookUrl()) {
    if (state.ui.activeWebhook) state.ui.activeWebhook.textContent = norm(url || '') || '(empty)';
  }

  function syncWebhookUi() {
    const saved = readWebhookUrl();
    if (state.ui.webhookUrl && state.ui.webhookUrl.value !== saved) state.ui.webhookUrl.value = saved;
    updateActiveWebhookUi(saved);
  }

  function persistWebhookFromUi(withLog = false) {
    const raw = norm(state.ui.webhookUrl?.value || '');
    if (raw && !normalizeWebhookUrl(raw)) {
      updateActiveWebhookUi(readWebhookUrl());
      if (withLog) log('Webhook URL invalid; not saved');
      return '';
    }

    const before = readWebhookUrl();
    const saved = saveWebhookUrl(raw);
    updateActiveWebhookUi(saved);
    if (withLog && saved !== before) {
      log(saved ? 'Webhook URL saved' : 'Webhook URL cleared');
    }
    return saved;
  }

  function getWebhookUrl() {
    const uiValue = normalizeWebhookUrl(state.ui.webhookUrl?.value || '');
    return uiValue || readWebhookUrl();
  }

  function readGM(key, fallback = null) {
    try {
      const value = GM_getValue(key, fallback);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeGM(key, value) {
    try { GM_setValue(key, value); } catch {}
  }

  function deleteGM(key) {
    try { GM_deleteValue(key); } catch {}
  }

  function getSharedTabId() {
    try {
      const existing = sessionStorage.getItem(SHARED_TAB_ID_KEY);
      if (existing) return existing;
      const next = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(SHARED_TAB_ID_KEY, next);
      return next;
    } catch {
      return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  function readLocalJson(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function writeLocalJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function logSingletonOnce(key, message) {
    const token = `${key}|${message}`;
    if (state.lastSingletonLog === token) return;
    state.lastSingletonLog = token;
    log(message);
  }

  function closeDuplicateTabSoon() {
    for (const delay of [150, 1200, 2500, 4000]) {
      setTimeout(() => {
        try { window.close(); } catch {}
        try { window.open('', '_self'); } catch {}
        try { window.close(); } catch {}
      }, delay);
    }
  }

  function getPageSlotKey() {
    if (isAzOrigin()) return LS_KEYS.azTabSlot;
    if (isZillowOrigin()) return LS_KEYS.zillowTabSlot;
    return '';
  }

  function claimSingletonPageSlot() {
    const key = getPageSlotKey();
    if (!key) return true;

    const now = Date.now();
    const current = readLocalJson(key, null);
    const currentTabId = String(current?.tabId || '');
    const currentTs = Number(current?.ts || 0);
    if (currentTabId && currentTabId !== state.tabId && currentTs > 0 && (now - currentTs) <= CFG.pageSlotTtlMs) {
      const kind = isAzOrigin() ? 'AgencyZoom' : 'Zillow';
      logSingletonOnce(`page-slot-${kind}`, `${kind} tab slot already owned by another tab; suppressing this copy`);
      closeDuplicateTabSoon();
      return false;
    }

    writeLocalJson(key, {
      tabId: state.tabId,
      ts: now,
      url: String(location.href || ''),
      script: SCRIPT_NAME
    });
    return true;
  }

  function getFreshZillowTabHeartbeat() {
    const heartbeat = readGM(GM_KEYS.zillowTabHeartbeat, null);
    if (!isPlainObject(heartbeat)) return null;
    const ts = Number(heartbeat.ts || 0);
    if (!ts || (Date.now() - ts) > CFG.zillowTabHeartbeatStaleMs) return null;
    return heartbeat;
  }

  function recordZillowTabHeartbeat() {
    if (!isZillowOrigin()) return;
    writeGM(GM_KEYS.zillowTabHeartbeat, {
      tabId: state.tabId,
      ts: Date.now(),
      url: String(location.href || ''),
      script: SCRIPT_NAME
    });
  }

  function getFreshZillowOpenLease() {
    const lease = readGM(GM_KEYS.zillowOpenLease, null);
    if (!isPlainObject(lease)) return null;
    const ts = Number(lease.ts || 0);
    if (!ts || (Date.now() - ts) > CFG.zillowOpenLeaseMs) return null;
    return lease;
  }

  function claimZillowOpenSlot(url, reason = '') {
    const heartbeat = getFreshZillowTabHeartbeat();
    if (heartbeat) {
      logSingletonOnce('zillow-heartbeat', `Skipped opening Zillow; an existing Zillow tab is active: ${norm(heartbeat.url || '') || 'unknown URL'}`);
      return false;
    }

    const lease = getFreshZillowOpenLease();
    if (lease) {
      logSingletonOnce('zillow-open-lease', `Skipped opening Zillow; another open request is still settling: ${norm(lease.url || '') || 'unknown URL'}`);
      return false;
    }

    writeGM(GM_KEYS.zillowOpenLease, {
      tabId: state.tabId,
      ts: Date.now(),
      url: norm(url || ''),
      reason: norm(reason || '')
    });
    return true;
  }

  function clearZillowOpenSlot() {
    deleteGM(GM_KEYS.zillowOpenLease);
  }

  function hasFreshZillowOpenBlock() {
    return !!(getFreshZillowTabHeartbeat() || getFreshZillowOpenLease());
  }

  function readTargets(key) {
    const value = readGM(key, {});
    return isPlainObject(value) ? value : {};
  }

  function saveTargets(key, value) {
    writeGM(key, value);
  }

  function getFieldTargets() {
    return readTargets(GM_KEYS.fieldTargets);
  }

  function getCustomFields() {
    return readTargets(GM_KEYS.customFields);
  }

  function saveCustomFields(value) {
    saveTargets(GM_KEYS.customFields, value);
  }

  function getTagTargets() {
    return readTargets(GM_KEYS.tagTargets);
  }

  function getProviderPickerRequest() {
    const value = readGM(GM_KEYS.providerPicker, null);
    return isPlainObject(value) ? value : null;
  }

  function saveProviderPickerRequest(value) {
    if (!isPlainObject(value)) return;
    writeGM(GM_KEYS.providerPicker, deepClone(value));
  }

  function clearProviderPickerRequest() {
    deleteGM(GM_KEYS.providerPicker);
  }

  function getZillowTabJobId() {
    if (!isZillowOrigin()) return '';
    try {
      return norm(sessionStorage.getItem(SS_KEYS.zillowTabJobId) || '');
    } catch {
      return '';
    }
  }

  function setZillowTabJobId(jobId) {
    if (!isZillowOrigin()) return;
    const value = norm(jobId);
    try {
      if (value) sessionStorage.setItem(SS_KEYS.zillowTabJobId, value);
      else sessionStorage.removeItem(SS_KEYS.zillowTabJobId);
    } catch {}
  }

  function readZillowJobIdFromLocation() {
    if (!isZillowOrigin()) return '';
    const hash = String(location.hash || '').replace(/^#/, '');
    if (!hash) return '';

    for (const segment of hash.split('&')) {
      const [rawKey, rawValue = ''] = segment.split('=');
      if (norm(rawKey) !== ZILLOW_JOB_HASH_KEY) continue;
      try {
        return norm(decodeURIComponent(rawValue || ''));
      } catch {
        return norm(rawValue || '');
      }
    }

    return '';
  }

  function syncZillowTabJobIdFromLocation() {
    const locationJobId = readZillowJobIdFromLocation();
    if (locationJobId) {
      setZillowTabJobId(locationJobId);
      return locationJobId;
    }
    return getZillowTabJobId();
  }

  function getJob() {
    const value = readGM(GM_KEYS.job, null);
    return isPlainObject(value) ? value : null;
  }

  function saveJob(job) {
    if (!isPlainObject(job)) return;
    writeGM(GM_KEYS.job, deepClone(job));
  }

  function clearJob() {
    deleteGM(GM_KEYS.job);
  }

  function clearLegacyJobState() {
    let cleared = false;
    for (const key of LEGACY_GM_JOB_KEYS) {
      const legacyJob = readGM(key, null);
      if (isPlainObject(legacyJob)) cleared = true;
      try { GM_deleteValue(key); } catch {}
    }
    return cleared;
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return value; }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function timeNow() {
    try { return new Date().toLocaleTimeString(); }
    catch { return nowIso(); }
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return norm(value).toLowerCase();
  }

  function escapeRegExp(value) {
    return String(value == null ? '' : value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function cleanTagText(value) {
    return norm(value)
      .replace(/\s+/g, ' ')
      .replace(/[|,;]+$/g, '')
      .trim();
  }

  function lowerTagText(value) {
    return cleanTagText(value).toLowerCase();
  }

  function firstNonEmpty(...values) {
    for (const value of values) {
      const text = norm(value);
      if (text) return text;
    }
    return '';
  }

  function isBaseFieldLabel(label) {
    return FIELD_ORDER.some((item) => lower(item) === lower(label));
  }

  function canonicalFieldLabel(label) {
    const clean = norm(label);
    if (!clean) return '';
    const builtIn = FIELD_ORDER.find((item) => lower(item) === lower(clean));
    return builtIn || clean;
  }

  function getCustomFieldEntries() {
    return Object.entries(getCustomFields())
      .map(([key, value]) => {
        const label = canonicalFieldLabel(value?.label || key);
        return [label, isPlainObject(value) ? { ...value, label } : null];
      })
      .filter(([, value]) => isPlainObject(value) && norm(value.label));
  }

  function getSortedCustomFieldDefs() {
    return getCustomFieldEntries()
      .map(([, value]) => value)
      .sort((a, b) => {
        const aAt = Date.parse(norm(a.createdAt || a.updatedAt || '')) || 0;
        const bAt = Date.parse(norm(b.createdAt || b.updatedAt || '')) || 0;
        if (aAt !== bAt) return aAt - bAt;
        return lower(a.label).localeCompare(lower(b.label));
      });
  }

  function getCustomFieldDef(label) {
    const wanted = canonicalFieldLabel(label);
    if (!wanted || isBaseFieldLabel(wanted)) return null;
    return getSortedCustomFieldDefs().find((item) => lower(item.label) === lower(wanted)) || null;
  }

  function saveCustomFieldDef(label, updates = {}) {
    const fieldLabel = canonicalFieldLabel(label);
    if (!fieldLabel || isBaseFieldLabel(fieldLabel)) return null;

    const defs = getCustomFields();
    const existing = isPlainObject(defs[fieldLabel]) ? defs[fieldLabel] : {};
    defs[fieldLabel] = {
      ...existing,
      ...deepClone(updates),
      label: fieldLabel,
      normalizer: norm(updates.normalizer || existing.normalizer || inferFieldNormalizer(fieldLabel)),
      createdAt: norm(existing.createdAt || updates.createdAt || nowIso()),
      updatedAt: nowIso()
    };
    saveCustomFields(defs);
    return defs[fieldLabel];
  }

  function getAllFieldLabels() {
    const labels = [...FIELD_ORDER];
    for (const item of getSortedCustomFieldDefs()) {
      const label = canonicalFieldLabel(item.label);
      if (!label || labels.some((current) => lower(current) === lower(label))) continue;
      labels.push(label);
    }
    return labels;
  }

  function inferFieldNormalizer(label) {
    const text = lower(label);
    if (!text) return 'text';
    if (text.includes('url')) return 'url';
    if (text.includes('sqft') || text.includes('square ft') || text.includes('square feet') || text.includes('square foot')) return 'integer';
    if (text.includes('bath')) return 'decimal';
    if (text.includes('bed')) return 'room';
    if (text.includes('story') || text.includes('stories') || text.includes('year')) return 'integer';
    if (text.includes('type')) return 'text';
    return 'text';
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isFrontTab() {
    return document.visibilityState !== 'hidden';
  }

  async function waitUntilFrontStable(ms = CFG.frontStableMs) {
    let stableSince = 0;

    while (state.running && !state.destroyed) {
      if (isFrontTab()) {
        if (!stableSince) stableSince = Date.now();
        if ((Date.now() - stableSince) >= ms) return true;
      } else {
        stableSince = 0;
      }
      await sleep(120);
    }

    return false;
  }

  async function foregroundSleep(ms) {
    const end = Date.now() + ms;
    while (state.running && !state.destroyed && Date.now() < end) {
      const ok = await waitUntilFrontStable(0);
      if (!ok) return false;
      await sleep(Math.min(120, Math.max(0, end - Date.now())));
    }
    return state.running && !state.destroyed;
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function log(message) {
    const line = `[${timeNow()}] ${norm(message)}`;
    state.logs.push(line);
    if (state.logs.length > CFG.maxLogLines) {
      state.logs.splice(0, state.logs.length - CFG.maxLogLines);
    }
    renderLogs();
    try { console.log(`[${SCRIPT_NAME}] ${message}`); } catch {}
  }

  function setStatus(text) {
    state.lastStatus = norm(text || '');
    if (state.ui.status) state.ui.status.textContent = state.lastStatus || '-';
  }

  function renderLogs() {
    if (!state.ui.logs) return;
    state.ui.logs.value = state.logs.join('\n');
    state.ui.logs.scrollTop = state.ui.logs.scrollHeight;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|\/@])/g, '\\$1');
  }

  function getStableClassTokens(el) {
    return Array.from(el.classList || [])
      .filter((token) => /^az-|^btn-|^ql-|^dropdown|^tag|^form|^input|^editable/i.test(token))
      .slice(0, 4);
  }

  function buildFingerprint(el) {
    if (!(el instanceof Element)) return {};
    return {
      tag: String(el.tagName || '').toLowerCase(),
      id: norm(el.id || ''),
      name: norm(el.getAttribute('name') || ''),
      role: norm(el.getAttribute('role') || ''),
      ariaLabel: norm(el.getAttribute('aria-label') || ''),
      dataTestId: norm(el.getAttribute('data-testid') || ''),
      dataTest: norm(el.getAttribute('data-test') || ''),
      itemProp: norm(el.getAttribute('itemprop') || ''),
      classTokens: getStableClassTokens(el),
      textFingerprint: norm((el.innerText || el.textContent || '').slice(0, 160))
    };
  }

  function isUniqueSelector(selector) {
    try { return document.querySelectorAll(selector).length === 1; }
    catch { return false; }
  }

  function buildStableSelector(el) {
    if (!(el instanceof Element)) return '';

    const insideTagForm = !!el.closest(SEL.tagForm);
    const role = norm(el.getAttribute('role') || '');
    const classList = Array.from(el.classList || []);
    const isDropdownOption = insideTagForm && (
      role === 'option' ||
      classList.includes('dropdown-item') ||
      !!el.closest('.dropdown-menu')
    );

    if (isDropdownOption) {
      const tag = el.tagName.toLowerCase();
      const classSelector = classList.includes('dropdown-item') ? '.dropdown-item' : '';
      return `${SEL.tagForm} ${tag}${classSelector}${role ? `[role="${cssEscape(role)}"]` : ''}`;
    }

    if (el.id) return `#${cssEscape(el.id)}`;

    const dataTestId = norm(el.getAttribute('data-testid') || '');
    if (dataTestId) {
      const selector = `${el.tagName.toLowerCase()}[data-testid="${cssEscape(dataTestId)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

    const dataTest = norm(el.getAttribute('data-test') || '');
    if (dataTest) {
      const selector = `${el.tagName.toLowerCase()}[data-test="${cssEscape(dataTest)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

    const itemProp = norm(el.getAttribute('itemprop') || '');
    if (itemProp) {
      const selector = `${el.tagName.toLowerCase()}[itemprop="${cssEscape(itemProp)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

    const name = norm(el.getAttribute('name') || '');
    if (name) {
      const selector = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

    const aria = norm(el.getAttribute('aria-label') || '');
    if (role && aria) {
      const selector = `${el.tagName.toLowerCase()}[role="${cssEscape(role)}"][aria-label="${cssEscape(aria)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

    let current = el;
    const parts = [];
    while (current && current.nodeType === 1 && current !== document.body && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${cssEscape(current.id)}`;
        parts.unshift(part);
        break;
      }

      const classes = getStableClassTokens(current);
      if (classes.length) part += '.' + classes.map(cssEscape).join('.');

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }

      parts.unshift(part);
      const selector = parts.join(' > ');
      if (isUniqueSelector(selector)) return selector;
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function matchFingerprint(record, el) {
    if (!(el instanceof Element)) return false;
    const saved = isPlainObject(record?.fingerprint) ? record.fingerprint : {};
    const current = buildFingerprint(el);

    if (saved.id && current.id && saved.id === current.id) return true;

    let score = 0;
    let required = 0;

    if (saved.tag) { required += 1; if (saved.tag === current.tag) score += 1; }
    if (saved.name) { required += 1; if (saved.name === current.name) score += 1; }
    if (saved.role) { required += 1; if (saved.role === current.role) score += 1; }
    if (saved.ariaLabel) { required += 1; if (saved.ariaLabel === current.ariaLabel) score += 1; }
    if (saved.dataTestId) { required += 1; if (saved.dataTestId === current.dataTestId) score += 1; }
    if (saved.dataTest) { required += 1; if (saved.dataTest === current.dataTest) score += 1; }
    if (saved.itemProp) { required += 1; if (saved.itemProp === current.itemProp) score += 1; }
    if (Array.isArray(saved.classTokens) && saved.classTokens.length) {
      required += 1;
      const currentSet = new Set(current.classTokens || []);
      if (saved.classTokens.every((token) => currentSet.has(token))) score += 1;
    }
    if (saved.textFingerprint) {
      required += 1;
      const a = lower(saved.textFingerprint);
      const b = lower(current.textFingerprint);
      if (a && b && (a.includes(b) || b.includes(a))) score += 1;
    }

    if (required === 0) return true;
    if (required === 1) return score === 1;
    return score >= 2;
  }

  function findSavedElement(record) {
    if (!isPlainObject(record)) return null;
    const selector = norm(record.selector || '');
    if (!selector) return null;

    let nodes = [];
    try { nodes = Array.from(document.querySelectorAll(selector)); } catch {}
    const visibleNodes = nodes.filter(visible);
    for (const node of visibleNodes) {
      if (matchFingerprint(record, node)) return node;
    }
    return visibleNodes[0] || nodes[0] || null;
  }

  function resolveEditableTarget(baseEl) {
    if (!(baseEl instanceof Element)) return null;
    const selectors = [
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '.editable-container input:not([type="hidden"]):not([disabled])',
      '.editable-container textarea:not([disabled])',
      '.editable-container select:not([disabled])',
      '.editableform input:not([type="hidden"]):not([disabled])',
      '.editableform textarea:not([disabled])',
      '.editableform select:not([disabled])',
      '.popover input:not([type="hidden"]):not([disabled])',
      '.popover textarea:not([disabled])',
      '.popover select:not([disabled])'
    ].join(', ');

    const candidates = [];
    const add = (el) => {
      if (el && el instanceof Element && !candidates.includes(el)) candidates.push(el);
    };

    const group = baseEl.closest('.form-group, .form-row, .row, .col, td, tr, label, .input-group, .bootstrap-select, .form-control');
    const bootstrapSelect = baseEl.closest('.bootstrap-select') || group?.querySelector?.('.bootstrap-select');

    try { baseEl.matches(selectors) && add(baseEl); } catch {}
    try { baseEl.querySelectorAll(selectors).forEach(add); } catch {}
    try { group?.querySelectorAll(selectors).forEach(add); } catch {}
    try { baseEl.parentElement?.querySelectorAll(selectors).forEach(add); } catch {}
    try { bootstrapSelect?.parentElement?.querySelectorAll('select:not([disabled])').forEach(add); } catch {}
    try {
      const active = document.activeElement;
      if (active instanceof Element && active.matches(selectors)) {
        add(active);
      }
      if (active instanceof Element && (active === baseEl || baseEl.contains(active) || active.closest('.form-group, .form-row, .row, .col, td, tr, label, .input-group, .bootstrap-select, .form-control') === group)) {
        add(active);
      }
    } catch {}
    try {
      document.querySelectorAll('.editable-container, .editableform, .popover').forEach((container) => {
        if (!visible(container)) return;
        container.querySelectorAll(selectors).forEach(add);
      });
    } catch {}

    const score = (el) => {
      if (!(el instanceof Element)) return -1;
      let points = 0;
      if (el instanceof HTMLSelectElement) points += 8;
      else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) points += 7;
      else if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') points += 6;
      else points += 1;
      if (visible(el)) points += 3;
      if (el === document.activeElement) points += 5;
      if (el !== baseEl) points += 2;
      if (bootstrapSelect && (bootstrapSelect.contains(el) || el.closest('.bootstrap-select') === bootstrapSelect)) points += 2;
      if (el.closest('.editable-container, .editableform, .popover')) points += 4;
      return points;
    };

    return candidates.sort((a, b) => score(b) - score(a))[0] || baseEl;
  }

  function dispatchFieldEvents(target) {
    for (const type of ['focus', 'input', 'change', 'blur']) {
      try {
        const event = type === 'blur' || type === 'focus'
          ? new FocusEvent(type, { bubbles: true, composed: true })
          : new Event(type, { bubbles: true, composed: true });
        target.dispatchEvent(event);
      } catch {}
    }
  }

  function setNativeValue(target, value) {
    const proto = Object.getPrototypeOf(target);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(target, value);
    else target.value = value;
  }

  function verifyFieldValue(target, expected) {
    const want = norm(expected);

    if (target instanceof HTMLSelectElement) {
      return lower(target.value) === lower(expected)
        || lower(target.selectedOptions?.[0]?.textContent || '') === lower(expected)
        || (!want && !norm(target.value));
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return norm(target.value) === want;
    }

    if (target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox') {
      return norm(target.innerText || target.textContent || '') === want;
    }

    return norm(target.textContent || '') === want;
  }

  function readCurrentFieldValue(target) {
    if (!(target instanceof Element)) return '';
    if (target instanceof HTMLSelectElement) {
      return norm(target.selectedOptions?.[0]?.textContent || target.value || '');
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return norm(target.value || target.getAttribute('value') || '');
    }
    if (target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox') {
      return norm(target.innerText || target.textContent || '');
    }
    return norm(target.textContent || '');
  }

  function hasMeaningfulExistingFieldValue(value) {
    const text = norm(value);
    if (!text) return false;

    const lowered = lower(text)
      .replace(/[.:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!lowered) return false;

    if (
      lowered === '-' ||
      lowered === '--' ||
      lowered === '---' ||
      lowered === 'none' ||
      lowered === 'n/a' ||
      lowered === 'na' ||
      lowered === 'null' ||
      lowered === 'select' ||
      lowered === 'select one' ||
      lowered === 'select option' ||
      lowered === 'choose' ||
      lowered === 'choose one' ||
      lowered === 'choose option' ||
      lowered === 'empty' ||
      lowered === 'not set' ||
      lowered === 'not selected' ||
      lowered === 'not specified' ||
      lowered === 'not provided' ||
      lowered === 'no value' ||
      lowered === 'add value' ||
      lowered === 'enter value' ||
      lowered === 'click to edit' ||
      lowered === 'click here to edit' ||
      lowered === 'edit'
    ) return false;

    if (/^(select|choose)\b/.test(lowered)) return false;
    if (/^(add|enter|click)\b.*\b(value|edit)\b/.test(lowered)) return false;
    return true;
  }

  function getInlineEditorContainer(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('.editable-container, .editableform, .popover') || null;
  }

  function findInlineEditorSubmitButton(target) {
    const container = getInlineEditorContainer(target);
    if (!(container instanceof Element)) return null;

    const candidates = Array.from(container.querySelectorAll(
      '.editable-submit, button[type="submit"], input[type="submit"], button.btn-primary, a.btn-primary, button, a'
    )).filter(visible);

    return candidates.find((el) => {
      const text = lower([
        el.textContent,
        el.getAttribute?.('title'),
        el.getAttribute?.('aria-label'),
        el.getAttribute?.('value')
      ].filter(Boolean).join(' '));
      const cls = String(el.className || '').toLowerCase();
      if (cls.includes('editable-cancel') || text.includes('cancel')) return false;
      if (cls.includes('editable-submit')) return true;
      if (el.matches?.('button[type="submit"], input[type="submit"]')) return true;
      return text === 'ok' || text === 'save' || text === 'update' || text === 'apply' || text.includes('check');
    }) || null;
  }

  async function maybeCommitInlineEditor(target) {
    const button = findInlineEditorSubmitButton(target);
    if (!button) return false;
    strongClick(button);
    await sleep(420);
    return true;
  }

  async function waitForEditableTarget(base) {
    const started = Date.now();
    let chosen = null;
    while ((Date.now() - started) < 2200) {
      chosen = resolveEditableTarget(base) || base;
      if (
        chosen instanceof HTMLInputElement ||
        chosen instanceof HTMLTextAreaElement ||
        chosen instanceof HTMLSelectElement ||
        chosen.getAttribute?.('contenteditable') === 'true' ||
        chosen.getAttribute?.('role') === 'textbox'
      ) {
        return chosen;
      }
      await sleep(120);
    }
    return chosen || base;
  }

  async function setFieldValue(record, value) {
    const base = findSavedElement(record);
    if (!base) return { ok: false, reason: 'saved field target not found' };

    const nextValue = norm(value);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try { strongClick(base); } catch {}
      await sleep(180);
      const target = await waitForEditableTarget(base);
      const editableTarget = target instanceof HTMLSelectElement
        || target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target.getAttribute?.('contenteditable') === 'true'
        || target.getAttribute?.('role') === 'textbox';

      if (!editableTarget) {
        await sleep(220);
        continue;
      }

      const currentValue = readCurrentFieldValue(target);
      if (hasMeaningfulExistingFieldValue(currentValue)) {
        return { ok: true, skipped: 'existing-value', currentValue };
      }

      if (target instanceof HTMLSelectElement) {
        const options = Array.from(target.options || []);
        let match = options.find((opt) => lower(opt.textContent || '') === lower(nextValue) || lower(opt.value || '') === lower(nextValue));
        if (!match && nextValue) {
          match = options.find((opt) => lower(opt.textContent || '').includes(lower(nextValue)) || lower(nextValue).includes(lower(opt.textContent || '')));
        }
        target.value = match ? match.value : '';
        if (match) match.selected = true;
        try { target.setAttribute('value', target.value); } catch {}
        dispatchFieldEvents(target);
      } else if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        try { target.focus({ preventScroll: true }); } catch {}
        setNativeValue(target, '');
        try { target.setAttribute('value', ''); } catch {}
        dispatchFieldEvents(target);
        setNativeValue(target, nextValue);
        try { target.setAttribute('value', nextValue); } catch {}
        dispatchFieldEvents(target);
      } else if (target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox') {
        target.innerHTML = nextValue ? `<p>${escapeHtml(nextValue)}</p>` : '<p><br></p>';
        dispatchFieldEvents(target);
      }

      const committedInlineEditor = await maybeCommitInlineEditor(target);
      await sleep(committedInlineEditor ? 360 : 220);
      if (
        verifyFieldValue(target, nextValue) ||
        verifyFieldValue(base, nextValue) ||
        (committedInlineEditor && (!target.isConnected || !visible(target)))
      ) {
        return { ok: true };
      }
    }

    return { ok: false, reason: 'editable target not found or value did not stick' };
  }

  function strongClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
    }
    try { el.click(); return true; } catch { return false; }
  }

  function showBootstrapTab(anchor) {
    if (!anchor) return false;
    try {
      const $ = window.jQuery;
      if ($ && typeof $(anchor).tab === 'function') {
        $(anchor).tab('show');
        return true;
      }
    } catch {}

    strongClick(anchor);

    try {
      const href = anchor.getAttribute('href');
      if (href && href.startsWith('#')) {
        document.querySelectorAll('a[data-toggle="tab"]').forEach((a) => a.classList.remove('active'));
        anchor.classList.add('active');
        document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active', 'show'));
        const target = document.querySelector(href);
        if (target) target.classList.add('active', 'show');
      }
    } catch {}

    return true;
  }

  function waitFor(fn, timeoutMs, intervalMs = CFG.stepPollMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const loop = () => {
        if (state.destroyed) return resolve(null);
        try {
          const result = fn();
          if (result) return resolve(result);
        } catch {}
        if ((Date.now() - started) >= timeoutMs) return resolve(null);
        setTimeout(loop, intervalMs);
      };
      loop();
    });
  }

  function findVisibleElements(selector) {
    try { return Array.from(document.querySelectorAll(selector)).filter(visible); }
    catch { return []; }
  }

  function scoreDockRoot(root) {
    if (!(root instanceof Element) || !visible(root)) return -1;
    let score = 0;
    if (root.matches('#serviceDetailDock')) score += 8;
    if (root.querySelector(SEL.detailForm)) score += 6;
    if (root.querySelector(SEL.topName)) score += 5;
    if (root.querySelector(SEL.vendorSync)) score += 5;
    if (extractTicketIdFromText(root.textContent || '')) score += 4;
    if (root.querySelector(SEL.tagOpener)) score += 2;
    if (root.querySelector(SEL.mainTab)) score += 2;
    if (root.matches('#notePanelContainer')) score -= 4;
    if (root.matches('.az-dock__top')) score -= 2;
    return score;
  }

  function getOpenDockRoot() {
    const seen = new Set();
    const candidates = [];
    for (const root of Array.from(document.querySelectorAll(SEL.dockRoot))) {
      if (!(root instanceof Element) || seen.has(root)) continue;
      seen.add(root);
      candidates.push(root);
    }
    if (!candidates.length) return null;

    let best = null;
    let bestScore = -1;
    for (const root of candidates) {
      const score = scoreDockRoot(root);
      if (score > bestScore) {
        best = root;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function extractTicketIdFromText(text) {
    const clean = norm(text || '');
    if (!clean) return '';
    const match = clean.match(/\bID:\s*(\d{5,})\b/i) || clean.match(/\b(\d{5,})\b/);
    return match ? match[1] : '';
  }

  function getOpenTicketInfo() {
    const root = getOpenDockRoot();
    if (!root) return { ticketId: '', name: '', tags: [] };

    const top = document.querySelector(SEL.dockTop) || root;
    const h3 = top.querySelector(SEL.topName) || root.querySelector(SEL.topName);

    let name = '';
    if (h3) {
      const clone = h3.cloneNode(true);
      clone.querySelector('.origin-vendor-sync')?.remove();
      name = norm(clone.textContent || '');
    }

    let ticketId = '';
    const syncNode = root.querySelector(SEL.vendorSync);
    ticketId = extractTicketIdFromText(syncNode?.textContent || '');
    if (!ticketId) ticketId = extractTicketIdFromText(root.textContent || '');

    const tags = Array.from(root.querySelectorAll(SEL.topTags))
      .map((el) => norm(el.textContent))
      .filter(Boolean);

    return { ticketId, name, tags };
  }

  function getActivePipelineTicketContext(expectedTicketId = '') {
    if (!isPipelinePage()) {
      return {
        ok: false,
        reason: isLeadDetailPage()
          ? 'Lead details page detected; pipeline ticket drawer required'
          : 'Pipeline ticket drawer required'
      };
    }

    if (!isTicketDrawerOpen()) {
      return { ok: false, reason: 'No open pipeline ticket drawer found' };
    }

    const info = getOpenTicketInfo();
    const openTicketId = norm(info.ticketId || '');
    if (!openTicketId) {
      return { ok: false, reason: 'Open pipeline ticket id could not be read' };
    }

    const wantedTicketId = norm(expectedTicketId || '');
    if (wantedTicketId && openTicketId !== wantedTicketId) {
      return {
        ok: false,
        reason: `Open pipeline ticket ${openTicketId} does not match expected ${wantedTicketId}`
      };
    }

    return { ok: true, ticketId: openTicketId, info };
  }

  function isTicketDrawerOpen() {
    const side = document.querySelector(SEL.dockSideActions);
    return !!(side && visible(side));
  }

  function getCurrentSavedQueryLabel() {
    return norm(document.querySelector(SEL.savedQueryLabel)?.textContent || document.querySelector(SEL.savedQueryButton)?.textContent || '');
  }

  function matchesIgnoredV2Label(value) {
    const text = lower(value);
    return (CFG.savedQueryAliases || []).some((name) => {
      const want = lower(name);
      return !!want && (text === want || text.includes(want));
    });
  }

  function isIgnoredV2Selected() {
    return matchesIgnoredV2Label(getCurrentSavedQueryLabel());
  }

  function isSavedQueryDropdownOpen() {
    const wrap = document.querySelector(SEL.savedQueryWrap);
    const btn = document.querySelector(SEL.savedQueryButton);
    return !!(
      wrap?.classList.contains('show') ||
      String(btn?.getAttribute('aria-expanded') || '').toLowerCase() === 'true'
    );
  }

  function getIgnoredV2Candidates() {
    const candidates = [];
    const seen = new Set();

    for (const el of Array.from(document.querySelectorAll(SEL.savedQueryItems))) {
      if (!(el instanceof Element) || seen.has(el)) continue;
      seen.add(el);

      const text = lower(el.textContent || '');
      const dataId = norm(el.getAttribute('data-id') || '');
      const url = lower(el.getAttribute('url') || '');
      let score = 0;
      if (visible(el)) score += 3;
      if (dataId && dataId === CFG.savedQueryDataId) score += 10;
      if (url && url.includes(lower(CFG.savedQueryUrlNeedle))) score += 8;
      if (matchesIgnoredV2Label(text)) score += 6;
      if (score <= 0) continue;

      candidates.push({ el, score, text, dataId, url });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  function findIgnoredV2Option() {
    const first = getIgnoredV2Candidates()[0] || null;
    return first && first.score >= 6 ? first.el : null;
  }

  async function openSavedQueryDropdown() {
    const btn = document.querySelector(SEL.savedQueryButton);
    const wrap = document.querySelector(SEL.savedQueryWrap);
    if (!btn || !visible(btn)) {
      log('Saved query filter button not found');
      return false;
    }

    if (isSavedQueryDropdownOpen()) return true;

    const attempts = [
      () => strongClick(btn),
      () => strongClick(wrap || btn.parentElement || btn),
      () => {
        const $ = window.jQuery || window.$;
        if ($ && typeof $(btn).dropdown === 'function') {
          $(btn).dropdown('toggle');
          return true;
        }
        return false;
      },
      () => {
        try {
          btn.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            bubbles: true,
            cancelable: true
          }));
          btn.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            bubbles: true,
            cancelable: true
          }));
          return true;
        } catch {
          return false;
        }
      }
    ];

    for (const attempt of attempts) {
      try { attempt(); } catch {}
      await sleep(220);
      if (isSavedQueryDropdownOpen()) return true;
    }

    return isSavedQueryDropdownOpen() || !!findIgnoredV2Option();
  }

  async function activateSavedQueryItem(item) {
    if (!(item instanceof Element)) return false;

    const attempts = [
      () => strongClick(item),
      () => {
        try { item.click(); return true; } catch { return false; }
      },
      () => {
        const $ = window.jQuery || window.$;
        if ($) {
          $(item).trigger('click');
          return true;
        }
        return false;
      },
      () => {
        try {
          item.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: item.ownerDocument?.defaultView || window
          }));
          return true;
        } catch {
          return false;
        }
      }
    ];

    for (const attempt of attempts) {
      try { attempt(); } catch {}
      await sleep(260);
      if (isIgnoredV2Selected()) {
        await sleep(CFG.filterSettleMs);
        return true;
      }
    }

    return false;
  }

  async function ensureIgnoredV2Filter() {
    if (isIgnoredV2Selected()) return true;

    const opened = await openSavedQueryDropdown();
    if (!opened) {
      log(`Could not open saved query dropdown for ${CFG.savedQueryName}`);
      return false;
    }

    const item = findIgnoredV2Option();
    if (!item) {
      log(`Saved query option not found: ${CFG.savedQueryName}`);
      return false;
    }

    const clicked = await activateSavedQueryItem(item);
    log(`${clicked ? 'Triggered' : 'Tried'} saved query: ${CFG.savedQueryName}`);
    if (clicked && isIgnoredV2Selected()) return true;

    const started = Date.now();
    while ((Date.now() - started) < 6000) {
      if (!state.running || state.destroyed) return false;
      if (isIgnoredV2Selected()) {
        await sleep(CFG.filterSettleMs);
        return true;
      }
      await sleep(120);
    }

    log(`Saved query did not switch to ${CFG.savedQueryName}`);
    return false;
  }

  function getStageWrap() {
    return Array.from(document.querySelectorAll(SEL.stageWrap))
      .find((wrap) => visible(wrap) && !!wrap.parentElement) || null;
  }

  function getStageContainer() {
    return getStageWrap()?.parentElement || null;
  }

  function getVisibleStageCards() {
    const stage = getStageContainer();
    const cards = stage ? Array.from(stage.querySelectorAll(SEL.stageCards)) : Array.from(document.querySelectorAll(SEL.stageCards));
    return cards.filter(visible);
  }

  function getTicketOpenTargets(card) {
    const link = card?.querySelector(SEL.customerLink) || null;
    return [link, card].filter((target, index, list) => target && list.indexOf(target) === index);
  }

  function describeTicketOpenTarget(target, card) {
    if (!(target instanceof Element)) return 'unknown target';
    if (target === card) return 'ticket card';

    const tag = String(target.tagName || '').toLowerCase();
    const classes = Array.from(target.classList || []).slice(0, 3).join('.');
    return classes ? `${tag}.${classes}` : tag;
  }

  async function waitForOpenTicket(ticketId, timeoutMs = CFG.openTryMs, options = {}) {
    const started = Date.now();
    let lastDrawerKey = '';
    const targetLabel = norm(options?.targetLabel || 'ticket target');

    while ((Date.now() - started) < timeoutMs) {
      if (!state.running || state.destroyed) return false;
      const info = getOpenTicketInfo();
      if (String(info.ticketId || '') === String(ticketId || '')) return true;

      if (isTicketDrawerOpen()) {
        const openId = norm(info.ticketId || '');
        const drawerKey = openId || '__blank__';
        if (lastDrawerKey !== drawerKey) {
          lastDrawerKey = drawerKey;
          if (openId && openId !== norm(ticketId || '')) {
            log(`Drawer opened for ${openId} after clicking ${targetLabel}; wanted ${ticketId || '(unknown)'}`);
          } else if (!openId) {
            log(`Drawer opened after clicking ${targetLabel}, but the ticket ID was not readable yet | wanted ${ticketId || '(unknown)'}`);
          }
        }
      }

      await sleep(120);
    }

    return false;
  }

  async function openCard(card, ticketId) {
    const currentOpen = getOpenTicketInfo().ticketId;
    if (currentOpen && currentOpen !== ticketId) {
      await closeTicketDrawer();
      await foregroundSleep(CFG.gapMs);
    }
    if (currentOpen && currentOpen === ticketId && isTicketDrawerOpen()) return true;
    if (isTicketDrawerOpen()) {
      log(`Closing stray open drawer before opening ${ticketId} | ${currentOpen || 'unknown ticket'}`);
      const closed = await closeTicketDrawer();
      if (!closed) return false;
      await foregroundSleep(CFG.gapMs);
    }

    const targets = getTicketOpenTargets(card);
    const overallStart = Date.now();

    while (state.running && !state.destroyed && (Date.now() - overallStart) < CFG.openTotalMs) {
      const stable = await waitUntilFrontStable(CFG.frontStableMs);
      if (!stable) return false;

      for (const target of targets) {
        if (!target) continue;
        const targetLabel = describeTicketOpenTarget(target, card);
        strongClick(target);
        log(`Clicked ${targetLabel}, waiting for ticket ${ticketId}...`);
        const ok = await waitForOpenTicket(ticketId, CFG.openTryMs, { targetLabel });
        if (ok) return true;

        if (isTicketDrawerOpen()) {
          const strayInfo = getOpenTicketInfo();
          const strayId = norm(strayInfo.ticketId || '');
          if (strayId && strayId !== norm(ticketId || '')) {
            log(`Wrong drawer opened for ${strayId} while waiting for ${ticketId}; closing and retrying`);
          } else {
            log(`Drawer opened without a matching ticket ID after clicking ${targetLabel}; closing and retrying ${ticketId}`);
          }
          const closed = await closeTicketDrawer();
          if (!closed) return false;
          await foregroundSleep(CFG.gapMs);
        }
      }

      const okGap = await foregroundSleep(CFG.gapMs);
      if (!okGap) return false;
    }

    return false;
  }

  function parseInitialValuesJson() {
    const input = document.querySelector(SEL.initialValues);
    if (!input) return null;

    const raw = input.value || input.getAttribute('value') || '';
    if (!raw) return null;

    let parsed = safeJsonParse(raw, null);
    if (parsed) return parsed;

    parsed = safeJsonParse(htmlDecode(raw), null);
    return parsed || null;
  }

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function htmlDecode(text) {
    const ta = document.createElement('textarea');
    ta.innerHTML = String(text || '');
    return ta.value;
  }

  function readVal(selector) {
    const el = document.querySelector(selector);
    return norm(el?.value || el?.textContent || '');
  }

  function readAzAddressInfo(fallbackTicketId = '') {
    const initial = parseInitialValuesJson() || {};
    const cr = initial?.CustomerReferral || {};
    const openInfo = getOpenTicketInfo();

    const street = firstNonEmpty(cr.address1, readVal('#customerreferral-address1'));
    const city = firstNonEmpty(cr.city, readVal('#customerreferral-city'));
    const stateValue = firstNonEmpty(cr.state, readVal('#state'));
    const postal = firstNonEmpty(cr.zip, readVal('#customerreferral-zip'));
    const ticketId = firstNonEmpty(initial?.id, initial?.instaId, openInfo.ticketId, fallbackTicketId);

    const cityStateZip = [city, [stateValue, postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const address = [street, cityStateZip].filter(Boolean).join(', ').replace(/, ,/g, ',').trim();

    return {
      ticketId,
      street,
      city,
      state: stateValue,
      postal,
      address
    };
  }

  function isMainTabReady() {
    const pane = document.querySelector(SEL.mainPane);
    const form = document.querySelector(SEL.detailForm);
    const tab = document.querySelector(SEL.mainTab);
    const paneReady = !!(pane && (pane.classList.contains('active') || pane.classList.contains('show') || visible(pane)));
    const formReady = !!(form && visible(form));
    const tabReady = !!(tab && tab.classList.contains('active'));
    return paneReady || formReady || tabReady;
  }

  async function ensureMainTab() {
    const mainTab = document.querySelector(SEL.mainTab);
    if (!mainTab || !visible(mainTab)) {
      log('Main tab button not found');
      return false;
    }

    if (isMainTabReady()) {
      return true;
    }

    showBootstrapTab(mainTab);
    log('Clicked: Main tab');
    await sleep(CFG.majorStepDelayMs);

    const ready = await waitFor(() => isMainTabReady(), CFG.mainReadyMs);

    if (!ready) {
      log('Main tab did not become ready');
      return false;
    }

    return true;
  }

  function findUpdateButton() {
    const bySelector = findVisibleElements(SEL.updateButton)[0];
    if (bySelector) return bySelector;
    return Array.from(document.querySelectorAll('button,a,[role="button"]'))
      .filter(visible)
      .find((el) => lower(el.textContent || '') === 'update' || lower(el.textContent || '').includes('update')) || null;
  }

  async function clickUpdateButton() {
    const button = findUpdateButton();
    if (!button) {
      log('Update button not found');
      return false;
    }

    strongClick(button);
    log('Clicked: Update');
    await sleep(CFG.updateSettleMs);
    return true;
  }

  function findCloseButton() {
    const roots = [
      document.querySelector('#serviceDetailDock'),
      document.querySelector('#notePanelContainer'),
      document.querySelector('.az-dock'),
      document
    ].filter(Boolean);

    for (const root of roots) {
      const els = Array.from(root.querySelectorAll(SEL.closeCandidates)).filter(visible);
      for (const el of els) {
        const txt = norm([
          el.textContent,
          el.getAttribute?.('title'),
          el.getAttribute?.('aria-label'),
          el.getAttribute?.('data-original-title')
        ].filter(Boolean).join(' '));
        const cls = String(el.className || '').toLowerCase();
        if (lower(txt) === 'close' || lower(txt).includes('close') || lower(txt) === 'x' || cls.includes('close')) {
          return el;
        }
      }
    }

    return null;
  }

  function fireEscape() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true
      }));
      document.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true
      }));
    } catch {}
  }

  async function closeTicketDrawer() {
    if (!isTicketDrawerOpen()) return true;

    const before = getOpenTicketInfo().ticketId;
    const btn = findCloseButton();
    if (btn) strongClick(btn);
    else fireEscape();

    const started = Date.now();
    while ((Date.now() - started) < CFG.closeWaitMs) {
      if (!state.running || state.destroyed) return true;
      if (!isTicketDrawerOpen()) {
        log(`Closed ticket drawer for ${before || 'current ticket'}`);
        return true;
      }
      await sleep(120);
    }

    log(`Close timed out for ${before || 'current ticket'}`);
    return false;
  }

  function hasAllFieldTargets() {
    const targets = getFieldTargets();
    return FIELD_ORDER.every((label) => isPlainObject(targets[label]) && norm(targets[label].selector));
  }

  function hasAllTagTargets() {
    const targets = getTagTargets();
    return TAG_ORDER.every((item) => isPlainObject(targets[item.key]) && (norm(targets[item.key].value) || cleanTagText(targets[item.key].label)));
  }

  function getFieldTargetStatusText() {
    const targets = getFieldTargets();
    const baseSaved = FIELD_ORDER.filter((label) => isPlainObject(targets[label]) && norm(targets[label].selector)).length;
    const customDefs = getSortedCustomFieldDefs();
    if (!customDefs.length) return `${baseSaved}/${FIELD_ORDER.length} saved`;

    const customSaved = customDefs.filter((item) => {
      const azTarget = targets[item.label];
      return isPlainObject(azTarget)
        && norm(azTarget.selector)
        && isPlainObject(item.providerTarget)
        && norm(item.providerTarget.selector);
    }).length;
    return `${baseSaved}/${FIELD_ORDER.length} base + ${customSaved}/${customDefs.length} custom`;
  }

  function getTagTargetStatusText() {
    const targets = getTagTargets();
    const count = TAG_ORDER.filter((item) => isPlainObject(targets[item.key]) && (norm(targets[item.key].value) || cleanTagText(targets[item.key].label))).length;
    return `${count}/${TAG_ORDER.length} saved`;
  }

  function normalizeRoomValue(value) {
    const text = norm(value);
    if (!text) return '';
    if (/^studio$/i.test(text)) return 'Studio';
    const numberMatch = text.match(/\d+(?:\.\d+)?/);
    return numberMatch ? numberMatch[0] : text;
  }

  function normalizeHomeType(value) {
    return norm(value);
  }

  function normalizeCustomFieldValue(label, value, normalizer = '') {
    const mode = lower(normalizer || inferFieldNormalizer(label));
    const text = norm(value);
    if (!text) return '';

    if (mode === 'url') {
      const urlMatch = text.match(/https?:\/\/\S+/i);
      return norm(urlMatch ? urlMatch[0] : text);
    }

    if (mode === 'integer') {
      const numberMatch = text.match(/[\d,]+/);
      return numberMatch ? numberMatch[0].replace(/,/g, '') : '';
    }

    if (mode === 'decimal') {
      const numberMatch = text.match(/\d+(?:\.\d+)?/);
      return numberMatch ? numberMatch[0] : '';
    }

    if (mode === 'room') {
      return normalizeRoomValue(text);
    }

    return text;
  }

  function getFallbackCustomFieldValue(label, value, job) {
    const _job = job;
    void _job;
    return normalizeCustomFieldValue(label, value, inferFieldNormalizer(label));
  }

  function readElementDisplayValue(target) {
    if (!(target instanceof Element)) return '';
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return norm(target.value || target.getAttribute('value') || '');
    }
    if (target instanceof HTMLSelectElement) {
      return norm(target.selectedOptions?.[0]?.textContent || target.value || '');
    }
    if (target instanceof HTMLAnchorElement && norm(target.href)) {
      return norm(target.innerText || target.textContent || '') || norm(target.href);
    }
    return norm(target.innerText || target.textContent || target.getAttribute('aria-label') || '');
  }

  function extractCustomFieldValueFromProvider(fieldDef) {
    if (!isPlainObject(fieldDef) || !isPlainObject(fieldDef.providerTarget)) return '';
    const target = findSavedElement(fieldDef.providerTarget);
    if (!(target instanceof Element)) return '';
    return normalizeCustomFieldValue(fieldDef.label, readElementDisplayValue(target), fieldDef.normalizer);
  }

  function getCustomFieldValueMap(resultLike = {}) {
    const source = isPlainObject(resultLike?.customFields) ? resultLike.customFields : {};
    const values = {};
    for (const fieldDef of getSortedCustomFieldDefs()) {
      const label = canonicalFieldLabel(fieldDef.label);
      if (!label) continue;
      values[label] = norm(source[label]);
    }
    return values;
  }

  function hasAnyCustomFieldValues(resultLike = {}) {
    return Object.values(getCustomFieldValueMap(resultLike)).some((value) => !!norm(value));
  }

  function buildScrapedCustomFieldValues() {
    const customFields = {};
    for (const fieldDef of getSortedCustomFieldDefs()) {
      const label = canonicalFieldLabel(fieldDef.label);
      if (!label) continue;
      customFields[label] = extractCustomFieldValueFromProvider(fieldDef);
    }
    return customFields;
  }

  function extractBedroomTextValue(text) {
    const source = norm(text);
    if (!source) return '';
    const labeledMatch = source.match(/\b(?:Bedrooms?|Beds?)\s*:\s*([^|,;\n]+)/i);
    if (labeledMatch) return norm(labeledMatch[1]);
    if (/\bstudio\b/i.test(source)) return 'Studio';
    const shorthandMatch = source.match(/\b(\d+(?:\.\d+)?)\s*(?:bd|bds|bed|beds|bedroom|bedrooms)\b/i);
    return shorthandMatch ? norm(shorthandMatch[1]) : '';
  }

  function extractBathroomTextValue(text) {
    const source = norm(text);
    if (!source) return '';
    const labeledMatch = source.match(/\b(?:Bathrooms?|Baths?)\s*:\s*([^|,;\n]+)/i);
    if (labeledMatch) return norm(labeledMatch[1]);
    const shorthandMatch = source.match(/\b(\d+(?:\.\d+)?)\s*(?:ba|bas|bath|baths|bathroom|bathrooms)\b/i);
    return shorthandMatch ? norm(shorthandMatch[1]) : '';
  }

  function extractHomeTypeFromText(text) {
    const source = norm(text);
    if (!source) return '';
    const labeledMatch = source.match(/\b(?:Home Type|Property Type)\s*:\s*([^|,;\n]+)/i);
    if (labeledMatch) return norm(labeledMatch[1]);
    const match = source.match(/\b(single family(?: residence| home)?|singlefamily|multi family|multifamily|townhouse|townhome|condo|condominium|apartment|duplex|triplex|manufactured(?: home)?|mobile home|mobilemanufactured|co-?op)\b/i);
    return match ? norm(match[1]) : '';
  }

  function summarizeResult(result) {
    if (!isPlainObject(result)) return '-';
    const parts = [
      norm(result.bedrooms),
      norm(result.bathrooms),
      norm(result.homeType)
    ].filter(Boolean);
    const customParts = Object.entries(getCustomFieldValueMap(result))
      .filter(([, value]) => !!norm(value))
      .slice(0, 3)
      .map(([label, value]) => `${label}: ${value}`);
    return [...parts, ...customParts].join(' | ') || norm(result.zillowUrl || '') || '-';
  }

  function buildZillowSearchUrl(address) {
    return `https://www.zillow.com/homes/${encodeURIComponent(address)}`;
  }

  function buildScopedZillowUrl(url, jobId) {
    const baseUrl = norm(url);
    const scopeId = norm(jobId);
    if (!baseUrl || !scopeId) return baseUrl;

    try {
      const parsed = new URL(baseUrl);
      parsed.hash = `${ZILLOW_JOB_HASH_KEY}=${encodeURIComponent(scopeId)}`;
      return parsed.toString();
    } catch {
      const cleaned = baseUrl.replace(/#.*$/, '');
      return `${cleaned}#${ZILLOW_JOB_HASH_KEY}=${encodeURIComponent(scopeId)}`;
    }
  }

  function createJobId(ticketId) {
    const ticket = norm(ticketId || 'az') || 'az';
    const random = Math.random().toString(36).slice(2, 8);
    return `${ticket}-${Date.now()}-${random}`;
  }

  function isZillowListingPage() {
    return /\/homedetails\/|_zpid\//i.test(location.pathname + location.search);
  }

  function getJobAgeMs(job) {
    return Math.max(0, Date.now() - Date.parse(norm(job?.createdAt || nowIso())));
  }

  function getJobActiveAgeMs(job) {
    return getIsoAgeMs(job?.lastLaunchAt || job?.searchOpenedAt || job?.createdAt);
  }

  function getJobLaunchCount(job) {
    const raw = Number(job?.launchCount || 0);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return Math.floor(raw);
  }

  function resetStaleActiveJobOnBoot() {
    const job = getJob();
    if (!isPlainObject(job)) return '';
    const status = norm(job?.status || '');
    if (!['pending', 'searching'].includes(status)) return '';

    const ageMs = getJobActiveAgeMs(job);
    if (ageMs < CFG.zillowWaitMs) return '';

    const ticketId = norm(job?.ticketId || '');
    clearJob();
    return `Cleared stale Zillow job${ticketId ? ` for AZ ${ticketId}` : ''}`;
  }

  function clearStoredJobOnAzLoad() {
    const job = getJob();
    if (!isPlainObject(job)) return '';
    const ticketId = norm(job?.ticketId || '');
    const status = norm(job?.status || '');
    clearJob();
    return `Cleared stored Zillow job on AgencyZoom load${ticketId ? ` for AZ ${ticketId}` : ''}${status ? ` (${status})` : ''}`;
  }

  function hasZillowJobProgress(job) {
    if (!isPlainObject(job)) return false;
    if (isPlainObject(job.result)) return true;
    return !!norm(job?.listingNavigatedAt || job?.listingSeenAt || job?.resultReadyAt || '');
  }

  function getZillowJobErrorText(job, fallback = 'Unknown Zillow error') {
    return norm(job?.error || fallback) || fallback;
  }

  function getFallbackRoomValue(value) {
    return normalizeRoomValue(value);
  }

  function getFallbackHomeType(value) {
    return normalizeHomeType(value);
  }

  function buildFallbackResult(job, overrides = null) {
    const extra = isPlainObject(overrides) ? overrides : {};
    const extraCustom = getCustomFieldValueMap(extra);
    const customFields = {};
    for (const label of getAllFieldLabels().filter((item) => !isBaseFieldLabel(item))) {
      customFields[label] = getFallbackCustomFieldValue(label, extraCustom[label], job);
    }
    return {
      zillowUrl: firstNonEmpty(extra.zillowUrl, job?.searchUrl),
      bedrooms: getFallbackRoomValue(extra.bedrooms),
      bathrooms: getFallbackRoomValue(extra.bathrooms),
      homeType: getFallbackHomeType(extra.homeType),
      customFields
    };
  }

  function resultHasRoomFacts(result) {
    return !!norm(result?.bedrooms) || !!norm(result?.bathrooms);
  }

  function getMissingRequiredZillowFactLabels(result) {
    const missing = [];
    if (!norm(result?.bedrooms)) missing.push('Bedrooms');
    if (!norm(result?.bathrooms)) missing.push('Bathrooms');
    if (!norm(result?.homeType)) missing.push('Home Type');
    return missing;
  }

  function buildWebhookPayload(job) {
    const result = isPlainObject(job?.result) ? job.result : {};
    return {
      script: SCRIPT_NAME,
      version: VERSION,
      sentAt: nowIso(),
      ticketId: norm(job?.ticketId || state.activeTicketId || ''),
      jobId: norm(job?.jobId || ''),
      address: firstNonEmpty(norm(job?.address || ''), norm(state.currentAddress || '')),
      zillowUrl: firstNonEmpty(norm(result?.zillowUrl || ''), norm(job?.searchUrl || '')),
      bedrooms: norm(result?.bedrooms || ''),
      bathrooms: norm(result?.bathrooms || ''),
      homeType: norm(result?.homeType || ''),
      customFields: getCustomFieldValueMap(result)
    };
  }

  function gmHttpRequest(details) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          timeout: 45000,
          ...details,
          onload: (response) => resolve(response),
          onerror: (error) => reject(error || new Error('Request failed')),
          ontimeout: () => reject(new Error('Request timed out'))
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function sendWebhookForJob(job) {
    if (!isPlainObject(job)) return true;
    if (norm(job.webhookDeliveredAt || '')) return true;

    const endpoint = getWebhookUrl();
    if (!endpoint) return true;

    const payload = buildWebhookPayload(job);
    if (!payload.ticketId) {
      log('Webhook skipped: missing ticket ID');
      return true;
    }

    setStatus(`Sending webhook for ${payload.ticketId}`);
    const response = await gmHttpRequest({
      method: 'POST',
      url: endpoint,
      headers: {
        'Content-Type': 'application/json'
      },
      data: JSON.stringify(payload)
    });

    const status = Number(response?.status || 0);
    if (!(status >= 200 && status < 300)) {
      throw new Error(`Webhook HTTP ${status || 'error'}`);
    }

    job.webhookDeliveredAt = nowIso();
    job.webhookEndpoint = endpoint;
    job.updatedAt = nowIso();
    saveJob(job);
    log(`Webhook sent for AZ ${payload.ticketId}`);
    return true;
  }

  function reportJobFailureOnce(job) {
    if (!isPlainObject(job)) return;
    if (norm(job.azFailureReportedAt || '')) return;
    const reason = getZillowJobErrorText(job);
    log(`Zillow job failed for AZ ${norm(job.ticketId || state.activeTicketId || '?')}: ${reason}`);
    job.azFailureReportedAt = nowIso();
    job.updatedAt = nowIso();
    saveJob(job);
  }

  function reportCaptchaWaitOnce(job) {
    if (!isPlainObject(job)) return;
    if (norm(job.azCaptchaReportedAt || '')) return;
    const reason = getZillowJobErrorText(job, 'Zillow captcha detected');
    log(`Zillow captcha detected for AZ ${norm(job.ticketId || state.activeTicketId || '?')}: ${reason}. Solve it in the Zillow tab to resume.`);
    job.azCaptchaReportedAt = nowIso();
    job.updatedAt = nowIso();
    saveJob(job);
  }

  function markJobCaptcha(job, reason) {
    if (!isPlainObject(job)) return false;
    job.status = 'captcha';
    job.updatedAt = nowIso();
    job.error = norm(reason || 'Zillow captcha detected');
    if (!norm(job.captchaDetectedAt || '')) job.captchaDetectedAt = nowIso();
    saveJob(job);
    return true;
  }

  function getCaptchaRefreshBaseIso(job) {
    return firstNonEmpty(job?.captchaLastRefreshAt, job?.captchaDetectedAt, job?.updatedAt, job?.createdAt, nowIso());
  }

  function closeCurrentTabSoon() {
    for (const delay of [250, 1200, 2500, 5000]) {
      setTimeout(() => {
        try { window.close(); } catch {}
        try { window.open('', '_self'); } catch {}
        try { window.close(); } catch {}
      }, delay);
    }
  }

  function reloadThisPageSoon(reason = '') {
    const message = norm(reason || 'Reload requested');
    if (message) {
      try { console.log(`[${SCRIPT_NAME}] ${message}; reloading page`); } catch {}
      if (isAzOrigin()) log(`${message}; reloading page`);
    }

    setTimeout(() => {
      try {
        location.reload();
        return;
      } catch {}
      try { location.href = location.href; } catch {}
    }, 250);
  }

  function reloadZillowPageForJob(job, reason = '') {
    if (!isPlainObject(job)) {
      reloadThisPageSoon(reason || 'Reloading Zillow');
      return false;
    }

    job.status = 'searching';
    job.updatedAt = nowIso();
    job.error = norm(reason || 'Reloading Zillow for missing data');
    job.lastLaunchAt = nowIso();
    if (isZillowListingPage()) job.listingSeenAt = '';
    else job.listingNavigatedAt = '';
    saveJob(job);
    reloadThisPageSoon(job.error);
    return true;
  }

  function reloadAgencyZoomForFreshZillowAttempt(job, reason = '') {
    if (isPlainObject(job)) {
      job.status = 'pending';
      job.updatedAt = nowIso();
      job.error = norm(reason || 'Reloading for fresh Zillow attempt');
      job.result = null;
      job.resultReadyAt = '';
      job.searchOpenedAt = '';
      job.lastLaunchAt = '';
      job.listingNavigatedAt = '';
      job.listingSeenAt = '';
      saveJob(job);
    } else {
      clearJob();
    }

    clearZillowOpenSlot();
    setStatus('Reloading page');
    requestBootstrapReload(reason || 'fresh-zillow-attempt');
    return true;
  }

  function getIsoAgeMs(value) {
    return Math.max(0, Date.now() - Date.parse(norm(value || nowIso())));
  }

  function shouldRelaunchStaleZillowJob(job) {
    if (!isPlainObject(job)) return false;
    const launches = getJobLaunchCount(job);
    if (launches >= CFG.zillowMaxLaunches) return false;

    const status = norm(job.status || '');
    if (!['pending', 'searching'].includes(status)) return false;

    if (!norm(job.listingSeenAt || '')) {
      return getJobActiveAgeMs(job) >= CFG.zillowStaleMs;
    }

    return getJobActiveAgeMs(job) > CFG.zillowWaitMs;
  }

  function jobMatchesTicket(job, ticketId) {
    return norm(job?.ticketId || '') && norm(job?.ticketId || '') === norm(ticketId || '');
  }

  function createJob(ticketId, addressInfo) {
    const job = {
      jobId: createJobId(ticketId || addressInfo?.ticketId || ''),
      ticketId: norm(ticketId || addressInfo?.ticketId || ''),
      address: norm(addressInfo?.address || ''),
      street: norm(addressInfo?.street || ''),
      city: norm(addressInfo?.city || ''),
      state: norm(addressInfo?.state || ''),
      postal: norm(addressInfo?.postal || ''),
      searchUrl: buildZillowSearchUrl(addressInfo?.address || ''),
      status: 'pending',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      launchCount: 0,
      result: null,
      error: ''
    };
    saveJob(job);
    return job;
  }

  function launchZillowSearch(job) {
    if (!isPlainObject(job) || !norm(job.searchUrl || '')) return false;
    const launchUrl = buildScopedZillowUrl(job.searchUrl, job.jobId);
    if (!claimZillowOpenSlot(launchUrl, `job-${norm(job.jobId || '')}`)) {
      job.status = 'pending';
      job.updatedAt = nowIso();
      job.error = 'Waiting for existing Zillow tab to close';
      saveJob(job);
      return false;
    }

    job.status = 'searching';
    job.updatedAt = nowIso();
    job.searchOpenedAt = nowIso();
    job.lastLaunchAt = job.searchOpenedAt;
    job.launchCount = getJobLaunchCount(job) + 1;
    job.error = '';
    job.listingNavigatedAt = '';
    job.listingSeenAt = '';
    job.resultReadyAt = '';
    job.result = null;
    saveJob(job);

    try {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(launchUrl, { active: false, insert: true, setParent: true });
        setLastZillowOpenAt(job.searchOpenedAt);
        return true;
      }
    } catch {}

    try {
      const opened = window.open(launchUrl, '_blank');
      if (opened) {
        try { opened.blur(); } catch {}
        setTimeout(() => { try { window.focus(); } catch {} }, 40);
        setTimeout(() => { try { window.focus(); } catch {} }, 220);
        setLastZillowOpenAt(job.searchOpenedAt);
      }
      if (opened) return true;
    } catch {
      // Fall through to clear the lease below.
    }

    clearZillowOpenSlot();
    return false;
  }

  function currentZillowTabMatchesJob(job) {
    const tabJobId = syncZillowTabJobIdFromLocation();
    const activeJobId = norm(job?.jobId || '');
    if (!tabJobId || !activeJobId) return true;
    return tabJobId === activeJobId;
  }

  function handleExistingZillowJob(job) {
    const jobStatus = norm(job?.status || '');
    const sameTicketJob = jobMatchesTicket(job, state.activeTicketId);
    if (!sameTicketJob) return false;

    if (jobStatus === 'captcha') {
      state.currentAddress = firstNonEmpty(state.currentAddress, job?.address);
      state.zillowSummary = firstNonEmpty(norm(job?.error || ''), summarizeResult(job?.result));
      reportCaptchaWaitOnce(job);
      if (getIsoAgeMs(getCaptchaRefreshBaseIso(job)) >= CFG.zillowCaptchaRefreshMs) {
        job.captchaLastRefreshAt = nowIso();
        job.updatedAt = nowIso();
        saveJob(job);
        setStatus(`Refreshing after Zillow captcha wait for ${state.activeTicketId}`);
        log(`Refreshing page after 3 minutes waiting on Zillow captcha for AZ ${state.activeTicketId}`);
        requestBootstrapReload(`captcha-wait-${state.activeTicketId}`);
        return true;
      }
      setStatus(`Waiting for human Zillow captcha for ${state.activeTicketId}`);
      return true;
    }

    if (['pending', 'searching'].includes(jobStatus)) {
      state.currentAddress = firstNonEmpty(state.currentAddress, job?.address);
      state.zillowSummary = summarizeResult(job?.result);

      if (jobStatus === 'pending' && !norm(job.searchOpenedAt || '')) {
        if (hasFreshZillowOpenBlock()) {
          setStatus('Waiting for existing Zillow tab');
          return true;
        }

        const opened = launchZillowSearch(job);
        if (opened) {
          setStatus(`Opening Zillow for ${state.activeTicketId}`);
          log(`Opened Zillow search: ${job.searchUrl}`);
        } else if (hasFreshZillowOpenBlock()) {
          setStatus('Waiting for existing Zillow tab');
        } else {
          job.status = 'failed';
          job.updatedAt = nowIso();
          job.error = 'Could not open Zillow tab';
          saveJob(job);
          setStatus('Could not open Zillow tab');
          log('Could not open Zillow tab');
        }
        return true;
      }

      const ageMs = getJobActiveAgeMs(job);
      if (!hasZillowJobProgress(job) && ageMs >= CFG.zillowDeadPageMs) {
        reloadAgencyZoomForFreshZillowAttempt(job, 'Zillow opened but no property data ever loaded');
        return true;
      }

      if (shouldRelaunchStaleZillowJob(job)) {
        const reopened = launchZillowSearch(job);
        if (reopened) {
          setStatus(`Relaunching Zillow for ${state.activeTicketId}`);
          log(`Relaunching stale Zillow search: ${job.searchUrl}`);
        } else if (hasFreshZillowOpenBlock()) {
          setStatus('Waiting for existing Zillow tab');
        } else {
          job.status = 'failed';
          job.updatedAt = nowIso();
          job.error = 'Could not relaunch stale Zillow tab';
          saveJob(job);
          setStatus('Could not relaunch Zillow tab');
          log('Could not relaunch stale Zillow tab');
        }
        return true;
      }

      if (ageMs > CFG.zillowWaitMs) {
        reloadAgencyZoomForFreshZillowAttempt(job, 'Zillow scrape timed out');
        return true;
      }

      const remaining = Math.max(1, Math.ceil((CFG.zillowWaitMs - ageMs) / 1000));
      setStatus(`Waiting for Zillow (${remaining}s)`);
      return true;
    }

    if (jobStatus === 'failed') {
      state.currentAddress = firstNonEmpty(state.currentAddress, job?.address);
      state.zillowSummary = summarizeResult(job?.result);
      reloadAgencyZoomForFreshZillowAttempt(job, getZillowJobErrorText(job));
      return true;
    }

    return false;
  }

  function extractFirstLabeledValue(labels) {
    for (const label of labels) {
      const value = extractLabelValueFromBody(label);
      if (norm(value)) return value;
    }
    return '';
  }

  function extractLabeledValueFromDom(label) {
    const wanted = norm(label);
    if (!wanted) return '';

    const directPattern = new RegExp(`^${escapeRegExp(wanted)}\\s*:\\s*(.+)$`, 'i');
    const inlinePattern = new RegExp(`\\b${escapeRegExp(wanted)}\\s*:\\s*([^|,;\\n]+)`, 'i');
    const candidates = Array.from(document.querySelectorAll('li span, li, span, dd, dt, div'))
      .filter((el) => el instanceof HTMLElement && visible(el));

    for (const el of candidates) {
      const text = norm(el.innerText || el.textContent || '');
      if (!text || text.length > 120) continue;

      const directMatch = text.match(directPattern);
      if (directMatch && norm(directMatch[1])) return text;

      const inlineMatch = text.match(inlinePattern);
      if (inlineMatch && norm(inlineMatch[1])) return norm(inlineMatch[0]);
    }

    return '';
  }

  function extractLabelValueFromBody(label) {
    const fromDom = extractLabeledValueFromDom(label);
    if (fromDom) return fromDom;

    const text = document.body?.innerText || '';
    if (!text) return '';
    const match = text.match(new RegExp(`${escapeRegExp(label)}\\s*:\\s*([^\\n]+)`, 'i'));
    return match ? norm(match[0]) : '';
  }

  function extractHomeTypeFromDom() {
    const candidates = Array.from(document.querySelectorAll('span, li, div, dd, dt'))
      .filter((el) => el instanceof HTMLElement && visible(el));

    for (const el of candidates) {
      const text = norm(el.innerText || el.textContent || '');
      if (!text || text.length > 80) continue;
      const match = text.match(/\b(single family(?: residence| home)?|singlefamily|multi family|multifamily|townhouse|townhome|condo|condominium|apartment|duplex|triplex|manufactured(?: home)?|mobile home|mobilemanufactured|co-?op)\b/i);
      if (match) return norm(match[1]);
    }

    return '';
  }

  function extractHomeTypeFromBody() {
    const bodyText = document.body?.innerText || '';
    if (!bodyText) return '';
    return extractHomeTypeFromText(bodyText);
  }

  function extractRegexValue(text, patterns) {
    const source = String(text || '');
    const variants = Array.from(new Set([
      source,
      source
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/\\u0022/g, '"')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\u002F/g, '/')
    ]));

    for (const variant of variants) {
      for (const pattern of patterns) {
        const match = variant.match(pattern);
        if (match && norm(match[1])) return norm(match[1]);
      }
    }
    return '';
  }

  function isScalarZillowFactValue(value) {
    return typeof value === 'string' || typeof value === 'number';
  }

  function maybeSetZillowFactHint(hints, key, value) {
    if (!isScalarZillowFactValue(value)) return;
    const cleanKey = String(key || '');
    const cleanValue = norm(value);
    if (!cleanValue) return;

    if (!hints.bedrooms && /^(bedrooms?|beds?|numBedrooms|numberOfBedrooms|bedroomsTotal)$/i.test(cleanKey)) {
      hints.bedrooms = cleanValue;
      return;
    }

    if (!hints.bathrooms && /^(bathrooms?|baths?|numBathrooms|numberOfBathrooms|numberOfBathroomsTotal|bathroomsTotal|bathroomsFloat|bathroomsFull)$/i.test(cleanKey)) {
      hints.bathrooms = cleanValue;
      return;
    }

    if (!hints.homeType && /^(homeType|home_type|propertyType|propertyTypeDimension|propertySubType)$/i.test(cleanKey)) {
      hints.homeType = cleanValue;
    }
  }

  function collectZillowFactHints(value, hints, depth = 0) {
    if (depth > 14 || !value || typeof value !== 'object') return hints;
    if (hints.bedrooms && hints.bathrooms && hints.homeType) return hints;

    if (Array.isArray(value)) {
      for (const item of value) {
        collectZillowFactHints(item, hints, depth + 1);
        if (hints.bedrooms && hints.bathrooms && hints.homeType) break;
      }
      return hints;
    }

    for (const [key, entry] of Object.entries(value)) {
      maybeSetZillowFactHint(hints, key, entry);
      if (entry && typeof entry === 'object') collectZillowFactHints(entry, hints, depth + 1);
      if (hints.bedrooms && hints.bathrooms && hints.homeType) break;
    }

    return hints;
  }

  function parseZillowJsonText(text) {
    const source = norm(text);
    if (!source) return null;
    const variants = Array.from(new Set([
      source,
      source.replace(/&quot;/g, '"').replace(/&#34;/g, '"')
    ]));

    for (const variant of variants) {
      try { return JSON.parse(variant); } catch {}
    }
    return null;
  }

  function readZillowJsonHints() {
    const hints = { bedrooms: '', bathrooms: '', homeType: '' };
    const scripts = Array.from(document.scripts || []);
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text || text.length > 5000000) continue;
      const type = lower(script.getAttribute('type') || '');
      const id = lower(script.id || '');
      if (!type.includes('json') && !id.includes('next') && !id.includes('hdp')) continue;

      const parsed = parseZillowJsonText(text);
      if (!parsed) continue;
      collectZillowFactHints(parsed, hints);
      if (hints.bedrooms && hints.bathrooms && hints.homeType) break;
    }
    return hints;
  }

  function readZillowScriptHints() {
    const joined = Array.from(document.scripts || [])
      .map((script) => script.textContent || '')
      .join('\n');
    const jsonHints = readZillowJsonHints();

    return {
      bedrooms: firstNonEmpty(jsonHints.bedrooms, extractRegexValue(joined, [
        /["']?bedrooms?["']?\s*:\s*"?([0-9.]+)"?/i,
        /"bedrooms?"\s*:\s*"?([0-9.]+)"?/i,
        /"beds?"\s*:\s*"?([0-9.]+)"?/i,
        /"numberOfRooms"\s*:\s*"?([0-9.]+)"?/i,
        /"numberOfBedrooms"\s*:\s*"?([0-9.]+)"?/i,
        /"numBedrooms"\s*:\s*"?([0-9.]+)"?/i,
        /"bedroomsTotal"\s*:\s*"?([0-9.]+)"?/i
      ])),
      bathrooms: firstNonEmpty(jsonHints.bathrooms, extractRegexValue(joined, [
        /["']?bathrooms?["']?\s*:\s*"?([0-9.]+)"?/i,
        /"bathrooms?"\s*:\s*"?([0-9.]+)"?/i,
        /"baths?"\s*:\s*"?([0-9.]+)"?/i,
        /["']?numberOfBathroomsTotal["']?\s*:\s*"?([0-9.]+)"?/i,
        /["']?numberOfBathrooms["']?\s*:\s*"?([0-9.]+)"?/i,
        /["']?numBathrooms["']?\s*:\s*"?([0-9.]+)"?/i,
        /["']?bathroomsTotal["']?\s*:\s*"?([0-9.]+)"?/i,
        /["']?bathroomsFull["']?\s*:\s*"?([0-9.]+)"?/i,
        /["']?bathroomsFloat["']?\s*:\s*"?([0-9.]+)"?/i
      ])),
      homeType: firstNonEmpty(jsonHints.homeType, extractRegexValue(joined, [
        /["']?homeType["']?\s*:\s*"([^"]+)"/i,
        /"homeType"\s*:\s*"([^"]+)"/i,
        /"home_type"\s*:\s*"([^"]+)"/i,
        /"propertyType(?:Dimension)?"\s*:\s*"([^"]+)"/i,
        /"propertySubType"\s*:\s*"([^"]+)"/i
      ]))
    };
  }

  function findLikelyZillowListingLink(job) {
    const streetNumber = firstNonEmpty(norm(job?.address || '').match(/^\d+/)?.[0]);
    const streetTokens = norm(job?.street || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !['street', 'st', 'avenue', 'ave', 'road', 'rd', 'drive', 'dr', 'lane', 'ln', 'court', 'ct', 'boulevard', 'blvd', 'circle', 'cir', 'place', 'pl', 'way', 'trail', 'trl', 'highway', 'hwy'].includes(token))
      .slice(0, 4);
    const cityToken = norm(job?.city || '').toLowerCase();
    const postalToken = norm(job?.postal || '').toLowerCase();
    const anchors = Array.from(document.querySelectorAll('a[href*="/homedetails/"], a[href*="_zpid/"], a[data-test="property-card-link"]'))
      .filter((el) => el instanceof HTMLAnchorElement && norm(el.href));

    let best = null;
    let bestScore = -1;
    for (const anchor of anchors) {
      const haystack = lower([anchor.href, anchor.textContent, anchor.getAttribute('aria-label')].filter(Boolean).join(' '));
      let score = 0;
      if (haystack.includes('/homedetails/')) score += 8;
      if (haystack.includes('_zpid')) score += 4;
      if (streetNumber && haystack.includes(lower(streetNumber))) score += 6;
      if (postalToken && haystack.includes(postalToken)) score += 6;
      if (cityToken && haystack.includes(cityToken)) score += 3;
      for (const token of streetTokens) {
        if (haystack.includes(token)) score += 2;
      }
      if (visible(anchor)) score += 2;
      if (score > bestScore) {
        best = anchor;
        bestScore = score;
      }
    }

    return bestScore >= 8 ? best : null;
  }

  function scrapeZillowSearchResultCard(job) {
    const anchor = findLikelyZillowListingLink(job);
    if (!(anchor instanceof HTMLAnchorElement) || !norm(anchor.href)) return null;

    const card = anchor.closest('article, li, [data-test="property-card"], [class*="StyledPropertyCard"], [class*="property-card"], [class*="PropertyCard"], [class*="ListItem"]') || anchor.parentElement || anchor;
    const text = norm([
      anchor.getAttribute('aria-label'),
      card?.innerText,
      anchor.innerText
    ].filter(Boolean).join(' '));
    if (!text) return null;

    const bedrooms = normalizeRoomValue(extractBedroomTextValue(text));
    const bathrooms = normalizeRoomValue(extractBathroomTextValue(text));
    const homeType = normalizeHomeType(extractHomeTypeFromText(text));

    if (!norm(bedrooms) && !norm(bathrooms) && !norm(homeType)) return null;

    return {
      zillowUrl: anchor.href,
      bedrooms,
      bathrooms,
      homeType,
      customFields: {}
    };
  }

  function hasVisibleZillowContentSignals(job) {
    if (isZillowListingPage()) return true;
    if (scrapeZillowSearchResultCard(job)) return true;
    if (findLikelyZillowListingLink(job)) return true;

    const factLabels = [
      extractFirstLabeledValue(['Bedrooms', 'Bedroom', 'Beds', 'Bed']),
      extractFirstLabeledValue(['Bathrooms', 'Bathroom', 'Baths', 'Bath']),
      extractHomeTypeFromDom(),
      extractHomeTypeFromBody()
    ];
    return factLabels.some((value) => !!norm(value));
  }

  function hasVisibleCaptchaSignals(selectors) {
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector));
      if (matches.some((el) => visible(el))) return true;
    }
    return false;
  }

  function detectZillowVerificationBlock(job) {
    const title = norm(document.title || '');
    const body = norm(document.body?.innerText || '');
    const text = lower([title, body].filter(Boolean).join(' '));
    if (hasVisibleZillowContentSignals(job)) return '';

    const strongCaptchaSignals = [
      '[id*="px-captcha"]',
      '[class*="px-captcha"]',
      'iframe[src*="captcha"]',
      'form[action*="captcha"]',
      '[data-testid*="captcha"]'
    ];

    if (hasVisibleCaptchaSignals(strongCaptchaSignals)) {
      return 'Zillow verification required (PerimeterX page)';
    }

    if (!text) return '';

    if (
      text.includes('access to this page has been denied') ||
      text.includes('press & hold') ||
      text.includes('press and hold') ||
      text.includes('before we continue') ||
      text.includes('confirm you are human') ||
      text.includes('reference id') ||
      text.includes('verify you are human') ||
      text.includes('unusual traffic')
    ) {
      return 'Zillow verification required (Press & Hold page)';
    }

    if (text.includes('captcha') && text.includes('zillow')) {
      return 'Zillow verification required (captcha page)';
    }

    return '';
  }

  function scrapeZillowResult() {
    const bodyText = document.body?.innerText || '';
    const hints = readZillowScriptHints();
    const bedrooms = normalizeRoomValue(firstNonEmpty(
      extractFirstLabeledValue(['Bedrooms', 'Bedroom', 'Beds', 'Bed']),
      extractBedroomTextValue(bodyText),
      hints.bedrooms
    ));
    const bathrooms = normalizeRoomValue(firstNonEmpty(
      extractFirstLabeledValue(['Bathrooms', 'Bathroom', 'Baths', 'Bath']),
      extractBathroomTextValue(bodyText),
      hints.bathrooms
    ));
    const homeType = normalizeHomeType(firstNonEmpty(
      extractHomeTypeFromDom(),
      extractHomeTypeFromBody(),
      hints.homeType
    ));
    const customFields = buildScrapedCustomFieldValues();

    return {
      zillowUrl: location.href,
      bedrooms,
      bathrooms,
      homeType,
      customFields
    };
  }

  async function zillowTick() {
    if (state.destroyed || !isZillowOrigin()) return;
    if (!claimSingletonPageSlot()) return;
    recordZillowTabHeartbeat();

    if (await maybeHandleProviderPickerOnZillow()) return;

    syncZillowTabJobIdFromLocation();
    const job = getJob();
    if (!isPlainObject(job)) {
      setZillowTabJobId('');
      return;
    }
    if (!['pending', 'searching', 'captcha'].includes(norm(job.status || ''))) return;
    if (!currentZillowTabMatchesJob(job)) return;

    const verificationBlock = detectZillowVerificationBlock(job);
    if (verificationBlock) {
      if (norm(job.status || '') !== 'captcha') {
        markJobCaptcha(job, verificationBlock);
        try { console.log(`[${SCRIPT_NAME}] Waiting for human captcha solve for ${job.ticketId}: ${verificationBlock}`); } catch {}
      }
      return;
    }

    if (norm(job.status || '') === 'captcha') {
      job.status = 'searching';
      job.updatedAt = nowIso();
      job.error = '';
      job.azCaptchaReportedAt = '';
      job.captchaSolvedAt = nowIso();
      saveJob(job);
      try { console.log(`[${SCRIPT_NAME}] Zillow captcha cleared for ${job.ticketId}; resuming scrape`); } catch {}
    }

    if (!isZillowListingPage()) {
      const cardResult = scrapeZillowSearchResultCard(job);
      const cardHasAnyFacts = !!cardResult && (
        resultHasRoomFacts(cardResult)
        || !!norm(cardResult?.homeType)
        || hasAnyCustomFieldValues(cardResult)
      );
      if (!norm(job.listingNavigatedAt || '')) {
        const listing = findLikelyZillowListingLink(job);
        if (listing?.href) {
          job.listingNavigatedAt = nowIso();
          job.updatedAt = nowIso();
          saveJob(job);
          try { location.assign(listing.href); } catch {}
          return;
        }
      }

      if (cardResult && cardHasAnyFacts && getJobActiveAgeMs(job) >= CFG.zillowSearchFallbackMs) {
        const missingCardFacts = getMissingRequiredZillowFactLabels(cardResult);
        if (missingCardFacts.length) {
          reloadZillowPageForJob(job, `Zillow search result missing ${missingCardFacts.join(', ')}`);
          return;
        }

        job.status = 'result-ready';
        job.updatedAt = nowIso();
        job.resultReadyAt = nowIso();
        job.result = buildFallbackResult(job, cardResult);
        saveJob(job);
        try { console.log(`[${SCRIPT_NAME}] Zillow search-card fallback ready for ${job.ticketId}: ${summarizeResult(cardResult)}`); } catch {}
        clearZillowOpenSlot();
        closeCurrentTabSoon();
        return;
      }

      if (!cardResult && !hasZillowJobProgress(job) && getJobActiveAgeMs(job) >= CFG.zillowDeadPageMs) {
        const reason = `Zillow opened but no usable property page appeared (${firstNonEmpty(norm(document.title || ''), location.pathname || 'unknown page')})`;
        reloadZillowPageForJob(job, reason);
        return;
      }

      return;
    }

    if (!norm(job.listingSeenAt || '')) {
      job.listingSeenAt = nowIso();
      job.updatedAt = nowIso();
      saveJob(job);
    }

    const scraped = scrapeZillowResult();
    const missingRequiredFacts = getMissingRequiredZillowFactLabels(scraped);
    const listingSeenAtMs = Date.parse(norm(job.listingSeenAt || '')) || Date.now();
    const listingAgeMs = Math.max(0, Date.now() - listingSeenAtMs);

    if (missingRequiredFacts.length) {
      if (listingAgeMs >= CFG.zillowFactSettleMs) {
        const reason = `Zillow listing missing ${missingRequiredFacts.join(', ')} (${firstNonEmpty(norm(document.title || ''), location.pathname || 'unknown listing')})`;
        reloadZillowPageForJob(job, reason);
      }
      return;
    }

    job.status = 'result-ready';
    job.updatedAt = nowIso();
    job.resultReadyAt = nowIso();
    job.result = buildFallbackResult(job, {
      ...scraped,
      zillowUrl: location.href
    });
    saveJob(job);

    try { console.log(`[${SCRIPT_NAME}] Zillow scrape ready for ${job.ticketId}: ${summarizeResult(scraped)}`); } catch {}
    clearZillowOpenSlot();
    closeCurrentTabSoon();
  }

  function getOpenTicketTagLabels() {
    return Array.from(new Set(
      (getOpenTicketInfo().tags || [])
        .map((tag) => cleanTagText(tag))
        .filter(Boolean)
    ));
  }

  function findTagOpener() {
    const direct = findVisibleElements(SEL.tagOpener)[0];
    if (direct) return direct;

    const icon = Array.from(document.querySelectorAll('i.fal.fa-tag')).find(visible);
    if (icon) return icon.closest('a,button,[role="button"]');

    return null;
  }

  function findTagDropdown() {
    const form = findVisibleElements(SEL.tagForm)[0];
    if (form) {
      const exactCandidates = [
        '#add-tag-form > div > div > div.az-form-group.az-tags-select.mb-2 > div > button',
        'div.az-form-group.az-tags-select.mb-2 > div > button',
        '.az-form-group.az-tags-select button.dropdown-toggle.btn-light',
        'button.dropdown-toggle.btn-light[data-toggle="dropdown"][role="combobox"]',
        'button.dropdown-toggle.btn-light[role="combobox"]',
        'button[role="combobox"]',
        'button.dropdown-toggle'
      ];

      for (const selector of exactCandidates) {
        try {
          const el = selector.startsWith('#add-tag-form')
            ? document.querySelector(selector)
            : form.querySelector(selector);
          if (visible(el)) return el;
        } catch {}
      }
    }
    return null;
  }

  function findTagSelect(form) {
    if (!(form instanceof Element)) return null;
    const selects = Array.from(form.querySelectorAll('select'));
    if (!selects.length) return null;
    selects.sort((a, b) => ((b.options?.length || 0) - (a.options?.length || 0)));
    return selects[0] || null;
  }

  function getTagOptionLabel(option) {
    if (!(option instanceof HTMLOptionElement)) return '';
    return cleanTagText(option.textContent || option.label || '');
  }

  function valueForExactTagLabel(selectEl, label) {
    if (!(selectEl instanceof HTMLSelectElement)) return '';
    const wanted = lowerTagText(label);
    if (!wanted) return '';
    for (const option of Array.from(selectEl.options || [])) {
      if (option.disabled) continue;
      if (lowerTagText(getTagOptionLabel(option)) === wanted) {
        return norm(option.value || '');
      }
    }
    return '';
  }

  function optionLabelForValue(selectEl, value) {
    if (!(selectEl instanceof HTMLSelectElement)) return '';
    const wanted = norm(value);
    if (!wanted) return '';
    for (const option of Array.from(selectEl.options || [])) {
      if (norm(option.value || '') === wanted) return getTagOptionLabel(option);
    }
    return '';
  }

  function selectHasOptionValue(selectEl, value) {
    return !!optionLabelForValue(selectEl, value);
  }

  function getSelectedTagValues(selectEl) {
    if (!(selectEl instanceof HTMLSelectElement)) return [];
    const values = [];
    for (const option of Array.from(selectEl.options || [])) {
      if (!option.selected) continue;
      const value = norm(option.value || '');
      if (value) values.push(value);
    }
    return values;
  }

  function refreshTagSelectpicker(selectEl) {
    try {
      const $ = window.jQuery || window.$;
      if ($ && typeof $.fn?.selectpicker === 'function') {
        $(selectEl).selectpicker('refresh');
      }
    } catch {}
  }

  function resolveTagValuesByLabels(selectEl, labels) {
    const values = [];
    const missingLabels = [];
    const seen = new Set();
    for (const label of Array.isArray(labels) ? labels : []) {
      const cleanLabel = cleanTagText(label);
      if (!cleanLabel) continue;
      const value = valueForExactTagLabel(selectEl, cleanLabel);
      if (!value) {
        missingLabels.push(cleanLabel);
        continue;
      }
      if (seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
    return { values, missingLabels };
  }

  function setSelectedTagValues(selectEl, values) {
    if (!(selectEl instanceof HTMLSelectElement)) return false;
    const wanted = Array.from(new Set((values || []).map((value) => norm(value)).filter(Boolean)));
    const wantedSet = new Set(wanted);
    const current = getSelectedTagValues(selectEl);
    const currentSet = new Set(current);
    const changed = currentSet.size !== wantedSet.size || wanted.some((value) => !currentSet.has(value));

    for (const option of Array.from(selectEl.options || [])) {
      const value = norm(option.value || '');
      if (!value) continue;
      option.selected = wantedSet.has(value);
    }

    try {
      const $ = window.jQuery || window.$;
      if ($ && typeof $.fn?.selectpicker === 'function') {
        $(selectEl).selectpicker('val', wanted);
      }
    } catch {}

    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    refreshTagSelectpicker(selectEl);
    return changed;
  }

  function getTagMenuItems(root = null) {
    const scope = root instanceof Element ? root : document;
    return Array.from(scope.querySelectorAll('.dropdown-item, a[id^="bs-select-"], li[role="option"], a[role="option"], [role="option"]'))
      .filter((el) => visible(el) && cleanTagText(el.textContent || ''));
  }

  function getTagPickerItemFromTarget(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('.dropdown-item, a[id^="bs-select-"], li[role="option"], a[role="option"], [role="option"]');
  }

  function buildTagTargetRecord(target) {
    const optionEl = getTagPickerItemFromTarget(target);
    if (!optionEl) return null;

    const labelNode = optionEl.querySelector('span.text, .text');
    const clickedLabel = cleanTagText(labelNode?.textContent || optionEl.textContent || '');
    if (!clickedLabel) return null;

    const form = optionEl.closest(SEL.tagForm) || findVisibleElements(SEL.tagForm)[0] || document.querySelector(SEL.tagForm);
    const selectEl = findTagSelect(form);
    if (!(selectEl instanceof HTMLSelectElement)) return null;

    const value = valueForExactTagLabel(selectEl, clickedLabel);
    if (!value) return null;

    return {
      label: clickedLabel,
      value,
      selector: buildStableSelector(optionEl),
      fingerprint: buildFingerprint(optionEl),
      savedAt: nowIso()
    };
  }

  function getTagDropdownMenu(dropdown) {
    if (!(dropdown instanceof Element)) return null;

    const owns = norm(dropdown.getAttribute('aria-owns') || dropdown.getAttribute('aria-controls') || '');
    if (owns) {
      const owned = document.getElementById(owns);
      if (owned) {
        const menu = owned.closest('.dropdown-menu');
        if (menu) return menu;
        return owned;
      }
    }

    const wrapper = dropdown.closest('.bootstrap-select, .dropdown, .btn-group, .az-tags-select');
    if (wrapper) {
      const menu = wrapper.querySelector('.dropdown-menu, .inner[role="listbox"], [role="listbox"]');
      if (menu) return menu;
    }

    return findVisibleElements('#add-tag-form .dropdown-menu, .bootstrap-select .dropdown-menu, .dropdown-menu').find(Boolean) || null;
  }

  function isTagDropdownOpen(dropdown) {
    if (!(dropdown instanceof Element)) return false;

    const expanded = String(dropdown.getAttribute('aria-expanded') || '').toLowerCase() === 'true';
    if (expanded) return true;

    const wrapper = dropdown.closest('.bootstrap-select, .dropdown, .btn-group');
    if (wrapper?.classList.contains('show')) return true;

    const menu = getTagDropdownMenu(dropdown);
    if (menu && visible(menu)) return true;

    return false;
  }

  function dispatchKeySequence(el, key) {
    if (!(el instanceof Element)) return;
    const view = el.ownerDocument?.defaultView || window;
    for (const type of ['keydown', 'keyup']) {
      try {
        el.dispatchEvent(new KeyboardEvent(type, {
          key,
          code: key === ' ' ? 'Space' : key,
          bubbles: true,
          cancelable: true,
          composed: true,
          view
        }));
      } catch {}
    }
  }

  function dispatchMouseBurst(el) {
    if (!(el instanceof Element)) return;
    const view = el.ownerDocument?.defaultView || window;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view
        }));
      } catch {}
    }
  }

  function getUnderlyingTagSelect(dropdown) {
    if (!(dropdown instanceof Element)) return null;
    const wrapper = dropdown.closest('.bootstrap-select, .dropdown, .btn-group, .az-tags-select');
    if (!wrapper) return null;
    return wrapper.querySelector('select')
      || (wrapper.previousElementSibling instanceof HTMLSelectElement ? wrapper.previousElementSibling : null);
  }

  async function tryOpenTagDropdown(dropdown) {
    if (!(dropdown instanceof Element)) return false;
    if (isTagDropdownOpen(dropdown)) return true;

    const waitAfterAttempt = async () => {
      await sleep(450);
      return isTagDropdownOpen(dropdown);
    };

    try {
      dropdown.click();
      if (await waitAfterAttempt()) return true;
    } catch {}

    dispatchMouseBurst(dropdown);
    if (await waitAfterAttempt()) return true;

    try {
      const $ = window.jQuery || window.$;
      if ($) {
        const jqDropdown = $(dropdown);
        if (typeof jqDropdown.dropdown === 'function') {
          jqDropdown.dropdown('toggle');
          if (await waitAfterAttempt()) return true;
        }

        const selectEl = getUnderlyingTagSelect(dropdown);
        const jqSelect = selectEl ? $(selectEl) : null;
        if (jqSelect?.length && typeof jqSelect.selectpicker === 'function') {
          jqSelect.selectpicker('toggle');
          if (await waitAfterAttempt()) return true;
        }
      }
    } catch {}

    try {
      dropdown.focus({ preventScroll: true });
      dispatchKeySequence(dropdown, 'ArrowDown');
      if (await waitAfterAttempt()) return true;
    } catch {}

    return false;
  }

  async function openTagPanel() {
    const existingForm = findVisibleElements(SEL.tagForm)[0];
    if (existingForm) return existingForm;

    const opener = findTagOpener();
    if (!opener) {
      log('Tag opener not found');
      return null;
    }

    strongClick(opener);
    log('Clicked: Tag opener');
    await sleep(500);

    const tagForm = await waitFor(() => findVisibleElements(SEL.tagForm)[0], 3000);
    if (!tagForm) {
      log('Tag form not visible after opening tag panel');
      return null;
    }

    return tagForm;
  }

  function resolveStoredTagValue(selectEl, kind, record) {
    if (!(selectEl instanceof HTMLSelectElement) || !isPlainObject(record)) {
      return { value: '', label: cleanTagText(record?.label || '') };
    }

    const label = cleanTagText(record.label || '');
    if (label) {
      const resolvedValue = valueForExactTagLabel(selectEl, label);
      if (resolvedValue) {
        const targets = getTagTargets();
        targets[kind] = {
          ...record,
          label,
          value: resolvedValue,
          savedAt: record.savedAt || nowIso()
        };
        saveTargets(GM_KEYS.tagTargets, targets);
        return { value: resolvedValue, label };
      }
    }

    const directValue = norm(record.value || '');
    if (directValue && selectHasOptionValue(selectEl, directValue)) {
      return {
        value: directValue,
        label: cleanTagText(record.label || optionLabelForValue(selectEl, directValue))
      };
    }

    return { value: '', label };
  }

  function findTagApplyButton() {
    const candidates = Array.from(document.querySelectorAll('button,a,[role="button"]')).filter(visible);
    return candidates.find((el) => {
      const text = lower(el.textContent || '');
      if (!text) return false;
      return text.includes('apply') || text === 'save' || text === 'done';
    }) || null;
  }

  async function maybeClickTagApplyButton() {
    const button = findTagApplyButton();
    if (!button) {
      log('No tag apply button detected, continuing');
      return true;
    }

    strongClick(button);
    log(`Clicked tag apply button: ${norm(button.textContent || '') || 'button'}`);
    await sleep(CFG.actionSettleMs);
    return true;
  }

  async function applyConfiguredTagReplacement() {
    const openTagLabels = getOpenTicketTagLabels();
    const targets = getTagTargets();
    const addRecord = targets.addTag;
    const removeRecord = targets.removeTag;

    if (!isPlainObject(addRecord) || !isPlainObject(removeRecord)) {
      log('Missing configured tag targets');
      return false;
    }

    const configuredAddLabel = cleanTagText(addRecord.label || '');
    const configuredRemoveLabel = cleanTagText(removeRecord.label || '');
    if (!configuredAddLabel || !configuredRemoveLabel) {
      log('Configured tag labels are missing');
      return false;
    }

    const hasRemoveTag = openTagLabels.some((label) => lowerTagText(label) === lowerTagText(configuredRemoveLabel));
    const hasAddTag = openTagLabels.some((label) => lowerTagText(label) === lowerTagText(configuredAddLabel));

    if (!hasRemoveTag) {
      if (hasAddTag) {
        log(`Tag replacement not needed; ${configuredAddLabel} is already on this ticket`);
      } else {
        log(`Tag replacement not needed; ${configuredRemoveLabel} is not on this ticket`);
      }
      return true;
    }

    const tagForm = await openTagPanel();
    if (!(tagForm instanceof Element)) return false;

    const dropdown = findTagDropdown();
    if (!(dropdown instanceof Element)) {
      log('Tag dropdown not found');
      return false;
    }

    const dropdownOpen = await tryOpenTagDropdown(dropdown);
    if (!dropdownOpen) {
      log('Tag dropdown did not open');
      return false;
    }

    const selectEl = findTagSelect(tagForm);
    if (!(selectEl instanceof HTMLSelectElement)) {
      log('Tag select not found in tag form');
      return false;
    }

    const addResolved = resolveStoredTagValue(selectEl, 'addTag', addRecord);
    if (!addResolved.value) {
      log(`Stored tag value missing for ${addRecord.label || 'addTag'}`);
      return false;
    }

    const removeResolved = resolveStoredTagValue(selectEl, 'removeTag', removeRecord);
    if (!removeResolved.value) {
      log(`Stored tag value missing for ${removeRecord.label || 'removeTag'}`);
      return false;
    }

    const addLabel = cleanTagText(addResolved.label || addRecord.label || '');
    const removeLabel = cleanTagText(removeResolved.label || removeRecord.label || '');
    if (!addLabel || !removeLabel) {
      log('Resolved tag labels are missing');
      return false;
    }

    if (lowerTagText(addLabel) === lowerTagText(removeLabel)) {
      log(`Tag replacement skipped; add/remove tag are both ${addLabel}`);
      return true;
    }

    const filteredOpenLabels = openTagLabels.filter((label) => {
      const normalized = lowerTagText(label);
      if (!normalized) return false;
      if (normalized === lowerTagText(removeLabel)) return false;
      if (normalized === lowerTagText(addLabel)) return false;
      return true;
    });

    const preserveInfo = resolveTagValuesByLabels(
      selectEl,
      filteredOpenLabels
    );

    if (preserveInfo.missingLabels.length) {
      log(`Could not map current ticket tags in selector: ${preserveInfo.missingLabels.join(', ')}`);
    }

    const nextValues = [
      ...preserveInfo.values,
      addResolved.value
    ];
    setSelectedTagValues(selectEl, nextValues);
    await maybeClickTagApplyButton();

    log(`Applied tag replacement: ${removeLabel}->${addLabel}`);
    return true;
  }

  async function applyZillowResultToTicket(job) {
    const applyContext = getActivePipelineTicketContext(job?.ticketId);
    if (!applyContext.ok) {
      setStatus(applyContext.reason);
      log(`Blocked Zillow apply: ${applyContext.reason}`);
      return false;
    }

    const missingRequiredFacts = getMissingRequiredZillowFactLabels(job?.result);
    if (missingRequiredFacts.length) {
      if (!norm(job?.noDataReportedAt || '')) {
        log(`Zillow result missing ${missingRequiredFacts.join(', ')} for AZ ${norm(job?.ticketId || state.activeTicketId || '?')}; reloading page`);
      }
      if (isPlainObject(job)) {
        job.noDataReportedAt = nowIso();
        job.updatedAt = nowIso();
        saveJob(job);
      }
      reloadAgencyZoomForFreshZillowAttempt(job, `Missing Zillow facts: ${missingRequiredFacts.join(', ')}`);
      return false;
    }

    const targets = getFieldTargets();
    const baseFields = {
      'Zillow URL': firstNonEmpty(job?.result?.zillowUrl, job?.searchUrl),
      'Bedrooms': getFallbackRoomValue(job?.result?.bedrooms),
      'Bathrooms': getFallbackRoomValue(job?.result?.bathrooms),
      'Home Type': getFallbackHomeType(job?.result?.homeType)
    };
    const customFields = getCustomFieldValueMap(job?.result);
    const labels = [
      ...FIELD_ORDER,
      ...getSortedCustomFieldDefs()
        .map((item) => canonicalFieldLabel(item.label))
        .filter((label) => !!label && !isBaseFieldLabel(label))
    ];

    let changed = false;
    let appliedCount = 0;
    let skippedExistingCount = 0;
    let missingTargetCount = 0;
    let failedCount = 0;
    let valueCount = 0;

    for (const label of labels) {
      const value = norm(isBaseFieldLabel(label) ? baseFields[label] : customFields[label]);
      if (!value) {
        log(`Skipped blank Zillow field: ${label}`);
        continue;
      }
      valueCount += 1;

      const targetRecord = targets[label];
      if (!isPlainObject(targetRecord) || !norm(targetRecord.selector)) {
        missingTargetCount += 1;
        log(`Skipped unsaved field target: ${label}`);
        continue;
      }

      const result = await setFieldValue(targetRecord, value);
      if (result.ok) {
        if (result.skipped === 'existing-value') {
          skippedExistingCount += 1;
          log(`Skipped filled ticket field: ${label} already has ${result.currentValue}`);
        } else {
          changed = true;
          appliedCount += 1;
          log(`Filled field: ${label} = ${value}`);
        }
      } else {
        failedCount += 1;
        log(`Field failed: ${label} | ${result.reason}`);
      }
      await sleep(CFG.majorStepDelayMs);
    }

    if (failedCount || (valueCount && !changed && !skippedExistingCount && missingTargetCount)) {
      if (changed) {
        const updated = await clickUpdateButton();
        if (!updated) {
          setStatus('Ticket update failed');
          return false;
        }
      }
      const reason = failedCount
        ? `${failedCount} Zillow field write(s) failed`
        : `${missingTargetCount} Zillow field target(s) missing`;
      log(`${reason}; reloading page`);
      requestBootstrapReload(reason);
      return false;
    }

    if (changed) {
      const updated = await clickUpdateButton();
      if (!updated) {
        setStatus('Ticket update failed');
        return false;
      }
    } else if (skippedExistingCount) {
      log(`No ticket field updates needed; ${skippedExistingCount} field(s) were already filled`);
    } else {
      log('No Zillow field values needed to be applied');
    }

    const tagsOk = await applyConfiguredTagReplacement();
    if (!tagsOk) {
      setStatus('Tag replacement failed');
      return false;
    }

    const finalContext = getActivePipelineTicketContext(job?.ticketId);
    if (!finalContext.ok) {
      setStatus(finalContext.reason);
      log(`Blocked Zillow completion: ${finalContext.reason}`);
      return false;
    }

    state.zillowSummary = summarizeResult(job?.result);
    if (changed) setStatus(`Applied ${appliedCount} Zillow field(s)`);
    else if (skippedExistingCount) setStatus('Ticket fields already filled');
    else setStatus('No Zillow field changes needed');
    return true;
  }

  async function runAzWorkflow() {
    if (!CFG.openTicketOnly) {
      if (!hasAllFieldTargets()) {
        setStatus('Field target setup required');
        return;
      }

      if (!hasAllTagTargets()) {
        setStatus('Tag target setup required');
        return;
      }
    }

    if (isPipelinePage()) {
      const filterReady = await ensureIgnoredV2Filter();
      if (!filterReady) {
        setStatus('Ingored v2 filter failed');
        return;
      }

      if (CFG.filterOnly) {
        setStatus(`${CFG.savedQueryName} selected`);
        return;
      }

      await sleep(CFG.majorStepDelayMs);
    }

    let openTicket = getOpenTicketInfo();
    state.activeTicketId = norm(openTicket.ticketId || '');

    if (!state.activeTicketId) {
      if (!isPipelinePage()) {
        setStatus('Open AgencyZoom pipeline or a ticket');
        return;
      }

      const card = getVisibleStageCards()[0] || null;
      if (!card) {
        setStatus('No visible tickets in Ingored v2');
        return;
      }

      const ticketId = norm(card.getAttribute('data-id') || '');
      const opened = await openCard(card, ticketId);
      if (!opened) {
        setStatus('Ticket open failed');
        return;
      }

      await sleep(CFG.majorStepDelayMs);
      openTicket = getOpenTicketInfo();
      state.activeTicketId = norm(openTicket.ticketId || ticketId);
    }

    if (!state.activeTicketId) {
      state.mainReadyTicketId = '';
      setStatus('Waiting for open ticket');
      return;
    }

    if (CFG.openTicketOnly) {
      setStatus(`Ticket open: ${state.activeTicketId}`);
      return;
    }

    let job = getJob();
    if (state.mainReadyTicketId === state.activeTicketId && handleExistingZillowJob(job)) {
      return;
    }

    const mainOk = await ensureMainTab();
    if (!mainOk) {
      setStatus('Main tab failed');
      return;
    }

    await sleep(CFG.majorStepDelayMs);
    const addressInfo = readAzAddressInfo(state.activeTicketId);
    state.currentAddress = norm(addressInfo.address || '');
    if (!state.currentAddress) {
      setStatus('Address not found on Main');
      log(`Could not read address for AZ ${state.activeTicketId}`);
      return;
    }
    state.mainReadyTicketId = state.activeTicketId;

    job = getJob();
    if (handleExistingZillowJob(job)) return;

    if (!jobMatchesTicket(job, state.activeTicketId) || ['failed', 'completed'].includes(norm(job?.status || ''))) {
      job = createJob(state.activeTicketId, addressInfo);
      const opened = launchZillowSearch(job);
      if (!opened) {
        if (hasFreshZillowOpenBlock()) {
          setStatus('Waiting for existing Zillow tab');
          return;
        }
        reloadAgencyZoomForFreshZillowAttempt(job, 'Could not open Zillow tab');
        return;
      }

      setStatus(`Waiting for Zillow for ${state.activeTicketId}`);
      log(`Opened Zillow search: ${job.searchUrl}`);
      return;
    }

    if (norm(job.address) !== state.currentAddress) {
      job = createJob(state.activeTicketId, addressInfo);
      const reopened = launchZillowSearch(job);
      if (reopened) {
        setStatus(`Address changed; reopened Zillow for ${state.activeTicketId}`);
        log(`Address changed; reopened Zillow search: ${job.searchUrl}`);
      } else if (hasFreshZillowOpenBlock()) {
        setStatus('Waiting for existing Zillow tab');
      } else {
        reloadAgencyZoomForFreshZillowAttempt(job, 'Could not reopen Zillow tab after address change');
      }
      return;
    }

    state.zillowSummary = summarizeResult(job?.result);

    if (norm(job.status) === 'result-ready' && isPlainObject(job.result)) {
      await sleep(CFG.majorStepDelayMs);
      const applied = await applyZillowResultToTicket(job);
      if (!applied) return;

      await sleep(CFG.majorStepDelayMs);
      try {
        const webhookOk = await sendWebhookForJob(job);
        if (!webhookOk) return;
      } catch (error) {
        const message = norm(error?.message || error || 'Webhook send failed') || 'Webhook send failed';
        setStatus(message);
        log(`Webhook failed: ${message}`);
        return;
      }

      const completedTicketId = state.activeTicketId;
      job.status = 'completed';
      job.completedAt = nowIso();
      job.updatedAt = nowIso();
      saveJob(job);

      await sleep(CFG.majorStepDelayMs);
      await closeTicketDrawer();
      clearJob();
      state.activeTicketId = '';
      state.currentAddress = '';
      state.zillowSummary = '';
      state.mainReadyTicketId = '';
      setStatus(`Completed ticket ${completedTicketId}`);
      log(`Completed ticket ${completedTicketId}`);
      if (isPipelinePage()) {
        requestBootstrapReload(`completed-ticket-${completedTicketId}`);
      }
      return;
    }

    if (norm(job.status) === 'failed') {
      reloadAgencyZoomForFreshZillowAttempt(job, getZillowJobErrorText(job));
      return;
    }

    const ageMs = getJobActiveAgeMs(job);
    if (ageMs > CFG.zillowWaitMs) {
      reloadAgencyZoomForFreshZillowAttempt(job, 'Zillow scrape timed out');
      return;
    }

    const remaining = Math.max(1, Math.ceil((CFG.zillowWaitMs - ageMs) / 1000));
    setStatus(`Waiting for Zillow (${remaining}s)`);
  }

  function maybeRefreshForIdleZillowOpenGap() {
    if (!isAzOrigin() || !state.running || state.destroyed) return false;

    const ageMs = getLastZillowOpenAgeMs();
    if (ageMs < CFG.azRefreshIfNoZillowOpenMs) return false;

    const roundedMinutes = Math.max(1, Math.floor(ageMs / 60000));
    setLastZillowOpenAt();
    setStatus(`Refreshing after ${roundedMinutes}m without Zillow opens`);
    log(`Refreshing AgencyZoom after ${roundedMinutes} minute(s) without opening a Zillow page`);
    requestBootstrapReload(`idle-no-zillow-open-${roundedMinutes}m`);
    return true;
  }

  async function tick() {
    if (state.destroyed || !isAzOrigin()) return;
    if (isAgencyZoomLoginPage()) return;
    if (!claimSingletonPageSlot()) return;
    if (state.picker) {
      renderAll();
      return;
    }
    if (!state.running) {
      setStatus('Stopped');
      state.lastWrongAzUrl = '';
      renderAll();
      return;
    }
    if (!isPipelinePage()) {
      const wrongUrl = String(location.href || '');
      const wrongPageReason = isLeadDetailPage()
        ? 'Lead details page detected; returning to pipeline'
        : 'Wrong AgencyZoom page detected; returning to pipeline';
      if (state.lastWrongAzUrl !== wrongUrl) {
        state.lastWrongAzUrl = wrongUrl;
        log(wrongPageReason);
      }
      setStatus(wrongPageReason);
      state.activeTicketId = '';
      state.mainReadyTicketId = '';
      try {
        location.replace(PIPELINE_ROOT_URL);
      } catch {
        try { location.href = PIPELINE_ROOT_URL; } catch {}
      }
      renderAll();
      return;
    }
    state.lastWrongAzUrl = '';
    if (maybeRefreshForIdleZillowOpenGap()) return;
    if (state.busy) return;

    state.busy = true;
    renderAll();

    try {
      await runAzWorkflow();
    } catch (error) {
      const message = norm(error?.message || error || 'Unknown error') || 'Unknown error';
      setStatus('Run failed');
      log(`Run failed: ${message}`);
    } finally {
      state.busy = false;
      renderAll();
    }
  }

  function consumeBootstrapReloadToken() {
    try {
      const value = sessionStorage.getItem(SS_KEYS.bootstrapReload);
      if (!value) return false;
      sessionStorage.removeItem(SS_KEYS.bootstrapReload);
      return true;
    } catch {
      return false;
    }
  }

  function requestBootstrapReload(reason = '') {
    try {
      sessionStorage.setItem(SS_KEYS.bootstrapReload, JSON.stringify({
        reason: norm(reason || ''),
        requestedAt: nowIso()
      }));
    } catch {}
    try {
      if (isPipelinePage()) {
        location.reload();
        return;
      }
    } catch {}
    try {
      location.replace(PIPELINE_ROOT_URL);
      return;
    } catch {}
    try { location.href = PIPELINE_ROOT_URL; } catch {}
  }

  function ensureHoverBox() {
    if (state.hoverBox) return;
    const box = document.createElement('div');
    box.setAttribute(UI_ATTR, '1');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: String(CFG.zIndex),
      pointerEvents: 'none',
      border: '2px solid rgba(248,113,113,0.95)',
      background: 'rgba(252,165,165,0.16)',
      borderRadius: '6px',
      display: 'none'
    });
    document.documentElement.appendChild(box);
    state.hoverBox = box;
  }

  function ensureProviderBanner() {
    if (state.providerBanner || !isZillowOrigin()) return;
    const banner = document.createElement('div');
    banner.setAttribute(UI_ATTR, '1');
    Object.assign(banner.style, {
      position: 'fixed',
      left: '12px',
      right: '12px',
      bottom: '12px',
      zIndex: String(CFG.zIndex),
      padding: '12px 14px',
      borderRadius: '14px',
      background: 'rgba(15, 23, 42, 0.96)',
      color: '#e5e7eb',
      border: '1px solid rgba(255,255,255,0.12)',
      boxShadow: '0 16px 38px rgba(0,0,0,0.35)',
      font: '13px/1.45 Segoe UI, Tahoma, Arial, sans-serif'
    });
    banner.innerHTML = `<div ${UI_ATTR}="1" style="font-weight:800;margin-bottom:4px;">${SCRIPT_NAME}</div><div ${UI_ATTR}="1" id="tm-az-zillow-provider-banner-text">Preparing Zillow field capture...</div>`;
    document.documentElement.appendChild(banner);
    state.providerBanner = banner;
  }

  function setProviderBannerMessage(message) {
    if (!isZillowOrigin()) return;
    ensureProviderBanner();
    const node = state.providerBanner?.querySelector?.('#tm-az-zillow-provider-banner-text');
    if (node) node.textContent = norm(message || '') || 'Preparing Zillow field capture...';
  }

  function clearProviderBanner() {
    if (!state.providerBanner) return;
    try { state.providerBanner.remove(); } catch {}
    state.providerBanner = null;
  }

  function isUiElement(el) {
    return !!(el instanceof Element && el.closest(`[${UI_ATTR}="1"]`));
  }

  function getSelectableTargetFromPath(path) {
    for (const item of path || []) {
      if (item instanceof Element && !isUiElement(item) && visible(item)) {
        return item;
      }
    }
    return null;
  }

  function updateHoverBox(target) {
    if (!state.hoverBox) return;
    if (!target || !(target instanceof Element)) {
      state.hoverBox.style.display = 'none';
      return;
    }

    const rect = target.getBoundingClientRect();
    state.hoverBox.style.display = 'block';
    state.hoverBox.style.left = `${rect.left}px`;
    state.hoverBox.style.top = `${rect.top}px`;
    state.hoverBox.style.width = `${rect.width}px`;
    state.hoverBox.style.height = `${rect.height}px`;
  }

  function buildFieldPickerItems(labels) {
    return (Array.isArray(labels) ? labels : [])
      .map((label) => canonicalFieldLabel(label))
      .filter(Boolean)
      .map((label) => ({ key: label, label }));
  }

  function openProviderCaptureTab(request) {
    if (!isPlainObject(request) || !norm(request.searchUrl || '')) return false;
    if (!claimZillowOpenSlot(request.searchUrl, `provider-${canonicalFieldLabel(request.label || '')}`)) return false;
    try {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(request.searchUrl, { active: true, insert: true, setParent: true });
        setLastZillowOpenAt();
        return true;
      }
    } catch {}

    try {
      const opened = window.open(request.searchUrl, '_blank');
      if (opened) {
        try { opened.focus(); } catch {}
        setLastZillowOpenAt();
      }
      if (opened) return true;
    } catch {
      // Fall through to clear the lease below.
    }

    clearZillowOpenSlot();
    return false;
  }

  function requestCustomFieldProviderCapture(fieldConfig) {
    if (!isPlainObject(fieldConfig)) return false;

    const label = canonicalFieldLabel(fieldConfig.label);
    if (!label || isBaseFieldLabel(label)) return false;

    const addressInfo = isPlainObject(fieldConfig.addressInfo) ? fieldConfig.addressInfo : {};
    const request = {
      label,
      normalizer: norm(fieldConfig.normalizer || inferFieldNormalizer(label)),
      ticketId: norm(fieldConfig.ticketId || addressInfo.ticketId || ''),
      address: norm(addressInfo.address || fieldConfig.address || ''),
      street: norm(addressInfo.street || fieldConfig.street || ''),
      city: norm(addressInfo.city || fieldConfig.city || ''),
      state: norm(addressInfo.state || fieldConfig.state || ''),
      postal: norm(addressInfo.postal || fieldConfig.postal || ''),
      searchUrl: firstNonEmpty(fieldConfig.searchUrl, buildZillowSearchUrl(addressInfo.address || fieldConfig.address || '')),
      requestedAt: nowIso()
    };

    saveCustomFieldDef(label, { normalizer: request.normalizer });
    saveProviderPickerRequest(request);

    const opened = openProviderCaptureTab(request);
    if (opened) {
      log(`Opened Zillow field capture for ${label}: ${request.searchUrl}`);
    } else {
      log(`Could not auto-open Zillow for ${label}; open this URL manually: ${request.searchUrl}`);
    }
    return opened;
  }

  async function startSingleFieldTargetFlow() {
    if (!isAzOrigin() || state.busy || state.picker) return;

    const raw = window.prompt('Field name to add or update', 'Home Sqft');
    const fieldLabel = canonicalFieldLabel(raw);
    if (!fieldLabel) {
      log('Add field target canceled');
      return;
    }

    const builtIn = isBaseFieldLabel(fieldLabel);
    let customField = null;

    if (!builtIn) {
      const openTicket = getOpenTicketInfo();
      const ticketId = norm(openTicket.ticketId || '');
      if (!ticketId) {
        setStatus('Open a ticket on Main first');
        log(`Open the AgencyZoom ticket before adding ${fieldLabel}`);
        return;
      }

      const mainReady = await ensureMainTab();
      if (!mainReady) {
        setStatus('Main tab not ready');
        return;
      }

      const addressInfo = readAzAddressInfo(ticketId);
      if (!norm(addressInfo.address)) {
        setStatus('Address read failed');
        log(`Could not read address for ${fieldLabel} provider capture`);
        return;
      }

      customField = {
        label: fieldLabel,
        normalizer: inferFieldNormalizer(fieldLabel),
        ticketId,
        addressInfo,
        searchUrl: buildZillowSearchUrl(addressInfo.address)
      };
      saveCustomFieldDef(fieldLabel, { normalizer: customField.normalizer });
    }

    startPicker('field-single', {
      items: buildFieldPickerItems([fieldLabel]),
      customField,
      doneMessage: builtIn
        ? `${fieldLabel} target saved`
        : `${fieldLabel} AZ target saved; select the Zillow source in the opened tab`
    });
  }

  function startMissingFieldPicker() {
    if (!isAzOrigin() || state.busy || state.picker) return;
    const targets = getFieldTargets();
    const missing = FIELD_ORDER.filter((label) => !(isPlainObject(targets[label]) && norm(targets[label].selector)));
    if (!missing.length) {
      setStatus('No missing base field targets');
      log('No missing base field targets');
      return;
    }

    startPicker('fields', {
      items: buildFieldPickerItems(missing),
      doneMessage: 'Missing field targets saved'
    });
  }

  async function maybeHandleProviderPickerOnZillow() {
    const request = getProviderPickerRequest();
    if (!isPlainObject(request)) {
      if (state.picker?.type === 'provider') stopPicker('', false);
      clearProviderBanner();
      return false;
    }

    const label = canonicalFieldLabel(request.label);
    if (!label) {
      clearProviderPickerRequest();
      clearProviderBanner();
      return false;
    }

    const activeProviderLabel = state.picker?.type === 'provider'
      ? canonicalFieldLabel(state.picker.items?.[state.picker.index]?.label || '')
      : '';
    if (state.picker?.type === 'provider' && activeProviderLabel && activeProviderLabel !== label) {
      stopPicker('', false);
    }

    if (!isZillowListingPage()) {
      const listing = findLikelyZillowListingLink(request);
      if (listing?.href && norm(listing.href) !== norm(location.href)) {
        setProviderBannerMessage(`Opening the Zillow listing for ${label}...`);
        try { location.assign(listing.href); } catch {}
        return true;
      }

      setProviderBannerMessage(`Field capture for ${label}: open the Zillow listing for ${request.address || 'this address'}, then click the source element.`);
      return true;
    }

    if (state.picker?.type !== 'provider') {
      startPicker('provider', {
        items: buildFieldPickerItems([label]),
        providerRequest: request,
        doneMessage: `Zillow source saved for ${label}`
      });
    } else {
      setProviderBannerMessage(`Field capture for ${label}: click the Zillow source element. Press Esc to cancel.`);
    }

    return true;
  }

  function startPicker(type, options = {}) {
    const allowOnZillow = type === 'provider';
    if ((!allowOnZillow && !isAzOrigin()) || (allowOnZillow && !isZillowOrigin()) || state.busy || state.picker) return;

    const items = Array.isArray(options.items) && options.items.length
      ? options.items.map((item) => deepClone(item))
      : (type === 'fields'
        ? buildFieldPickerItems(FIELD_ORDER)
        : TAG_ORDER.map((item) => deepClone(item)));
    if (!items.length) {
      log(`No picker items found for ${type}`);
      return;
    }

    state.picker = {
      type,
      items,
      index: 0,
      primerPending: type === 'tags',
      customField: isPlainObject(options.customField) ? deepClone(options.customField) : null,
      providerRequest: isPlainObject(options.providerRequest) ? deepClone(options.providerRequest) : null,
      doneMessage: norm(options.doneMessage || '')
    };

    ensureHoverBox();
    state.pickerMove = (event) => {
      const target = getSelectableTargetFromPath(event.composedPath ? event.composedPath() : [event.target]);
      state.hoveredEl = target;
      updateHoverBox(target);
    };

    state.pickerClick = (event) => {
      const target = getSelectableTargetFromPath(event.composedPath ? event.composedPath() : [event.target]);
      if (!target) return;
      if (state.picker?.type === 'tags' && state.picker?.primerPending) {
        state.picker.primerPending = false;
        const current = state.picker.items[state.picker.index];
        setStatus(`Picker: click ${current.label}`);
        log(`First click ignored by design. Now click ${current.label}`);
        renderAll();
        return;
      }
      if (state.picker?.type !== 'tags') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      handlePickerSelection(target);
    };

    state.pickerKeydown = (event) => {
      if (event.key !== 'Escape') return;
      if (state.picker?.type === 'provider') {
        clearProviderPickerRequest();
        stopPicker('Provider picker canceled');
        return;
      }
      stopPicker('Picker canceled');
    };

    document.addEventListener('mousemove', state.pickerMove, true);
    document.addEventListener('keydown', state.pickerKeydown, true);
    document.addEventListener('click', state.pickerClick, true);

    const current = state.picker.items[state.picker.index];
    if (type === 'tags') {
      setStatus(`Picker: click ${current.label}`);
      log(`Tag picker started: first click ignored. Use it to open tags, then click ${current.label}`);
    } else if (type === 'provider') {
      setProviderBannerMessage(`Field capture for ${current.label}: click the Zillow source element. Press Esc to cancel.`);
      log(`Zillow provider picker started: click the source for ${current.label}`);
    } else {
      setStatus(`Picker: click ${current.label}`);
      log(`Field picker started: click ${current.label}`);
    }
    renderAll();
  }

  function stopPicker(message, logIt = true) {
    if (!state.picker) return;
    const pickerType = state.picker.type;

    document.removeEventListener('mousemove', state.pickerMove, true);
    document.removeEventListener('click', state.pickerClick, true);
    document.removeEventListener('keydown', state.pickerKeydown, true);
    state.pickerMove = null;
    state.pickerClick = null;
    state.pickerKeydown = null;
    state.picker = null;
    state.hoveredEl = null;
    updateHoverBox(null);
    if (pickerType === 'provider') clearProviderBanner();

    if (logIt && message) log(message);
    if (isAzOrigin()) setStatus(state.running ? 'Ready' : 'Stopped');
    renderAll();
  }

  function handlePickerSelection(target) {
    if (!state.picker) return;
    const item = state.picker.items[state.picker.index];

    if (state.picker.type === 'fields' || state.picker.type === 'field-single') {
      const selector = buildStableSelector(target);
      if (!selector) {
        log('Picker failed: could not build stable selector');
        return;
      }

      const record = {
        selector,
        fingerprint: buildFingerprint(target),
        label: norm(target.innerText || target.textContent || '') || item.label,
        savedAt: nowIso()
      };

      const targets = getFieldTargets();
      targets[item.key] = record;
      saveTargets(GM_KEYS.fieldTargets, targets);
      if (state.picker.type === 'field-single' && isPlainObject(state.picker.customField)) {
        requestCustomFieldProviderCapture(state.picker.customField);
      }
    } else if (state.picker.type === 'provider') {
      const selector = buildStableSelector(target);
      if (!selector) {
        log('Provider picker failed: could not build stable selector');
        return;
      }

      const request = state.picker.providerRequest || getProviderPickerRequest() || {};
      const label = canonicalFieldLabel(item.label || request.label || '');
      if (!label) {
        log('Provider picker failed: field label missing');
        return;
      }

      saveCustomFieldDef(label, {
        normalizer: norm(request.normalizer || inferFieldNormalizer(label)),
        providerTarget: {
          selector,
          fingerprint: buildFingerprint(target),
          label: readElementDisplayValue(target) || label,
          href: target instanceof HTMLAnchorElement ? norm(target.href || '') : '',
          sourceUrl: location.href,
          savedAt: nowIso()
        }
      });
      clearProviderPickerRequest();
    } else {
      const record = buildTagTargetRecord(target);
      if (!record) {
        log('Picker failed: click the real tag option in the open dropdown');
        return;
      }

      const targets = getTagTargets();
      targets[item.key] = record;
      saveTargets(GM_KEYS.tagTargets, targets);
    }

    const currentTargets = state.picker.type === 'tags' ? getTagTargets() : null;
    const extra = state.picker.type === 'tags' ? ` = ${currentTargets?.[item.key]?.label || ''}` : '';
    log(`Saved target: ${item.label}${extra}`);

    state.picker.index += 1;
    if (state.picker.index >= state.picker.items.length) {
      const doneMessage = state.picker.doneMessage
        || (state.picker.type === 'tags'
          ? 'Tag targets saved'
          : state.picker.type === 'provider'
            ? 'Zillow provider target saved'
            : 'Field targets saved');
      stopPicker(doneMessage);
      return;
    }

    const next = state.picker.items[state.picker.index];
    setStatus(`Picker: click ${next.label}`);
    log(`Next target: ${next.label}`);
  }

  function resetFieldTargets() {
    saveTargets(GM_KEYS.fieldTargets, {});
    saveCustomFields({});
    clearProviderPickerRequest();
    log('Field targets reset');
    renderAll();
  }

  function resetTagTargets() {
    saveTargets(GM_KEYS.tagTargets, {});
    log('Tag targets reset');
    renderAll();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildUi() {
    const panel = document.createElement('div');
    panel.id = 'tm-az-zillow-ticket-enricher-panel';
    panel.setAttribute(UI_ATTR, '1');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: `${CFG.panelWidth}px`,
      zIndex: String(CFG.zIndex),
      background: 'rgba(15, 23, 42, 0.97)',
      color: '#e5e7eb',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '16px',
      boxShadow: '0 18px 48px rgba(0,0,0,0.38)',
      font: '12px/1.45 Segoe UI, Tahoma, Arial, sans-serif',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-head" style="padding:10px 12px;background:linear-gradient(90deg,#1f2937,#111827);display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move;">
        <div ${UI_ATTR}="1">
          <div ${UI_ATTR}="1" style="font-weight:800;">${SCRIPT_NAME}</div>
          <div ${UI_ATTR}="1" style="font-size:11px;opacity:.72;">Pipeline -> Zillow -> Main fields -> dotted tags</div>
        </div>
        <div ${UI_ATTR}="1" style="font-size:11px;opacity:.72;">v${VERSION}</div>
      </div>
      <div ${UI_ATTR}="1" style="padding:12px;">
        <div ${UI_ATTR}="1" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#15803d;color:#fff;font-weight:800;cursor:pointer;">START</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-clear-job" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;">CLEAR JOB</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-set-fields" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0891b2;color:#fff;font-weight:800;cursor:pointer;">SET FIELD TARGETS</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-set-missing-fields" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">SET MISSING FIELDS</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-add-field-target" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#7c3aed;color:#fff;font-weight:800;cursor:pointer;">ADD FIELD TARGET</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-reset-fields" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">RESET FIELDS</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-set-tags" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#f59e0b;color:#111827;font-weight:800;cursor:pointer;">SET TAG TARGETS</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-reset-tags" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">RESET TAGS</button>
        </div>
        <div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-status" style="font-weight:800;color:#86efac;margin-bottom:10px;">Ready</div>
        <div ${UI_ATTR}="1" style="display:grid;grid-template-columns:110px 1fr;gap:6px 8px;margin-bottom:10px;">
          <div ${UI_ATTR}="1" style="opacity:.72;">AZ ID</div><div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-ticket">-</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Address</div><div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-address">-</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Zillow</div><div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-zillow">-</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Fields</div><div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-fields">0/4 saved</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Tags</div><div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-tags">0/2 saved</div>
        </div>
        <div ${UI_ATTR}="1" style="margin-bottom:10px;">
          <div ${UI_ATTR}="1" style="opacity:.72;font-size:11px;margin-bottom:4px;">Webhook URL</div>
          <input ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-webhook-url" type="text" placeholder="https://..." style="width:100%;border:1px solid #243041;border-radius:10px;background:#020617;color:#e5e7eb;padding:8px 10px;">
          <div ${UI_ATTR}="1" style="opacity:.72;font-size:11px;margin-top:5px;">Active: <span ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-webhook-active">(empty)</span></div>
        </div>
        <textarea ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-logs" readonly style="width:100%;min-height:170px;max-height:240px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:12px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('#tm-az-zillow-ticket-enricher-head');
    state.ui.toggle = panel.querySelector('#tm-az-zillow-ticket-enricher-toggle');
    state.ui.clearJob = panel.querySelector('#tm-az-zillow-ticket-enricher-clear-job');
    state.ui.setFields = panel.querySelector('#tm-az-zillow-ticket-enricher-set-fields');
    state.ui.setMissingFields = panel.querySelector('#tm-az-zillow-ticket-enricher-set-missing-fields');
    state.ui.addFieldTarget = panel.querySelector('#tm-az-zillow-ticket-enricher-add-field-target');
    state.ui.resetFields = panel.querySelector('#tm-az-zillow-ticket-enricher-reset-fields');
    state.ui.setTags = panel.querySelector('#tm-az-zillow-ticket-enricher-set-tags');
    state.ui.resetTags = panel.querySelector('#tm-az-zillow-ticket-enricher-reset-tags');
    state.ui.status = panel.querySelector('#tm-az-zillow-ticket-enricher-status');
    state.ui.ticket = panel.querySelector('#tm-az-zillow-ticket-enricher-ticket');
    state.ui.address = panel.querySelector('#tm-az-zillow-ticket-enricher-address');
    state.ui.zillow = panel.querySelector('#tm-az-zillow-ticket-enricher-zillow');
    state.ui.fields = panel.querySelector('#tm-az-zillow-ticket-enricher-fields');
    state.ui.tags = panel.querySelector('#tm-az-zillow-ticket-enricher-tags');
    state.ui.webhookUrl = panel.querySelector('#tm-az-zillow-ticket-enricher-webhook-url');
    state.ui.activeWebhook = panel.querySelector('#tm-az-zillow-ticket-enricher-webhook-active');
    state.ui.logs = panel.querySelector('#tm-az-zillow-ticket-enricher-logs');

    makeDraggable(panel, state.ui.head);
  }

  function bindUi() {
    state.ui.toggle?.addEventListener('click', () => {
      state.running = !state.running;
      saveRunning(state.running);

      if (!state.running) {
        stopAutomation('Automation stopped');
        return;
      }

      setLastZillowOpenAt();
      log('Automation started');
      if (isPipelinePage() && !getOpenTicketInfo().ticketId) {
        log('Reloading pipeline before scan');
        requestBootstrapReload('manual-start');
        return;
      }

      setStatus('Ready');
      renderAll();
      tick();
    });

    state.ui.clearJob?.addEventListener('click', () => {
      clearJob();
      state.zillowSummary = '';
      log('Stored Zillow job cleared');
      renderAll();
    });

    state.ui.setFields?.addEventListener('click', () => startPicker('fields'));
    state.ui.setMissingFields?.addEventListener('click', startMissingFieldPicker);
    state.ui.addFieldTarget?.addEventListener('click', startSingleFieldTargetFlow);
    state.ui.resetFields?.addEventListener('click', resetFieldTargets);
    state.ui.setTags?.addEventListener('click', () => startPicker('tags'));
    state.ui.resetTags?.addEventListener('click', resetTagTargets);

    state.ui.webhookUrl?.addEventListener('input', () => { persistWebhookFromUi(false); });
    state.ui.webhookUrl?.addEventListener('change', () => { persistWebhookFromUi(true); });
    state.ui.webhookUrl?.addEventListener('blur', () => { persistWebhookFromUi(true); });
    state.ui.webhookUrl?.addEventListener('paste', () => {
      setTimeout(() => persistWebhookFromUi(true), 0);
    });
    state.ui.webhookUrl?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      persistWebhookFromUi(true);
      try { state.ui.webhookUrl.blur(); } catch {}
    });
  }

  function renderAll() {
    const job = getJob();
    if (state.ui.ticket) state.ui.ticket.textContent = norm(state.activeTicketId || job?.ticketId || '-') || '-';
    if (state.ui.address) state.ui.address.textContent = norm(state.currentAddress || job?.address || '-') || '-';
    if (state.ui.zillow) {
      const text = firstNonEmpty(
        state.zillowSummary,
        summarizeResult(job?.result),
        norm(job?.status || '')
      ) || '-';
      state.ui.zillow.textContent = text;
    }
    if (state.ui.fields) state.ui.fields.textContent = getFieldTargetStatusText();
    if (state.ui.tags) state.ui.tags.textContent = getTagTargetStatusText();
    updateActiveWebhookUi(readWebhookUrl());

    if (state.ui.toggle) {
      state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
      state.ui.toggle.style.background = state.running ? '#b91c1c' : '#15803d';
    }

    const controlsLocked = state.busy || !!state.picker;
    for (const button of [
      state.ui.clearJob,
      state.ui.setFields,
      state.ui.setMissingFields,
      state.ui.addFieldTarget,
      state.ui.resetFields,
      state.ui.setTags,
      state.ui.resetTags
    ]) {
      if (!button) continue;
      button.disabled = controlsLocked;
      button.style.opacity = controlsLocked ? '0.65' : '1';
    }

    renderLogs();
  }

  function persistPanelPos() {
    if (!state.panel) return;
    try {
      localStorage.setItem(LS_KEYS.panelPos, JSON.stringify({
        left: state.panel.style.left || '',
        top: state.panel.style.top || '',
        right: state.panel.style.right || '',
        bottom: state.panel.style.bottom || ''
      }));
    } catch {}
  }

  function restorePanelPos() {
    try {
      const saved = safeJsonParse(localStorage.getItem(LS_KEYS.panelPos), null);
      if (!isPlainObject(saved) || !state.panel) return;
      if (saved.left) state.panel.style.left = saved.left;
      if (saved.top) state.panel.style.top = saved.top;
      if (saved.right) state.panel.style.right = saved.right;
      if (saved.bottom) state.panel.style.bottom = saved.bottom;
      keepPanelInView();
    } catch {}
  }

  function keepPanelInView() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    const margin = 8;

    if (rect.right > window.innerWidth - margin) left -= (rect.right - (window.innerWidth - margin));
    if (rect.bottom > window.innerHeight - margin) top -= (rect.bottom - (window.innerHeight - margin));
    if (left < margin) left = margin;
    if (top < margin) top = margin;

    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    persistPanelPos();
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;
    let drag = null;

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      drag = {
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top
      };
      event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
      if (!drag) return;
      panel.style.left = `${Math.max(8, event.clientX - drag.dx)}px`;
      panel.style.top = `${Math.max(8, event.clientY - drag.dy)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }, true);

    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      keepPanelInView();
    }, true);
  }
})();

