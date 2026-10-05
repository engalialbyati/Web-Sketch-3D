'use strict';
// Layer system model tests — AutoCAD-style layers on the pure model layer:
// default layer '0', serialize/load round-trips (layers, current layer,
// entity layerId), legacy-file fallbacks, and sanitization of ids that no
// longer resolve (deleted layers, hand-edited files).
module.exports = h => {
  const { test, ok, eq } = h;

  test('a fresh model has the undeletable default layer 0', () => {
    const { Model } = h.makeWorld();
    const m = new Model();
    eq(m.layers.length, 1, 'exactly one layer');
    eq(m.layers[0].id, '0');
    eq(m.layers[0].name, '0');
    ok(m.layers[0].visible !== false, 'layer 0 is on');
    ok(!m.layers[0].locked, 'layer 0 is unlocked');
    eq(m.currentLayerId, '0', 'current layer defaults to 0');
  });

  test('serialize/load round-trips layers, current layer and entity layerId', () => {
    const { m } = h.makeWorld();
    m.layers.push({ id: 'lyr_2', name: 'Structure', color: '#b35900', visible: false, locked: true });
    m.layers.push({ id: 'lyr_3', name: 'Interior', color: null, visible: true, locked: false });
    m.currentLayerId = 'lyr_2';
    m.bimEntities.push({ id: 'wall_1', type: 'wall', params: {}, faces: [], edges: [], layerId: 'lyr_3' });
    m.bimEntities.push({ id: 'beam_1', type: 'beam', params: {}, faces: [], edges: [] }); // legacy entity

    const snap = m.serialize();
    const m2 = new (h.makeWorld().Model)();
    m2.load(snap);

    eq(m2.layers.length, 3, 'all layers survive');
    eq(m2.layers.find(l => l.id === 'lyr_2').name, 'Structure');
    eq(m2.layers.find(l => l.id === 'lyr_2').color, '#b35900');
    eq(m2.layers.find(l => l.id === 'lyr_2').visible, false, 'off state survives');
    eq(m2.layers.find(l => l.id === 'lyr_2').locked, true, 'lock state survives');
    eq(m2.currentLayerId, 'lyr_2', 'current layer survives');
    eq(m2.bimEntities.find(e => e.id === 'wall_1').layerId, 'lyr_3', 'entity layer assignment survives');

    // snapshots must be deep — mutating the restored model cannot corrupt
    // the snapshot the undo stack still holds
    m2.layers.find(l => l.id === 'lyr_2').name = 'Renamed';
    m2.bimEntities[0].layerId = '0';
    eq(snap.lyr.find(l => l.id === 'lyr_2').name, 'Structure', 'snapshot layers are copies');
    eq(snap.bim[0].layerId, 'lyr_3', 'snapshot entity layerId is a copy');
  });

  test('legacy files without layers load with default layer 0', () => {
    const { m } = h.makeWorld();
    const face = m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }]);
    ok(face, 'fixture face');
    const legacy = m.serialize();
    delete legacy.lyr;
    delete legacy.cur;

    const { Model } = h.makeWorld();
    const m2 = new Model();
    m2.load(legacy);
    eq(m2.layers.length, 1, 'defaults restored');
    eq(m2.layers[0].id, '0');
    eq(m2.currentLayerId, '0');
  });

  test('entities on deleted/unknown layers fall back to layer 0', () => {
    const { Model } = h.makeWorld();
    const m = new Model();
    m.load({
      v: [[1, 0, 0, 0], [2, 1, 0, 0]],
      e: [[1, 1, 2, 0, 0, null, 0]],
      c: [], g: [], f: [],
      bim: [
        { id: 'wall_1', type: 'wall', params: {}, faces: [], edges: [], layerId: 'lyr_gone' },
        { id: 'wall_2', type: 'wall', params: {}, faces: [], edges: [] },
      ],
      lyr: [{ id: '0', name: '0' }],
      cur: 'lyr_also_gone',
    });
    eq(m.bimEntities.find(e => e.id === 'wall_1').layerId, '0', 'unknown layer sanitized to 0');
    eq(m.bimEntities.find(e => e.id === 'wall_2').layerId, '0', 'missing layerId defaults to 0');
    eq(m.currentLayerId, '0', 'unknown current layer falls back to 0');
  });

  test('layer 0 is re-inserted when a snapshot lost it', () => {
    const { Model } = h.makeWorld();
    const m = new Model();
    m.load({ v: [[1, 0, 0, 0], [2, 1, 0, 0]], e: [[1, 1, 2, 0, 0, null, 0]], c: [], g: [], f: [], bim: [], lyr: [] });
    ok(m.layers.some(l => l.id === '0'), 'layer 0 guaranteed present');
    eq(m.currentLayerId, '0');
  });
};
