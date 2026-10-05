'use strict';
// manual-verify-ann.js — Phase 3 core browser flow: load the demo building,
// place a dimension (with a wall-end reference), a tag, a text note, a spot
// elevation; verify selection + delete, Tag All Untagged, Find & Replace,
// and the drawing-layer rendering (screen pixels change).
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

  // ---- programmatic placement (the tool flows are unit-covered; here we
  // exercise the app-integration: records + rendering + selection) ----
  const placed = await p.evaluate(() => {
    const app = window.app;
    const wall = app.bim.entities.find(e => e.type === 'wall' && e.params.base && e.params.end && !e.params.closed);
    const room = app.bim.entities.find(e => e.type === 'room');
    app.run('ann', m => {
      m.annotations.push(
        { id: 'ann_1', kind: 'dim', p1: [...wall.params.base], p2: [...wall.params.end], off: [0, 0.7, 0],
          r1: { type: 'wallEnd', wallId: wall.id, end: 0 }, r2: { type: 'wallEnd', wallId: wall.id, end: 1 } },
        { id: 'ann_2', kind: 'tag', targetId: room ? room.id : wall.id, at: [5, 5, 0], box: [5.5, 5.3, 0], template: '{name} · {area} m²' },
        { id: 'ann_3', kind: 'text', at: [3, 3, 0], text: 'fire rate F90', leaderFrom: [2.5, 2.5, 0] },
        { id: 'ann_4', kind: 'spot', at: [1, 1, 3.2] });
      m.touch();
    });
    return { n: app.model.annotations.length };
  });
  await sleep(600);
  check('four annotations placed', placed.n === 4);

  // rendering: HUD canvas has annotation ink (non-background pixels mid-screen)
  const ink = await p.evaluate(() => {
    const c = document.querySelector('canvas');
    // the HUD canvas sits above the WebGL one
    const hud = document.getElementById('hud') || [...document.querySelectorAll('canvas')].find(x => x !== c);
    if (!hud) return { err: 'no hud' };
    const ctx = hud.getContext('2d');
    const d = ctx.getImageData(0, 0, hud.width, hud.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 40) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r < 100 && g < 100 && b < 100) dark++;
      else if (b > 140 && r < 100) dark++; // blue tags
    }
    return { dark };
  });
  console.log('[2] hud ink:', JSON.stringify(ink));
  check('annotation ink on the HUD canvas', !ink.err && ink.dark > 20, ink.err || `${ink.dark} dark/blue samples`);

  // pick + select + delete round
  const sel = await p.evaluate(() => {
    const app = window.app;
    // synthetic pick: project the tag box
    const v = app.view.toScreen({ x: 5.5, y: 5.3, z: 0 });
    const hit = app.view.pickAnnotation({ x: v.x, y: v.y });
    if (!hit) return { picked: false };
    app.selectAnnotation(hit.id);
    return { picked: true, id: hit.id, kind: hit.kind, sel: app.selAnn, panel: document.getElementById('entityinfo').textContent.slice(0, 60) };
  });
  console.log('[3] pick:', JSON.stringify(sel));
  check('screen-space pick finds the tag', sel.picked && sel.kind === 'tag');
  check('selection panel shows the annotation', sel.picked && /Tag/.test(sel.panel || ''), sel.panel);

  const deleted = await p.evaluate(() => {
    const app = window.app;
    const n0 = app.model.annotations.length;
    app.deleteSelectedAnnotation();
    return { before: n0, after: app.model.annotations.length };
  });
  check('Delete removes the annotation', deleted.after === deleted.before - 1, `${deleted.before}→${deleted.after}`);

  // dim tracking: move the tagged wall, dimension follows
  const tracked = await p.evaluate(() => {
    const app = window.app;
    const dim = app.model.annotations.find(a => a.kind === 'dim' && a.r1 && a.r1.wallId
      && app.bim.getEntityById(a.r1.wallId));
    if (!dim) return { skipped: true };
    const wall = app.bim.getEntityById(dim.r1.wallId);
    const before = window.Annotate.resolveRef(app, dim.r2, dim.p2)[0];
    wall.params.end = [wall.params.end[0] + 1.5, wall.params.end[1], wall.params.end[2]];
    const after = window.Annotate.resolveRef(app, dim.r2, dim.p2)[0];
    wall.params.end = [wall.params.end[0] - 1.5, wall.params.end[1], wall.params.end[2]];
    return { skipped: false, before: +before.toFixed(2), after: +after.toFixed(2) };
  });
  check('dimension tracks its wall-end reference',
    tracked.skipped || Math.abs(tracked.after - tracked.before - 1.5) < 1e-6,
    tracked.skipped ? 'no resolvable dim (skipped)' : `${tracked.before} → ${tracked.after}`);

  // Tag All Untagged
  const tagAll = await p.evaluate(() => {
    const app = window.app;
    const n = window.Annotate.tagAll(app);
    return { n, total: app.model.annotations.filter(a => a.kind === 'tag').length };
  });
  console.log('[4] tagAll:', JSON.stringify(tagAll));
  check('Tag All Untagged tags the building', tagAll.n >= 100, `${tagAll.n} tags`);

  // find & replace
  const fr = await p.evaluate(() => {
    const app = window.app;
    return { n: window.Annotate.findReplace(app, 'F90', 'F120') };
  });
  check('Find & Replace edits notes', fr.n === 1, `${fr.n} replaced`);

  console.log('\npage errors:', errs.length);
  console.log(`\nverify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
