// ==UserScript==
// @name         GWPC Home Coverages + Risk Analysis
// @namespace    homebot.gwpc-home-coverages-risk-analysis
// @version      2.0.2
// @description  DEPRECATED. Merged into "GWPC Home Quote Extractor" v3.0+. This script is now a silent no-op stub kept only so Tampermonkey can deliver the deprecation update via the existing @updateURL. Safe to disable in Tampermonkey.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-home-coverages-risk-analysis/gwpc-home-coverages-risk-analysis.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/gwpc-home-coverages-risk-analysis/gwpc-home-coverages-risk-analysis.user.js
// ==/UserScript==

(function () {
  'use strict';
  // The Coverages edit phase, the initial Quote click, the Auto radio click,
  // the Re-Quote, the Dwelling/Coverages/Exclusions/Quote grab and the
  // shared-ticket-handoff hand-off all live in home-quote-grabber.user.js
  // v3.0+ now. This file intentionally does nothing so two scripts don't race
  // each other on the Coverages page during the rollout window.
  if (window.top !== window.self) return;
console.log('[GWPC Home Coverages + Risk Analysis] Deprecated v2.0.2 - merged into GWPC Home Quote Extractor v3.0+. This script is a no-op; safe to disable in Tampermonkey.');
})();
