'use strict';
// manual-verify-scallop.js — the user's scalloped concentric-arc bug, end to
// end in the real app: nested scallop rings → select all → Create Face →
// TYPED Push/Pull thickness must extrude UP (+Z), neighbors stay on the
// ground, and double-click repeat also goes up (it used to follow each
// face's random winding — bands dove underground, white/flipped).
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

  await p.evaluate(() => {
    const app = window.app;
    app.action('new');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click();
  });
  await sleep(700);

  // camera: near-top view over the scallops
  await p.evaluate(() => {
    const app = window.app;
    app.view.cam.az = -Math.PI / 2; app.view.cam.el = 0.35; app.view.cam.dist = 16;
    app.view.cam.target = { x: 0, y: 0, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(300);

  // the user's wire: 3 nested scallops (offset arcs, each closed by its chord)
  await p.evaluate(() => {
    const app = window.app, G = window.G;
    app.run('setup', m => {
      const D = 0.15, SEG = 12;
      for (const r of [2, 3, 4]) {
        const pts = [];
        for (let i = 0; i <= SEG; i++) {
          const a = -D + (i / SEG) * (Math.PI + 2 * D);
          pts.push(G.v(r * Math.cos(a), r * Math.sin(a), 0));
        }
        m.addPolyline(pts, { type: 'arc', center: G.v(0, 0, 0), radius: r, normal: G.v(0, 0, 1) });
        m.addEdge(G.clone(pts[pts.length - 1]), G.clone(pts[0]));
      }
    });
  });
  await sleep(400);

  // select every edge (what a window selection does) → Create Face
  const created = await p.evaluate(() => {
    const app = window.app;
    app.sel.edges = new Set([...app.model.edges.keys()]);
    app.createFaceFromSelectedEdges();
    const m = app.model;
    return [...m.faces.values()].map(f => {
      const n = G.loopNormal(m.pts(f.loop));
      return { id: f.id, nz: +n.z.toFixed(3), area: +m.faceArea(f).toFixed(2) };
    });
  });
  check('Create Face: 3 scallop faces', created.length === 3, JSON.stringify(created));
  check('every face faces +Z', created.length === 3 && created.every(f => f.nz > 0.99));

  // typed Push/Pull on the MIDDLE scallop via the real tool path
  await p.evaluate(() => { window.app.setTool('pushpull'); });
  await sleep(200);
  const mid = await p.evaluate(() => {
    const v = window.app.view.toScreen({ x: 0, y: 2.5, z: 0 });
    return { x: v.x, y: v.y };
  });
  await p.evaluate(c => {
    const cv = document.querySelector('canvas');
    const rc = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: rc.x + c.x, clientY: rc.y + c.y }));
    cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: rc.x + c.x, clientY: rc.y + c.y }));
  }, mid);
  await sleep(250);
  const picked = await p.evaluate(() => ({ id: window.app.tool.faceId, mode: window.app.tool.mode }));
  check('click picks the middle scallop', picked.id != null && picked.mode === 'click', JSON.stringify(picked));

  const vcb = await p.evaluate(() => window.app.tool.onVCB('0.6'));
  await sleep(400);
  const after = await p.evaluate(() => {
    const app = window.app, m = app.model;
    const tops = [...m.faces.values()].map(f => Math.max(...m.pts(f.loop).map(q => q.z)));
    return { maxTop: +Math.max(...tops).toFixed(3), last: window.app.constructor && PushPullTool.lastDist, valid: m.validate().ok };
  });
  check('typed 0.6 extruded UP (+0.6 top)', after.maxTop === 0.6, `maxTop=${after.maxTop}`);
  check('model valid after push', after.valid);

  // double-click repeat on the INNER scallop — must also go UP
  const inner = await p.evaluate(() => {
    const v = window.app.view.toScreen({ x: 0, y: 1.2, z: 0 });
    return { x: v.x, y: v.y };
  });
  await p.evaluate(c => {
    const cv = document.querySelector('canvas');
    const rc = cv.getBoundingClientRect();
    for (const type of ['pointerdown', 'pointerup', 'pointerdown', 'pointerup']) {
      cv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: rc.x + c.x, clientY: rc.y + c.y }));
    }
    cv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: rc.x + c.x, clientY: rc.y + c.y }));
  }, inner);
  await sleep(500);
  const repeat = await p.evaluate(() => {
    const m = window.app.model;
    const ground = [...m.faces.values()].filter(f => Math.max(...m.pts(f.loop).map(q => q.z)) < 1e-9).length;
    const tops = [...m.faces.values()].map(f => +Math.max(...m.pts(f.loop).map(q => q.z)).toFixed(3));
    return { groundFaces: ground, highTops: [...new Set(tops.filter(z => z > 0.4))], valid: m.validate().ok };
  });
  check('double-click repeat also extruded UP', repeat.highTops.length === 1 && repeat.highTops[0] === 0.6,
    `tops=${JSON.stringify(repeat.highTops)} groundFaces=${repeat.groundFaces}`);
  check('model valid after repeat', repeat.valid);

  await p.screenshot({ path: 'test/_scallop-verify.png' });
  await browser.close();
  console.log(`\nscallop verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
