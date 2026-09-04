import {CONFIG} from "./config.js";
import {Engine,defaultFilters} from "./engine.js";
import {loadProcessed} from "./data-loader.js";
import {activateTables} from "./table-search.js";
import {MultiSelect,$,$$,toast,fmt,esc,kpi,statusBadge,classBadges,availBadge,table} from "./ui.js";
import {renderSummary,renderAvailability,renderOutletView,renderSkuView,renderEcomSkuView,renderClass,renderDivisionView,renderCat3View,renderRhoView,renderZonalView,renderLossTree,renderExceptions,renderHealth,renderEmpty} from "./views.js";
import {makeXlsx,downloadBlob} from "./xlsx-writer.js";
import {downloadSummaryPdf} from "./pdf-export.js";

let model=null,engine=null,ecomEngine=null,currentPage="summary",detailPage=1;
const filterLabels={
  category:"Product Division",category3:"CAT3",sku:"SKU",classification:"Core / KVI / Promo",
  rho:"RHO",zonal:"Zonal",zone:"Zone",division:"Geo Division",district:"District",outlet:"Outlet",
  storeType:"Store Type",locationType:"Location Type",outletType:"Outlet Type",kviOutlet:"KVI Outlet",status:"Stock Status"
};
const controls={};
for(const [key,label] of Object.entries(filterLabels)){
  const host=document.querySelector(`[data-filter="${key}"]`);
  controls[key]=new MultiSelect(host,{label,key,onChange:(k,set)=>{
    if(!engine)return;
    engine.filters[k]=set;
    syncFilterState();
    detailPage=1;
    refreshFilterOptions(k);
    render();
  }});
}

const appRoot=$("#appRoot");
const THEME_KEY="ckp_theme",SIDEBAR_KEY="ckp_sidebar_collapsed",FILTERS_KEY="ckp_filters_collapsed";
function setTheme(theme){
  const next=theme==="dark"?"dark":"light";
  document.body.dataset.theme=next;localStorage.setItem(THEME_KEY,next);
  const btn=$("#toggleThemeBtn");if(btn)btn.textContent=next==="dark"?"White Mode":"Dark Mode";
}
function setSidebarCollapsed(collapsed){appRoot?.classList.toggle("sidebar-collapsed",!!collapsed);localStorage.setItem(SIDEBAR_KEY,collapsed?"1":"0");const btn=$("#toggleSidebarBtn");if(btn)btn.textContent=collapsed?"Show Sidebar":"Hide Sidebar";}
function setFiltersCollapsed(collapsed){$("#filtersCard")?.classList.toggle("collapsed",!!collapsed);localStorage.setItem(FILTERS_KEY,collapsed?"1":"0");const btn=$("#toggleFiltersBtn");if(btn)btn.textContent=collapsed?"Show Filters":"Hide Filters";}
function restoreUiPrefs(){setTheme(localStorage.getItem(THEME_KEY)||"light");setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY)==="1");setFiltersCollapsed(localStorage.getItem(FILTERS_KEY)==="1");}
restoreUiPrefs();
$("#toggleThemeBtn").onclick=()=>setTheme(document.body.dataset.theme==="dark"?"light":"dark");
$("#toggleSidebarBtn").onclick=()=>setSidebarCollapsed(!appRoot?.classList.contains("sidebar-collapsed"));
$("#toggleFiltersBtn").onclick=()=>setFiltersCollapsed(!$("#filtersCard")?.classList.contains("collapsed"));

function setLoading(open,text="Preparing…"){$("#loader").classList.toggle("open",open);$("#loaderText").textContent=text;}
function openModal(id){$(id).classList.add("open");}
function closeModal(el){el.closest(".modal")?.classList.remove("open");}
$$('[data-close]').forEach(b=>b.onclick=()=>closeModal(b));
$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open');}));

