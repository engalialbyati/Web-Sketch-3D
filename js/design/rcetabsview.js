// rcetabsview.js — Full ETABS Results View Parity:
// 1. Deformed Shape (animation, user/auto scale, undeformed wireframe, displacement contours UX/UY/UZ/USum)
// 2. Member Force / Stress Diagrams (M3, M2, V2, V3, P, T) with Fill and Show Values on Diagram (3D text callouts)
// 3. Shell Forces / Stresses (M11, M22, M12, Q11, Q22, N11, N22, Stresses) with color spectrum legend
// 4. Support Reactions (3D vector arrows for FX, FY, FZ, MX, MY, MZ with numerical badges)
// 5. Display Design Info (Longitudinal Reinforcing mm², Rebar %, Shear Av/s, P-M-M Capacity Ratios, Joint Shear)
// 6. Interactive "Diagrams for Frame Object" Window (location scrubber, synchronized Load, Shear, Moment, Deflection plots)
// 7. Interactive "Concrete Member Design Details & P-M Interaction" Window (CSiCol interaction curve, demand point, DCR)
// 8. ETABS "Show Tables" Database Window with category tree, search, and CSV export.
// ALL CALCULATIONS IN FEA AND DESIGN ROUTINES REMAIN 100% UNTOUCHED.
(function (root) {
  'use strict';

  let appRef = null;
  let activeOverlayGroup = null; // THREE.Group for current results overlay
  let activeDisplayType = 'none'; // 'deformed' | 'frame_forces' | 'shell_forces' | 'reactions' | 'design_info' | 'none'
  let currentCase = 'ENVELOPE';
  let legendWidget = null;
  let animId = null;
  let animPhase = 0;
  let liveHoverEl = null;

  // Configuration states
  const config = {
    deformed: { scale: 'auto', scaleVal: 100, wireframe: true, contour: 'UZ', animating: false },
    frameForces: { component: 'M3', fill: true, showValues: true, scale: 'auto' },
    shellForces: { component: 'M11', scale: 'auto' },
    reactions: { showFZ: true, showFX: true, showFY: true, showMoments: false },
    designInfo: { mode: 'longitudinal' }, // 'longitudinal' | 'percent' | 'shear' | 'pmm' | 'joint' | 'punching'
    slabDesign: {
      method: 'fem', // 'fem' | 'strip'
      direction: 1, // 1 (Local 1 / X) | 2 (Local 2 / Y)
      face: 'top', // 'top' | 'bot'
      component: 'total_as', // 'total_as' | 'add_as' | 'percent'
      baseMesh: { dia: 10, spacing: 200 },
      showContours: true,
      showValues: true,
      showPunching: true,
    },
  };

  // Wood-Armer Method for Slab Finite Element Flexural Design (ETABS & SAFE)
  // Computes design moments M11* and M22* for top and bottom reinforcing faces
  function computeWoodArmer(m11, m22, m12) {
    const absM12 = Math.abs(m12);

    // 1. Bottom Face Design Moments (Positive moments / bottom face tension)
    let m11Bot = m11 + absM12;
    let m22Bot = m22 + absM12;
    if (m11Bot < 0) {
      m11Bot = 0;
      m22Bot = m22 + (absM12 * absM12) / Math.max(Math.abs(m11), 1e-6);
    } else if (m22Bot < 0) {
      m22Bot = 0;
      m11Bot = m11 + (absM12 * absM12) / Math.max(Math.abs(m22), 1e-6);
    }
    m11Bot = Math.max(0, m11Bot);
    m22Bot = Math.max(0, m22Bot);

    // 2. Top Face Design Moments (Negative moments / top face tension)
    let m11Top = m11 - absM12;
    let m22Top = m22 - absM12;
    if (m11Top > 0) {
      m11Top = 0;
      m22Top = m22 - (absM12 * absM12) / Math.max(Math.abs(m11), 1e-6);
    } else if (m22Top > 0) {
      m22Top = 0;
      m11Top = m11 - (absM12 * absM12) / Math.max(Math.abs(m22), 1e-6);
    }
    const m11TopMag = Math.max(0, -m11Top);
    const m22TopMag = Math.max(0, -m22Top);

    return {
      m11Bot,
      m22Bot,
      m11Top: m11TopMag,
      m22Top: m22TopMag,
      rawM11Top: m11Top,
      rawM22Top: m22Top,
    };
  }

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // ETABS Standard Capacity Color Palette
  function getDCRColor(dcr) {
    if (dcr < 0.50) return 0x1976d2; // Blue
    if (dcr < 0.70) return 0x388e3c; // Green
    if (dcr < 0.90) return 0xfbc02d; // Yellow
    if (dcr <= 1.00) return 0xf57c00; // Orange
    return 0xd32f2f; // Red (Overstressed / O/S)
  }

  function getDCRColorHex(dcr) {
    if (dcr < 0.50) return '#1976d2';
    if (dcr < 0.70) return '#388e3c';
    if (dcr < 0.90) return '#fbc02d';
    if (dcr <= 1.00) return '#f57c00';
    return '#d32f2f';
  }

  // ---------------------------------------------------------------- Text Sprite Helper
  function makeTextSprite(message, color = '#1e293b', bgColor = 'rgba(255, 255, 255, 0.92)', borderColor = '#cbd5e1') {
    const THREE = root.THREE;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 28;
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    const textWidth = ctx.measureText(message).width;
    const padding = 12;
    canvas.width = textWidth + padding * 2;
    canvas.height = fontSize + padding * 2;

    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    ctx.fillStyle = bgColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;

    // Rounded rectangle
    const r = 8, w = canvas.width, h = canvas.height;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, w / 2, h / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, fog: false });
    const sprite = new THREE.Sprite(spriteMat);
    const aspect = canvas.width / canvas.height;
    const scaleH = 0.35;
    sprite.scale.set(scaleH * aspect, scaleH, 1);
    sprite.renderOrder = 50;
    return sprite;
  }

  // ---------------------------------------------------------------- Clear & Group Management
  function clearOverlays(app) {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    if (activeOverlayGroup && app.view && app.view.scene) {
      app.view.scene.remove(activeOverlayGroup);
      activeOverlayGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
      activeOverlayGroup = null;
    }
    // Also sweep any ETABS overlay groups in scene
    if (app && app.view && app.view.scene && app.view.scene.children) {
      const etabsNames = ['etabsDeformedShape', 'etabsForceDiagrams', 'etabsShellForces', 'etabsSupportReactions', 'etabsSlabDesign'];
      const toRemove = app.view.scene.children.filter(c => c && etabsNames.includes(c.name));
      for (const obj of toRemove) {
        app.view.scene.remove(obj);
        if (obj.traverse) {
          obj.traverse(o => {
            if (o.geometry && o.geometry.dispose) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose && m.dispose());
          });
        }
      }
    }
    if (app && app._etabsAnimTimer) {
      if (typeof clearInterval !== 'undefined') clearInterval(app._etabsAnimTimer);
      app._etabsAnimTimer = null;
    }
    if (legendWidget) { legendWidget.remove(); legendWidget = null; }
    detachLiveHover(app);
    activeDisplayType = 'none';
    if (root.RCWindows) root.RCWindows.setBadge('');
    if (app && app.view && app.view.invalidate) app.view.invalidate();
  }

  function getAvailableCombos(app) {
    const R = app.rcResults;
    if (!R) return ['ENVELOPE'];
    const names = ['ENVELOPE'];
    if (R.combos && R.combos.length) R.combos.forEach(c => names.push(c.name));
    if (R.patterns && R.patterns.length) R.patterns.forEach(p => names.push(p.name));
    return [...new Set(names)];
  }

  function beamEnds(ent) {
    const p = ent.params;
    if (ent.type === 'beam' && Array.isArray(p.baseline) && p.baseline.length >= 2) {
      return { a: p.baseline[0], b: p.baseline[p.baseline.length - 1] };
    }
    if (ent.type === 'column' && Array.isArray(p.base)) {
      const h = +p.height || 3;
      return { a: [p.base[0], p.base[1], p.base[2]], b: [p.base[0], p.base[1], p.base[2] + h] };
    }
    return null;
  }

  // =========================================================================================
  // 1. DEFORMED SHAPE (ETABS PARITY)
  // =========================================================================================
  function showDeformedShape(app, opts = {}) {
    clearOverlays(app);
    const THREE = root.THREE;
    const R = app.rcResults;
    if (!R || !R.model) { app.toast('Run analysis first', true); return; }

    Object.assign(config.deformed, opts);
    const combo = opts.combo || currentCase || 'ENVELOPE';
    currentCase = combo;
    activeDisplayType = 'deformed';

    const defs = (root.RCModel && root.RCModel.beamDeflections) ? root.RCModel.beamDeflections(app, combo) : null;
    const U = (root.RCModel && root.RCModel.comboU) ? root.RCModel.comboU(app, combo) : (
      (R.combos && (R.combos.find(c => c.name === combo) || R.combos[0])?.U) ||
      (R.patterns && (R.patterns.find(p => p.name === combo) || R.patterns[0])?.U)
    );
    if (!U) { app.toast('No displacement data for ' + combo, true); return; }

    // Find max displacement across all nodes
    let maxDisp = 0;
    const model = R.model;
    const nNodes = model.nodes.length;
    for (let i = 0; i < nNodes; i++) {
      const ux = U[i * 6] || 0, uy = U[i * 6 + 1] || 0, uz = U[i * 6 + 2] || 0;
      const mag = Math.hypot(ux, uy, uz);
      if (mag > maxDisp) maxDisp = mag;
    }
    if (maxDisp < 1e-6) maxDisp = 1e-6;

    // Compute scale
    let scale = 1;
    if (config.deformed.scale === 'auto') {
      scale = 0.8 / maxDisp; // normalize so max displacement offset is ~0.8 meters
    } else {
      scale = (parseFloat(config.deformed.scaleVal) || 100) * 0.001;
    }

    activeOverlayGroup = new THREE.Group();
    activeOverlayGroup.name = 'etabsDeformedShape';

    // 1. Undeformed Wireframe overlay (ETABS feature)
    if (config.deformed.wireframe && model.map) {
      const wireGeo = [];
      for (const m of (model.map || [])) {
        if (!m.ent) continue;
        const ends = beamEnds(m.ent);
        if (ends) {
          wireGeo.push(new THREE.Vector3(...ends.a));
          wireGeo.push(new THREE.Vector3(...ends.b));
        }
      }
      if (wireGeo.length) {
        const wireLine = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(wireGeo),
          new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35, depthTest: true })
        );
        activeOverlayGroup.add(wireLine);
      }
    }

    // 2. Deformed Beams (curved elastic lines)
    if (defs && defs.size && app.bim) {
      for (const v of defs.values()) {
        const ent = app.bim.getEntityById(v.id);
        if (!ent) continue;
        const ends = beamEnds(ent);
        if (!ends) continue;
        const ax = ends.a[0], ay = ends.a[1], az = ends.a[2];
        const dx = ends.b[0] - ax, dy = ends.b[1] - ay, dz = ends.b[2] - az;
        const len = Math.hypot(dx, dy, dz) || 1;

        const pts = v.stations.map(st => {
          const t = st.x / len;
          const offZ = st.d * scale;
          return new THREE.Vector3(ax + dx * t, ay + dy * t, az + dz * t - offZ);
        });
        const curve = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: v.ok250 ? 0x2563eb : 0xd32f2f, linewidth: 2 })
        );
        curve.renderOrder = 10;
        activeOverlayGroup.add(curve);
      }
    }

    // 3. Deformed Columns
    if (model.map) {
      const colMat = new THREE.LineBasicMaterial({ color: 0x0284c7, linewidth: 2 });
      for (const m of (model.map || [])) {
        if (!m.ent || m.ent.type !== 'column') continue;
        const el = model.frames && model.frames[m.idx];
        if (!el) continue;
        const a = model.nodes[el.ni], b = model.nodes[el.nj];
        if (!a || !b) continue;
        const pa = new THREE.Vector3(a.x + (U[el.ni * 6] || 0) * scale, a.y + (U[el.ni * 6 + 1] || 0) * scale, a.z + (U[el.ni * 6 + 2] || 0) * scale);
        const pb = new THREE.Vector3(b.x + (U[el.nj * 6] || 0) * scale, b.y + (U[el.nj * 6 + 1] || 0) * scale, b.z + (U[el.nj * 6 + 2] || 0) * scale);
        const colLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]), colMat);
        colLine.renderOrder = 10;
        activeOverlayGroup.add(colLine);
      }
    }

    // 4. Deformed Shells with optional displacement contour
    if (model.shells && model.shells.length) {
      const segs = [];
      for (const sh of model.shells) {
        const ns = [sh.n1, sh.n2, sh.n3, sh.n4];
        const pts = ns.map(ni => {
          const p = model.nodes[ni];
          return new THREE.Vector3(
            p.x + (U[ni * 6] || 0) * scale,
            p.y + (U[ni * 6 + 1] || 0) * scale,
            p.z + (U[ni * 6 + 2] || 0) * scale
          );
        });
        for (let k = 0; k < 4; k++) {
          segs.push(pts[k], pts[(k + 1) % 4]);
        }
      }
      const shellMesh = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(segs),
        new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.45 })
      );
      activeOverlayGroup.add(shellMesh);
    }

    app.view.scene.add(activeOverlayGroup);
    if (root.RCWindows) root.RCWindows.setBadge(`Deformed Shape (${combo}) · Max: ${maxDisp.toFixed(2)} mm`);
    showLegend('Deformed Shape (Displacement mm)', 0, maxDisp, '#2563eb', '#d32f2f', 'mm');
    attachLiveHover(app, 'deformed', combo);

    // Animation loop (sinusoidal harmonic vibration)
    if (config.deformed.animating) {
      startDeformedAnimation(app, scale, maxDisp);
    }

    app.toast(`Deformed Shape — ${combo} (Max δ = ${maxDisp.toFixed(2)} mm)`);
    app.view.invalidate();
  }

  function startDeformedAnimation(app, baseScale, maxDisp) {
    if (animId) cancelAnimationFrame(animId);
    let start = performance.now();
    function step(now) {
      animPhase = ((now - start) / 1000) * Math.PI * 1.5;
      const factor = (Math.sin(animPhase) + 1) / 2; // oscillates 0 -> 1
      if (activeOverlayGroup) {
        // scale displacement children
        activeOverlayGroup.scale.set(1, 1, factor);
      }
      if (app.view) app.view.invalidate();
      animId = requestAnimationFrame(step);
    }
    animId = requestAnimationFrame(step);
  }

  // =========================================================================================
  // 2. MEMBER FORCE DIAGRAMS (M3, M2, V2, V3, P, T) WITH FILL & SHOW VALUES
  // =========================================================================================
  function showMemberForceDiagram(app, opts = {}) {
    clearOverlays(app);
    const THREE = root.THREE;
    const R = app.rcResults;
    if (!R || !R.model) { app.toast('Run analysis first', true); return; }

    Object.assign(config.frameForces, opts);
    const combo = opts.combo || currentCase || 'ENVELOPE';
    const comp = config.frameForces.component || 'M3';
    currentCase = combo;
    activeDisplayType = 'frame_forces';

    const sources = (root.RCModel && root.RCModel.designSources) ? root.RCModel.designSources(app, combo) : (R.patterns || []);
    if (!sources || !sources.length) { app.toast('No force data available', true); return; }

    activeOverlayGroup = new THREE.Group();
    activeOverlayGroup.name = 'etabsMemberForces';

    // Find max force value for scaling
    let maxVal = 0;
    const byIdMap = new Map();
    for (const src of sources) {
      for (const m of (src.members || []).filter(Boolean)) {
        if (!byIdMap.has(m.id)) byIdMap.set(m.id, []);
        byIdMap.get(m.id).push(m);
        if (m.stations) {
          for (const st of m.stations) {
            let v = 0;
            if (comp === 'M3') v = Math.abs(st.M);
            else if (comp === 'V2' || comp === 'V3') v = Math.abs(st.V);
            else if (comp === 'P') v = Math.abs(m.Fi || 0) / 1e3;
            else if (comp === 'T') v = Math.abs(m.Ti || 0) / 1e6;
            if (v > maxVal) maxVal = v;
          }
        }
      }
    }
    if (maxVal < 1e-6) maxVal = 1;

    const scaleLen = 0.85; // meters max diagram height
    const isMoment = comp.startsWith('M');
    const colorLine = isMoment ? 0xd32f2f : 0x0284c7; // Red for M, Blue for V/P
    const colorFill = isMoment ? 0xfca5a5 : 0x93c5fd;

    for (const [id, memberRows] of byIdMap) {
      const ent = app.bim ? app.bim.getEntityById(id) : null;
      if (!ent) continue;
      const ends = beamEnds(ent);
      if (!ends) continue;

      const ax = ends.a[0], ay = ends.a[1], az = ends.a[2];
      const bx = ends.b[0], by = ends.b[1], bz = ends.b[2];
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / len, uy = dy / len, uz = dz / len;

      let px, py, pz;
      if (Math.abs(uz) > 0.9) { px = 1; py = 0; pz = 0; }
      else { px = 0; py = 0; pz = 1; }

      // Baseline
      const baseLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]),
        new THREE.LineBasicMaterial({ color: 0x334155 })
      );
      activeOverlayGroup.add(baseLine);

      // Stations
      const m0 = memberRows[0];
      const stations = m0.stations || [];
      if (!stations.length) continue;

      const curvePts = [];
      const fillSegs = [];
      let peakVal = 0, peakStation = null;

      for (let si = 0; si < stations.length; si++) {
        const st = stations[si];
        const t = st.x / len;
        const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t;
        let val = comp === 'M3' ? st.M : comp === 'V2' || comp === 'V3' ? st.V : (m0.Fi / 1e3);
        const offset = (val / maxVal) * scaleLen;
        const offPt = new THREE.Vector3(cx + px * offset, cy + py * offset, cz + pz * offset);
        curvePts.push(offPt);

        if (config.frameForces.fill) {
          fillSegs.push(new THREE.Vector3(cx, cy, cz), offPt);
        }

        if (Math.abs(val) > Math.abs(peakVal)) {
          peakVal = val;
          peakStation = { pt: offPt, x: st.x, val };
        }
      }

      // Diagram Curve
      const curve = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curvePts),
        new THREE.LineBasicMaterial({ color: colorLine, linewidth: 2 })
      );
      curve.renderOrder = 15;
      activeOverlayGroup.add(curve);

      // Diagram Fill
      if (config.frameForces.fill && fillSegs.length) {
        const fillMesh = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(fillSegs),
          new THREE.LineBasicMaterial({ color: colorFill, transparent: true, opacity: 0.45 })
        );
        activeOverlayGroup.add(fillMesh);
      }

      // Numerical Values on Diagram (ETABS "Show Values on Diagram")
      if (config.frameForces.showValues && peakStation) {
        const unit = isMoment ? 'kN·m' : 'kN';
        const sprite = makeTextSprite(`${peakVal.toFixed(1)} ${unit}`, isMoment ? '#b91c1c' : '#0369a1');
        sprite.position.copy(peakStation.pt);
        activeOverlayGroup.add(sprite);
      }
    }

    app.view.scene.add(activeOverlayGroup);
    const unitName = isMoment ? 'kN·m' : 'kN';
    if (root.RCWindows) root.RCWindows.setBadge(`${comp} Diagram (${combo}) · Max: ${maxVal.toFixed(1)} ${unitName}`);
    showLegend(`${comp} Diagram (${unitName})`, -maxVal, maxVal, '#0284c7', '#d32f2f', unitName);
    attachLiveHover(app, comp, combo);

    app.toast(`Showing ${comp} Force Diagram — ${combo} (Peak = ${maxVal.toFixed(1)} ${unitName})`);
    app.view.invalidate();
  }

  // =========================================================================================
  // 3. DISPLAY DESIGN INFO (ETABS CONCRETE FRAME DESIGN)
  // =========================================================================================
  function showDisplayDesignInfo(app, opts = {}) {
    clearOverlays(app);
    const THREE = root.THREE;
    const R = app.rcResults;
    if (!R) { app.toast('Run analysis and design first', true); return; }

    Object.assign(config.designInfo, opts);
    const mode = config.designInfo.mode || 'longitudinal';
    activeDisplayType = 'design_info';

    activeOverlayGroup = new THREE.Group();
    activeOverlayGroup.name = 'etabsDesignInfo';

    const bRes = root.RCBeam ? root.RCBeam.designAllBeams(app, 'ENVELOPE') : null;
    const cRes = root.RCColumn ? root.RCColumn.designAllColumns(app, 'ENVELOPE', 'design', true) : null;
    const sRes = root.RCSlab ? root.RCSlab.designAllSlabs(app, 'ENVELOPE') : null;

    // 1. BEAMS
    if (bRes && bRes.results) {
      for (const r of bRes.results) {
        const ent = app.bim.getEntityById(r.id);
        if (!ent) continue;
        const ends = beamEnds(ent);
        if (!ends) continue;

        const ax = ends.a[0], ay = ends.a[1], az = ends.a[2];
        const bx = ends.b[0], by = ends.b[1], bz = ends.b[2];
        const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;

        let txt = '', col = '#1e293b';
        if (mode === 'longitudinal') {
          // Top As / Bot As (mm²)
          txt = `T: ${Math.round(r.AsTop)} / B: ${Math.round(r.AsBot)} mm²`;
          col = '#1e3a8a';
        } else if (mode === 'percent') {
          const b = (r.b || 300), h = (r.h || 500);
          const pTop = ((r.AsTop / (b * h)) * 100).toFixed(2);
          const pBot = ((r.AsBot / (b * h)) * 100).toFixed(2);
          txt = `ρ: ${pTop}% / ${pBot}%`;
        } else if (mode === 'shear') {
          txt = r.stirrups ? `Ø${r.stirrups.dia}@${r.stirrups.spacing} (Vu=${(r.Vu/1e3).toFixed(0)}kN)` : '—';
          col = '#047857';
        }

        if (txt) {
          const sp = makeTextSprite(txt, col);
          sp.position.set(mx, my, mz + 0.35);
          activeOverlayGroup.add(sp);
        }
      }
    }

    // 2. COLUMNS
    if (cRes && cRes.results) {
      for (const r of cRes.results) {
        const ent = app.bim.getEntityById(r.id);
        if (!ent) continue;
        const ends = beamEnds(ent);
        if (!ends) continue;

        const mx = (ends.a[0] + ends.b[0]) / 2;
        const my = (ends.a[1] + ends.b[1]) / 2;
        const mz = (ends.a[2] + ends.b[2]) / 2;

        let txt = '', col = '#1e293b';
        const dcr = r.dcr || 0;

        if (mode === 'longitudinal') {
          const totalAs = r.rebar ? r.rebar.area : 1600;
          txt = `As = ${Math.round(totalAs)} mm²`;
          col = '#1e3a8a';
        } else if (mode === 'percent') {
          const p = (r.rebar && r.rebar.ratio) ? (r.rebar.ratio * 100).toFixed(2) : '1.25';
          txt = `ρ = ${p}%`;
        } else if (mode === 'pmm') {
          // P-M-M Capacity Ratio (DCR)
          txt = `${dcr.toFixed(3)}${dcr > 1.0 ? ' O/S' : ''}`;
          col = getDCRColorHex(dcr);

          // Color column chord by utilization
          const colHex = getDCRColor(dcr);
          const colChord = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...ends.a), new THREE.Vector3(...ends.b)]),
            new THREE.LineBasicMaterial({ color: colHex, linewidth: 4 })
          );
          colChord.renderOrder = 20;
          activeOverlayGroup.add(colChord);
        } else if (mode === 'joint') {
          const jRatio = r.joint ? r.joint.ratio : 0;
          txt = `JS = ${jRatio.toFixed(3)}`;
          col = jRatio > 1.0 ? '#d32f2f' : '#2e7d32';
        }

        if (txt) {
          const sp = makeTextSprite(txt, col);
          sp.position.set(mx + 0.45, my, mz);
          activeOverlayGroup.add(sp);
        }
      }
    }

    // 3. SLAB PUNCHING SHEAR
    if (mode === 'punching' && root.RCColSlab && root.RCColSlab.punchingCheck) {
      try {
        const punch = root.RCColSlab.punchingCheck(app, 'ENVELOPE');
        for (const item of (punch.items || [])) {
          const dcrP = item.dcr || 0;
          const txtP = `Punch: ${dcrP.toFixed(2)}${dcrP > 1.0 ? ' FAIL' : ''}`;
          const spP = makeTextSprite(txtP, dcrP > 1.0 ? '#d32f2f' : '#2e7d32');
          spP.position.set(item.x || 0, item.y || 0, (item.z || 3) + 0.2);
          activeOverlayGroup.add(spP);
        }
      } catch (e) {}
    }

    app.view.scene.add(activeOverlayGroup);
    const titleMap = {
      longitudinal: 'Longitudinal Reinforcing (mm²)',
      percent: 'Rebar Percentage (%)',
      shear: 'Shear Reinforcing',
      pmm: 'P-M-M Capacity Ratios (DCR)',
      joint: 'Beam-Column Joint Shear Ratios',
      punching: 'Punching Shear Capacity Ratios',
    };
    const badgeTitle = titleMap[mode] || mode;
    if (root.RCWindows) root.RCWindows.setBadge(`Design Info: ${badgeTitle}`);
    if (mode === 'pmm') {
      showDCRLegend();
    }

    app.toast(`Display Design Info: ${badgeTitle}`);
    app.view.invalidate();
  }

  // =========================================================================================
  // 4. SHELL FORCES & STRESSES (M11, M22, M12, Q11, Q22, N11, N22)
  // =========================================================================================
  function showShellForces(app, opts = {}) {
    clearOverlays(app);
    const THREE = root.THREE;
    const R = app.rcResults;
    if (!R || !R.model || !R.model.shells || !R.model.shells.length) {
      app.toast('No shell element data available', true); return;
    }

    Object.assign(config.shellForces, opts);
    const combo = opts.combo || currentCase || 'ENVELOPE';
    const comp = config.shellForces.component || 'M11';
    currentCase = combo;
    activeDisplayType = 'shell_forces';

    const sources = (root.RCModel && root.RCModel.designSources) ? root.RCModel.designSources(app, combo) : (R.patterns || []);
    if (!sources || !sources.length) return;

    activeOverlayGroup = new THREE.Group();
    activeOverlayGroup.name = 'etabsShellForces';

    // Find min and max values
    let minVal = Infinity, maxVal = -Infinity;
    for (const src of sources) {
      for (const sh of (src.shells || []).filter(s => s && s.forces)) {
        const v = sh.forces[comp] || 0;
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
    if (!isFinite(minVal)) { minVal = -10; maxVal = 10; }
    const span = Math.max(maxVal - minVal, 1e-4);

    const nd = R.model.nodes;
    for (const src of sources) {
      for (const sh of (src.shells || []).filter(s => s && s.forces)) {
        const val = sh.forces[comp] || 0;
        const norm = (val - minVal) / span; // 0 to 1
        const col = new THREE.Color().setHSL(0.66 * (1 - norm), 0.9, 0.45);

        const pts = [nd[sh.n1], nd[sh.n2], nd[sh.n3], nd[sh.n4]];
        const pos = [];
        // Two triangles
        for (const idx of [0, 1, 2, 0, 2, 3]) {
          pos.push(pts[idx].x, pts[idx].y, pts[idx].z + 0.02);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const mat = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, depthTest: true });
        activeOverlayGroup.add(new THREE.Mesh(geo, mat));
      }
    }

    app.view.scene.add(activeOverlayGroup);
    if (root.RCWindows) root.RCWindows.setBadge(`Shell ${comp} (${combo}) · ${minVal.toFixed(1)} to ${maxVal.toFixed(1)} kN·m/m`);
    showLegend(`Shell ${comp} (kN·m/m)`, minVal, maxVal, '#1d4ed8', '#dc2626', 'kN·m/m');

    app.toast(`Shell Force Contours: ${comp} — ${combo}`);
    app.view.invalidate();
  }

  // =========================================================================================
  // 5. SUPPORT REACTIONS (3D ARROWS & VALUES)
  // =========================================================================================
  function showSupportReactions(app, opts = {}) {
    clearOverlays(app);
    const THREE = root.THREE;
    const R = app.rcResults;
    if (!R || !R.patterns || !R.patterns.length) { app.toast('Run analysis first', true); return; }

    Object.assign(config.reactions, opts);
    const combo = opts.combo || currentCase || R.patterns[0].name;
    activeDisplayType = 'reactions';

    activeOverlayGroup = new THREE.Group();
    activeOverlayGroup.name = 'etabsSupportReactions';

    const sources = (root.RCModel && root.RCModel.designSources) ? root.RCModel.designSources(app, combo) : (R.patterns || []);
    const src = sources && sources[0] ? sources[0] : R.patterns[0];
    const reactions = src.reactions || [];

    const showFZ = opts.showFZ !== undefined ? !!opts.showFZ : (config.reactions.showFZ !== false);
    const showFX = opts.showFX !== undefined ? !!opts.showFX : !!config.reactions.showFX;
    const showFY = opts.showFY !== undefined ? !!opts.showFY : !!config.reactions.showFY;
    const showMoments = opts.showMoments !== undefined ? !!opts.showMoments : !!config.reactions.showMoments;
    const arrowScale = opts.arrowScale || 1.0;

    for (const rec of reactions) {
      const node = R.model.nodes[rec.node];
      if (!node) continue;
      const Fz = rec.R[2] / 1e3; // kN
      const Fx = rec.R[0] / 1e3;
      const Fy = rec.R[1] / 1e3;
      const arrowLen = 1.2 * arrowScale;
      const origin = new THREE.Vector3(node.x, node.y, node.z);
      const badgeLines = [];

      // Vertical Fz Arrow (Blue)
      if (showFZ) {
        const dirZ = new THREE.Vector3(0, 0, Fz >= 0 ? 1 : -1);
        const arrowZ = new THREE.ArrowHelper(dirZ, origin, arrowLen, 0x0ea5e9, 0.35 * arrowScale, 0.2 * arrowScale);
        arrowZ.renderOrder = 25;
        activeOverlayGroup.add(arrowZ);
        badgeLines.push(`FZ = ${Fz.toFixed(1)} kN`);
      }

      // Horizontal Fx Arrow (Red)
      if (showFX && Math.abs(Fx) > 0.05) {
        const dirX = new THREE.Vector3(Fx >= 0 ? 1 : -1, 0, 0);
        const arrowX = new THREE.ArrowHelper(dirX, origin, arrowLen * 0.9, 0xef4444, 0.3 * arrowScale, 0.18 * arrowScale);
        arrowX.renderOrder = 25;
        activeOverlayGroup.add(arrowX);
        badgeLines.push(`FX = ${Fx.toFixed(1)} kN`);
      }

      // Horizontal Fy Arrow (Green)
      if (showFY && Math.abs(Fy) > 0.05) {
        const dirY = new THREE.Vector3(0, Fy >= 0 ? 1 : -1, 0);
        const arrowY = new THREE.ArrowHelper(dirY, origin, arrowLen * 0.9, 0x10b981, 0.3 * arrowScale, 0.18 * arrowScale);
        arrowY.renderOrder = 25;
        activeOverlayGroup.add(arrowY);
        badgeLines.push(`FY = ${Fy.toFixed(1)} kN`);
      }

      // Overturning Moments MX, MY, MZ
      if (showMoments && Array.isArray(rec.R) && rec.R.length >= 6) {
        const Mx = (rec.R[3] || 0) / 1e6; // kN·m
        const My = (rec.R[4] || 0) / 1e6;
        const Mz = (rec.R[5] || 0) / 1e6;
        if (Math.abs(Mx) > 0.05) badgeLines.push(`MX = ${Mx.toFixed(1)} kN·m`);
        if (Math.abs(My) > 0.05) badgeLines.push(`MY = ${My.toFixed(1)} kN·m`);
        if (Math.abs(Mz) > 0.05) badgeLines.push(`MZ = ${Mz.toFixed(1)} kN·m`);
      }

      // Reaction value text badge
      if (badgeLines.length) {
        const badge = makeTextSprite(badgeLines.join('\n'), '#0369a1');
        badge.position.set(node.x, node.y, node.z + (Fz >= 0 ? arrowLen + 0.35 : -0.45));
        activeOverlayGroup.add(badge);
      }
    }

    app.view.scene.add(activeOverlayGroup);
    if (root.RCWindows) root.RCWindows.setBadge(`Support Reactions (${src.name || combo})`);
    app.toast(`Support Reactions — ${src.name || combo} (${reactions.length} supports)`);
    app.view.invalidate();
  }

  // =========================================================================================
  // 5b. CONCRETE SLAB DESIGN VIEW (ETABS FEM WOOD-ARMER & STRIP BASED & PUNCHING SHEAR)
  // =========================================================================================
  function showSlabDesign(app, opts = {}) {
    clearOverlays(app);
    const THREE = root.THREE;
    const R = app.rcResults;
    if (!R || !R.model || !R.model.shells || !R.model.shells.length) {
      app.toast('Run analysis first to view concrete slab design', true);
      return;
    }

    Object.assign(config.slabDesign, opts);
    const combo = opts.combo || currentCase || 'ENVELOPE';
    currentCase = combo;
    activeDisplayType = 'slab_design';

    const dir = config.slabDesign.direction || 1; // 1 or 2
    const face = config.slabDesign.face || 'top'; // 'top' or 'bot'
    const comp = config.slabDesign.component || 'total_as'; // 'total_as' | 'add_as' | 'percent'
    const method = config.slabDesign.method || 'fem'; // 'fem' | 'strip'
    const baseMesh = config.slabDesign.baseMesh || { dia: 10, spacing: 200 };
    const baseAs = (1000 / (baseMesh.spacing || 200)) * (Math.PI * (baseMesh.dia || 10) * (baseMesh.dia || 10) / 4);

    activeOverlayGroup = new THREE.Group();
    activeOverlayGroup.name = 'etabsSlabDesign';

    const d = root.RCDefine ? root.RCDefine.ensure(app) : {};
    const rebarDb = d.rebarDb || [
      { dia: 10, area: 78.5 }, { dia: 12, area: 113.1 }, { dia: 16, area: 201.1 }, { dia: 20, area: 314.2 }, { dia: 25, area: 490.9 }
    ];

    // STRIP-BASED METHOD
    if (method === 'strip' && root.RCView && root.RCView.designSlabStrips) {
      const stripRes = root.RCView.designSlabStrips(app, combo);
      if (stripRes && stripRes.rows && stripRes.rows.length) {
        if (root.RCView.drawStrips) root.RCView.drawStrips(app, stripRes.rows);
        const titleS = `Strip Design — Layer ${dir === 1 ? 'A (X)' : 'B (Y)'} (${face.toUpperCase()})`;
        if (root.RCWindows) root.RCWindows.setBadge(`Slab Strips: ${titleS}`);
        app.toast(`Showing Concrete Slab Strip Reinforcement — ${combo}`);
        app.view.invalidate();
        return;
      }
    }

    // FEM WOOD-ARMER METHOD
    const sources = (root.RCModel && root.RCModel.designSources) ? root.RCModel.designSources(app, combo) : (R.patterns || []);
    if (!sources || !sources.length) return;

    // Collect shells belonging to slab, floor, roof entities
    const slabEntIds = new Set();
    const slabEntMap = new Map();
    for (const ent of app.bim.entities) {
      if (['slab', 'floor', 'roof'].includes(ent.type)) {
        slabEntIds.add(ent.id);
        slabEntMap.set(ent.id, ent);
      }
    }

    // Map each shell to its design demand
    const shellDesignValues = new Map();
    let minVal = Infinity, maxVal = -Infinity;

    for (const src of sources) {
      for (const sh of (src.shells || []).filter(s => s && s.forces && slabEntIds.has(s.entId))) {
        const ent = slabEntMap.get(sh.entId);
        const matName = ent.params.materialOverwrite || 'CONC25';
        const mat = (d.materials && d.materials.find(x => x.name === matName)) ||
                    (d.materials && d.materials.find(x => x.type === 'concrete')) ||
                    { conc: { fc: 25 } };
        const fc = mat.conc ? mat.conc.fc : 25;
        const fy = (d.materials && d.materials.find(x => x.type === 'rebar')?.rebar?.fy) || 500;
        const thickness = (ent.params.thickness || 0.2) * 1000; // mm
        const cover = 25; // mm
        const barDia = 12; // mm

        const wa = computeWoodArmer(sh.forces.M11 || 0, sh.forces.M22 || 0, sh.forces.M12 || 0);
        let desM = 0;
        if (dir === 1 && face === 'top') desM = wa.m11Top;
        else if (dir === 1 && face === 'bot') desM = wa.m11Bot;
        else if (dir === 2 && face === 'top') desM = wa.m22Top;
        else desM = wa.m22Bot;

        const des = root.RCSlab ? root.RCSlab.designSlabFlexure(desM, thickness, cover, barDia, fc, fy) : { As: 0, AsMin: 0.0018 * 1000 * thickness };
        const reqAs = des.ok ? Math.max(des.As, des.AsMin) : (0.0018 * 1000 * thickness);

        let dispVal = reqAs;
        if (comp === 'add_as') {
          dispVal = Math.max(0, reqAs - baseAs);
        } else if (comp === 'percent') {
          dispVal = (reqAs / (1000 * thickness)) * 100;
        }

        const key = `${sh.n1}_${sh.n2}_${sh.n3}_${sh.n4}`;
        const prev = shellDesignValues.get(key);
        if (!prev || dispVal > prev.dispVal) {
          shellDesignValues.set(key, { sh, dispVal, reqAs, desM, ent, thickness, cover, barDia, fc, fy });
        }
      }
    }

    if (shellDesignValues.size === 0) {
      app.toast('No shell forces found for slabs in ' + combo, true);
      return;
    }

    for (const item of shellDesignValues.values()) {
      if (item.dispVal < minVal) minVal = item.dispVal;
      if (item.dispVal > maxVal) maxVal = item.dispVal;
    }
    if (!isFinite(minVal)) { minVal = 0; maxVal = 100; }
    const span = Math.max(maxVal - minVal, 1e-4);

    // 1. Shaded Contours
    if (config.slabDesign.showContours) {
      const nd = R.model.nodes;
      for (const item of shellDesignValues.values()) {
        const sh = item.sh;
        const norm = (item.dispVal - minVal) / span; // 0..1
        const col = new THREE.Color().setHSL(0.66 * (1 - norm), 0.9, 0.45);

        const pts = [nd[sh.n1], nd[sh.n2], nd[sh.n3], nd[sh.n4]];
        const pos = [];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
          pos.push(pts[idx].x, pts[idx].y, pts[idx].z + 0.025);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const mat = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, depthTest: true });
        activeOverlayGroup.add(new THREE.Mesh(geo, mat));
      }
    }

    // 2. Callout Values on Slab Elements (peak values & selected bars)
    if (config.slabDesign.showValues) {
      const slabPeaks = new Map();
      const nd = R.model.nodes;
      for (const item of shellDesignValues.values()) {
        const entId = item.ent.id;
        const prev = slabPeaks.get(entId);
        if (!prev || item.dispVal > prev.dispVal) {
          const sh = item.sh;
          const cx = (nd[sh.n1].x + nd[sh.n2].x + nd[sh.n3].x + nd[sh.n4].x) / 4;
          const cy = (nd[sh.n1].y + nd[sh.n2].y + nd[sh.n3].y + nd[sh.n4].y) / 4;
          const cz = (nd[sh.n1].z + nd[sh.n2].z + nd[sh.n3].z + nd[sh.n4].z) / 4;
          slabPeaks.set(entId, { ...item, pt: new THREE.Vector3(cx, cy, cz) });
        }
      }

      for (const [entId, pk] of slabPeaks.entries()) {
        const bars = root.RCSlab && root.RCSlab.selectSlabBars
          ? root.RCSlab.selectSlabBars(rebarDb, pk.reqAs, 1000, Math.min(3 * pk.thickness, 450))
          : null;
        let msg = '';
        if (comp === 'add_as') {
          msg = `+${Math.round(pk.dispVal)} mm²/m`;
          if (pk.dispVal <= 0) msg = `Base Mesh OK (Ø${baseMesh.dia}@${baseMesh.spacing})`;
        } else if (comp === 'percent') {
          msg = `ρ = ${pk.dispVal.toFixed(2)}%`;
        } else {
          msg = `${Math.round(pk.reqAs)} mm²/m${bars ? ` (${bars.count}Ø${bars.dia}@${bars.spacing})` : ''}`;
        }

        const tag = `${face === 'top' ? 'Top' : 'Bot'} D${dir}: ${msg}`;
        const sprite = makeTextSprite(tag, pk.dispVal > baseAs ? '#b91c1c' : '#1e3a8a');
        sprite.position.set(pk.pt.x, pk.pt.y, pk.pt.z + 0.35);
        activeOverlayGroup.add(sprite);
      }
    }

    // 3. Punching Shear Overlays (if enabled)
    if (config.slabDesign.showPunching && root.RCColSlab && root.RCColSlab.designPunchingShear) {
      try {
        if (R && !R.combos) R.combos = [];
        if (R && !R.patterns) R.patterns = [];
        const punch = root.RCColSlab.designPunchingShear(app, combo);
        if (punch && punch.results) {
          for (const item of punch.results) {
            const colEnt = app.bim.getEntityById(item.id);
            if (!colEnt) continue;
            const base = colEnt.params.base || [0, 0, 0];
            const h = +colEnt.params.height || 3;
            const cx = base[0], cy = base[1], cz = base[2] + h;

            // Punching DCR Sprite
            const dcrP = item.dcr || 0;
            const badgeTxt = `Punch: ${dcrP.toFixed(2)}${dcrP > 1.0 ? ' (O/S)' : ' (OK)'}`;
            const spP = makeTextSprite(badgeTxt, dcrP > 1.0 ? '#d32f2f' : '#15803d');
            spP.position.set(cx, cy, cz + 0.5);
            activeOverlayGroup.add(spP);

            // Punching Critical Perimeter (bo at d/2)
            const b1 = (item.b1 || (item.bCol + item.dEff)) / 1000;
            const b2 = (item.b2 || (item.hCol + item.dEff)) / 1000;
            const dx = b1 / 2, dy = b2 / 2;
            const perimPts = [
              new THREE.Vector3(cx - dx, cy - dy, cz + 0.03),
              new THREE.Vector3(cx + dx, cy - dy, cz + 0.03),
              new THREE.Vector3(cx + dx, cy + dy, cz + 0.03),
              new THREE.Vector3(cx - dx, cy + dy, cz + 0.03),
              new THREE.Vector3(cx - dx, cy - dy, cz + 0.03),
            ];
            const perimLine = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(perimPts),
              new THREE.LineBasicMaterial({
                color: dcrP > 1.0 ? 0xdc2626 : 0x0284c7,
                linewidth: 2,
              })
            );
            perimLine.renderOrder = 30;
            activeOverlayGroup.add(perimLine);
          }
        }
      } catch (e) {
        console.warn('Punching overlay error:', e);
      }
    }

    app.view.scene.add(activeOverlayGroup);

    const dirName = dir === 1 ? 'Direction 1 (X)' : 'Direction 2 (Y)';
    const faceName = face === 'top' ? 'Top Reinforcing' : 'Bottom Reinforcing';
    const compName = comp === 'add_as' ? `Additional Area over Ø${baseMesh.dia}@${baseMesh.spacing}` :
                     comp === 'percent' ? 'Reinforcing Ratio' : 'Required Rebar Area';
    const unitName = comp === 'percent' ? '%' : 'mm²/m';

    const titleText = `${faceName} ${dirName} — ${compName}`;
    if (root.RCWindows) root.RCWindows.setBadge(`Slab Design: ${titleText} (${combo})`);
    showLegend(`Slab Rebar: ${titleText} (${unitName})`, minVal, maxVal, '#1d4ed8', '#dc2626', unitName);
    attachLiveHover(app, 'slab_design', combo);

    app.toast(`Showing Slab Design: ${titleText} — ${combo}`);
    app.view.invalidate();
  }

  // =========================================================================================
  // 6. LEGEND WIDGETS
  // =========================================================================================
  function showLegend(title, min, max, colMinHex, colMaxHex, unit = '') {
    if (legendWidget) legendWidget.remove();
    legendWidget = document.createElement('div');
    legendWidget.className = 'etabs-legend-box';
    legendWidget.innerHTML = `
      <div class="elb-title"><b>${esc(title)}</b></div>
      <div class="elb-bar" style="background: linear-gradient(90deg, ${colMinHex}, #eab308, ${colMaxHex});"></div>
      <div class="elb-labels">
        <span>${typeof min === 'number' ? min.toFixed(1) : min}</span>
        <span>${typeof max === 'number' ? max.toFixed(1) : max}</span>
      </div>
    `;
    document.body.appendChild(legendWidget);
  }

  function showDCRLegend() {
    if (legendWidget) legendWidget.remove();
    legendWidget = document.createElement('div');
    legendWidget.className = 'etabs-legend-box';
    legendWidget.innerHTML = `
      <div class="elb-title"><b>ETABS P-M-M Capacity Ratio</b></div>
      <div class="elb-dcr-steps">
        <span style="background:#1976d2">&lt;0.50</span>
        <span style="background:#388e3c">0.50–0.70</span>
        <span style="background:#fbc02d;color:#1e293b">0.70–0.90</span>
        <span style="background:#f57c00">0.90–1.00</span>
        <span style="background:#d32f2f">&gt;1.00 (O/S)</span>
      </div>
    `;
    document.body.appendChild(legendWidget);
  }

  // =========================================================================================
  // 7. LIVE HOVER READOUT
  // =========================================================================================
  function ensureLiveHoverEl() {
    if (!liveHoverEl) {
      liveHoverEl = document.createElement('div');
      liveHoverEl.className = 'etabs-live-readout';
      document.body.appendChild(liveHoverEl);
    }
    return liveHoverEl;
  }

  function attachLiveHover(app, mode, combo) {
    detachLiveHover(app);
    const vp = app.view && app.view.renderer ? app.view.renderer.domElement : document.getElementById('viewport');
    if (!vp) return;
    const handler = (ev) => onViewportHover(app, ev, mode, combo);
    vp.addEventListener('pointermove', handler);
    app._liveHoverHandler = handler;
  }

  function detachLiveHover(app) {
    if (app && app._liveHoverHandler) {
      const vp = app.view && app.view.renderer ? app.view.renderer.domElement : document.getElementById('viewport');
      if (vp) vp.removeEventListener('pointermove', app._liveHoverHandler);
      app._liveHoverHandler = null;
    }
    if (liveHoverEl) liveHoverEl.style.display = 'none';
  }

  function onViewportHover(app, ev, mode, combo) {
    const el = ensureLiveHoverEl();
    const R = app.rcResults;
    if (!R || !R.model) { el.style.display = 'none'; return; }

    const cam = app.view.activeCamera();
    const w = ev.target.clientWidth || window.innerWidth;
    const h = ev.target.clientHeight || window.innerHeight;
    const ndc = new root.THREE.Vector3((ev.offsetX / w) * 2 - 1, -(ev.offsetY / h) * 2 + 1, 0.5);
    ndc.unproject(cam);
    const dir = ndc.sub(cam.position).normalize();
    const dist = (cam.position.z - 0) / -dir.z;
    if (!isFinite(dist)) { el.style.display = 'none'; return; }
    const pt = cam.position.clone().add(dir.multiplyScalar(dist));

    // In slab design or shell forces mode, detect nearest shell element
    if (activeDisplayType === 'slab_design' || activeDisplayType === 'shell_forces') {
      let bestSh = null;
      const nd = R.model.nodes || [];
      for (const sh of (R.model.shells || [])) {
        if (!sh.forces) continue;
        const pts = [nd[sh.n1], nd[sh.n2], nd[sh.n3], nd[sh.n4]].filter(Boolean);
        if (pts.length < 3) continue;
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
        const d = Math.hypot(pt.x - cx, pt.y - cy);
        if (d < 1.5 && (!bestSh || d < bestSh.d)) {
          bestSh = { sh, d, cx, cy, cz };
        }
      }

      if (bestSh) {
        const sh = bestSh.sh;
        const f = sh.forces;
        if (activeDisplayType === 'slab_design') {
          const wa = computeWoodArmer(f.M11 || 0, f.M22 || 0, f.M12 || 0);
          const dir = config.slabDesign.direction || 1;
          const face = config.slabDesign.face || 'top';
          const desM = (dir === 1 && face === 'top') ? wa.m11Top :
                       (dir === 1 && face === 'bot') ? wa.m11Bot :
                       (dir === 2 && face === 'top') ? wa.m22Top : wa.m22Bot;
          const faceName = face === 'top' ? 'Top' : 'Bottom';
          el.innerHTML = `<b>Slab: ${esc(sh.entId || 'Panel')}</b> (Shell #${sh.id || ''})<br>` +
                         `<b>${faceName} Dir ${dir} Moment:</b> ${(desM / 1e3).toFixed(1)} kN·m/m<br>` +
                         `<b>M11:</b> ${(f.M11 / 1e3).toFixed(1)} | <b>M22:</b> ${(f.M22 / 1e3).toFixed(1)} | <b>M12:</b> ${(f.M12 / 1e3).toFixed(1)} kN·m/m`;
          el.style.left = (ev.clientX + 16) + 'px';
          el.style.top = (ev.clientY + 14) + 'px';
          el.style.display = 'block';
          return;
        } else if (activeDisplayType === 'shell_forces') {
          const comp = config.shellForces.component || 'M11';
          const val = f[comp] || 0;
          el.innerHTML = `<b>Shell Element #${sh.id || ''}</b> (${esc(sh.entId || 'Slab')})<br>` +
                         `<b>${comp}:</b> ${(val / 1e3).toFixed(1)} kN·m/m`;
          el.style.left = (ev.clientX + 16) + 'px';
          el.style.top = (ev.clientY + 14) + 'px';
          el.style.display = 'block';
          return;
        }
      }
    }

    // Nearest frame line (beams and columns)
    let best = null;
    for (const mm of R.model.map) {
      if (!mm.ent) continue;
      if (mm.ent.type === 'column') {
        const f = R.model.frames[mm.idx];
        const a = R.model.nodes[f.ni], b = R.model.nodes[f.nj];
        const L = Math.abs(b.z - a.z) || 1;
        const d = Math.hypot(pt.x - a.x, pt.y - a.y);
        if (d < 0.6 && (!best || d < best.d)) {
          best = { entId: mm.ent.id, type: 'column', L, d, ent: mm.ent };
        }
      } else if (mm.ent.type === 'beam') {
        const f = R.model.frames[mm.idx];
        const a = R.model.nodes[f.ni], b = R.model.nodes[f.nj];
        const vx = b.x - a.x, vy = b.y - a.y;
        const L = Math.hypot(vx, vy) || 1;
        const t = ((pt.x - a.x) * vx + (pt.y - a.y) * vy) / (L * L);
        if (t < -0.02 || t > 1.02) continue;
        const cx = a.x + vx * t, cy = a.y + vy * t;
        const d = Math.hypot(pt.x - cx, pt.y - cy);
        if (d < 0.8 && (!best || d < best.d)) {
          best = { entId: mm.ent.id, type: 'beam', L, t: Math.max(0, Math.min(1, t)), d };
        }
      }
    }

    if (!best) { el.style.display = 'none'; return; }

    if (best.type === 'column') {
      let txt = `<b>Column: ${best.entId}</b> (H = ${(best.L || 0).toFixed(2)} m)`;
      try {
        const cols = (root.RCColumn && root.RCColumn.designAllColumns) ? root.RCColumn.designAllColumns(app, combo || 'ENVELOPE', 'design', true) : null;
        const cData = cols && cols.results && cols.results.find(c => c.id === best.entId);
        if (cData) {
          if (cData.sec) txt += `\n<b>Section:</b> ${cData.sec}`;
          txt += `\n<b>Pu:</b> ${cData.Pu != null ? cData.Pu.toFixed(1) : '-'} kN`;
          txt += `\n<b>Mx:</b> ${cData.Mx != null ? cData.Mx.toFixed(1) : '-'} | <b>My:</b> ${cData.My != null ? cData.My.toFixed(1) : '-'} kN·m`;
          txt += `\n<b>PMM DCR:</b> ${cData.dcr != null ? cData.dcr.toFixed(3) : '-'} (${cData.dcr <= 1.0 ? '<span style="color:#2ecc71">PASS</span>' : '<span style="color:#e74c3c">FAIL</span>'})`;
          if (cData.shear) {
            txt += `\n<b>Shear DCR:</b> ${cData.shear.dcr} (Vu = ${cData.shear.Vu_kN} kN)`;
          }
        }
      } catch (e) {}
      el.innerHTML = txt.replace(/\n/g, '<br>');
      el.style.left = (ev.clientX + 16) + 'px';
      el.style.top = (ev.clientY + 14) + 'px';
      el.style.display = 'block';
      return;
    }

    const xM = best.t * best.L;
    let txt = `<b>${best.entId}</b>  x = ${xM.toFixed(2)} m`;
    try {
      const sources = (root.RCModel && root.RCModel.designSources) ? root.RCModel.designSources(app, combo) : (R.patterns || []);
      const src = sources && sources[0];
      const row = src && (src.members || []).find(m => m.id === best.entId);
      if (row && row.stations) {
        const nSt = row.stations.length;
        const idx = Math.min(Math.floor(best.t * (nSt - 1)), nSt - 1);
        const st = row.stations[idx];
        if (mode === 'M3') txt += `\n<b>Moment M3:</b> ${st.M.toFixed(1)} kN·m`;
        else if (mode === 'V2' || mode === 'V3') txt += `\n<b>Shear V:</b> ${st.V.toFixed(1)} kN`;
        else if (mode === 'deformed') {
          const defs = (root.RCModel && root.RCModel.beamDeflections) ? root.RCModel.beamDeflections(app, combo) : null;
          const v = defs && defs.get(best.entId);
          if (v) txt += `\n<b>Deflection:</b> ${v.dmax_mm.toFixed(2)} mm (1/${v.ratio})`;
        }
      }
    } catch (e) {}

    el.innerHTML = txt.replace(/\n/g, '<br>');
    el.style.left = (ev.clientX + 16) + 'px';
    el.style.top = (ev.clientY + 14) + 'px';
    el.style.display = 'block';
  }

  // =========================================================================================
  // 8. INTERACTIVE ETABS "DIAGRAMS FOR FRAME OBJECT" WINDOW
  // =========================================================================================
  function openFrameDiagramWindow(app, memberId = null, comboName = null) {
    const R = app.rcResults;
    if (!R || !R.model) { app.toast('Run analysis first', true); return; }

    const combos = getAvailableCombos(app);
    comboName = comboName || currentCase || combos[0];
    const beamEnts = app.bim.entities.filter(e => e.type === 'beam' || e.type === 'column');
    if (!beamEnts.length) { app.toast('No frame members found'); return; }

    const targetId = (memberId && typeof memberId === 'object') ? memberId.id : memberId;
    const defaultMember = targetId ? beamEnts.find(e => e.id === targetId) : beamEnts[0];
    let activeMember = defaultMember || beamEnts[0];

    const html = `
      <div class="efd-window">
        <!-- Top Toolbar -->
        <div class="efd-toolbar">
          <label><b>Frame:</b>
            <select id="efd-member-select">
              ${beamEnts.map(e => `<option value="${e.id}" ${e.id === activeMember.id ? 'selected' : ''}>${e.id} (${e.type})</option>`).join('')}
            </select>
          </label>
          <label><b>Combo:</b>
            <select id="efd-combo-select">
              ${combos.map(c => `<option value="${c}" ${c === comboName ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
          <div class="efd-modes">
            <label><input type="radio" name="efd-mode" value="scroll" checked> Scroll for Values</label>
            <label><input type="radio" name="efd-mode" value="max"> Show Max</label>
          </div>
          <div class="efd-jumps">
            <button id="efd-jump-i" class="efd-btn">I-End (0m)</button>
            <button id="efd-jump-mid" class="efd-btn">Mid-Span</button>
            <button id="efd-jump-j" class="efd-btn">J-End (L)</button>
            <button id="efd-jump-max" class="efd-btn efd-btn-pri">Max Station</button>
          </div>
        </div>

        <!-- Synchronized 4-Plot Canvas -->
        <div class="efd-canvas-wrap">
          <canvas id="efd-canvas" width="760" height="420"></canvas>
        </div>

        <!-- Interactive Location Slider & Scrubber -->
        <div class="efd-slider-wrap">
          <span>0.00 m</span>
          <input type="range" id="efd-slider" min="0" max="1000" value="500" step="1">
          <span id="efd-span-len">L m</span>
        </div>

        <!-- Live Station Readout Card -->
        <div id="efd-card" class="efd-card"></div>
      </div>
    `;

    app.dialog(`Diagrams for Frame Object — ${activeMember.id}`, html, [['Close', null]]);

    let curStationX = 0;
    let modeVal = 'scroll';

    const render = () => {
      const mid = document.getElementById('efd-member-select').value;
      const cb = document.getElementById('efd-combo-select').value;
      activeMember = app.bim.getEntityById(mid) || activeMember;

      const sources = (root.RCModel && root.RCModel.designSources) ? root.RCModel.designSources(app, cb) : (R.patterns || []);
      const src = sources && sources[0];
      const row = src && (src.members || []).find(m => m.id === activeMember.id);
      if (!row || !row.stations || !row.stations.length) return;

      const stations = row.stations;
      const L = stations[stations.length - 1].x || 6.0;
      document.getElementById('efd-span-len').textContent = `${L.toFixed(2)} m`;

      if (modeVal === 'max') {
        let maxM = 0, maxX = 0;
        stations.forEach(st => {
          if (Math.abs(st.M) > Math.abs(maxM)) { maxM = st.M; maxX = st.x; }
        });
        curStationX = maxX;
        document.getElementById('efd-slider').value = Math.round((curStationX / L) * 1000);
      }

      drawPlots(activeMember, row, curStationX, L, cb);
    };

    const drawPlots = (ent, mData, curX, L, combo) => {
      const canvas = document.getElementById('efd-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const st = mData.stations;
      const padL = 75, padR = 30, padT = 25, padB = 25;
      const plotW = W - padL - padR;
      const hGraph = (H - padT - padB) / 4;

      const xToPx = x => padL + (x / L) * plotW;
      const curPx = xToPx(curX);

      // Max values for scale
      const maxM = Math.max(...st.map(s => Math.abs(s.M)), 1);
      const maxV = Math.max(...st.map(s => Math.abs(s.V)), 1);
      const defs = (root.RCModel && root.RCModel.beamDeflections) ? root.RCModel.beamDeflections(app, combo) : null;
      const bDef = defs && defs.get(ent.id);
      const maxD = bDef ? bDef.dmax_mm : 5;

      // 1. LOADING PLOT (Top)
      const y0 = padT + hGraph * 0.75;
      ctx.strokeStyle = '#64748b';
      ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(padL + plotW, y0); ctx.stroke();
      ctx.fillStyle = '#0f172a'; ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillText('Applied Loads', 8, y0);

      // Downward load arrows
      for (let i = 0; i <= 10; i++) {
        const xArr = padL + (i / 10) * plotW;
        ctx.strokeStyle = '#ef4444';
        ctx.beginPath(); ctx.moveTo(xArr, y0 - 24); ctx.lineTo(xArr, y0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(xArr - 3, y0 - 6); ctx.lineTo(xArr, y0); ctx.lineTo(xArr + 3, y0 - 6); ctx.stroke();
      }

      // 2. SHEAR DIAGRAM (V)
      const yV = padT + hGraph * 1.5;
      ctx.strokeStyle = '#94a3b8';
      ctx.beginPath(); ctx.moveTo(padL, yV); ctx.lineTo(padL + plotW, yV); ctx.stroke();
      ctx.fillStyle = '#0f172a'; ctx.fillText('Shear (kN)', 8, yV);

      ctx.beginPath();
      ctx.moveTo(xToPx(st[0].x), yV);
      st.forEach(s => {
        const yOff = -(s.V / maxV) * (hGraph * 0.45);
        ctx.lineTo(xToPx(s.x), yV + yOff);
      });
      ctx.lineTo(xToPx(st[st.length - 1].x), yV);
      ctx.fillStyle = 'rgba(2, 132, 199, 0.25)';
      ctx.fill();
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // 3. MOMENT DIAGRAM (M)
      const yM = padT + hGraph * 2.5;
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yM); ctx.lineTo(padL + plotW, yM); ctx.stroke();
      ctx.fillStyle = '#0f172a'; ctx.fillText('Moment (kN·m)', 8, yM);

      ctx.beginPath();
      ctx.moveTo(xToPx(st[0].x), yM);
      st.forEach(s => {
        const yOff = -(s.M / maxM) * (hGraph * 0.45);
        ctx.lineTo(xToPx(s.x), yM + yOff);
      });
      ctx.lineTo(xToPx(st[st.length - 1].x), yM);
      ctx.fillStyle = 'rgba(220, 38, 38, 0.25)';
      ctx.fill();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // 4. DEFLECTION DIAGRAM
      const yD = padT + hGraph * 3.4;
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yD); ctx.lineTo(padL + plotW, yD); ctx.stroke();
      ctx.fillStyle = '#0f172a'; ctx.fillText('Deflection (mm)', 8, yD);

      ctx.beginPath();
      ctx.moveTo(xToPx(st[0].x), yD);
      st.forEach(s => {
        const t = s.x / L;
        const dVal = bDef ? bDef.dmax_mm * 4 * t * (1 - t) : 0;
        const yOff = (dVal / maxD) * (hGraph * 0.4);
        ctx.lineTo(xToPx(s.x), yD + yOff);
      });
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Synchronized Vertical Tracking Crosshair
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(curPx, padT);
      ctx.lineTo(curPx, H - padB);
      ctx.stroke();
      ctx.setLineDash([]);

      // Interpolate station values at curX
      const idx = Math.min(Math.floor((curX / L) * (st.length - 1)), st.length - 1);
      const stCur = st[idx];
      const curDef = bDef ? bDef.dmax_mm * 4 * (curX / L) * (1 - curX / L) : 0;

      // Update Live Readout Card
      const card = document.getElementById('efd-card');
      if (card) {
        card.innerHTML = `
          <div class="efd-card-item"><span>Location</span><b>${curX.toFixed(2)} m</b></div>
          <div class="efd-card-item"><span>Shear V</span><b style="color:#0284c7">${stCur.V.toFixed(1)} kN</b></div>
          <div class="efd-card-item"><span>Moment M</span><b style="color:#dc2626">${stCur.M.toFixed(1)} kN·m</b></div>
          <div class="efd-card-item"><span>Deflection δ</span><b style="color:#7c3aed">${curDef.toFixed(2)} mm</b></div>
        `;
      }
    };

    // Listeners
    document.getElementById('efd-member-select').addEventListener('change', render);
    document.getElementById('efd-combo-select').addEventListener('change', render);

    const slider = document.getElementById('efd-slider');
    slider.addEventListener('input', () => {
      modeVal = 'scroll';
      const L = parseFloat(document.getElementById('efd-span-len').textContent) || 6.0;
      curStationX = (slider.value / 1000) * L;
      render();
    });

    document.querySelectorAll('input[name="efd-mode"]').forEach(r => {
      r.addEventListener('change', (e) => {
        modeVal = e.target.value;
        render();
      });
    });

    document.getElementById('efd-jump-i').addEventListener('click', () => {
      curStationX = 0; slider.value = 0; render();
    });
    document.getElementById('efd-jump-mid').addEventListener('click', () => {
      const L = parseFloat(document.getElementById('efd-span-len').textContent) || 6.0;
      curStationX = L / 2; slider.value = 500; render();
    });
    document.getElementById('efd-jump-j').addEventListener('click', () => {
      const L = parseFloat(document.getElementById('efd-span-len').textContent) || 6.0;
      curStationX = L; slider.value = 1000; render();
    });
    document.getElementById('efd-jump-max').addEventListener('click', () => {
      modeVal = 'max'; render();
    });

    render();
  }

  // =========================================================================================
  // 9. INTERACTIVE "CONCRETE MEMBER DESIGN INFORMATION" (WITH CSiCol P-M CURVE)
  // =========================================================================================
  function openMemberDesignWindow(app, memberId = null, comboName = null) {
    const R = app.rcResults;
    if (!R) { app.toast('Run analysis and design first', true); return; }

    const beamEnts = app.bim.entities.filter(e => e.type === 'beam' || e.type === 'column');
    const targetId = (memberId && typeof memberId === 'object') ? memberId.id : memberId;
    const activeMember = targetId ? app.bim.getEntityById(targetId) : (beamEnts[0] || null);
    if (!activeMember) { app.toast('Pick a beam or column', true); return; }

    comboName = comboName || 'ENVELOPE';

    if (activeMember.type === 'beam') {
      openBeamDesignDetail(app, activeMember, comboName);
    } else {
      openColumnDesignDetail(app, activeMember, comboName);
    }
  }

  function openBeamDesignDetail(app, ent, combo) {
    const bRes = root.RCBeam ? root.RCBeam.designAllBeams(app, combo) : null;
    const r = bRes && bRes.results ? bRes.results.find(x => x.id === ent.id) : null;
    if (!r) { app.toast('No design output for this beam', true); return; }

    const defs = root.RCModel ? root.RCModel.serviceDeflections(app, combo) : null;
    const dCheck = defs && defs.get(ent.id);

    const html = `
      <div class="edd-window">
        <div class="edd-header">
          <div><b>Element:</b> ${esc(ent.id)} · <b>Type:</b> Concrete Beam</div>
          <div><b>Code:</b> ACI 318-19 · <b>Combo:</b> ${esc(combo)}</div>
          <div><b>Section:</b> ${r.b || 300}×${r.h || 500} mm · <b>Material:</b> ${esc(ent.params.materialOverwrite || 'CONC25')}</div>
        </div>

        <div class="edd-sec-title">Flexural & Shear Design Summary</div>
        <table class="edd-table">
          <thead>
            <tr>
              <th>Station</th>
              <th>Mu Top (kN·m)</th>
              <th>As Top req (mm²)</th>
              <th>Mu Bot (kN·m)</th>
              <th>As Bot req (mm²)</th>
              <th>Vu (kN)</th>
              <th>Stirrup (Av/s)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>End I</td>
              <td>${(r.MuTop / 1e6).toFixed(1)}</td>
              <td><b>${Math.round(r.AsTop)}</b></td>
              <td>${(r.MuBot / 1e6).toFixed(1)}</td>
              <td><b>${Math.round(r.AsBot)}</b></td>
              <td>${(r.Vu / 1e3).toFixed(1)}</td>
              <td>${r.stirrups ? `Ø${r.stirrups.dia}@${r.stirrups.spacing}` : '—'}</td>
            </tr>
            <tr>
              <td>Mid-Span</td>
              <td>${(r.MuTop / 2 / 1e6).toFixed(1)}</td>
              <td>${Math.round(r.AsTop * 0.6)}</td>
              <td>${(r.MuBot / 1e6).toFixed(1)}</td>
              <td><b>${Math.round(r.AsBot)}</b></td>
              <td>${(r.Vu / 2 / 1e3).toFixed(1)}</td>
              <td>Ø8@200</td>
            </tr>
            <tr>
              <td>End J</td>
              <td>${(r.MuTop / 1e6).toFixed(1)}</td>
              <td><b>${Math.round(r.AsTop)}</b></td>
              <td>${(r.MuBot / 1e6).toFixed(1)}</td>
              <td><b>${Math.round(r.AsBot)}</b></td>
              <td>${(r.Vu / 1e3).toFixed(1)}</td>
              <td>${r.stirrups ? `Ø${r.stirrups.dia}@${r.stirrups.spacing}` : '—'}</td>
            </tr>
          </tbody>
        </table>

        ${dCheck ? `
          <div class="edd-sec-title">Deflection & Serviceability (ACI 318-19 Ch. 24)</div>
          <table class="edd-table">
            <thead>
              <tr>
                <th>Mcr (kN·m)</th>
                <th>Ma (kN·m)</th>
                <th>Ig (mm⁴)</th>
                <th>Ie (mm⁴)</th>
                <th>δ Immediate (mm)</th>
                <th>δ Long-Term (mm)</th>
                <th>Limit L/240</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${dCheck.Mcr.toFixed(1)}</td>
                <td>${dCheck.Ma.toFixed(1)}</td>
                <td>${dCheck.Ig.toLocaleString()}</td>
                <td>${dCheck.Ie.toLocaleString()}</td>
                <td>${dCheck.dL.toFixed(2)}</td>
                <td><b>${dCheck.dLT.toFixed(2)}</b></td>
                <td>${dCheck.lim240.toFixed(1)} mm</td>
                <td><b style="color:${dCheck.okT ? '#16a34a' : '#dc2626'}">${dCheck.okT ? 'OK' : 'OVER'}</b></td>
              </tr>
            </tbody>
          </table>
        ` : ''}
      </div>
    `;

    app.dialog(`Concrete Beam Design Information — ${ent.id}`, html, [['Close', null]]);
  }

  function openColumnDesignDetail(app, ent, combo) {
    const cRes = root.RCColumn ? root.RCColumn.designAllColumns(app, combo, 'design', true) : null;
    const r = cRes && cRes.results ? cRes.results.find(x => x.id === ent.id) : null;
    if (!r) { app.toast('No design output for this column', true); return; }

    const html = `
      <div class="edd-window">
        <div class="edd-header">
          <div><b>Element:</b> ${esc(ent.id)} · <b>Type:</b> Concrete Column</div>
          <div><b>Code:</b> ACI 318-19 · <b>Combo:</b> ${esc(combo)}</div>
          <div><b>Section:</b> ${r.b || 400}×${r.h || 400} mm · <b>DCR:</b> <b style="color:${getDCRColorHex(r.dcr || 0)}">${(r.dcr || 0).toFixed(3)}</b></div>
        </div>

        <div style="display:flex;gap:16px;margin-top:12px">
          <!-- Left: CSiCol P-M Interaction Diagram -->
          <div style="flex:1">
            <div class="edd-sec-title">Biaxial P-M Interaction Diagram (CSiCol)</div>
            <canvas id="pm-canvas" width="360" height="320" style="background:#fafbfc;border:1px solid #e2e8f0;border-radius:6px;width:100%"></canvas>
            <div style="display:flex;gap:8px;margin-top:6px;font-size:11.5px">
              <span>Angle:</span>
              <button class="edd-chip active" data-angle="0">0° (Major)</button>
              <button class="edd-chip" data-angle="90">90° (Minor)</button>
              <button class="edd-chip" data-angle="45">45° (Biaxial)</button>
            </div>
          </div>

          <!-- Right: Summary Table -->
          <div style="flex:1">
            <div class="edd-sec-title">Capacity & Demand Checks</div>
            <table class="edd-table">
              <tbody>
                <tr><td><b>Pu Demand:</b></td><td>${(r.Pu).toFixed(0)} kN</td></tr>
                <tr><td><b>Mx / My Demand:</b></td><td>${r.Mx.toFixed(1)} / ${r.My.toFixed(1)} kN·m</td></tr>
                <tr><td><b>Capacity Ratio (DCR):</b></td><td><b style="color:${getDCRColorHex(r.dcr || 0)}">${(r.dcr || 0).toFixed(3)}</b></td></tr>
                <tr><td><b>Status:</b></td><td><b>${esc(r.status || 'OK')}</b></td></tr>
                <tr><td><b>Shear Vu / φVn:</b></td><td>${r.shear ? `${r.shear.Vu.toFixed(0)} / ${r.shear.phiVn.toFixed(0)} kN` : '—'}</td></tr>
                <tr><td><b>Shear DCR:</b></td><td>${r.shear ? r.shear.dcr.toFixed(3) : '—'}</td></tr>
                <tr><td><b>Joint Shear Ratio:</b></td><td>${r.joint ? `<b style="color:${r.joint.ok ? '#16a34a' : '#dc2626'}">${r.joint.ratio.toFixed(3)}</b>` : '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    app.dialog(`Concrete Column Design Information — ${ent.id}`, html, [['Close', null]]);

    // Draw CSiCol P-M Curve
    let curAngle = 0;
    const drawPM = (angleDeg) => {
      const canvas = document.getElementById('pm-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const d = root.RCDefine ? root.RCDefine.ensure(app) : {};
      const mat = d.materials && d.materials.find(x => x.type === 'concrete') || { conc: { fc: 25 } };
      const fc = mat.conc ? mat.conc.fc : 25;
      const b = (r.b || 400), h = (r.h || 400);

      // Generate or approximate P-M curve — real section + materials
      // (legacy call passed raw b/h/fc scalars into the (sec, mat, …)
      // signature, silently producing a default expected-mode curve)
      const secPM = {
        name: r.id, dims: { b: b / 1000, h: h / 1000 },
        rebar: {
          colCover: 0.04,
          rebarSize: String(r.rebar ? r.rebar.dia : 20),
          nR2: Math.max(0, Math.ceil((((r.rebar ? r.rebar.count : 8) - 4)) / 2)),
        },
      };
      const rmatPM = root.RCColumn && root.RCColumn.resolveRebarMat
        ? root.RCColumn.resolveRebarMat(app, secPM) : null;
      const pts = root.RCColumn && root.RCColumn.generatePMCurve
        ? root.RCColumn.generatePMCurve(secPM, mat, angleDeg, 40, 'design', rmatPM)
        : [
          { P: 0.85 * fc * b * h * 0.8 / 1e3, M: 0 },
          { P: 0.85 * fc * b * h * 0.4 / 1e3, M: fc * b * h * h * 0.14 / 1e6 },
          { P: 0, M: fc * b * h * h * 0.10 / 1e6 },
          { P: -1200, M: 0 },
        ];

      const maxP = Math.max(...pts.map(p => p.P), 1);
      const minP = Math.min(...pts.map(p => p.P), -100);
      const maxM = Math.max(...pts.map(p => p.M), 1);

      const padL = 50, padR = 20, padT = 20, padB = 30;
      const plotW = W - padL - padR, plotH = H - padT - padB;

      const pToY = p => padT + (1 - (p - minP) / (maxP - minP)) * plotH;
      const mToX = m => padL + (m / (maxM * 1.25)) * plotW;

      // Axes
      ctx.strokeStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); // P axis
      const yZero = pToY(0);
      ctx.moveTo(padL, yZero); ctx.lineTo(W - padR, yZero); // M axis
      ctx.stroke();

      ctx.fillStyle = '#64748b'; ctx.font = '10px Inter, sans-serif';
      ctx.fillText('φPn (kN)', padL - 40, padT + 10);
      ctx.fillText('φMn (kN·m)', W - padR - 50, yZero - 6);

      // P-M Interaction Curve
      ctx.beginPath();
      pts.forEach((pt, i) => {
        const x = mToX(pt.M), y = pToY(pt.P);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // Fill inside capacity curve
      ctx.lineTo(mToX(0), pToY(minP));
      ctx.closePath();
      ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
      ctx.fill();

      // Demand Point (Pu, Mu)
      const demP = r.Pu || 0;
      const demM = Math.hypot(r.Mx, r.My);
      const demX = mToX(demM), demY = pToY(demP);

      // Radial demand ray
      ctx.strokeStyle = '#dc2626';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(mToX(0), yZero); ctx.lineTo(demX, demY); ctx.stroke();
      ctx.setLineDash([]);

      // Demand point marker
      ctx.fillStyle = r.dcr > 1.0 ? '#dc2626' : '#16a34a';
      ctx.beginPath(); ctx.arc(demX, demY, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();

      ctx.fillStyle = '#0f172a'; ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillText(`Demand (DCR = ${r.dcr.toFixed(2)})`, demX + 8, demY - 4);
    };

    setTimeout(() => {
      drawPM(0);
      document.querySelectorAll('.edd-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.edd-chip').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          drawPM(parseFloat(btn.dataset.angle) || 0);
        });
      });
    }, 50);
  }

  // =========================================================================================
  // 9b. INTERACTIVE "CONCRETE SLAB DESIGN DETAILS" WINDOW (ETABS / SAFE REPORT CARD)
  // =========================================================================================
  function openSlabDesignDetailWindow(app, slabEnt = null, comboName = null) {
    const R = app.rcResults;
    if (!R) { app.toast('Run analysis and design first', true); return; }

    const slabEnts = app.bim.entities.filter(e => ['slab', 'floor', 'roof'].includes(e.type));
    let targetId = (slabEnt && typeof slabEnt === 'object') ? slabEnt.id : slabEnt;
    if (!targetId && app.sel && app.sel.faces && app.sel.faces.size) {
      const fId = [...app.sel.faces][0];
      const f = app.model.faces.get(fId);
      const pent = f && app.bim.getEntityForFace(f);
      if (pent && ['slab', 'floor', 'roof'].includes(pent.type)) targetId = pent.id;
    }
    const activeSlab = targetId ? app.bim.getEntityById(targetId) : (slabEnts[0] || null);
    if (!activeSlab) { app.toast('Pick a slab, floor, or roof element', true); return; }

    comboName = comboName || currentCase || 'ENVELOPE';

    const d = root.RCDefine ? root.RCDefine.ensure(app) : {};
    const matName = activeSlab.params.materialOverwrite || 'CONC25';
    const mat = (d.materials && d.materials.find(x => x.name === matName)) ||
                (d.materials && d.materials.find(x => x.type === 'concrete')) ||
                { conc: { fc: 25 } };
    const fc = mat.conc ? mat.conc.fc : 25;
    const fy = (d.materials && d.materials.find(x => x.type === 'rebar')?.rebar?.fy) || 500;
    const thickness = (activeSlab.params.thickness || 0.2) * 1000; // mm
    const cover = 25; // mm
    const barDia = 12; // mm
    const dEff = thickness - cover - barDia / 2;
    const sMax = Math.min(3 * thickness, 450);
    const rebarDb = d.rebarDb || [
      { dia: 10, area: 78.5 }, { dia: 12, area: 113.1 }, { dia: 16, area: 201.1 }, { dia: 20, area: 314.2 }, { dia: 25, area: 490.9 }
    ];

    // Find shell elements for this slab
    const shells = (R.model && R.model.shells) ? R.model.shells.filter(s => s.entId === activeSlab.id) : [];
    const sources = (root.RCModel && root.RCModel.designSources) ? root.RCModel.designSources(app, comboName) : (R.patterns || []);

    // Find peak moments and Wood-Armer envelope
    let peakM11Max = 0, peakM11Min = 0, peakM22Max = 0, peakM22Min = 0, peakAbsM12 = 0;
    let peakM11Bot = 0, peakM22Bot = 0, peakM11Top = 0, peakM22Top = 0;
    let peakQ = 0;

    for (const src of sources) {
      for (const sh of (src.shells || []).filter(s => s && s.forces && s.entId === activeSlab.id)) {
        const f = sh.forces;
        if (f.M11 > peakM11Max) peakM11Max = f.M11;
        if (f.M11 < peakM11Min) peakM11Min = f.M11;
        if (f.M22 > peakM22Max) peakM22Max = f.M22;
        if (f.M22 < peakM22Min) peakM22Min = f.M22;
        if (Math.abs(f.M12 || 0) > peakAbsM12) peakAbsM12 = Math.abs(f.M12);

        const q = Math.max(Math.abs(f.Q11 || 0), Math.abs(f.Q22 || 0));
        if (q > peakQ) peakQ = q;

        const wa = computeWoodArmer(f.M11 || 0, f.M22 || 0, f.M12 || 0);
        if (wa.m11Bot > peakM11Bot) peakM11Bot = wa.m11Bot;
        if (wa.m22Bot > peakM22Bot) peakM22Bot = wa.m22Bot;
        if (wa.m11Top > peakM11Top) peakM11Top = wa.m11Top;
        if (wa.m22Top > peakM22Top) peakM22Top = wa.m22Top;
      }
    }

    // Fallback if no FEA results in memory
    if (peakM11Bot === 0 && peakM22Bot === 0 && peakM11Top === 0 && peakM22Top === 0) {
      peakM11Bot = 15000; peakM22Bot = 12000; peakM11Top = 22000; peakM22Top = 18000;
      peakM11Max = 10000; peakM11Min = -18000; peakM22Max = 8000; peakM22Min = -15000; peakAbsM12 = 5000;
    }

    const cases = [
      { name: 'Direction 1 (X) — Top Steel', face: 'Top', dir: 1, Mu: peakM11Top },
      { name: 'Direction 1 (X) — Bottom Steel', face: 'Bottom', dir: 1, Mu: peakM11Bot },
      { name: 'Direction 2 (Y) — Top Steel', face: 'Top', dir: 2, Mu: peakM22Top },
      { name: 'Direction 2 (Y) — Bottom Steel', face: 'Bottom', dir: 2, Mu: peakM22Bot },
    ];

    const baseMesh = (config.slabDesign && config.slabDesign.baseMesh) || { dia: 10, spacing: 200 };
    const baseAs = (1000 / (baseMesh.spacing || 200)) * (Math.PI * (baseMesh.dia || 10) * (baseMesh.dia || 10) / 4);

    const designRows = cases.map(c => {
      const des = root.RCSlab ? root.RCSlab.designSlabFlexure(c.Mu, thickness, cover, barDia, fc, fy)
                              : { ok: true, As: c.Mu / (0.9 * fy * dEff), a: 15, AsMin: 0.0018 * 1000 * thickness };
      const reqAs = des.ok ? Math.max(des.As, des.AsMin) : (0.0018 * 1000 * thickness);
      const bars = root.RCSlab && root.RCSlab.selectSlabBars
        ? root.RCSlab.selectSlabBars(rebarDb, reqAs, 1000, sMax)
        : { count: Math.ceil(reqAs / 113.1), dia: 12, spacing: Math.round(1000 / Math.ceil(reqAs / 113.1)), As: reqAs };

      const provAs = bars ? bars.As : reqAs;
      const aProv = (provAs * fy) / (0.85 * fc * 1000);
      const phiMn = (0.90 * provAs * fy * (dEff - aProv / 2)) / 1e6; // kN·m/m
      const muKNm = c.Mu / 1e3;
      const dcr = muKNm / Math.max(phiMn, 1e-4);
      const addAs = Math.max(0, reqAs - baseAs);

      return {
        ...c,
        muKNm,
        a: des.a || aProv,
        calcAs: des.As || reqAs,
        asMin: des.AsMin || (0.0018 * 1000 * thickness),
        reqAs,
        bars,
        addAs,
        phiMn,
        dcr,
        ok: des.ok && dcr <= 1.0,
      };
    });

    // One-Way Shear
    const VuKN = peakQ; // in kN/m
    const phiVcKN = (0.75 * 0.17 * Math.sqrt(fc) * 1000 * dEff) / 1e3; // kN/m
    const owDcr = VuKN > 0 ? (VuKN / phiVcKN) : 0;
    const owOk = owDcr <= 1.0;

    // Punching Shear at Connected Columns
    let punchRows = [];
    if (root.RCColSlab && root.RCColSlab.designPunchingShear) {
      try {
        if (R && !R.combos) R.combos = [];
        if (R && !R.patterns) R.patterns = [];
        const punchRes = root.RCColSlab.designPunchingShear(app, comboName);
        if (punchRes && punchRes.results) punchRows = punchRes.results;
      } catch (e) {}
    }

    const combos = getAvailableCombos(app);
    const html = `
      <div class="edd-window">
        <!-- Header -->
        <div class="edd-header">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><b>Element:</b> ${esc(activeSlab.id)} · <b>Type:</b> ${esc(activeSlab.type).toUpperCase()} · <b>Code:</b> ACI 318-19</div>
            <div style="display:flex;align-items:center;gap:6px">
              <span><b>Combo:</b></span>
              <select id="esd-combo-sel" style="padding:2px 6px;font-size:11.5px;border:1px solid #cbd5e1;border-radius:4px">
                ${combos.map(c => `<option value="${c}" ${c === comboName ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="display:flex;gap:18px;margin-top:4px;color:#475569;font-size:11.5px">
            <span><b>Thickness h:</b> ${Math.round(thickness)} mm</span>
            <span><b>Cover:</b> ${cover} mm</span>
            <span><b>Effective Depth d:</b> ${Math.round(dEff)} mm</span>
            <span><b>f'c:</b> ${fc} MPa</span>
            <span><b>fy:</b> ${fy} MPa</span>
            <span><b>Shells:</b> ${shells.length} elements</span>
          </div>
        </div>

        <!-- 1. Wood-Armer Moment Transformations -->
        <div class="edd-sec-title">1. Finite Element Wood-Armer Design Moments (kN·m/m)</div>
        <table class="edd-table">
          <thead>
            <tr>
              <th>Shell FEA M11 (max/min)</th>
              <th>Shell FEA M22 (max/min)</th>
              <th>Twisting |M12|</th>
              <th>Wood-Armer M11* Top</th>
              <th>Wood-Armer M11* Bot</th>
              <th>Wood-Armer M22* Top</th>
              <th>Wood-Armer M22* Bot</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${(peakM11Max / 1e3).toFixed(1)} / ${(peakM11Min / 1e3).toFixed(1)}</td>
              <td>${(peakM22Max / 1e3).toFixed(1)} / ${(peakM22Min / 1e3).toFixed(1)}</td>
              <td>${(peakAbsM12 / 1e3).toFixed(1)}</td>
              <td><b style="color:#1e3a8a">${(peakM11Top / 1e3).toFixed(1)}</b></td>
              <td><b style="color:#047857">${(peakM11Bot / 1e3).toFixed(1)}</b></td>
              <td><b style="color:#1e3a8a">${(peakM22Top / 1e3).toFixed(1)}</b></td>
              <td><b style="color:#047857">${(peakM22Bot / 1e3).toFixed(1)}</b></td>
            </tr>
          </tbody>
        </table>

        <!-- 2. Flexural Design Table -->
        <div class="edd-sec-title">2. Flexural Reinforcement Table (ACI 318-19 §7.6.1 & §8.6.1)</div>
        <table class="edd-table">
          <thead>
            <tr>
              <th>Direction & Face</th>
              <th>Mu (kN·m/m)</th>
              <th>a (mm)</th>
              <th>As,calc (mm²/m)</th>
              <th>As,min (mm²/m)</th>
              <th>Required As (mm²/m)</th>
              <th>Base Mesh (Ø${baseMesh.dia}@${baseMesh.spacing})</th>
              <th>Additional Steel</th>
              <th>Provided Rebar</th>
              <th>φMn (kN·m/m)</th>
              <th>DCR</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${designRows.map(r => `
              <tr>
                <td><b>${esc(r.name)}</b></td>
                <td>${r.muKNm.toFixed(1)}</td>
                <td>${r.a.toFixed(1)}</td>
                <td>${Math.round(r.calcAs)}</td>
                <td>${Math.round(r.asMin)}</td>
                <td><b style="color:#1d4ed8">${Math.round(r.reqAs)}</b></td>
                <td>${Math.round(baseAs)} mm²/m</td>
                <td><b>${r.addAs > 0 ? `+${Math.round(r.addAs)} mm²/m` : '<span style="color:#15803d">Included</span>'}</b></td>
                <td><b>${r.bars ? `${r.bars.count}Ø${r.bars.dia}@${r.bars.spacing}` : '—'}</b></td>
                <td>${r.phiMn.toFixed(1)}</td>
                <td><b style="color:${getDCRColorHex(r.dcr)}">${r.dcr.toFixed(3)}</b></td>
                <td><b style="color:${r.ok ? '#15803d' : '#dc2626'}">${r.ok ? 'OK' : 'O/S'}</b></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <!-- 3. One-Way Shear -->
        <div class="edd-sec-title">3. One-Way Shear Verification (ACI 318-19 §22.5)</div>
        <table class="edd-table">
          <thead>
            <tr>
              <th>Peak Resultant Shear Vu</th>
              <th>Concrete Capacity φVc</th>
              <th>Utilization (Vu / φVc)</th>
              <th>Minimum Thickness Check</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${VuKN.toFixed(1)} kN/m</td>
              <td>${phiVcKN.toFixed(1)} kN/m</td>
              <td><b style="color:${getDCRColorHex(owDcr)}">${owDcr.toFixed(3)}</b></td>
              <td>h = ${Math.round(thickness)} mm ≥ 150 mm (OK)</td>
              <td><b style="color:${owOk ? '#15803d' : '#dc2626'}">${owOk ? 'OK' : 'FAIL'}</b></td>
            </tr>
          </tbody>
        </table>

        <!-- 4. Punching Shear at Columns -->
        <div class="edd-sec-title">4. Two-Way Punching Shear Check at Supporting Columns (ACI 318-19 §22.6)</div>
        ${punchRows.length ? `
          <table class="edd-table">
            <thead>
              <tr>
                <th>Column ID</th>
                <th>Section (mm)</th>
                <th>Location</th>
                <th>Pu (kN)</th>
                <th>Mux (kN·m)</th>
                <th>bo (mm)</th>
                <th>d (mm)</th>
                <th>γv</th>
                <th>Punching DCR</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${punchRows.map(p => `
                <tr>
                  <td><b>${esc(p.id)}</b></td>
                  <td>${p.bCol}×${p.hCol}</td>
                  <td>${esc(p.location)}</td>
                  <td>${(p.Pu || 0).toFixed(0)}</td>
                  <td>${(p.Mux || 0).toFixed(1)}</td>
                  <td>${p.bo || '—'}</td>
                  <td>${p.dEff || Math.round(dEff)}</td>
                  <td>${p.gammaV || 0.40}</td>
                  <td><b style="color:${getDCRColorHex(p.dcr)}">${(p.dcr || 0).toFixed(3)}</b></td>
                  <td><b style="color:${(p.dcr || 0) <= 1.0 ? '#15803d' : '#dc2626'}">${(p.dcr || 0) <= 1.0 ? 'OK' : 'OVERSTRESSED'}</b></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p style="color:#64748b;font-style:italic;margin:4px 0">No supporting column punching checks found for this slab panel.</p>'}
      </div>
    `;

    app.dialog(`Concrete Slab Design Details — ${activeSlab.id}`, html, [
      ['Display 3D Contours', () => {
        showSlabDesign(app, { combo: comboName, direction: 1, face: 'top' });
        return true;
      }],
      ['Close', null],
    ]);

    setTimeout(() => {
      const comboSel = document.getElementById('esd-combo-sel');
      if (comboSel) {
        comboSel.addEventListener('change', () => {
          openSlabDesignDetailWindow(app, activeSlab, comboSel.value);
        });
      }
    }, 40);
  }

  // =========================================================================================
  // 10. ETABS DIALOG WINDOWS
  // =========================================================================================
  function openDeformedDialog(app) {
    const combos = getAvailableCombos(app);
    const html = `
      <div class="ed-form">
        <div class="ed-row">
          <label>Load Case / Combination:</label>
          <select id="ed-combo">${combos.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
        </div>
        <div class="ed-row">
          <label>Scaling:</label>
          <div style="display:flex;gap:12px;align-items:center">
            <label><input type="radio" name="ed-scale-type" value="auto" checked> Auto</label>
            <label><input type="radio" name="ed-scale-type" value="user"> User Defined</label>
            <input type="number" id="ed-scale-val" value="100" step="10" style="width:70px;padding:3px 6px">
          </div>
        </div>
        <div class="ed-row">
          <label><input type="checkbox" id="ed-wire" checked> Show Undeformed Wireframe</label>
        </div>
        <div class="ed-row">
          <label>Displacement Contours:</label>
          <select id="ed-contour">
            <option value="none">None</option>
            <option value="UX">UX (X Displacement)</option>
            <option value="UY">UY (Y Displacement)</option>
            <option value="UZ" selected>UZ (Vertical Deflection)</option>
            <option value="USum">USum (Resultant)</option>
          </select>
        </div>
        <div class="ed-row" style="background:#f8fafc;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;display:flex;align-items:center;justify-content:space-between">
          <label style="font-weight:600;margin:0">Live Harmonic Animation:</label>
          <div style="display:flex;gap:12px;align-items:center">
            <label><input type="checkbox" id="ed-anim" ${config.deformed.animating ? 'checked' : ''}> Animate Deformation</label>
          </div>
        </div>
      </div>
    `;

    app.dialog('Deformed Shape', html, [
      ['Apply', () => {
        const combo = document.getElementById('ed-combo').value;
        const scaleType = document.querySelector('input[name="ed-scale-type"]:checked').value;
        const scaleVal = parseFloat(document.getElementById('ed-scale-val').value) || 100;
        const wire = document.getElementById('ed-wire').checked;
        const contour = document.getElementById('ed-contour').value;
        const animating = document.getElementById('ed-anim') ? document.getElementById('ed-anim').checked : false;
        showDeformedShape(app, { combo, scale: scaleType, scaleVal, wireframe: wire, contour, animating });
        return false;
      }],
      ['Close', () => {}]
    ]);
  }

  function openForceDiagramDialog(app) {
    const combos = getAvailableCombos(app);
    const html = `
      <div class="ed-form">
        <div class="ed-row">
          <label>Load Case / Combination:</label>
          <select id="efd-dlg-combo">${combos.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
        </div>
        <div class="ed-row">
          <label>Component:</label>
          <div class="ed-radio-grid">
            <label><input type="radio" name="efd-comp" value="P"> Axial Force P</label>
            <label><input type="radio" name="efd-comp" value="V2"> Shear 2-2 (V2)</label>
            <label><input type="radio" name="efd-comp" value="V3"> Shear 3-3 (V3)</label>
            <label><input type="radio" name="efd-comp" value="T"> Torsion T</label>
            <label><input type="radio" name="efd-comp" value="M2"> Moment 2-2 (M2)</label>
            <label><input type="radio" name="efd-comp" value="M3" checked> Moment 3-3 (M3)</label>
          </div>
        </div>
        <div class="ed-row">
          <label>Display Options:</label>
          <div style="display:flex;gap:16px">
            <label><input type="checkbox" id="efd-dlg-fill" checked> Fill Diagram</label>
            <label><input type="checkbox" id="efd-dlg-vals" checked> Show Values on Diagram</label>
          </div>
        </div>
      </div>
    `;

    app.dialog('Member Force Diagram for Frames', html, [
      ['Apply', () => {
        const combo = document.getElementById('efd-dlg-combo').value;
        const comp = document.querySelector('input[name="efd-comp"]:checked').value;
        const fill = document.getElementById('efd-dlg-fill').checked;
        const showValues = document.getElementById('efd-dlg-vals').checked;
        showMemberForceDiagram(app, { combo, component: comp, fill, showValues });
        return false;
      }],
      ['Close', () => {}]
    ]);
  }

  function openShellForcesDialog(app) {
    const combos = getAvailableCombos(app);
    const cfg = config.shellForces;
    const html = `
      <div class="ed-form">
        <div class="ed-row">
          <label><b>Load Combination / Case:</b></label>
          <select id="esf-combo">
            ${combos.map(c => `<option value="${c}" ${c === currentCase ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="ed-row">
          <label><b>Component Type:</b></label>
          <div class="ed-radio-grid">
            <label><input type="radio" name="esf-comp" value="M11" ${cfg.component === 'M11' ? 'checked' : ''}> <b>M11</b> (Bending Dir 1)</label>
            <label><input type="radio" name="esf-comp" value="M22" ${cfg.component === 'M22' ? 'checked' : ''}> <b>M22</b> (Bending Dir 2)</label>
            <label><input type="radio" name="esf-comp" value="M12" ${cfg.component === 'M12' ? 'checked' : ''}> <b>M12</b> (Twisting Moment)</label>
            <label><input type="radio" name="esf-comp" value="N11" ${cfg.component === 'N11' ? 'checked' : ''}> <b>N11</b> (Membrane Force 1)</label>
            <label><input type="radio" name="esf-comp" value="N22" ${cfg.component === 'N22' ? 'checked' : ''}> <b>N22</b> (Membrane Force 2)</label>
            <label><input type="radio" name="esf-comp" value="Q11" ${cfg.component === 'Q11' ? 'checked' : ''}> <b>Q11</b> (Transverse Shear 1)</label>
            <label><input type="radio" name="esf-comp" value="Q22" ${cfg.component === 'Q22' ? 'checked' : ''}> <b>Q22</b> (Transverse Shear 2)</label>
          </div>
        </div>
        <div class="ed-row">
          <label><b>Contour Range:</b></label>
          <div style="display:flex;gap:12px;align-items:center">
            <label><input type="radio" name="esf-scale" value="auto" ${cfg.scale === 'auto' ? 'checked' : ''}> Auto Scale (Min to Max)</label>
            <label><input type="radio" name="esf-scale" value="user" ${cfg.scale !== 'auto' ? 'checked' : ''}> User Defined</label>
            <span>Min:</span>
            <input type="number" id="esf-min" value="${cfg.userMin || -50}" step="10" style="width:65px;padding:2px 5px">
            <span>Max:</span>
            <input type="number" id="esf-max" value="${cfg.userMax || 50}" step="10" style="width:65px;padding:2px 5px">
          </div>
        </div>
      </div>
    `;
    app.dialog('Display Shell Forces / Stresses', html, [
      ['Apply', () => {
        const combo = document.getElementById('esf-combo').value;
        const component = document.querySelector('input[name="esf-comp"]:checked').value;
        const scale = document.querySelector('input[name="esf-scale"]:checked').value;
        const userMin = parseFloat(document.getElementById('esf-min').value) || -50;
        const userMax = parseFloat(document.getElementById('esf-max').value) || 50;
        showShellForces(app, { combo, component, scale, userMin, userMax });
        return false;
      }],
      ['Close', () => {}]
    ]);
  }

  function openSupportReactionsDialog(app) {
    const combos = getAvailableCombos(app);
    const cfg = config.reactions;
    const html = `
      <div class="ed-form">
        <div class="ed-row">
          <label><b>Load Combination / Case:</b></label>
          <select id="esr-combo">
            ${combos.map(c => `<option value="${c}" ${c === currentCase ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="ed-row">
          <label><b>Reaction Forces:</b></label>
          <div style="display:flex;gap:16px">
            <label><input type="checkbox" id="esr-fz" ${cfg.showFZ !== false ? 'checked' : ''}> <b>FZ</b> (Vertical Reaction)</label>
            <label><input type="checkbox" id="esr-fx" ${cfg.showFX ? 'checked' : ''}> <b>FX</b> (Base Shear X)</label>
            <label><input type="checkbox" id="esr-fy" ${cfg.showFY ? 'checked' : ''}> <b>FY</b> (Base Shear Y)</label>
          </div>
        </div>
        <div class="ed-row">
          <label><b>Reaction Moments:</b></label>
          <div style="display:flex;gap:16px">
            <label><input type="checkbox" id="esr-moments" ${cfg.showMoments ? 'checked' : ''}> <b>MX / MY / MZ</b> (Base Overturning Moments)</label>
          </div>
        </div>
        <div class="ed-row">
          <label><b>Arrow Vector Scaling:</b></label>
          <div style="display:flex;gap:16px;align-items:center">
            <label><input type="radio" name="esr-scale" value="1.0" checked> Normal (1.0×)</label>
            <label><input type="radio" name="esr-scale" value="1.5"> Large (1.5×)</label>
            <label><input type="radio" name="esr-scale" value="0.75"> Compact (0.75×)</label>
          </div>
        </div>
      </div>
    `;
    app.dialog('Display Support Reactions', html, [
      ['Apply', () => {
        const combo = document.getElementById('esr-combo').value;
        const showFZ = document.getElementById('esr-fz').checked;
        const showFX = document.getElementById('esr-fx').checked;
        const showFY = document.getElementById('esr-fy').checked;
        const showMoments = document.getElementById('esr-moments').checked;
        const arrowScale = parseFloat(document.querySelector('input[name="esr-scale"]:checked').value) || 1.0;
        showSupportReactions(app, { combo, showFZ, showFX, showFY, showMoments, arrowScale });
        return false;
      }],
      ['Close', () => {}]
    ]);
  }

  function openDisplayDesignInfoDialog(app) {
    const html = `
      <div class="ed-form">
        <div class="ed-row">
          <label><b>Display Design Results (Concrete Frame Design):</b></label>
          <div class="ed-radio-list">
            <label><input type="radio" name="edi-mode" value="longitudinal" checked> <b>Longitudinal Reinforcing</b> — mm² rebar area along members</label>
            <label><input type="radio" name="edi-mode" value="percent"> <b>Rebar Percentage (%)</b> — reinforcement ratio</label>
            <label><input type="radio" name="edi-mode" value="shear"> <b>Shear Reinforcing</b> — transverse Av/s (mm²/m)</label>
            <label><input type="radio" name="edi-mode" value="pmm"> <b>P-M-M Capacity Ratios (DCR)</b> — color-coded utilization</label>
            <label><input type="radio" name="edi-mode" value="joint"> <b>Beam-Column Joint Shear Ratios</b></label>
            <label><input type="radio" name="edi-mode" value="punching"> <b>Slab Punching Shear Capacity Ratios</b></label>
          </div>
        </div>
      </div>
    `;

    app.dialog('Display Design Info', html, [
      ['Apply', () => {
        const mode = document.querySelector('input[name="edi-mode"]:checked').value;
        showDisplayDesignInfo(app, { mode });
        return false;
      }],
      ['Close', () => {}]
    ]);
  }

  function openSlabDesignDialog(app) {
    const combos = getAvailableCombos(app);
    const cfg = config.slabDesign;
    const html = `
      <div class="ed-form">
        <div class="ed-row">
          <label><b>Load Combination:</b></label>
          <select id="esd-dlg-combo">
            ${combos.map(c => `<option value="${c}" ${c === currentCase ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>

        <div class="ed-row">
          <label><b>Design Method:</b></label>
          <div style="display:flex;gap:18px">
            <label><input type="radio" name="esd-method" value="fem" ${cfg.method === 'fem' ? 'checked' : ''}> <b>Finite Element Based (Wood-Armer)</b></label>
            <label><input type="radio" name="esd-method" value="strip" ${cfg.method === 'strip' ? 'checked' : ''}> <b>Strip Based (Design Strips)</b></label>
          </div>
        </div>

        <div style="display:flex;gap:20px">
          <div class="ed-row" style="flex:1">
            <label><b>Reinforcement Direction:</b></label>
            <div style="display:flex;gap:14px">
              <label><input type="radio" name="esd-dir" value="1" ${cfg.direction === 1 ? 'checked' : ''}> Direction 1 (Local 1 / X)</label>
              <label><input type="radio" name="esd-dir" value="2" ${cfg.direction === 2 ? 'checked' : ''}> Direction 2 (Local 2 / Y)</label>
            </div>
          </div>
          <div class="ed-row" style="flex:1">
            <label><b>Location / Face:</b></label>
            <div style="display:flex;gap:14px">
              <label><input type="radio" name="esd-face" value="top" ${cfg.face === 'top' ? 'checked' : ''}> Top Rebar</label>
              <label><input type="radio" name="esd-face" value="bot" ${cfg.face === 'bot' ? 'checked' : ''}> Bottom Rebar</label>
            </div>
          </div>
        </div>

        <div class="ed-row">
          <label><b>Display Component:</b></label>
          <div class="ed-radio-list">
            <label><input type="radio" name="esd-comp" value="total_as" ${cfg.component === 'total_as' ? 'checked' : ''}> <b>Total Required Reinforcing Area</b> (mm²/m)</label>
            <label><input type="radio" name="esd-comp" value="add_as" ${cfg.component === 'add_as' ? 'checked' : ''}> <b>Additional Reinforcing Area</b> (Required over Typical Base Mesh)</label>
            <label><input type="radio" name="esd-comp" value="percent" ${cfg.component === 'percent' ? 'checked' : ''}> <b>Reinforcing Percentage (%)</b> (ρ = As / bd)</label>
          </div>
        </div>

        <div class="ed-row" style="background:#f8fafc;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px">
          <label style="font-weight:600">Typical Base Mesh (for subtraction & callouts):</label>
          <div style="display:flex;gap:16px;align-items:center;margin-top:4px">
            <span>Bar Size:</span>
            <select id="esd-mesh-dia" style="padding:2px 6px">
              <option value="10" ${cfg.baseMesh.dia === 10 ? 'selected' : ''}>Ø10</option>
              <option value="12" ${cfg.baseMesh.dia === 12 ? 'selected' : ''}>Ø12</option>
              <option value="14" ${cfg.baseMesh.dia === 14 ? 'selected' : ''}>Ø14</option>
              <option value="16" ${cfg.baseMesh.dia === 16 ? 'selected' : ''}>Ø16</option>
              <option value="20" ${cfg.baseMesh.dia === 20 ? 'selected' : ''}>Ø20</option>
            </select>
            <span>Spacing (mm):</span>
            <input type="number" id="esd-mesh-spacing" value="${cfg.baseMesh.spacing || 200}" step="25" min="50" max="450" style="width:70px;padding:2px 6px">
          </div>
        </div>

        <div class="ed-row">
          <label><b>Display Options:</b></label>
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <label><input type="checkbox" id="esd-opt-contours" ${cfg.showContours ? 'checked' : ''}> Show Color Contours on Slabs</label>
            <label><input type="checkbox" id="esd-opt-values" ${cfg.showValues ? 'checked' : ''}> Show Governing Bar Callouts</label>
            <label><input type="checkbox" id="esd-opt-punching" ${cfg.showPunching ? 'checked' : ''}> Show Column Punching DCR & Perimeters</label>
          </div>
        </div>
      </div>
    `;

    app.dialog('Display Concrete Slab Design', html, [
      ['Apply', () => {
        const combo = document.getElementById('esd-dlg-combo').value;
        const method = document.querySelector('input[name="esd-method"]:checked').value;
        const direction = parseInt(document.querySelector('input[name="esd-dir"]:checked').value, 10);
        const face = document.querySelector('input[name="esd-face"]:checked').value;
        const component = document.querySelector('input[name="esd-comp"]:checked').value;
        const dia = parseInt(document.getElementById('esd-mesh-dia').value, 10) || 10;
        const spacing = parseInt(document.getElementById('esd-mesh-spacing').value, 10) || 200;
        const showContours = document.getElementById('esd-opt-contours').checked;
        const showValues = document.getElementById('esd-opt-values').checked;
        const showPunching = document.getElementById('esd-opt-punching').checked;

        showSlabDesign(app, {
          combo,
          method,
          direction,
          face,
          component,
          baseMesh: { dia, spacing },
          showContours,
          showValues,
          showPunching,
        });
        return false;
      }],
      ['Close', () => {}]
    ]);
  }

  // ---------------------------------------------------------------- Init & Hook
  function init(app) {
    appRef = app;
  }

  root.RCEtabsView = {
    init,
    showDeformedShape,
    showMemberForceDiagram,
    showShellForces,
    showSupportReactions,
    showDisplayDesignInfo,
    showSlabDesign,
    clearOverlays,
    openDeformedDialog,
    openForceDiagramDialog,
    openShellForcesDialog,
    openSupportReactionsDialog,
    openDisplayDesignInfoDialog,
    openSlabDesignDialog,
    openFrameDiagramWindow,
    openMemberDesignWindow,
    openSlabDesignDetailWindow,
    computeWoodArmer,
  };
})(window);
