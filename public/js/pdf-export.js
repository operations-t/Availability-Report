import { fmt } from "./ui.js";

/**
 * Generates a downloadable PDF summary report of the current dashboard
 * state (Overall/Core/KVI/Promo/Ecom availability, status breakdown,
 * top unavailable zones and SKUs, and the active filter context).
 *
 * jsPDF + jspdf-autotable are loaded lazily from a CDN on first use
 * (not bundled at page load) since this is an optional export feature
 * and the app has no build step to bundle npm packages into the
 * browser JS served from public/js/.
 */

const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js";
const AUTOTABLE_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";

let loadPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-pdf-lib="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.dataset.pdfLib = src;
    s.onload = () => { s.dataset.loaded = "1"; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureJsPdfLoaded() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await loadScript(JSPDF_URL);
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("jsPDF failed to initialize after loading.");
    }
    await loadScript(AUTOTABLE_URL);
  })();
  return loadPromise;
}

function statusRows(status) {
  return Object.entries(status || {}).filter(([, v]) => v > 0).map(([label, value]) => [label, fmt.n(value)]);
}

/**
 * @param {object} data - assembled report data (see buildReportData below)
 */
async function renderPdf(data) {
  await ensureJsPdfLoaded();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 50;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Core · KVI · Promo Availability Tracker", margin, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110, 120, 140);
  doc.text(`Summary report · generated ${data.generatedAt}`, margin, y);
  doc.setTextColor(20, 25, 35);
  y += 8;
  doc.setDrawColor(220, 226, 235);
  doc.line(margin, y, pageWidth - margin, y);
  y += 22;

  // KPI headline table
  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Metric", "Availability", "Available / Total", "Notes"]],
    body: data.kpis.map(k => [k.label, k.availability, k.fraction, k.note || ""]),
    theme: "grid",
    headStyles: { fillColor: [36, 94, 170], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    styles: { cellPadding: 6 },
  });
  y = doc.lastAutoTable.finalY + 22;

  // Active filters context
  if (data.filterLines.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Active filters", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const line of data.filterLines) {
      if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 50; }
      doc.text(`• ${line}`, margin, y);
      y += 13;
    }
    y += 10;
  }

  // Overall status breakdown
  if (data.statusRows.length) {
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Overall Stock Status", "Slots"]],
      body: data.statusRows,
      theme: "striped",
      headStyles: { fillColor: [28, 111, 92], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
    });
    y = doc.lastAutoTable.finalY + 22;
  }

  // Lowest availability zones
  if (data.zoneRows.length) {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 50; }
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Zone", "Availability", "Unavailable", "Shortfall"]],
      body: data.zoneRows,
      theme: "grid",
      headStyles: { fillColor: [211, 138, 25], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
    });
    y = doc.lastAutoTable.finalY + 22;
  }

  // Top unavailable SKUs (capped -- this is a print report, not a
  // dashboard data table, so a reasonable cap keeps the PDF readable)
  if (data.skuRows.length) {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Top ${data.skuRows.length} unavailable SKUs`, margin, y);
    y += 6;
    doc.autoTable({
      startY: y + 8,
      margin: { left: margin, right: margin },
      head: [["SKU", "Name", "Availability", "Unavailable", "Shortfall"]],
      body: data.skuRows,
      theme: "grid",
      headStyles: { fillColor: [140, 63, 174], fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 1: { cellWidth: 180 } },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 158, 172);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 20, { align: "right" });
  }

  doc.save(data.filename);
}

/**
 * Assembles the report data from the current engine state. Kept
 * separate from renderPdf so the data-shaping logic (what counts as
 * "the summary") can be unit tested without touching jsPDF at all.
 */
export function buildReportData(engine, ecomEngine, model, skuLimit = 25, zoneLimit = 10) {
  const s = engine.summary();
  const c = engine.classificationSummaries();
  const e = ecomEngine?.summary();

  const kpis = [
    { label: "Overall Availability", availability: fmt.pct(s.availability), fraction: `${fmt.n(s.available)} / ${fmt.n(s.total)}`, note: `Required DOS ≥ ${engine.filters.requiredDOS}` },
    { label: "Core Availability", availability: fmt.pct(c.core.availability), fraction: `${fmt.n(c.core.available)} / ${fmt.n(c.core.total)}`, note: "" },
    { label: "KVI Availability", availability: fmt.pct(c.kvi.availability), fraction: `${fmt.n(c.kvi.available)} / ${fmt.n(c.kvi.total)}`, note: "KVI outlets only" },
    { label: "Promo Availability", availability: fmt.pct(c.promo.availability), fraction: `${fmt.n(c.promo.available)} / ${fmt.n(c.promo.total)}`, note: "" },
  ];
  if (e) {
    kpis.push({ label: "Ecom Availability", availability: fmt.pct(e.availability), fraction: `${fmt.n(e.available)} / ${fmt.n(e.total)}`, note: `Required Ecom Stock ≥ ${engine.filters.requiredEcomStock ?? 5}` });
  }

  const filterLines = [];
  const f = engine.filters;
  const dims = [
    ["zone", "Zone"], ["rho", "RHO"], ["zonal", "Zonal"], ["division", "Geo Division"], ["district", "District"],
    ["outlet", "Outlet"], ["storeType", "Store Type"], ["locationType", "Location Type"], ["outletType", "Outlet Type"],
    ["kviOutlet", "KVI Outlet"], ["sku", "SKU"], ["category", "Product Division"], ["category3", "CAT3"],
    ["classification", "Core/KVI/Promo"], ["status", "Stock Status"],
  ];
  for (const [key, label] of dims) {
    const set = f[key];
    if (set && set.size > 0) filterLines.push(`${label}: ${[...set].join(", ")}`);
  }
  if (!filterLines.length) filterLines.push("No filters applied — full assortment universe");

  const zoneRows = engine.groupBy("zone")
    .slice().sort((a, b) => a.availability - b.availability)
    .slice(0, zoneLimit)
    .map(g => [g.label, fmt.pct(g.availability), fmt.n(g.unavailable), fmt.n(g.shortfall, 1)]);

  const skuRows = engine.skuUnavailability()
    .slice(0, skuLimit)
    .map(g => [g.id, g.meta.name, fmt.pct(g.availability), fmt.n(g.unavailable), fmt.n(g.shortfall, 1)]);

  return {
    generatedAt: new Date().toLocaleString(),
    filename: `availability-summary-${new Date().toISOString().slice(0, 10)}.pdf`,
    kpis,
    filterLines,
    statusRows: statusRows(s.status),
    zoneRows,
    skuRows,
  };
}

export async function downloadSummaryPdf(engine, ecomEngine, model) {
  const data = buildReportData(engine, ecomEngine, model);
  await renderPdf(data);
}
