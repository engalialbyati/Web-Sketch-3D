// rcwindows.js — ETABS-style Multi-Window View Management & Viewport Splitting.
// Provides 1 View, 2 Views Split Vertical (Left/Right), 2 Views Split Horizontal (Top/Bottom),
// and 4 Views (Quad 2x2) layouts, each pane with its own ETABS window chrome,
// camera orientation (Plan View per Story, Elevation View per Grid, or 3D Isometric),
// active window focus, result display badge, and independent display controls.
// All calculations in the design & analysis engine remain completely unchanged.
(function (root) {
  'use strict';

  const RAD = Math.PI / 180;
  let appRef = null;
  let containerEl = null;
  let layoutMode = 'single'; // 'single' | 'split-v' | 'split-h' | 'quad'
  let panes = [];
  let activePaneId = 'pane-1';
  let isDraggingSplitter = false;
  let splitRatio = 0.5; // for 2-view splits
  let splitRatioY = 0.5; // for horizontal / quad splits

  // ---------------------------------------------------- View Pane Class
  class ViewPane {
    constructor(id, title, type, opts = {}) {
      this.id = id;
      this.title = title || '3D View';
      this.type = type || '3d'; // '3d' | 'plan' | 'elevation'
      this.storyId = opts.storyId || null;
      this.gridId = opts.gridId || null;
      this.resultBadge = opts.resultBadge || '';
      this.maximized = false;

      // Camera parameters
      this.cam = {
        target: { x: 0, y: 0, z: 0 },
        dist: 16,
        az: -55 * RAD,
        el: 28 * RAD,
        fov: 50,
        ortho: false,
      };

      if (this.type === 'plan') {
        this.cam.az = -90 * RAD;
        this.cam.el = 89.9 * RAD;
        this.cam.ortho = true;
      } else if (this.type === 'elevation') {
        this.cam.az = -90 * RAD;
        this.cam.el = 0;
        this.cam.ortho = true;
      }

      this.perspCamera = new root.THREE.PerspectiveCamera(50, 1, 0.1, 4000);
      this.perspCamera.up.set(0, 0, 1);
      this.orthoCamera = new root.THREE.OrthographicCamera(-10, 10, 10, -10, -4000, 4000);
      this.orthoCamera.up.set(0, 0, 1);

      this.el = null; // DOM wrapper
      this._buildDOM();
    }

    camera() {
      return this.cam.ortho ? this.orthoCamera : this.perspCamera;
    }

    updateCamera(width, height) {
      const { target, dist, az, el } = this.cam;
      const x = target.x + dist * Math.cos(el) * Math.cos(az);
      const y = target.y + dist * Math.cos(el) * Math.sin(az);
      const z = target.z + dist * Math.sin(el);
      const cam = this.camera();
      cam.position.set(x, y, z);
      cam.up.set(0, 0, 1);
      cam.lookAt(new root.THREE.Vector3(target.x, target.y, target.z));

      const aspect = Math.max(width, 1) / Math.max(height, 1);
      if (this.cam.ortho) {
        const h = dist * Math.tan(this.cam.fov * RAD / 2);
        this.orthoCamera.top = h;
        this.orthoCamera.bottom = -h;
        this.orthoCamera.left = -h * aspect;
        this.orthoCamera.right = h * aspect;
        this.orthoCamera.updateProjectionMatrix();
      } else {
        this.perspCamera.aspect = aspect;
        this.perspCamera.updateProjectionMatrix();
      }
      cam.updateMatrixWorld(true);
    }

    _buildDOM() {
      const pane = document.createElement('div');
      pane.className = 'etabs-view-pane';
      pane.id = `etabs-pane-${this.id}`;
      pane.dataset.paneId = this.id;

      // Pane header
      const header = document.createElement('div');
      header.className = 'etabs-pane-header';

      // Title & Icon
      const titleWrap = document.createElement('div');
      titleWrap.className = 'etabs-pane-title-wrap';

      const icon = document.createElement('span');
      icon.className = 'etabs-pane-icon';
      icon.textContent = this.type === '3d' ? '⛶' : this.type === 'plan' ? '⊞' : '◫';

      const title = document.createElement('span');
      title.className = 'etabs-pane-title';
      title.textContent = this.title;

      titleWrap.appendChild(icon);
      titleWrap.appendChild(title);

      // View type selector
      const viewSelect = document.createElement('select');
      viewSelect.className = 'etabs-pane-view-select';
      viewSelect.title = 'Switch View Type (3D, Plan, Elevation)';
      this._populateViewOptions(viewSelect);
      viewSelect.addEventListener('change', () => {
        this._onViewSelectChange(viewSelect.value);
      });

      // Result badge
      const badge = document.createElement('span');
      badge.className = 'etabs-pane-badge';
      badge.textContent = this.resultBadge;
      badge.style.display = this.resultBadge ? 'inline-block' : 'none';

      // Actions
      const actions = document.createElement('div');
      actions.className = 'etabs-pane-actions';

      const btnSplitV = document.createElement('button');
      btnSplitV.className = 'etabs-pane-btn';
      btnSplitV.title = 'Split Vertically (Left/Right)';
      btnSplitV.innerHTML = '◫';
      btnSplitV.addEventListener('click', (e) => { e.stopPropagation(); splitPane(this.id, 'vertical'); });

      const btnSplitH = document.createElement('button');
      btnSplitH.className = 'etabs-pane-btn';
      btnSplitH.title = 'Split Horizontally (Top/Bottom)';
      btnSplitH.innerHTML = '⬓';
      btnSplitH.addEventListener('click', (e) => { e.stopPropagation(); splitPane(this.id, 'horizontal'); });

      const btnMax = document.createElement('button');
      btnMax.className = 'etabs-pane-btn';
      btnMax.title = 'Maximize / Restore View';
      btnMax.innerHTML = '⛶';
      btnMax.addEventListener('click', (e) => { e.stopPropagation(); toggleMaximizePane(this.id); });

      const btnClose = document.createElement('button');
      btnClose.className = 'etabs-pane-btn etabs-pane-close';
      btnClose.title = 'Close Window';
      btnClose.innerHTML = '✕';
      btnClose.addEventListener('click', (e) => { e.stopPropagation(); closePane(this.id); });

      actions.appendChild(btnSplitV);
      actions.appendChild(btnSplitH);
      actions.appendChild(btnMax);
      actions.appendChild(btnClose);

      header.appendChild(titleWrap);
      header.appendChild(viewSelect);
      header.appendChild(badge);
      header.appendChild(actions);

      // Content viewport area
      const body = document.createElement('div');
      body.className = 'etabs-pane-body';

      pane.appendChild(header);
      pane.appendChild(body);

      // Click on pane activates it
      pane.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('.etabs-pane-btn') && !e.target.closest('select')) {
          setActivePane(this.id);
        }
      });

      this.el = pane;
      this._header = header;
      this._title = title;
      this._icon = icon;
      this._viewSelect = viewSelect;
      this._badge = badge;
    }

    _populateViewOptions(select) {
      select.innerHTML = '';
      const opt3d = document.createElement('option');
      opt3d.value = '3d';
      opt3d.textContent = '3D View';
      select.appendChild(opt3d);

      // Plan views
      const optGroupPlan = document.createElement('optgroup');
      optGroupPlan.label = 'Plan Views';
      const lvls = (appRef && appRef.levelManager && appRef.levelManager.levels) || [];
      if (lvls.length) {
        for (const lv of lvls) {
          const opt = document.createElement('option');
          opt.value = `plan:${lv.id}`;
          opt.textContent = `Plan: ${lv.name} (Z=${(lv.elevation || 0).toFixed(1)}m)`;
          optGroupPlan.appendChild(opt);
        }
      } else {
        const opt = document.createElement('option');
        opt.value = 'plan:default';
        opt.textContent = 'Plan: Ground (Z=0)';
        optGroupPlan.appendChild(opt);
      }
      select.appendChild(optGroupPlan);

      // Elevation views
      const optGroupElev = document.createElement('optgroup');
      optGroupElev.label = 'Elevation Views';
      const grids = (appRef && appRef.gridManager && appRef.gridManager.grids) || [];
      if (grids.length) {
        for (const g of grids) {
          const opt = document.createElement('option');
          opt.value = `elev:${g.id}`;
          opt.textContent = `Elevation: Grid ${g.label || g.name || g.id}`;
          optGroupElev.appendChild(opt);
        }
      } else {
        for (const dir of ['Front (South)', 'Back (North)', 'Left (West)', 'Right (East)']) {
          const opt = document.createElement('option');
          opt.value = `elev:${dir.toLowerCase().split(' ')[0]}`;
          opt.textContent = `Elevation: ${dir}`;
          optGroupElev.appendChild(opt);
        }
      }
      select.appendChild(optGroupElev);

      // Set active selection
      if (this.type === '3d') select.value = '3d';
      else if (this.type === 'plan') select.value = this.storyId ? `plan:${this.storyId}` : 'plan:default';
      else if (this.type === 'elevation') select.value = this.gridId ? `elev:${this.gridId}` : (select.options && select.options[2] ? select.options[2].value : '3d');
    }

    _onViewSelectChange(val) {
      if (val === '3d') {
        this.type = '3d';
        this.title = '3D View';
        this.cam.az = -55 * RAD;
        this.cam.el = 28 * RAD;
        this.cam.ortho = false;
        this._icon.textContent = '⛶';
      } else if (val.startsWith('plan:')) {
        this.type = 'plan';
        const stId = val.slice(5);
        this.storyId = stId;
        const lv = appRef && appRef.levelManager && appRef.levelManager.levels.find(l => l.id === stId);
        const name = lv ? lv.name : 'Plan';
        const z = lv ? lv.elevation : 0;
        this.title = `Plan View — ${name} (Z=${z.toFixed(2)}m)`;
        this.cam.az = -90 * RAD;
        this.cam.el = 89.9 * RAD;
        this.cam.target.z = z;
        this.cam.ortho = true;
        this._icon.textContent = '⊞';
      } else if (val.startsWith('elev:')) {
        this.type = 'elevation';
        const gid = val.slice(5);
        this.gridId = gid;
        this.title = `Elevation View — ${gid.toUpperCase()}`;
        this.cam.az = -90 * RAD;
        this.cam.el = 0;
        this.cam.ortho = true;
        this._icon.textContent = '◫';
      }
      this._title.textContent = this.title;
      if (appRef && appRef.view) appRef.view.invalidate();
    }

    setResultBadge(text) {
      this.resultBadge = text || '';
      if (this._badge) {
        this._badge.textContent = this.resultBadge;
        this._badge.style.display = this.resultBadge ? 'inline-block' : 'none';
      }
    }
  }

  // ---------------------------------------------------- Layout Management
  function init(app) {
    appRef = app;
    const vp = document.getElementById('viewport');
    if (!vp) return;

    if (!containerEl) {
      containerEl = document.createElement('div');
      containerEl.id = 'etabs-multi-container';
      containerEl.className = 'etabs-multi-container etabs-single';
      vp.appendChild(containerEl);

      // Build initial pane
      const p1 = new ViewPane('pane-1', '3D View', '3d');
      panes = [p1];
      activePaneId = 'pane-1';
      renderDOM();
      buildWindowToolbar(vp);
    }

    // Hook canvas pointer and wheel events to activate hovered pane in multi-view mode
    const canvas = app.view && (app.view.canvas || (app.view.renderer && app.view.renderer.domElement));
    if (canvas && !canvas._etabsPaneHooked) {
      canvas._etabsPaneHooked = true;
      const activatePaneAt = (clientX, clientY) => {
        if (!isMultiViewActive()) return;
        for (const pane of getVisiblePanes()) {
          if (!pane.el) continue;
          const r = pane.el.getBoundingClientRect();
          if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
            if (activePaneId !== pane.id) {
              setActivePane(pane.id);
            }
            break;
          }
        }
      };

      canvas.addEventListener('pointerdown', ev => {
        activatePaneAt(ev.clientX, ev.clientY);
      }, { capture: true });

      canvas.addEventListener('wheel', ev => {
        activatePaneAt(ev.clientX, ev.clientY);
      }, { capture: true, passive: true });
    }
  }

  function buildWindowToolbar(vp) {
    if (document.getElementById('etabs-window-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'etabs-window-bar';
    bar.className = 'etabs-window-bar';
    bar.title = 'ETABS View Windows Management';

    bar.innerHTML = `
      <div class="ewb-group">
        <button class="ewb-btn active" data-layout="single" title="1 Window (Single View)">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
        </button>
        <button class="ewb-btn" data-layout="split-v" title="2 Windows Side-by-Side (Split Vertical)">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="8" y1="1" x2="8" y2="15" stroke="currentColor" stroke-width="1.6"/></svg>
        </button>
        <button class="ewb-btn" data-layout="split-h" title="2 Windows Top / Bottom (Split Horizontal)">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.6"/></svg>
        </button>
        <button class="ewb-btn" data-layout="quad" title="4 Windows (Quad 2×2 Viewports)">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="8" y1="1" x2="8" y2="15" stroke="currentColor" stroke-width="1.6"/><line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.6"/></svg>
        </button>
      </div>
      <div class="ewb-sep"></div>
      <button class="ewb-action-btn" id="ewb-add-window" title="+ Add New Window">+ Add Window</button>
      <button class="ewb-action-btn" id="ewb-arrange" title="Arrange / Tile Windows">Arrange</button>
    `;

    vp.appendChild(bar);

    bar.querySelectorAll('.ewb-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setLayout(btn.dataset.layout);
        bar.querySelectorAll('.ewb-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    bar.querySelector('#ewb-add-window')?.addEventListener('click', () => {
      addNewWindow();
    });

    bar.querySelector('#ewb-arrange')?.addEventListener('click', () => {
      arrangeWindows();
    });
  }

  function setLayout(mode) {
    layoutMode = mode;
    if (mode === 'single') {
      // Keep only 1 pane or restore primary
      if (panes.length > 1) {
        const active = getActivePane() || panes[0];
        panes = [active];
      }
    } else if (mode === 'split-v' || mode === 'split-h') {
      if (panes.length < 2) {
        // create secondary pane
        const p2 = new ViewPane('pane-2', 'Plan View — Story 1', 'plan', { storyId: 'lvl_1' });
        panes.push(p2);
      } else if (panes.length > 2) {
        panes = panes.slice(0, 2);
      }
    } else if (mode === 'quad') {
      while (panes.length < 4) {
        const idx = panes.length + 1;
        const type = idx === 2 ? 'plan' : idx === 3 ? 'elevation' : '3d';
        const title = idx === 2 ? 'Plan View — Story 1' : idx === 3 ? 'Elevation View — Grid A' : `3D View ${idx}`;
        const p = new ViewPane(`pane-${idx}`, title, type);
        panes.push(p);
      }
    }
    renderDOM();
    if (appRef && appRef.view) appRef.view.invalidate();
  }

  function addNewWindow() {
    if (panes.length >= 4) {
      if (appRef) appRef.toast('Maximum 4 view windows reached');
      return;
    }
    const idx = panes.length + 1;
    const p = new ViewPane(`pane-${idx}`, `View ${idx}`, panes.length % 2 === 1 ? 'plan' : '3d');
    panes.push(p);
    if (panes.length === 2) layoutMode = 'split-v';
    else if (panes.length >= 3) layoutMode = 'quad';
    renderDOM();
    updateToolbarActiveLayout();
    if (appRef) appRef.toast(`Added Window ${idx}`);
    if (appRef && appRef.view) appRef.view.invalidate();
  }

  function arrangeWindows() {
    splitRatio = 0.5;
    splitRatioY = 0.5;
    if (panes.length === 1) layoutMode = 'single';
    else if (panes.length === 2) layoutMode = 'split-v';
    else layoutMode = 'quad';
    renderDOM();
    updateToolbarActiveLayout();
    if (appRef) appRef.toast('Windows Arranged');
    if (appRef && appRef.view) appRef.view.invalidate();
  }

  function updateToolbarActiveLayout() {
    const bar = document.getElementById('etabs-window-bar');
    if (!bar) return;
    bar.querySelectorAll('.ewb-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.layout === layoutMode);
    });
  }

  function splitPane(paneId, direction) {
    if (panes.length >= 4) {
      if (appRef) appRef.toast('Maximum 4 view windows');
      return;
    }
    const idx = panes.length + 1;
    const p = new ViewPane(`pane-${idx}`, `3D View ${idx}`, '3d');
    panes.push(p);
    layoutMode = direction === 'vertical' ? 'split-v' : 'split-h';
    renderDOM();
    updateToolbarActiveLayout();
    if (appRef && appRef.view) appRef.view.invalidate();
  }

  function toggleMaximizePane(paneId) {
    const p = panes.find(x => x.id === paneId);
    if (!p) return;
    p.maximized = !p.maximized;
    if (p.maximized) {
      containerEl.classList.add('etabs-pane-maximized');
      panes.forEach(x => {
        if (x.id !== paneId) x.el.style.display = 'none';
        else x.el.style.display = 'flex';
      });
    } else {
      containerEl.classList.remove('etabs-pane-maximized');
      panes.forEach(x => { x.el.style.display = 'flex'; });
    }
    renderDOM();
    if (appRef && appRef.view) appRef.view.invalidate();
  }

  function closePane(paneId) {
    if (panes.length <= 1) {
      if (appRef) appRef.toast('Cannot close the last window');
      return;
    }
    panes = panes.filter(x => x.id !== paneId);
    if (panes.length === 1) layoutMode = 'single';
    else if (panes.length === 2) layoutMode = 'split-v';
    if (activePaneId === paneId) activePaneId = panes[0].id;
    renderDOM();
    updateToolbarActiveLayout();
    if (appRef && appRef.view) appRef.view.invalidate();
  }

  function setActivePane(paneId) {
    activePaneId = paneId;
    panes.forEach(p => {
      if (p.el) p.el.classList.toggle('etabs-pane-active', p.id === paneId);
    });
    const p = getActivePane();
    if (p && appRef) {
      if (typeof appRef.setStatus === 'function') {
        appRef.setStatus(`Active Window: ${p.title} — ${p.type.toUpperCase()} View`);
      }
      if (isMultiViewActive() && appRef.view && appRef.view.cam && p.cam) {
        if (p.type === '3d') {
          appRef.view.cam.az = p.cam.az;
          appRef.view.cam.el = p.cam.el;
          appRef.view.cam.ortho = false;
        } else {
          appRef.view.cam.ortho = true;
          appRef.view.cam.az = p.cam.az;
          appRef.view.cam.el = p.cam.el;
        }
        appRef.view.cam.dist = p.cam.dist;
        appRef.view.cam.target = { ...p.cam.target };
        if (typeof appRef.view.applyCamera === 'function') appRef.view.applyCamera();
        if (typeof appRef.view.invalidate === 'function') appRef.view.invalidate();
      }
    }
  }

  function getActivePane() {
    return panes.find(p => p.id === activePaneId) || panes[0] || null;
  }

  function getVisiblePanes() {
    return panes.filter(p => p.el && p.el.style.display !== 'none');
  }

  function isMultiViewActive() {
    return layoutMode !== 'single' && panes.length > 1;
  }

  function renderDOM() {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    containerEl.className = `etabs-multi-container etabs-${layoutMode}`;

    if (layoutMode === 'single') {
      // In single full view, hide multi-container completely so standard canvas has 100% unobstructed interaction
      containerEl.style.display = 'none';
      return;
    }
    containerEl.style.display = 'flex';

    if (layoutMode === 'split-v') {
      const p1 = panes[0], p2 = panes[1];
      if (p1 && p2) {
        p1.el.style.flex = `0 0 ${(splitRatio * 100).toFixed(1)}%`;
        p2.el.style.flex = `0 0 ${((1 - splitRatio) * 100).toFixed(1)}%`;
        containerEl.appendChild(p1.el);

        // Splitter
        const splitter = document.createElement('div');
        splitter.className = 'etabs-pane-splitter etabs-splitter-v';
        wireSplitter(splitter, 'v');
        containerEl.appendChild(splitter);

        containerEl.appendChild(p2.el);
      }
    } else if (layoutMode === 'split-h') {
      const p1 = panes[0], p2 = panes[1];
      if (p1 && p2) {
        p1.el.style.flex = `0 0 ${(splitRatioY * 100).toFixed(1)}%`;
        p2.el.style.flex = `0 0 ${((1 - splitRatioY) * 100).toFixed(1)}%`;
        containerEl.appendChild(p1.el);

        const splitter = document.createElement('div');
        splitter.className = 'etabs-pane-splitter etabs-splitter-h';
        wireSplitter(splitter, 'h');
        containerEl.appendChild(splitter);

        containerEl.appendChild(p2.el);
      }
    } else if (layoutMode === 'quad') {
      // 2 rows of 2 panes
      const topRow = document.createElement('div');
      topRow.className = 'etabs-quad-row';
      topRow.style.flex = `0 0 ${(splitRatioY * 100).toFixed(1)}%`;

      const botRow = document.createElement('div');
      botRow.className = 'etabs-quad-row';
      botRow.style.flex = `0 0 ${((1 - splitRatioY) * 100).toFixed(1)}%`;

      if (panes[0]) topRow.appendChild(panes[0].el);
      if (panes[1]) topRow.appendChild(panes[1].el);
      if (panes[2]) botRow.appendChild(panes[2].el);
      if (panes[3]) botRow.appendChild(panes[3].el);

      containerEl.appendChild(topRow);
      containerEl.appendChild(botRow);
    }

    setActivePane(activePaneId);
  }

  function wireSplitter(handle, dir) {
    let startX = 0, startY = 0, startRatio = 0;
    handle.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      handle.setPointerCapture(ev.pointerId);
      isDraggingSplitter = true;
      startX = ev.clientX;
      startY = ev.clientY;
      startRatio = dir === 'v' ? splitRatio : splitRatioY;
      document.body.style.cursor = dir === 'v' ? 'col-resize' : 'row-resize';
    });

    handle.addEventListener('pointermove', ev => {
      if (!isDraggingSplitter) return;
      const rect = containerEl.getBoundingClientRect();
      if (dir === 'v') {
        const delta = (ev.clientX - startX) / rect.width;
        splitRatio = Math.max(0.15, Math.min(0.85, startRatio + delta));
        renderDOM();
      } else {
        const delta = (ev.clientY - startY) / rect.height;
        splitRatioY = Math.max(0.15, Math.min(0.85, startRatio + delta));
        renderDOM();
      }
      if (appRef && appRef.view) appRef.view.invalidate();
    });

    const end = () => {
      if (!isDraggingSplitter) return;
      isDraggingSplitter = false;
      document.body.style.cursor = '';
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------- Multi-View Render Loop Hook
  function renderMultiViews(renderer, scene, viewport) {
    if (!isMultiViewActive()) {
      renderer.render(scene, viewport.activeCamera());
      return;
    }

    const canvas = renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();
    const visiblePanes = getVisiblePanes();

    renderer.setScissorTest(true);
    for (const pane of visiblePanes) {
      if (!pane.el) continue;
      const r = pane.el.getBoundingClientRect();
      // Translate to WebGL bottom-left coordinate system
      const left = Math.max(0, r.left - canvasRect.left);
      const bottom = Math.max(0, canvasRect.bottom - r.bottom);
      const width = Math.max(1, r.width);
      const height = Math.max(1, r.height);

      renderer.setViewport(left, bottom, width, height);
      // If this is the active pane, sync its camera parameters from viewport
      if (pane.id === activePaneId && pane.type === '3d') {
        pane.cam.az = viewport.cam.az;
        pane.cam.el = viewport.cam.el;
        pane.cam.dist = viewport.cam.dist;
        pane.cam.target = { ...viewport.cam.target };
      }

      pane.updateCamera(width, height);
      renderer.render(scene, pane.camera());
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
  }

  // Set active badge for a specific pane or all panes
  function setBadge(text, targetPaneId = null) {
    if (targetPaneId) {
      const p = panes.find(x => x.id === targetPaneId);
      if (p) p.setResultBadge(text);
    } else {
      const p = getActivePane();
      if (p) p.setResultBadge(text);
    }
  }

  function openLayoutDialog(app) {
    const cur = layoutMode;
    const html = `
      <div class="ed-form">
        <div class="ed-row">
          <label><b>ETABS Window Viewport Layout:</b></label>
          <div class="ed-radio-list">
            <label><input type="radio" name="ewl-mode" value="single" ${cur === 'single' ? 'checked' : ''}> <b>One View</b> (Single primary viewport)</label>
            <label><input type="radio" name="ewl-mode" value="split-v" ${cur === 'split-v' ? 'checked' : ''}> <b>Two Views — Split Vertical</b> (Side-by-side viewports)</label>
            <label><input type="radio" name="ewl-mode" value="split-h" ${cur === 'split-h' ? 'checked' : ''}> <b>Two Views — Split Horizontal</b> (Stacked top/bottom viewports)</label>
            <label><input type="radio" name="ewl-mode" value="quad" ${cur === 'quad' ? 'checked' : ''}> <b>Four Views (Quad)</b> (2×2 viewports: 3D, Plan, Elevation)</label>
          </div>
        </div>
      </div>
    `;
    app.dialog('Window Management — Layouts', html, [
      ['Apply', () => {
        const val = document.querySelector('input[name="ewl-mode"]:checked')?.value;
        if (val) {
          setLayout(val);
          updateToolbarActiveLayout();
        }
        return false;
      }],
      ['+ Add Window', () => {
        addNewWindow();
        return false;
      }],
      ['Arrange Windows', () => {
        arrangeWindows();
        return false;
      }],
      ['Close', () => {}]
    ]);
  }

  // Public API
  root.RCWindows = {
    init,
    setLayout,
    addNewWindow,
    arrangeWindows,
    openLayoutDialog,
    getActivePane,
    getVisiblePanes,
    isMultiViewActive,
    renderMultiViews,
    setBadge,
    panes: () => panes,
    setActivePane,
    getLayoutMode: () => layoutMode,
  };
})(window);
