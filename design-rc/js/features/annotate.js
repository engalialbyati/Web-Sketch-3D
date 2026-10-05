'use strict';
// ---------------------------------------------------------------------------
// features/annotate.js — Phase 3: annotation & drawing production (core).
//
// Annotations are world-anchored DRAWING entities — dimensions, tags, text
// notes, spot elevations — stored on the model (model.annotations: serialized,
// undoable) and rendered on the HUD canvas (never building fabric: they do
// not intersect, pick as geometry, or export as solids).
//
//   DimensionTool  — click ref A, ref B (snaps: endpoints/grids), then the
//                    offset side; aligned dims whose endpoints TRACK vertex
//                    refs while those vertices live
//   TagTool        — hover an element, click to place a leadered tag reading
//                    its identity ({name} {number}…); VCB 'all' = Tag All
//                    Untagged
//   TextTool       — click to anchor a note (leader back to the snap point
//                    when the click landed on geometry)
//   SpotTool       — click for a spot elevation (+ absolute elevation when
//                    the georeference base point is set)
//
// Selection: the Select tool picks annotations first (screen-space
// proximity); Del deletes; the properties panel edits their text.
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;

  const fmt3 = n => (+n).toFixed(3).replace(/\.?0+$/, '') || '0';
  const coord = p => `${(+p.x).toFixed(2)}, ${(+p.y).toFixed(2)}`;

  const nextId = app => {
    let max = 0;
    for (const a of app.model.annotations || [])
      if (typeof a.id === 'string' && a.id.startsWith('ann_'))
        max = Math.max(max, parseInt(a.id.slice(4), 10) || 0);
    return 'ann_' + (max + 1);
  };

  // resolve a stored reference to a live point — dimensions track their
  // hosts: a wall-end or vertex ref re-reads the (possibly moved) position
  function resolveRef(app, ref, fallback) {
    if (!ref) return fallback;
    const m = app.model;
    try {
      if (ref.type === 'vertex') {
        const v = m.vp(ref.id);
        if (v) return [v.x, v.y, v.z];
      } else if (ref.type === 'wallEnd') {
        const w = app.bim.getEntityById(ref.wallId);
        const q = w && w.params && w.params[ref.end === 1 ? 'end' : 'base'];
        if (q) return [q[0], q[1], q[2]];
      }
    } catch (e) { }
    return fallback;
  }

  // ----------------------------------------------------------- dimensions
  class DimensionTool extends Tool {
    static id = 'dim';
    activate() { this.p1 = null; this.p2 = null; this.r1 = null; this.r2 = null; this.plane = null; this.status(); }
    cleanup() { super.cleanup(); this.activate(); }
    get hint() {
      if (!this.p1) return 'Dimension: click the first reference point (snaps to endpoints, grid intersections…).';
      if (!this.p2) return 'Dimension: click the second reference point.';
      return 'Dimension: move to the offset side and click to place. Esc restarts.';
    }
    _pt(ev) {
      const app = this.app;
      const anchor = this.p1 || null;
      const inf = app.inferPoint(ev, anchor);
      // keep the whole dimension on one level plane
      const z = app.levelManager.getElevation(app.bimOptions.baseLevel);
      let p = G.v(inf.p.x, inf.p.y, inf.p.z);
      if (this.p1 && Math.abs(inf.p.z - this.p1[2]) > 0.2) p = G.v(inf.p.x, inf.p.y, this.p1[2]);
      else if (Math.abs(inf.p.z - z) < 2) p = G.v(inf.p.x, inf.p.y, z);
      // reference tracking: endpoint snaps carry their vertex id
      let ref = null;
      if (inf.kind === 'endpoint' && inf.vid != null) ref = { type: 'vertex', id: inf.vid };
      return { p, ref, inf };
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      const { p, inf } = this._pt(ev);
      if (!this.p1) { showCursorCoords(view, view.toScreen(p), inf, p); return; }
      if (!this.p2) {
        view.previewLine([G.v(...this.p1), p], 0x2b2b2b, true);
        view.stickyLabel(G.mul(G.add(G.v(...this.p1), p), 0.5), fmtLen(G.dist(G.v(...this.p1), p)), '#333');
        showCursorCoords(view, view.toScreen(p), inf, p);
        return;
      }
      // offset preview: full dimension ghost
      const off = this._offsetFor(p);
      const A = G.add(G.v(...this.p1), off), B = G.add(G.v(...this.p2), off);
      view.previewLine([G.v(...this.p1), A], 0x9a9a9a, true);
      view.previewLine([G.v(...this.p2), B], 0x9a9a9a, true);
      view.previewLine([A, B], 0x2b2b2b);
      view.stickyLabel(G.mul(G.add(A, B), 0.5), fmtLen(G.dist(G.v(...this.p1), G.v(...this.p2))), '#333', 0, -10);
    }
    _offsetFor(cursor) {
      // perpendicular of p1→p2 in XY, on the cursor's side, 0.6 m out
      const a = G.v(...this.p1), b = G.v(...this.p2);
      const d = G.sub(b, a);
      const horiz = G.v(d.x, d.y, 0);
      const L = G.len(horiz);
      if (L < 1e-6) return G.v(0.6, 0, 0); // vertical run: offset in +X
      const n = G.v(-horiz.y / L, horiz.x / L, 0);
      const side = Math.sign(G.dot(G.sub(cursor, a), n)) || 1;
      const dist = Math.min(0.35 + 0.25 * Math.abs(G.dot(G.sub(cursor, a), n)), 3);
      return G.mul(n, side * Math.max(0.5, dist));
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const { p, ref } = this._pt(ev);
      if (!this.p1) { this.p1 = [p.x, p.y, p.z]; this.r1 = ref; this.status(); return; }
      if (!this.p2) {
        if (G.dist(G.v(...this.p1), p) < 1e-3) return;
        this.p2 = [p.x, p.y, p.z]; this.r2 = ref; this.status(); return;
      }
      // third click: commit with the offset
      const off = this._offsetFor(p);
      const app = this.app;
      const L = G.dist(G.v(...this.p1), G.v(...this.p2));
      app.run('dimension', m => {
        m.annotations.push({
          id: nextId(app), kind: 'dim',
          p1: [...this.p1], p2: [...this.p2],
          off: [off.x, off.y, off.z],
          r1: this.r1, r2: this.r2,
          levelId: app.bimOptions.baseLevel,
          text: null,
        });
        m.touch();
      });
      app.toast(`Dimension placed — ${fmtLen(L)}`);
      this.activate();
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB() { return false; }
  }

  // --------------------------------------------------------------- tags
  const TEMPLATES = {
    room: '{name} · {area} m²',
    door: 'D{number}', window: 'W{number}',
    wall: '{name}', column: 'C{name}', beam: 'B{name}',
    slab: '{name}', floor: '{name}', roof: '{name}',
    foundation: '{name}', stairs: '{name}', handrail: '{name}',
  };
  function tagText(app, a) {
    const ent = a.targetId && app.bim.getEntityById(a.targetId);
    if (!ent) return a.text || '?';
    const p = ent.params || {};
    const tpl = a.template || TEMPLATES[ent.type] || '{name}';
    return tpl.replace(/\{(\w+)\}/g, (_, k) =>
      k === 'name' ? (ent.name || p.name || ent.id)
        : k === 'number' ? (p.number || '')
          : p[k] != null ? p[k] : '');
  }
  window.AnnotateTagText = tagText; // render.js resolves live text

  class TagTool extends Tool {
    static id = 'tag';
    activate() { this.status(); }
    get hint() {
      return 'Tag: hover an element and click to place its leadered tag (identity text follows the element). Type "all" + Enter = Tag All Untagged. Esc cancels.';
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      const pe = app.pickEntity(ev);
      if (!pe || !pe.entity) return;
      const ent = app.bim.getEntityById(pe.entity);
      if (!ent) return;
      const inf = app.inferPoint(ev, null);
      const p = inf.p;
      view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
      const txt = tagText(app, { targetId: ent.id, template: TEMPLATES[ent.type] });
      view.stickyLabel(p, txt, '#1d4f9c', 14, -22);
      view.previewLine([p, G.add(p, G.v(0.5, 0.3, 0))], 0x1d4f9c, true);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const pe = app.pickEntity(ev);
      const ent = pe && pe.entity && app.bim.getEntityById(pe.entity);
      if (!ent) { app.toast('Hover an element to tag it'); return; }
      const p = app.inferPoint(ev, null).p;
      const box = G.add(p, G.v(0.5, 0.3, 0));
      app.run('tag', m => {
        m.annotations.push({
          id: nextId(app), kind: 'tag',
          targetId: ent.id, at: [p.x, p.y, p.z], box: [box.x, box.y, box.z],
          template: TEMPLATES[ent.type] || '{name}',
        });
        m.touch();
      });
      app.toast(`Tagged ${ent.type} — "${tagText(app, { targetId: ent.id, template: TEMPLATES[ent.type] })}"`);
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB(text) {
      if (String(text).trim().toLowerCase() !== 'all') return false;
      window.Annotate.tagAll(this.app);
      return true;
    }
  }

  // ----------------------------------------------------------- text notes
  class TextTool extends Tool {
    static id = 'text';
    activate() { this.status(); }
    get hint() { return 'Text Note: click to anchor the note — clicking on geometry (endpoint/face snap) adds a leader back to that point.'; }
    onMove(ev) {
      const app = this.app;
      app.view.clearPreview();
      const inf = app.inferPoint(ev, null);
      const s = app.view.toScreen(inf.p);
      if (s) showCursorCoords(app.view, s, inf, inf.p);
      app.view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const inf = app.inferPoint(ev, null);
      const p = inf.p;
      const snapped = ['endpoint', 'midpoint', 'center', 'edge', 'face', 'gridX', 'gridline'].includes(inf.kind);
      app.dialog('Text Note', `
        <div class="ob-lab">Text</div>
        <textarea id="tx-note" rows="3" style="width:100%;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit;font:inherit" placeholder="Type the note…"></textarea>
        ${snapped ? '<p class="dim" style="margin:0">A leader will point back to the snapped location.</p>' : ''}`,
        [['Cancel', null], ['Place', () => {
          const el = document.getElementById('tx-note');
          const txt = el ? el.value.trim() : '';
          if (!txt) { app.toast('Empty note — nothing placed', true); return false; }
          const box = G.add(p, G.v(0.4, 0.4, 0));
          app.run('text note', m => {
            m.annotations.push({
              id: nextId(app), kind: 'text',
              at: [box.x, box.y, box.z], text: txt,
              leaderFrom: snapped ? [p.x, p.y, p.z] : null,
            });
            m.touch();
          });
          app.toast('Note placed');
        }]]);
      setTimeout(() => { const el = document.getElementById('tx-note'); if (el) { el.focus(); } }, 50);
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB() { return false; }
  }

  // ------------------------------------------------------ spot elevations
  class SpotTool extends Tool {
    static id = 'spot';
    activate() { this.status(); }
    get hint() {
      const geo = this.app.model.geo;
      return geo && geo.basePoint ? 'Spot Elevation: click a point — shows the level AND the absolute (georeferenced) elevation.'
        : 'Spot Elevation: click a point to read its elevation.';
    }
    onMove(ev) {
      const app = this.app;
      app.view.clearPreview();
      const inf = app.inferPoint(ev, null);
      const s = app.view.toScreen(inf.p);
      if (s) showCursorCoords(app.view, s, inf, inf.p);
      app.view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const p = app.inferPoint(ev, null).p;
      app.run('spot elevation', m => {
        m.annotations.push({ id: nextId(app), kind: 'spot', at: [p.x, p.y, p.z] });
        m.touch();
      });
      const geo = app.model.geo;
      const abs = geo && geo.basePoint ? ` (abs ${(geo.basePoint.elev + p.z).toFixed(3)})` : '';
      app.toast(`Spot: ${coord(p)} · elev ${fmt3(p.z)}${abs}`);
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB() { return false; }
  }

  // ------------------------------------------------------------- helpers
  const Annotate = {
    DimensionTool, TagTool, TextTool, SpotTool, TEMPLATES, tagText, resolveRef, nextId,
    /** Tag every untagged entity at its first face centroid (Tag All). */
    tagAll(app) {
      const tagged = new Set((app.model.annotations || [])
        .filter(a => a.kind === 'tag').map(a => a.targetId));
      let n = 0;
      app.run('tag all', m => {
        for (const ent of app.bim.entities) {
          if (tagged.has(ent.id) || !ent.faces || !ent.faces.length) continue;
          if (!TEMPLATES[ent.type]) continue;
          const f = m.faces.get(ent.faces[0]);
          if (!f) continue;
          const c = m.faceCentroid(f);
          const box = G.add(c, G.v(0.5, 0.3, 0));
          m.annotations.push({
            id: nextId(app), kind: 'tag', targetId: ent.id,
            at: [c.x, c.y, c.z], box: [box.x, box.y, box.z],
            template: TEMPLATES[ent.type],
          });
          n++;
        }
        if (n) m.touch();
      });
      app.toast(n ? `Taged ${n} element${n === 1 ? '' : 's'}` : 'Everything is already tagged');
      return n;
    },
    /** Find & Replace across text notes. Returns the replacement count. */
    findReplace(app, find, repl) {
      if (!find) return 0;
      let n = 0;
      app.run('find & replace notes', m => {
        for (const a of m.annotations || []) {
          if (a.kind !== 'text' || !a.text || !a.text.includes(find)) continue;
          a.text = a.text.split(find).join(repl);
          n++;
        }
        if (n) m.touch();
      });
      return n;
    },
  };
  window.Annotate = Annotate;
})();
