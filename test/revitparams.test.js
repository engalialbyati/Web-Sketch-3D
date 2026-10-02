'use strict';
// Revit's standard element data — every element is born with Phasing
// (Phase Created/Demolished), Identity Data (Mark, Comments) and
// category-appropriate Structural / Room Bounding values; data-only
// parameters set WITHOUT regeneration while geometric ones still rebuild.
module.exports = h => {
  const { loadModel, test, ok, eq } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js', 'js/db.js', 'js/lib/three.min.js', 'js/app.js', 'js/assets.js', 'js/tools/assets.js', 'js/features/onlinelib.js']);
  const { window: w } = L;
  const { Model, BimEntityManager } = w;

  const m = new Model();
  const bim = new BimEntityManager(m);
  let rebuildCalls = 0;
  const app2 = Object.assign(Object.create(w.App.prototype), {
    model: m, bim,
    view: { rebuild() { }, invalidate() { }, clearPins() { }, clearPreview() { }, zoomExtents() { } },
    toast() { }, setStatus() { }, updateInfo() { },
    run: (label, fn) => fn(m),
    levelManager: { model: m, levels: m.levels || [], getLevel: () => null, getElevation: () => 0 },
    transaction: { run: (label, fn) => fn(m) },
  });
  // the spy decides routing: data-only keys never reach it, geometric keys do
  bim.rebuildWallWithHosts = () => { rebuildCalls++; return true; };

  const G = w.G;
  const face = m.addFaceFromRings([G.v(0, 0, 0), G.v(3, 0, 0), G.v(3, 0.2, 0), G.v(0, 0.2, 0), G.v(0, 0.2, 2.8), G.v(0, 0, 2.8)]);

  test('every element is BORN with Revit standard data (phasing, identity, structural)', () => {
    const ent = bim.create('wall', { base: { x: 0, y: 0 }, end: { x: 3, y: 0 }, thickness: 0.2, height: 2.8 }, { [face.id]: 'wall' }, []);
    eq(ent.params.phaseCreated, 'New Construction', 'Phase Created defaults');
    eq(ent.params.structural, false, 'a wall is non-structural by default');
    eq(ent.params.structuralUsage, 'nonbearing', 'wall structural usage default');
    eq(ent.params.roomBounding, true, 'walls bound rooms');
    const col = bim.create('column', { width: 0.3, depth: 0.3, height: 3 }, {}, []);
    eq(col.params.structural, true, 'columns are structural');
    eq(col.params.roomBounding, undefined, 'columns do not bound rooms');
  });

  test('_bimParamFields: the Revit sections are present for every element', () => {
    const ent = bim.entities.find(e => e.type === 'wall');
    const keys = app2._bimParamFields(ent).map(f => f.key);
    for (const k of ['phaseCreated', 'phaseDemolished', 'mark', 'comments', 'structural', 'structuralUsage', 'roomBounding'])
      ok(keys.includes(k), 'wall carries ' + k);
    const door = bim.create('door', { hostWallId: ent.id, width: 0.9, height: 2.1, sillHeight: 0 }, {}, []);
    const dkeys = app2._bimParamFields(door).map(f => f.key);
    ok(dkeys.includes('mark') && dkeys.includes('comments') && dkeys.includes('phaseCreated'), 'doors carry identity + phasing');
    ok(!dkeys.includes('roomBounding') && !dkeys.includes('structuralUsage'), 'doors carry no structural/room-bounding params (Revit too)');
  });

  test('legacy elements (saved before this data) still render the fields with fallbacks', () => {
    const old = { id: 'wall_99', type: 'wall', params: { thickness: 0.2, height: 2.8 }, faces: [], edges: [], layerId: '0' };
    m.bimEntities.push(old);
    const fields = app2._bimParamFields(old);
    const byKey = Object.fromEntries(fields.map(f => [f.key, f]));
    eq(byKey.mark.value, '', 'empty Mark, still editable');
    eq(byKey.phaseCreated.value, 'New Construction', 'phase falls back to Revit default');
    eq(byKey.structural.value, false, 'structural fallback');
    m.bimEntities.pop();
  });

  test('data-only parameters set WITHOUT regeneration; geometric ones still rebuild', () => {
    const ent = bim.entities.find(e => e.type === 'wall');
    const facesBefore = ent.faces.join(',');
    ok(app2._applyBimParam(ent, 'mark', 'W-101'), 'mark applied');
    ok(app2._applyBimParam(ent, 'comments', 'north wall'), 'comments applied');
    ok(app2._applyBimParam(ent, 'phaseDemolished', 'Existing'), 'phase applied');
    ok(app2._applyBimParam(ent, 'structuralUsage', 'bearing'), 'structural usage applied');
    eq(rebuildCalls, 0, 'data-only edits never regenerate');
    eq(ent.params.mark, 'W-101', 'mark persisted on the entity');
    eq(ent.faces.join(','), facesBefore, 'geometry untouched');
    ok(app2._applyBimParam(ent, 'height', 3.2), 'height applied');
    eq(rebuildCalls, 1, 'a geometric edit goes through the wall rebuild');
    eq(ent.params.height, 3.2, 'height param set');
  });

  test('FIXED converted elements keep the Revit data fields, drop the geometric inputs', () => {
    // the claim path (Follow Me sweep ▸ Convert to Element) registers fixed
    // bodies — their geometry never regenerates, but they still carry Revit's
    // standard instance data in the properties panel
    const fw = bim.create('wall', { fixed: true, source: 'convert', name: 'Curved Wall 1', profile: [] }, {}, []);
    const keys = app2._bimParamFields(fw).map(f => f.key);
    for (const k of ['phaseCreated', 'phaseDemolished', 'mark', 'comments', 'structural', 'structuralUsage', 'roomBounding'])
      ok(keys.includes(k), 'fixed wall still carries ' + k);
    for (const gk of ['height', 'thickness', 'topConstraint', 'locationLine', 'layers'])
      ok(!keys.includes(gk), 'fixed wall hides the geometric input ' + gk);
    // and the data-only writes still apply without any regeneration attempt
    rebuildCalls = 0;
    ok(app2._applyBimParam(fw, 'mark', 'CW-1'), 'mark applied on the fixed element');
    eq(rebuildCalls, 0, 'no rebuild for a data-only edit on a fixed element');
    eq(fw.params.mark, 'CW-1', 'mark stored');
  });

  test('BASE LEVEL "None": the free sketch elevation follows the snap height', () => {
    ok(w.LevelManager, 'LevelManager exported');
    const lm = new w.LevelManager(m);
    m.levels.push({ id: 'lvl_2', name: 'L2', elevation: 3 }); // levels proxy the model
    eq(lm.getElevation('lvl_2'), 3, 'a real level reads its elevation');
    eq(lm.getElevation('none'), 0, 'None with no captured height falls back to 0');
    lm._freeBaseZ = 1.5; // e.g. hovering a 1.5 m wall top
    eq(lm.getElevation('none'), 1.5, 'None reads the captured free height');
    // the inferPoint capture: a real-geometry snap sets it, axis noise does not
    // (inferPoint's display tail needs the full view — the capture itself
    // happens first, so the assert runs regardless of the tail's error)
    const cap = Object.assign(Object.create(w.App.prototype), {
      model: m, mode: 'bim', axisLocks: new Set(), levelManager: lm,
      bimOptions: { baseLevel: 'none' },
      _inferPointRaw: () => ({ p: G.v(2, 2, 1.5), kind: 'face' }),
      view: {},
    });
    lm._freeBaseZ = 0;
    try { cap.inferPoint({ clientX: 10, clientY: 10 }, null); } catch (e) { }
    eq(lm.getElevation('none'), 1.5, 'a face snap at 1.5 m moves the None base plane');
    const ax = Object.assign(Object.create(cap), { _inferPointRaw: () => ({ p: G.v(2, 2, 9), kind: 'axis' }) });
    try { ax.inferPoint({ clientX: 10, clientY: 10 }, null); } catch (e) { }
    eq(lm.getElevation('none'), 1.5, 'non-snap inference leaves the captured height alone');
    // a level-bound base ignores the capture entirely
    const bound = Object.assign(Object.create(cap), { bimOptions: { baseLevel: 'lvl_2' } });
    try { bound.inferPoint({ clientX: 10, clientY: 10 }, null); } catch (e) { }
    eq(lm.getElevation('lvl_2'), 3, 'level-bound base never moves');
  });
};
