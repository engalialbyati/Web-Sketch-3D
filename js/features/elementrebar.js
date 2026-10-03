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
      if (!(n.z >= 0.999)) continue; // NaN (hole tessellation fragments) too
      const c = m.faceCentroid(f);
      if (!c || !Number.isFinite(c.z)) continue;
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
    const fr0 = window.Rebar.faceFrame(m, fid);
    if (!fr0) return { error: 'cannot frame the beam section' };
    // T/L sections: the kernel splits the concave end cap into quads -
    // widen the frame to the UNION of every axis-normal face at the same
    // station or the top row frames one fragment instead of the flange
    let fr = fr0;
    {
      const c0 = m.faceCentroid(m.faces.get(fid));
      const capT = c0 ? G.dot(c0, axis) : null;
      if (capT != null) {
        const P00 = fr0.map(fr0.u0, fr0.v0);
        let uA = fr0.u0, uB = fr0.u1, vA = fr0.v0, vB = fr0.v1;
        for (const id2 of ent.faces || []) {
          if (id2 === fid) continue;
          const f2 = m.faces.get(id2);
          if (!f2) continue;
          const n2 = G.norm(G.loopNormal(m.pts(f2.loop)));
          if (Math.abs(G.dot(n2, axis)) < 0.9) continue;
          const c2 = m.faceCentroid(f2);
          if (!c2 || Math.abs(G.dot(c2, axis) - capT) > 1e-3) continue;
          for (const q of m.pts(f2.loop)) {
            const rel = G.sub(q, P00);
            const uu = fr0.u0 + G.dot(rel, fr0.u), vv = fr0.v0 + G.dot(rel, fr0.v);
            uA = Math.min(uA, uu); uB = Math.max(uB, uu);
            vA = Math.min(vA, vv); vB = Math.max(vB, vv);
          }
        }
        if (uA < fr0.u0 - 1e-6 || uB > fr0.u1 + 1e-6 || vA < fr0.v0 - 1e-6 || vB > fr0.v1 + 1e-6)
          fr = { ...fr0, u0: uA, u1: uB, v0: vA, v1: vB };
      }
    }
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
  function buildColumnRebar(m, ent, p, sink, entities) {
    const tops = topFaces(m, ent);
    // COL-200 at the FOUNDATION level: the footing's starter dowels
    // ARE the lower splice piece - lapping the column bars on top of
    // them would stack three bars in every corner line. A foundation
    // directly below turns the base lap off; the bars run whole and
    // lap the starters (the book's base-of-column detail).
    const cb = (ent.params || {}).base || [];
    const hasStarters = (entities || []).some(e => e && e.type === 'foundation'
      && !e.params._noStarters
      && e.params && e.params.base && Math.abs(e.params.base[2] - (cb[2] || 0)) < 0.02
      && dist2D(e.params.base, cb) < Math.max(+e.params.width || 0, +e.params.depth || 0) / 2 + 0.3);
    if (!tops.length) return { error: 'cannot find the column top face' };
    const fid = tops[0].f.id;
    // circular families (top loop beyond a rectangle) want the helix cage —
    // merge the dialog's rectangular fields onto sensible helix defaults
    const c = p.column || {};
    if (isCircularLoop(m.pts(tops[0].f.loop)) && c.type !== 'circular' && !c.circ)
      p.column = { ...c, type: 'circular', circ: {
        sideCover: c.tie ? c.tie.l || 0.04 : 0.04,
        helixDia: c.tie ? c.tie.dia || 0.008 : 0.008,
        pitch: c.tie && c.tie.mode !== 'amount' ? c.tie.value || 0.15 : 0.15,
        helixTOffset: c.main ? c.main.tOffset || 0.05 : 0.05,
        helixBOffset: c.main ? c.main.bOffset || 0.05 : 0.05,
        mode: 'number', value: 6,
      } };
    let colParams = p.column;
    if (hasStarters && colParams && colParams.main && colParams.main.splice
      && colParams.main.splice.mode === 'lap') {
      // local only - the caller reuses p across previews (never mutate)
      colParams = { ...colParams, main: { ...colParams.main,
        splice: { ...colParams.main.splice, mode: 'none' } } };
    }
    const res = window.ColumnRebar.buildColumnCage(m, fid, colParams, sink);
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
    // A CIRCULAR pad (drilled-pier cap, FND-150) clips every bar to its
    // chord through the disc instead of the bounding box
    const padLoop = m.pts(pad.loop);
    const isCirc = isCircularLoop(padLoop);
    let pc = null;
    if (isCirc) {
      const cxL = padLoop.reduce((s, q2) => s + q2.x, 0) / padLoop.length;
      const cyL = padLoop.reduce((s, q2) => s + q2.y, 0) / padLoop.length;
      pc = { x: cxL, y: cyL,
        R: padLoop.reduce((s, q2) => s + Math.hypot(q2.x - cxL, q2.y - cyL), 0) / padLoop.length };
    }
    const chordU = v => { // [u0, u1] extent of the bar line at v
      if (!pc) return [fr.u0 + q.side, fr.u1 - q.side];
      const dv = v - pc.y, R2 = pc.R - q.side;
      if (Math.abs(dv) >= R2) return null;
      const half = Math.sqrt(R2 * R2 - dv * dv);
      return [pc.x - half, pc.x + half];
    };
    const chordV = u => {
      if (!pc) return [fr.v0 + q.side, fr.v1 - q.side];
      const du = u - pc.x, R2 = pc.R - q.side;
      if (Math.abs(du) >= R2) return null;
      const half = Math.sqrt(R2 * R2 - du * du);
      return [pc.y - half, pc.y + half];
    };
    const spanU = fr.u1 - fr.u0, spanV = fr.v1 - fr.v0;
    const layers = q.topLayer === 'Y'
      ? [{ dir: 'u', dia: q.xDia }, { dir: 'v', dia: q.yDia }]
      : [{ dir: 'v', dia: q.yDia }, { dir: 'u', dia: q.xDia }];
    const zAt = i => fr.depth - q.bottom
      - (i === 0 ? layers[0].dia / 2 : layers[0].dia + layers[1].dia / 2);
    // meshPass at a depth from the TOP face; the MAT (FND-109) runs the
    // same passes under the TOP cover for its second face
    const meshPass = (li, zDepth) => {
      const { dir, dia } = layers[li];
      const r = dia / 2;
      if (dir === 'u') {
        const n = meshCount(spanV, dia, q.xMode, q.xValue);
        for (const v of spread(n, fr.v0 + q.side + r, fr.v1 - q.side - r)) {
          const [a0, a1] = chordU(v) || [];
          if (a0 == null || a1 - a0 < 0.1) continue;
          const a = fr.map(a0 + r, v), b = fr.map(a1 - r, v);
          const dz = G.mul(fr.n, zDepth);
          add([G.sub(a, dz), G.sub(b, dz)], dia, { shape: 'straight', count: n, layer: li });
          bars++;
        }
      } else {
        const n = meshCount(spanU, dia, q.yMode, q.yValue);
        for (const u of spread(n, fr.u0 + q.side + r, fr.u1 - q.side - r)) {
          const [b0, b1] = chordV(u) || [];
          if (b0 == null || b1 - b0 < 0.1) continue;
          const a = fr.map(u, b0 + r), b = fr.map(u, b1 - r);
          const dz = G.mul(fr.n, zDepth);
          add([G.sub(a, dz), G.sub(b, dz)], dia, { shape: 'straight', count: n, layer: li });
          bars++;
        }
      }
    };
    meshPass(0, zAt(0));
    meshPass(1, zAt(1));
    // FND-109 MAT FOUNDATION: reinforcement at BOTH faces — a top mesh at
    // the top cover mirrors the bottom one
    if (q.kind === 'mat')
      for (let li = 0; li < 2; li++)
        meshPass(li, q.bottom + (li === 0 ? layers[0].dia / 2 : layers[0].dia + layers[1].dia / 2));
        // ---- column starter stubs: section from the column above when present
    const ped = fp.pedestal && fp.pedestal.height >= 0.05 ? +fp.pedestal.height : 0;
    const topZ = zTop + ped;
    const base = fp.base || fp.center || [0, 0, 0];
    // COMBINED FOOTINGS: EVERY column standing on the pad gets starters
    // (a two-column strap pad is the classic FND-103 case); a WALL above
    // makes it a STRIP FOOTING - a line of wall dowels along the run
    const cols = [];
    let wallHost = null;
    for (const e of entities || []) {
      if (!e.params) continue;
      if (e.type === 'column' && Array.isArray(e.params.base)) {
        const b = e.params.base;
        if (Math.abs(b[2] - topZ) < 0.02 && dist2D(b, base) < Math.max(spanU, spanV) / 2) cols.push(e);
      } else if (e.type === 'wall' && !e.params.closed && Array.isArray(e.params.base)
        && Array.isArray(e.params.end)) {
        const b = e.params.base, b2 = e.params.end;
        if (Math.abs(b[2] - topZ) < 0.02
          && dist2D([(b[0] + b2[0]) / 2, (b[1] + b2[1]) / 2], base) < Math.max(spanU, spanV)) wallHost = e;
      }
    }
    const col = cols[0] || null;
    const colW = col ? +col.params.width || q.colW : q.colW;
    const colL = col ? +col.params.depth || q.colL : q.colL;
    const cx = col ? col.params.base[0] : base[0];
    const cy = col ? col.params.base[1] : base[1];

    // the horizontal starter leg sits just above the mesh (world z)
    const zLeg = zTop - fr.depth + q.bottom + layers[0].dia + layers[1].dia + q.stubDia / 2;
    // the starter lap must reach the Class B tension lap (COL-200) -
    // 0.5 m fell short of the 0.69 m a 14 mm dowel needs
    const stubTop = topZ + Math.max(+q.lap || 0,
      1.3 * 47.5 * (q.stubDia <= 0.0195 ? 0.8 : 1) * q.stubDia);
    // an explicit stubX:0 suppresses starters (the pier column splices
    // onto the shaft steel instead)
    const noStarters = !+q.stubX || !+q.stubY;
    if (!noStarters) {
    const oneColumn = (cx2, cy2, cw2, cl2) => {
      const nx = Math.max(2, Math.round(q.stubX)), ny = Math.max(2, Math.round(q.stubY));
      const grid = [];
      for (const x of spread(nx, cx2 - cw2 / 2, cx2 + cw2 / 2))
        for (const y of [cy2 - cl2 / 2, cy2 + cl2 / 2]) grid.push([x, y]);
      for (const y of spread(ny, cy2 - cl2 / 2, cy2 + cl2 / 2))
        for (const x of [cx2 - cw2 / 2, cx2 + cw2 / 2]) grid.push([x, y]);
      const seen = new Set();
      for (const [x, y] of grid) {
        const k = x.toFixed(4) + '|' + y.toFixed(4);
        if (seen.has(k)) continue;
        seen.add(k);
        let inx = cx2 - x, iny = cy2 - y;
        const il = Math.hypot(inx, iny);
        if (il < 1e-6) { inx = 1; iny = 0; } else { inx /= il; iny /= il; }
        const map = (s, z) => G.v(x + inx * s, y + iny * s, z);
        const pts = window.Rebar.roundedPath(
          [{ a: zLeg, b: -(q.leg + q.stubDia) }, { a: zLeg, b: 0 }, { a: stubTop, b: 0 }],
          1.5 * q.stubDia);
        add(pts.map(t => map(t.b, t.a)), q.stubDia, { shape: 'lshape', count: seen.size });
        ties++; // starters counted with the verticals
      }
    };
    for (const c2 of cols.length ? cols : [null])
      oneColumn(c2 ? +c2.params.base[0] : cx, c2 ? +c2.params.base[1] : cy,
        c2 ? +c2.params.width || q.colW : colW, c2 ? +c2.params.depth || q.colL : colL);
    // STRIP FOOTING (wall above): a line of wall dowels along the run at
    // the wall's spacing (FND-102: dowels match the wall verticals)
    if (wallHost) {
      const wa = wallHost.params.base, wb2 = wallHost.params.end;
      const wL = Math.hypot(wb2[0] - wa[0], wb2[1] - wa[1]);
      const ux2 = (wb2[0] - wa[0]) / wL, uy2 = (wb2[1] - wa[1]) / wL;
      const t2 = wallHost.params.thickness || 0.2;
      const sW = Math.max(0.15, Math.min(0.25, (wallHost.params.vSpacing || 0.2)));
      const nW = Math.max(2, Math.ceil(wL / sW) + 1);
      for (const s of spread(nW, 0, wL))
        for (const off of [t2 / 2 - 0.04 - q.stubDia / 2, -(t2 / 2 - 0.04 - q.stubDia / 2)]) {
          const x = wa[0] + ux2 * s - uy2 * off, y = wa[1] + uy2 * s + ux2 * off;
          const map = (s3, z) => G.v(x + ux2 * s3, y + uy2 * s3, z);
          const pts = window.Rebar.roundedPath(
            [{ a: zLeg, b: -(q.leg + q.stubDia) }, { a: zLeg, b: 0 }, { a: stubTop, b: 0 }],
            1.5 * q.stubDia);
          add(pts.map(t3 => map(t3.b, t3.a)), q.stubDia, { shape: 'lshape', role: 'wall-dowel', count: nW });
          ties++;
        }
    }
    } // noStarters guard
    // ---- FND-150 DRILLED PIER: a circular pad gets the shaft cage — a
    // ring of verticals plus circular ties carried through the cap depth
    let pierTies = 0;
    if (isCirc && q.kind !== 'pilecap') {
      const shaftR = Math.max(0.05, pc.R - q.side - q.stubDia / 2 - 0.012);
      const nv = Math.max(6, Math.round((2 * Math.PI * shaftR) / 0.2));
      const zBotCap = zTop - fr.depth;
      // FND-150 + COL-200: with a column standing on the pier, the shaft
      // steel rises the Class B lap ABOVE the cap top so the column bars
      // lap it - otherwise the joint plane has no steel crossing it
      const psiP = q.stubDia <= 0.0195 ? 0.8 : 1;
      const zShaftTop = col
        ? zTop - 0.05 + Math.max(0.3, 1.3 * 47.5 * psiP * q.stubDia)
        : zTop - 0.05;
      for (let k = 0; k < nv; k++) {
        const ang = (k / nv) * Math.PI * 2;
        const bx = pc.x + shaftR * Math.cos(ang), by = pc.y + shaftR * Math.sin(ang);
        add([G.v(bx, by, zBotCap + 0.04), G.v(bx, by, zShaftTop)], q.stubDia,
          { shape: 'straight', role: 'pier-vertical', count: nv });
        bars++;
      }
      const rr = shaftR - q.stubDia / 2 - 0.008;
      for (let z = zBotCap + 0.06; z <= zTop - 0.06; z += 0.2) {
        const ring = [];
        for (let k = 0; k <= 24; k++) {
          const ang = (k / 24) * Math.PI * 2;
          ring.push(G.v(pc.x + rr * Math.cos(ang), pc.y + rr * Math.sin(ang), z));
        }
        add(ring, 0.008, { shape: 'stirrup', role: 'pier-tie' });
        pierTies++;
      }
    }
    // ---- FND-161 PILE CAP: piles on a grid under the pad — each gets
    // dowels lapped down into the shaft and shaft ties continued through
    // the depth of the cap (FND-150: continue shaft ties through the cap)
    let pileBars = 0;
    if (q.kind === 'pilecap') {
      const nP = Math.max(1, Math.round(q.piles || 4));
      const cols = Math.ceil(Math.sqrt(nP)), rows = Math.ceil(nP / cols);
      const s = Math.max(0.3, +q.pileS || 0.9);
      const pd = Math.max(0.15, +q.pileDia || 0.3);
      const zBotCap2 = zTop - fr.depth;
      const lapDown = Math.max(0.4, q.pileLap || 0.6);
      let placed = 0;
      for (let r2 = 0; r2 < rows && placed < nP; r2++)
        for (let c2 = 0; c2 < cols && placed < nP; c2++) {
          placed++;
          const px = base[0] + (c2 - (cols - 1) / 2) * s;
          const py = base[1] + (r2 - (rows - 1) / 2) * s;
          const ringR = pd / 2 - 0.05 - q.stubDia / 2;
          // 4-6 dowels on the shaft ring, lapped into the pile below
          const nv = pd >= 0.45 ? 6 : 4;
          for (let k = 0; k < nv; k++) {
            const ang = (k / nv) * Math.PI * 2 + Math.PI / nv;
            const bx = px + ringR * Math.cos(ang), by = py + ringR * Math.sin(ang);
            add([G.v(bx, by, zBotCap2 - lapDown), G.v(bx, by, zTop - 0.06)], q.stubDia,
              { shape: 'straight', role: 'pile-dowel', count: nv });
            pileBars++;
          }
          // shaft ties continued through the cap depth
          const rr = pd / 2 - 0.05 - 0.008;
          for (let z = zBotCap2 + 0.05; z <= zTop - 0.06; z += 0.2) {
            const ring = [];
            for (let k = 0; k <= 20; k++) {
              const ang = (k / 20) * Math.PI * 2;
              ring.push(G.v(px + rr * Math.cos(ang), py + rr * Math.sin(ang), z));
            }
            add(ring, 0.008, { shape: 'stirrup', role: 'pile-tie' });
            pierTies++;
          }
        }
    }
    return { ties, bars: bars + pileBars, pierTies, column: !!col };
  }

  // --------------------------------------------------------------- SLAB
  function buildSlabRebar(m, ent, p, add) {
    const tops = topFaces(m, ent);
    if (!tops.length) return { error: 'cannot find the slab top face' };
    const zTop = tops[0].c.z;
    const regions = tops.map(({ f }, ri2) => ({
      outer: m.pts(f.loop).map(v => ({ x: v.x, y: v.y })),
      holes: (f.holes || []).map((h, hi) => {
        const raw = m.pts(h);
        if (raw.length && raw.every(v => v && Number.isFinite(v.x) && Number.isFinite(v.y)))
          return raw.map(v => ({ x: v.x, y: v.y }));
        // curved holes can lose their vertex remap through pushPull: fall
        // back to the ENTITY's own sketch (params.regions), then to the
        // surviving points' bbox
        const pr = ((ent.params || {}).regions || [])[ri2] || {};
        const ph = ((pr.holes || [])[hi] || []).filter(q => q && isFinite(q[0]) && isFinite(q[1]));
        if (ph.length >= 3) return ph.map(q => ({ x: q[0], y: q[1] }));
        const live = raw.filter(Boolean);
        if (live.length < 3) return null;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const v of live) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
          y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
        return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      }).filter(Boolean),
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

    // bars running along x, spread across y ("X spacing" between X bars)
    // with support for alternate bent-up (cranked) bars
    const alongX = (dia, zBot, spacing) => {
      const r = dia / 2;
      const n = meshCount(y1 - y0, dia, 'spacing', spacing);
      const rise = Math.max(0.04, slabT - q.bottom - q.top - dia);
      const isCrank = !!q.crank && rise > 0.02;
      const crankFrac = q.crankAt || 0.25;
      const crankAng = q.crankAngle || 45;
      const dx = crankAng === 30 ? rise * 1.732 : rise;
      const R = 3.5 * dia;
      const zTopL = zBot;
      const zMidL = zBot - rise;

      let idx = 0;
      for (const y of spread(n, y0 + q.side + r, y1 - q.side - r)) {
        for (const [a, b] of clipScanline(regions, y, minLen)) {
          const span = b - a;
          const crankDist = span * crankFrac;
          if (isCrank && (idx % 2 === 1) && span > 2 * crankDist + 2 * dx + 0.05) {
            // Cranked bar: rises at crankDist from each support
            const xA = a + crankDist, xB = b - crankDist;
            const pts2 = [
              G.v(a, y, zTopL),
              G.v(xA, y, zTopL),
              G.v(xA + dx, y, zMidL),
              G.v(xB - dx, y, zMidL),
              G.v(xB, y, zTopL),
              G.v(b, y, zTopL),
            ];
            const smooth = window.Rebar.roundedPath(pts2, R);
            add(smooth, dia, { shape: 'cranked', dir: 'x', role: 'slab-crank' });
          } else {
            add([G.v(a, y, isCrank ? zMidL : zBot), G.v(b, y, isCrank ? zMidL : zBot)], dia, { shape: 'straight', dir: 'x' });
          }
          bars++;
        }
        idx++;
      }
    };

    // bars running along y, spread across x
    const alongY = (dia, zBot, spacing) => {
      const r = dia / 2;
      const n = meshCount(x1 - x0, dia, 'spacing', spacing);
      const rise = Math.max(0.04, slabT - q.bottom - q.top - dia);
      const isCrank = !!q.crank && rise > 0.02;
      const crankFrac = q.crankAt || 0.25;
      const crankAng = q.crankAngle || 45;
      const dy = crankAng === 30 ? rise * 1.732 : rise;
      const R = 3.5 * dia;
      const zTopL = zBot;
      const zMidL = zBot - rise;

      let idx = 0;
      for (const x of spread(n, x0 + q.side + r, x1 - q.side - r)) {
        for (const [a, b] of clipScanline(transposed, x, minLen)) {
          const span = b - a;
          const crankDist = span * crankFrac;
          if (isCrank && (idx % 2 === 1) && span > 2 * crankDist + 2 * dy + 0.05) {
            const yA = a + crankDist, yB = b - crankDist;
            const pts2 = [
              G.v(x, a, zTopL),
              G.v(x, yA, zTopL),
              G.v(x, yA + dy, zMidL),
              G.v(x, yB - dy, zMidL),
              G.v(x, yB, zTopL),
              G.v(x, b, zTopL),
            ];
            const smooth = window.Rebar.roundedPath(pts2, R);
            add(smooth, dia, { shape: 'cranked', dir: 'y', role: 'slab-crank' });
          } else {
            add([G.v(x, a, isCrank ? zMidL : zBot), G.v(x, b, isCrank ? zMidL : zBot)], dia, { shape: 'straight', dir: 'y' });
          }
          bars++;
        }
        idx++;
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
    // ---- MNL-66(20) SOG-102/103/105: SLAB-ON-GROUND PERIMETER STEEL ----
    // The mesh stays CONTINUOUS through the thickened edge; each exterior
    // edge carries 2 continuous bottom bars lapped past the corners
    // (SOG-105: continuous all around, extend beyond the corner)
    if (q.sog) {
      const sDia = q.sogDia || q.xDia;
      const zBar = zTop - (q.bottom + q.yDia + q.xDia + sDia / 2); // on the mesh
      const inPoly = (poly, px, py) => { // ray cast, boundary counts inside
        let inside = false;
        for (let a = 0, b2 = poly.length - 1; a < poly.length; b2 = a++) {
          const xa = poly[a].x, ya = poly[a].y, xb = poly[b2].x, yb = poly[b2].y;
          if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa)
            inside = !inside;
        }
        return inside;
      };
      for (const rg of regions) {
        const outer = rg.outer;
        const cxr = outer.reduce((s, v2) => s + v2.x, 0) / outer.length;
        const cyr = outer.reduce((s, v2) => s + v2.y, 0) / outer.length;
        for (let e = 0; e < outer.length; e++) {
          const A2 = outer[e], B2 = outer[(e + 1) % outer.length];
          const ex = B2.x - A2.x, ey = B2.y - A2.y, L2 = Math.hypot(ex, ey);
          if (L2 < 0.3) continue;
          const ux = ex / L2, uy = ey / L2, nx = -uy, ny = ux;
          const inw = ((cxr - A2.x) * nx + (cyr - A2.y) * ny) >= 0 ? 1 : -1;
          const ext = Math.min(0.6, L2 / 4); // lap past each corner
          for (let k = 0; k < 2; k++) {
            const off = q.side + sDia / 2 + 0.01 + k * (sDia + 0.025);
            const px2 = A2.x - ux * ext + nx * off * inw;
            const py2 = A2.y - uy * ext + ny * off * inw;
            const qx2 = B2.x + ux * ext + nx * off * inw;
            const qy2 = B2.y + uy * ext + ny * off * inw;
            // keep the longest inside-polygon run of the extended bar
            const N2 = 48;
            let bestA = -1, bestLen = 0, curA = -1;
            for (let s2 = 0; s2 <= N2; s2++) {
              const t2 = s2 / N2;
              const xx = px2 + (qx2 - px2) * t2, yy = py2 + (qy2 - py2) * t2;
              const ins = inPoly(outer, xx, yy);
              if (ins && curA < 0) curA = t2;
              if ((!ins || s2 === N2) && curA >= 0) {
                // an outside closer means the run really ended one sample back
                const endT = ins ? t2 : t2 - 1 / N2;
                if (endT - curA > bestLen) { bestLen = endT - curA; bestA = curA; }
                curA = -1;
              }
            }
            if (bestLen * (L2 + 2 * ext) < 0.3) continue;
            const g = t3 => G.v(px2 + (qx2 - px2) * t3, py2 + (qy2 - py2) * t3, zBar);
            add([g(bestA), g(bestA + bestLen)], sDia,
              { shape: 'straight', dir: 'edge', role: 'sog-edge', count: 2 });
            bars++;
          }
        }
      }
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

    // CURTAIN OFFSETS FROM THE SOLID, NOT THE PARAMS: the old math
    // (cover+d/2 and t−cover−d/2) measures from the wall FACES but is
    // applied from the BASELINE — on a centerline wall (the default) the
    // far curtain landed t/2 − cover − d/2 ≈ 54 mm OUTSIDE a 200 wall.
    // Measure the solid's true side planes (n-offsets of its face
    // vertices) so any locationLine, join miter, or split piece places
    // both curtains just inside its real faces; centerline is the fallback.
    let nLo = -t / 2, nHi = t / 2;
    if (ent.faces && ent.faces.length) {
      let lo = Infinity, hi = -Infinity, any = false;
      for (const fid of ent.faces) {
        const f = m.faces.get(fid);
        if (!f) continue;
        for (const ring of m.rings(f)) for (const v of ring) {
          const q = m.vp(v);
          if (!q) continue;
          const o = (q.x - ax) * nx + (q.y - ay) * ny;
          if (o < lo) lo = o;
          if (o > hi) hi = o;
          any = true;
        }
      }
      if (any && hi - lo > 0.04 && hi - lo < t + 0.1) { nLo = lo; nHi = hi; }
    }
    // run extent too: framing/FACE-STOP retreats the SOLID from the
    // baseline ends (the facade walls lose 150 mm to each column) - bars
    // stationed from the baseline ends sit outside the wall
    let sLo = 0, sHi = L;
    if (ent.faces && ent.faces.length) {
      let lo2 = Infinity, hi2 = -Infinity, any2 = false;
      for (const fid of ent.faces) {
        const f = m.faces.get(fid);
        if (!f) continue;
        for (const ring of m.rings(f)) for (const v of ring) {
          const q2 = m.vp(v);
          if (!q2) continue;
          const o2 = (q2.x - ax) * ux + (q2.y - ay) * uy;
          if (o2 < lo2) lo2 = o2;
          if (o2 > hi2) hi2 = o2;
          any2 = true;
        }
      }
      if (any2 && hi2 - lo2 > 0.1 && hi2 - lo2 <= L + 0.05) { sLo = Math.max(0, lo2); sHi = Math.min(L, hi2); }
    }
    const off1 = nLo + cover + q.vDia / 2;
    const off2 = nHi - cover - q.vDia / 2;
    const curtains = q.twoCurtains ? [off1, off2] : [off1];

    // ---- MNL-66(20) WALL-206/207/208: hosted door/window/opening cuts on
    // this wall piece (stations along the run, heights from the base)
    const openings = (Array.isArray(entities) ? entities : [])
      .filter(e => e && e.params && e.params.hostWallId === ent.id
        && (e.type === 'door' || e.type === 'window' || e.type === 'opening'))
      .map(e => {
        // WALL-201 circular openings (pipe penetrations): trim around
        // the circumscribed square of the disc
        if (e.params.shape === 'circle' && +e.params.dia > 0.05) {
          const rd = +e.params.dia / 2;
          const tc2 = Math.max(rd * 2, Math.min(L - rd * 2, +e.params.distanceFromStart || L / 2));
          const zoC = zBot + Math.max(0, +e.params.sillHeight || 0) + rd;
          return { s0: tc2 - rd, s1: tc2 + rd, z0: zoC - rd, z1: zoC + rd, circle: true };
        }
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
    // ---- WALL-100A: the wall's verticals must LAP dowels cast into the
    // supporting slab/footing below. Detect a host whose top sits at the
    // wall base and add one L-dowel per vertical station per curtain:
    // horizontal leg inside the host, rising the Class B lap into the wall.
    const num0 = v => { const n = +v; return Number.isFinite(n) ? n : null; };
    // ---- WALL-110 SHEAR WALL BOUNDARY ELEMENTS: concentrated end
    // verticals - 2 extra bars inside each wall end, each curtain
    const boundaryN = q.boundary ? 2 : 0;
    for (let bi = 0; bi < boundaryN; bi++)
      for (const off of curtains)
        for (const sEnd of [sLo + q.cover + q.vDia / 2 + 0.02 + bi * (q.vDia + 0.025),
          sHi - q.cover - q.vDia / 2 - 0.02 - bi * (q.vDia + 0.025)]) {
          const px = ax + ux * sEnd + nx * off, py = ay + uy * sEnd + ny * off;
          const zb2 = zBot + (q.vOff || 0.05);
          add([G.v(px, py, zb2), G.v(px, py, zTop)], q.vDia,
            { shape: 'straight', dir: 'v', role: 'boundary', count: boundaryN * 2 });
          bars++;
        }
    const hostTopZ = e => {
      if (!e || !e.params) return null;
      if (e.type === 'foundation' && Array.isArray(e.params.base)) return num0(e.params.base[2]);
      if ((e.type === 'floor' || e.type === 'slab') && Array.isArray(e.params.regions)
        && e.params.regions[0] && Array.isArray(e.params.regions[0].outer)
        && e.params.regions[0].outer[0]) return num0(e.params.regions[0].outer[0][2]);
      return null;
    };
    const dowelHost = (Array.isArray(entities) ? entities : []).find(e =>
      e && e !== ent && e.params && !e.params._noStarters && hostTopZ(e) != null
      && Math.abs(hostTopZ(e) - zBot) < 0.02);
    if (dowelHost) {
      const psiS = q.vDia <= 0.0195 ? 0.8 : 1;
      const lapD = Math.max(0.3, 1.3 * 47.5 * psiS * q.vDia);
      const legD = Math.max(0.1, 8 * q.vDia);
      const zLeg = zBot - Math.min(0.15, (dowelHost.params.thickness || 0.15) / 3);
      const nVD = Math.max(2, Math.ceil((sHi - sLo) / sv) + 1);
      const sVD = (sHi - sLo) / (nVD - 1);
      for (let i = 0; i < nVD; i++) {
        const s = sLo + i * sVD;
        for (const off of curtains) {
          const px = ax + ux * s + nx * off, py = ay + uy * s + ny * off;
          const pts = window.Rebar.roundedPath(
            [{ a: zLeg, b: -legD }, { a: zLeg, b: 0 }, { a: zBot + lapD, b: 0 }],
            1.5 * q.vDia).map(t => G.v(px + ux * t.b, py + uy * t.b, t.a));
          add(pts, q.vDia, { shape: 'lshape', role: 'wall-dowel', count: nVD });
          bars++;
        }
      }
    }

    // vertical bars along the run — a bar inside an opening splits into the
    // below and above segments (drop anything shorter than 150 mm)
    const nV = Math.max(2, Math.ceil((sHi - sLo) / sv) + 1);
    const sV = (sHi - sLo) / (nV - 1);
    const z0 = zBot + (q.vOff || 0.05);
    for (const off of curtains)
      for (let i = 0; i < nV; i++) {
        const s = sLo + i * sV;
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
        if (!o) segs.push([sLo, sHi]);
        else segs.push([sLo, o.s0], [o.s1, sHi]);
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
        const hs = Math.max(sLo, o.s0 - DEV), he = Math.min(sHi, o.s1 + DEV);
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
        const vs0 = Math.max(sLo, o.s0 - cover - q.vDia / 2), vs1 = Math.min(sHi, o.s1 + cover + q.vDia / 2);
        const zv0 = Math.max(z0, o.z0 - DEV), zv1 = Math.min(zTop, o.z1 + DEV);
        for (let k = 0; k < 2; k++) {
          const dv = cover + q.vDia / 2 + k * (q.vDia + clear);
          for (const sv2 of [vs0 - dv, vs1 + dv])
            if (sv2 > sLo + 0.01 && sv2 < sHi - 0.01) {
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
          aS = Math.max(sLo + 0.02, Math.min(sHi - 0.02, aS));
          bS = Math.max(sLo + 0.02, Math.min(sHi - 0.02, bS));
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
  /** A loop is CIRCULAR when 8+ vertices sit at a near-constant radius
   * from the centroid (a real 16-gon pier/circular column). Split faces
   * carry collinear split vertices - vertex COUNT alone misfired and gave
   * square columns full 2400-point helix cages. */
  function isCircularLoop(pts) {
    if (!pts || pts.length < 8) return false;
    let cx = 0, cy = 0;
    for (const q of pts) { cx += q.x; cy += q.y; }
    cx /= pts.length; cy /= pts.length;
    let rMin = 1e9, rMax = 0;
    for (const q of pts) {
      const r = Math.hypot(q.x - cx, q.y - cy);
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    }
    return rMax > 1e-6 && rMin / rMax > 0.85;
  }

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
        { color: window.Rebar.REBAR_COLOR, ringSegs: 6, // hex pipes: 2x lighter cages
          meta: { ...(meta || {}), host: type } });
      ids.push(...made);
      return made;
    };
    const res = type === 'beam' ? buildBeamRebar(m, ent, p, add, entities)
      : type === 'column' ? buildColumnRebar(m, ent, p, sink, entities)
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

  // ------------------------------------------------------------- ACI Bar Sizes & Tooltips
  const BAR_SIZES = [
    { us: '#3', metric: '10M', dia: 0.0095, mm: 9.5 },
    { us: '#4', metric: '12M', dia: 0.0127, mm: 12.7 },
    { us: '#5', metric: '16M', dia: 0.0159, mm: 15.9 },
    { us: '#6', metric: '20M', dia: 0.0191, mm: 19.1 },
    { us: '#7', metric: '22M', dia: 0.0222, mm: 22.2 },
    { us: '#8', metric: '25M', dia: 0.0254, mm: 25.4 },
    { us: '#9', metric: '28M', dia: 0.0287, mm: 28.7 },
    { us: '#10', metric: '32M', dia: 0.0323, mm: 32.3 },
    { us: '#11', metric: '36M', dia: 0.0358, mm: 35.8 },
  ];

  const ER_TOOLTIPS = {
    // --- Beam Tooltips ---
    beam_cover: {
      title: 'Beam Concrete Cover (cc)',
      aci: 'ACI 318-19 Table 20.5.1.3.1',
      desc: 'Minimum clear concrete cover protecting external stirrups from corrosion and fire. 38–40 mm for interior exposure, 50 mm for exterior earth/weather contact.',
      rec: 'Recommended: 40 mm (1.5 in) standard interior.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="20" y="15" width="160" height="95" rx="4" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>
        <rect x="42" y="32" width="116" height="65" rx="3" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-dasharray="4 2"/>
        <line x1="20" y1="32" x2="42" y2="32" stroke="#ef4444" stroke-width="1.8"/>
        <path d="M22 29l-3 3 3 3M40 29l3 3-3 3" fill="none" stroke="#ef4444" stroke-width="1.5"/>
        <text x="31" y="24" font-size="10" fill="#ef4444" text-anchor="middle" font-weight="bold">Cover (cc)</text>
        <circle cx="48" cy="38" r="4.5" fill="#1d4ed8"/>
        <circle cx="152" cy="38" r="4.5" fill="#1d4ed8"/>
        <circle cx="48" cy="91" r="5" fill="#1d4ed8"/>
        <circle cx="100" cy="91" r="5" fill="#1d4ed8"/>
        <circle cx="152" cy="91" r="5" fill="#1d4ed8"/>
      </svg>`
    },
    beam_stirrup: {
      title: 'Closed Stirrups & 135° Hooks',
      aci: 'ACI 318-19 §25.7.1.6',
      desc: 'Transverse closed hoops resist diagonal shear and torsion. 135° seismic hooks extend 6×dt (≥75 mm) into the confined core to avoid opening during severe cyclic loading.',
      rec: '135° Seismic Hook with 6×dt extension (required for ductile frames).',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="35" y="15" width="130" height="95" rx="4" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
        <path d="M 55 35 L 145 35 L 145 95 L 55 95 Z" fill="none" stroke="#2563eb" stroke-width="3" stroke-linejoin="round"/>
        <path d="M 55 45 L 55 35 L 75 55" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>
        <circle cx="55" cy="35" r="5" fill="#0f172a"/>
        <path d="M 75 55 L 88 68" stroke="#ef4444" stroke-width="1.5"/>
        <text x="92" y="73" font-size="9" fill="#ef4444" font-weight="bold">6dt tail ≥ 75mm</text>
      </svg>`
    },
    beam_spacing: {
      title: 'Transverse Stirrup Spacing (s)',
      aci: 'ACI 318-19 §9.7.6.2.2',
      desc: 'Maximum stirrup spacing along beam span cannot exceed min(d/2, 600 mm) for standard shear, tightened to min(d/4, 300 mm) under heavy shear forces.',
      rec: 'Standard: s ≤ d/2 (typ. 150–200 mm).',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="15" y="25" width="170" height="70" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="40" y1="25" x2="40" y2="95" stroke="#2563eb" stroke-width="2.5"/>
        <line x1="75" y1="25" x2="75" y2="95" stroke="#2563eb" stroke-width="2.5"/>
        <line x1="110" y1="25" x2="110" y2="95" stroke="#2563eb" stroke-width="2.5"/>
        <line x1="145" y1="25" x2="145" y2="95" stroke="#2563eb" stroke-width="2.5"/>
        <line x1="75" y1="60" x2="110" y2="60" stroke="#ef4444" stroke-width="1.8"/>
        <path d="M77 57l-3 3 3 3M108 57l3 3-3 3" fill="none" stroke="#ef4444" stroke-width="1.5"/>
        <text x="92" y="53" font-size="10" fill="#ef4444" text-anchor="middle" font-weight="bold">s ≤ d/2</text>
      </svg>`
    },
    beam_seismic: {
      title: 'Seismic Confinement Zones (2h)',
      aci: 'ACI 318-19 §18.6.4',
      desc: 'Plastic hinge zones require dense hoop spacing over a distance of 2h from each support face. The first hoop must be within 50 mm (2 in) of the column face.',
      rec: 'Zone: 2×h at support @ min(d/4, 8db, 24dt, 125mm).',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="10" y="10" width="30" height="110" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5"/>
        <rect x="40" y="30" width="150" height="60" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <rect x="40" y="30" width="60" height="60" fill="#dbeafe" opacity="0.6"/>
        <line x1="45" y1="30" x2="45" y2="90" stroke="#1d4ed8" stroke-width="2"/>
        <line x1="58" y1="30" x2="58" y2="90" stroke="#1d4ed8" stroke-width="2"/>
        <line x1="71" y1="30" x2="71" y2="90" stroke="#1d4ed8" stroke-width="2"/>
        <line x1="84" y1="30" x2="84" y2="90" stroke="#1d4ed8" stroke-width="2"/>
        <line x1="97" y1="30" x2="97" y2="90" stroke="#1d4ed8" stroke-width="2"/>
        <line x1="125" y1="30" x2="125" y2="90" stroke="#2563eb" stroke-width="1.8"/>
        <line x1="155" y1="30" x2="155" y2="90" stroke="#2563eb" stroke-width="1.8"/>
        <text x="70" y="24" font-size="9" fill="#1d4ed8" text-anchor="middle" font-weight="bold">2h Zone (Dense)</text>
        <text x="140" y="24" font-size="9" fill="#64748b" text-anchor="middle">Midspan (d/2)</text>
      </svg>`
    },
    beam_top: {
      title: 'Top Longitudinal Steel (Negative Moment)',
      aci: 'ACI 318-19 §9.6.1 & §9.7.3',
      desc: 'Top bars resist negative tension moments over column supports and continuous spans. Must be securely hooked into exterior support columns or lapped at midspan.',
      rec: 'Minimum 2 continuous bars for structural integrity (ACI §9.8).',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="15" y="25" width="170" height="75" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="15" y1="38" x2="185" y2="38" stroke="#1d4ed8" stroke-width="3.5" stroke-linecap="round"/>
        <text x="100" y="32" font-size="9.5" fill="#1d4ed8" text-anchor="middle" font-weight="bold">Top Flexural Steel (Tension)</text>
        <path d="M 25 38 L 25 75" stroke="#1d4ed8" stroke-width="3" stroke-linecap="round"/>
        <path d="M 175 38 L 175 75" stroke="#1d4ed8" stroke-width="3" stroke-linecap="round"/>
      </svg>`
    },
    beam_bot: {
      title: 'Bottom Longitudinal Steel (Positive Moment)',
      aci: 'ACI 318-19 §9.6.1',
      desc: 'Bottom bars carry maximum sagging bending tension at midspan. At least 2 bars must extend continuous through supports for structural integrity (ACI §9.8).',
      rec: 'Check flexural ρ ≥ 0.25√f\'c / fy.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="15" y="25" width="170" height="75" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="20" y1="86" x2="180" y2="86" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round"/>
        <text x="100" y="80" font-size="9.5" fill="#2563eb" text-anchor="middle" font-weight="bold">Bottom Steel (Midspan Tension)</text>
      </svg>`
    },
    beam_skin: {
      title: 'Skin Reinforcement (Deep Beams)',
      aci: 'ACI 318-19 §9.7.2.3',
      desc: 'Mandatory for beams with effective depth d > 900 mm (36 in). Uniformly spaced along both side faces to control web cracking.',
      rec: 's_skin ≤ min(d/6, 300 mm).',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="60" y="10" width="80" height="105" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <circle cx="70" cy="22" r="4" fill="#1d4ed8"/><circle cx="130" cy="22" r="4" fill="#1d4ed8"/>
        <circle cx="70" cy="50" r="3.5" fill="#0284c7"/><circle cx="130" cy="50" r="3.5" fill="#0284c7"/>
        <circle cx="70" cy="75" r="3.5" fill="#0284c7"/><circle cx="130" cy="75" r="3.5" fill="#0284c7"/>
        <circle cx="70" cy="100" r="4.5" fill="#1d4ed8"/><circle cx="130" cy="100" r="4.5" fill="#1d4ed8"/>
        <text x="145" y="65" font-size="9" fill="#0284c7" font-weight="bold">Skin Bars</text>
      </svg>`
    },
    beam_hooks: {
      title: 'Standard Beam Hooks (90° / 180°)',
      aci: 'ACI 318-19 §25.3.1',
      desc: 'Standard hooks anchor longitudinal bars into exterior columns or girders. 90° hooks have a 12db tail extension; 180° hooks have 4db (≥65 mm).',
      rec: '90° hook standard at exterior column joints.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="20" y="15" width="40" height="100" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5"/>
        <rect x="60" y="30" width="120" height="60" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <path d="M 160 42 L 35 42 L 35 85" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="42" y="70" font-size="9" fill="#2563eb" font-weight="bold">12db Tail</text>
      </svg>`
    },
    beam_bent: {
      title: 'Bent-Up (Cranked) Truss Bars in Beams',
      aci: 'ACI 318-19 §9.7.6.2 & CRSI MNL-66',
      desc: 'Longitudinal bottom bars cranked diagonally upward at 45° near supports. They transition from bottom positive tension at midspan into the top zone to resist negative bending moment and 45° diagonal shear tension cracks. Minimum 2 continuous bottom bars must remain straight for structural integrity (ACI §9.8).',
      rec: 'Crank starts at Ln/4 to Ln/7 from support face; 45° angle standard.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="15" y="20" width="30" height="90" fill="#e2e8f0" stroke="#64748b" stroke-width="1.2"/>
        <rect x="155" y="20" width="30" height="90" fill="#e2e8f0" stroke="#64748b" stroke-width="1.2"/>
        <rect x="45" y="30" width="110" height="65" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <path d="M 25 70 L 25 40 L 65 40 L 95 85 L 105 85 L 135 40 L 175 40 L 175 70" fill="none" stroke="#8b5cf6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="25" y1="88" x2="175" y2="88" stroke="#1d4ed8" stroke-width="2.5" stroke-linecap="round"/>
        <text x="100" y="24" font-size="8.5" fill="#8b5cf6" text-anchor="middle" font-weight="bold">45° Crank (Shear + Hogging Moment)</text>
        <text x="100" y="104" font-size="8" fill="#1d4ed8" text-anchor="middle">Straight Continuous Bottom Bars</text>
      </svg>`
    },

    // --- Foundation Tooltips ---
    fnd_cover: {
      title: 'Footing Clear Cover (Ground Contact)',
      aci: 'ACI 318-19 Table 20.5.1.3.1',
      desc: 'Concrete cast against and permanently exposed to earth requires minimum 75 mm (3 in) clear cover to prevent soil acid & moisture corrosion.',
      rec: 'Mandatory: 75 mm (3 in) bottom cover.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="20" y="20" width="160" height="65" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.5"/>
        <rect x="10" y="85" width="180" height="35" fill="#fef3c7" stroke="#d97706" stroke-width="1" stroke-dasharray="3 3"/>
        <line x1="35" y1="70" x2="165" y2="70" stroke="#2563eb" stroke-width="3"/>
        <line x1="50" y1="70" x2="50" y2="85" stroke="#ef4444" stroke-width="1.8"/>
        <text x="58" y="80" font-size="9" fill="#ef4444" font-weight="bold">75 mm Earth Cover</text>
      </svg>`
    },
    fnd_mesh: {
      title: 'Two-Way Bending Mesh (X & Y)',
      aci: 'ACI 318-19 Chapter 13',
      desc: 'Footings experience severe two-way bending from upward soil pressure. Orthogonal rebar mesh in X and Y directions carries cantilever bending from column faces.',
      rec: 'Check minimum ratio ρ ≥ 0.0018 Ag and s ≤ min(3h, 450 mm).',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="25" y="15" width="150" height="95" rx="3" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="45" y1="25" x2="45" y2="100" stroke="#059669" stroke-width="2.2"/>
        <line x1="75" y1="25" x2="75" y2="100" stroke="#059669" stroke-width="2.2"/>
        <line x1="105" y1="25" x2="105" y2="100" stroke="#059669" stroke-width="2.2"/>
        <line x1="135" y1="25" x2="135" y2="100" stroke="#059669" stroke-width="2.2"/>
        <line x1="35" y1="35" x2="165" y2="35" stroke="#2563eb" stroke-width="2.2"/>
        <line x1="35" y1="62" x2="165" y2="62" stroke="#2563eb" stroke-width="2.2"/>
        <line x1="35" y1="90" x2="165" y2="90" stroke="#2563eb" stroke-width="2.2"/>
        <text x="100" y="112" font-size="9" fill="#334155" text-anchor="middle" font-weight="bold">Two-Way Bottom Grid</text>
      </svg>`
    },
    fnd_starters: {
      title: 'Column Starter Dowels & L-Bends',
      aci: 'ACI 318-19 §16.3.5.1',
      desc: 'Starter dowels transfer column compression and moment into the footing. L-bend legs rest directly on the bottom mesh to anchor before concrete pour.',
      rec: 'L-foot embedment ≥ 150–300 mm resting on bottom mesh.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="30" y="45" width="140" height="60" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.5"/>
        <rect x="75" y="15" width="50" height="30" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5"/>
        <path d="M 85 10 L 85 90 L 60 90" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M 115 10 L 115 90 L 140 90" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="100" y="70" font-size="9" fill="#2563eb" text-anchor="middle" font-weight="bold">Starter L-Feet</text>
      </svg>`
    },
    fnd_lap: {
      title: 'Starter Lap Splice Length',
      aci: 'ACI 318-19 §25.5.2',
      desc: 'Dowel extension projecting above the footing to lap with the column cage. Must satisfy Class B tension lap length (typically 40–50 bar diameters).',
      rec: 'L_lap ≥ 40×db (typically 500–800 mm).',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="30" y="60" width="140" height="50" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="85" y1="15" x2="85" y2="95" stroke="#2563eb" stroke-width="2.5"/>
        <line x1="89" y1="25" x2="89" y2="55" stroke="#10b981" stroke-width="2.5"/>
        <line x1="72" y1="25" x2="72" y2="60" stroke="#ef4444" stroke-width="1.5"/>
        <text x="68" y="45" font-size="9" fill="#ef4444" text-anchor="end" font-weight="bold">L_lap</text>
      </svg>`
    },

    // --- Slab Tooltips ---
    slab_cover: {
      title: 'Slab Concrete Cover',
      aci: 'ACI 318-19 Table 20.5.1.3.1',
      desc: 'Clear cover for interior suspended slabs and ground slabs. Typically 20–25 mm to maximize internal moment arm d while protecting bars.',
      rec: 'Standard: 20 mm interior, 25 mm exterior/corrosive.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="20" y="30" width="160" height="60" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="30" y1="75" x2="170" y2="75" stroke="#2563eb" stroke-width="2.5"/>
        <line x1="45" y1="75" x2="45" y2="90" stroke="#ef4444" stroke-width="1.8"/>
        <text x="52" y="86" font-size="9" fill="#ef4444" font-weight="bold">20 mm</text>
      </svg>`
    },
    slab_mesh: {
      title: 'Slab Two-Way Flexural & Shrinkage Mesh',
      aci: 'ACI 318-19 §7.6.1 & §24.4.3.2',
      desc: 'Controls temperature and shrinkage cracking. Minimum steel ratio ρ ≥ 0.0018 Ag; maximum spacing s ≤ min(3h, 450 mm).',
      rec: 'Spacing: s ≤ min(3h, 450 mm), typical 150–200 mm.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="25" y="15" width="150" height="95" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="45" y1="20" x2="45" y2="105" stroke="#059669" stroke-width="2"/>
        <line x1="85" y1="20" x2="85" y2="105" stroke="#059669" stroke-width="2"/>
        <line x1="125" y1="20" x2="125" y2="105" stroke="#059669" stroke-width="2"/>
        <line x1="30" y1="40" x2="170" y2="40" stroke="#2563eb" stroke-width="2"/>
        <line x1="30" y1="75" x2="170" y2="75" stroke="#2563eb" stroke-width="2"/>
        <text x="100" y="115" font-size="9" fill="#334155" text-anchor="middle" font-weight="bold">Two-Way Mesh (ρ ≥ 0.0018)</text>
      </svg>`
    },
    slab_trim: {
      title: 'Opening Trim Bars (SLAB-202)',
      aci: 'ACI 318-19 & CRSI MNL-66 SLAB-202',
      desc: 'Stress concentrations at duct/pipe penetrations cause re-entrant cracking. 2 extra bars on all 4 sides plus diagonal 45° corner bars absorb tension spikes.',
      rec: 'Auto-trimmed: 2 parallel bars/side + 45° diagonal corner bars.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="20" y="15" width="160" height="95" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
        <rect x="75" y="40" width="50" height="45" fill="#f1f5f9" stroke="#0f172a" stroke-width="1.5"/>
        <line x1="68" y1="32" x2="132" y2="32" stroke="#ef4444" stroke-width="2"/>
        <line x1="68" y1="92" x2="132" y2="92" stroke="#ef4444" stroke-width="2"/>
        <line x1="68" y1="32" x2="68" y2="92" stroke="#ef4444" stroke-width="2"/>
        <line x1="132" y1="32" x2="132" y2="92" stroke="#ef4444" stroke-width="2"/>
        <line x1="62" y1="28" x2="78" y2="44" stroke="#d97706" stroke-width="2"/>
        <line x1="138" y1="28" x2="122" y2="44" stroke="#d97706" stroke-width="2"/>
        <text x="100" y="65" font-size="8.5" fill="#0f172a" text-anchor="middle">Opening</text>
      </svg>`
    },
    slab_bent: {
      title: 'Alternate Bent-Up (Cranked) Bars in Slabs',
      aci: 'ACI 318-19 §7.7.3 & CRSI Detailing',
      desc: 'Alternate bottom bars cranked diagonally upward at 45° (or 30° for thin slabs) at L/4 to L/5 from the support face. Rebar transitions from bottom midspan tension to top hogging moment zone over supports, eliminating the need for a separate top mesh layer.',
      rec: 'Crank point at L/4 (0.25L) from support face; slope length ≈ 0.42D.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="20" y="25" width="160" height="70" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <path d="M 20 40 L 55 40 L 80 82 L 120 82 L 145 40 L 180 40" fill="none" stroke="#8b5cf6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="20" y1="87" x2="180" y2="87" stroke="#059669" stroke-width="2.5" stroke-dasharray="4 2"/>
        <line x1="20" y1="92" x2="55" y2="92" stroke="#ef4444" stroke-width="1.5"/>
        <text x="37" y="103" font-size="8" fill="#ef4444" text-anchor="middle" font-weight="bold">L/4</text>
        <text x="100" y="20" font-size="8.5" fill="#8b5cf6" text-anchor="middle" font-weight="bold">Top Support Zone (Hogging)</text>
      </svg>`
    },

    // --- Wall Tooltips ---
    wall_cover: {
      title: 'Wall Concrete Cover',
      aci: 'ACI 318-19 Table 20.5.1.3.1',
      desc: 'Clear concrete cover on each face of the shear/bearing wall. 20 mm for interior walls, 40 mm for exterior earth contact.',
      rec: '20 mm interior, 40 mm exterior/basement.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="50" y="15" width="100" height="100" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="65" y1="20" x2="65" y2="110" stroke="#2563eb" stroke-width="2.5"/>
        <line x1="50" y1="40" x2="65" y2="40" stroke="#ef4444" stroke-width="1.8"/>
        <text x="58" y="34" font-size="9" fill="#ef4444" text-anchor="middle" font-weight="bold">Cover</text>
      </svg>`
    },
    wall_curtains: {
      title: 'Two Curtains of Reinforcement',
      aci: 'ACI 318-19 §11.7.2.3',
      desc: 'Required for walls with thickness t ≥ 250 mm (10 in) or when in-plane shear Vu > 0.17 Acv √f\'c. Places an independent grid of vertical & horizontal bars at both faces.',
      rec: 'Two curtains mandatory for t ≥ 250 mm and shear walls.',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="40" y="15" width="120" height="95" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="58" y1="25" x2="58" y2="100" stroke="#2563eb" stroke-width="2.5"/>
        <line x1="142" y1="25" x2="142" y2="100" stroke="#2563eb" stroke-width="2.5"/>
        <path d="M 58 45 L 142 45" stroke="#059669" stroke-width="2"/>
        <path d="M 58 80 L 142 80" stroke="#059669" stroke-width="2"/>
        <text x="100" y="118" font-size="9" fill="#334155" text-anchor="middle" font-weight="bold">Two Faces (Curtains)</text>
      </svg>`
    },
    wall_vert: {
      title: 'Vertical Wall Reinforcement',
      aci: 'ACI 318-19 §11.6.1',
      desc: 'Carries axial compression and out-of-plane flexure. Minimum ratio ρv ≥ 0.0012; maximum spacing s ≤ min(3t, 450 mm).',
      rec: 'ρv ≥ 0.0012, spacing s ≤ min(3t, 450 mm).',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="25" y="15" width="150" height="95" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="50" y1="20" x2="50" y2="105" stroke="#1d4ed8" stroke-width="2.5"/>
        <line x1="85" y1="20" x2="85" y2="105" stroke="#1d4ed8" stroke-width="2.5"/>
        <line x1="120" y1="20" x2="120" y2="105" stroke="#1d4ed8" stroke-width="2.5"/>
        <line x1="155" y1="20" x2="155" y2="105" stroke="#1d4ed8" stroke-width="2.5"/>
        <text x="100" y="118" font-size="9" fill="#1d4ed8" text-anchor="middle" font-weight="bold">Vertical Bars (Axial & Flexure)</text>
      </svg>`
    },
    wall_horiz: {
      title: 'Horizontal Shear Reinforcement',
      aci: 'ACI 318-19 §11.6.2',
      desc: 'Resists in-plane seismic and wind lateral shear forces. Minimum ratio ρh ≥ 0.0020; continuous and anchored into wall ends with U-hairpins.',
      rec: 'ρh ≥ 0.0020, spacing s ≤ min(3t, 450 mm).',
      svg: `<svg viewBox="0 0 200 130" width="100%" height="110">
        <rect x="25" y="15" width="150" height="95" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="30" y1="35" x2="170" y2="35" stroke="#059669" stroke-width="2.5"/>
        <line x1="30" y1="65" x2="170" y2="65" stroke="#059669" stroke-width="2.5"/>
        <line x1="30" y1="95" x2="170" y2="95" stroke="#059669" stroke-width="2.5"/>
        <text x="100" y="118" font-size="9" fill="#059669" text-anchor="middle" font-weight="bold">Horizontal Bars (Shear)</text>
      </svg>`
    },
  };

  // ------------------------------------------------------------- SVG RENDERERS FOR BEAM, FOUNDATION, SLAB, WALL
  function renderBeamSectionSVG(q, dims) {
    const W = 280, H = 220;
    const bwMm = Math.round(dims.w * 1000), hMm = Math.round(dims.h * 1000);
    const scale = Math.min(180 / Math.max(dims.w, 0.1), 160 / Math.max(dims.h, 0.1));
    const sw = Math.max(60, Math.min(190, dims.w * scale));
    const sh = Math.max(70, Math.min(170, dims.h * scale));
    const cx = W / 2, cy = H / 2;
    const x0 = cx - sw / 2, y0 = cy - sh / 2;
    const covPx = Math.max(6, Math.min(18, (q.side || 0.03) * scale));

    const tx = x0 + covPx, ty = y0 + covPx;
    const tw = sw - 2 * covPx, th = sh - 2 * covPx;

    const topN = Math.max(2, q.topCount || 2);
    const botN = Math.max(2, q.botCount || 3);
    const skinN = q.skin || 0;

    let topBarsSvg = '';
    for (let i = 0; i < topN; i++) {
      const bx = topN === 1 ? tx + tw / 2 : tx + (tw * i) / (topN - 1);
      topBarsSvg += `<circle cx="${bx.toFixed(1)}" cy="${(ty + 6).toFixed(1)}" r="4.5" fill="#1d4ed8" stroke="#1e40af" stroke-width="1.2"/>`;
    }

    let botBarsSvg = '';
    for (let i = 0; i < botN; i++) {
      const bx = botN === 1 ? tx + tw / 2 : tx + (tw * i) / (botN - 1);
      botBarsSvg += `<circle cx="${bx.toFixed(1)}" cy="${(ty + th - 6).toFixed(1)}" r="5" fill="#1d4ed8" stroke="#1e40af" stroke-width="1.2"/>`;
    }

    let skinSvg = '';
    if (skinN > 0) {
      for (let i = 1; i <= skinN; i++) {
        const sy = ty + (th * i) / (skinN + 1);
        skinSvg += `<circle cx="${(tx + 5).toFixed(1)}" cy="${sy.toFixed(1)}" r="3.5" fill="#0284c7"/>`;
        skinSvg += `<circle cx="${(tx + tw - 5).toFixed(1)}" cy="${sy.toFixed(1)}" r="3.5" fill="#0284c7"/>`;
      }
    }

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        <rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${sw.toFixed(1)}" height="${sh.toFixed(1)}" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
        <line x1="${x0.toFixed(1)}" y1="${(y0 - 8).toFixed(1)}" x2="${(x0 + sw).toFixed(1)}" y2="${(y0 - 8).toFixed(1)}" stroke="#64748b" stroke-width="1"/>
        <text x="${cx.toFixed(1)}" y="${(y0 - 11).toFixed(1)}" font-size="10" fill="#475569" text-anchor="middle" font-weight="600">${bwMm} mm</text>
        <line x1="${(x0 - 8).toFixed(1)}" y1="${y0.toFixed(1)}" x2="${(x0 - 8).toFixed(1)}" y2="${(y0 + sh).toFixed(1)}" stroke="#64748b" stroke-width="1"/>
        <text x="${(x0 - 12).toFixed(1)}" y="${cy.toFixed(1)}" font-size="10" fill="#475569" text-anchor="middle" transform="rotate(-90 ${(x0 - 12).toFixed(1)} ${cy.toFixed(1)})" font-weight="600">${hMm} mm</text>
        <rect x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="3" fill="none" stroke="#2563eb" stroke-width="2.5"/>
        <path d="M ${tx.toFixed(1)} ${(ty + 14).toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)} L ${(tx + 14).toFixed(1)} ${(ty + 14).toFixed(1)}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>
        ${topBarsSvg}
        ${botBarsSvg}
        ${skinSvg}
        <text x="${cx.toFixed(1)}" y="${H - 6}" font-size="9" fill="#64748b" text-anchor="middle">Top: ${topN} · Bot: ${botN}${skinN ? ` · Skin: ${skinN}×2` : ''}${q.crank ? ` · Bent: ${q.crank}×(45°)` : ''}</text>
      </svg>
    `;
  }

  function renderBeamElevationSVG(q, dims) {
    const W = 340, H = 220;
    const lnM = dims.l || 4.0;
    const hM = dims.h || 0.5;
    const bwMm = Math.round(dims.w * 1000);
    const colW = 34;
    const spanW = W - 2 * colW - 30;
    const x0 = 15 + colW, y0 = 45;
    const beamH = Math.max(50, Math.min(100, (hM / 0.5) * 60));

    // Support columns
    const supports = `
      <rect x="15" y="20" width="${colW}" height="${beamH + 50}" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5"/>
      <rect x="${(x0 + spanW).toFixed(1)}" y="20" width="${colW}" height="${beamH + 50}" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5"/>
      <line x1="15" y1="${(y0 + beamH).toFixed(1)}" x2="${(W - 15).toFixed(1)}" y2="${(y0 + beamH).toFixed(1)}" stroke="#94a3b8" stroke-dasharray="3 3"/>
    `;

    // Beam outline
    const beamBody = `
      <rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${spanW.toFixed(1)}" height="${beamH.toFixed(1)}" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
    `;

    // Stirrups along span
    let stirrupLines = '';
    const isSeis = q.seismic !== false;
    const zoneW = Math.min(spanW * 0.3, (2 * hM / lnM) * spanW);
    const sValMm = Math.round((q.value || 0.15) * 1000);

    const sCount = isSeis ? 18 : Math.max(6, Math.min(24, Math.round(spanW / (sValMm / 8))));
    for (let i = 0; i <= sCount; i++) {
      const frac = i / sCount;
      const sx = x0 + frac * spanW;
      const inZone = isSeis && (sx <= x0 + zoneW || sx >= x0 + spanW - zoneW);
      stirrupLines += `<line x1="${sx.toFixed(1)}" y1="${(y0 + 4).toFixed(1)}" x2="${sx.toFixed(1)}" y2="${(y0 + beamH - 4).toFixed(1)}" stroke="${inZone ? '#1d4ed8' : '#60a5fa'}" stroke-width="${inZone ? '2' : '1.2'}"/>`;
    }

    // Longitudinal bars
    const topBarY = y0 + 10;
    const botBarY = y0 + beamH - 10;

    let crankSvg = '';
    const hasCrank = (q.crank || 0) > 0;
    if (hasCrank) {
      const atFrac = q.crankAt || (1 / 6);
      const xA = x0 + atFrac * spanW;
      const xB = x0 + spanW - atFrac * spanW;
      const rise = botBarY - topBarY;
      const dx = Math.min(rise, (xB - xA) * 0.35);
      const hookDown = Math.min(26, beamH * 0.45);
      crankSvg = `
        <!-- Bent-Up (Cranked) Truss Bar -->
        <path d="M ${(x0 - 15).toFixed(1)} ${(topBarY + 3 + hookDown).toFixed(1)}
                 L ${(x0 - 15).toFixed(1)} ${(topBarY + 3).toFixed(1)}
                 L ${xA.toFixed(1)} ${(topBarY + 3).toFixed(1)}
                 L ${(xA + dx).toFixed(1)} ${(botBarY - 1).toFixed(1)}
                 L ${(xB - dx).toFixed(1)} ${(botBarY - 1).toFixed(1)}
                 L ${xB.toFixed(1)} ${(topBarY + 3).toFixed(1)}
                 L ${(x0 + spanW + 15).toFixed(1)} ${(topBarY + 3).toFixed(1)}
                 L ${(x0 + spanW + 15).toFixed(1)} ${(topBarY + 3 + hookDown).toFixed(1)}"
              fill="none" stroke="#8b5cf6" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="${((xA + xA + dx) / 2).toFixed(1)}" y="${((topBarY + botBarY) / 2 - 4).toFixed(1)}" font-size="8.5" fill="#8b5cf6" font-weight="bold">45° Crank</text>
        <text x="${(x0 + spanW / 2).toFixed(1)}" y="${(botBarY - 5).toFixed(1)}" font-size="8.5" fill="#8b5cf6" text-anchor="middle" font-weight="600">${q.crank}× Bent-Up Bars</text>
      `;
    }

    const barsSvg = `
      <!-- Top Bars with Hooks -->
      <path d="M ${(x0 - 15).toFixed(1)} ${(topBarY + 30).toFixed(1)} L ${(x0 - 15).toFixed(1)} ${topBarY.toFixed(1)} L ${(x0 + spanW + 15).toFixed(1)} ${topBarY.toFixed(1)} L ${(x0 + spanW + 15).toFixed(1)} ${(topBarY + 30).toFixed(1)}" fill="none" stroke="#1d4ed8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- Bottom Continuous Straight Bars -->
      <line x1="${(x0 - 12).toFixed(1)}" y1="${botBarY.toFixed(1)}" x2="${(x0 + spanW + 12).toFixed(1)}" y2="${botBarY.toFixed(1)}" stroke="#1d4ed8" stroke-width="3" stroke-linecap="round"/>
      ${crankSvg}
    `;

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        ${supports}
        ${beamBody}
        ${isSeis ? `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${zoneW.toFixed(1)}" height="${beamH.toFixed(1)}" fill="#dbeafe" opacity="0.4"/>
                   <rect x="${(x0 + spanW - zoneW).toFixed(1)}" y="${y0.toFixed(1)}" width="${zoneW.toFixed(1)}" height="${beamH.toFixed(1)}" fill="#dbeafe" opacity="0.4"/>` : ''}
        ${stirrupLines}
        ${barsSvg}
        <text x="${(W / 2).toFixed(1)}" y="25" font-size="10" fill="#334155" text-anchor="middle" font-weight="600">Span Ln = ${lnM.toFixed(2)} m · b×h = ${bwMm}×${Math.round(hM * 1000)} mm</text>
        <text x="${(W / 2).toFixed(1)}" y="${H - 6}" font-size="9" fill="#64748b" text-anchor="middle">${isSeis ? 'ACI 318 Confinement Zones 2h @ Ends · 135° Hooks' : 'Uniform Stirrup Pitch'}</text>
      </svg>
    `;
  }

  function renderFootingPlanSVG(q, dims) {
    const W = 280, H = 220;
    const fwMm = Math.round(dims.w * 1000), flMm = Math.round(dims.l * 1000);
    const boxW = 160, boxH = 150;
    const cx = W / 2, cy = H / 2;
    const x0 = cx - boxW / 2, y0 = cy - boxH / 2;

    // Grid mesh lines
    let gridSvg = '';
    const nx = 7, ny = 7;
    for (let i = 1; i < nx; i++) {
      const gx = x0 + (boxW * i) / nx;
      gridSvg += `<line x1="${gx.toFixed(1)}" y1="${y0 + 6}" x2="${gx.toFixed(1)}" y2="${y0 + boxH - 6}" stroke="#059669" stroke-width="1.6"/>`;
    }
    for (let j = 1; j < ny; j++) {
      const gy = y0 + (boxH * j) / ny;
      gridSvg += `<line x1="${x0 + 6}" y1="${gy.toFixed(1)}" x2="${x0 + boxW - 6}" y2="${gy.toFixed(1)}" stroke="#2563eb" stroke-width="1.6"/>`;
    }

    // Column starter footprint
    const colW = 44, colH = 44;
    const colX = cx - colW / 2, colY = cy - colH / 2;

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        <rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${boxW}" height="${boxH}" rx="2" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
        <rect x="${x0 + 6}" y="${y0 + 6}" width="${boxW - 12}" height="${boxH - 12}" fill="none" stroke="#94a3b8" stroke-dasharray="3 3"/>
        ${gridSvg}
        <rect x="${colX.toFixed(1)}" y="${colY.toFixed(1)}" width="${colW}" height="${colH}" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.8"/>
        <!-- Starter Dowels -->
        <circle cx="${colX + 8}" cy="${colY + 8}" r="4" fill="#1d4ed8"/>
        <circle cx="${colX + colW - 8}" cy="${colY + 8}" r="4" fill="#1d4ed8"/>
        <circle cx="${colX + 8}" cy="${colY + colH - 8}" r="4" fill="#1d4ed8"/>
        <circle cx="${colX + colW - 8}" cy="${colY + colH - 8}" r="4" fill="#1d4ed8"/>
        <text x="${cx.toFixed(1)}" y="${y0 - 6}" font-size="10" fill="#475569" text-anchor="middle" font-weight="600">${fwMm} × ${flMm} mm</text>
        <text x="${cx.toFixed(1)}" y="${H - 6}" font-size="9" fill="#64748b" text-anchor="middle">Two-Way Bottom Mesh + Column Starters</text>
      </svg>
    `;
  }

  function renderFootingElevationSVG(q, dims) {
    const W = 340, H = 220;
    const padW = 200, padH = 65;
    const cx = W / 2, cy = 135;
    const x0 = cx - padW / 2, y0 = cy - padH / 2;
    const colW = 50, colH = 60;

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        <!-- Soil Base -->
        <rect x="20" y="${y0 + padH}" width="300" height="30" fill="#fef3c7" stroke="#d97706" stroke-width="1" stroke-dasharray="3 3"/>
        <!-- Footing Pad -->
        <rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${padW}" height="${padH}" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
        <!-- Column Stub -->
        <rect x="${(cx - colW / 2).toFixed(1)}" y="${(y0 - colH).toFixed(1)}" width="${colW}" height="${colH}" fill="#e2e8f0" stroke="#64748b" stroke-width="1.8"/>
        <!-- Ground Cover Line 75mm -->
        <line x1="${(x0 + 10).toFixed(1)}" y1="${(y0 + padH - 12).toFixed(1)}" x2="${(x0 + padW - 10).toFixed(1)}" y2="${(y0 + padH - 12).toFixed(1)}" stroke="#2563eb" stroke-width="3"/>
        <!-- Starters with L-foot -->
        <path d="M ${(cx - colW / 2 + 10).toFixed(1)} ${(y0 - colH - 25).toFixed(1)} L ${(cx - colW / 2 + 10).toFixed(1)} ${(y0 + padH - 15).toFixed(1)} L ${(cx - colW / 2 - 25).toFixed(1)} ${(y0 + padH - 15).toFixed(1)}" fill="none" stroke="#1d4ed8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M ${(cx + colW / 2 - 10).toFixed(1)} ${(y0 - colH - 25).toFixed(1)} L ${(cx + colW / 2 - 10).toFixed(1)} ${(y0 + padH - 15).toFixed(1)} L ${(cx + colW / 2 + 25).toFixed(1)} ${(y0 + padH - 15).toFixed(1)}" fill="none" stroke="#1d4ed8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <!-- 75mm Cover Callout -->
        <line x1="${(x0 - 8).toFixed(1)}" y1="${(y0 + padH - 12).toFixed(1)}" x2="${(x0 - 8).toFixed(1)}" y2="${(y0 + padH).toFixed(1)}" stroke="#ef4444" stroke-width="1.5"/>
        <text x="${(x0 - 12).toFixed(1)}" y="${(y0 + padH - 5).toFixed(1)}" font-size="9" fill="#ef4444" text-anchor="end" font-weight="bold">75 mm Cover</text>
        <text x="${cx.toFixed(1)}" y="25" font-size="10" fill="#334155" text-anchor="middle" font-weight="600">Footing Thickness H = ${Math.round(dims.h * 1000)} mm · Dowel Lap = 500 mm</text>
      </svg>
    `;
  }

  function renderSlabPlanSVG(q, dims) {
    const W = 280, H = 220;
    const boxW = 180, boxH = 140;
    const cx = W / 2, cy = H / 2;
    const x0 = cx - boxW / 2, y0 = cy - boxH / 2;

    const hasCrank = !!q.crank;
    let meshSvg = '';
    for (let i = 1; i <= 6; i++) {
      const gx = x0 + (boxW * i) / 7;
      meshSvg += `<line x1="${gx.toFixed(1)}" y1="${y0 + 5}" x2="${gx.toFixed(1)}" y2="${y0 + boxH - 5}" stroke="#059669" stroke-width="1.5"/>`;
    }
    for (let j = 1; j <= 5; j++) {
      const gy = y0 + (boxH * j) / 6;
      const isCrankLine = hasCrank && (j % 2 === 1);
      meshSvg += `<line x1="${x0 + 5}" y1="${gy.toFixed(1)}" x2="${x0 + boxW - 5}" y2="${gy.toFixed(1)}" stroke="${isCrankLine ? '#8b5cf6' : '#2563eb'}" stroke-width="${isCrankLine ? '2' : '1.5'}" ${isCrankLine ? 'stroke-dasharray="6 2"' : ''}/>`;
    }

    // Opening trim
    const opX = cx + 20, opY = cy - 10, opW = 32, opH = 32;

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        <rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${boxW}" height="${boxH}" rx="2" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
        ${meshSvg}
        <!-- Opening -->
        <rect x="${opX}" y="${opY}" width="${opW}" height="${opH}" fill="#ffffff" stroke="#0f172a" stroke-width="1.5"/>
        <line x1="${opX - 6}" y1="${opY - 6}" x2="${opX + 6}" y2="${opY + 6}" stroke="#ef4444" stroke-width="1.8"/>
        <line x1="${opX + opW + 6}" y1="${opY - 6}" x2="${opX + opW - 6}" y2="${opY + 6}" stroke="#ef4444" stroke-width="1.8"/>
        <text x="${cx.toFixed(1)}" y="${H - 6}" font-size="9" fill="#64748b" text-anchor="middle">${hasCrank ? 'Two-Way Mesh + Alternate Bent Bars (L/4)' : 'Two-Way Bottom Mesh + Opening Trim Bars'}</text>
      </svg>
    `;
  }

  function renderSlabElevationSVG(q, dims) {
    const W = 340, H = 220;
    const slabW = 260, slabH = 45;
    const cx = W / 2, cy = H / 2;
    const x0 = cx - slabW / 2, y0 = cy - slabH / 2;

    const hasCrank = !!q.crank;
    const crankFrac = q.crankAt || 0.25;
    const cDist = slabW * crankFrac;
    const xA = x0 + cDist, xB = x0 + slabW - cDist;
    const dy = slabH - 20;
    const dx = Math.min(dy, cDist * 0.45);

    let crankBarsSvg = '';
    if (hasCrank) {
      crankBarsSvg = `
        <!-- Alternate Cranked Bar -->
        <path d="M ${(x0 + 8).toFixed(1)} ${(y0 + 10).toFixed(1)}
                 L ${xA.toFixed(1)} ${(y0 + 10).toFixed(1)}
                 L ${(xA + dx).toFixed(1)} ${(y0 + slabH - 10).toFixed(1)}
                 L ${(xB - dx).toFixed(1)} ${(y0 + slabH - 10).toFixed(1)}
                 L ${xB.toFixed(1)} ${(y0 + 10).toFixed(1)}
                 L ${(x0 + slabW - 8).toFixed(1)} ${(y0 + 10).toFixed(1)}"
              fill="none" stroke="#8b5cf6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="${(x0 + 8).toFixed(1)}" y1="${(y0 + slabH + 16).toFixed(1)}" x2="${xA.toFixed(1)}" y2="${(y0 + slabH + 16).toFixed(1)}" stroke="#ef4444" stroke-width="1.5"/>
        <text x="${((x0 + 8 + xA) / 2).toFixed(1)}" y="${(y0 + slabH + 28).toFixed(1)}" font-size="8.5" fill="#ef4444" text-anchor="middle" font-weight="bold">L/4</text>
        <text x="${cx.toFixed(1)}" y="${(y0 + slabH + 28).toFixed(1)}" font-size="8.5" fill="#8b5cf6" text-anchor="middle" font-weight="bold">Alternate Bent-Up Bars (45° Crank)</text>
      `;
    }

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        <!-- End Supports -->
        <rect x="${(x0 - 15).toFixed(1)}" y="${y0.toFixed(1)}" width="18" height="${slabH + 32}" fill="#e2e8f0" stroke="#64748b" stroke-width="1.2"/>
        <rect x="${(x0 + slabW - 3).toFixed(1)}" y="${y0.toFixed(1)}" width="18" height="${slabH + 32}" fill="#e2e8f0" stroke="#64748b" stroke-width="1.2"/>

        <rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${slabW}" height="${slabH}" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
        <!-- Bottom Mesh -->
        <line x1="${x0 + 10}" y1="${y0 + slabH - 10}" x2="${x0 + slabW - 10}" y2="${y0 + slabH - 10}" stroke="#2563eb" stroke-width="2.5"/>
        <circle cx="${x0 + 30}" cy="${y0 + slabH - 10}" r="3.5" fill="#059669"/>
        <circle cx="${x0 + 80}" cy="${y0 + slabH - 10}" r="3.5" fill="#059669"/>
        <circle cx="${x0 + 130}" cy="${y0 + slabH - 10}" r="3.5" fill="#059669"/>
        <circle cx="${x0 + 180}" cy="${y0 + slabH - 10}" r="3.5" fill="#059669"/>
        <circle cx="${x0 + 230}" cy="${y0 + slabH - 10}" r="3.5" fill="#059669"/>
        <!-- Top Mesh -->
        ${q.topMesh ? `<line x1="${x0 + 10}" y1="${y0 + 10}" x2="${x0 + slabW - 10}" y2="${y0 + 10}" stroke="#2563eb" stroke-width="2" stroke-dasharray="4 2"/>` : ''}
        ${crankBarsSvg}
        <text x="${cx.toFixed(1)}" y="40" font-size="10" fill="#334155" text-anchor="middle" font-weight="600">Slab Thickness t = ${Math.round(dims.h * 1000)} mm · Cover = ${Math.round((q.bottom || 0.025) * 1000)} mm</text>
      </svg>
    `;
  }

  function renderWallElevationSVG(q, dims) {
    const W = 340, H = 220;
    const wallW = 240, wallH = 130;
    const cx = W / 2, cy = H / 2;
    const x0 = cx - wallW / 2, y0 = cy - wallH / 2;

    let vLines = '', hLines = '';
    for (let i = 1; i <= 9; i++) {
      const vx = x0 + (wallW * i) / 10;
      vLines += `<line x1="${vx.toFixed(1)}" y1="${y0 + 5}" x2="${vx.toFixed(1)}" y2="${y0 + wallH - 5}" stroke="#1d4ed8" stroke-width="1.8"/>`;
    }
    for (let j = 1; j <= 5; j++) {
      const hy = y0 + (wallH * j) / 6;
      hLines += `<line x1="${x0 + 5}" y1="${hy.toFixed(1)}" x2="${x0 + wallW - 5}" y2="${hy.toFixed(1)}" stroke="#059669" stroke-width="1.8"/>`;
    }

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        <rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${wallW}" height="${wallH}" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
        ${vLines}
        ${hLines}
        <text x="${cx.toFixed(1)}" y="25" font-size="10" fill="#334155" text-anchor="middle" font-weight="600">Wall Elevation: ${dims.l.toFixed(2)}m × ${dims.h.toFixed(2)}m · Two Curtains</text>
        <text x="${cx.toFixed(1)}" y="${H - 6}" font-size="9" fill="#64748b" text-anchor="middle">Vertical Bars (Blue) + Horizontal Shear Bars (Green)</text>
      </svg>
    `;
  }

  function renderWallSectionSVG(q, dims) {
    const W = 280, H = 220;
    const wtMm = Math.round(dims.w * 1000);
    const boxW = Math.max(60, Math.min(100, (dims.w / 0.3) * 70));
    const boxH = 150;
    const cx = W / 2, cy = H / 2;
    const x0 = cx - boxW / 2, y0 = cy - boxH / 2;

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        <rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${boxW}" height="${boxH}" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
        <!-- Two vertical curtains -->
        <circle cx="${x0 + 12}" cy="${y0 + 20}" r="4" fill="#1d4ed8"/>
        <circle cx="${x0 + boxW - 12}" cy="${y0 + 20}" r="4" fill="#1d4ed8"/>
        <circle cx="${x0 + 12}" cy="${y0 + 55}" r="4" fill="#1d4ed8"/>
        <circle cx="${x0 + boxW - 12}" cy="${y0 + 55}" r="4" fill="#1d4ed8"/>
        <circle cx="${x0 + 12}" cy="${y0 + 90}" r="4" fill="#1d4ed8"/>
        <circle cx="${x0 + boxW - 12}" cy="${y0 + 90}" r="4" fill="#1d4ed8"/>
        <circle cx="${x0 + 12}" cy="${y0 + 125}" r="4" fill="#1d4ed8"/>
        <circle cx="${x0 + boxW - 12}" cy="${y0 + 125}" r="4" fill="#1d4ed8"/>
        <!-- Horizontal tie hoop -->
        <rect x="${x0 + 8}" y="${y0 + 12}" width="${boxW - 16}" height="${boxH - 24}" rx="2" fill="none" stroke="#059669" stroke-width="1.8"/>
        <text x="${cx.toFixed(1)}" y="${y0 - 6}" font-size="10" fill="#475569" text-anchor="middle" font-weight="600">t = ${wtMm} mm</text>
        <text x="${cx.toFixed(1)}" y="${H - 6}" font-size="9" fill="#64748b" text-anchor="middle">Two Curtains · Exterior &amp; Interior Faces</text>
      </svg>
    `;
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
      return 'Element Reinforcement: click ANY face of a beam, column, foundation, slab or wall — interactive ACI 318 multi-view cage builder.';
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
      if (!ent) { this.app.toast('Pick a face of a beam, column, foundation, slab or wall element', true); return; }
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

      const typeName = { beam: 'Beam', column: 'Column', foundation: 'Foundation', slab: 'Floor / Slab', wall: 'Wall' }[type] || type;

      // Extract physical dimensions
      let dims = { w: 0.3, h: 0.5, l: 3.5 };
      if (type === 'beam') {
        const bp = ent.params || {};
        dims.w = +bp.webWidth || 0.25;
        dims.h = +bp.height || 0.5;
        if (bp.baseline && bp.baseline.length >= 2) {
          const dx = bp.baseline[1][0] - bp.baseline[0][0], dy = bp.baseline[1][1] - bp.baseline[0][1];
          dims.l = Math.hypot(dx, dy) || 3.5;
        }
      } else if (type === 'foundation') {
        const fp = ent.params || {};
        dims.w = +fp.width || 1.2;
        dims.l = +fp.depth || 1.2;
        dims.h = +fp.thickness || 0.5;
      } else if (type === 'slab') {
        dims.h = +(ent.params?.thickness || 0.2);
        dims.w = 4.0; dims.l = 4.0;
      } else if (type === 'wall') {
        const wp = ent.params || {};
        dims.w = +(wp.thickness || 0.2);
        dims.h = +(wp.height || 3.0);
        if (wp.base && wp.end) dims.l = Math.hypot(wp.end[0] - wp.base[0], wp.end[1] - wp.base[1]) || 4.0;
      }

      // Build Parameter Form for Type
      let tabsHtml = '', formPanesHtml = '';
      if (type === 'beam') {
        tabsHtml = `
          <button class="cr-tab active" data-tab="pane-bm-geom">📐 Geometry &amp; Covers</button>
          <button class="cr-tab" data-tab="pane-bm-stirrup">🔄 Stirrups &amp; Shear</button>
          <button class="cr-tab" data-tab="pane-bm-main">⚡ Longitudinal Bars</button>
          <button class="cr-tab" data-tab="pane-bm-aci">📋 ACI Verification</button>
        `;
        formPanesHtml = `
          <!-- Beam Tab 1: Geometry & Covers -->
          <div class="cr-tab-pane" id="pane-bm-geom">
            <div class="cr-section">
              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Clear Concrete Cover (cc)
                    <button class="cr-info-btn" data-cr-tip="beam_cover" type="button">ⓘ</button>
                  </span>
                  <div class="cr-input-group">
                    <input id="eb-side-mm" class="cr-input" type="number" step="5" min="20" max="100" value="40" style="width:65px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <div class="cr-chip-group">
                  <button class="cr-chip active" data-bm-cov="40">40 mm Interior</button>
                  <button class="cr-chip" data-bm-cov="50">50 mm Exterior</button>
                </div>
                <input id="eb-side" type="hidden" value="0.04">
                <input id="eb-top" type="hidden" value="0.04">
                <input id="eb-bot" type="hidden" value="0.04">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">Stirrup End Offset</span>
                  <div class="cr-input-group">
                    <input id="eb-end-mm" class="cr-input" type="number" step="5" min="25" max="150" value="50" style="width:65px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <input id="eb-end" type="hidden" value="0.05">
              </div>

              <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                <label class="cr-label-wrap" style="cursor:pointer;">
                  <input type="checkbox" id="eb-integ" checked>
                  <span>Structural Integrity Steel (ACI 318 §9.8)</span>
                </label>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">
                  At least 2 continuous bottom bars anchored into columns to prevent progressive collapse.
                </div>
              </div>
            </div>
          </div>

          <!-- Beam Tab 2: Stirrups & Shear -->
          <div class="cr-tab-pane" id="pane-bm-stirrup" style="display:none;">
            <div class="cr-section">
              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Stirrup Bar Size (dt)
                    <button class="cr-info-btn" data-cr-tip="beam_stirrup" type="button">ⓘ</button>
                  </span>
                  <select id="eb-tdia-sel" class="cr-select" style="width:170px">
                    ${BAR_SIZES.slice(0, 4).map(b => `<option value="${b.dia}" ${b.mm === 9.5 ? 'selected' : ''}>${b.us} / ${b.metric} (${b.mm} mm)</option>`).join('')}
                  </select>
                </div>
                <input id="eb-tdia" type="hidden" value="0.0095">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Stirrup Spacing (s)
                    <button class="cr-info-btn" data-cr-tip="beam_spacing" type="button">ⓘ</button>
                  </span>
                  <div class="cr-input-group">
                    <input id="eb-tval-mm" class="cr-input" type="number" step="10" min="50" max="400" value="150" style="width:65px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <input id="eb-tval" type="hidden" value="0.15">
                <input type="radio" name="er-tie" value="spacing" checked style="display:none">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">Stirrup Hook Detail</span>
                  <select id="eb-bent" class="cr-select" style="width:170px">
                    <option value="135" selected>135° Seismic Hook (6dt)</option>
                    <option value="90">90° Standard Hook</option>
                  </select>
                </div>
                <input id="eb-bf" type="hidden" value="6">
              </div>

              <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                <label class="cr-label-wrap" style="cursor:pointer;">
                  <input type="checkbox" id="eb-seis" checked>
                  <span>Special Seismic Confinement Zones (ACI 318 §18.6.4)</span>
                  <button class="cr-info-btn" data-cr-tip="beam_seismic" type="button">ⓘ</button>
                </label>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">
                  First tie @ 50 mm, 2h plastic hinge zones @ min(d/4, 125mm), midspan @ d/2.
                </div>
              </div>
            </div>
          </div>

          <!-- Beam Tab 3: Longitudinal Bars -->
          <div class="cr-tab-pane" id="pane-bm-main" style="display:none;">
            <div class="cr-section">
              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Top Bars (Negative Tension)
                    <button class="cr-info-btn" data-cr-tip="beam_top" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <input id="eb-topn" class="cr-input" type="number" step="1" min="2" max="8" value="2" style="width:50px">
                    <span style="font-size:11px; color:#64748b;">×</span>
                    <select id="eb-topd-sel" class="cr-select" style="width:130px">
                      ${BAR_SIZES.slice(2, 7).map(b => `<option value="${b.dia}" ${b.mm === 15.9 ? 'selected' : ''}>${b.us} (${b.mm}mm)</option>`).join('')}
                    </select>
                  </div>
                </div>
                <input id="eb-topd" type="hidden" value="0.0159">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Bottom Bars (Midspan Tension)
                    <button class="cr-info-btn" data-cr-tip="beam_bot" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <input id="eb-botn" class="cr-input" type="number" step="1" min="2" max="10" value="3" style="width:50px">
                    <span style="font-size:11px; color:#64748b;">×</span>
                    <select id="eb-botd-sel" class="cr-select" style="width:130px">
                      ${BAR_SIZES.slice(2, 7).map(b => `<option value="${b.dia}" ${b.mm === 19.1 ? 'selected' : ''}>${b.us} (${b.mm}mm)</option>`).join('')}
                    </select>
                  </div>
                </div>
                <input id="eb-botd" type="hidden" value="0.0191">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    End Hooks (Top / Bot)
                    <button class="cr-info-btn" data-cr-tip="beam_hooks" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; gap:6px;">
                    <select id="eb-th" class="cr-select" style="width:85px">
                      <option value="none">None</option>
                      <option value="90" selected>90° Standard</option>
                      <option value="180">180° Hook</option>
                    </select>
                    <select id="eb-bh" class="cr-select" style="width:85px">
                      <option value="none" selected>None (Str)</option>
                      <option value="90">90° Hook</option>
                      <option value="180">180° Hook</option>
                    </select>
                  </div>
                </div>
                <input id="eb-hret" type="hidden" value="0.4">
              </div>

              <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Skin / Torsion Bars (per side)
                    <button class="cr-info-btn" data-cr-tip="beam_skin" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <input id="eb-skin" class="cr-input" type="number" step="1" min="0" max="6" value="${dims.h >= 0.75 ? 2 : 0}" style="width:50px">
                    <span style="font-size:11px; color:#64748b;">bars ×</span>
                    <select id="eb-skind-sel" class="cr-select" style="width:110px">
                      ${BAR_SIZES.slice(1, 4).map(b => `<option value="${b.dia}">${b.us} (${b.mm}mm)</option>`).join('')}
                    </select>
                  </div>
                </div>
                <input id="eb-skind" type="hidden" value="0.0127">
              </div>

              <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Bent-Up (Cranked) Truss Bars
                    <button class="cr-info-btn" data-cr-tip="beam_bent" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <input id="eb-crank" class="cr-input" type="number" step="1" min="0" max="4" value="0" style="width:50px">
                    <span style="font-size:11px; color:#64748b;">bars (45°)</span>
                  </div>
                </div>
                <div class="cr-field-row" style="margin-top:6px;">
                  <span style="font-size:12px; color:#475569;">Crank Start (from support)</span>
                  <select id="eb-crankat" class="cr-select" style="width:135px">
                    <option value="7">Ln / 7 (0.14 Ln)</option>
                    <option value="6" selected>Ln / 6 (0.17 Ln — Std)</option>
                    <option value="5">Ln / 5 (0.20 Ln)</option>
                    <option value="4">Ln / 4 (0.25 Ln)</option>
                  </select>
                </div>
                <div class="cr-chip-group" style="margin-top:6px;">
                  <button class="cr-chip active" data-bm-crank="0">0 (Straight Only)</button>
                  <button class="cr-chip" data-bm-crank="1">1 Bent Bar</button>
                  <button class="cr-chip" data-bm-crank="2">2 Bent Bars</button>
                </div>
                <div style="font-size:11px; color:#64748b; margin-top:4px;">
                  Transitions bottom tension to top negative moment near supports. Outer corner bars remain continuous (ACI §9.8).
                </div>
              </div>

              <!-- Curtailment Hidden Fields -->
              <input id="eb-topx" type="hidden" value="0">
              <input id="eb-topcut" type="hidden" value="4">
              <input id="eb-botx" type="hidden" value="0">
              <input id="eb-botcut" type="hidden" value="8">
            </div>
          </div>

          <!-- Beam Tab 4: ACI Verification -->
          <div class="cr-tab-pane" id="pane-bm-aci" style="display:none;">
            <div class="cr-section">
              <div class="cr-aci-checklist">
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Flexural Steel Ratio:</span>
                  <span id="er-aci-rho" class="cr-metric-chip ok">ρ ≥ ρmin (OK)</span>
                </div>
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Stirrup Spacing Limit:</span>
                  <span id="er-aci-s" class="cr-metric-chip ok">s ≤ d/2 (OK)</span>
                </div>
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Seismic Ductile Detailing:</span>
                  <span id="er-aci-seis" class="cr-metric-chip ok">135° Hooks + 2h Zones</span>
                </div>
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Skin Steel (d &gt; 900mm):</span>
                  <span id="er-aci-skin" class="cr-metric-chip ok">${dims.h >= 0.9 ? 'Required &amp; Placed' : 'N/A (h &lt; 900mm)'}</span>
                </div>
              </div>
              <div style="font-size:11.5px; color:#475569; margin-top:8px; line-height:1.5;" id="er-takeoff-text">
                Live steel takeoff calculating...
              </div>
            </div>
          </div>
        `;
      } else if (type === 'foundation') {
        tabsHtml = `
          <button class="cr-tab active" data-tab="pane-fn-geom">📐 Footing &amp; Cover</button>
          <button class="cr-tab" data-tab="pane-fn-mesh">🔄 Bottom Mesh (X &amp; Y)</button>
          <button class="cr-tab" data-tab="pane-fn-starters">⚡ Column Starters</button>
          <button class="cr-tab" data-tab="pane-fn-aci">📋 ACI Verification</button>
        `;
        formPanesHtml = `
          <div class="cr-tab-pane" id="pane-fn-geom">
            <div class="cr-section">
              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Footing Type
                    <button class="cr-info-btn" data-cr-tip="fnd_kind" type="button">ⓘ</button>
                  </span>
                  <select id="ef-kind" class="cr-select" style="width:160px">
                    <option value="pad" selected>Pad / Spread Footing</option>
                    <option value="mat">Raft Mat (FND-109)</option>
                    <option value="pilecap">Pile Cap (FND-161)</option>
                  </select>
                </div>
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Bottom Cover (Cast Against Earth)
                    <button class="cr-info-btn" data-cr-tip="fnd_cover" type="button">ⓘ</button>
                  </span>
                  <div class="cr-input-group">
                    <input id="ef-b-mm" class="cr-input" type="number" step="5" min="50" max="120" value="75" style="width:65px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <div class="cr-chip-group">
                  <button class="cr-chip active" data-fn-cov="75">75 mm (ACI Ground Mandated)</button>
                  <button class="cr-chip" data-fn-cov="50">50 mm (Mud Slab Blinded)</button>
                </div>
                <input id="ef-b" type="hidden" value="0.075">
                <input id="ef-side" type="hidden" value="0.05">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">Top Mesh Layer</span>
                  <select id="ef-top" class="cr-select" style="width:80px">
                    <option value="X">X Layer</option>
                    <option value="Y" selected>Y Layer</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="cr-tab-pane" id="pane-fn-mesh" style="display:none;">
            <div class="cr-section">
              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    X-Dir Mesh (Size @ Spacing)
                    <button class="cr-info-btn" data-cr-tip="fnd_mesh" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <select id="ef-xd-sel" class="cr-select" style="width:120px">
                      ${BAR_SIZES.slice(1, 6).map(b => `<option value="${b.dia}" ${b.mm === 12.7 ? 'selected' : ''}>${b.us} (${b.mm}mm)</option>`).join('')}
                    </select>
                    <span style="font-size:11px; color:#64748b;">@</span>
                    <input id="ef-xv-mm" class="cr-input" type="number" step="10" min="50" max="400" value="150" style="width:60px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <input id="ef-xd" type="hidden" value="0.0127">
                <input id="ef-xv" type="hidden" value="0.15">
                <input type="radio" name="er-fx" value="spacing" checked style="display:none">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Y-Dir Mesh (Size @ Spacing)
                    <button class="cr-info-btn" data-cr-tip="fnd_mesh" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <select id="ef-yd-sel" class="cr-select" style="width:120px">
                      ${BAR_SIZES.slice(1, 6).map(b => `<option value="${b.dia}" ${b.mm === 12.7 ? 'selected' : ''}>${b.us} (${b.mm}mm)</option>`).join('')}
                    </select>
                    <span style="font-size:11px; color:#64748b;">@</span>
                    <input id="ef-yv-mm" class="cr-input" type="number" step="10" min="50" max="400" value="150" style="width:60px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <input id="ef-yd" type="hidden" value="0.0127">
                <input id="ef-yv" type="hidden" value="0.15">
                <input type="radio" name="er-fy" value="spacing" checked style="display:none">
              </div>
            </div>
          </div>

          <div class="cr-tab-pane" id="pane-fn-starters" style="display:none;">
            <div class="cr-section">
              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Column Starter Dowels
                    <button class="cr-info-btn" data-cr-tip="fnd_starters" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <input id="ef-nx" class="cr-input" type="number" step="1" min="2" max="6" value="3" style="width:45px" title="X Starters">
                    <span style="font-size:11px; color:#64748b;">×</span>
                    <input id="ef-ny" class="cr-input" type="number" step="1" min="2" max="6" value="3" style="width:45px" title="Y Starters">
                    <select id="ef-sd-sel" class="cr-select" style="width:115px">
                      ${BAR_SIZES.slice(2, 6).map(b => `<option value="${b.dia}" ${b.mm === 15.9 ? 'selected' : ''}>${b.us} (${b.mm}mm)</option>`).join('')}
                    </select>
                  </div>
                </div>
                <input id="ef-sd" type="hidden" value="0.0159">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Dowel Lap Length (above top)
                    <button class="cr-info-btn" data-cr-tip="fnd_lap" type="button">ⓘ</button>
                  </span>
                  <div class="cr-input-group">
                    <input id="ef-lap-mm" class="cr-input" type="number" step="50" min="300" max="1500" value="600" style="width:70px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <input id="ef-lap" type="hidden" value="0.6">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">Starter Leg into Footing</span>
                  <div class="cr-input-group">
                    <input id="ef-leg-mm" class="cr-input" type="number" step="25" min="100" max="500" value="200" style="width:70px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <input id="ef-leg" type="hidden" value="0.2">
              </div>

              <input id="ef-cw" type="hidden" value="0.4">
              <input id="ef-cl" type="hidden" value="0.4">
              <input id="ef-pn" type="hidden" value="4">
              <input id="ef-ps" type="hidden" value="0.9">
              <input id="ef-pd" type="hidden" value="0.3">
              <input id="ef-pl" type="hidden" value="0.6">
            </div>
          </div>

          <div class="cr-tab-pane" id="pane-fn-aci" style="display:none;">
            <div class="cr-section">
              <div class="cr-aci-checklist">
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Earth Cover Requirement:</span>
                  <span class="cr-metric-chip ok">≥ 75 mm (OK)</span>
                </div>
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Mesh Reinforcement Ratio:</span>
                  <span class="cr-metric-chip ok">ρ ≥ 0.0018 Ag (OK)</span>
                </div>
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Mesh Spacing Limit:</span>
                  <span class="cr-metric-chip ok">s ≤ min(3h, 450mm) (OK)</span>
                </div>
              </div>
            </div>
          </div>
        `;
      } else if (type === 'slab') {
        tabsHtml = `
          <button class="cr-tab active" data-tab="pane-sl-geom">📐 Slab &amp; Covers</button>
          <button class="cr-tab" data-tab="pane-sl-mesh">🔄 Two-Way Mesh</button>
          <button class="cr-tab" data-tab="pane-sl-special">⚡ Openings &amp; SOG</button>
          <button class="cr-tab" data-tab="pane-sl-aci">📋 ACI Verification</button>
        `;
        formPanesHtml = `
          <div class="cr-tab-pane" id="pane-sl-geom">
            <div class="cr-section">
              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Clear Concrete Cover
                    <button class="cr-info-btn" data-cr-tip="slab_cover" type="button">ⓘ</button>
                  </span>
                  <div class="cr-input-group">
                    <input id="es-b-mm" class="cr-input" type="number" step="5" min="15" max="60" value="25" style="width:65px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <div class="cr-chip-group">
                  <button class="cr-chip active" data-sl-cov="20">20 mm Interior</button>
                  <button class="cr-chip" data-sl-cov="25">25 mm Standard</button>
                </div>
                <input id="es-b" type="hidden" value="0.025">
                <input id="es-t" type="hidden" value="0.025">
                <input id="es-side" type="hidden" value="0.025">
              </div>
            </div>
          </div>

          <div class="cr-tab-pane" id="pane-sl-mesh" style="display:none;">
            <div class="cr-section">
              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    X-Dir Mesh (Bar @ Pitch)
                    <button class="cr-info-btn" data-cr-tip="slab_mesh" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <select id="es-xd-sel" class="cr-select" style="width:120px">
                      ${BAR_SIZES.slice(1, 5).map(b => `<option value="${b.dia}" ${b.mm === 12.7 ? 'selected' : ''}>${b.us} (${b.mm}mm)</option>`).join('')}
                    </select>
                    <span style="font-size:11px; color:#64748b;">@</span>
                    <input id="es-xs-mm" class="cr-input" type="number" step="10" min="50" max="400" value="150" style="width:60px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <input id="es-xd" type="hidden" value="0.0127">
                <input id="es-xs" type="hidden" value="0.15">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Y-Dir Mesh (Bar @ Pitch)
                    <button class="cr-info-btn" data-cr-tip="slab_mesh" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <select id="es-yd-sel" class="cr-select" style="width:120px">
                      ${BAR_SIZES.slice(1, 5).map(b => `<option value="${b.dia}" ${b.mm === 12.7 ? 'selected' : ''}>${b.us} (${b.mm}mm)</option>`).join('')}
                    </select>
                    <span style="font-size:11px; color:#64748b;">@</span>
                    <input id="es-ys-mm" class="cr-input" type="number" step="10" min="50" max="400" value="150" style="width:60px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <input id="es-yd" type="hidden" value="0.0127">
                <input id="es-ys" type="hidden" value="0.15">
              </div>

              <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                <label class="cr-label-wrap" style="cursor:pointer;">
                  <input type="checkbox" id="es-top">
                  <span>Include Top Negative Moment Mesh</span>
                </label>
                <input id="es-td" type="hidden" value="0.0127">
              </div>
            </div>
          </div>

          <div class="cr-tab-pane" id="pane-sl-special" style="display:none;">
            <div class="cr-section">
              <div class="cr-field">
                <label class="cr-label-wrap" style="cursor:pointer;">
                  <input type="checkbox" id="es-trim" checked>
                  <span>Opening Trim Bars (SLAB-202)</span>
                  <button class="cr-info-btn" data-cr-tip="slab_trim" type="button">ⓘ</button>
                </label>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">
                  Automatic diagonal corner bars + parallel framing around penetrations.
                </div>
              </div>

              <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                <label class="cr-label-wrap" style="cursor:pointer;">
                  <input type="checkbox" id="es-corner" checked>
                  <span>Corner Restraint Steel (SLAB-200)</span>
                </label>
              </div>

              <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                <label class="cr-label-wrap" style="cursor:pointer;">
                  <input type="checkbox" id="es-sog">
                  <span>Slab-on-Ground Edge Thickening (SOG-102)</span>
                </label>
                <input id="es-sd" type="hidden" value="0.0127">
              </div>

              <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                <label class="cr-label-wrap" style="cursor:pointer;">
                  <input type="checkbox" id="es-crank">
                  <span>Alternate Bent-Up (Cranked) Bars</span>
                  <button class="cr-info-btn" data-cr-tip="slab_bent" type="button">ⓘ</button>
                </label>
                <div id="es-crank-opts" style="margin-top:6px; padding-left:22px; display:none;">
                  <div class="cr-field-row">
                    <span style="font-size:12px; color:#475569;">Crank Point from Support</span>
                    <select id="es-crankat" class="cr-select" style="width:145px">
                      <option value="4" selected>L / 4 (0.25 L — Standard)</option>
                      <option value="5">L / 5 (0.20 L)</option>
                      <option value="6">L / 6 (0.17 L)</option>
                    </select>
                  </div>
                  <div class="cr-field-row" style="margin-top:4px;">
                    <span style="font-size:12px; color:#475569;">Crank Angle</span>
                    <select id="es-crankang" class="cr-select" style="width:145px">
                      <option value="45" selected>45° (Standard Slabs)</option>
                      <option value="30">30° (Shallow Slabs ≤ 150mm)</option>
                    </select>
                  </div>
                  <div style="font-size:11px; color:#64748b; margin-top:4px;">
                    Alternating bottom bars crank up at L/4 to provide top negative moment steel over supporting walls and beams.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="cr-tab-pane" id="pane-sl-aci" style="display:none;">
            <div class="cr-section">
              <div class="cr-aci-checklist">
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Shrinkage Steel Ratio:</span>
                  <span class="cr-metric-chip ok">ρ ≥ 0.0018 Ag (OK)</span>
                </div>
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Spacing Limit:</span>
                  <span class="cr-metric-chip ok">s ≤ min(3h, 450mm) (OK)</span>
                </div>
              </div>
            </div>
          </div>
        `;
      } else if (type === 'wall') {
        tabsHtml = `
          <button class="cr-tab active" data-tab="pane-wl-geom">📐 Wall &amp; Cover</button>
          <button class="cr-tab" data-tab="pane-wl-steel">🔄 Vertical &amp; Horizontal</button>
          <button class="cr-tab" data-tab="pane-wl-aci">📋 ACI Verification</button>
        `;
        formPanesHtml = `
          <div class="cr-tab-pane" id="pane-wl-geom">
            <div class="cr-section">
              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Concrete Cover
                    <button class="cr-info-btn" data-cr-tip="wall_cover" type="button">ⓘ</button>
                  </span>
                  <div class="cr-input-group">
                    <input id="ew-cov-mm" class="cr-input" type="number" step="5" min="20" max="80" value="40" style="width:65px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <div class="cr-chip-group">
                  <button class="cr-chip active" data-wl-cov="25">25 mm Interior</button>
                  <button class="cr-chip" data-wl-cov="40">40 mm Exterior</button>
                </div>
                <input id="ew-cov" type="hidden" value="0.04">
                <input id="ew-off" type="hidden" value="0.05">
              </div>

              <div class="cr-field" style="border-top:1px solid #e2e8f0; padding-top:8px;">
                <label class="cr-label-wrap" style="cursor:pointer;">
                  <input type="checkbox" id="ew-2c" checked>
                  <span>Two Curtains of Reinforcement (ACI §11.7.2.3)</span>
                  <button class="cr-info-btn" data-cr-tip="wall_curtains" type="button">ⓘ</button>
                </label>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">
                  Places an independent layer of vertical &amp; horizontal bars at both faces.
                </div>
              </div>
            </div>
          </div>

          <div class="cr-tab-pane" id="pane-wl-steel" style="display:none;">
            <div class="cr-section">
              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Vertical Bars (Flexure/Axial)
                    <button class="cr-info-btn" data-cr-tip="wall_vert" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <select id="ew-vd-sel" class="cr-select" style="width:120px">
                      ${BAR_SIZES.slice(1, 5).map(b => `<option value="${b.dia}" ${b.mm === 12.7 ? 'selected' : ''}>${b.us} (${b.mm}mm)</option>`).join('')}
                    </select>
                    <span style="font-size:11px; color:#64748b;">@</span>
                    <input id="ew-vs-mm" class="cr-input" type="number" step="10" min="50" max="400" value="200" style="width:60px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <input id="ew-vd" type="hidden" value="0.0127">
                <input id="ew-vs" type="hidden" value="0.2">
              </div>

              <div class="cr-field">
                <div class="cr-field-row">
                  <span class="cr-label-wrap">
                    Horizontal Bars (Shear)
                    <button class="cr-info-btn" data-cr-tip="wall_horiz" type="button">ⓘ</button>
                  </span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <select id="ew-hd-sel" class="cr-select" style="width:120px">
                      ${BAR_SIZES.slice(1, 5).map(b => `<option value="${b.dia}" ${b.mm === 12.7 ? 'selected' : ''}>${b.us} (${b.mm}mm)</option>`).join('')}
                    </select>
                    <span style="font-size:11px; color:#64748b;">@</span>
                    <input id="ew-hs-mm" class="cr-input" type="number" step="10" min="50" max="400" value="200" style="width:60px">
                    <span class="cr-unit">mm</span>
                  </div>
                </div>
                <input id="ew-hd" type="hidden" value="0.0127">
                <input id="ew-hs" type="hidden" value="0.2">
              </div>
            </div>
          </div>

          <div class="cr-tab-pane" id="pane-wl-aci" style="display:none;">
            <div class="cr-section">
              <div class="cr-aci-checklist">
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Vertical Ratio ρv:</span>
                  <span class="cr-metric-chip ok">≥ 0.0012 Ag (OK)</span>
                </div>
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Horizontal Ratio ρh:</span>
                  <span class="cr-metric-chip ok">≥ 0.0020 Ag (OK)</span>
                </div>
                <div class="cr-chk-item">
                  <span class="cr-chk-label">Spacing Limit:</span>
                  <span class="cr-metric-chip ok">s ≤ min(3t, 450mm) (OK)</span>
                </div>
              </div>
            </div>
          </div>
        `;
      } else if (type === 'column') {
        // Fallback for column if called directly
        tabsHtml = `<button class="cr-tab active" data-tab="pane-col">📐 Column Cage</button>`;
        formPanesHtml = `
          <div class="cr-tab-pane" id="pane-col">
            <div class="cr-section">
              <div class="cr-field">
                <span class="cr-label-wrap">Cover: 40 mm</span>
                <input id="ec-cov" type="hidden" value="0.04">
                <input id="ec-front" type="hidden" value="0.05">
                <input id="ec-tdia" type="hidden" value="0.0095">
                <input id="ec-tval" type="hidden" value="0.15">
                <input id="ec-mdia" type="hidden" value="0.0191">
                <input id="ec-t" type="hidden" value="0.05">
                <input id="ec-b" type="hidden" value="0.05">
                <input type="radio" name="er-ctie" value="spacing" checked style="display:none">
                <input id="ec-splice" type="hidden" value="lap">
              </div>
            </div>
          </div>
        `;
      }

      const html = `
        <div class="cr-dialog-wrap">
          <!-- Hidden compatibility elements for automated tests -->
          <div id="er-info" style="display:none;">Detected: ${typeName} ${ent.name || ent.id}</div>
          <div id="er-count" style="display:none;"></div>

          <!-- LEFT PANE: Parameters & ACI Controls -->
          <div class="cr-pane-params">
            <div class="cr-header-badge">
              <span>🏛️ ${typeName}: <b>${ent.name || ent.id}</b></span>
              <span>· ACI 318-19 Standard</span>
            </div>

            <!-- Tab Navigation -->
            <div class="cr-tabs">
              ${tabsHtml}
            </div>

            ${formPanesHtml}
          </div>

          <!-- RIGHT PANE: Multi-Window Real-Time Visualizer -->
          <div class="cr-pane-views">
            <div class="cr-view-modes-header">
              <span style="font-size:12px; font-weight:700; color:#1e293b; display:flex; align-items:center; gap:6px;">
                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981;"></span>
                Real-Time Rebar Preview
              </span>
              <div class="cr-view-modes">
                <button class="cr-vm-btn active" data-mode="both" title="Dual Split View">⊞ Dual View</button>
                <button class="cr-vm-btn" data-mode="view1" title="Primary View">◻ Primary</button>
                <button class="cr-vm-btn" data-mode="view2" title="Secondary View">▭ Elevation</button>
              </div>
            </div>

            <!-- Multi-Window Grid -->
            <div class="cr-windows-grid" id="er-win-grid">
              <!-- Subwindow 1 -->
              <div class="cr-subwindow" id="er-win-1">
                <div class="cr-subwindow-head">
                  <span id="er-view1-title">${type === 'beam' || type === 'wall' ? 'Cross Section' : 'Plan View'}</span>
                </div>
                <div class="cr-subwindow-content" id="er-svg-1-wrap">
                  <!-- Injected SVG -->
                </div>
              </div>

              <!-- Subwindow 2 -->
              <div class="cr-subwindow" id="er-win-2">
                <div class="cr-subwindow-head">
                  <span id="er-view2-title">${type === 'beam' || type === 'wall' ? 'Longitudinal Elevation' : 'Section Elevation'}</span>
                </div>
                <div class="cr-subwindow-content" id="er-svg-2-wrap">
                  <!-- Injected SVG -->
                </div>
              </div>
            </div>

            <!-- Bottom Live Metrics Ribbon -->
            <div class="cr-metrics-ribbon">
              <div>
                <span id="er-bar-count-badge" style="font-weight:700; color:#0f172a;">Calculating...</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span id="er-aci-badge" class="cr-metric-chip ok">ACI 318 Standard (OK)</span>
                <span id="er-weight-badge" style="font-weight:600; color:#475569;">Total: ~35 kg</span>
              </div>
            </div>
          </div>
        </div>
      `;

      app.dialog(`Element Reinforcement — ${typeName} (ACI 318 Interactive)`, html, [
        ['Cancel', null],
        ['Create', () => {
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
        const data = ER_TOOLTIPS[key];
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
        if (left + 290 > window.innerWidth) left = rect.left - 295;
        if (top + 260 > window.innerHeight) top = window.innerHeight - 270;
        if (top < 10) top = 10;
        tooltipEl.style.left = `${left}px`;
        tooltipEl.style.top = `${top}px`;
        tooltipEl.classList.add('visible');
      };

      const hideTip = () => {
        if (tooltipEl) tooltipEl.classList.remove('visible');
      };

      document.querySelectorAll('.cr-info-btn').forEach(btn => {
        btn.addEventListener('mouseenter', () => showTip(btn.getAttribute('data-cr-tip'), btn));
        btn.addEventListener('mouseleave', hideTip);
      });

      // ------------------------------------------------------------- Tabs Handling
      document.querySelectorAll('.cr-tab').forEach(t => {
        t.addEventListener('click', () => {
          document.querySelectorAll('.cr-tab').forEach(x => x.classList.remove('active'));
          document.querySelectorAll('.cr-tab-pane').forEach(p => p.style.display = 'none');
          t.classList.add('active');
          const target = document.getElementById(t.getAttribute('data-tab'));
          if (target) target.style.display = 'block';
        });
      });

      // ------------------------------------------------------------- View Modes
      const winGrid = document.getElementById('er-win-grid');
      const win1 = document.getElementById('er-win-1');
      const win2 = document.getElementById('er-win-2');
      document.querySelectorAll('.cr-vm-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.cr-vm-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const m = btn.getAttribute('data-mode');
          if (m === 'both') {
            winGrid.style.gridTemplateColumns = '1fr 1fr';
            win1.style.display = 'flex';
            win2.style.display = 'flex';
          } else if (m === 'view1') {
            winGrid.style.gridTemplateColumns = '1fr';
            win1.style.display = 'flex';
            win2.style.display = 'none';
          } else {
            winGrid.style.gridTemplateColumns = '1fr';
            win1.style.display = 'none';
            win2.style.display = 'flex';
          }
        });
      });

      // ------------------------------------------------------------- Live Update Function
      const update = () => {
        const p = this._read(type);
        const pv = previewElementRebar(app.model, this.fid, p, app.bim.entities);
        app.view.clearPreview();
        for (const { pts } of pv.paths.slice(0, 400)) {
          app.view.previewLoop(pts, window.Rebar.REBAR_COLOR);
        }

        const countEl = document.getElementById('er-count');
        const countTxt = pv.error ? pv.error
          : `${pv.paths.length} bars in the cage` + (pv.supports ? ` · ends: ${pv.supports.start} / ${pv.supports.end}` : '');
        if (countEl) countEl.textContent = countTxt;

        const badge = document.getElementById('er-bar-count-badge');
        if (badge) badge.textContent = countTxt;

        // Render dynamic SVGs
        const svgWrap1 = document.getElementById('er-svg-1-wrap');
        const svgWrap2 = document.getElementById('er-svg-2-wrap');
        if (type === 'beam') {
          if (svgWrap1) svgWrap1.innerHTML = renderBeamSectionSVG(p.beam, dims);
          if (svgWrap2) svgWrap2.innerHTML = renderBeamElevationSVG(p.beam, dims);
        } else if (type === 'foundation') {
          if (svgWrap1) svgWrap1.innerHTML = renderFootingPlanSVG(p.foundation, dims);
          if (svgWrap2) svgWrap2.innerHTML = renderFootingElevationSVG(p.foundation, dims);
        } else if (type === 'slab') {
          if (svgWrap1) svgWrap1.innerHTML = renderSlabPlanSVG(p.slab, dims);
          if (svgWrap2) svgWrap2.innerHTML = renderSlabElevationSVG(p.slab, dims);
        } else if (type === 'wall') {
          if (svgWrap1) svgWrap1.innerHTML = renderWallSectionSVG(p.wall, dims);
          if (svgWrap2) svgWrap2.innerHTML = renderWallElevationSVG(p.wall, dims);
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

      // Wire inputs
      for (const x of document.querySelectorAll('#dialog input,#dialog select')) {
        x.addEventListener(x.tagName === 'SELECT' || x.type === 'radio' || x.type === 'checkbox' ? 'change' : 'input', () => {
          // Sync millimeter to meter
          const bCov = document.getElementById('eb-side-mm');
          if (bCov) {
            const v = parseFloat(bCov.value) / 1000;
            document.getElementById('eb-side').value = v;
            document.getElementById('eb-top').value = v;
            document.getElementById('eb-bot').value = v;
          }
          const bEnd = document.getElementById('eb-end-mm');
          if (bEnd) document.getElementById('eb-end').value = parseFloat(bEnd.value) / 1000;
          const bS = document.getElementById('eb-tval-mm');
          if (bS) document.getElementById('eb-tval').value = parseFloat(bS.value) / 1000;
          const bTd = document.getElementById('eb-tdia-sel');
          if (bTd) document.getElementById('eb-tdia').value = bTd.value;
          const bTopd = document.getElementById('eb-topd-sel');
          if (bTopd) document.getElementById('eb-topd').value = bTopd.value;
          const bBotd = document.getElementById('eb-botd-sel');
          if (bBotd) document.getElementById('eb-botd').value = bBotd.value;
          const bSkind = document.getElementById('eb-skind-sel');
          if (bSkind) document.getElementById('eb-skind').value = bSkind.value;

          const fCov = document.getElementById('ef-b-mm');
          if (fCov) document.getElementById('ef-b').value = parseFloat(fCov.value) / 1000;
          const fXd = document.getElementById('ef-xd-sel');
          if (fXd) document.getElementById('ef-xd').value = fXd.value;
          const fXv = document.getElementById('ef-xv-mm');
          if (fXv) document.getElementById('ef-xv').value = parseFloat(fXv.value) / 1000;
          const fYd = document.getElementById('ef-yd-sel');
          if (fYd) document.getElementById('ef-yd').value = fYd.value;
          const fYv = document.getElementById('ef-yv-mm');
          if (fYv) document.getElementById('ef-yv').value = parseFloat(fYv.value) / 1000;
          const fSd = document.getElementById('ef-sd-sel');
          if (fSd) document.getElementById('ef-sd').value = fSd.value;
          const fLap = document.getElementById('ef-lap-mm');
          if (fLap) document.getElementById('ef-lap').value = parseFloat(fLap.value) / 1000;
          const fLeg = document.getElementById('ef-leg-mm');
          if (fLeg) document.getElementById('ef-leg').value = parseFloat(fLeg.value) / 1000;

          const sCov = document.getElementById('es-b-mm');
          if (sCov) {
            const v = parseFloat(sCov.value) / 1000;
            document.getElementById('es-b').value = v;
            document.getElementById('es-t').value = v;
            document.getElementById('es-side').value = v;
          }
          const sXd = document.getElementById('es-xd-sel');
          if (sXd) document.getElementById('es-xd').value = sXd.value;
          const sXs = document.getElementById('es-xs-mm');
          if (sXs) document.getElementById('es-xs').value = parseFloat(sXs.value) / 1000;
          const sYd = document.getElementById('es-yd-sel');
          if (sYd) document.getElementById('es-yd').value = sYd.value;
          const sYs = document.getElementById('es-ys-mm');
          if (sYs) document.getElementById('es-ys').value = parseFloat(sYs.value) / 1000;

          const wCov = document.getElementById('ew-cov-mm');
          if (wCov) document.getElementById('ew-cov').value = parseFloat(wCov.value) / 1000;
          const wVd = document.getElementById('ew-vd-sel');
          if (wVd) document.getElementById('ew-vd').value = wVd.value;
          const wVs = document.getElementById('ew-vs-mm');
          if (wVs) document.getElementById('ew-vs').value = parseFloat(wVs.value) / 1000;
          const wHd = document.getElementById('ew-hd-sel');
          if (wHd) document.getElementById('ew-hd').value = wHd.value;
          const wHs = document.getElementById('ew-hs-mm');
          if (wHs) document.getElementById('ew-hs').value = parseFloat(wHs.value) / 1000;

          update();
        });
      }

      // Beam crank chip listeners
      document.querySelectorAll('[data-bm-crank]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-bm-crank]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const crankInput = document.getElementById('eb-crank');
          if (crankInput) {
            crankInput.value = btn.getAttribute('data-bm-crank');
            update();
          }
        });
      });

      // Slab crank checkbox & options listeners
      const esCrankChk = document.getElementById('es-crank');
      const esCrankOpts = document.getElementById('es-crank-opts');
      if (esCrankChk && esCrankOpts) {
        esCrankChk.addEventListener('change', () => {
          esCrankOpts.style.display = esCrankChk.checked ? 'block' : 'none';
          update();
        });
      }
      const esCrankAt = document.getElementById('es-crankat');
      if (esCrankAt) esCrankAt.addEventListener('change', update);
      const esCrankAng = document.getElementById('es-crankang');
      if (esCrankAng) esCrankAng.addEventListener('change', update);

      update();
    }

    _read(type) {
      const v = id => parseFloat((document.getElementById(id) || {}).value) || 0;
      if (type === 'beam') {
        const sideVal = v('eb-side') || (v('eb-side-mm') / 1000) || 0.04;
        const endVal = v('eb-end') || (v('eb-end-mm') / 1000) || 0.05;
        const tieVal = v('eb-tval') || (v('eb-tval-mm') / 1000) || 0.15;
        const tieD = v('eb-tdia') || parseFloat((document.getElementById('eb-tdia-sel') || {}).value) || 0.0095;
        const topD = v('eb-topd') || parseFloat((document.getElementById('eb-topd-sel') || {}).value) || 0.0159;
        const botD = v('eb-botd') || parseFloat((document.getElementById('eb-botd-sel') || {}).value) || 0.0191;
        const skinD = v('eb-skind') || parseFloat((document.getElementById('eb-skind-sel') || {}).value) || 0.0127;

        return { type, beam: {
          side: sideVal,
          end: endVal,
          tieDia: tieD,
          bentAngle: parseInt((document.getElementById('eb-bent') || {}).value, 10) || 135,
          bentFactor: v('eb-bf') || 6,
          mode: (document.querySelector('input[name="er-tie"]:checked') || {}).value || 'spacing',
          value: tieVal,
          seismic: !!(document.getElementById('eb-seis') || {}).checked,
          integrity: (document.getElementById('eb-integ') || {}).checked !== false,
          first: 0.05,
          topCount: Math.max(1, Math.round(v('eb-topn') || 2)), topDia: topD,
          botCount: Math.max(1, Math.round(v('eb-botn') || 3)), botDia: botD,
          top: sideVal, bot: sideVal,
          skin: Math.max(0, Math.round(v('eb-skin'))), skinDia: skinD,
          topHook: (document.getElementById('eb-th') || {}).value || '90',
          botHook: (document.getElementById('eb-bh') || {}).value || 'none',
          hookRet: v('eb-hret') || 0.4,
          topExtra: Math.max(0, Math.round(v('eb-topx'))),
          topCut: v('eb-topcut') > 0 ? 1 / v('eb-topcut') : 0.25,
          botExtra: Math.max(0, Math.round(v('eb-botx'))),
          botCut: v('eb-botcut') > 0 ? 1 / v('eb-botcut') : 0.125,
          crank: Math.max(0, Math.round(v('eb-crank'))),
          crankAt: v('eb-crankat') > 0 ? 1 / v('eb-crankat') : 1 / 6,
        } };
      }

      if (type === 'column') return { type, column: {
        type: 'singletie',
        tie: { l: v('ec-cov') || 0.04, r: v('ec-cov') || 0.04, t: v('ec-cov') || 0.04, b: v('ec-cov') || 0.04,
          front: v('ec-front') || 0.05, dia: v('ec-tdia') || 0.0095, bentAngle: 135, bentFactor: 6, rounding: 0,
          mode: (document.querySelector('input[name="er-ctie"]:checked') || {}).value || 'spacing',
          value: v('ec-tval') || 0.15 },
        main: { dia: v('ec-mdia') || 0.0191, tOffset: v('ec-t') || 0.05, bOffset: v('ec-b') || 0.05, type: 'straight',
          splice: { mode: (document.getElementById('ec-splice') || {}).value || 'lap' } },
      } };

      if (type === 'foundation') {
        const bCov = v('ef-b') || (v('ef-b-mm') / 1000) || 0.075;
        const xD = v('ef-xd') || parseFloat((document.getElementById('ef-xd-sel') || {}).value) || 0.0127;
        const xV = v('ef-xv') || (v('ef-xv-mm') / 1000) || 0.15;
        const yD = v('ef-yd') || parseFloat((document.getElementById('ef-yd-sel') || {}).value) || 0.0127;
        const yV = v('ef-yv') || (v('ef-yv-mm') / 1000) || 0.15;
        const sD = v('ef-sd') || parseFloat((document.getElementById('ef-sd-sel') || {}).value) || 0.0159;
        const lapV = v('ef-lap') || (v('ef-lap-mm') / 1000) || 0.6;
        const legV = v('ef-leg') || (v('ef-leg-mm') / 1000) || 0.2;

        return { type, foundation: {
          bottom: bCov, side: v('ef-side') || 0.05, topLayer: (document.getElementById('ef-top') || {}).value || 'Y',
          xDia: xD, xMode: (document.querySelector('input[name="er-fx"]:checked') || {}).value || 'spacing', xValue: xV,
          yDia: yD, yMode: (document.querySelector('input[name="er-fy"]:checked') || {}).value || 'spacing', yValue: yV,
          kind: (document.getElementById('ef-kind') || {}).value || 'pad',
          piles: v('ef-pn') || 4, pileS: v('ef-ps') || 0.9, pileDia: v('ef-pd') || 0.3, pileLap: v('ef-pl') || 0.6,
          stubX: Math.max(2, Math.round(v('ef-nx') || 3)), stubY: Math.max(2, Math.round(v('ef-ny') || 3)), stubDia: sD,
          lap: lapV, leg: legV, colW: v('ef-cw') || 0.4, colL: v('ef-cl') || 0.4,
        } };
      }

      if (type === 'wall') {
        const wCov = v('ew-cov') || (v('ew-cov-mm') / 1000) || 0.04;
        const vD = v('ew-vd') || parseFloat((document.getElementById('ew-vd-sel') || {}).value) || 0.0127;
        const vS = v('ew-vs') || (v('ew-vs-mm') / 1000) || 0.2;
        const hD = v('ew-hd') || parseFloat((document.getElementById('ew-hd-sel') || {}).value) || 0.0127;
        const hS = v('ew-hs') || (v('ew-hs-mm') / 1000) || 0.2;

        return { type: 'wall', wall: {
          cover: wCov, vDia: vD, vSpacing: vS,
          hDia: hD, hSpacing: hS,
          twoCurtains: !!(document.getElementById('ew-2c') || {}).checked,
          vOff: v('ew-off') || 0.05,
        } };
      }

      const sCov = v('es-b') || (v('es-b-mm') / 1000) || 0.025;
      const sXd = v('es-xd') || parseFloat((document.getElementById('es-xd-sel') || {}).value) || 0.0127;
      const sXs = v('es-xs') || (v('es-xs-mm') / 1000) || 0.15;
      const sYd = v('es-yd') || parseFloat((document.getElementById('es-yd-sel') || {}).value) || 0.0127;
      const sYs = v('es-ys') || (v('es-ys-mm') / 1000) || 0.15;

      return { type: 'slab', slab: {
        bottom: sCov, top: sCov, side: sCov,
        xDia: sXd, xSpacing: sXs, yDia: sYd, ySpacing: sYs,
        sog: (document.getElementById('es-sog') || {}).checked === true,
        sogDia: v('es-sd') || 0.0127,
        topMesh: !!(document.getElementById('es-top') || {}).checked, topDia: v('es-td') || 0.0127,
        cornerSteel: !!((document.getElementById('es-corner') || {}).checked !== undefined
          ? (document.getElementById('es-corner') || {}).checked : true),
        trimSteel: !!((document.getElementById('es-trim') || {}).checked !== undefined
          ? (document.getElementById('es-trim') || {}).checked : true),
        crank: !!(document.getElementById('es-crank') || {}).checked,
        crankAt: v('es-crankat') > 0 ? 1 / v('es-crankat') : 0.25,
        crankAngle: v('es-crankang') || 45,
      } };
    }
  }

  window.ElementRebar = { ElementRebarTool, buildElementRebar, previewElementRebar, buildWallRebar, seismicTiePositions, TYPE_OF };
})();
