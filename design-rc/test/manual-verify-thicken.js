'use strict';
// manual-verify-thicken.js — Give Thickness on a CURVED mesh of loose faces
// (the Create Face workflow): the shell must offset perpendicular to the
// local curvature (smoothed normals), flip the inner copy, bridge the rim,
// and close watertight — no shearing toward a global direction.
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
    const app = window.app, G = window.G;
    app.view.cam.az = -Math.PI / 4; app.view.cam.el = 0.7; app.view.cam.dist = 12;
    app.view.cam.target = { x: 2, y: 2, z: 1 };
    app.view.applyCamera(); app.view.invalidate();
    // a curved wall of LOOSE faces: quarter-cylinder, R=3, H=2, 8 plates —
    // exactly what Create Face on offset arcs produces
    app.run('setup', m => {
      const R = 3, H = 2, SEG = 8;
      for (let i = 0; i < SEG; i++) {
        const a0 = (i / SEG) * Math.PI / 2, a1 = ((i + 1) / SEG) * Math.PI / 2;
        m.addFaceFromRings(
          [G.v(R * Math.cos(a0), R * Math.sin(a0), 0), G.v(R * Math.cos(a0), R * Math.sin(a0), H),
           G.v(R * Math.cos(a1), R * Math.sin(a1), H), G.v(R * Math.cos(a1), R * Math.sin(a1), 0)],
          [], { standalone: true });
      }
    });
  });
  await sleep(400);

  // select all plates, open the dialog, run the live preview + commit
  const preview = await p.evaluate(() => {
    const app = window.app, m = app.model;
    app.sel.faces = new Set([...m.faces.keys()]);
    app.thickenDialog();
    const info = document.getElementById('thick-info');
    return { faces: app.sel.faces.size, info: info ? info.textContent : null };
  });
  await sleep(300);
  check('dialog opened on 8 loose plates', preview.faces === 8 && !!preview.info, JSON.stringify(preview));

  const committed = await p.evaluate(() => {
    const app = window.app, m = app.model;
    document.getElementById('thick-val').value = '0.15';
    const btns = [...document.querySelectorAll('#dialog .dlg-btn')];
    const okBtn = btns[btns.length - 1]; // 'Thicken'
    okBtn.click();
    return null;
  });
  await sleep(500);
  const result = await p.evaluate(() => {
    const app = window.app, m = app.model;
    const pk = q => Math.round(q.x * 1e5) + ',' + Math.round(q.y * 1e5) + ',' + Math.round(q.z * 1e5);
    const faces = [...m.faces.values()];
    const before = 8;
    // positional edge audit over ALL faces
    const cnt = new Map();
    for (const f of faces) {
      for (const ring of m.rings(f)) for (let i = 0; i < ring.length; i++) {
        const ka = pk(m.vp(ring[i])), kb = pk(m.vp(ring[(i + 1) % ring.length]));
        const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        cnt.set(k, (cnt.get(k) || 0) + 1);
      }
    }
    let open = 0, paired = 0;
    for (const [, c] of cnt) { if (c === 1) open++; else if (c === 2) paired++; }
    // perpendicular check: find offset copies of the seam vertex at 45°
    const seam = { x: 3 * Math.cos(Math.PI / 4), y: 3 * Math.sin(Math.PI / 4), z: 0 };
    let best = null, bd = 1e9;
    for (const f of faces) {
      for (const ring of m.rings(f)) for (const v of ring) {
        const q = m.vp(v);
        const d = Math.hypot(q.x - seam.x, q.y - seam.y, q.z - seam.z);
        if (d > 0.05 && d < bd) { bd = d; best = q; } // the OFFSET copy, not the source vertex
      }
    }
    let align = 0, len = 0;
    if (best && bd < 0.3) {
      const dir = { x: best.x - seam.x, y: best.y - seam.y, z: best.z - seam.z };
      len = Math.hypot(dir.x, dir.y, dir.z);
      align = (dir.x * seam.x + dir.y * seam.y) / (len * Math.hypot(seam.x, seam.y));
    }
    return { faces: faces.length, added: faces.length - before, open, paired, align: +align.toFixed(4), len: +len.toFixed(4), valid: m.validate().ok };
  });
  check('shell committed (offset copy + walls)', result.added >= 24, JSON.stringify(result));
  check('offset perpendicular to the curvature', Math.abs(result.align) > 0.999, `radial align ${result.align}`);
  check('uniform mitered thickness ~0.15', Math.abs(Math.abs(result.len) - 0.15) < 0.01, `len ${result.len}`);
  check('watertight — no open edges', result.open === 0, `open=${result.open} paired=${result.paired}`);
  check('model valid', result.valid);

  await p.screenshot({ path: 'test/_thicken-verify.png' });
  await browser.close();
  console.log(`\nthicken verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
