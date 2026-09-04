import { CONFIG } from "./config.js";

/**
 * Loads the pre-built processed/dashboard_data.json produced at build
 * time by scripts/build_data.py from the five source workbooks. All
 * XLSX parsing and outlet x SKU universe construction now happens
 * server-side in Python (see scripts/model.py, a line-for-line port of
 * the logic that used to run here in the browser). The shape returned
 * by reshape() below matches exactly what buildModel() used to return,
 * so engine.js and calc.js need no changes.
 */

function toFloatArray(arr) {
  // JSON has no NaN; build_data.py serializes missing values as null.
  // Reconstruct Float64Array with NaN in those slots, exactly like the
  // original in-browser buildModel() did.
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    out[i] = v === null || v === undefined ? NaN : v;
  }
  return out;
}

function toUint8Array(arr) {
  const out = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] ? 1 : 0;
  return out;
}

function reshapeUniverse(u) {
  return {
    outlets: u.outlets,
    skus: u.skus,
    stock: toFloatArray(u.stock),
    sales: toFloatArray(u.sales),
    stockPresent: toUint8Array(u.stockPresent),
    salesPresent: toUint8Array(u.salesPresent),
    outletCount: u.outletCount,
    skuCount: u.skuCount,
    slotCount: u.slotCount,
  };
}

function reshapeEcom(e) {
  if (!e) return null;
  return {
    ...reshapeUniverse(e),
    listedSkuCount: e.listedSkuCount,
    uncoveredSkus: e.uncoveredSkus,
    health: e.health,
    kind: "ecom",
  };
}

export async function loadProcessed(onProgress) {
  onProgress?.("Loading processed dashboard data…");
  const res = await fetch(`./${CONFIG.processedDataPath}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Processed data not found (HTTP ${res.status}). The build workflow may not have run yet, ` +
      `or it failed before producing ${CONFIG.processedDataPath}. Check the ` +
      `"Refresh dashboard and deploy Pages" workflow run in the Actions tab.`
    );
  }
  const raw = await res.json();
  onProgress?.("Reconstructing data model…");

  const model = reshapeUniverse(raw);
  model.health = raw.health;
  model.ecom = reshapeEcom(raw.ecom);

  return model;
}
