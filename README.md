# Core · KVI · Promo · Ecom Availability Tracker — Next.js

Production-oriented **Next.js static-export** dashboard for GitHub Pages. Production data is downloaded from a public Google Drive folder and processed into the outlet × SKU availability universe **at build time**, in a scheduled/on-push GitHub Actions workflow — not in the browser. The browser only fetches the pre-built `processed/dashboard_data.json` and runs live filtering/aggregation over it, exactly as before. There is no server, no Apps Script bridge, no Google Cloud API key anywhere, and no manual "Load Data" step.

## Approved visual layout

The implementation follows the approved availability-dashboard visual direction:

- white/light theme by default;
- dark mode toggle;
- dark left sidebar with compact corporate cards/tables;
- Hide Sidebar / Show Sidebar;
- Required DOS in the top bar (red button), Hide/Show Filters beside the Global Filters heading;
- searchable, multi-select, cascading global filters, including Outlet Type (KVI / Non-KVI / E-COM Outlet) and KVI Outlet;
- five color-coded, enlarged Availability KPI cards (Overall, Core, KVI, Promo, Ecom);
- fixed-height, internally-scrollable tables with sticky headers and a per-table CSV download;
- Summary, SKU Wise Availability, Ecom SKU Wise Availability, Product Division, CAT3, RHO, Zonal, Outlets, Availability Loss Tree, Exceptions and Data Health.

UI preferences are stored in browser local storage.

## Production Google Drive source

Folder ID:

`1OiccpJ7WLxYVBSn6Gw9DMacK2ds0wW4j`

Keep exactly one current file with each exact name:

