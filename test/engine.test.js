'use strict';
// Engine SDK tests — event bus isolation, feature registry schema gates, and
// the reference feature's pure geometry helper.
module.exports = h => {
  const { test, ok, eq, near, throws } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  const loadEngine = () => {
    const sandbox = { window: {}, console };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'engine', 'api.js'), 'utf8'), ctx, { filename: 'engine/api.js' });
    return sandbox.window.Engine;
  };

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
    const sandbox = { window: {}, console };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/model.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    const { G, Model } = sandbox.window;
    // the pure helper from js/features/column.js (no Tool/app dependency)
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'features', 'column.js'), 'utf8');
    const placeColumn = (() => {
      const w2 = { ColumnFeature: null };
      const fn = new Function('G', 'Tool', 'window', 'Engine', src);
      fn(G, class { }, w2, null);
      return w2.ColumnFeature.placeColumn;
    })();
    const m = new Model();
    const faces = placeColumn(G, m, G.v(2, 3, 0), 0.4, 0.3, 3.5);
    ok(faces && faces.length >= 6, 'column has 6 box faces');
    near(m.shellVolume([...m.faces.keys()]), 0.4 * 0.3 * 3.5, 1e-9, 'exact column volume');
    const v = m.validate();
    ok(v.ok, 'closed shell: ' + (v.errors || []).join('|'));
  });
};
