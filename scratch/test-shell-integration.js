'use strict';
// Integration test: shell force pipeline → wall base forces → punching/SBE math.
// Loads fea.js + rcwall.js + rcslab.js into a vm sandbox and exercises the
// same code paths the app uses (no DOM, no app stubs beyond what's needed).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { window: {}, console, Math };
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['js/geometry.js', 'js/design/fea.js', 'js/design/rcwall.js', 'js/design/rcslab.js', 'js/design/rccolumn.js', 'js/design/rcbeam.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const { FEA, RCWall, RCSlab, RCBeam } = sandbox;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const near = (a, b, tolPct) => Math.abs(a - b) <= Math.abs(b) * tolPct / 100;

// ---------------------------------------------------------- cantilever wall
// L×H×0.2 m mesh nx×nz, fixed base, 100 kN in-plane at top.
// Statics at the base cut: V = 100 kN, M = 300 kN·m, P = 0. V/P are exact for
// any mesh (constant resultants); M converges with refinement because
// center-point recovery samples the step-stress field (peak-loss at ends).
function wallCase(nx, nz) {
  const Lw = 4.0, Hw = 3.0, tmm = 200, E = 25000, nu = 0.2;
  const nodes = [], shells = [];
  const row = [];
  for (let j = 0; j <= nz; j++) {
    const rj = [];
    for (let i = 0; i <= nx; i++) {
      const base = j === 0;
      nodes.push({ x: Lw * i / nx, y: 0, z: Hw * j / nz,
        fixed: base ? [1, 1, 1, 1, 1, 1] : [0, 0, 0, 0, 0, 1] });
      rj.push(nodes.length - 1);
    }
    row.push(rj);
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      shells.push({ n1: row[j][i], n2: row[j][i + 1], n3: row[j + 1][i + 1], n4: row[j + 1][i],
        E, nu, t: tmm, entId: 'w1' });
  const load = new Map();
  for (let i = 0; i <= nx; i++)
    load.set(row[nz][i], [100e3 / (nx + 1), 0, 0, 0, 0, 0]); // 100 kN total, +x
  const r = FEA.assembleAndSolve(nodes, [], shells, [load]);
  const sf = FEA.shellForces(nodes, shells, r.U[0]);
  const wf = RCWall.wallBaseForces({ nodes, shells }, sf, { id: 'w1', params: { base: [0, 0, 0] } });
  return wf;
}

console.log('cantilever wall — shell membrane integration (statics)');
{
  const wf = wallCase(4, 3);
  ok(wf && wf.base, 'wallBaseForces produced base + top stations');
  const B = wf.base;
  ok(near(Math.abs(B.V), 100e3, 1), `base shear V = ${(Math.abs(B.V) / 1e3).toFixed(1)} kN (exact 100)`);
  ok(near(Math.abs(B.M), 300e6, 30), `base moment M coarse mesh = ${(Math.abs(B.M) / 1e6).toFixed(1)} kN·m (target 300, coarse mesh expected low)`);
  ok(Math.abs(B.P) < 15e3, `axial P ≈ 0 without gravity (${(B.P / 1e3).toFixed(1)} kN)`);
  ok(wf.top && near(Math.abs(wf.top.V), 100e3, 20), `top-station shear present (${wf.top ? (Math.abs(wf.top.V) / 1e3).toFixed(1) : '—'} kN)`);
  ok(wf.top && Math.abs(wf.top.M) < Math.abs(B.M), `top moment below base (${wf.top ? (Math.abs(wf.top.M) / 1e6).toFixed(1) : '—'} vs ${(Math.abs(B.M) / 1e6).toFixed(1)} kN·m)`);

  const wf8 = wallCase(8, 6);
  ok(Math.abs(wf8.base.M) > Math.abs(B.M), `moment converges upward with mesh refinement (${(Math.abs(wf8.base.M) / 1e6).toFixed(1)} kN·m)`);
  ok(near(Math.abs(wf8.base.M), 300e6, 12), `refined moment within 12% (${(Math.abs(wf8.base.M) / 1e6).toFixed(1)} kN·m)`);
}

// ---------------------------------------------------- gravity + lateral wall
console.log('cantilever wall — axial under top gravity');
{
  const Lw = 4.0, Hw = 3.0, tmm = 200, E = 25000, nu = 0.2;
  const nx = 4, nz = 3;
  const nodes = [], shells = [];
  for (let j = 0; j <= nz; j++) {
    const rj = [];
    for (let i = 0; i <= nx; i++) {
      const base = j === 0;
      nodes.push({ x: Lw * i / nx, y: 0, z: Hw * j / nz, fixed: base ? [1, 1, 1, 1, 1, 1] : [0, 0, 0, 0, 0, 1] });
      rj.push(nodes.length - 1);
    }
    if (j > 0) continue;
  }
  const row = [];
  for (let j = 0; j <= nz; j++) {
    const rj = [];
    for (let i = 0; i <= nx; i++) rj.push(j * (nx + 1) + i);
    row.push(rj);
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      shells.push({ n1: row[j][i], n2: row[j][i + 1], n3: row[j + 1][i + 1], n4: row[j + 1][i],
        E, nu, t: tmm, entId: 'w1' });

  // 400 kN down at the top row + the same 100 kN lateral
  const load = new Map();
  for (let i = 0; i <= nx; i++)
    load.set(row[nz][i], [100e3 / (nx + 1), 0, -400e3 / (nx + 1), 0, 0, 0]);
  const r = FEA.assembleAndSolve(nodes, [], shells, [load]);
  const sf = FEA.shellForces(nodes, shells, r.U[0]);
  const wf = RCWall.wallBaseForces({ nodes, shells }, sf, { id: 'w1', params: { base: [0, 0, 0] } });
  ok(near(Math.abs(wf.base.P), 400e3, 10), `axial P = ${(Math.abs(wf.base.P) / 1e3).toFixed(0)} kN compression (target 400)`);
  // punching/SBE inputs stay finite
  ok(Number.isFinite(wf.base.P) && Number.isFinite(wf.base.V) && Number.isFinite(wf.base.M), 'P/V/M finite');
}

// ---------------------------------------------------- cantilever strip Q
console.log('cantilever strip — transverse shear Q11 (statics)');
{
  // strip along x: 4 m × 1 m, 4 cells, fixed at x=0, tip load P at x=4.
  // Statics: every section carries Q·width = P — no load between sections.
  const nx = 4, ny = 1, tmm = 200, E = 25000, nu = 0.2, P = 50e3;
  const nodes = [], shells = [];
  const row = [];
  for (let j = 0; j <= ny; j++) {
    const rj = [];
    for (let i = 0; i <= nx; i++) {
      const fixed = i === 0;
      nodes.push({ x: i, y: j, z: 0,
        fixed: fixed ? [1, 1, 1, 1, 1, 1] : [0, 0, 0, 0, 0, 1] });
      rj.push(nodes.length - 1);
    }
    row.push(rj);
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      shells.push({ n1: row[j][i], n2: row[j][i + 1], n3: row[j + 1][i + 1], n4: row[j + 1][i],
        E, nu, t: tmm, entId: 'strip' });
  const load = new Map();
  for (let j = 0; j <= ny; j++)
    load.set(row[j][nx], [0, 0, -P / 2, 0, 0, 0]);
  const r = FEA.assembleAndSolve(nodes, [], shells, [load]);
  const sf = FEA.shellForces(nodes, shells, r.U[0]);
  const width = 1000; // mm
  const Qcells = sf.map(s => Math.abs(s.forces.Q11) * width);
  ok(Qcells.every(q => Number.isFinite(q)), 'Q11 finite in every cell');
  const qMax = Math.max(...Qcells), qMin = Math.min(...Qcells);
  ok(near(qMax, P, 12), `max cell shear Q = ${(qMax / 1e3).toFixed(1)} kN (target ${P / 1e3})`);
  ok(near(qMin, P, 25), `min cell shear Q = ${(qMin / 1e3).toFixed(1)} kN (constant between loads)`);
}

// ---------------------------------------------------- punching + SBE math
console.log('punching + SBE screening functions');
{
  const p = RCSlab.punchingShear(800e3, 40e6, 0, 400, 400, 165, 25, 'interior');
  ok(Number.isFinite(p.dcr) && p.dcr > 0, `interior DCR finite (${p.dcr})`);
  // SI physics lock (ACI 22.6.5.2 metric): 400 col, d=165, fc=25, bo=2260
  // φVc = 0.75 × 0.33√25 × 2260 × 165 = 461.5 kN (was ~5.5 MN with psi coeffs)
  ok(Math.abs(p.Vc - 461.5e3) < 5e3, `interior φVc SI correct (${(p.Vc / 1e3).toFixed(1)} kN)`);
  const pe = RCSlab.punchingShear(400e3, 20e6, 0, 400, 400, 165, 25, 'edge');
  ok(pe.bo < p.bo, `edge perimeter smaller (${pe.bo} < ${p.bo})`);
  const dp = RCSlab.checkPunchingAtDropPanel(1200e3, 60e6, 1500, 1500, 350, 200, 25, 16, 25, 400, 400);
  ok(Number.isFinite(dp.dcr), `drop-panel check finite (${dp.dcr}), no vmin crash`);
  const sbe = sandbox.evalSBE ? sandbox.evalSBE() : null;
  // SBE NA screen: fiber sweep c at a given axial (monotone, 0 in tension)
  const fc = 25, beta1 = RCWall.beta1(fc);
  const lwT = 3000, hwT = 200;
  const barsT = RCWall.wallBars(lwT, hwT, 40, 12, 9, 2, 16);
  const pmT = RCWall.wallPM(lwT, hwT, fc, 500, barsT, 30);
  const cAtP0 = RCWall.wallNAatP(pmT, 0);
  const pMax = Math.max(...pmT.map(p => p.P));
  const cAtHalf = RCWall.wallNAatP(pmT, pMax / 2);
  const cAtFull = RCWall.wallNAatP(pmT, pMax);
  ok(beta1 > 0.6 && beta1 <= 0.85, `beta1(25) = ${beta1}`);
  ok(cAtP0 > 0 && cAtP0 < lwT / 4, `c at pure bending = ${cAtP0.toFixed(0)} mm (flexural NA, < lw/4)`);
  ok(cAtHalf > 0 && cAtHalf < lwT && cAtHalf < cAtFull, `c monotone: ${cAtHalf.toFixed(0)} mm at P0/2 < ${cAtFull === Infinity ? '∞' : cAtFull.toFixed(0)} at P0`);
}

// ------------------------------------------------- column P-M envelope
console.log('column P-M curve — compression-first envelope + capacity side');
{
  const { generatePMCurve, capacityRatio } = sandbox.RCColumn;
  const sec = { name: 'T400', dims: { b: 0.4, h: 0.4 }, rebar: {} };
  const mat = { conc: { fc: 25 } };
  const pm = generatePMCurve(sec, mat, 0, 30);
  const pMax = Math.max(...pm.map(p => p.P));
  const p0 = 0.85 * 25 * 400 * 400; // concrete alone ≈ 3.4e6 N
  ok(pMax > 0.45 * p0 && pMax < 0.9 * p0, `pure-compression φPn present (${Math.round(pMax / 1e3)} kN in 0.45–0.9·Pc)`);
  ok(pm[0].P === pMax, 'curve ordered compression-first (P[0] is the max)');
  ok(pm[pm.length - 1].P < 0, 'pure-tension end negative');
  // capacity side: compression demand takes the compression leg, not the
  // tension leg at the same M
  const mAt = pm[Math.floor(pm.length / 2)].M;
  const cr = capacityRatio(500e3, mAt, pm);
  ok(cr.Pcap > 0 && cr.dcr > 0 && cr.dcr < 99, `compression demand → Pcap ${Math.round(cr.Pcap / 1e3)} kN, DCR ${cr.dcr.toFixed(2)}`);
}

// -------------------------------------------- end offsets + face extraction
console.log('end offsets — design forces at member faces');
{
  // synthetic station table: L = 6 m, M linear -50 → +30 kN·m, V 80 → -100 kN
  const st = [];
  for (let k = 0; k <= 10; k++) {
    const x = 6 * k / 10;
    st.push({ x, M: -50 + k * 8, V: 80 - k * 18 });
  }
  const m = { stations: st, offI: 200, offJ: 400 };
  // slopes: ΔM = 8 per 0.6 m step → 13.333/m; ΔV = -18 per step → -30/m
  const fi = RCBeam.stationAt(m, 200);
  ok(Math.abs(fi.M - (-50 + 0.2 * 8 / 0.6)) < 1e-9, `stationAt at 200 mm: M = ${fi.M.toFixed(2)} (linear bracket)`);
  ok(Math.abs(fi.V - (80 - 0.2 * 30)) < 1e-9, `shear at face V = ${fi.V.toFixed(1)} kN`);
  const fj = RCBeam.stationAt(m, 6000 - 400);
  ok(Math.abs(fj.M - (-50 + 5.6 * 8 / 0.6)) < 1e-9, `face J M = ${fj.M.toFixed(2)} at L−offJ`);
  ok(RCBeam.stationAt(m, -50).M === st[0].M && RCBeam.stationAt(m, 99999).M === st[10].M, 'clamped to the member ends');
  ok(typeof RCBeam.stationAt === 'function', 'stationAt exported');
}

// ---------------------------------------- rigid end zones (ETABS RZF > 0)
console.log('rigid end zones — fixed-fixed beam, a=2 m rigid, 2 m flexible span');
{
  // L = 6 m, rigid blocks 2 m per end (factor 1.0), flexible span 2 m with
  // UDL w. Closed form for the span (fixed-fixed, UDL): M_span_end =
  // w·Lf²/12, V = w·Lf/2. Node statics across the rigid block: M_node =
  // M_span_end − V·a.  w = 10 N/mm, Lf = 2000, a = 2000:
  //   M_span_end = 10·2000²/12 = 3.333e6 N·mm, V = 10e3 N
  //   M_node = 3.333e6 − 1e4·2000 = −1.667e7 N·mm
  const L = 6.0, aI = 2000, aJ = 2000, w = 10, E = 25000, nu = 0.2; // L in meters (solver scales ×1000)
  const A = 160000, Iz = 2.133e9, Iy = 2.133e9, J = 1e6, Gm = E / (2 * (1 + nu));
  const nodes = [{ x: 0, y: 0, z: 0, fixed: [1, 1, 1, 1, 1, 1] },
    { x: L, y: 0, z: 0, fixed: [1, 1, 1, 1, 1, 1] }];
  const frames = [{ ni: 0, nj: 1, E, A, Iy, Iz, J, G: Gm, As2: 1e5, As3: 1e5, eoI: aI, eoJ: aJ }];
  const r = FEA.assembleAndSolve(nodes, frames, [], [new Map()],
    { memberLoads: [{ wy: -w }] });
  const f = r.frames[0].forces;
  const MiNode = Math.abs(f[5]);
  const ViNode = Math.abs(f[1]);
  ok(Math.abs(ViNode - w * 2000 / 2) / (w * 1000) < 0.02, `end shear V = ${(ViNode / 1e3).toFixed(1)} kN (≈ w·Lf/2 = 10)`);
  ok(Math.abs(MiNode - (w * 2000 * 2000 / 12 + w * 2000 / 2 * aI)) / 1e7 < 0.05,
    `node moment M = ${(MiNode / 1e6).toFixed(2)} kN·m (span-end 3.33 + V·a = 20 → 23.33)`);
  // station statics (rigid-aware, mirroring the app's formula) recover the
  // span-end moment at the face exactly
  const st = [];
  for (let k = 0; k <= 10; k++) {
    const x = 6000 * k / 10; // mm
    let M = f[5] + (-f[1]) * x;
    const lu = Math.max(0, Math.min(x - aI, 2000)); // UDL only on the flexible span
    M += -(-w) * (lu * lu / 2 + lu * (x - aI - lu));
    st.push({ x: x / 1000, M: -M / 1e6, V: -f[1] / 1e3 });
  }
  st.push({ x: aI / 1000, M: -(f[5] + (-f[1]) * aI) / 1e6, V: -f[1] / 1e3 }); // exact face point I
  st.push({ x: (6000 - aJ) / 1000, M: -(f[5] + (-f[1]) * (6000 - aJ)) / 1e6, V: -f[1] / 1e3 }); // face J
  st.sort((p, q) => p.x - q.x);
  const mrow = { stations: st, offI: aI, offJ: aJ };
  const face = RCBeam.stationAt(mrow, aI);
  ok(Math.abs(Math.abs(face.M) - w * 2000 * 2000 / 12 / 1e6) / 3.33 < 0.06,
    `face moment from station statics = ${Math.abs(face.M).toFixed(2)} kN·m (w·Lf²/12 = 3.33)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
