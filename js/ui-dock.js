'use strict';
// ---------------------------------------------------------------------------
// ui-dock.js — dockable panel engine (Revit-style right dock).
//
// RIGHT dock: a true sidebar next to the viewport — resizable via left-edge
//   drag handle; panels stack vertically with splitter handles between them.
// LEFT dock: absolute column overlaying the viewport left edge (unchanged).
// FLOAT: panel sits anywhere in the viewport, draggable by its header.
//
// Public API: DockPanels.make(panelEl, opts) — wraps a panel with chrome.
//   opts: { key, title, side }  (side defaults to 'left')
//
// Persists panel visibility, dock side, float position, collapsed state,
// column width, and panel height splits in localStorage.
// ---------------------------------------------------------------------------
(function () {
  // v2: the default layout changed (all palettes left, Entity Info right) —
  // bumping the key applies it once over whatever was saved under v1
  const LS_KEY  = 'websketch3d.dock2';
  const LS_COL  = 'websketch3d.dock2.col'; // column widths
  const LS_SPL  = 'websketch3d.dock2.spl'; // splitter sizes per column side
  const EDGE    = 48;        // px from viewport left edge to snap-left
  const COL_MIN = 200;       // minimum column width (px)
  const COL_DEF = 280;       // default column width (px)
  const COL_MAX = 520;       // maximum column width (px)
  const PANEL_MIN = 80;      // minimum panel height when stacked (px)

  // ---- pure helpers (headless-testable) ----------------------------------------
  function edgeFor(clientX, vpLeft, vpRight, edge = EDGE) {
    if (clientX - vpLeft < edge) return 'left';
    if (vpRight - clientX < edge) return 'right';
    return 'float';
  }
  // Full drop-zone resolution: a drop ON a dock column (the connected panel
  // stack) docks INTO that stack; otherwise the screen-edge bands decide.
  // colRects: [{side, x0, x1, y0, y1}] — a column owns the pixels it covers,
  // so the wide left stack is a drop target, not just its first 48px.
  function zoneFor(clientX, clientY, colRects, vpLeft, vpRight, edge = EDGE) {
    for (const r of colRects || []) {
      if (clientX >= r.x0 && clientX <= r.x1 && clientY >= r.y0 && clientY <= r.y1) return r.side;
    }
    return edgeFor(clientX, vpLeft, vpRight, edge);
  }
  function clampXY(x, y, vw, vh) {
    return {
      x: Math.max(-40, Math.min(x, Math.max(4, vw - 60))),
      y: Math.max(0,   Math.min(y, Math.max(4, vh - 36))),
    };
  }
  function loadLayout() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
  }
  function saveLayout(all) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { }
  }
  function loadColWidths() {
    try { return JSON.parse(localStorage.getItem(LS_COL) || '{}'); } catch { return {}; }
  }
  function saveColWidths(w) {
    try { localStorage.setItem(LS_COL, JSON.stringify(w)); } catch { }
  }
  function loadSplits() {
    try { return JSON.parse(localStorage.getItem(LS_SPL) || '{}'); } catch { return {}; }
  }
  function saveSplits(s) {
    try { localStorage.setItem(LS_SPL, JSON.stringify(s)); } catch { }
  }

  // ---- columns -----------------------------------------------------------------
  // LEFT col: absolute inside #viewport (overlays canvas, left edge)
  // RIGHT col: flex sibling of #viewport inside #main  (real sidebar)
  let cols = null;
  let colWidths = loadColWidths(); // { left: px, right: px }

  function ensureCols() {
    if (cols || typeof document === 'undefined') return cols;
    const vp   = document.getElementById('viewport');
    const main = document.getElementById('main');
    if (!vp || !main) return null;
    cols = {};

    // LEFT — absolute overlay inside viewport (unchanged behaviour)
    const L = document.createElement('div');
    L.id = 'dk-col-left';
    L.className = 'dk-col dk-col-left';
    vp.appendChild(L);
    cols.left = L;

    // RIGHT — true sidebar that pushes the viewport
    const R = document.createElement('div');
    R.id = 'dk-col-right';
    R.className = 'dk-col dk-col-right';
    // restore persisted width
    const rw = Math.max(COL_MIN, Math.min(COL_MAX, colWidths.right || COL_DEF));
    R.style.width = rw + 'px';
    colWidths.right = rw;
    main.appendChild(R); // sibling of #viewport — pushes it

    // resize handle on the left edge of the right column
    const rh = document.createElement('div');
    rh.className = 'dk-col-resizer';
    R.appendChild(rh);
    wireColResizer(rh, R, 'right');

    cols.right = R;
    return cols;
  }

  // ---- column width resizing ---------------------------------------------------
  function wireColResizer(handle, col, side) {
    let drag = null;
    handle.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      drag = { startX: ev.clientX, startW: col.offsetWidth };
      handle.setPointerCapture(ev.pointerId);
      document.body.style.cursor = 'ew-resize';
      ev.preventDefault();
    });
    handle.addEventListener('pointermove', ev => {
      if (!drag) return;
      // dragging LEFT edge of right column: moving left = wider
      const delta = drag.startX - ev.clientX;
      const w = Math.max(COL_MIN, Math.min(COL_MAX, drag.startW + delta));
      col.style.width = w + 'px';
      colWidths[side] = w;
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      document.body.style.cursor = '';
      saveColWidths(colWidths);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // ---- splitter handles (between stacked panels in a column) ------------------
  // We rebuild splitters whenever a panel is added/removed from a column.
  let splits = loadSplits(); // { 'right': [h1, h2, …] }

  function rebuildSplitters(side) {
    const col = cols && cols[side];
    if (!col) return;
    // Remove old splitters
    col.querySelectorAll('.dk-splitter').forEach(s => s.remove());
    // Get visible, non-collapsed panels
    const panels = [...col.querySelectorAll(':scope > .dk-panel')]
                     .filter(p => !p.classList.contains('hidden'));
    if (panels.length < 2) {
      // single panel: give it full flex
      panels.forEach(p => { p.style.flex = '1 1 auto'; p.style.height = ''; });
      return;
    }
    // Apply saved heights or distribute equally
    const saved = splits[side] || [];
    panels.forEach((p, i) => {
      const h = saved[i];
      if (h) {
        p.style.flex = '0 0 ' + h + 'px';
        p.style.height = h + 'px';
      } else {
        p.style.flex = '1 1 0';
        p.style.height = '';
      }
    });
    // Insert splitter between each consecutive pair
    for (let i = 0; i < panels.length - 1; i++) {
      const spl = document.createElement('div');
      spl.className = 'dk-splitter';
      const above = panels[i];
      const below = panels[i + 1];
      // insert splitter after above
      above.after(spl);
      wireSplitter(spl, above, below, side, panels);
    }
  }

  function rebuildAll() { rebuildSplitters('left'); rebuildSplitters('right'); }
  function wireSplitter(spl, above, below, side, allPanels) {
    let drag = null;
    spl.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      drag = {
        startY: ev.clientY,
        startAbove: above.offsetHeight,
        startBelow: below.offsetHeight,
      };
      spl.setPointerCapture(ev.pointerId);
      document.body.style.cursor = 'ns-resize';
      ev.preventDefault();
    });
    spl.addEventListener('pointermove', ev => {
      if (!drag) return;
      const delta = ev.clientY - drag.startY;
      const newAbove = Math.max(PANEL_MIN, drag.startAbove + delta);
      const newBelow = Math.max(PANEL_MIN, drag.startBelow - delta);
      above.style.flex = `0 0 ${newAbove}px`;
      above.style.height = newAbove + 'px';
      below.style.flex = `0 0 ${newBelow}px`;
      below.style.height = newBelow + 'px';
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      document.body.style.cursor = '';
      // Persist all panel heights in this column
      const panels = [...cols[side].querySelectorAll(':scope > .dk-panel')]
                       .filter(p => !p.classList.contains('hidden'));
      splits[side] = panels.map(p => p.offsetHeight);
      saveSplits(splits);
    };
    spl.addEventListener('pointerup', end);
    spl.addEventListener('pointercancel', end);
  }

  // ---- the panel engine -------------------------------------------------------
  const registry = new Map(); // key -> api {setVisible, dock, isVisible, el}

  function make(panel, opts = {}) {
    if (!panel || !opts.key) return null;
    if (registry.has(opts.key)) return registry.get(opts.key);
    if (!ensureCols()) return null;

    const all = loadLayout();
    const st = Object.assign(
      { visible: true, dock: opts.side || 'left', x: 24, y: 24 + (registry.size % 6) * 30, collapsed: false },
      all[opts.key] || {},
    );
    const persist = () => { all[opts.key] = st; saveLayout(all); };

    // --- header ---
    let head = panel.querySelector(':scope > .dk-head');
    if (!head) {
      const first = panel.firstElementChild;
      head = document.createElement('div');
      head.className = 'dk-head';
      panel.insertBefore(head, first);
    }
    headDraggable();
    head.title = 'Drag to float · drop onto a panel stack (or near an edge) to dock · double-click docks left';
    if (!head.querySelector('.dk-title')) {
      head.innerHTML = `<span class="dk-grip" title="Drag to float or dock">
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.2"/><circle cx="8" cy="2" r="1.2"/>
            <circle cx="2" cy="7" r="1.2"/><circle cx="8" cy="7" r="1.2"/>
            <circle cx="2" cy="12" r="1.2"/><circle cx="8" cy="12" r="1.2"/>
          </svg>
        </span>
        <span class="dk-title"></span>
        <button class="dk-btn dk-dockl" title="Dock to Left Sidebar">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <button class="dk-btn dk-dockr" title="Dock to Right Sidebar">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
        <button class="dk-btn dk-min" title="Collapse / Expand">
          <svg class="dk-chev-ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <button class="dk-btn dk-x" title="Close Panel">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>`;
    }
    const titleEl = head.querySelector('.dk-title');
    if (titleEl) titleEl.textContent = opts.title || opts.key;
    head.querySelectorAll('.elb-title,.lay-title,.fam-title,.bk-title')
        .forEach(t => { t.style.display = 'none'; });

    const setVisible = on => {
      st.visible = on == null ? !st.visible : !!on;
      panel.classList.toggle('hidden', !st.visible);
      if (st.visible) apply();
      persist();
      // Rebuild splitters after visibility change
      if (st.dock === 'right') rebuildAll();
      if (opts.onVisibility && st.visible) opts.onVisibility();
    };

    const dock = side => {
      if (side !== 'left' && side !== 'right' && side !== 'float') return;
      const prev = st.dock;
      st.dock = side;
      apply(); persist();
      if (prev === 'right' || side === 'right') rebuildAll();
    };

    function apply() {
      panel.classList.add('dk-panel');
      panel.classList.toggle('collapsed', !!st.collapsed);
      panel.classList.toggle('dk-left',  st.dock === 'left');
      panel.classList.toggle('dk-right', st.dock === 'right');
      panel.classList.toggle('dk-float', st.dock === 'float');
      const min = head.querySelector('.dk-min');
      if (min) {
        min.setAttribute('aria-expanded', !st.collapsed);
        if (!min.querySelector('svg')) {
          min.textContent = st.collapsed ? '▸' : '▾';
        }
      }
      if (st.dock === 'float') {
        const vp = document.getElementById('viewport').getBoundingClientRect();
        const c  = clampXY(st.x, st.y, vp.width, vp.height);
        st.x = c.x; st.y = c.y;
        panel.style.left = st.x + 'px';
        panel.style.top  = st.y + 'px';
        document.getElementById('viewport').appendChild(panel);
      } else {
        panel.style.left = panel.style.top = '';
        panel.style.flex = '';
        panel.style.height = '';
        cols[st.dock].appendChild(panel);
      }
    }

    // ---- drag-to-float + edge-dock ----
    function headDraggable() {
      // live rects of the two panel stacks — dropping over a stack docks in
      const colRects = () => Object.entries(cols || {})
        .map(([side, el]) => {
          const r = el.getBoundingClientRect();
          return { side, x0: r.left, x1: r.right, y0: r.top, y1: r.bottom };
        });
      const zone = ev => {
        const vp = document.getElementById('viewport').getBoundingClientRect();
        return zoneFor(ev.clientX, ev.clientY, colRects(), vp.left,
          window.innerWidth - (colWidths.right || COL_DEF));
      };
      let drag = null;
      head.addEventListener('pointerdown', ev => {
        if (ev.target.closest('.dk-btn')) return;
        if (ev.button !== 0) return;
        const pr = panel.getBoundingClientRect();
        drag = { dx: ev.clientX - pr.left, dy: ev.clientY - pr.top, moved: false };
        head.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });
      head.addEventListener('pointermove', ev => {
        if (!drag) return;
        drag.moved = true;
        const vp = document.getElementById('viewport').getBoundingClientRect();
        const c  = clampXY(ev.clientX - vp.left - drag.dx, ev.clientY - vp.top - drag.dy, vp.width, vp.height);
        st.x = c.x; st.y = c.y; st.dock = 'float';
        // dropping over a panel STACK docks into it, near a screen edge too
        const near = zone(ev);
        panel.classList.toggle('dk-preview-left',  near === 'left');
        panel.classList.toggle('dk-preview-right', near === 'right');
        apply();
      });
      const end = ev => {
        if (!drag) return;
        panel.classList.remove('dk-preview-left', 'dk-preview-right');
        if (drag.moved) {
          const side = zone(ev);
          if (side !== 'float') { st.dock = side; }
        }
        drag = null;
        apply(); persist();
        if (st.dock === 'right') rebuildAll();
      };
      head.addEventListener('pointerup', end);
      head.addEventListener('pointercancel', end);
      head.addEventListener('dblclick', ev => {
        if (ev.target.closest('.dk-btn')) return;
        const prev = st.dock;
        st.dock = 'left'; apply(); persist();
        if (prev === 'right') rebuildAll();
      });
    }

    head.querySelector('.dk-x')?.addEventListener('click',   () => setVisible(false));
    head.querySelector('.dk-min')?.addEventListener('click',  () => {
      st.collapsed = !st.collapsed; apply(); persist();
      if (st.dock === 'right') rebuildAll();
    });
    head.querySelector('.dk-dockl')?.addEventListener('click', () => dock('left'));
    head.querySelector('.dk-dockr')?.addEventListener('click', () => dock('right'));

    panel.classList.toggle('hidden', !st.visible);
    apply();
    if (st.dock === 'right') {
      // defer splitter rebuild until all panels have been registered
      setTimeout(() => rebuildAll(), 0);
    }

    const api = { setVisible, dock, isVisible: () => st.visible, el: panel, key: opts.key };
    registry.set(opts.key, api);
    return api;
  }

  window.DockPanels = { make, edgeFor, zoneFor, clampXY, loadLayout, saveLayout,
                        get: k => registry.get(k) || null,
                        rebuildSplitters };
})();
