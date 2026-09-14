'use strict';
// manual-verify-ifcexport.js — Phase 1.1 browser round-trip:
//   page 1: build the Revit test building (grids/walls/columns/beams/slabs),
//           File > Export IFC… wiring check + grab the STEP text
//   page 2: fresh app, Import IFC as Elements from that text, count + validate
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

  // ---------------- page 1: build + export ----------------
  const p1 = await browser.newPage();
  await p1.setViewport({ width: 1500, height: 900 });
  const errs1 = [];
  p1.on('pageerror', e => { errs1.push(String(e)); console.log('[p1 pageerror]', String(e).slice(0, 250)); });
  await p1.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  const menuOk = await p1.evaluate(() => {
    // the File menu XML literal lives in app.js — probe the wired action map
    return typeof window.app.exportIfc === 'function' && !!window.IfcExport;
  });
  check('Export IFC wired (menu action + module)', menuOk);

  console.log('[1] building the Revit test building…');
  await p1.evaluate(() => {
    const app = window.app;
    app.action('demor5');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click();
  });
  await p1.waitForFunction(() => {
    const app = window.app;
    return app.bim && app.bim.entities.length >= 300;
  }, { timeout: 180000, polling: 2000 });
  const built = await p1.evaluate(() => {
    const app = window.app;
    const t = {};
    for (const e of app.bim.entities) t[e.type] = (t[e.type] || 0) + 1;
    return { total: app.bim.entities.length, t };
  });
  console.log('[1] built:', JSON.stringify(built));
  check('demo building loaded', built.total >= 300, `${built.total} entities`);

  const exported = await p1.evaluate(() => {
    const r = window.IfcExport.fromApp(window.app);
    return { text: r.text, counts: r.counts, entities: r.entities, len: r.text.length };
  });
  console.log('[1] export counts:', JSON.stringify(exported.counts), 'STEP entities:', exported.entities, 'bytes:', exported.len);
  check('export produced a STEP file', exported.len > 50000 && /IFCPROJECT\(/.test(exported.text));
  check('walls exported parametrically', (exported.counts.wall || 0) >= 80, `${exported.counts.wall} walls`);
  check('slabs exported with region profiles', (exported.counts.slab || 0) + (exported.counts.floor || 0) >= 4);
  check('columns + beams exported', (exported.counts.column || 0) >= 40 && (exported.counts.beam || 0) >= 40);
  check('hosted doors/windows exported', (exported.counts.door || 0) + (exported.counts.window || 0) >= 1);
  // STEP sanity
  const storeys = (exported.text.match(/IFCBUILDINGSTOREY\(/g) || []).length;
  check('storey per level', storeys >= 5, `${storeys} storeys`);
  const voidsN = (exported.text.match(/IFCRELVOIDSELEMENT\(/g) || []).length;
  const fillsN = (exported.text.match(/IFCRELFILLSELEMENT\(/g) || []).length;
  check('opening voids + door/window fills', voidsN >= 1 && fillsN >= 1, `${voidsN} voids, ${fillsN} fills`);

  // ---------------- page 2: fresh import of the exported text ----------------
  console.log('[2] re-importing the exported file into a fresh app…');
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1500, height: 900 });
  const errs2 = [];
  p2.on('pageerror', e => { errs2.push(String(e)); console.log('[p2 pageerror]', String(e).slice(0, 250)); });
  await p2.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  // the fresh page RESTORES the same demo from localStorage autosave —
  // existsLike would silently dedupe the round-trip and self-overlap would
  // fail validation. Start from a clean model.
  await p2.evaluate(() => {
    const app = window.app;
    app.action('new');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click(); // confirm discard
  });
  await sleep(800);
  const clean = await p2.evaluate(() => ({
    ents: window.app.bim.entities.length, faces: window.app.model.faces.size,
  }));
  console.log('[2] page-2 model cleared:', JSON.stringify(clean));
  check('page 2 starts clean', clean.ents === 0);

  const imp = await p2.evaluate(async text => {
    const app = window.app;
    const file = new File([text], 'roundtrip.ifc', { type: 'application/x-step' });
    const r = await window.IfcElements.load(file, app);
    return {
      counts: r.counts,
      skipped: r.skippedMeshes,
      levels: app.levelManager.levels.length,
      valid: app.model.validate().ok,
      errors: app.model.validate().errors.slice(0, 3),
      entities: app.bim.entities.length,
    };
  }, exported.text).catch(e => ({ error: String(e) }));
  console.log('[2] import result:', JSON.stringify(imp).slice(0, 400));
  if (imp.error) {
    check('round-trip import ran', false, imp.error.slice(0, 120));
  } else {
    check('round-trip: import ran clean', true);
    check('round-trip: walls came back as elements', (imp.counts.wall || 0) >= 80, `${imp.counts.wall} walls`);
    check('round-trip: columns came back', (imp.counts.column || 0) >= 50, `${imp.counts.column}`);
    check('round-trip: beams came back', (imp.counts.beam || 0) >= 80, `${imp.counts.beam}`);
    check('round-trip: slabs came back', (imp.counts.slab || 0) + (imp.counts.floor || 0) >= 4,
      `${(imp.counts.slab || 0) + (imp.counts.floor || 0)}`);
    check('round-trip: storeys became levels', imp.levels >= 5, `${imp.levels} levels`);
    check('round-trip: model validates', imp.valid, (imp.errors || []).join(' | ').slice(0, 150));
  }

  console.log('\npage errors:', errs1.length + errs2.length);
  console.log(`\nverify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
