'use strict';
// manual-verify-focus.js — selection-centric navigation: F frames the
// selected element (camera target + dist), orbit pivots on it (middle-drag
// and the Orbit tool), wheel zoom still dives to the cursor, and with no
// selection F falls back to zoom extents.
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
  await p.setViewport({ width: 1400, height: 900 });
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
  await p.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await p.evaluate(() => {
    const app = window.app;
    app.action('new');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click();
  });
  await sleep(700);

  // two columns far apart via the real tool (default camera: clicks stay
  // clear of the fixed screen-space nav gizmo bottom-left)
  await p.evaluate(() => { window.app.setTool('column'); });
  await sleep(400);
  for (const pt of [[0.15, 0.15], [5, 3.5]]) {
    const click = await p.evaluate(([x, y]) => {
      const v = window.app.view;
      const c = v.toClient(v.toScreen(window.G.v(x, y, 0)));
      return { x: Math.round(c.x), y: Math.round(c.y) };
    }, pt);
    await p.mouse.click(click.x, click.y);
    await sleep(800);
  }
  const ents = await p.evaluate(() => window.app.bim.entities.filter(e => e.type === 'column').length);
  check('two columns placed', ents === 2);

  // ---- select the FAR column, press F
  await p.evaluate(() => {
    const app = window.app;
    const ent = app.bim.entities.filter(e => e.type === 'column')[1];
    app.selectElement(ent.id);
  });
  await sleep(400);
  await p.keyboard.press('KeyF');
  await sleep(500);
  let st = await p.evaluate(() => {
    const app = window.app;
    return { target: { ...app.view.cam.target }, dist: app.view.cam.dist };
  });
  check('F frames the selected column (target on it)',
    Math.hypot(st.target.x - 5, st.target.y - 3.5, st.target.z - 1.5) < 0.35,
    `target=(${st.target.x.toFixed(2)}, ${st.target.y.toFixed(2)}, ${st.target.z.toFixed(2)})`);
  check('F pulled the camera close (element fills the view)', st.dist < 4.5 && st.dist > 1, `dist=${st.dist.toFixed(2)}`);

  // ---- orbit (middle-drag) pivots on the selection: az changes, target stays
  const az0 = await p.evaluate(() => window.app.view.cam.az);
  const c = await p.evaluate(() => {
    const v = window.app.view;
    return { x: Math.round(v.canvas.width / 2), y: Math.round(v.canvas.height / 2) };
  });
  await p.mouse.move(c.x, c.y);
  await p.mouse.down({ button: 'middle' });
  await p.mouse.move(c.x + 180, c.y + 30, { steps: 6 });
  await p.mouse.up({ button: 'middle' });
  await sleep(400);
  st = await p.evaluate(() => {
    const app = window.app;
    return { az: app.view.cam.az, target: { ...app.view.cam.target } };
  });
  check('middle-drag orbit rotated the camera', Math.abs(st.az - az0) > 0.15,
    `az ${az0.toFixed(2)} -> ${st.az.toFixed(2)}`);
  check('orbit pivoted ON the selection (target held)',
    Math.hypot(st.target.x - 5, st.target.y - 3.5, st.target.z - 1.5) < 0.4,
    `target=(${st.target.x.toFixed(2)}, ${st.target.y.toFixed(2)}, ${st.target.z.toFixed(2)})`);

  // ---- wheel zoom in/out still works (cursor-pivot) near the element
  const d0 = await p.evaluate(() => window.app.view.cam.dist);
  await p.mouse.move(c.x, c.y);
  await p.mouse.wheel({ deltaY: -400 });
  await sleep(300);
  const d1 = await p.evaluate(() => window.app.view.cam.dist);
  check('wheel zooms INTO the framed element', d1 < d0 * 0.8, `${d0.toFixed(2)} -> ${d1.toFixed(2)}`);

  // ---- deselect: F falls back to zoom extents (whole model)
  await p.evaluate(() => {
    const app = window.app;
    app.setTool('select');
    app.clearSelection();
  });
  await sleep(300);
  await p.keyboard.press('KeyF');
  await sleep(500);
  st = await p.evaluate(() => {
    const app = window.app;
    return { target: { ...app.view.cam.target }, dist: app.view.cam.dist };
  });
  check('F with no selection = zoom extents (whole model)',
    Math.hypot(st.target.x - 2.6, st.target.y - 1.8) < 1.5 && st.dist > 6,
    `target=(${st.target.x.toFixed(2)}, ${st.target.y.toFixed(2)}) dist=${st.dist.toFixed(2)}`);

  // ---- re-select + Orbit TOOL also pivots on the selection
  await p.evaluate(() => {
    const app = window.app;
    const ent = app.bim.entities.filter(e => e.type === 'column')[0];
    app.selectElement(ent.id);
    app.setTool('orbit');
  });
  await sleep(300);
  const c2 = await p.evaluate(() => {
    const v = window.app.view;
    return { x: Math.round(v.canvas.width / 2), y: Math.round(v.canvas.height / 2) };
  });
  await p.mouse.move(c2.x, c2.y);
  await p.mouse.down({ button: 'left' });
  await p.mouse.move(c2.x + 150, c2.y, { steps: 5 });
  await p.mouse.up({ button: 'left' });
  await sleep(300);
  st = await p.evaluate(() => ({ ...window.app.view.cam.target }));
  check('Orbit tool pivots on the selection too',
    Math.hypot(st.x - 0.15, st.y - 0.15, st.z - 1.5) < 0.35,
    `target=(${st.x.toFixed(2)}, ${st.y.toFixed(2)}, ${st.z.toFixed(2)})`);

  // screenshot for the record: framed first column after orbit
  await p.keyboard.press('KeyF');
  await sleep(500);
  await p.screenshot({ path: '_focus-orbit.png' });

  console.log(`\nselection focus manual verify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
