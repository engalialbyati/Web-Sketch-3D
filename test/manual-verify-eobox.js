'use strict';
// manual-verify-eobox.js — BOX SELECTION inside the Offset tool (the user's
// request: "i can create a box around the edge i want to offset and the app
// offset them all just like autocad"). Real UI: type distance → drag a box
// around several curves → side click → ALL offset; the band shows the
// window (blue) / crossing (green) styles; the repeat flow stays armed.
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
    app.view.cam.az = -Math.PI / 2; app.view.cam.el = 0.001; app.view.cam.dist = 16;
    app.view.cam.target = { x: 4, y: 2, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(300);

  // two lines + one arc (a 12-segment chain)
  await p.evaluate(() => {
    const app = window.app, G = window.G;
    app.run('setup', m => {
      m.addEdge(G.v(0, 0, 0), G.v(4, 0, 0));
      m.addEdge(G.v(0, 4, 0), G.v(4, 4, 0));
      const O = { x: 9, y: 2 }, r = 2, pts = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI * i / 12;
        pts.push(G.v(O.x + Math.cos(a) * r, O.y + Math.sin(a) * r, 0));
      }
      m.addPolyline(pts, { type: 'arc', center: G.v(O.x, O.y, 0), radius: r, normal: G.v(0, 0, 1) });
    });
  });
  await sleep(400);

  // arm the tool + type the distance
  await p.evaluate(() => {
    window.app.setTool('edgeoffset');
  });
  await sleep(200);
  const armed = await p.evaluate(() => {
    const t = window.app.tool;
    return { ok: t.onVCB('0.3'), dist: t.dist };
  });
  check('distance armed 0.3', armed.ok && armed.dist === 0.3);

  const P = async (w) => p.evaluate(q => {
    const v = window.app.view.toScreen(q);
    return { x: v.x, y: v.y };
  }, w);
  // drag a window box around BOTH lines (left→right = window/blue)
  const a1 = await P({ x: -0.5, y: -0.5, z: 0 });
  const b1 = await P({ x: 4.5, y: 4.5, z: 0 });
  await p.evaluate(c => {
    const cv = document.querySelector('canvas');
    const rc = cv.getBoundingClientRect();
    const fire = (type, x, y, buttons) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons, clientX: rc.x + x, clientY: rc.y + y }));
    fire('pointerdown', c.x0, c.y0, 1);
    fire('pointermove', c.x1, c.y1, 0);
    fire('pointermove', c.x1, c.y1, 0);
    fire('pointerup', c.x1, c.y1, 0);
  }, { x0: a1.x, y0: a1.y, x1: b1.x, y1: b1.y });
  await sleep(300);
  const boxed = await p.evaluate(() => {
    const t = window.app.tool;
    const el = document.getElementById('selband');
    return { picks: t.picks ? t.picks.length : null, bandStart: t._bandStart, classes: el.className };
  });
  check('box captured BOTH lines', boxed.picks === 2, JSON.stringify(boxed));
  check('band closed + classes cleaned', boxed.bandStart === null && !/active|window|crossing/.test(boxed.classes));

  // side click ABOVE everything → both copies at +0.3
  const side = await P({ x: 2, y: 7, z: 0 });
  await p.evaluate(c => {
    const cv = document.querySelector('canvas');
    const rc = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: rc.x + c.x, clientY: rc.y + c.y }));
    cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: rc.x + c.x, clientY: rc.y + c.y }));
  }, side);
  await sleep(400);
  const after = await p.evaluate(() => {
    const m = window.app.model;
    const ys = [];
    for (const e of m.edges.values()) {
      const a = m.vp(e.a), b = m.vp(e.b);
      if (a.x > 6) continue; // skip the arc region
      ys.push(+a.y.toFixed(3), +b.y.toFixed(3));
    }
    const t = window.app.tool;
    return { ys: [...new Set(ys)].sort(), dist: t.dist, picks: t.picks };
  });
  check('both lines offset outward (+0.3)', JSON.stringify(after.ys) === JSON.stringify([0, 0.3, 3.7 ? 4.3 : 4.3, 4].sort((x, y) => x - y)) || (after.ys.includes(0.3) && after.ys.includes(4.3)), JSON.stringify(after.ys));
  check('distance stays armed for the repeat', after.dist === 0.3 && after.picks === null);

  // box around the ARC → ONE chain pick → side click → one concentric copy
  const a2 = await P({ x: 6.6, y: -0.4, z: 0 });
  const b2 = await P({ x: 11.4, y: 4.4, z: 0 });
  await p.evaluate(c => {
    const cv = document.querySelector('canvas');
    const rc = cv.getBoundingClientRect();
    const fire = (type, x, y, buttons) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons, clientX: rc.x + x, clientY: rc.y + y }));
    fire('pointerdown', c.x0, c.y0, 1);
    fire('pointermove', c.x1, c.y1, 0);
    fire('pointermove', c.x1, c.y1, 0);
    fire('pointerup', c.x1, c.y1, 0);
  }, { x0: a2.x, y0: a2.y, x1: b2.x, y1: b2.y });
  await sleep(300);
  const arcBox = await p.evaluate(() => window.app.tool.picks ? window.app.tool.picks.length : null);
  check('boxed arc = ONE curve (chain, not 12 segments)', arcBox === 1, `picks=${arcBox}`);
  const side2 = await P({ x: 9, y: 6, z: 0 });
  await p.evaluate(c => {
    const cv = document.querySelector('canvas');
    const rc = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: rc.x + c.x, clientY: rc.y + c.y }));
    cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: rc.x + c.x, clientY: rc.y + c.y }));
  }, side2);
  await sleep(400);
  const arcAfter = await p.evaluate(() => {
    const m = window.app.model;
    const radii = [...m.curves.values()].map(c => +c.radius.toFixed(3)).sort((x, y) => x - y);
    return { radii, valid: m.validate().ok };
  });
  check('concentric arc copy r=2.3, once', JSON.stringify(arcAfter.radii) === JSON.stringify([2, 2.3]), JSON.stringify(arcAfter.radii));
  check('model valid', arcAfter.valid);

  await browser.close();
  console.log(`\neobox verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
