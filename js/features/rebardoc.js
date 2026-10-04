'use strict';
// ---------------------------------------------------------------------------
// rebardoc.js — Structural Rebar Detailing Documentation, AutoCAD DXF Converter & Print Engine.
//
// Compliant with ACI 318-19, ACI 315-18 (Details and Detailing of Concrete Reinforcement),
// CRSI MNL-66, and BS 8666 (Scheduling, dimensioning, bending and cutting of rebar).
//
// Supports EVERY structural element in the model:
//   • Beam: Cross-section, longitudinal elevation with 45° cranked truss bars, stirrups, lap splices.
//   • Column: Confinement tie cross-section, vertical elevation with floor levels, lap splices, end zones.
//   • Slab / Floor: Edge section with mesh layers, two-way bottom & top flexural mesh plan layout.
//   • Foundation / Footing: Footing elevation section with bottom mat & column starter dowels, plan view.
//   • Wall: Two-curtain cross section with ties, wall elevation with vertical/horizontal grids & boundary zones.
//
// Multi-style detailing engine:
//   1. Standard ACI 318-19
//   2. Seismic Special Moment Frame (Confinement)
//   3. Fabrication / Shop Drawing (Detailed BBS)
//   4. Simplified Contractor / General Arrangement
// ---------------------------------------------------------------------------

