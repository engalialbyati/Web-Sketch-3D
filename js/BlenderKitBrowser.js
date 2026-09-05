'use strict';
// ---------------------------------------------------------------------------
// BlenderKitBrowser.js — the floating & dockable "BlenderKit Assets" palette.
//
// Search BlenderKit's free model library and drop results into the scene as
// real Three.js geometry. Same palette chrome as the Element Browser
// (ui-browser.js): drag the header to float, drop near a viewport edge to
// dock, double-click to swap sides, collapse (▾), toolbar button hides/shows.
//
// Pipeline (every step is push/async — the kernel never blocks):
//   search   ->  bridge /api/search  (CORS proxy for api/v1/search/ with
//                asset_type=model&order=-downloads&is_free=true; each
//                result carries hasGltf so cards can be badged/filtered)
//   click    ->  bridge /api/convert?id&name  (ready-made GLB when the
//                asset ships one — no Blender needed; .blend -> .glb via
//                headless Blender otherwise; cached on disk; see
//                server/blenderkitBridge.js)
//   load     ->  THREE.GLTFLoader.parse (js/lib/GLTFLoader.js). BlenderKit
//                GLBs are Draco-compressed, so a DRACOLoader with the
//                vendored wasm decoder (js/lib/draco/) is wired in —
//                without it the loader refuses to parse the file.
//   fit      ->  glTF is Y-up, the viewport is Z-up: rotate; models over
//                MAX_SIZE_M are normalized down to room scale
//   place    ->  centered on the cursor's ground point (grid-snap aware),
//                bottom resting on the ground; origin when the cursor never
//                entered the viewport; every mesh casts + receives shadows
//   register ->  AssetManager (js/assets.js, app.assets): instances are
//                selectable, movable, persistable, and can be DEFINED as
//                door/window/object types in the Element Browser (⚙ on a
//                placed row, or the Entity Info panel) — defined doors and
//                windows host on walls with real cut openings
//
// Imported assets are foreign geometry: they live beside the B-Rep model
// (not inside it), so they are not part of undo/autosave and never enter
// the merged face mesh or element picking.
// ---------------------------------------------------------------------------
(function () {
  const $ = id => document.getElementById(id);
  const LS_KEY = 'ws3d-blenderkit';
  const BRIDGE = (window.BLENDERKIT_BRIDGE_URL || 'http://localhost:3001').replace(/\/$/, '');
  const MAX_SIZE_M = 5;          // largest extent allowed before normalizing
  const SEARCH_DEBOUNCE_MS = 350;
  const TAGS = ['Chair', 'Table', 'Sofa', 'Bed', 'Lamp', 'Plant', 'Kitchen', 'Bathroom', 'Office', 'Decor'];

  const state = {
    visible: false,
    dock: 'right',       // 'left' | 'right' | 'float'
    x: 24, y: 24,        // float position (viewport-local px)
    collapsed: false,
    query: '',
    tag: null,           // active quick-search tag
    glbOnly: null,       // tri-state: null = auto (on when no Blender), true/false = user choice
    definingId: null,    // placed-row currently showing its Define-as chips
  };

  let panel = null, gridEl = null, statusEl = null, inputEl = null, tagsEl = null, placedEl = null;
  let results = [];
  let searchSeq = 0;            // stale-response guard
  let searchTimer = null;
  let lastGround = null;        // last cursor world point on the ground plane
  const importing = new Set();  // asset ids mid-conversion (double-click guard)

  // ---------------------------------------------------------- bridge health
  // /api/health reports whether this machine can run Blender at all. When it
  // can't, blend-only cards are marked unusable and the GLB filter defaults
  // on — the palette stays fully usable without a Blender install.
  // Single-flight; re-probes after a failed probe.
  let bridgeHealth = null, healthPromise = null;
  function ensureHealth() {
    if (bridgeHealth) return Promise.resolve(bridgeHealth);
    if (!healthPromise) {
      healthPromise = fetch(`${BRIDGE}/api/health`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => { bridgeHealth = j && j.ok ? j : null; healthPromise = null; return bridgeHealth; })
        .catch(() => { healthPromise = null; return null; });
    }
    return healthPromise;
  }
  const noBlender = () => !!(bridgeHealth && bridgeHealth.blenderKnown === false);

  // Does the asset ship a ready-made GLB (imported with no Blender)? The
  // bridge annotates search results with hasGltf; the files[] fallback
  // keeps this working against an older bridge.
  function hasGltf(a) {
    if (a && a.hasGltf != null) return !!a.hasGltf;
    const files = (a && Array.isArray(a.files)) ? a.files : [];
    return files.some(f => f && f.fileType === 'gltf');
  }
  // GLB-only filter: null = the user never chose — on exactly when health
  // reported no Blender; true/false is the user's explicit override.
  function effectiveGlbOnly() {
    return state.glbOnly != null ? state.glbOnly : noBlender();
  }

  // ------------------------------------------------------------- persistence
  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        visible: state.visible, dock: state.dock, x: state.x, y: state.y,
        collapsed: state.collapsed, query: state.query, tag: state.tag,
        glbOnly: state.glbOnly,
      }));
    } catch (e) { }
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s) Object.assign(state, {
        visible: !!s.visible, dock: s.dock || 'right',
        x: s.x || 24, y: s.y || 24, collapsed: !!s.collapsed,
        query: s.query || '', tag: s.tag || null,
        glbOnly: s.glbOnly == null ? null : !!s.glbOnly,
      });
    } catch (e) { }
  }

  // ------------------------------------------------- placed-asset registry
  // The registry itself lives in app.assets (js/assets.js) — instances are
  // selectable, movable, hostable and persisted. The palette is UI only:
  // it imports into the manager and renders its list.
  function mgr() { return (window.app && app.assets) || null; }
  const assets = {
    list() { const m = mgr(); return m ? m.list() : []; },
    get(id) { const m = mgr(); return m ? m.get(id) : null; },
    remove(id) { const m = mgr(); return m ? m.remove(id) : false; },
    clear() { const m = mgr(); if (m) m.clear(); },
    define(id, kind) { return window.app && app.defineAssetKind(id, kind); },
  };
  // The search result's thumbnail — reused for the Element Browser type row.
  function thumbFor(assetId) {
    const a = results.find(r => r.id === assetId);
    return a ? (a.thumbnailSmallUrl || a.thumbnailMiddleUrl || '') : '';
  }

  // Where a new model lands: the cursor's last ground-plane point (rounded
  // to the 1 m grid when Grid Snap is on), else the origin.
  function placementPoint() {
    if (!lastGround) return new THREE.Vector3(0, 0, 0);
    const p = new THREE.Vector3(lastGround.x, lastGround.y, 0);
    if (app.gridSnap) { p.x = Math.round(p.x); p.y = Math.round(p.y); }
    return p;
  }

  // ------------------------------------------------------------------ import
  // The heavy lifting lives in app.assets: fetch + Draco parse (with the
  // webview WebP workaround), material healing, studio env, registration.
  async function importAsset(asset, card) {
    if (importing.has(asset.id)) return;
    if (!THREE.GLTFLoader || !THREE.DRACOLoader) return app.toast('GLTFLoader/DRACOLoader not loaded (js/lib/)', true);
    importing.add(asset.id);
    if (card) card.classList.add('busy');
    const ready = hasGltf(asset);
    // Blend-only asset on a Blender-less machine: the bridge would refuse it
    // anyway — explain here instead of starting a doomed request.
    if (!ready && noBlender()) {
      importing.delete(asset.id);
      if (card) card.classList.remove('busy');
      return app.toast(`“${asset.name}” ships only a .blend and this machine has no Blender — pick a GLB-ready asset (blue badge)`, true);
    }
    setStatus(ready
      ? `Downloading “${asset.name}”… (ready-made GLB, no Blender involved)`
      : `Converting “${asset.name}” via Blender… (first run may take a minute)`);
    try {
      if (!window.app || !app.assets) throw new Error('asset manager unavailable');
      const tpl = await app.assets.loadTemplate(asset.id, asset.name || 'Asset');
      const rec = app.assets.placeFree(asset.id, asset.name, tpl, placementPoint());
      const p = rec.object.position;
      app.toast(`Placed “${rec.name}” — click it to select, M to move, ⚙ to define as a door/window`);
      setStatus(`Placed “${rec.name}” at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
      app.selectAsset(rec.id);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.error('[blenderkit] import failed:', e);
      app.toast(`Import failed: ${msg}`, true);
      setStatus(`Import failed: ${msg}`, true);
    } finally {
      importing.delete(asset.id);
      if (card) card.classList.remove('busy');
    }
  }

  // ------------------------------------------------------------------ search
  function authorOf(a) {
    const au = a && a.author;
    if (!au) return '';
    if (typeof au === 'string') return au;
    const full = [au.firstName, au.lastName].filter(Boolean).join(' ').trim();
    return full || au.fullName || au.username || '';
  }
  function effectiveQuery() {
    return [state.query.trim(), state.tag].filter(Boolean).join(' ').trim();
  }
  function scheduleSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, SEARCH_DEBOUNCE_MS);
  }
  async function search() {
    clearTimeout(searchTimer);
    const seq = ++searchSeq;
    const q = effectiveQuery();
    setStatus(q ? `Searching “${q}”…` : 'Loading most downloaded free models…');
    gridEl.classList.add('loading');
    const health = ensureHealth(); // card badges / auto GLB filter depend on it
    try {
      let res;
      try { res = await fetch(`${BRIDGE}/api/search?query=${encodeURIComponent(q)}`); }
      catch (e) { throw new Error(`bridge offline at ${BRIDGE} — start it with "npm run bridge"`); }
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j && j.error) || `bridge HTTP ${res.status}`);
      }
      const data = await res.json();
      await health;
      if (seq !== searchSeq) return; // a newer search superseded this one
      results = Array.isArray(data.results) ? data.results : [];
      const shown = renderGrid();
      renderTags(); // chip state may have changed once health arrived
      let msg;
      if (!results.length) msg = 'No free models match';
      else if (!shown) msg = 'No GLB-ready models here — turn off “GLB only” or refine the search';
      else msg = `${(data.count || results.length).toLocaleString()} free models — showing ${shown}${effectiveGlbOnly() ? ' GLB-ready' : ''}`;
      if (noBlender()) msg += ' · no Blender found: .blend-only assets are disabled';
      setStatus(msg);
    } catch (e) {
      if (seq !== searchSeq) return;
      results = [];
      renderGrid();
      setStatus(e.message || 'Search failed', true);
    } finally {
      if (seq === searchSeq) gridEl.classList.remove('loading');
    }
  }

  function renderGrid() {
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const glbOnly = effectiveGlbOnly();
    const shown = [];
    results.forEach((a, i) => { if (!glbOnly || hasGltf(a)) shown.push([a, i]); });
    gridEl.innerHTML = shown.map(([a, i]) => {
      const thumb = a.thumbnailSmallUrl || a.thumbnailMiddleUrl || '';
      const author = authorOf(a);
      const ready = hasGltf(a);
      const off = !ready && noBlender();
      const tip = `${a.name}${author ? ' — ' + author : ''}\n` +
        (ready ? 'Ready-made GLB — imports without Blender' : 'Ships as .blend — needs Blender on this machine') +
        (off ? '\nBlender not found here — disabled' : '') + '\nClick to place in the scene';
      return `<div class="bkb-card${off ? ' unavailable' : ''}" data-i="${i}" title="${esc(tip)}">
        <div class="bkb-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" draggable="false">` : '<span class="bkb-nothumb">no preview</span>'}<span class="bkb-badge ${ready ? 'glb' : 'blend'}">${ready ? 'GLB' : 'blend'}</span><span class="bkb-spin"></span></div>
        <div class="bkb-name">${esc(a.name || 'Untitled')}</div>
        <div class="bkb-author">${esc(author || 'BlenderKit')}</div>
      </div>`;
    }).join('');
    return shown.length;
  }
  function renderTags() {
    tagsEl.innerHTML =
      `<button class="bkb-glbonly${effectiveGlbOnly() ? ' active' : ''}" title="Show only assets that ship a ready-made GLB — these import without Blender installed">GLB only</button>` +
      TAGS.map(t =>
        `<button class="bkb-tag${state.tag === t ? ' active' : ''}" data-tag="${t}">${t}</button>`).join('');
  }
  function renderPlaced() {
    if (!placedEl) return;
    const list = assets.list();
    placedEl.classList.toggle('hidden', !list.length);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    placedEl.innerHTML = `<div class="bkb-placed-h">In scene (${list.length})</div>` + list.map(r => {
      const defining = state.definingId === r.id;
      return `<div class="bkb-placed-row" data-id="${r.id}">
        <span class="bkb-kind ${esc(r.kind)}" title="${esc(r.kind)}${r.host ? ' — hosted on a wall' : ''}">${r.kind === 'object' ? 'obj' : esc(r.kind)}</span>
        <span class="bkb-placed-name" title="${esc(r.name)}">${esc(r.name)}</span>
        ${defining
          ? `<span class="bkb-defrow">
              <button class="bkb-defk" data-id="${r.id}" data-kind="door">Door</button>
              <button class="bkb-defk" data-id="${r.id}" data-kind="window">Window</button>
              <button class="bkb-defk" data-id="${r.id}" data-kind="object">Object</button>
            </span>`
          : `<button class="bkb-def" data-id="${r.id}" title="Define as a Door / Window / Object type in the Element Browser">⚙</button>`}
        <button class="bkb-rm" data-id="${r.id}" title="Remove from the scene">✕</button>
      </div>`;
    }).join('');
  }
  function setStatus(msg, isErr = false) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  // ------------------------------------------------------------------ build
  function build() {
    panel = document.createElement('div');
    panel.id = 'bkbrowser';
    panel.innerHTML = `
      <div id="bkb-head" title="Drag to float · drop at a screen edge to dock · double-click to swap sides">
        <span class="elb-grip">⋮⋮</span>
        <span class="elb-title">BlenderKit Assets</span>
        <button class="elb-btn" id="bkb-min" title="Collapse / expand">▾</button>
        <button class="elb-btn" id="bkb-x" title="Hide (reopen from the toolbar)">✕</button>
      </div>
      <div id="bkb-body">
        <div class="bkb-search">
          <input id="bkb-q" placeholder="Search free models… (Enter)" spellcheck="false" autocomplete="off">
          <button id="bkb-go" title="Search">⌕</button>
        </div>
        <div id="bkb-tags"></div>
        <div id="bkb-grid"></div>
        <div id="bkb-placed" class="hidden"></div>
        <div id="bkb-status"></div>
      </div>`;
    $('viewport').appendChild(panel);
    gridEl = panel.querySelector('#bkb-grid');
    statusEl = panel.querySelector('#bkb-status');
    inputEl = panel.querySelector('#bkb-q');
    tagsEl = panel.querySelector('#bkb-tags');
    placedEl = panel.querySelector('#bkb-placed');
    inputEl.value = state.query;
    renderTags();

    panel.querySelector('#bkb-x').addEventListener('click', () => setVisibility(false));
    panel.querySelector('#bkb-min').addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      applyLayout();
      saveState();
    });
    inputEl.addEventListener('input', () => { state.query = inputEl.value; saveState(); scheduleSearch(); });
    inputEl.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); search(); }
      if (ev.key === 'Escape') { inputEl.blur(); }
      ev.stopPropagation(); // typing here must not reach the app's hotkeys / VCB
    });
    inputEl.addEventListener('keyup', ev => ev.stopPropagation());
    panel.querySelector('#bkb-go').addEventListener('click', () => search());
    tagsEl.addEventListener('click', ev => {
      const glbBtn = ev.target.closest('.bkb-glbonly');
      if (glbBtn) { // explicit override of the auto (no-Blender) default
        state.glbOnly = !effectiveGlbOnly();
        renderTags();
        renderGrid();
        saveState();
        return;
      }
      const b = ev.target.closest('.bkb-tag');
      if (!b) return;
      state.tag = state.tag === b.dataset.tag ? null : b.dataset.tag;
      renderTags();
      saveState();
      search();
    });
    gridEl.addEventListener('click', ev => {
      const card = ev.target.closest('.bkb-card');
      if (!card) return;
      const a = results[+card.dataset.i];
      if (a) importAsset(a, card);
    });
    placedEl.addEventListener('click', ev => {
      const kindBtn = ev.target.closest('.bkb-defk');
      if (kindBtn) {
        state.definingId = null;
        renderPlaced();
        if (window.app && app.defineAssetKind) app.defineAssetKind(kindBtn.dataset.id, kindBtn.dataset.kind);
        return;
      }
      const def = ev.target.closest('.bkb-def');
      if (def) {
        state.definingId = state.definingId === def.dataset.id ? null : def.dataset.id;
        renderPlaced(); // the row swaps its ⚙ for Door/Window/Object chips
        return;
      }
      const rm = ev.target.closest('.bkb-rm');
      if (rm) { assets.remove(rm.dataset.id); return; } // 'assets:changed' re-renders
      // clicking the row itself selects the instance in the viewport — the
      // box outline appears, ready for M (move) or Del
      const row = ev.target.closest('.bkb-placed-row');
      if (row && window.app && app.selectAsset) {
        app.selectAsset(row.dataset.id);
        const rec = app.assets.get(row.dataset.id);
        if (rec) app.setStatus(`${rec.name} selected — M to move, Del to remove`);
      }
    });
    // wheel/keys inside the palette belong to the palette, not the camera
    panel.addEventListener('wheel', ev => ev.stopPropagation());
    panel.addEventListener('pointerdown', ev => ev.stopPropagation());
    initPanelDrag();
    initCursorTracking();
  }

  // Remember where the cursor last touched the ground plane — the drop
  // target for the next import. One ray-plane per move, no snap-glyph side
  // effects on the active tool.
  function initCursorTracking() {
    app.view.canvas.addEventListener('pointermove', ev => {
      if (!state.visible) return;
      const g = app.view.groundAt(app.view.eventPt(ev));
      if (g) lastGround = g;
    });
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
    panel.querySelector('#bkb-min').textContent = state.collapsed ? '▸' : '▾';
  }

  function setVisibility(on) {
    state.visible = on != null ? !!on : !state.visible;
    panel.classList.toggle('hidden', !state.visible);
    if (state.visible && !results.length) search(); // first open: most downloaded
    saveState();
    if (window.app && app.refreshToolbar) app.refreshToolbar();
  }

  // ------------------------------------------------------- panel drag / dock
  function initPanelDrag() {
    const head = panel.querySelector('#bkb-head');
    let drag = null;
    head.addEventListener('pointerdown', ev => {
      if (ev.target.closest('.elb-btn')) return;
      if (ev.button !== 0) return;
      const pr = panel.getBoundingClientRect();
      const vp = $('viewport').getBoundingClientRect();
      drag = { dx: ev.clientX - pr.left, dy: ev.clientY - pr.top, vw: vp.width, vh: vp.height, moved: false };
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

  // -------------------------------------------------------------------- boot
  function boot() {
    if (!window.app) return; // waits for the app shell
    loadState();
    build();
    applyLayout();
    panel.classList.toggle('hidden', !state.visible);
    if (state.visible) search();
    // the manager owns the registry — every place/remove/define re-renders
    if (window.Engine) Engine.events.on('assets:changed', () => renderPlaced());
    renderPlaced();
    if (app.refreshToolbar) app.refreshToolbar();
  }

  window.BlenderKitBrowser = {
    get visible() { return state.visible; },
    toggle(force) { if (panel) setVisibility(force); },
    search(query) { if (panel) { state.query = query || ''; inputEl.value = state.query; search(); } },
    import: (asset) => importAsset(asset, null),
    assets,
    thumbFor,
    bridgeUrl: BRIDGE,
  };
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();
