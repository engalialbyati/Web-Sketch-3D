// rcviz.js — 3D rebar visualization from design results.
// Draws longitudinal bars (cylinders) and stirrups (rings/toruses) inside
// beams and columns based on the design output from rcbeam.js/rccolumn.js.
// Toggleable from the Design ribbon.
(function (root) {
  'use strict';

  let vizGroup = null;

  // build rebar 3D geometry for a beam
  function buildBeamRebar(THREE, ent, design, mmScale) {
    const group = new THREE.Group();
    group.name = 'rebar_' + ent.id;

    const p = ent.params;
    if (!Array.isArray(p.baseline) || p.baseline.length < 2) return group;
    const a = p.baseline[0], b = p.baseline[p.baseline.length - 1];
    const ax = a[0] * mmScale, ay = a[1] * mmScale, az = a[2] * mmScale;
    const bx = b[0] * mmScale, by = b[1] * mmScale, bz = b[2] * mmScale;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    // perpendicular for stirrup plane (local z ≈ global z for horizontal beams)
    const px = 0, py = 0, pz = 1;
    const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
    const ql = Math.hypot(qx, qy, qz) || 1;
    const nx = qx / ql, ny = qy / ql, nz = qz / ql;

    const bmm = (design.b || 300), hmm = (design.h || 500);
    const cover = 40; // mm
    const yOff = hmm / 2 - cover; // offset from centerline to bar centroid (vertical)
    const zOff = bmm / 2 - cover; // offset from centerline to bar centroid (horizontal)

    const barMat = new THREE.MeshStandardMaterial({ color: 0xd4845c, roughness: 0.5, metalness: 0.6 });
    const stirrupMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7, metalness: 0.4 });

    const db = (design.botBars && design.botBars.dia) || 20;
    const dt = (design.topBars && design.topBars.dia) || 20;
    const nBot = (design.botBars && design.botBars.count) || 2;
    const nTop = (design.topBars && design.topBars.count) || 2;
    const stirrupDia = (design.stirrups && design.stirrups.dia) || 8;
    const stirrupSpacing = (design.stirrups && design.stirrups.spacing) || 200;

    // === longitudinal bars (cylinders along beam axis) ===
    const barRadius = db / 2 * 1.2; // slightly oversized for visibility
    const barRadiusTop = dt / 2 * 1.2;
    const barLength = len;

    function addBar(yOffLocal, xOffLocal, radius) {
      const cy = ay + dy * 0.5 + ny * yOffLocal + nz * xOffLocal * 0;
      const cy2 = ay + dy * 0.5;
      // cylinder along beam direction
      const geo = new THREE.CylinderGeometry(radius, radius, barLength, 8);
      const mesh = new THREE.Mesh(geo, barMat);
      // position at midpoint, offset by cover
      const cx = ax + dx * 0.5 + nx * xOffLocal;
      const cy3 = ay + dy * 0.5 + yOffLocal;
      const cz2 = az + dz * 0.5;
      mesh.position.set(cx, cy3, cz2);
      // orient along beam
      const dir = new THREE.Vector3(ux, uy, uz);
      const up = new THREE.Vector3(0, 1, 0);
      const axis = new THREE.Vector3().crossVectors(up, dir).normalize();
      const angle = Math.acos(Math.abs(dir.y));
      if (Math.abs(dir.y) < 0.99) {
        mesh.quaternion.setFromAxisAngle(axis, angle);
      } else {
        mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      }
      // rotate so cylinder axis (default Y) aligns with beam
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir);
      mesh.quaternion.copy(quat);
      group.add(mesh);
    }

    // bottom bars
    const botBarY = -(yOff - db / 2);
    for (let i = 0; i < nBot; i++) {
      const xOff = (i - (nBot - 1) / 2) * (bmm / Math.max(nBot, 2)) * 0.7;
      const cy = ay + dy * 0.5 + botBarY * nz * 0 + (0); // vertical offset
      addBarOffset(group, ax, ay, az, ux, uy, uz, nx, ny, nz, xOff, botBarY, barRadius, barLength, barMat);
    }

    // top bars
    const topBarY = +(yOff - dt / 2);
    for (let i = 0; i < nTop; i++) {
      const xOff = (i - (nTop - 1) / 2) * (bmm / Math.max(nTop, 2)) * 0.7;
      addBarOffset(group, ax, ay, az, ux, uy, uz, nx, ny, nz, xOff, topBarY, barRadiusTop, barLength, barMat);
    }

    // === stirrups (torus rings at spacing intervals) ===
    const stirrupR = Math.min(zOff, yOff) * 0.9;
    const nStirrups = Math.max(2, Math.floor(len / stirrupSpacing));
    const stirrupGeo = new THREE.TorusGeometry(stirrupR, stirrupDia / 2 * 1.2, 8, 24);
    for (let i = 0; i <= nStirrups; i++) {
      const t = i / nStirrups;
      const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t;
      const ring = new THREE.Mesh(stirrupGeo, stirrupMat);
      ring.position.set(cx, cy, cz);
      // orient torus perpendicular to beam axis
      ring.lookAt(cx + ux, cy + uy, cz + uz);
      group.add(ring);
    }

    return group;
  }

  // helper: add an offset cylinder along a beam axis
  function addBarOffset(group, ax, ay, az, ux, uy, uz, nx, ny, nz, xOff, yOff, radius, length, mat) {
    const THREE = root.THREE;
    const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
    const mesh = new THREE.Mesh(geo, mat);
    // center position with offset
    const cx = ax + ux * length / 2 + nx * xOff + 0;
    const cy = ay + uy * length / 2 + ny * xOff + 0;
    const cz = az + uz * length / 2 + 0; // yOff is in the vertical direction
    // for horizontal beam: yOff is vertical offset from centerline
    mesh.position.set(
      ax + ux * length / 2 + nx * xOff,
      ay + uy * length / 2 + yOff,
      az + uz * length / 2
    );
    const dir = new THREE.Vector3(ux, uy, uz);
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), dir);
    mesh.quaternion.copy(quat);
    group.add(mesh);
  }

  // build rebar 3D geometry for a column
  function buildColumnRebar(THREE, ent, design, mmScale) {
    const group = new THREE.Group();
    const p = ent.params;
    if (!Array.isArray(p.base)) return group;
    const bx = p.base[0] * mmScale, by = p.base[1] * mmScale, bz = p.base[2] * mmScale;
    const h = (+p.height || 3) * mmScale;
    const bmm = (design.b || 400), hmm = (design.h || 600);
    const cover = 50;
    const dia = 20;
    const nBars = 8; // approximate total

    const barMat = new THREE.MeshStandardMaterial({ color: 0xd4845c, roughness: 0.5, metalness: 0.6 });
    const stirrupMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7, metalness: 0.4 });

    // vertical bars at corners (simplified — 4 corner bars)
    const xOffset = (bmm / 2 - cover) * 1.0;
    const yOffset = (hmm / 2 - cover) * 1.0;
    const barGeo = new THREE.CylinderGeometry(dia / 2 * 1.2, dia / 2 * 1.2, h, 8);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(bx + sx * xOffset, by + h / 2, bz + sy * yOffset);
      group.add(bar);
    }

    // stirrups at 200mm spacing
    const stirrupR = Math.max(xOffset, yOffset) * 1.1;
    const stirrupGeo = new THREE.TorusGeometry(stirrupR, 4, 8, 4);
    const nStirrups = Math.max(2, Math.floor(h / 200));
    for (let i = 0; i <= nStirrups; i++) {
      const z = bz + (i / nStirrups) * h;
      const ring = new THREE.Mesh(stirrupGeo, stirrupMat);
      ring.position.set(bx, by, z);
      group.add(ring);
    }

    return group;
  }

  // ============================================================ public API
  function show(app) {
    hide(app);
    const THREE = root.THREE;
    if (!THREE || !app.rcResults) return;
    const view = app.view;
    if (!view || !view.scene) return;

    // run design for the first combo
    const comboName = app.rcResults.combos.length
      ? app.rcResults.combos[0].name
      : (app.rcResults.patterns[0] ? app.rcResults.patterns[0].name : null);
    if (!comboName) return;

    const d = root.RCDefine.ensure(app);
    const mmScale = 1000; // model meters → viewport mm

    // run designs
    let beams = null, cols = null;
    try { beams = root.RCBeam.designAllBeams(app, comboName); } catch (e) {}
    try { cols = root.RCColumn.designAllColumns(app, comboName, 'design', true); } catch (e) {}

    vizGroup = new THREE.Group();
    vizGroup.name = 'rcRebarViz';

    // beam rebar
    if (beams && beams.results) {
      for (const r of beams.results) {
        const ent = app.bim.getEntityById(r.id);
        if (!ent) continue;
        const grp = buildBeamRebar(THREE, ent, r, mmScale);
        if (grp && grp.children.length) vizGroup.add(grp);
      }
    }

    // column rebar
    if (cols && cols.results) {
      for (const r of cols.results) {
        const ent = app.bim.getEntityById(r.id);
        if (!ent) continue;
        const grp = buildColumnRebar(THREE, ent, r, mmScale);
        if (grp && grp.children.length) vizGroup.add(grp);
      }
    }

    view.scene.add(vizGroup);
    view.invalidate();
    app.setStatus('Showing designed reinforcement — toggle from Design ribbon');
  }

  function hide(app) {
    if (vizGroup && app.view && app.view.scene) {
      app.view.scene.remove(vizGroup);
      // dispose geometries and materials
      vizGroup.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      vizGroup = null;
    }
    if (app.view) app.view.invalidate();
  }

  function toggle(app) {
    if (vizGroup) hide(app);
    else show(app);
  }

  root.RCViz = { show, hide, toggle };
})(window);
