'use strict';
// ---------------------------------------------------------------------------
// selectmode.test.js — PRECISE DRAWING SELECTION RULES:
//   "In Precise Drawing mode I can never select a face or an edge — only
//    elements. Faces and edges are selectable in Free Drawing. Measure Area
//    still picks faces (its own tool, untouched here). Edit In Place keeps
//    sub-element access while open."
// Drives the REAL SelectTool (js/tools/free.js) over a stubbed app surface;
// the pick result is injected so no canvas/view is needed.
// ---------------------------------------------------------------------------
module.exports = h => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { test, ok, eq } = h;

  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const sandbox = { window: {}, console, Set, Map };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/tools/free.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const { SelectTool } = sandbox.window.FreeTools;
  if (!SelectTool) throw new Error('SelectTool not loaded — check FreeTools exports');

  // a minimal world: the app surface SelectTool.onUp touches, with the pick
  // result injected per scenario
  const makeWorld = (mode, pick) => {
    const faceIds = [11, 12, 13];
    const m = {
      faces: new Map(faceIds.map(id => [id, { id, userData: { bimEntityId: 'wall_1' } }])),
    };
    m.faces.set(99, { id: 99, userData: null }); // an UNSTAMPED face
    const wall = { id: 'wall_1', type: 'wall', faces: [...faceIds] };
    const calls = { selected: [], cleared: 0, selSet: null };
    const app = {
      mode,
      _tabHeld: false,
      _eip: null,
      model: m,
      sel: { faces: new Set(), edges: new Set() },
      bandEl: { classList: { remove() { } } },
      bim: {
        getEntityForFace: f => (f.userData && f.userData.bimEntityId) ? wall : null,
        getEntityById: id => id === 'wall_1' ? wall : null,
      },
      pickEntity: () => pick,
      selectElement(id) { calls.selected.push(id); },
      toggleEntities() { },
      clearSelection() { calls.cleared++; },
      onSelectionChanged() { },
      setStatus() { },
    };
    Object.defineProperty(app, 'sel', {
      get() { return calls.selSet || { faces: new Set(), edges: new Set() }; },
      set(v) { calls.selSet = v; },
      configurable: true,
    });
    const tool = Object.create(SelectTool.prototype);
    tool.app = app;
    tool._bandStart = { x: 0, y: 0 }; // armed for the click branch
    tool._band = false;
    tool._mod = false;
    return { app, tool, calls };
  };
  const ev = { ctrlKey: false, shiftKey: false };
  const evCtrl = { ctrlKey: true, shiftKey: false };

  test('Precise Drawing: a click on a stamped face selects the ELEMENT', () => {
    const w = makeWorld('bim', { face: 11, edge: null, edges: [], group: null });
    w.tool.onUp(ev);
    eq(w.calls.selected.join(), 'wall_1', 'selectElement(wall_1) fired');
    eq(w.calls.cleared, 0, 'nothing cleared');
  });

  test('Precise Drawing: an UNSTAMPED face is empty space — never a raw face', () => {
    const w = makeWorld('bim', { face: 99, edge: null, edges: [], group: null });
    w.tool.onUp(ev);
    eq(w.calls.cleared, 1, 'cleared like empty space');
    ok(!w.calls.selSet || w.calls.selSet.faces.size === 0, 'no face in the selection');
  });

  test('Precise Drawing: an edge hit is empty space — never an edge selection', () => {
    const w = makeWorld('bim', { face: null, edge: 7, edges: [7], group: null });
    w.tool.onUp(ev);
    eq(w.calls.cleared, 1, 'cleared');
    ok(!w.calls.selSet || w.calls.selSet.edges.size === 0, 'no edge in the selection');
  });

  test('Precise Drawing: Ctrl (face query) is blocked too', () => {
    const w = makeWorld('bim', { face: 11, edge: null, edges: [], group: null });
    w.tool.onUp(evCtrl);
    eq(w.calls.cleared, 1, 'query treated as empty space');
    eq(w.calls.selected.length, 0, 'no element selection under Ctrl');
  });

  test('Precise Drawing: Edit In Place keeps raw face access', () => {
    const w = makeWorld('bim', { face: 99, edge: null, edges: [], group: null });
    w.app._eip = { ent: { id: 'x' } };
    w.tool.onUp(ev);
    ok(w.calls.selSet && w.calls.selSet.faces.has(99), 'EIP still selects the raw face');
    eq(w.calls.cleared, 0, 'not cleared');
  });

  test('Free Drawing: unstamped faces and edges still select (SketchUp behavior)', () => {
    const w = makeWorld('free', { face: 99, edge: null, edges: [], group: null });
    w.tool.onUp(ev);
    ok(w.calls.selSet && w.calls.selSet.faces.has(99), 'free mode selects the raw face');
    const w2 = makeWorld('free', { face: null, edge: 7, edges: [7], group: null });
    w2.tool.onUp(ev);
    ok(w2.calls.selSet && w2.calls.selSet.edges.has(7), 'free mode selects the raw edge');
  });
};
