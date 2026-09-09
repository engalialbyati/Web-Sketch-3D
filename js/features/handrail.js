'use strict';
// ---------------------------------------------------------------------------
// Feature: Handrail / Guardrail — drawn exactly like a wall.
//
// Draw a baseline (Line / Pick Lines) on the active Base Level; the rail
// generates itself: square POSTS at fixed spacing (always one at each end),
// a TOP rail at hand height, and an optional MID rail. All parts are
// oriented along the baseline direction, so diagonals work like walls.
//
//   Options bar: Height (m) · Post spacing (m) · Bar size (mm-ish, m) ·
//   Mid rail (Yes/No)
//
// One parametric entity ('handrail') owns the whole assembly; undo, levels,
// glTF export and Clean Up all treat it like any other element.
// ---------------------------------------------------------------------------
(function () {

  // Top of the highest horizontal face under the baseline (slab / floor /
  // landing tops at or above the level plane), so the rail sits ON its
  // support instead of floating at the raw level elevation. Falls back to
  // the level elevation when nothing is underneath.
  function supportZ(G, faces, A, B, zLevel, zMax) {
    const dv = G.v(B.x - A.x, B.y - A.y, 0);
    const L = G.len(dv);
    if (L < 1e-9) return zLevel;
    const d = G.norm(dv);
    const nS = Math.max(2, Math.ceil(L / 0.2) + 1);
    let best = zLevel;
    for (const f of faces) {
      const nrm = G.loopNormal(f.pts);
      if (Math.abs(nrm.z) < 0.9) continue;                 // only walkable faces
      const zs = f.pts.map(p => p.z);
      const z = Math.min(...zs);
      if (Math.max(...zs) - z > 1e-6) continue;            // not flat
      if (z < zLevel - 0.01 || z > zMax) continue;         // buried or a ceiling far above
      const basis = G.basisForNormal(nrm);
      const o = f.pts[0];
      const ring = f.pts.map(p => G.to2D(p, o, basis.u, basis.v));
      for (let i = 0; i < nS; i++) {
        const s = L * i / (nS - 1);
        const q = G.to2D(G.v(A.x + d.x * s, A.y + d.y * s, 0), o, basis.u, basis.v);
        let inside = false;
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const p1 = ring[a], p2 = ring[b];
          if ((q.y > p1.y) !== (q.y > p2.y) &&
            q.x < (p2.x - p1.x) * (q.y - p1.y) / ((p2.y - p1.y) || 1e-12) + p1.x)
            inside = !inside;
        }
        if (inside) { if (z > best) best = z; break; }
      }
    }
    return best;
  }

  // Pure layout plan — unit-testable, no app dependency.
  // A, B: {x, y, z} baseline ends (z = level plane). Returns bar rects.
  function handrailPlan(G, A, B, o) {
    const h = Math.max(0.3, +o.height || 0.95);
    const spacing = Math.max(0.1, +o.postSpacing || 1.2);
    const t = Math.max(0.02, +o.barSize || 0.045);
    const mid = !!o.midRail;
    const d = G.norm(G.v(B.x - A.x, B.y - A.y, 0));
    if (G.isZero(d)) return null;
    const n = G.v(-d.y, d.x, 0);
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    // posts: at 0, spacing, 2*spacing … clamped to L (always both ends)
    const postS = [];
    for (let s = 0; s < L - 1e-6; s += spacing) postS.push(Math.min(s, L));
    if (!postS.length || postS[postS.length - 1] < L - 1e-6) postS.push(L);
    const at = s => G.v(A.x + d.x * s, A.y + d.y * s, A.z);
    const rect = (C, halfN, halfD, z0, z1) => ({
      // vertical prism footprint, oriented to the baseline
      ring: [
        G.v(C.x + n.x * halfN + d.x * halfD, C.y + n.y * halfN + d.y * halfD, z0),
        G.v(C.x - n.x * halfN + d.x * halfD, C.y - n.y * halfN + d.y * halfD, z0),
        G.v(C.x - n.x * halfN - d.x * halfD, C.y - n.y * halfN - d.y * halfD, z0),
        G.v(C.x + n.x * halfN - d.x * halfD, C.y + n.y * halfN - d.y * halfD, z0),
      ],
      h: z1 - z0,
      role: 'post',
    });
    const parts = [];
    // posts: slightly narrower than the rails and stopping mid-way inside
    // the top rail, so no post face is ever coplanar with a rail face
    // (coplanar contact makes the healing kernel split and z-fights)
    const ph = t * 0.4;
    for (const s of postS) parts.push(rect(at(s), ph, ph, A.z, A.z + h - t / 2));
    // rails run the full baseline, inset half a bar at the ends
    const in0 = t / 2, in1 = L - t / 2;
    const railRect = (z0, z1, role) => {
      const P0 = at(in0), P1 = at(in1);
      return {
        ring: [
          G.v(P0.x - n.x * t / 2, P0.y - n.y * t / 2, z0),
          G.v(P1.x - n.x * t / 2, P1.y - n.y * t / 2, z0),
          G.v(P1.x + n.x * t / 2, P1.y + n.y * t / 2, z0),
          G.v(P0.x + n.x * t / 2, P0.y + n.y * t / 2, z0),
        ],
        h: z1 - z0,
        role,
      };
    };
    parts.push(railRect(A.z + h - t, A.z + h, 'top_rail'));
    if (mid) parts.push(railRect(A.z + h / 2 - t / 2, A.z + h / 2 + t / 2, 'mid_rail'));
    return { parts, length: L, height: h };
  }

  class HandRailTool extends Tool {
    static id = 'handrail';
    activate() {
      this.engine = new DrawPrimitiveEngine(this.app, {
        primitives: ['line', 'pick'],
        getOptions: () => this.app.bimOptions,
        planePoint: ev => this._pt(ev),
        onCommit: r => this._commit(r),
        onModeChange: () => this.status(),
        color: 0xb35900, fill: 0xcc6a1a, fillAlpha: 0.2,
      });
      this.status();
    }
    get hint() {
      const s = this.state || {};
      const lvl = this.app.levelManager.getLevel(this.app.bimOptions.baseLevel);
      return `Handrail (${(s.height || 0.95).toFixed(2)} m high, posts every ${(s.postSpacing || 1.2).toFixed(1)} m${s.midRail === 'no' ? '' : ', mid rail'}): draw the baseline on ${lvl ? lvl.name : 'the base level'} — it lands on the floor/slab under the line. VCB: "length".`;
    }
    _pt(ev) {
      const anchor = this.engine.stage === 1 ? this.engine.p1 : this.engine.chainStart;
      const p = this.app.inferPoint(ev, anchor).p;
      const z = this.app.levelManager.getElevation(this.app.bimOptions.baseLevel);
      return G.v(p.x, p.y, z);
    }
    // Base z for the assembly: top of whatever floor/slab lies under the
    // baseline at or above the level plane, plus the user Offset.
    _baseZ(A, B) {
      const zLevel = this.app.levelManager.getElevation(this.app.bimOptions.baseLevel);
      const s = this.state || {};
      const off = +s.offset || 0;
      const key = `${A.x.toFixed(2)},${A.y.toFixed(2)}|${B.x.toFixed(2)},${B.y.toFixed(2)}|${zLevel}`;
      if (this._supKey !== key) {
        const m = this.app.model;
        const faces = [];
        for (const f of m.faces.values()) faces.push({ pts: m.pts(f.loop) });
        this._supZ = supportZ(G, faces, A, B, zLevel, zLevel + 2.5);
        this._supKey = key;
      }
      // 1 mm reveal off the support: post bottoms must never be coplanar
      // with the slab top, or the healing kernel splits itself apart
      return this._supZ + off + 1e-3;
    }
    _params(A, B) {
      const s = this.state || {};
      const zb = this._baseZ(A, B);
      return {
        baseLevel: this.app.bimOptions.baseLevel,
        height: Math.max(0.3, s.height || 0.95),
        postSpacing: Math.max(0.1, s.postSpacing || 1.2),
        barSize: Math.max(0.02, s.barSize || 0.045),
        midRail: s.midRail !== 'no',
        offset: +s.offset || 0,
        baseZ: zb,
        baseline: [[A.x, A.y, zb], [B.x, B.y, zb]],
      };
    }
    onMove(ev) {
      this.engine.onMove(ev);
      const e = this.engine, view = this.app.view;
      const start = e.stage === 1 ? e.p1 : e.chainStart;
      if (e.primitive === 'line' && start && e.cur) {
        const p = this._params(start, e.cur);
        const plan = handrailPlan(G, G.v(...p.baseline[0]), G.v(...p.baseline[1]), p);
        if (plan) {
          // ghost: top rail line + end posts
          const z = p.baseline[0][2] + p.height;
          view.previewLoop(plan.parts[plan.parts.length - (p.midRail ? 2 : 1)].ring.map(q => G.v(q.x, q.y, z)), 0xb35900);
          const f = plan.parts[0].ring.map(q => G.v(q.x, q.y, q.z + p.height));
          const b = plan.parts[0].ring;
          view.previewQuadsBetween(f, b, 0xcc6a1a, 0.35);
        }
      }
    }
    onDown(ev) { this.engine.onDown(ev); }
    onUp(ev) { this.engine.onUp(ev); }
    onKey(ev) {
      const handled = this.engine.onKey(ev);
      if (handled) this.status();
      return handled;
    }
    onVCB(t) { return this.engine.onVCB(t); }
    _commit(r) {
      const app = this.app;
      if (!r.pts || r.pts.length < 2) return;
      const A = r.pts[0], B = r.pts[r.pts.length - 1];
      if (Math.hypot(B.x - A.x, B.y - A.y) < 0.1) { app.toast('Handrail baseline too short'); return; }
      const params = this._params(A, B);
      const m = app.model;
      const facesBefore = new Set(m.faces.keys());
      const edgesBefore = new Set(m.edges.keys());
      let ok = false;
      app.transaction.run('handrail', mm => {
        mm.bimHold = true;
        mm.beginEdgeSweep();
        try {
          const plan = handrailPlan(G, G.v(...params.baseline[0]), G.v(...params.baseline[1]), params);
          if (!plan) throw new Error('degenerate baseline');
          let built = 0;
          for (const part of plan.parts) {
            // pushPull extrudes along the ring normal — enforce CCW (up)
            let ring = part.ring.map(q => G.clone(q));
            if (G.loopNormal(ring).z < 0) ring.reverse();
            const f = mm.addFaceFromRings(ring);
            if (!f) continue;
            if (!mm.pushPull(f, part.h)) continue;
            built++;
          }
          if (!built) throw new Error('no parts generated');
          ok = true;
        } finally { mm.endEdgeSweep(); mm.bimHold = false; }
      });
      if (!ok) return;
      // claim only our own unstamped NEW faces at/above the rail base —
      // never the floor/slab fragments the assembly split below it
      const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id)).map(id => m.faces.get(id));
      const mine = newFaces.filter(f => f && !f.userData && m.faceCentroid(f).z >= params.baseZ - 1e-3);
      const roles = {};
      for (const f of mine) {
        const zs = m.pts(f.loop).map(q => q.z);
        const zBase = params.baseline[0][2];
        const zTop = zBase + params.height;
        const c = m.faceCentroid(f);
        roles[f.id] = Math.abs(c.z - zTop) < 1e-6 ? 'rail_top_face'
          : Math.abs(Math.min(...zs) - zBase) < 1e-6 ? 'bottom' : 'part';
      }
      const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id))
        .filter(id => !(m.edges.get(id) || {}).userData);
      const ent = app.bim.create('handrail', params, roles, newEdges);
      // adoption sweep: splits born from later pushPulls (rails punching
      // posts etc.) can land after the snapshot — claim every unstamped
      // face inside the assembly bounding box so the entity owns it all
      if (ent) {
        const [A0, B0] = params.baseline;
        const pad = params.barSize * 2;
        const x0 = Math.min(A0[0], B0[0]) - pad, x1 = Math.max(A0[0], B0[0]) + pad;
        const y0 = Math.min(A0[1], B0[1]) - pad, y1 = Math.max(A0[1], B0[1]) + pad;
        // bottom is baseZ itself: the support's top face sits 1 mm LOWER
        // and must not be stolen from its owner
        const z0 = params.baseZ - 1e-4, z1 = params.baseZ + params.height + 0.01;
        ent.roles = ent.roles || {};
        for (const [id, f] of m.faces) {
          if (f.userData || ent.faces.includes(id)) continue;
          const c = m.faceCentroid(f);
          if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1 || c.z < z0 || c.z > z1) continue;
          ent.faces.push(id);
          ent.roles[id] = 'part';
        }
      }
      app.cleanupWires();
      app.view.clearPreview();
      app.toast(`Handrail placed — ${params.height.toFixed(2)} m, ${(Math.hypot(B.x - A.x, B.y - A.y)).toFixed(2)} m long`);
      this.status();
    }
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'handrail',
      kind: 'tool',
      label: 'Handrail',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18M3 6v2M21 6v2M7 8v13M17 8v13M12 8v13"/></svg>',
      key: 'N',
      mode: 'bim',
      commands: ['rail', 'handrail', 'hr'],
      options: [
        { key: 'height', type: 'number', label: 'Height', step: 0.05, default: 0.95 },
        { key: 'postSpacing', type: 'number', label: 'Posts @', step: 0.1, default: 1.2 },
        { key: 'barSize', type: 'number', label: 'Bar', step: 0.005, default: 0.045 },
        { key: 'midRail', type: 'select', label: 'Mid rail', choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
        { key: 'offset', type: 'number', label: 'Offset', step: 0.05, default: 0 },
      ],
      tool: HandRailTool,
      state: { height: 0.95, postSpacing: 1.2, barSize: 0.045, midRail: 'yes', offset: 0 },
      onOption(d) {
        const t = window.app && window.app.tool;
        if (t && t.id === 'handrail') t.status();
      },
    });
  }
  window.HandRailFeature = { HandRailTool, handrailPlan };
})();
