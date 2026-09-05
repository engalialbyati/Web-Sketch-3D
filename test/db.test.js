'use strict';
// ---------------------------------------------------------------------------
// db.test.js — the relational storage layer (js/db.js), headless via the
// in-memory adapter. Covers: schema seeding, catalog shape, element CRUD
// (createElement / updateElementGeometry / deleteElement), and the
// queryElementsByCategory join (elements ➔ types ➔ families ➔ categories).
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDb() {
  const sandbox = { window: {}, console };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'db.js'), 'utf8'), ctx, { filename: 'js/db.js' });
  if (!sandbox.window.BimDatabase) throw new Error('db.js did not export BimDatabase');
  return sandbox.window.BimDatabase;
}

module.exports = async h => {
  const { ok, eq, near, _stats } = h;
  const BimDatabase = loadDb();

  // async-aware test helper driving the shared counters (run.js awaits this module)
  const t = async (name, fn) => {
    try { await fn(); _stats.pass++; console.log(`  ok   ${name}`); }
    catch (e) { _stats.fail++; console.log(`  FAIL ${name}\n         ${e.message}`); }
  };

  const fresh = async () => {
    const db = new BimDatabase(new BimDatabase.MemoryStore());
    await db.seedDefaults();
    return db;
  };

  await t('seedDefaults populates categories, families, types', async () => {
    const db = new BimDatabase(new BimDatabase.MemoryStore());
    const seeded = await db.seedDefaults();
    ok(seeded, 'first seed reports true');
    const cat = await db.getCatalog();
    ok(cat.categories.length >= 7, `categories seeded (${cat.categories.length})`);
    ok(cat.families.length >= 10, 'families seeded');
    ok(cat.types.length >= 15, 'types seeded');
    const names = cat.categories.map(c => c.name);
    for (const req of ['Wall', 'Floor', 'Slab', 'Window', 'Door', 'Foundation'])
      ok(names.includes(req), `required category "${req}" present`);
    // seeding is idempotent
    const again = await db.seedDefaults();
    ok(!again, 'second seed is a no-op');
  });

  await t('catalog referential integrity: family->category, type->family', async () => {
    const db = await fresh();
    const { categories, families, types } = await db.getCatalog();
    const catIds = new Set(categories.map(c => c.id));
    const famIds = new Set(families.map(f => f.id));
    for (const f of families) ok(catIds.has(f.categoryId), `family ${f.id} references a real category`);
    for (const ty of types) ok(famIds.has(ty.familyId), `type ${ty.id} references a real family`);
    const t200 = types.find(x => x.id === 'typ_wall_200');
    ok(t200, 'typ_wall_200 seeded');
    near(t200.defaultParameters.thickness, 0.20, 1e-9, 'type defaultParameters survive the roundtrip');
  });

  await t('createElement stores a full element row with defaults', async () => {
    const db = await fresh();
    const el = await db.createElement({
      typeId: 'typ_wall_200', levelId: 'lvl_1',
      parameters: { height: 3 }, brepData: { v: [[1, 0, 0, 0]], e: [], f: [] },
    });
    ok(el.id, 'generated an id');
    ok(Array.isArray(el.transformMatrix) && el.transformMatrix.length === 16, 'identity 4x4 transform stored');
    near(el.transformMatrix[0], 1, 1e-12);
    near(el.transformMatrix[15], 1, 1e-12);
    const got = await db.getElement(el.id);
    eq(got.typeId, 'typ_wall_200');
    eq(got.levelId, 'lvl_1');
    eq(got.parameters.height, 3);
    ok(got.brepData && got.brepData.v.length === 1, 'brep_data stored');
    let rejected = false;
    try { await db.createElement({}); } catch (e) { rejected = true; }
    ok(rejected, 'createElement without typeId rejects');
    await db.deleteElement(el.id);
  });

  await t('updateElementGeometry replaces the B-Rep and merges parameters', async () => {
    const db = await fresh();
    const el = await db.createElement({ id: 'wall_9', typeId: 'typ_wall_150', brepData: { v: [], f: 1 } });
    const upd = await db.updateElementGeometry('wall_9', {
      brepData: { v: [], f: 2 },
      parameters: { quantities: { faces: 6, area: 12.5 } },
    });
    eq(upd.brepData.f, 2, 'geometry replaced');
    eq(upd.parameters.quantities.faces, 6, 'parameters merged in');
    eq(upd.createdAt, el.createdAt, 'createdAt preserved');
    ok(upd.updatedAt >= el.updatedAt, 'updatedAt bumped');
    let rejected = false;
    try { await db.updateElementGeometry('nope', {}); } catch (e) { rejected = true; }
    ok(rejected, 'updateElementGeometry on unknown id rejects');
  });

  await t('updateElementParameters merges without touching geometry', async () => {
    const db = await fresh();
    await db.createElement({ id: 'slab_1', typeId: 'typ_slab_250', parameters: { thickness: 0.25 }, brepData: { f: 1 } });
    const row = await db.updateElementParameters('slab_1', { thickness: 0.3, note: 'thickened' });
    eq(row.parameters.thickness, 0.3);
    eq(row.parameters.note, 'thickened');
    eq(row.brepData.f, 1, 'brep untouched');
  });

  await t('queryElementsByCategory joins elements -> types -> families -> categories', async () => {
    const db = await fresh();
    await db.createElement({ id: 'w1', typeId: 'typ_wall_200', brepData: { f: 1 } });
    await db.createElement({ id: 'w2', typeId: 'typ_wall_100', brepData: { f: 1 } });
    await db.createElement({ id: 'win1', typeId: 'typ_win_1220x1525', brepData: { f: 1 } });
    await db.createElement({ id: 'd1', typeId: 'typ_door_0915x2134', brepData: { f: 1 } });

    const byName = await db.queryElementsByCategory('wall'); // case-insensitive name
    eq(byName.category.id, 'cat_wall');
    eq(byName.elements.length, 2, 'both wall elements found');
    for (const el of byName.elements) {
      eq(el.family.id, 'fam_wall_basic');
      eq(el.type.familyId, 'fam_wall_basic');
      ok(el.type.name.includes('mm'), 'type row joined in');
    }
    const ids = byName.elements.map(e => e.id).sort();
    eq(ids.join(','), 'w1,w2');

    const byId = await db.queryElementsByCategory('cat_window');
    eq(byId.elements.length, 1);
    eq(byId.elements[0].id, 'win1');

    const none = await db.queryElementsByCategory('Nope');
    eq(none.category, null, 'unknown category resolves to null');
    eq(none.elements.length, 0);
  });

  await t('deleteElement removes the row', async () => {
    const db = await fresh();
    await db.createElement({ id: 'x1', typeId: 'typ_wall_200' });
    await db.deleteElement('x1');
    eq(await db.getElement('x1'), null);
    eq(await db.countElements(), 0);
  });

  await t('ensureType creates once and dedupes by name', async () => {
    const db = await fresh();
    const a = await db.ensureType('fam_wall_basic', 'Custom — 350 mm', { thickness: 0.35 });
    const b = await db.ensureType('fam_wall_basic', 'Custom — 350 mm', { thickness: 0.35 });
    eq(a.id, b.id, 'same type returned on the second ensure');
    const { types } = await db.getCatalog();
    eq(types.filter(t => t.name === 'Custom — 350 mm').length, 1, 'no duplicate rows');
    const el = await db.createElement({ typeId: a.id });
    const q = await db.queryElementsByCategory('Wall');
    ok(q.elements.some(e => e.id === el.id), 'dynamic type joins into its category');
  });

  await t('replaceAllElements swaps the whole element set', async () => {
    const db = await fresh();
    await db.createElement({ id: 'old1', typeId: 'typ_wall_200' });
    await db.replaceAllElements([
      { id: 'n1', typeId: 'typ_wall_100', brepData: { f: 1 } },
      { id: 'n2', typeId: 'typ_door_0915x2134' },
    ]);
    eq(await db.countElements(), 2);
    eq(await db.getElement('old1'), null, 'stale row removed');
    ok(await db.getElement('n1'), 'new row present');
    const walls = await db.queryElementsByCategory('cat_wall');
    eq(walls.elements.length, 1);
    eq(walls.elements[0].id, 'n1');
  });

  await t('seedDefaults(force) resets the catalog', async () => {
    const db = await fresh();
    await db.putType({ id: 'typ_junk', familyId: 'fam_wall_basic', name: 'Junk', defaultParameters: {} });
    let { types } = await db.getCatalog();
    ok(types.some(t => t.id === 'typ_junk'));
    await db.seedDefaults(true);
    ({ types } = await db.getCatalog());
    ok(!types.some(t => t.id === 'typ_junk'), 'force seed clears junk types');
  });
};
