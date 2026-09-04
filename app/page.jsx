import DashboardBoot from './DashboardBoot';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] || '';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || (process.env.GITHUB_ACTIONS === 'true' && repository ? `/${repository}` : '');
const runtimeConfig = { basePath };

export default function HomePage() {
  return (
    <>
      <div className="app" id="appRoot">
        <aside className="sidebar" id="sidebar">
          <div className="brand">
            <div className="brand-mark">A</div>
            <div>
              <h1>Availability</h1>
              <small>Core · KVI · Promo · Ecom</small>
            </div>
          </div>
          <nav className="nav" id="nav">
            <button data-page="summary" className="active">▦ <span>Summary</span></button>
            <div className="nav-sep" />
            <button data-page="sku">▧ <span>SKU Wise Availability</span></button>
            <button data-page="core" className="nav-sub">C <span>Core</span></button>
            <button data-page="promo" className="nav-sub">P <span>Promo</span></button>
            <button data-page="kvi" className="nav-sub">K <span>KVI</span></button>
            <button data-page="ecomSku">▧ <span>SKU Wise Availability for Ecom</span></button>
            <div className="nav-sep" />
            <button data-page="division">◫ <span>Product Division</span></button>
            <button data-page="cat3">▤ <span>CAT3</span></button>
            <button data-page="rho">▣ <span>RHO</span></button>
            <button data-page="zonal">▣ <span>Zonal</span></button>
            <button data-page="outlet">▦ <span>Outlets</span></button>
            <div className="nav-sep" />
            <button data-page="lossTree">⊞ <span>Availability Loss Tree</span></button>
            <button data-page="exceptions">! <span>Exceptions</span></button>
            <button data-page="health">✓ <span>Data Health</span></button>
          </nav>
          <div className="side-note">One global filter state. Core/KVI/Promo and Ecom use separate assortment universes.</div>
        </aside>

        <main className="main">
          <header className="topbar">
            <div className="topbar-title">
              <b>Core · KVI · Promo Availability Tracker</b>
              <span id="dataStatus">Loading dashboard data…</span>
            </div>
            <div className="topbar-right">
              <div className="dos-box dos-box-top">
                <label htmlFor="dosSelect">Required DOS</label>
                <div className="dos-row">
                  <select id="dosSelect" defaultValue="2" className="btn-sm btn-red">
                    <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="5">5</option><option value="7">7</option><option value="custom">Custom</option>
                  </select>
                  <input id="dosCustom" type="number" min="0.01" step="0.1" defaultValue="2" hidden className="btn-sm" />
                </div>
              </div>
              <div className="dos-box dos-box-top dos-box-ecom" title="Ecom availability is stock-quantity based: a slot is available only when stock meets this threshold, independent of DOS/sales.">
                <label htmlFor="ecomStockSelect">Required Ecom Stock</label>
                <div className="dos-row">
                  <select id="ecomStockSelect" defaultValue="5" className="btn-sm btn-teal">
                    <option value="3">3</option><option value="5">5</option><option value="10">10</option><option value="15">15</option><option value="custom">Custom</option>
                  </select>
                  <input id="ecomStockCustom" type="number" min="0" step="1" defaultValue="5" hidden className="btn-sm" />
                </div>
              </div>
              <div className="view-actions">
                <button className="btn btn-sm" id="toggleSidebarBtn" type="button">Hide Sidebar</button>
                <button className="btn btn-sm" id="toggleThemeBtn" type="button">Dark Mode</button>
              </div>
              <div className="actions">
                <button className="btn btn-sm" id="xlsxBtn" disabled>Excel</button>
                <button className="btn btn-sm" id="pdfBtn" disabled>PDF Summary</button>
                <button className="btn btn-sm primary" id="resetBtn" disabled>Reset Filters</button>
              </div>
            </div>
          </header>

          <div className="content">
            <section className="filters-card" id="filtersCard">
              <div className="filters-head">
                <h3>Global Filters</h3>
                <button className="btn btn-sm btn-accent" id="toggleFiltersBtn" type="button">Hide Filters</button>
                <small>Searchable · multi-select · cascading · applies to Ecom where fields are available</small>
              </div>
              <div className="filters" id="filters">
                <div data-filter="category" /><div data-filter="category3" /><div data-filter="sku" /><div data-filter="classification" />
                <div data-filter="rho" /><div data-filter="zonal" /><div data-filter="zone" /><div data-filter="division" />
                <div data-filter="district" /><div data-filter="outlet" /><div data-filter="storeType" /><div data-filter="locationType" />
                <div data-filter="outletType" /><div data-filter="kviOutlet" /><div data-filter="status" />
              </div>
            </section>
            <div id="view" />
          </div>
        </main>
      </div>

      <div className="modal" id="drillModal">
        <div className="modal-box">
          <div className="modal-head"><h3 id="drillTitle">Drill-down</h3><button className="modal-close" data-close="true">×</button></div>
          <div id="drillBody" />
        </div>
      </div>

      <div className="loader" id="loader"><div className="loader-box"><div className="spinner" /><b>Processing data</b><p id="loaderText">Preparing…</p></div></div>
      <div className="toast-host" id="toastHost" />

      <DashboardBoot runtimeConfig={runtimeConfig} />
    </>
  );
}
