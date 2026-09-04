export function normalizeCode(value) {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  if (/^-?\d+\.0+$/.test(s)) return s.replace(/\.0+$/, "");
  return s;
}

export function normalizeOutlet(value) {
  return normalizeCode(value).toUpperCase();
}

export function mergeClassFlags(target, criteria) {
  const value = String(criteria ?? "").trim().toUpperCase();
  const pieces = value.split(/[,/+&]/).map(v => v.trim()).filter(Boolean);
  if (value === "CORE" || pieces.includes("CORE")) target.core = true;
  if (value === "KVI" || pieces.includes("KVI")) target.kvi = true;
  if (value === "PROMO" || pieces.includes("PROMO")) target.promo = true;
  return target;
}

/**
 * Core availability calculation.
 *
 * Audit fixes applied (see README "Availability rules"):
 *  1. Status thresholds SCALE with requiredDOS instead of being
 *     hardcoded to 1/2, so "Healthy" can never appear on a slot the
 *     dashboard counts as unavailable.
 *  2. Stock present with zero sales counts as AVAILABLE. This is an
 *     availability dashboard: stock on the shelf is available to a
 *     customer even if it hasn't sold in 30 days. Such slots keep the
 *     distinct "No Sales" status so slow movers stay identifiable.
 *  3. Slots with no source record at all (neither stock nor sales) are
 *     marked scored:false and must be EXCLUDED from availability
 *     denominators, mirroring the Ecom coverage rule -- a partial
 *     source extract must not manufacture fake unavailability.
 *  4. Negative stock is clamped to 0 for DOS/availability purposes so
 *     it can't produce a negative DOS that pollutes Average DOS.
 *  5. Shortfall for a No-Sales slot is measured against a minimum of
 *     one unit rather than ads*requiredDOS (which would be 0), so
 *     shortfall totals reflect the real gap to full availability.
 */
export function calculateSlot(stockRaw, salesRaw, requiredDOS = 2, stockPresent = true, salesPresent = true) {
  const rawStock = Number.isFinite(Number(stockRaw)) ? Number(stockRaw) : 0;
  const stock = Math.max(rawStock, 0);
  const salesQty = Math.max(Number.isFinite(Number(salesRaw)) ? Number(salesRaw) : 0, 0);
  const ads = salesQty / 30;

  // A slot with no source record on either side cannot be scored.
  const scored = Boolean(stockPresent || salesPresent);

  let dos = null;
  let available;
  let status;

  if (ads === 0) {
    // No sales in the window: availability is decided purely by whether
    // stock is on hand. DOS is undefined (infinite cover, no demand).
    available = stock > 0;
    status = "No Sales";
  } else {
    dos = stock / ads;
    available = dos >= requiredDOS;
    if (stock <= 0) status = "OOS";
    else if (dos < requiredDOS * 0.5) status = "Low";
    else if (dos < requiredDOS) status = "At Risk";
    else status = "Healthy";
  }

  // Units needed to reach availability. For a No-Sales slot the target
  // is simply "have at least one unit"; otherwise it is ads*requiredDOS.
  const requiredStock = ads === 0 ? (available ? 0 : 1) : ads * requiredDOS;
  const shortfall = Math.max(requiredStock - stock, 0);

  if (!scored) {
    available = false;
    status = "Not Covered";
  }

  return { stock, salesQty, ads, dos, requiredStock, shortfall, status, available, stockPresent, salesPresent, scored };
}

/**
 * Ecom availability rule: a slot is available only when stock quantity
 * meets the required threshold (default 5 units). This is entirely
 * stock-quantity-based -- sales/DOS play no role in either `available`
 * or `status` here, unlike the main dashboard's calculateSlot. dos/ads
 * are still returned (computed the same way) purely as informational
 * figures for anyone reading the raw slot data; the Stock Status badge
 * itself uses the new two-state stock-threshold status below, so it
 * never contradicts the availability badge in the same row.
 */
export function calculateEcomSlot(stockRaw, salesRaw, requiredStock = 5, stockPresent = true, salesPresent = true) {
  const stock = Math.max(Number.isFinite(Number(stockRaw)) ? Number(stockRaw) : 0, 0);
  const salesQty = Math.max(Number.isFinite(Number(salesRaw)) ? Number(salesRaw) : 0, 0);
  const ads = salesQty / 30;
  const dos = ads === 0 ? null : stock / ads;
  const shortfall = Math.max(requiredStock - stock, 0);
  const scored = Boolean(stockPresent || salesPresent);
  let available = stock >= requiredStock;
  let status = available ? "Sufficient Stock" : "Below Threshold";
  if (!scored) { available = false; status = "Not Covered"; }
  return { stock, salesQty, ads, dos, requiredStock, shortfall, status, available, stockPresent, salesPresent, scored };
}

export function pct(n, d) { return d ? (n / d) * 100 : 0; }
export function classLabel(sku) {
  const out = [];
  if (sku.core) out.push("Core");
  if (sku.kvi) out.push("KVI");
  if (sku.promo) out.push("Promo");
  return out.join(" + ") || "Unclassified";
}
