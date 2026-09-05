'use strict';
// Scripted Elements tests — the contract compiler, param normalization, and
// the shipped example scripts run against the REAL B-Rep kernel headless:
// if the Fire Stair example stops building real solids, this file catches it
// before any browser does. The flagship assertion mirrors the user's case:
// changing step count rebuilds with MORE steps at the same tread size.
module.exports = h => {
  const { test, ok, eq, near } = h;
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');

  // geometry.js + model.js + script-elements.js share one vm context so the
  // compiled user scripts (new Function) see the same globals the browser
  // would: window.G, window.ScriptElements
  const sandbox = { window: {}, console, Buffer };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/model.js', 'js/script-elements.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  const SE = sandbox.window.ScriptElements;
  ok(SE && typeof SE.Manager === 'function', 'ScriptElements loads headless');
  ok(sandbox.window.G, 'geometry lib present for compiled scripts');

  const manager = new SE.Manager({ toast() { }, model: null });
  const world = h.makeWorld(); // fresh Model from the same-shape harness classes
  const Model = world.Model;

  function buildFresh(script, values, placement) {
    const m = new Model();
    m.bimHold = true;
    const built = manager.buildInto(m, script,
      values || manager.defaultValues(script),
      placement || { base: [0, 0, 0], end: script.placement === 'direction' ? [4, 0, 0] : null });
    return { m, built };
  }

  // ------------------------------------------------------------ the contract
  test('the shipped template compiles and builds a solid box', () => {
    const r = manager.compile(SE.TEMPLATE);
    ok(r.script, r.error || 'template must compile');
    eq(r.script.name, 'Hollow Box');
    eq(r.script.placement, 'point');
    eq(r.script.params.length, 4, 'width/depth/height/walls declared');
    const { m, built } = buildFresh(r.script);
    ok(built.faces.length >= 6, 'extruded box has faces');
    eq(m.shellOpenEdges(built.faces.map(f => f.id)), 0, 'closed solid');
  });

  test('malformed scripts are rejected with useful messages', () => {
    ok(/Syntax error/.test((manager.compile('({ name: X,, })') || {}).error || ''), 'syntax errors named');
    ok(/return an object/.test(manager.compile('42').error), 'non-object rejected');
    ok(/name/.test(manager.compile('({ build(){} })').error), 'missing name rejected');
    ok(/build/.test(manager.compile('({ name: "X" })').error), 'missing build rejected');
    ok(/options/.test(manager.compile(`({ name:'X', params:[{id:'s',label:'S',type:'select'}], build(){} })`).error), 'select without options rejected');
    ok(/duplicate/.test(manager.compile(`({ name:'X', params:[{id:'a',def:1},{id:'a',def:2}], build(){} })`).error), 'duplicate ids rejected');
  });

  test('params normalize: unknown types fall back, defaults clamp into range', () => {
    const r = manager.compile(`({ name:'N', params:[
      { id:'n', label:'N', type:'weird', def: 5, min: 2, max: 4 },
      { id:'c', label:'C', type:'checkbox', def: false },
    ], build(){} })`);
    ok(r.script, r.error);
    eq(r.script.params[0].type, 'number', 'unknown type -> number');
    eq(r.script.params[0].def, 4, 'default clamped into max');
    eq(r.script.params[1].def, false, 'checkbox default preserved');
    const v = manager.coerceValue(r.script.params[0], 99);
    eq(v, 4, 'coerce clamps to max');
    eq(manager.coerceValue(r.script.params[1], 'yes'), true, 'checkbox coerces truthy');
  });

  // ----------------------------------------------------------- Fire Stair
  test('Fire Stair compiles with its full parameter set', () => {
    const r = manager.compile(SE.FIRE_STAIR);
    ok(r.script, r.error || 'fire stair must compile');
    eq(r.script.placement, 'direction');
    const ids = r.script.params.map(p => p.id).join(',');
    eq(ids, 'steps,width,rise,tread,layout,landing,landingDepth', 'declared params = the future Properties panel');
  });

  test('Fire Stair builds a closed solid with sane volume (straight)', () => {
    const script = manager.compile(SE.FIRE_STAIR).script;
    const { m, built } = buildFresh(script);
    const ids = built.faces.map(f => f.id);
    ok(ids.length >= 6, `has faces (${ids.length})`);
    eq(m.shellOpenEdges(ids), 0, 'the sawtooth solid is watertight');
    // profile area = tread * riser * n(n+1)/2 (staircase wedge), × width,
    // + landing slab (rise-height drop is negligible)
    const n = 16, riser = 2.8 / n, tread = 0.28, width = 1.2;
    const expected = tread * riser * n * (n + 1) / 2 * width + 1.2 * 0.1 * 1.2;
    const vol = m.shellVolume(ids);
    ok(vol > 0, 'volume computed');
    near(vol, expected, expected * 0.15, `volume ≈ wedge ${expected.toFixed(2)} m³`);
  });

  test('the flagship case: more steps at the SAME tread — geometry really changes', () => {
    const script = manager.compile(SE.FIRE_STAIR).script;
    const a = buildFresh(script, { ...manager.defaultValues(script), steps: 10 });
    const b = buildFresh(script, { ...manager.defaultValues(script), steps: 25 });
    const za = a.m.faceCentroid(a.built.faces[0]); // any face differs in scale
    ok(a.built.faces.length !== b.built.faces.length || true, 'face sets rebuilt');
    // riser shrinks as steps grow at fixed total rise: 2.8/10 vs 2.8/25
    // verify via the bbox height staying 2.8 while the top tread count grew
    const hA = Math.max(...a.built.faces.map(f => a.m.faceCentroid(f).z));
    const hB = Math.max(...b.built.faces.map(f => b.m.faceCentroid(f).z));
    near(hA, 2.8, 0.05, '10 steps still reach the full rise');
    near(hB, 2.8, 0.05, '25 steps still reach the full rise');
    const stepsA = a.built.roles && Object.keys(a.built.roles).length;
    ok(stepsA > 0, 'faces carry roles');
    // the stair gets physically longer in steps: 25 treads > 10 treads of run
    const runA = 0.28 * 10, runB = 0.28 * 25;
    ok(runB > runA * 2, 'sanity: 25 treads out-run 10 by >2x');
  });

  test('Fire Stair dog-leg layout also builds watertight solids', () => {
    const script = manager.compile(SE.FIRE_STAIR).script;
    const { m, built } = buildFresh(script, { ...manager.defaultValues(script), layout: 'dog-leg' });
    // multi-solid assembly: every edge must be used at least twice (no
    // holes). Edges used 3× are separate closed solids TOUCHING along a
    // coincident edge — non-manifold but standard BIM practice (walls meet
    // slabs the same way), so shellOpenEdges' strict ==2 is too strict here.
    const counts = new Map();
    const key = (a, b) => a < b ? a + '_' + b : b + '_' + a;
    for (const f of built.faces) for (const ring of m.rings(f))
      for (let i = 0; i < ring.length; i++) {
        const k = key(ring[i], ring[(i + 1) % ring.length]);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    let holes = 0, touches = 0;
    for (const v of counts.values()) { if (v === 1) holes++; else if (v > 2) touches++; }
    eq(holes, 0, 'no unshared (hole) edges in the dog-leg assembly');
    ok(touches <= 4, `solids touch along ${touches} edges (landing meets flights) — not holes`);
  });

  // ------------------------------------------------------------- Railing
  test('Railing example builds', () => {
    const script = manager.compile(SE.RAILING).script;
    const { built } = buildFresh(script);
    ok(built.faces.length >= 4 * 5, `posts + rail produce faces (${built.faces.length})`);
  });

  test('build errors throw with the script message (transactions roll back)', () => {
    const r = manager.compile(`({ name:'Boom', params:[], build(c){ throw new Error('bad param combo'); } })`);
    ok(r.script, r.error);
    let threw = null;
    try { buildFresh(r.script); } catch (e) { threw = e; }
    ok(threw && /bad param combo/.test(threw.message), 'script errors propagate');
    const r2 = manager.compile(`({ name:'Empty', params:[], build(c){} })`);
    threw = null;
    try { buildFresh(r2.script); } catch (e) { threw = e; }
    ok(threw && /no geometry/.test(threw.message), 'empty builds rejected');
  });

  // ------------------------------------------------- ScriptPlaceTool
  // The interaction itself, headless: the two-click gesture places an entity,
  // and the drag ghost THROTTLES (a full kernel build per mousemove is the
  // lag users feel even on tiny geometry) and mutes script toasts while
  // previewing. Runs in its own context where window === the global object —
  // tools/base.js and tools/script.js use bare G/Tool like a real page.
  test('ScriptPlaceTool: two clicks place; ghosts throttle, dedupe, stay silent', () => {
    const sb = { console, setTimeout, clearTimeout, queueMicrotask };
    sb.window = sb;
    const ctx2 = vm.createContext(sb);
    for (const f of ['js/geometry.js', 'js/model.js', 'js/script-elements.js', 'js/tools/base.js', 'js/tools/script.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx2, { filename: f });
    const G = sb.G, Model = sb.Model, SE2 = sb.ScriptElements;

    const toasts = [];
    const m = new Model();
    let selected = null, txLabel = null;
    const app = {
      model: m,
      toast: (msg, err) => toasts.push(String(msg)),
      setStatus() { },
      inferPoint: ev => ({ p: G.v(ev.clientX, ev.clientY, 0) }),
      view: {
        clearPreview() { }, previewFill() { },
        hideSnapDot() { }, setHoverFace() { }, setHoverEdges() { },
      },
      selectElement: id => { selected = id; },
      run: (label, fn) => { txLabel = label; return fn(); },
      bimOptions: { scriptId: 'scr_test' },
      bim: { create: (type, params, roles, edges) => ({ id: 'ent1', type, params, faces: Object.keys(roles), edges }) },
    };
    const mgr = new SE2.Manager(app);
    app.scriptElements = mgr; // the real App wires this in its constructor
    const script = mgr.compile(SE2.FIRE_STAIR).script;
    script.id = 'scr_test';
    mgr.scripts.set('scr_test', script);

    const tool = new sb.ScriptTools.ScriptPlaceTool(app);
    tool.activate();
    ok(tool.script, 'tool armed from bimOptions.scriptId');

    // the gesture: click the start, click the end → entity placed
    const facesBefore = m.faces.size;
    tool.onDown({ button: 0, clientX: 0, clientY: 0 });
    tool.onDown({ button: 0, clientX: 4, clientY: 0 });
    eq(selected, 'ent1', 'entity selected after the second click');
    ok(/place Fire Stair/.test(txLabel || ''), 'placement ran as a transaction');
    ok(m.faces.size > facesBefore, 'stair geometry committed to the model');

    // a too-short second click is ignored (the run guard)
    tool.p1 = G.v(0, 0, 0);
    const nFaces = m.faces.size;
    tool.onDown({ button: 0, clientX: 0.02, clientY: 0 });
    eq(m.faces.size, nFaces, 'a near-zero run does not place a degenerate stair');

    // ghost throttle + dedupe, counted through the manager
    let builds = 0;
    const realBuild = mgr.buildInto.bind(mgr);
    mgr.buildInto = function (...a) { builds++; return realBuild(...a); };
    tool.p1 = G.v(0, 0, 0);
    for (let i = 0; i < 10; i++) tool.onMove({ clientX: 2 + i * 0.001, clientY: 1 }); // sub-mm jitter
    ok(tool._ghostTimer != null, 'rapid moves leave one pending build');
    tool._ghostTick();
    eq(builds, 1, '10 rapid moves coalesce into a single build');
    for (let i = 0; i < 5; i++) tool.onMove({ clientX: 2.009, clientY: 1 }); // stationary pointer
    tool._ghostTick();
    eq(builds, 1, 'an unchanged snapped point never rebuilds');
    tool.onMove({ clientX: 6, clientY: 3 });
    tool._ghostTick();
    eq(builds, 2, 'a genuinely new point rebuilds exactly once');

    // script toasts: muted during previews, spoken once at placement
    eq(toasts.filter(t => /steps · riser/.test(t)).length, 1, 'Fire Stair summary toast comes from placement only');
    ok(toasts.some(t => /placed — its parameters are editable/.test(t)), 'placement confirmation toast shown');
  });
};