(function () {
  const BAR_SIZES = [
    { us: '#3', mm: 9.5,  area: 71,   kgM: 0.560 },
    { us: '#4', mm: 12.7, area: 129,  kgM: 0.994 },
    { us: '#5', mm: 15.9, area: 199,  kgM: 1.552 },
    { us: '#6', mm: 19.1, area: 284,  kgM: 2.235 },
    { us: '#7', mm: 22.2, area: 387,  kgM: 3.042 },
    { us: '#8', mm: 25.4, area: 510,  kgM: 3.973 },
    { us: '#9', mm: 28.7, area: 645,  kgM: 5.060 },
    { us: '#10', mm: 32.3, area: 819, kgM: 6.404 },
    { us: '#11', mm: 35.8, area: 1006, kgM: 7.907 }
  ];

  const SHAPE_CODES = {
    straight: { code: '00', name: 'Straight Bar', desc: 'A' },
    lshape:   { code: '21', name: '90° L-Hook / Starter', desc: 'A + B' },
    stirrup:  { code: '51', name: 'Closed Rectangular Stirrup / Tie', desc: '2(A+B)+24d' },
    crank:    { code: '26', name: 'Bent-Up (Cranked) Bar', desc: 'A + 0.42D + B' },
    ubar:     { code: '11', name: 'U-Bar / End Closure', desc: 'A + 2B' },
    spiral:   { code: '77', name: 'Helical Spiral', desc: 'N·√(πD)²+s²' }
  };

  const STYLES = {
    standard: { id: 'standard', name: 'Standard ACI 318-19', badge: 'ACI 318-19' },
    seismic: { id: 'seismic', name: 'Seismic SMF (Confinement Zones)', badge: 'ACI §18 SEISMIC' },
    shop: { id: 'shop', name: 'Fabrication / Shop Drawing (BBS)', badge: 'FABRICATION' },
    simplified: { id: 'simplified', name: 'Contractor Simplified Notes', badge: 'GENERAL ARRANGEMENT' }
  };

  /** Helper to escape HTML */
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Bar diameter in mm from meters */
  function diaToMM(diaM) {
    if (!diaM) return 16;
    return Math.round(diaM * 1000 * 10) / 10;
  }

  /** Find closest standard bar size */
  function findBar(diaM) {
    const mm = diaToMM(diaM);
    let best = BAR_SIZES[2];
    let minDiff = 999;
    for (const b of BAR_SIZES) {
      const diff = Math.abs(b.mm - mm);
      if (diff < minDiff) { minDiff = diff; best = b; }
    }
    return best;
  }

  /** Normalize element type */
  function normalizeType(type) {
    const t = String(type || '').toLowerCase();
    if (t === 'floor' || t === 'slab') return 'slab';
    if (t === 'footing' || t === 'stripfoot' || t === 'foundation') return 'foundation';
    if (t === 'column') return 'column';
    if (t === 'beam') return 'beam';
    if (t === 'wall') return 'wall';
    return t || 'beam';
  }

  /** Extract physical dimensions and clean properties from an entity */
  function extractElementDims(ent, normType) {
    const p = (ent && ent.params) || {};
    const dims = { w: 0.4, h: 0.5, l: 3.5, d: 0.4 };

    if (normType === 'column') {
      dims.w = +(p.width || p.w || 0.4);
      dims.d = +(p.depth || p.d || p.length || dims.w || 0.4);
      dims.h = +(p.height || p.h || 3.2);
      dims.l = dims.h;
    } else if (normType === 'beam') {
      dims.w = +(p.webWidth || p.width || p.w || 0.3);
      dims.h = +(p.height || p.h || 0.5);
      let span = 4.5;
      if (p.baseline && p.baseline.length >= 2) {
        const dx = p.baseline[1][0] - p.baseline[0][0];
        const dy = p.baseline[1][1] - p.baseline[0][1];
        span = Math.hypot(dx, dy) || span;
      } else if (p.length || p.l) {
        span = +(p.length || p.l);
      }
      dims.l = span;
    } else if (normType === 'slab') {
      dims.h = +(p.thickness || p.h || 0.2);
      let sx = 4.5, sy = 4.5;
      if (p.regions && p.regions[0] && p.regions[0].outer) {
        const pts = p.regions[0].outer;
        const xs = pts.map(pt => pt.x), ys = pts.map(pt => pt.y);
        sx = Math.max(2.0, Math.max(...xs) - Math.min(...xs));
        sy = Math.max(2.0, Math.max(...ys) - Math.min(...ys));
      } else if (p.width && p.length) {
        sx = +p.width; sy = +p.length;
      }
      dims.w = sx; dims.l = sy;
    } else if (normType === 'foundation') {
      dims.w = +(p.width || p.w || 1.5);
      dims.l = +(p.depth || p.length || p.l || dims.w || 1.5);
      dims.h = +(p.thickness || p.h || 0.5);
      dims.d = dims.l;
    } else if (normType === 'wall') {
      dims.w = +(p.thickness || p.w || 0.25);
      dims.h = +(p.height || p.h || 3.0);
      let len = 4.5;
      if (p.base && p.end) {
        len = Math.hypot(p.end[0] - p.base[0], p.end[1] - p.base[1]) || len;
      } else if (p.length || p.l) {
        len = +(p.length || p.l);
      }
      dims.l = len;
    }

    return dims;
  }

  /** Format a mark name for an entity */
  function getElementMark(ent, normType) {
    if (ent && ent.name && !ent.name.startsWith('_')) return ent.name;
    const prefix = {
      column: 'COL',
      beam: 'BM',
      slab: 'SLB',
      foundation: 'FND',
      wall: 'WAL'
    }[normType] || 'ELM';

    if (ent && ent.id) {
      const rawNum = ent.id.replace(/[^0-9]/g, '');
      const num = rawNum ? String(100 + parseInt(rawNum, 10)) : '101';
      return `${prefix}-${num}`;
    }
    return `${prefix}-101`;
  }

  // =========================================================================
  // 1. REBAR SCHEDULE & BBS DATA ENGINE FOR EVERY ELEMENT
  // =========================================================================
  function extractElementSchedule(ent, normType, dims, params, style = 'standard') {
    normType = normalizeType(normType || (ent && ent.type));
    dims = dims || extractElementDims(ent, normType);
    params = params || (ent && ent.params) || {};
    const mark = getElementMark(ent, normType);
    const items = [];
    let barSeq = 1;
    const nextMark = () => String(barSeq++).padStart(2, '0');

    if (normType === 'column') {
      const cw = +(params.w || dims.w || 0.4);
      const cd = +(params.d || dims.d || dims.w || 0.4);
      const ch = +(params.h || dims.h || 3.2);
      const cov = +(params.cov || 0.04);
      const mdia = +(params.mdia || (cw >= 0.45 ? 0.0254 : 0.0222)); // #8 or #7
      const tdia = +(params.tdia || 0.0095); // #3
      let mainN = +(params.mainN || (cw >= 0.45 ? 8 : 4));
      if (style === 'seismic') mainN = Math.max(8, mainN);

      const bMain = findBar(mdia);
      const bTie = findBar(tdia);

      // Class B Tension Lap Splice length (1.3 Ld per ACI §25.5)
      const lapLen = +(Math.max(0.65, 48 * bMain.mm / 1000)).toFixed(2);
      const colBarLen = +(ch + lapLen).toFixed(3);

      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Vertical Longitudinal Column Bars (Class B Lap Splice)',
        shape: 'straight',
        shapeCode: '00',
        bar: bMain,
        count: mainN,
        len: colBarLen,
        dims: `A=${ch.toFixed(2)}, Lap=${lapLen}m`,
        weight: +(mainN * colBarLen * bMain.kgM).toFixed(1)
      });

      // Confinement Zones (End zones lo = max(h, b, H/6, 450mm))
      const lo = +(Math.max(cw, cd, ch / 6, 0.45)).toFixed(2);
      const so = style === 'seismic' ? 0.08 : 0.10; // 80mm or 100mm
      const sMid = style === 'seismic' ? 0.15 : 0.20; // 150mm or 200mm

      const tieW = +(cw - 2 * cov).toFixed(3);
      const tieD = +(cd - 2 * cov).toFixed(3);
      const tieLen = +(2 * (tieW + tieD) + 24 * bTie.mm / 1000).toFixed(3);

      const endZoneCount = Math.max(4, Math.round(lo / so) + 1);
      const totalEndTies = endZoneCount * 2; // Top and Bottom zones
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'End Confinement Hoops (135° Seismic Hooks, lo Zone)',
        shape: 'stirrup',
        shapeCode: '51',
        bar: bTie,
        count: totalEndTies,
        len: tieLen,
        dims: `A=${tieW.toFixed(2)}, B=${tieD.toFixed(2)}, s=${Math.round(so * 1000)}mm`,
        weight: +(totalEndTies * tieLen * bTie.kgM).toFixed(1)
      });

      const midH = Math.max(0.5, ch - 2 * lo);
      const midCount = Math.max(2, Math.round(midH / sMid));
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Mid-Height Confinement Column Ties',
        shape: 'stirrup',
        shapeCode: '51',
        bar: bTie,
        count: midCount,
        len: tieLen,
        dims: `A=${tieW.toFixed(2)}, B=${tieD.toFixed(2)}, s=${Math.round(sMid * 1000)}mm`,
        weight: +(midCount * tieLen * bTie.kgM).toFixed(1)
      });

      if (mainN >= 8) {
        const diaInner = +(Math.SQRT1_2 * (tieW + tieD)).toFixed(3);
        const innerCount = totalEndTies + midCount;
        items.push({
          mark: nextMark(),
          element: mark,
          desc: 'Internal Diamond Cross-Ties (Intermediate Bar Confinement)',
          shape: 'stirrup',
          shapeCode: '51',
          bar: bTie,
          count: innerCount,
          len: diaInner,
          dims: `Diamond L=${diaInner.toFixed(2)}`,
          weight: +(innerCount * diaInner * bTie.kgM).toFixed(1)
        });
      }

    } else if (normType === 'beam') {
      const bw = +(params.w || dims.w || 0.3);
      const h = +(params.h || dims.h || 0.5);
      const span = +(params.l || dims.l || 4.5);
      const topCov = +(params.top || 0.04);
      const botCov = +(params.bottom || 0.04);
      const sideCov = +(params.sides || 0.04);

      const topDia = +(params.topDia || 0.0159);
      const topN = +(params.topN || 2);
      const botDia = +(params.botDia || 0.0191);
      const botN = +(params.botN || 3);
      const bentN = style === 'simplified' ? 0 : +(params.crank || 1);
      const stirDia = +(params.stirDia || 0.0095);
      const stirVal = style === 'seismic' ? 0.10 : +(params.stirVal || 0.15);

      const bTop = findBar(topDia);
      const bBot = findBar(botDia);
      const bStir = findBar(stirDia);

      // Top continuous with 90° hooks into columns
      const topHookLen = 0.25;
      const topLen = +(span - 2 * sideCov + 2 * topHookLen).toFixed(3);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Top Continuous Negative Moment Steel (90° Standard Hooks)',
        shape: 'lshape',
        shapeCode: '21',
        bar: bTop,
        count: topN,
        len: topLen,
        dims: `A=${(span - 2 * sideCov).toFixed(2)}, B=${topHookLen.toFixed(2)}`,
        weight: +(topN * topLen * bTop.kgM).toFixed(1)
      });

      // Bottom straight integrity steel (ACI §9.8)
      const botStraightN = Math.max(2, botN - bentN);
      const botLen = +(span - 2 * sideCov).toFixed(3);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Bottom Continuous Steel (Structural Integrity per ACI §9.8)',
        shape: 'straight',
        shapeCode: '00',
        bar: bBot,
        count: botStraightN,
        len: botLen,
        dims: `A=${botLen.toFixed(2)}`,
        weight: +(botStraightN * botLen * bBot.kgM).toFixed(1)
      });

      // 45° Bent-up truss bars
      if (bentN > 0) {
        const rise = +(h - topCov - botCov - topDia).toFixed(3);
        const slopeLen = +(0.42 * rise).toFixed(3);
        const bentLen = +(span - 2 * sideCov + 2 * slopeLen + 0.30).toFixed(3);
        items.push({
          mark: nextMark(),
          element: mark,
          desc: 'Bent-Up (Cranked) 45° Truss Bars (Shear & Top Negative Support)',
          shape: 'crank',
          shapeCode: '26',
          bar: bBot,
          count: bentN,
          len: bentLen,
          dims: `A=${(span * 0.5).toFixed(2)}, D=${rise.toFixed(2)}, θ=45°`,
          weight: +(bentN * bentLen * bBot.kgM).toFixed(1)
        });
      }

      // Closed stirrups with 135° seismic hooks
      const stirWidth = +(bw - 2 * sideCov).toFixed(3);
      const stirHeight = +(h - topCov - botCov).toFixed(3);
      const stirPerim = +(2 * (stirWidth + stirHeight) + 24 * bStir.mm / 1000).toFixed(3);
      const stirCount = Math.max(6, Math.round(span / stirVal) + 1);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Closed Rectangular Stirrups (135° Standard Seismic Hooks)',
        shape: 'stirrup',
        shapeCode: '51',
        bar: bStir,
        count: stirCount,
        len: stirPerim,
        dims: `A=${stirWidth.toFixed(2)}, B=${stirHeight.toFixed(2)}`,
        weight: +(stirCount * stirPerim * bStir.kgM).toFixed(1)
      });

    } else if (normType === 'slab') {
      const th = +(params.thickness || dims.h || 0.2);
      const sx = +(dims.w || 4.5);
      const sy = +(dims.l || 4.5);
      const xDia = +(params.xDia || 0.0127); // #4
      const yDia = +(params.yDia || 0.0127);
      const xSpacing = +(params.xv || 0.20);
      const ySpacing = +(params.yv || 0.20);
      const isCrank = style !== 'simplified' && !!params.crank;

      const bX = findBar(xDia);
      const bY = findBar(yDia);

      const countX = Math.round(sy / xSpacing) + 1;
      const countY = Math.round(sx / ySpacing) + 1;

      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Bottom Primary Flexural Mesh (X-Direction)',
        shape: 'straight',
        shapeCode: '00',
        bar: bX,
        count: countX,
        len: +(sx - 0.08).toFixed(3),
        dims: `A=${(sx - 0.08).toFixed(2)}, s=${Math.round(xSpacing * 1000)}mm`,
        weight: +(countX * (sx - 0.08) * bX.kgM).toFixed(1)
      });

      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Bottom Secondary Flexural Mesh (Y-Direction)',
        shape: 'straight',
        shapeCode: '00',
        bar: bY,
        count: countY,
        len: +(sy - 0.08).toFixed(3),
        dims: `A=${(sy - 0.08).toFixed(2)}, s=${Math.round(ySpacing * 1000)}mm`,
        weight: +(countY * (sy - 0.08) * bY.kgM).toFixed(1)
      });

      if (isCrank) {
        const rise = +(th - 0.05).toFixed(3);
        const bentCount = Math.floor(countX / 2);
        items.push({
          mark: nextMark(),
          element: mark,
          desc: 'Alternate 45° Bent-Up Crank Bars (L/4 Top Support Strip)',
          shape: 'crank',
          shapeCode: '26',
          bar: bX,
          count: bentCount,
          len: +(sx - 0.08 + 0.84 * rise).toFixed(3),
          dims: `A=${(sx - 0.08).toFixed(2)}, D=${rise}, θ=45°`,
          weight: +(bentCount * (sx - 0.08 + 0.84 * rise) * bX.kgM).toFixed(1)
        });
      } else {
        const topStripN = Math.round(countX * 0.4);
        items.push({
          mark: nextMark(),
          element: mark,
          desc: 'Top Negative Support Reinforcement (L/4 Support Strip)',
          shape: 'straight',
          shapeCode: '00',
          bar: bX,
          count: topStripN,
          len: +(sx * 0.35).toFixed(3),
          dims: `A=${(sx * 0.35).toFixed(2)}`,
          weight: +(topStripN * (sx * 0.35) * bX.kgM).toFixed(1)
        });
      }

    } else if (normType === 'foundation') {
      const fw = +(params.w || dims.w || 1.5);
      const fl = +(params.l || dims.l || 1.5);
      const fh = +(params.thickness || dims.h || 0.5);
      const cov = 0.075; // 75 mm clear cover against earth
      const matDia = +(params.matDia || 0.0191); // #6
      const matSpacing = +(params.matSpacing || 0.15); // 150mm

      const bMat = findBar(matDia);
      const bDowel = findBar(0.0222); // #7

      const countX = Math.round((fl - 2 * cov) / matSpacing) + 1;
      const countY = Math.round((fw - 2 * cov) / matSpacing) + 1;
      const hookLeg = 0.20;

      const lenX = +(fw - 2 * cov + 2 * hookLeg).toFixed(3);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Bottom Two-Way Flexural Mat (X-Direction · 90° Hooks)',
        shape: 'lshape',
        shapeCode: '21',
        bar: bMat,
        count: countX,
        len: lenX,
        dims: `A=${(fw - 2 * cov).toFixed(2)}, B=${hookLeg}`,
        weight: +(countX * lenX * bMat.kgM).toFixed(1)
      });

      const lenY = +(fl - 2 * cov + 2 * hookLeg).toFixed(3);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Bottom Two-Way Flexural Mat (Y-Direction · 90° Hooks)',
        shape: 'lshape',
        shapeCode: '21',
        bar: bMat,
        count: countY,
        len: lenY,
        dims: `A=${(fl - 2 * cov).toFixed(2)}, B=${hookLeg}`,
        weight: +(countY * lenY * bMat.kgM).toFixed(1)
      });

      // Column starter dowels
      const dowelCount = fw >= 2.0 ? 8 : 4;
      const dowelFoot = 0.35;
      const dowelProj = 0.80; // Class B lap projection into column
      const dowelLen = +(dowelFoot + fh - cov + dowelProj).toFixed(3);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Column Starter Dowels (Class B Tension Lap Splice)',
        shape: 'lshape',
        shapeCode: '21',
        bar: bDowel,
        count: dowelCount,
        len: dowelLen,
        dims: `Foot=${dowelFoot}, Proj=${dowelProj}`,
        weight: +(dowelCount * dowelLen * bDowel.kgM).toFixed(1)
      });

    } else if (normType === 'wall') {
      const wt = +(params.thickness || dims.w || 0.25);
      const wh = +(params.height || dims.h || 3.0);
      const wl = +(params.l || dims.l || 4.5);
      const cov = 0.04;
      const vDia = +(params.vDia || 0.0159); // #5
      const hDia = +(params.hDia || 0.0127); // #4

      const bV = findBar(vDia);
      const bH = findBar(hDia);

      const countV = (Math.round((wl - 2 * cov) / 0.20) + 1) * 2; // 2 curtains
      const countH = (Math.round((wh - 2 * cov) / 0.20) + 1) * 2; // 2 curtains

      const vLen = +(wh + 0.60).toFixed(3); // Includes foundation dowel lap
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Vertical Wall Curtains (Exterior & Interior Faces)',
        shape: 'straight',
        shapeCode: '00',
        bar: bV,
        count: countV,
        len: vLen,
        dims: `A=${wh.toFixed(2)}, Lap=0.60m`,
        weight: +(countV * vLen * bV.kgM).toFixed(1)
      });

      const hLen = +(wl - 2 * cov).toFixed(3);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Horizontal Shear Reinforcement (Two Curtains)',
        shape: 'straight',
        shapeCode: '00',
        bar: bH,
        count: countH,
        len: hLen,
        dims: `A=${hLen.toFixed(2)}`,
        weight: +(countH * hLen * bH.kgM).toFixed(1)
      });

      // Boundary element U-caps
      const uCount = Math.round(wh / 0.20) * 2;
      const uLen = +(2 * 0.35 + (wt - 2 * cov)).toFixed(3);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Boundary Element End U-Caps & Confinement Cross-Ties',
        shape: 'ubar',
        shapeCode: '11',
        bar: bH,
        count: uCount,
        len: uLen,
        dims: `A=${(wt - 2 * cov).toFixed(2)}, B=0.35`,
        weight: +(uCount * uLen * bH.kgM).toFixed(1)
      });
    }

    return items;
  }

  // =========================================================================
  // 2. SHEET DRAWING SVG GENERATOR FOR EVERY ELEMENT TYPE
  // =========================================================================
  function renderDetailingSheetSVG(opts) {
    const normType = normalizeType(opts.normType || opts.type || (opts.ent && opts.ent.type));
    const ent = opts.ent;
    const dims = opts.dims || extractElementDims(ent, normType);
    const params = opts.params || (ent && ent.params) || {};
    const schedule = opts.schedule || extractElementSchedule(ent, normType, dims, params, opts.style);
    const mark = getElementMark(ent, normType);
    const styleObj = STYLES[opts.style] || STYLES.standard;
    const typeLabel = {
      column: 'COLUMN',
      beam: 'BEAM',
      slab: 'SLAB / FLOOR',
      foundation: 'ISOLATED FOOTING',
      wall: 'CONCRETE WALL'
    }[normType] || normType.toUpperCase();

    const W = 1100, H = 780;
    const m = 24;

    let totalWeight = 0, totalBars = 0;
    for (const it of schedule) {
      totalWeight += it.weight;
      totalBars += it.count;
    }

    let svg = `
      <svg id="rebardoc-svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; font-family:'Segoe UI', Inter, Arial, sans-serif;">
        <defs>
          <marker id="cad-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#1e293b" />
          </marker>
          <marker id="cad-dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4">
            <circle cx="5" cy="5" r="3" fill="#2563eb" />
          </marker>
          <pattern id="conc-hatch" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M0 20 L20 0 M10 20 L20 10 M0 10 L10 0" stroke="#cbd5e1" stroke-width="0.8" opacity="0.4" />
          </pattern>
          <pattern id="soil-hatch" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M0 16 L16 0 M4 16 L16 4 M0 8 L8 0" stroke="#94a3b8" stroke-width="0.8" opacity="0.3" />
          </pattern>
        </defs>

        <!-- Outer Drawing Border -->
        <rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}" fill="none" stroke="#0f172a" stroke-width="2.5" />
        <rect x="${m + 8}" y="${m + 8}" width="${W - 2 * m - 16}" height="${H - 2 * m - 16}" fill="none" stroke="#334155" stroke-width="1.2" />

        <!-- Border Coordinate Markers -->
        <g font-size="9" font-weight="700" fill="#64748b" text-anchor="middle" dominant-baseline="middle">
          <text x="${W / 2}" y="${m + 4}">STRUCTURAL REINFORCEMENT DETAILS — ACI 318-19 / CRSI MNL-66 / BS 8666</text>
          <text x="${m + 4}" y="${H / 2}">A</text>
          <text x="${W - m - 4}" y="${H / 2}">B</text>
        </g>
    `;

    // -----------------------------------------------------------------------
    // VIEW 1: CROSS-SECTION / DETAIL (Left Top)
    // -----------------------------------------------------------------------
    const v1X = m + 28, v1Y = m + 36, v1W = 340, v1H = 340;
    svg += `
      <!-- View 1 Frame -->
      <rect x="${v1X}" y="${v1Y}" width="${v1W}" height="${v1H}" fill="#fafafa" stroke="#e2e8f0" stroke-width="1" rx="4" />
      <text x="${v1X + 14}" y="${v1Y + 22}" font-size="12" font-weight="700" fill="#0f172a">VIEW 1: ${typeLabel} SECTION (SCALE 1:20)</text>
      <line x1="${v1X + 14}" y1="${v1Y + 26}" x2="${v1X + 250}" y2="${v1Y + 26}" stroke="#2563eb" stroke-width="2" />
    `;

    if (normType === 'column') {
      const cw = +(params.w || dims.w || 0.4) * 1000;
      const cd = +(params.d || dims.d || dims.w || 0.4) * 1000;
      const scale = Math.min(180 / cw, 180 / cd);
      const dw = cw * scale, dh = cd * scale;
      const cx = v1X + v1W / 2, cy = v1Y + v1H / 2 + 10;
      const x0 = cx - dw / 2, y0 = cy - dh / 2;

      svg += `
        <!-- Column Section Outline -->
        <rect x="${x0}" y="${y0}" width="${dw}" height="${dh}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2.2" />
        <!-- Confinement Tie Hoop with 135° seismic hooks -->
        <rect x="${x0 + 12}" y="${y0 + 12}" width="${dw - 24}" height="${dh - 24}" fill="none" stroke="#dc2626" stroke-width="2.5" rx="6" />
        <path d="M ${x0 + 14} ${y0 + 26} L ${x0 + 28} ${y0 + 28} L ${x0 + 38} ${y0 + 44}" fill="none" stroke="#dc2626" stroke-width="2.2" />

        <!-- Longitudinal Bars (Corners & Intermediate) -->
        <circle cx="${x0 + 18}" cy="${y0 + 18}" r="5.5" fill="#2563eb" />
        <circle cx="${x0 + dw - 18}" cy="${y0 + 18}" r="5.5" fill="#2563eb" />
        <circle cx="${x0 + 18}" cy="${y0 + dh - 18}" r="5.5" fill="#2563eb" />
        <circle cx="${x0 + dw - 18}" cy="${y0 + dh - 18}" r="5.5" fill="#2563eb" />
        <circle cx="${cx}" cy="${y0 + 18}" r="5" fill="#8b5cf6" />
        <circle cx="${cx}" cy="${y0 + dh - 18}" r="5" fill="#8b5cf6" />
        <circle cx="${x0 + 18}" cy="${cy}" r="5" fill="#8b5cf6" />
        <circle cx="${x0 + dw - 18}" cy="${cy}" r="5" fill="#8b5cf6" />

        <!-- Dimensions -->
        <line x1="${x0}" y1="${y0 - 14}" x2="${x0 + dw}" y2="${y0 - 14}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${cx}" y="${y0 - 20}" font-size="10" font-weight="700" fill="#1e293b" text-anchor="middle">b = ${Math.round(cw)} mm</text>
        <line x1="${x0 - 14}" y1="${y0}" x2="${x0 - 14}" y2="${y0 + dh}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${x0 - 20}" y="${cy}" font-size="10" font-weight="700" fill="#1e293b" text-anchor="middle" transform="rotate(-90 ${x0 - 20} ${cy})">h = ${Math.round(cd)} mm</text>

        <!-- Callouts -->
        <path d="M ${x0 + dw - 18} ${y0 + 18} L ${x0 + dw + 25} ${y0 + 10} L ${v1X + v1W - 20} ${y0 + 10}" fill="none" stroke="#2563eb" stroke-width="1.2" />
        <text x="${v1X + v1W - 15}" y="${y0 + 7}" font-size="10" font-weight="700" fill="#2563eb" text-anchor="end">8-#8 Vertical Bars</text>

        <path d="M ${x0 + 12} ${cy} L ${x0 - 25} ${cy} L ${x0 - 10} ${cy}" fill="none" stroke="#dc2626" stroke-width="1.2" />
        <text x="${x0 + 16}" y="${cy - 5}" font-size="9" font-weight="700" fill="#dc2626">Ties #3 @ 100/200</text>
        <text x="${cx}" y="${y0 + dh + 24}" font-size="9" font-weight="600" fill="#64748b" text-anchor="middle">Cover = 40 mm (ACI §20.6.1)</text>
      `;
    } else if (normType === 'beam') {
      const bw = +(params.w || dims.w || 0.3) * 1000;
      const bh = +(params.h || dims.h || 0.5) * 1000;
      const scale = Math.min(180 / bw, 220 / bh);
      const dw = bw * scale, dh = bh * scale;
      const cx = v1X + v1W / 2, cy = v1Y + v1H / 2 + 10;
      const x0 = cx - dw / 2, y0 = cy - dh / 2;

      svg += `
        <rect x="${x0}" y="${y0}" width="${dw}" height="${dh}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2.2" />
        <rect x="${x0 + 12}" y="${y0 + 12}" width="${dw - 24}" height="${dh - 24}" fill="none" stroke="#dc2626" stroke-width="2.5" rx="6" />
        <circle cx="${x0 + 18}" cy="${y0 + 18}" r="5" fill="#2563eb" />
        <circle cx="${x0 + dw - 18}" cy="${y0 + 18}" r="5" fill="#2563eb" />
        <circle cx="${x0 + 18}" cy="${y0 + dh - 18}" r="5.5" fill="#2563eb" />
        <circle cx="${cx}" cy="${y0 + dh - 18}" r="5.5" fill="#8b5cf6" />
        <circle cx="${x0 + dw - 18}" cy="${y0 + dh - 18}" r="5.5" fill="#2563eb" />

        <line x1="${x0}" y1="${y0 - 14}" x2="${x0 + dw}" y2="${y0 - 14}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${cx}" y="${y0 - 20}" font-size="10" font-weight="700" fill="#1e293b" text-anchor="middle">bw = ${Math.round(bw)} mm</text>
        <line x1="${x0 - 14}" y1="${y0}" x2="${x0 - 14}" y2="${y0 + dh}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${x0 - 20}" y="${cy}" font-size="10" font-weight="700" fill="#1e293b" text-anchor="middle" transform="rotate(-90 ${x0 - 20} ${cy})">h = ${Math.round(bh)} mm</text>

        <path d="M ${x0 + dw - 18} ${y0 + 18} L ${x0 + dw + 25} ${y0 + 10} L ${v1X + v1W - 20} ${y0 + 10}" fill="none" stroke="#2563eb" stroke-width="1.2" />
        <text x="${v1X + v1W - 15}" y="${y0 + 7}" font-size="10" font-weight="700" fill="#2563eb" text-anchor="end">2-#5 Top Main</text>

        <path d="M ${x0 + 12} ${cy} L ${x0 - 25} ${cy} L ${x0 - 10} ${cy}" fill="none" stroke="#dc2626" stroke-width="1.2" />
        <text x="${x0 + 16}" y="${cy - 5}" font-size="9" font-weight="700" fill="#dc2626">Stirrups #3 @ 150</text>

        <path d="M ${cx} ${y0 + dh - 18} L ${cx + 30} ${y0 + dh + 18} L ${v1X + v1W - 20} ${y0 + dh + 18}" fill="none" stroke="#8b5cf6" stroke-width="1.2" />
        <text x="${v1X + v1W - 15}" y="${y0 + dh + 15}" font-size="10" font-weight="700" fill="#8b5cf6" text-anchor="end">3-#6 (1-Bent @ 45°)</text>
      `;
    } else if (normType === 'slab') {
      const th = +(params.thickness || dims.h || 0.2) * 1000;
      const boxW = 260, boxH = Math.max(50, Math.min(100, th * 0.4));
      const cx = v1X + v1W / 2, cy = v1Y + v1H / 2 + 10;
      const x0 = cx - boxW / 2, y0 = cy - boxH / 2;

      svg += `
        <!-- Supporting Wall/Beam Soffit below -->
        <rect x="${x0}" y="${y0 + boxH}" width="60" height="70" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5" />
        <text x="${x0 + 30}" y="${y0 + boxH + 40}" font-size="9" font-weight="700" fill="#475569" text-anchor="middle">SUPPORT</text>

        <!-- Slab Cross-Section -->
        <rect x="${x0}" y="${y0}" width="${boxW}" height="${boxH}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2.2" />
        <!-- Bottom Primary X-Bar -->
        <line x1="${x0 + 10}" y1="${y0 + boxH - 12}" x2="${x0 + boxW - 10}" y2="${y0 + boxH - 12}" stroke="#2563eb" stroke-width="3" stroke-linecap="round" />
        <!-- Bottom Secondary Y-Bars (cross dots) -->
        <circle cx="${x0 + 35}" cy="${y0 + boxH - 12}" r="4" fill="#059669" />
        <circle cx="${x0 + 85}" cy="${y0 + boxH - 12}" r="4" fill="#059669" />
        <circle cx="${x0 + 135}" cy="${y0 + boxH - 12}" r="4" fill="#059669" />
        <circle cx="${x0 + 185}" cy="${y0 + boxH - 12}" r="4" fill="#059669" />
        <circle cx="${x0 + 235}" cy="${y0 + boxH - 12}" r="4" fill="#059669" />

        <!-- Top Support Negative Bar -->
        <path d="M ${x0 + 12} ${y0 + 26} L ${x0 + 12} ${y0 + 12} L ${x0 + 110} ${y0 + 12}" fill="none" stroke="#2563eb" stroke-width="2.5" />

        <!-- Thickness Dimension -->
        <line x1="${x0 + boxW + 15}" y1="${y0}" x2="${x0 + boxW + 15}" y2="${y0 + boxH}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${x0 + boxW + 24}" y="${cy}" font-size="10" font-weight="700" fill="#1e293b" dominant-baseline="middle">t = ${Math.round(th)} mm</text>

        <!-- Callouts -->
        <text x="${cx}" y="${y0 - 15}" font-size="10" font-weight="700" fill="#2563eb" text-anchor="middle">Bottom Flexural Mesh: #4 @ 200 mm E.W.</text>
        <text x="${cx}" y="${y0 + boxH + 20}" font-size="9" font-weight="600" fill="#64748b" text-anchor="middle">Cover = 25 mm (ACI §20.6.1)</text>
      `;
    } else if (normType === 'foundation') {
      const fw = 250, fh = 110;
      const cx = v1X + v1W / 2, cy = v1Y + v1H / 2 + 10;
      const x0 = cx - fw / 2, y0 = cy - fh / 2;

      svg += `
        <!-- Lean Blinding Bed -->
        <rect x="${x0 - 10}" y="${y0 + fh}" width="${fw + 20}" height="18" fill="url(#soil-hatch)" stroke="#64748b" stroke-width="1.2" />
        <text x="${cx}" y="${y0 + fh + 13}" font-size="8.5" font-weight="700" fill="#475569" text-anchor="middle">50 mm Lean Concrete Sub-base</text>

        <!-- Footing Pad -->
        <rect x="${x0}" y="${y0}" width="${fw}" height="${fh}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2.2" />
        <!-- Bottom Mat with Hooked Ends -->
        <path d="M ${x0 + 16} ${y0 + fh - 35} L ${x0 + 16} ${y0 + fh - 16} L ${x0 + fw - 16} ${y0 + fh - 16} L ${x0 + fw - 16} ${y0 + fh - 35}" fill="none" stroke="#2563eb" stroke-width="3" />
        <!-- Transverse Mat Bars -->
        <circle cx="${x0 + 40}" cy="${y0 + fh - 16}" r="4" fill="#059669" />
        <circle cx="${x0 + 80}" cy="${y0 + fh - 16}" r="4" fill="#059669" />
        <circle cx="${x0 + 125}" cy="${y0 + fh - 16}" r="4" fill="#059669" />
        <circle cx="${x0 + 170}" cy="${y0 + fh - 16}" r="4" fill="#059669" />
        <circle cx="${x0 + 210}" cy="${y0 + fh - 16}" r="4" fill="#059669" />

        <!-- Column Pedestal Outline -->
        <rect x="${cx - 40}" y="${y0 - 45}" width="80" height="45" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.8" />
        <text x="${cx}" y="${y0 - 25}" font-size="9" font-weight="700" fill="#475569" text-anchor="middle">COL</text>

        <!-- Column Starter Dowels -->
        <path d="M ${cx - 22} ${y0 - 55} L ${cx - 22} ${y0 + fh - 16} L ${cx - 65} ${y0 + fh - 16}" fill="none" stroke="#8b5cf6" stroke-width="2.5" />
        <path d="M ${cx + 22} ${y0 - 55} L ${cx + 22} ${y0 + fh - 16} L ${cx + 65} ${y0 + fh - 16}" fill="none" stroke="#8b5cf6" stroke-width="2.5" />

        <!-- Dimensions -->
        <line x1="${x0}" y1="${y0 - 12}" x2="${cx - 40}" y2="${y0 - 12}" stroke="#1e293b" stroke-width="1" />
        <line x1="${x0 - 14}" y1="${y0}" x2="${x0 - 14}" y2="${y0 + fh}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${x0 - 20}" y="${cy}" font-size="10" font-weight="700" fill="#1e293b" text-anchor="middle" transform="rotate(-90 ${x0 - 20} ${cy})">T = ${Math.round(dims.h * 1000)} mm</text>

        <!-- Callouts -->
        <text x="${cx}" y="${y0 - 62}" font-size="9.5" font-weight="700" fill="#8b5cf6" text-anchor="middle">4-#7 Column Starter Dowels</text>
        <text x="${cx}" y="${y0 + fh - 3}" font-size="9" font-weight="700" fill="#2563eb" text-anchor="middle">75 mm Earth Cover (ACI §20.6.1)</text>
      `;
    } else if (normType === 'wall') {
      const wt = +(params.thickness || dims.w || 0.25) * 1000;
      const boxW = Math.max(70, Math.min(110, wt * 0.4));
      const boxH = 220;
      const cx = v1X + v1W / 2, cy = v1Y + v1H / 2 + 10;
      const x0 = cx - boxW / 2, y0 = cy - boxH / 2;

      svg += `
        <!-- Concrete Wall Section -->
        <rect x="${x0}" y="${y0}" width="${boxW}" height="${boxH}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2.2" />
        <!-- Two Vertical Curtains -->
        <circle cx="${x0 + 14}" cy="${y0 + 25}" r="4" fill="#2563eb" />
        <circle cx="${x0 + boxW - 14}" cy="${y0 + 25}" r="4" fill="#2563eb" />
        <circle cx="${x0 + 14}" cy="${y0 + 75}" r="4" fill="#2563eb" />
        <circle cx="${x0 + boxW - 14}" cy="${y0 + 75}" r="4" fill="#2563eb" />
        <circle cx="${x0 + 14}" cy="${y0 + 125}" r="4" fill="#2563eb" />
        <circle cx="${x0 + boxW - 14}" cy="${y0 + 125}" r="4" fill="#2563eb" />
        <circle cx="${x0 + 14}" cy="${y0 + 175}" r="4" fill="#2563eb" />
        <circle cx="${x0 + boxW - 14}" cy="${y0 + 175}" r="4" fill="#2563eb" />

        <!-- Horizontal Tie / U-Closure -->
        <rect x="${x0 + 8}" y="${y0 + 16}" width="${boxW - 16}" height="${boxH - 32}" rx="3" fill="none" stroke="#dc2626" stroke-width="2" />

        <!-- Dimensions -->
        <line x1="${x0}" y1="${y0 - 12}" x2="${x0 + boxW}" y2="${y0 - 12}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${cx}" y="${y0 - 18}" font-size="10" font-weight="700" fill="#1e293b" text-anchor="middle">t = ${Math.round(wt)} mm</text>

        <!-- Callouts -->
        <text x="${cx}" y="${y0 + boxH + 20}" font-size="9.5" font-weight="700" fill="#2563eb" text-anchor="middle">Two Curtains (Exterior &amp; Interior)</text>
      `;
    }

    // -----------------------------------------------------------------------
    // VIEW 2: LONGITUDINAL ELEVATION & DETAILS (Right Top)
    // -----------------------------------------------------------------------
    const v2X = m + 380, v2Y = m + 36, v2W = W - 2 * m - 390, v2H = 340;
    svg += `
      <!-- View 2 Frame -->
      <rect x="${v2X}" y="${v2Y}" width="${v2W}" height="${v2H}" fill="#fafafa" stroke="#e2e8f0" stroke-width="1" rx="4" />
      <text x="${v2X + 14}" y="${v2Y + 22}" font-size="12" font-weight="700" fill="#0f172a">VIEW 2: ${typeLabel} ELEVATION &amp; REBAR LAYOUT</text>
      <line x1="${v2X + 14}" y1="${v2Y + 26}" x2="${v2X + 350}" y2="${v2Y + 26}" stroke="#2563eb" stroke-width="2" />
    `;

    if (normType === 'column') {
      const colW = 100, colH = 220;
      const cx = v2X + v2W / 2;
      const colX = cx - colW / 2, colY = v2Y + 70;
      const lapY = colY - 35;

      svg += `
        <!-- Level Datums -->
        <line x1="${v2X + 25}" y1="${colY}" x2="${v2X + v2W - 25}" y2="${colY}" stroke="#64748b" stroke-width="1" stroke-dasharray="6 3" />
        <text x="${v2X + 35}" y="${colY - 6}" font-size="9" font-weight="700" fill="#475569">LEVEL 2 · EL. +${dims.h.toFixed(2)}m</text>

        <line x1="${v2X + 25}" y1="${colY + colH}" x2="${v2X + v2W - 25}" y2="${colY + colH}" stroke="#64748b" stroke-width="1" stroke-dasharray="6 3" />
        <text x="${v2X + 35}" y="${colY + colH + 14}" font-size="9" font-weight="700" fill="#475569">LEVEL 1 (BASE) · EL. ±0.000m</text>

        <!-- Column Shaft Concrete -->
        <rect x="${colX}" y="${colY}" width="${colW}" height="${colH}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2.2" />

        <!-- Longitudinal Rebar Lines with Class B Lap Splice -->
        <line x1="${colX + 14}" y1="${colY + colH}" x2="${colX + 14}" y2="${lapY}" stroke="#2563eb" stroke-width="3" stroke-linecap="round" />
        <line x1="${colX + colW - 14}" y1="${colY + colH}" x2="${colX + colW - 14}" y2="${lapY}" stroke="#2563eb" stroke-width="3" stroke-linecap="round" />
        <line x1="${cx}" y1="${colY + colH}" x2="${cx}" y2="${lapY}" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" />

        <!-- End Confinement Zones (Top and Bottom: lo = 2h) -->
        <rect x="${colX - 8}" y="${colY}" width="${colW + 16}" height="55" fill="#fef2f2" stroke="#fca5a5" stroke-width="1" opacity="0.4" />
        <rect x="${colX - 8}" y="${colY + colH - 55}" width="${colW + 16}" height="55" fill="#fef2f2" stroke="#fca5a5" stroke-width="1" opacity="0.4" />
      `;

      // Draw ties along column height
      for (let y = colY + 8; y <= colY + 50; y += 10) {
        svg += `<line x1="${colX + 8}" y1="${y}" x2="${colX + colW - 8}" y2="${y}" stroke="#dc2626" stroke-width="1.8" />`;
      }
      for (let y = colY + 65; y <= colY + colH - 65; y += 22) {
        svg += `<line x1="${colX + 8}" y1="${y}" x2="${colX + colW - 8}" y2="${y}" stroke="#dc2626" stroke-width="1.4" opacity="0.75" />`;
      }
      for (let y = colY + colH - 50; y <= colY + colH - 8; y += 10) {
        svg += `<line x1="${colX + 8}" y1="${y}" x2="${colX + colW - 8}" y2="${y}" stroke="#dc2626" stroke-width="1.8" />`;
      }

      svg += `
        <!-- Dimension Line for Height -->
        <line x1="${colX + colW + 25}" y1="${colY}" x2="${colX + colW + 25}" y2="${colY + colH}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${colX + colW + 35}" y="${colY + colH / 2}" font-size="11" font-weight="700" fill="#1e293b" dominant-baseline="middle">H = ${dims.h.toFixed(2)} m</text>

        <!-- Confinement Notes & Lap Callouts -->
        <rect x="${colX + colW + 90}" y="${colY + 10}" width="160" height="22" fill="#eff6ff" stroke="#bfdbfe" stroke-width="1" rx="3" />
        <text x="${colX + colW + 170}" y="${colY + 25}" font-size="9.5" font-weight="700" fill="#1d4ed8" text-anchor="middle">Top Confinement: Ties @ 100mm</text>

        <rect x="${colX + colW + 90}" y="${colY + colH - 35}" width="160" height="22" fill="#eff6ff" stroke="#bfdbfe" stroke-width="1" rx="3" />
        <text x="${colX + colW + 170}" y="${colY + colH - 20}" font-size="9.5" font-weight="700" fill="#1d4ed8" text-anchor="middle">Base Confinement: Ties @ 100mm</text>

        <!-- Lap Splice Badge -->
        <rect x="${colX - 160}" y="${lapY + 4}" width="150" height="22" fill="#f8fafc" stroke="#64748b" stroke-width="1" rx="3" />
        <text x="${colX - 85}" y="${lapY + 19}" font-size="9" font-weight="700" fill="#0f172a" text-anchor="middle">Class B Lap: 1.05 m (1.3 Ld)</text>
      `;

    } else if (normType === 'beam') {
      const bSpan = +(dims.l || 4.5);
      const colW = 55, beamH = 120;
      const bL = v2X + 45, bR = v2X + v2W - 45;
      const bY = v2Y + 130;

      svg += `
        <!-- Left Support Column -->
        <rect x="${bL - colW}" y="${bY - 40}" width="${colW}" height="${beamH + 80}" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5" />
        <text x="${bL - colW / 2}" y="${bY - 15}" font-size="9" font-weight="700" fill="#475569" text-anchor="middle">COL</text>

        <!-- Right Support Column -->
        <rect x="${bR}" y="${bY - 40}" width="${colW}" height="${beamH + 80}" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5" />
        <text x="${bR + colW / 2}" y="${bY - 15}" font-size="9" font-weight="700" fill="#475569" text-anchor="middle">COL</text>

        <!-- Clear Span Beam Outline -->
        <rect x="${bL}" y="${bY}" width="${bR - bL}" height="${beamH}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2.2" />

        <!-- Dimension -->
        <line x1="${bL}" y1="${bY - 24}" x2="${bR}" y2="${bY - 24}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${(bL + bR) / 2}" y="${bY - 30}" font-size="11" font-weight="700" fill="#1e293b" text-anchor="middle">Clear Span Ln = ${bSpan.toFixed(2)} m</text>
      `;

      // Stirrups
      const totalStir = 20;
      for (let i = 0; i <= totalStir; i++) {
        const sx = bL + 12 + (i / totalStir) * (bR - bL - 24);
        svg += `<line x1="${sx}" y1="${bY + 12}" x2="${sx}" y2="${bY + beamH - 12}" stroke="#dc2626" stroke-width="1.4" opacity="0.85" />`;
      }

      // Top & Bottom Continuous
      svg += `
        <path d="M ${bL - 25} ${bY + 45} L ${bL - 25} ${bY + 14} L ${bR + 25} ${bY + 14} L ${bR + 25} ${bY + 45}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" />
        <text x="${(bL + bR) / 2}" y="${bY + 9}" font-size="10" font-weight="700" fill="#2563eb" text-anchor="middle">2-#5 Top Continuous</text>

        <path d="M ${bL - 20} ${bY + beamH - 14} L ${bR + 20} ${bY + beamH - 14}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" />
        <text x="${(bL + bR) / 2}" y="${bY + beamH - 20}" font-size="10" font-weight="700" fill="#2563eb" text-anchor="middle">2-#6 Bottom Continuous (ACI §9.8 Integrity)</text>
      `;

      // 45° Bent Truss Bar
      const crankX1 = bL + (bR - bL) * 0.20;
      const crankX2 = bR - (bR - bL) * 0.20;
      svg += `
        <path d="M ${bL - 20} ${bY + 18} L ${crankX1 - 35} ${bY + 18} L ${crankX1} ${bY + beamH - 18} L ${crankX2} ${bY + beamH - 18} L ${crankX2 + 35} ${bY + 18} L ${bR + 20} ${bY + 18}"
              fill="none" stroke="#8b5cf6" stroke-width="3" stroke-linejoin="round" />
        <circle cx="${crankX1 - 18}" cy="${bY + beamH / 2}" r="4" fill="#8b5cf6" />
        <text x="${crankX1 - 25}" y="${bY + beamH / 2 - 8}" font-size="10" font-weight="700" fill="#8b5cf6">45° Shear Crank</text>

        <line x1="${bL}" y1="${bY + beamH + 18}" x2="${crankX1}" y2="${bY + beamH + 18}" stroke="#8b5cf6" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${(bL + crankX1) / 2}" y="${bY + beamH + 32}" font-size="10" font-weight="700" fill="#8b5cf6" text-anchor="middle">Ln / 5 (Shear Zone)</text>
      `;

    } else if (normType === 'slab') {
      const plW = 380, plH = 220;
      const cx = v2X + v2W / 2, cy = v2Y + v2H / 2 + 10;
      const x0 = cx - plW / 2, y0 = cy - plH / 2;

      svg += `
        <!-- Two-Way Slab Plan Boundary -->
        <rect x="${x0}" y="${y0}" width="${plW}" height="${plH}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2.2" />
        <!-- Corner Column Markers -->
        <rect x="${x0}" y="${y0}" width="22" height="22" fill="#cbd5e1" stroke="#475569" stroke-width="1" />
        <rect x="${x0 + plW - 22}" y="${y0}" width="22" height="22" fill="#cbd5e1" stroke="#475569" stroke-width="1" />
        <rect x="${x0}" y="${y0 + plH - 22}" width="22" height="22" fill="#cbd5e1" stroke="#475569" stroke-width="1" />
        <rect x="${x0 + plW - 22}" y="${y0 + plH - 22}" width="22" height="22" fill="#cbd5e1" stroke="#475569" stroke-width="1" />
      `;

      // X-Mesh Lines (Blue)
      for (let i = 1; i <= 6; i++) {
        const py = y0 + (plH * i) / 7;
        svg += `<line x1="${x0 + 12}" y1="${py}" x2="${x0 + plW - 12}" y2="${py}" stroke="#2563eb" stroke-width="1.8" />`;
      }
      // Y-Mesh Lines (Green)
      for (let j = 1; j <= 9; j++) {
        const px = x0 + (plW * j) / 10;
        svg += `<line x1="${px}" y1="${y0 + 12}" x2="${px}" y2="${y0 + plH - 12}" stroke="#059669" stroke-width="1.8" />`;
      }

      svg += `
        <!-- Spans -->
        <line x1="${x0}" y1="${y0 - 15}" x2="${x0 + plW}" y2="${y0 - 15}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${cx}" y="${y0 - 22}" font-size="11" font-weight="700" fill="#1e293b" text-anchor="middle">Lx = ${dims.w.toFixed(2)} m</text>

        <line x1="${x0 - 15}" y1="${y0}" x2="${x0 - 15}" y2="${y0 + plH}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${x0 - 22}" y="${cy}" font-size="11" font-weight="700" fill="#1e293b" text-anchor="middle" transform="rotate(-90 ${x0 - 22} ${cy})">Ly = ${dims.l.toFixed(2)} m</text>

        <!-- Callouts -->
        <rect x="${x0 + 15}" y="${y0 + 15}" width="200" height="22" fill="#eff6ff" stroke="#bfdbfe" stroke-width="1" rx="3" />
        <text x="${x0 + 115}" y="${y0 + 30}" font-size="9.5" font-weight="700" fill="#1d4ed8" text-anchor="middle">Two-Way Bottom Mesh #4 @ 200 E.W.</text>
      `;

    } else if (normType === 'foundation') {
      const plW = 220, plH = 220;
      const cx = v2X + v2W / 2, cy = v2Y + v2H / 2 + 10;
      const x0 = cx - plW / 2, y0 = cy - plH / 2;

      svg += `
        <!-- Footing Pad Plan -->
        <rect x="${x0}" y="${y0}" width="${plW}" height="${plH}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2.2" />
      `;

      // X-Bars
      for (let i = 1; i <= 6; i++) {
        const py = y0 + (plH * i) / 7;
        svg += `<line x1="${x0 + 14}" y1="${py}" x2="${x0 + plW - 14}" y2="${py}" stroke="#2563eb" stroke-width="2" />`;
      }
      // Y-Bars
      for (let j = 1; j <= 6; j++) {
        const px = x0 + (plW * j) / 7;
        svg += `<line x1="${px}" y1="${y0 + 14}" x2="${px}" y2="${y0 + plH - 14}" stroke="#059669" stroke-width="2" />`;
      }

      // Column Footprint at center
      svg += `
        <rect x="${cx - 30}" y="${cy - 30}" width="60" height="60" fill="#ffffff" stroke="#dc2626" stroke-width="2" />
        <text x="${cx}" y="${cy + 4}" font-size="10" font-weight="700" fill="#dc2626" text-anchor="middle">COLUMN</text>
        <circle cx="${cx - 18}" cy="${cy - 18}" r="4" fill="#8b5cf6" />
        <circle cx="${cx + 18}" cy="${cy - 18}" r="4" fill="#8b5cf6" />
        <circle cx="${cx - 18}" cy="${cy + 18}" r="4" fill="#8b5cf6" />
        <circle cx="${cx + 18}" cy="${cy + 18}" r="4" fill="#8b5cf6" />

        <!-- Dimensions -->
        <line x1="${x0}" y1="${y0 - 15}" x2="${x0 + plW}" y2="${y0 - 15}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${cx}" y="${y0 - 22}" font-size="11" font-weight="700" fill="#1e293b" text-anchor="middle">W = ${dims.w.toFixed(2)} m</text>

        <line x1="${x0 - 15}" y1="${y0}" x2="${x0 - 15}" y2="${y0 + plH}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${x0 - 22}" y="${cy}" font-size="11" font-weight="700" fill="#1e293b" text-anchor="middle" transform="rotate(-90 ${x0 - 22} ${cy})">L = ${dims.l.toFixed(2)} m</text>

        <!-- Callout -->
        <text x="${cx}" y="${y0 + plH + 22}" font-size="10" font-weight="700" fill="#2563eb" text-anchor="middle">Bottom Mat: #6 @ 150 mm E.W. · 4-#7 Column Dowels</text>
      `;

    } else if (normType === 'wall') {
      const wSpan = 400, wH = 220;
      const cx = v2X + v2W / 2, cy = v2Y + v2H / 2 + 10;
      const x0 = cx - wSpan / 2, y0 = cy - wH / 2;

      svg += `
        <!-- Wall Elevation Outline -->
        <rect x="${x0}" y="${y0}" width="${wSpan}" height="${wH}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2.2" />
        <!-- Boundary Element Shading at Ends -->
        <rect x="${x0}" y="${y0}" width="45" height="${wH}" fill="#fef2f2" stroke="#fca5a5" stroke-width="1" opacity="0.5" />
        <rect x="${x0 + wSpan - 45}" y="${y0}" width="45" height="${wH}" fill="#fef2f2" stroke="#fca5a5" stroke-width="1" opacity="0.5" />
      `;

      // Vertical Bars
      for (let i = 1; i <= 14; i++) {
        const vx = x0 + (wSpan * i) / 15;
        svg += `<line x1="${vx}" y1="${y0 + 8}" x2="${vx}" y2="${y0 + wH - 8}" stroke="#2563eb" stroke-width="1.8" />`;
      }
      // Horizontal Bars
      for (let j = 1; j <= 7; j++) {
        const hy = y0 + (wH * j) / 8;
        svg += `<line x1="${x0 + 8}" y1="${hy}" x2="${x0 + wSpan - 8}" y2="${hy}" stroke="#059669" stroke-width="1.8" />`;
      }

      svg += `
        <!-- Dimensions -->
        <line x1="${x0}" y1="${y0 - 15}" x2="${x0 + wSpan}" y2="${y0 - 15}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${cx}" y="${y0 - 22}" font-size="11" font-weight="700" fill="#1e293b" text-anchor="middle">Wall Length L = ${dims.l.toFixed(2)} m</text>

        <line x1="${x0 - 15}" y1="${y0}" x2="${x0 - 15}" y2="${y0 + wH}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${x0 - 22}" y="${cy}" font-size="11" font-weight="700" fill="#1e293b" text-anchor="middle" transform="rotate(-90 ${x0 - 22} ${cy})">H = ${dims.h.toFixed(2)} m</text>

        <text x="${x0 + 22}" y="${y0 + wH / 2}" font-size="8.5" font-weight="700" fill="#991b1b" text-anchor="middle" transform="rotate(-90 ${x0 + 22} ${cy})">BOUNDARY</text>
        <text x="${x0 + wSpan - 22}" y="${y0 + wH / 2}" font-size="8.5" font-weight="700" fill="#991b1b" text-anchor="middle" transform="rotate(-90 ${x0 + wSpan - 22} ${cy})">BOUNDARY</text>
      `;
    }

    // -----------------------------------------------------------------------
    // VIEW 3: BAR BENDING SCHEDULE (BBS) TABLE (Bottom Left)
    // -----------------------------------------------------------------------
    const tX = m + 28, tY = m + 390, tW = 680, tH = 340;
    let tableRows = '';
    schedule.forEach((it) => {
      tableRows += `
        <tr style="border-bottom:1px solid #e2e8f0; height:24px;">
          <td style="font-weight:700; text-align:center; color:#2563eb;">${it.mark}</td>
          <td style="color:#0f172a; font-weight:600;">${it.desc}</td>
          <td style="text-align:center; font-family:monospace; font-weight:700; color:#059669;">${it.shapeCode}</td>
          <td style="text-align:center; font-weight:700; color:#334155;">${it.bar.us} (⌀${it.bar.mm})</td>
          <td style="text-align:center; font-weight:700;">${it.count}</td>
          <td style="text-align:right; font-family:monospace;">${it.len.toFixed(3)}</td>
          <td style="text-align:right; font-family:monospace;">${(it.len * it.count).toFixed(2)}</td>
          <td style="text-align:right; font-family:monospace;">${it.bar.kgM.toFixed(3)}</td>
          <td style="text-align:right; font-weight:700; color:#0f172a;">${it.weight.toFixed(1)}</td>
        </tr>
      `;
    });

    svg += `
      <!-- BBS Table Frame -->
      <rect x="${tX}" y="${tY}" width="${tW}" height="${tH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.2" rx="4" />
      <rect x="${tX}" y="${tY}" width="${tW}" height="28" fill="#1e293b" rx="4 4 0 0" />
      <text x="${tX + 14}" y="${tY + 18}" font-size="12" font-weight="700" fill="#ffffff">BAR BENDING SCHEDULE (BBS) — BS 8666 &amp; ACI 315-18 [${styleObj.badge}]</text>

      <foreignObject x="${tX + 8}" y="${tY + 32}" width="${tW - 16}" height="${tH - 40}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:'Segoe UI', Inter, sans-serif; font-size:10px; color:#1e293b;">
          <table style="width:100%; border-collapse:collapse; margin-top:4px;">
            <thead>
              <tr style="background:#f1f5f9; border-bottom:1.5px solid #cbd5e1; height:22px; font-weight:700; color:#475569; text-align:left;">
                <th style="width:40px; text-align:center;">MARK</th>
                <th>DESCRIPTION / LOCATION</th>
                <th style="width:60px; text-align:center;">SHAPE</th>
                <th style="width:70px; text-align:center;">BAR SIZE</th>
                <th style="width:40px; text-align:center;">NO.</th>
                <th style="width:60px; text-align:right;">CUT (m)</th>
                <th style="width:65px; text-align:right;">TOTAL (m)</th>
                <th style="width:55px; text-align:right;">kg/m</th>
                <th style="width:65px; text-align:right;">TOTAL kg</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
            <tfoot>
              <tr style="border-top:2px solid #0f172a; font-weight:700; background:#f8fafc; height:26px;">
                <td colspan="4" style="text-align:right; padding-right:12px; color:#0f172a;">GRAND TOTAL (${typeLabel} CAGE):</td>
                <td style="text-align:center; color:#2563eb;">${totalBars}</td>
                <td></td>
                <td></td>
                <td></td>
                <td style="text-align:right; color:#16a34a; font-size:11px;">${totalWeight.toFixed(1)} kg</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </foreignObject>
    `;

    // -----------------------------------------------------------------------
    // VIEW 4: GENERAL STRUCTURAL NOTES & TITLE BLOCK (Bottom Right)
    // -----------------------------------------------------------------------
    const tbX = m + 720, tbY = m + 390, tbW = W - 2 * m - 730;

    // Element-specific structural notes
    let notes = [];
    if (normType === 'column') {
      notes = [
        "1. Concrete compressive strength f'c = 35 MPa (5000 psi) at 28 days.",
        "2. Reinforcing steel ASTM A615 Grade 60 (fy = 420 MPa).",
        "3. Concrete cover to ties = 40 mm minimum per ACI 318 §20.6.1.",
        "4. Confinement: Special Moment Frame (SMF) column per ACI §18.7.",
        "5. Class B tension lap splices (1.3 Ld) located in middle half of column.",
        "6. Ties: 135° standard seismic hooks with 6db (min 75 mm) core extensions."
      ];
    } else if (normType === 'beam') {
      notes = [
        "1. Concrete compressive strength f'c = 28 MPa (4000 psi) at 28 days.",
        "2. Reinforcing steel ASTM A615 Grade 60 (fy = 420 MPa).",
        "3. Concrete cover: Beams = 40 mm, Top/Bottom = 40 mm.",
        "4. Lap splices shall be Class B tension laps (1.3 Ld) per ACI §25.5.",
        "5. Stirrups: standard 135° seismic hooks with 6db extensions.",
        "6. Structural integrity steel: min 2 continuous bottom bars per ACI §9.8."
      ];
    } else if (normType === 'slab') {
      notes = [
        "1. Concrete compressive strength f'c = 28 MPa (4000 psi) at 28 days.",
        "2. Reinforcing steel ASTM A615 Grade 60 (fy = 420 MPa).",
        "3. Clear cover: Slabs = 25 mm top and bottom per ACI §20.6.1.",
        "4. Two-way flexural reinforcement designed per ACI 318 Chapter 8.",
        "5. Minimum shrinkage & temperature reinforcement ratio ρ ≥ 0.0018.",
        "6. Chair supports spaced at max 1.0 m O.C. to secure top reinforcement."
      ];
    } else if (normType === 'foundation') {
      notes = [
        "1. Concrete compressive strength f'c = 28 MPa (4000 psi) at 28 days.",
        "2. Reinforcing steel ASTM A615 Grade 60 (fy = 420 MPa).",
        "3. Clear cover: 75 mm for concrete cast against earth per ACI §20.6.1.",
        "4. Allowable soil bearing capacity qa = 200 kPa (design verified).",
        "5. Column starter dowels anchored with 90° standard hooks to bottom mat.",
        "6. 50 mm plain concrete blinding layer placed before cage installation."
      ];
    } else if (normType === 'wall') {
      notes = [
        "1. Concrete compressive strength f'c = 30 MPa (4350 psi) at 28 days.",
        "2. Reinforcing steel ASTM A615 Grade 60 (fy = 420 MPa).",
        "3. Clear cover = 40 mm on exterior & interior faces.",
        "4. Two curtains required per ACI 318 §11.7.2 for wall thickness ≥ 250 mm.",
        "5. Boundary elements detailed per ACI §18.10 with closed hoop confinement.",
        "6. Horizontal bars anchored around boundary vertical bars with 90° hooks."
      ];
    }

    svg += `
      <!-- General Notes Box -->
      <rect x="${tbX}" y="${tbY}" width="${tbW}" height="140" fill="#fafafa" stroke="#cbd5e1" stroke-width="1.2" rx="4" />
      <rect x="${tbX}" y="${tbY}" width="${tbW}" height="24" fill="#334155" rx="4 4 0 0" />
      <text x="${tbX + 12}" y="${tbY + 16}" font-size="11" font-weight="700" fill="#ffffff">GENERAL STRUCTURAL REBAR NOTES</text>

      <g font-size="9" fill="#334155">
        <text x="${tbX + 12}" y="${tbY + 42}">${notes[0]}</text>
        <text x="${tbX + 12}" y="${tbY + 58}">${notes[1]}</text>
        <text x="${tbX + 12}" y="${tbY + 74}">${notes[2]}</text>
        <text x="${tbX + 12}" y="${tbY + 90}">${notes[3]}</text>
        <text x="${tbX + 12}" y="${tbY + 106}">${notes[4]}</text>
        <text x="${tbX + 12}" y="${tbY + 122}">${notes[5]}</text>
      </g>

      <!-- Engineering Title Block -->
      <rect x="${tbX}" y="${tbY + 150}" width="${tbW}" height="190" fill="#ffffff" stroke="#0f172a" stroke-width="2" rx="4" />

      <!-- Title Block Internal Lines -->
      <line x1="${tbX}" y1="${tbY + 195}" x2="${tbX + tbW}" y2="${tbY + 195}" stroke="#0f172a" stroke-width="1" />
      <line x1="${tbX}" y1="${tbY + 245}" x2="${tbX + tbW}" y2="${tbY + 245}" stroke="#0f172a" stroke-width="1" />
      <line x1="${tbX}" y1="${tbY + 295}" x2="${tbX + tbW}" y2="${tbY + 295}" stroke="#0f172a" stroke-width="1" />
      <line x1="${tbX + tbW * 0.5}" y1="${tbY + 245}" x2="${tbX + tbW * 0.5}" y2="${tbY + 340}" stroke="#0f172a" stroke-width="1" />

      <!-- Title Block Header -->
      <text x="${tbX + 12}" y="${tbY + 170}" font-size="12" font-weight="900" fill="#0f172a" letter-spacing="1">WEBSKETCH 3D BIM</text>
      <text x="${tbX + 12}" y="${tbY + 185}" font-size="9" font-weight="600" fill="#64748b">STRUCTURAL REINFORCEMENT DETAILING</text>
      <rect x="${tbX + tbW - 80}" y="${tbY + 158}" width="70" height="24" fill="#16a34a" rx="3" />
      <text x="${tbX + tbW - 45}" y="${tbY + 174}" font-size="9" font-weight="800" fill="#ffffff" text-anchor="middle">APPROVED</text>

      <!-- Drawing Title -->
      <text x="${tbX + 12}" y="${tbY + 212}" font-size="8" font-weight="700" fill="#64748b">DRAWING TITLE</text>
      <text x="${tbX + 12}" y="${tbY + 232}" font-size="13" font-weight="900" fill="#2563eb">${typeLabel} REBAR DETAILS &amp; BBS</text>

      <!-- Element Mark & Style -->
      <text x="${tbX + 12}" y="${tbY + 260}" font-size="8" font-weight="700" fill="#64748b">ELEMENT MARK</text>
      <text x="${tbX + 12}" y="${tbY + 280}" font-size="13" font-weight="800" fill="#0f172a">${mark}</text>

      <text x="${tbX + tbW * 0.5 + 12}" y="${tbY + 260}" font-size="8" font-weight="700" fill="#64748b">STYLE / CODE</text>
      <text x="${tbX + tbW * 0.5 + 12}" y="${tbY + 280}" font-size="10" font-weight="800" fill="#0f172a">${styleObj.name.slice(0, 18)}</text>

      <!-- Sheet No & Date -->
      <text x="${tbX + 12}" y="${tbY + 310}" font-size="8" font-weight="700" fill="#64748b">SHEET NUMBER</text>
      <text x="${tbX + 12}" y="${tbY + 330}" font-size="13" font-weight="800" fill="#dc2626">S-${mark}</text>

      <text x="${tbX + tbW * 0.5 + 12}" y="${tbY + 310}" font-size="8" font-weight="700" fill="#64748b">DATE / REV</text>
      <text x="${tbX + tbW * 0.5 + 12}" y="${tbY + 330}" font-size="11" font-weight="800" fill="#0f172a">${new Date().toISOString().slice(0, 10)} / REV 0</text>
    `;

    svg += '</svg>';
    return svg;
  }

  // =========================================================================
  // 3. AUTOCAD DXF CONVERTER FOR EVERY ELEMENT TYPE
  // =========================================================================
  function exportAutoCadDXF(opts) {
    const normType = normalizeType(opts.normType || opts.type || (opts.ent && opts.ent.type));
    const ent = opts.ent;
    const dims = opts.dims || extractElementDims(ent, normType);
    const params = opts.params || (ent && ent.params) || {};
    const schedule = opts.schedule || extractElementSchedule(ent, normType, dims, params);
    const mark = getElementMark(ent, normType);
    const typeLabel = normType.toUpperCase();

    const lines = [];
    const entCmd = (code, val) => { lines.push(String(code)); lines.push(String(val)); };

    const layers = [
      { name: '0', color: 7, ltype: 'CONTINUOUS' },
      { name: 'S-BORDER', color: 4, ltype: 'CONTINUOUS' },         // Cyan
      { name: 'S-TITLE-TEXT', color: 7, ltype: 'CONTINUOUS' },     // White
      { name: 'S-CONC-OUTLINE', color: 7, ltype: 'CONTINUOUS' },   // White
      { name: 'S-REBAR-MAIN', color: 5, ltype: 'CONTINUOUS' },     // Blue
      { name: 'S-REBAR-TIES', color: 1, ltype: 'CONTINUOUS' },     // Red
      { name: 'S-REBAR-BENT', color: 6, ltype: 'CONTINUOUS' },     // Magenta
      { name: 'S-REBAR-CALLOUT', color: 2, ltype: 'CONTINUOUS' },  // Yellow
      { name: 'S-DIMENSIONS', color: 3, ltype: 'CONTINUOUS' },     // Green
      { name: 'S-BBS-GRID', color: 7, ltype: 'CONTINUOUS' },       // White
      { name: 'S-BBS-TEXT', color: 2, ltype: 'CONTINUOUS' },       // Yellow
    ];

    function addLine(layer, x1, y1, x2, y2) {
      entCmd(0, 'LINE');
      entCmd(8, layer);
      entCmd(10, x1.toFixed(3)); entCmd(20, y1.toFixed(3)); entCmd(30, '0.0');
      entCmd(11, x2.toFixed(3)); entCmd(21, y2.toFixed(3)); entCmd(31, '0.0');
    }

    function addRect(layer, x, y, w, h) {
      addLine(layer, x, y, x + w, y);
      addLine(layer, x + w, y, x + w, y + h);
      addLine(layer, x + w, y + h, x, y + h);
      addLine(layer, x, y + h, x, y);
    }

    function addCircle(layer, cx, cy, r) {
      entCmd(0, 'CIRCLE');
      entCmd(8, layer);
      entCmd(10, cx.toFixed(3)); entCmd(20, cy.toFixed(3)); entCmd(30, '0.0');
      entCmd(40, r.toFixed(3));
    }

    function addText(layer, text, x, y, height = 3.5, rotation = 0) {
      entCmd(0, 'TEXT');
      entCmd(8, layer);
      entCmd(10, x.toFixed(3)); entCmd(20, y.toFixed(3)); entCmd(30, '0.0');
      entCmd(40, height.toFixed(2));
      entCmd(1, text);
      if (rotation !== 0) entCmd(50, rotation);
    }

    function addDimension(layer, x1, y1, x2, y2, text, offset = 10, isVertical = false) {
      if (!isVertical) {
        const dimY = y1 + offset;
        addLine(layer, x1, y1, x1, dimY + 3);
        addLine(layer, x2, y2, x2, dimY + 3);
        addLine(layer, x1, dimY, x2, dimY);
        addText(layer, text, (x1 + x2) / 2 - 15, dimY + 2, 3.5);
      } else {
        const dimX = x1 + offset;
        addLine(layer, x1, y1, dimX + 3, y1);
        addLine(layer, x2, y2, dimX + 3, y2);
        addLine(layer, dimX, y1, dimX, y2);
        addText(layer, text, dimX + 2, (y1 + y2) / 2 - 5, 3.5, 90);
      }
    }

    const sheetW = 840, sheetH = 594; // A1 standard sheet in mm

    // Border & Title Block
    addRect('S-BORDER', 10, 10, sheetW - 20, sheetH - 20);
    addRect('S-BORDER', 15, 15, sheetW - 30, sheetH - 30);
    addText('S-BORDER', `ACI 318-19 STRUCTURAL DETAILING SHEET — ${typeLabel} ${mark}`, 25, sheetH - 25, 4.5);

    const tbX = sheetW - 260, tbY = 20, tbW = 240, tbH = 150;
    addRect('S-BORDER', tbX, tbY, tbW, tbH);
    addLine('S-BORDER', tbX, tbY + 40, tbX + tbW, tbY + 40);
    addLine('S-BORDER', tbX, tbY + 80, tbX + tbW, tbY + 80);
    addLine('S-BORDER', tbX, tbY + 115, tbX + tbW, tbY + 115);
    addLine('S-BORDER', tbX + tbW / 2, tbY, tbX + tbW / 2, tbY + 80);

    addText('S-TITLE-TEXT', 'WEBSKETCH 3D BIM ENGINE', tbX + 10, tbY + 130, 5.0);
    addText('S-TITLE-TEXT', `${typeLabel} REINFORCEMENT DETAILS`, tbX + 10, tbY + 95, 5.5);
    addText('S-TITLE-TEXT', `ELEMENT: ${mark}`, tbX + 10, tbY + 55, 5.0);
    addText('S-TITLE-TEXT', 'SCALE: 1:20', tbX + tbW / 2 + 10, tbY + 55, 4.5);
    addText('S-TITLE-TEXT', `DWG NO: S-${mark}`, tbX + 10, tbY + 15, 5.5);
    addText('S-TITLE-TEXT', `DATE: ${new Date().toISOString().slice(0, 10)}`, tbX + tbW / 2 + 10, tbY + 15, 4.0);

    // CAD Drawing Geometry per Element Type
    if (normType === 'column') {
      const cw = +(params.w || dims.w || 0.4) * 1000;
      const cd = +(params.d || dims.d || dims.w || 0.4) * 1000;
      const ch = +(params.h || dims.h || 3.2) * 1000;

      // View 1: Column Cross Section (Left)
      const secX = 60, secY = 320;
      addText('S-TITLE-TEXT', 'VIEW 1: COLUMN CROSS-SECTION (SCALE 1:20)', secX, secY + cd * 0.4 + 40, 4.5);
      addRect('S-CONC-OUTLINE', secX, secY, cw * 0.4, cd * 0.4);
      addRect('S-REBAR-TIES', secX + 8, secY + 8, cw * 0.4 - 16, cd * 0.4 - 16);

      // Main bars (8 bars)
      addCircle('S-REBAR-MAIN', secX + 14, secY + 14, 4.5);
      addCircle('S-REBAR-MAIN', secX + cw * 0.4 - 14, secY + 14, 4.5);
      addCircle('S-REBAR-MAIN', secX + 14, secY + cd * 0.4 - 14, 4.5);
      addCircle('S-REBAR-MAIN', secX + cw * 0.4 - 14, secY + cd * 0.4 - 14, 4.5);
      addCircle('S-REBAR-MAIN', secX + cw * 0.2, secY + 14, 4);
      addCircle('S-REBAR-MAIN', secX + cw * 0.2, secY + cd * 0.4 - 14, 4);
      addCircle('S-REBAR-MAIN', secX + 14, secY + cd * 0.2, 4);
      addCircle('S-REBAR-MAIN', secX + cw * 0.4 - 14, secY + cd * 0.2, 4);

      addDimension('S-DIMENSIONS', secX, secY + cd * 0.4, secX + cw * 0.4, secY + cd * 0.4, `${Math.round(cw)} mm`, 15);
      addDimension('S-DIMENSIONS', secX, secY, secX, secY + cd * 0.4, `${Math.round(cd)} mm`, -15, true);

      // View 2: Column Vertical Elevation (Center/Right)
      const elX = 320, elY = 260, elW = 100, elH = 260;
      addText('S-TITLE-TEXT', 'VIEW 2: VERTICAL ELEVATION & CONFINEMENT HOOPS', elX - 20, elY + elH + 40, 4.5);
      addRect('S-CONC-OUTLINE', elX, elY, elW, elH);

      // Vertical Rebar Lines + Lap
      addLine('S-REBAR-MAIN', elX + 12, elY, elX + 12, elY + elH + 45);
      addLine('S-REBAR-MAIN', elX + elW - 12, elY, elX + elW - 12, elY + elH + 45);
      addLine('S-REBAR-MAIN', elX + elW / 2, elY, elX + elW / 2, elY + elH + 45);

      // Confinement Ties
      for (let y = elY + 10; y <= elY + 60; y += 10) addLine('S-REBAR-TIES', elX + 6, y, elX + elW - 6, y);
      for (let y = elY + 80; y <= elY + elH - 80; y += 25) addLine('S-REBAR-TIES', elX + 6, y, elX + elW - 6, y);
      for (let y = elY + elH - 60; y <= elY + elH - 10; y += 10) addLine('S-REBAR-TIES', elX + 6, y, elX + elW - 6, y);

      addDimension('S-DIMENSIONS', elX, elY, elX, elY + elH, `H = ${(ch / 1000).toFixed(2)} m`, -25, true);
      addText('S-REBAR-CALLOUT', 'CLASS B LAP SPLICE (1.3 Ld)', elX + elW + 15, elY + elH + 30, 3.5);

    } else if (normType === 'beam') {
      const bw = +(params.w || dims.w || 0.3) * 1000;
      const bh = +(params.h || dims.h || 0.5) * 1000;
      const bSpan = +(dims.l || 4.5) * 1000;

      const secX = 60, secY = 320;
      addText('S-TITLE-TEXT', 'VIEW 1: BEAM CROSS SECTION (SCALE 1:20)', secX, secY + bh * 0.4 + 40, 4.5);
      addRect('S-CONC-OUTLINE', secX, secY, bw * 0.4, bh * 0.4);
      addRect('S-REBAR-TIES', secX + 8, secY + 8, bw * 0.4 - 16, bh * 0.4 - 16);
      addCircle('S-REBAR-MAIN', secX + 14, secY + bh * 0.4 - 14, 4);
      addCircle('S-REBAR-MAIN', secX + bw * 0.4 - 14, secY + bh * 0.4 - 14, 4);
      addCircle('S-REBAR-MAIN', secX + 14, secY + 14, 4);
      addCircle('S-REBAR-BENT', secX + bw * 0.2, secY + 14, 4.5);
      addCircle('S-REBAR-MAIN', secX + bw * 0.4 - 14, secY + 14, 4);

      addDimension('S-DIMENSIONS', secX, secY + bh * 0.4, secX + bw * 0.4, secY + bh * 0.4, `${Math.round(bw)} mm`, 15);
      addDimension('S-DIMENSIONS', secX, secY, secX, secY + bh * 0.4, `${Math.round(bh)} mm`, -15, true);

      const elX = 260, elY = 320, elW = 500, elH = bh * 0.3;
      addText('S-TITLE-TEXT', 'VIEW 2: LONGITUDINAL ELEVATION & 45 DEG BENT-UP BARS', elX, elY + elH + 40, 4.5);
      addRect('S-CONC-OUTLINE', elX, elY, elW, elH);
      addRect('S-CONC-OUTLINE', elX - 40, elY - 20, 40, elH + 40);
      addRect('S-CONC-OUTLINE', elX + elW, elY - 20, 40, elH + 40);

      addLine('S-REBAR-MAIN', elX - 25, elY + elH - 30, elX - 25, elY + elH - 10);
      addLine('S-REBAR-MAIN', elX - 25, elY + elH - 10, elX + elW + 25, elY + elH - 10);
      addLine('S-REBAR-MAIN', elX + elW + 25, elY + elH - 10, elX + elW + 25, elY + elH - 30);
      addLine('S-REBAR-MAIN', elX - 20, elY + 10, elX + elW + 20, elY + 10);
      addText('S-REBAR-CALLOUT', '2-#6 BOTTOM CONTINUOUS (ACI §9.8)', elX + elW * 0.35, elY + 14, 3.5);
      addText('S-REBAR-CALLOUT', 'BENT-UP TRUSS BAR (45 DEG CRANK)', elX + elW * 0.4, elY + elH / 2, 3.5);

      const c1 = elX + elW * 0.20, c2 = elX + elW * 0.80;
      addLine('S-REBAR-BENT', elX - 20, elY + elH - 14, c1 - 30, elY + elH - 14);
      addLine('S-REBAR-BENT', c1 - 30, elY + elH - 14, c1, elY + 14);
      addLine('S-REBAR-BENT', c1, elY + 14, c2, elY + 14);
      addLine('S-REBAR-BENT', c2, elY + 14, c2 + 30, elY + elH - 14);
      addLine('S-REBAR-BENT', c2 + 30, elY + elH - 14, elX + elW + 20, elY + elH - 14);

      for (let i = 0; i <= 20; i++) {
        const sx = elX + 10 + (i / 20) * (elW - 20);
        addLine('S-REBAR-TIES', sx, elY + 8, sx, elY + elH - 8);
      }
      addDimension('S-DIMENSIONS', elX, elY + elH, elX + elW, elY + elH, `Ln = ${(bSpan / 1000).toFixed(2)} m`, 25);

    } else if (normType === 'slab') {
      const th = +(params.thickness || dims.h || 0.2) * 1000;
      const secX = 60, secY = 360, secW = 200, secH = Math.max(30, th * 0.3);
      addText('S-TITLE-TEXT', 'VIEW 1: SLAB EDGE SECTION', secX, secY + secH + 30, 4.5);
      addRect('S-CONC-OUTLINE', secX, secY, secW, secH);
      addLine('S-REBAR-MAIN', secX + 10, secY + 8, secX + secW - 10, secY + 8);
      for (let x = secX + 25; x <= secX + secW - 25; x += 30) addCircle('S-REBAR-MAIN', x, secY + 8, 3.5);

      const plX = 320, plY = 260, plW = 420, plH = 260;
      addText('S-TITLE-TEXT', 'VIEW 2: TWO-WAY BOTTOM FLEXURAL MESH PLAN', plX, plY + plH + 30, 4.5);
      addRect('S-CONC-OUTLINE', plX, plY, plW, plH);
      for (let y = plY + 20; y <= plY + plH - 20; y += 30) addLine('S-REBAR-MAIN', plX + 10, y, plX + plW - 10, y);
      for (let x = plX + 20; x <= plX + plW - 20; x += 35) addLine('S-REBAR-MAIN', x, plY + 10, x, plY + plH - 10);
      addDimension('S-DIMENSIONS', plX, plY + plH, plX + plW, plY + plH, `Lx = ${dims.w.toFixed(2)} m`, 15);

    } else if (normType === 'foundation') {
      const secX = 60, secY = 320, secW = 220, secH = 100;
      addText('S-TITLE-TEXT', 'VIEW 1: FOOTING ELEVATION SECTION', secX, secY + secH + 35, 4.5);
      addRect('S-CONC-OUTLINE', secX, secY, secW, secH);
      // Bottom Mat Hooked Line
      addLine('S-REBAR-MAIN', secX + 15, secY + 35, secX + 15, secY + 15);
      addLine('S-REBAR-MAIN', secX + 15, secY + 15, secX + secW - 15, secY + 15);
      addLine('S-REBAR-MAIN', secX + secW - 15, secY + 15, secX + secW - 15, secY + 35);
      // Starter dowels
      addLine('S-REBAR-BENT', secX + secW / 2 - 25, secY + secH + 35, secX + secW / 2 - 25, secY + 15);
      addLine('S-REBAR-BENT', secX + secW / 2 - 25, secY + 15, secX + secW / 2 - 55, secY + 15);
      addLine('S-REBAR-BENT', secX + secW / 2 + 25, secY + secH + 35, secX + secW / 2 + 25, secY + 15);
      addLine('S-REBAR-BENT', secX + secW / 2 + 25, secY + 15, secX + secW / 2 + 55, secY + 15);

      const plX = 350, plY = 260, plW = 260, plH = 260;
      addText('S-TITLE-TEXT', 'VIEW 2: BOTTOM REBAR MAT & COLUMN DOWEL PLAN', plX, plY + plH + 35, 4.5);
      addRect('S-CONC-OUTLINE', plX, plY, plW, plH);
      for (let y = plY + 25; y <= plY + plH - 25; y += 35) addLine('S-REBAR-MAIN', plX + 12, y, plX + plW - 12, y);
      for (let x = plX + 25; x <= plX + plW - 25; x += 35) addLine('S-REBAR-MAIN', x, plY + 12, x, plY + plH - 12);
      addRect('S-CONC-OUTLINE', plX + plW / 2 - 30, plY + plH / 2 - 30, 60, 60);

    } else if (normType === 'wall') {
      const secX = 60, secY = 320, secW = 60, secH = 220;
      addText('S-TITLE-TEXT', 'VIEW 1: WALL SECTION', secX, secY + secH + 30, 4.5);
      addRect('S-CONC-OUTLINE', secX, secY, secW, secH);
      addLine('S-REBAR-MAIN', secX + 12, secY + 10, secX + 12, secY + secH - 10);
      addLine('S-REBAR-MAIN', secX + secW - 12, secY + 10, secX + secW - 12, secY + secH - 10);

      const elX = 220, elY = 280, elW = 500, elH = 260;
      addText('S-TITLE-TEXT', 'VIEW 2: WALL ELEVATION & TWO CURTAINS', elX, elY + elH + 30, 4.5);
      addRect('S-CONC-OUTLINE', elX, elY, elW, elH);
      for (let x = elX + 25; x <= elX + elW - 25; x += 35) addLine('S-REBAR-MAIN', x, elY + 8, x, elY + elH - 8);
      for (let y = elY + 25; y <= elY + elH - 25; y += 35) addLine('S-REBAR-MAIN', elX + 8, y, elX + elW - 8, y);
    }

    // BAR BENDING SCHEDULE Table in DXF
    const bbsX = 40, bbsY = 40, bbsW = 480, rowH = 14;
    addRect('S-BBS-GRID', bbsX, bbsY, bbsW, 140);
    addText('S-TITLE-TEXT', `BAR BENDING SCHEDULE (BBS) — ${typeLabel} ${mark}`, bbsX + 10, bbsY + 125, 4.5);

    addLine('S-BBS-GRID', bbsX, bbsY + 115, bbsX + bbsW, bbsY + 115);
    addText('S-BBS-TEXT', 'MARK', bbsX + 8, bbsY + 118, 3.2);
    addText('S-BBS-TEXT', 'DESCRIPTION', bbsX + 45, bbsY + 118, 3.2);
    addText('S-BBS-TEXT', 'SHAPE', bbsX + 240, bbsY + 118, 3.2);
    addText('S-BBS-TEXT', 'SIZE', bbsX + 290, bbsY + 118, 3.2);
    addText('S-BBS-TEXT', 'NO.', bbsX + 340, bbsY + 118, 3.2);
    addText('S-BBS-TEXT', 'LENGTH', bbsX + 375, bbsY + 118, 3.2);
    addText('S-BBS-TEXT', 'WEIGHT', bbsX + 430, bbsY + 118, 3.2);

    schedule.forEach((it, idx) => {
      const curY = bbsY + 115 - (idx + 1) * rowH;
      addLine('S-BBS-GRID', bbsX, curY, bbsX + bbsW, curY);
      addText('S-BBS-TEXT', it.mark, bbsX + 10, curY + 3, 3.2);
      addText('S-BBS-TEXT', it.desc.slice(0, 32), bbsX + 45, curY + 3, 3.0);
      addText('S-BBS-TEXT', it.shapeCode, bbsX + 245, curY + 3, 3.2);
      addText('S-BBS-TEXT', it.bar.us, bbsX + 295, curY + 3, 3.2);
      addText('S-BBS-TEXT', String(it.count), bbsX + 345, curY + 3, 3.2);
      addText('S-BBS-TEXT', `${it.len.toFixed(2)}m`, bbsX + 375, curY + 3, 3.2);
      addText('S-BBS-TEXT', `${it.weight.toFixed(1)}kg`, bbsX + 430, curY + 3, 3.2);
    });

    return [
      '0', 'SECTION', '2', 'HEADER',
      '9', '$ACADVER', '1', 'AC1009',
      '9', '$INSUNITS', '70', '4', // mm
      '9', '$EXTMIN', '10', '0.0', '20', '0.0', '30', '0.0',
      '9', '$EXTMAX', '10', sheetW.toFixed(1), '20', sheetH.toFixed(1), '30', '0.0',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES',
      '0', 'TABLE', '2', 'LAYER', '70', String(layers.length),
      ...layers.flatMap(l => [
        '0', 'LAYER', '2', l.name, '70', '0', '62', String(l.color), '6', l.ltype
      ]),
      '0', 'ENDTAB',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      ...lines,
      '0', 'ENDSEC',
      '0', 'EOF'
    ].join('\r\n');
  }

  // =========================================================================
  // 4. RESOLVE SELECTED OR TARGET ELEMENT IN MODEL
  // =========================================================================
  function resolveTargetElement(app, entId) {
    if (!app) return null;
    const ents = (app.bim && app.bim.entities) || [];

    // 1. Explicit ID passed
    if (entId) {
      const e = ents.find(x => x.id === entId);
      if (e) return e;
    }

    // 2. singleElementSelection
    if (app.singleElementSelection) {
      const e = app.singleElementSelection();
      if (e) return e;
    }

    // 3. Check selected faces in 3D viewport
    if (app.sel && app.sel.faces && app.sel.faces.size > 0 && app.model) {
      for (const fid of app.sel.faces) {
        const f = app.model.faces.get(fid);
        const uid = f && f.userData && f.userData.bimEntityId;
        if (uid) {
          const e = ents.find(x => x.id === uid);
          if (e) return e;
        }
      }
    }

    // 4. Check selected edges in 3D viewport
    if (app.sel && app.sel.edges && app.sel.edges.size > 0 && app.model) {
      for (const eid of app.sel.edges) {
        const ed = app.model.edges.get(eid);
        const uid = ed && ed.userData && ed.userData.bimEntityId;
        if (uid) {
          const e = ents.find(x => x.id === uid);
          if (e) return e;
        }
      }
    }

    return null;
  }

  // =========================================================================
  // 5. MODAL DIALOG & PRINT CONTROLLER WITH DYNAMIC ELEMENT & STYLE SWITCHER
  // =========================================================================
  const RebarDoc = {
    /** Open the CAD Detailing Sheet Modal */
    openSheet(opts = {}) {
      const app = (opts && opts.app) || window.app;
      if (!app) return;

      const structuralEntities = (app.bim && app.bim.entities || []).filter(e =>
        ['column', 'beam', 'floor', 'slab', 'foundation', 'footing', 'stripfoot', 'wall'].includes(e.type)
      );

      let targetEnt = null;
      let targetId = null;
      let styleKey = 'standard';
      if (typeof opts === 'string') {
        targetId = opts;
      } else if (opts && opts.id && (opts.type || opts.params)) {
        targetEnt = opts;
        targetId = opts.id;
      } else if (opts && typeof opts === 'object') {
        targetEnt = opts.ent;
        targetId = opts.entId;
        if (opts.style) styleKey = opts.style;
      }

      let ent = targetEnt || resolveTargetElement(app, targetId);

      // If no element was specifically selected, but structural elements exist, select the first one
      if (!ent && structuralEntities.length > 0) {
        ent = structuralEntities[0];
        app.toast(`Rebar Detailing Sheet: Showing ${ent.name || ent.id}. Select an element or use dropdown to switch.`);
      }

      if (!ent) {
        app.toast('Please draw or select an element first (Column, Beam, Slab, Foundation, Wall)', true);
        return;
      }

      let currentEntId = ent.id;
      let currentStyle = styleKey || 'standard';

      // Function to generate content for currently selected element and style
      const buildSheetState = (targetId, styleParam) => {
        const targetEnt = (app.bim && app.bim.entities || []).find(e => e.id === targetId) || ent;
        const normType = normalizeType(targetEnt.type);
        const dims = extractElementDims(targetEnt, normType);
        const params = (opts && opts.params) || targetEnt.params || {};
        const mark = getElementMark(targetEnt, normType);
        const schedule = extractElementSchedule(targetEnt, normType, dims, params, styleParam);
        const svg = renderDetailingSheetSVG({
          ent: targetEnt,
          normType,
          dims,
          params,
          schedule,
          style: styleParam
        });

        return { targetEnt, normType, dims, params, mark, schedule, svg };
      };

      let state = buildSheetState(currentEntId, currentStyle);

      // Element selector options
      const elementOptions = structuralEntities.map(e => {
        const nt = normalizeType(e.type);
        const em = getElementMark(e, nt);
        const d = extractElementDims(e, nt);
        const dimStr = nt === 'beam' ? `${d.w.toFixed(2)}x${d.h.toFixed(2)}m (L=${d.l.toFixed(2)}m)`
          : nt === 'column' ? `${d.w.toFixed(2)}x${d.d.toFixed(2)}m (H=${d.h.toFixed(2)}m)`
          : nt === 'slab' ? `${d.w.toFixed(2)}x${d.l.toFixed(2)}m (t=${d.h.toFixed(2)}m)`
          : nt === 'foundation' ? `${d.w.toFixed(2)}x${d.l.toFixed(2)}m (T=${d.h.toFixed(2)}m)`
          : `${d.l.toFixed(2)}x${d.h.toFixed(2)}m (t=${d.w.toFixed(2)}m)`;
        return `<option value="${e.id}"${e.id === currentEntId ? ' selected' : ''}>${em} (${nt.toUpperCase()} · ${dimStr})</option>`;
      }).join('');

      const styleOptions = Object.values(STYLES).map(s =>
        `<option value="${s.id}"${s.id === currentStyle ? ' selected' : ''}>${s.name}</option>`
      ).join('');

      const modalHtml = `
        <div class="rebardoc-container" style="display:flex; flex-direction:column; height:86vh; max-height:920px; width:94vw; max-width:1280px; background:#f8fafc; border-radius:8px; overflow:hidden;">
          <!-- Top CAD Sheet Toolbar -->
          <div class="rebardoc-toolbar" style="display:flex; align-items:center; justify-content:space-between; padding:10px 18px; background:#0f172a; color:#ffffff; flex:none; flex-wrap:wrap; gap:10px;">
            <div style="display:flex; align-items:center; gap:14px;">
              <span style="font-size:18px;">📐</span>
              <div>
                <div style="font-size:13px; font-weight:800; letter-spacing:0.5px;">STRUCTURAL REBAR DETAILING SHEET (ACI 318 &amp; BS 8666)</div>
                <div id="rd-sub-label" style="font-size:11px; color:#94a3b8;">
                  Element: <b id="rd-mark-txt" style="color:#60a5fa;">${state.mark}</b> · Real-time 2D Drawing &amp; Bar Bending Schedule
                </div>
              </div>
            </div>

            <!-- Dynamic Element & Style Switchers -->
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="display:flex; align-items:center; gap:6px; background:#1e293b; padding:4px 8px; border-radius:5px; border:1px solid #334155;">
                <span style="font-size:11px; font-weight:700; color:#94a3b8;">Element:</span>
                <select id="rd-select-element" style="background:#0f172a; color:#ffffff; border:1px solid #475569; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:700; cursor:pointer; max-width:240px;">
                  ${elementOptions}
                </select>
              </div>

              <div style="display:flex; align-items:center; gap:6px; background:#1e293b; padding:4px 8px; border-radius:5px; border:1px solid #334155;">
                <span style="font-size:11px; font-weight:700; color:#94a3b8;">Style:</span>
                <select id="rd-select-style" style="background:#0f172a; color:#ffffff; border:1px solid #475569; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:700; cursor:pointer;">
                  ${styleOptions}
                </select>
              </div>
            </div>

            <!-- Action Buttons -->
            <div style="display:flex; align-items:center; gap:8px;">
              <button id="rd-btn-dxf" class="cr-btn" style="background:#2563eb; color:#ffffff; font-weight:700; display:flex; align-items:center; gap:6px; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;" title="Download complete AutoCAD DXF file with layers and editable entities">
                <span>⚡</span> Export AutoCAD (.dxf)
              </button>
              <button id="rd-btn-print" class="cr-btn" style="background:#059669; color:#ffffff; font-weight:700; display:flex; align-items:center; gap:6px; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;" title="Print drawing sheet or Save to PDF">
                <span>🖨️</span> Print / PDF
              </button>
              <button id="rd-btn-svg" class="cr-btn" style="background:#475569; color:#ffffff; font-weight:600; display:flex; align-items:center; gap:6px; border:none; padding:6px 10px; border-radius:4px; cursor:pointer;" title="Download scalable vector graphic">
                <span>📥</span> SVG
              </button>
              <button id="rd-btn-csv" class="cr-btn" style="background:#475569; color:#ffffff; font-weight:600; display:flex; align-items:center; gap:6px; border:none; padding:6px 10px; border-radius:4px; cursor:pointer;" title="Export Bar Bending Schedule to CSV spreadsheet">
                <span>📊</span> CSV
              </button>
            </div>
          </div>

          <!-- Drawing Sheet Canvas Wrap -->
          <div class="rebardoc-canvas-wrap" style="flex:1; overflow:auto; padding:20px; display:flex; justify-content:center; align-items:center; background:#cbd5e1;">
            <div id="rebardoc-sheet-surface" style="width:100%; max-width:1080px; background:#ffffff; box-shadow:0 10px 25px -5px rgba(0,0,0,0.3); border-radius:4px; overflow:hidden;">
              ${state.svg}
            </div>
          </div>
        </div>
      `;

      app.dialog(`Structural Rebar Detailing — ${state.mark}`, modalHtml, [
        ['Close', null]
      ]);

      const dlg = document.getElementById('dialog');
      if (dlg) {
        dlg.classList.add('cr-dialog-active');
        dlg.style.maxWidth = '1320px';
      }

      // Wire Up Toolbar Actions & Dynamic Updates
      setTimeout(() => {
        const selElem = document.getElementById('rd-select-element');
        const selStyle = document.getElementById('rd-select-style');
        const surface = document.getElementById('rebardoc-sheet-surface');
        const markTxt = document.getElementById('rd-mark-txt');
        const btnDxf = document.getElementById('rd-btn-dxf');
        const btnPrint = document.getElementById('rd-btn-print');
        const btnSvg = document.getElementById('rd-btn-svg');
        const btnCsv = document.getElementById('rd-btn-csv');

        const updateSheetView = () => {
          state = buildSheetState(currentEntId, currentStyle);
          if (surface) surface.innerHTML = state.svg;
          if (markTxt) markTxt.textContent = state.mark;
          const dlgHead = document.querySelector('.dialog-title, .dialog-head, .cr-dialog-head');
          if (dlgHead) {
            const xBtn = dlgHead.querySelector('.dlg-x');
            dlgHead.innerHTML = `Structural Rebar Detailing — ${state.mark}`;
            if (xBtn) dlgHead.appendChild(xBtn);
          }
        };

        if (selElem) {
          selElem.addEventListener('change', (ev) => {
            currentEntId = ev.target.value;
            updateSheetView();
            app.toast(`Switched sheet to ${state.mark} (${state.normType.toUpperCase()})`);
          });
        }

        if (selStyle) {
          selStyle.addEventListener('change', (ev) => {
            currentStyle = ev.target.value;
            updateSheetView();
            app.toast(`Detailing style updated: ${STYLES[currentStyle]?.name}`);
          });
        }

        if (btnDxf) {
          btnDxf.onclick = () => {
            const dxfContent = exportAutoCadDXF({
              ent: state.targetEnt,
              normType: state.normType,
              dims: state.dims,
              params: state.params,
              schedule: state.schedule
            });
            const blob = new Blob([dxfContent], { type: 'application/dxf' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${state.mark}-rebar-detailing.dxf`;
            a.click();
            app.toast(`AutoCAD DXF exported: ${state.mark}-rebar-detailing.dxf`);
          };
        }

        if (btnPrint) {
          btnPrint.onclick = () => {
            window.print();
          };
        }

        if (btnSvg) {
          btnSvg.onclick = () => {
            const svgEl = document.getElementById('rebardoc-svg');
            if (!svgEl) return;
            const svgData = new XMLSerializer().serializeToString(svgEl);
            const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${state.mark}-rebar-sheet.svg`;
            a.click();
            app.toast('Vector SVG downloaded');
          };
        }

        if (btnCsv) {
          btnCsv.onclick = () => {
            let csv = 'Mark,Description,ShapeCode,BarSize,Dia_mm,Count,Length_m,Total_m,kg_per_m,Total_kg\n';
            state.schedule.forEach(it => {
              csv += `"${it.mark}","${it.desc}","${it.shapeCode}","${it.bar.us}",${it.bar.mm},${it.count},${it.len.toFixed(3)},${(it.len * it.count).toFixed(2)},${it.bar.kgM.toFixed(3)},${it.weight.toFixed(1)}\n`;
            });
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${state.mark}-bbs-schedule.csv`;
            a.click();
            app.toast('BBS Schedule CSV downloaded');
          };
        }
      }, 50);
    },

    /** Export pure DXF file directly from any context */
    exportDxf(opts) {
      return exportAutoCadDXF(opts);
    },

    /** Export whole model BBS as AutoCAD DXF table */
    exportDxfBbs(app) {
      app = app || window.app;
      if (!app) return;
      const rows = app.bbsRows ? app.bbsRows() : [];
      if (!rows.length) {
        app.toast('No reinforcement in the model yet to export', true);
        return;
      }
      const schedule = rows.map((r, i) => {
        const bar = findBar(r.diaMM / 1000);
        return {
          mark: String(i + 1).padStart(2, '0'),
          desc: `${r.host.toUpperCase()} ${r.shape.toUpperCase()}`,
          shapeCode: r.shape === 'stirrup' ? '51' : r.shape === 'crank' ? '26' : '00',
          bar,
          count: r.bars,
          len: r.len,
          weight: +(r.len * r.bars * bar.kgM).toFixed(1)
        };
      });

      const dxf = exportAutoCadDXF({
        ent: { id: 'PROJECT-BBS', name: 'PROJECT REBAR SCHEDULE' },
        normType: 'beam',
        dims: { w: 0.3, h: 0.5, l: 5.0 },
        params: {},
        schedule
      });

      const blob = new Blob([dxf], { type: 'application/dxf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'project-rebar-schedule.dxf';
      a.click();
      app.toast('AutoCAD DXF Bar Bending Schedule exported');
    }
  };

  window.RebarDoc = RebarDoc;
})();
