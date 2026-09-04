export const $=(s,r=document)=>r.querySelector(s); export const $$=(s,r=document)=>[...r.querySelectorAll(s)];
export const fmt={n:(v,d=0)=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:d}),pct:v=>`${Number(v||0).toFixed(1)}%`,dos:v=>v===null||v===undefined||!Number.isFinite(v)?"N/A":Number(v).toFixed(2)};
export function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
export function statusBadge(s){const cls=String(s).toLowerCase().replace(/\s+/g,"-");return `<span class="badge status ${cls}">${esc(s)}</span>`}
export function classBadges(s){return [s.core&&"Core",s.kvi&&"KVI",s.promo&&"Promo"].filter(Boolean).map(x=>`<span class="badge cls ${x.toLowerCase()}">${x}</span>`).join(" ")}
export function availBadge(v){return v?'<span class="badge available">Available</span>':'<span class="badge unavailable">Unavailable</span>'}
export function kpi(label,value,sub="",tone="",breakdown=null){
  const valueHtml=breakdown
    ? `<button type="button" class="kpi-value kpi-value-btn" data-kpi-breakdown="${esc(JSON.stringify(breakdown))}">${value}</button>`
    : `<div class="kpi-value">${value}</div>`;
  return `<article class="kpi ${tone}"><div class="kpi-label">${esc(label)}</div>${valueHtml}${sub?`<div class="kpi-sub">${sub}</div>`:""}</article>`;
}
export function toast(msg,type="info"){const host=$("#toastHost");const el=document.createElement("div");el.className=`toast ${type}`;el.textContent=msg;host.appendChild(el);setTimeout(()=>el.remove(),4200)}
export class MultiSelect{
  constructor(host,{label,key,onChange}){this.host=host;this.label=label;this.key=key;this.onChange=onChange;this.selected=new Set();this.options=[];this.open=false;this.renderShell()}
  renderShell(){this.host.className="ms";this.host.innerHTML=`<button type="button" class="ms-btn" aria-expanded="false"><span><small>${esc(this.label)}</small><b class="ms-summary">All</b></span><span class="chev">⌄</span></button><div class="ms-panel"><input class="ms-search" type="search" placeholder="Search ${esc(this.label)}…"><div class="ms-actions"><button type="button" data-a="all">Select All</button><button type="button" data-a="clear">Clear</button><span class="ms-count"></span></div><div class="ms-list"></div></div>`;this.btn=$(".ms-btn",this.host);this.panel=$(".ms-panel",this.host);this.search=$(".ms-search",this.host);this.list=$(".ms-list",this.host);this.count=$(".ms-count",this.host);this.btn.onclick=e=>{e.stopPropagation();this.toggle()};this.search.oninput=()=>this.renderList();$("[data-a=all]",this.host).onclick=()=>{for(const o of this.filtered())this.selected.add(o.value);this.changed()};$("[data-a=clear]",this.host).onclick=()=>{this.selected.clear();this.changed()};this.list.onclick=e=>{const cb=e.target.closest("input[type=checkbox]");if(!cb)return;cb.checked?this.selected.add(cb.value):this.selected.delete(cb.value);this.changed(false)};document.addEventListener("click",e=>{if(!this.host.contains(e.target))this.close()})}
  filtered(){const q=this.search.value.trim().toLowerCase();return !q?this.options:this.options.filter(o=>o.label.toLowerCase().includes(q)||o.value.toLowerCase().includes(q))}
  setOptions(options){const map=new Map(options.map(o=>[String(o.value),{value:String(o.value),label:String(o.label)}]));for(const v of this.selected)if(!map.has(v))map.set(v,{value:v,label:v});this.options=[...map.values()];this.renderList();this.renderSummary()}
  setSelected(set){this.selected=new Set(set||[]);this.renderList();this.renderSummary()}
  renderList(){const rows=this.filtered();this.list.innerHTML=rows.length?rows.map(o=>`<label class="ms-item"><input type="checkbox" value="${esc(o.value)}" ${this.selected.has(o.value)?"checked":""}><span>${esc(o.label)}</span></label>`).join(""):'<div class="empty-mini">No matching values</div>';this.count.textContent=`${this.selected.size} selected`}
  renderSummary(){const s=$(".ms-summary",this.host);s.textContent=this.selected.size?`${this.selected.size} selected`:"All";this.count.textContent=`${this.selected.size} selected`}
  changed(rerender=true){this.renderSummary();if(rerender)this.renderList();this.onChange?.(this.key,new Set(this.selected))}
  toggle(){this.open=!this.open;this.host.classList.toggle("open",this.open);this.btn.setAttribute("aria-expanded",String(this.open));if(this.open){this.search.focus();this.renderList()}}
  close(){this.open=false;this.host.classList.remove("open");this.btn.setAttribute("aria-expanded","false")}
}
let tableSeq=0;
export function table(headers,rows){
  const id=`t${++tableSeq}`;
  return `<div class="xl-table" data-table-id="${id}"><div class="xl-table-bar"><input type="search" class="xl-table-search" placeholder="Search this table…" aria-label="Search table"><button type="button" class="xl-table-csv" title="Download this table as CSV (respects filters + search)">CSV</button><span class="xl-table-count"></span></div><div class="table-wrap"><table data-sortable="1"><thead><tr>${headers.map((h,i)=>`<th data-col="${i}"><span>${esc(h)}</span><i class="xl-sort-icon"></i></th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
}
export function emptyState(title="Loading…",text="Data is loading automatically from Google Drive."){return `<div class="empty-state"><div class="empty-icon">▦</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`}
