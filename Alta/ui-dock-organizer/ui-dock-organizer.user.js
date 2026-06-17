// ==UserScript==
// @name         Cross-Origin UI Dock Organizer
// @namespace    homebot.ui-dock-organizer
// @version      1.8.1
// @description  Organizes every known floating workflow UI, including the organizer itself, with saved layout, resize, log hiding, multi-select moving, side snapping, and overlap prevention.
// @author       OpenAI
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://alta.farmers.com/*
// @match        https://github.com/ugomez809/TamperMonkey-Automatic-Quote-New*
// @match        https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-updater-installer/alta-updater-installer.user.js*
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
  const VERSION = '1.8.1';

  // Log-export integration - workflow-origin dynamic key.
  const LOG_PERSIST_KEY = (() => {
    const host = String(location.host || '');
    if (host.includes('agencyzoom.com')) return 'tm_az_ui_dock_organizer_logs_v1';
    if (host.includes('lightning.force.com')) return 'tm_apex_ui_dock_organizer_logs_v1';
    if (host.includes('alta.farmers.com')) return 'tm_alta_ui_dock_organizer_logs_v1';
    return 'tm_quote_ui_dock_organizer_logs_v1';
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
    dockPosKey: 'tm_ui_dock_organizer_panel_settings_v18',
    logsOpenKey: 'tm_ui_dock_organizer_logs_open_v13',
    hiddenKey: 'tm_ui_dock_organizer_hidden_v14',
    panelZBase: 2147480000,
    selectedZBase: 2147482600,
    snapDistance: 14,
    minPanelWidth: 210,
    minPanelHeight: 90,
    activeStaleMs: 6000
  };

  const UI = {
    panelId: 'hb-ui-dock-organizer-panel-v13',
    headId: 'hb-ui-dock-organizer-head-v13',
    statusId: 'hb-ui-dock-organizer-status-v13',
    countId: 'hb-ui-dock-organizer-count-v13',
    toggleId: 'hb-ui-dock-organizer-toggle-v13',
    hideId: 'hb-ui-dock-organizer-hide-v14',
    moveId: 'hb-ui-dock-organizer-move-v16',
    resetPosId: 'hb-ui-dock-organizer-reset-pos-v16',
    rescanId: 'hb-ui-dock-organizer-rescan-v13',
    logsBtnId: 'hb-ui-dock-organizer-logs-btn-v13',
    runtimeId: 'hb-ui-dock-organizer-runtime-v15',
    logsWrapId: 'hb-ui-dock-organizer-logs-wrap-v13',
    logsId: 'hb-ui-dock-organizer-logs-v13',
    styleId: 'hb-ui-dock-organizer-style-v13'
  };

  const ORIGIN_SCRIPT_ORDER = {
    agencyzoom: [
      'az-stage-runner',
      'shared-ticket-handoff',
      'az-ticket-finisher-tagger',
      'global-clear-launcher',
      'storage-tools',
      'alta-payload-bridge',
      'ui-dock-organizer'
    ],
    apex: [
      'apex-continue-new-quote',
      'apex-duplicates-continue',
      'apex-multi-agency-continue',
      'shared-failure-selector',
      'alta-payload-bridge',
      'ui-dock-organizer'
    ],
    alta: [
      'alta-payload-bridge',
      'payload-mirror-non-az-tab-closer',
      'webhook-submission',
      'alta-customer-info',
      'alta-home-features',
      'alta-replacement-cost',
      'alta-home-coverage',
      'alta-error-fixer',
      'shared-failure-selector',
      'global-clear-launcher',
      'storage-tools',
      'ui-dock-organizer'
    ],
    workflow: []
  };

  const SCRIPT_PANEL_MAP = {
    'hb-az-stage-runner-panel': 'az-stage-runner',
    'tm-az-ticket-finisher-panel': 'az-ticket-finisher-tagger',
    'hb-shared-az-alta-panel': 'shared-ticket-handoff',
    'hb-global-clear-launcher-panel': 'global-clear-launcher',
    'tm-az-apex-alta-storage-tools-v160': 'storage-tools',
    'hb-apex-continue-panel': 'apex-continue-new-quote',
    'hb-dup-v18-panel': 'apex-duplicates-continue',
    'tm-alta-shared-failure-selector-panel': 'shared-failure-selector',
    'alta-payload-bridge-panel': 'alta-payload-bridge',
    'tm-alta-payload-mirror-panel': 'payload-mirror-non-az-tab-closer',
    'alta-webhook-panel': 'webhook-submission',
    'alta-customer-info-panel': 'alta-customer-info',
    'alta-home-features-panel': 'alta-home-features',
    'alta-replacement-cost-panel': 'alta-replacement-cost',
    'alta-home-coverage-panel': 'alta-home-coverage',
    'alta-error-fixer-panel': 'alta-error-fixer',
    'tm-alta-updater-installer': 'alta-updater-installer',
    'hb-ui-dock-organizer-panel-v13': 'ui-dock-organizer'
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
    resize: null,
    selectedKeys: new Set(),
    lastRescanAt: 0,
    lastDockedCount: -1,
    uiHidden: false,
    moveMode: false,
    savedDockLayout: false,
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
    if (host.includes('alta.farmers.com')) return 'alta';
    return 'workflow';
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
    try { window.removeEventListener('mousemove', onResizeMove, true); } catch {}
    try { window.removeEventListener('mouseup', onResizeEnd, true); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    try { document.documentElement.classList.remove('hb-ui-dock-global-moving'); } catch {}
    try { cleanupManagedChrome(); } catch {}
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
    log(getOrganizerAnchorLabel());

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
    if (!state.moveMode && !hasSavedOrganizerPosition()) enforceOrganizerAnchor();
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
        state.selectedKeys.delete(getDockPositionKey(el));
        state.registry.delete(el);
      }
    }

    syncSelectionClasses();
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

    try {
      for (const id of Object.keys(SCRIPT_PANEL_MAP)) {
        const el = document.getElementById(id);
        if (el) set.add(el);
      }
    } catch {}

    try {
      const selectors = [
        '[data-hb-script-id]',
        '[data-tm-alta-shared-failure-selector-ui]',
        '[data-tm-az-finisher-ui]'
      ];
      for (const el of Array.from(document.querySelectorAll(selectors.join(',')))) {
        if (el instanceof HTMLElement) set.add(el);
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

    const explicitScriptId = detectScriptId(el);
    const hasExplicitMarker = !!explicitScriptId ||
      el.hasAttribute('data-hb-script-id') ||
      el.hasAttribute('data-tm-alta-shared-failure-selector-ui') ||
      el.hasAttribute('data-tm-az-finisher-ui');
    const hasControls = !!el.querySelector('button, input, textarea, select, [role="button"]');

    if (cs.pointerEvents === 'none' && !hasControls) return false;

    const vw = Math.max(window.innerWidth || 1, 1);
    const vh = Math.max(window.innerHeight || 1, 1);
    const areaRatio = (rect.width * rect.height) / (vw * vh);

    if (!hasExplicitMarker) {
      if (rect.width > vw * CFG.maxWidthRatio) return false;
      if (rect.height > vh * CFG.maxHeightRatio) return false;
      if (areaRatio > CFG.maxAreaRatio) return false;
    }

    const z = parseInt(cs.zIndex, 10);
    const marker = getMarkerText(el);

    const hasBigZ = Number.isFinite(z) && z >= CFG.minZIndex;
    const hasMarker =
      /(^|[^a-z])(hb|tm|aqb|home bot|alta|apex|vin|cnq|dup|az-ha)([^a-z]|$)/i.test(marker) ||
      /aqb:\s*(start|stop)/i.test(marker) ||
      /home bot/i.test(marker);

    if (hasExplicitMarker) return true;
    if (!hasBigZ && !hasMarker) return false;

    if (/(toast|tooltip|modal|backdrop|overlay|spinner|loading|dropdown|listbox|menu|popover|dialog|autocomplete|suggestion)/i.test(marker)) {
      return false;
    }

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

  function getOrganizerItem() {
    const el = getOrganizerPanel();
    if (!(el instanceof HTMLElement) || !el.isConnected) return null;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    return {
      el,
      scriptId: 'ui-dock-organizer',
      order: 0,
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
      area: Math.max(1, Math.ceil(rect.width * rect.height))
    };
  }

  function getManagedItems(items = getDockItems()) {
    const list = Array.isArray(items) ? items.slice() : [];
    const organizer = getOrganizerItem();
    if (organizer) list.unshift(organizer);
    return list;
  }

  function sortBiggestFirst(a, b) {
    if (b.height !== a.height) return b.height - a.height;
    if (b.area !== a.area) return b.area - a.area;
    if (b.width !== a.width) return b.width - a.width;
    return a.order - b.order;
  }

  function arrangeDock() {
    let items = getDockItems().sort(sortBiggestFirst);
    prepareManagedPanels(getManagedItems(items));

    items = getDockItems().sort(sortBiggestFirst);
    const managedItems = getManagedItems(items);

    if (items.length !== state.lastDockedCount) {
      state.lastDockedCount = items.length;
      log(`Docked UI count: ${items.length}`);
    }

    if (!items.length) {
      state.activePanels = 0;
      if (state.moveMode || hasSavedDockPositions()) {
        applyDockedUiPositionMode(managedItems);
        requestAnimationFrame(() => {
          resolveAllOverlaps(managedItems);
          for (const item of managedItems) clampElementIntoViewport(item.el);
        });
      } else if (!hasSavedOrganizerPosition()) {
        enforceOrganizerAnchor();
      }
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
    syncSelectionClasses();
    updateUI();

    if (state.drag || state.resize) return;

    if (state.moveMode || hasSavedDockPositions()) {
      applyDockedUiPositionMode(managedItems);
      requestAnimationFrame(() => {
        resolveAllOverlaps(managedItems);
        for (const item of managedItems) clampElementIntoViewport(item.el);
      });
      return;
    }

    if (!hasSavedOrganizerPosition()) enforceOrganizerAnchor();
    setDockMoveTargets(managedItems, false);
    applySavedPanelSettings(managedItems);

    const placements = buildPlacements(items);

    for (const p of placements) {
      applyPlacement(p);
    }

    requestAnimationFrame(() => {
      const arranged = getManagedItems(getDockItems());
      resolveAllOverlaps(arranged);
      for (const item of arranged) clampElementIntoViewport(item.el);
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

  function applyDockedUiPositionMode(items) {
    const saved = loadDockPositions();

    for (const item of items) {
      const key = getDockPositionKey(item);
      bindDockItemDrag(item.el);
      item.el.classList.toggle('hb-ui-dock-move-target', state.moveMode);
      applySavedPanelSettings(item, saved);

      const pos = key ? saved[key] : null;
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        applyPanelPos(item.el, pos.left, pos.top);
      } else if (state.moveMode) {
        pinPanelAtCurrentPosition(item.el);
      }
    }
  }

  function setDockMoveTargets(items, enabled) {
    for (const item of items || []) {
      if (item?.el?.classList) item.el.classList.toggle('hb-ui-dock-move-target', !!enabled);
    }
  }

  function getDockPositionKey(itemOrEl) {
    const el = itemOrEl?.el || itemOrEl;
    if (!(el instanceof HTMLElement)) return '';

    const scriptId = normalizeText(itemOrEl?.scriptId || detectScriptId(el));
    if (scriptId) return `script:${scriptId}`;

    const id = normalizeText(el.id || '');
    if (id) return `id:${id}`;

    return '';
  }

  function loadDockPositions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CFG.dockPosKey) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function hasSavedDockPositions() {
    return Object.values(loadDockPositions()).some((pos) => hasPanelPosition(pos) || hasPanelSize(pos));
  }

  function hasSavedOrganizerPosition() {
    const saved = loadDockPositions();
    return hasPanelPosition(saved['script:ui-dock-organizer']);
  }

  function hasPanelPosition(pos) {
    return !!pos && typeof pos.left === 'number' && typeof pos.top === 'number';
  }

  function hasPanelSize(pos) {
    return !!pos && typeof pos.width === 'number' && typeof pos.height === 'number';
  }

  function saveDockPositions(items = getManagedItems()) {
    const previous = loadDockPositions();
    const next = {};

    for (const item of items) {
      const key = getDockPositionKey(item);
      if (!key || !item.el?.isConnected) continue;

      const rect = item.el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;

      next[key] = {
        ...previous[key],
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        logsHidden: getPanelLogsHidden(item, previous),
        id: item.el.id || '',
        scriptId: item.scriptId || ''
      };
    }

    try { localStorage.setItem(CFG.dockPosKey, JSON.stringify(next)); } catch {}
    state.savedDockLayout = Object.values(next).some((pos) => hasPanelPosition(pos) || hasPanelSize(pos));
    return state.savedDockLayout;
  }

  function clearDockPositions() {
    const saved = loadDockPositions();
    for (const pos of Object.values(saved)) {
      if (!pos || typeof pos !== 'object') continue;
      delete pos.left;
      delete pos.top;
      delete pos.width;
      delete pos.height;
    }
    try { localStorage.setItem(CFG.dockPosKey, JSON.stringify(saved)); } catch {}
    state.savedDockLayout = false;
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

  function isAltaOrigin() {
    return /(^|\.)alta\.farmers\.com$/i.test(location.hostname);
  }

  function getOrganizerAnchorLabel() {
    if (isAgencyZoomOrigin()) return 'Organizer anchored by AgencyZoom profile link';
    if (isAltaOrigin()) return 'Organizer locked top-right';
    return 'Organizer locked bottom-left';
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
    if (state.moveMode || state.drag || state.resize || hasSavedOrganizerPosition()) return;

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
    if (isAltaOrigin()) {
      try {
        panel.style.setProperty('position', 'fixed', 'important');
        panel.style.setProperty('left', 'auto', 'important');
        panel.style.setProperty('right', `${CFG.rightGap}px`, 'important');
        panel.style.setProperty('top', `${CFG.topGap}px`, 'important');
        panel.style.setProperty('bottom', 'auto', 'important');
        panel.style.setProperty('transform', 'none', 'important');
        panel.style.setProperty('margin', '0', 'important');
      } catch {}
      return;
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
    if (isOrganizerPanel(el)) return 'ui-dock-organizer';
    const explicit = normalizeText(
      el.getAttribute('data-hb-script-id') ||
      el.dataset?.hbScriptId ||
      el.querySelector?.('[data-hb-script-id]')?.getAttribute('data-hb-script-id') ||
      ''
    );
    if (explicit) return explicit;
    if (el.hasAttribute('data-tm-alta-shared-failure-selector-ui')) return 'shared-failure-selector';
    if (el.hasAttribute('data-tm-az-finisher-ui')) return 'az-ticket-finisher-tagger';
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
    if (isOrganizerPanel(el) && !state.moveMode && !hasSavedOrganizerPosition()) {
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

    const organizerRect = isOrganizerPanel(el) ? null : getOrganizerRect();
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
        cursor:default;
      }
      #${UI.panelId}.hb-ui-dock-moving{
        outline:2px solid rgba(250,204,21,.85);
        outline-offset:2px;
      }
      #${UI.panelId}.hb-ui-dock-moving #${UI.headId}{
        cursor:default;
        background:rgba(250,204,21,.16);
      }
      .hb-ui-dock-move-target{
        outline:2px solid rgba(250,204,21,.85) !important;
        outline-offset:2px !important;
        cursor:move !important;
      }
      .hb-ui-dock-selected{
        outline:3px solid rgba(59,130,246,.95) !important;
        outline-offset:3px !important;
      }
      .hb-ui-dock-managed{
        min-width:${CFG.minPanelWidth}px !important;
        min-height:${CFG.minPanelHeight}px !important;
      }
      .hb-ui-dock-controls{
        position:absolute;
        top:6px;
        right:6px;
        z-index:2147483647;
        display:flex;
        gap:4px;
        opacity:.35;
        transition:opacity .12s ease;
        pointer-events:auto;
      }
      .hb-ui-dock-managed:hover > .hb-ui-dock-controls,
      .hb-ui-dock-controls:focus-within{
        opacity:1;
      }
      .hb-ui-dock-log-toggle{
        border:1px solid rgba(255,255,255,.22) !important;
        border-radius:6px !important;
        background:rgba(15,23,42,.88) !important;
        color:#fff !important;
        font:700 10px/1 Arial,sans-serif !important;
        padding:4px 6px !important;
        cursor:pointer !important;
        box-shadow:0 2px 8px rgba(0,0,0,.25) !important;
      }
      .hb-ui-dock-log-toggle.off{
        background:rgba(127,29,29,.92) !important;
      }
      .hb-ui-dock-barrier{
        position:absolute;
        inset:0;
        z-index:2147483645;
        display:none;
        background:rgba(14,18,26,.10);
        cursor:move;
        touch-action:none;
      }
      .hb-ui-dock-resize-grip{
        position:absolute;
        right:0;
        bottom:0;
        width:18px;
        height:18px;
        z-index:2147483646;
        cursor:nwse-resize;
        display:none;
        opacity:.45;
        background:linear-gradient(135deg, transparent 0 45%, rgba(255,255,255,.55) 46% 52%, transparent 53% 61%, rgba(255,255,255,.55) 62% 68%, transparent 69%);
      }
      .hb-ui-dock-managed:hover > .hb-ui-dock-resize-grip{
        opacity:.9;
      }
      .hb-ui-dock-global-moving .hb-ui-dock-managed:not(.hb-ui-dock-organizer-managed) > .hb-ui-dock-barrier{
        display:block;
      }
      .hb-ui-dock-global-moving .hb-ui-dock-managed > .hb-ui-dock-controls{
        display:none;
      }
      .hb-ui-dock-global-moving .hb-ui-dock-managed > .hb-ui-dock-resize-grip{
        display:block;
      }
      .hb-ui-dock-move-target button,
      .hb-ui-dock-move-target input,
      .hb-ui-dock-move-target textarea,
      .hb-ui-dock-move-target select,
      .hb-ui-dock-move-target a,
      .hb-ui-dock-move-target [role="button"]{
        cursor:auto !important;
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
      #${UI.moveId}.on{ background:#ca8a04; }
      #${UI.moveId}.off{ background:#334155; }
      #${UI.resetPosId}{ background:#475569; }
      #${UI.rescanId}{ background:#1d4ed8; }
      #${UI.logsBtnId}{ background:#374151; }
      #${UI.panelId} button:disabled{
        opacity:.45;
        cursor:not-allowed;
      }
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
    panel.setAttribute('data-hb-script-id', 'ui-dock-organizer');
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
        <div class="btns">
          <button id="${UI.moveId}" class="off" type="button">MOVE UIs</button>
          <button id="${UI.resetPosId}" type="button">RESET POS</button>
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

    document.getElementById(UI.moveId)?.addEventListener('click', () => {
      if (!state.moveMode) {
        state.moveMode = true;
        log('Docked UI move mode enabled');
      } else {
        state.moveMode = false;
        endDrag();
        endResize();
        const saved = saveDockPositions(getManagedItems());
        clearSelection();
        log(saved ? 'Docked UI positions saved' : 'No docked UI positions to save');
      }

      updateUI();
      if (state.running) fullScanAndArrange();
    });

    document.getElementById(UI.resetPosId)?.addEventListener('click', () => {
      state.moveMode = false;
      endDrag();
      endResize();
      clearDockPositions();
      clearSelection();
      for (const item of getManagedItems()) {
        item.el.classList.remove('hb-ui-dock-move-target');
      }
      log('Docked UI positions reset');
      updateUI();
      if (state.running) fullScanAndArrange();
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
    const move = document.getElementById(UI.moveId);
    const resetPos = document.getElementById(UI.resetPosId);
    const panel = getOrganizerPanel();
    const runtimeEntries = buildRuntimeEntries(readScriptActivityMap());
    state.runtimeCount = runtimeEntries.length;
    state.savedDockLayout = hasSavedDockPositions();

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

    if (move) {
      move.textContent = state.moveMode ? 'SAVE UIs' : 'MOVE UIs';
      move.classList.toggle('on', state.moveMode);
      move.classList.toggle('off', !state.moveMode);
    }

    if (resetPos) {
      resetPos.disabled = !state.savedDockLayout && !state.moveMode;
    }

    if (panel) {
      panel.classList.toggle('hb-ui-dock-moving', state.moveMode);
    }

    try { document.documentElement.classList.toggle('hb-ui-dock-global-moving', state.moveMode); } catch {}

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

  function buildItemFromEl(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return null;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const meta = state.registry.get(el) || {};
    return {
      el,
      scriptId: meta.scriptId || detectScriptId(el),
      order: isOrganizerPanel(el) ? 0 : (meta.order || 9999),
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
      area: Math.max(1, Math.ceil(rect.width * rect.height))
    };
  }

  function prepareManagedPanels(items) {
    const saved = loadDockPositions();
    const seenKeys = new Set();

    for (const item of items || []) {
      if (!item?.el?.isConnected) continue;
      const key = getDockPositionKey(item);
      if (!key) continue;
      seenKeys.add(key);

      const el = item.el;
      el.dataset.hbUiDockKey = key;
      el.classList.add('hb-ui-dock-managed');
      el.classList.toggle('hb-ui-dock-organizer-managed', isOrganizerPanel(el));
      bindDockItemDrag(el);
      ensureManagedChrome(item);
      applyPanelChromeState(item);
      applySavedPanelSettings(item, saved);
    }

    for (const key of Array.from(state.selectedKeys)) {
      if (!seenKeys.has(key)) state.selectedKeys.delete(key);
    }
    syncSelectionClasses();
  }

  function applyPanelChromeState(item) {
    if (!item?.el) return;
    const key = getDockPositionKey(item);
    const selected = state.selectedKeys.has(key);
    const z = isOrganizerPanel(item.el)
      ? CFG.uiZ
      : Math.min(CFG.uiZ - 20, (selected ? CFG.selectedZBase : CFG.panelZBase) + Math.max(1, item.order || 1));

    try {
      item.el.style.setProperty('position', 'fixed', 'important');
      item.el.style.setProperty('z-index', String(z), 'important');
      item.el.style.setProperty('min-width', `${CFG.minPanelWidth}px`, 'important');
      item.el.style.setProperty('min-height', `${CFG.minPanelHeight}px`, 'important');
      item.el.style.setProperty('max-width', `calc(100vw - ${CFG.sideGap * 2}px)`, 'important');
      item.el.style.setProperty('max-height', `calc(100vh - ${CFG.topGap + CFG.bottomGap}px)`, 'important');
      item.el.style.setProperty('box-sizing', 'border-box', 'important');
    } catch {}

    item.el.classList.toggle('hb-ui-dock-move-target', state.moveMode);
    item.el.classList.toggle('hb-ui-dock-selected', selected);
  }

  function findDirectChildByClass(parent, className) {
    if (!parent?.children) return null;
    return Array.from(parent.children).find((child) => child.classList?.contains(className)) || null;
  }

  function ensureManagedChrome(item) {
    const el = item?.el;
    if (!(el instanceof HTMLElement) || !el.isConnected) return;

    let controls = findDirectChildByClass(el, 'hb-ui-dock-controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'hb-ui-dock-controls';
      controls.setAttribute('data-hb-ui-dock-control', '1');

      const logsButton = document.createElement('button');
      logsButton.type = 'button';
      logsButton.className = 'hb-ui-dock-log-toggle';
      logsButton.textContent = 'LOGS';
      logsButton.title = 'Hide or show this panel log area';
      logsButton.setAttribute('data-hb-ui-dock-control', '1');
      logsButton.addEventListener('click', onLogToggleClick, true);

      controls.appendChild(logsButton);
      el.appendChild(controls);
    }

    let barrier = findDirectChildByClass(el, 'hb-ui-dock-barrier');
    if (!barrier) {
      barrier = document.createElement('div');
      barrier.className = 'hb-ui-dock-barrier';
      barrier.setAttribute('data-hb-ui-dock-control', '1');
      barrier.addEventListener('mousedown', onDockItemDragStart, true);
      barrier.addEventListener('click', blockManagedPanelClick, true);
      el.appendChild(barrier);
    }

    let grip = findDirectChildByClass(el, 'hb-ui-dock-resize-grip');
    if (!grip) {
      grip = document.createElement('div');
      grip.className = 'hb-ui-dock-resize-grip';
      grip.title = 'Resize';
      grip.setAttribute('data-hb-ui-dock-control', '1');
      grip.addEventListener('mousedown', onResizeStart, true);
      el.appendChild(grip);
    }
  }

  function cleanupManagedChrome() {
    const nodes = Array.from(document.querySelectorAll('.hb-ui-dock-managed'));
    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue;
      try { el.removeEventListener('mousedown', onDockItemDragStart, true); } catch {}
      for (const className of ['hb-ui-dock-controls', 'hb-ui-dock-barrier', 'hb-ui-dock-resize-grip']) {
        try { findDirectChildByClass(el, className)?.remove(); } catch {}
      }
      el.classList.remove('hb-ui-dock-managed', 'hb-ui-dock-move-target', 'hb-ui-dock-selected');
      el.classList.remove('hb-ui-dock-organizer-managed');
      delete el.dataset.hbUiDockKey;
      delete el.dataset.hbUiDockDragBound;
      delete el.dataset.hbUiDockLogsHidden;
    }
  }

  function applySavedPanelSettings(itemsOrItem, saved = loadDockPositions()) {
    const list = Array.isArray(itemsOrItem) ? itemsOrItem : [itemsOrItem];

    for (const item of list) {
      if (!item?.el?.isConnected) continue;
      const key = getDockPositionKey(item);
      const pos = key ? saved[key] : null;

      if (!isActiveResizeKey(key) && pos && typeof pos.width === 'number' && typeof pos.height === 'number') {
        applyPanelSize(item.el, pos.width, pos.height);
      }

      applyPanelLogHidden(item, getPanelLogsHidden(item, saved));
    }
  }

  function getPanelLogsHidden(item, saved = loadDockPositions()) {
    const key = getDockPositionKey(item);
    const pos = key ? saved[key] : null;
    if (typeof pos?.logsHidden === 'boolean') return pos.logsHidden;
    if (isOrganizerPanel(item?.el)) return !loadLogsOpen();
    return false;
  }

  function updateDockSetting(item, patch) {
    const key = getDockPositionKey(item);
    if (!key) return;
    const saved = loadDockPositions();
    saved[key] = {
      ...(saved[key] || {}),
      ...patch,
      id: item?.el?.id || saved[key]?.id || '',
      scriptId: item?.scriptId || detectScriptId(item?.el) || saved[key]?.scriptId || ''
    };
    try { localStorage.setItem(CFG.dockPosKey, JSON.stringify(saved)); } catch {}
    state.savedDockLayout = hasSavedDockPositions();
  }

  function onLogToggleClick(event) {
    const panel = event.currentTarget?.closest?.('.hb-ui-dock-managed');
    const item = buildItemFromEl(panel);
    if (!item) return;
    const nextHidden = !getPanelLogsHidden(item);
    updateDockSetting(item, { logsHidden: nextHidden });
    applyPanelLogHidden(item, nextHidden);
    event.preventDefault();
    event.stopPropagation();
  }

  function findPanelLogElements(panel) {
    if (!(panel instanceof HTMLElement)) return [];
    if (isOrganizerPanel(panel)) {
      const wrap = document.getElementById(UI.logsWrapId);
      return wrap ? [wrap] : [];
    }

    const found = new Set();
    const nodes = Array.from(panel.querySelectorAll('textarea, [data-logs], [data-log], .hb-log, [id], [class]'));
    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.closest('[data-hb-ui-dock-control]')) continue;
      if (el.matches('button, input, select, option, a')) continue;

      const marker = [
        el.id || '',
        typeof el.className === 'string' ? el.className : '',
        el.getAttribute('data-logs') != null ? 'data-logs' : '',
        el.getAttribute('data-log') != null ? 'data-log' : ''
      ].join(' ').toLowerCase();

      if (marker.includes('log')) found.add(el);
    }

    return Array.from(found);
  }

  function applyPanelLogHidden(item, hidden) {
    const panel = item?.el;
    if (!(panel instanceof HTMLElement) || !panel.isConnected) return;

    if (isOrganizerPanel(panel)) {
      setLogsOpen(!hidden);
    } else {
      for (const logEl of findPanelLogElements(panel)) {
        if (hidden) {
          if (!Object.prototype.hasOwnProperty.call(logEl.dataset, 'hbUiDockPrevDisplay')) {
            logEl.dataset.hbUiDockPrevDisplay = logEl.style.display || '';
          }
          logEl.style.setProperty('display', 'none', 'important');
        } else if (Object.prototype.hasOwnProperty.call(logEl.dataset, 'hbUiDockPrevDisplay')) {
          if (logEl.dataset.hbUiDockPrevDisplay) logEl.style.display = logEl.dataset.hbUiDockPrevDisplay;
          else logEl.style.removeProperty('display');
          delete logEl.dataset.hbUiDockPrevDisplay;
        }
      }
    }

    panel.dataset.hbUiDockLogsHidden = hidden ? '1' : '0';
    const button = findDirectChildByClass(panel, 'hb-ui-dock-controls')?.querySelector('.hb-ui-dock-log-toggle');
    if (button) {
      button.classList.toggle('off', hidden);
      button.title = hidden ? 'Show this panel log area' : 'Hide this panel log area';
      button.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    }
  }

  function syncSelectionClasses() {
    for (const el of Array.from(document.querySelectorAll('.hb-ui-dock-managed'))) {
      if (!(el instanceof HTMLElement)) continue;
      const key = getDockPositionKey(el);
      el.classList.toggle('hb-ui-dock-selected', !!key && state.selectedKeys.has(key));
    }
  }

  function clearSelection() {
    state.selectedKeys.clear();
    syncSelectionClasses();
  }

  function applyPanelPos(panel, left, top) {
    if (!panel) return;

    const panelWidth = Math.max(1, panel.offsetWidth || 300);
    const panelHeight = Math.max(1, panel.offsetHeight || 180);
    const maxLeft = Math.max(CFG.sideGap, window.innerWidth - panelWidth - CFG.sideGap);
    const maxTop = Math.max(CFG.topGap, window.innerHeight - panelHeight - CFG.bottomGap);

    try {
      panel.style.setProperty('position', 'fixed', 'important');
      panel.style.setProperty('left', `${clamp(Math.round(left), CFG.sideGap, maxLeft)}px`, 'important');
      panel.style.setProperty('top', `${clamp(Math.round(top), CFG.topGap, maxTop)}px`, 'important');
      panel.style.setProperty('right', 'auto', 'important');
      panel.style.setProperty('bottom', 'auto', 'important');
      panel.style.setProperty('transform', 'none', 'important');
      panel.style.setProperty('margin', '0', 'important');
    } catch {}
  }

  function applyPanelSize(panel, width, height) {
    if (!(panel instanceof HTMLElement)) return;
    const maxWidth = Math.max(CFG.minPanelWidth, window.innerWidth - (CFG.sideGap * 2));
    const maxHeight = Math.max(CFG.minPanelHeight, window.innerHeight - CFG.topGap - CFG.bottomGap);
    try {
      panel.style.setProperty('width', `${clamp(Math.round(width), CFG.minPanelWidth, maxWidth)}px`, 'important');
      panel.style.setProperty('height', `${clamp(Math.round(height), CFG.minPanelHeight, maxHeight)}px`, 'important');
      panel.style.setProperty('overflow', 'auto', 'important');
      panel.style.setProperty('box-sizing', 'border-box', 'important');
    } catch {}
  }

  function pinPanelAtCurrentPosition(panel) {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    applyPanelPos(panel, rect.left, rect.top);
  }

  function bindDockItemDrag(el) {
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.hbUiDockDragBound === '1') return;
    el.dataset.hbUiDockDragBound = '1';
    el.addEventListener('mousedown', onDockItemDragStart, true);
  }

  function isInteractiveDragTarget(target) {
    if (target?.closest?.('[data-hb-ui-dock-control]')) return false;
    return !!target?.closest?.('button, input, textarea, select, option, a, [role="button"], [contenteditable="true"]');
  }

  function blockManagedPanelClick(event) {
    if (!state.moveMode) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function getManagedPanelFromEvent(event) {
    const current = event.currentTarget;
    if (current instanceof HTMLElement && current.classList.contains('hb-ui-dock-managed')) return current;
    return event.target?.closest?.('.hb-ui-dock-managed') || null;
  }

  function getSelectedManagedItems() {
    const selected = [];
    for (const item of getManagedItems()) {
      const key = getDockPositionKey(item);
      if (key && state.selectedKeys.has(key)) selected.push(item);
    }
    return selected;
  }

  function selectOnly(key) {
    state.selectedKeys.clear();
    if (key) state.selectedKeys.add(key);
    syncSelectionClasses();
  }

  function toggleSelectedKey(key) {
    if (!key) return;
    if (state.selectedKeys.has(key)) state.selectedKeys.delete(key);
    else state.selectedKeys.add(key);
    syncSelectionClasses();
  }

  function rectFromItem(item) {
    if (!item?.el?.isConnected) return null;
    const rect = item.el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      item,
      key: getDockPositionKey(item),
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function rectRight(rect) {
    return rect.left + rect.width;
  }

  function rectBottom(rect) {
    return rect.top + rect.height;
  }

  function groupBounds(rects) {
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map(rectRight));
    const bottom = Math.max(...rects.map(rectBottom));
    return { left, top, width: right - left, height: bottom - top };
  }

  function translateRects(rects, dx, dy) {
    if (!dx && !dy) return rects;
    return rects.map((rect) => ({ ...rect, left: rect.left + dx, top: rect.top + dy }));
  }

  function viewportClampDelta(bounds) {
    const vw = Math.max(window.innerWidth || 1, 1);
    const vh = Math.max(window.innerHeight || 1, 1);
    let dx = 0;
    let dy = 0;
    const maxRight = vw - CFG.sideGap;
    const maxBottom = vh - CFG.bottomGap;

    if (bounds.left < CFG.sideGap) dx = CFG.sideGap - bounds.left;
    if (bounds.left + bounds.width + dx > maxRight) dx = maxRight - (bounds.left + bounds.width);
    if (bounds.top < CFG.topGap) dy = CFG.topGap - bounds.top;
    if (bounds.top + bounds.height + dy > maxBottom) dy = maxBottom - (bounds.top + bounds.height);

    return { dx, dy };
  }

  function clampGroupRects(rects) {
    if (!rects.length) return rects;
    const delta = viewportClampDelta(groupBounds(rects));
    return translateRects(rects, delta.dx, delta.dy);
  }

  function clampSingleRect(rect) {
    const vw = Math.max(window.innerWidth || 1, 1);
    const vh = Math.max(window.innerHeight || 1, 1);
    const maxLeft = Math.max(CFG.sideGap, vw - rect.width - CFG.sideGap);
    const maxTop = Math.max(CFG.topGap, vh - rect.height - CFG.bottomGap);
    return {
      ...rect,
      left: clamp(rect.left, CFG.sideGap, maxLeft),
      top: clamp(rect.top, CFG.topGap, maxTop)
    };
  }

  function rangesOverlapOrNear(a1, a2, b1, b2, gap = 0) {
    return a1 <= b2 + gap && a2 >= b1 - gap;
  }

  function rectsOverlap(a, b, gap = 0) {
    return a.left < rectRight(b) + gap &&
      rectRight(a) > b.left - gap &&
      a.top < rectBottom(b) + gap &&
      rectBottom(a) > b.top - gap;
  }

  function getObstacleRects(excludeKeys = new Set()) {
    const rects = [];
    for (const item of getManagedItems()) {
      const key = getDockPositionKey(item);
      if (!key || excludeKeys.has(key)) continue;
      const rect = rectFromItem(item);
      if (rect) rects.push(rect);
    }
    return rects;
  }

  function snapGroupRects(rects, obstacles) {
    if (!rects.length) return rects;
    const group = groupBounds(rects);
    let bestDx = 0;
    let bestDy = 0;
    let bestAbsX = CFG.snapDistance + 1;
    let bestAbsY = CFG.snapDistance + 1;
    const gap = CFG.itemGap;

    function considerX(dx) {
      const abs = Math.abs(dx);
      if (abs <= CFG.snapDistance && abs < bestAbsX) {
        bestAbsX = abs;
        bestDx = dx;
      }
    }

    function considerY(dy) {
      const abs = Math.abs(dy);
      if (abs <= CFG.snapDistance && abs < bestAbsY) {
        bestAbsY = abs;
        bestDy = dy;
      }
    }

    considerX(CFG.sideGap - group.left);
    considerX((window.innerWidth - CFG.sideGap) - (group.left + group.width));
    considerY(CFG.topGap - group.top);
    considerY((window.innerHeight - CFG.bottomGap) - (group.top + group.height));

    for (const obstacle of obstacles) {
      if (rangesOverlapOrNear(group.top, group.top + group.height, obstacle.top, rectBottom(obstacle), CFG.snapDistance * 2)) {
        considerX(rectRight(obstacle) + gap - group.left);
        considerX(obstacle.left - gap - (group.left + group.width));
      }
      if (rangesOverlapOrNear(group.left, group.left + group.width, obstacle.left, rectRight(obstacle), CFG.snapDistance * 2)) {
        considerY(rectBottom(obstacle) + gap - group.top);
        considerY(obstacle.top - gap - (group.top + group.height));
      }
    }

    return clampGroupRects(translateRects(rects, bestDx, bestDy));
  }

  function moveRectAwayFrom(rect, obstacle) {
    const gap = CFG.itemGap;
    const expanded = {
      left: obstacle.left - gap,
      top: obstacle.top - gap,
      width: obstacle.width + (gap * 2),
      height: obstacle.height + (gap * 2)
    };
    const candidates = [
      { dx: expanded.left - rectRight(rect), dy: 0 },
      { dx: rectRight(expanded) - rect.left, dy: 0 },
      { dx: 0, dy: expanded.top - rectBottom(rect) },
      { dx: 0, dy: rectBottom(expanded) - rect.top }
    ].sort((a, b) => (Math.abs(a.dx) + Math.abs(a.dy)) - (Math.abs(b.dx) + Math.abs(b.dy)));

    for (const candidate of candidates) {
      const shifted = clampSingleRect({ ...rect, left: rect.left + candidate.dx, top: rect.top + candidate.dy });
      if (!rectsOverlap(shifted, obstacle, gap)) return shifted;
    }

    const fallback = candidates[0] || { dx: 0, dy: 0 };
    return clampSingleRect({ ...rect, left: rect.left + fallback.dx, top: rect.top + fallback.dy });
  }

  function repelGroupFromObstacles(rects, obstacles) {
    let next = clampGroupRects(rects);
    for (let pass = 0; pass < 8; pass++) {
      const group = groupBounds(next);
      const obstacle = obstacles.find((candidate) => rectsOverlap(group, candidate, CFG.itemGap));
      if (!obstacle) break;
      const moved = moveRectAwayFrom(group, obstacle);
      next = clampGroupRects(translateRects(next, moved.left - group.left, moved.top - group.top));
    }
    return next;
  }

  function resolveAllOverlaps(items) {
    const rects = (items || [])
      .map(rectFromItem)
      .filter(Boolean)
      .sort((a, b) => {
        if (isOrganizerPanel(a.item.el)) return -1;
        if (isOrganizerPanel(b.item.el)) return 1;
        return (a.item.order || 0) - (b.item.order || 0);
      });

    const placed = [];
    for (let rect of rects) {
      rect = clampSingleRect(rect);
      for (let pass = 0; pass < 8; pass++) {
        const overlap = placed.find((candidate) => rectsOverlap(rect, candidate, CFG.itemGap));
        if (!overlap) break;
        rect = moveRectAwayFrom(rect, overlap);
      }
      placed.push(rect);
      applyPanelPos(rect.item.el, rect.left, rect.top);
    }
  }

  function isActiveResizeKey(key) {
    return !!key && state.resize?.key === key;
  }

  function onDockItemDragStart(e) {
    if (!state.moveMode) return;
    if (e.button !== 0) return;
    if (isInteractiveDragTarget(e.target)) return;

    const el = getManagedPanelFromEvent(e);
    if (!(el instanceof HTMLElement) || !el.isConnected) return;
    const item = buildItemFromEl(el);
    const key = getDockPositionKey(item);
    if (!item || !key) return;

    if (e.ctrlKey || e.metaKey) {
      toggleSelectedKey(key);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (!state.selectedKeys.has(key)) selectOnly(key);

    const selectedItems = getSelectedManagedItems();
    const dragItems = selectedItems.length ? selectedItems : [item];
    const rects = dragItems.map(rectFromItem).filter(Boolean);
    if (!rects.length) return;

    for (const rect of rects) applyPanelPos(rect.item.el, rect.left, rect.top);

    state.drag = {
      items: rects,
      startX: e.clientX,
      startY: e.clientY
    };

    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onDragMove, true);
    window.addEventListener('mouseup', onDragEnd, true);

    e.preventDefault();
    e.stopPropagation();
  }

  function onDragMove(e) {
    const drag = state.drag;
    if (!drag?.items?.length) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const excludeKeys = new Set(drag.items.map((rect) => rect.key).filter(Boolean));
    const obstacles = getObstacleRects(excludeKeys);
    let next = drag.items.map((rect) => ({ ...rect, left: rect.left + dx, top: rect.top + dy }));

    next = snapGroupRects(next, obstacles);
    next = repelGroupFromObstacles(next, obstacles);

    for (const rect of next) applyPanelPos(rect.item.el, rect.left, rect.top);
    e.preventDefault();
    e.stopPropagation();
  }

  function onDragEnd() {
    if (state.moveMode) {
      resolveAllOverlaps(getManagedItems());
      saveDockPositions(getManagedItems());
      updateUI();
      if (state.running) fullScanAndArrange();
    }

    endDrag();
  }

  function endDrag() {
    state.drag = null;
    try { document.body.style.userSelect = ''; } catch {}
    window.removeEventListener('mousemove', onDragMove, true);
    window.removeEventListener('mouseup', onDragEnd, true);
  }

  function onResizeStart(e) {
    if (!state.moveMode) return;
    if (e.button !== 0) return;

    const panel = e.currentTarget?.closest?.('.hb-ui-dock-managed');
    const item = buildItemFromEl(panel);
    const key = getDockPositionKey(item);
    if (!item || !key) return;

    const rect = item.el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    state.resize = {
      item,
      key,
      startX: e.clientX,
      startY: e.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };

    pinPanelAtCurrentPosition(item.el);
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onResizeMove, true);
    window.addEventListener('mouseup', onResizeEnd, true);

    e.preventDefault();
    e.stopPropagation();
  }

  function limitResizeRect(rect, key) {
    let maxWidth = Math.max(CFG.minPanelWidth, window.innerWidth - CFG.sideGap - rect.left);
    let maxHeight = Math.max(CFG.minPanelHeight, window.innerHeight - CFG.bottomGap - rect.top);

    for (const obstacle of getObstacleRects(new Set([key]))) {
      const verticalOverlap = rangesOverlapOrNear(rect.top, rect.top + rect.height, obstacle.top, rectBottom(obstacle), 0);
      const horizontalOverlap = rangesOverlapOrNear(rect.left, rect.left + rect.width, obstacle.left, rectRight(obstacle), 0);

      if (verticalOverlap && rect.left < obstacle.left) {
        maxWidth = Math.min(maxWidth, obstacle.left - CFG.itemGap - rect.left);
      }
      if (horizontalOverlap && rect.top < obstacle.top) {
        maxHeight = Math.min(maxHeight, obstacle.top - CFG.itemGap - rect.top);
      }
    }

    return {
      ...rect,
      width: clamp(rect.width, CFG.minPanelWidth, Math.max(CFG.minPanelWidth, maxWidth)),
      height: clamp(rect.height, CFG.minPanelHeight, Math.max(CFG.minPanelHeight, maxHeight))
    };
  }

  function onResizeMove(e) {
    const resize = state.resize;
    if (!resize?.item?.el?.isConnected) return;

    const raw = {
      item: resize.item,
      key: resize.key,
      left: resize.left,
      top: resize.top,
      width: resize.width + (e.clientX - resize.startX),
      height: resize.height + (e.clientY - resize.startY)
    };
    const next = limitResizeRect(raw, resize.key);

    applyPanelSize(resize.item.el, next.width, next.height);
    clampElementIntoViewport(resize.item.el);
    e.preventDefault();
    e.stopPropagation();
  }

  function onResizeEnd() {
    if (state.resize?.item?.el?.isConnected) {
      const item = buildItemFromEl(state.resize.item.el) || state.resize.item;
      const rect = item.el.getBoundingClientRect();
      updateDockSetting(item, {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        logsHidden: getPanelLogsHidden(item)
      });
      resolveAllOverlaps(getManagedItems());
      saveDockPositions(getManagedItems());
      if (state.running) fullScanAndArrange();
    }

    endResize();
  }

  function endResize() {
    state.resize = null;
    try { document.body.style.userSelect = ''; } catch {}
    window.removeEventListener('mousemove', onResizeMove, true);
    window.removeEventListener('mouseup', onResizeEnd, true);
  }
})();
