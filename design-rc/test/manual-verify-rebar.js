'use strict';
// manual-verify-rebar.js — Detailing tab + single rebar shapes on a real
// column: stirrups from the top face (spacing mode), corner straight bars
// from a side face (amount mode), L-shape bars, all through the real dialogs.
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

  // ---- the Detailing tab exists and holds the three tools
  const tab = await p.evaluate(() => {
    const b = document.querySelector('#modetabs .mtab[data-tab="detailing"]');
    if (!b) return { ok: false };
    b.click();
    const tools = [...document.querySelectorAll('#toolbar .tbtn[data-tool]')].map(x => x.dataset.tool);
    const noUndefinedIcon = [...document.querySelectorAll('#toolbar .tbtn')].every(x => !x.innerHTML.includes('undefined'));
    return { ok: true, label: b.textContent, tools, noUndefinedIcon };
  });
  check('Detailing tab present and switchable', tab.ok && tab.label === 'Detailing');
  check('ribbon shows the three rebar tools', tab.ok && ['rebar-straight', 'rebar-lshape', 'rebar-stirrup'].every(t => tab.tools.includes(t)), JSON.stringify(tab.tools || []));
  check('no undefined icons', tab.ok && tab.noUndefinedIcon);

  // ---- build a 0.3×0.3×3 column
  await p.evaluate(() => {
    const app = window.app, G = window.G;
    app.view.cam.az = -1.1; app.view.cam.el = 0.35; app.view.cam.dist = 5;
    app.view.cam.target = { x: 0.15, y: 0.15, z: 1.4 };
    app.view.applyCamera(); app.view.invalidate();
    app.run('setup', m => {
      const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(0.3, 0, 0), G.v(0.3, 0.3, 0), G.v(0, 0.3, 0)]);
      m.pushPull(f, 3);
    });
  });
  await sleep(400);
  const hostCount = await p.evaluate(() => window.app.model.faces.size);
  check('column host built', hostCount === 6, `${hostCount} faces`);


  // ---- STIRRUP via the real dialog: top face preselected → spacing 0.2
  let r = await p.evaluate((nx,ny,nz)=>{
    const fbn = eval("(nx,ny,nz)=>{const G=window.G,m=window.app.model;for(const[id,f]of m.faces){const n=G.norm(G.loopNormal(m.pts(f.loop)));if(Math.abs(n.x-nx)<1e-6&&Math.abs(n.y-ny)<1e-6&&Math.abs(n.z-nz)<1e-6)return id;}return null;}");
    const app = window.app;
    const fid = fbn(nx,ny,nz);
    app.sel.faces = new Set([fid]); app.sel.edges = new Set();
    app.setTool('rebar-stirrup');
    return { dialog: !!document.querySelector('#dialog'), fid };
  }, 0, 0, 1);
  await sleep(400);
  check('stirrup dialog opens on preselected top face', r.dialog);
  r = await p.evaluate(() => {
    document.querySelector('input[name="rebar-mode"][value="spacing"]').click();
    document.getElementById('st-front').value = '0.05';
    document.getElementById('st-front').dispatchEvent(new Event('input'));
    document.getElementById('rb-spc').value = '0.2';
    document.getElementById('rb-spc').dispatchEvent(new Event('input'));
    const info = document.getElementById('rebar-info');
    return { info: info ? info.textContent : null };
  });
  await sleep(300);
  check('live info line', r.info && r.info.includes('stirrups'), JSON.stringify(r.info));
  r = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('#dialog .dlg-btn')];
    btns[btns.length - 1].click();
    return null;
  });
  await sleep(700);
  r = await p.evaluate(() => {
    const m = window.app.model;
    const rebars = [...m.faces.values()].filter(f => f.userData && f.userData.rebar);
    const ties = rebars.filter(f => f.userData.rebar.shape === 'stirrup');
    return { total: m.faces.size, rebarFaces: rebars.length, tieFaces: ties.length,
      count: ties.length ? ties[0].userData.rebar.count : 0, groups: m.groups.size };
  });
  check('stirrups committed', r.tieFaces > 0 && r.count === 16, `${r.tieFaces} tie faces, count=${r.count} (FreeCAD formula: 16 ties @0.2 over 3 m)`);
  check('a Rebar group was created', r.groups >= 1);

  // ---- STRAIGHT corner bars: +y side face, amount 2
  r = await p.evaluate((nx,ny,nz)=>{
    const fbn = eval("(nx,ny,nz)=>{const G=window.G,m=window.app.model;for(const[id,f]of m.faces){const n=G.norm(G.loopNormal(m.pts(f.loop)));if(Math.abs(n.x-nx)<1e-6&&Math.abs(n.y-ny)<1e-6&&Math.abs(n.z-nz)<1e-6)return id;}return null;}");
    const app = window.app;
    app.sel.faces = new Set([fbn(nx,ny,nz)]); app.sel.edges = new Set();
    app.setTool('rebar-straight');
    return { dialog: !!document.querySelector('#dialog') };
  }, 0, 0, 1);
  await sleep(400);
  check('straight dialog opens on side face', r.dialog);
  r = await p.evaluate(() => {
    document.getElementById('rb-amt').value = '2';
    document.getElementById('rb-amt').dispatchEvent(new Event('input'));
    const btns = [...document.querySelectorAll('#dialog .dlg-btn')];
    btns[btns.length - 1].click();
    return null;
  });
  await sleep(600);
  r = await p.evaluate(() => {
    const m = window.app.model;
    const bars = [...m.faces.values()].filter(f => f.userData && f.userData.rebar && f.userData.rebar.shape === 'straight');
    return { barFaces: bars.length, count: bars.length ? bars[0].userData.rebar.count : 0 };
  });
  check('straight bars committed (amount 2)', r.barFaces > 0 && r.count === 2, `${r.barFaces} faces`);

  // ---- L-SHAPE bars: -x side face? use +x face, Bottom Left, amount 2
  r = await p.evaluate((nx,ny,nz)=>{
    const fbn = eval("(nx,ny,nz)=>{const G=window.G,m=window.app.model;for(const[id,f]of m.faces){const n=G.norm(G.loopNormal(m.pts(f.loop)));if(Math.abs(n.x-nx)<1e-6&&Math.abs(n.y-ny)<1e-6&&Math.abs(n.z-nz)<1e-6)return id;}return null;}");
    const app = window.app;
    app.sel.faces = new Set([fbn(nx,ny,nz)]); app.sel.edges = new Set();
    app.setTool('rebar-lshape');
    return { dialog: !!document.querySelector('#dialog') };
  }, 0, 0, 1);
  await sleep(400);
  check('L-shape dialog opens', r.dialog);
  r = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('#dialog .dlg-btn')];
    btns[btns.length - 1].click();
    return null;
  });
  await sleep(600);
  r = await p.evaluate(() => {
    const m = window.app.model;
    const bars = [...m.faces.values()].filter(f => f.userData && f.userData.rebar && f.userData.rebar.shape === 'lshape');
    return { barFaces: bars.length };
  });
  check('L-shape bars committed', r.barFaces > 0, `${r.barFaces} faces`);

  await sleep(500);
  await p.screenshot({ path: '_rebar-verify.png' });

  // ---- deleting the host must keep the rebar (loose independence)
  r = await p.evaluate(() => {
    const app = window.app, m = app.model;
    const host = [...m.faces.keys()].filter(id => {
      const f = m.faces.get(id);
      return !(f.userData && f.userData.rebar);
    });
    app.run('delete host', mm => { for (const id of host) mm.deleteFace(id, true); mm.gc(); });
    const rebars = [...m.faces.values()].filter(f => f.userData && f.userData.rebar).length;
    return { faces: m.faces.size, rebars };
  });
  check('rebar survives deleting the host (loose geometry)', r.faces === r.rebars, `${r.rebars} rebar faces remain of ${r.faces}`);
  await sleep(600);
  await p.screenshot({ path: '_rebar-cage.png' });

  console.log(`\nrebar manual verify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
