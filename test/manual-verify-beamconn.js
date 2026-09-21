'use strict';
// manual-verify-beamconn.js — MNL-66 Phase 4 end-to-end in the real app:
// columns placed by ColumnFeature, beam built by StructuralManager.buildBeam
// WITH the framing trim (solid ends at the column faces), then the whole-
// element rebar: bars must develop to the FAR SIDE of each column's ties
// (BM-202) with the 90-degree hook there, integrity hooks at any free end,
// and the tie cap through the connection zones.
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
    headless: 'new', args: ['--no-sandbox', '--disable-gpu-sandbox'],
    protocolTimeout: 300000,
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 1500, height: 900 });
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
  await p.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await p.evaluate(() => {
    window.app.action('new');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click();
  });
  await sleep(700);

  // ---- real build: two columns + one framing-trimmed beam between them
  const built = await p.evaluate(() => {
    const app = window.app, G = window.G, m = app.model;
    const out = app.run('frame', () => {
      // columns run through z=3 (0 .. 3.4), 0.3 x 0.3
      window.ColumnFeature.placeColumn(G, m, { x: 0, y: 0, z: 0 }, 0.3, 0.3, 3.4, 0,
        { bimEntityId: 'cA', bimType: 'column' });
      window.ColumnFeature.placeColumn(G, m, { x: 4, y: 0, z: 0 }, 0.3, 0.3, 3.4, 0,
        { bimEntityId: 'cB', bimType: 'column' });
      for (const id of ['cA', 'cB']) {
        const params = { base: id === 'cA' ? [0, 0, 0] : [4, 0, 0], width: 0.3, depth: 0.3, height: 3.4 };
        const faces = [...m.faces.values()].filter(f => f.userData && f.userData.bimEntityId === id).map(f => f.id);
        // model.bimEntities feeds buildBeam's framing trim; app.bim.entities
        // feeds the rebar support detection - both need the columns up front
        m.bimEntities.push({ id, type: 'column', params, faces, edges: [] });
        app.bim.entities.push({ id, type: 'column', params, faces, edges: [] });
      }
      // beam: centerline baseline AT the column centers -> framing trim cuts
      // the solid at x = 0.15 / 3.85 (the column faces)
      const before = new Set(m.faces.keys());
      const P = { baseline: [[0, 0, 3], [4, 0, 3]], profile: 'rectangular',
        webWidth: 0.3, height: 0.5, zJustification: 'Top' };
      app.structural.buildBeam(G, m, P);
      const faces = [...m.faces.keys()].filter(id => !before.has(id))
        .filter(id => m.faces.has(id));
      for (const id of faces) {
        const f = m.faces.get(id);
        if (!f.userData) f.userData = {};
        f.userData.bimEntityId = 'bm1'; f.userData.bimType = 'beam';
      }
      const ent = { id: 'bm1', type: 'beam', params: P, faces, edges: [] };
      app.bim.entities.push(ent); m.bimEntities.push(ent);
      // framing trim really happened: no beam face beyond the column faces
      const xs = faces.map(id => m.faceCentroid(m.faces.get(id)).x);
      return { faces: faces.length, minX: Math.min(...xs), maxX: Math.max(...xs),
        beamFaces: ent.faces.length };
    });
    return out;
  });
  check('columns + framing-trimmed beam built', built.faces > 0,
    `${built.faces} faces, solid x ${built.minX.toFixed(2)}..${built.maxX.toFixed(2)}`);
  check('framing trim: solid starts at the column face (0.15)',
    Math.abs(built.minX - 0.15) < 0.02, `minX=${built.minX.toFixed(3)}`);
  check('framing trim: solid ends at the column face (3.85)',
    Math.abs(built.maxX - 3.85) < 0.02, `maxX=${built.maxX.toFixed(3)}`);

  // ---- preview with the REAL entity pool: both ends must be columns
  const pv = await p.evaluate(() => {
    const app = window.app, m = app.model, ER = window.ElementRebar;
    let fid = null;
    for (const [id, f] of m.faces) {
      if (f.userData && f.userData.bimEntityId && f.userData.bimType === 'beam') { fid = id; break; }
    }
    const q = { type: 'beam', beam: {
      side: 0.03, end: 0.05, tieDia: 0.008, bentAngle: 135, bentFactor: 6,
      mode: 'spacing', value: 1.0,
      topCount: 2, topDia: 0.014, botCount: 3, botDia: 0.016,
      top: 0.03, bot: 0.03, skin: 0, skinDia: 0.012, integrity: true } };
    const res = ER.previewElementRebar(m, fid, q, app.bim.entities);
    const bot = res.paths.filter(x => x.dia === 0.016 && x.pts.length > 2);
    const xs = bot.flatMap(x => x.pts.map(w => w.x));
    const ties = res.paths.filter(x => x.dia === 0.008 && x.pts.length > 2)
      .map(x => x.pts.reduce((s, w) => s + w.x, 0) / x.pts.length).sort((a, b) => a - b);
    return { error: res.error, supports: res.supports,
      bars: res.paths.length, botMin: Math.min(...xs), botMax: Math.max(...xs), ties };
  });
  check('preview ok', !pv.error, pv.error || `${pv.bars} bars`);
  check('both ends detected as columns',
    pv.supports && pv.supports.start === 'column' && pv.supports.end === 'column',
    JSON.stringify(pv.supports));
  check('bottom bars reach the FAR SIDE of the column ties (x = -0.098 / 4.098)',
    Math.abs(pv.botMin + 0.098) < 0.005 && Math.abs(pv.botMax - 4.098) < 0.005,
    `x ${pv.botMin.toFixed(3)} .. ${pv.botMax.toFixed(3)}`);
  // connection-zone tie cap on BOTH ends
  const zoneA = pv.ties.filter(x => x <= 0.15 + 0.6 + 1e-6);
  const zoneB = pv.ties.filter(x => x >= 3.85 - 0.6 - 1e-6);
  check('start zone ties at 8 in max', zoneA.length >= 3
    && zoneA.slice(1).every((x, i) => x - zoneA[i] <= 0.205),
    `${zoneA.length} ties: ${zoneA.map(x => x.toFixed(2)).join(' ')}`);
  check('end zone ties at 8 in max', zoneB.length >= 3
    && zoneB.slice(1).every((x, i) => x - zoneB[i] <= 0.205),
    `${zoneB.length} ties: ${zoneB.map(x => x.toFixed(2)).join(' ')}`);

  // ---- commit through the real dialog tool, X-Ray screenshot
  await p.evaluate(() => { window.app.setTool('select'); });
  await sleep(300);
  const committed = await p.evaluate(() => {
    const app = window.app, m = app.model, ER = window.ElementRebar;
    return app.run('rebar', () => {
      let fid = null;
      for (const [id, f] of m.faces) {
        if (f.userData && f.userData.bimEntityId === 'bm1') { fid = id; break; }
      }
      app.sel.faces = new Set([fid]); app.sel.edges = new Set();
      const q = { type: 'beam', beam: {
        side: 0.03, end: 0.05, tieDia: 0.008, bentAngle: 135, bentFactor: 6,
        mode: 'spacing', value: 1.0,
        topCount: 2, topDia: 0.014, botCount: 3, botDia: 0.016,
        top: 0.03, bot: 0.03, skin: 0, skinDia: 0.012, integrity: true } };
      const res = ER.buildElementRebar(m, fid, q, app.bim.entities);
      const rb = [...m.faces.values()].filter(f => f.userData && f.userData.rebar);
      return { error: res.error, rebarFaces: rb.length, supports: res.supports };
    });
  });
  check('cage committed with connection bars', !committed.error && committed.rebarFaces > 0,
    `${committed.rebarFaces} rebar faces, ${JSON.stringify(committed.supports)}`);

  await p.evaluate(() => { if (!window.app.xrayOn) window.app.action('toggleXray'); });
  await sleep(800);
  await p.evaluate(() => {
    const v = window.app.view;
    v.cam.az = -0.9; v.cam.el = 0.18; v.cam.dist = 3.6;
    v.cam.target = { x: 2.0, y: 0, z: 2.75 };
    v.applyCamera(); v.invalidate();
  });
  await sleep(700);
  await p.screenshot({ path: '_beamconn-far-side.png' });

  console.log(`\nbeam connection manual verify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
