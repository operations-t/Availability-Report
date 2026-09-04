import { calculateSlot, calculateEcomSlot, pct, classLabel } from "./calc.js";

const OUTLET_DIMS=["zone","rho","zonal","division","district","outlet","storeType","locationType","outletType","kviOutlet"];
const SKU_DIMS=["sku","category","category3","classification"];

export const OUTLET_BANDS=[
  {key:"91-100",label:"91%-100%",min:91,max:100,tone:"band-excellent"},
  {key:"81-90",label:"81%-90%",min:81,max:90,tone:"band-good"},
  {key:"71-80",label:"71%-80%",min:71,max:80,tone:"band-watch"},
  {key:"61-70",label:"61%-70%",min:61,max:70,tone:"band-risk"},
  {key:"below-60",label:"Below 60%",min:0,max:60,tone:"band-critical"}
];

export function outletAvailabilityBand(value){
  const rounded=Math.max(0,Math.min(100,Math.round(Number(value)||0)));
  if(rounded>=91)return OUTLET_BANDS[0];
  if(rounded>=81)return OUTLET_BANDS[1];
  if(rounded>=71)return OUTLET_BANDS[2];
  if(rounded>=61)return OUTLET_BANDS[3];
  return OUTLET_BANDS[4];
}

function setHas(set,v){return !set||set.size===0||set.has(v);}
function skuClassMatch(sku,set){
  if(!set||set.size===0)return true;
  return (set.has("Core")&&sku.core)||(set.has("KVI")&&sku.kvi)||(set.has("Promo")&&sku.promo);
}
export function defaultFilters(){
  return {
    zone:new Set(),rho:new Set(),zonal:new Set(),division:new Set(),district:new Set(),outlet:new Set(),storeType:new Set(),locationType:new Set(),outletType:new Set(),kviOutlet:new Set(),
    sku:new Set(),category:new Set(),category3:new Set(),classification:new Set(),status:new Set(),requiredDOS:2,requiredEcomStock:5
  };
}

function outletTypeHas(set,isKvi,isEcom){
  if(!set||set.size===0)return true;
  return (set.has("KVI")&&isKvi)||(set.has("Non-KVI")&&!isKvi)||(set.has("E-COM Outlet")&&isEcom);
}
export class Engine{
  constructor(model){this.m=model;this.filters=defaultFilters();this.cache=new Map();this.version=0;}
  setFilters(filters){this.filters=filters;this.version++;this.cache.clear();}

