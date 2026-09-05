'use strict';
// ---------------------------------------------------------------------------
// db.js — the persistent relational storage layer for the BIM hierarchy.
//
// Schema (Revit-style catalog + instance elements):
//   categories { id, name }                       Wall, Floor, Slab, Window, Door, Foundation, …
//   families   { id, categoryId, name }           "Basic Wall", "Fixed Glass Window", …
//   types      { id, familyId, name,
//                defaultParameters }              JSON: { thickness, defaultHeight, material, … }
//   elements   { id, typeId, levelId,
//                transformMatrix,                 16-number row-major (identity while the
//                                                  B-Rep stores world-space geometry)
//                parameters,                      JSON instance parameters + quantities
//                brepData,                        JSON B-Rep: { v, e, c, f, roles }
//                name, createdAt, updatedAt }
//
// Stores are indexed relationally (families.categoryId, types.familyId,
// elements.typeId, elements.levelId) so queryElementsByCategory() is a real
// three-hop join, not a scan.
//
// Storage adapters: IndexedDB in the browser (no libraries — the app runs from
// file://), an in-memory Map store everywhere else (Node tests, or a browser
// where IndexedDB is blocked). Both implement the same async table interface,
// so BimDatabase logic is identical and unit-testable headlessly.
// ---------------------------------------------------------------------------
(function (root) {

  const STORES = ['categories', 'families', 'types', 'elements', 'grids'];
  const DB_NAME = 'websketch-bim';
  // v2 adds the `grids` store — the GridSystem schema (GridLine.js):
  //   { id, name, s:[x,y], e:[x,y], m:[x,y]|0, curved:0|1, bbl, ve:[min,max] }
  // Grids live synchronously on the model for snapping/undo; this store is
  // the durable relational copy, mirrored by GridManager.syncToDb().
  const DB_VERSION = 2;
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  // ------------------------------------------------------------ adapters
  class MemoryStore {
    constructor() { this.t = {}; for (const s of STORES) this.t[s] = new Map(); }
    async get(s, k) { return this.t[s].get(k) || null; }
    async getAll(s, index, key) {
      if (index == null) return [...this.t[s].values()];
      return [...this.t[s].values()].filter(r => r[index] === key);
    }
    async put(s, v) { this.t[s].set(v.id, v); return v; }
    async delete(s, k) { this.t[s].delete(k); }
    async clear(s) { this.t[s].clear(); }
    async count(s) { return this.t[s].size; }
    close() { }
  }

  class IdbStore {
    constructor(idb) { this.idb = idb; }
    _req(r) {
      return new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    async get(s, k) { return this._req(this.idb.transaction(s).objectStore(s).get(k)); }
    async getAll(s, index, key) {
      const st = this.idb.transaction(s).objectStore(s);
      const src = index ? st.index(index) : st;
      const rows = await this._req(src.getAll(key));
      return rows || [];
    }
    async put(s, v) { return this._req(this.idb.transaction(s, 'readwrite').objectStore(s).put(v)); }
    async delete(s, k) { return this._req(this.idb.transaction(s, 'readwrite').objectStore(s).delete(k)); }
    async clear(s) { return this._req(this.idb.transaction(s, 'readwrite').objectStore(s).clear()); }
    async count(s) { return this._req(this.idb.transaction(s).objectStore(s).count()); }
    close() { try { this.idb.close(); } catch (e) { } }
  }

  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (db.objectStoreNames.contains(s)) continue;
          const os = db.createObjectStore(s, { keyPath: 'id' });
          if (s === 'families') os.createIndex('categoryId', 'categoryId', { unique: false });
          if (s === 'types') os.createIndex('familyId', 'familyId', { unique: false });
          if (s === 'elements') {
            os.createIndex('typeId', 'typeId', { unique: false });
            os.createIndex('levelId', 'levelId', { unique: false });
          }
          if (s === 'grids') os.createIndex('name', 'name', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  // ------------------------------------------------------------- catalog seed
  // The default project catalog. Ids are stable strings so records reference
  // them across sessions; dynamically created types use generated ids.
  const SEED = {
    categories: [
      { id: 'cat_wall', name: 'Wall' },
      { id: 'cat_floor', name: 'Floor' },
      { id: 'cat_slab', name: 'Slab' },
      { id: 'cat_window', name: 'Window' },
      { id: 'cat_door', name: 'Door' },
      { id: 'cat_foundation', name: 'Foundation' },
      { id: 'cat_column', name: 'Column' },
    ],
    families: [
      { id: 'fam_wall_basic', categoryId: 'cat_wall', name: 'Basic Wall' },
      { id: 'fam_wall_interior', categoryId: 'cat_wall', name: 'Basic Interior Wall' },
      { id: 'fam_wall_brick', categoryId: 'cat_wall', name: 'Exterior Brick Wall' },
      { id: 'fam_wall_opening', categoryId: 'cat_wall', name: 'Wall Opening' },
      { id: 'fam_floor_generic', categoryId: 'cat_floor', name: 'Generic Floor' },
      { id: 'fam_slab_structural', categoryId: 'cat_slab', name: 'Structural Slab' },
      { id: 'fam_window_fixed', categoryId: 'cat_window', name: 'Fixed Glass Window' },
      { id: 'fam_window_cased', categoryId: 'cat_window', name: 'Cased Window' },
      { id: 'fam_door_single', categoryId: 'cat_door', name: 'Single Flush Door' },
      { id: 'fam_door_double', categoryId: 'cat_door', name: 'Double Flush Door' },
      { id: 'fam_fnd_strip', categoryId: 'cat_foundation', name: 'Strip Footing' },
      { id: 'fam_fnd_grade', categoryId: 'cat_foundation', name: 'Slab on Grade' },
      { id: 'fam_col_rect', categoryId: 'cat_column', name: 'Rectangular Column' },
    ],
    types: [
      { id: 'typ_wall_050', familyId: 'fam_wall_basic', name: 'Curtain Wall — 50 mm', defaultParameters: { thickness: 0.05, defaultHeight: 3.0, material: 'Glass' } },
      { id: 'typ_wall_100', familyId: 'fam_wall_basic', name: 'Generic — 100 mm', defaultParameters: { thickness: 0.10, defaultHeight: 3.0, material: 'Concrete' } },
      { id: 'typ_wall_125', familyId: 'fam_wall_basic', name: 'Generic — 125 mm', defaultParameters: { thickness: 0.125, defaultHeight: 3.0, material: 'Concrete' } },
      { id: 'typ_wall_150', familyId: 'fam_wall_basic', name: 'Generic — 150 mm', defaultParameters: { thickness: 0.15, defaultHeight: 3.0, material: 'Concrete' } },
      { id: 'typ_wall_200', familyId: 'fam_wall_basic', name: 'Generic — 200 mm', defaultParameters: { thickness: 0.20, defaultHeight: 3.0, material: 'Concrete' } },
      { id: 'typ_wall_250', familyId: 'fam_wall_basic', name: 'Generic — 250 mm', defaultParameters: { thickness: 0.25, defaultHeight: 3.0, material: 'Concrete' } },
      { id: 'typ_wall_300', familyId: 'fam_wall_basic', name: 'Generic — 300 mm', defaultParameters: { thickness: 0.30, defaultHeight: 3.0, material: 'Concrete' } },
      { id: 'typ_wall_400', familyId: 'fam_wall_brick', name: 'Brick — 400 mm', defaultParameters: { thickness: 0.40, defaultHeight: 3.0, material: 'Brick' } },
      { id: 'typ_walli_100', familyId: 'fam_wall_interior', name: 'Interior Partition — 100 mm', defaultParameters: { thickness: 0.10, defaultHeight: 2.7, material: 'Gypsum' } },
      { id: 'typ_walli_150', familyId: 'fam_wall_interior', name: 'Interior Partition — 150 mm', defaultParameters: { thickness: 0.15, defaultHeight: 2.7, material: 'Gypsum' } },
      { id: 'typ_opening_void', familyId: 'fam_wall_opening', name: 'Rectangular Cut', defaultParameters: { width: 1.0, height: 2.1, sill: 0.0 } },
      { id: 'typ_floor_200', familyId: 'fam_floor_generic', name: 'Finish Floor — 200 mm', defaultParameters: { thickness: 0.20, defaultHeight: 0.2, material: 'Concrete' } },
      { id: 'typ_slab_250', familyId: 'fam_slab_structural', name: 'Structural — 250 mm', defaultParameters: { thickness: 0.25, defaultHeight: 0.25, material: 'Concrete' } },
      { id: 'typ_win_1220x1525', familyId: 'fam_window_fixed', name: 'Fixed 1220 x 1525', defaultParameters: { width: 1.2, height: 1.5, sill: 0.9, defaultHeight: 1.5, material: 'Glass' } },
      { id: 'typ_win_0915x1220', familyId: 'fam_window_fixed', name: 'Fixed 0915 x 1220', defaultParameters: { width: 0.915, height: 1.22, sill: 0.9, defaultHeight: 1.22, material: 'Glass' } },
      { id: 'typ_winc_1220x1525', familyId: 'fam_window_cased', name: 'Cased 1220 x 1525', defaultParameters: { width: 1.2, height: 1.5, sill: 0.9, defaultHeight: 1.5, material: 'Wood' } },
      { id: 'typ_door_0915x2134', familyId: 'fam_door_single', name: '0915 x 2134', defaultParameters: { width: 0.9, height: 2.1, sill: 0, defaultHeight: 2.1, material: 'Wood' } },
      { id: 'typ_door_1830x2134', familyId: 'fam_door_double', name: '1830 x 2134', defaultParameters: { width: 1.8, height: 2.1, sill: 0, defaultHeight: 2.1, material: 'Wood' } },
      { id: 'typ_fnd_600x300', familyId: 'fam_fnd_strip', name: 'Strip 600 x 300', defaultParameters: { thickness: 0.3, defaultHeight: 0.3, width: 0.6, material: 'Concrete' } },
      { id: 'typ_fnd_grade150', familyId: 'fam_fnd_grade', name: 'Slab on Grade — 150 mm', defaultParameters: { thickness: 0.15, defaultHeight: 0.15, material: 'Concrete' } },
      { id: 'typ_col_300x300', familyId: 'fam_col_rect', name: 'Column 300 x 300', defaultParameters: { width: 0.3, depth: 0.3, defaultHeight: 3.0, material: 'Concrete' } },
    ],
  };

  // ------------------------------------------------------------ the database
  class BimDatabase {
    constructor(store) {
      this.store = store;
      this.persistent = !(store instanceof MemoryStore);
      this._autoType = 0;
    }

    /** Browser entry: IndexedDB when available, memory otherwise. */
    static async open() {
      if (typeof indexedDB !== 'undefined') {
        try {
          const idb = await openIdb();
          return new BimDatabase(new IdbStore(idb));
        } catch (e) {
          console.warn('[db] IndexedDB unavailable, using in-memory store:', e && e.message);
        }
      }
      return new BimDatabase(new MemoryStore());
    }
    /** Headless entry for tests / Node. */
    static withMemory() { return Promise.resolve(new BimDatabase(new MemoryStore())); }

    close() { this.store.close(); }

    // ------------------------------------------------------ catalog CRUD
    async seedDefaults(force = false) {
      const n = await this.store.count('categories');
      if (n > 0 && !force) return false;
      if (force) {
        for (const s of ['categories', 'families', 'types']) await this.store.clear(s);
      }
      for (const c of SEED.categories) await this.store.put('categories', { ...c });
      for (const f of SEED.families) await this.store.put('families', { ...f });
      for (const t of SEED.types) await this.store.put('types', { ...t });
      return true;
    }
    async putCategory(rec) { return this.store.put('categories', { ...rec }); }
    async putFamily(rec) { return this.store.put('families', { ...rec }); }
    async putType(rec) { return this.store.put('types', { ...rec }); }
    /** Find or create a type in a family by exact name (dynamic type catalog). */
    async ensureType(familyId, name, defaultParameters) {
      const sibs = await this.store.getAll('types', 'familyId', familyId);
      let t = sibs.find(x => x.name === name);
      if (t) return t;
      t = { id: 'typ_dyn_' + (++this._autoType) + '_' + Date.now().toString(36), familyId, name, defaultParameters: defaultParameters || {} };
      return this.store.put('types', t);
    }
    async getType(id) { return this.store.get('types', id); }
    async getFamily(id) { return this.store.get('families', id); }
    async getCategory(id) { return this.store.get('categories', id); }

    /** The whole catalog, tree-ready: { categories, families, types }. */
    async getCatalog() {
      const [categories, families, types] = await Promise.all([
        this.store.getAll('categories'),
        this.store.getAll('families'),
        this.store.getAll('types'),
      ]);
      const byId = (arr) => arr.sort((a, b) => a.id < b.id ? -1 : 1);
      return { categories: byId(categories), families: byId(families), types: byId(types) };
    }

    // ------------------------------------------------------ element CRUD
    /**
     * Create (or update — upsert) an element record.
     * rec: { id?, typeId, levelId?, transformMatrix?, parameters?, brepData?, name? }
     */
    async createElement(rec) {
      if (!rec || !rec.typeId) throw new Error('createElement: typeId is required');
      const prev = rec.id ? await this.store.get('elements', rec.id) : null;
      const now = Date.now();
      const row = {
        id: rec.id || ('el_' + now.toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36)),
        typeId: rec.typeId,
        levelId: rec.levelId || null,
        transformMatrix: rec.transformMatrix || IDENTITY,
        parameters: rec.parameters || {},
        brepData: rec.brepData || null,
        name: rec.name || null,
        createdAt: prev ? prev.createdAt : now,
        updatedAt: now,
      };
      await this.store.put('elements', row);
      return row;
    }
    /** Update an element's geometry (and optionally transform/params). */
    async updateElementGeometry(id, { brepData, transformMatrix, parameters } = {}) {
      const prev = await this.store.get('elements', id);
      if (!prev) throw new Error('updateElementGeometry: no element ' + id);
      const row = {
        ...prev,
        brepData: brepData != null ? brepData : prev.brepData,
        transformMatrix: transformMatrix || prev.transformMatrix,
        parameters: parameters != null ? { ...prev.parameters, ...parameters } : prev.parameters,
        updatedAt: Date.now(),
      };
      await this.store.put('elements', row);
      return row;
    }
    /** Merge updated instance parameters into an element. */
    async updateElementParameters(id, parameters) {
      const prev = await this.store.get('elements', id);
      if (!prev) throw new Error('updateElementParameters: no element ' + id);
      const row = { ...prev, parameters: { ...prev.parameters, ...(parameters || {}) }, updatedAt: Date.now() };
      await this.store.put('elements', row);
      return row;
    }
    async deleteElement(id) { return this.store.delete('elements', id); }
    async getElement(id) { return this.store.get('elements', id); }
    async getAllElements() { return this.store.getAll('elements'); }

    /**
     * Relational join elements ➔ types ➔ families ➔ categories, filtered by
     * category (id or name, case-insensitive). Returns
     * { category, elements: [{ ...element, type, family }] }.
     */
    async queryElementsByCategory(categoryIdOrName) {
      if (categoryIdOrName == null) throw new Error('queryElementsByCategory: category required');
      const cats = await this.store.getAll('categories');
      const key = String(categoryIdOrName);
      const cat = cats.find(c => c.id === key) ||
        cats.find(c => c.name.toLowerCase() === key.toLowerCase());
      if (!cat) return { category: null, elements: [] };
      const fams = await this.store.getAll('families', 'categoryId', cat.id);
      const out = [];
      for (const fam of fams) {
        const types = await this.store.getAll('types', 'familyId', fam.id);
        for (const ty of types) {
          const els = await this.store.getAll('elements', 'typeId', ty.id);
          for (const el of els) out.push({ ...el, type: ty, family: fam });
        }
      }
      out.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
      return { category: cat, elements: out };
    }

    /** Full replace (model load / new project): clear + bulk insert. */
    async replaceAllElements(list) {
      await this.store.clear('elements');
      for (const rec of (list || [])) await this.createElement(rec);
    }
    async countElements() { return this.store.count('elements'); }

    // ------------------------------------------------------ GridSystem CRUD
    // The durable copy of the model's GridLine set. Records are validated by
    // DB.validateGrid (GridLine.js schema gate) — never trust raw input here.
    async putGrid(rec) { return this.store.put('grids', rec); }
    async getGrid(id) { return this.store.get('grids', id); }
    async getAllGrids() { return this.store.getAll('grids'); }
    async deleteGrid(id) { return this.store.delete('grids', id); }
    /** Mirror the live grid set: upsert every record, delete absent rows. */
    async replaceGrids(records) {
      const live = new Set();
      for (const rec of (records || [])) { await this.store.put('grids', rec); live.add(rec.id); }
      for (const row of await this.store.getAll('grids'))
        if (!live.has(row.id)) await this.store.delete('grids', row.id);
      return live.size;
    }
  }

  BimDatabase.IDENTITY = IDENTITY;
  BimDatabase.MemoryStore = MemoryStore;
  BimDatabase.IdbStore = IdbStore;
  root.BimDatabase = BimDatabase;
})(typeof window !== 'undefined' ? window : globalThis);