function syncFilterState(){if(!engine)return;ecomEngine?.setFilters(engine.filters);engine.setFilters(engine.filters);}
function refreshFilterOptions(changed){if(!engine)return;for(const key of Object.keys(controls)){if(key===changed)continue;controls[key].setOptions(engine.optionValues(key));}controls[changed]?.setOptions(engine.optionValues(changed));}
function resetFilters(){
  if(!engine)return;
  const f=defaultFilters();f.requiredDOS=CONFIG.defaultRequiredDOS;f.requiredEcomStock=CONFIG.defaultRequiredEcomStock;engine.setFilters(f);if(ecomEngine)ecomEngine.setFilters(f);
  for(const c of Object.values(controls))c.setSelected(new Set());
  $("#dosSelect").value=String(CONFIG.defaultRequiredDOS);$("#dosCustom").hidden=true;
  $("#ecomStockSelect").value=String(CONFIG.defaultRequiredEcomStock);$("#ecomStockCustom").hidden=true;
  detailPage=1;refreshFilterOptions();render();toast("Filters reset","success");
}
$("#resetBtn").onclick=resetFilters;
$("#dosSelect").onchange=e=>{if(!engine)return;const custom=e.target.value==="custom";$("#dosCustom").hidden=!custom;if(custom){$("#dosCustom").focus();return;}engine.filters.requiredDOS=Number(e.target.value);syncFilterState();detailPage=1;refreshFilterOptions();render();};
$("#dosCustom").onchange=e=>{if(!engine)return;const v=Number(e.target.value);if(!(v>0)){toast("Required DOS must be greater than zero","error");return;}engine.filters.requiredDOS=v;syncFilterState();detailPage=1;refreshFilterOptions();render();};
$("#ecomStockSelect").onchange=e=>{if(!engine)return;const custom=e.target.value==="custom";$("#ecomStockCustom").hidden=!custom;if(custom){$("#ecomStockCustom").focus();return;}engine.filters.requiredEcomStock=Number(e.target.value);syncFilterState();detailPage=1;refreshFilterOptions();render();};
$("#ecomStockCustom").onchange=e=>{if(!engine)return;const v=Number(e.target.value);if(!(v>=0)){toast("Required Ecom Stock must be zero or greater","error");return;}engine.filters.requiredEcomStock=v;syncFilterState();detailPage=1;refreshFilterOptions();render();};

$$('#nav button[data-page]').forEach(b=>b.onclick=()=>{currentPage=b.dataset.page;detailPage=1;$$('#nav button').forEach(x=>x.classList.toggle('active',x===b));render();});

async function applyLoaded(loadedModel,label){
  setLoading(true,"Preparing Core/KVI/Promo and Ecom assortment universes…");await new Promise(r=>setTimeout(r,20));
  model=loadedModel;engine=new Engine(model);ecomEngine=model.ecom?new Engine(model.ecom):null;
  const f=defaultFilters();f.requiredDOS=CONFIG.defaultRequiredDOS;f.requiredEcomStock=CONFIG.defaultRequiredEcomStock;engine.setFilters(f);if(ecomEngine)ecomEngine.setFilters(f);
  refreshFilterOptions();$("#xlsxBtn").disabled=false;$("#pdfBtn").disabled=false;$("#resetBtn").disabled=false;
  const ecomText=model.ecom?` · Ecom ${fmt.n(model.ecom.outletCount)} outlets × ${fmt.n(model.ecom.skuCount)} scored SKUs`:"";
  $("#dataStatus").textContent=`${label} · ${fmt.n(model.outletCount)} outlets · ${fmt.n(model.skuCount)} Core/KVI/Promo SKUs${ecomText}`;
  setLoading(false);render();toast("Data loaded and universes built","success");
}
async function runLoad(fn,label){try{setLoading(true,"Starting…");const data=await fn(t=>setLoading(true,t));await applyLoaded(data,label);}catch(e){console.error(e);setLoading(false);toast(e.message||String(e),"error");$("#dataStatus").textContent="Failed to load processed dashboard data — see console";}}

