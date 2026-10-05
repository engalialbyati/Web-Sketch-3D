'use strict';
// ---------------------------------------------------------------------------
// features/struct2.js — Phase 5: structure completion.
//
//   AnalyticalModel — 1D centerlines derived from columns/beams/walls
//                      (model.analytical records), a viewport toggle drawing
//                      them, and a CSV export for analysis pipelines (5.1+5.2)
//   StripFootingTool — click a wall: a continuous footing sweeps its baseline
//   BraceTool        — two snapped 3D points → a diagonal beam (axial member)
//   TrussDialog      — span/height/bays generator: chords + web braces as
//                      real beam entities (5.4)
//   PlateTool        — click a column base: a base plate box under it (5.5)
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;

  // ---------------------------------------------------- analytical model
  const Analytical = {
    /** Derive 1D members from the parametric registry (pure — no geometry). */
    derive(app) {
      const out = [];
      for (const ent of app.bim.entities) {
        const p = ent.params || {};
        if (ent.type === 'column' && p.base) {
          out.push({
            kind: 'column', id: ent.id, a: [...p.base],
            b: [p.base[0], p.base[1], p.base[2] + (+p.height || 3)],
            section: `${(+p.width || 0.3).toFixed(2)}x${(+p.depth || 0.3).toFixed(2)}`,
          });
        } else if (ent.type === 'beam' && p.baseline) {
          const bl = p.baseline;
          for (let i = 0; i + 1 < bl.length; i++)
            out.push({
              kind: 'beam', id: ent.id, a: [...bl[i]], b: [...bl[i + 1]],
              section: `${(+p.webWidth || 0.2).toFixed(2)}x${(+p.height || 0.4).toFixed(2)}`,
            });
        } else if (ent.type === 'brace' && p.baseline) {
          out.push({
            kind: 'brace', id: ent.id, a: [...p.baseline[0]], b: [...p.baseline[1]],
            section: `${(+p.webWidth || 0.1).toFixed(2)}x${(+p.height || 0.1).toFixed(2)}`,
          });
        } else if (ent.type === 'wall' && p.base && p.end && !p.closed) {
          out.push({
            kind: 'wall', id: ent.id, a: [...p.base], b: [...p.end],
            section: `t=${(+p.thickness || 0.2).toFixed(2)}`,
          });
        }
      }
      return out;
    },
    /** CSV: node list + member list (Node,Elem sets — analysis-neutral). */
    toCSV(members) {
      const nodes = [];
      const nodeKey = new Map();
      const nodeId = p => {
        const k = p.map(q => (+q).toFixed(3)).join(',');
        if (nodeKey.has(k)) return nodeKey.get(k);
        const id = nodes.length + 1;
        nodes.push(`N${id},${k}`);
        nodeKey.set(k, id);
        return id;
      };
      const lines = ['NODES', 'ID,X,Y,Z'];
      const elems = ['MEMBERS', 'ID,Kind,NodeA,NodeB,Section,SourceId'];
      members.forEach((m2, i) => {
        const na = nodeId(m2.a), nb = nodeId(m2.b);
        elems.push(`E${i + 1},${m2.kind},N${na},N${nb},${m2.section},${m2.id}`);
      });
      return lines.concat(nodes, elems).join('\r\n');
    },
  };

  // ------------------------------------------------------- strip footing
  class StripFootingTool extends Tool {
    static id = 'stripfoot';
    activate() { this.status(); }
    get hint() { return 'Strip Footing: click a wall — a continuous footing sweeps its baseline (VCB "width x thickness").'; }
    _w() { return +(this._wV || 0.8); }
    _t() { return +(this._tV || 0.35); }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      const inf = app.inferPoint(ev, null);
      const s = view.toScreen(inf.p);
      if (s) showCursorCoords(view, s, inf, inf.p);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const pe = app.pickEntity(ev);
      const ent = pe && pe.entity && app.bim.getEntityById(pe.entity);
      if (!ent || ent.type !== 'wall' || !ent.params.base || !ent.params.end || ent.params.closed) {
        app.toast('Click a straight wall to host the strip footing');
        return;
      }
      const w = this._w(), t = this._t();
      let made = null;
      app.transaction.run('strip footing', m => {
        m.bimHold = true; m.plainSweeps = true; m.noAutoIntersect = true;
        try {
          const A = G.v(...ent.params.base), B = G.v(...ent.params.end);
          const before = new Set(m.faces.keys());
          const f = m.addFaceFromRings([
            G.v(A.x - w / 2, A.y - w / 2, A.z), G.v(B.x + w / 2, A.y - w / 2, A.z),
            G.v(B.x + w / 2, B.y + w / 2, A.z), G.v(A.x - w / 2, B.y + w / 2 > B.y ? A.y + w / 2 : B.y + w / 2, A.z)]);
          // axis-aligned strip around the baseline (straight runs v1)
          const dir = G.norm(G.sub(B, A));
          const n = G.v(-dir.y, dir.x, 0);
          const ring = [
            G.add(A, G.mul(n, -w / 2)), G.add(B, G.mul(n, -w / 2)),
            G.add(B, G.mul(n, w / 2)), G.add(A, G.mul(n, w / 2))];
          if (f) m.deleteFace(f.id);
          const f2 = m.addFaceFromRings(ring);
          if (!f2) throw new Error('strip ring degenerate');
          if (!m.pushPull(f2, -t)) throw new Error('strip sweep failed');
          const nf = [...m.faces.keys()].filter(id => !before.has(id));
          const edges = [];
          for (const fid of nf) {
            const ff = m.faces.get(fid);
            if (ff) for (const r of m.rings(ff)) for (let i = 0; i < r.length; i++) {
              const e = m.findEdge(r[i], r[(i + 1) % r.length]);
              if (e) edges.push(e.id);
            }
          }
          const roles = {};
          for (const fid of nf) roles[fid] = 'body';
          made = app.bim.create('foundation', {
            kind: 'strip', hostWallId: ent.id,
            base: [...ent.params.base], end: [...ent.params.end],
            width: w, thickness: t,
            baseLevel: ent.params.baseLevel || app.bimOptions.baseLevel,
          }, roles, edges);
        } finally { m.bimHold = false; }
      });
      app.toast(made ? `Strip footing ${fmtLen(w)} × ${fmtLen(t)}` : 'Strip footing failed');
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB(t2) {
      const m2 = String(t2).match(/^([\d.]+)(?:\s*[x,]\s*([\d.]+))?$/);
      if (!m2) return false;
      this._wV = parseFloat(m2[1]);
      if (m2[2]) this._tV = parseFloat(m2[2]);
      this.app.toast(`Strip ${fmtLen(this._wV)} wide${m2[2] ? ` × ${fmtLen(this._tV)}` : ''}`);
      return true;
    }
  }

  // ------------------------------------------------------------- brace
  class BraceTool extends Tool {
    static id = 'brace';
    activate() { this.A = null; this.status(); }
    cleanup() { super.cleanup(); this.activate(); }
    get hint() {
      return this.A ? 'Brace: click the second point (snap to nodes/beam lines) — VCB sizes the section.'
        : 'Brace: click the first point (a column top, a beam node…).';
    }
    _pt(ev) {
      const app = this.app;
      const inf = app.inferPoint(ev, this.A || null);
      return { p: inf.p, inf };
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      const { p, inf } = this._pt(ev);
      if (this.A) view.previewLine([G.v(...this.A), p], 0xc98a3d);
      const s = view.toScreen(p);
      if (s) showCursorCoords(view, s, inf, p);
      view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const { p } = this._pt(ev);
      if (!this.A) { this.A = [p.x, p.y, p.z]; this.status(); return; }
      const A = this.A, B = [p.x, p.y, p.z];
      if (G.dist(G.v(...A), G.v(...B)) < 0.2) return;
      const S = app.structural;
      const size = { webWidth: +(this._s || 0.1), height: +(this._s || 0.1), profile: 'rectangular' };
      let made = null;
      app.transaction.run('brace', m => {
        m.bimHold = true; m.plainSweeps = true; m.noAutoIntersect = true;
        try {
          const before = new Set(m.faces.keys());
          S.buildBeam(G, m, { baseline: [A, B], ...size, zJustification: 'Center' });
          const nf = [...m.faces.keys()].filter(id => !before.has(id));
          const edges = [];
          for (const fid of nf) {
            const ff = m.faces.get(fid);
            if (ff) for (const r of m.rings(ff)) for (let i = 0; i < r.length; i++) {
              const e = m.findEdge(r[i], r[(i + 1) % r.length]);
              if (e) edges.push(e.id);
            }
          }
          const roles = {};
          for (const fid of nf) roles[fid] = 'body';
          made = app.bim.create('brace', {
            baseline: [A.map(q => +q.toFixed(4)), B.map(q => +q.toFixed(4))],
            ...size, source: 'brace',
          }, roles, edges);
        } finally { m.bimHold = false; }
      });
      app.toast(made ? 'Brace placed' : 'Brace failed');
      this.activate();
      app.view.clearPreview();
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB(t) {
      const s = parseFloat(t);
      if (!(s > 0.02)) return false;
      this._s = s;
      this.app.toast(`Brace section ${fmtLen(s)}`);
      return true;
    }
  }

  // --------------------------------------------------------- truss dialog
  function trussDialog(app) {
    app.dialog('Truss Generator', `
      <div class="ob-lab">Geometry (m)</div>
      <div style="display:flex;gap:10px;margin:4px 0 10px">
        <label>Span <input type="number" id="tr-span" step="0.5" value="8" style="width:70px"></label>
        <label>Height <input type="number" id="tr-h" step="0.25" value="1.2" style="width:70px"></label>
        <label>Bays <input type="number" id="tr-bays" step="1" min="2" value="4" style="width:60px"></label>
      </div>
      <div class="ob-lab">Placement</div>
      <div style="display:flex;gap:10px;margin:4px 0 10px">
        <label>X <input type="number" id="tr-x" step="0.5" value="0" style="width:70px"></label>
        <label>Y <input type="number" id="tr-y" step="0.5" value="0" style="width:70px"></label>
        <label>Z (base) <input type="number" id="tr-z" step="0.1" value="3" style="width:70px"></label>
      </div>
      <p class="dim" style="margin:0">Generates top + bottom chords and zig-zag web braces as beam entities along +X.</p>`,
      [['Cancel', null], ['Generate', () => {
        const v = id => parseFloat(document.getElementById(id).value) || 0;
        const span = v('tr-span'), h = v('tr-h'), bays = Math.max(2, Math.round(v('tr-bays')));
        const x = v('tr-x'), y = v('tr-y'), z = v('tr-z');
        if (!(span > 1) || !(h > 0.3)) { app.toast('Span and height must be positive', true); return false; }
        Struct2.buildTruss(app, { span, height: h, bays, x, y, z });
      }]]);
  }

  // ---------------------------------------------------------- base plate
  class PlateTool extends Tool {
    static id = 'plate';
    activate() { this.status(); }
    get hint() { return 'Base Plate: click a column — a plate grows under its base (VCB "size x thickness").'; }
    _s() { return +(this._sV || 0.5); }
    _t() { return +(this._tV || 0.03); }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const pe = app.pickEntity(ev);
      const ent = pe && pe.entity && app.bim.getEntityById(pe.entity);
      if (!ent || ent.type !== 'column' || !ent.params.base) {
        app.toast('Click a column to receive the base plate');
        return;
      }
      const s = this._s(), t = this._t();
      const b = ent.params.base;
      let made = null;
      app.transaction.run('base plate', m => {
        m.bimHold = true; m.plainSweeps = true; m.noAutoIntersect = true;
        try {
          const before = new Set(m.faces.keys());
          const z = b[2];
          const f = m.addFaceFromRings([
            G.v(b[0] - s / 2, b[1] - s / 2, z), G.v(b[0] + s / 2, b[1] - s / 2, z),
            G.v(b[0] + s / 2, b[1] + s / 2, z), G.v(b[0] - s / 2, b[1] + s / 2, z)]);
          if (!f) throw new Error('plate ring degenerate');
          if (!m.pushPull(f, -t)) throw new Error('plate sweep failed');
          const nf = [...m.faces.keys()].filter(id => !before.has(id));
          const edges = [];
          for (const fid of nf) {
            const ff = m.faces.get(fid);
            if (ff) for (const r of m.rings(ff)) for (let i = 0; i < r.length; i++) {
              const e = m.findEdge(r[i], r[(i + 1) % r.length]);
              if (e) edges.push(e.id);
            }
          }
          const roles = {};
          for (const fid of nf) roles[fid] = 'body';
          made = app.bim.create('plate', {
            hostColumnId: ent.id, base: [...b], size: s, thickness: t,
            baseLevel: ent.params.baseLevel || app.bimOptions.baseLevel,
          }, roles, edges);
        } finally { m.bimHold = false; }
      });
      app.toast(made ? `Base plate ${fmtLen(s)} × ${fmtLen(t)}` : 'Base plate failed');
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB(t2) {
      const m2 = String(t2).match(/^([\d.]+)(?:\s*[x,]\s*([\d.]+))?$/);
      if (!m2) return false;
      this._sV = parseFloat(m2[1]);
      if (m2[2]) this._tV = parseFloat(m2[2]);
      this.app.toast(`Plate ${fmtLen(this._sV)}${m2[2] ? ` × ${fmtLen(this._tV)}` : ''}`);
      return true;
    }
  }

  const Struct2 = {
    Analytical, StripFootingTool, BraceTool, PlateTool, trussDialog,

    /** chords + zig-zag webs as real beam entities */
    buildTruss(app, o) {
      const S = app.structural;
      if (!S) { app.toast('Structural module missing', true); return 0; }
      const bay = o.span / o.bays;
      const sec = { webWidth: 0.1, height: 0.1, profile: 'rectangular' };
      let n = 0;
      app.transaction.run('truss', m => {
        m.bimHold = true; m.plainSweeps = true; m.noAutoIntersect = true;
        try {
          const mkBeam = (A, B) => {
            const before = new Set(m.faces.keys());
            try { S.buildBeam(G, m, { baseline: [A, B], ...sec, zJustification: 'Center' }); } catch (e) { return; }
            const nf = [...m.faces.keys()].filter(id => !before.has(id));
            const edges = [];
            for (const fid of nf) {
              const ff = m.faces.get(fid);
              if (ff) for (const r of m.rings(ff)) for (let i = 0; i < r.length; i++) {
                const e = m.findEdge(r[i], r[(i + 1) % r.length]);
                if (e) edges.push(e.id);
              }
            }
            const roles = {};
            for (const fid of nf) roles[fid] = 'body';
            app.bim.create('beam', {
              baseline: [A.map(q => +q.toFixed(4)), B.map(q => +q.toFixed(4))],
              ...sec, source: 'truss',
            }, roles, edges, { noHostDirty: true });
            n++;
          };
          const zBot = o.z, zTop = o.z + o.height;
          // bottom + top chords
          mkBeam([o.x, o.y, zBot], [o.x + o.span, o.y, zBot]);
          mkBeam([o.x, o.y, zTop], [o.x + o.span, o.y, zTop]);
          // end posts + zig-zag webs
          mkBeam([o.x, o.y, zBot], [o.x, o.y, zTop]);
          mkBeam([o.x + o.span, o.y, zBot], [o.x + o.span, o.y, zTop]);
          for (let i = 0; i < o.bays; i++) {
            const x0 = o.x + bay * i, x1 = o.x + bay * (i + 1);
            const up = i % 2 === 0;
            if (up) mkBeam([x0, o.y, zBot], [x1, o.y, zTop]);
            else mkBeam([x0, o.y, zTop], [x1, o.y, zBot]);
          }
        } finally { m.bimHold = false; }
      });
      app.toast(`Truss: ${n} members (${o.bays} bays, ${fmtLen(o.span)} span)`);
      return n;
    },
  };
  window.Struct2 = Struct2;
})();
