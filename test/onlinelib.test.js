'use strict';
// Online Component Library — the pure core: MTL/OBJ parsing (quads, slashed
// tokens, negative indices, stray vertices), the catalogue transform
// (rotate → fit to declared cm → meters → stand up → ground/center), the
// license filter, and the zip reader (stored entries; deflate needs the
// browser's DecompressionStream and is exercised there).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const { window: w } = loadModel(['js/features/onlinelib.js']);
  const OL = w.OnlineLib;

  const bbox = P => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of P) {
      lo[0] = Math.min(lo[0], p.x); hi[0] = Math.max(hi[0], p.x);
      lo[1] = Math.min(lo[1], p.y); hi[1] = Math.max(hi[1], p.y);
      lo[2] = Math.min(lo[2], p.z); hi[2] = Math.max(hi[2], p.z);
    }
    return { lo, hi };
  };

  test('parseMTL: Kd + map_Kd per material, options and quotes stripped', () => {
    const mtl = OL.parseMTL([
      'newmtl wood',
      'Kd 0.8 0.6 0.4',
      'map_Kd -s 1 1 1 ./textures/wood_diffuse.png',
      'newmtl bare',
      'newmtl quoted',
      'map_Kd "C:\\materials\\fabric.jpg"',
      'newmtl blue',
      'Kd 0 0.5 1',
    ].join('\n'));
    eq(mtl.wood.kd.length, 3, 'wood Kd parsed');
    near(mtl.wood.kd[0], 0.8, 1e-9, 'wood r');
    eq(mtl.wood.map, 'textures/wood_diffuse.png', 'map file is the LAST token, ./ stripped');
    ok(mtl.bare.kd === null && mtl.bare.map === null, 'no-Kd no-map material stays empty');
    eq(mtl.quoted.map, 'C:/materials/fabric.jpg', 'quotes + windows slashes normalized');
    eq(mtl.blue.kd[2], 1, 'blue b');
    ok(mtl.blue.map === null, 'color-only material has no map');
  });

  test('parseOBJ: quads, slashed tokens, negative indices, usemtl colors, strays dropped', () => {
    const obj = [
      'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
      'v 9 9 9',           // stray — no face references it
      'usemtl red',
      'f 1 2 3',           // tri
      'f 1/1 2/2 3/3 4/4', // quad with v/vt tokens → two tris
      'usemtl blue',
      'f -5 -4 -3',        // negative indices → same tri as the first
      'f 2 2 3',           // degenerate — skipped
    ].join('\n');
    const mtl = { red: { kd: [1, 0, 0], map: null }, blue: { kd: [0, 0, 1], map: null } };
    const soup = OL.parseOBJ(obj, mtl);
    eq(soup.positions.length, 4, 'only face-used vertices (stray dropped)');
    eq(soup.triangles.length, 4, '1 + 2 + 1 triangles (degenerate skipped)');
    eq(soup.triAttrs.filter(a => a.color === '#ff0000').length, 3, 'red group');
    eq(soup.triAttrs.filter(a => a.color === '#0000ff').length, 1, 'blue group');
    // negative-index face == first tri → welded to same remapped ids
    eq(soup.triangles[3].join(','), soup.triangles[0].join(','), 'negative indices resolve');
    // material bookkeeping for the foreign (textured) path
    eq(soup.mtls.length, 2, 'two materials registered');
    eq(soup.mtls[0].name, 'red', 'first material name');
    eq(soup.mtls[0].color, '#ff0000', 'material flat color');
    ok(soup.matOf.every(mi => mi === 0 || mi === 1), 'every triangle tagged with its material');
  });

  test('parseOBJ: vt UVs captured per corner, faces without vt get nulls', () => {
    const obj = [
      'v 0 0 0', 'v 1 0 0', 'v 1 1 0',
      'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0.5 0.25',
      'usemtl tex1',
      'f 1/1 2/2 3/3',      // fully UV'd tri
      'f 1 2 3',            // same tri, no UVs → null corners
      'usemtl tex2',
      'f 1/4 2/-3 3/2',     // negative vt index resolves
    ].join('\n');
    const soup = OL.parseOBJ(obj, { tex1: { kd: null, map: 'a.png' }, tex2: { kd: [1, 1, 1], map: 'b.png' } });
    eq(soup.triUvs.length, 3, 'one UV triple per triangle');
    eq(soup.triUvs[0].map(q => q.u + ',' + q.v).join(' '), '0,0 1,0 1,1', 'v/vt corners carry uv');
    ok(soup.triUvs[1].every(q => q === null), 'no-vt face → null corners');
    near(soup.triUvs[2][0].u, 0.5, 1e-9, 'negative vt index resolved (u)');
    near(soup.triUvs[2][0].v, 0.25, 1e-9, 'negative vt index resolved (v)');
    eq(soup.mtls[0].mapName, 'a.png', 'map file carried on the material');
    eq(soup.matOf[0], 0, 'first tri uses tex1');
    eq(soup.matOf[2], 1, 'last tri uses tex2');
  });

  // ------------------------------- foreign rendering: flat fallback + textures
  const L3 = loadModel(['js/lib/three.min.js', 'js/features/onlinelib.js', 'js/features/components.js']);
  const CF = L3.window.ComponentsFeature;

  test('foreignObject: no materials → the flat vertex-colored mesh (back-compat)', () => {
    const soup = { positions: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
      triangles: [[0, 1, 2]], triAttrs: [{ color: '#ff0000', alpha: 1 }] };
    const grp = CF.foreignObject(soup);
    eq(grp.children.length, 1, 'single mesh');
    const mesh = grp.children[0];
    ok(mesh.geometry.attributes.color, 'vertex colors present');
    ok(!mesh.material.map, 'no texture');
    ok(mesh.material.vertexColors, 'vertexColors material');
  });

  test('foreignObject: textured soup → one mesh per material with UVs', () => {
    const P = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
    const soup = {
      positions: P,
      triangles: [[0, 1, 2], [0, 2, 3], [0, 1, 2]],
      triAttrs: [{ color: null, alpha: 1 }, { color: '#00ff00', alpha: 1 }, { color: null, alpha: 1 }],
      mtls: [{ name: 'wood', color: '#8a6a3f', mapName: 'wood.png', tex: { isTexture: true } },
             { name: 'plain', color: '#2020c0', mapName: null, tex: null }],
      matOf: [0, 1, 0],
      triUvs: [[{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }],
               [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }],
               [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }]],
    };
    const grp = CF.foreignObject(soup);
    eq(grp.children.length, 2, 'one mesh per material');
    const meshes = grp.children.slice().sort((a, b) => a.material.map ? -1 : 1);
    ok(meshes[0].material.map, 'textured mesh carries the map');
    ok(meshes[0].geometry.attributes.uv, 'textured mesh has UVs');
    eq(meshes[0].material.color.getHexString(), 'ffffff', 'textured base is white (image carries the look)');
    eq(meshes[0].geometry.attributes.position.count, 6, 'wood group holds both its triangles');
    ok(!meshes[1].material.map, 'untextured material stays flat');
    eq(meshes[1].material.color.getHexString(), '2020c0', 'flat material uses its Kd color');
    eq(meshes[1].geometry.attributes.position.count, 3, 'plain group holds its one triangle');
  });

  test('foreignObject: texture with NO face UVs → planar projection drapes it', () => {
    // scopia/Sweet-Home OBJs carry vt lines their faces never reference —
    // the triangle projects into its group bbox instead of staying flat
    const soup = {
      positions: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }],
      triangles: [[0, 1, 2], [0, 2, 3]], triAttrs: [{ color: null, alpha: 1 }, { color: null, alpha: 1 }],
      mtls: [{ name: 'tex', color: null, mapName: 'x.png', tex: { isTexture: true } }],
      matOf: [0, 0], triUvs: [[null, null, null], [null, null, null]],
    };
    const grp = CF.foreignObject(soup);
    eq(grp.children.length, 1, 'one material group');
    const mesh = grp.children[0];
    ok(mesh.material.map, 'textured despite missing UVs');
    ok(mesh.geometry.attributes.uv, 'UVs generated');
    const uv = mesh.geometry.attributes.uv;
    // first corner of tri 0 is the group bbox min → (0,0); tri 1 spans to (1,1)
    near(uv.getX(0), 0, 1e-9, 'projected u at bbox min');
    near(uv.getY(0), 0, 1e-9, 'projected v at bbox min');
    near(uv.getX(4), 1, 1e-9, 'top corner maps to bbox max (u)');
    near(uv.getY(4), 1, 1e-9, 'top corner maps to bbox max (v)');
  });

  test('foreignObject: mixed UVs — explicit corners kept, missing ones projected', () => {
    const soup = {
      positions: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }],
      triangles: [[0, 1, 2], [0, 1, 2]], triAttrs: [{ color: null, alpha: 1 }, { color: null, alpha: 1 }],
      mtls: [{ name: 'tex', color: null, mapName: 'x.png', tex: { isTexture: true } }],
      matOf: [0, 0],
      triUvs: [[{ u: 0.1, v: 0.2 }, { u: 0.3, v: 0.4 }, { u: 0.5, v: 0.6 }], [null, null, null]],
    };
    const mesh = CF.foreignObject(soup).children[0];
    const uv = mesh.geometry.attributes.uv;
    near(uv.getX(0), 0.1, 1e-6, 'explicit tri keeps its u'); // float32 storage
    near(uv.getY(2), 0.6, 1e-6, 'explicit tri keeps its v');
    near(uv.getX(3), 0, 1e-9, 'projected tri starts at bbox min');
    near(uv.getX(5), 1, 1e-9, 'projected tri reaches bbox max');
  });

  test('texFromBytes: null where the runtime cannot build images (headless)', () => {
    ok(OL.texFromBytes(new Uint8Array([1, 2, 3])) === null, 'vm has no Image → null, no throw');
  });

  test('zipFind: exact path, then basename fallback', () => {
    const files = new Map([['model.obj', 'o'], ['textures/wood.png', 'w'], ['readme.txt', 'r']]);
    eq(Buffer.from(OL.zipFind(files, 'textures/wood.png')).toString(), 'w', 'exact path');
    eq(Buffer.from(OL.zipFind(files, './wood.png')).toString(), 'w', './ prefix stripped');
    eq(Buffer.from(OL.zipFind(files, 'WOOD.PNG')).toString(), 'w', 'case-insensitive basename match');
    ok(OL.zipFind(files, 'missing.png') === null, 'absent file → null');
    ok(OL.zipFind(files, null) === null, 'no name → null');
  });

  test('transformSoup: fit to declared cm, meters, Z-up, grounded, centered', () => {
    const cube = [];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) cube.push({ x, y, z });
    const soup = OL.transformSoup({ cm: ['100', '50', '200'] }, { positions: cube, triangles: [], triAttrs: [] });
    const b = bbox(soup.positions);
    near(b.hi[0] - b.lo[0], 1.0, 1e-9, 'width 100 cm → 1 m');
    near(b.hi[1] - b.lo[1], 0.5, 1e-9, 'depth 50 cm → 0.5 m (file y-depth → app y)');
    near(b.hi[2] - b.lo[2], 2.0, 1e-9, 'height 200 cm → 2 m (file y-height → app z)');
    near(b.lo[2], 0, 1e-9, 'grounded at z=0');
    near(b.lo[0] + b.hi[0], 0, 1e-9, 'XY centered (x)');
    // the file's up face (y=1) is the app's top: max z = 2.0
    near(b.hi[2], 2.0, 1e-9, 'file +y becomes app +z');
  });

  test('transformSoup: catalogue rotation applied, declared size still honored', () => {
    const cube = [];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) cube.push({ x, y, z });
    // their Y_UP_TO_Z_UP as the catalogue rotation: file (x,y,z) → (x,−z,y)
    const entry = { cm: ['100', '50', '200'], rot: ['1', '0', '0', '0', '0', '-1', '0', '1', '0'] };
    const soup = OL.transformSoup(entry, { positions: cube, triangles: [], triAttrs: [] });
    const b = bbox(soup.positions);
    near(b.hi[0] - b.lo[0], 1.0, 1e-9, 'width still 1 m after rotation+fit');
    near(b.hi[1] - b.lo[1], 0.5, 1e-9, 'depth still 0.5 m');
    near(b.hi[2] - b.lo[2], 2.0, 1e-9, 'height still 2 m');
    near(b.lo[2], 0, 1e-9, 'still grounded');
  });

  test('filterUsable: CC BY and CC0 kept, Free Art License and id-less dropped', () => {
    const models = [
      { id: 'a', licencia: 'CC-BY-4.0' },
      { id: 'b', licencia: 'CC0-1.0' },
      { id: 'c', licencia: 'LAL-1.3' },
      { licencia: 'CC-BY-4.0' }, // no id
      { id: 'd', licencia: 'GPL-3.0' },
    ];
    eq(OL.filterUsable(models).map(m => m.id).join(','), 'a,b', 'only the two usable');
  });

  test('catEn: the catalogue’s Spanish categories translate to English', () => {
    eq(OL.catEn('Cocina'), 'Kitchen', 'kitchen');
    eq(OL.catEn('Cuarto de Baño'), 'Bathroom', 'bathroom');
    eq(OL.catEn('Puertas y Ventanas'), 'Doors & Windows', 'doors and windows');
    eq(OL.catEn('Something New'), 'Something New', 'unknown passes through');
    eq(Object.keys(OL.CAT_EN).length, 12, 'all twelve catalogue categories covered');
  });

  test('hostedSpec: the model’s border sizes the opening, clamped and rounded', () => {
    const door = OL.hostedSpec('door', { x: 0.951, y: 0.08, z: 2.049 });
    eq(door.width, 0.95, 'width cm-rounded from bbox x');
    eq(door.height, 2.05, 'height cm-rounded from bbox z');
    eq(door.sill, 0, 'door sits on the floor');
    const win = OL.hostedSpec('window', { x: 1.2, y: 0.1, z: 1.4 });
    near(win.sill, 0.9, 1e-9, 'window default sill 0.9');
    eq(win.height, 1.4, 'window height from bbox');
    const huge = OL.hostedSpec('door', { x: 9, y: 1, z: 12 });
    eq(huge.width, 5, 'width clamped to 5 m');
    eq(huge.height, 5, 'height clamped to 5 m');
    const tiny = OL.hostedSpec('door', { x: 0.01, y: 0.01, z: 0.01 });
    eq(tiny.width, 0.3, 'width floored at 0.3 m');
    eq(tiny.height, 0.3, 'height floored at 0.3 m');
  });

  // ---------------------------------------------------------------- zip reader
  /** A minimal STORED-mode zip builder (no compression → no DecompressionStream). */
  function storedZip(entries) {
    const chunks = [], central = [];
    let off = 0;
    for (const [name, content] of entries) {
      const n = Buffer.from(name, 'binary'), c = Buffer.from(content, 'binary');
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
      lh.writeUInt16LE(0, 8); lh.writeUInt32LE(0, 14);
      lh.writeUInt32LE(c.length, 18); lh.writeUInt32LE(c.length, 22);
      lh.writeUInt16LE(n.length, 26); lh.writeUInt16LE(0, 28);
      chunks.push(lh, n, c);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(0, 10); ch.writeUInt32LE(c.length, 20); ch.writeUInt32LE(c.length, 24);
      ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
      central.push(Buffer.concat([ch, n]));
      off += 30 + n.length + c.length;
    }
    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
    return new Uint8Array(Buffer.concat([...chunks, cd, eocd]));
  }

  test('zipRead: stored entries parsed with names and bytes intact', async () => {
    const zip = storedZip([
      ['model.obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'],
      ['LICENSE.txt', 'CC0 1.0'],
    ]);
    const files = await OL.zipRead(zip);
    eq(files.size, 2, 'both entries');
    ok(files.has('model.obj') && files.has('LICENSE.txt'), 'names decoded');
    eq(Buffer.from(files.get('LICENSE.txt')).toString(), 'CC0 1.0', 'content intact');
    const objText = Buffer.from(files.get('model.obj')).toString();
    ok(/f 1 2 3/.test(objText), 'obj content intact');
  });

  test('zipRead: rejects a non-zip buffer', async () => {
    let threw = false;
    try { await OL.zipRead(new Uint8Array([1, 2, 3, 4])); } catch (e) { threw = true; }
    ok(threw, 'not-a-zip throws');
  });
};
