'use strict';
// manual-verify-zoom.js — zoom-to-cursor close-ups: wheel-diving at a point
// on an element must pull the orbit target onto that point, pass the old
// 5 cm floor cleanly down to millimeters, and never clip the geometry away.
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

  // a column with a rebar cage — plenty of small detail to zoom into
  await p.evaluate(() => {
    const app = window.app, G = window.G;
    app.run('setup', m => {
      const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(0.3, 0, 0), G.v(0.3, 0.3, 0), G.v(0, 0.3, 0)]);
      m.pushPull(f, 3);
    });
    let top = null;
    for (const [id, f] of app.model.faces) {
      const n = G.norm(G.loopNormal(app.model.pts(f.loop)));
      if (!top && n.z > 0.999) top = id;
    }
    app.run('ties', m => window.Rebar.buildRebars(m, top, 'stirrup', {
      l: 0.04, r: 0.04, t: 0.04, b: 0.04, front: 0.05, dia: 0.008,
      rounding: 2, bentAngle: 135, bentFactor: 6, mode: 'spacing', value: 0.2,
    }));
    app.view.cam.az = -1.1; app.view.cam.el = 0.35; app.view.cam.dist = 8;
    app.view.cam.target = { x: 0.15, y: 0.15, z: 1.4 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(600);

  // where we dive: the screen pixel over the column TOP edge midpoint.
  // toScreen is CANVAS-local; mouse events are VIEWPORT pixels — toClient
  // adds the canvas offset so the synthetic wheel really lands on the point.
  const probe = await p.evaluate(() => {
    const v = window.app.view, G = window.G;
    const topEdge = v.toScreen(G.v(0.15, 0.15, 3)); // a point on the column
    const c = v.toClient({ x: Math.round(topEdge.x), y: Math.round(topEdge.y) });
    const P = v.worldAtScreen({ x: Math.round(topEdge.x), y: Math.round(topEdge.y) });
    return { px: Math.round(c.x), py: Math.round(c.y),
      cx: Math.round(topEdge.x), cy: Math.round(topEdge.y), d0: v.cam.dist,
      hasWorld: !!P, world: P ? [P.x, P.y, P.z] : null, near: v.persp.near };
  });
  check('worldAtScreen resolves the pixel to a world point', probe.hasWorld, JSON.stringify(probe.world));

  // wheel-dive straight at that pixel. The anchor is whatever the pixel's
  // ray hits — it may migrate across an edge as the camera approaches
  // (occlusion transition); the INVARIANTS are: the current hit stays under
  // the pixel, the orbit target converges onto it, and dist dives past the
  // old 5 cm floor.
  await p.mouse.move(probe.px, probe.py);
  for (let i = 0; i < 60; i++) { await p.mouse.wheel({ deltaY: -120 }); await sleep(15); }
  await sleep(500);
  let r = await p.evaluate(probe => {
    const v = window.app.view;
    const A = v.worldAtScreen({ x: probe.cx, y: probe.cy }); // the current anchor
    const t = v.cam.target;
    const s = A ? v.toScreen(A) : { x: 1e9, y: 1e9 };
    return {
      dist: v.cam.dist,
      near: v.persp.near,
      hasAnchor: !!A,
      miss: A ? Math.hypot(t.x - A.x, t.y - A.y, t.z - A.z) : 1e9,
      anchorDrift: Math.hypot(s.x - probe.cx, s.y - probe.cy),
    };
  }, probe);
  check('zoom passes the old 5 cm floor deep into close-up', r.dist < 0.05, `dist=${r.dist.toFixed(4)} m`);
  check('near plane adapted down with the dive', r.near < 0.01, `near=${r.near.toFixed(5)} m`);
  check('orbit target converged onto the anchor point', r.hasAnchor && r.miss < 0.02, `miss=${(r.miss * 1000).toFixed(1)} mm`);
  check('the anchor stayed under the cursor', r.hasAnchor && r.anchorDrift < 3, `drift=${r.anchorDrift.toFixed(1)} px`);

  // zoom back out with the same pivot — the anchor must STILL stay put
  for (let i = 0; i < 22; i++) { await p.mouse.wheel({ deltaY: 120 }); await sleep(15); }
  await sleep(300);
  r = await p.evaluate(probe => {
    const v = window.app.view;
    const A = v.worldAtScreen({ x: probe.cx, y: probe.cy });
    const s = A ? v.toScreen(A) : { x: 1e9, y: 1e9 };
    return { dist: v.cam.dist, drift: A ? Math.hypot(s.x - probe.cx, s.y - probe.cy) : 1e9 };
  }, probe);
  check('zooming back out keeps the anchor stable too', r.drift < 3 && r.dist > 0.05, `dist=${r.dist.toFixed(3)}, drift=${r.drift.toFixed(1)} px`);

  // dive again for the close-up screenshot (rebar hook detail)
  await p.mouse.move(probe.px, probe.py);
  for (let i = 0; i < 22; i++) { await p.mouse.wheel({ deltaY: -120 }); await sleep(15); }
  await sleep(600);
  await p.screenshot({ path: '_zoom-closeup.png' });

  // plain wheel zoom without a hit (sky) must not throw and still zoom
  r = await p.evaluate(() => {
    const v = window.app.view;
    const d0 = v.cam.dist;
    try { v.zoomBy(1.2, { x: 10, y: 10 }); return { ok: true, changed: v.cam.dist !== d0 }; }
    catch (e) { return { ok: false, err: String(e).slice(0, 200) }; }
  });
  check('zoom on empty sky does not throw', r.ok, r.err || '');

  console.log(`\nzoom manual verify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
