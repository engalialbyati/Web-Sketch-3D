'use strict';
// manual-verify-eo.js — AutoCAD-style Offset in the browser: type distance
// → pick line → side click → copy; same for an arc (concentric); the repeat
// flow (distance stays armed); the ribbon button renders.
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

  // ribbon button
  const btn = await p.evaluate(() => {
    const app = window.app;
    app.setRibbonTab('draw');
    return [...document.querySelectorAll('#toolbar .tbtn[data-tool]')].map(b => b.dataset.tool).includes('edgeoffset');
  });
  check('Offset Line/Arc button in the Draw tab', btn);

  // build geometry: a line + an arc on a clean model
  await p.evaluate(() => {
    const app = window.app;
    app.action('new');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click();
  });
  await sleep(700);
  const setup = await p.evaluate(() => {
    const app = window.app;
    app.view.cam.az = -Math.PI / 2; app.view.cam.el = 0.001; app.view.cam.dist = 20;
    app.view.cam.target = { x: 3, y: 0, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
    app.run('setup', m => {
      m.addEdge(G.v(0, 0, 0), G.v(6, 0, 0));
      const O = { x: 10, y: 0 }, r = 2, pts = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI * i / 12;
        pts.push(G.v(O.x + Math.cos(a) * r, O.y + Math.sin(a) * r, 0));
      }
      m.addPolyline(pts, { type: 'arc', center: G.v(O.x, O.y, 0), radius: r, normal: G.v(0, 0, 1) });
    });
    return { edges: app.model.edges.size, curves: app.model.curves.size };
  });
  await sleep(400);
  check('test geometry: 1 line + 1 arc', setup.curves >= 1);

  // arm the tool + type the distance via VCB
  const armed = await p.evaluate(() => {
    const app = window.app;
    app.setMode('free');
    app.setTool('edgeoffset');
    const t = app.tool;
    const okV = t.onVCB('0.4');
    return { tool: t.id, dist: t.dist, okV };
  });
  check('tool arms + VCB sets the distance', armed.tool === 'edgeoffset' && armed.dist === 0.4);

  // click the line, then the +y side
  const click = async (x, y) => {
    await p.evaluate(c => {
      const cv = document.querySelector('canvas');
      const rc = cv.getBoundingClientRect();
      cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: rc.x + c.x, clientY: rc.y + c.y }));
      cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: rc.x + c.x, clientY: rc.y + c.y }));
    }, { x, y });
    await sleep(250);
  };
  const P = async (w) => p.evaluate(q => {
    const v = window.app.view.toScreen(q);
    return { x: v.x, y: v.y };
  }, w);

  const lineMid = await P({ x: 3, y: 0, z: 0 });
  await click(lineMid.x, lineMid.y); // pick the line
  const picked = await p.evaluate(() => ({ pick: !!window.app.tool.pick, kind: window.app.tool.pick && window.app.tool.pick.kind }));
  check('click picks the line', picked.pick && picked.kind === 'line');
  // hover the +y side then click it
  const side = await P({ x: 3, y: 0.9, z: 0 });
  await p.evaluate(s => {
    const cv = document.querySelector('canvas');
    const rc = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: rc.x + s.x, clientY: rc.y + s.y }));
  }, side);
  await sleep(300);
  await click(side.x, side.y);
  await sleep(300);
  const lineResult = await p.evaluate(() => {
    const app = window.app;
    // the new edge: parallel to the source, 0.4 away
    const src = [...app.model.edges.values()].find(e => !e.curveId);
    const others = [...app.model.edges.values()].filter(e => e !== src && !e.curveId);
    const ys = [];
    for (const e of others) { ys.push(app.model.vp(e.a).y, app.model.vp(e.b).y); }
    return { dist: app.tool.dist, pick: app.tool.pick, n: others.length, ys: [...new Set(ys.map(q => +q.toFixed(3)))] };
  });
  check('side click commits the line offset', lineResult.n >= 1 && lineResult.ys.includes(0.4),
    `${lineResult.n} copies at y=${JSON.stringify(lineResult.ys)}`);
  check('distance stays armed (AutoCAD repeat)', lineResult.dist === 0.4 && lineResult.pick === null);

  // now the arc: pick it, click away from center
  const arcMid = await P({ x: 10, y: 2, z: 0 });
  await click(arcMid.x, arcMid.y);
  const arcPicked = await p.evaluate(() => ({ kind: window.app.tool.pick && window.app.tool.pick.kind }));
  check('click picks the arc', arcPicked.kind === 'arc');
  const away = await P({ x: 10, y: 3.5, z: 0 }); // outside radius 2 from (10,0)
  await click(away.x, away.y);
  await sleep(300);
  const arcResult = await p.evaluate(() => {
    const app = window.app;
    const m = app.model;
    const cids = [...m.curves.keys()];
    const metas = cids.map(id => m.curves.get(id));
    const radii = metas.map(mt => +mt.radius.toFixed(3));
    // vertices equidistant from the ORIGINAL center (10,0)
    const newCid = cids.find(id => Math.abs(m.curves.get(id).radius - 2) > 1e-9);
    let concentric = false;
    if (newCid != null) {
      const c = m.curves.get(newCid).center;
      concentric = m.curveEdges(newCid).every(e => {
        const d = Math.hypot(m.vp(e.a).x - c.x, m.vp(e.a).y - c.y);
        return Math.abs(d - m.curves.get(newCid).radius) < 5e-3;
      });
    }
    return { radii, concentric, dist: app.tool.dist };
  });
  check('arc offset commits concentric (radius 2.4)', arcResult.radii.includes(2.4), JSON.stringify(arcResult.radii));
  check('every copy vertex equidistant from the center', arcResult.concentric);
  check('distance still armed after the arc', arcResult.dist === 0.4);

  console.log('\npage errors:', errs.length);
  console.log(`\nverify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
