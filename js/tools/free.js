'use strict';
// ---------------------------------------------------------------------------
// tools/free/* — SketchUp-style direct-modeling tools. Namespace: FreeTools.
// Inner logic unchanged; all classes share the Tool lifecycle contract.
// ---------------------------------------------------------------------------
// ---- Revit-method guard ----------------------------------------------------
// Faces/edges of registered BIM elements are a parametric CACHE — they
// regenerate from the element's parameters. Freeform edits that would corrupt
// that cache (and silently detach the element's identity) are refused outside
// Edit In Place. The sanctioned paths — Edit In Place (holds bimHold), the
// wall-top push sync (edits params.height, not the B-Rep), and soften (a
// display-only flag) — never hit the refusal.
function _ringHasEdge(ring, e) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if ((a === e.a && b === e.b) || (a === e.b && b === e.a)) return true;
  }
  return false;
}
function _bimGuardedUd(app, ud) {
  if (!ud || !ud.bimEntityId) return false;        // plain free geometry
  if (app._eip || app.model.bimHold) return false; // sanctioned freeform paths
  app.toast(`Parametric ${ud.bimType || 'element'} — edit its values in Entity Info, or use Edit In Place`, true);
  return true;
}
// Face-target guard. allowWallTop: the wall-top push is the parametric sync.
function bimGuardFace(app, f, allowWallTop) {
  const ud = f && f.userData;
  if (allowWallTop && ud && ud.bimType === 'wall' && ud.role === 'top') return false;
  return _bimGuardedUd(app, ud);
}
// Edge-target guard: edges are not re-stamped by every rebuild, so resolve
// ownership by ring adjacency and guard on the first stamped owner face.
function bimGuardEdge(app, edge) {
  if (_bimGuardedUd(app, edge.userData)) return true;
  const m = app.model;
  for (const f of m.faces.values()) {
    if (!f.userData || !f.userData.bimEntityId) continue;
    if (_ringHasEdge(f.loop, edge) || (f.holes || []).some(h => _ringHasEdge(h, edge)))
      return _bimGuardedUd(app, f.userData);
  }
  return false;
}

