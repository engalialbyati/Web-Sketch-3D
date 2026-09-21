'use strict';
// CLI test runner: node test/run.js  (or: npm test)
// Reports a single pass/fail summary. A test file may export an async
// function (e.g. database tests over the in-memory adapter) — its promise is
// awaited before the file's counters are read.
const path = require('node:path');
const harness = require('./harness');

// explicit suite manifest — no dynamic require over directory listings
const SUITE = [
  'assets', 'beamface', 'beamcontinuous', 'offsets', 'shapes', 'acirules', 'wallrebar', 'beamoverwall', 'bridge', 'building5', 'buildingr5',
  'centerline', 'columnfamilies', 'columnrot', 'columntool', 'db',
  'draw', 'engine', 'flooropen', 'geometry', 'gridcells', 'gridwall',
  'edgeoffset', 'rebar', 'columnrebar', 'elementrebar', 'beamconn', 'wallopening', 'multiface', 'faceorient', 'lineheal', 'looseface', 'edgesel', 'nestface', 'thicken', 'hostedcuts', 'ifcexport', 'annotate', 'room', 'deletebatch', 'independence', 'layers', 'linestyle', 'mirrorarray',
  'model', 'revitmethod', 'script', 'selectmode', 'slabtop', 'stairs',
  'structural', 'trim', 'wallbottom', 'wallface', 'walljoin', 'wallstub',
];

(async () => {
  console.log('WebSketch 3D — model & geometry unit tests\n');
  const files = [];
  for (const name of SUITE) {
    try { require.resolve(path.join(__dirname, name + '.test.js')); files.push(name + '.test.js'); }
    catch (e) { /* not present on this checkout — skip */ }
  }
  if (!files.length) { console.error('no test files found'); process.exit(1); }

  let pass = 0, fail = 0;
  for (const f of files) {
    const countersBefore = counters();
    const exported = require(path.join(__dirname, f))(harness);
    if (exported && typeof exported.then === 'function') await exported;
    const { pass: p, fail: fl } = delta(countersBefore);
    console.log(`\n${f}: ${p} passed, ${fl} failed\n`);
    pass += p; fail += fl;
  }

  console.log('─'.repeat(50));
  console.log(`total: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

function counters() { return { p: harness._stats.pass, f: harness._stats.fail }; }
function delta(before) { return { pass: harness._stats.pass - before.p, fail: harness._stats.fail - before.f }; }
