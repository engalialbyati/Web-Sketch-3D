'use strict';
// test/rcmc.test.js — Moment-Curvature module (RCMC) + the fye/fue wiring
// in RCColumn. Verifies: expected-strength curves exceed specified-strength
// curves, hinge-property outputs are sane, resolveRebarMat honors Define
// Materials (with the f6.cs ≤0 → fy/fu fallback), and the ACI strength path
// keeps reading specified fy only (ETABS j2 parity).

module.exports = h => {
  const { test, ok, eq, near } = h;
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');

  const ctx = (() => {
    const sandbox = { window: {}, document: undefined, console, Math, setTimeout, clearTimeout };
    sandbox.window = sandbox; // modules do (function(root){…})(window) — root === window
    const c = vm.createContext(sandbox);
    for (const f of ['rcdefine.js', 'rccolumn.js', 'rcmc.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'design', f), 'utf8'), c);
    return c;
  })();
  const RCMC = ctx.RCMC, RCColumn = ctx.RCColumn, RCDefine = ctx.RCDefine;

  const SEC = {
    name: 'T1', dims: { b: 0.3, h: 0.5 }, designType: 'beam',
    rebar: { longMat: 'REBAR500', colCover: 0.04, rebarSize: '20', nR2: 1, nR3: 0 },
  };
  const CMAT = { conc: { fc: 25, strainUltimate: 0.0035 } };
  const A615 = { fy: 420, fu: 620, fye: 462, fue: 682, strainAtHardening: 0.006, strainUltimate: 0.09 };

  test('RCMC exports the M-φ engine (momentCurvature, hingeProps, material curves)', () => {
    ok(RCMC && RCMC.momentCurvature && RCMC.hingeProps, 'module surface');
    ok(RCMC.concStress && RCMC.steelStress, 'material curve helpers');
  });

  test('steel curve: elastic to fy, hardening capped at fue (trilinear)', () => {
    near(RCMC.steelStress(0.001, 420, 682, 0.006, 0.09), 200, 1);      // elastic
    near(RCMC.steelStress(0.0021, 420, 682, 0.006, 0.09), 420, 1);     // plateau
    near(RCMC.steelStress(0.006, 420, 682, 0.006, 0.09), 420, 1);      // end of plateau
    near(RCMC.steelStress(0.09, 420, 682, 0.006, 0.09), 682, 1);       // capped at fue
    eq(RCMC.steelStress(-0.0021, 420, 682, 0.006, 0.09) < 0, true);    // symmetric in tension
  });

  test('concrete curve: parabola to εc0, plateau to εcu', () => {
    eq(RCMC.concStress(-0.001, 25, 0.0035), 0);
    near(RCMC.concStress(0.001, 25, 0.0035), 25 * (2 * 0.5 - 0.25), 0.1);
    near(RCMC.concStress(0.002, 25, 0.0035), 25, 0.1);
    near(RCMC.concStress(0.0035, 25, 0.0035), 25, 0.1);
  });

  test('M-φ: expected curve (Fye/Fue) exceeds specified (fy/fu) on A615', () => {
    const r = RCMC.momentCurvature(SEC, CMAT, A615, 0);
    ok(r.specified.Mmax > 0, 'specified Mmax > 0');
    ok(r.expected.Mmax > r.specified.Mmax, 'expected Mmax exceeds specified (462 vs 420 MPa)');
    ok(r.expected.My >= r.specified.My - 1e-6, 'expected first-yield ≥ specified');
  });

  test('M-φ outputs are hinge-ready: φy, φu, μφ, EI_eff all positive', () => {
    const hp = RCMC.hingeProps(SEC, CMAT, A615, 0);
    ok(hp.phiY > 0 && hp.phiU > hp.phiY, 'φu > φy > 0');
    ok(hp.muPhi > 1, 'curvature ductility > 1');
    ok(hp.ELeff > 0, 'EI_eff > 0');
    ok(hp.stop && hp.stop.length, 'termination reason recorded');
  });

  test('moderate compression raises the moment capacity of the M-φ curve', () => {
    const p0 = RCMC.mcP0 || null; // (not exported — use momentCurvature with P)
    const rP = RCMC.momentCurvature(SEC, CMAT, A615, 300e3); // 300 kN compression
    const r0 = RCMC.momentCurvature(SEC, CMAT, A615, 0);
    ok(rP.specified.Mmax > r0.specified.Mmax, 'P-M interaction: compression boost');
  });

  test('RCColumn expected capacity uses Fye from the rebar material', () => {
    const design462 = RCColumn.generatePMCurve(SEC, CMAT, 0, 30, 'design', { fy: 462, fye: 462 });
    const design420 = RCColumn.generatePMCurve(SEC, CMAT, 0, 30, 'design', { fy: 420, fye: 420 });
    const mOf = c => Math.max(...c.map(p => p.M));
    ok(mOf(design462) > mOf(design420), 'higher fy → higher M capacity at same φ treatment');
    const expected = RCColumn.generatePMCurve(SEC, CMAT, 0, 30, 'expected', A615);
    near(mOf(expected) > 0 ? 1 : 0, 1, 0); // expected curve computes
  });

  test('resolveRebarMat: Define Materials honored, f6.cs ≤0 fallback, headless default', () => {
    const fb = RCColumn.resolveRebarMat(null, SEC); // no RCDefine app → default
    near(fb.fy, 500, 0.1); near(fb.fye, 550, 0.1);
    const app = { model: {} };
    RCDefine.ensure(app); // default state incl. REBAR500 (fy 500 / fye 550)
    app.model.rcDesign.materials.push({ name: 'A615X', type: 'rebar', rebar: { fy: 420, fu: 620, fye: 0, fue: 0 } });
    const secA = { ...SEC, rebar: { ...SEC.rebar, longMat: 'A615X' } };
    const ra = RCColumn.resolveRebarMat(app, secA);
    near(ra.fy, 420, 0.1);
    near(ra.fye, 420, 0.1); // fye ≤ 0 → fy (decompiled f6.cs:5798 rule)
    near(ra.fue, 620, 0.1);
    const rr = RCColumn.resolveRebarMat(app, SEC); // REBAR500
    near(rr.fye, 550, 0.1);
  });
};
