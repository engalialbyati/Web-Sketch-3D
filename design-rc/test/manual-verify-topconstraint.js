'use strict';
// manual-verify-topconstraint.js — the owner's report: a column placed with
// Top Constraint = Level 2, then selected and retargeted to Level 5, never
// grew. Both UI paths must now retarget the selection: the options bar
// select and the Entity Info field. Undo must restore.
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

  // levels: 0, 3 (Level 2), 15 (Level 5) — the owner's scenario.
  // baseLevel re-seated explicitly: addLevel ids can collide with the
  // template's, and a stale baseLevel computes a negative height.
  const lv = await p.evaluate(() => {
    const app = window.app, lm = app.levelManager;
    while (lm.levels.length > 1) lm.levels.pop();
    lm.levels[0] = { id: 'l1', name: 'Level 1', elevation: 0 };
    lm.addLevel('Level 2', 3);
    lm.addLevel('Level 5', 15);
    app.bimOptions.baseLevel = 'l1';
    app.onLevelsChanged();
    return lm.levels.map(l => `${l.id}:${l.elevation}`).join(' ');
  });
  check('levels 0/3/15 created', /l1:0 .*3 .*15/.test(lv), lv);

  // ---- place a column via the real tool, constraint = Level 2 (options bar)
  await p.evaluate(() => {
    const app = window.app;
    const top = document.getElementById('opt-topconstraint');
    top.value = 'lvl_1';
    top.dispatchEvent(new Event('change')); // options-bar path with NO selection
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
  const bboxOf = sel => window.eval(sel);
  let st = await p.evaluate(() => {
    const app = window.app, m = app.model;
    const ent = app.bim.entities.find(e => e.type === 'column');
    let z0 = 1e9, z1 = -1e9;
    for (const fid of ent.faces) {
      const f = m.faces.get(fid);
      if (!f) continue;
      const c = m.faceCentroid(f);
      z0 = Math.min(z0, c.z); z1 = Math.max(z1, c.z);
    }
    return { top: z1, bot: z0, n: ent.faces.length, constraint: ent.params.topConstraint };
  });
  check('column placed constrained to Level 2 (top ≈ 3.0)', Math.abs(st.top - 3) < 0.02,
    `top=${st.top.toFixed(3)} constraint=${st.constraint}`);

  // ---- THE OWNER'S ACTION: select the column, change Top Constraint → Level 5
  await p.evaluate(() => {
    const app = window.app;
    const ent = app.bim.entities.find(e => e.type === 'column');
    app.selectElement(ent.id);
  });
  await sleep(500);
  st = await p.evaluate(() => {
    const app = window.app;
    const top = document.getElementById('opt-topconstraint');
    top.value = 'lvl_2'; // Level 5 at 15 m
    top.dispatchEvent(new Event('change'));
    return { sel: app.sel.faces.size };
  });
  await sleep(900);
  st = await p.evaluate(() => {
    const app = window.app, m = app.model;
    const ent = app.bim.entities.find(e => e.type === 'column');
    let z1 = -1e9;
    for (const fid of ent.faces) {
      const f = m.faces.get(fid);
      if (f) z1 = Math.max(z1, m.faceCentroid(f).z);
    }
    return { top: z1, constraint: ent.params.topConstraint, height: ent.params.height,
      stillSelected: app.sel.faces.size > 0,
      info: (document.querySelector('#entityinfo') || {}).textContent || '' };
  });
  check('column GREW to Level 5 (top ≈ 15.0)', Math.abs(st.top - 15) < 0.02,
    `top=${st.top.toFixed(3)} constraint=${st.constraint} height=${(st.height || 0).toFixed(2)}`);
  check('constraint + height params synced', st.constraint === 'lvl_2' && Math.abs(st.height - 15) < 0.02);
  check('selection retained across the rebuild', st.stillSelected);
  check('Entity Info shows the Top Constraint field', /Top Constraint/.test(st.info));

  await p.evaluate(() => {
    const v = window.app.view;
    v.cam.az = -0.9; v.cam.el = 0.32; v.cam.dist = 18;
    v.cam.target = { x: 0.15, y: 0.15, z: 7 };
    v.applyCamera(); v.invalidate();
  });
  await sleep(700);
  await p.screenshot({ path: '_topconstraint-grown.png' });

  // ---- Entity Info path: retarget back down to Level 2 through the field
  st = await p.evaluate(() => {
    const sel = document.querySelector('#entityinfo [data-pf="topConstraint"]');
    if (!sel) return { has: false };
    sel.value = 'lvl_1';
    sel.dispatchEvent(new Event('change'));
    return { has: true };
  });
  await sleep(900);
  check('Entity Info has the constraint select', st.has);
  st = await p.evaluate(() => {
    const app = window.app, m = app.model;
    const ent = app.bim.entities.find(e => e.type === 'column');
    let z1 = -1e9;
    for (const fid of ent.faces) {
      const f = m.faces.get(fid);
      if (f) z1 = Math.max(z1, m.faceCentroid(f).z);
    }
    return { top: z1, constraint: ent.params.topConstraint };
  });
  check('Entity Info edit shrank it back to Level 2 (top ≈ 3.0)', Math.abs(st.top - 3) < 0.02,
    `top=${st.top.toFixed(3)}`);

  // ---- undo restores the previous constraint state
  await p.evaluate(() => window.app.setTool('select'));
  await sleep(300);
  await p.keyboard.press('Control', 'z');
  await p.keyboard.down('Control'); await p.keyboard.press('KeyZ'); await p.keyboard.up('Control');
  await sleep(800);
  st = await p.evaluate(() => {
    const app = window.app, m = app.model;
    const ent = app.bim.entities.find(e => e.type === 'column');
    if (!ent) return { gone: true };
    let z1 = -1e9;
    for (const fid of ent.faces) {
      const f = m.faces.get(fid);
      if (f) z1 = Math.max(z1, m.faceCentroid(f).z);
    }
    return { top: z1, constraint: ent.params.topConstraint };
  });
  check('undo restores the Level-5 column (top ≈ 15.0)', !st.gone && Math.abs(st.top - 15) < 0.02,
    st.gone ? 'column gone!' : `top=${st.top.toFixed(3)}`);

  console.log(`\ntop constraint manual verify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
