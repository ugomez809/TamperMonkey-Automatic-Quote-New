// ==UserScript==
// @name         13 AUTO AgencyZoom Zillow Ticket Enricher Updater
// @namespace    autoflow.az-zillow-ticket-enricher.updater
// @version      0.1.1
// @description  Loads and auto-updates the 13 AUTO AgencyZoom Zillow Ticket Enricher script from GitHub.
// @author       OpenAI
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @match        https://www.zillow.com/*
// @match        https://zillow.com/*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-end
// @noframes     
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// @connect      *
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-zillow-ticket-enricher/az-zillow-ticket-enricher-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-zillow-ticket-enricher/az-zillow-ticket-enricher-updater.user.js
// ==/UserScript==
(function () {
  'use strict';

  var LOADER_VERSION = '0.1.1';
  var TARGET_ID = "az-zillow-ticket-enricher";
  var TARGET_LABEL = "13 AUTO AgencyZoom Zillow Ticket Enricher";
  var TARGET_FILE = "az-zillow-ticket-enricher.user.js";
  var BASE_URL = "https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/AgencyZoom/az-zillow-ticket-enricher";
  var RUN_IN_PAGE_CONTEXT = false;
  var CHECK_INTERVAL_MS = 30 * 1000;
  var RELOAD_DELAY_MS = 1200;
  var CACHE_KEY = 'tmQuotePerScriptUpdater:' + TARGET_ID + ':code';
  var VERSION_KEY = 'tmQuotePerScriptUpdater:' + TARGET_ID + ':version';
  var LAST_CHECK_KEY = 'tmQuotePerScriptUpdater:' + TARGET_ID + ':lastCheck';
  var RELOAD_KEY = 'tmQuotePerScriptUpdater:' + TARGET_ID + ':reload';
  var executed = false;
  var debugEnabled = false;
  var forceRequested = false;
  var clearRequested = false;
  var reloadQueued = false;

  boot();

  function boot() {
    applyOptionsFromUrl();
    registerMenu();
    if (clearRequested) clearCache();

    var cached = storageGet(CACHE_KEY, '');
    if (cached) executeTarget(cached, 'cache');

    checkForUpdates({ runIfNoCache: !cached, forceReload: forceRequested }).catch(warn);
    window.setInterval(function () {
      checkForUpdates({ runIfNoCache: false, forceReload: false }).catch(warn);
    }, CHECK_INTERVAL_MS);
  }

  async function checkForUpdates(options) {
    options = options || {};
    var remote = await fetchTarget();
    var cached = storageGet(CACHE_KEY, '');
    var remoteVersion = extractVersion(remote);

    storageSet(LAST_CHECK_KEY, String(Date.now()));

    if (!sameCode(remote, cached)) {
      storageSet(CACHE_KEY, remote);
      storageSet(VERSION_KEY, remoteVersion);

      if (options.runIfNoCache && !executed) {
        executeTarget(remote, 'remote');
        if (debugEnabled) showStatus('Loaded v' + remoteVersion + '.');
        return;
      }

      reloadOnce(remoteVersion, options.forceReload);
      return;
    }

    if (debugEnabled) showStatus('Already current: v' + remoteVersion + '.');
  }

  function executeTarget(code, source) {
    if (executed) return;
    executed = true;

    try {
      storageSet(VERSION_KEY, extractVersion(code));
      console.info('[' + TARGET_LABEL + ' Updater] Running target from ' + source + '.');
      var sourceUrl = BASE_URL + '/' + TARGET_FILE;
      var runnable = code + '\n//# sourceURL=' + sourceUrl;

      if (RUN_IN_PAGE_CONTEXT) {
        var pageEval = (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow.eval)
          ? unsafeWindow.eval.bind(unsafeWindow)
          : window.eval.bind(window);
        pageEval(runnable);
        return;
      }

      eval(runnable);
    } catch (err) {
      executed = false;
      storageDelete(CACHE_KEY);
      console.error('[' + TARGET_LABEL + ' Updater] target execution failed', err);
    }
  }

  function fetchTarget() {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: BASE_URL + '/' + TARGET_FILE + '?tmQuoteUpdater=' + Date.now(),
        timeout: 20000,
        onload: function (response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('HTTP ' + response.status));
            return;
          }

          var remote = String(response.responseText || '').trim();
          if (!remote.includes('// ==UserScript==')) {
            reject(new Error('response did not look like a userscript'));
            return;
          }

          resolve(remote);
        },
        onerror: function () { reject(new Error('network request failed')); },
        ontimeout: function () { reject(new Error('request timed out')); }
      });
    });
  }

  function reloadOnce(version, force) {
    if (reloadQueued) return;

    var signature = TARGET_ID + ':' + version;
    if (!force && sessionStorage.getItem(RELOAD_KEY) === signature) return;

    reloadQueued = true;
    sessionStorage.setItem(RELOAD_KEY, signature);
    window.setTimeout(function () { location.reload(); }, RELOAD_DELAY_MS);
  }

  function applyOptionsFromUrl() {
    var url;
    try { url = new URL(location.href); } catch (err) { return; }

    debugEnabled = truthy(url.searchParams.get('tmQuoteUpdaterDebug')) || truthy(url.searchParams.get(TARGET_ID + 'UpdaterDebug'));
    forceRequested = truthy(url.searchParams.get('tmQuoteUpdaterForce')) || truthy(url.searchParams.get(TARGET_ID + 'UpdaterForce'));
    clearRequested = truthy(url.searchParams.get('tmQuoteUpdaterClear')) || truthy(url.searchParams.get(TARGET_ID + 'UpdaterClear'));

    if (forceRequested || clearRequested) sessionStorage.removeItem(RELOAD_KEY);
  }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand('Check ' + TARGET_LABEL + ' now', function () {
      checkForUpdates({ runIfNoCache: !executed, forceReload: true }).catch(warn);
    });
    GM_registerMenuCommand('Clear ' + TARGET_LABEL + ' cache', function () {
      clearCache();
      location.reload();
    });
  }

  function showStatus(message) {
    alert([
      TARGET_LABEL + ' updater v' + LOADER_VERSION,
      message,
      'Cached: ' + storageGet(VERSION_KEY, 'none'),
      'Last check: ' + formatTime(storageGet(LAST_CHECK_KEY, ''))
    ].join('\n'));
  }

  function clearCache() {
    storageDelete(CACHE_KEY);
    storageDelete(VERSION_KEY);
    storageDelete(LAST_CHECK_KEY);
  }

  function extractVersion(code) {
    var match = String(code || '').match(/^\/\/\s*@version\s+([^\s]+)/m);
    return match ? match[1] : 'unknown';
  }

  function sameCode(left, right) {
    return normalizeCode(left) === normalizeCode(right);
  }

  function normalizeCode(value) {
    return String(value || '').replace(/\r\n?/g, '\n').trim();
  }

  function storageGet(key, fallback) {
    try { return GM_getValue(key, fallback); } catch (err) { return fallback; }
  }

  function storageSet(key, value) {
    try { GM_setValue(key, value); } catch (err) {}
  }

  function storageDelete(key) {
    try { GM_deleteValue(key); } catch (err) {}
  }

  function truthy(value) {
    return /^(1|true|yes|y)$/i.test(String(value || ''));
  }

  function formatTime(value) {
    var ms = Number(value || 0);
    return ms ? new Date(ms).toLocaleString() : 'never';
  }

  function warn(err) {
    console.warn('[' + TARGET_LABEL + ' Updater]', err);
  }
})();
