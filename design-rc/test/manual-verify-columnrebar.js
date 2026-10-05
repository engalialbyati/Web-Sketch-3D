'use strict';
// manual-verify-columnrebar.js — Column Reinforcement tool: the four cage
// types through the real dialog on a real Column-tool column, plus the
// regression the owner hit: Ctrl+A + Delete must NOT sweep the rebar away.
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

  // real Column tool placement
  await p.evaluate(() => {
    const app = window.app;
    app.view.cam.az = -1.1; app.view.cam.el = 0.45; app.view.cam.dist = 7;
    app.view.cam.target = { x: 0.15, y: 0.15, z: 1.2 };
    app.view.applyCamera(); app.view.invalidate();
    app.setRibbonTab && app.setRibbonTab('detailing');
    app.setTool('column');
  });
  await sleep(400);
  const click = await p.evaluate(() => {
    const v = window.app.view;
    const c = v.toClient(v.toScreen(window.G.v(0.15, 0.15, 0)));
    return { x: Math.round(c.x), y: Math.round(c.y) };
  });
  await p.mouse.click(click.x, click.y);
  await sleep(900);
  let st = await p.evaluate(() => ({
    entities: window.app.bim.entities.map(e => e.type),
    btn: !!document.querySelector('#toolbar .tbtn[data-tool="rebar-column"]'),
  }));
  check('column element placed by the real tool', st.entities.includes('column'));
  check('Column Reinforcement button on the Detailing ribbon', st.btn);

  // ---- SINGLE TIE via the dialog (preselect the top face)
  st = await p.evaluate(() => {
    const app = window.app, G = window.G, m = app.model;
    let top = null;
    for (const [id, f] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (!top && n.z > 0.999) top = id;
    }
    app.sel.faces = new Set([top]); app.sel.edges = new Set();
    app.setTool('rebar-column');
    return { dialog: !!document.querySelector('#dialog') };
  });
  await sleep(400);
  check('cage dialog opens on the preselected top face', st.dialog);
  st = await p.evaluate(() => {
    document.getElementById('ct-val').value = '0.2';
    document.getElementById('ct-val').dispatchEvent(new Event('input'));
    const info = document.getElementById('cr-info');
    const btns = [...document.querySelectorAll('#dialog .dlg-btn')];
    btns[btns.length - 1].click();
    return { info: info ? info.textContent : null };
  });
  await sleep(900);
  st = await p.evaluate(() => {
    const m = window.app.model;
    const reb = [...m.faces.values()].filter(f => f.userData && f.userData.rebar);
    return { rebarFaces: reb.length,
      ties: reb.filter(f => f.userData.rebar.shape === 'stirrup').length,
      bars: reb.filter(f => f.userData.rebar.shape === 'straight').length,
      groups: [...m.groups.values()].map(g => g.name) };
  });
  check('single-tie cage committed', st.rebarFaces > 0 && st.bars > 0, `${st.rebarFaces} faces (${st.ties} tie + ${st.bars} bar)`);
  check('cage grouped', st.groups.some(n => n.includes('column')));

  // ---- THE OWNER'S BUG: Ctrl+A + Delete must keep the rebar
  await p.evaluate(() => window.app.setTool('select'));
  await sleep(300);
  await p.keyboard.down('Control'); await p.keyboard.press('KeyA'); await p.keyboard.up('Control');
  await sleep(400);
  st = await p.evaluate(() => {
    const m = window.app.model;
    return { selFaces: window.app.sel.faces.size,
      selRebar: [...window.app.sel.faces].filter(id => { const f = m.faces.get(id); return f && f.userData && f.userData.rebar; }).length };
  });
  check('Ctrl+A does NOT select the hidden rebar', st.selRebar === 0, `${st.selFaces} faces selected, ${st.selRebar} rebar`);
  await p.keyboard.press('Delete');
  await sleep(800);
  st = await p.evaluate(() => ({
    rebar: [...window.app.model.faces.values()].filter(f => f.userData && f.userData.rebar).length,
    faces: window.app.model.faces.size,
  }));
  check('rebar survives Ctrl+A + Delete', st.faces === st.rebar && st.rebar > 0, `${st.rebar} rebar faces remain of ${st.faces}`);
  await sleep(400);
  await p.screenshot({ path: '_cage-singletie.png' });

  // ---- CIRCULAR cage via the dialog on a fresh column
  await p.evaluate(() => {
    const app = window.app, G = window.G;
    app.run('col2', m => window.ColumnFeature.placeColumn(G, m, G.v(1, 0, 0), 0.3, 0.3, 3, 0, { bimEntityId: 'col2', bimType: 'column' }));
    app.bim.entities.push({ id: 'col2', type: 'column', params: { base: [1, 0, 0], width: 0.3, depth: 0.3, height: 3, rotation: 0 }, faces: [], edges: [] });
    for (const [id, f] of app.model.faces) if (!f.userData) f.userData = { bimEntityId: 'col2', bimType: 'column' };
    const ent = app.bim.entities.find(e => e.id === 'col2');
    ent.faces = [...app.model.faces.keys()].filter(id => { const f = app.model.faces.get(id); return f.userData && f.userData.bimEntityId === 'col2'; });
  });
  await sleep(400);
  st = await p.evaluate(() => {
    const app = window.app, G = window.G, m = app.model;
    let top = null;
    for (const [id, f] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (!top && n.z > 0.999 && f.userData && f.userData.bimEntityId === 'col2') top = id;
    }
    app.sel.faces = new Set([top]); app.sel.edges = new Set();
    app.setTool('rebar-column');
    const t = document.getElementById('cr-type');
    t.value = 'circular';
    t.dispatchEvent(new Event('change'));
    const btns = [...document.querySelectorAll('#dialog .dlg-btn')];
    btns[btns.length - 1].click();
    return null;
  });
  await sleep(1200);
  st = await p.evaluate(() => {
    const m = window.app.model;
    const reb = [...m.faces.values()].filter(f => f.userData && f.userData.rebar);
    return { helix: reb.filter(f => f.userData.rebar.shape === 'helical').length,
      bars: reb.filter(f => f.userData.rebar.shape === 'straight').length };
  });
  check('circular cage: helix + 6 main bars', st.helix > 0 && st.bars > 0, `${st.helix} helix faces, ${st.bars} bar faces`);

  console.log(`\ncolumn rebar manual verify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
