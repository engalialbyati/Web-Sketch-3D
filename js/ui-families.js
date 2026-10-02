'use strict';
// ---------------------------------------------------------------------------
// ui-families.js — the floating & dockable "Families" palette.
//
// A design catalog over the parametric Column families (columnFamilies.js):
// grouped cards (Classical / Regional / Modern / Structural) with generated
// elevation thumbnails. Click a card, type the dimensions (width, depth and
// family-specific ones like the drop-panel size), then
//
//   • Save Type      → the sized type joins the Element Browser catalog
//   • Save & Place   → same, and the Column tool arms immediately — click in
//                      the viewport (grid snaps work) to place instances
//
// Nothing here owns geometry: the families are pure data, placement goes
// through the standard Column tool → StructuralManager → B-Rep kernel path,
// so placed columns weld into slabs, join the undo stack and appear in the
// Element Browser like every other element. Columns only for now — the panel
// is group-driven, so doors/windows/beam families can join later.
//
// Chrome matches the Element Browser / Layers palettes: drag by the header to
// float, drop at a viewport edge to dock, double-click to switch sides,
// collapse with ▾, hide with ✕ (reopen from the toolbar).
// ---------------------------------------------------------------------------
(function () {
  const $ = id => document.getElementById(id);
  const LS_KEY = 'ws3d-fampanel';

  const state = {
    group: 'all',        // active catalog filter
    search: '',
  };

  let panel = null, gridEl = null, searchEl = null, dockApi = null;

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const CF = () => window.ColumnFamilies;

  // ------------------------------------------------------------- persistence
  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        group: state.group,
      }));
    } catch (e) { }
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s) Object.assign(state, {
        group: s.group || 'all',
      });
    } catch (e) { }
  }

  // -------------------------------------------------------------- thumbnails
  /** Elevation silhouette SVG for a family at its default dims — the same
   *  parts() stack the 3D placement builds, flattened to X/Z. */
  function thumbSVG(fam, w = 76, h = 76) {
    const cf = CF();
    if (!cf) return '';
    const H = 3;
    const elev = cf.elevation(fam.id, cf.defaults(fam.id), H);
    if (!elev.length) return '';
    let x0 = Infinity, x1 = -Infinity;
    for (const s of elev) { x0 = Math.min(x0, s.x0); x1 = Math.max(x1, s.x1); }
    const cx = (x0 + x1) / 2;
    // catalog readability beats strict proportion: the story always fills the
    // cell height, the plan width stretches so a 300 mm shaft stays visible
    // (capped at 2.5× so silhouettes never turn squat)
    const zs = 60 / H;
    const xs = Math.min(44 / Math.max(0.05, x1 - x0), 2.5 * zs);
    const X = x => 38 + (x - cx) * xs;
    const Z = z => 68 - z * zs; // ground line at y = 68
    const ROLE_FILL = { base: '#93b1e0', shaft: '#7d9bd6', capital: '#5d82c4', panel: '#8fa8dc' };
    const rects = elev.map(s =>
      `<rect x="${X(s.x0).toFixed(1)}" y="${Z(s.z1).toFixed(1)}" width="${(X(s.x1) - X(s.x0)).toFixed(1)}" height="${(Z(s.z0) - Z(s.z1)).toFixed(1)}" rx="0.7" fill="${ROLE_FILL[s.role] || '#7d9bd6'}"/>`
    ).join('');
    return `<svg class="fam-thumb" viewBox="0 0 76 76" width="${w}" height="${h}" aria-hidden="true">
      <line x1="6" y1="69" x2="70" y2="69" stroke="#b9c4d6" stroke-width="1"/>
      <g stroke="#3e66c4" stroke-width="0.7">${rects}</g>
    </svg>`;
  }

  // ------------------------------------------------------------------- cards
  function renderGrid() {
    const cf = CF();
    if (!gridEl || !cf) return;
    const q = state.search.trim().toLowerCase();
    const list = cf.list.filter(f =>
      (state.group === 'all' || f.group === state.group) &&
      (!q || (f.name + ' ' + f.desc + ' ' + f.group).toLowerCase().includes(q)));
    gridEl.innerHTML = list.map(f => {
      const grp = (cf.groups.find(g => g.id === f.group) || {}).name || '';
      return `<div class="fam-card" data-fam="${esc(f.id)}" title="${esc(f.name)} — ${esc(f.desc)}">
        ${thumbSVG(f)}
        <div class="fam-name">${esc(f.name)}</div>
        <div class="fam-grp">${esc(grp)}</div>
      </div>`;
    }).join('') || '<div class="elb-empty" style="grid-column:1/-1">No designs match</div>';
  }

  // ------------------------------------------------------------------ dialog
  /** Dimensions dialog for one family: every parametric input (mm ↔ m),
   *  the top constraint, then Save Type / Save & Place. */
  function familyDialog(fam) {
    const app = window.app;
    const cf = CF();
    if (!app || !app.db || !cf) return;
    if (app._eip) { app.toast('Finish or cancel Edit In Place first', true); return; }
    if (app.mode !== 'bim') app.setMode('bim');
    const levels = (app.levelManager && app.levelManager.levels) || [];
    const defs = cf.defaults(fam.id);

    const row = prm => {
      const isMM = (prm.unit || 'mm') === 'mm';
      const val = isMM ? Math.round(defs[prm.key] * 1000) : defs[prm.key];
      return `<label class="fam-row">
        <span class="fam-row-l">${esc(prm.label)}</span>
        <input type="number" class="fam-dim" data-key="${esc(prm.key)}" data-unit="${prm.unit || 'mm'}"
          value="${val}" step="${isMM ? 10 : prm.unit === 'n' ? 1 : 0.1}"
          min="${isMM ? Math.round((prm.min || 0.02) * 1000) : (prm.min || 0)}">
        <span class="fam-row-u">${isMM ? 'mm' : prm.unit === 'x' ? '×' : ''}</span>
      </label>`;
    };

    app.dialog(`Column Family — ${esc(fam.name)}`, `
      <div class="fam-dlg-head">
        ${thumbSVG(fam, 64, 64)}
        <div>
          <div class="ob-lab">${esc(fam.name)} <span class="fam-grp-badge">${esc((cf.groups.find(g => g.id === fam.group) || {}).name || '')}</span></div>
          <p class="fam-desc">${esc(fam.desc)}</p>
        </div>
      </div>
      <div class="ob-lab" style="margin-top:6px">Dimensions</div>
      ${fam.params.map(row).join('')}
      <label class="fam-row">
        <span class="fam-row-l">Top level</span>
        <select id="fam-top" class="fam-top">
          <option value="unconnected">Unconnected — fixed height</option>
          ${levels.map((l, i) => `<option value="${esc(l.id)}"${i === 1 ? ' selected' : ''}>${esc(l.name)} · ${(+l.elevation).toFixed(2)} m</option>`).join('')}
        </select>
        <span class="fam-row-u"></span>
      </label>
      <label class="fam-row" id="fam-h-row" style="display:none">
        <span class="fam-row-l">Height</span>
        <input type="number" id="fam-height" value="3000" step="50" min="100">
        <span class="fam-row-u">mm</span>
      </label>
      <p class="fam-note">Width × Depth set the shaft; every tier (base, capital, drop panel…) scales from them. Save Type files it in the Element Browser; Save &amp; Place also arms the Column tool — click in the model to place (grid snaps bind to grids).</p>
    `, [
      ['Cancel', null],
      ['Save Type', () => saveFamilyType(fam, false)],
      ['Save & Place', () => saveFamilyType(fam, true)],
    ]);

    const top = $('fam-top'), hRow = $('fam-h-row');
    if (top) top.addEventListener('change', () => {
      hRow.style.display = top.value === 'unconnected' ? '' : 'none';
    });
    // panel inputs must not reach the app hotkeys
    panel.querySelectorAll('input,select').forEach(el => {
      el.addEventListener('keydown', ev => ev.stopPropagation());
    });
  }

  async function saveFamilyType(fam, place) {
    const app = window.app;
    const cf = CF();
    if (!app || !cf) return;
    const raw = {};
    let bad = false;
    document.querySelectorAll('.fam-dim').forEach(inp => {
      const v = parseFloat(inp.value);
      const key = inp.dataset.key;
      if (!isFinite(v) || v <= 0) { bad = true; return; }
      raw[key] = inp.dataset.unit === 'mm' ? v / 1000 : v; // mm -> m
    });
    if (bad) { app.toast('Dimensions must be positive numbers', true); return; }
    const norm = cf.normalize(fam.id, raw);
    const params = Object.assign({ family: fam.id, material: 'Concrete' }, norm);

    const top = $('fam-top');
    if (top && top.value !== 'unconnected') params.topLevel = top.value;
    else {
      const h = parseFloat(($('fam-height') || {}).value);
      params.defaultHeight = isFinite(h) && h > 0 ? h / 1000 : 3;
    }

    const famId = fam.id === 'rect' ? 'fam_col_rect' : 'fam_col_' + fam.id;
    const name = `${fam.name} ${Math.round(norm.width * 1000)} x ${Math.round(norm.depth * 1000)}`
      + (fam.id === 'drop_panel' ? ` / ${Math.round(norm.dropWidth * 1000)} x ${Math.round(norm.dropDepth * 1000)} x ${Math.round(norm.dropThickness * 1000)}` : '');
    // a design family joins the catalog HERE — on the user's explicit save —
    // never by default seeding
    if (fam.id !== 'rect') await app.db.ensureFamily(famId, 'cat_column', fam.name + ' Column');
    await app.db.ensureType(famId, name, params);
    if (window.ElementBrowser && ElementBrowser.refresh) await ElementBrowser.refresh();
    if (place && window.ElementBrowser) {
      const cat = await app.db.getCatalog();
      const rec = cat.types.find(t => t.name === name && t.familyId === famId);
      if (rec) ElementBrowser.activateType({ typeId: rec.id });
      else app.setTool('column');
    }
    app.toast(`"${name}" ${place ? 'armed — click in the model to place' : 'added to the Element Browser'}`);
  }

  // ------------------------------------------------------------------- build
  function build() {
    panel = document.createElement('div');
    panel.id = 'fampanel';
    panel.innerHTML = `
      <div class="dk-head" id="fam-head">
        <span class="dk-grip">⋮⋮</span><span class="dk-title">Families</span>
        <button class="dk-btn dk-dockl" title="Dock left">◀</button>
        <button class="dk-btn dk-dockr" title="Dock right">▶</button>
        <button class="dk-btn dk-min" title="Collapse / expand">▾</button>
        <button class="dk-btn dk-x" title="Hide (reopen from the toolbar)">✕</button>
      </div>
      <div id="fam-body">
        <div class="elb-search">
          <input id="fam-search" type="text" placeholder="Search designs…" spellcheck="false">
        </div>
        <div id="fam-chips"></div>
        <div id="fam-grid"></div>
      </div>`;
    $('viewport').appendChild(panel);
    gridEl = panel.querySelector('#fam-grid');
    searchEl = panel.querySelector('#fam-search');
    dockApi = window.DockPanels ? DockPanels.make(panel, {
      key: 'fampanel', title: 'Families', side: 'left', onVisibility: () => renderGrid(),
    }) : null;

    // chips: All + the groups
    const chips = panel.querySelector('#fam-chips');
    const renderChips = () => {
      const cf = CF();
      if (!cf) return;
      const all = [{ id: 'all', name: 'All' }, ...cf.groups];
      chips.innerHTML = all.map(g =>
        `<button class="fam-chip${state.group === g.id ? ' on' : ''}" data-grp="${esc(g.id)}">${esc(g.name)}</button>`).join('');
    };
    renderChips();
    chips.addEventListener('click', ev => {
      const c = ev.target.closest('.fam-chip');
      if (!c) return;
      state.group = c.dataset.grp;
      renderChips();
      renderGrid();
      saveState();
    });

    searchEl.addEventListener('input', () => {
      state.search = searchEl.value;
      renderGrid();
    });
    // typing in the palette must not trigger app hotkeys / VCB
    searchEl.addEventListener('keydown', ev => ev.stopPropagation());

    gridEl.addEventListener('click', ev => {
      const card = ev.target.closest('.fam-card');
      if (!card) return;
      const fam = CF() && ColumnFamilies.get(card.dataset.fam);
      if (fam) familyDialog(fam);
    });

  }

  function setVisibility(on) {
    if (dockApi) dockApi.setVisible(on);
    if (window.app && app.refreshToolbar) app.refreshToolbar();
  }

  // (panel drag/dock chrome lives in ui-dock.js — DockPanels.make wired it)

  // -------------------------------------------------------------------- boot
  function boot() {
    if (!window.app || !window.ColumnFamilies) return; // waits for the app shell
    loadState();
    build();
    if (dockApi ? dockApi.isVisible() : true) renderGrid();
  }

  window.FamiliesPanel = {
    get visible() { return !!(dockApi && dockApi.isVisible()); },
    toggle(force) { if (panel) setVisibility(force); },
    refresh() { if (panel) { renderGrid(); } },
  };
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();