class SelectTool extends Tool {
  static id = 'select';
  cleanup() { this._gdrag = null; super.cleanup(); }
  get hint() {
    if (this._awaitLen) return 'Wall length: type the new length + Enter (Esc cancels).';
    if (this._hdrag) return 'Wall: drag the handle — the wall stretches parametrically.';
    return this._bandStart ? 'Drag to window-select (right-to-left = crossing). Shift/Ctrl adds.' : (this.app.mode === 'bim'
      ? `Select: click selects whole ELEMENTS. Drag = window select (elements too). Faces and edges are selectable in Free Drawing — Measure Area still picks faces.${this.app.mode === 'bim' ? ' Grid lines: click (or box-select) to select — amber = selected; drag to move, Del to delete.' : ''}`
      : `Select: click an edge or face. Drag = window select. Shift adds. Double-click a face selects its border too.`);
  }
  // ---- Revit shape handles for selected parametric walls -------------------
  _wallSel() {
    const app = this.app;
    for (const fid of app.sel.faces) {
      const f = app.model.faces.get(fid);
      const ent = f && app.bim.getEntityForFace(f);
      if (ent && ent.type === 'wall' && ent.params.base && ent.params.end && !ent.params.closed)
        return ent;
    }
    return null;
  }
  // selected hosted door/window -> Revit flip controls (facing + hand)
  _hostedSel() {
    const app = this.app;
    for (const fid of app.sel.faces) {
      const f = app.model.faces.get(fid);
      const ent = f && app.bim.getEntityForFace(f);
      if (ent && (ent.type === 'door' || ent.type === 'window')) return ent;
    }
    return null;
  }
  _drawFlipButtons() {
    const app = this.app, view = app.view;
    const ent = this._hostedSel();
    this._flips = null;
    if (!ent) return;
    // wall hosts frame from the wall entity; free-face hosts stored their own
    // wall-like descriptor (base/end/thickness) in ent.params
    const wallEnt = app.bim.getEntityById(ent.params.hostWallId);
    const hp = wallEnt ? wallEnt.params : ent.params;
    if (!hp || !hp.base || !hp.end) return;
    const P1 = G.v(...hp.base), P2 = G.v(...hp.end);
    const dir = G.norm(G.sub(P2, P1));
    const c = G.add(P1, G.mul(dir, ent.params.distanceFromStart));
    const z = P1.z + ent.params.sillHeight + ent.params.height / 2;
    const p = G.v(c.x, c.y, z);
    const sc = view.toScreen(p);
    if (!sc) return;
    const btns = [
      { which: 'facing', glyph: '\u21C4', label: 'Flip Exterior/Interior', dx: 0 },
      { which: 'hand', glyph: '\u21C5', label: 'Flip Hand (swing)', dx: 78 },
    ];
    this._flips = [];
    for (const b of btns) {
      view.stickyLabel(p, `${b.glyph} ${b.label}`, '#1a4ea8', -60 + b.dx, -34);
      this._flips.push({ which: b.which, x: sc.x - 60 + b.dx, y: sc.y - 34 });
    }
  }
  _drawWallHandles() {
    const app = this.app, view = app.view;
    // the overlay is fully redrawn each pass: clear first so preview
    // triangles and sticky labels never accumulate across moves
    view.clearPreview();
    this._drawFlipButtons();
    const ent = this._wallSel();
    this._hits = null; this._badge = null;
    if (!ent || this._hdrag) return;
    const P1 = G.v(...ent.params.base), P2 = G.v(...ent.params.end);
    const len = G.dist(P1, P2);
    if (len < 1e-6) return;
    const s = Math.max(0.06, app.view.cam.dist * 0.016);
    const tri = (p) => [
      G.v(p.x, p.y + s, p.z + 0.01), G.v(p.x - 0.87 * s, p.y - 0.5 * s, p.z + 0.01),
      G.v(p.x + 0.87 * s, p.y - 0.5 * s, p.z + 0.01),
    ];
    const mid = G.mul(G.add(P1, P2), 0.5);
    const pts = { start: P1, mid, end: P2 };
    const hits = [];
    for (const k of ['start', 'mid', 'end']) {
      const t = tri(pts[k]);
      view.previewFill([{ outer: t }], 0x2f6fdb, 1);
      view.previewLoop(t, 0x1a4eA8);
      const sc = view.toScreen(pts[k]);
      if (sc) hits.push({ kind: k, x: sc.x, y: sc.y });
    }
    // listening dimension string along the baseline
    const sc = view.toScreen(mid);
    if (sc) {
      const label = fmtLen(len);
      view.stickyLabel(mid, label + '  (click to edit)', '#1a4ea8', 0, -26);
      this._badge = { x: sc.x, y: sc.y - 26, w: label.length * 7 + 90, h: 18 };
    }
    this._hits = hits;
  }
  _hitTest(ev) {
    if (!this._hits && !this._badge) return null;
    const q = this.app.view.eventPt(ev);
    if (this._badge && Math.abs(q.x - this._badge.x) < this._badge.w / 2 && Math.abs(q.y - this._badge.y) < this._badge.h / 2)
      return 'badge';
    if (this._hits) for (const h of this._hits)
      if (Math.hypot(q.x - h.x, q.y - h.y) < 12) return h.kind;
    return null;
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    // hosted flip buttons own the click first
    if (this._flips) {
      const q = this.app.view.eventPt(ev);
      for (const b of this._flips) {
        if (Math.abs(q.x - b.x) < 66 && Math.abs(q.y - b.y) < 14) {
          const ent = this._hostedSel();
          if (ent) this.app.run('flip ' + b.which, () => this.app.bim.flipHosted(ent.id, b.which));
          return;
        }
      }
    }
    // shape handles next: they own the click
    if (!this._hdrag) {
      const hit = this._hitTest(ev);
      const ent = this._wallSel();
      if (hit && ent) {
        if (hit === 'badge') {
          this._awaitLen = ent;
          this.app.setStatus(this.hint);
          return;
        }
        this._hdrag = { kind: hit, ent, start: this.app.view.eventPt(ev) };
        this.status();
        return;
      }
    } else {
      // second click while dragging: commit below via onUp
    }
    // GRID LINES select through hosted geometry (a wall drawn on the grid
    // covers its line): hitting the hairline wins over the wall beneath.
    // Shift/Ctrl+click toggles the line into a multi-selection.
    const gl = this.app._gridLineAt && this.app._gridLineAt(ev);
    if (gl) {
      this.app.selectGrid(gl.grid.id, gl.z, { toggle: ev.shiftKey || ev.ctrlKey });
      this._gdrag = { grid: gl.grid, z: gl.z, last: null, moved: false };
      return;
    }
    // OBJECT MODE (Precise Drawing): a hit on a BIM element selects the WHOLE
    // element — never its faces/edges (those belong to Edit In Place / Free
    // Drawing, the app's "edit modes"). Shift toggles it into the selection.
    if (this.app.mode === 'bim') {
      const pe = this.app.pickEntity(ev);
      let eid = pe && pe.entity;
      if (!eid && pe && pe.face != null) {
        // geometry outside any Group (split fragments, stale claims) still
        // resolves through its stamp — no dead zones on an element's body
        const f = this.app.model.faces.get(pe.face);
        eid = f && f.userData && f.userData.bimEntityId;
      }
      if (eid) {
        this.app.selectElement(eid, ev.shiftKey ? 'toggle' : 'replace');
        return;
      }
    }
    this._bandStart = this.app.view.eventPt(ev);
    this._band = false;
    this._mod = ev.shiftKey || ev.ctrlKey;
    // candidate for a hosted-opening drag (starts only after real movement)
    this._hostCandidate = null;
    if (ev.button === 0 && !this._mod) {
      const pick0 = this.app.pickEntity(ev);
      const f0 = pick0 && pick0.face != null ? this.app.model.faces.get(pick0.face) : null;
      const h0 = f0 && this.app.bim.getEntityForFace(f0);
      if (h0 && (h0.type === 'door' || h0.type === 'window' || h0.type === 'opening')
        && app.bim.getEntityById(h0.params.hostWallId)) // drag re-cuts need the wall; free-face hosts place-only
        this._hostCandidate = h0;
    }
  }
  onMove(ev) {
    if (this._gdrag) {
      // whole-line grid drag: live-translate the visuals (start/end/mid in
      // place), the committed updateGrid on release re-projects hosted
      // walls/columns in one undoable step
      const app = this.app, view = app.view;
      const d = this._gdrag;
      const { ro, rd } = view.clientToWorldRay(ev.clientX, ev.clientY);
      const t = Math.abs(rd.z) > 1e-9 ? (d.z - ro.z) / rd.z : 0;
      if (t <= 0) return;
      const p = [ro.x + rd.x * t, ro.y + rd.y * t];
      if (!d.last) { d.last = p; return; }
      const dx = p[0] - d.last[0], dy = p[1] - d.last[1];
      if (!d.moved && Math.hypot(dx, dy) < 0.005) return;
      d.moved = true;
      d.grid.start[0] += dx; d.grid.start[1] += dy;
      d.grid.end[0] += dx; d.grid.end[1] += dy;
      if (d.grid.mid) { d.grid.mid[0] += dx; d.grid.mid[1] += dy; }
      d.last = p;
      view.setGrids(app.gridManager.grids, app.levelManager.levels, d.grid.id); // live visuals only
      return;
    }
    // Ctrl/Tab held: sub-element measurement hover takes over (no drags active)
    if ((ev.ctrlKey || this.app._tabHeld) && !this._hdrag && !this._hostdrag && !this._band) {
      this._subQuery(ev);
      return;
    }
    if (this._subActive) this._clearSubQuery();
    if (!this._hostdrag && this._hostCandidate) {
      const q = this.app.view.eventPt(ev);
      if (Math.hypot(q.x - this._bandStart.x, q.y - this._bandStart.y) > 4) {
        this._hostdrag = { ent: this._hostCandidate };
        this._hostCandidate = null;
        this._bandStart = null;
        this.status();
      }
    }
    if (this._hostdrag) {
      const app = this.app, view = app.view;
      const ent = this._hostdrag.ent;
      const host = app.bim.getEntityById(ent.params.hostWallId);
      if (!host) return;
      const P1 = G.v(...host.params.base), P2 = G.v(...host.params.end);
      // intersect the cursor ray with the wall's own plane: vertical motion
      // tracks freely even when the cursor floats above/below the wall face
      // (point inference would snap to the ground and clamp the sill to 0)
      const D = G.sub(G.v(P2.x, P2.y, P1.z), G.v(P1.x, P1.y, P1.z));
      const nrm = G.v(-D.y, D.x, 0);
      const LN = G.len(nrm) || 1;
      const N = G.v(nrm.x / LN, nrm.y / LN, 0);
      const { ro, rd } = app.view.rayFrom(app.view.eventPt(ev));
      let p = G.rayPlane(ro, rd, { n: N, d: G.dot(N, P1) });
      if (!p || isNaN(p.z)) p = app.inferPoint(ev, null).p;
      const dir = G.norm(G.sub(G.v(P2.x, P2.y, P1.z), G.v(P1.x, P1.y, P1.z)));
      const L = G.dist(P1, P2);
      const half = ent.params.width / 2;
      const t = Math.min(Math.max(G.dot(G.sub(G.v(p.x, p.y, P1.z), P1), dir), half + 0.05), L - half - 0.05);
      const sill = Math.max(0, p.z - P1.z - ent.params.height / 2);
      view.clearPreview();
      const c = G.add(P1, G.mul(dir, t));
      const cz = P1.z + sill + ent.params.height / 2;
      // ghost of the opening at the target spot
      const hh = ent.params.height / 2;
      const a = G.add(c, G.mul(dir, -half)), b = G.add(c, G.mul(dir, half));
      const off = G.mul(G.v(-dir.y, dir.x, 0), host.params.thickness / 2);
      const ghost = [
        G.v(a.x + off.x, a.y + off.y, cz - hh), G.v(b.x + off.x, b.y + off.y, cz - hh),
        G.v(b.x + off.x, b.y + off.y, cz + hh), G.v(a.x + off.x, a.y + off.y, cz + hh),
      ];
      view.previewLoop(ghost, 0x2f6fdb);
      view.previewFill([{ outer: ghost }], 0x2f6fdb, 0.25);
      // listening dimensions to BOTH wall ends + sill readout
      for (const pair of [[P1, t], [P2, L - t]]) {
        const pEnd = pair[0];
        view.previewLine([G.v(c.x, c.y, P1.z), G.v(pEnd.x, pEnd.y, P1.z)], 0x6a1fb0, true);
        const mid = G.mul(G.add(G.v(c.x, c.y, P1.z), G.v(pEnd.x, pEnd.y, P1.z)), 0.5);
        view.stickyLabel(mid, fmtLen(pair[1]), '#6a1fb0');
      }
      view.stickyLabel(G.v(c.x, c.y, cz), `${fmtLen(t)} from start, ${fmtLen(sill)} sill`, '#6a1fb0', 0, -24);
      this._hostdrag.target = { t, sill };
      return;
    }
    if (this._hdrag) {
      const app = this.app, view = app.view;
      const ent = this._hdrag.ent;
      const P1 = G.v(...ent.params.base), P2 = G.v(...ent.params.end);
      const p = app.inferPoint(ev, null).p;
      const target = G.v(p.x, p.y, this._hdrag.kind === 'mid' ? P1.z : P1.z);
      view.clearPreview();
      if (this._hdrag.kind === 'mid') {
        const d = G.sub(target, G.mul(G.add(P1, P2), 0.5));
        view.previewLine([G.add(P1, d), G.add(P2, d)], 0x2f6fdb, true);
      } else {
        const a = this._hdrag.kind === 'end' ? P1 : P2;
        const b = this._hdrag.kind === 'end' ? target : target;
        view.previewLine([a, b], 0x2f6fdb, true);
        view.stickyLabel(b, fmtLen(G.dist(a, b)), '#1a4ea8', 0, -20);
      }
      return;
    }
    if (this._bandStart || !this._bandStart) {
      // redraw the overlay whenever a wall or hosted element is selected
      const sel = this._wallSel();
      const hosted = this._hostedSel();
      if (sel || hosted) this._drawWallHandles();
      else { this._hits = null; this._badge = null; this._flips = null; }
      // grid hover: the dashed datum shows through the wall, and a light
      // overlay confirms what a click will select (amber when already selected)
      if (!this._bandStart) {
        const gl = this.app._gridLineAt && this.app._gridLineAt(ev);
        if (!sel && !hosted) this.app.view.clearPreview(); // no handles drew: own the overlay
        if (gl) {
          const poly = gl.grid.polyline().map(p => G.v(p[0], p[1], gl.z));
          this.app.view.previewLine(poly, gl.grid.id === this.app.selGridId ? 0xf59e0b : 0x0ea5e9, true);
        }
      }
    }
    if (!this._bandStart) return;
    const q = this.app.view.eventPt(ev);
    const dx = q.x - this._bandStart.x, dy = q.y - this._bandStart.y;
    if (!this._band && Math.hypot(dx, dy) > 4) {
      this._band = true;
      this.app.bandEl.classList.add('active');
    }
    if (this._band) {
      const el = this.app.bandEl; // band div lives in the viewport container = ScreenPt frame
      el.style.left = Math.min(this._bandStart.x, q.x) + 'px';
      el.style.top = Math.min(this._bandStart.y, q.y) + 'px';
      el.style.width = Math.abs(dx) + 'px'; el.style.height = Math.abs(dy) + 'px';
    }
  }
  onUp(ev) {
    if (this._gdrag) {
      const app = this.app;
      const d = this._gdrag;
      this._gdrag = null;
      if (d.moved) {
        const g = d.grid;
        const patch = { start: [g.start[0], g.start[1]], end: [g.end[0], g.end[1]] };
        if (g.isCurved && g.mid) patch.mid = [g.mid[0], g.mid[1]];
        app.run('move grid', () => app.gridManager.updateGrid(g.id, patch));
        app.toast(`Grid ${g.name} moved — hosted walls and columns follow`);
      }
      return;
    }
    if (this._hostdrag) {
      const app = this.app;
      const { ent, target } = this._hostdrag;
      this._hostdrag = null;
      app.view.clearPreview();
      if (target) app.run('move opening', () => {
        ent.params.distanceFromStart = target.t;
        ent.params.sillHeight = target.sill;
        app.bim.rebuildWallWithHosts(ent.params.hostWallId);
      });
      app.setStatus('Opening moved.');
      return;
    }
    if (this._hdrag) {
      const app = this.app;
      const { kind, ent } = this._hdrag;
      const P1 = G.v(...ent.params.base);
      const p = app.inferPoint(ev, null).p;
      const target = G.v(p.x, p.y, P1.z);
      this._hdrag = null;
      app.view.clearPreview();
      app.run('edit wall', () => {
        if (kind === 'mid') {
          const P2 = G.v(...ent.params.end);
          const d = G.sub(target, G.mul(G.add(P1, P2), 0.5));
          app.bim.stretchWall(ent.id, { deltaAll: d });
        } else if (kind === 'end') app.bim.stretchWall(ent.id, { newEnd: target });
        else app.bim.stretchWall(ent.id, { newBase: target });
      });
      app.setStatus('Wall updated.');
      return;
    }
    this._hostCandidate = null;
    if (!this._bandStart) return;
    const app = this.app;
    app.bandEl.classList.remove('active');
    if (this._band) {
      const q = app.view.eventPt(ev);
      const x0 = Math.min(this._bandStart.x, q.x), x1 = Math.max(this._bandStart.x, q.x);
      const y0 = Math.min(this._bandStart.y, q.y), y1 = Math.max(this._bandStart.y, q.y);
      const crossing = q.x < this._bandStart.x;
      const picked = this._collect(x0, y0, x1, y1, crossing);
      app.bandGroupMerge(picked, crossing, (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
      if (app.mode === 'bim' && !app._eip) {
        // PRECISE DRAWING: the window resolves to whole ELEMENTS — stamped
        // faces expand to their element's full face set; unstamped faces
        // and raw edges drop out (sub-geometry lives in Free mode)
        const ids = new Set();
        for (const fid of picked.faces) {
          const f2 = app.model.faces.get(fid);
          const ent2 = f2 && app.bim.getEntityForFace(f2);
          if (ent2) ids.add(ent2.id);
        }
        const faces = new Set();
        for (const id2 of ids) {
          const ent3 = app.bim.getEntityById(id2);
          if (ent3) for (const fid of ent3.faces) if (app.model.faces.has(fid)) faces.add(fid);
        }
        picked.faces = faces;
        picked.edges = new Set();
      }
      if (this._mod) app.toggleEntities(picked);
      else { app.sel = picked; app.onSelectionChanged(); }
      // grid lines join the window selection: fully inside (window) or
      // touched (crossing, right-to-left) — same rules as the elements
      const gl2 = app._gridLinesInBox ? app._gridLinesInBox(x0, y0, x1, y1, crossing) : [];
      const caughtElems = (picked.faces && picked.faces.size) || (picked.edges && picked.edges.size);
      if (gl2.length) app.selectGrids(gl2, { add: !!this._mod, keep: !!caughtElems });
    } else {
      const pick = app.pickEntity(ev);
      if (pick.asset != null) {
        // downloaded-asset instance: its own selection category (box outline)
        app.selectAsset(pick.asset, this._mod ? 'toggle' : 'replace');
        const rec = app.assets.get(pick.asset);
        if (rec && !this._mod)
          app.setStatus(`${rec.name} (${rec.kind}${rec.host ? ' — hosted' : ''}) selected — M to move, Del to remove`);
      } else if (pick.group != null) {
        app.selectGroup(pick.group, this._mod ? 'toggle' : 'replace');
      } else if (pick.face != null) {
        const f = app.model.faces.get(pick.face);
        const ent = f && app.bim.getEntityForFace(f);
        const sub = ev.ctrlKey || app._tabHeld; // sub-element mode: the face itself
        if (ent && !sub && !app._eip) {
          // Revit element select: one click on any part = the whole element
          if (this._mod) app.selectElement(ent.id, 'toggle');
          else {
            app.selectElement(ent.id);
            app.setStatus(`${ent.type} ${ent.id} selected${app.mode === 'bim'
              ? ' — faces and edges are selectable in Free Drawing (Measure Area still picks faces)'
              : ' — hold Ctrl (or Tab) to query its faces (m²) and edges (m)'}`);
          }
        } else if (app.mode === 'bim' && !app._eip) {
          // PRECISE DRAWING: never a raw face — an unstamped face (or a
          // Ctrl/Tab query) is empty space here. Faces and edges are
          // selectable in FREE mode; Measure Area picks faces through its
          // own tool; Edit In Place keeps sub-element access while open.
          if (!this._mod) app.clearSelection();
        } else if (this._mod) app.toggleEntities({ edges: new Set(), faces: new Set([pick.face]) });
        else { app.sel = { edges: new Set(), faces: new Set([pick.face]) }; app.onSelectionChanged(); }
      } else if (pick.edges && pick.edges.length) {
        if (app.mode === 'bim' && !app._eip) {
          // PRECISE DRAWING: edges are Free-mode targets — never selected here
          if (!this._mod) app.clearSelection();
        } else if (this._mod) app.toggleEntities({ edges: new Set(pick.edges), faces: new Set() });
        else { app.sel = { edges: new Set(pick.edges), faces: new Set() }; app.onSelectionChanged(); }
      } else if (!this._mod) {
        app.clearSelection();
      }
    }
    this._bandStart = null; this._band = false;
  }
  onKey(ev) {
    if (ev.key === 'Escape' && this._awaitLen) { this._awaitLen = null; this.app.setStatus(this.hint); return true; }
    if (ev.key === 'Escape' && this._hdrag) { this._hdrag = null; this.app.view.clearPreview(); this.status(); return true; }
    if (ev.key === 'Escape' && this._hostdrag) { this._hostdrag = null; this.app.view.clearPreview(); this.status(); return true; }
    return false;
  }
  onVCB(text) {
    if (!this._awaitLen) return false;
    const L = parseLen(text);
    if (L == null || L <= 1e-6) return false;
    const ent = this._awaitLen;
    this._awaitLen = null;
    const app = this.app;
    const P1 = G.v(...ent.params.base), P2 = G.v(...ent.params.end);
    const dir = G.norm(G.sub(G.v(P2.x, P2.y, 0), G.v(P1.x, P1.y, 0)));
    app.run('edit wall', () => {
      app.bim.stretchWall(ent.id, { newEnd: G.add(P1, G.mul(dir, L)) });
    });
    app.toast(`Wall stretched to ${fmtLen(L)}`);
    return true;
  }
  onDoubleClick(ev) {
    const app = this.app;
    const pick = app.pickEntity(ev);
    if (pick.group != null && app.activeGroup !== pick.group) { app.enterGroup(pick.group); return; }
    if (app.activeGroup != null && pick.face == null && !(pick.edges && pick.edges.length)) {
      app.exitGroup();
      return;
    }
    if (pick.face != null) {
      const f = app.model.faces.get(pick.face);
      const ent = f && app.bim.getEntityForFace(f);
      // double-clicking a BIM element opens the in-place Edit Mode sandbox
      if (ent && !ev.ctrlKey && !app._eip) { app.enterEditInPlace(ent.id); return; }
      if (app.mode === 'bim' && !app._eip) return; // Precise Drawing: no raw faces (border-select lives in Free mode)
      const edges = new Set();
      for (const ring of app.model.rings(f)) {
        for (let i = 0; i < ring.length; i++) {
          const e = app.model.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (e) edges.add(e.id);
        }
      }
      app.sel = { edges, faces: new Set([pick.face]) };
      app.onSelectionChanged();
    }
  }
  // ---- sub-element query (Ctrl / Tab held): pure measurement hover ------
  // Raycasts into the element's unified Group down to one face or edge and
  // reports its planar area (m²) / 3D length (m). Nothing is selected and
  // the element's top-level container is never detached.
  _subQuery(ev) {
    const app = this.app, view = app.view;
    this._subActive = true;
    const sub = app.elements ? app.elements.subPick(view, ev, app.model) : null;
    view.clearSticky(); // one live label per hover, never accumulating
    if (!sub) {
      view.setHoverFace(null);
      view.setHoverEdges(null);
      view.clearSticky();
      app.setStatus('Sub-element query — hover a face (area) or an edge (length)');
      return;
    }
    if (sub.kind === 'face') {
      view.setHoverFace(sub.id);
      view.setHoverEdges(null);
      view.stickyLabel(sub.point, `Face — ${sub.area.toFixed(3)} m²`, '#0a5f61', 0, -16);
      app.setStatus(`Face ${sub.id}${sub.elementId ? ' of ' + sub.elementId : ''}: ${sub.area.toFixed(3)} m²`);
    } else {
      view.setHoverEdges([sub.id], 0x0e8385);
      view.setHoverFace(null);
      view.stickyLabel(sub.point, `Edge — ${fmtLen(sub.length)}`, '#0a5f61', 0, -16);
      app.setStatus(`Edge ${sub.id}: ${fmtLen(sub.length)}`);
    }
  }
  _clearSubQuery() {
    if (!this._subActive) return;
    this._subActive = false;
    const view = this.app.view;
    view.setHoverFace(null);
    view.setHoverEdges(null);
    view.clearSticky();
    this.status();
  }
  _collect(x0, y0, x1, y1, crossing) {
    const app = this.app, model = app.model;
    const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const out = { edges: new Set(), faces: new Set() };
    for (const e of model.edges.values()) {
      const a = model.vp(e.a), b = model.vp(e.b);
      if (!a || !b) continue;
      const sa = app.view.toScreen(a), sb = app.view.toScreen(b);
      if (sa.behind && sb.behind) continue;
      const hit = crossing ? (inside(sa.x, sa.y) || inside(sb.x, sb.y)) : (inside(sa.x, sa.y) && inside(sb.x, sb.y));
      if (hit) {
        if (e.curveId) model.curveEdges(e.curveId).forEach(x => out.edges.add(x.id));
        else out.edges.add(e.id);
      }
    }
    for (const f of model.faces.values()) {
      const pts = model.rings(f).flat().map(v => model.vp(v));
      const ss = pts.map(p => app.view.toScreen(p));
      const hit = crossing ? ss.some(s => inside(s.x, s.y)) : ss.every(s => inside(s.x, s.y));
      if (hit) out.faces.add(f.id);
    }
    return out;
  }
}

// =========================================================== line
class LineTool extends Tool {
  static id = 'line';
  activate() { this.anchor = null; this.previewEnd = null; this.plane = null; }
  cleanup() { super.cleanup(); this.anchor = null; this.previewEnd = null; this.plane = null; }
  get hint() {
    return this.anchor
      ? 'Line: type a length, Tab switches to the angle, Enter draws it (AutoCAD dynamic input). Or click to finish. V + X/Y/Z locks axes. Esc ends the chain.'
      : 'Line: click to set the first point — or click an existing endpoint (green dot) to continue drawing from it. Then type length + Tab + angle + Enter. Closing a loop of lines creates a face.';
  }
  _point(ev) {
    const app = this.app;
    const inf = app.inferPoint(ev, this.anchor);
    let p = inf.p;
    // strict planar projection: once drawing starts on the ground (or a
    // face's plane), later snaps cannot pull vertices off that plane —
    // unless a deliberate override is active: a two-axis lock (V + X/Z etc.)
    // REPLACES the plane with one spanned by the locked axes (vertical and
    // angled sketch planes); a single-axis lock may leave it along that axis
    const lockedPlane = app.lockedPlane(this.anchor);
    if (this.plane && !app.lockAxis && !app.axisLocks.size) {
      const d = G.dot(this.plane.n, p) - this.plane.d;
      p = G.sub(p, G.mul(this.plane.n, d));
    } else if (lockedPlane) {
      const d = G.dot(lockedPlane.n, p) - lockedPlane.d;
      p = G.sub(p, G.mul(lockedPlane.n, d));
    }
    if (this.anchor && app.lockAxis) {
      const ax = AXES[app.lockAxis];
      p = G.add(this.anchor, G.mul(ax, G.dot(G.sub(p, this.anchor), ax)));
    }
    return { p, inf };
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    const { p, inf } = this._point(ev);
    // AutoCAD dynamic input: while a value is being typed the typed point
    // owns the preview; mouse moves only update the live field values
    if (app.dyn && app.dyn.open) {
      const focused = document.activeElement === app.dynLen || document.activeElement === app.dynAng;
      if (!focused) this._dynPt = null;
    } else this._dynPt = null;
    const useP = this._dynPt || p;
    view.clearPreview();
    if (this.anchor) {
      view.previewLine([this.anchor, useP], 0x2b2b2b);
      const s = view.toScreen(useP);
      view.stickyLabel(useP, fmtLen(G.dist(this.anchor, useP)), '#333', 0, 0);
      showCursorCoords(view, s, inf, useP);
      this.previewEnd = useP;
      if (app.lockAxis) {
        view.previewLine([this.anchor, G.add(this.anchor, G.mul(AXES[app.lockAxis], G.dist(this.anchor, useP)))], AXIS_COLOR[app.lockAxis], true);
      } else if (inf.axis && inf.axisSnapLine && !this._dynPt) {
        view.previewLine([this.anchor, inf.axisSnapLine], AXIS_COLOR[inf.axis], true);
      }
      if (app.dyn && app.dyn.open) app.dynFillFromTool();
    } else {
      const s = view.toScreen(p);
      showCursorCoords(view, s, inf, p);
    }
    view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
  }
  // ---- AutoCAD dynamic input fields ----
  dynSpec() {
    if (!this.anchor) return null;
    const p = this._dynPt || this.previewEnd || this.anchor; // no move yet: zero-length spec still opens the fields
    const d = G.sub(p, this.anchor);
    return { length: Math.hypot(d.x, d.y), angle: Math.atan2(d.y, d.x) * 180 / Math.PI };
  }
  dynApply(v) {
    const a = (v.angle || 0) * Math.PI / 180;
    let end = G.add(this.anchor, G.mul(G.v(Math.cos(a), Math.sin(a), 0), v.length));
    if (this.plane) { // keep the typed point on the drawing plane
      const dd = G.dot(this.plane.n, end) - this.plane.d;
      end = G.sub(end, G.mul(this.plane.n, dd));
    }
    this._dynPt = end;
    this._dynRedraw();
  }
  _dynRedraw() {
    const view = this.app.view;
    view.clearPreview();
    view.previewLine([this.anchor, this._dynPt], 0x2b2b2b);
    view.stickyLabel(this._dynPt, fmtLen(G.dist(this.anchor, this._dynPt)) + ` @ ${(+this.app.dynAng.value || 0)}\u00B0`, '#0a5f61', 0, 0);
    this.previewEnd = this._dynPt;
    view.showSnapDot(null);
  }
  dynCommit() {
    if (!this.anchor || !this._dynPt) return;
    const p = this._dynPt;
    this._dynPt = null;
    this._commit(p);
  }
  _commit(p) {
    const app = this.app;
    if (app.dynHide) app.dynHide();
    const e = app.run('line', m => m.addEdge(this.anchor, p));
    this.anchor = e ? p : null;
    this.status();
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const { p } = this._point(ev);
    if (!this.anchor) {
      // capture the drawing plane from the first point: the ground (z = 0)
      // or the picked face's plane; everything after stays on it
      const app = this.app;
      const inf = app.inferPoint(ev);
      if (inf.kind === 'ground') this.plane = { n: G.v(0, 0, 1), d: 0 };
      else if (inf.kind === 'face') {
        const fid = app.view.pickFaceAt(app.view.eventPt(ev));
        const f = fid != null ? app.model.faces.get(fid) : null;
        if (f) this.plane = app.model.facePlane(f);
      } else this.plane = null;
      this.anchor = p; this.status(); return;
    }
    this._commit(p);
  }
  onKey(ev) {
    if (ev.key === 'Escape') {
      this.anchor = null; this.previewEnd = null;
      this.app.view.clearPreview(); this.status();
      return true;
    }
    return false;
  }
  onVCB(text) {
    if (!this.anchor || !this.previewEnd) return false;
    const L = parseLen(text);
    if (L == null || L <= 0) return false;
    let dir = G.sub(this.previewEnd, this.anchor);
    if (G.len(dir) < 1e-9) return false;
    this._commit(G.add(this.anchor, G.mul(G.norm(dir), L)));
    return true;
  }
}

// =========================================================== rectangle
class RectTool extends Tool {
  static id = 'rect';
  activate() { this.p1 = null; this.plane = null; this.cur = null; }
  cleanup() { super.cleanup(); this.activate(); }
  get hint() {
    return this.p1
      ? 'Rectangle: click the opposite corner. Type "3,4" (width,height) + Enter for exact size. Esc cancels.'
      : 'Rectangle: click a corner (on the ground or on any face).';
  }
  _planePick(ev) {
    const app = this.app;
    const fid = app.view.pickFaceAt(app.view.eventPt(ev));
    if (fid != null) {
      const f = app.model.faces.get(fid);
      return { plane: app.model.facePlane(f), faceId: fid };
    }
    return { plane: { n: G.v(0, 0, 1), d: 0 }, faceId: null };
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    if (!this.p1) {
      const pick = this._planePick(ev);
      this.plane = pick.plane;
      const inf = app.inferPoint(ev, null);
      this.p1 = projectToPlane(inf.p, this.plane);
      this.status();
    } else {
      if (!this.cur) { // click landed without a prior mouse move
        const inf = app.inferPoint(ev, this.p1);
        this.cur = projectToPlane(inf.p, this.plane);
      }
      this._commit(this._dims(this.cur));
    }
  }
  _dims(p2) {
    const { u, v } = G.basisForNormal(this.plane.n);
    const d = G.sub(p2 || G.v(), this.p1);
    return { u, v, a: G.dot(d, u), b: G.dot(d, v) };
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    if (!this.p1) { view.clearPreview(); return; }
    const inf = app.inferPoint(ev, this.p1);
    let p = projectToPlane(inf.p, this.plane);
    // axis-parallel square hint: infer equal sides from on-plane move
    this.cur = p;
    const { u, v, a, b } = this._dims(p);
    const P1 = this.p1;
    const P2 = G.add(P1, G.mul(u, a));
    const P3 = G.add(P2, G.mul(v, b));
    const P4 = G.add(P1, G.mul(v, b));
    view.clearPreview();
    const loop = [P1, P2, P3, P4];
    view.previewLoop(loop, 0xd23c2e); // red while drawing, like the reference
    view.previewFill([{ outer: loop }], 0x2f6fdb, 0.10);
    const s = view.toScreen(P3);
    view.stickyLabel(P3, `${fmtLen(Math.abs(a))}, ${fmtLen(Math.abs(b))}`, '#333', 0, 0);
    showCursorCoords(view, s, inf, p);
    if (Math.abs(a) > 0.15 && Math.abs(b) > 0.15) { // coordinates of all four corners
      const cl = [[P1, 10, 20], [P2, 10, 20], [P3, -10, 36], [P4, -10, 20]];
      for (const [c, dx, dy] of cl) {
        const sc = view.toScreen(c);
        view.hudLabel(sc.x + dx, sc.y + dy, fmtCoord(c), '#b03028');
      }
    }
    view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
  }
  _build(a, b) {
    const { u, v } = G.basisForNormal(this.plane.n);
    const P1 = this.p1;
    const P2 = G.add(P1, G.mul(u, a));
    const P3 = G.add(P2, G.mul(v, b));
    const P4 = G.add(P1, G.mul(v, b));
    const loop = [P1, P2, P3, P4];
    if (G.dot(G.loopNormal(loop), this.plane.n) < 0) loop.reverse();
    return loop;
  }
  _commitFrom(a, b) {
    const app = this.app;
    const loop = this._build(a, b);
    if (G.loopArea(loop) < 1e-9) { app.toast('Rectangle is flat'); return; }
    app.run('rectangle', m => {
      const f = m.addFaceFromRings(loop, []);
      if (f) m.punchOrSplit(f);
    });
    this.activate();
    this.status();
  }
  _commit() { const { a, b } = this._dims(this.cur); this._commitFrom(a, b); }
  onKey(ev) {
    if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); this.status(); return true; }
    return false;
  }
  onVCB(text) {
    if (!this.p1) return false;
    let a = null, b = null;
    const parts = String(text).split(/[,;]/);
    if (parts.length >= 2) {
      a = parseLen(parts[0]); b = parseLen(parts[1]);
    } else {
      a = parseLen(parts[0]); b = a;
    }
    if (a == null || b == null) return false;
    if (!this.plane) return false;
    // typed sizes follow the drag quadrant (draw left => built left); an
    // explicitly negative value flips relative to that quadrant
    const { a: ca, b: cb } = this._dims(this.cur || this.p1);
    const sa = (Math.abs(ca) > 1e-9 ? Math.sign(ca) : 1) * (a < 0 ? -1 : 1);
    const sb = (Math.abs(cb) > 1e-9 ? Math.sign(cb) : 1) * (b < 0 ? -1 : 1);
    this._commitFrom(Math.abs(a) * sa, Math.abs(b) * sb);
    return true;
  }
}

