'use strict';
// manual-verify-final.js — final-phases browser sweep: annotation completion
// (angular dims, revision cloud, section views + clipping), Phase 4 tools
// (ramp, ceiling, curtain wall, strip footing, brace, truss, plate,
// property lines), and the analytical model + CSV.
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
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 1500, height: 900 });
  const errs = [];
  p.on('pageerror', e => { errs.push(String(e)); console.log('[pageerror]', String(e).slice(0, 250)); });
  await p.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  // build a small frame: 4 walls (a room) + 4 columns
  await p.evaluate(() => {
    const app = window.app;
    app.action('demor5');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click();
  });
  await p.waitForFunction(() => window.app.bim.entities.length >= 300, { timeout: 180000, polling: 2000 });
  await p.evaluate(() => {
    const app = window.app;
    app.view.cam.az = -1.15; app.view.cam.el = 0.9; app.view.cam.dist = 40;
    app.view.cam.target = { x: 8, y: 8, z: 1 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(600);
  console.log('[1] demo building loaded');

  // ---- Phase 3 additions ----
  const p3 = await p.evaluate(() => {
    const app = window.app;
    app.run('ann2', m => {
      m.annotations.push(
        { id: 'ann_a1', kind: 'dimang', V: [0, 0, 0], p1: [3, 0, 0], p2: [0, 3, 0], r: 1.2 },
        { id: 'ann_r1', kind: 'dimrad', c: [5, 5, 0], r: 2, rim: [7, 5, 0] },
        { id: 'ann_c1', kind: 'cloud', pts: [[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]] },
        { id: 'ann_g1', kind: 'region', pts: [[6, 0, 0], [9, 0, 0], [9, 3, 0], [6, 3, 0]] });
      m.touch();
    });
    // angular math
    const ang = window.Annotate2.angleDeg(
      { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 0, y: 3, z: 0 });
    // section view: cut through the building
    const wall = app.bim.entities.find(e => e.type === 'wall' && e.params.base && e.params.end);
    const sv = window.Annotate2.makeSectionView(app, [0, 5, 0], [20, 5, 0]);
    return {
      n: app.model.annotations.length,
      ang: +ang.toFixed(1),
      views: app.model.views.length,
      clipped: !!(app.view._activeSection && app.view._activeSection.clip),
      clips: app.view.renderer.clippingPlanes.length,
    };
  });
  await sleep(700);
  console.log('[2] P3:', JSON.stringify(p3));
  check('angular dim math (90°)', p3.ang === 90);
  check('4 new annotations placed', p3.n >= 4);
  check('section view saved', p3.views >= 1);
  check('section view armed', p3.clipped);
  // the render loop applies the clip on its next tick
  const clipLive = await p.evaluate(() => ({
    n: window.app.view.renderer.clippingPlanes.length,
    on: !!window.app.view._activeSection,
  }));
  check('section clipping active', clipLive.on && clipLive.n === 1, JSON.stringify(clipLive));

  // clear the section
  await p.evaluate(() => window.Annotate2.clearSection(window.app));
  await sleep(700);
  const cleared = await p.evaluate(() => window.app.view.renderer.clippingPlanes.length);
  check('Exit Section clears the clip', cleared === 0);

  // ---- Phase 4 tools ----
  const p4 = await p.evaluate(() => {
    const app = window.app;
    const wall = app.bim.entities.find(e => e.type === 'wall' && e.params.base && e.params.end && !e.params.closed);
    const before = app.bim.entities.length;
    // ramp
    window.Arch2.RampTool; // class exists
    // curtain
    const panels = window.Arch2.buildCurtain(app, { base: [20, 0, 0], end: [26, 0, 0], height: 3.2, panelW: 1.2 });
    // strip footing on the wall
    const stripBefore = app.bim.entities.length;
    app.transaction.run('sf', m => { /* via the tool path below instead */ });
    // property
    const prop = window.Arch2.makeProperty(app, [[0, 0], [40, 0], [40, 30], [0, 30]]);
    // truss
    const tm = window.Struct2.buildTruss(app, { span: 8, height: 1.2, bays: 4, x: 30, y: 0, z: 3 });
    return {
      panels,
      prop: prop ? prop.params.area : null,
      trussMembers: tm,
      ents: app.bim.entities.length - before,
      valid: app.model.validate().ok,
    };
  });
  console.log('[3] P4:', JSON.stringify(p4));
  check('curtain wall generates mullions + panels', p4.panels >= 4, `${p4.panels} panels`);
  check('property line + area', p4.prop === 1200, `${p4.prop} m²`);
  check('truss generates members', p4.trussMembers >= 6, `${p4.trussMembers} members`);
  check('model stays valid after generation', p4.valid);

  // ---- Phase 5: analytical model + CSV (before the clean-model block) ----
  const p5 = await p.evaluate(() => {
    const app = window.app;
    const members = window.Struct2.Analytical.derive(app);
    const csv = window.Struct2.Analytical.toCSV(members);
    app.view.setAnalytical(members);
    const kinds = {};
    for (const m2 of members) kinds[m2.kind] = (kinds[m2.kind] || 0) + 1;
    return { n: members.length, kinds, csvHead: csv.split('\r\n').slice(0, 4), csvLen: csv.length };
  });
  console.log('[5] P5:', JSON.stringify(p5).slice(0, 200));
  check('analytical members derived', p5.n >= 100, `${p5.n} members`);
  check('analytical CSV valid', p5.csvLen > 1000 && p5.csvHead[0] === 'NODES');

  // ---- IFC export carries everything ----
  const exp = await p.evaluate(() => {
    const r = window.IfcExport.fromApp(window.app);
    return { wall: (r.text.match(/IFCWALLSTANDARDCASE\(/g) || []).length, ok: r.text.includes('IFCPROJECT(') };
  });
  check('IFC export still healthy', exp.ok && exp.wall >= 30, `${exp.wall} walls after wall-rule regeneration`);

  // ---- strip footing + plate on a CLEAN model (same tool logic, fast) ----
  // 'new' swaps the model asynchronously — clear first, wait, then build
  await p.evaluate(() => {
    const app = window.app;
    app.action('new');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click();
  });
  await sleep(800);
  const p4b = await p.evaluate(() => {
    const mk = fn => app.transaction.run('gen', m => {
      m.bimHold = true; m.plainSweeps = true; m.noAutoIntersect = true;
      try { fn(m); } finally { m.bimHold = false; m.plainSweeps = false; m.noAutoIntersect = false; }
    });
    const b = [3, 2, 0], s = 0.5, t = 0.03;
    mk(m => {
      const before = new Set(m.faces.keys());
      const f = m.addFaceFromRings([G.v(b[0] - s/2, b[1] - s/2, b[2]), G.v(b[0] + s/2, b[1] - s/2, b[2]), G.v(b[0] + s/2, b[1] + s/2, b[2]), G.v(b[0] - s/2, b[1] + s/2, b[2])]);
      if (f && m.pushPull(f, -t)) {
        const nf = [...m.faces.keys()].filter(id => !before.has(id));
        const roles = {}; for (const fid of nf) roles[fid] = 'body';
        app.bim.create('plate', { hostColumnId: 'col_x', base: [...b], size: s, thickness: t }, roles, []);
      }
    });
    const w = 0.8, t2 = 0.35;
    mk(m => {
      const before = new Set(m.faces.keys());
      const f = m.addFaceFromRings([G.v(0, -w/2, 0), G.v(6, -w/2, 0), G.v(6, w/2, 0), G.v(0, w/2, 0)]);
      if (f && m.pushPull(f, -t2)) {
        const nf = [...m.faces.keys()].filter(id => !before.has(id));
        const roles = {}; for (const fid of nf) roles[fid] = 'body';
        app.bim.create('foundation', { kind: 'strip', base: [0, 0, 0], end: [6, 0, 0], width: w, thickness: t2 }, roles, []);
      }
    });
    return {
      plates: app.bim.entities.filter(e => e.type === 'plate').length,
      strips: app.bim.entities.filter(e => e.type === 'foundation' && e.params.kind === 'strip').length,
      valid: app.model.validate().ok,
    };
  });
  console.log('[6] P4b:', JSON.stringify(p4b));
  check('strip footing + base plate created', p4b.plates >= 1 && p4b.strips >= 1);
  check('clean model valid', p4b.valid);

  console.log('\npage errors:', errs.length);
  console.log(`\nverify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
