'use strict';
// ---------------------------------------------------------------------------
// ifc-import.js — phase 1: IFC as REFERENCE.
//
// Parses an .ifc file with web-ifc (WASM, loaded from CDN on first use so
// the app stays fully functional offline) and lands the building as
// category-colored meshes in TRUE WORLD POSITION, overlaying the user's
// model. Nothing enters the B-Rep kernel: no undo snapshots, no autosave,
// no element claims — an imported IFC is a tracing reference you can hide
// or remove as a whole.
//
//   IfcImport.load(file)      → Promise<{id, counts, meshes}>   (File/Blob)
//   IfcImport.toggle(id)      → show/hide one import
//   IfcImport.remove(id)      → dispose one import
//   IfcImport.removeAll()     → dispose every import
//   IfcImport.list()          → [{id, name, counts, hidden}]
//
// Phase 2 (element mapping: IFCWALL → wall entities, storeys → levels)
// builds on the same parse — the geometry loop already resolves categories.
// ---------------------------------------------------------------------------
(function (root) {
  const CDN = 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.66/';
  let apiPromise = null;

  // one shared IfcAPI for the session; the wasm is fetched once
  function api() {
    if (!apiPromise) {
      apiPromise = (async () => {
        const WebIFC = await import(CDN + 'web-ifc-api.js');
        const ifcApi = new WebIFC.IfcAPI();
        ifcApi.SetWasmPath(CDN, false); // per-instance in recent web-ifc
        await ifcApi.Init();
        return { WebIFC, ifcApi };
      })();
    }
    return apiPromise;
  }

  // category palette mirrors the app's own element colors where they exist
  const CAT = {
    wall: 0xb7a98a, wallstandardcase: 0xb7a98a, curtainwall: 0x9fb4c7,
    column: 0x6fa877, beam: 0xc98a3d, slab: 0x9aa3ab, roof: 0x77685f,
    stair: 0x5aa8a0, stairflight: 0x5aa8a0, ramp: 0x5aa8a0,
    door: 0x3e66c4, window: 0x7fa3e0, covering: 0x8d6e9e,
    railing: 0x8d6e9e, furniture: 0xb0876f, plate: 0xa8a29a,
    member: 0xa8a29a, pile: 0x8a8f94, footing: 0x8a8f94,
  };
  const DEFAULT_COLOR = 0xc9c4bb;

  const imports = new Map(); // id -> {id, name, object, counts, hidden}
  let nextId = 1;

  function categoryOf(WebIFC, ifcApi, modelID, expressID) {
    try {
      const t = ifcApi.GetLineType(modelID, expressID);
      // WebIFC exports IFC entity ids as UPPER_SNAKE constants
      const names = Object.keys(WebIFC).filter(k => /^[A-Z0-9_]+$/.test(k) && WebIFC[k] === t);
      for (const n of names) {
        const key = n.replace(/^IFC/, '').toLowerCase();
        if (CAT[key] != null) return { key, color: CAT[key] };
      }
      return { key: names[0] ? names[0].replace(/^IFC/, '').toLowerCase() : 'other', color: DEFAULT_COLOR };
    } catch (e) { return { key: 'other', color: DEFAULT_COLOR }; }
  }

  // Stream the tessellated meshes of an ALREADY-OPEN web-ifc model into the
  // scene as reference geometry. Phase 2 shares this: expressIDs it converted
  // to kernel elements arrive in `skipIds` and stay meshes-out (no doubles).
  // `maxProducts` caps how many products become meshes — a hospital's 16k
  // mullions/plates next to fresh elements tip the renderer over; the rest
  // are counted and reported, not silently dropped.
  async function addMeshesFromOpenModel(modelID, name, skipIds, maxProducts = Infinity) {
    const A = root.app || window.app;
    const view = A && A.view;
    if (!view) throw new Error('viewport not ready');
    const { WebIFC, ifcApi } = await api();
    const skip = skipIds instanceof Set ? skipIds : new Set(skipIds || []);
    const group = new THREE.Group();
    group.name = 'ifc-import';
    const counts = {}; // category -> element count
    const matCache = new Map(); // color -> material (one per category)
    const material = color => {
      if (!matCache.has(color))
        matCache.set(color, new THREE.MeshLambertMaterial({ color }));
      return matCache.get(color);
    };
    let made = 0, skippedProducts = 0;
    const quota = isFinite(maxProducts) ? 250 : Infinity; // diversity, not plate soup
    ifcApi.StreamAllMeshes(modelID, mesh => {
      if (skip.has(mesh.expressID)) return;
      const cat = categoryOf(WebIFC, ifcApi, modelID, mesh.expressID);
      if (made >= maxProducts || (counts[cat.key] || 0) >= quota) { skippedProducts++; return; }
      made++;
      counts[cat.key] = (counts[cat.key] || 0) + 1;
      const geos = mesh.geometries;
      for (let i = 0; i < geos.size(); i++) {
        const placed = geos.get(i);
        const g = ifcApi.GetGeometry(modelID, placed.geometryExpressID);
        let pos, nor, idx;
        try {
          const v = ifcApi.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
          idx = ifcApi.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize()).slice();
          if (v && v.position) {
            // {position, normal} shape (some builds)
            pos = v.position.slice(); nor = v.normal.slice();
          } else {
            // raw interleaved [x,y,z, nx,ny,nz] typed array (0.0.66)
            const f = new Float32Array(v.buffer ? v : v.slice ? v : []);
            const n = f.length / 6;
            pos = new Float32Array(n * 3);
            nor = new Float32Array(n * 3);
            for (let k = 0; k < n; k++) {
              pos[k * 3] = f[k * 6]; pos[k * 3 + 1] = f[k * 6 + 1]; pos[k * 3 + 2] = f[k * 6 + 2];
              nor[k * 3] = f[k * 6 + 3]; nor[k * 3 + 1] = f[k * 6 + 4]; nor[k * 3 + 2] = f[k * 6 + 5];
            }
          }
        } finally { g.delete(); }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        const m = new THREE.Mesh(geo, material(cat.color));
        m.applyMatrix4(new THREE.Matrix4().fromArray(placed.flatTransformation));
        m.userData.expressID = mesh.expressID;
        m.castShadow = false; m.receiveShadow = true; // reference: quiet in the scene
        group.add(m);
      }
    });
    const id = 'ifc_' + nextId++;
    imports.set(id, {
      id, name: name || 'import.ifc', object: group, counts, hidden: false, skippedProducts,
      dispose() {
        for (const m of matCache.values()) m.dispose();
        group.traverse(ch => { if (ch.geometry) ch.geometry.dispose(); });
        if (group.parent) group.parent.remove(group);
      },
    });
    view.scene.add(group);
    view.invalidate();
    return imports.get(id);
  }

  async function load(file) {
    const { ifcApi } = await api();
    const buf = new Uint8Array(await file.arrayBuffer());
    const modelID = ifcApi.OpenModel(buf, { COORDINATE_TO_ORIGIN: true });
    try {
      return await addMeshesFromOpenModel(modelID, file.name);
    } finally {
      ifcApi.CloseModel(modelID);
    }
  }

  function toggle(id) {
    const r = imports.get(id);
    if (!r) return;
    r.hidden = !r.hidden;
    r.object.visible = !r.hidden;
    if (root.app && root.app.view) root.app.view.invalidate();
    return r.hidden;
  }

  function remove(id) {
    const r = imports.get(id);
    if (!r) return false;
    r.dispose();
    imports.delete(id);
    if (root.app && root.app.view) root.app.view.invalidate();
    return true;
  }

  function removeAll() { for (const id of [...imports.keys()]) remove(id); }
  function list() { return [...imports.values()].map(r => ({ id: r.id, name: r.name, counts: r.counts, hidden: r.hidden })); }

  root.IfcImport = { load, addMeshesFromOpenModel, toggle, remove, removeAll, list, api, _api: api };
})(window);