// =========================================================== circle / polygon
class CircleTool extends Tool {
  static id = 'circle';
  constructor(app, polygon = false) {
    super(app);
    this.polygon = polygon;
    this.sides = polygon ? 6 : 24;
  }
  activate() { this.center = null; this.plane = null; this.r = 0; this._pts = null; }
  cleanup() { super.cleanup(); this.activate(); }
  get hint() {
    const nm = this.polygon ? 'Polygon' : 'Circle';
    return this.center
      ? `${nm}: click to set the radius (type a value + Enter; "1,12" = radius,sides). Esc cancels.`
      : `${nm}: click to set the center point (on the ground or on a face).`;
  }
  _tess(p2) {
    const { u, v } = G.basisForNormal(this.plane.n);
    const r = G.dist(this.center, p2);
    const pts = [];
    for (let i = 0; i < this.sides; i++) {
      const t = i / this.sides * Math.PI * 2;
      pts.push(G.add(G.add(this.center, G.mul(u, Math.cos(t) * r)), G.mul(v, Math.sin(t) * r)));
    }
    return { r, pts };
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    if (!this.center) {
      const fid = app.view.pickFaceAt(app.view.eventPt(ev));
      this.plane = fid != null ? app.model.facePlane(app.model.faces.get(fid)) : { n: G.v(0, 0, 1), d: 0 };
      const inf = app.inferPoint(ev, null);
      this.center = projectToPlane(inf.p, this.plane);
      this.status();
    } else {
      if (this._r == null) { // click landed without a prior mouse move
        const inf = app.inferPoint(ev, this.center);
        this._r = G.dist(this.center, projectToPlane(inf.p, this.plane));
      }
      this._commit(this._r);
    }
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    if (!this.center) { view.clearPreview(); return; }
    // two-axis lock re-aims the sketch plane through the center (vertical /
    // angled circles)
    const lp = app.lockedPlane(this.center);
    if (lp) this.plane = lp;
    const inf = app.inferPoint(ev, this.center);
    const p = projectToPlane(inf.p, this.plane);
    const { r, pts } = this._tess(p);
    this._r = r;
    view.clearPreview();
    view.previewLoop(pts, 0x2b2b2b);
    view.previewLine([this.center, pts[0]], 0x8a8a8a, true);
    if (!this.polygon) view.previewFill([{ outer: pts }], 0x2f6fdb, 0.08);
    const s = view.toScreen(p);
    view.stickyLabel(p, `r ${fmtLen(r)}  ·  ${this.sides} sides`, '#333', 0, 0);
    showCursorCoords(view, s, inf, p);
    const sc = view.toScreen(this.center);
    view.hudLabel(sc.x, sc.y - 16, fmtCoord(this.center), '#5a3fa0');
    view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
  }
  _commit(r) {
    const app = this.app;
    if (!r || r < 1e-6) { app.toast('Radius is too small'); return; }
    const { u, v } = G.basisForNormal(this.plane.n);
    const pts = [];
    for (let i = 0; i <= this.sides; i++) {
      const t = i / this.sides * Math.PI * 2;
      pts.push(G.add(G.add(this.center, G.mul(u, Math.cos(t) * r)), G.mul(v, Math.sin(t) * r)));
    }
    app.run(this.polygon ? 'polygon' : 'circle', m => {
      m.addPolyline(pts, { type: this.polygon ? 'polygon' : 'circle', center: G.clone(this.center), radius: r, normal: G.clone(this.plane.n), sides: this.sides });
      const f = m.addFaceFromRings(pts.slice(0, this.sides), []);
      if (f) m.punchOrSplit(f);
    });
    this.activate();
    this.status();
  }
  onKey(ev) {
    if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); this.status(); return true; }
    return false;
  }
  onVCB(text) {
    if (!this.center) {
      const m = String(text).match(/^(\d+)\s*s$/);
      if (m) { this.sides = Math.max(3, Math.min(256, parseInt(m[1]))); this.app.toast(`${this.sides} sides`); return true; }
      return false;
    }
    const parts = String(text).split(/[,;]/);
    const r = parseLen(parts[0]);
    if (r == null) return false;
    if (parts[1]) {
      const s = parseInt(parts[1]);
      if (s >= 3 && s <= 256) this.sides = s;
    }
    this._commit(r);
    return true;
  }
}

