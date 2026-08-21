/* Availability Dashboard — core analytics and rendering.
 * filters-v2.js loads after this file and replaces the filter layer, the view
 * switcher and the combined report. Everything it overrides is declared here as
 * a top-level function so the override is a plain reassignment. */

const fmtInt = new Intl.NumberFormat('en-US');
const fmtQty = new Intl.NumberFormat('en-US',{maximumFractionDigits:1});
const pct = v => Number.isFinite(Number(v)) ? `${(Number(v)*100).toFixed(2)}%` : '—';
const pct1 = v => Number.isFinite(Number(v)) ? `${(Number(v)*100).toFixed(1)}%` : '—';
const esc = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const dt = s => { if(!s) return '—'; const d=new Date(s); return isNaN(d)?s:d.toLocaleString('en-GB',{timeZone:'Asia/Dhaka',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); };

let DATA=null;
let DOS_DAYS=1;
let VIEW_MODE=localStorage.getItem('availabilityViewMode')==='outlet'?'outlet':'sku';
const RISK_DAY_CACHE=new Map();
const STOCK_BITS_CACHE=new Map();
const COVERAGE_CACHE=new Map();
let RISK_OUTLET_LEADERS=null;
let REPORTING_OUTLET_META=null;
let ZONE_PRESENT=false;

const SORT_STATE={
  riskTable:{key:'dos_pct',dir:'asc',type:'number'},
  zoneTable:{key:'dos_pct',dir:'asc',type:'number'},
  skuDetailTable:{key:'dos_pct',dir:'asc',type:'number'},
  outletDetailTable:{key:'dos_pct',dir:'asc',type:'number'},
  comboDetailTable:{key:'dos_pct',dir:'asc',type:'number'}
};

const TABLE_STATE={
  riskTable:{searchId:'riskTableSearch',rowsId:'riskTableRows',countId:'riskTableResultCount',pagerId:'riskTablePager',page:1},
  zoneTable:{searchId:'zoneTableSearch',rowsId:'zoneTableRows',countId:'zoneTableResultCount',pagerId:'zoneTablePager',page:1},
  skuDetailTable:{searchId:'skuTableSearch',rowsId:'skuTableRows',countId:'skuTableResultCount',pagerId:'skuTablePager',page:1},
  outletDetailTable:{searchId:'outletTableSearch',rowsId:'outletTableRows',countId:'outletTableResultCount',pagerId:'outletTablePager',page:1}
};

/* ------------------------------------------------------------------ *
 * Severity tiers
 * The five filter bands collapse onto four action tiers. Tier colour is
 * always paired with the band text, so colour never carries meaning alone.
 * ------------------------------------------------------------------ */
const TIERS={
  ge90:{cls:'good',label:'On target'},
  '80-90':{cls:'warn',label:'Watch'},
  '70-80':{cls:'risk',label:'At risk'},
  '60-70':{cls:'crit',label:'Critical'},
  lt60:{cls:'crit',label:'Critical'}
};
function bandKey(v){v=Number(v); if(v>=.9)return'ge90'; if(v>=.8)return'80-90'; if(v>=.7)return'70-80'; if(v>=.6)return'60-70'; return'lt60'}
function tierOf(v){return TIERS[bandKey(v)]}
// Kept under the original name: several call sites read it as a CSS class.
function pctClass(v){const c=tierOf(v).cls;return c==='crit'?'bad':c}
function tierTitle(v){return `${tierOf(v).label} · ${bandLabel(bandKey(v))}`}
function typeClass(t){const n=String(t||'').toLowerCase();return n==='core'?'core':n==='promo'?'promo':n==='kvi'?'kvi':'unknown'}

/* ------------------------------------------------------------------ *
 * Table-only click filters. Sidebar filters drive the whole view; clicking a
 * KPI card or band adds a separate, clearly labelled table-only layer.
 * ------------------------------------------------------------------ */
const TABLE_CLICK_FILTERS={
  sku:{type:'all',stockBand:'all',dosBand:'all',threshold:'all'},
  outlet:{stockBand:'all',dosBand:'all',threshold:'all'}
};
function loadTableClickFilters(){
  try{
    const saved=JSON.parse(sessionStorage.getItem('availabilityTableClickFilters')||'{}');
    ['sku','outlet'].forEach(v=>Object.assign(TABLE_CLICK_FILTERS[v],saved?.[v]||{}));
  }catch(_){/* ignore malformed old state */}
}
function saveTableClickFilters(){try{sessionStorage.setItem('availabilityTableClickFilters',JSON.stringify(TABLE_CLICK_FILTERS))}catch(_){/* private mode */}}
function clearTableClickFilters(view){
  if(view==='sku')Object.assign(TABLE_CLICK_FILTERS.sku,{type:'all',stockBand:'all',dosBand:'all',threshold:'all'});
  else Object.assign(TABLE_CLICK_FILTERS.outlet,{stockBand:'all',dosBand:'all',threshold:'all'});
  saveTableClickFilters();resetViewTablePages(view);render();
}
function clearOneTableClickFilter(view,key){
  if(TABLE_CLICK_FILTERS?.[view] && key in TABLE_CLICK_FILTERS[view])TABLE_CLICK_FILTERS[view][key]='all';
  saveTableClickFilters();resetViewTablePages(view);render();
}
function applySkuTableClickFilters(rows){
  const f=TABLE_CLICK_FILTERS.sku;
  return rows.filter(r=>{
    if(f.type!=='all'&&String(r.type||'')!==f.type)return false;
    if(f.stockBand!=='all'&&bandKey(Number(r.availability)||0)!==f.stockBand)return false;
    const dp=skuDosPct(r);
    if(f.dosBand!=='all'&&bandKey(dp)!==f.dosBand)return false;
    if(f.threshold==='lt80'&&!(dp<.8))return false;
    if(f.threshold==='lt70'&&!(dp<.7))return false;
    if(f.threshold==='lt60'&&!(dp<.6))return false;
    return true;
  });
}
function applyOutletTableClickFilters(rows){
  const f=TABLE_CLICK_FILTERS.outlet;
  return rows.filter(r=>{
    if(f.stockBand!=='all'&&bandKey(Number(r.availability)||0)!==f.stockBand)return false;
    const dp=outletDosPct(r);
    if(f.dosBand!=='all'&&bandKey(dp)!==f.dosBand)return false;
    if(f.threshold==='lt80'&&!(dp<.8))return false;
    if(f.threshold==='lt70'&&!(dp<.7))return false;
    if(f.threshold==='lt60'&&!(dp<.6))return false;
    return true;
  });
}
function thresholdLabel(t){return t==='lt80'?'Below 80% DOS':t==='lt70'?'Below 70% DOS':'Below 60% DOS'}
function tableFilterChip(label,view,key){return `<button class="filter-chip removable table-filter-chip" type="button" data-clear-table-filter="${view}:${key}" title="Remove this card filter"><span>${esc(label)}</span><b aria-hidden="true">×</b></button>`}
function renderTableClickFilterUI(){
  const sku=[],sf=TABLE_CLICK_FILTERS.sku;
  if(sf.type!=='all')sku.push(tableFilterChip(`Type: ${sf.type}`,'sku','type'));
  if(sf.stockBand!=='all')sku.push(tableFilterChip(`Stock: ${bandLabel(sf.stockBand)}`,'sku','stockBand'));
  if(sf.dosBand!=='all')sku.push(tableFilterChip(`DOS: ${bandLabel(sf.dosBand)}`,'sku','dosBand'));
  if(sf.threshold!=='all')sku.push(tableFilterChip(thresholdLabel(sf.threshold),'sku','threshold'));
  const se=document.getElementById('skuTableClickFilters');
  if(se)se.innerHTML=sku.length?sku.join(''):'<span class="table-filter-empty">None — click any card above to filter this table</span>';
  const outlet=[],of=TABLE_CLICK_FILTERS.outlet;
  if(of.stockBand!=='all')outlet.push(tableFilterChip(`Stock: ${bandLabel(of.stockBand)}`,'outlet','stockBand'));
  if(of.dosBand!=='all')outlet.push(tableFilterChip(`DOS: ${bandLabel(of.dosBand)}`,'outlet','dosBand'));
  if(of.threshold!=='all')outlet.push(tableFilterChip(thresholdLabel(of.threshold),'outlet','threshold'));
  const oe=document.getElementById('outletTableClickFilters');
  if(oe)oe.innerHTML=outlet.length?outlet.join(''):'<span class="table-filter-empty">None — click any card or band above to filter this table</span>';
}

/* ------------------------------------------------------------------ *
 * DOS maths
 * ------------------------------------------------------------------ */
function dosIndex(){const a=DATA?.dos?.supported_days||[]; const i=a.indexOf(Number(DOS_DAYS)); return i>=0?i:0}
function curveValue(r){
  const direct=Number(r?._dos_value); if(Number.isFinite(direct))return direct;
  const c=r?.dos_curve||[]; const v=Number(c[dosIndex()]); return Number.isFinite(v)?v:0;
}
function outletDosPct(r){const a=Number(r?.assortment)||0; return a?curveValue(r)/a:0}
function skuLeaderSelection(){return document.getElementById('skuLeaderFilter')?.value||'all'}
function skuKviSelection(){return document.getElementById('skuKviFilter')?.value||'all'}
function skuOutletSelection(){return document.getElementById('skuOutletFilter')?.value||'all'}
function decodeBytePayload(encoded,cache){
  if(!encoded)return null;if(cache.has(encoded))return cache.get(encoded);
  try{const raw=atob(encoded),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);cache.set(encoded,out);return out}catch(_){return null}
}
function stockBits(r){return decodeBytePayload(r?.stock_bits_b64||'',STOCK_BITS_CACHE)}
function coverageDays(r){
  const encoded=r?.coverage_days_f32_b64||'';if(!encoded)return null;if(COVERAGE_CACHE.has(encoded))return COVERAGE_CACHE.get(encoded);
  try{const raw=atob(encoded),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const dv=new DataView(bytes.buffer),out=new Float32Array(Math.floor(raw.length/4));for(let i=0;i<out.length;i++)out[i]=dv.getFloat32(i*4,true);COVERAGE_CACHE.set(encoded,out);return out}catch(_){return null}
}
function reportingOutletMeta(){
  if(REPORTING_OUTLET_META)return REPORTING_OUTLET_META;
  const codes=DATA?.detail_info?.reporting_outlet_codes||[];
  const byCode=new Map((DATA?.outlets||[]).map(r=>[String(r.outlet_code||'').trim(),r]));
  REPORTING_OUTLET_META=codes.map((code,index)=>{const key=String(code||'').trim(),r=byCode.get(key)||{};return {index,code:key,name:String(r.outlet_name||key),leader:String(r.leader||'Unassigned'),kvi:norm(r.kvi)==='yes'?'yes':'no'};});
  return REPORTING_OUTLET_META;
}
function skuScopeOutletIndexes(){
  const leader=skuLeaderSelection(),kvi=skuKviSelection(),outlet=skuOutletSelection();
  return reportingOutletMeta().filter(m=>{
    if(outlet!=='all'&&m.code!==outlet)return false;
    if(leader!=='all'&&m.leader!==leader)return false;
    if(kvi!=='all'&&m.kvi!==kvi)return false;
    return true;
  }).map(m=>m.index);
}
function coverageScore(cov){const d=Math.max(1,Number(DOS_DAYS)||1);return cov>=d?1:cov/d}
function effectiveSkuRow(r){
  const leader=skuLeaderSelection(),kvi=skuKviSelection(),outlet=skuOutletSelection();
  if(leader==='all'&&kvi==='all'&&outlet==='all')return r;
  const indexes=skuScopeOutletIndexes(),bits=stockBits(r),coverage=coverageDays(r);
  if(bits&&coverage){
    let available=0,dos=0;
    indexes.forEach(i=>{available+=(bits[i>>3]>>(i&7))&1;const c=Number(coverage[i]);dos+=Number.isFinite(c)?coverageScore(c):0;});
    const total=indexes.length;
    return {...r,available_outlets:available,total_outlets:total,availability:total?available/total:0,_dos_value:dos,_scope_outlet_indexes:indexes};
  }
  return {...r,available_outlets:0,total_outlets:indexes.length,availability:0,_dos_value:0,_scope_outlet_indexes:indexes};
}
function skuDosPct(r){const a=Number(r?.total_outlets)||0; return a?curveValue(r)/a:0}
function skuDosGap(r){return Math.max(0,(Number(r?.total_outlets)||0)-curveValue(r))}
function dynamicLabel(){return `${DOS_DAYS}-day DOS`}
function norm(v){return String(v??'').toLowerCase().trim()}
function bandLabel(v){return ({ge90:'90% & above','80-90':'80%–<90%','70-80':'70%–<80%','60-70':'60%–<70%',lt60:'Below 60%'})[v]||v}
function uniqueSkuCount(rows){return new Set(rows.map(r=>String(r.sku_code??''))).size}

