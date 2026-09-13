'use strict';
// Engine SDK tests — event bus isolation, feature registry schema gates, and
// the reference feature's pure geometry helper.
module.exports = h => {
  const { test, ok, eq, near, throws } = h;

  // single audited loader (harness)
  const loadEngine = () => h.loadModel(['js/engine/api.js']).window.Engine;

  test('event bus: isolated listeners never break the emitter', () => {
    const Engine = loadEngine();
    let got = 0;
    Engine.events.on('model:changed', () => { throw new Error('bad listener'); });
    const off = Engine.events.on('model:changed', () => { got++; });
    Engine.events.emit('model:changed', {});
    eq(got, 1, 'healthy listener still ran after a throwing one');
    off();
    Engine.events.emit('model:changed', {});
    eq(got, 1, 'unsubscribe works');
    throws(() => Engine.events.on('nope', 42), 'on() refuses bad arguments');
  });

  test('feature registry: schema gates refuse malformed descriptors', () => {
    const Engine = loadEngine();
    throws(() => Engine.features.register({}), 'empty descriptor refused');
    throws(() => Engine.features.register({ id: 'x', label: 'X', kind: 'tool', tool: function () {}, mode: 'bim' }), 'tool without lifecycle refused');
    throws(() => Engine.features.register({ id: 'x', label: 'X', kind: 'wizard' }), 'unknown kind refused');
    throws(() => Engine.features.register({ id: 'x', label: 'X', kind: 'command', options: [{ key: 'a', type: 'rocket' }] }), 'unknown option type refused');
    throws(() => Engine.features.register({ id: 'x', label: 'X', kind: 'command', options: [{ key: 'a', type: 'select' }] }), 'select without choices refused');
    const d = Engine.features.register({ id: 'ok', label: 'OK', kind: 'command', commands: ['oke'] });
    eq(Engine.features.get('ok'), d, 'valid descriptor registered');
    throws(() => Engine.features.register({ id: 'ok', label: 'OK2', kind: 'command' }), 'duplicate id refused');
    eq(Engine.features.size, 1);
  });

  test('column feature geometry: exact box at the click point', () => {
    // single audited loader (harness): base + the column feature module
    const L = h.loadModel(['js/tools/base.js', 'js/features/column.js']);
    const { G, Model } = L.window;
    const placeColumn = L.window.ColumnFeature.placeColumn;
    const m = new Model();
    const faces = placeColumn(G, m, G.v(2, 3, 0), 0.4, 0.3, 3.5);
    ok(faces && faces.length >= 6, 'column has 6 box faces');
    near(m.shellVolume([...m.faces.keys()]), 0.4 * 0.3 * 3.5, 1e-9, 'exact column volume');
    const v = m.validate();
    ok(v.ok, 'closed shell: ' + (v.errors || []).join('|'));
  });
};
