# Source Mapping Report — Core · KVI · Promo Availability Tracker

Generated from the four supplied workbooks before implementation.

## 1. Item Classification Master

- File inspected: `Core, Promo, KVI.xlsx`
- Sheet: `C-P-K`
- Rows: **862 data rows**
- Fields: `Article Code`, `Name`, `Criteria`, `CAT3`, `New Division`
- Unique SKUs: **847**
- Repeated SKU codes: **15** (no exact duplicate rows)
- Classification rows: **Core 695**, **KVI 19**, **Promo 148**
- Boolean flag combinations after de-duplication: **680 Core only**, **6 KVI only**, **146 Promo only**, **13 Core+KVI**, **2 Core+Promo**
- `Article Code` is numeric in Excel but is normalized to a string join key in the application.
- `CAT3` provides Category-3.
- No distinct `Category` field exists. The dashboard maps the requested **Category** filter to `New Division` and discloses this under Data Notes.
- No outlet/store applicability field exists in the item master.

## 2. 30-Day Sales Qty

- File inspected: `DOS.xlsx`
- Sheet: `DOS`
- Rows: **647,548 data rows**
- Fields: `Outlet Code`, `Article Code`, `POS Sales Qty`, `Sales/Day`
- Unique Outlet+SKU pairs: **647,548**
- Duplicate Outlet+SKU pairs: **0**
- Unique outlets: **1,001**
- Unique SKUs: **847**
- Supplied `Sales/Day` matches `POS Sales Qty / 30` on all rows, but the dashboard recalculates ADS from `POS Sales Qty / 30` as the source-of-truth formula.

## 3. Current Stock

- File inspected: `stock.xlsx`
- Sheet: `Sheet1`
- Shape: **847 product rows × 1,019 columns**
- Key fields: `ProductCode`, `ProductName`
- Outlet columns: **1,017**, all unique
- Unique product codes: **847**, no duplicates
- Stock cells: **861,399 numeric cells**, no blanks, **175,107 explicit zero-stock cells**, no negative values in the supplied file
- The wide stock matrix is normalized to the analytical grain Outlet Code + SKU Code in memory.

## 4. Zone Distribution

- Original uploaded file inspected: `Zone Distribution Aug 2026 w location type.xlsx`
- Production Google Drive filename: `Zone Distribution.xlsx`
- Primary sheet: `Final_Zone Dis`
- Rows: **989 data rows**
- Fields: 26 columns including `CODE`, `Outlet Name`, Regional Head fields, Zonal fields, `Format`, `Division`, `District`, `Area`, `Status`, `Location Type`
- Unique outlets: **989**
- Duplicate outlet codes: **0**
- Secondary sheet `again in september` contains 2 rows and is not used for the August analytical universe.
- No explicit active/inactive field is supplied. `Status` contains outlet ownership/status metadata rather than a reliable activity flag; therefore all unique rows in `Final_Zone Dis` are treated as the active outlet universe. This assumption is exposed under Data Notes.

## 5. Join-key mapping

| Dashboard entity | Source field | Normalization |
|---|---|---|
| SKU Code | Classification `Article Code`; Sales `Article Code`; Stock `ProductCode` | Trim + stringify; integer-looking numeric codes normalized without `.0` |
| Outlet Code | Zone `CODE`; Sales `Outlet Code`; Stock outlet-column headers | Trim + uppercase |
| SKU Name | Classification `Name` | First nonblank value across repeated classification rows |
| Category | Classification `New Division` | Requested Category alias because no separate Category field exists |
| Category-3 | Classification `CAT3` | Exact text |
| Core/KVI/Promo | Classification `Criteria` | Aggregated boolean flags; no base-record duplication |
| Zone | Zone `Area` | Exact text |
| RHO | Zone `Regional Head HR Name` | Exact text |
| Zonal | Zone `Zonal HR Name` | Exact text |
| Division | Zone `Division` | Exact text |
| Store Type | Zone `Format` | Exact text |
| Location Type | Zone `Location Type` | Exact text |

## 6. Required assortment universe

Because the item master contains no outlet applicability field, the required universe is:

**989 unique outlets in `Final_Zone Dis` × 847 unique classified SKUs = 837,683 required Outlet-SKU slots.**

The universe is built before stock and sales joins. Missing source records therefore remain in the denominator.

## 7. Cross-source health findings

- Stock records present inside the required universe: **837,683 / 837,683**; missing stock records: **0**.
- Sales records present inside the required universe: **643,541**; missing sales records: **194,142**.
- Stock outlet columns not present in August Zone Distribution: **28**.
- Sales outlets not present in August Zone Distribution: **12**.
- Zone outlets missing from stock: **0**.
- Zone outlets missing from sales source entirely: **0**.
- Classified SKUs missing from stock: **0**.
- Classified SKUs missing from sales source entirely: **0**.

Missing sales records are retained as zero 30-day sales for calculation, resulting in ADS = 0, DOS = N/A, Stock Status = No Sales, and Availability = Unavailable. They remain separately flagged as missing-sales source records in Data Health.

## 8. Formula/precedence decisions

