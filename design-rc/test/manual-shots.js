'use strict';
// manual-shots.js — capture the detail-reference images for the
// verification manual PDF. One session on the 5-story demo, targeted
// cameras per detail, light/detail modes as noted.
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu-sandbox'], protocolTimeout: 600000 });
  const p = await browser.newPage();
  await p.setViewport({ width: 1300, height: 800 });
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  p.on('dialog', async d => { await d.accept(); });
  await p.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await p.evaluate(() => { window.app.action('demomnl66'); });
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) {
    await sleep(1000);
    ready = await p.evaluate(() => window.app._demoRecipe === 'mnl66'
      && window.app.view.rebarMode === 'light');
  }
  console.log('demo ready:', ready);
  await sleep(1200);

  const shot = async (name, cam, mode) => {
    await p.evaluate(c => {
      const app = window.app, v = app.view;
      if (c.mode === 'detail' && v.rebarMode !== 'detail') { app.rebarLight = false; v.setRebarMode('detail'); }
      if (c.mode !== 'detail' && v.rebarMode === 'detail') { app.rebarLight = true; v.setRebarMode('light'); }
      v.cam.az = c.az; v.cam.el = c.el; v.cam.dist = c.dist;
      v.cam.target = c.target;
      v.applyCamera(); v.invalidate();
    }, { ...cam, mode });
    await sleep(mode === 'detail' ? 2600 : 1600);
    await p.screenshot({ path: '_manual-' + name + '.png' });
    console.log('shot', name);
  };

  // ---- BEAM ----
  await shot('beam-span', { az: -1.35, el: 0.28, dist: 4.2, target: { x: 3, y: 0, z: 2.6 } }, 'detail');
  await shot('beam-farside', { az: -1.15, el: 0.12, dist: 2.6, target: { x: 6.05, y: 0.1, z: 2.6 } }, 'detail');
  await shot('beam-hook', { az: -1.4, el: 0.06, dist: 1.6, target: { x: 6.1, y: 0.05, z: 2.75 } }, 'detail');
  await shot('beam-tbeam', { az: -1.2, el: 0.5, dist: 2.4, target: { x: 6.15, y: 0.1, z: 2.7 } }, 'detail');
  // ---- COLUMN ----
  await shot('col-splice', { az: -1.0, el: 0.1, dist: 2.4, target: { x: 6.0, y: 0.0, z: 5.9 } }, 'detail');
  await shot('col-base', { az: -0.9, el: 0.22, dist: 2.2, target: { x: 0.0, y: 0.0, z: 0.55 } }, 'detail');
  await shot('col-pier', { az: -0.9, el: 0.18, dist: 2.6, target: { x: 15.5, y: 3.0, z: 0.3 } }, 'detail');
  // ---- WALL ----
  await shot('wall-openings', { az: -1.57, el: 0.06, dist: 4.4, target: { x: 9.0, y: 6.0, z: 7.2 } }, 'light');
  await shot('wall-boundary', { az: -1.3, el: 0.12, dist: 2.4, target: { x: 1.6, y: 2.2, z: 4.2 } }, 'light');
  await shot('wall-dowels', { az: -1.5, el: 0.1, dist: 2.6, target: { x: 6.0, y: 6.0, z: 6.35 } }, 'light');
  await shot('elevator', { az: -1.1, el: 0.16, dist: 4.6, target: { x: 2.6, y: 3.2, z: 7.5 } }, 'light');
  // ---- SLAB ----
  await shot('slab-mesh', { az: -1.2, el: 0.55, dist: 5.5, target: { x: 3, y: 2, z: 9.2 } }, 'light');
  await shot('slab-corner', { az: -1.35, el: 0.5, dist: 3.2, target: { x: 0.2, y: 0.2, z: 9.2 } }, 'light');
  await shot('slab-hole', { az: -1.25, el: 0.55, dist: 3.0, target: { x: 5.0, y: 1.0, z: 9.2 } }, 'light');
  // ---- FOUNDATIONS ----
  await shot('fnd-raft', { az: -0.95, el: 0.5, dist: 10, target: { x: 6, y: 3, z: -0.2 } }, 'light');
  await shot('fnd-combined', { az: -0.8, el: 0.4, dist: 4.2, target: { x: 15.4, y: 0.0, z: -0.1 } }, 'light');
  await shot('fnd-strip', { az: -0.75, el: 0.35, dist: 4.0, target: { x: 14.2, y: 4.3, z: -0.1 } }, 'light');
  await shot('fnd-pier', { az: -0.85, el: 0.3, dist: 3.0, target: { x: 15.5, y: 3.0, z: -0.35 } }, 'light');
  await shot('sog-apron', { az: -0.9, el: 0.45, dist: 4.2, target: { x: 15.0, y: -2.0, z: 0.0 } }, 'light');
  // ---- OVERALL ----
  await shot('overview', { az: -0.9, el: 0.35, dist: 26, target: { x: 8, y: 2, z: 7 } }, 'light');
  await browser.close();
  console.log('all shots done');
})();
