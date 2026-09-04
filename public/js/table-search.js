/**
 * Activates "Excel-like" behavior on every table rendered by ui.js's
 * table() helper: a live search box that filters rows by any cell text,
 * and click-to-sort column headers (numeric-aware).
 *
 * Call activateTables(root) once after any innerHTML render that may
 * contain .xl-table elements. Safe to call repeatedly — each table is
 * wired exactly once (guarded by a dataset flag) and re-synced on
 * every call so newly rendered tables pick up behavior immediately.
 */
import {makeCsvBlob,downloadBlob} from "./xlsx-writer.js";

function tableToCsvRows(table){
  const headers=[...table.querySelectorAll("thead th")].map(th=>th.querySelector("span")?.textContent??th.textContent);
  const tbody=table.querySelector("tbody");
  const rows=[...tbody.querySelectorAll("tr")].filter(tr=>tr.style.display!=="none");
  const dataRows=rows.map(tr=>[...tr.children].map(td=>td.textContent.trim()));
  return{headers,rows:dataRows,totalRows:tbody.querySelectorAll("tr").length};
}

function wireCsv(wrap){
  const btn=wrap.querySelector(".xl-table-csv");
  const table=wrap.querySelector("table");
  if(!btn||!table)return;
  btn.addEventListener("click",()=>{
    const {headers,rows}=tableToCsvRows(table);
    if(!rows.length){btn.textContent="No rows";setTimeout(()=>{btn.textContent="CSV";},1200);return;}
    const blob=makeCsvBlob(headers,rows);
    const heading=wrap.closest("section")?.querySelector("h3")?.textContent?.trim();
    const slug=(heading||"table").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"")||"table";
    downloadBlob(blob,`${slug}-${new Date().toISOString().slice(0,10)}.csv`);
  });
}

function cellSortValue(td){
  const raw=(td.textContent||"").trim();
  const numeric=raw.replace(/[,%\s]/g,"");
  const n=Number(numeric);
  if(numeric!==""&&Number.isFinite(n))return{isNum:true,val:n};
  return{isNum:false,val:raw.toLowerCase()};
}

function wireSort(wrap){
  const table=wrap.querySelector("table[data-sortable]");
  if(!table)return;
  const tbody=table.querySelector("tbody");
  const headers=[...table.querySelectorAll("th[data-col]")];
  let sortState={col:-1,dir:1};
  headers.forEach(th=>{
    th.style.cursor="pointer";
    th.addEventListener("click",()=>{
      const col=Number(th.dataset.col);
      sortState.dir=sortState.col===col?-sortState.dir:1;
      sortState.col=col;
      headers.forEach(h=>h.classList.remove("xl-sort-asc","xl-sort-desc"));
      th.classList.add(sortState.dir===1?"xl-sort-asc":"xl-sort-desc");
      const rows=[...tbody.querySelectorAll("tr")];
      rows.sort((a,b)=>{
        const av=cellSortValue(a.children[col]),bv=cellSortValue(b.children[col]);
        if(av.isNum&&bv.isNum)return(av.val-bv.val)*sortState.dir;
        return String(av.val).localeCompare(String(bv.val))*sortState.dir;
      });
      rows.forEach(r=>tbody.appendChild(r));
    });
  });
}

function wireSearch(wrap){
  const input=wrap.querySelector(".xl-table-search");
  const countEl=wrap.querySelector(".xl-table-count");
  const table=wrap.querySelector("table");
  if(!input||!table)return;
  const tbody=table.querySelector("tbody");
  function apply(){
    const q=input.value.trim().toLowerCase();
    const rows=[...tbody.querySelectorAll("tr")];
    let shown=0;
    for(const row of rows){
      const match=!q||row.textContent.toLowerCase().includes(q);
      row.style.display=match?"":"none";
      if(match)shown++;
    }
    if(countEl)countEl.textContent=q?`${shown.toLocaleString()} of ${rows.length.toLocaleString()} rows`:`${rows.length.toLocaleString()} rows`;
  }
  input.addEventListener("input",apply);
  apply();
}

export function activateTables(root=document){
  const wraps=root.querySelectorAll(".xl-table:not([data-xl-wired])");
  wraps.forEach(wrap=>{
    wrap.dataset.xlWired="1";
    wireSearch(wrap);
    wireSort(wrap);
    wireCsv(wrap);
  });
}
