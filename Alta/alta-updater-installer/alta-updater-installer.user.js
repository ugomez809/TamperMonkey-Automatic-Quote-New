// ==UserScript==
// @name         Alta Quoting Updater Installer
// @namespace    homebot.alta-updater-installer
// @version      0.2.2
// @description  Opens the updater-only install links for the AgencyZoom, APEX, and Alta quoting workflow.
// @author       OpenAI
// @match        https://github.com/ugomez809/TamperMonkey-Automatic-Quote-New*
// @match        https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-updater-installer/alta-updater-installer.user.js*
// @run-at       document-idle
// @noframes
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-updater-installer/alta-updater-installer.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-updater-installer/alta-updater-installer.user.js
// ==/UserScript==

(function () {
  'use strict';

  const UPDATERS = [
    ['AgencyZoom Quote Launcher + Payload Grabber Updater', 'AgencyZoom/az-stage-runner/az-stage-runner-updater.user.js'],
    ['AgencyZoom Ticket Finisher + Tagger Updater', 'AgencyZoom/az-ticket-finisher-tagger/az-ticket-finisher-tagger-updater.user.js'],
    ['Cross-Origin Global Clear Launcher Updater', 'AgencyZoom/global-clear-launcher/global-clear-launcher-updater.user.js'],
    ['Cross-Origin Storage Tools Updater', 'AgencyZoom/storage-tools/storage-tools-updater.user.js'],
    ['Cross-Origin UI Dock Organizer Updater', 'Alta/ui-dock-organizer/ui-dock-organizer-updater.user.js'],
    ['APEX Home Quote Continue Updater', 'Apex-LEX/apex-continue-new-quote/apex-continue-new-quote-updater.user.js'],
    ['APEX Duplicate Check Continue Updater', 'Apex-LEX/apex-duplicates-continue/apex-duplicates-continue-updater.user.js'],
    ['APEX Multi-Agency Continue Updater', 'Apex-LEX/apex-multi-agency-continue/apex-multi-agency-continue-updater.user.js'],
    ['Alta Payload Bridge Updater', 'Alta/alta-payload-bridge/alta-payload-bridge-updater.user.js'],
    ['Alta Customer Info Updater', 'Alta/alta-customer-info/alta-customer-info-updater.user.js'],
    ['Alta Home Features Updater', 'Alta/alta-home-features/alta-home-features-updater.user.js'],
    ['Alta Replacement Cost Updater', 'Alta/alta-replacement-cost/alta-replacement-cost-updater.user.js'],
    ['Alta Home Coverage Updater', 'Alta/alta-home-coverage/alta-home-coverage-updater.user.js'],
    ['Alta Quoting Updater Installer Updater', 'Alta/alta-updater-installer/alta-updater-installer-updater.user.js']
  ];

  const RAW_BASE = 'https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main';
  const INSTALL_DELAY_MS = 450;

  registerMenu();
  renderInstallerPanel();

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('Open quote updater install links', openUpdaterTabs);
    GM_registerMenuCommand('Copy quote updater install links', copyUpdaterLinks);
  }

  function renderInstallerPanel() {
    if (!document.body || document.getElementById('tm-alta-updater-installer')) return;

    const root = document.createElement('div');
    root.id = 'tm-alta-updater-installer';
    root.style.cssText = [
      'position:fixed',
      'right:18px',
      'bottom:18px',
      'z-index:2147483647',
      'width:320px',
      'max-width:calc(100vw - 28px)',
      'font:13px/1.4 Arial,sans-serif',
      'color:#17212b',
      'background:#ffffff',
      'border:1px solid #b8c2cc',
      'box-shadow:0 10px 24px rgba(0,0,0,.18)',
      'border-radius:8px',
      'padding:12px'
    ].join(';');

    root.innerHTML = [
      '<div style="font-weight:700;font-size:15px;margin-bottom:6px;">AgencyZoom + APEX + Alta updater installer</div>',
      `<div style="margin-bottom:10px;">Opens ${UPDATERS.length} updater-only Tampermonkey install tabs.</div>`,
      '<div style="display:flex;gap:8px;align-items:center;">',
      '<button type="button" data-action="open" style="flex:1;border:0;border-radius:6px;background:#1868db;color:#fff;font-weight:700;padding:8px 10px;cursor:pointer;">Open updaters</button>',
      '<button type="button" data-action="copy" style="border:1px solid #9aa8b5;border-radius:6px;background:#fff;color:#17212b;font-weight:700;padding:8px 10px;cursor:pointer;">Copy</button>',
      '<button type="button" data-action="close" aria-label="Close" style="border:0;background:transparent;color:#52616f;font-size:18px;line-height:1;cursor:pointer;">x</button>',
      '</div>',
      '<div data-status style="margin-top:8px;color:#52616f;"></div>'
    ].join('');

    root.addEventListener('click', (event) => {
      const action = event.target && event.target.getAttribute('data-action');
      if (action === 'open') openUpdaterTabs();
      if (action === 'copy') copyUpdaterLinks();
      if (action === 'close') root.remove();
    });

    document.body.appendChild(root);
  }

  function openUpdaterTabs() {
    setStatus(`Opening ${UPDATERS.length} updater install tabs...`);
    updaterLinks().forEach((url, index) => {
      window.setTimeout(() => openTab(url), index * INSTALL_DELAY_MS);
    });
    window.setTimeout(() => setStatus('Updater install tabs opened.'), UPDATERS.length * INSTALL_DELAY_MS + 250);
  }

  function copyUpdaterLinks() {
    const text = updaterLinks().join('\n');
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      setStatus('Updater links copied.');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setStatus('Updater links copied.'),
      () => setStatus('Clipboard unavailable.')
    );
  }

  function updaterLinks() {
    return UPDATERS.map((entry) => `${RAW_BASE}/${entry[1]}`);
  }

  function openTab(url) {
    if (typeof GM_openInTab === 'function') {
      GM_openInTab(url, { active: true, insert: true, setParent: true });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function setStatus(message) {
    const status = document.querySelector('#tm-alta-updater-installer [data-status]');
    if (status) status.textContent = message;
    console.info(`[Alta Updater Installer] ${message}`);
  }
})();
