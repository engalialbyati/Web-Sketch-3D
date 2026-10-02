'use strict';
// DockPanels — the shared palette chrome engine (ui-dock.js). The pure
// geometry/state helpers are headless; the DOM side is exercised in the
// browser. Also pins the script's loadability alongside the panels.
module.exports = h => {
  const { loadModel, test, ok, eq } = h;
  const L = loadModel(['js/ui-dock.js']);
  const DK = L.window.DockPanels;
  // the vm sandbox has no localStorage — a minimal store stands in
  const store = {};
  L.sandbox.localStorage = {
    setItem: (k, v) => { store[k] = String(v); },
    getItem: k => (k in store ? store[k] : null),
  };

  test('edgeFor: drop zones at the viewport borders', () => {
    ok(DK, 'engine exports');
    eq(DK.edgeFor(10, 0, 1000), 'left', 'inside the left band');
    eq(DK.edgeFor(990, 0, 1000), 'right', 'inside the right band');
    eq(DK.edgeFor(500, 0, 1000), 'float', 'mid-screen stays floating');
    eq(DK.edgeFor(0, 0, 1000), 'left', 'the very edge');
    eq(DK.edgeFor(150, 0, 1000, 200), 'left', 'custom band width: left');
    eq(DK.edgeFor(900, 0, 1000, 200), 'right', 'custom band width: right');
    eq(DK.edgeFor(10, 0, 12), 'left', 'narrow viewport: left wins');
  });

  test('clampXY: floating panels always stay reachable', () => {
    let c = DK.clampXY(500, 400, 1000, 800);
    eq(c.x, 500, 'untouched inside');
    c = DK.clampXY(-9999, 400, 1000, 800);
    ok(c.x >= -40, 'never dragged fully off-screen: ' + c.x);
    c = DK.clampXY(9999, 400, 1000, 800);
    ok(c.x <= 1000 - 60 + 1, 'at least a grip stays visible: ' + c.x);
    c = DK.clampXY(500, -9999, 1000, 800);
    eq(c.y, 0, 'top clamp');
    c = DK.clampXY(500, 9999, 1000, 800);
    ok(c.y <= 800 - 36 + 1, 'bottom keeps the header visible');
    c = DK.clampXY(500, 400, 10, 10); // degenerate tiny viewport
    ok(c.x <= 10 && c.y <= 10 && c.x >= -40 && c.y >= 0, 'degenerate viewport still sane');
  });

  test('layout persistence round-trips through the store', () => {
    const all = { elbrowser: { visible: true, dock: 'right', x: 40, y: 60, collapsed: false } };
    DK.saveLayout(all);
    const back = DK.loadLayout();
    ok(back.elbrowser && back.elbrowser.dock === 'right', 'layout stored per panel key');
    ok(DK.get('nope') === null, 'unknown keys resolve null');
  });
};
