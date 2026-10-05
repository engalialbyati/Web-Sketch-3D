'use strict';
// manual-repro-convert3.js — TRUSTED-input verification of the context menu:
// real page.mouse clicks (real hit-testing) for select → right-click →
// clicking the 'Convert to Element…' item. This is what synthetic dispatch
// could not reproduce: the menu used to hide on the item's own mousedown,
// retargeting the native click so items "did nothing".
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1500, height: 900 });
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 250)));
  await p.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  const ver = await p.evaluate(() => {
    const s = [...document.querySelectorAll('script')].find(x => x.src.includes('app.js'));
    return s ? s.src.split('?')[1] : 'none';
  });
  console.log('served app.js:', ver);

  // canvas-local -> client coords for page.mouse (trusted input)
  const C = async pt => p.evaluate(q => {
    const app = window.app;
    app.view.cam.az = -1.15; app.view.cam.el = 0.9; app.view.cam.dist = 26;
    app.view.cam.target = { x: 4, y: 4, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
    const v = app.view.toScreen(q);
    const rc = document.querySelector('canvas').getBoundingClientRect();
    return { x: rc.x + v.x, y: rc.y + v.y };
  }, pt);

  // draw the triangle (synthetic is fine for drawing)
  await p.evaluate(() => {
    const app = window.app;
    app.setMode('free'); app.setTool('line');
  });
  await sleep(200);
  await C({ x: 0, y: 0, z: 0 }); // sets camera
  await sleep(200);
  for (const q of [{ x: 1, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, { x: 3, y: 4, z: 0 }, { x: 1, y: 1, z: 0 }]) {
    const s = await p.evaluate(q => {
      const v = window.app.view.toScreen(q);
      const rc = document.querySelector('canvas').getBoundingClientRect();
      window.__fire = window.__fire || ((x, y, t) => document.querySelector('canvas').dispatchEvent(new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
        button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: rc.x + x, clientY: rc.y + y,
      })));
      window.__fire(v.x, v.y, 'pointermove'); window.__fire(v.x, v.y, 'pointerdown'); window.__fire(v.x, v.y, 'pointerup');
      return true;
    }, q);
    await sleep(180);
  }
  console.log('triangle:', JSON.stringify(await p.evaluate(() => ({
    f: window.app.model.faces.size, e: window.app.model.edges.size,
  }))));

  // ---- TRUSTED clicks from here ----
  await p.evaluate(() => window.app.setTool('select'));
  await sleep(200);
  const inside = await C({ x: 3, y: 2, z: 0 });
  await p.mouse.click(inside.x, inside.y); // real left click
  await sleep(300);
  console.log('selection:', JSON.stringify(await p.evaluate(() => ({
    f: window.app.sel.faces.size, e: window.app.sel.edges.size,
  }))));

  await p.mouse.click(inside.x, inside.y, { button: 'right' }); // real right click
  await sleep(400);
  const item = await p.evaluate(() => {
    const items = [...document.querySelectorAll('#ctxmenu .mitem')];
    const it = items.find(d => /convert to element/i.test(d.textContent));
    if (!it) return null;
    const r = it.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: it.textContent.trim() };
  });
  console.log('menu item:', JSON.stringify(item));
  if (!item) { console.log('NO MENU ITEM — different problem'); await b.close(); return; }

  await p.mouse.click(item.x, item.y); // REAL click on the menu item
  await sleep(450);
  const dlg = await p.evaluate(() => {
    const bd = document.getElementById('dialog-backdrop');
    return { open: !!bd && !bd.classList.contains('hidden') };
  });
  console.log('dialog after TRUSTED item click:', JSON.stringify(dlg));

  if (dlg.open) {
    // finish: blank name + Convert (trusted click on the button)
    const btn = await p.evaluate(() => {
      const ok = [...document.querySelectorAll('.dlg-btn')].find(b => /^convert$/i.test(b.textContent.trim()));
      if (!ok) return null;
      const n = document.getElementById('cv-name'); if (n) n.value = '';
      const h = document.getElementById('cv-height'); if (h) h.value = '2.5';
      const r = ok.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await p.mouse.click(btn.x, btn.y);
    await sleep(900);
    const after = await p.evaluate(() => {
      const app = window.app;
      const last = app.bim.entities[app.bim.entities.length - 1];
      return {
        ents: app.bim.entities.length,
        last: last ? { type: last.type, name: (last.params || {}).name } : null,
        closed: document.getElementById('dialog-backdrop').classList.contains('hidden'),
      };
    });
    console.log('after Convert:', JSON.stringify(after));
    console.log(after.ents > 0 && after.closed ? 'TRUSTED FLOW WORKS' : 'STILL BROKEN');
  } else {
    console.log('STILL BROKEN: real click on the item opened no dialog');
  }
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
