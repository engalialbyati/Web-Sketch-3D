// rccolumn.js — ACI 318-19 RC column design (biaxial P-M interaction).
// v2: φ per point, 0.80P₀ cap, displaced-concrete deduction,
//     balance-anchored strain sweep, non-monotonic repair, true biaxial.
// Units: N, mm, MPa.
(function (root) {
  'use strict';

  const Es = 200000;
  const EC_U = 0.003;

  function beta1(fc) {
    return Math.max(0.65, Math.min(0.85, 0.85 - 0.05 * (fc - 28) / 7));
  }

  // φ from net tensile strain (ACI 21.2.3)
  function phiFromStrain(et, esy) {
    const etLimit = esy + 0.003;
    if (et >= etLimit) return 0.90;
    if (et <= esy) return 0.65;
    return 0.65 + 0.25 * (et - esy) / 0.003;
  }

  // ============================================================ rebar layout
  function rebarLayout(b, h, cover, rebar) {
    const bars = [];
    const db = parseFloat(rebar.rebarSize) || 16;
    const Ab = Math.PI * db * db / 4;
    const c = cover;
    const positions = [
      { x: -(b/2 - c), y: -(h/2 - c) },
      { x: +(b/2 - c), y: -(h/2 - c) },
      { x: -(b/2 - c), y: +(h/2 - c) },
      { x: +(b/2 - c), y: +(h/2 - c) },
    ];
    for (const p of positions) bars.push({ ...p, area: Ab });
    const nR3 = (rebar.nR3 || 0), nR2 = (rebar.nR2 || 0);
    for (let i = 1; i <= nR3; i++) {
      const y = -(h/2 - c) + (h - 2*c) * i / (nR3 + 1);
      bars.push({ x: -(b/2 - c), y, area: Ab });
      bars.push({ x: +(b/2 - c), y, area: Ab });
    }
    for (let i = 1; i <= nR2; i++) {
      const x = -(b/2 - c) + (b - 2*c) * i / (nR2 + 1);
      bars.push({ x, y: -(h/2 - c), area: Ab });
      bars.push({ x, y: +(h/2 - c), area: Ab });
    }
    return bars;
  }

  // ==================================================== P-M curve (v2)
  // Balance-anchored strain sweep, φ per point, 0.80P₀ cap,
  // displaced-concrete deduction, non-monotonic repair.
  // Memoized: identical (section, material, angle, capType) sweeps return
  // the cached curve — the optimizer re-designs every column per iteration.
  const pmCache = new Map();
  function generatePMCurve(sec, mat, angle, nPoints = 40, capType = 'design') {
    const dims = sec.dims || {};
    const fc0 = mat.conc ? mat.conc.fc : 25;
    const cov0 = (sec.rebar && sec.rebar.colCover) || 0.04;
    const key = [sec.name || '?', dims.b, dims.h, dims.dia, fc0, cov0,
      JSON.stringify(sec.rebar || {}), angle, nPoints, capType].join('|');
    if (pmCache.has(key)) return pmCache.get(key);
    // section dims are stored in meters (BIM units); the design math runs in mm
    const b = (dims.b || 0.3) * 1000;
    const h = (dims.h || 0.5) * 1000;
    const fc = fc0;
    // capacity type: 'design' = φ applied + 0.80P₀ cap
    //                'expected' = no φ, overstrength Ω = 1.25 on fy
    const capTypeDesign = capType === 'design';
    const fyCap = capTypeDesign ? 500 : Math.min(500 * 1.25, 550); // expected: Ω=1.25
    const fy = fyCap;
    const b1 = beta1(fc);
    const cover = (sec.rebar && sec.rebar.colCover) || 0.04;
    const bars = rebarLayout(b, h, cover * 1000, sec.rebar || {});
    const Ag = b * h;
    const Ast = bars.reduce((s, b2) => s + b2.area, 0);
    const dMax = h - cover * 1000; // depth to extreme tension steel

    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rotBars = bars.map(bar => ({
      x: bar.x * cos + bar.y * sin,
      y: -bar.x * sin + bar.y * cos,
      area: bar.area,
    }));

    const esy = fy / Es;
    // balance point: c_bal = εcu·dt / (εcu + εy)
    const cBal = EC_U * dMax / (EC_U + esy);
    const aBal = b1 * cBal;

    // sweep anchored at balance: half below aBal (tension side), half above (compression)
    const nHalf = Math.floor(nPoints / 2);
    const sweepA = []; // compression block depths

    // below balance: uniform from ~0 to aBal
    for (let i = 0; i <= nHalf; i++) sweepA.push(aBal * i / nHalf);
    // above balance: from aBal to h (and beyond for pure compression)
    for (let i = 1; i <= nPoints - nHalf; i++) sweepA.push(aBal + (h * 1.5 - aBal) * i / (nPoints - nHalf));

    const alphaConc = 0.85;
    const raw = [];

    // pure tension point
    let Pt = 0;
    for (const bar of rotBars) Pt -= bar.area * fy;
    raw.push({ P: Pt, M: 0 });

    for (const a of sweepA) {
      if (a < 1e-9) {
        raw.push({ P: Pt, M: 0 });
        continue;
      }
      const c = a / b1;
      let P = 0, Mx = 0;

      // concrete Whitney block
      if (a > 0) {
        const Cc = alphaConc * fc * b * Math.min(a, h);
        const yCc = -(h / 2) + Math.min(a, h) / 2;
        P += Cc;
        Mx += Cc * yCc;
      }

      // steel: force minus displaced concrete (0.85f'c where in compression zone)
      for (const bar of rotBars) {
        const di = bar.y + h / 2;
        const es = EC_U * (c - di) / c;
        const fs = Math.max(-fy, Math.min(fy, Es * es));
        let Fi = bar.area * fs;
        // displaced-concrete deduction: when bar is in compression zone, subtract
        // the concrete it displaces (ACI §22.2 — net force = steel - displaced conc)
        if (di < a && fs > 0) Fi -= bar.area * alphaConc * fc;
        P += Fi;
        Mx += Fi * bar.y;
      }

      // compute φ from extreme tension steel strain
      const dt = dMax;
      let et = 0;
      if (c > 0.01) et = EC_U * (dt - c) / c;
      else et = 0.005 + esy; // pure tension side
      const phi = phiFromStrain(et, esy);

      // axial cap: 0.80·P₀ for tied, 0.85·P₀ for spiral (ACI 22.4.2)
      const P0 = alphaConc * fc * (Ag - Ast) + Ast * fy;
      const Pcap = Math.min(P, 0.80 * P0);

      // moment resolved on the DOMINANT global axis of the sweep angle:
      // 0° → strong-axis (X) moment, 90° → weak-axis (Y) moment. Storing
      // Mx·cos alone zeroed the 90° curve and broke the weak-axis check.
      const mComp = Math.abs(cos) >= Math.abs(sin) ? cos : sin;

      // design curves carry φPn–φMn (the φ per strain, ACI 21.2); expected-
      // strength curves stay nominal with the overstrength fy
      const phiF = capTypeDesign ? phi : 1;
      raw.push({ P: Pcap * phiF, M: Math.abs(Mx * mComp) * phiF, phi, et });
    }

    // pure-compression anchor at M = 0 — the sweep approaches but never
    // reaches M = 0, and without this point small-moment demands fall in
    // a bracket gap and read as 'outside curve'
    const P0 = alphaConc * fc * (Ag - Ast) + Ast * fy;
    raw.push({ P: 0.80 * P0 * (capTypeDesign ? 0.65 : 1), M: 0,
      phi: phiFromStrain(0, esy), et: 0 });

    // the sweep runs tension → compression; the ETABS-style repairs below
    // assume compression-first ordering (P monotonically DECREASING from
    // the pure-compression end) — reverse so the clamp enforces the real
    // envelope instead of collapsing the curve onto the tension capacity
    raw.reverse();

    // non-monotonic P repair (ETABS cPMSurfaceGenerator.cs:843-886):
    // replace points that break P-monotonicity with linear interpolation
    // between bracketing points
    for (let i = 1; i < raw.length - 1; i++) {
      if (raw[i].P < raw[i-1].P && raw[i].P < raw[i+1].P) {
        // local minimum → interpolate
        raw[i].P = (raw[i-1].P + raw[i+1].P) / 2;
      }
    }
    // ensure monotonic decreasing P from compression to tension end
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].P > raw[i-1].P) raw[i].P = raw[i-1].P;
    }

    pmCache.set(key, raw);
    return raw;
  }

  // ===================================================== capacity ratio
  // The interaction curve is closed: a given Mu matches many brackets, one
  // per leg. Pick the capacity on the SAME side as the demand — compression
  // Pu takes the largest compression capacity, tension Pu the smallest P.
  function capacityRatio(Pu, Mu, pmCurve) {
    let best = null;
    for (let i = 0; i < pmCurve.length - 1; i++) {
      const p1 = pmCurve[i], p2 = pmCurve[i + 1];
      if ((Mu >= Math.min(p1.M, p2.M)) && (Mu <= Math.max(p1.M, p2.M))) {
        const t = Math.abs(p2.M - p1.M) > 1e-9 ? (Mu - p1.M) / (p2.M - p1.M) : 0;
        const Pcap = p1.P + t * (p2.P - p1.P);
        if (!isFinite(Pcap)) continue;
        if (best == null) best = Pcap;
        else if (Pu >= 0) best = Math.max(best, Pcap); // compression demand
        else best = Math.min(best, Pcap);              // tension demand
      }
    }
    if (best == null) return { dcr: 99, Pcap: 0, status: 'Mu exceeds interaction curve' };
    if (Math.abs(best) < 1 || (Pu >= 0 && best <= 0)) return { dcr: 99, Pcap: best, status: 'ZERO CAPACITY' };
    return { dcr: Math.abs(Pu) / Math.abs(best), Pcap: best, status: 'ok' };
  }

  // ============================================================ design all
  function designAllColumns(app, comboName, capType, minEcc) {
    const R = app.rcResults;
    if (!R) return { error: 'Run the analysis first (Analyze ▸ Run Analysis).' };
    const d = root.RCDefine.ensure(app);

    let combo = R.combos.find(c => c.name === comboName);
    let pat = null;
    if (!combo) {
      pat = R.patterns.find(p => p.name === comboName);
      if (!pat) return { error: `Combination or pattern "${comboName}" not found.` };
    }

    const results = [];
    for (const m of (combo ? combo.members : pat.members)) {
      if (m.type !== 'column') continue;
      const ent = app.bim.getEntityById(m.id);
      if (!ent) continue;
      const sec = d.frameSections.find(s => s.name === ent.params.designSection);
      if (!sec || !sec.rebar) continue;
      const mat = d.materials.find(x => x.name === (ent.params.materialOverwrite || sec.material)) ||
                  d.materials.find(x => x.type === 'concrete');
      if (!mat || !mat.conc) continue;

      const dims = sec.dims || {};
      const b = (dims.b || 0.3) * 1000, h = (dims.h || 0.5) * 1000; // m → mm
      const fc = mat.conc.fc;

      // moments AT THE BEAM FACES (ETABS auto end offsets): interpolate the
      // station table at the offsets — the joint-centerline moment never
      // designs the column. Minor-axis has no station table; stays at node.
      const offI = m.offI || 0, offJ = m.offJ || 0; // mm
      const Lst = m.stations && m.stations.length ? m.stations[m.stations.length - 1].x * 1000 : 0;
      const stI = offI > 1 ? root.RCBeam.stationAt(m, offI) : null;
      const stJ = offJ > 1 && Lst ? root.RCBeam.stationAt(m, Lst - offJ) : null;
      const MxI = stI ? Math.abs(stI.M) * 1e6 : Math.abs(m.Mi || 0); // N·mm
      const MxJ = stJ ? Math.abs(stJ.M) * 1e6 : Math.abs(m.Mj || 0);

      const Pu = Math.abs(m.Fi || 0);
      let Mx = Math.max(MxI, MxJ); // N·mm
      let My = Math.max(Math.abs(m.Vi2 || 0) * h / 2 || 0, Math.abs(m.Vj2 || 0) * h / 2 || 0);
      // minimum eccentricity preference (ACI 6.2.5): e_min = h/30 (or 20mm)
      const eMinH = h / 30, eMinB = b / 30;
      const eMin = Math.max(20, Math.min(eMinH, eMinB));
      if (minEcc && Mx < Pu * eMin) Mx = Pu * eMin;
      if (minEcc && My < Pu * eMin) My = Pu * eMin;

      // P-M curves at 0° and 90°
      const pm0 = generatePMCurve(sec, mat, 0, 30, capType);
      const pm90 = generatePMCurve(sec, mat, 90, 30, capType);

      const cr0 = capacityRatio(Pu, Mx, pm0);
      const cr90 = capacityRatio(Pu, My, pm90);
      const dcr = Math.max(cr0.dcr, cr90.dcr);

      results.push({
        id: m.id, b, h, fc, fy: 500,
        Pu: Pu / 1e3, Mx: Mx / 1e6, My: My / 1e6,
        dcr, crStrong: cr0.dcr, crWeak: cr90.dcr,
        Pcap: cr0.Pcap / 1e3,
        status: dcr > 1 ? 'OVERSTRESSED' : dcr > 0.9 ? 'NEAR LIMIT' : 'OK',
        pmCurve: pm0,
      });
    }
    return { results, comboName };
  }

  // ============================================================ design dialog
  function open(app, cat) {
    if (cat !== 'columnDesign') return;
    const R = app.rcResults;
    if (!R) { app.toast('Run the analysis first', true); return; }
    const d = root.RCDefine.ensure(app);
    const comboNames = R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name);
    if (!comboNames.length) { app.toast('No load combinations or patterns defined', true); return; }

    const patOpts = comboNames.map(n => `<option value="${n}">${n}</option>`).join('');
    const html = [
      '<p style="margin:0 0 6px;font-size:12px;opacity:.8">Biaxial P-M interaction check per ACI 318-19 (fiber method, φ per point, 0.80P₀ cap).</p>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Load Combination</span>' +
      `<select id="cd-combo" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${patOpts}</select></div>`,
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Capacity Type</span>' +
      '<select id="cd-captype" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">' +
      '<option value="design">Design (φ applied, 0.80P₀ cap)</option>' +
      '<option value="expected">Expected (no φ, Ω=1.25 overstrength)</option></select></div>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Min Eccentricity</span>' +
      '<input type="checkbox" id="cd-minecc" checked style="width:20px;height:20px"> <span style="font-size:11px;opacity:.7">ACI 6.2.5: e_min = h/30</span></div>',
    ].join('');
    app.dialog('RC Column Design — ACI 318-19', html, [
      ['Design', () => {
        const combo = document.getElementById('cd-combo').value;
        const capType = document.getElementById('cd-captype').value;
        const minEcc = document.getElementById('cd-minecc').checked;
        const result = designAllColumns(app, combo, capType, minEcc);
        if (result.error) { app.toast(result.error, true); return false; }
        showColumnResults(app, result, combo);
        return false;
      }],
      ['Close', null],
    ]);
  }

  function showColumnResults(app, result, comboName) {
    const esc = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const rows = result.results.map(r => {
      const color = r.dcr > 1 ? '#c62828' : r.dcr > 0.9 ? '#f57f17' : '#2e7d32';
      return '<tr>' +
        `<td style="padding:3px 6px">${esc(r.id)}</td>` +
        `<td>${r.b}×${r.h}</td>` +
        `<td>${r.Pu.toFixed(0)}</td>` +
        `<td>${r.Mx.toFixed(1)}</td>` +
        `<td>${r.My.toFixed(1)}</td>` +
        `<td>${r.Pcap.toFixed(0)}</td>` +
        `<td style="color:${color};font-weight:${r.dcr > 1 ? 'bold' : 'normal'}">${r.dcr.toFixed(3)}</td>` +
        `<td style="color:${color}">${r.status}</td>` +
        '</tr>';
    }).join('');
    const html = '<div style="max-height:65vh;overflow:auto">' +
      `<p style="font-size:12px;margin:0 0 6px;opacity:.8">Combination: <b>${esc(comboName)}</b> · ACI 318-19 · Biaxial P-M (fiber method, φ per point, 0.80P₀ cap)</p>` +
      '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
      '<thead><tr style="text-align:left;opacity:.7">' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Element</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">b×h</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Pu (kN)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Mx (kN·m)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">My (kN·m)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">φPcap (kN)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">DCR</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Status</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p style="font-size:11px;opacity:.7;margin:8px 0 0">DCR = Pu/φPn at applied moment · φ per ACI 21.2.3 · P capped at 0.80P₀</p>' +
      '</div>';
    app.dialog('RC Column Design Results — ' + comboName, html, [['Close', null]]);
  }

  function beta1(fc) {
    return Math.max(0.65, Math.min(0.85, 0.85 - 0.05 * (fc - 28) / 7));
  }

  root.RCColumn = { generatePMCurve, capacityRatio, designAllColumns, open, rebarLayout, beta1 };
})(window);
