// ==UserScript==
// @name         14 AUTO AgencyZoom Pipeline Keeper
// @namespace    autoflow.az-pipeline-keeper
// @version      1.0.2
// @description  AUTO-profile helper that keeps one exact AgencyZoom pipeline tab alive, closes extra AgencyZoom tabs when a leader exists, redirects stray AgencyZoom pages back to pipeline, and sweeps stale Zillow tabs on a 3-minute cleanup pulse.
// @match        https://app.agencyzoom.com/*
// @match        https://www.zillow.com/*
// @match        https://zillow.com/*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-end
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-pipeline-keeper/az-pipeline-keeper.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-pipeline-keeper/az-pipeline-keeper.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_PIPELINE_KEEPER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = '14 AUTO AgencyZoom Pipeline Keeper';
  const VERSION = '1.0.2';
  const PIPELINE_ROOT_URL = 'https://app.agencyzoom.com/referral/pipeline';
  const SHARED_TAB_ID_KEY = 'tm_auto_shared_tab_id_v1';

  const GM_KEYS = {
    leader: 'tm_az_pipeline_keeper_leader_v1',
    cleanupPulse: 'tm_az_pipeline_keeper_cleanup_pulse_v1',
    pipelineOpenLease: 'tm_az_pipeline_keeper_pipeline_open_lease_v1'
  };

  const LS_KEYS = {
    azTabSlot: 'tm_auto_single_agencyzoom_tab_slot_v1',
    zillowTabSlot: 'tm_auto_single_zillow_tab_slot_v1'
  };

  const CFG = {
    tickMs: 1000,
    redirectDelayMs: 600,
    leaderHeartbeatMs: 5000,
    leaderStaleMs: 20000,
    cleanupEveryMs: 3 * 60 * 1000,
    cleanupPulseTtlMs: 30000,
    pageSlotTtlMs: 12000,
    pipelineOpenCooldownMs: 12 * 60 * 60 * 1000,
    minZillowTabAgeBeforeSweepMs: 90 * 1000,
    closeRetryMs: 1200,
    maxCloseAttempts: 6
  };

  const state = {
    destroyed: false,
    tabId: getSharedTabId(),
    startedAt: Date.now(),
    tickTimer: 0,
    cleanupPulseListener: null,
    lastLeaderHeartbeatAt: 0,
    lastHandledCleanupToken: '',
    redirectTimer: 0,
    closeRetryTimer: 0,
    closeAttempts: 0,
    closeToken: '',
    lastRoleLogged: '',
    lastMissingLeaderLogAt: 0
  };

  init();

  function init() {
    window.__AZ_PIPELINE_KEEPER_CLEANUP__ = cleanup;
    setupCleanupPulseListener();
    runTick();
    state.tickTimer = window.setInterval(runTick, CFG.tickMs);
  }

  function cleanup() {
    state.destroyed = true;
    try {
      if (state.tickTimer) clearInterval(state.tickTimer);
    } catch {}
    state.tickTimer = 0;
    try {
      if (state.redirectTimer) clearTimeout(state.redirectTimer);
    } catch {}
    state.redirectTimer = 0;
    try {
      if (state.closeRetryTimer) clearTimeout(state.closeRetryTimer);
    } catch {}
    state.closeRetryTimer = 0;
    try {
      if (state.cleanupPulseListener && typeof GM_removeValueChangeListener === 'function') {
        GM_removeValueChangeListener(state.cleanupPulseListener);
      }
    } catch {}
    state.cleanupPulseListener = null;
  }

  function log(message) {
    try {
      console.log(`[${SCRIPT_NAME} ${VERSION}] ${message}`);
    } catch {}
  }

  function isAgencyZoomOrigin() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(String(location.host || ''));
  }

  function isAgencyZoomLoginPage() {
    return isAgencyZoomOrigin() && /^\/login(?:\/|$)/i.test(String(location.pathname || ''));
  }

  function isZillowOrigin() {
    return /(^|\.)zillow\.com$/i.test(String(location.host || ''));
  }

  function isPipelinePath() {
    return /^\/referral\/pipeline\/?$/i.test(String(location.pathname || ''));
  }

  function isExactPipelinePage() {
    if (!isAgencyZoomOrigin()) return false;
    return location.origin === 'https://app.agencyzoom.com'
      && location.pathname === '/referral/pipeline'
      && !location.search
      && !location.hash;
  }

  function getTabAgeMs() {
    return Math.max(0, Date.now() - state.startedAt);
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

  function clearPipelineOpenLease() {
    writeGM(GM_KEYS.pipelineOpenLease, {
      tabId: '',
      ts: 0,
      url: ''
    });
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

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
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

  function getPageSlotKey() {
    if (isAgencyZoomOrigin()) return LS_KEYS.azTabSlot;
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
      const kind = isAgencyZoomOrigin() ? 'AgencyZoom' : 'Zillow';
      maybeLogRole(`${kind} tab slot already owned by another tab; suppressing this copy`);
      scheduleCloseSelf(`${kind.toLowerCase()}-slot-${currentTabId}`);
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

  function getLeader() {
    const value = readGM(GM_KEYS.leader, null);
    return isPlainObject(value) ? value : null;
  }

  function isFreshLeader(value) {
    if (!isPlainObject(value)) return false;
    const ts = Number(value.ts || 0);
    return ts > 0 && (Date.now() - ts) <= CFG.leaderStaleMs;
  }

  function isLeaderSelf(value = null) {
    const leader = isPlainObject(value) ? value : getLeader();
    return isPlainObject(leader) && String(leader.tabId || '') === state.tabId;
  }

  function normalizePipelineUrlIfNeeded() {
    if (!isAgencyZoomOrigin() || !isPipelinePath() || isExactPipelinePage()) return;
    try {
      history.replaceState(null, '', PIPELINE_ROOT_URL);
    } catch {
      try {
        location.replace(PIPELINE_ROOT_URL);
      } catch {}
    }
  }

  function setupCleanupPulseListener() {
    if (typeof GM_addValueChangeListener !== 'function') return;
    try {
      state.cleanupPulseListener = GM_addValueChangeListener(GM_KEYS.cleanupPulse, (name, oldValue, newValue) => {
        void name;
        void oldValue;
        handleCleanupPulse(newValue);
      });
    } catch {
      state.cleanupPulseListener = null;
    }
  }

  function runTick() {
    if (state.destroyed) return;
    if (isAgencyZoomLoginPage()) return;
    if (!claimSingletonPageSlot()) return;

    normalizePipelineUrlIfNeeded();
    handleCleanupPulse(readGM(GM_KEYS.cleanupPulse, null));

    if (isExactPipelinePage()) {
      handlePipelineTick();
      return;
    }

    if (isAgencyZoomOrigin()) {
      handleAgencyZoomRecoveryTick();
      return;
    }

    if (isZillowOrigin()) {
      handleZillowTick();
    }
  }

  function handlePipelineTick() {
    const leader = getLeader();

    if (isFreshLeader(leader) && !isLeaderSelf(leader)) {
      maybeLogRole('Duplicate AgencyZoom pipeline tab detected; attempting to close this copy');
      scheduleCloseSelf(`pipeline-duplicate-${String(leader.tabId || 'other')}`);
      return;
    }

    maybeRefreshLeaderHeartbeat();

    const activeLeader = getLeader();
    if (!isLeaderSelf(activeLeader)) return;

    const pulse = readGM(GM_KEYS.cleanupPulse, null);
    const lastPulseAt = isPlainObject(pulse) ? Number(pulse.ts || 0) : 0;
    if ((Date.now() - lastPulseAt) >= CFG.cleanupEveryMs) {
      broadcastCleanupPulse();
    }
  }

  function handleAgencyZoomRecoveryTick() {
    const leader = getLeader();
    if (isFreshLeader(leader) && !isLeaderSelf(leader)) {
      maybeLogRole('Extra AgencyZoom tab detected while pipeline leader exists; attempting to close this tab');
      scheduleCloseSelf(`agencyzoom-follower-${String(leader.tabId || 'other')}`);
      return;
    }

    maybeLogRole('AgencyZoom stray page detected; sending this tab back to the pipeline');
    scheduleRedirectToPipeline();
  }

  function handleZillowTick() {
    const leader = getLeader();
    if (isFreshLeader(leader)) {
      clearPipelineOpenLease();
      maybeLogRole('Zillow helper tab waiting for the next cleanup pulse');
      return;
    }

    const now = Date.now();
    if ((now - state.lastMissingLeaderLogAt) >= 15000) {
      state.lastMissingLeaderLogAt = now;
      log('No fresh pipeline tab heartbeat found from Zillow; opening the pipeline root');
    }
    maybeOpenPipelineTab();
  }

  function maybeRefreshLeaderHeartbeat() {
    const now = Date.now();
    const leader = getLeader();
    if (isLeaderSelf(leader) && (now - state.lastLeaderHeartbeatAt) < CFG.leaderHeartbeatMs) return;
    state.lastLeaderHeartbeatAt = now;
    writeGM(GM_KEYS.leader, {
      tabId: state.tabId,
      ts: now,
      url: PIPELINE_ROOT_URL
    });
    clearPipelineOpenLease();
    maybeLogRole('This tab is the active pipeline keeper');
  }

  function broadcastCleanupPulse() {
    const pulse = {
      token: `pulse_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      leaderTabId: state.tabId,
      pipelineUrl: PIPELINE_ROOT_URL
    };
    state.lastHandledCleanupToken = String(pulse.token || '');
    writeGM(GM_KEYS.cleanupPulse, pulse);
    try { window.focus(); } catch {}
    log('Broadcasted 3-minute cleanup pulse');
  }

  function handleCleanupPulse(rawPulse) {
    if (!isPlainObject(rawPulse)) return;

    const token = String(rawPulse.token || '');
    const ts = Number(rawPulse.ts || 0);
    if (!token || !ts) return;
    if (token === state.lastHandledCleanupToken) return;
    if (ts < state.startedAt) return;
    if ((Date.now() - ts) > CFG.cleanupPulseTtlMs) return;

    state.lastHandledCleanupToken = token;

    const leader = getLeader();
    if (isAgencyZoomOrigin()) {
      if (isFreshLeader(leader) && !isLeaderSelf(leader)) {
        if (isExactPipelinePage()) {
          log('Duplicate pipeline tab received cleanup pulse; attempting to close this copy');
        } else {
          log('Extra AgencyZoom tab received cleanup pulse while pipeline leader exists; attempting to close this tab');
        }
        scheduleCloseSelf(token);
        return;
      }

      if (!isExactPipelinePage()) {
        log('AgencyZoom non-pipeline page received cleanup pulse; redirecting back to the exact pipeline page');
        scheduleRedirectToPipeline();
      }
      return;
    }

    if (!isZillowOrigin()) return;
    if (getTabAgeMs() < CFG.minZillowTabAgeBeforeSweepMs) return;

    log('Zillow tab received cleanup pulse; attempting to close this tab');
    scheduleCloseSelf(token);
  }

  function scheduleRedirectToPipeline() {
    if (state.redirectTimer || state.destroyed) return;
    state.redirectTimer = window.setTimeout(() => {
      state.redirectTimer = 0;
      if (state.destroyed || isExactPipelinePage()) return;
      try {
        location.replace(PIPELINE_ROOT_URL);
        return;
      } catch {}
      try { location.href = PIPELINE_ROOT_URL; } catch {}
    }, CFG.redirectDelayMs);
  }

  function maybeOpenPipelineTab() {
    const now = Date.now();
    const lease = readGM(GM_KEYS.pipelineOpenLease, null);
    const leaseTs = isPlainObject(lease) ? Number(lease.ts || 0) : 0;
    if (leaseTs && (now - leaseTs) < CFG.pipelineOpenCooldownMs) return false;

    writeGM(GM_KEYS.pipelineOpenLease, {
      tabId: state.tabId,
      ts: now,
      url: PIPELINE_ROOT_URL
    });

    try {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(PIPELINE_ROOT_URL, { active: true, insert: true, setParent: true });
        return true;
      }
    } catch {}

    try {
      const opened = window.open(PIPELINE_ROOT_URL, '_blank', 'noopener');
      return !!opened;
    } catch {
      return false;
    }
  }

  function scheduleCloseSelf(token) {
    if (state.destroyed) return;
    if (state.closeToken === token && (state.closeRetryTimer || state.closeAttempts > 0)) return;
    state.closeToken = token;
    state.closeAttempts = 0;
    try {
      if (state.closeRetryTimer) clearTimeout(state.closeRetryTimer);
    } catch {}
    state.closeRetryTimer = 0;
    attemptCloseSelf();
  }

  function attemptCloseSelf() {
    if (state.destroyed) return;
    state.closeAttempts += 1;
    try { window.close(); } catch {}
    try { window.open('', '_self'); } catch {}
    try { window.close(); } catch {}

    if (state.closeAttempts >= CFG.maxCloseAttempts) return;
    state.closeRetryTimer = window.setTimeout(attemptCloseSelf, CFG.closeRetryMs);
  }

  function maybeLogRole(message) {
    if (state.lastRoleLogged === message) return;
    state.lastRoleLogged = message;
    log(message);
  }
})();

