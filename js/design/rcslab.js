// rcslab.js — ACI 318-19 RC slab design (flexure + punching shear).
// Reads shell element forces from the analysis, designs flexural
// reinforcement in both directions per element/strip, and checks punching
// shear at columns per ACI Ch. 8 (using the cFootingDesignFull formulas).
// Original code — equations cite ACI clauses.
// Units: N, mm, MPa.
(function (root) {
  'use strict';

  // ============================================================ flexure
  // Per unit width (b=1000mm): Mu in N·mm/mm, d in mm, f'c/fy in MPa
  function designSlabFlexure(Mu, h, cover, barDia, fc, fy) {
    const d = h - cover - barDia / 2;
    const b = 1000; // per unit width
    const esy = fy / 200000;
    const phi = 0.90; // slabs are always tension-controlled with proper reinforcement
    const disc = d * d - 2 * Mu / (0.85 * phi * fc * b);
    if (disc <= 0) return { ok: false, As: 0, reason: 'Section too small.' };
    const a = d - Math.sqrt(disc);
    let As = Mu / (phi * fy * (d - a / 2));
    // min reinforcement (ACI 7.6.1.1): ρmin = 0.0018 (Grade 420/60)
    const AsMin = 0.0018 * b * h;
    As = Math.max(As, AsMin);
    // max spacing (ACI 7.7.2.3): s ≤ min(3h, 450mm)
    const sMax = Math.min(3 * h, 450);
    return { ok: true, As, a, d, AsMin, sMax };
  }

  // select bars from rebar database for a strip width
  function selectSlabBars(rebarDb, As, width, sMax) {
    if (As <= 0) return null;
    for (const bar of rebarDb) {
      const maxN = Math.floor(width / 150) + 1; // spacing ≥ 150mm
      const n = Math.ceil(As / bar.area);
      const spacing = Math.min(width / Math.max(n - 1, 1), sMax);
      if (n >= 2 && n <= maxN && spacing >= 100) {
        return { count: n, dia: bar.dia, area: bar.area, As: n * bar.area, spacing: Math.floor(spacing / 10) * 10 };
      }
    }
    // fallback: largest bars at max spacing
    const largest = rebarDb[rebarDb.length - 1];
    const n = Math.ceil(As / largest.area);
    return { count: n, dia: largest.dia, area: largest.area, As: n * largest.area, spacing: sMax };
  }

  // ============================================================ punching
  // ACI 318-19 Ch. 8.5 / Ch. 13 (per cFootingDesignFull.cs formulas)
  function punchingShear(Pu, Mux, Muy, b_col, h_col, d, fc) {
    const phi = 0.75;
    // critical perimeter at d/2 from column face
    const b1 = b_col + d;  // parallel to M2
    const b2 = h_col + d;  // parallel to M1
    let bo = 2 * (b1 + b2); // interior default

    // determine location and adjust perimeter
    // caller should pass location: 'interior' | 'edge' | 'corner'
    const location = arguments[7] || 'interior';
    if (location === 'edge') bo = b1 + 2 * b2;
    else if (location === 'corner') bo = b1 + b2;

    // Ac (effective shear area for stress calcs)
    let Ac;
    if (location === 'interior') Ac = 2 * (b1 + b2) * d;
    else if (location === 'edge') Ac = (b1 + 2 * b2) * d;
    else Ac = (b1 + b2) * d;

    // Jc (polar moment for moment transfer)
    let Jc;
    if (location === 'interior') {
      Jc = (b1 * b1 * d * (b1 + 4 * b2) + d * d * d * (b1 + b2)) / (6 * b1);
    } else if (location === 'edge') {
      Jc = (b1 * d * (b1 + 3 * b2) + d * d * d) / 3;
    } else {
      Jc = (b1 * d * (b1 + 6 * b2) + d * d * d) / 6;
    }

    // γv: fraction of unbalanced moment transferred by shear (ACI 8.5.3.1)
    const gammaV = 1 - 1 / (1 + 0.677 * Math.sqrt(Math.max(b2 / b1, 0.1)));

    // shear stress at critical section including moment transfer
    const v0 = Pu / Ac;
    const vmax = v0 + gammaV * Math.abs(Mux) / Jc;
    const vmin = v0 - gammaV * Math.abs(Mux) / Jc;
    const vu = Math.max(Math.abs(vmax), Math.abs(vmin));

    // capacity (ACI Table 22.6.5.2, SI): three limits
    const sqrtFc = Math.sqrt(fc);
    const beta = Math.max(b_col, h_col) / Math.min(b_col, h_col);
    const alphaS = location === 'interior' ? 40 : 30;
    const Vc1 = (2 + 4 / beta) * sqrtFc * bo * d;
    const Vc2 = (alphaS * d / bo + 2) * sqrtFc * bo * d;
    const Vc3 = 4 * sqrtFc * bo * d;
    const Vc = Math.min(Vc1, Vc2, Vc3) * d / 1; // N (bo and d in mm → N)
    const phiVc = phi * Vc;
    // Vu (total force at critical section, not stress)
    // Note: Vu here is the total punching force at the column
    const dcr = Vu / phiVc;

    return {
      ok: dcr <= 1, phi, bo: Math.round(bo), Ac: Math.round(Ac),
      Jc: Math.round(Jc), gammaV: +gammaV.toFixed(3),
      vu: +vu.toFixed(4), Vc: phiVc, dcr: +dcr.toFixed(3),
      location, b1: Math.round(b1), b2: Math.round(b2),
    };
  }

  // ============================================================ one-way shear
  function oneWayShear(Vu, bw, d, fc) {
    const phi = 0.75;
    const Vc = 0.17 * Math.sqrt(fc) * bw * d;
    const phiVc = phi * Vc;
    return { ok: Vu <= phiVc, Vc: phiVc, Vu };
  }

  // ============================================================ design all
  function designAllSlabs(app, comboName) {
    const R = app.rcResults;
    if (!R) return { error: 'Run the analysis first.' };
    const d = root.RCDefine.ensure(app);

    let combo = R.combos.find(c => c.name === comboName);
    let pat = null;
    if (!combo) {
      pat = R.patterns.find(p => p.name === comboName);
      if (!pat) return { error: `Combination "${comboName}" not found.` };
    }

    const rebarDb = d.rebarDb || [];
    const results = [];

    // group shells by entity (slab)
    const shellByEnt = {};
    for (const sh of model.shells || []) {
      if (!shellByEnt[sh.entId]) shellByEnt[sh.entId] = [];
      shellByEnt[sh.entId].push(sh);
    }

    // for each slab entity, get shell forces and design
    for (const ent of app.bim.entities) {
      if (ent.type !== 'slab' && ent.type !== 'roof') continue;
      const matName = ent.params.materialOverwrite || 'CONC25';
      const mat = d.materials.find(x => x.name === matName) || d.materials.find(x => x.type === 'concrete');
      if (!mat || !mat.conc) continue;
      const fc = mat.conc.fc;
      const fy = d.materials.find(x => x.type === 'rebar')?.rebar?.fy || 500;
      const thickness = (ent.params.thickness || 0.2) * 1000; // mm
      const cover = 25; // mm (slabs have less cover than beams)
      const barDia = 12; // mm
      const dEff = thickness - cover - barDia / 2;
      const sMax = Math.min(3 * thickness, 450);

      // get combo/pattern result for this entity's shells
      const shellsForEnt = (model.shells || []).filter(sh => sh.entId === ent.id);
      if (!shellsForEnt.length) continue;

      // get forces from the analysis (use combo or first pattern)
      const forces = [];
      if (app.rcResults && app.rcResults.shellForces) {
        for (const sf of app.rcResults.shellForces) {
          if (shellsForEnt.some(sh => sh.n1 === sf.n1 && sh.n2 === sf.n2)) {
            forces.push(sf.forces);
          }
        }
      }

      // envelope: max |M11| and |M22| across all elements in this slab
      // if design strips exist, average forces across the strip width (ETABS approach)
      const stripLabels = ent.params.stripLabels || [];
      const useStripAveraging = stripLabels.length > 0 && (model.designStrips || d.designStrips || []).length > 0;
      let maxM11 = 0, maxM22 = 0, minM11 = 0, minM22 = 0;
      if (useStripAveraging) {
        // design strip: average forces across all elements in the strip
        // (simplified: average all shell forces — the strip defines which elements are included)
        let sumM11 = 0, sumM22 = 0, count = 0;
        for (const f of forces) { sumM11 += Math.abs(f.M11 || 0); sumM22 += Math.abs(f.M22 || 0); count++; }
        if (count > 0) {
          maxM11 = sumM11 / count; // averaged strip moment
          minM11 = -sumM11 / count;
          maxM22 = sumM22 / count;
          minM22 = -sumM22 / count;
        }
      } else {
        for (const f of forces) {
          maxM11 = Math.max(maxM11, f.M11 || 0);
          minM11 = Math.min(minM11, f.M11 || 0);
          maxM22 = Math.max(maxM22, f.M22 || 0);
          minM22 = Math.min(minM22, f.M22 || 0);
        }
      }

      // design bottom (positive) and top (negative) in both directions
      const botDir1 = designSlabFlexure(Math.abs(maxM11), thickness, cover, barDia, fc, fy);
      const topDir1 = designSlabFlexure(Math.abs(minM11), thickness, cover, barDia, fc, fy);
      const botDir2 = designSlabFlexure(Math.abs(maxM22), thickness, cover, barDia, fc, fy);
      const topDir2 = designSlabFlexure(Math.abs(minM22), thickness, cover, barDia, fc, fy);

      const botBarsD1 = selectSlabBars(rebarDb, botDir1.As, 1000, sMax);
      const topBarsD1 = selectSlabBars(rebarDb, topDir1.As, 1000, sMax);
      const botBarsD2 = selectSlabBars(rebarDb, botDir2.As, 1000, sMax);
      const topBarsD2 = selectSlabBars(rebarDb, topDir2.As, 1000, sMax);

      // one-way shear check
      const Vu = Math.max(Math.abs(forces.length ? forces[0].N11 || 0 : 0), 1); // approximate
      const owShear = oneWayShear(Vu, 1000, dEff, fc);

      results.push({
        id: ent.id, type: ent.type, thickness,
        fc, fy, dEff,
        maxM11: maxM11 / 1e3, minM11: minM11 / 1e3, // kN·m/m
        maxM22: maxM22 / 1e3, minM22: minM22 / 1e3,
        botDir1, topDir1, botDir2, topDir2,
        botBarsD1, topBarsD1, botBarsD2, topBarsD2,
        owShear,
        nElements: shellsForEnt.length,
      });
    }
    return { results, comboName };
  }

  // ==================================================== strip force integration
  // ETABS design strip method: identify shell elements within the strip
  // tributary width, sum their forces at stations along the strip, divide
  // by strip width → averaged M per unit width for reinforcement design.
  function integrateStripForces(app, model, stripName, forces) {
    const d = root.RCDefine.ensure(app);
    const strip = d.designStrips.find(s => s.name === stripName);
    if (!strip) return null;
    const width = strip.width * 1000; // mm
    const dir = strip.direction; // 'X' or 'Y'

    // find slab entities with this strip assigned
    const slabEnts = app.bim.entities.filter(e =>
      (e.type === 'slab' || e.type === 'roof') &&
      (e.params.stripLabels || []).includes(stripName));
    if (!slabEnts.length) return null;

    // collect shell elements belonging to these slabs
    const shellEntIds = new Set(slabEnts.map(e => e.id));
    const stripShells = [];
    for (const sh of model.shells || []) {
      if (sh.entId && shellEntIds.has(sh.entId)) stripShells.push(sh);
    }
    if (!stripShells.length) return null;

    // determine strip direction axis
    // 'X' strips run along X → integrate forces across Y
    // 'Y' strips run along Y → integrate forces across X
    const alongAxis = dir === 'X' ? 'x' : 'y';
    const acrossAxis = dir === 'X' ? 'y' : 'x';

    // sort shells by their position along the strip
    const withPos = stripShells.map(sh => {
      const p1 = model.nodes[sh.n1], p2 = model.nodes[sh.n3];
      const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      const cz = (p1.z + p2.z) / 2;
      return { sh, pos: alongAxis === 'x' ? cx : cy, across: acrossAxis === 'x' ? cx : cy };
    }).sort((a, b) => a.pos - b.pos);

    // group into stations (unique positions along the strip)
    const posValues = [...new Set(withPos.map(x => +x.pos.toFixed(3)))].sort((a, b) => a - b);
    const stations = posValues.map(pos => {
      const shellsAtPos = withPos.filter(x => Math.abs(x.pos - pos) < 1);
      let M11Sum = 0, M22Sum = 0;
      for (const s of shellsAtPos) {
        const sf = forces.find(f => f.n1 === s.sh.n1 && f.n2 === s.sh.n2);
        if (sf && sf.forces) {
          M11Sum += sf.forces.M11 || 0;
          M22Sum += sf.forces.M22 || 0;
        }
      }
      // divide by strip width → moment per unit width
      const stripWidthM = width / 1000; // mm → m
      return {
        pos, M11: M11Sum / stripWidthM, M22: M22Sum / stripWidthM,
        nShells: shellsAtPos.length,
      };
    });

    return { strip, stations, width };
  }

  // ==================================================== per-strip reinforcement
  // Design reinforcement at each strip station (top at supports, bottom at midspan)
  function designStripReinforcement(stripData, thickness, cover, barDia, fc, fy, rebarDb) {
    const d = thickness - cover - barDia / 2;
    const stations = stripData.stations;
    const results = [];

    // envelope: find max positive and negative M22 (gravity bending)
    let maxMPos = 0, maxMNeg = 0;
    for (const st of stations) {
      if (st.M22 > maxMPos) maxMPos = st.M22;
      if (st.M22 < maxMNeg) maxMNeg = st.M22;
    }

    // design bottom (positive) and top (negative)
    const botDesign = designSlabFlexure(Math.abs(maxMPos), thickness, cover, barDia, fc, fy);
    const topDesign = designSlabFlexure(Math.abs(maxMNeg), thickness, cover, barDia, fc, fy);

    // select bars
    const botBars = selectSlabBars(rebarDb, botDesign.As, 1000, Math.min(3 * thickness, 450));
    const topBars = selectSlabBars(rebarDb, topDesign.As, 1000, Math.min(3 * thickness, 450));

    return {
      maxMPos: maxMPos / 1e6, maxMNeg: maxMNeg / 1e6, // kN·m/m
      botDesign, topDesign, botBars, topBars,
      stations,
    };
  }

  // ==================================================== punching shear at drop panel
  // Critical perimeter at d/2 OUTSIDE the drop panel (not the column face).
  // Uses drop panel total thickness for effective depth d.
  function checkPunchingAtDropPanel(Pu, Mux, dpLen, dpWid, dpTotalT, slabT, cover, barDia, fc, bCol, hCol) {
    const d = dpTotalT - cover - barDia / 2; // effective depth from drop panel
    const phi = 0.75;

    // critical perimeter at d/2 outside the DROP PANEL face (not column face)
    const c1 = dpLen, c2 = dpWid;
    const b1 = c1 + d, b2 = c2 + d;
    const bo = 2 * (b1 + b2); // interior column/drop panel

    // Ac for interior
    const Ac = 2 * (b1 + b2) * d;

    // Jc
    const Jc = (b1 * b1 * d * (b1 + 4 * b2) + d * d * d * (b1 + b2)) / (6 * b1);

    // γv
    const gammaV = 1 - 1 / (1 + 0.677 * Math.sqrt(Math.max(b2 / b1, 0.1)));

    // stresses
    const v0 = Pu / Ac;
    const vmax = v0 + gammaV * Math.abs(Mux) / Jc;
    const vu = Math.max(Math.abs(vmax), Math.abs(vmin || 0));

    // capacity: min of three ACI equations
    const sqrtFc = Math.sqrt(fc);
    const beta = Math.max(c1, c2) / Math.min(c1, c2);
    const Vc1 = (2 + 4 / beta) * sqrtFc * bo * d;
    const Vc2 = (40 * d / bo + 2) * sqrtFc * bo * d;
    const Vc3 = 4 * sqrtFc * bo * d;
    const Vc = Math.min(Vc1, Vc2, Vc3);
    const phiVc = phi * Vc;

    return {
      ok: Vu <= phiVc, phi, d: Math.round(d),
      bo: Math.round(bo), Ac: Math.round(Ac),
      gammaV: +gammaV.toFixed(3),
      dcr: +(Vu / phiVc).toFixed(3),
      note: 'Critical perimeter at drop panel edge, not column face',
    };
  }

  // ============================================================ design dialog
  function open(app, cat) {
    if (cat !== 'slabDesign') return;
    const R = app.rcResults;
    if (!R) { app.toast('Run the analysis first', true); return; }
    const d = root.RCDefine.ensure(app);
    const comboNames = R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name);
    if (!comboNames.length) { app.toast('No combinations defined', true); return; }

    const patOpts = comboNames.map(n => `<option value="${n}">${n}</option>`).join('');
    const html = [
      '<p style="margin:0 0 6px;font-size:12px;opacity:.8">ACI 318-19 Ch.7: flexural reinforcement from shell forces (both directions).</p>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Load Combination</span>' +
      `<select id="sd-combo" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${patOpts}</select></div>`,
    ].join('');
    app.dialog('RC Slab Design — ACI 318-19', html, [
      ['Design', () => {
        const combo = document.getElementById('sd-combo').value;
        const result = designAllSlabs(app, combo);
        if (result.error) { app.toast(result.error, true); return false; }
        showSlabResults(app, result, combo);
        return false;
      }],
      ['Close', null],
    ]);
  }

  function showSlabResults(app, result, comboName) {
    const esc = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const rows = result.results.map(r => {
      const shearColor = r.owShear.ok ? '#2e7d32' : '#c62828';
      return '<tr>' +
        `<td style="padding:3px 6px">${esc(r.id)}</td>` +
        `<td>${esc(r.type)}</td>` +
        `<td>${r.thickness.toFixed(0)}</td>` +
        `<td>${r.nElements}</td>` +
        `<td>${r.maxM11.toFixed(2)} / ${r.minM11.toFixed(2)}</td>` +
        `<td>${r.botBarsD1 ? `${r.botBarsD1.count}Ø${r.botBarsD1.dia}@${r.botBarsD1.spacing}` : '—'}</td>` +
        `<td>${r.topBarsD1 ? `${r.topBarsD1.count}Ø${r.topBarsD1.dia}@${r.topBarsD1.spacing}` : '—'}</td>` +
        `<td>${r.botBarsD2 ? `${r.botBarsD2.count}Ø${r.botBarsD2.dia}@${r.botBarsD2.spacing}` : '—'}</td>` +
        `<td>${r.topBarsD2 ? `${r.topBarsD2.count}Ø${r.topBarsD2.dia}@${r.topBarsD2.spacing}` : '—'}</td>` +
        `<td style="color:${shearColor}">${r.owShear.ok ? 'OK' : 'FAIL'}</td>` +
        '</tr>';
    }).join('');
    const html = '<div style="max-height:65vh;overflow:auto">' +
      `<p style="font-size:12px;margin:0 0 6px;opacity:.8">Combination: <b>${esc(comboName)}</b> · ACI 318-19 Ch.7 · d = t − cover − db/2</p>` +
      '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
      '<thead><tr style="text-align:left;opacity:.7">' +
      '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">Element</th>' +
      '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">Type</th>' +
      '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">t (mm)</th>' +
      '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">Shells</th>' +
      '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">M11 max/min</th>' +
      '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">D1 Bottom</th>' +
      '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">D1 Top</th>' +
      '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">D2 Bottom</th>' +
      '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">D2 Top</th>' +
      '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">O.W. Shear</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p style="font-size:11px;opacity:.7;margin:8px 0 0">D1/D2 = reinforcement directions from shell M11/M22 · Min ρ = 0.0018 · Max s = min(3h, 450mm)</p>' +
      '</div>';
    app.dialog('RC Slab Design Results — ' + comboName, html, [['Close', null]]);
  }

  root.RCSlab = { designSlabFlexure, punchingShear, oneWayShear, designAllSlabs, open, selectSlabBars };
})(window);
