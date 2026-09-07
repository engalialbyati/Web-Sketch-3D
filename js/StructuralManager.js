'use strict';
// ---------------------------------------------------------------------------
// StructuralManager.js — structural elements & vertical datums.
//
// Pure, browser-global module (no DOM, no THREE): loadable beside
// geometry.js/model.js in the unit-test sandbox. It owns
//
//   1. Elevation rules. Vertical bounds of Columns, Beams, Slabs and
//      Foundations derive from project Levels plus instance offsets:
//        Column  Zstart = Z(baseLevel) + baseOffset
//                Zend   = Z(topLevel)  + topOffset     (Revit-style)
//        Beam    top justification (default): the beam HANGS from its
//                reference level — [Z - h, Z]; Bottom/Center also supported
//        Slab    extrudes DOWN from its level — [Z - ts, Z]
//        Foundation  isolated footing pad hangs below its level like a slab
//
//   2. Parametric beam cross-sections (Rectangular / T / L) swept along a
//      baseline through the B-Rep kernel (face + pushPull), so beams weld
//      into neighboring geometry exactly like hand-drawn solids.
//
//   3. Dynamic infill-wall clearance. A level-bounded wall queries the slabs
//      and drop beams crossing its baseline and terminates under the lowest
//      underside:
//        H_wall = (Z_top - Z_base) - t_slab - h_beam_web
//      where h_beam_web is the beam depth measured BELOW the slab soffit
//      (h - t_slab for a beam hanging from the same level), so the formula
//      and the geometric termination agree:
//        topZ = min(Z_top, slab soffits, beam bottoms).
//
//   4. Structural join priority for quantities:
//        Column (1) > Drop Beam (2) > Slab (3) > Infill Wall (4)
//      Overlap volume is credited to the higher-precedence element, so
//      takeoff never double-counts monolithic concrete. Rendering follows the
//      same precedence constructively: slabs are punched at columns, and
//      walls are extruded only up to the cleared height.
// ---------------------------------------------------------------------------
(function (root) {

  // ============================================================ 2D helpers
  // Polygons are flat arrays of {x, y} (world XY plan view).
  const Geo2D = {
    area(poly) { // shoelace, signed (CCW positive)
      let a = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    },
    absArea(poly) { return Math.abs(Geo2D.area(poly)); },
    isCCW(poly) { return Geo2D.area(poly) > 0; },
    isConvex(poly) {
      if (poly.length < 3) return false;
      let sign = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
        const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(cr) < 1e-12) continue; // collinear run
        if (sign === 0) sign = Math.sign(cr);
        else if (Math.sign(cr) !== sign) return false;
      }
      return true;
    },
    pointIn(p, poly) { // even-odd ray cast; boundary points count as outside
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if (((poly[i].y > p.y) !== (poly[j].y > p.y)) &&
          (p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x))
          inside = !inside;
      }
      return inside;
    },
    _onSeg(p, a, b, eps = 1e-9) {
      const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cr) > eps) return false;
      return p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps &&
        p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
    },
    segCrossesPoly(a, b, poly) { // proper crossing OR endpoint inside
      if (Geo2D.pointIn(a, poly) || Geo2D.pointIn(b, poly)) return true;
      for (let i = 0; i < poly.length; i++) {
        const c = poly[i], d = poly[(i + 1) % poly.length];
        const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
        if (Math.abs(den) < 1e-12) continue;
        const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
        const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
        if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return true;
        // endpoint resting on the boundary counts as touching the region
        if (Geo2D._onSeg(a, c, d) || Geo2D._onSeg(b, c, d)) return true;
      }
      return false;
    },
    // Sutherland–Hodgman: clip `subject` (any polygon) against a CONVEX
    // `clip` polygon. Returns the (possibly empty) intersection polygon.
    clipConvex(subject, clip) {
      const n = clip.length;
      const s = Geo2D.isCCW(clip) ? 1 : -1; // interior side of A->B: left when CCW
      let poly = subject;
      for (let i = 0; i < n && poly.length; i++) {
        const A = clip[i], B = clip[(i + 1) % n];
        const nx = -(B.y - A.y) * s, ny = (B.x - A.x) * s; // keep side(P) >= 0
        const side = p => (p.x - A.x) * nx + (p.y - A.y) * ny;
        const out = [];
        for (let k = 0; k < poly.length; k++) {
          const P = poly[k], Q = poly[(k + 1) % poly.length];
          const sp = side(P), sq = side(Q);
          if (sp >= 0) out.push(P);
          if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
            const t = sp / (sp - sq);
            out.push({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t });
          }
        }
        poly = out;
      }
      return poly;
    },
    // Intersection area of two footprints; holes (arrays of polys) subtract
    // from the subject side. One polygon must be convex (bands, column
    // footprints and beam profiles always are).
    overlapArea(subject, subjectHoles, clip, clipIsConvex = true) {
      if (!clipIsConvex) throw new Error('clip polygon must be convex');
      const inter = Geo2D.clipConvex(subject, clip);
      let a = Geo2D.absArea(inter);
      if (a <= 1e-12) return 0;
      for (const h of subjectHoles || []) {
        const hi = Geo2D.clipConvex(h, clip);
        a -= Geo2D.absArea(hi);
      }
      return Math.max(0, a);
    },
  };

  // ===================================================== beam cross-sections
  // Profile loops live in (u, v): u = lateral offset from the baseline
  // (positive = left of the draw direction), v = height above the beam
  // bottom. Loops are returned CCW; the sweep maps u to the baseline's left
  // normal and v to +Z, so a CCW loop extrudes toward the baseline's far
  // end (model.pushPull drives along the loop normal).
  const BeamProfiles = {
    /** Sanitize raw dimensions into a buildable section. */
    normalize(p) {
      const h = Math.max(0.05, +p.height || 0.5);
      const bw = Math.max(0.02, +p.webWidth || 0.25);
      let bf = Math.max(bw, +p.flangeWidth || bw);
      let hf = Math.min(Math.max(0.02, +p.flangeThickness || 0.15), h - 0.02);
      if (bf < bw) bf = bw;
      return {
        profile: p.profile || 'rectangular',
        height: h, webWidth: bw, flangeWidth: bf, flangeThickness: hf,
        flangeSide: p.flangeSide === 'Left' ? 'Left' : 'Right',
      };
    },
    /** Rectangular: b_w x h, 4 vertices around the vertical axis. */
    rectangular(p) {
      const { webWidth: b, height: h } = BeamProfiles.normalize(p);
      return BeamProfiles._ccw([
        { u: -b / 2, v: 0 }, { u: b / 2, v: 0 },
        { u: b / 2, v: h }, { u: -b / 2, v: h },
      ]);
    },
    /** T-beam (monolithic interior stem): centered symmetric T, 8 vertices.
     *  Top flange aligns with the slab soffit plane; the stem drops below. */
    tBeam(p) {
      const { webWidth: bw, flangeWidth: bf, flangeThickness: hf, height: h } = BeamProfiles.normalize(p);
      return BeamProfiles._ccw([
        { u: -bw / 2, v: 0 }, { u: bw / 2, v: 0 },                    // web soffit
        { u: bw / 2, v: h - hf }, { u: bf / 2, v: h - hf },            // right haunch
        { u: bf / 2, v: h }, { u: -bf / 2, v: h },                     // flange top
        { u: -bf / 2, v: h - hf }, { u: -bw / 2, v: h - hf },          // left haunch
      ]);
    },
    /** L-beam (edge / spandrel): asymmetric, 6 vertices. The web is centered
     *  on the baseline with one face flush for the facade; the flange catches
     *  the interior slab on `flangeSide` ('Right' = +u / left of draw dir). */
    lBeam(p) {
      const { webWidth: bw, flangeWidth: bf, flangeThickness: hf, height: h, flangeSide } = BeamProfiles.normalize(p);
      const s = flangeSide === 'Left' ? -1 : 1;
      const w0 = -s * bw / 2;          // web's flush (fixed) face
      const w1 = s * bw / 2;           // web's far face
      const f1 = s * (bf - bw / 2);    // flange outer edge, mirrored per side
      return BeamProfiles._ccw([
        { u: w0, v: 0 }, { u: w1, v: 0 },
        { u: w1, v: h - hf }, { u: f1, v: h - hf },
        { u: f1, v: h }, { u: w0, v: h },
      ]);
    },
    for(p) {
      const kind = (p.profile || 'rectangular').toLowerCase();
      if (kind === 't' || kind === 'tbeam') return BeamProfiles.tBeam(p);
      if (kind === 'l' || kind === 'lbeam') return BeamProfiles.lBeam(p);
      return BeamProfiles.rectangular(p);
    },
    area(p) {
      const loop = BeamProfiles.for(p);
      let a = 0;
      for (let i = 0; i < loop.length; i++) {
        const P = loop[i], Q = loop[(i + 1) % loop.length];
        a += P.u * Q.v - Q.u * P.v;
      }
      return Math.abs(a / 2);
    },
    _ccw(loop) { return Geo2D.area(loop.map(q => ({ x: q.u, y: q.v }))) >= 0 ? loop : [...loop].reverse(); },
  };

  // ===================================================== the manager
  const PRIORITY = { column: 1, foundation: 1, beam: 2, slab: 3, wall: 4 };

  class StructuralManager {
    /** getLevels / getEntities: live accessors (arrays), so the manager
     *  always sees the current model after undo / load / bindModel. */
    constructor(getLevels, getEntities) {
      this.getLevels = typeof getLevels === 'function' ? getLevels : () => getLevels || [];
      this.getEntities = typeof getEntities === 'function' ? getEntities : () => getEntities || [];
    }
    static get PRIORITY() { return PRIORITY; }
    get levels() { return this.getLevels() || []; }
    get entities() { return this.getEntities() || []; }
    /** app facade: StructuralManager.attach(app) */
    static attach(app) {
      return new StructuralManager(() => app.model.levels, () => app.model.bimEntities);
    }
    level(id) { return this.levels.find(l => l.id === id) || null; }
    levelZ(id) { const l = this.level(id); return l ? l.elevation : 0; }
    priorityOf(type) { return PRIORITY[type] != null ? PRIORITY[type] : 99; }
    static priorityOf(type) { return PRIORITY[type] != null ? PRIORITY[type] : 99; }

    // ------------------------------------------------------------ elevation
    /** Column vertical bounds from levels + instance offsets. Falls back to
     *  an unconnected height when no top level constrains the column. */
    columnBounds(p) {
      const zStart = this.levelZ(p.baseLevelId != null ? p.baseLevelId : p.baseLevel) + (+p.baseOffset || 0);
      const topId = p.topLevelId != null ? p.topLevelId : p.topConstraint;
      let zEnd;
      if (topId && topId !== 'unconnected' && this.level(topId))
        zEnd = this.levelZ(topId) + (+p.topOffset || 0);
      else
        zEnd = zStart + Math.max(0.1, +p.height || 3);
      return { zStart, zEnd, height: zEnd - zStart };
    }
    /** Beam vertical bounds. Top justification (default) hangs the beam
     *  DOWNWARD from the reference floor plane: [Z - h, Z]. */
    beamBounds(p) {
      const z = this.levelZ(p.referenceLevelId != null ? p.referenceLevelId : p.baseLevel);
      const h = Math.max(0.05, +p.height || 0.5);
      const j = p.zJustification || 'Top';
      if (j === 'Bottom') return { zBottom: z, zTop: z + h, height: h, zJustification: j };
      if (j === 'Center') return { zBottom: z - h / 2, zTop: z + h / 2, height: h, zJustification: j };
      return { zBottom: z - h, zTop: z, height: h, zJustification: 'Top' };
    }
    /** Slab: extrudes downward from its level — [Z - ts, Z]. */
    slabBounds(p) {
      const t = Math.max(0.01, +p.thickness || 0.2);
      const z = this.levelZ(p.levelId != null ? p.levelId : p.baseLevel);
      return { zBottom: z - t, zTop: z, thickness: t };
    }
    /** Isolated footing pad: hangs below its level like a slab. */
    foundationBounds(p) {
      const t = Math.max(0.05, +p.thickness || 0.5);
      const z = this.levelZ(p.baseLevel);
      return { zBottom: z - t, zTop: z, thickness: t };
    }

    // ------------------------------------------------------- plan footprints
    /** Centered band quad around A->B (plan view). */
    static bandPoly(G, A, B, width) {
      const d = G.norm(G.v(B.x - A.x, B.y - A.y, 0));
      if (G.isZero(d)) return null;
      const n = G.v(-d.y, d.x, 0);
      const w = width / 2;
      return [
        { x: A.x + n.x * w, y: A.y + n.y * w },
        { x: B.x + n.x * w, y: B.y + n.y * w },
        { x: B.x - n.x * w, y: B.y - n.y * w },
        { x: A.x - n.x * w, y: A.y - n.y * w },
      ];
    }
    /** Beam plan footprint width (flange overhangs the web). */
    beamWidth(p) {
      const n = BeamProfiles.normalize(p);
      return n.profile === 'rectangular' ? n.webWidth : n.flangeWidth;
    }
    beamBand(p) {
      if (!p || !Array.isArray(p.baseline) || p.baseline.length < 2) return null;
      const A = p.baseline[0], B = p.baseline[p.baseline.length - 1];
      return StructuralManager.bandPoly(G2(A), { x: A[0], y: A[1] }, { x: B[0], y: B[1] }, this.beamWidth(p));
    }
    wallBand(p) {
      if (!p || !Array.isArray(p.base) || p.base.length < 2) return null;
      const A = p.base, B = p.end != null ? p.end : A;
      return StructuralManager.bandPoly(G2(A), { x: A[0], y: A[1] }, { x: B[0], y: B[1] }, p.thickness || 0.2);
    }
    columnFootprint(p) {
      const c = p.base || p.center || [0, 0, 0];
      const w = (+p.width || 0.3) / 2, d = (+p.depth || 0.3) / 2;
      return [
        { x: c[0] - w, y: c[1] - d }, { x: c[0] + w, y: c[1] - d },
        { x: c[0] + w, y: c[1] + d }, { x: c[0] - w, y: c[1] + d },
      ];
    }
    /** Slab plan regions from entity params (sketch source); falls back to
     *  the entity's own B-Rep top faces (convert / legacy source). */
    slabRegions(model, ent) {
      const out = [];
      const p = ent.params || {};
      if (Array.isArray(p.regions)) {
        for (const r of p.regions) {
          out.push({
            outer: r.outer.map(q => ({ x: q[0], y: q[1] })),
            holes: (r.holes || []).map(h => h.map(q => ({ x: q[0], y: q[1] }))),
          });
        }
        return out;
      }
      if (model) {
        const b = this.slabBounds(p);
        for (const fid of ent.faces || []) {
          const f = model.faces.get(fid);
          if (!f || !f.userData || f.userData.role !== 'top') continue;
          const c = model.faceCentroid(f);
          if (!c || Math.abs(c.z - b.zTop) > 1e-3) continue;
          out.push({
            outer: model.pts(f.loop).map(q => ({ x: q.x, y: q.y })),
            holes: (f.holes || []).map(h => model.pts(h).map(q => ({ x: q.x, y: q.y }))),
          });
        }
      }
      return out;
    }

    // ----------------------------------------------- infill-wall clearance
    /** Does a structural bound hang from the wall's nominal top plane and
     *  reach into the story? (Elements at other levels don't constrain.) */
    _hangsOverhead(b, nominalTop, zBase) {
      return b.zTop >= nominalTop - 1e-3 && b.zBottom <= nominalTop - 1e-3 && b.zBottom > zBase - 1e-3;
    }
    _slabCrossesWall(model, slabEnt, wallParams) {
      const A = { x: wallParams.base[0], y: wallParams.base[1] };
      const B = wallParams.end
        ? { x: wallParams.end[0], y: wallParams.end[1] }
        : { x: A.x + 1e-3, y: A.y }; // closed footprints: tiny probe at the base
      for (const r of this.slabRegions(model, slabEnt)) {
        if (Geo2D.segCrossesPoly(A, B, r.outer)) {
          // a hole (shaft) between the wall ends means no deduction there
          const inHole = r.holes.some(h => Geo2D.pointIn(A, h) && Geo2D.pointIn(B, h));
          if (!inHole) return true;
        }
      }
      return false;
    }
    _beamCrossesWall(beamEnt, wallParams) {
      if (!beamEnt || !beamEnt.params || !Array.isArray(beamEnt.params.baseline)
        || beamEnt.params.baseline.length < 2) return false;
      const bb = this.beamBand(beamEnt.params);
      if (!bb) return false;
      const wb = this.wallBand(wallParams);
      if (!wb) return false;
      // web band (the drop below the slab) governs; the flange rides in the
      // slab band and is accounted for by the slab deduction
      const web = StructuralManager.bandPoly(G2(beamEnt.params.baseline[0]),
        { x: beamEnt.params.baseline[0][0], y: beamEnt.params.baseline[0][1] },
        { x: beamEnt.params.baseline[1][0], y: beamEnt.params.baseline[1][1] },
        BeamProfiles.normalize(beamEnt.params).webWidth);
      if (!web) return false;
      for (let i = 0; i < web.length; i++) {
        if (Geo2D.segCrossesPoly(web[i], web[(i + 1) % web.length], wb)) return true;
      }
      return Geo2D.pointIn(wb[0], web) || Geo2D.pointIn(web[0], wb);
    }
    /** Clear height of a level-bounded infill wall under overhead structure.
     *  Returns { topZ, clearHeight, storyHeight, slabDeduction, beamDeduction,
     *  deductions:[{kind, entId, ...}] } — H = story − t_slab − h_beam_web. */
    // PLAN TRIMS — the owner's rule: wall ends at the FACE of any column or
    // beam standing in its path. For each crossing intruder the wall's span
    // retreats to the intruder's face along the run direction (plus the
    // 1 mm reveal that keeps faces off shared planes). Returns null when the
    // baseline crosses nothing (the common case — cheap early-out).
    wallPlanTrims(wallParams) {
      const p = wallParams;
      if (!p.base || !p.end) return null;
      const ax = p.base[0], ay = p.base[1], bx = p.end[0], by = p.end[1];
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      if (L2 < 1e-9) return null;
      const L = Math.sqrt(L2), ux = dx / L, uy = dy / L;
      const half = p.thickness != null ? p.thickness / 2 + 0.02 : 0.15; // wall half-band + slop
      const REVEAL = 1e-3;
      // intruder's plan half-extent ALONG the wall run (support function of
      // its box, projected on the run direction) and the cross-run reach
      const trims = [];
      for (const ent of this.entities) {
        if (ent.id === p.id) continue;
        let cx = 0, cy = 0, hw = 0, hd = 0;
        if (ent.type === 'column' && ent.params && ent.params.base) {
          cx = ent.params.base[0]; cy = ent.params.base[1];
          hw = (ent.params.width || 0.3) / 2; hd = (ent.params.depth || 0.3) / 2;
        } else if (ent.type === 'beam' && ent.params && ent.params.baseline) {
          const bl = ent.params.baseline;
          const A2 = bl[0], B2 = bl[bl.length - 1];
          // only beams CROSSING the wall's band (near-perpendicular or T)
          const bdx = B2[0] - A2[0], bdy = B2[1] - A2[1];
          const bL = Math.hypot(bdx, bdy) || 1;
          const cross = Math.abs(ux * (bdx / bL) + uy * (bdy / bL));
          if (cross > 0.85) continue; // parallel beams don't block the run
          cx = (A2[0] + B2[0]) / 2; cy = (A2[1] + B2[1]) / 2;
          const prof = BeamProfiles.normalize(ent.params);
          hw = (prof.flangeWidth || prof.webWidth || 0.2) / 2 + (prof.flangeWidth ? 0 : 0);
          hd = (ent.params.height || 0.5) / 2; // plan depth ~ section height laid on side
          hd = Math.max(hw, 0.15); // conservative plan footprint for a crossing beam
        } else continue;
        // distance from intruder center to the wall baseline (cross-run)
        const rx = cx - ax, ry = cy - ay;
        const tAlong = rx * ux + ry * uy;
        const sCross = Math.abs(-rx * uy + ry * ux);
        // does the intruder's plan box overlap the wall band?
        const crossReach = Math.abs(ux) * hw + Math.abs(uy) * hd; // half-extent along run
        const bandReach = Math.abs(-uy) * hw + Math.abs(ux) * hd; // half-extent across run
        if (sCross > bandReach + half) continue;      // misses the band
        if (tAlong < -crossReach || tAlong > L + crossReach) continue; // beyond the span
        if (tAlong < 0.02 || tAlong > L - 0.02) continue; // at/behind the ends: endcaps handle
        // the wall must SPLIT around this intruder: record the blocked interval
        trims.push({ t0: Math.max(0, tAlong - crossReach - REVEAL), t1: Math.min(L, tAlong + crossReach + REVEAL) });
      }
      if (!trims.length) return null;
      trims.sort((x, y) => x.t0 - y.t0);
      // merge overlapping intervals
      const merged = [trims[0]];
      for (const t of trims.slice(1)) {
        const last = merged[merged.length - 1];
        if (t.t0 <= last.t1 + 0.01) last.t1 = Math.max(last.t1, t.t1);
        else merged.push(t);
      }
      return { intervals: merged, L };
    }
    wallClearance(wallParams, opts = {}) {
      const p = wallParams;
      const zBase = p.base ? p.base[2] : this.levelZ(p.baseLevel);
      const topId = p.topConstraint;
      const nominal = (topId && topId !== 'unconnected')
        ? this.levelZ(topId)
        : zBase + Math.max(0.05, +p.height || 0);
      const model = opts.model || null;
      const pool = opts.structure || this.entities;
      const minH = opts.minHeight != null ? opts.minHeight : 0.05;

      let topZ = nominal;
      let slabSoffit = nominal;   // lowest slab underside found
      let beamBottom = nominal;   // lowest beam underside found
      const deductions = [];
      for (const ent of pool) {
        if (!ent || ent.id === p.id) continue;
        if (ent.type === 'slab') {
          const b = this.slabBounds(ent.params);
          if (!this._hangsOverhead(b, nominal, zBase)) continue;
          if (!this._slabCrossesWall(model, ent, p)) continue;
          if (b.zBottom < slabSoffit - 1e-9) {
            slabSoffit = b.zBottom;
            deductions.push({ kind: 'slab', entId: ent.id, thickness: b.thickness, soffit: b.zBottom });
          }
        } else if (ent.type === 'beam') {
          const b = this.beamBounds(ent.params);
          if (!this._hangsOverhead(b, nominal, zBase)) continue;
          if (!this._beamCrossesWall(ent, p)) continue;
          if (b.zBottom < beamBottom - 1e-9) {
            beamBottom = b.zBottom;
            deductions.push({ kind: 'beam', entId: ent.id, depth: b.height, bottom: b.zBottom });
          }
        }
      }
      topZ = Math.min(nominal, slabSoffit, beamBottom);
      if (topZ < zBase + minH) topZ = zBase + minH;
      const tSlab = Math.max(0, nominal - slabSoffit);
      const hWeb = Math.max(0, slabSoffit - beamBottom);
      return {
        topZ,
        nominalTopZ: nominal,
        storyHeight: nominal - zBase,
        clearHeight: topZ - zBase,
        slabDeduction: tSlab,
        beamDeduction: hWeb,
        deductions,
        // the reference formula, verifiable independently of the min(): the
        // beam web is measured below the slab soffit
        formulaHeight: (nominal - zBase) - tSlab - hWeb,
      };
    }

    // ---------------------------------------------------------- B-Rep builds
    /** Map a profile (u, v) loop to world points on the vertical section
     *  plane through `at`, for a baseline A -> B (used for caps, preview,
     *  and the swept solid). */
    profileWorld(G, p, at) {
      const A = p.baseline[0], B = p.baseline[p.baseline.length - 1];
      const d = G.norm(G.v(B[0] - A[0], B[1] - A[1], 0));
      const n = G.v(-d.y, d.x, 0);
      const b = this.beamBounds(p);
      const loop = BeamProfiles.for(p);
      return loop.map(q => G.v(at[0] + n.x * q.u, at[1] + n.y * q.u, b.zBottom + q.v));
    }
    /** Sweep the parametric profile along the baseline: a section face at the
     *  start (vertical plane) pushed along the baseline through the B-Rep
     *  kernel, so the solid welds into adjacent columns / walls / slabs.
     *  Returns the created face ids. */
    buildBeam(G, model, p) {
      const A0 = p.baseline[0], B0 = p.baseline[p.baseline.length - 1];
      const d = G.norm(G.v(B0[0] - A0[0], B0[1] - A0[1], 0));
      if (G.isZero(d)) throw new Error('beam baseline is degenerate');
      // END EXTENSION (cast-in-place join): beams run centerline-to-centerline,
      // so two beams meeting at 90° only TOUCH at one point — the corner
      // quadrant stays void (the visible gap) and the touching-only junction
      // breeds degenerate split slivers (missing faces). Extend each end by
      // half the section width — the same wrap-butt overlap walls use — so
      // meeting beams OVERLAP solidly, autoIntersect welds the corner shut,
      // and the takeoff's join priority credits the overlap to the column.
      const prof0 = BeamProfiles.normalize(p);
      // BUFFER ZONE (owner's rule): extend an end ONLY into an EMPTY corner.
      // Where a column already occupies the intersection, the column IS the
      // joint filler — extending there just overlaps the column and shreds
      // both into fragments (39k faces on a full frame). Empty corner (no
      // column within 0.5 m of the endpoint): extend to weld beams solidly.
      // Revit contract: a beam ENDS AT THE COLUMN FACE — the sweep is trimmed
      // back by the column's plan half-extent along the run direction (the
      // support function of its box). No column: extend webWidth/2 to weld
      // into an empty corner. Either way the PARAMS keep the analytical
      // centerline-to-centerline baseline, so regenerating after the column
      // is deleted restores the full-length beam (it meets its neighbor).
      const ov = Math.max(prof0.webWidth || 0.2, 0.1) / 2;
      const colReach = (px, py) => {
        let best = 0;
        if (!model.bimEntities) return 0;
        for (const e of model.bimEntities) {
          if (e.type !== 'column' || !e.params || !e.params.base) continue;
          const c = e.params.base;
          if (Math.hypot(c[0] - px, c[1] - py) > 0.75) continue;
          const hw = (e.params.width || 0.3) / 2, hd = (e.params.depth || 0.3) / 2;
          // box half-extent along the run direction (support function)
          const reach = Math.abs(d.x) * hw + Math.abs(d.y) * hd;
          if (reach > best) best = reach;
        }
        return best;
      };
      const reachA = colReach(A0[0], A0[1]);
      const reachB = colReach(B0[0], B0[1]);
      const A = reachA > 0 ? [A0[0] + d.x * reachA, A0[1] + d.y * reachA, A0[2]]
        : [A0[0] - d.x * ov, A0[1] - d.y * ov, A0[2]];
      const B = reachB > 0 ? [B0[0] - d.x * reachB, B0[1] - d.y * reachB, B0[2]]
        : [B0[0] + d.x * ov, B0[1] + d.y * ov, B0[2]];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      // The sweep sits 0.5 mm below the reference plane: a slab sketched at
      // the same level (or another beam crossing) then meets NO coplanar
      // top face, so nothing z-fights and no arrangement repartitions the
      // flange. Invisible at any zoom; quantities use the exact section.
      const zDrop = 5e-4;
      const startLoop = this.profileWorld(G, p, A).map(q => G.v(q.x, q.y, q.z - zDrop));
      const before = new Set(model.faces.keys());
      const f = model.addFaceFromRings(startLoop);
      if (!f) throw new Error('beam profile face is degenerate');
      const n = G.loopNormal(model.pts(f.loop));
      const dist = (G.dot(n, d) >= 0 ? 1 : -1) * L;
      if (!model.pushPull(f, dist)) throw new Error('beam sweep failed');
      return [...model.faces.keys()].filter(id => !before.has(id)).map(id => model.faces.get(id));
    }
    /** Role-classify beam faces against the section: caps perpendicular to
     *  the baseline; sides split into flange / web by height. */
    classifyBeamRoles(G, model, faces, p) {
      const A = p.baseline[0], B = p.baseline[p.baseline.length - 1];
      const d = G.norm(G.v(B[0] - A[0], B[1] - A[1], 0));
      const b = this.beamBounds(p);
      const prof = BeamProfiles.normalize(p);
      const hf = prof.profile === 'rectangular' ? 0 : prof.flangeThickness;
      const roles = {};
      const L2 = G.dot(G.sub(G.v(B[0], B[1], B[2]), G.v(A[0], A[1], A[2])), d);
      for (const f of faces) {
        const n = G.loopNormal(model.pts(f.loop));
        if (Math.abs(G.dot(n, d)) > 0.9) {
          const c = model.faceCentroid(f);
          roles[f.id] = G.dot(G.sub(c, G.v(A[0], A[1], A[2])), d) < L2 / 2 ? 'start_cap' : 'end_cap';
        } else {
          const c = model.faceCentroid(f);
          roles[f.id] = (hf > 0 && c.z > b.zTop - hf - 1e-3) ? 'flange' : 'web';
        }
      }
      return roles;
    }
    /** Column solid from its level bounds. The sweep starts with a footprint
     *  face at the TOP plane and pushes DOWN to zStart: when a slab top lies
     *  at zEnd the kernel punches the footprint out of it and the column
     *  passes through monolithically. The pass-through leaves the column
     *  open at the top plane with internal lining walls — cap the flush top
     *  and drop the partitions so the union is one clean closed shell
     *  (Column > Slab precedence: no duplicate volume, no internal faces). */
    buildColumn(G, model, p) {
      const fam = root.ColumnFamilies && root.ColumnFamilies.get(p.family);
      if (fam) return this._buildFamilyColumn(G, model, p);
      const b = this.columnBounds(p);
      if (b.height < 0.02) throw new Error('column height below minimum');
      const c = p.base || p.center;
      const w = Math.max(0.02, +p.width || 0.3) / 2, d = Math.max(0.02, +p.depth || 0.3) / 2;
      const ring = [
        G.v(c[0] - w, c[1] - d, b.zEnd), G.v(c[0] + w, c[1] - d, b.zEnd),
        G.v(c[0] + w, c[1] + d, b.zEnd), G.v(c[0] - w, c[1] + d, b.zEnd),
      ];
      const before = new Set(model.faces.keys());
      const f = model.addFaceFromRings(ring.map(q => G.clone(q)));
      if (!f) throw new Error('column footprint is degenerate');
      const anchorIds = [...f.loop];
      if (!model.pushPull(f, b.zStart - b.zEnd)) throw new Error('column sweep failed');
      let created = [...model.faces.keys()].filter(id => !before.has(id)).map(id => model.faces.get(id));
      // did a host slab absorb the footprint as an opening?
      const hostHoled = [...model.faces.values()].some(g =>
        !created.includes(g) && (g.holes || []).some(h =>
          h.length === anchorIds.length && anchorIds.every(v => h.includes(v))));
      if (hostHoled) {
        for (const g of created) {
          if (g.id === f.id) continue;
          const n = G.loopNormal(model.pts(g.loop));
          if (Math.abs(n.z) > 0.9) continue; // horizontal faces are caps, not lining
          if (!g.loop.some(v => anchorIds.includes(v))) continue; // only the pass-through segment
          model.faces.delete(g.id);
        }
        model.gc();
        const cap = model.addFaceFromRings(ring.map(q => G.clone(q)));
        created = [...model.faces.keys()].filter(id => !before.has(id)).map(id => model.faces.get(id));
        if (cap && !created.includes(cap)) created.push(cap);
      }
      return created;
    }
    /** Family column (columnFamilies.js): the silhouette is a stack of plan
     *  rings over z bands. Segments build TOP-DOWN — each is a ring at its
     *  top plane pushed to its floor — so the topmost tier runs the same
     *  slab pass-through / lining cleanup as the plain prism (Column > Slab
     *  precedence), and lower tiers weld onto the ones above like the
     *  footing pedestal does. The stack spans [zStart, columnSolidTop]:
     *  drop-panel heads stop under a covering slab soffit instead of
     *  punching through it. */
    _buildFamilyColumn(G, model, p) {
      const b = this.columnBounds(p);
      const zTop = this.columnSolidTop(model, p);
      if (zTop - b.zStart < 0.02) throw new Error('column height below minimum');
      const spec = root.ColumnFamilies.parts(p.family, p, zTop - b.zStart);
      if (!spec || !spec.segments.length) throw new Error('column family produced no segments');
      const c = p.base || p.center;
      const ringAt = (seg, z) => seg.ring.map(q => G.v(c[0] + q.x, c[1] + q.y, b.zStart + z));
      const before = new Set(model.faces.keys());
      const segs = [...spec.segments].sort((s, t) => t.z1 - s.z1); // top-down
      const top = segs[0];
      const topRing = ringAt(top, top.z1);
      let anchorIds = [], topFaceId = null;
      for (const s of segs) {
        const f = model.addFaceFromRings(ringAt(s, s.z1).map(q => G.clone(q)));
        if (!f) throw new Error('column segment is degenerate');
        if (s === top) { anchorIds = [...f.loop]; topFaceId = f.id; }
        if (!model.pushPull(f, -(s.z1 - s.z0))) throw new Error('column sweep failed');
      }
      let created = [...model.faces.keys()].filter(id => !before.has(id)).map(id => model.faces.get(id));
      // slab pass-through: same contract as the plain prism, on the top tier
      const hostHoled = [...model.faces.values()].some(g =>
        !created.includes(g) && (g.holes || []).some(h =>
          h.length === anchorIds.length && anchorIds.every(v => h.includes(v))));
      if (hostHoled) {
        for (const g of created) {
          if (g.id === topFaceId) continue;
          const n = G.loopNormal(model.pts(g.loop));
          if (Math.abs(n.z) > 0.9) continue; // horizontal faces are caps, not lining
          if (!g.loop.some(v => anchorIds.includes(v))) continue; // only the pass-through segment
          model.faces.delete(g.id);
        }
        model.gc();
        const cap = model.addFaceFromRings(topRing.map(q => G.clone(q)));
        created = [...model.faces.keys()].filter(id => !before.has(id)).map(id => model.faces.get(id));
        if (cap && !created.includes(cap)) created.push(cap);
      }
      return created;
    }
    /** Plan ring a host slab is punched by. Plain columns: the footprint.
     *  Family columns: the family's punch ring (default the topmost tier;
     *  drop-panel columns punch with the SHAFT so the drop head embeds in
     *  the slab like real flat-slab construction). */
    columnPunch(p) {
      const CF = root.ColumnFamilies;
      if (!(CF && CF.get(p && p.family))) return this.columnFootprint(p);
      const b = this.columnBounds(p);
      const spec = CF.parts(p.family, p, b.height);
      if (!spec || !spec.punch) return this.columnFootprint(p);
      const c = p.base || p.center || [0, 0, 0];
      return spec.punch.map(q => ({ x: c[0] + q.x, y: c[1] + q.y }));
    }
    /** Isolated footing pad (plus optional pedestal) hanging below a level. */
    buildFooting(G, model, p) {
      const b = this.foundationBounds(p);
      const c = p.base || p.center;
      const w = Math.max(0.05, +p.width || 1.0) / 2, d = Math.max(0.05, +p.depth || 1.0) / 2;
      const ring = [
        G.v(c[0] - w, c[1] - d, b.zTop), G.v(c[0] + w, c[1] - d, b.zTop),
        G.v(c[0] + w, c[1] + d, b.zTop), G.v(c[0] - w, c[1] + d, b.zTop),
      ];
      const before = new Set(model.faces.keys());
      const f = model.addFaceFromRings(ring);
      if (!f) throw new Error('footing footprint is degenerate');
      if (!model.pushPull(f, -b.thickness)) throw new Error('footing sweep failed');
      const faces = [...model.faces.keys()].filter(id => !before.has(id)).map(id => model.faces.get(id));
      if (p.pedestal) {
        const pw = Math.max(0.05, +p.pedestal.width || 0.4) / 2;
        const pd = Math.max(0.05, +p.pedestal.depth || pw * 2) / 2;
        const ph = Math.max(0.05, +p.pedestal.height || 0.3);
        const ring2 = [
          G.v(c[0] - pw, c[1] - pd, b.zTop), G.v(c[0] + pw, c[1] - pd, b.zTop),
          G.v(c[0] + pw, c[1] + pd, b.zTop), G.v(c[0] - pw, c[1] + pd, b.zTop),
        ];
        const f2 = model.addFaceFromRings(ring2);
        if (f2 && model.pushPull(f2, ph)) {
          faces.push(...[...model.faces.keys()].filter(id => !before.has(id)).map(id => model.faces.get(id)));
        }
      }
      return faces;
    }

    /** Is this entity's family the flat-slab drop panel? */
    isDropPanel(p) {
      return !!(root.ColumnFamilies && root.ColumnFamilies.get(p && p.family)
        && p.family === 'drop_panel');
    }
    /** Lowest slab/floor soffit covering a drop-panel column's head. Flat-slab
     *  construction: the drop head hangs UNDER the slab, so its top follows
     *  the soffit (zTop − thickness) of any slab at the column's top level
     *  whose plan region covers the shaft. Returns the soffit z, or null when
     *  nothing covers the column (the head then reaches the level plane).
     *  `structure` may carry pending entities not yet in the registry. */
    dropPanelSoffit(model, p, structure = null) {
      if (!this.isDropPanel(p)) return null;
      const b = this.columnBounds(p);
      const c = p.base || p.center || [0, 0, 0];
      const pt = { x: c[0], y: c[1] };
      const ents = structure || this.entities;
      let z = null;
      for (const ent of ents) {
        if (ent.type !== 'slab' && ent.type !== 'floor' || !ent.params) continue;
        const sb = this.slabBounds(ent.params);
        if (Math.abs(sb.zTop - b.zEnd) > 1e-3) continue;    // not at the column's top level
        if (sb.zBottom >= b.zEnd - 1e-3) continue;          // zero-thickness — nothing to hang under
        const covers = this.slabRegions(model, ent).some(r =>
          Geo2D.pointIn(pt, r.outer) && !(r.holes || []).some(h => Geo2D.pointIn(pt, h)));
        if (!covers) continue;
        z = z == null ? sb.zBottom : Math.min(z, sb.zBottom); // lowest soffit wins
      }
      return z;
    }
    /** Effective top of a column's SOLID (world z). Drop-panel heads hang
     *  0.5 mm under a covering slab soffit (the stagger keeps panel-top and
     *  slab-bottom from coinciding — no z-fighting, mirrors the beam drop);
     *  `p.panelTopZ` overrides discovery (the re-fit path passes the target
     *  directly). Everything else spans to its level top. */
    columnSolidTop(model, p, structure = null) {
      const b = this.columnBounds(p);
      if (this.isDropPanel(p)) {
        let top = null;
        if (isFinite(+p.panelTopZ)) top = +p.panelTopZ;
        else {
          const s = this.dropPanelSoffit(model, p, structure);
          if (s != null) top = s - 5e-4;
        }
        if (top != null && top > b.zStart + 0.12) return top;
      }
      return b.zEnd;
    }

    // ------------------------------------------------ slab/column precedence
    /** Columns passing through a slab about to be built at [zTop-th, zTop]:
     *  footprints to punch as openings so slab geometry never duplicates the
     *  column volume. Only strictly-inside footprints qualify (edge cases
     *  interpenetrate and are resolved by the quantity takeoff instead). */
    columnHolesForSlab(model, slabParams, region) {
      const b = this.slabBounds(slabParams);
      const z = slabParams._planeZ != null ? slabParams._planeZ : b.zTop;
      const P2 = q => Array.isArray(q) ? { x: q[0], y: q[1] } : q; // arrays or points
      const outer = region.outer.map(P2);
      const holes2 = (region.holes || []).map(h => h.map(P2));
      const out = [];
      for (const ent of this.entities) {
        if (ent.type !== 'column' || !ent.params) continue;
        // drop-panel columns never punch: their head re-fits UNDER the new
        // slab's soffit (syncDropPanels), so slab and head never overlap
        if (this.isDropPanel(ent.params)) continue;
        const cb = this.columnBounds(ent.params);
        if (cb.zEnd <= b.zBottom + 1e-3 || cb.zStart >= b.zTop - 1e-3) continue; // no pass-through
        const fp = this.columnPunch(ent.params);
        const strictlyInside = fp.every(q => Geo2D.pointIn(q, outer)) &&
          !holes2.some(h => fp.some(q => Geo2D.pointIn(q, h)));
        if (!strictlyInside) continue;
        // overlapping a previous hole? leave that overlap to the takeoff
        if (out.some(prev => Geo2D.segCrossesPoly(fp[0], fp[1], prev.ring) ||
          Geo2D.pointIn(prev.ring[0], fp))) continue;
        out.push({
          entId: ent.id,
          ring: fp.map(q => G.v(q.x, q.y, z)),
        });
      }
      return out;
    }

    // ------------------------------------------------------- quantity takeoff
    /** Prism decomposition used by the takeoff: every structural element is
     *  vertical prisms (plan footprint x z-band), so overlap = plan
     *  intersection x z overlap. Beams split into flange + web prisms to
     *  stay exact for T / L sections. */
    prismParts(model, ent) {
      const p = ent.params || {};
      const parts = [];
      const pushPoly = (outer, holes, zBot, zTop) => {
        if (zTop - zBot > 1e-6 && outer && outer.length >= 3)
          parts.push({ outer, holes: holes || [], zBot, zTop });
      };
      switch (ent.type) {
        case 'column': {
          const b = this.columnBounds(p);
          // family columns decompose per segment (tier rings × z bands) so the
          // takeoff stays exact for tapers, drop panels and shaped plans; the
          // stack spans [zStart, columnSolidTop] — drop heads under slabs
          const spec = root.ColumnFamilies && root.ColumnFamilies.get(p.family)
            ? root.ColumnFamilies.parts(p.family, p, this.columnSolidTop(model, p) - b.zStart) : null;
          if (spec) {
            const c = p.base || p.center || [0, 0, 0];
            for (const s of spec.segments)
              pushPoly(s.ring.map(q => ({ x: c[0] + q.x, y: c[1] + q.y })),
                [], b.zStart + s.z0, b.zStart + s.z1);
          } else {
            pushPoly(this.columnFootprint(p), [], b.zStart, b.zEnd);
          }
          break;
        }
        case 'foundation': {
          const b = this.foundationBounds(p);
          pushPoly(this.columnFootprint(p), [], b.zBottom, b.zTop);
          if (p.pedestal) {
            const c = p.base || p.center;
            const pw = (+p.pedestal.width || 0.4) / 2, pd = (+p.pedestal.depth || pw * 2) / 2;
            const ph = +p.pedestal.height || 0.3;
            pushPoly([
              { x: c[0] - pw, y: c[1] - pd }, { x: c[0] + pw, y: c[1] - pd },
              { x: c[0] + pw, y: c[1] + pd }, { x: c[0] - pw, y: c[1] + pd },
            ], [], b.zTop, b.zTop + ph);
          }
          break;
        }
        case 'beam': {
          const b = this.beamBounds(p);
          const prof = BeamProfiles.normalize(p);
          const A = p.baseline[0], B = p.baseline[p.baseline.length - 1];
          const P0 = { x: A[0], y: A[1] }, P1 = { x: B[0], y: B[1] };
          if (prof.profile === 'rectangular') {
            pushPoly(StructuralManager.bandPoly(G2(A), P0, P1, prof.webWidth), [], b.zBottom, b.zTop);
          } else {
            const flange = StructuralManager.bandPoly(G2(A), P0, P1, prof.flangeWidth);
            const web = StructuralManager.bandPoly(G2(A), P0, P1, prof.webWidth);
            pushPoly(flange, [], b.zTop - prof.flangeThickness, b.zTop);
            pushPoly(web, [], b.zBottom, b.zTop - prof.flangeThickness);
          }
          break;
        }
        case 'slab': {
          const b = this.slabBounds(p);
          for (const r of this.slabRegions(model, ent))
            pushPoly(r.outer, r.holes, b.zBottom, b.zTop);
          break;
        }
        case 'wall': {
          const zBase = p.base ? p.base[2] : this.levelZ(p.baseLevel);
          const h = Math.max(0, +p.height || 0);
          if (p.closed && p.footprint) {
            // closed footprint wall: conservative solid takeoff on the ring
            pushPoly(p.footprint.map(q => ({ x: q[0], y: q[1] })), [], zBase, zBase + h);
          } else if (p.base && p.end) {
            pushPoly(this.wallBand(p), [], zBase, zBase + h);
          }
          break;
        }
        default:
          break;
      }
      return parts;
    }
    /** Gross + net volumes with join priority: overlap volume is credited to
     *  the higher-precedence element (Column > Beam > Slab > Wall), so
     *      Column(1) ≻ Drop Beam(2) ≻ Slab(3) ≻ Infill Wall(4)
     *  never double-counts monolithic concrete. */
    quantityReport(model, ents = null) {
      const list = ents || this.entities.filter(e =>
        ['column', 'beam', 'slab', 'wall', 'foundation'].includes(e.type));
      const items = list.map(ent => ({
        ent,
        priority: this.priorityOf(ent.type),
        parts: this.prismParts(model, ent),
        gross: 0, net: 0, lost: [],
      }));
      for (const it of items)
        it.gross = it.parts.reduce((s, part) =>
          s + Math.max(0, Geo2D.absArea(part.outer) - (part.holes || []).reduce((a, h) => a + Geo2D.absArea(h), 0)) * (part.zTop - part.zBot), 0);
      for (let i = 0; i < items.length; i++) {
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          const low = items[i], high = items[j];
          if (low.priority <= high.priority) continue; // only lower precedence loses
          let vol = 0;
          for (const a of low.parts) {
            for (const b of high.parts) {
              const zOv = Math.min(a.zTop, b.zTop) - Math.max(a.zBot, b.zBot);
              if (zOv <= 1e-6) continue;
              // Sutherland–Hodgman needs a convex CLIP; either side may play
              // it (bands and footprints are convex, slab regions need not)
              let area2 = 0;
              if (Geo2D.isConvex(b.outer)) area2 = Geo2D.overlapArea(a.outer, a.holes, b.outer);
              else if (Geo2D.isConvex(a.outer)) area2 = Geo2D.overlapArea(b.outer, b.holes, a.outer);
              vol += area2 * zOv;
            }
          }
          if (vol > 1e-6) {
            low.net -= vol;
            low.lost.push({ to: high.ent.id, toType: high.ent.type, volume: vol });
          }
        }
      }
      for (const it of items) it.net = Math.max(0, it.gross + it.net);
      return {
        items: items.map(it => ({
          id: it.ent.id, type: it.ent.type, gross: it.gross, net: it.net, lost: it.lost,
        })),
        byType: items.reduce((acc, it) => {
          acc[it.ent.type] = acc[it.ent.type] || { gross: 0, net: 0 };
          acc[it.ent.type].gross += it.gross;
          acc[it.ent.type].net += it.net;
          return acc;
        }, {}),
        total: items.reduce((s, it) => s + it.net, 0),
      };
    }
  }

  // tiny adapter: plain arrays -> G-style accessors used by bandPoly
  function G2(arr) { return { v: (x, y) => ({ x, y }), norm: v => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }, isZero: v => Math.hypot(v.x, v.y) < 1e-9 }; }

  StructuralManager.Geo2D = Geo2D;
  StructuralManager.BeamProfiles = BeamProfiles;
  root.StructuralManager = StructuralManager;
  root.BeamProfiles = BeamProfiles;
})(typeof window !== 'undefined' ? window : globalThis);
