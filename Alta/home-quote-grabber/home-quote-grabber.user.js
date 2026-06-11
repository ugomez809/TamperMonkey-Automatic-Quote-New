// ==UserScript==
// @name         GWPC Home Quote Extractor
// @namespace    homebot.home-quote-grabber
// @version      4.1.18
// @description  Background Home quote gatherer. Auto-arms on load, gathers early Policy Info and Dwelling fields, captures no-auto and auto-discount pricing in two passes, keeps partial/final Home payload state by AZ ID, hard-stops after the final Home pass for that page load, and hands off Home completion through shared storage without sending the webhook directly.
// @author       OpenAI
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/home-quote-grabber/home-quote-grabber.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/home-quote-grabber/home-quote-grabber.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__HOME_QUOTE_GRABBER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'GWPC Home Quote Extractor';
  const VERSION = '4.1.18';

  // Log-export integration — matches the suffix + prefix used by
  // storage-tools.user.js so its LOGS TXT / CLEAR LOGS buttons find this.
  const LOG_PERSIST_KEY = 'tm_pc_home_quote_grabber_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  const SCRIPT_ACTIVITY_KEY = 'tm_ui_script_activity_v1';
  const SCRIPT_ID = 'home-quote-grabber';
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';
  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';
  const BUNDLE_KEY = 'tm_pc_webhook_bundle_v1';
  const LEGACY_SHARED_JOB_KEY = 'tm_shared_az_job_v1';
  const FLOW_STAGE_KEY = 'tm_pc_flow_stage_v1';
  const HOME_QUOTE_GRABBER_TRIGGER_KEY = 'tm_pc_home_quote_grabber_trigger_v1';

  const KEYS = {
    payload: 'tm_pc_home_quote_grab_payload_v1',
    panelPos: 'tm_pc_home_quote_grab_panel_pos_v1',
    customFieldRules: 'tm_pc_home_quote_grab_custom_field_rules_v1'
  };

  const CFG = {
    tickMs: 1000,
    triggerDelayMs: 3000,
    waitTimeoutMs: 20000,
    waitPollMs: 250,
    afterClickMs: 800,
    maxLogLines: 24,
    afterEditAllMs: 1200,
    afterFieldMs: 250,
    afterQuoteWaitMs: 800,
    maxQuoteAttempts: 6,
    coveragesRetryLimit: 2,
    quoteTransitionTimeoutMs: 8000,
    betweenQuoteAttemptsMs: 500,
    quoteActionReadyTimeoutMs: 12000,
    triggerStableMs: 1000,
    tabNudgeCooldownMs: 1500,
    tabNudgeSettleMs: 2500,
    afterRequoteSettleMs: 4000,
    afterAutoDiscountBeforeQuoteMs: 5000,
    navigationMoveTimeoutMs: 3500,
    coveragesWarningStallMs: 60000
  };

  const SEL = {
    stdAllPerils:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-0-lineCovTermRow-0-0-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',
    enhAllPerils:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-0-lineCovTermRow-0-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',
    enhSplitWater:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-0-lineCovTermRow-1-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',
    enhSeparateStructures:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-2-lineCovRow-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',
    enhPersonalPropertyLimit:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-3-lineCovTermRow-0-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',
    enhPersonalLiability:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-5-lineCovRow-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',
    enhExtendedReplacementCheckbox:
      'input[type="checkbox"][name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-8-lineCovRow-1-targetedCovTermId-SideBySideCovTermInputSet-covTermEnabledId"]',
    enhExtendedReplacementSelect:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-8-lineCovRow-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',
    personalInjuryCheckbox:
      'input[type="checkbox"][name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideScreenBasePanelSet-SideBySideScreenPanelSet-HOSideBySideAddnCoveragesPanelSet-1-HOCoverageInputSet-CovPatternInputGroup-_checkbox"]',
    fairPlanLabelClass: '.gw-InputGroup--header--label',
    autoDiscountCheckboxExact:
      'input[name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-MultiLineDiscounts_ExtInputSet-MultiLineDiscounts_ExtLV-0-DiscountSelected"]'
  };

  const IDS = {
    policyInfoTab: 'SubmissionWizard-LOBWizardStepGroup-PolicyInfo',
    dwellingTab: 'SubmissionWizard-LOBWizardStepGroup-HomeownersDwelling',
    coveragesTab: 'SubmissionWizard-LOBWizardStepGroup-HOCoveragesSideBySide',
    exclusionsTab: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideScreenBasePanelSet-SideBySideScreenPanelSet-HOPolicyLevelExclusionsAndConditionsCardTab',
    quoteTab: 'SubmissionWizard-ViewQuote',
    coveragesHeader: 'Coverages',
    coveragesScreen: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen',
    mainArea: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV',
    quoteButtonHost: 'SubmissionWizard-Quote',

    name: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-Name_Input',
    mailingAddress: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-PolicyAddressDisplayInputSet-PolicyAddress_Ext_Input',
    riskAddressPolicyInfo: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-HODwellingLocationHOEInputSet-HODwellingLocationInput_Input',
    accountNumberInfoBar: 'SubmissionWizard-JobWizardInfoBar-AccountNumber',

    fireCode: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HOFirelineCode_Input',
    fireBlock: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-7',
    protectionBlock: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-5',
    reconstruction: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-VRsikUpdateDV-reconstructionCostId_Input',
    yearBuilt: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-YearBuilt_Input',
    squareFeet: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-ApproxSqFoot_Input',
    stories: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-NumberOfStoriesorStyle_Input',
    waterDevice: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-HoWaterProtectionDevice_Input',

    pricingTable: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV',
    standardPrice: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-periodInfoPremiumIterator-0-PremiumValue',
    enhancePrice: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-periodInfoPremiumIterator-1-PremiumValue',

    autoDiscountLV: 'SubmissionWizard-SubmissionWizard_QuoteScreen-HOCrossSellDetailsPanelSet-potentialLV'
  };

  const LABELS = {
    editQuote: 'Edit Quote',
    fairPlanCompanionEndorsement: 'FAIR Plan Companion Endorsement'
  };

  const COVERAGES_WARNING_FRAGMENTS = [
    'deductible has been increased.',
    'minimum $5,000 split water deductible.'
  ];

  const state = {
    running: true,
    busy: false,
    destroyed: false,
    tickTimer: null,
    logsIntervalTimer: null,
    doneThisLoad: false,
    flowStartedThisLoad: false,
    triggerSince: 0,
    activeHandoffRequestedAt: '',
    lastWaitReason: '',
    logLines: [],
    ui: null,
    tickCount: 0,
    lastSnapshotTick: 0,
    lastTriggerSource: '',
    announcedSkipReason: '',
    coverageTriggerSince: 0,
    pageLoadedAtMs: Date.now(),
    currentAzId: '',
    autoDiscountChosenThisLoad: false,
    lastQuoteClickAt: 0,
    lastTabNudgeAt: 0,
    lastStatus: '',
    activityState: 'idle',
    activityMessage: 'Background gatherer armed',
    coveragesWarningSignature: '',
    coveragesWarningSinceMs: 0,
    coveragesRetryBlockedUntilMs: 0,
    customFieldPicker: null,
    customFieldHoverBox: null,
    customFieldPickerMove: null,
    customFieldPickerClick: null,
    customFieldPickerKeydown: null
  };

  const SNAPSHOT_EVERY_TICKS = 10;
  const OPTIONAL_FINAL_HOME_ROW_KEYS = new Set([
    'Risk Address',
    'Account Number',
    'Home Roof Type',
    'Bedrooms',
    'Bathrooms',
    'Home Type',
    'Done?',
    'Result'
  ]);

  init();

  function safeJsonParse(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function parseTimeMs(value) {
    const ms = Date.parse(String(value || ''));
    return Number.isFinite(ms) ? ms : 0;
  }

  function isFreshTriggerTimestamp(value) {
    const ms = parseTimeMs(value);
    return ms > 0 && ms > state.pageLoadedAtMs;
  }

  function readFlowStage() {
    const stage = safeJsonParse(localStorage.getItem(FLOW_STAGE_KEY), null);
    return isPlainObject(stage) ? stage : {};
  }

  function matchesStage(product, step, azId = '') {
    const stage = readFlowStage();
    if (normalizeText(stage.product) !== normalizeText(product)) return false;
    if (normalizeText(stage.step) !== normalizeText(step)) return false;
    if (!normalizeText(stage.azId) || !normalizeText(azId)) return true;
    return normalizeText(stage.azId) === normalizeText(azId);
  }

  function writeFlowStage(product, step, azId = '') {
    const next = {
      product: normalizeText(product),
      step: normalizeText(step),
      azId: normalizeText(azId),
      updatedAt: new Date().toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    localStorage.setItem(FLOW_STAGE_KEY, JSON.stringify(next, null, 2));
    return next;
  }

  function readHomeQuoteGrabberTriggerFromGm() {
    try {
      if (typeof GM_getValue !== 'function') return null;
      const raw = GM_getValue(HOME_QUOTE_GRABBER_TRIGGER_KEY, null);
      if (raw == null) return null;
      const parsed = typeof raw === 'string' ? safeJsonParse(raw, null) : raw;
      return isPlainObject(parsed) ? parsed : null;
    } catch { return null; }
  }

  function readHomeQuoteGrabberTriggerFromLocalStorage() {
    const parsed = safeJsonParse(localStorage.getItem(HOME_QUOTE_GRABBER_TRIGGER_KEY), null);
    return isPlainObject(parsed) ? parsed : null;
  }

  function readHomeQuoteGrabberTrigger() {
    // GM storage bridges PolicyCenter subdomains (writer may be on a
    // different origin). localStorage is the same-origin fast path.
    // If both exist, prefer the one with the newer requestedAt.
    const gm = readHomeQuoteGrabberTriggerFromGm();
    const ls = readHomeQuoteGrabberTriggerFromLocalStorage();
    if (gm && ls) {
      const gmAt = normalizeText(gm.requestedAt || '');
      const lsAt = normalizeText(ls.requestedAt || '');
      if (lsAt && lsAt > gmAt) {
        state.lastTriggerSource = 'localStorage';
        return ls;
      }
      state.lastTriggerSource = 'GM';
      return gm;
    }
    if (gm) { state.lastTriggerSource = 'GM'; return gm; }
    if (ls) { state.lastTriggerSource = 'localStorage'; return ls; }
    state.lastTriggerSource = '';
    return {};
  }

  function getUsableHomeQuoteGrabberHandoff(azId = '') {
    const handoff = readHomeQuoteGrabberTrigger();
    const requestedAt = normalizeText(handoff.requestedAt || '');
    if (!requestedAt) return null;
    if (handoff.consumed === true) return null;
    if (normalizeText(handoff.to || '') && normalizeText(handoff.to || '') !== normalizeText(SCRIPT_NAME)) return null;

    const handoffAzId = normalizeText(handoff.azId || '');
    if (handoffAzId && normalizeText(azId) && handoffAzId !== normalizeText(azId)) return null;

    return handoff;
  }

  function consumeHomeQuoteGrabberHandoff(azId = '') {
    const handoff = readHomeQuoteGrabberTrigger();
    const requestedAt = normalizeText(handoff.requestedAt || '');
    if (!requestedAt) return;
    const handoffAzId = normalizeText(handoff.azId || '');
    if (handoffAzId && normalizeText(azId) && handoffAzId !== normalizeText(azId)) return;

    const next = {
      ...handoff,
      consumed: true,
      consumedAt: new Date().toISOString(),
      consumedBy: SCRIPT_NAME
    };
    const serialized = JSON.stringify(next, null, 2);
    try { localStorage.setItem(HOME_QUOTE_GRABBER_TRIGGER_KEY, serialized); } catch {}
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(HOME_QUOTE_GRABBER_TRIGGER_KEY, serialized);
      }
    } catch {}
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function buildMailingAddress(address, city, stateValue, zipCode) {
    const a = normalizeText(address);
    const c = normalizeText(city);
    const s = normalizeText(stateValue);
    const z = normalizeText(zipCode);
    if (a && c && s && z) return `${a}, ${c}, ${s} ${z}`.trim();
    return [a, c, s, z].filter(Boolean).join(', ').trim();
  }

  function normalizeCurrentJob(raw) {
    const out = {
      'AZ ID': '',
      'Name': '',
      'Mailing Address': '',
      'SubmissionNumber': '',
      'updatedAt': '',
      'First Name': '',
      'Last Name': '',
      'Email': '',
      'Phone': '',
      'DOB': '',
      'Street Address': '',
      'City': '',
      'State': '',
      'Zip': ''
    };

    if (!isPlainObject(raw)) return out;

    const az = isPlainObject(raw.az) ? raw.az : {};
    const legacyName = [az['AZ Name'], az['AZ Last']].map(v => normalizeText(v)).filter(Boolean).join(' ').trim();
    const legacyAddress = buildMailingAddress(az['AZ Street Address'], az['AZ City'], az['AZ State'], az['AZ Postal Code']);

    out['AZ ID'] = normalizeText(raw['AZ ID'] || raw.ticketId || raw.masterId || raw.id || az['AZ ID'] || '');
    out['Name'] = normalizeText(raw['Name'] || raw.name || legacyName || '');
    out['Mailing Address'] = normalizeText(raw['Mailing Address'] || raw.mailingAddress || legacyAddress || '');
    out['SubmissionNumber'] = normalizeText(raw['SubmissionNumber'] || raw.submissionNumber || raw['Submission Number'] || '');
    out['updatedAt'] = normalizeText(raw['updatedAt'] || raw.lastUpdatedAt || raw?.meta?.lastUpdatedAt || raw?.meta?.createdAt || '');
    out['First Name'] = normalizeText(raw['First Name'] || raw.firstName || az['First Name'] || az['AZ Name'] || '');
    out['Last Name'] = normalizeText(raw['Last Name'] || raw.lastName || az['Last Name'] || az['AZ Last'] || '');
    out['Email'] = normalizeText(raw['Email'] || raw.email || az['Email'] || az['AZ Email'] || '');
    out['Phone'] = normalizeText(raw['Phone'] || raw.phone || az['Phone'] || az['AZ Phone'] || '');
    out['DOB'] = normalizeText(raw['DOB'] || raw.dob || az['DOB'] || az['AZ DOB'] || '');
    out['Street Address'] = normalizeText(raw['Street Address'] || raw.streetAddress || az['Street Address'] || az['AZ Street Address'] || '');
    out['City'] = normalizeText(raw['City'] || raw.city || az['City'] || az['AZ City'] || '');
    out['State'] = normalizeText(raw['State'] || raw.state || az['State'] || az['AZ State'] || '');
    out['Zip'] = normalizeText(raw['Zip'] || raw.zip || raw.zipCode || az['Zip'] || az['AZ Postal Code'] || '');
    return out;
  }

  function readCurrentJob() {
    let raw = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    let job = normalizeCurrentJob(raw);
    if (job['AZ ID']) return job;

    raw = safeJsonParse(localStorage.getItem(LEGACY_SHARED_JOB_KEY), null);
    job = normalizeCurrentJob(raw);
    return job;
  }

  function writeCurrentJob(job) {
    const next = normalizeCurrentJob(job);
    next.updatedAt = next.updatedAt || new Date().toISOString();
    try { localStorage.setItem(CURRENT_JOB_KEY, JSON.stringify(next, null, 2)); } catch {}
    return next;
  }

  function mergeCurrentJob(update) {
    const current = readCurrentJob();
    const incoming = normalizeCurrentJob(update || {});

    if (current['AZ ID'] && incoming['AZ ID'] && current['AZ ID'] !== incoming['AZ ID']) {
      return { ok: false, reason: `AZ ID mismatch (${current['AZ ID']} != ${incoming['AZ ID']})`, current };
    }

    const next = {
      'AZ ID': incoming['AZ ID'] || current['AZ ID'] || '',
      'Name': incoming['Name'] || current['Name'] || '',
      'Mailing Address': incoming['Mailing Address'] || current['Mailing Address'] || '',
      'SubmissionNumber': incoming['SubmissionNumber'] || current['SubmissionNumber'] || '',
      'updatedAt': new Date().toISOString(),
      'First Name': incoming['First Name'] || current['First Name'] || '',
      'Last Name': incoming['Last Name'] || current['Last Name'] || '',
      'Email': incoming['Email'] || current['Email'] || '',
      'Phone': incoming['Phone'] || current['Phone'] || '',
      'DOB': incoming['DOB'] || current['DOB'] || '',
      'Street Address': incoming['Street Address'] || current['Street Address'] || '',
      'City': incoming['City'] || current['City'] || '',
      'State': incoming['State'] || current['State'] || '',
      'Zip': incoming['Zip'] || current['Zip'] || ''
    };

    return { ok: true, current, next: writeCurrentJob(next) };
  }

  function readBundle() {
    return safeJsonParse(localStorage.getItem(BUNDLE_KEY), null);
  }

  function writeBundle(bundle) {
    localStorage.setItem(BUNDLE_KEY, JSON.stringify(bundle, null, 2));
    return bundle;
  }

  function emptyBundleForJob(job) {
    return {
      'AZ ID': normalizeText(job && job['AZ ID']),
      'Name': normalizeText(job && job['Name']),
      'Mailing Address': normalizeText(job && job['Mailing Address']),
      'SubmissionNumber': normalizeText(job && job['SubmissionNumber']),
      home: {},
      auto: {},
      timeout: { events: [] },
      meta: {
        updatedAt: new Date().toISOString(),
        lastWriter: SCRIPT_NAME,
        version: VERSION
      }
    };
  }

  function emptyHomeRow() {
    return {
      'Name': '',
      'Mailing Address': '',
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
      'Bedrooms': '',
      'Bathrooms': '',
      'Home Type': '',
      'Water Device?': '',
      'Standard Pricing No Auto Discount': '',
      'Enhance Pricing No Auto Discount': '',
      'Standard Pricing Auto Discount': '',
      'Enhance Pricing Auto Discount': '',
      'Submission Number': '',
      'Auto Discount': '',
      'Date Processed?': '',
      'Done?': '',
      'Result': ''
    };
  }

  function emptyHomeProgress() {
    return {
      earlyPolicyInfoCaptured: false,
      earlyDwellingCaptured: false,
      pass1PricingCaptured: false,
      pass2PricingCaptured: false,
      finalRefreshComplete: false
    };
  }

  function emptyHomeTabsUsed() {
    return {
      coveragesEditedAndQuotedInitially: false,
      coveragesNoAutoDiscount: false,
      policyInfo: false,
      editQuote: false,
      quoteAfterAutoDiscount: false,
      dwelling: false,
      coveragesAutoDiscount: false,
      exclusionsAndConditions: false,
      quoteFinal: false,
      fairPlanCompanionEndorsementDetected: false
    };
  }

  function readHomePayloadRaw() {
    return safeJsonParse(localStorage.getItem(KEYS.payload), null);
  }

  function createHomePayloadBase(job) {
    const currentJob = normalizeCurrentJob(job);
    const now = new Date().toISOString();
    return {
      script: SCRIPT_NAME,
      version: VERSION,
      event: 'home_quote_gathered',
      product: 'home',
      ready: false,
      'AZ ID': currentJob['AZ ID'],
      currentJob,
      savedAt: now,
      page: {
        url: location.href,
        title: document.title
      },
      flow: 'background',
      meta: {
        phase: 'idle',
        progress: emptyHomeProgress(),
        updatedAt: now,
        lastWriter: SCRIPT_NAME,
        version: VERSION
      },
      customFields: {},
      quoteAfterDiscount: {},
      tabsUsed: emptyHomeTabsUsed(),
      row: emptyHomeRow()
    };
  }

  function ensureHomePayloadForJob(job) {
    const currentJob = normalizeCurrentJob(job);
    const azId = normalizeText(currentJob['AZ ID']);
    const current = readHomePayloadRaw();
    const currentAzId = normalizeText(current?.['AZ ID'] || current?.currentJob?.['AZ ID'] || '');

    if (!azId || !isPlainObject(current) || currentAzId !== azId) {
      return createHomePayloadBase(currentJob);
    }

    const next = createHomePayloadBase({
      ...(isPlainObject(current.currentJob) ? current.currentJob : {}),
      ...currentJob,
      'AZ ID': azId
    });

    next.ready = current.ready === true;
    next.savedAt = normalizeText(current.savedAt || '') || next.savedAt;
    next.page = isPlainObject(current.page) ? current.page : next.page;
    next.flow = normalizeText(current.flow || next.flow) || next.flow;
    next.customFields = isPlainObject(current.customFields) ? current.customFields : {};
    next.row = {
      ...emptyHomeRow(),
      ...(isPlainObject(current.row) ? current.row : {})
    };
    next.quoteAfterDiscount = isPlainObject(current.quoteAfterDiscount)
      ? current.quoteAfterDiscount
      : {};
    next.tabsUsed = {
      ...emptyHomeTabsUsed(),
      ...(isPlainObject(current.tabsUsed) ? current.tabsUsed : {})
    };
    next.meta = isPlainObject(current.meta) ? current.meta : {};
    next.meta.phase = normalizeText(next.meta.phase || '') || 'idle';
    next.meta.progress = {
      ...emptyHomeProgress(),
      ...(isPlainObject(current.meta?.progress) ? current.meta.progress : {})
    };
    next.meta.updatedAt = normalizeText(next.meta.updatedAt || '') || next.meta.updatedAt || next.savedAt;
    next.meta.lastWriter = normalizeText(next.meta.lastWriter || '') || SCRIPT_NAME;
    next.meta.version = normalizeText(next.meta.version || '') || VERSION;
    return next;
  }

  function mergeHomeRow(baseRow, updates) {
    const next = {
      ...emptyHomeRow(),
      ...(isPlainObject(baseRow) ? baseRow : {})
    };

    if (!isPlainObject(updates)) return next;

    for (const [key, value] of Object.entries(updates)) {
      if (value == null) continue;
      const text = typeof value === 'string' ? value : String(value);
      if (!text && key !== 'Done?' && key !== 'Result') continue;
      next[key] = text;
    }

    return next;
  }

  function mergeBooleanProgress(baseProgress, updates) {
    const next = {
      ...emptyHomeProgress(),
      ...(isPlainObject(baseProgress) ? baseProgress : {})
    };

    if (!isPlainObject(updates)) return next;

    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'boolean') next[key] = value;
    }

    return next;
  }

  function mergeTabsUsed(baseTabs, updates) {
    const next = {
      ...emptyHomeTabsUsed(),
      ...(isPlainObject(baseTabs) ? baseTabs : {})
    };

    if (!isPlainObject(updates)) return next;

    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'boolean') next[key] = value;
    }

    return next;
  }

  function hashString(value) {
    const input = String(value || '');
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return `h${Math.abs(hash)}`;
  }

  function buildCustomFieldRuleId(headerText, fieldName) {
    return `custom_${hashString(`${normalizeText(headerText).toLowerCase()}|${normalizeText(fieldName).toLowerCase()}`)}`;
  }

  function normalizeCustomFieldHeaderKey(text) {
    const raw = normalizeText(text).toLowerCase();
    if (!raw) return '';
    if (raw.includes('disclosure') && raw.includes('qualification')) return 'disclosure qualification';
    if (raw.includes('policy info')) return 'policy info';
    if (raw.includes('policy summary')) return 'policy summary';
    if (raw.includes('dwelling')) return 'dwelling';
    if (raw.includes('coverages')) return 'coverages';
    if (raw.includes('exclusions') && raw.includes('conditions')) return 'exclusions and conditions';
    if (raw === 'quote' || raw.includes('view quote')) return 'quote';
    return raw
      .replace(/\b\d{5,}\b/g, '')
      .replace(/:\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function customFieldHeaderMatches(savedHeader, currentHeader) {
    const saved = normalizeText(savedHeader);
    const current = normalizeText(currentHeader);
    if (!saved || !current) return false;
    if (saved === current) return true;
    const savedKey = normalizeCustomFieldHeaderKey(saved);
    const currentKey = normalizeCustomFieldHeaderKey(current);
    return !!savedKey && savedKey === currentKey;
  }

  function normalizeCustomFieldRule(raw) {
    if (!isPlainObject(raw)) return null;

    const headerText = normalizeText(raw.headerText || raw.header || '');
    const fieldName = normalizeText(raw.fieldName || raw.saveAs || raw.label || '');
    const selector = normalizeText(raw.selector || raw.cssSelector || '');
    if (!headerText || !fieldName || !selector) return null;

    const fingerprintRaw = isPlainObject(raw.fingerprint) ? raw.fingerprint : {};
    return {
      ruleId: normalizeText(raw.ruleId || buildCustomFieldRuleId(headerText, fieldName)),
      headerText,
      headerKey: normalizeText(raw.headerKey || normalizeCustomFieldHeaderKey(headerText)),
      fieldName,
      labelText: normalizeText(raw.labelText || raw.fieldLabel || ''),
      selector,
      fingerprint: {
        tag: normalizeText(fingerprintRaw.tag || ''),
        id: normalizeText(fingerprintRaw.id || ''),
        name: normalizeText(fingerprintRaw.name || ''),
        role: normalizeText(fingerprintRaw.role || ''),
        ariaLabel: normalizeText(fingerprintRaw.ariaLabel || ''),
        classTokens: Array.isArray(fingerprintRaw.classTokens)
          ? fingerprintRaw.classTokens.map((value) => normalizeText(value)).filter(Boolean).slice(0, 4)
          : [],
        textFingerprint: normalizeText(fingerprintRaw.textFingerprint || '')
      },
      savedAt: normalizeText(raw.savedAt || new Date().toISOString()),
      updatedAt: normalizeText(raw.updatedAt || raw.savedAt || new Date().toISOString())
    };
  }

  function readCustomFieldRules() {
    const raw = safeJsonParse(localStorage.getItem(KEYS.customFieldRules), []);
    const list = Array.isArray(raw) ? raw.map(normalizeCustomFieldRule).filter(Boolean) : [];
    return list;
  }

  function writeCustomFieldRules(rules) {
    const list = Array.isArray(rules) ? rules.map(normalizeCustomFieldRule).filter(Boolean) : [];
    localStorage.setItem(KEYS.customFieldRules, JSON.stringify(list, null, 2));
    updateCustomFieldButtons();
    return list;
  }

  function upsertCustomFieldRule(rule) {
    const nextRule = normalizeCustomFieldRule(rule);
    if (!nextRule) return null;
    const current = readCustomFieldRules();
    const next = current.filter((item) => item.ruleId !== nextRule.ruleId);
    next.push(nextRule);
    writeCustomFieldRules(next);
    return nextRule;
  }

  function clearCustomFieldRules() {
    try { localStorage.removeItem(KEYS.customFieldRules); } catch {}
    updateCustomFieldButtons();
  }

  function isPayloadRowChanged(currentRow, updates) {
    if (!isPlainObject(updates)) return false;
    const row = {
      ...emptyHomeRow(),
      ...(isPlainObject(currentRow) ? currentRow : {})
    };

    return Object.entries(updates).some(([key, value]) => {
      const nextValue = typeof value === 'string' ? value : String(value ?? '');
      if (!nextValue && key !== 'Done?' && key !== 'Result') return false;
      return normalizeText(row[key]) !== normalizeText(nextValue);
    });
  }

  function normalizeHomeState(job) {
    const payload = ensureHomePayloadForJob(job);
    const row = payload.row || emptyHomeRow();
    const progress = payload.meta?.progress || emptyHomeProgress();
    return {
      payload,
      row,
      progress,
      ready: payload.ready === true,
      pass1Ready: progress.pass1PricingCaptured === true || (!!row['Standard Pricing No Auto Discount'] && !!row['Enhance Pricing No Auto Discount']),
      pass2Ready: progress.pass2PricingCaptured === true || (!!row['Standard Pricing Auto Discount'] && !!row['Enhance Pricing Auto Discount']),
      finalRefreshReady: progress.finalRefreshComplete === true
    };
  }

  function saveHomeState(job, options = {}) {
    const currentJob = normalizeCurrentJob(job);
    if (!currentJob['AZ ID']) return { ok: false, reason: 'Missing current AZ job' };

    const now = new Date().toISOString();
    const next = ensureHomePayloadForJob(currentJob);
    next.script = SCRIPT_NAME;
    next.version = VERSION;
    next.event = 'home_quote_gathered';
    next.product = 'home';
    next.flow = 'background';
    next['AZ ID'] = currentJob['AZ ID'];
    next.currentJob = normalizeCurrentJob({
      ...(isPlainObject(next.currentJob) ? next.currentJob : {}),
      ...currentJob
    });
    next.row = mergeHomeRow(next.row, options.rowUpdates || {});
    next.customFields = isPlainObject(next.customFields) ? next.customFields : {};
    if (isPlainObject(options.customFields)) {
      for (const [key, value] of Object.entries(options.customFields)) {
        const text = typeof value === 'string' ? value : String(value ?? '');
        if (!normalizeText(text)) continue;
        next.customFields[key] = text;
      }
    }
    next.quoteAfterDiscount = isPlainObject(options.quoteAfterDiscount)
      ? {
        ...(isPlainObject(next.quoteAfterDiscount) ? next.quoteAfterDiscount : {}),
        ...options.quoteAfterDiscount
      }
      : (isPlainObject(next.quoteAfterDiscount) ? next.quoteAfterDiscount : {});
    next.tabsUsed = mergeTabsUsed(next.tabsUsed, options.tabsUsed || {});
    next.meta = isPlainObject(next.meta) ? next.meta : {};
    next.meta.phase = normalizeText(options.phase || next.meta.phase || 'idle') || 'idle';
    next.meta.progress = mergeBooleanProgress(next.meta.progress, options.progressUpdates || {});
    next.meta.updatedAt = now;
    next.meta.lastWriter = SCRIPT_NAME;
    next.meta.version = VERSION;
    next.ready = options.ready === true ? true : options.ready === false ? false : next.ready === true;
    next.savedAt = now;
    next.page = isPlainObject(options.page)
      ? {
        url: normalizeText(options.page.url || location.href),
        title: normalizeText(options.page.title || document.title)
      }
      : {
        url: location.href,
        title: document.title
      };

    localStorage.setItem(KEYS.payload, JSON.stringify(next, null, 2));

    const bundleSave = saveBundleSection('home', next, next.currentJob, {
      submissionNumber: next.row['Submission Number'] || next.currentJob['SubmissionNumber'] || '',
      payloadKey: KEYS.payload,
      ready: next.ready === true,
      phase: next.meta.phase,
      progress: next.meta.progress
    });

    if (!bundleSave.ok) return { ok: false, reason: bundleSave.reason || 'Bundle save failed', payload: next };
    return { ok: true, payload: next, bundle: bundleSave.bundle };
  }

  function buildFinalRowResult(row) {
    const nextRow = mergeHomeRow(emptyHomeRow(), row || {});
    const missing = Object.entries(nextRow)
      .filter(([key, value]) => !normalizeText(value) && !OPTIONAL_FINAL_HOME_ROW_KEYS.has(key))
      .map(([key]) => key);

    if (missing.length) {
      nextRow['Done?'] = 'No';
      nextRow['Result'] = `Missing: ${missing.join(', ')}`;
      return { row: nextRow, ready: false, missing };
    }

    nextRow['Done?'] = 'Yes';
    nextRow['Result'] = 'Grabbed (background flow)';
    return { row: nextRow, ready: true, missing: [] };
  }

  function ensureBundleForJob(job) {
    const azId = normalizeText(job && job['AZ ID']);
    if (!azId) return null;

    const bundle = readBundle();
    if (!isPlainObject(bundle) || !normalizeText(bundle['AZ ID'])) {
      return writeBundle(emptyBundleForJob(job));
    }

    if (normalizeText(bundle['AZ ID']) !== azId) {
      return writeBundle(emptyBundleForJob(job));
    }

    bundle['Name'] = bundle['Name'] || normalizeText(job['Name']);
    bundle['Mailing Address'] = bundle['Mailing Address'] || normalizeText(job['Mailing Address']);
    bundle['SubmissionNumber'] = bundle['SubmissionNumber'] || normalizeText(job['SubmissionNumber']);
    bundle.timeout = isPlainObject(bundle.timeout) ? bundle.timeout : { events: [] };
    if (!Array.isArray(bundle.timeout.events)) bundle.timeout.events = [];
    bundle.meta = isPlainObject(bundle.meta) ? bundle.meta : {};
    bundle.meta.updatedAt = new Date().toISOString();
    bundle.meta.lastWriter = SCRIPT_NAME;
    bundle.meta.version = VERSION;
    return writeBundle(bundle);
  }

  function saveBundleSection(sectionName, sectionValue, job, extra = {}) {
    const bundle = ensureBundleForJob(job);
    if (!bundle) return { ok: false, reason: 'Missing current AZ job' };

    const next = deepClone(bundle);
    next['Name'] = normalizeText(job['Name']) || next['Name'] || '';
    next['Mailing Address'] = normalizeText(job['Mailing Address']) || next['Mailing Address'] || '';

    if (extra.submissionNumber) {
      next['SubmissionNumber'] = normalizeText(extra.submissionNumber);
      mergeCurrentJob({ 'AZ ID': job['AZ ID'], 'SubmissionNumber': next['SubmissionNumber'] });
    }

    next[sectionName] = {
      ready: extra.ready === true,
      savedAt: new Date().toISOString(),
      script: SCRIPT_NAME,
      version: VERSION,
      payloadKey: extra.payloadKey || '',
      submissionNumber: normalizeText(extra.submissionNumber || ''),
      data: deepClone(sectionValue),
      meta: {
        phase: normalizeText(extra.phase || ''),
        progress: isPlainObject(extra.progress) ? deepClone(extra.progress) : {}
      }
    };

    next.meta = isPlainObject(next.meta) ? next.meta : {};
    next.meta.updatedAt = new Date().toISOString();
    next.meta.lastWriter = SCRIPT_NAME;
    next.meta.version = VERSION;
    writeBundle(next);
    return { ok: true, bundle: next };
  }

  function init() {
    buildUI();
    log(`Script started v${VERSION}`);
    log(`Origin: ${location.origin}`);
    log(`Grants: GM_getValue=${typeof GM_getValue}, GM_setValue=${typeof GM_setValue}, GM_deleteValue=${typeof GM_deleteValue}`);
    log('Auto-run armed');
    setStatus('Background gatherer armed');
    writeActivityState('waiting', 'Background gatherer armed');
    state.tickTimer = setInterval(() => {
      if (state.destroyed) return;
      try { tick(); } catch (err) {
        log(`tick() crashed: ${err?.message || err}`);
        writeActivityState('error', err?.message || 'Tick error');
        setStatus('Tick error (see log)');
      }
    }, CFG.tickMs);
    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();
    try { tick(); } catch (err) {
      log(`tick() crashed: ${err?.message || err}`);
      setStatus('Tick error (see log)');
    }

    window.__HOME_QUOTE_GRABBER_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { writeActivityState('stopped', 'Cleanup'); } catch {}
    try { stopCustomFieldPicker('', { logIt: false, restoreStatus: 'Stopped' }); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    state.tickTimer = null;
    state.logsIntervalTimer = null;
    try { delete window.__HOME_QUOTE_GRABBER_CLEANUP__; } catch {}
  }

  function announceSkipReason(reason) {
    if (state.announcedSkipReason === reason) return;
    state.announcedSkipReason = reason;
    log(`Tick skipped: ${reason}`);
  }

  function logHomeSnapshot(currentJob, homeState) {
    const stage = readFlowStage();
    const progress = homeState?.progress || emptyHomeProgress();
    const flags = [
      progress.earlyPolicyInfoCaptured ? 'policy' : '',
      progress.earlyDwellingCaptured ? 'dwelling' : '',
      progress.pass1PricingCaptured ? 'pass1' : '',
      progress.pass2PricingCaptured ? 'pass2' : '',
      progress.finalRefreshComplete ? 'final' : ''
    ].filter(Boolean).join(',');
    const parts = [
      `job.AZ=${currentJob['AZ ID'] || '(empty)'}`,
      `phase=${normalizeText(homeState?.payload?.meta?.phase || '') || '(idle)'}`,
      `ready=${homeState?.ready === true ? 'yes' : 'no'}`,
      `progress=${flags || '(none)'}`,
      `stage=${normalizeText(stage.product) || '(none)'}/${normalizeText(stage.step) || '(none)'}`,
      `header=${getHeaderText() || '(none)'}`
    ];
    log(`Snapshot: ${parts.join(' | ')}`);
  }

  function syncAzContext(currentJob) {
    const azId = normalizeText(currentJob?.['AZ ID'] || '');
    if (!azId) {
      state.currentAzId = '';
      state.autoDiscountChosenThisLoad = false;
      return;
    }

    if (azId === state.currentAzId) return;

    log(`AZ context changed: ${state.currentAzId || '(none)'} -> ${azId}`);
    state.currentAzId = azId;
    state.doneThisLoad = false;
    state.flowStartedThisLoad = false;
    state.triggerSince = 0;
    state.activeHandoffRequestedAt = '';
    state.announcedSkipReason = '';
    state.autoDiscountChosenThisLoad = false;
    state.coveragesWarningSignature = '';
    state.coveragesWarningSinceMs = 0;
    state.coveragesRetryBlockedUntilMs = 0;
  }

  function tick() {
    state.tickCount++;
    if (!state.running) {
      writeActivityState('stopped', 'Stopped');
      announceSkipReason('state.running=false');
      return;
    }
    if (state.customFieldPicker) {
      writeActivityState('paused', 'Custom field picker active');
      setStatus(`Custom picker: click ${state.customFieldPicker.step === 'header' ? 'header' : 'field'}`);
      announceSkipReason('customFieldPicker=active');
      return;
    }
    if (state.busy) {
      writeActivityState('working', state.lastStatus || 'Working Home gather');
      announceSkipReason('state.busy=true');
      return;
    }
    state.announcedSkipReason = '';

    const currentJob = readCurrentJob();
    syncAzContext(currentJob);

    if (!currentJob['AZ ID']) {
      setWaiting('Waiting for current job handoff');
      if (state.tickCount - state.lastSnapshotTick >= SNAPSHOT_EVERY_TICKS) {
        state.lastSnapshotTick = state.tickCount;
        logHomeSnapshot(currentJob, normalizeHomeState(currentJob));
      }
      return;
    }

    if (hasVisibleExactLabel('Personal Auto')) {
      setWaiting('Blocked: Personal Auto present');
      return;
    }

    maybeCaptureVisibleAccountInfo(currentJob);
    maybeCaptureVisiblePolicyInfo(currentJob);
    maybeCaptureVisibleDwelling(currentJob);

    const homeState = normalizeHomeState(readCurrentJob());
    if (homeState.ready === true) {
      state.doneThisLoad = true;
      writeActivityState('done', 'Home gather complete');
      setStatus('Home gather complete');
      if (state.tickCount - state.lastSnapshotTick >= SNAPSHOT_EVERY_TICKS) {
        state.lastSnapshotTick = state.tickCount;
        logHomeSnapshot(currentJob, homeState);
      }
      return;
    }

    if (state.doneThisLoad) {
      writeActivityState('done', 'Home gather complete');
      announceSkipReason('doneThisLoad=true (current AZ already complete)');
      return;
    }

    if (state.flowStartedThisLoad) {
      writeActivityState('working', state.lastStatus || 'Home flow in progress');
      announceSkipReason('flowStartedThisLoad=true (background flow in progress)');
      return;
    }

    if (maybeHandleCoveragesWarningRecovery(currentJob, homeState)) {
      if (state.tickCount - state.lastSnapshotTick >= SNAPSHOT_EVERY_TICKS) {
        state.lastSnapshotTick = state.tickCount;
        logHomeSnapshot(currentJob, homeState);
      }
      return;
    }

    if (!homeState.pass1Ready && !isOnCoverageEditPage()) {
      setWaiting('Monitoring for Home Coverages pass 1');
      if (state.tickCount - state.lastSnapshotTick >= SNAPSHOT_EVERY_TICKS) {
        state.lastSnapshotTick = state.tickCount;
        logHomeSnapshot(currentJob, homeState);
      }
      return;
    }

    startHomeFlow(currentJob, `phase=${homeState.pass1Ready ? 'pass2/final' : 'pass1'}`);
  }

  function hasVisibleExactLabel(labelText) {
    const docs = getAccessibleDocs();
    for (const doc of docs) {
      try {
        const nodes = doc.querySelectorAll('.gw-label');
        for (const el of nodes) {
          if (!isVisibleEl(el)) continue;
          if (normalizeText(el.textContent || '') === labelText) return true;
        }
      } catch {}
    }
    return false;
  }

  function isVisibleEl(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
      const r = el.getBoundingClientRect?.();
      if (!r || r.width === 0 || r.height === 0) return false;
      const win = el.ownerDocument?.defaultView || window;
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (el.closest?.('[aria-hidden="true"]')) return false;
      return true;
    } catch { return false; }
  }

  function byId(id) {
    try { return document.getElementById(id); } catch { return null; }
  }

  function q(sel, root = document) {
    try { return root.querySelector(sel); } catch { return null; }
  }

  function queryFirstVisible(selector) {
    try {
      return Array.from(document.querySelectorAll(selector)).find(isVisibleEl) || null;
    } catch { return null; }
  }

  function findVisibleNodeInDocs(selector) {
    return findInDocs((doc) => {
      const nodes = doc.querySelectorAll(selector);
      for (const el of nodes) {
        if (isVisibleEl(el)) return el;
      }
      return null;
    });
  }

  function getHeaderText() {
    const titleBarNode = findVisibleNodeInDocs('.gw-TitleBar--title, .gw-TitleBar--Title');
    if (titleBarNode) return normalizeText(titleBarNode.textContent || '');
    const wizardNode = findVisibleNodeInDocs('.gw-Wizard--Title');
    return normalizeText(wizardNode?.textContent || '');
  }

  function headerStillCoverages() {
    return getHeaderText() === IDS.coveragesHeader;
  }

  function getSubmissionStateLabel() {
    if (hasVisibleExactLabel('Submission (Quoted)')) return 'quoted';
    if (hasVisibleExactLabel('Submission (Draft)')) return 'draft';
    return '';
  }

  function isSubmissionDraft() {
    return getSubmissionStateLabel() === 'draft';
  }

  function isSubmissionQuoted() {
    return getSubmissionStateLabel() === 'quoted';
  }

  function readNavigationSnapshot() {
    return {
      header: getHeaderText(),
      submissionState: getSubmissionStateLabel()
    };
  }

  function describeNavigationSnapshot(snapshot) {
    const header = normalizeText(snapshot?.header || '') || '(none)';
    const submissionState = normalizeText(snapshot?.submissionState || '') || 'unknown';
    return `header="${header}" | submission=${submissionState}`;
  }

  function didHeaderChange(before, after) {
    const beforeHeader = normalizeText(before?.header || '');
    const afterHeader = normalizeText(after?.header || '');
    return !!afterHeader && beforeHeader !== afterHeader;
  }

  function advancedToSubmissionState(before, after, wantedState) {
    const beforeState = normalizeText(before?.submissionState || '');
    const afterState = normalizeText(after?.submissionState || '');
    return !!afterState && afterState === wantedState && beforeState !== wantedState;
  }

  function isCoveragesTabSelected() {
    const inner = findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.coveragesTab)} > div.gw-action--inner`));
    if (!inner || !isVisibleEl(inner)) return false;
    const parentSelected = normalizeText(inner.parentElement?.getAttribute?.('aria-selected') || '');
    const innerSelected = normalizeText(inner.getAttribute?.('aria-selected') || '');
    return parentSelected === 'true' ||
      innerSelected === 'true' ||
      inner.classList.contains('gw-focus') ||
      inner.classList.contains('gw-selected');
  }

  function isQuoteTabSelected() {
    const inner = findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.quoteTab)} > div.gw-action--inner`));
    if (!inner || !isVisibleEl(inner)) return false;
    const parentSelected = normalizeText(inner.parentElement?.getAttribute?.('aria-selected') || '');
    const innerSelected = normalizeText(inner.getAttribute?.('aria-selected') || '');
    return parentSelected === 'true' ||
      innerSelected === 'true' ||
      inner.classList.contains('gw-focus') ||
      inner.classList.contains('gw-selected');
  }

  function isQuoteScreenReady() {
    return getHeaderText() === 'Quote' ||
      isQuoteTabSelected() ||
      !!findByIdInDocs(IDS.autoDiscountLV);
  }

  function hasHomeCoveragesSurface() {
    return !!findByIdInDocs(IDS.coveragesScreen) ||
      !!findByIdInDocs(IDS.mainArea) ||
      !!findByIdInDocs(IDS.pricingTable) ||
      !!findEditAllTarget() ||
      !!queryFirstVisible(SEL.stdAllPerils);
  }

  function isOnCoverageEditPage() {
    if (!hasVisibleExactLabel('Homeowners')) return false;
    if (!hasHomeCoveragesSurface()) return false;
    return getHeaderText() === IDS.coveragesHeader || isCoveragesTabSelected();
  }

  function cssAttrEscape(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function strongClick(el) {
    if (!el) return false;
    try { el.scrollIntoView?.({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus?.({ preventScroll: true }); } catch {}
    try { el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch {}
    try { el.click?.(); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); } catch {}
    return true;
  }

  function dispatchValueEvents(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch {}
  }

  function gatherContextText(el) {
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && depth < 9) {
      if (cur.nodeType === 1) {
        const id = cur.id ? ` ${cur.id} ` : '';
        const aria = cur.getAttribute ? (cur.getAttribute('aria-label') || '') : '';
        const txt = normalizeText(cur.textContent || '');
        if (id) parts.push(id);
        if (aria) parts.push(aria);
        if (txt) parts.push(txt);
      }
      cur = cur.parentElement;
      depth++;
    }
    return normalizeText(parts.join(' | '));
  }

  function verifyContextLabels(el, expectedLabels) {
    if (!expectedLabels || !expectedLabels.length) return true;
    const context = gatherContextText(el).toLowerCase();
    return expectedLabels.every((label) => context.includes(String(label).toLowerCase()));
  }

  function getSelectedText(selectEl) {
    if (!selectEl) return '';
    const opt = selectEl.options?.[selectEl.selectedIndex];
    return normalizeText(opt?.textContent || opt?.innerText || '');
  }

  function optionCanon(text) {
    return normalizeText(text).toLowerCase().replace(/\u00a0/g, '').replace(/\s+/g, '').replace(/,/g, '').replace(/\$/g, '');
  }

  function optionMatchesText(text, desiredTexts) {
    const actual = optionCanon(text);
    return desiredTexts.some((want) => actual === optionCanon(want));
  }

  function findMatchingOption(selectEl, desiredTexts) {
    const options = Array.from(selectEl?.options || []);
    for (const opt of options) {
      const txt = normalizeText(opt.textContent || opt.innerText || '');
      if (optionMatchesText(txt, desiredTexts)) return opt;
    }
    return null;
  }

  function isProbablyClickable(el) {
    if (!el || !(el instanceof Element) || !isVisibleEl(el)) return false;
    return (
      el.matches('button, a, input[type="button"], input[type="submit"], [role="button"], [role="tab"], [role="menuitem"]') ||
      el.classList.contains('gw-action--inner') ||
      el.classList.contains('gw-TabWidget') ||
      el.classList.contains('gw-ButtonWidget') ||
      el.hasAttribute('onclick') ||
      el.getAttribute('tabindex') === '0'
    );
  }

  function getClickableOwner(el) {
    if (!el) return null;
    let cur = el;
    let depth = 0;
    while (cur && depth < 10) {
      if (isProbablyClickable(cur)) return cur;
      cur = cur.parentElement;
      depth++;
    }
    return el;
  }

  function findClickableOwnerByLabel(labelText) {
    const direct = Array.from(document.querySelectorAll(`.gw-label[aria-label="${cssAttrEscape(labelText)}"]`)).filter(isVisibleEl);
    for (const label of direct) {
      const owner = getClickableOwner(label);
      if (owner && isVisibleEl(owner)) return owner;
    }
    const generic = Array.from(document.querySelectorAll('.gw-label, [aria-label], [role="button"], [role="tab"], .gw-action--inner, a, button, div'));
    for (const el of generic) {
      const aria = normalizeText(el.getAttribute?.('aria-label') || '');
      const txt = normalizeText(el.textContent || '');
      if ((aria === labelText || txt === labelText) && isVisibleEl(el)) {
        const owner = getClickableOwner(el);
        if (owner && isVisibleEl(owner)) return owner;
      }
    }
    return null;
  }

  function findEditAllTarget() {
    return findClickableOwnerByLabel('Edit All');
  }

  function quoteRecentlyClicked() {
    return Date.now() - state.lastQuoteClickAt < 1500;
  }

  function markQuoteClicked() {
    state.lastQuoteClickAt = Date.now();
  }

  function findQuoteCandidates() {
    const out = [];
    const exactInner = findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.quoteButtonHost)} > div.gw-action--inner.gw-hasDivider`));
    if (exactInner) out.unshift(exactInner);
    const host = findInDocs((doc) => doc.getElementById(IDS.quoteButtonHost));
    if (host) out.unshift(host);
    out.push(...Array.from(document.querySelectorAll('.gw-label[aria-label="Quote"]')));
    const nextLab = findInDocs((doc) => doc.querySelector('.gw-label[aria-label="Next"]'));
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

  async function clickQuoteActionToOpenQuote() {
    if (isQuoteScreenReady()) {
      log(`Quote screen already ready (${describeNavigationSnapshot(readNavigationSnapshot())})`);
      return true;
    }

    for (let attempt = 1; attempt <= CFG.maxQuoteAttempts; attempt++) {
      setStatus(`Clicking Quote action (${attempt}/${CFG.maxQuoteAttempts})`);
      const clickableReady = await waitFor(
        () => !!getClickableQuoteTarget(),
        CFG.quoteActionReadyTimeoutMs,
        `Quote action clickable (attempt ${attempt})`
      );
      if (!clickableReady) {
        log(`Quote action never became clickable on attempt ${attempt}`);
        if (attempt < CFG.maxQuoteAttempts) await sleep(CFG.betweenQuoteAttemptsMs);
        continue;
      }

      const beforeSnapshot = readNavigationSnapshot();
      const clicked = clickQuoteOnce(`quote action attempt ${attempt}/${CFG.maxQuoteAttempts}`, beforeSnapshot);
      if (!clicked) {
        await sleep(CFG.betweenQuoteAttemptsMs);
        continue;
      }

      await sleep(CFG.afterQuoteWaitMs);
      const openedOrMoved = await waitFor(
        () => {
          if (isQuoteScreenReady() || isSubmissionQuoted()) return true;
          return advancedToSubmissionState(beforeSnapshot, readNavigationSnapshot(), 'quoted') || didHeaderChange(beforeSnapshot, readNavigationSnapshot());
        },
        CFG.quoteTransitionTimeoutMs,
        `Quote action transition (attempt ${attempt})`
      );
      const afterSnapshot = readNavigationSnapshot();
      const opened = isQuoteScreenReady();

      if (opened) {
        log(`Quote action opened Quote screen (${describeNavigationSnapshot(beforeSnapshot)} -> ${describeNavigationSnapshot(afterSnapshot)})`);
        return true;
      }

      if (isSubmissionQuoted() || advancedToSubmissionState(beforeSnapshot, afterSnapshot, 'quoted')) {
        log(`Quote action completed but visible screen is not Quote; falling back to Quote tab (${describeNavigationSnapshot(beforeSnapshot)} -> ${describeNavigationSnapshot(afterSnapshot)})`);
        return false;
      }

      if (!openedOrMoved) {
        log(`Quote action did not move page on attempt ${attempt} (${describeNavigationSnapshot(beforeSnapshot)} -> ${describeNavigationSnapshot(afterSnapshot)})`);
      } else {
        log(`Quote action moved but Quote screen is still not ready on attempt ${attempt} (${describeNavigationSnapshot(beforeSnapshot)} -> ${describeNavigationSnapshot(afterSnapshot)})`);
      }
      if (attempt < CFG.maxQuoteAttempts) await sleep(CFG.betweenQuoteAttemptsMs);
    }

    return false;
  }

  function upgradeToClickable(el) {
    if (!el) return null;
    if (el.matches?.('.gw-action--inner') && el.getAttribute('aria-disabled') !== 'true' && isVisibleEl(el)) return el;
    if (el.querySelector) {
      const inner = el.querySelector('.gw-action--inner[aria-disabled="false"]');
      if (inner && isVisibleEl(inner)) return inner;
    }
    let p = el;
    for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
      if (p.matches?.('.gw-action--inner') && p.getAttribute('aria-disabled') !== 'true' && isVisibleEl(p)) return p;
    }
    return isVisibleEl(el) ? el : null;
  }

  function getClickableQuoteTarget() {
    const candidates = findQuoteCandidates();
    for (const el of candidates) {
      const target = upgradeToClickable(el);
      if (target) return target;
    }
    return null;
  }

  function logQuoteButtonClick(context, target, snapshot = null) {
    const parts = [`QUOTE BUTTON CLICKED | ${normalizeText(context || 'Quote')}`];
    if (snapshot) parts.push(describeNavigationSnapshot(snapshot));
    if (target) parts.push(describeElement(target));
    log(parts.join(' | '));
  }

  function clickQuoteOnce(context = 'quote click', snapshot = null) {
    if (quoteRecentlyClicked()) return false;
    const target = getClickableQuoteTarget();
    if (target && strongClick(target)) {
      markQuoteClicked();
      logQuoteButtonClick(context, target, snapshot);
      return true;
    }
    const candidates = findQuoteCandidates();
    log(candidates.length ? 'Quote target found but not clickable yet' : 'Quote target not found');
    return false;
  }

  function getCoveragesRetryWarningText() {
    const docs = getAccessibleDocs();
    for (const doc of docs) {
      try {
        const messages = Array.from(doc.querySelectorAll('.gw-message')).filter(isVisibleEl);
        for (const message of messages) {
          const text = normalizeText(message.textContent || '');
          if (!text) continue;
          const lowerText = text.toLowerCase();
          if (
            COVERAGES_WARNING_FRAGMENTS.every((fragment) => lowerText.includes(fragment)) ||
            (
              lowerText.includes('deductible has been increased') &&
              lowerText.includes('split water deductible')
            )
          ) {
            return text;
          }
        }
      } catch {}
    }
    return '';
  }

  function normalizeCoveragesWarningSignature(text) {
    return normalizeText(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9$+]+/g, ' ')
      .trim();
  }

  function coverageWarningFieldSnapshot() {
    return [
      getSelectedText(queryFirstVisible(SEL.stdAllPerils)),
      getSelectedText(queryFirstVisible(SEL.enhAllPerils)),
      getSelectedText(queryFirstVisible(SEL.enhSplitWater)),
      getSelectedText(queryFirstVisible(SEL.enhSeparateStructures)),
      getSelectedText(queryFirstVisible(SEL.enhPersonalPropertyLimit)),
      getSelectedText(queryFirstVisible(SEL.enhPersonalLiability)),
      getSelectedText(queryFirstVisible(SEL.enhExtendedReplacementSelect)),
      queryFirstVisible(SEL.enhExtendedReplacementCheckbox)?.checked ? 'extended:on' : 'extended:off',
      queryFirstVisible(SEL.personalInjuryCheckbox)?.checked ? 'injury:on' : 'injury:off',
      findEditAllTarget() ? 'mode:view' : 'mode:edit',
      normalizeMoneyText(getTextById(IDS.standardPrice)),
      normalizeMoneyText(getTextById(IDS.enhancePrice)),
      normalizeText(extractSubmissionNumber()),
      normalizeText(getSubmissionStateLabel()),
      normalizeText(getHeaderText())
    ]
      .map((part) => normalizeText(part))
      .filter(Boolean)
      .join(' | ');
  }

  function getCoveragesWarningContext(homeState = null) {
    const warningText = getCoveragesRetryWarningText();
    if (!warningText) return { active: false, warningText: '', signature: '' };

    const stateToUse = homeState || normalizeHomeState(readCurrentJob());
    if (stateToUse.ready === true || stateToUse.pass1Ready === true) {
      return { active: false, warningText: '', signature: '' };
    }

    if (!isOnCoverageEditPage()) {
      return { active: false, warningText: '', signature: '' };
    }

    const signature = normalizeCoveragesWarningSignature([
      warningText,
      coverageWarningFieldSnapshot()
    ].join(' | '));

    return {
      active: !!signature,
      warningText,
      signature
    };
  }

  function clearCoveragesWarningWatch() {
    state.coveragesWarningSignature = '';
    state.coveragesWarningSinceMs = 0;
    state.coveragesRetryBlockedUntilMs = 0;
  }

  function syncCoveragesWarningWatch(context) {
    if (!context?.active) {
      clearCoveragesWarningWatch();
      return;
    }

    if (state.coveragesWarningSignature !== context.signature) {
      state.coveragesWarningSignature = context.signature;
      state.coveragesWarningSinceMs = Date.now();
      state.coveragesRetryBlockedUntilMs = 0;
      log(`Coverages deductible warning detected: ${context.warningText}`);
    }
  }

  function armCoveragesWarningRetryBlock(context, reason = '') {
    if (!context?.active) return;
    syncCoveragesWarningWatch(context);
    state.coveragesRetryBlockedUntilMs = Date.now() + CFG.coveragesWarningStallMs;
    log(`Coverages retry blocked for 60s after stalled warning${reason ? `: ${reason}` : ''}`);
  }

  function maybeHandleCoveragesWarningRecovery(currentJob, homeState) {
    const context = getCoveragesWarningContext(homeState);
    if (!context.active) {
      clearCoveragesWarningWatch();
      return false;
    }

    syncCoveragesWarningWatch(context);

    if (state.coveragesRetryBlockedUntilMs > Date.now()) {
      setWaiting('Deductible warning stalled on Coverages; waiting 60s before re-running Edit All -> Quote');
      announceSkipReason('coverages warning retry blocked');
      return true;
    }

    if (Date.now() - state.coveragesWarningSinceMs < CFG.coveragesWarningStallMs) {
      return false;
    }

    state.coveragesWarningSinceMs = Date.now();
    state.coveragesRetryBlockedUntilMs = Date.now() + CFG.coveragesWarningStallMs;
    log(`Coverages warning unchanged for 60s; re-running Edit All -> Quote | ${context.warningText}`);
    startHomeFlow(currentJob, 'coverages warning recovery');
    return true;
  }

  function startHomeFlow(currentJob, phaseLabel = '') {
    state.flowStartedThisLoad = true;
    state.busy = true;
    state.lastWaitReason = '';
    writeActivityState('working', `Running Home gather for AZ ${currentJob['AZ ID']}`);
    log(`Starting background Home flow for AZ ID ${currentJob['AZ ID']} (${phaseLabel || 'background'})`);
    runGrab({ currentJob })
      .catch((err) => {
        const message = err?.message || String(err || 'Background flow failed');
        const warningContext = getCoveragesWarningContext(normalizeHomeState(readCurrentJob()));
        log(`Background flow failed: ${message}`);
        writeActivityState('error', message || 'Background flow failed');
        setStatus('Failed');
        state.flowStartedThisLoad = false;
        if (warningContext.active) {
          armCoveragesWarningRetryBlock(warningContext, message);
        }
        log('Background flow unlocked for same-tab retry');
      })
      .finally(() => {
        state.busy = false;
      });
  }

  async function clickQuoteUntilTransition() {
    for (let attempt = 1; attempt <= CFG.maxQuoteAttempts; attempt++) {
      setStatus(`Clicking Quote (${attempt}/${CFG.maxQuoteAttempts})`);
      const baselineWarningText = getCoveragesRetryWarningText();
      const baselineWarningSig = normalizeCoveragesWarningSignature(baselineWarningText);
      const beforeSnapshot = readNavigationSnapshot();
      if (baselineWarningText) {
        log(`Pre-existing Coverages warning before Quote attempt ${attempt}: ${baselineWarningText}`);
      }
      const clicked = clickQuoteOnce(`coverages quote attempt ${attempt}/${CFG.maxQuoteAttempts}`, beforeSnapshot);
      if (!clicked) {
        await sleep(CFG.betweenQuoteAttemptsMs);
        continue;
      }
      await sleep(CFG.afterQuoteWaitMs);
      const transitionOrWarning = await waitFor(
        () => {
          const afterSnapshot = readNavigationSnapshot();
          if (!headerStillCoverages()) return true;
          if (advancedToSubmissionState(beforeSnapshot, afterSnapshot, 'quoted')) return true;
          const currentWarningText = getCoveragesRetryWarningText();
          const currentWarningSig = normalizeCoveragesWarningSignature(currentWarningText);
          return !!currentWarningSig && currentWarningSig !== baselineWarningSig;
        },
        CFG.quoteTransitionTimeoutMs,
        `Quote transition (attempt ${attempt})`
      );
      const afterSnapshot = readNavigationSnapshot();
      const warningText = getCoveragesRetryWarningText();
      const warningSig = normalizeCoveragesWarningSignature(warningText);
      const warningChanged = !!warningSig && warningSig !== baselineWarningSig;
      const movedOff = transitionOrWarning && (
        !headerStillCoverages() ||
        advancedToSubmissionState(beforeSnapshot, afterSnapshot, 'quoted') ||
        isSubmissionQuoted()
      );
      if (movedOff) {
        log(`Quote succeeded (${describeNavigationSnapshot(beforeSnapshot)} -> ${describeNavigationSnapshot(afterSnapshot)})`);
        return { ok: true, needsCoverageReapply: false, warningText: '' };
      }
      if (warningChanged) {
        log(`Detected Coverages warning after Quote attempt ${attempt}: ${warningText}`);
        return { ok: false, needsCoverageReapply: true, warningText };
      }
      if (warningText) {
        log(`Coverages warning still visible after Quote attempt ${attempt}: ${warningText}`);
      }
      log(`Still on Coverages after Quote attempt ${attempt} (${describeNavigationSnapshot(beforeSnapshot)} -> ${describeNavigationSnapshot(afterSnapshot)})`);
      if (attempt < CFG.maxQuoteAttempts) {
        setStatus(`Waiting to retry Quote (${attempt}/${CFG.maxQuoteAttempts})`);
        await sleep(CFG.betweenQuoteAttemptsMs);
      }
    }
    const finalWarningText = getCoveragesRetryWarningText();
    if (finalWarningText) {
      log(`Coverages warning remained visible after Quote retries: ${finalWarningText}`);
      return { ok: false, needsCoverageReapply: true, warningText: finalWarningText };
    }
    return { ok: false, needsCoverageReapply: false, warningText: '' };
  }

  async function ensureEditMode() {
    const editTarget = findEditAllTarget();
    if (editTarget) {
      log('Clicking Edit All');
      strongClick(editTarget);
      await sleep(CFG.afterEditAllMs);
    } else if (queryFirstVisible(SEL.stdAllPerils)) {
      log('Edit All not visible. Controls already editable.');
      return;
    } else {
      throw new Error('Edit All not found');
    }
    const ok = await waitFor(
      () => !!queryFirstVisible(SEL.stdAllPerils) || !!queryFirstVisible(SEL.personalInjuryCheckbox),
      CFG.waitTimeoutMs,
      'editable coverage controls'
    );
    if (!ok) throw new Error('Edit mode did not become ready');
    log('Edit mode ready');
  }

  async function waitForField(selector, expectedLabels, label) {
    const ok = await waitFor(
      () => {
        const el = queryFirstVisible(selector);
        if (!el) return false;
        return verifyContextLabels(el, expectedLabels);
      },
      CFG.waitTimeoutMs,
      label
    );
    if (!ok) throw new Error(`${label}: field not found or context mismatch`);
    const el = queryFirstVisible(selector);
    if (!el) throw new Error(`${label}: field vanished`);
    if (!verifyContextLabels(el, expectedLabels)) throw new Error(`${label}: context mismatch`);
    return el;
  }

  async function setSelectVerified(selector, expectedLabels, desiredTexts, label) {
    const el = await waitForField(selector, expectedLabels, label);
    const match = findMatchingOption(el, desiredTexts);
    if (!match) throw new Error(`${label}: option not found (${desiredTexts.join(' / ')})`);
    if (optionMatchesText(getSelectedText(el), desiredTexts)) {
      log(`${label}: already set to ${getSelectedText(el)}`);
      return;
    }
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}
    try { el.value = match.value; } catch {}
    try { match.selected = true; } catch {}
    dispatchValueEvents(el);
    await sleep(CFG.afterFieldMs);
    if (!optionMatchesText(getSelectedText(el), desiredTexts)) {
      try { el.selectedIndex = match.index; } catch {}
      try { el.value = match.value; } catch {}
      try { match.selected = true; } catch {}
      dispatchValueEvents(el);
      await sleep(CFG.afterFieldMs);
    }
    const finalText = getSelectedText(el);
    if (!optionMatchesText(finalText, desiredTexts)) throw new Error(`${label}: failed to stick (${finalText || 'blank'})`);
    log(`${label}: set to ${finalText}`);
  }

  async function ensureCheckboxVerified(selector, expectedLabels, label) {
    const el = await waitForField(selector, expectedLabels, label);
    if (el.checked) {
      log(`${label}: already checked`);
      return;
    }
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    strongClick(el);
    await sleep(CFG.afterFieldMs);
    if (!el.checked) {
      try { el.checked = true; } catch {}
      dispatchValueEvents(el);
      await sleep(CFG.afterFieldMs);
    }
    if (!el.checked) {
      strongClick(el);
      await sleep(CFG.afterFieldMs);
    }
    if (!el.checked) throw new Error(`${label}: failed to stay checked`);
    log(`${label}: checked`);
  }

  async function applyCoverageSelections() {
    await setSelectVerified(SEL.stdAllPerils, ['All Perils'], ['$3,000', '3000'], 'Standard / All Perils');
    await setSelectVerified(SEL.enhAllPerils, ['All Perils'], ['$7,500', '7500'], 'Enhanced / All Perils');
    await setSelectVerified(SEL.enhSplitWater, ['Split Water'], ['$10,000', '10000'], 'Enhanced / Split Water');
    await setSelectVerified(SEL.enhSeparateStructures, ['Separate Structures'], ['5%'], 'Enhanced / Separate Structures');
    await setSelectVerified(SEL.enhPersonalPropertyLimit, ['Personal Property', 'Limit'], ['40%'], 'Enhanced / Personal Property Limit');
    await setSelectVerified(SEL.enhPersonalLiability, ['Personal Liability'], ['$1,000,000', '1000000'], 'Enhanced / Personal Liability');
    await ensureCheckboxVerified(SEL.enhExtendedReplacementCheckbox, ['Extended Replacement Cost'], 'Enhanced / Extended Replacement Cost checkbox');
    await setSelectVerified(SEL.enhExtendedReplacementSelect, ['Extended Replacement Cost'], ['120%', '120'], 'Enhanced / Extended Replacement Cost value');
    await ensureCheckboxVerified(SEL.personalInjuryCheckbox, ['Personal Injury'], 'Additional / Personal Injury');
  }

  async function driveCoveragesAndQuote() {
    for (let coverageAttempt = 1; coverageAttempt <= CFG.coveragesRetryLimit; coverageAttempt++) {
      const attemptLabel = coverageAttempt > 1 ? ` retry ${coverageAttempt}/${CFG.coveragesRetryLimit}` : '';
      log(`Phase 1: editing coverages${attemptLabel}`);
      await ensureEditMode();
      await applyCoverageSelections();
      log(`Phase 1: clicking initial Quote${attemptLabel}`);
      const quoteResult = await clickQuoteUntilTransition();
      if (quoteResult.ok) return;

      if (quoteResult.needsCoverageReapply && coverageAttempt < CFG.coveragesRetryLimit) {
        setStatus('Reapplying Coverages after deductible warning');
        log('Re-running Edit All + coverages after deductible warning');
        await sleep(CFG.betweenQuoteAttemptsMs);
        continue;
      }

      if (quoteResult.needsCoverageReapply) {
        throw new Error(`Deductible warning persisted after coverages retry: ${quoteResult.warningText || 'Split Water deductible warning'}`);
      }

      throw new Error('Initial Quote click did not move off Coverages');
    }
  }

  function hasAnyNonEmptyHomeValues(values) {
    if (!isPlainObject(values)) return false;
    return Object.values(values).some((value) => !!normalizeText(value));
  }

  function mergeJobForHomeUpdates(job, rowUpdates) {
    const update = {
      'AZ ID': normalizeText(job?.['AZ ID'] || ''),
      'Name': normalizeText(rowUpdates?.['Name'] || job?.['Name'] || ''),
      'Mailing Address': normalizeText(rowUpdates?.['Mailing Address'] || job?.['Mailing Address'] || ''),
      'SubmissionNumber': normalizeText(rowUpdates?.['Submission Number'] || job?.['SubmissionNumber'] || ''),
      'First Name': normalizeText(job?.['First Name'] || ''),
      'Last Name': normalizeText(job?.['Last Name'] || ''),
      'Email': normalizeText(job?.['Email'] || ''),
      'Phone': normalizeText(job?.['Phone'] || ''),
      'DOB': normalizeText(job?.['DOB'] || ''),
      'Street Address': normalizeText(job?.['Street Address'] || ''),
      'City': normalizeText(job?.['City'] || ''),
      'State': normalizeText(job?.['State'] || ''),
      'Zip': normalizeText(job?.['Zip'] || '')
    };

    const merged = mergeCurrentJob(update);
    if (merged.ok && merged.next?.['AZ ID']) return merged.next;
    return normalizeCurrentJob(update);
  }

  function withProcessedDate(rowUpdates, currentRow) {
    const next = mergeHomeRow(currentRow, rowUpdates || {});
    next['Date Processed?'] = normalizeText(next['Date Processed?']) || normalizeText(currentRow?.['Date Processed?']) || formatDate(new Date());
    return next;
  }

  function maybeCaptureVisiblePolicyInfo(job) {
    if (!findByIdInDocs(IDS.name) && !findByIdInDocs(IDS.mailingAddress)) return false;

    const homeState = normalizeHomeState(job);
    if (homeState.ready === true) return false;

    const policyInfoData = extractPolicyInfoFields();
    const customCapture = captureCustomFieldUpdatesForCurrentHeader();
    const mergedPolicyInfoData = {
      ...policyInfoData,
      ...customCapture.updates
    };
    if (!hasAnyNonEmptyHomeValues(mergedPolicyInfoData)) return false;

    const fullyCaptured = !!mergedPolicyInfoData['Name'] && !!mergedPolicyInfoData['Mailing Address'];
    const shouldSave =
      isPayloadRowChanged(homeState.row, mergedPolicyInfoData) ||
      (fullyCaptured && !homeState.progress.earlyPolicyInfoCaptured);

    if (!shouldSave) return false;

    const targetJob = mergeJobForHomeUpdates(job, mergedPolicyInfoData);
    const save = saveHomeState(targetJob, {
      rowUpdates: mergedPolicyInfoData,
      customFields: customCapture.updates,
      progressUpdates: fullyCaptured ? { earlyPolicyInfoCaptured: true } : {},
      tabsUsed: { policyInfo: true },
      phase: normalizeText(homeState.payload?.meta?.phase || '') || 'observing-policy-info',
      ready: false
    });

    if (!save.ok) {
      log(`Early Policy Info save failed: ${save.reason || 'unknown error'}`);
      return false;
    }

    log(`Early Policy Info saved: ${JSON.stringify(mergedPolicyInfoData)}`);
    return true;
  }

  function maybeCaptureVisibleAccountInfo(job) {
    const accountInfoData = extractAccountInfoFields();
    const customCapture = captureCustomFieldUpdatesForCurrentHeader();
    const mergedAccountInfoData = {
      ...accountInfoData,
      ...customCapture.updates
    };
    if (!hasAnyNonEmptyHomeValues(mergedAccountInfoData)) return false;

    const homeState = normalizeHomeState(job);
    if (homeState.ready === true) return false;

    const shouldSave = isPayloadRowChanged(homeState.row, mergedAccountInfoData);
    if (!shouldSave) return false;

    const targetJob = mergeJobForHomeUpdates(job, mergedAccountInfoData);
    const save = saveHomeState(targetJob, {
      rowUpdates: mergedAccountInfoData,
      customFields: customCapture.updates,
      phase: normalizeText(homeState.payload?.meta?.phase || '') || 'observing-account',
      ready: false
    });

    if (!save.ok) {
      log(`Account info save failed: ${save.reason || 'unknown error'}`);
      return false;
    }

    log(`Account info saved: ${JSON.stringify(mergedAccountInfoData)}`);
    return true;
  }

  function maybeCaptureVisibleDwelling(job) {
    if (!findByIdInDocs(IDS.fireCode) && !findByIdInDocs(IDS.reconstruction) && !findByIdInDocs(IDS.yearBuilt)) return false;

    const homeState = normalizeHomeState(job);
    if (homeState.ready === true) return false;

    const dwellingData = extractDwellingFields();
    const customCapture = captureCustomFieldUpdatesForCurrentHeader();
    const mergedDwellingData = {
      ...dwellingData,
      ...customCapture.updates
    };
    if (!hasAnyNonEmptyHomeValues(mergedDwellingData)) return false;

    const shouldSave =
      isPayloadRowChanged(homeState.row, mergedDwellingData) ||
      !homeState.progress.earlyDwellingCaptured;

    if (!shouldSave) return false;

    const targetJob = mergeJobForHomeUpdates(job, mergedDwellingData);
    const save = saveHomeState(targetJob, {
      rowUpdates: mergedDwellingData,
      customFields: customCapture.updates,
      progressUpdates: { earlyDwellingCaptured: true },
      tabsUsed: { dwelling: true },
      phase: normalizeText(homeState.payload?.meta?.phase || '') || 'observing-dwelling',
      ready: false
    });

    if (!save.ok) {
      log(`Early Dwelling save failed: ${save.reason || 'unknown error'}`);
      return false;
    }

    log(`Early Dwelling saved: ${JSON.stringify(mergedDwellingData)}`);
    return true;
  }

  async function capturePass1Pricing(job) {
    if (!isOnCoverageEditPage()) {
      throw new Error('Home Coverages edit page is not ready for pass 1');
    }

    setStatus('Phase 1: editing coverages and quoting');
    await driveCoveragesAndQuote();

    const submissionNumberEarly = extractSubmissionNumber();
    if (submissionNumberEarly) log(`Submission Number found: ${submissionNumberEarly}`);

    setStatus('Opening Coverages (No Auto Discount)');
    await goToCoverages();
    await sleep(CFG.afterClickMs);
    const pricingNoAutoData = extractPricingFields();
    const coveragesCustomCapture = captureCustomFieldUpdatesForCurrentHeader({ logMatches: true, logMissing: true });
    log(`Pricing before auto discount: ${JSON.stringify(pricingNoAutoData)}`);

    if (!pricingNoAutoData['Standard Pricing'] || !pricingNoAutoData['Enhance Pricing']) {
      throw new Error('Missing no-auto pricing after initial Quote');
    }

    const homeState = normalizeHomeState(job);
    const rowUpdates = withProcessedDate({
      'Standard Pricing No Auto Discount': pricingNoAutoData['Standard Pricing'] || '',
      'Enhance Pricing No Auto Discount': pricingNoAutoData['Enhance Pricing'] || '',
      'Submission Number': submissionNumberEarly || homeState.row['Submission Number'] || '',
      ...coveragesCustomCapture.updates
    }, homeState.row);
    const targetJob = mergeJobForHomeUpdates(job, rowUpdates);
    const save = saveHomeState(targetJob, {
      rowUpdates,
      customFields: coveragesCustomCapture.updates,
      progressUpdates: { pass1PricingCaptured: true },
      tabsUsed: {
        coveragesEditedAndQuotedInitially: true,
        coveragesNoAutoDiscount: true
      },
      phase: 'pass1',
      ready: false
    });

    if (!save.ok) {
      throw new Error(save.reason || 'Could not save pass 1 Home state');
    }

    log(`Pass 1 saved: ${JSON.stringify({
      'Standard Pricing No Auto Discount': rowUpdates['Standard Pricing No Auto Discount'],
      'Enhance Pricing No Auto Discount': rowUpdates['Enhance Pricing No Auto Discount'],
      'Submission Number': rowUpdates['Submission Number']
    })}`);
    writeFlowStage('home', 'handoff', targetJob['AZ ID']);
    setStatus('Pass 1 saved (handoff checkpoint)');
  }

  async function capturePass2AndFinalize(job) {
    setStatus('Opening Policy Info');
    await goToPolicyInfo();
    await sleep(CFG.afterClickMs);
    const policyInfoData = extractPolicyInfoFields();
    const policyCustomCapture = captureCustomFieldUpdatesForCurrentHeader({ logMatches: true, logMissing: true });
    const mergedPolicyInfoData = {
      ...policyInfoData,
      ...policyCustomCapture.updates
    };
    log(`Policy Info fields read: ${JSON.stringify(mergedPolicyInfoData)}`);

    const jobAfterPolicy = mergeJobForHomeUpdates(job, mergedPolicyInfoData);
    const policyState = normalizeHomeState(jobAfterPolicy);
    if (hasAnyNonEmptyHomeValues(mergedPolicyInfoData) &&
        (isPayloadRowChanged(policyState.row, mergedPolicyInfoData) || !policyState.progress.earlyPolicyInfoCaptured)) {
      const policySave = saveHomeState(jobAfterPolicy, {
        rowUpdates: mergedPolicyInfoData,
        customFields: policyCustomCapture.updates,
        progressUpdates: (!!mergedPolicyInfoData['Name'] && !!mergedPolicyInfoData['Mailing Address'])
          ? { earlyPolicyInfoCaptured: true }
          : {},
        tabsUsed: { policyInfo: true },
        phase: 'pass2',
        ready: false
      });
      if (!policySave.ok) throw new Error(policySave.reason || 'Could not save Policy Info during pass 2');
    }

    setStatus('Opening Edit Quote');
    await goToEditQuote();
    await sleep(CFG.afterClickMs);
    log('Edit Quote ready');

    setStatus('Applying Auto Discount');
    await applyAutoDiscount();
    setStatus('Waiting 5s before Quote after Auto Discount');
    await sleep(CFG.afterAutoDiscountBeforeQuoteMs);
    log('Auto discount applied');

    setStatus('Opening Quote');
    await goToQuote();
    await sleep(CFG.afterClickMs);
    const quoteAfterDiscountData = extractQuoteFields();
    const quoteAfterDiscountCustomCapture = captureCustomFieldUpdatesForCurrentHeader({ logMatches: true, logMissing: true });
    log(`Quote fields after auto discount: ${JSON.stringify(quoteAfterDiscountData)}`);
    logDiscountQuotedResult(
      'Home after auto discount',
      [quoteAfterDiscountData, quoteAfterDiscountCustomCapture.updates],
      { forceApplied: state.autoDiscountChosenThisLoad === true || isAutoDiscountApplied() }
    );

    setStatus('Opening Dwelling');
    await goToDwelling();
    await sleep(CFG.afterClickMs);
    const dwellingData = extractDwellingFields();
    const dwellingCustomCapture = captureCustomFieldUpdatesForCurrentHeader({ logMatches: true, logMissing: true });
    const mergedDwellingData = {
      ...dwellingData,
      ...dwellingCustomCapture.updates
    };
    log(`Dwelling fields read: ${JSON.stringify(mergedDwellingData)}`);

    const jobAfterDwelling = mergeJobForHomeUpdates(jobAfterPolicy, mergedDwellingData);
    const dwellingState = normalizeHomeState(jobAfterDwelling);
    if (hasAnyNonEmptyHomeValues(mergedDwellingData) &&
        (isPayloadRowChanged(dwellingState.row, mergedDwellingData) || !dwellingState.progress.earlyDwellingCaptured)) {
      const dwellingSave = saveHomeState(jobAfterDwelling, {
        rowUpdates: mergedDwellingData,
        customFields: dwellingCustomCapture.updates,
        progressUpdates: { earlyDwellingCaptured: true },
        tabsUsed: { dwelling: true },
        phase: 'pass2',
        ready: false
      });
      if (!dwellingSave.ok) throw new Error(dwellingSave.reason || 'Could not save Dwelling during pass 2');
    }

    setStatus('Opening Coverages (Auto Discount)');
    await goToCoverages();
    await sleep(CFG.afterClickMs);
    const pricingAutoData = extractPricingFields();
    const coveragesCustomCapture = captureCustomFieldUpdatesForCurrentHeader({ logMatches: true, logMissing: true });
    const submissionNumber = extractSubmissionNumber() || normalizeHomeState(jobAfterDwelling).row['Submission Number'] || '';
    log(`Pricing after auto discount: ${JSON.stringify(pricingAutoData)}`);
    if (submissionNumber) log(`Submission Number confirmed: ${submissionNumber}`);

    if (!pricingAutoData['Standard Pricing'] || !pricingAutoData['Enhance Pricing']) {
      throw new Error('Missing auto-discount pricing after re-quote');
    }

    setStatus('Opening Exclusions and Conditions');
    await goToExclusionsAndConditions();
    await sleep(CFG.afterClickMs);
    const exclusionsCustomCapture = captureCustomFieldUpdatesForCurrentHeader({ logMatches: true, logMissing: true });
    const cfpValue = extractCFPValue();
    log(`CFP detected: ${cfpValue}`);

    setStatus('Opening Quote');
    await goToQuote();
    await sleep(CFG.afterClickMs);
    const quoteData = extractQuoteFields();
    const finalQuoteCustomCapture = captureCustomFieldUpdatesForCurrentHeader({ logMatches: true, logMissing: true });
    log(`Final quote fields read: ${JSON.stringify(quoteData)}`);
    logDiscountQuotedResult(
      'Home final quote',
      [quoteData, quoteAfterDiscountData, finalQuoteCustomCapture.updates, quoteAfterDiscountCustomCapture.updates],
      { forceApplied: state.autoDiscountChosenThisLoad === true || isAutoDiscountApplied() }
    );

    const finalBaseState = normalizeHomeState(jobAfterDwelling);
    const customFieldUpdates = {
      ...policyCustomCapture.updates,
      ...quoteAfterDiscountCustomCapture.updates,
      ...dwellingCustomCapture.updates,
      ...coveragesCustomCapture.updates,
      ...exclusionsCustomCapture.updates,
      ...finalQuoteCustomCapture.updates
    };
    const finalRow = withProcessedDate({
      'Name': mergedPolicyInfoData['Name'] || '',
      'Mailing Address': mergedPolicyInfoData['Mailing Address'] || '',
      'Risk Address': mergedDwellingData['Risk Address'] || '',
      'Account Number': mergedPolicyInfoData['Account Number'] || finalBaseState.row['Account Number'] || '',
      'Fire Code': mergedDwellingData['Fire Code'] || '',
      'Protection Class': mergedDwellingData['Protection Class'] || '',
      'CFP?': cfpValue || '',
      'Reconstruction Cost': mergedDwellingData['Reconstruction Cost'] || '',
      'Year Built': mergedDwellingData['Year Built'] || '',
      'Square FT': mergedDwellingData['Square FT'] || '',
      '# of Story': mergedDwellingData['# of Story'] || '',
      'Home Roof Type': mergedDwellingData['Home Roof Type'] || '',
      'Bedrooms': mergedDwellingData['Bedrooms'] || '',
      'Bathrooms': mergedDwellingData['Bathrooms'] || '',
      'Home Type': mergedDwellingData['Home Type'] || '',
      'Water Device?': mergedDwellingData['Water Device?'] || '',
      'Standard Pricing Auto Discount': pricingAutoData['Standard Pricing'] || '',
      'Enhance Pricing Auto Discount': pricingAutoData['Enhance Pricing'] || '',
      'Submission Number': submissionNumber || '',
      'Auto Discount': quoteData['Auto Discount'] || quoteAfterDiscountData['Auto Discount'] || '',
      ...customFieldUpdates
    }, finalBaseState.row);
    const finalResult = buildFinalRowResult(finalRow);
    const targetJob = mergeJobForHomeUpdates(jobAfterDwelling, finalResult.row);
    const finalProgressUpdates = {
      pass2PricingCaptured: true,
      finalRefreshComplete: true
    };
    if (mergedPolicyInfoData['Name'] && mergedPolicyInfoData['Mailing Address']) {
      finalProgressUpdates.earlyPolicyInfoCaptured = true;
    }
    if (hasAnyNonEmptyHomeValues(mergedDwellingData)) {
      finalProgressUpdates.earlyDwellingCaptured = true;
    }

    let finalPage = {
      url: location.href,
      title: document.title
    };

    if (finalResult.ready) {
      try {
        setStatus('Returning to Quote for handoff');
        await goToQuote();
        await sleep(CFG.afterClickMs);
        finalPage = {
          url: location.href,
          title: document.title
        };
        log(`Final Quote screen ready for handoff (${describeNavigationSnapshot(readNavigationSnapshot())})`);
      } catch (err) {
        log(`Final Quote screen handoff navigation failed: ${err?.message || err}`);
      }
    }

    const save = saveHomeState(targetJob, {
      rowUpdates: finalResult.row,
      customFields: customFieldUpdates,
      quoteAfterDiscount: quoteAfterDiscountData,
      progressUpdates: finalProgressUpdates,
      tabsUsed: {
        policyInfo: true,
        editQuote: true,
        quoteAfterAutoDiscount: true,
        dwelling: true,
        coveragesAutoDiscount: true,
        exclusionsAndConditions: true,
        quoteFinal: true,
        fairPlanCompanionEndorsementDetected: cfpValue === 'YES'
      },
      phase: finalResult.ready ? 'complete' : 'pass2',
      ready: finalResult.ready,
      page: finalPage
    });

    if (!save.ok) {
      throw new Error(save.reason || 'Could not save pass 2 Home state');
    }

    if (finalResult.missing.length) {
      log(`Final Home payload still missing: ${finalResult.missing.join(', ')}`);
    } else {
      log('Final Home payload complete');
    }

    writeFlowStage('home', 'handoff', targetJob['AZ ID']);
    setStatus(finalResult.ready ? 'Home ready for handoff' : 'Home partial after pass 2');
    state.doneThisLoad = true;
  }

  async function runGrab(opts = {}) {
    let currentJob = normalizeCurrentJob(opts.currentJob || readCurrentJob());
    if (!currentJob['AZ ID']) {
      throw new Error('Missing tm_pc_current_job_v1 / AZ ID');
    }

    const homeState = normalizeHomeState(currentJob);
    log(`Background gather state: pass1=${homeState.pass1Ready ? 'yes' : 'no'} | pass2=${homeState.pass2Ready ? 'yes' : 'no'} | ready=${homeState.ready ? 'yes' : 'no'}`);

    if (!homeState.pass1Ready) {
      await capturePass1Pricing(currentJob);
      currentJob = readCurrentJob();
    }

    const afterPass1 = normalizeHomeState(currentJob);
    if (!afterPass1.pass2Ready || !afterPass1.finalRefreshReady || !afterPass1.ready) {
      await capturePass2AndFinalize(currentJob);
    }

    const finalState = normalizeHomeState(readCurrentJob());
    if (finalState.ready) {
      state.doneThisLoad = true;
      setStatus('Home gather complete');
    } else if (finalState.pass2Ready || finalState.finalRefreshReady) {
      state.doneThisLoad = true;
      setStatus('Home final pass complete (stopped)');
    } else {
      state.flowStartedThisLoad = false;
      setStatus('Home gather incomplete');
    }
  }

  async function goToPolicyInfo() {
    await navigateToTab(
      'Policy Info',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.policyInfoTab)} > div.gw-action--inner`)),
        () => findActionByText('Policy Info')
      ],
      () => !!findByIdInDocs(IDS.name) || !!findByIdInDocs(IDS.mailingAddress)
    );
  }

  async function goToEditQuote() {
    await navigateToTab(
      LABELS.editQuote,
      [
        () => findActionByExactText(LABELS.editQuote),
        () => findActionByText(LABELS.editQuote)
      ],
      () => !!findAutoDiscountControl() || (isSubmissionDraft() && (!!findByIdInDocs(IDS.name) || !!findByIdInDocs(IDS.mailingAddress))),
      {
        movementFn: (before, after) => advancedToSubmissionState(before, after, 'draft') || didHeaderChange(before, after)
      }
    );
  }

  async function goToDwelling() {
    await navigateToTab(
      'Dwelling',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.dwellingTab)} > div.gw-action--inner`)),
        () => findActionByText('Dwelling')
      ],
      () => !!findByIdInDocs(IDS.fireCode) || !!findByIdInDocs(IDS.reconstruction)
    );
  }

  async function goToCoverages() {
    await navigateToTab(
      'Coverages',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.coveragesTab)} > div.gw-action--inner`)),
        () => findActionByText('Coverages')
      ],
      () => !!findByIdInDocs(IDS.standardPrice) || !!findByIdInDocs(IDS.pricingTable)
    );
  }

  async function goToExclusionsAndConditions() {
    await navigateToTab(
      'Exclusions and Conditions',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.exclusionsTab)} > div.gw-action--inner`)),
        () => findActionByText('Exclusions and Conditions')
      ],
      () => {
        const inner = findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.exclusionsTab)} > div.gw-action--inner`));
        if (!inner) return false;
        const selected = inner.getAttribute('aria-selected');
        return selected === 'true' || inner.classList.contains('gw-focus');
      }
    );
  }

  async function goToQuote() {
    const openedByAction = await clickQuoteActionToOpenQuote();
    if (openedByAction) return;

    await navigateToTab(
      'Quote',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.quoteTab)} > div.gw-action--inner`)),
        () => findActionByText('Quote')
      ],
      () => isQuoteScreenReady(),
      {
        clickLogContext: 'quote tab fallback',
        movementFn: (before, after) => isQuoteScreenReady() || advancedToSubmissionState(before, after, 'quoted') || didHeaderChange(before, after)
      }
    );
  }

  function describeElement(el) {
    if (!el) return 'null';
    const tag = el.tagName?.toLowerCase?.() || '?';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      : '';
    const aria = el.getAttribute?.('aria-label');
    const role = el.getAttribute?.('role');
    const disabled = el.getAttribute?.('aria-disabled');
    const bits = [`<${tag}>`];
    if (id) bits.push(id);
    if (cls) bits.push(cls);
    if (aria) bits.push(`aria="${aria}"`);
    if (role) bits.push(`role="${role}"`);
    if (disabled === 'true') bits.push('aria-disabled=true');
    return bits.join(' ');
  }

  function resolveClickableTab(el) {
    if (!el) return null;
    const upgraded = upgradeToClickable(el);
    if (upgraded && upgraded.getAttribute?.('aria-disabled') !== 'true') return upgraded;
    const owner = getClickableOwner(el);
    if (owner && owner.getAttribute?.('aria-disabled') !== 'true') return owner;
    return null;
  }

  async function navigateToTab(name, resolvers, readyFn, options = {}) {
    const attempts = Number(options.attempts) > 0 ? Number(options.attempts) : 4;
    const moveTimeoutMs = Number(options.moveTimeoutMs) > 0 ? Number(options.moveTimeoutMs) : CFG.navigationMoveTimeoutMs;
    const clickLogContext = normalizeText(options.clickLogContext || '');
    const movementFn = typeof options.movementFn === 'function'
      ? options.movementFn
      : ((before, after) => didHeaderChange(before, after));

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const currentSnapshot = readNavigationSnapshot();
      if (readyFn()) {
        log(`${name} already ready (${describeNavigationSnapshot(currentSnapshot)})`);
        return;
      }

      const raw = resolveFirst(resolvers);
      if (!raw) {
        log(`${name} tab not found, attempt ${attempt}/${attempts}`);
        await sleep(500);
        continue;
      }

      const target = resolveClickableTab(raw);
      if (!target) {
        log(`${name} tab resolved target is disabled/unclickable (raw=${describeElement(raw)}), attempt ${attempt}/${attempts}`);
        await sleep(500);
        continue;
      }

      const beforeSnapshot = readNavigationSnapshot();
      log(`Clicking ${name} ${describeElement(target)} attempt ${attempt}/${attempts} | ${describeNavigationSnapshot(beforeSnapshot)}`);
      const clicked = strongClick(target);
      if (clicked && clickLogContext) {
        logQuoteButtonClick(`${clickLogContext} attempt ${attempt}/${attempts}`, target, beforeSnapshot);
      }

      const movedOrReady = await waitFor(
        () => {
          if (readyFn()) return true;
          return movementFn(beforeSnapshot, readNavigationSnapshot());
        },
        moveTimeoutMs,
        `${name} movement`
      );
      const afterMoveSnapshot = readNavigationSnapshot();

      if (!movedOrReady) {
        log(`${name} click did not move page (${describeNavigationSnapshot(beforeSnapshot)} -> ${describeNavigationSnapshot(afterMoveSnapshot)}), repeating ${name} step`);
        await sleep(500);
        continue;
      }

      const ok = readyFn() || await waitFor(readyFn, CFG.waitTimeoutMs, `${name} readiness`);
      const afterReadySnapshot = readNavigationSnapshot();
      if (ok) {
        log(`${name} ready (${describeNavigationSnapshot(beforeSnapshot)} -> ${describeNavigationSnapshot(afterReadySnapshot)})`);
        return;
      }

      log(`${name} moved but target is still not ready (${describeNavigationSnapshot(beforeSnapshot)} -> ${describeNavigationSnapshot(afterReadySnapshot)}), repeating ${name} step`);
    }

    throw new Error(`Could not open ${name}`);
  }

  function extractPolicyInfoFields() {
    const nameRaw =
      getDisplayValueById(IDS.name) ||
      extractWithRegex(getTextById(IDS.name), /^Name\s+(.+)$/i);

    const mailingAddressRaw =
      getDisplayValueById(IDS.mailingAddress) ||
      extractWithRegex(getTextById(IDS.mailingAddress), /^Mailing\s*Address\s+(.+)$/i);

    const accountNumberRaw = extractAccountNumberFromPage();

    return {
      'Name': normalizeSimpleValue(nameRaw),
      'Mailing Address': normalizeSimpleValue(mailingAddressRaw),
      'Account Number': normalizeSimpleValue(accountNumberRaw)
    };
  }

  function extractDwellingFields() {
    const fireRaw =
      getDisplayValueById(IDS.fireCode) ||
      extractWithRegex(getTextById(IDS.fireBlock), /FireLine\s*Code\s+(.+?)(?:\s+Slope|\s*$)/i);

    const protectionRaw =
      extractWithRegex(getTextById(IDS.protectionBlock), /Code\s+([A-Z0-9-]+)/i);

    const reconstructionRaw =
      getDisplayValueById(IDS.reconstruction) ||
      extractWithRegex(getTextById(IDS.reconstruction), /Reconstruction\s*Cost\s+(.+)$/i);

    const yearBuiltRaw =
      getDisplayValueById(IDS.yearBuilt) ||
      extractWithRegex(getTextById(IDS.yearBuilt), /Year\s*Built\s+(.+)$/i);

    const squareFeetRaw =
      getDisplayValueById(IDS.squareFeet) ||
      extractWithRegex(getTextById(IDS.squareFeet), /Square\s*Feet\s+(.+)$/i);

    const storiesRaw =
      getDisplayValueById(IDS.stories) ||
      extractWithRegex(getTextById(IDS.stories), /Number\s*of\s*Stories\/Style\s+(.+)$/i);

    const waterRaw =
      getDisplayValueById(IDS.waterDevice) ||
      extractWithRegex(getTextById(IDS.waterDevice), /Water\s*Protection\s+(.+)$/i);

    const riskAddressRaw =
      extractRiskAddressValue() ||
      getDisplayValueById(IDS.riskAddressPolicyInfo) ||
      extractWithRegex(getTextById(IDS.riskAddressPolicyInfo), /^Risk\s*Address\s+(.+)$/i);

    const roofTypeRaw = extractLabeledFieldValue(['Roof Type', 'Home Roof Type']);
    const bedroomsRaw = extractLabeledFieldValue(['Bedrooms', 'Bedroom']);
    const bathroomsRaw = extractLabeledFieldValue(['Bathrooms', 'Bathroom']);
    const homeTypeRaw = extractLabeledFieldValue(['Home Type', 'Dwelling Type', 'Residence Type']);

    return {
      'Risk Address': normalizeSimpleValue(riskAddressRaw),
      'Fire Code': normalizeFireCode(fireRaw),
      'Protection Class': normalizeSimpleValue(protectionRaw),
      'Reconstruction Cost': normalizeMoneyText(reconstructionRaw),
      'Year Built': normalizeSimpleValue(yearBuiltRaw),
      'Square FT': normalizeSimpleValue(squareFeetRaw),
      '# of Story': normalizeSimpleValue(storiesRaw),
      'Home Roof Type': normalizeSimpleValue(roofTypeRaw),
      'Bedrooms': normalizeRoomValue(bedroomsRaw),
      'Bathrooms': normalizeRoomValue(bathroomsRaw),
      'Home Type': normalizeSimpleValue(homeTypeRaw),
      'Water Device?': normalizeWaterDevice(waterRaw)
    };
  }

  function extractRiskAddressValue() {
    return findInDocs((doc) => {
      const labels = doc.querySelectorAll('.gw-label, .gw-boldLabel, .gw-LabelWidget');
      for (const label of labels) {
        if (!isVisibleEl(label)) continue;
        if (normalizeText(label.textContent) !== 'Risk Address') continue;
        const container = label.closest('.gw-InputWidget, .gw-LabelWidget, [role="group"]') || label.parentElement;
        if (!container) continue;
        const valueNode = container.querySelector('.gw-value-readonly-wrapper, .gw-vw--value, .gw-value');
        if (valueNode && !isVisibleEl(valueNode)) continue;
        const text = normalizeText(valueNode?.innerText || valueNode?.textContent || '');
        if (text && text !== 'Risk Address') return text.replace(/^Risk Address\s*/i, '').trim();
      }
      return '';
    }) || '';
  }

  function extractAccountInfoFields() {
    const accountNumber = extractAccountNumberFromPage();
    return {
      'Account Number': normalizeSimpleValue(accountNumber)
    };
  }

  function extractAccountNumberFromPage() {
    const exact = findInDocs((doc) => {
      const wrap = doc.getElementById(IDS.accountNumberInfoBar);
      if (!wrap || !isVisibleEl(wrap)) return '';

      const values = Array.from(wrap.querySelectorAll('.gw-infoValue, .gw-label.gw-infoValue'))
        .map((node) => normalizeText(node.textContent || ''))
        .filter(Boolean);

      if (values.length > 1) return values[1];
      if (values[0] && values[0] !== 'Account:') return values[0];
      const text = normalizeText(wrap.textContent || '');
      const match = text.match(/Account:\s*(.+)$/i);
      return match ? normalizeText(match[1]) : '';
    });

    if (exact) return normalizeSimpleValue(exact);
    return normalizeSimpleValue(extractLabeledFieldValue(['Account Number']));
  }

  function extractLabeledFieldValue(labelTexts) {
    const wanted = (Array.isArray(labelTexts) ? labelTexts : [labelTexts])
      .map((value) => normalizeText(value))
      .filter(Boolean);

    if (!wanted.length) return '';

    for (const doc of getAccessibleDocs()) {
      let labels = [];
      try {
        labels = Array.from(doc.querySelectorAll('.gw-label, .gw-boldLabel, .gw-LabelWidget, .gw-vw--label, label'));
      } catch {}

      for (const label of labels) {
        if (!isVisibleEl(label)) continue;
        const text = normalizeText(label.textContent || '');
        if (!wanted.includes(text)) continue;

        const containers = [
          label.closest('.gw-InputWidget, .gw-ValueWidget, .gw-ValueWidget--inner, .gw-InfoBarElementWidget, .gw-RowWidget, td, tr, [role="group"]'),
          label.parentElement,
          label.parentElement?.parentElement
        ].filter(Boolean);

        for (const container of containers) {
          const value = extractValueFromLabeledContainer(container, wanted);
          if (value) return value;
        }
      }
    }

    return '';
  }

  function extractValueFromLabeledContainer(container, labelTexts) {
    if (!(container instanceof Element)) return '';
    const wanted = new Set((labelTexts || []).map((value) => normalizeText(value)).filter(Boolean));

    let nodes = [];
    try {
      nodes = Array.from(container.querySelectorAll('.gw-value-readonly-wrapper, .gw-vw--value, .gw-value, .gw-infoValue, [data-gw-getset="text"], input:not([type="hidden"]), select, textarea'));
    } catch {}

    for (const node of nodes) {
      if (node instanceof Element && !isVisibleEl(node)) continue;
      const value = readFieldNodeValue(node);
      if (!value || wanted.has(value)) continue;
      return value;
    }

    const text = normalizeText(container.innerText || container.textContent || '');
    if (!text) return '';

    for (const labelText of wanted) {
      if (!text.startsWith(labelText)) continue;
      const stripped = normalizeText(text.slice(labelText.length));
      if (stripped && !wanted.has(stripped)) return stripped;
    }

    return '';
  }

  function elementTagName(node) {
    return String(node?.tagName || '').toUpperCase();
  }

  function isSelectNode(node) {
    return elementTagName(node) === 'SELECT';
  }

  function isTextInputNode(node) {
    const tag = elementTagName(node);
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  function getSelectedOptionText(selectEl) {
    if (!isSelectNode(selectEl)) return '';
    const option = selectEl.selectedOptions?.[0] || selectEl.options?.[selectEl.selectedIndex];
    return normalizeText(option?.textContent || option?.innerText || selectEl.value || '');
  }

  function readFieldNodeValue(node) {
    if (!node || typeof node !== 'object') return '';
    if (isTextInputNode(node)) {
      return normalizeText(node.value || node.getAttribute('value') || '');
    }
    if (isSelectNode(node)) {
      return getSelectedOptionText(node);
    }
    const select = node.querySelector?.('select');
    if (isSelectNode(select)) {
      return getSelectedOptionText(select);
    }
    return normalizeText(node.innerText || node.textContent || '');
  }

  function extractPricingFields() {
    let standard = getTextById(IDS.standardPrice);
    let enhance = getTextById(IDS.enhancePrice);

    if (!standard || !enhance) {
      const row2 = findInDocs((doc) => {
        const root = doc.getElementById(IDS.pricingTable);
        return root?.querySelector('table tbody tr:nth-of-type(2)') || null;
      });

      if (row2) {
        standard = standard || getElementText(row2.querySelector('td:nth-of-type(3)'));
        enhance = enhance || getElementText(row2.querySelector('td:nth-of-type(5)'));
      }
    }

    return {
      'Standard Pricing': normalizeMoneyText(standard),
      'Enhance Pricing': normalizeMoneyText(enhance)
    };
  }

  function extractCFPValue() {
    const found = findInDocs((doc) => {
      const headers = doc.querySelectorAll(SEL.fairPlanLabelClass);
      for (const el of headers) {
        if (!isVisibleEl(el)) continue;
        if (normalizeText(el.textContent || '') === LABELS.fairPlanCompanionEndorsement) return el;
      }
      return null;
    });

    return found ? 'YES' : 'NO';
  }

  function extractQuoteFields() {
    const raw = getTextById(IDS.autoDiscountLV);
    const amount = extractFirstMoney(raw);
    const applied = isAutoDiscountApplied() || state.autoDiscountChosenThisLoad === true;

    return {
      'Auto Discount': amount || (applied ? 'Yes' : '')
    };
  }

  function collectDiscountEntries(...sources) {
    const out = [];
    const seen = new Set();

    const add = (value) => {
      const text = normalizeText(value);
      if (!text || text === 'N/A') return;
      if (seen.has(text)) return;
      seen.add(text);
      out.push(text);
    };

    const visit = (value, key = '') => {
      if (value == null) return;

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const rawText = String(value == null ? '' : value);
        const text = normalizeText(rawText);
        const keyText = normalizeText(key);
        if (keyText && keyText.toLowerCase().includes('discount')) {
          add(`${keyText}=${text || 'blank'}`);
          return;
        }
        if (rawText.includes('\n')) {
          for (const line of rawText.split(/\n+/)) {
            const normalizedLine = normalizeText(line);
            if (normalizedLine.toLowerCase().includes('discount')) add(normalizedLine);
          }
          return;
        }
        if (text.toLowerCase().includes('discount')) add(text);
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) visit(item, key);
        return;
      }

      if (typeof value === 'object') {
        for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
      }
    };

    for (const source of sources) visit(source);
    return out;
  }

  function logDiscountQuotedResult(context, sources, options = {}) {
    const entries = collectDiscountEntries(...sources);
    if (entries.length) {
      log(`DISCOUNT QUOTED | ${normalizeText(context || 'Quote')} | ${entries.join(' || ')}`);
      return;
    }

    if (options.forceApplied === true) {
      log(`DISCOUNT QUOTED | ${normalizeText(context || 'Quote')} | discount applied but no discount value was shown`);
      return;
    }

    log(`DISCOUNT CHECK | ${normalizeText(context || 'Quote')} | no discount entries detected`);
  }

  function extractSubmissionNumber() {
    const titleEl = findInDocs((doc) => {
      const nodes = doc.querySelectorAll('div.gw-Wizard--Title');
      for (const el of nodes) {
        const text = normalizeText(el.textContent);
        if (/^Submission\s+\d+/i.test(text)) return el;
      }
      return null;
    });

    if (!titleEl) return '';
    const text = normalizeText(titleEl.textContent);
    const m = text.match(/Submission\s+(\d+)/i);
    return m ? m[1] : '';
  }

  function findQuotedTriggerElement() {
    return findInDocs((doc) => {
      const nodes = doc.querySelectorAll('div.gw-label');
      for (const el of nodes) {
        if (!isVisibleEl(el)) continue;
        if (normalizeText(el.textContent) === 'Submission (Quoted)') return el;
      }
      return null;
    });
  }

  function findActionByExactText(text) {
    return findInDocs((doc) => {
      const wanted = normalizeText(text);
      const candidates = doc.querySelectorAll('div.gw-action--inner, div[role="menuitem"], div[role="tab"], div[role="button"], button, a');
      for (const el of candidates) {
        if (!isVisibleEl(el)) continue;
        if (normalizeText(el.textContent) === wanted) return el;
      }
      return null;
    });
  }

  function findActionByText(text) {
    return findInDocs((doc) => {
      const wanted = normalizeText(text);
      const candidates = doc.querySelectorAll('div.gw-action--inner, div[role="menuitem"], div[role="tab"], div[role="button"], button, a');
      for (const el of candidates) {
        if (!isVisibleEl(el)) continue;
        if (normalizeText(el.textContent).includes(wanted)) return el;
      }
      return null;
    });
  }

  function findAutoDiscountControl() {
    return findInDocs((doc) => {
      const exact = doc.querySelector(SEL.autoDiscountCheckboxExact);
      if (exact) return exact;

      const inputs = doc.querySelectorAll('input[type="checkbox"], input[type="radio"]');
      for (const input of inputs) {
        const signature = `${input.name || ''} ${input.id || ''}`;
        if (/MultiLineDiscounts/i.test(signature) && /DiscountSelected/i.test(signature)) return input;
      }

      return null;
    });
  }

  function isAutoDiscountApplied() {
    const control = findAutoDiscountControl();
    if (!control) return false;
    return control.checked === true || control.getAttribute('checked') != null || control.getAttribute('aria-checked') === 'true';
  }

  async function applyAutoDiscount() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const control = findAutoDiscountControl();
      if (!control) {
        log(`Auto discount control not found, attempt ${attempt}/3`);
        await sleep(500);
        continue;
      }

      if (isAutoDiscountApplied()) {
        log('Auto discount already selected');
        log('DISCOUNT ADDED | Home | Auto Discount already selected');
        return;
      }

      if (control.disabled) {
        log(`Auto discount control disabled, attempt ${attempt}/3`);
        await sleep(500);
        continue;
      }

      log(`Selecting auto discount, attempt ${attempt}/3`);
      const clickTarget = isVisibleEl(control) ? control : control.closest('label') || control.parentElement || control;
      strongClick(clickTarget);

      try { control.checked = true; } catch {}
      try { control.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
      try { control.dispatchEvent(new Event('change', { bubbles: true })); } catch {}

      const ok = await waitFor(() => isAutoDiscountApplied(), CFG.waitTimeoutMs, 'auto discount selection');
      if (ok) {
        state.autoDiscountChosenThisLoad = true;
        log('Auto discount selected');
        log('DISCOUNT ADDED | Home | Auto Discount selected');
        return;
      }
    }

    throw new Error('Could not apply auto discount');
  }

  function isTitleLike(word) {
    return !!findInDocs((doc) => {
      const nodes = doc.querySelectorAll('title, .gw-TitleBar--Title, .gw-TitleBar--title, .gw-TabBar, .gw-Wizard--Title');
      for (const el of nodes) {
        if (normalizeText(el.textContent).includes(word)) return el;
      }
      return null;
    });
  }

  function getDisplayValueById(id) {
    const el = findByIdInDocs(id);
    if (!el) return '';

    const candidates = [
      el.matches?.('select') ? el : null,
      el.querySelector('select'),
      el.querySelector('input:not([type="hidden"]), textarea'),
      el.querySelector('.gw-value-readonly-wrapper'),
      el.querySelector('.gw-vw--value'),
      el.querySelector('.gw-value'),
      el.querySelector('.gw-infoValue'),
      el.querySelector('[data-gw-getset="text"]')
    ];

    for (const c of candidates) {
      const value = readFieldNodeValue(c);
      if (value && value !== 'Code') return value;
    }

    return '';
  }

  function getTextById(id) {
    const el = findByIdInDocs(id);
    return getElementText(el);
  }

  function getElementText(el) {
    if (!el) return '';
    return normalizeText(el.innerText || el.textContent || '');
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeSimpleValue(value) {
    return normalizeText(value);
  }

  function normalizeMoneyText(value) {
    const text = normalizeText(value);
    const money = extractFirstMoney(text);
    return money || text;
  }

  function normalizeRoomValue(value) {
    const text = normalizeText(value);
    if (!text) return '';
    const match = text.match(/\d+(?:\.\d+)?/);
    return match ? match[0] : text;
  }

  function normalizeFireCode(value) {
    const text = normalizeText(value);
    const m = text.match(/(?:^|\b)Code\s+([A-Z0-9.-]+)/i);
    if (m) return m[1];
    return text;
  }

  function normalizeWaterDevice(value) {
    const text = normalizeText(value);
    if (!text) return 'No';

    if (
      /^(none|no|n\/a|na|null|no device|not installed|not present|not applicable)$/i.test(text) ||
      /\b(no device|none|not installed|not present|not applicable)\b/i.test(text)
    ) {
      return 'No';
    }

    return 'Yes';
  }

  function extractFirstMoney(text) {
    const m = normalizeText(text).match(/\$[\d,]+(?:\.\d{2})?/);
    return m ? m[0] : '';
  }

  function extractWithRegex(text, regex) {
    const m = normalizeText(text).match(regex);
    return m ? normalizeText(m[1]) : '';
  }

  function findByIdInDocs(id) {
    return findInDocs((doc) => doc.getElementById(id));
  }

  function findInDocs(resolver) {
    const docs = getAccessibleDocs();
    for (const doc of docs) {
      try {
        const found = resolver(doc);
        if (found === true) return true;
        if (found) return found;
      } catch {}
    }
    return null;
  }

  function getAccessibleDocs() {
    const docs = [];
    const seen = new Set();

    function walk(win) {
      try {
        if (!win || seen.has(win)) return;
        seen.add(win);

        if (win.document) docs.push(win.document);

        for (let i = 0; i < win.frames.length; i++) {
          try {
            walk(win.frames[i]);
          } catch {}
        }
      } catch {}
    }

    walk(window.top);
    return docs;
  }

  function getStableClassTokens(el) {
    return Array.from(el?.classList || [])
      .filter((token) => /^gw-|^iv360-|^btn-|^ui-|^pc-/.test(token))
      .slice(0, 4);
  }

  function buildFieldFingerprint(el) {
    if (!(el instanceof Element)) return {};
    return {
      tag: normalizeText(el.tagName || '').toLowerCase(),
      id: normalizeText(el.id || ''),
      name: normalizeText(el.getAttribute('name') || ''),
      role: normalizeText(el.getAttribute('role') || ''),
      ariaLabel: normalizeText(el.getAttribute('aria-label') || ''),
      classTokens: getStableClassTokens(el),
      textFingerprint: normalizeText((el.innerText || el.textContent || '').slice(0, 160))
    };
  }

  function isUniqueSelectorAcrossDocs(selector) {
    let count = 0;
    for (const doc of getAccessibleDocs()) {
      try {
        count += doc.querySelectorAll(selector).length;
        if (count > 1) return false;
      } catch {}
    }
    return count === 1;
  }

  function buildStableSelector(el) {
    if (!(el instanceof Element)) return '';

    if (el.id) return `#${cssEscape(el.id)}`;

    const name = normalizeText(el.getAttribute('name') || '');
    if (name) {
      const selector = `${el.tagName.toLowerCase()}[name="${cssAttrEscape(name)}"]`;
      if (isUniqueSelectorAcrossDocs(selector)) return selector;
    }

    const role = normalizeText(el.getAttribute('role') || '');
    const aria = normalizeText(el.getAttribute('aria-label') || '');
    if (role && aria) {
      const selector = `${el.tagName.toLowerCase()}[role="${cssAttrEscape(role)}"][aria-label="${cssAttrEscape(aria)}"]`;
      if (isUniqueSelectorAcrossDocs(selector)) return selector;
    }

    const parts = [];
    let current = el;
    while (current && current.nodeType === 1 && current !== current.ownerDocument?.body && parts.length < 6) {
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
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      const selector = parts.join(' > ');
      if (isUniqueSelectorAcrossDocs(selector)) return selector;
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function matchFieldFingerprint(record, el) {
    if (!(el instanceof Element)) return false;
    const saved = isPlainObject(record?.fingerprint) ? record.fingerprint : {};
    const current = buildFieldFingerprint(el);

    if (saved.id && current.id && saved.id === current.id) return true;

    let score = 0;
    let required = 0;
    for (const key of ['tag', 'name', 'role', 'ariaLabel', 'textFingerprint']) {
      if (!saved[key]) continue;
      required += 1;
      const left = normalizeText(saved[key]).toLowerCase();
      const right = normalizeText(current[key]).toLowerCase();
      if (!left || !right) continue;
      if (key === 'textFingerprint') {
        if (left === right || left.includes(right) || right.includes(left)) score += 1;
      } else if (left === right) {
        score += 1;
      }
    }

    if (Array.isArray(saved.classTokens) && saved.classTokens.length) {
      required += 1;
      const currentTokens = new Set(Array.isArray(current.classTokens) ? current.classTokens : []);
      if (saved.classTokens.every((token) => currentTokens.has(token))) score += 1;
    }

    if (required === 0) return true;
    if (required === 1) return score === 1;
    return score >= 2;
  }

  function findCustomFieldElement(rule) {
    const selector = normalizeText(rule?.selector || '');
    if (!selector) return null;

    for (const doc of getAccessibleDocs()) {
      let nodes = [];
      try { nodes = Array.from(doc.querySelectorAll(selector)); } catch {}
      const visibleNodes = nodes.filter(isVisibleEl);
      for (const node of visibleNodes) {
        if (matchFieldFingerprint(rule, node)) return node;
      }
      if (visibleNodes.length) return visibleNodes[0];
      if (nodes.length) return nodes[0];
    }
    return null;
  }

  function readCustomFieldElementValue(el) {
    if (!el) return '';

    if (isSelectNode(el)) {
      return getSelectedOptionText(el);
    }
    if (isTextInputNode(el)) {
      return normalizeText(el.value || el.getAttribute('value') || '');
    }

    const candidates = [
      q('select', el),
      q('input:not([type="hidden"]), textarea', el),
      q('.gw-value-readonly-wrapper', el),
      q('.gw-vw--value', el),
      q('.gw-value', el),
      q('.gw-infoValue', el),
      q('[data-gw-getset="text"]', el),
      el
    ].filter(Boolean);

    for (const node of candidates) {
      if (isSelectNode(node)) {
        const text = getSelectedOptionText(node);
        if (text) return text;
      }
      if (isTextInputNode(node)) {
        const text = normalizeText(node.value || node.getAttribute('value') || '');
        if (text) return text;
      }
      const text = normalizeText(node.innerText || node.textContent || '');
      if (text) return text;
    }

    return '';
  }

  function inferCustomFieldLabelText(el) {
    if (!(el instanceof Element)) return '';

    const ownValue = normalizeText(readCustomFieldElementValue(el) || el.innerText || el.textContent || '');
    const containers = [
      el.closest('.gw-InputWidget, .gw-ValueWidget, .gw-ValueWidget--inner, .gw-InfoBarElementWidget, .gw-RowWidget, td, tr, [role="group"]'),
      el.parentElement,
      el.parentElement?.parentElement,
      el.parentElement?.parentElement?.parentElement
    ].filter(Boolean);

    for (const container of containers) {
      let labels = [];
      try {
        labels = Array.from(container.querySelectorAll('.gw-label, .gw-boldLabel, .gw-LabelWidget, .gw-vw--label, label'));
      } catch {}

      for (const label of labels) {
        if (!isVisibleEl(label)) continue;
        const text = normalizeText(label.textContent || '');
        if (!text || text === ownValue || text.length > 120) continue;
        return text;
      }
    }

    return '';
  }

  function readCustomFieldValueByLabel(rule) {
    const labels = [
      normalizeText(rule?.labelText || ''),
      normalizeText(rule?.fieldName || '')
    ].filter(Boolean);
    const uniqueLabels = [...new Set(labels)];
    if (!uniqueLabels.length) return { value: '', label: '' };

    const value = extractLabeledFieldValue(uniqueLabels);
    if (!value) return { value: '', label: uniqueLabels.join(' / ') };
    return { value, label: uniqueLabels.join(' / ') };
  }

  function captureCustomFieldUpdatesForCurrentHeader(options = {}) {
    const headerText = normalizeText(options.headerText || getHeaderText());
    const allRules = readCustomFieldRules();
    const rules = [];
    const updates = {};
    const missing = [];
    const headerFallbacks = [];
    const headerSkips = [];

    for (const rule of allRules) {
      const headerMatches = customFieldHeaderMatches(rule.headerText, headerText);
      const target = findCustomFieldElement(rule);
      const targetVisible = !!target && isVisibleEl(target);
      let value = target ? readCustomFieldElementValue(target) : '';
      let source = target ? 'selector' : '';

      if (!value) {
        const labeled = readCustomFieldValueByLabel(rule);
        if (labeled.value) {
          value = labeled.value;
          source = `label ${labeled.label}`;
        }
      }

      if (!headerMatches && !(targetVisible && value) && !source.startsWith('label ')) {
        headerSkips.push(`${rule.fieldName}: saved under "${rule.headerText || '(blank)'}"`);
        continue;
      }

      rules.push(rule);
      if (!value) {
        missing.push(`${rule.fieldName}: blank`);
        continue;
      }

      if (!headerMatches) {
        headerFallbacks.push(`${rule.fieldName}: saved="${rule.headerText || '(blank)'}" current="${headerText || '(blank)'}" via ${source || 'selector'}`);
      }
      updates[rule.fieldName] = value;
    }

    if (options.logMatches && Object.keys(updates).length) {
      log(`Custom fields (${headerText}): ${JSON.stringify(updates)}`);
      if (headerFallbacks.length) log(`Custom field header fallback (${headerText}): ${headerFallbacks.join(' | ')}`);
    } else if (options.logMissing && rules.length && missing.length) {
      log(`Custom fields missing (${headerText}): ${missing.join(' | ')}`);
    } else if (options.logMissing && !rules.length && headerSkips.length) {
      log(`Custom fields skipped by header (${headerText || '(blank)'}): ${headerSkips.slice(0, 6).join(' | ')}`);
    }

    return { headerText, rules, updates, missing };
  }

  function isPickerUiElement(el) {
    if (!(el instanceof Element)) return false;
    if (state.ui?.panel?.contains(el)) return true;
    if (el === state.customFieldHoverBox) return true;
    if (state.customFieldHoverBox?.contains?.(el)) return true;
    return false;
  }

  function getPickerTargetFromPath(path) {
    for (const item of path || []) {
      if (!(item instanceof Element)) continue;
      if (isPickerUiElement(item)) continue;
      if (isVisibleEl(item)) return item;
    }
    return null;
  }

  function ensureCustomFieldHoverBox() {
    if (state.customFieldHoverBox) return;
    const box = document.createElement('div');
    box.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'pointer-events:none',
      'border:2px solid rgba(248,113,113,.95)',
      'background:rgba(252,165,165,.16)',
      'border-radius:6px',
      'display:none'
    ].join(';');
    document.documentElement.appendChild(box);
    state.customFieldHoverBox = box;
  }

  function updateCustomFieldHoverBox(target) {
    ensureCustomFieldHoverBox();
    if (!state.customFieldHoverBox) return;
    if (!(target instanceof Element)) {
      state.customFieldHoverBox.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    state.customFieldHoverBox.style.display = 'block';
    state.customFieldHoverBox.style.left = `${rect.left}px`;
    state.customFieldHoverBox.style.top = `${rect.top}px`;
    state.customFieldHoverBox.style.width = `${rect.width}px`;
    state.customFieldHoverBox.style.height = `${rect.height}px`;
  }

  function updateCustomFieldButtons() {
    if (!state.ui?.addCustomBtn || !state.ui?.clearCustomBtn) return;
    const count = readCustomFieldRules().length;
    state.ui.addCustomBtn.textContent = state.customFieldPicker
      ? 'CANCEL EXTRA'
      : `ADD EXTRA${count ? ` (${count})` : ''}`;
    state.ui.addCustomBtn.style.background = state.customFieldPicker ? '#f59e0b' : '#7c3aed';
    state.ui.clearCustomBtn.disabled = !!state.customFieldPicker || count === 0;
    state.ui.clearCustomBtn.style.background = count === 0 ? '#334155' : '#4b5563';
    state.ui.clearCustomBtn.style.opacity = (!state.customFieldPicker && count > 0) ? '1' : '.75';
    state.ui.clearCustomBtn.style.cursor = (!state.customFieldPicker && count > 0) ? 'pointer' : 'not-allowed';
  }

  function stopCustomFieldPicker(message = '', options = {}) {
    if (!state.customFieldPicker) return;
    document.removeEventListener('mousemove', state.customFieldPickerMove, true);
    document.removeEventListener('click', state.customFieldPickerClick, true);
    document.removeEventListener('keydown', state.customFieldPickerKeydown, true);
    state.customFieldPickerMove = null;
    state.customFieldPickerClick = null;
    state.customFieldPickerKeydown = null;
    state.customFieldPicker = null;
    updateCustomFieldHoverBox(null);
    updateCustomFieldButtons();
    if (options.logIt !== false && message) log(message);
    setStatus(options.restoreStatus || (state.running ? 'Background gatherer armed' : 'Stopped'));
  }

  function saveCustomFieldFromPicker(target) {
    const selector = buildStableSelector(target);
    if (!selector) {
      log('Custom field picker failed: could not build stable selector');
      return;
    }

    const headerText = normalizeText(state.customFieldPicker?.headerText || '');
    const saveAs = normalizeText(window.prompt('Save As?', '') || '');
    if (!saveAs) {
      stopCustomFieldPicker('Custom field save canceled');
      return;
    }

    const rule = upsertCustomFieldRule({
      ruleId: buildCustomFieldRuleId(headerText, saveAs),
      headerText,
      headerKey: normalizeCustomFieldHeaderKey(headerText),
      fieldName: saveAs,
      labelText: inferCustomFieldLabelText(target),
      selector,
      fingerprint: buildFieldFingerprint(target),
      savedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (!rule) {
      stopCustomFieldPicker('Custom field save failed');
      return;
    }

    stopCustomFieldPicker(`Custom field saved: ${saveAs} @ ${headerText}`);
  }

  function startCustomFieldPicker() {
    if (state.customFieldPicker) {
      stopCustomFieldPicker('Custom field picker canceled');
      return;
    }

    ensureCustomFieldHoverBox();
    state.customFieldPicker = {
      step: 'header',
      headerText: '',
      previousStatus: state.lastStatus || (state.running ? 'Background gatherer armed' : 'Stopped')
    };

    state.customFieldPickerMove = (event) => {
      const target = getPickerTargetFromPath(event.composedPath ? event.composedPath() : [event.target]);
      updateCustomFieldHoverBox(target);
    };
    state.customFieldPickerClick = (event) => {
      const target = getPickerTargetFromPath(event.composedPath ? event.composedPath() : [event.target]);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      if (state.customFieldPicker?.step === 'header') {
        const headerText = normalizeText(target.innerText || target.textContent || '');
        if (!headerText) {
          log('Custom field picker: clicked header has no text');
          return;
        }
        state.customFieldPicker.step = 'field';
        state.customFieldPicker.headerText = headerText;
        setStatus(`Custom picker: click field for ${headerText}`);
        log(`Custom field header selected: ${headerText}`);
        return;
      }

      saveCustomFieldFromPicker(target);
    };
    state.customFieldPickerKeydown = (event) => {
      if (event.key === 'Escape') {
        stopCustomFieldPicker('Custom field picker canceled');
      }
    };

    document.addEventListener('mousemove', state.customFieldPickerMove, true);
    document.addEventListener('click', state.customFieldPickerClick, true);
    document.addEventListener('keydown', state.customFieldPickerKeydown, true);
    updateCustomFieldButtons();
    setStatus('Custom picker: click header');
    log('Custom field picker started: click the page header first, then the value element');
  }

  function resolveFirst(resolvers) {
    for (const fn of resolvers) {
      try {
        const value = fn();
        if (value) return value;
      } catch {}
    }
    return null;
  }

  function safeClick(el) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {}

    const events = [
      ['pointerdown', MouseEvent],
      ['mousedown', MouseEvent],
      ['pointerup', MouseEvent],
      ['mouseup', MouseEvent],
      ['click', MouseEvent]
    ];

    for (const [type, Ctor] of events) {
      try {
        el.dispatchEvent(new Ctor(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
    }

    try { el.click(); } catch {}
  }

  async function waitFor(checkFn, timeoutMs, label) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (checkFn()) return true;
      } catch {}
      await sleep(CFG.waitPollMs);
    }
    log(`Timeout waiting for ${label}`);
    return false;
  }

  function formatDate(date) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
  }

  function setWaiting(msg) {
    if (state.lastWaitReason === msg) return;
    state.lastWaitReason = msg;
    writeActivityState('waiting', msg);
    log(msg);
    setStatus(msg);
  }

  function buildUI() {
    const panel = document.createElement('div');
    panel.id = 'hb-home-quote-grabber-panel';
    panel.setAttribute('data-hb-script-id', SCRIPT_ID);
    panel.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'right:12px',
      'bottom:12px',
      'width:360px',
      'background:#111827',
      'color:#f9fafb',
      'border:1px solid #374151',
      'border-radius:12px',
      'box-shadow:0 8px 24px rgba(0,0,0,.35)',
      'font:12px/1.35 Arial,sans-serif',
      'user-select:none'
    ].join(';');

    const saved = loadPanelPos();
    if (saved) {
      panel.style.left = saved.left;
      panel.style.top = saved.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    panel.innerHTML = `
      <div id="hb-home-quote-grabber-head" style="padding:8px 10px;cursor:move;border-bottom:1px solid #374151;background:#0f172a;border-radius:12px 12px 0 0;">
        <div style="font-weight:700;">${SCRIPT_NAME}</div>
        <div style="opacity:.8;">V${VERSION}</div>
      </div>
      <div style="padding:8px 10px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px;">
          <button id="hb-home-quote-grabber-toggle" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#dc2626;color:#fff;">STOP</button>
          <button id="hb-home-quote-grabber-copylogs" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#2563eb;color:#fff;">COPY LOGS</button>
          <button id="hb-home-quote-grabber-copypayload" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#4b5563;color:#fff;">COPY PAYLOAD</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
          <button id="hb-home-quote-grabber-addcustom" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#7c3aed;color:#fff;">ADD EXTRA</button>
          <button id="hb-home-quote-grabber-clearcustom" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#4b5563;color:#fff;">CLEAR EXTRA</button>
        </div>
        <div id="hb-home-quote-grabber-status" style="margin-bottom:8px;padding:6px 8px;border-radius:8px;background:#1f2937;">Waiting...</div>
        <div id="hb-home-quote-grabber-logs" style="max-height:220px;overflow:auto;background:#0b1220;border:1px solid #243041;border-radius:8px;padding:6px;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);

    const head = panel.querySelector('#hb-home-quote-grabber-head');
    const toggleBtn = panel.querySelector('#hb-home-quote-grabber-toggle');
    const copyLogsBtn = panel.querySelector('#hb-home-quote-grabber-copylogs');
    const copyPayloadBtn = panel.querySelector('#hb-home-quote-grabber-copypayload');
    const addCustomBtn = panel.querySelector('#hb-home-quote-grabber-addcustom');
    const clearCustomBtn = panel.querySelector('#hb-home-quote-grabber-clearcustom');

    toggleBtn.addEventListener('click', () => {
      state.running = !state.running;
      toggleBtn.textContent = state.running ? 'STOP' : 'START';
      toggleBtn.style.background = state.running ? '#dc2626' : '#16a34a';
      log(state.running ? 'Resumed' : 'Stopped for this page session');
      setStatus(state.running ? 'Running' : 'Stopped');

      if (state.running) {
        state.triggerSince = 0;
        state.doneThisLoad = false;
        state.flowStartedThisLoad = false;
        state.coverageTriggerSince = 0;
      }
      updateCustomFieldButtons();
    });

    copyLogsBtn.addEventListener('click', async () => {
      try {
        const text = [...state.logLines].reverse().join('\n');
        await navigator.clipboard.writeText(text);
        log('Logs copied');
      } catch {
        log('Copy logs failed');
      }
    });

    copyPayloadBtn.addEventListener('click', async () => {
      try {
        const value = localStorage.getItem(KEYS.payload) || '';
        await navigator.clipboard.writeText(value);
        log('Payload copied');
      } catch {
        log('Copy payload failed');
      }
    });

    addCustomBtn.addEventListener('click', () => {
      startCustomFieldPicker();
    });

    clearCustomBtn.addEventListener('click', () => {
      if (state.customFieldPicker) {
        stopCustomFieldPicker('Custom field picker canceled');
        return;
      }
      const count = readCustomFieldRules().length;
      if (!count) {
        log('No custom field rules to clear');
        return;
      }
      if (!window.confirm(`Clear ${count} custom field rule${count === 1 ? '' : 's'}?`)) return;
      clearCustomFieldRules();
      log(`Cleared ${count} custom field rule${count === 1 ? '' : 's'}`);
    });

    makeDraggable(panel, head);

    state.ui = {
      panel,
      addCustomBtn,
      clearCustomBtn,
      status: panel.querySelector('#hb-home-quote-grabber-status'),
      logs: panel.querySelector('#hb-home-quote-grabber-logs')
    };
    updateCustomFieldButtons();
  }

  function setStatus(text) {
    state.lastStatus = text;
    if (state.ui?.status) state.ui.status.textContent = text;
    writeActivityState(state.activityState, text);
  }

  function readScriptActivityMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SCRIPT_ACTIVITY_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeScriptActivityMap(nextMap) {
    try { localStorage.setItem(SCRIPT_ACTIVITY_KEY, JSON.stringify(nextMap, null, 2)); } catch {}
  }

  function writeActivityState(nextState, message = '') {
    state.activityState = normalizeText(nextState).toLowerCase() || 'idle';
    state.activityMessage = normalizeText(message || state.lastStatus || state.activityMessage || '') || '';

    const currentJob = readCurrentJob();
    const current = readScriptActivityMap();
    current[SCRIPT_ID] = {
      scriptId: SCRIPT_ID,
      scriptName: SCRIPT_NAME,
      state: state.activityState,
      message: state.activityMessage,
      azId: normalizeText(currentJob['AZ ID'] || state.currentAzId || ''),
      updatedAt: new Date().toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeScriptActivityMap(current);
  }

  function log(message) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${message}`;
    state.logLines.unshift(line);
    if (state.logLines.length > CFG.maxLogLines) state.logLines.length = CFG.maxLogLines;
    console.log(`[${SCRIPT_NAME}] ${message}`);

    if (state.ui?.logs) {
      state.ui.logs.innerHTML = state.logLines
        .map((x) => `<div style="margin-bottom:4px;">${escapeHtml(x)}</div>`)
        .join('');
    }
    persistLogsThrottled();
  }

  function persistLogsThrottled() {
    if (state.destroyed) return;
    const now = Date.now();
    if (now - _lastLogPersistAt < LOG_PERSIST_THROTTLE_MS) return;
    _lastLogPersistAt = now;
    const raw = Array.isArray(state.logLines) ? state.logLines : [];
    const lines = raw.map(entry => (typeof entry === 'string' ? entry : (entry?.line || '')));
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      origin: location.origin,
      updatedAt: new Date().toISOString(),
      lines
    };
    try { localStorage.setItem(LOG_PERSIST_KEY, JSON.stringify(payload)); } catch {}
    try { GM_setValue(LOG_PERSIST_KEY, payload); } catch {}
  }

  function checkLogClearRequest() {
    if (state.destroyed) return;
    let req = null;
    try { req = JSON.parse(localStorage.getItem(LOG_CLEAR_SIGNAL_KEY) || 'null'); } catch {}
    if (!req) { try { req = GM_getValue(LOG_CLEAR_SIGNAL_KEY, null); } catch {} }
    const at = typeof req?.requestedAt === 'string' ? req.requestedAt : '';
    if (!at || at === _lastLogClearHandledAt) return;
    _lastLogClearHandledAt = at;
    state.logLines.length = 0;
    _lastLogPersistAt = 0;
    if (state.ui?.logs) state.ui.logs.innerHTML = '';
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
      const left = startLeft + (e.clientX - startX);
      const top = startTop + (e.clientY - startY);
      panel.style.left = `${Math.max(0, left)}px`;
      panel.style.top = `${Math.max(0, top)}px`;
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      savePanelPos({
        left: panel.style.left,
        top: panel.style.top
      });
    }
  }

  function savePanelPos(pos) {
    try {
      localStorage.setItem(KEYS.panelPos, JSON.stringify(pos));
    } catch {}
  }

  function loadPanelPos() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.panelPos) || 'null');
    } catch {
      return null;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
