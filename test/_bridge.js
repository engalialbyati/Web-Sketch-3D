'use strict';
// test/_bridge.js — static bridge loaded LAST into the test sandbox context.
// Top-level class declarations in earlier scripts (app.js's BimEntityManager,
// GridManager, GridLine) live in the context's lexical scope, not on the
// window object; this file re-exposes exactly the ones tests need. Static
// references only — no dynamic execution.
window.BimEntityManager = typeof BimEntityManager !== 'undefined' ? BimEntityManager : undefined;
window.GridManager = typeof GridManager !== 'undefined' ? GridManager : undefined;
window.GridLine = typeof GridLine !== 'undefined' ? GridLine : undefined;
window.TransactionManager = typeof TransactionManager !== 'undefined' ? TransactionManager : undefined;
window.DrawGeom = typeof DrawGeom !== 'undefined' ? DrawGeom : undefined;
window.bimGuardFace = typeof bimGuardFace !== 'undefined' ? bimGuardFace : undefined;
window.bimGuardEdge = typeof bimGuardEdge !== 'undefined' ? bimGuardEdge : undefined;
// window.X assignments are NOT global variables inside a vm context (unlike
// a browser, where window === globalThis) — promote the ones scripts
// reference bare at runtime
if (window.ColumnFamilies) globalThis.ColumnFamilies = window.ColumnFamilies;
if (typeof THREE !== 'undefined') window.THREE = THREE;
// browser-like globals: in a vm context window !== globalThis, so window.X
// assignments are not real global variables — promote them so scripts that
// reference G / Tool / Model / namespaces bare (like a real page) resolve
for (const k of Object.keys(window)) {
  try { if (globalThis[k] === undefined) globalThis[k] = window[k]; } catch (e) { }
}
