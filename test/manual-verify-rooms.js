'use strict';
// manual-verify-rooms.js — Phase 2 browser flow: load the demo building,
// place rooms with the Room tool, edit identity fields, read the schedule,
// export IFC with IfcSpace, and round-trip rooms back through the importer.
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
  await sleep(1500);
  // aim the camera at the building like the other verify scripts
  await p.evaluate(() => {
    const app = window.app;
    const walls = app.bim.entities.filter(e => e.type === 'wall');
    let xs = [], ys = [];
    for (const w of walls.slice(0, 60)) { xs.push(w.params.base[0], w.params.end[0]); ys.push(w.params.base[1], w.params.end[1]); }
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    app.view.cam.az = -1.15; app.view.cam.el = 0.9; app.view.cam.dist = 40;
    app.view.cam.target = { x: cx, y: cy, z: 1 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(500);
  console.log('[1] demo building loaded');

  // room click in the plan: an interior bay point of the demo building
  const r1 = await p.evaluate(() => {
    const app = window.app;
    app.setTool('room');
    return { tool: app.tool && app.tool.id };
  });
  check('Room tool arms', r1.tool === 'room');

  // find an interior point: the wall bbox center (all walls of the model)
  const click = await p.evaluate(() => {
    const app = window.app;
    const walls = app.bim.entities.filter(e => e.type === 'wall' && e.params.base && e.params.end);
    let xs = [], ys = [];
    for (const w of walls.slice(0, 60)) {
      xs.push(w.params.base[0], w.params.end[0]);
      ys.push(w.params.base[1], w.params.end[1]);
    }
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const v = app.view.toScreen({ x: cx, y: cy, z: 0 });
    if (!isFinite(v.x) || !isFinite(v.y)) return { bad: true, cx, cy };
    const rc = document.querySelector('canvas').getBoundingClientRect();
    return { x: v.x, y: v.y };
  });
  if (click.bad) { check('interior point projects to screen', false, JSON.stringify(click)); await browser.close(); process.exit(1); }
  await sleep(300);
  await p.evaluate(c => {
    const c2 = document.querySelector('canvas');
    const rc = c2.getBoundingClientRect();
    c2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: rc.x + c.x, clientY: rc.y + c.y }));
    c2.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: rc.x + c.x, clientY: rc.y + c.y }));
  }, click);
  await sleep(900);
  const room = await p.evaluate(() => {
    const app = window.app;
    const rooms = app.bim.entities.filter(e => e.type === 'room');
    const r = rooms[rooms.length - 1];
    return {
      n: rooms.length,
      r: r ? { name: r.params.name, number: r.params.number, area: r.params.area, faces: r.faces.length, color: !!(app.model.faces.get(r.faces[0]) || {}).color } : null,
      valid: app.model.validate().ok,
    };
  });
  console.log('[2] room state:', JSON.stringify(room));
  check('room created from a click', room.n >= 1 && room.r && room.r.faces >= 1);
  check('room has name/number/area params', room.r && room.r.name && room.r.number && room.r.area > 0,
    room.r ? `${room.r.name} #${room.r.number} ${room.r.area} m²` : '');
  check('color fill applied to the plate', room.r && room.r.color);
  check('model stays valid with the room', room.valid);

  // schedule shows the room
  const sched = await p.evaluate(() => {
    const app = window.app;
    app.action('schedules');
    const body = document.getElementById('sch-body');
    const txt = body ? body.textContent : '';
    const hasCsv = !!document.getElementById('sch-csv');
    const row = body && body.querySelector('.sch-table tbody tr');
    return { open: !!body && body.innerHTML.includes('Room schedule'), hasCsv, firstRow: row ? row.textContent.replace(/\s+/g, ' ').trim().slice(0, 70) : null, txt: txt.slice(0, 60) };
  });
  console.log('[3] schedule:', JSON.stringify(sched));
  check('room schedule section renders', sched.open);
  check('CSV export button present', sched.hasCsv);
  check('room row visible', sched.firstRow && /\d/.test(sched.firstRow), sched.firstRow);
  await p.evaluate(() => { const d = document.getElementById('dialog-backdrop'); if (d) d.classList.add('hidden'); });

  // export IFC: IfcSpace present
  const exp = await p.evaluate(() => {
    const r = window.IfcExport.fromApp(window.app);
    return { counts: r.counts, space: (r.text.match(/IFCSPACE\(/g) || []).length };
  });
  console.log('[4] export:', JSON.stringify(exp));
  check('IfcSpace exported (roadmap 1.3)', exp.space >= 1, `${exp.space} IfcSpace`);

  // round-trip: rooms come back through the importer
  const text = await p.evaluate(() => window.IfcExport.fromApp(window.app).text);
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1500, height: 900 });
  p2.on('pageerror', e => console.log('[p2 pageerror]', String(e).slice(0, 200)));
  await p2.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await p2.evaluate(() => {
    const app = window.app;
    app.action('new');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click();
  });
  await sleep(600);
  const rt = await p2.evaluate(async t => {
    const app = window.app;
    const r = await window.IfcElements.load(new File([t], 'rt.ifc'), app);
    const rooms = app.bim.entities.filter(e => e.type === 'room');
    return { counts: r.counts, rooms: rooms.length, sample: rooms[0] ? { name: rooms[0].params.name, area: rooms[0].params.area } : null, valid: app.model.validate().ok };
  }, text).catch(e => ({ error: String(e) }));
  console.log('[5] round-trip:', JSON.stringify(rt).slice(0, 200));
  check('rooms survive the IFC round-trip', !rt.error && rt.rooms >= 1, rt.sample ? `${rt.sample.name} ${rt.sample.area} m²` : JSON.stringify(rt).slice(0, 80));
  check('round-trip model valid', !rt.error && rt.valid);

  console.log('\npage errors:', errs.length);
  console.log(`\nverify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
