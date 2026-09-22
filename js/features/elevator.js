'use strict';
// ---------------------------------------------------------------------------
// Feature: Elevator — an ETABS-style elevator shaft: four shear walls per
// story, a door opening (with lintel beam) in the front wall at every
// floor, and hoistway openings the host slabs carry. The shaft is plain
// BIM (walls + hosted cuts + lintel beams), so the reinforcement tools
// treat it like anything else: shear-wall mesh + boundary elements
// (WALL-110), door trim steel (WALL-206/208), wall starter dowels into
// every slab (WALL-100A), and lintel bars (the beam cage).
//
// ElevatorFeature.buildOne(app, opts) places ONE story of the shaft:
//   { x, y, w, d, wall, z0, h, doorW, doorH, doorSide ('-y'|'+y'|'-x'|'+x'),
//     lintel: {w, h}, baseLevel }
// Returns the created entities. buildStack() loops the stories.
// ---------------------------------------------------------------------------
(function () {

  function buildOne(app, o) {
    const m = app.model, bim = app.bim, G = window.G, BT = window.BimTools, S = app.structural;
    if (!BT || !S) throw new Error('bim tools / structural features missing');
    const w = o.w || 2, d = o.d || 2, t = o.wall || 0.2;
    const x = o.x, y = o.y, z0 = o.z0, h = o.h || 3;
    const made = { walls: [], doors: [], lintels: [] };

    // four walls: a closed ring of four runs (ETABS draws the shaft as
    // wall panels meeting at the corners; grid-to-grid runs overlap at
    // the corner columns exactly like the rest of the app)
    const inset = t / 2;
    const runs = [
      { base: [x - w / 2 + inset, y - d / 2, z0], end: [x + w / 2 - inset, y - d / 2, z0] }, // south
      { base: [x - w / 2 + inset, y + d / 2, z0], end: [x + w / 2 - inset, y + d / 2, z0] }, // north
      { base: [x - w / 2, y - d / 2 + inset, z0], end: [x - w / 2, y + d / 2 - inset, z0] }, // west
      { base: [x + w / 2, y - d / 2 + inset, z0], end: [x + w / 2, y + d / 2 - inset, z0] }, // east
    ];
    const names = ['south', 'north', 'west', 'east'];
    const walls = [];
    runs.forEach((r2, i) => {
      const wp = { base: r2.base, end: r2.end, height: h, thickness: t,
        locationLine: 'centerline', primitive: 'line', closed: false,
        joins: { start: 0, end: 0 }, shear: true, source: 'elevator' };
      const before = new Set(m.faces.keys());
      m.bimHold = true;
      try {
        const ring = bim.wallRing(wp);
        const f = m.addFaceFromRings(ring.map(q => G.clone(q)));
        if (!f) throw new Error('shaft wall ring degenerate (' + names[i] + ')');
        if (!m.pushPull(f, h)) throw new Error('shaft wall sweep failed');
      } finally { m.bimHold = false; }
      const nf = [...m.faces.keys()].filter(id => !before.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      const roles = {};
      for (const f of nf) roles[f.id] = 'body';
      const ent = bim.create('wall', JSON.parse(JSON.stringify(wp)), roles, []);
      walls.push(ent);
      made.walls.push(ent.id);
    });

    // door opening in the chosen side at this floor: sill = floor finish
    const side = o.doorSide || '-y';
    const doorW = o.doorW || 1.1, doorH = o.doorH || 2.1;
    const front = walls[side === '-y' ? 0 : side === '+y' ? 1 : side === '-x' ? 2 : 3];
    {
      const wp = front.params;
      const L = Math.hypot(wp.end[0] - wp.base[0], wp.end[1] - wp.base[1]);
      const t2 = Math.max(0.5, Math.min(L - doorW / 2 - 0.2, L / 2));
      const before = new Set(m.faces.keys());
      m.bimHold = front.id;
      let info = null;
      try {
        info = BT.HostedCut.cut(G, m, wp,
          { distanceFromStart: t2, width: doorW, height: doorH, sillHeight: 0, depth: t });
      } finally { m.bimHold = false; }
      if (!info || info.error) throw new Error('elevator door cut failed');
      const nf = [...m.faces.keys()].filter(id => !before.has(id));
      const roles = {};
      for (const id of nf) roles[id] = 'lining';
      bim.create('door', { hostWallId: front.id, distanceFromStart: info.t,
        width: doorW, height: doorH, sillHeight: 0, depth: t, facing: 1, hand: 1,
        source: 'elevator' }, roles, []);
      made.doors.push(1);

      // Lintel over the door: a short beam bearing 0.25 m each side
      // (the classic lintel bar detail comes from the beam cage)
      const ux = (wp.end[0] - wp.base[0]) / L, uy = (wp.end[1] - wp.base[1]) / L;
      const cx = wp.base[0] + ux * info.t, cy = wp.base[1] + uy * info.t;
      const bear = 0.25;
      const a = [cx - ux * (doorW / 2 + bear), cy - uy * (doorW / 2 + bear), z0 + doorH + 0.05];
      const b2 = [cx + ux * (doorW / 2 + bear), cy + uy * (doorW / 2 + bear), z0 + doorH + 0.05];
      const lp = { baseline: [a, b2], profile: 'rectangular',
        webWidth: o.lintelW || t, height: o.lintelH || 0.4,
        referenceLevelId: o.baseLevel, zJustification: 'Bottom', source: 'elevator' };
      const before2 = new Set(m.faces.keys());
      m.bimHold = true;
      try { S.buildBeam(G, m, lp); } finally { m.bimHold = false; }
      const nf2 = [...m.faces.keys()].filter(id => !before2.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      const roles2 = {};
      for (const f of nf2) roles2[f.id] = 'body';
      bim.create('beam', JSON.parse(JSON.stringify(lp)), roles2, []);
      made.lintels.push(1);
    }
    return made;
  }

  function buildStack(app, o) {
    const stories = o.stories || 1, h = o.h || 3;
    const out = { walls: 0, doors: 0, lintels: 0 };
    for (let s = 0; s < stories; s++) {
      const one = buildOne(app, { ...o, z0: (o.z0 || 0) + s * h, baseLevel: o.baseLevels ? o.baseLevels[s] : o.baseLevel });
      out.walls += one.walls.length; out.doors += one.doors.length; out.lintels += one.lintels.length;
    }
    return out;
  }

  // the hoistway ring the host slabs punch (16-gon approx of the shaft
  // interior, +5mm construction reveal like demo5's column punches)
  function hoistwayRing(o) {
    const w = (o.w || 2) / 2 - (o.wall || 0.2) / 2 + 0.005;
    const d = (o.d || 2) / 2 - (o.wall || 0.2) / 2 + 0.005;
    return [[o.x - w, o.y - d], [o.x + w, o.y - d], [o.x + w, o.y + d], [o.x - w, o.y + d]];
  }

  window.ElevatorFeature = { buildOne, buildStack, hoistwayRing };
})();
