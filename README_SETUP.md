# Availability Dashboard — two-file stock automation

Two live Excel files from one public Google Drive folder, rebuilt daily by GitHub Actions and published to GitHub Pages. No Google API, service account, or GitHub secrets.

## Required Drive files

Keep exactly these live filenames in the configured folder:

- `Availability Report.xlsx`
- `Stock.xlsx`

Configured folder:
`https://drive.google.com/drive/folders/1OiccpJ7WLxYVBSn6Gw9DMacK2ds0wW4j?usp=sharing`

The folder must stay **Anyone with the link → Viewer**.

## Installing this build

1. Extract this ZIP.
2. Upload every file and folder to the root of `Availability-Report`, replacing what is there.
3. Make sure `.github/workflows/refresh-dashboard.yml` is included.
4. **Settings → Pages → Source → GitHub Actions**.
5. **Actions → Refresh Availability Dashboard → Run workflow** once.
6. Wait for `build` and `deploy` to go green.
7. Open the dashboard and press `Ctrl + F5` once.

No GitHub secrets are required.

> **If your previous runs were failing:** they were. The old workflow pinned `actions/checkout@v7` and `actions/setup-python@v7`, neither of which exists — the job could not start. This build pins `@v6` for both, and adds a step that fails loudly if the build produces no rows instead of publishing an empty dashboard.

## Daily automation

The workflow runs every day at **11:30 AM Asia/Dhaka**, using the timezone-aware `schedule` syntax:

```yaml
on:
  schedule:
    - cron: '30 11 * * *'
      timezone: 'Asia/Dhaka'
```

Update or replace both live Drive files before 11:30 AM. The next run downloads both and rebuilds the dashboard.

The dashboard reads the schedule from the build itself, so the header can never advertise a refresh time the workflow does not run at. If the last successful build is more than 30 hours old, the header pill turns amber and a banner appears telling you to check the workflow — a silently failing schedule is now visible instead of showing stale numbers as if they were current.

## Stock merge rule

`Availability Report.xlsx` is the master for SKU metadata, Forecast, Summary, Zone and outlet reporting structure.

`Stock.xlsx` is the live stock source. Every refresh behaves as if the stock block `Detail!I:AKD` were replaced by Stock.xlsx:

1. Match the item by `ProductCode` / Detail `Code`.
2. Match the outlet by outlet-code column header.
3. Use the corresponding Stock.xlsx quantity.
4. Item missing from Stock.xlsx → stock **0** for all outlets for that item.
5. Availability outlet missing from Stock.xlsx → stock **0** for that outlet.
6. Extra Stock.xlsx outlets not in the Availability stock block are ignored.
7. Extra Stock.xlsx items not in Availability are ignored.

The Drive workbook is never edited. The dashboard calculates from the merged data inside the GitHub job.

## Availability and DOS

Stock availability uses the workbook threshold (`Summary!F6`, currently 1):

`Available = 1 when Stock >= threshold, otherwise 0`

Dynamic DOS uses the workbook rule controlled by `Summary!L6`:

`IF(Stock >= Forecast/30 × DOS Days, 1, Stock / (Forecast/30 × DOS Days))`

The dashboard supports 1–30 DOS days. `Summary!L6` sets the default, and the DOS control appears both in the sticky control bar and in the filter drawer. **The chosen DOS window lasts for the browser session only** — every new visit starts from the Excel default, so nobody inherits a 14-day setting from last month without noticing.

### Two rates, two meanings

| Metric | What it means |
| --- | --- |
| Stock availability | Share of outlet-SKU pairs with stock on hand. A simple in-stock rate. |
| DOS availability | Average coverage score per pair, where a pair with enough stock for the whole window scores 1 and a pair with half of it scores 0.5. |

Both are shown to one decimal in the interface and to two decimals in CSV exports.

### Counts are row counts

A SKU code carried on more than one list — the same item on both Core and KVI, for example — is one row per list. "SKU rows" therefore exceeds unique item codes, and the SKU KPI card states both. Rates are unaffected: they are computed over outlet-SKU pairs.

## Automated QA

The Data Quality panel reports, on every refresh:

- unique Availability SKUs matched to Stock.xlsx, and unmatched ones forced to zero
- Availability outlets matched to Stock.xlsx, unmatched ones forced to zero, extra Stock.xlsx outlets ignored
- cross-view reconciliation of the merged availability matrix
- SKU rows vs unique item codes, with the codes listed on two SKU types
- outlet-SKU pairs with a zero or blank Forecast (the workbook rule scores these as fully covered, which raises DOS availability)
- variance between the rebuilt availability and the workbook's own cached figure
- Detail outlets excluded from the reporting universe, and Summary outlets missing from Detail

A "How these numbers are calculated" section under the checks explains the two rates in plain language.

## The three views

- **SKU analytics** — type and SKU-wise availability, the SKU performance explorer, action-priority rankings and the SKU detail table.
- **Outlet view** — outlet KPIs, DOS bands, risk outlets, leader summary and outlet detail.
- **Outlet × SKU report** — every filtered outlet-SKU intersection with stock status, coverage days and DOS, plus a filtered CSV.

Switch views from the sticky control bar; the DOS control and the active-filter chips stay visible while you scroll.

### Reading the colours

Brand red is used for chrome only — buttons, the header, active states. It never encodes a value, so red in a chart or a number always means risk. Bars use a single blue that encodes magnitude only. Performance colour follows four severity tiers, and the tier name is always written next to the colour:

| Band | Tier |
| --- | --- |
| 90% and above | On target |
| 80%–<90% | Watch |
| 70%–<80% | At risk |
| Below 70% | Critical |

### Filters

Every analytical filter is a searchable checkbox multi-select with Select all, Clear all, cascading options, removable chips and a visible filter count:

- values selected inside one filter combine with **OR**
- different filters combine with **AND**
- each dropdown recalculates from every other active filter while ignoring its own selection
- choosing the first value from **All** narrows directly to that value
- shared Outlet and SKU dimensions stay synchronised across the three views
- temporarily incompatible selections stay visible with a zero count so you can remove them; values that disappear from refreshed source data are repaired automatically

Clicking a KPI card, a type card or a band adds a **separate, clearly labelled table-only filter** that never rewrites the sidebar. Clicking the same card again removes it.

Filter selections, the active view and the theme are remembered until you reset them.

### Outlet × SKU performance

The combined report builds its matching pairs once per filter change into typed arrays, then reuses them for the metrics, paging, sorting and export. Paging is effectively instant, and every column sorts — including DOS %, so the worst intersections are one click away.

Exports above 150,000 rows ask for confirmation first and state the row count and approximate file size, because a full 762,000-row CSV is roughly 90 MB and will struggle to open in Excel.

### Zone field

Zone support reads a `Zone` column in the `Summary` sheet. When the column is absent, the build records that and the dashboard hides every Zone filter and column instead of showing a control whose only value is "Not supplied". Add a `Zone` header with outlet-wise values to `Summary` and the next refresh brings all of them back with no code change.

## Accessibility and printing

- Every interactive card, band and table header is a real button or a keyboard-operable header with visible focus.
- Colour is never the only carrier of meaning: severity tiers ship with a tier name and a distinct marker shape.
- Body text is 12px or larger throughout; percentages use tabular figures so columns line up.
- The interface follows the system light/dark preference and remembers an explicit choice.
- `Ctrl/Cmd + P` prints the current view with the chrome stripped. The **Summary report** button opens a dedicated two-page A4 landscape summary.
