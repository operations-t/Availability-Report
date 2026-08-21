/* Availability Dashboard — filter layer v3
 * Searchable cascading multi-select filters and the Outlet x SKU report.
 * Filter semantics: OR inside one filter, AND across filters, self-excluding
 * cascades. Loaded after app.js, so the analytics rendering there stays the
 * source of truth and this file only replaces the pieces it owns.
 */
(function(){
  'use strict';

  const STORAGE_KEY='availabilityFilterStateV2';
  const BAND_OPTIONS=[
    {value:'ge90',label:'90% & above'},
    {value:'80-90',label:'80%–<90%'},
    {value:'70-80',label:'70%–<80%'},
    {value:'60-70',label:'60%–<70%'},
    {value:'lt60',label:'Below 60%'}
  ];
  // At a single outlet-SKU intersection stock is binary, so it must not borrow
  // the percentage band labels used for aggregated rows.
  const STOCK_STATUS_OPTIONS=[
    {value:'ge90',label:'In stock'},
    {value:'lt60',label:'Out of stock'}
  ];
  // Rows above this trigger a confirmation before the browser builds the file.
  const EXPORT_CONFIRM_ROWS=150000;
  const APPROX_BYTES_PER_ROW=125;

  const FILTER_DEFS={
    sku:[
      {key:'outletCode',id:'skuOutletFilter',label:'Outlet Code',scope:'outlet',value:r=>String(r.outlet_code||'').trim()},
      {key:'outletName',id:'skuOutletNameFilter',label:'Outlet Name',scope:'outlet',value:r=>String(r.outlet_name||'Unnamed')},
      {key:'leader',id:'skuLeaderFilter',label:'Leader',scope:'outlet',value:r=>String(r.leader||'Unassigned')},
      {key:'zone',id:'skuZoneFilter',label:'Zone',scope:'outlet',zoneOnly:true,value:r=>String(r.zone||'Not supplied')},
      {key:'kviOutlet',id:'skuKviFilter',label:'KVI Outlet',scope:'outlet',value:r=>norm(r.kvi)==='yes'?'yes':'no',format:v=>v==='yes'?'KVI outlet':'Non-KVI / unknown'},
      {key:'skuCode',id:'skuCodeFilter',label:'SKU Code',scope:'sku',value:r=>String(r.sku_code??'')},
      {key:'description',id:'skuDescriptionFilter',label:'SKU Description',scope:'sku',value:r=>String(r.description||'Unnamed SKU')},
      {key:'type',id:'skuTypeFilter',label:'SKU Type',scope:'sku',value:r=>String(r.type||'Unknown')},
      {key:'cat',id:'skuCatFilter',label:'Category',scope:'sku',value:r=>String(r.cat||'Unknown')},
      {key:'l3',id:'skuL3Filter',label:'L-3',scope:'sku',value:r=>String(r.l3||'Unknown')},
      {key:'stockBand',id:'skuStockBandFilter',label:'Stock Band',scope:'sku',value:r=>bandKey(Number(r.availability)||0),fixed:BAND_OPTIONS},
      {key:'dosBand',id:'skuBandFilter',label:'DOS Band',scope:'sku',value:r=>bandKey(skuDosPct(r)),fixed:BAND_OPTIONS}
    ],
    outlet:[
      {key:'outletCode',id:'outletSelectFilter',label:'Outlet Code',scope:'outlet',value:r=>String(r.outlet_code||'').trim()},
      {key:'outletName',id:'outletNameFilter',label:'Outlet Name',scope:'outlet',value:r=>String(r.outlet_name||'Unnamed')},
      {key:'leader',id:'outletLeaderFilter',label:'Leader',scope:'outlet',value:r=>String(r.leader||'Unassigned')},
      {key:'zone',id:'outletZoneFilter',label:'Zone',scope:'outlet',zoneOnly:true,value:r=>String(r.zone||'Not supplied')},
      {key:'kviOutlet',id:'kviFilter',label:'KVI Outlet',scope:'outlet',value:r=>norm(r.kvi)==='yes'?'yes':'no',format:v=>v==='yes'?'KVI outlet':'Non-KVI / unknown'},
      {key:'stockBand',id:'outletStockBandFilter',label:'Stock Band',scope:'outlet',value:r=>bandKey(Number(r.availability)||0),fixed:BAND_OPTIONS},
      {key:'dosBand',id:'bandFilter',label:'DOS Band',scope:'outlet',value:r=>bandKey(outletDosPct(r)),fixed:BAND_OPTIONS}
    ],
    combo:[
      {key:'outletCode',id:'comboOutletFilter',label:'Outlet Code',scope:'outlet',value:r=>String(r.outlet_code||r.code||'').trim()},
      {key:'outletName',id:'comboOutletNameFilter',label:'Outlet Name',scope:'outlet',value:r=>String(r.outlet_name||r.name||'Unnamed')},
      {key:'leader',id:'comboLeaderFilter',label:'Leader',scope:'outlet',value:r=>String(r.leader||'Unassigned')},
      {key:'zone',id:'comboZoneFilter',label:'Zone',scope:'outlet',zoneOnly:true,value:r=>String(r.zone||'Not supplied')},
      {key:'kviOutlet',id:'comboKviFilter',label:'KVI Outlet',scope:'outlet',value:r=>(r.kvi==='yes'||norm(r.kvi)==='yes')?'yes':'no',format:v=>v==='yes'?'KVI outlet':'Non-KVI / unknown'},
      {key:'skuCode',id:'comboSkuFilter',label:'SKU Code',scope:'sku',value:r=>String(r.sku_code??'')},
      {key:'description',id:'comboSkuDescriptionFilter',label:'SKU Description',scope:'sku',value:r=>String(r.description||'Unnamed SKU')},
      {key:'type',id:'comboTypeFilter',label:'SKU Type',scope:'sku',value:r=>String(r.type||'Unknown')},
      {key:'cat',id:'comboCatFilter',label:'Category',scope:'sku',value:r=>String(r.cat||'Unknown')},
      {key:'l3',id:'comboL3Filter',label:'L-3',scope:'sku',value:r=>String(r.l3||'Unknown')},
      {key:'stockBand',id:'comboStockBandFilter',label:'Stock Status',scope:'pair',value:r=>r.stock_available?'ge90':'lt60',fixed:STOCK_STATUS_OPTIONS},
      {key:'dosBand',id:'comboDosBandFilter',label:'Coverage Tier',scope:'pair',value:r=>bandKey(r.dos_pct),fixed:BAND_OPTIONS}
    ]
  };

  const FILTER_STATE={sku:{},outlet:{},combo:{}};
  const FILTER_WIDGETS=new Map();
  const SHARED_FILTER_VIEWS={
    outletCode:['sku','outlet','combo'],
    outletName:['sku','outlet','combo'],
    leader:['sku','outlet','combo'],
    zone:['sku','outlet','combo'],
    kviOutlet:['sku','outlet','combo'],
    skuCode:['sku','combo'],
    description:['sku','combo'],
    type:['sku','combo'],
    cat:['sku','combo'],
    l3:['sku','combo']
  };
  let CASCADE_LOCK=false;
  const CASCADE_DIRTY=new Set(['sku','outlet','combo']);
  let SKU_SCOPE_CACHE={data:null,key:'',rows:[]};

  /* Zone lives in the Summary sheet and is often absent. Dropping the defs
     entirely is cleaner than showing a filter whose only value is "Not supplied". */
  function dropZoneDefsIfAbsent(){
    const present=!!(DATA?.zone_present)||(DATA?.outlets||[]).some(r=>String(r.zone||'').trim());
    if(present)return;
    Object.keys(FILTER_DEFS).forEach(view=>{FILTER_DEFS[view]=FILTER_DEFS[view].filter(d=>!d.zoneOnly)});
    delete SHARED_FILTER_VIEWS.zone;
    Object.values(FILTER_STATE).forEach(state=>{delete state.zone});
  }

  function loadState(){
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
      Object.keys(FILTER_STATE).forEach(view=>{
        (FILTER_DEFS[view]||[]).forEach(def=>{
          const v=saved?.[view]?.[def.key];
          FILTER_STATE[view][def.key]=v===null||v===undefined?null:(Array.isArray(v)?v.map(String):null);
        });
      });
      const preferred=[VIEW_MODE,...Object.keys(FILTER_STATE).filter(v=>v!==VIEW_MODE)];
      Object.entries(SHARED_FILTER_VIEWS).forEach(([key,views])=>{
        const source=preferred.find(view=>views.includes(view)&&FILTER_STATE[view][key]!==null);
        const value=source?FILTER_STATE[source][key]:null;
        views.forEach(view=>{if(key in FILTER_STATE[view])FILTER_STATE[view][key]=value===null?null:[...value]});
      });
    }catch(_){
      Object.keys(FILTER_STATE).forEach(view=>(FILTER_DEFS[view]||[]).forEach(def=>FILTER_STATE[view][def.key]=null));
    }
  }
  function saveState(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(FILTER_STATE))}catch(_){/* private mode */}}
  function stateValue(view,key){return FILTER_STATE?.[view]?.[key]??null}
  function selectionMatches(view,key,value){const state=stateValue(view,key);return state===null||state.includes(String(value))}
  function setState(view,key,value,{persist=true}={}){
    const normalized=value===null?null:[...new Set((value||[]).map(String))];
    const targets=SHARED_FILTER_VIEWS[key]?.filter(v=>key in (FILTER_STATE[v]||{}))||[view];
    targets.forEach(target=>{FILTER_STATE[target][key]=normalized===null?null:[...normalized]});
    if(persist)saveState();
    return targets;
  }
  function defs(view,scope){return (FILTER_DEFS[view]||[]).filter(d=>!scope||d.scope===scope)}
  function defById(id){for(const view of Object.keys(FILTER_DEFS)){const def=FILTER_DEFS[view].find(d=>d.id===id);if(def)return {view,def}}return null}
  function formatOption(def,value){return def.format?def.format(value):String(value||'—')}
  function optionSort(a,b){return a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'})}

  function outletRowsForView(view,ignoreKey=null){
    const rows=view==='combo'?reportingOutletMeta():(DATA?.outlets||[]);
    return rows.filter(row=>defs(view,'outlet').every(def=>def.key===ignoreKey||selectionMatches(view,def.key,def.value(row))));
  }
  function scopedSkuRows(){
    const key=JSON.stringify([DOS_DAYS,defs('sku','outlet').map(def=>[def.key,stateValue('sku',def.key)])]);
    if(SKU_SCOPE_CACHE.data===DATA&&SKU_SCOPE_CACHE.key===key)return SKU_SCOPE_CACHE.rows;
    const source=DATA?.skus||[],indexes=skuScopeOutletIndexes(),meta=reportingOutletMeta();
    const unrestricted=indexes.length===meta.length&&defs('sku','outlet').every(def=>stateValue('sku',def.key)===null);
    const rows=unrestricted?source:source.map(row=>{
      const bits=stockBits(row),coverage=coverageDays(row);let available=0,dos=0;
      if(bits&&coverage)indexes.forEach(index=>{available+=(bits[index>>3]>>(index&7))&1;const days=Number(coverage[index]);dos+=Number.isFinite(days)?coverageScore(days):0});
      return {...row,available_outlets:available,total_outlets:indexes.length,availability:indexes.length?available/indexes.length:0,_dos_value:dos,_scope_outlet_indexes:indexes};
    });
    SKU_SCOPE_CACHE={data:DATA,key,rows};return rows;
  }
  function skuRowsForView(view,ignoreKey=null){
    const rows=view==='sku'?scopedSkuRows():(DATA?.skus||[]);
    return rows.filter(row=>defs(view,'sku').every(def=>def.key===ignoreKey||selectionMatches(view,def.key,def.value(row))));
  }
  function optionsFromRows(def,rows){
    const counts=new Map();
    rows.forEach(row=>{const v=String(def.value(row));if(v)counts.set(v,(counts.get(v)||0)+1)});
    if(def.fixed)return def.fixed.filter(x=>counts.has(x.value)).map(x=>({...x,count:counts.get(x.value)||0}));
    return [...counts.entries()].map(([value,count])=>({value,label:formatOption(def,value),count})).sort(optionSort);
  }
  function collectOptions(view,def,ignoreKey=def.key){
    if(def.scope==='pair')return [];
    const rows=def.scope==='outlet'?outletRowsForView(view,ignoreKey):skuRowsForView(view,ignoreKey);
    return optionsFromRows(def,rows);
  }
  function collectUniverse(view,def){
    if(def.fixed)return def.fixed.map(x=>({...x,count:null}));
    const rows=def.scope==='outlet'?(view==='combo'?reportingOutletMeta():(DATA?.outlets||[])):(DATA?.skus||[]);
    const values=new Map();
    rows.forEach(row=>{const v=String(def.value(row));if(v&&!values.has(v))values.set(v,formatOption(def,v))});
    return [...values.entries()].map(([value,label])=>({value,label,count:null})).sort(optionSort);
  }
  function reconcileState(view,def,universe){
    const state=stateValue(view,def.key);if(state===null||!state.length)return false;
    const validValues=new Set(universe.map(x=>x.value)),valid=state.filter(v=>validValues.has(v));
    const next=valid.length===state.length?state:(valid.length?valid:null);
    if(next===state)return false;
    setState(view,def.key,next,{persist:false});return true;
  }

  class MultiFilter{
    constructor(view,def){
      this.view=view;this.def=def;this.native=document.getElementById(def.id);this.options=[];this.universe=[];this.query='';
      if(!this.native)return;
      this.native.classList.add('multi-filter-native');this.native.setAttribute('multiple','multiple');this.native.tabIndex=-1;
      this.root=document.createElement('div');this.root.className='multi-filter';
      const triggerId=`${def.id}Trigger`;
      this.root.innerHTML=`<button class="multi-filter-trigger" id="${triggerId}" type="button" aria-expanded="false" aria-haspopup="true"><span class="multi-filter-trigger-text">All ${esc(def.label)}</span><span class="multi-filter-trigger-meta"><span class="multi-filter-count">All</span><span class="multi-filter-caret" aria-hidden="true">⌄</span></span></button><div class="multi-filter-panel"><div class="multi-filter-search-wrap"><span class="multi-filter-search-icon" aria-hidden="true">⌕</span><input class="multi-filter-search" type="search" aria-label="Search ${esc(def.label)}" placeholder="Search ${esc(def.label)}…"></div><div class="multi-filter-actions"><button type="button" data-mf-action="all">Select all</button><button type="button" data-mf-action="clear">Clear all</button></div><div class="multi-filter-options" role="group" aria-label="${esc(def.label)} values"></div></div>`;
      this.native.insertAdjacentElement('afterend',this.root);
      // The visible control is the button, so point the field label at it.
      const label=document.querySelector(`label[for="${def.id}"]`);
      if(label)label.setAttribute('for',triggerId);
      this.trigger=this.root.querySelector('.multi-filter-trigger');this.text=this.root.querySelector('.multi-filter-trigger-text');this.count=this.root.querySelector('.multi-filter-count');this.panel=this.root.querySelector('.multi-filter-panel');this.search=this.root.querySelector('.multi-filter-search');this.list=this.root.querySelector('.multi-filter-options');
      this.root.addEventListener('click',e=>e.stopPropagation());
      this.trigger.addEventListener('click',()=>this.toggle());
      this.search.addEventListener('input',()=>{this.query=this.search.value.trim().toLowerCase();this.renderOptions()});
      this.search.addEventListener('keydown',e=>{if(e.key==='Escape'){this.close();this.trigger.focus()}});
      this.root.querySelector('[data-mf-action="all"]').addEventListener('click',()=>this.change(null));
      this.root.querySelector('[data-mf-action="clear"]').addEventListener('click',()=>this.change([]));
      this.list.addEventListener('change',e=>{const input=e.target.closest('input[data-value]');if(!input)return;this.toggleValue(input.dataset.value,input.checked)});
    }
    close(){
      this.root.classList.remove('open');this.trigger.setAttribute('aria-expanded','false');
      if(this.query||this.search.value){this.query='';this.search.value='';this.renderOptions()}
    }
    toggle(force){
      const open=force===undefined?!this.root.classList.contains('open'):!!force;
      if(!open){this.close();return}
      FILTER_WIDGETS.forEach(widget=>{if(widget!==this)widget.close()});
      this.query='';this.search.value='';this.renderOptions();
      this.root.classList.add('open');this.trigger.setAttribute('aria-expanded','true');setTimeout(()=>this.search.focus(),0);
    }
    setData(options,universe){this.options=options||[];this.universe=universe||options||[];this.render()}
    selectedSet(){const state=stateValue(this.view,this.def.key);return state===null?null:new Set(state)}
    toggleValue(value,checked){
      const state=this.selectedSet();
      // "All" is an unrestricted sentinel, so the first tick narrows to that
      // value rather than excluding it.
      const selected=state===null?new Set():state;
      if(checked)selected.add(value);else selected.delete(value);
      const allValues=this.universe.map(x=>x.value);
      const next=!selected.size||allValues.length&&allValues.every(v=>selected.has(v))?null:[...selected];
      this.change(next);
    }
    change(next){const affected=setState(this.view,this.def.key,next);onFilterChanged(this.view,affected)}
    render(){
      const state=stateValue(this.view,this.def.key),selected=state===null?[]:state;
      if(state===null){this.text.textContent=`All ${this.def.label}`;this.count.textContent='All';this.count.classList.remove('is-set')}
      else if(!selected.length){this.text.textContent='None selected';this.count.textContent='0';this.count.classList.add('is-set')}
      else{const labels=selected.slice(0,2).map(v=>formatOption(this.def,v));this.text.textContent=labels.join(', ')+(selected.length>2?` +${selected.length-2}`:'');this.count.textContent=String(selected.length);this.count.classList.add('is-set')}
      this.renderNative();this.renderOptions();
    }
    renderNative(){
      const state=stateValue(this.view,this.def.key),all=this.universe;
      this.native.innerHTML=all.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
      [...this.native.options].forEach(o=>o.selected=state===null||state.includes(o.value));
    }
    renderOptions(){
      const state=this.selectedSet(),available=new Map(this.options.map(x=>[x.value,x]));
      const selectedUnavailable=state===null?[]:[...state].filter(v=>!available.has(v)).map(v=>({value:v,label:formatOption(this.def,v),count:0}));
      const rows=[...selectedUnavailable,...this.options].filter(o=>!this.query||`${o.label} ${o.value}`.toLowerCase().includes(this.query));
      if(!rows.length){this.list.innerHTML='<div class="multi-filter-empty">No matching values</div>';return}
      this.list.innerHTML=rows.map(o=>{const checked=state!==null&&state.has(o.value);return `<label class="multi-filter-option"><input type="checkbox" data-value="${esc(o.value)}" ${checked?'checked':''}><span class="multi-filter-option-label" title="${esc(o.label)}">${esc(o.label)}</span>${o.count===null||o.count===undefined?'':`<small>${fmtInt.format(o.count)}</small>`}</label>`}).join('');
    }
  }

  /* The combined report is a real outlet-SKU relation, so a correct cascade
     evaluates the intersection rather than filtering the two lists separately. */
  function comboFactorizedOptions(comboDefs,universes){
    const result=new Map(),selectedOutlets=outletRowsForView('combo'),selectedSkus=skuRowsForView('combo');
    comboDefs.forEach(def=>{
      if(def.scope==='outlet'){
        const options=selectedSkus.length?collectOptions('combo',def).map(option=>({...option,count:option.count*selectedSkus.length})):[];
        result.set(def.key,options);
      }else if(def.scope==='sku'){
        const options=selectedOutlets.length?collectOptions('combo',def).map(option=>({...option,count:option.count*selectedOutlets.length})):[];
        result.set(def.key,options);
      }
    });
    const stockIndex=comboDefs.findIndex(def=>def.key==='stockBand'),dosIndex=comboDefs.findIndex(def=>def.key==='dosBand');
    // Reuse the pair index rather than repeating the whole outlet x SKU scan:
    // it already tallies every pair by stock status and coverage band, before
    // the pair-level filters and the search box are applied.
    const idx=buildComboIndex();
    const stockCounts=idx.stockAll,dosCounts=idx.dosAll;
    result.set('stockBand',universes[stockIndex].filter(option=>stockCounts.has(option.value)).map(option=>({...option,count:stockCounts.get(option.value)})));
    result.set('dosBand',universes[dosIndex].filter(option=>dosCounts.has(option.value)).map(option=>({...option,count:dosCounts.get(option.value)})));
    return result;
  }
  function comboCascadeOptions(comboDefs,universes){
    if(stateValue('combo','stockBand')===null&&stateValue('combo','dosBand')===null)return comboFactorizedOptions(comboDefs,universes);
    const allOutlets=reportingOutletMeta(),allSkus=DATA?.skus||[];
    const selectedOutlets=outletRowsForView('combo'),selectedSkus=skuRowsForView('combo');
    const selectedOutletFlags=new Uint8Array(allOutlets.length);selectedOutlets.forEach(outlet=>{selectedOutletFlags[outlet.index]=1});
    const outletWeights=new Uint32Array(allOutlets.length),skuWeights=new Uint32Array(allSkus.length);
    const stockState=stateValue('combo','stockBand'),dosState=stateValue('combo','dosBand');
    const stockSelected=stockState===null?null:new Set(stockState),dosSelected=dosState===null?null:new Set(dosState);
    const stockSelfCounts=new Map(),dosSelfCounts=new Map();
    const matches=(selected,value)=>selected===null||selected.has(value);

    for(const sku of selectedSkus){
      const bits=stockBits(sku),coverage=coverageDays(sku);if(!bits||!coverage)continue;
      for(const outlet of allOutlets){
        const stockValue=(bits[outlet.index>>3]>>(outlet.index&7))&1?'ge90':'lt60';
        const days=Number(coverage[outlet.index]),dosValue=bandKey(Number.isFinite(days)?coverageScore(days):0);
        const stockMatch=matches(stockSelected,stockValue),dosMatch=matches(dosSelected,dosValue);
        if(stockMatch&&dosMatch)outletWeights[outlet.index]++;
        if(selectedOutletFlags[outlet.index]){
          if(dosMatch)stockSelfCounts.set(stockValue,(stockSelfCounts.get(stockValue)||0)+1);
          if(stockMatch)dosSelfCounts.set(dosValue,(dosSelfCounts.get(dosValue)||0)+1);
        }
      }
    }
    for(let skuIndex=0;skuIndex<allSkus.length;skuIndex++){
      const bits=stockBits(allSkus[skuIndex]),coverage=coverageDays(allSkus[skuIndex]);if(!bits||!coverage)continue;
      let count=0;
      for(const outlet of selectedOutlets){
        const stockValue=(bits[outlet.index>>3]>>(outlet.index&7))&1?'ge90':'lt60';
        const days=Number(coverage[outlet.index]),dosValue=bandKey(Number.isFinite(days)?coverageScore(days):0);
        if(matches(stockSelected,stockValue)&&matches(dosSelected,dosValue))count++;
      }
      skuWeights[skuIndex]=count;
    }
    const skuIndexes=new Map(allSkus.map((row,index)=>[row,index]));
    const weightedOptions=(def,rows,weight)=>{
      const counts=new Map();
      rows.forEach(row=>{const amount=weight(row);if(!amount)return;const value=String(def.value(row));if(value)counts.set(value,(counts.get(value)||0)+amount)});
      return [...counts.entries()].map(([value,count])=>({value,label:formatOption(def,value),count})).sort(optionSort);
    };
    const result=new Map();
    comboDefs.forEach(def=>{
      if(def.scope==='outlet')result.set(def.key,weightedOptions(def,outletRowsForView('combo',def.key),row=>outletWeights[row.index]));
      else if(def.scope==='sku')result.set(def.key,weightedOptions(def,skuRowsForView('combo',def.key),row=>skuWeights[skuIndexes.get(row)]||0));
    });
    const stockIndex=comboDefs.findIndex(def=>def.key==='stockBand'),dosIndex=comboDefs.findIndex(def=>def.key==='dosBand');
    result.set('stockBand',universes[stockIndex].filter(option=>stockSelfCounts.has(option.value)).map(option=>({...option,count:stockSelfCounts.get(option.value)})));
    result.set('dosBand',universes[dosIndex].filter(option=>dosSelfCounts.has(option.value)).map(option=>({...option,count:dosSelfCounts.get(option.value)})));
    return result;
  }

  function initViewFilters(view){
    defs(view).forEach(def=>{
      if(!FILTER_WIDGETS.has(def.id)){const widget=new MultiFilter(view,def);if(widget.native)FILTER_WIDGETS.set(def.id,widget)}
    });
    if(view===VIEW_MODE)ensureCascades(view);
  }
  function markCascadesDirty(views){(views||[]).forEach(view=>CASCADE_DIRTY.add(view));if((views||[]).includes('combo'))COMBO_INDEX=null}
  function ensureCascades(view){if(CASCADE_DIRTY.has(view))updateCascades(view)}
  function updateCascades(view){
    if(CASCADE_LOCK||!DATA)return;CASCADE_LOCK=true;
    try{
      const viewDefs=defs(view),universes=viewDefs.map(def=>collectUniverse(view,def));let stateChanged=false;
      viewDefs.forEach((def,index)=>{stateChanged=reconcileState(view,def,universes[index])||stateChanged});
      const comboOptions=view==='combo'?comboCascadeOptions(viewDefs,universes):null;
      viewDefs.forEach((def,index)=>{
        const widget=FILTER_WIDGETS.get(def.id);if(!widget)return;
        widget.setData(comboOptions?.get(def.key)||collectOptions(view,def),universes[index]);
      });
      CASCADE_DIRTY.delete(view);
      if(stateChanged)saveState();
    }finally{CASCADE_LOCK=false}
  }
  function onFilterChanged(view,affectedViews=[view]){
    const affected=[...new Set(affectedViews)];
    markCascadesDirty(affected);
    ensureCascades(affected.includes(VIEW_MODE)?VIEW_MODE:view);saveState();
    if(affected.includes('sku'))resetViewTablePages('sku');
    if(affected.includes('outlet'))resetViewTablePages('outlet');
    if(affected.includes('combo')&&TABLE_STATE.comboDetailTable)TABLE_STATE.comboDetailTable.page=1;
    render();
  }

  /* ---- Overrides that let the existing analytics read multi-select state ---- */
  reportingOutletMeta=function(){
    if(REPORTING_OUTLET_META)return REPORTING_OUTLET_META;
    const codes=DATA?.detail_info?.reporting_outlet_codes||[];
    const byCode=new Map((DATA?.outlets||[]).map(r=>[String(r.outlet_code||'').trim(),r]));
    REPORTING_OUTLET_META=codes.map((code,index)=>{const key=String(code||'').trim(),r=byCode.get(key)||{};return {index,code:key,name:String(r.outlet_name||key),outlet_code:key,outlet_name:String(r.outlet_name||key),leader:String(r.leader||'Unassigned'),zone:String(r.zone||''),kvi:norm(r.kvi)==='yes'?'yes':'no'};});
    return REPORTING_OUTLET_META;
  };
  skuScopeOutletIndexes=function(){
    return reportingOutletMeta().filter(r=>defs('sku','outlet').every(def=>selectionMatches('sku',def.key,def.value(r)))).map(r=>r.index);
  };
  effectiveSkuRow=function(r){
    const indexes=skuScopeOutletIndexes(),meta=reportingOutletMeta();
    if(indexes.length===meta.length&&defs('sku','outlet').every(d=>stateValue('sku',d.key)===null))return r;
    const bits=stockBits(r),coverage=coverageDays(r);let available=0,dos=0;
    if(bits&&coverage){indexes.forEach(i=>{available+=(bits[i>>3]>>(i&7))&1;const c=Number(coverage[i]);dos+=Number.isFinite(c)?coverageScore(c):0})}
    return {...r,available_outlets:available,total_outlets:indexes.length,availability:indexes.length?available/indexes.length:0,_dos_value:dos,_scope_outlet_indexes:indexes};
  };
  filteredRows=function(){return outletRowsForView('outlet')};
  filteredSkus=function({ignoreType=false}={}){
    const rows=scopedSkuRows();
    return rows.filter(row=>defs('sku','sku').every(def=>(ignoreType&&def.key==='type')||selectionMatches('sku',def.key,def.value(row))));
  };

  populateSkuFilters=function(){dropZoneDefsIfAbsent();markCascadesDirty(['sku']);initViewFilters('sku')};
  populateOutletFilters=function(){markCascadesDirty(['outlet','combo']);initViewFilters('outlet');initViewFilters('combo')};
  refreshSkuOutletOptions=function(){updateCascades('sku')};
  refreshOutletSelectOptions=function(){updateCascades('outlet')};

  function activeFilterCount(view){return defs(view).filter(def=>stateValue(view,def.key)!==null).length}
  function filterChipV2(view,def){
    const state=stateValue(view,def.key);if(state===null)return'';
    const text=!state.length?'None selected':state.slice(0,2).map(v=>formatOption(def,v)).join(', ')+(state.length>2?` +${state.length-2}`:'');
    return `<button class="filter-chip removable" type="button" data-clear-filter="${view}:${def.key}" title="Remove the ${esc(def.label)} filter"><span>${esc(def.label)}: ${esc(text)}</span><b aria-hidden="true">×</b></button>`;
  }
  const SCOPE_LABEL={sku:'SKU & outlet scope',outlet:'outlets',combo:'outlet-SKU combinations'};
  updateFilterUI=function(){
    const chips=defs(VIEW_MODE).filter(def=>stateValue(VIEW_MODE,def.key)!==null).map(def=>filterChipV2(VIEW_MODE,def));
    const host=document.getElementById('activeFilterChips');
    if(host)host.innerHTML=chips.length?chips.join(''):`<span class="filter-chip neutral">All ${SCOPE_LABEL[VIEW_MODE]}</span>`;
    const count=activeFilterCount(VIEW_MODE);
    setActiveFilterBadge(count);
    const status=document.getElementById('filterStatus');
    if(status)status.textContent=count?`${count} active filter${count===1?'':'s'} · ${dynamicLabel()}`:`Nothing filtered · ${dynamicLabel()}`;
  };
  selectedFilterLabels=function(view){return defs(view).filter(def=>stateValue(view,def.key)!==null).map(def=>{const state=stateValue(view,def.key);return `${def.label}: ${state.length?state.map(v=>formatOption(def,v)).join(', '):'None selected'}`})};
  clearFilter=function(token){
    const parts=String(token||'').split(':'),view=parts.length>1?parts[0]:VIEW_MODE,key=parts.length>1?parts[1]:defById(token)?.def?.key;
    if(!key||!FILTER_STATE[view])return;const affected=setState(view,key,null);onFilterChanged(view,affected);
  };
  function resetFilters(views){
    const affected=new Set();
    views.forEach(view=>defs(view).forEach(def=>setState(view,def.key,null,{persist:false}).forEach(v=>affected.add(v))));saveState();
    markCascadesDirty([...affected]);ensureCascades(VIEW_MODE);Object.values(TABLE_STATE).forEach(s=>s.page=1);render();
  }
  resetAllFilters=function(){
    Object.keys(FILTER_STATE).forEach(view=>defs(view).forEach(def=>FILTER_STATE[view][def.key]=null));
    if(DATA){setDosDaysSilently(Number(DATA?.dos?.default_days)||1)}
    try{sessionStorage.removeItem('availabilityDosDays')}catch(_){}
    saveState();
    Object.keys(TABLE_CLICK_FILTERS).forEach(v=>Object.keys(TABLE_CLICK_FILTERS[v]).forEach(k=>TABLE_CLICK_FILTERS[v][k]='all'));
    Object.values(TABLE_STATE).forEach(st=>{const input=document.getElementById(st.searchId);if(input)input.value='';st.page=1});
    markCascadesDirty(['sku','outlet','combo']);ensureCascades(VIEW_MODE);render();
  };
  function setDosDaysSilently(days){
    const supported=DATA?.dos?.supported_days||[1];
    DOS_DAYS=supported.includes(Number(days))?Number(days):1;
    const a=document.getElementById('dosDaysSelect'),b=document.getElementById('dosDaysQuick');
    if(a)a.value=String(DOS_DAYS); if(b)b.value=String(DOS_DAYS);
  }

  /* ---------------------------- View switcher ---------------------------- */
  applyViewMode=function(mode,{openFilters=false,scroll=false}={}){
    const previous=VIEW_MODE;VIEW_MODE=['sku','outlet','combo'].includes(mode)?mode:'sku';localStorage.setItem('availabilityViewMode',VIEW_MODE);
    document.querySelectorAll('.dashboard-view-content').forEach(el=>el.hidden=el.id!==`${VIEW_MODE}ViewContent`);
    document.querySelectorAll('.view-filter').forEach(el=>el.hidden=!el.classList.contains(`view-filter-${VIEW_MODE}`));
    document.querySelectorAll('.view-switch-btn').forEach(btn=>{const active=btn.dataset.view===VIEW_MODE;btn.classList.toggle('active',active);btn.setAttribute('aria-selected',String(active))});
    const copy={
      sku:['SKU ANALYTICS','Type & SKU-wise availability',`Stock availability plus dynamic <strong data-dos-label>${dynamicLabel()}</strong>`],
      outlet:['OUTLET VIEW','Outlet performance',`Outlet performance · risk bands use <strong data-dos-label>${dynamicLabel()}</strong>`],
      combo:['OUTLET × SKU REPORT','Combined outlet-SKU performance',`Core, KVI &amp; Promo analysis · <strong data-dos-label>${dynamicLabel()}</strong>`]
    }[VIEW_MODE];
    document.getElementById('viewEyebrow').textContent=copy[0];document.getElementById('viewHeading').textContent=copy[1];document.getElementById('viewSubtitle').innerHTML=copy[2];
    updateDosLabels();updateFilterUI();
    if(DATA){ensureCascades(VIEW_MODE);if(previous!==VIEW_MODE)render()}
    if(openFilters)setSidebar(true);if(scroll)document.getElementById('dashboardViewHeader')?.scrollIntoView({behavior:'smooth',block:'start'});
  };

  /* ---------------------------- Outlet x SKU report ----------------------------
   * Every render used to rescan all outlet-SKU pairs, which made paging and
   * sorting cost a full pass over ~760k combinations. The matching pairs are now
   * built once per filter change into typed arrays and reused for metrics,
   * paging, sorting and export.
   * ------------------------------------------------------------------------- */
  TABLE_STATE.comboDetailTable={searchId:'comboTableSearch',rowsId:'comboTableRows',countId:'comboTableResultCount',pagerId:'comboTablePager',page:1};
  let COMBO_INDEX=null;
  let COMBO_ORDER=null;

  function comboPayloadReady(){const first=(DATA?.skus||[]).find(r=>r.stock_bits_b64&&r.coverage_days_f32_b64);return !!(first&&reportingOutletMeta().length)}
  function comboOutlets(){return reportingOutletMeta().filter(row=>defs('combo','outlet').every(def=>selectionMatches('combo',def.key,def.value(row))))}
  function comboSkus(){return (DATA?.skus||[]).filter(row=>defs('combo','sku').every(def=>selectionMatches('combo',def.key,def.value(row))))}
  function comboFilterKey(){
    return JSON.stringify([
      DOS_DAYS,
      defs('combo').map(def=>[def.key,stateValue('combo',def.key)]),
      (document.getElementById('comboTableSearch')?.value||'').trim().toLowerCase()
    ]);
  }
  function comboSearchText(outlet,sku,stockAvailable,dosPct){
    return `${outlet.code} ${outlet.name} ${outlet.leader} ${outlet.zone} ${outlet.kvi} ${sku.sku_code} ${sku.description} ${sku.type} ${sku.cat} ${sku.l3} ${stockAvailable?'available in stock':'unavailable out of stock'} ${bandLabel(bandKey(dosPct))}`.toLowerCase();
  }
  // Band keys as indexes: the inner loop runs once per outlet-SKU pair, so it
  // stays on numbers and typed arrays and touches no Maps or strings.
  const BAND_ORDER=['ge90','80-90','70-80','60-70','lt60'];
  function buildComboIndex(){
    const key=comboFilterKey();
    if(COMBO_INDEX&&COMBO_INDEX.key===key&&COMBO_INDEX.data===DATA)return COMBO_INDEX;
    const outlets=comboOutlets(),skus=comboSkus();
    const query=(document.getElementById('comboTableSearch')?.value||'').trim().toLowerCase();
    const capacity=Math.max(1,outlets.length*skus.length);
    const skuIdx=new Int32Array(capacity),outIdx=new Int32Array(capacity);
    const dosArr=new Float32Array(capacity),covArr=new Float32Array(capacity),stockArr=new Uint8Array(capacity);
    let n=0,stockTotal=0,dosTotal=0;
    const types=new Map();
    const bandTally=new Float64Array(5),stockTally=new Float64Array(2);
    // Hoist the pair-filter state out of the loop.
    const stockState=stateValue('combo','stockBand'),dosState=stateValue('combo','dosBand');
    const stockOk=new Uint8Array(2);
    stockOk[0]=stockState===null||stockState.includes('lt60')?1:0;
    stockOk[1]=stockState===null||stockState.includes('ge90')?1:0;
    const bandOk=new Uint8Array(5);
    for(let i=0;i<5;i++)bandOk[i]=dosState===null||dosState.includes(BAND_ORDER[i])?1:0;
    const dosWindow=Math.max(1,Number(DOS_DAYS)||1);
    const outletIndexes=new Int32Array(outlets.length);
    for(let o=0;o<outlets.length;o++)outletIndexes[o]=outlets[o].index;
    for(let s=0;s<skus.length;s++){
      const sku=skus[s],bits=stockBits(sku),coverage=coverageDays(sku);
      if(!bits||!coverage)continue;
      const typeName=String(sku.type||'Unknown');
      let bucket=types.get(typeName);
      if(!bucket){bucket={type:typeName,count:0,stock:0,dos:0};types.set(typeName,bucket)}
      for(let o=0;o<outlets.length;o++){
        const idx=outletIndexes[o];
        const stock=(bits[idx>>3]>>(idx&7))&1;
        const raw=coverage[idx],days=raw===raw?raw:0;
        const dosPct=days>=dosWindow?1:days/dosWindow;
        const band=dosPct>=.9?0:dosPct>=.8?1:dosPct>=.7?2:dosPct>=.6?3:4;
        stockTally[stock]++;bandTally[band]++;
        if(!stockOk[stock]||!bandOk[band])continue;
        if(query&&!comboSearchText(outlets[o],sku,stock,dosPct).includes(query))continue;
        skuIdx[n]=s;outIdx[n]=o;dosArr[n]=dosPct;covArr[n]=days;stockArr[n]=stock;n++;
        stockTotal+=stock;dosTotal+=dosPct;
        bucket.count++;bucket.stock+=stock;bucket.dos+=dosPct;
      }
    }
    const stockAll=new Map();
    if(stockTally[0])stockAll.set('lt60',stockTally[0]);
    if(stockTally[1])stockAll.set('ge90',stockTally[1]);
    const dosAll=new Map();
    for(let i=0;i<5;i++)if(bandTally[i])dosAll.set(BAND_ORDER[i],bandTally[i]);
    COMBO_INDEX={
      key,data:DATA,outlets,skus,count:n,
      skuIdx:skuIdx.subarray(0,n),outIdx:outIdx.subarray(0,n),
      dos:dosArr.subarray(0,n),cov:covArr.subarray(0,n),stock:stockArr.subarray(0,n),
      stockTotal,dosTotal,types:[...types.values()].filter(t=>t.count>0),
      stockAll,dosAll
    };
    COMBO_ORDER=null;
    return COMBO_INDEX;
  }
  // Text columns belong to either the outlet or the SKU, so ranking the (few
  // hundred) entities once turns every sort into a numeric one.
  const COMBO_SORT_SCOPE={
    outlet_code:['outlet',o=>o.code],outlet_name:['outlet',o=>o.name],leader:['outlet',o=>o.leader],
    zone:['outlet',o=>o.zone||''],kvi:['outlet',o=>o.kvi],
    sku_code:['sku',s=>String(s.sku_code??'')],description:['sku',s=>String(s.description||'')],
    type:['sku',s=>String(s.type||'')],cat:['sku',s=>String(s.cat||'')],l3:['sku',s=>String(s.l3||'')]
  };
  function comboSortedOrder(){
    const idx=buildComboIndex(),s=SORT_STATE.comboDetailTable||{};
    const cacheKey=`${s.key}|${s.dir}`;
    if(COMBO_ORDER&&COMBO_ORDER.key===cacheKey&&COMBO_ORDER.n===idx.count)return COMBO_ORDER.order;
    // Flipping only the direction is a reverse, not a re-sort.
    const flipped=`${s.key}|${s.dir==='asc'?'desc':'asc'}`;
    if(COMBO_ORDER&&COMBO_ORDER.key===flipped&&COMBO_ORDER.n===idx.count){
      const reversed=COMBO_ORDER.order.slice().reverse();
      COMBO_ORDER={key:cacheKey,n:idx.count,order:reversed};
      return reversed;
    }
    const order=new Uint32Array(idx.count);
    for(let i=0;i<idx.count;i++)order[i]=i;
    const dir=s.dir==='desc'?-1:1;
    let valueAt=null;
    if(s.key==='dos_pct')valueAt=i=>idx.dos[i];
    else if(s.key==='coverage_days')valueAt=i=>idx.cov[i];
    else if(s.key==='stock')valueAt=i=>idx.stock[i];
    else if(COMBO_SORT_SCOPE[s.key]){
      const [scope,get]=COMBO_SORT_SCOPE[s.key];
      const list=scope==='outlet'?idx.outlets:idx.skus;
      const ranked=list.map((row,i)=>[i,get(row)]).sort((a,b)=>String(a[1]).localeCompare(String(b[1]),undefined,{numeric:true,sensitivity:'base'}));
      const rank=new Int32Array(list.length);
      ranked.forEach(([originalIndex],position)=>{rank[originalIndex]=position});
      const source=scope==='outlet'?idx.outIdx:idx.skuIdx;
      valueAt=i=>rank[source[i]];
    }
    if(valueAt){
      const keys=new Float64Array(idx.count);
      for(let i=0;i<idx.count;i++)keys[i]=valueAt(i);
      order.sort((a,b)=>(keys[a]-keys[b])*dir||(a-b));
    }
    COMBO_ORDER={key:cacheKey,n:idx.count,order};
    return order;
  }
  function comboRowHtml(idx,i){
    const outlet=idx.outlets[idx.outIdx[i]],sku=idx.skus[idx.skuIdx[i]];
    const dosPct=idx.dos[i],days=idx.cov[i],stock=idx.stock[i];
    const tier=TIERS[bandKey(dosPct)];
    const zoneCell=ZONE_PRESENT?`<td>${esc(outlet.zone||'—')}</td>`:'';
    return `<tr><td>${esc(outlet.code)}</td><td title="${esc(outlet.name)}">${esc(outlet.name)}</td><td>${esc(outlet.leader)}</td>${zoneCell}<td>${outlet.kvi==='yes'?'<span class="badge yes">Yes</span>':'<span class="badge unknown">No</span>'}</td><td>${esc(sku.sku_code)}</td><td title="${esc(sku.description)}">${esc(sku.description)}</td><td><span class="type-badge ${typeClass(sku.type)}">${esc(sku.type||'—')}</span></td><td>${esc(sku.cat||'—')}</td><td>${esc(sku.l3||'—')}</td><td><span class="combo-stock ${stock?'yes':''}">${stock?'In stock':'Out of stock'}</span></td><td class="num">${days>9999?'No forecast':fmtQty.format(days)}</td><td class="num"><span class="pct ${pctClass(dosPct)}">${pct(dosPct)}</span></td><td>${esc(tier.label)}</td></tr>`;
  }
  function renderCombo(){
    if(!DATA)return;
    const notice=document.getElementById('comboDataNotice'),tbody=document.getElementById('comboTable');
    if(!tbody)return;
    const columns=ZONE_PRESENT?14:13;
    if(!comboPayloadReady()){
      notice.hidden=false;
      notice.textContent='This build predates the combined outlet-SKU payload. Run the "Refresh Availability Dashboard" workflow once; the updated builder generates it automatically.';
      tbody.innerHTML=`<tr><td colspan="${columns}" class="empty">The combined detail appears after the next data refresh.</td></tr>`;
      document.getElementById('comboKpiGrid').innerHTML='';document.getElementById('comboTypeGrid').innerHTML='';
      document.getElementById('comboExplorerCount').textContent='Awaiting refreshed data';
      return;
    }
    notice.hidden=true;
    const idx=buildComboIndex(),order=comboSortedOrder();
    const state=TABLE_STATE.comboDetailTable;
    const size=Math.max(1,Number(document.getElementById(state.rowsId)?.value)||25);
    const pages=Math.max(1,Math.ceil(idx.count/size));
    state.page=Math.min(Math.max(1,state.page),pages);
    const start=(state.page-1)*size,end=Math.min(idx.count,start+size);
    let html='';
    for(let i=start;i<end;i++)html+=comboRowHtml(idx,order[i]);
    tbody.innerHTML=html||`<tr><td colspan="${columns}" class="empty">No outlet-SKU combinations match the current filters. Clear a filter to see results.</td></tr>`;
    document.getElementById(state.countId).textContent=idx.count?`${fmtInt.format(start+1)}–${fmtInt.format(end)} of ${fmtInt.format(idx.count)}`:'No rows';
    const pager=document.getElementById(state.pagerId);
    pager.querySelector('span').textContent=`${fmtInt.format(state.page)} / ${fmtInt.format(pages)}`;
    pager.querySelector('[data-page-action="prev"]').disabled=state.page<=1;
    pager.querySelector('[data-page-action="next"]').disabled=state.page>=pages;
    document.getElementById('comboExplorerCount').textContent=`${fmtInt.format(idx.count)} combinations · ${fmtInt.format(idx.outlets.length)} outlets · ${fmtInt.format(idx.skus.length)} SKUs`;
    const stockPct=idx.count?idx.stockTotal/idx.count:0,dosPct=idx.count?idx.dosTotal/idx.count:0;
    document.getElementById('comboKpiGrid').innerHTML=[
      ['Combinations',fmtInt.format(idx.count),'Outlet-SKU rows after filters'],
      ['Stock availability',pct1(stockPct),'Share of rows with stock on hand'],
      [`DOS availability · ${DOS_DAYS}D`,pct1(dosPct),'Average coverage score per row'],
      ['Active filters',fmtInt.format(activeFilterCount('combo')),'Cascading selections']
    ].map(x=>`<div class="combo-kpi"><div class="label">${esc(x[0])}</div><div class="value">${esc(x[1])}</div><div class="sub">${esc(x[2])}</div></div>`).join('');
    document.getElementById('comboTypeGrid').innerHTML=idx.types.slice().sort((a,b)=>a.type.localeCompare(b.type)).map(x=>`<div class="type-card ${typeClass(x.type)}"><span class="type-top"><span class="type-badge ${typeClass(x.type)}">${esc(x.type)}</span><span>${fmtInt.format(x.count)} rows</span></span><span class="type-value ${pctClass(x.dos/x.count)}">${pct1(x.dos/x.count)}</span><span class="type-meta"><span>${DOS_DAYS}D DOS</span><span>Stock ${pct1(x.stock/x.count)}</span></span></div>`).join('');
    setSortIndicators('comboDetailTable');
  }

  render=function(){
    updateDosLabels();updateFilterUI();renderTableClickFilterUI();
    if(VIEW_MODE==='sku')renderSkuAnalytics();
    else if(VIEW_MODE==='outlet'){
      const rows=filteredRows();renderKPIs(rows);renderBands(rows);renderBottom(rows);renderOutlets(rows);renderZone(rows);
    }else renderCombo();
    renderQA();
  };
  const originalRenderTableForSort=renderTableForSort;
  renderTableForSort=function(tableId){if(tableId==='comboDetailTable')renderCombo();else originalRenderTableForSort(tableId)};
  const originalDoExport=doExport;
  doExport=function(kind){if(kind==='combo-detail'){exportComboCSV();return}originalDoExport(kind)};

  function exportComboCSV(){
    if(!comboPayloadReady()){alert('Run the dashboard refresh once before exporting the combined report.');return}
    const idx=buildComboIndex();
    if(!idx.count){alert('There is nothing to export — no outlet-SKU combination matches the current filters.');return}
    if(idx.count>EXPORT_CONFIRM_ROWS){
      const mb=Math.round(idx.count*APPROX_BYTES_PER_ROW/1048576);
      const ok=confirm(`This export contains ${idx.count.toLocaleString('en-US')} rows (roughly ${mb} MB).\n\nBuilding it can freeze this tab for a while and the file may be too large for Excel to open comfortably.\n\nNarrow the filters first for a smaller file, or press OK to download everything.`);
      if(!ok)return;
    }
    const order=comboSortedOrder();
    const header=['Outlet Code','Outlet Name','Leader',...(ZONE_PRESENT?['Zone']:[]),'KVI Outlet','SKU Code','SKU Description','SKU Type','Category','L-3','Stock Status','Coverage Days','DOS %','Coverage Tier'];
    const parts=['﻿'+header.join(',')+'\r\n'];
    let buffer=[];
    for(let i=0;i<idx.count;i++){
      const j=order[i],outlet=idx.outlets[idx.outIdx[j]],sku=idx.skus[idx.skuIdx[j]];
      const days=idx.cov[j],dosPct=idx.dos[j];
      buffer.push([
        outlet.code,outlet.name,outlet.leader,...(ZONE_PRESENT?[outlet.zone||'']:[]),
        outlet.kvi==='yes'?'Yes':'No',sku.sku_code,textCell(sku.description),textCell(sku.type),textCell(sku.cat),textCell(sku.l3),
        idx.stock[j]?'In stock':'Out of stock',
        days>9999?'No forecast':days.toFixed(2),
        (dosPct*100).toFixed(2),
        TIERS[bandKey(dosPct)].label
      ].map(csvCell).join(',')+'\r\n');
      if(buffer.length>=5000){parts.push(buffer.join(''));buffer=[]}
    }
    if(buffer.length)parts.push(buffer.join(''));
    const blob=new Blob(parts,{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`availability_${fileStamp()}_${DOS_DAYS}D_outlet_sku_${idx.count}_rows.csv`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  loadState();
  document.addEventListener('click',()=>FILTER_WIDGETS.forEach(widget=>widget.close()));
  document.getElementById('clearVisibleFilters')?.addEventListener('click',()=>resetFilters([VIEW_MODE]));
  document.getElementById('comboTableSearch')?.addEventListener('input',()=>{TABLE_STATE.comboDetailTable.page=1;COMBO_INDEX=null;renderCombo()});
  document.getElementById('comboTableRows')?.addEventListener('change',()=>{TABLE_STATE.comboDetailTable.page=1;renderCombo()});
  ['dosDaysSelect','dosDaysQuick','dosResetBtn'].forEach(id=>{
    document.getElementById(id)?.addEventListener('change',()=>{COMBO_INDEX=null;if(DATA){markCascadesDirty(['sku','outlet','combo']);ensureCascades(VIEW_MODE)}});
  });
  document.getElementById('dosResetBtn')?.addEventListener('click',()=>{COMBO_INDEX=null;if(DATA){markCascadesDirty(['sku','outlet','combo']);ensureCascades(VIEW_MODE)}});

  const remembered=localStorage.getItem('availabilityViewMode');if(['sku','outlet','combo'].includes(remembered))VIEW_MODE=remembered;
  applyViewMode(VIEW_MODE);
})();
