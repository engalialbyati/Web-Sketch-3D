'use strict';
// ---------------------------------------------------------------------------
// ui-layers.js — the floating & dockable "Layers" palette (AutoCAD-style).
//
// Same chrome as the Element Browser: drag by the header to float, drop at
// a viewport edge to dock, double-click to re-dock, collapse with ▾, hide
// with ✕ (reopen from the toolbar or the context menu).
//
// Every BIM element sits on exactly one layer:
//   • layer OFF (eye)   — its elements leave the render and every pick
//   • layer LOCK (padlock) — its elements stay visible but refuse select/edit
//   • layer COLOR       — "ByLayer": tints its elements in the 3D view
//   • CURRENT layer (dot) — new elements are created on it
// Layer 0 is the undeletable default (AutoCAD parity). Deleting a loaded
// layer asks: move its elements to 0, or erase them with the layer.
//
// Row interactions:
//   • click row          → select every element on the layer
//   • double-click name  → rename
//   • right-click row    → isolate / select / rename / delete
//   • ⇨                  → move the current selection onto the layer
// ---------------------------------------------------------------------------
(function () {
  const $ = id => document.getElementById(id);
  let panel = null, treeEl = null, curSel = null, colorInput = null;
  let refreshTimer = null, dockApi = null;

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ------------------------------------------------------------- persistence
  function saveState() { /* chrome state persists in ui-dock.js */ }
  function loadState() { }

  // ------------------------------------------------------------------ build
  function build() {
    panel = document.createElement('div');
    panel.id = 'layerpanel';
    panel.innerHTML = `
      <div class="dk-head" id="lay-head">
        <span class="dk-grip">⋮⋮</span><span class="dk-title">Layers</span>
        <button class="dk-btn dk-dockl" title="Dock left">◀</button>
        <button class="dk-btn dk-dockr" title="Dock right">▶</button>
        <button class="dk-btn dk-min" title="Collapse / expand">▾</button>
        <button class="dk-btn dk-x" title="Hide (reopen from the toolbar)">✕</button>
      </div>
      <div id="lay-body">
        <div class="elb-search">
          <select id="lay-cur" title="Current layer — every NEW element is created on it"></select>
          <div class="lay-quick">
            <button id="lay-new" title="Create a new layer">＋ New Layer</button>
            <button id="lay-showall" title="Turn every layer back ON (after Isolate / Off)">Show All</button>
          </div>
        </div>
        <div id="lay-tree"></div>
      </div>`;
    $('viewport').appendChild(panel);
    treeEl = panel.querySelector('#lay-tree');
    curSel = panel.querySelector('#lay-cur');
    dockApi = window.DockPanels ? DockPanels.make(panel, {
      key: 'layerpanel', title: 'Layers', side: 'left', onVisibility: () => refresh(),
    }) : null;

    // native color picker hidden inside the panel — swatches proxy to it.
    // Kept offscreen but RENDERED: a display:none input never opens the
    // picker (Chromium refuses to show it for non-rendered elements).
    colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.style.cssText =
      'position:absolute;left:-80px;bottom:0;width:18px;height:18px;opacity:0;border:0;padding:0';
    panel.appendChild(colorInput);
    colorInput.addEventListener('input', () => {
      if (colorInput.dataset.lid && window.app)
        app.setLayerFlags(colorInput.dataset.lid, { color: colorInput.value });
    });

    panel.querySelector('#lay-new').addEventListener('click', () => {
      const app = window.app;
      if (!app || !app.addLayer) return;
      app.addLayer('Layer ' + Math.max(1, app.layers.length));
    });
    panel.querySelector('#lay-showall').addEventListener('click', () => {
      if (window.app && app.showAllLayers) app.showAllLayers();
    });
    curSel.addEventListener('change', () => {
      if (window.app && app.setCurrentLayer) app.setCurrentLayer(curSel.value);
    });
    initRowEvents();
  }

  function applyLayout() { /* chrome layout lives in ui-dock.js */ }

  function setVisibility(on) {
    if (dockApi) dockApi.setVisible(on);
    if (window.app && app.refreshToolbar) app.refreshToolbar();
  }

  // (panel drag/dock chrome lives in ui-dock.js — DockPanels.make wired it)

  // -------------------------------------------------------------- tree rows
  function refresh() {
    const app = window.app;
    if (!app || !app.model || !treeEl) return;
    const layers = app.layers || [];
    const cur = app.model.currentLayerId || '0';

    // current-layer selector drives where NEW elements land
    if (curSel) {
      curSel.innerHTML = layers.map(l =>
        `<option value="${esc(l.id)}"${l.id === cur ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
      curSel.value = cur;
    }

    // live element counts per layer (BIM entities + raw geometry assigned
    // to the layer through the Properties panel)
    const counts = new Map();
    for (const ent of (app.bim ? app.bim.entities : []))
      counts.set(ent.layerId, (counts.get(ent.layerId) || 0) + 1);
    for (const f of app.model.faces.values())
      if ((!f.userData || !f.userData.bimEntityId) && f.layerId && f.layerId !== '0')
        counts.set(f.layerId, (counts.get(f.layerId) || 0) + 1);

    const LT = (window.Model && Model.LINETYPES) || [{ id: 0, name: 'Continuous' }];
    const LW = (window.Model && Model.LINEWEIGHTS) || [{ id: 0, name: 'Default', mm: 0 }];
    const ltOpts = lt => LT.map(t => `<option value="${t.id}"${(lt || 0) === t.id ? ' selected' : ''}>${t.name}</option>`).join('');
    const lwOpts = lw => LW.map(w => `<option value="${w.id}"${(lw || 0) === w.id ? ' selected' : ''}>${w.mm === 0 ? w.name : w.name + ' mm'}</option>`).join('');

    let html = '';
    for (const ly of layers) {
      const n = counts.get(ly.id) || 0;
      const isCur = ly.id === cur;
      const is0 = ly.id === '0';
      const dot = ly.color || '#c3c9cf';
      html += `<div class="elb-node lay-row${isCur ? ' is-cur' : ''}${ly.visible ? '' : ' is-off'}" data-lid="${esc(ly.id)}"
        title="${esc(ly.name)} — ${n} object${n === 1 ? '' : 's'}${is0 ? ' · default layer (cannot be deleted)' : ''}${isCur ? ' · CURRENT (new elements go here)' : ''}">
        <button class="lay-cur${isCur ? ' on' : ''}" data-act="current" title="${isCur ? 'Current layer' : 'Set as current layer — new elements go here'}"></button>
        <button class="lay-color" data-act="color" style="background:${dot}"
          title="Layer color — tints the elements (${ly.color ? 'double-click to clear' : 'none'}). Applied "ByLayer" in the 3D view"></button>
        <span class="elb-lab" data-act="rename" title="${is0 ? 'Layer 0 (cannot be renamed)' : 'Double-click to rename'}">${esc(ly.name)}</span>
        <span class="elb-count">${n || ''}</span>
        <select class="lay-lt" data-act="lt" title="Linetype — the style unstyled lines on this layer draw with">${ltOpts(ly.lt)}</select>
        <select class="lay-lw" data-act="lw" title="Lineweight — the weight unstyled lines on this layer draw with">${lwOpts(ly.lw)}</select>
        <button class="lay-move" data-act="move" title="Move the selected elements onto this layer">⇨</button>
        <button class="layb-flag f-eye${ly.visible ? '' : ' off'}" data-act="visible"
          title="${ly.visible ? 'Layer OFF — hide its objects' : 'Layer ON — show its objects'}">${ly.visible ? '\u{1F441}' : '\u{1F648}'}</button>
        <button class="layb-flag f-lock${ly.locked ? ' on' : ''}" data-act="locked"
          title="${ly.locked ? 'Unlock layer (objects become selectable again)' : 'Lock layer — visible, but no select / no edit'}">${ly.locked ? '\u{1F512}' : '\u{1F513}'}</button>
        <button class="lay-del${is0 ? ' dis' : ''}" data-act="delete" title="${is0 ? 'Layer 0 cannot be deleted' : 'Delete layer'}">\u{2715}</button>
      </div>`;
    }
    treeEl.innerHTML = html || '<div class="elb-empty">No layers</div>';
  }

  function initRowEvents() {
    treeEl.addEventListener('click', ev => {
      const app = window.app;
      if (!app) return;
      const row = ev.target.closest('.lay-row');
      if (!row) return;
      const lid = row.dataset.lid;
      const ly = app.getLayer(lid);
      if (!ly) return;
      const act = ev.target.closest('[data-act]');
      const what = act ? act.dataset.act : '';
      if (what === 'lt' || what === 'lw') {
        ev.stopPropagation(); // the select's change event carries the edit
        return;
      }
      if (what === 'current') {
        ev.stopPropagation();
        app.setCurrentLayer(lid);
        return;
      }
      if (what === 'color') {
        ev.stopPropagation();
        colorInput.dataset.lid = lid;
        colorInput.value = ly.color || '#c3c9cf';
        if (colorInput.showPicker) { try { colorInput.showPicker(); } catch (e) { colorInput.click(); } }
        else colorInput.click(); // native picker — ByLayer tint follows live
        return;
      }
      if (what === 'visible') {
        ev.stopPropagation();
        app.setLayerFlags(lid, { visible: !ly.visible });
        return;
      }
      if (what === 'locked') {
        ev.stopPropagation();
        app.setLayerFlags(lid, { locked: !ly.locked });
        return;
      }
      if (what === 'delete') {
        ev.stopPropagation();
        app.deleteLayer(lid);
        return;
      }
      if (what === 'move') {
        ev.stopPropagation();
        app.assignSelectionToLayer(lid);
        return;
      }
      // plain row click: select every element on the layer
      app.selectLayerElements(lid);
    });
    // linetype / lineweight columns: ByLayer defaults, applied live
    treeEl.addEventListener('change', ev => {
      const sel = ev.target.closest('select[data-act]');
      if (!sel || !window.app) return;
      const row = sel.closest('.lay-row');
      const ly = app.getLayer(row && row.dataset.lid);
      if (!ly) return;
      if (sel.dataset.act === 'lt') app.setLayerFlags(ly.id, { lt: +sel.value });
      else if (sel.dataset.act === 'lw') app.setLayerFlags(ly.id, { lw: +sel.value });
    });
    // double-click: label renames, color swatch clears the ByLayer tint
    treeEl.addEventListener('dblclick', ev => {
      const app = window.app;
      const row = ev.target.closest('.lay-row');
      if (!row || !app) return;
      const ly = app.getLayer(row.dataset.lid);
      if (!ly) return;
      if (ev.target.closest('[data-act="color"]')) {
        ev.stopPropagation();
        app.setLayerFlags(ly.id, { color: null });
        app.toast(`Layer "${ly.name}" color cleared — materials show again`);
        return;
      }
      if (ev.target.closest('[data-act="rename"]')) {
        ev.stopPropagation();
        renameDialog(ly);
      }
    });
    // right-click: layer shortcuts (AutoCAD palette parity)
    treeEl.addEventListener('contextmenu', ev => {
      const app = window.app;
      const row = ev.target.closest('.lay-row');
      if (!row || !app) return;
      ev.preventDefault();
      const ly = app.getLayer(row.dataset.lid);
      if (!ly) return;
      const menu = document.createElement('div');
      menu.id = 'lay-ctx';
      const item = (label, fn) => {
        const d = document.createElement('div');
        d.className = 'lay-ctx-item';
        d.textContent = label;
        d.addEventListener('click', () => { menu.remove(); fn(); });
        menu.appendChild(d);
      };
      item(ly.id === app.model.currentLayerId ? 'Current layer ✓' : 'Set current layer', () => app.setCurrentLayer(ly.id));
      item(`Isolate "${ly.name}" (hide other layers)`, () => app.isolateLayer(ly.id));
      item(`Select ${app.bim.entities.filter(e => e.layerId === ly.id).length} element(s)`, () => app.selectLayerElements(ly.id));
      item('Rename…', () => renameDialog(ly));
      if (ly.id !== '0') item('Delete…', () => app.deleteLayer(ly.id));
      document.body.appendChild(menu);
      const r = treeEl.getBoundingClientRect();
      menu.style.left = Math.min(ev.clientX, r.right - 150) + 'px';
      menu.style.top = ev.clientY + 'px';
      // dismiss on mousedown OUTSIDE only: removing the menu on the item's
      // own mousedown canceled the native click before its handler ran
      setTimeout(() => window.addEventListener('mousedown', function close(e) {
        if (menu.contains(e.target)) return;
        menu.remove(); window.removeEventListener('mousedown', close);
      }), 0);
    });
  }

  function renameDialog(ly) {
    const app = window.app;
    if (ly.id === '0') { app.toast('Layer 0 cannot be renamed', true); return; }
    app.dialog('Rename Layer', `
      <label style="display:flex;align-items:center;gap:8px;margin:4px 0">
        <span style="width:70px;opacity:.8">Name</span>
        <input type="text" id="lay-ren" value="${esc(ly.name)}" spellcheck="false"
          style="flex:1;padding:4px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
      </label>`,
      [['Cancel', null], ['Rename', () => {
        const inp = document.getElementById('lay-ren');
        if (inp) app.renameLayer(ly.id, inp.value);
      }]]);
    const inp = document.getElementById('lay-ren');
    if (inp) { inp.focus(); inp.select(); }
  }

  // -------------------------------------------------------------------- boot
  function boot() {
    if (!window.app) return; // waits for the app shell
    build();
    if (dockApi ? dockApi.isVisible() : true) refresh();
    if (window.Engine) {
      Engine.events.on('db:ready', () => refresh());
      Engine.events.on('model:changed', () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 400); // counts follow commits
      });
    }
  }

  window.LayerPanel = {
    get visible() { return !!(dockApi && dockApi.isVisible()); },
    toggle(force) { if (panel) setVisibility(force); },
    refresh() { refresh(); },
  };
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();
