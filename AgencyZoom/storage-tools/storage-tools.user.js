// ==UserScript==
// @name         Cross-Origin Storage Tools
// @namespace    homebot.storage-tools
// @version      1.6.1
// @description  Tiny standalone helper: exports tracked AZ + APEX + Alta HOME payload/storage to TXT, mirrors key Home payloads into shared cache, and clears tracked workflow data without deleting saved setup.
// @match        https://app.agencyzoom.com/*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/storage-tools/storage-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/storage-tools/storage-tools.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.6.1';
  const UI_ID = 'tm-az-apex-alta-storage-tools-v161';
  const TOAST_ID = 'tm-az-apex-alta-storage-tools-toast-v161';
  const CLEANUP_REQUEST_KEY = 'tm_az_workflow_cleanup_request_v1';
  // Log-export feature: any tracked-prefix key ending in _logs_v1 is a
  // per-script rolling log buffer written by individual scripts so this
  // hub can aggregate + download them in one click.
  const LOG_KEY_SUFFIX = '_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';

  const TRACKED_PREFIXES = [
    'tm_',
    'hb_'
  ];

  const DISABLED_AUTO_LOG_KEYS = new Set([
    'tm_alta_start_auto_quote_logs_v1',
    'tm_alta_aqb_drivers_logs_v1',
    'tm_alta_aqb_vehicles_logs_v1',
    'tm_alta_aqb_specialty_product_logs_v1',
    'tm_alta_auto_quote_grabber_logs_v1'
  ]);

  const LIVE_KEYS = {
    azPayloadCandidates: [
      'tm_az_home_auto_payload_v1',
      'tm_az_stage_runner_payload_v1',
      'tm_az_payload_v1',
      'tm_az_current_job_v1',
      'tm_alta_current_job_v1'
    ],
    apexPayload: 'tm_apex_home_bot_payload_v1',
    apexReady: 'tm_apex_home_bot_ready_v1',
    apexActiveRow: 'tm_apex_home_bot_active_row_v1',
    AltaHomePayload: 'tm_alta_home_quote_grab_payload_v1',
    sharedCurrentJob: 'tm_alta_current_job_v1'
  };

  const CACHE_KEYS = {
    azPayload: 'tm_shared_cache_az_payload_v1',
    apexPayload: 'tm_shared_cache_apex_payload_v1',
    apexReady: 'tm_shared_cache_apex_ready_v1',
    apexActiveRow: 'tm_shared_cache_apex_active_row_v1',
    AltaHomePayload: 'tm_shared_cache_alta_home_quote_payload_v1'
  };

  const EXACT_TRACKED_KEYS = new Set([
    LIVE_KEYS.apexPayload,
    LIVE_KEYS.apexReady,
    LIVE_KEYS.apexActiveRow,
    LIVE_KEYS.AltaHomePayload,
    LIVE_KEYS.sharedCurrentJob,
    ...LIVE_KEYS.azPayloadCandidates
  ]);

  const CFG = {
    syncMs: 1500,
    maxCleanupRequestAgeMs: 120000,
    defaultReportHours: 4,
    maxReportHours: 48
  };

  const state = {
    lastSeen: Object.create(null),
    lastCleanupRequestKey: '',
    cleanupListenerAttached: false
  };

  const AUTO_CLEAR_EXACT_KEYS = new Set([
    'tm_az_home_auto_payload_v1',
    'tm_az_stage_runner_payload_v1',
    'tm_az_payload_v1',
    'tm_az_current_job_v1',
    'tm_alta_current_job_v1',
    'tm_apex_home_bot_payload_v1',
    'tm_apex_home_bot_ready_v1',
    'tm_apex_home_bot_active_row_v1',
    'tm_alta_home_quote_grab_payload_v1',
    'tm_alta_auto_quote_grab_payload_v1',
    'tm_alta_webhook_bundle_v1',
    'tm_alta_webhook_submit_sent_meta_v17',
    'tm_alta_webhook_submit_url_v17',
    'tm_alta_webhook_submit_stopped_v17',
    'tm_alta_webhook_post_success_v1',
    'tm_alta_webhook_post_success_consumed_v1',
    'tm_az_ticket_finisher_wake_v1',
    'tm_alta_force_send_now_v1',
    'tm_alta_shared_failure_selector_sent_v1',
    'tm_alta_payload_mirror_close_signal_v1',
    'tm_alta_payload_mirror_lex_close_consumed_signal_v1',
    'tm_alta_payload_mirror_ignore_close_lease_v1',
    'tm_alta_payload_mirror_last_handled_signal_v1',
    'tm_alta_payload_mirror_close_attempted_v1',
    'tm_az_alta_final_payload_v1',
    'tm_az_alta_final_payload_ready_v1',
    'tm_az_missing_payload_fallback_trigger_v1',
    'tm_alta_header_timeout_runtime_v2',
    'tm_alta_header_timeout_sent_events_v2',
    'tm_alta_flow_stage_v1',
    ...DISABLED_AUTO_LOG_KEYS,
    'hb_shared_az_to_alta_ticket_handoff_v1',
    'hb_shared_az_to_alta_ticket_handoff_last_applied_v1',
    'hb_shared_az_to_alta_ticket_handoff_stop_v1'
  ]);

  const AUTO_CLEAR_PREFIXES = [
    'aqb_',
    'tm_alta_payload_mirror_'
  ];

  const MANUAL_PRESERVE_EXACT_KEYS = new Set([
    'tm_alta_header_timeout_selector_rules_v1',
    'tm_alta_header_timeout_enabled_v1',
    'tm_az_ticket_finisher_field_targets_v1',
    'tm_az_ticket_finisher_tag_targets_v1'
  ]);

  const MANUAL_PRESERVE_PATTERNS = [
    /_panel_pos_/i,
    /_field_targets_/i,
    /_tag_targets_/i,
    /_selector_rules_/i,
    /_logs_open_/i,
    /_hidden_/i
  ];

  if (document.getElementById(UI_ID)) return;

  function isAzHost() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function isApexHost() {
    return location.hostname === 'farmersagent.lightning.force.com';
  }

  function isAltaHost() {
    return /^alta\.farmers\.com$/i.test(location.hostname);
  }

  function safeNowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      '_',
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds())
    ].join('');
  }

  function formatLocalDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '(invalid date)';
    const pad = (n) => String(n).padStart(2, '0');
    return [
      date.getFullYear(),
      '-',
      pad(date.getMonth() + 1),
      '-',
      pad(date.getDate()),
      ' ',
      pad(date.getHours()),
      ':',
      pad(date.getMinutes()),
      ':',
      pad(date.getSeconds())
    ].join('');
  }

  function toast(msg, ms = 2200) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      Object.assign(el.style, {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: '2147483647',
        background: 'rgba(20,20,20,0.95)',
        color: '#fff',
        fontSize: '12px',
        lineHeight: '1.35',
        padding: '8px 10px',
        borderRadius: '8px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
        maxWidth: '360px',
        opacity: '0',
        transition: 'opacity 140ms ease',
        pointerEvents: 'none',
        fontFamily: 'Arial, sans-serif'
      });
      document.body.appendChild(el);
    }

    el.textContent = msg;
    el.style.opacity = '1';

    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, ms);
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function prettyValue(raw) {
    if (raw == null) return 'null';

    if (typeof raw !== 'string') {
      try {
        return JSON.stringify(raw, null, 2);
      } catch {
        return String(raw);
      }
    }

    const parsed = safeJsonParse(raw);
    if (parsed !== null) {
      try {
        return JSON.stringify(parsed, null, 2);
      } catch {
        return raw;
      }
    }

    return String(raw);
  }

  function getAllTrackedKeys(storageObj) {
    const found = new Set();

    try {
      for (let i = 0; i < storageObj.length; i++) {
        const k = storageObj.key(i);
        if (!k) continue;

        if (isTrackedKey(k)) {
          found.add(k);
        }
      }
    } catch (err) {
      console.error('[AZ+APEX+Alta Storage Tools] Failed reading keys:', err);
    }

    return [...found].sort((a, b) => a.localeCompare(b));
  }

  function collectStorageSnapshot(storageName, storageObj) {
    const keys = getAllTrackedKeys(storageObj);
    const items = [];

    for (const key of keys) {
      let value = null;
      try {
        value = storageObj.getItem(key);
      } catch (err) {
        value = `[[ERROR READING VALUE: ${err && err.message ? err.message : String(err)}]]`;
      }

      items.push({
        key,
        value,
        pretty: prettyValue(value)
      });
    }

    return {
      storageName,
      count: items.length,
      items
    };
  }

  function buildStorageSection(snapshot) {
    const lines = [];
    lines.push(`=== ${snapshot.storageName.toUpperCase()} TRACKED KEYS (${snapshot.count}) ===`);
    lines.push('');

    if (!snapshot.items.length) {
      lines.push('(none)');
      lines.push('');
      return lines.join('\n');
    }

    for (const item of snapshot.items) {
      lines.push(`KEY: ${item.key}`);
      lines.push('VALUE:');
      lines.push(item.pretty);
      lines.push('');
      lines.push('----------------------------------------');
      lines.push('');
    }

    return lines.join('\n');
  }

  function buildCurrentOriginSpecialSection() {
    const lines = [];
    lines.push('=== CURRENT ORIGIN SPECIAL KEYS CHECK ===');
    lines.push('');

    const specialKeys = [
      ...LIVE_KEYS.azPayloadCandidates,
      LIVE_KEYS.apexPayload,
      LIVE_KEYS.apexReady,
      LIVE_KEYS.apexActiveRow,
      LIVE_KEYS.AltaHomePayload,
      LIVE_KEYS.sharedCurrentJob
    ];

    const seen = new Set();

    for (const key of specialKeys) {
      if (!key || seen.has(key)) continue;
      seen.add(key);

      let localVal = null;
      let sessionVal = null;

      try { localVal = localStorage.getItem(key); } catch {}
      try { sessionVal = sessionStorage.getItem(key); } catch {}

      const localPresent = localVal !== null;
      const sessionPresent = sessionVal !== null;

      lines.push(`KEY: ${key}`);
      lines.push(`- localStorage present: ${localPresent ? 'YES' : 'NO'}`);
      if (localPresent) {
        lines.push('- localStorage value:');
        lines.push(prettyValue(localVal));
      }
      lines.push(`- sessionStorage present: ${sessionPresent ? 'YES' : 'NO'}`);
      if (sessionPresent) {
        lines.push('- sessionStorage value:');
        lines.push(prettyValue(sessionVal));
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  function getCachedRecord(cacheKey) {
    try {
      return GM_getValue(cacheKey, null);
    } catch {
      return null;
    }
  }

  function setCachedRecord(cacheKey, sourceKey, rawValue) {
    const payload = {
      cacheKey,
      sourceKey,
      sourceHost: location.host,
      sourceOrigin: location.origin,
      sourceUrl: location.href,
      savedAt: new Date().toISOString(),
      valueRaw: rawValue
    };

    try {
      GM_setValue(cacheKey, payload);
    } catch (err) {
      console.error('[AZ+APEX+Alta Storage Tools] Failed writing shared cache:', err);
    }
  }

  function clearCachedRecord(cacheKey) {
    try {
      GM_deleteValue(cacheKey);
    } catch {}
  }

  function listAllGmKeysSafe() {
    try {
      const keys = GM_listValues();
      return Array.isArray(keys) ? keys : [];
    } catch {
      return [];
    }
  }

  function isTrackedKey(key) {
    if (!key) return false;
    if (TRACKED_PREFIXES.some(prefix => key.startsWith(prefix))) return true;
    return EXACT_TRACKED_KEYS.has(key);
  }

  function readFromSource(sourceName, key) {
    try {
      if (sourceName === 'localStorage') return localStorage.getItem(key);
      if (sourceName === 'sessionStorage') return sessionStorage.getItem(key);
    } catch {}
    return null;
  }

  function syncOneCache(cacheKey, sourceKey, sources) {
    let rawValue = null;

    for (const sourceName of sources) {
      rawValue = readFromSource(sourceName, sourceKey);
      if (rawValue !== null) break;
    }

    if (rawValue === null) return;

    const lastKey = `${cacheKey}__lastRaw`;
    if (state.lastSeen[lastKey] === rawValue) return;

    state.lastSeen[lastKey] = rawValue;
    setCachedRecord(cacheKey, sourceKey, rawValue);
  }

  function syncCacheFromCandidates(cacheKey, candidateKeys, sources) {
    for (const key of candidateKeys) {
      for (const sourceName of sources) {
        const rawValue = readFromSource(sourceName, key);
        if (rawValue === null) continue;

        const lastKey = `${cacheKey}__lastRaw`;
        const lastSourceKey = `${cacheKey}__lastSourceKey`;

        if (state.lastSeen[lastKey] === rawValue && state.lastSeen[lastSourceKey] === key) {
          return;
        }

        state.lastSeen[lastKey] = rawValue;
        state.lastSeen[lastSourceKey] = key;
        setCachedRecord(cacheKey, key, rawValue);
        return;
      }
    }
  }

  function syncSharedLogKeys() {
    // Mirror the current origin's per-script log keys into storage-tools'
    // own GM namespace so an export triggered from ANY origin can reach
    // every script's logs. This piggybacks on the shared-GM-by-@namespace
    // behavior already used by setCachedRecord() for payload mirroring.
    let keys;
    try { keys = Object.keys(localStorage); } catch { return; }
    for (const key of keys) {
      if (!isLogKey(key)) continue;
      let rawValue;
      try { rawValue = localStorage.getItem(key); } catch { continue; }
      if (rawValue == null) continue;
      const lastKey = `${key}__lastRaw`;
      if (state.lastSeen[lastKey] === rawValue) continue;
      state.lastSeen[lastKey] = rawValue;
      const parsed = safeJsonParse(rawValue);
      if (!parsed || typeof parsed !== 'object') continue;
      try { GM_setValue(key, parsed); } catch {}
    }
  }

  function syncSharedCaches() {
    syncSharedLogKeys();

    if (isAzHost()) {
      syncCacheFromCandidates(CACHE_KEYS.azPayload, LIVE_KEYS.azPayloadCandidates, ['localStorage', 'sessionStorage']);
    }

    if (isApexHost()) {
      syncOneCache(CACHE_KEYS.apexPayload, LIVE_KEYS.apexPayload, ['localStorage', 'sessionStorage']);
      syncOneCache(CACHE_KEYS.apexReady, LIVE_KEYS.apexReady, ['localStorage', 'sessionStorage']);
      syncOneCache(CACHE_KEYS.apexActiveRow, LIVE_KEYS.apexActiveRow, ['localStorage', 'sessionStorage']);
    }

    if (isAltaHost()) {
      syncOneCache(CACHE_KEYS.AltaHomePayload, LIVE_KEYS.AltaHomePayload, ['localStorage', 'sessionStorage']);
    }
  }

  function buildCachedSection(title, record) {
    const lines = [];
    lines.push(`=== ${title} ===`);
    lines.push('');

    if (!record || record.valueRaw == null) {
      lines.push('(not cached yet)');
      lines.push('');
      return lines.join('\n');
    }

    lines.push(`SOURCE KEY: ${record.sourceKey || ''}`);
    lines.push(`SOURCE HOST: ${record.sourceHost || ''}`);
    lines.push(`SOURCE ORIGIN: ${record.sourceOrigin || ''}`);
    lines.push(`SOURCE URL: ${record.sourceUrl || ''}`);
    lines.push(`CACHED AT: ${record.savedAt || ''}`);
    lines.push('');
    lines.push('VALUE:');
    lines.push(prettyValue(record.valueRaw));
    lines.push('');
    return lines.join('\n');
  }

  function exportTxt() {
    try {
      syncSharedCaches();

      const localSnap = collectStorageSnapshot('localStorage', localStorage);
      const sessionSnap = collectStorageSnapshot('sessionStorage', sessionStorage);

      const totalTracked = localSnap.count + sessionSnap.count;

      const azPayloadCache = getCachedRecord(CACHE_KEYS.azPayload);
      const apexPayloadCache = getCachedRecord(CACHE_KEYS.apexPayload);
      const apexReadyCache = getCachedRecord(CACHE_KEYS.apexReady);
      const apexActiveRowCache = getCachedRecord(CACHE_KEYS.apexActiveRow);
      const AltaHomePayloadCache = getCachedRecord(CACHE_KEYS.AltaHomePayload);

      const parts = [];
      parts.push('AZ + APEX + Alta STORAGE EXPORT');
      parts.push('');
      parts.push(`URL: ${location.href}`);
      parts.push(`HOST: ${location.host}`);
      parts.push(`ORIGIN: ${location.origin}`);
      parts.push(`EXPORTED AT: ${new Date().toISOString()}`);
      parts.push('NOTE: Browser storage is origin-specific. Current-origin tracked keys are exported below. Mirrored payloads are also exported from shared cache when available.');
      parts.push('TIP: Open AZ once, APEX once, and Alta once after installing this script so all mirrored payload caches get captured.');
      parts.push(`TOTAL CURRENT-ORIGIN TRACKED KEYS FOUND: ${totalTracked}`);
      parts.push('');
      parts.push(buildCurrentOriginSpecialSection());
      parts.push('');
      parts.push(buildStorageSection(localSnap));
      parts.push('');
      parts.push(buildStorageSection(sessionSnap));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED AZ PAYLOAD', azPayloadCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED APEX PAYLOAD', apexPayloadCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED APEX READY', apexReadyCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED APEX ACTIVE ROW', apexActiveRowCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED Alta HOME QUOTE PAYLOAD', AltaHomePayloadCache));
      parts.push('');

      const txt = parts.join('\n');
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const fileName = `az-apex-Alta-storage-export_${location.host.replace(/[^\w.-]+/g, '_')}_${safeNowStamp()}.txt`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);

      const haveAz = !!(azPayloadCache && azPayloadCache.valueRaw != null);
      const haveApex = !!(apexPayloadCache && apexPayloadCache.valueRaw != null);
      const haveHome = !!(AltaHomePayloadCache && AltaHomePayloadCache.valueRaw != null);

      toast(`Exported. AZ: ${haveAz ? 'YES' : 'NO'} | APEX: ${haveApex ? 'YES' : 'NO'} | HOME: ${haveHome ? 'YES' : 'NO'}`);
    } catch (err) {
      console.error('[AZ+APEX+Alta Storage Tools] Export failed:', err);
      toast('Export failed');
    }
  }

  function isLogKey(key) {
    if (typeof key !== 'string' || !key.endsWith(LOG_KEY_SUFFIX)) return false;
    if (DISABLED_AUTO_LOG_KEYS.has(key)) return false;
    return TRACKED_PREFIXES.some(prefix => key.startsWith(prefix));
  }

  function collectAllLogRecords() {
    // Merge logs from localStorage, sessionStorage, and GM storage. Each
    // record is { key, value, source }. GM is filled by the running
    // origin's scripts; storage-tools already mirrors cross-origin state
    // on a timer so by the time the operator clicks LOGS TXT, GM should
    // carry logs from all three origins' scripts.
    const byKey = new Map();
    const take = (key, rawValue, source) => {
      if (!isLogKey(key)) return;
      let value = rawValue;
      if (typeof value === 'string') value = safeJsonParse(value) ?? value;
      if (!value || typeof value !== 'object') return;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { key, value, source });
        return;
      }
      const existingAt = Date.parse(existing.value?.updatedAt || '') || 0;
      const candidateAt = Date.parse(value?.updatedAt || '') || 0;
      if (candidateAt > existingAt) byKey.set(key, { key, value, source });
    };

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) take(key, localStorage.getItem(key), 'localStorage');
      }
    } catch {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) take(key, sessionStorage.getItem(key), 'sessionStorage');
      }
    } catch {}
    try {
      const gmKeys = typeof GM_listValues === 'function' ? GM_listValues() : [];
      for (const key of gmKeys || []) take(key, GM_getValue(key, null), 'GM');
    } catch {}

    return Array.from(byKey.values()).sort((a, b) => {
      const oa = originRank(a.value?.origin || '');
      const ob = originRank(b.value?.origin || '');
      if (oa !== ob) return oa - ob;
      return String(a.value?.script || a.key).localeCompare(String(b.value?.script || b.key));
    });
  }

  function originRank(origin) {
    const o = String(origin || '');
    if (o.includes('agencyzoom.com')) return 0;
    if (o.includes('lightning.force.com')) return 1;
    if (o.includes('alta.farmers.com')) return 2;
    return 9;
  }

  function buildLogsTxt(records) {
    const parts = [];
    parts.push('AZ + APEX + Alta SCRIPT LOG EXPORT');
    parts.push('');
    parts.push('WARNING: This file may contain customer names, addresses, ticket IDs,');
    parts.push('and other sensitive data from operator logs. Do NOT share outside the team.');
    parts.push('');
    parts.push(`EXPORTED AT: ${new Date().toISOString()}`);
    parts.push(`EXPORTED FROM: ${location.origin}`);
    parts.push(`SCRIPTS CAPTURED: ${records.length}`);
    parts.push('');

    if (!records.length) {
      parts.push('(no log buffers were found â€” install the latest script versions or trigger some activity first)');
      return parts.join('\n');
    }

    for (const record of records) {
      const v = record.value || {};
      const lines = Array.isArray(v.lines) ? v.lines : [];
      parts.push('==============================');
      parts.push(`${v.script || '(unknown script)'} v${v.version || '?'}`);
      parts.push(`Origin:  ${v.origin || '(unknown)'}`);
      parts.push(`Updated: ${v.updatedAt || '(unknown)'}`);
      parts.push(`Source:  ${record.source}`);
      parts.push(`Key:     ${record.key}`);
      parts.push(`Lines:   ${lines.length}`);
      parts.push('==============================');
      if (!lines.length) {
        parts.push('(empty buffer)');
      } else {
        // state.logs is newest-first in every script; reverse so the export
        // reads chronologically top-to-bottom.
        for (const line of [...lines].reverse()) parts.push(String(line));
      }
      parts.push('');
    }

    return parts.join('\n');
  }

  function promptReportHours() {
    const raw = window.prompt(
      `Export a merged timeline report for the last how many hours?\n` +
      `Enter a number between 1 and ${CFG.maxReportHours}.`,
      String(CFG.defaultReportHours)
    );
    if (raw == null) return null;
    const hours = Number(String(raw).trim());
    if (!Number.isFinite(hours) || hours <= 0) {
      toast('Report cancelled: invalid hour value');
      return null;
    }
    return Math.min(CFG.maxReportHours, Math.max(1, hours));
  }

  function getOriginShortLabel(origin) {
    const value = String(origin || '');
    if (value.includes('agencyzoom.com')) return 'AZ';
    if (value.includes('lightning.force.com')) return 'APEX';
    if (value.includes('alta.farmers.com')) return 'Alta';
    return value || 'UNKNOWN';
  }

  function parseTimedLogLine(rawLine, anchorUpdatedAt) {
    const line = String(rawLine || '');
    const match = line.match(/^\[(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)\]\s*(.*)$/i);
    if (!match) return null;

    const anchor = new Date(anchorUpdatedAt || Date.now());
    if (!Number.isFinite(anchor.getTime())) return null;

    let hours = Number(match[1]) % 12;
    if (String(match[4] || '').toUpperCase() === 'PM') hours += 12;

    const dated = new Date(anchor);
    dated.setHours(hours, Number(match[2]), Number(match[3]), 0);

    if ((dated.getTime() - anchor.getTime()) > (12 * 60 * 60 * 1000)) {
      dated.setDate(dated.getDate() - 1);
    }

    return {
      at: dated,
      message: match[5] || '',
      rawLine: line
    };
  }

  function collectTimedLogEvents(records, windowStartMs, windowEndMs) {
    const events = [];

    for (const record of records) {
      const value = record.value || {};
      const lines = Array.isArray(value.lines) ? [...value.lines].reverse() : [];
      for (const line of lines) {
        const parsed = parseTimedLogLine(line, value.updatedAt);
        if (!parsed) continue;
        const atMs = parsed.at.getTime();
        if (!Number.isFinite(atMs)) continue;
        if (atMs < windowStartMs || atMs > windowEndMs) continue;
        events.push({
          at: parsed.at,
          atMs,
          rawLine: parsed.rawLine,
          message: parsed.message,
          key: record.key,
          source: record.source,
          script: value.script || '(unknown script)',
          version: value.version || '?',
          origin: value.origin || '(unknown)',
          updatedAt: value.updatedAt || ''
        });
      }
    }

    return events.sort((a, b) => {
      if (a.atMs !== b.atMs) return a.atMs - b.atMs;
      const oa = originRank(a.origin);
      const ob = originRank(b.origin);
      if (oa !== ob) return oa - ob;
      return String(a.script).localeCompare(String(b.script));
    });
  }

  function extractAzIdFromOutcomeMessage(message) {
    const text = String(message || '');
    const tagged = text.match(/\bAZ\s+(\d+)\b/i);
    if (tagged) return tagged[1];
    return '';
  }

  function getOutcomeTypeFromMessage(message) {
    const text = String(message || '');

    if (
      /Applied tag:\s*Successful Quote/i.test(text) ||
      /Tag already applied\b.*current result\s*\(\s*Successful Quote\s*\)/i.test(text) ||
      /Tag already present:\s*Successful Quote/i.test(text)
    ) {
      return 'success';
    }

    if (
      /Applied tag:\s*Failed Quote/i.test(text) ||
      /Tag already applied\b.*current result\s*\(\s*Failed Quote\s*\)/i.test(text) ||
      /Tag already present:\s*Failed Quote/i.test(text)
    ) {
      return 'failed';
    }

    return '';
  }

  function summarizeOutcomeCounts(events) {
    const successIds = new Set();
    const failedIds = new Set();
    let successWithoutId = 0;
    let failedWithoutId = 0;
    const currentAzBySource = new Map();

    for (const event of events) {
      const text = String(event.message || event.rawLine || '');
      const sourceKey = `${event.origin || ''}||${event.script || ''}`;
      const runningMatch = text.match(/\bRunning finisher for AZ\s+(\d+)\b/i);
      if (runningMatch) currentAzBySource.set(sourceKey, runningMatch[1]);

      const outcomeType = getOutcomeTypeFromMessage(text);
      if (!outcomeType) continue;

      const azId = extractAzIdFromOutcomeMessage(text) || currentAzBySource.get(sourceKey) || '';

      if (outcomeType === 'success') {
        if (azId) successIds.add(azId);
        else successWithoutId += 1;
      }

      if (outcomeType === 'failed') {
        if (azId) failedIds.add(azId);
        else failedWithoutId += 1;
      }
    }

    return {
      success: successIds.size + successWithoutId,
      failed: failedIds.size + failedWithoutId
    };
  }

  function buildRecentReportTxt(records, hoursBack) {
    const now = new Date();
    const windowEndMs = now.getTime();
    const windowStartMs = windowEndMs - (hoursBack * 60 * 60 * 1000);
    const events = collectTimedLogEvents(records, windowStartMs, windowEndMs);
    const outcomes = summarizeOutcomeCounts(events);
    const grouped = new Map();
    const scriptCounts = new Map();

    for (const event of events) {
      if (!grouped.has(event.key)) grouped.set(event.key, []);
      grouped.get(event.key).push(event);

      const summaryKey = `${event.script}||${event.origin}`;
      const current = scriptCounts.get(summaryKey) || {
        script: event.script,
        origin: event.origin,
        count: 0
      };
      current.count += 1;
      scriptCounts.set(summaryKey, current);
    }

    const parts = [];
    parts.push('AZ + APEX + Alta TIMELINE REPORT');
    parts.push('');
    parts.push('WARNING: This file may contain customer names, addresses, ticket IDs,');
    parts.push('and other sensitive data from operator logs. Do NOT share outside the team.');
    parts.push('');
    parts.push(`EXPORTED AT: ${now.toISOString()}`);
    parts.push(`EXPORTED FROM: ${location.origin}`);
    parts.push(`WINDOW HOURS: ${hoursBack}`);
    parts.push(`WINDOW START: ${new Date(windowStartMs).toISOString()}`);
    parts.push(`WINDOW END: ${now.toISOString()}`);
    parts.push(`SCRIPTS SCANNED: ${records.length}`);
    parts.push(`SCRIPTS WITH EVENTS: ${grouped.size}`);
    parts.push(`EVENTS IN WINDOW: ${events.length}`);
    parts.push(`SUCCESS COUNT: ${outcomes.success}`);
    parts.push(`FAIL COUNT: ${outcomes.failed}`);
    parts.push('');

    if (!events.length) {
      parts.push('(no timed log lines were found in the selected window)');
      return parts.join('\n');
    }

    parts.push('=== SCRIPT SUMMARY ===');
    parts.push('');
    for (const entry of Array.from(scriptCounts.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.script).localeCompare(String(b.script));
    })) {
      parts.push(`${String(entry.count).padStart(4, ' ')} | ${getOriginShortLabel(entry.origin)} | ${entry.script}`);
    }
    parts.push('');
    parts.push('=== DIAGNOSTIC TIMELINE (CHRONOLOGICAL) ===');
    parts.push('');

    for (const event of events) {
      parts.push(
        `${formatLocalDateTime(event.at)} | ${getOriginShortLabel(event.origin)} | ${event.script}: ${event.message}`
      );
    }

    parts.push('');
    parts.push('=== MERGED TIMELINE ===');
    parts.push('');

    for (const event of events) {
      parts.push(
        `${formatLocalDateTime(event.at)} | ${getOriginShortLabel(event.origin)} | ${event.script} | ${event.rawLine}`
      );
    }

    parts.push('');
    parts.push('=== SOURCE WINDOWS ===');
    parts.push('');

    for (const record of records) {
      const recordEvents = grouped.get(record.key);
      if (!recordEvents || !recordEvents.length) continue;

      const value = record.value || {};
      parts.push('==============================');
      parts.push(`${value.script || '(unknown script)'} v${value.version || '?'}`);
      parts.push(`Origin:  ${value.origin || '(unknown)'}`);
      parts.push(`Updated: ${value.updatedAt || '(unknown)'}`);
      parts.push(`Source:  ${record.source}`);
      parts.push(`Key:     ${record.key}`);
      parts.push(`Lines:   ${recordEvents.length}`);
      parts.push('==============================');
      for (const event of recordEvents) parts.push(event.rawLine);
      parts.push('');
    }

    return parts.join('\n');
  }

  function exportLogsTxt() {
    try {
      syncSharedCaches();
      const records = collectAllLogRecords();
      const txt = buildLogsTxt(records);
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const fileName = `az-apex-Alta-logs_${location.host.replace(/[^\w.-]+/g, '_')}_${safeNowStamp()}.txt`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);

      toast(`Logs exported (${records.length} script${records.length === 1 ? '' : 's'})`);
    } catch (err) {
      console.error('[AZ+APEX+Alta Storage Tools] Log export failed:', err);
      toast('Log export failed');
    }
  }

  function exportRecentReportTxt() {
    try {
      const hoursBack = promptReportHours();
      if (hoursBack == null) return;

      syncSharedCaches();
      const records = collectAllLogRecords();
      const txt = buildRecentReportTxt(records, hoursBack);
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const fileName = `az-apex-Alta-report_${String(hoursBack).replace(/[^\d.]+/g, '_')}h_${location.host.replace(/[^\w.-]+/g, '_')}_${safeNowStamp()}.txt`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);

      toast(`Report exported for the last ${hoursBack} hour${hoursBack === 1 ? '' : 's'}`);
    } catch (err) {
      console.error('[AZ+APEX+Alta Storage Tools] Timeline report export failed:', err);
      toast('Timeline report export failed');
    }
  }

  function clearAllLogs() {
    try {
      if (typeof window.confirm === 'function') {
        const ok = window.confirm(
          'Clear the log buffers of every running script across AZ, APEX, and Alta?\n' +
          'Script UIs will empty within a couple of seconds. Continue?'
        );
        if (!ok) {
          toast('Log clear cancelled');
          return;
        }
      }

      const records = collectAllLogRecords();
      let localCount = 0;
      let sessionCount = 0;
      let gmCount = 0;

      for (const record of records) {
        try { if (localStorage.getItem(record.key) != null) { localStorage.removeItem(record.key); localCount++; } } catch {}
        try { if (sessionStorage.getItem(record.key) != null) { sessionStorage.removeItem(record.key); sessionCount++; } } catch {}
        try {
          if (typeof GM_deleteValue === 'function') { GM_deleteValue(record.key); gmCount++; }
        } catch {}
        // Drop the lastSeen cache so the next syncSharedLogKeys tick
        // re-mirrors the script's fresh (empty) buffer into GM.
        delete state.lastSeen[`${record.key}__lastRaw`];
      }

      for (const key of DISABLED_AUTO_LOG_KEYS) {
        try { if (localStorage.getItem(key) != null) { localStorage.removeItem(key); localCount++; } } catch {}
        try { if (sessionStorage.getItem(key) != null) { sessionStorage.removeItem(key); sessionCount++; } } catch {}
        try {
          if (typeof GM_deleteValue === 'function') { GM_deleteValue(key); gmCount++; }
        } catch {}
        delete state.lastSeen[`${key}__lastRaw`];
      }

      // Broadcast the clear-request signal so every running script empties
      // its in-memory buffer on its next log tick (2 s poll + storage event).
      const signal = { requestedAt: new Date().toISOString(), source: 'storage-tools' };
      try { localStorage.setItem(LOG_CLEAR_SIGNAL_KEY, JSON.stringify(signal)); } catch {}
      try { if (typeof GM_setValue === 'function') GM_setValue(LOG_CLEAR_SIGNAL_KEY, signal); } catch {}

      toast(`Cleared ${records.length} log buffer${records.length === 1 ? '' : 's'} (local ${localCount}, session ${sessionCount}, GM ${gmCount})`);
    } catch (err) {
      console.error('[AZ+APEX+Alta Storage Tools] Log clear failed:', err);
      toast('Log clear failed');
    }
  }

  function clearCachedRecords() {
    clearCachedRecord(CACHE_KEYS.azPayload);
    clearCachedRecord(CACHE_KEYS.apexPayload);
    clearCachedRecord(CACHE_KEYS.apexReady);
    clearCachedRecord(CACHE_KEYS.apexActiveRow);
    clearCachedRecord(CACHE_KEYS.AltaHomePayload);

    delete state.lastSeen[`${CACHE_KEYS.azPayload}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.azPayload}__lastSourceKey`];
    delete state.lastSeen[`${CACHE_KEYS.apexPayload}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.apexReady}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.apexActiveRow}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.AltaHomePayload}__lastRaw`];
  }

  function shouldAutoClearKey(key) {
    if (!key) return false;
    if (AUTO_CLEAR_EXACT_KEYS.has(key)) return true;
    return AUTO_CLEAR_PREFIXES.some(prefix => key.startsWith(prefix));
  }

  function shouldPreserveManualClearKey(key) {
    if (!key) return false;
    if (MANUAL_PRESERVE_EXACT_KEYS.has(key)) return true;
    return MANUAL_PRESERVE_PATTERNS.some((pattern) => pattern.test(key));
  }

  function shouldManualClearKey(key) {
    if (!key) return false;
    if (!isTrackedKey(key)) return false;
    return !shouldPreserveManualClearKey(key);
  }

  function clearTrackedKeysAndCaches(options = {}) {
    const {
      confirmFirst = true,
      autoMode = false,
      request = null
    } = options;

    const localKeys = getAllTrackedKeys(localStorage);
    const sessionKeys = getAllTrackedKeys(sessionStorage);
    const gmTrackedKeys = listAllGmKeysSafe().filter(isTrackedKey);

    const localTargets = autoMode ? localKeys.filter(shouldAutoClearKey) : localKeys.filter(shouldManualClearKey);
    const sessionTargets = autoMode ? sessionKeys.filter(shouldAutoClearKey) : sessionKeys.filter(shouldManualClearKey);
    const gmTargets = autoMode ? gmTrackedKeys.filter(shouldAutoClearKey) : gmTrackedKeys.filter(shouldManualClearKey);

    if (confirmFirst) {
      const ok = window.confirm(
        autoMode
          ? `Clear tracked AZ / APEX / Alta workflow data on this site now?\n\nCurrent origin:\n${location.origin}`
          : `Clear tracked AZ / APEX / Alta workflow data on this site and clear mirrored caches?\n\nSaved setup like selector rules and finisher targets will be kept.\n\nCurrent origin:\n${location.origin}`
      );
      if (!ok) return 0;
    }

    let cleared = 0;

    for (const key of localTargets) {
      try {
        localStorage.removeItem(key);
        cleared++;
      } catch (err) {
        console.error('[AZ+APEX+Alta Storage Tools] Failed clearing localStorage key:', key, err);
      }
    }

    for (const key of sessionTargets) {
      try {
        sessionStorage.removeItem(key);
        cleared++;
      } catch (err) {
        console.error('[AZ+APEX+Alta Storage Tools] Failed clearing sessionStorage key:', key, err);
      }
    }

    for (const key of gmTargets) {
      try {
        GM_deleteValue(key);
        cleared++;
      } catch (err) {
        console.error('[AZ+APEX+Alta Storage Tools] Failed clearing GM key:', key, err);
      }
    }

    clearCachedRecords();

    if (autoMode) {
      toast(`Auto-cleared ${cleared} workflow key${cleared === 1 ? '' : 's'} on ${location.hostname}.`, 1800);
      console.log('[AZ+APEX+Alta Storage Tools] Auto cleanup completed:', {
        origin: location.origin,
        azId: request && request.azId || '',
        cleared
      });
    } else {
      toast(`Cleared ${cleared} workflow key${cleared === 1 ? '' : 's'} + mirrored caches. Saved setup was kept.`, 1800);
    }

    return cleared;
  }

  function buildCleanupRequestKey(request) {
    return JSON.stringify([
      request && request.azId || '',
      request && request.requestedAt || ''
    ]);
  }

  function readCleanupRequest() {
    try {
      return GM_getValue(CLEANUP_REQUEST_KEY, null);
    } catch {
      return null;
    }
  }

  function handleCleanupRequest(request, reason = 'poll') {
    if (!request || request.ready !== true) return;
    const requestedMs = Date.parse(request.requestedAt || '');
    if (!Number.isFinite(requestedMs)) return;
    if ((Date.now() - requestedMs) > CFG.maxCleanupRequestAgeMs) return;
    const key = buildCleanupRequestKey(request);
    if (!key || state.lastCleanupRequestKey === key) return;
    state.lastCleanupRequestKey = key;
    clearTrackedKeysAndCaches({
      confirmFirst: false,
      autoMode: true,
      request
    });
  }

  function attachCleanupListener() {
    if (state.cleanupListenerAttached) return;
    state.cleanupListenerAttached = true;
    if (typeof GM_addValueChangeListener !== 'function') return;
    try {
      GM_addValueChangeListener(CLEANUP_REQUEST_KEY, (_name, _oldValue, newValue) => {
        handleCleanupRequest(newValue, 'listener');
      });
    } catch {}
  }

  function makeButton(label, titleText, bg, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.title = titleText;

    Object.assign(btn.style, {
      width: '72px',
      height: '26px',
      padding: '0 6px',
      border: '1px solid rgba(0,0,0,0.18)',
      borderRadius: '8px',
      background: bg,
      color: '#fff',
      fontSize: '11px',
      fontWeight: '700',
      lineHeight: '1',
      cursor: 'pointer',
      boxShadow: '0 3px 10px rgba(0,0,0,0.18)',
      fontFamily: 'Arial, sans-serif'
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.filter = 'brightness(1.06)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.filter = 'none';
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });

    return btn;
  }

  function mountUI() {
    if (!document.body || document.getElementById(UI_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = UI_ID;

    Object.assign(wrap.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: '2147483647',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      pointerEvents: 'auto'
    });

    const exportBtn = makeButton(
      'ALL TXT',
      'Export tracked current-origin keys plus mirrored AZ + APEX + Alta payloads',
      '#1f7a3d',
      exportTxt
    );

    const clearBtn = makeButton(
      'CLEAR',
      'Clear tracked current-origin workflow data and mirrored caches without deleting saved setup',
      '#b33a3a',
      () => clearTrackedKeysAndCaches({ confirmFirst: true, autoMode: false })
    );

    const logsExportBtn = makeButton(
      'LOGS TXT',
      'Download logs from every running script (AZ + APEX + Alta) as one TXT',
      '#1e5a9c',
      exportLogsTxt
    );

    const reportExportBtn = makeButton(
      'REPORT',
      'Prompt for a last-N-hours merged AZ + APEX + Alta timeline report (default 4 hours)',
      '#0f766e',
      exportRecentReportTxt
    );

    const logsClearBtn = makeButton(
      'CLEAR LOGS',
      'Empty the log buffers of every running script across all three origins',
      '#c56a1a',
      clearAllLogs
    );

    wrap.appendChild(exportBtn);
    wrap.appendChild(clearBtn);
    wrap.appendChild(logsExportBtn);
    wrap.appendChild(reportExportBtn);
    wrap.appendChild(logsClearBtn);
    document.body.appendChild(wrap);
  }

  function boot() {
    if (document.body) {
      mountUI();
    } else {
      const t = setInterval(() => {
        if (document.body) {
          clearInterval(t);
          mountUI();
        }
      }, 100);
    }

    syncSharedCaches();
    attachCleanupListener();
    handleCleanupRequest(readCleanupRequest(), 'boot');
    setInterval(syncSharedCaches, CFG.syncMs);
    setInterval(() => handleCleanupRequest(readCleanupRequest(), 'poll'), CFG.syncMs);
  }

  boot();
})();


