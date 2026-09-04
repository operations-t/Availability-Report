"""
Python port of public/js/model.js.

Produces the same logical structure buildModel() returns in the browser:
outlets[], skus[], parallel slot arrays (stock/sales/stockPresent/
salesPresent) indexed by outlet_index * skuCount + sku_index, an ecom
submodel with the same coverage rule, and the same health/diagnostics
block. This is serialized to processed/dashboard_data.json; the browser
reconstructs it and runs the exact same engine.js/calc.js logic it always
has, just skipping the "parse raw xlsx in-browser" step.

Column-header lookup, deduplication counting, and the ecom
stock-coverage rule are ported line-for-line from model.js so the
numbers match exactly.
"""

import math
from calc import normalize_code, normalize_outlet, merge_class_flags


def clean(v):
    if v is None:
        return ""
    return str(v).strip()


def to_number(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
        if f != f or math.isinf(f):  # NaN or Inf
            return None
        return f
    except (TypeError, ValueError):
        return None


def row_objects(rows):
    """rows: list of lists, first row is headers. Returns (headers, [dict,...])."""
    if not rows:
        return [], []
    headers = [clean(h) for h in rows[0]]
    data = []
    for r in rows[1:]:
        obj = {}
        for i, h in enumerate(headers):
            obj[h] = r[i] if i < len(r) else ""
        data.append(obj)
    return headers, data


def need(headers, names, label):
    for name in names:
        if name in headers:
            return name
    raise ValueError(f"{label}: required field not found. Expected one of: {', '.join(names)}")


def duplicate_stats(values):
    counts = {}
    for v in values:
        if v:
            counts[v] = counts.get(v, 0) + 1
    keys = 0
    extra = 0
    for c in counts.values():
        if c > 1:
            keys += 1
            extra += c - 1
    return {"duplicateKeys": keys, "extraRows": extra}


def missing_count(rows, field):
    return sum(1 for r in rows if not clean(r.get(field)))


def build_ecom_submodel(ecom_sku_rows, ecom_outlet_rows, source_meta, stock_rows,
                         sales_headers, sales_data, stock_headers, stock_sku_idx,
                         stock_name_idx, stock_prod_seen, stock_header_seen,
                         outlet_map, main_sku_map):
    if not ecom_sku_rows or not ecom_outlet_rows:
        return None

    h, data = row_objects(ecom_sku_rows)
    c_sku = need(h, ["Product Code", "Article Code", "SKU Code"], "Ecom SKU")
    c_name = need(h, ["Product Name", "Name", "Article Name"], "Ecom SKU")
    c_fm = "FM" if "FM" in h else None

    listed_map = {}
    for r in data:
        code = normalize_code(r.get(c_sku))
        if not code:
            continue
        item = listed_map.get(code)
        if not item:
            item = {"code": code, "name": clean(r.get(c_name)), "fm": False, "sourceRows": 0}
            listed_map[code] = item
        item["sourceRows"] += 1
        if not item["name"] and clean(r.get(c_name)):
            item["name"] = clean(r.get(c_name))
        if c_fm and clean(r.get(c_fm)).upper() == "FM":
            item["fm"] = True

    listed_skus = sorted(listed_map.values(), key=lambda x: x["code"])
    sku_dup = duplicate_stats([normalize_code(r.get(c_sku)) for r in data])

    outlet_codes = []
    for row in ecom_outlet_rows:
        code = normalize_outlet(row[0] if row else None)
        if not code or code in ("OUTLET CODE", "CODE", "ECOM OUTLET"):
            continue
        outlet_codes.append(code)
    outlet_dup = duplicate_stats(outlet_codes)
    unique_outlet_codes = list(dict.fromkeys(outlet_codes))

    # Current Stock is the extraction-coverage authority for Ecom availability.
    # SKUs absent from Stock are retained as listed Ecom SKUs but are NOT
    # scored, preventing a partial stock/sales extract from creating false
    # unavailability. (Mirrors model.js exactly.)
    covered_sku_codes = [c for c in listed_map.keys() if c in stock_prod_seen]
    uncovered_sku_codes = [c for c in listed_map.keys() if c not in stock_prod_seen]
    covered_skus = []
    for code in covered_sku_codes:
        listed = listed_map[code]
        base = main_sku_map.get(code)
        covered_skus.append({
            "code": code,
            "name": listed["name"] or (base["name"] if base else "") or "",
            "category": (base["category"] if base else "") or "",
            "category3": (base["category3"] if base else "") or "",
            "core": bool(base and base.get("core")),
            "kvi": bool(base and base.get("kvi")),
            "promo": bool(base and base.get("promo")),
            "ecom": True,
            "fm": bool(listed.get("fm")),
        })
    covered_skus.sort(key=lambda s: s["code"])
    sku_index = {s["code"]: i for i, s in enumerate(covered_skus)}

    outlet_coverage = {"notInZone": [], "notInStock": []}
    outlets = []
    for code in unique_outlet_codes:
        zone_outlet = outlet_map.get(code)
        if not zone_outlet:
            outlet_coverage["notInZone"].append(code)
            continue
        if code not in stock_header_seen:
            outlet_coverage["notInStock"].append(code)
            continue
        o = dict(zone_outlet)
        o["ecom"] = True
        outlets.append(o)
    outlets.sort(key=lambda o: o["code"])
    outlet_index = {o["code"]: i for i, o in enumerate(outlets)}

    sku_count = len(covered_skus)
    slot_count = len(outlets) * sku_count
    stock = [float("nan")] * slot_count
    sales = [float("nan")] * slot_count
    stock_present = [0] * slot_count
    sales_present = [0] * slot_count

    def idx(oi, si):
        return oi * sku_count + si

    ecom_stock_cols = []
    for j, header in enumerate(stock_headers):
        if j == stock_sku_idx or j == stock_name_idx:
            continue
        code = normalize_outlet(header)
        oi = outlet_index.get(code)
        if oi is not None:
            ecom_stock_cols.append((j, oi, code))

    for ri in range(1, len(stock_rows)):
        r = stock_rows[ri] if stock_rows[ri] else []
        code = normalize_code(r[stock_sku_idx] if stock_sku_idx < len(r) else None)
        si = sku_index.get(code)
        if si is None:
            continue
        for j, oi, _code in ecom_stock_cols:
            raw = r[j] if j < len(r) else None
            if raw == "" or raw is None:
                continue
            val = to_number(raw)
            if val is None:
                continue
            k = idx(oi, si)
            if stock_present[k]:
                stock[k] += val
            else:
                stock[k] = val
            stock_present[k] = 1

    d_outlet = need(sales_headers, ["Outlet Code", "CODE"], "Sales")
    d_sku = need(sales_headers, ["Article Code", "ProductCode", "SKU Code"], "Sales")
    d_qty = need(sales_headers, ["POS Sales Qty", "30-Day Sales Qty", "Sales Qty"], "Sales")
    ecom_sales_sku_seen = set()
    ecom_sales_outlet_seen = set()
    for r in sales_data:
        oc = normalize_outlet(r.get(d_outlet))
        sc = normalize_code(r.get(d_sku))
        oi = outlet_index.get(oc)
        si = sku_index.get(sc)
        if oi is None or si is None:
            continue
        ecom_sales_sku_seen.add(sc)
        ecom_sales_outlet_seen.add(oc)
        val = to_number(r.get(d_qty)) or 0
        k = idx(oi, si)
        if sales_present[k]:
            sales[k] += val
        else:
            sales[k] = val
        sales_present[k] = 1

    missing_stock = sum(1 for p in stock_present if not p)
    missing_sales = sum(1 for p in sales_present if not p)

    health = {
        "sourceMeta": (source_meta or {}).get("ecom", {}),
        "listedSkuRows": len(data),
        "listedSkus": len(listed_skus),
        "coveredSkus": len(covered_skus),
        "uncoveredSkus": len(uncovered_sku_codes),
        "uncoveredSkuCodes": uncovered_sku_codes,
        "duplicateSkuCodes": sku_dup["duplicateKeys"],
        "duplicateSkuExtraRows": sku_dup["extraRows"],
        "fmSkus": sum(1 for x in listed_skus if x["fm"]),
        "coveredFmSkus": sum(1 for x in covered_skus if x["fm"]),
        "listedOutletRows": len(outlet_codes),
        "listedOutlets": len(unique_outlet_codes),
        "coveredOutlets": len(outlets),
        "duplicateOutlets": outlet_dup["duplicateKeys"],
        "duplicateOutletExtraRows": outlet_dup["extraRows"],
        "outletsNotInZone": outlet_coverage["notInZone"],
        "outletsNotInStock": outlet_coverage["notInStock"],
        "salesCoveredSkus": len(ecom_sales_sku_seen),
        "salesCoveredOutlets": len(ecom_sales_outlet_seen),
        "universe": {
            "outlets": len(outlets), "skus": sku_count, "slots": slot_count,
            "missingStock": missing_stock, "missingSales": missing_sales,
            "stockPresent": slot_count - missing_stock, "salesPresent": slot_count - missing_sales,
        },
        "assumption": ("Ecom availability is scored only for listed Ecom SKUs present in "
                        "Current Stock. Listed Ecom SKUs absent from Current Stock are shown "
                        "as data-not-covered and excluded from the Ecom availability denominator."),
    }

    return {
        "outlets": outlets,
        "skus": covered_skus,
        "listedSkus": listed_skus,
        "uncoveredSkus": [x for x in listed_skus if x["code"] not in sku_index],
        "outletCount": len(outlets),
        "skuCount": sku_count,
        "listedSkuCount": len(listed_skus),
        "slotCount": slot_count,
        "stock": stock, "sales": sales, "stockPresent": stock_present, "salesPresent": sales_present,
        "health": health,
        "kind": "ecom",
    }


def build_model(inp, source_meta=None):
    source_meta = source_meta or {}
    ch, class_data = row_objects(inp["classification"])
    dh, sales_data = row_objects(inp["sales"])
    stock_rows = inp.get("stock") or []
    zh, zone_data = row_objects(inp["zone"])
    sh = [clean(c) for c in stock_rows[0]] if stock_rows else []

    # KVI Outlet mapping (change log Section 8): a single-column CODE
    # list. An outlet is "KVI" if its normalized code appears here,
    # independent of any SKU-level KVI classification.
    kvi_outlet_rows = inp.get("kviOutlet") or []
    kvi_outlet_codes = set()
    for row in kvi_outlet_rows:
        raw = row[0] if row else None
        code = normalize_outlet(raw)
        if not code or code in ("CODE", "OUTLET CODE", "KVI OUTLET"):
            continue
        kvi_outlet_codes.add(code)

    # Ecom Outlet mapping: a single-column CODE list (ECOM OUTLET sheet).
    # Stamped onto every main-model outlet as outlet.ecom, independent of
    # whether that outlet is actually covered in the Ecom submodel (which
    # additionally requires presence in Zone Distribution + Current
    # Stock) -- this flag is purely "was this outlet code listed in
    # ECOM OUTLET", for the Outlet Type filter.
    ecom_outlet_rows_raw = inp.get("ecomOutlet") or []
    ecom_outlet_codes = set()
    for row in ecom_outlet_rows_raw:
        raw = row[0] if row else None
        code = normalize_outlet(raw)
        if not code or code in ("CODE", "OUTLET CODE", "ECOM OUTLET"):
            continue
        ecom_outlet_codes.add(code)

    c_sku = need(ch, ["Article Code", "SKU Code", "ProductCode"], "Classification")
    c_name = need(ch, ["Name", "ProductName", "Article Name"], "Classification")
    c_criteria = need(ch, ["Criteria", "Classification"], "Classification")
    c_cat3 = need(ch, ["CAT3", "Category-3", "Category 3"], "Classification")
    c_category = "Category" if "Category" in ch else need(ch, ["New Division"], "Classification")

    z_code = need(zh, ["CODE", "Outlet Code"], "Zone Distribution")
    z_name = need(zh, ["Outlet Name", "Outlet"], "Zone Distribution")
    z_zone = need(zh, ["Area", "Zone"], "Zone Distribution")
    z_rho = need(zh, ["Regional Head HR Name", "RHO", "Regional Head"], "Zone Distribution")
    z_zonal = need(zh, ["Zonal HR Name", "Zonal"], "Zone Distribution")
    z_division = need(zh, ["Division"], "Zone Distribution")
    z_format = need(zh, ["Format", "Store Type"], "Zone Distribution")
    z_location = need(zh, ["Location Type"], "Zone Distribution")

    d_outlet = need(dh, ["Outlet Code", "CODE"], "Sales")
    d_sku = need(dh, ["Article Code", "ProductCode", "SKU Code"], "Sales")
    d_qty = need(dh, ["POS Sales Qty", "30-Day Sales Qty", "Sales Qty"], "Sales")

    s_sku = need(sh, ["ProductCode", "Article Code", "SKU Code"], "Stock")
    s_name = need(sh, ["ProductName", "Name"], "Stock")
    s_sku_idx = sh.index(s_sku)
    s_name_idx = sh.index(s_name)

    sku_map = {}
    class_dup_codes = 0
    class_extra = 0
    class_counts = {}
    for r in class_data:
        code = normalize_code(r.get(c_sku))
        if not code:
            continue
        sku = sku_map.get(code)
        if not sku:
            sku = {"code": code, "name": clean(r.get(c_name)), "category3": clean(r.get(c_cat3)),
                   "category": clean(r.get(c_category)), "core": False, "kvi": False, "promo": False,
                   "sourceRows": 0}
            sku_map[code] = sku
        sku["sourceRows"] += 1
        if not sku["name"] and clean(r.get(c_name)):
            sku["name"] = clean(r.get(c_name))
        if not sku["category3"] and clean(r.get(c_cat3)):
            sku["category3"] = clean(r.get(c_cat3))
        if not sku["category"] and clean(r.get(c_category)):
            sku["category"] = clean(r.get(c_category))
        merge_class_flags(sku, r.get(c_criteria))
        crit = clean(r.get(c_criteria))
        class_counts[crit] = class_counts.get(crit, 0) + 1
    for s in sku_map.values():
        if s["sourceRows"] > 1:
            class_dup_codes += 1
            class_extra += s["sourceRows"] - 1
    skus = sorted(sku_map.values(), key=lambda s: s["code"])
    sku_index = {s["code"]: i for i, s in enumerate(skus)}

    outlet_map = {}
    for r in zone_data:
        code = normalize_outlet(r.get(z_code))
        if not code:
            continue
        if code not in outlet_map:
            outlet_map[code] = {
                "code": code, "name": clean(r.get(z_name)), "zone": clean(r.get(z_zone)),
                "rho": clean(r.get(z_rho)), "zonal": clean(r.get(z_zonal)),
                "division": clean(r.get(z_division)), "district": clean(r.get("District")),
                "storeType": clean(r.get(z_format)), "locationType": clean(r.get(z_location)),
                "kvi": code in kvi_outlet_codes,
                "ecom": code in ecom_outlet_codes,
            }
    outlets = sorted(outlet_map.values(), key=lambda o: o["code"])
    outlet_index = {o["code"]: i for i, o in enumerate(outlets)}

    sku_count = len(skus)
    slot_count = len(outlets) * sku_count
    stock = [float("nan")] * slot_count
    sales = [float("nan")] * slot_count
    stock_present = [0] * slot_count
    sales_present = [0] * slot_count

    def idx(oi, si):
        return oi * sku_count + si

    stock_outlet_columns = []
    stock_header_seen = {}
    for j, header in enumerate(sh):
        if j == s_sku_idx or j == s_name_idx:
            continue
        code = normalize_outlet(header)
        if not code:
            continue
        stock_header_seen[code] = stock_header_seen.get(code, 0) + 1
        oi = outlet_index.get(code)
        if oi is not None:
            stock_outlet_columns.append((j, oi, code))

    stock_data_rows = 0
    stock_dup_products = 0
    stock_extra_product_rows = 0
    stock_prod_seen = {}
    for ri in range(1, len(stock_rows)):
        r = stock_rows[ri] if stock_rows[ri] else []
        stock_data_rows += 1
        code = normalize_code(r[s_sku_idx] if s_sku_idx < len(r) else None)
        if not code:
            continue
        stock_prod_seen[code] = stock_prod_seen.get(code, 0) + 1
        si = sku_index.get(code)
        if si is None:
            continue
        for j, oi, _code in stock_outlet_columns:
            raw = r[j] if j < len(r) else None
            if raw == "" or raw is None:
                continue
            val = to_number(raw)
            if val is None:
                continue
            k = idx(oi, si)
            if stock_present[k]:
                stock[k] += val
            else:
                stock[k] = val
            stock_present[k] = 1
    for c in stock_prod_seen.values():
        if c > 1:
            stock_dup_products += 1
            stock_extra_product_rows += c - 1

    sales_dup_pairs = 0
    sales_extra_rows = 0
    sales_pair_counts = {}
    sales_outlet_codes = set()
    sales_sku_codes = set()
    for r in sales_data:
        oc = normalize_outlet(r.get(d_outlet))
        sc = normalize_code(r.get(d_sku))
        if not oc or not sc:
            continue
        sales_outlet_codes.add(oc)
        sales_sku_codes.add(sc)
        oi = outlet_index.get(oc)
        si = sku_index.get(sc)
        key = oc + "\u0000" + sc
        sales_pair_counts[key] = sales_pair_counts.get(key, 0) + 1
        if oi is None or si is None:
            continue
        val = to_number(r.get(d_qty)) or 0
        k = idx(oi, si)
        if sales_present[k]:
            sales[k] += val
        else:
            sales[k] = val
        sales_present[k] = 1
    for c in sales_pair_counts.values():
        if c > 1:
            sales_dup_pairs += 1
            sales_extra_rows += c - 1

    missing_stock = sum(1 for p in stock_present if not p)
    missing_sales = sum(1 for p in sales_present if not p)

    stock_outlet_all = list(stock_header_seen.keys())
    stock_sku_all = list(stock_prod_seen.keys())
    zone_codes = set(o["code"] for o in outlets)
    class_sku_codes = set(s["code"] for s in skus)
    unmatched = {
        "stockOutletsNotZone": [x for x in stock_outlet_all if x not in zone_codes],
        "salesOutletsNotZone": [x for x in sales_outlet_codes if x not in zone_codes],
        "zoneOutletsNotStock": [x for x in zone_codes if x not in stock_header_seen],
        "zoneOutletsNotSales": [x for x in zone_codes if x not in sales_outlet_codes],
        "stockSkusNotClassified": [x for x in stock_sku_all if x not in class_sku_codes],
        "salesSkusNotClassified": [x for x in sales_sku_codes if x not in class_sku_codes],
        "classifiedSkusNotStock": [x for x in class_sku_codes if x not in stock_prod_seen],
        "classifiedSkusNotSales": [x for x in class_sku_codes if x not in sales_sku_codes],
    }

    stock_header_dup_keys = 0
    stock_header_dup_extra = 0
    for c in stock_header_seen.values():
        if c > 1:
            stock_header_dup_keys += 1
            stock_header_dup_extra += c - 1
    zone_dup = duplicate_stats([normalize_outlet(r.get(z_code)) for r in zone_data])
    kvi_outlets_matched = sum(1 for o in outlets if o["kvi"])
    kvi_codes_not_in_zone = sorted(c for c in kvi_outlet_codes if c not in outlet_map)
    missing_fields = {
        "classification": {c_sku: missing_count(class_data, c_sku), c_name: missing_count(class_data, c_name),
                            c_criteria: missing_count(class_data, c_criteria), c_cat3: missing_count(class_data, c_cat3),
                            c_category: missing_count(class_data, c_category)},
        "sales": {d_outlet: missing_count(sales_data, d_outlet), d_sku: missing_count(sales_data, d_sku),
                  d_qty: missing_count(sales_data, d_qty)},
        "stock": {s_sku: sum(1 for r in stock_rows[1:] if not clean(r[s_sku_idx] if s_sku_idx < len(r) else None)),
                  s_name: sum(1 for r in stock_rows[1:] if not clean(r[s_name_idx] if s_name_idx < len(r) else None))},
        "zone": {z_code: missing_count(zone_data, z_code), z_name: missing_count(zone_data, z_name),
                 z_zone: missing_count(zone_data, z_zone), z_rho: missing_count(zone_data, z_rho),
                 z_zonal: missing_count(zone_data, z_zonal), z_division: missing_count(zone_data, z_division),
                 z_format: missing_count(zone_data, z_format), z_location: missing_count(zone_data, z_location)},
    }

    ecom = build_ecom_submodel(
        inp.get("ecomSku"), inp.get("ecomOutlet"), source_meta, stock_rows,
        dh, sales_data, sh, s_sku_idx, s_name_idx, stock_prod_seen, stock_header_seen,
        outlet_map, sku_map,
    )

    health = {
        "sourceMeta": source_meta,
        "classification": {"rows": len(class_data), "headers": ch, "uniqueSkus": len(skus),
                            "duplicateSkuCodes": class_dup_codes, "extraRows": class_extra,
                            "criteria": class_counts},
        "sales": {"rows": len(sales_data), "headers": dh, "uniquePairs": len(sales_pair_counts),
                  "duplicatePairs": sales_dup_pairs, "extraRows": sales_extra_rows,
                  "uniqueOutlets": len(sales_outlet_codes), "uniqueSkus": len(sales_sku_codes)},
        "stock": {"rows": stock_data_rows, "columns": len(sh), "outletColumns": len(stock_outlet_all),
                  "uniqueOutletColumns": len(set(stock_outlet_all)), "duplicateOutletHeaders": stock_header_dup_keys,
                  "extraOutletHeaders": stock_header_dup_extra, "uniqueProducts": len(stock_prod_seen),
                  "duplicateProducts": stock_dup_products, "extraRows": stock_extra_product_rows},
        "zone": {"rows": len(zone_data), "headers": zh, "uniqueOutlets": len(outlets),
                 "duplicateOutletCodes": zone_dup["duplicateKeys"], "extraRows": zone_dup["extraRows"]},
        "kviOutlet": {"listedCodes": len(kvi_outlet_codes), "matchedOutlets": kvi_outlets_matched,
                      "codesNotInZone": kvi_codes_not_in_zone},
        "universe": {"outlets": len(outlets), "skus": sku_count, "slots": slot_count,
                     "missingStock": missing_stock, "missingSales": missing_sales,
                     "stockPresent": slot_count - missing_stock, "salesPresent": slot_count - missing_sales},
        "unmatched": unmatched,
        "missingFields": missing_fields,
        "ecom": (ecom["health"] if ecom else None),
        "assumptions": {
            "categoryAlias": (f"Product Division is mapped to {c_category} because no Category field was supplied."
                               if c_category != "Category" else "Product Division uses the supplied Category field."),
            "outletApplicability": ("No outlet applicability field exists in the Core/KVI/Promo item master; "
                                     "universe = all unique Zone Distribution outlets \u00d7 all classified SKUs."),
            "activeOutlets": ("No explicit active/inactive field was supplied; all unique rows in the selected "
                               "Zone Distribution sheet are included."),
            "ecom": (ecom["health"]["assumption"] if ecom else "Ecom workbook not loaded."),
        },
    }

    return {
        "outlets": outlets, "skus": skus, "stock": stock, "sales": sales,
        "stockPresent": stock_present, "salesPresent": sales_present,
        "health": health, "slotCount": slot_count, "outletCount": len(outlets),
        "skuCount": sku_count, "ecom": ecom,
    }
