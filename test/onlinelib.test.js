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

  test('parseMTL: Kd colors per material, missing diffuse stays null', () => {
    const mtl = OL.parseMTL('newmtl red\nKd 1 0 0\nnewmtl bare\nnewmtl blue\nKd 0 0.5 1\n');
    eq(mtl.red.length, 3, 'red parsed');
    near(mtl.red[0], 1, 1e-9, 'red r');
    eq(mtl.blue[2], 1, 'blue b');
    ok(mtl.bare === null, 'no-Kd material → null (default color)');
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
    const mtl = { red: [1, 0, 0], blue: [0, 0, 1] };
    const soup = OL.parseOBJ(obj, mtl);
    eq(soup.positions.length, 4, 'only face-used vertices (stray dropped)');
    eq(soup.triangles.length, 4, '1 + 2 + 1 triangles (degenerate skipped)');
    eq(soup.triAttrs.filter(a => a.color === '#ff0000').length, 3, 'red group');
    eq(soup.triAttrs.filter(a => a.color === '#0000ff').length, 1, 'blue group');
    // negative-index face == first tri → welded to same remapped ids
    eq(soup.triangles[3].join(','), soup.triangles[0].join(','), 'negative indices resolve');
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