function render(){
  closeKpiPopover();
  const host=$("#view");if(!engine){host.innerHTML=renderEmpty();return;}
  if(currentPage==="summary")host.innerHTML=renderSummary(engine,ecomEngine,model);
  else if(currentPage==="availability")host.innerHTML=renderAvailability(engine,detailPage,CONFIG.pageSize);
  else if(currentPage==="outlet")host.innerHTML=renderOutletView(engine);
  else if(currentPage==="sku")host.innerHTML=renderSkuView(engine);
  else if(currentPage==="ecomSku")host.innerHTML=renderEcomSkuView(ecomEngine,model);
  else if(currentPage==="core")host.innerHTML=renderClass(engine,"core","Core");
  else if(currentPage==="kvi")host.innerHTML=renderClass(engine,"kvi","KVI");
  else if(currentPage==="promo")host.innerHTML=renderClass(engine,"promo","Promo");
  else if(currentPage==="division")host.innerHTML=renderDivisionView(engine);
  else if(currentPage==="cat3")host.innerHTML=renderCat3View(engine);
  else if(currentPage==="rho")host.innerHTML=renderRhoView(engine);
  else if(currentPage==="zonal")host.innerHTML=renderZonalView(engine);
  else if(currentPage==="lossTree")host.innerHTML=renderLossTree(engine);
  else if(currentPage==="exceptions")host.innerHTML=renderExceptions(engine);
  else if(currentPage==="health")host.innerHTML=renderHealth(model);
  activateTables(host);
  bindViewEvents();
}
function bindViewEvents(){
  $$('[data-page]',$("#view")).forEach(b=>b.onclick=()=>{detailPage=Number(b.dataset.page)||1;render();});
  $$('.drill-outlet',$("#view")).forEach(b=>b.onclick=()=>showDrill('outlet',b.dataset.code));
  $$('.drill-sku',$("#view")).forEach(b=>b.onclick=()=>showDrill('sku',b.dataset.code));
  $$('.drill-ecom-sku',$("#view")).forEach(b=>b.onclick=()=>showEcomSkuDrill(b.dataset.code));
  $$('.ecom-outlet-drill',$("#view")).forEach(b=>b.onclick=()=>showEcomOutletDrill(b.dataset.code));
  $$('.tab-btn',$("#view")).forEach(b=>b.onclick=()=>{
    const group=b.dataset.tab,strip=b.closest('[data-tabgroup]'),name=strip?.dataset.tabgroup;if(!name)return;
    $$('.tab-btn',strip).forEach(x=>x.classList.toggle('active',x===b));
    $$(`[data-tabpanel^="${name}:"]`,$("#view")).forEach(p=>{p.hidden=p.dataset.tabpanel!==`${name}:${group}`;});
  });
  $$('tr[data-drill-code]',$("#view")).forEach(tr=>{
    tr.classList.add('row-clickable');
    tr.onclick=e=>{
      if(e.target.closest('button,a'))return; // already has its own handler
      const kind=tr.dataset.drillKind,code=tr.dataset.drillCode;if(!kind||!code)return;
      if(kind==='ecom-sku')showEcomSkuDrill(code);
      else if(kind==='ecom-outlet')showEcomOutletDrill(code);
      else showDrill(kind,code);
    };
  });
  $$('.kpi-value-btn',$("#view")).forEach(b=>b.onclick=e=>{e.stopPropagation();showKpiBreakdown(b);});
}
let openKpiPopover=null;
function closeKpiPopover(){openKpiPopover?.remove();openKpiPopover=null;document.removeEventListener('click',onDocClickCloseKpi);document.removeEventListener('keydown',onEscCloseKpi);}
function onDocClickCloseKpi(e){if(openKpiPopover&&!openKpiPopover.contains(e.target))closeKpiPopover();}
function onEscCloseKpi(e){if(e.key==='Escape')closeKpiPopover();}
function showKpiBreakdown(btn){
  closeKpiPopover();
  let data;try{data=JSON.parse(btn.dataset.kpiBreakdown);}catch{return;}
  const pop=document.createElement('div');pop.className='kpi-popover';
  pop.innerHTML=`<b>${esc(data.title||'Breakdown')}</b>${data.sub?`<small>${esc(data.sub)}</small>`:''}<div class="kpi-popover-rows">${(data.rows||[]).map(r=>`<div><span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`).join('')||'<div class="empty-mini">No data</div>'}</div>`;
  document.body.appendChild(pop);
  const rect=btn.getBoundingClientRect(),popRect=pop.getBoundingClientRect();
  let left=rect.left+window.scrollX,top=rect.bottom+window.scrollY+6;
  if(left+popRect.width>window.scrollX+document.documentElement.clientWidth-10)left=window.scrollX+document.documentElement.clientWidth-popRect.width-10;
  pop.style.left=`${Math.max(10,left)}px`;pop.style.top=`${top}px`;
  openKpiPopover=pop;
  setTimeout(()=>{document.addEventListener('click',onDocClickCloseKpi);document.addEventListener('keydown',onEscCloseKpi);},0);
}
function showDrill(kind,code){
  if(!engine)return;
  const obj=kind==='outlet'?model.outlets.find(o=>o.code===code):model.skus.find(s=>s.code===code);
  $("#drillTitle").textContent=kind==='outlet'?`Outlet ${code} · ${obj?.name||''}`:`SKU ${code} · ${obj?.name||''}`;
  const outletBand=kind==='outlet'?engine.outletBandDistribution().outlets.find(g=>g.id===code)?.band:null;
  const skuBand=kind==='sku'?engine.skuBandDistribution().skus.find(g=>g.id===code)?.band:null;
  const d=kind==='outlet'?engine.drillOutlet(code):engine.drillSku(code),s=d.summary;
  $("#drillBody").innerHTML=`<div class="kpi-grid">${kpi("Availability",fmt.pct(s.availability),`${fmt.n(s.available)} / ${fmt.n(s.total)}`,"primary")}${outletBand?kpi("Outlet Marking",outletBand.label,"Filtered availability band"):""}${skuBand?kpi("SKU Marking",skuBand.label,"Filtered availability band"):""}${kpi("Unavailable",fmt.n(s.unavailable),"Required slots","danger")}${kpi("Shortfall",fmt.n(s.shortfall,1),"Units","warn")}${kpi("OOS",fmt.n(s.status.OOS),"")}${kpi("No Sales",fmt.n(s.status["No Sales"]),"")}</div><section class="card"><div class="card-title"><h3>Top exceptions</h3><span>Current filters + this drill-down</span></div>${table(["Outlet","SKU","Class","Stock","Sales 30D","DOS","Shortfall","Status"],d.exceptions.map(x=>`<tr><td>${esc(x.outlet.code)} · ${esc(x.outlet.name)}</td><td>${esc(x.sku.code)} · ${esc(x.sku.name)}</td><td>${classBadges(x.sku)}</td><td>${fmt.n(x.stock,2)}</td><td>${fmt.n(x.salesQty,2)}</td><td>${fmt.dos(x.dos)}</td><td>${fmt.n(x.shortfall,2)}</td><td>${statusBadge(x.status)}</td></tr>`))}</section><div class="actions"><button class="btn primary" id="applyDrill">Apply ${kind==='outlet'?'Outlet':'SKU'} Filter</button></div>`;
  $("#applyDrill").onclick=()=>{const key=kind==='outlet'?'outlet':'sku';engine.filters[key]=new Set([code]);syncFilterState();controls[key].setSelected(new Set([code]));refreshFilterOptions(key);currentPage=kind==='outlet'?'outlet':'sku';$$('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===currentPage));$("#drillModal").classList.remove('open');render();};
  activateTables($("#drillBody"));
  openModal("#drillModal");
}
function showEcomSkuDrill(code){
  if(!ecomEngine)return;
  const obj=model.ecom.skus.find(s=>s.code===code),d=ecomEngine.drillSku(code),s=d.summary,band=ecomEngine.skuBandDistribution().skus.find(g=>g.id===code)?.band;
  $("#drillTitle").textContent=`Ecom SKU ${code} · ${obj?.name||''}`;
  $("#drillBody").innerHTML=`<div class="kpi-grid">${kpi("Ecom Availability",fmt.pct(s.availability),`${fmt.n(s.available)} / ${fmt.n(s.total)}`,"primary")}${band?kpi("SKU Marking",band.label,"Across selected Ecom outlets"):""}${kpi("Unavailable Outlets",fmt.n(s.unavailable),"Ecom outlets","danger")}${kpi("Shortfall",fmt.n(s.shortfall,1),"Units below threshold","warn")}${kpi("Sufficient Stock",fmt.n(s.status["Sufficient Stock"]),"")}${kpi("Below Threshold",fmt.n(s.status["Below Threshold"]),"")}</div><section class="card"><div class="card-title"><h3>Ecom outlet exceptions</h3></div>${table(["Outlet","Stock","Sales 30D","DOS","Shortfall","Status"],d.exceptions.map(x=>`<tr><td>${esc(x.outlet.code)} · ${esc(x.outlet.name)}</td><td>${fmt.n(x.stock,2)}</td><td>${fmt.n(x.salesQty,2)}</td><td>${fmt.dos(x.dos)}</td><td>${fmt.n(x.shortfall,2)}</td><td>${statusBadge(x.status)}</td></tr>`))}</section><div class="actions"><button class="btn primary" id="applyEcomDrill">Apply SKU Filter</button></div>`;
  $("#applyEcomDrill").onclick=()=>{engine.filters.sku=new Set([code]);syncFilterState();controls.sku.setSelected(new Set([code]));refreshFilterOptions('sku');currentPage='ecomSku';$$('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.page==='ecomSku'));$("#drillModal").classList.remove('open');render();};
  activateTables($("#drillBody"));
  openModal("#drillModal");
}
function showEcomOutletDrill(code){
  if(!ecomEngine)return;
  const obj=model.ecom.outlets.find(o=>o.code===code),d=ecomEngine.drillOutlet(code),s=d.summary,band=ecomEngine.outletBandDistribution().outlets.find(g=>g.id===code)?.band;
  $("#drillTitle").textContent=`Ecom Outlet ${code} · ${obj?.name||''}`;
  $("#drillBody").innerHTML=`<div class="kpi-grid">${kpi("Ecom Availability",fmt.pct(s.availability),`${fmt.n(s.available)} / ${fmt.n(s.total)}`,"primary")}${band?kpi("Outlet Marking",band.label,"Across selected Ecom SKUs"):""}${kpi("Unavailable SKUs",fmt.n(s.unavailable),"Scored Ecom SKUs","danger")}${kpi("Shortfall",fmt.n(s.shortfall,1),"Units below threshold","warn")}${kpi("Sufficient Stock",fmt.n(s.status["Sufficient Stock"]),"")}${kpi("Below Threshold",fmt.n(s.status["Below Threshold"]),"")}</div><section class="card"><div class="card-title"><h3>Ecom SKU exceptions</h3></div>${table(["SKU","Stock","Sales 30D","DOS","Shortfall","Status"],d.exceptions.map(x=>`<tr><td>${esc(x.sku.code)} · ${esc(x.sku.name)}</td><td>${fmt.n(x.stock,2)}</td><td>${fmt.n(x.salesQty,2)}</td><td>${fmt.dos(x.dos)}</td><td>${fmt.n(x.shortfall,2)}</td><td>${statusBadge(x.status)}</td></tr>`))}</section><div class="actions"><button class="btn primary" id="applyEcomOutletDrill">Apply Outlet Filter</button></div>`;
  $("#applyEcomOutletDrill").onclick=()=>{engine.filters.outlet=new Set([code]);syncFilterState();controls.outlet.setSelected(new Set([code]));refreshFilterOptions('outlet');currentPage='ecomSku';$$('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.page==='ecomSku'));$("#drillModal").classList.remove('open');render();};
  activateTables($("#drillBody"));
  openModal("#drillModal");
}

function safeCsv(v){let s=String(v??"");if(/^[=+\-@]/.test(s))s="'"+s;return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function outletBandMap(targetEngine=engine){return new Map(targetEngine.outletBandDistribution().outlets.map(g=>[g.id,g.band.label]));}
function detailHeader(){return["Outlet Code","Outlet Name","Outlet Availability Band","Zone","RHO","Zonal","Geo Division","District","Store Type","Location Type","Outlet Type","Ecom Outlet","SKU Code","SKU Name","Product Division","CAT3","Core","KVI","Promo","Stock Qty","30-Day Sales Qty","ADS","DOS","Required DOS","Required Stock","Shortfall","Stock Status","Availability","Stock Record Present","Sales Record Present"];}
function detailArray(x,bands=null,targetEngine=engine){return[x.outlet.code,x.outlet.name,bands?.get(x.outlet.code)||"",x.outlet.zone,x.outlet.rho,x.outlet.zonal,x.outlet.division,x.outlet.district,x.outlet.storeType,x.outlet.locationType,x.outlet.kvi?"KVI":"Non-KVI",x.outlet.ecom?"Y":"N",x.sku.code,x.sku.name,x.sku.category,x.sku.category3,x.sku.core?"Y":"N",x.sku.kvi?"Y":"N",x.sku.promo?"Y":"N",x.stock,x.salesQty,x.ads,x.dos===null?"N/A":x.dos,targetEngine.filters.requiredDOS,x.requiredStock,x.shortfall,x.status,x.available?"Available":"Unavailable",x.stockPresent?"Y":"N",x.salesPresent?"Y":"N"];}
$("#xlsxBtn").onclick=()=>{
  if(!engine)return;setLoading(true,"Preparing filtered Excel workbook…");setTimeout(()=>{try{
    const s=engine.summary(),classes=engine.classificationSummaries(),summaryRows=[["Core · KVI · Promo Availability Tracker"],["Required DOS",engine.filters.requiredDOS],["Filtered Slots",s.total],["Available",s.available],["Overall Availability %",s.availability],["Core Availability %",classes.core.availability],["KVI Availability %",classes.kvi.availability],["Promo Availability %",classes.promo.availability],["Required Shortfall",s.shortfall],["OOS",s.status.OOS],["Low",s.status.Low],["At Risk",s.status["At Risk"]],["Healthy",s.status.Healthy],["No Sales",s.status["No Sales"]]];
    if(ecomEngine){const es=ecomEngine.summary();summaryRows.push(["Required Ecom Stock",engine.filters.requiredEcomStock],["Ecom Availability %",es.availability],["Ecom Scored Slots",es.total],["Ecom Covered SKUs",model.ecom.skuCount],["Ecom Listed SKUs",model.ecom.listedSkuCount],["Ecom Data Not Covered SKUs",model.ecom.health.uncoveredSkus],["Ecom Sufficient Stock Slots",es.status["Sufficient Stock"]],["Ecom Below Threshold Slots",es.status["Below Threshold"]]);}
    const bandData=engine.outletBandDistribution(),skuBandData=engine.skuBandDistribution();
    const outletRows=[["Outlet","Outlet Name","Zone","Outlet Availability Band","Availability %","Available","Unavailable","OOS","Low","At Risk","No Sales","Shortfall"],...bandData.outlets.map(g=>[g.id,g.meta.name,g.meta.zone,g.band.label,g.availability,g.available,g.unavailable,g.OOS,g.Low,g["At Risk"],g["No Sales"],g.shortfall])];
    for(const b of bandData.bands)summaryRows.push([`Outlet Band ${b.label}`,b.count]);for(const b of skuBandData.bands)summaryRows.push([`SKU Band ${b.label}`,b.count]);
    const skuRows=[["SKU","SKU Name","Product Division","CAT3","Core","KVI","Promo","SKU Availability Band","Availability %","Outlet Count","Available Count","Unavailable Count","OOS","Low","At Risk","No Sales","Shortfall"],...engine.skuUnavailability().map(g=>[g.id,g.meta.name,g.meta.category,g.meta.category3,g.meta.core?"Y":"N",g.meta.kvi?"Y":"N",g.meta.promo?"Y":"N",g.band.label,g.availability,g.total,g.available,g.unavailable,g.OOS,g.Low,g["At Risk"],g["No Sales"],g.shortfall])];
    const hierarchyRows=level=>{const label=level==="category3"?"CAT3":"Product Division";return [[label,"SKU Count","Outlet Count","Availability %","Available","Unavailable","91%-100% Outlet Count","81%-90% Outlet Count","71%-80% Outlet Count","61%-70% Outlet Count","Below 60% Outlet Count","Shortfall"],...engine.productHierarchySummary(level).map(g=>[g.label,g.skuCount,g.outletCount,g.availability,g.available,g.unavailable,g.bandCounts["91-100"],g.bandCounts["81-90"],g.bandCounts["71-80"],g.bandCounts["61-70"],g.bandCounts["below-60"],g.shortfall])];};
    const sheets={Summary:summaryRows,"Outlet Summary":outletRows,"SKU Unavailability":skuRows,"Division Summary":hierarchyRows("category"),"CAT3 Summary":hierarchyRows("category3")};
    if(ecomEngine){const eb=ecomEngine.skuUnavailability();sheets["Ecom SKU Availability"]=[["SKU","SKU Name","FM","Availability Band","Availability %","Ecom Outlet Count","Available","Unavailable","Sufficient Stock","Below Threshold","Shortfall"],...eb.map(g=>[g.id,g.meta.name,g.meta.fm?"FM":"",g.band.label,g.availability,g.total,g.available,g.unavailable,g["Sufficient Stock"],g["Below Threshold"],g.shortfall])];sheets["Ecom Coverage"]=[["Metric","Value"],["Required Ecom Stock",engine.filters.requiredEcomStock],["Listed Ecom SKUs",model.ecom.listedSkuCount],["Availability-covered Ecom SKUs",model.ecom.skuCount],["Data-not-covered Ecom SKUs",model.ecom.health.uncoveredSkus],["Ecom outlets",model.ecom.outletCount],["FM SKUs",model.ecom.health.fmSkus],["Covered FM SKUs",model.ecom.health.coveredFmSkus]];}
    const detail=[detailHeader()],detailBands=new Map(bandData.outlets.map(g=>[g.id,g.band.label]));let count=0,total=0;for(const x of engine.slots()){total++;if(count<CONFIG.excelDetailRowCap){detail.push(detailArray(x,detailBands,engine));count++;}}if(total>count)summaryRows.push(["Excel Detail Truncation",`${count.toLocaleString()} of ${total.toLocaleString()} filtered detail rows included. Use CSV for all rows.`]);sheets.Detail=detail;
    downloadBlob(makeXlsx(sheets),`availability-filtered-${new Date().toISOString().slice(0,10)}.xlsx`);toast(`Excel exported with ${fmt.n(count)} detail rows`,"success");
  }catch(e){console.error(e);toast(e.message||String(e),"error");}finally{setLoading(false);}},20);
};

$("#pdfBtn").onclick=async()=>{
  if(!engine)return;
  setLoading(true,"Preparing summary PDF…");
  try{
    await downloadSummaryPdf(engine,ecomEngine,model);
    toast("PDF summary downloaded","success");
  }catch(e){
    console.error(e);
    toast(e.message||"Failed to generate PDF — check your internet connection","error");
  }finally{
    setLoading(false);
  }
};

render();
runLoad(loadProcessed,"Google Drive (build)");
