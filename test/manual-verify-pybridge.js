'use strict';
// manual-verify-pybridge.js — the Python engine bridge end to end in the
// browser: engine online (python/engine.py on 8765) → toggle → build a
// column cage → bars arrive from the Python service (debug sweep when
// FreeCAD is absent) → engine off → the JS engine rebuilds the same cage.
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

  // ---- place a column with the real tool
  await p.evaluate(() => { window.app.setTool('column'); });
  await sleep(400);
  const click = await p.evaluate(() => {
    const v = window.app.view;
    const c = v.toClient(v.toScreen(window.G.v(0.15, 0.15, 0)));
    return { x: Math.round(c.x), y: Math.round(c.y) };
  });
  await p.mouse.click(click.x, click.y);
  await sleep(900);

  // ---- toggle the engine ON (menu action) and verify the probe
  await p.evaluate(() => window.app.action('togglePyEngine'));
  await sleep(1500);
  let st = await p.evaluate(() => ({ ...window.PyEngine.state, active: window.PyEngine.active,
    pyEngineOn: window.app.pyEngineOn }));
  check('engine toggle ON: probe reached the service', st.online === true && st.pyEngineOn === true,
    `online=${st.online} freecad=${st.freecad}`);
  // no FreeCAD on this machine: exercise the pipeline through the debug sweep
  await p.evaluate(() => { window.PyEngine.debugMeshes = true; });

  // ---- build the cage through the dialog (Create prefetches from Python)
  await p.evaluate(() => {
    const app = window.app, G = window.G, m = app.model;
    let top = null;
    for (const [id, f] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (!top && n.z > 0.999) top = id;
    }
    app.sel.faces = new Set([top]); app.sel.edges = new Set();
    app.setTool('rebar-column');
  });
  await sleep(400);
  await p.evaluate(() => {
    document.getElementById('ct-val').value = '4';
    document.getElementById('ct-val').dispatchEvent(new Event('input'));
    const btns = [...document.querySelectorAll('#dialog .dlg-btn')];
    btns[btns.length - 1].click();
  });
  await sleep(2500); // batched /pipes round trip + build
  st = await p.evaluate(() => {
    const m = window.app.model;
    const rb = [...m.faces.values()].filter(f => f.userData && f.userData.rebar);
    const byEngine = {};
    for (const f of rb) byEngine[f.userData.rebar.engine || 'js'] = (byEngine[f.userData.rebar.engine || 'js'] || 0) + 1;
    return { rebar: rb.length, byEngine, groups: [...m.groups.values()].map(g => g.name) };
  });
  check('cage built with PYTHON-built bars', st.byEngine['python-debug'] > 0,
    JSON.stringify(st.byEngine));
  check('cage grouped', st.groups.some(n => n.includes('Rebar')), st.groups.join(','));

  await p.evaluate(() => { if (!window.app.xrayOn) window.app.action('toggleXray'); });
  await sleep(900);
  await p.evaluate(() => {
    const v = window.app.view;
    v.cam.az = -0.9; v.cam.el = 0.4; v.cam.dist = 2.2;
    v.cam.target = { x: 0.15, y: 0.15, z: 1.4 };
    v.applyCamera(); v.invalidate();
  });
  await sleep(800);
  await p.screenshot({ path: '_pybridge-cage.png' });

  // ---- engine OFF: same dialog rebuilds with the JS engine
  await p.evaluate(() => {
    const app = window.app;
    // remove the cage group faces first (select group + delete)
    app.setTool('select');
  });
  await sleep(300);
  await p.evaluate(() => {
    const app = window.app, m = app.model;
    const ids = [...m.faces.values()].filter(f => f.userData && f.userData.rebar).map(f => f.id);
    app.sel.faces = new Set(ids); app.sel.edges = new Set();
    app.action('deleteSelection');
  });
  await sleep(1000);
  await p.evaluate(() => window.app.action('togglePyEngine'));
  await sleep(800);
  st = await p.evaluate(() => ({ ...window.PyEngine.state, on: window.app.pyEngineOn,
    active: window.PyEngine.active }));
  check('engine toggle OFF', st.on === false && st.active === false);
  await p.evaluate(() => {
    const app = window.app, G = window.G, m = app.model;
    let top = null;
    for (const [id, f] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (!top && n.z > 0.999) top = id;
    }
    app.sel.faces = new Set([top]); app.sel.edges = new Set();
    app.setTool('rebar-column');
  });
  await sleep(400);
  await p.evaluate(() => {
    document.getElementById('ct-val').value = '4';
    document.getElementById('ct-val').dispatchEvent(new Event('input'));
    const btns = [...document.querySelectorAll('#dialog .dlg-btn')];
    btns[btns.length - 1].click();
  });
  await sleep(1500);
  st = await p.evaluate(() => {
    const m = window.app.model;
    const rb = [...m.faces.values()].filter(f => f.userData && f.userData.rebar);
    const js = rb.filter(f => !f.userData.rebar.engine).length;
    return { rebar: rb.length, js };
  });
  check('fallback: same cage rebuilt by the JS engine', st.rebar > 0 && st.js === st.rebar,
    `${st.js}/${st.rebar} JS-built`);

  console.log(`\npybridge manual verify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