  outletMatch(o,f=this.filters,exclude){
    return (exclude==="zone"||setHas(f.zone,o.zone))&&
      (exclude==="rho"||setHas(f.rho,o.rho))&&
      (exclude==="zonal"||setHas(f.zonal,o.zonal))&&
      (exclude==="division"||setHas(f.division,o.division))&&
      (exclude==="district"||setHas(f.district,o.district))&&
      (exclude==="outlet"||setHas(f.outlet,o.code))&&
      (exclude==="storeType"||setHas(f.storeType,o.storeType))&&
      (exclude==="locationType"||setHas(f.locationType,o.locationType))&&
      (exclude==="outletType"||outletTypeHas(f.outletType,!!o.kvi,!!o.ecom))&&
      (exclude==="kviOutlet"||setHas(f.kviOutlet,o.code));
  }
  skuMatch(s,f=this.filters,exclude,forcedClass){
    const base=(exclude==="sku"||setHas(f.sku,s.code))&&
      (exclude==="category"||setHas(f.category,s.category))&&
      (exclude==="category3"||setHas(f.category3,s.category3))&&
      (exclude==="classification"||skuClassMatch(s,f.classification));
    if(!base)return false;
    if(forcedClass&&!s[forcedClass])return false;
    return true;
  }
  outletIndices(f=this.filters,exclude){const a=[];for(let i=0;i<this.m.outlets.length;i++)if(this.outletMatch(this.m.outlets[i],f,exclude))a.push(i);return a;}
  skuIndices(f=this.filters,exclude,forcedClass){const a=[];for(let i=0;i<this.m.skus.length;i++)if(this.skuMatch(this.m.skus[i],f,exclude,forcedClass))a.push(i);return a;}
  slot(oi,si,requiredDOS=this.filters.requiredDOS){
    const k=oi*this.m.skuCount+si;
    if(this.m.kind==="ecom")return calculateEcomSlot(this.m.stock[k],this.m.sales[k],this.filters.requiredEcomStock,!!this.m.stockPresent[k],!!this.m.salesPresent[k]);
    return calculateSlot(this.m.stock[k],this.m.sales[k],requiredDOS,!!this.m.stockPresent[k],!!this.m.salesPresent[k]);
  }
  *slots({filters=this.filters,forcedClass=null,ignoreStatus=false}={}){
    const os=this.outletIndices(filters),ss=this.skuIndices(filters,null,forcedClass);
    for(const oi of os){
      const outlet=this.m.outlets[oi];
      for(const si of ss){
        const sku=this.m.skus[si],calc=this.slot(oi,si,filters.requiredDOS);
        if(!ignoreStatus&&!setHas(filters.status,calc.status))continue;
        yield{oi,si,outlet,sku,...calc,classLabel:classLabel(sku)};
      }
    }
  }
  /**
   * Materializes this.slots({forcedClass}) into a real array exactly
   * once per (forcedClass, filter state), cached by this.version --
   * the same cache-key pattern every other aggregation method already
   * uses. summary()/groupBy()/productHierarchySummary()/detailPage()/
   * topExceptions() all used to independently call this.slots() and
   * fully re-walk the entire filtered outlet x SKU universe from
   * scratch on every call, even within the same render. On
   * production-scale data (hundreds of thousands of slots) that meant
   * 5+ full re-iterations per page render -- millions of calculateSlot()
   * calls -- which is what actually froze the page, not the number of
   * DOM rows rendered afterward. This method lets every one of those
   * consumers share a single pass instead.
   *
   * Only safe for the default filters/ignoreStatus=false call shape;
   * optionValues('status') deliberately uses different filters and
   * ignoreStatus:true and must keep calling this.slots() directly.
   */
  materializedSlots(forcedClass=null){
    const key=`materialized-slots:${forcedClass||"all"}:${this.version}`;
    if(this.cache.has(key))return this.cache.get(key);
    // Slots with no source record on either side are NOT scored: they
    // are excluded from every availability denominator rather than
    // counted as failures, mirroring the Ecom coverage rule. A partial
    // source extract must never manufacture fake unavailability.
    // notCoveredCount is cached alongside so the exclusion can be
    // disclosed in the UI instead of silently shrinking the universe.
    const all=[...this.slots({forcedClass})];
    const arr=all.filter(x=>x.scored!==false);
    arr.notCoveredCount=all.length-arr.length;
    this.cache.set(key,arr);
    return arr;
  }

