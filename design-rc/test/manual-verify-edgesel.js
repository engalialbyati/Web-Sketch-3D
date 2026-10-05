'use strict';
// manual-verify-edgesel.js — the Edge Select tool in the real UI: button in
// every ribbon tab (K shortcut), clicks pick ONLY edges (a face under the
// cursor is ignored), box selects edges only, Shift adds, and the selection
// feeds the normal edge workflows (line inspector).
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
    app.view.cam.az = -Math.PI / 2; app.view.cam.el = 0.9; app.view.cam.dist = 14;
    app.view.cam.target = { x: 2, y: 2, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(300);

  // a line + a pushed box (faces AND edges present)
  await p.evaluate(() => {
    const app = window.app, G = window.G;
    app.run('setup', m => {
      m.addEdge(G.v(0, 0, 0), G.v(6, 0, 0));
      const f = m.addFaceFromRings([G.v(1, 1, 0), G.v(4, 1, 0), G.v(4, 3, 0), G.v(1, 3, 0)]);
      m.pushPull(f, 0.5);
    });
  });
  await sleep(400);

  // button present in the Draw tab + tool activates
  const btn = await p.evaluate(() => {
    const app = window.app;
    app.setRibbonTab('draw');
    const b = [...document.querySelectorAll('#toolbar .tbtn[data-tool]')].find(x => x.dataset.tool === 'edgeselect');
    if (b) b.click();
    return { found: !!b, tool: app.tool && app.tool.id };
  });
  check('Edge Select button in the Draw tab activates the tool', btn.found && btn.tool === 'edgeselect', JSON.stringify(btn));

  const P = async (w) => p.evaluate(q => {
    const v = window.app.view.toScreen(q);
    return { x: v.x, y: v.y };
  }, w);
  const click = async (w, mods = {}) => {
    const c = await P(w);
    await p.evaluate(c2 => {
      const cv = document.querySelector('canvas');
      const rc = cv.getBoundingClientRect();
      cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: rc.x + c2.x, clientY: rc.y + c2.y }));
      cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: rc.x + c2.x, clientY: rc.y + c2.y }));
    }, { ...c, ...mods });
    await sleep(200);
  };
  const drag = async (w0, w1, shift = false) => {
    const a = await P(w0), b = await P(w1);
    await p.evaluate(c => {
      const cv = document.querySelector('canvas');
      const rc = cv.getBoundingClientRect();
      const fire = (type, x, y, buttons) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons, shiftKey: c.shift || false, clientX: rc.x + x, clientY: rc.y + y }));
      fire('pointerdown', c.x0, c.y0, 1);
      fire('pointermove', c.x1, c.y1, 0);
      fire('pointermove', c.x1, c.y1, 0);
      fire('pointerup', c.x1, c.y1, 0);
    }, { x0: a.x, y0: a.y, x1: b.x, y1: b.y, shift });
    await sleep(250);
  };
  const sel = () => p.evaluate(() => ({ edges: window.app.sel.edges.size, faces: window.app.sel.faces.size }));

  // 1. click the MIDDLE of the box's top face — no edge there → selects nothing
  await click({ x: 2.5, y: 2, z: 0.5 });
  let s = await sel();
  check('click on a face area selects NOTHING', s.edges === 0 && s.faces === 0, JSON.stringify(s));

  // 2. click the free line → exactly 1 edge
  await click({ x: 3, y: 0, z: 0 });
  s = await sel();
  check('click a line selects exactly one edge', s.edges === 1 && s.faces === 0, JSON.stringify(s));

  // 3. box around the whole box-solid → only its top edges + line, NO faces
  await drag({ x: 0.2, y: -0.5, z: 0 }, { x: 4.8, y: 3.6, z: 0.8 });
  s = await sel();
  check('box select picks edges only (no faces)', s.edges >= 4 && s.faces === 0, JSON.stringify(s));

  // 4. Shift + box ADDS the free line to the selection
  const before4 = s.edges;
  await drag({ x: -0.5, y: -0.6, z: 0 }, { x: 6.5, y: 0.4, z: 0 }, true);
  s = await sel();
  check('Shift + box adds edges', s.edges > before4 && s.faces === 0, before4 + ' -> ' + s.edges);

  // 5. K shortcut activates the tool
  const k = await p.evaluate(() => {
    const app = window.app;
    app.setTool('select');
    const ev = new KeyboardEvent('keydown', { key: 'k', bubbles: true });
    document.dispatchEvent(ev);
    return app.tool && app.tool.id;
  });
  check('K shortcut switches to Edge Select', k === 'edgeselect', k);

  // 6. Esc clears
  const esc = await p.evaluate(() => {
    const app = window.app;
    app.sel.edges = new Set([1, 2, 3]);
    app.tool.onKey({ key: 'Escape' });
    return app.sel.edges.size;
  });
  check('Esc clears the selection', esc === 0);

  await browser.close();
  console.log(`\nedgesel verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
