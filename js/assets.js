'use strict';
// ---------------------------------------------------------------------------
// assets.js — AssetManager: downloaded BlenderKit models as scene instances.
//
// The palette (BlenderKitBrowser) searches and imports; THIS module owns the
// result. Every placed model becomes a registered instance under one scene
// root, so imported assets can be:
//
//   selected  — view.pickAssetAt raycasts the instance groups; app.selAssets
//               is the selection set (the grid-line selection pattern)
//   moved     — free objects drag in plan (axis locks + grid snap); hosted
//               doors/windows slide along their wall and the opening follows
//   hosted    — an instance defined as door/window cuts a real opening via
//               HostedCut and re-cuts whenever its wall rebuilds
//   persisted — instance list rides model.serialize() (key `assets`), so
//               autosave, project files, undo and redo all carry them; the
//               GLB itself is re-fetched from the bridge's disk cache
//
// Instances stay FOREIGN: no kernel faces, no bimEntities (a face-less entity
// would be auto-detached by opDone). The wall rebuild loop is the only kernel
// bookkeeping — see recutHosted.
// ---------------------------------------------------------------------------
(function () {
  const MAX_SIZE_M = 5; // same normalization ceiling as the palette

  // glTF texture/images can arrive broken in embedded webviews: some WebP
  // files decode through createImageBitmap into solid black, some exporters
  // write all-zero COLOR_0 attributes that multiply the diffuse to black.
  // Both are detectable (a real photo never averages RGB < 4) and healable
  // before the model ever reaches the scene.
  function healMaterials(root) {
    const seen = new Set();
    root.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.map && m.map.image && !seen.has(m.map)) {
          seen.add(m.map);
          if (imageIsBlack(m.map.image)) {
            m.map = null;
            m.color = m.color || new THREE.Color();
            m.color.setHex(0x9aa0a6);
            if (m.metalness != null) m.metalness = Math.min(m.metalness, 0.3);
            m.needsUpdate = true;
          }
        }
        if (m && m.vertexColors && o.geometry && o.geometry.attributes.color && colorsAreBlack(o.geometry.attributes.color)) {
          m.vertexColors = false; // zero vertex colors would blacken the diffuse
          m.needsUpdate = true;
        }
      }
    });
  }
  function imageIsBlack(img) {
    try {
      const c = document.createElement('canvas');
      c.width = 16; c.height = 16;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; }
      const n = d.length / 4;
      return (r + g + b) / (3 * n) < 4 && a / n > 250; // black AND opaque
    } catch (e) { return false; }
  }
  function colorsAreBlack(attr) {
    const a = attr.array;
    for (let i = 0; i < a.length; i++) if (a[i] > 1 / 255) return false;
    return true;
  }

  class AssetManager {
    constructor(app) {
      this.app = app;
      this.instances = new Map();   // id -> instance record
      this.nextId = 1;
      this.templates = new Map();   // assetId -> {scene, size} parsed + healed, cloned per instance
      this._root = null;
      this._gltfLoader = null;
      this._envTex = null;
    }

    // ------------------------------------------------------------- scene root
    ensureRoot() {
      if (this._root) return this._root;
      this._root = this.app.view.scene.getObjectByName('blenderkit-assets') || new THREE.Group();
      this._root.name = 'blenderkit-assets';
      this.app.view.scene.add(this._root);
      this.app.view.assetsRoot = this._root;
      return this._root;
    }

    // ------------------------------------------------------------ gltf parse
    // DRACOLoader (vendored decoder at js/lib/draco/) is mandatory — every
    // BlenderKit GLB is Draco-compressed. createImageBitmap is hidden for the
    // parse because some embedded webviews decode its WebP textures to solid
    // black while the HTMLImage path decodes the same files correctly; the
    // parser picks its texture loader synchronously at parse() entry.
    parseGltf(buf) {
      if (!this._gltfLoader) {
        this._gltfLoader = new THREE.GLTFLoader();
        if (THREE.DRACOLoader) {
          const draco = new THREE.DRACOLoader();
          draco.setDecoderPath('js/lib/draco/');
          this._gltfLoader.setDRACOLoader(draco);
        }
      }
      const cib = window.createImageBitmap;
      try {
        window.createImageBitmap = undefined;
        const p = new Promise((ok, bad) => this._gltfLoader.parse(buf, '', ok, bad));
        return p.finally(() => { window.createImageBitmap = cib; });
      } catch (e) {
        window.createImageBitmap = cib;
        return Promise.reject(e);
      }
    }

    // Parse a GLB buffer into the shared healed template (wrap Y-up -> Z-up,
    // shadow flags, material healing, measured size).
    async _templateFromBuffer(assetId, name, buf) {
      const gltf = await this.parseGltf(buf);
      const inner = new THREE.Group();
      inner.rotation.x = Math.PI / 2; // glTF Y-up -> viewport Z-up
      inner.add(gltf.scene);
      const outer = new THREE.Group();
      outer.add(inner);
      outer.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      healMaterials(outer);
      const box = new THREE.Box3().setFromObject(outer);
      const size = box.isEmpty() ? { x: 1, y: 1, z: 1 } : box.getSize(new THREE.Vector3());
      return { scene: outer, size: { x: size.x, y: size.y, z: size.z } };
    }

    // Local-file GLB cache (IndexedDB): File ▸ Open .blend… results live
    // here so instances survive reloads — the bridge has no copy of user
    // files to re-fetch. Separate tiny DB; never touches the Bim catalog.
    _blobDb() {
      if (this._blobDbP) return this._blobDbP;
      this._blobDbP = new Promise((resolve, reject) => {
        const rq = indexedDB.open('ws3d-assets', 1);
        rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains('glb')) rq.result.createObjectStore('glb'); };
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error || new Error('indexedDB unavailable'));
      });
      return this._blobDbP;
    }
    async _blobPut(key, buf) {
      try {
        const db = await this._blobDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('glb', 'readwrite');
          tx.objectStore('glb').put(buf, key);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } catch (e) { /* cache is best-effort — the live instance is what matters */ }
    }
    async _blobGet(key) {
      try {
        const db = await this._blobDb();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction('glb', 'readonly');
          const rq = tx.objectStore('glb').get(key);
          rq.onsuccess = () => resolve(rq.result || null);
          rq.onerror = () => reject(rq.error);
        });
      } catch (e) { return null; }
    }

    // Shared, healed template per assetId. `file_*` ids (local .blend opens)
    // resolve from the IndexedDB blob cache first — the bridge cannot
    // re-serve user files.
    async loadTemplate(assetId, name) {
      if (this.templates.has(assetId)) return this.templates.get(assetId);
      const p = (async () => {
        if (assetId.startsWith('file_')) {
          const cached = await this._blobGet(assetId);
          if (cached) return this._templateFromBuffer(assetId, name, cached);
        }
        const bridge = (window.BLENDERKIT_BRIDGE_URL || 'http://localhost:3001').replace(/\/$/, '');
        const url = `${bridge}/api/convert?id=${encodeURIComponent(assetId)}&name=${encodeURIComponent(name || '')}`;
        const res = await fetch(url);
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error((j && j.error) || `bridge HTTP ${res.status}`);
        }
        return this._templateFromBuffer(assetId, name, await res.arrayBuffer());
      })();
      this.templates.set(assetId, p);
      p.catch(() => this.templates.delete(assetId)); // a failed fetch may succeed later
      return p;
    }

    // File ▸ Open .blend… — the app already converted the upload to GLB;
    // this registers it as an instance with everything that brings
    // (select/move/define-as/persist) and caches the GLB for reloads.
    async placeGlbBuffer(buf, name) {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const assetId = 'file_' + [...new Uint8Array(digest)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
      await this._blobPut(assetId, buf);
      if (!this.templates.has(assetId)) {
        const p = this._templateFromBuffer(assetId, name, buf);
        this.templates.set(assetId, p);
        p.catch(() => this.templates.delete(assetId));
      }
      const tpl = await this.loadTemplate(assetId, name);
      return this.placeFree(assetId, name || 'Model', tpl, { x: 0, y: 0, z: 0 });
    }

    // BlenderKit materials lean on PBR (metalness up to 1); with nothing to
    // reflect they render solid black, so instances get a generated studio
    // environment. Scoped to imported materials only.
    applyStudioEnv(root) {
      if (!this._envTex) {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 128; // tiny: only broad gradients survive PMREM
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, c.height);
        grad.addColorStop(0, '#e8f0ff');
        grad.addColorStop(0.5, '#ffffff');
        grad.addColorStop(1, '#aeb6c0');
        g.fillStyle = grad;
        g.fillRect(0, 0, c.width, c.height);
        const tex = new THREE.CanvasTexture(c);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem = new THREE.PMREMGenerator(this.app.view.renderer);
        this._envTex = pmrem.fromEquirectangular(tex).texture;
        pmrem.dispose();
        tex.dispose();
      }
      const env = this._envTex;
      root.traverse(o => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m && m.isMeshStandardMaterial && !m.envMap) {
            m.envMap = env;
            m.envMapIntensity = 0.85;
            m.needsUpdate = true;
          }
        }
      });
    }

    // -------------------------------------------------------------- instances
    // Wrap a template clone + register it. `xform` is applied verbatim (used
    // by restore); callers normally use placeFree/placeHosted instead.
    _instantiate(assetId, name, kind, template, id) {
      const object = template.scene.clone(true);
      object.name = 'blenderkit:' + assetId;
      const rec = {
        id: id || ('asset_' + (this.nextId++)),
        assetId, name: name || 'Asset', kind: kind || 'object',
        object, scale: 1, size: template.size,
        host: null, // { wallId, distance, sill, width, height, depth } for door/window
      };
      object.userData.blenderkit = { id: rec.id, assetId, name: rec.name };
      this.instances.set(rec.id, rec);
      this.ensureRoot().add(object);
      return rec;
    }

    // Free-standing object on the ground (the palette's classic drop).
    placeFree(assetId, name, template, point) {
      const rec = this._instantiate(assetId, name, 'object', template);
      const s = rec.size;
      let scale = 1;
      if (Math.max(s.x, s.y, s.z) > MAX_SIZE_M) scale = MAX_SIZE_M / Math.max(s.x, s.y, s.z);
      rec.scale = scale;
      rec.object.scale.setScalar(scale);
      rec.object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rec.object);
      const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      const p = point || { x: 0, y: 0, z: 0 };
      rec.object.position.set(p.x - c.x, p.y - c.y, p.z - box.min.z);
      this.applyStudioEnv(rec.object);
      this.changed('placed', rec);
      return rec;
    }

    // Hosted door/window: the kernel opening is cut by the caller (the tool,
    // or recutHosted on wall rebuilds); this positions the model in it.
    // `info` is HostedCut.cut's result: {center, into, dir, rect, depth}.
    placeHosted(assetId, name, template, host, info) {
      const rec = this._instantiate(assetId, name, host.kindHint || 'door', template);
      rec.host = { ...host };
      this.applyHostedTransform(rec, info);
      this.applyStudioEnv(rec.object);
      this.changed('placed', rec);
      return rec;
    }

    // Pure transform math — also the reposition path for wall rebuilds and
    // slide drags. Uniform fit inside the opening (no distortion), centered
    // on the wall's mid-plane and the opening's height center.
    applyHostedTransform(rec, info) {
      const s = rec.size;
      const fit = Math.min(
        rec.host.width > 1e-6 ? rec.host.width / s.x : Infinity,
        rec.host.height > 1e-6 ? rec.host.height / s.z : Infinity,
      );
      const scale = isFinite(fit) && fit > 0 ? fit : 1;
      rec.scale = scale;
      rec.object.scale.setScalar(scale);
      rec.object.rotation.set(0, 0, Math.atan2(info.dir.y, info.dir.x));
      // template bbox in its own (identity) frame — clone shares it
      const box = new THREE.Box3().setFromObject(rec.object);
      const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      const target = new THREE.Vector3()
        .copy(info.center)
        .addScaledVector(new THREE.Vector3(info.into.x, info.into.y, 0), (info.depth || 0) / 2);
      target.z = info.rect[0].z + rec.host.height / 2;
      rec.object.position.set(target.x - c.x, target.y - c.y, target.z - c.z);
      rec.object.updateMatrixWorld(true);
    }

    // Re-cut + reposition every asset hosted on a wall — called from
    // rebuildWallWithHosts after the wall's own faces (and hosted entities)
    // are rebuilt. Must run inside the caller's transaction.
    recutHosted(wallId, model) {
      const G = window.G, HostedCut = window.BimTools && window.BimTools.HostedCut;
      if (!G || !HostedCut) return;
      const ent = this.app.bim.getEntityById(wallId);
      if (!ent || ent.type !== 'wall') return;
      for (const rec of this.instances.values()) {
        if (!rec.host || rec.host.wallId !== wallId) continue;
        const spec = {
          distanceFromStart: rec.host.distance, width: rec.host.width,
          height: rec.host.height, sillHeight: rec.host.sill,
          depth: rec.host.depth > 0 ? rec.host.depth : ent.params.thickness,
        };
        const info = HostedCut.cut(G, model, ent.params, spec);
        if (info.error) continue; // wall too short now — keep the model where it was
        this.applyHostedTransform(rec, info);
      }
    }

    // Remove an instance; hosted ones heal their wall (rebuild re-cuts every
    // OTHER hosted element, so the opening closes itself).
    remove(id, opts = {}) {
      const rec = this.instances.get(id);
      if (!rec) return false;
      const host = rec.host;
      this.instances.delete(id);
      if (rec.object.parent) rec.object.parent.remove(rec.object);
      this._dispose(rec.object);
      this.changed('removed', rec);
      if (host && host.wallId && opts.heal !== false) {
        const wall = this.app.bim.getEntityById(host.wallId);
        if (wall) this.app.bim.rebuildWallWithHosts(host.wallId);
      }
      return true;
    }
    clear() { for (const id of [...this.instances.keys()]) this.remove(id, { heal: false }); }

    // Instances whose host wall no longer exists die with it (like hosted
    // doors) — checked after every commit.
    checkOrphans() {
      const dead = [];
      for (const rec of this.instances.values())
        if (rec.host && rec.host.wallId && !this.app.bim.getEntityById(rec.host.wallId)) dead.push(rec);
      for (const rec of dead) this.remove(rec.id, { heal: false });
      return dead.length;
    }
    instancesFor(wallId) {
      return [...this.instances.values()].filter(r => r.host && r.host.wallId === wallId);
    }
    get(id) { return this.instances.get(id) || null; }
    list() { return [...this.instances.values()]; }

    _dispose(obj) {
      obj.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of mats) {
          for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose();
          m.dispose();
        }
      });
    }

    changed(kind, rec) {
      if (window.Engine) Engine.events.emit('assets:changed', { kind, id: rec && rec.id, name: rec && rec.name });
      if (this.app && this.app.assetsChanged) this.app.assetsChanged();
    }

    // ----------------------------------------------------------- persistence
    // Compact records; hosted position is NOT stored — it is a pure function
    // of the wall params + host spec, recomputed on restore/rebuild.
    serialize() {
      return this.list().map(r => {
        const o = {
          i: r.id, a: r.assetId, n: r.name, k: r.kind,
          p: [r.object.position.x, r.object.position.y, r.object.position.z],
          r: r.object.rotation.z || 0, s: r.scale,
        };
        if (r.host) o.h = {
          w: r.host.wallId, d: r.host.distance, si: r.host.sill,
          W: r.host.width, H: r.host.height, D: r.host.depth || 0,
        };
        return o;
      });
    }
    // Diff-sync THREE groups against a serialized list: add missing (async
    // GLB fetch from the bridge cache), drop extras, reapply transforms.
    // Kernel openings for hosted assets already exist in the restored faces —
    // only the transform is recomputed here.
    async restore(list) {
      list = Array.isArray(list) ? list : [];
      const want = new Map(list.map(x => [x.i, x]));
      for (const id of [...this.instances.keys()])
        if (!want.has(id)) this.remove(id, { heal: false });
      let maxN = 0;
      for (const x of list) {
        const m = /^asset_(\d+)$/.exec(x.i);
        if (m) maxN = Math.max(maxN, +m[1]);
        let rec = this.instances.get(x.i);
        if (!rec) {
          let tpl;
          try { tpl = await this.loadTemplate(x.a, x.n); }
          catch (e) { this._addPlaceholder(x); continue; } // bridge offline / cache gone
          rec = this._instantiate(x.a, x.n, x.k, tpl, x.i);
          this.applyStudioEnv(rec.object);
        }
        if (x.h) {
          rec.host = {
            wallId: x.h.w, distance: x.h.d, sill: x.h.si,
            width: x.h.W, height: x.h.H, depth: x.h.D,
          };
          const ent = this.app.bim.getEntityById(x.h.w);
          if (ent && window.BimTools) {
            const info = window.BimTools.HostedCut.locate(window.G, ent.params, {
              distanceFromStart: x.h.d, width: x.h.W, height: x.h.H, sillHeight: x.h.si,
            });
            if (!info.error) { this.applyHostedTransform(rec, info); continue; }
          }
        }
        rec.scale = x.s || 1;
        rec.object.scale.setScalar(rec.scale);
        rec.object.rotation.set(0, 0, x.r || 0);
        rec.object.position.set(x.p[0], x.p[1], x.p[2]);
        rec.object.updateMatrixWorld(true);
      }
      this.nextId = Math.max(this.nextId, maxN + 1);
      this.changed('restored', null);
    }
    // Never silently lose an instance: a wireframe box keeps its slot visible
    // until the bridge can serve the file again.
    _addPlaceholder(x) {
      const s = 1;
      const geo = new THREE.BoxGeometry(s, s, s);
      const mat = new THREE.MeshBasicMaterial({ color: 0x8a929a, wireframe: true });
      const obj = new THREE.Mesh(geo, mat);
      obj.name = 'blenderkit-missing:' + x.a;
      const rec = {
        id: x.i, assetId: x.a, name: (x.n || 'Asset') + ' (offline)', kind: x.k || 'object',
        object: obj, scale: x.s || 1, size: { x: s, y: s, z: s },
        host: x.h ? { wallId: x.h.w, distance: x.h.d, sill: x.h.si, width: x.h.W, height: x.h.H, depth: x.h.D } : null,
        placeholder: true,
      };
      rec.object.userData.blenderkit = { id: rec.id, assetId: rec.a, name: rec.name };
      this.instances.set(rec.id, rec);
      this.ensureRoot().add(obj);
    }
  }

  window.AssetManager = AssetManager;
})();
