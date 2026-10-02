'use strict';
// ---------------------------------------------------------------------------
// ui-dock.js — the shared DOCKABLE PANEL engine.
//
// One implementation of the palette chrome every floating panel uses
// (Element Browser, Layers, Families, BlenderKit, Entity Info):
//   • drag the header to float, drop near a viewport edge to dock
//   • dock columns stack panels (left and right), double-click docks left
//   • collapse ▾, dock ◀ ▶ buttons, close ✕ (reopen from the toolbar)
//   • per-panel layout persists in localStorage under 'websketch3d.dock'
//
// Usage: DockPanels.make(panelEl, { key: 'elbrowser', title: '…' }) — the
// panel gets a .dk-head (created if missing) and .dk-body; content ids and
// classes inside the body are the caller's own. Pure helpers (edgeFor,
// clampXY, state load/save) are exported for the headless suite.
// ---------------------------------------------------------------------------
(function () {
  const LS_KEY = 'websketch3d.dock';
  const EDGE = 42; // px from a viewport border that snaps a drop

  // ---- pure helpers (headless-testable) -------------------------------------
  /** Which dock side a drop at clientX belongs to, or 'float'. */
  function edgeFor(clientX, vpLeft, vpRight, edge = EDGE) {
    if (clientX - vpLeft < edge) return 'left';
    if (vpRight - clientX < edge) return 'right';
    return 'float';
  }
  /** Keep a floating panel inside the viewport (some of it always visible). */
  function clampXY(x, y, vw, vh) {
    return {
      x: Math.max(-40, Math.min(x, Math.max(4, vw - 60))),
      y: Math.max(0, Math.min(y, Math.max(4, vh - 36))),
    };
  }
  function loadLayout() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveLayout(all) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch (e) { }
  }

  // ---- columns ---------------------------------------------------------------
  // Docked panels stack inside the columns (insertion order = top to bottom);
  // floating panels parent to the viewport directly.
  let cols = null;
  function ensureCols() {
    if (cols || typeof document === 'undefined') return cols;
    const vp = document.getElementById('viewport');
    if (!vp) return null;
    cols = {};
    for (const side of ['left', 'right']) {
      const c = document.createElement('div');
      c.id = 'dk-col-' + side;
      c.className = 'dk-col';
      vp.appendChild(c);
      cols[side] = c;
    }
    return cols;
  }

  // ---- the engine --------------------------------------------------------------
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

    // header: reuse the caller's if it already built one (.dk-head), else
    // prepend a fresh one above the body. Drag wiring happens either way —
    // a caller-provided head must not end up undraggable.
    let head = panel.querySelector(':scope > .dk-head');
    if (!head) {
      const first = panel.firstElementChild;
      head = document.createElement('div');
      head.className = 'dk-head';
      panel.insertBefore(head, first);
    }
    headDraggable();
    head.title = 'Drag to float · drop at a viewport edge to dock · double-click docks left';
    if (!head.querySelector('.dk-title')) {
      head.innerHTML = `<span class="dk-grip">⋮⋮</span><span class="dk-title"></span>
        <button class="dk-btn dk-dockl" title="Dock left">◀</button>
        <button class="dk-btn dk-dockr" title="Dock right">▶</button>
        <button class="dk-btn dk-min" title="Collapse / expand">▾</button>
        <button class="dk-btn dk-x" title="Hide (reopen from the toolbar)">✕</button>`;
    }
    const titleEl = head.querySelector('.dk-title');
    if (titleEl) titleEl.textContent = opts.title || opts.key;
    // legacy palettes carry their own title inside the head — hide it
    head.querySelectorAll('.elb-title,.lay-title,.fam-title,.bk-title').forEach(t => { t.style.display = 'none'; });

    const setVisible = on => {
      st.visible = on == null ? !st.visible : !!on;
      panel.classList.toggle('hidden', !st.visible);
      if (st.visible) apply();
      persist();
      if (opts.onVisibility && st.visible) opts.onVisibility();
    };
    const dock = side => {
      if (side !== 'left' && side !== 'right' && side !== 'float') return;
      st.dock = side;
      apply(); persist();
    };

    function apply() {
      panel.classList.add('dk-panel');
      panel.classList.toggle('collapsed', !!st.collapsed);
      panel.classList.toggle('dk-left', st.dock === 'left');
      panel.classList.toggle('dk-right', st.dock === 'right');
      panel.classList.toggle('dk-float', st.dock === 'float');
      const min = head.querySelector('.dk-min');
      if (min) min.textContent = st.collapsed ? '▸' : '▾';
      if (st.dock === 'float') {
        const vp = document.getElementById('viewport').getBoundingClientRect();
        const c = clampXY(st.x, st.y, vp.width, vp.height);
        st.x = c.x; st.y = c.y;
        panel.style.left = st.x + 'px';
        panel.style.top = st.y + 'px';
        document.getElementById('viewport').appendChild(panel);
      } else {
        panel.style.left = panel.style.top = '';
        cols[st.dock].appendChild(panel); // stacking order = dock order
      }
    }

    // ---- drag to float + edge docking
    function headDraggable() {
      let drag = null;
      head.addEventListener('pointerdown', ev => {
        if (ev.target.closest('.dk-btn')) return;
        if (ev.button !== 0) return;
        const pr = panel.getBoundingClientRect();
        const vp = document.getElementById('viewport').getBoundingClientRect();
        drag = { dx: ev.clientX - pr.left, dy: ev.clientY - pr.top, moved: false };
        head.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });
      head.addEventListener('pointermove', ev => {
        if (!drag) return;
        drag.moved = true;
        const vp = document.getElementById('viewport').getBoundingClientRect();
        const c = clampXY(ev.clientX - vp.left - drag.dx, ev.clientY - vp.top - drag.dy, vp.width, vp.height);
        st.x = c.x; st.y = c.y; st.dock = 'float';
        const near = edgeFor(ev.clientX, vp.left, vp.right);
        panel.classList.toggle('dk-preview-left', near === 'left');
        panel.classList.toggle('dk-preview-right', near === 'right');
        apply();
      });
      const end = ev => {
        if (!drag) return;
        panel.classList.remove('dk-preview-left', 'dk-preview-right');
        if (drag.moved) {
          const vp = document.getElementById('viewport').getBoundingClientRect();
          const side = edgeFor(ev.clientX, vp.left, vp.right);
          if (side !== 'float') st.dock = side;
        }
        drag = null;
        apply(); persist();
      };
      head.addEventListener('pointerup', end);
      head.addEventListener('pointercancel', end);
      head.addEventListener('dblclick', ev => {
        if (ev.target.closest('.dk-btn')) return;
        st.dock = 'left'; apply(); persist();
      });
    }

    head.querySelector('.dk-x')?.addEventListener('click', () => setVisible(false));
    head.querySelector('.dk-min')?.addEventListener('click', () => {
      st.collapsed = !st.collapsed; apply(); persist();
    });
    head.querySelector('.dk-dockl')?.addEventListener('click', () => dock('left'));
    head.querySelector('.dk-dockr')?.addEventListener('click', () => dock('right'));

    panel.classList.toggle('hidden', !st.visible);
    apply();
    const api = { setVisible, dock, isVisible: () => st.visible, el: panel, key: opts.key };
    registry.set(opts.key, api);
    return api;
  }

  window.DockPanels = { make, edgeFor, clampXY, loadLayout, saveLayout, get: k => registry.get(k) || null };
})();