  summary(forcedClass=null){
    const key=`summary:${forcedClass||"all"}:${this.version}`;if(this.cache.has(key))return this.cache.get(key);
    let total=0,available=0,shortfall=0,dosSum=0,dosN=0,missingStock=0,missingSales=0;
    const status=this.m.kind==="ecom"?{"Sufficient Stock":0,"Below Threshold":0}:{OOS:0,Low:0,"At Risk":0,Healthy:0,"No Sales":0};
    const slots=this.materializedSlots(forcedClass);
    for(const x of slots){
      total++;if(x.available)available++;shortfall+=x.shortfall;status[x.status]=(status[x.status]||0)+1;
      if(x.dos!==null&&Number.isFinite(x.dos)){dosSum+=x.dos;dosN++;}
      if(!x.stockPresent)missingStock++;if(!x.salesPresent)missingSales++;
    }
    const out={total,available,unavailable:total-available,availability:pct(available,total),shortfall,status,avgDOS:dosN?dosSum/dosN:null,missingStock,missingSales,notCovered:slots.notCoveredCount||0};
    this.cache.set(key,out);return out;
  }
  /**
   * KVI Availability KPI (change log Section 8): always scoped to
   * outlets present in the KVI Outlet mapping, regardless of the user's
   * Outlet Type / KVI Outlet filter selections -- those two filters
   * apply to every other card and table, not to this one, per the
   * change log's KVI Outlet.xlsx -> Outlet Mapping -> KVI Classification
   * -> KVI Availability Calculation flow.
   */
  /**
   * Runs fn() with the engine's filters temporarily forced into
   * KVI-outlet scope (outletType/kviOutlet cleared, every other active
   * filter preserved), then restores the real filters afterward. Shared
   * by kviSummary() and the KVI-scoped band/group methods below so the
   * "always KVI outlets only" rule lives in one place.
   */
  withKviOutletScope(fn){
    const real=this.filters;
    this.filters={...real,outletType:new Set(),kviOutlet:new Set()};
    this.version++;this.cache.clear();
    try{
      const kviOutlets=new Set(this.m.outlets.filter(o=>o.kvi).map(o=>o.code));
      this.filters={...this.filters,outlet:this.filters.outlet.size?new Set([...this.filters.outlet].filter(c=>kviOutlets.has(c))):kviOutlets};
      this.version++;this.cache.clear();
      return fn();
    }finally{
      this.filters=real;this.version++;this.cache.clear();
    }
  }
  kviOutletBandDistribution(){return this.withKviOutletScope(()=>this.outletBandDistribution("kvi"));}
  kviSkuBandDistribution(){return this.withKviOutletScope(()=>this.skuBandDistribution("kvi"));}
  kviSummary(){
    const key=`kvi-summary:${this.version}`;if(this.cache.has(key))return this.cache.get(key);
    // Always KVI-outlet-scoped (change log Section 8): ignore the user's
    // outletType/kviOutlet selections here specifically, since those two
    // filters apply to every other card/table, not this one. Every other
    // active filter (zone, district, category, etc.) still applies.
    const f={...this.filters,outletType:new Set(),kviOutlet:new Set()};
    let total=0,available=0,shortfall=0,dosSum=0,dosN=0,missingStock=0,missingSales=0;
    const status={OOS:0,Low:0,"At Risk":0,Healthy:0,"No Sales":0};
    const os=this.outletIndices(f).filter(oi=>this.m.outlets[oi].kvi);
    const ss=this.skuIndices(f,null,"kvi");
    for(const oi of os){
      for(const si of ss){
        const calc=this.slot(oi,si,f.requiredDOS);
        if(!setHas(f.status,calc.status))continue;
        total++;if(calc.available)available++;shortfall+=calc.shortfall;status[calc.status]=(status[calc.status]||0)+1;
        if(calc.dos!==null&&Number.isFinite(calc.dos)){dosSum+=calc.dos;dosN++;}
        if(!calc.stockPresent)missingStock++;if(!calc.salesPresent)missingSales++;
      }
    }
    const out={total,available,unavailable:total-available,availability:pct(available,total),shortfall,status,avgDOS:dosN?dosSum/dosN:null,missingStock,missingSales};
    this.cache.set(key,out);return out;
  }
  classificationSummaries(){return{core:this.summary("core"),kvi:this.kviSummary(),promo:this.summary("promo")};}

