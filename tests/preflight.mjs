import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
assert.ok(fs.existsSync(path.join(root,'app/page.jsx')));
assert.ok(fs.existsSync(path.join(root,'app/DashboardBoot.jsx')));
assert.ok(fs.existsSync(path.join(root,'next.config.mjs')));
assert.match(read('next.config.mjs'),/output:\s*['"]export['"]/);
assert.match(read('public/js/config.js'),/processedDataPath/);
assert.doesNotMatch(read('public/js/config.js'),/apiKey|driveApiKey/i,'no Drive API key should be referenced in the browser bundle \u2014 Drive access is build-time only');
assert.match(read('public/js/data-loader.js'),/export async function loadProcessed/);
assert.doesNotMatch(read('public/js/data-loader.js'),/googleapis\.com/,'the browser must not call the Google Drive API directly \u2014 data is pre-built by scripts/build_data.py');
assert.doesNotMatch(read('app/page.jsx'),/NEXT_PUBLIC_DRIVE_API_KEY|loadModal|loadBtn|Load Data/,'no Drive API key env var and no manual Load Data modal/button \u2014 data loads automatically from build-time output');
assert.match(read('public/js/ui.js'),/xl-table/,'table() must render the searchable/sortable Excel-like wrapper');
assert.match(read('public/js/table-search.js',),/activateTables/);
assert.ok(fs.existsSync(path.join(root,'scripts/calc.py')));
assert.ok(fs.existsSync(path.join(root,'scripts/model.py')));
assert.ok(fs.existsSync(path.join(root,'scripts/build_data.py')));
assert.ok(fs.existsSync(path.join(root,'scripts/download_drive_data.py')));
assert.ok(fs.existsSync(path.join(root,'scripts/validate_build.py')));
assert.ok(fs.existsSync(path.join(root,'scripts/preflight.py')));
assert.ok(fs.existsSync(path.join(root,'scripts/tests/test_model.py')));
assert.match(read('scripts/tests/test_model.py'),/test_ecom_universe_coverage/);
assert.ok(fs.existsSync(path.join(root,'data/drive_source.json')));
assert.ok(fs.existsSync(path.join(root,'data/config.json')));
assert.match(read('scripts/model.py'),/def build_ecom_submodel/);
assert.match(read('scripts/model.py'),/def build_model/);
assert.match(read('scripts/build_data.py'),/OUTPUT_PATH = "public\//,'build_data.py must write into public/ so Next.js serves the output');
assert.match(read('scripts/download_drive_data.py'),/gdown/);
assert.doesNotMatch(read('scripts/download_drive_data.py'),/googleapis\.com|api_key|API_KEY/,'the build-time downloader should use gdown against a link-shared folder, not a Google Cloud API key');
assert.match(read('data/drive_source.json'),/1OiccpJ7WLxYVBSn6Gw9DMacK2ds0wW4j/);
assert.match(read('.github/workflows/deploy-pages.yml'),/download_drive_data\.py/);
assert.match(read('.github/workflows/deploy-pages.yml'),/build_data\.py/);
assert.match(read('.github/workflows/deploy-pages.yml'),/validate_build\.py/);
assert.match(read('.github/workflows/deploy-pages.yml'),/scripts\/tests\/test_model\.py/);
assert.match(read('app/page.jsx'),/SKU Wise Availability for Ecom/);
assert.match(read('app/page.jsx'),/toggleThemeBtn/);
assert.match(read('app/page.jsx'),/toggleSidebarBtn/);
assert.match(read('app/page.jsx'),/toggleFiltersBtn/);
assert.match(read('app/layout.jsx'),/data-theme="light"/);
assert.match(read('public/js/engine.js'),/91%-100%/);
assert.match(read('public/js/engine.js'),/Below 60%/);
assert.match(read('public/js/views.js'),/Ecom Availability/);
assert.match(read('public/js/views.js'),/Availability Loss Tree/);
assert.match(read('public/js/views.js'),/Product Division/);
assert.doesNotMatch(read('public/js/views.js'),/renderZoneView|Zone View/,'Zone View must be removed per change log Section 11');
assert.doesNotMatch(read('app/page.jsx'),/data-page="zone"/,'the Zone View nav entry must be removed');
assert.doesNotMatch(read('app/page.jsx'),/id="csvBtn"/,'the top nav CSV button must be removed per Section 1 \u2014 table-level CSV replaces it');
assert.match(read('public/js/ui.js'),/xl-table-csv/,'every table must have its own CSV download button per Section 3');
assert.match(read('public/js/engine.js'),/outletType/);
assert.match(read('public/js/engine.js'),/kviOutlet/);
assert.match(read('public/js/engine.js'),/E-COM Outlet/,'Outlet Type filter must include an E-COM Outlet option');
assert.match(read('public/js/calc.js'),/calculateEcomSlot/,'Ecom availability must use its own stock-threshold calculation, not the DOS-based calculateSlot');
assert.match(read('public/js/calc.js'),/Sufficient Stock/);
assert.match(read('public/js/calc.js'),/Below Threshold/);
assert.match(read('public/js/engine.js'),/requiredEcomStock/,'the Ecom stock threshold must be a live filter, not hardcoded');
assert.match(read('app/page.jsx'),/ecomStockSelect/,'the Required Ecom Stock control must be present in the top bar');
assert.ok(fs.existsSync(path.join(root,'public/js/pdf-export.js')),'the PDF summary export module must exist');
assert.match(read('public/js/pdf-export.js'),/buildReportData/);
assert.match(read('public/js/pdf-export.js'),/jspdf/i);
assert.match(read('app/page.jsx'),/id="pdfBtn"/,'the PDF Summary button must be present in the top bar');
assert.match(read('public/js/views.js'),/Outlet Wise Availability for Ecom/,'the Ecom page must show an outlet-level table before the SKU table');
assert.match(read('public/js/views.js'),/DISPLAY_ROW_CAP/,'large tables must have a display row cap to prevent the page from freezing on production-scale data (CSV/Excel export still gets everything)');
assert.match(read('public/js/engine.js'),/materializedSlots/,'summary/groupBy/topExceptions/productHierarchySummary/detailPage must share one materialized pass over the filtered slot universe per render, not each independently re-walk it (this was the actual cause of the Core/KVI/Promo page freeze, not the row count)');

{
  const css=read('app/globals.css');
  assert.ok(/backdrop-filter:\s*blur/.test(css),'the liquid-glass surface treatment must be present');
  const legacyNavy=['#172536','#0f1a29','#31435a','#8ab3ff','#142131','#304054','#25384d'];
  for(const hex of legacyNavy){
    assert.ok(!css.includes(hex),`leftover navy-palette hardcode ${hex} must not remain -- it is what made dark mode look faded against the neutral token palette`);
  }
}
assert.match(read('public/js/calc.js'),/scored/,'calculateSlot must flag unscored slots so they can be excluded from availability denominators');
assert.match(read('public/js/engine.js'),/scored!==false/,'materializedSlots must exclude unscored slots from every availability denominator');
{
  const css=read('app/globals.css');
  const matches=[...css.matchAll(/\.outlet-band\{[^}]*font-size:\s*(\d+)px/g)];
  assert.ok(matches.length>0,'.outlet-band (the band badge rendered inside every table by bandBadge()) must have a font-size rule');
  const lastFontSize=Number(matches[matches.length-1][1]);
  assert.ok(lastFontSize<=10,`the in-table band badge (.outlet-band) font-size must stay small (<=10px, currently ${lastFontSize}px) -- it must not revert to its old large size`);
}
assert.match(read('public/js/app.js'),/showEcomOutletDrill/,'the Ecom outlet table must have its own drill-down, not fall through to the main-dashboard showDrill');
assert.match(read('public/js/app.js'),/downloadSummaryPdf/,'the PDF button must be wired to the export function');
assert.match(read('scripts/model.py'),/kvi_outlet_codes/);
assert.match(read('app/page.jsx'),/data-filter="outletType"/);
assert.match(read('app/page.jsx'),/data-filter="kviOutlet"/);
assert.doesNotMatch(read('public/js/views.js'),/Priority exceptions/i,'Priority Exceptions must be removed from Summary per Section 6');

function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const skipDirs=[path.join(root,'data','downloads'),path.join(root,'node_modules'),path.join(root,'.git'),path.join(root,'out')];
function walkExcluding(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    const full=path.join(dir,e.name);
    if(skipDirs.some(skip=>full===skip||full.startsWith(skip+path.sep)))return[];
    return e.isDirectory()?walkExcluding(full):[full];
  });
}
const xlsx=walkExcluding(root).filter(f=>f.toLowerCase().endsWith('.xlsx'));
assert.deepEqual(xlsx,[],`Operational XLSX files must not be shipped (outside data/downloads/, which is build-time-only and gitignored): ${xlsx.join(', ')}`);
console.log('PASS: Next.js/GitHub Pages package preflight');
