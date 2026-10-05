'use strict';
// ---------------------------------------------------------------------------
// stairs.test.js — the stair's GLASS HANDRAIL and the EDITABLE LANDING:
//   · handrail on (default): glass panes + metal rail + posts appear on
//     every flight and the landing (role 'rail'), running parallel to the
//     nosing line at railHeight above it
//   · handrail off: no rail geometry at all
//   · landingDepth is a parameter — the resting platform follows it
// Pure feature functions (planStair/buildStair) over the real Model.
// ---------------------------------------------------------------------------
module.exports = h => {
  const { test, ok, eq, near } = h;

  // single audited loader (harness)
  const L = h.loadModel(['js/tools/base.js', 'js/features/stairs.js']);
  const sandbox = L.sandbox;
  const { G, Model, StairsFeature } = sandbox.window;

  const PARAMS = {
    run: 'u', width: 1.2, riser: 0.175, tread: 0.28, uGap: 0.1,
    storyH: 3, base: [0, 0, 0], dir: [1, 0],
  };

  test('landingDepth is editable — the resting platform follows it', () => {
    const def = StairsFeature.planStair({ ...PARAMS });
    const deep = StairsFeature.planStair({ ...PARAMS, landingDepth: 2.0 });
    near(def.landingDepth, Math.max(0.9, 1.2), 1e-9, 'default landing = max(0.9, width)');
    near(deep.landingDepth, 2.0, 1e-9, 'explicit 2.0 m landing honored');
    ok(deep.landingRect.s1 > def.landingRect.s1 + 0.7, 'the footprint extends with the landing');
    const small = StairsFeature.planStair({ ...PARAMS, landingDepth: 0.5 });
    near(small.landingDepth, 1.2, 1e-9, 'below the code minimum it clamps to the flight width');
  });

  test('handrail ON (default): rail geometry on flights and landing', () => {
    const m = new Model();
    const built = StairsFeature.buildStair(G, m, { ...PARAMS });
    ok(built.ok, 'build ok');
    const railFaces = Object.entries(built.roles).filter(([, r]) => r === 'rail');
    ok(railFaces.length >= 12, 'rail faces present: ' + railFaces.length + ' (2 flights x 2 sides + landing edges: glass + bar + posts)');
    // posts land ON the nosing line by design: the lowest rail geometry is
    // the first post's foot — at/above the first riser, never on the floor
    let lowest = Infinity;
    for (const f of built.faces) {
      if (built.roles[f.id] !== 'rail') continue;
      lowest = Math.min(lowest, m.faceCentroid(f).z);
    }
    const firstRiser = built.info.riser;
    ok(lowest >= firstRiser - 0.05, 'posts land on the first nosing (lowest z ' + lowest.toFixed(2) + ' ≈ riser ' + firstRiser.toFixed(2) + ')');
    ok(m.validate().ok, 'model valid');
  });

  test('handrail OFF: no rail geometry at all', () => {
    const m = new Model();
    const built = StairsFeature.buildStair(G, m, { ...PARAMS, handrail: false });
    ok(built.ok, 'build ok');
    eq(Object.values(built.roles).filter(r => r === 'rail').length, 0, 'zero rail faces');
    ok(Object.values(built.roles).some(r => r === 'tread'), 'treads still built');
  });

  test('railHeight lifts the rail proportionally', () => {
    const m1 = new Model();
    const b1 = StairsFeature.buildStair(G, m1, { ...PARAMS, railHeight: 0.9 });
    const m2 = new Model();
    const b2 = StairsFeature.buildStair(G, m2, { ...PARAMS, railHeight: 1.2 });
    const highest = (m, roles) => {
      let z = -Infinity;
      for (const [id, r] of Object.entries(roles)) {
        if (r !== 'rail') continue;
        const f = m.faces.get(+id);
        if (f) z = Math.max(z, m.faceCentroid(f).z);
      }
      return z;
    };
    const z1 = highest(m1, b1.roles), z2 = highest(m2, b2.roles);
    ok(z2 > z1 + 0.2, `1.2 m rail tops higher than 0.9 m (${z1.toFixed(2)} → ${z2.toFixed(2)})`);
  });
};
