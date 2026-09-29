#!/usr/bin/env node
'use strict';
// ---------------------------------------------------------------------------
// extract-igz.js — one-off provenance tool: pulls the legally-usable
// components out of IngeTrazo's .igz bundles (plain zip → document.json)
// into THIS app's neutral asset JSON. An .igz group is {edges, faces:[{
// vertices:[[x,y,z]...], color:[r,g,b]?}]}; we keep the polygon faces as-is
// (absolute coords, meters, z-grounded) and normalize XY to the footprint
// center. Licenses per file are recorded in assets/components/CREDITS.md —
// the Free-Art-License trees and the author's personal artwork are NOT
// extracted, on purpose.
//
//   node tools/extract-igz.js <ingetrazo-checkout> ...
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/** Minimal zip reader: returns {name -> Buffer} for every stored/deflated
 *  entry (local headers, no archives-in-archive nonsense needed here). */
function readZip(buf) {
  const out = {};
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString();
    const data = buf.slice(i + 30 + nameLen + extraLen, i + 30 + nameLen + extraLen + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    i += 30 + nameLen + extraLen + csize;
  }
  return out;
}

const MODELS = [
  { igz: 'banco.igz', name: 'Park bench', credit: 'Kator Legaz', license: 'CC-BY-4.0' },
  { igz: 'fuente.igz', name: 'Fountain', credit: 'Pndrdm & Emmanuel Puybaret', license: 'CC-BY-4.0' },
  { igz: 'chica.igz', name: 'Standing woman', credit: 'Reallusion', license: 'CC-BY-4.0' },
  { igz: 'pickup.igz', name: 'Pickup truck', credit: 'Scopia', license: 'CC-BY-4.0' },
  { igz: 'suv.igz', name: 'SUV', credit: 'Scopia', license: 'CC-BY-4.0' },
  { igz: 'sofa.igz', name: 'Sofa', credit: 'Blend Swap', license: 'CC0-1.0' },
];

const src = process.argv[2];
if (!src) { console.error('usage: node tools/extract-igz.js <ingetrazo-checkout>'); process.exit(1); }
const outDir = path.join(__dirname, '..', 'assets', 'components');
fs.mkdirSync(outDir, { recursive: true });

for (const m of MODELS) {
  const igz = path.join(src, 'resources', 'components', m.igz);
  const doc = JSON.parse(readZip(fs.readFileSync(igz))['document.json'].toString('utf8'));
  const faces = [];
  let mn = [1e9, 1e9], mx = [-1e9, -1e9];
  for (const g of (doc.scene.groups || [])) {
    for (const f of (g.faces || [])) {
      if (!f.vertices || f.vertices.length < 3) continue;
      for (const v of f.vertices) {
        mn[0] = Math.min(mn[0], v[0]); mn[1] = Math.min(mn[1], v[1]);
        mx[0] = Math.max(mx[0], v[0]); mx[1] = Math.max(mx[1], v[1]);
      }
      faces.push({ v: f.vertices.map(p => [+p[0].toFixed(5), +p[1].toFixed(5), +p[2].toFixed(5)]), c: f.color || null });
    }
  }
  const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2;
  for (const f of faces) for (const p of f.v) { p[0] = +(p[0] - cx).toFixed(5); p[1] = +(p[1] - cy).toFixed(5); }
  const out = {
    name: m.name, credit: m.credit, license: m.license,
    source: 'Sweet Home 3D furniture library, via IngeTrazo resources/components/' + m.igz,
    faces: faces.map(f => ({ v: f.v, c: f.c ? f.c.map(x => +x.toFixed(4)) : null })),
  };
  const file = path.join(outDir, m.igz.replace('.igz', '.json'));
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(m.name.padEnd(16), faces.length.toLocaleString().padStart(6), 'faces →', path.relative(process.cwd(), file));
}
console.log('\nCREDITS.md documents every license — keep it next to the files.');
