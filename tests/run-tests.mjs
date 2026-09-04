import assert from 'node:assert/strict';
import { calculateSlot } from '../public/js/calc.js';
import { Engine, outletAvailabilityBand } from '../public/js/engine.js';
import { kpi } from '../public/js/ui.js';
import { buildReportData } from '../public/js/pdf-export.js';
import { renderClass, renderExceptions, renderOutletView, renderSkuView } from '../public/js/views.js';

function testCalculations(){
  let x=calculateSlot(0,0,2,true,true);
  assert.equal(x.dos,null); assert.equal(x.status,'No Sales'); assert.equal(x.available,false);
  x=calculateSlot(0,30,2,true,true);
  assert.equal(x.ads,1); assert.equal(x.dos,0); assert.equal(x.status,'OOS'); assert.equal(x.shortfall,2);
  x=calculateSlot(.5,30,2,true,true); assert.equal(x.status,'Low');
  x=calculateSlot(1.5,30,2,true,true); assert.equal(x.status,'At Risk');
  x=calculateSlot(3,30,2,true,true); assert.equal(x.status,'Healthy'); assert.equal(x.available,true);
}

function testCalculationAuditFixes(){
  // 1. Status must never contradict availability. At requiredDOS=2 a
  // slot with DOS exactly 2 is available, so it must read Healthy --
  // it used to read "At Risk" while being counted available.
  let x=calculateSlot(2,30,2);
  assert.equal(x.available,true);
  assert.equal(x.status,'Healthy','a slot counted available must never show a warning status');

  // 2. Status thresholds must SCALE with requiredDOS. DOS 5 is healthy
  // at requiredDOS=2 but must not read "Healthy" at requiredDOS=7,
  // where the same slot is unavailable.
  assert.equal(calculateSlot(5,30,2).status,'Healthy');
  const strict=calculateSlot(5,30,7);
  assert.equal(strict.available,false);
  assert.notEqual(strict.status,'Healthy','status must not say Healthy on a slot that is unavailable at the selected Required DOS');

  // 3. Stock on the shelf with zero sales is AVAILABLE (slow mover,
  // not an availability failure), but keeps the No Sales status so it
  // stays identifiable.
  const slowMover=calculateSlot(10000,0,2);
  assert.equal(slowMover.available,true,'stock present with no sales must count as available');
  assert.equal(slowMover.status,'No Sales');
  assert.equal(slowMover.shortfall,0);
  // ...but zero stock with zero sales is still genuinely unavailable.
  const empty=calculateSlot(0,0,2);
  assert.equal(empty.available,false);
  assert.ok(empty.shortfall>0,'an empty No-Sales slot must report a real shortfall, not 0');

  // 4. Negative stock must not produce a negative DOS.
  const neg=calculateSlot(-5,30,2);
  assert.equal(neg.stock,0,'negative stock is clamped to 0');
  assert.ok(neg.dos>=0,'DOS must never be negative');
  assert.equal(neg.status,'OOS');

  // 5. A slot with no source record on either side is not scored.
  const unscored=calculateSlot(null,null,2,false,false);
  assert.equal(unscored.scored,false,'a slot with no stock record and no sales record must not be scored');
  const partial=calculateSlot(8,null,2,true,false);
  assert.equal(partial.scored,true,'a slot with a stock record IS scored even if the sales record is absent');
  assert.equal(partial.available,true,'8 units on hand with no sales record is available');
}

