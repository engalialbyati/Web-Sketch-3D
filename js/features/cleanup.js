'use strict';
// ---------------------------------------------------------------------------
// Feature: Clean Up (command, not a tool).
//
// Purges every wire edge — geometry attached to no face — in one undoable
// step: construction residue left by BIM operations (temporary punch rings,
// join-rebuild leftovers) plus any orphaned free-drawn lines. Precise
// Drawing operations already sweep their own residue (bimHold brackets);
// this is the belt-and-braces command for anything older files carry.
//
//   Edit ▸ Clean Up Stray Lines      command bar: clean / cleanup / purge
// ---------------------------------------------------------------------------
(function () {
  if (window.Engine) {
    Engine.features.register({
      id: 'cleanup',
      kind: 'command',
      label: 'Clean Up Stray Lines',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20l6-6M14 4l6 6M9 15l6-6"/><path d="M13 3l8 8"/></svg>',
      commands: ['clean', 'cleanup', 'purge'],
      run(app) { if (app && app.cleanupWires) app.cleanupWires(); },
    });
  }
})();