// =========================================================== arc
class ArcTool extends Tool {
  static id = 'arc';
  activate() { this.s = null; this.e = null; this.plane = null; this.bulge = null; }
  cleanup() { super.cleanup(); this.activate(); }
  get hint() {
    if (!this.s) return 'Arc: click the start point.';
    if (!this.e) return 'Arc: click the end point (chord).';
    return 'Arc: move to set the bulge, click to finish. Type radius or bulge + Enter.';
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    if (!this.s) {
      const fid = app.view.pickFaceAt(app.view.eventPt(ev));
      this.plane = fid != null ? app.model.facePlane(app.model.faces.get(fid)) : { n: G.v(0, 0, 1), d: 0 };
      this.s = projectToPlane(app.inferPoint(ev, null).p, this.plane);
    } else if (!this.e) {
      // a two-axis lock (V + X/Z, V + Y/Z, ...) re-aims the sketch plane
      // through the start point — vertical and angled arcs
      const lp = app.lockedPlane(this.s);
      if (lp) this.plane = lp;
      this.e = projectToPlane(app.inferPoint(ev, this.s).p, this.plane);
      if (G.dist(this.s, this.e) < 1e-6) { this.e = null; app.toast('Arc end too close to start'); }
    } else {
      this._commit(this.bulge);
    }
    this.status();
  }
  _arc(bulgePt) {
    if (!bulgePt) return null;
    let cc = G.circumcenter(this.s, this.e, bulgePt);
    if (!cc) { // degenerate: nudge bulge perpendicular
      const mid = G.mul(G.add(this.s, this.e), 0.5);
      const { u } = G.basisForNormal(this.plane.n);
      const perp = G.sub(this.e, this.s);
      const tmp = G.add(mid, G.mul(G.cross(this.plane.n, perp), 0.001));
      cc = G.circumcenter(this.s, this.e, tmp);
      if (!cc) return null;
    }
    const { u, v } = G.basisForNormal(this.plane.n);
    const O = cc.center;
    const ang = p => Math.atan2(G.dot(G.sub(p, O), v), G.dot(G.sub(p, O), u));
    const a0 = ang(this.s), a1 = ang(this.e), aB = ang(bulgePt);
    let sweep = a1 - a0;
    const d1 = ((aB - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI; // signed to bulge
    // choose sweep direction passing through bulge
    let norm = ((sweep % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    if (Math.sign(norm) !== Math.sign(d1) || Math.abs(norm) < Math.abs(d1) - 1e-6) {
      norm = norm - Math.sign(norm || 1) * Math.PI * 2;
    }
    const n2 = Math.max(6, Math.ceil(Math.abs(norm) / (Math.PI / 32)));
    const pts = [];
    for (let i = 0; i <= n2; i++) {
      const t = a0 + norm * (i / n2);
      pts.push(G.add(O, G.add(G.mul(u, Math.cos(t) * cc.r), G.mul(v, Math.sin(t) * cc.r))));
    }
    return { pts, center: O, radius: cc.r, normal: this.plane.n, type: 'arc' };
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    view.clearPreview();
    if (!this.s || !this.e) {
      // live plane re-aim while the two-axis lock is armed (before the end
      // point fixes the arc's plane)
      const lp = this.s ? app.lockedPlane(this.s) : null;
      if (lp) this.plane = lp;
      const inf0 = app.inferPoint(ev, this.s || null);
      const p0 = this.plane ? projectToPlane(inf0.p, this.plane) : inf0.p;
      const s0 = view.toScreen(p0);
      showCursorCoords(view, s0, inf0, p0);
      view.showSnapDot(inf0.kind === 'axis' || inf0.kind === 'free' ? null : inf0.p, inf0.kind);
      return;
    }
    const inf = app.inferPoint(ev, this.s);
    const bulgePt = projectToPlane(inf.p, this.plane);
    const arc = this._arc(bulgePt);
    this.bulge = bulgePt;
    this._arcData = arc;
    if (arc) {
      view.previewLine(arc.pts, 0x2b2b2b);
      const half = G.dist(this.s, this.e) / 2;
      const sag = arc.radius - Math.sqrt(Math.max(arc.radius * arc.radius - half * half, 0));
      const s = view.toScreen(bulgePt);
      view.stickyLabel(bulgePt, `r ${fmtLen(arc.radius)} · bulge ${fmtLen(sag)}`, '#333', 0, 0);
      showCursorCoords(view, s, inf, bulgePt);
    }
    view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
  }
  _commit(bulgePt) {
    const app = this.app;
    const arc = this._arcData || this._arc(bulgePt);
    if (!arc) { app.toast('Arc is degenerate'); return; }
    app.run('arc', m => m.addPolyline(arc.pts, { type: 'arc', center: arc.center, radius: arc.radius, normal: arc.normal }));
    this.activate();
    this.status();
  }
  onKey(ev) {
    if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); this.status(); return true; }
    return false;
  }
  onVCB(text) {
    if (!this.s || !this.e || !this.bulge) return false;
    const val = parseLen(text);
    if (val == null) return false;
    const chord = G.dist(this.s, this.e);
    const { u, v } = G.basisForNormal(this.plane.n);
    const mid = G.mul(G.add(this.s, this.e), 0.5);
    const dir = G.norm(G.cross(this.plane.n, G.sub(this.e, this.s)));
    const side = Math.sign(G.dot(G.sub(this.bulge, mid), dir)) || 1;
    let sag;
    if (val >= chord / 2) { // radius
      const h = Math.sqrt(Math.max(val * val - (chord / 2) ** 2, 0));
      sag = val - h;
    } else sag = val; // bulge
    const bulgePt = G.add(mid, G.mul(dir, sag * side));
    this.bulge = bulgePt;
    this._arcData = this._arc(bulgePt);
    this._commit(bulgePt);
    return true;
  }
}

// =========================================================== push/pull
class PushPullTool extends Tool {
  static id = 'pushpull';
  activate() { this.faceId = null; this.mode = null; this.dist = 0; this.startXY = null; this._rear = null; this.bimSync = null; }
  cleanup() { super.cleanup(); this.activate(); }
  get hint() {
    return 'Push/Pull: click a face and drag (or click-move-click). Type an exact distance + Enter. Double-click repeats the last distance. Pushing inward snaps to the far face for a clean through-punch.';
  }
  _face() { return this.app.model.faces.get(this.faceId); }
  _normal(f) {
    const n = G.loopNormal(this.app.model.pts(f.loop));
    return n;
  }
  // screen-projected pixels per meter along the face normal (snap threshold)
  _pxPerMeter(f) {
    const app = this.app;
    const c = app.model.faceCentroid(f);
    const s0 = app.view.toScreen(c);
    const s1 = app.view.toScreen(G.add(c, this._normal(f)));
    return Math.hypot(s1.x - s0.x, s1.y - s0.y) || 0;
  }
  // SketchUp through-snap: while pushing inward, detect the opposing face
  // (wall thickness T) and lock the distance to exactly -T when the cursor
  // nears it — hovering the rear face's surface (face pick), snapping to an
  // edge/vertex/center point on its plane, or dragging within ~10 px of the
  // exact depth. Committing at -T punches a clean through-opening.
  _snapThrough(ev) {
    const app = this.app, f = this._face();
    if (!f || this.dist >= -1e-6) return; // inward pushes only
    if (this._rear === undefined || this._rear === null) {
      const n = this._normal(f);
      const blk = app.model.findBlockingFace(f, f.loop, n, -1e4); // probe at any depth
      this._rear = blk ? { t: blk.t, fid: blk.face.id } : false; // false = none behind
    }
    if (!this._rear) return;
    const target = -this._rear.t;
    const n = this._normal(f);
    // (a) pixel proximity of the current depth to -T along the drag axis
    const px = this._pxPerMeter(f);
    if (px > 0 && Math.abs(this.dist - target) * px < 10) { this.dist = target; return; }
    // (b) inference on the rear face: 'On Face' over it, or a snapped
    // endpoint/midpoint/center lying on its plane
    const q = app.view.eventPt(ev);
    if (app.view.pickFaceAt(q) === this._rear.fid) { this.dist = target; return; }
    const p0 = app.model.vp(f.loop[0]);
    const dRear = G.dot(n, p0) - this._rear.t;
    const inf = app.inferPoint(ev);
    if (inf && (inf.kind === 'endpoint' || inf.kind === 'midpoint' || inf.kind === 'center') &&
      Math.abs(G.dot(n, inf.p) - dRear) < 1e-5) this.dist = target;
  }
  _distFromMouse(ev, f) {
    const app = this.app;
    const c = app.model.faceCentroid(f);
    const n = this._normal(f);
    const s0 = app.view.toScreen(c);
    const s1 = app.view.toScreen(G.add(c, n));
    const dx = s1.x - s0.x, dy = s1.y - s0.y;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-6) return this.dist;
    const q = app.view.eventPt(ev);
    return ((q.x - this.startXY.x) * dx + (q.y - this.startXY.y) * dy) / L2;
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    if (this.faceId != null && (this.mode === 'drag' || this.mode === 'click' || this.mode === 'pending')) {
      const q = view.eventPt(ev);
      if (this.mode === 'pending' && Math.hypot(q.x - this.startXY.x, q.y - this.startXY.y) > 4) this.mode = 'drag';
      if (this.mode !== 'pending') {
        this.dist = this._distFromMouse(ev, this._face());
        this._snapThrough(ev); // may lock this.dist to exactly -T (through)
        this._preview();
      }
      return;
    }
    const fid = view.pickFaceAt(view.eventPt(ev));
    view.setHoverFace(fid);
    view.setHoverEdges(null);
  }
  _cursorOnFacePlane(ev, f) {
    const app = this.app;
    const plane = app.model.facePlane(f);
    const { ro, rd } = app.view.rayFrom(app.view.eventPt(ev));
    return G.rayPlane(ro, rd, plane);
  }
  _preview() {
    const app = this.app, view = app.view, model = app.model;
    const f = this._face();
    if (!f) return;
    const n = this._normal(f);
    // drag distance is incremental from the face's current position (SketchUp)
    const eff = this.dist;
    view.clearPreview();
    const rings = model.rings(f).map(r => model.pts(r));
    const tops = rings.map(r => r.map(p => G.add(p, G.mul(n, eff))));
    view.previewFill(tops.map(t => ({ outer: t })), f.color ? parseInt(f.color.slice(1), 16) : 0xffffff, 0.5);
    view.previewQuadsBetween(rings[0], tops[0]);
    view.previewLoop(tops[0], 0x2b2b2b);
    const snapped = this._rear && this._rear.t && Math.abs(this.dist + this._rear.t) < 1e-9;
    if (this.bimSync) {
      const ent = app.bim.getEntityById(this.bimSync);
      const newH = ent ? Math.max(0.05, ent.params.height + this.dist) : null;
      view.stickyLabel(tops[0][0], newH != null ? `${fmtLen(newH)} wall height` : fmtLen(Math.abs(this.dist)), '#333');
      return;
    }
    view.stickyLabel(tops[0][0], fmtLen(Math.abs(this.dist)) + (snapped ? ' — through' : ''), '#333');
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    if (this.mode === 'click') return; // second click of click-move-click: commit on up
    const app = this.app;
    const fid = app.view.pickFaceAt(app.view.eventPt(ev));
    if (fid == null) { this.activate(); app.view.clearPreview(); return; }
    // only closed, valid 2D faces with a normal and area may be extruded —
    // never raw edges or degenerate loops (they would sweep into a sheet)
    const f = app.model.faces.get(fid);
    if (!f || app.model.faceArea(f) < 1e-6 || G.isZero(G.loopNormal(app.model.pts(f.loop)))) {
      app.toast('Pick a valid face — edges alone cannot be pushed');
      return;
    }
    this.faceId = fid;
    this.startXY = app.view.eventPt(ev);
    this.mode = 'pending';
    this.dist = 0;
    this._rear = null; // re-detect the opposing face for this interaction
    // parametric sync: pushing a BIM wall's TOP face edits wall.height — the
    // entity stays intact instead of becoming arbitrary free geometry.
    // Every OTHER stamped face refuses the push (Revit-method guard): its
    // geometry belongs to the element's parameters, not to the B-Rep editor.
    this.bimSync = null;
    if (bimGuardFace(app, f, true)) { this.activate(); return; }
    const ud = f.userData;
    if (ud && ud.bimType === 'wall' && ud.role === 'top') this.bimSync = ud.bimEntityId;
  }
  onUp(ev) {
    if (this.mode === 'drag') this._commit(this.dist);
    else if (this.mode === 'pending') { this.mode = 'click'; this.status(); }
    else if (this.mode === 'click') this._commit(this.dist);
  }
  _commit(d) {
    const app = this.app, f = this._face();
    if (!f) { this.activate(); return; }
    if (this.bimSync) {
      const ent = app.bim.getEntityById(this.bimSync);
      if (ent && Math.abs(d) > 1e-9) {
        const ok = app.run('wall height', () => app.bim.syncWallHeight(this.bimSync, ent.params.height + d));
        if (ok) { PushPullTool.lastDist = d; this.activate(); app.view.clearPreview(); return; }
      }
      this.activate(); app.view.clearPreview(); return;
    }
    let dist = d;
    if (f.extrude) {
      const ax = G.norm(f.extrude.axis);
      const sign = G.dot(this._normal(f), ax) >= 0 ? 1 : -1;
      dist = d * sign;
    }
    const ok = app.run('push/pull', m => m.pushPull(f, dist));
    if (ok) PushPullTool.lastDist = d; // signed, relative to the face normal
    this.activate();
    app.view.clearPreview();
  }
  onDoubleClick(ev) {
    const app = this.app;
    const fid = app.view.pickFaceAt(app.view.eventPt(ev));
    const last = PushPullTool.lastDist;
    if (fid == null || last == null) return;
    const f = app.model.faces.get(fid);
    // repeat-push has no parametric sync path — a stamped face is refused
    if (bimGuardFace(app, f, false)) return;
    app.run('push/pull', m => {
      let dist = last;
      if (f.extrude) {
        const ax = G.norm(f.extrude.axis);
        const sign = G.dot(G.loopNormal(m.pts(f.loop)), ax) >= 0 ? 1 : -1;
        dist = last * sign;
      }
      m.pushPull(f, dist);
    });
  }
  onKey(ev) {
    if (ev.key === 'Escape' && this.faceId != null) { this.activate(); this.app.view.clearPreview(); return true; }
    return false;
  }
  onVCB(text) {
    if (this.faceId == null || this.mode == null || this.mode === 'pending') return false;
    const d = parseLen(text);
    if (d == null) return false;
    this._commit(d);
    return true;
  }
}
PushPullTool.lastDist = null;

// =========================================================== move
class MoveTool extends Tool {
  static id = 'move';
  activate() { this.start = null; this.delta = null; this.orig = null; this.snapshot = null; this.dragging = false; this.downXY = null; this._assets = null; }
  cleanup() { super.cleanup(); this.activate(); }
  get hint() {
    return 'Move: click-drag selected geometry (auto-selects what you click). Hold Ctrl to copy. Arrows lock an axis; type a distance + Enter. Downloaded models drag in plan; hosted doors/windows slide along their wall.';
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    if (!app.sel.faces.size && !app.sel.edges.size) {
      if (!app.selAssets.size) {
        const pick = app.pickEntity(ev);
        if (pick.asset != null) app.selectAsset(pick.asset);
        else if (pick.group != null) app.selectGroup(pick.group);
        else if (pick.face != null) app.sel = { edges: new Set(), faces: new Set([pick.face]) };
        else if (pick.edges && pick.edges.length) app.sel = { edges: new Set(pick.edges), faces: new Set() };
        else { app.toast('Nothing selected — click geometry or select it first'); return; }
        app.onSelectionChanged();
      }
    }
    // ---- downloaded-asset instances (foreign groups, no kernel verts) ----
    if (app.selAssets.size && app.assets) {
      const recs = [...app.selAssets].map(id => app.assets.get(id)).filter(Boolean);
      if (recs.length) {
        const hosted = recs.filter(r => r.host && app.bim.getEntityById(r.host.wallId));
        this._assets = {
          free: recs.filter(r => !r.host).map(r => ({ rec, pos: r.object.position.clone() })),
          hosted: hosted.length ? { rec: hosted[0], d: hosted[0].host.distance } : null,
          start: null,
        };
        this.start = app.inferPoint(ev, null).p;
        this._assets.start = this.start;
        this.downXY = app.view.eventPt(ev);
        this.dragging = false;
        this.copyMode = false;
        if (this._assets.hosted && recs.length > 1)
          app.setStatus(`Sliding “${this._assets.hosted.rec.name}” along its wall (other selection moves in plan)`);
        return;
      }
    }
    const inf = app.inferPoint(ev, null);
    this.start = inf.p;
    this.orig = app.selectionVerts();
    this.snapshot = app.snapshotSelection();
    this.downXY = app.view.eventPt(ev);
    this.dragging = false;
    this.copyMode = ev.ctrlKey;
  }
  // cursor projected onto the hosted wall's baseline, clamped so the opening
  // stays inside the wall (same bounds HostedInsertionTool._proj enforces)
  _hostT(ev) {
    const app = this.app;
    const { rec } = this._assets.hosted;
    const ent = app.bim.getEntityById(rec.host.wallId);
    if (!ent) return null;
    const P1 = G.v(...ent.params.base), P2 = G.v(...ent.params.end);
    const dir = G.norm(G.v(P2.x - P1.x, P2.y - P1.y, 0));
    const L = G.dist(P1, P2);
    const gp = app.view.groundAt(app.view.eventPt(ev)) || app.inferPoint(ev, null).p;
    const half = rec.host.width / 2;
    const raw = G.dot(G.sub(G.v(gp.x, gp.y, P1.z), P1), dir);
    return {
      t: Math.min(Math.max(raw, half + 0.05), Math.max(half + 0.05, L - half - 0.05)),
      ent, dir, L, P1,
    };
  }
  _applyHostedPreview(rec, t, ent) {
    const HostedCut = window.BimTools && window.BimTools.HostedCut;
    if (!HostedCut) return;
    const info = HostedCut.locate(G, ent.params, {
      distanceFromStart: t, width: rec.host.width, height: rec.host.height, sillHeight: rec.host.sill,
    });
    if (info.error) return;
    this.app.assets.applyHostedTransform(rec, {
      ...info,
      depth: rec.host.depth > 0 ? rec.host.depth : ent.params.thickness,
    });
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    if (!this.start) return;
    if (!this.dragging) {
      const q = view.eventPt(ev);
      if (Math.hypot(q.x - this.downXY.x, q.y - this.downXY.y) < 3) return;
      this.dragging = true;
    }
    // ---- asset drags ----
    if (this._assets) {
      if (this._assets.hosted) {
        const pr = this._hostT(ev);
        if (pr) {
          this._assets.t = pr.t;
          this._applyHostedPreview(this._assets.hosted.rec, pr.t, pr.ent);
          const s = view.toScreen(G.add(pr.P1, G.mul(pr.dir, pr.t)));
          view.hudLabel(s.x, s.y, fmtLen(pr.t) + ' from start');
        }
      }
      if (this._assets.free.length) {
        const inf = app.inferPoint(ev, this._assets.start);
        let delta = G.sub(inf.p, this._assets.start);
        if (app.lockAxis) delta = G.mul(AXES[app.lockAxis], G.dot(delta, AXES[app.lockAxis]));
        else if (inf.axis) delta = G.mul(AXES[inf.axis], G.dot(delta, AXES[inf.axis]));
        this._assets.delta = delta;
        for (const f of this._assets.free)
          f.rec.object.position.set(f.pos.x + delta.x, f.pos.y + delta.y, f.pos.z + delta.z);
        const s = view.toScreen(G.add(this._assets.start, delta));
        view.hudLabel(s.x, s.y, fmtLen(G.len(delta)));
      }
      view.showSnapDot(null);
      return;
    }
    const inf = app.inferPoint(ev, this.start);
    let delta = G.sub(inf.p, this.start);
    if (app.lockAxis) {
      const ax = AXES[app.lockAxis];
      delta = G.mul(ax, G.dot(delta, ax));
    } else if (inf.axis) {
      const ax = AXES[inf.axis];
      delta = G.mul(ax, G.dot(delta, ax));
    }
    this.delta = delta;
    view.clearPreview();
    app.renderGhost(this.snapshot, p => G.add(p, delta));
    const s = view.toScreen(G.add(this.start, delta));
    view.hudLabel(s.x, s.y, fmtLen(G.len(delta)));
    view.showSnapDot(null);
  }
  onUp(ev) {
    const app = this.app;
    if (this._assets && this.dragging) {
      const A = this._assets;
      const finish = () => {
        // run() snapshots BEFORE its fn runs: restore the pre-drag state so
        // the undo stack captures it, then apply the final positions inside
        // the transaction — undo then rolls the whole move back
        for (const f of A.free) f.rec.object.position.copy(f.pos);
        if (A.hosted) A.hosted.rec.host.distance = A.hosted.d;
        app.run('move assets', () => {
          if (A.hosted && A.t != null) {
            A.hosted.rec.host.distance = A.t;
            app.bim.rebuildWallWithHosts(A.hosted.rec.host.wallId);
          }
          if (A.delta) for (const f of A.free)
            f.rec.object.position.set(f.pos.x + A.delta.x, f.pos.y + A.delta.y, f.pos.z + A.delta.z);
        });
        // explicit confirmation — a silent move is indistinguishable from a
        // failed one until the camera moves
        if (A.hosted && A.t != null)
          app.toast(`${A.hosted.rec.name} slid to ${fmtLen(A.t)} from the wall's start`);
        else if (A.delta && A.free.length)
          app.toast(`Moved ${A.free.length === 1 ? `“${A.free[0].rec.name}”` : A.free.length + ' assets'} ${fmtLen(G.len(A.delta))}`);
      };
      finish();
      this.activate();
      app.view.clearPreview();
      return;
    }
    if (this.dragging && this.delta) {
      if (this.copyMode || (ev.ctrlKey && this.snapshot)) {
        app.run('move copy', m => m.importSubset(m.serializeSubset(app.sel), this.delta));
      } else {
        app.run('move', m => m.transformVertices(this.orig, p => G.add(p, this.delta)));
      }
    }
    this.activate();
    app.view.clearPreview();
  }
  onKey(ev) {
    if (ev.key === 'Escape' && this.dragging) {
      if (this._assets) { // restore the pre-drag state exactly
        const A = this._assets;
        for (const f of A.free) f.rec.object.position.copy(f.pos);
        if (A.hosted) {
          A.hosted.rec.host.distance = A.hosted.d;
          this._applyHostedPreview(A.hosted.rec, A.hosted.d, app.bim.getEntityById(A.hosted.rec.host.wallId));
        }
      }
      this.activate();
      this.app.view.clearPreview();
      return true;
    }
    return false;
  }
  onVCB(text) {
    if (this._assets && this._assets.hosted && this._assets.t != null) {
      const L = parseLen(text);
      if (L == null || L <= 0) return false;
      const A = this._assets, rec = A.hosted.rec;
      const ent = app.bim.getEntityById(rec.host.wallId);
      if (!ent) return false;
      app.run('slide asset', () => {
        rec.host.distance = L;
        app.bim.rebuildWallWithHosts(rec.host.wallId);
      });
      this.activate();
      return true;
    }
    if (!this.delta) return false;
    const L = parseLen(text);
    if (L == null) return false;
    const d = G.len(this.delta);
    if (d < 1e-9) return false;
    const delta = G.mul(this.delta, L / d);
    const app = this.app;
    if (this.copyMode) app.run('move copy', m => m.importSubset(m.serializeSubset(app.sel), delta));
    else app.run('move', m => m.transformVertices(this.orig, p => G.add(p, delta)));
    this.activate();
    return true;
  }
}

// =========================================================== rotate
class RotateTool extends Tool {
  static id = 'rotate';
  activate() { this.stage = 0; this.center = null; this.axis = G.v(0, 0, 1); this.ref = null; this.snapshot = null; this.orig = null; }
  cleanup() { super.cleanup(); this.activate(); }
  get hint() {
    if (this.stage === 0) return 'Rotate: click to set the rotation center (on a face = rotate about that face\'s normal; elsewhere = blue axis).';
    if (this.stage === 1) return 'Rotate: click to set the reference angle.';
    return 'Rotate: move to rotate the selection, click to finish. Type an angle in degrees + Enter.';
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    if (this.stage === 0) {
      if (!app.sel.faces.size && !app.sel.edges.size) {
        const pick = app.pickEntity(ev);
        if (pick.group != null) app.selectGroup(pick.group);
        else if (pick.face != null) app.sel = { edges: new Set(), faces: new Set([pick.face]) };
        else if (pick.edges && pick.edges.length) app.sel = { edges: new Set(pick.edges), faces: new Set() };
        else { app.toast('Select something to rotate first'); return; }
        app.onSelectionChanged();
      }
      const inf = app.inferPoint(ev, null);
      this.center = inf.p;
      const fid = app.view.pickFaceAt(app.view.eventPt(ev));
      if (fid != null) this.axis = G.loopNormal(app.model.pts(app.model.faces.get(fid).loop));
      else this.axis = G.v(0, 0, 1);
      if (G.isZero(this.axis)) this.axis = G.v(0, 0, 1);
      this.snapshot = app.snapshotSelection();
      this.orig = app.selectionVerts();
      this.stage = 1;
    } else if (this.stage === 1) {
      this.ref = this._cursor(ev);
      if (G.dist(this.ref, this.center) < 1e-6) return;
      this.stage = 2;
    } else {
      this._commit(this._angle(ev));
    }
    this.status();
  }
  _cursor(ev) {
    const app = this.app;
    const plane = { n: this.axis, d: G.dot(this.axis, this.center) };
    const inf = app.inferPoint(ev, null);
    let p = projectToPlane(inf.p, plane);
    if (G.dist(p, this.center) < 1e-4) {
      const { ro, rd } = app.view.rayFrom(app.view.eventPt(ev));
      const hit = G.rayPlane(ro, rd, plane);
      if (hit) p = hit;
    }
    return p;
  }
  _angle(ev) {
    const c = this._cursor(ev);
    return G.signedAngle(G.sub(this.ref, this.center), G.sub(c, this.center), this.axis);
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    view.clearPreview();
    if (this.stage === 0) { view.showSnapDot(null); return; }
    const cursorDist = G.len(G.sub(this._cursor(ev), this.center));
    const radius = Math.max(1.2, Math.min(cursorDist || 1.2, 40));
    // protractor circle
    const { u, v } = G.basisForNormal(this.axis);
    const circle = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48 * Math.PI * 2;
      circle.push(G.add(this.center, G.add(G.mul(u, Math.cos(t) * radius), G.mul(v, Math.sin(t) * radius))));
    }
    view.previewLine(circle, 0x8096ad);
    if (this.stage >= 1) {
      const cur = this._cursor(ev);
      view.previewLine([this.center, cur], 0x2b2b2b);
      if (this.stage === 1) view.showSnapDot(null);
      if (this.stage === 2) {
        view.previewLine([this.center, this.ref], 0x9a9a9a, true);
        const ang = G.signedAngle(G.sub(this.ref, this.center), G.sub(cur, this.center), this.axis);
        app.renderGhost(this.snapshot, p => G.rotatePoint(p, this.center, this.axis, ang));
        const s = view.toScreen(cur);
        view.hudLabel(s.x, s.y, `${(ang * 180 / Math.PI).toFixed(1)}°`);
      }
    }
  }
  _commit(ang) {
    const app = this.app;
    app.run('rotate', m => {
      m.transformVertices(this.orig, p => G.rotatePoint(p, this.center, this.axis, ang));
      m.clearExtrudes();
    });
    this.activate();
    app.view.clearPreview();
  }
  onKey(ev) {
    if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); this.status(); return true; }
    return false;
  }
  onVCB(text) {
    if (this.stage !== 2) return false;
    const a = parseAngle(text);
    if (a == null) return false;
    this._commit(a);
    return true;
  }
}

