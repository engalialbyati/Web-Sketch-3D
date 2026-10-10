// rccolslab.js — punching shear integration + wall SBE check + foundation design.
// Punching: column combo forces → slab shells at the column top, drop-panel-aware d.
// SBE: ACI 318-19 §18.10.6 (stress limit + NA depth) from wall shell membranes.
// Foundation: isolated footing (bearing, one-way/two-way shear, flexure, development).
// Original code — equations cite ACI clauses. Units: N, mm, MPa.
(function (root) {
  'use strict';

  // source = R.combos entry or R.patterns entry, by name
  function srcForces(app, comboName) {
    const R = app.rcResults;
    if (!R) return { error: 'Run the analysis first.' };
    return {
      R,
      src: R.combos.find(c => c.name === comboName) || R.patterns.find(p => p.name === comboName),
    };
  }

  // ======================================================== PUNCHING
  // Column combo forces → slab shells at the column top → punching check.
  function designPunchingShear(app, comboName) {
    const { R, src, error } = srcForces(app, comboName);
    if (error) return { error };
    if (!src) return { error: `Combination "${comboName}" not found.` };
    const model = R.model;
    if (!model || !model.shells || !model.shells.length)
      return { error: 'No shell model — re-run the analysis.' };
    const d = root.RCDefine.ensure(app);
    const nd = model.nodes;
    const results = [];

    for (const ent of app.bim.entities) {
      if (ent.type !== 'column') continue;
      const sec = d.frameSections.find(s => s.name === ent.params.designSection);
      if (!sec) continue;
      const dims = sec.dims || {};
      const bCol = (dims.b || 0.4) * 1000; // m → mm
      const hCol = (dims.h || 0.4) * 1000;
      const base = ent.params.base || [0, 0, 0];
      const colH = +ent.params.height || 3;   // meters (BIM units, like node z)
      const topZ = base[2] + colH;            // meters
      const cx = base[0], cy = base[1];

      // slab shells sitting on the column top (node z ≈ topZ)
      const atTop = [];
      for (const sh of model.shells) {
        const zs = [nd[sh.n1].z, nd[sh.n2].z, nd[sh.n3].z, nd[sh.n4].z];
        if (zs.every(z => Math.abs(z - topZ) < 1e-4)) atTop.push(sh);
      }
      if (!atTop.length) continue; // no slab bearing on this column
      const slabEntId = atTop[0].entId;
      const slabEnt = app.bim.getEntityById(slabEntId);
      if (!slabEnt) continue;

      // effective depth: thickest shell within one column dimension of the
      // column center — catches drop panels without extra bookkeeping
      let tAtCol = 0;
      for (const sh of atTop) {
        const cxSh = (nd[sh.n1].x + nd[sh.n3].x) / 2, cySh = (nd[sh.n1].y + nd[sh.n3].y) / 2;
        if (Math.hypot(cxSh - cx, cySh - cy) <= Math.max(bCol, hCol) / 1000 * 1.5)
          tAtCol = Math.max(tAtCol, sh.t);
      }
      if (!tAtCol) tAtCol = atTop[0].t;
      const hasDP = tAtCol > atTop[0].t + 1e-6;

      const slabSec = d.areaSections.find(a => a.name === slabEnt.params.designSection);
      const matName = slabEnt.params.materialOverwrite || (slabSec && slabSec.material) || 'CONC25';
      const mat = d.materials.find(x => x.name === matName) || d.materials.find(x => x.type === 'concrete');
      if (!mat || !mat.conc) continue;
      const fc = mat.conc.fc;
      const cover = 25, barDia = 16;
      const dEff = tAtCol - cover - barDia / 2;

      // interior/edge/corner from distance to the slab polygon bbox
      const allSh = model.shells.filter(s => s.entId === slabEntId);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const sh of allSh) for (const ni of [sh.n1, sh.n2, sh.n3, sh.n4]) {
        x0 = Math.min(x0, nd[ni].x); x1 = Math.max(x1, nd[ni].x);
        y0 = Math.min(y0, nd[ni].y); y1 = Math.max(y1, nd[ni].y);
      }
      const edgeTol = Math.max(bCol, hCol) / 1000 / 2;   // meters
      const dL = cx - x0, dR = x1 - cx, dB = cy - y0, dT = y1 - cy;
      const near = k => k <= edgeTol;
      const location = (near(dL) && near(dB)) || (near(dL) && near(dT)) ||
        (near(dR) && near(dB)) || (near(dR) && near(dT)) ? 'corner' :
        (near(dL) || near(dR) || near(dB) || near(dT)) ? 'edge' : 'interior';

      // column forces from the selected combination
      const m = (src.members || []).find(x => x.id === ent.id);
      const Pu = m ? Math.max(Math.abs(m.Fi || 0), Math.abs(m.Fj || 0)) : 0; // N
      const Mux = m ? Math.max(Math.abs(m.Mi || 0), Math.abs(m.Mj || 0)) : 0; // N·mm
      const Muy = m ? Math.max(Math.abs(m.Mi2 || 0), Math.abs(m.Mj2 || 0)) : 0;

      const result = root.RCSlab.punchingShear(Pu, Mux, Muy, bCol, hCol, dEff, fc, location);

      results.push({
        id: ent.id, bCol, hCol,
        slabT: Math.round(atTop[0].t), tAtCol: Math.round(tAtCol),
        dEff: Math.round(dEff), hasDP, location,
        Pu: Pu / 1e3, Mux: Mux / 1e6,
        dcr: result.dcr, bo: result.bo, gammaV: result.gammaV,
        status: result.dcr > 1 ? 'OVERSTRESSED' : 'OK',
        note: hasDP ? 'Effective depth at drop panel — perimeter about the column face (thickened region)' : '',
      });
    }

    return { results, comboName };
  }

  // ======================================================== WALL SBE
  // ACI 318-19 §18.10.6: special boundary elements at wall ends when
  //  (a) 18.10.6.2 — extreme-fibre stress > 0.15·f'c under service load, or
  //  (b) 18.10.6.3 — the neutral-axis depth at the design condition exceeds
  //      the strain-limited depth. Following the compiled programs, c comes
  //      from the section's fiber P-M sweep at the design axial (the "C
  //      Depth"), and the displacement δu is the wall's own amplified drift
  //      from the analysis displacements (εy from the rebar fy):
  //      κy = 2εy/lw · lp = 0.5lw + 0.1hw · θp = (δu − δy)·hw/(hw − lp/2)
  //      κu = κy + θp/lp · c_limit = εcu/κu  (εcu = 0.003)
  function checkSBE(app, comboName, driftAmp) {
    const { R, src, error } = srcForces(app, comboName);
    if (error) return { error };
    if (!src) return { error: `Combination "${comboName}" not found.` };
    const model = R.model;
    if (!model || !model.shells || !model.shells.length)
      return { error: 'No shell model — re-run the analysis.' };
    const d = root.RCDefine.ensure(app);
    const srcShells = (src.shells || []).filter(s => s && s.forces);
    const U = root.RCModel.caseU ? root.RCModel.caseU(app, comboName) : null;
    const nd = model.nodes;
    const results = [];

    for (const ent of app.bim.entities) {
      if (ent.type !== 'wall') continue;
      const wf = root.RCWall.wallBaseForces(model, srcShells, ent, src.reactions);
      if (!wf) continue;
      const matName = ent.params.materialOverwrite || 'CONC25';
      const mat = d.materials.find(x => x.name === matName) || d.materials.find(x => x.type === 'concrete');
      if (!mat || !mat.conc) continue;
      const fc = mat.conc.fc;

      const p = ent.params;
      const thickness = (p.thickness || 0.2) * 1000;
      const length = (Array.isArray(p.base) && Array.isArray(p.end))
        ? Math.hypot(p.end[0] - p.base[0], p.end[1] - p.base[1]) * 1000 : 3000;
      const height = (+p.height || 3) * 1000;

      // governing station = larger P·M product; service screen at 0.6× factored
      const cuts = [wf.base, wf.top].filter(Boolean);
      const gov = cuts.reduce((a, b) => (Math.abs(b.P * b.M) > Math.abs(a.P * a.M) ? b : a), cuts[0]);
      const PuS = Math.abs(gov.P) * 0.6;   // N, service estimate
      const MuS = Math.abs(gov.M) * 0.6;   // N·mm

      // (a) stress limit — Ag and S of the plain wall section
      const Ag = length * thickness;
      const S = thickness * length * length / 6;
      const sigma = PuS / Ag + MuS / S;
      const stressLimit = 0.15 * fc;
      const stressExceeds = sigma > stressLimit;

      // (b) NA depth — fiber sweep c at the design axial + strain limit
      const fy = d.materials.find(x => x.type === 'rebar')?.rebar?.fy || 500;
      const cover = 40, vertDia = 12, vertSpacing = 300;
      const nVertPerFace = Math.max(2, Math.floor(length / vertSpacing) - 1);
      const bars = root.RCWall.wallBars(length, thickness, cover, vertDia, nVertPerFace, 2, 16);
      const pm = root.RCWall.wallPM(length, thickness, fc, fy, bars, 30);
      const cActual = root.RCWall.wallNAatP(pm, Math.abs(gov.P));

      // δu: the wall's own drift from the analysis displacements, amplified
      let du = 0.015, driftSource = 'default';
      if (U) {
        const b = Array.isArray(p.base) ? p.base : [0, 0, 0];
        const e = Array.isArray(p.end) ? p.end : [0, 0, 0];
        const L2 = Math.hypot(e[0] - b[0], e[1] - b[1]) || 1;
        const tx = (e[0] - b[0]) / L2, ty = (e[1] - b[1]) / L2; // in-plane direction
        const meanIn = z => {
          let s = 0, n = 0;
          for (const sf of model.shells) {
            if (sf.entId !== ent.id) continue;
            for (const ni of [sf.n1, sf.n2, sf.n3, sf.n4]) {
              const node = nd[ni];
              if (Math.abs(node.z - z) > 1e-4) continue;
              s += U[ni * 6] * tx + U[ni * 6 + 1] * ty; n++;
            }
          }
          return n ? s / n : null;
        };
        const uTop = meanIn(b[2] + height / 1000), uBot = meanIn(b[2]);
        if (uTop != null && uBot != null && height > 1) {
          du = Math.abs(uTop - uBot) / height; // mm/mm
          driftSource = 'analysis';
        }
      }
      du *= (driftAmp || 1.0);

      const ey = fy / 200000;
      const lp = 0.5 * length + 0.1 * height;
      const ky = 2 * ey / length;
      const dy = ky * height / 3;
      const thP = Math.max(du - dy, 0) * height / Math.max(height - lp / 2, 1);
      const ku = ky + thP / lp;
      const cLimit = 0.003 / ku;
      const naExceeds = cActual > cLimit;

      const sbeRequired = stressExceeds || naExceeds;

      results.push({
        id: ent.id, length: Math.round(length), thickness: Math.round(thickness),
        station: gov === wf.base ? 'bottom' : 'top',
        Pu: PuS / 1e3, Mu: MuS / 1e6,
        sigma: +sigma.toFixed(2), stressLimit: +stressLimit.toFixed(2),
        stressExceeds,
        cActual: Math.round(cActual), cLimit: Math.round(cLimit), naExceeds,
        du: +du.toFixed(4), driftSource,
        sbeRequired,
        method: stressExceeds ? 'ACI 18.10.6.2 (stress)' :
          naExceeds ? 'ACI 18.10.6.3 (NA depth)' : 'Not required',
        status: sbeRequired ? 'SBE REQUIRED' : 'SBE NOT REQUIRED',
        note: 'c from the fiber P-M sweep at the design axial; steel included',
      });
    }
    return { results, comboName };
  }

  // ======================================================== FOUNDATION
  // Isolated spread footing per ACI 318-19 (Ch.13 sizing, Ch.7/22 checks)
  function designFooting(app, colId, opts) {
    const d = root.RCDefine.ensure(app);
    const ent = app.bim.getEntityById(colId);
    if (!ent || ent.type !== 'column') return { error: 'Select a column.' };
    const sec = d.frameSections.find(s => s.name === ent.params.designSection);
    if (!sec) return { error: 'Column section not found.' };
    const dims = sec.dims || {};
    const bCol = (dims.b || 0.4) * 1000; // m → mm
    const hCol = (dims.h || 0.4) * 1000;
    const mat = d.materials.find(m => m.name === (ent.params.materialOverwrite || sec.material)) ||
                d.materials.find(m => m.type === 'concrete');
    const fc = mat ? mat.conc.fc : 25;
    const fy = d.materials.find(x => x.type === 'rebar')?.rebar?.fy || 500;

    // column forces: from the worst stored combination when available
    let Pu = (opts && opts.Pu) || 0, Mu = (opts && opts.Mu) || 0;
    if (!Pu && app.rcResults) {
      for (const cs of app.rcResults.combos.length ? app.rcResults.combos : app.rcResults.patterns) {
        const m = (cs.members || []).find(x => x.id === ent.id);
        if (!m) continue;
        Pu = Math.max(Pu, Math.abs(m.Fi || 0), Math.abs(m.Fj || 0));
        Mu = Math.max(Mu, Math.abs(m.Mi || 0), Math.abs(m.Mj || 0));
      }
    }
    if (!Pu) { Pu = 1500e3; Mu = 50e6; } // last-resort default

    // footing params
    const qAllow = (opts && opts.qAllow) || 200;   // kN/m²
    const footingH = (opts && opts.height) || 600; // mm
    const cover = 75; // concrete cast against earth
    const dFtg = footingH - cover - 12;            // effective depth (Ø12 bars)
    const L = (opts && opts.L) || Math.max(bCol * 3, 2000); // mm
    const B = (opts && opts.B) || L;

    // bearing: qAllow kN/m² = qAllow/1000 N/mm²
    const qAllowNmm2 = qAllow / 1000;
    const qActual = Pu / (L * B);                  // N/mm²
    const bearingOK = qActual <= qAllowNmm2;

    // net upward soil pressure (factored)
    const qu = qActual;

    // one-way shear at d from the column face
    const cantL = (L - bCol) / 2;
    const Vu1 = qu * B * cantL;
    const phiVc1 = 0.75 * 0.17 * Math.sqrt(fc) * B * dFtg;
    const oneWayOK = Vu1 <= phiVc1;

    // two-way (punching) shear around the column
    const bo = 2 * ((bCol + dFtg) + (hCol + dFtg));
    const beta = Math.max(bCol, hCol) / Math.min(bCol, hCol);
    const Vc1p = (2 + 4 / beta) * Math.sqrt(fc) * bo * dFtg;
    const Vc2p = (40 * dFtg / bo + 2) * Math.sqrt(fc) * bo * dFtg;
    const Vc3p = 4 * Math.sqrt(fc) * bo * dFtg;
    const phiVcPunch = 0.75 * Math.min(Vc1p, Vc2p, Vc3p);
    const PuPunch = qu * (L * B - (bCol + dFtg) * (hCol + dFtg));
    const punchOK = PuPunch <= phiVcPunch;

    // flexure at the column face
    const cantMid = (L - bCol) / 2;
    const MuFtg = qu * B * cantMid * cantMid / 2;
    const Rn = MuFtg / (0.9 * B * dFtg * dFtg);
    const rho = 0.85 * fc / fy * (1 - Math.sqrt(1 - 2 * Rn / (0.85 * fc)));
    const AsReq = rho > 0 ? rho * B * dFtg : 0;
    const AsMin = 0.0018 * B * footingH;
    const As = Math.max(AsReq, AsMin);

    // development: ACI 25.4 simplified — ld available from column face to edge
    const ld = fy * 16 / (2 * Math.sqrt(fc)); // Ø16 hooked-equivalent screening
    const devOK = cantMid >= ld;

    return {
      colId: ent.id, bCol, hCol,
      footingL: L, footingB: B, footingH,
      fc, fy, d: dFtg,
      Pu: Pu / 1e3, Mu: Mu / 1e6,
      qActual: +(qActual * 1000).toFixed(1), // kN/m²
      qAllow,
      bearingOK,
      oneWay: { Vu: Vu1, Vc: phiVc1, ok: oneWayOK },
      punching: { Vu: PuPunch, Vc: phiVcPunch, bo: Math.round(bo), ok: punchOK },
      flexure: { Mu: MuFtg / 1e6, As: Math.round(As), AsMin: Math.round(AsMin) },
      development: { ld: Math.round(ld), available: Math.round(cantMid), ok: devOK },
    };
  }

  // ======================================================== dialogs
  const badge = ok => ok
    ? '<span style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:bold;background:#e8f5e9;color:#2e7d32">OK</span>'
    : '<span style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:bold;background:#ffebee;color:#c62828">FAIL</span>';
  const comboSelect = (app, id) => {
    const R = app.rcResults;
    const names = R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name);
    const opts = names.map(n => `<option value="${n}">${n}</option>`).join('');
    return `<select id="${id}" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${opts}</select>`;
  };

  function punchingDialog(app) {
    if (!app.rcResults) { app.toast('Run the analysis first', true); return; }
    const html = [
      '<p style="margin:0 0 6px;font-size:12px;opacity:.8">Two-way punching at every column top from the combination forces — perimeter, Jc, γv, drop-panel-aware d (ACI 22.6).</p>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Load Combination</span>' + comboSelect(app, 'pn-combo') + '</div>',
    ].join('');
    app.dialog('Punching Shear Check — Columns', html, [
      ['Check', () => {
        const r = designPunchingShear(app, document.getElementById('pn-combo').value);
        if (r.error) { app.toast(r.error, true); return false; }
        const esc2 = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const rows = r.results.map(x => '<tr>' +
          `<td style="padding:3px 6px">${esc2(x.id)}</td>` +
          `<td>${x.bCol}×${x.hCol}</td>` +
          `<td>${x.tAtCol}${x.hasDP ? ' (DP)' : ''}</td>` +
          `<td>${x.dEff}</td>` +
          `<td>${x.Pu.toFixed(0)}</td>` +
          `<td>${x.location}</td>` +
          `<td>${x.bo}</td>` +
          `<td style="color:${x.dcr > 1 ? '#c62828' : '#2e7d32'};font-weight:bold">${x.dcr.toFixed(2)}</td>` +
          `<td>${x.status}</td></tr>`).join('');
        const html2 = '<div style="max-height:65vh;overflow:auto">' +
          `<p style="font-size:12px;margin:0 0 6px;opacity:.8">Combination: <b>${esc2(r.comboName)}</b> · ${r.results.length} column(s) with slab bearing</p>` +
          '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="text-align:left;opacity:.7">' +
          '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">Column</th><th>b×h (mm)</th><th>t eff (mm)</th><th>d (mm)</th>' +
          '<th>Pu (kN)</th><th>Location</th><th>bo (mm)</th><th>DCR</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>' +
          '<p style="font-size:11px;opacity:.7;margin:8px 0 0">DP = effective depth taken at a thickened (drop-panel) region · φ = 0.75</p></div>';
        app.dialog('Punching Shear Results', html2, [['Close', null]]);
        return false;
      }],
      ['Close', null],
    ]);
  }

  function sbeDialog(app) {
    if (!app.rcResults) { app.toast('Run the analysis first', true); return; }
    const html = [
      '<p style="margin:0 0 6px;font-size:12px;opacity:.8">ACI 318-19 §18.10.6 — special boundary elements required when the wall-end compressive stress exceeds 0.15·f\'c (service) or the fiber-sweep neutral axis exceeds the strain-limited depth at the wall\'s amplified drift.</p>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Load Combination</span>' + comboSelect(app, 'sb-combo') + '</div>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Drift amplification</span>' +
      '<input id="sb-drift" type="number" value="1.0" step="0.1" min="1" style="width:80px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px" title="multiplier on the analysis drift — ACI amplified displacement δue·Cd/R as a factor"></div>',
    ].join('');
    app.dialog('Wall SBE Check — ACI 18.10.6', html, [
      ['Check', () => {
        const r = checkSBE(app, document.getElementById('sb-combo').value,
          +document.getElementById('sb-drift').value);
        if (r.error) { app.toast(r.error, true); return false; }
        const esc2 = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const rows = r.results.map(x => '<tr>' +
          `<td style="padding:3px 6px">${esc2(x.id)}</td>` +
          `<td>${x.length}×${x.thickness}</td>` +
          `<td>${x.Pu.toFixed(0)}</td><td>${x.Mu.toFixed(0)}</td>` +
          `<td>${x.sigma.toFixed(2)} / ${x.stressLimit.toFixed(2)}</td><td>${badge(!x.stressExceeds)}</td>` +
          `<td>${x.cActual} / ${x.cLimit}</td><td>${badge(!x.naExceeds)}</td>` +
          `<td>${(x.du * 100).toFixed(2)}% (${x.driftSource})</td>` +
          `<td style="font-weight:bold;color:${x.sbeRequired ? '#c62828' : '#2e7d32'}">${x.status}</td></tr>`).join('');
        const html2 = '<div style="max-height:65vh;overflow:auto">' +
          `<p style="font-size:12px;margin:0 0 6px;opacity:.8">Combination: <b>${esc2(r.comboName)}</b> · stresses at 0.6× factored (service screen) · c from the fiber P-M sweep</p>` +
          '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="text-align:left;opacity:.7">' +
          '<th style="padding:3px 5px;border-bottom:1px solid #d7dde3">Wall</th><th>lw×t (mm)</th><th>Pu (kN)</th><th>Mu (kN·m)</th>' +
          '<th>σ / 0.15f\'c (MPa)</th><th>18.10.6.2</th><th>c / limit (mm)</th><th>18.10.6.3</th><th>δu</th><th>Result</th></tr></thead><tbody>' + rows + '</tbody></table>' +
          `<p style="font-size:11px;opacity:.7;margin:8px 0 0">${r.results.length ? 'δu = wall drift from the analysis displacements × amplification · limit per Paulay–Priestley plastic hinge (εcu = 0.003)' : 'No walls with shell forces — draw walls and re-run.'}</p></div>`;
        app.dialog('SBE Check Results', html2, [['Close', null]]);
        return false;
      }],
      ['Close', null],
    ]);
  }

  function footingDialog(app, cat) {
    if (cat !== 'footingDesign') return;
    const d = root.RCDefine.ensure(app);
    const cols = app.bim.entities.filter(e => e.type === 'column');
    if (!cols.length) { app.toast('Draw columns first', true); return; }

    const colOpts = cols.map(c => `<option value="${c.id}">${c.id}</option>`).join('');
    const puHint = app.rcResults ? 'blank = worst stored combination' : 'no results — manual value used';
    const html = [
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Column</span><select id="fd-col" style="width:200px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">' + colOpts + '</select></div>',
      `<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Pu (kN)</span><input id="fd-pu" type="number" placeholder="${puHint}" style="width:100px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px"></div>`,
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Footing L×B (m)</span><input id="fd-L" type="number" value="2.5" step="0.25" style="width:70px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px"> × <input id="fd-B" type="number" value="2.5" step="0.25" style="width:70px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px"></div>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Footing H (mm)</span><input id="fd-h" type="number" value="600" style="width:100px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px"></div>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">q_allow (kN/m²)</span><input id="fd-qa" type="number" value="200" style="width:100px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px"></div>',
    ].join('');
    app.dialog('Isolated Footing Design — ACI 318-19', html, [
      ['Design', () => {
        const colId = document.getElementById('fd-col').value;
        const puRaw = document.getElementById('fd-pu').value;
        const L = (+document.getElementById('fd-L').value) * 1000;
        const B = (+document.getElementById('fd-B').value) * 1000;
        const h = +document.getElementById('fd-h').value;
        const qAllow = +document.getElementById('fd-qa').value;
        const r = designFooting(app, colId, {
          Pu: puRaw ? (+puRaw) * 1000 : 0,
          L, B, height: h, qAllow,
        });
        if (r.error) { app.toast(r.error, true); return false; }
        showFootingResults(app, r);
        return false;
      }],
      ['Close', null],
    ]);
  }

  function showFootingResults(app, r) {
    const html = '<div style="max-height:65vh;overflow:auto">' +
      `<h3 style="font-size:14px;margin:0 0 8px">Footing: ${r.footingL.toFixed(0)}×${r.footingB.toFixed(0)}×${r.footingH} mm under ${r.colId}</h3>` +
      `<p style="font-size:12px;margin:0 0 6px;opacity:.8">Pu = ${r.Pu.toFixed(0)} kN · Mu = ${r.Mu.toFixed(0)} kN·m · f'c = ${r.fc} MPa · fy = ${r.fy} MPa · d = ${r.d.toFixed(0)} mm</p>` +
      '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<tr><td style="padding:4px 8px;font-weight:bold" colspan="3">Bearing (ACI Ch.13)</td></tr>' +
      `<tr><td style="padding:4px 8px">q actual = ${r.qActual} kN/m²</td><td>q allow = ${r.qAllow} kN/m²</td><td>${badge(r.bearingOK)}</td></tr>` +
      '<tr><td style="padding:4px 8px;font-weight:bold" colspan="3">One-Way Shear (ACI 22.5)</td></tr>' +
      `<tr><td style="padding:4px 8px">Vu = ${(r.oneWay.Vu / 1e3).toFixed(0)} kN</td><td>φVc = ${(r.oneWay.Vc / 1e3).toFixed(0)} kN</td><td>${badge(r.oneWay.ok)}</td></tr>` +
      '<tr><td style="padding:4px 8px;font-weight:bold" colspan="3">Two-Way Shear (ACI 22.6)</td></tr>' +
      `<tr><td style="padding:4px 8px">Vu = ${(r.punching.Vu / 1e3).toFixed(0)} kN</td><td>φVc = ${(r.punching.Vc / 1e3).toFixed(0)} kN</td><td>bo = ${r.punching.bo} mm ${badge(r.punching.ok)}</td></tr>` +
      '<tr><td style="padding:4px 8px;font-weight:bold" colspan="3">Flexure (ACI Ch.7)</td></tr>' +
      `<tr><td style="padding:4px 8px">Mu = ${r.flexure.Mu.toFixed(1)} kN·m/m</td><td>As = ${r.flexure.As} mm²</td><td>As,min = ${r.flexure.AsMin} mm²</td></tr>` +
      '<tr><td style="padding:4px 8px;font-weight:bold" colspan="3">Development (ACI 25.4)</td></tr>' +
      `<tr><td style="padding:4px 8px">ld = ${r.development.ld} mm</td><td>Available = ${r.development.available} mm</td><td>${badge(r.development.ok)}</td></tr>` +
      '</table></div>';
    app.dialog('Footing Design Results', html, [['Close', null]]);
  }

  function open(app, cat) {
    if (cat === 'punchingDesign') { punchingDialog(app); return; }
    if (cat === 'sbeCheck') { sbeDialog(app); return; }
    if (cat === 'footingDesign') { footingDialog(app, cat); return; }
  }

  root.RCColSlab = { designPunchingShear, checkSBE, designFooting, footingDialog, open };
})(window);
