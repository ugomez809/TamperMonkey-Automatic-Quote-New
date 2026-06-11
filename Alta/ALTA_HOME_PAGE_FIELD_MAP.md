# Alta Home Quote Page Field Map

Source: DOM dumps pasted on 2026-06-11 for the Alta home quote flow.

This is the working map for replacing the old GWPC/PolicyCenter portion of the
automation with Alta. AgencyZoom and APEX remain upstream/downstream; the main
change is the page automation and final quote payload shape.

## Page Order

1. `https://alta.farmers.com/quote/auto/personal-info`
2. `https://alta.farmers.com/quote/home/home-features`
3. `https://alta.farmers.com/quote/home/replacement-cost`
4. `https://alta.farmers.com/quote/home/home-coverage`

## Alta Scripts

- `alta-payload-bridge`: runs on AgencyZoom, APEX, and Alta. It mirrors the
  AgencyZoom/APEX job into Alta and mirrors the Alta final payload back to
  AgencyZoom. During migration it also writes GWPC-compatible final keys for the
  current AgencyZoom finisher.
- `alta-customer-info`: runs only on `auto/personal-info`.
- `alta-home-features`: runs only on `home/home-features`.
- `alta-replacement-cost`: runs only on `home/replacement-cost`.
- `alta-home-coverage`: runs only on `home/home-coverage`.

Each script folder now keeps a per-script updater beside the main script:
`<script>.user.js` and `<script>-updater.user.js`. Both files carry their own
Tampermonkey `@updateURL` and `@downloadURL` pointed at the matching raw GitHub
path in this repo.

## Selector Notes

- Angular Material IDs such as `mat-select-342` are dynamic and should be used
  only as a last resort.
- Prefer `data-test-id`, `formcontrolname`, `aria-label`, stable input `id`, or
  a visible label scoped to the nearest row/container.
- For coverage rows, the visible label and the row code/class are more useful
  than the transient `mat-select-*` IDs.

## 1. Customer Information/Home - personal-info

Old GWPC equivalent: mostly `gwpc-policy-info`, plus some home/address basics.

Observed page title: `Customer information (Home)`.

Observed insured party fields:

- First name: `data-control-name="firstName"`, input `id="firstName_0"`,
  `data_test_id="INPUT_TEXT_FIRST_NAME"`. Disabled/prefilled in dump.
- Last name: `data-control-name="lastName"`, input `id="lastName_0"`,
  `data_test_id="INPUT_TEXT_LAST_NAME"`. Disabled/prefilled in dump.
- Date of birth: `data-control-name="dateOfBirth"`, hidden input `id="P3"`,
  masked input `id="masked_dob"`. Disabled/prefilled in dump.
- Gender: `data-control-name="gender"`, `data_test_id="SELECT_PNI_GENDER"`.
  Disabled/prefilled as `Male` in dump.
- Married/domestic partnership: `data-control-name="maritalStatus"`,
  radio group `aria-label="Marital status"`, values `M` for Yes and `S` for No.
  No was checked in dump.
- Occupation: `data-control-name="occupation"`, optional select.

Observed home/customer fields:

- Street address: visible label `Street address`.
- City/state/zip: visible label `City, State, Zip Code`.
- Primary residence: radio group
  `aria-label="Is the home their current or soon-to-be primary residence?"`.
  Yes was checked in dump.
- Home type: visible label `What type of home is it?`, current value
  `Single family detached`.
- Home policy start date: input `id="policyStartDate"`,
  `aria-label="policy start date in the format of mmddyyyy."`, required.
- Business owner: radio group
  `aria-label="Is the customer a business owner?"`, values `yes`/`no`.
  No was checked in dump.
- Specialty units: radio group
  `aria-label="Does the customer own any specialty units?"`, values `yes`/`no`.
  No was checked in dump.
- Disclosures: no separate yes/no controls in this dump. The page says clicking
  Continue acknowledges the required credit/loss-history disclosures.
- Continue: `button[data-test-id="CONTINUE_BUTTON"]`.

Initial Alta automation behavior:

- Do not force gender unless Alta exposes it editable in another state.
- Keep marital status as payload/default; old GWPC forced `S`/No.
- Set/confirm primary residence as Yes.
- Set policy start date from the job payload. Fallback should be explicit before
  implementation.
- Set business owner to No unless payload says otherwise.
- Set specialty units to No unless payload says otherwise.
- Click Continue after disclosure acknowledgment rules are satisfied.

## 2. Home Features

Old GWPC equivalent: `dwelling-water-rule` and some dwelling fields previously
handled on the PolicyCenter quote pages.

Observed page title: `Home features`.

Address and links:

- Address line example: `511 E Q ST, WILMINGTON, CA 90744`.
- Map links: `data-test-id="Near_Maps_Launch"`,
  `data-test-id="Google_Maps_Launch"`, `data-test-id="Zillow_Launch"`.

Safety features:

- Fire alarm: `formcontrolname="firmAlarm"` (Alta spelling in DOM),
  `aria-label="Fire alarm"`, current value `No device`.
