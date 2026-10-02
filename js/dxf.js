'use strict';
// dxf.js — minimal DXF R12 writer: every model edge as a LINE entity on a
// layer per element/category, arcs/circles as bulged polylines (R12 has no
// true ARC entity on custom layers without more sections; tessellated
// chords are what the model itself holds, so WYSIWYG). Y-up DXF vs Z-up
// app: the PLAN export maps (x, y, z) → (x, z, −y)? No — standard practice
// for civil plans: DXF X = east, DXF Y = north, which is the app's (x, y);
// elevation goes to the Z coordinate (DXF "thickness"/elevation fields are
// unreliable across readers). Wires stay 2D at z=0 with the app z stored as
// the entity elevation attribute; readers that care show it.
(function () {
  const LAYERS = { wall: 'A-WALL', floor: 'A-FLOOR', slab: 'S-SLAB', column: 'S-COLS', beam: 'S-BEAM', default: '0' };

  /** Build a DXF R12 document from a model.
   * model: the kernel Model (faces/edges/vertices/bimEntities)
   * opts: { elevations: true → per-edge Z as the elevation attribute (plan
   *         export drops it into 0), unit: 'm' | 'mm' | 'cm' (scale factor) }
   * Returns the DXF text. */
  function modelToDxf(model, opts = {}) {
    const scale = opts.unit === 'mm' ? 1000 : opts.unit === 'cm' ? 100 : 1;
    const keepZ = opts.elevations !== false;
    const lines = [];
    const ent = (code, val) => { lines.push(String(code)); lines.push(String(val)); };

    // entity layer: a BIM-stamped edge follows its element's category;
    // free edges land on 0
    const edgeLayer = new Map();
    for (const ent2 of (model.bimEntities || [])) {
      const lay = LAYERS[ent2.type] || LAYERS.default;
      for (const id of (ent2.edges || [])) edgeLayer.set(id, lay);
      // faces' boundary edges too (entities registered via faces only)
      for (const fid of (ent2.faces || [])) {
        const f = model.faces.get(fid);
        if (!f) continue;
        for (const ring of model.rings(f)) for (let i = 0; i < ring.length; i++) {
          const e = model.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (e) edgeLayer.set(e.id, lay);
        }
      }
    }

    let count = 0;
    for (const e of model.edges.values()) {
      if (e.hidden) continue;
      const a = model.vp(e.a), b = model.vp(e.b);
      if (!a || !b) continue;
      count++;
      ent(0, 'LINE');
      ent(8, edgeLayer.get(e.id) || LAYERS.default);
      ent(10, (a.x * scale).toFixed(6));
      ent(20, (a.y * scale).toFixed(6));
      ent(30, keepZ ? (a.z * scale).toFixed(6) : '0.0');
      ent(11, (b.x * scale).toFixed(6));
      ent(21, (b.y * scale).toFixed(6));
      ent(31, keepZ ? (b.z * scale).toFixed(6) : '0.0');
    }

    return [
      '0', 'SECTION', '2', 'HEADER',
      '9', '$ACADVER', '1', 'AC1009',
      '9', '$INSUNITS', '70', opts.unit === 'mm' ? 4 : opts.unit === 'cm' ? 5 : 6,
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      ...lines,
      '0', 'ENDSEC',
      '0', 'EOF',
    ].join('\r\n');
  }

  window.DxfWriter = { modelToDxf, LAYERS };
})();