// =========================================================== scale
class ScaleTool extends Tool {
  static id = 'scale';
  activate() { this.grips = null; this.active = null; this.snapshot = null; this.orig = null; }
  cleanup() { super.cleanup(); this.activate(); }
  get hint() {
    return this.grips
      ? 'Scale: drag a grip — corners = uniform, face centers = 2 axes, edge centers = 1 axis. Type a factor + Enter.'
      : 'Scale: select geometry first, then pick the Scale tool.';
  }
  _buildGrips() {
    const app = this.app;
    const bb = app.model.bbox(app.selectionVerts());
    if (!bb) { this.grips = null; return; }
    const c = bb.center, h = G.mul(bb.size, 0.5);
    this.center = c; this.half = h;
    const grips = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue;
      const dir = G.v(dx, dy, dz);
      const pos2 = G.v(c.x + h.x * dx, c.y + h.y * dy, c.z + h.z * dz);
      const axes = ['x', 'y', 'z'].filter((a, i) => [dx, dy, dz][i] !== 0);
      grips.push({ dir, pos: pos2, axes, anchor: G.v(c.x - h.x * dx, c.y - h.y * dy, c.z - h.z * dz) });
    }
    this.grips = grips;
    this.snapshot = app.snapshotSelection();
    this.orig = app.selectionVerts();
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const g = this._pickGrip(ev);
    if (!g) return;
    this.active = { grip: g, startXY: this.app.view.eventPt(ev) };
  }
  _pickGrip(ev) {
    if (!this.grips) return null;
    const q = this.app.view.eventPt(ev); // ScreenPt, same frame as toScreen()
    let best = null, bd = 12;
    for (const g of this.grips) {
      const s = this.app.view.toScreen(g.pos);
      const d = Math.hypot(s.x - q.x, s.y - q.y);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }
  _factors(ev) {
    const app = this.app, g = this.active.grip;
    const L = G.v(
      Math.abs(g.pos.x - g.anchor.x) || 1e-9,
      Math.abs(g.pos.y - g.anchor.y) || 1e-9,
      Math.abs(g.pos.z - g.anchor.z) || 1e-9);
    // screen-space measurement along each affected axis
    const f = { x: 1, y: 1, z: 1 };
    const q = app.view.eventPt(ev);
    for (const ax of g.axes) {
      const e = AXES[ax];
      const s0 = app.view.toScreen(g.anchor);
      const s1 = app.view.toScreen(G.add(g.anchor, G.mul(e, L[ax])));
      const dx = s1.x - s0.x, dy = s1.y - s0.y;
      const L2 = dx * dx + dy * dy;
      if (L2 < 1e-4) { f[ax] = 1; continue; }
      const s = ((q.x - this.active.startXY.x) * dx + (q.y - this.active.startXY.y) * dy) / L2;
      f[ax] = Math.max(0.02, Math.min(s, 100));
    }
    if (g.axes.length === 3) { const u = (f.x + f.y + f.z) / 3; f.x = f.y = f.z = u; }
    return f;
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    if (!this.grips) { this._buildGrips(); if (!this.grips) return; }
    view.clearPreview();
    // bbox wireframe
    const c = this.center, h = this.half;
    const boxEdges = [];
    for (let i = 0; i < 8; i++) {
      const a = [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1];
      if (!(i & 1)) boxEdges.push([G.v(c.x + a[0] * h.x, c.y + a[1] * h.y, c.z + a[2] * h.z), G.v(c.x + h.x, c.y + a[1] * h.y, c.z + a[2] * h.z)]);
      if (!(i & 2)) boxEdges.push([G.v(c.x + a[0] * h.x, c.y + a[1] * h.y, c.z + a[2] * h.z), G.v(c.x + a[0] * h.x, c.y + h.y, c.z + a[2] * h.z)]);
      if (!(i & 4)) boxEdges.push([G.v(c.x + a[0] * h.x, c.y + a[1] * h.y, c.z + a[2] * h.z), G.v(c.x + a[0] * h.x, c.y + a[1] * h.y, c.z + h.z)]);
    }
    for (const [p1, p2] of boxEdges) view.previewLine([p1, p2], 0x9aa4b2);

    const hover = this.active ? null : this._pickGrip(ev);
    for (const g of this.grips) {
      const col = this.active && this.active.grip === g ? 0x2f6fdb : (hover === g ? 0x6ea8ff : 0x5a6673);
      const sz = 0.011 * app.view.cam.dist;
      view.previewLine([G.add(g.pos, G.v(-sz, 0, 0)), G.add(g.pos, G.v(sz, 0, 0))], col);
      view.previewLine([G.add(g.pos, G.v(0, -sz, 0)), G.add(g.pos, G.v(0, sz, 0))], col);
      view.previewLine([G.add(g.pos, G.v(0, 0, -sz)), G.add(g.pos, G.v(0, 0, sz))], col);
    }
    if (this.active) {
      const f = this._factors(ev);
      const a = this.active.grip.anchor;
      app.renderGhost(this.snapshot, p => G.v(
        a.x + (p.x - a.x) * f.x,
        a.y + (p.y - a.y) * f.y,
        a.z + (p.z - a.z) * f.z));
      const s = app.view.toScreen(this.active.grip.pos);
      const label = this.active.grip.axes.length === 3
        ? f.x.toFixed(2)
        : this.active.grip.axes.map(ax => f[ax].toFixed(2)).join(', ');
      view.hudLabel(s.x, s.y, label);
    }
  }
  onUp(ev) {
    if (!this.active) return;
    const app = this.app;
    const f = this._factors(ev);
    const a = this.active.grip.anchor;
    app.run('scale', m => {
      m.transformVertices(this.orig, p => G.v(
        a.x + (p.x - a.x) * f.x,
        a.y + (p.y - a.y) * f.y,
        a.z + (p.z - a.z) * f.z));
      m.clearExtrudes();
    });
    this._buildGrips(); // rebuild for next op
    this.active = null;
  }
  onKey(ev) {
    if (ev.key === 'Escape') { this.active = null; this.app.view.clearPreview(); return true; }
    return false;
  }
  onVCB(text) {
    if (!this.snapshot) return false;
    const v = parseFloat(text);
    if (isNaN(v)) return false;
    const app = this.app;
    // uniform scale about the bbox center
    const bb = app.model.bbox(this.orig);
    if (!bb) return false;
    const c = bb.center;
    app.run('scale', m => {
      m.transformVertices(this.orig, p => G.v(
        c.x + (p.x - c.x) * v, c.y + (p.y - c.y) * v, c.z + (p.z - c.z) * v));
      m.clearExtrudes();
    });
    this._buildGrips();
    return true;
  }
}

