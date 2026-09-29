'use strict';
// ---------------------------------------------------------------------------
// Feature: Solid Tools — SketchUp's six solid operations (commands).
//
//   Union / Subtract / Trim / Intersect / Split / Outer Shell
//
// Run on two SOLID GROUPS (watertight — the Make Full check): the result is
// a fresh group of fixed geometry. Selection order decides who cuts whom
// for Subtract/Trim: the LAST-picked group is the cutter. The context menu
// on a solid group names the target explicitly.
//
//   Tools ▸ Solid Tools      command bar: union / subtract / trim /
//                            intersect / split / shell
// ---------------------------------------------------------------------------
(function () {
  if (!window.Engine) return;

  const DEFS = [
    { id: 'solid-union', label: 'Union (Solids)', commands: ['union'], op: 'union',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>' },
    { id: 'solid-subtract', label: 'Subtract (Solids)', commands: ['subtract', 'difference'], op: 'subtract',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6" stroke-dasharray="2 2"/></svg>' },
    { id: 'solid-trim', label: 'Trim (Solids)', commands: ['trim'], op: 'trim',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="12" r="6"/><path d="M9 2v20" stroke-dasharray="2 2"/></svg>' },
    { id: 'solid-intersect', label: 'Intersect (Solids)', commands: ['intersect', 'intersection'], op: 'intersect',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3a9 9 0 000 18zM12 3a9 9 0 010 18z" fill="currentColor" stroke="none" opacity=".25"/><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>' },
    { id: 'solid-split', label: 'Split (Solids)', commands: ['split'], op: 'split',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/><path d="M12 6v12" stroke-dasharray="2 2"/></svg>' },
    { id: 'solid-shell', label: 'Outer Shell (Solids)', commands: ['shell', 'outer shell', 'outershell'], op: 'shell',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" stroke-dasharray="2 2"/></svg>' },
  ];

  for (const d of DEFS) {
    Engine.features.register({
      id: d.id, kind: 'command', label: d.label, icon: d.icon, commands: d.commands,
      run(app) { if (app && app.runSolidOp) app.runSolidOp(d.op); },
    });
  }
})();
