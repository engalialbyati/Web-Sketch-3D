'use strict';
// ---------------------------------------------------------------------------
// ifc-export.js — IFC4 STEP writer (roadmap Phase 1.1).
//
// File ▸ Export IFC…: walks the parametric element registry (params are the
// truth, the B-Rep is cache) and emits an IFC4 Coordination View model:
//
//   levels            → IfcBuildingStorey (Project ▸ Site ▸ Building chain)
//   straight walls    → IfcWallStandardCase — plan rectangle profile,
//                       vertical extrusion (exactly the shape our own
//                       importer reverses into a centerline + thickness)
//   closed/curved     → IfcWall — footprint profile, vertical extrusion
//   doors/windows     → IfcOpeningElement voids on the host wall +
//                       (IfcRelVoidsElement/IfcRelFillsElement) thin fills
//   plain openings    → IfcOpeningElement voids, no fill
//   floors / slabs    → IfcSlab — region profile (with voids), extruded down
//   columns           → IfcColumn — rect / circle profile, vertical extrude
//   beams             → IfcBeam — BeamProfiles cross-section swept along the
//                       baseline (top justification: flange top at the base)
//   foundations       → IfcFooting (PAD_FOOTING) — rect profile, extruded down
//   roofs (flat)      → IfcSlab (ROOF) from regions
//   roofs (mono/gable),
//   stairs, handrails → B-Rep of the built solid (IfcFacetedBrep) +
//                       IfcStairFlight recipe children (risers/treads schema)
//   everything else   → IfcBuildingElementProxy + B-Rep (nothing is dropped)
//   grids             → IfcGrid + IfcGridAxis polylines (straight grids)
//
// Units are SI metres; Z is up (the IFC default); storey placements carry the
// elevation so element geometry is expressed storey-relative.
// ---------------------------------------------------------------------------
(function (root) {

  // ----------------------------------------------------------- STEP writer
  // Entities dedupe by their full text (shared points/placements/profiles
  // collapse); products always emit fresh (raw) so identical twins stay
  // distinct objects.
  const fmtArg = a => {
    if (a == null || a === '$') return '$';
    if (a === '*') return '*';
    if (typeof a === 'number') {
      if (!isFinite(a)) return '0.';
      let s = a.toFixed(6).replace(/0+$/, '');
      if (!s.includes('.')) s += '.';
      if (s === '-.' || s === '.' || s === '-0.') s = '0.';
      return s;
    }
    if (typeof a === 'string') return a.startsWith('#') ? a : "'" + String(a).replace(/'/g, "''") + "'";
    if (Array.isArray(a)) return '(' + a.map(fmtArg).join(',') + ')';
    if (a && a.enum) return '.' + a.enum + '.';
    return String(a);
  };
  function makeWriter() {
    const lines = [];
    const cache = new Map();
    let n = 0;
    const put = (type, args, dedup) => {
      const body = type + '(' + args.map(fmtArg).join(',') + ')';
      if (dedup && cache.has(body)) return cache.get(body);
      const id = '#' + (++n);
      lines.push(id + '=' + body + ';');
      if (dedup) cache.set(body, id);
      return id;
    };
    return {
      e: (type, args) => put(type, args, true),
      raw: (type, args) => put(type, args, false),
      lines,
      get count() { return n; },
    };
  }

  // IfcGloballyUniqueId: 22 chars of the IFC base64 alphabet, deterministic
  // per seed (stable across re-exports of the same element)
  const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  function guid(seed) {
    let h = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0x41c64257];
    for (let i = 0; i < seed.length; i++) {
      const c = seed.charCodeAt(i) + 1;
      h[0] = Math.imul(h[0] ^ c, 16777619) >>> 0;
      h[1] = Math.imul(h[1] + c + i, 2246822519) >>> 0;
      h[2] = Math.imul(h[2] ^ (c << 1), 3266489917) >>> 0;
      h[3] = Math.imul(h[3] + (c << 3), 668265263) >>> 0;
    }
    let out = '';
    for (let i = 0; i < 22; i++)
      out += B64[(h[i % 4] >>> ((i * 7) % 26)) & 63];
    return out;
  }

  // ------------------------------------------------------------- geometry
  function geom(w) {
    // IFC list-valued attributes (coordinates, directions, polyline points)
    // are SINGLE list attributes — [[x,y,z]], never three bare attributes
    const p3 = (x, y, z) => w.e('IFCCARTESIANPOINT', [[x, y, z]]);
    const p2 = (x, y) => w.e('IFCCARTESIANPOINT', [[x, y]]);
    const d3 = (x, y, z) => {
      const l = Math.hypot(x, y, z) || 1;
      return w.e('IFCDIRECTION', [[x / l, y / l, z / l]]);
    };
    const d2 = (x, y) => {
      const l = Math.hypot(x, y) || 1;
      return w.e('IFCDIRECTION', [[x / l, y / l]]);
    };
    const ax3 = (loc, axis, ref) => w.e('IFCAXIS2PLACEMENT3D', [loc || '$', axis || '$', ref || '$']);
    const ax2 = (loc, ref) => w.e('IFCAXIS2PLACEMENT2D', [loc || '$', ref || '$']);
    const lp = (relTo, rel) => w.e('IFCLOCALPLACEMENT', [relTo || '$', rel]);
    const poly3 = pts => w.e('IFCPOLYLINE', [pts.concat([pts[0]])]); // closed
    const poly2 = pts => w.e('IFCPOLYLINE', [pts.concat([pts[0]])]);
    return { p3, p2, d3, d2, ax3, ax2, lp, poly3, poly2 };
  }

  // -------------------------------------------------------------- exporter
  /**
   * IfcExport.fromApp(app) → { text, counts, warn }
   * text  — the full ISO-10303-21 STEP file
   * counts — per-category element counts included in the file
   * warn  — null | string (why some geometry fell back to B-Rep)
   */
  function fromApp(app) {
    const m = app.model, bim = app.bim;
    const G = root.G || window.G;
    const w = makeWriter();
    const g = geom(w);
    const counts = {};
    const bump = k => { counts[k] = (counts[k] || 0) + 1; };
    let usedBrep = false;

    // ---- header scaffold -------------------------------------------------
    const person = w.e('IFCPERSON', ['$', 'WebSketch', 'User', '$', '$', '$', '$', '$']);
    const org = w.e('IFCORGANIZATION', ['$', 'WebSketch 3D', '$', '$', '$']);
    const pando = w.e('IFCPERSONANDORGANIZATION', [person, org, '$']);
    const appl = w.e('IFCAPPLICATION', [org, '0.7', 'WebSketch 3D', 'WSK3D']);
    const ts = Math.round(Date.now() / 1000);
    const oh = w.raw('IFCOWNERHISTORY', [pando, appl, '$', { enum: 'NOCHANGE' }, null, null, null, ts]);
    const wcs = g.ax3(g.p3(0, 0, 0), g.d3(0, 0, 1), g.d3(1, 0, 0));
    const ctx = w.raw('IFCGEOMETRICREPRESENTATIONCONTEXT',
      ['$', 'Model', 3, 1.0e-5, wcs, g.d3(0, 0, 1)]);
    const sub = w.raw('IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
      ['Body', 'Model', '$', '$', '$', '$', ctx, '$', { enum: 'MODEL_VIEW' }, '$']);
    const uLen = w.e('IFCSIUNIT', ['*', { enum: 'LENGTHUNIT' }, '$', { enum: 'METRE' }]);
    const uArea = w.e('IFCSIUNIT', ['*', { enum: 'AREAUNIT' }, '$', { enum: 'SQUARE_METRE' }]);
    const uVol = w.e('IFCSIUNIT', ['*', { enum: 'VOLUMEUNIT' }, '$', { enum: 'CUBIC_METRE' }]);
    const uAng = w.e('IFCSIUNIT', ['*', { enum: 'PLANEANGLEUNIT' }, '$', { enum: 'RADIAN' }]);
    const units = w.e('IFCUNITASSIGNMENT', [[uLen, uArea, uVol, uAng]]);

    // ---- georeference (roadmap 1.2): IfcProjectedCRS + IfcMapConversion.
    // The base point places the local origin in the projected CRS; the
    // true-north angle becomes the XAxisAbscissa/Ordinate direction pair
    // (angle measured clockwise from project north, IFC's convention).
    if (m.geo && m.geo.basePoint) {
      const geo = m.geo;
      const crs = w.raw('IFCPROJECTEDCRS',
        [String(geo.crsName || 'EPSG:32633'), '$', String(geo.geodeticDatum || 'WGS84'),
          '$', String(geo.mapProjection || 'UTM'), '$', uLen]);
      const th = +geo.angleToTrueNorth || 0; // radians CW from project north
      w.raw('IFCMAPCONVERSION',
        [ctx, crs, +geo.basePoint.east || 0, +geo.basePoint.north || 0,
          +geo.basePoint.elev || 0, Math.cos(-th), Math.sin(-th), '$']);
      bump('georeference');
    }

    // ---- spatial tree ----------------------------------------------------
    const levels = (app.levelManager ? app.levelManager.levels : []) || [];
    if (!levels.length) levels.push({ id: 'lvl_1', name: 'Level 1', elevation: 0 });
    const project = w.raw('IFCPROJECT',
      [guid('project'), oh, 'WebSketch 3D Model', 'Exported model', '$', '$', '$', [ctx], units]);
    const sitePlace = g.lp(null, g.ax3(g.p3(0, 0, 0), null, null));
    // IFCSITE: …+ LongName, CompositionType, RefLatitude, RefLongitude,
    // RefElevation, LandTitleNumber, SiteAddress (14 attrs in IFC4)
    const site = w.raw('IFCSITE',
      [guid('site'), oh, 'Site', '$', '$', sitePlace, '$', '$', { enum: 'ELEMENT' }, '$', '$', '$', '$', '$']);
    const bldPlace = g.lp(sitePlace, g.ax3(g.p3(0, 0, 0), null, null));
    // IFCBUILDING: …+ LongName, CompositionType, ElevationOfRefHeight,
    // ElevationOfTerrain, BuildingAddress (12 attrs)
    const bldg = w.raw('IFCBUILDING',
      [guid('building'), oh, 'Building', '$', '$', bldPlace, '$', '$', { enum: 'ELEMENT' }, '$', '$', '$']);
    const storeyPlace = new Map(); // level id -> placement ref
    const storeyRef = new Map();
    for (const lv of levels) {
      const pl = g.lp(bldPlace, g.ax3(g.p3(0, 0, +lv.elevation || 0), null, null));
      // IFCBUILDINGSTOREY: …+ LongName, CompositionType, Elevation (10 attrs)
      const st = w.raw('IFCBUILDINGSTOREY',
        [guid('storey:' + lv.id), oh, String(lv.name || 'Storey'), '$', '$', pl, '$',
          String(lv.name || ''), { enum: 'ELEMENT' }, +lv.elevation || 0]);
      storeyPlace.set(lv.id, pl);
      storeyRef.set(lv.id, st);
    }
    w.raw('IFCRELAGGREGATES', [guid('agg:p-s'), oh, '$', '$', project, [site]]);
    w.raw('IFCRELAGGREGATES', [guid('agg:s-b'), oh, '$', '$', site, [bldg]]);
    w.raw('IFCRELAGGREGATES', [guid('agg:b-st'), oh, '$', '$', bldg, [...storeyRef.values()]]);

    // level of an entity: its param datum, else the nearest level under its
    // geometry (so un-leveled imported/free elements still land somewhere)
    const elevOf = id => { const l = levels.find(x => x.id === id); return l ? l.elevation : null; };
    const minZof = ent => {
      let z = Infinity;
      for (const fid of (ent.faces || [])) {
        const f = m.faces.get(fid);
        if (!f) continue;
        for (const v of f.loop) { const p = m.vp(v); if (p && p.z < z) z = p.z; }
      }
      return isFinite(z) ? z : 0;
    };
    const levelOf = ent => {
      const p = ent.params || {};
      const lid = p.baseLevel || p.baseLevelId || p.levelId;
      if (lid && storeyPlace.has(lid)) return lid;
      const z = minZof(ent);
      let best = levels[0];
      for (const l of levels)
        if ((l.elevation || 0) <= z + 1e-3 && (best == null || (l.elevation || 0) > (best.elevation || 0))) best = l;
      return best ? best.id : levels[0].id;
    };
    // element placement: identity-translation storey-relative; bodies carry
    // the coordinates (z expressed relative to the storey elevation)
    const elemPlace = ent => {
      const lid = levelOf(ent);
      const pl = g.lp(storeyPlace.get(lid), g.ax3(g.p3(0, 0, 0), null, null));
      return { pl, zOff: elevOf(lid) || 0 };
    };

    // ---- representation helpers -------------------------------------------
    const shapeRep = (items, kind) =>
      w.e('IFCSHAPEREPRESENTATION', [sub, 'Body', kind, [items]]);
    const pds = rep => w.e('IFCPRODUCTDEFINITIONSHAPE', ['$', '$', [rep]]);

    const extruded = (profile, place, dir, depth) =>
      w.e('IFCEXTRUDEDAREASOLID', [profile, place, dir, depth]);
    const rectProf = (xDim, yDim, pos2) =>
      w.e('IFCRECTANGLEPROFILEDEF', [{ enum: 'AREA' }, '$', pos2, xDim, yDim]);
    const circleProf = (r) =>
      w.e('IFCCIRCLEPROFILEDEF', [{ enum: 'AREA' }, '$', g.ax2(g.p2(0, 0), null), r]);
    const arbProf = (outer2) =>
      w.e('IFCARBITRARYCLOSEDPROFILEDEF', [{ enum: 'AREA' }, '$', g.poly2(outer2)]);
    const arbProfVoids = (outer2, holes2) =>
      w.e('IFCARBITRARYPROFILEDEFWITHVOIDS', [{ enum: 'AREA' }, '$', g.poly2(outer2), holes2.map(h => g.poly2(h))]);

    // B-Rep of the entity's built faces (the honest fallback for complex
    // solids). Points are storey-relative; hole orientation flips to oppose
    // the face normal whatever winding the kernel stores.
    const brepOf = (ent, zOff) => {
      const faces = [];
      for (const fid of (ent.faces || [])) {
        const f = m.faces.get(fid);
        if (!f) continue;
        const outerPts = f.loop.map(v => g.p3(...(p => [p.x, p.y, p.z - zOff])(m.vp(v))));
        if (outerPts.length < 3) continue;
        const nrm = G.loopNormal(m.pts(f.loop));
        const bounds = [w.e('IFCFACEOUTERBOUND', [g.poly3(outerPts), { enum: 'T' }])];
        for (const h of (f.holes || [])) {
          if (h.length < 3) continue;
          const hp = m.pts(h);
          const hn = G.loopNormal(hp);
          const same = G.dot(hn, nrm) >= 0;
          const pts = same ? hp.map(p => g.p3(p.x, p.y, p.z - zOff))
            : hp.slice().reverse().map(p => g.p3(p.x, p.y, p.z - zOff));
          bounds.push(w.e('IFCFACEBOUND', [g.poly3(pts), { enum: 'T' }]));
        }
        faces.push(w.e('IFCFACE', [bounds]));
      }
      if (!faces.length) return null;
      const shell = w.raw('IFCCLOSEDSHELL', [faces]);
      return { item: w.raw('IFCFACETEDBREP', [shell]), kind: 'Brep', usedBrep: true };
    };
    const product = (ifcType, ent, place, rep, extra) => {
      const p = ent.params || {};
      const gid = guid('ent:' + ent.id);
      const name = String(ent.name || p.name || ifcType.replace(/^IFC/, '').replace(/STANDARDCASE/, ''));
      // IfcRoot(4) + ObjectType + IfcProduct(ObjectPlacement, Representation)
      // + Tag — place/rep BEFORE the tag
      const args = [gid, oh, name, '$', '$', place, rep || '$', String(p.ifc || ent.id)];
      if (extra) args.push(...extra);
      return w.raw(ifcType, args);
    };

    // hosted openings per wall (doors / windows / plain openings)
    const hostedOn = new Map();
    for (const ent of bim.entities) {
      if (!['door', 'window', 'opening'].includes(ent.type)) continue;
      const hw = ent.params && ent.params.hostWallId;
      if (hw && bim.getEntityById(hw)) {
        if (!hostedOn.has(hw)) hostedOn.set(hw, []);
        hostedOn.get(hw).push(ent);
      }
    }

    const perStorey = new Map(); // level id -> [product refs]
    const assign = (ent, ref) => {
      const lid = levelOf(ent);
      if (!perStorey.has(lid)) perStorey.set(lid, []);
      perStorey.get(lid).push(ref);
    };

    // ---- walls -------------------------------------------------------------
    for (const ent of bim.entities) {
      if (ent.type !== 'wall') continue;
      const p = ent.params || {};
      const { pl, zOff } = elemPlace(ent);
      const h = +p.height > 0 ? +p.height : wallHeightFromFaces(ent);
      // straight-wall facts hoisted: the hosted-opening cuts below need them
      const straight = !p.closed && p.base && p.end && (!p.primitive || p.primitive === 'line');
      const A = p.base || null, B = p.end || null;
      const dx = straight && B ? B[0] - A[0] : 0, dy = straight && B ? B[1] - A[1] : 0;
      const L = Math.hypot(dx, dy);
      const t = Math.max(0.01, +p.thickness || 0.2);
      let solid = null;
      if (straight) {
        if (L > 1e-4 && h > 0.02) {
          const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
          const pos = g.ax3(g.p3(mx, my, A[2] - zOff), g.d3(0, 0, 1), g.d3(dx, dy, 0));
          const prof = rectProf(L, t, g.ax2(g.p2(0, 0), null));
          solid = extruded(prof, pos, g.d3(0, 0, 1), h);
        }
      }
      if (!solid && (p.footprint || p.closed) && h > 0.02) {
        const fp = p.footprint || (p.base && p.end ? [p.base, p.end] : null);
        if (fp && fp.length >= 3) {
          const z0 = fp[0][2];
          const outer = fp.map(q => g.p2(q[0], q[1]));
          const pos = g.ax3(g.p3(0, 0, z0 - zOff), g.d3(0, 0, 1), g.d3(1, 0, 0));
          solid = extruded(arbProf(outer), pos, g.d3(0, 0, 1), h);
        }
      }
      if (!solid) {
        // curved / irregular walls: B-Rep the built solid as an IfcWall
        const br = brepOf(ent, zOff);
        if (!br) continue;
        solid = br.item; usedBrep = true;
        const rep = shapeRep(solid, 'Brep');
        const ref = product('IFCWALL', ent, pl, pds(rep));
        assign(ent, ref); bump('wall');
        continue;
      }
      const rep = pds(shapeRep(solid, 'SweptSolid'));
      const ref = product(straight ? 'IFCWALLSTANDARDCASE' : 'IFCWALL', ent, pl, rep);
      assign(ent, ref); bump('wall');

      // hosted openings cut this wall
      if (!straight || L < 1e-4) continue;
      for (const hst of (hostedOn.get(ent.id) || [])) {
        const hp = hst.params || {};
        const wdt = Math.max(0.02, +hp.width || 0.9);
        const hgt = Math.max(0.02, +hp.height || 2.1);
        const sill = Math.max(0, +hp.sillHeight || 0);
        const d = Math.min(Math.max(+hp.distanceFromStart || wdt / 2, wdt / 2), Math.max(wdt / 2, L - wdt / 2));
        const d0 = d - wdt / 2; // extrusion runs +Z from here: center on d
        const dxn = dx / L, dyn = dy / L;
        const cx = A[0] + dxn * d0, cy = A[1] + dyn * d0, cz = A[2] + sill;
        // opening body: rectangle (thickness-span × height) extruded along
        // the wall direction, through both faces
        const oPlace = g.lp(storeyPlace.get(levelOf(ent)), g.ax3(g.p3(0, 0, 0), null, null));
        const oPos = g.ax3(g.p3(cx, cy, cz - zOff), g.d3(dxn, dyn, 0), g.d3(-dyn, dxn, 0));
        const oProf = rectProf(t * 1.4, hgt, g.ax2(g.p2(0, hgt / 2), null));
        const oSolid = extruded(oProf, oPos, g.d3(0, 0, 1), wdt);
        const oRef = product('IFCOPENINGELEMENT', hst, oPlace, pds(shapeRep(oSolid, 'SweptSolid')));
        w.raw('IFCRELVOIDSELEMENT', [guid('void:' + hst.id), oh, '$', '$', ref, oRef]);
        if (hst.type === 'door' || hst.type === 'window') {
          // thin fill body centered in the opening
          const fPos = g.ax3(g.p3(cx, cy, cz - zOff), g.d3(dxn, dyn, 0), g.d3(-dyn, dxn, 0));
          const fProf = rectProf(t * 0.5, hgt, g.ax2(g.p2(0, hgt / 2), null));
          const fSolid = extruded(fProf, fPos, g.d3(0, 0, 1), wdt);
          // IFCDOOR IFC4: …+ OverallHeight, OverallWidth, PredefinedType,
          // PartitioningType, UserDefinedPartitioningType (13);
          // IFCWINDOW IFC4 has NO PredefinedType (12)
          const extras = hst.type === 'door'
            ? [hgt, wdt, { enum: 'DOOR' }, '$', '$']
            : [hgt, wdt, '$', '$'];
          const fRef = product(hst.type === 'door' ? 'IFCDOOR' : 'IFCWINDOW',
            hst, oPlace, pds(shapeRep(fSolid, 'SweptSolid')), extras);
          w.raw('IFCRELFILLSELEMENT', [guid('fill:' + hst.id), oh, '$', '$', oRef, fRef]);
          assign(hst, fRef); bump(hst.type);
        } else bump('opening');
      }
    }
    function wallHeightFromFaces(ent) {
      let lo = Infinity, hi = -Infinity;
      for (const fid of (ent.faces || [])) {
        const f = m.faces.get(fid);
        if (!f) continue;
        for (const v of f.loop) { const p = m.vp(v); if (p) { if (p.z < lo) lo = p.z; if (p.z > hi) hi = p.z; } }
      }
      return isFinite(lo) && isFinite(hi) ? Math.max(0.05, hi - lo) : 3;
    }

    // ---- floors / slabs / flat roofs --------------------------------------
    // one IFCSLAB PER REGION: the importer converts single-extrusion
    // products (a multi-solid body reads as one shape with several items
    // and falls back to a reference mesh)
    for (const ent of bim.entities) {
      const p = ent.params || {};
      if (!['floor', 'slab', 'roof'].includes(ent.type)) continue;
      const isRoof = ent.type === 'roof';
      const flat = !isRoof || (p.kind === 'flat' || !p.kind);
      const { pl, zOff } = elemPlace(ent);
      const th = Math.max(0.01, +p.thickness || 0.2);
      const regions = [];
      if (flat && Array.isArray(p.regions)) {
        for (const r of p.regions) {
          const outer = r.outer || [];
          if (outer.length >= 3) regions.push({ outer, holes: r.holes || [] });
        }
      }
      if (regions.length) {
        regions.forEach((r, i) => {
          const zTop = r.outer[0][2];
          const pos = g.ax3(g.p3(0, 0, zTop - zOff), g.d3(0, 0, 1), g.d3(1, 0, 0));
          const prof = r.holes.length
            ? arbProfVoids(r.outer.map(q => g.p2(q[0], q[1])), r.holes.map(h => h.map(q => g.p2(q[0], q[1]))))
            : arbProf(r.outer.map(q => g.p2(q[0], q[1])));
          const solid = extruded(prof, pos, g.d3(0, 0, -1), th);
          // each region is its own IfcSlab product (guid suffix per region);
          // a single entity with N solids does not convert on import
          const sub = { id: ent.id + ':' + i, name: (ent.name || 'Slab') + (regions.length > 1 ? ' ' + (i + 1) : ''), params: p };
          const ref = product('IFCSLAB', sub, pl, pds(shapeRep(solid, 'SweptSolid')),
            [{ enum: isRoof ? 'ROOF' : 'FLOOR' }]);
          assign(ent, ref);
        });
        bump(isRoof ? 'roof' : ent.type);
        continue;
      }
      const br = brepOf(ent, zOff);
      if (!br) continue;
      usedBrep = true;
      const rep = pds(shapeRep(br.item, 'Brep'));
      const ref = product('IFCSLAB', ent, pl, rep, [{ enum: isRoof ? 'ROOF' : 'FLOOR' }]);
      assign(ent, ref); bump(isRoof ? 'roof' : ent.type);
    }

    // ---- columns ------------------------------------------------------------
    for (const ent of bim.entities) {
      if (ent.type !== 'column') continue;
      const p = ent.params || {};
      const { pl, zOff } = elemPlace(ent);
      const b = p.base || [0, 0, 0];
      const h = Math.max(0.05, +p.height || 3);
      const pos = g.ax3(g.p3(b[0], b[1], b[2] - zOff), g.d3(0, 0, 1), g.d3(1, 0, 0));
      let prof;
      if (p.family === 'circular') {
        const d = Math.max(0.02, +p.width || 0.3);
        prof = circleProf(d / 2);
      } else {
        const wdt = Math.max(0.02, +p.width || 0.3);
        const dep = Math.max(0.02, +p.depth || wdt);
        const rot = +p.rotation || 0;
        prof = rectProf(wdt, dep,
          rot ? g.ax2(g.p2(0, 0), g.d2(Math.cos(rot), Math.sin(rot))) : g.ax2(g.p2(0, 0), null));
      }
      const solid = extruded(prof, pos, g.d3(0, 0, 1), h);
      const ref = product('IFCCOLUMN', ent, pl, pds(shapeRep(solid, 'SweptSolid')));
      assign(ent, ref); bump('column');
    }

    // ---- beams ---------------------------------------------------------------
    for (const ent of bim.entities) {
      if (ent.type !== 'beam') continue;
      const p = ent.params || {};
      const { pl, zOff } = elemPlace(ent);
      // beams carry a BASELINE (multi-point allowed); fall back to base/end
      const bl = Array.isArray(p.baseline) && p.baseline.length >= 2
        ? p.baseline
        : (p.base && p.end ? [p.base, p.end] : null);
      if (!bl) continue;
      const A = bl[0], B = bl[bl.length - 1];
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-4) continue;
      const SM = root.StructuralManager || window.StructuralManager;
      let loop = null;
      try { loop = SM && SM.BeamProfiles ? SM.BeamProfiles.for(p) : null; } catch (e) { loop = null; }
      if (!loop || loop.length < 3) {
        const bw = Math.max(0.02, +p.webWidth || +p.width || 0.2);
        const h = Math.max(0.05, +p.height || 0.4);
        loop = [{ u: -bw / 2, v: 0 }, { u: bw / 2, v: 0 }, { u: bw / 2, v: h }, { u: -bw / 2, v: h }];
      }
      const h = Math.max(...loop.map(q => q.v));
      // world mapping (StructuralManager contract): u → baseline LEFT normal,
      // v → +Z, flange TOP (v = h) at the baseline plane
      const left = [-dy / L, dx / L, 0];
      const pos = g.ax3(g.p3(A[0], A[1], A[2] - h - zOff), g.d3(dx, dy, 0), g.d3(...left));
      const prof = arbProf(loop.map(q => g.p2(q.u, q.v)));
      const solid = extruded(prof, pos, g.d3(0, 0, 1), L);
      const ref = product('IFCBEAM', ent, pl, pds(shapeRep(solid, 'SweptSolid')));
      assign(ent, ref); bump('beam');
    }

    // ---- foundations ------------------------------------------------------------
    for (const ent of bim.entities) {
      if (ent.type !== 'foundation') continue;
      const p = ent.params || {};
      const { pl, zOff } = elemPlace(ent);
      const b = p.base || [0, 0, 0];
      const wdt = Math.max(0.02, +p.width || 1);
      const dep = Math.max(0.02, +p.depth || wdt);
      const th = Math.max(0.02, +p.thickness || 0.5);
      const rot = +p.rotation || 0;
      const pos = g.ax3(g.p3(b[0], b[1], b[2] - zOff), g.d3(0, 0, 1), g.d3(1, 0, 0));
      const prof = rectProf(wdt, dep,
        rot ? g.ax2(g.p2(0, 0), g.d2(Math.cos(rot), Math.sin(rot))) : g.ax2(g.p2(0, 0), null));
      const solid = extruded(prof, pos, g.d3(0, 0, -1), th);
      const ref = product('IFCFOOTING', ent, pl, pds(shapeRep(solid, 'SweptSolid')), [{ enum: 'PAD_FOOTING' }]);
      assign(ent, ref); bump('foundation');
    }

    // ---- stairs + handrails (B-Rep + recipe children) -------------------------
    for (const ent of bim.entities) {
      if (ent.type !== 'stairs' && ent.type !== 'handrail') continue;
      const { pl, zOff } = elemPlace(ent);
      const br = brepOf(ent, zOff);
      if (!br) continue;
      usedBrep = true;
      const p = ent.params || {};
      if (ent.type === 'handrail') {
        const ref = product('IFCRAILING', ent, pl, pds(shapeRep(br.item, 'Brep')));
        assign(ent, ref); bump('handrail');
      } else {
        const stairRef = product('IFCSTAIR', ent, pl, pds(shapeRep(br.item, 'Brep')),
          [{ enum: p.run === 'u' ? 'TWO_STRAIGHT_RUN' : 'STRAIGHT_RUN' }]);
        // the flight carries the recipe as schema (our importer reads these)
        // IFCSTAIRFLIGHT IFC4: …+ NumberOfRisers, NumberOfTreads,
        // RiserHeight, TreadLength (12 attrs)
        const flight = w.raw('IFCSTAIRFLIGHT',
          [guid('flight:' + ent.id), oh, String(ent.name || 'Flight'), '$', '$', String(ent.id),
            pl, pds(shapeRep(br.item, 'Brep')), '$',
            +p.nRisers || 0, +p.nTreads || 0, +p.riserActual || +p.riser || 0, +p.tread || 0]);
        w.raw('IFCRELAGGREGATES', [guid('agg:stair:' + ent.id), oh, '$', '$', stairRef, [flight]]);
        assign(ent, stairRef); bump('stairs');
      }
    }

    // ---- rooms (IfcSpace — Phase 2): boundary ring extruded up by the
    // storey-to-storey height (or 3 m on the top level) -----------------------
    for (const ent of bim.entities) {
      if (ent.type !== 'room') continue;
      const p = ent.params || {};
      const ring = Array.isArray(p.boundary) && p.boundary.length >= 3 ? p.boundary : null;
      if (!ring) continue;
      const { pl, zOff } = elemPlace(ent);
      const lid = levelOf(ent);
      const lvIdx = levels.findIndex(l => l.id === lid);
      const nextLv = levels[lvIdx + 1];
      const elev = elevOf(lid) || 0;
      const h = Math.max(0.1, nextLv ? Math.max(0.1, (nextLv.elevation || 0) - elev) : 3);
      const z0 = elev + 0.002;
      const pos = g.ax3(g.p3(0, 0, z0 - zOff), g.d3(0, 0, 1), g.d3(1, 0, 0));
      const prof = arbProf(ring.map(q => g.p2(q[0], q[1])));
      const solid = extruded(prof, pos, g.d3(0, 0, 1), h);
      // IfcSpace IFC4 (a SPATIAL element, no Tag): (…, LongName,
      // CompositionType, PredefinedType, ElevationWithFlooring) = 11 attrs
      const gid = guid('ent:' + ent.id);
      const ref = w.raw('IFCSPACE',
        [gid, oh, String(ent.name || p.name || 'Room'), '$', '$', pl, pds(shapeRep(solid, 'SweptSolid')),
          String(p.department || p.zone || ''), { enum: 'ELEMENT' }, { enum: 'SPACE' }, '$']);
      assign(ent, ref); bump('room');
    }

    // ---- everything else: proxy with B-Rep ------------------------------------
    const KNOWN = ['wall', 'floor', 'slab', 'roof', 'column', 'beam', 'foundation',
      'stairs', 'handrail', 'door', 'window', 'opening', 'room'];
    for (const ent of bim.entities) {
      if (KNOWN.includes(ent.type)) continue;
      const { pl, zOff } = elemPlace(ent);
      const br = brepOf(ent, zOff);
      if (!br) continue;
      usedBrep = true;
      const ref = product('IFCBUILDINGELEMENTPROXY', ent, pl, pds(shapeRep(br.item, 'Brep')));
      assign(ent, ref); bump(ent.type || 'proxy');
    }

    // ---- grids -----------------------------------------------------------------
    const gm = app.gridManager;
    if (gm && gm.grids && gm.grids.length) {
      const axes = [[], []]; // [U, V]
      for (const gr of gm.grids) {
        if (gr.isCurved || !gr.start || !gr.end) continue;
        const i = gr.axis === 'y' ? 1 : 0;
        const curve = w.e('IFCPOLYLINE', [[g.p3(gr.start[0], gr.start[1], 0), g.p3(gr.end[0], gr.end[1], 0)]]);
        axes[i].push(w.e('IFCGRIDAXIS', [String(gr.name || ''), curve, { enum: 'T' }]));
      }
      if (axes[0].length || axes[1].length) {
        const gridRef = w.raw('IFCGRID',
          [guid('grid'), oh, 'Grid', '$', '$', '$', sitePlace, '$', [axes[0], axes[1]]]);
        w.raw('IFCRELAGGREGATES', [guid('agg:grid'), oh, '$', '$', site, [gridRef]]);
        bump('grid');
      }
    }

    // ---- containment ------------------------------------------------------------
    for (const [lid, refs] of perStorey) {
      if (!refs.length || !storeyRef.has(lid)) continue;
      // IFCRELCONTAINEDINSPATIALSTRUCTURE: 6 attrs, no CompositionType
      w.raw('IFCRELCONTAINEDINSPATIALSTRUCTURE',
        [guid('contain:' + lid), oh, '$', '$', refs, storeyRef.get(lid)]);
    }

    // ---- STEP assembly ------------------------------------------------------------
    const now = new Date().toISOString().slice(0, 19);
    const text = [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('ViewDefinition [CoordinationView_V2.0]'),'2;1');",
      "FILE_NAME('model.ifc','" + now + "',('WebSketch 3D'),('WebSketch 3D'),'WebSketch 3D IFC writer','WebSketch 3D','');",
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
      ...w.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      ''
    ].join('\n');
    return {
      text,
      counts,
      warn: usedBrep ? 'complex solids exported as B-Rep' : null,
      entities: w.count,
    };
  }

  root.IfcExport = { fromApp, _internals: { guid, makeWriter, fmtArg } };
})(window);
