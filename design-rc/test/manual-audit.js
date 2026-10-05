'use strict';
// manual-audit.js — full-app audit: every feature added across all phases
// must be VISIBLE (toolbar buttons, menu entries, palette chips, panels).
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const results = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass++; results.push(`  ok   ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; results.push(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu-sandbox'],
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 1500, height: 900 });
  const errs = [];
  p.on('pageerror', e => { errs.push(String(e)); });
  await p.goto('http://127.0.0.1:8642/', { waitUntil: 'domcontentloaded' });
  await sleep(3500);

  // ---------- 1. ribbon tabs ----------
  const tabs = await p.evaluate(() => ({
    labels: [...document.querySelectorAll('#modetabs .mtab')].map(b => b.textContent),
    visible: document.querySelector('#modetabs').style.display !== 'none',
  }));
  check('Ribbon tab row (Draw/Model/Insert/Annotate/View/Manage)', tabs.visible &&
    tabs.labels.join(',').toLowerCase() === 'draw,model,insert,annotate,view,manage', tabs.labels.join('/'));

  // ---------- 2. per-tab toolbar buttons ----------
  const buttonAudit = await p.evaluate(() => {
    const out = {};
    const audit = tabName => {
      const app = window.app;
      app.setRibbonTab(tabName);
      return [...document.querySelectorAll('#toolbar .tbtn[data-tool]')].map(b => ({
        tool: b.dataset.tool,
        hasIcon: !!(b.querySelector('svg') || (b.innerHTML.includes('<svg'))),
        title: b.title || '',
      }));
    };
    for (const t of ['draw', 'model', 'insert', 'annotate', 'view', 'manage']) out[t] = audit(t);
    window.app.setRibbonTab('draw');
    return out;
  });
  await sleep(300);
  const expect = {
    draw: ['line', 'rect', 'circle', 'arc', 'polygon', 'draw', 'wall', 'floor', 'room', 'convert', 'move', 'rotate', 'scale', 'mirror', 'array', 'trim', 'offset', 'resize'],
    model: ['pushpull', 'extrude', 'revolve', 'followme', 'move', 'rotate', 'scale', 'mirror', 'array', 'paint', 'eraser'],
    insert: ['column', 'beam', 'foundation', 'roof', 'stripfoot', 'brace', 'plate', 'stairs', 'handrail', 'ramp', 'ceiling', 'curtain', 'sweep', 'door', 'window', 'opening', 'gridplace'],
    annotate: ['dim', 'dimang', 'dimrad', 'tag', 'text', 'spot', 'cloud', 'region', 'section', 'elevmark', 'tape', 'measurearea'],
    view: ['orbit', 'pan'],
    manage: [],
  };
  for (const [tab, tools] of Object.entries(expect)) {
    const present = buttonAudit[tab].map(b => b.tool);
    for (const t of tools) {
      check(`[${tab}] ${t} button`, present.includes(t));
    }
    const noIcon = buttonAudit[tab].filter(b => !b.hasIcon);
    check(`[${tab}] all buttons have icons`, noIcon.length === 0,
      noIcon.length ? noIcon.map(b => b.tool).join(',') : `${buttonAudit[tab].length} buttons`);
  }

  // ---------- 3. menu entries ----------
  const menus = await p.evaluate(() => {
    // open each menu by simulating the menubar click flow: the menu XML lives
    // in app code — probe the action names registered instead
    const out = {};
    const A = window.app;
    const probe = name => {
      try { return typeof A[name] === 'function' || typeof A.action === 'function'; } catch (e) { return false; }
    };
    out.georefDialog = typeof A.georefDialog === 'function';
    out.tagAllUntagged = typeof A.tagAllUntagged === 'function';
    out.findReplaceNotes = typeof A.findReplaceNotes === 'function';
    out.viewsDialog = typeof A.viewsDialog === 'function';
    out.exportIfc = typeof A.exportIfc === 'function';
    out.printSheet = typeof window.Annotate2 !== 'undefined' && typeof window.Annotate2.printSheet === 'function';
    out.toggleAnalytical = typeof A.toggleAnalytical === 'function';
    out.exportAnalyticalCsv = typeof A.exportAnalyticalCsv === 'function';
    out.trussDialog = typeof window.Struct2 !== 'undefined';
    out.propertyDialog = typeof A.propertyDialog === 'function';
    out.rebuildFromParams = typeof A.rebuildFromParams === 'function';
    // feature modules loaded
    out.modules = {
      Annotate: !!window.Annotate, Annotate2: !!window.Annotate2,
      Arch2: !!window.Arch2, Struct2: !!window.Struct2,
      RoomFeature: !!window.RoomFeature, IfcExport: !!window.IfcExport,
      IfcElements: !!window.IfcElements, IfcImport: !!window.IfcImport,
    };
    // tool classes registered
    const T = window.TOOLS || {};
    out.tools = {
      ramp: !!T.ramp, ceiling: !!T.ceiling, curtain: !!T.curtain, sweep: !!T.sweep,
      stripfoot: !!T.stripfoot, brace: !!T.brace, plate: !!T.plate,
      dim: !!T.dim, dimang: !!T.dimang, dimrad: !!T.dimrad, tag: !!T.tag,
      text: !!T.text, spot: !!T.spot, cloud: !!T.cloud, region: !!T.region,
      section: !!T.section, elevmark: !!T.elevmark,
      mirror: !!T.mirror, array: !!T.array, revolve: !!T.revolve, followme: !!T.followme,
      // room registers via the Engine feature system, not the flat TOOLS map
      room: !!(window.app.tools && window.app.tools.room),
    };
    return out;
  });
  for (const [k, v] of Object.entries(menus)) {
    if (k === 'modules' || k === 'tools') continue;
    check(`method: ${k}`, v === true);
  }
  for (const [k, v] of Object.entries(menus.modules)) check(`module: ${k}`, v === true);
  for (const [k, v] of Object.entries(menus.tools)) check(`tool class: ${k}`, v === true);

  // ---------- 4. draw palette chips ----------
  const palette = await p.evaluate(() => {
    const app = window.app;
    app.setMode('bim');
    app.setRibbonTab('draw');
    app.setTool('draw');
    return [...document.querySelectorAll('#drawpalette .dchip')].map(b => b.dataset.prim).filter(Boolean);
  });
  await sleep(300);
  for (const chip of ['line', 'rect', 'polygon', 'circle', 'ellipse', 'arc_ser', 'arc_ce', 'fillet', 'pick']) {
    check(`draw palette chip: ${chip}`, palette.includes(chip));
  }

  // ---------- 5. layer panel columns ----------
  const layers = await p.evaluate(() => {
    if (window.LayerPanel) LayerPanel.toggle(true);
    return {
      lt: !!document.querySelector('#layerpanel .lay-lt'),
      lw: !!document.querySelector('#layerpanel .lay-lw'),
    };
  });
  check('Layer panel: Linetype column', layers.lt);
  check('Layer panel: Lineweight column', layers.lw);

  // ---------- 6. line properties panel ----------
  const lineProps = await p.evaluate(() => {
    const app = window.app;
    app.setTool('line');
    const c = document.querySelector('canvas');
    const rc = c.getBoundingClientRect();
    const fire = (x, y, t) => c.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: rc.x + x, clientY: rc.y + y,
    }));
    fire(400, 400, 'pointerdown'); fire(400, 400, 'pointerup');
    fire(550, 400, 'pointermove');
    fire(550, 400, 'pointerdown'); fire(550, 400, 'pointerup');
    app.setTool('select');
    const id = [...app.model.edges.keys()][app.model.edges.size - 1];
    app.sel = { edges: new Set([id]), faces: new Set() };
    app.onSelectionChanged();
    return {
      layer: !!document.querySelector('#pi-layer'),
      lt: !!document.querySelector('#pi-lt'),
      lw: !!document.querySelector('#pi-lw'),
      thk: !!document.querySelector('#pi-thk'),
      geo: /Delta X/.test(document.getElementById('entityinfo').textContent),
    };
  });
  await sleep(400);
  check('Line inspector: Layer dropdown', lineProps.layer);
  check('Line inspector: Linetype dropdown', lineProps.lt);
  check('Line inspector: Lineweight dropdown', lineProps.lw);
  check('Line inspector: Thickness field', lineProps.thk);
  check('Line inspector: Geometry block', lineProps.geo);

  // ---------- 7. polar guides (dynamic input) ----------
  const dyn = await p.evaluate(() => {
    const app = window.app;
    app.setMode('free');
    app.setTool('line');
    const c = document.querySelector('canvas');
    const rc = c.getBoundingClientRect();
    const fire = (x, y, t) => c.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: rc.x + x, clientY: rc.y + y,
    }));
    fire(300, 500, 'pointerdown'); fire(300, 500, 'pointerup');
    fire(450, 420, 'pointermove');
    const labels = app.view.hudSticky.map(l => l.text);
    return {
      len: labels.some(t => /m/.test(t)),
      ang: labels.some(t => /°/.test(t)),
      dashed: app.view.previewGroup.children.filter(ch => ch.material && ch.material.isLineDashedMaterial).length,
    };
  });
  check('Dynamic input: live length label', dyn.len);
  check('Dynamic input: live angle label', dyn.ang);
  check('Dynamic input: dashed polar guides', dyn.dashed >= 2, `${dyn.dashed} dashed lines`);

  // ---------- 8. page errors ----------
  check('no page errors during audit', errs.length === 0,
    errs.length ? errs[0].slice(0, 120) : '');

  console.log(results.join('\n'));
  console.log(`\nAUDIT: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
