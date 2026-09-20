'use strict';
// ---------------------------------------------------------------------------
// features/elementrebar.js — Whole-Element Reinforcement: select any face of
// a beam / column / foundation / floor and one dialog generates the full
// cage, FreeCAD-Reinforcement style:
//
//   · beam       — section ties along the span + top/bottom longitudinal
//                  rows (+ optional side skin bars); T/L beams clamp the tie
//                  cage to the web, top bars spread the flange
//   · column     — the single-tie cage from ColumnRebar (ties + 4 mains)
//   · foundation — two-way bottom mesh (layered) + column starter stubs
//                  (L-shaped: leg into the footing above the mesh, riser to
//                  a lap above the pad/pedestal; section auto-detected from
//                  the column standing on it)
//   · floor/slab — two-way bottom mesh clipped to the slab's real regions
//                  (holes split the bars; slivers drop out) + optional top
//                  mesh
//
// Geometry reads the ENTITY's own faces (trimmed/leveled/imported elements
// included), not the creation params — the B-Rep is ground truth.
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;

  // ------------------------------------------------------------- utilities
  /** n positions evenly spaced across [lo, hi] (endpoints included). */
  function spread(n, lo, hi) {
    if (n <= 0) return [];
    if (n === 1) return [(lo + hi) / 2];
    const out = [];
    for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * i / (n - 1));
    return out;
  }

  /** Bar count across a span: fixed amount, or spacing with equal end gaps
   *  (FreeCAD's ceil((span − dia)/spacing) + 1). */
  function meshCount(span, dia, mode, value) {
    if (mode === 'amount') return Math.max(1, Math.round(value) || 1);
    return Math.max(1, Math.ceil((span - dia) / Math.max(value, 1e-6)) + 1);
  }

  /** Inside intervals of the scanline y = fixed across regions
   *  [{outer, holes}] (even-odd pairing of every edge crossing). */
  function clipScanline(regions, fixed, minLen) {
    const xs = [];
    for (const r of regions) {
      const rings = [r.outer, ...(r.holes || [])];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          if ((a.y - fixed) * (b.y - fixed) < 0)
            xs.push(a.x + (fixed - a.y) / (b.y - a.y) * (b.x - a.x));
        }
      }
    }
    xs.sort((p, q) => p - q);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i += 2)
      if (xs[i + 1] - xs[i] >= minLen) out.push([xs[i], xs[i + 1]]);
    return out;
  }

  /** All upward faces of an entity at its highest z (multi-region tops). */
  function topFaces(m, ent) {
    const out = [];
    let zTop = -1e9;
    for (const fid of ent.faces || []) {
      const f = m.faces.get(fid);
      if (!f) continue;
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (n.z < 0.999) continue;
      const c = m.faceCentroid(f);
      if (!c) continue;
      zTop = Math.max(zTop, c.z);
      out.push({ f, c });
    }
    return out.filter(({ c }) => Math.abs(c.z - zTop) < 1e-3);
  }

  /** The PAD's top face of a footing — push-pull caps don't carry reliable
   *  winding, so match the pad's level z from params (both caps read +z).
   *  Fallback: the highest upward face. */
  function padTopFace(m, ent) {
    const zT = ent.params && ent.params.base != null ? +ent.params.base[2] : null;
    let best = null, bestD = 1e9, hi = null;
    for (const fid of ent.faces || []) {
      const f = m.faces.get(fid);
      if (!f) continue;
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (n.z < 0.999) continue;
      const c = m.faceCentroid(f);
      if (!c) continue;
      if (!hi || c.z > hi.c.z) hi = { f, c };
      if (zT != null) {
        const d = Math.abs(c.z - zT);
        if (d < 0.03 && d < bestD) { bestD = d; best = { f, c }; }
      }
    }
    return (best || hi) ? (best || hi).f : null;
  }

  /** Face of a beam entity whose normal is ±axis (an end cap). */
  function endFaceOfBeam(m, ent, axis) {
    let best = null, bestT = 1e9;
    for (const fid of ent.faces || []) {
      const f = m.faces.get(fid);
      if (!f) continue;
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      const d = Math.abs(G.dot(n, axis));
      if (d < 0.9) continue;
      const c = m.faceCentroid(f);
      if (!c) continue;
      const t = G.dot(c, axis); // prefer the start end for a stable frame
      if (t < bestT) { bestT = t; best = fid; }
    }
    return best;
  }

  const dist2D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // --------------------------------------------------------------- BEAM
  function buildBeamRebar(m, ent, p, add) {
    const bp = ent.params || {};
    const bl = bp.baseline;
    if (!Array.isArray(bl) || bl.length < 2) return { error: 'beam has no baseline' };
    const A = bl[0], B = bl[bl.length - 1];
    const axis = G.norm(G.v(B[0] - A[0], B[1] - A[1], 0));
    if (!isFinite(axis.x) || G.len(axis) < 0.5) return { error: 'beam baseline is not horizontal' };
    const fid = endFaceOfBeam(m, ent, axis);
    if (!fid) return { error: 'cannot find the beam end face (fully embedded?)' };
    const fr = window.Rebar.faceFrame(m, fid);
    if (!fr) return { error: 'cannot frame the beam section' };

    const q = p.beam;
    const tie = q.tieDia, mainDia = Math.max(q.topDia, q.botDia);
    const rt = tie / 2, rm = mainDia / 2;
    // T/L sections: the tie cage wraps the WEB; the top row spreads the
    // flange (rectangular: both span the full section)
    const web = bp.profile === 't' || bp.profile === 'l';
    const uc = (fr.u0 + fr.u1) / 2;
    const halfWeb = Math.max(0.02, +bp.webWidth || 0.25) / 2;
    let uLo = fr.u0 + q.side + tie + rm, uHi = fr.u1 - q.side - tie - rm;
    let lCov = q.side, rCov = q.side;
    if (web) {
      const wl = uc - halfWeb + q.side, wr = uc + halfWeb - q.side;
      lCov = wl - fr.u0; rCov = fr.u1 - wr;
      uLo = wl + tie + rm; uHi = wr - tie - rm;
    }
    // which v end is UP (faceFrame's v sign depends on the end picked)
    const z0 = fr.map(fr.u0, fr.v0).z, z1 = fr.map(fr.u0, fr.v1).z;
    const vTop = z0 >= z1 ? fr.v0 : fr.v1, vBot = z0 >= z1 ? fr.v1 : fr.v0;
    const vTopBar = vTop === fr.v0
      ? fr.v0 + q.top + tie + q.topDia / 2 : fr.v1 - (q.top + tie + q.topDia / 2);
    const vBotBar = vBot === fr.v1
      ? fr.v1 - (q.bot + tie + q.botDia / 2) : fr.v0 + q.bot + tie + q.botDia / 2;

    let ties = 0, bars = 0;
    // ties along the span (stirrupPath on the section frame, copies -n)
    const rounding = (tie / 2 + mainDia / 2) / tie;
    const path = window.Rebar.stirrupPath(fr, {
      l: lCov, r: rCov, t: q.side, b: q.side, dia: tie,
      bentAngle: q.bentAngle || 135, bentFactor: q.bentFactor || 6, rounding,
    });
    const d = window.Rebar.distribute(fr, { mode: q.mode, value: q.value, front: q.end, dia: tie });
    for (let i = 0; i < d.count; i++) {
      add(path.map(pt => G.sub(pt, G.mul(fr.n, d.off + i * d.step))), tie,
        { shape: 'stirrup', count: d.count, spacing: d.spacing });
      ties++;
    }
    // longitudinal rows: straight bars the clear span long
    const zA = q.end, zB = fr.depth - q.end;
    const row = (n, dia, vPos, lo, hi) => {
      for (const u of spread(n, lo, hi)) {
        const P0 = fr.map(u, vPos);
        add([G.sub(P0, G.mul(fr.n, zA)), G.sub(P0, G.mul(fr.n, zB))], dia,
          { shape: 'straight', count: n });
        bars++;
      }
    };
    const topLo = web ? fr.u0 + q.side + q.topDia / 2 : uLo;
    const topHi = web ? fr.u1 - q.side - q.topDia / 2 : uHi;
    row(q.topCount, q.topDia, vTopBar, topLo, topHi);
    row(q.botCount, q.botDia, vBotBar, uLo, uHi);
    // skin bars: per side, stacked between the top and bottom rows
    if (q.skin > 0 && q.skinDia > 0) {
      const sides = [fr.u0 + q.side + tie + q.skinDia / 2, fr.u1 - q.side - tie - q.skinDia / 2];
      const gap = q.topDia / 2 + q.skinDia;
      const vHi = Math.max(vTopBar + gap, vBotBar - q.botDia / 2 - q.skinDia / 2);
      const vLo = Math.min(vTopBar + gap, vBotBar - q.botDia / 2 - q.skinDia / 2);
      for (const su of sides)
        for (const vv of spread(Math.round(q.skin), vLo, vHi)) {
          const P0 = fr.map(su, vv);
          add([G.sub(P0, G.mul(fr.n, zA)), G.sub(P0, G.mul(fr.n, zB))], q.skinDia,
            { shape: 'straight', count: 1 });
          bars++;
        }
    }
    return { ties, bars };
  }

  // ------------------------------------------------------------- COLUMN
  function buildColumnRebar(m, ent, p, sink) {
    const tops = topFaces(m, ent);
    if (!tops.length) return { error: 'cannot find the column top face' };
    const fid = tops[0].f.id;
    // circular families (top loop beyond a rectangle) want the helix cage —
    // merge the dialog's rectangular fields onto sensible helix defaults
    const c = p.column || {};
    if (m.pts(tops[0].f.loop).length > 6 && c.type !== 'circular' && !c.circ)
      p.column = { ...c, type: 'circular', circ: {
        sideCover: c.tie ? c.tie.l || 0.04 : 0.04,
        helixDia: c.tie ? c.tie.dia || 0.008 : 0.008,
        pitch: c.tie && c.tie.mode !== 'amount' ? c.tie.value || 0.15 : 0.15,
        helixTOffset: c.main ? c.main.tOffset || 0.05 : 0.05,
        helixBOffset: c.main ? c.main.bOffset || 0.05 : 0.05,
        mode: 'number', value: 6,
      } };
    const res = window.ColumnRebar.buildColumnCage(m, fid, p.column, sink);
    return { ties: res.ties, bars: res.bars, ids: res.ids, error: res.error };
  }

  // ---------------------------------------------------------- FOUNDATION
  function buildFootingRebar(m, ent, p, add, entities) {
    const fp = ent.params || {};
    const pad = padTopFace(m, ent);
    if (!pad) return { error: 'cannot find the footing top face' };
    const fr = window.Rebar.faceFrame(m, pad.id);
    if (!fr) return { error: 'cannot frame the footing' };
    const q = p.foundation;
    const zTop = fr.map((fr.u0 + fr.u1) / 2, (fr.v0 + fr.v1) / 2).z;

    let ties = 0, bars = 0;
    // ---- two-way bottom mesh: lower layer at the cover, upper resting on it
    // (depths measured from the BOTTOM — the frame hangs from the pad top)
    const spanU = fr.u1 - fr.u0, spanV = fr.v1 - fr.v0;
    const layers = q.topLayer === 'Y'
      ? [{ dir: 'u', dia: q.xDia }, { dir: 'v', dia: q.yDia }]
      : [{ dir: 'v', dia: q.yDia }, { dir: 'u', dia: q.xDia }];
    const zAt = i => fr.depth - q.bottom
      - (i === 0 ? layers[0].dia / 2 : layers[0].dia + layers[1].dia / 2);
    for (let li = 0; li < layers.length; li++) {
      const { dir, dia } = layers[li];
      const r = dia / 2;
      if (dir === 'u') {
        const n = meshCount(spanV, dia, q.xMode, q.xValue);
        for (const v of spread(n, fr.v0 + q.side + r, fr.v1 - q.side - r)) {
          const a = fr.map(fr.u0 + q.side + r, v), b = fr.map(fr.u1 - q.side - r, v);
          const dz = G.mul(fr.n, zAt(li));
          add([G.sub(a, dz), G.sub(b, dz)], dia, { shape: 'straight', count: n, layer: li });
          bars++;
        }
      } else {
        const n = meshCount(spanU, dia, q.yMode, q.yValue);
        for (const u of spread(n, fr.u0 + q.side + r, fr.u1 - q.side - r)) {
          const a = fr.map(u, fr.v0 + q.side + r), b = fr.map(u, fr.v1 - q.side - r);
          const dz = G.mul(fr.n, zAt(li));
          add([G.sub(a, dz), G.sub(b, dz)], dia, { shape: 'straight', count: n, layer: li });
          bars++;
        }
      }
    }

    // ---- column starter stubs: section from the column above when present
    const ped = fp.pedestal && fp.pedestal.height >= 0.05 ? +fp.pedestal.height : 0;
    const topZ = zTop + ped;
    const base = fp.base || fp.center || [0, 0, 0];
    let col = null;
    for (const e of entities || []) {
      if (e.type !== 'column' || !e.params || !e.params.base) continue;
      const b = e.params.base;
      if (Math.abs(b[2] - topZ) < 0.02 && dist2D(b, base) < Math.max(spanU, spanV) / 2) { col = e; break; }
    }
    const colW = col ? +col.params.width || q.colW : q.colW;
    const colL = col ? +col.params.depth || q.colL : q.colL;
    const cx = col ? col.params.base[0] : base[0];
    const cy = col ? col.params.base[1] : base[1];

    // the horizontal starter leg sits just above the mesh (world z)
    const zLeg = zTop - fr.depth + q.bottom + layers[0].dia + layers[1].dia + q.stubDia / 2;
    const stubTop = topZ + q.lap;
    const nx = Math.max(2, Math.round(q.stubX)), ny = Math.max(2, Math.round(q.stubY));
    const grid = [];
    for (const x of spread(nx, cx - colW / 2, cx + colW / 2))
      for (const y of [cy - colL / 2, cy + colL / 2]) grid.push([x, y]);
    for (const y of spread(ny, cy - colL / 2, cy + colL / 2))
      for (const x of [cx - colW / 2, cx + colW / 2]) grid.push([x, y]);
    const seen = new Set();
    for (const [x, y] of grid) {
      const k = x.toFixed(4) + '|' + y.toFixed(4);
      if (seen.has(k)) continue;
      seen.add(k);
      let inx = cx - x, iny = cy - y;
      const il = Math.hypot(inx, iny);
      if (il < 1e-6) { inx = 1; iny = 0; } else { inx /= il; iny /= il; }
      const map = (s, z) => G.v(x + inx * s, y + iny * s, z);
      const pts = window.Rebar.roundedPath(
        [{ a: zLeg, b: -(q.leg + q.stubDia) }, { a: zLeg, b: 0 }, { a: stubTop, b: 0 }],
        1.5 * q.stubDia);
      add(pts.map(t => map(t.b, t.a)), q.stubDia, { shape: 'lshape', count: seen.size });
      ties++; // starters counted with the verticals
    }
    return { ties, bars, column: !!col };
  }

  // --------------------------------------------------------------- SLAB
  function buildSlabRebar(m, ent, p, add) {
    const tops = topFaces(m, ent);
    if (!tops.length) return { error: 'cannot find the slab top face' };
    const zTop = tops[0].c.z;
    const regions = tops.map(({ f }) => ({
      outer: m.pts(f.loop).map(v => ({ x: v.x, y: v.y })),
      holes: (f.holes || []).map(h => m.pts(h).map(v => ({ x: v.x, y: v.y }))),
    }));
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const r of regions) for (const v of r.outer) {
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const q = p.slab;
    let bars = 0;
    const transposed = regions.map(rg => ({
      outer: rg.outer.map(v => ({ x: v.y, y: v.x })),
      holes: (rg.holes || []).map(hh => hh.map(v => ({ x: v.y, y: v.x }))),
    }));
    const minLen = q.minBar || 0.25;
    // bars running along x, spread across y ("X spacing" between X bars)
    const alongX = (dia, z, spacing) => {
      const r = dia / 2;
      const n = meshCount(y1 - y0, dia, 'spacing', spacing);
      for (const y of spread(n, y0 + q.side + r, y1 - q.side - r))
        for (const [a, b] of clipScanline(regions, y, minLen)) {
          add([G.v(a, y, z), G.v(b, y, z)], dia, { shape: 'straight', dir: 'x' });
          bars++;
        }
    };
    // bars running along y, spread across x
    const alongY = (dia, z, spacing) => {
      const r = dia / 2;
      const n = meshCount(x1 - x0, dia, 'spacing', spacing);
      for (const x of spread(n, x0 + q.side + r, x1 - q.side - r))
        for (const [a, b] of clipScanline(transposed, x, minLen)) {
          add([G.v(x, a, z), G.v(x, b, z)], dia, { shape: 'straight', dir: 'y' });
          bars++;
        }
    };
    // bottom mesh: Y layer on the cover, X layer resting on it
    alongY(q.yDia, zTop - (q.bottom + q.yDia / 2), q.ySpacing);
    alongX(q.xDia, zTop - (q.bottom + q.yDia + q.xDia / 2), q.xSpacing);
    if (q.topMesh) {
      const td = q.topDia || q.xDia;
      alongY(td, zTop - (q.top + td / 2), q.ySpacing);
      alongX(td, zTop - (q.top + td + td / 2), q.xSpacing);
    }
    return { bars };
  }

  // ------------------------------------------------------------- facade
  const TYPE_OF = { beam: 'beam', column: 'column', foundation: 'foundation', footing: 'foundation', floor: 'slab', slab: 'slab' };

  /** Build the whole-element cage. `entities` = the app's entity list (the
   *  footing generator looks for the column above). */
  function buildElementRebar(m, fid, p, entities, sink) {
    const f = m.faces.get(fid);
    const ent = f && f.userData && f.userData.bimEntityId
      ? (entities || []).find(e => e.id === f.userData.bimEntityId) : null;
    if (!ent) return { error: 'the picked face has no element — use the Column/Beam/Foundation/Floor tools first' };
    const type = TYPE_OF[ent.type];
    if (!type) return { error: `${ent.type} elements are not reinforced yet` };
    const ids = [];
    const add = (pts, dia, meta) => {
      const made = (sink || m).addRebarPath(pts, dia,
        { color: window.Rebar.REBAR_COLOR, meta: { ...(meta || {}), host: type } });
      ids.push(...made);
      return made;
    };
    const res = type === 'beam' ? buildBeamRebar(m, ent, p, add)
      : type === 'column' ? buildColumnRebar(m, ent, p, sink)
        : type === 'foundation' ? buildFootingRebar(m, ent, p, add, entities)
          : buildSlabRebar(m, ent, p, add);
    if (res && res.error) return res;
    return { ...res, ids: res.ids ? [...res.ids, ...ids] : ids };
  }

  function previewElementRebar(m, fid, p, entities) {
    const paths = [];
    const scratch = { addRebarPath: (pts, dia) => { paths.push({ pts, dia }); return []; } };
    const res = buildElementRebar(m, fid, p, entities, scratch);
    return { ...res, paths };
  }

  // ---------------------------------------------------------------- tool
  class ElementRebarTool extends Tool {
    static id = 'rebar-element';
    activate() {
      this.fid = null;
      if (this.app.sel && this.app.sel.faces.size === 1)
        this.fid = [...this.app.sel.faces][0];
      if (this.fid && this._entityOf(this.fid)) this._open();
      else this.status();
    }
    _entityOf(fid) {
      const app = this.app;
      const f = app.model.faces.get(fid);
      if (!f || !f.userData || !f.userData.bimEntityId) return null;
      const ent = app.bim.entities.find(e => e.id === f.userData.bimEntityId);
      return ent && TYPE_OF[ent.type] ? ent : null;
    }
    get hint() {
      return 'Element Reinforcement: click ANY face of a beam, column, foundation or floor — the whole cage (ties + bars, mesh + starters) is generated from one dialog.';
    }
    onMove(ev) {
      if (this.fid) return;
      const app = this.app;
      const fid = app.view.pickFaceAt(app.view.eventPt(ev));
      app.view.setHoverFace(this._entityOf(fid) ? fid : null);
    }
    onDown(ev) { this._downAt = this.app.view.eventPt(ev); }
    onUp(ev) {
      if (this.fid) return;
      const q = this.app.view.eventPt(ev), d0 = this._downAt;
      if (d0 && (Math.abs(q.x - d0.x) > 4 || Math.abs(q.y - d0.y) > 4)) return;
      const fid = this.app.view.pickFaceAt(q);
      const ent = fid && this._entityOf(fid);
      if (!ent) { this.app.toast('Pick a face of a beam, column, foundation or floor element', true); return; }
      this.fid = fid;
      this._open();
    }
    cleanup() {
      this.app.view.setHoverFace(null);
      this.app.view.clearPreview();
    }
    _open() {
      const app = this.app;
      const ent = this._entityOf(this.fid);
      const type = TYPE_OF[ent.type];
      app.view.setHoverFace(this.fid);
      const F = (id, label, val, step) =>
        `<div class="form-row"><label>${label}</label><input id="${id}" type="number" step="${step || 0.005}" value="${val}" style="width:90px"> m</div>`;
      const N = (id, label, val) =>
        `<div class="form-row"><label>${label}</label><input id="${id}" type="number" step="1" value="${val}" style="width:90px"></div>`;
      const D = (id, label, val) =>
        `<div class="form-row"><label>${label}</label><input id="${id}" type="number" step="0.002" value="${val}" style="width:90px"> m</div>`;
      const typeName = { beam: 'Beam', column: 'Column', foundation: 'Foundation', slab: 'Floor / Slab' }[type];
      let body = '';
      if (type === 'beam') body = `
        <div id="er-beam">
          <div class="form-row"><label>Tie Covers L/R/T/B</label>
            <input id="eb-side" type="number" step="0.005" value="0.03" style="width:60px"></div>
          ${F('eb-end', 'Tie End Offset', 0.05)}
          ${D('eb-tdia', 'Tie Diameter', 0.008)}
          <div class="form-row"><label>Tie Bent Angle / Factor</label>
            <select id="eb-bent" style="width:70px"><option>135</option><option>90</option></select>
            <input id="eb-bf" type="number" step="1" value="6" style="width:60px"></div>
          <div class="form-row"><label>Tie Distribution</label>
            <label class="chk"><input type="radio" name="er-tie" value="spacing" checked> Spacing</label>
            <label class="chk"><input type="radio" name="er-tie" value="amount"> Amount</label>
            <input id="eb-tval" type="number" step="0.01" value="0.15" style="width:70px"> m</div>
          <div class="form-row"><label>Top Bars</label>
            <input id="eb-topn" type="number" step="1" min="1" value="2" style="width:50px"> ×
            <input id="eb-topd" type="number" step="0.002" value="0.014" style="width:70px"> m dia</div>
          <div class="form-row"><label>Bottom Bars</label>
            <input id="eb-botn" type="number" step="1" min="1" value="3" style="width:50px"> ×
            <input id="eb-botd" type="number" step="0.002" value="0.016" style="width:70px"> m dia</div>
          ${F('eb-top', 'Top Bar Cover', 0.03)}
          ${F('eb-bot', 'Bottom Bar Cover', 0.03)}
          <div class="form-row"><label>Skin Bars / side (0 = none)</label>
            <input id="eb-skin" type="number" step="1" min="0" value="0" style="width:60px">
            <input id="eb-skind" type="number" step="0.002" value="0.012" style="width:70px"> m dia</div>
          <p class="dim">Ties wrap the web (T/L beams too); top bars spread the flange on T/L.</p>
        </div>`;
      if (type === 'column') body = `
        <div id="er-col">
          <div class="form-row"><label>Tie Cover</label>
            <input id="ec-cov" type="number" step="0.005" value="0.04" style="width:60px"> m</div>
          ${F('ec-front', 'Tie Offset (top face)', 0.05)}
          ${D('ec-tdia', 'Tie Diameter', 0.008)}
          <div class="form-row"><label>Tie Distribution</label>
            <label class="chk"><input type="radio" name="er-ctie" value="spacing" checked> Spacing</label>
            <label class="chk"><input type="radio" name="er-ctie" value="amount"> Amount</label>
            <input id="ec-tval" type="number" step="0.01" value="0.15" style="width:70px"> m</div>
          ${D('ec-mdia', 'Main Bar Diameter', 0.016)}
          ${F('ec-t', 'Main Top Offset', 0.05)}
          ${F('ec-b', 'Main Bottom Offset', 0.05)}
          <p class="dim">Circular sections automatically get the helix cage. Need Two-Ties / Multiple / custom hooks? Use the dedicated Column Reinforcement tool.</p>
        </div>`;
      if (type === 'foundation') body = `
        <div id="er-fnd">
          ${F('ef-b', 'Bottom Cover', 0.04)}
          ${F('ef-side', 'Side Cover', 0.05)}
          <div class="form-row"><label>Top Mesh Layer</label>
            <select id="ef-top" style="width:80px"><option value="X">X</option><option value="Y">Y</option></select></div>
          ${D('ef-xd', 'X Bar Diameter', 0.012)}
          <div class="form-row"><label>X Bars</label>
            <label class="chk"><input type="radio" name="er-fx" value="spacing" checked> Spacing</label>
            <label class="chk"><input type="radio" name="er-fx" value="amount"> Amount</label>
            <input id="ef-xv" type="number" step="0.01" value="0.15" style="width:70px"> m</div>
          ${D('ef-yd', 'Y Bar Diameter', 0.012)}
          <div class="form-row"><label>Y Bars</label>
            <label class="chk"><input type="radio" name="er-fy" value="spacing" checked> Spacing</label>
            <label class="chk"><input type="radio" name="er-fy" value="amount"> Amount</label>
            <input id="ef-yv" type="number" step="0.01" value="0.15" style="width:70px"> m</div>
          <div class="form-row"><label>Column Starters</label>
            <input id="ef-nx" type="number" step="1" min="2" value="3" style="width:50px"> /side X
            <input id="ef-ny" type="number" step="1" min="2" value="3" style="width:50px"> /side Y</div>
          ${D('ef-sd', 'Starter Diameter', 0.014)}
          ${F('ef-lap', 'Starter Lap above Top', 0.5)}
          ${F('ef-leg', 'Starter Leg into Footing', 0.15)}
          <div class="form-row"><label>Starter Column W×L</label>
            <input id="ef-cw" type="number" step="0.005" value="0.4" style="width:60px">
            <input id="ef-cl" type="number" step="0.005" value="0.4" style="width:60px"> m</div>
          <p class="dim">A column standing on the footing overrides the starter section automatically.</p>
        </div>`;
      if (type === 'slab') body = `
        <div id="er-slab">
          ${F('es-b', 'Bottom Cover', 0.025)}
          ${F('es-t', 'Top Cover', 0.025)}
          ${F('es-side', 'Edge Cover', 0.025)}
          ${D('es-xd', 'X Bar Diameter', 0.012)}
          ${F('es-xs', 'X Spacing', 0.15)}
          ${D('es-yd', 'Y Bar Diameter', 0.012)}
          ${F('es-ys', 'Y Spacing', 0.15)}
          <div class="form-row"><label>Top Mesh</label>
            <label class="chk"><input type="checkbox" id="es-top"> include</label>
            ${D('es-td', 'Top Diameter', 0.012)}</div>
          <p class="dim">Bars are clipped to the slab's real outline — openings split the bars, slivers drop out.</p>
        </div>`;
      app.dialog(`Element Reinforcement — ${typeName}`, `
        <p class="dim" id="er-info">Detected: ${typeName} <b>${ent.name || ent.id}</b></p>
        ${body}
        <p class="dim" id="er-count"></p>`,
        [['Cancel', null], ['Create', () => {
          const p = this._read(type);
          const res = app.run('rebar element', mm => {
            const r = buildElementRebar(mm, this.fid, p, app.bim.entities);
            const ids = [];
            if (r && r.ids && r.ids.length) ids.push(...r.ids);
            if (ids.length) mm.createGroup({ faces: new Set(ids), edges: new Set() }, `Rebar · ${typeName}`);
            return r;
          });
          app.view.clearPreview();
          if (!res || res.error) {
            app.toast(res && res.error ? res.error : 'Could not build the reinforcement — check the parameters', true);
            return;
          }
          const what = type === 'beam' ? `${res.ties} ties + ${res.bars} bars`
            : type === 'column' ? `${res.ties} ties + ${res.bars} main bars`
              : type === 'foundation' ? `${res.bars} mesh bars + ${res.ties} starters${res.column ? ' (column detected)' : ''}`
                : `${res.bars} mesh bars`;
          app.toast(`${typeName} reinforcement: ${what} created`);
          this.fid = null;
          this.status();
        }]]);
      const update = () => {
        const p = this._read(type);
        const pv = previewElementRebar(app.model, this.fid, p, app.bim.entities);
        app.view.clearPreview();
        for (const { pts } of pv.paths.slice(0, 400))
          app.view.previewLoop(pts, window.Rebar.REBAR_COLOR);
        const c = document.getElementById('er-count');
        if (c) c.textContent = pv.error ? pv.error : `${pv.paths.length} bars in the cage`;
      };
      app._onDialogClose = () => {
        app.view.clearPreview(); app.view.setHoverFace(null);
        this.fid = null; this.status();
      };
      for (const x of document.querySelectorAll('#dialog input,#dialog select'))
        x.addEventListener(x.tagName === 'SELECT' || x.type === 'radio' || x.type === 'checkbox' ? 'change' : 'input', update);
      update();
    }
    _read(type) {
      const v = id => parseFloat((document.getElementById(id) || {}).value) || 0;
      if (type === 'beam') return { type, beam: {
        side: v('eb-side'), end: v('eb-end'), tieDia: v('eb-tdia'),
        bentAngle: parseInt((document.getElementById('eb-bent') || {}).value, 10) || 135,
        bentFactor: v('eb-bf') || 6,
        mode: (document.querySelector('input[name="er-tie"]:checked') || {}).value || 'spacing',
        value: v('eb-tval'),
        topCount: Math.max(1, Math.round(v('eb-topn'))), topDia: v('eb-topd'),
        botCount: Math.max(1, Math.round(v('eb-botn'))), botDia: v('eb-botd'),
        top: v('eb-top'), bot: v('eb-bot'),
        skin: Math.max(0, Math.round(v('eb-skin'))), skinDia: v('eb-skind'),
      } };
      if (type === 'column') return { type, column: {
        type: 'singletie',
        tie: { l: v('ec-cov'), r: v('ec-cov'), t: v('ec-cov'), b: v('ec-cov'),
          front: v('ec-front'), dia: v('ec-tdia'), bentAngle: 135, bentFactor: 6, rounding: 0,
          mode: (document.querySelector('input[name="er-ctie"]:checked') || {}).value || 'spacing',
          value: v('ec-tval') },
        main: { dia: v('ec-mdia'), tOffset: v('ec-t'), bOffset: v('ec-b'), type: 'straight' },
      } };
      if (type === 'foundation') return { type, foundation: {
        bottom: v('ef-b'), side: v('ef-side'), topLayer: (document.getElementById('ef-top') || {}).value || 'X',
        xDia: v('ef-xd'), xMode: (document.querySelector('input[name="er-fx"]:checked') || {}).value || 'spacing', xValue: v('ef-xv'),
        yDia: v('ef-yd'), yMode: (document.querySelector('input[name="er-fy"]:checked') || {}).value || 'spacing', yValue: v('ef-yv'),
        stubX: v('ef-nx'), stubY: v('ef-ny'), stubDia: v('ef-sd'),
        lap: v('ef-lap'), leg: v('ef-leg'), colW: v('ef-cw'), colL: v('ef-cl'),
      } };
      return { type: 'slab', slab: {
        bottom: v('es-b'), top: v('es-t'), side: v('es-side'),
        xDia: v('es-xd'), xSpacing: v('es-xs'), yDia: v('es-yd'), ySpacing: v('es-ys'),
        topMesh: !!(document.getElementById('es-top') || {}).checked, topDia: v('es-td'),
      } };
    }
  }

  window.ElementRebar = { ElementRebarTool, buildElementRebar, previewElementRebar, TYPE_OF };
})();
