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

  test('zoneFor: dropping ON a panel stack docks into it', () => {
    ok(DK.zoneFor, 'engine exports zoneFor');
    // the two stacks: left col covering x 0-290, right col x 1100-1400
    const cols = [
      { side: 'left',  x0: 0,    x1: 290,  y0: 90, y1: 900 },
      { side: 'right', x0: 1100, x1: 1400, y0: 90, y1: 900 },
    ];
    // mid-column drops dock — the wide left stack is a target, not its first 48px
    eq(DK.zoneFor(150, 400, cols, 0, 1100), 'left', 'middle of the LEFT stack docks left');
    eq(DK.zoneFor(1250, 400, cols, 0, 1100), 'right', 'middle of the RIGHT stack docks right');
    eq(DK.zoneFor(289, 899, cols, 0, 1100), 'left', 'inner edge of the stack counts');
    // outside the stacks vertically: falls back to the edge bands
    eq(DK.zoneFor(150, 40, cols, 0, 1100), 'float', 'above the stacks stays floating');
    eq(DK.zoneFor(150, 40, cols, 0, 1100, 200), 'left', 'fallback band still works (custom width)');
    // near a stack snaps to it even inside the fallback band
    eq(DK.zoneFor(1090, 400, cols, 0, 1100), 'right', 'just left of the right stack snaps right');
    eq(DK.zoneFor(600, 400, cols, 0, 1100), 'float', 'mid-canvas between the stacks stays floating');
    // no columns (boot edge case) degrades to edgeFor
    eq(DK.zoneFor(10, 400, null, 0, 1000), 'left', 'no columns: edge band left');
    eq(DK.zoneFor(500, 400, [], 0, 1000), 'float', 'no columns: mid floats');
  });
};
