// rcmc.js — ETABS Section-Designer-style fiber moment-curvature (M-φ).
// THE capacity-side consumer of the expected strengths Fye/Fue.
//
// Decompiled-ETABS grounding (D:\REA\ETABS\decompiled):
//   • The ACI 318-19 STRENGTH designers (j2.cs) read specified Fy only —
//     Fye/Fue never enter φPn/φMn/φVn. Do NOT wire them into rcbeam/rcslab/
//     rcwall strength checks.
//   • The HingeProp engine (amn.cs:1450, amm.cs, aoj.cs — "Assigning Hinge
//     Properties") builds calculated nonlinear hinge properties from the
//     rebar material's EXPECTED yield (aro.j[mat].n[1].j.c = Fye),
//     unconditionally.
//   • Section Designer exposes the same curve as a chart
//     (modCSI_SD.SDMomentCurvatureNew).
//
// TO ADD PUSHOVER / NONLINEAR HINGES LATER: consume hingeProps() below as
// the P-M2-M3 / M3 hinge defaults (My, Mmax, φy, φu, μφ, EI_eff) — that is
// exactly what ETABS does with the expected-strength M-φ curve. A steel
// Fye/Fu seismic-capacity overwrite (ETABS steel design overwrites) has no
// consumer here because steel frame design is not implemented in this app.
//
// Units: N, mm, MPa internally; dialog displays kN·m and 1/m.
(function (root) {
  'use strict';

  const Es = 200000;
  const DEFAULTS = { fy: 500, fue: 605, fye: 550, strainAtHardening: 0.0068, strainUltimate: 0.09 };

  // concrete: ETABS SSCurveOpt "Simple" — parabola to εc0 then plateau to εcu
  function concStress(ec, fc, ecu) {
    if (ec <= 0) return 0;
    const ec0 = 0.002;
    if (ec <= ec0) {
      const r = ec / ec0;
      return fc * (2 * r - r * r);
    }
    return fc; // plateau (no softening; Mander confined = future)
  }

  // steel: elastic → yield plateau → linear hardening capped at the tensile
  // strength (Fue specified, or Fue expected for the expected curve)
  function steelStress(es, fyE, fueE, esh, esu) {
    const esy = fyE / Es;
    const s = Math.sign(es), a = Math.abs(es);
    if (a <= esy) return Es * es;
    let f = fyE;
    if (a > esh && esu > esh) f = fyE + (fueE - fyE) * Math.min(1, (a - esh) / (esu - esh));
    return s * Math.min(f, fueE);
  }

  // fiber discretization: concrete strips full width + rebar points.
  // Rebar layout comes from the SAME generator the P-M engine uses.
  function sectionFibers(sec, cover) {
    const dims = sec.dims || {};
    const b = (dims.b || 0.3) * 1000;
    const h = (dims.h || 0.5) * 1000;
    const nL = 80;
    const dy = h / nL;
    const conc = [];
    for (let i = 0; i < nL; i++)
      conc.push({ y: h / 2 - dy * (i + 0.5), area: b * dy }); // y from centroid, + = up
    const bars = (root.RCColumn && root.RCColumn.rebarLayout
      ? root.RCColumn.rebarLayout(b, h, cover * 1000, sec.rebar || {})
      : []).map(p => ({ y: p.y, area: p.area }));
    return { b, h, conc, bars };
  }

  // section response at curvature φ with NA depth c measured from the TOP
  // face. ε(y) = φ·(c − d(y)), d(y) = h/2 − y. Compression positive.
  function sectionResponse(phi, c, fib, mats) {
    const h = fib.h;
    let N = 0, M = 0, ecTop = 0, esMax = 0;
    for (const f of fib.conc) {
      const d = h / 2 - f.y;
      const e = phi * (c - d);
      if (e > ecTop) ecTop = e;
      const s = concStress(e, mats.fc, mats.ecu);
      N += s * f.area;
      M += s * f.area * f.y;
    }
    for (const f of fib.bars) {
      const d = h / 2 - f.y;
      const e = phi * (c - d);
      const ae = Math.abs(e);
      if (ae > esMax) esMax = ae;
      const s = steelStress(e, mats.fyE, mats.fueE, mats.esh, mats.esu);
      N += s * f.area;
      M += s * f.area * f.y;
    }
    return { N, M, ecTop, esMax };
  }

  // NA depth by bisection — N(c) is monotonically increasing in c
  function solveC(phi, P, fib, mats) {
    let lo = -6 * fib.h, hi = 6 * fib.h;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const r = sectionResponse(phi, mid, fib, mats);
      if (r.N > P) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // One M-φ run with a given strength set (fyE = fy or fye).
  // Escalating-curvature sweep; stops at εcu (concrete), εsu (steel),
  // a 20% post-peak moment drop, or a sanity curvature bound.
  function mcRun(sec, cmat, rmat, P, expected) {
    const rm = Object.assign({}, DEFAULTS, rmat || {});
    const cover = (sec.rebar && sec.rebar.colCover) || 0.04;
    const fib = sectionFibers(sec, cover);
    const fyE = expected ? (rm.fye > 0 ? rm.fye : rm.fy) : rm.fy;
    const mats = {
      fc: cmat && cmat.conc ? cmat.conc.fc : 25,
      ecu: (cmat && cmat.conc && cmat.conc.strainUltimate) || 0.0035,
      fyE, fueE: expected ? (rm.fue > 0 ? rm.fue : rm.fu) : (rm.fu || rm.fue),
      esh: rm.strainAtHardening || 0.0068,
      esu: rm.strainUltimate || 0.09,
    };
    const esy = fyE / Es;
    // extreme tension bar depth from top (max d) for the yield flag
    let dMaxT = 0;
    for (const f of fib.bars) dMaxT = Math.max(dMaxT, fib.h / 2 - f.y);

    const pts = [];
    let phi = 1e-7, Mmax = 0, My = 0, phiY = 0, phiU = 0, stop = '';
    for (let i = 0; i < 500; i++) {
      const c = solveC(phi, P, fib, mats);
      const r = sectionResponse(phi, c, fib, mats);
      // M integrates to +sagging directly: compression top (y>0, σ>0) and
      // tension bottom (y<0, σ<0) both contribute +σ·A·y
      const eTens = phi * (c - dMaxT);
      if (!phiY && eTens <= -esy) { phiY = phi; My = r.M; }
      pts.push({ phi, M: r.M });
      if (r.M > Mmax) Mmax = r.M;
      phiU = phi;
      if (r.ecTop >= mats.ecu) { stop = 'εcu concrete'; break; }
      if (r.esMax >= mats.esu) { stop = 'εsu steel'; break; }
      if (Mmax > 0 && r.M < 0.8 * Mmax && pts.length > 5) { stop = '20% post-peak drop'; break; }
      if (phi > 0.12) { stop = 'curvature bound'; break; }
      phi *= 1.1;
    }
    // report in display units: φ 1/m, M kN·m
    const out = {
      pts: pts.map(p => ({ phi: p.phi * 1000, M: p.M / 1e6 })),
      My: My / 1e6, Mmax: Mmax / 1e6,
      phiY: phiY * 1000, phiU: phiU * 1000,
      muPhi: phiY > 0 ? (phiU / phiY) : 0,
      ELeff: phiY > 0 ? (My / phiY) : 0, // N·mm² per (1/mm) → effective EI
      stop,
    };
    return out;
  }

  // Both curves: specified (fy) AND expected (fye) — the dialog overlays
  // them; the hinge numbers come from the EXPECTED run (ETABS parity).
  function momentCurvature(sec, cmat, rmat, P) {
    return {
      specified: mcRun(sec, cmat, rmat, P, false),
      expected: mcRun(sec, cmat, rmat, P, true),
    };
  }

  // TO ADD PUSHOVER HINGES: assign these (from the expected-strength curve)
  // as the calculated P-M2-M3 / M3 hinge defaults — the ETABS HingeProp
  // path (decompiled amn.cs/aoj.cs "Assigning Hinge Properties").
  function hingeProps(sec, cmat, rmat, P) {
    return mcRun(sec, cmat, rmat, P, true);
  }

  // ============================================================ dialog / UI
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  function svgChart(spec, expd) {
    const W = 640, H = 330, L = 62, B = 40, T = 14, R = 14;
    const all = [...spec.pts, ...expd.pts];
    const maxM = Math.max(...all.map(p => p.M), 1);
    const maxP = Math.max(...all.map(p => p.phi), 1e-6);
    const x = p => L + (p.phi / maxP) * (W - L - R);
    const y = p => H - B - (p.M / maxM) * (H - B - T);
    const poly = pts => pts.map(p => `${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const gy = H - B - i * (H - B - T) / 4, gx = L + i * (W - L - R) / 4;
      grid += `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" stroke="#e3e8ee"/>` +
        `<text x="${L - 6}" y="${gy + 4}" text-anchor="end" font-size="10" fill="#5f6b76">${(maxM * i / 4).toFixed(0)}</text>`;
      if (i) grid += `<text x="${gx}" y="${H - B + 14}" text-anchor="middle" font-size="10" fill="#5f6b76">${(maxP * i / 4).toFixed(2)}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;background:#fff;border:1px solid #d7dde3;border-radius:6px">
      ${grid}
      <polyline points="${poly(spec.pts)}" fill="none" stroke="#8a94a0" stroke-width="1.6" stroke-dasharray="5 3"/>
      <polyline points="${poly(expd.pts)}" fill="none" stroke="#1565c0" stroke-width="2.2"/>
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#90a0ae"/>
      <line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="#90a0ae"/>
      <text x="${(W + L) / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#40484f">Curvature φ (1/m)</text>
      <text x="16" y="${(H - B + T) / 2}" font-size="11" fill="#40484f" transform="rotate(-90 16 ${(H - B + T) / 2})" text-anchor="middle">Moment M (kN·m)</text>
      <line x1="${W - 210}" y1="${T + 8}" x2="${W - 180}" y2="${T + 8}" stroke="#1565c0" stroke-width="2.2"/>
      <text x="${W - 174}" y="${T + 12}" font-size="11" fill="#1565c0">Expected (Fye/Fue)</text>
      <line x1="${W - 210}" y1="${T + 26}" x2="${W - 180}" y2="${T + 26}" stroke="#8a94a0" stroke-width="1.6" stroke-dasharray="5 3"/>
      <text x="${W - 174}" y="${T + 30}" font-size="11" fill="#5f6b76">Specified (fy/fu)</text>
    </svg>`;
  }

  function valueRows(label, r) {
    const f = (v, d = 1) => (v || 0).toFixed(d);
    return `<tr><td style="padding:3px 8px"><b>${label}</b></td>
      <td style="padding:3px 8px;text-align:right">${f(r.My)}</td>
      <td style="padding:3px 8px;text-align:right">${f(r.Mmax)}</td>
      <td style="padding:3px 8px;text-align:right">${f(r.phiY, 3)}</td>
      <td style="padding:3px 8px;text-align:right">${f(r.phiU, 2)}</td>
      <td style="padding:3px 8px;text-align:right">${f(r.muPhi)}</td>
      <td style="padding:3px 8px;text-align:right">${(r.ELeff / 1e12).toFixed(1)}</td>
      <td style="padding:3px 8px;font-size:10px;opacity:.75">${esc(r.stop)}</td></tr>`;
  }

  function render(app, out) {
    const el = document.getElementById('mc-out');
    if (!el) return;
    const s = out.specified, e = out.expected;
    el.innerHTML = svgChart(s, e) +
      '<table style="width:100%;border-collapse:collapse;font-size:11.5px;margin-top:8px">' +
      '<thead><tr style="text-align:right;opacity:.7"><th style="text-align:left;padding:3px 8px">Strength set</th>' +
      '<th style="padding:3px 8px">My (kN·m)</th><th style="padding:3px 8px">Mmax (kN·m)</th>' +
      '<th style="padding:3px 8px">φy (1/m)</th><th style="padding:3px 8px">φu (1/m)</th>' +
      '<th style="padding:3px 8px">μφ</th><th style="padding:3px 8px">EI_eff (kN·m²)</th>' +
      '<th style="padding:3px 8px;text-align:left">stop</th></tr></thead><tbody>' +
      valueRows('Specified (fy / fu)', s) + valueRows('Expected (Fye / Fue)', e) +
      '</tbody></table>' +
      '<p style="font-size:11px;opacity:.72;margin:8px 0 0">φy/My = first yield of the extreme tension bar · EI_eff = My/φy · ' +
      'ETABS calculated hinge properties use the <b>Expected</b> curve (decompiled HingeProp engine reads rebar Fye).</p>';
  }

  function open(app) {
    const d = root.RCDefine ? root.RCDefine.ensure(app) : { frameSections: [], materials: [] };
    const secs = (d.frameSections || []).filter(s => s.type === 'rect' && s.rebar);
    if (!secs.length) { app.toast('Define a rectangular frame section with rebar first', true); return; }
    const opts = secs.map(s => {
      const dims = s.dims || {};
      return `<option value="${esc(s.name)}">${esc(s.name)} — ${Math.round((dims.b || 0.3) * 1000)}×${Math.round((dims.h || 0.5) * 1000)} (${esc(s.designType || 'frame')})</option>`;
    }).join('');
    const html = `<div style="min-width:660px">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <label>Section <select id="mc-sec">${opts}</select></label>
        <label>Axial P (kN) <input id="mc-p" type="number" value="0" style="width:80px"></label>
        <button id="mc-run" class="btn" style="padding:4px 14px">Run M-φ</button>
        <span style="font-size:11px;opacity:.7">compression positive · fiber method</span>
      </div>
      <div id="mc-out"></div>
    </div>`;
    app.dialog('Moment Curvature (Section Designer parity — Fye/Fue)', html, [['Close', null]]);
    const run = () => {
      const sec = secs.find(s => s.name === document.getElementById('mc-sec').value) || secs[0];
      const P = Math.max(0, parseFloat(document.getElementById('mc-p').value) || 0) * 1000;
      const cmat = (d.materials || []).find(m => m.name === sec.material && m.conc) ||
        (d.materials || []).find(m => m.conc);
      const rmat = root.RCColumn ? root.RCColumn.resolveRebarMat(app, sec) : null;
      render(app, momentCurvature(sec, cmat, rmat, P));
    };
    document.getElementById('mc-run').addEventListener('click', run);
    run();
  }

  root.RCMC = { open, momentCurvature, hingeProps, concStress, steelStress };
})(window);
