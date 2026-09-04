# Ecom.xlsx Mapping Report

## Workbook structure

### Sheet: ECOM SKU

- Rows including header: 10,722
- Data rows: 10,721
- Columns:
  - `Product Code`
  - `Product Name`
  - `FM`
- Unique Product Codes: **10,710**
- Duplicate Product Codes: **3**
- Duplicate extra rows: **11**
- Product Name blank rows: **0**
- FM-marked unique SKUs: **596**

The repeated codes have consistent product names in the supplied workbook.

### Sheet: ECOM OUTLET

- Rows: **101**
- The supplied sheet contains outlet codes directly and has no header row.
- Unique outlet codes: **101**
- Duplicate outlet codes: **0**

## Join coverage against supplied availability sources

### Outlet coverage

All 101 Ecom outlets are present in:

- Zone Distribution: 101 / 101
- Current Stock outlet columns: 101 / 101
- Sales source: 101 / 101

### SKU coverage

The Ecom list is much wider than the supplied availability extraction:

- Ecom listed SKUs: **10,710**
- Present in Current Stock: **827**
- Not present in Current Stock: **9,883**
- Ecom listed SKUs observed in Sales source: **827**

Because `stock.xlsx` contains 847 products in total, it is not a full 10,710-SKU Ecom stock extraction.

## Implemented scoring rule

Ecom availability is calculated only for Ecom SKUs present in Current Stock. This produces a scored universe of:

**101 Ecom outlets × 827 availability-covered Ecom SKUs = 83,527 Outlet-SKU slots**

The 9,883 Ecom-listed SKUs absent from Current Stock are labeled **Data Not Covered** and are excluded from the Ecom availability denominator. They are not interpreted as zero stock.

This rule prevents a partial source extract from creating a materially false Ecom availability percentage.

## Verified Required DOS = 2 result

- Availability: **74.8787817113%**
- Available slots: **62,544**
- Unavailable slots: **20,983**
- Missing stock records inside scored universe: **0**
- Missing sales records inside scored universe: **9,410**
- FM listed SKUs: **596**
- Availability-covered FM SKUs: **199**

### Ecom SKU availability bands

| Band | SKU Count |
| --- | ---: |
| 91%-100% | 200 |
| 81%-90% | 191 |
| 71%-80% | 155 |
| 61%-70% | 98 |
| Below 60% | 183 |
| **Total scored SKUs** | **827** |
