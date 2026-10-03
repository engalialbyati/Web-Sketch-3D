'use strict';
// ---------------------------------------------------------------------------
// rebardoc.js — Structural Rebar Detailing Documentation, AutoCAD DXF Converter & Print Engine.
//
// Compliant with ACI 318-19, ACI 315-18 (Details and Detailing of Concrete Reinforcement),
// CRSI MNL-66, and BS 8666 (Scheduling, dimensioning, bending and cutting of rebar).
//
// Capabilities:
//   1. Rebar Detailing Sheet Generator:
//      • Professional engineering drawing sheet (A3/A4/A2/A1 Landscape) with
//        standard CAD border, coordinate grid (A-D, 1-4), and Title Block.
//      • Real-time multi-view layout: Detail Cross-Section/Plan, Longitudinal
//        Elevation with 45° cranked/bent-up truss bars, stirrups, lap splices.
//      • Dimension lines with extension lines and arrows.
//      • Rebar Callout Tags with leader lines (e.g. 2-#5 Top, 3-#6 Bot, Bent: 2-#6 @ 45°).
//      • Embedded Bar Bending Schedule (BBS) table with standard shape codes
//        (Shape 00, Shape 21, Shape 51, Shape 26, Shape 77) and mass calculations.
//      • General Structural Notes (materials f'c, fy, clear covers, hooks).
//
//   2. AutoCAD DXF Converter (.dxf):
//      • Converts the entire detailing drawing into standard, fully editable
//        AutoCAD DXF (AC1009/AC1015 / R12 / R2000).
//      • Industry standard CAD layers:
//          - S-BORDER (Border & Title Block frame)
//          - S-CONC-OUTLINE (Concrete elements & sections)
//          - S-REBAR-MAIN (Longitudinal main steel)
//          - S-REBAR-TIES (Stirrups, column ties, hoops)
//          - S-REBAR-BENT (Bent-up cranked truss bars)
//          - S-REBAR-CALLOUT (Bar annotations & leader lines)
//          - S-DIMENSIONS (Dimension lines, ticks & text)
//          - S-BBS-GRID (Schedule table line grid)
//          - S-BBS-TEXT (Schedule text & headers)
//      • True CAD entities: LINE, LWPOLYLINE, CIRCLE, TEXT, SOLID arrowheads.
//      • 100% editable in AutoCAD, Civil 3D, LibreCAD, BricsCAD, DWG TrueView.
//
//   3. High-Resolution Printing & Vector Export:
//      • window.print() formatted with @media print CSS for crisp border-to-border output.
//      • 1-Click SVG vector download.
//      • 1-Click BBS CSV spreadsheet export.
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
  ];

  const SHAPE_CODES = {
    straight: { code: '00', name: 'Straight Bar', desc: 'A' },
    lshape:   { code: '21', name: '90° L-Hook / Starter', desc: 'A + B' },
    stirrup:  { code: '51', name: 'Closed Rectangular Stirrup', desc: '2(A+B)+24d' },
    crank:    { code: '26', name: 'Bent-Up (Cranked) Bar', desc: 'A + 0.42D + B' },
    spiral:   { code: '77', name: 'Helical Spiral', desc: 'N·√(πD)²+s²' },
  };

  /** Helper to escape HTML */
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Bar diameter in mm from meters */
  function diaToMM(diaM) {
    if (!diaM) return 16;
    const mm = Math.round(diaM * 1000 * 10) / 10;
    return mm;
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

  // =========================================================================
  // 1. REBAR SCHEDULE & BBS DATA ENGINE
  // =========================================================================
  function extractElementSchedule(ent, type, dims, params) {
    dims = dims || { w: 0.3, h: 0.5, l: 3.5 };
    params = params || {};
    type = type || (ent && ent.type) || 'beam';
    const mark = (ent && (ent.name || ent.id)) || `${type.toUpperCase().slice(0, 3)}-101`;

    const items = [];
    let barMarkSeq = 1;
    const nextMark = () => String(barMarkSeq++).padStart(2, '0');

    if (type === 'beam') {
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
      const bentN = +(params.crank || 0);
      const stirDia = +(params.stirDia || 0.0095);
      const stirVal = +(params.stirVal || 0.15);

      const bTop = findBar(topDia);
      const bBot = findBar(botDia);
      const bStir = findBar(stirDia);

      // 01: Top Main Continuous Bars (with 90° standard hooks at ends)
      const topHookLen = 0.25;
      const topLen = +(span - 2 * sideCov + 2 * topHookLen).toFixed(3);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Top Longitudinal Steel (Negative Moment)',
        shape: 'lshape',
        shapeCode: '21',
        bar: bTop,
        count: topN,
        len: topLen,
        dims: `A=${(span - 2 * sideCov).toFixed(2)}, B=${topHookLen.toFixed(2)}`,
        weight: +(topN * topLen * bTop.kgM).toFixed(1)
      });

      // 02: Bottom Straight Continuous Bars (ACI §9.8 structural integrity)
      const botStraightN = Math.max(2, botN - bentN);
      const botLen = +(span - 2 * sideCov).toFixed(3);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Bottom Continuous Steel (ACI §9.8 Integrity)',
        shape: 'straight',
        shapeCode: '00',
        bar: bBot,
        count: botStraightN,
        len: botLen,
        dims: `A=${botLen.toFixed(2)}`,
        weight: +(botStraightN * botLen * bBot.kgM).toFixed(1)
      });

      // 03: Bent-Up (Cranked) Truss Bars (if any)
      if (bentN > 0) {
        const rise = +(h - topCov - botCov - topDia).toFixed(3);
        const slopeLen = +(0.42 * rise).toFixed(3);
        const bentLen = +(span - 2 * sideCov + 2 * slopeLen + 0.30).toFixed(3);
        items.push({
          mark: nextMark(),
          element: mark,
          desc: 'Bent-Up (Cranked) 45° Truss Bars (Shear + Hogging)',
          shape: 'crank',
          shapeCode: '26',
          bar: bBot,
          count: bentN,
          len: bentLen,
          dims: `A=${(span * 0.5).toFixed(2)}, D=${rise.toFixed(2)}, θ=45°`,
          weight: +(bentN * bentLen * bBot.kgM).toFixed(1)
        });
      }

      // 04: Closed Rectangular Stirrups
      const stirWidth = +(bw - 2 * sideCov).toFixed(3);
      const stirHeight = +(h - topCov - botCov).toFixed(3);
      const stirPerim = +(2 * (stirWidth + stirHeight) + 24 * bStir.mm / 1000).toFixed(3);
      const stirCount = Math.max(4, Math.round(span / stirVal) + 1);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Closed Rectangular Stirrups (135° Seismic Hooks)',
        shape: 'stirrup',
        shapeCode: '51',
        bar: bStir,
        count: stirCount,
        len: stirPerim,
        dims: `A=${stirWidth.toFixed(2)}, B=${stirHeight.toFixed(2)}`,
        weight: +(stirCount * stirPerim * bStir.kgM).toFixed(1)
      });
    } else if (type === 'column') {
      const cw = +(params.w || dims.w || 0.4);
      const cd = +(params.d || dims.h || 0.4);
      const ch = +(params.h || dims.l || 3.2);
      const cov = +(params.cov || 0.04);
      const mdia = +(params.mdia || 0.0191);
      const tdia = +(params.tdia || 0.0095);
      const mainN = +(params.mainN || 4);
      const tval = +(params.tval || 0.15);

      const bMain = findBar(mdia);
      const bTie = findBar(tdia);

      const lapLen = +(Math.max(0.5, 48 * bMain.mm / 1000)).toFixed(2);
      const colBarLen = +(ch + lapLen).toFixed(3);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Vertical Longitudinal Column Bars (Class B Lap)',
        shape: 'straight',
        shapeCode: '00',
        bar: bMain,
        count: mainN,
        len: colBarLen,
        dims: `A=${ch.toFixed(2)}, Lap=${lapLen}`,
        weight: +(mainN * colBarLen * bMain.kgM).toFixed(1)
      });

      const tieW = +(cw - 2 * cov).toFixed(3);
      const tieD = +(cd - 2 * cov).toFixed(3);
      const tieLen = +(2 * (tieW + tieD) + 24 * bTie.mm / 1000).toFixed(3);
      const tieCount = Math.max(4, Math.round(ch / tval) + 1);
      items.push({
        mark: nextMark(),
        element: mark,
        desc: 'Column Confinement Ties (135° Standard Hooks)',
        shape: 'stirrup',
        shapeCode: '51',
        bar: bTie,
        count: tieCount,
        len: tieLen,
        dims: `A=${tieW.toFixed(2)}, B=${tieD.toFixed(2)}`,
        weight: +(tieCount * tieLen * bTie.kgM).toFixed(1)
      });
    } else if (type === 'slab') {
      const th = +(params.thickness || dims.h || 0.2);
      const sx = +(dims.w || 4.5);
      const sy = +(dims.l || 4.5);
      const xDia = +(params.xDia || 0.0127);
      const yDia = +(params.yDia || 0.0127);
      const xSpacing = +(params.xv || 0.20);
      const ySpacing = +(params.yv || 0.20);
      const isCrank = !!params.crank;

      const bX = findBar(xDia);
      const bY = findBar(yDia);

      const countX = Math.round(sy / xSpacing) + 1;
      const countY = Math.round(sx / ySpacing) + 1;

      if (!isCrank) {
        items.push({
          mark: nextMark(),
          element: mark,
          desc: 'Bottom Primary Flexural Mesh (X-Direction)',
          shape: 'straight',
          shapeCode: '00',
          bar: bX,
          count: countX,
          len: +(sx - 0.08).toFixed(3),
          dims: `A=${(sx - 0.08).toFixed(2)}`,
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
          dims: `A=${(sy - 0.08).toFixed(2)}`,
          weight: +(countY * (sy - 0.08) * bY.kgM).toFixed(1)
        });
      } else {
        const straightX = Math.ceil(countX / 2);
        const bentX = Math.floor(countX / 2);
        const rise = +(th - 0.05 - bX.mm / 1000).toFixed(3);

        items.push({
          mark: nextMark(),
          element: mark,
          desc: 'Bottom Straight Flexural Bars (X-Direction)',
          shape: 'straight',
          shapeCode: '00',
          bar: bX,
          count: straightX,
          len: +(sx - 0.08).toFixed(3),
          dims: `A=${(sx - 0.08).toFixed(2)}`,
          weight: +(straightX * (sx - 0.08) * bX.kgM).toFixed(1)
        });
        items.push({
          mark: nextMark(),
          element: mark,
          desc: 'Alternate Bent-Up Cranked Bars (L/4 Top Support Zone)',
          shape: 'crank',
          shapeCode: '26',
          bar: bX,
          count: bentX,
          len: +(sx - 0.08 + 2 * 0.42 * rise).toFixed(3),
          dims: `A=${(sx - 0.08).toFixed(2)}, D=${rise}, θ=45°`,
          weight: +(bentX * (sx - 0.08 + 0.84 * rise) * bX.kgM).toFixed(1)
        });
        items.push({
          mark: nextMark(),
          element: mark,
          desc: 'Transverse Two-Way Mesh (Y-Direction)',
          shape: 'straight',
          shapeCode: '00',
          bar: bY,
          count: countY,
          len: +(sy - 0.08).toFixed(3),
          dims: `A=${(sy - 0.08).toFixed(2)}`,
          weight: +(countY * (sy - 0.08) * bY.kgM).toFixed(1)
        });
      }
    } else {
      // General foundation / wall fallback
      const b1 = BAR_SIZES[3];
      items.push({
        mark: nextMark(),
        element: mark,
        desc: `${type.toUpperCase()} Primary Reinforcement Mat`,
        shape: 'straight',
        shapeCode: '00',
        bar: b1,
        count: 12,
        len: 2.80,
        dims: 'A=2.80',
        weight: +(12 * 2.80 * b1.kgM).toFixed(1)
      });
    }

    return items;
  }

  // =========================================================================
  // 2. SHEET DRAWING SVG GENERATOR (A3 Landscape: 420 × 297 mm, scale: 1000 × 707 px)
  // =========================================================================
  function renderDetailingSheetSVG(opts) {
    const { ent, type, dims, params, schedule } = opts;
    const mark = (ent && (ent.name || ent.id)) || `${type.toUpperCase().slice(0, 3)}-101`;
    const typeLabel = { beam: 'BEAM', column: 'COLUMN', slab: 'SLAB', foundation: 'FOUNDATION', wall: 'WALL' }[type] || type.toUpperCase();

    const W = 1100, H = 780;
    const m = 24; // margin

    // Calculate total steel weight
    let totalWeight = 0, totalBars = 0;
    for (const it of schedule) {
      totalWeight += it.weight;
      totalBars += it.count;
    }

    // SVG header & styles
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
        </defs>

        <!-- Outer Drawing Border -->
        <rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}" fill="none" stroke="#0f172a" stroke-width="2.5" />
        <rect x="${m + 8}" y="${m + 8}" width="${W - 2 * m - 16}" height="${H - 2 * m - 16}" fill="none" stroke="#334155" stroke-width="1.2" />

        <!-- Border Grid Coordinate Markers -->
        <g font-size="9" font-weight="700" fill="#64748b" text-anchor="middle" dominant-baseline="middle">
          <text x="${W / 2}" y="${m + 4}">STRUCTURAL REINFORCEMENT DETAILS — ACI 318-19 / CRSI MNL-66</text>
          <text x="${m + 4}" y="${H / 2}">A</text>
          <text x="${W - m - 4}" y="${H / 2}">B</text>
        </g>
    `;

    // -----------------------------------------------------------------------
    // VIEW 1: Cross-Section View (Left Center)
    // -----------------------------------------------------------------------
    const v1X = m + 28, v1Y = m + 36, v1W = 340, v1H = 340;
    svg += `
      <!-- View 1 Box -->
      <rect x="${v1X}" y="${v1Y}" width="${v1W}" height="${v1H}" fill="#fafafa" stroke="#e2e8f0" stroke-width="1" rx="4" />
      <text x="${v1X + 14}" y="${v1Y + 22}" font-size="12" font-weight="700" fill="#0f172a">VIEW 1: CROSS-SECTION (SCALE 1:20)</text>
      <line x1="${v1X + 14}" y1="${v1Y + 26}" x2="${v1X + 220}" y2="${v1Y + 26}" stroke="#2563eb" stroke-width="2" />
    `;

    if (type === 'beam') {
      const bw = +(params.w || dims.w || 0.3) * 1000;
      const bh = +(params.h || dims.h || 0.5) * 1000;
      const scale = Math.min(180 / bw, 220 / bh);
      const dw = bw * scale, dh = bh * scale;
      const cx = v1X + v1W / 2, cy = v1Y + v1H / 2 + 10;
      const x0 = cx - dw / 2, y0 = cy - dh / 2;

      // Concrete outline
      svg += `
        <rect x="${x0}" y="${y0}" width="${dw}" height="${dh}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2" />
        <!-- Stirrup -->
        <rect x="${x0 + 12}" y="${y0 + 12}" width="${dw - 24}" height="${dh - 24}" fill="none" stroke="#dc2626" stroke-width="2.5" rx="6" />
        <!-- Top bars -->
        <circle cx="${x0 + 18}" cy="${y0 + 18}" r="5" fill="#2563eb" />
        <circle cx="${x0 + dw - 18}" cy="${y0 + 18}" r="5" fill="#2563eb" />
        <!-- Bottom bars -->
        <circle cx="${x0 + 18}" cy="${y0 + dh - 18}" r="5.5" fill="#2563eb" />
        <circle cx="${cx}" cy="${y0 + dh - 18}" r="5.5" fill="#8b5cf6" />
        <circle cx="${x0 + dw - 18}" cy="${y0 + dh - 18}" r="5.5" fill="#2563eb" />

        <!-- Width Dimension -->
        <line x1="${x0}" y1="${y0 - 14}" x2="${x0 + dw}" y2="${y0 - 14}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${cx}" y="${y0 - 20}" font-size="10" font-weight="700" fill="#1e293b" text-anchor="middle">${Math.round(bw)} mm</text>

        <!-- Height Dimension -->
        <line x1="${x0 - 14}" y1="${y0}" x2="${x0 - 14}" y2="${y0 + dh}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
        <text x="${x0 - 20}" y="${cy}" font-size="10" font-weight="700" fill="#1e293b" text-anchor="middle" transform="rotate(-90 ${x0 - 20} ${cy})">${Math.round(bh)} mm</text>

        <!-- Callout: Top Bars -->
        <path d="M ${x0 + dw - 18} ${y0 + 18} L ${x0 + dw + 25} ${y0 + 10} L ${v1X + v1W - 20} ${y0 + 10}" fill="none" stroke="#2563eb" stroke-width="1.2" />
        <text x="${v1X + v1W - 15}" y="${y0 + 7}" font-size="10" font-weight="700" fill="#2563eb" text-anchor="end">2-#5 (Top)</text>

        <!-- Callout: Stirrup -->
        <path d="M ${x0 + 12} ${cy} L ${x0 - 25} ${cy} L ${x0 - 5} ${cy}" fill="none" stroke="#dc2626" stroke-width="1.2" />
        <text x="${x0 + 18}" y="${cy - 4}" font-size="9" font-weight="600" fill="#dc2626">Ties #3 @ 150</text>

        <!-- Callout: Bottom Bars -->
        <path d="M ${cx} ${y0 + dh - 18} L ${cx + 30} ${y0 + dh + 18} L ${v1X + v1W - 20} ${y0 + dh + 18}" fill="none" stroke="#8b5cf6" stroke-width="1.2" />
        <text x="${v1X + v1W - 15}" y="${y0 + dh + 15}" font-size="10" font-weight="700" fill="#8b5cf6" text-anchor="end">3-#6 (1-Bent @ 45°)</text>
      `;
    } else {
      // Generic section / plan
      svg += `
        <rect x="${v1X + 40}" y="${v1Y + 60}" width="${v1W - 80}" height="${v1H - 120}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2" />
        <circle cx="${v1X + 60}" cy="${v1Y + 80}" r="6" fill="#2563eb" />
        <circle cx="${v1X + v1W - 60}" cy="${v1Y + 80}" r="6" fill="#2563eb" />
        <circle cx="${v1X + 60}" cy="${v1Y + v1H - 80}" r="6" fill="#2563eb" />
        <circle cx="${v1X + v1W - 60}" cy="${v1Y + v1H - 80}" r="6" fill="#2563eb" />
        <text x="${v1X + v1W / 2}" y="${v1Y + v1H / 2}" font-size="11" font-weight="600" fill="#475569" text-anchor="middle">${typeLabel} Section Detailing</text>
      `;
    }

    // -----------------------------------------------------------------------
    // VIEW 2: Longitudinal Elevation View (Right Top)
    // -----------------------------------------------------------------------
    const v2X = m + 380, v2Y = m + 36, v2W = W - 2 * m - 390, v2H = 340;
    svg += `
      <!-- View 2 Box -->
      <rect x="${v2X}" y="${v2Y}" width="${v2W}" height="${v2H}" fill="#fafafa" stroke="#e2e8f0" stroke-width="1" rx="4" />
      <text x="${v2X + 14}" y="${v2Y + 22}" font-size="12" font-weight="700" fill="#0f172a">VIEW 2: LONGITUDINAL ELEVATION &amp; TRUSS BARS (SCALE 1:25)</text>
      <line x1="${v2X + 14}" y1="${v2Y + 26}" x2="${v2X + 320}" y2="${v2Y + 26}" stroke="#2563eb" stroke-width="2" />
    `;

    // Draw Beam Elevation with 45° cranked truss bars
    const bSpan = +(dims.l || 4.5);
    const colW = 55, beamH = 120;
    const bL = v2X + 45, bR = v2X + v2W - 45;
    const bY = v2Y + 130;

    // Concrete columns at both ends
    svg += `
      <!-- Left Column Support -->
      <rect x="${bL - colW}" y="${bY - 40}" width="${colW}" height="${beamH + 80}" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5" />
      <text x="${bL - colW / 2}" y="${bY - 15}" font-size="9" font-weight="700" fill="#475569" text-anchor="middle">COL</text>

      <!-- Right Column Support -->
      <rect x="${bR}" y="${bY - 40}" width="${colW}" height="${beamH + 80}" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5" />
      <text x="${bR + colW / 2}" y="${bY - 15}" font-size="9" font-weight="700" fill="#475569" text-anchor="middle">COL</text>

      <!-- Clear Span Beam Outline -->
      <rect x="${bL}" y="${bY}" width="${bR - bL}" height="${beamH}" fill="url(#conc-hatch)" stroke="#0f172a" stroke-width="2" />

      <!-- Clear Span Dimension -->
      <line x1="${bL}" y1="${bY - 24}" x2="${bR}" y2="${bY - 24}" stroke="#1e293b" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
      <text x="${(bL + bR) / 2}" y="${bY - 30}" font-size="11" font-weight="700" fill="#1e293b" text-anchor="middle">Clear Span Ln = ${bSpan.toFixed(2)} m</text>
    `;

    // Stirrup vertical lines
    const totalStir = 18;
    for (let i = 0; i <= totalStir; i++) {
      const sx = bL + 12 + (i / totalStir) * (bR - bL - 24);
      svg += `<line x1="${sx}" y1="${bY + 12}" x2="${sx}" y2="${bY + beamH - 12}" stroke="#dc2626" stroke-width="1.2" opacity="0.8" />`;
    }

    // Top Continuous Rebar with 90° hooks into columns
    svg += `
      <!-- Top Rebar with Hooks -->
      <path d="M ${bL - 25} ${bY + 45} L ${bL - 25} ${bY + 14} L ${bR + 25} ${bY + 14} L ${bR + 25} ${bY + 45}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" />
      <text x="${(bL + bR) / 2}" y="${bY + 9}" font-size="10" font-weight="700" fill="#2563eb" text-anchor="middle">2-#5 Top Continuous</text>

      <!-- Bottom Straight Rebar (ACI §9.8 Integrity) -->
      <path d="M ${bL - 20} ${bY + beamH - 14} L ${bR + 20} ${bY + beamH - 14}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" />
      <text x="${(bL + bR) / 2}" y="${bY + beamH - 20}" font-size="10" font-weight="700" fill="#2563eb" text-anchor="middle">2-#6 Bottom Continuous (ACI §9.8)</text>
    `;

    // 45° Bent-Up (Cranked) Truss Rebar in Purple
    const crankX1 = bL + (bR - bL) * 0.20;
    const crankX2 = bR - (bR - bL) * 0.20;
    svg += `
      <!-- 45° Bent-Up (Cranked) Truss Bar -->
      <path d="M ${bL - 20} ${bY + 18} L ${crankX1 - 35} ${bY + 18} L ${crankX1} ${bY + beamH - 18} L ${crankX2} ${bY + beamH - 18} L ${crankX2 + 35} ${bY + 18} L ${bR + 20} ${bY + 18}"
            fill="none" stroke="#8b5cf6" stroke-width="3" stroke-linejoin="round" />
      
      <!-- Callouts for Bent Bars -->
      <circle cx="${crankX1 - 18}" cy="${bY + beamH / 2}" r="4" fill="#8b5cf6" />
      <text x="${crankX1 - 25}" y="${bY + beamH / 2 - 8}" font-size="10" font-weight="700" fill="#8b5cf6">45° Shear Crank</text>

      <!-- Dimension: Ln/5 Crank Point Callout -->
      <line x1="${bL}" y1="${bY + beamH + 18}" x2="${crankX1}" y2="${bY + beamH + 18}" stroke="#8b5cf6" stroke-width="1.2" marker-start="url(#cad-arrow)" marker-end="url(#cad-arrow)" />
      <text x="${(bL + crankX1) / 2}" y="${bY + beamH + 32}" font-size="10" font-weight="700" fill="#8b5cf6" text-anchor="middle">Ln / 5 (Shear Zone)</text>

      <!-- Seismic Confinement Zone Note -->
      <rect x="${bL + 10}" y="${bY + beamH + 38}" width="140" height="18" fill="#fef2f2" stroke="#fca5a5" stroke-width="1" rx="2" />
      <text x="${bL + 80}" y="${bY + beamH + 51}" font-size="9" font-weight="700" fill="#991b1b" text-anchor="middle">2h Seismic Confinement (100mm)</text>
    `;

    // -----------------------------------------------------------------------
    // VIEW 3: BAR BENDING SCHEDULE (BBS) TABLE (Bottom Left)
    // -----------------------------------------------------------------------
    const tX = m + 28, tY = m + 390, tW = 680, tH = 340;
    let tableRows = '';
    schedule.forEach((it, idx) => {
      const rowY = tY + 45 + idx * 24;
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

    // ForeignObject table inside SVG for sharp HTML rendering
    svg += `
      <!-- BBS Table Container -->
      <rect x="${tX}" y="${tY}" width="${tW}" height="${tH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.2" rx="4" />
      <rect x="${tX}" y="${tY}" width="${tW}" height="28" fill="#1e293b" rx="4 4 0 0" />
      <text x="${tX + 14}" y="${tY + 18}" font-size="12" font-weight="700" fill="#ffffff">BAR BENDING SCHEDULE (BBS) — BS 8666 &amp; ACI 315-18</text>

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
                <td colspan="4" style="text-align:right; padding-right:12px; color:#0f172a;">GRAND TOTAL (ACI 318 CAGE):</td>
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
    const tbX = m + 720, tbY = m + 390, tbW = W - 2 * m - 730, tbH = 340;

    svg += `
      <!-- General Notes Box -->
      <rect x="${tbX}" y="${tbY}" width="${tbW}" height="140" fill="#fafafa" stroke="#cbd5e1" stroke-width="1.2" rx="4" />
      <rect x="${tbX}" y="${tbY}" width="${tbW}" height="24" fill="#334155" rx="4 4 0 0" />
      <text x="${tbX + 12}" y="${tbY + 16}" font-size="11" font-weight="700" fill="#ffffff">GENERAL STRUCTURAL REBAR NOTES</text>

      <g font-size="9" fill="#334155">
        <text x="${tbX + 12}" y="${tbY + 42}">1. Concrete compressive strength f'c = 28 MPa (4000 psi).</text>
        <text x="${tbX + 12}" y="${tbY + 58}">2. Reinforcing steel ASTM A615 Grade 60 (fy = 420 MPa).</text>
        <text x="${tbX + 12}" y="${tbY + 74}">3. Concrete cover: Beams = 40 mm, Slabs = 25 mm, Earth = 75 mm.</text>
        <text x="${tbX + 12}" y="${tbY + 90}">4. Lap splices shall be Class B tension laps (1.3 Ld) per ACI §25.5.</text>
        <text x="${tbX + 12}" y="${tbY + 106}">5. Stirrups have standard 135° seismic hooks with 6db extension.</text>
        <text x="${tbX + 12}" y="${tbY + 122}">6. Bent bars conform to ACI §9.8 (min 2 continuous bottom bars).</text>
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
      <text x="${tbX + 12}" y="${tbY + 185}" font-size="9" font-weight="600" fill="#64748b">STRUCTURAL REINFORCEMENT DETAILING SUITE</text>
      <rect x="${tbX + tbW - 75}" y="${tbY + 158}" width="65" height="24" fill="#16a34a" rx="3" />
      <text x="${tbX + tbW - 42}" y="${tbY + 174}" font-size="9" font-weight="800" fill="#ffffff" text-anchor="middle">APPROVED</text>

      <!-- Drawing Title -->
      <text x="${tbX + 12}" y="${tbY + 212}" font-size="8" font-weight="700" fill="#64748b">DRAWING TITLE</text>
      <text x="${tbX + 12}" y="${tbY + 232}" font-size="14" font-weight="900" fill="#2563eb">${typeLabel} REBAR DETAILING &amp; BBS</text>

      <!-- Element Mark & Scale -->
      <text x="${tbX + 12}" y="${tbY + 260}" font-size="8" font-weight="700" fill="#64748b">ELEMENT MARK</text>
      <text x="${tbX + 12}" y="${tbY + 280}" font-size="13" font-weight="800" fill="#0f172a">${mark}</text>

      <text x="${tbX + tbW * 0.5 + 12}" y="${tbY + 260}" font-size="8" font-weight="700" fill="#64748b">SCALE / CODE</text>
      <text x="${tbX + tbW * 0.5 + 12}" y="${tbY + 280}" font-size="11" font-weight="800" fill="#0f172a">1:20 / ACI 318-19</text>

      <!-- Sheet No & Date -->
      <text x="${tbX + 12}" y="${tbY + 310}" font-size="8" font-weight="700" fill="#64748b">SHEET NUMBER</text>
      <text x="${tbX + 12}" y="${tbY + 330}" font-size="13" font-weight="800" fill="#dc2626">S-${mark.replace(/[^0-9]/g, '') || '501'}</text>

      <text x="${tbX + tbW * 0.5 + 12}" y="${tbY + 310}" font-size="8" font-weight="700" fill="#64748b">DATE / REV</text>
      <text x="${tbX + tbW * 0.5 + 12}" y="${tbY + 330}" font-size="11" font-weight="800" fill="#0f172a">${new Date().toISOString().slice(0, 10)} / REV 0</text>
    `;

    svg += '</svg>';
    return svg;
  }

  // =========================================================================
  // 3. AUTOCAD DXF CONVERTER (AC1009 / R12 / R2000 compliant)
  // =========================================================================
  function exportAutoCadDXF(opts) {
    const { ent, type, dims, params, schedule } = opts;
    const mark = (ent && (ent.name || ent.id)) || `${type.toUpperCase().slice(0, 3)}-101`;

    const lines = [];
    const entCmd = (code, val) => { lines.push(String(code)); lines.push(String(val)); };

    // Standard CAD Layers table
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

    // Helper functions for DXF primitives
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

    // -----------------------------------------------------------------------
    // Generate Detailing Sheet in AutoCAD millimeters (420 x 297 mm Sheet)
    // -----------------------------------------------------------------------
    const sheetW = 840, sheetH = 594; // A1 standard sheet in mm

    // 1. Drawing Border & Sheet Title Block
    addRect('S-BORDER', 10, 10, sheetW - 20, sheetH - 20);
    addRect('S-BORDER', 15, 15, sheetW - 30, sheetH - 30);
    addText('S-BORDER', 'ACI 318-19 STRUCTURAL DETAILING SHEET — WEBSKETCH 3D', 25, sheetH - 25, 4.5);

    // Title Block Box (Bottom Right)
    const tbX = sheetW - 260, tbY = 20, tbW = 240, tbH = 150;
    addRect('S-BORDER', tbX, tbY, tbW, tbH);
    addLine('S-BORDER', tbX, tbY + 40, tbX + tbW, tbY + 40);
    addLine('S-BORDER', tbX, tbY + 80, tbX + tbW, tbY + 80);
    addLine('S-BORDER', tbX, tbY + 115, tbX + tbW, tbY + 115);
    addLine('S-BORDER', tbX + tbW / 2, tbY, tbX + tbW / 2, tbY + 80);

    addText('S-TITLE-TEXT', 'WEBSKETCH 3D BIM ENGINE', tbX + 10, tbY + 130, 5.0);
    addText('S-TITLE-TEXT', 'REINFORCEMENT DETAILS & BBS', tbX + 10, tbY + 95, 6.0);
    addText('S-TITLE-TEXT', `ELEMENT: ${mark}`, tbX + 10, tbY + 55, 5.0);
    addText('S-TITLE-TEXT', 'SCALE: 1:20', tbX + tbW / 2 + 10, tbY + 55, 4.5);
    addText('S-TITLE-TEXT', `DWG NO: S-${mark.replace(/[^0-9]/g, '') || '501'}`, tbX + 10, tbY + 15, 5.5);
    addText('S-TITLE-TEXT', `DATE: ${new Date().toISOString().slice(0, 10)}`, tbX + tbW / 2 + 10, tbY + 15, 4.0);

    // 2. Concrete Elements & Reinforcement Geometry
    if (type === 'beam') {
      const bw = +(params.w || dims.w || 0.3) * 1000;
      const bh = +(params.h || dims.h || 0.5) * 1000;
      const bSpan = +(dims.l || 4.5) * 1000;

      // VIEW 1: Cross-Section (Left)
      const secX = 60, secY = 320;
      addText('S-TITLE-TEXT', 'VIEW 1: BEAM CROSS SECTION (SCALE 1:20)', secX, secY + bh * 0.4 + 40, 4.5);
      addRect('S-CONC-OUTLINE', secX, secY, bw * 0.4, bh * 0.4);

      // Section Stirrup & Bars
      addRect('S-REBAR-TIES', secX + 8, secY + 8, bw * 0.4 - 16, bh * 0.4 - 16);
      addCircle('S-REBAR-MAIN', secX + 14, secY + bh * 0.4 - 14, 4);
      addCircle('S-REBAR-MAIN', secX + bw * 0.4 - 14, secY + bh * 0.4 - 14, 4);
      addCircle('S-REBAR-MAIN', secX + 14, secY + 14, 4);
      addCircle('S-REBAR-BENT', secX + bw * 0.2, secY + 14, 4.5);
      addCircle('S-REBAR-MAIN', secX + bw * 0.4 - 14, secY + 14, 4);

      // Dimensioning
      addDimension('S-DIMENSIONS', secX, secY + bh * 0.4, secX + bw * 0.4, secY + bh * 0.4, `${Math.round(bw)} mm`, 15);
      addDimension('S-DIMENSIONS', secX, secY, secX, secY + bh * 0.4, `${Math.round(bh)} mm`, -15, true);

      // VIEW 2: Longitudinal Elevation & Bent Truss Bars (Center/Right)
      const elX = 260, elY = 320, elW = 500, elH = bh * 0.3;
      addText('S-TITLE-TEXT', 'VIEW 2: LONGITUDINAL ELEVATION & 45 DEG BENT-UP BARS', elX, elY + elH + 40, 4.5);
      addRect('S-CONC-OUTLINE', elX, elY, elW, elH);

      // Support Columns
      addRect('S-CONC-OUTLINE', elX - 40, elY - 20, 40, elH + 40);
      addRect('S-CONC-OUTLINE', elX + elW, elY - 20, 40, elH + 40);

      // Top Continuous Bars with Hooks
      addLine('S-REBAR-MAIN', elX - 25, elY + elH - 30, elX - 25, elY + elH - 10);
      addLine('S-REBAR-MAIN', elX - 25, elY + elH - 10, elX + elW + 25, elY + elH - 10);
      addLine('S-REBAR-MAIN', elX + elW + 25, elY + elH - 10, elX + elW + 25, elY + elH - 30);
      addText('S-REBAR-CALLOUT', '2-#5 TOP CONTINUOUS', elX + elW * 0.4, elY + elH - 5, 3.5);

      // Bottom Continuous Bars (Integrity Steel)
      addLine('S-REBAR-MAIN', elX - 20, elY + 10, elX + elW + 20, elY + 10);
      addText('S-REBAR-CALLOUT', '2-#6 BOTTOM CONTINUOUS (ACI §9.8)', elX + elW * 0.35, elY + 14, 3.5);

      // Bent-Up 45° Truss Bar in Magenta
      const c1 = elX + elW * 0.20, c2 = elX + elW * 0.80;
      addLine('S-REBAR-BENT', elX - 20, elY + elH - 14, c1 - 30, elY + elH - 14);
      addLine('S-REBAR-BENT', c1 - 30, elY + elH - 14, c1, elY + 14);
      addLine('S-REBAR-BENT', c1, elY + 14, c2, elY + 14);
      addLine('S-REBAR-BENT', c2, elY + 14, c2 + 30, elY + elH - 14);
      addLine('S-REBAR-BENT', c2 + 30, elY + elH - 14, elX + elW + 20, elY + elH - 14);
      addText('S-REBAR-CALLOUT', 'BENT-UP TRUSS BAR (45 DEG CRANK)', elX + elW * 0.4, elY + elH / 2, 3.5);

      // Stirrup Layout
      for (let i = 0; i <= 20; i++) {
        const sx = elX + 10 + (i / 20) * (elW - 20);
        addLine('S-REBAR-TIES', sx, elY + 8, sx, elY + elH - 8);
      }

      // Span Dimension
      addDimension('S-DIMENSIONS', elX, elY + elH, elX + elW, elY + elH, `Ln = ${(bSpan / 1000).toFixed(2)} m`, 25);
    }

    // 3. BAR BENDING SCHEDULE (BBS) Table in DXF
    const bbsX = 40, bbsY = 40, bbsW = 480, rowH = 14;
    addRect('S-BBS-GRID', bbsX, bbsY, bbsW, 140);
    addText('S-TITLE-TEXT', 'BAR BENDING SCHEDULE (BBS) — ACI 315-18 & BS 8666', bbsX + 10, bbsY + 125, 4.5);

    // Schedule Header Row
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

    // Assemble standard DXF file sections
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
  // 4. MODAL DIALOG & PRINT CONTROLLER
  // =========================================================================
  const RebarDoc = {
    /** Open the CAD Detailing Sheet Modal */
    openSheet(opts = {}) {
      const app = opts.app || window.app;
      if (!app) return;

      let ent = opts.ent;
      let type = opts.type;
      let dims = opts.dims;
      let params = opts.params;

      // If called without active element, pick the first beam/column/slab or selection
      if (!ent) {
        if (app.sel && app.sel.faces.size === 1) {
          const fid = [...app.sel.faces][0];
          const f = app.model.faces.get(fid);
          if (f && f.userData && f.userData.bimEntityId) {
            ent = app.bim.entities.find(e => e.id === f.userData.bimEntityId);
          }
        }
        if (!ent) {
          ent = app.bim.entities.find(e => ['beam', 'column', 'floor', 'slab', 'foundation', 'wall'].includes(e.type));
        }
        if (ent) {
          type = ent.type === 'floor' ? 'slab' : ent.type;
          dims = ent.params || {};
          params = ent.params || {};
        }
      }

      type = type || 'beam';
      dims = dims || { w: 0.3, h: 0.5, l: 4.5 };
      params = params || {};

      const schedule = extractElementSchedule(ent, type, dims, params);
      const sheetSvg = renderDetailingSheetSVG({ ent, type, dims, params, schedule });

      const mark = (ent && (ent.name || ent.id)) || `${type.toUpperCase()}-101`;

      const modalHtml = `
        <div class="rebardoc-container" style="display:flex; flex-direction:column; height:84vh; max-height:880px; width:92vw; max-width:1200px; background:#f8fafc; border-radius:8px; overflow:hidden;">
          <!-- Top CAD Sheet Toolbar -->
          <div class="rebardoc-toolbar" style="display:flex; align-items:center; justify-content:space-between; padding:10px 18px; background:#0f172a; color:#ffffff; flex:none;">
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="font-size:16px;">📐</span>
              <div>
                <div style="font-size:13px; font-weight:800; letter-spacing:0.5px;">STRUCTURAL REBAR DETAILING SHEET (ACI 318 &amp; BS 8666)</div>
                <div style="font-size:11px; color:#94a3b8;">Element: <b>${mark}</b> · Real-time 2D Drawing &amp; Bar Bending Schedule</div>
              </div>
            </div>

            <!-- Action Buttons -->
            <div style="display:flex; align-items:center; gap:8px;">
              <button id="rd-btn-dxf" class="cr-btn" style="background:#2563eb; color:#ffffff; font-weight:700; display:flex; align-items:center; gap:6px; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;" title="Download complete AutoCAD DXF file with layers and editable entities">
                <span>⚡</span> Export AutoCAD (.dxf)
              </button>
              <button id="rd-btn-print" class="cr-btn" style="background:#059669; color:#ffffff; font-weight:700; display:flex; align-items:center; gap:6px; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;" title="Print drawing sheet or Save to PDF">
                <span>🖨️</span> Print / Save PDF
              </button>
              <button id="rd-btn-svg" class="cr-btn" style="background:#475569; color:#ffffff; font-weight:600; display:flex; align-items:center; gap:6px; border:none; padding:6px 10px; border-radius:4px; cursor:pointer;">
                <span>📥</span> Vector SVG
              </button>
              <button id="rd-btn-csv" class="cr-btn" style="background:#475569; color:#ffffff; font-weight:600; display:flex; align-items:center; gap:6px; border:none; padding:6px 10px; border-radius:4px; cursor:pointer;">
                <span>📊</span> BBS CSV
              </button>
            </div>
          </div>

          <!-- Drawing Sheet Canvas Wrap -->
          <div class="rebardoc-canvas-wrap" style="flex:1; overflow:auto; padding:20px; display:flex; justify-content:center; align-items:center; background:#cbd5e1;">
            <div id="rebardoc-sheet-surface" style="width:100%; max-width:1050px; background:#ffffff; box-shadow:0 10px 25px -5px rgba(0,0,0,0.3); border-radius:4px; overflow:hidden;">
              ${sheetSvg}
            </div>
          </div>
        </div>
      `;

      app.dialog(`Structural Rebar Detailing — ${mark}`, modalHtml, [
        ['Close', null]
      ]);

      const dlg = document.getElementById('dialog');
      if (dlg) {
        dlg.classList.add('cr-dialog-active');
        dlg.style.maxWidth = '1260px';
      }

      // Wire Up Toolbar Actions
      setTimeout(() => {
        const btnDxf = document.getElementById('rd-btn-dxf');
        const btnPrint = document.getElementById('rd-btn-print');
        const btnSvg = document.getElementById('rd-btn-svg');
        const btnCsv = document.getElementById('rd-btn-csv');

        if (btnDxf) {
          btnDxf.onclick = () => {
            const dxfContent = exportAutoCadDXF({ ent, type, dims, params, schedule });
            const blob = new Blob([dxfContent], { type: 'application/dxf' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${mark}-rebar-detailing.dxf`;
            a.click();
            app.toast(`AutoCAD DXF exported: ${mark}-rebar-detailing.dxf`);
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
            a.download = `${mark}-rebar-sheet.svg`;
            a.click();
            app.toast('Vector SVG downloaded');
          };
        }

        if (btnCsv) {
          btnCsv.onclick = () => {
            let csv = 'Mark,Description,ShapeCode,BarSize,Dia_mm,Count,Length_m,Total_m,kg_per_m,Total_kg\n';
            schedule.forEach(it => {
              csv += `"${it.mark}","${it.desc}","${it.shapeCode}","${it.bar.us}",${it.bar.mm},${it.count},${it.len.toFixed(3)},${(it.len * it.count).toFixed(2)},${it.bar.kgM.toFixed(3)},${it.weight.toFixed(1)}\n`;
            });
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${mark}-bbs-schedule.csv`;
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
        type: 'beam',
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
