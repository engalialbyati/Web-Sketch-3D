'use strict';
// ---------------------------------------------------------------------------
// features/columnrebar.js — Column Reinforcement (the FreeCAD-Reinforcement
// ColumnReinforcement workbench, ported): one dialog, the whole cage.
//
// Pick the TOP or BOTTOM face of a column, then choose the type:
//   · Single Tie           — one tie set + 4 main bars (straight or L-hooked)
//   · Two Ties Six Bars    — two half-width ties + 6 main bars
//   · Single Tie, Multiple — one tie set + corner bars + X-dir and Y-dir
//                            bar SETS ("3#16+1#20" — count#diameter in mm)
//   · Circular             — helix + vertical bars around a circle
//
// Placement follows the source workbench:
//   · ties inset by the four covers (+tie dia auto-rounding), hooks into the
//     core, distributed by amount-or-spacing along the column axis
//   · main bars just inside the ties (tie cover + tie dia + bar r), running
//     between the bottom and top offsets; L-hooks turn at Top/Bottom toward
//     Inside/Outside with a tail of hook-extension (default 4×dia, SP:16)
//   · set spacing = (span − Σ n·dia) / (N + 1) — even gaps between every set
//   · circular: helix of `pitch`, main bars on a circle at 360/n or a fixed
//     angle, cover measured to the helix
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;
  const num = id => parseFloat(document.getElementById(id).value) || 0;
  const el = id => document.getElementById(id);
  const mm = v => (v * 1000).toFixed(0);

  // ------------------------------------------------------------- geometry
  /** One vertical bar (or L-hooked bar) at plan face-coords (a, b), from
   *  zA to zB measured as distances below the picked face. */
  function verticalBar(add, fr, at, a, b, zA, zB, dia, opts) {
    if (opts && opts.type === 'lshape') {
      // knee rounding in the (z, s) plane, s = the foot axis coordinate
      const hookTop = /Top/.test(opts.hookAt);
      const inward = /Inside/.test(opts.hookAt);
      const alongU = (opts.along || 'u') === 'u';
      const foot = (opts.extension || 4 * dia) + (opts.rounding || 1) * dia;
      const cu = (fr.u0 + fr.u1) / 2, cv = (fr.v0 + fr.v1) / 2;
      const zEnd = hookTop ? zB : zA;   // the end the hook turns at
      const zFar = hookTop ? zA : zB;   // the free end of the leg
      // foot direction: toward the column center (Inside) or away, along the
      // chosen axis, from the half the bar sits in
      const dir = alongU ? (a < cu ? 1 : -1) * (inward ? 1 : -1)
        : (b < cv ? 1 : -1) * (inward ? 1 : -1);
      const S0 = alongU ? a : b;
      const z0 = at(a, b, zFar).z, z1 = at(a, b, zEnd).z;
      const map = (s, z) => {
        const q = alongU ? fr.map(s, b) : fr.map(a, s);
        return G.v(q.x, q.y, z);
      };
      const rounded = window.Rebar.roundedPath(
        [{ a: z0, b: S0 }, { a: z1, b: S0 }, { a: z1, b: S0 + dir * foot }],
        (opts.rounding || 1) * dia);
      const pts = [at(a, b, zFar), ...rounded.slice(1).map(q => map(q.b, q.a))];
      add(pts, dia, { shape: 'lshape' });
      return;
    }
    add([at(a, b, zA), at(a, b, zB)], dia, { shape: 'straight' });
  }

  /** The whole cage. p is the normalized parameter object; `sink` receives
   *  the bar paths (the model, or the preview recorder). Returns
   *  { ids, ties, bars, error }. */
  function buildColumnCage(m, fid, p, sink) {
    const fr = window.Rebar.faceFrame(m, fid);
    if (!fr) return { error: 'cannot frame the picked face' };
    if (Math.abs(fr.n.z) < 0.7) return { error: 'Pick the TOP or BOTTOM face of the column' };
    const target = sink || m;
    const ids = [];
    const add = (pts, dia, meta) => {
      ids.push(...target.addRebarPath(pts, dia, { color: window.Rebar.REBAR_COLOR, meta: { ...meta, host: 'column' } }));
    };
    const H = fr.depth;
    const at = (a, b, d) => G.sub(fr.map(a, b), G.mul(fr.n, d));
    // offsets are measured from the COLUMN's bottom and top — whichever face
    // was picked. endsOf returns [dBottomEnd, dTopEnd] as distances into the
    // column from the picked face, ordered world-bottom first.
    const topPicked = fr.n.z > 0;
    const endsOf = (bo, to, rr) => {
      const bot = bo + rr, top = H - to - rr; // heights above the column bottom
      return topPicked ? [H - bot, H - top] : [bot, top];
    };
    let ties = 0, bars = 0;

    // ------------------------------------------------------------ circular
    if (p.type === 'circular') {
      const c = p.circ;
      const R0 = Math.min(fr.u1 - fr.u0, fr.v1 - fr.v0) / 2;
      const rh = R0 - c.sideCover - c.helixDia / 2;
      if (rh <= c.helixDia) return { error: 'cover leaves no room for the helix' };
      const ca = (fr.u0 + fr.u1) / 2, cb = (fr.v0 + fr.v1) / 2;
      const [z0, z1] = endsOf(c.helixBOffset, c.helixTOffset, c.helixDia / 2);
      if (Math.abs(z1 - z0) <= 0) return { error: 'helix offsets leave no height' };
      const turns = Math.max(1, Math.abs(z1 - z0) / Math.max(c.pitch, 1e-4));
      const N = Math.min(2400, Math.max(48, Math.round(turns * 24)));
      const helix = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N, ang = t * turns * Math.PI * 2;
        helix.push(at(ca + rh * Math.cos(ang), cb + rh * Math.sin(ang), z0 + (z1 - z0) * t));
      }
      add(helix, c.helixDia, { shape: 'helical', pitch: c.pitch });
      ties = Math.round(turns * 10) / 10; // informational
      // main bars on a circle just inside the helix
      const rm = R0 - c.sideCover - c.helixDia - p.main.dia / 2;
      const n = c.mode === 'number' ? Math.max(3, Math.round(c.value))
        : Math.max(3, Math.ceil(360 / Math.max(c.value, 1)));
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const a = ca + rm * Math.cos(ang), b = cb + rm * Math.sin(ang);
        const [bA, bB] = endsOf(p.main.bOffset, p.main.tOffset, p.main.dia / 2);
        add([at(a, b, bA), at(a, b, bB)], p.main.dia, { shape: 'straight', count: n });
        bars++;
      }
      return { ids, ties, bars };
    }

    // ---------------------------------------------------------------- ties
    // the tie bends AROUND the corner bar: with the mandrel radius set to
    // tieR + cornerR the bend's arc center coincides with the corner bar
    // axis, so the tie wraps the bar cleanly (FreeCAD's default relation)
    const cornerDiaForTie = Math.max(p.main.dia, ...(p.xSets || []).map(([, d]) => d), ...(p.ySets || []).map(([, d]) => d), 0);
    const tieRounding = p.tie.rounding != null && p.tie.rounding > 0
      ? p.tie.rounding : (p.tie.dia / 2 + cornerDiaForTie / 2) / p.tie.dia;
    const tieDist = window.Rebar.distribute(fr, { mode: p.tie.mode, value: p.tie.value, front: p.tie.front, dia: p.tie.dia });
    const tiePaths = [];
    if (p.type === 'twoties') {
      // each tie spans half the section, meeting at the middle bar pair
      const Wu = fr.u1 - fr.u0;
      const midCover = Wu / 2 - p.main.dia / 2 - p.tie.dia;
      tiePaths.push(window.Rebar.stirrupPath(fr, { ...p.tie, r: Math.max(p.tie.l, midCover), rounding: tieRounding }));
      tiePaths.push(window.Rebar.stirrupPath(fr, { ...p.tie, l: Math.max(p.tie.r, midCover), rounding: tieRounding }));
    } else {
      tiePaths.push(window.Rebar.stirrupPath(fr, { ...p.tie, rounding: tieRounding }));
    }
    for (const path of tiePaths)
      for (let i = 0; i < tieDist.count; i++) {
        add(path.map(q => G.sub(q, G.mul(fr.n, tieDist.off + i * tieDist.step))),
          p.tie.dia, { shape: 'stirrup', count: tieDist.count, spacing: tieDist.spacing });
        ties++;
      }

    // ----------------------------------------------------------- main bars
    // corner bars are never lighter than the inner bars: their size is the
    // largest longitudinal diameter in the cage (FreeCAD keeps one main
    // diameter; mixed set strings could otherwise out-size the corners)
    const setDias = [...(p.xSets || []), ...(p.ySets || [])].map(([, d]) => d);
    const cornerDia = Math.max(p.main.dia, ...setDias, 0);
    const r = cornerDia / 2;
    const uL = fr.u0 + p.tie.l + p.tie.dia + r;
    const uR = fr.u1 - p.tie.r - p.tie.dia - r;
    const vB = fr.v0 + p.tie.b + p.tie.dia + r;
    const vT = fr.v1 - p.tie.t - p.tie.dia - r;
    const [zA, zB] = endsOf(p.main.bOffset, p.main.tOffset, r);
    const corners = [[uL, vB], [uR, vB], [uR, vT], [uL, vT]];
    const rows = p.type === 'twoties'
      ? [...corners, [(uL + uR) / 2, vB], [(uL + uR) / 2, vT]] : corners;
    for (const [a, b] of rows) {
      verticalBar(add, fr, at, a, b, zA, zB, cornerDia, p.main);
      bars++;
    }

    // -------------------------------------------------- multiple: x/y sets
    if (p.type === 'multiple') {
      const setRows = (sets, axis) => {
        // axis 'u': bars distributed along u, one row at each v edge line
        const N = sets.reduce((s, [n]) => s + n, 0);
        if (!N) return;
        const sumW = sets.reduce((s, [n, d]) => s + n * d, 0);
        const lo = axis === 'u' ? uL : vB, hi = axis === 'u' ? uR : vT;
        const span = hi - lo - cornerDia - sumW;
        const s = span / (N + 1);
        if (s < 0) return { error: `too many ${axis}-dir bars for the section` };
        const rowsAt = axis === 'u' ? [[null, vB], [null, vT]] : [[uL, null], [uR, null]];
        for (const [rowA, rowB] of rowsAt) {
          let cursor = lo + cornerDia / 2; // surface of the corner bar line
          for (const [n, d] of sets) {
            for (let i = 0; i < n; i++) {
              cursor += s + d / 2;
              const a = axis === 'u' ? cursor : rowA;
              const b = axis === 'u' ? rowB : cursor;
              const [sA, sB] = endsOf(p.main.bOffset, p.main.tOffset, d / 2);
              verticalBar(add, fr, at, a, b, sA, sB, d,
                { type: p.main.type === 'lshape' ? 'lshape' : 'straight', ...p.main });
              bars++;
              cursor += d / 2;
            }
          }
        }
      };
      let err = setRows(p.xSets || [], 'u');
      if (!err) err = setRows(p.ySets || [], 'v');
      if (err) return { ids, ties, bars, error: err.error };
    }
    return { ids, ties, bars };
  }

  /** Centerlines for the live preview (no model writes). */
  function previewCage(m, fid, p) {
    // frame from the REAL model; bar paths land in a recorder instead of
    // the B-Rep
    const paths = [];
    const scratch = { addRebarPath: (pts, dia) => { paths.push({ pts, dia }); return []; } };
    const res = buildColumnCage(m, fid, p, scratch);
    return { ...res, paths };
  }

  // ------------------------------------------------------------------ tool
  class ColumnRebarTool extends Tool {
    static id = 'rebar-column';
    activate() {
      this.fid = null;
      if (this.app.sel && this.app.sel.faces.size === 1)
        this.fid = [...this.app.sel.faces][0];
      if (this.fid) this._open(); else this.status();
    }
    get hint() {
      return 'Column Reinforcement: click the TOP or BOTTOM face of a column — the whole cage (ties + main bars, or a helix) is built from one dialog.';
    }
    onMove(ev) {
      if (this.fid) return;
      this.app.view.setHoverFace(this.app.view.pickFaceAt(this.app.view.eventPt(ev)));
    }
    onDown(ev) { this._downAt = this.app.view.eventPt(ev); }
    onUp(ev) {
      if (this.fid) return;
      const q = this.app.view.eventPt(ev), d0 = this._downAt;
      if (d0 && (Math.abs(q.x - d0.x) > 4 || Math.abs(q.y - d0.y) > 4)) return;
      const fid = this.app.view.pickFaceAt(q);
      if (fid) { this.fid = fid; this._open(); }
    }
    cleanup() {
      this.app.view.setHoverFace(null);
      this.app.view.clearPreview();
    }
    _open() {
      const app = this.app;
      app.view.setHoverFace(this.fid);
      const F = (id, label, val, step) =>
        `<div class="form-row"><label>${label}</label><input id="${id}" type="number" step="${step || 0.005}" value="${val}" style="width:90px"> m</div>`;
      app.dialog('Column Reinforcement', `
        <div class="form-row"><label>Column Type</label>
          <select id="cr-type" style="width:200px">
            <option value="singletie">Single Tie</option>
            <option value="twoties">Two Ties Six Bars</option>
            <option value="multiple">Single Tie, Multiple Bars</option>
            <option value="circular">Circular (Helix)</option>
          </select></div>
        <div id="cr-ties">
          <div class="form-row"><label>Tie Covers L/R/T/B</label>
            <input id="ct-l" type="number" step="0.005" value="0.04" style="width:60px">
            <input id="ct-r" type="number" step="0.005" value="0.04" style="width:60px">
            <input id="ct-t" type="number" step="0.005" value="0.04" style="width:60px">
            <input id="ct-b" type="number" step="0.005" value="0.04" style="width:60px"> m</div>
          ${F('ct-front', 'Tie Offset (from face)', 0.05)}
          ${F('ct-dia', 'Tie Diameter', 0.008, 0.002)}
          <div class="form-row"><label>Tie Bent Angle / Factor</label>
            <select id="ct-bent" style="width:70px"><option>135</option><option>90</option></select>
            <input id="ct-bf" type="number" step="1" value="6" style="width:60px"></div>
          <div class="form-row"><label>Tie Distribution</label>
            <label class="chk"><input type="radio" name="cr-tie-mode" value="spacing" checked> Spacing</label>
            <label class="chk"><input type="radio" name="cr-tie-mode" value="amount"> Amount</label>
            <input id="ct-val" type="number" step="0.01" value="0.15" style="width:70px"> m</div>
        </div>
        <div id="cr-main">
          ${F('cm-dia', 'Main Bar Diameter', 0.016, 0.002)}
          ${F('cm-t', 'Main Top Offset', 0.05)}
          ${F('cm-b', 'Main Bottom Offset', 0.05)}
          <div class="form-row"><label>Main Bar Type</label>
            <select id="cm-type" style="width:130px"><option>Straight</option><option>L-Shape</option></select></div>
          <div id="cr-hook" style="display:none">
            <div class="form-row"><label>Hook</label>
              <select id="ch-at" style="width:130px">
                <option>Top Inside</option><option>Top Outside</option>
                <option>Bottom Inside</option><option>Bottom Outside</option></select></div>
            <div class="form-row"><label>Hook Extends Along</label>
              <select id="ch-along" style="width:130px"><option>X axis</option><option>Y axis</option></select></div>
            ${F('ch-ext', 'Hook Extension', 0.064)}
            <div class="form-row"><label>Hook Rounding (× dia, 0 = auto)</label>
              <input id="ch-rnd" type="number" step="0.5" min="0" value="0" style="width:90px"></div>
          </div>
        </div>
        <div id="cr-multi" style="display:none">
          <div class="form-row"><label>X-Dir Bar Sets</label>
            <input id="cx-sets" type="text" value="1#16+1#16" style="width:130px"></div>
          <div class="form-row"><label>Y-Dir Bar Sets</label>
            <input id="cy-sets" type="text" value="1#16" style="width:130px"></div>
          <p class="dim">Sets syntax: count#diameter in mm, + separated (e.g. 1#16+1#20+1#16). Each set runs in two rows just inside the ties.</p>
        </div>
        <div id="cr-circ" style="display:none">
          ${F('cc-cover', 'Side Cover', 0.04)}
          ${F('cc-hdia', 'Helix Diameter', 0.008, 0.002)}
          ${F('cc-pitch', 'Helix Pitch', 0.1)}
          ${F('cc-ht', 'Helix Top Offset', 0.05)}
          ${F('cc-hb', 'Helix Bottom Offset', 0.05)}
          <div class="form-row"><label>Main Bars</label>
            <label class="chk"><input type="radio" name="cr-circ-mode" value="number" checked> Number</label>
            <label class="chk"><input type="radio" name="cr-circ-mode" value="angle"> Angle°</label>
            <input id="cc-val" type="number" step="1" value="6" style="width:70px"></div>
        </div>
        <p class="dim" id="cr-info"></p>
        <p class="dim">Covers are to the bar surface. The cage is independent loose geometry — deleting the column keeps it.</p>`,
        [['Cancel', null], ['Create', async () => {
          const p = this._read();
          const fid0 = this.fid; // the dialog closes during the await
          // python bridge: one batched mesh prefetch for the previewed cage
          if (window.PyEngine && this._lastPaths)
            await PyEngine.prefetch(this._lastPaths);
          const res = app.run('rebar column', m => {
            const r = buildColumnCage(m, fid0, p);
            if (r && r.ids && r.ids.length) m.createGroup({ faces: new Set(r.ids), edges: new Set() }, 'Rebar · column');
            return r;
          });
          app.view.clearPreview();
          if (!res || res.error || !res.ids || !res.ids.length) {
            app.toast(res && res.error ? res.error : 'Could not build the cage — check the parameters', true);
            return;
          }
          app.toast(`Column cage: ${res.ties} ties + ${res.bars} main bars created`);
          this.fid = null;
          this.status();
        }]]);
      const update = () => {
        const p = this._read();
        const pv = previewCage(app.model, this.fid, p);
        this._lastPaths = pv.paths;
        app.view.clearPreview();
        for (const { pts } of pv.paths.slice(0, 400))
          app.view.previewLoop(pts, window.Rebar.REBAR_COLOR);
        const info = el('cr-info');
        if (info) info.textContent = pv.error
          ? pv.error
          : `${pv.ties} ties + ${pv.bars} main bars (${pv.paths.length} bars total)`;
      };
      app._onDialogClose = () => {
        app.view.clearPreview(); app.view.setHoverFace(null);
        this.fid = null; this.status();
      };
      const wire = id => { const x = el(id); if (x) x.addEventListener(x.tagName === 'SELECT' || x.type === 'radio' ? 'change' : 'input', update); };
      for (const id of ['cr-type', 'ct-l', 'ct-r', 'ct-t', 'ct-b', 'ct-front', 'ct-dia', 'ct-bent', 'ct-bf', 'ct-val',
        'cm-dia', 'cm-t', 'cm-b', 'cm-type', 'ch-at', 'ch-along', 'ch-ext', 'ch-rnd',
        'cx-sets', 'cy-sets', 'cc-cover', 'cc-hdia', 'cc-pitch', 'cc-ht', 'cc-hb', 'cc-val'])
        wire(id);
      document.querySelectorAll('input[name="cr-tie-mode"],input[name="cr-circ-mode"]').forEach(r => r.addEventListener('change', update));
      el('cr-type').addEventListener('change', () => this._syncSections());
      el('cm-type').addEventListener('change', () => this._syncSections());
      this._syncSections();
      update();
    }
    _syncSections() {
      const t = el('cr-type').value;
      el('cr-ties').style.display = t === 'circular' ? 'none' : '';
      el('cr-main').style.display = '';
      el('cr-hook').style.display = el('cm-type').value === 'L-Shape' ? '' : 'none';
      el('cr-multi').style.display = t === 'multiple' ? '' : 'none';
      el('cr-circ').style.display = t === 'circular' ? '' : 'none';
    }
    _read() {
      const tieMode = document.querySelector('input[name="cr-tie-mode"]:checked').value;
      const circMode = document.querySelector('input[name="cr-circ-mode"]:checked').value;
      const sets = txt => (txt || '').split('+').map(s => s.trim()).filter(Boolean)
        .map(s => { const [n, d] = s.split('#'); return [Math.max(0, parseInt(n, 10) || 0), (parseFloat(d) || 0) / 1000]; })
        .filter(([n, d]) => n > 0 && d > 0);
      return {
        type: el('cr-type').value,
        tie: {
          l: num('ct-l'), r: num('ct-r'), t: num('ct-t'), b: num('ct-b'),
          front: num('ct-front'), dia: num('ct-dia'),
          bentAngle: parseInt(el('ct-bent').value, 10) || 135,
          bentFactor: num('ct-bf') || 4, rounding: 0,
          mode: tieMode, value: num('ct-val'),
        },
        main: {
          dia: num('cm-dia'), tOffset: num('cm-t'), bOffset: num('cm-b'),
          type: el('cm-type').value === 'L-Shape' ? 'lshape' : 'straight',
          hookAt: el('ch-at').value, along: el('ch-along').value === 'X axis' ? 'u' : 'v',
          extension: num('ch-ext'), rounding: num('ch-rnd') > 0 ? num('ch-rnd') : 1,
        },
        xSets: sets(el('cx-sets') ? el('cx-sets').value : ''),
        ySets: sets(el('cy-sets') ? el('cy-sets').value : ''),
        circ: {
          sideCover: num('cc-cover'), helixDia: num('cc-hdia'), pitch: num('cc-pitch'),
          helixTOffset: num('cc-ht'), helixBOffset: num('cc-hb'),
          mode: circMode, value: num('cc-val'),
        },
      };
    }
  }

  window.ColumnRebar = { ColumnRebarTool, buildColumnCage, previewCage, verticalBar };
})();
