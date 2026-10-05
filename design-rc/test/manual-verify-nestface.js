'use strict';
// manual-verify-nestface.js — (1) the Edge Select button renders an icon
// (not "undefined") in every tab; (2) a rectangle drawn inside a rectangle
// → Create Face gives TWO faces with the inner ring DEDUCTED as a hole of
// the outer (no face-over-face).
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

  // 1. icon renders in every tab
  for (const tab of ['draw', 'model', 'insert', 'annotate', 'view', 'manage']) {
    const r = await p.evaluate(t => {
      const app = window.app;
      app.setRibbonTab(t);
      const b = [...document.querySelectorAll('#toolbar .tbtn[data-tool]')].find(x => x.dataset.tool === 'edgeselect');
      if (!b) return { found: false };
      return { found: true, hasSvg: !!b.querySelector('svg'), text: b.textContent.trim().slice(0, 30) };
    }, tab);
    check(`Edge Select icon renders in "${tab}"`, r.found && r.hasSvg && !/undefined/i.test(r.text), JSON.stringify(r));
  }

  // 2. rect inside a rect → hole deduction
  await p.evaluate(() => {
    const app = window.app;
    app.action('new');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click();
  });
  await sleep(700);
  await p.evaluate(() => {
    const app = window.app, G = window.G;
    app.view.cam.az = -Math.PI / 2; app.view.cam.el = 0.9; app.view.cam.dist = 14;
    app.view.cam.target = { x: 2, y: 1.5, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
    const rect = (x0, y0, w, h) => {
      app.run('rect', m => {
        m.addEdge(G.v(x0, y0, 0), G.v(x0 + w, y0, 0));
        m.addEdge(G.v(x0 + w, y0, 0), G.v(x0 + w, y0 + h, 0));
        m.addEdge(G.v(x0 + w, y0 + h, 0), G.v(x0, y0 + h, 0));
        m.addEdge(G.v(x0, y0 + h, 0), G.v(x0, y0, 0));
      });
    };
    rect(0, 0, 4, 3);
    rect(1, 1, 1, 1);
  });
  await sleep(400);
  const made = await p.evaluate(() => {
    const app = window.app, m = app.model;
    app.sel.edges = new Set([...m.edges.keys()]);
    app.createFaceFromSelectedEdges();
    const faces = [...m.faces.values()];
    return {
      faces: faces.length,
      detail: faces.map(f => ({ area: +m.faceArea(f).toFixed(2), holes: f.holes.length })),
      valid: m.validate().ok,
    };
  });
  check('two faces created', made.faces === 2, JSON.stringify(made));
  const outer = made.detail.find(d => d.holes === 1);
  const inner = made.detail.find(d => d.holes === 0);
  check('outer deducted the inner as a hole (area 11)', outer && Math.abs(outer.area - 11) < 0.1, JSON.stringify(made.detail));
  check('inner face intact (area 1)', inner && Math.abs(inner.area - 1) < 0.05);
  check('model valid', made.valid);

  // push the outer face → a tube; inner stays flat
  await p.evaluate(() => { window.app.setTool('pushpull'); });
  await sleep(200);
  const c = await p.evaluate(() => {
    const v = window.app.view.toScreen({ x: 3.9, y: 1.5, z: 0 }); // on the outer band, right of the hole
    return { x: v.x, y: v.y };
  });
  await p.evaluate(c2 => {
    const cv = document.querySelector('canvas');
    const rc = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: rc.x + c2.x, clientY: rc.y + c2.y }));
    cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: rc.x + c2.x, clientY: rc.y + c2.y }));
  }, c);
  await sleep(250);
  await p.evaluate(() => window.app.tool.onVCB('0.5'));
  await sleep(400);
  const pushed = await p.evaluate(() => {
    const m = window.app.model;
    const faces = [...m.faces.values()];
    const innerFace = faces.find(f => f.holes.length === 0 && f.loose);
    return {
      maxZ: +Math.max(...faces.flatMap(f => m.pts(f.loop).map(q => q.z))).toFixed(3),
      innerZ: innerFace ? +Math.max(...m.pts(innerFace.loop).map(q => q.z)).toFixed(3) : null,
      innerHoles: innerFace ? innerFace.holes.length : null,
      valid: m.validate().ok,
    };
  });
  check('outer band extruded to +0.5 (a tube)', pushed.maxZ === 0.5, JSON.stringify(pushed));
  check('inner face still flat and whole', pushed.innerZ === 0 && pushed.innerHoles === 0, JSON.stringify(pushed));
  check('model valid after push', pushed.valid);

  await p.screenshot({ path: 'test/_nestface-verify.png' });
  await browser.close();
  console.log(`\nnestface verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
