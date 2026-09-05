'use strict';
// ---------------------------------------------------------------------------
// columnFamilies.js — the parametric Column family catalog.
//
// Pure data + plan-ring geometry: no DOM, no THREE, no app references, so it
// loads beside geometry.js in the unit-test sandbox. Every family describes
// its silhouette as a STACK OF SEGMENTS — a plan ring (closed polygon in XY,
// centered on the column axis) extruded over a z band. The B-Rep conversion
// lives in StructuralManager.buildColumn (ring at the segment top + pushPull
// down), exactly like the plain rectangular column, so family columns weld
// into slabs / grids / undo the same way.
//
//   segment   { ring: [{x,y}...] CCW, f: heightFraction | h: meters, role }
//   roles     'base' | 'shaft' | 'capital' | 'panel' | 'solid'
//
// DIMENSIONS ARE FULLY PARAMETRIC: the user types a width (X) and depth (Y);
// every tier scales from them (shafts, capitals, drop panels...). Height is
// NOT part of the family — columns stay level-driven (base level → top
// level), so families express tiers as FRACTIONS of the story height and
// re-proportion themselves at any H. Curves are polygon approximations
// (24-gon cylinders, stepped tapers for entasis/bulges); ornament is stylized
// silhouettes, not sculpted carving.
//
// Groups: classical (the five Roman/Greek orders) · regional (Egyptian,
// Mesopotamian/Iraqi, Persian, Ottoman, Chinese) · modern (RC sections) ·
// structural (drop panel, brackets, composite plans).
// ---------------------------------------------------------------------------
(function (root) {

  const MIN_RING = 0.04;   // smallest plan dimension a ring may carry (m)
  const MIN_SEG = 0.018;   // shortest extrudable segment (m); shorter tiers merge

  // ================================================================ plan rings
  // All helpers return CCW rings centered at the origin ({x, y} points).
  const Ring = {
    /** Axis-aligned rectangle w × d. */
    rect(w, d) {
      const a = Math.max(MIN_RING, w) / 2, b = Math.max(MIN_RING, d) / 2;
      return [{ x: -a, y: -b }, { x: a, y: -b }, { x: a, y: b }, { x: -a, y: b }];
    },
    /** Regular n-gon over an w × d ellipse (n-gon circle when w === d). */
    ngon(w, d, n) {
      const a = Math.max(MIN_RING, w) / 2, b = Math.max(MIN_RING, d) / 2;
      const out = [];
      const N = Math.max(3, n | 0);
      for (let i = 0; i < N; i++) {
        const t = (i / N) * 2 * Math.PI;
        out.push({ x: Math.cos(t) * a, y: Math.sin(t) * b });
      }
      return out;
    },
    /** Rectangle with the four corners chamfered by c (8-point ring). */
    chamferRect(w, d, c) {
      const a = Math.max(MIN_RING, w) / 2, b = Math.max(MIN_RING, d) / 2;
      const k = Math.min(c, a * 0.9, b * 0.9);
      return [
        { x: -a + k, y: -b }, { x: a - k, y: -b }, { x: a, y: -b + k }, { x: a, y: b - k },
        { x: a - k, y: b }, { x: -a + k, y: b }, { x: -a, y: b - k }, { x: -a, y: -b + k },
      ];
    },
    /** Lobed ring (fluted shaft / reed bundle): radius dips by `amp` between
     *  lobes. amp > 0 = concave flutes, the classic column outline. */
    flower(w, d, lobes, amp) {
      const a = Math.max(MIN_RING, w) / 2, b = Math.max(MIN_RING, d) / 2;
      const L = Math.max(3, lobes | 0), A = Math.min(0.45, Math.max(0, amp));
      const out = [];
      for (let i = 0; i < L * 2; i++) {
        const t = (i / (L * 2)) * 2 * Math.PI;
        const k = i % 2 === 0 ? 1 : 1 - A;
        out.push({ x: Math.cos(t) * a * k, y: Math.sin(t) * b * k });
      }
      return out;
    },
    /** Capsule / stadium along X: two D-wide lobes at ±(w-d)/2 joined by a
     *  web — the "twin coupled" column silhouette. */
    stadium(w, d) {
      const D = Math.max(MIN_RING, d);
      const W = Math.max(D + MIN_RING, w);
      const r = D / 2, c = (W - D) / 2;
      const out = [];
      const N = 10; // points per semicircle
      for (let i = 0; i <= N; i++) { // right lobe, bottom → top (CCW side)
        const t = -Math.PI / 2 + (i / N) * Math.PI;
        out.push({ x: c + Math.cos(t) * r, y: Math.sin(t) * r });
      }
      for (let i = 0; i <= N; i++) { // left lobe, top → bottom
        const t = Math.PI / 2 + (i / N) * Math.PI;
        out.push({ x: -c + Math.cos(t) * r, y: Math.sin(t) * r });
      }
      return out;
    },
    /** Cross / plus plan: w × d overall, arms `t` thick (12-point ring). */
    plus(w, d, t) {
      const a = Math.max(MIN_RING, w) / 2, b = Math.max(MIN_RING, d) / 2;
      const k = Math.min(t, a * 0.95, b * 0.95) / 2;
      return [
        { x: -a, y: -k }, { x: -k, y: -k }, { x: -k, y: -b }, { x: k, y: -b },
        { x: k, y: -k }, { x: a, y: -k }, { x: a, y: k }, { x: k, y: k },
        { x: k, y: b }, { x: -k, y: b }, { x: -k, y: k }, { x: -a, y: k },
      ];
    },
    /** L plan: w × d overall, one leg `t` thick (6-point ring). */
    ell(w, d, t) {
      const a = Math.max(MIN_RING, w) / 2, b = Math.max(MIN_RING, d) / 2;
      const k = Math.min(t, a * 0.95, b * 0.95);
      return [
        { x: -a, y: -b }, { x: a, y: -b }, { x: a, y: -b + k },
        { x: -a + k, y: -b + k }, { x: -a + k, y: b }, { x: -a, y: b },
      ];
    },
    /** T plan: cap across w, stem `t` thick down d (8-point ring). */
    tee(w, d, t) {
      const a = Math.max(MIN_RING, w) / 2, b = Math.max(MIN_RING, d) / 2;
      const k = Math.min(t, a * 0.95, b * 0.95);
      return [
        { x: -a, y: b }, { x: a, y: b }, { x: a, y: b - k }, { x: k / 2, y: b - k },
        { x: k / 2, y: -b }, { x: -k / 2, y: -b }, { x: -k / 2, y: b - k }, { x: -a, y: b - k },
      ];
    },
    bounds(ring) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of ring) {
        if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
        if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
      }
      return { x0, x1, y0, y1, w: x1 - x0, d: y1 - y0 };
    },
  };

  // ============================================================= taper stacks
  // A smooth frustum cannot be pushed through the B-Rep kernel, so tapers
  // (entasis, bulges, bells) are STEPPED: n slices whose rings interpolate
  // linearly between the end sections. 4–8 slices read as a taper at sketch
  // scale and keep the face count sane.
  const TAPER = { rect: Ring.rect, ngon: Ring.ngon, flower: Ring.flower };

  /** n stacked segments from (w0,d0) to (w1,d1); `f` is the TOTAL height
   *  fraction, split evenly. shape: 'rect' | 'ngon' | 'flower'. */
  function taperSegs(shape, w0, d0, w1, d1, f, n, role, lobes, amp) {
    const out = [];
    const N = Math.max(1, n | 0);
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const wA = w0 + (w1 - w0) * t0, dA = d0 + (d1 - d0) * t0;
      const wB = w0 + (w1 - w0) * t1, dB = d0 + (d1 - d0) * t1;
      // each slice is a mean-section prism (cheaper than a true frustum and
      // visually identical at sketch scale)
      out.push({
        ring: shape === 'flower'
          ? Ring.flower((wA + wB) / 2, (dA + dB) / 2, lobes, amp)
          : TAPER[shape]((wA + wB) / 2, (dA + dB) / 2, shape === 'ngon' ? 24 : undefined),
        f: f / N, role,
      });
    }
    return out;
  }

  // ================================================================= families
  // Common parameter blocks (unit: 'mm' lengths, 'x' multipliers, 'n' counts)
  const P = {
    width: { key: 'width', label: 'Width (X)', def: 0.3, min: 0.05, unit: 'mm' },
    depth: { key: 'depth', label: 'Depth (Y)', def: 0.3, min: 0.05, unit: 'mm' },
  };
  const W = p => p.width, D = p => p.depth; // shaft nominal section

  const FAMILIES = [
    // ------------------------------------------------------------ classical
    {
      id: 'tuscan', name: 'Tuscan', group: 'classical',
      desc: 'Simplest Roman order — plain unfluted shaft, plain base and capital (~1:7).',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.rect(1.10 * W(p), 1.10 * D(p)), f: 0.04, role: 'base' },
        { ring: Ring.ngon(1.02 * W(p), 1.02 * D(p), 16), f: 0.03, role: 'base' },
        ...taperSegs('ngon', 0.86 * W(p), 0.86 * D(p), 0.72 * W(p), 0.72 * D(p), 0.80, 6, 'shaft'),
        { ring: Ring.ngon(0.78 * W(p), 0.78 * D(p), 16), f: 0.04, role: 'shaft' },
        ...taperSegs('ngon', 0.78 * W(p), 0.78 * D(p), 0.92 * W(p), 0.92 * D(p), 0.04, 2, 'capital'),
        { ring: Ring.rect(1.00 * W(p), 1.00 * D(p)), f: 0.05, role: 'capital' },
      ],
    },
    {
      id: 'greek_doric', name: 'Greek Doric', group: 'classical',
      desc: 'No base, 20-flute shaft with entasis, echinus + square abacus (~1:7).',
      params: [P.width, P.depth],
      build: p => [
        ...taperSegs('flower', 1.00 * W(p), 1.00 * D(p), 0.82 * W(p), 0.82 * D(p), 0.86, 5, 'shaft', 20, 0.12),
        ...taperSegs('ngon', 0.82 * W(p), 0.82 * D(p), 1.02 * W(p), 1.02 * D(p), 0.07, 2, 'capital'),
        { ring: Ring.rect(1.12 * W(p), 1.12 * D(p)), f: 0.07, role: 'capital' },
      ],
    },
    {
      id: 'roman_doric', name: 'Roman Doric', group: 'classical',
      desc: 'Doric on a plinth + torus base; fluted shaft, neck ring, echinus + abacus.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.rect(1.10 * W(p), 1.10 * D(p)), f: 0.04, role: 'base' },
        { ring: Ring.ngon(1.02 * W(p), 1.02 * D(p), 16), f: 0.03, role: 'base' },
        ...taperSegs('flower', 0.88 * W(p), 0.88 * D(p), 0.76 * W(p), 0.76 * D(p), 0.78, 5, 'shaft', 16, 0.14),
        { ring: Ring.ngon(0.80 * W(p), 0.80 * D(p), 16), f: 0.03, role: 'shaft' },
        ...taperSegs('ngon', 0.80 * W(p), 0.80 * D(p), 0.98 * W(p), 0.98 * D(p), 0.05, 2, 'capital'),
        { ring: Ring.rect(1.05 * W(p), 1.05 * D(p)), f: 0.07, role: 'capital' },
      ],
    },
    {
      id: 'roman_ionic', name: 'Roman Ionic', group: 'classical',
      desc: 'Slender order (~1:9) — attyrg base, volute-block capital with side scrolls.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.rect(1.15 * W(p), 1.15 * D(p)), f: 0.04, role: 'base' },
        { ring: Ring.ngon(1.00 * W(p), 1.00 * D(p), 16), f: 0.025, role: 'base' },
        { ring: Ring.ngon(0.92 * W(p), 0.92 * D(p), 16), f: 0.025, role: 'base' },
        ...taperSegs('ngon', 0.78 * W(p), 0.78 * D(p), 0.68 * W(p), 0.68 * D(p), 0.76, 6, 'shaft'),
        { ring: Ring.ngon(0.72 * W(p), 0.72 * D(p), 16), f: 0.03, role: 'shaft' },
        { ring: Ring.rect(1.25 * W(p), 0.85 * D(p)), f: 0.08, role: 'capital' }, // volute block
        { ring: Ring.rect(1.15 * W(p), 0.75 * D(p)), f: 0.04, role: 'capital' }, // abacus
      ],
    },
    {
      id: 'corinthian', name: 'Corinthian', group: 'classical',
      desc: 'The ornate Greek order — slender shaft, two-tier acanthus bell, chamfered abacus.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.rect(1.15 * W(p), 1.15 * D(p)), f: 0.04, role: 'base' },
        { ring: Ring.ngon(1.00 * W(p), 1.00 * D(p), 16), f: 0.03, role: 'base' },
        ...taperSegs('ngon', 0.78 * W(p), 0.78 * D(p), 0.66 * W(p), 0.66 * D(p), 0.74, 6, 'shaft'),
        { ring: Ring.ngon(0.70 * W(p), 0.70 * D(p), 16), f: 0.03, role: 'shaft' },
        { ring: Ring.flower(1.00 * W(p), 1.00 * D(p), 8, 0.20), f: 0.05, role: 'capital' }, // leaf tier 1
        { ring: Ring.flower(1.18 * W(p), 1.18 * D(p), 8, 0.20), f: 0.05, role: 'capital' }, // leaf tier 2
        { ring: Ring.chamferRect(1.35 * W(p), 1.35 * D(p), 0.25 * W(p)), f: 0.06, role: 'capital' }, // abacus
      ],
    },
    {
      id: 'composite', name: 'Composite', group: 'classical',
      desc: 'Roman hybrid — Ionic volutes over a Corinthian bell, the tallest capital.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.rect(1.15 * W(p), 1.15 * D(p)), f: 0.035, role: 'base' },
        { ring: Ring.ngon(1.00 * W(p), 1.00 * D(p), 16), f: 0.03, role: 'base' },
        ...taperSegs('ngon', 0.78 * W(p), 0.78 * D(p), 0.66 * W(p), 0.66 * D(p), 0.70, 6, 'shaft'),
        { ring: Ring.ngon(0.70 * W(p), 0.70 * D(p), 16), f: 0.025, role: 'shaft' },
        { ring: Ring.rect(1.15 * W(p), 0.80 * D(p)), f: 0.05, role: 'capital' }, // volute band
        { ring: Ring.flower(1.25 * W(p), 1.25 * D(p), 8, 0.20), f: 0.07, role: 'capital' }, // bell
        { ring: Ring.chamferRect(1.40 * W(p), 1.40 * D(p), 0.28 * W(p)), f: 0.09, role: 'capital' },
      ],
    },

    // ------------------------------------------------------------- regional
    {
      id: 'egyptian_lotus', name: 'Egyptian Lotus (bud)', group: 'regional',
      desc: 'Temple column — tapering shaft, closed lotus-bud capital, simple disc base.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.ngon(1.00 * W(p), 1.00 * D(p), 12), f: 0.03, role: 'base' },
        ...taperSegs('ngon', 1.00 * W(p), 1.00 * D(p), 0.88 * W(p), 0.88 * D(p), 0.78, 5, 'shaft'),
        ...taperSegs('ngon', 0.88 * W(p), 0.88 * D(p), 1.30 * W(p), 1.30 * D(p), 0.08, 4, 'capital'), // bud opens
        ...taperSegs('ngon', 1.30 * W(p), 1.30 * D(p), 0.95 * W(p), 0.95 * D(p), 0.06, 2, 'capital'), // bud closes
        { ring: Ring.rect(0.95 * W(p), 0.95 * D(p)), f: 0.05, role: 'capital' },
      ],
    },
    {
      id: 'egyptian_papyrus', name: 'Egyptian Papyrus (open)', group: 'regional',
      desc: 'Open papyrus umbel — bound shaft with tie ring, flaring bell capital.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.ngon(1.05 * W(p), 1.05 * D(p), 12), f: 0.03, role: 'base' },
        ...taperSegs('ngon', 1.00 * W(p), 1.00 * D(p), 0.85 * W(p), 0.85 * D(p), 0.74, 5, 'shaft'),
        { ring: Ring.ngon(0.90 * W(p), 0.90 * D(p), 12), f: 0.02, role: 'shaft' }, // binding band
        ...taperSegs('ngon', 0.85 * W(p), 0.85 * D(p), 1.40 * W(p), 1.40 * D(p), 0.13, 4, 'capital'), // umbel bell
        { ring: Ring.rect(1.00 * W(p), 1.00 * D(p)), f: 0.08, role: 'capital' }, // beam pad
      ],
    },
    {
      id: 'iraqi_babylonian', name: 'Iraqi Babylonian', group: 'regional',
      desc: 'Mesopotamian glazed-tile column — bulbous palm-trunk shaft, lotus crown.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.ngon(1.05 * W(p), 1.05 * D(p), 12), f: 0.04, role: 'base' },
        ...taperSegs('ngon', 0.95 * W(p), 0.95 * D(p), 1.25 * W(p), 1.25 * D(p), 0.14, 4, 'shaft'), // lower bulge
        ...taperSegs('ngon', 1.25 * W(p), 1.25 * D(p), 0.80 * W(p), 0.80 * D(p), 0.50, 6, 'shaft'), // waist
        { ring: Ring.ngon(0.85 * W(p), 0.85 * D(p), 16), f: 0.03, role: 'shaft' },
        ...taperSegs('ngon', 0.85 * W(p), 0.85 * D(p), 1.35 * W(p), 1.35 * D(p), 0.19, 5, 'capital'), // palm fronds
        { ring: Ring.chamferRect(1.10 * W(p), 1.10 * D(p), 0.2 * W(p)), f: 0.10, role: 'capital' },
      ],
    },
    {
      id: 'mesopotamian_reed', name: 'Mesopotamian Reed Bundle', group: 'regional',
      desc: 'The proto-column — bundled reeds bound with tie collars, flaring head pad.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.flower(1.10 * W(p), 1.10 * D(p), 7, 0.30), f: 0.03, role: 'base' },
        { ring: Ring.flower(1.00 * W(p), 1.00 * D(p), 7, 0.30), f: 0.34, role: 'shaft' },
        { ring: Ring.flower(1.12 * W(p), 1.12 * D(p), 7, 0.30), f: 0.03, role: 'shaft' }, // tie
        { ring: Ring.flower(1.00 * W(p), 1.00 * D(p), 7, 0.30), f: 0.34, role: 'shaft' },
        { ring: Ring.flower(1.12 * W(p), 1.12 * D(p), 7, 0.30), f: 0.03, role: 'shaft' }, // tie
        ...taperSegs('flower', 1.00 * W(p), 1.00 * D(p), 1.30 * W(p), 1.30 * D(p), 0.14, 3, 'capital', 7, 0.30),
        { ring: Ring.rect(0.95 * W(p), 0.95 * D(p)), f: 0.09, role: 'capital' },
      ],
    },
    {
      id: 'persian_persepolis', name: 'Persian Persepolis', group: 'regional',
      desc: 'Achaemenid hall column — very slender fluted shaft, double-bell capital, beast block.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.ngon(0.95 * W(p), 0.95 * D(p), 12), f: 0.03, role: 'base' },
        { ring: Ring.ngon(0.85 * W(p), 0.85 * D(p), 12), f: 0.02, role: 'base' },
        ...taperSegs('flower', 0.70 * W(p), 0.70 * D(p), 0.60 * W(p), 0.60 * D(p), 0.76, 6, 'shaft', 24, 0.10),
        ...taperSegs('ngon', 0.60 * W(p), 0.60 * D(p), 1.05 * W(p), 1.05 * D(p), 0.08, 3, 'capital'), // lower bell
        ...taperSegs('ngon', 1.05 * W(p), 1.05 * D(p), 0.75 * W(p), 0.75 * D(p), 0.04, 2, 'capital'), // upper bell
        { ring: Ring.rect(1.30 * W(p), 1.15 * D(p)), f: 0.07, role: 'capital' }, // beast/beam block
      ],
    },
    {
      id: 'ottoman', name: 'Ottoman', group: 'regional',
      desc: 'Slim fluted shaft under a stepped muqarnas cone and bracket capital.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.ngon(1.05 * W(p), 1.05 * D(p), 12), f: 0.03, role: 'base' },
        ...taperSegs('flower', 0.75 * W(p), 0.75 * D(p), 0.65 * W(p), 0.65 * D(p), 0.74, 5, 'shaft', 16, 0.12),
        { ring: Ring.ngon(1.15 * W(p), 1.15 * D(p), 16), f: 0.03, role: 'capital' }, // muqarnas tiers
        { ring: Ring.ngon(1.00 * W(p), 1.00 * D(p), 16), f: 0.03, role: 'capital' },
        { ring: Ring.ngon(0.85 * W(p), 0.85 * D(p), 16), f: 0.03, role: 'capital' },
        { ring: Ring.chamferRect(1.20 * W(p), 1.20 * D(p), 0.2 * W(p)), f: 0.09, role: 'capital' },
        { ring: Ring.rect(1.05 * W(p), 1.05 * D(p)), f: 0.05, role: 'capital' },
      ],
    },
    {
      id: 'chinese_dougong', name: 'Chinese Dougong', group: 'regional',
      desc: 'Round timber shaft under alternating dou-gong bracket tiers.',
      params: [P.width, P.depth],
      build: p => [
        { ring: Ring.rect(1.15 * W(p), 1.15 * D(p)), f: 0.05, role: 'base' },
        { ring: Ring.ngon(0.80 * W(p), 0.80 * D(p), 20), f: 0.68, role: 'shaft' },
        { ring: Ring.ngon(0.90 * W(p), 0.90 * D(p), 20), f: 0.03, role: 'shaft' }, // collar
        { ring: Ring.rect(1.25 * W(p), 0.80 * D(p)), f: 0.07, role: 'capital' }, // bracket arm X
        { ring: Ring.rect(1.00 * W(p), 1.10 * D(p)), f: 0.06, role: 'capital' }, // bracket arm Y
        { ring: Ring.rect(1.45 * W(p), 0.90 * D(p)), f: 0.06, role: 'capital' }, // upper arm X
        { ring: Ring.rect(1.15 * W(p), 1.15 * D(p)), f: 0.05, role: 'capital' }, // roof pad
      ],
    },

    // --------------------------------------------------------------- modern
    {
      id: 'rect', name: 'Rectangular RC', group: 'modern',
      desc: 'The plain reinforced-concrete prism — the default column.',
      params: [P.width, P.depth],
      build: p => [{ ring: Ring.rect(W(p), D(p)), f: 1, role: 'shaft' }],
    },
    {
      id: 'circular', name: 'Circular RC', group: 'modern',
      desc: 'Cast-in-place cylindrical column (24-sided approximation).',
      params: [P.width, P.depth],
      build: p => [{ ring: Ring.ngon(W(p), D(p), 24), f: 1, role: 'shaft' }],
    },
    {
      id: 'square', name: 'Square', group: 'modern',
      desc: 'Equal-sided square section.',
      params: [{ key: 'width', label: 'Width (X)', def: 0.3, min: 0.05, unit: 'mm' }, { key: 'depth', label: 'Depth (Y)', def: 0.3, min: 0.05, unit: 'mm' }],
      build: p => [{ ring: Ring.rect(W(p), D(p)), f: 1, role: 'shaft' }],
    },
    {
      id: 'eu_rect', name: 'EU Rect (EN 1992)', group: 'modern',
      desc: 'Eurocode-style rectangular column with chamfered corners.',
      params: [P.width, P.depth],
      build: p => [{
        ring: Ring.chamferRect(W(p), D(p), Math.min(W(p), D(p)) * 0.18), f: 1, role: 'shaft',
      }],
    },
    {
      id: 'slender', name: 'Slender', group: 'modern',
      desc: 'High-slenderness circular section for light gravity loads.',
      params: [
        { key: 'width', label: 'Width (X)', def: 0.18, min: 0.05, unit: 'mm' },
        { key: 'depth', label: 'Depth (Y)', def: 0.18, min: 0.05, unit: 'mm' },
      ],
      build: p => [{ ring: Ring.ngon(W(p), D(p), 24), f: 1, role: 'shaft' }],
    },
    {
      id: 'hexagonal', name: 'Hexagonal', group: 'modern',
      desc: 'Six-sided architectural section.',
      params: [P.width, P.depth],
      build: p => [{ ring: Ring.ngon(W(p), D(p), 6), f: 1, role: 'shaft' }],
    },
    {
      id: 'octagonal', name: 'Octagonal', group: 'modern',
      desc: 'Eight-sided section — the classic transition pier.',
      params: [P.width, P.depth],
      build: p => [{ ring: Ring.ngon(W(p), D(p), 8), f: 1, role: 'shaft' }],
    },
    {
      id: 'tapered', name: 'Modern Tapered', group: 'modern',
      desc: 'Pilotis-style tapered prism (contemporary entasis).',
      params: [P.width, P.depth],
      build: p => [
        ...taperSegs('rect', 1.00 * W(p), 1.00 * D(p), 0.72 * W(p), 0.72 * D(p), 1, 8, 'shaft'),
      ],
    },
    {
      id: 'fluted_round', name: 'Fluted Round', group: 'modern',
      desc: 'Circular section with concave flutes (lobes set below).',
      params: [
        P.width, P.depth,
        { key: 'lobes', label: 'Flutes', def: 12, min: 4, max: 28, unit: 'n' },
      ],
      build: p => [{
        ring: Ring.flower(W(p), D(p), Math.round(p.lobes || 12), 0.16), f: 1, role: 'shaft',
      }],
    },
    {
      id: 'twin_coupled', name: 'Twin Coupled', group: 'modern',
      desc: 'Two D-wide shafts coupled by a web — the Roman travertine silhouette.',
      params: [
        { key: 'width', label: 'Width (X)', def: 0.6, min: 0.15, unit: 'mm' },
        { key: 'depth', label: 'Depth (Y)', def: 0.3, min: 0.05, unit: 'mm' },
      ],
      build: p => [{ ring: Ring.stadium(W(p), D(p)), f: 1, role: 'shaft' }],
    },

    // ----------------------------------------------------------- structural
    {
      id: 'drop_panel', name: 'Drop Panel (flat slab)', group: 'structural',
      desc: 'Flat-slab column — the widened drop head hangs UNDER the slab above '
        + '(punching shear). Draw it before or after the slab: the head follows the '
        + 'soffit automatically. Extend ~span/6; thickness ≤ ¼ of the slab.',
      params: [
        P.width, P.depth,
        { key: 'dropWidth', label: 'Drop Width (X)', def: 0.9, min: 0.15, unit: 'mm' },
        { key: 'dropDepth', label: 'Drop Depth (Y)', def: 0.9, min: 0.15, unit: 'mm' },
        { key: 'dropThickness', label: 'Drop Thickness', def: 0.15, min: 0.03, unit: 'mm' },
      ],
      // absolute heights: the drop panel keeps its real thickness at any story.
      // The stack's TOP (panel) is placed by StructuralManager.columnSolidTop —
      // under the covering slab's soffit when one exists, else at the level plane.
      build: p => [
        { ring: Ring.rect(W(p), D(p)), h: null, f: null, role: 'shaft' }, // h filled by parts()
        { ring: Ring.rect(p.dropWidth, p.dropDepth), h: p.dropThickness, role: 'panel' },
      ],
    },
    {
      id: 'bracket_capital', name: 'Bracket Capital', group: 'structural',
      desc: 'RC column with a wide square head to catch heavy beam framing.',
      params: [
        P.width, P.depth,
        { key: 'capScale', label: 'Capital Scale ×', def: 1.6, min: 1, max: 3, unit: 'x' },
      ],
      build: p => [
        { ring: Ring.rect(W(p), D(p)), f: 0.80, role: 'shaft' },
        { ring: Ring.chamferRect(p.capScale * W(p), p.capScale * D(p), 0.15 * W(p)), f: 0.20, role: 'capital' },
      ],
    },
    {
      id: 'cross', name: 'Cross (Plus)', group: 'structural',
      desc: 'Cruciform plan — stiff in both directions (classic bridge pier).',
      params: [
        P.width, P.depth,
        { key: 'webThick', label: 'Arm Thickness', def: 0.18, min: 0.05, unit: 'mm' },
      ],
      build: p => [{ ring: Ring.plus(W(p), D(p), p.webThick || 0.18), f: 1, role: 'shaft' }],
    },
    {
      id: 'l_plan', name: 'L-Plan', group: 'structural',
      desc: 'Edge/rigid corner column with an L section.',
      params: [
        P.width, P.depth,
        { key: 'webThick', label: 'Leg Thickness', def: 0.18, min: 0.05, unit: 'mm' },
      ],
      build: p => [{ ring: Ring.ell(W(p), D(p), p.webThick || 0.18), f: 1, role: 'shaft' }],
    },
    {
      id: 't_plan', name: 'T-Plan', group: 'structural',
      desc: 'T section — wall-end column carrying a one-sided slab band.',
      params: [
        P.width, P.depth,
        { key: 'webThick', label: 'Stem Thickness', def: 0.18, min: 0.05, unit: 'mm' },
      ],
      build: p => [{ ring: Ring.tee(W(p), D(p), p.webThick || 0.18), f: 1, role: 'shaft' }],
    },
  ];

  // ================================================================= layout
  /** Fractions → absolute z bands [z0, z1] over the story height H, bottom-up.
   *  Tiers thinner than MIN_SEG borrow from the tallest segment (proportions
   *  bend slightly at stubby heights instead of degenerating); a height too
   *  small for the whole stack collapses to its tallest segment alone. */
  function layout(built, H) {
    let hs = built.map(s => (s.h != null ? Math.max(0, +s.h) : Math.max(0, +s.f || 0) * H));
    const total = hs.reduce((a, b) => a + b, 0);
    if (total <= 1e-9) return [];
    if (Math.abs(total - H) > 1e-6) { // keep the stack spanning exactly [0, H]
      const k = H / total;
      hs = hs.map(h => h * k);
    }
    const n = hs.length;
    if (H >= MIN_SEG * n) {
      for (let i = 0; i < n; i++) {
        if (hs[i] >= MIN_SEG) continue;
        const deficit = MIN_SEG - hs[i];
        hs[i] = MIN_SEG;
        let jmax = -1;
        for (let j = 0; j < n; j++) if (j !== i && (jmax < 0 || hs[j] > hs[jmax])) jmax = j;
        if (jmax >= 0) hs[jmax] = Math.max(MIN_SEG, hs[jmax] - deficit);
      }
    } else { // stubby: keep only the dominant segment
      let jmax = 0;
      for (let j = 1; j < n; j++) if (hs[j] > hs[jmax]) jmax = j;
      built = [built[jmax]];
      hs = [H];
    }
    let z = 0;
    const segs = [];
    for (let i = 0; i < built.length; i++) {
      segs.push({ ring: built[i].ring, z0: z, z1: z + hs[i], role: built[i].role || 'solid' });
      z += hs[i];
    }
    return segs;
  }

  // ================================================================== public
  const byId = new Map(FAMILIES.map(f => [f.id, f]));

  const ColumnFamilies = {
    Ring, MIN_SEG,
    groups: [
      { id: 'classical', name: 'Classical' },
      { id: 'regional', name: 'Regional' },
      { id: 'modern', name: 'Modern' },
      { id: 'structural', name: 'Structural' },
    ],
    get list() { return FAMILIES; },
    get(id) { return byId.get(id) || null; },

    /** Fill defaults, clamp minimums, enforce family couplings (e.g. the
     *  drop panel must surround its shaft). Idempotent. */
    normalize(id, raw) {
      const fam = byId.get(id);
      if (!fam) return null;
      const out = {};
      raw = raw || {};
      for (const prm of fam.params) {
        let v = +raw[prm.key];
        if (!isFinite(v)) v = prm.def;
        v = Math.max(prm.min != null ? prm.min : 0.02, v);
        if (prm.max != null) v = Math.min(prm.max, v);
        out[prm.key] = +v.toFixed(4);
      }
      if (id === 'drop_panel') {
        out.dropWidth = Math.max(out.dropWidth, out.width + 0.1);
        out.dropDepth = Math.max(out.dropDepth, out.depth + 0.1);
      }
      if (id === 'twin_coupled') out.width = Math.max(out.width, out.depth + 0.06);
      if (['cross', 'l_plan', 't_plan'].includes(id))
        out.webThick = Math.min(out.webThick, Math.min(out.width, out.depth) * 0.9);
      return out;
    },

    /** Default parameter object (registry defaults). */
    defaults(id) { return ColumnFamilies.normalize(id, {}); },

    /** Build the segment stack for a family at height H (z relative to the
     *  column base, 0 → H). Returns { segments, punch } where punch is the
     *  plan ring a host slab is punched by (default: topmost segment). */
    parts(id, rawP, H) {
      const fam = byId.get(id);
      if (!fam) return null;
      const p = ColumnFamilies.normalize(id, rawP);
      const height = Math.max(0.02, +H || 3);
      let built = fam.build(p);
      // absolute-height families (drop panel) need H to size the shaft
      built = built.map(s => (s.h == null && s.f == null
        ? { ...s, h: Math.max(0.02, height - (p.dropThickness || 0.15)) } : s));
      const segments = layout(built, height);
      let punch = null;
      if (segments.length) {
        const byPunchRole = fam.punch && segments.find(s => s.role === fam.punch);
        punch = (byPunchRole || segments[segments.length - 1]).ring;
      }
      return { segments, punch, params: p, height };
    },

    /** Elevation silhouette [{x0,x1,z0,z1}] at the params — the Families
     *  panel turns this into a thumbnail; also handy for quick checks. */
    elevation(id, rawP, H) {
      const spec = ColumnFamilies.parts(id, rawP, H);
      if (!spec) return [];
      return spec.segments.map(s => {
        const b = Ring.bounds(s.ring);
        return { x0: b.x0, x1: b.x1, z0: s.z0, z1: s.z1, role: s.role };
      });
    },

    /** Options-bar select choices (grouped by label prefix). */
    selectChoices() {
      return FAMILIES.map(f => ({ value: f.id, label: f.name }));
    },
  };

  root.ColumnFamilies = ColumnFamilies;
})(typeof window !== 'undefined' ? window : globalThis);
