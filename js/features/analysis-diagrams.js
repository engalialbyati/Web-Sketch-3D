'use strict';
// features/analysis-diagrams.js — ETABS-style force diagram display.
// Draws filled moment / shear / axial diagrams along every frame element of
// the last analysis, plus a deformed-shape overlay, directly in the 3D
// viewport. A floating chip cycles diagram type and load combination and
// shows the value scale; everything clears when the model changes.
//
// Conventions (from js/fea.js end forces, local axes):
//   forces = [fx1, fy1, fz1, mx1, my1, mz1, fx2, ...] acting ON the element.
//   Axial (tension+) = −fx1. Bending pair in the local x-y plane is
//   (shear fy, moment Mz) — diagram offsets along local y; the pair in the
//   x-z plane is (fz, My) with offsets along local z. Loads are nodal, so
//   between nodes N and V are constant and M is linear.
(function () {
  const TYPES = [
    { id: 'moment', label: 'Moment', unit: 'kN·m', color: 0xe0533d },
    { id: 'shear', label: 'Shear', unit: 'kN', color: 0x2aa8c4 },
    { id: 'axial', label: 'Axial', unit: 'kN', color: 0x8a6fd6 },
    { id: 'deformed', label: 'Deformed', unit: '', color: 0x3fa34d },
  ];

  // Dominant bending plane per element: bending in the local x-z plane
  // (moment My) pairs with shear fz and diagrams offset along local z;
  // bending in the x-y plane (moment Mz) pairs with shear fy and offsets
  // along local y. Whichever plane's moment envelopes larger wins and is
  // used for both the moment and the shear diagram.
  function endPairs(forces) {
    const f = forces;
    const mZ = Math.max(Math.abs(f[5]), Math.abs(f[11]));
    const mY = Math.max(Math.abs(f[4]), Math.abs(f[10]));
    return mY > mZ
      ? { shear: [f[2], f[8]], moment: [f[4], f[10]], axis: 'z' }  // x-z plane
      : { shear: [f[1], f[7]], moment: [f[5], f[11]], axis: 'y' }; // x-y plane
  }

  function localAxes(a, b) {
    const FEA = window.FEA;
    const R = FEA.rotationMatrix(a, b);
    return { y: R[1], z: R[2] }; // rows of R = local axes in model coords
  }

  function clear(app) {
    if (app._diagAnim) { clearInterval(app._diagAnim); app._diagAnim = null; }
    if (app._diagPass) {
      while (app._diagPass.children.length) {
        const c = app._diagPass.children[0];
        app._diagPass.remove(c);
        c.traverse(o => {
          if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
          }
          if (o.geometry) o.geometry.dispose();
        });
      }
      app._diagPass.visible = false;
    }
    if (app._diagChip) { app._diagChip.remove(); app._diagChip = null; }
    app._diagState = null;
    if (app.view && app.view.invalidate) app.view.invalidate();
  }

  function labelSprite(text, colorCss, sizeM) {
    if (typeof document === 'undefined') return null; // headless (tests)
    const c = document.createElement('canvas');
    c.width = 256; c.height = 72;
    const g = c.getContext && c.getContext('2d');
    if (!g) return null; // canvas without 2d context (headless test DOM)
    g.font = '600 34px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.82)';
    const w = Math.min(248, g.measureText(text).width + 22);
    g.fillRect(128 - w / 2, 14, w, 44);
    g.fillStyle = colorCss;
    g.fillText(text, 128, 37);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(sizeM * 3.4, sizeM * 0.96, 1);
    sp.renderOrder = 1000;
    return sp;
  }

  // main entry: type ∈ {moment, shear, axial, deformed} or null to clear
  function show(app, type, comboIdx) {
    const analysis = app._lastAnalysis;
    if (!analysis || analysis.error) { app.toast('Run the analysis first (Analyze tab ▸ Run Analysis)', true); return; }
    if (!window.THREE || !app.view || !app.view.scene) return;
    const view = app.view, scene = view.scene;
    if (!app._diagPass) {
      app._diagPass = new THREE.Group();
      app._diagPass.name = 'analysis-diagrams';
      scene.add(app._diagPass);
    }
    // reset
    while (app._diagPass.children.length) {
      const c = app._diagPass.children[0];
      app._diagPass.remove(c);
      c.traverse(o => {
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
        if (o.geometry) o.geometry.dispose();
      });
    }
    app._diagPass.visible = true;
    const st = app._diagState = { type: type || 'moment', combo: comboIdx || 0 };
    const T = TYPES.find(t => t.id === st.type);
    const res = analysis.results[st.combo] || analysis.results[0];
    if (!res) { clear(app); return; }
    const mesh = analysis.mesh;
    const nodes = mesh.nodes;

    // model size for auto-scaling (meters)
    let min = { x: 1e9, y: 1e9, z: 1e9 }, max = { x: -1e9, y: -1e9, z: -1e9 };
    for (const n of nodes) {
      min.x = Math.min(min.x, n.x); max.x = Math.max(max.x, n.x);
      min.y = Math.min(min.y, n.y); max.y = Math.max(max.y, n.y);
      min.z = Math.min(min.z, n.z); max.z = Math.max(max.z, n.z);
    }
    const bbox = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1e-6);
    const labelSize = Math.max(bbox * 0.018, 0.12);

    // ------------------------------------------------------ deformed shape
    if (st.type === 'deformed') {
      let maxU = 0;
      for (let i = 0; i < nodes.length; i++) {
        const u = Math.hypot(res.U[i * 6] || 0, res.U[i * 6 + 1] || 0, res.U[i * 6 + 2] || 0);
        if (u > maxU) maxU = u;
      }
      const factor = maxU > 1e-9 ? (bbox * 0.18) / maxU : 0; // mm → m·factor
      const pos = i => {
        const n = nodes[i];
        return {
          x: n.x + (res.U[i * 6] || 0) * factor / 1000,
          y: n.y + (res.U[i * 6 + 1] || 0) * factor / 1000,
          z: n.z + (res.U[i * 6 + 2] || 0) * factor / 1000,
        };
      };
      const ghostPts = [], defPts = [];
      for (const fr of mesh.frames) {
        const a = nodes[fr.ni], b = nodes[fr.nj];
        ghostPts.push(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z));
        const a2 = pos(fr.ni), b2 = pos(fr.nj);
        defPts.push(new THREE.Vector3(a2.x, a2.y, a2.z), new THREE.Vector3(b2.x, b2.y, b2.z));
      }
      const mk = (pts, color, op) => {
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: op });
        const l = new THREE.LineSegments(geo, m);
        app._diagPass.add(l);
        return l;
      };
      mk(ghostPts, 0x9aa4ad, 0.35);
      mk(defPts, T.color, 1);
      // max-drift label at the extreme node
      let mi = -1, mv = 0;
      for (let i = 0; i < nodes.length; i++) {
        const u = Math.hypot(res.U[i * 6] || 0, res.U[i * 6 + 1] || 0, res.U[i * 6 + 2] || 0);
        if (u > mv) { mv = u; mi = i; }
      }
      if (mi >= 0 && mv > 1e-9) {
        const p = pos(mi);
        const sp = labelSprite((mv).toFixed(1) + ' mm', '#2c7a3f', labelSize);
        if (sp) { sp.position.set(p.x, p.y, p.z); app._diagPass.add(sp); }
      }
      buildChip(app, T, res.combo, 'amplification ' + factor.toFixed(0) + '×');
      view.invalidate();
      return;
    }

    // -------------------------------------------------- force diagrams (M/V/N)
    // collect per-element station values to find the global max first
    const els = [];
    let gMax = 0;
    for (const fr of mesh.frames) {
      const fe = res.frames.find(f2 => f2.el === fr);
      if (!fe) continue;
      const a = nodes[fr.ni], b = nodes[fr.nj];
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (len < 1e-4) continue;
      const pairs = endPairs(fe.forces);
      let v0, v1; // values at start / end stations
      if (st.type === 'moment') { v0 = pairs.moment[0]; v1 = pairs.moment[1]; }
      else if (st.type === 'shear') { v0 = pairs.shear[0]; v1 = pairs.shear[1]; }
      else { v0 = -fe.forces[0]; v1 = -fe.forces[6]; } // axial, tension+
      const wl = fe.wl || {};
      const wSpan = st.type === 'moment' ? (pairs.axis === 'z' ? (wl.wz || 0) : (wl.wy || 0)) : 0;
      els.push({ fr, fe, a, b, len, pairs, v0, v1 });
      // scale must size the parabolic hump too, not just the end values
      for (let s = 0; s <= 4; s++) {
        const t = s / 4;
        gMax = Math.max(gMax, Math.abs(v0 + (v1 - v0) * t - wSpan * t * (1 - t) * len * len * 5e5));
      }
    }
    if (gMax < 1e-9) {
      buildChip(app, T, res.combo, 'no ' + st.type + ' in this combination');
      view.invalidate();
      return;
    }
    const unitScale = (bbox * 0.13) / gMax; // diagram meters per unit value
    const fillMat = new THREE.MeshBasicMaterial({
      color: T.color, transparent: true, opacity: 0.42, side: THREE.DoubleSide,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    });
    const lineMat = new THREE.LineBasicMaterial({ color: T.color, transparent: true, opacity: 0.95 });
    const zeroMat = new THREE.LineBasicMaterial({ color: 0x37424d, transparent: true, opacity: 0.9 });
    const NSEG = 8;
    const labels = [];
    for (const e of els) {
      const { a, b, len, pairs } = e;
      const ax = pairs.axis === 'z' ? localAxes(a, b).z : localAxes(a, b).y;
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len };
      // span loads superpose their parabolic/free bending on the linear
      // interpolation of the end values (exact for uniform loads)
      const wl = e.fe.wl || {};
      const wSpan = st.type === 'moment'
        ? (pairs.axis === 'z' ? (wl.wz || 0) : (wl.wy || 0)) : 0;
      // w in N/mm, len in m → span moment term in N·mm (len_mm² = len²·1e6)
      const vAt = t => e.v0 + (e.v1 - e.v0) * t - wSpan * t * (1 - t) * len * len * 5e5;
      // station points on the offset curve + on the axis
      const curve = [], axis = [];
      for (let s = 0; s <= NSEG; s++) {
        const t = s / NSEG;
        const v = vAt(t);
        const px = a.x + dir.x * len * t, py = a.y + dir.y * len * t, pz = a.z + dir.z * len * t;
        axis.push(new THREE.Vector3(px, py, pz));
        curve.push(new THREE.Vector3(px + ax[0] * v * unitScale, py + ax[1] * v * unitScale, pz + ax[2] * v * unitScale));
      }
      // filled ribbon between axis and curve
      const tris = [];
      for (let s = 0; s < NSEG; s++) {
        tris.push(axis[s], curve[s], curve[s + 1]);
        tris.push(axis[s], curve[s + 1], axis[s + 1]);
      }
      const geo = new THREE.BufferGeometry().setFromPoints(tris);
      app._diagPass.add(new THREE.Mesh(geo, fillMat));
      // outline of the curve + the axis (member reference line)
      app._diagPass.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve), lineMat));
      app._diagPass.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(axis), zeroMat));
      // remember the extreme station of this element for labeling
      let best = 0, bi = 0;
      for (let s = 0; s <= NSEG; s++) {
        const v = Math.abs(vAt(s / NSEG));
        if (v > best) { best = v; bi = s; }
      }
      labels.push({ p: curve[bi], v: vAt(bi / NSEG) });
    }
    // value labels: largest stations, capped, and only significant values
    // (a wall of tiny numbers at diagram peaks reads as noise)
    labels.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
    const css = '#' + T.color.toString(16).padStart(6, '0');
    for (const lb of labels) {
      if (Math.abs(lb.v) < gMax * 0.25) break;
      if (app._diagPass.children.length > 220) break;
      const sp = labelSprite((lb.v / (st.type === 'moment' ? 1e6 : 1e3)).toFixed(1), css, labelSize);
      if (!sp) break;
      sp.position.copy(lb.p);
      app._diagPass.add(sp);
    }
    buildChip(app, T, res.combo, 'full scale = ' + (gMax / (st.type === 'moment' ? 1e6 : 1e3)).toFixed(1) + ' ' + T.unit);
    view.invalidate();
  }

  // floating viewport chip: type cycler + combination cycler + close
  function buildChip(app, T, comboName, note) {
    if (typeof document === 'undefined' || !app.view || !app.view.container || !app.view.container.appendChild) return;
    if (app._diagChip) app._diagChip.remove();
    const analysis = app._lastAnalysis;
    const chip = document.createElement('div');
    chip.style.cssText = 'position:absolute;top:10px;right:12px;z-index:20;display:flex;gap:6px;align-items:center;' +
      'background:rgba(28,34,40,.92);color:#e8eef2;border:1px solid rgba(255,255,255,.16);border-radius:8px;' +
      'padding:5px 8px;font:600 11px system-ui;pointer-events:auto;box-shadow:0 4px 14px rgba(0,0,0,.25)';
    const typeBtn = (id, label) =>
      `<button data-t="${id}" style="all:unset;cursor:pointer;padding:3px 8px;border-radius:5px;${id === T.id ? 'background:#3b82f6;color:#fff' : 'opacity:.75'}">${label}</button>`;
    chip.innerHTML =
      typeBtn('moment', 'M') + typeBtn('shear', 'V') + typeBtn('axial', 'N') + typeBtn('deformed', 'Def') +
      `<span style="opacity:.55">|</span>` +
      `<button data-c="-1" style="all:unset;cursor:pointer;padding:3px 6px;opacity:.8">‹</button>` +
      `<span style="min-width:118px;text-align:center;opacity:.9">${comboName}</span>` +
      `<button data-c="1" style="all:unset;cursor:pointer;padding:3px 6px;opacity:.8">›</button>` +
      `<span style="opacity:.6;font-weight:500;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${note}">${note}</span>` +
      `<span style="opacity:.55">|</span>` +
      `<button data-x="1" style="all:unset;cursor:pointer;padding:3px 7px;border-radius:5px;background:#b91c1c;color:#fff">✕</button>`;
    const st = app._diagState;
    chip.onclick = ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.t) show(app, b.dataset.t, st.combo);
      else if (b.dataset.c) show(app, st.type, (st.combo + analysis.results.length + (+b.dataset.c)) % analysis.results.length);
      else clear(app);
    };
    app.view.container.appendChild(chip);
    app._diagChip = chip;
  }

  // ------------------------------------------------------ mode shapes
  // Draw (and animate) eigenvector i of the last modal run. phi is
  // mass-normalized and unitless — the drawing amplitude is auto-scaled
  // like the deformed shape and animated with a sinusoidal factor.
  function showMode(app, modeIdx) {
    const modal = app._lastModal;
    if (!modal || !modal.modes || !modal.modes.length) {
      app.toast('Run the modal analysis first (Analyze tab ▸ Modal Analysis)', true);
      return;
    }
    if (!window.THREE || !app.view || !app.view.scene) return;
    const i = ((modeIdx % modal.modes.length) + modal.modes.length) % modal.modes.length;
    const mode = modal.modes[i];
    const scene = app.view.scene;
    if (!app._diagPass) {
      app._diagPass = new THREE.Group();
      app._diagPass.name = 'analysis-diagrams';
      scene.add(app._diagPass);
    }
    if (app._diagAnim) { clearInterval(app._diagAnim); app._diagAnim = null; }
    while (app._diagPass.children.length) {
      const c = app._diagPass.children[0];
      app._diagPass.remove(c);
      c.traverse(o => {
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
        if (o.geometry) o.geometry.dispose();
      });
    }
    app._diagPass.visible = true;
    const nodes = modal.mesh.nodes;
    const phi = mode.phi;
    let maxP = 0;
    for (let n = 0; n < nodes.length; n++) {
      const d = Math.hypot(phi[n * 6] || 0, phi[n * 6 + 1] || 0, phi[n * 6 + 2] || 0);
      if (d > maxP) maxP = d;
    }
    let min = { x: 1e9, y: 1e9, z: 1e9 }, max = { x: -1e9, y: -1e9, z: -1e9 };
    for (const n of nodes) {
      min.x = Math.min(min.x, n.x); max.x = Math.max(max.x, n.x);
      min.y = Math.min(min.y, n.y); max.y = Math.max(max.y, n.y);
      min.z = Math.min(min.z, n.z); max.z = Math.max(max.z, n.z);
    }
    const bbox = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1e-6);
    const base = maxP > 1e-12 ? (bbox * 0.22) / maxP : 0; // unitless phi → meters
    const draw = (amp) => {
      while (app._diagPass.children.length) {
        const c = app._diagPass.children[0];
        app._diagPass.remove(c);
        c.traverse(o => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); });
      }
      const ghostPts = [], defPts = [];
      for (const fr of modal.mesh.frames) {
        const a = nodes[fr.ni], b = nodes[fr.nj];
        ghostPts.push(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z));
        const pos = ni => new THREE.Vector3(
          nodes[ni].x + (phi[ni * 6] || 0) * base * amp,
          nodes[ni].y + (phi[ni * 6 + 1] || 0) * base * amp,
          nodes[ni].z + (phi[ni * 6 + 2] || 0) * base * amp);
        defPts.push(pos(fr.ni), pos(fr.nj));
      }
      const mk = (pts, color, op) => {
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: op });
        app._diagPass.add(new THREE.LineSegments(geo, m));
      };
      mk(ghostPts, 0x9aa4ad, 0.35);
      mk(defPts, 0x3fa34d, 1);
    };
    draw(1);
    // animate: amplitude = |sin| gives a breathing oscillation
    const t0 = Date.now();
    app._diagAnim = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      draw(Math.sin(2 * Math.PI * 0.55 * t));
      app.view.invalidate();
    }, 90);
    buildChip(app, { id: 'deformed', label: 'Mode', unit: 'Hz', color: 0x3fa34d },
      'Mode ' + (i + 1) + ' — ' + mode.f.toFixed(2) + ' Hz (T = ' + mode.T.toFixed(3) + ' s)',
      'press ‹ › to cycle modes');
    // extend the chip: ‹ › cycle MODES, type buttons go back to force diagrams
    if (app._diagChip) {
      app._diagChip.onclick = ev => {
        const b = ev.target.closest('button');
        if (!b) return;
        if (b.dataset.t) show(app, b.dataset.t, app._diagState ? app._diagState.combo : 0);
        else if (b.dataset.c) showMode(app, i + (+b.dataset.c));
        else clear(app);
      };
    }
    app.view.invalidate();
  }

  window.AnalysisDiagrams = { show, showMode, clear };
})();
