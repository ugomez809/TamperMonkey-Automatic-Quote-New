# TamperMonkey Automatic Quote New

Working repo for the new Alta Home quote automation workflow.

The intended workflow starts in AgencyZoom, passes through Apex, opens Alta, completes a Home quote while collecting quote information, then returns to AgencyZoom to finish the ticket with the quote results.

## Alta Home Quote Pages

The Alta-side scripts for this project should run only on these Home quote pages:

| Page | URL |
| --- | --- |
| Personal Info | `https://alta.farmers.com/quote/auto/personal-info` |
| Home Features | `https://alta.farmers.com/quote/home/home-features` |
| Replacement Cost | `https://alta.farmers.com/quote/home/replacement-cost` |
| Home Coverage | `https://alta.farmers.com/quote/home/home-coverage` |

## Layout

### AgencyZoom

Active AgencyZoom scripts live in `AgencyZoom/`.

| Folder | Purpose |
| --- | --- |
| `az-pipeline-keeper/` | Keeps the AgencyZoom pipeline tab alive and manages extra AgencyZoom/Zillow tabs. |
| `az-stage-runner/` | Starts the Home quote workflow from AgencyZoom and publishes the job payload for APEX/Alta. |
| `az-ticket-finisher-tagger/` | Reads the Alta final payload back in AgencyZoom, updates the ticket, adds the note/tag, and completes it. |
| `az-zillow-ticket-enricher/` | Enriches AgencyZoom tickets with Zillow data before the quote workflow continues. |
| `global-clear-launcher/` | Clears workflow storage and opens AgencyZoom, APEX, and Alta cleanly. |
| `storage-tools/` | Exports, mirrors, and clears tracked AgencyZoom/APEX/Alta workflow storage. |

### Apex-LEX

Active APEX scripts live in `Apex-LEX/`.

| Folder | Purpose |
| --- | --- |
| `apex-continue-new-quote/` | Continues the APEX Home quote flow. The Alta-ineligible checkbox auto-click has been removed. |
| `apex-duplicates-continue/` | Handles the APEX duplicate-check screen and continues the quote flow. |
| `apex-multi-agency-continue/` | Handles the APEX multi-agency screen and clicks Next when needed. |

### Alta

Active Alta Home quote scripts live in `Alta/`.

| Folder | Purpose |
| --- | --- |
| `alta-payload-bridge/` | Mirrors AgencyZoom/APEX job data into Alta and returns Alta quote results to AgencyZoom. |
| `alta-customer-info/` | Runs on Alta customer information. |
| `alta-home-features/` | Runs on Alta home features. |
| `alta-replacement-cost/` | Runs on Alta replacement cost. |
| `alta-home-coverage/` | Runs on Alta home coverage and publishes quote data. |
| `alta-updater-installer/` | Opens only the active AgencyZoom/APEX/Alta updater install links. |

The old GWPC folders are retired no-op stubs kept only so already-installed
Tampermonkey scripts can update into harmless "safe to delete" scripts. They are
not part of the workflow and are not opened by the installer.

## Update URLs

The active Tampermonkey `@updateURL` and `@downloadURL` values point at this repo under:

`https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/...`

## Updater-Only Installer

Use this single installer to open the updater script install tabs for the hosted AgencyZoom, APEX, and Alta quoting scripts:

`https://raw.githubusercontent.com/ugomez809/TamperMonkey-Automatic-Quote-New/main/Alta/alta-updater-installer/alta-updater-installer.user.js`

The installer opens updater scripts only. The retired GWPC scripts are not part
of that list.
