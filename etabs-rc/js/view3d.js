'use strict';
// view3d.js — the 3D viewport: Three.js scene with the real model,
// deformed shapes, and M/V/P diagrams drawn as offset ribbons.
(function () {
  let scene, camera, renderer, controls;
  let memberGroup, overlayGroup, gridGroup;
  let raycaster, mouse3;
  const V = window.V3 = {};

  V.init = function (app) {
    V.app = app;
    const container = document.getElementById('canvasContainer');
    const canvas = document.getElementById('cadCanvas');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 2000);
    camera.up.set(0, 0, 1);
    camera.position.set(28, -25, 20);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const d = new THREE.DirectionalLight(0xffffff, 0.6);
    d.position.set(30, -20, 40);
    scene.add(d);
    gridGroup = new THREE.Group(); scene.add(gridGroup);
    memberGroup = new THREE.Group(); scene.add(memberGroup);
    overlayGroup = new THREE.Group(); scene.add(overlayGroup);
    raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 0.35;
    mouse3 = new THREE.Vector2();
    canvas.addEventListener('click', e => V.click(e));
    window.addEventListener('resize', V.resize);
    V.animate();
  };

  V.resize = function () {
    const c = document.getElementById('canvasContainer');
    if (!c || !renderer) return;
    camera.aspect = c.clientWidth / Math.max(c.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(c.clientWidth, c.clientHeight);
  };

  V.setAngle = function (preset) {
    const t = V.center();
    if (preset === 'iso') camera.position.set(t.x + 25, t.y - 22, t.z + 18);
    else if (preset === 'top') camera.position.set(t.x, t.y - 0.01, t.z + 30);
    else if (preset === 'front') camera.position.set(t.x, t.y - 32, t.z);
    controls.target.copy(t);
    controls.update();
  };

  V.center = function () {
    const m = V.app.model;
    if (!m.joints.length) return new THREE.Vector3(6, 4, 4);
    let x = 0, y = 0, z = 0;
    for (const j of m.joints) { x += j.x; y += j.y; z += j.z; }
    const n = m.joints.length;
    return new THREE.Vector3(x / n, y / n, z / n);
  };

  const P = j => new THREE.Vector3(j.x, j.y, j.z);

  // ------------------------------------------------------------ build
  V.build = function () {
    if (!scene) return;
    const app = V.app, m = app.model;
    while (memberGroup.children.length) memberGroup.remove(memberGroup.children[0]);
    while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
    while (overlayGroup.children.length) overlayGroup.remove(overlayGroup.children[0]);

    // gridlines at base
    const gp = [];
    const zs = m.stories.map(s => s.elevation);
    const z0 = Math.min(...zs, 0);
    let x0 = -1, x1 = 13, y0 = -1, y1 = 11;
    const xs = m.grids.x.map(g => g.pos), ys = m.grids.y.map(g => g.pos);
    for (const j of m.joints) { xs.push(j.x); ys.push(j.y); }
    if (xs.length) { x0 = Math.min(...xs) - 1.5; x1 = Math.max(...xs) + 1.5; }
    if (ys.length) { y0 = Math.min(...ys) - 1.5; y1 = Math.max(...ys) + 1.5; }
    for (const gx of m.grids.x) gp.push(new THREE.Vector3(gx.pos, y0, z0), new THREE.Vector3(gx.pos, y1, z0));
    for (const gy of m.grids.y) gp.push(new THREE.Vector3(x0, gy.pos, z0), new THREE.Vector3(x1, gy.pos, z0));
    if (gp.length) gridGroup.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(gp),
      new THREE.LineBasicMaterial({ color: 0x334155 })));

    // members
    const disp = app.disp;
    const showDiagrams = disp && (disp.kind === 'moment' || disp.kind === 'shear' || disp.kind === 'axial') && m.results;
    for (const f of m.frames) {
      const a = RCModel.jointById(m, f.i), b = RCModel.jointById(m, f.j);
      if (!a || !b) continue;
      const sel = app.sel && app.sel.indexOf && app.sel.indexOf(f) >= 0;
      let color = f.kind === 'column' ? 0x38bdf8 : 0xfbbf24;
      if (sel) color = 0xff4444;
      // extruded boxes or centerlines
      if (app.extrude) {
        const s = RCModel.frameSection(m, f);
        const p1 = P(a), p2 = P(b);
        const len = p1.distanceTo(p2);
        const box = new THREE.BoxGeometry(f.kind === 'beam' ? len : s.b, f.kind === 'beam' ? s.b : s.b, f.kind === 'beam' ? s.h : len);
        const mesh = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color }));
        // orient along the member
        const mid = p1.clone().add(p2).multiplyScalar(0.5);
        mesh.position.copy(mid);
        const dir = p2.clone().sub(p1).normalize();
        if (f.kind === 'beam') mesh.lookAt(mid.clone().add(new THREE.Vector3(0, 0, 1))), mesh.rotation.y = 0; // beams lie flat
        mesh.userData = { frame: f };
        memberGroup.add(mesh);
      } else {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([P(a), P(b)]),
          new THREE.LineBasicMaterial({ color, linewidth: sel ? 3 : 2 }));
        line.userData = { frame: f };
        memberGroup.add(line);
      }
      if (showDiagrams) V.diagram(f, a, b, disp);
    }
    // deformed overlay
    if (disp && disp.kind === 'deformed' && m.results) {
      const res = m.results.results[disp.combo || 0];
      if (res) {
        let uMax = 1e-9;
        for (let i = 0; i < m.joints.length * 6; i++) uMax = Math.max(uMax, Math.abs(res.U[i] || 0));
        const amp = (m.results.bbox || 12) * 0.15 / uMax * 1000 / 1000; // scale to meters
        const pts = [];
        const dpos = i => {
          const j = m.joints[i];
          return new THREE.Vector3(
            j.x + (res.U[i * 6] || 0) * disp.scale / 1000,
            j.y + (res.U[i * 6 + 1] || 0) * disp.scale / 1000,
            j.z + (res.U[i * 6 + 2] || 0) * disp.scale / 1000);
        };
        const idx = new Map(m.joints.map((j, i) => [j.id, i]));
        const grey = [];
        for (const f of m.frames) {
          grey.push(P(RCModel.jointById(m, f.i)), P(RCModel.jointById(m, f.j)));
          pts.push(dpos(idx.get(f.i)), dpos(idx.get(f.j)));
        }
        overlayGroup.add(new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(grey),
          new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.35 })));
        overlayGroup.add(new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x10d9a0 })));
      }
    }
  };

  // force diagram ribbon along a member (offset perpendicular, in the
  // vertical plane for horizontal members; horizontal plane for columns)
  V.diagram = function (f, a, b, disp) {
    const m = V.app.model;
    const res = m.results.results[disp.combo || 0];
    if (!res || !res.frames) return;
    const meshIdx = m.results.mesh.frames.findIndex(fr => fr.frameId === f.id);
    const fe = res.frames[meshIdx];
    if (!fe) return;
    const kind = disp.kind;
    const val = (t) => {
      // interpolate end values linearly; member loads add the parabola
      const p = fe.forces;
      let v0, v1;
      if (kind === 'moment') { v0 = p[4]; v1 = p[10]; }
      else if (kind === 'shear') { v0 = p[1]; v1 = p[7]; }
      else { v0 = -p[0]; v1 = -p[6]; }
      let v = v0 + (v1 - v0) * t;
      const wl = fe.wl;
      if (kind === 'moment' && wl) {
        const w = Math.abs(wl.wy || 0) || Math.abs(wl.wz || 0);
        v -= (wl.wy || wl.wz || 0) * t * (1 - t) * wl.L * wl.L / 2;
      }
      return v;
    };
    // global max for normalization
    let gMax = 0;
    for (const e2 of m.results.envelope) gMax = Math.max(gMax, kind === 'moment' ? e2.maxM : kind === 'shear' ? e2.maxV : e2.maxN);
    if (!(gMax > 0)) return;
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (!(L > 1e-6)) return;
    const h = m.results.bbox * 0.12; // max ribbon height in metres
    // offset direction: for horizontal members use vertical (z); for columns use global x
    const horiz = Math.abs(b.z - a.z) < 1e-6;
    const ox = horiz ? 0 : 1, oz = horiz ? 1 : 0;
    const pts = [], fill = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const v = val(t) / gMax;
      const px = a.x + (b.x - a.x) * t + ox * v * h;
      const py = a.y + (b.y - a.y) * t;
      const pz = a.z + (b.z - a.z) * t + oz * v * h;
      pts.push(new THREE.Vector3(px, py, pz));
    }
    overlayGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: kind === 'moment' ? 0xef4444 : kind === 'shear' ? 0x3b82f6 : 0x22c55e })));
    const fp = [P(a), ...pts, P(b)];
    overlayGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(fp),
      new THREE.LineBasicMaterial({ color: kind === 'moment' ? 0xf87171 : kind === 'shear' ? 0x60a5fa : 0x4ade80, transparent: true, opacity: 0.5 })));
  };

  // ------------------------------------------------------------ picking
  V.click = function (e) {
    const canvas = document.getElementById('cadCanvas');
    if (!canvas.offsetParent) return; // plan mode active
    const rect = canvas.getBoundingClientRect();
    mouse3.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse3.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse3, camera);
    const hits = raycaster.intersectObjects(memberGroup.children, true);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud && ud.frame) { V.app.select(ud.frame); return; }
    }
    V.app.select(null);
  };

  V.animate = function () {
    requestAnimationFrame(V.animate);
    if (!renderer || !document.getElementById('cadCanvas').offsetParent) return;
    controls.update();
    renderer.render(scene, camera);
  };
})();
