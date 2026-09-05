'use strict';
// CLI test runner: node test/run.js  (or: npm test)
// Loads every test/*.test.js and reports a single pass/fail summary.
// A test file may export an async function (e.g. database tests over the
// in-memory adapter) — its promise is awaited before the file's counters
// are read.
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./harness');

(async () => {
  console.log('WebSketch 3D — model & geometry unit tests\n');
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
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