function riskDays(r){
  const encoded=r?.risk_days_b64||''; if(!encoded)return null;
  if(RISK_DAY_CACHE.has(encoded))return RISK_DAY_CACHE.get(encoded);
  try{const raw=atob(encoded),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);RISK_DAY_CACHE.set(encoded,out);return out}catch(_){return null}
}
function riskOutletLeaders(){
  if(RISK_OUTLET_LEADERS)return RISK_OUTLET_LEADERS;
  const codes=DATA?.detail_info?.reporting_outlet_codes||[];
  const leaderByCode=new Map((DATA?.outlets||[]).map(r=>[String(r.outlet_code||'').trim(),String(r.leader||'Unassigned')]));
  RISK_OUTLET_LEADERS=codes.map(c=>leaderByCode.get(String(c||'').trim())||'Unassigned');
  return RISK_OUTLET_LEADERS;
}
function affectedOutletIndexes(r){
  const days=riskDays(r);if(!days)return [];
  const limit=Number(DOS_DAYS)||1,out=[],scope=skuScopeOutletIndexes();
  for(const i of scope){const first=days[i];if(first>0&&first<=limit)out.push(i)}
  return out;
}
function skuAffectedOutletCount(r){const days=riskDays(r);return days?affectedOutletIndexes(r).length:Math.max(0,Math.ceil(skuDosGap(r)))}
function skuScopeOutletStats(rows){
  const scope=skuScopeOutletIndexes();
  const empty={total:scope.length,ge90:0,'80-90':0,'70-80':0,'60-70':0,lt60:0,below80:0,below70:0,below60:0};
  if(!scope.length||!rows.length)return empty;
  const payloadReady=rows.every(r=>stockBits(r)&&coverageDays(r));
  if(!payloadReady){
    const scopeSet=new Set(scope),meta=reportingOutletMeta(),outByCode=new Map((DATA?.outlets||[]).map(r=>[String(r.outlet_code||'').trim(),r]));
    const bands={...empty};
    meta.forEach(m=>{if(!scopeSet.has(m.index))return;const r=outByCode.get(m.code);if(!r)return;bands[bandKey(outletDosPct(r))]++});
    bands.below80=bands['70-80']+bands['60-70']+bands.lt60;bands.below70=bands['60-70']+bands.lt60;bands.below60=bands.lt60;return bands;
  }
  const bands={...empty};
  for(const idx of scope){
    let dos=0,opps=0;
    for(const r of rows){const coverage=coverageDays(r);const c=Number(coverage[idx]);if(!Number.isFinite(c))continue;dos+=coverageScore(c);opps++;}
    const dp=opps?dos/opps:0;bands[bandKey(dp)]++;
  }
  bands.below80=bands['70-80']+bands['60-70']+bands.lt60;bands.below70=bands['60-70']+bands.lt60;bands.below60=bands.lt60;
  return bands;
}
function renderSkuOutletDistribution(rows){
  const el=document.getElementById('skuOutletDistribution');if(!el)return;const b=skuScopeOutletStats(rows);
  const items=[['ge90',b.ge90],['80-90',b['80-90']],['70-80',b['70-80']],['60-70',b['60-70']],['lt60',b.lt60]];
  el.innerHTML=`<div class="sku-outlet-dist-head"><span>Outlet DOS distribution · ${DOS_DAYS}D</span><strong>${fmtInt.format(b.total)} outlets in the current SKU scope</strong></div>
  <div class="sku-outlet-dist-grid">${items.map(([key,value])=>{const t=TIERS[key];const cls=t.cls==='crit'?'bad':t.cls;
    return `<div class="sku-outlet-dist-item ${cls}"><span class="lbl"><b>${bandLabel(key)}</b><small>${t.label}</small></span><strong>${fmtInt.format(value)}</strong></div>`}).join('')}</div>`;
}

/* ------------------------------------------------------------------ *
 * Table plumbing
 * ------------------------------------------------------------------ */
function sortRows(rows, tableId){
  const s=SORT_STATE[tableId]; if(!s?.key)return rows;
  const m=s.dir==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    let av=a[s.key],bv=b[s.key];
    if(s.type==='number'){av=Number(av)||0;bv=Number(bv)||0;return (av-bv)*m;}
    return String(av??'').localeCompare(String(bv??''),undefined,{numeric:true,sensitivity:'base'})*m;
  });
}
function setSortIndicators(tableId){
  const table=document.getElementById(tableId); if(!table)return;
  const s=SORT_STATE[tableId];
  table.querySelectorAll('th[data-sort-key]').forEach(th=>{
    th.classList.add('sortable');
    const active=s&&th.dataset.sortKey===s.key;
    th.dataset.sortDir=active?s.dir:'';
    th.setAttribute('aria-sort',active?(s.dir==='asc'?'ascending':'descending'):'none');
    if(!th.hasAttribute('tabindex'))th.tabIndex=0;
  });
}
function tableSearch(rows,tableId,haystackFn){
  const state=TABLE_STATE[tableId]; if(!state)return rows;
  const q=(document.getElementById(state.searchId)?.value||'').trim().toLowerCase();
  if(!q)return rows;
  return rows.filter(r=>haystackFn(r).toLowerCase().includes(q));
}
function tablePage(rows,tableId,totalBeforeSearch){
  const state=TABLE_STATE[tableId]; if(!state)return rows;
  const sel=document.getElementById(state.rowsId); const raw=sel?.value||'25';
  const size=raw==='all'?Math.max(1,rows.length):Math.max(1,Number(raw)||25);
  const pages=Math.max(1,Math.ceil(rows.length/size));
  state.page=Math.min(Math.max(1,state.page),pages);
  const start=(state.page-1)*size, end=Math.min(rows.length,start+size);
  const visible=raw==='all'?rows:rows.slice(start,end);
  const count=document.getElementById(state.countId);
  if(count){
    if(!rows.length) count.textContent=`No rows of ${fmtInt.format(totalBeforeSearch)}`;
    else count.textContent=`${fmtInt.format(start+1)}–${fmtInt.format(end)} of ${fmtInt.format(rows.length)}${rows.length!==totalBeforeSearch?` matched · ${fmtInt.format(totalBeforeSearch)} total`:''}`;
  }
  const pager=document.getElementById(state.pagerId);
  if(pager){
    const span=pager.querySelector('span'); if(span)span.textContent=`${fmtInt.format(state.page)} / ${fmtInt.format(pages)}`;
    const prev=pager.querySelector('[data-page-action="prev"]'), next=pager.querySelector('[data-page-action="next"]');
    if(prev)prev.disabled=state.page<=1; if(next)next.disabled=state.page>=pages;
    pager.classList.toggle('is-all',raw==='all');
  }
  return visible;
}
function resetTablePage(tableId){if(TABLE_STATE[tableId])TABLE_STATE[tableId].page=1}
function resetViewTablePages(view){
  if(view==='sku')resetTablePage('skuDetailTable');
  else if(view==='combo')resetTablePage('comboDetailTable');
  else ['riskTable','zoneTable','outletDetailTable'].forEach(resetTablePage);
}
function renderTableForSort(tableId){
  if(tableId==='riskTable')renderBottom(filteredRows());
  else if(tableId==='zoneTable')renderZone(filteredRows());
  else if(tableId==='skuDetailTable')renderSkuTable(filteredSkus());
  else if(tableId==='outletDetailTable')renderOutlets(filteredRows());
}

/* ------------------------------------------------------------------ *
 * Outlet view
 * ------------------------------------------------------------------ */
