'use strict';
// manual-verify-stirrup.js — visual check of the reworked stirrup hook corner:
// FreeCAD-style compact seismic hook (both tails anchored at the sharp corner
// pair) + screenshots for image review.
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

  // column + single-tie cage, built directly (dialog path covered elsewhere).
  // The column MUST be registered as a BIM entity: an unregistered box merges
  // into the same opaque mesh as the rebar and hard-occludes the cage.
  const st = await p.evaluate(() => {
    const app = window.app, G = window.G, m = app.model;
    app.run('col', mm => window.ColumnFeature.placeColumn(G, mm, G.v(0.15, 0.15, 0), 0.3, 0.3, 3, 0,
      { bimEntityId: 'col', bimType: 'column' }));
    app.bim.entities.push({ id: 'col', type: 'column',
      params: { base: [0.15, 0.15, 0], width: 0.3, depth: 0.3, height: 3, rotation: 0 },
      faces: [], edges: [] });
    for (const [id, f] of m.faces) if (!f.userData) f.userData = { bimEntityId: 'col', bimType: 'column' };
    const ent = app.bim.entities.find(e => e.id === 'col');
    ent.faces = [...m.faces.keys()].filter(id => { const f = m.faces.get(id); return f.userData && f.userData.bimEntityId === 'col'; });
    let top = null;
    for (const [id, f] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (!top && n.z > 0.999) top = id;
    }
    const tie = { l: 0.03, r: 0.03, t: 0.03, b: 0.03, dia: 0.008,
      bentAngle: 135, bentFactor: 8, mode: 'amount', value: 4, front: 0.15 };
    const main = { dia: 0.016, tOffset: 0.04, bOffset: 0.04, type: 'straight' };
    const res = window.ColumnRebar.buildColumnCage(m, top, { type: 'singletie', tie, main });
    // geometry audit of one tie centerline via the preview recorder
    const fr = window.Rebar.faceFrame(m, top);
    const path = window.Rebar.stirrupPath(fr, { ...tie, rounding: (0.008 / 2 + 0.016 / 2) / 0.008 });
    const us = path.map(q => G.dot(q, fr.u)), vs = path.map(q => G.dot(q, fr.v));
    return {
      ties: res.ties, bars: res.bars,
      rebarFaces: [...m.faces.values()].filter(f => f.userData && f.userData.rebar).length,
      corner: { u: us[1], v: vs[1] },           // pts[1] must BE the sharp corner
      startTail: { du: us[0] - us[1], dv: vs[0] - vs[1] },
      endTail: { du: us[us.length - 1] - us[us.length - 2], dv: vs[vs.length - 1] - vs[vs.length - 2] },
      top: { z: 3 },
    };
  });
  await sleep(600);
  check('cage built', st.ties >= 4 && st.bars === 4 && st.rebarFaces > 50,
    `${st.rebarFaces} rebar faces`);
  const r = 0.004, Rk = 0.012, L = 8 * 0.008; // tie r, mandrel R (auto 1.5×dia), tail
  check('pts[1] is the lap point T on the top edge (arc + R in)',
    Math.abs(st.corner.u - (0.15 - 0.15 + 0.03 + r + Rk)) < 1e-9 && Math.abs(st.corner.v - (0.15 + 0.15 - 0.03 - r)) < 1e-9,
    `corner at (${st.corner.u.toFixed(4)}, ${st.corner.v.toFixed(4)})`);
  const diag = Math.hypot(st.startTail.du, st.startTail.dv);
  check('start tail anchors AT the corner, diving 135° into the core',
    diag > L * 0.9 && st.startTail.dv < -L * 0.6 && st.startTail.du > L * 0.6,
    `tail Δ=(${st.startTail.du.toFixed(4)}, ${st.startTail.dv.toFixed(4)})`);
  check('end tail anchors at the overshoot, same dive',
    st.endTail.dv < -L * 0.6 && st.endTail.du > L * 0.6 && Math.abs(st.endTail.du - st.startTail.du) < 1e-9,
    `tail Δ=(${st.endTail.du.toFixed(4)}, ${st.endTail.dv.toFixed(4)})`);

  // ---- renders: whole cage, one tie top-down, hook corner 3/4 close-up.
  // X-Ray ghosts the concrete so the cage shows through; cameras go LAST —
  // the tool path auto-frames the view after a commit.
  await p.evaluate(() => { if (!window.app.xrayOn) window.app.action('toggleXray'); });
  await sleep(900);
  await p.evaluate(() => {
    const v = window.app.view;
    v.cam.az = -0.9; v.cam.el = 0.35; v.cam.dist = 3.2;
    v.cam.target = { x: 0.15, y: 0.15, z: 1.5 };
    v.applyCamera(); v.invalidate();
  });
  await sleep(500);
  await p.screenshot({ path: '_stirrup-fix-cage.png' });

  await p.evaluate(() => {
    const v = window.app.view;
    v.cam.az = -0.9; v.cam.el = 1.45; v.cam.dist = 0.9;
    v.cam.target = { x: 0.15, y: 0.15, z: 2.846 }; // first tie plane, top-down
    v.applyCamera(); v.invalidate();
  });
  await sleep(500);
  await p.screenshot({ path: '_stirrup-fix-top.png' });

  await p.evaluate(() => {
    const v = window.app.view;
    v.cam.az = 2.35; v.cam.el = 0.85; v.cam.dist = 0.42; // from outside the -x/+y quadrant
    v.cam.target = { x: 0.034, y: 0.266, z: 2.846 };     // the hook corner
    v.applyCamera(); v.invalidate();
  });
  await sleep(500);
  await p.screenshot({ path: '_stirrup-fix-corner.png' });

  console.log(`\nstirrup manual verify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
