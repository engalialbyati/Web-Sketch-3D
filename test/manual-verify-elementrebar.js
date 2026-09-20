'use strict';
// manual-verify-elementrebar.js — Whole-Element Reinforcement end-to-end in
// the browser: real column via the tool click; beam/foundation/floor built
// as registered entities; every cage created through the Element
// Reinforcement dialog (preselected face → Create), then X-Ray screenshots.
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

  // ---- real Column tool: column A (0.15, 0.15) and column B on the pad
  await p.evaluate(() => { window.app.setTool('column'); });
  await sleep(400);
  let click = await p.evaluate(() => {
    const v = window.app.view;
    const c = v.toClient(v.toScreen(window.G.v(0.15, 0.15, 0)));
    return { x: Math.round(c.x), y: Math.round(c.y) };
  });
  await p.mouse.click(click.x, click.y);
  await sleep(900);
  check('column A placed by the real tool',
    (await p.evaluate(() => window.app.bim.entities.some(e => e.type === 'column'))));

  // ---- beam + foundation(+column B via tool) + floor as registered entities
  await p.evaluate(() => {
    const app = window.app, G = window.G, m = app.model;
    const mk = (run, fn) => app.run(run, fn);
    const claim = (type, params) => {
      const roles = {};
      for (const [id, f] of m.faces) if (!f.userData) { roles[id] = 'body'; }
      app.bim.create(type, params, roles, []);
    };
    // NOTE: claim() must run right after each build with a facesBefore set —
    // rebuild it properly below
    const build = (label, type, params, fn) => {
      const before = new Set(m.faces.keys());
      mk(label, fn);
      const faces = [...m.faces.keys()].filter(id => !before.has(id));
      const roles = {};
      for (const fid of faces) roles[fid] = 'body';
      app.bim.create(type, params, roles, []);
    };
    build('beam', 'beam', {
      baseline: [[0.5, 0.7, 3], [3.5, 0.7, 3]], profile: 'rectangular',
      webWidth: 0.25, height: 0.5, zTop: 3.5, zJustification: 'Top',
    }, mm => app.structural.buildBeam(G, mm, {
      baseline: [[0.5, 0.7, 3], [3.5, 0.7, 3]], profile: 'rectangular',
      webWidth: 0.25, height: 0.5, zTop: 3.5, zJustification: 'Top' }));
    build('fnd', 'foundation', {
      base: [2.5, 0.6, 0], baseLevel: app.bimOptions.baseLevel,
      width: 1.2, depth: 1.2, thickness: 0.5,
    }, mm => app.structural.buildFooting(G, mm, {
      base: [2.5, 0.6, 0], baseLevel: app.bimOptions.baseLevel,
      width: 1.2, depth: 1.2, thickness: 0.5 }));
    const zF = 0, t = 0.2;
    const outer = [[4, 2, zF], [7, 2, zF], [7, 5, zF], [4, 5, zF]];
    build('floor', 'floor', { regions: [{ outer, holes: [] }], thickness: t }, mm => {
      const f = mm.addFaceFromRings(outer.map(q => G.v(...q)));
      mm.pushPull(f, -t);
    });
  });
  await sleep(600);
  // column B on the pad via the real tool (base level z=0 = pad top)
  await p.evaluate(() => { window.app.setTool('column'); });
  await sleep(400);
  click = await p.evaluate(() => {
    const v = window.app.view;
    const c = v.toClient(v.toScreen(window.G.v(2.5, 0.6, 0)));
    return { x: Math.round(c.x), y: Math.round(c.y) };
  });
  await p.mouse.click(click.x, click.y);
  await sleep(900);
  const st0 = await p.evaluate(() => {
    const app = window.app;
    app.setRibbonTab && app.setRibbonTab('detailing');
    return {
      ents: app.bim.entities.map(e => e.type),
      btn: !!document.querySelector('#toolbar .tbtn[data-tool="rebar-element"]'),
    };
  });
  check('scene: beam + foundation + floor + 2 columns', st0.ents.filter(e => e === 'column').length === 2
    && st0.ents.includes('beam') && st0.ents.includes('foundation') && st0.ents.includes('floor'),
    st0.ents.join(','));
  check('Element Reinforcement button on the Detailing ribbon', st0.btn);

  // ---- run the dialog for each element: pick ANY face of the entity
  const createFor = async (type, expectHost, label) => {
    const opened = await p.evaluate(tp => {
      const app = window.app, m = app.model;
      const ent = app.bim.entities.find(e => e.type === tp);
      const fid = [...m.faces.keys()].find(id => {
        const f = m.faces.get(id);
        return f.userData && f.userData.bimEntityId === ent.id;
      });
      app.sel.faces = new Set([fid]); app.sel.edges = new Set();
      app.setTool('rebar-element');
      const dlg = document.querySelector('#dialog');
      const title = dlg ? dlg.querySelector('h3,h2,.dlg-title') : null;
      return {
        dialog: !!dlg,
        detected: (document.getElementById('er-info') || {}).textContent || '',
        count: (document.getElementById('er-count') || {}).textContent || '',
      };
    }, type);
    await sleep(400);
    check(`${label}: dialog detects the element`, opened.dialog && opened.detected.toLowerCase().includes(label.split(' ')[0].toLowerCase()),
      opened.detected.trim());
    check(`${label}: live preview counted bars`, /\d+ bars/.test(opened.count), opened.count.trim());
    const res = await p.evaluate(() => {
      const btns = [...document.querySelectorAll('#dialog .dlg-btn')];
      btns[btns.length - 1].click();
      return null;
    });
    await sleep(900);
    const out = await p.evaluate(host => {
      const m = window.app.model;
      const rb = [...m.faces.values()].filter(f => f.userData && f.userData.rebar);
      return {
        faces: rb.filter(f => f.userData.rebar.host === host).length,
        groups: [...m.groups.values()].map(g => g.name),
      };
    }, expectHost);
    check(`${label}: cage committed (host=${expectHost})`, out.faces > 0, `${out.faces} faces`);
    check(`${label}: grouped`, out.groups.some(n => n.includes('Rebar') && n.toLowerCase().includes(label.split(' ')[0].toLowerCase())),
      out.groups.filter(n => n.includes('Rebar')).join(', ') || 'none');
  };

  // any-face picks: column side face, beam TOP face, foundation SIDE, floor TOP
  await createFor('beam', 'beam', 'Beam element');
  await createFor('column', 'column', 'Column element');
  await createFor('foundation', 'foundation', 'Foundation element');
  await createFor('floor', 'slab', 'Floor element');

  // ---- screenshots with X-Ray on
  await p.evaluate(() => { if (!window.app.xrayOn) window.app.action('toggleXray'); });
  await sleep(900);
  await p.evaluate(() => {
    const v = window.app.view;
    v.cam.az = -0.8; v.cam.el = 0.5; v.cam.dist = 7.5;
    v.cam.target = { x: 2.2, y: 1.8, z: 1.2 };
    v.applyCamera(); v.invalidate();
  });
  await sleep(700);
  await p.screenshot({ path: '_element-rebar-all.png' });
  await p.evaluate(() => {
    const v = window.app.view;
    v.cam.az = -0.6; v.cam.el = 0.35; v.cam.dist = 2.2;
    v.cam.target = { x: 2.0, y: 0.7, z: 3.1 };
    v.applyCamera(); v.invalidate();
  });
  await sleep(700);
  await p.screenshot({ path: '_element-rebar-beam.png' });
  await p.evaluate(() => {
    const v = window.app.view;
    v.cam.az = -0.9; v.cam.el = 0.9; v.cam.dist = 2.0;
    v.cam.target = { x: 2.5, y: 0.6, z: 0.0 };
    v.applyCamera(); v.invalidate();
  });
  await sleep(700);
  await p.screenshot({ path: '_element-rebar-fnd.png' });

  console.log(`\nelement rebar manual verify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
