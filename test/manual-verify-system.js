'use strict';
// manual-verify-system.js — the one-by-one system check: every MNL-66
// phase in the demo scene, the display toggles, Ctrl+A safety, the
// recipe reload, and a normal draw+reinforce+edit session for freezes.
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu-sandbox'], protocolTimeout: 600000 });
  const p = await browser.newPage();
  await p.setViewport({ width: 1400, height: 850 });
  p.on('pageerror', e => { fail++; console.log('  [pageerror]', String(e).slice(0, 200)); });
  p.on('dialog', async d => { await d.accept(); });
  await p.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  // ============ 1. THE DEMO: every phase in one scene ============
  const t0 = Date.now();
  await p.evaluate(() => { window.app.action('demomnl66'); });
  await sleep(2000);
  let st = null;
  for (let i = 0; i < 90 && !(st && st.recipe === 'mnl66'); i++) {
    await sleep(1000);
    st = await p.evaluate(() => {
    const m = window.app.model;
    const byRole = {}, ents = {};
    for (const e of window.app.bim.entities) ents[e.type] = (ents[e.type] || 0) + 1;
    for (const f of m.faces.values()) if (f.userData && f.userData.rebar) {
      const r = f.userData.rebar.role || f.userData.rebar.shape;
      byRole[r] = (byRole[r] || 0) + 1;
    }
    for (const rec of (m._rebarRecords ? m._rebarRecords.values() : [])) {
      const r = (rec.meta && (rec.meta.role || rec.meta.shape)) || 'bar';
      byRole[r] = (byRole[r] || 0) + 1;
    }
    return { ents, byRole, faces: m.faces.size, bars: (m._rebarRecords ? m._rebarRecords.size : 0), mode: window.app.view.rebarMode,
      recipe: window.app._demoRecipe, xray: window.app.xrayOn };
  });
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  check('demo builds (record-only rebar)', st.bars > 5000 && st.faces < 5000, st.bars + ' bar records, ' + st.faces + ' solid faces in ' + dt + 's');
  check('5-story entities: 4 foundations, 33 columns, 30 beams, 5 slabs, shaft',
    st.ents.foundation === 4 && st.ents.column >= 33 && st.ents.beam >= 30
    && st.ents.floor === 5 && (st.ents.door || 0) >= 5 && (st.ents.window || 0) >= 4
    && st.ents.wall >= 21,
    JSON.stringify(st.ents));
  check('Phase 4 BM-202/204: beam far-side hooks', (st.byRole.hooked || 0) > 0, String(st.byRole.hooked));
  check('Phase 3 SLAB-206: opening trim bars', (st.byRole.trim || 0) > 0, String(st.byRole.trim));
  check('Phase 3 SLAB-200: corner steel', (st.byRole.corner || 0) > 0, String(st.byRole.corner));
  check('Phase 5 WALL-206: opening trim pairs', ((st.byRole['trim-h'] || 0) + (st.byRole['trim-v'] || 0)) > 0,
    'h=' + (st.byRole['trim-h'] || 0) + ' v=' + (st.byRole['trim-v'] || 0));
  check('Phase 5 WALL-208: corner diagonals', (st.byRole.diag || 0) > 0, String(st.byRole.diag));
  check('Phase 5 WALL-100A: wall starter dowels', (st.byRole['wall-dowel'] || 0) > 0, String(st.byRole['wall-dowel']));
  check('Phase 6 COL-200: splice pieces (pier column)', (st.byRole['splice-lower'] || 0) > 0, String(st.byRole['splice-lower'] || 0));
  check('WALL-110: shear-wall boundary elements', (st.byRole.boundary || 0) > 0, String(st.byRole.boundary || 0));
  check('FND-102: strip-footing wall dowels', (st.byRole['wall-dowel'] || 0) >= 200, String(st.byRole['wall-dowel'] || 0));
  check('foundations: raft + combined + strip starters', (st.byRole.lshape || 0) > 0, String(st.byRole.lshape || 0));
  check('Phase 7 FND-161/150: pile + pier ties', ((st.byRole['pile-tie'] || 0) + (st.byRole['pier-tie'] || 0)) > 0);
  check('Phase 7 FND-150: pier shaft verticals', (st.byRole['pier-vertical'] || 0) > 0);
  check('Phase 8 SOG-102: apron edge bars', (st.byRole['sog-edge'] || 0) > 0);
  check('column starters from footings', (st.byRole.lshape || 0) > 0, String(st.byRole.lshape || 0));
  check('demo opens in LIGHT rebar + X-Ray', st.mode === 'light' && st.xray === true);

  // ============ 2. mode toggle both ways ============
  await p.evaluate(() => { window.app.action('rebarlight'); });
  await sleep(900);
  st = await p.evaluate(() => window.app.view.rebarMode);
  check('toggle light -> detail', st === 'detail');
  await p.evaluate(() => { window.app.action('rebarlight'); });
  await sleep(900);
  st = await p.evaluate(() => window.app.view.rebarMode);
  check('toggle detail -> light', st === 'light');

  // ============ 3. Ctrl+A safety ============
  const sel = await p.evaluate(() => {
    const t1 = performance.now();
    window.app.action('selectAll');
    const dtSel = performance.now() - t1;
    return { ms: +dtSel.toFixed(0), faces: window.app.sel.faces.size, edges: window.app.sel.edges.size };
  });
  check('Ctrl+A fast with the cage loaded', sel.ms < 400, sel.ms + 'ms, ' + sel.faces + ' faces');
  const rebarEdges = await p.evaluate(() => [...window.app.model.edges.values()]
    .filter(e => e.userData && e.userData.rebar).length);
  check('no rebar edges in bulk selection', rebarEdges === 0, rebarEdges + ' rebar edges of ' + sel.edges);

  // ============ 4. reload: recipe restore + light mode persisted ============
  const t2 = Date.now();
  await p.reload({ waitUntil: 'domcontentloaded' });
  let rebuilt = false;
  for (let i = 0; i < 90 && !rebuilt; i++) {
    await sleep(500);
    rebuilt = await p.evaluate(() => window.app.bim.entities.length > 130
      && window.app._demoRecipe === 'mnl66' && window.app.view.rebarMode === 'light');
  }
  const rl = await p.evaluate(() => ({ mode: window.app.view.rebarMode, recipe: window.app._demoRecipe }));
  check('reload rebuilds the demo from the recipe', rebuilt, ((Date.now() - t2) / 1000).toFixed(1) + 's');
  check('light mode persists across reload', rl.mode === 'light' && rl.recipe === 'mnl66');

  // ============ 5. normal drawing session (not the demo) ============
  // let the recipe restore finish building before replacing the model
  for (let i = 0; i < 60; i++) {
    const settled = await p.evaluate(() => window.app.bim.entities.length > 130
      && window.app.view.rebarMode === 'light');
    if (settled) break;
    await sleep(500);
  }
  // fresh model directly (action('new') would confirm over the demo scene)
  await p.evaluate(() => {
    const app = window.app;
    app.bindModel(new window.Model());
    app.undoStack = []; app.redoStack = [];
    app.exitGroup(); app.clearSelection();
    app._demoRecipe = null;
  });
  await sleep(900);
  const draw = await p.evaluate(() => {
    const app = window.app, G = window.G, m = app.model;
    const out = { errors: [] };
    const t = fn => { const s = performance.now(); fn(); return +(performance.now() - s).toFixed(0); };
    out.placeMs = t(() => app.run('build', () => {
      window.ColumnFeature.placeColumn(G, m, { x: 0, y: 0, z: 0 }, 0.3, 0.3, 3, 0,
        { bimEntityId: 'c1', bimType: 'column' });
      const wp = { base: [2, 0, 0], end: [6, 0, 0], height: 3, thickness: 0.2,
        locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 } };
      const ring = app.bim.wallRing(wp);
      const wf = m.addFaceFromRings(ring.map(q => G.clone(q)));
      m.pushPull(wf, 3);
      for (const [id, ff] of m.faces) {
        if (!ff.userData) { const c = m.faceCentroid(ff);
          if (c && c.y < 0.15 && c.y > -0.15 && c.x > 1.9) { ff.userData = { bimEntityId: 'w1', bimType: 'wall' }; } }
      }
    }));
    const ER = window.ElementRebar;
    let colF = null, wallF = null;
    for (const [id, f] of m.faces) {
      if (!f.userData) continue;
      if (f.userData.bimEntityId === 'c1' && !colF) colF = id;
      if (f.userData.bimEntityId !== 'c1' && !wallF) wallF = id;
    }
    app.bim.entities.push({ id: 'c1', type: 'column', params: { base: [0, 0, 0], width: 0.3, depth: 0.3, height: 3 }, faces: [], edges: [] });
    app.bim.entities.push({ id: 'w1', type: 'wall', params: { base: [2, 0, 0], end: [6, 0, 0], height: 3, thickness: 0.2 }, faces: [], edges: [] });
    for (const ent of app.bim.entities)
      if (!ent.faces.length)
        ent.faces = [...m.faces.values()].filter(f => f.userData && f.userData.bimEntityId === ent.id).map(f => f.id);
    m.bimEntities.push(app.bim.entities[0], app.bim.entities[1]);
    out.rebarMs = t(() => {
      const rc = ER.buildElementRebar(m, colF, { type: 'column', column: {
        tie: { l: 0.04, r: 0.04, t: 0.04, b: 0.04, front: 0.05, dia: 0.008, mode: 'spacing', value: 0.18 },
        main: { dia: 0.016, tOffset: 0.05, bOffset: 0.05, type: 'straight', splice: { mode: 'lap' } } } },
        app.bim.entities);
      if (rc && rc.error) out.errors.push('col: ' + rc.error);
      const rw = ER.buildElementRebar(m, wallF, { type: 'wall', wall: {
        cover: 0.04, vDia: 0.012, vSpacing: 0.2, hDia: 0.012, hSpacing: 0.2, twoCurtains: true } },
        app.bim.entities);
      if (rw && rw.error) out.errors.push('wall: ' + rw.error);
    });
    out.editMs = t(() => { app.run('edit', () => { m.touch(); }); });
    out.rebarFaces = [...m.faces.values()].filter(f => f.userData && f.userData.rebar).length;
    out.autosaveLen = (localStorage.getItem('websketch3d') || '').length;
    return out;
  });
  check('draw + reinforce + edit all fast on a normal scene',
    draw.placeMs < 500 && draw.rebarMs < 500 && draw.editMs < 700 && draw.errors.length === 0,
    'place ' + draw.placeMs + 'ms, rebar ' + draw.rebarMs + 'ms, edit ' + draw.editMs + 'ms, '
    + draw.rebarFaces + ' rebar faces'
    + (draw.errors.length ? ' errors: ' + draw.errors.join('; ') : ''));
  check('normal scene autosaves geometry again', draw.autosaveLen > 100 && draw.autosaveLen < 500000,
    draw.autosaveLen + ' bytes');

  console.log('\nsystem check: ' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
