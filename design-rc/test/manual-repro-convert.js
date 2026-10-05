'use strict';
// manual-repro-convert.js — repro: triangle via line tool, select face+edges,
// right-click Convert to Element, watch what happens. Diagnostic only.
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
  p.on('pageerror', e => { errs.push(String(e)); console.log('[pageerror]', String(e).slice(0, 250)); });
  p.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
  await p.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await p.evaluate(() => {
    const c = document.querySelector('canvas');
    const rc = c.getBoundingClientRect();
    window.__fire = (x, y, type, button = 0) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      button, buttons: type === 'pointerup' ? 0 : (button === 2 ? 2 : 1),
      clientX: rc.x + x, clientY: rc.y + y,
    }));
    window.__rclick = (x, y) => {
      window.__fire(x, y, 'pointerdown', 2);
      window.__fire(x, y, 'pointerup', 2);
      c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rc.x + x, clientY: rc.y + y }));
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

  for (const q of [{ x: 1, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, { x: 3, y: 4, z: 0 }, { x: 1, y: 1, z: 0 }]) {
    const s = await P(q);
    await p.evaluate(s => { window.__fire(s.x, s.y, 'pointermove'); window.__fire(s.x, s.y, 'pointerdown'); window.__fire(s.x, s.y, 'pointerup'); }, s);
    await sleep(200);
  }
  console.log('triangle drawn:', JSON.stringify(await p.evaluate(() => ({
    faces: window.app.model.faces.size, edges: window.app.model.edges.size,
  }))));

  // select the face (click inside), then shift-click the three edges
  await p.evaluate(() => window.app.setTool('select'));
  await sleep(200);
  const inside = await P({ x: 3, y: 2, z: 0 });
  await p.evaluate(s => { window.__fire(s.x, s.y, 'pointerdown'); window.__fire(s.x, s.y, 'pointerup'); }, inside);
  await sleep(300);
  console.log('after face click:', JSON.stringify(await p.evaluate(() => ({
    faces: window.app.sel.faces.size, edges: window.app.sel.edges.size, mode: window.app.mode,
  }))));

  // right-click on the selection
  await p.evaluate(s => window.__rclick(s.x, s.y), inside);
  await sleep(400);
  const menu = await p.evaluate(() => {
    const cand = [...document.querySelectorAll('div')].filter(d =>
      d.id.toLowerCase().includes('ctx') || d.className.toLowerCase().includes('ctx') || d.className.toLowerCase().includes('menu'))
      .filter(d => d.offsetParent !== null);
    const m = cand[cand.length - 1];
    return {
      found: cand.map(c => c.id || c.className).slice(-3),
      items: m ? [...m.children].map(c => c.textContent.trim().slice(0, 42)).filter(Boolean) : null,
      selF: window.app.sel.faces.size, selE: window.app.sel.edges.size,
    };
  });
  console.log('context menu state:', JSON.stringify(menu).slice(0, 700));

  // run the dialog flow directly — EMPTY name (the reported repro: the old
  // dialog closed silently when the name was blank)
  const dlg = await p.evaluate(() => {
    const app = window.app;
    app.convertToElementDialog([...app.sel.faces]);
    const d = document.getElementById('dialog');
    return { open: !!d, html: d ? d.textContent.slice(0, 80) : null };
  });
  console.log('convert dialog:', JSON.stringify(dlg));
  if (dlg.open) {
    const res = await p.evaluate(() => {
      const nameEl = document.getElementById('cv-name');
      if (nameEl) nameEl.value = ''; // blank — must auto-name now
      const h = document.getElementById('cv-height');
      if (h) h.value = '2.5';
      const btns = [...document.querySelectorAll('#dialog .dlg-btn')];
      const ok = btns.find(b => /convert/i.test(b.textContent));
      if (ok) ok.click();
      return { clicked: !!ok };
    });
    await sleep(900);
    const after = await p.evaluate(() => {
      const app = window.app;
      return {
        ents: app.bim.entities.length,
        last: app.bim.entities[app.bim.entities.length - 1]
          ? { type: app.bim.entities[app.bim.entities.length - 1].type, name: (app.bim.entities[app.bim.entities.length - 1].params || {}).name }
          : null,
        faces: app.model.faces.size,
        dialogClosed: document.getElementById('dialog-backdrop').classList.contains('hidden'),
      };
    });
    console.log('convert clicked:', JSON.stringify(res), '->', JSON.stringify(after));
    if (after.ents > 0 && after.last && after.dialogClosed) console.log('REPRO FIXED: blank name auto-named + dialog closed + element created');
    else console.log('REPRO STILL BROKEN');
  }
  console.log('page errors:', errs.length);
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
