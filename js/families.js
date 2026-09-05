'use strict';
// ---------------------------------------------------------------------------
// families.js — Revit-style loadable families for hosted elements.
// A family mirrors the Revit model: a category (door/window), TYPE parameters
// (width/height/sill per named type), and geometry that builds itself inside
// a cut opening (wall-hosted, like .rfa loadable families). Real .rfa files
// are proprietary binary and cannot be parsed in a browser — families here
// use an open JSON format, so anyone can author or download-and-convert one:
//   { id, label, kind: 'door'|'window',
//     types: [{ name, width, height, sill }],
//     build(G, model, info, spec, flip) -> [faces] }
// Install: app.families.install(jsonText) (file open / paste / fetch).
// ---------------------------------------------------------------------------
class FamilyManager {
  constructor() {
    this.families = new Map();
    // built-ins carry primitive geometry, not a build function — attach the
    // definition builder so register() accepts them (and they behave exactly
    // like installed families)
    for (const src of FamilyManager.BUILT_INS) {
      const fam = Object.assign({}, src, { types: src.types.map(t => ({ ...t })) });
      fam.build = (G, model, info, spec, flip) => FamilyManager.buildFromDefinition(G, model, info, spec, flip, fam);
      this.register(fam);
    }
  }
  register(fam) {
    if (!fam || !fam.id || typeof fam.build !== 'function') return false;
    this.families.set(fam.id, fam);
    return true;
  }
  // install from raw JSON text (returns the family or an error string)
  install(jsonText) {
    let d;
    try { d = JSON.parse(jsonText); } catch (e) { return 'not valid JSON'; }
    // JSON cannot carry functions: families with "script" builds are declined
    if (!d.id || !d.label || (d.kind !== 'door' && d.kind !== 'window'))
      return 'family needs id, label, kind ("door"|"window"), types';
    if (!Array.isArray(d.types) || !d.types.length) return 'family needs at least one type';
    // geometry: inline OBJ meshes are converted to a planar-face builder
    if (!d.obj && !d.primitives) return 'family needs "obj" (mesh text) or "primitives" (boxes)';
    const fam = Object.assign({}, d, { types: d.types.map(t => ({
      name: t.name || 'Type', width: +t.width || 0.9, height: +t.height || 2.1, sill: +t.sill || 0,
    })) });
    fam.build = (G, model, info, spec, flip) => FamilyManager.buildFromDefinition(G, model, info, spec, flip, fam);
    this.register(fam);
    return fam;
  }
  get list() { return [...this.families.values()]; }

  // ---- geometry builders -------------------------------------------------
  static buildFromDefinition(G, model, info, spec, flip, fam) {
    const faces = [];
    const rect = info.rect, into = info.into;
    const a = rect[0], b = rect[1];
    const z0 = Math.min(rect[0].z, rect[3].z), z1 = Math.max(rect[0].z, rect[3].z);
    const dirW = G.norm(G.sub(G.v(b.x, b.y, z0), G.v(a.x, a.y, z0)));
    const up = G.v(0, 0, 1);
    const origin = G.v(a.x, a.y, z0);
    if (fam.obj) {
      // OBJ: v lines + f (triangles/quads) in a local Y-up frame scaled to
      // the opening (x across, y up, z depth); mapped into the wall frame.
      const verts = [];
      const map = p => {
        const wx = origin.x + dirW.x * p[0] + into.x * (p[2] - 0) * -1;
        const wy = origin.y + dirW.y * p[0] + into.y * (p[2] - 0) * -1;
        return G.v(wx, wy, origin.z + p[1]);
      };
      for (const line of fam.obj.split('\n')) {
        const t = line.trim().split(/\s+/);
        if (t[0] === 'v') verts.push(map([+t[1], +t[2], +t[3] || 0]));
        else if (t[0] === 'f') {
          const idx = t.slice(1).map(s => parseInt(s.split('/')[0], 10) - 1);
          const ring = idx.filter(i => i >= 0 && i < verts.length).map(i => verts[i]);
          if (ring.length >= 3) { const f = model.addFaceFromRings(ring.map(p => G.clone(p))); if (f) faces.push(f); }
        }
      }
      return faces;
    }
    if (fam.primitives) {
      // primitives: axis-aligned boxes in the opening frame —
      // {x, y, z, w, h, d} with x across, y up, z through the wall
      const depth = spec.thickness || 0.2;
      for (const p of fam.primitives) {
        const cs = [
          [p.x, p.y, p.z], [p.x + p.w, p.y, p.z], [p.x + p.w, p.y + p.h, p.z], [p.x, p.y + p.h, p.z],
          [p.x, p.y, p.z + p.d], [p.x + p.w, p.y, p.z + p.d], [p.x + p.w, p.y + p.h, p.z + p.d], [p.x, p.y + p.h, p.z + p.d],
        ].map(c => G.add(G.add(origin, G.add(G.mul(dirW, c[0]), G.v(0, 0, c[1]))), G.mul(into, depth - c[2] - p.d)));
        const quads = [[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
        for (const q of quads) {
          const f = model.addFaceFromRings(q.map(i => G.clone(cs[i])));
          if (f) faces.push(f);
        }
      }
    }
    return faces;
  }
}

FamilyManager.BUILT_INS = [
  {
    id: 'door-single', label: 'Single Flush Door', kind: 'door',
    types: [{ name: '0915 x 2134', width: 0.9, height: 2.1, sill: 0 }],
    primitives: [
      { x: 0, y: 0, z: 0.06, w: 0.06, h: 2.1, d: 0.06 },
      { x: 0.84, y: 0, z: 0.06, w: 0.06, h: 2.1, d: 0.06 },
      { x: 0, y: 2.04, z: 0.06, w: 0.9, h: 0.06, d: 0.06 },
      { x: 0.06, y: 0, z: 0.02, w: 0.78, h: 2.04, d: 0.04 },
    ],
  },
  {
    id: 'door-double', label: 'Double Flush Door', kind: 'door',
    types: [{ name: '1830 x 2134', width: 1.8, height: 2.1, sill: 0 }],
    primitives: [
      { x: 0, y: 0, z: 0.06, w: 0.07, h: 2.1, d: 0.06 },
      { x: 1.73, y: 0, z: 0.06, w: 0.07, h: 2.1, d: 0.06 },
      { x: 0, y: 2.03, z: 0.06, w: 1.8, h: 0.07, d: 0.06 },
      { x: 0.07, y: 0, z: 0.02, w: 0.79, h: 2.03, d: 0.04 },
      { x: 0.94, y: 0, z: 0.02, w: 0.79, h: 2.03, d: 0.04 },
    ],
  },
  {
    id: 'window-cased', label: 'Cased Window', kind: 'window',
    types: [{ name: '1220 x 1525', width: 1.2, height: 1.5, sill: 0.9 }],
    primitives: [
      { x: 0, y: 0, z: 0.04, w: 0.05, h: 1.5, d: 0.12 },
      { x: 1.15, y: 0, z: 0.04, w: 0.05, h: 1.5, d: 0.12 },
      { x: 0, y: 1.45, z: 0.04, w: 1.2, h: 0.05, d: 0.12 },
      { x: 0, y: 0, z: 0.04, w: 1.2, h: 0.05, d: 0.12 },
      { x: 0.58, y: 0.05, z: 0.04, w: 0.04, h: 1.4, d: 0.12 },
    ],
  },
];
window.FamilyManager = FamilyManager;
