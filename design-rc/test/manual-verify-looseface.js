'use strict';
// manual-verify-looseface.js — the user's picture flow: two adjacent arc-band
// faces made from the SAME arcs. Each Create Face builds a standalone face
// (own vertices + own edge copies); the original wire survives for the next
// face; pushing one band never touches the other; deleting an original arc
// edge touches neither.
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
    app.view.cam.az = -Math.PI / 2; app.view.cam.el = 0.001; app.view.cam.dist = 14;
    app.view.cam.target = { x: 0, y: 0, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(300);

  // the wire: two adjacent bands sharing the middle arc (r=2.5)
  const setup = await p.evaluate(() => {
    const app = window.app, G = window.G;
    app.run('setup', m => {
      const D = 0.15, SEG = 12;
      for (const r of [2, 2.5, 3]) {
        const pts = [];
        for (let i = 0; i <= SEG; i++) {
          const a = -D + (i / SEG) * (Math.PI + 2 * D);
          pts.push(G.v(r * Math.cos(a), r * Math.sin(a), 0));
        }
        m.addPolyline(pts, { type: 'arc', center: G.v(0, 0, 0), radius: r, normal: G.v(0, 0, 1) });
      }
      const t = (r, s) => G.v(r * Math.cos(D) * s, -r * Math.sin(D), 0);
      m.addEdge(G.clone(t(2, 1)), G.clone(t(2.5, 1)));
      m.addEdge(G.clone(t(2.5, -1)), G.clone(t(2, -1)));
      m.addEdge(G.clone(t(2.5, 1)), G.clone(t(3, 1)));
      m.addEdge(G.clone(t(3, -1)), G.clone(t(2.5, -1)));
    });
    return { edges: app.model.edges.size };
  });
  await sleep(400);

  const selBand = (ri, ro) => p.evaluate(c => {
    const app = window.app, m = app.model;
    const ids = [];
    for (const e of m.edges.values()) {
      const a = m.vp(e.a), b = m.vp(e.b);
      const rA = Math.hypot(a.x, a.y), rB = Math.hypot(b.x, b.y);
      if (e.curveId && Math.abs(rA - rB) < 1e-6 && (Math.abs(rA - c.ri) < 1e-6 || Math.abs(rA - c.ro) < 1e-6)) ids.push(e.id);
      if (!e.curveId && Math.min(rA, rB) > c.ri - 0.01 && Math.min(rA, rB) < c.ri + 0.01 &&
        Math.max(rA, rB) > c.ro - 0.01 && Math.max(rA, rB) < c.ro + 0.01) ids.push(e.id);
    }
    app.sel.edges = new Set(ids);
    app.createFaceFromSelectedEdges();
    return { faces: m.faces.size, edges: m.edges.size };
  }, { ri, ro });

  const a = await selBand(2, 2.5);
  check('face A created from band 1 (own edge copies)', a.faces === 1, JSON.stringify(a));
  const wireEdges = setup.edges;
  check('original wire untouched', a.edges === wireEdges + 26, `edges ${a.edges} = wire ${wireEdges} + 26`);

  const b = await selBand(2.5, 3);
  check('face B created from the SAME middle arc', b.faces === 2, JSON.stringify(b));

  const iso = await p.evaluate(() => {
    const m = window.app.model;
    const [fa, fb] = [...m.faces.values()];
    const va = new Set(m.rings(fa).flat()), vb = new Set(m.rings(fb).flat());
    let shared = 0; va.forEach(v => { if (vb.has(v)) shared++; });
    return { shared, looseA: fa.loose, looseB: fb.loose, valid: m.validate().ok };
  });
  check('the two faces share zero vertices', iso.shared === 0, JSON.stringify(iso));
  check('both flagged loose + model valid', iso.looseA && iso.looseB && iso.valid);

  // push face A up 0.6 through the real tool (typed)
  await p.evaluate(() => { window.app.setTool('pushpull'); });
  await sleep(200);
  const mid = await p.evaluate(() => {
    const v = window.app.view.toScreen({ x: 0, y: 2.2, z: 0 });
    return { x: v.x, y: v.y };
  });
  await p.evaluate(c => {
    const cv = document.querySelector('canvas');
    const rc = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: rc.x + c.x, clientY: rc.y + c.y }));
    cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: rc.x + c.x, clientY: rc.y + c.y }));
  }, mid);
  await sleep(250);
  await p.evaluate(() => window.app.tool.onVCB('0.6'));
  await sleep(400);
  const pushed = await p.evaluate(() => {
    const m = window.app.model;
    const faces = [...m.faces.values()];
    const fb = faces[1];
    return {
      maxZ: +Math.max(...faces.flatMap(f => m.pts(f.loop).map(q => q.z))).toFixed(3),
      bArea: +m.faceArea(fb).toFixed(4),
      bHoles: fb.holes.length,
      bMaxZ: +Math.max(...m.pts(fb.loop).map(q => q.z)).toFixed(3),
      valid: m.validate().ok,
    };
  });
  check('face A extruded to +0.6', pushed.maxZ === 0.6, JSON.stringify(pushed));
  check('face B untouched: flat, whole, no holes', pushed.bMaxZ === 0 && pushed.bHoles === 0 && pushed.bArea > 4, `area=${pushed.bArea}`);
  check('model valid after push', pushed.valid);

  // delete an ORIGINAL middle-arc edge — must touch neither face
  const del = await p.evaluate(() => {
    const app = window.app, m = app.model;
    const faces = [...m.faces.values()];
    const areas = faces.map(f => m.faceArea(f));
    const orig = [...m.edges.values()].find(e => {
      const a = m.vp(e.a), b = m.vp(e.b);
      return e.curveId && Math.abs(Math.hypot(a.x, a.y) - 2.5) < 1e-6 && Math.abs(Math.hypot(b.x, b.y) - 2.5) < 1e-6;
    });
    const adj = m.facesAdjacentToEdge(orig).length;
    app.run('del', mm => mm.deleteEdgeIds([orig.id]));
    return { adj, areas, after: faces.map(f => m.faceArea(f)), valid: m.validate().ok };
  });
  check('wire edge now binds no face', del.adj === 0, `adjacent=${del.adj}`);
  check('deleting it changed neither face', del.areas.every((x, i) => Math.abs(x - del.after[i]) < 1e-9));
  check('model valid after delete', del.valid);

  await p.screenshot({ path: 'test/_looseface-verify.png' });
  await browser.close();
  console.log(`\nlooseface verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
