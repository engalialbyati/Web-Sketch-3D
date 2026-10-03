'use strict';
// ---------------------------------------------------------------------------
// ui-viewcube.js — Interactive 3D ViewCube & Viewport HUD Control Bar.
//
// Provides standard BIM/CAD viewport navigation & visualization controls:
//   1. 3D ViewCube:
//      • Real-time 3D orientation tracking matching camera azimuth and elevation.
//      • Interactive faces: TOP, FRONT, RIGHT, BACK, LEFT, BOTTOM.
//      • Isometric corners for quick 3D perspective orientation.
//      • Integrated Compass ring with North, South, East, West.
//      • Direct drag-to-orbit on the cube.
//      • Home button resetting to standard 3D Isometric view.
//   2. Floating View Control Bar (HUD):
//      • Projection toggle: Perspective (3D) / Orthographic (Parallel)
//      • Visual Styles: Shaded, Monochrome, Wireframe, X-Ray
//      • Sun & Shadows live toggle
//      • Section Planes live toggle
//      • Level Datums & Grids visibility toggles
//      • Zoom Extents / Fit All
//      • 1-Click Clash Detection / Interference Check badge
// ---------------------------------------------------------------------------
(function () {
  const $ = id => document.getElementById(id);

  let cubeEl = null;
  let compassEl = null;
  let styleMenu = null;
  let projBtn = null;
  let styleBtn = null;
  let styleLabel = null;
  let shadowBtn = null;
  let sectionBtn = null;
  let levelsBtn = null;
  let gridsBtn = null;

  function boot() {
    const vp = $('viewport');
    if (!vp || $('viewcube-widget')) return;

    buildViewCube(vp);
    buildViewControlBar(vp);
    startSyncLoop();
  }

  // ----------------------------------------------------------- build ViewCube
  function buildViewCube(parent) {
    const wrap = document.createElement('div');
    wrap.id = 'viewcube-widget';
    wrap.className = 'viewcube-widget';
    wrap.title = 'ViewCube — Click a face to align camera, or drag to orbit';

    wrap.innerHTML = `
      <button id="viewcube-home" class="vc-home-btn" title="Default 3D View (Isometric)">⌂</button>
      <div class="vc-compass" id="vc-compass">
        <svg viewBox="0 0 100 100" class="vc-compass-svg">
          <circle cx="50" cy="50" r="46" class="vc-compass-circle" />
          <path d="M50 8 L54 22 L46 22 Z" class="vc-north-arrow" />
          <text x="50" y="20" class="vc-dir-text vc-dir-n" text-anchor="middle">N</text>
          <text x="84" y="54" class="vc-dir-text" text-anchor="middle">E</text>
          <text x="50" y="88" class="vc-dir-text" text-anchor="middle">S</text>
          <text x="16" y="54" class="vc-dir-text" text-anchor="middle">W</text>
        </svg>
      </div>
      <div class="vc-cube-scene">
        <div class="vc-cube" id="vc-cube">
          <div class="vc-face vc-top" data-view="top">TOP</div>
          <div class="vc-face vc-bottom" data-view="bottom">BOTTOM</div>
          <div class="vc-face vc-front" data-view="front">FRONT</div>
          <div class="vc-face vc-back" data-view="back">BACK</div>
          <div class="vc-face vc-left" data-view="left">LEFT</div>
          <div class="vc-face vc-right" data-view="right">RIGHT</div>
          <!-- Corner hotspots for isometric alignment -->
          <div class="vc-corner vc-c-tfl" data-view="iso-fl" title="Top-Front-Left Iso"></div>
          <div class="vc-corner vc-c-tfr" data-view="iso-fr" title="Top-Front-Right Iso"></div>
          <div class="vc-corner vc-c-tbl" data-view="iso-bl" title="Top-Back-Left Iso"></div>
          <div class="vc-corner vc-c-tbr" data-view="iso-br" title="Top-Back-Right Iso"></div>
        </div>
      </div>
    `;

    parent.appendChild(wrap);
    cubeEl = wrap.querySelector('#vc-cube');
    compassEl = wrap.querySelector('#vc-compass');

    // Home button
    wrap.querySelector('#viewcube-home').addEventListener('click', e => {
      e.stopPropagation();
      if (!window.app) return;
      app.view.cam.ortho = false;
      app.setStandardView('iso');
      app.toast('Default 3D View');
    });

    // Face / corner clicks
    wrap.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!window.app) return;
        const v = btn.dataset.view;
        handleViewPick(v);
      });
    });

    // Drag-to-orbit on ViewCube
    let dragging = false;
    let lastX = 0, lastY = 0;
    wrap.addEventListener('pointerdown', e => {
      if (e.target.dataset.view || e.target.id === 'viewcube-home') return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      wrap.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    wrap.addEventListener('pointermove', e => {
      if (!dragging || !window.app || !app.view) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      app.view.orbit(dx * 1.8, dy * 1.8);
      app.view.applyCamera();
      app.view.requestRender && app.view.requestRender();
    });
    const stopDrag = () => { dragging = false; };
    wrap.addEventListener('pointerup', stopDrag);
    wrap.addEventListener('pointercancel', stopDrag);
  }

  function handleViewPick(viewKey) {
    const a = window.app;
    if (!a) return;
    const RAD = Math.PI / 180;

    if (viewKey.startsWith('iso-')) {
      a.view.viewLocked = false;
      a.view.lockedViewName = null;
      if (viewKey === 'iso-fl') { a.view.cam.az = -45 * RAD; a.view.cam.el = 30 * RAD; }
      else if (viewKey === 'iso-fr') { a.view.cam.az = -135 * RAD; a.view.cam.el = 30 * RAD; }
      else if (viewKey === 'iso-bl') { a.view.cam.az = 45 * RAD; a.view.cam.el = 30 * RAD; }
      else if (viewKey === 'iso-br') { a.view.cam.az = 135 * RAD; a.view.cam.el = 30 * RAD; }
      a.view.applyCamera();
      a.view.requestRender && a.view.requestRender();
      a.toast(`3D Isometric View (${viewKey.replace('iso-', '').toUpperCase()})`);
      return;
    }

    if (viewKey === 'top') {
      a.setStandardView('top');
      a.toast('Top Plan View (Locked)');
    } else if (viewKey === 'bottom') {
      a.setStandardView('bottom');
      a.toast('Bottom Reflected View (Locked)');
    } else if (viewKey === 'front') {
      a.setStandardView('front');
      a.toast('South / Front Elevation (Locked)');
    } else if (viewKey === 'back') {
      a.setStandardView('back');
      a.toast('North / Back Elevation (Locked)');
    } else if (viewKey === 'right') {
      a.setStandardView('right');
      a.toast('East / Right Elevation (Locked)');
    } else if (viewKey === 'left') {
      a.setStandardView('left');
      a.toast('West / Left Elevation (Locked)');
    }
  }

  // ----------------------------------------------------- build ViewControlBar
  function buildViewControlBar(parent) {
    const bar = document.createElement('div');
    bar.id = 'view-control-bar';
    bar.className = 'view-ctrl-bar';
    bar.innerHTML = `
      <button class="vcb-btn" id="vcb-proj" title="Toggle Perspective (3D) / Orthographic (Parallel)">
        <span class="vcb-icon">📐</span><span class="vcb-txt" id="vcb-proj-txt">3D Persp</span>
      </button>
      <div class="vcb-sep"></div>
      <div class="vcb-dropdown-wrap">
        <button class="vcb-btn" id="vcb-style-btn" title="Visual Style: Shaded / Monochrome / Wireframe / X-Ray">
          <span class="vcb-icon">🎨</span><span class="vcb-txt" id="vcb-style-label">Shaded</span>
        </button>
        <div class="vcb-menu hidden" id="vcb-style-menu">
          <div class="vcb-menu-item active" data-style="shaded"><span class="vcb-dot dot-shaded"></span>Shaded with Edges</div>
          <div class="vcb-menu-item" data-style="monochrome"><span class="vcb-dot dot-mono"></span>Monochrome (Clay)</div>
          <div class="vcb-menu-item" data-style="wireframe"><span class="vcb-dot dot-wire"></span>Wireframe</div>
          <div class="vcb-menu-item" data-style="xray"><span class="vcb-dot dot-xray"></span>X-Ray Transparency</div>
        </div>
      </div>
      <div class="vcb-sep"></div>
      <button class="vcb-btn" id="vcb-shadow" title="Toggle Sun & Realistic Shadows">
        <span class="vcb-icon">☀️</span><span class="vcb-txt">Shadows</span>
      </button>
      <button class="vcb-btn" id="vcb-section" title="Interactive Section Plane & Live Cut Box">
        <span class="vcb-icon">✂️</span><span class="vcb-txt">Section</span>
      </button>
      <div class="vcb-sep"></div>
      <button class="vcb-btn" id="vcb-levels" title="Toggle Level Planes in 3D View">
        <span class="vcb-icon">📏</span><span class="vcb-txt">Levels</span>
      </button>
      <button class="vcb-btn" id="vcb-grids" title="Toggle Structural Grids in 3D View">
        <span class="vcb-icon">#</span><span class="vcb-txt">Grids</span>
      </button>
      <div class="vcb-sep"></div>
      <button class="vcb-btn" id="vcb-fit" title="Zoom to Fit Entire Model (Ctrl+Shift+E)">
        <span class="vcb-icon">⛶</span><span class="vcb-txt">Fit All</span>
      </button>
      <button class="vcb-btn vcb-clash" id="vcb-clash" title="Run Interference Check (BIM Clash Detection)">
        <span class="vcb-icon">⚡</span><span class="vcb-txt">Clash Check</span>
      </button>
    `;

    parent.appendChild(bar);

    projBtn = bar.querySelector('#vcb-proj');
    styleBtn = bar.querySelector('#vcb-style-btn');
    styleLabel = bar.querySelector('#vcb-style-label');
    styleMenu = bar.querySelector('#vcb-style-menu');
    shadowBtn = bar.querySelector('#vcb-shadow');
    sectionBtn = bar.querySelector('#vcb-section');
    levelsBtn = bar.querySelector('#vcb-levels');
    gridsBtn = bar.querySelector('#vcb-grids');

    // Perspective / Ortho
    projBtn.addEventListener('click', () => {
      if (!window.app || !app.view) return;
      app.view.cam.ortho = !app.view.cam.ortho;
      app.view.applyCamera();
      app.view.requestRender && app.view.requestRender();
      syncHudControls();
      app.toast(app.view.cam.ortho ? 'Orthographic (Parallel) Projection' : 'Perspective (3D) Projection');
    });

    // Style menu toggle
    styleBtn.addEventListener('click', e => {
      e.stopPropagation();
      styleMenu.classList.toggle('hidden');
    });
    document.addEventListener('pointerdown', e => {
      if (!styleMenu.classList.contains('hidden') && !styleMenu.contains(e.target) && e.target !== styleBtn) {
        styleMenu.classList.add('hidden');
      }
    });

    // Style select
    styleMenu.querySelectorAll('[data-style]').forEach(item => {
      item.addEventListener('click', () => {
        const s = item.dataset.style;
        if (!window.app) return;
        if (s === 'xray') {
          app.action('toggleXray');
        } else {
          if (app.xrayOn) app.action('toggleXray');
          app.setFaceStyle(s);
        }
        styleMenu.classList.add('hidden');
        syncHudControls();
      });
    });

    // Shadows
    shadowBtn.addEventListener('click', () => {
      if (!window.app) return;
      app.action('toggleShadows');
      syncHudControls();
    });

    // Section planes
    sectionBtn.addEventListener('click', () => {
      if (!window.app) return;
      app.action('sectionPlanesDlg');
    });

    // Levels toggle
    levelsBtn.addEventListener('click', () => {
      if (!window.app || !app.view) return;
      const v = app.view;
      if (v.levelPlaneGroup) {
        v.levelPlaneGroup.visible = !v.levelPlaneGroup.visible;
        levelsBtn.classList.toggle('on', v.levelPlaneGroup.visible);
        v.requestRender && v.requestRender();
        app.toast(v.levelPlaneGroup.visible ? 'Level Planes: Visible' : 'Level Planes: Hidden');
      }
    });

    // Grids toggle
    gridsBtn.addEventListener('click', () => {
      if (!window.app || !app.view) return;
      const v = app.view;
      if (v.gridGroup) {
        v.gridGroup.visible = !v.gridGroup.visible;
        gridsBtn.classList.toggle('on', v.gridGroup.visible);
        v.requestRender && v.requestRender();
        app.toast(v.gridGroup.visible ? 'Structural Grids: Visible' : 'Structural Grids: Hidden');
      }
    });

    // Fit All
    bar.querySelector('#vcb-fit').addEventListener('click', () => {
      if (window.app && app.view) {
        app.view.zoomExtents();
        app.toast('Zoom Extents (Fit All)');
      }
    });

    // Clash Check
    bar.querySelector('#vcb-clash').addEventListener('click', () => {
      if (window.app) app.interferenceCheck();
    });
  }

  // ------------------------------------------------------------- HUD sync
  function syncHudControls() {
    const a = window.app;
    if (!a || !a.view) return;

    if (projBtn) {
      const isOrtho = !!a.view.cam.ortho;
      projBtn.classList.toggle('on', isOrtho);
      const txt = $('vcb-proj-txt');
      if (txt) txt.textContent = isOrtho ? '2D Ortho' : '3D Persp';
    }

    if (styleLabel) {
      if (a.xrayOn) styleLabel.textContent = 'X-Ray';
      else {
        const labels = { shaded: 'Shaded', monochrome: 'Mono', wireframe: 'Wire' };
        styleLabel.textContent = labels[a.faceStyle] || 'Shaded';
      }
    }
    if (styleMenu) {
      styleMenu.querySelectorAll('[data-style]').forEach(it => {
        const st = it.dataset.style;
        const active = st === 'xray' ? !!a.xrayOn : (!a.xrayOn && a.faceStyle === st);
        it.classList.toggle('active', active);
      });
    }

    if (shadowBtn) shadowBtn.classList.toggle('on', !!a.shadowsOn);
    if (levelsBtn && a.view.levelPlaneGroup) levelsBtn.classList.toggle('on', !!a.view.levelPlaneGroup.visible);
    if (gridsBtn && a.view.gridGroup) gridsBtn.classList.toggle('on', !!a.view.gridGroup.visible);
  }

  // --------------------------------------------------------- animation loop
  function startSyncLoop() {
    let lastDegX = null, lastDegZ = null;

    function tick() {
      requestAnimationFrame(tick);
      const a = window.app;
      if (!a || !a.view || !a.view.cam || !cubeEl) return;

      const az = a.view.cam.az || 0;
      const el = a.view.cam.el || 0;

      // CSS 3D cube rotation angles matching Three.js orbit:
      const degX = Math.round(((el * 180 / Math.PI) - 90) * 10) / 10;
      const degZ = Math.round(((-az * 180 / Math.PI) - 90) * 10) / 10;

      if (degX !== lastDegX || degZ !== lastDegZ) {
        lastDegX = degX;
        lastDegZ = degZ;
        cubeEl.style.transform = `rotateX(${degX}deg) rotateZ(${degZ}deg)`;
        if (compassEl) {
          compassEl.style.transform = `rotateZ(${-az * 180 / Math.PI - 90}deg)`;
        }
      }
    }

    requestAnimationFrame(tick);
    setInterval(syncHudControls, 1000);
  }

  window.ViewCubeWidget = {
    boot,
    sync: syncHudControls,
  };

  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();
