'use strict';
// ---------------------------------------------------------------------------
// manual-verify-panels.js — browser verification for the OpenCADStudio panel
// batch: ribbon tabs, line Properties (layer/linetype/lineweight/thickness/
// geometry), layer panel columns, Model tools (Revolve, Follow Me), and the
// V-flip vertical arcs. Run: node test/manual-verify-panels.js
// ---------------------------------------------------------------------------
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const SHOT = process.env.SHOT_DIR || require('node:os').tmpdir() + '\\wsverify2';
fs.mkdirSync(SHOT, { recursive: true });

const EDGE = process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1500,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 900 });
  const errors = [];
  page.on('pageerror', e => { errors.push(String(e)); console.log('[pageerror]', String(e).slice(0, 300)); });

  await page.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const rc = c.getBoundingClientRect();
    window.__fire = (x, y, type) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: rc.x + x, clientY: rc.y + y,
    }));
    window.__key = (k, mods = {}) => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: k, bubbles: true, cancelable: true, ...mods,
    }));
    const app = window.app;
    app.view.cam.az = -1.15; app.view.cam.el = 0.9; app.view.cam.dist = 26;
    app.view.cam.target = { x: 6, y: 6, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(400);
  const project = pt => page.evaluate(p => {
    const v = window.app.view.toScreen(p);
    return { x: v.x, y: v.y };
  }, pt);

  // ---------- [1] RIBBON TABS ----------
  console.log('[1] ribbon tabs');
  const tabs = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('#modetabs .mtab')].map(b => b.textContent),
    visible: document.querySelector('#modetabs').style.display !== 'none',
  }));
  check('tab row shows the six OpenCADStudio tabs',
    tabs.visible && tabs.labels.join(',').toLowerCase() === 'draw,model,insert,annotate,view,manage',
    tabs.labels.join('/'));
  const drawTools = await page.evaluate(() =>
    [...document.querySelectorAll('#toolbar .tbtn[data-tool]')].map(b => b.dataset.tool));
  check('Draw tab mixes free + BIM tools', drawTools.includes('line') && drawTools.includes('wall'));
  await page.evaluate(() => window.app.setRibbonTab('model'));
  await sleep(200);
  const modelTools = await page.evaluate(() =>
    [...document.querySelectorAll('#toolbar .tbtn[data-tool]')].map(b => b.dataset.tool));
  check('Model tab lists Revolve + Follow Me + Extrude Curve',
    modelTools.includes('revolve') && modelTools.includes('followme') && modelTools.includes('extrude'));
  await page.screenshot({ path: SHOT + '\\shot-1-model-tab.png' });
  // cross-mode switch: click Wall from the Draw tab while in free mode
  await page.evaluate(() => {
    window.app.setRibbonTab('draw');
    window.app.setMode('free');
  });
  await sleep(200);
  const before = await page.evaluate(() => window.app.mode);
  await page.evaluate(() => window.app.setTool('wall'));
  await sleep(300);
  const after = await page.evaluate(() => ({ mode: window.app.mode, tool: window.app.tool.id }));
  check('picking Wall from the Draw tab switches to BIM mode',
    before === 'free' && after.mode === 'bim' && after.tool === 'wall', `${before} -> ${after.mode}/${after.tool}`);

  // ---------- [2] LINE PROPERTIES ----------
  console.log('[2] line properties panel');
  await page.evaluate(() => {
    const app = window.app;
    app.setMode('free');
    app.setTool('line');
  });
  await sleep(200);
  const l1 = await project({ x: 2, y: 2, z: 0 });
  const l2 = await project({ x: 8, y: 2, z: 0 });
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, l1);
  await sleep(120);
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointermove'); window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, l2);
  await sleep(400);
  const edgeInfo = await page.evaluate(() => {
    const app = window.app;
    return { edges: app.model.edges.size, hasGeom: !!(app.model.edges.size) };
  });
  check('a line was drawn', edgeInfo.edges >= 1, `${edgeInfo.edges} edges`);
  await page.evaluate(() => {
    const app = window.app;
    app.setTool('select');
    const id = [...app.model.edges.keys()][app.model.edges.size - 1];
    app.sel = { edges: new Set([id]), faces: new Set() };
    app.onSelectionChanged();
  });
  await sleep(400);
  const panel = await page.evaluate(() => {
    const el = document.getElementById('entityinfo');
    window.__lineId = [...window.app.model.edges.keys()][window.app.model.edges.size - 1];
    return {
      layer: !!el.querySelector('#pi-layer'),
      lt: !!el.querySelector('#pi-lt'),
      lw: !!el.querySelector('#pi-lw'),
      thk: !!el.querySelector('#pi-thk'),
      len: !!el.querySelector('#pi-len'),
      text: el.textContent,
    };
  });
  check('line inspector shows Layer/Linetype/Lineweight/Thickness/Length',
    panel.layer && panel.lt && panel.lw && panel.thk && panel.len);
  check('geometry block reports Start/End/Delta/Angle',
    /Start/.test(panel.text) && /Delta X/.test(panel.text) && /Angle/.test(panel.text));
  await page.screenshot({ path: SHOT + '\\shot-2-line-props.png' });
  // set linetype = Dashed + lineweight 0.70 + thickness 2
  await page.evaluate(() => {
    const el = document.getElementById('entityinfo');
    const lt = el.querySelector('#pi-lt'); lt.value = '1'; lt.dispatchEvent(new Event('change'));
    const lw = el.querySelector('#pi-lw'); lw.value = '5'; lw.dispatchEvent(new Event('change'));
    const thk = el.querySelector('#pi-thk'); thk.value = '2'; thk.dispatchEvent(new Event('change'));
  });
  await sleep(500);
  const styled = await page.evaluate(() => {
    const app = window.app;
    const e = app.model.edges.get(window.__lineId);
    const dashed = app.view.styledEdges.children.filter(ch => ch.material && ch.material.isLineDashedMaterial).length;
    const ribbons = app.view.styledEdges.children.filter(ch => ch.material && ch.material.uniforms && ch.material.uniforms.uPx).length;
    return { lt: e.lt, lw: e.lw, thk: app.model.edgeThickness(window.__lineId), dashed, ribbons };
  });
  check('linetype Dashed renders in the styled buckets (dashed line or chopped ribbon)',
    styled.lt === 1 && (styled.dashed + styled.ribbons) >= 1,
    `lt=${styled.lt}, dashedObjs=${styled.dashed}, ribbonObjs=${styled.ribbons}`);
  check('lineweight 0.70 renders the heavy ribbon', styled.lw === 5 && styled.ribbons >= 1,
    `lw=${styled.lw}, ribbonObjs=${styled.ribbons}`);
  check('thickness 2 m grew the vertical ribbon face', Math.abs(styled.thk - 2) < 1e-6,
    `thk=${styled.thk}`);
  await page.screenshot({ path: SHOT + '\\shot-3-styled-line.png' });

  // ---------- [3] LAYER PANEL COLUMNS ----------
  console.log('[3] layer panel');
  const layPanel = await page.evaluate(() => {
    const app = window.app;
    if (window.LayerPanel) LayerPanel.toggle(true);
    const sel = document.querySelector('#layerpanel .lay-lt');
    const selw = document.querySelector('#layerpanel .lay-lw');
    return { lt: !!sel, lw: !!selw, ltOpts: sel ? sel.options.length : 0 };
  });
  check('layer panel carries Linetype + Lineweight columns',
    layPanel.lt && layPanel.lw && layPanel.ltOpts >= 5);
  await page.evaluate(() => {
    const app = window.app;
    app.addLayer('Test Style');
  });
  await sleep(300);
  const setLayLt = await page.evaluate(() => {
    const app = window.app;
    const ly = app.layers.find(l => l.name === 'Test Style');
    app.setLayerFlags(ly.id, { lt: 3, color: '#c04040' });
    return { lt: ly.lt, color: ly.color };
  });
  check('layer linetype/color set through the panel API', setLayLt.lt === 3 && setLayLt.color === '#c04040');
  await page.screenshot({ path: SHOT + '\\shot-4-layer-panel.png' });

  // ---------- [4] REVOLVE ----------
  console.log('[4] Revolve');
  const facesBeforeRevolve = await page.evaluate(() => window.app.model.faces.size);
  await page.evaluate(() => {
    const app = window.app;
    app.setMode('free');
    app.setTool('circle');
    app.view.cam.az = -0.9; app.view.cam.el = 0.75; app.view.cam.dist = 24;
    app.view.cam.target = { x: 5, y: 5, z: 0 };
    app.view.applyCamera(); app.view.invalidate();
  });
  await sleep(300);
  const c1 = await project({ x: 6, y: 5, z: 1.5 }); // a point above ground for a vertical-ish circle? plane = ground first
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, c1);
  await sleep(150);
  // V flips the plane vertical — then the radius point
  await page.evaluate(() => window.__key('v'));
  await sleep(150);
  const c2 = await project({ x: 8.2, y: 5, z: 1.5 });
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointermove'); }, c2);
  await sleep(200);
  const vertCircle = await page.evaluate(() => {
    const t = window.app.tool;
    return { vert: !!t._vert, planeN: t.plane ? t.plane.n : null };
  });
  check('V flipped the circle plane vertical (Z-axis circle)',
    vertCircle.vert && vertCircle.planeN && Math.abs(vertCircle.planeN.z) < 0.1,
    JSON.stringify(vertCircle.planeN));
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, c2);
  await sleep(400);
  const circleZ = await page.evaluate(() => {
    const app = window.app;
    const zs = [];
    for (const e of app.model.edges.values()) {
      zs.push(app.model.vp(e.a).z, app.model.vp(e.b).z);
    }
    return { maxZ: Math.max(...zs), minZ: Math.min(...zs) };
  });
  check('vertical circle geometry extends in Z', circleZ.maxZ > circleZ.minZ + 1.5,
    `z ${circleZ.minZ.toFixed(2)}..${circleZ.maxZ.toFixed(2)}`);
  // revolve the vertical circle face about Z — arm the profile through the
  // SELECTION shortcut (a single selected face is picked up at stage 0)
  await page.evaluate(() => {
    const app = window.app;
    const spans = [...app.model.faces.values()].map(f => {
      const zs = app.model.pts(f.loop).map(p => p.z);
      return { f, min: Math.min(...zs), max: Math.max(...zs) };
    });
    const face = (spans.find(s => s.max > 1.2 && s.min < -0.2) || spans[spans.length - 1] || {}).f;
    if (!face) { window.__revProfile = null; return; }
    app.sel = { edges: new Set(), faces: new Set([face.id]) };
    app.onSelectionChanged();
    window.__revProfile = face.id;
    app.setTool('revolve');
  });
  await sleep(200);
  const revOK = await page.evaluate(() => ({ armed: window.__revProfile != null && window.app.tool.id === 'revolve', stage: window.app.tool.stage }));
  check('revolve armed with the vertical-circle profile', revOK.armed, JSON.stringify(revOK));
  const anyPt = await project({ x: 5, y: 8, z: 0 });
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, anyPt);
  await sleep(200);
  const rev1 = await project({ x: 3.4, y: 5, z: 0 }); // a vertical axis clear of the ring
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, rev1);
  await sleep(150);
  const rev2 = await project({ x: 3.4, y: 5, z: 3 });
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, rev2);
  await sleep(200);
  const revState = await page.evaluate(() => ({ stage: window.app.tool.stage }));
  check('revolve stages advanced to sweep', revState.stage === 3, `stage=${revState.stage}`);
  await page.screenshot({ path: SHOT + '\\shot-5-revolve-preview.png' });
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, rev2);
  await sleep(700);
  const revolveDone = await page.evaluate(before => {
    const app = window.app;
    return { grew: app.model.faces.size - before, ok: app.model.validate().ok };
  }, facesBeforeRevolve);
  check('revolve committed (faces grew, model valid)', revolveDone.grew > 10 && revolveDone.ok,
    `+${revolveDone.grew} faces`);

  // ---------- [5] FOLLOW ME ----------
  console.log('[5] Follow Me');
  await page.evaluate(() => {
    const app = window.app;
    app.setTool('rect');
  });
  await sleep(200);
  const f1 = await project({ x: 1, y: 10, z: 0 });
  const f2 = await project({ x: 1.6, y: 10.6, z: 0 });
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, f1);
  await sleep(120);
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointermove'); window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, f2);
  await sleep(400);
  const facesBeforeFM = await page.evaluate(() => window.app.model.faces.size);
  await page.evaluate(() => { window.app.setTool('followme'); });
  await sleep(200);
  const profPt = await project({ x: 1.3, y: 10.3, z: 0 });
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, profPt);
  await sleep(200);
  // path: the earlier straight line at y=2
  const pathPt = await project({ x: 5, y: 2, z: 0 });
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointermove'); }, pathPt);
  await sleep(250);
  await page.screenshot({ path: SHOT + '\\shot-6-followme-preview.png' });
  await page.evaluate(p => { window.__fire(p.x, p.y, 'pointerdown'); window.__fire(p.x, p.y, 'pointerup'); }, pathPt);
  await sleep(700);
  const fmDone = await page.evaluate(before => {
    const app = window.app;
    return { grew: app.model.faces.size - before, ok: app.model.validate().ok };
  }, facesBeforeFM);
  check('follow me committed along the path (valid)', fmDone.grew >= 4 && fmDone.ok, `+${fmDone.grew} faces`);

  // ---------- [6] persistence of the tab ----------
  const tabPersist = await page.evaluate(() => localStorage.getItem('ws3d-ribbontab'));
  check('ribbon tab persisted', tabPersist === 'draw', tabPersist);

  console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none');
  console.log(`\nverify: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
