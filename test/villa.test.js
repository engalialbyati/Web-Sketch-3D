'use strict';
// Villa demo builder: headless build — counts, validity, material colors,
// wall registrations. The File ▸ Load Villa Demo path.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js',
    'js/lib/three.min.js', 'js/app.js', 'js/assets.js', 'js/tools/assets.js', 'js/features/onlinelib.js',
    'js/features/demo-villa.js']);
  const w = L.window;

  test('villa demo builds a valid styled model (walls, hips, fence, colored faces)', () => {
    const m = new w.Model();
    m.levels = [];
    const app = Object.assign(Object.create(w.App.prototype), {
      model: m, bim: new w.BimEntityManager(m),
      sel: { edges: new Set(), faces: new Set() },
      view: { rebuild() { }, invalidate() { }, clearPins() { }, clearPreview() { }, updateSelectionVisuals() { }, setGroupEditBox() { } },
      toast() { }, setStatus() { }, updateInfo() { },
      run: (l, fn) => fn(m),
      transaction: { run: (l, fn) => fn(m) },
      levelManager: {
        levels: m.levels,
        getLevel: id => m.levels.find(x => x.id === id),
        getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
      },
      bimOptions: { baseLevel: 'lvl_1', topConstraint: 'unconnected', unconnectedHeight: 3, thickness: 0.2 },
      refreshGroups() { }, elements: null,
    });
    w.app = app;
    const counts = w.VillaDemo.build(app);
    ok(counts.walls >= 12, 'house walls built: ' + counts.walls);
    ok(counts.fence >= 4, 'fence runs: ' + counts.fence);
    ok(counts.roofs === 2, 'two hip roofs');
    const walls = app.bim.entities.filter(e => e.type === 'wall');
    ok(walls.length === 0, 'the villa is a visual (raw-geometry) build');
    ok(m.validate().ok, 'model valid');
    const colored = [...m.faces.values()].filter(f => f.color).length;
    ok(colored > 1000, 'styled: ' + colored + ' colored faces (glass, frames, roofs, fence, plot)');
  });
};
