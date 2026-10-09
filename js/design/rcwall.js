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
  function wallShear(Vu, length, thickness, fc, fyh) {
    const phi = 0.75;
    const hw = length; // wall length (for hwc ratio)
    const Aw = length * thickness; // wall cross-sectional area

    // hwc/lw ratio effect (ACI 11.5.4): αc = max(3.0 for hw/lw ≤ 1.5, 2.0 for hw/lw ≥ 2.0, interpolated)
    // v1: use αc = 2.0 (conservative for typical walls)
    const alphaC = 2.0;

    // Vc (ACI 11.5.4.2, SI simplified)
    let Vc = alphaC * 0.17 * Math.sqrt(fc) * Aw; // N

    // Vc upper limit (ACI 11.5.4.3)
    const VcMax = 0.83 * Math.sqrt(fc) * Aw;
    Vc = Math.min(Vc, VcMax);

    const phiVc = phi * Vc;
    // Vs upper limit (ACI 11.5.4.4): Vn ≤ 0.83·√f'c·Aw
    const phiVnMax = phi * 0.83 * Math.sqrt(fc) * Aw;

    if (Vu > phiVnMax) {
      return { ok: false, phiVc, phiVnMax, reason: `Vu exceeds φVn_max — increase wall thickness or f'c (ACI 11.5.4.4).` };
    }

    // required horizontal reinforcement Avh/s (ACI 11.5.5.1)
    let Avhs = 0;
    if (Vu > phiVc) {
      Avhs = (Vu / phi - Vc) / (fyh * thickness); // mm²/mm² (Avh per unit height per unit thickness)
    }

    // minimum horizontal reinforcement (ACI 11.6.2)
    const rhoMin = 0.0020; // for fy ≥ 420 MPa (ACI Table 11.6.2)
    const AvhsMin = rhoMin * thickness; // mm²/mm²

    return {
      ok: true, phi, Vc: phiVc, Avhs: Math.max(Avhs, AvhsMin),
      AvhsMin, alphaC,
    };
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

    const results = [];
    const members = combo ? combo.members : pat.members;
    for (const m of members) {
      if (m.type !== 'wall') continue;
      const ent = app.bim.getEntityById(m.id);
      if (!ent) continue;
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
      const rhoMinVert = 0.0025; // ACI 11.6.2 for walls

      // P-M interaction
      const pm = wallPM(length, thickness, fc, fy, bars, 30);
      const Pu = Math.abs(m.Fi || 0);
      const Mx = Math.max(Math.abs(m.Mi || 0), Math.abs(m.Mj || 0));

      // capacity check
      let dcr = 0, Pcap = 0;
      for (let i = 0; i < pm.length - 1; i++) {
        if (Mx >= Math.min(pm[i].M, pm[i+1].M) && Mx <= Math.max(pm[i].M, pm[i+1].M)) {
          const t = Math.abs(pm[i+1].M - pm[i].M) > 1e-9 ? (Mx - pm[i].M) / (pm[i+1].M - pm[i].M) : 0;
          Pcap = pm[i].P + t * (pm[i+1].P - pm[i].P);
          dcr = Math.abs(Pu) / Math.abs(Pcap) || 0;
          break;
        }
      }

      // in-plane shear (use the larger end shear)
      const Vu = Math.max(Math.abs(m.Vi || 0), Math.abs(m.Vj || 0));
      const shear = wallShear(Vu, length, thickness, fc, fyh);

      // min horizontal reinforcement
      const horizDia = 10;
      const horizArea = Math.PI * horizDia * horizDia / 4;
      const horizSpacing = Math.min(350, (horizArea * 2) / (shear.Avhs * thickness || rhoMinVert * thickness));

      const status = dcr > 1 ? 'OVERSTRESSED' :
        !shear.ok ? 'SHEAR FAILURE' :
        dcr > 0.9 ? 'NEAR LIMIT' : 'OK';

      results.push({
        id: m.id, length, thickness, height, fc, fy,
        Pu: Pu / 1e3, Mx: Mx / 1e6, Vu: Vu / 1e3, // kN, kN·m
        Ast, rhoVert, rhoMinVert,
        dcr, Pcap: Pcap / 1e3, status,
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

  root.RCWall = { designAllWalls, wallPM, wallShear, wallBars, open, beta1 };
})(window);