- Burglar alarm: `formcontrolname="burglarAlarm"`,
  `aria-label="Burglar alarm"`, current value `No device`.
- Water leak protection device: `formcontrolname="waterLeak"`,
  `aria-label="Water leak protection device"`, current value `No device`.
  Alta automation should not select/change this field.
- FORTIFIED Home certification:
  `formcontrolname="fortifiedHomeCertification"`,
  `aria-label="FORTIFIED Home certification"`, current value `Not certified`.

Wildfire mitigation risks:

- Fireline score is visible in page text.
- Wildfire community: `formcontrolname="locatedWildFireCommunityInd"`,
  values `yes`/`no`; No was checked in dump.
- Property-level wildfire inspection: `formcontrolname="propertyLevelInd"`,
  values `yes`/`no`; No was checked in dump.

Home details and roof:

- Year built: `id="yearBuilt"`, `name="yearBuilt"`,
  `data-test-id="YEAR_BUILT_INPUT"`.
- Livable square feet: `data-test-id="LIVABLE_SQUARE_FEET_INPUT"`.
- Roof materials: visible label `Roof materials`; multiselect autocomplete.
- Roofing style: visible label `Roofing style`; multiselect autocomplete.
- Roof replacement selector: `data-test-id="ROOF_REPLACEMENT_QUESTION"`.
- Roof age option: `id="ageofroofLabel-input"`, value `ageOfRoof`.
- Replacement year option: `id="replacementyearLabel-input"`,
  value `replacementYear`; replacement year was checked in dump.
- Replacement year input: `id="roofReplacementYearInput"`,
  `data-test-id="REPLACEMENT_YEAR_INPUT"`.

Unusual risks:

- Construction/major renovation: `formcontrolname="construction"`,
  values `yes`/`no`; No was checked in dump.
- Unrepaired structural damage:
  `formcontrolname="unrepairedStructuralDamage"`, values `yes`/`no`; No was
  checked in dump.
- Trampoline checkbox: `id="trampolinecheckbox-input"`,
  `formcontrolname="trampolinePresent"`.
- Pool checkbox: `id="poolcheckbox-input"`, `formcontrolname="poolPresent"`.
- Solar panels: `formcontrolname="solarPanelPresent"`, values `yes`/`no`.
  Yes was checked in the dump, but old GWPC automation forced Solar Panels = No.
- Plumbing: `formcontrolname="plumbing"`.
- Plumbing replaced in last 20 years:
  `formcontrolname="plumbingReplacedLast20Years"`,
  `data-test-id="PLUMBING_REPLACED_20_YEARS"`.
- Continue: submit button with text `Continue`.

Initial Alta automation behavior:

- Keep Fire/Burglar alarm as `No device` unless payload says otherwise.
- Do not apply the old GWPC water-device rule in Alta. Leave the water leak
  protection device as-is. In the outgoing AgencyZoom row, leave
  `Water Device?` empty for now.
- Set wildfire community and property-level inspection to No unless payload says
  otherwise.
- Leave/enter year built, square feet, roof material/style, and replacement year
  from Alta/payload as available.
- Keep construction and unrepaired structural damage as No.
- Ensure trampoline and pool are unchecked unless payload says otherwise.
- Set solar panels to No to match old GWPC behavior, unless the new Alta payload
  intentionally supplies Yes.

## 3. Replacement Cost

Old GWPC equivalent: create/read 360Value plus reconstruction-cost grab.

Observed main values:

- Replacement cost: `data-test-id="Currency"`, example `$351,000`.
- Recalculate button: `data-test-id="ReCalculate_Button"`, disabled in dump.
- Open 360Value link: `aria-label="Open 360Value with id A8I9-JH85 and version id 3"`.
- 360Value ID example: `A8I9-JH85`.
- 360Value ID Version example: `3`.
- Continue: `button[data-test-id="Continue_Button"]`.
- Back: `button[data-test-id="Back_Button"]`.

Observed primary home characteristic fields:

- `Property_Name Stories above ground`
- `Property_Name Garage style`
- `Property_Name Garage capacity`
- `Property_Name Bathroom types`
- `Property_Name Number of Full Baths`
- `Property_Name Flooring types`
- `Property_Name Percent FC_Values_Carpet`
- `Property_Name Percent FC_Values_Laminate`
- `Property_Name Percent FC_Values_Tile - Ceramic`
- `Property_Name Fireplaces`
- `Property_Name Number of FP_Values_Zero Clearance`
- `Property_Name Exterior wall construction`
- `Property_Name Exterior wall finish`
- `Property_Name Heating systems`
- `Property_Name Primary system`, current value `Forced Air`
- `Property_Name Number of HS_Values_Forced Air`
- `Property_Name Cooling systems`
- `Property_Name Number of CS_Values_Central AC`
- `Property_Name Overall quality grade`
- `Property_Name Foundation type`
- `Property_Name Foundation Shape`
- Add another garage link: `data-test-id="Add_Another_Garage_Link"`.

Initial Alta automation behavior:

