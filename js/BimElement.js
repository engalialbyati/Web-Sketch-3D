'use strict';
// ---------------------------------------------------------------------------
// BimElement.js — the Revit-style element architecture.
//
// A BimElement is ONE selectable object: the parametric entity (model.
// bimEntities entry) rendered as a unified Three.js Group (a compound face
// mesh tagged with the element id). Clicking any triangle of the group
// selects the WHOLE element; the properties panel then exposes its
// Category ➔ Family ➔ Type and instance parameters.
//
// Sub-element query (Ctrl or Tab held) raycasts INTO the group and reports
// the individual face's planar area (m²) or edge's 3D length (m) — a pure
// measurement pass that never detaches or breaks the top-level container.
//
// BimElementRegistry keeps the Groups in sync with the model (rebuilt on
// every commit alongside view.rebuild()) and maps entities to their catalog
// family/type in the database (creating dynamic types as needed).
// ---------------------------------------------------------------------------
(function (root) {

  // ------------------------------------------------------------- one element
  class BimElement {
    constructor(entity) {
      this.entity = entity;
      this.group = null;   // THREE.Group — the unified selectable object
      this.mesh = null;    // face mesh inside the group
    }
    get id() { return this.entity.id; }

    /**
     * (Re)build the unified Group from the entity's B-Rep faces. The mesh
     * shares the viewport's face material and carries a triangle -> faceId
     * map so picking resolves back to model faces. A layerColor (the
     * entity's layer color, "ByLayer") overrides the per-face paint.
     * Returns the Group.
     */
    build(model, faceMaterial, layerColor) {
      this.dispose();
      const group = new THREE.Group();
      group.name = 'bim-element:' + this.entity.id;
      group.userData.elementId = this.entity.id;

      const pos = [], nor = [], col = [], triFace = [];
      const lc = layerColor ? hexToRgb(layerColor) : null; // ByLayer tint
      for (const fid of this.entity.faces) {
        const f = model.faces.get(fid);
        if (!f || f.hidden) continue;
        const outer = model.pts(f.loop);
        const n = G.loopNormal(outer);
        if (G.isZero(n)) continue;
        const { u, v } = G.basisForNormal(n);
        const o = outer[0];
        const t2 = p => new THREE.Vector2(G.to2D(p, o, u, v).x, G.to2D(p, o, u, v).y);
        let tris = [];
        try { tris = THREE.ShapeUtils.triangulateShape(outer.map(t2), f.holes.map(h => model.pts(h).map(t2))); } catch (e) { tris = []; }
        const all = outer.concat(f.holes.flatMap(h => model.pts(h)));
        const c = lc || (f.color ? hexToRgb(f.color) : { r: 1, g: 1, b: 1 });
        const a = f.alpha == null ? 1 : f.alpha;
        for (const t of tris) {
          for (const idx of t) {
            const p = all[idx];
            pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b, a);
          }
          triFace.push(fid);
        }
      }
      if (pos.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
        const mesh = new THREE.Mesh(geo, faceMaterial);
        mesh.castShadow = true;
        mesh.userData.elementId = this.entity.id;
        mesh.userData.triangleFace = triFace; // faceIndex -> model face id
        group.add(mesh);
        this.mesh = mesh;
      }
      // the element's own edges render INSIDE its Group — per-element edges
      // are what lets the merged pass skip them and rebuilds stay local
      const ep = [];
      for (const fid of this.entity.faces) {
        const f = model.faces.get(fid);
        if (!f || f.hidden) continue;
        for (const ring of model.rings(f)) {
          const pts = model.pts(ring);
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            ep.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
      }
      if (ep.length) {
        const eg = new THREE.BufferGeometry();
        eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
        const lines = new THREE.LineSegments(eg, model.__edgeMaterial || new THREE.LineBasicMaterial({ color: 0x1b1f23 }));
        lines.userData.elementId = this.entity.id;
        group.add(lines);
      }
      this.group = group;
      return group;
    }

    dispose() {
      if (this.group) {
        if (this.group.parent) this.group.parent.remove(this.group);
        this.group.traverse(ch => { if (ch.geometry) ch.geometry.dispose(); });
      }
      this.group = null;
      this.mesh = null;
    }

    // ---- sub-element measurement (pure queries against the model) ----
    /** Planar surface area of one face of this element, in m². */
    measureFace(model, faceId) {
      const f = model.faces.get(faceId);
      if (!f) return null;
      return { area: model.faceArea(f), centroid: model.faceCentroid(f) };
    }
    /** 3D length of one edge of this element, in m. */
    measureEdge(model, edgeId) {
      const e = model.edges.get(edgeId);
      if (!e) return null;
      const a = model.vp(e.a), b = model.vp(e.b);
      return { length: model.edgeLength(e), midpoint: G.mul(G.add(a, b), 0.5) };
    }
  }

  // ----------------------------------------------------------- the registry
  class BimElementRegistry {
    constructor(app) {
      this.app = app;
      this._byId = new Map();          // entityId -> BimElement
      this._typeMeta = new Map();      // entityId -> {typeId, familyId, categoryId, typeName, familyName, categoryName}
      this._catalog = { categories: [], families: [], types: [] };
    }
    get(id) { return this._byId.get(id) || null; }
    list() { return [...this._byId.values()]; }
    get size() { return this._byId.size; }

    /** Sync Groups with the model's entities. Returns the set of face ids
     *  owned by elements (the merged mesh skips those). */
    rebuild() {
      const app = this.app, model = app.model, view = app.view;
      if (!view || !view.elementsRoot) return new Set();
      const faceIds = new Set();
      // ByLayer color: the entity's layer color tints its whole Group
      const layerColor = ent => {
        const ly = (model.layers || []).find(l => l.id === ent.layerId);
        return (ly && ly.color) || null;
      };
      // INCREMENTAL: an element whose face signature is unchanged keeps its
      // Group (no dispose, no re-triangulation) — only dirty entities rebuild.
      // This is the per-element half of the performance path: a commit that
      // touches one beam costs that beam, not the whole model.
      const live = new Set();
      for (const ent of app.bim.entities) {
        ent.faces = ent.faces.filter(id => model.faces.has(id));
        if (!ent.faces.length) continue;
        live.add(ent.id);
        const sig = ent.faces.join(',');
        let el = this._byId.get(ent.id);
        if (el && el._sig === sig && el.group) {
          // unchanged — but hidden/lock display state must still track
          if (el.group.parent) el.group.visible = !ent.hidden;
        } else {
          if (el) el.dispose();
          el = new BimElement(ent);
          el._sig = sig;
          view.elementsRoot.add(el.build(model, view.faceMat, layerColor(ent)));
          this._byId.set(ent.id, el);
        }
        for (const id of ent.faces) faceIds.add(id);
      }
      for (const [id, el] of [...this._byId])
        if (!live.has(id)) { el.dispose(); this._byId.delete(id); }
      return faceIds;
    }

    refreshCatalog() {
      if (!this.app.db) return Promise.resolve();
      return this.app.db.getCatalog().then(c => { this._catalog = c; }).catch(() => { });
    }

    // ---- entity ➔ catalog mapping (Category ➔ Family ➔ Type) ----
    // Resolves (and caches) the catalog type standing for a parametric
    // entity, creating a dynamic type when nothing seeded matches — Revit's
    // project browser grows the same way.
    async ensureCatalogFor(ent) {
      const cached = this._typeMeta.get(ent.id);
      if (cached && cached.typeId) return cached;
      const db = this.app.db;
      if (!db) return null;
      const p = ent.params || {};
      const pick = (catId, famId, typeName, defaults) => {
        return { catId, famId, typeName, defaults };
      };
      let sel = null;
      switch (ent.type) {
        case 'wall': {
          const fam = 'fam_wall_basic';
          const t = p.thickness || 0.2;
          const known = this._catalog.types.find(x =>
            x.familyId === fam && Math.abs((x.defaultParameters || {}).thickness - t) < 1e-3);
          sel = known
            ? pick(null, fam, known.name, known.defaultParameters)
            : pick(null, fam, `Custom — ${Math.round(t * 1000)} mm`, { thickness: t, defaultHeight: p.height || 3, material: 'Concrete' });
          break;
        }
        case 'floor': {
          const t = p.thickness || 0.2;
          const known = this._catalog.types.find(x =>
            x.familyId === 'fam_floor_generic' && Math.abs((x.defaultParameters || {}).thickness - t) < 1e-3);
          sel = known
            ? pick(null, 'fam_floor_generic', known.name, known.defaultParameters)
            : pick(null, 'fam_floor_generic', `Finish Floor — ${Math.round(t * 1000)} mm`, { thickness: t, material: 'Concrete' });
          break;
        }
        case 'slab': {
          const t = p.thickness || 0.25;
          const known = this._catalog.types.find(x =>
            x.familyId === 'fam_slab_structural' && Math.abs((x.defaultParameters || {}).thickness - t) < 1e-3);
          sel = known
            ? pick(null, 'fam_slab_structural', known.name, known.defaultParameters)
            : pick(null, 'fam_slab_structural', `Slab — ${Math.round(t * 1000)} mm`, { thickness: t, material: 'Concrete' });
          break;
        }
        case 'door':
        case 'window': {
          const kind = ent.type;
          const famId = this._familyForHosted(kind);
          const w = p.width || 0.9, h = p.height || 2.1;
          const name = `${Math.round(w * 1000).toString().padStart(4, '0')} x ${Math.round(h * 1000).toString().padStart(4, '0')}`;
          const known = this._catalog.types.find(x => x.familyId === famId && x.name === name);
          sel = known
            ? pick(null, famId, known.name, known.defaultParameters)
            : pick(null, famId, name, { width: w, height: h, sill: p.sillHeight || 0, material: kind === 'window' ? 'Glass' : 'Wood' });
          break;
        }
        case 'opening':
          sel = pick(null, 'fam_wall_opening', 'Rectangular Cut', { width: p.width || 1, height: p.height || 2.1, sill: p.sillHeight || 0 });
          break;
        case 'column': {
          // design family (Tuscan, Drop Panel…): resolve to the family's own
          // catalog node; the beam branch below shows the dynamic create
          const fam = window.ColumnFamilies ? ColumnFamilies.get(p.family) : null;
          if (fam) {
            const famId = 'fam_col_' + fam.id;
            if (!this._catalog.families.some(f => f.id === famId)) {
              // a placed family column grows the catalog (Revit-style), even
              // if the user never saved a type for it
              await db.ensureFamily(famId, 'cat_column', fam.name + ' Column');
              this._catalog.families.push({ id: famId, categoryId: 'cat_column', name: fam.name + ' Column' });
            }
            const w = p.width || 0.3, d = p.depth || 0.3;
            const defaults = Object.assign(
              { family: fam.id, defaultHeight: p.height || 3, material: 'Concrete' },
              window.ColumnFamilies ? ColumnFamilies.normalize(fam.id, p) : { width: w, depth: d });
            sel = pick(null, famId, `${fam.name} ${Math.round(w * 1000)} x ${Math.round(d * 1000)}`, defaults);
          } else {
            sel = pick(null, 'fam_col_rect', `Column ${Math.round((p.width || 0.3) * 1000)} x ${Math.round((p.depth || 0.3) * 1000)}`,
              { width: p.width || 0.3, depth: p.depth || 0.3, defaultHeight: p.height || 3, material: 'Concrete' });
          }
          break;
        }
        case 'beam': {
          // structural framing family grows dynamically (Revit-style)
          const famId = 'fam_beam_framing', catId = 'cat_framing';
          if (!this._catalog.families.some(f => f.id === famId) && db.putFamily) {
            if (!this._catalog.categories.some(c => c.id === catId)) {
              await db.putCategory({ id: catId, name: 'Structural Framing' });
              this._catalog.categories.push({ id: catId, name: 'Structural Framing' });
            }
            await db.putFamily({ id: famId, categoryId: catId, name: 'Concrete Beam' });
            this._catalog.families.push({ id: famId, categoryId: catId, name: 'Concrete Beam' });
          }
          const prof = { rectangular: 'Rectangular', t: 'T-Beam', l: 'L-Beam' }[p.profile || 'rectangular'] || 'Rectangular';
          sel = pick(null, famId, `${prof} — ${Math.round((p.height || 0.5) * 1000)} mm`,
            { profile: p.profile || 'rectangular', height: p.height || 0.5, webWidth: p.webWidth || 0.25, flangeWidth: p.flangeWidth || 0.6, flangeThickness: p.flangeThickness || 0.15, material: 'Concrete' });
          break;
        }
        case 'foundation': {
          // isolated pads live in the strip-footing family; the PLAN SIZE
          // names the type (a Pad 1200 x 1200 reuses the type a previous
          // identical pad already grew, Revit-style)
          const w = p.width || 1.2, d = p.depth || 1.2, t = p.thickness || 0.5;
          const name = `Pad ${Math.round(w * 1000)} x ${Math.round(d * 1000)}`;
          const known = this._catalog.types.find(x => x.familyId === 'fam_fnd_strip' && x.name === name);
          sel = known
            ? pick(null, 'fam_fnd_strip', known.name, known.defaultParameters)
            : pick(null, 'fam_fnd_strip', name, { width: w, depth: d, thickness: t, defaultHeight: t, material: 'Concrete' });
          break;
        }
        case 'script': {
          // Scripted Elements map to the type their script created on save
          // (js/script-elements.js ensureCatalogType); a missing script still
          // resolves so the Elements table keeps its row
          const famId = 'fam_scripted_' + (p.scriptId || 'missing');
          const known = this._catalog.types.find(x => x.familyId === famId);
          sel = known
            ? pick(null, famId, known.name, known.defaultParameters)
            : pick(null, famId, p.scriptName || 'Scripted', { scriptId: p.scriptId, scriptName: p.scriptName });
          break;
        }
        default:
          sel = pick(null, 'fam_wall_basic', 'Generic', {});
          break;
      }
      // resolve the family record (async), then the type
      const fam = this._catalog.families.find(f => f.id === sel.famId) || await db.getFamily(sel.famId);
      if (!fam) return null;
      const typeRec = await db.ensureType(sel.famId, sel.typeName, sel.defaults);
      const meta = {
        typeId: typeRec.id, familyId: fam.id, categoryId: fam.categoryId,
        typeName: typeRec.name, familyName: fam.name,
        categoryName: (this._catalog.categories.find(c => c.id === fam.categoryId) || {}).name || ent.type,
      };
      this._typeMeta.set(ent.id, meta);
      return meta;
    }
    _familyForHosted(kind) {
      // prefer the family the user had active for this kind, else the seed
      const famId = kind === 'door' ? 'fam_door_single' : 'fam_window_fixed';
      if (this.app.bimOptions && this.app.bimOptions.family && this._catalog.families.length) {
        const active = this._catalog.families.find(f =>
          f.id === this.app.bimOptions.family &&
          (this._catalog.categories.find(c => c.id === f.categoryId) || {}).name.toLowerCase() === kind);
        if (active) return active.id;
      }
      return famId;
    }

    /** Synchronous catalog info for the properties panel (cache-backed). */
    catalogInfoFor(ent) {
      const meta = this._typeMeta.get(ent.id);
      if (meta) return meta;
      return {
        typeId: null, familyId: null, categoryId: null,
        typeName: null, familyName: null,
        categoryName: { wall: 'Wall', slab: 'Slab', floor: 'Floor', door: 'Door', window: 'Window', opening: 'Wall Opening', column: 'Column', beam: 'Beam', foundation: 'Foundation' }[ent.type] || ent.type,
      };
    }

    /** Drop the cached entity->type mapping so the next lookup re-resolves
     *  from the element's CURRENT parameters (after a type/param change). */
    refreshTypeFor(ent) {
      this._typeMeta.delete(ent.id);
      return this.ensureCatalogFor(ent);
    }

    /** Drop every cached entity->type mapping (undo/redo restored params
     *  under the cached types — the next sync re-resolves from the params). */
    invalidateAllTypes() { this._typeMeta.clear(); }

    /** Types of the same family (for the type dropdown on a selection). */
    siblingTypes(ent) {
      const meta = this._typeMeta.get(ent.id);
      if (!meta) return [];
      return this._catalog.types.filter(t => t.familyId === meta.familyId);
    }

    // ---- sub-element query (Ctrl / Tab held) ----
    // Raycast down to one face or edge INSIDE an element's unified group and
    // report its measurement. Pure query: nothing is selected or detached.
    subPick(view, ev, model) {
      const q = view.eventPt(ev);
      const fid = view.pickFaceAt(q);
      if (fid != null) {
        const f = model.faces.get(fid);
        if (f) {
          const el = f.userData && f.userData.bimEntityId ? this.get(f.userData.bimEntityId) : null;
          const m = el ? el.measureFace(model, fid) : {
            area: model.faceArea(f), centroid: model.faceCentroid(f),
          };
          if (m) return { kind: 'face', id: fid, elementId: f.userData ? f.userData.bimEntityId : null, area: m.area, point: m.centroid };
        }
      }
      const pe = this.app.pickEdgeAt ? this.app.pickEdgeAt(ev, 6) : null;
      if (pe) {
        const e = pe.edge;
        const a = model.vp(e.a), b = model.vp(e.b);
        return { kind: 'edge', id: e.id, elementId: e.userData ? e.userData.bimEntityId : null, length: model.edgeLength(e), point: G.mul(G.add(a, b), 0.5) };
      }
      return null;
    }
  }

  root.BimElement = BimElement;
  root.BimElementRegistry = BimElementRegistry;
})(typeof window !== 'undefined' ? window : globalThis);