// =========================================================== paint bucket
class PaintTool extends Tool {
  static id = 'paint';
  get hint() { return `Paint Bucket: click a face to paint it with "${this.app.currentMaterial.name}". Alt+click samples a face's color.`; }
  onMove(ev) {
    const fid = this.app.view.pickFaceAt(app.view.eventPt(ev));
    this.app.view.setHoverFace(fid);
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    const fid = app.view.pickFaceAt(app.view.eventPt(ev));
    if (fid == null) return;
    const f = app.model.faces.get(fid);
    if (ev.altKey) {
      app.setMaterialFromColor(f.color, f.alpha);
      app.toast('Material sampled');
      return;
    }
    app.run('paint', m => {
      // painting a grouped face (outside group edit mode) paints the whole group
      const targets = f.gid && app.activeGroup !== f.gid
        ? [...m.groupEntities(f.gid).faces]
        : [fid];
      for (const id of targets) {
        const ff = m.faces.get(id);
        if (ff) { ff.color = app.currentMaterial.color; ff.alpha = app.currentMaterial.alpha; }
      }
      m.touch(); // paint is display state — the rebuild gate must see it
    });
  }
}

// =========================================================== eraser
class EraserTool extends Tool {
  static id = 'eraser';
  activate() { this._down = false; this.tx = null; }
  cleanup() {
    if (this.tx) { this.tx.rollback(); this.tx = null; } // tool switched mid-erase
    super.cleanup();
  }
  get hint() { return 'Eraser: click/drag over edges to erase them (arcs/circles erase as one; shared edges heal coplanar faces). Hold Ctrl and click to SOFTEN — hide the line, keep the geometry.'; }
  onMove(ev) {
    const app = this.app;
    if (this._down) { this._erase(ev); return; }
    const pick = app.pickEdgeAt(ev, 8);
    if (pick) {
      const ids = pick.edge.curveId ? app.model.curveEdges(pick.edge.curveId).map(e => e.id) : [pick.edge.id];
      app.view.setHoverEdges(ids);
    } else app.view.setHoverEdges(null);
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    this.tx = null;
    this._down = true;
    this._erase(ev);
  }
  _erase(ev) {
    const app = this.app;
    const pick = app.pickEdgeAt(ev, 8);
    if (!pick) return;
    // hard-erase of a BIM element's edge would detach the element's identity;
    // SOFTEN (Ctrl) stays allowed — it is a display-only hidden flag
    if (!(ev.ctrlKey || ev.metaKey) && bimGuardEdge(app, pick.edge)) return;
    if (!this.tx) this.tx = app.begin(ev.ctrlKey || ev.metaKey ? 'soften edge' : 'erase'); // one undo step per drag
    const e = pick.edge;
    const ids = e.curveId ? app.model.curveEdges(e.curveId).map(x => x.id) : [e.id];
    if (ev.ctrlKey || ev.metaKey) {
      // SOFTEN: hide the line, keep the geometry — display-only, so faces,
      // lighting and exports are untouched (Edit > Unhide All brings them back)
      for (const id of ids) { const ed = app.model.edges.get(id); if (ed) ed.hidden = true; }
      app.model.touch(); // display-only flag: no edge/vertex change to bump version
    } else {
      app.model.deleteEdgeIds(ids);
    }
    app.view.rebuild(); // live feedback while dragging
  }
  onUp(ev) {
    if (this.tx) { this.tx.commit(); this.tx = null; }
    this._down = false;
  }
}

// =========================================================== trim / dissolve
// SketchUp-style edge dissolve with coplanar face healing. Click an edge to
// dissolve it; drag to sweep a fence — edges under the cursor light up red
// and dissolve together on release (one undo step per gesture). Coplanar
// owners fuse into a single face; non-coplanar owners go with the edge and
// the shell opens there, like the eraser.
class TrimTool extends Tool {
  static id = 'trim';
  static RED = 0xd23c2e;
  activate() { this._down = false; this._targets = new Set(); }
  cleanup() { this._targets.clear(); this._down = false; super.cleanup(); }
  get hint() { return 'Trim: click an edge to dissolve it — coplanar faces heal into one (collinear corners weld). Drag to sweep edges (red), release to dissolve.'; }
  _idsFor(edge) {
    const m = this.app.model;
    return edge.curveId ? m.curveEdges(edge.curveId).map(x => x.id) : [edge.id];
  }
  onMove(ev) {
    const app = this.app;
    if (this._down) { // sweeping: accumulate everything the cursor crosses
      const pick = app.pickEdgeAt(ev, 8);
      if (pick) this._idsFor(pick.edge).forEach(id => this._targets.add(id));
      app.view.setHoverEdges([...this._targets], TrimTool.RED);
      return;
    }
    const pick = app.pickEdgeAt(ev, 8);
    if (pick) app.view.setHoverEdges(this._idsFor(pick.edge), TrimTool.RED);
    else app.view.setHoverEdges(null, TrimTool.RED);
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    this._down = true;
    this._targets.clear();
    const pick = this.app.pickEdgeAt(ev, 8);
    if (pick) this._idsFor(pick.edge).forEach(id => this._targets.add(id));
    this.app.view.setHoverEdges([...this._targets], TrimTool.RED);
  }
  onUp(ev) {
    const app = this.app;
    this._down = false;
    app.view.setHoverEdges(null, TrimTool.RED);
    if (!this._targets.size) return;
    const tx = app.begin('trim'); // one undo step per gesture
    let healed = 0, opened = 0, welded = 0, refused = 0;
    for (const id of this._targets) {
      const e = app.model.edges.get(id);
      if (!e) continue; // an earlier dissolve in this sweep took it already
      if (bimGuardEdge(app, e)) { refused++; continue; } // parametric cache — not freeform-editable
      const res = app.model.dissolveEdge(e);
      if (!res.ok) { if (res.reason === 'live-extrude') refused++; continue; }
      if (res.action === 'healed') { healed++; welded += (res.welded || []).length; }
      else if (res.action !== 'wire') opened += (res.removedFaces || []).length;
    }
    app.model.gc();
    app.view.rebuild(); // merged surface is immediately one selectable face
    tx.commit();
    this._targets.clear();
    if (refused && !healed && !opened)
      app.toast('Edge carries a live push/pull — collapse it first (double-click the face), then trim', true);
    else if (healed && opened)
      app.toast(`Trimmed — ${healed} healed, ${opened} face${opened > 1 ? 's' : ''} removed (shell opened)`);
    else if (healed)
      app.toast(`Trimmed — ${healed} face${healed > 1 ? 's' : ''} healed${welded ? `, ${welded} collinear vertex${welded > 1 ? 'es' : ''} welded` : ''}`);
    else if (opened)
      app.toast(`Trimmed — ${opened} non-coplanar face${opened > 1 ? 's' : ''} removed, shell opened`);
  }
  onKey(ev) {
    if (ev.key === 'Escape' && (this._down || this._targets.size)) { // cancel the sweep
      this._targets.clear(); this._down = false;
      this.app.view.setHoverEdges(null, TrimTool.RED);
      return true;
    }
    return false;
  }
}