- `ADS = 30-Day Sales Qty / 30`.
- If ADS = 0: DOS = N/A and Stock Status = **No Sales**. This explicit zero-sales rule takes precedence over the generic OOS rule when both sales and stock are zero.
- Otherwise: `DOS = Stock / ADS`.
- With ADS > 0: OOS if Stock <= 0; Low if DOS < 1; At Risk if 1 <= DOS <= 2; Healthy if DOS > 2.
- Availability is dynamic: Available iff DOS is numeric and `DOS >= Required DOS`.
- `Required Stock = ADS × Required DOS`.
- `Shortfall = MAX(Required Stock - Stock, 0)`.
- Missing stock source records are treated as stock = 0 for the required-slot calculation, while remaining visibly flagged in Data Health.

## 9. Field type profile

Types below were measured from the supplied workbook values, not assumed from column positions. Join keys are normalized to strings inside the application even where Excel stores the source code numerically.

### Classification

| Field | Dominant type | Text | Number | Blank | Boolean |
|---|---:|---:|---:|---:|---:|
| `Article Code` | number | 0 | 862 | 0 | 0 |
| `Name` | text | 862 | 0 | 0 | 0 |
| `Criteria` | text | 862 | 0 | 0 | 0 |
| `CAT3` | text | 862 | 0 | 0 | 0 |
| `New Division` | text | 862 | 0 | 0 | 0 |

### 30-Day Sales Qty

| Field | Dominant type | Text | Number | Blank | Boolean |
|---|---:|---:|---:|---:|---:|
| `Outlet Code` | text | 647,548 | 0 | 0 | 0 |
| `Article Code` | number | 0 | 647,548 | 0 | 0 |
| `POS Sales Qty` | number | 0 | 647,548 | 0 | 0 |
| `Sales/Day` | number | 0 | 647,548 | 0 | 0 |

### Current Stock

| Field | Dominant type | Text | Number | Blank | Boolean |
|---|---:|---:|---:|---:|---:|
| `ProductCode` | number | 0 | 847 | 0 | 0 |
| `ProductName` | text | 847 | 0 | 0 | 0 |
| `OutletStockCells` | number | 0 | 861,399 | 0 | 0 |

### Zone Distribution

| Field | Dominant type | Text | Number | Blank | Boolean |
|---|---:|---:|---:|---:|---:|
| `SL` | number | 0 | 989 | 0 | 0 |
| `CODE` | text | 989 | 0 | 0 | 0 |
| `Outlet Name` | text | 989 | 0 | 0 | 0 |
| `Regional Head ID` | number | 0 | 989 | 0 | 0 |
| `Regional Head HR Name` | text | 989 | 0 | 0 | 0 |
| `Leader` | text | 989 | 0 | 0 | 0 |
| `Regional Head Contact` | number | 0 | 989 | 0 | 0 |
| `Zonal ID` | number | 0 | 989 | 0 | 0 |
| `Zonal HR Name` | text | 989 | 0 | 0 | 0 |
| `Zonal` | text | 989 | 0 | 0 | 0 |
| `Zonal Contact` | number | 0 | 989 | 0 | 0 |
| `Launching Date` | number | 0 | 989 | 0 | 0 |
| `SFT` | number | 0 | 989 | 0 | 0 |
| `Format` | text | 989 | 0 | 0 | 0 |
| `Division` | text | 989 | 0 | 0 | 0 |
| `District` | text | 989 | 0 | 0 | 0 |
| `Area` | text | 989 | 0 | 0 | 0 |
| `PNP Non PNP status` | text | 989 | 0 | 0 | 0 |
| `Status` | text | 989 | 0 | 0 | 0 |
| `Geo Location` | text | 989 | 0 | 0 | 0 |
| `Location Type` | text | 989 | 0 | 0 | 0 |
| `Location Type(Dv,Ds,T)` | text | 989 | 0 | 0 | 0 |
| `Population Density` | text | 989 | 0 | 0 | 0 |
| `Income level` | text | 989 | 0 | 0 | 0 |
| `Floor type` | text | 989 | 0 | 0 | 0 |
| `Layout shape` | text | 989 | 0 | 0 | 0 |

The machine-readable inspection output, including exact headers and type counts, is retained in `docs/source-mapping-stats.json`.

---

## Ecom extension

Production adds `Ecom.xlsx` with two sheets:

- `ECOM SKU`: 10,721 data rows, 10,710 unique Product Codes, 3 duplicated codes / 11 extra rows, 596 FM-marked SKUs.
- `ECOM OUTLET`: 101 unique outlet codes, no duplicate outlet codes.

All 101 Ecom outlets match Zone Distribution, Current Stock outlet columns and Sales source.

Only 827 of the 10,710 Ecom-listed SKUs are present in the supplied Current Stock extraction. Therefore the dashboard scores Ecom availability on 101 × 827 = 83,527 covered slots and exposes the remaining 9,883 Ecom SKUs as Data Not Covered rather than treating them as zero stock.

See `ECOM_MAPPING_REPORT.md` for the full Ecom mapping and validation details.
