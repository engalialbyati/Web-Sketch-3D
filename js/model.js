'use strict';
// ---------------------------------------------------------------------------
// Boundary-representation model, SketchUp style.
//  - vertices: Map id -> {x,y,z}   (deduplicated)
//  - edges:    Map id -> {id,a,b,curveId}   straight segments; arcs/circles
//              are chains of segments sharing one curveId (curve metadata in curves)
//  - faces:    Map id -> {id, loop:[vid], holes:[[vid]], color, alpha, hidden,
//               extrude:{axis,anchor,anchorHoles,sides}|null}
// Every consecutive pair of a face ring is guaranteed to have an edge.
// ---------------------------------------------------------------------------
let __eid = 1;
const nid = () => __eid++;
// canonical key for the vertex pair of an edge (ids are numbers from nid())
const edgePairKey = (a, b) => a < b ? a + '|' + b : b + '|' + a;
// params must be deep-copied on every snapshot (they are mutated in place by
// type changes and parametric edits). structuredClone is 2-5x faster than
// the JSON round-trip and never was about parsing — fall back for old runtimes.
const _deepClone = (typeof structuredClone === 'function')
  ? structuredClone
  : (o) => JSON.parse(JSON.stringify(o));

class Model {
  constructor() {
    this.vertices = new Map();
    this.edges = new Map();
    // vertex-pair -> edge id. Kept in lockstep with this.edges by
    // _addEdge/_delEdge so findEdge is O(1) — without it every kernel op
    // (weld, ring, cap, side) scanned ALL edges and models went quadratic:
    // ~60 ms per pushPull by a few hundred faces, felt worst in scripted
    // elements whose ghost rebuilds run dozens of ops per drag.
    this._edgeIndex = new Map();
    this.faces = new Map();
    this.curves = new Map();
    this.groups = new Map();   // gid -> {id, name, solid}
    this.currentGid = 0;       // gid assigned to newly created geometry (group edit mode)
    this.levels = [            // vertical levels (BIM); survives undo/save/load
      { id: 'lvl_1', name: 'Level 1', elevation: 0.0 },
      { id: 'lvl_2', name: 'Level 2', elevation: 3.0 },
    ];
    this.grids = [];           // GridLine instances (GridLine.js) — the GridSystem;
                               // deep-copied through snapshots like levels
    this.bimEntities = [];     // [{id, type, params, faces, edges, layerId?}] — parametric registry
    // AutoCAD-style layers: every BIM entity belongs to exactly one; layer '0'
    // is the undeletable default. Entities carry `layerId` (unknown → '0');
    // new entities land on `currentLayerId`. Deep-copied through snapshots
    // like levels, so layers survive undo/autosave/file round-trips.
    this.layers = [{ id: '0', name: '0', color: null, visible: true, locked: false, lt: 0, lw: 0 }];
    this.currentLayerId = '0';
    // annotations (Phase 3): dims / tags / text notes / spot elevations —
    // world-anchored drawing entities on the HUD layer, NOT building fabric
    // (never intersect, export as IFC annotation later). Survives snapshots
    // like every other model state.
    this.annotations = [];
    // saved views (Phase 3.7): sections/elevations — camera + clip plane
    this.views = [];
    // transient: entity ids whose B-Rep was structurally edited (split,
    // punched, trimmed, pushed) since the last drain — the app layer detaches
    // them (plain B-Rep survives, parametric definition goes away)
    this.bimDirty = new Set();
    this._bimHoldDepth = 0;
    this._bimHoldEdges = null;
    this._bimOwner = null; // v0.6: named hold's owning entity id
    // preview builds (drag ghosts) set this: their geometry is deleted the
    // moment the preview refreshes, so intersecting it with the model is
    // wasted work — and it was the dominant cost of dragging scripted
    // elements around in anything but an empty project
    this.noAutoIntersect = false;
    // mutation counter — bumped by every choke point below (_addEdge,
    // _delEdge, setVertex, deleteFace, load) and by touch() for display-only
    // edits (paint, hide/soften) that mutate faces/edges in place. Consumers
    // (view.rebuild early-exit, no-op transaction detection) compare it to
    // skip work when nothing changed. NOT serialized: it is a change signal,
    // not model state.
    this.version = 0;
  }
  /** Manually signal a mutation for edits that bypass the choke points
   *  (face color/alpha, hidden flags, entity hide/lock, layer visibility). */
  touch() { this.version++; }
  // BIM operations bracket their mutations with bimHold = true/false (a
  // depth counter: nested holds release only when the outermost one ends).
  // On final release, edges BORN during the hold and attached to no face
  // are reaped: they are construction residue (temporary punch rings, join
  // rebuild leftovers), never user content — free-drawn lines are created
  // outside any hold, so they are untouched. Precise Drawing thus leaves
  // no stray wires behind, automatically.
  get bimHold() { return this._bimHoldDepth > 0; }
  /** v0.6: the OWNING entity id when a named hold is active ('wall_1'),
   *  null for an unnamed first build. Gates read this via bimOwner(). */
  bimOwner() {
    return this.bimHold ? (this._bimOwner || '__new__') : null;
  }
  set bimHold(v) {
    if (v) {
      if (this._bimHoldDepth++ === 0) {
        this._bimHoldEdges = new Set(this.edges.keys());
        this._bimOwner = (typeof v === 'string' && v) || null;
      }
    } else {
      if (this._bimHoldDepth > 0 && --this._bimHoldDepth === 0) {
        this._bimOwner = null;
        const born = this._bimHoldEdges;
        this._bimHoldEdges = null;
        if (born) {
          // v0.7 PERF: one-pass adjacency map (same as endEdgeSweep) — the
          // per-edge scan made releasing a long bulk hold quadratic
          const adj = new Map();
          for (const f of this.faces.values()) {
            for (const ring of this.rings(f)) {
              for (let i = 0; i < ring.length; i++) {
                const a = ring[i], b = ring[(i + 1) % ring.length];
                const k = a < b ? a + 'x' + b : b + 'x' + a;
                adj.set(k, (adj.get(k) || 0) + 1);
              }
            }
          }
          for (const id of [...this.edges.keys()]) {
            if (born.has(id)) continue;
            const e = this.edges.get(id);
            if (e) {
              const k = e.a < e.b ? e.a + 'x' + e.b : e.b + 'x' + e.a;
              if (!adj.get(k)) this._delEdge(id);
            }
          }
          this.gc();
        }
      } else if (this._bimHoldDepth < 0) this._bimHoldDepth = 0;
    }
  }
  // mark a stamped face's entity as broken by an edit below this layer
  _bimTouch(f) {
    if (this.bimHold) return; // BIM-originated edits (hosted cuts) keep entities
    if (f && f.userData && f.userData.bimEntityId) this.bimDirty.add(f.userData.bimEntityId);
  }
  // The horizontal standing surface at plan (x, y) on plane z: a face of a
  // floor/slab/roof (or free-mode geometry) the cursor can stand a column
  // on. Structural element faces (wall/column/beam/foundation — including
  // their TOPS) never capture the base: clicking a wall means "a column
  // here, from the floor".
  standingZAt(p) {
    for (const [, f] of this.faces) {
      const t = f.userData && f.userData.bimType;
      if (t === 'wall' || t === 'column' || t === 'beam' || t === 'foundation') continue;
      const pts = this.pts(f.loop);
      if (pts.length < 3) continue;
      let zmin = Infinity, zmax = -Infinity;
      for (const q of pts) { if (q.z < zmin) zmin = q.z; if (q.z > zmax) zmax = q.z; }
      if (zmax - zmin > 1e-6) continue;          // horizontal faces only
      if (Math.abs(zmin - p.z) > 1e-6) continue; // at the picked plane
      let inside = false;                        // plan point-in-polygon, ray cast
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > p.y) !== (b.y > p.y)
          && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (inside) return zmin;
    }
    return null;
  }
  vp(id) { return this.vertices.get(id); }
  pts(ids) { return ids.map(id => this.vp(id)); }
  rings(f) { return [f.loop, ...(f.holes || [])]; }

  // ------------------------------------------------------------ vertices/edges
  // B-rep invariant #1 — vertex deduplication (tolerance welding): points
  // closer than WELD_EPS share one vertex id, so geometry drawn next to
  // existing geometry connects instead of floating. Backed by a spatial hash
  // (quantized cells) so welds stay O(1); the hash is invalidated whenever a
  // vertex moves or the model is loaded.
  static WELD_EPS = 1e-4; // 0.1 mm

  // v0.6 ELEMENT INDEPENDENCE — the overlap tolerance between BIM elements.
  // Elements never cut each other; where one BEARS on another (wall under a
  // beam, column under a beam, drop head under a slab) the supporting
  // element extends ELEMENT_EPS INTO the supported one: faces never sit on a
  // shared plane (no z-fighting) and the joint reads solid at any zoom.
  // 0.1 mm — visually zero, far above float32 depth-buffer noise.
  static ELEMENT_EPS = 1e-4;

  // ---------------------------------------------------------------- linestyles
  // OpenCADStudio/.lin linetype families adapted to our meter-scale world:
  // the AutoCAD dash lengths (12.7 mm etc.) read invisible on buildings, so
  // the canonical 1× pattern is scaled to decimeters. idx 0 = Continuous.
  static LINETYPES = [
    { id: 0, name: 'Continuous', dash: 0, gap: 0 },
    { id: 1, name: 'Dashed', dash: 0.60, gap: 0.30 },
    { id: 2, name: 'Hidden', dash: 0.28, gap: 0.20 },
    { id: 3, name: 'Center', dash: 1.20, gap: 0.25 },
    { id: 4, name: 'Dotted', dash: 0.02, gap: 0.16 },
    { id: 5, name: 'Phantom', dash: 1.20, gap: 0.22 },
    { id: 6, name: 'DashDot', dash: 0.60, gap: 0.20 },
  ];
  // Lineweight menu (AutoCAD's mm list, trimmed to the architecturally used
  // steps); px = on-screen thickness the renderer draws (WebGL line width is
  // capped at 1 px, so heavier weights render through a clip-space ribbon).
  static LINEWEIGHTS = [
    { id: 0, mm: 0, name: 'Default', px: 1 },
    { id: 1, mm: 0.13, name: '0.13', px: 1 },
    { id: 2, mm: 0.25, name: '0.25', px: 1 },
    { id: 3, mm: 0.35, name: '0.35', px: 2 },
    { id: 4, mm: 0.50, name: '0.50', px: 2 },
    { id: 5, mm: 0.70, name: '0.70', px: 3 },
    { id: 6, mm: 1.00, name: '1.00', px: 4 },
  ];

  vertexAt(p) {
    const E = Model.WELD_EPS, CELL = E * 2;
    if (!this._vh) {
      this._vh = new Map(); // "cx|cy|cz" -> [vid, ...]
      for (const [id, v] of this.vertices) this._vhAdd(id, v, CELL);
    }
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = this._vh.get((cx + dx) + '|' + (cy + dy) + '|' + (cz + dz));
      if (!arr) continue;
      for (const id of arr) {
        const v = this.vertices.get(id);
        if (v && G.dist(v, p) < E) return id;
      }
    }
    const id = nid();
    this.vertices.set(id, G.clone(p));
    this._vhAdd(id, p, CELL);
    return id;
  }
  _vhAdd(id, v, cell) {
    const k = Math.floor(v.x / cell) + '|' + Math.floor(v.y / cell) + '|' + Math.floor(v.z / cell);
    let arr = this._vh.get(k);
    if (!arr) this._vh.set(k, arr = []);
    arr.push(id);
  }
  // drop a vertex from its cell — call BEFORE moving or deleting it. Moves
  // and gc stay incremental: invalidating the whole hash made the next
  // vertexAt rebuild it over every vertex, so push-happy code (extrudes,
  // scripted elements) went quadratic as the model grew.
  _vhRemove(id) {
    if (!this._vh) return;
    const v = this.vertices.get(id);
    if (!v) return;
    const cell = Model.WELD_EPS * 2;
    const k = Math.floor(v.x / cell) + '|' + Math.floor(v.y / cell) + '|' + Math.floor(v.z / cell);
    const arr = this._vh.get(k);
    if (!arr) return;
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    if (!arr.length) this._vh.delete(k);
  }
  invalidateVertexHash() { this._vh = null; }
  setVertex(vid, p) {
    this._vhRemove(vid);
    this.vertices.set(vid, p);
    this._vhAdd(vid, p, Model.WELD_EPS * 2);
    this.version++; // a move: cached triangulations/AABBs are stale
  }
  // fuse vertex `gone` onto `keep`: every edge referencing `gone` rewires to
  // `keep` (same edge ids, so external references stay valid); an edge that
  // collapses onto itself or duplicates an existing pair is dropped, and
  // face rings splice `gone` out. Callers move/accept the position first.
  mergeVertices(keep, gone) {
    if (keep === gone) return 0;
    let n = 0;
    for (const e of [...this.edges.values()]) {
      let a = e.a, b = e.b, hit = false;
      if (a === gone) { a = keep; hit = true; }
      if (b === gone) { b = keep; hit = true; }
      if (!hit) continue;
      this._delEdge(e.id);
      n++;
      if (a === b) continue; // collapsed to a point
      if (this.findEdge(a, b)) continue; // duplicate after the fuse — keep the twin
      this._addEdge({ ...e, a, b });
    }
    for (const f of this.faces.values()) for (const ring of this.rings(f)) {
      const i = ring.indexOf(gone);
      if (i >= 0) ring.splice(i, 1);
    }
    let orphan = true;
    for (const e of this.edges.values()) if (e.a === gone || e.b === gone) { orphan = false; break; }
    if (orphan) { this._vhRemove(gone); this.vertices.delete(gone); this.version++; }
    return n;
  }

  // B-rep invariant #2 — T-junction welding for drawn points: reuse a nearby
  // vertex, and if the point falls on an existing straight edge (strictly
  // between its endpoints), split that edge so every face loop chains through
  // the vertex. All face rings referencing the old edge are updated by
  // splitEdgeAt.
  weldVertex(p) {
    const se = this.snapEndpoint(p);
    if (se != null) return se; // existing vertex, or a fresh edge split
    return this.vertexAt(p);
  }
  // All edge mutations funnel through these two so the pair index can never
  // drift from the map. (load() rebuilds the index wholesale.)
  _addEdge(e) {
    this.edges.set(e.id, e);
    this._edgeIndex.set(edgePairKey(e.a, e.b), e.id);
    this.version++;
    return e;
  }
  _delEdge(id) {
    const e = this.edges.get(id);
    if (!e) return;
    this.edges.delete(id);
    this.version++;
    const k = edgePairKey(e.a, e.b);
    if (this._edgeIndex.get(k) === id) this._edgeIndex.delete(k);
  }
  findEdge(a, b) {
    const id = this._edgeIndex.get(edgePairKey(a, b));
    return id == null ? null : this.edges.get(id) || null;
  }
  edgeLength(e) { return G.dist(this.vp(e.a), this.vp(e.b)); }
  curveEdges(cid) {
    const out = [];
    for (const e of this.edges.values()) if (e.curveId === cid) out.push(e);
    return out;
  }
  curveOfEdge(e) { return e.curveId ? this.curves.get(e.curveId) : null; }

  splitEdgeAt(e, p) {
    if (!this.edges.has(e.id)) return null; // already replaced by an earlier split
    const m = this.vertexAt(p);
    if (m === e.a || m === e.b) return m;
    // reuse existing half-edges (e.g. the drawn face's ring already provides
    // one side of the split) so the vertex pair never gets a twin edge
    let e1 = this.findEdge(e.a, m);
    if (!e1) e1 = this._addEdge({ id: nid(), a: e.a, b: m, curveId: 0 });
    let e2 = this.findEdge(m, e.b);
    if (!e2) e2 = this._addEdge({ id: nid(), a: m, b: e.b, curveId: 0 });
    // a split drawn line stays drawn: the halves inherit deliberate, or the
    // next sweep reaps them as unattached construction residue
    const del = e.userData && e.userData.deliberate;
    if (del) {
      if (e1 !== e && !e1.userData) e1.userData = { deliberate: 1 };
      if (e2 !== e && !e2.userData) e2.userData = { deliberate: 1 };
    }
    if (e1.id !== e.id && e2.id !== e.id) this._delEdge(e.id);
    for (const f of this.faces.values()) for (const ring of this.rings(f)) {
      const L = ring, n = L.length;
      for (let i = 0; i < n; i++) {
        if ((L[i] === e.a && L[(i + 1) % n] === e.b) || (L[i] === e.b && L[(i + 1) % n] === e.a)) {
          if (!L.includes(m)) L.splice(i + 1, 0, m);
          break;
        }
      }
    }
    return m;
  }
  // If p lies on an existing straight edge, split that edge so p becomes a vertex.
  snapEndpoint(p) {
    for (const e of this.edges.values()) {
      if (e.curveId) continue;
      // BIM construction never welds onto a drawn wire: the element's ring
      // vertex stays its own, and the wire stays exactly as drawn (a wall
      // over a rectangle must not absorb its lines). Free-mode snapping
      // keeps the classic T-junction weld.
      if (this.bimHold && e.userData && e.userData.deliberate) continue;
      if (G.distToSeg(p, this.vp(e.a), this.vp(e.b)) < 1e-4) {
        if (G.dist(p, this.vp(e.a)) < G.VEPS) return e.a;
        if (G.dist(p, this.vp(e.b)) < G.VEPS) return e.b;
        return this.splitEdgeAt(e, p);
      }
    }
    return null;
  }

  // Proper crossing of two 3D segments, strictly interior to both; null for
  // parallel, skew, or merely touching segments.
  _segCross(p1, p2, p3, p4) {
    const d1 = G.sub(p2, p1), d2 = G.sub(p4, p3);
    const a = G.dot(d1, d1), b = G.dot(d1, d2), c = G.dot(d2, d2);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-12) return null; // parallel
    const w = G.sub(p3, p1);
    const d = G.dot(d1, w), e = G.dot(d2, w);
    const t = (c * d - b * e) / den;
    const s = (b * d - a * e) / den;
    if (t <= 1e-6 || t >= 1 - 1e-6 || s <= 1e-6 || s >= 1 - 1e-6) return null;
    const pa = G.add(p1, G.mul(d1, t)), pb = G.add(p3, G.mul(d2, s));
    if (G.dist(pa, pb) > 1e-5) return null; // skew lines never meet
    return { p: G.mul(G.add(pa, pb), 0.5), t };
  }

  addEdge(pa, pb) {
    this._deliberateNext = true;
    let e;
    try { e = this._addEdgePublic(pa, pb); }
    finally { this._deliberateNext = false; }
    if (e && !e.userData) e.userData = { deliberate: 1 }; // drawn geometry: sweeps never reap it
    return e;
  }
  // drawn-edge marker: addEdge/addPolyline set this so EVERY chain piece of
  // a drawn segment (split at crossings on the way in) stays deliberate —
  // only the last piece is returned, the rest must not become reap-bait
  _markPiecesDeliberate(e) {
    if (this._deliberateNext && e && !e.userData) e.userData = { deliberate: 1 };
  }
  _addEdgePublic(pa, pb) {    if (!pa || !pb || G.dist(pa, pb) < G.VEPS) return null;
    const sa = this.snapEndpoint(pa), sb = this.snapEndpoint(pb);
    const a = sa || this.vertexAt(pa), b = sb || this.vertexAt(pb);
    if (a === b) return null;
    const ex = this.findEdge(a, b); if (ex) return ex;
    // Planar auto-intersection: a new edge properly crossing an existing
    // straight edge splits BOTH at the shared point (which splitEdgeAt also
    // inserts into every face ring using the old edge), and an existing
    // vertex lying strictly inside the new segment chains through it. With no
    // crossing or T-junction left behind, face discovery works around crossed
    // geometry (e.g. a polygon drawn on the ground through a box footprint).
    // A segment crossing a face HOLE keeps the legacy refused behavior —
    // rearranging holed faces needs full 2D arrangement, out of scope here.
    const A = this.vp(a), B = this.vp(b);
    let crossesHole = false;
    for (const f2 of this.faces.values()) {
      for (const h of f2.holes) {
        for (let k = 0; k < h.length; k++) {
          if (this._segCross(A, B, this.vp(h[k]), this.vp(h[(k + 1) % h.length]))) { crossesHole = true; break; }
        }
        if (crossesHole) break;
      }
      if (crossesHole) break;
    }
    const events = []; // {t, m} — mutations deferred until we commit to the chain
    const hits = [];   // {t, e, p} — proper crossings with existing edges
    for (const e2 of [...this.edges.values()]) {
      if (e2.curveId || e2.a === a || e2.b === a || e2.a === b || e2.b === b) continue;
      const hit = this._segCross(A, B, this.vp(e2.a), this.vp(e2.b));
      if (hit) hits.push({ t: hit.t, e: e2, p: hit.p });
    }
    for (const [id, v] of this.vertices) {
      if (id === a || id === b) continue;
      if (G.distToSeg(v, A, B) < Model.WELD_EPS &&
        G.dist(v, A) > Model.WELD_EPS && G.dist(v, B) > Model.WELD_EPS) {
        events.push({ t: G.dot(G.sub(v, A), G.sub(B, A)), m: id, p3: G.clone(v) });
      }
    }
    if (hits.length && !crossesHole) {
      for (const h of hits) {
        // BIM construction never cuts drawn wires: a wall (or any element)
        // built over a rectangle/line leaves every drawn edge EXACTLY as
        // drawn — the band simply crosses the wire inside the solid. Free
        // mode keeps the classic behavior (two crossing lines share the
        // crossing vertex).
        if (this.bimHold && h.e.userData && h.e.userData.deliberate) continue;
        this.splitEdgeAt(h.e, h.p); // shared vertex lands in every ring using h.e
        events.push({ t: h.t, m: this.vertexAt(h.p), p3: h.p });
      }
    }
    if (events.length && !crossesHole) {
      const seen = new Set([a, b]);
      events.sort((x, y) => x.t - y.t);
      const chain = [a];
      const evPos = new Map(); // vid -> position (for mid-chain gc reaping)
      evPos.set(a, A); evPos.set(b, B); // endpoints are unreferenced until linked
      for (const ev of events) {
        if (seen.has(ev.m)) continue;
        seen.add(ev.m);
        evPos.set(ev.m, ev.p3);
        chain.push(ev.m);
      }
      chain.push(b);
      let last = null;
      for (let i = 0; i < chain.length - 1; i++) {
        if (chain[i] === chain[i + 1]) continue;
        // an earlier sub-edge's autoFace (-> punchOrSplit -> arrangement ->
        // gc) may reap an unreferenced chain vertex: re-materialize it first
        const revive = x => (this.vp(x) || evPos.has(x)) ? this.vp(x) ? x : this.vertexAt(evPos.get(x)) : null;
        chain[i] = revive(chain[i]);
        chain[i + 1] = revive(chain[i + 1]);
        if (chain[i] == null || chain[i + 1] == null || chain[i] === chain[i + 1]) continue;
        let e = this.findEdge(chain[i], chain[i + 1]);
        if (!e) {
          e = { id: nid(), a: chain[i], b: chain[i + 1], curveId: 0, gid: this.currentGid || 0 };
          this._addEdge(e);
          this._markPiecesDeliberate(e);
        }
        // a chain segment whose ends both sit on a crossed face's ring splits
        // that face along the chord (the footprint interior partition)
        this.splitFacesAt(chain[i], chain[i + 1]);
        // NO auto face from wires: free drawing produces wires only — faces
        // come from elements' explicit builds, or the user's Create Face
        // command on a selected closed loop (right-click)
        last = e;
      }
      return last;
    }
    const e = { id: nid(), a, b, curveId: 0, gid: this.currentGid || 0 };
    this._addEdge(e);
    this._markPiecesDeliberate(e);
    this.splitFacesAt(a, b);
    // no autoFace — free drawing never creates faces (see the chain branch)
    return e;
  }
  // Open or closed polyline; curveMeta groups segments into an arc/circle entity.
  addPolyline(pts, curveMeta = null) {
    const r = this._addPolylineInner(pts, curveMeta);
    if (r && r.edges) for (const e of r.edges) if (e && !e.userData) e.userData = { deliberate: 1 };
    return r;
  }
  _addPolylineInner(pts, curveMeta = null) {
    if (!pts || pts.length < 2) return null;
    let cid = 0;
    if (curveMeta) { cid = curveMeta.id = nid(); this.curves.set(cid, curveMeta); }
    const closed = G.dist(pts[0], pts[pts.length - 1]) < G.VEPS;
    const n = closed ? pts.length - 1 : pts.length;
    const vids = [];
    for (let i = 0; i < n; i++) vids.push(this.vertexAt(pts[i]));
    const edges = [];
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = vids[i], b = vids[(i + 1) % n];
      let e = this.findEdge(a, b);
      if (!e) e = this._addEdge({ id: nid(), a, b, curveId: cid, gid: this.currentGid || 0 });
      else if (cid && !e.curveId) e.curveId = cid;
      edges.push(e);
    }
    return { edges, vids, closed };
  }

  edgesForRing(vids, create = true) {
    const out = [];
    for (let i = 0; i < vids.length; i++) {
      const a = vids[i], b = vids[(i + 1) % vids.length];
      let e = this.findEdge(a, b);
      if (!e && create) {
        // B-rep invariant #2 (reverse direction): an existing vertex may sit
        // strictly on the new segment — chain the edge through it and splice
        // it into the ring so no T-junction is left behind
        const pa = this.vp(a), pb = this.vp(b);
        const between = [];
        for (const [id, v] of this.vertices) {
          if (id === a || id === b) continue;
          if (G.distToSeg(v, pa, pb) < Model.WELD_EPS &&
            G.dist(v, pa) > Model.WELD_EPS && G.dist(v, pb) > Model.WELD_EPS) between.push({ id, t: G.dot(G.sub(v, pa), G.sub(pb, pa)) });
        }
        if (between.length) {
          between.sort((x, y) => x.t - y.t);
          const chain = [a, ...between.map(x => x.id), b];
          for (let c = 0; c < chain.length - 1; c++) {
            let ce = this.findEdge(chain[c], chain[c + 1]);
            if (!ce) ce = this._addEdge({ id: nid(), a: chain[c], b: chain[c + 1], curveId: 0 });
            if (c === 0) e = ce;
          }
          vids.splice(i + 1, 0, ...between.map(x => x.id)); // ring follows the chain
          out.push(e);
          continue;
        }
        e = this._addEdge({ id: nid(), a, b, curveId: 0 });
      }
      out.push(e);
    }
    return out;
  }

  addFaceFromRings(outerPts, holePtsList = [], opts = {}) {
    if (outerPts.length < 3) return null;
    if (G.loopArea(outerPts) < 1e-10) return null;
    // STANDALONE (loose) face — Create Face's independence contract: fresh
    // unwelded copies of every vertex and a private edge set (one new chain
    // id per ring). The face shares NO topology with the wire it came from
    // or with a neighbor lying on the same curve: the source wire survives
    // for the next Create Face, and pushing, editing, or deleting one face
    // never reaches the other.
    if (opts.standalone) {
      const fresh = p => {
        const id = nid();
        this.vertices.set(id, G.clone(p));
        if (!this._vh) this._vh = new Map(); // keep the weld hash coherent
        this._vhAdd(id, this.vertices.get(id), Model.WELD_EPS * 2);
        return id;
      };
      const gid = opts.gid != null ? opts.gid : (this.currentGid || 0);
      const ring = outerPts.map(fresh);
      if (new Set(ring).size < 3) return null;
      const cid = nid();
      this.curves.set(cid, { type: 'polyline' });
      for (let i = 0; i < ring.length; i++)
        this._addEdge({ id: nid(), a: ring[i], b: ring[(i + 1) % ring.length], curveId: cid, gid });
      const holes = [];
      for (const h of holePtsList) {
        if (h.length < 3) continue;
        const hv = h.map(fresh);
        if (new Set(hv).size < 3) continue;
        const hcid = nid();
        this.curves.set(hcid, { type: 'polyline' });
        for (let i = 0; i < hv.length; i++)
          this._addEdge({ id: nid(), a: hv[i], b: hv[(i + 1) % hv.length], curveId: hcid, gid });
        holes.push(hv);
      }
      const f = {
        id: nid(), loop: ring, holes,
        color: opts.color || null,
        alpha: (opts.alpha == null ? 1 : opts.alpha),
        hidden: false, extrude: null, gid, loose: true,
      };
      this.faces.set(f.id, f);
      this.version++;
      return f;
    }
    const loop = outerPts.map(p => this.weldVertex(p)); // weld + split T-junctions
    if (new Set(loop).size < 3) return null;
    this.edgesForRing(loop, true);
    const holes = [];
    for (const h of holePtsList) {
      if (h.length < 3) continue;
      const hv = h.map(p => this.weldVertex(p));
      if (new Set(hv).size < 3) continue;
      this.edgesForRing(hv, true);
      holes.push(hv);
    }
    const f = {
      id: nid(), loop, holes,
      color: opts.color || null,
      alpha: (opts.alpha == null ? 1 : opts.alpha),
      hidden: false, extrude: null,
      gid: opts.gid != null ? opts.gid : (this.currentGid || 0),
    };
    this.faces.set(f.id, f);
    return f;
  }

  // ---------------------------------------------------------------- face healing
  // A new edge whose endpoints both lie on one face's boundary splits that face.
  // Works for wrap-around cuts (b before a in the ring), for faces with holes
  // (each hole follows the half that contains it; a cut grazing a hole is
  // refused), and for previously pushed faces (extrude state does not survive
  // a split — each half pushes fresh from its current position).
  // Face ids referenced by any pending extrude state (side walls, caps,
  // extended hosts). Replacing these breaks collapse/extend bookkeeping.
  protectedFaceIds() {
    const out = new Set();
    for (const f of this.faces.values()) {
      const E = f.extrude;
      if (!E) continue;
      (E.sides || []).forEach(id => out.add(id));
      if (E.cap) out.add(E.cap);
      (E.extended || []).forEach(x => out.add(x.fid));
    }
    return out;
  }

  splitFacesAt(a, b, skip = null) {
    for (const f of [...this.faces.values()]) {
      if (skip && skip(f)) continue;
      const L = f.loop;
      let i = L.indexOf(a), j = L.indexOf(b);
      if (i < 0 || j < 0) continue;
      if (i > j) { const t = i; i = j; j = t; } // wrap-around cut: slice(i, j+1) must not be empty
      const n = L.length;
      if ((i + 1) % n === j || (j + 1) % n === i) continue;
      const l1 = L.slice(i, j + 1);
      const l2 = L.slice(j).concat(L.slice(0, i + 1));
      if (l1.length < 3 || l2.length < 3) continue;
      // a cut passing through/near a hole would slice it: refuse this face
      if (f.holes.length) {
        const pa = this.vp(a), pb = this.vp(b);
        let grazes = false;
        for (const h of f.holes) {
          for (const v of h) if (G.distToSeg(this.vp(v), pa, pb) < 1e-5) { grazes = true; break; }
          if (grazes) break;
        }
        if (grazes) continue;
      }
      // only a face that REALLY divides is a broken parametric definition —
      // marking every iterated face detached entire BIM scenes on any edit
      this._bimTouch(f);
      this.edgesForRing(l1, true); this.edgesForRing(l2, true);
      let h1 = [], h2 = [];
      if (f.holes.length) {
        const nn = G.loopNormal(this.pts(L));
        const { u, v } = G.basisForNormal(nn);
        const o = this.vp(L[0]);
        const P1 = l1.map(id => G.to2D(this.vp(id), o, u, v));
        const inL1 = p => {
          let inside = false;
          for (let k = 0, mm = P1.length; k < mm; k++) {
            const A = P1[k], B = P1[(k + 1) % mm];
            if (((A.y > p.y) !== (B.y > p.y)) && (p.x < (B.x - A.x) * (p.y - A.y) / (B.y - A.y) + A.x)) inside = !inside;
          }
          return inside;
        };
        for (const h of f.holes) (inL1(G.to2D(this.vp(h[0]), o, u, v)) ? h1 : h2).push(h);
      }
      const f1 = { id: nid(), loop: l1, holes: h1, color: f.color, alpha: f.alpha, hidden: f.hidden, extrude: null, gid: f.gid || 0, userData: f.userData || null };
      const f2 = { id: nid(), loop: l2, holes: h2, color: f.color, alpha: f.alpha, hidden: f.hidden, extrude: null, gid: f.gid || 0, userData: f.userData || null };
      this.faces.delete(f.id);
      this.faces.set(f1.id, f1); this.faces.set(f2.id, f2);
      // a stamped face that divides hands its stamp to BOTH pieces and the
      // owning entity's face list follows — a wall sliced by a neighbor
      // stays selectable/parametric instead of silently losing its identity
      if (f.userData && f.userData.bimEntityId) {
        const ent = (this.bimEntities || []).find(x => x.id === f.userData.bimEntityId);
        if (ent) {
          const k = ent.faces.indexOf(f.id);
          if (k >= 0) ent.faces.splice(k, 1, f1.id, f2.id);
          else { ent.faces.push(f1.id, f2.id); }
        }
      }
      if (f.extrude) {
        const heir = G.loopArea(this.pts(l1)) >= G.loopArea(this.pts(l2)) ? f1 : f2;
        heir.extrude = f.extrude;
      }      // a pushed face that gets divided hands its extrude state to the larger
      // piece, so a sliced owner (a roof slab split by a post through it)
      // stays incrementally re-pushable instead of silently losing it


    }
  }

  // If a new edge closes a coplanar loop, create the face (SketchUp auto-facing).
  autoFace(e) {
    const pa = this.vp(e.a), pb = this.vp(e.b);
    const planes = new Map();
    const consider = p3 => {
      const pl = G.planeFromPoints(pa, pb, p3);
      if (pl) { const k = G.planeKey(pl); if (!planes.has(k)) planes.set(k, pl); }
    };
    for (const e2 of this.edges.values()) {
      if (e2.id === e.id) continue;
      if (e2.a === e.a || e2.b === e.a) consider(this.vp(e2.a === e.a ? e2.b : e2.a));
      else if (e2.a === e.b || e2.b === e.b) consider(this.vp(e2.a === e.b ? e2.b : e2.a));
    }
    let best = null;
    for (const pl of planes.values()) {
      const adj = new Map();
      const onPlaneEdges = [];
      for (const e2 of this.edges.values()) {
        const p1 = this.vp(e2.a), p2 = this.vp(e2.b);
        if (!G.planeHas(pl, p1) || !G.planeHas(pl, p2)) continue;
        onPlaneEdges.push(e2);
        if (!adj.has(e2.a)) adj.set(e2.a, []);
        if (!adj.has(e2.b)) adj.set(e2.b, []);
        adj.get(e2.a).push({ other: e2.b, e: e2.id });
        adj.get(e2.b).push({ other: e2.a, e: e2.id });
      }
      // a new edge crossing existing coplanar edges can't form a clean face
      let blocked = false;
      for (const e2 of onPlaneEdges) {
        if (e2.id === e.id || e2.a === e.a || e2.b === e.a || e2.a === e.b || e2.b === e.b) continue;
        if (G.segsIntersect(pa, pb, this.vp(e2.a), this.vp(e2.b), pl.n)) { blocked = true; break; }
      }
      if (blocked) continue;
      // BFS shortest path from b back to a, not using the new edge
      const prev = new Map();
      prev.set(e.b, null);
      const q = [e.b];
      let found = false;
      while (q.length && !found) {
        const cur = q.shift();
        for (const nx of (adj.get(cur) || [])) {
          if (nx.e === e.id) continue;
          if (prev.has(nx.other)) continue;
          prev.set(nx.other, { from: cur });
          if (nx.other === e.a) { found = true; break; }
          q.push(nx.other);
        }
      }
      if (!found) continue;
      // rebuild the path b -> ... -> a (BFS backtrack reverses it)
      const mid = [];
      let cur = e.a;
      while (true) {
        const p = prev.get(cur);
        if (!p || p.from === e.b) break;
        mid.push(p.from);
        cur = p.from;
      }
      const loop = [e.a, e.b, ...mid.reverse()];
      if (loop.length < 3 || new Set(loop).size !== loop.length) continue;
      if (G.loopArea(this.pts(loop)) < 1e-9) continue;
      let dup = false;
      for (const f of this.faces.values()) {
        const s = new Set(f.loop);
        if (s.size === loop.length && loop.every(v => s.has(v))) { dup = true; break; }
      }
      if (dup) continue;
      if (!best || loop.length < best.length) best = loop;
    }
    if (best) {
      this.edgesForRing(best, true);
      const fid = nid();
      const f = { id: fid, loop: best, holes: [], color: null, alpha: 1, hidden: false, extrude: null, gid: this.currentGid || 0 };
      this.faces.set(fid, f);
      this.punchOrSplit(f); // loop drawn on a face -> punch it out or split the host
      return f;
    }
    return null;
  }

  facesAdjacentToEdge(e) {
    const out = [];
    for (const f of this.faces.values()) {
      for (const ring of this.rings(f)) {
        const n = ring.length;
        let hit = false;
        for (let i = 0; i < n; i++) {
          if ((ring[i] === e.a && ring[(i + 1) % n] === e.b) ||
            (ring[i] === e.b && ring[(i + 1) % n] === e.a)) { hit = true; break; }
        }
        if (hit) { out.push(f); break; }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- deletion
  deleteEdgeIds(ids) {
    const full = new Set();
    for (const id of ids) {
      const e = this.edges.get(id); if (!e) continue;
      if (e.curveId) this.curveEdges(e.curveId).forEach(x => full.add(x.id));
      else full.add(id);
    }
    for (const id of full) {
      const e = this.edges.get(id); if (!e) continue;
      this.dissolveEdge(e); // shares the healing kernel with the Trim tool
    }
    this.gc();
  }
  deleteCurve(cid) { this.deleteEdgeIds(this.curveEdges(cid).map(e => e.id)); }

  // Edge Trim / Dissolve with coplanar face healing — the shared kernel of
  // the Trim tool and the eraser. Removing edge E = (V1, V2) is evaluated
  // against its owners:
  //   Case A — exactly two COPLANAR faces share E (N_A·N_B ≈ 1 and the same
  //     plane offset d): their perimeter loops fuse with the shared segment
  //     eliminated, then junction vertices of the fused loop that now join
  //     two collinear segments (interior angle ≈ 180°) weld away so the
  //     healed boundary is one continuous edge run.
  //   Case B — the two owners are NOT coplanar (a corner edge): merging into
  //     one planar face would warp, so both faces are removed and the shell
  //     opens there (SketchUp/AutoCAD erase behavior). `strict: true`
  //     refuses instead of opening the volume.
  //   Case C — a wire edge (0 faces) or single-face edge: straight graph
  //     removal; a ring that spikes out-and-back along E drops the spike,
  //     otherwise a one-face boundary edge takes its face with it.
  // Faces that die prune their ids from live push/pull state, so a later
  // collapse degrades gracefully instead of walking dead references.
  // Returns { ok, action, ... } describing the healing.
  dissolveEdge(e, opts = {}) {
    if (!e || !this.edges.has(e.id)) return { ok: false, action: 'missing' };
    const adj = this.facesAdjacentToEdge(e);
    if (adj.length === 2) {
      const liveOwners = adj.some(f => f.extrude);
      const mf = this.tryMergeFaces(adj[0], adj[1], e);
      if (mf) { // Case A — healed
        const seeds = mf._weldSeeds || [];
        delete mf._weldSeeds;
        const welded = this._weldCollinearInLoop(mf, [e.a, e.b, ...seeds]);
        this._delEdge(e.id);
        return { ok: true, action: 'healed', merged: mf.id, welded };
      }
      // a live push/pull owner cannot fuse (its extrude state cannot survive
      // the loop splice) — destroying it would eat the interactive top face,
      // so refuse and let the caller collapse/commit the push first
      if (liveOwners) return { ok: false, action: 'refused', reason: 'live-extrude' };
      if (opts.strict) return { ok: false, action: 'refused', reason: 'non-coplanar' };
      this._bimRemoveFaces(adj); // Case B — the shell opens
      adj.forEach(f => this.faces.delete(f.id));
      this._extrudePrune(adj.map(f => f.id));
      this._delEdge(e.id);
      return { ok: true, action: 'opened', removedFaces: adj.map(f => f.id) };
    }
    if (adj.length === 1 && this._healSpike(adj[0], e)) { // Case C, spiked ring
      this._delEdge(e.id);
      return { ok: true, action: 'spike', face: adj[0].id };
    }
    // Case C — wire edge, plain boundary edge, or non-manifold leftover
    this._bimRemoveFaces(adj);
    adj.forEach(f => this.faces.delete(f.id));
    this._extrudePrune(adj.map(f => f.id));
    this._delEdge(e.id);
    return { ok: true, action: adj.length ? 'opened' : 'wire', removedFaces: adj.map(f => f.id) };
  }

  // Drop face ids that just left the model from every live push/pull state:
  // collapse/push consumers treat missing faces as no-ops, so a trimmed
  // corner degrades into "collapse restores what still exists" instead of
  // corrupting bookkeeping. Culled partitions whose loop vertices were also
  // reaped can no longer be revived — drop them too.
  _extrudePrune(deadIds) {
    if (!deadIds || !deadIds.length) return;
    const dead = new Set(deadIds);
    for (const f of this.faces.values()) {
      const E = f.extrude;
      if (!E) continue;
      if (E.sides) E.sides = E.sides.filter(id => !dead.has(id));
      if (E.cap != null && dead.has(E.cap)) E.cap = null;
      if (E.extended) E.extended = E.extended.filter(x => !dead.has(x.fid));
      if (E.culled) E.culled = E.culled.filter(c => c.loop.every(v => this.vertices.has(v)));
      if (E.through && dead.has(E.through.fid)) E.through = null;
    }
  }

  // Post-merge cleanup: drop junction vertices whose two boundary segments
  // are collinear (angle ≈ 180°), replacing the two sub-edges with one
  // continuous segment. Only welds where no OTHER face hangs on either
  // sub-edge (a neighbor rising from that junction keeps its footprint) and
  // never touches curve segments (arc/circle chains must stay intact).
  // Cascades to the neighbors of each welded vertex, so a healed run of
  // collinear dividers collapses to a single straight boundary.
  _weldCollinearInLoop(f, seedVids) {
    if (!f || !this.faces.has(f.id) || f.holes.length) return [];
    const loop = f.loop;
    const welded = [];
    const queue = new Set(seedVids);
    while (queue.size) {
      const v = queue.values().next().value;
      queue.delete(v);
      const i = loop.indexOf(v);
      if (i < 0 || loop.length < 4) continue; // welding below 4 degenerates the ring
      const n = loop.length;
      const prevId = loop[(i - 1 + n) % n], nextId = loop[(i + 1) % n];
      const p = this.vp(prevId), c = this.vp(v), q = this.vp(nextId);
      if (!p || !c || !q) continue;
      const e1 = this.findEdge(prevId, v), e2 = this.findEdge(v, nextId);
      if (!e1 || !e2) continue;
      if (e1.curveId || e2.curveId) continue;
      const d1 = G.sub(c, p), d2 = G.sub(q, c);
      const l1 = G.len(d1), l2 = G.len(d2);
      if (l1 < G.EPS || l2 < G.EPS) continue;
      const s1 = G.mul(d1, 1 / l1), s2 = G.mul(d2, 1 / l2);
      if (G.dot(s1, s2) <= 0 || G.len(G.cross(s1, s2)) > 2e-4) continue; // not straight-through
      if (this.facesAdjacentToEdge(e1).some(x => x.id !== f.id)) continue;
      if (this.facesAdjacentToEdge(e2).some(x => x.id !== f.id)) continue;
      loop.splice(i, 1);
      welded.push(v);
      // close the perimeter with the continuous segment, then reap the two
      // sub-edges nothing uses anymore (they would render as phantom lines)
      const j = (i - 1 + loop.length) % loop.length;
      if (!this.findEdge(loop[j], loop[i % loop.length])) {
        const id = nid();
        this._addEdge({ id, a: loop[j], b: loop[i % loop.length], curveId: 0, gid: f.gid || 0 });
      }
      if (!this.facesAdjacentToEdge(e1).length) this._delEdge(e1.id);
      if (!this.facesAdjacentToEdge(e2).length) this._delEdge(e2.id);
      queue.add(loop[j]); queue.add(loop[i % loop.length]);
    }
    return welded;
  }

  // Defensive Case C path: a ring that runs out-and-back along e (…, V1, V2,
  // V1, …) keeps a valid boundary when e goes — drop the spike tip and the
  // doubled return vertex. Valid models never carry spikes (validate()
  // rejects revisited ring vertices), so normally a single-face edge is a
  // plain boundary edge and takes its face with it instead.
  _healSpike(f, e) {
    for (const ring of this.rings(f)) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n], back = ring[(i + 2) % n];
        if (!((a === e.a && b === e.b && back === e.a) || (a === e.b && b === e.a && back === e.b))) continue;
        const d1 = (i + 1) % n, d2 = (i + 2) % n;
        const kept = ring.filter((_, k) => k !== d1 && k !== d2);
        if (kept.length < 3 || new Set(kept).size !== kept.length) return false;
        if (G.loopArea(this.pts(kept)) < 1e-10) return false;
        // every kept consecutive pair was already a ring pair — edges exist
        ring.length = 0; ring.push(...kept);
        return true;
      }
    }
    return false;
  }

  // faces leaving the model hand their stamp back: the owning entity's face
  // list drops them and the entity is marked dirty (plain B-Rep survives)
  _bimRemoveFaces(faces) {
    for (const f of faces) {
      if (!f || !f.userData || !f.userData.bimEntityId) continue;
      this.bimDirty.add(f.userData.bimEntityId);
      const ent = (this.bimEntities || []).find(x => x.id === f.userData.bimEntityId);
      if (ent) ent.faces = ent.faces.filter(id => id !== f.id);
    }
  }

  // Union boundary of the fused face walks. The naive concatenation breaks
  // when the two rings share more than the dissolved edge — a divider split
  // by a T-junction, a spur rooted on the shared line, coincident boundary
  // pieces — because the closed walk then traverses some segments once in
  // EACH direction and revisits vertices. This computes the symmetric
  // difference instead: segments walked both ways are internal to the union
  // and drop out; the survivors chain into the outer boundary cycles, and
  // dead-end/zero-area excursions are pruned (degree-1 spurs). Returns the
  // largest enclosing simple cycle plus the junction vertices left behind by
  // dropped segments (weld seeds), or null when nothing closed remains.
  // Dropped interior segments are NOT deleted — they stay in model.edges as
  // dangling wires overlaid on the healed face, exactly like SketchUp.
  _unionWalk(walk) {
    const n = walk.length;
    if (n < 3) return null;
    const kk = (a, b) => a < b ? a + '|' + b : b + '|' + a;
    // net directed traversal per undirected segment: +1 / -1 / 0 (both ways)
    const net = new Map();
    for (let i = 0; i < n; i++) {
      const a = walk[i], b = walk[(i + 1) % n];
      if (a === b) continue;
      const key = kk(a, b);
      const cur = net.get(key) || { a, b, w: 0 };
      cur.w += cur.a === a ? 1 : -1;
      net.set(key, cur);
    }
    const adj = new Map(); // surviving directed segments: from -> [to, ...]
    const seeds = new Set(); // junctions of segments internal to the union
    for (const { a, b, w } of net.values()) {
      if (w === 0) { seeds.add(a); seeds.add(b); continue; }
      const u = w > 0 ? a : b, v = w > 0 ? b : a;
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u).push(v);
    }
    const area = c => Math.abs(G.loopArea(this.pts(c)));
    // prune a closed walk into a simple ring: repeated vertices mark either a
    // dead-end excursion (zero area — the spur case) or a pinch; keep the
    // larger side so the outer perimeter always survives as the face boundary
    const simplify = (c) => {
      c = [...c];
      let guard = c.length + 2;
      while (guard-- > 0) {
        const seen = new Map();
        let hit = -1, j = -1;
        for (let i = 0; i < c.length; i++) {
          if (seen.has(c[i])) { hit = i; j = seen.get(c[i]); break; }
          seen.set(c[i], i);
        }
        if (hit < 0)
          return c.length >= 3 && new Set(c).size === c.length ? c : null;
        const sub = c.slice(j, hit + 1); // closed excursion c[j] ... c[hit]
        if (area(sub) * 2 >= area(c)) c = sub; // pinch: keep the outer side
        else c.splice(j + 1, hit - j);         // drop the inner excursion
      }
      return null;
    };
    // chain directed segments into closed cycles, keep the largest one
    let best = null;
    for (const start of [...adj.keys()]) {
      while ((adj.get(start) || []).length) {
        const cyc = [start];
        let cur = start, ok = false, guard = n + 2;
        while (guard-- > 0) {
          const list = adj.get(cur);
          if (!list || !list.length) break;
          const nx = list.pop();
          if (nx === start) { ok = true; break; }
          cyc.push(nx);
          cur = nx;
        }
        if (!ok) continue;
        const s = simplify(cyc);
        if (s && (!best || area(s) > area(best))) best = s;
      }
    }
    return best ? { cycle: best, seeds: [...seeds] } : null;
  }

  // Fuse two coplanar faces along their shared edge e. Returns the merged
  // face (or null when the planes differ / loops cannot fuse). N_A·N_B ≈ 1
  // plus identical plane offset d is the healing condition; holes and live
  // push/pull owners never fuse (their state cannot survive a loop splice).
  tryMergeFaces(f1, f2, e) {
    try {
      if (f1.holes.length || f2.holes.length || f1.extrude || f2.extrude) return null;
      const n1 = G.loopNormal(this.pts(f1.loop)), n2 = G.loopNormal(this.pts(f2.loop));
      if (G.isZero(n1) || G.isZero(n2)) return null;
      const d1 = G.dot(n1, this.vp(f1.loop[0]));
      const d2 = G.dot(n1, this.vp(f2.loop[0])); // project f2 onto f1's normal
      if (G.len(G.cross(n1, n2)) > 1e-3 || Math.abs(d1 - d2) > 1e-4) return null;

      // Walk a loop from s to t WITHOUT stepping across the shared edge s-t
      // (the direct s-t step flips the ring; the path then wraps, so the
      // slice has to rejoin at the front — plain slice(a, b+1) would be
      // empty and every coplanar merge would silently fall through).
      const walk = (L, s, t) => {
        let arr = L;
        let i = arr.indexOf(s), j = arr.indexOf(t);
        if (i < 0 || j < 0) return null;
        if (arr[(i + 1) % arr.length] === t) arr = [...arr].reverse();
        const a = arr.indexOf(s), b = arr.indexOf(t);
        return a <= b ? arr.slice(a, b + 1) : arr.slice(a).concat(arr.slice(0, b + 1));
      };
      const L2 = G.dot(n1, n2) >= 0 ? f2.loop : [...f2.loop].reverse();
      const Aw = walk(f1.loop, e.a, e.b);   // a ... b through f1
      const Bw = walk(L2, e.b, e.a);        // b ... a through f2
      if (!Aw || !Bw) return null;
      const u = this._unionWalk(Aw.concat(Bw.slice(1, -1)));
      if (!u) return null;
      const merged = u.cycle;
      if (G.loopArea(this.pts(merged)) < 1e-10) return null;
      this.edgesForRing(merged, true);
      const f = {
        id: nid(), loop: merged, holes: [],
        color: f1.color || f2.color, alpha: f1.alpha,
        hidden: f1.hidden && f2.hidden, extrude: null,
        gid: f1.gid === f2.gid ? (f1.gid || 0) : 0,
      };
      f._weldSeeds = u.seeds; // junctions of union-internal segments; dissolveEdge consumes this
      const deadRings = [[...f1.loop], [...f2.loop]];
      this.faces.delete(f1.id); this.faces.delete(f2.id);
      this.faces.set(f.id, f);
      // ring edges only the deleted parents used (a miter-cap diagonal the
      // fused loop no longer carries) must not linger as free wires — but
      // only inside BIM operations: Free-mode trim deliberately leaves
      // selectable spurs behind (no hold = user's drawing surface)
      if (this.bimHold) for (const r of deadRings) this.reapRingEdges(r);
      this._extrudePrune([f1.id, f2.id]); // owners' side lists follow the fusion
      // a stamped face that fuses hands its stamp to the merged face and the
      // owning entity's face list follows; a differently-stamped neighbor is
      // detached (marked dirty) — its parametric definition no longer matches
      this._bimTouch(f1);
      if (f1.userData && f1.userData.bimEntityId) {
        f.userData = f1.userData;
        const ent = (this.bimEntities || []).find(x => x.id === f1.userData.bimEntityId);
        if (ent) {
          const k = ent.faces.indexOf(f1.id);
          if (k >= 0) ent.faces.splice(k, 1, f.id); else ent.faces.push(f.id);
          if (f2.userData && f2.userData.bimEntityId === f1.userData.bimEntityId) {
            const j = ent.faces.indexOf(f2.id);
            if (j >= 0) ent.faces.splice(j, 1);
          }
        }
      }
      if (f2.userData && f2.userData.bimEntityId &&
        (!f1.userData || f1.userData.bimEntityId !== f2.userData.bimEntityId))
        this._bimRemoveFaces([f2]);
      return f;
    } catch (err) { return null; }
  }

  deleteFace(id) { this.faces.delete(id); this.version++; this.gc(); }

  // Wide construction sweep: bracket a whole tool commit (which may span
  // several nested bimHold sections — join rebuild, extrusion, stamping)
  // and reap edges BORN inside the bracket that ended up attached to no
  // face. Multi-stage residue (born attached in one hold, orphaned in the
  // next) is caught; free-drawn lines predate the bracket and survive.
  // EDGE SWEEP — the root guard against split residue (orphan lines): edges
  // born inside a bracket that no face references by bracket-end are reaped.
  // Brackets STACK (a transaction brackets everything; a wall rebuild opens
  // its own nested window), and edges created through the PUBLIC API carry
  // `deliberate` — drawn lines are geometry, never residue.
  beginEdgeSweep() {
    if (!this._sweepStack) this._sweepStack = [];
    this._sweepStack.push(new Set(this.edges.keys()));
  }
  endEdgeSweep() {
    if (!this._sweepStack || !this._sweepStack.length) return;
    const snap = this._sweepStack.pop();
    // v0.7 PERF: adjacency in ONE pass over face rings — the per-edge
    // facesAdjacentToEdge() scan was O(faces × ring) PER born edge, and a
    // bulk import's sweep reap alone crossed a billion comparisons
    const adj = new Map();
    for (const f of this.faces.values()) {
      for (const ring of this.rings(f)) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const k = a < b ? a + 'x' + b : b + 'x' + a;
          adj.set(k, (adj.get(k) || 0) + 1);
        }
      }
    }
    for (const id of [...this.edges.keys()]) {
      if (snap.has(id)) continue;
      const e = this.edges.get(id);
      if (e && !e.curveId && !(e.userData && e.userData.deliberate)) {
        const k = e.a < e.b ? e.a + 'x' + e.b : e.b + 'x' + e.a;
        if (!adj.get(k)) this._delEdge(id);
      }
    }
    this.gc();
  }
  /** One-time cleanup for models saved before the sweep existed. */
  reapOrphanEdges() {
    // v0.6 PERF: adjacency in ONE pass over face rings (edge-pair -> count),
    // then every orphan lookup is O(1). The old per-edge
    // facesAdjacentToEdge() scan was O(faces x ring) PER EDGE — on a
    // multi-hundred-element model every sweep cost seconds, and Rebuild
    // from Parameters ran one per element (the freeze).
    const adj = new Map();
    for (const f of this.faces.values()) {
      for (const ring of this.rings(f)) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const k = a < b ? a + 'x' + b : b + 'x' + a;
          adj.set(k, (adj.get(k) || 0) + 1);
        }
      }
    }
    let n = 0;
    for (const [id, e] of [...this.edges]) {
      // deliberate drawn lines and curve-owned edges survive; an entity stamp
      // does NOT — a stamped edge with zero adjacent faces is a corpse from a
      // split cascade (merged co-linear ring segment outliving its faces),
      // and was exactly the long orphan line between distant elements
      if (e.curveId || (e.userData && e.userData.deliberate)) continue;
      const k = e.a < e.b ? e.a + 'x' + e.b : e.b + 'x' + e.a;
      if (!adj.get(k)) { this._delEdge(id); n++; }
    }
    if (n) this.gc();
    return n;
  }

  // Soften/hidden edges: display-only visibility (rendering skips them;
  // every boundary/weld/join operation still sees them). Ctrl+erase hides.
  unhideAllEdges() {
    let n = 0;
    for (const e of this.edges.values()) { if (e.hidden) { e.hidden = false; n++; } }
    return n;
  }
  // Edges attached to no face: free-drawn lines (user content) and any
  // construction residue that slipped past the BIM sweeps.
  wireEdges() {
    const out = [];
    for (const e of this.edges.values())
      if (this.facesAdjacentToEdge(e).length === 0) out.push(e);
    return out;
  }
  // Remove them ALL — the "Clean Up" command. Undoable by the caller's
  // transaction. Returns how many edges were removed.
  purgeWireEdges() {
    const wires = this.wireEdges();
    for (const e of wires) this._delEdge(e.id);
    if (wires.length) this.gc();
    return wires.length;
  }

  // Remove the edges of a just-deleted face's ring that no surviving face
  // uses anymore (shared boundary segments stay). Hosted-cut void rings and
  // other temporary construction faces would otherwise linger as
  // free-floating wire lines — gc() reaps orphan vertices but never orphan
  // edges, since free-drawn lines are legitimate user content.
  reapRingEdges(loop) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const e = this.findEdge(loop[i], loop[(i + 1) % n]);
      if (e && this.facesAdjacentToEdge(e).length === 0) this._delEdge(e.id);
    }
    this.gc();
  }

  gc() {
    const used = new Set();
    for (const e of this.edges.values()) { used.add(e.a); used.add(e.b); }
    for (const [id] of this.vertices) if (!used.has(id)) { this._vhRemove(id); this.vertices.delete(id); }
    for (const [id, f] of this.faces) {
      const L = f.loop.filter(v => this.vertices.has(v));
      // a shrunk ring means pruned vertices COLLAPSED ring adjacencies —
      // heal the boundary or the ring references vertex pairs with no edge
      // (validate fails, later edits guard-rollback). edgesForRing chains
      // through any surviving on-segment vertices, exactly like a fresh ring.
      if (L.length !== f.loop.length) { f.loop = L; this.edgesForRing(f.loop, true); }
      f.holes = (f.holes || []).map(h => {
        const H = h.filter(v => this.vertices.has(v));
        if (H.length !== h.length) this.edgesForRing(H, true);
        return H;
      }).filter(h => h.length >= 3);
      if (new Set(f.loop).size < 3 || G.loopArea(this.pts(f.loop)) < 1e-10) this.faces.delete(id);
    }
    // curves with no edges left
    for (const cid of [...this.curves.keys()])
      if (!this.curveEdges(cid).length) this.curves.delete(cid);
    this.pruneGroups();
  }

  // ---------------------------------------------------------------- coplanar punch
  // If `face` was just drawn entirely inside an existing coplanar face, punch it
  // out of that face as a hole (SketchUp behavior: drawing a rect on a face
  // splits it, so later push/pull leaves a clean boundary line).
  /** v0.6 ELEMENT INDEPENDENCE: while a BIM build holds the model, a drawn
   *  face may only cut its OWNER's faces — another element's face is an
   *  island to overlap (ELEMENT_EPS), never a host to punch or split. A
   *  string bimHold names the owning entity id; truthy-but-unnamed means a
   *  first build (its fresh faces may cut only unstamped geometry). Free
   *  mode (bimHold falsy) cuts as always. */
  hostCuttableBy(host) {
    if (!this.bimHold) return true;
    const stamp = host.userData && host.userData.bimEntityId;
    if (!stamp) return true;
    return stamp === this.bimOwner();
  }

  punchHole(face) {
    const loop = face.loop;
    if (!loop || loop.length < 3 || face.holes.length) return false;
    const pts = this.pts(loop);
    const n = G.loopNormal(pts);
    if (G.isZero(n)) return false;
    const { u, v } = G.basisForNormal(n);
    const inLoop = (p, poly) => {
      const q = poly.map(x => G.to2D(x, poly[0], u, v));
      const P = G.to2D(p, poly[0], u, v);
      let inside = false;
      for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
        if (((q[i].y > P.y) !== (q[j].y > P.y)) &&
          (P.x < (q[j].x - q[i].x) * (P.y - q[i].y) / (q[j].y - q[i].y) + q[i].x)) inside = !inside;
      }
      return inside;
    };
    for (const g of this.faces.values()) {
      if (!this.hostCuttableBy(g)) continue; // v0.6: never cut another element
      if (g.id === face.id || g.hidden) continue;
      const gPts = this.pts(g.loop);
      const gn = G.loopNormal(gPts);
      if (G.isZero(gn) || G.len(G.cross(n, gn)) > 1e-6) continue;
      if (Math.abs(G.dot(n, gPts[0]) - G.dot(n, pts[0])) > 1e-4) continue; // not same plane
      // (no group-scope guard: group membership is organizational — geometry
      // decides connectivity, matching how drawn lines already merge across
      // groups; this is what let grouped-wall windows become floating tubes)
      // face must sit strictly inside g's outer loop (no boundary contact —
      // touching rings go through splitFaceWithRing instead), no hole overlap
      const distToBoundary = p => {
        let d = Infinity;
        for (let i = 0; i < gPts.length; i++) d = Math.min(d, G.distToSeg(p, gPts[i], gPts[(i + 1) % gPts.length]));
        return d;
      };
      if (!pts.every(p => inLoop(p, gPts) && distToBoundary(p) > 1e-5)) continue;
      if (gPts.some(p => inLoop(p, pts))) continue; // partial overlap / bigger
      // Existing holes vs the drawn ring, classified with a margin (ray casts
      // are unreliable exactly ON the ring): strictly inside -> moves onto the
      // drawn face; straddling -> refuse; merely TOUCHING (adjacent openings
      // sharing an edge) -> stays on the host as a parallel opening.
      let holeClash = false;
      const moved = [];
      const distToRing = p => {
        let d = Infinity;
        for (let i = 0; i < pts.length; i++) d = Math.min(d, G.distToSeg(p, pts[i], pts[(i + 1) % pts.length]));
        return d;
      };
      for (const h of g.holes) {
        const hPts = this.pts(h);
        if (hPts.some(p => distToRing(p) <= 1e-5)) continue; // touching: keep on host
        const hInRing = hPts.every(p => inLoop(p, pts));
        const ringInH = pts.some(p => inLoop(p, hPts));
        if (hInRing && ringInH) { holeClash = true; break; } // straddles the ring
        if (!hInRing) continue;
        // the hole may still be capped by the face that punched it; that cap
        // becomes interior to the drawn face and must go. A cap that was
        // extruded or holed is a 3D feature — refuse to rip it apart.
        const caps = [...this.faces.values()].filter(f => f.id !== face.id && this.sameRing(f.loop, h));
        if (caps.some(c => c.extrude || c.holes.length)) { holeClash = true; break; }
        moved.push({ ring: h, caps });
      }
      if (holeClash) continue;
      if (moved.length) {
        g.holes = g.holes.filter(h => !moved.some(mm => mm.ring === h));
        face.holes = moved.map(mm => mm.ring);
        for (const mm of moved) for (const c of mm.caps) this.faces.delete(c.id);
      }
      this._bimTouch(g);
      g.holes.push([...loop]);
      return true;
    }
    return false;
  }
  // Draw a closed shape on a face: punch it out (strictly inside), trim a
  // region that touches the host boundary, or split a straddling shape —
  // SketchUp face splitting.
  // (see pushPull below: it touches stamped faces via _bimTouch)
  punchOrSplit(face) {
    if (this.punchHole(face)) return 'punch';
    if (this.trimHostByRing(face)) return 'split';
    // planar arrangement FIRST: overlapping coplanar shapes partition into
    // minimal selectable cells (crossing rects -> intersection + outers)
    if (this.arrangePlaneFaces(face)) return 'split';
    if (this.splitFaceWithRing(face)) return 'split';
    return null;
  }
  // Planar arrangement: a drawn shape OVERLAPPING coplanar faces (edges
  // crossing in several runs — e.g. two crossing rectangles) is partitioned
  // into the minimal selectable cells of the shared edge graph. The
  // overlapping parent faces (and the drawn face) are replaced by every
  // minimal closed loop of the segmented component, so the intersection
  // region and each remaining outer region become independent faces.
  arrangePlaneFaces(face) {
    if (!face.loop || face.loop.length < 3) return false;
    const qPts = this.pts(face.loop);
    const n = G.loopNormal(qPts);
    if (G.isZero(n)) return false;
    const { u, v } = G.basisForNormal(n);
    const to2 = p => G.to2D(p, qPts[0], u, v);
    const d0 = G.dot(n, qPts[0]);
    const onPlane = p => Math.abs(G.dot(n, p) - d0) <= 1e-4;

    // faces referenced by pending extrude state must not be replaced
    const protectedIds = this.protectedFaceIds();

    // eligible parents must exist before we mutate anything: at least one
    // hole-less, unextrured, unprotected coplanar face whose ring could be
    // replaced by cells (checked fully after segmentation; this pre-check
    // avoids leaving split edges behind when we're going to bail anyway)
    {
      const bb = list => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of list) { const q = to2(p); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
        return [x0, y0, x1, y1];
      };
      const fb = bb(qPts);
      let anyCandidate = false;
      for (const f of this.faces.values()) {
        if (f.id === face.id || f.holes.length || f.extrude || protectedIds.has(f.id)) continue;
        if (!this.hostCuttableBy(f)) continue; // v0.6: never partition another element
        const fp = this.pts(f.loop);
        if (!fp.length || !onPlane(fp[0])) continue;
        const fn2 = G.loopNormal(fp);
        if (G.isZero(fn2) || G.len(G.cross(n, fn2)) > 1e-6) continue;
        // the candidate must plausibly overlap the drawn ring (2D bbox test)
        // — otherwise there is nothing to partition against
        const cb = bb(fp);
        if (cb[0] > fb[2] + 1e-9 || cb[2] < fb[0] - 1e-9 || cb[1] > fb[3] + 1e-9 || cb[3] < fb[1] - 1e-9) continue;
        anyCandidate = true; break;
      }
      if (!anyCandidate) return false;
    }

    // segment the plane graph: every proper crossing splits BOTH edges, and
    // any vertex strictly inside an edge chains through it (shared vertices
    // within WELD_EPS; splitEdgeAt updates every referencing ring). Splits
    // REPLACE edges, so run to a fixpoint over the live set — a snapshot
    // would miss crossings against freshly created sub-edges.
    for (let pass = 0; pass < 8; pass++) {
      const list = [...this.edges.values()].filter(e =>
        !e.curveId && onPlane(this.vp(e.a)) && onPlane(this.vp(e.b)));
      let split = false;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (!this.edges.has(list[i].id) || !this.edges.has(list[j].id)) continue;
          const hit = this._segCross(this.vp(list[i].a), this.vp(list[i].b), this.vp(list[j].a), this.vp(list[j].b));
          if (hit) { this.splitEdgeAt(list[i], hit.p); this.splitEdgeAt(list[j], hit.p); split = true; }
        }
      }
      for (const e of list) {
        if (!this.edges.has(e.id)) continue;
        const a = this.vp(e.a), b = this.vp(e.b);
        for (const [id, vp2] of this.vertices) {
          if (id === e.a || id === e.b) continue;
          if (G.distToSeg(vp2, a, b) < Model.WELD_EPS &&
            G.dist(vp2, a) > Model.WELD_EPS && G.dist(vp2, b) > Model.WELD_EPS) {
            this.splitEdgeAt(e, vp2);
            split = true;
            break;
          }
        }
      }
      if (!split) break;
    }

    // rebuild the plane's (now segmented) edge set and the component that
    // contains the drawn shape
    const seg = [];
    for (const e of this.edges.values()) {
      if (e.curveId) continue;
      const a = this.vp(e.a), b = this.vp(e.b);
      if (!a || !b || !onPlane(a) || !onPlane(b)) continue;
      seg.push(e);
    }
    const adj = new Map();
    const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
    for (const e of seg) { link(e.a, e.b); link(e.b, e.a); }
    const comp = new Set(face.loop);
    {
      const q = [...face.loop];
      while (q.length) {
        const x = q.pop();
        for (const y of (adj.get(x) || [])) if (!comp.has(y)) { comp.add(y); q.push(y); }
      }
    }
    const compEdges = seg.filter(e => comp.has(e.a) && comp.has(e.b));
    if (compEdges.length < 3) return false;

    // parents: hole-less, unextruded, unprotected faces whose whole ring
    // lives in this component (these get replaced by the arrangement cells)
    const pairKey = (a, b) => Math.min(a, b) + '_' + Math.max(a, b); // numeric order
    const compEdgeKeys = new Set(compEdges.map(e => pairKey(e.a, e.b)));
    const parents = [];
    for (const f of this.faces.values()) {
      if (f.id === face.id || f.holes.length || f.extrude || protectedIds.has(f.id)) continue;
      const fp = this.pts(f.loop);
      if (!fp.length || !onPlane(fp[0])) continue;
      const fn = G.loopNormal(fp);
      if (G.isZero(fn) || G.len(G.cross(n, fn)) > 1e-6) continue;
      let all = true;
      for (let i = 0; i < f.loop.length; i++) {
        const a = f.loop[i], b = f.loop[(i + 1) % f.loop.length];
        if (!compEdgeKeys.has(pairKey(a, b))) { all = false; break; }
      }
      if (all) { parents.push(f); }
    }
    if (!parents.length) return false; // disconnected (enclosing ring): unchanged
    for (const f of parents) this._bimTouch(f); // partition replaces parametric faces

    // half-edge traversal with angular order -> minimal closed loops
    const ang = new Map(); // vid -> [{other, angle}]
    const addAng = (from, to) => {
      if (!ang.has(from)) ang.set(from, []);
      const p1 = to2(this.vp(from)), p2 = to2(this.vp(to));
      ang.get(from).push({ other: to, angle: Math.atan2(p2.y - p1.y, p2.x - p1.x) });
    };
    for (const e of compEdges) { addAng(e.a, e.b); addAng(e.b, e.a); }
    for (const [, list] of ang) list.sort((x, y) => x.angle - y.angle);
    const next = (fromV, toV) => {
      // standard DCEL successor: the neighbor of toV that comes next after
      // (toV -> fromV) in CLOCKWISE angular order (full-circle sweep, so
      // degree-2 corners are reachable). Traces every half-edge exactly once;
      // positive-oriented cycles are the faces, the negative one is outer.
      const list = ang.get(toV);
      if (!list) return null;
      const back = to2(this.vp(fromV)), here = to2(this.vp(toV));
      const rev = Math.atan2(back.y - here.y, back.x - here.x);
      let best = null;
      for (const c of list) {
        if (c.other === fromV) continue;
        let d = rev - c.angle;
        while (d <= 1e-12) d += 2 * Math.PI; // sweep (0, 2π]
        if (d > 2 * Math.PI - 1e-9) d -= 2 * Math.PI;
        if (!best || d < best.d) best = { w: c.other, d };
      }
      return best ? best.w : null;
    };
    const visited = new Set(); // directed edge keys
    const cycles = [];
    for (const e of compEdges) {
      for (const [s, t] of [[e.a, e.b], [e.b, e.a]]) {
        if (visited.has(s + '>' + t)) continue;
        const loop = [s];
        let cur = s, nxt = t;
        let ok = true;
        while (nxt !== s) {
          visited.add(cur + '>' + nxt);
          loop.push(nxt);
          const w = next(cur, nxt);
          if (w == null || loop.length > compEdges.length * 2 + 4) { ok = false; break; }
          cur = nxt; nxt = w;
        }
        if (ok && loop.length >= 3) {
          visited.add(cur + '>' + s); // the closing half belongs to this cycle
          cycles.push(loop);
        }
      }
    }

    // positive-oriented minimal loops are the arrangement cells (signed:
    // loopArea is absolute, so orient against the plane normal)
    const cells = [];
    for (const cyc of cycles) {
      if (new Set(cyc).size !== cyc.length) continue; // pinched walk: not a cell
      const signed = G.dot(G.newell(this.pts(cyc)), n) / 2;
      if (signed > 1e-7) cells.push({ loop: cyc, area: signed });
    }
    if (cells.length < 2) return false;

    // cell color/alpha: whichever parent (or the drawn face) covers the centroid
    const coverStyle = (cyc) => {
      const fp2 = this.pts(cyc);
      const c3 = G.mul(fp2.reduce((s2, p) => G.add(s2, p), G.v()), 1 / fp2.length);
      for (const f of [...parents, face]) {
        const fp = this.pts(f.loop);
        const P2 = fp.map(p => G.to2D(p, fp[0], u, v));
        const C2 = G.to2D(c3, fp[0], u, v);
        let inside = false;
        for (let i = 0, j = P2.length - 1; i < P2.length; j = i++) {
          if (((P2[i].y > C2.y) !== (P2[j].y > C2.y)) &&
            (C2.x < (P2[j].x - P2[i].x) * (C2.y - P2[i].y) / (P2[j].y - P2[i].y) + P2[i].x)) inside = !inside;
        }
        if (inside) return { color: f.color, alpha: f.alpha, src: f };
      }
      return { color: face.color, alpha: face.alpha, src: face };
    };

    // OWNERSHIP CARRY-OVER: the parents being partitioned may be stamped BIM
    // faces (joined walls' bottom caps tile one plane — closing the loop
    // re-partitions the neighbors' caps too). Cells covered by a parent
    // inherit its B-Rep stamp, and the owning entity's face/edge lists swap
    // the dead parent ids for the live cell ids — otherwise the wall's
    // underside becomes an anonymous orphan and the element loses its bottom.
    const deadIds = new Set([face.id, ...parents.map(p => p.id)]);
    const carry = new Map(); // entityId -> { cellIds: [], edgeStamps: [] }
    const carryCell = (src, cellId) => {
      const ud = src && src.userData;
      if (!ud || !ud.bimEntityId) return null;
      let c = carry.get(ud.bimEntityId);
      if (!c) { c = { cellIds: [], edgeStamps: [] }; carry.set(ud.bimEntityId, c); }
      c.cellIds.push(cellId);
      return ud;
    };
    for (const p of parents) this.faces.delete(p.id);
    this.faces.delete(face.id);
    for (const c of cells) {
      const style = coverStyle(c.loop);
      const loop = [...c.loop];
      if (G.dot(G.loopNormal(this.pts(loop)), n) < 0) loop.reverse();
      this.edgesForRing(loop, true);
      const id = nid();
      const ud = carryCell(style.src, id);
      this.faces.set(id, {
        id, loop, holes: [], color: style.color, alpha: style.alpha,
        hidden: false, extrude: null, gid: face.gid || 0,
        userData: ud ? { ...ud } : null,
      });
      if (ud) {
        // the cell's (possibly re-created) boundary edges follow the entity
        // too, so hide/select keeps seeing the whole outline
        for (let i = 0; i < loop.length; i++) {
          const e = this.findEdge(loop[i], loop[(i + 1) % loop.length]);
          if (e && !e.userData) carry.get(ud.bimEntityId).edgeStamps.push([e.id, { ...ud, role: 'profile' }]);
        }
      }
    }
    for (const [entId, c] of carry) {
      const ent = (this.bimEntities || []).find(x => x.id === entId);
      if (!ent) continue;
      ent.faces = ent.faces.filter(id2 => !deadIds.has(id2)).concat(c.cellIds);
      ent.edges = ent.edges.filter(id2 => this.edges.has(id2));
      for (const [eid, stamp] of c.edgeStamps) {
        const e = this.edges.get(eid);
        if (e && !e.userData) { e.userData = stamp; ent.edges.push(eid); }
      }
    }
    this.gc();
    return true;
  }
  // The drawn ring lies inside a host face but TOUCHES the host's boundary
  // (at corners and/or along edges — e.g. an L in the corner of a box top).
  // Cut the touched region out of the host: the host keeps a single remainder
  // ring and the drawn face takes the region, sharing real boundary edges so
  // push/pull merges with the host. Requires every ring vertex to lie inside
  // or on the host, and the untouched part of the host to stay in one piece;
  // rings that extend beyond the host go through splitFaceWithRing instead.
  trimHostByRing(face) {
    const qIds = face.loop;
    if (!qIds || qIds.length < 3) return false;
    const qPts = this.pts(qIds);
    const n = G.loopNormal(qPts);
    if (G.isZero(n)) return false;
    const { u, v } = G.basisForNormal(n);
    const to2 = p => G.to2D(p, qPts[0], u, v);
    const Q = qPts.map(to2);
    const EPS = 1e-6;

    for (const host of this.faces.values()) {
      if (host.id === face.id || host.hidden) continue;
      if (!this.hostCuttableBy(host)) continue; // v0.6: never cut another element
      // (no group-scope guard: coplanar overlap is a geometric fact)
      const hPts = this.pts(host.loop);
      const hn = G.loopNormal(hPts);
      if (G.isZero(hn) || G.len(G.cross(n, hn)) > 1e-6) continue;
      if (Math.abs(G.dot(n, hPts[0]) - G.dot(n, qPts[0])) > 1e-4) continue; // not same plane
      const P = hPts.map(to2);
      const m = P.length;
      const evenOdd = (poly, p) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          if (((poly[i].y > p.y) !== (poly[j].y > p.y)) &&
            (p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)) inside = !inside;
        }
        return inside;
      };
      const onSeg = (p, a, b) => {
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        if (Math.abs(cross) > 1e-7) return false;
        return p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS &&
          p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;
      };
      const onHost = p => {
        for (let i = 0; i < m; i++) if (onSeg(p, P[i], P[(i + 1) % m])) return true;
        return false;
      };
      const onRing = p => {
        for (let i = 0; i < Q.length; i++) if (onSeg(p, Q[i], Q[(i + 1) % Q.length])) return true;
        return false;
      };
      const inHost = p => evenOdd(P, p);
      const inRing = p => evenOdd(Q, p);

      // every ring vertex must lie inside or on the host; at least one touches
      let onCount = 0, outside = false;
      for (const p of Q) {
        if (onHost(p)) { onCount++; continue; }
        if (!inHost(p)) { outside = true; break; }
      }
      if (!onCount) continue;
      if (outside) continue; // straddling rings go to the arrangement/split paths

      // holes must not interact with the cut: fully inside the ring they move
      // onto the drawn face (with their cap consumed), otherwise they stay
      const distToQ = p => {
        let d = Infinity;
        for (let i = 0; i < Q.length; i++) {
          const a = Q[i], b = Q[(i + 1) % Q.length];
          const dx = b.x - a.x, dy = b.y - a.y;
          const L2 = dx * dx + dy * dy || 1e-12;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
          d = Math.min(d, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
        }
        return d;
      };
      const holesToKeep = [], holesToMove = [];
      let holeClash = false;
      for (const h of host.holes) {
        const hp = this.pts(h).map(to2);
        if (Math.min(...hp.map(distToQ)) <= 1e-5) { holeClash = true; break; }
        (hp.every(inRing) ? holesToMove : holesToKeep).push(h);
      }
      if (holeClash) continue;

      // split host boundary edges at the ring vertices lying on them so the
      // touched chains are delimited by real host-ring vertices
      const H = host.loop;
      for (const vid of qIds) {
        const p3 = this.vp(vid), p2 = to2(p3);
        if (!onHost(p2)) continue;
        for (let i = 0; i < H.length; i++) {
          const aId = H[i], bId = H[(i + 1) % H.length];
          if (aId === vid || bId === vid) continue;
          if (onSeg(p2, to2(this.vp(aId)), to2(this.vp(bId)))) {
            const e = this.findEdge(aId, bId);
            if (e) this.splitEdgeAt(e, p3);
            break;
          }
        }
      }

      // classify host edges: covered when their midpoint is inside the ring
      // (or on its boundary)
      const covered = [];
      for (let i = 0; i < H.length; i++) {
        const mid = to2(G.mul(G.add(this.vp(H[i]), this.vp(H[(i + 1) % H.length])), 0.5));
        covered.push(onRing(mid) || inRing(mid));
      }
      if (!covered.some(c => c) || covered.every(c => c)) continue;

      // maximal runs of covered edges as vertex pairs {vs, ve} (the boundary
      // walk vs -> ve that the ring replaces); consecutive-by-index runs are
      // one run, including across the index wrap (an L touching two host
      // edges that meet at a corner)
      const len = H.length;
      const covIdx = [];
      for (let i = 0; i < len; i++) if (covered[i]) covIdx.push(i);
      let idx = covIdx;
      if (covIdx.length > 1 && (covIdx[covIdx.length - 1] + 1) % len === covIdx[0]) {
        // the covered run wraps past edge 0: rotate so it starts at the break
        let b = covIdx.length - 1;
        while (b > 0 && (covIdx[b - 1] + 1) % len === covIdx[b]) b--;
        idx = covIdx.slice(b).concat(covIdx.slice(0, b));
      }
      const runs = [];
      let runStart = null;
      for (let x = 0; x < idx.length; x++) {
        if (runStart == null) runStart = idx[x];
        const consecutive = x + 1 < idx.length && (idx[x] + 1) % len === idx[x + 1];
        if (!consecutive) {
          runs.push({ vs: H[runStart], ve: H[(idx[x] + 1) % len] });
          runStart = null;
        }
      }
      for (let merged = true; merged;) {
        merged = false;
        for (let a = 0; a < runs.length && !merged; a++)
          for (let b = 0; b < runs.length; b++) {
            if (a === b) continue;
            if (runs[a].ve === runs[b].vs) { runs[a].ve = runs[b].ve; runs.splice(b, 1); merged = true; break; }
          }
      }

      // interior ring path between two ring vertices: the arc that avoids the
      // host boundary (fewer boundary midpoints)
      const ringPath = (from, to) => {
        const jf = qIds.indexOf(from), jt = qIds.indexOf(to);
        if (jf < 0 || jt < 0 || jf === jt) return null;
        const arc = (a, b) => {
          const out = [];
          for (let i = a; ; i = (i + 1) % qIds.length) {
            out.push(qIds[i]);
            if (i === b) break;
          }
          return out;
        };
        const c1 = arc(jf, jt), c2 = arc(jt, jf).reverse();
        const bcount = a => {
          let c = 0;
          for (let i = 0; i < a.length - 1; i++) {
            const mid = to2(G.mul(G.add(this.vp(a[i]), this.vp(a[i + 1])), 0.5));
            if (onHost(mid)) c++;
          }
          return c;
        };
        return bcount(c1) <= bcount(c2) ? c1 : c2;
      };

      // walk the uncovered host boundary, substituting each covered run with
      // its interior ring path; the remainder must be one simple ring
      let s = 0;
      while (covered[s]) s = (s + 1) % len; // start of an uncovered run (exists)
      let loopIds = [H[s]];
      let k = s;
      let sane = true, closed = false;
      for (let guard = 0; guard <= 4 * len + 4 * qIds.length; guard++) {
        if (!covered[k]) {
          const nx = (k + 1) % len;
          if (nx === s) { closed = true; break; }
          loopIds.push(H[nx]);
          k = nx;
        } else {
          const run = runs.find(r => r.vs === H[k]);
          const path = run && ringPath(run.vs, run.ve);
          if (!path || path.length < 2) { sane = false; break; }
          loopIds.push(...path.slice(1)); // continue through the run's far end
          k = H.indexOf(run.ve);
          if (k === s) { closed = true; break; } // the ring closed on the covered run
        }
      }
      if (loopIds[loopIds.length - 1] === loopIds[0]) loopIds.pop();
      if (!sane || !closed || new Set(loopIds).size !== loopIds.length || loopIds.length < 3) continue;
      const wPts = this.pts(loopIds);
      if (G.dot(G.loopNormal(wPts), hn) < 0) loopIds.reverse();
      this._bimTouch(host);
      this.edgesForRing(loopIds, true);
      host.loop = loopIds;
      host.holes = holesToKeep;

      if (holesToMove.length) {
        face.holes = holesToMove;
        for (const h of holesToMove) {
          for (const f2 of [...this.faces.values()]) {
            if (f2.id !== face.id && !f2.extrude && this.sameRing(f2.loop, h)) this.faces.delete(f2.id);
          }
        }
      }
      return true;
    }
    return false;
  }
  // The drawn `face` overlaps a coplanar host but isn't strictly inside it:
  // cut the host along the part of the drawn ring that lies inside it. The
  // host keeps the uncovered remainder; the drawn face covers the rest
  // (including the part beyond the host, like a rect straddling onto the
  // ground). Supports a single covered run along the host boundary. Hosts
  // with extrude state (previously pushed) and with holes are allowed; each
  // existing hole must fall entirely on one side of the cut.
  splitFaceWithRing(face) {
    if (!face.loop || face.loop.length < 3) return false;
    const qIds = face.loop;
    const qPts = this.pts(qIds);
    const n = G.loopNormal(qPts);
    if (G.isZero(n)) return false;
    const { u, v } = G.basisForNormal(n);
    const to2 = p => G.to2D(p, qPts[0], u, v);
    const Q = qPts.map(to2);
    const EPS = 1e-6;

    for (const host of this.faces.values()) {
      if (!this.hostCuttableBy(host)) continue; // v0.6: never cut another element
      if (host.id === face.id || host.hidden) continue;
      // (no group-scope guard: coplanar overlap is a geometric fact)
      const hPts = this.pts(host.loop);
      const hn = G.loopNormal(hPts);
      if (G.isZero(hn) || G.len(G.cross(n, hn)) > 1e-6) continue;
      if (Math.abs(G.dot(n, hPts[0]) - G.dot(n, qPts[0])) > 1e-4) continue; // not same plane
      const P = hPts.map(to2);
      const m = P.length;
      const inP = p => {
        let inside = false;
        for (let i = 0, j = m - 1; i < m; j = i++) {
          if (((P[i].y > p.y) !== (P[j].y > p.y)) &&
            (p.x < (P[j].x - P[i].x) * (p.y - P[i].y) / (P[j].y - P[i].y) + P[i].x)) inside = !inside;
        }
        return inside;
      };
      const inQ = p => {
        let inside = false;
        for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) {
          if (((Q[i].y > p.y) !== (Q[j].y > p.y)) &&
            (p.x < (Q[j].x - Q[i].x) * (p.y - Q[i].y) / (Q[j].y - Q[i].y) + Q[i].x)) inside = !inside;
        }
        return inside;
      };
      // classify ring vertices: strictly inside / on the host boundary / outside
      const onSeg = (p, a, b) => {
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        if (Math.abs(cross) > 1e-7) return false;
        return p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS &&
          p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;
      };
      const nearBoundary = p => {
        for (let i = 0; i < m; i++) if (onSeg(p, P[i], P[(i + 1) % m])) return true;
        return false;
      };
      const cls = Q.map(p => nearBoundary(p) ? 'on' : (inP(p) ? 'in' : 'out'));
      if (!cls.includes('in') && !cls.includes('on')) continue; // no overlap at all

      // existing holes must not interact with the cut: each sits entirely
      // inside the drawn ring (moves to the covered face) or entirely outside
      // it (stays with the remainder); a hole touching the cut skips the host.
      const distToQ = p => {
        let d = Infinity;
        for (let i = 0; i < Q.length; i++) {
          const a = Q[i], b = Q[(i + 1) % Q.length];
          const dx = b.x - a.x, dy = b.y - a.y;
          const L2 = dx * dx + dy * dy || 1e-12;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
          d = Math.min(d, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
        }
        return d;
      };
      const holesToKeep = [], holesToCover = [];
      let holeClash = false;
      for (const h of host.holes) {
        const hp = this.pts(h).map(to2);
        if (Math.min(...hp.map(distToQ)) <= 1e-5) { holeClash = true; break; }
        (hp.every(inQ) ? holesToCover : holesToKeep).push(h);
      }
      if (holeClash) continue;

      // collect proper crossings between ring edges and host boundary edges
      const crossings = []; // { qIdx (edge i), tQ, pIdx (edge j), tP, pt2 }
      for (let i = 0; i < Q.length; i++) {
        const a = Q[i], b = Q[(i + 1) % Q.length];
        for (let j = 0; j < m; j++) {
          const c = P[j], d = P[(j + 1) % m];
          const r = G.sub(b, a), s = G.sub(d, c);
          const den = r.x * s.y - r.y * s.x;
          if (Math.abs(den) < 1e-12) continue; // parallel/collinear — handled by 'on'
          const qp = G.sub(c, a);
          const t = (qp.x * s.y - qp.y * s.x) / den;
          const sp = (qp.x * r.y - qp.y * r.x) / den;
          if (t > 1e-6 && t < 1 - 1e-6 && sp > 1e-6 && sp < 1 - 1e-6) {
            crossings.push({ qIdx: i, tQ: t, pIdx: j, tP: sp, pt2: G.add(a, G.mul(r, t)) });
          }
        }
      }

      // transitions = proper crossings + ring vertices lying ON the host
      // boundary. Between two consecutive transitions the ring is entirely
      // covered or entirely uncovered — a single covered run means one clean
      // entry/exit pair (straddle / collinear-touch / corner-touch cases).
      const transitions = [];
      Q.forEach((p, i) => { if (cls[i] === 'on') transitions.push({ kind: 'v', pos: i, pt2: p, qIdx: i }); });
      crossings.forEach(x => transitions.push({ kind: 'x', pos: x.qIdx + x.tQ, pt2: x.pt2, cross: x }));
      if (transitions.length < 2) continue; // strict interior (punch) or no overlap
      transitions.sort((a, b) => a.pos - b.pos);

      // covered test for the arc between two transitions (per-sample vote)
      const arcCovered = (tA, tB) => {
        const span = tB.pos - tA.pos + (tB.pos > tA.pos ? 0 : Q.length);
        let inN = 0, outN = 0;
        for (let k = 1; k < 8; k++) {
          const pos = (tA.pos + span * (k / 8)) % Q.length;
          const ei = Math.floor(pos) % Q.length;
          const frac = pos - Math.floor(pos);
          const p = G.add(Q[ei], G.mul(G.sub(Q[(ei + 1) % Q.length], Q[ei]), frac));
          if (nearBoundary(p)) continue;
          if (inP(p)) inN++; else outN++;
        }
        return inN > 0 && inN >= outN;
      };
      // find covered runs among consecutive transition pairs
      const pairs = [];
      for (let k = 0; k < transitions.length; k++) {
        const a = transitions[k], b = transitions[(k + 1) % transitions.length];
        if (arcCovered(a, b)) pairs.push([a, b]);
      }
      if (pairs.length !== 1) continue; // 0 = no interior part; >1 = multi-run: skip
      const run = { start: pairs[0][0], end: pairs[0][1] };

      // realize the transition points as vertices on the right edges.
      // Edges are found geometrically (the loops mutate as we split).
      const b2w = pt2 => { // 2D back to world using qPts[0] as origin
        const o2 = to2(qPts[0]);
        return G.add(qPts[0], G.add(G.mul(u, pt2.x - o2.x), G.mul(v, pt2.y - o2.y)));
      };
      const edgeContaining = (pt3, loopIds) => {
        for (let k = 0; k < loopIds.length; k++) {
          const aId = loopIds[k], bId = loopIds[(k + 1) % loopIds.length];
          const a = this.vp(aId), b = this.vp(bId);
          if (G.distToSeg(pt3, a, b) < 1e-5) return this.findEdge(aId, bId);
        }
        return null;
      };
      const splitOnHost = ev => {
        const p3 = ev.kind === 'v' ? this.vp(qIds[ev.qIdx]) : b2w(ev.pt2);
        const e = edgeContaining(p3, host.loop);
        return e ? this.splitEdgeAt(e, p3) : this.vertexAt(p3);
      };
      const splitOnRing = ev => { // crossings also cut the ring's own edge
        if (ev.kind !== 'x') return null;
        const p3 = b2w(ev.pt2);
        const e = edgeContaining(p3, face.loop);
        return e ? this.splitEdgeAt(e, p3) : this.vertexAt(p3);
      };
      const entryId = splitOnHost(run.start);
      const exitId = splitOnHost(run.end);
      if (run.start.kind === 'x') splitOnRing(run.start);
      if (run.end.kind === 'x') splitOnRing(run.end);
      if (entryId == null || exitId == null || entryId === exitId) continue;

      // the host loop now contains entryId/exitId (splitEdgeAt inserts them);
      // slice the UNCOVERED arc: pick the arc whose midpoint is outside the ring
      const H = host.loop;
      const iE = H.indexOf(entryId), iX = H.indexOf(exitId);
      if (iE < 0 || iX < 0) continue;
      const sliceLoop = (L, i, j) => i <= j ? L.slice(i, j + 1) : L.slice(i).concat(L.slice(0, j + 1));
      const arc1 = sliceLoop(H, iE, iX);                      // E -> X forward
      const arc2 = sliceLoop(H, iX, iE);                      // X -> E forward
      if (arc1.length < 2 || arc2.length < 2) continue;
      // uncovered host arc: most of its edge midpoints lie OUTSIDE the ring
      const nearRingQ = p => {
        for (let i = 0; i < Q.length; i++) if (onSeg(p, Q[i], Q[(i + 1) % Q.length])) return true;
        return false;
      };
      const arcUncovered = arcIds => {
        let inN = 0, outN = 0;
        for (let k = 1; k < arcIds.length; k++) {
          const m = to2(G.mul(G.add(this.vp(arcIds[k - 1]), this.vp(arcIds[k])), 0.5));
          if (nearRingQ(m)) continue;
          if (inQ(m)) inN++; else outN++;
        }
        return outN > inN; // hugging the ring boundary entirely = covered side
      };
      let arc; // uncovered arc stays in the host remainder
      if (arcUncovered(arc1)) arc = arc1;
      else if (arcUncovered(arc2)) arc = arc2;
      else continue;
      // ring loop now contains entry/exit too; take the covered run E -> X
      const R = face.loop;
      const jE = R.indexOf(entryId), jX = R.indexOf(exitId);
      if (jE < 0 || jX < 0) continue;
      const rr1 = sliceLoop(R, jE, jX);                       // E -> X one way
      const rr2 = sliceLoop(R, jX, jE);                       // X -> E other way
      if (rr1.length < 2 || rr2.length < 2) continue;
      const rr1mid = to2(G.mul(G.add(this.vp(rr1[0]), this.vp(rr1[Math.floor(rr1.length / 2)])), 0.5));
      const qRunEtoX = inP(rr1mid) ? rr1 : rr2;               // covered run goes E -> X
      // remainder = uncovered arc + covered ring run (chained head-to-tail)
      let loopIds;
      if (arc[0] === entryId) loopIds = arc.concat([...qRunEtoX].reverse().slice(1, -1));
      else loopIds = qRunEtoX.concat(arc.slice(1, -1));
      if (new Set(loopIds).size < 3) continue;

      // keep the host's winding orientation
      const wPts = this.pts(loopIds);
      if (G.dot(G.loopNormal(wPts), hn) < 0) loopIds.reverse();
      this._bimTouch(host);
      this.edgesForRing(loopIds, true);
      host.loop = loopIds;
      host.holes = holesToKeep;

      // the drawn face splits in two: the part inside the host (covered —
      // this is the SketchUp region you push/pull) and the outside tab.
      // covered face = ring's covered run + the host boundary run it replaced
      let coveredLoop;
      if (arc === arc1) coveredLoop = qRunEtoX.concat(arc2.slice(1, -1));            // E..X + X..E interior
      else coveredLoop = qRunEtoX.concat([...arc1].reverse().slice(1, -1));
      if (new Set(coveredLoop).size >= 3) {
        let cPts = this.pts(coveredLoop);
        if (G.dot(G.loopNormal(cPts), n) < 0) coveredLoop.reverse();
        this.edgesForRing(coveredLoop, true);
        const covered = {
          id: nid(), loop: coveredLoop, holes: holesToCover.map(h => [...h]),
          color: face.color, alpha: face.alpha, hidden: false, extrude: null,
          gid: face.gid || 0,
        };
        this.faces.set(covered.id, covered);
      }
      const outsideRun = qRunEtoX === rr1 ? rr2 : rr1;
      if (new Set(outsideRun).size >= 3) {
        face.loop = [...outsideRun];
        this.edgesForRing(face.loop, true);
      } else {
        this.faces.delete(face.id); // nothing outside the host: pure split
        this.gc();
      }
      return true;
    }
    return false;
  }
  sameRing(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    const s = new Set(a);
    return b.every(v => s.has(v));
  }

  // ---------------------------------------------------------------- push/pull
  pushPull(face, dist, forceBaseCap = false) {
    this._bimTouch(face); // direct edits break the parametric definition (tools may sync instead)
    if (!this.faces.has(face.id)) return false;
    // Push/Pull operates only on closed, valid 2D faces: a defined normal AND
    // a non-degenerate area (raw edge chains / zero-area loops are rejected —
    // they would extrude into a paper-thin sheet)
    const n = G.loopNormal(this.pts(face.loop));
    if (G.isZero(n)) return false;
    if (G.loopArea(this.pts(face.loop)) < 1e-9) return false;

    if (face.extrude) {
      // dist is INCREMENTAL along the stored axis (SketchUp behavior: each
      // push/pull starts from the face's current position, not the origin).
      const ax = G.norm(face.extrude.axis);
      const curOff = G.dot(G.sub(this.vp(face.loop[0]), this.vp(face.extrude.anchor[0])), ax);
      const newOff = curOff + dist;
      if (Math.abs(newOff) < 2e-3) { this.collapseExtrude(face); return true; } // ~2 mm snap
      for (const ring of this.rings(face)) for (const vid of ring) {
        const p = this.vp(vid);
        if (p) this.setVertex(vid, G.add(p, G.mul(ax, dist)));
      }
      return true;
    }

    if (Math.abs(dist) < 1e-4) return false;
    const anchorOuter = [...face.loop];
    const anchorHoles = face.holes.map(h => [...h]);
    const baseRings = [anchorOuter, ...anchorHoles];

    // Neighborhood decides the topology, SketchUp-style:
    //  - lone face (nothing adjacent, nothing underneath): cap the base so it
    //    becomes a closed solid
    //  - lying on a coplanar host but never punched (imported/legacy models):
    //    punch now so the push MERGES with the host instead of capping a lone
    //    overlapping prism
    //  - punched out of / trimmed from a host face: NEVER cap — pushing
    //    outward merges with the host (one manifold solid), pushing inward
    //    carves a recess. If the sweep crosses a parallel blocking face before
    //    the full distance, clamp and punch a clean through hole instead of
    //    blindly overlapping the far side.
    const scanNeighborhood = () => {
      const externals = new Set();
      for (const ring of baseRings) {
        for (let i = 0; i < ring.length; i++) {
          const e = this.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (!e) continue;
          for (const f2 of this.facesAdjacentToEdge(e)) if (f2.id !== face.id) externals.add(f2.id);
        }
      }
      let holeHost = false;
      for (const fid of externals) {
        const f2 = this.faces.get(fid);
        if (f2 && f2.holes.some(h => this.sameRing(h, anchorOuter))) { holeHost = true; break; }
      }
      return { externals, holeHost };
    };
    let { externals, holeHost } = scanNeighborhood();
    // plainSweeps (bulk imports): the file's geometry is authoritative — no
    // SketchUp-style host inference, no blocking-face detection. Those scans
    // are O(all faces) per sweep and the punch/trim/split path cascades on
    // same-plane footprint overlaps (a multi-storey import grinds to a halt)
    const plain = this.plainSweeps === true;
    // LOOSE faces (Create Face's standalone copies): total independence —
    // never connect to a host, never punch/trim/split a coplanar neighbor,
    // never clamp against a blocking face, never auto-intersect. The sweep
    // is a closed solid island and every other face stays untouched.
    const loose = face.loose === true;
    if (!plain && !loose && !externals.size &&
      (this.punchHole(face) || this.trimHostByRing(face) || this.splitFaceWithRing(face))) {
      // the face never connected to the host it lies on (imported model,
      // pre-weld drawing, or a draw that landed on grouped geometry) —
      // connect it now so the push pockets or punches through the wall
      // instead of capping a disconnected floating tube inside it
      ({ externals, holeHost } = scanNeighborhood());
    }
    // SOLID-CREATING TOOLS (slabs, floors) pass forceBaseCap=true: the sweep
    // is meant to close into a solid, so the base cap is suppressed only by a
    // genuine host (a hole the ring was punched from, or a coplanar face
    // overlapping the footprint's area) — never by an edge-adjacent NEIGHBOR
    // tiling the plane (a slab drawn beside a slab must not lose its top).
    // Free-mode pushes keep the raw SketchUp inference below.
    if (forceBaseCap && externals.size) {
      const d0 = G.dot(n, this.vp(anchorOuter[0]));
      const { u: pu, v: pv } = G.basisForNormal(n);
      const o2 = this.vp(anchorOuter[0]);
      const to2 = p => G.to2D(p, o2, pu, pv);
      const probes = [this.faceCentroid(face), ...this.pts(anchorOuter)].map(to2);
      const p3 = q => G.v(q.x, q.y, 0);
      for (const fid of [...externals]) {
        const f2 = this.faces.get(fid);
        if (!f2) { externals.delete(fid); continue; }
        if (f2.holes.some(h => this.sameRing(h, anchorOuter))) continue; // hole host: pocket/through
        const fp = this.pts(f2.loop);
        const n2 = G.loopNormal(fp);
        if (G.isZero(n2)) { externals.delete(fid); continue; }
        const para = G.dot(n2, n);
        if (Math.abs(para) < 1 - 1e-6) { externals.delete(fid); continue; } // other plane: never covers the base
        const d2 = G.dot(n2, fp[0]);
        const samePlane = para > 0 ? Math.abs(d2 - d0) <= 1e-6 : Math.abs(d2 + d0) <= 1e-6;
        if (!samePlane) { externals.delete(fid); continue; } // parallel, offset plane: a blocker, not a cover
        // coplanar: a host only where it overlaps the footprint's area —
        // edge-adjacent tiles don't cover anything. Probes ON the ring
        // (shared vertices) are ambiguous under even-odd and don't count
        const P2 = fp.map(to2);
        const covers = pt => {
          for (let i = 0, j = P2.length - 1; i < P2.length; j = i++) {
            if (G.distToSeg(p3(pt), p3(P2[i]), p3(P2[j])) < 1e-9) return false;
          }
          let hit = false;
          for (let i = 0, j = P2.length - 1; i < P2.length; j = i++) {
            if (((P2[i].y > pt.y) !== (P2[j].y > pt.y)) &&
              (pt.x < (P2[j].x - P2[i].x) * (pt.y - P2[i].y) / (P2[j].y - P2[i].y) + P2[i].x)) hit = !hit;
          }
          return hit;
        };
        if (!probes.some(covers)) externals.delete(fid);
      }
    }
    // v0.6 ELEMENT INDEPENDENCE: a BIM build closes into a solid island —
    // a FOREIGN element's adjacent face never hosts it (never suppresses
    // the base cap). Chained wall pieces share their start-cap edge with
    // the previous piece's faces; without this rule every piece after the
    // first counted as "hosted" and extruded open at the bottom. Pocket
    // semantics stay for free mode and Edit In Place, where the host is
    // the owner's OWN geometry (hostCuttableBy).
    if (this.bimHold && externals.size) {
      for (const fid of [...externals]) {
        if (!this.hostCuttableBy(this.faces.get(fid))) externals.delete(fid);
      }
    }
    // a loose face's sweep children inherit the flag: pushing its base cap
    // or a side wall later keeps the same total-independence contract
    if (loose) externals.clear();
    let capId = null;
    let through = null;
    if (!externals.size) {
      const cap = {
        id: nid(),
        loop: [...anchorOuter],
        holes: anchorHoles.map(h => [...h]),
        color: face.color, alpha: face.alpha, hidden: false, extrude: null,
        gid: face.gid || 0,
        loose: face.loose || undefined,
        // v0.6: a stamped face's extrusion children carry its stamp from birth
        // — otherwise every born face is unstamped during the sweep, passes
        // indepSkip's fresh-pair gate, and slices its own siblings at welded
        // junctions (the corner-column rebuild freeze)
        userData: face.userData ? { ...face.userData } : null,
      };
      this.faces.set(cap.id, cap);
      capId = cap.id;
    } else if (holeHost && !anchorHoles.length) {
      through = (plain || loose) ? null : this.findBlockingFace(face, anchorOuter, n, dist);
    }
    // a parallel face in the sweep path blocks regardless of how the pushed
    // face sits in the model — drawn in a host's punched hole (the
    // wall-window case) or free-floating on open ground under a ceiling
    // slab: the sweep punches (and clamps) against it either way
    if (!through && !plain && !loose && Math.abs(dist) > 1e-6)
      through = this.findBlockingFace(face, anchorOuter, n, dist);
    // a parallel face in the sweep path blocks regardless of how the pushed
    // face sits in the model — drawn in a host's punched hole (the
    // wall-window case) or free-floating on open ground under a ceiling
    // slab: the sweep punches (and clamps) against it either way

    // SketchUp through-punch semantics, three branches by depth |d| vs wall
    // thickness T (the distance to the opposing face):
    //   0 < |d| < T      shallow pocket: end cap inside the body (existing)
    //   |d| ~= T (1e-4)  exact through-punch: no cap, rear face holed, the
    //                     pushed face is consumed as the opening
    //   |d| > T          tunnel + protrusion: rear face holed at T, walls
    //                     continue past it into open space, the pushed face
    //                     survives as the forward-facing end cap
    const sgn = Math.sign(dist);
    const L = Math.abs(dist);
    // how thick is the blocking body? Its far skin — the nearest face past
    // the blocking plane, parallel to the sweep, fully spanning the pushed
    // footprint — bounds the material the sweep is entering. A tip that
    // would end INSIDE that body is clamped to the blocking plane (push to
    // a ceiling that stops mid-slab: no buried geometry, the sweep is
    // consumed as the opening in the ceiling's underside).
    let exit = null;
    if (through && L > through.t + 1e-4) {
      const travel = G.mul(n, sgn);
      const probe = G.add(this.vp(anchorOuter[0]), G.mul(travel, through.t + 1e-3));
      const { u, v } = G.basisForNormal(n);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const vid of anchorOuter) {
        const p = this.vp(vid), qx = G.dot(u, p), qy = G.dot(v, p);
        x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy);
      }
      for (const f2 of this.faces.values()) {
        if (f2.id === face.id || f2.id === through.face.id) continue;
        const n2 = G.loopNormal(this.pts(f2.loop));
        if (G.isZero(n2) || Math.abs(G.dot(n2, n)) < 0.999) continue;
        let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity;
        for (const ring of this.rings(f2)) for (const vid of ring) {
          const p = this.vp(vid), qx = G.dot(u, p), qy = G.dot(v, p);
          fx0 = Math.min(fx0, qx); fy0 = Math.min(fy0, qy); fx1 = Math.max(fx1, qx); fy1 = Math.max(fy1, qy);
        }
        if (fx0 > x0 + 1e-9 || fx1 < x1 - 1e-9 || fy0 > y0 + 1e-9 || fy1 < y1 - 1e-9) continue;
        const t2 = G.dot(travel, G.sub(this.vp(f2.loop[0]), probe));
        if (t2 <= 1e-3) continue;
        if (!exit || t2 < exit.t) exit = { t: t2 + through.t + 1e-3, face: f2 };
      }
    }
    const past = !!(through && L > through.t + 1e-4 && !(exit && L < exit.t - 1e-3));
    const eff = through && !past ? sgn * through.t : dist;
    const midRings = through
      ? baseRings.map(ring => ring.map(vid => this.vertexAt(G.add(this.vp(vid), G.mul(n, sgn * through.t)))))
      : null; // the ring where the sweep crosses the rear face
    const topRings = baseRings.map(ring => ring.map(vid =>
      this.vertexAt(G.add(this.vp(vid), G.mul(n, eff)))));

    const sideIds = [];
    const extensions = []; // host faces that grew along the sweep (coplanar merge)
    const culled = [];     // internal partitions removed by the twin merge
    const buildSegment = (baseSet, endSet, offset, flip, allowMerge = true) => {
      for (let ri = 0; ri < baseSet.length; ri++) {
        const base = baseSet[ri], top = endSet[ri];
        for (let i = 0; i < base.length; i++) {
          const a0 = base[i], a1 = base[(i + 1) % base.length];
          const t0 = top[i], t1 = top[(i + 1) % base.length];
          if (ri === 0 && allowMerge && this.mergeIntoAdjacentWall(face, n, dist, a0, a1, t0, t1, extensions)) {
            continue; // the host wall absorbed this edge — no coplanar twin quad
          }
          if (!this.findEdge(a0, t0)) {
            const ve = { id: nid(), a: a0, b: t0, curveId: 0 };
            this._addEdge(ve);
          }
          if (!this.findEdge(t0, t1)) {
            const be = this.findEdge(a0, a1);
            let cid = 0;
            if (be && be.curveId) {
              const cm = this.curves.get(be.curveId);
              cid = nid();
              this.curves.set(cid, { ...cm, center: cm.center ? G.add(cm.center, G.mul(n, offset)) : cm.center });
            }
            const te = { id: nid(), a: t0, b: t1, curveId: cid };
            this._addEdge(te);
          }
          const loop = ri === 0 ? [a0, a1, t1, t0] : [a0, t0, t1, a1];
          // the segment beyond the rear face is SOLID material, not a carved
          // void: its walls face outward, opposite to the tunnel lining
          if (flip) loop.reverse();
          // B-rep invariant #3 — no double faces, no internal partitions: a
          // side quad exactly coincident with an existing face means the new
          // volume merges with whatever is behind it (two adjacent boxes
          // pushed to the same height, or a second pocket opening onto an
          // existing one). The partition is DELETED so the volumes union —
          // SketchUp leaves no wall between them and no sheet behind.
          // v0.7 ELEMENT INDEPENDENCE: when the pushed face and the twin
          // belong to DIFFERENT elements, the merge is refused — it deleted
          // the host's join-partition piece and skipped the new side,
          // leaving the T-joined/chained stub wall with only top+bottom
          // sheets (a wall that reads as "not built" until a params
          // rebuild restores its sides). Unstamped (free) geometry keeps
          // the SketchUp union.
          {
            const myStamp = face.userData && face.userData.bimEntityId;
            let twin = null;
            for (const f2 of this.faces.values()) {
              if (f2.id === face.id) continue;
              const s2 = f2.userData && f2.userData.bimEntityId;
              if (myStamp && s2 && s2 !== myStamp) continue; // two elements: never merge
              if (this.sameRing(f2.loop, loop)) { twin = f2; break; }
            }
            if (twin) {
              culled.push({ fid: twin.id, loop: [...twin.loop], color: twin.color, alpha: twin.alpha });
              this.faces.delete(twin.id);
              continue;
            }
          }
          const sf = { id: nid(), loop, holes: [], color: face.color, alpha: face.alpha, hidden: false, extrude: null, loose: face.loose || undefined,
            gid: face.gid || 0, userData: face.userData ? { ...face.userData } : null };
          this.faces.set(sf.id, sf);
          sideIds.push(sf.id);
        }
      }
    };
    if (past) {
      buildSegment(baseRings, midRings, sgn * through.t);          // reveal walls inside the body
      buildSegment(midRings, topRings, dist, true, false);         // continuation outside it (outward-facing, never merged)
    } else {
      buildSegment(baseRings, topRings, eff);
      // a POCKET (push against the face normal, into the surface) whose
      // lining walls break through a side of the host solid opens that
      // side: the coincident host face is holed/trimmed along each reveal
      // quad's ring and the quad itself is consumed (an L notch at a box
      // corner splits the front/left walls, it doesn't line them)
      if (dist < 0) {
        for (const sid of sideIds) {
          const sf = this.faces.get(sid);
          if (sf && (this.punchHole(sf) || this.trimHostByRing(sf))) this.faces.delete(sid);
        }
      }
    }
    if (through) {
      // cut the matching hole loop out of the opposing face and stitch the
      // reveal quads between the front opening and it
      const rearRing = past ? midRings[0] : topRings[0];
      through.face.holes.push([...rearRing]);
      this.edgesForRing(rearRing, true);
      if (past && exit && this.faces.has(exit.face.id)) {
        // a thick blocking body: punch its far skin too, so the sweep leaves
        // a real opening through it (a post through a roof slab holes both
        // faces; the tunnel walls between them come from the side segments)
        const exitRing = baseRings[0].map(vid =>
          this.vertexAt(G.add(this.vp(vid), G.mul(n, sgn * exit.t))));
        const ef = this.faces.get(exit.face.id);
        const c = this.pts(exitRing).reduce((s, p) => G.add(s, p), G.v(0, 0, 0));
        const centroid = G.mul(c, 1 / exitRing.length);
        const { u, v } = G.basisForNormal(n);
        const q = { x: G.dot(u, centroid), y: G.dot(v, centroid) };
        let inside = false;
        for (const ring of this.rings(ef)) {
          const R = ring.map(id => ({ x: G.dot(u, this.vp(id)), y: G.dot(v, this.vp(id)) }));
          let c2 = 0;
          for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
            if (((R[i].y > q.y) !== (R[j].y > q.y)) &&
              (q.x < (R[j].x - R[i].x) * (q.y - R[i].y) / (R[j].y - R[i].y) + R[i].x)) c2++;
          }
          inside = inside !== (c2 % 2 === 1); // even-odd across loop + holes
        }
        if (inside) {
          ef.holes.push([...exitRing]);
          this.edgesForRing(exitRing, true);
          // seam the sweep's wall quads at the exit plane: splice each exit
          // vert into the vertical edge crossing it, then divide every wall
          // carrying an adjacent exit pair (the hole in ef hides the line
          // from the interval scan, so the seam is made explicit here)
          for (let i = 0; i < exitRing.length; i++) {
            const a = exitRing[i], b = exitRing[(i + 1) % exitRing.length];
            for (const vid of [a, b]) {
              const p3 = this.vp(vid);
              for (const e of [...this.edges.values()]) {
                if (e.a === vid || e.b === vid) continue;
                const ea = this.vp(e.a), eb = this.vp(e.b);
                if (G.distToSeg(p3, ea, eb) < 1e-4 &&
                  G.dist(p3, ea) > 1e-4 && G.dist(p3, eb) > 1e-4) {
                  this.splitEdgeAt(e, p3);
                  break;
                }
              }
            }
            this.splitFacesAt(a, b, f => !!f.extrude);
          }
        }
      }
      if (past) {
        // the sweep continues outward: orient the end cap along the travel
        // direction so the protrusion reads as added material
        const travel = G.mul(n, sgn);
        for (const ring of topRings)
          if (G.dot(G.loopNormal(this.pts(ring)), travel) < 0) ring.reverse();
        face.extrude = {
          axis: n, anchor: anchorOuter, anchorHoles, sides: sideIds, cap: capId,
          extended: extensions, culled, through: { fid: through.face.id, ring: [...rearRing] },
        };
        face.loop = topRings[0];
        face.holes = topRings.slice(1);
        if (!this.noAutoIntersect && !loose) this.autoIntersect([face.id, ...sideIds, capId].filter(id => id != null && this.faces.has(id)));
        return true;
      }
      // exact through-punch: the sweep is consumed as a lined opening between
      // the host hole and the punched far face — no pushed face survives
      this.faces.delete(face.id);
      this.gc();
      if (!this.noAutoIntersect && !loose) this.autoIntersect([...sideIds].filter(id => this.faces.has(id)));
      return true;
    }
    face.extrude = { axis: n, anchor: anchorOuter, anchorHoles, sides: sideIds, cap: capId, extended: extensions, culled };
    face.loop = topRings[0];
    face.holes = topRings.slice(1);
    if (!this.noAutoIntersect && !loose) this.autoIntersect([face.id, ...sideIds, capId].filter(id => id != null && this.faces.has(id)));
    return true;
  }

  // Coplanar / shared-edge culling: the outer-ring edge (a0,a1) is shared
  // with a perpendicular host face (e.g. a box wall directly under it). A
  // quad here would be a coplanar twin of that wall. When the sweep pulls
  // AWAY from the wall, the wall is EXTENDED to follow the sweep instead
  // (recorded so collapse can revert it); sweeping INTO the wall keeps the
  // quad (it's a genuine carve wall). Returns true when the quad is skipped.
  mergeIntoAdjacentWall(face, n, dist, a0, a1, t0, t1, extensions) {
    const e = this.findEdge(a0, a1);
    if (!e) return false;
    for (const f2 of this.facesAdjacentToEdge(e)) {
      if (f2.id === face.id || f2.hidden) continue;
      const n2 = G.loopNormal(this.pts(f2.loop));
      if (G.isZero(n2) || Math.abs(G.dot(n2, n)) > 1e-6) continue; // perpendicular planes only
      let side = 0;
      for (const vid of f2.loop) {
        const s2 = G.dot(G.sub(this.vp(vid), this.vp(a0)), n);
        if (Math.abs(s2) > 1e-6) { side = s2; break; }
      }
      if (side === 0 || side * dist >= -1e-6) continue; // sweeping toward (or along) it: carve wall
      const L = f2.loop, k = L.length;
      for (let i = 0; i < k; i++) {
        const x = L[i], y = L[(i + 1) % k];
        if ((x === a0 && y === a1) || (x === a1 && y === a0)) {
          L.splice(i + 1, 0, x === a0 ? t0 : t1, x === a0 ? t1 : t0);
          this.edgesForRing(L, true);
          extensions.push({ fid: f2.id, a0, t0, t1, a1 });
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- 3D intersections
  // Axis-aligned bounding box of a face (outer loop + holes), padded by eps.
  faceAABB(f, eps = 1e-3) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const ring of this.rings(f)) {
      for (const vid of ring) {
        const p = this.vp(vid);
        if (!p) continue;
        lo[0] = Math.min(lo[0], p.x); lo[1] = Math.min(lo[1], p.y); lo[2] = Math.min(lo[2], p.z);
        hi[0] = Math.max(hi[0], p.x); hi[1] = Math.max(hi[1], p.y); hi[2] = Math.max(hi[2], p.z);
      }
    }
    return [lo[0] - eps, lo[1] - eps, lo[2] - eps, hi[0] + eps, hi[1] + eps, hi[2] + eps];
  }
  static aabbOverlap(a, b) {
    return a[0] <= b[3] && b[0] <= a[3] && a[1] <= b[4] && b[1] <= a[4] && a[2] <= b[5] && b[2] <= a[5];
  }

  // Intervals of the parameter t along the 3D line P0 + t*D that lie inside
  // face f's region (outer loop minus holes), in f's own plane.
  _lineInFaceIntervals(P0, D, f, n) {
    const { u, v } = G.basisForNormal(n);
    const o = this.vp(f.loop[0]);
    const to2 = p => G.to2D(p, o, u, v);
    const L0 = to2(P0);
    const L1 = to2(G.add(P0, D));
    const dx = L1.x - L0.x, dy = L1.y - L0.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return []; // line perpendicular to the plane — not a slice
    // crossings with every boundary edge (outer + holes) + on-line vertices
    const ts = [];
    const onLine = (p, eps) => Math.abs((p.x - L0.x) * dy - (p.y - L0.y) * dx) < eps * Math.sqrt(len2);
    for (const ring of this.rings(f)) {
      const R = ring.map(id => to2(this.vp(id)));
      const m = R.length;
      for (let i = 0; i < m; i++) {
        const a = R[i], b = R[(i + 1) % m];
        // t where the line crosses edge (a, b): solve L0 + t*(dx,dy) = a + s*(b-a)
        const ex = b.x - a.x, ey = b.y - a.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) > 1e-12) { // not parallel: proper crossing point
          const wx = a.x - L0.x, wy = a.y - L0.y;
          const t = (wx * ey - wy * ex) / den;
          const sq = (wx * dy - wy * dx) / den; // param along the edge (a -> b)
          if (sq >= -1e-6 && sq <= 1 + 1e-6) ts.push(t);
        }
        if (onLine(a, 1e-5)) {
          const t = Math.abs(dx) > Math.abs(dy) ? (a.x - L0.x) / dx : (a.y - L0.y) / dy;
          ts.push(t);
        }
      }
    }
    if (ts.length < 2) return [];
    ts.sort((x, y) => x - y);
    // merge near-equal ts, then keep intervals whose midpoint is inside the region
    const merged = [ts[0]];
    for (const t of ts.slice(1)) {
      if (t - merged[merged.length - 1] > 1e-7) merged.push(t);
    }
    const inside = p2 => {
      let crossings = 0;
      for (const ring of this.rings(f)) {
        const R = ring.map(id => to2(this.vp(id)));
        for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
          if (((R[i].y > p2.y) !== (R[j].y > p2.y)) &&
            (p2.x < (R[j].x - R[i].x) * (p2.y - R[i].y) / (R[j].y - R[i].y) + R[i].x)) crossings++;
        }
      }
      return crossings % 2 === 1;
    };
    const out = [];
    for (let i = 0; i + 1 < merged.length; i++) {
      const tm = (merged[i] + merged[i + 1]) / 2;
      const mid = { x: L0.x + tm * dx, y: L0.y + tm * dy };
      if (inside(mid)) out.push([merged[i], merged[i + 1]]);
    }
    return out;
  }

  // Intersect two non-parallel faces: compute the plane-plane line, the
  // overlap of the line's inside-intervals of both faces, and slice both
  // faces along the shared segment (welded endpoints, boundary edges split,
  // splitFacesAt divides every ring containing both endpoints).
  intersectFaces(A, B) {
    if (!this.faces.has(A.id) || !this.faces.has(B.id) || A.id === B.id) return false;
    const pA = this.pts(A.loop), pB = this.pts(B.loop);
    const nA = G.loopNormal(pA), nB = G.loopNormal(pB);
    if (G.isZero(nA) || G.isZero(nB)) return false;
    const D = G.cross(nA, nB);
    const D2 = G.dot(D, D);
    if (D2 < 1e-12) return false; // parallel/coplanar — 2D arrangement territory
    const dA = G.dot(nA, pA[0]), dB = G.dot(nB, pB[0]);
    // a point on both planes: P0 = (dA*(nB x D) + dB*(D x nA)) / |D|^2
    const P0 = G.mul(G.add(G.mul(G.cross(nB, D), dA), G.mul(G.cross(D, nA), dB)), 1 / D2);
    const scale = Math.sqrt(D2);
    const intervalsA = this._lineInFaceIntervals(P0, D, A, nA);
    const intervalsB = this._lineInFaceIntervals(P0, D, B, nB);
    if (!intervalsA.length || !intervalsB.length) return false;
    // they must actually cross somewhere along the line
    let overlap = false;
    for (const [a1, a2] of intervalsA) {
      for (const [b1, b2] of intervalsB) {
        if (Math.min(a2, b2) - Math.max(a1, b1) >= 1e-4 / scale) { overlap = true; break; }
      }
      if (overlap) break;
    }
    if (!overlap) return false;
    // faces that OWN extrude state keep their identity (incremental re-push
    // anchors — splitting them breaks straddle-push regression flows); their
    // intersections still slice every OTHER face, and pushPull's far-skin
    // punch opens them for hosted cuts
    const skipProtected = f => !!f.extrude;
    const f0 = this.faces.size, e0 = this.edges.size, v0 = this.vertices.size;
    // each face divides along ITS OWN inside-extent chord(s): interval ends
    // lie on that face's boundary, so the chord is a legal cut for it. The
    // shared-edge case (both rings already carrying the endpoints) divides
    // both faces in one splitFacesAt and the second pass no-ops (adjacent).
    for (const [src, ivs] of [[A, intervalsA], [B, intervalsB]]) {
      for (const [t1, t2] of ivs) {
        if (t2 - t1 < 1e-4 / scale) continue;
        const V1 = G.add(P0, G.mul(D, t1)), V2 = G.add(P0, G.mul(D, t2));
        const id1 = this.vertexAt(V1), id2 = this.vertexAt(V2);
        if (id1 === id2) continue;
        const cur = this.faces.get(src.id); // src may have been replaced by a split
        if (!cur) break;
        // split boundary edges that strictly contain an endpoint
        for (const P of [V1, V2]) {
          for (let i = 0; i < cur.loop.length; i++) {
            const aId = cur.loop[i], bId = cur.loop[(i + 1) % cur.loop.length];
            if (aId === id1 || aId === id2 || bId === id1 || bId === id2) continue;
            const a3 = this.vp(aId), b3 = this.vp(bId);
            if (G.distToSeg(P, a3, b3) < 1e-4 &&
              G.dist(P, a3) > 1e-4 && G.dist(P, b3) > 1e-4) {
              const e = this.findEdge(aId, bId);
              if (e) this.splitEdgeAt(e, P);
              break;
            }
          }
        }
        // the chord edge, pre-split at vertices already lying on it (the
        // other face's endpoints can sit mid-chord — an unsplit collinear
        // overlap leaves boundary edges no ring shares cleanly)
        const onChord = [];
        for (const [vid, v] of this.vertices) {
          if (vid === id1 || vid === id2) continue;
          if (G.distToSeg(v, V1, V2) < Model.WELD_EPS &&
            G.dist(v, V1) > Model.WELD_EPS && G.dist(v, V2) > Model.WELD_EPS)
            onChord.push({ t: G.dot(G.sub(v, V1), G.sub(V2, V1)), id: vid });
        }
        onChord.sort((p, q) => p.t - q.t);
        if (!this.findEdge(id1, id2)) {
          const eid = nid();
          this._addEdge({ id: eid, a: id1, b: id2, curveId: 0, gid: (cur.gid || A.gid) || 0 });
        }
        this.splitFacesAt(id1, id2, skipProtected); // divides every ring carrying both ends
        // then walk the chord, splitting each sub-edge at the next interior
        // vertex (splitEdgeAt splices it into every ring using the edge)
        let segA = id1;
        for (const oc of onChord) {
          const e = this.findEdge(segA, id2);
          if (e) this.splitEdgeAt(e, this.vp(oc.id));
          segA = oc.id;
        }
      }
    }
    // a real mutation grew the model (edge welded in, boundary split, or a
    // ring divided); overlaps that changed nothing — e.g. adjacent faces
    // already sharing the segment — must report false or callers re-seed
    // forever
    const changed = this.faces.size !== f0 || this.edges.size !== e0 || this.vertices.size !== v0;
    if (changed) this.gc();
    return changed;
  }

  // Broad-phase pass after geometry changes: slice every face whose AABB
  // overlaps a changed face, so crossing surfaces split automatically.
  // Faces are re-resolved by id every pair (splits REPLACE faces), and the
  // pieces a split creates are re-seeded so later faces cross them too
  // (a slab pushed through a wall must cut it at BOTH the top and the cap).
  autoIntersect(changedIds) {
    let queue = changedIds.filter(id => this.faces.has(id));
    const seen = new Set(); // id pairs already processed
    // v0.6 ELEMENT INDEPENDENCE (the IFC contract): faces belonging to
    // DIFFERENT BIM elements never intersect — elements intentionally
    // overlap by ELEMENT_EPS instead of welding/splitting into each other.
    // This is also the performance contract: a building is N independent
    // islands, so building element k costs O(k), not O(whole model). A
    // fresh (unstamped) face intersects only its owner's faces while a
    // build holds the model — bimHold carries the owning entity id when
    // known, or is truthy for a first build (owner '__new__'). Free-mode
    // drawing (bimHold falsy) keeps the classic behavior.
    const ownerCtx = this.bimOwner();
    const indepSkip = (a, b) => {
      const sa = a.userData && a.userData.bimEntityId;
      const sb = b.userData && b.userData.bimEntityId;
      if (sa && sb) return sa !== sb;         // two elements: never intersect
      if (ownerCtx) {                         // mid-build: fresh faces are the owner's
        const stamped = sa || sb;
        return !!stamped && stamped !== ownerCtx;
      }
      return false;                           // free mode: classic behavior
    };
    // An AABB is a pure function of the face's rings: memoize it for the
    // scan and drop entries only when an intersection mutates that face.
    // Recomputing both boxes for every candidate pair made this the single
    // hottest path in the app once a model passed a few hundred faces.
    const boxes = new Map();
    const box = f => { let b = boxes.get(f.id); if (b == null) boxes.set(f.id, b = this.faceAABB(f)); return b; };
    // SPATIAL HASH broad phase: a uniform 3D grid over face AABBs. Each
    // changed face asks only the cells it spans for candidates instead of
    // walking every face in the model — the changed x all product was the
    // split cascade's quadratic driver on multi-story frames. Faces created
    // by splits join the grid on demand (their ids re-seed the queue).
    const CELL = 4.0; // m — building scale: slabs span cells, treads share one
    const grid = new Map();
    const inGrid = new Set();
    const key = (ix, iy, iz) => ix + ',' + iy + ',' + iz;
    // faceAABB is a flat array [minx,miny,minz,maxx,maxy,maxz]
    // v0.6 PERF: during a build hold, faces stamped to OTHER elements can
    // never pair with anything (indepSkip rejects every pair) — indexing
    // them was pure waste: a 300-element rebuild re-inserted the whole
    // model's faces into the grid per element. Index only candidates.
    const ownerCtx0 = this.bimOwner();
    const indexable = f => {
      if (!ownerCtx0) return true;
      const s = f.userData && f.userData.bimEntityId;
      return !s || s === ownerCtx0;
    };
    const gridInsert = id => {
      const f = this.faces.get(id);
      if (!f || f.hidden || inGrid.has(id) || !indexable(f)) return;
      inGrid.add(id);
      const b = box(f);
      for (let ix = Math.floor(b[0] / CELL); ix <= Math.floor(b[3] / CELL); ix++)
        for (let iy = Math.floor(b[1] / CELL); iy <= Math.floor(b[4] / CELL); iy++)
          for (let iz = Math.floor(b[2] / CELL); iz <= Math.floor(b[5] / CELL); iz++) {
            const k = key(ix, iy, iz);
            let set = grid.get(k);
            if (!set) grid.set(k, set = new Set());
            set.add(id);
          }
    };
    const gridQuery = b => {
      const out = new Set();
      for (let ix = Math.floor(b[0] / CELL); ix <= Math.floor(b[3] / CELL); ix++)
        for (let iy = Math.floor(b[1] / CELL); iy <= Math.floor(b[4] / CELL); iy++)
          for (let iz = Math.floor(b[2] / CELL); iz <= Math.floor(b[5] / CELL); iz++) {
            const set = grid.get(key(ix, iy, iz));
            if (set) for (const id of set) out.add(id);
          }
      return out;
    };
    for (const id of this.faces.keys()) gridInsert(id);
    let guard = 0;
    while (queue.length && guard++ < 64) {
      const next = [];
      let mutated = false;
      for (const cid of queue) {
        gridInsert(cid); // split-born faces join the index before querying
        const A0 = this.faces.get(cid);
        if (!A0) continue;
        for (const fid of gridQuery(box(A0))) {
          const f = this.faces.get(fid); // stale grid entries resolve to null
          if (!f || f.hidden || f.id === cid) continue;
          const pk = cid < f.id ? cid + 'x' + f.id : f.id + 'x' + cid;
          if (seen.has(pk)) continue;
          seen.add(pk);
          const A = this.faces.get(cid); // fresh: a split may have replaced it
          if (!A) break;
          if (indepSkip(A, f)) continue;  // v0.6: different elements never cut
          if (!Model.aabbOverlap(box(A), box(f))) continue;
          const ids0 = new Set(this.faces.keys());
          if (this.intersectFaces(A, f)) {
            mutated = true;
            boxes.delete(cid); // rings changed under the intersection
            boxes.delete(f.id);
            for (const nid2 of this.faces.keys()) if (!ids0.has(nid2)) {
              next.push(nid2);
              gridInsert(nid2); // born faces are candidates for later cids NOW
            }
          }
        }
      }
      if (!mutated) break;
      queue = [...new Set(next)];
    }
  }

  // A parallel face the push sweep crosses before its full distance: pushing
  // through it should punch a hole rather than overlap the far side.
  findBlockingFace(face, ring, n, dist) {
    const dir = G.mul(n, Math.sign(dist));
    const L = Math.abs(dist);
    const p0 = this.vp(ring[0]);
    let best = null;
    for (const f2 of this.faces.values()) {
      if (f2.id === face.id || f2.hidden) continue;
      // v0.6: a FOREIGN element's face never blocks a BIM build's sweep —
      // the element overlaps past it (bearing EPS) instead of punching it
      if (this.bimHold && !this.hostCuttableBy(f2)) continue;
      // (no group-scope guard: the back face is found geometrically)
      if (f2.holes.length) continue;
      const q = this.pts(f2.loop);
      const n2 = G.loopNormal(q);
      if (G.isZero(n2) || G.len(G.cross(n, n2)) > 1e-6) continue; // parallel planes only
      const t = G.dot(G.sub(q[0], p0), dir);
      if (t <= 2e-3 || t > L + 1e-6) continue;
      const ring3 = ring.map(vid => G.add(this.vp(vid), G.mul(dir, t)));
      if (!this.ringInsideFace(ring3, f2)) continue;
      if (!best || t < best.t) best = { face: f2, t };
    }
    return best;
  }

  // strict containment of a world-space ring inside f's outer loop (punchable)
  ringInsideFace(ringPts, f) {
    const gPts = this.pts(f.loop);
    const gn = G.loopNormal(gPts);
    if (G.isZero(gn)) return false;
    const { u, v } = G.basisForNormal(gn);
    const inLoop = (p, poly) => {
      const q = poly.map(x => G.to2D(x, poly[0], u, v));
      const P = G.to2D(p, poly[0], u, v);
      let inside = false;
      for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
        if (((q[i].y > P.y) !== (q[j].y > P.y)) &&
          (P.x < (q[j].x - q[i].x) * (P.y - q[i].y) / (q[j].y - q[i].y) + q[i].x)) inside = !inside;
      }
      return inside;
    };
    if (!ringPts.every(p => inLoop(p, gPts))) return false;
    if (gPts.some(p => inLoop(p, ringPts))) return false; // partial overlap
    for (const h of f.holes) {
      const hPts = this.pts(h);
      if (hPts.some(p => inLoop(p, ringPts)) || ringPts.some(p => inLoop(p, hPts))) return false;
    }
    return true;
  }

  collapseExtrude(face) {
    const E = face.extrude; if (!E) return;
    (E.sides || []).forEach(id => this.faces.delete(id));
    if (E.cap) this.faces.delete(E.cap);
    // partitions culled when this extrusion merged with a neighbor come back,
    // so the neighbor's shell closes again where this one collapses away
    for (const c of (E.culled || [])) {
      if (!this.faces.has(c.fid)) {
        this.faces.set(c.fid, {
          id: c.fid, loop: [...c.loop], holes: [], color: c.color, alpha: c.alpha,
          hidden: false, extrude: null, gid: face.gid || 0,
        });
        this.edgesForRing(c.loop, true);
      }
    }
    // a through-punch also punched the rear face — heal that hole so the
    // body closes again when the extrusion collapses
    if (E.through) {
      const rear = this.faces.get(E.through.fid);
      if (rear) rear.holes = rear.holes.filter(h => !this.sameRing(h, E.through.ring));
    }
    // walls that were extended along the sweep shrink back to their old edge
    for (const ex of (E.extended || [])) {
      const f2 = this.faces.get(ex.fid);
      if (!f2) continue;
      const L = f2.loop, k = L.length;
      for (let i = 0; i < k; i++) {
        if (L[i] === ex.a0 && L[(i + 1) % k] === ex.t0 && L[(i + 2) % k] === ex.t1 && L[(i + 3) % k] === ex.a1) {
          L.splice(i + 1, 2); break;
        }
        if (L[i] === ex.a1 && L[(i + 1) % k] === ex.t1 && L[(i + 2) % k] === ex.t0 && L[(i + 3) % k] === ex.a0) {
          L.splice(i + 1, 2); break;
        }
      }
      this.edgesForRing(L, true);
    }
    const topVerts = new Set(this.rings(face).flat());
    // only remove edges no surviving face still uses (a shared wall from a
    // coincident-quad skip, or extended walls, must survive this collapse)
    const usedElsewhere = new Set();
    for (const f2 of this.faces.values()) {
      if (f2.id === face.id) continue; // deleted sides/cap are already gone
      for (const ring of this.rings(f2)) {
        for (let i = 0; i < ring.length; i++) {
          const e2 = this.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (e2) usedElsewhere.add(e2.id);
        }
      }
    }
    for (const [id, e] of [...this.edges])
      if ((topVerts.has(e.a) || topVerts.has(e.b)) && !usedElsewhere.has(id)) this._delEdge(id);
    face.loop = E.anchor;
    face.holes = E.anchorHoles || [];
    face.extrude = null;
    this.gc();
  }

  // ---------------------------------------------------------------- queries
  facePlane(f) {
    const n = G.loopNormal(this.pts(f.loop));
    return { n, d: G.dot(n, this.vp(f.loop[0])) };
  }
  // NET face area: the outer loop minus any holes (openings). A wall side
  // with a 1x1 window in a 3x1 face reports 2 m², not 3 m².
  faceArea(f) {
    let a = G.loopArea(this.pts(f.loop));
    if (f.holes && f.holes.length)
      for (const h of f.holes) a -= G.loopArea(this.pts(h));
    return Math.max(0, a);
  }
  faceCentroid(f) {
    const p = this.pts(f.loop);
    const c = G.v();
    p.forEach(q => { c.x += q.x; c.y += q.y; c.z += q.z; });
    return G.mul(c, 1 / p.length);
  }
  bbox(vids) {
    let mn = G.v(Infinity, Infinity, Infinity), mx = G.v(-Infinity, -Infinity, -Infinity);
    for (const vid of vids) {
      const p = this.vp(vid); if (!p) continue;
      mn = G.v(Math.min(mn.x, p.x), Math.min(mn.y, p.y), Math.min(mn.z, p.z));
      mx = G.v(Math.max(mx.x, p.x), Math.max(mx.y, p.y), Math.max(mx.z, p.z));
    }
    if (mn.x === Infinity) return null;
    return { min: mn, max: mx, center: G.mul(G.add(mn, mx), 0.5), size: G.sub(mx, mn) };
  }
  transformVertices(vids, fn) {
    const seen = new Set(vids);
    for (const vid of seen) {
      const p = this.vp(vid);
      if (p) this.setVertex(vid, fn(G.clone(p)));
    }
  }
  clearExtrudes() { for (const f of this.faces.values()) f.extrude = null; }

  // ------------------------------------------------------- edge display style
  // Per-edge CAD display properties (the Properties panel writes these):
  //   lt — linetype index (Model.LINETYPES); null/undefined = ByLayer
  //   lw — lineweight index (Model.LINEWEIGHTS); null/undefined = ByLayer
  //   layerId — the layer a RAW (entity-less) edge/face belongs to
  // An edge owned by a BIM entity resolves its style from the ENTITY's layer
  // instead; raw geometry resolves from its own layerId ('0' by default).
  setEdgeStyle(edgeIds, patch) {
    let n = 0;
    for (const id of edgeIds) {
      const e = this.edges.get(id);
      if (!e) continue;
      if ('lt' in patch) e.lt = patch.lt;
      if ('lw' in patch) e.lw = patch.lw;
      if ('layerId' in patch) e.layerId = patch.layerId;
      n++;
    }
    if (n) this.touch();
    return n;
  }
  setFaceLayers(faceIds, layerId) {
    let n = 0;
    for (const id of faceIds) {
      const f = this.faces.get(id);
      if (!f) continue;
      f.layerId = layerId;
      n++;
    }
    if (n) this.touch();
    return n;
  }
  _layerOf(obj) {
    if (!obj) return null;
    const lid = obj.layerId || '0';
    return this.layers.find(l => l.id === lid) || null;
  }
  /** Effective render style of an edge: explicit value, else its layer's
   *  default, else Continuous/Default. Returns {lt, lw, layer}. */
  resolveEdgeStyle(e) {
    if (!e) return { lt: 0, lw: 0, layer: null };
    const eu = e.userData && e.userData.bimEntityId;
    let layer = null;
    if (eu) {
      const ent = (this.bimEntities || []).find(x => x.id === eu);
      layer = ent && this.layers.find(l => l.id === ent.layerId);
    }
    if (!layer) layer = this._layerOf(e);
    return {
      lt: e.lt != null ? e.lt : (layer ? (layer.lt || 0) : 0),
      lw: e.lw != null ? e.lw : (layer ? (layer.lw || 0) : 0),
      layer,
    };
  }

  // Edge "thickness" (AutoCAD's DXF-39): extrude the line vertically into a
  // ribbon face. The born face is tracked from the edge (userData.thickFace)
  // so the panel can re-set or clear the value later.
  thickenEdge(eid, dist) {
    const e = this.edges.get(eid);
    if (!e) return null;
    this.unthickenEdge(eid);
    if (!dist || Math.abs(dist) < 1e-6) return null;
    const a = this.vp(e.a), b = this.vp(e.b);
    const z = G.v(0, 0, dist);
    const f = this.addFaceFromRings([G.add(a, z), G.add(b, z), b, a]);
    if (!f) return null;
    if (!e.userData) e.userData = {};
    e.userData.thickFace = f.id;
    f.userData = { fromEdge: eid };
    return f;
  }
  unthickenEdge(eid) {
    const e = this.edges.get(eid);
    const fid = e && e.userData && e.userData.thickFace;
    if (fid == null) return false;
    const f = this.faces.get(fid);
    if (f) { this.deleteFace(fid, true); this.gc(); }
    if (e && e.userData) delete e.userData.thickFace;
    return !!f;
  }
  edgeThickness(eid) {
    const e = this.edges.get(eid);
    const fid = e && e.userData && e.userData.thickFace;
    if (fid == null || !this.faces.has(fid)) return 0;
    const f = this.faces.get(fid);
    const zs = this.pts(f.loop).map(p => p.z);
    return Math.max(...zs) - Math.min(...zs);
  }

  // ------------------------------------------------------------ sweep builders
  // Shared core of Revolve / Sweep (Follow Me) / Loft: connect N rings (each
  // an equal-length ordered point loop) with quad faces. Rings may be open
  // polylines (a strip) or closed loops; `closed` connects the last ring back
  // to the first (a full revolution); caps close the profile at the ends.
  // Degenerate quads (poles, repeated points) are skipped silently — the
  // caller cannot always avoid them (a revolve apex).
  loftRings(rings, { closed = false, capStart = true, capEnd = true, color = null, ringClosed = true, loose = false } = {}) {
    if (!rings || rings.length < 2) return [];
    const n = rings[0].length;
    if (rings.some(r => r.length !== n)) return [];
    const out = [];
    const quad = (a, b, c, d) => {
      if (G.loopArea([a, b, c, d]) < 1e-10) return;
      const f = this.addFaceFromRings([a, b, c, d], [], loose ? { standalone: true } : undefined);
      if (f) { if (color != null) f.color = color; out.push(f.id); }
    };
    const last = closed ? rings.length : rings.length - 1;
    const segs = ringClosed ? n : n - 1; // a closed profile ring wraps (j+1)%n
    for (let i = 0; i < last; i++) {
      const R0 = rings[i], R1 = rings[(i + 1) % rings.length];
      for (let j = 0; j < segs; j++) {
        const j2 = (j + 1) % n;
        quad(G.clone(R0[j]), G.clone(R0[j2]), G.clone(R1[j2]), G.clone(R1[j]));
      }
    }
    const cap = (ring) => {
      const f = this.addFaceFromRings(ring.map(G.clone), [], loose ? { standalone: true } : undefined);
      if (f) out.push(f.id);
    };
    if (capStart) cap(rings[0]);
    if (capEnd) cap(rings[rings.length - 1]);
    return out;
  }

  // ------------------------------------------------------------ rebar
  /** A reinforcement bar: a solid tube of `diameter` swept along a polyline
   *  centerline. One ring per path vertex (mitered by the bisector tangent,
   *  parallel-transported so planar paths never twist), lofted into LOOSE
   *  standalone faces — rebar never welds into the host B-Rep, so editing or
   *  deleting concrete leaves bars untouched. Faces carry userData.rebar
   *  {shape, diameter, length, ...meta} for the future schedules. */
  addRebarPath(pts, diameter, { color = null, ringSegs = 12, meta = null } = {}) {
    const P = [];
    for (const q of pts) {
      const c = G.clone(q);
      if (!P.length || G.dist(P[P.length - 1], c) > 1e-6) P.push(c);
    }
    if (P.length < 2 || !(diameter > 1e-6)) return [];
    const r = diameter / 2;
    const dirs = P.map((p, i) => {
      const d0 = i > 0 ? G.sub(P[i], P[i - 1]) : null;
      const d1 = i < P.length - 1 ? G.sub(P[i + 1], p) : null;
      let d = d0 && d1 ? G.add(G.norm(d0), G.norm(d1)) : (d0 || d1);
      if (G.len(d) < 1e-9) d = d0 || d1; // 180° fold-back: keep the segment
      return G.norm(G.clone(d));
    });
    const anyPerp = t => (Math.abs(t.z) < 0.9
      ? G.norm(G.cross(G.v(0, 0, 1), t))
      : G.norm(G.cross(G.v(1, 0, 0), t)));
    let b1 = null;
    const rings = P.map((p, i) => {
      const t = dirs[i];
      if (!b1) b1 = anyPerp(t);
      else {
        b1 = G.sub(b1, G.mul(t, G.dot(b1, t))); // transport: re-project ⟂ t
        if (G.len(b1) < 1e-9) b1 = anyPerp(t); else b1 = G.norm(b1);
      }
      const b2 = G.norm(G.cross(t, b1));
      const ring = [];
      for (let j = 0; j < ringSegs; j++) {
        const a = (j / ringSegs) * Math.PI * 2;
        ring.push(G.add(p, G.add(G.mul(b1, Math.cos(a) * r), G.mul(b2, Math.sin(a) * r))));
      }
      return ring;
    });
    const out = this.loftRings(rings, { closed: false, capStart: true, capEnd: true, color, loose: true });
    let length = 0;
    for (let i = 1; i < P.length; i++) length += G.dist(P[i - 1], P[i]);
    for (const id of out) {
      const f = this.faces.get(id);
      if (!f) continue;
      f.userData = { ...(f.userData || {}), rebar: { ...(meta || {}), diameter, length: +length.toFixed(6) } };
      // edges carry the tag too: bulk selections (Ctrl+A) must not silently
      // grab rebar hidden inside concrete — deleting "the element" would
      // take the invisible cage with it
      for (const ring of this.rings(f))
        for (let i = 0; i < ring.length; i++) {
          const e = this.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (e && !e.userData) e.userData = { rebar: true };
        }
    }
    return out;
  }

  /** Revolve a profile face about the axis P1->P2 (SketchUp Follow-Me around
   *  a circle, OCS REVOLVE). angleDeg defaults to 360 (a closed torus/solid);
   *  partial turns cap both ends. Consumes the profile face on success.
   *  Returns { faces } or { error }. */
  revolveFace(faceId, P1, P2, angleDeg = 360, segs = 24) {
    const f = this.faces.get(faceId);
    if (!f) return { error: 'profile face is gone' };
    if ((f.holes || []).length) return { error: 'profiles with openings cannot revolve yet' };
    const axisV = G.sub(P2, P1);
    if (G.len(axisV) < 1e-6) return { error: 'axis points coincide' };
    const axis = G.norm(G.clone(axisV));
    const ring = this.pts(f.loop);
    // the RING (the swept boundary) must clear the axis: a vertex on it or a
    // segment crossing it folds the surface through itself. The disk's
    // interior is irrelevant — revolving a loop yields a surface (a torus
    // around a nearby axis is fine).
    const perpOf = p => {
      const d = G.sub(p, P1);
      return G.sub(d, G.mul(axis, G.dot(d, axis)));
    };
    for (const p of ring) {
      if (G.len(perpOf(p)) < 1e-5) return { error: 'the axis touches the profile — offset it first' };
    }
    for (let i = 0; i < ring.length; i++) {
      const o1 = perpOf(ring[i]), o2 = perpOf(ring[(i + 1) % ring.length]);
      const dv = G.sub(o2, o1);
      // distance from the axis line to the EDGE's own line, with the closest
      // point inside the segment: zero means the edge crosses the axis
      const c = G.cross(o1, o2);
      const dist = G.len(c) / Math.max(G.len(dv), 1e-12);
      const t = -G.dot(o1, dv) / Math.max(G.dot(dv, dv), 1e-12);
      if (dist < 1e-5 && t >= 0 && t <= 1)
        return { error: 'the axis crosses the profile — offset it first' };
    }
    const ang = Math.abs(angleDeg) > 0.1 ? Math.abs(angleDeg) * Math.PI / 180 : Math.PI * 2;
    const n = Math.max(6, Math.min(64, segs));
    const closed = ang >= Math.PI * 2 - 1e-6;
    const step = closed ? ang / n : ang / Math.max(1, n - 1);
    const rings = [];
    for (let i = 0; i < n; i++)
      rings.push(ring.map(p => G.rotatePoint(G.clone(p), P1, axis, step * i)));
    const faces = this.loftRings(rings, { closed, capStart: !closed, capEnd: !closed, color: f.color });
    this.deleteFace(faceId, true);
    this.gc();
    return { faces };
  }

  /** Sweep a profile face along a path polyline (SketchUp's Follow Me). The
   *  profile's frame parallel-transports along the path — no twist on planar
   *  paths, natural banking through corners. Consumes the profile; the PATH
   *  stays (SketchUp parity). Returns { faces } or { error }. */
  sweepFaceAlongPath(faceId, path) {
    const f = this.faces.get(faceId);
    if (!f) return { error: 'profile face is gone' };
    if ((f.holes || []).length) return { error: 'profiles with openings cannot sweep yet' };
    if (!path || path.length < 2) return { error: 'path is too short' };
    const ring = this.pts(f.loop);
    // profile frame: origin = ring centroid, normal from the ring
    const c = ring.reduce((s, p) => G.add(s, p), G.v(0, 0, 0));
    const O = G.mul(c, 1 / ring.length);
    let nrm = G.loopNormal(ring);
    if (G.isZero(nrm)) return { error: 'profile is degenerate' };
    nrm = G.norm(nrm);
    // local profile coordinates (u, v) in the plane, centered on the centroid
    const { u, v } = G.basisForNormal(nrm);
    const local = ring.map(p => G.v(G.dot(G.sub(p, O), u), G.dot(G.sub(p, O), v), 0));
    // transport the frame along the path
    let T = nrm, U = u;
    const sections = [];
    for (let i = 0; i < path.length; i++) {
      if (i > 0) {
        const d = G.norm(G.sub(path[i], path[i - 1]));
        const T2 = G.norm(G.add(T, d)); // parallel transport: bisector
        if (G.isZero(T2)) { /* 180° turn: keep the frame */ }
        else {
          const rot = G.cross(T, T2);
          const ang = Math.asin(Math.max(-1, Math.min(1, G.len(rot))));
          if (ang > 1e-9) {
            U = G.rotatePoint(U, G.v(0, 0, 0), G.norm(rot), ang);
            T = T2;
          }
        }
      }
      const V = G.cross(T, U);
      sections.push(local.map(q => G.add(path[i], G.add(G.mul(U, q.x), G.mul(V, q.y)))));
    }
    const faces = this.loftRings(sections, { closed: false, capStart: true, capEnd: true, color: f.color });
    this.deleteFace(faceId, true);
    this.gc();
    return { faces };
  }

  // ---------------------------------------------------------------- groups
  createGroup(sel, name) {
    const gid = nid();
    const eids = new Set([...sel.edges]);
    for (const id of sel.faces) {
      const f = this.faces.get(id);
      if (!f) continue;
      f.gid = gid;
      for (const ring of this.rings(f))
        for (let i = 0; i < ring.length; i++) {
          const e = this.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (e) eids.add(e.id);
        }
    }
    for (const id of eids) { const e = this.edges.get(id); if (e) e.gid = gid; }
    const g = { id: gid, name: name || ('Group ' + (this.groups.size + 1)), solid: false };
    this.groups.set(gid, g);
    return g;
  }
  ungroup(gid) {
    for (const f of this.faces.values()) if (f.gid === gid) f.gid = 0;
    for (const e of this.edges.values()) if (e.gid === gid) e.gid = 0;
    this.groups.delete(gid);
  }
  groupEntities(gid) {
    const out = { faces: new Set(), edges: new Set() };
    for (const f of this.faces.values()) if (f.gid === gid) out.faces.add(f.id);
    for (const e of this.edges.values()) if (e.gid === gid) out.edges.add(e.id);
    return out;
  }
  pruneGroups() {
    for (const gid of [...this.groups.keys()]) {
      const ent = this.groupEntities(gid);
      if (!ent.faces.size && !ent.edges.size) this.groups.delete(gid);
    }
  }

  // ---------------------------------------------------------------- shell analysis
  // Consistently orient a set of faces (BFS across shared edges).
  // Returns Map faceId -> oriented loop (vertex ids, possibly reversed).
  // Orient loops face-by-face into internally-consistent orientation trees.
  // Propagation walks OUTER-ring adjacencies; subshells that connect only
  // through a face hole (a punched host + the tube rising from the opening)
  // seed independently — their absolute sign is resolved geometrically by
  // shellVolume, since the codebase's hole-ring winding conventions differ
  // between punch paths. When `trees` is passed, one {fid -> oriented loop}
  // Map is pushed per tree.
  orientLoops(faceIds, trees = null, byPos = false) {
    const faces = faceIds.map(id => this.faces.get(id)).filter(Boolean);
    // byPos: adjacency by COINCIDENT POSITION (±0.01 mm), not vertex id —
    // standalone (loose) faces duplicate their vertices, and orientation
    // must still propagate across the seam or a shell flips patchwise
    const vkey = byPos
      ? v => {
        const p = this.vp(v);
        return Math.round(p.x * 1e5) + ',' + Math.round(p.y * 1e5) + ',' + Math.round(p.z * 1e5);
      }
      : v => String(v);
    const loops = new Map();
    const byEdge = new Map(); // "ka|kb" (sorted) -> [{fid, ka, kb}]
    const key = (a, b) => { const ka = vkey(a), kb = vkey(b); return ka < kb ? ka + '_' + kb : kb + '_' + ka; };
    for (const f of faces) {
      loops.set(f.id, [...f.loop]);
      for (const L of this.rings(f)) { // hole rings propagate winding too
        for (let i = 0; i < L.length; i++) {
          const a = L[i], b = L[(i + 1) % L.length];
          const k = key(a, b);
          if (!byEdge.has(k)) byEdge.set(k, []);
          byEdge.get(k).push({ fid: f.id, ka: vkey(a), kb: vkey(b) });
        }
      }
    }
    const flip = new Map(); // fid -> bool
    for (const f of faces) {
      if (flip.has(f.id)) continue;
      flip.set(f.id, false);
      const tree = new Map();
      const q = [f.id];
      while (q.length) {
        const fid = q.pop();
        tree.set(fid, null);
        const flipped = flip.get(fid);
        const L = loops.get(fid);
        const n = L.length;
        for (let i = 0; i < n; i++) {
          const a = L[i], b = L[(i + 1) % n];
          const ka = vkey(flipped ? b : a), kb = vkey(flipped ? a : b); // effective directed edge
          for (const g of byEdge.get(key(a, b)) || []) {
            if (g.fid === fid || flip.has(g.fid)) continue;
            // neighbor must traverse the shared edge in the opposite direction
            flip.set(g.fid, (g.ka === ka && g.kb === kb));
            q.push(g.fid);
          }
        }
      }
      for (const fid of tree.keys()) tree.set(fid, flip.get(fid) ? [...loops.get(fid)].reverse() : loops.get(fid));
      if (trees) trees.push(tree);
    }
    const out = new Map();
    for (const [fid, L] of loops) out.set(fid, flip.get(fid) ? [...L].reverse() : L);
    return out;
  }

  // Even-odd ray crossing count of one face (outer + hole rings): 0 or 1.
  _rayCrossesFace(p, d, f) {
    const pts = this.pts(f.loop);
    if (pts.length < 3) return 0;
    const n = G.loopNormal(pts);
    if (G.isZero(n)) return 0;
    const dn = G.dot(d, n);
    if (Math.abs(dn) < 1e-9) return 0; // parallel
    const t = (G.dot(n, pts[0]) - G.dot(n, p)) / dn;
    if (t <= 1e-9) return 0;
    const hit = G.add(p, G.mul(d, t));
    const { u, v } = G.basisForNormal(n);
    const q = G.to2D(hit, pts[0], u, v);
    let inside = false;
    for (const ring of this.rings(f)) {
      const R = ring.map(id => G.to2D(this.vp(id), pts[0], u, v));
      let c = 0;
      for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
        if (((R[i].y > q.y) !== (R[j].y > q.y)) &&
          (q.x < (R[j].x - R[i].x) * (q.y - R[i].y) / (R[j].y - R[i].y) + R[i].x)) c++;
      }
      if (c % 2 === 1) inside = !inside;
    }
    return inside ? 1 : 0;
  }

  // Number of open (boundary) edges among these faces; 0 = watertight shell.
  shellOpenEdges(faceIds) {
    const counts = new Map();
    const key = (a, b) => a < b ? a + '_' + b : b + '_' + a;
    for (const id of faceIds) {
      const f = this.faces.get(id);
      if (!f) continue;
      for (const ring of this.rings(f))
        for (let i = 0; i < ring.length; i++) {
          const k = key(ring[i], ring[(i + 1) % ring.length]);
          counts.set(k, (counts.get(k) || 0) + 1);
        }
    }
    let open = 0;
    for (const c of counts.values()) if (c !== 2) open++;
    return open;
  }

  // Enclosed volume of a face set. Each orientation tree is signed
  // geometrically: a probe just along a face's oriented normal must land
  // OUTSIDE the material (even ray-crossing parity over the whole set) for
  // an outward-oriented shell — so a punched host plus the tube rising from
  // its opening (separate trees, hole-connected) both count with the right
  // sign without relying on stored hole-ring winding conventions.
  shellVolume(faceIds) {
    const trees = [];
    this.orientLoops(faceIds, trees);
    const faces = faceIds.map(id => this.faces.get(id)).filter(Boolean);
    const contribOf = vids => {
      const pts = this.pts(vids);
      if (pts.length < 3) return 0;
      const N = G.newell(pts);
      let cx = 0, cy = 0, cz = 0;
      for (const p of pts) { cx += p.x; cy += p.y; cz += p.z; }
      return (N.x * cx + N.y * cy + N.z * cz) * (1 / pts.length) / 6;
    };
    // deterministic off-axis jitter keeps the probe ray off shared edges
    const sigmaOf = tree => {
      for (const [fid, loop] of tree) {
        const pts = loop.map(id => this.vp(id));
        if (pts.some(p => !p) || pts.length < 3) continue;
        const N = G.newell(pts);
        const len = G.len(N);
        if (len < 1e-9) continue;
        const n = G.mul(N, 1 / len);
        let cx = 0, cy = 0, cz = 0;
        for (const p of pts) { cx += p.x; cy += p.y; cz += p.z; }
        const c = { x: cx / pts.length, y: cy / pts.length, z: cz / pts.length };
        const probe = G.add(c, G.mul(n, 1e-4));
        const d = G.norm(G.add(n, G.v(0.0137, 0.0059, 0.0113)));
        let count = 0;
        for (const f of faces) count += this._rayCrossesFace(probe, d, f);
        return count % 2 === 0 ? 1 : -1;
      }
      return 1;
    };
    let vol = 0;
    for (const tree of trees) {
      const sigma = sigmaOf(tree);
      for (const [fid, loop] of tree) {
        vol += sigma * contribOf(loop);
        const f = this.faces.get(fid);
        if (f && f.holes) {
          const N0 = G.newell(this.pts(loop));
          for (const h of f.holes) {
            const Nh = G.newell(this.pts(h));
            vol -= sigma * Math.sign(G.dot(Nh, N0) || 1) * contribOf(h); // holes subtract material
          }
        }
      }
    }
    return Math.abs(vol);
  }

  // ---------------------------------------------------------------- thicken
  // Offset a copy of the selected faces by t along smoothed vertex normals
  // (mitered so thickness stays uniform across creases), flip its winding,
  // and bridge the open boundary with side walls — a closed solid shell.
  // Returns face descriptors: [{outer: [pts], holes: [[pts]], color, alpha, gid, reverse}]
  thickenGeometry(faceIds, t) {
    const faces = faceIds.map(id => this.faces.get(id)).filter(Boolean);
    if (!faces.length || Math.abs(t) < 1e-6) return [];
    // POSITION-KEYED ANALYSIS: standalone (loose) faces carry private copies
    // of coincident vertices, so keying anything by vertex id shears a
    // curved shell apart at every seam — each plate would offset along its
    // own facet normal and seams would count as open boundary. Normals,
    // orientation, and boundary detection all see through the duplication:
    // vertices within 0.01 mm are one position, edges match by position pair.
    const pkey = v => {
      const p = this.vp(v);
      return Math.round(p.x * 1e5) + ',' + Math.round(p.y * 1e5) + ',' + Math.round(p.z * 1e5);
    };
    const oriented = this.orientLoops(faceIds, null, true);
    // per-position normals from all selected faces (outer + hole rings) —
    // smoothed across every adjacent face sharing the position
    const vNormals = new Map();
    const addN = (v, n) => {
      const k = pkey(v);
      if (!vNormals.has(k)) vNormals.set(k, []);
      vNormals.get(k).push(n);
    };
    for (const [fid, loop] of oriented) {
      const f = this.faces.get(fid);
      const n = G.loopNormal(this.pts(loop));
      if (G.isZero(n)) continue;
      for (const v of loop) addN(v, n);
      for (const h of f.holes) for (const v of h) addN(v, n);
    }
    const D = new Map(); // position key -> offset vector (V_offset = V + D)
    for (const [k, ns] of vNormals) D.set(k, G.miterOffset(ns, t));

    const off = (vid) => {
      const p = this.vp(vid);
      const d = D.get(pkey(vid)) || G.v();
      return G.add(p, d);
    };
    const out = [];
    for (const [fid, loop] of oriented) {
      const f = this.faces.get(fid);
      out.push({
        outer: loop.map(off),
        holes: f.holes.map(h => h.map(off)),
        color: f.color, alpha: f.alpha, gid: f.gid || 0, reverse: true,
      });
    }
    // side walls on boundary edges — an edge (BY POSITION) used by exactly
    // one selected face is the open rim of the shell; bridge it between the
    // original and the offset surface to seal the volume
    const counts = new Map();
    const key = (a, b) => { const ka = pkey(a), kb = pkey(b); return ka < kb ? ka + '_' + kb : kb + '_' + ka; };
    for (const [fid, loop] of oriented) {
      for (let i = 0; i < loop.length; i++) {
        const k = key(loop[i], loop[(i + 1) % loop.length]);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    for (const [fid, loop] of oriented) {
      const f = this.faces.get(fid);
      const gid = f.gid || 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        if (counts.get(key(a, b)) !== 1) continue;
        out.push({
          outer: [this.vp(a), this.vp(b), off(b), off(a)],
          holes: [], color: f.color, alpha: f.alpha, gid, reverse: false, quad: true,
        });
      }
      for (const h of f.holes) {
        for (let i = 0; i < h.length; i++) {
          const a = h[i], b = h[(i + 1) % h.length];
          if (counts.get(key(a, b)) !== 1) continue;
          out.push({
            outer: [this.vp(a), this.vp(b), off(b), off(a)],
            holes: [], color: f.color, alpha: f.alpha, gid, reverse: false, quad: true, holeWall: true,
          });
        }
      }
    }
    return out;
  }

  // Turn thickenGeometry() output into real faces.
  commitThicken(data) {
    const out = [];
    for (const fd of data) {
      const loopPts = fd.reverse ? [...fd.outer].reverse() : fd.outer;
      if (loopPts.length < 3) continue;
      const f = this.addFaceFromRings(loopPts, fd.holes, { color: fd.color, alpha: fd.alpha, gid: fd.gid });
      if (f) out.push(f.id);
    }
    return out;
  }

  // ---------------------------------------------------------------- wall resize
  // All vertices of the connected component (through shared vertices) of the
  // given selection — a room's walls/floor/ceiling are one component.
  componentVerts(sel) {
    const vertFaces = new Map(); // vid -> Set(faceId)
    for (const [fid, f] of this.faces)
      for (const ring of this.rings(f))
        for (const v of ring) {
          if (!vertFaces.has(v)) vertFaces.set(v, new Set());
          vertFaces.get(v).add(fid);
        }
    const verts = new Set();
    const seen = new Set();
    const q = [];
    for (const id of sel.faces) if (this.faces.has(id)) { q.push(id); seen.add(id); }
    let guard = 0;
    while (q.length && guard++ < 30000) {
      const f = this.faces.get(q.pop());
      if (!f) continue;
      for (const ring of this.rings(f))
        for (const v of ring) {
          verts.add(v);
          for (const f2 of (vertFaces.get(v) || []))
            if (!seen.has(f2)) { seen.add(f2); q.push(f2); }
        }
    }
    return verts;
  }

  // Nearest face plane parallel to `dir`, on the +dir side of p0 — used to find
  // the wall across the room. Prefers faces in the same connected component.
  findAcross(p0, dir, excludeFaceId, compVids) {
    let best = null;
    for (const [fid, f] of this.faces) {
      if (fid === excludeFaceId) continue;
      const n2 = G.loopNormal(this.pts(f.loop));
      if (G.isZero(n2) || Math.abs(G.dot(n2, dir)) < 0.999) continue;
      const t = G.dot(dir, G.sub(this.vp(f.loop[0]), p0));
      if (t <= 0.05) continue;
      const cand = { t, point: this.vp(f.loop[0]), fid, inComp: compVids.has(f.loop[0]) };
      if (!best
        || (cand.inComp && !best.inComp)
        || (cand.inComp === best.inComp && cand.t < best.t)) best = cand;
    }
    return best;
  }

  // ---------------------------------------------------------------- serialize
  serialize() {
    // Snapshots must be DEEP on every array a later edit mutates in place:
    // face.loop/holes are spliced by splits and punches, entity face lists
    // are rewritten by stamp propagation — sharing them by reference let
    // later edits retroactively corrupt live undo snapshots.
    return {
      v: [...this.vertices.entries()].map(([id, p]) => [id, p.x, p.y, p.z]),
      e: [...this.edges.values()].map(x => [x.id, x.a, x.b, x.curveId || 0, x.gid || 0, x.userData || null, x.hidden ? 1 : 0,
        x.lt != null ? x.lt : null, x.lw != null ? x.lw : null, x.layerId && x.layerId !== '0' ? x.layerId : null]),
      c: [...this.curves.entries()].map(([id, m]) => [id, m]),
      g: [...this.groups.entries()].map(([id, g]) => [id, g]),
      lvl: (this.levels || []).map(l => ({ ...l })),
      // georeference (roadmap 1.2): the project base point (where the local
      // origin sits in a projected CRS), the survey point, and the rotation
      // from project north to TRUE north (radians, positive = clockwise
      // looking down). Feeds the IFC writer's IfcMapConversion.
      geo: this.geo ? JSON.parse(JSON.stringify(this.geo)) : null,
      ann: (this.annotations || []).map(a => ({ ...a })),
      views: (this.views || []).map(v => ({ ...v })),
      grid: (this.grids || []).map(g => (g && g.toRecord) ? g.toRecord() : { ...g }),
      lyr: (this.layers || []).map(l => ({ ...l })),
      cur: this.currentLayerId || '0',
      // downloaded-asset instances (BlenderKit): the app registers a live
      // provider; without one (pure model contexts, tests) the last restored
      // list round-trips untouched so save→load never loses them
      assets: this.assetListProvider ? this.assetListProvider() : (this.assetListData || []),
      // params MUST be deep-copied: they are mutated in place by type changes
      // and parametric edits — sharing them would retroactively mutate every
      // live undo snapshot (the wall-thickness-after-undo bug)
      bim: (this.bimEntities || []).map(x => ({ ...x, params: x.params ? _deepClone(x.params) : x.params, faces: [...(x.faces || [])], edges: [...(x.edges || [])] })),
      f: [...this.faces.values()].map(x => ({
        id: x.id, loop: [...x.loop], holes: (x.holes || []).map(h => [...h]), gid: x.gid || 0,
        userData: x.userData || null,
        color: x.color, alpha: x.alpha, loose: !!x.loose,
        layerId: x.layerId && x.layerId !== '0' ? x.layerId : null,
        extrude: x.extrude ? { axis: x.extrude.axis, anchor: x.extrude.anchor, anchorHoles: [...(x.extrude.anchorHoles || [])], sides: [...(x.extrude.sides || [])], cap: x.extrude.cap || null, extended: [...(x.extrude.extended || [])], through: x.extrude.through || null, culled: [...(x.extrude.culled || [])] } : null,
      })),
    };
  }
  load(data) {
    if (!data || !data.v) return;
    this.version++; // wholesale swap: every cached view of the model is stale
    this.vertices = new Map(data.v.map(([id, x, y, z]) => [id, { x, y, z }]));
    this.edges = new Map((data.e || []).map(([id, a, b, cid, gid, ud, hid, lt, lw, lid]) => [id, {
      id, a, b, curveId: cid || 0, gid: gid || 0, userData: ud || null, hidden: !!hid,
      lt: lt != null ? lt : null, lw: lw != null ? lw : null, layerId: lid || '0',
    }]));
    this._edgeIndex = new Map(); // derived from the edges, never serialized
    for (const e of this.edges.values()) this._edgeIndex.set(edgePairKey(e.a, e.b), e.id);
    this.curves = new Map((data.c || []).map(([id, m]) => [id, m]));
    this.groups = new Map((data.g || []).map(([id, g]) => [id, g]));
    this.faces = new Map((data.f || []).map(x => [x.id, {
      id: x.id, loop: [...x.loop], holes: (x.holes || []).map(h => [...h]), color: x.color || null,
      userData: x.userData || null,
      alpha: x.alpha == null ? 1 : x.alpha, gid: x.gid || 0, loose: !!x.loose,
      layerId: x.layerId || '0',
      extrude: x.extrude ? { axis: x.extrude.axis, anchor: x.extrude.anchor, anchorHoles: [...(x.extrude.anchorHoles || [])], sides: [...(x.extrude.sides || [])], cap: x.extrude.cap || null, extended: [...(x.extrude.extended || [])], through: x.extrude.through || null, culled: [...(x.extrude.culled || [])] } : null,
    }]));
    let mx = 0;
    for (const k of this.vertices.keys()) mx = Math.max(mx, k);
    for (const k of this.edges.keys()) mx = Math.max(mx, k);
    for (const k of this.faces.keys()) mx = Math.max(mx, k);
    for (const k of this.curves.keys()) mx = Math.max(mx, k);
    for (const k of this.groups.keys()) mx = Math.max(mx, k);
    // a wholesale swap invalidates every sweep-bracket snapshot (ids changed
    // worlds) — drop the brackets and reap the incoming state once so undo/
    // redo / file-open can never resurrect or import residue
    this._sweepStack = [];
    this.reapOrphanEdges();
    this.levels = (data.lvl || this.levels || []).map(l => ({ ...l }));
    // grid records stay raw here; GridManager._hydrate() validates them into
    // GridLine instances (schema gate) on the next access after load/undo
    // grids hydrate back into GridLine instances (distance/intersection
    // methods) — plain record copies would strip the GridSystem API
    this.grids = data.grid ? data.grid.map(g => (typeof GridLine === 'function' ? GridLine.fromRecord(g) : null) || { ...g }) : (this.grids || []);
    // georeference: legacy files without `geo` keep whatever is set (or none)
    this.geo = data.geo ? { ...data.geo } : (this.geo || null);
    this.annotations = Array.isArray(data.ann) ? data.ann.map(a => ({ ...a })) : [];
    this.views = Array.isArray(data.views) ? data.views.map(v => ({ ...v })) : [];
    this.bimEntities = (data.bim || this.bimEntities || []).map(x => ({
      ...x, params: x.params ? _deepClone(x.params) : x.params,
      faces: [...(x.faces || [])], edges: [...(x.edges || [])],
    }));
    // downloaded-asset instance list — the app diffs its THREE groups
    // against this after every load (boot, open, undo/redo)
    this.assetListData = Array.isArray(data.assets) ? data.assets.map(x => ({ ...x })) : null;
    // Layers hydrate with AutoCAD's safety rails: layer '0' always exists,
    // the current layer must resolve, and entities on unknown (deleted)
    // layers fall back to '0' — legacy files without `lyr` keep working
    this.layers = (data.lyr || []).map(l => ({
      id: String(l.id), name: String(l.name != null ? l.name : l.id),
      color: l.color || null, visible: l.visible !== false, locked: !!l.locked,
      lt: l.lt || 0, lw: l.lw || 0,
    }));
    if (!this.layers.some(l => l.id === '0'))
      this.layers.unshift({ id: '0', name: '0', color: null, visible: true, locked: false, lt: 0, lw: 0 });
    const cur = data.cur || '0';
    this.currentLayerId = this.layers.some(l => l.id === cur) ? cur : '0';
    const known = new Set(this.layers.map(l => l.id));
    for (const ent of this.bimEntities)
      if (!known.has(ent.layerId)) ent.layerId = '0';
    __eid = mx + 1;
    this.currentGid = 0;
    this.invalidateVertexHash();
  }

  serializeSubset(sel) {
    const faces = [...sel.faces].map(id => this.faces.get(id)).filter(Boolean);
    const eset = new Set([...sel.edges].filter(id => this.edges.has(id)));
    for (const f of faces) for (const ring of this.rings(f)) {
      for (let i = 0; i < ring.length; i++) {
        const e = this.findEdge(ring[i], ring[(i + 1) % ring.length]);
        if (e) eset.add(e.id);
      }
    }
    const vids = new Set();
    for (const id of eset) { const e = this.edges.get(id); vids.add(e.a); vids.add(e.b); }
    for (const f of faces) for (const ring of this.rings(f)) ring.forEach(v => vids.add(v));
    const cids = new Set();
    for (const id of eset) { const e = this.edges.get(id); if (e.curveId) cids.add(e.curveId); }
    return {
      v: [...vids].map(id => { const p = this.vp(id); return [id, p.x, p.y, p.z]; }),
      e: [...eset].map(id => { const e = this.edges.get(id); return [e.id, e.a, e.b, e.curveId || 0]; }),
      c: [...cids].map(id => [id, this.curves.get(id)]),
      f: faces.map(x => ({ id: x.id, loop: x.loop, holes: x.holes || [], color: x.color, alpha: x.alpha, extrude: null })),
    };
  }

  // tf (optional) copies through more than a translation: { p(point)->point,
  // n(normal)->normal, flip } — rotation about a point (polar array), or a
  // reflection (mirror). `flip` reverses copied rings so a mirrored face keeps
  // its outward normal; `n` mirrors/rotates arc + circle metadata so the
  // analytic center stays consistent with the tessellated edges.
  importSubset(data, offset = G.v(), tf = null) {
    const vmap = new Map();
    for (const [oldId, x, y, z] of data.v) {
      const p0 = G.v(x, y, z);
      vmap.set(oldId, this.vertexAt(G.add(tf ? tf.p(p0) : p0, offset)));
    }
    const cmap = new Map();
    for (const [oldId, meta] of (data.c || [])) {
      const nc = nid();
      cmap.set(oldId, nc);
      this.curves.set(nc, !tf ? meta : {
        ...meta,
        center: meta.center ? tf.p(G.clone(meta.center)) : meta.center,
        normal: meta.normal && tf.n ? tf.n(G.clone(meta.normal)) : meta.normal,
      });
    }
    for (const [, oa, ob, cid] of data.e) {
      const a = vmap.get(oa), b = vmap.get(ob);
      if (a === b) continue;
      let e = this.findEdge(a, b);
      if (!e) {
        e = { id: nid(), a, b, curveId: cid ? cmap.get(cid) || 0 : 0 };
        this._addEdge(e);
      } else if (cid && !e.curveId) e.curveId = cmap.get(cid) || 0;
    }
    const out = [];
    for (const x of (data.f || [])) {
      const loop = x.loop.map(v => vmap.get(v)).filter(Boolean);
      const holes = (x.holes || []).map(h => h.map(v => vmap.get(v)).filter(Boolean)).filter(h => h.length >= 3);
      if (new Set(loop).size < 3) continue;
      if (tf && tf.flip) { loop.reverse(); holes.forEach(h => h.reverse()); }
      this.edgesForRing(loop, true);
      holes.forEach(h => this.edgesForRing(h, true));
      const f = { id: nid(), loop, holes, color: x.color, alpha: x.alpha, hidden: false, extrude: null };
      this.faces.set(f.id, f);
      out.push(f);
    }
    return out;
  }
  // In-place orientation flip for faces whose vertices were transformed by a
  // reflection (mirror-move): the ring order survives the vertex move, so the
  // face normal inverts unless the ring is walked the other way.
  flipRingOrientation(faceIds) {
    for (const id of faceIds) {
      const f = this.faces.get(id);
      if (!f) continue;
      f.loop = f.loop.slice().reverse();
      f.holes = (f.holes || []).map(h => h.slice().reverse());
    }
  }
  // Transform the analytic metadata (center / normal) of the curves owned by
  // the given edges — the vertex mover knows nothing about them.
  transformCurves(edgeIds, tf) {
    const done = new Set();
    for (const id of edgeIds) {
      const e = this.edges.get(id);
      if (!e || !e.curveId || done.has(e.curveId)) continue;
      const c = this.curves.get(e.curveId);
      if (!c) continue;
      done.add(e.curveId);
      this.curves.set(e.curveId, {
        ...c,
        center: c.center ? tf.p(G.clone(c.center)) : c.center,
        normal: c.normal && tf.n ? tf.n(G.clone(c.normal)) : c.normal,
      });
    }
  }

  // ------------------------------------------------------------ invariants
  // Structural audit of the BREP. Returns { ok, errors: [], warnings: [] }.
  //   errors   = corruption that breaks the model contract (dangling ids,
  //              rings without edges, degenerate loops, touching holes)
  //   warnings = topology smells that are legal but usually unintended
  //              (non-manifold folds, edges/vertices a gc() would remove)
  // Not a hot-path function: the test suite calls it after every operation,
  // and app transactions can call it on commit (app.validateOnCommit).
  validate() {
    const errors = [], warnings = [];
    const E = (...a) => errors.push(a.join(' '));
    const W = (...a) => warnings.push(a.join(' '));
    const ek = (a, b) => a < b ? a + '_' + b : b + '_' + a;

    // edges: valid endpoints, no duplicates; index pair -> edge id
    const pairEdge = new Map();
    for (const [id, e] of this.edges) {
      if (!this.vertices.has(e.a) || !this.vertices.has(e.b)) { E('edge', id, 'references a missing vertex'); continue; }
      if (e.a === e.b) { E('edge', id, 'is a self-loop'); continue; }
      const k = ek(e.a, e.b);
      if (pairEdge.has(k)) E('edges', pairEdge.get(k), 'and', id, 'connect the same vertex pair');
      else pairEdge.set(k, id);
    }

    // face rings: every consecutive pair must be a real edge, no repeats,
    // no degenerate loops, holes must not touch the outer ring
    const useCount = new Map(); // edge id -> number of face-ring traversals
    const ringCheck = (f, ring, kind) => {
      const n = ring.length;
      if (n < 3) { E('face', f.id, kind, 'ring has fewer than 3 vertices'); return; }
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        if (!this.vertices.has(a)) { E('face', f.id, kind, 'ring references missing vertex', a); continue; }
        if (a === b) { E('face', f.id, kind, 'ring repeats vertex', a, 'consecutively'); continue; }
        const eid = pairEdge.get(ek(a, b));
        if (eid == null) { E('face', f.id, kind, 'ring pair', a, '-', b, 'has no edge'); continue; }
        useCount.set(eid, (useCount.get(eid) || 0) + 1);
      }
      if (new Set(ring).size !== n) E('face', f.id, kind, 'ring visits a vertex twice');
      if (kind === 'outer') {
        if (ring.every(v => this.vertices.has(v)) && G.loopArea(this.pts(ring)) < 1e-9)
          E('face', f.id, 'outer ring is degenerate (zero area)');
        const outer = new Set(ring);
        for (const h of f.holes)
          for (const v of h)
            if (outer.has(v)) E('face', f.id, 'hole ring touches the outer ring at vertex', v);
      }
    };
    for (const f of this.faces.values()) {
      if (!f.loop) { E('face', f.id, 'has no outer loop'); continue; }
      ringCheck(f, f.loop, 'outer');
      for (let i = 0; i < f.holes.length; i++) ringCheck(f, f.holes[i], `hole ${i}`);
    }

    // topology smells
    for (const [id, c] of useCount) if (c > 2) W('edge', id, 'is traversed by', c, 'face rings (non-manifold fold)');
    for (const id of this.edges.keys()) if (!useCount.has(id)) W('edge', id, 'belongs to no face (standalone line)');
    // degenerate elements: sliver faces and zero-length edges (near-zero
    // slivers warn; true zero-area/zero-length remain hard errors above)
    for (const f of this.faces.values()) {
      if (f.loop && f.loop.every(v => this.vertices.has(v))) {
        const a = G.loopArea(this.pts(f.loop));
        if (a < 1e-6 && a >= 1e-9) W('face', f.id, 'is a sliver (area < 1e-6)');
      }
    }
    for (const [id, e] of this.edges) {
      const a = this.vertices.get(e.a), b = this.vertices.get(e.b);
      if (a && b) {
        const L = G.dist(a, b);
        if (L < 1e-5 && L >= 1e-9) W('edge', id, 'is near-degenerate (length < 1e-5) — weld its endpoints');
      }
    }
    // unwelded duplicates: distinct edges spanning the same segment (by
    // position) — the symptom of missed vertex welding / T-junctions
    {
      const q = x => Math.round(x * 1e4);
      const bySeg = new Map();
      for (const [id, e] of this.edges) {
        const a = this.vertices.get(e.a), b = this.vertices.get(e.b);
        if (!a || !b) continue;
        const ka = q(a.x) + ',' + q(a.y) + ',' + q(a.z), kb = q(b.x) + ',' + q(b.y) + ',' + q(b.z);
        const key = ka < kb ? ka + '~' + kb : kb + '~' + ka;
        let arr = bySeg.get(key);
        if (!arr) bySeg.set(key, arr = []);
        arr.push(id);
      }
      for (const arr of bySeg.values()) if (arr.length > 1)
        W('edges', arr.join(' and '), 'span the same segment (unwelded duplicate)');
    }
    // Euler characteristic per closed (watertight) shell component:
    // V - E + F = 2(S - G) must be even and >= 2 for sphere-topology solids
    {
      const eFaces = new Map(); // edge id -> [face ids]
      for (const f of this.faces.values()) {
        if (!f.loop) continue;
        for (const ring of this.rings(f)) for (let i = 0; i < ring.length; i++) {
          const eid = pairEdge.get(ek(ring[i], ring[(i + 1) % ring.length]));
          if (eid == null) continue;
          if (!eFaces.has(eid)) eFaces.set(eid, []);
          eFaces.get(eid).push(f.id);
        }
      }
      const faceAdj = new Map();
      const shellOf = new Map();
      for (const [eid, fl] of eFaces) {
        if (fl.length !== 2) continue;
        for (let i = 0; i < 2; i++) {
          const u = fl[i], v = fl[1 - i];
          if (!faceAdj.has(u)) faceAdj.set(u, new Set());
          faceAdj.get(u).add(v);
        }
      }
      const comps = [];
      for (const f of this.faces.keys()) {
        if (shellOf.has(f)) continue;
        const comp = [f]; shellOf.set(f, comps.length);
        const q = [f];
        while (q.length) {
          const cur = q.pop();
          for (const nb of (faceAdj.get(cur) || [])) {
            if (shellOf.has(nb)) continue;
            shellOf.set(nb, comps.length);
            comp.push(nb); q.push(nb);
          }
        }
        comps.push(comp);
      }
      for (let ci = 0; ci < comps.length; ci++) {
        const comp = comps[ci];
        const vset = new Set(), eset = new Set();
        let watertight = true;
        for (const fid of comp) {
          const f = this.faces.get(fid);
          if (!f) continue;
          for (const ring of this.rings(f)) for (let i = 0; i < ring.length; i++) {
            const u = ring[i], v = ring[(i + 1) % ring.length];
            vset.add(u);
            const eid = pairEdge.get(ek(u, v));
            if (eid == null) { watertight = false; continue; }
            eset.add(eid);
            if ((eFaces.get(eid) || []).length !== 2) watertight = false;
          }
        }
        if (!watertight || vset.size < 4) continue; // open shells: skip
        const chi = vset.size - eset.size + comp.length;
        // V-E+F = 2(S-G): even for any legal shell count/genus (a wall with a
        // through-door is genus 1 -> 0). Odd is impossible = torn or glued.
        if (chi % 2 !== 0)
          W('closed shell of faces', comp.slice(0, 6).join(', '),
            'has odd Euler characteristic', chi, '(V-E+F = 2(S-G) must be even: check for open seams or glued faces)');
        else if (chi < 0)
          W('closed shell of faces', comp.slice(0, 6).join(', '), 'has Euler characteristic', chi, '(high genus — verify it is intentional)');
      }
    }
    const usedV = new Set();
    for (const e of this.edges.values()) { usedV.add(e.a); usedV.add(e.b); }
    for (const id of this.vertices.keys()) if (!usedV.has(id)) W('vertex', id, 'belongs to no edge (gc candidate)');

    return { ok: errors.length === 0, errors, warnings };
  }
}
window.Model = Model;
