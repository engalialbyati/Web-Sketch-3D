'use strict';
// manual-verify-georef.js — roadmap 1.2 browser flow: open the Georeferencing
// dialog, set base point + true north, check the north arrow, export IFC and
// read IfcMapConversion back through the importer into a fresh model.
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

  // ---- dialog flow ----
  const dlg = await p.evaluate(() => {
    const app = window.app;
    app.georefDialog();
    const bd = document.getElementById('dialog-backdrop');
    return {
      open: !!bd && !bd.classList.contains('hidden'),
      fields: ['geo-be', 'geo-bn', 'geo-bz', 'geo-se', 'geo-sn', 'geo-ang', 'geo-crs']
        .filter(id => !!document.getElementById(id)).length,
    };
  });
  console.log('[1] dialog:', JSON.stringify(dlg));
  check('Georeferencing dialog opens with all fields', dlg.open && dlg.fields === 7);

  const applied = await p.evaluate(() => {
    document.getElementById('geo-be').value = '500000';
    document.getElementById('geo-bn').value = '4649776';
    document.getElementById('geo-bz').value = '12.5';
    document.getElementById('geo-ang').value = '15';
    document.getElementById('geo-crs').value = 'EPSG:32633';
    const ok = [...document.querySelectorAll('.dlg-btn')].find(b => /apply/i.test(b.textContent));
    if (ok) ok.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const app = window.app;
    return {
      geo: app.model.geo,
      arrow: !!(app.view.northArrow && app.view.northArrow.visible),
      rot: app.view.northArrow ? +app.view.northArrow.rotation.z.toFixed(4) : null,
    };
  });
  await sleep(400);
  console.log('[2] applied:', JSON.stringify({ geo: applied.geo, arrow: applied.arrow, rot: applied.rot }));
  check('base point applied to the model', applied.geo && Math.abs(applied.geo.basePoint.east - 500000) < 1e-6);
  check('true-north angle stored (15°)', applied.geo && Math.abs(applied.geo.angleToTrueNorth - 15 * Math.PI / 180) < 1e-6);
  check('north arrow visible and rotated', applied.arrow && Math.abs(Math.abs(applied.rot) - 15 * Math.PI / 180) < 1e-3);

  // persists through save/load
  const persist = await p.evaluate(() => {
    const app = window.app;
    const snap = app.model.serialize();
    app.model.load(snap);
    return { geo: !!app.model.geo && app.model.geo.basePoint.east };
  });
  check('geo persists through serialize/load', persist.geo === 500000);

  // export carries the conversion
  const exp = await p.evaluate(() => {
    const r = window.IfcExport.fromApp(window.app);
    const mc = r.text.split('\n').find(l => l.includes('IFCMAPCONVERSION(')) || '';
    const crs = r.text.split('\n').find(l => l.includes('IFCPROJECTEDCRS(')) || '';
    return { mc: mc.slice(0, 100), crs: crs.slice(0, 90), counts: r.counts };
  });
  console.log('[3] export:', JSON.stringify(exp));
  check('IfcMapConversion in the export', exp.mc.includes('500000') && exp.mc.includes('4649776'), exp.mc);
  check('IfcProjectedCRS in the export', exp.crs.includes('EPSG:32633'));

  // round-trip: fresh page, import the file, geo comes home
  const text = await p.evaluate(() => window.IfcExport.fromApp(window.app).text);
  const p2 = await browser.newPage();
  p2.on('pageerror', e => console.log('[p2 pageerror]', String(e).slice(0, 200)));
  await p2.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await p2.evaluate(() => {
    const app = window.app;
    app.action('new');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click();
  });
  await sleep(500);
  const rt = await p2.evaluate(async t => {
    const app = window.app;
    await window.IfcElements.load(new File([t], 'geo.ifc'), app);
    const g = app.model.geo;
    return {
      has: !!g,
      east: g && +g.basePoint.east.toFixed(1),
      north: g && +g.basePoint.north.toFixed(1),
      deg: g && +(g.angleToTrueNorth * 180 / Math.PI).toFixed(2),
      crs: g && g.crsName,
    };
  }, text).catch(e => ({ error: String(e) }));
  console.log('[4] round-trip geo:', JSON.stringify(rt));
  check('geo imported back (round-trip parity)', !rt.error && rt.has && rt.east === 500000 && rt.north === 4649776,
    rt.error ? rt.error.slice(0, 80) : `${rt.east}E ${rt.north}N ${rt.deg}° ${rt.crs}`);
  check('true-north angle round-trips', !rt.error && rt.deg === 15, String(rt.deg));

  console.log('\npage errors:', errs.length);
  console.log(`\nverify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
