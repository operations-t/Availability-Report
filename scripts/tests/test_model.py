#!/usr/bin/env python3
"""
Tests scripts/model.py and scripts/calc.py -- the Python port of
public/js/model.js and public/js/calc.js. Mirrors the coverage
tests/run-tests.mjs has for the JS side (calc.js/engine.js), so the two
implementations stay verified against the same expected numbers.

Run: python scripts/tests/test_model.py
(also invoked by `npm test` via package.json)
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from calc import normalize_code, normalize_outlet, merge_class_flags, compute_ads  # noqa: E402
from model import build_model  # noqa: E402


def test_normalize_code():
    assert normalize_code("1001") == "1001"
    assert normalize_code(1001) == "1001"
    assert normalize_code(1001.0) == "1001"
    assert normalize_code("  1001  ") == "1001"
    assert normalize_code(None) == ""
    assert normalize_code("") == ""
    assert normalize_code("ABC123") == "ABC123"
    print("PASS: test_normalize_code")


def test_normalize_outlet():
    assert normalize_outlet("o1") == "O1"
    assert normalize_outlet(" o1 ") == "O1"
    assert normalize_outlet(1.0) == "1"
    print("PASS: test_normalize_outlet")


def test_merge_class_flags():
    sku = {"core": False, "kvi": False, "promo": False}
    merge_class_flags(sku, "Core")
    assert sku == {"core": True, "kvi": False, "promo": False}

    sku = {"core": False, "kvi": False, "promo": False}
    merge_class_flags(sku, "Core, KVI")
    assert sku["core"] is True and sku["kvi"] is True and sku["promo"] is False

    sku = {"core": False, "kvi": False, "promo": False}
    merge_class_flags(sku, "core+kvi+promo")
    assert sku["core"] is True and sku["kvi"] is True and sku["promo"] is True
    print("PASS: test_merge_class_flags")


def test_compute_ads():
    assert compute_ads(30) == 1.0
    assert compute_ads(0) == 0.0
    assert compute_ads(None) == 0.0
    assert compute_ads("") == 0.0
    assert compute_ads(60) == 2.0
    print("PASS: test_compute_ads")


def test_ecom_universe_coverage():
    """Mirrors tests/run-tests.mjs's original testEcomUniverseCoverage()
    input and expected values exactly, so the Python build pipeline is
    verified against the same numbers the JS test suite used to check."""
    inp = {
        "classification": [
            ["Article Code", "Name", "Criteria", "CAT3", "New Division"],
            [1001, "A", "Core", "C3", "D"],
            [1002, "B", "Promo", "C3", "D"],
        ],
        "zone": [
            ["CODE", "Outlet Name", "Regional Head HR Name", "Zonal HR Name",
             "Format", "Division", "District", "Area", "Location Type"],
            ["O1", "Outlet 1", "R", "Z", "F", "Geo", "Dist", "Area", "Type"],
            ["O2", "Outlet 2", "R", "Z", "F", "Geo", "Dist", "Area", "Type"],
        ],
        "stock": [
            ["ProductCode", "ProductName", "O1", "O2"],
            [1001, "A", 2, 2],
            [1002, "B", 1, 1],
        ],
        "sales": [
            ["Outlet Code", "Article Code", "POS Sales Qty", "Sales/Day"],
            ["O1", 1001, 30, 1], ["O2", 1001, 30, 1],
            ["O1", 1002, 30, 1], ["O2", 1002, 30, 1],
        ],
        "ecomSku": [
            ["Product Code", "Product Name", "FM"],
            [1001, "A", "FM"], [1002, "B", ""], [9999, "Not covered", ""],
        ],
        "ecomOutlet": [["O1"], ["O2"]],
    }

    model = build_model(inp, {"ecom": {"name": "Ecom.xlsx", "status": "Test"}})
    ecom = model["ecom"]

    assert ecom is not None, "ecom submodel should not be None"
    assert ecom["listedSkuCount"] == 3, f"listedSkuCount {ecom['listedSkuCount']} != 3"
    assert ecom["skuCount"] == 2, f"skuCount {ecom['skuCount']} != 2"
    assert ecom["health"]["uncoveredSkus"] == 1, f"uncoveredSkus {ecom['health']['uncoveredSkus']} != 1"
    assert ecom["outletCount"] == 2, f"outletCount {ecom['outletCount']} != 2"
    assert ecom["slotCount"] == 4, f"slotCount {ecom['slotCount']} != 4"

    # Availability at requiredDOS=2, replicating engine.js's calculateSlot logic:
    required_dos = 2
    total = 0
    available = 0
    for i in range(ecom["slotCount"]):
        stock = ecom["stock"][i]
        sales = ecom["sales"][i]
        stock = 0 if stock != stock else stock  # NaN -> 0
        sales = 0 if sales != sales else sales
        ads = sales / 30
        dos = None if ads == 0 else stock / ads
        avail = dos is not None and dos >= required_dos
        total += 1
        if avail:
            available += 1

    availability = (available / total) * 100 if total else 0
    assert total == 4, f"total {total} != 4"
    assert available == 2, f"available {available} != 2"
    assert round(availability, 1) == 50.0, f"availability {availability} != 50.0"
    print("PASS: test_ecom_universe_coverage")


def test_main_universe_basic():
    """A minimal main (non-ecom) universe: 2 outlets x 2 skus, no ecom data."""
    inp = {
        "classification": [
            ["Article Code", "Name", "Criteria", "CAT3", "New Division"],
            [2001, "X", "Core", "C3", "D"],
            [2002, "Y", "KVI", "C3", "D"],
        ],
        "zone": [
            ["CODE", "Outlet Name", "Regional Head HR Name", "Zonal HR Name",
             "Format", "Division", "District", "Area", "Location Type"],
            ["A1", "Alpha", "R", "Z", "F", "Geo", "Dist", "Area", "Type"],
            ["A2", "Beta", "R", "Z", "F", "Geo", "Dist", "Area", "Type"],
        ],
        "stock": [
            ["ProductCode", "ProductName", "A1", "A2"],
            [2001, "X", 5, 0],
            [2002, "Y", 3, 3],
        ],
        "sales": [
            ["Outlet Code", "Article Code", "POS Sales Qty", "Sales/Day"],
            ["A1", 2001, 30, 1], ["A2", 2001, 30, 1],
            ["A1", 2002, 30, 1], ["A2", 2002, 30, 1],
        ],
        "ecomSku": [], "ecomOutlet": [],
    }
    model = build_model(inp, {})
    assert model["outletCount"] == 2
    assert model["skuCount"] == 2
    assert model["slotCount"] == 4
    assert model["ecom"] is None, "ecom should be None when no ecom rows are supplied"

    core_sku = next(s for s in model["skus"] if s["code"] == "2001")
    assert core_sku["core"] is True and core_sku["kvi"] is False
    kvi_sku = next(s for s in model["skus"] if s["code"] == "2002")
    assert kvi_sku["kvi"] is True and kvi_sku["core"] is False

    outlet_codes = [o["code"] for o in model["outlets"]]
    assert outlet_codes == ["A1", "A2"], f"outlets should be sorted by code: {outlet_codes}"
    print("PASS: test_main_universe_basic")


def test_kvi_outlet_flagging():
    """Mirrors the real KVI_Outlet.xlsx format: single-column CODE list.
    Outlets present in the list get outlet.kvi = True; absent outlets
    get outlet.kvi = False. This is independent of sku.kvi (the
    existing SKU-level Classification flag)."""
    inp = {
        "classification": [
            ["Article Code", "Name", "Criteria", "CAT3", "New Division"],
            [3001, "P", "KVI", "C3", "D"],
        ],
        "zone": [
            ["CODE", "Outlet Name", "Regional Head HR Name", "Zonal HR Name",
             "Format", "Division", "District", "Area", "Location Type"],
            ["K1", "Kvi One", "R", "Z", "F", "Geo", "Dist", "Area", "Type"],
            ["K2", "Kvi Two", "R", "Z", "F", "Geo", "Dist", "Area", "Type"],
            ["N1", "Not Kvi", "R", "Z", "F", "Geo", "Dist", "Area", "Type"],
        ],
        "stock": [
            ["ProductCode", "ProductName", "K1", "K2", "N1"],
            [3001, "P", 5, 5, 5],
        ],
        "sales": [
            ["Outlet Code", "Article Code", "POS Sales Qty", "Sales/Day"],
            ["K1", 3001, 30, 1], ["K2", 3001, 30, 1], ["N1", 3001, 30, 1],
        ],
        "ecomSku": [], "ecomOutlet": [],
        "kviOutlet": [["CODE"], ["K1"], ["K2"], ["k1"]],  # header + dup (different case) should not double-count
    }
    model = build_model(inp, {})
    outlets_by_code = {o["code"]: o for o in model["outlets"]}
    assert outlets_by_code["K1"]["kvi"] is True
    assert outlets_by_code["K2"]["kvi"] is True
    assert outlets_by_code["N1"]["kvi"] is False
    assert model["health"]["kviOutlet"]["listedCodes"] == 2, \
        f"expected 2 unique normalized codes (K1, K2), got {model['health']['kviOutlet']['listedCodes']}"
    assert model["health"]["kviOutlet"]["matchedOutlets"] == 2
    print("PASS: test_kvi_outlet_flagging")


def test_kvi_outlet_absent_defaults_false():
    """When no KVI outlet file is supplied at all, every outlet.kvi must
    be False (never None/missing) so browser filtering never breaks.
    Same for outlet.ecom when no ECOM OUTLET rows are supplied."""
    inp = {
        "classification": [["Article Code", "Name", "Criteria", "CAT3", "New Division"], [4001, "Q", "Core", "C3", "D"]],
        "zone": [["CODE", "Outlet Name", "Regional Head HR Name", "Zonal HR Name",
                   "Format", "Division", "District", "Area", "Location Type"],
                  ["Z1", "Zed", "R", "Z", "F", "Geo", "Dist", "Area", "Type"]],
        "stock": [["ProductCode", "ProductName", "Z1"], [4001, "Q", 5]],
        "sales": [["Outlet Code", "Article Code", "POS Sales Qty", "Sales/Day"], ["Z1", 4001, 30, 1]],
        "ecomSku": [], "ecomOutlet": [],
    }
    model = build_model(inp, {})
    assert model["outlets"][0]["kvi"] is False
    assert model["outlets"][0]["ecom"] is False
    print("PASS: test_kvi_outlet_absent_defaults_false")


def test_main_model_ecom_outlet_flagging():
    """outlet.ecom on the MAIN model's outlets[] reflects presence in
    ECOM OUTLET alone -- independent of the Ecom submodel's stricter
    coverage rule (which additionally requires Current Stock presence).
    This is what powers the 'E-COM Outlet' Outlet Type filter option on
    every page, not just the dedicated Ecom SKU page."""
    inp = {
        "classification": [["Article Code", "Name", "Criteria", "CAT3", "New Division"], [5001, "P", "Core", "C3", "D"]],
        "zone": [["CODE", "Outlet Name", "Regional Head HR Name", "Zonal HR Name",
                   "Format", "Division", "District", "Area", "Location Type"],
                  ["E1", "Ecom One", "R", "Z", "F", "Geo", "Dist", "Area", "Type"],
                  ["E2", "Ecom Two", "R", "Z", "F", "Geo", "Dist", "Area", "Type"],
                  ["G1", "General", "R", "Z", "F", "Geo", "Dist", "Area", "Type"]],
        "stock": [["ProductCode", "ProductName", "E1", "E2", "G1"], [5001, "P", 5, 5, 5]],
        "sales": [["Outlet Code", "Article Code", "POS Sales Qty", "Sales/Day"],
                   ["E1", 5001, 30, 1], ["E2", 5001, 30, 1], ["G1", 5001, 30, 1]],
        "ecomSku": [["Product Code", "Product Name", "FM"], [5001, "P", ""]],
        "ecomOutlet": [["CODE"], ["E1"], ["e2"]],  # header + case-insensitive dedup, mirrors KVI outlet parsing
    }
    model = build_model(inp, {})
    by_code = {o["code"]: o for o in model["outlets"]}
    assert by_code["E1"]["ecom"] is True
    assert by_code["E2"]["ecom"] is True
    assert by_code["G1"]["ecom"] is False
    print("PASS: test_main_model_ecom_outlet_flagging")


if __name__ == "__main__":
    test_normalize_code()
    test_normalize_outlet()
    test_merge_class_flags()
    test_compute_ads()
    test_ecom_universe_coverage()
    test_main_universe_basic()
    test_kvi_outlet_flagging()
    test_kvi_outlet_absent_defaults_false()
    test_main_model_ecom_outlet_flagging()
    print("PASS: all scripts/model.py + scripts/calc.py tests")