// =========================================================== tape measure
class TapeMeasureTool extends Tool {
  static id = 'tape';
  activate() { this.p1 = null; }
  cleanup() { super.cleanup(); this.activate(); }
  get hint() { return this.p1 ? 'Tape Measure: click the second point.' : 'Tape Measure: click the first point.'; }
  onMove(ev) {
    const app = this.app, view = app.view;
    const inf = app.inferPoint(ev, this.p1);
    view.clearPreview();
    if (this.p1) {
      view.previewLine([this.p1, inf.p], 0x8a2be2);
      const s = view.toScreen(inf.p);
      view.hudLabel(s.x, s.y, fmtLen(G.dist(this.p1, inf.p)));
    }
    view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    const inf = app.inferPoint(ev, this.p1);
    if (!this.p1) { this.p1 = inf.p; return; }
    const d = G.dist(this.p1, inf.p);
    app.setVCB(fmtLen(d));
    app.toast(`Distance: ${fmtLen(d)}`);
    this.p1 = null;
    app.view.clearPreview();
  }
  onKey(ev) { if (ev.key === 'Escape') { this.activate(); return true; } return false; }
}

// =========================================================== offset
class OffsetTool extends Tool {
  static id = 'offset';
  activate() { this.faceId = null; this.dist = 0; this.downXY = null; this.mode = null; }
  cleanup() { super.cleanup(); this.activate(); }
  get hint() { return 'Offset: click a face and drag in/out (or type a distance + Enter). Creates an offset loop — pair with Push/Pull for walls.'; }
  _face() { return this.app.model.faces.get(this.faceId); }
  _checkFace(f) {
    if (!f) return 'Click a face to offset';
    if (f.holes.length) return 'Offsetting faces with holes is not supported yet';
    for (let i = 0; i < f.loop.length; i++) {
      const e = this.app.model.findEdge(f.loop[i], f.loop[(i + 1) % f.loop.length]);
      if (e && e.curveId) {
        const cm = this.app.model.curves.get(e.curveId);
        if (cm && cm.type !== 'circle') return 'Offsetting arcs is not supported yet';
      }
    }
    return null;
  }
  _isCircleFace(f) {
    const cids = new Set();
    for (let i = 0; i < f.loop.length; i++) {
      const e = this.app.model.findEdge(f.loop[i], f.loop[(i + 1) % f.loop.length]);
      if (!e || !e.curveId) return null;
      cids.add(e.curveId);
    }
    if (cids.size !== 1) return null;
    const cm = this.app.model.curves.get([...cids][0]);
    return cm && cm.type === 'circle' ? cm : null;
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    if (this.faceId != null && this.mode) {
      const f = this._face();
      const plane = app.model.facePlane(f);
      const inf = app.inferPoint(ev, null);
      const p = projectToPlane(inf.p, plane);
      const pts = app.model.pts(f.loop);
      const n = G.loopNormal(pts);
      const { u, v } = G.basisForNormal(n);
      let d = Infinity;
      for (let i = 0; i < pts.length; i++) d = Math.min(d, G.distToSeg(p, pts[i], pts[(i + 1) % pts.length]));
      const sign = pointInLoop(p, pts, u, v) ? -1 : 1;
      this.dist = d * sign;
      this._preview();
      return;
    }
    const fid = view.pickFaceAt(view.eventPt(ev));
    view.setHoverFace(fid);
  }
  _loopFor(f, d) {
    const app = this.app;
    const cm = this._isCircleFace(f);
    const pts = app.model.pts(f.loop);
    const n = G.loopNormal(pts);
    if (cm) {
      const r = Math.max(0.001, cm.radius + d);
      const { u, v } = G.basisForNormal(cm.normal);
      const out = [];
      const sides = pts.length;
      for (let i = 0; i < sides; i++) {
        const t = i / sides * Math.PI * 2;
        out.push(G.add(G.add(cm.center, G.mul(u, Math.cos(t) * r)), G.mul(v, Math.sin(t) * r)));
      }
      return { pts: out, circle: { ...cm, radius: r } };
    }
    return { pts: G.offsetLoop(pts, n, d), circle: null };
  }
  _preview() {
    const app = this.app, view = app.view;
    const f = this._face();
    if (!f) return;
    view.clearPreview();
    const off = this._loopFor(f, this.dist);
    view.previewLoop(off.pts, 0x2b2b2b);
    view.previewFill([{ outer: off.pts, holes: [app.model.pts(f.loop)] }], 0x2f6fdb, 0.12);
    const s = view.toScreen(off.pts[0]);
    view.hudLabel(s.x, s.y, fmtLen(Math.abs(this.dist)));
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    if (this.mode === 'click') return; // second click commits on up
    if (this.mode === 'drag') { this._commit(this.dist); return; }
    const fid = app.view.pickFaceAt(app.view.eventPt(ev));
    if (fid == null) return;
    const f = app.model.faces.get(fid);
    const err = this._checkFace(f);
    if (err) { app.toast(err); return; }
    this.faceId = fid;
    this.downXY = app.view.eventPt(ev);
    this.mode = 'pending';
    this.dist = 0;
  }
  onUp(ev) {
    if (this.mode === 'pending') {
      const q = this.app.view.eventPt(ev);
      if (Math.hypot(q.x - this.downXY.x, q.y - this.downXY.y) > 4) this._commit(this.dist);
      else this.mode = 'click';
    } else if (this.mode === 'click') this._commit(this.dist);
  }
  _commit(d) {
    const app = this.app, f = this._face();
    if (!f || Math.abs(d) < 1e-5) { this.activate(); app.view.clearPreview(); return; }
    const pts = app.model.pts(f.loop);
    const n = G.loopNormal(pts);
    // inward clamp
    let dd = d;
    if (dd < 0) {
      const c = app.model.faceCentroid(f);
      let maxD = Infinity;
      for (let i = 0; i < pts.length; i++) maxD = Math.min(maxD, G.distToSeg(c, pts[i], pts[(i + 1) % pts.length]));
      if (-dd > maxD * 0.95) { dd = -maxD * 0.95; app.toast('Offset clamped to fit inside the face'); }
    }
    const off = this._loopFor(f, dd);
    app.run('offset', m => {
      const cm = this._isCircleFace(f);
      if (dd < 0) {
        m.deleteFace(f.id);
        m.addFaceFromRings(off.pts, [], { color: f.color, alpha: f.alpha });
        if (cm) m.addPolyline(off.pts.concat([off.pts[0]]), { ...cm, radius: cm.radius + dd });
        m.addFaceFromRings(pts, [off.pts], { color: f.color, alpha: f.alpha });
      } else {
        m.addFaceFromRings(off.pts, [pts], { color: f.color, alpha: f.alpha });
        if (cm) m.addPolyline(off.pts.concat([off.pts[0]]), { ...cm, radius: cm.radius + dd });
      }
    });
    this.activate();
    app.view.clearPreview();
  }
  onKey(ev) { if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); return true; } return false; }
  onVCB(text) {
    if (this.faceId == null) return false;
    const d = parseLen(text);
    if (d == null) return false;
    this._commit(d);
    return true;
  }
}

// =========================================================== navigation tools
class OrbitTool extends Tool {
  static id = 'orbit';
  get hint() { return 'Orbit: drag to orbit the camera (middle-mouse drag works in any tool).'; }
  onDown(ev) { if (ev.button === 0) this._last = this.app.view.eventPt(ev); }
  onMove(ev) {
    if (!this._last) return;
    const q = this.app.view.eventPt(ev);
    this.app.view.orbit(q.x - this._last.x, q.y - this._last.y);
    this._last = q;
  }
  onUp(ev) { this._last = null; }
}
class PanTool extends Tool {
  static id = 'pan';
  get hint() { return 'Pan: drag to slide the view (Shift + middle-drag works in any tool).'; }
  onDown(ev) { if (ev.button === 0) this._last = this.app.view.eventPt(ev); }
  onMove(ev) {
    if (!this._last) return;
    const q = this.app.view.eventPt(ev);
    this.app.view.pan(q.x - this._last.x, q.y - this._last.y);
    this._last = q;
  }
  onUp(ev) { this._last = null; }
}
class ZoomTool extends Tool {
  static id = 'zoom';
  get hint() { return 'Zoom: drag up/down to zoom (mouse wheel works in any tool).'; }
  onDown(ev) { if (ev.button === 0) this._last = this.app.view.eventPt(ev); }
  onMove(ev) {
    if (!this._last) return;
    const q = this.app.view.eventPt(ev);
    this.app.view.zoomBy(Math.pow(1.01, this._last.y - q.y));
    this._last = q;
  }
  onUp(ev) { this._last = null; }
}

