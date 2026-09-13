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
      this.edgePositions = []; // flat segments for the registry's edge batch
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
        // BVH for picking: O(log n) raycasts against this element (the
        // prototype.raycast patch in render.js routes through it). Built
        // lazily-on-first-build; SAH strategy, leaf 1 — element meshes are
        // small so this is cheap relative to the triangulation above.
        if (geo.computeBoundsTree)
          geo.computeBoundsTree({ maxLeafSize: 1, strategy: window.MeshBVHLib ? MeshBVHLib.SAH : 2 });
        const mesh = new THREE.Mesh(geo, faceMaterial);
        mesh.castShadow = true;
        mesh.userData.elementId = this.entity.id;
        mesh.userData.triangleFace = triFace; // faceIndex -> model face id
        group.add(mesh);
        this.mesh = mesh;
      }
      // the element's own edge SEGMENTS are stored flat (edgePositions) —
      // the registry merges every element's segments into ONE LineSegments
      // batch: N elements used to cost 2N draw calls (mesh + lines each);
      // the batch costs one. Picking never used the lines (screen-space
      // math against model edges), so nothing else changes.
      // edgeIds[i] is the model edge segment i belongs to — the registry
      // uses it to cull CROSS-ELEMENT SEAMS (a column-wall junction line)
      // from the batch: Revit shows element silhouettes, not joints.
      const ep = [];
      const eids = [];
      const seenSeg = new Set();
      for (const fid of this.entity.faces) {
        const f = model.faces.get(fid);
        if (!f || f.hidden) continue;
        for (const ring of model.rings(f)) {
          const pts = model.pts(ring);
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            const e2 = model.findEdge(ring[i], ring[(i + 1) % ring.length]);
            if (e2) {
              if (seenSeg.has(e2.id)) continue; // shared ring edge: one segment
              seenSeg.add(e2.id);
            }
            ep.push(a.x, a.y, a.z, b.x, b.y, b.z);
            eids.push(e2 ? e2.id : null);
          }
        }
      }
      this.edgePositions = ep;
      this.edgeIds = eids;
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
      this.edgePositions = [];
      this.edgeIds = [];
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

    /** Geometry-aware dirty signature for one entity: face ids PLUS each
     *  face's loop and hole rings (vertex ids and a coordinate checksum).
     *  Any edit — a hosted cut notching the loop, a punch adding a hole,
     *  EIP moving a ring vertex — changes it; unchanged geometry keeps the
     *  incremental fast path. */
    static faceSig(model, ent) {
      const ringSig = r => {
        let h = r.length + ':';
        for (const vid of r) {
          const p = model.vp(vid);
          h += vid + '@' + (p ? Math.round(p.x * 1e4) + ',' + Math.round(p.y * 1e4) + ',' + Math.round(p.z * 1e4) : '?') + ' ';
        }
        return h;
      };
      return ent.faces.map(fid => {
        const f = model.faces.get(fid);
        if (!f) return fid + '>gone';
        return fid + '>' + ringSig(f.loop) + '#' + f.holes.map(ringSig).join(';');
      }).join(',');
    }

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
      // touches one beam costs that beam, not the whole model. The signature
      // must cover GEOMETRY, not just face ids: hosted cuts (door/window/
      // opening) rewrite the host face's loop/holes IN PLACE, keeping the
      // same face id — an id-only signature would leave the pre-cut mesh.
      const sig = BimElementRegistry.faceSig;
      const live = new Set();
      let anyChanged = false;
      for (const ent of app.bim.entities) {
        ent.faces = ent.faces.filter(id => model.faces.has(id));
        if (!ent.faces.length) continue;
        live.add(ent.id);
        const s = sig(model, ent);
        let el = this._byId.get(ent.id);
        if (el && el._sig === s && el.group) {
          // unchanged — but hidden/lock display state must still track
          if (el.group.parent) el.group.visible = !ent.hidden;
        } else {
          if (el) el.dispose();
          el = new BimElement(ent);
          el._sig = s;
          view.elementsRoot.add(el.build(model, view.faceMat, layerColor(ent)));
          this._byId.set(ent.id, el);
          anyChanged = true;
        }
        for (const id of ent.faces) faceIds.add(id);
      }
      for (const [id, el] of [...this._byId])
        if (!live.has(id)) { el.dispose(); this._byId.delete(id); anyChanged = true; }
      // ONE merged edge batch for every visible element (v0.6 render perf:
      // was one LineSegments per element — 2N draw calls; now one total).
      // Hidden elements (or their layer off / Level View filter) drop out
      // of the batch exactly like their meshes drop out of the scene.
      this._syncEdgeBatch(view, anyChanged);
      return faceIds;
    }

    /** Rebuild the shared element-edge LineSegments when any element
     *  changed or any visibility toggle flipped. */
    _syncEdgeBatch(view, force) {
      const app = this.app, model = app.model;
      const elf = view.elementFilter || null;
      // same visibility rule render.js applies to the meshes
      const isVisible = el => {
        if (app.isEntityHidden ? app.isEntityHidden(el.entity.id) : el.entity.hidden) return false;
        return elf ? !!elf(el.entity) : true;
      };
      const visKey = [...this._byId.values()].map(el => (isVisible(el) ? '1' : '0')).join('');
      if (!force && this._edgeVisKey === visKey) return;
      this._edgeVisKey = visKey;
      // REVIT-STYLE EDGE OUTLINING — pure DISPLAY filtering (the geometry
      // kernel is untouched; every edge stays real for picking, trimming and
      // measurement, and the elements remain independent selectable objects):
      //  1) CROSS-ELEMENT SEAMS: an edge shared by faces of TWO DIFFERENT
      //     elements is a joint (column-meets-wall), never a silhouette.
      //  2) COPLANAR SUPPRESSION: an edge whose two adjacent faces have
      //     n1·n2 ≈ 1 (≈0° dihedral — same plane) is not a feature edge;
      //     Revit's outline threshold suppresses it too. This cleans the
      //     internal lines a face split leaves inside ONE element.
      const seam = new Set();
      {
        const edgeFaces = new Map(); // edgeId -> [{owner, n}]
        for (const f of model.faces.values()) {
          const owner = f.userData && f.userData.bimEntityId;
          if (!owner) continue;
          const n = G.loopNormal(model.pts(f.loop));
          if (G.isZero(n)) continue;
          for (const ring of model.rings(f)) {
            for (let i = 0; i < ring.length; i++) {
              const e2 = model.findEdge(ring[i], ring[(i + 1) % ring.length]);
              if (!e2) continue;
              let a = edgeFaces.get(e2.id);
              if (!a) edgeFaces.set(e2.id, a = []);
              if (!a.some(x => x.owner === owner && G.dot(x.n, n) > 0.9999)) a.push({ owner, n });
            }
          }
        }
        for (const [eid, faces] of edgeFaces) {
          // distinct owner elements anywhere on the edge -> joint seam
          if (new Set(faces.map(x => x.owner)).size > 1) { seam.add(eid); continue; }
          // coplanar pair across the edge: dihedral <= 1° (cos 1° = 0.99985)
          // is not a feature edge — the Revit outline threshold
          for (let i = 0; i < faces.length && !seam.has(eid); i++)
            for (let j = i + 1; j < faces.length; j++) {
              const d = G.dot(faces[i].n, faces[j].n);
              if (d > 0.99985 || d < -0.99985) { seam.add(eid); break; }
            }
        }
      }
      // 3) FLUSH-ON-FACE JUNCTIONS (the CSG-union LOOK without the boolean):
      // an edge of element A that lies ON a face of element B (within 1 mm of
      // the plane, inside the polygon — exactly where a Wall ∪ Column union
      // would leave a 0° coplanar seam) renders nothing. Elements stay
      // independent; the display matches the joined solid. Bounding-box
      // prefilter keeps this linear-ish on big models.
      const flushCache = [];
      {
        for (const el of this._byId.values()) {
          if (!el.group) continue;
          // world-space AABB from the element's own edge endpoints
          let bb = null;
          const pp = el.edgePositions;
          for (let i = 0; i + 2 < pp.length; i += 3) {
            if (!bb) bb = { x0: pp[i], y0: pp[i + 1], z0: pp[i + 2], x1: pp[i], y1: pp[i + 1], z1: pp[i + 2] };
            else {
              if (pp[i] < bb.x0) bb.x0 = pp[i]; if (pp[i] > bb.x1) bb.x1 = pp[i];
              if (pp[i + 1] < bb.y0) bb.y0 = pp[i + 1]; if (pp[i + 1] > bb.y1) bb.y1 = pp[i + 1];
              if (pp[i + 2] < bb.z0) bb.z0 = pp[i + 2]; if (pp[i + 2] > bb.z1) bb.z1 = pp[i + 2];
            }
          }
          if (!bb) continue;
          // face records with plane + 2D basis for the point-in-polygon test
          const fr = [];
          for (const fid of el.entity.faces) {
            const f = model.faces.get(fid);
            if (!f) continue;
            const pts2 = model.pts(f.loop);
            const n = G.loopNormal(pts2);
            if (G.isZero(n)) continue;
            const d = G.dot(n, pts2[0]);
            let fbb = null;
            for (const p of pts2) {
              if (!fbb) fbb = { x0: p.x, y0: p.y, z0: p.z, x1: p.x, y1: p.y, z1: p.z };
              else {
                if (p.x < fbb.x0) fbb.x0 = p.x; if (p.x > fbb.x1) fbb.x1 = p.x;
                if (p.y < fbb.y0) fbb.y0 = p.y; if (p.y > fbb.y1) fbb.y1 = p.y;
                if (p.z < fbb.z0) fbb.z0 = p.z; if (p.z > fbb.z1) fbb.z1 = p.z;
              }
            }
            fr.push({ n, d, pts: pts2, bb: fbb });
          }
          flushCache.push({ id: el.entity.id, bb, faces: fr });
        }
      }
      const onOtherFace = (mid, selfId) => {
        for (const c of flushCache) {
          if (c.id === selfId) continue;
          const b = c.bb;
          if (mid.x < b.x0 - 1e-3 || mid.x > b.x1 + 1e-3 || mid.y < b.y0 - 1e-3 || mid.y > b.y1 + 1e-3 || mid.z < b.z0 - 1e-3 || mid.z > b.z1 + 1e-3) continue;
          for (const fr of c.faces) {
            const fb = fr.bb;
            if (mid.x < fb.x0 - 1e-3 || mid.x > fb.x1 + 1e-3 || mid.y < fb.y0 - 1e-3 || mid.y > fb.y1 + 1e-3 || mid.z < fb.z0 - 1e-3 || mid.z > fb.z1 + 1e-3) continue;
            if (Math.abs(G.dot(fr.n, mid) - fr.d) > 1e-3) continue; // not flush with the plane
            // midpoint inside the face polygon (project onto the dominant plane)
            const proj = p => Math.abs(fr.n.x) > 0.9 ? { x: p.y, y: p.z } : Math.abs(fr.n.y) > 0.9 ? { x: p.x, y: p.z } : { x: p.x, y: p.y };
            const P2 = fr.pts.map(proj), M = proj(mid);
            let inside = false;
            for (let i = 0, jj = P2.length - 1; i < P2.length; jj = i++) {
              const a = P2[i], b2 = P2[jj];
              if ((a.y > M.y) !== (b2.y > M.y) && M.x < (b2.x - a.x) * (M.y - a.y) / (b2.y - a.y) + a.x) inside = !inside;
            }
            if (inside) return true;
          }
        }
        return false;
      };
      const ep = [];
      for (const el of this._byId.values()) {
        if (!el.group || !isVisible(el)) continue;
        const pos = el.edgePositions, ids = el.edgeIds;
        if (!ids) { for (let i = 0; i < pos.length; i++) ep.push(pos[i]); continue; }
        for (let s = 0; s < ids.length; s++) {
          if (seam.has(ids[s])) continue; // a joint between elements: no line
          const o = s * 6;
          const mid = G.v((pos[o] + pos[o + 3]) / 2, (pos[o + 1] + pos[o + 4]) / 2, (pos[o + 2] + pos[o + 5]) / 2);
          if (onOtherFace(mid, el.entity.id)) continue; // flush on another element's face: the union look
          ep.push(pos[o], pos[o + 1], pos[o + 2], pos[o + 3], pos[o + 4], pos[o + 5]);
        }
      }
      if (!this._edgeLines) {
        this._edgeLines = new THREE.LineSegments(
          new THREE.BufferGeometry(),
          model.__edgeMaterial || new THREE.LineBasicMaterial({ color: 0x1b1f23 }));
        view.elementsRoot.add(this._edgeLines);
      }
      this._edgeLines.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
      this._edgeLines.geometry = g;
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
      // FIXED CONVERTED ELEMENTS (Convert Faces to Element dialog): the user
      // named the element and picked a kind — the kind selects the family,
      // the NAME selects the type. A type with that name in the family is
      // REUSED (Revit-style); otherwise the catalog grows it, so converted
      // custom shapes become first-class placeable types. Custom kinds get
      // their own family under a "Custom Elements" category.
      if (p.fixed && p.name) {
        const kindFam = {
          column: 'fam_col_rect', beam: 'fam_beam_framing', wall: 'fam_wall_basic',
          slab: 'fam_slab_structural', floor: 'fam_floor_generic',
        };
        let famId = kindFam[ent.type];
        if (!famId) {
          // custom kind: family named after the kind, created on first use
          famId = 'fam_custom_' + ent.type;
          if (!this._catalog.families.some(f => f.id === famId)) {
            const catId = 'cat_custom';
            if (!this._catalog.categories.some(c => c.id === catId) && db.putCategory) {
              await db.putCategory({ id: catId, name: 'Custom Elements' });
              this._catalog.categories.push({ id: catId, name: 'Custom Elements' });
            }
            if (db.putFamily) {
              const kindName = ent.type[0].toUpperCase() + ent.type.slice(1);
              await db.putFamily({ id: famId, categoryId: catId, name: kindName });
              this._catalog.families.push({ id: famId, categoryId: catId, name: kindName });
            }
          }
        } else if (famId === 'fam_beam_framing'
          && !this._catalog.families.some(f => f.id === famId) && db.putFamily) {
          const catId = 'cat_framing';
          if (!this._catalog.categories.some(c => c.id === catId)) {
            await db.putCategory({ id: catId, name: 'Structural Framing' });
            this._catalog.categories.push({ id: catId, name: 'Structural Framing' });
          }
          await db.putFamily({ id: famId, categoryId: catId, name: 'Concrete Beam' });
          this._catalog.families.push({ id: famId, categoryId: catId, name: 'Concrete Beam' });
        }
        const known = this._catalog.types.find(x => x.familyId === famId && x.name === p.name);
        sel = known
          ? pick(null, famId, known.name, known.defaultParameters)
          : pick(null, famId, p.name, { fixed: true, profile: 'custom', material: 'Concrete' });
      } else
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
        case 'roof': {
          // the kind + pitch name the type (Revit's roof types); a custom
          // thickness/pitch grows the family the same way walls do
          const kind = p.kind === 'mono' || p.kind === 'gable' ? p.kind : 'flat';
          const t = p.thickness || 0.2;
          const name = kind === 'flat'
            ? `Flat ${Math.round(t * 1000)} mm`
            : `${kind === 'mono' ? 'Mono' : 'Gable'} ${Math.round(p.pitch != null ? p.pitch : 15)}\u00B0`;
          const known = this._catalog.types.find(x => x.familyId === 'fam_roof' && x.name === name);
          sel = known
            ? pick(null, 'fam_roof', known.name, known.defaultParameters)
            : pick(null, 'fam_roof', name, { kind, thickness: t, pitch: p.pitch != null ? p.pitch : 15, overhang: p.overhang != null ? p.overhang : 0.4, material: 'Concrete' });
          break;
        }
        case 'stairs': {
          // floor-hosted stairs: the run type + flight width + riser count
          // name the type ("Stair U 1.2 m / 17R"), so an identical stair
          // reuses the type a previous one already grew (Revit-style)
          const run = p.run === 'u' ? 'U' : 'Straight';
          const w = p.width || 1.2;
          const nR = p.nRisers || Math.max(2, Math.ceil((p.storyH || 3) / 0.19));
          const name = `Stair ${run} ${w.toFixed(1)} m / ${nR}R`;
          const known = this._catalog.types.find(x => x.familyId === 'fam_stairs' && x.name === name);
          sel = known
            ? pick(null, 'fam_stairs', known.name, known.defaultParameters)
            : pick(null, 'fam_stairs', name, {
              run: p.run === 'u' ? 'u' : 'straight', width: w,
              riser: p.riser || 0.175, tread: p.tread || 0.28, uGap: p.uGap != null ? p.uGap : 0.1,
              defaultHeight: p.storyH || 3, material: 'Concrete',
            });
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
        categoryName: { wall: 'Wall', slab: 'Slab', floor: 'Floor', door: 'Door', window: 'Window', opening: 'Opening', column: 'Column', beam: 'Beam', foundation: 'Foundation', roof: 'Roof', stairs: 'Stairs' }[ent.type] || ent.type,
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
