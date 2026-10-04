'use strict';
// rcdesign.js — Reinforced Concrete design per ACI 318-19.
//
// Beams: flexural capacity φMn vs Mu (§22.2), minimum reinforcement
// (§9.6.1.2), shear capacity φVc + φVs vs Vu (Table 22.5.5.1 + §22.5.10),
// stirrup spacing limits (§9.7.6.2).
//
// Columns: P-M interaction diagram via the strain-compatibility method
// (§22.2 / R22.2) — a rectangular section with bars at the four corners,
// capacity points from pure compression to pure tension, φ factors per
// Table 21.2.2 (spiral vs tie), then check (Pu, Mu) against the curve.
//
// Materials: f'c, fy, Es = 200,000 MPa. Units: internal mm and N, display m.
(function () {
  const Es = 200000; // MPa (ACI §20.2.2.2, also 29,000 ksi)
  const MPa = 1;      // internal unit
  const mm = 1;       // internal unit

  // ================================================================ beams
  // Flexural strength of a singly-reinforced rectangular beam.
  //   b, h in mm; As in mm²; d = effective depth (mm)
  // Returns { a, c, Mn, phi, phiMn } (kN·m)
  function beamFlexure(fc, fy, b, h, As, d, cover) {
    if (!d) d = h - (cover != null ? cover : 40) - 10; // one bar layer ~Ø20 + half stirrup
    const fcMPa = fc, fyMPa = fy;
    // equivalent stress block (Table 22.2.2.4.3)
    const beta1 = fcMPa >= 17 && fcMPa <= 28 ? 0.85
      : fcMPa > 28 ? Math.max(0.65, 0.85 - 0.05 * (fcMPa - 28) / 7)
        : 0.85;
    const a = As * fyMPa / (0.85 * fcMPa * b); // mm
    const c = a / beta1;                        // neutral axis depth
    const Mn = As * fyMPa * (d - a / 2) / 1e6;  // kN·m (N·mm → kN·m)
    // φ per Table 21.2.2: 0.90 tension-controlled, 0.65 compression
    const et = 0.003 * (d - c) / c;              // net tensile strain
    let phi;
    if (et >= 0.005) phi = 0.90;
    else if (et >= Math.min(0.002, fyMPa /Es)) phi = 0.65 + (et - (fyMPa / Es)) / 0.008 * 0.25;
    else phi = 0.65;
    return { a, c, Mn, phi: Math.max(0.65, phi), phiMn: Math.max(0.65, phi) * Mn, d, beta1 };
  }

  // Minimum flexural reinforcement (§9.6.1.2)
  function beamMinSteel(fc, fy, b, h) {
    const rho1 = 0.25 * Math.sqrt(fc) / fy;
    const rho2 = 1.4 / fy;
    return Math.max(rho1, rho2) * b * h; // mm²
  }

  // Maximum reinforcement: εt ≥ 0.004 (§9.3.3.1)
  function beamMaxSteel(fc, fy, b, d, cover) {
    // for εt = 0.004: c/d = 0.003/(0.003+0.004) = 3/7
    const cd = 3 / 7;
    const c = cd * d;
    const beta1 = beamFlexure(fc, fy, b, d * 1.2, 1, d).beta1;
    return 0.85 * fc * b * beta1 * c / fy;
  }

  // Concrete shear strength Vc (ACI 318-19 Table 22.5.5.1 — simplified Eq. a)
  //   Vc = 0.17λ√f'c · bw·d   [N]
  function beamShearVc(fc, bw, d) {
    return 0.17 * Math.sqrt(fc) * bw * d; // N
  }

  // Required stirrup Av/s for Vu > φVc (§22.5.10.5.3):
  //   φVs = Vu - φVc; Av/s = φVs / (fy · d)
  function beamStirrups(fc, fy, bw, d, Vu, AvProvided, sProvided) {
    const phi = 0.75; // shear φ (Table 21.2.1)
    const Vc = beamShearVc(fc, bw, d);
    const phiVc = phi * Vc;
    let VsReq = 0;
    if (Vu > phiVc) VsReq = (Vu - phiVc) / phi;
    // Av/s required
    const AvsReq = VsReq > 0 ? VsReq / (fy * d) : 0; // mm²/mm
    // minimum shear reinforcement when Vu > φVc/2 (§9.6.3.4)
    const AvsMin = 0.062 * Math.sqrt(fc) * bw / fy;
    const AvsGov = Math.max(AvsReq, Vu > phiVc / 2 ? AvsMin : 0);
    // spacing limits (§9.7.6.2.2)
    const sMax = VsReq > 0 ? (VsReq <= 0.33 * Math.sqrt(fc) * bw * d ? Math.min(d / 2, 600) : Math.min(d / 4, 300)) : Math.min(d / 2, 600);
    // provided capacity
    const AvsProv = AvProvided && sProvided ? AvProvided / sProvided : 0;
    const VsProv = AvsProv * fy * d;
    const phiVn = phi * (Vc + VsProv);
    return { Vc, phiVc, VsReq, AvsGov, sMax, AvsProv, phiVn, DCR: Vu / (phiVn || 1) };
  }

  // Full beam design check: returns pass/fail + capacity ratios
  function designBeam(sec, Mu, Vu) {
    // sec: {b, h, cover, fc, fy, top: {As, bars}, bot: {As, bars}, stirrups: {Av, s}}
    const b = sec.b, h = sec.h, cover = sec.cover != null ? sec.cover : 40;
    const fc = sec.fc || 30, fy = sec.fy || 420;
    const d = h - cover - 12; // one layer of Ø20 + stirrup Ø10
    const AsBot = sec.bot && sec.bot.As ? sec.bot.As : 0;
    const AsTop = sec.top && sec.top.As ? sec.top.As : 0;
    const AsMin = beamMinSteel(fc, fy, b, h);
    const AsMax = beamMaxSteel(fc, fy, b, d, cover);
    const flexPos = beamFlexure(fc, fy, b, h, AsBot, d, cover);
    const flexNeg = beamFlexure(fc, fy, b, h, AsTop, d, cover);
    const Av = sec.stirrups ? sec.stirrups.Av : 101;      // Ø10-2leg = 157, Ø8-2leg = 101
    const s = sec.stirrups ? sec.stirrups.s : 200;
    const shear = beamStirrups(fc, fy, b, d, Vu, Av, s);
    return {
      ok: flexPos.phiMn >= Math.abs(Mu) && shear.phiVn >= Math.abs(Vu) && AsBot >= AsMin,
      dcr: {
        flexurePos: Math.abs(Mu) / (flexPos.phiMn || 1),
        flexureNeg: Math.abs(Mu) / (flexNeg.phiMn || 1),
        shear: shear.DCR,
      },
      AsMin, AsMax, AsBot, AsTop,
      phiMnPos: flexPos.phiMn, phiMnNeg: flexNeg.phiMn,
      shear,
      detail: {
        stirrupAvs: shear.AvsGov,
        stirrupSMax: shear.sMax,
        spacingOK: s <= shear.sMax,
      },
    };
  }

  // ================================================================ columns
  // P-M interaction curve by strain compatibility. Rectangular section with
  // 2 bars per face (or a user-specified rebar layout), symmetric.
  //   b, h in mm; bars: [{x, y, As}] with the origin at the centroid
  // Returns points [{P, M, phi, label}] in kN, kN·m.
  function columnPM(fc, fy, b, h, bars, esType) {
    const ey = 0.003; // ultimate concrete strain (function-scope for the balanced point)
    const phiSpiral = esType === 'spiral';
    const pts = [];
    const barRows = new Map();
    for (const bar of bars) {
      const k = bar.y.toFixed(1);
      if (!barRows.has(k)) barRows.set(k, { y: bar.y, As: 0 });
      barRows.get(k).As += bar.As;
    }
    const rows = [...barRows.values()].sort((a, b2) => b2.y - a.y); // top first
    const N = 40;
    const beta1 = fc >= 17 && fc <= 28 ? 0.85
      : fc > 28 ? Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7) : 0.85;
    for (let i = 0; i <= N; i++) {
      // c from h+0.5h (below the section: pure compression) to -0.5h (pure tension)
      const t = i / N;
      const c = (h * 1.5) * (1 - t) - h * 0.5; // c: 1.5h → -0.5h
      const yN = h / 2; // top fiber at +h/2
      // concrete compression zone: y from yN down to yN - c (c = depth)
      // Whitney block: from yN down to yN - β1·c
      const aBlock = Math.min(Math.max(beta1 * c, 0), h);
      const Cc = 0.85 * fc * b * aBlock; // N (compression positive)
      // steel forces
      let Fs = 0, Ms = 0;
      for (const row of rows) {
        const yBar = row.y;
        const dBar = h / 2 - yBar; // distance from the top fiber
        const strain = c > 0 ? ey * (c - dBar) / c : -fy / Es;
        const stress = Math.max(-fy, Math.min(fy, strain * Es));
        const F = stress * row.As; // + compression
        Fs += F;
        Ms += F * yBar; // about the centroid
      }
      // φ: 0.65 (ties) / 0.75 (spiral) compression-controlled → 0.90 tension
      const et = c > 0 ? ey * (c - h) / c : 10; // strain at the tension face (h = distance to the bottom steel)
      let phi;
      if (et >= 0.005) phi = 0.90;
      else if (et >= 0.002) phi = (phiSpiral ? 0.75 : 0.65) + (et - 0.002) / 0.003 * 0.25;
      else phi = phiSpiral ? 0.75 : 0.65;
      const P = (Cc + Fs) * phi / 1000;   // kN
      const M = (Cc * (h / 2 - aBlock / 2) + Ms) * phi / 1e6; // kN·m (about the centroid)
      pts.push({ c, P, M: Math.abs(M), phi, et });
    }
    // balanced point
    const cb = ey / (ey + fy / Es) * h;
    return { pts, balanced: cb };
  }

  // Column design check: is (Pu, Mu) inside the interaction curve?
  function checkColumn(sec, Pu, Mu) {
    const b = sec.b, h = sec.h;
    const fc = sec.fc || 30, fy = sec.fy || 420;
    const cover = sec.cover != null ? sec.cover : 40;
    const bars = sec.bars || [
      // 4Ø20 default
      { x: -b / 2 + cover, y: h / 2 - cover, As: 314 },
      { x: b / 2 - cover, y: h / 2 - cover, As: 314 },
      { x: -b / 2 + cover, y: -h / 2 + cover, As: 314 },
      { x: b / 2 - cover, y: -h / 2 + cover, As: 314 },
    ];
    const { pts } = columnPM(fc, fy, b, h, bars, sec.ties);
    // The capacity M at Pu: interpolate the curve at P = Pu
    let Mcap = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i], p2 = pts[i + 1];
      const P1 = p1.P, P2 = p2.P;
      if ((Pu >= P1 && Pu <= P2) || (Pu >= P2 && Pu <= P1)) {
        const t = (Pu - P1) / (P2 - P1 || 1);
        Mcap = p1.M + t * (p2.M - p1.M);
        break;
      }
      // track the max M across the full curve for the report
      if (p1.M > Mcap && Pu <= p1.P) Mcap = p1.M * 0; // reset logic below
    }
    // simpler: find the point where P is closest to Pu and take its M
    let best = null;
    for (const p of pts) {
      if (Pu >= 0 ? p.P >= 0 : false) {
        if (best === null || Math.abs(p.P - Pu) < Math.abs(best.P - Pu)) best = p;
      }
    }
    if (best) Mcap = best.M;
    const PuMax = Math.max(...pts.map(p => p.P));
    const AsTot = bars.reduce((s, bar) => s + bar.As, 0);
    const Ag = b * h;
    return {
      ok: Mu <= Mcap && Pu <= PuMax,
      Mcap, PuMax,
      DCR: {
        moment: Math.abs(Mu) / (Mcap || 1),
        axial: Pu / (PuMax || 1),
      },
      AsTot, rho: AsTot / Ag,
      minRho: 0.01, maxRho: 0.08, // §10.3.1.1 / practical
      pts,
    };
  }

  // Default bar layouts for common column sizes
  function defaultBars(b, h, nPerFace, dia) {
    const cover = 40;
    const As1 = Math.PI / 4 * dia * dia;
    const bars = [];
    const xs = [];
    for (let i = 0; i < nPerFace; i++) {
      xs.push(-b / 2 + cover + (b - 2 * cover) * (nPerFace === 1 ? 0.5 : i / (nPerFace - 1)));
    }
    for (const y of [h / 2 - cover, -h / 2 + cover])
      for (const x of xs) bars.push({ x, y, As: As1 });
    // intermediate bars on the side faces (for large columns)
    if (nPerFace > 2) {
      for (const x of [-b / 2 + cover, b / 2 - cover])
        for (let i = 1; i < nPerFace - 1; i++)
          bars.push({ x, y: -h / 2 + cover + (h - 2 * cover) * i / (nPerFace - 1), As: As1 });
    }
    return bars;
  }

  // ======================================================== deflection (§24.2)
  // Immediate deflection of a simply supported / continuous beam under
  // uniform load, using the cracked section Icr (§24.2.3.6) and effective
  // Ie (§24.2.3.5 Branson).
  function beamDeflection(span, w, b, h, As, fc, fy, continuous) {
    const d = h - 50;
    const Ec = 4700 * Math.sqrt(fc); // MPa (19.2.2.1.b)
    // cracked neutral axis
    const n = Ec * 1 / (4700 * Math.sqrt(fc)); // modular ratio = 1 by definition
    const rho = As / (b * d);
    // x = sqrt(2ρn + (ρn)²) · d - ρn·d  (from n·As·(d-x) = b·x²/2)
    const rn = (Ec / Es) * 1e0 * 0 + 9; // n = Ec/Es ≈ 8-9 for concrete
    const rhoN = rho * rn;
    const x = (Math.sqrt(2 * rhoN + rhoN * rhoN) - rhoN) * d;
    const Icr = b * x * x * x / 3 + rn * As * (d - x) * (d - x); // mm⁴
    const Ig = b * h * h * h / 12;                                   // mm⁴
    // cracking moment (§24.2.3.6)
    const fr = 0.62 * Math.sqrt(fc); // modulus of rupture
    const Mcr = fr * Ig / (h / 2) / 1e6; // kN·m
    const wNmm = w * 1000 / 1000; // assume w in kN/m → N/mm
    const Mmax = continuous ? wNmm * span * span * 1000 / 10 : wNmm * span * span * 1000 / 8; // N·mm
    // Branson's effective I
    const Ie = Mmax <= Mcr ? Ig : Ig;
    const IeCr = Mmax > Mcr ? Math.min(Ig, Mcr / Mmax ** 3 * Ig + (1 - Mcr / Mmax ** 3) * Icr) : Ig;
    // deflection (mm)
    const k = continuous ? 1 / 384 / 2 : 5 / 384; // factor (continuous ~ wL⁴/384EI)
    const delta = k * wNmm * (span * 1000) ** 4 / (Ec * IeCr);
    // limits (Table 24.2.2)
    return {
      delta: Math.abs(delta),
      limit: span * 1000 / (continuous ? 480 : 240),
      Icr, Ig, Ie: IeCr, Mcr, Mmax: Mmax / 1e6,
    };
  }

  window.RCDesign = {
    beamFlexure, beamMinSteel, beamMaxSteel, beamShearVc, beamStirrups, designBeam,
    columnPM, checkColumn, defaultBars, beamDeflection,
    Es,
  };
})();
