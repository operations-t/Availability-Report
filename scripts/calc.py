"""
Python port of public/js/calc.js.

Kept deliberately close to the JS original so behavior stays identical:
normalize_code / normalize_outlet / merge_class_flags mirror the JS
functions line-for-line. calculate_slot is NOT used at build time for
status/dos/available (those depend on the live Required DOS filter,
selected in the browser) -- only ads (Average Daily Sales) is
build-time-computable since it doesn't depend on Required DOS. The
browser's calc.js still computes dos/status/shortfall/available from
stock + ads + the user's selected Required DOS, exactly as before.
"""

import re

_TRAILING_ZERO_RE = re.compile(r"^-?\d+\.0+$")


def normalize_code(value):
    """Mirrors calc.js normalizeCode: trims, strips a trailing '.0' from
    numeric-looking codes (Excel often stores integer codes as floats)."""
    if value is None:
        return ""
    s = str(value).strip()
    if _TRAILING_ZERO_RE.match(s):
        return re.sub(r"\.0+$", "", s)
    return s


def normalize_outlet(value):
    """Mirrors calc.js normalizeOutlet: normalize_code + uppercase."""
    return normalize_code(value).upper()


def merge_class_flags(target, criteria):
    """Mirrors calc.js mergeClassFlags: sets target['core']/['kvi']/['promo']
    booleans (True only, never resets to False) based on a criteria string
    that may contain multiple classifications separated by , / + &."""
    value = str(criteria if criteria is not None else "").strip().upper()
    pieces = [p.strip() for p in re.split(r"[,/+&]", value) if p.strip()]
    if value == "CORE" or "CORE" in pieces:
        target["core"] = True
    if value == "KVI" or "KVI" in pieces:
        target["kvi"] = True
    if value == "PROMO" or "PROMO" in pieces:
        target["promo"] = True
    return target


def compute_ads(sales_qty):
    """Average Daily Sales = 30-Day Sales Qty / 30. This is the only
    DOS-independent derived figure -- safe to precompute at build time."""
    try:
        s = float(sales_qty) if sales_qty is not None else 0.0
        if s != s:  # NaN check
            s = 0.0
    except (TypeError, ValueError):
        s = 0.0
    return s / 30.0


def class_label(sku):
    out = []
    if sku.get("core"):
        out.append("Core")
    if sku.get("kvi"):
        out.append("KVI")
    if sku.get("promo"):
        out.append("Promo")
    return " + ".join(out) if out else "Unclassified"
