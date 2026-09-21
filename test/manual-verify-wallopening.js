'use strict';
// manual-verify-wallopening.js — MNL-66 Phase 5 end-to-end: a real wall
// with a real HostedCut door + window, then the whole-element wall rebar:
// the mesh must split around the holes and the WALL-206/208 trim steel
// (head/sill pairs, jamb pairs, corner diagonals) must land around them.
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

  // ---- build + preview in ONE evaluate (deterministic, no tx re-derivation)
  const built = await p.evaluate(() => {
    const app = window.app, G = window.G, m = app.model, BT = window.BimTools;
    const wp = { base: [0, 0, 0], end: [5, 0, 0], height: 3, thickness: 0.2,
      locationLine: 'centerline', primitive: 'line', closed: false,
      joins: { start: 0, end: 0 }, source: 'demo' };
    // build the wall solid, register the PROPER way (bim.create)
    const before = new Set(m.faces.keys());
    const ring = app.bim.wallRing(wp);
    const f = m.addFaceFromRings(ring.map(q => G.clone(q)));
    if (!f) return { error: 'wall ring degenerate' };
    if (!m.pushPull(f, 3)) return { error: 'wall sweep failed' };
    const roles = {};
    for (const id of [...m.faces.keys()].filter(id => !before.has(id))) roles[id] = 'body';
    app.bim.create('wall', wp, roles, [], { noHostDirty: true });
    const wallEnt = app.bim.entities.find(e => e.type === 'wall');
    if (!wallEnt) return { error: 'wall not registered' };
    // door at 1.5 m + window at 3.8, each cut + registered (demo recipe)
    const cut = (type, t, w, hgt, sill) => {
      const spec = { distanceFromStart: t, width: w, height: hgt, sillHeight: sill, depth: 0.2 };
      const b2 = new Set(m.faces.keys());
      m.bimHold = wallEnt.id;
      let info = null;
      try { info = BT.HostedCut.cut(G, m, wp, spec); }
      finally { m.bimHold = false; }
      if (!info || info.error) return false;
      const r2 = {};
      for (const id of [...m.faces.keys()].filter(id => !b2.has(id))) r2[id] = 'lining';
      app.bim.create(type, { hostWallId: wallEnt.id, distanceFromStart: info.t,
        width: w, height: hgt, sillHeight: sill, depth: 0.2, facing: 1, hand: 1 }, r2, []);
      return true;
    };
    const d = cut('door', 1.5, 1.2, 2.2, 0);
    const w2 = cut('window', 3.8, 1.5, 1.2, 0.9);
    if (!wallEnt.faces.length) return { error: 'wall faces lost after cuts' };
    const ER = window.ElementRebar;
    const q = { type: 'wall', wall: {
      cover: 0.04, vDia: 0.012, vSpacing: 0.2, hDia: 0.012, hSpacing: 0.2,
      twoCurtains: true, vOff: 0.05 } };
    const res = ER.previewElementRebar(m, wallEnt.faces[0], q, app.bim.entities);
    const st = res.paths.filter(x => x.pts.length === 2);
    // door interior (0.9..2.1, 0..2.2) and window (3.05..4.55, 0.9..2.1)
    const throughDoor = st.filter(x => x.pts[0].z < 1 && x.pts[1].z > 1
      && x.pts[0].x > 0.91 && x.pts[0].x < 2.09);
    const throughWin = st.filter(x => x.pts[0].z < 1.5 && x.pts[1].z > 1.5
      && x.pts[0].x > 3.06 && x.pts[0].x < 4.54);
    const diagonals = st.filter(x => Math.abs(x.pts[0].z - x.pts[1].z) > 0.5
      && Math.abs(x.pts[0].x - x.pts[1].x) > 0.5);
    return { wallFaces: wallEnt.faces.length, door: d, win: w2, total: m.faces.size,
      error: res.error, openings: res.openings, bars: res.paths.length,
      throughDoor: throughDoor.length, throughWin: throughWin.length,
      diagonals: diagonals.length };
  });
  check('wall with door + window hosted cuts built',
    built.wallFaces > 0 && built.door && built.win,
    built.error || `${built.wallFaces} wall faces, ${built.total} total after cuts`);

  const pv = built;
  check('preview ok, both openings seen', !pv.error && pv.openings === 2,
    pv.error || `${pv.bars} bars, ${pv.openings} openings`);
  check('no bar crosses the door hole', pv.throughDoor === 0, `${pv.throughDoor} crossings`);
  check('no bar crosses the window hole', pv.throughWin === 0, `${pv.throughWin} crossings`);
  check('corner diagonals present', pv.diagonals >= 10,
    `${pv.diagonals} diagonal bars (door top 2x2 + window 4x2 curtains)`);

  // commit + X-Ray screenshot
  await p.evaluate(() => {
    const app = window.app, m = app.model, ER = window.ElementRebar;
    app.run('rebar', () => {
      const ent = app.bim.entities.find(e => e.type === 'wall');
      const q = { type: 'wall', wall: {
        cover: 0.04, vDia: 0.012, vSpacing: 0.2, hDia: 0.012, hSpacing: 0.2,
        twoCurtains: true, vOff: 0.05 } };
      ER.buildElementRebar(m, ent.faces[0], q, app.bim.entities);
    });
  });
  await p.evaluate(() => { if (!window.app.xrayOn) window.app.action('toggleXray'); });
  await sleep(800);
  await p.evaluate(() => {
    const v = window.app.view;
    v.cam.az = -1.57; v.cam.el = 0.12; v.cam.dist = 5.2;
    v.cam.target = { x: 2.5, y: 0, z: 1.5 };
    v.applyCamera(); v.invalidate();
  });
  await sleep(700);
  await p.screenshot({ path: '_wallopening-rebar.png' });

  console.log(`\nwall opening manual verify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
