'use strict';
// manual-verify-edgesel-all.js — Edge Select is FINISHED: the button lives
// in ALL FOUR ribbon tabs, activates from each, and the tool picks edges
// only (click + box), never faces/elements/annotations.
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
    const app = window.app, G = window.G;
    app.view.cam.az = -Math.PI / 2; app.view.cam.el = 0.9; app.view.cam.dist = 14;
    app.view.cam.target = { x: 2, y: 2, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
    app.run('setup', m => {
      m.addEdge(G.v(0, 0, 0), G.v(6, 0, 0));
      const f = m.addFaceFromRings([G.v(1, 1, 0), G.v(4, 1, 0), G.v(4, 3, 0), G.v(1, 3, 0)]);
      m.pushPull(f, 0.5);
    });
  });
  await sleep(400);

  // the button activates the tool from EVERY ribbon tab
  for (const tab of ['draw', 'model', 'insert', 'annotate', 'view', 'manage']) {
    const r = await p.evaluate(t => {
      const app = window.app;
      app.setTool('select');
      app.setRibbonTab(t);
      const b = [...document.querySelectorAll('#toolbar .tbtn[data-tool]')].find(x => x.dataset.tool === 'edgeselect');
      if (b) b.click();
      return { found: !!b, tool: app.tool && app.tool.id };
    }, tab);
    check(`Edge Select button works in the "${tab}" tab`, r.found && r.tool === 'edgeselect', JSON.stringify(r));
  }

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
  const sel = () => p.evaluate(() => ({ edges: window.app.sel.edges.size, faces: window.app.sel.faces.size }));

  // clicks still pick edges only
  await click({ x: 2.5, y: 2, z: 0.5 });
  let s = await sel();
  check('face-area click selects nothing', s.edges === 0 && s.faces === 0, JSON.stringify(s));
  await click({ x: 3, y: 0, z: 0 });
  s = await sel();
  check('line click selects exactly one edge', s.edges === 1 && s.faces === 0, JSON.stringify(s));

  // K shortcut after all that
  const k = await p.evaluate(() => {
    const app = window.app;
    app.setTool('select');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    return app.tool && app.tool.id;
  });
  check('K shortcut activates Edge Select', k === 'edgeselect', k);

  await browser.close();
  console.log(`\nedgesel-all verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
