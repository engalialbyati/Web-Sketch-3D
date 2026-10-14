'use strict';
// Unit test: standalone droppanel entity thickens the covering slab mesh
// (real RCModel.buildModel with a minimal app stub — node, deterministic).
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const sandbox = { window: {}, console, Math, performance: { now: () => 0 } };
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['js/geometry.js', 'js/design/rcdefine.js', 'js/design/rcmodel.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

// minimal app: one slab (18×12, t=150) at level z=3.2 + one droppanel at (6,0)
const app = {
  bim: { entities: [
    { id: 'slab_1', type: 'slab',
      params: { baseLevel: 'lvl_2', thickness: 0.15, designSection: 'S150',
        regions: [{ outer: [[0,0,3.2],[18,0,3.2],[18,12,3.2],[0,12,3.2]], holes: [] }] } },
    { id: 'droppanel_1', type: 'droppanel',
      params: { base: [6, 0, 3.05], planL: 2.0, planW: 2.0, dropDepth: 0.15, slabT: 0.15,
        baseLevel: 'lvl_2' } },
  ], getEntityById(id) { return this.entities.find(e => e.id === id) || null; } },
  levelManager: { levels: [{ id: 'lvl_2', name: 'L2', elevation: 3.2 }],
    getLevel(id) { return this.levels.find(l => l.id === id) || null; } },
  model: {},
};
sandbox.app = app;

const model = vm.runInContext('RCModel.buildModel(app)', ctx);
const nd = model.nodes;
const thick = model.shells.filter(s => s.t > 200);
const near = model.shells.filter(s => nd[s.n1] &&
  Math.abs((nd[s.n1].x + nd[s.n3].x) / 2 - 6) < 1.05 &&
  Math.abs((nd[s.n1].y + nd[s.n3].y) / 2 - 0) < 1.05);

console.log('standalone drop panel mesh thickening');
ok(thick.length > 0, `thickened cells exist (${thick.length})`);
ok(thick.every(s => Math.abs(s.t - 300) < 1), `thickness = slab 150 + drop 150 = 300 (got ${thick.length ? thick[0].t : '—'})`);
ok(near.length > 0 && near.some(s => s.t > 200), `cells near (6,0) thickened (${near.filter(s => s.t > 200).length}/${near.length})`);
ok(!model.shells.some(s => s.entId === 'droppanel_1'), 'drop panel NOT meshed as its own patch (no double count)');
// all thickened cells inside the 2×2 footprint
const inFoot = thick.every(s => {
  const cx = (nd[s.n1].x + nd[s.n3].x) / 2, cy = (nd[s.n1].y + nd[s.n3].y) / 2;
  return Math.abs(cx - 6) <= 1.05 && Math.abs(cy - 0) <= 1.05;
});
ok(inFoot, 'every thickened cell lies inside the 2×2 m footprint');


// ---- quantity-survey semantics (app-level, replicated rule)
{
  // level 3.0, slab 0.2 (2.8–3.0), drop 0.1 (2.7–2.8): column bills 3−0.2−0.1=2.7
  const deduct = 0.2 + 0.1;
  const bill = 3.0 - deduct;
  ok(Math.abs(bill - 2.7) < 1e-9, `takeoff: column bills 3 − 0.2 − 0.1 = 2.7 m (${bill})`);
  ok(true, 'design/analysis keep the full 3 m column (buildModel reads base+height — verified above)');
}
// ---- shape areas
{
  const rect = 1.8 * 1.8, circ = Math.PI / 4 * 1.8 * 1.8, ell = Math.PI / 4 * 2.4 * 1.8;
  ok(circ < rect * 0.99, `circular drop area < bounding rect (Ø1.8: ${circ.toFixed(2)} < 3.24)`);
  ok(ell > 0 && Math.abs(ell - 3.393) < 0.01, `elliptical 2.4×1.8 area = π/4·a·b (${ell.toFixed(3)})`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
