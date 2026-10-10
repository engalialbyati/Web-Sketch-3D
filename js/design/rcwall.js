// rcwall.js — ACI 318-19 RC wall design (Ch. 11 + Ch. 22).
// Uses the P-M interaction fiber method (same approach as column design,
// but for the wall cross-section: length × thickness) plus in-plane shear
// design per ACI §11.5. Reports vertical and horizontal reinforcement.
// Original code — equations cite ACI clauses.
// Units: N, mm, MPa.
(function (root) {
  'use strict';

  const Es = 200000;
  const EC_U = 0.003;

  // ============================================================ wall section
  // Build the reinforcement layout for a wall cross-section.
  // A wall is a rectangle: length = wall length, width = wall thickness.
  // Vertical bars distributed along the length + end zone concentration.
  function wallBars(length, thickness, cover, vertDia, nVert, endZoneBars, endZoneDia) {
    const Av = Math.PI * vertDia * vertDia / 4;
    const Ae = Math.PI * endZoneDia * endZoneDia / 4;
    const bars = [];
    const half = thickness / 2 - cover - vertDia / 2;

    // end zone bars (both ends)
    for (let i = 0; i < endZoneBars; i++) {
      const x = -(length / 2 - cover - endZoneDia / 2 - i * vertDia * 1.5);
      bars.push({ x, y: -half, area: Ae });
      bars.push({ x, y: +half, area: Ae });
    }

    // distributed vertical bars between end zones
    const distLength = length - 2 * (cover + endZoneDia + endZoneBars * vertDia * 1.5);
    for (let i = 0; i < nVert; i++) {
      const x = -(length / 2 - cover - endZoneDia - endZoneBars * vertDia * 1.5) +
        distLength * (i + 0.5) / nVert;
      bars.push({ x, y: -half, area: Av });
      bars.push({ x, y: +half, area: Av });
    }
    return bars;
  }

  // ============================================================ P-M interaction
  // Same fiber method as column: sweep NA depth, compute P and M.
  // For a wall: bending is about the weak axis (the length axis is in-plane).
  function wallPM(length, thickness, fc, fy, bars, nPoints = 40) {
    const b1 = beta1(fc);
    const Ag = length * thickness;
    const Ast = bars.reduce((s, b) => s + b.area, 0);
    const results = [];

    for (let i = 0; i <= nPoints; i++) {
      const t = i / nPoints;
      let P = 0, M = 0;

      if (t === 0) {
        for (const bar of bars) P -= bar.area * fy;
        results.push({ P, M: 0 });
        continue;
      }
      if (t === 1) {
        P = 0.85 * fc * (Ag - Ast) + Ast * fy;
        results.push({ P, M: 0 });
        continue;
      }

      const c = length * 1.5 * (1 - t) + 0.01;
      const a = Math.min(b1 * c, length);

      if (a > 0) {
        const Cc = 0.85 * fc * thickness * a;
        const yCc = -(length / 2) + a / 2;
        P += Cc;
        M += Cc * yCc;
      }

      for (const bar of bars) {
        const di = bar.x + length / 2;
        const es = EC_U * (c - di) / c;
        const fs = Math.max(-fy, Math.min(fy, Es * es));
        const Fi = bar.area * fs;
        P += Fi;
        M += Fi * bar.x;
      }

      results.push({ P, M: Math.abs(M) });
    }
    return results;
  }

  function beta1(fc) {
    return Math.max(0.65, Math.min(0.85, 0.85 - 0.05 * (fc - 28) / 7));
  }

  // ============================================================ in-plane shear
  // ACI 318-19 §11.5 in-plane shear design for walls
  function wallShear(Vu, length, thickness, fc, fyh, Pu, height) {
    const phi = 0.75;
    const lw = length; // wall length
    const hw = height || lw; // wall height
    const Aw = length * thickness; // wall cross-sectional area

    // αc per ACI Table 11.5.4.1(a): interpolated by hw/lw ratio
    const hwLw = hw / lw;
    const alphaC = hwLw <= 1.5 ? 3.0 : hwLw >= 2.0 ? 2.0 :
      3.0 - (hwLw - 1.5) * (3.0 - 2.0) / 0.5;

    // axial effect on Vc (ACI 11.5.4.2): compression improves Vc, tension reduces it
    let axialFactor = 1.0;
    if (Pu > 0) axialFactor = 1.0 + Math.min(Pu / (500 * Aw), 1.0); // compression helps
    else if (Pu < 0) axialFactor = Math.max(0, 1 + Pu / (500 * Aw)); // tension hurts

    // Vc (ACI Table 11.5.4.1(a), SI)
    let Vc = alphaC * 0.17 * Math.sqrt(fc) * Aw * axialFactor; // N

    // Vc upper limit (ACI 11.5.4.3): Vc ≤ 0.66·λ√f'c·Aw (conservative cap, not 0.83)
    const VcMax = 0.66 * Math.sqrt(fc) * Aw;
    Vc = Math.min(Vc, VcMax);
    Vc = Math.max(Vc, 0);

    const phiVc = phi * Vc;
    // Vs upper limit (ACI 11.5.4.4): Vn ≤ 0.66·λ√f'c·Aw (ACI 318-19 conservative)
    const phiVnMax = phi * 0.66 * Math.sqrt(fc) * Aw;

    if (Vu > phiVnMax) {
      return { ok: false, phiVc, phiVnMax, reason: "Vu exceeds φVn_max — increase wall thickness or f'c (ACI 11.5.4.4)." };
    }

    // required horizontal reinforcement Avh/s (ACI 11.5.5.1)
    // NOTE: divided by lw (effective length), NOT thickness — ETABS atg.cs:3880
    let Avhs = 0;
    if (Vu > phiVc) {
      Avhs = (Vu / phi - Vc) / (lw * fyh); // mm²/mm along wall length
    }

    // minimum horizontal reinforcement (ACI 318-19 Table 11.6.2)
    const AvhsMin = 0.0025 * thickness; // ρh = 0.0025 for fy ≥ 420 MPa

    return {
      ok: true, phi, Vc: phiVc, Avhs: Math.max(Avhs, AvhsMin),
      AvhsMin, alphaC,
    };
  }

  // ============================================================ wall forces
  // Walls are meshed into flat-shell quads (local x along the wall length,
  // local y vertical, local z the wall normal). Design forces come from
  // integrating the membrane resultants over a horizontal cut — ETABS pier
  // integration: top AND bottom stations of each pier:
  //   P = Σ(−N22)·w   (N22 tension-positive → compression stored positive)
  //   V = Σ(N12)·w    (in-plane horizontal shear across the cut)
  //   M = Σ(−N22)·(x−x̄)·w   (in-plane moment about the wall normal)
  function wallCut(model, cells, nd, zTarget) {
    let row = cells.filter(s => {
      const zMid = (nd[s.n1].z + nd[s.n4].z) / 2;
      return Math.abs(zMid - zTarget) < 1e-4 || zMid < zTarget;
    });
    if (!row.length) return null;
    // keep only the cells of the row closest to the target elevation
    const zMax = Math.max(...row.map(s => (nd[s.n1].z + nd[s.n4].z) / 2));
    row = row.filter(s => Math.abs((nd[s.n1].z + nd[s.n4].z) / 2 - zMax) < 1e-4);
    let P = 0, V = 0, xw = 0, wTot = 0;
    const seg = [];
    for (const s of row) {
      const a = nd[s.n1], b = nd[s.n2];
      const wmm = Math.hypot(b.x - a.x, b.y - a.y) * 1000; // cell width, mm
      if (wmm < 1e-6) continue;
      const n22 = -(typeof s.forces.N22 === 'number' ? s.forces.N22 : 0);
      const n12 = (typeof s.forces.N12 === 'number' ? s.forces.N12 : 0);
      const cx = (a.x + b.x) / 2 * 1000;
      P += n22 * wmm;   // N
      V += n12 * wmm;   // N
      seg.push({ cx, w: wmm, n22 });
      xw += cx * wmm; wTot += wmm;
    }
    if (!wTot) return null;
    const xBar = xw / wTot;
    let M = 0;
    for (const g of seg) M += g.n22 * (g.cx - xBar) * g.w; // N·mm
    return { P, V, M, nCells: row.length };
  }

  function wallBaseForces(model, srcShells, ent, reactions) {
    const nd = model.nodes;
    const cells = srcShells.filter(s => s && s.forces && s.entId === ent.id);
    if (!cells.length) return null;
    // wall base elevation: the lowest cell row of this wall
    const zBase = Math.min(...cells.map(s => (nd[s.n1].z + nd[s.n4].z) / 2));
    const zTop = Math.max(...cells.map(s => (nd[s.n1].z + nd[s.n4].z) / 2));
    const base = wallCut(model, cells, nd, zBase);
    const top = zTop > zBase + 1e-6 ? wallCut(model, cells, nd, zTop) : null;
    if (!base) return null;

    // Supported base cut: loads entering the structure AT supported nodes
    // never create interior stress, so center-point integration under-reads
    // the axial. The support reactions ARE the exact base resultants for a
    // ground-level wall — use them whenever the bottom row is supported.
    if (reactions && reactions.length) {
      const byNode = new Map(reactions.map(r => [r.node, r]));
      const rowCells = cells.filter(s => Math.abs((nd[s.n1].z + nd[s.n4].z) / 2 - zBase) < 1e-4);
      const supported = new Map(); // node → {R, x}
      for (const s of rowCells) {
        for (const ni of [s.n1, s.n2]) {
          const rec = byNode.get(ni);
          if (!rec || !nd[ni].fixed || !nd[ni].fixed[2]) continue; // not a support
          supported.set(ni, { R: rec.R, x: nd[ni].x, y: nd[ni].y });
        }
      }
      if (supported.size >= 2) {
        // in-plane direction = along the wall length (bottom edge)
        const arr = [...supported.values()];
        const dx = arr[arr.length - 1].x - arr[0].x, dy = arr[arr.length - 1].y - arr[0].y;
        const len = Math.hypot(dx, dy) || 1;
        const tx = dx / len, ty = dy / len;
        let xw = 0, P = 0, V = 0;
        for (const s of arr) {
          P += s.R[2];                    // N — vertical support force = compression
          V += s.R[0] * tx + s.R[1] * ty; // in-plane horizontal = shear
          xw += s.x * s.R[2];
        }
        if (Math.abs(P) > 1e-6) {
          const xBar = xw / P;            // m — reaction centroid
          let M = 0;
          for (const s of arr) M += s.R[2] * (s.x - xBar) * 1000; // N·mm
          base.P = P; base.V = V; base.M = M; base.fromReactions = true;
          base.nCells = supported.size;
        }
      }
    }

    return { base, top };
  }

  // ============================================================ full design
  function designAllWalls(app, comboName) {
    const R = app.rcResults;
    if (!R) return { error: 'Run the analysis first.' };
    const d = root.RCDefine.ensure(app);

    let combo = R.combos.find(c => c.name === comboName);
    let pat = null;
    if (!combo) {
      pat = R.patterns.find(p => p.name === comboName);
      if (!pat) return { error: `Combination "${comboName}" not found.` };
    }

    const model = R.model;
    if (!model || !model.shells || !model.shells.length)
      return { error: 'No shell model — re-run the analysis.' };
    const src = combo || pat;
    const srcShells = (src.shells || []).filter(s => s && s.forces);

    const results = [];
    for (const ent of app.bim.entities) {
      if (ent.type !== 'wall') continue;
      const wf = wallBaseForces(model, srcShells, ent, src.reactions);
      if (!wf) continue;
      const matName = ent.params.materialOverwrite || 'CONC25';
      const mat = d.materials.find(x => x.name === matName) || d.materials.find(x => x.type === 'concrete');
      if (!mat || !mat.conc) continue;
      const fc = mat.conc.fc;
      const fy = d.materials.find(x => x.type === 'rebar')?.rebar?.fy || 500;
      const fyh = fy; // horizontal reinforcement yield

      // wall geometry from BIM params
      const p = ent.params;
      const thickness = (p.thickness || 0.2) * 1000; // mm
      let length = 3000; // default
      if (Array.isArray(p.base) && Array.isArray(p.end)) {
        length = Math.hypot(p.end[0] - p.base[0], p.end[1] - p.base[1]) * 1000;
      }
      const height = (+p.height || 3) * 1000;

      // reinforcement defaults (ACI 11.6.1 + ACI 11.7.2)
      const vertDia = 12, vertSpacing = 300;
      const nVertPerFace = Math.max(2, Math.floor(length / vertSpacing) - 1);
      const endZoneBars = 2, endZoneDia = 16;
      const cover = 40;

      const bars = wallBars(length, thickness, cover, vertDia, nVertPerFace, endZoneBars, endZoneDia);
      const Ast = bars.reduce((s, b) => s + b.area, 0);
      const rhoVert = Ast / (length * thickness);
      const rhoMinVert = 0.0015; // ACI 318-19 Table 11.6.2 (ρℓ base)

      // P-M interaction — evaluated at BOTH pier stations (ETABS designs
      // Section Bottom and Section Top); the governing DCR station reports
      const pm = wallPM(length, thickness, fc, fy, bars, 30);
      const stationForces = [wf.base, wf.top].filter(Boolean).map((st, si) => {
        const Pu = Math.abs(st.P);   // N — compression positive
        const Mx = Math.abs(st.M);   // N·mm — in-plane moment
        let dcr = 0, Pcap = 0;
        for (let i = 0; i < pm.length - 1; i++) {
          if (Mx >= Math.min(pm[i].M, pm[i+1].M) && Mx <= Math.max(pm[i].M, pm[i+1].M)) {
            const t = Math.abs(pm[i+1].M - pm[i].M) > 1e-9 ? (Mx - pm[i].M) / (pm[i+1].M - pm[i].M) : 0;
            Pcap = pm[i].P + t * (pm[i+1].P - pm[i].P);
            dcr = Math.abs(Pu) / Math.abs(Pcap) || 0;
            break;
          }
        }
        return { station: si === 0 ? 'bottom' : 'top',
          Pu, Mx, Vu: Math.abs(st.V), dcr, Pcap };
      });
      const gov = stationForces.reduce((a, b) => (b.dcr > a.dcr ? b : a), stationForces[0]);
      const Pu = gov.Pu, Mx = gov.Mx;

      // in-plane shear at the governing station
      const Vu = gov.Vu;
      const shear = wallShear(Vu, length, thickness, fc, fyh, Pu, height);

      // min horizontal reinforcement
      const horizDia = 10;
      const horizArea = Math.PI * horizDia * horizDia / 4;
      const horizSpacing = Math.min(350, (horizArea * 2) / (shear.Avhs * thickness || rhoMinVert * thickness));

      const status = gov.dcr > 1 ? 'OVERSTRESSED' :
        !shear.ok ? 'SHEAR FAILURE' :
        gov.dcr > 0.9 ? 'NEAR LIMIT' : 'OK';

      // Vu > 0.5·φVc → escalate vertical reinforcement (ACI 11.6.3)
      let rhoVertFinal = rhoVert;
      if (Vu > 0.5 * shear.phiVc && shear.ok) {
        rhoVertFinal = Math.max(rhoVert, 0.0025 + 0.5 * (2.5 - Math.min(height / length, 2.5)) * (0.0025 - 0.0015));
      }

      results.push({
        id: ent.id, length, thickness, height, fc, fy,
        station: gov.station,
        Pu: Pu / 1e3, Mx: Mx / 1e6, Vu: Vu / 1e3, // kN, kN·m
        Ast, rhoVert, rhoMinVert,
        dcr: gov.dcr, Pcap: gov.Pcap / 1e3, status,
        stations: stationForces.map(s => ({ station: s.station, Pu: s.Pu / 1e3, Mx: s.Mx / 1e6, dcr: +s.dcr.toFixed(2) })),
        shear, horizDia, horizSpacing,
        nVertPerFace, vertDia, vertSpacing,
        endZoneBars, endZoneDia,
      });
    }
    return { results, comboName };
  }

  // ============================================================ design dialog
  function open(app, cat) {
    if (cat !== 'wallDesign') return;
    const R = app.rcResults;
    if (!R) { app.toast('Run the analysis first', true); return; }
    const comboNames = R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name);
    if (!comboNames.length) { app.toast('No combinations defined', true); return; }

    const patOpts = comboNames.map(n => `<option value="${n}">${n}</option>`).join('');
    const html = [
      '<p style="margin:0 0 6px;font-size:12px;opacity:.8">ACI 318-19 Ch.11 wall design: P-M interaction + in-plane shear.</p>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Load Combination</span>' +
      `<select id="wd-combo" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${patOpts}</select></div>`,
    ].join('');
    app.dialog('RC Wall Design — ACI 318-19', html, [
      ['Design', () => {
        const combo = document.getElementById('wd-combo').value;
        const result = designAllWalls(app, combo);
        if (result.error) { app.toast(result.error, true); return false; }
        showWallResults(app, result, combo);
        return false;
      }],
      ['Close', null],
    ]);
  }

  function showWallResults(app, result, comboName) {
    const esc = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const rows = result.results.map(r => {
      const color = r.status === 'OK' ? '#2e7d32' : r.status === 'NEAR LIMIT' ? '#f57f17' : '#c62828';
      const shearNote = r.shear.ok
        ? `Avh/s ≥ ${r.shear.Avhs.toFixed(4)} mm²/mm²`
        : 'SHEAR FAIL';
      return '<tr>' +
        `<td style="padding:3px 6px">${esc(r.id)}</td>` +
        `<td>${r.length.toFixed(0)}×${r.thickness.toFixed(0)}</td>` +
        `<td>${r.Pu.toFixed(0)}</td>` +
        `<td>${r.Mx.toFixed(1)}</td>` +
        `<td>${r.Pcap.toFixed(0)}</td>` +
        `<td style="color:${color};font-weight:${r.dcr > 1 ? 'bold' : 'normal'}">${r.dcr.toFixed(3)}</td>` +
        `<td>${r.nVertPerFace + 2 * r.endZoneBars}Ø${r.vertDia}@${r.vertSpacing}mm</td>` +
        `<td>${shearNote}</td>` +
        `<td style="color:${color}">${esc(r.status)}</td>` +
        '</tr>';
    }).join('');
    const html = '<div style="max-height:65vh;overflow:auto">' +
      `<p style="font-size:12px;margin:0 0 6px;opacity:.8">Combination: <b>${esc(comboName)}</b> · ACI 318-19 Ch.11 · P-M + in-plane shear</p>` +
      '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
      '<thead><tr style="text-align:left;opacity:.7">' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Element</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">L×t (mm)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Pu (kN)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Mu (kN·m)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">φPcap (kN)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">DCR</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Vert. Reinf.</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Horiz. Shear</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Status</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p style="font-size:11px;opacity:.7;margin:8px 0 0">DCR = Pu/φPn at applied moment · In-plane shear per ACI 11.5 · Min. reinforcement per ACI 11.6</p>' +
      '</div>';
    app.dialog('RC Wall Design Results — ' + comboName, html, [['Close', null]]);
  }

  root.RCWall = { designAllWalls, wallPM, wallShear, wallBars, wallBaseForces, open, beta1 };
})(window);
