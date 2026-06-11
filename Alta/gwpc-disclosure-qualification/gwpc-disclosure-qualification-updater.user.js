// ==UserScript==
// @name         GWPC Disclosure Qualification Updater
// @namespace    homebot.gwpc-disclosure-qualification.updater
// @version      0.1.0
// @description  Loads and auto-updates the GWPC Disclosure Qualification script from GitHub.
// @author       OpenAI
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @connect      raw.githubusercontent.com
// @connect      *
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-disclosure-qualification/gwpc-disclosure-qualification-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-disclosure-qualification/gwpc-disclosure-qualification-updater.user.js
// ==/UserScript==

(function () {
  'use strict';
  const LOADER_VERSION = '0.1.0';
  const TARGET_ID = 'gwpc-disclosure-qualification';
  const TARGET_LABEL = 'GWPC Disclosure Qualification';
  const TARGET_FILE = 'gwpc-disclosure-qualification.user.js';
  const BASE_URL = 'https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-disclosure-qualification';
  const CHECK_INTERVAL_MS = 30 * 1000;
  const RELOAD_DELAY_MS = 1200;
  const CACHE_KEY = `tmAltaPerScriptUpdater:${TARGET_ID}:code`;
  const VERSION_KEY = `tmAltaPerScriptUpdater:${TARGET_ID}:version`;
  const LAST_CHECK_KEY = `tmAltaPerScriptUpdater:${TARGET_ID}:lastCheck`;
  const RELOAD_KEY = `tmAltaPerScriptUpdater:${TARGET_ID}:reload`;
  let executed = false;
  let debugEnabled = false;
  let forceRequested = false;
  let clearRequested = false;
  let reloadQueued = false;
  boot();
  function boot() {
    applyOptionsFromUrl();
    registerMenu();
    if (clearRequested) clearCache();
    const cached = storageGet(CACHE_KEY, '');
    if (cached) executeTarget(cached, 'cache');
    checkForUpdates({ runIfNoCache: !cached, forceReload: forceRequested }).catch(warn);
    window.setInterval(() => checkForUpdates({ runIfNoCache: false, forceReload: false }).catch(warn), CHECK_INTERVAL_MS);
  }
  async function checkForUpdates(options = {}) {
    const remote = await fetchTarget();
    const cached = storageGet(CACHE_KEY, '');
    const remoteVersion = extractVersion(remote);
    storageSet(LAST_CHECK_KEY, String(Date.now()));
    if (!sameCode(remote, cached)) {
      storageSet(CACHE_KEY, remote);
      storageSet(VERSION_KEY, remoteVersion);
      if (options.runIfNoCache && !executed) {
        executeTarget(remote, 'remote');
        if (debugEnabled) showStatus(`Loaded v${remoteVersion}.`);
        return;
      }
      reloadOnce(remoteVersion, options.forceReload);
      return;
    }
    if (debugEnabled) showStatus(`Already current: v${remoteVersion}.`);
  }
  function executeTarget(code, source) {
    if (executed) return;
    executed = true;
    try {
      storageSet(VERSION_KEY, extractVersion(code));
      console.info(`[${TARGET_LABEL} Updater] Running target from ${source}.`);
      eval(`${code}\n//# sourceURL=${BASE_URL}/${TARGET_FILE}`);
    } catch (err) {
      executed = false;
      storageDelete(CACHE_KEY);
      console.error(`[${TARGET_LABEL} Updater] target execution failed`, err);
    }
  }
  function fetchTarget() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${BASE_URL}/${TARGET_FILE}?tmAltaUpdater=${Date.now()}`,
        timeout: 20000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) return reject(new Error(`HTTP ${response.status}`));
          const text = String(response.responseText || '').trim();
          if (!text.includes('// ==UserScript==')) return reject(new Error('response did not look like a userscript'));
          resolve(text);
        },
        onerror: () => reject(new Error('network request failed')),
        ontimeout: () => reject(new Error('request timed out'))
      });
    });
  }
  function reloadOnce(version, force) {
    if (reloadQueued) return;
    const signature = `${TARGET_ID}:${version}`;
    if (!force && sessionStorage.getItem(RELOAD_KEY) === signature) return;
    reloadQueued = true;
    sessionStorage.setItem(RELOAD_KEY, signature);
    window.setTimeout(() => location.reload(), RELOAD_DELAY_MS);
  }
  function applyOptionsFromUrl() {
    let url;
    try { url = new URL(location.href); } catch { return; }
    debugEnabled = truthy(url.searchParams.get('tmAltaUpdaterDebug')) || truthy(url.searchParams.get(`${TARGET_ID}UpdaterDebug`));
    forceRequested = truthy(url.searchParams.get('tmAltaUpdaterForce')) || truthy(url.searchParams.get(`${TARGET_ID}UpdaterForce`));
    clearRequested = truthy(url.searchParams.get('tmAltaUpdaterClear')) || truthy(url.searchParams.get(`${TARGET_ID}UpdaterClear`));
    if (forceRequested || clearRequested) sessionStorage.removeItem(RELOAD_KEY);
  }
  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand(`Check ${TARGET_LABEL} now`, () => checkForUpdates({ runIfNoCache: !executed, forceReload: true }).catch(warn));
    GM_registerMenuCommand(`Clear ${TARGET_LABEL} cache`, () => { clearCache(); location.reload(); });
  }
  function showStatus(message) { alert([`${TARGET_LABEL} updater v${LOADER_VERSION}`, message, `Cached: ${storageGet(VERSION_KEY, 'none')}`, `Last check: ${formatTime(storageGet(LAST_CHECK_KEY, ''))}`].join('\n')); }
  function clearCache() { storageDelete(CACHE_KEY); storageDelete(VERSION_KEY); storageDelete(LAST_CHECK_KEY); }
  function extractVersion(code) { const match = String(code || '').match(/^\/\/\s*@version\s+([^\s]+)/m); return match ? match[1] : 'unknown'; }
  function sameCode(left, right) { return normalizeCode(left) === normalizeCode(right); }
  function normalizeCode(value) { return String(value || '').replace(/\r\n?/g, '\n').trim(); }
  function storageGet(key, fallback) { try { return GM_getValue(key, fallback); } catch { return fallback; } }
  function storageSet(key, value) { try { GM_setValue(key, value); } catch {} }
  function storageDelete(key) { try { GM_deleteValue(key); } catch {} }
  function truthy(value) { return /^(1|true|yes|y)$/i.test(String(value || '')); }
  function formatTime(value) { const ms = Number(value || 0); return ms ? new Date(ms).toLocaleString() : 'never'; }
  function warn(err) { console.warn(`[${TARGET_LABEL} Updater]`, err); }
})();