function filteredRows(){
  const k=document.getElementById('kviFilter').value;
  const leader=document.getElementById('outletLeaderFilter').value;
  const outlet=document.getElementById('outletSelectFilter')?.value||'all';
  const stockBand=document.getElementById('outletStockBandFilter').value;
  const dosBand=document.getElementById('bandFilter').value;
  const threshold=document.getElementById('outletThresholdFilter')?.value||'all';
  const q=document.getElementById('searchInput').value.trim().toLowerCase();
  return (DATA?.outlets||[]).filter(r=>{
    const ky=(norm(r.kvi)==='yes');
    if(outlet!=='all'&&String(r.outlet_code||'').trim()!==outlet)return false;
    if(k==='yes'&&!ky)return false; if(k==='no'&&ky)return false;
    if(leader!=='all'&&String(r.leader||'Unassigned')!==leader)return false;
    if(stockBand!=='all'&&bandKey(Number(r.availability)||0)!==stockBand)return false;
    const dp=outletDosPct(r);
    if(dosBand!=='all'&&bandKey(dp)!==dosBand)return false;
    if(threshold==='lt80'&&!(dp<.8))return false;if(threshold==='lt70'&&!(dp<.7))return false;if(threshold==='lt60'&&!(dp<.6))return false;
    if(q && !`${r.outlet_code||''} ${r.outlet_name||''} ${r.leader||''} ${r.kvi||''}`.toLowerCase().includes(q))return false;
    return true;
  });
}
function metrics(rows){
  const assortment=rows.reduce((s,r)=>s+(Number(r.assortment)||0),0);
  const available=rows.reduce((s,r)=>s+(Number(r.available)||0),0);
  const dosAvailable=rows.reduce((s,r)=>s+curveValue(r),0);
  const overall=assortment?available/assortment:0, dosOverall=assortment?dosAvailable/assortment:0;
  const kvi=rows.filter(r=>norm(r.kvi)==='yes').length, lowDos=rows.filter(r=>outletDosPct(r)<.6).length;
  return {assortment,available,dosAvailable,overall,dosOverall,outlets:rows.length,kvi,lowDos};
}
function kpiCardHtml(c,attr){
  const tone=c.tone?` tone-${c.tone}`:'';
  return `<button class="kpi filterable-card${tone}${c.active?' active-filter':''}" type="button" ${attr}="${c.kind}" data-filter-value="${c.filter}" title="${esc(c.title||'Filter the table below')}">
    <span class="label">${esc(c.label)}</span><span class="value">${esc(c.value)}</span><span class="sub">${esc(c.sub)}</span>
    ${c.hint?`<span class="card-hint">${esc(c.hint)}</span>`:''}
    ${c.impact?`<span class="impact-line">${esc(c.impact)}</span>`:''}
  </button>`;
}
function renderKPIs(rows){
  const m=metrics(rows);
  const explorer=document.getElementById('outletExplorerCount'); if(explorer)explorer.textContent=`${fmtInt.format(m.outlets)} outlets · ${dynamicLabel()}`;
  const stockBand=bandKey(m.overall),dosBand=bandKey(m.dosOverall),threshold=TABLE_CLICK_FILTERS.outlet.threshold;
  const cards=[
    {label:'Stock availability',value:pct1(m.overall),sub:`${fmtInt.format(m.available)} of ${fmtInt.format(m.assortment)} outlet-SKU pairs in stock`,kind:'stock-band',filter:stockBand,active:TABLE_CLICK_FILTERS.outlet.stockBand===stockBand,tone:tierOf(m.overall).cls,title:`Filter the outlet table to the ${bandLabel(stockBand)} stock band`},
    {label:`DOS availability · ${DOS_DAYS}D`,value:pct1(m.dosOverall),sub:`Coverage-weighted, Summary!L6 rule`,kind:'dos-band',filter:dosBand,active:TABLE_CLICK_FILTERS.outlet.dosBand===dosBand,tone:tierOf(m.dosOverall).cls,title:`Filter the outlet table to the ${bandLabel(dosBand)} DOS band`},
    {label:'Outlets',value:fmtInt.format(m.outlets),sub:'After the current filters',hint:`${fmtInt.format(m.kvi)} of them are KVI outlets`,kind:'show-all',filter:'all',title:'Clear the card filters on the outlet table'},
    {label:`Outlets below 60% DOS`,value:fmtInt.format(m.lowDos),sub:`Immediate risk at ${DOS_DAYS}-day coverage`,kind:'threshold',filter:'lt60',active:threshold==='lt60',tone:'crit',title:'Filter the outlet table to outlets below 60% DOS'}
  ];
  document.getElementById('kpiGrid').innerHTML=cards.map(c=>kpiCardHtml(c,'data-outlet-kpi-filter')).join('');
}
function bandData(rows){
  const keys=['ge90','80-90','70-80','60-70','lt60'];
  const counts=Object.fromEntries(keys.map(k=>[k,0])); rows.forEach(r=>counts[bandKey(outletDosPct(r))]++);
  const total=rows.length||1;
  return keys.map(key=>({key,label:bandLabel(key),tier:TIERS[key].label,outlets:counts[key],share:counts[key]/total}));
}
function renderBands(rows){
  const items=bandData(rows), max=Math.max(1,...items.map(x=>x.outlets));
  document.getElementById('bandChart').innerHTML=items.map(x=>{
    const t=TIERS[x.key];
    return `<button class="band-row tier-${t.cls}${TABLE_CLICK_FILTERS.outlet.dosBand===x.key?' active-filter':''}" type="button" data-outlet-band="${x.key}" title="Filter the outlet table to ${esc(x.label)} (${esc(x.tier)})">
      <span class="band-label"><i class="tier-dot" aria-hidden="true"></i>${esc(x.label)}<span class="sr-only"> — ${esc(x.tier)}</span></span>
      <span class="bar-track"><span class="bar-fill" style="width:${(x.outlets/max*100).toFixed(1)}%"></span></span>
      <span class="band-value">${fmtInt.format(x.outlets)}<small>${pct1(x.share)}</small></span>
    </button>`;
  }).join('');
  document.getElementById('bandPanelTitle').textContent=`DOS availability bands · ${DOS_DAYS}D`;
}
function riskRows(rows){return rows.map(r=>({...r,dos_pct:outletDosPct(r)}))}
function riskHaystack(r){return `${r.outlet_name||''} ${r.outlet_code||''} ${r.leader||''} ${pct(r.availability)} ${pct(r.dos_pct)}`}
function matchedRiskRows(){
  const base=riskRows(filteredRows()); const searched=tableSearch(base,'riskTable',riskHaystack); return sortRows(searched,'riskTable');
}
function pctCell(v){return `<span class="pct ${pctClass(v)}" title="${esc(tierTitle(v))}">${pct(v)}</span>`}
function renderBottom(rows){
  const base=riskRows(rows), searched=tableSearch(base,'riskTable',riskHaystack), sorted=sortRows(searched,'riskTable'), page=tablePage(sorted,'riskTable',base.length);
  document.getElementById('bottomTable').innerHTML=page.length?page.map(r=>`<tr><td>${esc(r.outlet_name)}</td><td>${esc(r.outlet_code)}</td><td class="num">${pctCell(r.availability)}</td><td class="num">${pctCell(r.dos_pct)}</td></tr>`).join(''):`<tr><td colspan="4" class="empty">No outlets match the current filters. Clear a filter to see results.</td></tr>`;
  document.getElementById('riskPanelTitle').textContent=`Lowest DOS availability outlets · ${DOS_DAYS}D`; setSortIndicators('riskTable');
}
function outletViewRows(rows){return rows.map(r=>({...r,dos_qty:curveValue(r),dos_pct:outletDosPct(r)}))}
function outletHaystack(r){return `${r.outlet_code||''} ${r.outlet_name||''} ${r.leader||''} ${r.zone||''} ${r.kvi||''} ${r.assortment||0} ${r.available||0} ${pct(r.availability)} ${fmtQty.format(r.dos_qty)} ${pct(r.dos_pct)}`}
function matchedOutletTableRows(){const base=outletViewRows(applyOutletTableClickFilters(filteredRows()));return sortRows(tableSearch(base,'outletDetailTable',outletHaystack),'outletDetailTable')}
function renderOutlets(rows){
  const tableRows=applyOutletTableClickFilters(rows); document.getElementById('rowCount').textContent=`${fmtInt.format(tableRows.length)} outlets · ${dynamicLabel()}`;
  const base=outletViewRows(tableRows), searched=tableSearch(base,'outletDetailTable',outletHaystack), sorted=sortRows(searched,'outletDetailTable'), page=tablePage(sorted,'outletDetailTable',base.length);
  const zoneCell=r=>ZONE_PRESENT?`<td>${esc(r.zone||'—')}</td>`:'';
  const cols=ZONE_PRESENT?10:9;
  document.getElementById('outletTable').innerHTML=page.length?page.map(r=>`<tr>
    <td>${esc(r.outlet_code)}</td><td>${esc(r.outlet_name)}</td><td>${esc(r.leader||'—')}</td>${zoneCell(r)}
    <td class="num">${fmtInt.format(r.assortment||0)}</td><td class="num">${fmtInt.format(r.available||0)}</td>
    <td class="num">${pctCell(r.availability)}</td>
    <td class="num">${fmtQty.format(r.dos_qty)}</td><td class="num">${pctCell(r.dos_pct)}</td>
    <td>${norm(r.kvi)==='yes'?'<span class="badge yes">Yes</span>':`<span class="badge unknown">${esc(r.kvi||'No')}</span>`}</td></tr>`).join(''):`<tr><td colspan="${cols}" class="empty">No outlets match the current filters. Clear a filter to see results.</td></tr>`;
  setSortIndicators('outletDetailTable');
}
function zoneOrder(){
  const z=DATA?.zone||[]; if(!z.length)return new Map();
  const leaderKey=Object.keys(z[0]||{}).find(k=>/leader/i.test(k)); if(!leaderKey)return new Map();
  return new Map(z.map((r,i)=>[String(r[leaderKey]||''),i]));
}
function zoneGroups(rows=filteredRows()){
  const acc={}; rows.forEach(r=>{const k=String(r.leader||'Unassigned'); if(!acc[k])acc[k]={leader:k,outlets:0,assortment:0,available:0,dos:0,below60:0}; const x=acc[k]; x.outlets++;x.assortment+=Number(r.assortment)||0;x.available+=Number(r.available)||0;x.dos+=curveValue(r);if(outletDosPct(r)<.6)x.below60++;});
  const order=zoneOrder(); return Object.values(acc).map(x=>({...x,availability:x.assortment?x.available/x.assortment:0,dos_pct:x.assortment?x.dos/x.assortment:0,_order:order.get(x.leader)??999}));
}
function zoneHaystack(r){return `${r.leader||''} ${r.outlets||0} ${r.assortment||0} ${r.available||0} ${pct(r.availability)} ${fmtQty.format(r.dos)} ${pct(r.dos_pct)} ${r.below60||0}`}
function matchedZoneRows(){const base=zoneGroups(filteredRows());return sortRows(tableSearch(base,'zoneTable',zoneHaystack),'zoneTable')}
function renderZone(rows=filteredRows()){
  const t=document.getElementById('zoneTable');
  const base=zoneGroups(rows), searched=tableSearch(base,'zoneTable',zoneHaystack), sorted=sortRows(searched,'zoneTable'), page=tablePage(sorted,'zoneTable',base.length);
  t.innerHTML=`<thead><tr><th scope="col" data-sort-key="leader">Leader</th><th scope="col" class="num" data-sort-key="outlets" data-sort-type="number">Outlets</th><th scope="col" class="num" data-sort-key="assortment" data-sort-type="number">Assortment</th><th scope="col" class="num" data-sort-key="available" data-sort-type="number">In stock</th><th scope="col" class="num" data-sort-key="availability" data-sort-type="number">Stock avail.</th><th scope="col" class="num" data-sort-key="dos" data-sort-type="number">DOS qty · ${DOS_DAYS}D</th><th scope="col" class="num" data-sort-key="dos_pct" data-sort-type="number">DOS % · ${DOS_DAYS}D</th><th scope="col" class="num" data-sort-key="below60" data-sort-type="number">Below 60% DOS</th></tr></thead><tbody>${page.length?page.map(r=>`<tr><td>${esc(r.leader)}</td><td class="num">${fmtInt.format(r.outlets)}</td><td class="num">${fmtInt.format(r.assortment)}</td><td class="num">${fmtInt.format(r.available)}</td><td class="num">${pctCell(r.availability)}</td><td class="num">${fmtQty.format(r.dos)}</td><td class="num">${pctCell(r.dos_pct)}</td><td class="num">${fmtInt.format(r.below60)}</td></tr>`).join(''):`<tr><td colspan="8" class="empty">No leaders match the current filters.</td></tr>`}</tbody>`;
  document.getElementById('leaderPanelTitle').textContent=`Leader summary · ${DOS_DAYS}D DOS`; setSortIndicators('zoneTable');
}

/* ------------------------------------------------------------------ *
 * Legacy single-select population (superseded by filters-v2)
 * ------------------------------------------------------------------ */
