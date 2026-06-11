// ==UserScript==
// @name         Cross-Origin UI Dock Organizer
// @namespace    homebot.ui-dock-organizer
// @version      1.7.6
// @description  Organizes floating UIs safely inside the viewport. Biggest panel anchors bottom-right, others stack to the left within the anchor height, then continue upward on the right. Includes active-script highlighting for opted-in panels.
// @author       OpenAI
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/ui-dock-organizer/ui-dock-organizer.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/ui-dock-organizer/ui-dock-organizer.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  try { window.__HB_UI_DOCK_ORGANIZER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Cross-Origin UI Dock Organizer';
  const VERSION = '1.7.6';

  // Log-export integration — 3-origin dynamic key.
  const LOG_PERSIST_KEY = (() => {
    const host = String(location.host || '');
    if (host.includes('agencyzoom.com')) return 'tm_az_ui_dock_organizer_logs_v1';
    if (host.includes('lightning.force.com')) return 'tm_apex_ui_dock_organizer_logs_v1';
    return 'tm_pc_ui_dock_organizer_logs_v1';
  })();
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';
  const SCRIPT_ACTIVITY_KEY = 'tm_ui_script_activity_v1';

  const CFG = {
    tickMs: 900,
    rescanMs: 2200,

    sideGap: 12,
    rightGap: 12,
    bottomGap: 12,
    topGap: 12,
    itemGap: 8,

    minZIndex: 900000,
    maxWidthRatio: 0.82,
    maxHeightRatio: 0.90,
    maxAreaRatio: 0.40,

    maxLogs: 12,
    uiZ: 2147483647,
    posKey: 'tm_ui_dock_organizer_panel_pos_v13',
    logsOpenKey: 'tm_ui_dock_organizer_logs_open_v13',
    hiddenKey: 'tm_ui_dock_organizer_hidden_v14',
    activeStaleMs: 6000
  };

  const UI = {
    panelId: 'hb-ui-dock-organizer-panel-v13',
    headId: 'hb-ui-dock-organizer-head-v13',
    statusId: 'hb-ui-dock-organizer-status-v13',
    countId: 'hb-ui-dock-organizer-count-v13',
    toggleId: 'hb-ui-dock-organizer-toggle-v13',
    hideId: 'hb-ui-dock-organizer-hide-v14',
    rescanId: 'hb-ui-dock-organizer-rescan-v13',
    logsBtnId: 'hb-ui-dock-organizer-logs-btn-v13',
    runtimeId: 'hb-ui-dock-organizer-runtime-v15',
    logsWrapId: 'hb-ui-dock-organizer-logs-wrap-v13',
    logsId: 'hb-ui-dock-organizer-logs-v13',
    styleId: 'hb-ui-dock-organizer-style-v13'
  };

  const ORIGIN_SCRIPT_ORDER = {
    agencyzoom: [
      'shared-ticket-handoff',
      'az-stage-runner',
      'az-ticket-finisher-tagger'
    ],
    policycenter: [
      'shared-ticket-handoff',
      'home-quote-grabber',
      'dwelling-water-rule',
      'webhook-submission'
    ],
    apex: []
  };

  const SCRIPT_PANEL_MAP = {
    'hb-dwelling-water-rule-panel': 'dwelling-water-rule'
  };

  const state = {
    running: true,
    logs: [],
    registry: new Map(), // el -> { order }
    orderSeed: 1,
    tickTimer: null,
    logsIntervalTimer: null,
    mo: null,
    drag: null,
    lastRescanAt: 0,
    lastDockedCount: -1,
    uiHidden: false,
    activePanels: 0,
    runtimeCount: 0
  };

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getOriginBucket() {
    const host = String(location.hostname || '').toLowerCase();
    if (host.includes('agencyzoom.com')) return 'agencyzoom';
    if (host.includes('lightning.force.com')) return 'apex';
    return 'policycenter';
  }

  function isTerminalActivityState(nextState) {
    return ['done', 'error', 'stopped'].includes(nextState);
  }

  function normalizeActivityState(nextState) {
    const stateName = normalizeText(nextState).toLowerCase();
    if (stateName === 'active') return 'working';
    return stateName || 'idle';
  }

  function isFreshActivityEntry(entry) {
    const updatedAtMs = Date.parse(entry?.updatedAt || '');
    if (!Number.isFinite(updatedAtMs)) return false;
    return (Date.now() - updatedAtMs) <= CFG.activeStaleMs;
  }

  function getStateRank(stateName) {
    switch (stateName) {
      case 'working': return 0;
      case 'error': return 1;
      case 'waiting': return 2;
      case 'paused': return 3;
      case 'idle': return 4;
      case 'done': return 5;
      case 'stopped': return 6;
      case 'stale': return 7;
      default: return 8;
    }
  }

  function getStateTone(stateName) {
    switch (stateName) {
      case 'working': return 'background:#14532d;color:#dcfce7;border-color:rgba(74,222,128,.35);';
      case 'error': return 'background:#7f1d1d;color:#fee2e2;border-color:rgba(248,113,113,.35);';
      case 'waiting': return 'background:#1e3a8a;color:#dbeafe;border-color:rgba(96,165,250,.35);';
      case 'paused': return 'background:#78350f;color:#fef3c7;border-color:rgba(251,191,36,.35);';
      case 'done': return 'background:#064e3b;color:#ccfbf1;border-color:rgba(45,212,191,.35);';
      case 'stopped': return 'background:#374151;color:#e5e7eb;border-color:rgba(156,163,175,.35);';
      case 'stale': return 'background:#111827;color:#cbd5e1;border-color:rgba(148,163,184,.28);';
      default: return 'background:#1f2937;color:#e5e7eb;border-color:rgba(148,163,184,.28);';
    }
  }

  function formatAge(ageMs) {
    if (!Number.isFinite(ageMs) || ageMs < 0) return 'n/a';
    const seconds = Math.max(0, Math.floor(ageMs / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  }

  function cleanup() {
    try { state.mo?.disconnect(); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { window.removeEventListener('resize', onResize, true); } catch {}
    try { window.removeEventListener('mousemove', onDragMove, true); } catch {}
    try { window.removeEventListener('mouseup', onDragEnd, true); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    try { document.getElementById(UI.panelId)?.remove(); } catch {}
    try { document.getElementById(UI.styleId)?.remove(); } catch {}
  }

  window.__HB_UI_DOCK_ORGANIZER_CLEANUP__ = cleanup;

  init();

  function init() {
    state.uiHidden = loadHiddenMode();
    injectStyle();
    buildUI();
    bindUI();
    startObserver();

    window.addEventListener('resize', onResize, true);

    log('Organizer loaded');
    log('Viewport clamp enabled');
    log(isAgencyZoomOrigin() ? 'Organizer anchored by AgencyZoom profile link' : 'Organizer locked bottom-left');

    fullScanAndArrange();
    state.tickTimer = setInterval(tick, CFG.tickMs);
    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();
  }

  function tick() {
    if (!state.running) return;
    if (state.uiHidden) {
      applyHiddenMode();
      updateUI();
      return;
    }

    const now = Date.now();
    if (now - state.lastRescanAt >= CFG.rescanMs) {
      fullScanAndArrange();
    } else {
      arrangeDock();
    }
  }

  function onResize() {
    enforceOrganizerAnchor();
    if (!state.running) return;
    setTimeout(() => {
      if (!state.running) return;
      fullScanAndArrange();
    }, 80);
  }

  function startObserver() {
    const root = document.documentElement || document.body;
    if (!root) return;

    let queued = false;

    state.mo = new MutationObserver((mutations) => {
      if (!state.running) return;

      let shouldQueue = false;

      for (const m of mutations) {
        const targetEl = m.target instanceof Element ? m.target : null;
        if (targetEl && targetEl.closest(`#${UI.panelId}`)) continue;

        let allAddedInsideSelf = true;
        for (const n of m.addedNodes || []) {
          if (!(n instanceof Element) || !n.closest?.(`#${UI.panelId}`)) {
            allAddedInsideSelf = false;
            break;
          }
        }

        let allRemovedInsideSelf = true;
        for (const n of m.removedNodes || []) {
          if (!(n instanceof Element)) {
            allRemovedInsideSelf = false;
            break;
          }
        }

        if (!allAddedInsideSelf || !allRemovedInsideSelf) {
          shouldQueue = true;
          break;
        }
      }

      if (!shouldQueue || queued) return;
      queued = true;

      setTimeout(() => {
        queued = false;
        if (!state.running) return;
        fullScanAndArrange();
      }, 120);
    });

    state.mo.observe(root, {
      childList: true,
      subtree: true
    });
  }

  function fullScanAndArrange() {
    state.lastRescanAt = Date.now();
    scanCandidates();
    arrangeDock();
  }

  function scanCandidates() {
    const seen = new Set();
    const nodes = getTopLevelNodes();

    for (const el of nodes) {
      if (!isDockCandidate(el)) continue;
      seen.add(el);

      if (!state.registry.has(el)) {
        state.registry.set(el, {
          order: state.orderSeed++,
          scriptId: detectScriptId(el)
        });
      } else {
        const meta = state.registry.get(el);
        meta.scriptId = detectScriptId(el);
      }
    }

    for (const el of Array.from(state.registry.keys())) {
      if (!el || !el.isConnected || !seen.has(el) || !isDockCandidate(el)) {
        restoreHiddenElement(el);
        state.registry.delete(el);
      }
    }

    updateUI();
  }

  function getTopLevelNodes() {
    const set = new Set();

    try {
      for (const el of Array.from(document.body?.children || [])) set.add(el);
    } catch {}

    try {
      for (const el of Array.from(document.documentElement?.children || [])) {
        if (el !== document.body && el !== document.head) set.add(el);
      }
    } catch {}

    return Array.from(set);
  }

  function getStyle(el) {
    try { return getComputedStyle(el); } catch { return null; }
  }

  function isVisible(el, cs = null) {
    const style = cs || getStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return !!rect && rect.width > 0 && rect.height > 0;
  }

  function getMarkerText(el) {
    return [
      el.id || '',
      typeof el.className === 'string' ? el.className : '',
      el.getAttribute?.('aria-label') || '',
      (el.textContent || '').slice(0, 260)
    ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isDockCandidate(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (!el.isConnected) return false;
    if (isOrganizerPanel(el)) return false;

    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') return false;

    const cs = getStyle(el);
    if (!cs) return false;

    const pos = cs.position;
    if (pos !== 'fixed' && pos !== 'absolute') return false;
    if (!isVisible(el, cs)) return false;

    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;

    const vw = Math.max(window.innerWidth || 1, 1);
    const vh = Math.max(window.innerHeight || 1, 1);
    const areaRatio = (rect.width * rect.height) / (vw * vh);

    if (rect.width > vw * CFG.maxWidthRatio) return false;
    if (rect.height > vh * CFG.maxHeightRatio) return false;
    if (areaRatio > CFG.maxAreaRatio) return false;

    const z = parseInt(cs.zIndex, 10);
    const marker = getMarkerText(el);

    const hasBigZ = Number.isFinite(z) && z >= CFG.minZIndex;
    const hasMarker =
      /(^|[^a-z])(hb|tm|aqb|home bot|guidewire|apex|vin|cnq|dup|az-ha)([^a-z]|$)/i.test(marker) ||
      /aqb:\s*(start|stop)/i.test(marker) ||
      /home bot/i.test(marker);

    if (!hasBigZ && !hasMarker) return false;

    if (/(toast|tooltip|modal|backdrop|overlay|spinner|loading|dropdown|listbox|menu|popover|dialog|autocomplete|suggestion)/i.test(marker)) {
      return false;
    }

    const hasControls = !!el.querySelector('button, input, textarea, select, [role="button"]');
    const shortText = (el.textContent || '').replace(/\s+/g, ' ').trim();

    if (hasMarker) return true;
    if (hasBigZ && hasControls) return true;
    if (hasBigZ && el.matches('button, [role="button"]')) return true;
    if (hasBigZ && shortText.length > 0 && shortText.length < 220) return true;

    return false;
  }

  function getDockItems() {
    const items = [];

    for (const [el, meta] of state.registry.entries()) {
      if (!el || !el.isConnected || !isDockCandidate(el)) continue;

      const rect = el.getBoundingClientRect();

      items.push({
        el,
        scriptId: meta.scriptId || '',
        order: meta.order,
        width: Math.max(1, Math.ceil(rect.width)),
        height: Math.max(1, Math.ceil(rect.height)),
        area: Math.max(1, Math.ceil(rect.width * rect.height))
      });
    }

    return items;
  }

  function sortBiggestFirst(a, b) {
    if (b.height !== a.height) return b.height - a.height;
    if (b.area !== a.area) return b.area - a.area;
    if (b.width !== a.width) return b.width - a.width;
    return a.order - b.order;
  }

  function arrangeDock() {
    const items = getDockItems().sort(sortBiggestFirst);

    if (items.length !== state.lastDockedCount) {
      state.lastDockedCount = items.length;
      log(`Docked UI count: ${items.length}`);
    }

    if (!items.length) {
      state.activePanels = 0;
      updateUI();
      return;
    }
    if (state.uiHidden) {
      state.activePanels = 0;
      updateUI();
      applyHiddenMode();
      return;
    }

    applyActiveHighlights(items);
    updateUI();

    const placements = buildPlacements(items);

    for (const p of placements) {
      applyPlacement(p);
    }

    requestAnimationFrame(() => {
      for (const item of items) {
        clampElementIntoViewport(item.el);
      }
    });
  }

  function buildPlacements(items) {
    const remaining = items.slice();
    const placements = [];

    const viewportW = Math.max(window.innerWidth || 1, 1);
    const viewportH = Math.max(window.innerHeight || 1, 1);
    const usableWidth = Math.max(80, viewportW - (CFG.rightGap * 2));

    let bandBottom = CFG.bottomGap;

    while (remaining.length) {
      const verticalRoom = viewportH - CFG.topGap - bandBottom;
      if (verticalRoom <= 24) break;

      const anchorIndex = remaining.findIndex(item => item.height <= verticalRoom);
      if (anchorIndex < 0) break;

      const anchor = remaining.splice(anchorIndex, 1)[0];
      const bandHeight = anchor.height;

      const columns = [
        {
          items: [anchor],
          width: anchor.width,
          usedHeight: anchor.height
        }
      ];

      let usedWidth = anchor.width;

      while (remaining.length) {
        const draft = buildBestColumn(remaining, bandHeight);
        if (!draft) break;

        const proposedWidth = usedWidth + CFG.itemGap + draft.column.width;
        if (proposedWidth > usableWidth) break;

        columns.push(draft.column);
        usedWidth = proposedWidth;

        for (const idx of draft.indices.sort((a, b) => b - a)) {
          remaining.splice(idx, 1);
        }
      }

      let currentRight = CFG.rightGap;

      for (const col of columns) {
        let currentBottom = bandBottom;

        for (const item of col.items) {
          placements.push({
            el: item.el,
            right: currentRight,
            bottom: currentBottom
          });

          currentBottom += item.height + CFG.itemGap;
        }

        currentRight += col.width + CFG.itemGap;
      }

      bandBottom += bandHeight + CFG.itemGap;
    }

    return placements;
  }

  function buildBestColumn(items, bandHeight) {
    const candidates = items
      .map((item, index) => ({ item, index }))
      .filter(x => x.item.height <= bandHeight)
      .sort((a, b) => sortBiggestFirst(a.item, b.item));

    if (!candidates.length) return null;

    const pickedItems = [];
    const pickedIndices = [];
    let usedHeight = 0;
    let colWidth = 0;

    const seed = candidates[0];
    pickedItems.push(seed.item);
    pickedIndices.push(seed.index);
    usedHeight = seed.item.height;
    colWidth = seed.item.width;

    while (true) {
      let bestIndex = -1;
      let bestScore = -1;

      for (let i = 0; i < items.length; i++) {
        if (pickedIndices.includes(i)) continue;

        const item = items[i];
        const nextHeight = usedHeight + CFG.itemGap + item.height;
        if (nextHeight > bandHeight) continue;

        const score = (item.height * 1000000) + item.area;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      if (bestIndex < 0) break;

      const item = items[bestIndex];
      pickedItems.push(item);
      pickedIndices.push(bestIndex);
      usedHeight += CFG.itemGap + item.height;
      colWidth = Math.max(colWidth, item.width);
    }

    return {
      column: {
        items: pickedItems,
        width: colWidth,
        usedHeight
      },
      indices: pickedIndices
    };
  }

  function applyPlacement(p) {
    const el = p.el;
    if (!el || !el.isConnected) return;

    try {
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('left', 'auto', 'important');
      el.style.setProperty('top', 'auto', 'important');
      el.style.setProperty('right', `${Math.max(0, Math.round(p.right))}px`, 'important');
      el.style.setProperty('bottom', `${Math.max(0, Math.round(p.bottom))}px`, 'important');
      el.style.setProperty('transform', 'none', 'important');
      el.style.setProperty('margin', '0', 'important');
    } catch {}
  }

  function isOrganizerPanel(el) {
    return !!(el && el.id === UI.panelId);
  }

  function hideElement(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected || isOrganizerPanel(el)) return;
    if (!Object.prototype.hasOwnProperty.call(el.dataset, 'hbUiDockPrevOpacity')) {
      el.dataset.hbUiDockPrevOpacity = el.style.opacity || '';
    }
    if (!Object.prototype.hasOwnProperty.call(el.dataset, 'hbUiDockPrevPointerEvents')) {
      el.dataset.hbUiDockPrevPointerEvents = el.style.pointerEvents || '';
    }
    el.style.setProperty('opacity', '0.01', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
  }

  function restoreHiddenElement(el) {
    if (!(el instanceof HTMLElement)) return;
    if (Object.prototype.hasOwnProperty.call(el.dataset, 'hbUiDockPrevOpacity')) {
      if (el.dataset.hbUiDockPrevOpacity) el.style.opacity = el.dataset.hbUiDockPrevOpacity;
      else el.style.removeProperty('opacity');
      delete el.dataset.hbUiDockPrevOpacity;
    }
    if (Object.prototype.hasOwnProperty.call(el.dataset, 'hbUiDockPrevPointerEvents')) {
      if (el.dataset.hbUiDockPrevPointerEvents) el.style.pointerEvents = el.dataset.hbUiDockPrevPointerEvents;
      else el.style.removeProperty('pointer-events');
      delete el.dataset.hbUiDockPrevPointerEvents;
    }
    el.classList.remove('hb-ui-dock-active-script');
  }

  function applyHiddenMode() {
    for (const el of state.registry.keys()) {
      if (state.uiHidden) hideElement(el);
      else restoreHiddenElement(el);
    }
  }

  function getOrganizerPanel() {
    return document.getElementById(UI.panelId);
  }

  function isAgencyZoomOrigin() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function getAgencyZoomProfileAnchor() {
    const candidates = Array.from(document.querySelectorAll('a'));
    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue;
      const nameEl = el.querySelector('em');
      const iconEl = el.querySelector('i.fal.fa-user-circle, i.fa-user-circle');
      if (!nameEl || !iconEl) continue;
      if (!isVisible(el)) continue;
      return el;
    }
    return null;
  }

  function enforceOrganizerAnchor() {
    const panel = getOrganizerPanel();
    if (!panel) return;
    if (isAgencyZoomOrigin()) {
      const profileAnchor = getAgencyZoomProfileAnchor();
      if (profileAnchor) {
        const rect = profileAnchor.getBoundingClientRect();
        const panelWidth = Math.max(1, panel.offsetWidth || 300);
        const panelHeight = Math.max(1, panel.offsetHeight || 180);
        const maxLeft = Math.max(CFG.sideGap, window.innerWidth - panelWidth - CFG.sideGap);
        const maxTop = Math.max(CFG.topGap, window.innerHeight - panelHeight - CFG.bottomGap);
        const left = clamp(Math.round(rect.right + CFG.itemGap), CFG.sideGap, maxLeft);
        const top = clamp(Math.round(rect.top), CFG.topGap, maxTop);
        try {
          panel.style.setProperty('position', 'fixed', 'important');
          panel.style.setProperty('left', `${left}px`, 'important');
          panel.style.setProperty('top', `${top}px`, 'important');
          panel.style.setProperty('right', 'auto', 'important');
          panel.style.setProperty('bottom', 'auto', 'important');
          panel.style.setProperty('transform', 'none', 'important');
          panel.style.setProperty('margin', '0', 'important');
        } catch {}
        return;
      }
    }
    try {
      panel.style.setProperty('position', 'fixed', 'important');
      panel.style.setProperty('left', `${CFG.sideGap}px`, 'important');
      panel.style.setProperty('right', 'auto', 'important');
      panel.style.setProperty('top', 'auto', 'important');
      panel.style.setProperty('bottom', `${CFG.bottomGap}px`, 'important');
      panel.style.setProperty('transform', 'none', 'important');
      panel.style.setProperty('margin', '0', 'important');
    } catch {}
  }

  function detectScriptId(el) {
    if (!(el instanceof HTMLElement)) return '';
    const explicit = normalizeText(
      el.getAttribute('data-hb-script-id') ||
      el.dataset?.hbScriptId ||
      el.querySelector?.('[data-hb-script-id]')?.getAttribute('data-hb-script-id') ||
      ''
    );
    if (explicit) return explicit;
    if (el.id && SCRIPT_PANEL_MAP[el.id]) return SCRIPT_PANEL_MAP[el.id];
    return '';
  }

  function readScriptActivityMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SCRIPT_ACTIVITY_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function isScriptActive(scriptId, activityMap) {
    if (!scriptId) return false;
    const entry = activityMap?.[scriptId];
    if (!entry) return false;
    if (normalizeActivityState(entry.state) !== 'working') return false;
    return isFreshActivityEntry(entry);
  }

  function buildRuntimeEntries(activityMap) {
    const bucket = getOriginBucket();
    const orderedIds = ORIGIN_SCRIPT_ORDER[bucket] || [];
    const orderedIndex = new Map(orderedIds.map((id, index) => [id, index]));
    const entries = Object.values(activityMap || {})
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => {
        const rawState = normalizeActivityState(entry.state);
        const updatedAtMs = Date.parse(entry.updatedAt || '');
        const stale = !isTerminalActivityState(rawState) && (!Number.isFinite(updatedAtMs) || (Date.now() - updatedAtMs) > CFG.activeStaleMs);
        return {
          scriptId: normalizeText(entry.scriptId || ''),
          scriptName: normalizeText(entry.scriptName || entry.source || entry.scriptId || 'Unknown script'),
          state: stale ? 'stale' : rawState,
          rawState,
          message: normalizeText(entry.message || ''),
          azId: normalizeText(entry.azId || ''),
          ageMs: Number.isFinite(updatedAtMs) ? (Date.now() - updatedAtMs) : Infinity
        };
      })
      .filter((entry) => entry.scriptId);

    entries.sort((a, b) => {
      const aRank = getStateRank(a.state);
      const bRank = getStateRank(b.state);
      if (aRank !== bRank) return aRank - bRank;

      const aOrder = orderedIndex.has(a.scriptId) ? orderedIndex.get(a.scriptId) : 999;
      const bOrder = orderedIndex.has(b.scriptId) ? orderedIndex.get(b.scriptId) : 999;
      if (aOrder !== bOrder) return aOrder - bOrder;

      if (a.ageMs !== b.ageMs) return a.ageMs - b.ageMs;
      return a.scriptName.localeCompare(b.scriptName);
    });

    return entries;
  }

  function applyActiveHighlights(items) {
    const activityMap = readScriptActivityMap();
    let activePanels = 0;

    for (const item of items) {
      const isActive = isScriptActive(item.scriptId, activityMap);
      item.el.classList.toggle('hb-ui-dock-active-script', isActive);
      if (isActive) activePanels++;
    }

    state.activePanels = activePanels;
  }

  function renderRuntimeList(entries) {
    const runtime = document.getElementById(UI.runtimeId);
    if (!runtime) return;

    if (!entries.length) {
      runtime.innerHTML = '<div class="runtime-empty">No runtime publishers yet</div>';
      return;
    }

    runtime.innerHTML = entries.map((entry) => {
      const detailBits = [];
      if (entry.azId) detailBits.push(`AZ ${escapeHtml(entry.azId)}`);
      detailBits.push(`age ${escapeHtml(formatAge(entry.ageMs))}`);
      const detailLine = detailBits.join(' | ');
      const message = entry.message || 'No message';

      return `
        <div class="runtime-row" data-script-id="${escapeHtml(entry.scriptId)}">
          <div class="runtime-badge" style="${getStateTone(entry.state)}">${escapeHtml(entry.state.toUpperCase())}</div>
          <div class="runtime-meta">
            <div class="runtime-name">${escapeHtml(entry.scriptName)}</div>
            <div class="runtime-msg">${escapeHtml(message)}</div>
            <div class="runtime-age">${escapeHtml(detailLine)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function getOrganizerRect() {
    const panel = getOrganizerPanel();
    if (!panel || !panel.isConnected) return null;
    const rect = panel.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  }

  function clampElementIntoViewport(el) {
    if (!el || !el.isConnected) return;
    if (isOrganizerPanel(el)) {
      enforceOrganizerAnchor();
      return;
    }

    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const vw = Math.max(window.innerWidth || 1, 1);
    const vh = Math.max(window.innerHeight || 1, 1);

    const maxLeft = Math.max(CFG.sideGap, vw - rect.width - CFG.sideGap);
    const maxTop = Math.max(CFG.topGap, vh - rect.height - CFG.bottomGap);

    let nextLeft = clamp(rect.left, CFG.sideGap, maxLeft);
    let nextTop = clamp(rect.top, CFG.topGap, maxTop);

    const organizerRect = getOrganizerRect();
    if (organizerRect) {
      const overlapX = nextLeft < (organizerRect.right + CFG.itemGap) && (nextLeft + rect.width) > organizerRect.left;
      const overlapY = nextTop < (organizerRect.bottom + CFG.itemGap) && (nextTop + rect.height) > organizerRect.top;
      if (overlapX && overlapY) {
        nextLeft = clamp(organizerRect.right + CFG.itemGap, CFG.sideGap, maxLeft);
      }
    }

    try {
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('left', `${Math.round(nextLeft)}px`, 'important');
      el.style.setProperty('top', `${Math.round(nextTop)}px`, 'important');
      el.style.setProperty('right', 'auto', 'important');
      el.style.setProperty('bottom', 'auto', 'important');
      el.style.setProperty('transform', 'none', 'important');
      el.style.setProperty('margin', '0', 'important');
    } catch {}
  }

  function injectStyle() {
    if (document.getElementById(UI.styleId)) return;

    const style = document.createElement('style');
    style.id = UI.styleId;
    style.textContent = `
      #${UI.panelId}{
        position:fixed;
        left:12px;
        bottom:12px;
        width:300px;
        z-index:${CFG.uiZ};
        background:rgba(16,20,27,.96);
        color:#eef3f7;
        border:1px solid rgba(255,255,255,.12);
        border-radius:12px;
        box-shadow:0 8px 22px rgba(0,0,0,.30);
        font:12px/1.35 Arial,sans-serif;
        overflow:hidden;
        user-select:none;
      }
      .hb-ui-dock-active-script{
        background:linear-gradient(180deg, rgba(11,52,34,.96), rgba(16,72,48,.96)) !important;
        border:1px solid rgba(74,222,128,.90) !important;
        box-shadow:0 0 0 1px rgba(74,222,128,.22), 0 10px 26px rgba(22,163,74,.28) !important;
      }
      .hb-ui-dock-active-script [id$="status"],
      .hb-ui-dock-active-script [class*="status"]{
        color:#dcfce7 !important;
      }
      #${UI.panelId} *{ box-sizing:border-box; }
      #${UI.headId}{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        padding:8px 10px;
        background:rgba(255,255,255,.06);
        cursor:move;
      }
      #${UI.panelId} .title{ font-weight:700; }
      #${UI.panelId} .ver{ font-size:11px; opacity:.75; }
      #${UI.panelId} .body{ padding:10px; }
      #${UI.panelId} .row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        margin-bottom:8px;
      }
      #${UI.statusId}{ font-weight:700; }
      #${UI.countId}{ opacity:.85; }
      #${UI.panelId} .btns{
        display:flex;
        gap:8px;
        margin-bottom:8px;
      }
      #${UI.runtimeId}{
        display:grid;
        gap:6px;
        margin-top:8px;
        max-height:200px;
        overflow:auto;
      }
      #${UI.panelId} .runtime-row{
        display:grid;
        grid-template-columns:auto 1fr;
        gap:8px;
        align-items:start;
        padding:7px 8px;
        border-radius:8px;
        background:rgba(255,255,255,.04);
        border:1px solid rgba(255,255,255,.08);
      }
      #${UI.panelId} .runtime-badge{
        border:1px solid rgba(255,255,255,.12);
        border-radius:999px;
        padding:2px 6px;
        font-size:10px;
        font-weight:700;
        letter-spacing:.02em;
        white-space:nowrap;
      }
      #${UI.panelId} .runtime-meta{
        min-width:0;
      }
      #${UI.panelId} .runtime-name{
        font-weight:700;
        margin-bottom:2px;
      }
      #${UI.panelId} .runtime-msg,
      #${UI.panelId} .runtime-age,
      #${UI.panelId} .runtime-empty{
        font-size:11px;
        opacity:.86;
      }
      #${UI.panelId} .runtime-msg,
      #${UI.panelId} .runtime-age{
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      #${UI.panelId} button{
        border:1px solid rgba(255,255,255,.12);
        border-radius:8px;
        padding:6px 10px;
        cursor:pointer;
        color:#fff;
        font-weight:700;
        font-size:12px;
      }
      #${UI.toggleId}.on{ background:#166534; }
      #${UI.toggleId}.off{ background:#991b1b; }
      #${UI.hideId}.on{ background:#7c3aed; }
      #${UI.hideId}.off{ background:#0f766e; }
      #${UI.rescanId}{ background:#1d4ed8; }
      #${UI.logsBtnId}{ background:#374151; }
      #${UI.logsWrapId}{
        display:none;
        margin-top:8px;
        background:rgba(255,255,255,.05);
        border:1px solid rgba(255,255,255,.08);
        border-radius:8px;
        padding:8px;
      }
      #${UI.logsId}{
        max-height:160px;
        overflow:auto;
        white-space:pre-wrap;
        word-break:break-word;
        font-family:Consolas, monospace;
        font-size:11px;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function buildUI() {
    if (document.getElementById(UI.panelId)) return;

    const panel = document.createElement('div');
    panel.id = UI.panelId;
    panel.innerHTML = `
      <div id="${UI.headId}">
        <div>
          <div class="title">${SCRIPT_NAME}</div>
          <div class="ver">V${VERSION}</div>
        </div>
        <div>Dock</div>
      </div>
      <div class="body">
        <div class="row">
          <div id="${UI.statusId}">RUNNING</div>
          <div id="${UI.countId}">0 UI</div>
        </div>
        <div class="btns">
          <button id="${UI.toggleId}" class="on" type="button">STOP</button>
          <button id="${UI.hideId}" class="off" type="button">HIDE UI</button>
          <button id="${UI.rescanId}" type="button">RESCAN</button>
          <button id="${UI.logsBtnId}" type="button">LOGS</button>
        </div>
        <div id="${UI.runtimeId}"></div>
        <div id="${UI.logsWrapId}">
          <div id="${UI.logsId}"></div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    enforceOrganizerAnchor();
    setLogsOpen(loadLogsOpen());
    updateUI();
  }

  function bindUI() {
    document.getElementById(UI.toggleId)?.addEventListener('click', () => {
      state.running = !state.running;
      log(state.running ? 'Organizer resumed' : 'Organizer stopped for this page session');
      updateUI();
      if (state.running) fullScanAndArrange();
    });

    document.getElementById(UI.hideId)?.addEventListener('click', () => {
      state.uiHidden = !state.uiHidden;
      saveHiddenMode(state.uiHidden);
      applyHiddenMode();
      log(state.uiHidden ? 'All docked UIs hidden' : 'All docked UIs shown');
      updateUI();
      if (!state.uiHidden && state.running) fullScanAndArrange();
    });

    document.getElementById(UI.rescanId)?.addEventListener('click', () => {
      log('Manual rescan');
      fullScanAndArrange();
    });

    document.getElementById(UI.logsBtnId)?.addEventListener('click', () => {
      setLogsOpen(!loadLogsOpen());
      setTimeout(() => {
        if (state.running) fullScanAndArrange();
      }, 30);
    });
  }

  function updateUI() {
    const status = document.getElementById(UI.statusId);
    const count = document.getElementById(UI.countId);
    const toggle = document.getElementById(UI.toggleId);
    const hide = document.getElementById(UI.hideId);
    const runtimeEntries = buildRuntimeEntries(readScriptActivityMap());
    state.runtimeCount = runtimeEntries.length;

    if (status) {
      status.textContent = state.running ? 'RUNNING' : 'STOPPED';
      status.style.color = state.running ? '#86efac' : '#fca5a5';
    }

    if (count) {
      count.textContent = `${state.registry.size} UI | ${state.activePanels} working | ${state.runtimeCount} scripts`;
    }

    if (toggle) {
      toggle.textContent = state.running ? 'STOP' : 'START';
      toggle.classList.toggle('on', state.running);
      toggle.classList.toggle('off', !state.running);
    }

    if (hide) {
      hide.textContent = state.uiHidden ? 'SHOW UI' : 'HIDE UI';
      hide.classList.toggle('on', state.uiHidden);
      hide.classList.toggle('off', !state.uiHidden);
    }

    renderRuntimeList(runtimeEntries);
    renderLogs();
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogs);
    renderLogs();
    persistLogsThrottled();
    console.log(`[${SCRIPT_NAME}] ${msg}`);
  }

  function persistLogsThrottled() {
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
    try { renderLogs(); } catch {}
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

  function renderLogs() {
    const logs = document.getElementById(UI.logsId);
    if (logs) logs.textContent = state.logs.join('\n');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function loadLogsOpen() {
    try { return localStorage.getItem(CFG.logsOpenKey) === '1'; } catch { return false; }
  }

  function setLogsOpen(open) {
    const wrap = document.getElementById(UI.logsWrapId);
    if (wrap) wrap.style.display = open ? 'block' : 'none';
    try { localStorage.setItem(CFG.logsOpenKey, open ? '1' : '0'); } catch {}
  }

  function loadHiddenMode() {
    try { return localStorage.getItem(CFG.hiddenKey) === '1'; } catch { return false; }
  }

  function saveHiddenMode(hidden) {
    try { localStorage.setItem(CFG.hiddenKey, hidden ? '1' : '0'); } catch {}
  }

  function restorePanelPos(panel) {
    try {
      const raw = localStorage.getItem(CFG.posKey);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;

      panel.style.left = `${Math.max(0, pos.left)}px`;
      panel.style.top = `${Math.max(0, pos.top)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    } catch {}
  }

  function savePanelPos(panel) {
    try {
      const rect = panel.getBoundingClientRect();
      localStorage.setItem(CFG.posKey, JSON.stringify({
        left: rect.left,
        top: rect.top
      }));
    } catch {}
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;

      const rect = panel.getBoundingClientRect();
      state.drag = {
        startX: e.clientX,
        startY: e.clientY,
        left: rect.left,
        top: rect.top
      };

      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onDragMove, true);
      window.addEventListener('mouseup', onDragEnd, true);

      e.preventDefault();
    });
  }

  function onDragMove(e) {
    if (!state.drag) return;

    const panel = document.getElementById(UI.panelId);
    if (!panel) return;

    const dx = e.clientX - state.drag.startX;
    const dy = e.clientY - state.drag.startY;

    const nextLeft = Math.max(0, state.drag.left + dx);
    const nextTop = Math.max(0, state.drag.top + dy);

    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function onDragEnd() {
    const panel = document.getElementById(UI.panelId);
    if (panel) savePanelPos(panel);

    state.drag = null;
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onDragMove, true);
    window.removeEventListener('mouseup', onDragEnd, true);
  }
})();
