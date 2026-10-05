'use strict';
// manual-repro-convert2.js — the user's EXACT path: triangle, select face +
// 3 edges (shift-clicks), real right-click, click the 'Convert to Element…'
// MENU ITEM like a user, then Convert with an empty name.
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1500, height: 900 });
  const errs = [];
  p.on('pageerror', e => { errs.push(String(e)); console.log('[pageerror]', String(e).slice(0, 300)); });
  p.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
  await p.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  const ver = await p.evaluate(() => {
    const s = [...document.querySelectorAll('script')].find(x => x.src.includes('app.js'));
    return s ? s.src.split('?')[1] : 'none';
  });
  console.log('served app.js version:', ver);

  await p.evaluate(() => {
    const c = document.querySelector('canvas');
    const rc = c.getBoundingClientRect();
    window.__fire = (x, y, type, button = 0, shift = false) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      button, buttons: type === 'pointerup' ? 0 : (button === 2 ? 2 : 1),
      shiftKey: shift, clientX: rc.x + x, clientY: rc.y + y,
    }));
    window.__click = (x, y, shift = false) => {
      window.__fire(x, y, 'pointerdown', 0, shift);
      window.__fire(x, y, 'pointerup', 0, shift);
    };
    window.__rmenu = (x, y) => {
      window.__fire(x, y, 'pointerdown', 2);
      window.__fire(x, y, 'pointerup', 2);
      c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    };
    const app = window.app;
    app.setMode('free');
    app.setTool('line');
    app.view.cam.az = -1.15; app.view.cam.el = 0.9; app.view.cam.dist = 26;
    app.view.cam.target = { x: 4, y: 4, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(400);
  const P = pt => p.evaluate(q => {
    const v = window.app.view.toScreen(q);
    return { x: v.x, y: v.y };
  }, pt);

  // triangle: 3 clicks + close on the start point
  for (const q of [{ x: 1, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, { x: 3, y: 4, z: 0 }, { x: 1, y: 1, z: 0 }]) {
    const s = await P(q);
    await p.evaluate(s => { window.__fire(s.x, s.y, 'pointermove'); window.__click(s.x, s.y); }, s);
    await sleep(180);
  }
  console.log('triangle:', JSON.stringify(await p.evaluate(() => ({
    faces: window.app.model.faces.size, edges: window.app.model.edges.size,
  }))));

  // select: click inside the face, then SHIFT-click the three edges
  await p.evaluate(() => window.app.setTool('select'));
  await sleep(200);
  const inside = await P({ x: 3, y: 2, z: 0 });
  await p.evaluate(s => window.__click(s.x, s.y), inside);
  await sleep(250);
  for (const q of [{ x: 1.05, y: 1, z: 0 }, { x: 4.95, y: 1, z: 0 }, { x: 2, y: 2.5, z: 0 }]) {
    const s = await P(q);
    await p.evaluate(s => { window.__fire(s.x, s.y, 'pointermove'); window.__click(s.x, s.y, true); }, s);
    await sleep(200);
  }
  const sel = await p.evaluate(() => ({ f: window.app.sel.faces.size, e: window.app.sel.edges.size }));
  console.log('selection (want 1 face + 3 edges):', JSON.stringify(sel));

  // REAL right-click on the selection, then click the menu item like a user
  await p.evaluate(s => window.__rmenu(s.x, s.y), inside);
  await sleep(350);
  const menuItem = await p.evaluate(() => {
    const items = [...document.querySelectorAll('#ctxmenu > div, #ctxmenu div')]
      .filter(d => /convert to element/i.test(d.textContent) && d.offsetParent !== null);
    if (!items.length) return { found: false };
    items[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return { found: true, label: items[0].textContent.trim() };
  });
  await sleep(400);
  const dialog = await p.evaluate(() => {
    const bd = document.getElementById('dialog-backdrop');
    return { open: !!bd && !bd.classList.contains('hidden'), title: (document.querySelector('.dialog-title') || {}).textContent };
  });
  console.log('menu item:', JSON.stringify(menuItem), '-> dialog:', JSON.stringify(dialog));

  if (dialog.open) {
    const r = await p.evaluate(() => {
      const n = document.getElementById('cv-name');
      if (n) n.value = ''; // blank — the reported repro
      const h = document.getElementById('cv-height');
      if (h) h.value = '2.5';
      const ok = [...document.querySelectorAll('.dlg-btn')].find(b => /^convert$/i.test(b.textContent.trim()));
      if (ok) ok.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { clicked: !!ok };
    });
    await sleep(900);
    const after = await p.evaluate(() => {
      const app = window.app;
      const bd = document.getElementById('dialog-backdrop');
      const last = app.bim.entities[app.bim.entities.length - 1];
      return {
        ents: app.bim.entities.length,
        last: last ? { type: last.type, name: (last.params || {}).name } : null,
        faces: app.model.faces.size,
        closed: bd.classList.contains('hidden'),
      };
    });
    console.log('after Convert:', JSON.stringify(r), '->', JSON.stringify(after));
    const ok = after.ents > 0 && after.last && after.closed;
    console.log(ok ? 'FLOW WORKS end-to-end' : 'FLOW STILL BROKEN');
  } else {
    console.log('FLOW BROKEN BEFORE THE DIALOG — menu item produced no dialog');
  }
  console.log('page errors:', errs.length);
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
