# Validation Report — v2.3

## Deterministic tests

Passed:

- ADS calculation
- DOS calculation
- No Sales precedence and DOS = N/A
- OOS / Low / At Risk / Healthy rules
- Required DOS dynamic availability
- Required Stock / Shortfall
- five availability bands
- band recalculation after filtering
- band recalculation after Required DOS change
- SKU-wise unavailability ranking
- Product Division and CAT3 summaries
- RHO / Zonal grouping
- Ecom universe coverage rule
- exclusion of Ecom SKUs absent from Current Stock from the scored denominator

Command:

`npm test`

Result:

`PASS: Next.js/GitHub Pages package preflight`

`PASS: calculation, banding, hierarchy and Ecom coverage tests`

## Real-source regression

Validated against the supplied five workbooks.

### Core/KVI/Promo

- Outlets: 989
- SKUs: 847
- Slots: 837,683
- Required DOS: 2
- Availability: **66.8028359176%**

### Ecom

- Ecom SKU data rows: 10,721
- Unique listed Ecom SKUs: 10,710
- Availability-covered Ecom SKUs: 827
- Data-not-covered Ecom SKUs: 9,883
- Ecom outlets: 101
- Scored slots: 83,527
- Required DOS: 2
- Availability: **74.8787817113%**
- Available: 62,544
- Unavailable: 20,983
- Missing scored-universe stock records: 0
- Missing scored-universe sales records: 9,410

Ecom SKU bands:

- 91%-100%: 200
- 81%-90%: 191
- 71%-80%: 155
- 61%-70%: 98
- Below 60%: 183

## UI/package checks

Passed static preflight checks for:

- Next.js static export configuration
- Drive folder ID (source for the build-time gdown download pipeline)
- all five production filenames
- ECOM SKU / ECOM OUTLET sheet configuration
- white mode default
- dark mode toggle
- sidebar hide/show control
- filter hide/show control
- separate Ecom SKU Wise Availability page
- Ecom summary KPI
- Product Division, CAT3, RHO, Zonal and Availability Loss Tree views
- no operational `.xlsx` files packaged in GitHub ZIP

A full `next build` was not executed in the packaging runtime because the npm registry was unavailable. The included GitHub Actions workflow runs the build during deployment.
