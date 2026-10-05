'use strict';
// ---------------------------------------------------------------------------
// manual-wallfreeze.js — repro for: load Revit grid building, draw a wall
// OUTSIDE it, app hard-freezes. Run: node test/manual-wallfreeze.js
// Not part of the suite; diagnostic only.
// ---------------------------------------------------------------------------
// piped stdout is block-buffered and never flushes while the kernel spins
if (process.stdout._handle && process.stdout._handle.setBlocking) process.stdout._handle.setBlocking(true);

// everything loads through the harness's single audited vm loader
const h = require('./harness');
const L = h.loadModel([
  'js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/features/roof.js',
  'js/GridLine.js', 'js/GridManager.js', 'js/features/demo-r5.js',
  'js/features/column.js', 'js/app.js',
]);
const { G, Model, StructuralManager, DemoR5 } = L.window;
const WallTool = L.window.BimTools.WallTool;
const GridManager = L.window.GridManager;
const BimEntityManager = L.window.BimEntityManager;

console.log('[1] building the Revit test building (this takes ~a minute)...');
const t0 = Date.now();
const m = new Model();
m.bimEntities = []; m.levels = []; m.grids = [];
const bim = new BimEntityManager(m);
const app = {
  model: m, bim, toast() { }, setStatus() { },
  levelManager: {
    levels: m.levels,
    addLevel(name, elevation) {
      let n = 1;
      while (m.levels.some(l => l.id === 'lvl_' + n)) n++;
      m.levels.push({ id: 'lvl_' + n, name, elevation: +elevation || 0 });
      m.levels.sort((a, b) => a.elevation - b.elevation);
      return m.levels.find(l => l.name === name);
    },
    getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
    getLevel: id => m.levels.find(x => x.id === id),
  },
  gridManager: new GridManager(m),
  structural: new StructuralManager(() => m.levels, () => m.bimEntities),
  bimOptions: { thickness: 0.2, height: 3, baseLevel: 'lvl_1', locationLine: 'centerline',
    topConstraint: 'unconnected', unconnectedHeight: 3 },
  transaction: {
    begin() { return { commit() { }, rollback() { }, rolledBack: false }; },
    run(label, fn) { return fn(m); },
  },
};
sandbox.window.app = app;
sandbox.app = app; // bim.js reaches the app via the bare global too
const counts = DemoR5.build(app);
console.log(`[1] built in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, counts,
  `| entities=${m.bimEntities.length} faces=${m.faces.size} edges=${m.edges.size}`);

// progress instrumentation on kernel suspects (synchronous prints — the event
// loop is blocked while the kernel spins, timers never fire)
const counters = {};
const bump = (k, every = 1) => { const n = (counters[k] = (counters[k] || 0) + 1); if (n % every === 0) console.log(`   [${k}] #${n} faces=${m.faces.size}`); };
for (const name of ['splitFacesAt', 'pushPull', 'reapOrphanEdges', 'gc', 'splitEdgeAt', 'addVertex', 'autoIntersect', 'intersectFaces', 'addFaceFromRings']) {
  if (typeof m[name] === 'function') {
    const orig = m[name].bind(m);
    if (name === 'splitFacesAt') {
      m[name] = (...a) => {
        bump(name);
        if (counters[name] % 25 === 0) console.log('   [STACK] ' + new Error().stack.split('\n').slice(1, 8).join('  <-  '));
        return orig(...a);
      };
    } else if (name === 'intersectFaces') {
      m[name] = (A, B, ...rest) => {
        const r = orig(A, B, ...rest);
        if (r) {
          const st = f => `${f.id}[${(f.userData && f.userData.bimEntityId) || '-'}/${(f.userData && f.userData.role) || '-'}]`;
          console.log(`   [CUT] ${st(A)} x ${st(B)} hold=${JSON.stringify(m.bimHold)} faces=${m.faces.size}`);
        }
        return r;
      };
    } else {
      m[name] = (...a) => { bump(name, name === 'intersectFaces' ? 2000 : 50); return orig(...a); };
    }
  }
}

console.log('[2] drawing the wall exactly like the browser (tool commit, real registration)...');
const tool = Object.create(WallTool.prototype);
tool.app = app;
tool.engine = { lastPickGrid: null };
const v = (x, y, z = 0) => G.v(x, y, z);
{
  const t1 = Date.now();
  const watchdog = setTimeout(() => {
    console.error('*** HUNG in wall _commitInner. counts:', JSON.stringify(counters));
    process.exit(2);
  }, 60000);
  const ent = tool._commitInner({ kind: 'line', closed: false, pts: [v(-0.926, -11.08), v(4.182, -7.504)] }, 3);
  clearTimeout(watchdog);
  console.log(`[2] wall committed in ${Date.now() - t1}ms | entities=${m.bimEntities.length} faces=${m.faces.size}`);
}

console.log('[3] draining the deferred host-dirty backlog the way the first user opDone does...');
const dirty = new Set(bim._hostsDirty || []);
console.log('[3] backlog size:', dirty.size);
let i = 0;
for (const wid of dirty) {
  const ent = bim.getEntityById(wid);
  if (!ent) continue;
  i++;
  const t1 = Date.now();
  if (ent.type === 'column') console.log(`   [COL] ${wid} (#${i}) params=${JSON.stringify(ent.params).slice(0, 220)} faces=${ent.faces.length} model=${m.faces.size}`);
  if (i <= 12) console.log(`   [DRAIN ${i}] ${ent.type}:${wid} params=${JSON.stringify(ent.params).slice(0, 300)} faces=${ent.faces.length}`);
  if (ent.type === 'wall') {
    try {
      const tr = app.structural && app.structural.wallPlanTrims(ent.params, null);
      console.log(`   [TRIMS] ${wid}: ${tr ? tr.intervals.length + ' intervals: ' + JSON.stringify(tr.intervals).slice(0, 160) : 'null'}`);
    } catch (e) { console.log(`   [TRIMS] ${wid}: ERR ${e.message}`); }
  }
  const watchdog = setTimeout(() => {
    console.error(`*** HUNG rebuilding ${ent.type}:${wid} (#${i}) after 30s. counts:`, JSON.stringify(counters));
    process.exit(2);
  }, 30000);
  let ok;
  if (ent.type === 'wall') ok = bim.planTrimWall(wid);
  else if (ent.type === 'beam') ok = bim.planTrimBeam(wid);
  else if (ent.type === 'column') ok = bim.rebuildColumnEntity(wid);
  else ok = 'skipped(' + ent.type + ')';
  clearTimeout(watchdog);
  if (Date.now() - t1 > 200) console.log(`   SLOW ${String(i).padStart(3)} ${ent.type}:${wid} -> ${ok} in ${Date.now() - t1}ms`);
}
console.log('[4] validate:', m.validate().ok ? 'OK' : 'FAILED');
process.exit(0);
