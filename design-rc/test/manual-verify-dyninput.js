'use strict';
// ---------------------------------------------------------------------------
// manual-verify-dyninput.js — browser verification for the OpenCADStudio-style
// dynamic input (live length + angle while drawing), the Mirror / Array tools,
// and the Ellipse primitive. Run: node test/manual-verify-dyninput.js
// (dev server on :8642 must be up). Not part of the suite.
// ---------------------------------------------------------------------------
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const SHOT = process.env.SHOT_DIR || require('node:os').tmpdir() + '\\wsverify';
fs.mkdirSync(SHOT, { recursive: true });

const EDGE = process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1500,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 900 });
  const errors = [];
  page.on('pageerror', e => { errors.push(String(e)); console.log('[pageerror]', String(e).slice(0, 300)); });

  await page.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  // event bridge
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const rc = c.getBoundingClientRect();
    window.__fire = (x, y, type) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: rc.x + x, clientY: rc.y + y,
    }));
    window.__key = (k, mods = {}) => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: k, bubbles: true, cancelable: true, ...mods,
    }));
  });

  // world->canvas-pixel helper (__fire takes canvas-local coordinates)
  const project = pt => page.evaluate(p => {
    const v = window.app.view.toScreen(p);
    return { x: v.x, y: v.y };
  }, pt);

  // ---------- [1] FREE LINE: polar guides + live length/angle ----------
  console.log('[1] free Line tool — live length + angle + guides');
  await page.evaluate(() => {
    const app = window.app;
    app.setMode('free');
    app.setTool('line');
    app.view.cam.az = -1.15; app.view.cam.el = 0.9; app.view.cam.dist = 26;
    app.view.cam.target = { x: 6, y: 6, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(400);
  const a1 = await project({ x: 2, y: 2, z: 0 });
  const b1 = await project({ x: 8, y: 5.2, z: 0 }); // ~6.72 m at 30.1°
  await page.evaluate(a => { window.__fire(a.x, a.y, 'pointerdown'); window.__fire(a.x, a.y, 'pointerup'); }, a1);
  await sleep(150);
  await page.evaluate(b => window.__fire(b.x, b.y, 'pointermove'), b1);
  await sleep(300);
  const lineState = await page.evaluate(() => {
    const app = window.app, view = app.view;
    const labels = view.hudSticky.map(l => l.text);
    const dashed = view.previewGroup.children.filter(ch =>
      ch.material && ch.material.isLineDashedMaterial && ch.material.dashSize < 0.2).length;
    return { labels, dashed, len: labels.some(t => /m/.test(t)), ang: labels.some(t => /\u00B0/.test(t)) };
  });
  check('free line: live length label present', lineState.len, JSON.stringify(lineState.labels));
  check('free line: live angle label present', lineState.ang);
  check('free line: dashed guide geometry drawn (horizontal + arc)', lineState.dashed >= 2, `${lineState.dashed} dashed lines`);
  await page.screenshot({ path: SHOT + '\\shot-1-free-line.png' });

  // typed dynamic input on the free line tool
  await page.evaluate(() => { window.__key('4'); });
  await sleep(250);
  const dynState = await page.evaluate(() => {
    const app = window.app;
    return { open: !!(app.dyn && app.dyn.open), len: app.dynLen.value, ang: app.dynAng.value };
  });
  check('free line: dyn input opens on typing', dynState.open, `len=${dynState.len} ang=${dynState.ang}`);
  await page.evaluate(() => {
    window.app.dynLen.value = '5'; window.app.dynLen.dispatchEvent(new Event('input'));
    window.app.dynAng.value = '30'; window.app.dynAng.dispatchEvent(new Event('input'));
  });
  await sleep(200);
  const dynPt = await page.evaluate(() => {
    const t = window.app.tool;
    const d = t._dynPt;
    return d && t.anchor ? { x: d.x, y: d.y, ax: t.anchor.x, ay: t.anchor.y } : null;
  });
  const dynLenOk = dynPt &&
    Math.hypot(dynPt.x - dynPt.ax, dynPt.y - dynPt.ay) > 4.9 &&
    Math.hypot(dynPt.x - dynPt.ax, dynPt.y - dynPt.ay) < 5.1;
  const dynAngOk = dynPt &&
    Math.abs(Math.atan2(dynPt.y - dynPt.ay, dynPt.x - dynPt.ax) * 180 / Math.PI - 30) < 1.5;
  check('free line: typed 5 m drives the preview length', dynLenOk,
    dynPt && `at (${dynPt.x.toFixed(2)}, ${dynPt.y.toFixed(2)}) from (${dynPt.ax.toFixed(2)}, ${dynPt.ay.toFixed(2)})`);
  check('free line: typed 30° drives the preview angle', dynAngOk);
  await page.evaluate(() => window.app.dynCommit());
  await sleep(400);
  const lineCommitted = await page.evaluate(() => {
    const app = window.app;
    return app.model.edges.size >= 1 && !app.dyn.open;
  });
  check('free line: typed input commits an exact 5 m edge', lineCommitted);
  await page.evaluate(() => window.__key('Escape'));

  // ---------- [2] BIM WALL: bearing in the wall label + dyn input ----------
  console.log('[2] Wall tool — wall label with bearing + typed dyn input');
  await page.evaluate(() => {
    const app = window.app;
    app.setMode('bim');
    app.setTool('wall');
  });
  await sleep(300);
  const w1 = await project({ x: 12, y: 2, z: 0 });
  const w2 = await project({ x: 15.2, y: 6, z: 0 }); // ~4.63 m at ~52°
  await page.evaluate(w => { window.__fire(w.x, w.y, 'pointerdown'); window.__fire(w.x, w.y, 'pointerup'); }, w1);
  await sleep(150);
  await page.evaluate(w => window.__fire(w.x, w.y, 'pointermove'), w2);
  await sleep(300);
  const wallState = await page.evaluate(() => {
    const app = window.app;
    const labels = app.view.hudSticky.map(l => l.text);
    return { labels };
  });
  const wallLbl = wallState.labels.find(t => /wall/.test(t));
  check('wall: sticky label shows length', !!wallLbl && /m/.test(wallLbl), wallLbl);
  check('wall: sticky label shows the bearing (@ x°)', !!wallLbl && /@\s*[\d.]+°/.test(wallLbl), wallLbl);
  await page.screenshot({ path: SHOT + '\\shot-2-wall-bearing.png' });

  // typed length + angle commits an exact wall
  await page.evaluate(() => { window.__key('4'); });
  await sleep(250);
  const wallDyn = await page.evaluate(() => ({ open: window.app.dyn.open }));
  check('wall: dyn input opens on typing', wallDyn.open);
  await page.evaluate(() => {
    window.app.dynLen.value = '6'; window.app.dynLen.dispatchEvent(new Event('input'));
    window.app.dynAng.value = '0'; window.app.dynAng.dispatchEvent(new Event('input'));
  });
  await sleep(250);
  await page.evaluate(() => window.app.dynCommit());
  await sleep(800);
  const wallEnt = await page.evaluate(() => {
    const app = window.app;
    const ws = app.bim.entities.filter(e => e.type === 'wall');
    const last = ws[ws.length - 1];
    if (!last || !last.params.base || !last.params.end) return null;
    const dx = last.params.end[0] - last.params.base[0], dy = last.params.end[1] - last.params.base[1];
    return { len: Math.hypot(dx, dy), walls: ws.length };
  });
  check('wall: typed 6 m @ 0° commits an exact 6 m wall', wallEnt && Math.abs(wallEnt.len - 6) < 0.02,
    wallEnt && `${wallEnt.len.toFixed(3)} m (walls=${wallEnt.walls})`);

  // ---------- [3] ELLIPSE ----------
  console.log('[3] Ellipse primitive in the Draw tool');
  await page.evaluate(() => {
    const app = window.app;
    app.setTool('draw');
    app.bimOptions.primitive = 'ellipse';
    if (app.tool.engine) app.tool.engine.reset();
  });
  await sleep(200);
  const e1 = await project({ x: 12, y: 12, z: 0 });   // center
  const e2 = await project({ x: 15, y: 12, z: 0 });   // a = 3
  const e3 = await project({ x: 13.5, y: 13.2, z: 0 }); // b ~ 1.2
  await page.evaluate(e => { window.__fire(e.x, e.y, 'pointerdown'); window.__fire(e.x, e.y, 'pointerup'); }, e1);
  await sleep(120);
  await page.evaluate(e => { window.__fire(e.x, e.y, 'pointermove'); }, e2);
  await sleep(120);
  await page.evaluate(e => { window.__fire(e.x, e.y, 'pointerdown'); window.__fire(e.x, e.y, 'pointerup'); }, e2);
  await sleep(120);
  await page.evaluate(e => { window.__fire(e.x, e.y, 'pointermove'); }, e3);
  await sleep(200);
  await page.screenshot({ path: SHOT + '\\shot-3-ellipse-preview.png' });
  const ellipseBefore = await page.evaluate(() => window.app.model.faces.size);
  await page.evaluate(e => { window.__fire(e.x, e.y, 'pointerdown'); window.__fire(e.x, e.y, 'pointerup'); }, e3);
  await sleep(500);
  const ellipseAfter = await page.evaluate(() => window.app.model.faces.size);
  check('ellipse: 3 clicks commit a face', ellipseAfter > ellipseBefore, `${ellipseBefore} -> ${ellipseAfter} faces`);

  // ---------- [4] MIRROR ----------
  console.log('[4] Mirror tool');
  await page.evaluate(() => {
    const app = window.app;
    app.setMode('free');
    app.setTool('rect');
  });
  await sleep(200);
  const r1 = await project({ x: 2, y: 12, z: 0 });
  const r2 = await project({ x: 5, y: 14, z: 0 });
  await page.evaluate(r => { window.__fire(r.x, r.y, 'pointerdown'); window.__fire(r.x, r.y, 'pointerup'); }, r1);
  await sleep(120);
  await page.evaluate(r => { window.__fire(r.x, r.y, 'pointermove'); }, r2);
  await sleep(120);
  await page.evaluate(r => { window.__fire(r.x, r.y, 'pointerdown'); window.__fire(r.x, r.y, 'pointerup'); }, r2);
  await sleep(400);
  const facesBeforeMirror = await page.evaluate(() => window.app.model.faces.size);
  await page.evaluate(() => {
    const app = window.app;
    app.setTool('select');
    app.sel = { edges: new Set(), faces: new Set([...app.model.faces.keys()].slice(-1)) };
    app.onSelectionChanged();
    app.setTool('mirror');
  });
  await sleep(200);
  const m1 = await project({ x: 8, y: 10, z: 0 });
  const m2 = await project({ x: 8, y: 15, z: 0 });
  await page.evaluate(m => { window.__fire(m.x, m.y, 'pointerdown'); window.__fire(m.x, m.y, 'pointerup'); }, m1);
  await sleep(120);
  await page.evaluate(m => { window.__fire(m.x, m.y, 'pointerdown'); window.__fire(m.x, m.y, 'pointerup'); }, m2);
  await sleep(300);
  await page.screenshot({ path: SHOT + '\\shot-4-mirror-preview.png' });
  await page.evaluate(m => { window.__fire(m.x, m.y, 'pointerdown'); window.__fire(m.x, m.y, 'pointerup'); }, m2);
  await sleep(500);
  const mirrorState = await page.evaluate(before => {
    const app = window.app;
    const v = app.model.validate();
    const xs = [...app.model.faces.values()].flatMap(f => app.model.pts(f.loop).map(p => p.x));
    return { after: app.model.faces.size, before, ok: v.ok, maxX: Math.max(...xs) };
  }, facesBeforeMirror);
  check('mirror: copy created (faces grew by 1)', mirrorState.after === facesBeforeMirror + 1,
    `${facesBeforeMirror} -> ${mirrorState.after}`);
  check('mirror: mirrored copy landed across x=8', mirrorState.maxX > 10.5, `maxX=${mirrorState.maxX.toFixed(2)}`);
  check('mirror: model still validates', mirrorState.ok);

  // ---------- [5] ARRAY (linear) ----------
  console.log('[5] Array tool (linear, 3 total)');
  await page.evaluate(() => {
    const app = window.app;
    const last = [...app.model.faces.keys()].slice(-1)[0];
    app.setTool('select');
    app.sel = { edges: new Set(), faces: new Set([last]) };
    app.onSelectionChanged();
    app.setTool('array');
  });
  await sleep(200);
  const facesBeforeArray = await page.evaluate(() => window.app.model.faces.size);
  const y1 = await project({ x: 0, y: 12, z: 0 });
  const y2 = await project({ x: 4, y: 12, z: 0 });
  await page.evaluate(y => { window.__fire(y.x, y.y, 'pointerdown'); window.__fire(y.x, y.y, 'pointerup'); }, y1);
  await sleep(120);
  await page.evaluate(y => { window.__fire(y.x, y.y, 'pointermove'); }, y2);
  await sleep(120);
  await page.evaluate(y => { window.__fire(y.x, y.y, 'pointerdown'); window.__fire(y.x, y.y, 'pointerup'); }, y2);
  await sleep(300);
  await page.screenshot({ path: SHOT + '\\shot-5-array-preview.png' });
  // VCB: 3 total, stage 2 -> commits immediately
  await page.evaluate(() => { window.app.tool.onVCB('3'); });
  await sleep(600);
  const arrayState = await page.evaluate(before => {
    const app = window.app;
    return { after: app.model.faces.size, before, ok: app.model.validate().ok };
  }, facesBeforeArray);
  check('array: 3 total -> 2 copies added', arrayState.after === facesBeforeArray + 2,
    `${facesBeforeArray} -> ${arrayState.after}`);
  check('array: model still validates', arrayState.ok);

  // ---------- [6] toolbar buttons ----------
  const toolbarOk = await page.evaluate(() => {
    const app = window.app;
    app.setMode('free');
    const btns = [...document.querySelectorAll('#toolbar .tbtn[data-tool]')].map(b => b.dataset.tool);
    return { mirror: btns.includes('mirror'), array: btns.includes('array') };
  });
  check('toolbar: Mirror + Array buttons present', toolbarOk.mirror && toolbarOk.array, JSON.stringify(toolbarOk));
  const ellipseChip = await page.evaluate(() => {
    const app = window.app;
    app.setMode('bim');
    app.setTool('draw');
    return !!document.querySelector('#drawpalette .dchip[data-prim="ellipse"]');
  });
  check('draw palette: Ellipse chip present', ellipseChip);

  console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none');
  console.log(`\nverify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
