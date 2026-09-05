'use strict';
// ---------------------------------------------------------------------------
// GridManager — the facade over model.grids (the synchronous GridSystem).
//
// Mirrors LevelManager's contract: state lives on the model so it survives
// undo, autosave and file round-trips; every mutation funnels through here;
// the app is notified via onGridsChanged() which resnaps the viewport, the
// snap engine's intersection cache and the (async) db mirror.
//
// Parametric attachment: elements drawn on grids record references —
//   walls:  params.hostGridId (baseline projected on one grid line)
//   columns: params.gridRef { a, b } (centered on an A-1 intersection)
// updateGrid() re-projects those elements through the BIM parametric rebuilds
// (rebuildWallWithHosts / column re-place), so moving a grid moves the frame.
// ---------------------------------------------------------------------------
class GridManager {
  constructor(model) {
    this.model = model;
    this._ix = null; // cached pairwise intersections
  }
  get grids() { return this.model.grids || (this.model.grids = []); }
  getGrid(id) { return this.grids.find(g => g.id === id) || null; }

  // distinct system names in use (sorted; 'Main' first when present)
  systems() {
    const s = new Set(this.grids.map(g => g.system || 'Main'));
    return [...s].sort((a, b) => (a === 'Main' ? -1 : b === 'Main' ? 1 : a.localeCompare(b)));
  }
  gridsInSystem(name) { return this.grids.filter(g => (g.system || 'Main') === name); }

  // records -> GridLine instances after model.load (file open, undo, redo).
  // Invalid records are dropped, never kept — schema gate on entry.
  _hydrate() {
    if (this.grids.every(g => g instanceof GridLine)) return;
    for (let i = 0; i < this.grids.length; i++) {
      if (this.grids[i] instanceof GridLine) continue;
      const g = GridLine.fromRecord(this.grids[i]);
      if (g) this.grids[i] = g; else this.grids.splice(i--, 1);
    }
  }

  _changed(syncAttachedId = null) {
    this._ix = null;
    this._hydrate();
    const app = window.app;
    if (app && app.onGridsChanged) app.onGridsChanged();
  }

  // ---- CRUD ---------------------------------------------------------------
  addGrid(def) {
    const g = def instanceof GridLine ? def : new GridLine(def);
    this.grids.push(g);
    this._changed();
    return g;
  }

  // patch: { name?, start?, end?, mid?, isCurved?, bubbleEnd?, verticalExtent? }.
  // Attached elements re-project onto the new geometry (walls shift their
  // baseline, columns re-center on the recomputed intersection).
  updateGrid(id, patch) {
    const g = this.getGrid(id);
    if (!g) return null;
    if (patch.name != null && String(patch.name).trim()) g.name = String(patch.name).trim();
    if (patch.system != null && String(patch.system).trim()) g.system = String(patch.system).trim();
    const pt = v => (Array.isArray(v) && v.length >= 2 && isFinite(v[0]) && isFinite(v[1]))
      ? [v[0], v[1]] : null;
    const start = pt(patch.start), end = pt(patch.end), mid = pt(patch.mid);
    if (start) g.start = start;
    if (end) g.end = end;
    if (patch.isCurved != null) {
      g.isCurved = !!patch.isCurved;
      if (g.isCurved && mid) g.mid = mid;
      if (!g.isCurved) g.mid = null;
    } else if (mid) { g.mid = mid; g.isCurved = true; }
    if (patch.bubbleEnd && ['start', 'end', 'both', 'none'].includes(patch.bubbleEnd))
      g.bubbleEnd = patch.bubbleEnd;
    if (patch.verticalExtent) {
      const v = patch.verticalExtent;
      const mn = isFinite(v.min) ? v.min : g.verticalExtent.min;
      const mx = isFinite(v.max) ? v.max : g.verticalExtent.max;
      g.verticalExtent = { min: Math.min(mn, mx), max: Math.max(mn, mx) };
    }
    this.syncAttached(id);
    this._changed();
    return g;
  }

  // how many elements reference this grid (delete guard + dialog display)
  usage(id) {
    let walls = 0, columns = 0;
    for (const ent of this.model.bimEntities || []) {
      const p = ent.params || {};
      if (ent.type === 'wall' && p.hostGridId === id) walls++;
      if (ent.type === 'column' && p.gridRef && (p.gridRef.a === id || p.gridRef.b === id)) columns++;
    }
    return { walls, columns, total: walls + columns };
  }

  removeGrid(id) {
    const g = this.getGrid(id);
    if (!g) return 'Grid not found';
    const u = this.usage(id);
    if (u.total) {
      const kind = u.walls && u.columns ? 'walls / columns' : (u.walls ? `wall${u.walls === 1 ? '' : 's'}` : `column${u.columns === 1 ? '' : 's'}`);
      return `${u.total} ${kind} attached to grid ${g.name} — detach ${u.total === 1 ? 'it' : 'them'} first`;
    }
    this.grids.splice(this.grids.indexOf(g), 1);
    this._changed();
    return null;
  }

  // ---- intersections (cached; recomputed on any mutation) -----------------
  intersections() {
    if (this._ix) return this._ix;
    this._hydrate();
    const out = [];
    const gs = this.grids;
    for (let i = 0; i < gs.length; i++)
      for (let j = i + 1; j < gs.length; j++) {
        // grids of DIFFERENT systems never interact (two named systems may
        // overlap in plan without creating phantom A-1 intersections)
        if ((gs[i].system || 'Main') !== (gs[j].system || 'Main')) continue;
        const p = GridLine.intersect(gs[i], gs[j]);
        if (p) out.push({ p, a: gs[i], b: gs[j] });
      }
    this._ix = out;
    return out;
  }

