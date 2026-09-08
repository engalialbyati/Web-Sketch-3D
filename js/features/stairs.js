'use strict';
// ---------------------------------------------------------------------------
// Feature: Stairs — the native, floor-hosted stair (straight run or dog-leg U).
//
// Hosted insertion with the door/window discipline applied to floors: pick a
// stair in the Element Browser, click the floor/slab it ARRIVES at, drag the
// run direction — the app installs the stair rising the FULL STORY from the
// level below and cuts the stairwell opening in the host floor. The opening
// lives in the host's params.regions[].holes, so it survives floor rebuilds,
// undo and project round-trips exactly the way a wall opening survives wall
// rebuilds (rebuildWallWithHosts discipline; here: rebuildFloorWithHoles).
//
// Same SDK shape as Column (the reference feature): one Tool class, one
// Engine.features.register() descriptor — ribbon button, 'stair'/'stairs'
// command aliases, options-bar fields and the undo label all come from the
// descriptor. The geometry itself is pure (model calls only, unit-testable):
//
//   stairMath(p)  riser/tread solve + IBC/EN comfort warnings (2R + T)
//   planStair(p)  the full layout recipe (flights, landing, footprint) —
//                 the preview ghost never touches the model
//   buildStair()  the sawtooth solids (the FIRE_STAIR profile,
//                 js/script-elements.js) + the U landing, classified
//                 'tread' | 'riser' | 'landing' | 'side' (side = the stringer
//                 profile faces and soffits)
//
// Regeneration: Entity Info's type dropdown (Straight Flight / Dog-Leg /
// sized types) re-runs rebuildStairEntity — old geometry AND the old host
// hole go, then the new flight and the new hole arrive in one transaction.
// ---------------------------------------------------------------------------
(function () {

  const RISER_MAX = 0.19;   // m — the code ceiling on a single riser
  const TREAD_MIN = 0.25;   // m — minimum going (IBC 1011.5.2 / EN 9.2)
  const COMFORT = [0.55, 0.70]; // m — the 2R + T comfort band
  const LANDING_TH = 0.12;  // m — structural thickness of the mid landing slab
  const PREVIEW = 0x0e8385;
  const OPENING = 0xd946ef; // magenta — the sketch-mode opening color
  const num = (v, d) => (v != null && isFinite(+v)) ? +v : d;

  // ------------------------------------------------------------- stair math
  // nRisers from the TARGET riser clamped to the code maximum: the count that
  // reaches the target with equal risers while never exceeding 0.19 m (the
  // spec's ceil(storyH / 0.19) is the floor this never drops below).
  function stairMath(params) {
    const storyH = Math.max(0.05, num(params.storyH, 3));
    const target = Math.min(RISER_MAX, Math.max(0.1, num(params.riser, 0.175)));
    const tread = Math.max(0.05, num(params.tread, 0.28));
    const nRisers = Math.max(2, Math.ceil(storyH / target), Math.ceil(storyH / RISER_MAX));
    const riser = storyH / nRisers;
    const warnings = [];
    if (tread < TREAD_MIN - 1e-9)
      warnings.push(`tread ${(tread * 1000).toFixed(0)} mm is below the ${TREAD_MIN * 1000} mm minimum`);
    const rule = 2 * riser + tread;
    if (rule < COMFORT[0] - 1e-9 || rule > COMFORT[1] + 1e-9)
      warnings.push(`2R + T = ${rule.toFixed(2)} m is outside the ${COMFORT[0].toFixed(2)}–${COMFORT[1].toFixed(2)} m comfort band`);
    return { storyH, nRisers, riser, tread, warnings };
  }

  // -------------------------------------------------------------- the recipe
  // Pure layout: no model dependency, so the drag ghost and the committed
  // solid can never disagree. Returns the construction recipe both consume.
  //
  // params { run:'straight'|'u', width, riser, tread, storyH, base:[x,y,z],
  //          dir:[x,y] (unit plan run direction), uGap }
  function planStair(params) {
    const run = params.run === 'u' ? 'u' : 'straight';
    const width = Math.max(0.4, num(params.width, 1.2));
    const uGap = Math.max(0, num(params.uGap, 0.1));
    const math = stairMath(params);
    const base = { x: +params.base[0], y: +params.base[1], z: +params.base[2] };
    let dx = +params.dir[0], dy = +params.dir[1];
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const Lx = -dy, Ly = dx; // "left" of the run — the across-flight axis
    const at = (s, off, z) => ({ x: base.x + dx * s + Lx * off, y: base.y + dy * s + Ly * off, z: base.z + z });
    const { nRisers, riser, tread } = math;

    // nosing line of every tread (leading edge at its walking height) — the
    // classic fan the preview draws
    const treads = [];
    const flightTreads = (count, s0, z0, ds, off) => {
      for (let i = 1; i <= count; i++)
        treads.push({
          a: at(s0 + ds * tread * i, off, z0 + riser * i),
          b: at(s0 + ds * tread * i, off + width, z0 + riser * i),
        });
    };
    // construction recipe: sawtooth flights (FIRE_STAIR profile) + landing
    const flights = [];
    const flightRec = (count, s0, z0, ds, off) => {
      flights.push({ count, s0, z0, ds, off });
      flightTreads(count, s0, z0, ds, off);
    };
    let landingRect = null, bounds;
    if (run === 'u') {
      const n1 = Math.ceil(nRisers / 2), n2 = nRisers - n1;
      const midS = tread * n1, midZ = riser * n1;
      // the landing ("resting platform") depth is EDITABLE — default: never
      // shorter than its flight (the code minimum is the flight width)
      const landingDepth = Math.max(0.9, width, num(params.landingDepth, 0));
      flightRec(n1, 0, 0, 1, 0);                          // flight 1 up the +run side
      landingRect = { s0: midS, s1: midS + landingDepth, off0: 0, off1: 2 * width + uGap, z: midZ };
      flightRec(n2, midS + landingDepth, midZ, -1, width + uGap); // flight 2 back alongside
      bounds = { s0: midS + landingDepth - tread * n2, s1: midS + landingDepth, off0: 0, off1: 2 * width + uGap };
    } else {
      flightRec(nRisers, 0, 0, 1, 0);
      bounds = { s0: 0, s1: tread * nRisers, off0: 0, off1: width };
    }
    // the plan footprint (the host opening rectangle), wound CCW seen from +z
    let footprint = [
      at(bounds.s0, bounds.off0, 0), at(bounds.s1, bounds.off0, 0),
      at(bounds.s1, bounds.off1, 0), at(bounds.s0, bounds.off1, 0),
    ];
    return {
      run, width, uGap, nRisers, riser, tread, warnings: math.warnings,
      runLength: bounds.s1 - bounds.s0, overallWidth: bounds.off1 - bounds.off0,
      landingDepth: landingRect ? landingRect.s1 - landingRect.s0 : 0,
      flights, landingRect, footprint, treads,
    };
  }

  // ------------------------------------------------------------- the builder
  // Real B-Rep solids from the recipe (addFaceFromRings + pushPull only —
  // the script-elements contract). Claims ONLY unstamped new faces: pieces of
  // elements the sweeps split keep their owner's stamp (the column contract).
  function buildStair(G, m, params) {
    const plan = planStair(params);
    const base = { x: +params.base[0], y: +params.base[1], z: +params.base[2] };
    let dx = +params.dir[0], dy = +params.dir[1];
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const D = G.v(dx, dy, 0), L = G.v(-dy, dx, 0);
    const at = (s, off, z) => G.v(base.x + D.x * s + L.x * off, base.y + D.y * s + L.y * off, base.z + z);
    const roles = {};
    const before = () => new Set(m.faces.keys());
    const created = b => [...m.faces.keys()].filter(id => !b.has(id))
      .map(id => m.faces.get(id)).filter(f => f && !f.userData); // never steal a neighbor's split
    const normOf = f => G.loopNormal(m.pts(f.loop));

    // one sawtooth flight: the stepped profile ring (riser → tread per step,
    // close along the underside) extruded across the flight width. The two
    // big profile faces at the width ends ARE the stringers (role 'side').
    const flight = fl => {
      const b = before();
      const { count, s0, z0, ds, off } = fl;
      const width = plan.width, tread = plan.tread, riser = plan.riser;
      const ring = [at(s0, off, z0)];
      for (let i = 1; i <= count; i++) {
        const z = z0 + riser * i;
        const s1 = s0 + ds * tread * (i - 1);
        ring.push(at(s1, off, z));                     // riser
        ring.push(at(s1 + ds * tread, off, z));        // tread
      }
      ring.push(at(s0 + ds * tread * count, off, z0)); // back drop
      if (G.dot(G.loopNormal(ring), L) < 0) ring.reverse();
      const f = m.addFaceFromRings(ring.map(p => G.clone(p)));
      if (!f) return 0;
      if (!m.pushPull(f, width, true)) return 0;
      for (const g of created(b)) {
        const n = normOf(g);
        if (G.isZero(n)) { roles[g.id] = 'side'; continue; }
        if (Math.abs(G.dot(n, L)) > 0.9) roles[g.id] = 'side';          // stringers
        else if (n.z > 0.9) roles[g.id] = 'tread';                       // walking surface
        else if (Math.abs(n.z) < 0.1) roles[g.id] = 'riser';             // vertical going face
        else roles[g.id] = 'side';                                       // soffit / drop
      }
      return Object.keys(roles).length;
    };
    // the mid landing: a slab hanging under its walking plane
    const landing = lr => {
      const b = before();
      const ring = [at(lr.s0, lr.off0, lr.z), at(lr.s1, lr.off0, lr.z),
        at(lr.s1, lr.off1, lr.z), at(lr.s0, lr.off1, lr.z)];
      if (G.loopNormal(ring).z < 0) ring.reverse();
      const f = m.addFaceFromRings(ring.map(p => G.clone(p)));
      if (!f) return 0;
      if (!m.pushPull(f, -LANDING_TH, true)) return 0;
      for (const g of created(b)) {
        const n = normOf(g);
        roles[g.id] = !G.isZero(n) && Math.abs(n.z) > 0.9 ? 'landing' : 'side';
      }
      return Object.keys(roles).length;
    };

    for (const fl of plan.flights) {
      const n0 = Object.keys(roles).length;
      flight(fl);
      if (Object.keys(roles).length === n0) return { error: 'stair flight build failed' };
    }
    if (plan.landingRect) {
      const n1 = Object.keys(roles).length;
      landing(plan.landingRect);
      if (Object.keys(roles).length === n1) return { error: 'landing build failed' };
    }

    // ---------------------------------------------------------- handrail
    // The owner's reference look: a GLASS balustrade — thin sloped panels
    // under a metal handrail, posts at the ends and along the run. On by
    // default (params.handrail !== false); Entity Info's checkbox toggles
    // it and the stair regenerates.
    // PERFORMANCE: every part is separated by 5–10 mm (the floating-glass
    // modern detail) so NOTHING overlaps — no welds, no sweep explosions;
    // the whole rail builds in milliseconds instead of seconds.
    const RAIL_H = Math.max(0.6, num(params.railHeight, 0.9));
    const railRun = (pA, pB) => {
      // one sloped balustrade line from pA to pB (both at RAIL height)
      const b0 = before();
      // rail bar — the metal handrail along the nosing-parallel line
      const rail = [
        at(pA.s, pA.off, pA.z - 0.025), at(pA.s, pA.off, pA.z + 0.025),
        at(pB.s, pB.off, pB.z + 0.025), at(pB.s, pB.off, pB.z - 0.025),
      ];
      if (G.dot(G.loopNormal(rail), L) < 0) rail.reverse();
      const rf = m.addFaceFromRings(rail.map(p => G.clone(p)));
      if (rf) m.pushPull(rf, 0.045, true);
      // glass pane — floating just inside the posts, 5 mm clear of the rail
      const glass = [
        at(pA.s, pA.off - 0.045, pA.z - RAIL_H + 0.02), at(pA.s, pA.off - 0.045, pA.z - 0.035),
        at(pB.s, pB.off - 0.045, pB.z - 0.035), at(pB.s, pB.off - 0.045, pB.z - RAIL_H + 0.02),
      ];
      if (G.dot(G.loopNormal(glass), L) < 0) glass.reverse();
      const gf = m.addFaceFromRings(glass.map(p => G.clone(p)));
      if (gf) m.pushPull(gf, 0.012, true);
      // posts — ends + mid, 8 mm clear above the walking line and below the
      // rail bar: zero contact, zero welds
      const span = Math.hypot(pB.s - pA.s, pB.z - pA.z);
      const nPosts = Math.max(2, Math.min(5, Math.ceil(span / 1.5) + 1));
      for (let i = 0; i < nPosts; i++) {
        const t = i / (nPosts - 1);
        const s = pA.s + (pB.s - pA.s) * t;
        const zr = pA.z + (pB.z - pA.z) * t;
        const zTop = zr - 0.033;                     // just under the rail bar
        const zBot = zr - RAIL_H + 0.008;            // just above the walking line
        const post = [
          at(s - 0.02, pA.off, zBot), at(s + 0.02, pA.off, zBot),
          at(s + 0.02, pA.off, zTop), at(s - 0.02, pA.off, zTop),
        ];
        if (G.dot(G.loopNormal(post), L) < 0) post.reverse();
        const pf = m.addFaceFromRings(post.map(p => G.clone(p)));
        if (pf) m.pushPull(pf, 0.045, true);
      }
      for (const g of created(b0)) roles[g.id] = 'rail';
    };
    if (params.handrail !== false) {
      for (const fl of plan.flights) {
        const sA = fl.s0 + fl.ds * plan.tread, sB = fl.s0 + fl.ds * plan.tread * fl.count;
        const zA = fl.z0 + plan.riser + RAIL_H, zB = fl.z0 + plan.riser * fl.count + RAIL_H;
        railRun({ s: sA, off: fl.off + 0.06, z: zA }, { s: sB, off: fl.off + 0.06, z: zB });
        railRun({ s: sA, off: fl.off + plan.width - 0.06, z: zA }, { s: sB, off: fl.off + plan.width - 0.06, z: zB });
      }
      if (plan.landingRect) {
        const lr = plan.landingRect;
        const z = lr.z + RAIL_H;
        railRun({ s: lr.s0, off: lr.off0 + 0.06, z }, { s: lr.s1, off: lr.off0 + 0.06, z });
        railRun({ s: lr.s0, off: lr.off1 - 0.06, z }, { s: lr.s1, off: lr.off1 - 0.06, z });
        railRun({ s: lr.s1 - 0.06, off: lr.off0 + 0.06, z }, { s: lr.s1 - 0.06, off: lr.off1 - 0.06, z });
      }
    }

    // rail posts/rails/glass deliberately overlap — repair the ring edges
    // the welds repartitioned (the sweep-bracket contract every builder runs)
    for (const f of m.faces.values()) {
      m.edgesForRing(f.loop, true);
      for (const h of (f.holes || [])) m.edgesForRing(h, true);
    }

    const faces = Object.keys(roles).map(Number).map(id => m.faces.get(id)).filter(Boolean);
    if (!faces.length) return { error: 'the stair created no geometry' };
    // unstamped ring edges join the entity (gridplace's beam contract)
    const edges = [];
    for (const f of faces) {
      for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
        const e = m.findEdge(r[i], r[(i + 1) % r.length]);
        if (e && !e.userData) edges.push(e.id);
      }
    }
    return { ok: true, faces, roles, edges: [...new Set(edges)], info: plan, warnings: plan.warnings };
  }

  // ------------------------------------------------------- host floor cuts
  // 2D ray cast (every slab ring lives on one z plane, so x/y is exact)
  function pointInRing2D(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = +ring[i][0], yi = +ring[i][1], xj = +ring[j][0], yj = +ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // punch the stair footprint into the host's params: the hole is appended to
  // the region whose boundary contains it, so every future rebuild re-cuts it.
  // ring: [{x,y,z}] on the host's top plane. Throws when the fit is illegal.
  function addHostHole(app, host, ring) {
    const regions = host.params.regions;
    const cx = (ring[0].x + ring[2].x) / 2, cy = (ring[0].y + ring[2].y) / 2;
    let idx = -1;
    for (let i = 0; i < regions.length; i++)
      if (pointInRing2D(cx, cy, regions[i].outer)) { idx = i; break; }
    if (idx < 0) throw new Error('the stair sits outside its host floor — place it over the slab');
    for (const c of ring)
      if (!pointInRing2D(c.x, c.y, regions[idx].outer))
        throw new Error('the stair opening would cross the host floor edge — move it inside');
    const r = regions[idx];
    r.holes = r.holes || [];
    r.holes.push(ring.map(p => [p.x, p.y, p.z]));
    return idx;
  }

  // drop the hole a stair previously punched (its recorded opening ring)
  function removeHostHole(app, host, ring) {
    if (!host || !Array.isArray(host.params.regions) || !Array.isArray(ring)) return;
    const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((p, i) =>
      Math.abs(+p[0] - b[i][0]) < 1e-4 && Math.abs(+p[1] - b[i][1]) < 1e-4 && Math.abs(+p[2] - b[i][2]) < 1e-4);
    for (const r of host.params.regions)
      if (Array.isArray(r.holes)) r.holes = r.holes.filter(h => !same(h, ring));
  }

  // Rebuild a floor/slab from its params.regions (holes included) — the
  // rebuildWallWithHosts discipline for horizontal hosts: sweep-bracketed
  // delete, survivor ring edges recreated, re-extrude every region down by
  // the recorded thickness, re-stamp only UNSTAMPED new faces. The stairwell
  // opening persists through this because it lives in params, not geometry.
  function rebuildFloorWithHoles(app, hostId) {
    const m = app.model;
    const ent = app.bim.getEntityById(hostId);
    if (!ent || (ent.type !== 'floor' && ent.type !== 'slab'))
      throw new Error('the host floor is missing');
    const regions = ent.params.regions;
    if (!Array.isArray(regions) || !regions.length)
      throw new Error('the host floor has no sketch regions');
    const th = Math.max(0.01, num(ent.params.thickness, 0.2));
    m.bimHold = true;
    try {
      // phase 1 — remove the floor's current geometry (shared boundary edges
      // surviving faces still need are recreated — the wall precedent)
      for (const fid of [...ent.faces]) m.faces.delete(fid);
      for (const eid of [...ent.edges]) m.edges.delete(eid);
      m.gc();
      for (const f2 of m.faces.values()) {
        m.edgesForRing(f2.loop, true);
        for (const h of (f2.holes || [])) m.edgesForRing(h, true);
      }
      // phase 2 — re-extrude every region from params, openings re-cut
      const before = new Set(m.faces.keys());
      const tops = [];
      for (const r of regions) {
        const outer = (r.outer || []).map(p => G.v(+p[0], +p[1], +p[2]));
        const holes = (r.holes || []).map(h => h.map(p => G.v(+p[0], +p[1], +p[2])));
        if (outer.length < 3) continue;
        tops.push(outer[0].z);
        const f = m.addFaceFromRings(outer.map(p => G.clone(p)), holes.map(h => h.map(p => G.clone(p))));
        if (!f) throw new Error('floor boundary degenerate on rebuild');
        if (!m.pushPull(f, -th, true)) throw new Error('floor extrusion failed on rebuild');
      }
      // phase 3 — re-stamp: claim only unstamped new faces; pieces the sweep
      // split off other elements keep their owner (the column contract)
      const bottoms = tops.map(t => t - th);
      const onPlane = (z, arr) => arr.some(t => Math.abs(z - t) < 1e-6);
      const faces = [];
      for (const id of [...m.faces.keys()]) {
        if (before.has(id)) continue;
        const f = m.faces.get(id);
        if (!f || f.userData) continue;
        faces.push(id);
        const c = m.faceCentroid(f);
        f.userData = {
          bimEntityId: ent.id, bimType: ent.type,
          role: onPlane(c.z, tops) ? 'top' : onPlane(c.z, bottoms) ? 'bottom' : 'edge',
        };
      }
      if (!faces.length) throw new Error('floor rebuild produced no faces');
      ent.faces = faces;
      ent.edges = [];
      for (const id of faces) {
        const f = m.faces.get(id);
        for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
          const e = m.findEdge(r[i], r[(i + 1) % r.length]);
          if (e && !e.userData) {
            e.userData = { bimEntityId: ent.id, bimType: ent.type, role: 'profile' };
            ent.edges.push(e.id);
          }
        }
      }
      return true;
    } finally {
      m.bimHold = false;
    }
  }

  // ------------------------------------------------------- regeneration
  // Rebuild a committed stair from (patched) params AND re-cut its host:
  // old geometry and old hole go first, then the new opening + floor rebuild
  // + new flight, one sweep. Runs inside the caller's transaction; throws on
  // failure so the transaction rolls the model back intact.
  function rebuildStairEntity(app, entId, patch = {}) {
    const m = app.model;
    const ent = app.bim.getEntityById(entId);
    if (!ent || ent.type !== 'stairs') throw new Error('not a stair');
    const params = { ...ent.params, ...patch };
    // levels stay the truth of the story (a level edit follows through)
    const lm = app.levelManager;
    const zTop = params.topLevel != null && lm ? lm.getElevation(params.topLevel)
      : params.base[2] + num(params.storyH, 3);
    const zBase = params.baseLevel != null && lm ? lm.getElevation(params.baseLevel)
      : params.base[2];
    params.storyH = Math.max(0.1, zTop - zBase);
    params.base = [params.base[0], params.base[1], zBase];
    const host = params.hostFloorId ? app.bim.getEntityById(params.hostFloorId) : null;
    if (!host) throw new Error('the host floor is gone — delete and re-place the stair');
    m.beginEdgeSweep();
    m.bimHold = true;
    try {
      // phase 1 — out with the old: stair geometry first, then its hole
      for (const fid of [...ent.faces]) m.faces.delete(fid);
      for (const eid of [...ent.edges]) m.edges.delete(eid);
      m.gc();
      for (const f2 of m.faces.values()) {
        m.edgesForRing(f2.loop, true);
        for (const h of (f2.holes || [])) m.edgesForRing(h, true);
      }
      if (ent.params.opening && Array.isArray(ent.params.opening.ring))
        removeHostHole(app, host, ent.params.opening.ring);
      // phase 2 — re-cut the host with the NEW footprint, rebuild the floor,
      // then grow the new flight into the fresh opening
      const plan = planStair(params);
      const ring = plan.footprint.map(p => G.v(p.x, p.y, zTop));
      addHostHole(app, host, ring);
      rebuildFloorWithHoles(app, host.id);
      const built = buildStair(G, m, params);
      if (built.error || !built.faces.length) throw new Error(built.error || 'stair rebuild failed');
      // phase 3 — re-register the entity with its new geometry + opening
      params.nRisers = built.info.nRisers;
      params.riserActual = built.info.riser;
      params.opening = { hostId: host.id, ring: ring.map(p => [p.x, p.y, p.z]) };
      ent.params = params;
      ent.faces = built.faces.map(f => f.id);
      ent.edges = [...built.edges];
      for (const fid of ent.faces) {
        const f = m.faces.get(fid);
        if (f) f.userData = { bimEntityId: ent.id, bimType: 'stairs', role: built.roles[fid] || 'side' };
      }
      for (const eid of ent.edges) {
        const e = m.edges.get(eid);
        if (e && !e.userData) e.userData = { bimEntityId: ent.id, bimType: 'stairs', role: 'profile' };
      }
      return { warnings: built.warnings, info: built.info };
    } finally {
      m.bimHold = false;
      m.endEdgeSweep();
    }
  }

  // --------------------------------------------------------------- the tool
  // Two-click hosted placement: click the arrival floor/slab (object pick),
  // then drag/click the run direction. The stair rises the full story below
  // the host level; the opening is cut in the host at commit.
  class StairTool extends Tool {
    static id = 'stairs';
    activate() {
      this.host = null;   // { ent, zTop, zBase, storyH, topLevelId, baseLevelId }
      this.base = null;   // {x, y} plan anchor (stair start on the lower level)
      this.dir = null;    // {x, y} unit run direction
      this._lastEv = null;
      this._refusal = null;
      this.status();
    }
    get hint() {
      const s = this.state || {};
      if (!this.host)
        return `Stairs (${s.run === 'u' ? 'Dog-Leg U' : 'Straight Run'}): click the floor or slab the stair arrives at — the app cuts the opening in it and the flight rises the story from the level below. Width, riser and tread on the Options Bar; types in the Element Browser.`;
      return `Stairs: drag to set the run direction, click to place — ${(num(s.width, 1.2)).toFixed(2)} m flight, ${s.run === 'u' ? 'dog-leg with landing' : 'straight run'}. Esc restarts.`;
    }
    // the host floor under the cursor (object pick: only BIM elements)
    _hostAt(ev) {
      const app = this.app;
      if (!app.view.pickElementAt) { this._refusal = 'element picking unavailable'; return null; }
      const ep = app.view.pickElementAt(app.view.eventPt(ev));
      if (!ep) { this._refusal = 'no element under the cursor — click a floor or slab'; return null; }
      const ent = app.bim.getEntityById(ep.entityId);
      if (!ent || (ent.type !== 'floor' && ent.type !== 'slab')) {
        this._refusal = `that is a ${ent ? ent.type : 'element'} — stairs host on floors and slabs`;
        return null;
      }
      if (!Array.isArray(ent.params && ent.params.regions) || !ent.params.regions.length) {
        this._refusal = 'that floor has no sketch regions to cut';
        return null;
      }
      this._refusal = null;
      return ent;
    }
    // the story the stair rises: from the level below the host's level up to
    // the host's plane (slabs hang DOWN from their level — its top IS the
    // level plane the stair arrives at). Without a lower level the options
    // bar's Unconnected Height stands in.
    _levelsFor(host) {
      const app = this.app, lm = app.levelManager;
      const topId = host.params.baseLevel || host.params.levelId || null;
      const zTop = topId != null && lm ? lm.getElevation(topId)
        : num(host.params.regions[0].outer[0] && host.params.regions[0].outer[0][2], 0);
      const below = ((lm && lm.levels) || [])
        .filter(l => l.elevation < zTop - 1e-6)
        .sort((a, b) => b.elevation - a.elevation)[0] || null;
      if (below)
        return { topLevelId: topId, baseLevelId: below.id, zTop, zBase: below.elevation, storyH: zTop - below.elevation };
      const h = Math.max(0.5, num(app.bimOptions && app.bimOptions.unconnectedHeight, 3));
      return { topLevelId: topId, baseLevelId: null, zTop, zBase: zTop - h, storyH: h };
    }
    // the placement params the preview and the commit share
    _params() {
      const s = this.state || {};
      return {
        run: s.run === 'u' ? 'u' : 'straight',
        width: Math.max(0.4, num(s.width, 1.2)),
        riser: Math.max(0.1, num(s.riser, 0.175)),
        tread: Math.max(0.05, num(s.tread, 0.28)),
        uGap: Math.max(0, num(s.uGap, 0.1)),
        landingDepth: s.landingDepth > 0 ? +s.landingDepth : undefined,
        handrail: s.handrail !== false,
        railHeight: Math.max(0.6, num(s.railHeight, 0.9)),
        storyH: this.host.storyH,
        base: [this.base.x, this.base.y, this.host.zBase],
        dir: [this.dir.x, this.dir.y],
      };
    }
    _setDir(p) {
      const dx = p.x - this.base.x, dy = p.y - this.base.y;
      const l = Math.hypot(dx, dy);
      if (l > 0.05) this.dir = { x: dx / l, y: dy / l };
    }
    onMove(ev) {
      this._lastEv = ev;
      const app = this.app, view = app.view;
      view.clearPreview();
      if (!this.host) {
        const ent = this._hostAt(ev);
        if (!ent) {
          const q = view.eventPt(ev);
          view.hudLabel(q.x, q.y - 18, '⛔  ' + this._refusal, '#b91c1c');
          view.setHoverFace(null);
          return;
        }
        const ep = view.pickElementAt(view.eventPt(ev));
        view.setHoverFace(ep && ep.faceId != null ? ep.faceId : null);
        return;
      }
      view.setHoverFace(null);
      this._setDir(app.inferPoint(ev, null).p);
      this._preview();
    }
    _preview() {
      const app = this.app, view = app.view;
      const plan = planStair(this._params());
      const zTop = this.host.zTop, zBase = this.host.zBase;
      // the opening ghost on the host plane + the footprint on the departure
      // plane, tied at the corners — the exact rectangle the commit will cut
      const ring = plan.footprint.map(p => G.v(p.x, p.y, zTop));
      const ring0 = plan.footprint.map(p => G.v(p.x, p.y, zBase));
      view.previewFill([{ outer: ring }], OPENING, 0.18);
      view.previewLoop(ring, OPENING);
      view.previewLoop(ring0, PREVIEW);
      for (let i = 0; i < 4; i++) view.previewLine([ring[i], ring0[i]], PREVIEW);
      // the tread nosing fan — every step at its walking height
      for (const t of plan.treads) view.previewLine([t.a, t.b], PREVIEW);
      const cx = (ring[0].x + ring[2].x) / 2, cy = (ring[0].y + ring[2].y) / 2;
      view.stickyLabel(G.v(cx, cy, zTop),
        `${plan.nRisers}R × ${(plan.riser * 1000).toFixed(0)} mm riser · ${(plan.tread * 1000).toFixed(0)} mm tread · opening ${fmtLen(plan.overallWidth)} × ${fmtLen(plan.runLength)}`,
        plan.warnings.length ? '#b45309' : '#0a5f61', 0, -14);
      if (plan.warnings.length)
        view.stickyLabel(G.v(cx, cy, zTop), '⚠ ' + plan.warnings.join(' · '), '#b45309', 0, -34);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app, view = app.view;
      if (!this.host) {
        const ent = this._hostAt(ev);
        if (!ent) { app.toast(this._refusal || 'Click a floor or slab to host the stair', true); return; }
        const lv = this._levelsFor(ent);
        const p = app.inferPoint(ev, null).p;
        this.host = { ent, ...lv };
        this.base = { x: p.x, y: p.y };
        this.dir = { x: 1, y: 0 };
        view.setHoverFace(null);
        view.clearPreview();
        const from = lv.baseLevelId && app.levelManager.getLevel(lv.baseLevelId);
        const to = lv.topLevelId && app.levelManager.getLevel(lv.topLevelId);
        app.setStatus(`Host: ${ent.id} — the opening will be cut in it; the flight rises ${fmtLen(lv.storyH)} from ${from ? from.name : 'below'} to ${to ? to.name : 'the host plane'}. Drag the run direction, click to place (Esc restarts).`);
        return;
      }
      this._setDir(app.inferPoint(ev, null).p);
      this._commit();
    }
    onKey(ev) {
      if ((ev.key || '').toLowerCase() === 'escape' && this.host) {
        this.host = null; this.base = null; this.dir = null;
        this.app.view.clearPreview();
        this.status();
        this.app.toast('Stair placement reset — click a floor to start again');
        return true;
      }
      return false;
    }
    onVCB() { return false; }
    _commit() {
      const app = this.app, m = app.model;
      const host = this.host;
      const params = this._params();
      let ent = null, plan = null, holeRing = null, regionIdx = -1;
      app.transaction.run('stairs', mm => {
        mm.beginEdgeSweep();
        mm.bimHold = true;
        try {
          // 1) the host opening: params hole first, geometry rebuilt from it
          plan = planStair(params);
          holeRing = plan.footprint.map(p => G.v(p.x, p.y, host.zTop));
          regionIdx = addHostHole(app, host.ent, holeRing);   // throws when it doesn't fit
          rebuildFloorWithHoles(app, host.ent.id);            // throws on degenerate rebuild
          // 2) the stair solid, grown into the fresh opening
          const built = buildStair(G, mm, params);
          if (built.error || !built.faces.length) throw new Error(built.error || 'stair build failed');
          // 3) register — the opening ring rides in params so regeneration
          //    can find and re-cut exactly this hole
          const full = {
            ...params,
            hostFloorId: host.ent.id,
            baseLevel: host.baseLevelId,  // LevelManager.usage key (null when the host is the lowest level)
            topLevel: host.topLevelId,
            nRisers: built.info.nRisers,
            riserActual: built.info.riser,
            opening: { hostId: host.ent.id, ring: holeRing.map(p => [p.x, p.y, p.z]) },
            source: 'tool',
          };
          ent = app.bim.create('stairs', full, built.roles, built.edges);
        } finally {
          mm.bimHold = false;
          mm.endEdgeSweep();
        }
      });
      if (!ent) return; // the transaction toasted + rolled back
      if (app.syncStructuralWalls) app.syncStructuralWalls(); // walls under the host re-fit
      if (app.syncDropPanels) app.syncDropPanels();           // drop heads re-hang
      app.view.clearPreview();
      const warn = plan.warnings.length ? ' — ⚠ ' + plan.warnings.join('; ') : '';
      app.toast(`Stairs ${ent.id} installed on ${host.ent.id} — ${plan.nRisers} risers × ${(plan.riser * 1000).toFixed(0)} mm, tread ${(plan.tread * 1000).toFixed(0)} mm · opening ${fmtLen(plan.overallWidth)} × ${fmtLen(plan.runLength)} cut in region ${regionIdx + 1}${warn}`);
      this.activate(); // re-arm for the next stair
    }
  }

  // ------------------------------------------- app integration (no core edits)
  // Entity Info's type dropdown funnels through app.applyElementType — wrap
  // it once (Engine 'ready') so a stair type change regenerates the flight
  // and re-cuts its host instead of falling to "applies to new placements".
  function hookApp(app) {
    if (!app || app._stairsHooked || typeof app.applyElementType !== 'function') return;
    app._stairsHooked = true;
    const orig = app.applyElementType;
    app.applyElementType = function (ent, typeRec) {
      if (ent && ent.type === 'stairs' && typeRec && typeRec.defaultParameters) {
        const p = typeRec.defaultParameters;
        const patch = {};
        if (p.run === 'straight' || p.run === 'u') patch.run = p.run;
        if (p.width > 0) patch.width = p.width;
        if (p.riser > 0) patch.riser = p.riser;
        if (p.tread > 0) patch.tread = p.tread;
        if (p.uGap > 0) patch.uGap = p.uGap;
        const res = app.transaction.run('edit stairs', () => rebuildStairEntity(app, ent.id, patch));
        if (res) {
          app.selectElement(ent.id); // keep it selected across the rebuild
          app.updateInfo();
          if (app.elements && app.elements.refreshTypeFor) app.elements.refreshTypeFor(ent).catch(() => { });
          app.toast(`Stairs type: ${typeRec.name} — geometry and host opening re-cut`
            + (res.warnings && res.warnings.length ? ' (⚠ ' + res.warnings.join('; ') + ')' : ''));
        }
        return;
      }
      return orig.apply(this, arguments);
    };
  }

  if (window.Engine) {
    Engine.events.on('ready', () => hookApp(Engine.app));
    if (window.app) hookApp(window.app);
    Engine.features.register({
      id: 'stairs',
      kind: 'tool',
      label: 'Stairs',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 20h4v-4h4v-4h4V8h4V4h2"/></svg>',
      key: 'S',
      mode: 'bim',
      commands: ['stair', 'stairs'],
      options: [
        { key: 'run', type: 'select', label: 'Run', choices: [{ value: 'straight', label: 'Straight Flight' }, { value: 'u', label: 'Dog-Leg (U)' }] },
        { key: 'width', type: 'number', label: 'Width', step: 0.05, default: 1.2 },
        { key: 'riser', type: 'number', label: 'Riser', step: 0.005, default: 0.175 },
        { key: 'tread', type: 'number', label: 'Tread', step: 0.01, default: 0.28 },
        { key: 'uGap', type: 'number', label: 'U Gap', step: 0.05, default: 0.1 },
        { key: 'landingDepth', type: 'number', label: 'Landing', step: 0.05, default: 1.2 },
        { key: 'railHeight', type: 'number', label: 'Rail H', step: 0.05, default: 0.9 },
        { key: 'handrail', type: 'checkbox', label: 'Handrail', default: true },
      ],
      tool: StairTool,
      state: { run: 'straight', width: 1.2, riser: 0.175, tread: 0.28, uGap: 0.1, landingDepth: 1.2, railHeight: 0.9, handrail: true },
      onOption() {
        // live ghost follows the typed size / run type
        const t = window.app && window.app.tool;
        if (t && t.id === 'stairs' && t._lastEv) t.onMove(t._lastEv);
      },
    });
  }

  window.StairsFeature = {
    StairTool, stairMath, planStair, buildStair,
    addHostHole, removeHostHole, rebuildFloorWithHoles, rebuildStairEntity,
  };
})();