// =========================================================== resize wall
// Revit-style: click a wall face -> a dimension to the opposite wall appears.
// Drag it, or type an exact distance (or +delta / -delta). Everything on the
// wall's own side of the plane translates; connected walls stretch to follow.
class ResizeTool extends Tool {
  static id = 'resize';
  activate() {
    this.faceId = null; this.mode = null; this.axis = null; this.bodyDir = null;
    this.opp = null; this.moveSet = null; this.snapshot = null;
    this.startXY = null; this.dist = 0; this.anchor = null; this.tx = null;
  }
  deactivate() {
    if (this.tx) { this.tx.rollback(); this.tx = null; } // abandoned mid-drag
    this.cleanup();
  }
  get hint() {
    if (!this.faceId) return 'Resize Wall: click a wall face. The distance to the opposite wall is shown — drag, or type a new size (e.g. 4) or +1 / -1 + Enter.';
    const ref = this.opp
      ? `current distance to the opposite wall: ${fmtLen(this.opp.t + this.dist)}`
      : 'no opposite wall found — typed values are move deltas';
    return `Resize Wall: ${ref}. Esc cancels.`;
  }
  _face() { return this.app.model.faces.get(this.faceId); }
  _isWall(f) {
    const n = G.loopNormal(this.app.model.pts(f.loop));
    return !G.isZero(n) && Math.abs(n.z) < 0.7;
  }
  _setup(fid) {
    const app = this.app, model = app.model;
    const f = model.faces.get(fid);
    const n = G.loopNormal(model.pts(f.loop));
    this.faceId = fid;
    this.axis = G.norm(G.v(n.x, n.y, 0)); // wall plane's horizontal normal
    this.anchor = model.faceCentroid(f);
    const comp = model.componentVerts({ faces: new Set([fid]), edges: new Set() });

    // the wall's far skin: the nearest face parallel to this one, on either
    // side, whose footprint overlaps it. The NEARER skin is this wall's own
    // back side; the other side is the room (or open space). Cross-joined
    // geometry (a cylinder welding itself to the wall) is not parallel, so
    // it can never be mistaken for the skin.
    const { u, v } = G.basisForNormal(this.axis);
    const box = f2 => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const ring of model.rings(f2)) for (const vid of ring) {
        const p = model.vp(vid), qx = G.dot(u, p), qy = G.dot(v, p);
        x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy);
      }
      return [x0, y0, x1, y1];
    };
    const bSel = box(f);
    const skinAt = dir => {
      let s = Infinity;
      for (const [fid2, f2] of model.faces) {
        if (fid2 === fid) continue;
        const n2 = G.loopNormal(model.pts(f2.loop));
        if (G.isZero(n2) || Math.abs(G.dot(n2, this.axis)) < 0.999) continue;
        const t = G.dot(dir, G.sub(model.vp(f2.loop[0]), this.anchor));
        if (t <= 1e-3) continue;
        const b2 = box(f2);
        if (b2[0] > bSel[2] + 1e-9 || b2[2] < bSel[0] - 1e-9 || b2[1] > bSel[3] + 1e-9 || b2[3] < bSel[1] - 1e-9) continue;
        if (t < s) s = t;
      }
      return s;
    };
    const fwdSkin = skinAt(this.axis), backSkin = skinAt(G.neg(this.axis));
    if (isFinite(fwdSkin) || isFinite(backSkin)) {
      this.bodyDir = isFinite(fwdSkin) && (!isFinite(backSkin) || fwdSkin <= backSkin)
        ? this.axis : G.neg(this.axis);
      this.skin = Math.min(fwdSkin, backSkin);
    } else {
      // a skinless selection (a lone face): whichever side holds more of the
      // component's off-plane vertices is the body; the move stays on-plane
      this.skin = 0;
      let pos = 0, neg = 0;
      for (const vid of comp) {
        const t = G.dot(this.axis, G.sub(model.vp(vid), this.anchor));
        if (t > 1e-4) pos++; else if (t < -1e-4) neg++;
      }
      this.bodyDir = neg >= pos ? G.neg(this.axis) : this.axis;
    }
    this.intoDir = G.neg(this.bodyDir);
    // the dimension reference: the parallel face past the slab on the room
    // side whose footprint overlaps this face the most (the wall across the
    // room) — small crossing footprints (a stub, a cylinder facet) lose to
    // the full opposite wall
    let opp = null;
    for (const [fid2, f2] of model.faces) {
      if (fid2 === fid) continue;
      const n2 = G.loopNormal(model.pts(f2.loop));
      if (G.isZero(n2) || Math.abs(G.dot(n2, this.axis)) < 0.999) continue;
      const t = G.dot(this.intoDir, G.sub(model.vp(f2.loop[0]), this.anchor));
      if (t <= (this.skin || 0) + 1e-3) continue;
      const b2 = box(f2);
      const ox = Math.min(bSel[2], b2[2]) - Math.max(bSel[0], b2[0]);
      const oy = Math.min(bSel[3], b2[3]) - Math.max(bSel[1], b2[1]);
      if (ox <= 1e-9 || oy <= 1e-9) continue;
      const score = ox * oy;
      if (!opp || score > opp.score + 1e-9 || (Math.abs(score - opp.score) <= 1e-9 && t < opp.t))
        opp = { t, point: model.vp(f2.loop[0]), fid: fid2, inComp: comp.has(f2.loop[0]), score };
    }
    this.opp = opp;

    // ONLY the selected wall's slab moves — the band from this face's plane
    // out to the far skin (a skinless selection moves just the face's own
    // plane). Perpendicular walls stretch (their corner verts are in the
    // band, their far ends are not); crossing and distant geometry stays.
    const bound = this.skin > 0 ? this.skin + 1e-4 : 1e-3;
    this.moveSet = [];
    this.snapshot = new Map();
    for (const vid of comp) {
      const t = G.dot(this.bodyDir, G.sub(model.vp(vid), this.anchor));
      if (t >= -1e-4 && t <= bound) {
        this.moveSet.push(vid);
        this.snapshot.set(vid, G.clone(model.vp(vid)));
      }
    }
    this.dist = 0;
    this.tx = null;
  }
  _apply(dist) {
    const app = this.app, model = app.model;
    if (!this.tx) this.tx = app.begin('resize wall');
    this.dist = dist;
    for (const [vid, p] of this.snapshot)
      model.setVertex(vid, G.add(p, G.mul(this.bodyDir, dist)));
    app.view.rebuild();
  }
  _dragDist(ev) {
    const app = this.app;
    const s0 = app.view.toScreen(this.anchor);
    const s1 = app.view.toScreen(G.add(this.anchor, this.bodyDir));
    const dx = s1.x - s0.x, dy = s1.y - s0.y;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-6) return this.dist;
    const q = app.view.eventPt(ev);
    return ((q.x - this.startXY.x) * dx + (q.y - this.startXY.y) * dy) / L2;
  }
  _dimLine() {
    const app = this.app;
    const cur = G.add(this.anchor, G.mul(this.bodyDir, this.dist));
    if (!this.opp) return { a: cur, b: G.add(cur, G.mul(this.bodyDir, 1.5)) };
    return { a: cur, b: this.opp.point };
  }
  _drawDim(label) {
    const app = this.app, view = app.view;
    const { a, b } = this._dimLine();
    view.previewLine([a, b], 0x8a2be2, true);
    view.previewLine([G.add(a, G.mul(G.norm(G.sub(b, a)), 0.18)), G.add(a, G.mul(G.norm(G.sub(b, a)), -0.18))], 0x8a2be2);
    view.previewLine([G.add(b, G.mul(G.norm(G.sub(a, b)), 0.18)), G.add(b, G.mul(G.norm(G.sub(a, b)), -0.18))], 0x8a2be2);
    view.stickyLabel(G.mul(G.add(a, b), 0.5), label, '#6a1fb0', 0, 0);
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    view.clearPreview();
    if (this.faceId != null && this.mode !== 'pending') {
      this._apply(this._dragDist(ev)); // live in both drag and click-move-click
      const t = this.opp ? this.opp.t + this.dist : this.dist;
      this._drawDim(this.opp ? fmtLen(t) : fmtLen(Math.abs(this.dist)));
      return;
    }
    // idle: hover a wall + show its room dimension
    const fid = view.pickFaceAt(view.eventPt(ev));
    view.setHoverFace(fid);
    if (fid != null) {
      const f = app.model.faces.get(fid);
      if (this._isWall(f)) {
        const n = G.norm(G.v(G.loopNormal(app.model.pts(f.loop)).x, G.loopNormal(app.model.pts(f.loop)).y, 0));
        const c = app.model.faceCentroid(f);
        const comp = app.model.componentVerts({ faces: new Set([fid]), edges: new Set() });
        const fwd = app.model.findAcross(c, n, fid, comp);
        const back = app.model.findAcross(c, G.neg(n), fid, comp);
        const pick = (a, b) => (!a ? b : !b ? a : (a.inComp !== b.inComp ? (a.inComp ? a : b) : (a.t >= b.t ? a : b)));
        const opp = pick(fwd, back);
        if (opp) {
          view.previewLine([c, opp.point], 0x8a2be2, true);
          view.stickyLabel(G.mul(G.add(c, opp.point), 0.5), fmtLen(opp.t), '#6a1fb0', 0, 0);
        }
      }
    }
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    if (this.mode === 'click') return; // second click commits on up
    const fid = app.view.pickFaceAt(app.view.eventPt(ev));
    if (fid == null) { this.activate(); app.view.clearPreview(); return; }
    const f = app.model.faces.get(fid);
    if (!this._isWall(f)) { app.toast('Pick a wall (a vertical face). Use Scale for horizontal faces.'); return; }
    this._setup(fid);
    this.startXY = app.view.eventPt(ev);
    this.mode = 'pending';
    this.status();
  }
  onUp(ev) {
    if (this.mode === 'drag') this._commit();
    else if (this.mode === 'pending') { this.mode = 'click'; this.status(); }
    else if (this.mode === 'click') this._commit();
  }
  _commit() {
    const app = this.app;
    const moved = this.tx ? Math.abs(this.dist) : 0;
    if (this.tx) { this.tx.commit(); this.tx = null; }
    this.faceId = null; this.mode = null; this.dist = 0;
    this.moveSet = null; this.snapshot = null;
    app.view.clearPreview();
    if (moved > 1e-6) app.toast(`Wall moved ${fmtLen(moved)}`);
    this.status();
  }
  onKey(ev) {
    if (ev.key === 'Escape' && this.faceId != null) {
      if (this.tx) { this.tx.rollback(); this.tx = null; }
      this.faceId = null; this.mode = null; this.snapshot = null;
      this.app.view.clearPreview();
      this.status();
      return true;
    }
    return false;
  }
  onVCB(text) {
    if (this.faceId == null || this.mode == null || this.mode === 'pending') return false;
    const s = String(text).trim();
    const rel = /^([+-])\s*(.+)$/.exec(s);
    const val = parseLen(rel ? rel[2] : s);
    if (val == null) return false;
    let dist;
    if (rel) {
      // +x / -x: relative, positive = grow (away from the opposite wall)
      dist = this.dist + (rel[1] === '+' ? val : -val);
    } else if (this.opp) {
      // plain number: NEW distance to the opposite wall (Revit-style)
      dist = val - this.opp.t;
    } else {
      dist = val;
    }
    this._apply(dist);
    this._commit();
    return true;
  }
}

// Extrude a drawn line or arc into a surface ribbon: click the curve, then
// drag or type a distance. The default direction is straight up (+Z); a
// single-axis lock (V + X/Y/Z, or the arrow keys) extrudes along that axis
// instead, and a vertical curve extrudes along its horizontal perpendicular.
// Closed curves (circles) extrude into closed rings — curved walls in one
// gesture.
class ExtrudeCurveTool extends Tool {
  static id = 'extrude';
  activate() { this.pts = null; this.dir = null; this.dist = 0; this.status(); }
  cleanup() { super.cleanup(); this.activate(); }
  get hint() {
    if (!this.pts) return 'Extrude Curve: click a line or arc, then drag or type a distance. V + X/Y/Z sets the direction — default is straight up.';
    return `Extrude: drag or type the distance — ${fmtLen(Math.abs(this.dist))} along ${this._dirName()}. Esc cancels.`;
  }
  _dirName() {
    const d = this.dir;
    if (!d) return 'up';
    if (Math.abs(d.z) > 0.9) return d.z > 0 ? 'up' : 'down';
    if (Math.abs(d.x) > 0.9) return d.x > 0 ? '+X' : '-X';
    if (Math.abs(d.y) > 0.9) return d.y > 0 ? '+Y' : '-Y';
    return 'perpendicular';
  }
  // ordered points along the picked curve's chain (the whole arc/circle, or
  // the single picked straight edge)
  _chain(edge) {
    const m = this.app.model;
    const cid = edge.curveId || 0;
    const chain = cid ? [...m.edges.values()].filter(e => e.curveId === cid) : [edge];
    if (!chain.length) return null;
    const deg = new Map();
    for (const e of chain) for (const v of [e.a, e.b]) deg.set(v, (deg.get(v) || 0) + 1);
    const used = new Set();
    const walk = (v0, e0) => {
      // seed with the first edge traversed, then keep extending
      const path = [v0];
      used.add(e0.id);
      let cur = e0.a === v0 ? e0.b : e0.a;
      path.push(cur);
      while (true) {
        const nxt = chain.find(e => !used.has(e.id) && (e.a === cur || e.b === cur));
        if (!nxt) break;
        used.add(nxt.id);
        cur = nxt.a === cur ? nxt.b : nxt.a;
        path.push(cur);
      }
      return path;
    };
    const ends = [...deg.entries()].filter(([, n]) => n === 1).map(([v]) => v);
    let path;
    if (ends.length >= 2) {
      const e0 = chain.find(e => e.a === ends[0] || e.b === ends[0]);
      path = walk(ends[0], e0);
    } else {
      path = walk(edge.a, edge); // closed loop: returns to the start vertex
    }
    if (path.length < 2) return null;
    return path.map(v => G.clone(m.vp(v)));
  }
  // extrusion direction: the locked axis, else +Z, else the horizontal
  // perpendicular when the curve itself is vertical
  _direction() {
    const app = this.app;
    if (app.lockAxis) return G.clone(AXES[app.lockAxis]);
    const a = this.pts[0], b = this.pts[this.pts.length - 1];
    const chord = G.sub(b, a);
    const horiz = G.v(chord.x, chord.y, 0);
    if (G.len(horiz) < 1e-6) return G.v(0, 0, 1); // a point chain — degenerate, keep up
    const up = G.v(0, 0, 1);
    const perp = G.norm(G.cross(G.norm(horiz), up)); // horizontal perpendicular
    if (Math.abs(G.dot(G.norm(chord), up)) > 0.99) return perp; // vertical curve: extrude sideways
    return up;
  }
  // cursor-driven distance ALONG the direction axis: closest approach of the
  // cursor ray to the axis line through the chain's base (plain point
  // inference lands on the ground and cannot express vertical drags)
  _dragDist(ev) {
    const app = this.app, view = app.view;
    const sum = this.pts.reduce((s, p) => G.add(s, p), G.v(0, 0, 0));
    const base = G.mul(sum, 1 / this.pts.length);
    const d = this.dir;
    const { ro, rd } = view.rayFrom(view.eventPt(ev));
    const r = G.sub(ro, base);
    const b = G.dot(rd, d);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-6) { // ray parallel to the axis: use the inferred point
      const p = app.inferPoint(ev, null).p;
      return G.dot(G.sub(p, base), d);
    }
    return (G.dot(d, r) - b * G.dot(rd, r)) / denom;
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    view.clearPreview();
    if (!this.pts) {
      const pe = app.pickEdgeAt(ev, 8);
      view.setHoverEdges(pe ? [pe.edge.id] : null);
      return;
    }
    // live direction: the lock can change mid-drag
    this.dir = this._direction();
    this.dist = this._dragDist(ev);
    this._preview();
  }
  _preview() {
    const view = this.app.view;
    view.clearPreview();
    if (!this.pts) return;
    const tops = this.pts.map(p => G.add(p, G.mul(this.dir, this.dist)));
    view.previewQuadsBetween(this.pts, tops);
    view.previewLoop(this.pts, 0x2b2b2b);
    view.previewLoop(tops, 0x2b2b2b);
    const mid = this.pts[Math.floor(this.pts.length / 2)];
    view.stickyLabel(G.add(mid, G.mul(this.dir, this.dist)), `${fmtLen(Math.abs(this.dist))}${this.dist < 0 ? ' (reversed)' : ''}`, '#333', 0, 0);
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    if (!this.pts) {
      const pe = app.pickEdgeAt(ev, 8);
      if (!pe) { app.toast('Click a line or arc to extrude'); return; }
      const pts = this._chain(pe.edge);
      if (!pts) { app.toast('Could not follow that curve'); return; }
      this.pts = pts;
      this.dir = this._direction();
      this.dist = 0;
      app.view.setHoverEdges(null);
      this.status();
      return;
    }
    this._commit();
  }
  _commit() {
    const app = this.app;
    if (Math.abs(this.dist) < 1e-4) { app.toast('Drag or type a distance first'); return; }
    const pts = this.pts, dir = this.dir, d = this.dist;
    const tops = pts.map(p => G.add(p, G.mul(dir, d)));
    app.run('extrude curve', m => {
      for (let i = 0; i + 1 < pts.length; i++) {
        m.addFaceFromRings([pts[i], pts[i + 1], tops[i + 1], tops[i]]);
      }
    });
    app.view.clearPreview();
    app.toast(`Extruded ${fmtLen(Math.abs(d))} along ${this._dirName()}`);
    this.activate();
  }
  onKey(ev) {
    if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); this.status(); return true; }
    return false;
  }
  onVCB(text) {
    if (!this.pts) return false;
    const val = parseLen(text);
    if (val == null) return false;
    this.dist = Math.abs(this.dist) > 1e-9 && this.dist < 0 ? -val : val;
    this._preview();
    this._commit();
    return true;
  }
}

window.FreeTools = {
  SelectTool, LineTool, RectTool, CircleTool, ArcTool, PushPullTool, MoveTool,
  RotateTool, ScaleTool, OffsetTool, PaintTool, EraserTool, TrimTool, TapeMeasureTool,
  OrbitTool, PanTool, ZoomTool, ResizeTool, ExtrudeCurveTool,
};
