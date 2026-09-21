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

  /** ACI 318 special seismic tie layout along a span (positions from the
   *  start support face): first tie at `first` (2 in / 50 mm), confinement
   *  zones of 2h at each end spaced sc = min(d/4, 125 mm), the central
   *  portion at sm = d/2. Short spans whose zones overlap run at sc
   *  throughout. Returns sorted, deduped positions. */
  function seismicTiePositions(span, h, d, first = 0.05) {
    const sc = Math.max(0.02, Math.min(d / 4, 0.125));
    const sm = Math.max(sc, d / 2);
    const zone = 2 * Math.max(0.05, h);
    const out = new Set();
    const add = x => {
      if (x < first - 1e-9 || x > span - first + 1e-9) return;
      out.add(Math.round(x * 1e6) / 1e6);
    };
    // left confinement zone: first tie at `first`, stepping <= sc up to 2h
    for (let x = first; x <= Math.min(zone, span - first) + 1e-9; x += sc) add(x);
    // right confinement zone, mirrored off the far support face
    for (let x = span - first; x >= Math.max(span - zone, first) - 1e-9; x -= sc) add(x);
    // central portion at <= d/2 between the innermost zone ties
    const all = [...out].sort((a, b) => a - b);
    const rightStart = Math.min(...all.filter(v => v >= span - zone - 1e-9));
    const leftEnd = Math.max(...all.filter(v => v <= zone + 1e-9));
    const mid = rightStart - leftEnd;
    if (mid > 1e-9) {
      const n = Math.ceil(mid / sm - 1e-9); // gaps, each <= sm
      for (let i = 1; i < n; i++) add(leftEnd + mid * i / n);
    }
    return [...out].sort((a, b) => a - b);
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

  // ------------------------------------------------- ACI 25.3 bar bends
  // Longitudinal-bar bends live in the (t, z) plane: t along the span from
  // the START end face, z world-up. All bends share the standard mandrel:
  // centerline radius 3.5 db (inside diameter 6 db, bars <= 25 mm).
  /** Bent-up (cranked) bar, symmetric: 90-degree hooks DOWN at both ends at
   *  the top elevation, 45-degree cranks rising from the bottom run that
   *  starts `at` from each support face (Ln/6 typical). */
  function crankPts(L, at, zTop, zBot, ext, R) {
    const rise = Math.abs(zTop - zBot), dx = rise; // 45 degrees
    const tA = Math.max(R + 0.02, at), tB = L - tA;
    if (tB - tA - 2 * dx < 0.05) return null; // too short to crank
    return [
      { a: R, b: zTop - ext - R }, { a: R, b: zTop }, { a: tA, b: zTop },
      { a: tA + dx, b: zBot }, { a: tB - dx, b: zBot }, { a: tB, b: zTop },
      { a: L - R, b: zTop }, { a: L - R, b: zTop - ext - R },
    ];
  }

  // --------------------------------------------- ACI hook geometry
  // ACI 318-19 Table 25.3.1: hook EXTENSION = 12db for every size (used at the
  // E site below). The BM-208 6/8/10 values are BEND DIAMETER multiples by bar
  // size group (#3-8 -> 6db, #9-11 -> 8db, #14-18 -> 10db), consumed at the R
  // (bend radius) site — never as an extension.

  // --------------------------------------------------------------- BEAM
  function buildBeamRebar(m, ent, p, add, entities) {
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
    // stirrup hooks belong at the section's TOP: faceFrame's v sign flips
    // with which end face was picked, so mirror the mapping when needed -
    // frT guarantees the numerically larger v maps upward in world z
    const vUpZ = fr.map(fr.u0, fr.v1).z, vDnZ = fr.map(fr.u0, fr.v0).z;
    const frT = vUpZ >= vDnZ ? fr : {
      ...fr,
      map: (a, b) => fr.map(a, fr.v0 + fr.v1 - b),
    };

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

    // ---- MNL-66(20) BM-202 / BM-204 END SUPPORTS. The framing trim ends
    // the solid at the column face but keeps the centerline baseline, so
    // the entity pool tells us what receives each end: a COLUMN (beam bars
    // run on to the FAR SIDE of its ties and take the standard hook there)
    // or a perpendicular GIRDER (same rule into its far side). Neither =
    // a discontinuous end -> ACI 9.8.1.4 integrity hooks.
    const colPlanReach = (cp, ux, uy) => {
      const rot = +((cp || {}).rotation) || 0;
      const hw = (+cp.width || 0.3) / 2, hd = (+cp.depth || 0.3) / 2;
      const lx = [Math.cos(rot), Math.sin(rot)], ly = [-Math.sin(rot), Math.cos(rot)];
      return Math.abs(ux * lx[0] + uy * lx[1]) * hw + Math.abs(ux * ly[0] + uy * ly[1]) * hd;
    };
    const halfWebB = ((+bp.webWidth || 0) || 0.2) / 2;
    const endSupport = (P, outN) => {
      if (!Array.isArray(entities)) return null;
      let best = null;
      for (const e of entities) {
        if (!e || !e.params || e.id === ent.id) continue;
        if (e.type === 'column' && e.params.base) {
          const c = e.params.base;
          if (Math.hypot(c[0] - P.x, c[1] - P.y) > 0.75) continue;
          // the beam line must actually run INTO the box, not past its side
          const lat = Math.abs((c[0] - P.x) * -outN.y + (c[1] - P.y) * outN.x);
          if (lat > colPlanReach(e.params, -outN.y, outN.x) + halfWebB + 0.02) continue;
          const s = (c[0] - P.x) * outN.x + (c[1] - P.y) * outN.y;
          // far side of the column ties: center + reach - cover - tie dia
          const ext = s + colPlanReach(e.params, outN.x, outN.y) - 0.04 - 0.012;
          if (!best || ext > best.ext) best = { kind: 'column', ext: Math.max(ext, 0.05) };
        } else if (e.type === 'beam' && Array.isArray(e.params.baseline)) {
          const gb = e.params.baseline, gA = gb[0], gB2 = gb[gb.length - 1];
          const gx = gB2[0] - gA[0], gy = gB2[1] - gA[1], gL = Math.hypot(gx, gy) || 1;
          if (Math.abs((gx / gL) * outN.x + (gy / gL) * outN.y) > 0.5) continue; // parallel, not crossing
          const t = Math.max(0, Math.min(1, ((P.x - gA[0]) * gx + (P.y - gA[1]) * gy) / (gL * gL)));
          const Qx = gA[0] + gx * t, Qy = gA[1] + gy * t;
          if (Math.hypot(Qx - P.x, Qy - P.y) > 0.6) continue;
          const s = (Qx - P.x) * outN.x + (Qy - P.y) * outN.y;
          const ext = s + ((+e.params.webWidth || 0) || 0.2) / 2 - 0.04 - 0.012;
          if (!best || ext > best.ext) best = { kind: 'girder', ext: Math.max(ext, 0.05) };
        }
      }
      return best;
    };
    const P0 = fr.map((fr.u0 + fr.u1) / 2, (fr.v0 + fr.v1) / 2);
    const P1 = G.sub(P0, G.mul(fr.n, fr.depth));
    const supS = endSupport(P0, fr.n);            // +fr.n points out of the start face
    const supE = endSupport(P1, G.mul(fr.n, -1)); // -fr.n out of the far face

    let ties = 0, bars = 0;
    // ties along the span (stirrupPath on the section frame, copies -n)
    const rounding = (tie / 2 + mainDia / 2) / tie;
    // 135-degree seismic hooks everywhere: extension >= max(6 db, 75 mm)
    const hookFactor = Math.max(q.bentFactor || 6, 6, 0.075 / tie);
    const path = window.Rebar.stirrupPath(frT, {
      l: lCov, r: rCov, t: q.side, b: q.side, dia: tie,
      bentAngle: q.bentAngle || 135, bentFactor: hookFactor, rounding,
    });
    // tie positions along the span: ACI 318 special seismic shear when
    // armed (2h confinement zones at min(d/4, 125 mm), first tie 50 mm off
    // the support, mid-span at d/2), else uniform spacing/amount
    const hSec = Math.abs(fr.v1 - fr.v0);
    const dEff = hSec - (q.bot + tie + q.botDia / 2); // to the tension row
    let positions = q.seismic
      ? seismicTiePositions(fr.depth, hSec, dEff, (q.first || 0.05) + tie / 2) // cover to the tie SURFACE
      : (() => {
        const d = window.Rebar.distribute(fr, { mode: q.mode, value: q.value, front: q.end, dia: tie });
        return Array.from({ length: d.count }, (_, i) => d.off + i * d.step);
      })();
    // BM-203 / BM-204: through the connection zone where the developed
    // bars cross the support, tie spacing steps down to 8 in maximum
    if (!q.seismic && (supS || supE)) {
      const firstT = positions.length ? Math.min(...positions) : 0.05;
      const lastT = positions.length ? Math.max(...positions) : fr.depth - 0.05;
      const set = new Set(positions.map(t => +t.toFixed(6)));
      if (supS) for (let t = firstT + 0.203; t <= Math.min(0.6, lastT - 0.05); t += 0.203)
        set.add(+t.toFixed(6));
      if (supE) for (let t = Math.max(fr.depth - 0.6, firstT); t < lastT - 0.05; t += 0.203)
        set.add(+t.toFixed(6));
      positions = [...set].sort((a, b) => a - b);
    }
    // seismic laps ALTERNATE along the top corners (congestion relief
    // at one corner): every other tie mirrors the section frame
    const pathAlt = window.Rebar.stirrupPath({
      ...frT, map: (a, b) => frT.map(frT.u0 + frT.u1 - a, b),
    }, { l: lCov, r: rCov, t: q.side, b: q.side, dia: tie,
      bentAngle: q.bentAngle || 135, bentFactor: hookFactor, rounding });
    positions.forEach((t, i) => {
      add((i % 2 ? pathAlt : path).map(pt => G.sub(pt, G.mul(fr.n, t))), tie,
        { shape: 'stirrup', count: positions.length, spacing: q.seismic ? 'zones' : undefined });
      ties++;
    });
    // ---- MULTI-LEG RULE (ACI 300 mm): when the clear transverse distance
    // between the outer tie legs exceeds 300 mm, inner hoops wrap the
    // intermediate bars so no adjacent leg-to-leg spacing exceeds it.
    // Hoop leg lines split the outer span into cells <= 300 mm; lines pair
    // into hoops (a lone line gets a hoop centred on it).
    const legL = fr.u0 + lCov + rt, legR = fr.u1 - rCov - rt;
    const aTs = (legR - legL) - tie;
    const hoopDia = tie;
    const rH = hoopDia / 2;    if (aTs > 0.300) {
      const k = Math.ceil(aTs / 0.300);
      const s = (legR - legL) / k;
      const lines = [];
      for (let i = 1; i < k; i++) lines.push(legL + i * s);
      const pairs = [];
      for (let i = 0; i < lines.length; i += 2)
        pairs.push(lines[i + 1] != null ? [lines[i], lines[i + 1]]
          : [lines[i] - s / 2, lines[i] + s / 2]);
      // the hoop rectangle sweeps around the intermediate rows: bottom
      // leg tangent under the bottom bars, 135-degree lap hooks diving
      // inward from just above the top bars - same closed-loop stirrup
      // generator on a sub-frame of the section
      if (Math.abs(vTopBar - vBotBar) < 0.12) pairs.length = 0; // too shallow to bend hoops
      const vBotHo = vBotBar + q.botDia / 2 + rH;
      const vTopHo = vTopBar - q.topDia / 2 - rH;
      for (const [a, b] of pairs) {
        if (b - a < 4 * rH + 0.02) continue; // too narrow to bend a hoop
        // frT: larger v = world up, so v1 (the hook side) is the hoop top
        const fr2 = { n: fr.n, u: fr.u, v: fr.v,
          u0: a - rH, u1: b + rH,
          v0: Math.min(vBotHo, vTopHo) - rH, v1: Math.max(vBotHo, vTopHo) + rH,
          map: frT.map };
        const hoopPath = window.Rebar.stirrupPath(fr2, {
          l: 0, r: 0, t: 0, b: 0, dia: hoopDia,
          bentAngle: 135, bentFactor: hookFactor,
          rounding: Math.min((hoopDia / 2 + q.botDia / 2) / hoopDia, (b - a) / 2 / hoopDia),
        });
        for (const t of positions) {
          add(hoopPath.map(pt => G.sub(pt, G.mul(fr.n, t))), hoopDia,
            { shape: 'stirrup', role: 'inner-hoop', count: positions.length });
          ties++;
        }
      }
    }
    // ---- longitudinal rows: ACI 25.3 end hooks, curtailed extra bars
    // (Ln/4 top at the supports, Ln/8 bottom short of them), second-layer
    // fallback when the primary layer cannot host the bar count, and
    // symmetric 45-degree bent-up bars with hooked ends.
    const zA = q.end, zB = fr.depth - q.end;
    const Ln = Math.max(0.05, fr.depth - 2 * q.end); // clear span between supports
    // world mapping for bend polylines: (t, z), t along the span from the
    // START end face, z world-up, at transverse u on row vRow
    const bendMap = (u, vRow) => {
      const base = fr.map(u, vRow);
      // z is an OFFSET from the row plane (bends go toward the core)
      return (t, z) => G.add(G.sub(base, G.mul(fr.n, t)), G.v(0, 0, z));
    };
    const Rb = 3.5; // every bend: centerline radius 3.5 db (6 db inside dia)
    // kind1 (optional) overrides the hook at the t1 end, so a bar can run
    // e.g. a BM-202 far-side 90-degree hook into a column while its free
    // end keeps the user's choice
    const addBar = (u, vRow, dia, kind, t0, t1, toward, ret, kind1) => {
      const kEnd = kind1 || kind;
      if (t1 - t0 < 2 * Rb * dia) return; // no room to bend
      const R = Rb * dia, E = 12 * dia, map = bendMap(u, vRow);
      const hS = kind !== 'none' && t0 <= zA + 1e-9; // hooked ends
      const hE = kEnd !== 'none' && t1 >= zB - 1e-9;
      let pts2;
      if (kind === '90' || kEnd === '90') {
        // 90-degree: the vertical 12 db tail rises AT the bar tip (the tip
        // may sit past the solid face inside the support - BM-202 far-side
        // development); roundedPath bends the run into the leg
        pts2 = [
          ...(kind === '90' && hS ? [{ a: t0, b: toward * (E + R) }, { a: t0, b: 0 }] : [{ a: t0, b: 0 }]),
          ...(kEnd === '90' && hE ? [{ a: t1, b: 0 }, { a: t1, b: toward * (E + R) }] : [{ a: t1, b: 0 }]),
        ];
      } else if (kind === '180') pts2 = [
        ...(hS ? [{ a: ret, b: toward * 2 * R }, { a: 0, b: toward * 2 * R }, { a: 0, b: 0 }] : [{ a: t0, b: 0 }]),
        ...(hE ? [{ a: t1, b: 0 }, { a: t1, b: toward * 2 * R }, { a: t1 - ret, b: toward * 2 * R }] : [{ a: t1, b: 0 }]),
      ];
      else pts2 = [{ a: t0, b: 0 }, { a: t1, b: 0 }];
      const pts = window.Rebar.roundedPath(pts2, R).map(w => map(w.a, w.b));
      add(pts, dia, { shape: kind === 'none' && kEnd === 'none' ? 'straight' : 'hooked', count: 1 });
      bars++;
    };
    const topLo = web ? fr.u0 + q.side + q.topDia / 2 : uLo;
    const topHi = web ? fr.u1 - q.side - q.topDia / 2 : uHi;
    const zTopRow = fr.map(fr.u0, vTopBar).z, zBotRow = fr.map(fr.u0, vBotBar).z;
    const tTop = zTopRow >= zBotRow ? -1 : 1; // top bars bend toward the core
    const tBot = -tTop;
    // layer plan: continuous + extra in ONE layer when every clear gap
    // stays >= max(db, 25 mm); otherwise the extras stack 25 mm clear
    // toward the core in a second layer
    const layerPlan = (nCont, nExtra, dia, lo, hi) => {
      if (nExtra <= 0) return { primary: spread(nCont, lo, hi), sameLayerExtra: [], second: [] };
      const n = nCont + nExtra;
      const clear = n > 1 ? (hi - lo - n * dia) / (n - 1) : Infinity;
      if (clear >= Math.max(dia, 0.025)) {
        const all = spread(n, lo, hi);
        return { primary: all.slice(0, nCont), sameLayerExtra: all.slice(nCont), second: [] };
      }
      return { primary: spread(nCont, lo, hi), sameLayerExtra: [], second: spread(nExtra, lo, hi) };
    };
    const secondLayerV = (vRow, dia, toward) => vRow - toward * (dia + 0.025); // 25 mm clear
    // ---- ACI 9.8.1.2 integrity reinforcement: at least two continuous
    // bars top AND bottom; at a DISCONTINUOUS end they anchor with
    // standard hooks (9.8.1.4). At a supported end the continuous rows
    // develop to the FAR SIDE of the column/girder ties (BM-202/BM-204)
    // with the standard 90-degree hook there - the extension beyond the
    // solid face is exactly what the framing trim left to the far ties.
    const integ = q.integrity !== false;
    const nTopC = integ ? Math.max(2, Math.round(q.topCount || 2)) : Math.max(1, Math.round(q.topCount || 2));
    const nBotC = integ ? Math.max(2, Math.round(q.botCount || 2)) : Math.max(1, Math.round(q.botCount || 2));
    const t0C = supS ? -supS.ext : zA;
    const t1C = supE ? fr.depth + supE.ext : zB;
    const freeHook = (userHook) => integ ? '90' : (userHook || 'none');
    const topHkS = supS ? '90' : freeHook(q.topHook);
    const topHkE = supE ? '90' : freeHook(q.topHook);
    const botHkS = supS ? '90' : freeHook(q.botHook);
    const botHkE = supE ? '90' : freeHook(q.botHook);
    // TOP: continuous full span (hooked ends) + extra curtailed Ln*ratio
    // from each support face, outer end hooked like the row
    const tCut = Ln * (q.topCut != null ? q.topCut : 0.25);
    const topPlan = layerPlan(nTopC, q.topExtra || 0, q.topDia, topLo, topHi);
    for (const u of topPlan.primary)
      addBar(u, vTopBar, q.topDia, topHkS, t0C, t1C, tTop, q.hookRet || 0.4, topHkE);
    if (topPlan.second.length) {
      const v2 = secondLayerV(vTopBar, q.topDia, tTop);
      for (const u of topPlan.second)
        addBar(u, v2, q.topDia, 'none', zA + tCut, zB - tCut, tTop, 0);
    } else {
      for (const u of topPlan.sameLayerExtra) {
        addBar(u, vTopBar, q.topDia, supS ? '90' : (q.topHook || '90'),
          supS ? -supS.ext : zA, zA + tCut, tTop, q.hookRet || 0.4);
        addBar(u, vTopBar, q.topDia, 'none', zB - tCut,
          supE ? fr.depth + supE.ext : zB, tTop, 0, supE ? '90' : 'none'); // mirror segment
      }
    }
    // BOTTOM: continuous (hooked ends) + extra stopped Ln*ratio short of
    // both supports (positive-moment mid-span bars, square-cut ends)
    const bCut = Ln * (q.botCut != null ? q.botCut : 0.125);
    const botPlan = layerPlan(nBotC, q.botExtra || 0, q.botDia, uLo, uHi);
    for (const u of botPlan.primary)
      addBar(u, vBotBar, q.botDia, botHkS, t0C, t1C, tBot, q.hookRet || 0.4, botHkE);
    const bv2 = secondLayerV(vBotBar, q.botDia, tBot);
    for (const u of botPlan.second)
      addBar(u, bv2, q.botDia, 'none', zA + bCut, zB - bCut, tBot, 0);
    for (const u of botPlan.sameLayerExtra)
      addBar(u, vBotBar, q.botDia, 'none', zA + bCut, zB - bCut, tBot, 0);
    // CRANKED (bent-up) bars: symmetric, 45-degree cranks starting ~Ln/6
    // from each support face, 90-degree hooks down at the top elevation
    const crankN = Math.max(0, Math.round(q.crank || 0));
    if (crankN > 0) {
      const at = q.end + Ln * (q.crankAt || 1 / 6);
      const R = Rb * q.botDia, E = 12 * q.botDia;
      const pts2 = crankPts(fr.depth, at, Math.abs(zTopRow - zBotRow), 0, E, R);
      if (pts2) {
        const slots = spread(Math.max(2, q.botCount), uLo, uHi);
        const picked = crankN <= 2
          ? [slots[0], slots[slots.length - 1]].filter(Boolean).slice(0, crankN)
          : spread(crankN, uLo, uHi);
        for (const u of picked) {
          const map = bendMap(u, vBotBar);
          add(window.Rebar.roundedPath(pts2, R).map(w => map(w.a, w.b)), q.botDia,
            { shape: 'cranked', count: crankN });
          bars++;
        }
      }
    }
    // skin bars (ACI 9.7.2.3): AUTO when d > 0.9 m (36 in.) - both
    // faces over h/2 from the tension face at <= 0.25 m - plus any manual
    // count the user set
    const hSecBeam = Math.abs(fr.v1 - fr.v0);
    const dEffBeam = hSecBeam - q.bot - (q.botDia || 0) / 2;
    const skinAuto = dEffBeam > 0.9 ? Math.max(2, Math.ceil(Math.min(hSecBeam, 0.9) / 2 / 0.25)) : 0;
    const skinN = Math.max(Math.round(q.skin || 0), skinAuto);
    if (skinN > 0 && q.skinDia > 0) {
      const sides = [fr.u0 + q.side + tie + q.skinDia / 2, fr.u1 - q.side + 0 - tie - q.skinDia / 2];
      const gap = q.topDia / 2 + q.skinDia;
      const vHi = Math.max(vTopBar + gap, vBotBar - q.botDia / 2 - q.skinDia / 2);
      const vLo = Math.min(vTopBar + gap, vBotBar - q.botDia / 2 - q.skinDia / 2);
      for (const su of sides)
        for (const vv of spread(skinN, vLo, vHi)) {
          const P0 = fr.map(su, vv);
          add([G.sub(P0, G.mul(fr.n, zA)), G.sub(P0, G.mul(fr.n, zB))], q.skinDia,
            { shape: 'straight', count: 1 });
          bars++;
        }
    }
    return { ties, bars, supports: { start: supS ? supS.kind : 'free', end: supE ? supE.kind : 'free' } };
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
    // ACI Ch.13 footing minimum steel: As >= 0.0018 Ag per direction and
    // s <= min(3h, 450 mm) - h = the pad thickness
    {
      const fT = Math.max(0.02, fr.depth);
      const sCap = Math.min(3 * fT, 0.45);
      if (q.xMode === 'spacing') q.xValue = Math.max(0.03, Math.min(q.xValue, sCap));
      if (q.yMode === 'spacing') q.yValue = Math.max(0.03, Math.min(q.yValue, sCap));
      const needPerM = 0.0018 * fT;
      const aBar = d2 => Math.PI * d2 * d2 / 4;
      if (q.xMode === 'spacing' && aBar(q.xDia) / q.xValue < needPerM)
        q.xValue = Math.max(0.03, aBar(q.xDia) / needPerM);
      if (q.yMode === 'spacing' && aBar(q.yDia) / q.yValue < needPerM)
        q.yValue = Math.max(0.03, aBar(q.yDia) / needPerM);
    }
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
    // ACI 7.6.1 / 8.6.1: As >= 0.0018 Ag per direction and
    // s <= min(3h, 450 mm); thickness from the entity's own geometry
    let zb = zTop;
    for (const fid of (ent.faces || [])) {
      const f2 = m.faces.get(fid);
      if (!f2) continue;
      const c2 = m.faceCentroid(f2);
      if (c2 && c2.z < zb) zb = c2.z;
    }
    const slabT = Math.max(0.02, zTop - zb);
    const sCap = Math.min(3 * slabT, 0.45);
    q.xSpacing = Math.max(0.03, Math.min(q.xSpacing || 0.2, sCap));
    q.ySpacing = Math.max(0.03, Math.min(q.ySpacing || 0.2, sCap));
    const needPerM = 0.0018 * slabT; // steel area per metre of width
    const aBar = d2 => Math.PI * d2 * d2 / 4;
    if (aBar(q.yDia) / q.ySpacing < needPerM)
      q.ySpacing = Math.max(0.03, aBar(q.yDia) / needPerM);
    if (aBar(q.xDia) / q.xSpacing < needPerM)
      q.xSpacing = Math.max(0.03, aBar(q.xDia) / needPerM);
    // bottom mesh: Y layer on the cover, X layer resting on it
    alongY(q.yDia, zTop - (q.bottom + q.yDia / 2), q.ySpacing);
    alongX(q.xDia, zTop - (q.bottom + q.yDia + q.xDia / 2), q.xSpacing);
    if (q.topMesh) {
      const td = q.topDia || q.xDia;
      alongY(td, zTop - (q.top + td / 2), q.ySpacing);
      alongX(td, zTop - (q.top + td + td / 2), q.xSpacing);
    }
    // ---- SLAB-200/201: CORNER REINFORCEMENT (ACI 8.6.1.2) ----
    // Top & bottom bars extending L long/5 from each exterior corner,
    // in both X and Y directions (MNL-66 Option 2 - easier placement)
    if (q.cornerSteel !== false) {
      // L long = the longer clear span of the slab
      const lLong = Math.max(x1 - x0, y1 - y0);
      const cornerExt = lLong / 5;
      const cDia = q.cornerDia || q.xDia;
      const cr2 = cDia / 2;
      // detect convex corners from the region bounding box
      const corners = [
        { x: x0 + q.side, y: y0 + q.side, dx: 1, dy: 1 },
        { x: x1 - q.side, y: y0 + q.side, dx: -1, dy: 1 },
        { x: x0 + q.side, y: y1 - q.side, dx: 1, dy: -1 },
        { x: x1 - q.side, y: y1 - q.side, dx: -1, dy: -1 },
      ];
      for (const cn of corners) {
        // only add if the corner is in the actual region (not clipped away)
        if (!clipScanline(regions, cn.y, 0.01).some(iv => cn.x >= iv[0] && cn.x <= iv[1])) continue;
        // top layer + bottom layer
        for (const zLayer of [zTop - (q.bottom + q.yDia + q.xDia + cr2), zTop - (q.top + cr2)]) {
          // X-direction corner bars
          const nCX = Math.max(2, Math.floor(cornerExt / (q.xSpacing || 0.2)));
          for (let i2 = 0; i2 < nCX; i2++) {
            const yy = cn.y + cn.dy * i2 * (q.xSpacing || 0.2);
            const xa = cn.x, xb = cn.x + cn.dx * cornerExt;
            // clip to region
            const iv = clipScanline(regions, yy, 0.01);
            const seg = iv.find(iv2 => Math.min(xa, xb) >= iv2[0] - 0.01 && Math.max(xa, xb) <= iv2[1] + 0.01);
            if (seg) {
              if (Math.abs(xb - xa) >= 0.25) {
              add([G.v(Math.min(xa, xb), yy, zLayer),
                G.v(Math.max(xa, xb), yy, zLayer)], cDia,
                { shape: 'straight', role: 'corner', layer: 'top+bottom' });
            }
              bars++;
            }
          }
          // Y-direction corner bars
          const nCY = Math.max(2, Math.floor(cornerExt / (q.ySpacing || 0.2)));
          for (let j2 = 0; j2 < nCY; j2++) {
            const xx = cn.x + cn.dx * j2 * (q.ySpacing || 0.2);
            const ya = cn.y, yb = cn.y + cn.dy * cornerExt;
            // clip to transposed region
            const ivT = clipScanline(regions.map(rg2 => ({
              outer: rg2.outer.map(v2 => ({ x: v2.y, y: v2.x })),
              holes: (rg2.holes || []).map(h2 => h2.map(v2 => ({ x: v2.y, y: v2.x })))
            })), xx, 0.01);
            const seg = ivT.find(iv2 => Math.min(ya, yb) >= iv2[0] - 0.01 && Math.max(ya, yb) <= iv2[1] + 0.01);
            if (seg) {
              if (Math.abs(yb - ya) >= 0.25) {
              add([G.v(xx, Math.min(ya, yb), zLayer),
                G.v(xx, Math.max(ya, yb), zLayer)], cDia,
                { shape: 'straight', role: 'corner', layer: 'top+bottom' });
            }
              bars++;
            }
          }
        }
      }
    }

    // ---- SLAB-202/203: OPENING TRIM BARS ----
    // Displaced bars moved to each edge of openings, 2 min per side @ 3in O.C.
    // Top bars with standard hooks at opening edges
    if (q.trimSteel !== false) {
      const tDia = q.trimDia || q.xDia;
      const tR = tDia / 2;
      for (const rg of regions) {
        for (const hole of (rg.holes || [])) {
          if (hole.length < 3) continue;
          // bounding box of the hole
          let hx0 = 1e9, hy0 = 1e9, hx1 = -1e9, hy1 = -1e9;
          for (const v2 of hole) {
            hx0 = Math.min(hx0, v2.x); hx1 = Math.max(hx1, v2.x);
            hy0 = Math.min(hy0, v2.y); hy1 = Math.max(hy1, v2.y);
          }
          const hW = hx1 - hx0, hH = hy1 - hy0;
          if (hW < 0.05 && hH < 0.05) continue;
          // trim bars parallel to X (top and bottom of the opening)
          const nTX = Math.max(2, Math.ceil((hW) / 0.075)); // 3in = 0.075m
          const yPositions = [hy0 - q.side - tR, hy1 + q.side + tR];
          for (const yy of yPositions) {
            for (let k2 = 0; k2 < Math.min(nTX, 8); k2++) {
              const xx = hx0 + (k2 + 0.5) * hW / Math.min(nTX, 8);
              // trim bar: same length as the opening width + development each side
              const ext = Math.max(0.3, q.yDia * 20); // development length each side
              const xa = hx0 - ext, xb = hx1 + ext;
              // clip to outer region
              const iv = clipScanline(regions, yy, 0.01);
              const seg = iv.find(iv2 => xa >= iv2[0] && xb <= iv2[1]);
              if (seg) {
                if (xb - xa >= 0.25) {
                add([G.v(xa, yy, zTop - (q.bottom + q.yDia + q.xDia + tR)),
                  G.v(xb, yy, zTop - (q.bottom + q.yDia + q.xDia + tR))], tDia,
                  { shape: 'straight', role: 'trim', dir: 'x' });
              }
                bars++;
              }
            }
          }
          // trim bars parallel to Y (left and right of the opening)
          const nTY = Math.max(2, Math.ceil(hH / 0.075));
          const xPositions = [hx0 - q.side - tR, hx1 + q.side + tR];
          const tr2 = regions.map(rg2 => ({
            outer: rg2.outer.map(v2 => ({ x: v2.y, y: v2.x })),
            holes: (rg2.holes || []).map(h2 => h2.map(v2 => ({ x: v2.y, y: v2.x })))
          }));
          for (const xx of xPositions) {
            for (let k2 = 0; k2 < Math.min(nTY, 8); k2++) {
              const yy = hy0 + (k2 + 0.5) * hH / Math.min(nTY, 8);
              const ext = Math.max(0.15, 0.3);
              const ya = hy0 - ext, yb = hy1 + ext;
              const iv = clipScanline(tr2, xx, 0.01);
              const seg = iv.find(iv2 => ya >= iv2[0] && yb <= iv2[1]);
              if (seg) {
                if (yb - ya >= 0.25) {
                add([G.v(xx, ya, zTop - (q.bottom + q.yDia + q.xDia + tR)),
                  G.v(xx, yb, zTop - (q.bottom + q.yDia + q.xDia + tR))], tDia,
                  { shape: 'straight', role: 'trim', dir: 'y' });
              }
                bars++;
              }
            }
          }
        }
      }
    }

    return { bars };
  }

  // ------------------------------------------------------------- WALL
  /** Wall reinforcement (ACI 318-19 Ch.11, MNL-66 walls): vertical bars
   *  at rho >= 0.0012 Ag, horizontal at >= 0.0020 Ag, spacing capped at
   *  min(3*thickness, 450 mm), one or two curtains (each wall face). */
  function buildWallRebar(m, ent, p, add, entities) {
    const wp = ent.params || {};
    if (!wp.base || !wp.end) return { error: 'wall has no base/end run' };
    const q = p.wall;
    const t = Math.max(0.05, wp.thickness || 0.2);
    const cover = q.cover != null ? q.cover : 0.04;
    const wallHeight = Math.min(wp.height || 3, 30);
    const zBot = wp.base[2];
    const zTop = zBot + wallHeight - (q.vOff || 0.05);

    const ax = wp.base[0], ay = wp.base[1], bx = wp.end[0], by = wp.end[1];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 0.05) return { error: 'wall run is degenerate' };
    const ux = (bx - ax) / L, uy = (by - ay) / L;
    const nx = -uy, ny = ux;

    // ACI 11.6 caps + minimum ratios
    const sCap = Math.min(3 * t, 0.45);
    const aBar = d2 => Math.PI * d2 * d2 / 4;
    const needV = 0.0012 * t;
    const needH = 0.0020 * t;
    let sv = Math.min(q.vSpacing || 0.2, sCap);
    if (aBar(q.vDia) / sv < needV) sv = Math.max(0.03, aBar(q.vDia) / needV);
    let sh = Math.min(q.hSpacing || 0.2, sCap);
    if (aBar(q.hDia) / sh < needH) sh = Math.max(0.03, aBar(q.hDia) / needH);

    const off1 = cover + q.vDia / 2;
    const off2 = t - cover - q.vDia / 2;
    const curtains = q.twoCurtains ? [off1, off2] : [off1];

    // ---- MNL-66(20) WALL-206/207/208: hosted door/window/opening cuts on
    // this wall piece (stations along the run, heights from the base)
    const openings = (Array.isArray(entities) ? entities : [])
      .filter(e => e && e.params && e.params.hostWallId === ent.id
        && (e.type === 'door' || e.type === 'window' || e.type === 'opening'))
      .map(e => {
        const w = Math.max(0.1, +e.params.width || 0.9);
        const tc = Math.max(w / 2, Math.min(L - w / 2, +e.params.distanceFromStart || L / 2));
        const zo0 = zBot + Math.max(0, +e.params.sillHeight || 0);
        const zo1 = Math.min(zTop, zo0 + Math.max(0.1, +e.params.height || 1.5));
        return { s0: tc - w / 2, s1: tc + w / 2, z0: zo0, z1: zo1 };
      })
      .filter(o => o.s1 - o.s0 > 0.05 && o.z1 - o.z0 > 0.05 && o.s0 < L - 0.02 && o.s1 > 0.02);
    const inOpening = {
      s: s => openings.find(o => s > o.s0 + 1e-6 && s < o.s1 - 1e-6) || null,
      z: z => openings.find(o => z > o.z0 + 1e-6 && z < o.z1 - 1e-6) || null,
    };

    let bars = 0;
    // vertical bars along the run — a bar inside an opening splits into the
    // below and above segments (drop anything shorter than 150 mm)
    const nV = Math.max(2, Math.ceil(L / sv) + 1);
    const sV = L / (nV - 1);
    const z0 = zBot + (q.vOff || 0.05);
    for (const off of curtains)
      for (let i = 0; i < nV; i++) {
        const s = i * sV;
        const px = ax + ux * s + nx * off, py = ay + uy * s + ny * off;
        const segs = [];
        const o = inOpening.s(s);
        if (!o) segs.push([z0, zTop]);
        else segs.push([z0, o.z0], [o.z1, zTop]);
        for (const [za, zb] of segs) {
          if (zb - za < 0.15) continue;
          add([G.v(px, py, za), G.v(px, py, zb)], q.vDia,
            { shape: 'straight', dir: 'v', count: nV });
          bars++;
        }
      }
    // horizontal bars at height levels — a level inside an opening splits
    // into the left and right runs (250 mm sliver rule like the slab)
    const nH = Math.max(2, Math.ceil((zTop - z0) / sh) + 1);
    const sH = (zTop - z0) / (nH - 1);
    for (const off of curtains)
      for (let j = 0; j < nH; j++) {
        const z = z0 + j * sH;
        const segs = [];
        const o = inOpening.z(z);
        if (!o) segs.push([0, L]);
        else segs.push([0, o.s0], [o.s1, L]);
        for (const [sa, sb] of segs) {
          if (sb - sa < 0.25) continue;
          add([G.v(ax + ux * sa + nx * off, ay + uy * sa + ny * off, z),
            G.v(ax + ux * sb + nx * off, ay + uy * sb + ny * off, z)],
            q.hDia, { shape: 'straight', dir: 'h', count: nH });
          bars++;
        }
      }
    // ---- WALL-206: 2 horizontal bars at the head and sill, 2 vertical
    // bars each jamb, all running 24 in min past the opening
    const DEV = Math.max(0.61, q.vDia * 40); // 2'-0" min each side
    const clear = 0.025;
    for (const o of openings) {
      for (const off of curtains) {
        const atS = s => [ax + ux * s + nx * off, ay + uy * s + ny * off];
        const hs = Math.max(0, o.s0 - DEV), he = Math.min(L, o.s1 + DEV);
        for (let k = 0; k < 2; k++) {
          const dh = cover + q.hDia / 2 + k * (q.hDia + clear);
          const zHead = o.z1 - dh, zSill = o.z0 + dh;
          if (zHead - (o.z0 + 0.05) > 0 && zHead < zTop - 1e-6) {
            add([G.v(...atS(hs), zHead), G.v(...atS(he), zHead)], q.hDia,
              { shape: 'straight', dir: 'h', role: 'trim-h', count: 2 });
            bars++;
          }
          if (o.z0 - zBot > 0.15 && zSill > z0 + 1e-6 && zSill < o.z1 - 0.05) {
            add([G.v(...atS(hs), zSill), G.v(...atS(he), zSill)], q.hDia,
              { shape: 'straight', dir: 'h', role: 'trim-h', count: 2 });
            bars++;
          }
        }
        const vs0 = Math.max(0, o.s0 - cover - q.vDia / 2), vs1 = Math.min(L, o.s1 + cover + q.vDia / 2);
        const zv0 = Math.max(z0, o.z0 - DEV), zv1 = Math.min(zTop, o.z1 + DEV);
        for (let k = 0; k < 2; k++) {
          const dv = cover + q.vDia / 2 + k * (q.vDia + clear);
          for (const sv2 of [vs0 - dv, vs1 + dv])
            if (sv2 > 0.01 && sv2 < L - 0.01) {
              add([G.v(...atS(sv2), zv0), G.v(...atS(sv2), zv1)], q.vDia,
                { shape: 'straight', dir: 'v', role: 'trim-v', count: 2 });
              bars++;
            }
        }
        // ---- WALL-208: one 48 in diagonal bar per corner per curtain,
        // crossing the corner at 45 degrees. Where the wall is too tight
        // for the full 48 in the bar shortens to fit (MNL-208 alternates
        // hooked bars when 24 in is all that fits); under 24 in: nothing
        const dHalf = 1.219 / 2 / Math.SQRT2; // 48 in bar, 45 deg
        const zc = (o.z0 + o.z1) / 2, sc = (o.s0 + o.s1) / 2;
        for (const [sCorner, zCorner] of [[o.s0, o.z0], [o.s0, o.z1], [o.s1, o.z0], [o.s1, o.z1]]) {
          const dxs = Math.sign(sCorner - sc) || 1, dzs = Math.sign(zCorner - zc) || 1;
          let aS = sCorner - dxs * dHalf, aZ = zCorner - dzs * dHalf;
          let bS = sCorner + dxs * dHalf, bZ = zCorner + dzs * dHalf;
          aS = Math.max(0.02, Math.min(L - 0.02, aS));
          bS = Math.max(0.02, Math.min(L - 0.02, bS));
          aZ = Math.max(z0, Math.min(zTop, aZ));
          bZ = Math.max(z0, Math.min(zTop, bZ));
          if (Math.hypot(bS - aS, bZ - aZ) < 0.61) continue; // under 24 in: skip
          add([G.v(...atS(aS), aZ), G.v(...atS(bS), bZ)], q.vDia,
            { shape: 'straight', dir: 'd', role: 'diag', count: 4 });
          bars++;
        }
      }
    }
    return { bars, openings: openings.length, sv: +sV.toFixed(4), sh: +sH.toFixed(4),
      rhoV: +(aBar(q.vDia) / sV / t).toFixed(5),
      rhoH: +(aBar(q.hDia) / sH / t).toFixed(5) };
  }

  // ------------------------------------------------------------- facade
  const TYPE_OF = { beam: 'beam', column: 'column', foundation: 'foundation', footing: 'foundation', floor: 'slab', slab: 'slab', wall: 'wall' };

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
    const res = type === 'beam' ? buildBeamRebar(m, ent, p, add, entities)
      : type === 'column' ? buildColumnRebar(m, ent, p, sink)
        : type === 'foundation' ? buildFootingRebar(m, ent, p, add, entities)
          : type === 'wall' ? buildWallRebar(m, ent, p, add, entities)
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
          <div class="form-row"><label>Seismic Shear (ACI 318)</label>
            <label class="chk"><input type="checkbox" id="eb-seis" checked> first 50 mm, 2h zones @ min(d/4, 125 mm), mid @ d/2</label></div>
          <div class="form-row"><label>Top Bars</label>
            <input id="eb-topn" type="number" step="1" min="1" value="2" style="width:50px"> ×
            <input id="eb-topd" type="number" step="0.002" value="0.014" style="width:70px"> m dia</div>
          <div class="form-row"><label>Bottom Bars</label>
            <input id="eb-botn" type="number" step="1" min="1" value="3" style="width:50px"> ×
            <input id="eb-botd" type="number" step="0.002" value="0.016" style="width:70px"> m dia</div>
          <div class="form-row"><label>End Hooks T/B</label>
            <select id="eb-th" style="width:76px"><option value="none">None</option><option value="90" selected>90\u00b0</option><option value="180">180\u00b0</option></select>
            <select id="eb-bh" style="width:76px"><option value="none">None</option><option value="90" selected>90\u00b0</option><option value="180">180\u00b0</option></select></div>
          <div class="form-row"><label>Integrity 9.8</label>
            <label class="chk"><input type="checkbox" id="eb-integ" checked> 2+2 continuous bars, hooked at free ends; at columns/girders bars develop to the far side of the ties (BM-202/204)</label></div>
          <div class="form-row"><label>180\u00b0 Return m</label>
            <input id="eb-hret" type="number" step="0.05" value="0.4" style="width:70px"></div>
          <div class="form-row"><label>Extra Top (cut)</label>
            <input id="eb-topx" type="number" step="1" min="0" value="0" style="width:44px"> \u00d7 <span>Ln/</span>
            <input id="eb-topcut" type="number" step="1" value="4" style="width:44px"></div>
          <div class="form-row"><label>Extra Bottom (stop)</label>
            <input id="eb-botx" type="number" step="1" min="0" value="0" style="width:44px"> \u00d7 <span>Ln/</span>
            <input id="eb-botcut" type="number" step="1" value="8" style="width:44px"></div>
          <div class="form-row"><label>Bent-Up Bars (45\u00b0)</label>
            <input id="eb-crank" type="number" step="1" min="0" value="0" style="width:44px"> from Ln/
            <input id="eb-crankat" type="number" step="1" value="6" style="width:44px"></div>
          ${F('eb-top', 'Top Bar Cover', 0.03)}
          ${F('eb-bot', 'Bottom Bar Cover', 0.03)}
          <div class="form-row"><label>Skin Bars / side (0 = none)</label>
            <input id="eb-skin" type="number" step="1" min="0" value="0" style="width:60px">
            <input id="eb-skind" type="number" step="0.002" value="0.012" style="width:70px"> m dia</div>
          <p class="dim">Ties wrap the web (T/L beams too); top bars spread the flange on T/L. Inner hoops auto-insert when leg spacing exceeds 300 mm.</p>
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
          <div class="form-row"><label>Splice (COL-200)</label>
            <select id="ec-splice" style="width:130px"><option value="none">None</option><option value="lap" selected>Class B Lap</option><option value="mechanical">Mechanical</option><option value="end-bearing">End-Bearing</option></select></div>
          <p class="dim">Circular sections automatically get the helix cage. Need Two-Ties / Multiple / custom hooks? Use the dedicated Column Reinforcement tool.</p>
        </div>`;
      if (type === 'wall') body = `
      <div id="er-wall">
        ${F('ew-cov', 'Cover m', 0.04)}
        ${D('ew-vd', 'Vertical Bar Dia m', 0.012)}
        ${F('ew-vs', 'Vertical Spacing m', 0.2)}
        ${D('ew-hd', 'Horizontal Bar Dia m', 0.012)}
        ${F('ew-hs', 'Horizontal Spacing m', 0.2)}
        <div class="form-row"><label>Two Curtains</label>
          <label class="chk"><input type="checkbox" id="ew-2c" checked> bars at each face</label></div>
        ${F('ew-off', 'Bar Offset (top/bot) m', 0.05)}
        <p class="dim">ACI 11.6: \u03c1v \u2265 0.0012, \u03c1h \u2265 0.0020, s \u2264 min(3t, 450mm) \u2014 spacings auto-tighten.</p>
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
          <div class="form-row"><label>Corner Steel (SLAB-200)</label>
            <label class="chk"><input type="checkbox" id="es-corner" checked> auto at corners, Ln/5</label></div>
          <div class="form-row"><label>Opening Trim Bars (SLAB-202)</label>
            <label class="chk"><input type="checkbox" id="es-trim" checked> auto at openings</label></div>
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
        if (c) c.textContent = pv.error ? pv.error
          : `${pv.paths.length} bars in the cage` + (pv.supports
            ? ` \u00b7 ends: ${pv.supports.start} / ${pv.supports.end}` : '')
            + (pv.openings ? ` \u00b7 ${pv.openings} opening${pv.openings > 1 ? 's' : ''} trimmed (WALL-206/208)` : '');
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
        seismic: !!(document.getElementById('eb-seis') || {}).checked,
        integrity: (document.getElementById('eb-integ') || {}).checked !== false,
        first: 0.05,
        topCount: Math.max(1, Math.round(v('eb-topn'))), topDia: v('eb-topd'),
        botCount: Math.max(1, Math.round(v('eb-botn'))), botDia: v('eb-botd'),
        top: v('eb-top'), bot: v('eb-bot'),
        skin: Math.max(0, Math.round(v('eb-skin'))), skinDia: v('eb-skind'),
        topHook: (document.getElementById('eb-th') || {}).value || 'none',
        botHook: (document.getElementById('eb-bh') || {}).value || 'none',
        hookRet: v('eb-hret') || 0.4,
        topExtra: Math.max(0, Math.round(v('eb-topx'))),
        topCut: v('eb-topcut') > 0 ? 1 / v('eb-topcut') : 0.25,
        botExtra: Math.max(0, Math.round(v('eb-botx'))),
        botCut: v('eb-botcut') > 0 ? 1 / v('eb-botcut') : 0.125,
        crank: Math.max(0, Math.round(v('eb-crank'))),
        crankAt: v('eb-crankat') > 0 ? 1 / v('eb-crankat') : 1 / 6,
      } };
      if (type === 'column') return { type, column: {
        type: 'singletie',
        tie: { l: v('ec-cov'), r: v('ec-cov'), t: v('ec-cov'), b: v('ec-cov'),
          front: v('ec-front'), dia: v('ec-tdia'), bentAngle: 135, bentFactor: 6, rounding: 0,
          mode: (document.querySelector('input[name="er-ctie"]:checked') || {}).value || 'spacing',
          value: v('ec-tval') },
        main: { dia: v('ec-mdia'), tOffset: v('ec-t'), bOffset: v('ec-b'), type: 'straight',
          splice: { mode: (document.getElementById('ec-splice') || {}).value || 'none' } },
      } };
      if (type === 'foundation') return { type, foundation: {
        bottom: v('ef-b'), side: v('ef-side'), topLayer: (document.getElementById('ef-top') || {}).value || 'X',
        xDia: v('ef-xd'), xMode: (document.querySelector('input[name="er-fx"]:checked') || {}).value || 'spacing', xValue: v('ef-xv'),
        yDia: v('ef-yd'), yMode: (document.querySelector('input[name="er-fy"]:checked') || {}).value || 'spacing', yValue: v('ef-yv'),
        stubX: v('ef-nx'), stubY: v('ef-ny'), stubDia: v('ef-sd'),
        lap: v('ef-lap'), leg: v('ef-leg'), colW: v('ef-cw'), colL: v('ef-cl'),
      } };
      if (type === 'wall') return { type: 'wall', wall: {
      cover: v('ew-cov'), vDia: v('ew-vd'), vSpacing: v('ew-vs'),
      hDia: v('ew-hd'), hSpacing: v('ew-hs'),
      twoCurtains: !!(document.getElementById('ew-2c') || {}).checked,
      vOff: v('ew-off'),
    } };

    return { type: 'slab', slab: {
        bottom: v('es-b'), top: v('es-t'), side: v('es-side'),
        xDia: v('es-xd'), xSpacing: v('es-xs'), yDia: v('es-yd'), ySpacing: v('es-ys'),
        topMesh: !!(document.getElementById('es-top') || {}).checked, topDia: v('es-td'),
        cornerSteel: !!((document.getElementById('es-corner') || {}).checked !== undefined
          ? (document.getElementById('es-corner') || {}).checked : true),
        trimSteel: !!((document.getElementById('es-trim') || {}).checked !== undefined
          ? (document.getElementById('es-trim') || {}).checked : true),
      } };
    }
  }

  window.ElementRebar = { ElementRebarTool, buildElementRebar, previewElementRebar, buildWallRebar, seismicTiePositions, TYPE_OF };
})();
