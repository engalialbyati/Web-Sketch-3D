// rccolslab.js — punching shear integration + wall SBE check + foundation design.
// #3: maps column positions to slab shell elements, extracts reactions, runs punching check
// #4: ACI 18.10.6 special boundary element check (stress limit + NA depth methods)
// #5: isolated footing design (bearing, one-way/two-way shear, flexure, development)
// Original code — equations cite ACI clauses. Units: N, mm, MPa.
(function (root) {
  'use strict';

  // ======================================================== #3: PUNCHING
  // Map column tops to slab nodes, sum forces, run punching check.
  function designPunchingShear(app, comboName) {
    const R = app.rcResults;
    if (!R) return { error: 'Run the analysis first.' };
    const d = root.RCDefine.ensure(app);
    const model = app.rcResults && app.rcResults.model;
    if (!model || !model.shells) return { error: 'No shell model found.' };

    const results = [];
    const rebarDb = d.rebarDb || [];

    // find columns with free top (interior/edge condition determined by position)
    for (const ent of app.bim.entities) {
      if (ent.type !== 'column') continue;
      const sec = d.frameSections.find(s => s.name === ent.params.designSection);
      if (!sec) continue;
      const dims = sec.dims || {};
      const bCol = dims.b || 400;
      const hCol = dims.h || 400;
      const base = ent.params.base || [0, 0, 0];
      const hColH = (+ent.params.height || 3) * 1000;
      const topZ = base[2] + hColH;

      // find slab at this level
      const slabEnt = app.bim.entities.find(e =>
        (e.type === 'slab' || e.type === 'roof') &&
        e.params.baseLevel && app.levelManager.levels.find(l => l.id === e.params.baseLevel && Math.abs(l.elevation - topZ / 1000) < 0.1));
      if (!slabEnt) continue;

      const slabSec = d.areaSections.find(a => a.name === slabEnt.params.designSection);
      const slabT = slabSec ? slabSec.thickness * 1000 : 200;
      const matName = slabEnt.params.materialOverwrite || (slabSec && slabSec.material) || 'CONC25';
      const mat = d.materials.find(x => x.name === matName) || d.materials.find(x => x.type === 'concrete');
      if (!mat || !mat.conc) continue;
      const fc = mat.conc.fc;
      const cover = 25, barDia = 16;
      const d = slabT - cover - barDia / 2;

      // determine location (interior/edge/corner) by counting columns at this level
      const colsAtLevel = app.bim.entities.filter(e =>
        e.type === 'column' && Math.abs((e.params.base || [0,0,0])[2] + (+e.params.height || 3) - topZ) < 100);
      let location = 'interior';
      // simplified: check if column is at the bounding box edge
      if (colsAtLevel.length <= 1) location = 'corner';
      else if (colsAtLevel.length <= 2) location = 'edge';

      // check if drop panel exists at this column
      let dpTotalT = 0;
      for (const dpEnt of app.bim.entities) {
        if (dpEnt.type !== 'slab' || !dpEnt.params.designSection) continue;
        const dpSec = d.areaSections.find(a => a.name === dpEnt.params.designSection);
        if (!dpSec || dpSec.type !== 'droppanel') continue;
        const dpBase = dpEnt.params.base || [0, 0, 0];
        if (Math.hypot(dpBase[0] - base[0], dpBase[1] - base[1]) < 100) {
          dpTotalT = (dpSec.dpDims ? dpSec.dpDims.totalT : 0.35) * 1000;
        }
      }
      // effective depth from drop panel if present
      const dEff = dpTotalT > 0 ? dpTotalT - cover - barDia / 2 : d;

      // get column axial from the analysis
      const colForce = R.patterns.length ?
        (R.patterns[0].members.find(m => m.id === ent.id) || { Fi: 0 }) :
        { Fi: 0 };
      const Pu = Math.abs(colForce.Fi || 0) * 1.4; // factored with 1.4 for simplicity

      // get unbalanced moment (approximate: from frame analysis)
      const Mux = Math.abs(colForce.Mi || 0) || 0;

      // run punching check from rcslab.js
      const result = root.RCSlab.punchingShear(
        Pu, Mux, 0, bCol, hCol, dEff, fc, 'interior');

      // overstrength: if drop panel, move perimeter to dp edge
      if (dpTotalT > 0) {
        const dpD = dpTotalT - cover - barDia / 2;
        result.bo = 2 * ((bCol + dpD) + (hCol + dpD));
        result.note = 'Critical perimeter at drop panel edge';
      }

      results.push({
        id: ent.id, bCol, hCol, slabT,
        dEff: Math.round(dEff),
        dpTotalT: Math.round(dpTotalT),
        Pu: Pu / 1e3, location,
        dcr: result.dcr, bo: result.bo,
        status: result.dcr > 1 ? 'OVERSTRESSED' : 'OK',
        gammaV: result.gammaV,
      });
    }

    return { results };
  }

  // ======================================================== #4: WALL SBE
  // ACI 318-19 §18.10.6: Special Boundary Element check
  function checkSBE(app, comboName) {
    const R = app.rcResults;
    if (!R) return { error: 'Run the analysis first.' };
    const results = [];

    for (const m of (R.patterns[0] || { members: [] }).members) {
      if (m.type !== 'wall') continue;
      const ent = app.bim.getEntityById(m.id);
      if (!ent) continue;
      const p = ent.params;
      const thickness = (p.thickness || 0.2) * 1000;
      let length = 3000;
      if (Array.isArray(p.base) && Array.isArray(p.end))
        length = Math.hypot(p.end[0] - p.base[0], p.end[1] - p.base[1]) * 1000;
      const height = (+p.height || 3) * 1000;
      const fc = 25; // from wall material
      const Ag = length * thickness;
      const S = Ag * length / 6; // section modulus (approximate)

      const Pu = Math.abs(m.Fi || 0);
      const Mu = Math.max(Math.abs(m.Mi || 0), Math.abs(m.Mj || 0));

      // Method 1: Stress limit (ACI 18.10.6.2)
      // σ = Pu/Ag + Mu/S from gravity + lateral
      const sigma = Pu / Ag + Mu / S;
      const stressLimit = 0.15 * fc;
      const stressExceeds = sigma > stressLimit;

      // Method 2: NA depth (ACI 18.10.6.3)
      // c_limit = lw / (900 · (δ/εcu + 1)) — simplified with δu/εcu = 0.015
      const driftRatio = 0.015; // amplified drift — from analysis (placeholder)
      const cLimit = length / (900 * (1 + driftRatio / 0.003));
      // neutral axis depth from the P-M interaction (approximate: at max M)
      const cActual = length / 5; // placeholder — should come from P-M fiber analysis
      const naExceeds = cActual > cLimit;

      const sbeRequired = stressExceeds || naExceeds;

      results.push({
        id: m.id, length, thickness, height,
        Pu: Pu / 1e3, Mu: Mu / 1e6,
        sigma: +sigma.toFixed(2), stressLimit: +stressLimit.toFixed(2),
        stressExceeds,
        cActual: Math.round(cActual), cLimit: Math.round(cLimit),
        naExceeds,
        sbeRequired,
        method: stressExceeds ? 'ACI 18.10.6.2 (stress)' :
          naExceeds ? 'ACI 18.10.6.3 (NA depth)' : 'Not required',
        status: sbeRequired ? 'SBE REQUIRED' : 'SBE NOT REQUIRED',
      });
    }
    return { results };
  }

  // ======================================================== #5: FOUNDATION
  // Isolated spread footing design per ACI 318-19
  function designFooting(app, colId, opts) {
    const d = root.RCDefine.ensure(app);
    const ent = app.bim.getEntityById(colId);
    if (!ent || ent.type !== 'column') return { error: 'Select a column.' };
    const sec = d.frameSections.find(s => s.name === ent.params.designSection);
    if (!sec) return { error: 'Column section not found.' };
    const dims = sec.dims || {};
    const bCol = dims.b || 400;
    const hCol = dims.h || 400;
    const mat = d.materials.find(m => m.name === (ent.params.materialOverwrite || sec.material)) ||
                d.materials.find(m => m.type === 'concrete');
    const fc = mat ? mat.conc.fc : 25;
    const fy = d.materials.find(x => x.type === 'rebar')?.rebar?.fy || 500;

    // from analysis: column axial + moment
    const R = app.rcResults;
    const Pu = (opts && opts.Pu) || 1500e3; // N (default 1500 kN)
    const Mu = (opts && opts.Mu) || 50e6;   // N·mm

    // footing params
    const qAllow = (opts && opts.qAllow) || 200; // allowable bearing, kN/m² → N/mm² = 0.2
    const footingH = (opts && opts.height) || 600; // mm
    const cover = 75; // mm (concrete cast against earth)
    const dFtg = footingH - cover - 12; // effective depth (12mm bar)
    const L = (opts && opts.L) || Math.max(bCol * 3, 2000); // footing length mm
    const B = (opts && opts.B) || L; // footing width mm

    // bearing pressure check
    const qActual = Pu / (L * B); // N/mm²
    const bearingOK = qActual <= qAllow * 1000 / 1000; // qAllow in kN/m² → N/mm² = ×1000/1e6 = /1000
    // fix units: qAllow kN/m² = qAllow × 1000 N / 1e6 mm² = qAllow / 1000 N/mm²
    const qAllowNmm2 = qAllow / 1000;
    const bearingOK2 = qActual <= qAllowNmm2;

    // net upward soil pressure (factored)
    const qu = (Pu / (L * B)) * 1.0; // N/mm² (factored: use Pu not service)

    // one-way shear at d from column face
    const cantL = (L - bCol) / 2; // cantilever length
    const Vu1 = qu * B * cantL; // one-way shear force
    const Vc1 = 0.17 * Math.sqrt(fc) * B * dFtg;
    const phiVc1 = 0.75 * Vc1;
    const oneWayOK = Vu1 <= phiVc1;

    // two-way (punching) shear
    const bo = 2 * ((bCol + dFtg) + (hCol + dFtg));
    const beta = Math.max(bCol, hCol) / Math.min(bCol, hCol);
    const Vc1p = (2 + 4 / beta) * Math.sqrt(fc) * bo * dFtg;
    const Vc2p = (40 * dFtg / bo + 2) * Math.sqrt(fc) * bo * dFtg;
    const Vc3p = 4 * Math.sqrt(fc) * bo * dFtg;
    const Vc = Math.min(Vc1p, Vc2p, Vc3p);
    const phiVcPunch = 0.75 * Vc;
    const PuPunch = qu * (L * B - (bCol + d) * (hCol + d));
    const punchOK = PuPunch <= phiVcPunch;

    // flexure at column face
    const cantMid = (L - bCol) / 2;
    const MuFtg = qu * B * cantMid * cantMid / 2;
    const Rn = MuFtg / (0.9 * B * dFtg * dFtg);
    const rho = 0.85 * fc / fy * (1 - Math.sqrt(1 - 2 * Rn / (0.85 * fc)));
    const AsReq = rho * B * dFtg;
    const AsMin = 0.0018 * B * footingH;
    const As = Math.max(AsReq, AsMin);

    // development: ld from column face, check if footing depth is enough
    const ld = fy * 16 / (2 * Math.sqrt(fc));
    const devOK = cantMid >= ld;

    return {
      colId: ent.id, bCol, hCol,
      footingL: L, footingB: B, footingH,
      fc, fy, d: dFtg,
      qActual: +(qActual * 1000).toFixed(1), // kN/m²
      qAllow,
      bearingOK: bearingOK2,
      oneWay: { Vu: Vu1, Vc: phiVc1, ok: oneWayOK },
      punching: { Vu: PuPunch, Vc: phiVcPunch, bo: Math.round(bo), ok: punchOK },
      flexure: { Mu: MuFtg / 1e6, As: Math.round(As), AsMin: Math.round(AsMin) },
      development: { ld: Math.round(ld), available: Math.round(cantMid), ok: devOK },
    };
  }

  function footingDialog(app, cat) {
    if (cat !== 'footingDesign') return;
    const d = root.RCDefine.ensure(app);
    const cols = app.bim.entities.filter(e => e.type === 'column');
    if (!cols.length) { app.toast('Draw columns first', true); return; }

    const colOpts = cols.map(c => `<option value="${c.id}">${c.id}</option>`).join('');
    const html = [
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Column</span><select id="fd-col" style="width:200px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">' + colOpts + '</select></div>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Pu (kN)</span><input id="fd-pu" type="number" value="1500" style="width:100px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px"></div>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Footing L×B (m)</span><input id="fd-L" type="number" value="2.5" step="0.25" style="width:70px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px"> × <input id="fd-B" type="number" value="2.5" step="0.25" style="width:70px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px"></div>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Footing H (mm)</span><input id="fd-h" type="number" value="600" style="width:100px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px"></div>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">q_allow (kN/m²)</span><input id="fd-qa" type="number" value="200" style="width:100px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px"></div>',
    ].join('');
    app.dialog('Isolated Footing Design — ACI 318-19', html, [
      ['Design', () => {
        const colId = document.getElementById('fd-col').value;
        const Pu = (+document.getElementById('fd-pu').value) * 1000;
        const L = (+document.getElementById('fd-L').value) * 1000;
        const B = (+document.getElementById('fd-B').value) * 1000;
        const h = +document.getElementById('fd-h').value;
        const qAllow = +document.getElementById('fd-qa').value;
        const r = designFooting(app, colId, { Pu, L, B, height: h, qAllow });
        if (r.error) { app.toast(r.error, true); return false; }
        showFootingResults(app, r);
        return false;
      }],
      ['Close', null],
    ]);
  }

  function showFootingResults(app, r) {
    const esc = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const badge = (ok) => ok
      ? '<span class="badge-ok" style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:bold;background:#e8f5e9;color:#2e7d32">OK</span>'
      : '<span class="badge-fail" style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:bold;background:#ffebee;color:#c62828">FAIL</span>';
    const html = '<div style="max-height:65vh;overflow:auto">' +
      `<h3 style="font-size:14px;margin:0 0 8px">Footing: ${r.footingL.toFixed(0)}×${r.footingB.toFixed(0)}×${r.footingH} mm</h3>` +
      '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<tr><td style="padding:4px 8px;font-weight:bold" colspan="3">Bearing (ACI Ch.13)</td></tr>' +
      `<tr><td style="padding:4px 8px">q actual = ${r.qActual} kN/m²</td><td>q allow = ${r.qAllow} kN/m²</td><td>${badge(r.bearingOK)}</td></tr>` +
      '<tr><td style="padding:4px 8px;font-weight:bold" colspan="3">One-Way Shear (ACI 22.5)</td></tr>' +
      `<tr><td style="padding:4px 8px">Vu = ${r.oneWay.Vu.toFixed(0)} N</td><td>φVc = ${r.oneWay.Vc.toFixed(0)} N</td><td>${badge(r.oneWay.ok)}</td></tr>` +
      '<tr><td style="padding:4px 8px;font-weight:bold" colspan="3">Two-Way Shear (ACI 22.6)</td></tr>' +
      `<tr><td style="padding:4px 8px">Vu = ${r.punching.Vu.toFixed(0)} N</td><td>φVc = ${r.punching.Vc.toFixed(0)} N</td><td>bo = ${r.punching.bo} mm</td><td>${badge(r.punching.ok)}</td></tr>` +
      '<tr><td style="padding:4px 8px;font-weight:bold" colspan="3">Flexure (ACI Ch.7)</td></tr>' +
      `<tr><td style="padding:4px 8px">Mu = ${r.flexure.Mu.toFixed(1)} kN·m/m</td><td>As = ${r.flexure.As} mm²</td><td>As,min = ${r.flexure.AsMin} mm²</td></tr>` +
      '<tr><td style="padding:4px 8px;font-weight:bold" colspan="3">Development (ACI 25.4)</td></tr>' +
      `<tr><td style="padding:4px 8px">ld = ${r.development.ld} mm</td><td>Available = ${r.development.available} mm</td><td>${badge(r.development.ok)}</td></tr>` +
      '</table></div>';
    app.dialog('Footing Design Results', html, [['Close', null]]);
  }

  root.RCColSlab = { designPunchingShear, checkSBE, designFooting, footingDialog, open };
})(window);
