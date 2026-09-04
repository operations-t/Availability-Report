#!/usr/bin/env python3
"""
Validates processed/dashboard_data.json after build_data.py runs.
Fails the build (non-zero exit) if the produced data looks structurally
wrong, so a bad Drive export never silently reaches the live dashboard.
"""

import json
import sys

OUTPUT_PATH = "public/processed/dashboard_data.json"


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def check_universe(label, d, outlets_key="outlets", skus_key="skus",
                    stock_key="stock", sales_key="sales",
                    stock_present_key="stockPresent", sales_present_key="salesPresent",
                    outlet_count_key="outletCount", sku_count_key="skuCount",
                    slot_count_key="slotCount"):
    outlets = d.get(outlets_key) or []
    skus = d.get(skus_key) or []
    stock = d.get(stock_key) or []
    sales = d.get(sales_key) or []
    stock_present = d.get(stock_present_key) or []
    sales_present = d.get(sales_present_key) or []

    if len(outlets) == 0:
        fail(f"{label}: zero outlets in the built universe.")
    if len(skus) == 0:
        fail(f"{label}: zero SKUs in the built universe.")

    expected_slots = len(outlets) * len(skus)
    if d.get(slot_count_key) != expected_slots:
        fail(f"{label}: slotCount {d.get(slot_count_key)} != outlets*skus {expected_slots}.")
    if d.get(outlet_count_key) != len(outlets):
        fail(f"{label}: outletCount does not match len(outlets).")
    if d.get(sku_count_key) != len(skus):
        fail(f"{label}: skuCount does not match len(skus).")

    for name, arr in [("stock", stock), ("sales", sales),
                       ("stockPresent", stock_present), ("salesPresent", sales_present)]:
        if len(arr) != expected_slots:
            fail(f"{label}: {name} array length {len(arr)} != expected slot count {expected_slots}.")

    # Every outlet needs a code; every sku needs a code.
    for o in outlets:
        if not o.get("code"):
            fail(f"{label}: an outlet is missing its code.")
    for s in skus:
        if not s.get("code"):
            fail(f"{label}: a SKU is missing its code.")

    # Duplicate outlet/sku codes would corrupt the slot index math.
    outlet_codes = [o["code"] for o in outlets]
    if len(outlet_codes) != len(set(outlet_codes)):
        fail(f"{label}: duplicate outlet codes found after build (should be deduplicated).")
    sku_codes = [s["code"] for s in skus]
    if len(sku_codes) != len(set(sku_codes)):
        fail(f"{label}: duplicate SKU codes found after build (should be deduplicated).")

    print(f"  {label}: outlets={len(outlets)} skus={len(skus)} slots={expected_slots} OK")


def main():
    try:
        with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
            d = json.load(f)
    except FileNotFoundError:
        fail(f"{OUTPUT_PATH} was not produced by build_data.py.")
    except json.JSONDecodeError as e:
        fail(f"{OUTPUT_PATH} is not valid JSON: {e}")

    print("Validating main Core/KVI/Promo universe...")
    check_universe("main", d)

    if d.get("ecom"):
        print("Validating Ecom universe...")
        check_universe("ecom", d["ecom"])
    else:
        print("  ecom: not present in this build (no Ecom.xlsx data) -- skipping.")

    # At least one SKU should carry a Core/KVI/Promo flag, or every filter
    # downstream will show an empty classification.
    any_classified = any(s.get("core") or s.get("kvi") or s.get("promo") for s in d.get("skus", []))
    if not any_classified:
        fail("main: no SKU is flagged Core/KVI/Promo -- classification parsing likely failed.")

    # KVI Outlet mapping (change log Section 8-10) is additive: warn
    # loudly but don't fail the build if it's missing or empty, since the
    # rest of the dashboard must keep working either way.
    kvi_outlet_info = (d.get("health") or {}).get("kviOutlet") or {}
    kvi_matched = kvi_outlet_info.get("matchedOutlets", 0)
    kvi_listed = kvi_outlet_info.get("listedCodes", 0)
    if kvi_listed == 0:
        print("::warning::KVI Outlet mapping produced zero listed codes -- the KVI Outlet "
              "source file may be missing or misnamed in data/drive_source.json. "
              "Outlet Type / KVI Outlet filters and the KVI KPI card will show no KVI outlets "
              "until this is fixed.")
    elif kvi_matched == 0:
        print(f"::warning::KVI Outlet mapping listed {kvi_listed} code(s) but matched zero "
              "outlets in Zone Distribution -- check for a code-format mismatch.")
    else:
        print(f"  kviOutlet: {kvi_matched}/{kvi_listed} listed codes matched an outlet OK")

    print("processed/dashboard_data.json passed validation.")


if __name__ == "__main__":
    main()