function setSelectOptions(id,allLabel,rows,valueFn,labelFn){
  const el=document.getElementById(id);if(!el)return;const current=el.value||'all';
  el.innerHTML=`<option value="all">${esc(allLabel)}</option>`+rows.map(r=>`<option value="${esc(valueFn(r))}">${esc(labelFn(r))}</option>`).join('');
  el.value=[...el.options].some(o=>o.value===current)?current:'all';
}
function outletOptionRows(leader,kvi){
  return (DATA?.outlets||[]).filter(r=>{
    const ky=norm(r.kvi)==='yes'?'yes':'no';
    return (leader==='all'||String(r.leader||'Unassigned')===leader)&&(kvi==='all'||ky===kvi);
  }).slice().sort((a,b)=>String(a.outlet_code||'').localeCompare(String(b.outlet_code||''),undefined,{numeric:true}));
}
function refreshSkuOutletOptions(){
  const leader=document.getElementById('skuLeaderFilter')?.value||'all',kvi=document.getElementById('skuKviFilter')?.value||'all';
  setSelectOptions('skuOutletFilter','All outlets',outletOptionRows(leader,kvi),r=>String(r.outlet_code||'').trim(),r=>`${r.outlet_code} · ${r.outlet_name}`);
}
function refreshOutletSelectOptions(){
  const leader=document.getElementById('outletLeaderFilter')?.value||'all',kvi=document.getElementById('kviFilter')?.value||'all';
  setSelectOptions('outletSelectFilter','All outlets',outletOptionRows(leader,kvi),r=>String(r.outlet_code||'').trim(),r=>`${r.outlet_code} · ${r.outlet_name}`);
}
function populateSkuFilters(){
  const skus=DATA?.skus||[];
  const types=[...new Set(skus.map(r=>String(r.type||'')).filter(Boolean))].sort();
  const cats=[...new Set(skus.map(r=>String(r.cat||'')).filter(Boolean))].sort();
  const l3s=[...new Set(skus.map(r=>String(r.l3||'')).filter(Boolean))].sort();
  const leaders=(DATA?.sku_leaders||[...new Set((DATA?.outlets||[]).map(r=>String(r.leader||'Unassigned')))]).slice().sort();
  setSelectOptions('skuTypeFilter','All types',types,v=>v,v=>v);setSelectOptions('skuLeaderFilter','All leaders',leaders,v=>v,v=>v);
  setSelectOptions('skuCatFilter','All categories',cats,v=>v,v=>v);setSelectOptions('skuL3Filter','All L-3',l3s,v=>v,v=>v);refreshSkuOutletOptions();
}
function populateOutletFilters(){
  const leaders=[...new Set((DATA?.outlets||[]).map(r=>String(r.leader||'Unassigned')))].sort();
  setSelectOptions('outletLeaderFilter','All leaders',leaders,v=>v,v=>v);refreshOutletSelectOptions();
}
function filteredSkus({ignoreType=false}={}){
  const t=document.getElementById('skuTypeFilter').value,c=document.getElementById('skuCatFilter').value,l3=document.getElementById('skuL3Filter').value;
  const stockBand=document.getElementById('skuStockBandFilter').value,dosBand=document.getElementById('skuBandFilter').value,threshold=document.getElementById('skuThresholdFilter').value;
  const q=document.getElementById('skuSearchInput').value.trim().toLowerCase();
  return (DATA?.skus||[]).map(effectiveSkuRow).filter(r=>{
    if(!ignoreType&&t!=='all'&&String(r.type)!==t)return false;
    if(c!=='all'&&String(r.cat)!==c)return false;if(l3!=='all'&&String(r.l3)!==l3)return false;
    if(stockBand!=='all'&&bandKey(Number(r.availability)||0)!==stockBand)return false;
    const dp=skuDosPct(r);if(dosBand!=='all'&&bandKey(dp)!==dosBand)return false;
    if(threshold==='lt80'&&!(dp<.8))return false;if(threshold==='lt70'&&!(dp<.7))return false;if(threshold==='lt60'&&!(dp<.6))return false;
    if(q&&!`${r.sku_code||''} ${r.description||''} ${r.l3||''} ${r.cat||''} ${r.type||''}`.toLowerCase().includes(q))return false;
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * SKU view
 * ------------------------------------------------------------------ */
function typeAnalyticsRows(rows=filteredSkus({ignoreType:true})){
  const acc={}; rows.forEach(r=>{const k=String(r.type||'Unknown');if(!acc[k])acc[k]={type:k,sku_count:0,available:0,opportunities:0,dos:0};const x=acc[k];x.sku_count++;x.available+=Number(r.available_outlets)||0;x.opportunities+=Number(r.total_outlets)||0;x.dos+=curveValue(r);});
  const out=Object.values(acc).map(x=>({...x,availability:x.opportunities?x.available/x.opportunities:0,dos_pct:x.opportunities?x.dos/x.opportunities:0,dos_gap:Math.max(0,x.opportunities-x.dos)}));
  const total=out.reduce((s,r)=>s+r.dos_gap,0); return out.map(r=>({...r,gap_share:total?r.dos_gap/total:0}));
}
function renderTypeCards(){
  const current=TABLE_CLICK_FILTERS.sku.type;
  const types=typeAnalyticsRows().slice().sort((a,b)=>a.type.localeCompare(b.type));
  document.getElementById('typeCardGrid').innerHTML=types.length?types.map(r=>`<button class="type-card filterable-card ${typeClass(r.type)}${current===String(r.type)?' active-filter':''}" type="button" data-sku-type="${esc(r.type)}" title="Filter the SKU table to ${esc(r.type)}">
    <span class="type-top"><span class="type-badge ${typeClass(r.type)}">${esc(r.type)}</span><span>${fmtInt.format(r.sku_count)} SKUs</span></span>
    <span class="type-value ${pctClass(r.dos_pct)}">${pct1(r.dos_pct)}</span>
    <span class="type-meta"><span>${DOS_DAYS}D DOS · stock ${pct1(r.availability)}</span><span>${pct1(r.gap_share)} of DOS gap</span></span>
  </button>`).join(''):`<div class="panel empty">No SKU types match the current filters.</div>`;
}
function renderSkuKPIs(rows){
  const opp=rows.reduce((s,r)=>s+(Number(r.total_outlets)||0),0),av=rows.reduce((s,r)=>s+(Number(r.available_outlets)||0),0),dos=rows.reduce((s,r)=>s+curveValue(r),0);
  const stockOverall=opp?av/opp:0,dosOverall=opp?dos/opp:0;
  const below80=rows.filter(r=>skuDosPct(r)<.8).length,below70=rows.filter(r=>skuDosPct(r)<.7).length,below60=rows.filter(r=>skuDosPct(r)<.6).length;
  const outletBands=skuScopeOutletStats(rows),stockBand=bandKey(stockOverall),dosBand=bandKey(dosOverall),threshold=TABLE_CLICK_FILTERS.sku.threshold;
  const unique=uniqueSkuCount(rows);
  // The headline number on a risk card is the SKU count, because clicking the
  // card filters SKUs. The affected-outlet count is the supporting line.
  const cards=[
    {label:'Stock availability',value:pct1(stockOverall),sub:`${fmtInt.format(av)} of ${fmtInt.format(opp)} outlet-SKU pairs in stock`,kind:'stock-band',filter:stockBand,active:TABLE_CLICK_FILTERS.sku.stockBand===stockBand,tone:tierOf(stockOverall).cls,title:`Filter the SKU table to the ${bandLabel(stockBand)} stock band`},
    {label:`DOS availability · ${DOS_DAYS}D`,value:pct1(dosOverall),sub:'Coverage-weighted, Summary!L6 rule',kind:'dos-band',filter:dosBand,active:TABLE_CLICK_FILTERS.sku.dosBand===dosBand,tone:tierOf(dosOverall).cls,title:`Filter the SKU table to the ${bandLabel(dosBand)} DOS band`},
    {label:'SKU rows',value:fmtInt.format(rows.length),sub:'After the current filters',hint:unique===rows.length?`${fmtInt.format(unique)} unique item codes`:`${fmtInt.format(unique)} unique item codes · ${fmtInt.format(rows.length-unique)} listed on a second SKU type`,kind:'show-all',filter:'all',title:'Clear the card filters on the SKU table'},
    {label:'SKUs below 80% DOS',value:fmtInt.format(below80),sub:'Click to filter the SKU table',impact:`Affects ${fmtInt.format(outletBands.below80)} outlets`,kind:'threshold',filter:'lt80',active:threshold==='lt80',tone:'warn'},
    {label:'SKUs below 70% DOS',value:fmtInt.format(below70),sub:'Click to filter the SKU table',impact:`Affects ${fmtInt.format(outletBands.below70)} outlets`,kind:'threshold',filter:'lt70',active:threshold==='lt70',tone:'risk'},
    {label:'SKUs below 60% DOS',value:fmtInt.format(below60),sub:'Click to filter the SKU table',impact:`Affects ${fmtInt.format(outletBands.below60)} outlets`,kind:'threshold',filter:'lt60',active:threshold==='lt60',tone:'crit'}
  ];
  document.getElementById('skuKpiGrid').innerHTML=cards.map(c=>kpiCardHtml(c,'data-kpi-filter')).join('');
}
function renderRankChart(id,items,labelFn,valueFn,subFn,valueFormat=fmtQty){
  const el=document.getElementById(id); if(!items.length){el.innerHTML='<div class="empty">Nothing below the risk threshold in the current selection — that is a good result.</div>';return}
  const max=Math.max(.000001,...items.map(valueFn));
  el.innerHTML=items.map((r,i)=>`<div class="rank-row"><div class="rank-no">${i+1}</div><div class="rank-main"><div class="rank-label" title="${esc(labelFn(r))}">${esc(labelFn(r))}</div><div class="rank-track"><div class="rank-fill" style="width:${(valueFn(r)/max*100).toFixed(1)}%"></div></div><div class="rank-sub">${esc(subFn(r))}</div></div><div class="rank-value">${valueFormat.format(valueFn(r))}</div></div>`).join('');
}
function skuGapRows(rows){
  return [...rows].map(r=>({...r,dos_qty:curveValue(r),dos_pct:skuDosPct(r),dos_gap:skuDosGap(r),affected_outlets:skuAffectedOutletCount(r)}))
    .filter(r=>r.affected_outlets>0)
    .sort((a,b)=>b.affected_outlets-a.affected_outlets||b.dos_gap-a.dos_gap||a.dos_pct-b.dos_pct).slice(0,15);
}
function l3GapRows(rows){
  const acc={};
  rows.forEach(r=>{
    const k=String(r.l3||'Unknown');
    if(!acc[k])acc[k]={l3:k,skus:0,below80:0,below70:0,below60:0,available:0,dos:0,total:0};
    const x=acc[k], dp=skuDosPct(r);
    x.skus++; x.available+=Number(r.available_outlets)||0; x.dos+=curveValue(r); x.total+=Number(r.total_outlets)||0;
    if(dp<.8)x.below80++; if(dp<.7)x.below70++; if(dp<.6)x.below60++;
  });
  return Object.values(acc).map(x=>({...x,availability:x.total?x.available/x.total:0,dos_pct:x.total?x.dos/x.total:0}))
    .filter(x=>x.below80>0)
    .sort((a,b)=>b.below80-a.below80||b.below70-a.below70||b.below60-a.below60||a.dos_pct-b.dos_pct)
    .slice(0,15);
}
function renderSkuGaps(rows){
  const countFmt={format:v=>`${fmtInt.format(v)} outlets`};
  const skuFmt={format:v=>`${fmtInt.format(v)} SKUs`};
  renderRankChart('skuGapChart',skuGapRows(rows),r=>`${r.sku_code} · ${r.description}`,r=>r.affected_outlets,r=>`${pct1(r.dos_pct)} DOS · stock ${pct1(r.availability)} · ${r.type||'—'} · ${r.l3||'—'}`,countFmt);
  renderRankChart('l3GapChart',l3GapRows(rows),r=>r.l3,r=>r.below80,r=>`Below 80%: ${fmtInt.format(r.below80)} · below 70%: ${fmtInt.format(r.below70)} · below 60%: ${fmtInt.format(r.below60)}`,skuFmt);
  document.getElementById('skuGapTitle').textContent=`Highest SKU DOS gaps · ${DOS_DAYS}D`; document.getElementById('l3GapTitle').textContent=`L-3 SKU risk hotspots · ${DOS_DAYS}D`;
}
function skuViewRows(rows){
  const totalDosGap=rows.reduce((s,r)=>s+skuDosGap(r),0);
  return rows.map(r=>({...r,dos_qty:curveValue(r),dos_pct:skuDosPct(r),dos_gap:skuDosGap(r),gap_share:totalDosGap?skuDosGap(r)/totalDosGap:0}));
}
function skuHaystack(r){return `${r.sku_code||''} ${r.description||''} ${r.l3||''} ${r.cat||''} ${r.type||''} ${r.available_outlets||0} ${pct(r.availability)} ${fmtQty.format(r.dos_qty)} ${pct(r.dos_pct)} ${fmtQty.format(r.dos_gap)} ${pct(r.gap_share)} ${r.total_outlets||0}`}
function matchedSkuTableRows(){const base=skuViewRows(applySkuTableClickFilters(filteredSkus()));return sortRows(tableSearch(base,'skuDetailTable',skuHaystack),'skuDetailTable')}
function renderSkuTable(rows){
  const tableRows=applySkuTableClickFilters(rows);
  document.getElementById('skuRowCount').textContent=`${fmtInt.format(tableRows.length)} SKU rows · ${dynamicLabel()}`;
  const base=skuViewRows(tableRows), searched=tableSearch(base,'skuDetailTable',skuHaystack), sorted=sortRows(searched,'skuDetailTable'), page=tablePage(sorted,'skuDetailTable',base.length);
  document.getElementById('skuTable').innerHTML=page.length?page.map(r=>`<tr>
    <td>${esc(r.sku_code)}</td><td class="desc-cell">${esc(r.description)}</td><td>${esc(r.l3||'—')}</td><td>${esc(r.cat||'—')}</td>
    <td><span class="type-badge ${typeClass(r.type)}">${esc(r.type||'—')}</span></td>
    <td class="num">${fmtInt.format(r.available_outlets||0)}</td><td class="num">${pctCell(r.availability)}</td>
    <td class="num">${fmtQty.format(r.dos_qty)}</td><td class="num">${pctCell(r.dos_pct)}</td>
    <td class="num strong-gap">${fmtQty.format(r.dos_gap)}</td><td class="num">${pct(r.gap_share)}</td><td class="num">${fmtInt.format(r.total_outlets||0)}</td>
  </tr>`).join(''):`<tr><td colspan="12" class="empty">No SKUs match the current filters. Clear a filter to see results.</td></tr>`;
  setSortIndicators('skuDetailTable');
}
function renderSkuAnalytics(){const rows=filteredSkus();renderSkuKPIs(rows);renderSkuOutletDistribution(rows);renderTypeCards();renderSkuGaps(rows);renderSkuTable(rows);renderTableClickFilterUI()}

/* ------------------------------------------------------------------ *
 * Data quality
 * ------------------------------------------------------------------ */
function renderQA(){
  const qa=DATA?.quality||[];
  const list=document.getElementById('qaList');
  list.innerHTML=qa.length?qa.map(q=>`<div class="qa-item ${esc(q.level||'good')}"><div class="qa-icon" aria-hidden="true"></div><div><strong>${esc(q.title)}</strong><span>${esc(q.detail)}</span></div></div>`).join(''):`<div class="qa-item good"><div class="qa-icon" aria-hidden="true"></div><div><strong>No automated warnings</strong><span>The parser did not detect a structural problem in the exported data.</span></div></div>`;
  const bad=qa.filter(q=>q.level==='bad').length, warn=qa.filter(q=>q.level==='warn').length;
  const summary=document.getElementById('qaSummary');
  if(summary)summary.textContent=bad?`${bad} error${bad===1?'':'s'}, ${warn} warning${warn===1?'':'s'}`:warn?`${warn} warning${warn===1?'':'s'}`:'All checks passed';
  const thr=document.getElementById('methodThreshold');
  if(thr)thr.textContent=fmtQty.format(Number(DATA?.dos?.stock_availability_threshold)||1);
}

/* ------------------------------------------------------------------ *
 * DOS control (sidebar + control bar stay in sync)
 * ------------------------------------------------------------------ */
function dosOptionsHtml(supported){return supported.map(d=>`<option value="${d}">${d} day${d===1?'':'s'}</option>`).join('')}
function populateDosControl(){
  const select=document.getElementById('dosDaysSelect'); const quick=document.getElementById('dosDaysQuick');
  const supported=DATA?.dos?.supported_days||[1]; const def=Number(DATA?.dos?.default_days)||1;
  const html=dosOptionsHtml(supported);
  select.innerHTML=html; if(quick)quick.innerHTML=html;
  let saved=Number(sessionStorage.getItem('availabilityDosDays'));
  DOS_DAYS=supported.includes(saved)?saved:def;
  select.value=String(DOS_DAYS); if(quick)quick.value=String(DOS_DAYS);
  document.getElementById('dosSourceDefault').textContent=`Excel default: ${def} day${def===1?'':'s'} · ${DATA?.dos?.source_cell||'Summary!L6'}`;
  document.getElementById('dosFormula').textContent='Coverage is stock ÷ (forecast ÷ 30 × DOS days), capped at 100% per outlet-SKU pair.';
  const md=document.getElementById('methodDos');
  if(md)md.textContent=`Coverage is scored per pair as min(1, stock ÷ (forecast ÷ 30 × DOS days)) — the ${DATA?.dos?.source_cell||'Summary!L6'} rule. A pair with enough stock for the whole window scores 1; a pair with half of it scores 0.5. DOS % is the average of those scores.`;
}
function setDosDays(days){
  const supported=DATA?.dos?.supported_days||[1];
  DOS_DAYS=supported.includes(Number(days))?Number(days):(Number(DATA?.dos?.default_days)||1);
  const select=document.getElementById('dosDaysSelect'),quick=document.getElementById('dosDaysQuick');
  if(select)select.value=String(DOS_DAYS); if(quick)quick.value=String(DOS_DAYS);
  try{sessionStorage.setItem('availabilityDosDays',String(DOS_DAYS))}catch(_){/* private mode */}
  Object.values(TABLE_STATE).forEach(s=>s.page=1);
  render();
}
function updateDosLabels(){document.querySelectorAll('[data-dos-label]').forEach(el=>el.textContent=dynamicLabel())}

/* ------------------------------------------------------------------ *
 * Filter chrome (replaced by filters-v2)
 * ------------------------------------------------------------------ */
function filterChip(label,key){return `<button class="filter-chip removable" type="button" data-clear-filter="${key}" title="Remove filter"><span>${esc(label)}</span><b aria-hidden="true">×</b></button>`}
function updateFilterUI(){
  const chips=[];
  const specs=VIEW_MODE==='outlet'?
    [['outletSelectFilter','Outlet','select'],['outletLeaderFilter','Leader','select'],['kviFilter','KVI','select'],['outletStockBandFilter','Stock band','select'],['bandFilter','DOS band','select'],['outletThresholdFilter','Attention','select'],['searchInput','Search','input']]:
    [['skuOutletFilter','Outlet','select'],['skuLeaderFilter','Leader','select'],['skuKviFilter','KVI','select'],['skuTypeFilter','SKU type','select'],['skuCatFilter','Category','select'],['skuL3Filter','L-3','select'],['skuStockBandFilter','Stock band','select'],['skuBandFilter','DOS band','select'],['skuThresholdFilter','Attention','select'],['skuSearchInput','SKU','input']];
  specs.forEach(([id,label,type])=>{const el=document.getElementById(id);if(!el)return;if(type==='input'){if(el.value.trim())chips.push([`${label}: ${el.value.trim()}`,id])}else if(el.value!=='all')chips.push([`${label}: ${el.options[el.selectedIndex]?.text||el.value}`,id])});
  const el=document.getElementById('activeFilterChips');el.innerHTML=chips.length?chips.map(([label,key])=>filterChip(label,key)).join(''):`<span class="filter-chip neutral">${VIEW_MODE==='outlet'?'All outlets':'All SKU & outlet scope'}</span>`;
  document.getElementById('filterStatus').textContent=chips.length?`${chips.length} active filter${chips.length===1?'':'s'} · ${dynamicLabel()}`:`Nothing filtered · ${dynamicLabel()}`;
}
function setActiveFilterBadge(count){
  const badge=document.getElementById('activeFilterCount');if(!badge)return;
  badge.textContent=String(count); badge.hidden=!count;
}
function render(){
  updateDosLabels();updateFilterUI();renderTableClickFilterUI();
  const rows=filteredRows();renderKPIs(rows);renderBands(rows);renderBottom(rows);renderOutlets(rows);renderZone(rows);renderSkuAnalytics();renderQA();
}

/* ------------------------------------------------------------------ *
 * CSV export
 * ------------------------------------------------------------------ */
function csvCell(v){if(v===null||v===undefined)return'';const s=String(v);return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
// Text dimensions occasionally arrive as a literal 0 from the workbook, which
// means "blank". The tables already show an em dash; exports must not print 0.
const textCell=v=>(v===0||v==='0'||v===null||v===undefined)?'':String(v);
function downloadCSV(filename,headers,rows){
  const lines=[headers.map(h=>csvCell(h.label)).join(','),...rows.map(r=>headers.map(h=>csvCell(typeof h.value==='function'?h.value(r):r[h.value])).join(','))];
  const blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
function fileStamp(){const d=new Date();return d.toLocaleDateString('en-CA',{timeZone:'Asia/Dhaka'}).replace(/-/g,'')}
function doExport(kind){
  const base=`availability_${fileStamp()}_${DOS_DAYS}D`;
  if(kind==='bands')downloadCSV(`${base}_outlet_bands.csv`,[{label:'DOS Availability Band',value:'label'},{label:'Severity Tier',value:'tier'},{label:'Outlets',value:'outlets'},{label:'Share %',value:r=>(r.share*100).toFixed(2)}],bandData(filteredRows()));
  if(kind==='risk')downloadCSV(`${base}_lowest_outlets.csv`,[{label:'Outlet',value:'outlet_name'},{label:'Outlet Code',value:'outlet_code'},{label:'Leader',value:'leader'},{label:'Stock Availability %',value:r=>(Number(r.availability||0)*100).toFixed(2)},{label:`DOS % ${DOS_DAYS}D`,value:r=>(Number(r.dos_pct||0)*100).toFixed(2)}],matchedRiskRows());
  if(kind==='zone')downloadCSV(`${base}_leader_summary.csv`,[{label:'Leader',value:'leader'},{label:'Outlets',value:'outlets'},{label:'Assortment',value:'assortment'},{label:'In Stock',value:'available'},{label:'Stock Availability %',value:r=>(r.availability*100).toFixed(2)},{label:`DOS Qty ${DOS_DAYS}D`,value:r=>r.dos.toFixed(1)},{label:`DOS % ${DOS_DAYS}D`,value:r=>(r.dos_pct*100).toFixed(2)},{label:'Below 60% DOS',value:'below60'}],matchedZoneRows());
  if(kind==='sku-gaps')downloadCSV(`${base}_highest_sku_gaps.csv`,[{label:'SKU Code',value:'sku_code'},{label:'Description',value:'description'},{label:'L-3',value:r=>textCell(r.l3)},{label:'Category',value:r=>textCell(r.cat)},{label:'Type',value:r=>textCell(r.type)},{label:'Affected Outlets',value:'affected_outlets'},{label:'Stock Availability %',value:r=>(Number(r.availability||0)*100).toFixed(2)},{label:`DOS % ${DOS_DAYS}D`,value:r=>(r.dos_pct*100).toFixed(2)},{label:'DOS Gap Equivalent',value:r=>r.dos_gap.toFixed(1)}],skuGapRows(filteredSkus()));
  if(kind==='l3-gaps')downloadCSV(`${base}_l3_sku_risk.csv`,[{label:'L-3',value:r=>textCell(r.l3)},{label:'Total SKUs',value:'skus'},{label:'Below 80% DOS SKUs',value:'below80'},{label:'Below 70% DOS SKUs',value:'below70'},{label:'Below 60% DOS SKUs',value:'below60'},{label:'Stock Availability %',value:r=>(r.availability*100).toFixed(2)},{label:`DOS % ${DOS_DAYS}D`,value:r=>(r.dos_pct*100).toFixed(2)}],l3GapRows(filteredSkus()));
  if(kind==='sku-detail')downloadCSV(`${base}_sku_detail.csv`,[{label:'SKU Code',value:'sku_code'},{label:'Description',value:'description'},{label:'L-3',value:r=>textCell(r.l3)},{label:'Category',value:r=>textCell(r.cat)},{label:'Type',value:r=>textCell(r.type)},{label:'Outlets In Stock',value:'available_outlets'},{label:'Stock Availability %',value:r=>(Number(r.availability||0)*100).toFixed(2)},{label:`DOS Qty ${DOS_DAYS}D`,value:r=>r.dos_qty.toFixed(1)},{label:`DOS % ${DOS_DAYS}D`,value:r=>(r.dos_pct*100).toFixed(2)},{label:'DOS Gap',value:r=>r.dos_gap.toFixed(1)},{label:'DOS Gap Share %',value:r=>(r.gap_share*100).toFixed(2)},{label:'Reporting Outlets',value:'total_outlets'}],matchedSkuTableRows());
  if(kind==='outlet-detail')downloadCSV(`${base}_outlet_detail.csv`,[{label:'Outlet Code',value:'outlet_code'},{label:'Outlet',value:'outlet_name'},{label:'Leader',value:'leader'},...(ZONE_PRESENT?[{label:'Zone',value:r=>r.zone||''}]:[]),{label:'Assortment',value:'assortment'},{label:'In Stock',value:'available'},{label:'Stock Availability %',value:r=>(Number(r.availability||0)*100).toFixed(2)},{label:`AVL-DOS ${DOS_DAYS}D`,value:r=>r.dos_qty.toFixed(1)},{label:`DOS % ${DOS_DAYS}D`,value:r=>(r.dos_pct*100).toFixed(2)},{label:'KVI',value:r=>norm(r.kvi)==='yes'?'Yes':'No'}],matchedOutletTableRows());
}

/* ------------------------------------------------------------------ *
 * Printable summary report
 * ------------------------------------------------------------------ */
function selectedFilterLabels(view){
  const specs=view==='sku'?
    [['skuOutletFilter','Outlet'],['skuLeaderFilter','Leader'],['skuKviFilter','KVI'],['skuTypeFilter','Type'],['skuCatFilter','Category'],['skuL3Filter','L-3'],['skuStockBandFilter','Stock'],['skuBandFilter','DOS'],['skuThresholdFilter','Attention'],['skuSearchInput','SKU']]:
    [['outletSelectFilter','Outlet'],['outletLeaderFilter','Leader'],['kviFilter','KVI'],['outletStockBandFilter','Stock'],['bandFilter','DOS'],['outletThresholdFilter','Attention'],['searchInput','Search']];
  const out=[];specs.forEach(([id,label])=>{const el=document.getElementById(id);if(!el)return;if(el.tagName==='SELECT'){if(el.value!=='all')out.push(`${label}: ${el.options[el.selectedIndex]?.text||el.value}`)}else if(el.value.trim())out.push(`${label}: ${el.value.trim()}`)});return out;
}
function skuSummaryMetrics(rows){
  const opp=rows.reduce((s,r)=>s+(Number(r.total_outlets)||0),0),av=rows.reduce((s,r)=>s+(Number(r.available_outlets)||0),0),dos=rows.reduce((s,r)=>s+curveValue(r),0);
  const b80=rows.filter(r=>skuDosPct(r)<.8),b70=rows.filter(r=>skuDosPct(r)<.7),b60=rows.filter(r=>skuDosPct(r)<.6),ob=skuScopeOutletStats(rows);
  return {skus:rows.length,unique:uniqueSkuCount(rows),opp,av,dos,stock:opp?av/opp:0,dosPct:opp?dos/opp:0,below80:b80.length,below70:b70.length,below60:b60.length,below80Outlets:ob.below80,below70Outlets:ob.below70,below60Outlets:ob.below60};
}
function skuTypeSummary(rows){
  const acc={};rows.forEach(r=>{const k=String(r.type||'Unknown');if(!acc[k])acc[k]={type:k,skus:0,opp:0,av:0,dos:0};const x=acc[k];x.skus++;x.opp+=Number(r.total_outlets)||0;x.av+=Number(r.available_outlets)||0;x.dos+=curveValue(r)});
  return Object.values(acc).map(x=>({...x,stock:x.opp?x.av/x.opp:0,dosPct:x.opp?x.dos/x.opp:0})).sort((a,b)=>a.dosPct-b.dosPct);
}
function reportKpi(label,value,sub=''){return `<div class="rk"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function summaryReportHtml(){
  const skuRows=filteredSkus(),outletRows=filteredRows(),sm=skuSummaryMetrics(skuRows),om=metrics(outletRows),types=skuTypeSummary(skuRows),skuGaps=skuGapRows(skuRows).slice(0,8),l3=l3GapRows(skuRows).slice(0,6),risks=riskRows(outletRows).sort((a,b)=>a.dos_pct-b.dos_pct).slice(0,8),leaders=zoneGroups(outletRows).sort((a,b)=>a.dos_pct-b.dos_pct);
  const skuFilters=selectedFilterLabels('sku'),outletFilters=selectedFilterLabels('outlet'),source=DATA?.meta?.source_file||'Availability Report.xlsx + Stock.xlsx',generated=dt(DATA?.meta?.generated_at),stamp=new Date().toLocaleString('en-GB',{timeZone:'Asia/Dhaka',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const filters=f=>f.length?f.join(' · '):'None — all data';
  const typeRows=types.map(r=>`<tr><td>${esc(r.type)}</td><td>${fmtInt.format(r.skus)}</td><td>${pct1(r.stock)}</td><td>${pct1(r.dosPct)}</td></tr>`).join('');
  const skuRowsHtml=skuGaps.map(r=>`<tr><td>${esc(r.sku_code)}</td><td>${esc(r.description)}</td><td>${esc(r.type||'—')}</td><td>${fmtInt.format(r.affected_outlets)}</td><td>${pct1(r.availability)}</td><td>${pct1(r.dos_pct)}</td></tr>`).join('');
  const l3Rows=l3.map(r=>`<tr><td>${esc(r.l3)}</td><td>${fmtInt.format(r.skus)}</td><td>${fmtInt.format(r.below80)}</td><td>${fmtInt.format(r.below70)}</td><td>${fmtInt.format(r.below60)}</td></tr>`).join('');
  const riskRowsHtml=risks.map(r=>`<tr><td>${esc(r.outlet_code)}</td><td>${esc(r.outlet_name)}</td><td>${esc(r.leader||'—')}</td><td>${pct1(r.availability)}</td><td>${pct1(r.dos_pct)}</td></tr>`).join('');
  const leaderRows=leaders.map(r=>`<tr><td>${esc(r.leader)}</td><td>${fmtInt.format(r.outlets)}</td><td>${pct1(r.availability)}</td><td>${pct1(r.dos_pct)}</td><td>${fmtInt.format(r.below60)}</td></tr>`).join('');
  const bands=bandData(outletRows).map(r=>`<div class="band"><span>${esc(r.label)}</span><b>${fmtInt.format(r.outlets)}</b><i>${esc(r.tier)}</i></div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Availability Summary Report</title><style>
  @page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}
  body{margin:0;background:#eef2f7;color:#101828;font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
  .tools{position:sticky;top:0;z-index:10;padding:12px 18px;background:#101828;color:#fff;display:flex;justify-content:space-between;align-items:center;font-size:13px}
  .tools button{border:0;background:#a80d18;color:#fff;padding:10px 16px;border-radius:8px;font-weight:800;cursor:pointer;font-size:13px}
  .page{width:281mm;min-height:194mm;margin:12px auto;background:#fff;padding:8mm 9mm;box-shadow:0 10px 30px rgba(16,24,40,.12);page-break-after:always;overflow:hidden}
  .page:last-child{page-break-after:auto}
  .head{display:flex;justify-content:space-between;border-bottom:2px solid #a80d18;padding-bottom:5mm;margin-bottom:4mm}
  .brand{font-size:10px;font-weight:800;letter-spacing:.14em;color:#a80d18}
  .head h1{font-size:22px;margin:3px 0}
  .meta{font-size:9.5px;color:#5b6676;text-align:right;line-height:1.6}
  .filterline{font-size:9.5px;padding:6px 9px;background:#f7f9fc;border:1px solid #dfe5ee;border-radius:6px;margin-bottom:4mm}
  .kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:3mm;margin-bottom:4mm}
  .rk{border:1px solid #dfe5ee;border-radius:8px;padding:3mm;background:#fff}
  .rk span{display:block;font-size:8.5px;text-transform:uppercase;letter-spacing:.05em;color:#5b6676;font-weight:800}
  .rk strong{display:block;font-size:18px;margin-top:2mm}
  .rk small{display:block;font-size:8.5px;color:#5b6676;margin-top:1mm}
  .grid2{display:grid;grid-template-columns:1fr 1.4fr;gap:4mm}.grid2.equal{grid-template-columns:1fr 1fr}
  .box{border:1px solid #dfe5ee;border-radius:8px;padding:3mm;overflow:hidden}
  .box h2{font-size:12px;margin:0 0 2mm}
  .box h3{font-size:9px;margin:0 0 2mm;color:#a80d18;text-transform:uppercase;letter-spacing:.07em}
  table{width:100%;border-collapse:collapse;font-size:8.5px}
  th{background:#f7f9fc;color:#5b6676;text-align:left;font-size:7.5px;text-transform:uppercase;letter-spacing:.04em}
  th,td{padding:1.6mm 1.8mm;border-bottom:1px solid #e8ecf3}
  td:nth-last-child(-n+3),th:nth-last-child(-n+3){text-align:right}
  .bandgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:2mm}
  .band{padding:3mm;border-radius:7px;background:#f7f9fc;border:1px solid #dfe5ee}
  .band span{display:block;font-size:7.5px;color:#5b6676;font-weight:700}
  .band b{display:block;font-size:16px;margin-top:1mm}
  .band i{display:block;font-size:7.5px;color:#5b6676;font-style:normal;margin-top:1mm}
  .foot{font-size:7.5px;color:#8892a3;margin-top:3mm;display:flex;justify-content:space-between}
  @media print{body{background:#fff}.tools{display:none}.page{margin:0;box-shadow:none;width:auto;min-height:0;height:194mm}}
  </style></head><body><div class="tools"><strong>Two-page availability summary</strong><button onclick="window.print()">Print / save PDF</button></div>
  <section class="page"><div class="head"><div><div class="brand">SHWAPNO OPERATIONS · SKU ANALYTICS</div><h1>SKU availability summary</h1><div style="font-size:10px;color:#5b6676">${esc(dynamicLabel())} · ${fmtInt.format(sm.skus)} SKU rows (${fmtInt.format(sm.unique)} unique codes)</div></div><div class="meta">Source: ${esc(source)}<br>Generated: ${esc(generated)}<br>Report opened: ${esc(stamp)}</div></div>
  <div class="filterline"><b>SKU filters:</b> ${esc(filters(skuFilters))}</div>
  <div class="kpis">${reportKpi('Stock availability',pct1(sm.stock))}${reportKpi(`DOS availability · ${DOS_DAYS}D`,pct1(sm.dosPct))}${reportKpi('SKU rows',fmtInt.format(sm.skus))}${reportKpi('SKUs below 80% DOS',fmtInt.format(sm.below80),`affects ${fmtInt.format(sm.below80Outlets)} outlets`)}${reportKpi('SKUs below 70% DOS',fmtInt.format(sm.below70),`affects ${fmtInt.format(sm.below70Outlets)} outlets`)}${reportKpi('SKUs below 60% DOS',fmtInt.format(sm.below60),`affects ${fmtInt.format(sm.below60Outlets)} outlets`)}</div>
  <div class="grid2"><div><div class="box"><h3>SKU type</h3><h2>Performance by type</h2><table><thead><tr><th>Type</th><th>SKUs</th><th>Stock</th><th>DOS</th></tr></thead><tbody>${typeRows}</tbody></table></div><div class="box" style="margin-top:4mm"><h3>L-3 hotspots</h3><h2>SKU risk by L-3</h2><table><thead><tr><th>L-3</th><th>Total SKUs</th><th>&lt;80%</th><th>&lt;70%</th><th>&lt;60%</th></tr></thead><tbody>${l3Rows}</tbody></table></div></div><div class="box"><h3>Action priority</h3><h2>Highest SKU DOS gaps</h2><table><thead><tr><th>SKU</th><th>Description</th><th>Type</th><th>Affected outlets</th><th>Stock</th><th>DOS</th></tr></thead><tbody>${skuRowsHtml}</tbody></table></div></div>
  <div class="foot"><span>Page 1 of 2 · SKU summary</span><span>SKU filters are independent of the outlet view</span></div></section>
  <section class="page"><div class="head"><div><div class="brand">SHWAPNO OPERATIONS · OUTLET VIEW</div><h1>Outlet availability summary</h1><div style="font-size:10px;color:#5b6676">${esc(dynamicLabel())} · ${fmtInt.format(om.outlets)} selected outlets</div></div><div class="meta">Source: ${esc(source)}<br>Generated: ${esc(generated)}<br>Report opened: ${esc(stamp)}</div></div>
  <div class="filterline"><b>Outlet filters:</b> ${esc(filters(outletFilters))}</div>
  <div class="kpis" style="grid-template-columns:repeat(4,1fr)">${reportKpi('Stock availability',pct1(om.overall))}${reportKpi(`DOS availability · ${DOS_DAYS}D`,pct1(om.dosOverall))}${reportKpi('Outlets',fmtInt.format(om.outlets))}${reportKpi('Outlets below 60% DOS',fmtInt.format(om.lowDos),'critical')}</div>
  <div class="box" style="margin-bottom:4mm"><h3>Distribution</h3><h2>DOS availability bands</h2><div class="bandgrid">${bands}</div></div>
  <div class="grid2 equal"><div class="box"><h3>Risk watch</h3><h2>Lowest DOS availability outlets</h2><table><thead><tr><th>Code</th><th>Outlet</th><th>Leader</th><th>Stock</th><th>DOS</th></tr></thead><tbody>${riskRowsHtml}</tbody></table></div><div class="box"><h3>Management view</h3><h2>Leader-wise performance</h2><table><thead><tr><th>Leader</th><th>Outlets</th><th>Stock</th><th>DOS</th><th>&lt;60%</th></tr></thead><tbody>${leaderRows}</tbody></table></div></div>
  <div class="foot"><span>Page 2 of 2 · Outlet summary</span><span>Use Print / save PDF for a two-page PDF</span></div></section></body></html>`;
}
function openSummaryReport(){
  if(!DATA){alert('The dashboard data has not finished loading yet.');return}
  const w=window.open('','_blank');
  if(!w){alert('Your browser blocked the report window. Allow pop-ups for this page, then try again.');return}
  w.document.open();w.document.write(summaryReportHtml());w.document.close();
}

/* ------------------------------------------------------------------ *
 * View switching, sidebar, theme
 * ------------------------------------------------------------------ */
function applyViewMode(mode,{openFilters=false,scroll=false}={}){
  VIEW_MODE=mode==='outlet'?'outlet':'sku';localStorage.setItem('availabilityViewMode',VIEW_MODE);
  const isOutlet=VIEW_MODE==='outlet';
  const skuContent=document.getElementById('skuViewContent'), outletContent=document.getElementById('outletViewContent');
  if(skuContent)skuContent.hidden=isOutlet; if(outletContent)outletContent.hidden=!isOutlet;
  document.querySelectorAll('.view-filter-sku').forEach(el=>el.hidden=isOutlet); document.querySelectorAll('.view-filter-outlet').forEach(el=>el.hidden=!isOutlet);
  document.querySelectorAll('.view-switch-btn').forEach(btn=>{const active=btn.dataset.view===VIEW_MODE;btn.classList.toggle('active',active);btn.setAttribute('aria-selected',String(active))});
  const eyebrow=document.getElementById('viewEyebrow'), heading=document.getElementById('viewHeading'), subtitle=document.getElementById('viewSubtitle');
  if(eyebrow)eyebrow.textContent=isOutlet?'OUTLET VIEW':'SKU ANALYTICS'; if(heading)heading.textContent=isOutlet?'Outlet performance':'Type & SKU-wise availability';
  if(subtitle)subtitle.innerHTML=isOutlet?`Outlet performance · risk bands use <strong data-dos-label>${dynamicLabel()}</strong>`:`Stock availability plus dynamic <strong data-dos-label>${dynamicLabel()}</strong>`;
  updateDosLabels(); updateFilterUI(); if(openFilters)setSidebar(true); if(scroll)document.getElementById('dashboardViewHeader')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function initViewSwitcher(){document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>applyViewMode(btn.dataset.view,{scroll:true})));applyViewMode(VIEW_MODE)}
function isNarrow(){return window.matchMedia('(max-width: 1100px)').matches}
function setSidebar(open){
  document.body.classList.toggle('sidebar-open',open);
  document.getElementById('sidebarToggle')?.setAttribute('aria-expanded',String(open));
  document.getElementById('sidebar')?.setAttribute('aria-hidden',String(!open));
  // Only remember the preference on wide screens: a phone should never inherit
  // "open" from a desktop session and start with the drawer covering the page.
  if(!isNarrow())localStorage.setItem('availabilitySidebar',open?'open':'closed');
}
function initSidebar(){
  const stored=localStorage.getItem('availabilitySidebar');
  setSidebar(isNarrow()?false:stored!=='closed');
  document.getElementById('sidebarToggle').addEventListener('click',()=>setSidebar(!document.body.classList.contains('sidebar-open')));
  document.getElementById('sidebarClose').addEventListener('click',()=>{setSidebar(false);document.getElementById('sidebarToggle')?.focus()});
  document.getElementById('sidebarOverlay').addEventListener('click',()=>setSidebar(false));
  document.getElementById('openFiltersInline').addEventListener('click',()=>{setSidebar(true);document.getElementById('sidebarClose')?.focus()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isNarrow()&&document.body.classList.contains('sidebar-open')){setSidebar(false);document.getElementById('sidebarToggle')?.focus()}});
}
function applyTheme(theme){
  document.documentElement.dataset.theme=theme;localStorage.setItem('availabilityTheme',theme);
  const dark=theme==='dark';
  document.getElementById('themeIcon').textContent=dark?'☀':'☾';
  document.getElementById('themeText').textContent=dark?'Light':'Dark';
  document.getElementById('themeToggle').setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#4a070d':'#a80d18');
}
function initTheme(){const saved=localStorage.getItem('availabilityTheme');const theme=saved||((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');applyTheme(theme);document.getElementById('themeToggle').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'))}

function resetAllFilters(){
  Object.assign(TABLE_CLICK_FILTERS.sku,{type:'all',stockBand:'all',dosBand:'all',threshold:'all'});Object.assign(TABLE_CLICK_FILTERS.outlet,{stockBand:'all',dosBand:'all',threshold:'all'});saveTableClickFilters();
  ['skuOutletFilter','skuLeaderFilter','skuKviFilter','skuTypeFilter','skuCatFilter','skuL3Filter','skuStockBandFilter','skuBandFilter','skuThresholdFilter','outletSelectFilter','kviFilter','outletLeaderFilter','outletStockBandFilter','bandFilter','outletThresholdFilter'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='all'});
  ['searchInput','skuSearchInput'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});refreshSkuOutletOptions();refreshOutletSelectOptions();
  Object.values(TABLE_STATE).forEach(st=>{const i=document.getElementById(st.searchId);if(i)i.value='';st.page=1});render();
}
function clearFilter(id){
  const el=document.getElementById(id);if(!el)return;if(el.tagName==='SELECT')el.value='all';else el.value='';
  if(['skuLeaderFilter','skuKviFilter'].includes(id))refreshSkuOutletOptions();if(['outletLeaderFilter','kviFilter'].includes(id))refreshOutletSelectOptions();
  resetViewTablePages(VIEW_MODE);render();
}
function scrollToTable(id){
  setTimeout(()=>document.getElementById(id)?.closest('.panel')?.scrollIntoView({behavior:'smooth',block:'start'}),60);
}
/* Clicking a card re-renders the whole card grid, which throws away the button
   the user was standing on. Re-find the equivalent button afterwards so keyboard
   focus survives the update. */
function focusSignature(el){
  if(!el)return null;
  for(const a of ['data-kpi-filter','data-outlet-kpi-filter','data-sku-type','data-outlet-band']){
    if(el.hasAttribute(a))return `[${a}="${CSS.escape(el.getAttribute(a))}"]${el.dataset.filterValue!==undefined?`[data-filter-value="${CSS.escape(el.dataset.filterValue)}"]`:''}`;
  }
  return null;
}
function withFocusRestored(run){
  const signature=focusSignature(document.activeElement?.closest?.('[data-kpi-filter],[data-outlet-kpi-filter],[data-sku-type],[data-outlet-band]'));
  run();
  if(signature)document.querySelector(signature)?.focus({preventScroll:true});
}
function applySkuQuickFilter(kind,value){
  const f=TABLE_CLICK_FILTERS.sku;
  if(kind==='stock-band')f.stockBand=f.stockBand===value?'all':value;
  else if(kind==='dos-band')f.dosBand=f.dosBand===value?'all':value;
  else if(kind==='threshold')f.threshold=f.threshold===value?'all':value;
  else if(kind==='show-all')Object.assign(f,{type:'all',stockBand:'all',dosBand:'all',threshold:'all'});
  saveTableClickFilters();resetTablePage('skuDetailTable');withFocusRestored(renderSkuAnalytics);scrollToTable('skuDetailTable');
}
function applySkuType(type){const f=TABLE_CLICK_FILTERS.sku;f.type=f.type===type?'all':type;saveTableClickFilters();resetTablePage('skuDetailTable');withFocusRestored(renderSkuAnalytics);scrollToTable('skuDetailTable')}
function applyOutletQuickFilter(kind,value){
  const f=TABLE_CLICK_FILTERS.outlet;
  if(kind==='stock-band')f.stockBand=f.stockBand===value?'all':value;
  else if(kind==='dos-band')f.dosBand=f.dosBand===value?'all':value;
  else if(kind==='threshold')f.threshold=f.threshold===value?'all':value;
  else if(kind==='show-all')Object.assign(f,{stockBand:'all',dosBand:'all',threshold:'all'});
  saveTableClickFilters();resetTablePage('outletDetailTable');
  withFocusRestored(()=>{const rows=filteredRows();renderKPIs(rows);renderBands(rows);renderOutlets(rows);renderTableClickFilterUI()});
  scrollToTable('outletDetailTable');
}
function applyOutletBand(value){applyOutletQuickFilter('dos-band',value)}

/* ------------------------------------------------------------------ *
 * Freshness + loading state
 * ------------------------------------------------------------------ */
function setLoadState(state,{title,msg,retry=false}={}){
  const el=document.getElementById('loadState');if(!el)return;
  el.dataset.state=state;
  if(title)document.getElementById('loadStateTitle').textContent=title;
  if(msg)document.getElementById('loadStateMsg').textContent=msg;
  document.getElementById('loadStateActions').hidden=!retry;
  document.getElementById('loadProgressWrap').style.display=state==='loading'?'':'none';
}
function setLoadProgress(fraction){
  const bar=document.getElementById('loadProgress');if(!bar)return;
  bar.style.width=`${Math.max(3,Math.min(100,fraction*100)).toFixed(0)}%`;
}
function updateFreshness(){
  const pill=document.getElementById('freshnessPill');
  const strong=document.getElementById('freshnessText'),sub=document.getElementById('freshnessSub');
  const banner=document.getElementById('staleBanner'),bannerText=document.getElementById('staleBannerText');
  if(!pill||!strong||!sub)return;
  pill.classList.remove('is-stale','is-error');
  if(banner)banner.hidden=true;
  const refresh=DATA?.meta?.refresh||{};
  const label=refresh.label||'Daily · 11:30 AM BDT';
  const generated=DATA?.meta?.generated_at?new Date(DATA.meta.generated_at):null;
  if(!generated||isNaN(generated)){strong.textContent='Auto refresh';sub.textContent=label;return}
  const hours=(Date.now()-generated.getTime())/36e5;
  const limit=Number(refresh.stale_after_hours)||30;
  const ago=hours<1?`${Math.max(1,Math.round(hours*60))} min ago`:hours<48?`${Math.round(hours)} h ago`:`${Math.round(hours/24)} days ago`;
  strong.textContent=`Updated ${ago}`;
  sub.textContent=label;
  if(hours>limit){
    pill.classList.add('is-stale');
    strong.textContent=`Stale · ${ago}`;
    if(banner&&bannerText){
      banner.hidden=false;
      bannerText.textContent=` The last successful build was ${ago}, on ${dt(DATA.meta.generated_at)}. The refresh is scheduled ${label}, so a run has probably failed — check the "Refresh Availability Dashboard" workflow in GitHub Actions.`;
    }
  }
}
function applyZonePresence(){
  ZONE_PRESENT=!!(DATA?.zone_present)|| (DATA?.outlets||[]).some(r=>String(r.zone||'').trim());
  document.querySelectorAll('[data-requires-zone]').forEach(el=>{el.hidden=!ZONE_PRESENT});
  document.querySelectorAll('[data-zone-col]').forEach(el=>{el.hidden=!ZONE_PRESENT});
}

/* ------------------------------------------------------------------ *
 * Load
 * ------------------------------------------------------------------ */
async function load(){
  const reload=document.getElementById('reloadBtn');
  reload?.setAttribute('aria-busy','true');
  setLoadState('loading',{title:'Loading availability data…',msg:'Fetching the latest build. The file is large, so the first load can take a few seconds.'});
  setLoadProgress(.05);
  try{
    const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
    if(!r.ok)throw new Error(`The server returned HTTP ${r.status}.`);
    let text;
    const total=Number(r.headers.get('content-length'))||0;
    if(r.body&&total){
      const reader=r.body.getReader(),chunks=[];let received=0;
      for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.length;setLoadProgress(received/total)}
      let offset=0;const merged=new Uint8Array(received);
      for(const c of chunks){merged.set(c,offset);offset+=c.length}
      text=new TextDecoder().decode(merged);
    }else{setLoadProgress(.6);text=await r.text()}
    setLoadProgress(.94);
    DATA=JSON.parse(text);
    if(!DATA?.outlets?.length)throw new Error('The build contains no outlet rows.');
    RISK_DAY_CACHE.clear();STOCK_BITS_CACHE.clear();COVERAGE_CACHE.clear();RISK_OUTLET_LEADERS=null;REPORTING_OUTLET_META=null;
    document.getElementById('sourceFile').textContent=DATA.meta?.source_file||DATA.meta?.availability_source_file||'—';
    document.getElementById('sourceModified').textContent=dt(DATA.meta?.source_modified);
    document.getElementById('generatedAt').textContent=dt(DATA.meta?.generated_at);
    applyZonePresence();
    populateDosControl();populateSkuFilters();populateOutletFilters();render();applyViewMode(VIEW_MODE);
    updateFreshness();
    setLoadProgress(1);
    setLoadState('ready');
  }catch(e){
    document.getElementById('sourceFile').textContent='Data unavailable';
    const pill=document.getElementById('freshnessPill');
    if(pill){pill.classList.add('is-error');document.getElementById('freshnessText').textContent='Load failed';document.getElementById('freshnessSub').textContent='See message'}
    setLoadState('error',{
      title:'Could not load the dashboard data',
      msg:`${e.message} If this is a brand-new deployment, run the "Refresh Availability Dashboard" workflow in GitHub Actions once, then reload. If it was working before, the last build may still be publishing.`,
      retry:true
    });
  }finally{
    reload?.removeAttribute('aria-busy');
  }
}

/* ------------------------------------------------------------------ *
 * Bindings
 * ------------------------------------------------------------------ */
function bindGlobalFilters(){
  const renderOutlet=()=>{resetViewTablePages('outlet');render()};const renderSku=()=>{resetViewTablePages('sku');renderSkuAnalytics();updateFilterUI()};
  ['outletStockBandFilter','bandFilter','outletThresholdFilter'].forEach(id=>document.getElementById(id)?.addEventListener('change',renderOutlet));
  document.getElementById('searchInput')?.addEventListener('input',renderOutlet);
  document.getElementById('outletLeaderFilter')?.addEventListener('change',()=>{refreshOutletSelectOptions();renderOutlet()});
  document.getElementById('kviFilter')?.addEventListener('change',()=>{refreshOutletSelectOptions();renderOutlet()});
  document.getElementById('outletSelectFilter')?.addEventListener('change',renderOutlet);
  ['skuTypeFilter','skuCatFilter','skuL3Filter','skuStockBandFilter','skuBandFilter','skuThresholdFilter'].forEach(id=>document.getElementById(id)?.addEventListener('change',renderSku));
  document.getElementById('skuSearchInput')?.addEventListener('input',renderSku);
  document.getElementById('skuLeaderFilter')?.addEventListener('change',()=>{refreshSkuOutletOptions();renderSku()});
  document.getElementById('skuKviFilter')?.addEventListener('change',()=>{refreshSkuOutletOptions();renderSku()});
  document.getElementById('skuOutletFilter')?.addEventListener('change',renderSku);
}
function bindTableControls(){
  Object.entries(TABLE_STATE).forEach(([tableId,state])=>{
    const search=document.getElementById(state.searchId), rows=document.getElementById(state.rowsId);
    if(search)search.addEventListener('input',()=>{state.page=1;renderTableForSort(tableId)});
    if(rows)rows.addEventListener('change',()=>{state.page=1;renderTableForSort(tableId)});
  });
}

loadTableClickFilters();initTheme();initSidebar();initViewSwitcher();bindGlobalFilters();bindTableControls();

document.getElementById('dosDaysSelect').addEventListener('change',e=>setDosDays(e.target.value));
document.getElementById('dosDaysQuick')?.addEventListener('change',e=>setDosDays(e.target.value));
document.getElementById('dosResetBtn').addEventListener('click',()=>{try{sessionStorage.removeItem('availabilityDosDays')}catch(_){}setDosDays(Number(DATA?.dos?.default_days)||1)});
document.getElementById('reloadBtn').addEventListener('click',()=>load());
document.getElementById('loadRetryBtn')?.addEventListener('click',()=>load());
document.getElementById('resetAllFilters').addEventListener('click',()=>resetAllFilters());
document.getElementById('summaryReportBtn').addEventListener('click',openSummaryReport);

document.addEventListener('click',e=>{
  const exp=e.target.closest('[data-export]');if(exp){doExport(exp.dataset.export);return}
  const clearTable=e.target.closest('[data-clear-table-filters]');if(clearTable){clearTableClickFilters(clearTable.dataset.clearTableFilters);return}
  const chip=e.target.closest('[data-clear-filter]');if(chip){clearFilter(chip.dataset.clearFilter);return}
  const tableChip=e.target.closest('[data-clear-table-filter]');if(tableChip){const [view,key]=tableChip.dataset.clearTableFilter.split(':');clearOneTableClickFilter(view,key);return}
  const kpi=e.target.closest('[data-kpi-filter]');if(kpi){applySkuQuickFilter(kpi.dataset.kpiFilter,kpi.dataset.filterValue);return}
  const outletKpi=e.target.closest('[data-outlet-kpi-filter]');if(outletKpi){applyOutletQuickFilter(outletKpi.dataset.outletKpiFilter,outletKpi.dataset.filterValue);return}
  const outletBand=e.target.closest('[data-outlet-band]');if(outletBand){applyOutletBand(outletBand.dataset.outletBand);return}
  const type=e.target.closest('[data-sku-type]');if(type){applySkuType(type.dataset.skuType);return}
  const pager=e.target.closest('[data-page-action]');if(pager){const id=pager.dataset.tableId,state=TABLE_STATE[id];if(state){state.page+=pager.dataset.pageAction==='next'?1:-1;renderTableForSort(id)}return}
  const th=e.target.closest('th[data-sort-key]'); if(th){const table=th.closest('table');if(!table?.id)return;const id=table.id,key=th.dataset.sortKey,type=th.dataset.sortType||'text';const prev=SORT_STATE[id]||{};SORT_STATE[id]={key,dir:prev.key===key&&prev.dir==='asc'?'desc':'asc',type};if(TABLE_STATE[id])TABLE_STATE[id].page=1;renderTableForSort(id);return}
  const tr=e.target.closest('.excel-table tbody tr');if(tr&&!tr.querySelector('.empty')){tr.closest('tbody').querySelectorAll('tr.selected-row').forEach(x=>x.classList.remove('selected-row'));tr.classList.add('selected-row')}
});
document.addEventListener('keydown',e=>{
  if((e.key==='Enter'||e.key===' ')&&e.target.matches('th[data-sort-key]')){e.preventDefault();e.target.click()}
});

load();
