'use strict';
// ---------------------------------------------------------------------------
// manual-stackdump.js — reproduce the wall-commit freeze in headless Edge and
// capture the hung JS stack via CDP Debugger.pause.
// Run: node test/manual-stackdump.js
// ---------------------------------------------------------------------------
const puppeteer = require('puppeteer-core');

const EDGE = process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('console', m => console.log('[page]', m.type(), m.text().slice(0, 200)));
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

  console.log('[1] loading app + grid building...');
  await page.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  await page.evaluate(() => {
    const app = window.app || window.A;
    app.action('demor5');
    const btns = document.querySelectorAll('#dialog .dlg-btn');
    if (btns.length >= 2) btns[1].click(); // OK
  });
  // wait for the build to finish
  await page.waitForFunction(() => {
    const app = window.app || window.A;
    return app.bim.entities.length >= 318;
  }, { timeout: 120000, polling: 1000 });
  console.log('[1] building loaded:', await page.evaluate(() => (window.app || window.A).bim.entities.length));

  // enable the Debugger domain so we can pause the hung main thread
  const client = await page.createCDPSession();
  await client.send('Debugger.enable');

  // arm the wall tool and replay the exact repro events
  console.log('[2] arming wall tool, dispatching the two clicks...');
  await page.evaluate(() => {
    const app = window.app || window.A;
    app.action('toolWall') /* may not exist */ ;
  }).catch(() => { });
  const tool = await page.evaluate(() => {
    const app = window.app || window.A;
    // the app maps the L key; emulate a real keypress on the canvas
    const c = document.querySelector('canvas');
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    return app.tool.id || app.tool.constructor.name;
  });
  console.log('[2] tool =', tool);

  const fire = (x, y, type) => window.__fire(x, y, type);
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const rc = c.getBoundingClientRect();
    window.__fire = (x, y, type) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: rc.x + x, clientY: rc.y + y,
    }));
    window.__fire(180, 500, 'pointerdown');
    window.__fire(180, 500, 'pointerup');
    window.__fire(260, 500, 'pointermove');
  });
  const stage = await page.evaluate(() => {
    const t = (window.app || window.A).tool;
    return JSON.stringify({ stage: t.engine.stage, p1: t.engine.p1, cur: t.engine.cur });
  });
  console.log('[2] first point down:', stage);

  // capture the snapped second point (a move to the commit position) BEFORE committing
  const second = await page.evaluate(() => {
    window.__fire(300, 500, 'pointermove');
    const t = (window.app || window.A).tool;
    return JSON.stringify({ cur: t.engine.cur, stage: t.engine.stage });
  });
  console.log('[2] snapped second point:', second);

  // commit — if the main thread hangs, this evaluate never resolves
  console.log('[3] committing the wall (second click)...');
  const hangPromise = page.evaluate(() => {
    window.__fire(300, 500, 'pointerdown');
    window.__fire(300, 500, 'pointerup');
    return 'commit-returned';
  });

  const winner = await Promise.race([hangPromise, sleep(10000).then(() => 'HUNG')]);
  console.log('[3]', winner);

  if (winner === 'HUNG') {
    console.log('[4] pausing the main thread for stack traces...');
    const samples = [];
    client.on('Debugger.paused', ev => {
      samples.push(ev.callFrames.map(f =>
        `${f.functionName || '(anon)'} @ ${(f.url || '').split('/').pop()}:${f.location.lineNumber + 1}`));
    });
    for (let i = 0; i < 3; i++) {
      await client.send('Debugger.pause').catch(() => { });
      await sleep(500);   // paused event lands with the frames
      await client.send('Debugger.resume').catch(() => { });
      await sleep(800);   // spin a bit so the next pause samples elsewhere
    }
    for (let i = 0; i < samples.length; i++) {
      console.log(`\n===== stack sample ${i} (innermost first) =====`);
      for (const f of samples[i].slice(0, 25)) console.log('   ', f);
    }
  }
  await browser.close();
  process.exit(winner === 'HUNG' ? 2 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
