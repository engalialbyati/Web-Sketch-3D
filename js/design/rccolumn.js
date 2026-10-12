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
    raw.push({ P: Pt, M: 0, mx: 0, my: 0 });

    for (const a of sweepA) {
      if (a < 1e-9) {
        raw.push({ P: Pt, M: 0, mx: 0, my: 0 });
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
      // global-axis moment components of this NA angle (U-layout caps for the
    // biaxial sum method): local x-axis makes angle θ with global x
    const mLoc = Math.abs(Mx);
    const mxG = mLoc * Math.abs(cos), myG = mLoc * Math.abs(sin);
    raw.push({ P: Pcap * phiF, M: Math.abs(Mx * mComp) * phiF,
      mx: mxG * phiF, my: myG * phiF, phi, et });
    }

    // pure-compression anchor at M = 0 — the sweep approaches but never
    // reaches M = 0, and without this point small-moment demands fall in
    // a bracket gap and read as 'outside curve'
    const P0 = alphaConc * fc * (Ag - Ast) + Ast * fy;
    raw.push({ P: 0.80 * P0 * (capTypeDesign ? 0.65 : 1), M: 0, mx: 0, my: 0,
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
  // ================================================ biaxial P-M-M capacity
  // ETABS CSiCol parity: NA-angle curves (fiber surface slices) + the
  // capacity-method set of cPMMSurface.ComputePMCapacityResults* — axial,
  // moment-vector, moment-sum, ray (true-vector) — governing = max.
  // (The eccentricity-vector method needs the curve's e(θ) table; the four
  // here bound it for rectangular sections with symmetric layouts.)
  const pmSurfaceCache = new Map();
  function generatePMSurface(sec, mat, capType, nAngles = 7) {
    const key = [sec.name || '?', mat.conc ? mat.conc.fc : 25,
      JSON.stringify(sec.rebar || {}), capType, nAngles].join('|');
    if (pmSurfaceCache.has(key)) return pmSurfaceCache.get(key);
    const curves = [];
    for (let a = 0; a < nAngles; a++) {
      const ang = a * 90 / (nAngles - 1); // 0..90
      curves.push({ ang, pts: generatePMCurve(sec, mat, ang, 30, capType) });
    }
    pmSurfaceCache.set(key, curves);
    return curves;
  }
  function interpAtP(pts, P, field) {
    // pts: P descending (pure compression first, pure tension last)
    if (!pts.length) return null;
    if (P >= pts[0].P || P <= pts[pts.length - 1].P) return null; // outside axial range
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i].P, p0 = pts[i + 1].P;
      if (P <= p1 && P >= p0) {
        const t = (p1 - P) / Math.max(p1 - p0, 1e-9);
        return (1 - t) * pts[i][field] + t * pts[i + 1][field];
      }
    }
    return null;
  }
  function capacityBiaxial(sec, mat, Pu, Mx, My, capType) {
    const curves = generatePMSurface(sec, mat, capType, 7);
    const Mres = Math.hypot(Mx, My);
    const PmaxC = curves[0].pts.length ? curves[0].pts[0].P : 0;
    const last = curves[0].pts.length ? curves[0].pts[curves[0].pts.length - 1].P : 0;
    let best = null;
    for (const { ang, pts } of curves) {
      const Mcap = interpAtP(pts, Pu, 'M');
      if (Mcap == null || Mcap < 1) continue;
      const ratioVec = Mres / Mcap;
      // moment-sum: component caps on this NA-angle curve at Pu
      let ratioSum = 0;
      const capX = interpAtP(pts, Pu, 'mx'), capY = interpAtP(pts, Pu, 'my');
      if (capX != null && capY != null) {
        ratioSum = (Mx > 1 ? Mx / Math.max(capX, 1) : 0) + (My > 1 ? My / Math.max(capY, 1) : 0);
      } else ratioSum = ratioVec;
      // ray (true vector): eccentricity match on the same curve
      let ratioRay = ratioVec;
      const eDem = Mres / Math.max(Math.abs(Pu), 1);
      let found = false;
      for (let i = 0; i < pts.length && !found; i++) {
        if (pts[i].M < 1 || Math.abs(Pu) < 1) break;
        const e_i = pts[i].M / Math.max(Math.abs(pts[i].P), 1);
        if (Math.abs(e_i - eDem) <= 0.05 * Math.max(e_i, eDem)) {
          const s = pts[i].M / Math.max(Mres, 1);
          if (s > 0.05) { ratioRay = 1 / s; found = true; }
        }
      }
      const rec = { ang, ratioVec, ratioSum, ratioRay, dcr: Math.max(ratioVec, ratioSum, ratioRay) };
      if (!best || rec.dcr < best.dcr) best = rec; // governing = the curve that resists best
    }
    // axial-only (angle-free) + governing across everything (ETABS MaxOfAll)
    let dcrAxial = null;
    if (Pu >= 0 && PmaxC > 1) dcrAxial = Pu / PmaxC;
    if (Pu < 0 && Math.abs(last) > 1) dcrAxial = Math.abs(Pu) / Math.abs(last);
    const dcr = Math.max(best ? best.dcr : 99, dcrAxial != null ? dcrAxial : 0);
    return { dcr, method: dcrAxial != null && dcrAxial >= (best ? best.dcr : 0) ? 'axial' : (best ? 'biaxial' : 'none'),
      ratioVec: best ? best.ratioVec : null, ratioSum: best ? best.ratioSum : null,
      ratioRay: best ? best.ratioRay : null, dcrAxial, ang: best ? best.ang : null, PmaxC };
  }

  // ============================================ joint shear (ETABS parity)
  // Concrete Joint Envelope: JS ratio = Vu,js / (φ·γ·√f'c·bj·hc),
  // φ = 0.85 (ETABS PhiJointShear), γ = 1.66 interior / 1.25 exterior /
  // 1.0 corner (ACI 21.3.4 SI). Demand: unbalanced beam face moments
  // framing into the joint on the axis considered (combo-factored).
  function jointShearCheck(app, m, model, comboName) {
    const R = app.rcResults;
    const ent = app.bim.getEntityById(m.id);
    if (!ent) return null;
    const [cx, cy, cz] = ent.params.base;
    const hgt = (+ent.params.height || 3);
    // beams framing into this column top node
    const ni = model.frames[R.model.map.findIndex ? 0 : 0]; // placeholder replaced below
    const srcIdx = model.map.find(mm => mm.ent && mm.ent.id === m.id);
    if (!srcIdx) return null;
    const el = model.frames[srcIdx.idx];
    const topZ = cz + hgt;
    const sec = root.RCDefine.ensure(app).frameSections.find(s2 =>
      s2.name === ent.params.designSection);
    const dims = (sec && sec.dims) || {};
    const hc = ((dims.h || dims.b || 0.4)) * 1000;   // column depth mm
    const bc = ((dims.b || 0.4)) * 1000;
    const mat = sec && (ent.params.materialOverwrite || sec.material);
    const matObj = root.RCDefine.ensure(app).materials.find(x2 => x2.name === mat) ||
      root.RCDefine.ensure(app).materials.find(x2 => x2.type === 'concrete');
    const fc = matObj && matObj.conc ? matObj.conc.fc : 25;
    // sum beam moments at the joint per axis from the combo row members
    const src = root.RCModel.designSources(app, comboName)[0] || null;
    if (!src) return null;
    let MajX = 0, MajY = 0, nBeams = 0;
    const byId = new Map(src.members.filter(Boolean).map(mm => [mm.id, mm]));
    for (const mm of model.map) {
      if (!mm.ent || mm.ent.type !== 'beam') continue;
      const bel = model.frames[mm.idx];
      const a = model.nodes[bel.ni], b2 = model.nodes[bel.nj];
      const atJoint = Math.abs(a.z - topZ) < 0.3 && Math.hypot(a.x - cx, a.y - cy) < 0.6;
      const btJoint = Math.abs(b2.z - topZ) < 0.3 && Math.hypot(b2.x - cx, b2.y - cy) < 0.6;
      if (!atJoint && !btJoint) continue;
      const row = byId.get(mm.ent.id);
      if (!row) continue;
      nBeams++;
      const bl = mm.ent.params.baseline;
      const alongX = Math.abs(bl[1][0] - bl[0][0]) > Math.abs(bl[1][1] - bl[0][1]);
      const M = Math.max(Math.abs(row.Mi || 0), Math.abs(row.Mj || 0));
      if (alongX) MajX += M; else MajY += M;
    }
    if (!nBeams) return null;
    // joint geometry classification by how many beam directions frame in
    const dirs = new Set(model.map.filter(mm => {
      if (!mm.ent || mm.ent.type !== 'beam') return false;
      const bel = model.frames[mm.idx];
      const a = model.nodes[bel.ni], b2 = model.nodes[bel.nj];
      return (Math.abs(a.z - topZ) < 0.3 && Math.hypot(a.x - cx, a.y - cy) < 0.6) ||
             (Math.abs(b2.z - topZ) < 0.3 && Math.hypot(b2.x - cx, b2.y - cy) < 0.6);
    }).map(mm => {
      const bl = mm.ent.params.baseline;
      return Math.abs(bl[1][0] - bl[0][0]) > Math.abs(bl[1][1] - bl[0][1]) ? 'x' : 'y';
    }));
    const gamma = dirs.size >= 2 ? 1.66 : (dirs.size === 1 ? 1.25 : 1.0);
    const phi = 0.85;
    const capN = phi * gamma * Math.sqrt(fc) * bc * hc;
    const cap = capN / 1e3; // kN
    const VuX = MajX / 1e6 * 0; // placeholder: moment in kN·mm -> kN below
    const vuX = MajX / 1e6;     // kN·m→kN·m keep, joint shear ~ ΣM/h_col story
    const hStory = hgt * 1000;
    const Vjs = (MajX + MajY) / hStory; // N
    const ratio = Vjs / Math.max(capN, 1);
    return {
      nBeams, gamma, phi,
      Vjs_kN: +(Vjs / 1e3).toFixed(1),
      phiVn_kN: +cap.toFixed(1),
      ratio: +ratio.toFixed(3),
      ok: ratio <= 1,
      classification: dirs.size >= 2 ? 'interior' : dirs.size === 1 ? 'exterior' : 'corner',
    };
  }

  // ================================================== column shear (ETABS)
  // cDsnCodeConcRC_ACI_08.ColumnNetShearCapacity, psi form → SI:
  //   2√f'c→0.17√f'c, 500psi→3.45MPa, 2000psi→13.79MPa, 1.9√f'c→0.158√f'c,
  //   2500ρw→17.24ρw MPa, 3.5√f'c→0.291√f'c, 8√f'c→0.664√f'c; φVn = 0.8(Vc+Vs)
  function columnNetShearCapacitySI(Vu, Nu, Mu, fc, Acv, Ag, h, Av, s, fyt, rhoW) {
    const sq = Math.sqrt(fc);
    const num = 0.17 * sq * Acv;
    const val = num * (1 + Nu / (13.79 * Ag));
    const val2 = Mu > 1 ? (0.158 * sq + 17.24 * rhoW * (Vu * h / Mu)) * Acv : 0;
    const val3 = 0.291 * sq * Acv * Math.sqrt(1 + Math.max(Nu, 0) / (3.45 * Ag));
    const num2 = num * (1 + Nu / (3.45 * Ag));
    const Vc = (Nu < 0) ? num2 : (Nu > 0 ? Math.max(val, val3) : Math.max(num, val2));
    let Vs = s > 1 ? Av * fyt * h / s : 0;
    Vs = Math.min(Vs, 0.664 * sq * Acv);
    const phiVn = 0.8 * (Vc + Vs);
    const Avs = Math.max(0, (Vu / 0.8 - Vc) / (fyt * h)); // required Av/s when over
    return { Vc, Vs, phiVn, dcr: Vu / Math.max(phiVn, 1), Avs };
  }

  function designAllColumns(app, comboName, capType, minEcc) {
    const R = app.rcResults;
    if (!R) return { error: 'Run the analysis first (Analyze ▸ Run Analysis).' };
    const d = root.RCDefine.ensure(app);
    root.RCModel.ensureAutoCombos(app);

    // ETABS-style envelope: the named combo, or EVERY combo — max DCR governs
    const sources = root.RCModel.designSources(app, comboName);
    if (!sources.length)
      return { error: comboName ? `Combination or pattern "${comboName}" not found.` : 'No combos or patterns.' };

    const results = [];
    const shearMax = new Map();
    for (const src of sources) {
    for (const m of src.members) {
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
      // biaxial surface capacity (CSiCol parity): max of the capacity methods
      // over the NA-angle curve set — governs the DCR
      const bx = capacityBiaxial(sec, mat, Pu, Mx, My, capType);
      const dcr = Math.max(bx.dcr, 0);

      // column shear (cDsnCodeConcRC_ACI_08.ColumnNetShearCapacity, SI)
      const rb = sec.rebar || {};
      const db = parseFloat(rb.rebarSize) || 16;
      const nBars = 4 + 2 * (rb.nR3 || 0) + 2 * (rb.nR2 || 0);
      const Ast = nBars * Math.PI * db * db / 4;
      const tieDia = parseFloat(rb.tieSize) || 8;
      const Av = 2 * Math.PI * tieDia * tieDia / 4;
      const sTie = Math.max((rb.tieSpacingLongit || 0.15) * 1000, 40);
      const cover = (rb.colCover || 0.04) * 1000;
      const dEff = h - cover - tieDia - db / 2;
      const Vu = Math.max(Math.abs(m.Vi || 0), Math.abs(m.Vj || 0),
        Math.abs(m.V2i || 0), Math.abs(m.V2j || 0));
      const Nu = Pu; // compression positive (ETABS inNu convention)
      const shear = columnNetShearCapacitySI(Vu, Nu, Mx, fc,
        b * dEff, b * h, dEff, Av, sTie, 500, Ast / (b * dEff));

      // ETABS Concrete Joint Envelope parity: JS ratio at this column top
      const js = jointShearCheck(app, m, R.model, comboName);
      results.push({
        id: m.id, b, h, fc, fy: 500,
        Pu: Pu / 1e3, Mx: Mx / 1e6, My: My / 1e6,
        dcr, crStrong: cr0.dcr, crWeak: cr90.dcr,
        joint: js ? { Vjs_kN: js.Vjs_kN, phiVn_kN: js.phiVn_kN, ratio: js.ratio,
          ok: js.ok, type: js.classification, nBeams: js.nBeams } : null,
        biaxial: { method: bx.method, ang: bx.ang,
          ratioVec: bx.ratioVec, ratioSum: bx.ratioSum, ratioRay: bx.ratioRay,
          dcrAxial: bx.dcrAxial },
        shear: { Vu: Vu / 1e3, Vc: shear.Vc / 1e3, Vs: shear.Vs / 1e3,
          phiVn: shear.phiVn / 1e3, dcr: +shear.dcr.toFixed(3),
          Avs: +shear.Avs.toFixed(2) },
        Pcap: cr0.Pcap / 1e3,
        status: Math.max(dcr, shear.dcr, js ? js.ratio : 0) > 1 ? 'OVERSTRESSED' : Math.max(dcr, shear.dcr, js ? js.ratio : 0) > 0.9 ? 'NEAR LIMIT' : 'OK',
        pmCurve: pm0,
        combo: src.name,
      });
      const sh = shearMax.get(m.id) || 0;
      shearMax.set(m.id, Math.max(sh, shear.dcr));
    }
    }
    // envelope: worst PMM record per entity + worst shear DCR across combos
    const env = new Map();
    const score = r => r.dcr;
    for (const rec of results) {
      const prev = env.get(rec.id);
      if (!prev || score(rec) > score(prev)) env.set(rec.id, rec);
    }
    for (const rec of env.values())
      rec.shear.dcr = +(shearMax.get(rec.id) || rec.shear.dcr).toFixed(3);
    return { results: [...env.values()], comboName: comboName || 'ENVELOPE' };
  }

  // ============================================================ design dialog
  function open(app, cat) {
    if (cat !== 'columnDesign') return;
    const R = app.rcResults;
    if (!R) { app.toast('Run the analysis first', true); return; }
    const d = root.RCDefine.ensure(app);
    const comboNames = R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name);
    if (!comboNames.length) { app.toast('No load combinations or patterns defined', true); return; }

    const ENVELOPE_OPT = '<option value="ENVELOPE">ENVELOPE - all combinations (governing)</option>';
    const patOpts = ENVELOPE_OPT + comboNames.map(n => `<option value="${n}">${n}</option>`).join('');
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
      return `<tr style="cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='#f0f4f8'" onmouseout="this.style.background=''" title="Click to view Member Design Details" onclick="if(window.RCEtabsView)window.RCEtabsView.openMemberDesignWindow(window.app||window._app,'${esc(r.id)}','${esc(comboName)}')">` +
        `<td style="padding:3px 6px;color:#0b57d0;font-weight:bold;text-decoration:underline">${esc(r.id)}</td>` +
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
