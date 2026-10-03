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
    // ---- MNL-66(20) COL-200/202: splices. Lap mode splits the bar into
    // two overlapping pieces just above the floor (COL-200: "splice at
    // slabs, beams") with a Class B tension lap; alternate bars stagger by
    // half a lap so no more than half the section splices at one height.
    // Mechanical / end-bearing keep one square-cut piece with a sleeve at
    // the splice plane (COL-202).
    const sp = opts && opts.splice;
    // zA is ALWAYS the world-BOTTOM end (endsOf ordering) but the depths
    // run picked-face-relative: work along the zA -> zB direction
    const dir = Math.sign(zB - zA) || 1, span = Math.abs(zB - zA);
    if (sp && sp.mode && sp.mode !== 'none' && span > 0.4) {
      const psiS = dia <= 0.0195 ? 0.8 : 1; // ACI 25.4.2.3 size factor
      const lap = Math.max(0.3, 1.3 * 47.5 * psiS * dia); // Class B, Gr60/4ksi
      const stag = sp.mode === 'lap' && sp.stagger !== false ? lap / 2 : 0;
      const z0 = zA + dir * ((sp.gap != null ? +sp.gap : 0.05)
        + ((opts._i || 0) % 2 ? stag : 0));
      const fit = dir * (zB - z0); // room from the splice start to the far end
      if (sp.mode === 'lap' && fit > lap + 0.02) {
        add([at(a, b, zA), at(a, b, z0 + dir * lap)], dia,
          { shape: 'straight', role: 'splice-lower', lap: +lap.toFixed(3) });
        add([at(a, b, z0), at(a, b, zB)], dia,
          { shape: 'straight', role: 'splice-upper', lap: +lap.toFixed(3) });
        return;
      }
      if (sp.mode === 'mechanical' || sp.mode === 'end-bearing') {
        add([at(a, b, zA), at(a, b, zB)], dia, { shape: 'straight' });
        const s1 = z0 - dir * 0.075, s2 = z0 + dir * 0.075;
        add([at(a, b, Math.min(s1, s2)), at(a, b, Math.max(s1, s2))],
          dia + 0.012, { shape: 'straight', role: 'coupler', mode: sp.mode });
        return;
      }
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
      const N = Math.min(1200, Math.max(36, Math.round(turns * 12)));
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
        verticalBar(add, fr, at, a, b, bA, bB, p.main.dia,
          { ...p.main, type: 'straight', _i: i });
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
    // COL-200/COL-101: two extra ties through the splice zone (splices sit
    // just above the slab - the ties straddle the lap start)
    if (p.main.splice && p.main.splice.mode && p.main.splice.mode !== 'none') {
      const gap = p.main.splice.gap != null ? +p.main.splice.gap : 0.05;
      const dOf = hgt => (topPicked ? H - hgt : hgt);
      for (const hgt of [gap + 0.12, gap + 0.32])
        for (const path of tiePaths)
          add(path.map(q => G.sub(q, G.mul(fr.n, dOf(hgt)))), p.tie.dia,
            { shape: 'stirrup', role: 'splice-tie' });
      ties += 2 * tiePaths.length;
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
    rows.forEach(([a, b], i) => {
      verticalBar(add, fr, at, a, b, zA, zB, cornerDia, { ...p.main, _i: i });
      bars++;
    });

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
        let barIdx = 0;
        for (const [rowA, rowB] of rowsAt) {
          let cursor = lo + cornerDia / 2; // surface of the corner bar line
          for (const [n, d] of sets) {
            for (let i = 0; i < n; i++) {
              cursor += s + d / 2;
              const a = axis === 'u' ? cursor : rowA;
              const b = axis === 'u' ? rowB : cursor;
              const [sA, sB] = endsOf(p.main.bOffset, p.main.tOffset, d / 2);
              verticalBar(add, fr, at, a, b, sA, sB, d,
                { type: p.main.type === 'lshape' ? 'lshape' : 'straight', ...p.main, _i: barIdx++ });
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

  // ------------------------------------------------------------- ACI 318 Data & Educational Tooltips
  const BAR_SIZES = [
    { us: '#3', metric: '10M', dia: 0.0095, mm: 9.5, area: 71, mass: 0.560 },
    { us: '#4', metric: '12M', dia: 0.0127, mm: 12.7, area: 129, mass: 0.994 },
    { us: '#5', metric: '16M', dia: 0.0159, mm: 15.9, area: 200, mass: 1.552 },
    { us: '#6', metric: '20M', dia: 0.0191, mm: 19.1, area: 284, mass: 2.235 },
    { us: '#7', metric: '22M', dia: 0.0222, mm: 22.2, area: 387, mass: 3.042 },
    { us: '#8', metric: '25M', dia: 0.0254, mm: 25.4, area: 510, mass: 3.973 },
    { us: '#9', metric: '28M', dia: 0.0287, mm: 28.7, area: 645, mass: 5.060 },
    { us: '#10', metric: '32M', dia: 0.0323, mm: 32.3, area: 819, mass: 6.404 },
    { us: '#11', metric: '36M', dia: 0.0358, mm: 35.8, area: 1006, mass: 7.907 },
  ];

  const TIE_SIZES = [
    { us: '#3', metric: '10M', dia: 0.0095, mm: 9.5, label: '#3 / 10M (9.5 mm) — Standard for bars ≤ #10' },
    { us: '#4', metric: '12M', dia: 0.0127, mm: 12.7, label: '#4 / 12M (12.7 mm) — Heavy ties / bars ≥ #11' },
    { us: '#5', metric: '16M', dia: 0.0159, mm: 15.9, label: '#5 / 16M (15.9 mm) — High seismic confinement' },
  ];

  const TOOLTIPS = {
    cover: {
      title: 'Clear Concrete Cover',
      aci: 'ACI 318-19 Table 20.5.1.3.1',
      desc: 'The minimum thickness of concrete protecting the outer tie and reinforcement from corrosion, moisture, and fire.',
      rec: 'Columns: 40 mm (interior), 50 mm (exterior), 75 mm (against earth).',
      svg: `<svg viewBox="0 0 160 100" width="160" height="100">
        <rect x="15" y="10" width="130" height="80" rx="3" fill="#e2e8f0" stroke="#475569" stroke-width="1.5"/>
        <rect x="42" y="32" width="76" height="58" rx="6" fill="none" stroke="#2563eb" stroke-width="3.5"/>
        <circle cx="52" cy="42" r="6" fill="#1e3a8a" stroke="#93c5fd" stroke-width="1"/>
        <line x1="15" y1="22" x2="42" y2="22" stroke="#ef4444" stroke-width="1.8"/>
        <line x1="15" y1="18" x2="15" y2="26" stroke="#ef4444" stroke-width="1.5"/>
        <line x1="42" y1="18" x2="42" y2="26" stroke="#ef4444" stroke-width="1.5"/>
        <text x="28" y="17" font-size="9" font-weight="700" fill="#ef4444" text-anchor="middle">cc ≥ 40mm</text>
        <text x="80" y="93" font-size="8" fill="#64748b" text-anchor="middle">Concrete Face → Outer Tie</text>
      </svg>`
    },
    maindia: {
      title: 'Longitudinal Bar Diameter',
      aci: 'ACI 318-19 §10.6.1 & §10.7.3',
      desc: 'Main vertical load-bearing bars resisting axial compression and bending moments. Must have at least 4 bars in rectangular columns.',
      rec: 'Common column sizes: #6 (20 mm) to #10 (32 mm). Steel ratio 1%–4% Ag.',
      svg: `<svg viewBox="0 0 160 100" width="160" height="100">
        <rect x="25" y="10" width="110" height="80" rx="3" fill="#e2e8f0" stroke="#475569" stroke-width="1.5"/>
        <rect x="38" y="22" width="84" height="56" rx="6" fill="none" stroke="#94a3b8" stroke-width="1.8"/>
        <circle cx="48" cy="32" r="7" fill="#2563eb" stroke="#1d4ed8" stroke-width="1.5"/>
        <circle cx="112" cy="32" r="7" fill="#2563eb" stroke="#1d4ed8" stroke-width="1.5"/>
        <circle cx="112" cy="68" r="7" fill="#2563eb" stroke="#1d4ed8" stroke-width="1.5"/>
        <circle cx="48" cy="68" r="7" fill="#2563eb" stroke="#1d4ed8" stroke-width="1.5"/>
        <line x1="41" y1="32" x2="55" y2="32" stroke="#ef4444" stroke-width="1.5"/>
        <text x="80" y="52" font-size="9.5" font-weight="700" fill="#1e3a8a" text-anchor="middle">Main Bars (db)</text>
        <text x="80" y="94" font-size="8" fill="#64748b" text-anchor="middle">Min 4 bars · ρ = 1%–4% Ag</text>
      </svg>`
    },
    arrangement: {
      title: 'Longitudinal Bar Arrangement',
      aci: 'ACI 318-19 §10.7.3 & §25.2',
      desc: 'Distribution of bars around the perimeter. Bars along X and Y faces provide confinement and resist biaxial bending.',
      rec: 'Clear spacing between bars must be ≥ max(1.5 db, 40 mm).',
      svg: `<svg viewBox="0 0 160 100" width="160" height="100">
        <rect x="25" y="10" width="110" height="80" rx="3" fill="#e2e8f0" stroke="#475569" stroke-width="1.5"/>
        <rect x="38" y="22" width="84" height="56" rx="6" fill="none" stroke="#64748b" stroke-width="2"/>
        <circle cx="48" cy="32" r="5" fill="#1e3a8a"/>
        <circle cx="112" cy="32" r="5" fill="#1e3a8a"/>
        <circle cx="112" cy="68" r="5" fill="#1e3a8a"/>
        <circle cx="48" cy="68" r="5" fill="#1e3a8a"/>
        <circle cx="80" cy="32" r="5" fill="#ea580c"/>
        <circle cx="80" cy="68" r="5" fill="#ea580c"/>
        <circle cx="48" cy="50" r="5" fill="#ea580c"/>
        <circle cx="112" cy="50" r="5" fill="#ea580c"/>
        <text x="80" y="52" font-size="9" font-weight="700" fill="#0f172a" text-anchor="middle">3 × 3 = 8 Bars</text>
        <text x="80" y="94" font-size="8" fill="#64748b" text-anchor="middle">Corner (Blue) + Face (Orange)</text>
      </svg>`
    },
    tiedia: {
      title: 'Tie / Stirrup Diameter',
      aci: 'ACI 318-19 §25.7.2.2',
      desc: 'Transverse ties confine the concrete core and prevent vertical bars from buckling outward under high compressive load.',
      rec: 'At least #3 (10 mm) for main bars ≤ #10 (32 mm); #4 (12 mm) for larger.',
      svg: `<svg viewBox="0 0 160 100" width="160" height="100">
        <rect x="25" y="10" width="110" height="80" rx="3" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1"/>
        <rect x="38" y="22" width="84" height="56" rx="8" fill="none" stroke="#2563eb" stroke-width="4"/>
        <circle cx="48" cy="32" r="5" fill="#94a3b8"/>
        <circle cx="112" cy="32" r="5" fill="#94a3b8"/>
        <circle cx="112" cy="68" r="5" fill="#94a3b8"/>
        <circle cx="48" cy="68" r="5" fill="#94a3b8"/>
        <path d="M 75 22 L 95 12" stroke="#ef4444" stroke-width="1.5"/>
        <text x="100" y="12" font-size="8.5" font-weight="700" fill="#ef4444">Tie (dt)</text>
        <text x="80" y="52" font-size="8.5" font-weight="600" fill="#1e3a8a" text-anchor="middle">Buckling Restraint</text>
        <text x="80" y="94" font-size="8" fill="#64748b" text-anchor="middle">ACI min: #3 (10 mm) / #4 (12 mm)</text>
      </svg>`
    },
    tiespacing: {
      title: 'Tie Vertical Spacing (s)',
      aci: 'ACI 318-19 §10.7.6.5.2',
      desc: 'Center-to-center vertical pitch of ties along column clear height. Must not exceed the ACI code maximum limit.',
      rec: 's ≤ min(Least column dim b, 16× db, 48× dt). Typically 150–250 mm.',
      svg: `<svg viewBox="0 0 160 100" width="160" height="100">
        <rect x="45" y="10" width="70" height="80" fill="#e2e8f0" stroke="#475569" stroke-width="1.5"/>
        <line x1="55" y1="10" x2="55" y2="90" stroke="#1e3a8a" stroke-width="3"/>
        <line x1="105" y1="10" x2="105" y2="90" stroke="#1e3a8a" stroke-width="3"/>
        <line x1="50" y1="25" x2="110" y2="25" stroke="#2563eb" stroke-width="2"/>
        <line x1="50" y1="45" x2="110" y2="45" stroke="#2563eb" stroke-width="2"/>
        <line x1="50" y1="65" x2="110" y2="65" stroke="#2563eb" stroke-width="2"/>
        <line x1="50" y1="85" x2="110" y2="85" stroke="#2563eb" stroke-width="2"/>
        <line x1="118" y1="45" x2="118" y2="65" stroke="#ef4444" stroke-width="1.5"/>
        <line x1="114" y1="45" x2="122" y2="45" stroke="#ef4444" stroke-width="1.5"/>
        <line x1="114" y1="65" x2="122" y2="65" stroke="#ef4444" stroke-width="1.5"/>
        <text x="127" y="58" font-size="10" font-weight="700" fill="#ef4444">s</text>
        <text x="80" y="95" font-size="7.5" fill="#64748b" text-anchor="middle">s ≤ min(b, 16db, 48dt)</text>
      </svg>`
    },
    tiehook: {
      title: 'Standard Tie Hooks',
      aci: 'ACI 318-19 §25.3.2',
      desc: '135° seismic hooks extend 6× tie diameter (min 75 mm) into the confined column core, preventing ties from opening during earthquakes.',
      rec: '135° Seismic Hook with 6×dt extension (recommended for ductile frames).',
      svg: `<svg viewBox="0 0 160 100" width="160" height="100">
        <circle cx="70" cy="50" r="12" fill="#94a3b8" stroke="#475569" stroke-width="1.5"/>
        <path d="M 25 38 L 70 38 A 12 12 0 0 1 82 50 L 82 85" fill="none" stroke="#2563eb" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M 70 38 L 35 68" fill="none" stroke="#2563eb" stroke-width="4.5" stroke-linecap="round"/>
        <text x="88" y="26" font-size="9.5" font-weight="700" fill="#1e3a8a">135° Hook</text>
        <text x="88" y="38" font-size="8" fill="#ef4444">Tail ≥ 6dt (75mm)</text>
        <text x="80" y="94" font-size="8" fill="#64748b" text-anchor="middle">Anchors into Confined Core</text>
      </svg>`
    },
    splice: {
      title: 'Column Lap Splice (COL-200)',
      aci: 'ACI 318-19 §10.7.5 & MNL-66',
      desc: 'Splice connecting vertical bars between floor levels. Located just above floor slab. Staggering alternates lap height by half.',
      rec: 'Class B tension lap = 1.3 ld (typically 40–50 bar diameters).',
      svg: `<svg viewBox="0 0 160 100" width="160" height="100">
        <rect x="25" y="50" width="110" height="12" fill="#cbd5e1" stroke="#64748b" stroke-width="1"/>
        <text x="140" y="59" font-size="7.5" fill="#64748b">Slab</text>
        <line x1="60" y1="88" x2="60" y2="20" stroke="#2563eb" stroke-width="3"/>
        <line x1="66" y1="50" x2="66" y2="8" stroke="#3b82f6" stroke-width="3"/>
        <line x1="75" y1="20" x2="75" y2="50" stroke="#ef4444" stroke-width="1.5"/>
        <text x="96" y="38" font-size="8.5" font-weight="700" fill="#ef4444">Llap = 1.3 ld</text>
        <text x="80" y="94" font-size="8" fill="#64748b" text-anchor="middle">Splice just above floor slab</text>
      </svg>`
    },
    lhook: {
      title: 'End Anchorage Hook',
      aci: 'ACI 318-19 §25.3.1',
      desc: '90° or 180° hook turning into roof slab or foundation footing where vertical straight development length is limited.',
      rec: 'Hook extension ≥ 12× db into core concrete.',
      svg: `<svg viewBox="0 0 160 100" width="160" height="100">
        <rect x="25" y="60" width="110" height="30" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5"/>
        <path d="M 60 10 L 60 74 A 8 8 0 0 0 68 82 L 115 82" fill="none" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round"/>
        <text x="85" y="30" font-size="9" font-weight="700" fill="#1e3a8a">L-Hook Foot</text>
        <text x="85" y="44" font-size="8" fill="#ef4444">Ext ≥ 12 db</text>
        <text x="80" y="94" font-size="8" fill="#64748b" text-anchor="middle">Turns into slab / footing</text>
      </svg>`
    }
  };

  // ------------------------------------------------------------- 2D Real-Time SVG Renderers
  function renderSectionSVG(W, D, p, nx, ny) {
    const pad = 36;
    const availW = 340 - pad * 2, availH = 260 - pad * 2;
    const scale = Math.min(availW / W, availH / D);
    const cx = 170, cy = 130;
    const rw = W * scale, rh = D * scale;
    const x0 = cx - rw / 2, y0 = cy - rh / 2;

    const isCirc = p.type === 'circular';
    const cL = p.tie.l * scale, cR = p.tie.r * scale, cT = p.tie.t * scale, cB = p.tie.b * scale;
    const tieW = Math.max(10, rw - cL - cR);
    const tieH = Math.max(10, rh - cT - cB);
    const tieX = x0 + cL, tieY = y0 + cT;
    const mainR = Math.max(3, (p.main.dia / 2) * scale);
    const tieThick = Math.max(2, p.tie.dia * scale);

    // Bars coordinates
    const bars = [];
    if (isCirc) {
      const R0 = Math.min(rw, rh) / 2;
      const rm = R0 - (p.circ.sideCover + p.circ.helixDia + p.main.dia / 2) * scale;
      const n = p.circ.mode === 'number' ? Math.max(3, Math.round(p.circ.value)) : Math.max(3, Math.ceil(360 / Math.max(p.circ.value, 1)));
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        bars.push({ x: cx + rm * Math.cos(ang), y: cy + rm * Math.sin(ang), r: mainR, tag: `Bar #${i + 1}` });
      }
    } else {
      const uL = tieX + tieThick / 2 + mainR;
      const uR = tieX + tieW - tieThick / 2 - mainR;
      const vT = tieY + tieThick / 2 + mainR;
      const vB = tieY + tieH - tieThick / 2 - mainR;

      // 4 corners
      bars.push({ x: uL, y: vT, r: mainR, tag: 'Corner Bar #1' });
      bars.push({ x: uR, y: vT, r: mainR, tag: 'Corner Bar #2' });
      bars.push({ x: uR, y: vB, r: mainR, tag: 'Corner Bar #3' });
      bars.push({ x: uL, y: vB, r: mainR, tag: 'Corner Bar #4' });

      // Intermediate X bars
      const extraX = Math.max(0, nx - 2);
      if (extraX > 0) {
        const step = (uR - uL) / (extraX + 1);
        for (let i = 1; i <= extraX; i++) {
          bars.push({ x: uL + i * step, y: vT, r: mainR, tag: `Top Face Bar` });
          bars.push({ x: uL + i * step, y: vB, r: mainR, tag: `Bottom Face Bar` });
        }
      }
      // Intermediate Y bars
      const extraY = Math.max(0, ny - 2);
      if (extraY > 0) {
        const step = (vB - vT) / (extraY + 1);
        for (let i = 1; i <= extraY; i++) {
          bars.push({ x: uL, y: vT + i * step, r: mainR, tag: `Left Face Bar` });
          bars.push({ x: uR, y: vT + i * step, r: mainR, tag: `Right Face Bar` });
        }
      }
      // Two ties middle bars
      if (p.type === 'twoties') {
        const midX = (uL + uR) / 2;
        bars.push({ x: midX, y: vT, r: mainR, tag: `Middle Bar Top` });
        bars.push({ x: midX, y: vB, r: mainR, tag: `Middle Bar Bot` });
      }
    }

    return `
      <svg class="cr-svg-canvas" viewBox="0 0 340 260" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="cr-bar-grad" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#93c5fd"/>
            <stop offset="40%" stop-color="#2563eb"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </radialGradient>
          <pattern id="cr-conc-hatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#e2e8f0" stroke-width="1.5" />
          </pattern>
        </defs>

        <!-- Concrete Outline -->
        ${isCirc
          ? `<circle cx="${cx}" cy="${cy}" r="${Math.min(rw, rh)/2}" fill="#f8fafc" stroke="#334155" stroke-width="2"/>`
          : `<rect x="${x0}" y="${y0}" width="${rw}" height="${rh}" rx="3" fill="#f8fafc" stroke="#334155" stroke-width="2"/>`
        }

        <!-- Clear Cover Boundary (dashed) -->
        ${isCirc
          ? `<circle cx="${cx}" cy="${cy}" r="${Math.min(rw, rh)/2 - p.circ.sideCover * scale}" fill="none" stroke="#94a3b8" stroke-dasharray="3,3" stroke-width="1"/>`
          : `<rect x="${tieX}" y="${tieY}" width="${tieW}" height="${tieH}" rx="5" fill="none" stroke="#94a3b8" stroke-dasharray="3,3" stroke-width="1"/>`
        }

        <!-- Primary Tie / Spiral -->
        ${isCirc
          ? `<circle cx="${cx}" cy="${cy}" r="${Math.min(rw, rh)/2 - (p.circ.sideCover + p.circ.helixDia/2)*scale}" fill="none" stroke="#2563eb" stroke-width="${Math.max(2, p.circ.helixDia * scale)}"/>`
          : `
            <rect x="${tieX}" y="${tieY}" width="${tieW}" height="${tieH}" rx="${Math.max(4, mainR + tieThick)}" fill="none" stroke="#2563eb" stroke-width="${tieThick}"/>
            <!-- 135 deg Seismic Hook Detail in corner -->
            <path d="M ${tieX + 16} ${tieY} L ${tieX + 4} ${tieY + 16} L ${tieX + 24} ${tieY + 28}" fill="none" stroke="#2563eb" stroke-width="${tieThick}" stroke-linecap="round"/>
          `
        }

        <!-- Two Ties Secondary Loop -->
        ${p.type === 'twoties' ? `
          <rect x="${tieX}" y="${tieY}" width="${tieW/2 + mainR}" height="${tieH}" rx="6" fill="none" stroke="#3b82f6" stroke-width="${tieThick}" stroke-dasharray="5,2"/>
          <rect x="${tieX + tieW/2 - mainR}" y="${tieY}" width="${tieW/2 + mainR}" height="${tieH}" rx="6" fill="none" stroke="#3b82f6" stroke-width="${tieThick}" stroke-dasharray="5,2"/>
        ` : ''}

        <!-- Longitudinal Bars -->
        ${bars.map(b => `
          <circle cx="${b.x}" cy="${b.y}" r="${b.r}" fill="url(#cr-bar-grad)" stroke="#1e3a8a" stroke-width="1">
            <title>${b.tag}: Ø${Math.round(p.main.dia * 1000)} mm</title>
          </circle>
        `).join('')}

        <!-- Dimensions -->
        <g stroke="#64748b" stroke-width="1" font-size="10" font-family="var(--font-sans)" fill="#475569">
          <!-- Top Width Dimension -->
          <line x1="${x0}" y1="${y0 - 14}" x2="${x0 + rw}" y2="${y0 - 14}"/>
          <line x1="${x0}" y1="${y0 - 18}" x2="${x0}" y2="${y0 - 10}"/>
          <line x1="${x0 + rw}" y1="${y0 - 18}" x2="${x0 + rw}" y2="${y0 - 10}"/>
          <text x="${cx}" y="${y0 - 18}" text-anchor="middle" font-weight="700" fill="#1e3a8a">${Math.round(W * 1000)} mm</text>

          <!-- Left Height Dimension -->
          <line x1="${x0 - 14}" y1="${y0}" x2="${x0 - 14}" y2="${y0 + rh}"/>
          <line x1="${x0 - 18}" y1="${y0}" x2="${x0 - 10}" y2="${y0}"/>
          <line x1="${x0 - 18}" y1="${y0 + rh}" x2="${x0 - 10}" y2="${y0 + rh}"/>
          <text x="${x0 - 18}" y="${cy}" text-anchor="middle" transform="rotate(-90 ${x0 - 18} ${cy})" font-weight="700" fill="#1e3a8a">${Math.round(D * 1000)} mm</text>
        </g>

        <!-- Callouts -->
        <text x="170" y="248" text-anchor="middle" font-size="10" font-weight="600" fill="#334155">
          ${bars.length} Longitudinal Bars · Ø${Math.round(p.main.dia * 1000)} mm · Cover: ${Math.round(p.tie.l * 1000)} mm
        </text>
      </svg>
    `;
  }

  function renderElevationSVG(W, H, p) {
    const pad = 24;
    const availH = 260 - pad * 2;
    const scaleH = availH / Math.max(H, 1);
    const colW = Math.max(45, Math.min(100, W * scaleH * 1.6));
    const colH = H * scaleH;
    const cx = 170, cy = 130;
    const x0 = cx - colW / 2, y0 = cy - colH / 2;

    const cov = Math.max(4, p.tie.l * scaleH);
    const tOff = (p.main.tOffset || 0.05) * scaleH;
    const bOff = (p.main.bOffset || 0.05) * scaleH;
    const isLHook = p.main.type === 'lshape';
    const isLap = p.main.splice && p.main.splice.mode === 'lap';
    const lapLen = Math.max(20, Math.min(80, (1.3 * 47.5 * 0.8 * p.main.dia) * scaleH));

    // Calculate tie rows
    const ties = [];
    const tSpacing = p.tie.mode === 'spacing' ? p.tie.value : (H / Math.max(p.tie.value, 1));
    const sH = Math.max(6, tSpacing * scaleH);
    const count = Math.min(60, Math.max(3, Math.floor(colH / sH)));
    for (let i = 1; i <= count; i++) {
      ties.push(y0 + i * (colH / (count + 1)));
    }

    return `
      <svg class="cr-svg-canvas" viewBox="0 0 340 260" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cr-elev-bar" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#1e3a8a"/>
            <stop offset="50%" stop-color="#3b82f6"/>
            <stop offset="100%" stop-color="#1e3a8a"/>
          </linearGradient>
        </defs>

        <!-- Floor Slabs Top / Bottom -->
        <rect x="${x0 - 30}" y="${y0 - 16}" width="${colW + 60}" height="16" fill="#e2e8f0" stroke="#64748b" stroke-width="1"/>
        <text x="${x0 + colW + 35}" y="${y0 - 4}" font-size="8" fill="#64748b">Top Slab</text>

        <rect x="${x0 - 30}" y="${y0 + colH}" width="${colW + 60}" height="16" fill="#e2e8f0" stroke="#64748b" stroke-width="1"/>
        <text x="${x0 + colW + 35}" y="${y0 + colH + 12}" font-size="8" fill="#64748b">Floor Slab</text>

        <!-- Column Concrete -->
        <rect x="${x0}" y="${y0}" width="${colW}" height="${colH}" fill="#f8fafc" stroke="#334155" stroke-width="1.5"/>

        <!-- Vertical Bars Left & Right -->
        ${isLap ? `
          <!-- Lower projecting dowel -->
          <line x1="${x0 + cov}" y1="${y0 + colH + 16}" x2="${x0 + cov}" y2="${y0 + colH - lapLen}" stroke="#2563eb" stroke-width="3"/>
          <line x1="${x0 + colW - cov}" y1="${y0 + colH + 16}" x2="${x0 + colW - cov}" y2="${y0 + colH - lapLen}" stroke="#2563eb" stroke-width="3"/>
          <!-- Upper main bar -->
          <line x1="${x0 + cov + 3}" y1="${y0 + colH}" x2="${x0 + cov + 3}" y2="${y0 + tOff}" stroke="url(#cr-elev-bar)" stroke-width="3"/>
          <line x1="${x0 + colW - cov - 3}" y1="${y0 + colH}" x2="${x0 + colW - cov - 3}" y2="${y0 + tOff}" stroke="url(#cr-elev-bar)" stroke-width="3"/>
          <!-- Splice Lap Label -->
          <line x1="${x0 + cov - 8}" y1="${y0 + colH}" x2="${x0 + cov - 8}" y2="${y0 + colH - lapLen}" stroke="#ef4444" stroke-width="1"/>
          <text x="${x0 + cov - 12}" y="${y0 + colH - lapLen/2}" font-size="7.5" fill="#ef4444" text-anchor="end">Llap</text>
        ` : isLHook ? `
          <!-- L-Hook Foot -->
          <path d="M ${x0 + cov} ${y0 + tOff} L ${x0 + cov} ${y0 + colH - bOff} A 6 6 0 0 0 ${x0 + cov + 6} ${y0 + colH - bOff + 6} L ${x0 + cov + 24} ${y0 + colH - bOff + 6}" fill="none" stroke="url(#cr-elev-bar)" stroke-width="3"/>
          <path d="M ${x0 + colW - cov} ${y0 + tOff} L ${x0 + colW - cov} ${y0 + colH - bOff} A 6 6 0 0 1 ${x0 + colW - cov - 6} ${y0 + colH - bOff + 6} L ${x0 + colW - cov - 24} ${y0 + colH - bOff + 6}" fill="none" stroke="url(#cr-elev-bar)" stroke-width="3"/>
        ` : `
          <!-- Straight Bars -->
          <line x1="${x0 + cov}" y1="${y0 + colH - bOff}" x2="${x0 + cov}" y2="${y0 + tOff}" stroke="url(#cr-elev-bar)" stroke-width="3"/>
          <line x1="${x0 + colW - cov}" y1="${y0 + colH - bOff}" x2="${x0 + colW - cov}" y2="${y0 + tOff}" stroke="url(#cr-elev-bar)" stroke-width="3"/>
        `}

        <!-- Transverse Ties -->
        ${ties.map(ty => `
          <line x1="${x0 + cov - 2}" y1="${ty}" x2="${x0 + colW - cov + 2}" y2="${ty}" stroke="#2563eb" stroke-width="1.8"/>
        `).join('')}

        <!-- Elevation Height Dimension -->
        <g stroke="#64748b" stroke-width="1" font-size="10" font-family="var(--font-sans)" fill="#475569">
          <line x1="${x0 - 18}" y1="${y0}" x2="${x0 - 18}" y2="${y0 + colH}"/>
          <line x1="${x0 - 22}" y1="${y0}" x2="${x0 - 14}" y2="${y0}"/>
          <line x1="${x0 - 22}" y1="${y0 + colH}" x2="${x0 - 14}" y2="${y0 + colH}"/>
          <text x="${x0 - 24}" y="${cy}" text-anchor="middle" transform="rotate(-90 ${x0 - 24} ${cy})" font-weight="700" fill="#1e3a8a">H = ${H.toFixed(2)} m</text>
        </g>

        <!-- Tie Spacing Note -->
        <text x="170" y="248" text-anchor="middle" font-size="10" font-weight="600" fill="#334155">
          ${ties.length} Ties @ ${p.tie.mode === 'spacing' ? Math.round(p.tie.value * 1000) + ' mm' : (p.tie.value + ' count')} · Clear H: ${H.toFixed(2)} m
        </text>
      </svg>
    `;
  }

  // ------------------------------------------------------------------ tool
  class ColumnRebarTool extends Tool {
    static id = 'rebar-column';
    activate() {
      this.fid = null;
      if (this.app.sel && this.app.sel.faces.size > 0) {
        // If 1 face is selected, check it; if multiple (e.g. solid column selected), auto-find the top/bottom face!
        for (const fid of this.app.sel.faces) {
          const f = this.app.model.faces.get(fid);
          if (!f) continue;
          const n = G.norm(G.loopNormal(this.app.model.pts(f.loop)));
          if (Math.abs(n.z) > 0.7) { this.fid = fid; break; }
        }
        if (!this.fid && this.app.sel.faces.size === 1) {
          this.fid = [...this.app.sel.faces][0];
        }
      }
      if (this.fid) this._open(); else this.status();
    }
    get hint() {
      return 'Column Reinforcement: click the TOP or BOTTOM face of a column — interactive ACI 318 multi-view cage builder.';
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

      const fr = window.Rebar.faceFrame(app.model, this.fid);
      if (!fr) {
        app.toast('Could not frame the picked face — please select a column face', true);
        return;
      }
      const colW = Math.abs(fr.u1 - fr.u0);
      const colD = Math.abs(fr.v1 - fr.v0);
      const colH = fr.depth > 0.05 ? fr.depth : 3.0;
      const Ag = colW * colD;

      // Recommended defaults
      const defCoverMm = 40; // ACI 318 Table 20.5.1.3.1
      const defMainDia = 0.0191; // #6 / 20M
      const defTieDia = 0.0095; // #3 / 10M
      // ACI 318 §10.7.6.5.2: s_max = min(b_min, 16 db, 48 dt)
      const aciMaxSpacingMm = Math.min(
        Math.round(Math.min(colW, colD) * 1000),
        Math.round(16 * defMainDia * 1000),
        Math.round(48 * defTieDia * 1000)
      );
      const defSpacingMm = Math.min(150, aciMaxSpacingMm);

      const html = `
        <div class="cr-dialog-wrap">
          <!-- LEFT PANE: Parameters & ACI Controls -->
          <div class="cr-pane-params">
            <div class="cr-header-badge">
              <span>🏛️ Section: <b>${Math.round(colW * 1000)} × ${Math.round(colD * 1000)} mm</b></span>
              <span>· Height: <b>${colH.toFixed(2)} m</b></span>
              <span>· ACI 318-19 Standard</span>
            </div>

            <!-- Tab Navigation -->
            <div class="cr-tabs">
              <button class="cr-tab active" data-tab="cage">📐 Cage &amp; Bars</button>
              <button class="cr-tab" data-tab="ties">🔄 Ties &amp; Hooks</button>
              <button class="cr-tab" data-tab="splices">⚡ Splices</button>
              <button class="cr-tab" data-tab="aci">📋 ACI Verification</button>
            </div>

            <!-- TAB 1: Cage & Longitudinal Bars -->
            <div class="cr-tab-pane" id="pane-cage">
              <div class="cr-section">
                <div class="cr-field">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">
                      Column Cage Type
                      <button class="cr-info-btn" data-cr-tip="arrangement" type="button">ⓘ</button>
                    </span>
                    <select id="cr-type" class="cr-select" style="width:180px">
                      <option value="singletie">Single Tie (Rectangular)</option>
                      <option value="twoties">Two Ties Six Bars</option>
                      <option value="multiple">Single Tie, Multiple Sets</option>
                      <option value="circular">Circular (Spiral Helix)</option>
                    </select>
                  </div>
                </div>

                <div class="cr-field" id="cr-cov-group">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">
                      Clear Concrete Cover
                      <button class="cr-info-btn" data-cr-tip="cover" type="button">ⓘ</button>
                    </span>
                    <div class="cr-input-group">
                      <input id="cr-cov-val" class="cr-input" type="number" step="5" min="20" max="150" value="${defCoverMm}" style="width:65px">
                      <span class="cr-unit">mm</span>
                    </div>
                  </div>
                  <div class="cr-chip-group">
                    <button class="cr-chip active" data-cov="40">40 mm Interior</button>
                    <button class="cr-chip" data-cov="50">50 mm Exterior</button>
                    <button class="cr-chip" data-cov="75">75 mm Ground</button>
                  </div>
                  <!-- Hidden underlying fields for individual L/R/T/B covers -->
                  <input id="ct-l" type="hidden" value="0.04">
                  <input id="ct-r" type="hidden" value="0.04">
                  <input id="ct-t" type="hidden" value="0.04">
                  <input id="ct-b" type="hidden" value="0.04">
                </div>

                <div class="cr-field" id="cr-main-dia-group">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">
                      Main Bar Size (db)
                      <button class="cr-info-btn" data-cr-tip="maindia" type="button">ⓘ</button>
                    </span>
                    <select id="cr-mdia-sel" class="cr-select" style="width:180px">
                      ${BAR_SIZES.map(b => `
                        <option value="${b.dia}" ${Math.abs(b.dia - defMainDia) < 0.002 ? 'selected' : ''}>
                          ${b.us} / ${b.metric} (${b.mm} mm)
                        </option>`).join('')}
                    </select>
                  </div>
                  <input id="cm-dia" type="hidden" value="${defMainDia}">
                </div>

                <div class="cr-field" id="cr-grid-group">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">
                      Longitudinal Bar Layout
                      <button class="cr-info-btn" data-cr-tip="arrangement" type="button">ⓘ</button>
                    </span>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <div class="cr-stepper" title="Bars along X Face (Nx)">
                        <button class="cr-step-btn" data-step-dir="-1" data-target="cr-nx-val" type="button">−</button>
                        <span id="cr-nx-val" class="cr-step-val">3</span>
                        <button class="cr-step-btn" data-step-dir="1" data-target="cr-nx-val" type="button">+</button>
                      </div>
                      <span style="font-size:11px; color:#64748b;">×</span>
                      <div class="cr-stepper" title="Bars along Y Face (Ny)">
                        <button class="cr-step-btn" data-step-dir="-1" data-target="cr-ny-val" type="button">−</button>
                        <span id="cr-ny-val" class="cr-step-val">3</span>
                        <button class="cr-step-btn" data-step-dir="1" data-target="cr-ny-val" type="button">+</button>
                      </div>
                    </div>
                  </div>
                  <div style="font-size:11px; color:#64748b; margin-top:2px;" id="cr-bar-summary">
                    8 total bars (4 corner + 4 face)
                  </div>
                </div>

                <div class="cr-field" id="cr-multi-advanced" style="display:none;">
                  <div class="cr-field-row">
                    <label style="font-size:11.5px; font-weight:600; color:#334155;">Custom X Sets</label>
                    <input id="cx-sets" class="cr-input" type="text" value="1#16+1#16" style="width:140px">
                  </div>
                  <div class="cr-field-row" style="margin-top:4px;">
                    <label style="font-size:11.5px; font-weight:600; color:#334155;">Custom Y Sets</label>
                    <input id="cy-sets" class="cr-input" type="text" value="1#16" style="width:140px">
                  </div>
                </div>

                <div class="cr-field" id="cr-circ-group" style="display:none;">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">Helix Pitch (mm)</span>
                    <input id="cc-pitch-mm" class="cr-input" type="number" step="5" min="25" max="150" value="75" style="width:70px">
                    <input id="cc-pitch" type="hidden" value="0.075">
                  </div>
                  <div class="cr-field-row" style="margin-top:4px;">
                    <span class="cr-label-wrap">Main Bar Count (min 6)</span>
                    <input id="cc-val" class="cr-input" type="number" step="1" min="6" max="32" value="6" style="width:70px">
                  </div>
                  <input id="cc-cover" type="hidden" value="0.04">
                  <input id="cc-hdia" type="hidden" value="0.0095">
                  <input id="cc-ht" type="hidden" value="0.05">
                  <input id="cc-hb" type="hidden" value="0.05">
                  <input type="radio" name="cr-circ-mode" value="number" checked style="display:none">
                </div>

                <div class="cr-field-row" style="margin-top:4px;">
                  <span class="cr-label-wrap">Top / Bottom Clear Offsets</span>
                  <div class="cr-input-group">
                    <input id="cm-t-mm" class="cr-input" type="number" step="5" value="50" style="width:55px" title="Top Offset (mm)">
                    <span class="cr-unit">/</span>
                    <input id="cm-b-mm" class="cr-input" type="number" step="5" value="50" style="width:55px" title="Bottom Offset (mm)">
                    <span class="cr-unit">mm</span>
                  </div>
                  <input id="cm-t" type="hidden" value="0.05">
                  <input id="cm-b" type="hidden" value="0.05">
                </div>
              </div>
            </div>

            <!-- TAB 2: Ties & Hooks -->
            <div class="cr-tab-pane" id="pane-ties" style="display:none;">
              <div class="cr-section">
                <div class="cr-field">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">
                      Tie Bar Size (dt)
                      <button class="cr-info-btn" data-cr-tip="tiedia" type="button">ⓘ</button>
                    </span>
                    <select id="cr-tdia-sel" class="cr-select" style="width:180px">
                      ${TIE_SIZES.map(t => `<option value="${t.dia}">${t.label}</option>`).join('')}
                    </select>
                  </div>
                  <input id="ct-dia" type="hidden" value="0.0095">
                </div>

                <div class="cr-field">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">
                      Tie Hook Detail
                      <button class="cr-info-btn" data-cr-tip="tiehook" type="button">ⓘ</button>
                    </span>
                    <select id="ct-bent" class="cr-select" style="width:180px">
                      <option value="135" selected>135° Seismic Hook (6dt tail)</option>
                      <option value="90">90° Standard Hook</option>
                    </select>
                  </div>
                  <input id="ct-bf" type="hidden" value="6">
                </div>

                <div class="cr-field">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">
                      Tie Spacing (s)
                      <button class="cr-info-btn" data-cr-tip="tiespacing" type="button">ⓘ</button>
                    </span>
                    <div class="cr-input-group">
                      <input id="cr-tval-mm" class="cr-input" type="number" step="10" min="50" max="500" value="${defSpacingMm}" style="width:65px">
                      <span class="cr-unit">mm</span>
                    </div>
                  </div>
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                    <span id="cr-aci-max-s" style="font-size:11px; color:#1d4ed8; font-weight:600;">ACI Max: ${aciMaxSpacingMm} mm</span>
                    <button id="cr-auto-s-btn" class="cr-chip" type="button">⚡ Set to ACI Max</button>
                  </div>
                  <input id="ct-val" type="hidden" value="${(defSpacingMm / 1000).toFixed(3)}">
                  <input id="ct-front" type="hidden" value="0.05">
                  <input type="radio" name="cr-tie-mode" value="spacing" checked style="display:none">
                </div>

                <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                  <label class="cr-label-wrap" style="cursor:pointer;">
                    <input type="checkbox" id="cr-confinement-chk" checked>
                    <span>Seismic Confinement Zone (ACI 318 §18.7.5)</span>
                  </label>
                  <div style="font-size:11px; color:#64748b; margin-top:2px;">
                    Denser tie spacing in end plastic hinge zones l₀ = max(h, H/6, 450 mm).
                  </div>
                </div>
              </div>
            </div>

            <!-- TAB 3: Splices & Hooks -->
            <div class="cr-tab-pane" id="pane-splices" style="display:none;">
              <div class="cr-section">
                <div class="cr-field">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">
                      Column Splice (COL-200)
                      <button class="cr-info-btn" data-cr-tip="splice" type="button">ⓘ</button>
                    </span>
                    <select id="cm-splice" class="cr-select" style="width:180px">
                      <option value="none">None (Full Height Continuous)</option>
                      <option value="lap" selected>Class B Tension Lap (1.3 ld)</option>
                      <option value="mechanical">Mechanical Sleeve Coupler</option>
                      <option value="end-bearing">End-Bearing Compression</option>
                    </select>
                  </div>
                </div>

                <div class="cr-field" id="cr-splice-options">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">Stagger Alternate Bars</span>
                    <input type="checkbox" id="cm-stagger" checked>
                  </div>
                  <div style="font-size:11px; color:#64748b;">
                    Staggers lap levels by half a lap so ≤ 50% splices at one elevation (ACI 318 §25.5).
                  </div>
                </div>

                <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">
                      Main Bar End Style
                      <button class="cr-info-btn" data-cr-tip="lhook" type="button">ⓘ</button>
                    </span>
                    <select id="cm-type" class="cr-select" style="width:140px">
                      <option value="Straight">Straight</option>
                      <option value="L-Shape">L-Shape Foot</option>
                    </select>
                  </div>
                </div>

                <div class="cr-field" id="cr-hook-sub" style="display:none;">
                  <div class="cr-field-row">
                    <span class="cr-label-wrap">Hook Direction</span>
                    <select id="ch-at" class="cr-select" style="width:140px">
                      <option>Top Inside</option><option>Top Outside</option>
                      <option>Bottom Inside</option><option>Bottom Outside</option>
                    </select>
                  </div>
                  <div class="cr-field-row" style="margin-top:4px;">
                    <span class="cr-label-wrap">Hook Extends Along</span>
                    <select id="ch-along" class="cr-select" style="width:140px">
                      <option>X axis</option><option>Y axis</option>
                    </select>
                  </div>
                  <div class="cr-field-row" style="margin-top:4px;">
                    <span class="cr-label-wrap">Hook Tail Extension</span>
                    <div class="cr-input-group">
                      <input id="ch-ext-mm" class="cr-input" type="number" step="10" value="120" style="width:65px">
                      <span class="cr-unit">mm</span>
                    </div>
                    <input id="ch-ext" type="hidden" value="0.12">
                    <input id="ch-rnd" type="hidden" value="1">
                  </div>
                </div>
              </div>
            </div>

            <!-- TAB 4: ACI Verification Checklist -->
            <div class="cr-tab-pane" id="pane-aci" style="display:none;">
              <div class="cr-section">
                <div class="cr-aci-checklist">
                  <div class="cr-check-row">
                    <span>Steel Ratio (<b>ρg = Ast / Ag</b>):</span>
                    <span id="cr-aci-rho" class="cr-metric-chip ok">1.8% OK</span>
                  </div>
                  <div style="font-size:10.5px; color:#64748b;">ACI 318 §10.6.1 requires 1.0% ≤ ρg ≤ 8.0% (practical constructability ≤ 4.0%).</div>

                  <div class="cr-check-row" style="margin-top:4px;">
                    <span>Tie Spacing (<b>s ≤ smax</b>):</span>
                    <span id="cr-aci-s" class="cr-metric-chip ok">150 ≤ 305 mm OK</span>
                  </div>
                  <div style="font-size:10.5px; color:#64748b;">ACI 318 §10.7.6.5.2 limits spacing to min(b, 16 db, 48 dt).</div>

                  <div class="cr-check-row" style="margin-top:4px;">
                    <span>Clear Bar Spacing (<b>sclear</b>):</span>
                    <span id="cr-aci-clear" class="cr-metric-chip ok">≥ 40 mm OK</span>
                  </div>

                  <div class="cr-check-row" style="margin-top:4px;">
                    <span>Min Longitudinal Bars:</span>
                    <span id="cr-aci-bars" class="cr-metric-chip ok">≥ 4 Bars OK</span>
                  </div>
                </div>

                <div style="padding:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:11.5px;">
                  <div style="font-weight:700; color:#1e3a8a; margin-bottom:4px;">📊 Weight &amp; Material Takeoff</div>
                  <div id="cr-takeoff-text" style="color:#475569; line-height:1.5;">
                    Calculating...
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- RIGHT PANE: Multi-Window Visualizer -->
          <div class="cr-pane-views">
            <!-- View Toolbar -->
            <div class="cr-view-toolbar">
              <span style="font-size:11.5px; font-weight:700; color:#1e3a8a;">👁️ Real-Time Rebar Preview</span>
              <div class="cr-view-modes">
                <button class="cr-vm-btn active" data-mode="both" title="Dual Split View">⊞ Dual View</button>
                <button class="cr-vm-btn" data-mode="section" title="Cross Section View">◻ Cross Section</button>
                <button class="cr-vm-btn" data-mode="elevation" title="Elevation View">▭ Elevation</button>
              </div>
            </div>

            <!-- Multi-Window Grid -->
            <div class="cr-windows-grid" id="cr-win-grid">
              <!-- Subwindow 1: Cross-Section View -->
              <div class="cr-subwindow" id="cr-win-sec">
                <div class="cr-subwindow-head">
                  <span>Cross Section (Plan)</span>
                  <span id="cr-sec-dims" style="font-size:10.5px; color:#64748b;">${Math.round(colW * 1000)} × ${Math.round(colD * 1000)} mm</span>
                </div>
                <div class="cr-subwindow-content" id="cr-svg-sec-wrap">
                  <!-- SVG injected here -->
                </div>
              </div>

              <!-- Subwindow 2: Elevation View -->
              <div class="cr-subwindow" id="cr-win-elev">
                <div class="cr-subwindow-head">
                  <span>Longitudinal Elevation</span>
                  <span id="cr-elev-dims" style="font-size:10.5px; color:#64748b;">H = ${colH.toFixed(2)} m</span>
                </div>
                <div class="cr-subwindow-content" id="cr-svg-elev-wrap">
                  <!-- SVG injected here -->
                </div>
              </div>
            </div>

            <!-- Bottom Live Metrics Ribbon -->
            <div class="cr-metrics-ribbon">
              <div>
                <span id="cr-bar-count-badge" style="font-weight:700; color:#0f172a;">8 Main Bars · 22 Ties</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span id="cr-rho-badge" class="cr-metric-chip ok">ρ = 1.8% Ag (OK)</span>
                <span id="cr-weight-badge" style="font-weight:600; color:#475569;">Total: ~75 kg</span>
              <div id="cr-info" style="display:none;"></div>
            </div>
          </div>
        </div>
      `;

      app.dialog('Column Reinforcement — ACI 318 Interactive Multi-View Cage Generator', html, [
        ['Cancel', null],
        ['Generate Cage', () => {
          const p = this._read();
          const res = app.run('rebar column', m => {
            const r = buildColumnCage(m, this.fid, p);
            if (r && r.ids && r.ids.length) m.createGroup({ faces: new Set(r.ids), edges: new Set() }, 'Rebar · column');
            return r;
          });
          app.view.clearPreview();
          if (!res || res.error || !res.ids || !res.ids.length) {
            app.toast(res && res.error ? res.error : 'Could not build cage — check parameters', true);
            return;
          }
          app.toast(`Column cage: ${res.ties} ties + ${res.bars} main bars generated per ACI 318`);
          this.fid = null;
          this.status();
        }]
      ]);

      const dl = document.getElementById('dialog');
      if (dl) dl.classList.add('cr-dialog-active');

      // ------------------------------------------------------------- Tooltip Popover Setup
      let tooltipEl = document.getElementById('cr-tooltip');
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'cr-tooltip';
        tooltipEl.className = 'cr-tooltip-popover';
        document.body.appendChild(tooltipEl);
      }

      const showTip = (key, targetEl) => {
        const data = TOOLTIPS[key];
        if (!data || !tooltipEl) return;
        tooltipEl.innerHTML = `
          <div class="cr-tt-header">
            <span class="cr-tt-title">${data.title}</span>
            <span class="cr-tt-aci">${data.aci}</span>
          </div>
          <div class="cr-tt-svg">${data.svg}</div>
          <div class="cr-tt-desc">${data.desc}</div>
          <div class="cr-tt-rec">${data.rec}</div>
        `;
        const rect = targetEl.getBoundingClientRect();
        let left = rect.right + 12;
        let top = rect.top - 20;
        if (left + 290 > window.innerWidth) {
          left = rect.left - 295;
        }
        if (top + 260 > window.innerHeight) {
          top = window.innerHeight - 270;
        }
        if (top < 10) top = 10;
        tooltipEl.style.left = `${left}px`;
        tooltipEl.style.top = `${top}px`;
        tooltipEl.classList.add('visible');
      };

      const hideTip = () => {
        if (tooltipEl) tooltipEl.classList.remove('visible');
      };

      dl.querySelectorAll('[data-cr-tip]').forEach(btn => {
        btn.addEventListener('mouseenter', () => showTip(btn.dataset.crTip, btn));
        btn.addEventListener('mouseleave', hideTip);
      });

      // ------------------------------------------------------------- Tabs Handling
      dl.querySelectorAll('.cr-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          dl.querySelectorAll('.cr-tab').forEach(t => t.classList.remove('active'));
          dl.querySelectorAll('.cr-tab-pane').forEach(p => p.style.display = 'none');
          tab.classList.add('active');
          const target = dl.querySelector(`#pane-${tab.dataset.tab}`);
          if (target) target.style.display = 'block';
        });
      });

      // ------------------------------------------------------------- View Switcher
      dl.querySelectorAll('.cr-vm-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          dl.querySelectorAll('.cr-vm-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const mode = btn.dataset.mode;
          const winSec = dl.querySelector('#cr-win-sec');
          const winElev = dl.querySelector('#cr-win-elev');
          if (mode === 'both') {
            winSec.classList.remove('hidden');
            winElev.classList.remove('hidden');
          } else if (mode === 'section') {
            winSec.classList.remove('hidden');
            winElev.classList.add('hidden');
          } else if (mode === 'elevation') {
            winSec.classList.add('hidden');
            winElev.classList.remove('hidden');
          }
        });
      });

      // ------------------------------------------------------------- Steppers for Nx and Ny
      dl.querySelectorAll('.cr-step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = el(btn.dataset.target);
          if (!target) return;
          const dir = parseInt(btn.dataset.stepDir, 10);
          let cur = parseInt(target.textContent, 10) || 2;
          cur = Math.max(2, Math.min(8, cur + dir));
          target.textContent = cur;
          syncBarSummary();
          update();
        });
      });

      const syncBarSummary = () => {
        const nx = parseInt(el('cr-nx-val')?.textContent || '2', 10);
        const ny = parseInt(el('cr-ny-val')?.textContent || '2', 10);
        const total = 4 + 2 * (nx - 2) + 2 * (ny - 2);
        const summ = el('cr-bar-summary');
        if (summ) summ.textContent = `${total} total bars (4 corner + ${total - 4} face)`;
      };

      // ------------------------------------------------------------- Quick Cover Presets
      dl.querySelectorAll('.cr-chip[data-cov]').forEach(btn => {
        btn.addEventListener('click', () => {
          dl.querySelectorAll('.cr-chip[data-cov]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const mmVal = parseFloat(btn.dataset.cov);
          el('cr-cov-val').value = mmVal;
          const mVal = mmVal / 1000;
          el('ct-l').value = mVal;
          el('ct-r').value = mVal;
          el('ct-t').value = mVal;
          el('ct-b').value = mVal;
          update();
        });
      });

      el('cr-cov-val')?.addEventListener('input', e => {
        const mVal = (parseFloat(e.target.value) || 40) / 1000;
        el('ct-l').value = mVal;
        el('ct-r').value = mVal;
        el('ct-t').value = mVal;
        el('ct-b').value = mVal;
        dl.querySelectorAll('.cr-chip[data-cov]').forEach(b => {
          b.classList.toggle('active', parseFloat(b.dataset.cov) === parseFloat(e.target.value));
        });
        update();
      });

      // ------------------------------------------------------------- Main & Tie Selectors
      el('cr-mdia-sel')?.addEventListener('change', e => {
        el('cm-dia').value = e.target.value;
        recalcAciMaxSpacing();
        update();
      });

      el('cr-tdia-sel')?.addEventListener('change', e => {
        el('ct-dia').value = e.target.value;
        recalcAciMaxSpacing();
        update();
      });

      el('cr-tval-mm')?.addEventListener('input', e => {
        el('ct-val').value = ((parseFloat(e.target.value) || 150) / 1000).toFixed(3);
        update();
      });

      el('cm-t-mm')?.addEventListener('input', e => {
        el('cm-t').value = ((parseFloat(e.target.value) || 50) / 1000).toFixed(3);
        update();
      });

      el('cm-b-mm')?.addEventListener('input', e => {
        el('cm-b').value = ((parseFloat(e.target.value) || 50) / 1000).toFixed(3);
        update();
      });

      const recalcAciMaxSpacing = () => {
        const mdia = parseFloat(el('cm-dia').value) || defMainDia;
        const tdia = parseFloat(el('ct-dia').value) || defTieDia;
        const maxS = Math.min(
          Math.round(Math.min(colW, colD) * 1000),
          Math.round(16 * mdia * 1000),
          Math.round(48 * tdia * 1000)
        );
        const maxLabel = el('cr-aci-max-s');
        if (maxLabel) maxLabel.textContent = `ACI Max: ${maxS} mm`;
        return maxS;
      };

      el('cr-auto-s-btn')?.addEventListener('click', () => {
        const maxS = recalcAciMaxSpacing();
        el('cr-tval-mm').value = maxS;
        el('ct-val').value = (maxS / 1000).toFixed(3);
        update();
      });

      // ------------------------------------------------------------- Real-Time Update Function
      const update = () => {
        const p = this._read();
        const nx = parseInt(el('cr-nx-val')?.textContent || '2', 10);
        const ny = parseInt(el('cr-ny-val')?.textContent || '2', 10);

        // 1. 3D Viewport centerlines preview
        const pv = previewCage(app.model, this.fid, p);
        app.view.clearPreview();
        for (const { pts } of pv.paths.slice(0, 400)) {
          app.view.previewLoop(pts, window.Rebar.REBAR_COLOR);
        }

        // 2. Render 2D SVG Multi-Window Viewers
        const secWrap = el('cr-svg-sec-wrap');
        if (secWrap) secWrap.innerHTML = renderSectionSVG(colW, colD, p, nx, ny);

        const elevWrap = el('cr-svg-elev-wrap');
        if (elevWrap) elevWrap.innerHTML = renderElevationSVG(colW, colH, p);

        // 3. ACI 318 Metrics Calculations
        let As = 0;
        let totalLen = 0;
        for (const q of pv.paths) {
          if (q.pts.length === 2 && q.dia >= 0.01) {
            As += Math.PI * q.dia * q.dia / 4;
          }
          for (let i = 0; i < q.pts.length - 1; i++) {
            totalLen += G.len(G.sub(q.pts[i + 1], q.pts[i]));
          }
        }
        const rho = Ag > 0 ? As / Ag : 0;
        const rhoPct = (rho * 100).toFixed(2);
        const rhoBand = rho >= 0.01 - 1e-9 && rho <= 0.04 + 1e-9;
        const rhoAcceptable = rho > 0.04 && rho <= 0.08 + 1e-9;

        // Metric badge
        const rhoBadge = el('cr-rho-badge');
        if (rhoBadge) {
          rhoBadge.textContent = `ρ = ${rhoPct}% Ag ${rhoBand ? '(ACI OK)' : rhoAcceptable ? '(Congested)' : '(OUTSIDE 1–8%!)'}`;
          rhoBadge.className = `cr-metric-chip ${rhoBand ? 'ok' : rhoAcceptable ? 'warn' : 'bad'}`;
        }

        const barCountBadge = el('cr-bar-count-badge');
        if (barCountBadge) {
          barCountBadge.textContent = `${pv.bars} Main Bars · ${pv.ties} Ties`;
        }

        // Weight estimate
        const totalWeightKg = Math.round(totalLen * 7850 * (Math.PI * p.main.dia * p.main.dia / 4) * 0.75 + totalLen * 0.25 * 7850 * (Math.PI * p.tie.dia * p.tie.dia / 4));
        const weightBadge = el('cr-weight-badge');
        if (weightBadge) weightBadge.textContent = `Total: ~${Math.max(10, totalWeightKg)} kg`;

        // ACI Checklist updates
        const aciRho = el('cr-aci-rho');
        if (aciRho) {
          aciRho.textContent = `${rhoPct}% ${rhoBand ? '✓ Compliant' : rhoAcceptable ? '⚠ Congested' : '✗ Non-Compliant'}`;
          aciRho.className = `cr-metric-chip ${rhoBand ? 'ok' : rhoAcceptable ? 'warn' : 'bad'}`;
        }

        const sMm = Math.round(p.tie.value * 1000);
        const sMax = recalcAciMaxSpacing();
        const aciS = el('cr-aci-s');
        if (aciS) {
          const sOk = sMm <= sMax;
          aciS.textContent = `${sMm} mm ${sOk ? '≤' : '>'} ${sMax} mm ${sOk ? '✓ OK' : '✗ Too Wide'}`;
          aciS.className = `cr-metric-chip ${sOk ? 'ok' : 'bad'}`;
        }

        const aciBars = el('cr-aci-bars');
        if (aciBars) {
          const bOk = pv.bars >= (p.type === 'circular' ? 6 : 4);
          aciBars.textContent = `${pv.bars} Bars ${bOk ? '✓ OK' : '✗ Min 4 Req.'}`;
          aciBars.className = `cr-metric-chip ${bOk ? 'ok' : 'bad'}`;
        }

        const takeoff = el('cr-takeoff-text');
        if (takeoff) {
          takeoff.innerHTML = `
            <div>• Main Longitudinal Steel: <b>${pv.bars}</b> bars × ${colH.toFixed(2)}m (Ø${Math.round(p.main.dia * 1000)} mm)</div>
            <div>• Transverse Ties: <b>${pv.ties}</b> hoops (Ø${Math.round(p.tie.dia * 1000)} mm @ ${sMm} mm)</div>
            <div>• Steel Density Ratio: <b>${rhoPct}%</b> of Gross Concrete Area</div>
            <div>• Total Estimated Steel Weight: <b>~${Math.max(10, totalWeightKg)} kg</b></div>
          `;
        }
        const crInfo = el('cr-info');
        if (crInfo) {
          crInfo.textContent = `${pv.bars} bars, ${pv.ties} ties, rho=${rhoPct}%`;
        }
      };

      app._onDialogClose = () => {
        hideTip();
        if (tooltipEl && tooltipEl.parentNode) tooltipEl.parentNode.removeChild(tooltipEl);
        const dl2 = document.getElementById('dialog');
        if (dl2) dl2.classList.remove('cr-dialog-active');
        app.view.clearPreview();
        app.view.setHoverFace(null);
        this.fid = null;
        this.status();
      };

      const wire = id => {
        const x = el(id);
        if (x) x.addEventListener(x.tagName === 'SELECT' || x.type === 'checkbox' ? 'change' : 'input', update);
      };

      for (const id of [
        'cr-type', 'cr-cov-val', 'cr-mdia-sel', 'cr-tdia-sel', 'ct-bent', 'cr-tval-mm',
        'cm-type', 'cm-splice', 'ch-at', 'ch-along', 'ch-ext-mm', 'cm-stagger',
        'cx-sets', 'cy-sets', 'cc-pitch-mm', 'cc-val', 'cm-t-mm', 'cm-b-mm',
        'ct-val', 'cm-dia', 'ct-dia'
      ]) wire(id);

      const ctValEl = el('ct-val');
      const tvalMmEl = el('cr-tval-mm');
      if (ctValEl && tvalMmEl) {
        ctValEl.addEventListener('input', () => {
          const v = parseFloat(ctValEl.value);
          if (!isNaN(v) && v > 0) {
            tvalMmEl.value = Math.round(v * 1000);
            update();
          }
        });
        tvalMmEl.addEventListener('input', () => {
          const v = parseFloat(tvalMmEl.value);
          if (!isNaN(v) && v > 0) {
            ctValEl.value = (v / 1000).toFixed(3);
          }
        });
      }

      el('cr-type')?.addEventListener('change', () => this._syncSections());
      el('cm-type')?.addEventListener('change', () => this._syncSections());
      this._syncSections();
      syncBarSummary();
      update();
    }

    _syncSections() {
      const t = el('cr-type')?.value || 'singletie';
      const isCirc = t === 'circular';
      const isMulti = t === 'multiple';

      if (el('cr-circ-group')) el('cr-circ-group').style.display = isCirc ? '' : 'none';
      if (el('cr-multi-advanced')) el('cr-multi-advanced').style.display = isMulti ? '' : 'none';
      if (el('cr-grid-group')) el('cr-grid-group').style.display = (isCirc || isMulti) ? 'none' : '';
      if (el('cr-hook-sub')) el('cr-hook-sub').style.display = el('cm-type')?.value === 'L-Shape' ? '' : 'none';
    }

    _read() {
      const type = el('cr-type')?.value || 'singletie';
      const isCirc = type === 'circular';
      const mdia = parseFloat(el('cm-dia')?.value) || parseFloat(el('cr-mdia-sel')?.value) || 0.0191;
      const tdia = parseFloat(el('ct-dia')?.value) || parseFloat(el('cr-tdia-sel')?.value) || 0.0095;
      const covVal = (parseFloat(el('cr-cov-val')?.value) || 40) / 1000;
      let sVal = (parseFloat(el('cr-tval-mm')?.value) || 150) / 1000;
      const ctValInput = el('ct-val');
      if (ctValInput && ctValInput.value) {
        const parsedCt = parseFloat(ctValInput.value);
        if (!isNaN(parsedCt) && parsedCt > 0 && Math.abs(parsedCt - sVal) > 0.001) {
          sVal = parsedCt;
        }
      }

      const nx = parseInt(el('cr-nx-val')?.textContent || '3', 10);
      const ny = parseInt(el('cr-ny-val')?.textContent || '3', 10);

      let effectiveType = type;
      let xSets = [], ySets = [];
      if (type === 'singletie' && (nx > 2 || ny > 2)) {
        effectiveType = 'multiple';
        if (nx > 2) xSets = [[nx - 2, mdia]];
        if (ny > 2) ySets = [[ny - 2, mdia]];
      } else if (type === 'multiple') {
        const rawSets = txt => (txt || '').split('+').map(s => s.trim()).filter(Boolean)
          .map(s => { const [n, d] = s.split('#'); return [Math.max(0, parseInt(n, 10) || 0), (parseFloat(d) || 0) / 1000]; })
          .filter(([n, d]) => n > 0 && d > 0);
        xSets = rawSets(el('cx-sets')?.value);
        ySets = rawSets(el('cy-sets')?.value);
      }

      return {
        type: effectiveType,
        tie: {
          l: covVal, r: covVal, t: covVal, b: covVal,
          front: 0.05,
          dia: tdia,
          bentAngle: parseInt(el('ct-bent')?.value, 10) || 135,
          bentFactor: 6,
          rounding: 0,
          mode: 'spacing',
          value: sVal,
        },
        main: {
          dia: mdia,
          tOffset: (parseFloat(el('cm-t-mm')?.value) || 50) / 1000,
          bOffset: (parseFloat(el('cm-b-mm')?.value) || 50) / 1000,
          splice: {
            mode: el('cm-splice')?.value || 'none',
            stagger: el('cm-stagger')?.checked !== false
          },
          type: el('cm-type')?.value === 'L-Shape' ? 'lshape' : 'straight',
          hookAt: el('ch-at')?.value || 'Top Inside',
          along: el('ch-along')?.value === 'X axis' ? 'u' : 'v',
          extension: (parseFloat(el('ch-ext-mm')?.value) || 120) / 1000,
          rounding: 1,
        },
        xSets,
        ySets,
        circ: {
          sideCover: covVal,
          helixDia: tdia,
          pitch: (parseFloat(el('cc-pitch-mm')?.value) || 75) / 1000,
          helixTOffset: 0.05,
          helixBOffset: 0.05,
          mode: 'number',
          value: parseInt(el('cc-val')?.value, 10) || 6,
        },
      };
    }
  }

  window.ColumnRebar = { ColumnRebarTool, buildColumnCage, previewCage, verticalBar };
})();
