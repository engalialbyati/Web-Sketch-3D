'use strict';
// ---------------------------------------------------------------------------
// ui-browser.js — the floating & dockable "Element Browser" palette.
//
// AutoCAD/Revit-style dynamic palette over the viewport:
//   • drag by its header anywhere on screen (floating window)
//   • drop near the left/right viewport border to snap-dock
//   • double-click the header to re-dock left; toolbar button hides/shows
//   • collapse (–) folds the body down to the header bar
//
// The body is the Category ➔ Family ➔ Type tree from the project database
// (db.js), with live element counts per category. Type rows carry the
// placement mapping:
//   • drag a type into the 3D viewport → its placement tool activates with
//     the type pre-loaded (dragging "Generic — 200 mm" arms the Wall tool
//     at 200 mm; a window type arms the Window tool at its WxH/sill)
//   • click a type row does the same
//   • expand a type to list its placed elements — click one to select it
//     in the model
// ---------------------------------------------------------------------------
(function () {
  const $ = id => document.getElementById(id);
  const LS_KEY = 'ws3d-elbrowser';

  const state = {
    visible: true,
    dock: 'left',        // 'left' | 'right' | 'float'
    x: 24, y: 24,        // float position (viewport-local px)
    collapsed: false,
    expanded: new Set(), // node keys ('cat:', 'fam:', 'typ:') that are open
    level: 'all',        // level filter: 'all' | level id
  };

  let panel = null, treeEl = null, catalog = null, counts = new Map(), elementsByType = new Map();
  let refreshTimer = null;

  // ------------------------------------------------------------- persistence
  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        visible: state.visible, dock: state.dock, x: state.x, y: state.y,
        collapsed: state.collapsed, expanded: [...state.expanded],
      }));
    } catch (e) { }
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s) Object.assign(state, {
        visible: s.visible !== false, dock: s.dock || 'left',
        x: s.x || 24, y: s.y || 24, collapsed: !!s.collapsed,
        expanded: new Set(s.expanded || []),
        level: s.level || 'all',
      });
    } catch (e) { }
  }

  // ------------------------------------------------------------------ build
  function build() {
    panel = document.createElement('div');
    panel.id = 'elbrowser';
    panel.innerHTML = `
      <div id="elb-head" title="Drag to float · drop at a screen edge to dock · double-click to dock left">
        <span class="elb-grip">⋮⋮</span>
        <span class="elb-title">Element Browser</span>
        <button class="elb-btn" id="elb-min" title="Collapse / expand">▾</button>
        <button class="elb-btn" id="elb-x" title="Hide (reopen from the toolbar)">✕</button>
      </div>
      <div id="elb-body">
        <div class="elb-search">
          <select id="elb-level" title="Show elements on one level only"></select>
          <input id="elb-filter" placeholder="Filter types…" spellcheck="false">
        </div>
        <div id="elb-tree"></div>
      </div>`;
    $('viewport').appendChild(panel);
    treeEl = panel.querySelector('#elb-tree');

    panel.querySelector('#elb-x').addEventListener('click', () => setVisibility(false));
    panel.querySelector('#elb-min').addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      applyLayout();
      saveState();
    });
    panel.querySelector('#elb-filter').addEventListener('input', () => renderTree());
    panel.querySelector('#elb-level').addEventListener('change', ev => {
      state.level = ev.target.value;
      saveState();
      refresh(); // counts and element lists are level-dependent
    });
    initPanelDrag();
    initViewportDrop();
  }

  function applyLayout() {
    panel.classList.toggle('collapsed', state.collapsed);
    panel.classList.toggle('docked-left', state.dock === 'left');
    panel.classList.toggle('docked-right', state.dock === 'right');
    panel.classList.toggle('floating', state.dock === 'float');
    if (state.dock === 'float') {
      const vp = $('viewport').getBoundingClientRect();
      state.x = Math.max(4, Math.min(state.x, vp.width - 80));
      state.y = Math.max(4, Math.min(state.y, vp.height - 40));
      panel.style.left = state.x + 'px';
      panel.style.top = state.y + 'px';
    } else {
      panel.style.left = panel.style.top = '';
    }
    panel.querySelector('#elb-min').textContent = state.collapsed ? '▸' : '▾';
  }

  function setVisibility(on) {
    state.visible = on != null ? on : !state.visible;
    panel.classList.toggle('hidden', !state.visible);
    if (state.visible) refresh();
    saveState();
    if (window.app && app.refreshToolbar) app.refreshToolbar();
  }

  // ------------------------------------------------------- panel drag / dock
  function initPanelDrag() {
    const head = panel.querySelector('#elb-head');
    let drag = null;
    head.addEventListener('pointerdown', ev => {
      if (ev.target.closest('.elb-btn')) return;
      if (ev.button !== 0) return;
      const pr = panel.getBoundingClientRect();
      const vp = $('viewport').getBoundingClientRect();
      drag = {
        dx: ev.clientX - pr.left, dy: ev.clientY - pr.top,
        vw: vp.width, vh: vp.height, moved: false,
      };
      head.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    head.addEventListener('pointermove', ev => {
      if (!drag) return;
      drag.moved = true;
      const vp = $('viewport').getBoundingClientRect();
      let x = ev.clientX - vp.left - drag.dx;
      let y = ev.clientY - vp.top - drag.dy;
      x = Math.max(-40, Math.min(x, drag.vw - 60));
      y = Math.max(0, Math.min(y, drag.vh - 36));
      // live edge preview while dragging near a border
      const nearL = ev.clientX - vp.left < 42, nearR = vp.right - ev.clientX < 42;
      panel.classList.toggle('dock-preview-left', nearL);
      panel.classList.toggle('dock-preview-right', nearR);
      panel.classList.remove('docked-left', 'docked-right');
      panel.classList.add('floating');
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      state.x = x; state.y = y; state.dock = 'float';
    });
    const end = ev => {
      if (!drag) return;
      panel.classList.remove('dock-preview-left', 'dock-preview-right');
      const vp = $('viewport').getBoundingClientRect();
      if (drag.moved) {
        if (ev.clientX - vp.left < 42) state.dock = 'left';
        else if (vp.right - ev.clientX < 42) state.dock = 'right';
      }
      drag = null;
      applyLayout();
      saveState();
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', ev => {
      if (ev.target.closest('.elb-btn')) return;
      state.dock = state.dock === 'left' ? 'right' : 'left';
      applyLayout();
      saveState();
    });
  }

  // ------------------------------------------------- drag a type → viewport
  function initViewportDrop() {
    const vp = $('viewport');
    vp.addEventListener('dragover', ev => {
      if (!ev.dataTransfer || ![...ev.dataTransfer.types].includes('application/x-ws-type')) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      vp.classList.add('elb-drop');
    });
    vp.addEventListener('dragleave', ev => {
      if (ev.target === vp) vp.classList.remove('elb-drop');
    });
    vp.addEventListener('drop', ev => {
      vp.classList.remove('elb-drop');
      let payload = null;
      try { payload = JSON.parse(ev.dataTransfer.getData('application/x-ws-type')); } catch (e) { }
      if (payload) activateType(payload);
    });
  }

  // The placement mapping: category ➔ tool, with the type's default
  // parameters pre-loaded into the tool's options. Falls back to direct db
  // lookups when the cached catalog hasn't seen the type yet (a type created
  // a moment ago must arm its tool on the first click, not the next refresh).
  async function activateType({ typeId } = {}) {
    const app = window.app;
    if (!app || !app.db) return;
    if (!catalog) {
      try { catalog = await app.db.getCatalog(); } catch (e) { return; }
    }
    let type = catalog.types.find(t => t.id === typeId);
    let fam = null, cat = null;
    if (type) {
      fam = catalog.families.find(f => f.id === type.familyId);
      cat = catalog.categories.find(c => c.id === (fam && fam.categoryId));
    } else {
      type = await app.db.getType(typeId).catch(() => null);
      if (!type) return;
      fam = await app.db.getFamily(type.familyId).catch(() => null);
      cat = await app.db.getCategory(fam && fam.categoryId).catch(() => null);
    }
    const catName = (cat && cat.name) || '';
    const p = type.defaultParameters || {};

    if (app._eip) { app.toast('Finish or cancel Edit In Place first', true); return; }
    if (app.mode !== 'bim') app.setMode('bim');

    if (catName === 'Wall' && fam && fam.id === 'fam_wall_opening') {
      app.bimOptions.hosted = app.bimOptions.hosted || {};
      if (p.width > 0) app.bimOptions.hosted.width = p.width;
      if (p.height > 0) app.bimOptions.hosted.height = p.height;
      if (p.sill != null) app.bimOptions.hosted.sill = p.sill;
      app.setTool('opening');
      app.toast(`Wall Opening tool — ${type.name}`);
    } else if (catName === 'Wall') {
      if (p.thickness > 0) app.bimOptions.thickness = p.thickness;
      if (p.topLevel) app.bimOptions.topConstraint = p.topLevel; // level-driven height
      else if (p.defaultHeight > 0) {
        app.bimOptions.topConstraint = 'unconnected';
        app.bimOptions.unconnectedHeight = p.defaultHeight;
      }
      app.setTool('wall');
      app.toast(`Wall tool — ${fam ? fam.name + ': ' : ''}${type.name}`);
    } else if (catName === 'Floor' || catName === 'Slab' || catName === 'Foundation') {
      app.setTool('floor');
      app.toast(`${catName} tool — ${type.name}`);
    } else if (catName === 'Door' || catName === 'Window') {
      const toolId = catName.toLowerCase();
      app.bimOptions.hosted = app.bimOptions.hosted || {};
      if (p.width > 0) app.bimOptions.hosted.width = p.width;
      if (p.height > 0) app.bimOptions.hosted.height = p.height;
      if (p.sill != null) app.bimOptions.hosted.sill = p.sill;
      // map the catalog family onto the loadable FamilyManager family of the
      // same label (its builder fills the opening), keeping the db id otherwise
      if (fam && app.families) {
        const fm = app.families.list.find(f => f.label === fam.name && f.kind === toolId);
        app.bimOptions.family = fm ? fm.id : fam.id;
      }
      app.setTool(toolId);
      app.toast(`${catName} tool — ${fam ? fam.name + ': ' : ''}${type.name}`);
    } else if (catName === 'Column' && window.Engine && Engine.features.get('column')) {
      const d = Engine.features.get('column');
      if (p.width > 0) d.state.width = p.width;
      if (p.depth > 0) d.state.depth = p.depth;
      // level-driven height: the column spans base -> top level elevation;
      // the typed height is only the unconnected fallback
      if (p.topLevel) {
        app.bimOptions.topConstraint = p.topLevel;
        d.state.height = Math.max(0.1, app.levelManager.getElevation(p.topLevel)
          - app.levelManager.getElevation(app.bimOptions.baseLevel)) || d.state.height;
      } else if (p.defaultHeight > 0) {
        app.bimOptions.topConstraint = 'unconnected';
        d.state.height = p.defaultHeight;
      }
      app.setTool('column');
      app.toast(`Column tool — ${type.name}`);
    } else if (catName === 'Structural Framing' && window.Engine && Engine.features.get('beam')) {
      // structural framing types drive the Beam tool: the type's default
      // parameters (profile + section dimensions) pre-load its feature state
      const d = Engine.features.get('beam');
      if (p.profile && ['rectangular', 't', 'l'].includes(p.profile)) d.state.profile = p.profile;
      if (p.height > 0) d.state.height = p.height;
      if (p.webWidth > 0) d.state.webWidth = p.webWidth;
      if (p.flangeWidth > 0) d.state.flangeWidth = p.flangeWidth;
      if (p.flangeThickness > 0) d.state.flangeThickness = p.flangeThickness;
      if (p.flangeSide) d.state.flangeSide = p.flangeSide;
      app.setTool('beam');
      const prof = { rectangular: 'Rectangular', t: 'T-Beam', l: 'L-Beam' }[d.state.profile] || d.state.profile;
      app.toast(`Beam tool — ${prof} ${Math.round(d.state.height * 1000)} mm`);
    } else {
      app.toast(`No placement tool for ${catName || 'that category'}`, true);
      return;
    }
    app.bimOptions.typeId = type.id;
    if (app.tool && app.tool.status) app.tool.status();
    if (app.tool && app.tool._replayLast) app.tool._replayLast();
  }

  // -------------------------------------------------------------- tree data
  async function refresh() {
    const app = window.app;
    if (!app || !app.db) return;
    try {
      catalog = await app.db.getCatalog();
      if (app.elements) app.elements._catalog = catalog;
      // level filter options follow the project levels (an unknown saved id
      // falls back to All instead of silently hiding everything)
      const sel = panel.querySelector('#elb-level');
      const levels = (app.levelManager && app.levelManager.levels) || [];
      if (sel) {
        if (!levels.some(l => l.id === state.level)) state.level = 'all';
        sel.innerHTML = '<option value="all">All Levels</option>' +
          levels.map(l => `<option value="${esc(l.id)}"${l.id === state.level ? ' selected' : ''}>${esc(l.name)} · ${(+l.elevation).toFixed(2)} m</option>`).join('');
        sel.value = state.level;
      }
      counts = new Map();
      elementsByType = new Map();
      for (const c of catalog.categories) {
        try {
          const res = await app.db.queryElementsByCategory(c.id);
          let n = 0;
          for (const el of res.elements) {
            if (state.level !== 'all' && el.levelId !== state.level) continue;
            n++;
            if (!elementsByType.has(el.typeId)) elementsByType.set(el.typeId, []);
            elementsByType.get(el.typeId).push(el);
          }
          counts.set(c.id, n);
        } catch (e) { }
      }
      renderTree();
    } catch (e) { /* db not ready yet — the db:ready event re-fires refresh */ }
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // category icons (small color chips — no external assets)
  const CAT_COLORS = {
    cat_wall: '#7b3fa0', cat_floor: '#0e8385', cat_slab: '#5b6470',
    cat_window: '#3e66c4', cat_door: '#a3502e', cat_foundation: '#8d6e63', cat_column: '#2e7d32',
    cat_framing: '#b35900',
  };

  // eye / lock toggles shared by every project row (elements, grids, levels)
  function flagBtns(kind, id, locked, hidden) {
    return `<button class="elb-flag f-eye${hidden ? ' off' : ''}" data-flag="hidden" data-kind="${kind}" data-id="${esc(id)}" title="${hidden ? 'Show in viewport' : 'Hide from viewport (display only)'}">${hidden ? '\u{1F648}' : '\u{1F441}'}</button>` +
      `<button class="elb-flag f-lock${locked ? ' on' : ''}" data-flag="locked" data-kind="${kind}" data-id="${esc(id)}" title="${locked ? 'Unlock (allow select / delete)' : 'Lock (no select, no delete, no edits)'}">${locked ? '\u{1F512}' : '\u{1F513}'}</button>`;
  }

  function renderTree() {
    if (!treeEl || !catalog) return;
    const app = window.app;
    const filter = (panel.querySelector('#elb-filter').value || '').toLowerCase();
    const exp = state.expanded;
    let html = '';
    // ---- project datums: levels and grid lines live here too ----
    const datumSection = (key, label, rows) => {
      const open = exp.has('sec:' + key);
      let h = `<div class="elb-node elb-cat${open ? ' open' : ''}" data-sec="${key}">
        <span class="elb-tw">${open ? '\u25BE' : '\u25B8'}</span>
        <span class="elb-ic" style="background:#64748b"></span>
        <span class="elb-lab">${label}</span>
        <span class="elb-count">${rows.length || ''}</span>
      </div>`;
      if (open) for (const r of rows) h += r;
      return h;
    };
    if (app) {
      const lvls = (app.levelManager && app.levelManager.levels) || [];
      const lvRows = lvls.filter(l => !filter || l.name.toLowerCase().includes(filter))
        .map(l => `<div class="elb-node elb-elem elb-datum" title="Level plane at ${(+l.elevation).toFixed(2)} m">
          <span class="elb-tw"></span>
          <span class="elb-lab">${esc(l.name)} <span class="elb-lvl">${(+l.elevation).toFixed(2)} m</span></span>
          ${flagBtns('level', l.id, !!l.locked, !!l.hidden)}
        </div>`);
      html += datumSection('levels', 'Levels', lvRows);
      // grid lines grouped per level: "Level 1" owns every grid whose
      // vertical extent shows at that level's elevation — the group header
      // carries MASTER eye/lock so 100 grids hide with one click
      const gm = app.gridManager;
      const grids = (gm && gm.grids) || [];
      const grRow = g => `<div class="elb-node elb-elem elb-datum" title="Grid ${esc(g.name)} (${esc(g.system || 'Main')})">
          <span class="elb-tw"></span>
          <span class="elb-lab">${esc(g.name)} <span class="elb-lvl">${esc(g.system || 'Main')}</span></span>
          ${flagBtns('grid', g.id, !!g.locked, !!g.hidden)}
        </div>`;
      let grHtml = '';
      if (grids.length) {
        // master over ALL grid lines rides on the section header row
        const allHidden = grids.every(g => g.hidden);
        const allLocked = grids.every(g => g.locked);
        const gOpen = exp.has('sec:grids');
        grHtml += `<div class="elb-node elb-cat${gOpen ? ' open' : ''}" data-sec="grids">
          <span class="elb-tw">${gOpen ? '\u25BE' : '\u25B8'}</span>
          <span class="elb-ic" style="background:#64748b"></span>
          <span class="elb-lab">Grid Lines</span>
          <span class="elb-count">${grids.length}</span>
          ${flagBtns('grids-all', 'all', allLocked, allHidden)}
        </div>`;
        if (gOpen) for (const lvl of lvls) {
          const atLevel = grids.filter(g => g.covers(lvl.elevation));
          if (!atLevel.length) continue;
          const matches = atLevel.filter(g => !filter || g.name.toLowerCase().includes(filter) || lvl.name.toLowerCase().includes(filter));
          if (!matches.length) continue;
          const lgOpen = exp.has('sec:grids:' + lvl.id);
          const lgHidden = atLevel.every(g => g.hidden);
          const lgLocked = atLevel.every(g => g.locked);
          grHtml += `<div class="elb-node elb-fam elb-levelgrp${lgOpen ? ' open' : ''}" data-sec="grids:${esc(lvl.id)}" title="Every grid line shown at ${esc(lvl.name)} (${(+lvl.elevation).toFixed(2)} m)">
            <span class="elb-tw">${lgOpen ? '\u25BE' : '\u25B8'}</span>
            <span class="elb-lab">${esc(lvl.name)} <span class="elb-lvl">${atLevel.length} grid${atLevel.length === 1 ? '' : 's'}</span></span>
            ${flagBtns('grid-level', lvl.id, lgLocked, lgHidden)}
          </div>`;
          if (lgOpen) for (const g of matches) grHtml += grRow(g);
        }
      }
      html += grHtml;
    }
    for (const cat of catalog.categories) {
      const fams = catalog.families.filter(f => f.categoryId === cat.id);
      const famsVisible = fams.filter(f => !filter ||
        catalog.types.some(t => t.familyId === f.id && t.name.toLowerCase().includes(filter)));
      if (filter && !famsVisible.length && !cat.name.toLowerCase().includes(filter)) continue;
      const cOpen = exp.has('cat:' + cat.id);
      const n = counts.get(cat.id) || 0;
      html += `<div class="elb-node elb-cat${cOpen ? ' open' : ''}" data-cat="${cat.id}">
        <span class="elb-tw">${cOpen ? '▾' : '▸'}</span>
        <span class="elb-ic" style="background:${CAT_COLORS[cat.id] || '#8a929a'}"></span>
        <span class="elb-lab">${esc(cat.name)}</span>
        <span class="elb-count">${n || ''}</span>
      </div>`;
      if (!cOpen) continue;
      for (const fam of (filter ? famsVisible : fams)) {
        const types = catalog.types.filter(t => t.familyId === fam.id &&
          (!filter || t.name.toLowerCase().includes(filter) || fam.name.toLowerCase().includes(filter)));
        if (!types.length && filter) continue;
        const fOpen = exp.has('fam:' + fam.id);
        html += `<div class="elb-node elb-fam${fOpen ? ' open' : ''}" data-fam="${fam.id}">
          <span class="elb-tw">${fOpen ? '▾' : '▸'}</span>
          <span class="elb-lab">${esc(fam.name)}</span>
        </div>`;
        if (!fOpen) continue;
        for (const ty of types) {
          const tOpen = exp.has('typ:' + ty.id);
          const els = elementsByType.get(ty.id) || [];
          html += `<div class="elb-node elb-type${tOpen ? ' open' : ''}" data-type="${ty.id}" draggable="true"
            title="Drag into the viewport to place · click to arm the tool">
            <span class="elb-tw">${els.length ? (tOpen ? '▾' : '▸') : '·'}</span>
            <span class="elb-lab">${esc(ty.name)}</span>
            ${els.length ? `<span class="elb-count">${els.length}</span>` : ''}
            <span class="elb-add" data-add-type="${ty.id}" title="Place more of this type">＋</span>
          </div>`;
          if (tOpen) {
            const app = window.app;
            const lvls = (app.levelManager && app.levelManager.levels) || [];
            const lvName = id => {
              const l = lvls.find(x => x.id === id);
              return l ? l.name : '';
            };
            for (const el of els) {
              const tag = state.level === 'all' && el.levelId
                ? `<span class="elb-lvl" title="${esc(lvName(el.levelId) || el.levelId)}">${esc(lvName(el.levelId) || el.levelId)}</span>` : '';
              const ent = app && app.bim ? app.bim.getEntityById(el.id) : null;
              html += `<div class="elb-node elb-elem${ent && ent.hidden ? ' is-hidden' : ''}" data-elem="${esc(el.id)}" title="Click to select in the model">
                <span class="elb-tw"></span>
                <span class="elb-lab">${esc(el.name || el.id)}</span>${tag}
                ${flagBtns('element', el.id, !!(ent && ent.locked), !!(ent && ent.hidden))}
                <span class="elb-add" data-add-type="${esc(el.typeId)}" title="Place another one like this">＋</span>
              </div>`;
            }
          }
        }
      }
    }
    html += `<div class="elb-node elb-newtype" title="Define a new type (e.g. Column 400 × 500 mm) and place it">
      <span class="elb-tw">＋</span>
      <span class="elb-lab">New Type…</span>
    </div>`;
    treeEl.innerHTML = html || '<div class="elb-empty">No matching types</div>';
  }

  function initTreeEvents() {
    treeEl.addEventListener('click', ev => {
      // eye / lock toggles — they never expand or select anything
      const flag = ev.target.closest('.elb-flag');
      if (flag) {
        ev.stopPropagation();
        const app = window.app;
        if (app && app.setItemFlags) {
          const isLock = flag.dataset.flag === 'locked';
          const cur = flag.classList.contains(isLock ? 'on' : 'off');
          app.setItemFlags(flag.dataset.kind, flag.dataset.id, { [flag.dataset.flag]: !cur });
        }
        return;
      }
      const node = ev.target.closest('.elb-node');
      if (!node) return;
      if (node.dataset.sec) {
        const k = 'sec:' + node.dataset.sec;
        state.expanded.has(k) ? state.expanded.delete(k) : state.expanded.add(k);
        saveState(); renderTree();
        return;
      }
      // the ＋ affordance places elements: on a type row it arms that type's
      // tool, on a placed element it places ANOTHER one like it
      const add = ev.target.closest('.elb-add');
      if (add) {
        ev.stopPropagation();
        // Grid selection active (Grid Place tool): the + places instances
        // ON the selected intersections/lines instead of just arming the
        // tool — occupied intersections are skipped, never duplicated
        const app2 = window.app;
        if (app2 && app2.placeTypeAtGridSelection && app2.placeTypeAtGridSelection(add.dataset.addType)) return;
        activateType({ typeId: add.dataset.addType });
        return;
      }
      if (node.classList.contains('elb-newtype')) { newTypeDialog(); return; }
      if (node.classList.contains('elb-cat')) {
        const k = 'cat:' + node.dataset.cat;
        state.expanded.has(k) ? state.expanded.delete(k) : state.expanded.add(k);
        saveState(); renderTree();
      } else if (node.classList.contains('elb-fam')) {
        const k = 'fam:' + node.dataset.fam;
        state.expanded.has(k) ? state.expanded.delete(k) : state.expanded.add(k);
        saveState(); renderTree();
      } else if (node.classList.contains('elb-type')) {
        // the twist (▸) lists placed elements; anywhere else arms the tool
        const hasEls = (elementsByType.get(node.dataset.type) || []).length > 0;
        if (ev.target.closest('.elb-tw') && hasEls) {
          const k = 'typ:' + node.dataset.type;
          state.expanded.has(k) ? state.expanded.delete(k) : state.expanded.add(k);
          saveState(); renderTree();
        } else {
          activateType({ typeId: node.dataset.type });
        }
      } else if (node.classList.contains('elb-elem')) {
        const app = window.app;
        if (app && app.selectElement) {
          if (app._eip) { app.toast('Finish Edit In Place first', true); return; }
          app.selectElement(node.dataset.elem);
          app.view.zoomExtents();
        }
      }
    });
    treeEl.addEventListener('dragstart', ev => {
      const node = ev.target.closest('.elb-type');
      if (!node) { ev.preventDefault(); return; }
      ev.dataTransfer.setData('application/x-ws-type', JSON.stringify({ typeId: node.dataset.type }));
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setDragImage(node, 14, 10);
    });
    treeEl.addEventListener('dragend', () => $('viewport').classList.remove('elb-drop'));
  }

  // -------------------------------------------------- new type (place more)
  // Define a type with custom dimensions (e.g. Column 400 × 500 mm) straight
  // from the browser: it lands in the catalog under the right family and the
  // placement tool arms immediately, so "add more elements" is one dialog.
  const NEW_TYPE_CATS = [
    { id: 'cat_column', fam: 'fam_col_rect', label: 'Column', dims: [['width', 'Width', 300], ['depth', 'Depth', 300]], levelTop: true, fallback: [['defaultHeight', 'Height (unconnected)', 3000]] },
    { id: 'cat_wall', fam: 'fam_wall_basic', label: 'Wall', dims: [['thickness', 'Thickness', 200]], levelTop: true, fallback: [['defaultHeight', 'Height (unconnected)', 3000]] },
    { id: 'cat_slab', fam: 'fam_slab_structural', label: 'Slab', dims: [['thickness', 'Thickness', 250]] },
    { id: 'cat_floor', fam: 'fam_floor_generic', label: 'Floor', dims: [['thickness', 'Thickness', 200]] },
    { id: 'cat_door', fam: 'fam_door_single', label: 'Door', dims: [['width', 'Width', 900], ['height', 'Height', 2100], ['sill', 'Sill', 0]] },
    { id: 'cat_window', fam: 'fam_window_fixed', label: 'Window', dims: [['width', 'Width', 1200], ['height', 'Height', 1500], ['sill', 'Sill', 900]] },
  ];
  function newTypeDialog() {
    const app = window.app;
    if (!app || !app.db || !catalog) return;
    if (app._eip) { app.toast('Finish Edit In Place first', true); return; }
    if (app.mode !== 'bim') app.setMode('bim');
    const levels = (app.levelManager && app.levelManager.levels) || [];
    const dimRow = ([k, lab, def]) => `
      <label style="display:flex;align-items:center;gap:8px;margin:4px 0">
        <span style="width:110px;opacity:.8">${lab}</span>
        <input type="number" class="nt-dim" data-key="${k}" value="${def}" step="10" min="10"
          style="flex:1;padding:3px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
        <span style="opacity:.6">${k === 'sill' ? 'mm' : 'mm'}</span>
      </label>`;
    const groups = NEW_TYPE_CATS.map((c, i) => `
      <div class="nt-group" data-cat="${c.id}" style="${i ? 'display:none' : ''};margin:6px 0 10px">
        ${c.dims.map(dimRow).join('')}
        ${c.levelTop ? `
        <label style="display:flex;align-items:center;gap:8px;margin:4px 0">
          <span style="width:110px;opacity:.8">Top level</span>
          <select class="nt-top" style="flex:1;padding:3px 6px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
            <option value="unconnected">Unconnected — fixed height</option>
            ${levels.map(l => `<option value="${esc(l.id)}"${i === 0 && levels[1] && l.id === levels[1].id ? ' selected' : ''}>${esc(l.name)} · ${(+l.elevation).toFixed(2)} m</option>`).join('')}
          </select>
        </label>
        <div class="nt-fb" style="display:none">${(c.fallback || []).map(dimRow).join('')}</div>` : ''}
      </div>`).join('');
    app.dialog('New Element Type', `
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="width:110px;opacity:.8">Category</span>
        <select id="nt-cat" style="flex:1;padding:3px 6px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
          ${NEW_TYPE_CATS.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
        </select>
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="width:110px;opacity:.8">Type name</span>
        <input type="text" id="nt-name" placeholder="auto from dimensions"
          style="flex:1;padding:3px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
      </label>
      <div class="ob-lab">Dimensions</div>
      ${groups}
      <p style="opacity:.7;margin:4px 0 0;font-size:12px">Top level drives the height (level elevation difference); the fixed height only applies when Unconnected. The type joins the catalog; its placement tool arms immediately.</p>
    `, [
      ['Cancel', null],
      ['Add & Place', async () => {
        const catId = document.getElementById('nt-cat').value;
        const c = NEW_TYPE_CATS.find(x => x.id === catId);
        const grp = document.querySelector(`.nt-group[data-cat="${catId}"]`);
        if (!c || !grp) return;
        const params = {};
        let bad = false;
        for (const [k] of c.dims.concat(c.fallback || [])) {
          const inp = grp.querySelector(`.nt-dim[data-key="${k}"]`);
          if (!inp) continue;
          const v = parseFloat(inp.value);
          if (!(v > 0) && k !== 'sill') bad = true;
          params[k] = v / 1000; // mm -> m
        }
        if (c.levelTop) {
          const top = grp.querySelector('.nt-top').value;
          if (top !== 'unconnected') {
            params.topLevel = top;
            delete params.defaultHeight; // level heights win
          }
        }
        if (bad) { app.toast('Dimensions must be positive', true); return; }
        const dims = c.dims.map(([k]) => Math.round(params[k] * 1000)).join(' × ');
        const topName = params.topLevel
          ? ' → ' + (levels.find(l => l.id === params.topLevel) || {}).name
          : '';
        const name = (document.getElementById('nt-name').value || '').trim() || `${c.label} ${dims}${topName}`;
        // ensureType's return is the store key or the record depending on the
        // backend — resolve the record by name so the id is always real
        await app.db.ensureType(c.fam, name, params);
        const cat2 = await app.db.getCatalog();
        const rec = cat2.types.find(t => t.name === name && t.familyId === c.fam);
        // the level rule applies to the placement immediately (and is stored
        // on the type, so arming it later re-applies it)
        if (params.topLevel) app.bimOptions.topConstraint = params.topLevel;
        else if (c.levelTop) app.bimOptions.topConstraint = 'unconnected';
        await refresh();
        if (rec) activateType({ typeId: rec.id });
        app.toast(`Type "${name}" added — click in the model to place`);
      }],
    ]);
    const catSel = document.getElementById('nt-cat');
    const syncGroups = () => {
      document.querySelectorAll('.nt-group').forEach(g => {
        g.style.display = g.dataset.cat === catSel.value ? '' : 'none';
        const top = g.querySelector('.nt-top');
        if (top) top.addEventListener('change', () => {
          const fb = g.querySelector('.nt-fb');
          if (fb) fb.style.display = top.value === 'unconnected' ? '' : 'none';
        }, { once: false });
      });
    };
    if (catSel) {
      catSel.addEventListener('change', syncGroups);
      syncGroups();
    }
  }

  // -------------------------------------------------------------------- boot
  function boot() {
    if (!window.app) return; // waits for the app shell
    loadState();
    build();
    initTreeEvents();
    applyLayout();
    panel.classList.toggle('hidden', !state.visible);
    if (state.visible) refresh();
    if (window.Engine) {
      Engine.events.on('db:ready', () => refresh());
      Engine.events.on('model:changed', () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 900); // element counts follow commits
      });
    }
  }

  window.ElementBrowser = {
    get visible() { return state.visible; },
    toggle(force) { if (panel) setVisibility(force); },
    refresh() { refresh(); },
    activateType,
  };
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();
