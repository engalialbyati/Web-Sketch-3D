// rcview.js — ETABS display parity: ClineAndMidPlane (property-line) view,
// Results View (colored by DCR/utilization on the model), live hover readout
// for diagrams/deflection, and slab design-strip data.
// Decompiled evidence: eObjectRepresentationTypes { None, ClineAndMidPlane,
// Extruded, SolidSurface } (CSI.NAUtil.Gr3D) and ResultDisplayTypes
// (None, ForceDiagrams, DeformedShape, Stresses...).
(function (root) {
  'use strict';

  let clGroup = null;          // centerline overlay
  let prevFilters = null;      // saved element/face filters when centerline on
  let resultColors = null;     // Map faceId -> {color, matId, alpha}
  let legendEl = null;
  let liveEl = null;           // hover readout div
  let liveRay = null;

  // ------------------------------------------------ ClineAndMidPlane view
  function buildCenterlines(app) {
    const THREE = root.THREE;
    const g = new THREE.Group();
    g.name = 'rcCenterlines';
    const matBeam = new THREE.LineBasicMaterial({ color: 0x0d47a1 });
    const matCol = new THREE.LineBasicMaterial({ color: 0x1b5e20 });
    const matWall = new THREE.LineBasicMaterial({ color: 0x4e342e });
    const matSlab = new THREE.LineBasicMaterial({ color: 0x37474f });
    const add = (a, b, mat) => g.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        [new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(b[0], b[1], b[2])]), mat));
    for (const ent of app.bim.entities) {
      const p = ent.params;
      if (ent.type === 'beam' && Array.isArray(p.baseline)) {
        add(p.baseline[0], p.baseline[p.baseline.length - 1], matBeam);
      } else if (ent.type === 'column' && Array.isArray(p.base)) {
        add(p.base, [p.base[0], p.base[1], p.base[2] + (+p.height || 3)], matCol);
      } else if (ent.type === 'wall' && Array.isArray(p.base) && Array.isArray(p.end)) {
        const h = +p.height || 3, a = p.base, b = p.end;
        add([a[0], a[1], a[2]], [b[0], b[1], b[2]], matWall);
        add([a[0], a[1], a[2] + h], [b[0], b[1], b[2] + h], matWall);
      } else if ((ent.type === 'slab' || ent.type === 'roof' || ent.type === 'floor') && Array.isArray(p.regions)) {
        for (const reg of p.regions) {
          const o = reg.outer || [];
          for (let i = 0; i < o.length; i++) add(o[i], o[(i + 1) % o.length], matSlab);
        }
      }
    }
    return g;
  }

  function toggleCenterline(app) {
    const view = app.view;
    if (clGroup) {
      // off → restore solids
      view.scene.remove(clGroup);
      clGroup = null;
      if (prevFilters) { view.elementFilter = prevFilters.elementFilter; view.faceFilter = prevFilters.faceFilter; prevFilters = null; }
      app.toast('Extruded view');
    } else {
      // on → ClineAndMidPlane (ETABS eObjectRepresentationTypes parity)
      if (view.elementFilter || view.faceFilter) {
        app.toggleDesignView && app.designView && app.toggleDesignView(); // clear design view first
      }
      prevFilters = { elementFilter: view.elementFilter || null, faceFilter: view.faceFilter || null };
      view.elementFilter = () => false;   // hide every solid
      view.faceFilter = () => false;
      clGroup = buildCenterlines(app);
      view.scene.add(clGroup);
      app.toast('Property-line view (Cline & Mid-plane) — grids + centerlines; diagrams and deflected shapes read cleanly');
    }
    view.rebuild();
    app._btnCenterline && app._btnCenterline.classList.toggle('on', !!clGroup);
  }

  // ------------------------------------------------------ results view
  function dcrColor(r) {
    // 0 → green, 0.5 → yellow, 1 → red, >1 → dark red
    const clamp01 = Math.min(Math.max(r, 0), 1.2) / 1.2;
    let cr, cg, cb;
    if (clamp01 <= 0.5) {
      const t = clamp01 / 0.5;
      cr = Math.round(46 + t * (245 - 46)); cg = Math.round(125 + t * (127 - 125)); cb = Math.round(50 + t * (23 - 50));
    } else {
      const t = (clamp01 - 0.5) / 0.7;
      cr = Math.round(245 + t * (60)); cg = Math.round(127 - t * 100); cb = Math.round(23);
    }
    return (cr << 16) | (cg << 8) | cb;
  }

  function applyResultsColors(app) {
    const R = app.rcResults;
    if (!R) return false;
    // gather governing utilization per entity
    const util = new Map();
    try {
      const bd = root.RCBeam.designAllBeams(app, 'ENVELOPE');
      for (const r of bd.results || []) {
        const dcr = Math.max((r.MuTop || 0), (r.MuBot || 0)) > 0
          ? Math.min(((r.MuTop + r.MuBot) / 2 / 1e6) / 60, 1.2) : 0.05; // relative index
        util.set(r.id, dcr);
      }
    } catch (e) { }
    try {
      const cd = root.RCColumn.designAllColumns(app, 'ENVELOPE', 'design', true);
      for (const r of cd.results || [])
        util.set(r.id, Math.max(r.dcr || 0, r.shear ? r.shear.dcr : 0, r.joint ? r.joint.ratio : 0));
    } catch (e) { }
    try {
      const wd = root.RCWall.designAllWalls(app, 'ENVELOPE');
      for (const r of wd.results || []) util.set(r.id, r.dcr || 0.05);
    } catch (e) { }
    // slabs: normalize panel M11 demand to the worst panel (contour-scale)
    try {
      const sd = root.RCSlab.designAllSlabs(app, 'ENVELOPE');
      let worst = 1e-9;
      for (const r of sd.results || []) worst = Math.max(worst, Math.abs(r.maxM11 || 0), Math.abs(r.minM11 || 0));
      for (const r of sd.results || [])
        util.set(r.id, Math.max(Math.abs(r.maxM11 || 0), Math.abs(r.minM11 || 0)) / worst);
    } catch (e) { }

    const m = app.model;
    resultColors = new Map();
    let painted = 0;
    for (const ent of app.bim.entities) {
      const u = util.get(ent.id);
      if (u == null) continue;
      const col = dcrColor(u);
      for (const fid of ent.faces || []) {
        const f = m.faces.get(fid);
        if (!f) continue;
        resultColors.set(fid, { color: f.color, matId: f.matId || null, alpha: f.alpha == null ? 1 : f.alpha });
        f.color = col; f.matId = null; f.alpha = 1;
        painted++;
      }
    }
    return painted > 0;
  }

  function restoreColors(app) {
    if (!resultColors) return;
    const m = app.model;
    for (const [fid, sk] of resultColors) {
      const f = m.faces.get(fid);
      if (!f) continue;
      f.color = sk.color; f.matId = sk.matId; f.alpha = sk.alpha;
    }
    resultColors = null;
    if (legendEl) { legendEl.remove(); legendEl = null; }
  }

  function toggleResultsView(app) {
    if (resultColors) {
      restoreColors(app);
      app.view.rebuild();
      app.toast('Results view off');
    } else {
      if (!app.rcResults) { app.toast('Run the analysis first', true); return; }
      const ok = applyResultsColors(app);
      if (!ok) { app.toast('No design results to color', true); return; }
      app.view.rebuild();
      app.view.invalidate && app.view.invalidate();
      if (!legendEl) {
        legendEl = document.createElement('div');
        legendEl.style.cssText = 'position:fixed;right:12px;bottom:44px;z-index:9999;background:rgba(255,255,255,.94);' +
          'border:1px solid #b8c4cc;border-radius:6px;padding:8px 10px;font:11px Inter,sans-serif;line-height:1.5';
        legendEl.innerHTML = '<b>Results View</b> — utilization<br>' +
          '<span style="display:inline-block;width:70px;height:10px;border-radius:2px;background:linear-gradient(90deg,#2e7d32,#f57f17,#e53935)"></span><br>' +
          'green 0 · yellow 0.6 · red 1.0+<br><span style="opacity:.65">beams: demand index · columns: max(PMM, shear, joint) · walls: DCR · slabs: M₁₁ scale</span>';
        document.body.appendChild(legendEl);
      }
      app.toast('Results view — model colored by governing utilization');
    }
    app._btnResultsView && app._btnResultsView.classList.toggle('on', !!resultColors);
  }

  // -------------------------------------------------- live hover readout
  // ETABS shows diagram values while the cursor tracks a member. Here: when
  // diagrams or the deflected shape are active, hovering a beam prints its
  // station data (x, M, V or δ) in a floating tag.
  function ensureLiveEl() {
    if (!liveEl) {
      liveEl = document.createElement('div');
      liveEl.style.cssText = 'position:fixed;z-index:99999;background:rgba(20,26,32,.92);color:#fff;' +
        'padding:5px 8px;border-radius:4px;font:11px monospace;pointer-events:none;white-space:pre;display:none';
      document.body.appendChild(liveEl);
    }
    return liveEl;
  }

  function attachLiveRead(app, mode, comboName) {
    detachLiveRead(app);
    if (!root.THREE || !app.view || !app.view.camera) return;
    liveRay = { mode, comboName, handler: ev => onHover(app, ev, mode, comboName) };
    const el = app.view.renderer ? app.view.renderer.domElement : document.getElementById('viewport');
    if (el) el.addEventListener('pointermove', liveRay.handler);
  }
  function detachLiveRead(app) {
    if (!liveRay) return;
    const el = app.view && app.view.renderer ? app.view.renderer.domElement : document.getElementById('viewport');
    if (el) el.removeEventListener('pointermove', liveRay.handler);
    liveRay = null;
    const le = ensureLiveEl();
    le.style.display = 'none';
  }

  function onHover(app, ev, mode, comboName) {
    const R = app.rcResults;
    if (!R || !R.model) return;
    const cam = app.view.camera;
    const w = ev.target.clientWidth || window.innerWidth;
    const h2 = ev.target.clientHeight || window.innerHeight;
    const ndc = new THREE.Vector3((ev.offsetX / w) * 2 - 1, -(ev.offsetY / h2) * 2 + 1, 0.5);
    ndc.unproject(cam);
    const dir = ndc.sub(cam.position).normalize();
    const dist = (cam.position.z - 0) / -dir.z;
    if (!isFinite(dist)) return;
    const pt = cam.position.clone().add(dir.multiplyScalar(dist));
    // nearest beam line within 0.45 m in plan at the beam's z
    let best = null;
    for (const mm of R.model.map) {
      if (!mm.ent || mm.ent.type !== 'beam') continue;
      const el = R.model.frames[mm.idx];
      const a = R.model.nodes[el.ni], b = R.model.nodes[el.nj];
      const vx = b.x - a.x, vy = b.y - a.y;
      const L = Math.hypot(vx, vy) || 1;
      const t = ((pt.x - a.x) * vx + (pt.y - a.y) * vy) / (L * L);
      if (t < -0.02 || t > 1.02) continue;
      const cx = a.x + vx * t, cy = a.y + vy * t;
      const d = Math.hypot(pt.x - cx, pt.y - cy) + Math.abs(pt.z - a.z) * 0.5;
      if (d < 0.6 && (!best || d < best.d)) best = { mm, a, b, L, t: Math.max(0, Math.min(1, t)), d };
    }
    const le = ensureLiveEl();
    if (!best) { le.style.display = 'none'; return; }
    const xM = best.t * best.L;
    // station data from the requested case
    let txt = best.mm.ent.id + '  x=' + xM.toFixed(2) + ' m';
    try {
      const src = root.RCModel.designSources(app, comboName)[0];
      const byId = new Map((src ? src.members : []).filter(Boolean).map(r => [r.id, r]));
      // chain this entity's rows
      const rows = R.model.map.filter(m2 => m2.ent && m2.ent.id === best.mm.ent.id)
        .sort((p2, q2) => (p2.x0 || 0) - (q2.x0 || 0));
      let st = null;
      for (const r2 of rows) {
        const row = byId.get(best.mm.ent.id);
        if (!row || !row.stations) break;
        const x0 = (r2.x0 || 0);
        const xs = row.stations.map(s2 => x0 + s2.x);
        if (xM >= xs[0] - 1e-6 && xM <= xs[xs.length - 1] + 1e-6) {
          for (let i = 0; i < xs.length - 1; i++)
            if (xM >= xs[i] && xM <= xs[i + 1]) {
              const f2 = (xM - xs[i]) / Math.max(xs[i + 1] - xs[i], 1e-9);
              st = {
                M: row.stations[i].M + f2 * (row.stations[i + 1].M - row.stations[i].M),
                V: row.stations[i].V + f2 * (row.stations[i + 1].V - row.stations[i].V),
              };
              break;
            }
          break;
        }
      }
      if (mode === 'M3') txt += st ? `\nM = ${st.M.toFixed(1)} kN·m` : '';
      if (mode === 'V3') txt += st ? `\nV = ${st.V.toFixed(1)} kN` : '';
      if (mode === 'DEF') {
        const defs = root.RCModel.serviceDeflections(app, comboName);
        const v = defs && defs.get(best.mm.ent.id);
        if (v) txt += `\nδD = ${v.dD} mm · δL = ${v.dL} mm\nδLT = ${v.dLT} mm (Ie/Ig = ${(v.Ie / v.Ig).toFixed(2)})`;
      }
    } catch (e) { }
    le.textContent = txt;
    le.style.left = (ev.clientX + 14) + 'px';
    le.style.top = (ev.clientY + 12) + 'px';
    le.style.display = 'block';
  }

  // -------------------------------------------- slab design strips (ETABS)
  // "Concrete Slab Design - Flexure and Shear Data": per strip per station
  // per layer — combo, Mu, Asreq, Asmin, Vu, Av/s. Strips auto-generated in
  // both directions per panel (full design width), integrated from shell M.
  function designSlabStrips(app, comboName) {
    const R = app.rcResults;
    if (!R || !R.model || !R.model.shells.length) return { error: 'No shell model.' };
    root.RCModel.ensureAutoCombos(app);
    const sources = root.RCModel.designSources(app, comboName);
    const d = root.RCDefine.ensure(app);
    const rows = [];
    for (const src of sources) {
      const shells = (src.shells || []).filter(s2 => s2 && s2.forces);
      const byEnt = new Map();
      for (const s2 of shells) {
        if (!byEnt.has(s2.entId)) byEnt.set(s2.entId, []);
        byEnt.get(s2.entId).push(s2);
      }
      for (const [entId, cells] of byEnt) {
        const ent = app.bim.getEntityById(entId);
        if (!ent || !['slab', 'floor', 'roof'].includes(ent.type)) continue;
        const matName = ent.params.materialOverwrite || 'CONC25';
        const mat = d.materials.find(x2 => x2.name === matName) || d.materials.find(x2 => x2.type === 'concrete');
        const fc = mat && mat.conc ? mat.conc.fc : 25;
        const fy = (d.materials.find(x2 => x2.type === 'rebar') || { rebar: { fy: 500 } }).rebar.fy;
        const t = (ent.params.thickness || 0.2) * 1000;
        const dEff = t - 25 - 6;
        const nd = R.model.nodes;
        // station lines in X and Y: unique mesh lines
        for (const dir of [1, 2]) {
          const key = c2 => dir === 1 ? +c2.x.toFixed(3) : +c2.y.toFixed(3);
          const crossOf = c2 => dir === 1 ? c2.y : c2.x;
          const centers = cells.map(s2 => {
            const p = nd[s2.n1], q = nd[s2.n3];
            return { k: key(p), c: (crossOf(p) + crossOf(q)) / 2,
              m: dir === 1 ? s2.forces.M11 : s2.forces.M22,
              q: dir === 1 ? s2.forces.Q11 : s2.forces.Q22 };
          });
          const ks = [...new Set(centers.map(c2 => c2.k))].sort((a, b) => a - b);
          const widthSpan = centers.length
            ? Math.max(...centers.map(c2 => c2.c)) - Math.min(...centers.map(c2 => c2.c)) : 0;
          const stripId = entId + '-' + (dir === 1 ? 'D1' : 'D2');
          for (const k of ks) {
            const band = centers.filter(c2 => Math.abs(c2.k - k) < 1e-3);
            if (!band.length) continue;
            let mAvg = 0, qAvg = 0;
            for (const c2 of band) { mAvg += c2.m; qAvg += c2.q; }
            mAvg /= band.length; qAvg /= band.length;
            // top governs negative, bot positive
            const AsCalc = mm => Math.abs(mm) * 1e6 / (0.9 * fy * (dEff - 40));
            const AsTop = AsCalc(Math.min(mAvg, 0));
            const AsBot = AsCalc(Math.max(mAvg, 0));
            const AsMin = 0.0018 * 1000 * t; // per meter
            const Vu = Math.abs(qAvg); // kN/m (Q in N/mm)
            const AvsMin = Math.max(0.062 * Math.sqrt(fc), 0.35) * 1000 / fy;
            rows.push({
              strip: stripId, ent: entId, dir: dir === 1 ? 'GlobalX' : 'GlobalY',
              station: +(k).toFixed(2),
              combo: src.name,
              mTop: +(-Math.min(mAvg, 0)).toFixed(1), mBot: +Math.max(mAvg, 0).toFixed(1),
              asTop: Math.max(Math.round(AsTop), Math.round(AsMin)),
              asBot: Math.max(Math.round(AsBot), Math.round(AsMin)),
              asMin: Math.round(AsMin),
              vu: +Vu.toFixed(1), avMinPerS: +AvsMin.toFixed(3),
              width: +(widthSpan).toFixed(1), nCells: band.length,
            });
          }
        }
      }
    }
    return { rows, comboName: comboName || 'ENVELOPE' };
  }

  // ------------------------------------------- slab design window (ETABS)
  // ETABS "Slab Design" form parity: a popup with the strip design table
  // (Object, Combo, Station, FTop/FBot combo+area, VMaj) while the strips
  // are DRAWN ON THE MODEL colored by flexural utilization, refreshed by
  // the Design button in the form.
  let stripGroup = null;

  function clearStrips(app) {
    if (stripGroup) { app.view.scene.remove(stripGroup); stripGroup = null; }
  }

  function drawStrips(app, rows) {
    const THREE = root.THREE;
    clearStrips(app);
    if (!THREE) return;
    stripGroup = new THREE.Group();
    stripGroup.name = 'rcSlabStrips';
    // utilization scale per row: demand / worst demand of its slab+dir
    const worst = new Map();
    for (const r of rows) {
      const k = r.strip;
      worst.set(k, Math.max(worst.get(k) || 0, Math.abs(r.mTop), Math.abs(r.mBot)));
    }
    const R = app.rcResults, nd = R.model.nodes;
    const model = R.model;
    for (const r of rows) {
      const ent = app.bim.getEntityById(r.ent);
      if (!ent || !ent.params.regions || !ent.params.regions.length) continue;
      const zLvl = (ent.params.regions[0].outer || [[0, 0, 0]])[0][2] + 0.03;
      const o = ent.params.regions[0].outer;
      const xs = o.map(q => q[0]), ys = o.map(q => q[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const u = worst.get(r.strip) > 1e-6
        ? Math.max(Math.abs(r.mTop), Math.abs(r.mBot)) / worst.get(r.strip) : 0;
      const col = dcrColor(u * 1.0);
      const mat = new THREE.LineBasicMaterial({ color: col });
      const pts = r.dir === 'GlobalX'
        ? [[r.station, y0, zLvl], [r.station, y1, zLvl]]
        : [[x0, r.station, zLvl], [x1, r.station, zLvl]];
      stripGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          pts.map(q => new THREE.Vector3(q[0], q[1], q[2]))), mat));
    }
    app.view.scene.add(stripGroup);
    app.view.invalidate();
  }

  function slabDesignWindow(app) {
    const R = app.rcResults;
    if (!R || !R.model || !R.model.shells.length) { app.toast('Run the analysis first', true); return; }
    const names = R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name);
    const esc2 = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const html = [
      '<div style="display:flex;align-items:center;gap:10px;margin:0 0 6px">',
      '<span style="font-size:12px;opacity:.75">Combo</span>',
      `<select id="sdw-combo" style="padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">` +
      '<option value="ENVELOPE">ENVELOPE - governing</option>' +
      names.map(n => `<option value="${esc2(n)}">${esc2(n)}</option>`).join('') + '</select>',
      '<span style="flex:1"></span>',
      '<span style="font-size:11px;opacity:.6">strips drawn on the model · green→red = flexural demand</span>',
      '</div>',
      '<div id="sdw-body" style="max-height:56vh;overflow:auto"></div>',
    ].join('');
    app.dialog('Slab Design — Flexure and Shear Data', html, [
      ['Design', () => { render(true); return false; }],
      ['Hide Strips', () => { clearStrips(app); }],
      ['Close', () => { clearStrips(app); }],
    ]);
    const render = (draw) => {
      const combo = document.getElementById('sdw-combo').value;
      const res = designSlabStrips(app, combo);
      if (res.error) {
        document.getElementById('sdw-body').innerHTML = `<p style="color:#c62828;font-size:12px">${esc2(res.error)}</p>`;
        return;
      }
      // governing rows only (worst station per strip+layer) to stay readable
      const gov = new Map();
      for (const r of res.rows) {
        const prev = gov.get(r.strip);
        const dem = Math.max(Math.abs(r.mTop), Math.abs(r.mBot));
        if (!prev || dem > prev.dem) gov.set(r.strip, { ...r, dem });
      }
      const rows = [...gov.values()].map(r => '<tr>' +
        `<td style="padding:2px 8px">${esc2(r.ent)}</td>` +
        `<td>${esc2(r.dir)}</td>` +
        `<td>${r.station.toFixed(2)}</td>` +
        `<td>${esc2(r.combo)}</td>` +
        `<td>${r.mTop.toFixed(1)}</td><td><b>${r.asTop}</b></td>` +
        `<td>${r.mBot.toFixed(1)}</td><td><b>${r.asBot}</b></td>` +
        `<td>${r.asMin}</td><td>${r.vu.toFixed(1)}</td>` +
        '</tr>').join('');
      document.getElementById('sdw-body').innerHTML =
        '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
        '<thead><tr style="text-align:left;opacity:.7">' +
        ['Object', 'Dir', 'Station (m)', 'Combo', 'Mu Top (kN·m/m)', 'As Top (mm²/m)',
         'Mu Bot (kN·m/m)', 'As Bot (mm²/m)', 'AsMin (mm²/m)', 'Vu (kN/m)']
          .map(h => `<th style="padding:3px 8px;border-bottom:1px solid #d7dde3">${h}</th>`).join('') +
        `</tr></thead><tbody>${rows}</tbody></table>` +
        `<p style="font-size:11px;opacity:.65;margin:6px 0 0">${gov.size} strips · governing station per strip · full station list in Show Tables ▸ "Concrete Slab Design"</p>`;
      if (draw) drawStrips(app, res.rows);
    };
    document.getElementById('sdw-combo').addEventListener('change', () => render(true));
    render(true);
  }

  function open(app, cat) {
    if (cat === 'centerlineView') { toggleCenterline(app); return; }
    if (cat === 'resultsView') { toggleResultsView(app); return; }
    if (cat === 'slabDesignView') { slabDesignWindow(app); return; }
  }

  root.RCView = { open, toggleCenterline, toggleResultsView, attachLiveRead, detachLiveRead, designSlabStrips, slabDesignWindow, drawStrips, clearStrips };
})(window);