  optionValues(dim){
    const vals=new Map();
    if(dim==="outletType"){
      for(const o of this.m.outlets){
        if(!this.outletMatch(o,this.filters,dim))continue;
        vals.set(o.kvi?"KVI":"Non-KVI",o.kvi?"KVI":"Non-KVI");
        if(o.ecom)vals.set("E-COM Outlet","E-COM Outlet");
      }
    }else if(dim==="kviOutlet"){
      for(const o of this.m.outlets){
        if(!o.kvi)continue;
        if(!this.outletMatch(o,this.filters,dim))continue;
        vals.set(o.code,`${o.code} · ${o.name}`);
      }
    }else if(OUTLET_DIMS.includes(dim)){
      for(const o of this.m.outlets){
        if(!this.outletMatch(o,this.filters,dim))continue;
        const v=dim==="outlet"?o.code:o[dim];if(!v)continue;
        vals.set(v,dim==="outlet"?`${o.code} · ${o.name}`:v);
      }
    }else if(SKU_DIMS.includes(dim)){
      for(const s of this.m.skus){
        if(!this.skuMatch(s,this.filters,dim))continue;
        if(dim==="classification"){
          if(s.core)vals.set("Core","Core");if(s.kvi)vals.set("KVI","KVI");if(s.promo)vals.set("Promo","Promo");
        }else{
          const v=dim==="sku"?s.code:s[dim];if(v)vals.set(v,dim==="sku"?`${s.code} · ${s.name}`:v);
        }
      }
    }else if(dim==="status"){
      const f={...this.filters,status:new Set()};
      for(const x of this.slots({filters:f,ignoreStatus:true}))vals.set(x.status,x.status);
    }
    return [...vals].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label));
  }

  groupBy(kind,forcedClass=null){
    const key=`group:${kind}:${forcedClass||"all"}:${this.version}`;if(this.cache.has(key))return this.cache.get(key);
    const statusKeys=this.m.kind==="ecom"?{"Sufficient Stock":0,"Below Threshold":0}:{OOS:0,Low:0,"At Risk":0,Healthy:0,"No Sales":0};
    const map=new Map();
    for(const x of this.materializedSlots(forcedClass)){
      let id,label,meta={};
      if(kind==="outlet"){
        id=x.outlet.code;label=`${x.outlet.code} · ${x.outlet.name}`;meta=x.outlet;
      }else if(kind==="sku"){
        id=x.sku.code;label=`${x.sku.code} · ${x.sku.name}`;meta=x.sku;
      }else if(["zone","rho","zonal","division","district","storeType","locationType"].includes(kind)){
        const raw=x.outlet[kind];id=raw||`(Blank ${kind})`;label=id;meta={[kind]:id};
      }else if(kind==="category"||kind==="category3"){
        const raw=x.sku[kind];id=raw||`(Blank ${kind})`;label=id;meta={[kind]:id};
      }else{
        throw new Error(`Unsupported grouping: ${kind}`);
      }
      let g=map.get(id);
      if(!g){g={id,label,meta,total:0,available:0,shortfall:0,...statusKeys,skuIds:new Set(),outletIds:new Set()};map.set(id,g);}
      g.total++;if(x.available)g.available++;g.shortfall+=x.shortfall;g[x.status]++;g.skuIds.add(x.sku.code);g.outletIds.add(x.outlet.code);
    }
    const arr=[...map.values()].map(g=>({...g,skuCount:g.skuIds.size,outletCount:g.outletIds.size,unavailable:g.total-g.available,availability:pct(g.available,g.total)}));
    arr.sort((a,b)=>a.availability-b.availability||b.shortfall-a.shortfall||String(a.label).localeCompare(String(b.label)));
    this.cache.set(key,arr);return arr;
  }

  outletBandDistribution(forcedClass=null){
    const key=`outlet-bands:${forcedClass||"all"}:${this.version}`;if(this.cache.has(key))return this.cache.get(key);
    const counts=Object.fromEntries(OUTLET_BANDS.map(b=>[b.key,0]));
    const outlets=this.groupBy("outlet",forcedClass).map(g=>{const band=outletAvailabilityBand(g.availability);counts[band.key]++;return{...g,band};});
    const total=outlets.length,bands=OUTLET_BANDS.map(b=>({...b,count:counts[b.key],share:pct(counts[b.key],total)}));
    const out={total,bands,outlets};this.cache.set(key,out);return out;
  }
  skuBandDistribution(forcedClass=null){
    const key=`sku-bands:${forcedClass||"all"}:${this.version}`;if(this.cache.has(key))return this.cache.get(key);
    const counts=Object.fromEntries(OUTLET_BANDS.map(b=>[b.key,0]));
    const skus=this.groupBy("sku",forcedClass).map(g=>{const band=outletAvailabilityBand(g.availability);counts[band.key]++;return{...g,band};});
    const total=skus.length,bands=OUTLET_BANDS.map(b=>({...b,count:counts[b.key],share:pct(counts[b.key],total)}));
    const out={total,bands,skus};this.cache.set(key,out);return out;
  }
  skuUnavailability(limit=null,forcedClass=null){
    const key=`sku-unavailability:${limit??"all"}:${forcedClass||"all"}:${this.version}`;if(this.cache.has(key))return this.cache.get(key);
    const rows=this.groupBy("sku",forcedClass).map(g=>({...g,band:outletAvailabilityBand(g.availability)})).sort((a,b)=>b.unavailable-a.unavailable||a.availability-b.availability||b.shortfall-a.shortfall);
    const out=limit==null?rows:rows.slice(0,limit);this.cache.set(key,out);return out;
  }

  productHierarchySummary(level="category",forcedClass=null){
    const key=`hierarchy:${level}:${forcedClass||"all"}:${this.version}`;if(this.cache.has(key))return this.cache.get(key);
    const map=new Map();
    for(const x of this.materializedSlots(forcedClass)){
      const raw=level==="category3"?x.sku.category3:x.sku.category;
      const id=raw||`(Blank ${level==="category3"?"CAT3":"Division"})`;
      let g=map.get(id);
      if(!g){g={id,label:id,total:0,available:0,shortfall:0,skuIds:new Set(),outlets:new Map()};map.set(id,g);}
      g.total++;if(x.available)g.available++;g.shortfall+=x.shortfall;g.skuIds.add(x.sku.code);
      let o=g.outlets.get(x.outlet.code);if(!o){o={total:0,available:0};g.outlets.set(x.outlet.code,o);}o.total++;if(x.available)o.available++;
    }
    const rows=[...map.values()].map(g=>{
      const bandCounts=Object.fromEntries(OUTLET_BANDS.map(b=>[b.key,0]));
      for(const o of g.outlets.values()){const b=outletAvailabilityBand(pct(o.available,o.total));bandCounts[b.key]++;}
      return{id:g.id,label:g.label,total:g.total,available:g.available,unavailable:g.total-g.available,availability:pct(g.available,g.total),shortfall:g.shortfall,skuCount:g.skuIds.size,outletCount:g.outlets.size,bandCounts};
    });
    rows.sort((a,b)=>a.availability-b.availability||b.unavailable-a.unavailable||a.label.localeCompare(b.label));
    this.cache.set(key,rows);return rows;
  }

  detailPage(page=1,pageSize=50,forcedClass=null){
    const start=(page-1)*pageSize,rows=[];let total=0;
    for(const x of this.materializedSlots(forcedClass)){if(total>=start&&rows.length<pageSize)rows.push(x);total++;}
    return{rows,total,page,pageSize,pages:Math.max(1,Math.ceil(total/pageSize))};
  }
  topExceptions(limit=null,forcedClass=null){
    const key=`exceptions:${limit??"all"}:${forcedClass||"all"}:${this.version}`;if(this.cache.has(key))return this.cache.get(key);
    const rank=this.m.kind==="ecom"?{"Below Threshold":2,"Sufficient Stock":1}:{OOS:5,Low:4,"At Risk":3,"No Sales":2,Healthy:1};
    const top=this.materializedSlots(forcedClass).filter(x=>!x.available);
    top.sort((a,b)=>(rank[b.status]-rank[a.status])||b.shortfall-a.shortfall);if(Number.isFinite(limit))top.length=Math.min(limit,top.length);this.cache.set(key,top);return top;
  }
  drillOutlet(code){const f={...this.filters,outlet:new Set([code])},old=this.filters;this.filters=f;this.version++;this.cache.clear();const summary=this.summary(),exceptions=this.topExceptions(100);this.filters=old;this.version++;this.cache.clear();return{summary,exceptions};}
  drillSku(code){const f={...this.filters,sku:new Set([code])},old=this.filters;this.filters=f;this.version++;this.cache.clear();const summary=this.summary(),exceptions=this.topExceptions(100);this.filters=old;this.version++;this.cache.clear();return{summary,exceptions};}
}