- Grab replacement cost for the final payload.
- Grab 360Value ID/version if present.
- Continue without recalculating unless Alta requires recalculation after field
  edits.

## 4. Home Coverages

Old GWPC equivalent: `home-quote-grabber`, coverage changes, pricing grab, and
auto-discount pricing grab.

Observed page title: `Home coverages`.

Quote card:

- Quote card wrapper: `id="quoteCardCoverageCard"`.
- Presentment area: `id="review-presentment-card-container"`.
- Pay plan label/value:
  `data-test-id="TUI_REVIEW_COVERAGE_PAYPLAN_LABEL"` and
  `data-test-id="TUI_REVIEW_COVERAGE_PAYPLAN_VALUE"`.
- Policy start label/value:
  `data-test-id="TUI_REVIEW_COVERAGE_POLICY_DATE_LABEL"` and
  `data-test-id="TUI_REVIEW_COVERAGE_POLICY_DATE_VALUE"`.
- Risk segment: `data-test-id="TUI_QUOTE_PRESENTMENT_indicator"`.
- Quote card CTA: `data-test-id="TUI_REVIEW_COVERAGE_CARD_CTA"`.
  In one dump state it was `Recalculate`; an earlier match showed this same CTA
  can also be `Go` after selecting an action.
- Pricing appears in `.price-description`, `.price-main` or
  `.price-main-strike`, `.price-suffix`, and fee caption containers.
  The attached coverage dump currently shows a score/pricing error state:
  `$--/12 mo term`, `---`, and `including <$--> fees`.

Coverage controls:

- Template dropdown: visible label `Template`, current value `Standard`.
- Restore coverages: `data-test-id="RESTORE_COVERAGES"`,
  button `id="restore_coverages"`.
- Generic coverage dropdowns: `data-test-id="REVIEW-COVERAGE-DROPDOWN"`.
- Discounts/preferences:
  - `data-test-id="BUNDLE_DISCOUNT_Home buyer"`
  - `data-test-id="BUNDLE_DISCOUNT_Home/Auto"`
  - `data-test-id="BUNDLE_DISCOUNT_Home/Umbrella"`
  - `data-test-id="BUNDLE_DISCOUNT_Home/Earthquake"`

Observed coverage rows/codes:

- Policy deductibles: `All perils`, `Split water`.
- `24121`: `Dwelling (Cov A)`.
- `24404`: `Separate structures (Cov B)`.
- `24321`: `Personal property (Cov C)`.
- `24507`: `Loss of use (Cov D)`.
- `10624`: `Personal liability (Cov E)`.
- `10625`: `Guest medical (Cov F)`.
- `SPECIAL_LIMITS`: `Special limits`.
- `MAIN_SETTLEMENT_OPTION`: `Dwelling settlement option`.
- `23100`: `Personal property valuation`.
- `23104`: `Roof valuation`.
- `23109`: `Fence valuation`.
- `SEWER_AND_DRAIN`: `Sewer and drain`.
- `10626`: `Personal injury`.
- `20750`: `Limited leakage & seepage`.
- `20713`: `Limited mold`.
- `10604`: `Increased HOA loss assessment`.
- `10632`: `Cyber and identity shield`.
- `20743`: `Emergency mortgage assistance`.
- `20734`: `Equipment breakdown`.
- `20735`: `Service line`.
- `20614`: `Residence glass`.
- `20627`: `Wind or hail on trees, plants and shrubs`.
- `WORKERS_COMP`: `Worker's compensation`.

Initial Alta automation behavior:

- Set Standard quote values first, then grab pricing if the card has valid
  dollars.
- Apply Home/Auto discount, recalculate/quote again, then grab discounted pricing.
- If the CTA is `Recalculate`, click it and wait for a non-placeholder price.
- If quote card remains `$--`, `---`, `Score Err`, or `including <$--> fees`,
  treat the quote as blocked/error and send that result in the final payload.
- Old GWPC enhanced coverage values need to be remapped to Alta option texts:
  all perils, split water, separate structures, personal property, personal
  liability, extended replacement/settlement, and personal injury all have Alta
  equivalents on this page.

## Old GWPC Data Dependencies To Replace

- `tm_pc_current_job_v1` / `tm_shared_az_job_v1` should become Alta-oriented job
  keys or be aliased during migration.
- `tm_pc_home_quote_grab_payload_v1` should become the Alta home quote payload.
- `tm_pc_webhook_bundle_v1` and event name `az_to_gwpc_bundle` should become
  Alta-specific names/events.
- `tm_az_gwpc_final_payload_v1` and
  `tm_az_gwpc_final_payload_ready_v1` should become Alta-specific names.
- Header timeout keys using `tm_pc_*` should be renamed or wrapped so they no
  longer imply PolicyCenter.

## Open Items

- Confirm policy start date source and fallback rule.
- Confirm whether Alta should always force solar panels to No, or trust payload.
- Capture one successful home-coverage page after pricing resolves so we can
  verify `.price-main`/fees selectors in the good state.
- Decide final event/storage names for AgencyZoom/APEX/Alta payload handoff.
