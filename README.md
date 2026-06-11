# TamperMonkey Automatic Quote New

Working repo for the new Alta Home quote automation workflow.

The intended workflow starts in AgencyZoom, passes through Apex/LEX, opens Alta/GWPC, completes a Home quote while collecting quote information, then returns to AgencyZoom to finish the ticket with the quote results.

## Layout

### Alta

Active Home quote scripts live in `Alta/`.

| Folder | Purpose |
| --- | --- |
| `dwelling-water-rule/` | Handles the Home Dwelling step and dwelling-related rule actions. |
| `gwpc-discard-unsaved-change/` | Clicks the GWPC discard-unsaved-change action when it appears. |
| `gwpc-disclosure-qualification/` | Handles Home Disclosure & Qualification. |
| `gwpc-header-timeout/` | Monitors GWPC header/page timeout behavior and retry/send signals. |
| `gwpc-home-coverages-risk-analysis/` | Deprecated stub retained for updater compatibility. |
| `gwpc-policy-info/` | Handles Home Policy Info fields and navigation. |
| `gwpc-popup-blocker/` | Blocks GWPC popup, confirm, prompt, and unload interruptions. |
| `home-quote-grabber/` | Captures Home quote, dwelling, coverage, and pricing payload data. |
| `payload-mirror-non-az-tab-closer/` | Mirrors final Home payload across tabs and closes non-AZ tabs after success. |
| `ui-dock-organizer/` | Organizes floating automation panels across AgencyZoom, Apex/LEX, and GWPC. |
| `webhook-submission/` | Sends the final Home quote payload to the configured webhook. |

### Not Needed

`Alta/Not Needed/` contains disabled Personal Auto placeholders that are being kept for reference and Tampermonkey updater continuity.

## Update URLs

The Tampermonkey `@updateURL` and `@downloadURL` values point at this repo under:

`https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/...`
