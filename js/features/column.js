'use strict';
// ---------------------------------------------------------------------------
// Feature: Column (the SDK reference feature).
//
// This whole file is what a new tool costs: one standard Tool class, one
// Engine.features.register() descriptor. The ribbon button, command
// aliases (col / column), options-bar fields, properties entries and undo
// labels all come from the descriptor. The geometry itself lives in
// StructuralManager (pure, unit-tested).
//
// Vertical bounds are LEVEL-DRIVEN (StructuralManager):
//   Z_start = Z(baseLevel) + baseOffset
//   Z_end   = Z(topLevel)  + topOffset      (Revit-style; falls back to the
//                                           unconnected height option)
// The picked point supplies x/y and the base offset relative to the active
// base level (click a slab top at +0.2 m → baseOffset 0.2). The sweep starts
// at the TOP plane and pushes DOWN, so a slab at the top level is punched
// and the column passes through monolithically (Column > Slab precedence).
// ---------------------------------------------------------------------------
(function () {

  // pure geometry — unit-testable, no app dependency. Legacy direct builder
  // (extrudes UP from the picked plane); the level-driven path is
  // StructuralManager.buildColumn, used by the tool below.
  function placeColumn(G, m, p, w, d, h, rot = 0) {
    // plan rotation about the column center — aligned columns cut walls square
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const pc = (lx, ly) => G.v(p.x + lx * cs - ly * sn, p.y + lx * sn + ly * cs, p.z);
    const f = m.addFaceFromRings([pc(-w / 2, -d / 2), pc(w / 2, -d / 2), pc(w / 2, d / 2), pc(-w / 2, d / 2)]);
    if (!f) return null;
    if (!m.pushPull(f, h)) return null;
    const R = Math.hypot(w, d); // circumscribed half-extent (rotation-proof filter)
    return [...m.faces.values()].filter(g => {
      const c = m.faceCentroid(g);
      return c.x > p.x - R && c.x < p.x + R && c.y > p.y - R && c.y < p.y + R
        && c.z >= p.z - 1e-6 && c.z <= p.z + h + 1e-6;
    });
  }

  class ColumnTool extends Tool {
    static id = 'column';
    activate() { this.status(); }
    get hint() {
      const s = this.state || {};
      const app = this.app;
      const fam = (window.ColumnFamilies && ColumnFamilies.get(s.family)) || null;
      const lvl = app.levelManager.getLevel(app.bimOptions.baseLevel);
      const top = app.bimOptions.topConstraint !== 'unconnected'
        ? (app.levelManager.getLevel(app.bimOptions.topConstraint) || {}).name
        : `+${(app.bimOptions.unconnectedHeight || s.height || 3).toFixed(1)} m (unconnected)`;
      return `Column${fam ? ' (' + fam.name + ')' : ''}: click to place a ${(s.width || 0.3).toFixed(2)} x ${(s.depth || 0.3).toFixed(2)} m column, ${lvl ? lvl.name : 'base level'} → ${top}. Snap a grid intersection (A-1) to bind it to the grids, or click anywhere to place it freely. Snapping a wall/beam CENTERLINE rotates the column to run parallel with it; type an angle (e.g. 45) for an explicit rotation (Esc clears it). Family + size on the Options Bar, more designs in the Families panel.`;
    }
    /** Family params (normalized) carried in feature state; the Options Bar
     *  edits width/depth/height, the Families panel fills the extras. */
    _familyParams(s) {
      if (!window.ColumnFamilies) return {};
      return ColumnFamilies.normalize((s || this.state || {}).family || 'rect', s || this.state) || {};
    }
    _boundsAt(p, kind) {
      const app = this.app, s = this.state || {};
      const baseLevel = app.bimOptions.baseLevel;
      const baseZ = app.levelManager.getElevation(baseLevel);
      const fp = this._familyParams(s);
      // the picked plane becomes a baseOffset ONLY when the cursor hit real
      // geometry (a slab top at +0.2 m over the level). A GROUND/FREE pick
      // is just x/y — clicking empty space with Base Level 2 is not a
      // request for a −3 m offset, it bases the column ON the level plane
      const onGeometry = kind === 'endpoint' || kind === 'midpoint' || kind === 'center'
        || kind === 'edge' || kind === 'face';
      // stand-on-surface: only a slab/roof/free top under the cursor bases
      // the column on it. A pick on a WALL bases at the level — the column
      // lands on the floor and the wall-face rule splits it. (The old rule
      // took ANY geometry pick's z: clicking a wall floated the column at
      // the click height, half-embedded, and no split ever happened.)
      const stand = onGeometry ? app.pointStandingZ(p, kind) : null;
      const params = {
        base: [p.x, p.y, baseZ],
        family: s.family || 'rect',
        ...fp,
        baseLevelId: baseLevel,
        topLevelId: app.bimOptions.topConstraint !== 'unconnected' ? app.bimOptions.topConstraint : null,
        baseOffset: stand != null ? stand - baseZ : 0,
        topOffset: 0,
        // the options strip's Unconnected Height owns the height (walls,
        // grid columns, beams all read it) — the feature's legacy state is
        // only a fallback
        height: Math.max(0.1, (app.bimOptions && app.bimOptions.unconnectedHeight) || s.height || 3),
      };
      const bounds = app.structural.columnBounds(params);
      // solid top: a drop-panel head hangs UNDER a covering slab's soffit
      bounds.solidTop = app.structural.columnSolidTop(app.model, params);
      return { params, bounds };
    }
    onMove(ev) {
      const view = this.app.view;
      this._lastEv = ev;
      view.clearPreview();
      const inf = this.app.inferPoint(ev, null);
      const p = inf.p;
      const { params, bounds } = this._boundsAt(p, inf.kind);
      const z0 = bounds.zStart, z1 = bounds.solidTop != null ? bounds.solidTop : bounds.zEnd;
      const CF = window.ColumnFamilies;
      const spec = CF && CF.get(params.family) ? CF.parts(params.family, params, z1 - z0) : null;
      if (spec && spec.segments.length) {
        // family ghost: every tier's plan ring at its true height, walls on
        // matching rings (taper slices and prisms line up point-for-point)
        for (const s of spec.segments) {
          const up = s.ring.map(q => G.v(p.x + q.x, p.y + q.y, z0 + s.z1));
          const dn = s.ring.map(q => G.v(p.x + q.x, p.y + q.y, z0 + s.z0));
          view.previewLoop(up, 0x0e8385);
          view.previewLoop(dn, 0x0e8385);
          if (s.z1 - s.z0 > 0.05) view.previewQuadsBetween(up, dn);
        }
      } else {
        const rot = this._rotAt(inf);
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const pc = (lx, ly, z) => G.v(p.x + lx * cs - ly * sn, p.y + lx * sn + ly * cs, z);
        const ring = [
          pc(-params.width / 2, -params.depth / 2, z1), pc(params.width / 2, -params.depth / 2, z1),
          pc(params.width / 2, params.depth / 2, z1), pc(-params.width / 2, params.depth / 2, z1),
        ];
        const bottom = ring.map(q => G.v(q.x, q.y, z0));
        view.previewLoop(ring, 0x0e8385);
        view.previewLoop(bottom, 0x0e8385);
        view.previewQuadsBetween(ring, bottom);
      }
      const fam = CF && CF.get(params.family);
      const under = bounds.solidTop != null && bounds.solidTop < bounds.zEnd - 1e-3;
      const rotDeg = (this._rotAt(inf) * 180 / Math.PI);
      view.stickyLabel(G.v(p.x, p.y, z1),
        `${fam ? fam.name + ' ' : ''}${(params.width || 0.3).toFixed(2)} x ${(params.depth || 0.3).toFixed(2)} x ${(z1 - z0).toFixed(1)} m${rotDeg ? ` · ${rotDeg.toFixed(0)}°` : ''} (Z ${z0.toFixed(2)}…${z1.toFixed(2)})${under ? ' — head under slab' : ''}`, '#0a5f61', 0, 0);
    }
    // PLAN ROTATION: an explicit typed angle wins; otherwise a centerline
    // snap aligns the column WITH the host wall/beam axis (parallel
    // placement — square cuts, no wedge slivers); free clicks stay at 0°
    _rotAt(inf) {
      if (this.state && this.state.rotationDeg != null) return this.state.rotationDeg * Math.PI / 180;
      if (inf && inf.kind === 'centerline' && inf.dir) return Math.atan2(inf.dir.y, inf.dir.x);
      return 0;
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const inf = app.inferPoint(ev, null);
      const p = inf.p;
      const { params } = this._boundsAt(p, inf.kind);
      params.rotation = this._rotAt(inf);
      const facesBefore = new Set(app.model.faces.keys());
      const edgesBefore = new Set(app.model.edges.keys());
      let ok = false;
      // the tx returns true only when the fn ran AND the commit survived the
      // guard — a rolled-back build must not register a ghost entity over
      // the restored model
      ok = app.transaction.run('column', m => {
        // PRE-SPLIT: walls crossing the footprint retreat to its face FIRST
        // (with the column as a pending intruder) — the sweep then travels
        // between the pieces instead of slicing wall material
        app.bim.preSplitWallsForColumn(params);
        app.bim.preSplitBeamsForColumn(params);
        m.bimHold = true; // punching a slab at the top level keeps its entity
        try {
          const st = app.structural.buildColumn(G, m, params);
          if (!st.length) throw new Error('column placement failed');
          return true;
        } finally { m.bimHold = false; }
      }) === true;
      if (!ok) return;
      const m = app.model;
      // Claim only UNSTAMPED new faces: pieces of elements the column
      // punched or divided (a slab it passes through) keep their owner's
      // stamp and stay with that entity — the column never steals geometry.
      const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      // roles from the built solid's own z extents — a drop-panel head that
      // hangs under a slab never reaches the level plane, so columnBounds
      // alone would mislabel its top face
      let zMax = -Infinity, zMin = Infinity;
      for (const f of newFaces) {
        const c = m.faceCentroid(f);
        zMax = Math.max(zMax, c.z); zMin = Math.min(zMin, c.z);
      }
      const b = app.structural.columnBounds(params);
      const roles = {};
      for (const f of newFaces) {
        const c = m.faceCentroid(f);
        roles[f.id] = Math.abs(c.z - zMax) < 1e-6 ? 'top'
          : Math.abs(c.z - zMin) < 1e-6 ? 'bottom' : 'side';
      }
      const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id))
        .filter(id => !(m.edges.get(id) || {}).userData);
      // GRID BINDING — a column placed on a grid intersection (the "A-1"
      // snap) records its two grids: GridManager.syncAttached re-centers it
      // when either grid moves, and walls drawn between carrying
      // intersections trim against it.
      if (inf.kind === 'gridX' && inf.a && inf.b) params.gridRef = { a: inf.a.id, b: inf.b.id };
      app.bim.create('column', {
        ...params,
        baseLevel: params.baseLevelId, // LevelManager.usage() key
        topConstraint: params.topLevelId || 'unconnected',
        height: b.height,
      }, roles, newEdges);
      app.view.clearPreview();
      const fam = window.ColumnFamilies && ColumnFamilies.get(params.family);
      const solidTop = app.structural.columnSolidTop(m, params);
      const under = solidTop < b.zEnd - 1e-3;
      app.toast(`${fam ? fam.name : 'Column'} ${(params.width || 0.3).toFixed(2)} x ${(params.depth || 0.3).toFixed(2)} x ${b.height.toFixed(1)} m placed (Z ${b.zStart.toFixed(2)}…${b.zEnd.toFixed(2)})`
        + (under ? ' — head hangs under the slab' : '')
        + (params.gridRef ? ` at grid ${inf.a.name}-${inf.b.name} — moves with the grids` : ''));
    }
    onVCB(text) {
      // typed angle = explicit rotation override for the next placement
      // (parseAngle returns RADIANS — normalize to signed degrees here)
      const aRad = (typeof parseAngle === 'function') ? parseAngle(text) : parseFloat(text) * Math.PI / 180;
      if (aRad == null || !isFinite(aRad)) return false;
      let d = ((aRad * 180 / Math.PI) % 360 + 360) % 360;
      if (d > 180) d -= 360;
      this.state = this.state || {};
      this.state.rotationDeg = d;
      this.app.setStatus(`Column rotation ${d.toFixed(0)}° — click to place. Esc = back to auto (parallel to the snapped element)`);
      return true;
    }
    onKey(ev) {
      if (ev.key === 'Escape' && this.state && this.state.rotationDeg != null) {
        this.state.rotationDeg = null;
        this.app.setStatus('Column rotation: AUTO — snapping a wall/beam centerline aligns with it');
        return true;
      }
      return false;
    }
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'column',
      kind: 'tool',
      label: 'Column',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8" y="4" width="8" height="16"/><path d="M5 20h14M6 4h12"/></svg>',
      key: 'K',
      mode: 'bim',
      commands: ['col', 'column'],
      options: [
        { key: 'family', type: 'select', label: 'Family',
          choices: (window.ColumnFamilies ? ColumnFamilies.selectChoices() : [{ value: 'rect', label: 'Rectangular RC' }]) },
        { key: 'width', type: 'number', label: 'Width', step: 0.05, default: 0.3 },
        { key: 'depth', type: 'number', label: 'Depth', step: 0.05, default: 0.3 },
        // height comes from the options strip's Unconnected Height (shared
        // with walls / grid columns) — one field, one truth
      ],
      tool: ColumnTool,
      state: { family: 'rect', width: 0.3, depth: 0.3, height: 3.0 },
      onOption(d, key) {
        // switching family re-bases the sizes on that family's defaults
        // (extras like drop-panel dims ride along in the state)
        if (key === 'family' && window.ColumnFamilies) {
          const fresh = ColumnFamilies.defaults(d.state.family);
          if (fresh) {
            for (const k of Object.keys(d.state)) {
              if (k === 'family' || k === 'height' || !(k in fresh)) continue;
              delete d.state[k];
            }
            Object.assign(d.state, fresh);
          }
        }
        // live preview follows the typed size / family
        const t = window.app && window.app.tool;
        if (t && t.id === 'column' && t._lastEv) t.onMove(t._lastEv);
      },
    });
  }
  window.ColumnFeature = { ColumnTool, placeColumn };
})();