function testUnscoredSlotsExcludedFromDenominator(){
  // Unscored slots must be excluded from availability denominators
  // rather than counted as failures -- the same coverage principle the
  // Ecom universe already uses. 2 outlets x 2 SKUs: 2 slots fully
  // covered and available, 2 slots with no source record at all.
  const outlets=[
    {code:'O1',name:'O1',zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L'},
    {code:'O2',name:'O2',zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L'}
  ];
  const skus=[
    {code:'S1',name:'S1',category:'C',category3:'C3',core:true,kvi:false,promo:false},
    {code:'S2',name:'S2',category:'C',category3:'C3',core:true,kvi:false,promo:false}
  ];
  // slot order: (O1,S1) (O1,S2) (O2,S1) (O2,S2)
  const stock=new Float64Array([10,10,0,0]);
  const sales=new Float64Array([30,30,0,0]);
  // O2's two slots have NO source record on either side.
  const stockPresent=new Uint8Array([1,1,0,0]);
  const salesPresent=new Uint8Array([1,1,0,0]);
  const model={outlets,skus,outletCount:2,skuCount:2,slotCount:4,stock,sales,stockPresent,salesPresent};

  const e=new Engine(model);
  e.filters.requiredDOS=2;e.setFilters(e.filters);
  const s=e.summary();

  assert.equal(s.total,2,'only the 2 covered slots may enter the denominator, not all 4');
  assert.equal(s.available,2);
  assert.equal(s.availability,100,'2 covered slots both available = 100%, NOT 50% -- missing source data must not manufacture unavailability');
  assert.equal(s.notCovered,2,'the 2 excluded slots must be disclosed, not silently dropped');
}

function syntheticModel(){
  const outlets=[100,90,80,70,60].map((pct,i)=>({code:`O${i+1}`,name:`Outlet ${i+1}`,zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L',targetPct:pct}));
  const skus=Array.from({length:10},(_,i)=>({code:`S${i+1}`,name:`SKU ${i+1}`,category:'C',category3:'C3',core:true,kvi:i<5,promo:i<2}));
  const slotCount=outlets.length*skus.length;
  const stock=new Float64Array(slotCount),sales=new Float64Array(slotCount),stockPresent=new Uint8Array(slotCount),salesPresent=new Uint8Array(slotCount);
  for(let oi=0;oi<outlets.length;oi++){
    const availableCount=outlets[oi].targetPct/10;
    for(let si=0;si<skus.length;si++){
      const k=oi*skus.length+si; sales[k]=30; stock[k]=si<availableCount?2:1; stockPresent[k]=1; salesPresent[k]=1;
    }
  }
  return {outlets,skus,outletCount:outlets.length,skuCount:skus.length,slotCount,stock,sales,stockPresent,salesPresent};
}

function testOutletBands(){
  assert.equal(outletAvailabilityBand(100).label,'91%-100%');
  assert.equal(outletAvailabilityBand(90).label,'81%-90%');
  assert.equal(outletAvailabilityBand(80).label,'71%-80%');
  assert.equal(outletAvailabilityBand(70).label,'61%-70%');
  assert.equal(outletAvailabilityBand(60).label,'Below 60%');
  assert.equal(outletAvailabilityBand(90.6).label,'91%-100%');

  const engine=new Engine(syntheticModel());
  engine.filters.requiredDOS=2; engine.setFilters(engine.filters);
  const d=engine.outletBandDistribution();
  assert.equal(d.total,5);
  assert.deepEqual(Object.fromEntries(d.bands.map(b=>[b.label,b.count])),{
    '91%-100%':1,'81%-90%':1,'71%-80%':1,'61%-70%':1,'Below 60%':1
  });

  engine.filters.outlet=new Set(['O1','O2']); engine.setFilters(engine.filters);
  const filtered=engine.outletBandDistribution();
  assert.equal(filtered.total,2);
  assert.equal(filtered.bands.find(b=>b.label==='91%-100%').count,1);
  assert.equal(filtered.bands.find(b=>b.label==='81%-90%').count,1);

  engine.filters.outlet=new Set(); engine.filters.requiredDOS=3; engine.setFilters(engine.filters);
  const changed=engine.outletBandDistribution();
  assert.equal(changed.bands.find(b=>b.label==='Below 60%').count,5);
}

function testSkuAndHierarchyAnalytics(){
  const engine=new Engine(syntheticModel());
  engine.filters.requiredDOS=2; engine.setFilters(engine.filters);
  const skuBands=engine.skuBandDistribution();
  assert.equal(skuBands.total,10);
  assert.equal(skuBands.bands.find(b=>b.label==='91%-100%').count,6);
  assert.equal(skuBands.bands.find(b=>b.label==='71%-80%').count,1);
  assert.equal(skuBands.bands.find(b=>b.label==='Below 60%').count,3);

  const skuUnavail=engine.skuUnavailability();
  assert.equal(skuUnavail[0].id,'S10');
  assert.equal(skuUnavail[0].unavailable,4);

  const division=engine.productHierarchySummary('category');
  assert.equal(division.length,1);
  assert.equal(division[0].skuCount,10);
  assert.deepEqual(division[0].bandCounts,{'91-100':1,'81-90':1,'71-80':1,'61-70':1,'below-60':1});
  assert.equal(engine.groupBy('rho')[0].label,'R');
  assert.equal(engine.groupBy('zonal')[0].label,'ZN');
}

function testEcomEngineBehavior(){
  // Mirrors the shape scripts/model.py's build_ecom_submodel() produces:
  // 2 outlets x 2 covered SKUs. Stock values deliberately span both
  // sides of the default 5-unit threshold, with sales values that would
  // give very different results under the OLD DOS-based rule -- proving
  // availability now depends only on stock, not sales/DOS.
  const ecomModel={
    outlets:[
      {code:'O1',name:'Outlet 1',zone:'Z',rho:'R',zonal:'ZN',division:'Geo',district:'Dist',storeType:'F',locationType:'Type',ecom:true},
      {code:'O2',name:'Outlet 2',zone:'Z',rho:'R',zonal:'ZN',division:'Geo',district:'Dist',storeType:'F',locationType:'Type',ecom:true}
    ],
    skus:[
      {code:'1001',name:'A',category:'D',category3:'C3',core:true,kvi:false,promo:false,ecom:true,fm:true},
      {code:'1002',name:'B',category:'D',category3:'C3',core:false,kvi:false,promo:true,ecom:true,fm:false}
    ],
    outletCount:2,skuCount:2,slotCount:4,
    // slot order: (O1,1001) (O1,1002) (O2,1001) (O2,1002)
    stock:new Float64Array([10,4,5,0]),          // >=5, <5, ==5 (boundary), <5
    sales:new Float64Array([0,300,0,300]),       // huge sales on the low-stock slots -- would look "Healthy"/low-DOS-available under the old rule
    stockPresent:new Uint8Array([1,1,1,1]),
    salesPresent:new Uint8Array([1,1,1,1]),
    kind:'ecom'
  };
  const e=new Engine(ecomModel);e.setFilters(e.filters); // default requiredEcomStock=5

  const s=e.summary();
  assert.equal(s.total,4);
  assert.equal(s.available,2,'only the two slots with stock>=5 should be available, regardless of sales');
  assert.equal(Number(s.availability.toFixed(1)),50.0);

  // Per-slot check: high sales must NOT make a low-stock slot available.
  const slots=[...e.slots()];
  const highSalesLowStock=slots.find(x=>x.stock===4);
  assert.ok(highSalesLowStock,'expected to find the stock=4 slot');
  assert.equal(highSalesLowStock.available,false,'stock=4 must be unavailable even with heavy sales');
  assert.equal(highSalesLowStock.status,'Below Threshold');
  const sufficientStock=slots.find(x=>x.stock===10);
  assert.equal(sufficientStock.available,true);
  assert.equal(sufficientStock.status,'Sufficient Stock');

  // Boundary: stock exactly equal to the threshold counts as available.
  const boundary=slots.find(x=>x.stock===5);
  assert.equal(boundary.available,true,'stock exactly at the threshold must be available');

  // The threshold must be adjustable, independent of requiredDOS.
  e.filters.requiredEcomStock=3;e.setFilters(e.filters);
  assert.equal(e.summary().available,3,'lowering the threshold to 3 should make the stock=4 slot available too (stock=0 stays unavailable)');

  e.filters.requiredEcomStock=11;e.setFilters(e.filters);
  assert.equal(e.summary().available,0,'raising the threshold above every slot\'s stock should make all 4 unavailable');

  // Changing requiredDOS must have zero effect on the Ecom engine.
  e.filters.requiredEcomStock=5;e.filters.requiredDOS=99;e.setFilters(e.filters);
  assert.equal(e.summary().available,2,'requiredDOS must not affect Ecom availability at all');
}

function testMainEngineUnaffectedByEcomRule(){
  // The main (non-ecom) dashboard must keep using calculateSlot's
  // DOS-based rule exactly as before -- the new Ecom stock-threshold
  // rule must not leak into main-model calculations.
  const model=syntheticModel();
  const e=new Engine(model);
  e.filters.requiredDOS=2;e.setFilters(e.filters);
  const withDos2=e.summary().available;
  e.filters.requiredDOS=99;e.setFilters(e.filters);
  const withDos99=e.summary().available;
  assert.notEqual(withDos2,withDos99,'the main engine must still be sensitive to requiredDOS (kind is not ecom)');
}

function testEcomStatusTallyingNoNaN(){
  // Regression test: groupBy()/summary() used to hardcode the main
  // dashboard's 5 status keys (OOS/Low/At Risk/Healthy/No Sales) into
  // every group's accumulator, then did g[x.status]++ unconditionally.
  // For Ecom's new "Sufficient Stock"/"Below Threshold" statuses, that
  // produced NaN (incrementing an undefined property) instead of a
  // real count, and the pre-seeded main-dashboard keys stayed stuck at
  // 0 forever. This proves both summary() and groupBy() now tally the
  // correct Ecom-specific status keys with real numbers, no NaN.
  const ecomModel={
    outlets:[
      {code:'O1',name:'Outlet 1',zone:'Z',rho:'R',zonal:'ZN',division:'Geo',district:'Dist',storeType:'F',locationType:'Type',ecom:true},
      {code:'O2',name:'Outlet 2',zone:'Z',rho:'R',zonal:'ZN',division:'Geo',district:'Dist',storeType:'F',locationType:'Type',ecom:true}
    ],
    skus:[{code:'1001',name:'A',category:'D',category3:'C3',core:true,kvi:false,promo:false,ecom:true,fm:false}],
    outletCount:2,skuCount:1,slotCount:2,
    stock:new Float64Array([10,2]),sales:new Float64Array([0,0]),
    stockPresent:new Uint8Array([1,1]),salesPresent:new Uint8Array([1,1]),
    kind:'ecom'
  };
  const e=new Engine(ecomModel);e.setFilters(e.filters);

  const s=e.summary();
  assert.equal(s.status['Sufficient Stock'],1,'summary() must count the stock=10 slot as Sufficient Stock, not leave it as NaN');
  assert.equal(s.status['Below Threshold'],1,'summary() must count the stock=2 slot as Below Threshold, not leave it as NaN');
  assert.ok(!Number.isNaN(s.status['Sufficient Stock'])&&!Number.isNaN(s.status['Below Threshold']));
  assert.equal(s.status.OOS,undefined,'Ecom summary() must not carry stale main-dashboard status keys like OOS');

  const skuGroups=e.groupBy('sku');
  assert.equal(skuGroups.length,1);
  const g=skuGroups[0];
  assert.equal(g['Sufficient Stock'],1);
  assert.equal(g['Below Threshold'],1);
  assert.ok(!Number.isNaN(g['Sufficient Stock'])&&!Number.isNaN(g['Below Threshold']));
  assert.equal(g.OOS,undefined,'Ecom groupBy() rows must not carry stale main-dashboard status keys like OOS');

  // Same check for groupBy('outlet') -- used by the "Outlet Wise
  // Availability for Ecom" table. O1 (stock=10) is Sufficient Stock,
  // O2 (stock=2) is Below Threshold; each outlet group has exactly 1
  // scored slot (1 SKU), so each status key should show 1, not NaN.
  const outletGroups=e.groupBy('outlet');
  assert.equal(outletGroups.length,2);
  for(const og of outletGroups){
    assert.ok(!Number.isNaN(og['Sufficient Stock'])&&!Number.isNaN(og['Below Threshold']),`outlet ${og.id} must not have NaN status counts`);
    assert.equal(og.OOS,undefined,'Ecom outlet groupBy() rows must not carry stale main-dashboard status keys like OOS');
    assert.equal(og['Sufficient Stock']+og['Below Threshold'],1,'each outlet group has exactly 1 scored slot, split between the two Ecom status keys');
  }

  // Regression: topExceptions() used to rank status via a hardcoded
  // main-dashboard rank table, producing NaN comparisons (broken sort
  // order, not a crash) for Ecom's unrecognized status strings. With 3+
  // unavailable slots this must sort by shortfall without throwing and
  // without leaving them in insertion order due to NaN comparisons.
  const biggerEcomModel={
    outlets:[
      {code:'O1',name:'O1',zone:'Z',rho:'R',zonal:'ZN',division:'Geo',district:'Dist',storeType:'F',locationType:'Type',ecom:true},
      {code:'O2',name:'O2',zone:'Z',rho:'R',zonal:'ZN',division:'Geo',district:'Dist',storeType:'F',locationType:'Type',ecom:true},
      {code:'O3',name:'O3',zone:'Z',rho:'R',zonal:'ZN',division:'Geo',district:'Dist',storeType:'F',locationType:'Type',ecom:true}
    ],
    skus:[{code:'1001',name:'A',category:'D',category3:'C3',core:true,kvi:false,promo:false,ecom:true,fm:false}],
    outletCount:3,skuCount:1,slotCount:3,
    stock:new Float64Array([0,1,3]),sales:new Float64Array([0,0,0]),
    stockPresent:new Uint8Array([1,1,1]),salesPresent:new Uint8Array([1,1,1]),
    kind:'ecom'
  };
  const e2=new Engine(biggerEcomModel);e2.setFilters(e2.filters);
  const exceptions=e2.topExceptions(10);
  assert.equal(exceptions.length,3,'all 3 slots are below the default threshold of 5 and should appear as exceptions');
  for(let i=1;i<exceptions.length;i++){
    assert.ok(exceptions[i-1].shortfall>=exceptions[i].shortfall,'topExceptions must be sorted by descending shortfall, not left in NaN-comparison order');
  }
}

function testKviOutletFiltering(){
  // 2 KVI outlets + 1 non-KVI outlet, 1 KVI SKU + 1 non-KVI SKU, all slots
  // available at requiredDOS=2 so the counts only reflect filtering, not
  // availability math (already covered by testCalculations).
  const outlets=[
    {code:'K1',name:'Kvi One',zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L',kvi:true},
    {code:'K2',name:'Kvi Two',zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L',kvi:true},
    {code:'N1',name:'Not Kvi',zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L',kvi:false},
  ];
  const skus=[
    {code:'S1',name:'Kvi Sku',category:'C',category3:'C3',core:false,kvi:true,promo:false},
    {code:'S2',name:'Other Sku',category:'C',category3:'C3',core:true,kvi:false,promo:false},
  ];
  const slotCount=outlets.length*skus.length;
  const stock=new Float64Array(slotCount).fill(3),sales=new Float64Array(slotCount).fill(30);
  const stockPresent=new Uint8Array(slotCount).fill(1),salesPresent=new Uint8Array(slotCount).fill(1);
  const model={outlets,skus,outletCount:outlets.length,skuCount:skus.length,slotCount,stock,sales,stockPresent,salesPresent};

  const engine=new Engine(model);
  engine.filters.requiredDOS=2;engine.setFilters(engine.filters);

  // No outletType/kviOutlet filter set: all 3 outlets x 2 skus = 6 slots.
  assert.equal(engine.summary().total,6);

  // outletType=KVI restricts to K1+K2 (2 outlets x 2 skus = 4 slots).
  engine.filters.outletType=new Set(['KVI']);engine.setFilters(engine.filters);
  assert.equal(engine.summary().total,4);

  // outletType=Non-KVI restricts to N1 only (1 outlet x 2 skus = 2 slots).
  engine.filters.outletType=new Set(['Non-KVI']);engine.setFilters(engine.filters);
  assert.equal(engine.summary().total,2);

  // kviOutlet=K1 restricts to exactly that one outlet regardless of outletType.
  engine.filters.outletType=new Set();engine.filters.kviOutlet=new Set(['K1']);engine.setFilters(engine.filters);
  assert.equal(engine.summary().total,2);

  // optionValues('kviOutlet') must only ever list outlets flagged kvi=true.
  engine.filters.kviOutlet=new Set();engine.setFilters(engine.filters);
  const kviOutletOptions=engine.optionValues('kviOutlet').map(o=>o.value).sort();
  assert.deepEqual(kviOutletOptions,['K1','K2']);

  // optionValues('outletType') exposes the fixed KVI/Non-KVI labels.
  const outletTypeOptions=engine.optionValues('outletType').map(o=>o.value).sort();
  assert.deepEqual(outletTypeOptions,['KVI','Non-KVI']);

  // kviSummary() always scopes to KVI outlets x KVI skus, ignoring the
  // user's outletType/kviOutlet selection entirely.
  engine.filters.outletType=new Set(['Non-KVI']);engine.setFilters(engine.filters);
  const kviSummary=engine.kviSummary();
  assert.equal(kviSummary.total,2,'kviSummary must stay scoped to K1+K2 x S1 even when outletType=Non-KVI is selected');

  // kviOutletBandDistribution()/kviSkuBandDistribution() must report only
  // the 2 KVI outlets (K1+K2), never the 3rd non-KVI outlet (N1) — this
  // was the bug behind the "989 outlets" showing under the KVI panel.
  engine.filters.outletType=new Set();engine.filters.kviOutlet=new Set();engine.setFilters(engine.filters);
  const kviOd=engine.kviOutletBandDistribution();
  assert.equal(kviOd.total,2,'KVI outlet band distribution must total 2 (K1+K2), not all 3 outlets');
  assert.deepEqual(kviOd.outlets.map(o=>o.id).sort(),['K1','K2']);
  const kviSd=engine.kviSkuBandDistribution();
  assert.equal(kviSd.total,1,'KVI SKU band distribution must total 1 (only S1 is KVI-flagged)');

  // Calling the KVI-scoped methods must not leak the temporary KVI-only
  // filter back into the engine's real filters afterward.
  assert.equal(engine.filters.outlet.size,0,'engine.filters.outlet must be restored to empty after the KVI-scoped call');
  assert.equal(engine.summary().total,6,'a normal summary() call after the KVI-scoped methods must still see all 3 outlets');
}

function testEcomOutletTypeFiltering(){
  // K1: KVI + Ecom. K2: KVI only. E1: Ecom only. G1: neither.
  // Proves the two flags are independent and 'E-COM Outlet' filters
  // correctly whether or not the outlet is also KVI.
  const outlets=[
    {code:'K1',name:'Kvi Ecom',zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L',kvi:true,ecom:true},
    {code:'K2',name:'Kvi Only',zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L',kvi:true,ecom:false},
    {code:'E1',name:'Ecom Only',zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L',kvi:false,ecom:true},
    {code:'G1',name:'General',zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L',kvi:false,ecom:false},
  ];
  const skus=[{code:'S1',name:'Sku',category:'C',category3:'C3',core:true,kvi:false,promo:false}];
  const slotCount=outlets.length*skus.length;
  const stock=new Float64Array(slotCount).fill(3),sales=new Float64Array(slotCount).fill(30);
  const stockPresent=new Uint8Array(slotCount).fill(1),salesPresent=new Uint8Array(slotCount).fill(1);
  const model={outlets,skus,outletCount:outlets.length,skuCount:skus.length,slotCount,stock,sales,stockPresent,salesPresent};

  const engine=new Engine(model);
  engine.filters.requiredDOS=2;engine.setFilters(engine.filters);

  // outletType=E-COM Outlet restricts to K1+E1 (both flagged ecom=true),
  // regardless of their KVI status.
  engine.filters.outletType=new Set(['E-COM Outlet']);engine.setFilters(engine.filters);
  assert.equal(engine.summary().total,2,'E-COM Outlet filter should match K1+E1 only');

  // KVI + E-COM Outlet selected together is a union (either flag matches),
  // matching the existing KVI/Non-KVI OR-semantics in outletTypeHas.
  engine.filters.outletType=new Set(['KVI','E-COM Outlet']);engine.setFilters(engine.filters);
  assert.equal(engine.summary().total,3,'KVI + E-COM Outlet together should match K1+K2+E1');

  // optionValues('outletType') must list all three options when outlets
  // covering all three exist, and never invent an option no outlet has.
  engine.filters.outletType=new Set();engine.setFilters(engine.filters);
  const options=engine.optionValues('outletType').map(o=>o.value).sort();
  assert.deepEqual(options,['E-COM Outlet','KVI','Non-KVI']);
}

function testKpiBreakdownRendering(){
  // No breakdown passed: must render exactly as before (plain div, no
  // button) so every existing kpi() call site is unaffected.
  const plain=kpi('Overall Availability','74.5%','123 / 165 slots','primary');
  assert.ok(plain.includes('<div class="kpi-value">74.5%</div>'),'kpi() without breakdown must render a plain div, not a button');
  assert.ok(!plain.includes('kpi-value-btn'),'kpi() without breakdown must not add the clickable button class');

  // Breakdown passed: value becomes a button carrying the breakdown as
  // a JSON data attribute the popover handler can parse back out.
  const breakdown={title:'Overall Availability',sub:'Required DOS \u2265 2',rows:[{label:'Healthy',value:'100'},{label:'Low',value:'23'}]};
  const withBreakdown=kpi('Overall Availability','74.5%','123 / 165 slots','primary',breakdown);
  assert.ok(withBreakdown.includes('kpi-value-btn'),'kpi() with breakdown must render the value as a clickable button');
  assert.ok(withBreakdown.includes('data-kpi-breakdown='),'kpi() with breakdown must attach the breakdown as a data attribute');
  const attrMatch=withBreakdown.match(/data-kpi-breakdown="([^"]*)"/);
  assert.ok(attrMatch,'breakdown data attribute must be present and quoted');
  const decoded=JSON.parse(attrMatch[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
  assert.equal(decoded.title,'Overall Availability');
  assert.equal(decoded.rows.length,2);
  assert.equal(decoded.rows[0].label,'Healthy');
}

function testPdfReportDataAssembly(){
  const model=syntheticModel();
  const engine=new Engine(model);
  engine.filters.requiredDOS=2;engine.setFilters(engine.filters);

  // No ecomEngine: should still assemble cleanly with 4 KPIs, no Ecom line.
  const data=buildReportData(engine,null,model);
  assert.equal(data.kpis.length,4,'without an ecomEngine there should be exactly 4 KPI rows (Overall/Core/KVI/Promo)');
  assert.equal(data.kpis[0].label,'Overall Availability');
  assert.ok(data.kpis[0].availability.endsWith('%'),'availability values must be formatted as percentages');
  assert.ok(data.filename.startsWith('availability-summary-')&&data.filename.endsWith('.pdf'));
  assert.ok(data.filterLines.length>=1);
  assert.equal(data.filterLines[0],'No filters applied — full assortment universe','with no active filters this exact line must be present');

  // With a filter active, it must show up in filterLines instead of the "no filters" line.
  engine.filters.outlet=new Set(['O1']);engine.setFilters(engine.filters);
  const dataFiltered=buildReportData(engine,null,model);
  assert.ok(dataFiltered.filterLines.some(l=>l.startsWith('Outlet: O1')),'active outlet filter must appear in filterLines');
  assert.notEqual(dataFiltered.filterLines[0],'No filters applied — full assortment universe');

  // zoneRows/skuRows must respect the limit parameters and never exceed them.
  engine.filters.outlet=new Set();engine.setFilters(engine.filters);
  const capped=buildReportData(engine,null,model,3,2);
  assert.ok(capped.skuRows.length<=3,'skuRows must respect the skuLimit parameter');
  assert.ok(capped.zoneRows.length<=2,'zoneRows must respect the zoneLimit parameter');

  // statusRows must only include statuses with a non-zero count.
  for(const [,count] of capped.statusRows)assert.notEqual(count,'0','statusRows must exclude zero-count statuses');
}

function testEcomOutletDrillDown(){
  // Regression coverage for the "Outlet Wise Availability for Ecom"
  // table's drill-down (showEcomOutletDrill): Engine.drillOutlet()
  // called on the Ecom engine must return Ecom-shaped data (the two
  // Sufficient Stock / Below Threshold status keys, stock-threshold
  // availability), not fall through to main-dashboard assumptions.
  const ecomModel={
    outlets:[
      {code:'E1',name:'Ecom One',zone:'Z',rho:'R',zonal:'ZN',division:'Geo',district:'Dist',storeType:'F',locationType:'Type',ecom:true},
      {code:'E2',name:'Ecom Two',zone:'Z',rho:'R',zonal:'ZN',division:'Geo',district:'Dist',storeType:'F',locationType:'Type',ecom:true}
    ],
    skus:[
      {code:'S1',name:'Alpha',category:'D',category3:'C3',core:true,kvi:false,promo:false,ecom:true,fm:true},
      {code:'S2',name:'Beta',category:'D',category3:'C3',core:false,kvi:false,promo:true,ecom:true,fm:false}
    ],
    outletCount:2,skuCount:2,slotCount:4,
    // E1: both SKUs stock=8 (available). E2: both SKUs stock=1 (unavailable).
    stock:new Float64Array([8,8,1,1]),sales:new Float64Array([0,0,0,0]),
    stockPresent:new Uint8Array([1,1,1,1]),salesPresent:new Uint8Array([1,1,1,1]),
    kind:'ecom'
  };
  const e=new Engine(ecomModel);e.setFilters(e.filters); // default requiredEcomStock=5

  const d1=e.drillOutlet('E1');
  assert.equal(d1.summary.total,2);
  assert.equal(d1.summary.available,2,'E1 has stock=8 on both SKUs, both should be available');
  assert.equal(d1.summary.status['Sufficient Stock'],2);
  assert.equal(d1.summary.status.OOS,undefined,'drillOutlet on an Ecom engine must not carry stale main-dashboard status keys');

  const d2=e.drillOutlet('E2');
  assert.equal(d2.summary.available,0,'E2 has stock=1 on both SKUs, both should be unavailable at the default threshold of 5');
  assert.equal(d2.summary.status['Below Threshold'],2);
  assert.equal(d2.exceptions.length,2,"both of E2's slots should appear as exceptions since both are unavailable");
  for(const x of d2.exceptions)assert.equal(x.status,'Below Threshold');
}

testCalculations();
testCalculationAuditFixes();
testUnscoredSlotsExcludedFromDenominator();
testOutletBands();
testSkuAndHierarchyAnalytics();
testEcomEngineBehavior();
function largeSyntheticModel(outletCount,skuCount){
  const outlets=Array.from({length:outletCount},(_,i)=>({code:`O${i+1}`,name:`Outlet ${i+1}`,zone:'Z',rho:'R',zonal:'ZN',division:'D',district:'Dist',storeType:'S',locationType:'L'}));
  const skus=Array.from({length:skuCount},(_,i)=>({code:`S${i+1}`,name:`SKU ${i+1}`,category:'C',category3:'C3',core:true,kvi:false,promo:false}));
  const slotCount=outletCount*skuCount;
  // Every slot: stock=0, sales=30 -> ADS=1, DOS=0 -> OOS, always unavailable.
  // This guarantees both skuUnavailability() and topExceptions() are
  // large (every group/slot is unavailable), forcing the display cap
  // to actually engage so the test is meaningful.
  const stock=new Float64Array(slotCount).fill(0),sales=new Float64Array(slotCount).fill(30);
  const stockPresent=new Uint8Array(slotCount).fill(1),salesPresent=new Uint8Array(slotCount).fill(1);
  return {outlets,skus,outletCount,skuCount,slotCount,stock,sales,stockPresent,salesPresent};
}

function countRows(html){
  const m=html.match(/<tr[\s>]/g);
  return m?m.length:0;
}

function testDisplayCapPreventsFreeze(){
  // Regression test for the stuck-page/freeze reported after clicking
  // Core/KVI/Promo on real production-scale data: rendering every
  // unavailable slot / every outlet into the DOM with no cap froze the
  // page. This proves every page that used to render unlimited rows
  // now bounds its rendered <tr> count, while the underlying Engine
  // methods (used directly by CSV/Excel export, which call them with
  // no limit) still return the FULL dataset -- so "full data" stays
  // true for exports even though on-screen rendering is capped.
  const DISPLAY_ROW_CAP=500;
  const model=largeSyntheticModel(600,3); // 1800 slots, 600 outlets, all unavailable
  const engine=new Engine(model);
  engine.filters.requiredDOS=2;engine.setFilters(engine.filters);

  // Underlying engine data must be complete (this is what CSV/Excel export reads).
  const allSkuRows=engine.skuUnavailability();
  assert.equal(allSkuRows.length,3,'all 3 SKU groups exist (SKU count is small here; outlet count is what is large)');
  const allExceptions=engine.topExceptions();
  assert.equal(allExceptions.length,1800,'topExceptions() with no limit must still return every unavailable slot -- this is what export reads');
  const allOutletGroups=engine.groupBy('outlet');
  assert.equal(allOutletGroups.length,600,'groupBy(\"outlet\") with no limit must still return every outlet -- this is what export reads');

  // renderClass (Core/KVI/Promo page) must not render more than the
  // cap's worth of Outlet Performance rows or Top Exceptions rows,
  // even though 600 outlets and 1800 exceptions exist.
  const classHtml=renderClass(engine,'core','Core');
  // renderClass has multiple tables; check the two known-large ones by
  // isolating each section's HTML between its card-title and the next
  // section boundary is brittle, so instead assert the TOTAL <tr> count
  // across the whole page stays well below the uncapped total (2400+
  // rows if every table were unbounded), proving the cap engaged.
  const totalRowsOnPage=countRows(classHtml);
  assert.ok(totalRowsOnPage<1200,`Core/KVI/Promo page rendered ${totalRowsOnPage} <tr> rows -- expected well under the uncapped total (600 outlets + 1800 exceptions + hierarchy rows), proving the display cap is engaged`);
  assert.ok(classHtml.includes('CSV button exports every row')||classHtml.includes(String(DISPLAY_ROW_CAP)),'a capped page must tell the user how to get the full data');

  // renderExceptions (standalone Exceptions page) must cap similarly.
  const exceptionsHtml=renderExceptions(engine);
  const exceptionsRows=countRows(exceptionsHtml);
  assert.ok(exceptionsRows<=DISPLAY_ROW_CAP+5,`Exceptions page rendered ${exceptionsRows} rows, expected <= ~${DISPLAY_ROW_CAP}`);
  assert.ok(exceptionsHtml.includes('1,800')||exceptionsHtml.includes('1800'),'the true total (1800) must still be shown in the page header even though only a cap-worth is rendered');

  // renderOutletView (Outlets page, groupTable) must cap at 600 outlets -> <=500 rows.
  const outletViewHtml=renderOutletView(engine);
  const outletViewRows=countRows(outletViewHtml);
  assert.ok(outletViewRows<=DISPLAY_ROW_CAP+5,`Outlets page rendered ${outletViewRows} rows for 600 outlets, expected <= ~${DISPLAY_ROW_CAP}`);
}

testCalculations();
function testMaterializedSlotsSharedAcrossMethods(){
  // Regression test for the actual cause of the "Page Unresponsive"
  // freeze on Core/KVI/Promo: summary(), groupBy(), topExceptions(),
  // productHierarchySummary(), and detailPage() used to each
  // independently re-walk the ENTIRE filtered outlet x SKU universe
  // via slots(), calling slot()/calculateSlot() fresh every time. A
  // single renderClass()-style render calls ~8 of these in sequence,
  // which meant 8x the real slot count in calculateSlot() calls --
  // millions of calls on production-scale data. This proves those
  // methods now share one materialized pass per (forcedClass, filter
  // state), via Engine.materializedSlots().
  const outletCount=200,skuCount=5; // 1000 slots -- large enough to be a meaningful multiplier check, small enough to run fast in CI
  const model=largeSyntheticModel(outletCount,skuCount);
  const engine=new Engine(model);
  engine.filters.requiredDOS=2;engine.setFilters(engine.filters);

  let slotCalls=0;
  const realSlot=engine.slot.bind(engine);
  engine.slot=(...args)=>{slotCalls++;return realSlot(...args);};

  // Mirrors the sequence renderClass() actually calls in one render.
  engine.summary(null);
  engine.outletBandDistribution(null);
  engine.skuBandDistribution(null);
  engine.skuUnavailability(null,null);
  engine.productHierarchySummary('category',null);
  engine.productHierarchySummary('category3',null);
  engine.outletBandDistribution(null); // renderClass calls this a second time for bandMap
  engine.topExceptions(null,null);

  const totalSlots=outletCount*skuCount;
  // Before this fix, 8 independent full passes would mean ~8x totalSlots
  // calculateSlot() calls. After the fix, only the FIRST call of each
  // distinct (forcedClass) pays the real cost; every subsequent call in
  // this same sequence must hit the cache and call slot() zero more times.
  assert.ok(slotCalls<=totalSlots*1.1,`expected at most ~1 full pass worth of slot() calls (${totalSlots}), got ${slotCalls} across 8 method calls that used to each do their own full pass`);
  assert.ok(slotCalls>0,'sanity check: slot() must have been called at least once');
}

testCalculations();
testCalculationAuditFixes();
testUnscoredSlotsExcludedFromDenominator();
testOutletBands();
testSkuAndHierarchyAnalytics();
testEcomEngineBehavior();
testMainEngineUnaffectedByEcomRule();
testEcomStatusTallyingNoNaN();
testKviOutletFiltering();
testEcomOutletTypeFiltering();
testKpiBreakdownRendering();
testPdfReportDataAssembly();
testEcomOutletDrillDown();
testDisplayCapPreventsFreeze();
testMaterializedSlotsSharedAcrossMethods();
console.log('PASS: calculation, banding, hierarchy, Ecom engine (stock-threshold), KVI, E-COM outlet, KPI breakdown, PDF report, Ecom outlet drill-down, display cap and materialized-slots tests');