  // The intersection of two named grids ("A" x "1") — the ETABS column locator.
  intersectionOf(idA, idB) {
    const a = this.getGrid(idA), b = this.getGrid(idB);
    if (!a || !b) return null;
    return GridLine.intersect(a, b);
  }

  // ---- ETABS-style quick setup -------------------------------------------
  // generateOrthogonal({ xSpacings:[6,6,4.5], xLabel:'1', ySpacings:[5,5,7],
  //   yLabel:'A', origin:[x,y], extent:{min,max} }) — one call builds the full
  // orthogonal system: vertical lines at cumulative X offsets (labels 1,2,3…),
  // horizontal lines at cumulative Y offsets (labels A,B,C…).
  generateOrthogonal(opts) {
    const o = opts || {};
    const system = (o.system != null && String(o.system).trim()) ? String(o.system).trim() : 'Main';
    const nums = s => String(s).split(/[,;\s]+/).filter(Boolean).map(parseFloat).filter(v => isFinite(v) && v > 0);
    const xs = nums(o.xSpacings), ys = nums(o.ySpacings);
    if (!xs.length && !ys.length) return { grids: [], error: 'Enter at least one spacing (e.g. "6, 6, 4.5")' };
    const ox = o.origin ? o.origin[0] : 0, oy = o.origin ? o.origin[1] : 0;
    const extent = Object.assign({ min: 0, max: 100 }, o.extent || {});
    const L = o.length || this._defaultLength(ox, oy, xs, ys);
    const made = [];
    const line = (name, sx, sy, ex, ey) => made.push(new GridLine({
      name, system, start: [sx, sy], end: [ex, ey], bubbleEnd: 'both', verticalExtent: { ...extent },
    }));
    // vertical grids (X stations, labels 1,2,3…) — span the Y extent + margin
    let x = ox, xl = o.xLabel || '1';
    const yLo = oy - 2, yHi = oy + ys.reduce((a, b) => a + b, 0) + 2;
    for (let i = 0; i <= xs.length; i++) {
      line(String(xl), x, yLo, x, yHi);
      xl = GridLine.nextLabel(xl);
      if (i < xs.length) x += xs[i];
    }
    // horizontal grids (Y stations, labels A,B,C…)
    let y = oy, yl = o.yLabel || 'A';
    const xLo = ox - 2, xHi = ox + xs.reduce((a, b) => a + b, 0) + 2;
    for (let i = 0; i <= ys.length; i++) {
      line(String(yl), xLo, y, xHi, y);
      yl = GridLine.nextLabel(yl);
      if (i < ys.length) y += ys[i];
    }
    for (const g of made) this.grids.push(g);
    this._changed();
    return { grids: made, error: null };
  }

  _defaultLength(ox, oy, xs, ys) {
    const w = xs.reduce((a, b) => a + b, 0), h = ys.reduce((a, b) => a + b, 0);
    return Math.max(12, w + 4, h + 4);
  }

  // ---- parametric reattachment -------------------------------------------
  // Called by updateGrid after geometry changed: attached walls re-project
  // their baseline onto the new line; attached columns re-center on the
  // recomputed grid intersection. Runs inside the caller's transaction.
  syncAttached(id) {
    const app = window.app;
    if (!app || !app.bim) return;
    for (const ent of app.bim.entities) {
      const p = ent.params || {};
      if (ent.type === 'wall' && p.hostGridId === id && !p.closed && p.base && p.end) {
        const g = this.getGrid(id);
        if (!g) continue;
        const b = g.closestPoint([p.base[0], p.base[1]]);
        const e = g.closestPoint([p.end[0], p.end[1]]);
        if (!b || !e) continue;
        // keep the wall's length: project endpoints, then re-space along the
        // polyline so a rotated grid rotates the wall with it
        p.base = [b.p[0], b.p[1], p.base[2]];
        p.end = [e.p[0], e.p[1], p.end[2]];
        if (p.footprint) delete p.footprint; // regenerate, don't reuse stale ring
        app.bim.rebuildWallWithHosts(ent.id);
      }
      if (ent.type === 'column' && p.gridRef && (p.gridRef.a === id || p.gridRef.b === id)) {
        const ix = this.intersectionOf(p.gridRef.a, p.gridRef.b);
        if (!ix || !p.base) continue; // grids no longer cross — leave in place
        this._replaceColumn(ent, ix);
      }
    }
  }

  // delete + re-place a column at a new planar position, keeping its stamps
  _replaceColumn(ent, planPt) {
    const app = window.app, m = app.model;
    const p = ent.params;
    const z = p.base[2];
    p.base = [planPt[0], planPt[1], z];
    m.bimHold = true;
    for (const fid of [...ent.faces]) m.faces.delete(fid);
    for (const eid of [...ent.edges]) m.edges.delete(eid);
    m.gc();
    const placed = window.ColumnFeature
      ? window.ColumnFeature.placeColumn(G, m, { x: planPt[0], y: planPt[1], z }, p.width, p.depth, p.height)
      : null;
    if (!placed) { m.bimHold = false; return; }
    ent.faces = placed.map(f => f.id);
    ent.edges = [];
    for (const fid of ent.faces) {
      const f = m.faces.get(fid);
      const c = m.faceCentroid(f);
      const role = Math.abs(c.z - z) < 1e-6 ? 'bottom' : Math.abs(c.z - (z + p.height)) < 1e-6 ? 'top' : 'side';
      f.userData = { bimEntityId: ent.id, bimType: 'column', role };
      for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
        const e = m.findEdge(r[i], r[(i + 1) % r.length]);
        if (e) ent.edges.push(e.id);
      }
    }
    ent.edges = [...new Set(ent.edges)];
    m.bimHold = false;
  }
}

if (typeof module !== 'undefined') module.exports = { GridManager };
