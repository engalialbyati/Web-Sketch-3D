'use strict';
// manual-verify-linetool.js — the two user reports, through the real UI:
//  1. the Line tool keeps drawing from the last point, but every segment
//     is its OWN line — clicking one segment selects exactly one edge
//  2. a polygon whose closing corner missed its snap by ~6 mm still becomes
//     a face via Create Face (near-miss ends fuse under 1 cm)
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
  await p.evaluate(() => {
    const app = window.app;
    app.view.cam.az = -Math.PI / 2; app.view.cam.el = 0.35; app.view.cam.dist = 14;
    app.view.cam.target = { x: 1.5, y: 1, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(300);

  const P = async (w) => p.evaluate(q => {
    const v = window.app.view.toScreen(q);
    return { x: v.x, y: v.y };
  }, w);
  const click = async (w) => {
    const c = await P(w);
    await p.evaluate(c2 => {
      const cv = document.querySelector('canvas');
      const rc = cv.getBoundingClientRect();
      cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: rc.x + c2.x, clientY: rc.y + c2.y }));
      cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: rc.x + c2.x, clientY: rc.y + c2.y }));
    }, c);
    await sleep(200);
  };

  // ---- 1. line tool: one continuous stroke of 3 segments ------------------
  await p.evaluate(() => { window.app.setTool('line'); });
  await sleep(200);
  await click({ x: 0, y: 0, z: 0 });
  await click({ x: 3, y: 0, z: 0 });
  await click({ x: 3, y: 2, z: 0 });
  await click({ x: 0, y: 2, z: 0 });
  await p.evaluate(() => window.app.tool.onKey({ key: 'Escape' }));
  await sleep(200);
  const stroke = await p.evaluate(() => {
    const m = window.app.model;
    return { edges: m.edges.size, chained: [...m.edges.values()].filter(e => e.curveId).length, curves: m.curves.size };
  });
  check('3-segment stroke made 3 separate lines', stroke.edges === 3, JSON.stringify(stroke));
  check('no polyline chain registered', stroke.chained === 0 && stroke.curves === 0);

  // click the middle segment with the select tool → exactly ONE edge selected
  await p.evaluate(() => { window.app.setTool('select'); });
  await sleep(200);
  await click({ x: 3, y: 1, z: 0 }); // mid of the vertical segment
  await sleep(300);
  const sel = await p.evaluate(() => ({ edges: window.app.sel.edges.size }));
  check('clicking one line selects ONE segment', sel.edges === 1, `selected=${sel.edges}`);

  // ---- 2. near-miss polygon still becomes a face ---------------------------
  await p.evaluate(() => {
    const app = window.app, G = window.G;
    app.run('near miss', m => {
      // close the stroke's open end (0,2)→(0.005,0.004): ~6.4 mm off (0,0)
      m.addEdge(G.v(0, 2, 0), G.v(0.005, 0.004, 0));
    });
  });
  await sleep(200);
  const made = await p.evaluate(() => {
    const app = window.app;
    app.sel.edges = new Set([...app.model.edges.keys()]);
    app.createFaceFromSelectedEdges();
    const m = app.model;
    return { faces: m.faces.size, valid: m.validate().ok, selLeft: app.sel.edges.size };
  });
  check('near-miss polygon became a face', made.faces === 1, JSON.stringify(made));
  check('model valid', made.valid);
  check('selection cleared after success', made.selLeft === 0);

  await browser.close();
  console.log(`\nlinetool verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