1. `Core, Promo, KVI.xlsx`
2. `stock.xlsx`
3. `DOS.xlsx`
4. `Zone Distribution.xlsx`
5. `Ecom.xlsx`
6. `KVI Outlet.xlsx` (optional — single-column `CODE` list, see [KVI Outlet mapping](#kvi-outlet-mapping) below)

Expected sheets:

- Classification → `C-P-K`
- Stock → `Sheet1`
- Sales → `DOS`
- Zone Distribution → `Final_Zone Dis`
- Ecom SKU → `ECOM SKU`
- Ecom Outlet → `ECOM OUTLET`
- KVI Outlet → `Sheet1` (single column, header `CODE`)

## Core/KVI/Promo availability universe

Analytical grain: **Outlet Code + SKU Code**.

The required Core/KVI/Promo universe is built before stock/sales joins:

- 989 outlets × 847 unique classified SKUs = **837,683 required slots** in the verified source.
- Core/KVI/Promo overlap is represented with boolean flags; no duplicated base slot.
- Missing sales rows remain in the denominator and become `No Sales` when sales quantity is zero/missing.

Calculations:

- ADS = 30-Day Sales Qty / 30
- ADS = 0 → DOS = N/A and Stock Status = No Sales
- otherwise DOS = Stock / ADS
- Required Stock = ADS × Required DOS
- Shortfall = MAX(Required Stock - Stock, 0)
- Available = numeric DOS >= selected Required DOS

Stock health with ADS > 0:

- OOS = Stock <= 0
- Low = DOS < 1
- At Risk = DOS >= 1 and <= 2
- Healthy = DOS > 2

## Ecom universe and important coverage rule

`Ecom.xlsx` contains two independent applicability lists:

- `ECOM SKU`: 10,721 rows → **10,710 unique Ecom SKU codes**
- `ECOM OUTLET`: **101 unique Ecom outlets**

The supplied `stock.xlsx` / `DOS.xlsx` are currently an 847-product extraction, not a full 10,710-SKU Ecom extraction. In the verified files:

- **827 of 10,710 Ecom SKUs** exist in Current Stock and can be scored reliably.
- **9,883 Ecom SKUs are data-not-covered** by the current stock extraction.
- all **101 Ecom outlets** exist in Zone Distribution, Current Stock and Sales sources.
- scored Ecom universe = 101 × 827 = **83,527 slots**.

To avoid a false Ecom unavailability result, the dashboard **does not treat the 9,883 stock-uncovered Ecom SKUs as zero stock**. They are disclosed as `Data Not Covered` and excluded from the Ecom availability denominator.

### Ecom availability rule (stock-quantity based, not DOS-based)

Ecom availability uses a different rule from the rest of the dashboard. A scored Ecom slot (outlet × covered SKU) is **available only when stock quantity meets the Required Ecom Stock threshold** (default **5** units) — sales and DOS play no role at all:

```
Ecom available = stock >= Required Ecom Stock
```

This is intentionally independent of the main dashboard's Required DOS rule. The **Required Ecom Stock** control sits next to Required DOS in the top bar and defaults to 5; it is adjustable (preset options 3/5/10/15, or a custom value) and only affects Ecom pages/cards — it has no effect on Core/KVI/Promo calculations, and Required DOS has no effect on Ecom.

Because status is no longer DOS-derived for Ecom, the Stock Status vocabulary is different there too: every scored Ecom slot is either **Sufficient Stock** (available) or **Below Threshold** (unavailable) — not the main dashboard's OOS/Low/At Risk/Healthy/No Sales bands, which would otherwise be able to show a status that contradicts the availability badge in the same row (e.g. "Healthy" but marked unavailable).

The Summary page shows Ecom Availability as a separate KPI. Ecom is not mixed into the Core/KVI/Promo denominator. The dedicated **SKU Wise Availability for Ecom** page shows an outlet-level table (**Outlet Wise Availability for Ecom**, lowest availability first) above the SKU-level analysis, an All/FM tab toggle on the SKU table, and the source-coverage note. Both tables use their own drill-down (`showEcomOutletDrill`/`showEcomSkuDrill` in `public/js/app.js`) rather than the main dashboard's, since Ecom availability uses different math and status labels (Sufficient Stock / Below Threshold, not OOS/Low/At Risk/Healthy/No Sales) — reusing the main drill-down would silently show the wrong engine's numbers.

If a future `stock.xlsx` and `DOS.xlsx` include the full Ecom assortment, the covered Ecom universe expands automatically without code changes.

## KVI Outlet mapping

`KVI Outlet.xlsx` is a single-column outlet-code list (header `CODE`) that is the **master KVI outlet mapping**, independent of the SKU-level `KVI` classification flag from `Core, Promo, KVI.xlsx`.

```
outlet.kvi = normalize_outlet(outlet.code) is present in KVI Outlet.xlsx
```

This is additive and optional: if the file is missing, misnamed, or empty, every outlet defaults to `kvi: false` and the build still succeeds — `scripts/validate_build.py` prints a warning (not a failure) when zero KVI outlets are matched.

Two new global filters read this flag:

- **Outlet Type** — `KVI` / `Non-KVI` / `E-COM Outlet`, searchable, multi-select, Select All. `KVI` and `E-COM Outlet` are independent flags (an outlet can be both, either, or neither) — selecting multiple options is a union (matches an outlet flagged with any of the selected options). `E-COM Outlet` reflects `outlet.ecom`, set from `ECOM OUTLET` on every outlet in the main model, not only inside the separate Ecom submodel.
- **KVI Outlet** — a searchable multi-select of specific outlet codes, sourced only from outlets flagged `kvi: true`

Both apply to every KPI card, table, summary and CSV/Excel export **except** the **KVI Availability** KPI card and its matching Excel summary row, which always scope to KVI outlets only (`Engine.kviSummary()` in `public/js/engine.js`), regardless of the user's Outlet Type / KVI Outlet selection — this matches the change log's `KVI Outlet.xlsx → Outlet Mapping → KVI Classification → KVI Availability Calculation` flow.

Filename note: the change log text refers to `KVI Outlet.xlsx` (space); an early sample file was named `KVI_Outlet.xlsx` (underscore). `scripts/download_drive_data.py` tries both automatically. `data/drive_source.json`'s `files.kviOutlet.driveName` is the single place to change if the real Drive filename differs from both.

## Availability marking

Both outlet and SKU performance use these dynamic bands:

| Band | Logic after whole-% rounding |
| --- | --- |
| 91%-100% | >= 91% |
| 81%-90% | 81%-90% |
| 71%-80% | 71%-80% |
| 61%-70% | 61%-70% |
| Below 60% | 0%-60% |

Every band displays **Outlet Count** and **SKU Count** separately where applicable. Counts recalculate with all global filters and Required DOS.

## Filters

Searchable + multi-select + Select All + Clear + scrolling + selection count + cascading:

- Product Division (`New Division` from item master)
- CAT3
- SKU
- Core / KVI / Promo
- RHO
- Zonal
- Zone (`Area` in Zone Distribution)
- Geo Division (`Division` in Zone Distribution)
- District
- Outlet
- Store Type / Format
- Location Type
- Outlet Type (KVI / Non-KVI / E-COM Outlet)
- KVI Outlet (specific outlets, sourced from `KVI Outlet.xlsx`)
- Stock Status
- Required DOS: 1, 2, 3, 5, 7, Custom (main dashboard only, no effect on Ecom)
- Required Ecom Stock: 3, 5, 10, 15, Custom (default 5; Ecom only, no effect on Core/KVI/Promo)

Outlet Type and KVI Outlet apply everywhere except the KVI Availability KPI card, which is always KVI-outlet-scoped (see [KVI Outlet mapping](#kvi-outlet-mapping) above).

The same state is passed to the Ecom engine wherever the selected dimensions exist.


## v5.0 Build-time data pipeline (Python, gdown)

The five source workbooks are downloaded from Drive and turned into the full outlet × SKU availability dataset **during the GitHub Actions build**, not in the browser. This mirrors the pattern used by the companion `Item-Dashboard` repo: `gdown` downloads from a link-shared Drive folder with no API key, a Python script builds the same outlet × SKU universe the browser used to build for itself, and the result is validated before it's ever deployed.

Data flow:

```
Google Drive folder ("Anyone with the link")
  → gdown (scripts/download_drive_data.py, no API key)
  → data/downloads/*.xlsx  (build-time only, never committed)
  → scripts/build_data.py  (reads xlsx with openpyxl, calls scripts/model.py's
     build_model() to build outlets[], skus[], and the per-slot stock/sales
     arrays, including the outlet.kvi flag from KVI Outlet.xlsx)
  → public/processed/dashboard_data.json
  → scripts/validate_build.py  (fails the build if the data looks wrong)
  → npm test  (JS calc/engine tests)
  → next build  (static export, bundles the JSON as a static asset)
  → GitHub Pages deploy
```

In the browser, `public/js/data-loader.js` just `fetch()`s `processed/dashboard_data.json` and reconstructs the same typed-array shape `scripts/model.py`'s `build_model()` produced. `public/js/engine.js` and `public/js/calc.js` do all filtering/aggregation live in the browser — every filter (15 dimensions plus Required DOS) recomputes on every change, because Required-DOS-dependent figures (DOS, status, shortfall, available) are never baked into the JSON; only DOS-independent data (stock, sales, outlet/SKU metadata, including `outlet.kvi`) is precomputed.

### Setup

1. **Share the Drive folder** (`1OiccpJ7WLxYVBSn6Gw9DMacK2ds0wW4j`) as **"Anyone with the link"** (Viewer). `gdown` needs this — there's no API key to configure instead.
2. No repository secrets or variables are required for Drive access at all. The folder ID and expected filenames live in `data/drive_source.json`, and are committed in plain text since none of it is sensitive.
3. Push to `main`, or run **Actions → Refresh dashboard and deploy Pages → Run workflow** manually. The workflow also runs automatically every day (`cron: "15 1 * * *"`).

### Filenames and sheets

Keep exactly one current file with each exact name in the Drive folder:

1. `Core, Promo, KVI.xlsx`
2. `stock.xlsx`
3. `DOS.xlsx`
4. `Zone Distribution.xlsx`
5. `Ecom.xlsx`
6. `KVI Outlet.xlsx` (optional — single-column `CODE` list)

Drive filenames and their local destination names are defined in `data/drive_source.json`. Expected sheet names are defined in `data/config.json`, and mirrored as defaults inside `scripts/build_data.py` — edit both if either changes:

- Classification → `C-P-K`
- Stock → `Sheet1`
- Sales → `DOS`
- Zone Distribution → `Final_Zone Dis`
- Ecom SKU → `ECOM SKU`
- Ecom Outlet → `ECOM OUTLET`
- KVI Outlet → `Sheet1`

### The Python pipeline scripts

- `scripts/preflight.py` — verifies all required project files and config exist before the heavier steps run.
- `scripts/download_drive_data.py` — downloads the Drive folder with `gdown`, matches files by their expected Drive filenames (with a space/underscore fallback for the KVI Outlet file), and copies them into `data/downloads/` under stable destination names.
- `scripts/calc.py` / `scripts/model.py` — the data-model construction: outlet/SKU normalization, classification-flag merging, the outlet × SKU slot universe, the `outlet.kvi` flag from `KVI Outlet.xlsx`, and the Ecom stock-coverage rule. Verified in `scripts/tests/test_model.py`.
- `scripts/build_data.py` — reads the downloaded workbooks with `openpyxl`, calls `build_model()`, and writes `public/processed/dashboard_data.json`.
- `scripts/validate_build.py` — sanity-checks the produced JSON (non-zero outlets/SKUs, consistent array lengths, no duplicate codes, at least one classified SKU, warns if zero KVI outlets matched) and fails the build if anything looks structurally wrong.
- `scripts/tests/test_model.py` — unit tests for the Python model, including KVI outlet flagging, run as part of the CI workflow.

### Excel-like tables

Every table in the dashboard (Summary, SKU Wise Availability, Outlets, CAT3, RHO, Zonal, Availability Loss Tree, Exceptions, Data Health, and drill-downs) is a fixed-height, internally-scrollable table with a sticky header, a built-in search box that filters rows by any cell's text, click-to-sort column headers (numeric-aware), and its own CSV download that exports exactly the currently visible (filtered + searched) rows. This is implemented once in `public/js/ui.js`'s `table()` helper and `public/js/table-search.js`, so every table gets it automatically with no per-view changes.

**Performance on production-scale data.** A single page render (Core/KVI/Promo in particular) calls several aggregation methods in sequence — `summary()`, `outletBandDistribution()`, `skuBandDistribution()`, `skuUnavailability()`, `productHierarchySummary()` (twice), `topExceptions()`. Each of these used to independently re-walk the entire filtered outlet × SKU universe from scratch, computing `calculateSlot()` for every pair every time — on hundreds of thousands of slots, that's millions of redundant calculations in one render and was enough to freeze the browser tab (a "Page Unresponsive" hang, not just slowness). `Engine.materializedSlots(forcedClass)` in `public/js/engine.js` now computes and caches that filtered pass exactly once per `(forcedClass, filter state)`, and every one of those methods reads from it — so a render does roughly one full pass instead of five-plus. This is on top of, and more important than, the **display cap** on the largest tables (`DISPLAY_ROW_CAP`, 500, in `public/js/views.js`): SKU-wise unavailability, Top exceptions, Outlets, Outlet performance, and the Ecom outlet/SKU tables render at most 500 rows into the DOM even when far more exist. `Engine.skuUnavailability()`, `Engine.topExceptions()`, and `Engine.groupBy()` are still always called with no limit for CSV and Excel export (in `public/js/app.js`), so exports always contain every row regardless of what's capped on screen. Capped pages show the true total in the section header and a note pointing to that table's own CSV button for the rest. Low-cardinality tables (Product Division, CAT3, Zone) are never capped, since they're naturally small.

### If data doesn't load

Check the **Actions** tab for the latest "Refresh dashboard and deploy Pages" run. Common causes of a failed or stale build:
- **`download_drive_data.py` fails to list the folder** → the folder isn't shared as "Anyone with the link", or the folder ID in `data/drive_source.json` is wrong.
- **"the following expected files were not found in the Drive folder"** → a filename in Drive doesn't exactly match `driveName` in `data/drive_source.json`.
- **`validate_build.py` fails** → the produced dataset looks structurally wrong (zero outlets/SKUs, mismatched array lengths, no classified SKUs) — usually means a sheet name or column header in the source workbooks changed. Check `data/config.json`'s `sourceSheets` and the column-header lists in `scripts/model.py`'s `need(...)` calls.
- **Dashboard shows "Processed data not found"** → the workflow hasn't completed successfully yet, or `public/processed/dashboard_data.json` wasn't produced.

## Local development

Node.js 20.9+:

```bash
npm install
npm test
npm run dev
```

`npm run dev` serves the dashboard against whatever is currently in `public/processed/dashboard_data.json` (or nothing, if it hasn't been built yet). To generate that file locally against real Drive data:

```bash
pip install gdown openpyxl
python scripts/preflight.py
python scripts/tests/test_model.py
python scripts/download_drive_data.py
python scripts/build_data.py
python scripts/validate_build.py
```

Production static export:

```bash
npm run build
```

Output: `out/`

## GitHub Pages

The included `.github/workflows/deploy-pages.yml` ("Refresh dashboard and deploy Pages") runs the full pipeline: preflight → Python model tests → download from Drive → build the dataset → validate → `npm test` → `next build` → Pages deployment. It triggers on push to `main` (for relevant paths), on a daily schedule, and manually via **Actions → Refresh dashboard and deploy Pages → Run workflow**. `next.config.mjs` uses `output: "export"` and derives the project-site base path in GitHub Actions.

Repository setting:

**Settings → Pages → Source → GitHub Actions**

No repository secrets or variables are required — Drive access needs no credentials, only the folder being shared as "Anyone with the link" (see [Build-time data pipeline](#v50-build-time-data-pipeline-python-gdown) above).

## Availability rules

Following a calculation audit, six issues were fixed in `public/js/calc.js`:

1. **Status scales with Required DOS.** The OOS/Low/At Risk/Healthy cutoffs were hardcoded to DOS 1 and 2, so at Required DOS = 7 a slot with DOS 5 read "Healthy" while being counted unavailable. Thresholds are now relative: below half the requirement is Low, below the requirement is At Risk, at or above it is Healthy. Status can no longer contradict the availability badge on the same row.
2. **A slot counted available never shows a warning status.** DOS exactly equal to Required DOS previously read "At Risk" while counting as available.
3. **Stock on the shelf with zero sales counts as available.** This is an availability dashboard — stock a customer can buy is available even if it hasn't sold in 30 days. Those slots keep the distinct **No Sales** status so slow movers stay identifiable. Zero stock with zero sales is still unavailable.
4. **Negative stock is clamped to zero.** It previously produced a negative DOS that polluted the Average DOS figure.
5. **Slots with no source record on either side are excluded from the availability denominator** rather than counted as failures — the same coverage principle the Ecom universe already used. A partial source extract must not manufacture fake unavailability. The excluded count is disclosed as a **Not Covered** KPI rather than silently shrinking the universe.
6. **Shortfall reflects the real gap.** A No-Sales slot previously had `requiredStock = 0` and therefore `shortfall = 0` even while counting as unavailable, so shortfall totals understated what was needed to reach full availability.

`calculateEcomSlot` (stock ≥ threshold) was audited and found correct; it gained the same unscored-slot handling for consistency.

## Exports

- Every table has its own CSV download button that exports exactly the currently visible (filtered + searched) rows — there is no single global CSV button in the top bar.
- Excel (top bar) includes Summary, Outlet Summary, SKU Unavailability, Product Division Summary, CAT3 Summary, Ecom SKU Availability, Ecom Coverage, and filtered Core/KVI/Promo detail (including Outlet Type and a separate Ecom Outlet Y/N column, since an outlet can be both KVI and Ecom at once).
- **PDF Summary** (top bar) downloads a print-ready PDF report: the current Overall/Core/KVI/Promo/Ecom availability KPIs, the active filter context, the overall stock-status breakdown, the lowest-availability zones, and the top unavailable SKUs. Implemented in `public/js/pdf-export.js`.
  - **This is the one part of the app that requires internet access at runtime.** `jsPDF` and `jspdf-autotable` are loaded on demand from cdnjs the first time the button is clicked (not bundled into the app, since there's no build step to bundle npm packages into the plain ES modules served from `public/js/`). Every other feature works fully offline once the page has loaded. If the CDN is unreachable, the button shows a toast error rather than failing silently.
  - The KPI cards, filter list, status breakdown, and zone table always reflect the full filtered result; the SKU list is capped (default 25) since this is a print report, not a dashboard data table — unlike the on-screen tables and CSV/Excel exports, which are never capped.

## Validation

`npm test` validates calculations, Required DOS behavior, dynamic availability bands, and hierarchy rollups (all still live in the browser). `python scripts/tests/test_model.py` validates the build-time data-model construction, including the Ecom stock-coverage rule, against the same expected values the JS test suite used to check before that logic moved to Python. `python scripts/validate_build.py` validates the actual dataset produced from real Drive data on every build.

See:

- `docs/MAPPING_REPORT.md`
- `docs/ECOM_MAPPING_REPORT.md`
- `docs/VALIDATION_REPORT.md`
