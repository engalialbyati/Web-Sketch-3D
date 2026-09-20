'use strict';
// ---------------------------------------------------------------------------
// features/room.js — Phase 2: rooms, areas & schedules (IfcSpace tier).
//
// A room is a PARAMETRIC NON-STRUCTURAL element: its boundary is DETECTED
// from the wall centerlines on its level (a planar segment arrangement —
// click inside an enclosed region and the enclosing cycle becomes the room
// ring), and its geometry is a thin "color-fill plate" face 2 mm above the
// level plane: selectable, tinted by the color-fill scheme, and measurable.
//
//   RoomFeature.detect(app, levelId, x, y) → { ring, area, perimeter } | { error }
//   RoomFeature.makeRoom(app, opts)        → entity | null   (seed OR ring)
//   RoomFeature.rebuildRoom(app, ent)      → true on success (walls moved →
//                                            re-detect from the stored seed)
//   RoomFeature.recolorAll(app, scheme)    — 'department' | 'name' | 'number'
//
// The tool: arm Room, hover — the enclosing region fills live — click to
// place. Boundaries are wall CENTERLINES (Revit's centerline convention).
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;

  // ------------------------------------------------------ planar arrangement
  // segments [[x1,y1],[x2,y2]], ... → bounded faces (CCW rings). Splits at
  // crossings, welds nodes on a 1 mm grid, then traces faces with the
  // next-edge = largest-clockwise-angle-from-incoming rule (faces come out
  // CCW = positive area; the unbounded face winds negative and is dropped).
  function facesOf(segments) {
    const S = segments.filter(s => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > 1e-6);
    if (S.length < 2) return [];
    // interior crossing params per segment
    const cuts = S.map(() => []);
    const segInt = (a, b) => {
      const d1 = [a[1][0] - a[0][0], a[1][1] - a[0][1]];
      const d2 = [b[1][0] - b[0][0], b[1][1] - b[0][1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-12) return null;
      const w = [b[0][0] - a[0][0], b[0][1] - a[0][1]];
      const t = (w[0] * d2[1] - w[1] * d2[0]) / den;
      const u = (w[0] * d1[1] - w[1] * d1[0]) / den;
      if (t <= 1e-4 || t >= 1 - 1e-4 || u <= 1e-4 || u >= 1 - 1e-4) return null;
      return [t, u, [a[0][0] + d1[0] * t, a[0][1] + d1[1] * t]];
    };
    for (let i = 0; i < S.length; i++) {
      const bi = [Math.min(S[i][0][0], S[i][1][0]) - 1e-9, Math.min(S[i][0][1], S[i][1][1]) - 1e-9,
        Math.max(S[i][0][0], S[i][1][0]) + 1e-9, Math.max(S[i][0][1], S[i][1][1]) + 1e-9];
      for (let j = i + 1; j < S.length; j++) {
        const b = S[j];
        if (b[0][0] < bi[0] && b[1][0] < bi[0]) continue;
        if (b[0][0] > bi[2] && b[1][0] > bi[2]) continue;
        if (b[0][1] < bi[1] && b[1][1] < bi[1]) continue;
        if (b[0][1] > bi[3] && b[1][1] > bi[3]) continue;
        const hit = segInt(S[i], b);
        if (hit) { cuts[i].push([hit[0], hit[2]]); cuts[j].push([hit[1], hit[2]]); }
      }
    }
    // T-JUNCTIONS: a wall whose ENDPOINT lands strictly inside another wall
    // (an interior partition meeting the facade) must split that wall there
    for (let i = 0; i < S.length; i++) {
      const d = [S[i][1][0] - S[i][0][0], S[i][1][1] - S[i][0][1]];
      const L2 = d[0] * d[0] + d[1] * d[1];
      if (L2 < 1e-12) continue;
      for (let j = 0; j < S.length; j++) {
        if (j === i) continue;
        for (const p of S[j]) {
          const w = [p[0] - S[i][0][0], p[1] - S[i][0][1]];
          const t = (w[0] * d[0] + w[1] * d[1]) / L2;
          if (t <= 1e-4 || t >= 1 - 1e-4) continue;
          const perp = Math.abs(w[0] * d[1] - w[1] * d[0]) / Math.sqrt(L2);
          if (perp < 1e-3 && !cuts[i].some(c => Math.abs(c[0] - t) < 1e-6)) cuts[i].push([t, [p[0], p[1]]]);
        }
      }
    }
    // weld nodes (1 mm grid) and subdivide
    const nodes = [];
    const nodeOf = new Map();
    const nid = p => {
      const k = Math.round(p[0] * 1000) + '|' + Math.round(p[1] * 1000);
      let id = nodeOf.get(k);
      if (id == null) { id = nodes.length; nodes.push([+p[0].toFixed(6), +p[1].toFixed(6)]); nodeOf.set(k, id); }
      return id;
    };
    const edges = [];
    for (let i = 0; i < S.length; i++) {
      const pts = [[0, S[i][0]], ...cuts[i].sort((a, b) => a[0] - b[0]), [1, S[i][1]]];
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = nid(pts[k][1]), b = nid(pts[k + 1][1]);
        if (a !== b) edges.push([a, b]);
      }
    }
    if (!edges.length) return [];
    // adjacency: each undirected edge contributes BOTH directed half-edges —
    // faces traverse either direction
    const adj = new Map();
    for (const [a, b] of edges) {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    }
    const ang = (from, to) => Math.atan2(nodes[to][1] - nodes[from][1], nodes[to][0] - nodes[from][0]);
    const norm2pi = d => { while (d < 0) d += Math.PI * 2; while (d >= Math.PI * 2) d -= Math.PI * 2; return d; };
    const used = new Set(); // "a>b"
    const faces = [];
    const walk = (a, b) => {
      let key = a + '>' + b;
      if (used.has(key)) return;
      const ring = [a];
      let u = a, v = b, guard = 0;
      let ok = true;
      while (guard++ < 4096) {
        used.add(u + '>' + v);
        ring.push(v);
        const outs = adj.get(v) || [];
        if (!outs.length) { ok = false; break; }
        // DCEL next-edge: the outgoing edge FIRST encountered rotating
        // CLOCKWISE from the reverse direction (v→u) — traces every face
        // consistently; bounded faces come out CCW (positive area)
        const revAng = ang(v, u);
        let best = null, bestC = Infinity;
        for (const w of outs) {
          if (w === u && outs.length > 1) continue;
          const c = norm2pi(revAng - ang(v, w));
          if (c > 1e-12 && c < bestC - 1e-12) { bestC = c; best = w; }
        }
        if (best == null && outs.includes(u)) best = u; // dangling end: bounce
        if (best == null) { ok = false; break; }
        u = v; v = best;
        if (v === ring[0]) { used.add(u + '>' + v); break; } // closed — mark the closing edge too
        if (ring.includes(v)) { ok = false; break; } // figure-8 guard
      }
      if (!ok || v !== ring[0] || ring.length < 3) return;
      // ring holds each vertex exactly once (the walk breaks BEFORE pushing
      // the repeated start) — no trailing duplicate to pop
      const pts = ring.map(n => nodes[n]);
      let area2 = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        area2 += p[0] * q[1] - q[0] * p[1];
      }
      if (area2 <= 1e-6) return; // CW = the unbounded (outer) face
      faces.push(pts);
    };
    for (const [a, b] of edges) { walk(a, b); walk(b, a); }
    // de-duplicate: the same ring can be walked from different starting
    // half-edges at shared junction nodes (sorted vertex key)
    const seen = new Set();
    return faces.filter(f => {
      const key = f.map(p => p[0].toFixed(4) + ',' + p[1].toFixed(4)).sort().join(';');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const pointIn = (ring, x, y) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (((a[1] > y) !== (b[1] > y)) && (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
    }
    return inside;
  };
  const ringArea = ring => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      s += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(s) / 2;
  };
  const ringPerimeter = ring => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      s += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    return s;
  };

  // ------------------------------------------------- wall segments per level
  // signature-cached: the arrangement rebuilds only when walls change
  let _cache = { sig: null, levelId: null, faces: [] };
  function levelFaces(app, levelId) {
    const walls = app.bim.entities.filter(e => {
      if (e.type !== 'wall') return false;
      const p = e.params || {};
      const lid = p.baseLevel || p.baseLevelId || p.levelId;
      return lid === levelId || (lid == null && true);
    });
    const sig = walls.map(w => {
      const p = w.params || {};
      if (p.base && p.end && !p.closed) return p.base[0].toFixed(3) + ',' + p.base[1].toFixed(3) + ';' + p.end[0].toFixed(3) + ',' + p.end[1].toFixed(3);
      if (p.footprint) return p.footprint.map(q => q[0].toFixed(3) + ',' + q[1].toFixed(3)).join(';');
      return '';
    }).join('|') + '#' + app.bim.entities.length;
    if (_cache.sig === sig && _cache.levelId === levelId) return _cache.faces;
    const segs = [];
    for (const w of walls) {
      const p = w.params || {};
      if (p.base && p.end && !p.closed) segs.push([[p.base[0], p.base[1]], [p.end[0], p.end[1]]]);
      else if (p.footprint && p.footprint.length >= 3)
        for (let i = 0; i < p.footprint.length; i++)
          segs.push([[p.footprint[i][0], p.footprint[i][1]],
            [p.footprint[(i + 1) % p.footprint.length][0], p.footprint[(i + 1) % p.footprint.length][1]]]);
    }
    const faces = facesOf(segs);
    _cache = { sig, levelId, faces };
    return faces;
  }

  /** The enclosed region containing (x,y) on a level. */
  function detect(app, levelId, x, y) {
    const faces = levelFaces(app, levelId);
    for (const ring of faces) {
      if (!pointIn(ring, x, y)) continue;
      const area = ringArea(ring);
      if (area < 0.2 || area > 20000) continue; // sanity: not a sliver, not the site
      return { ring, area: +area.toFixed(3), perimeter: +ringPerimeter(ring).toFixed(3) };
    }
    return { error: 'not an enclosed region — complete the walls around this point first' };
  }

  // ------------------------------------------------------------- color fill
  // pastel palette; a stable hash picks the swatch per scheme value
  const PALETTE = ['#e8b4ad', '#e8cd8f', '#cfe3a2', '#a8d8c8', '#a8c8e0', '#c3b2d8',
    '#e0b7d4', '#d8c8a8', '#b0d0a8', '#f0c8a0', '#a0c0d0', '#d0b8c0'];
  function colorFor(value) {
    const s = String(value || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function roomColor(ent) {
    const p = ent.params || {};
    const scheme = p.colorScheme || 'department';
    const key = scheme === 'name' ? (p.name || ent.id)
      : scheme === 'number' ? (p.number || ent.id)
        : (p.department || 'None');
    return colorFor(scheme === 'department' ? (p.department || 'None') : key);
  }
  function recolorFace(app, ent) {
    const m = app.model;
    for (const fid of ent.faces || []) {
      const f = m.faces.get(fid);
      if (f) { f.color = roomColor(ent); f.alpha = 0.55; }
    }
    m.touch();
  }
  function recolorAll(app) {
    let n = 0;
    for (const ent of app.bim.entities) {
      if (ent.type !== 'room') continue;
      recolorFace(app, ent);
      n++;
    }
    if (app.view) app.view.invalidate();
    return n;
  }

  // ------------------------------------------------------------ room making
  const nextNumber = app => {
    let n = 1;
    const taken = new Set(app.bim.entities.filter(e => e.type === 'room').map(e => e.params && e.params.number));
    while (taken.has(String(n))) n++;
    return String(n);
  };

  function makeRoom(app, opts) {
    const m = app.model;
    const levelId = opts.levelId || app.bimOptions.baseLevel;
    const lvl = app.levelManager.levels.find(l => l.id === levelId);
    if (!lvl) return { error: 'no level' };
    let ring = opts.ring, area, perim;
    if (!ring) {
      const d = detect(app, levelId, opts.seed[0], opts.seed[1]);
      if (d.error) return d;
      ring = d.ring; area = d.area; perim = d.perimeter;
    } else {
      area = +ringArea(ring).toFixed(3);
      perim = +ringPerimeter(ring).toFixed(3);
    }
    // refuse an exact duplicate (same level + seed inside an existing ring)
    if (!opts.ring) {
      for (const e of app.bim.entities) {
        if (e.type !== 'room' || (e.params.levelId || e.params.baseLevel) !== levelId) continue;
        if (e.params.boundary && pointIn(e.params.boundary, opts.seed[0], opts.seed[1]))
          return { error: 'a room already occupies this region' };
      }
    }
    const z = (+lvl.elevation || 0) + 0.002; // plate floats 2 mm above the finish floor
    let ent = null;
    app.transaction.run('room', mm => {
      const f = mm.addFaceFromRings(ring.map(q => G.v(q[0], q[1], z)));
      if (!f) throw new Error('room ring degenerate');
      const params = {
        source: opts.source || 'tool',
        seed: [opts.seed ? +opts.seed[0].toFixed(4) : +ring[0][0].toFixed(4),
               opts.seed ? +opts.seed[1].toFixed(4) : +ring[0][1].toFixed(4)],
        levelId, baseLevel: levelId,
        name: opts.name || ('Room ' + nextNumber(app)),
        number: opts.number || nextNumber(app),
        department: opts.department || '',
        zone: opts.zone || '',
        colorScheme: 'department',
        boundary: ring.map(q => [+q[0].toFixed(4), +q[1].toFixed(4)]),
        area, perimeter: perim,
      };
      if (opts.ifc) params.ifc = opts.ifc;
      const edges = [];
      for (const r of mm.rings(f)) for (let i = 0; i < r.length; i++) {
        const e = mm.findEdge(r[i], r[(i + 1) % r.length]);
        if (e) edges.push(e.id);
      }
      ent = app.bim.create('room', params, { [f.id]: 'plate' }, edges);
      const ff = mm.faces.get(f.id);
      if (ff) { ff.color = colorFor(params.department || 'None'); ff.alpha = 0.55; }
    });
    return ent || { error: 'room creation failed' };
  }

  // walls moved/deleted → re-detect from the stored seed (Revit's
  // "Rebuild"): the plate is replaced, params.area/perimeter refresh
  function rebuildRoom(app, ent) {
    const m = app.model;
    const p = ent.params || {};
    if (!p.seed) return false;
    const d = detect(app, p.levelId || p.baseLevel, p.seed[0], p.seed[1]);
    if (d.error) return false;
    let ok = false;
    app.transaction.run('rebuild room', mm => {
      mm.deleteFaces([...(ent.faces || [])].filter(fid => mm.faces.has(fid)));
      const lvl = app.levelManager.levels.find(l => l.id === (p.levelId || p.baseLevel));
      const z = ((lvl && lvl.elevation) || 0) + 0.002;
      const f = mm.addFaceFromRings(d.ring.map(q => G.v(q[0], q[1], z)));
      if (!f) throw new Error('room ring degenerate');
      f.userData = { bimEntityId: ent.id, bimType: 'room', role: 'plate' };
      ent.faces = [f.id];
      ent.edges = [];
      for (const r of mm.rings(f)) for (let i = 0; i < r.length; i++) {
        const e = mm.findEdge(r[i], r[(i + 1) % r.length]);
        if (e) {
          e.userData = { bimEntityId: ent.id, bimType: 'room', role: 'profile' };
          ent.edges.push(e.id);
        }
      }
      p.boundary = d.ring.map(q => [+q[0].toFixed(4), +q[1].toFixed(4)]);
      p.area = d.area;
      p.perimeter = d.perimeter;
      f.color = roomColor(ent);
      f.alpha = 0.55;
      ok = true;
    });
    return ok;
  }

  // ------------------------------------------------------------------- tool
  class RoomTool extends Tool {
    static id = 'room';
    activate() { this._lastEv = null; this.status(); }
    get hint() {
      return 'Room: hover an enclosed region on the active level — its boundary (wall centerlines) highlights with the live area — click to place. Draw the walls first; the properties panel renames/numbers rooms.';
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      this._lastEv = ev;
      view.clearPreview();
      const inf = app.inferPoint(ev, null);
      const lvlId = app.bimOptions.baseLevel;
      const d = detect(app, lvlId, inf.p.x, inf.p.y);
      if (d.error) {
        view.showSnapDot(null);
        showCursorCoords(view, view.toScreen(inf.p), inf, inf.p);
        return;
      }
      const lvl = app.levelManager.levels.find(l => l.id === lvlId);
      const z = ((lvl && lvl.elevation) || 0) + 0.002;
      const ring = d.ring.map(q => G.v(q[0], q[1], z));
      view.previewFill([{ outer: ring }], 0x3e9e66, 0.25);
      view.previewLoop(ring, 0x2e7d4f);
      const cx = d.ring.reduce((s, q) => s + q[0], 0) / d.ring.length;
      const cy = d.ring.reduce((s, q) => s + q[1], 0) / d.ring.length;
      view.stickyLabel(G.v(cx, cy, z + 0.6), `${d.area.toFixed(1)} m² · ${d.perimeter.toFixed(1)} m`, '#1d6f45', 0, -14);
      view.showSnapDot(null);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const inf = app.inferPoint(ev, null);
      const r = makeRoom(app, { seed: [inf.p.x, inf.p.y, inf.p.z], levelId: app.bimOptions.baseLevel });
      if (r && r.error) app.toast('Room: ' + r.error, true);
      else app.toast(`Room "${r.params.name}" — ${r.params.area.toFixed(1)} m² (color fill by department)`);
      app.view.clearPreview();
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB() { return false; }
  }

  window.RoomFeature = {
    RoomTool, detect, makeRoom, rebuildRoom, recolorAll, recolorFace,
    roomColor, colorFor, facesOf, pointIn, ringArea, ringPerimeter,
    _invalidateCache() { _cache.sig = null; },
  };

  if (window.Engine) Engine.features.register({
    id: 'room',
    kind: 'tool',
    label: 'Room',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 12h7M11 4v16" opacity=".7"/><path d="M15 15l2.5-2.5L20 15"/></svg>',
    key: '',
    mode: 'bim',
    commands: ['room', 'rooms'],
    options: [],
    tool: RoomTool,
    state: {},
  });
})();
