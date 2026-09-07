'use strict';
// ---------------------------------------------------------------------------
// Application shell: UI (menus, toolbar, tray, status bar), inference engine,
// selection, undo/redo, clipboard, autosave.
// ---------------------------------------------------------------------------

const MATERIALS = [
  { name: 'Default', color: null, alpha: 1 },
  { name: 'White', color: '#ffffff', alpha: 1 }, { name: 'Light Gray', color: '#d9d9d9', alpha: 1 },
  { name: 'Gray', color: '#9e9e9e', alpha: 1 }, { name: 'Dark Gray', color: '#5b5b5b', alpha: 1 },
  { name: 'Black', color: '#2e2e2e', alpha: 1 },
  { name: 'Red', color: '#c5221f', alpha: 1 }, { name: 'Orange', color: '#e8710a', alpha: 1 },
  { name: 'Yellow', color: '#f4b400', alpha: 1 }, { name: 'Grass', color: '#3d9e4e', alpha: 1 },
  { name: 'Green', color: '#2e7d32', alpha: 1 }, { name: 'Teal', color: '#0e8385', alpha: 1 },
  { name: 'Sky', color: '#7fb2e5', alpha: 1 }, { name: 'Blue', color: '#3e66c4', alpha: 1 },
  { name: 'Navy', color: '#27418f', alpha: 1 }, { name: 'Purple', color: '#7b3fa0', alpha: 1 },
  { name: 'Pink', color: '#d8467e', alpha: 1 }, { name: 'Brown', color: '#8d6e63', alpha: 1 },
  { name: 'Brick', color: '#a3502e', alpha: 1 }, { name: 'Roof', color: '#6d4c41', alpha: 1 },
  { name: 'Wood', color: '#c8a06a', alpha: 1 }, { name: 'Concrete', color: '#c0bfba', alpha: 1 },
  { name: 'Asphalt', color: '#4a4a48', alpha: 1 }, { name: 'Foliage', color: '#4c8c3f', alpha: 1 },
  { name: 'Water', color: '#4a90d9', alpha: 0.6 }, { name: 'Glass', color: '#aecde0', alpha: 0.35 },
];

const FEATURES = [
  ['Drawing tools', [
    ['Line tool with chaining + axis inference', 'yes'],
    ['Continue a line from any existing endpoint', 'yes'],
    ['Closed loop of lines creates a face (punches host)', 'yes'],
    ['Shape straddling a face edge splits it (SketchUp face split)', 'yes'],
    ['Live [x, y, z] coordinate readout while drawing', 'yes'],
    ['Rectangle (axis-aligned, exact w×h, corner coordinates)', 'yes'],
    ['Circle (radius + segment count)', 'yes'],
    ['Polygon (radius + sides)', 'yes'],
    ['Arc (start–end–bulge, exact radius/bulge)', 'yes'],
    ['Rotated Rectangle / 3-Point Rectangle', 'no'],
    ['Freehand curve', 'no'],
    ['Pie arc / 3-point arc / center-point arc', 'no'],
  ]],
  ['Modification tools', [
    ['Push/Pull (extrude, re-push, collapse to zero)', 'yes'],
    ['Push/pull merge: outward unions, inward carves, through punches', 'yes'],
    ['Move (+ Ctrl = copy, axis locks)', 'yes'],
    ['Rotate (protractor on face or ground)', 'yes'],
    ['Scale (corner/edge/face grips, per-axis)', 'yes'],
    ['Offset (faces + circles)', 'yes'],
    ['Resize Wall (Revit-style exact room dimensions)', 'yes'],
    ['Erase + coplanar face healing', 'yes'],
    ['Paint Bucket (materials, Alt = sample)', 'yes'],
    ['Follow Me (sweep along path)', 'no'],
    ['Intersect Faces / boolean Solid Tools', 'no'],
    ['Flip Along axis', 'no'],
  ]],
  ['Selection & editing', [
    ['Click / window / crossing selection, Shift/Ctrl', 'yes'],
    ['Double-click selects face boundary', 'yes'],
    ['Select All / Deselect / Delete', 'yes'],
    ['Cut / Copy / Paste (paste in place)', 'yes'],
    ['Undo / Redo (100 steps)', 'yes'],
    ['Reverse Faces', 'yes'],
    ['Hide / Unhide', 'yes'],
    ['Soften/Smooth edges', 'no'],
    ['Groups: create, name, rename, ungroup, edit-inside', 'yes'],
    ['Solid groups: watertight check, Make Full, volume', 'yes'],
    ['Give Thickness (mitered shell thickening)', 'yes'],
    ['Components (reusable instances)', 'no'],
    ['Tags (layers) & Outliner', 'no'],
  ]],
  ['Inference engine', [
    ['Endpoint / Midpoint / Center snaps', 'yes'],
    ['On-face / on-ground tracking', 'yes'],
    ['Axis alignment (red/green/blue dashed lines)', 'yes'],
    ['Axis lock with arrow keys', 'yes'],
    ['Parallel / perpendicular / square inference', 'no'],
    ['Guide lines & guide points (Tape/Protractor)', 'no'],
  ]],
  ['Input & measurement', [
    ['Measurements box (type exact values + Enter)', 'yes'],
    ['Length / w,h / radius,sides / distance / angle / scale', 'yes'],
    ['Units: m, cm, mm, km, ft, in', 'yes'],
    ['Tape Measure tool', 'yes'],
    ['Dimensions & Text entities', 'no'],
  ]],
  ['Camera & display', [
    ['Orbit / Pan / Zoom (mouse-agnostic middle-drag nav)', 'yes'],
    ['Perspective ↔ Parallel projection', 'yes'],
    ['Standard views (Iso/Top/Bottom/Front/Back/Left/Right)', 'yes'],
    ['Zoom Extents', 'yes'],
    ['Shadows, Fog, Grid, Axes display toggles', 'yes'],
    ['Face styles: Shaded / Monochrome / Wireframe / X-Ray', 'yes'],
    ['Walk / Look Around / Position Camera', 'no'],
    ['Field of view / Photo Match', 'no'],
  ]],
  ['Files & workflow', [
    ['New / Open / Save (.json model)', 'yes'],
    ['Export PNG snapshot', 'yes'],
    ['Autosave & restore in browser', 'yes'],
    ['Scenes (view animation)', 'no'],
    ['Import DWG/DXF/STL/images, LayOut, 3D Warehouse, extensions', 'no'],
  ]],
];

const ICONS = {
  select: '<svg viewBox="0 0 24 24"><path d="M6 3l7 16 2.2-6.4L21 10.4z" fill="currentColor" stroke="none"/></svg>',
  line: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.7" fill="currentColor"/><circle cx="19" cy="5" r="1.7" fill="currentColor"/></svg>',
  rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="6" width="16" height="12"/></svg>',
  circle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
  polygon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 4l7 5-2.6 8H7.6L5 9z"/></svg>',
  arc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 18a12 12 0 0 1 16-9"/><circle cx="4" cy="18" r="1.7" fill="currentColor" stroke="none"/><circle cx="20" cy="9" r="1.7" fill="currentColor" stroke="none"/></svg>',
  pushpull: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="13" width="14" height="7"/><path d="M12 11V4"/><path d="M8.5 7.5L12 4l3.5 3.5"/></svg>',
  extrude: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 17c5-9 11-9 16 0"/><path d="M4 17v4M20 17v4M4 21h16"/><path d="M12 10V4"/><path d="M9.5 6.5L12 4l2.5 2.5"/></svg>',
  offset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16"/><rect x="8" y="8" width="8" height="8" stroke-dasharray="2 2"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 2v20M2 12h20"/><path d="M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5M2 12l2.5-2.5M2 12l2.5 2.5M22 12l-2.5-2.5M22 12l-2.5 2.5"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M17 2v4h4"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="10" width="10" height="10"/><path d="M14 10l6-6"/><path d="M15 4h5v5"/></svg>',
  paint: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 4l8 8-7 7-7-7z" transform="translate(1,0)"/><path d="M17 15c1.5 2 3 3 3 5a2 2 0 0 1-4 0c0-2 1.5-3 3-5z" transform="translate(-2,-4)"/></svg>',
  eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 15l8-8 7 7-5 5H8z"/><path d="M4 20h16"/></svg>',
  trim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6.5" cy="17.5" r="2.3"/><circle cx="17.5" cy="17.5" r="2.3"/><path d="M8.6 15.9L19 5.5"/><path d="M15.4 15.9L10.8 11.3 19 5.5"/></svg>',
  tape: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="9" width="18" height="7" rx="1"/><path d="M7 9v3M11 9v3M15 9v3M19 9v3"/></svg>',
  resize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 4v16M18 4v16"/><path d="M6 12h12"/><path d="M9 9l-3 3 3 3M15 9l3 3-3 3"/></svg>',
  wall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 18h18"/><path d="M3 18l3-8h14l-3 8"/><path d="M9 10l-1.5 8M14 10l1 8"/></svg>',
  floor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 6l9 4-9 4-9-4z"/><path d="M12 10v4"/><path d="M7 8.5v4M17 8.5v4"/></svg>',
  draw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M13 6l4 4"/></svg>',
  convert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v10"/><path d="M8 9l4 4 4-4"/><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"/></svg>',
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="6" y="3" width="12" height="18" rx="1"/><circle cx="15" cy="12" r="0.9" fill="currentColor"/></svg>',
  window: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="4" width="14" height="16" rx="1"/><path d="M12 4v16M5 12h14"/></svg>',
  opening: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 3v18M17 3v18"/><path d="M7 8h10M7 16h10" stroke-dasharray="2 2"/></svg>',
  orbit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-20 12 12)"/></svg>',
  pan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v18M3 12h18"/><path d="M12 3l-2.2 2.2M12 3l2.2 2.2M12 21l-2.2-2.2M12 21l2.2-2.2M3 12l2.2-2.2M3 12l2.2 2.2M21 12l-2.2-2.2M21 12l-2.2 2.2"/></svg>',
  zoomext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M7.5 10.5h6M10.5 7.5v6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 5L3 10l5 5"/><path d="M3 10h11a6 6 0 0 1 0 12h-4"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M16 5l5 5-5 5"/><path d="M21 10H10a6 6 0 0 0 0 12h4"/></svg>',
  shadow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4.5"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/></svg>',
  xray: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18" opacity=".5"/></svg>',
  wire: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3L3 19h18z"/><path d="M12 3v16M7.5 11h9"/></svg>',
  levels: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 5h13"/><path d="M3 12h13" stroke-dasharray="3 2.4"/><path d="M3 19h13"/><path d="M20.5 5v14"/><path d="M18.3 7.2l2.2-2.2 2.2 2.2"/><path d="M18.3 16.8l2.2 2.2 2.2-2.2"/></svg>',
  grids: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 3v18"/><path d="M16 3v18"/><path d="M3 8h18"/><path d="M3 16h18"/><circle cx="8" cy="3" r="1.6"/><circle cx="16" cy="21" r="1.6"/><circle cx="3" cy="16" r="1.6"/><circle cx="21" cy="8" r="1.6"/></svg>',
  browser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M9 4v16"/><path d="M9 9.5h12M9 14.5h12M13 4v16" opacity=".65"/></svg>',
  families: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 3h10M8 5h8M8.8 5l-.8 14M15.2 5l.8 14M7.5 21h9M6 5h12"/><path d="M12 5v16" opacity=".5"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3.5l8.5 4.5L12 12.5 3.5 8 12 3.5z"/><path d="M3.5 12.5L12 17l8.5-4.5" opacity=".65"/><path d="M3.5 16.5L12 21l8.5-4.5" opacity=".35"/></svg>',
  blenderkit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/><path d="M17.5 3.5v4M15.5 5.5h4" stroke-width="1.5"/></svg>',
  measurearea: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 19V9l5-5h10v10l-5 5z"/><path d="M4 9l5 5 6-6 5 5" opacity=".6"/><path d="M9 4v5h5" opacity=".6"/></svg>',
};

// command aliases contributed by SDK features (command -> tool id)
const ENGINE_COMMANDS = new Map();

const TOOL_DEFS = {
  // SketchUp-style direct modeling ribbon
  free: [
    { id: 'select', label: 'Select', key: 'Space' },
    'sep',
    { id: 'line', label: 'Line', key: 'L' },
    { id: 'rect', label: 'Rectangle', key: 'R' },
    { id: 'circle', label: 'Circle', key: 'C' },
    { id: 'arc', label: 'Arc', key: 'A' },
    { id: 'polygon', label: 'Polygon', key: '' },
    { id: 'extrude', label: 'Extrude Curve', key: 'J' },
    'sep',
    { id: 'pushpull', label: 'Push/Pull', key: 'P' },
    { id: 'offset', label: 'Offset', key: 'F' },
    { id: 'resize', label: 'Resize Wall', key: 'W' },
    { id: 'move', label: 'Move', key: 'M' },
    { id: 'rotate', label: 'Rotate', key: 'Q' },
    { id: 'scale', label: 'Scale', key: 'S' },
    'sep',
    { id: 'paint', label: 'Paint Bucket', key: 'B' },
    { id: 'eraser', label: 'Eraser', key: 'E' },
    { id: 'trim', label: 'Trim', key: 'X' },
    { id: 'tape', label: 'Tape Measure', key: 'T' },
    { id: 'measurearea', label: 'Measure Area', key: '' }, // same tool as Precise (A is Arc here)
    'sep',
    { id: 'orbit', label: 'Orbit', key: 'O' },
    { id: 'pan', label: 'Pan', key: 'H' },
  ],
  // Revit-style parametric ribbon — same canvas, same B-Rep model
  bim: [
    { id: 'select', label: 'Select', key: 'Space' },
    'sep',
    { id: 'draw', label: 'Draw', key: 'D' },
    { id: 'wall', label: 'Wall', key: 'L' },
    { id: 'floor', label: 'Floor', key: 'R' },
    { id: 'convert', label: 'Convert to BIM', key: '' },
    'sep',
    { id: 'door', label: 'Door', key: '' },
    { id: 'window', label: 'Window', key: '' },
    { id: 'opening', label: 'Wall Opening', key: '' },
    'sep',
    { id: 'pushpull', label: 'Push/Pull', key: 'P' },
    { id: 'move', label: 'Move', key: 'M' },
    'sep',
    { id: 'eraser', label: 'Eraser', key: 'E' },
    { id: 'trim', label: 'Trim', key: 'X' },
    { id: 'tape', label: 'Tape Measure', key: 'T' },
    { id: 'measurearea', label: 'Measure Area', key: 'A' },
    'sep',
    { id: 'orbit', label: 'Orbit', key: 'O' },
    { id: 'pan', label: 'Pan', key: 'H' },
  ],
};

// ---------------------------------------------------------------------------
// Unit of work. Every model mutation happens inside a Transaction so undo
// snapshots, snap-cache invalidation, view rebuilds, and UI syncs cannot be
// forgotten by tool code.
//
//   app.run('push/pull', m => m.pushPull(f, 0.5));     // one-shot operation
//   const tx = app.begin('erase');                     // interactive drag:
//   ...mutate...                                        //   begin on first change,
//   tx.commit();                                        //   commit on release
//   tx.rollback();                                      //   rollback to cancel
//
// begin() snapshots the model. commit() pushes that snapshot onto the undo
// stack and syncs the UI; rollback() restores it (used on cancel and on
// exceptions). opDone()/undo()/redo() remain, but only the transaction layer
// and undo/redo call them — tools never touch raw undo state.
// ---------------------------------------------------------------------------
class Transaction {
  static MAX_UNDO = 100;
  constructor(app, label) {
    this.app = app;
    this.label = label;
    this.snapshot = app.model.serialize();
    this.finished = false;
    this.rolledBack = false; // visible to callers: the tx-guard rollback in
                             // commit() restores geometry silently — entity
                             // registrations made for the edit must be undone
  }
  commit() {
    if (this.finished) return;
    // Engine tx guard: a commit that INTRODUCES new structural errors rolls
    // back. Pre-existing errors (from an earlier crash or external edit) are
    // reported once but never block legitimate work on the model — the guard
    // compares the error state before vs after this edit, not the absolute.
    if (window.Engine && Engine.txGuard && !this._validated) {
      const after = this.app.model.validate();
      if (!after.ok && after.errors && after.errors.length) {
        // check whether these errors pre-date this edit: validate the
        // pre-transaction snapshot (a deep copy — safe to load into a scratch)
        let preExisting = 0;
        try {
          const scratch = Object.create(Object.getPrototypeOf(this.app.model));
          scratch.load(JSON.parse(JSON.stringify(this.snapshot)));
          const before = scratch.validate();
          preExisting = before.ok ? 0 : (before.errors || []).length;
        } catch (e) { preExisting = 0; }
        if (after.errors.length > preExisting) {
          this.finished = true;
          this.rollback();
          this.app.toast(`"${this.label}" rolled back — invalid geometry`, true);
          console.error(`[tx-guard] ${this.label}:`, after.errors.slice(0, 3));
          return;
        }
        // pre-existing damage: log once, let the edit through
        if (!Transaction._warned) {
          Transaction._warned = true;
          console.warn(`[tx-guard] ${preExisting} pre-existing structural errors in the model — new edits are not blocked by them. Run undo or File ▸ New to clear.`);
        }
      }
    }
    this.finished = true;
    const A = this.app;
    A.undoStack.push(this.snapshot);
    if (A.undoStack.length > Transaction.MAX_UNDO) A.undoStack.shift();
    A.redoStack.length = 0;
    if (A.model && A.model.endEdgeSweep)
      while (A.model._sweepStack && A.model._sweepStack.length) A.model.endEdgeSweep(); // drain: an interrupted NESTED bracket must not shield residue
    if (A.validateOnCommit) {
      const v = A.model.validate();
      if (!v.ok) console.error(`[${this.label}] model invalid after commit:`, v.errors);
    }
    A.opDone();
  }
  rollback() {
    if (this.finished) return;
    this.finished = true;
    this.rolledBack = true;
    this.app.model.load(this.snapshot);
    if (this.app.model.endEdgeSweep)
      while (this.app.model._sweepStack && this.app.model._sweepStack.length) this.app.model.endEdgeSweep();
    this.app.opDone();
  }
}

// ---------------------------------------------------------------------------
// Centralized unit-of-work facade. Tools and parametric features mutate the
// model exclusively through this manager:
//
//   app.transaction.begin('push/pull');   // snapshot (auto-rollbacks a stale one)
//   ...geometry or parametric mutations...
//   app.transaction.commit();             // push undo + UI sync + snap-cache reset
//   app.transaction.rollback();           // Escape / cancel: restore the snapshot
//   app.transaction.run('paint', fn);     // one-shot begin + mutate + commit
//                                            (rollback + toast if fn throws)
// ---------------------------------------------------------------------------
class TransactionManager {
  constructor(app) { this.app = app; }
  begin(label = 'edit') { return this.app._beginTx(label); }
  run(label, fn) { return this.app._runTx(label, fn); }
  commit() {
    const tx = this.app._openTx;
    if (tx && !tx.finished) tx.commit();
  }
  rollback() {
    const tx = this.app._openTx;
    if (tx && !tx.finished) tx.rollback();
  }
  get current() { return this.app._openTx; }
}

// ---------------------------------------------------------------------------
// Vertical level system. State lives on the model (model.levels) so it
// survives undo, autosave, and file round-trips; this facade manages it.
// ---------------------------------------------------------------------------
class LevelManager {
  constructor(model) { this.model = model; }
  get levels() { return this.model.levels; }
  getLevel(id) { return this.levels.find(l => l.id === id) || null; }
  getElevation(id) {
    const l = this.getLevel(id);
    return l ? l.elevation : 0;
  }
  addLevel(name, elevation) {
    let n = 1;
    while (this.levels.some(l => l.id === 'lvl_' + n)) n++;
    // Revit refuses duplicate level names — auto-uniquify instead of silently
    // creating two "Level 1" rows that read as one datum everywhere
    let base = (name || ('Level ' + n)).trim() || ('Level ' + n);
    let unique = base, k = 1;
    while (this.levels.some(l => l.name === unique)) unique = base + ' (' + (++k) + ')';
    const lvl = { id: 'lvl_' + n, name: unique, elevation: +elevation || 0 };
    this.levels.push(lvl);
    this.levels.sort((a, b) => a.elevation - b.elevation);
    if (window.app && app.onLevelsChanged) app.onLevelsChanged();
    return lvl;
  }
  updateLevel(id, patch) {
    const lvl = this.getLevel(id);
    if (!lvl) return null;
    if (patch.name != null && patch.name.trim()) {
      const want = patch.name.trim();
      if (this.levels.some(l => l !== lvl && l.name === want)) {
        if (window.app) app.toast(`Level "${want}" already exists — name kept`, true);
      } else lvl.name = want;
    }
    if (patch.elevation != null && !isNaN(patch.elevation)) lvl.elevation = +patch.elevation;
    if (patch.gridSystem !== undefined) lvl.gridSystem = patch.gridSystem || null; // named grid line system
    this.levels.sort((a, b) => a.elevation - b.elevation);
    if (window.app && app.onLevelsChanged) app.onLevelsChanged();
    return lvl;
  }
  // Counts BIM entities that base on / constrain to the level, so the dialog
  // can block deleting a level geometry still depends on.
  usage(id) {
    let basedOn = 0, constrainedTo = 0;
    for (const ent of this.model.bimEntities || []) {
      if (ent.params && ent.params.baseLevel === id) basedOn++;
      if (ent.params && ent.params.topConstraint === id) constrainedTo++;
    }
    return { basedOn, constrainedTo, total: basedOn + constrainedTo };
  }
  // Pre-flight delete check: null when deletion is allowed, else the reason.
  canRemove(id) {
    const lvl = this.getLevel(id);
    if (!lvl) return 'Level not found';
    if (lvl.locked) return `Level ${lvl.name} is locked — unlock it in the Element Browser first`;
    if (this.levels.length <= 1) return 'At least one level is required';
    const u = this.usage(id);
    if (u.total) {
      const kind = u.basedOn && u.constrainedTo ? 'based on / constrained to'
        : (u.basedOn ? 'based on' : 'constrained to');
      return `${u.total} ${u.total === 1 ? 'entity is' : 'entities are'} ${kind} ${lvl.name} — reassign ${u.total === 1 ? 'it' : 'them'} first`;
    }
    return null;
  }
  // Returns null on success, or a human-readable reason the delete was refused.
  removeLevel(id) {
    const err = this.canRemove(id);
    if (err) return err;
    const lvl = this.getLevel(id);
    this.levels.splice(this.levels.indexOf(lvl), 1);
    // active options may still point at the removed level
    const app = window.app;
    if (app) {
      if (app.bimOptions.baseLevel === id) app.bimOptions.baseLevel = this.levels[0].id;
      if (app.bimOptions.topConstraint === id) app.bimOptions.topConstraint = 'unconnected';
    }
    if (app && app.onLevelsChanged) app.onLevelsChanged();
    return null;
  }
}

// ---------------------------------------------------------------------------
// BIM entity management. Tracks parametric definitions (walls, floors,
// openings) and their B-Rep faces/edges. Every face/edge a BIM tool creates
// carries lightweight userData { bimEntityId, bimType, role }; state lives on
// the model (model.bimEntities) for undo/save round-trips.
// ---------------------------------------------------------------------------
class BimEntityManager {
  constructor(model) { this.model = model; }
  get entities() { return this.model.bimEntities; }
  _nextId(type) {
    let n = 1;
    const prefix = type + '_';
    while (this.entities.some(e => e.id === prefix + n)) n++;
    return prefix + n;
  }
  // Registers a parametric entity and stamps metadata on its B-Rep.
  // roles: map faceId -> 'top'|'exterior'|'interior'|'start_cap'|'end_cap'|'bottom'
  // HOST REGENERATION (element isolation): when a structural intruder (column,
  // beam, foundation) is created or detached, walls whose baseline crosses its
  // plan footprint are marked dirty. On the next opDone each dirty wall
  // regenerates FROM ITS PARAMS: the column still inside re-splits it (two
  // segments around the intruder), the column gone leaves ONE whole wall —
  // the gap heals. No permanent scars, no orphan lines, each element alone.
  _markHostsDirty(ent) {
    if (!ent || !['column', 'beam', 'foundation'].includes(ent.type)) return;
    const m = this.model;
    const c = { x: 0, y: 0 };
    let n = 0;
    if (ent.params.base) { c.x = ent.params.base[0]; c.y = ent.params.base[1]; n = 1; }
    else if (ent.params.baseline) {
      for (const p of ent.params.baseline) { c.x += p[0]; c.y += p[1]; n++; }
    }
    if (!n) return;
    c.x /= n; c.y /= n;
    const R = ent.type === 'column' ? 0.6 : (ent.params.height || 1) + 1; // crude plan reach
    this._hostsDirty = this._hostsDirty || new Set();
    // a removed/added BEAM cuts columns at its endpoints — mark them dirty
    if (ent.type === 'beam' && ent.params && ent.params.baseline) {
      for (const p of ent.params.baseline)
        for (const c of this.entities)
          if (c.type === 'column' && c.params && c.params.base
            && Math.hypot(c.params.base[0] - p[0], c.params.base[1] - p[1]) < 0.75)
            this._hostsDirty.add(c.id);
    }
    for (const w of this.entities) {
      if (w.type === 'beam' && w.params && w.params.baseline) {
        const bl = w.params.baseline;
        for (const p of bl)
          if (Math.hypot(p[0] - c.x, p[1] - c.y) < 0.75) { this._hostsDirty.add(w.id); break; }
        continue;
      }
      if (w.type !== 'wall' || !w.params || !w.params.base || !w.params.end) continue;
      // distance point-to-segment from intruder center to wall baseline
      const ax = w.params.base[0], ay = w.params.base[1], bx = w.params.end[0], by = w.params.end[1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.y - ay) * dy) / L2));
      if (Math.hypot(c.x - (ax + dx * t), c.y - (ay + dy * t)) < R) this._hostsDirty.add(w.id);
    }
  }
  // SPLIT-PIECE ADOPTION — the drift invariant. Splits replace face ids;
  // stamp propagation carries ownership to the pieces, but nothing reliably
  // added the new ids to the owner's list — unlisted fragments survived
  // every regeneration as corpses (651 in the stress model). After every
  // commit, each entity's lists must COVER every live-stamped face/edge.
  syncEntityLists() {
    const byId = new Map(this.entities.map(e => [e.id, e]));
    const fsets = new Map(this.entities.map(e => [e.id, new Set(e.faces)]));
    const esets = new Map(this.entities.map(e => [e.id, new Set(e.edges)]));
    let nf = 0, ne = 0;
    for (const [fid, f] of this.model.faces) {
      const uid = f.userData && f.userData.bimEntityId;
      if (!uid || !byId.has(uid)) continue;
      const set = fsets.get(uid);
      if (!set.has(fid)) { set.add(fid); nf++; }
    }
    for (const [eid, e] of this.model.edges) {
      const uid = e.userData && e.userData.bimEntityId;
      if (!uid || !byId.has(uid)) continue;
      const set = esets.get(uid);
      if (!set.has(eid)) { set.add(eid); ne++; }
    }
    if (nf || ne) for (const [id, ent] of byId) {
      ent.faces = [...fsets.get(id)];
      ent.edges = [...esets.get(id)];
    }
    return { faces: nf, edges: ne };
  }
  create(type, params, faceRoles, edgeIds = []) {
    const ent = this._createInner(type, params, faceRoles, edgeIds);
    if (ent) this._markHostsDirty(ent);
    return ent;
  }
  _createInner(type, params, faceRoles, edgeIds = []) {
    const id = this._nextId(type);
    // new elements land on the CURRENT layer (AutoCAD behavior); legacy
    // entities without a layer resolve back to '0' on load
    const ent = { id, type, params, faces: Object.keys(faceRoles).map(Number), edges: [...edgeIds], layerId: this.model.currentLayerId || '0' };
    this.entities.push(ent);
    for (const [fid, role] of Object.entries(faceRoles)) {
      const f = this.model.faces.get(+fid);
      if (f) f.userData = { bimEntityId: id, bimType: type, role };
    }
    for (const eid of edgeIds) {
      const e = this.model.edges.get(eid);
      if (e) e.userData = { bimEntityId: id, bimType: type, role: 'profile' };
    }
    return ent;
  }
  getEntityById(id) { return this.entities.find(e => e.id === id) || null; }
  /** Same-kind element already at this spot? (same baseline/base plan point
   *  and level — duplicate placements shred each other into split cascades) */
  existsLike(type, params) {
    const key = p => p ? [ +(+p[0]).toFixed(3), +(+p[1]).toFixed(3) ] : null;
    return this.entities.some(e => {
      if (e.type !== type) return false;
      const a = e.params || {}, b = params || {};
      if (type === 'beam' || type === 'wall') {
        if ((a.baseLevel || a.referenceLevelId) !== (b.baseLevel || b.referenceLevelId)) return false;
        const A1 = key(a.baseline && a.baseline[0]), B1 = key(b.baseline && b.baseline[0]);
        const A2 = key(a.baseline && a.baseline[1]), B2 = key(b.baseline && b.baseline[1]);
        return A1 && B1 && ((A1.join() === B1.join() && A2.join() === B2.join())
          || (A1.join() === B2.join() && A2.join() === B1.join()));
      }
      // column / foundation / stairs: same plan base + level
      if ((a.baseLevel || a.baseLevelId) !== (b.baseLevel || b.baseLevelId)) return false;
      const A = key(a.base), B = key(b);
      return A && B && A.join() === B.join();
    });
  }
  getEntityForFace(face) {
    const uid = face && face.userData && face.userData.bimEntityId;
    return uid ? this.getEntityById(uid) : null;
  }
  // ---- parametric edits (geometry follows the definition, never rebuilt
  // from scratch: the wall's own vertices move, so neighbors stay welded) ----
  // Push/Pull on a wall's top face: move the top ring to the new height and
  // update params.height. Returns true when the entity was synced intact.
  syncWallHeight(id, newHeight) {
    const ent = this.getEntityById(id);
    if (!ent || ent.type !== 'wall') return false;
    const m = this.model;
    const vids = new Set();
    for (const fid of ent.faces) {
      const f = m.faces.get(fid);
      if (!f || !f.userData || f.userData.role !== 'top') continue;
      for (const ring of m.rings(f)) for (const v of ring) vids.add(v);
    }
    if (!vids.size) return false;
    const baseZ = ent.params.base != null ? ent.params.base[2] : 0;
    const targetZ = baseZ + Math.max(0.05, newHeight);
    for (const v of vids) {
      const p = m.vp(v);
      m.setVertex(v, { x: p.x, y: p.y, z: targetZ });
    }
    ent.params.height = targetZ - baseZ;
    ent.params.topConstraint = 'unconnected'; // the push overrode the constraint
    return true;
  }
  // Walls founded on a level plane with sporadic hosts (footing tops at
  // the columns, joined neighbors during rebuilds) extrude with NO bottom
  // cap — pushPull's merge semantics suppress the whole cap when the
  // footprint touches anything, leaving the span between contacts open.
  // Fix at the wall layer: draw the footprint over the plane and let the
  // healing machinery keep only the UNCOVERED regions — a partial bottom
  // with complementary boundaries (no internal partitions, no z-fighting).
  ensureWallBottom(ent) {
    const m = this.model;
    if (!ent || ent.type !== 'wall' || !ent.params || !ent.params.base || !ent.params.end) return false;
    // liveness: a later commit's planar arrangement can REPLACE faces this
    // wall claimed (splits get new ids) — the registry must never point at
    // geometry that no longer exists
    if (ent.faces.some(id => !m.faces.has(id))) ent.faces = ent.faces.filter(id => m.faces.has(id));
    if (ent.edges && ent.edges.some(id => !m.edges.has(id))) ent.edges = ent.edges.filter(id => m.edges.has(id));
    const p = ent.params;
    const hasBottom = ent.faces.some(id => {
      const f = m.faces.get(id);
      return f && f.userData && f.userData.role === 'bottom' && f.userData.bimEntityId === ent.id;
    });
    if (hasBottom) return false;
    // CLAIM-FIRST: a join rebuild may already have produced the underside
    // as unstamped faces (punch splits during re-extrusion) — adopt those
    // instead of drawing a duplicate cap over them
    const dir0 = { x: p.end[0] - p.base[0], y: p.end[1] - p.base[1] };
    const L0 = Math.hypot(dir0.x, dir0.y) || 1;
    const nx0 = -dir0.y / L0, ny0 = dir0.x / L0;
    const inBand0 = q => {
      const dx = q.x - p.base[0], dy = q.y - p.base[1];
      const t = (dx * dir0.x + dy * dir0.y) / L0;
      const s = Math.abs(dx * nx0 + dy * ny0);
      return t >= -0.3 && t <= L0 + 0.3 && s <= (p.thickness || 0.2) / 2 + 0.3;
    };
    let claimed = 0;
    for (const f of [...m.faces.values()]) {
      if (f.userData || f.hidden) continue;
      const pts = m.pts(f.loop);
      if (!pts.length || !pts.every(q => Math.abs(q.z - p.base[2]) < 1e-6)) continue;
      if (!pts.every(inBand0)) continue;
      if (G.loopArea(pts) < 1e-6) continue;
      f.userData = { bimEntityId: ent.id, bimType: 'wall', role: 'bottom' };
      ent.faces.push(f.id);
      claimed++;
    }
    if (claimed) return true;
    let ring;
    try { ring = this.wallRing(p); } catch (e) { return false; }
    if (!ring || ring.length < 3 || G.ringDegenerate(ring)) return false;
    // rescue path: at ACUTE miter corners a join rebuild runs twice — by the
    // second pass the plane is already punched into cells (some claimed by
    // the neighbor), so the full-footprint cap can't be created and the
    // strict in-band claim finds nothing whole. Claim the unstamped cells
    // under this band by CENTROID so the wall keeps an underside at all
    // (attribution beats disappearance; quantities read params, not faces)
    const rescueByCentroid = () => {
      let n2 = 0;
      for (const f of [...m.faces.values()]) {
        if (f.userData || f.hidden) continue;
        const pts2 = m.pts(f.loop);
        if (!pts2.length || !pts2.every(q => Math.abs(q.z - p.base[2]) < 1e-6)) continue;
        if (!inBand0(m.faceCentroid(f))) continue;
        if (G.loopArea(pts2) < 1e-6) continue;
        f.userData = { bimEntityId: ent.id, bimType: 'wall', role: 'bottom' };
        ent.faces.push(f.id);
        n2++;
      }
      return n2;
    };
    const before = new Set(m.faces.keys());
    m.bimHold = true;
    let cap = null;
    try {
      cap = m.addFaceFromRings(ring.map(q => G.clone(q)));
      if (cap) m.punchOrSplit(cap);
    } finally { m.bimHold = false; }
    if (!cap) return rescueByCentroid() > 0;
    // survivors of the punch/trim (cells of the uncovered regions) —
    // claim only faces that genuinely lie inside this wall's band, never
    // unrelated neighbors on the same plane
    const dir = { x: p.end[0] - p.base[0], y: p.end[1] - p.base[1] };
    const L = Math.hypot(dir.x, dir.y) || 1;
    const nx = -dir.y / L, ny = dir.x / L;
    const inBand = q => {
      const dx = q.x - p.base[0], dy = q.y - p.base[1];
      const t = (dx * dir.x + dy * dir.y) / L;
      const s = Math.abs(dx * nx + dy * ny);
      // mitered corner rings extend past the endpoints / half-thickness —
      // 0.3 m slop covers typical miters without claiming neighbors
      return t >= -0.3 && t <= L + 0.3 && s <= (p.thickness || 0.2) / 2 + 0.3;
    };
    let added = 0;
    for (const id of [...m.faces.keys()]) {
      if (before.has(id)) continue;
      const f = m.faces.get(id);
      if (!f || f.userData) continue;
      const pts = m.pts(f.loop);
      if (Math.min(...pts.map(q => q.z)) > p.base[2] + 1e-6 || Math.max(...pts.map(q => q.z)) < p.base[2] - 1e-6) continue;
      if (!pts.every(inBand)) continue;
      f.userData = { bimEntityId: ent.id, bimType: 'wall', role: 'bottom' };
      ent.faces.push(id);
      for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
        const e = m.findEdge(r[i], r[(i + 1) % r.length]);
        if (e && !e.userData) { e.userData = { bimEntityId: ent.id, bimType: 'wall', role: 'profile' }; ent.edges.push(e.id); }
      }
      added++;
    }
    // strict claim came up empty (acute-corner rebuilds): fall back to the
    // centroid rescue rather than leaving the wall without an underside
    return added > 0 || rescueByCentroid() > 0;
  }
  // Structural clearance re-fit: the height param follows the cleared top
  // plane (Z under the lowest slab soffit / drop-beam underside above the
  // baseline) and the solid REGENERATES from params — robust even when the
  // original top face was consumed by a welded junction. `topZ` should
  // already include the 0.5 mm reveal the callers apply. Returns true on
  // change.
  syncWallTop(id, topZ, deductions = null) {
    const ent = this.getEntityById(id);
    if (!ent || ent.type !== 'wall' || !ent.params || !ent.params.base) return false;
    const baseZ = ent.params.base[2];
    const h = Math.max(0.05, topZ - baseZ);
    if (Math.abs(h - (ent.params.height || 0)) < 1e-4) return false;
    ent.params.height = h;
    ent.params.clearTopZ = topZ;
    if (deductions) ent.params.structuralDeductions = deductions; // [{kind, entId, ...}]
    return this.rebuildWallWithHosts(id);
  }
  // Shape-handle edits on a straight wall: stretch an endpoint (or translate
  // the whole wall). Vertices split by baseline projection into start-side /
  // end-side groups; each group translates rigidly.
  stretchWall(id, { newEnd = null, newBase = null, deltaAll = null }) {
    const ent = this.getEntityById(id);
    if (!ent || ent.type !== 'wall' || ent.params.closed || !ent.params.base || !ent.params.end) return false;
    const m = this.model;
    const p = ent.params;
    const P1 = { x: p.base[0], y: p.base[1], z: p.base[2] };
    const P2 = { x: p.end[0], y: p.end[1], z: p.end[2] };
    const D = { x: P2.x - P1.x, y: P2.y - P1.y, z: 0 };
    const L = Math.hypot(D.x, D.y);
    if (L < 1e-6) return false;
    const dir = { x: D.x / L, y: D.y / L };
    const dEnd = newEnd ? { x: newEnd.x - P2.x, y: newEnd.y - P2.y, z: newEnd.z - P2.z } : null;
    const dBase = newBase ? { x: newBase.x - P1.x, y: newBase.y - P1.y, z: newBase.z - P1.z } : null;
    const dAll = deltaAll || null;
    if (!dEnd && !dBase && !dAll) return false;
    const hasHosted = this.entities.some(e => e.params && e.params.hostWallId === id);
    if (hasHosted) {
      // apply the parametric change first, then rebuild wall + re-cut hosted
      const nBase = newBase || (deltaAll ? { x: P1.x + deltaAll.x, y: P1.y + deltaAll.y, z: P1.z + deltaAll.z } : null);
      const nEnd = newEnd || (deltaAll ? { x: P2.x + deltaAll.x, y: P2.y + deltaAll.y, z: P2.z + deltaAll.z } : null);
      if (nEnd) p.end = [nEnd.x, nEnd.y, nEnd.z];
      if (nBase) p.base = [nBase.x, nBase.y, nBase.z];
      return this.rebuildWallWithHosts(id);
    }
    const vids = new Set();
    for (const fid of ent.faces) {
      const f = m.faces.get(fid);
      if (f) for (const ring of m.rings(f)) for (const v of ring) vids.add(v);
    }
    for (const v of vids) {
      const q = m.vp(v);
      const t = (q.x - P1.x) * dir.x + (q.y - P1.y) * dir.y;
      let mv = null;
      if (dAll) mv = dAll;
      else if (dEnd && t > L / 2) mv = dEnd;
      else if (dBase && t < L / 2) mv = dBase;
      if (mv) m.setVertex(v, { x: q.x + mv.x, y: q.y + mv.y, z: q.z + mv.z });
    }
    if (dAll) {
      p.base = [P1.x + dAll.x, P1.y + dAll.y, P1.z + dAll.z];
      p.end = [P2.x + dAll.x, P2.y + dAll.y, P2.z + dAll.z];
    }
    if (dEnd) p.end = [newEnd.x, newEnd.y, newEnd.z];
    if (dBase) p.base = [newBase.x, newBase.y, newBase.z];
    return true;
  }

  // Flip a hosted door/window: rebuild only its frame/leaf faces with the
  // mirrored facing (exterior/interior) or hand (swing side). The wall cut is
  // symmetric, so it never needs re-cutting for a flip.
  flipHosted(id, which) {
    const ent = this.getEntityById(id);
    if (!ent || (ent.type !== 'door' && ent.type !== 'window')) return false;
    // wall hosts carry the descriptor in the wall entity; free-face hosts
    // stored their own wall-like descriptor in ent.params at placement time
    const wallEnt = this.getEntityById(ent.params.hostWallId);
    const wallP = wallEnt ? wallEnt.params : (ent.params.locationLine === 'face' ? ent.params : null);
    if (!wallP) return false;
    this.model.bimHold = true; // keep the host stamped while rebuilding
    ent.params[which] = ent.params[which] >= 0 ? -1 : 1;
    // remove old frame/leaf faces, keep the wall lining
    for (const fid of [...ent.faces]) {
      const f = this.model.faces.get(fid);
      if (f && f.userData && (f.userData.role === 'frame' || f.userData.role === 'leaf')) {
        this.model.faces.delete(fid);
      }
    }
    this.model.gc();
    const spec = { distanceFromStart: ent.params.distanceFromStart, width: ent.params.width, height: ent.params.height, sillHeight: ent.params.sillHeight, depth: ent.params.depth > 0 ? ent.params.depth : undefined };
    const loc = window.BimTools.HostedCut.locate(window.G, wallP, spec);
    if (loc.error) return false;
    const faces = window.BimTools.HostedCut.frame(window.G, this.model, loc, spec, ent.type,
      { facing: ent.params.facing, hand: ent.params.hand });
    const roles = {};
    const newEdges = [];
    for (const f of faces) {
      roles[f.id] = ent.type === 'door' && faces.indexOf(f) === faces.length - 1 ? 'leaf' : 'frame';
      for (const ring of this.model.rings(f))
        for (let i = 0; i < ring.length; i++) {
          const e = this.model.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (e) newEdges.push(e.id);
        }
    }
    ent.faces = ent.faces.filter(fid => this.model.faces.has(fid)).concat(faces.map(f => f.id));
    ent.edges = [...new Set(ent.edges.concat(newEdges))];
    for (const [fid, role] of Object.entries(roles)) {
      const f = this.model.faces.get(+fid);
      if (f) f.userData = { bimEntityId: id, bimType: ent.type, role };
    }
    this.model.bimHold = false;
    return true;
  }
  // Rebuild a wall from its params and re-cut every hosted opening — used
  // when the wall is resized/moved so hosted elements follow parametrically.
  // The footprint ring comes from wallRing(): mitered joints recorded in
  // params.joins recompute dynamically, and the joined neighbor walls are
  // rebuilt once too (chainJoins) so a stretched wall can't leave a stale
  // cap on the other side of the corner.
  // phase 1: remove one wall's (and its hosted elements') geometry; returns
  // the hosted entities so the re-extrude can re-cut them
  _deleteWallGeometry(ent) {
    const m = this.model;
    const hosted = this.entities.filter(e => e.params && e.params.hostWallId === ent.id);
    for (const h of hosted) for (const fid of [...h.faces]) m.faces.delete(fid);
    for (const fid of [...ent.faces]) m.faces.delete(fid);
    for (const eid of [...ent.edges]) m.edges.delete(eid);
    m.gc();
    // deleting the wall's recorded edges can also take edges it SHARED with
    // touching geometry (a column or floor at the corner) — recreate any
    // ring edge a surviving face still needs, or validate/tx-guard flags it
    for (const f2 of m.faces.values()) {
      m.edgesForRing(f2.loop, true);
      for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
    }
    return hosted;
  }
  // phase 2: re-extrude one wall from its (dynamically solved) ring against
  // whatever geometry currently exists, re-stamp it, re-cut its hosted
  _rebuildWallCore(id, hosted) {
    const ent = this.getEntityById(id);
    if (!ent || ent.type !== 'wall') return false;
    const m = this.model;
    m.bimHold = true;
    const p = ent.params;
    const ring = this.wallRing(p);
    if (!ring || G.ringDegenerate(ring)) { m.bimHold = false; return false; }
    const facesBefore = new Set(m.faces.keys());
    const f = m.addFaceFromRings(ring.map(q => G.clone(q)));
    if (!f) { m.bimHold = false; return false; }
    m.pushPull(f, p.height);
    const newFaces = [...m.faces.keys()].filter(x => !facesBefore.has(x)).map(x => m.faces.get(x));
    const baseZ = p.base ? p.base[2] : 0;
    const roles = WallTool.classifyRoles(G, m, newFaces,
      [G.v(...p.base), G.v(...p.end)], !!p.closed, baseZ, baseZ + p.height);
    ent.faces = newFaces.map(x => x.id);
    ent.edges = [];
    for (const fid of ent.faces) {
      const face = m.faces.get(fid);
      face.userData = { bimEntityId: id, bimType: 'wall', role: roles[fid] || 'exterior' };
      for (const r of m.rings(face)) for (let i = 0; i < r.length; i++) {
        const e = m.findEdge(r[i], r[(i + 1) % r.length]);
        if (e) ent.edges.push(e.id);
      }
    }
    ent.edges = [...new Set(ent.edges)];
    // re-cut every hosted element at its parametric position
    for (const h of hosted) {
      const spec = { distanceFromStart: h.params.distanceFromStart, width: h.params.width, height: h.params.height, sillHeight: h.params.sillHeight };
      const info = window.BimTools.HostedCut.cut(G, m, ent.params, spec);
      if (info.error) continue;
      const hb = new Set(m.faces.keys());
      const faces = h.type === 'opening' ? [] : window.BimTools.HostedCut.frame(G, m, info, spec, h.type, { facing: h.params.facing, hand: h.params.hand });
      h.faces = [...m.faces.keys()].filter(x => !hb.has(x));
      for (const fid of h.faces) {
        const face = m.faces.get(fid);
        const isLeaf = h.type === 'door' && faces.length && fid === faces[faces.length - 1].id;
        face.userData = { bimEntityId: h.id, bimType: h.type, role: faces.some(x => x.id === fid) ? (isLeaf ? 'leaf' : 'frame') : 'lining' };
      }
    }
    // hosted asset instances (downloaded doors/windows) re-cut and reposition
    // too — they own no kernel faces, so this is their only bookkeeping
    if (this.assets) this.assets.recutHosted(id, m);
    m.bimHold = false;
    return true;
  }
  rebuildWallWithHosts(id, chainJoins = true) {
    const ent = this.getEntityById(id);
    if (!ent || ent.type !== 'wall') return false;
    const m = this.model;
    // refuse BEFORE deleting anything: a degenerate prospective ring means
    // the re-extrude can never succeed, and _deleteWallGeometry has already
    // swept the wall away by then — the wall would silently vanish
    let pre;
    try { pre = this.wallRing(ent.params); } catch (e) { pre = null; }
    if (!pre || G.ringDegenerate(pre)) return false;
    // Construction-wire sweep brackets the WHOLE multi-phase rebuild (the
    // hold releases between delete and re-extrude): join residue like a
    // miter-cap diagonal born attached in one phase and orphaned in the
    // next never survives to render as a stray line
    m.beginEdgeSweep();
    try {
      m.bimHold = true;
      const hosted = this._deleteWallGeometry(ent);
      m.bimHold = false;
      const ok = this._rebuildWallCore(id, hosted);
      if (ok) this.ensureWallBottom(ent); // joins strip caps — restore
      // one hop: refresh the joined neighbors so the caps follow this edit
      if (ok && chainJoins && ent.params.joins) {
        for (const side of ['start', 'end']) {
          const jv = ent.params.joins[side];
          const nid2 = jv && typeof jv === 'object' ? jv.id : jv;
          if (nid2 && nid2 !== id) this.rebuildWallWithHosts(nid2, false);
        }
      }
      return ok;
    } finally {
      m.endEdgeSweep();
    }
  }
  // Regenerate a column FROM ITS PARAMS — a deleted/moved beam leaves its
  // notch behind otherwise (the beam's sweep cut the column's faces; the
  // column rebuilds whole from base/width/depth/height).
  rebuildColumnEntity(id) {
    const ent = this.getEntityById(id);
    if (!ent || ent.type !== 'column') return false;
    const m = this.model, app = window.app;
    const p = ent.params;
    m.bimHold = true;
    for (const fid of [...ent.faces]) m.faces.delete(fid);
    for (const eid of [...ent.edges]) m.edges.delete(eid);
    m.gc();
    for (const f2 of m.faces.values()) {
      m.edgesForRing(f2.loop, true);
      for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
    }
    const b = p.base, z = b[2];
    let made = [];
    try {
      made = window.ColumnFeature
        ? ColumnFeature.placeColumn(G, m, { x: b[0], y: b[1], z }, p.width, p.depth, p.height)
        : [];
    } catch (e) { m.bimHold = false; return false; }
    if (!made || !made.length) { m.bimHold = false; return false; }
    const roles = {};
    for (const f of made) {
      const c = m.faceCentroid(f);
      roles[f.id] = Math.abs(c.z - z) < 1e-6 ? 'bottom'
        : Math.abs(c.z - (z + p.height)) < 1e-6 ? 'top' : 'side';
    }
    ent.faces = made.map(f => f.id);
    ent.edges = [];
    for (const fid of ent.faces) {
      const f = m.faces.get(fid);
      f.userData = { bimEntityId: id, bimType: 'column', role: roles[fid] };
      for (const ring of m.rings(f)) for (let i = 0; i < ring.length; i++) {
        const e = m.findEdge(ring[i], ring[(i + 1) % ring.length]);
        if (e) ent.edges.push(e.id);
      }
    }
    ent.edges = [...new Set(ent.edges)];
    m.bimHold = false;
    return true;
  }

  // Regenerate a beam FROM ITS PARAMS (element isolation): the sweep re-runs
  // against the CURRENT neighbors — column present trims at its face, column
  // gone runs full length (analytical baseline is untouched in params).
  rebuildBeamEntity(id) {
    const ent = this.getEntityById(id);
    if (!ent || ent.type !== 'beam') return false;
    const m = this.model;
    const app = window.app;
    m.bimHold = true;
    for (const fid of [...ent.faces]) m.faces.delete(fid);
    for (const eid of [...ent.edges]) m.edges.delete(eid);
    m.gc();
    for (const f2 of m.faces.values()) {
      m.edgesForRing(f2.loop, true);
      for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
    }
    let built = [];
    try {
      built = app.structural.buildBeam(G, m, ent.params);
    } catch (e) { m.bimHold = false; return false; }
    const bl = ent.params.baseline;
    const ax = bl[0][0], ay = bl[0][1], bx = bl[bl.length - 1][0], by = bl[bl.length - 1][1];
    const zRef = bl[0][2];
    const faces = built.filter(f => !f.userData);
    const roles = {};
    for (const f of faces) roles[f.id] = 'body';
    const ne = [];
    for (const f of faces) for (const ring of m.rings(f)) for (let i = 0; i < ring.length; i++) {
      const e = m.findEdge(ring[i], ring[(i + 1) % ring.length]);
      if (e && !e.userData) ne.push(e.id);
    }
    for (const [fid, role] of Object.entries(roles)) {
      const f = m.faces.get(+fid);
      if (f) f.userData = { bimEntityId: id, bimType: 'beam', role };
    }
    ent.faces = Object.keys(roles).map(Number);
    ent.edges = [...new Set(ne)];
    m.bimHold = false;
    return true;
  }

  // Synchronized junction re-solve — the reactive dependency graph. When a
  // wall's properties change (thickness, location line, baseline), every
  // wall connected to its start/end junctions must regenerate TOGETHER:
  // rebuilding one wall at a time lets each new band land against a
  // neighbor's stale miter, and the welder's T-junction splits leave
  // orphaned slivers in the corner (mismatched bevels, spikes, open
  // edges). Here all affected geometry is removed first — the whole
  // junction component goes dirty at once — then every wall re-extrudes
  // into clean space against the final shared junction vertices. The
  // asymmetric miter itself is solved by wallRing/miterCap (outer/inner
  // offset-line intersections per wall thickness), so 100↔300 mm corners
  // come out flush with no overlap.
  rebuildWallGroup(id) {
    const ent0 = this.getEntityById(id);
    if (!ent0 || ent0.type !== 'wall') return false;
    // junction component: the wall plus everything reachable through joins
    const ids = [id];
    const seen = new Set(ids);
    const queue = [ent0];
    while (queue.length) {
      const e = queue.pop();
      const j = e.params && e.params.joins;
      if (!j) continue;
      for (const side of ['start', 'end']) {
        const jv = j[side];
        const nid = jv && typeof jv === 'object' ? jv.id : jv;
        if (!nid || seen.has(nid)) continue;
        const nb = this.getEntityById(nid);
        if (nb && nb.type === 'wall') { seen.add(nid); ids.push(nid); queue.push(nb); }
      }
    }
    const m = this.model;
    m.bimHold = true;
    const hostedBy = new Map();
    for (const wid of ids) {
      const e2 = this.getEntityById(wid);
      if (!e2) continue;
      hostedBy.set(wid, this._deleteWallGeometry(e2));
    }
    m.bimHold = false;
    let ok = true;
    for (const wid of ids) ok = this._rebuildWallCore(wid, hostedBy.get(wid) || []) && ok;
    return ok;
  }
  // Re-fit one drop-panel column to a new solid top (its head hangs under a
  // slab soffit — see StructuralManager.dropPanelSoffit). Deletes the old
  // solids, re-extrudes the family stack down from `panelTopZ`, and re-stamps
  // faces/edges in place: the entity keeps its id, layer and grid binding.
  // Mirrors the wall rebuild phases (delete → build inside one edge sweep,
  // bimHold across both so neighbors never claim the swept geometry).
  refitDropPanelColumn(id, panelTopZ) {
    const ent = this.getEntityById(id);
    if (!ent || ent.type !== 'column') return false;
    const structural = window.app && window.app.structural;
    if (!structural) return false;
    const m = this.model;
    const p = { ...ent.params, panelTopZ };
    const ring = structural.columnFootprint(p).map(q => G.v(q.x, q.y, panelTopZ));
    if (!ring || G.ringDegenerate(ring)) return false; // refuse BEFORE deleting
    m.beginEdgeSweep();
    try {
      m.bimHold = true;
      for (const fid of [...ent.faces]) m.faces.delete(fid);
      for (const eid of [...ent.edges]) m.edges.delete(eid);
      m.gc();
      // deleting recorded edges can take edges shared with touching geometry —
      // recreate any ring edge a surviving face still needs
      for (const f2 of m.faces.values()) {
        m.edgesForRing(f2.loop, true);
        for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
      }
      const st = structural.buildColumn(G, m, p);
      if (!st.length) { m.bimHold = false; return false; }
      let zMax = -Infinity, zMin = Infinity;
      for (const f of st) {
        const c = m.faceCentroid(f);
        zMax = Math.max(zMax, c.z); zMin = Math.min(zMin, c.z);
      }
      ent.faces = st.map(f => f.id);
      ent.edges = [];
      for (const fid of ent.faces) {
        const face = m.faces.get(fid);
        const c = m.faceCentroid(face);
        const role = Math.abs(c.z - zMax) < 1e-6 ? 'top'
          : Math.abs(c.z - zMin) < 1e-6 ? 'bottom' : 'side';
        face.userData = { bimEntityId: id, bimType: 'column', role };
        for (const r of m.rings(face)) for (let i = 0; i < r.length; i++) {
          const e = m.findEdge(r[i], r[(i + 1) % r.length]);
          if (e) ent.edges.push(e.id);
        }
      }
      ent.edges = [...new Set(ent.edges)];
      m.bimHold = false;
      return true;
    } finally {
      m.endEdgeSweep();
    }
  }

  // The wall's footprint ring, with joined end caps recomputed DYNAMICALLY
  // from params.joins — so connected walls stay cleanly joined (no wedge
  // gap, no overlap, no exposed end caps) after draws, stretches, and
  // rebuilds alike. params-like: { base, end, thickness, locationLine,
  // closed, footprint, joins }. A join entry is either a plain wall id
  // (legacy: coincident-endpoint MITER) or { id, mode } with mode
  //   'miter'    — both walls end at the same point, bisector cap
  //   'butt'     — this wall EXTENDS to the neighbor's far face (wrap:
  //                the exterior runs corner-to-corner, no inset)
  //   'buttTrim' — this wall's end RETREATS to the neighbor's near face
  //                (its cap hides inside the joint)
  wallRing(params) {
    if (params.closed && params.footprint) {
      return params.footprint.map(q => G.v(q[0], q[1], q[2]));
    }
    const P1 = G.v(...params.base), P2 = G.v(...params.end);
    const ring0 = window.BimTools.WallTool.bandRing(G, [P1, P2], params.thickness, params.locationLine);
    const joins = params.joins || {};
    const J = v => v == null ? null : (typeof v === 'object' ? v : { id: v, mode: 'miter' });
    const js = J(joins.start), je = J(joins.end);
    if (!js && !je) return ring0;
    const dOut = G.norm(G.sub(P2, P1)); // this wall's draw direction
    const WT2 = window.BimTools.WallTool;
    // line intersection helper (2D): point on line1 (o1,d1) also on line2 (o2,d2)
    const lineX = (o1, d1, o2, d2) => {
      const den = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(den) < 1e-9) return null;
      const u = ((o2.x - o1.x) * d2.y - (o2.y - o1.y) * d2.x) / den;
      return G.v(o1.x + d1.x * u, o1.y + d1.y * u, 0);
    };
    const capFor = (join, B, myDir, dInto) => {
      const other = this.getEntityById(join.id);
      if (!other || other.type !== 'wall' || other.params.closed) return null;
      const oBase = G.v(...other.params.base), oEnd = G.v(...other.params.end);
      if (G.dist(oEnd, oBase) < 1e-6) return null;
      const oDir = G.norm(G.sub(oEnd, oBase));
      const dm = G.v(myDir.x, myDir.y, 0), do2 = G.v(oDir.x, oDir.y, 0);
      if (join.mode === 'butt' || join.mode === 'buttTrim') {
        // wrap-butt: depth measured from my body THROUGH the joint into the
        // neighbor — dInto points at the join (toward the neighbor behind my
        // start when capping the start, ahead of my end when capping the end)
        const body = G.v(B.x - dInto.x, B.y - dInto.y, 0); // one step into my own span
        const nW = G.v(-dm.y, dm.x, 0);
        const wOff = WT2.locOffsets(params.thickness, params.locationLine);
        const nO = G.v(-do2.y, do2.x, 0);
        const oOff = WT2.locOffsets(other.params.thickness, other.params.locationLine);
        const pts = [];
        for (const s of [wOff.left, wOff.right]) {
          let best = null, bestDepth = join.mode === 'butt' ? -Infinity : Infinity;
          for (const se of [oOff.left, oOff.right]) {
            const p = lineX(G.v(B.x + nW.x * s, B.y + nW.y * s, 0), dm,
              G.v(oBase.x + nO.x * se, oBase.y + nO.y * se, 0), do2);
            if (!p) continue;
            const depth = G.dot(G.sub(p, body), dInto); // how far past my body the crossing sits
            if (join.mode === 'butt' ? depth > bestDepth : depth < bestDepth) { bestDepth = depth; best = p; }
          }
          if (!best) return null;
          pts.push(best);
        }
        return pts;
      }
      // miter: both walls end at this joint — a stretch pulling them apart
      // breaks the join; fall back to a flat cap
      const near = G.dist(oBase, B) < G.dist(oEnd, B) ? oBase : oEnd;
      if (G.dist(near, B) > 0.05) return null;
      if (Math.abs(G.dot(dm, do2)) > 0.99995) return null; // straight continuation: flat cap is exact
      // Orient into a SEQUENTIAL flow through the joint before pairing the
      // offset faces: the neighbor's direction must point INTO J, mine OUT
      // of it — regardless of which endpoints (base/end) meet or how each
      // wall was drawn. With opposing draw directions the left/right face
      // labels invert and the outer/inner intersections cross over.
      // Offsets flip with their direction (a wall's left face is the
      // reversed direction's right), and the returned pair maps back into
      // my own frame so miteredRing's ring[0]/ring[3] stay uncrossed.
      const nbEndAtJ = G.dist(oEnd, B) < G.dist(oBase, B);
      const d1 = nbEndAtJ ? do2 : G.v(-do2.x, -do2.y, 0); // into J along the neighbor
      const d2 = G.v(-dInto.x, -dInto.y, 0);               // out of J into my body
      const oOff0 = WT2.locOffsets(other.params.thickness, other.params.locationLine);
      const off1 = nbEndAtJ ? oOff0 : { left: -oOff0.right, right: -oOff0.left };
      const flipSelf = G.dot(d2, dm) < 0; // my own draw direction opposes the flow
      const wOff0 = WT2.locOffsets(params.thickness, params.locationLine);
      const off2 = flipSelf ? { left: -wOff0.right, right: -wOff0.left } : wOff0;
      const cap = WT2.miterCap(G, G.v(B.x, B.y, 0), d1, off1, d2, off2,
        other.params.thickness, params.thickness);
      return (cap && flipSelf) ? [cap[1], cap[0]] : cap;
    };
    const capStart = js ? capFor(js, P1, dOut, G.mul(dOut, -1)) : null; // neighbor lies back along -dOut
    const capEnd = je ? capFor(je, P2, dOut, dOut) : null;              // neighbor lies ahead along +dOut
    if (!capStart && !capEnd) return ring0;
    return WT2.miteredRing(G, P1, P2, params.thickness, params.locationLine, capStart, capEnd);
  }
  // record a wall join between two entities (both sides know about it);
  // modes: 'miter' (coincident endpoints) or the wrap-butt pair
  // ('butt' on the wrapping wall's side, 'buttTrim' on the trimmed one)
  joinWalls(aId, bId, aSide, bSide, aMode = 'miter', bMode = 'miter') {
    const a = this.getEntityById(aId), b = this.getEntityById(bId);
    if (!a || !b) return;
    a.params.joins = a.params.joins || { start: 0, end: 0 };
    b.params.joins = b.params.joins || { start: 0, end: 0 };
    a.params.joins[aSide] = aMode === 'miter' ? bId : { id: bId, mode: aMode };
    b.params.joins[bSide] = bMode === 'miter' ? aId : { id: aId, mode: bMode };
  }

  // Disconnect an entity's B-Rep from its parametric definition: the geometry
  // stays as plain B-Rep, the metadata and registry entry go away.
  detach(id) {
    const ent0 = this.entities.find(e => e.id === id);
    if (ent0) this._markHostsDirty(ent0);
    const i = this.entities.findIndex(e => e.id === id);
    if (i < 0) return false;
    const ent = this.entities[i];
    for (const fid of ent.faces) {
      const f = this.model.faces.get(fid);
      if (f) f.userData = null;
    }
    for (const eid of ent.edges) {
      const e = this.model.edges.get(eid);
      if (e) e.userData = null;
    }
    this.entities.splice(i, 1);
    return true;
  }
}

class App {
  constructor() {
    this.model = new Model();
    this.sel = { edges: new Set(), faces: new Set() };
    this.selGridId = null;   // selected grid line (selectable through hosted walls)
    this.selGridIds = new Set(); // box / shift-selected grid lines (amber together)
    this.clipboard = null;
    this.undoStack = [];
    this.redoStack = [];
    this._openTx = null;        // guarded: a forgotten commit auto-rollbacks
    this.validateOnCommit = false; // console diagnostics: app.validateOnCommit = true
    this.transaction = new TransactionManager(this); // the public unit-of-work API
    this.levelManager = new LevelManager(this.model); // vertical levels
    // GridSystem/EditInPlace land with their own modules — guarded so the
    // app boots before/without them (they activate the moment they exist)
    this.gridManager = (typeof GridManager === 'function') ? new GridManager(this.model) : null; // GridSystem (GridLine.js)
    this.levelView = 'all'; // Level View plan filter: 'all' | level id (standard views only)
    this.bim = new BimEntityManager(this.model);      // parametric entity registry
    // Downloaded-asset instances (BlenderKit) — foreign THREE groups beside
    // the B-Rep; selAssets selects them the way selGridIds selects grids
    this.assets = new AssetManager(this);
    this.selAssets = new Set();
    this.model.assetListProvider = () => this.assets.serialize();
    // User/AI-coded parametric element types (js/script-elements.js)
    this.scriptElements = new ScriptElements.Manager(this);
    // Structural elements (columns/beams/slabs/foundations): elevation
    // datums, parametric beam sections, infill-wall clearance, quantities
    this.structural = window.StructuralManager ? StructuralManager.attach(this) : null;
    this.families = new FamilyManager();             // loadable hosted families
    this.bimOptions = {                                // Precise Drawing options bar
      baseLevel: 'lvl_1',
      topConstraint: 'unconnected', // level id | 'unconnected'
      unconnectedHeight: 3.0,
      thickness: 0.20,
      locationLine: 'centerline',   // 'centerline' | 'exterior' | 'interior'
      chain: true,
      // contextual Draw palette (DrawPrimitiveEngine)
      primitive: 'line',            // line|rect|polygon|circle|arc_ser|arc_ce|fillet|pick
      convertMode: 'slab',          // Free->BIM conversion: 'slab' | 'wall'
      family: 'door-single',        // active loadable family for hosted tools
      polygonSides: 6,
      polygonFit: 'inscribed',      // 'inscribed' | 'circumscribed'
      offset: 0,                    // dynamic parallel offset (m)
    };
    this.currentMaterial = MATERIALS[0];
    this.lockAxis = null;
    // Blender-style axis constraint (V arms it, X/Y/Z toggle axes, V exits):
    // one locked axis = move along it, two = move in their plane
    this.axisLockMode = false;
    this.axisLocks = new Set();
    this.activeGroup = null; // gid being edited (double-click to enter)
    this.axesOn = true; this.gridOn = true; this.edgesOn = true;
    this.gridSnap = false; // F9: snap drawing points to the 1 m grid
    this.shadowsOn = true; this.fogOn = true; this.xrayOn = false;
    this.faceStyle = 'shaded';

    const vp = document.getElementById('viewport');
    this.view = new Viewport(vp, this);
    this.bandEl = document.getElementById('selband');
    this.hintEl = document.getElementById('hint');
    this.vcbEl = document.getElementById('vcb');

    this.mode = 'free';         // 'free' (SketchUp-style) | 'bim' (Revit-style)
    this._initTools();
    this._initModes();
    this._initBimOptions();
    this._buildToolbar();
    this._initMenus();
    this._initSwatches();
    this._initPointer();
    this._initKeys();
    this._initDialogs();
    this._initDynInput();
    this._initSnapBar();
    // BIM element architecture: unified per-element Groups + catalog mapping
    this._tabHeld = false;      // Tab-held sub-element query mode
    this._eip = null;           // active EditInPlace session (edit-inplace.js)
    // element registry + persistent store land with their own modules —
    // guarded so the app boots before/without them (no behavior change)
    this.elements = (typeof BimElementRegistry === 'function') ? new BimElementRegistry(this) : null;
    this.db = null;             // persistent relational store (db.js) — async
    if (typeof this._initDb === 'function') this._initDb();
    if (window.Engine) Engine.bind(this);

    this.view.setShadows(true);
    this.view.setFog(true);
    this.view.rebuild();
    this.setTool('select');
    this.view.zoomExtents();
    this.updateInfo();
    this.refreshGroups();
    this._restoreAutosave();
    window.addEventListener('error', (e) => {
      // keep the stack reachable — the toast alone can't say WHERE it broke.
      // Persisted to localStorage so a crash survives the reload the user
      // does right after (read back on next boot: app.lastCrash)
      this._lastError = { message: e.message, stack: e.error && e.error.stack, at: new Date() };
      try { localStorage.setItem('websketch3d.crash', JSON.stringify(this._lastError)); } catch (e2) { }
      console.error('[uncaught]', e.message, e.error || '');
      this.toast('Error: ' + (e.message || 'unknown'), true);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      try { localStorage.setItem('websketch3d.crash', JSON.stringify({ message: r && r.message || String(r), stack: r && r.stack, at: new Date(), kind: 'promise' })); } catch (e2) { }
      console.error('[unhandled rejection]', r);
    });
    try {
      const saved = localStorage.getItem('websketch3d.crash');
      if (saved) {
        this.lastCrash = JSON.parse(saved);
        localStorage.removeItem('websketch3d.crash'); // read once
        console.warn('[previous crash]', this.lastCrash.message, this.lastCrash.stack || '');
      }
    } catch (e) { }
  }

  // ------------------------------------------------------------------ tools
  _initTools() {
    this.tools = {};
    for (const [id, Cls] of Object.entries(TOOLS)) {
      this.tools[id] = id === 'polygon' ? new CircleTool(this, true) : new Cls(this);
    }
    // SDK features register their tool classes into the same map and add a
    // ribbon entry — one register() call wires everything
    if (window.Engine) {
      for (const d of Engine.features.list('tool')) {
        if (!this.tools[d.id]) {
          this.tools[d.id] = new d.tool(this);
          if (d.icon) ICONS[d.id] = d.icon;
          const defs = TOOL_DEFS[d.mode];
          if (defs && !defs.some(t => t !== 'sep' && t.id === d.id))
            defs.push({ id: d.id, label: d.label, key: d.key || '' });
          for (const cmd of d.commands || []) ENGINE_COMMANDS.set(cmd, d.id);
        }
      }
    }
    this.tool = null;
  }

  // Replace the document's model, rebinding the managers that hold a model
  // reference (levels, BIM entities, anything else with cached .model).
  bindModel(m) {
    this.model = m;
    this.levelManager.model = m;
    this.bim.model = m;
    // pinned measurements reference world points of the old model — drop them
    if (this.view && this.view.clearPins) this.view.clearPins();
    // the grid manager holds a model reference too — rebind it and rehydrate
    // (a swapped model carries grid RECORDS until GridLine instances load)
    if (this.gridManager) {
      this.gridManager.model = m;
      this.gridManager._hydrate();
      this.view.setGrids(this.gridManager.grids, this.levelManager.levels);
      this.view.showGrids(this.mode === 'bim' && this.gridManager.grids.length > 0);
    }
    this._snapCache = null;
  }

  // ------------------------------------------------------------------ modes
  _initModes() {
    document.querySelectorAll('#modetabs .mtab').forEach(b =>
      b.addEventListener('click', () => this.setMode(b.dataset.mode)));
  }

  // ------------------------------------------------------------- BIM options bar
  _initBimOptions() {
    const el = id => document.getElementById(id);
    this._refreshLevelDropdowns();
    this.view.setLevels(this.levelManager.levels, this.gridManager ? this.gridManager.grids : []); // build reference planes up front
    this.view.setGrids(this.gridManager.grids, this.levelManager.levels);
    el('opt-height').addEventListener('change', () => {
      const v = parseFloat(el('opt-height').value);
      if (v > 0.01) this.bimOptions.unconnectedHeight = v;
    });
    el('opt-thickness').addEventListener('change', () => {
      this.bimOptions.thickness = parseFloat(el('opt-thickness').value) || 0.20;
    });
    el('opt-locline').addEventListener('change', () => {
      this.bimOptions.locationLine = el('opt-locline').value;
    });
    el('opt-chain').addEventListener('change', () => {
      this.bimOptions.chain = el('opt-chain').checked;
    });
    this._initDrawPalette();
    const sc = el('sketch-commit'), sx = el('sketch-cancel');
    if (sc) sc.addEventListener('click', () => this.sketchCommit());
    if (sx) sx.addEventListener('click', () => this.sketchCancel());
  }

  // Contextual 2D Draw palette (Revit): primitive chips shown while a sketching
  // BIM tool (Draw / Wall / Floor) is active; drives DrawPrimitiveEngine via
  // app.bimOptions.primitive.
  _initDrawPalette() {
    const el = id => document.getElementById(id);
    const row = el('drawpalette');
    if (!row) return;
    row.addEventListener('click', ev => {
      const cv = ev.target.closest('[data-cvmode]');
      if (cv) {
        this.bimOptions.convertMode = cv.dataset.cvmode;
        this._refreshDrawPalette();
        this.tool && this.tool.status && this.tool.status();
        return;
      }
      const chip = ev.target.closest('.dchip');
      if (!chip) return;
      this.bimOptions.primitive = chip.dataset.prim;
      this._refreshDrawPalette();
      if (this.tool && this.tool.engine && this.tool.engine.reset) this.tool.engine.reset();
      this.tool && this.tool.status && this.tool.status();
    });
    const sides = el('dpa-sides');
    sides.addEventListener('change', () => {
      const v = parseInt(sides.value, 10);
      if (v >= 3 && v <= 96) this.bimOptions.polygonSides = v;
      sides.value = this.bimOptions.polygonSides;
    });
    el('dpa-fit').addEventListener('change', () => { this.bimOptions.polygonFit = el('dpa-fit').value; });
    const off = el('dpa-offset');
    off.addEventListener('change', () => {
      const v = parseFloat(off.value);
      this.bimOptions.offset = isNaN(v) ? 0 : v;
      off.value = this.bimOptions.offset;
    });
    this._refreshDrawPalette();
  }
  _refreshDrawPalette() {
    const el = id => document.getElementById(id);
    const row = el('drawpalette');
    if (!row) return;
    const toolId = (this.tool && this.tool.id) || '';
    const sketchTools = ['draw', 'wall', 'floor', 'roof'].includes(toolId);
    row.classList.toggle('hidden', this.mode !== 'bim' || !(sketchTools || toolId === 'convert'));
    row.querySelectorAll('.dchip').forEach(c => {
      if (c.dataset.prim && c.dataset.prim.startsWith('cv-')) return;
      c.classList.toggle('active', c.dataset.prim === this.bimOptions.primitive);
      c.style.display = toolId === 'convert' ? 'none' : '';
    });
    row.querySelectorAll('[data-cvmode]').forEach(c => {
      c.style.display = toolId === 'convert' ? '' : 'none';
      c.classList.toggle('active', c.dataset.cvmode === this.bimOptions.convertMode);
    });
    const sides = document.getElementById('dpa-sides'), fit = document.getElementById('dpa-fit');
    if (sides) sides.style.display = toolId === 'convert' ? 'none' : '';
    if (fit) fit.style.display = toolId === 'convert' ? 'none' : '';
  }
  _refreshLevelDropdowns() {
    const el = id => document.getElementById(id);
    const base = el('opt-baselevel'), top = el('opt-topconstraint');
    if (!base) return;
    // ids the model no longer knows (deleted level, undo across a delete)
    // fall back to safe selections instead of silently desyncing the selects
    const ids = new Set(this.levelManager.levels.map(l => l.id));
    if (!ids.has(this.bimOptions.baseLevel)) this.bimOptions.baseLevel = this.levelManager.levels[0].id;
    if (this.bimOptions.topConstraint !== 'unconnected' && !ids.has(this.bimOptions.topConstraint))
      this.bimOptions.topConstraint = 'unconnected';
    const opt = (v, t, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${t}</option>`;
    base.innerHTML = this.levelManager.levels.map(l => opt(l.id, `${l.name} (${l.elevation.toFixed(2)} m)`, l.id === this.bimOptions.baseLevel)).join('');
    top.innerHTML = opt('unconnected', 'Unconnected', this.bimOptions.topConstraint === 'unconnected') +
      this.levelManager.levels.map(l => opt(l.id, `Up to ${l.name} (${l.elevation.toFixed(2)} m)`, l.id === this.bimOptions.topConstraint)).join('');
    if (!base.dataset.bound) {
      base.dataset.bound = '1';
      base.addEventListener('change', () => { this.bimOptions.baseLevel = base.value; });
      top.addEventListener('change', () => {
        this.bimOptions.topConstraint = top.value;
        el('opt-height').disabled = top.value !== 'unconnected';
      });
    }
    el('opt-height').disabled = this.bimOptions.topConstraint !== 'unconnected';
  }
  onLevelsChanged() {
    this._refreshLevelDropdowns();
    this.view.setLevels(this.levelManager.levels, this.gridManager ? this.gridManager.grids : []);
    // grids are drawn against level planes — they follow level edits too
    this.view.setGrids(this.gridManager.grids, this.levelManager.levels);
    // keep an open Levels dialog truthful across undo/redo and external edits
    const bd = document.getElementById('dialog-backdrop');
    if (bd && !bd.classList.contains('hidden') && document.getElementById('lvl-body'))
      this._renderLevelsBody();
    this._syncLevelViewControl(); // Level View options track the level list
    this._saveAutosave();
  }
  // REBUILD FROM PARAMETERS — params are the model, the B-Rep is cache.
  // Wipes all geometry and regenerates every entity against its CURRENT
  // neighbors (foundation -> column -> wall -> slab -> beam). Repairs any
  // history: corpses, stale trims, orphan lines, ring drift.
  rebuildFromParams() {
    const defs = this.bim.entities.map(e => ({ id: e.id, type: e.type, params: JSON.parse(JSON.stringify(e.params || {})) }));
    const skipped = [];
    let counts = {};
    this.run('rebuild from parameters', mm => {
      mm.bimHold = true;
      try {
        mm.faces.clear(); mm.edges.clear(); mm.vertices.clear(); mm.curves.clear();
        for (const e of this.bim.entities) { e.faces = []; e.edges = []; }
        const adopt = (ent, rolesOf) => {
          const nf = [...mm.faces.keys()].map(id => mm.faces.get(id)).filter(f => f && !f.userData);
          const roles = {}; for (const f of nf) roles[f.id] = rolesOf(f, ent);
          const ne = [];
          for (const f of nf) for (const ring of mm.rings(f)) for (let i = 0; i < ring.length; i++) {
            const e2 = mm.findEdge(ring[i], ring[(i + 1) % ring.length]);
            if (e2 && !e2.userData) ne.push(e2.id);
          }
          for (const [fid, role] of Object.entries(roles)) {
            const f = mm.faces.get(+fid);
            if (f) f.userData = { bimEntityId: ent.id, bimType: ent.type, role };
          }
          ent.faces = Object.keys(roles).map(Number);
          ent.edges = [...new Set(ne)];
          for (const eid of ent.edges) {
            const e2 = mm.edges.get(eid);
            if (e2 && !e2.userData) e2.userData = { bimEntityId: ent.id, bimType: ent.type, role: 'profile' };
          }
        };
        for (const d of defs) {
          const ent = this.bim.getEntityById(d.id);
          if (!ent) continue;
          try {
            if (d.type === 'foundation') {
              this.structural.buildFooting(G, mm, d.params);
              adopt(ent, (f) => { const c = mm.faceCentroid(f);
                return Math.abs(c.z + (d.params.thickness || 0.5)) < 1e-6 ? 'bottom' : Math.abs(c.z) < 1e-6 ? 'top' : 'side'; });
            } else if (d.type === 'column') {
              const b = d.params.base;
              ColumnFeature.placeColumn(G, mm, { x: b[0], y: b[1], z: b[2] }, d.params.width, d.params.depth, d.params.height);
              adopt(ent, (f) => { const c = mm.faceCentroid(f);
                return Math.abs(c.z - b[2]) < 1e-6 ? 'bottom' : Math.abs(c.z - (b[2] + d.params.height)) < 1e-6 ? 'top' : 'side'; });
            } else if (d.type === 'wall' && d.params.base && d.params.end) {
              const ring = this.bim.wallRing(d.params);
              const f = mm.addFaceFromRings(ring.map(q => G.clone(q)));
              if (f && mm.pushPull(f, d.params.height || 3)) adopt(ent, () => 'exterior');
            } else if (d.type === 'slab' && d.params.regions) {
              for (const r of d.params.regions) {
                const f = mm.addFaceFromRings(r.outer.map(q => G.v(...q)), (r.holes || []).map(h => h.map(q => G.v(...q))));
                if (f) mm.pushPull(f, -(d.params.thickness || 0.2));
              }
              adopt(ent, (f) => { const c = mm.faceCentroid(f); return 'edge'; });
            } else if (d.type === 'beam') {
              this.structural.buildBeam(G, mm, d.params);
              adopt(ent, () => 'body');
            } else { skipped.push(d.type); continue; }
            counts[d.type] = (counts[d.type] || 0) + 1;
          } catch (e) { /* one bad element never kills the repair */ }
        }
      } finally { mm.bimHold = false; }
    });
    this.view.rebuild(); this.updateInfo();
    const v = this.model.validate();
    this.toast(`Rebuilt from parameters: ${Object.entries(counts).map(([k, n]) => n + ' ' + k + 's').join(', ')}` +
      (skipped.length ? ` (skipped ${skipped.length} unsupported)` : '') +
      (v.ok ? ' — model valid' : ' — validate still flags issues', !v.ok));
    return { counts, skipped, valid: v.ok };
  }

  // STANDING JUNCTION RE-DERIVATION (element isolation): every element's
  // connections are DERIVED state, never placement-time history. Rebuilding
  // each element from its params re-runs the trim against CURRENT neighbors:
  // a beam end meeting a column lands on its face — whichever was drawn
  // first. Runs on load (undo/redo/file open) so pre-fix models self-heal.
  rederiveJunctions() {
    if (!this.bim) return 0;
    let n = 0;
    for (const ent of [...this.bim.entities]) {
      if (ent.type === 'beam' && this.bim.rebuildBeamEntity(ent.id)) n++;
    }
    if (n) { this.view.rebuild(); this.updateInfo(); }
    return n;
  }

  // GridSystem sync: viewport reference lines + intersection cache + db mirror.
  onGridsChanged() {
    this.gridManager._hydrate();
    // grid edits re-derive the level plane rectangles (they track the grid AABB)
    this.view.setLevels(this.levelManager.levels, this.gridManager.grids);
    this.view.setGrids(this.gridManager.grids, this.levelManager.levels, this.selGridIds.size ? this.selGridIds : (this.selGridId || null), this.selGridZ);
    this.view.showGrids(this.mode === 'bim' && this.gridManager.grids.length > 0);
    this._syncGridsToDb();
    const bd = document.getElementById('dialog-backdrop');
    if (bd && !bd.classList.contains('hidden') && document.getElementById('grid-body'))
      this._renderGridsBody();
    this._saveAutosave();
  }
  async _syncGridsToDb() {
    if (!this.db) return;
    try {
      await this.db.replaceGrids(this.gridManager.grids.map(g => g.toRecord()));
    } catch (e) { console.warn('[db] grid sync failed:', e); }
  }
  // ------------------------------------------------------ Level View (plan isolation)
  // While a standard camera view is locked (Top/Front/…), the toolbar Level
  // View select can isolate ONE level: only entities based on that level
  // (plus unowned geometry inside its elevation band) are displayed. The
  // filters are display-only — no model mutation, no undo/autosave impact.
  setStandardView(name) {
    this.view.setStandardView(name);
    if (!this.view.viewLocked && this.levelView !== 'all') this.levelView = 'all';
    this._applyLevelView();
  }
  _applyLevelView() {
    const v = this.view;
    if (this.levelView === 'all' || !v.viewLocked) {
      v.faceFilter = v.edgeFilter = v.elementFilter = null;
      v.setLevels(this.levelManager.levels);
      if (this.gridManager) v.setGrids(this.gridManager.grids, this.levelManager.levels);
    } else {
      const lvls = this.levelManager.levels;
      const i = lvls.findIndex(l => l.id === this.levelView);
      const lvl = i >= 0 ? lvls[i] : null;
      if (!lvl) { this.levelView = 'all'; return this._applyLevelView(); }
      const z0 = lvl.elevation, z1 = (i + 1 < lvls.length) ? lvls[i + 1].elevation : Infinity;
      const inBand = z => z >= z0 - 0.02 && z < z1 - 0.02;
      const entOK = ent => !!(ent && ent.params && ent.params.baseLevel === lvl.id);
      v.faceFilter = f => {
        const uid = f.userData && f.userData.bimEntityId;
        if (uid) return entOK(this.bim.getEntityById(uid));
        return inBand(this.model.faceCentroid(f).z);
      };
      v.edgeFilter = e => {
        const uid = e.userData && e.userData.bimEntityId;
        if (uid) return entOK(this.bim.getEntityById(uid));
        const a = this.model.vp(e.a), b = this.model.vp(e.b);
        return !!(a && b) && inBand((a.z + b.z) / 2);
      };
      v.elementFilter = ent => entOK(ent);
      // plan dressing: only this level's plane and grid lines at its height
      v.setLevels([lvl]);
      if (this.gridManager) v.setGrids(this.gridManager.grids, [lvl]);
      v.showLevels(this.mode === 'bim');
      if (this.gridManager) v.showGrids(this.mode === 'bim' && this.gridManager.grids.length > 0);
    }
    this.clearSelection();
    v.rebuild();
    this._syncLevelViewControl();
  }
  _syncLevelViewControl() {
    const sel = document.getElementById('levelview');
    if (!sel) return;
    const locked = !!this.view.viewLocked;
    sel.style.display = locked ? '' : 'none';
    if (!locked && this.levelView !== 'all') { this.levelView = 'all'; return this._applyLevelView(); }
    sel.innerHTML = ['<option value="all">All Levels</option>']
      .concat(this.levelManager.levels.map(l => `<option value="${l.id}">${l.name}</option>`))
      .join('');
    sel.value = this.levelView;
  }
  // Levels manager (toolbar icon / Edit ▸ Levels…). The dialog stays open
  // while rows are edited: every mutation runs as its own transaction, then
  // the body re-renders from model state.
  levelsDialog() {
    this.dialog('Levels', '<div id="lvl-body"></div>', [['Close', null]]);
    this._renderLevelsBody();
  }
  _renderLevelsBody() {
    const body = document.getElementById('lvl-body');
    if (!body) return;
    const lm = this.levelManager;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const rows = lm.levels.map((l, i) => {
      const prev = i > 0 ? lm.levels[i - 1] : null;
      const u = lm.usage(l.id);
      const usageTxt = u.total
        ? [u.basedOn ? `${u.basedOn} base${u.basedOn === 1 ? '' : 's'}` : '',
           u.constrainedTo ? `${u.constrainedTo} top${u.constrainedTo === 1 ? '' : 's'}` : '']
          .filter(Boolean).join(' · ')
        : '—';
      const gm2 = this.gridManager;
      const sysNames = gm2 ? gm2.systems() : [];
      const cur2 = l.gridSystem || '';
      const sysCell = sysNames.length
        ? `<select class="lvl-gsys" title="Assign this level to a grid line system">${['—', ...sysNames].map(n => `<option value="${esc(n)}"${cur2 === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`
        : '<span class="dim">no grids yet</span>';
      return `<tr data-lvl="${l.id}">
        <td><input class="lvl-name" value="${esc(l.name)}" title="Rename ${esc(l.name)}"></td>
        <td><input class="lvl-elev" type="number" step="0.1" value="${l.elevation}" title="Elevation in meters"></td>
        <td>${sysCell}</td>
        <td class="lvl-delta">${prev ? (l.elevation - prev.elevation).toFixed(2) + ' m' : 'ground'}</td>
        <td class="lvl-use" title="BIM entities based on / constrained to this level">${usageTxt}</td>
        <td class="lvl-id">${l.id}</td>
        <td><button class="lvl-del" title="Delete ${esc(l.name)}">✕</button></td>
      </tr>`;
    }).join('');
    const nextDefaultElev = (lm.levels[lm.levels.length - 1].elevation + 3).toFixed(1);
    body.innerHTML = `
      <table class="lvl-table">
        <thead><tr><th>Name</th><th>Elevation (m)</th><th>Grid System</th><th>Above prev.</th><th>Used by</th><th>ID</th><th></th></tr></thead>
        <tbody id="lvl-rows">${rows}</tbody>
      </table>
      <div class="lvl-add">
        <input id="lvl-name" placeholder="Name" value="Level ${lm.levels.length + 1}">
        <input id="lvl-elev" type="number" step="0.1" value="${nextDefaultElev}">
        <button id="lvl-addbtn" class="lvl-addbtn">+ Add Level</button>
      </div>
      <p class="dim">Reference planes for these levels display in Precise Drawing mode. Walls and floors snap their base to the chosen level. Edits are undoable (Ctrl+Z).</p>`;
    body.querySelectorAll('#lvl-rows tr').forEach(tr => {
      const id = tr.dataset.lvl;
      const nameIn = tr.querySelector('.lvl-name');
      const elevIn = tr.querySelector('.lvl-elev');
      nameIn.addEventListener('change', () => {
        if (!nameIn.value.trim()) {
          nameIn.value = lm.getLevel(id).name;
          return this.toast('Level name cannot be empty', true);
        }
        this.run('rename level', () => lm.updateLevel(id, { name: nameIn.value }));
        this._renderLevelsBody();
      });
      elevIn.addEventListener('change', () => {
        const v = parseFloat(elevIn.value);
        if (isNaN(v)) { elevIn.value = lm.getLevel(id).elevation; return; }
        this.run('edit level', () => lm.updateLevel(id, { elevation: v }));
        this._renderLevelsBody(); // rows are elevation-sorted, order may change
      });
      const gsys = tr.querySelector('.lvl-gsys');
      if (gsys) gsys.addEventListener('change', () => {
        const v = gsys.value === '—' ? null : gsys.value;
        this.run('assign level to grid system', () => lm.updateLevel(id, { gridSystem: v }));
        this.toast(v ? `${lm.getLevel(id).name} → grid system “${v}”` : `${lm.getLevel(id).name} unassigned`);
        this._renderLevelsBody();
      });
      tr.querySelector('.lvl-del').addEventListener('click', () => {
        const lvl = lm.getLevel(id);
        const err = lm.canRemove(id);
        if (err) return this.toast(err, true);
        this.run('delete level', () => lm.removeLevel(id));
        this.toast(`Deleted ${lvl.name}`);
        this._renderLevelsBody();
      });
    });
    body.querySelector('#lvl-addbtn').addEventListener('click', () => {
      const name = (document.getElementById('lvl-name') || {}).value;
      const elev = parseFloat((document.getElementById('lvl-elev') || {}).value);
      if (isNaN(elev)) return this.toast('Elevation must be a number (meters)', true);
      this.run('add level', () => lm.addLevel(name, elev));
      this.toast(`Level added at ${elev.toFixed(2)} m`);
      this._renderLevelsBody();
    });
  }
  // Grids manager (toolbar icon / Edit ▸ Grids…): ETABS-style quick setup on
  // top, the full grid schedule below. Same stay-open contract as Levels —
  // every mutation is its own transaction, then the body re-renders.
  gridsDialog() {
    this.dialog('Grid System', '<div id="grid-body"></div>', [['Close', null]]);
    this._renderGridsBody();
  }
  _renderGridsBody() {
    const body = document.getElementById('grid-body');
    if (!body) return;
    const gm = this.gridManager;
    gm._hydrate();
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const sysNames = gm.systems();
    const nextSys = sysNames.length && sysNames[0] !== 'Main' ? sysNames[0] : 'Main';
    const sysOptions = cur => sysNames.map(n =>
      `<option value="${esc(n)}"${(cur || 'Main') === n ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const rows = gm.grids.map(g => {
      const u = gm.usage(g.id);
      const useTxt = u.total ? [u.walls ? `${u.walls} wall${u.walls === 1 ? '' : 's'}` : '', u.columns ? `${u.columns} col${u.columns === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : '—';
      const pt = p => `${p[0].toFixed(2)}, ${p[1].toFixed(2)}`;
      return `<tr data-grid="${g.id}" title="length ${g.length().toFixed(2)} m">
        <td><input class="gr-name" value="${esc(g.name)}"></td>
        <td><input class="gr-sysrow" value="${esc(g.system || 'Main')}" title="Grid line system" style="width:86px"></td>
        <td><input class="gr-xy" value="${pt(g.start)}" title="Start X, Y (m)"></td>
        <td><input class="gr-xy" value="${pt(g.end)}" title="End X, Y (m)"></td>
        <td><select class="gr-bbl" title="Which ends show bubbles">
          ${['both', 'start', 'end', 'none'].map(b => `<option value="${b}"${g.bubbleEnd === b ? ' selected' : ''}>${b}</option>`).join('')}
        </select></td>
        <td><input class="gr-zmin" type="number" step="0.5" value="${g.verticalExtent.min}" title="Vertical extent min">
            <span class="gr-dash">–</span>
            <input class="gr-zmax" type="number" step="0.5" value="${g.verticalExtent.max}" title="Vertical extent max"></td>
        <td class="gr-use" title="Elements attached to this grid">${useTxt}</td>
        <td><button class="lvl-del gr-del" title="Delete grid ${esc(g.name)}">✕</button></td>
      </tr>`;
    }).join('');
    body.innerHTML = `
      <div class="gr-gen">
        <div class="gr-gen-title">Quick Setup — orthogonal grid (ETABS-style)</div>
        <div class="gr-gen-row">
          <label>System name <input id="gr-sys" placeholder="Main" value="${esc(nextSys)}" class="gr-lab" title="Name this grid line system — grids only interact within their own system, and levels can be assigned to one in Levels. Generate again with a new name for a second system."></label>
        </div>
        <div class="gr-gen-row">
          <label>X spacings <input id="gr-xs" placeholder="6, 6, 4.5" value="6, 6, 4.5"></label>
          <label>start <input id="gr-xl" value="1" class="gr-lab"></label>
        </div>
        <div class="gr-gen-row">
          <label>Y spacings <input id="gr-ys" placeholder="5, 5, 7" value="5, 5, 7"></label>
          <label>start <input id="gr-yl" value="A" class="gr-lab"></label>
        </div>
        <div class="gr-gen-row">
          <label>Origin X <input id="gr-ox" type="number" step="0.5" value="0" class="gr-lab" title="Where the grid system starts, in meters (world coordinates). 0, 0 = the world origin"></label>
          <label>Y <input id="gr-oy" type="number" step="0.5" value="0" class="gr-lab"></label>
        </div>
        <button id="gr-genbtn" class="lvl-addbtn">Generate Grid System</button>
      </div>
      ${gm.grids.length ? `<table class="lvl-table gr-table">
        <thead><tr><th>Name</th><th>System</th><th>Start X,Y</th><th>End X,Y</th><th>Bubbles</th><th>Extent Z (m)</th><th>Used by</th><th></th></tr></thead>
        <tbody id="gr-rows">${rows}</tbody>
      </table>` : '<p class="dim" style="margin:10px 0">No grid lines yet — generate a system above, or draw snaps stay off until grids exist.</p>'}
      <p class="dim">Grids are universal centerline references: walls/beams snap and center on them, columns center on grid intersections (A-1), and slab sketches snap to grid lines. Drag the square end grips in the viewport to stretch a grid — attached elements follow. All edits are undoable.</p>`;
    const parseXY = v => {
      const m = String(v).split(/[,;\s]+/).filter(Boolean).map(parseFloat);
      return (m.length === 2 && m.every(isFinite)) ? m : null;
    };
    body.querySelectorAll('#gr-rows tr').forEach(tr => {
      const id = tr.dataset.grid;
      const g = gm.getGrid(id);
      const nameIn = tr.querySelector('.gr-name');
      nameIn.addEventListener('change', () => {
        if (!nameIn.value.trim()) { nameIn.value = g.name; return this.toast('Grid name cannot be empty', true); }
        this.run('rename grid', () => gm.updateGrid(id, { name: nameIn.value }));
        this._renderGridsBody();
      });
      for (const [cls, key] of []) { /* placeholder */ }
      const xys = tr.querySelectorAll('.gr-xy');
      xys[0].addEventListener('change', () => {
        const p = parseXY(xys[0].value);
        if (!p) { xys[0].value = `${g.start[0].toFixed(2)}, ${g.start[1].toFixed(2)}`; return this.toast('Use "X, Y" in meters', true); }
        this.run('edit grid', () => gm.updateGrid(id, { start: p }));
        this._renderGridsBody();
      });
      xys[1].addEventListener('change', () => {
        const p = parseXY(xys[1].value);
        if (!p) { xys[1].value = `${g.end[0].toFixed(2)}, ${g.end[1].toFixed(2)}`; return this.toast('Use "X, Y" in meters', true); }
        this.run('edit grid', () => gm.updateGrid(id, { end: p }));
        this._renderGridsBody();
      });
      const sysRow = tr.querySelector('.gr-sysrow');
      if (sysRow) sysRow.addEventListener('change', () => {
        const v = sysRow.value.trim();
        if (!v) { sysRow.value = g.system || 'Main'; return this.toast('System name cannot be empty', true); }
        this.run('move grid to system', () => gm.updateGrid(id, { system: v }));
        this.toast(`Grid ${g.name} → system “${v}”`);
        this._renderGridsBody();
      });
      tr.querySelector('.gr-bbl').addEventListener('change', e => {
        this.run('edit grid', () => gm.updateGrid(id, { bubbleEnd: e.target.value }));
        this._renderGridsBody();
      });
      const zmin = tr.querySelector('.gr-zmin'), zmax = tr.querySelector('.gr-zmax');
      const extHandler = () => {
        const a = parseFloat(zmin.value), b = parseFloat(zmax.value);
        if (isNaN(a) || isNaN(b)) return this.toast('Extent must be numbers (meters)', true);
        this.run('edit grid', () => gm.updateGrid(id, { verticalExtent: { min: a, max: b } }));
        this._renderGridsBody();
      };
      zmin.addEventListener('change', extHandler);
      zmax.addEventListener('change', extHandler);
      tr.querySelector('.gr-del').addEventListener('click', () => {
        const err = gm.usage(id).total
          ? `${gm.usage(id).total} elements attached to grid ${g.name} — detach them first` : null;
        if (err) return this.toast(err, true);
        this.run('delete grid', () => gm.removeGrid(id));
        this.toast(`Deleted grid ${g.name}`);
        this._renderGridsBody();
      });
    });
    const gen = body.querySelector('#gr-genbtn');
    if (gen) gen.addEventListener('click', () => {
      let r = null;
      // user-defined origin for the whole system (defaults to 0, 0)
      const ox = parseFloat((document.getElementById('gr-ox') || {}).value);
      const oy = parseFloat((document.getElementById('gr-oy') || {}).value);
      const origin = [isFinite(ox) ? ox : 0, isFinite(oy) ? oy : 0];
      this.run('generate grids', () => {
        r = gm.generateOrthogonal({
          system: ((document.getElementById('gr-sys') || {}).value || 'Main').trim(),
          xSpacings: (document.getElementById('gr-xs') || {}).value,
          xLabel: ((document.getElementById('gr-xl') || {}).value || '1').trim(),
          ySpacings: (document.getElementById('gr-ys') || {}).value,
          yLabel: ((document.getElementById('gr-yl') || {}).value || 'A').trim(),
          origin,
        });
        if (r.error) throw new Error(r.error);
      });
      if (!r || r.error) { if (r && r.error) this.toast(r.error, true); return; }
      this.toast(`Generated ${r.grids.length} grid lines from origin (${origin[0]}, ${origin[1]})`);
      this._renderGridsBody();
    });
  }
  // Switching engines on the shared canvas/model. The protocol:
  //   1. deactivate() the active tool (runs cleanup(): overlays cleared,
  //      in-progress drawing aborted WITHOUT committing dirty geometry —
  //      tools with open transactions roll them back in their cleanup)
  //   2. swap the ribbon + UI palette
  //   3. camera, scene graph, selection, and the B-Rep stay untouched
  // ---- Revit Sketch Mode: an isolated boundary-editing state --------------
  enterSketchMode(title, onCommit, onCancel) {
    this._sketch = { title, onCommit, onCancel };
    this.clearSelection(); // selection is locked out while sketching
    this.view.setGhost(true);
    this.view.showLevels(true); // level planes guide the sketch plane
    const bar = document.getElementById('sketchbar');
    if (bar) {
      document.getElementById('sketch-title').textContent = title || 'Sketch';
      bar.classList.remove('hidden');
    }
    this.setStatus(`Sketch Mode — ${title || ''}: draw boundaries, then commit.`);
  }
  exitSketchMode() {
    this._sketch = null;
    this._liveSnaps = null; // sketch endpoints stop being snap candidates
    this.view.setGhost(false);
    this.view.showLevels(this.mode === 'bim');
    const bar = document.getElementById('sketchbar');
    if (bar) bar.classList.add('hidden');
    this.view.clearPreview();
  }
  sketchCommit() { if (this._sketch && this._sketch.onCommit) this._sketch.onCommit(); }
  sketchCancel() { if (this._sketch && this._sketch.onCancel) this._sketch.onCancel(); }

  // =========================================== BIM hierarchy (db.js/BimElement)
  // The relational database is the persistent backing store; the in-memory
  // B-Rep remains the working set. Every commit mirrors the parametric
  // entities into the Elements table (with their B-Rep), detached entities
  // delete their rows, and the catalog grows dynamic types as needed.
  async _initDb() {
    try {
      // A version upgrade can sit pending forever while an older WebSketch3D
      // tab (old cached code) still holds the previous schema open — IndexedDB
      // fires no error in that state, so race the open and degrade gracefully
      // instead of leaving the browser panels dead for the whole session.
      const opened = BimDatabase.open();
      this._dbOpenTimer = setTimeout(() => {
        const err = new Error('another WebSketch3D tab or window still holds the old database');
        err.busy = true;
        // reject the race below
        if (this._dbOpenReject) this._dbOpenReject(err);
      }, 6000);
      this.db = await Promise.race([
        opened,
        new Promise((resolve, reject) => { this._dbOpenReject = reject; })
      ]);
      clearTimeout(this._dbOpenTimer);
      await this.db.seedDefaults();
      if (this.elements) await this.elements.refreshCatalog();
      this._dbSyncDebounced();
      // user-coded element types recompile from their stored source text
      if (this.scriptElements) this.scriptElements.loadAll();
      if (window.Engine) Engine.events.emit('db:ready', { persistent: this.db.persistent });
      if (!this.db.persistent)
        console.warn('[db] using an in-memory store — project data will not survive a reload');
      this.updateInfo();
    } catch (e) {
      console.warn('[db] init failed:', e);
      clearTimeout(this._dbOpenTimer);
      // Locked-or-broken IndexedDB should not cost the user the whole app:
      // fall back to the in-memory store (this session only) and say so.
      if (BimDatabase.withMemory) {
        try {
          this.db = await BimDatabase.withMemory();
          await this.db.seedDefaults();
          if (this.elements) await this.elements.refreshCatalog();
          if (this.scriptElements) this.scriptElements.loadAll();
          if (window.Engine) Engine.events.emit('db:ready', { persistent: false });
          this.updateInfo();
          this.toast(e.busy
            ? 'Database busy — another WebSketch3D tab holds an old version. Working in a temporary store; close other tabs and reload to save permanently.'
            : 'Database unavailable (' + e.message + ') — working in a temporary store for this session.', true);
          return;
        } catch (e2) { console.warn('[db] memory fallback failed:', e2); }
      }
      this.toast('Database unavailable: ' + e.message, true);
    }
  }
  _dbSyncDebounced() {
    clearTimeout(this._dbTimer);
    this._dbTimer = setTimeout(() => { this.syncElementsToDb(); }, 700);
  }
  /** Mirror every live parametric entity into the Elements table. */
  async syncElementsToDb() {
    if (!this.db || this._eip) return; // the EIP finish path commits explicitly
    try {
      if (this.elements) await this.elements.refreshCatalog();
      const live = new Set();
      for (const ent of this.bim.entities) {
        const meta = await this.elements.ensureCatalogFor(ent);
        if (!meta) continue;
        live.add(ent.id);
        const q = this.elementQuantities(ent);
        const sub = this.model.serializeSubset({ faces: new Set(ent.faces), edges: new Set(ent.edges) });
        const roles = {};
        for (const fid of ent.faces) {
          const f = this.model.faces.get(fid);
          if (f && f.userData) roles[fid] = f.userData.role || null;
        }
        await this.db.createElement({
          id: ent.id,
          typeId: meta.typeId,
          levelId: (ent.params && ent.params.baseLevel) || null,
          transformMatrix: BimDatabase.IDENTITY, // world-space B-Rep — no instance transform yet
          name: `${meta.categoryName} ${String(ent.id).replace(/^[a-z]+_/, '')}`,
          parameters: { ...(ent.params || {}), quantities: q },
          brepData: { ...sub, roles },
        });
      }
      // rows for entities that no longer exist (detached / deleted) go away
      const rows = await this.db.getAllElements();
      for (const row of rows) if (!live.has(row.id)) await this.db.deleteElement(row.id);
      // the browser's element counts / instance lists follow the database
      if (window.ElementBrowser && ElementBrowser.visible) ElementBrowser.refresh();
    } catch (e) {
      console.warn('[db] sync failed:', e);
    }
  }
  /** Commit ONE element's updated B-Rep (Edit In Place finish). */
  async commitElementToDb(ent) {
    if (!this.db || !this.elements) return;
    try {
      const meta = await this.elements.ensureCatalogFor(ent);
      if (!meta) return;
      const q = this.elementQuantities(ent);
      const sub = this.model.serializeSubset({ faces: new Set(ent.faces), edges: new Set(ent.edges) });
      const roles = {};
      for (const fid of ent.faces) {
        const f = this.model.faces.get(fid);
        if (f && f.userData) roles[fid] = f.userData.role || null;
      }
      const row = await this.db.getElement(ent.id);
      if (row) {
        await this.db.updateElementGeometry(ent.id, {
          brepData: { ...sub, roles },
          parameters: { quantities: q },
        });
      } else {
        await this.db.createElement({
          id: ent.id, typeId: meta.typeId, levelId: (ent.params && ent.params.baseLevel) || null,
          name: `${meta.categoryName} ${String(ent.id).replace(/^[a-z]+_/, '')}`,
          parameters: { ...(ent.params || {}), quantities: q },
          brepData: { ...sub, roles },
        });
      }
    } catch (e) { console.warn('[db] element commit failed:', e); }
  }

  // ---- element-level selection (one BimElement = one selectable object) ----
  /** Selection sets covering exactly the element's faces + edges. */
  selectionForElement(ent) {
    const faces = new Set(ent.faces.filter(id => this.model.faces.has(id)));
    const edges = new Set(ent.edges.filter(id => this.model.edges.has(id)));
    for (const fid of faces) {
      const f = this.model.faces.get(fid);
      if (!f) continue;
      for (const ring of this.model.rings(f)) {
        for (let i = 0; i < ring.length; i++) {
          const e = this.model.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (e) edges.add(e.id);
        }
      }
    }
    return { faces, edges };
  }
  selectElement(entId, mode = 'replace') {
    const ent = this.bim.getEntityById(entId);
    if (!ent) return;
    if (this.isEntityLocked(entId)) {
      const ly = this.layerOf(ent);
      const why = ly && ly.locked && !ent.locked ? ` — layer "${ly.name}" is locked` : '';
      this.toast(`${ent.type} ${ent.id} is locked${why} — unlock it in the Layers panel or Element Browser`, true);
      return;
    }
    const sel = this.selectionForElement(ent);
    if (mode === 'toggle') this.toggleEntities(sel);
    else { this.sel = sel; this.onSelectionChanged(); }
  }
  /** The single element whose faces exactly match the selection, or null. */
  singleElementSelection() {
    if (!this.sel.faces.size || this.sel.edges.size > this.sel.faces.size * 12) return null;
    let ent = null;
    for (const fid of this.sel.faces) {
      const f = this.model.faces.get(fid);
      const uid = f && f.userData && f.userData.bimEntityId;
      if (!uid) return null;
      if (ent && ent.id !== uid) return null;
      if (!ent) ent = this.bim.getEntityById(uid);
      if (!ent) return null;
    }
    if (!ent) return null;
    const want = new Set(ent.faces.filter(id => this.model.faces.has(id)));
    for (const fid of this.sel.faces) if (!want.has(fid)) return null;
    return want.size === this.sel.faces.size ? ent : null;
  }
  elementForFace(fid) {
    const f = this.model.faces.get(fid);
    const uid = f && f.userData && f.userData.bimEntityId;
    return uid ? this.bim.getEntityById(uid) : null;
  }
  // ---------------------------------------------- project item lock & hide
  // Flags live on the entity/level/grid objects themselves (deep-snapshotted
  // with the model), so they survive undo, autosave and file round-trips.
  // Locked items refuse selection, deletion and direct edits; hidden items
  // leave the render and every pick path entirely.
  /** The entity's layer record ('0' when unknown — model.load sanitizes). */
  layerOf(ent) {
    const ls = this.model.layers || [];
    return (ent && ls.find(l => l.id === ent.layerId)) || ls.find(l => l.id === '0') || ls[0];
  }
  isEntityLocked(id) {
    const e = this.bim.getEntityById(id);
    if (!e) return false;
    const ly = this.layerOf(e);
    return !!(e.locked || (ly && ly.locked));
  }
  isFaceLocked(f) {
    const uid = f && f.userData && f.userData.bimEntityId;
    return uid ? this.isEntityLocked(uid) : false;
  }
  isEdgeLocked(e) {
    const uid = e && e.userData && e.userData.bimEntityId;
    return uid ? this.isEntityLocked(uid) : false;
  }
  isEntityHidden(id) {
    const e = this.bim.getEntityById(id);
    if (!e) return false;
    const ly = this.layerOf(e);
    return !!(e.hidden || (ly && ly.visible === false));
  }
  // Edge ownership drives hide: a wall's outlines must vanish with its faces.
  // Rebuild paths (joins, resizes, grid moves, hosted re-cuts) restamp FACES
  // but can leave regenerated edges anonymous — restamp from ent.edges before
  // any render sync so no element hides "half".
  refreshEdgeStamps() {
    for (const ent of this.bim.entities)
      for (const eid of ent.edges) {
        const e = this.model.edges.get(eid);
        if (e && !(e.userData && e.userData.bimEntityId))
          e.userData = { bimEntityId: ent.id, bimType: ent.type, role: 'profile' };
      }
  }
  /** Toggle lock/hidden on a BIM element, grid line, or level.
   * patch: { locked?: bool, hidden?: bool } */
  setItemFlags(kind, id, patch, lvlId) {
    // bulk master over a set of ELEMENTS (category header in the browser):
    // id is a comma-joined entity id list — one rebuild, one notification
    if (kind === 'elements') {
      const ids = String(id).split(',').filter(Boolean);
      const live = ids.map(x => this.bim.getEntityById(x)).filter(Boolean);
      if (!live.length) return;
      // live-state toggle targets (stale-click safe, like the grid masters)
      const eff = {};
      if (patch.hidden != null) eff.hidden = live.every(e => e.hidden) ? false : patch.hidden;
      if (patch.locked != null) eff.locked = live.every(e => e.locked) ? false : patch.locked;
      for (const ent of live) {
        if (eff.hidden != null) ent.hidden = eff.hidden;
        if (eff.locked != null) ent.locked = eff.locked;
        if (eff.hidden || eff.locked) {
          for (const fid of ent.faces) this.sel.faces.delete(fid);
          for (const eid of ent.edges) this.sel.edges.delete(eid);
        }
      }
      // elements on OFF layers stay invisible despite the master SHOW — hint
      if (eff.hidden === false) {
        const off = new Set();
        for (const ent of live) {
          const ly = this.layerOf(ent);
          if (ly && ly.visible === false) off.add(ly.name);
        }
        if (off.size) this.toast(`Layer${off.size === 1 ? ' "' + [...off][0] + '" is' : 's ' + [...off].join(', ') + ' are'} OFF — the Layers panel controls them`, true);
      }
      this.onSelectionChanged();
      this.refreshEdgeStamps();
      this.view.rebuild();
      this._saveAutosave();
      if (window.ElementBrowser) ElementBrowser.refresh();
      return;
    }
    // ONE grid, ONE level: hidden is per (grid, level) — hiding a grid on
    // Level 1 must not hide it on Level 2
    if (kind === 'grid-at' && lvlId) {
      const g = this.gridManager && this.gridManager.getGrid(id);
      if (!g) return;
      g.hiddenLevels = g.hiddenLevels || [];
      if (patch.hidden === true) {
        if (!g.hiddenLevels.includes(lvlId)) g.hiddenLevels.push(lvlId);
      } else if (patch.hidden === false) {
        g.hidden = false; // showing here never keeps a global hide
        g.hiddenLevels = g.hiddenLevels.filter(x => x !== lvlId);
      }
      if (patch.locked != null) g.locked = !!patch.locked;
      this.onGridsChanged();
      if (window.ElementBrowser) ElementBrowser.refresh();
      return;
    }
    // bulk masters from the Element Browser: one click, every grid in the
    // group flips, ONE notification (a 100-grid level must not rebuild ×100)
    if (kind === 'grid-level' || kind === 'grids-all') {
      const gm = this.gridManager;
      if (!gm) return;
      let ids, lvl = null;
      if (kind === 'grids-all') {
        ids = gm.grids.map(g => g.id);
      } else {
        lvl = this.levelManager.getLevel(id);
        if (!lvl) return;
        ids = gm.grids.filter(g => g.covers(lvl.elevation)).map(g => g.id);
      }
      if (!ids.length) return;
      // toggle targets derive from LIVE state, not the (possibly stale, mid-
      // refresh) button class — rapid clicks always flip in the right direction
      const get = gid => gm.getGrid(gid);
      const stateOf = key => ids.every(gid => { const g = get(gid); if (!g) return true;
        return key === 'hidden'
          ? (lvl ? g.hiddenAt(lvl.id) : !!g.hidden)   // per-level visibility
          : !!g[key]; });
      const eff = {};
      if (patch.hidden != null) eff.hidden = stateOf('hidden') ? false : patch.hidden;
      if (patch.locked != null) eff.locked = stateOf('locked') ? false : patch.locked;
      let n = 0;
      for (const gid of ids) {
        const g = get(gid);
        if (!g) continue;
        if (eff.hidden === true && lvl) {
          g.hiddenLevels = g.hiddenLevels || [];
          if (!g.hiddenLevels.includes(lvl.id)) g.hiddenLevels.push(lvl.id);
        } else if (eff.hidden === false && lvl) {
          g.hidden = false;
          g.hiddenLevels = g.hiddenLevels.filter(x => x !== lvl.id);
        } else {
          g.hidden = eff.hidden;
          if (eff.hidden === false) g.hiddenLevels = []; // master SHOW clears per-level hides too
        }
        if (eff.locked != null) g.locked = eff.locked;
        n++;
      }
      if (n) this.onGridsChanged();
      if (window.ElementBrowser) ElementBrowser.refresh();
      return;
    }
    if (kind === 'element') {
      const ent = this.bim.getEntityById(id);
      if (!ent) return;
      // showing a single element can't beat a layer that is OFF — say so
      // instead of silently leaving it invisible
      if (patch.hidden === false) {
        const ly = this.layerOf(ent);
        if (ly && ly.visible === false && !ent.hidden) {
          this.toast(`Layer "${ly.name}" is OFF — turn it on in the Layers panel to see ${ent.id}`, true);
          if (window.ElementBrowser) ElementBrowser.refresh();
          return;
        }
      }
      Object.assign(ent, patch);
      if (patch.locked || patch.hidden) { // locked/hidden things can't stay selected
        for (const fid of ent.faces) this.sel.faces.delete(fid);
        for (const eid of ent.edges) this.sel.edges.delete(eid);
        this.onSelectionChanged();
      }
      this.refreshEdgeStamps();
      this.view.rebuild();
      this._saveAutosave();
    } else if (kind === 'grid') {
      const g = this.gridManager && this.gridManager.getGrid(id);
      if (!g) return;
      Object.assign(g, patch);
      this.onGridsChanged();
    } else if (kind === 'level') {
      const l = this.levelManager.getLevel(id);
      if (!l) return;
      Object.assign(l, patch);
      this.onLevelsChanged();
    }
    if (window.ElementBrowser) ElementBrowser.refresh();
  }

  // ------------------------------------------------------------------ layers
  // AutoCAD-style layers: every BIM entity sits on exactly one layer
  // (entity.layerId; '0' is the undeletable default). Layer OFF hides its
  // elements from the render AND every pick path; layer LOCK refuses
  // selection and edits; layer COLOR tints its elements ("ByLayer").
  // New elements land on the current layer. Structural layer ops are
  // transaction-wrapped (undoable); flag toggles follow the hide/lock
  // convention of setItemFlags (direct + autosave).
  get layers() { return this.model.layers; }
  getLayer(id) { return this.model.layers.find(l => l.id === id) || null; }
  get currentLayerId() { return this.model.currentLayerId; }
  _uniqueLayerName(base, exceptId) {
    const names = new Set(this.model.layers
      .filter(l => l.id !== exceptId).map(l => l.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    let n = 2;
    while (names.has(`${base} ${n}`.toLowerCase())) n++;
    return `${base} ${n}`;
  }
  addLayer(name) {
    name = this._uniqueLayerName((String(name || '').trim() || 'Layer'));
    let n = 2;
    while (this.model.layers.some(l => l.id === 'lyr_' + n)) n++;
    const ly = { id: 'lyr_' + n, name, color: null, visible: true, locked: false };
    this.run('add layer', () => this.model.layers.push(ly));
    this.onLayersChanged();
    this.toast(`Layer "${name}" created — new elements land on the current layer`);
    return ly;
  }
  renameLayer(id, name) {
    if (id === '0') { this.toast('Layer 0 cannot be renamed', true); return; }
    const ly = this.getLayer(id);
    if (!ly) return;
    name = String(name || '').trim();
    if (!name || name === ly.name) return;
    const final = this._uniqueLayerName(name, id);
    this.run('rename layer', () => { ly.name = final; });
    this.onLayersChanged();
    this.toast(final === name ? `Layer renamed to "${final}"` : `Name taken — renamed to "${final}"`);
  }
  /** Direct layer state: { visible?, locked?, color? } — one rebuild, one
   *  notification, selection purged of newly hidden/locked elements. */
  setLayerFlags(id, patch) {
    const ly = this.getLayer(id);
    if (!ly) return;
    Object.assign(ly, patch);
    if (patch.visible === false || patch.locked === true) {
      for (const ent of this.bim.entities) {
        if (ent.layerId !== id) continue;
        for (const fid of ent.faces) this.sel.faces.delete(fid);
        for (const eid of ent.edges) this.sel.edges.delete(eid);
      }
      this.onSelectionChanged();
    }
    this.onLayersChanged();
  }
  /** New elements are created on this layer (AutoCAD "current layer"). */
  setCurrentLayer(id) {
    if (!this.getLayer(id)) return;
    if (this.model.currentLayerId === id) return;
    this.model.currentLayerId = id;
    this._saveAutosave(); // survives reload with the drawing
    if (window.LayerPanel) LayerPanel.refresh();
    this.toast(`Current layer: "${this.getLayer(id).name}" — new elements go there`);
  }
  /** Move every element touched by the selection onto a layer (undoable). */
  assignSelectionToLayer(layerId) {
    const ly = this.getLayer(layerId);
    if (!ly) return;
    const ents = new Set();
    const byId = uid => { const e = uid && this.bim.getEntityById(uid); if (e) ents.add(e); };
    for (const fid of this.sel.faces) {
      const f = this.model.faces.get(fid);
      byId(f && f.userData && f.userData.bimEntityId);
    }
    for (const eid of this.sel.edges) {
      const e = this.model.edges.get(eid);
      byId(e && e.userData && e.userData.bimEntityId);
    }
    if (!ents.size) { this.toast('Select elements first — free-drawn geometry has no layer', true); return; }
    const n = ents.size;
    this.run('assign layer', () => { for (const ent of ents) ent.layerId = layerId; });
    this.onLayersChanged();
    this.toast(`${n} element${n === 1 ? '' : 's'} moved to layer "${ly.name}"`);
  }
  /** Layer isolation (AutoCAD LAYISO): show only this layer's elements. */
  isolateLayer(id) {
    const ly = this.getLayer(id);
    if (!ly) return;
    for (const l of this.model.layers) l.visible = l.id === id;
    // elements on other layers just went hidden — purge them from selection
    for (const ent of this.bim.entities) {
      if (ent.layerId === id) continue;
      for (const fid of ent.faces) this.sel.faces.delete(fid);
      for (const eid of ent.edges) this.sel.edges.delete(eid);
    }
    this.onSelectionChanged();
    this.onLayersChanged();
    this.toast(`Isolated layer "${ly.name}" — Show All restores the rest`);
  }
  showAllLayers() {
    for (const ly of this.model.layers) ly.visible = true;
    this.onLayersChanged();
    this.toast('All layers shown');
  }
  /** Select every element on a layer (locked layers refuse, like picks). */
  selectLayerElements(id) {
    const ly = this.getLayer(id);
    if (!ly) return;
    const ents = this.bim.entities.filter(e => e.layerId === id);
    if (!ents.length) { this.toast(`Layer "${ly.name}" has no elements`); return; }
    if (ents.some(e => this.isEntityLocked(e.id))) {
      this.toast(`A layer "${ly.name}" element is locked — unlock it first`, true); return;
    }
    const faces = new Set(), edges = new Set();
    for (const ent of ents) {
      const s = this.selectionForElement(ent);
      for (const f of s.faces) faces.add(f);
      for (const e of s.edges) edges.add(e);
    }
    this.selGridId = null;
    this.sel = { faces, edges };
    this.onSelectionChanged();
    this.toast(`${ents.length} element${ents.length === 1 ? '' : 's'} on "${ly.name}" selected`);
  }
  /** Delete a layer. Empty layers go directly; a loaded one asks first:
   *  move its elements to layer 0 (keep) or erase them with the layer. */
  deleteLayer(id) {
    if (id === '0') { this.toast('Layer 0 cannot be deleted — it is the default', true); return; }
    const ly = this.getLayer(id);
    if (!ly) return;
    const ents = this.bim.entities.filter(e => e.layerId === id);
    if (!ents.length) { this._deleteLayerNow(id, 'move'); this.toast(`Layer "${ly.name}" deleted`); return; }
    const n = ents.length;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    this.dialog(`Delete layer "${ly.name}"?`, `
      <p>Layer <b>${esc(ly.name)}</b> still holds <b>${n}</b> element${n === 1 ? '' : 's'}.</p>
      <p style="opacity:.75;font-size:12px">Move them to layer 0 (nothing is erased), or delete the elements together with the layer.</p>`,
      [
        ['Cancel', null],
        [`Move ${n} to layer 0`, () => { this._deleteLayerNow(id, 'move'); this.toast(`Layer "${ly.name}" deleted — ${n} element${n === 1 ? '' : 's'} moved to layer 0`); }],
        [`Delete layer + ${n} element${n === 1 ? '' : 's'}`, () => { this._deleteLayerNow(id, 'delete'); this.toast(`Layer "${ly.name}" and its ${n} element${n === 1 ? '' : 's'} deleted`); }],
      ]);
  }
  _deleteLayerNow(id, mode) {
    const ents = this.bim.entities.filter(e => e.layerId === id);
    this.run('delete layer', m => {
      if (mode === 'delete') {
        // erase the elements' B-Rep: opDone reaps the entities + db rows
        const edgeIds = [];
        for (const ent of ents) {
          for (const fid of ent.faces) m.deleteFace(fid);
          for (const eid of ent.edges) if (!edgeIds.includes(eid)) edgeIds.push(eid);
        }
        if (edgeIds.length) m.deleteEdgeIds(edgeIds);
        for (const ent of ents) { // purge selection immediately
          for (const fid of ent.faces) this.sel.faces.delete(fid);
          for (const eid of ent.edges) this.sel.edges.delete(eid);
        }
      } else {
        for (const ent of ents) ent.layerId = '0';
      }
      this.model.layers = this.model.layers.filter(l => l.id !== id);
      if (this.model.currentLayerId === id) this.model.currentLayerId = '0';
    });
    this.onLayersChanged();
  }
  /** Post-layer-change sync: one rebuild + autosave + panel refreshes. */
  onLayersChanged() {
    this.refreshEdgeStamps();
    this.view.rebuild();
    this._saveAutosave();
    if (window.LayerPanel) LayerPanel.refresh();
    if (window.ElementBrowser) ElementBrowser.refresh();
  }
  /** Context-menu "Move to Layer…": lists layers; a click assigns the
   *  elements (picked entity + selection) and closes. */
  moveSelectionToLayerDialog() {
    const ents = new Set();
    const byId = uid => { const e = uid && this.bim.getEntityById(uid); if (e) ents.add(e); };
    for (const fid of this.sel.faces) {
      const f = this.model.faces.get(fid);
      byId(f && f.userData && f.userData.bimEntityId);
    }
    for (const eid of this.sel.edges) {
      const e = this.model.edges.get(eid);
      byId(e && e.userData && e.userData.bimEntityId);
    }
    if (!ents.size) { this.toast('Select elements first — free-drawn geometry has no layer', true); return; }
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const n = ents.size;
    const rows = this.model.layers.map(ly => {
      const cnt = this.bim.entities.filter(e => e.layerId === ly.id).length;
      const cur = [...ents].every(e => e.layerId === ly.id);
      return `<div class="mlay-row${cur ? ' cur' : ''}" data-lid="${esc(ly.id)}"
        title="${cur ? 'Already on this layer' : `Move ${n} element${n === 1 ? '' : 's'} here`}"
        style="display:flex;align-items:center;gap:8px;padding:5px 8px;margin:3px 0;border:1px solid var(--line,#ccc);border-radius:6px;cursor:pointer">
        <span style="width:10px;height:10px;border-radius:3px;flex:none;background:${ly.color || '#c3c9cf'}"></span>
        <b>${esc(ly.name)}</b>${cur ? ' <span style="opacity:.6;font-size:11px">· current</span>' : ''}
        <span style="margin-left:auto;opacity:.6;font-size:11px">${cnt} element${cnt === 1 ? '' : 's'}</span>
      </div>`;
    }).join('');
    this.dialog(`Move ${n} element${n === 1 ? '' : 's'} to layer`, `
      <p style="opacity:.75;margin:2px 0 8px;font-size:12px">Pick the destination layer — the move is undoable (Ctrl+Z).</p>
      <div id="mlay-list">${rows}
        <div class="mlay-row" data-lid="__new"
          style="display:flex;align-items:center;gap:8px;padding:5px 8px;margin:3px 0;border:1px dashed var(--line,#ccc);border-radius:6px;cursor:pointer;color:#3e66c4">
          <span style="width:10px;height:10px;border-radius:3px;flex:none;background:#3e66c4"></span>
          <b>New layer…</b>
        </div>
      </div>`,
      [['Cancel', null]]);
    const list = document.getElementById('mlay-list');
    if (!list) return;
    list.addEventListener('click', ev => {
      const row = ev.target.closest('.mlay-row');
      if (!row) return;
      this.closeDialog();
      if (row.dataset.lid === '__new') {
        const ly = this.addLayer(`Layer ${this.model.layers.length}`);
        if (ly) this.assignEntitiesToLayer([...ents].map(e => e.id), ly.id);
        return;
      }
      this.assignEntitiesToLayer([...ents].map(e => e.id), row.dataset.lid);
    });
  }
  /** Assign a fixed set of entities (undoable) — the panel and the context
   *  menu share it; assignSelectionToLayer resolves the set from a live
   *  selection instead. */
  assignEntitiesToLayer(entIds, layerId) {
    const ly = this.getLayer(layerId);
    if (!ly || !entIds.length) return;
    const live = entIds.map(id => this.bim.getEntityById(id)).filter(Boolean);
    if (!live.length) return;
    const n = live.length;
    this.run('assign layer', () => { for (const ent of live) ent.layerId = layerId; });
    this.onLayersChanged();
    this.toast(`${n} element${n === 1 ? '' : 's'} moved to layer "${ly.name}"`);
  }
  /** Quantities for the properties panel and the database record. */
  elementQuantities(ent) {
    const m = this.model;
    const faces = ent.faces.map(id => m.faces.get(id)).filter(Boolean);
    let area = 0, openings = 0;
    for (const f of faces) {
      area += m.faceArea(f); // net: holes (openings) already deducted
      if (f.holes && f.holes.length)
        for (const h of f.holes) openings += G.loopArea(m.pts(h));
    }
    let volume = null;
    if (faces.length && m.shellOpenEdges(ent.faces) === 0) volume = m.shellVolume(ent.faces);
    const vids = new Set();
    for (const f of faces) for (const ring of m.rings(f)) ring.forEach(v => vids.add(v));
    const bb = vids.size ? m.bbox([...vids]) : null;
    return {
      faces: faces.length,
      area,        // net (openings deducted)
      gross: area + openings,
      openings,
      volume,
      bbox: bb ? {
        min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z],
        size: [bb.size.x, bb.size.y, bb.size.z],
      } : null,
    };
  }

  // ---- Edit In Place (the Free Drawing bridge — edit-inplace.js) ----------
  enterEditInPlace(entId) {
    if (this._eip) { this.toast('An Edit In Place session is already active', true); return; }
    if (this._sketch) { this.toast('Finish the active sketch first', true); return; }
    const ent = this.bim.getEntityById(entId);
    if (!ent) return;
    ent.faces = ent.faces.filter(id => this.model.faces.has(id));
    if (!ent.faces.length) { this.toast('That element has no geometry to edit', true); return; }
    const snapshot = this.model.serialize();
    // isolate: hide every face/edge that does not belong to the element (the
    // B-Rep kernel skips hidden geometry in every operation, so Free tools
    // can only reach the isolated mesh)
    const keepFaces = new Set(ent.faces);
    const keepEdges = new Set(ent.edges);
    for (const fid of keepFaces) {
      const f = this.model.faces.get(fid);
      if (f) for (const ring of this.model.rings(f)) {
        for (let i = 0; i < ring.length; i++) {
          const e = this.model.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (e) keepEdges.add(e.id);
        }
      }
    }
    const hiddenF = [], hiddenE = [];
    const preHiddenF = [], preHiddenE = [];
    for (const [fid, f] of this.model.faces) {
      if (f.hidden) { preHiddenF.push(fid); continue; }
      if (!keepFaces.has(fid)) { f.hidden = true; hiddenF.push(fid); }
    }
    for (const [eid, e] of this.model.edges) {
      if (e.hidden) { preHiddenE.push(eid); continue; }
      if (!keepEdges.has(eid)) { e.hidden = true; hiddenE.push(eid); }
    }
    if (typeof EditInPlace !== 'function') { this.toast('Edit-in-place module not loaded yet', true); return; }
    this._eip = new EditInPlace(this, ent, snapshot, hiddenF, hiddenE, preHiddenF, preHiddenE);
    this._eip.enter();
    this.view.rebuild();
    this.view.zoomExtents();
  }
  finishEditInPlace() {
    if (!this._eip) return;
    const session = this._eip;
    // finish() keeps the session alive (banner + bimHold) on validation
    // failure — only a successful finish commits the B-Rep to the database
    if (session.finish()) this.commitElementToDb(session.ent);
  }
  cancelEditInPlace() { if (this._eip) this._eip.cancel(); }
  // Edit ▸ Edit In Place… — acts on the single selected element
  editInPlaceFromSelection() {
    const ent = this.singleElementSelection();
    if (!ent) { this.toast('Select a single BIM element first (a wall, slab, door…)'); return; }
    this.enterEditInPlace(ent.id);
  }

  // ---- type switching from the properties panel / Element Browser ----------
  applyElementType(ent, typeRec) {
    if (!ent || !typeRec) return;
    const p = typeRec.defaultParameters || {};
    const info = this.elements ? this.elements.catalogInfoFor(ent) : null;
    const cat = (info && info.categoryName) || '';
    if (cat === 'Wall' && ent.type === 'wall' && !ent.params.closed) {
      if (!(p.thickness > 0)) { this.toast('That type has no thickness', true); return; }
      this.run('change type', () => {
        ent.params.thickness = p.thickness;
        if (p.defaultHeight > 0) ent.params.height = p.defaultHeight;
        // synchronized junction re-solve: the connected walls regenerate
        // together, so the corner miter follows the new thickness on BOTH
        // sides (no stale bevel, no orphaned wedge at the junction)
        this.bim.rebuildWallGroup(ent.id);
      });
      this.bimOptions.thickness = p.thickness;
      this.toast(`Wall type: ${typeRec.name}`);
    } else if ((ent.type === 'door' || ent.type === 'window') && p.width > 0) {
      this.run('change type', () => {
        ent.params.width = p.width;
        ent.params.height = p.height || ent.params.height;
        if (p.sill != null) ent.params.sillHeight = p.sill;
        const hostId = ent.params.hostWallId;
        if (hostId && this.bim.getEntityById(hostId)) this.bim.rebuildWallWithHosts(hostId);
      });
      this.toast(`${cat || ent.type} type: ${typeRec.name}`);
    } else {
      this.toast(`${typeRec.name} applies to new placements`);
      return;
    }
    // the rebuild replaced every face id — re-select the element so the
    // selection (and this panel) survive the type change, and re-resolve the
    // entity's catalog type from the NEW parameters so the dropdown, the
    // geometry and the params can never disagree again
    this.selectElement(ent.id);
    this.updateInfo();
    if (this.elements && this.elements.refreshTypeFor) {
      this.elements.refreshTypeFor(ent).then(() => { this.updateInfo(); }).catch(() => { });
    }
  }

  setMode(mode) {
    if (mode === this.mode || !TOOL_DEFS[mode]) return;
    // Edit In Place owns the mode until finished/cancelled (the session's own
    // switches pass through via _switching)
    if (this._eip && !(this._eip._switching)) {
      this.toast('Finish (✓) or cancel (✕) Edit In Place first', true);
      return;
    }
    if (this.tool) this.tool.deactivate();
    this.tool = null;
    this.lockAxis = null;
    this.axisLockMode = false;
    this.axisLocks.clear();
    this.mode = mode;
    document.querySelectorAll('#modetabs .mtab').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mode));
    document.body.classList.toggle('mode-bim', mode === 'bim');
    document.getElementById('bimoptions').classList.toggle('hidden', mode !== 'bim');
    this.view.showLevels(mode === 'bim');
    this.view.showGrids(mode === 'bim' && this.gridManager.grids.length > 0);
    this._buildToolbar();
    this.setTool(TOOL_DEFS[mode][0].id);
    this.setStatus(`Mode: ${mode === 'bim' ? 'Precise Drawing (BIM)' : 'Free Drawing'} — camera, selection, and model are preserved.`);
  }
  // The drawing plane spanned by a two-axis lock (V + X/Z etc.) through the
  // anchor — vertical and angled sketch planes for the line/arc/circle tools.
  // null when no two-axis lock is active.
  lockedPlane(anchor) {
    if (!anchor || this.axisLocks.size !== 2) return null;
    const [a1, a2] = [...this.axisLocks];
    const n = G.norm(G.cross(AXES[a1], AXES[a2]));
    return { n, d: G.dot(n, anchor) };
  }

  // Exit the Blender-style axis-constraint modal and clear its locks
  clearAxisLocks() {
    this.axisLockMode = false;
    this.axisLocks.clear();
    this.lockAxis = null;
    this._axisLockUI();
  }
  _axisLockUI() {
    let chip = document.getElementById('axislockchip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'axislockchip';
      document.getElementById('viewport').appendChild(chip);
    }
    const axes = [...this.axisLocks];
    if (!this.axisLockMode) {
      chip.style.display = 'none';
      chip.textContent = '';
      this.setStatus(this.tool ? this.tool.hint : '');
      return;
    }
    chip.style.display = 'block';
    chip.className = 'on ' + axes.join('');
    const names = { x: 'X (red)', y: 'Y (green)', z: 'Z (blue)' };
    chip.textContent = axes.length === 0
      ? 'Axis lock armed: press X, Y or Z  (V exits)'
      : axes.length === 1
        ? `Locked to ${names[axes[0]]} — press another axis for its plane, V exits`
        : `Locked to the ${axes.join('+').toUpperCase()} plane — press an axis to drop it, V exits`;
    this.setStatus(chip.textContent);
  }
  // ---- AutoCAD-style dynamic input -------------------------------------
  // A length/angle tooltip near the cursor while a drawing tool has a live
  // segment: typing digits opens it on the Length field, Tab toggles
  // Length <-> Angle, Enter commits, Esc closes it. Tools opt in by exposing
  // dynSpec() (live values), dynApply({length, angle}) and dynCommit().
  _initDynInput() {
    const vp = document.getElementById('viewport');
    const box = document.createElement('div');
    box.id = 'dyninput';
    box.innerHTML = '<span class="dlab">Length</span><input id="dyn-len" autocomplete="off" spellcheck="false">'
      + '<span class="dlab">Angle</span><input id="dyn-ang" autocomplete="off" spellcheck="false">'
      + '<span class="dtab">Tab</span>';
    vp.appendChild(box);
    box.style.display = 'none';
    this.dynEl = box;
    this.dynLen = box.querySelector('#dyn-len');
    this.dynAng = box.querySelector('#dyn-ang');
    this.dyn = { open: false, focus: 'len' };
    vp.addEventListener('pointermove', e => {
      this._dynPos = { x: e.clientX, y: e.clientY };
      if (this.dyn.open) this._dynPosition();
    }, true);
    for (const [inp, key] of [[this.dynLen, 'len'], [this.dynAng, 'ang']]) {
      inp.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this.dynCommit(); }
        else if (e.key === 'Tab') { e.preventDefault(); this.dynFocus(this.dyn.focus === 'len' ? 'ang' : 'len'); }
        else if (e.key === 'Escape') { e.preventDefault(); this.dynHide(); }
      });
      inp.addEventListener('input', () => this.dynApply());
    }
  }
  dynSupported() {
    return this.tool && typeof this.tool.dynSpec === 'function' && this.tool.dynSpec();
  }
  dynOpen(focus = 'len') {
    if (!this.dynSupported()) return;
    this.dyn.open = true;
    this.dynEl.style.display = 'flex';
    this._dynPosition();
    this.dynFillFromTool();
    this.dynFocus(focus);
  }
  _dynPosition() {
    const vp = document.getElementById('viewport').getBoundingClientRect();
    const p = this._dynPos || { x: vp.x + vp.width / 2, y: vp.y + vp.height / 2 };
    this.dynEl.style.left = Math.min(Math.max(p.x - vp.x + 18, 4), Math.max(vp.width - 200, 4)) + 'px';
    this.dynEl.style.top = Math.min(Math.max(p.y - vp.y + 24, 4), Math.max(vp.height - 46, 4)) + 'px';
  }
  dynFocus(which) {
    this.dyn.focus = which;
    const el = which === 'len' ? this.dynLen : this.dynAng;
    el.focus();
    el.select();
  }
  dynFillFromTool() {
    const spec = this.dynSupported();
    if (!spec) return;
    if (document.activeElement !== this.dynLen && this.dyn.focus !== 'len')
      this.dynLen.value = spec.length != null ? (+spec.length.toFixed(3)).toString() : '';
    if (document.activeElement !== this.dynAng && this.dyn.focus !== 'ang')
      this.dynAng.value = spec.angle != null ? (+spec.angle.toFixed(1)).toString() : '';
  }
  dynApply() {
    const spec = this.dynSupported();
    if (!spec) return this.dynHide();
    const L = parseFloat(this.dynLen.value);
    const A = parseFloat(this.dynAng.value);
    this.tool.dynApply({
      length: isFinite(L) && L > 0 ? L : (spec.length || 1),
      angle: isFinite(A) ? A : (spec.angle || 0),
    });
  }
  dynCommit() {
    if (!this.dyn.open) return;
    this.dynApply();
    const t = this.tool;
    this.dynHide();
    if (t && t.dynCommit) t.dynCommit();
  }
  dynHide() {
    if (!this.dyn) return;
    this.dyn.open = false;
    this.dynEl.style.display = 'none';
    if (document.activeElement && this.dynEl.contains(document.activeElement)) document.activeElement.blur();
  }

  _toolForKey(k) {
    for (const t of TOOL_DEFS[this.mode]) {      if (t !== 'sep' && t.key && t.key.toLowerCase() === k) return t.id;
    }
    return null;
  }
  setTool(id) {
    if (this.tool) this.tool.deactivate();
    this._liveSnaps = null; // a leaving tool's sketch endpoints are stale
    this.tool = this.tools[id] || this.tools.select;
    this.tool.activate();
    // SDK feature tools receive their descriptor + feature-owned options
    if (window.Engine) {
      const d = Engine.features.get(id);
      if (d) { this.tool.feature = d; this.tool.state = d.state || {}; if (d.onCreate) d.onCreate(this.tool); }
    }
    this.lockAxis = null;
    this.clearAxisLocks();
    if (this.dynHide) this.dynHide();
    this.view.clearPreview();
    this.view.hideSnapDot();
    document.querySelectorAll('#toolbar .tbtn[data-tool]').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === id));
    this.setStatus(this.tool.hint);
    vpCursor(this.tool.id);
    this._refreshDrawPalette && this._refreshDrawPalette();
  }

  // ------------------------------------------------------------------ toolbar
  _buildToolbar() {
    const bar = document.getElementById('toolbar');
    bar.innerHTML = ''; // full ribbon swap per mode
    const mk = (html, title, cls = '', dataset = '', click = null) => {
      const b = document.createElement('button');
      b.className = 'tbtn ' + cls;
      b.innerHTML = html;
      b.title = title;
      if (dataset) for (const [k, v] of Object.entries(JSON.parse(dataset))) b.dataset[k] = v;
      if (click) b.addEventListener('click', click);
      bar.appendChild(b);
      return b;
    };
    for (const t of TOOL_DEFS[this.mode]) {
      if (t === 'sep') { const s = document.createElement('div'); s.className = 'tsep'; bar.appendChild(s); continue; }
      const key = t.key ? ` (${t.key === 'Space' ? 'Space' : t.key})` : '';
      mk(ICONS[t.id], t.label + key, '', JSON.stringify({ tool: t.id }), () => this.setTool(t.id));
    }
    // project levels live in Precise Drawing mode — icon opens the manager
    if (this.mode === 'bim') {
      bar.appendChild(Object.assign(document.createElement('div'), { className: 'tsep' }));
      mk(ICONS.levels, 'Levels — view / add / edit project levels', '', '{}', () => this.levelsDialog());
      mk(ICONS.grids, 'Grids — generate / edit the grid system (snap targets)', '', '{}', () => this.gridsDialog());
      // Level View: per-level plan isolation — appears only while a standard
      // camera view (Top/Front/…) is locked; pick a level to show just it
      const lvSel = document.createElement('select');
      lvSel.id = 'levelview';
      lvSel.title = 'Level View — show only one level while a standard view (Top/Front…) is active';
      lvSel.style.display = 'none';
      lvSel.addEventListener('change', () => { this.levelView = lvSel.value; this._applyLevelView(); });
      bar.appendChild(lvSel);
    }
    bar.appendChild(Object.assign(document.createElement('div'), { className: 'tsep' }));
    this.btnExtents = mk(ICONS.zoomext, 'Zoom Extents (Ctrl+Shift+E)', '', '{}', () => this.view.zoomExtents());
    this.btnUndo = mk(ICONS.undo, 'Undo (Ctrl+Z)', '', '{}', () => this.undo());
    this.btnRedo = mk(ICONS.redo, 'Redo (Ctrl+Y)', '', '{}', () => this.redo());
    bar.appendChild(Object.assign(document.createElement('div'), { className: 'tsep' }));
    this.btnShadow = mk(ICONS.shadow, 'Toggle Shadows', 'toggle on', '{}', () => this.action('toggleShadows'));
    this.btnXray = mk(ICONS.xray, 'Toggle X-Ray', 'toggle', '{}', () => this.action('toggleXray'));
    this.btnWire = mk(ICONS.wire, 'Face Style: Shaded / Monochrome / Wireframe', 'toggle', '{}', () => this.action('cycleFaceStyle'));
    bar.appendChild(Object.assign(document.createElement('div'), { className: 'tsep' }));
    this.btnBrowser = mk(ICONS.browser || ICONS.levels, 'Element Browser — Category ➔ Family ➔ Type palette (drag a type into the viewport to place it)', 'toggle', '{}', () => this.toggleElementBrowser());
    this.btnLayers = mk(ICONS.layers || ICONS.browser, 'Layers — AutoCAD-style layer manager (assign elements, on/off, lock, color, current layer)', 'toggle', '{}', () => this.toggleLayersPanel());
    this.btnFamilies = mk(ICONS.families || ICONS.browser, 'Families — parametric design catalog (column styles: classical, regional, modern, structural); size one and place it', 'toggle', '{}', () => this.toggleFamiliesPanel());
    this.btnKit = mk(ICONS.blenderkit, 'BlenderKit Assets — search free models and drop them into the scene (needs the local bridge: npm run bridge; GLB-badged models import without Blender)', 'toggle', '{}', () => this.toggleBlenderKit());
    this._syncLevelViewControl(); // populate/show the Level View select if a standard view is locked
    this.refreshToolbar();
  }
  refreshToolbar() {
    this.btnShadow.classList.toggle('on', this.shadowsOn);
    this.btnXray.classList.toggle('on', this.xrayOn);
    const fs = { shaded: 'Shaded', monochrome: 'Monochrome', wireframe: 'Wireframe' }[this.faceStyle];
    this.btnWire.classList.toggle('on', this.faceStyle !== 'shaded');
    this.btnWire.title = `Face Style: ${fs} (click to cycle)`;
    if (this.btnBrowser && window.ElementBrowser)
      this.btnBrowser.classList.toggle('on', ElementBrowser.visible);
    if (this.btnLayers && window.LayerPanel)
      this.btnLayers.classList.toggle('on', LayerPanel.visible);
    if (this.btnFamilies && window.FamiliesPanel)
      this.btnFamilies.classList.toggle('on', FamiliesPanel.visible);
    if (this.btnKit && window.BlenderKitBrowser)
      this.btnKit.classList.toggle('on', BlenderKitBrowser.visible);
  }
  // Element Browser palette (ui-browser.js) — toolbar toggle
  toggleElementBrowser(force) {
    if (window.ElementBrowser) ElementBrowser.toggle(force);
    this.refreshToolbar();
  }
  // Layers palette (ui-layers.js) — toolbar toggle
  toggleLayersPanel(force) {
    if (window.LayerPanel) LayerPanel.toggle(force);
    this.refreshToolbar();
  }
  // Families palette (ui-families.js) — toolbar toggle
  toggleFamiliesPanel(force) {
    if (window.FamiliesPanel) FamiliesPanel.toggle(force);
    this.refreshToolbar();
  }
  // BlenderKit Assets palette (BlenderKitBrowser.js) — toolbar toggle
  toggleBlenderKit(force) {
    if (window.BlenderKitBrowser) BlenderKitBrowser.toggle(force);
    this.refreshToolbar();
  }

  // ------------------------------------------------------------------ menus
  _initMenus() {
    const bar = document.getElementById('menubar');
    const defs = [
      ['File', [
        ['New', 'new', ''], ['Open…', 'open', ''], ['Open .blend…', 'openBlend', ''], ['Save As…', 'save', ''],
        '-', ['Export PNG', 'exportPng', ''], ['Export glTF…', 'exportGltf', ''],
      ]],
      ['Edit', [
        ['Undo', 'undo', 'Ctrl+Z'], ['Redo', 'redo', 'Ctrl+Y'], '-',
        ['Cut', 'cut', 'Ctrl+X'], ['Copy', 'copy', 'Ctrl+C'], ['Paste', 'paste', 'Ctrl+V'],
        ['Delete', 'deleteSelection', 'Del'], '-',
        ['Select All', 'selectAll', 'Ctrl+A'], ['Deselect All', 'deselect', ''],
        ['Clean Up Stray Lines', 'cleanupWires', ''],
        ['Unhide All Edges', 'unhideAll', ''],
        ['Reverse Faces', 'reverseFaces', ''], '-',
        ['Group', 'group', 'Ctrl+G'],
        ['Ungroup', 'ungroup', 'Ctrl+Shift+G'],
        ['Give Thickness…', 'thicken', ''], '-',
        ['Edit In Place…', 'editInPlace', ''],
        ['Levels…', 'levels', ''],
        ['Grids…', 'grids', ''],
        ['Rebuild from Parameters', 'rebuildParams', ''],
        ['Hide Selected', 'hideSelected', ''], ['Unhide All', 'unhideAll', ''],
      ]],
      ['View', [
        ['Axes', 'toggleAxes', '', 'axesOn'], ['Grid & Ground', 'toggleGrid', '', 'gridOn'], ['Grid Snap (F9)', 'toggleGridSnap', '', 'gridSnap'],
        ['Edges', 'toggleEdges', '', 'edgesOn'], ['Shadows', 'toggleShadows', '', 'shadowsOn'],
        ['Fog', 'toggleFog', '', 'fogOn'], ['X-Ray', 'toggleXray', '', 'xrayOn'], '-',
        ['Face Style: Shaded', 'styleShaded', '', 'fs:shaded'],
        ['Face Style: Monochrome', 'styleMono', '', 'fs:monochrome'],
        ['Face Style: Wireframe', 'styleWire', '', 'fs:wireframe'],
        '-', ['Schedules…', 'schedules', ''],
      ]],
      ['Camera', [
        ['Perspective', 'projPersp', '', 'proj:persp'],
        ['Parallel Projection', 'projOrtho', '', 'proj:ortho'], '-',
        ['Standard View: Iso', 'viewIso', ''], ['Standard View: Top', 'viewTop', ''],
        ['Standard View: Bottom', 'viewBottom', ''], ['Standard View: Front', 'viewFront', ''],
        ['Standard View: Back', 'viewBack', ''], ['Standard View: Left', 'viewLeft', ''],
        ['Standard View: Right', 'viewRight', ''], '-',
        ['Zoom Extents', 'zoomExtents', 'Ctrl+Shift+E'],
      ]],
      ['Draw', [
        ['Line', 'toolLine', 'L'], ['Arc', 'toolArc', 'A'], ['Circle', 'toolCircle', 'C'],
        ['Polygon', 'toolPolygon', ''], ['Rectangle', 'toolRect', 'R'],
      ]],
      ['Tools', [
        ['Select', 'toolSelect', 'Space'], ['Eraser', 'toolEraser', 'E'],
        ['Paint Bucket', 'toolPaint', 'B'], ['Move', 'toolMove', 'M'],
        ['Rotate', 'toolRotate', 'Q'], ['Scale', 'toolScale', 'S'],
        ['Push/Pull', 'toolPushpull', 'P'], ['Offset', 'toolOffset', 'F'],
        ['Scripted Element…', 'openScript', ''],
        ['Resize Wall', 'toolResize', 'W'],
        ['Tape Measure', 'toolTape', 'T'], ['Orbit', 'toolOrbit', 'O'], ['Pan', 'toolPan', 'H'],
      ]],
      ['Help', [
        ['SketchUp Feature List & Status', 'features', ''], ['About WebSketch', 'about', ''],
      ]],
    ];
    this._menuDefs = defs;
    for (const [name, items] of defs) {
      const m = document.createElement('div');
      m.className = 'menu';
      const t = document.createElement('div');
      t.className = 'menu-title';
      t.textContent = name;
      const dd = document.createElement('div');
      dd.className = 'dropdown';
      m.append(t, dd);
      m.addEventListener('mousedown', e => e.stopPropagation());
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openMenu(m, name, items);
      });
      t.addEventListener('mouseenter', () => {
        if (document.querySelector('.menu.open') && !m.classList.contains('open'))
          this._openMenu(m, name, items);
      });
      bar.appendChild(m);
    }
    window.addEventListener('mousedown', () => this._closeMenus());
  }
  _openMenu(m, name, items) {
    this._closeMenus();
    const dd = m.querySelector('.dropdown');
    dd.innerHTML = '';
    for (const it of items) {
      if (it === '-') { dd.appendChild(Object.assign(document.createElement('div'), { className: 'msep' })); continue; }
      const [label, action, shortcut, flag] = it;
      const el = document.createElement('div');
      el.className = 'mitem';
      let mark = '';
      if (flag) {
        if (flag.startsWith('fs:')) mark = this.faceStyle === flag.slice(3) ? '●' : '○';
        else if (flag.startsWith('proj:')) mark = ((this.view.cam.ortho ? 'ortho' : 'persp') === flag.slice(5)) ? '●' : '○';
        else mark = this[flag] ? '✓' : '';
      }
      el.innerHTML = `<span class="mcheck">${mark}</span><span class="mlabel">${label}</span><span class="mkey">${shortcut}</span>`;
      el.addEventListener('click', () => { this._closeMenus(); this.action(action); });
      dd.appendChild(el);
    }
    m.classList.add('open');
  }
  _closeMenus() { document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')); }

  action(name, arg) {
    const A = this;
    const map = {
      new: () => A.confirmDialog('Start a new model? Unsaved changes will be lost.', () => {
        A.bindModel(new Model()); A.undoStack = []; A.redoStack = [];
        A.exitGroup();
        A.clearSelection(); A.view.rebuild(); A.updateInfo(); A.refreshGroups(); A._saveAutosave();
        if (A.db) A.db.replaceAllElements([]).catch(() => { }); // empty model = empty Elements table
      }),
      open: () => document.getElementById('fileinput').click(),
      openBlend: () => document.getElementById('blendinput').click(),
      openScript: () => { if (this.scriptElements) this.scriptElements.openEditor(); },
      save: () => A.saveFile(),
      exportPng: () => A.view.exportPNG(),
      undo: () => A.undo(), redo: () => A.redo(),
      cut: () => { A.copySel(); A.deleteSelection(); },
      copy: () => A.copySel(),
      paste: () => A.paste(),
      deleteSelection: () => A.deleteSelection(),
      cleanupWires: () => A.cleanupWires(),
      unhideAll: () => A.unhideAllEdges(),
      exportGltf: () => A.exportGltf(),
      editInPlace: () => A.editInPlaceFromSelection(),
      levels: () => A.levelsDialog(),
      schedules: () => (window.SchedulesUI && SchedulesUI.open()),
      grids: () => A.gridsDialog(),
      rebuildParams: () => A.rebuildFromParams(),
      selectAll: () => {
        A.sel = { edges: new Set([...A.model.edges.keys()]), faces: new Set([...A.model.faces.keys()]) };
        A.onSelectionChanged();
      },
      deselect: () => A.clearSelection(),
      reverseFaces: () => {
        if (!A.sel.faces.size) return A.toast('Select faces to reverse');
        A.run('reverse faces', m => {
          for (const id of A.sel.faces) { const f = m.faces.get(id); if (f) f.loop.reverse(); }
        });
      },
      hideSelected: () => {
        A.run('hide', m => {
          for (const id of A.sel.faces) { const f = m.faces.get(id); if (f) f.hidden = true; }
          for (const id of A.sel.edges) { const e = m.edges.get(id); if (e) e.hidden = true; }
        });
        A.clearSelection();
      },
      unhideAll: () => {
        A.run('unhide', m => {
          for (const f of m.faces.values()) f.hidden = false;
          for (const e of m.edges.values()) e.hidden = false;
        });
      },
      toggleAxes: () => { A.axesOn = !A.axesOn; A.view.setAxes(A.axesOn); },
      toggleGrid: () => { A.gridOn = !A.gridOn; A.view.setGrid(A.gridOn); },
      toggleGridSnap: () => A.toggleGridSnap(),
      toggleEdges: () => { A.edgesOn = !A.edgesOn; A.view.setEdges(A.edgesOn); },
      toggleShadows: () => { A.shadowsOn = !A.shadowsOn; A.view.setShadows(A.shadowsOn); },
      toggleFog: () => { A.fogOn = !A.fogOn; A.view.setFog(A.fogOn); },
      toggleXray: () => { A.xrayOn = !A.xrayOn; A.view.setXray(A.xrayOn); },
      styleShaded: () => A.setFaceStyle('shaded'),
      styleMono: () => A.setFaceStyle('monochrome'),
      styleWire: () => A.setFaceStyle('wireframe'),
      cycleFaceStyle: () => {
        const order = ['shaded', 'monochrome', 'wireframe'];
        A.setFaceStyle(order[(order.indexOf(A.faceStyle) + 1) % 3]);
      },
      projPersp: () => { A.view.cam.ortho = false; },
      projOrtho: () => { A.view.cam.ortho = true; },
      viewIso: () => A.setStandardView('iso'),
      viewTop: () => A.setStandardView('top'),
      viewBottom: () => A.setStandardView('bottom'),
      viewFront: () => A.setStandardView('front'),
      viewBack: () => A.setStandardView('back'),
      viewLeft: () => A.setStandardView('left'),
      viewRight: () => A.setStandardView('right'),
      zoomExtents: () => A.view.zoomExtents(),
      toolLine: () => A.setTool('line'), toolArc: () => A.setTool('arc'),
      toolCircle: () => A.setTool('circle'), toolPolygon: () => A.setTool('polygon'),
      toolRect: () => A.setTool('rect'), toolSelect: () => A.setTool('select'),
      toolEraser: () => A.setTool('eraser'), toolPaint: () => A.setTool('paint'),
      toolMove: () => A.setTool('move'), toolRotate: () => A.setTool('rotate'),
      toolScale: () => A.setTool('scale'), toolPushpull: () => A.setTool('pushpull'),
      toolOffset: () => A.setTool('offset'), toolTape: () => A.setTool('tape'),
      toolResize: () => A.setTool('resize'),
      toolOrbit: () => A.setTool('orbit'), toolPan: () => A.setTool('pan'),
      group: () => A.groupSelection(),
      ungroup: () => A.ungroupSelection(),
      thicken: () => A.thickenDialog(),
      features: () => A.showFeatures(),
      about: () => A.dialog('About WebSketch 3D',
        `<div class="about">
          <div class="about-name">WebSketch 3D</div>
          <p>A SketchUp-style 3D modeler that runs entirely in your browser.</p>
          <p>Built with Three.js + a custom edge/face solid modeler (auto-facing,
          push/pull, healing) and a SketchUp-like inference engine.</p>
          <p class="dim">See Help ▸ SketchUp Feature List for everything implemented vs. planned.</p>
        </div>`, [['Close', null]]),
    };
    const fn = map[name];
    if (fn) fn(arg);
    this.refreshToolbar();
  }
  setFaceStyle(s) {
    this.faceStyle = s;
    this.view.setFaceStyle(s);
    this.refreshToolbar();
  }

  // ------------------------------------------------------------------ materials
  _initSwatches() {
    const wrap = document.getElementById('swatches');
    for (const m of MATERIALS) {
      const d = document.createElement('div');
      d.className = 'swatch';
      d.title = m.name;
      const col = m.color || 'transparent';
      const bg = m.alpha < 1
        ? `repeating-conic-gradient(${col} 0% 25%, #ffffff 0% 50%) 50% / 10px 10px`
        : col;
      d.style.background = bg;
      if (!m.color) { d.classList.add('default'); d.textContent = '×'; }
      d.addEventListener('click', () => {
        this.currentMaterial = m;
        wrap.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
        d.classList.add('active');
        if (this.tool && this.tool.id === 'paint') this.setStatus(this.tool.hint);
      });
      wrap.appendChild(d);
    }
    wrap.firstChild.classList.add('active');
  }
  setMaterialFromColor(color, alpha) {
    if (!color) { this.currentMaterial = MATERIALS[0]; return; }
    const found = MATERIALS.find(m => m.color && m.color.toLowerCase() === color.toLowerCase() && m.alpha === (alpha ?? 1));
    this.currentMaterial = found || { name: 'Sampled', color, alpha: alpha == null ? 1 : alpha };
  }

  // ------------------------------------------------------------------ pointer
  _initPointer() {
    const canvas = this.view.canvas;
    canvas.addEventListener('pointerdown', (ev) => {
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* capture is optional; some synthetic/stylus pointers have no id */ }
      if (ev.button === 1) {
        this.nav = { mode: ev.shiftKey ? 'pan' : 'orbit', last: this.view.eventPt(ev) };
        ev.preventDefault();
        return;
      }
      if (ev.button === 0) {
        const grip = this._gridGripAt(ev);
        if (grip) { this._gridDrag = grip; ev.preventDefault(); return; }
        this.tool.onDown(ev);
      }
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (this.nav) {
        const q = this.view.eventPt(ev);
        if (this.nav.mode === 'orbit') this.view.orbit(q.x - this.nav.last.x, q.y - this.nav.last.y);
        else this.view.pan(q.x - this.nav.last.x, q.y - this.nav.last.y);
        this.nav.last = q;
        return;
      }
      if (this._gridDrag) { this._gridDragMove(ev); return; }
      this.tool.onMove(ev);
    });
    canvas.addEventListener('pointerup', (ev) => {
      if (this.nav && ev.button === 1) { this.nav = null; return; }
      if (ev.button === 0 && this._gridDrag) { this._gridDragEnd(); return; }
      if (ev.button === 0) this.tool.onUp(ev);
    });
    canvas.addEventListener('dblclick', (ev) => { this.tool.onDoubleClick(ev); });
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.view.zoomBy(Math.pow(1.1, -ev.deltaY / 100));
    }, { passive: false });
    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (this.nav) return;
      this._showContextMenu(ev);
    });
    const fi = document.getElementById('fileinput');
    fi.addEventListener('change', () => {
      const f = fi.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          this.model.load(JSON.parse(r.result));
          this.undoStack = [];
          this.redoStack = [];
          this.clearSelection();
          if (this.view.clearPins) this.view.clearPins();
          this.view.rebuild();
          if (this.assets && this.model.assetListData) this.assets.restore(this.model.assetListData);
          this.onLevelsChanged(); // datum view layers follow the loaded model
          this.onGridsChanged();
          this.rederiveJunctions(); // junctions re-derived against loaded neighbors
          this.view.zoomExtents();
          this.updateInfo();
          this.syncElementsToDb(); // the database mirrors the loaded model
          this.toast('Model loaded');
        } catch (e) { this.toast('Could not read that file', true); }
      };
      r.readAsText(f);
      fi.value = '';
    });
    const bi = document.getElementById('blendinput');
    if (bi) bi.addEventListener('change', () => {
      const f = bi.files[0];
      if (!f) return;
      bi.value = '';
      this.openBlendFile(f);
    });
  }

  // File ▸ Open .blend… — the bridge converts the upload via headless
  // Blender (needs Blender on this machine), the GLB lands as a regular
  // asset instance: selectable, movable, definable as door/window, cached
  // in IndexedDB so it survives reloads. See server/blenderkitBridge.js.
  async openBlendFile(file) {
    const bridge = (window.BLENDERKIT_BRIDGE_URL || 'http://localhost:3001').replace(/\/$/, '');
    const t0 = performance.now();
    this.setStatus(`Converting “${file.name}” via Blender… (first run can take a minute)`);
    try {
      const res = await fetch(`${bridge}/api/convert-upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j && j.error) || `bridge HTTP ${res.status}`);
      }
      const rec = await this.assets.placeGlbBuffer(await res.arrayBuffer(), file.name.replace(/\.blend$/i, ''));
      this.view.zoomExtents();
      this.selectAsset(rec.id);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      this.setStatus(`Opened “${rec.name}” in ${secs} s — click it to select, M to move, ⚙ to define as a door/window`);
      this.toast(`Opened “${rec.name}” in ${secs} s`);
    } catch (e) {
      const msg = (e instanceof TypeError)
        ? `bridge offline at ${bridge} — start it with "npm run bridge"`
        : (e.message || String(e));
      this.toast(`Could not open “${file.name}”: ${msg}`, true);
      this.setStatus(`Could not open “${file.name}”: ${msg}`, true);
    }
  }

  // ------------------------------------------------------------------ keys
  _initKeys() {
    window.addEventListener('keydown', (ev) => {
      const inVCB = ev.target === this.vcbEl;
      const k = ev.key;

      if (inVCB) {
        if (k === 'Enter') {
          const v = this.vcbEl.value.trim();
          if (v) {
            const ok = this.tool && this.tool.onVCB(v);
            if (!ok) this.toast('Not a valid value for this tool', true);
          }
          this.vcbEl.value = '';
          this.vcbEl.blur();
          ev.preventDefault();
        } else if (k === 'Escape') {
          this.vcbEl.value = '';
          this.vcbEl.blur();
          if (this.tool && this.tool.onKey({ key: 'Escape' })) { }
          ev.preventDefault();
        }
        return;
      }

      // A focused form control owns its keys: typing in the Properties panel
      // or the command bar must land in the field — not steal focus to the
      // VCB, trigger tool shortcuts, or delete geometry with Backspace.
      const tgt = ev.target;
      if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return;

      // Blender-style axis constraint: while armed (V), X/Y/Z toggle axes in
      // the lock set — one axis locks movement to it, two lock it to their
      // plane; toggling a selected axis removes it, V (or Esc) exits
      if (this.axisLockMode) {
        const kl = k.toLowerCase();
        if (k === 'Escape' || kl === 'v') {
          ev.preventDefault();
          this.clearAxisLocks();
          return;
        }
        if (kl === 'x' || kl === 'y' || kl === 'z') {
          ev.preventDefault();
          if (this.axisLocks.has(kl)) this.axisLocks.delete(kl); else this.axisLocks.add(kl);
          this.lockAxis = this.axisLocks.size === 1 ? [...this.axisLocks][0] : null;
          this._axisLockUI();
          return;
        }
      }
      if (k.toLowerCase() === 'v' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        // while placing doors/windows/openings, V toggles the sill lock —
        // the vertical axis stops following the cursor and only the typed
        // sill moves the opening (V again releases it)
        const ht = this.tool;
        if (ht && ['door', 'window', 'opening'].includes(ht.id)) {
          ev.preventDefault();
          ht.onKey({ key: 'v' });
          return;
        }
        ev.preventDefault();
        this.axisLockMode = true;
        this.axisLocks.clear();
        this.lockAxis = null;
        this._axisLockUI();
        return;
      }

      // F9 toggles grid snapping (AutoCAD convention) — the status-bar
      // SNAP chip mirrors the state
      if (k === 'F9') {
        ev.preventDefault();
        this.toggleGridSnap();
        return;
      }

      // arrows: axis lock
      if (k === 'ArrowRight') { this.lockAxis = 'x'; ev.preventDefault(); return; }
      if (k === 'ArrowLeft') { this.lockAxis = 'y'; ev.preventDefault(); return; }
      if (k === 'ArrowUp') { this.lockAxis = 'z'; ev.preventDefault(); return; }
      if (k === 'ArrowDown') { this.lockAxis = null; ev.preventDefault(); return; }

      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey) {
        const kl = k.toLowerCase();
        if (kl === 'z') { ev.preventDefault(); this.undo(); return; }
        if (kl === 'y') { ev.preventDefault(); this.redo(); return; }
        if (kl === 'a') { ev.preventDefault(); this.action('selectAll'); return; }
        if (kl === 'c') { ev.preventDefault(); this.copySel(); return; }
        if (kl === 'x') { ev.preventDefault(); this.action('cut'); return; }
        if (kl === 'v') { ev.preventDefault(); this.paste(); return; }
        if (kl === 'g') { ev.preventDefault(); this.action('group'); return; }
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey) {
        const kl = k.toLowerCase();
        if (kl === 'z') { ev.preventDefault(); this.redo(); return; }
        if (kl === 'e') { ev.preventDefault(); this.view.zoomExtents(); return; }
        if (kl === 'g') { ev.preventDefault(); this.action('ungroup'); return; }
      }

      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

      if (k === 'Escape') {
        if (this.activeGroup != null) { this.exitGroup(); ev.preventDefault(); return; }
        if (this.tool && this.tool.onKey({ key: 'Escape' })) { ev.preventDefault(); return; }
        if (this._eip) { this.cancelEditInPlace(); ev.preventDefault(); return; } // nothing pending → cancel the session
        this.clearSelection();
        this._closeMenus();
        this.closeDialog();
        return;
      }
      if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); this.deleteSelection(); return; }
      if (k === 'Enter') {
        // hosted placement: Enter commits at the current hover/pin position
        const ht = this.tool;
        if (ht && ht.enterPlace && ['door', 'window', 'opening'].includes(ht.id) && ht.enterPlace()) {
          ev.preventDefault(); return;
        }
        // sketch mode (floor boundaries etc.): Enter commits the sketch —
        // the same as the ✓ button, so keyboard-only flows never strand a
        // drawn shape with no visible way to finish it
        if (this._sketch) { this.sketchCommit(); ev.preventDefault(); return; }
        this.vcbEl.focus(); ev.preventDefault(); return;
      }

      // typing a number => AutoCAD dynamic input (when the tool supports it)
      // or the measurements box
      if (/^[0-9.\-]$/.test(k)) {
        if (this.dynSupported()) { this.dynOpen('len'); return; } // no preventDefault: the digit lands in the field
        this.vcbEl.focus();
        return; // let the character land in the input
      }
      // Tab switches the dynamic input field (Length <-> Angle)
      if (k === 'Tab' && this.dyn && this.dyn.open) {
        ev.preventDefault();
        this.dynFocus(this.dyn.focus === 'len' ? 'ang' : 'len');
        return;
      }
      // Tab (held) arms the sub-element query mode: hovering an element
      // raycasts down to individual faces/edges with their measurements.
      // Keyup releases it; focus never leaves the canvas.
      if (k === 'Tab') {
        ev.preventDefault();
        this._tabHeld = true;
        return;
      }
      // tool shortcuts — scoped to the active mode's ribbon
      const t = this._toolForKey(k === ' ' ? 'space' : k.toLowerCase());
      if (t) { ev.preventDefault(); this.setTool(t); return; }
      if (k.toLowerCase() === 'z' && !ev.ctrlKey && this.mode === 'free') { ev.preventDefault(); this.setTool('zoom'); return; }
    });
    window.addEventListener('keyup', (ev) => {
      if (ev.key === 'Tab') this._tabHeld = false;
    });
  }

  // ------------------------------------------------------------------ context menu
  _showContextMenu(ev) {
    const menu = document.getElementById('ctxmenu');
    const pick = this.pickEntity(ev);
    const items = [];
    if (pick.group != null) {
      const g = this.model.groups.get(pick.group);
      items.push([`Edit Group "${g ? g.name : ''}"`, () => this.enterGroup(pick.group)]);
      items.push(['Rename Group…', () => this.renameGroupDialog(pick.group)]);
      items.push(['Select Group', () => this.selectGroup(pick.group)]);
      if (g && g.solid) items.push(['Make Hollow', () => this.makeSolid(pick.group, false)]);
      else {
        const ent = this.model.groupEntities(pick.group);
        if (ent.faces.size && this.model.shellOpenEdges([...ent.faces]) === 0)
          items.push(['Make Full (solid)', () => this.makeSolid(pick.group, true)]);
      }
      items.push(['Ungroup', () => { this.selectGroup(pick.group); this.ungroupSelection(); }]);
      items.push(null);
    }
    if (pick.face != null) {
      const f = this.model.faces.get(pick.face);
      const pent = f && this.bim.getEntityForFace(f);
      if (pent && !this._eip) items.push([`Edit In Place — ${pent.type} ${pent.id}`, () => this.enterEditInPlace(pent.id)]);
      items.push([`Paint (${this.currentMaterial.name})`, () => {
        this.run('paint', m => { const ff = m.faces.get(pick.face); if (ff) { ff.color = this.currentMaterial.color; ff.alpha = this.currentMaterial.alpha; } });
      }]);
      items.push(['Reverse Face', () => { this.run('reverse face', m => { const ff = m.faces.get(pick.face); if (ff) ff.loop.reverse(); }); }]);
      items.push(['Push/Pull', () => this.setTool('pushpull')]);
      items.push(['Resize Wall (W)', () => this.setTool('resize')]);
      items.push(null);
      items.push(['Erase Face', () => { this.run('erase face', m => m.deleteFace(pick.face)); }]);
    }
    if (pick.edges && pick.edges.length) {
      items.push(['Erase Edge', () => { this.run('erase edge', m => m.deleteEdgeIds(pick.edges)); }]);
    }
    if (this.sel.faces.size || this.sel.edges.size) {
      items.push(null);
      const wholeGroup = this.singleGroupSelection();
      if (wholeGroup != null) {
        items.push(['Rename Group…', () => this.renameGroupDialog(wholeGroup)]);
        if (this.model.groups.get(wholeGroup)?.solid) items.push(['Make Hollow', () => this.makeSolid(wholeGroup, false)]);
        else if (this.model.shellOpenEdges([...this.model.groupEntities(wholeGroup).faces]) === 0)
          items.push(['Make Full (solid)', () => this.makeSolid(wholeGroup, true)]);
      } else {
        items.push(['Group Selection (Ctrl+G)', () => this.action('group')]);
      }
      if (this.sel.faces.size) items.push(['Give Thickness…', () => this.action('thicken')]);
      // Convert selected FREE face(s) straight to a BIM element — the
      // draw ➔ select ➔ convert workflow without switching tools. A single
      // face converts by sweeping it; a multi-face body (a rect with
      // thickness) is claimed whole through the dialog.
      if (this.sel.faces.size) {
        const selFaces = [...this.sel.faces].map(id => this.model.faces.get(id)).filter(Boolean);
        const free = selFaces.length
          && selFaces.every(f => !(f.userData && f.userData.bimEntityId)
            && this.model.faceArea(f) > 1e-6
            && !G.isZero(G.loopNormal(this.model.pts(f.loop))));
        if (free && window.BimTools && BimTools.ConvertTool) {
          if (selFaces.length === 1) {
            const f = selFaces[0];
            const convert = mode => () => {
              BimTools.ConvertTool.convertFace(this, f, mode);
              this.clearSelection();
            };
            items.push(['Convert to Floor', convert('floor')]);
            items.push(['Convert to Slab', convert('slab')]);
            items.push(['Convert to Wall', convert('wall')]);
            items.push(['Convert to Column', convert('column')]);
            items.push(['Convert to Beam', convert('beam')]);
          }
          items.push([selFaces.length === 1
            ? 'Convert to Element…'
            : `Convert ${selFaces.length} Faces to Element…`,
            () => this.convertToElementDialog(selFaces.map(f => f.id))]);
        }
      }
      items.push([`Erase Selection (Del)`, () => this.deleteSelection()]);
      if (this.sel.faces.size && !wholeGroup) items.push(['Reverse Faces', () => this.action('reverseFaces')]);
      items.push(['Hide', () => this.action('hideSelected')]);
    }
    // Layers: assignment rides the context menu — the picked element plus
    // every element touched by the selection (AutoCAD's "Move to layer")
    {
      const layerEnts = new Set();
      if (pick.face != null) {
        const pf = this.model.faces.get(pick.face);
        const pe = pf && this.bim.getEntityForFace(pf);
        if (pe) layerEnts.add(pe);
      }
      for (const fid of this.sel.faces) {
        const f = this.model.faces.get(fid);
        const e = f && this.bim.getEntityForFace(f);
        if (e) layerEnts.add(e);
      }
      for (const eid of this.sel.edges) {
        const e = this.model.edges.get(eid);
        const ent = e && e.userData && this.bim.getEntityById(e.userData.bimEntityId);
        if (ent) layerEnts.add(ent);
      }
      if (layerEnts.size) {
        const ly = this.layerOf([...layerEnts][0]);
        const same = [...layerEnts].every(e => e.layerId === ([...layerEnts][0]).layerId);
        const scope = layerEnts.size === 1 ? '' : ` ${layerEnts.size} elements`;
        items.push([`Move${scope} to Layer…${same && ly ? ` (on: ${ly.name})` : ''}`,
          () => this.moveSelectionToLayerDialog()]);
      }
    }
    items.push(null);
    items.push(['Select All (Ctrl+A)', () => this.action('selectAll')]);
    items.push(['Deselect', () => this.clearSelection()]);
    items.push(['Layers…', () => this.toggleLayersPanel(true)]);
    items.push(['Undo', () => this.undo()]);

    menu.innerHTML = '';
    for (const it of items) {
      if (!it) { menu.appendChild(Object.assign(document.createElement('div'), { className: 'msep' })); continue; }
      const el = document.createElement('div');
      el.className = 'mitem';
      el.innerHTML = `<span class="mlabel">${it[0]}</span>`;
      el.addEventListener('click', () => { menu.classList.add('hidden'); it[1](); });
      menu.appendChild(el);
    }
    const q = this.view.eventPt(ev); // menu is positioned inside the viewport container
    menu.style.left = q.x + 'px';
    menu.style.top = q.y + 'px';
    menu.classList.remove('hidden');
    const close = () => { menu.classList.add('hidden'); window.removeEventListener('mousedown', close); };
    setTimeout(() => window.addEventListener('mousedown', close), 0);
  }

  // ------------------------------------------------- grid snap (F9)
  toggleGridSnap() {
    this.gridSnap = !this.gridSnap;
    const chip = document.getElementById('snapbtn');
    if (chip) chip.classList.toggle('on', this.gridSnap);
    this.toast(this.gridSnap ? 'Grid snap ON — points land on the 1 m grid (F9 off)' : 'Grid snap OFF (F9 on)');
  }
  _initSnapBar() {
    const bar = document.getElementById('statusbar');
    if (!bar || document.getElementById('snapbtn')) return;
    const b = document.createElement('button');
    b.id = 'snapbtn';
    b.title = 'Grid Snap (F9)';
    b.textContent = 'SNAP';
    b.classList.toggle('on', this.gridSnap);
    b.addEventListener('click', () => this.toggleGridSnap());
    bar.insertBefore(b, document.getElementById('vcb'));
  }

  // ------------------------------------------------------------------ dialogs
  _initDialogs() {
    document.getElementById('dialog-backdrop').addEventListener('mousedown', (e) => {
      if (e.target.id === 'dialog-backdrop') this.closeDialog();
    });
  }
  dialog(title, html, buttons = [['Close', null]]) {
    const bd = document.getElementById('dialog-backdrop');
    const dl = document.getElementById('dialog');
    dl.innerHTML = `<div class="dialog-title">${title}<button class="dlg-x">×</button></div><div class="dialog-body">${html}</div><div class="dialog-buttons"></div>`;
    const bwrap = dl.querySelector('.dialog-buttons');
    for (const [label, fn] of buttons) {
      const b = document.createElement('button');
      b.className = 'dlg-btn' + (fn ? '' : ' secondary');
      b.textContent = label;
      b.addEventListener('click', () => { this.closeDialog(); if (fn) fn(); });
      bwrap.appendChild(b);
    }
    dl.querySelector('.dlg-x').addEventListener('click', () => this.closeDialog());
    bd.classList.remove('hidden');
  }
  closeDialog() {
    document.getElementById('dialog-backdrop').classList.add('hidden');
    if (this._onDialogClose) { const fn = this._onDialogClose; this._onDialogClose = null; fn(); }
  }
  confirmDialog(msg, onYes) {
    this.dialog('Confirm', `<p>${msg}</p>`, [['Cancel', null], ['OK', onYes]]);
  }
  // Convert selected Free face(s) into any element type — a single face is
  // swept along its normal (typed height); a multi-face selection (a drawn
  // rectangle pushed to a thickness, a whole body) is CLAIMED as one element
  // with no geometry change. Custom types grow the catalog dynamically and
  // everything lands in the Element Browser after the db sync.
  convertToElementDialog(fids) {
    const ids = Array.isArray(fids) ? fids : [fids];
    const multi = ids.length > 1;
    const f0 = this.model.faces.get(ids[0]);
    if (!f0) return;
    const o = this.bimOptions;
    const defH = o.topConstraint === 'unconnected'
      ? o.unconnectedHeight
      : Math.max(0.05, this.levelManager.getElevation(o.topConstraint) - this.levelManager.getElevation(o.baseLevel));
    const types = multi ? [
      ['column', 'Column', 'the selected faces become one column body'],
      ['beam', 'Beam', 'the selected faces become one beam body'],
      ['wall', 'Wall', 'the selected faces become one wall body'],
      ['slab', 'Slab', 'the selected faces become one slab body'],
    ] : [
      ['floor', 'Finish Floor', 'thin finish layer, swept 0.20 m down'],
      ['slab', 'Structural Slab', 'structural slab, swept 0.25 m down'],
      ['wall', 'Wall', 'swept along the face normal to the top constraint'],
      ['column', 'Column', 'vertical member rising to the top constraint'],
      ['beam', 'Beam', 'prismatic member swept along the normal'],
    ];
    this.dialog(multi ? `Convert ${ids.length} Faces to Element` : 'Convert to Element', `
      <div class="ob-lab">Element type</div>
      <div id="cv-types" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:4px 0 10px">
        ${types.map(([v, n, d], i) => `
        <label style="display:flex;gap:8px;align-items:flex-start;border:1px solid var(--line,#ccc);border-radius:6px;padding:6px 8px;cursor:pointer">
          <input type="radio" name="cvtype" value="${v}"${i === 0 ? ' checked' : ''} style="margin-top:3px">
          <span><b>${n}</b><br><small style="opacity:.75">${d}</small></span>
        </label>`).join('')}
        <label style="display:flex;gap:8px;align-items:flex-start;border:1px solid var(--line,#ccc);border-radius:6px;padding:6px 8px;cursor:pointer">
          <input type="radio" name="cvtype" value="__custom" style="margin-top:3px">
          <span style="flex:1"><b>Custom type…</b><br>
            <input type="text" id="cv-custom" placeholder="e.g. truss, bracing, pergola"
              style="width:100%;margin-top:4px;padding:3px 6px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
          </span>
        </label>
      </div>
      ${multi ? `<p style="opacity:.75;margin:0 0 6px">No geometry is created — the ${ids.length} selected faces are claimed as the element's body.</p>` : `
      <div class="ob-lab">Height / depth (m) — for the swept types</div>
      <input type="number" id="cv-height" step="0.05" min="0.05" value="${(+defH).toFixed(2)}"
        style="width:120px;padding:4px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">`}
    `, [
      ['Cancel', null],
      ['Convert', () => {
        const picked = document.querySelector('input[name="cvtype"]:checked');
        let mode = picked ? picked.value : 'column';
        if (mode === '__custom') {
          const name = (document.getElementById('cv-custom').value || '').trim().toLowerCase().replace(/\s+/g, '_');
          if (!name) { this.toast('Type a name for the custom element', true); return; }
          mode = name;
        }
        if (!(window.BimTools && BimTools.ConvertTool)) return;
        if (multi) {
          const faces = ids.map(id => this.model.faces.get(id)).filter(Boolean)
            .filter(f => !(f.userData && f.userData.bimEntityId));
          if (!faces.length) { this.toast('Those faces are gone or already claimed', true); return; }
          BimTools.ConvertTool.convertFaces(this, faces, mode);
        } else {
          const hEl = document.getElementById('cv-height');
          const h = hEl ? parseFloat(hEl.value) : NaN;
          const ff = this.model.faces.get(ids[0]);
          if (!ff) { this.toast('That face is gone', true); return; }
          BimTools.ConvertTool.convertFace(this, ff, mode, { height: isNaN(h) ? undefined : h });
        }
        this.clearSelection();
      }],
    ]);
    const custom = document.getElementById('cv-custom');
    if (custom) custom.addEventListener('click', e => e.stopPropagation());
  }
  showFeatures() {
    let html = '<div class="features">';
    for (const [group, items] of FEATURES) {
      html += `<div class="feat-group">${group}</div>`;
      for (const [name, st] of items) {
        const mark = st === 'yes' ? '<span class="st yes">✓</span>' : '<span class="st no">○</span>';
        html += `<div class="feat-item">${mark}<span>${name}</span></div>`;
      }
    }
    html += '</div>';
    this.dialog('SketchUp feature list — implemented in WebSketch', html, [['Close', null]]);
  }

  // ------------------------------------------------------------------ inference
  // All screen math goes through the Viewport's public coordinate API
  // (clientToCanvasPixels / clientToWorldRay / worldToScreenPixels) — never
  // raw ev.clientX/Y compared against world projections.
  //
  // The Blender-style axis constraint (V + X/Y/Z) is applied HERE, centered
  // on the anchor, so every tool that draws from an anchor gets it for free:
  // one locked axis keeps only that component, two keep their plane. While
  // locks are armed the free snap candidates and automatic axis inference
  // stand aside — the explicit constraint wins.
  inferPoint(ev, anchor) {
    const inf = this._inferPointRaw(ev, anchor);
    const locks = this.axisLocks;
    if (anchor && locks.size && locks.size < 3) {
      if (locks.size === 2) {
        // a two-axis lock is a sketch/drag PLANE through the anchor: take
        // the point under the cursor ON that plane (ray-plane), falling back
        // to the perpendicular projection when the ray runs parallel to it
        const [a1, a2] = [...locks];
        const n = G.norm(G.cross(AXES[a1], AXES[a2]));
        const pl = { n, d: G.dot(n, anchor) };
        const { ro, rd } = this.view.clientToWorldRay(ev.clientX, ev.clientY);
        inf.p = G.rayPlane(ro, rd, pl) || G.constrainToAxes(anchor, inf.p, [...locks]);
      } else {
        inf.p = G.constrainToAxes(anchor, inf.p, [...locks]);
      }
      inf.kind = 'lock';
      inf.label = 'locked ' + [...locks].join('+').toUpperCase();
      inf.axisSnapLine = null;
    }
    // grid snap (F9): round the inferred point to the nearest 1 m column —
    // real geometry snaps (endpoints/midpoints/centers) keep priority
    if (this.gridSnap && inf.kind !== 'endpoint' && inf.kind !== 'midpoint' && inf.kind !== 'center' && inf.kind !== 'lock' && inf.kind !== 'edge'
      && inf.kind !== 'gridX' && inf.kind !== 'gridline') {
      inf.p = G.v(Math.round(inf.p.x), Math.round(inf.p.y), inf.p.z);
      inf.kind = 'grid';
      inf.label = 'Grid 1 m';
    }
    // grid snap glyph: "X" + tooltip at intersections, dot on lines — cleared
    // for every other kind so the indicator never goes stale
    this.view.setSnapGlyph((inf.kind === 'gridX' || inf.kind === 'gridline') ? inf : null);
    return inf;
  }
  _inferPointRaw(ev, anchor) {
    const q = this.view.clientToCanvasPixels(ev.clientX, ev.clientY);
    const model = this.model;
    const locked = this.axisLocks.size > 0;
    if (!this._snapCache) {
      const cands = [];
      for (const [, p] of model.vertices) cands.push({ p, kind: 'endpoint', label: 'Endpoint' });
      for (const e of model.edges.values()) {
        if (e.curveId) continue;
        const a = model.vp(e.a), b = model.vp(e.b);
        if (a && b) cands.push({ p: G.mul(G.add(a, b), 0.5), kind: 'midpoint', label: 'Midpoint' });
      }
      for (const [, m] of model.curves) if (m.center) cands.push({ p: m.center, kind: 'center', label: 'Center' });
      this._snapCache = cands;
    }
    if (!locked) {
      let best = null, bestD = 9;
      // live snap points come first: sketch boundaries are preview-only
      // (never model edges), so tools feed their path endpoints through
      // this._liveSnaps on every planePoint() call
      const live = this._liveSnaps;
      const all = (live && live.length ? live : []).concat(this._snapCache);
      for (const c of all) {
        const s = this.view.worldToScreenPixels(c.p);
        if (!s.visible) continue;
        const d = Math.hypot(s.x - q.x, s.y - q.y);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) return { p: G.clone(best.p), kind: best.kind, label: best.label };
    }

    // GridSystem snaps (SnapSystem.js). Priority contract: real geometry
    // points above still win; grid INTERSECTIONS beat every other soft
    // candidate (axis inference, faces, ground); grid lines follow. Points
    // are projected onto the active Base Level elevation. Explicit axis
    // locks stand aside (the user constraint wins, as with free snaps).
    if (!locked && this.gridManager && this.gridManager.grids.length) {
      const gs = SnapSystem.snap(this, ev);
      if (gs) return gs;
    }

    // On-edge tracking: the closest point between the cursor ray and each
    // straight model edge — sketch along wall faces and column footprints
    // BETWEEN their corner vertices (endpoints above still own the corners).
    // Same ray/line math as the axis inference below.
    if (!locked) {
      const { ro, rd } = this.view.clientToWorldRay(ev.clientX, ev.clientY);
      let eBest = null, eD = 10;
      for (const e of model.edges.values()) {
        if (e.curveId) continue;
        const a = model.vp(e.a), b = model.vp(e.b);
        if (!a || !b) continue;
        const vec = G.sub(b, a);
        const L = G.len(vec);
        if (L < 1e-6) continue;
        vec.x /= L; vec.y /= L; vec.z /= L;
        const r = G.sub(ro, a);
        const bDot = G.dot(rd, vec);
        const den = 1 - bDot * bDot;
        if (Math.abs(den) < 1e-9) continue; // cursor ray parallel to the edge
        const s = (G.dot(vec, r) - bDot * G.dot(rd, r)) / den; // meters along the edge
        if (s <= 0.02 || s >= L - 0.02) continue; // corners own the ends
        const p = G.add(a, G.mul(vec, s));
        const sp = this.view.worldToScreenPixels(p);
        if (!sp.visible) continue;
        const d = Math.hypot(sp.x - q.x, sp.y - q.y);
        if (d < eD) { eD = d; eBest = p; }
      }
      if (eBest) return { p: eBest, kind: 'edge', label: 'On Edge' };
    }

    if (anchor && !locked) {
      // axis inference: closest point between the cursor ray and the axis line
      // through the anchor (screen-space lerp is wrong under perspective)
      const { ro, rd } = this.view.clientToWorldRay(ev.clientX, ev.clientY);
      let axHit = null, axD = 10;
      for (const name of ['x', 'y', 'z']) {
        const vec = AXES[name];
        const r = G.sub(ro, anchor);
        const b = G.dot(rd, vec);
        const d1 = G.dot(rd, r);
        const e = G.dot(vec, r);
        const denom = 1 - b * b;
        if (Math.abs(denom) < 1e-9) continue;
        const s = (e - b * d1) / denom; // meters along the axis
        if (s <= 0.001) continue;
        const p = G.add(anchor, G.mul(vec, s));
        const sp = this.view.worldToScreenPixels(p);
        if (!sp.visible) continue;
        const d = Math.hypot(sp.x - q.x, sp.y - q.y);
        if (d < axD) { axD = d; axHit = { name, p }; }
      }
      if (axHit) {
        return { p: G.clone(axHit.p), kind: 'axis', label: ({ x: 'red', y: 'green', z: 'blue' })[axHit.name] + ' axis', axis: axHit.name, axisSnapLine: G.clone(axHit.p) };
      }
    }
    const fid = this.view.pickFaceAt(q);
    if (fid != null) {
      const plane = this.model.facePlane(this.model.faces.get(fid));
      const { ro, rd } = this.view.clientToWorldRay(ev.clientX, ev.clientY);
      const p = G.rayPlane(ro, rd, plane);
      if (p) return { p, kind: 'face', label: 'On Face' };
    }
    const gp = this.view.groundAt(q);
    if (gp) return { p: gp, kind: 'ground', label: 'On Ground' };
    const { ro, rd } = this.view.clientToWorldRay(ev.clientX, ev.clientY);
    return { p: G.add(ro, G.mul(rd, 10)), kind: 'free', label: '' };
  }

  // ------------------------------------------------------ grid grip dragging
  // The square handles at grid endpoints (render.js gridGripPoints) stretch a
  // grid line: left-drag moves live visuals; release commits through
  // GridManager.updateGrid — one undoable transaction that also re-projects
  // attached walls/columns onto the moved grid.
  // Grid LINE hit test for selection: grids are selectable THROUGH the
  // geometry drawn on them (a hosted wall covers its grid line) — hitting a
  // hairline within tol px is intentional, so the grid wins over the faces
  // and edges beneath it. Returns { grid, z } or null.
  _gridLineAt(ev, tol = 12) {
    if (this.mode !== 'bim' || !this.gridManager || !this.gridManager.grids.length) {
      return null;
    }
    const q = this.view.clientToCanvasPixels(ev.clientX, ev.clientY);
    let best = null, bd = tol;
    for (const g of this.gridManager.grids) {
      for (const z of this._gridSelectableZs(g)) {
        const poly = g.polyline();
        for (let i = 0; i < poly.length - 1; i++) {
          const sa = this.view.worldToScreenPixels({ x: poly[i][0], y: poly[i][1], z });
          const sb = this.view.worldToScreenPixels({ x: poly[i + 1][0], y: poly[i + 1][1], z });
          if (!sa.visible && !sb.visible) continue;
          const dx = sb.x - sa.x, dy = sb.y - sa.y, L2 = dx * dx + dy * dy;
          let d;
          if (L2 < 1e-6) d = Math.hypot(sa.x - q.x, sa.y - q.y);
          else {
            const t = Math.max(0, Math.min(1, ((q.x - sa.x) * dx + (q.y - sa.y) * dy) / L2));
            d = Math.hypot(sa.x + dx * t - q.x, sa.y + dy * t - q.y);
          }
          if (d < bd) { bd = d; best = { grid: g, z }; }
        }
      }
    }
    return best;
  }
  // the level Zs at which this grid renders (and therefore selects): every
  // COVERED level's copy is its own target — a grid hidden at Level 1 keeps
  // its Level-2 line selectable, the ghost is not
  _gridSelectableZs(g) {
    if (g.hidden || g.locked) return [];
    const lvls = this.levelManager.levels || [];
    const zsAll = lvls.map(l => l.elevation).filter(z => z != null);
    return zsAll.filter(z => {
      if (!g.covers(z)) return false;
      const l = lvls.find(x => Math.abs(x.elevation - z) < 1e-6);
      return !l || !g.hiddenAt(l.id);
    });
  }
  // Grid lines caught by a drag window (canvas-pixel box): window mode
  // (left-to-right) takes lines FULLY inside; crossing mode (right-to-left)
  // takes lines the box touches. Same visibility rules as clicking.
  _gridLinesInBox(x0, y0, x1, y1, crossing = false) {
    if (this.mode !== 'bim' || !this.gridManager || !this.gridManager.grids.length) return [];
    const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    // segment vs axis-aligned rect: any endpoint inside, or the segment
    // crosses one of the four rect edges
    const segHits = (sa, sb) => {
      if (inBox(sa.x, sa.y) || inBox(sb.x, sb.y)) return true;
      const dx = sb.x - sa.x, dy = sb.y - sa.y;
      for (const t of [0, 1]) {
        const ex = t === 0 ? x0 : x1, ey = t === 0 ? y0 : y1;
        // vertical rect edge x = ex: does the segment cross y0..y1 there?
        if (Math.abs(dx) > 1e-9) {
          const u = (ex - sa.x) / dx;
          if (u > 0 && u < 1) { const y = sa.y + dy * u; if (y >= y0 && y <= y1) return true; }
        }
        // horizontal rect edge y = ey
        if (Math.abs(dy) > 1e-9) {
          const u = (ey - sa.y) / dy;
          if (u > 0 && u < 1) { const x = sa.x + dx * u; if (x >= x0 && x <= x1) return true; }
        }
      }
      return false;
    };
    const out = [];
    for (const g of this.gridManager.grids) {
      const zs = this._gridSelectableZs(g);
      if (!zs.length) continue;
      const poly = g.polyline();
      let done = false;
      for (const z of zs) {
        if (done) break;
        const scr = poly.map(p => this.view.worldToScreenPixels({ x: p[0], y: p[1], z }));
        if (crossing) {
          for (let i = 0; i < scr.length - 1; i++) {
            if ((scr[i].visible || scr[i + 1].visible) && segHits(scr[i], scr[i + 1])) {
              out.push({ grid: g, z }); done = true; break;
            }
          }
        } else if (scr.every(s => s.visible && inBox(s.x, s.y))) {
          out.push({ grid: g, z }); done = true;
        }
      }
    }
    return out;
  }
  selectGrid(id, z = null, opts = {}) {
    if (opts.toggle) {
      if (this.selGridIds.has(id)) this.selGridIds.delete(id);
      else { this.selGridIds.add(id); this.selGridZ = z; }
      this.selGridId = this.selGridIds.size
        ? (this.selGridIds.has(id) ? id : [...this.selGridIds][0]) : null;
      if (!this.selGridIds.size) this.selGridZ = null;
    } else {
      this.selGridIds = new Set([id]);
      this.selGridId = id; this.selGridZ = z;
    }
    this.sel.faces.clear(); this.sel.edges.clear();
    this.onSelectionChanged();
    const n = this.selGridIds.size;
    if (!n) { this.setStatus('Grid deselected.'); return; }
    if (n === 1) {
      const g = this.gridManager.getGrid(id);
      const lvl = z != null && this.levelManager.levels.find(l => Math.abs(l.elevation - z) < 1e-6);
      if (g) this.setStatus(`Grid ${g.name} selected${lvl ? ' on ' + lvl.name : ''} — drag the line to move it, Del to delete, endpoint grips to stretch`);
      return;
    }
    this.setStatus(`${n} grid lines selected — Del deletes all, Shift+click removes one`);
  }
  // box selection: replace or extend the selected-grid set with the lines
  // caught by a drag window (list of { grid, z } from _gridLinesInBox)
  selectGrids(list, opts = {}) {
    if (!list || !list.length) return;
    if (!opts.add) this.selGridIds = new Set();
    for (const it of list) this.selGridIds.add(it.grid.id);
    this.selGridId = [...this.selGridIds][0];
    this.selGridZ = list[0] && list[0].z != null ? list[0].z : null;
    // a window that caught ELEMENTS too keeps them selected alongside
    if (!opts.keep) { this.sel.faces.clear(); this.sel.edges.clear(); }
    this.onSelectionChanged();
    const n = this.selGridIds.size;
    if (n === 1) {
      const g = this.gridManager.getGrid(this.selGridId);
      const z = this.selGridZ;
      const lvl = z != null && this.levelManager.levels.find(l => Math.abs(l.elevation - z) < 1e-6);
      if (g) this.setStatus(`Grid ${g.name} selected${lvl ? ' on ' + lvl.name : ''} — drag the line to move it, Del to delete, endpoint grips to stretch`);
      return;
    }
    this.setStatus(`${n} grid lines selected — Del deletes all, Shift+click removes one`);
  }
  _gridGripAt(ev) {
    if (this.mode !== 'bim' || !this.gridManager || !this.gridManager.grids.length) return null;
    const q = this.view.clientToCanvasPixels(ev.clientX, ev.clientY);
    let best = null, bd = 12;
    for (const g of this.view.gridGripPoints()) {
      const gl = this.gridManager.getGrid(g.gridId);
      if (gl && gl.locked) continue; // locked grids refuse dragging
      const s = this.view.worldToScreenPixels(g.p);
      if (!s.visible) continue;
      const d = Math.hypot(s.x - q.x, s.y - q.y);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }
  _gridDragMove(ev) {
    const g = this.gridManager.getGrid(this._gridDrag.gridId);
    if (!g) { this._gridDrag = null; return; }
    const { ro, rd } = this.view.clientToWorldRay(ev.clientX, ev.clientY);
    const z = this._gridDrag.p.z;
    const t = Math.abs(rd.z) > 1e-9 ? (z - ro.z) / rd.z : 0;
    if (t <= 0) return;
    g[this._gridDrag.which] = [ro.x + rd.x * t, ro.y + rd.y * t];
    this.view.setGrids(this.gridManager.grids, this.levelManager.levels); // live visuals only
  }
  _gridDragEnd() {
    const drag = this._gridDrag;
    this._gridDrag = null;
    if (!drag) return;
    const g = this.gridManager.getGrid(drag.gridId);
    if (!g) return;
    if (!g.isCurved && Math.hypot(g.end[0] - g.start[0], g.end[1] - g.start[1]) < 1e-3) {
      this.toast('Grid line is degenerate — move cancelled', true);
      this.onGridsChanged();
      return;
    }
    const patch = {};
    patch[drag.which] = [g[drag.which][0], g[drag.which][1]];
    this.run('move grid', () => this.gridManager.updateGrid(drag.gridId, patch));
    this.toast(`Grid ${g.name} stretched`);
  }

  // ------------------------------------------------------------------ picking
  pickEdgeAt(ev, tol = 6) {
    const model = this.model;
    const q = this.view.clientToCanvasPixels(ev.clientX, ev.clientY);
    const x = q.x, y = q.y;
    const ef = this.view.edgeFilter || null; // Level View hides filtered edges from picking too
    let best = null, bd = tol;
    for (const e of model.edges.values()) {
      if (e.hidden || (ef && !ef(e)) || this.isEdgeLocked(e)) continue;
      const a = model.vp(e.a), b = model.vp(e.b);
      if (!a || !b) continue;
      const sa = this.view.worldToScreenPixels(a), sb = this.view.worldToScreenPixels(b);
      if (!sa.visible && !sb.visible) continue;
      const dx = sb.x - sa.x, dy = sb.y - sa.y;
      const L2 = dx * dx + dy * dy;
      let d;
      if (L2 < 1e-6) d = Math.hypot(sa.x - x, sa.y - y);
      else {
        const t = Math.max(0, Math.min(1, ((x - sa.x) * dx + (y - sa.y) * dy) / L2));
        d = Math.hypot(sa.x + dx * t - x, sa.y + dy * t - y);
      }
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { edge: best, d: bd } : null;
  }
  pickEntity(ev) {
    const q = this.view.eventPt(ev);
    // downloaded-asset instances are physical objects in front of the model:
    // a hit on them wins over the geometry behind (their own raycast keeps
    // distances, so this returns the nearest instance under the cursor)
    if (this.view.pickAssetAt && this.assets) {
      const aid = this.view.pickAssetAt(q);
      if (aid != null) return { face: null, edge: null, edges: [], group: null, asset: aid };
    }
    // OBJECT MODE (Precise Drawing): whole elements first — one Group raycast,
    // never the merged mesh or the edge list. The returned face still lets
    // sub-element callers (Edit In Place entry) work unchanged.
    if (this.mode === 'bim' && this.view.pickElementAt) {
      const ep = this.view.pickElementAt(q);
      if (ep) return { face: ep.faceId, entity: ep.entityId, group: null };
    }
    const fid = this.view.pickFaceAt(q);
    if (fid != null) {
      const f = this.model.faces.get(fid);
      if (f && f.gid && this.activeGroup !== f.gid) return { face: null, group: f.gid };
      return { face: fid, group: null };
    }
    const pe = this.pickEdgeAt(ev, 7);
    if (pe) {
      const e = pe.edge;
      if (e.gid && this.activeGroup !== e.gid) return { face: null, group: e.gid };
      const ids = e.curveId ? this.model.curveEdges(e.curveId).map(x => x.id) : [e.id];
      return { face: null, edge: e.id, edges: ids, group: null };
    }
    return { face: null, edge: null, edges: [], group: null };
  }

  // ------------------------------------------------------------------ groups
  selectGroup(gid, mode = 'replace') {
    const ent = this.model.groupEntities(gid);
    if (!ent.faces.size && !ent.edges.size) return;
    if (mode === 'toggle') {
      const firstFace = [...ent.faces][0];
      const already = this.sel.faces.has(firstFace);
      if (already) {
        for (const id of ent.faces) this.sel.faces.delete(id);
        for (const id of ent.edges) this.sel.edges.delete(id);
      } else {
        for (const id of ent.faces) this.sel.faces.add(id);
        for (const id of ent.edges) this.sel.edges.add(id);
      }
    } else {
      this.sel = { edges: ent.edges, faces: ent.faces };
    }
    this.onSelectionChanged();
  }
  singleGroupSelection() {
    const gids = new Set();
    for (const id of this.sel.faces) { const f = this.model.faces.get(id); if (f && f.gid) gids.add(f.gid); }
    for (const id of this.sel.edges) { const e = this.model.edges.get(id); if (e && e.gid) gids.add(e.gid); }
    if (gids.size !== 1) return null;
    const gid = [...gids][0];
    const ent = this.model.groupEntities(gid);
    if (ent.faces.size === this.sel.faces.size && ent.edges.size === this.sel.edges.size) return gid;
    return null;
  }
  bandGroupMerge(picked, crossing, insideFn) {
    const model = this.model;
    const gids = new Set();
    for (const id of picked.faces) { const f = model.faces.get(id); if (f && f.gid && f.gid !== this.activeGroup) gids.add(f.gid); }
    for (const id of picked.edges) { const e = model.edges.get(id); if (e && e.gid && e.gid !== this.activeGroup) gids.add(e.gid); }
    for (const gid of gids) {
      const ent = model.groupEntities(gid);
      for (const id of ent.faces) picked.faces.delete(id);
      for (const id of ent.edges) picked.edges.delete(id);
      const pts = [];
      for (const id of ent.faces) { const f = model.faces.get(id); if (f) for (const v of model.rings(f).flat()) pts.push(model.vp(v)); }
      for (const id of ent.edges) { const e = model.edges.get(id); if (e) pts.push(model.vp(e.a), model.vp(e.b)); }
      const ss = pts.map(p => this.view.toScreen(p));
      const hit = crossing ? ss.some(s => insideFn(s.x, s.y)) : ss.every(s => insideFn(s.x, s.y));
      if (hit) {
        for (const id of ent.faces) picked.faces.add(id);
        for (const id of ent.edges) picked.edges.add(id);
      }
    }
  }
  enterGroup(gid) {
    this.activeGroup = gid;
    this.model.currentGid = gid;
    this.clearSelection();
    this._updateEditBox();
    if (this.tool) this.tool.status();
    const g = this.model.groups.get(gid);
    this.toast(`Editing group "${g ? g.name : ''}" — Esc to exit. New geometry joins this group.`);
  }
  exitGroup() {
    this.activeGroup = null;
    this.model.currentGid = 0;
    this.view.setGroupEditBox(null);
    this.clearSelection();
    if (this.tool) this.tool.status();
  }
  _updateEditBox() {
    if (this.activeGroup == null) { this.view.setGroupEditBox(null); return; }
    const ent = this.model.groupEntities(this.activeGroup);
    const vset = new Set();
    for (const id of ent.faces) { const f = this.model.faces.get(id); if (f) for (const v of this.model.rings(f).flat()) vset.add(v); }
    for (const id of ent.edges) { const e = this.model.edges.get(id); if (e) { vset.add(e.a); vset.add(e.b); } }
    this.view.setGroupEditBox(this.model.bbox([...vset]));
  }
  groupSelection() {
    if (!this.sel.faces.size && !this.sel.edges.size) { this.toast('Select geometry first, then group it'); return; }
    const defName = 'Group ' + (this.model.groups.size + 1);
    this.dialog('Create Group', `
      <div class="form-row"><label>Name</label>
      <input id="grp-name" value="${defName}" style="flex:1"></div>
      <p class="dim">The selected ${this.sel.faces.size} face(s) and ${this.sel.edges.size} edge(s) become one named object.
      Click selects it as a unit; double-click to edit inside it.</p>`,
      [['Cancel', null], ['Create Group', () => {
        const name = (document.getElementById('grp-name') || {}).value || defName;
        const g = this.run('group', m => m.createGroup(this.sel, name.trim()));
        if (g) {
          this.selectGroup(g.id);
          this.toast(`Group "${g.name}" created`);
        }
      }]]);
    setTimeout(() => { const i = document.getElementById('grp-name'); if (i) { i.focus(); i.select(); } }, 50);
  }
  ungroupSelection() {
    const gids = new Set();
    for (const id of this.sel.faces) { const f = this.model.faces.get(id); if (f && f.gid) gids.add(f.gid); }
    for (const id of this.sel.edges) { const e = this.model.edges.get(id); if (e && e.gid) gids.add(e.gid); }
    if (!gids.size) { this.toast('Select a group to ungroup'); return; }
    this.run('ungroup', m => { for (const gid of gids) m.ungroup(gid); });
    if (this.activeGroup != null && gids.has(this.activeGroup)) this.exitGroup();
    this.toast(gids.size > 1 ? 'Groups removed' : 'Group removed');
  }
  renameGroupDialog(gid) {
    const g = this.model.groups.get(gid);
    if (!g) return;
    this.dialog('Rename Group', `
      <div class="form-row"><label>Name</label>
      <input id="grp-name" value="${g.name.replace(/"/g, '&quot;')}" style="flex:1"></div>`,
      [['Cancel', null], ['Rename', () => {
        const name = (document.getElementById('grp-name') || {}).value;
        if (name) this.run('rename group', () => { g.name = name.trim(); });
      }]]);
    setTimeout(() => { const i = document.getElementById('grp-name'); if (i) { i.focus(); i.select(); } }, 50);
  }
  makeSolid(gid, solid) {
    const g = this.model.groups.get(gid);
    if (!g) return;
    if (solid) {
      const fids = [...this.model.groupEntities(gid).faces];
      if (!fids.length || this.model.shellOpenEdges(fids) !== 0) {
        this.toast('Cannot make solid: the shell is open (not watertight)', true);
        return;
      }
    }
    this.run(solid ? 'make solid' : 'make hollow', () => { g.solid = solid; });
    this.toast(solid ? `Group "${g.name}" is now a solid (volume filled)` : `Group "${g.name}" set to hollow`);
  }

  // ------------------------------------------------------------------ thicken
  thickenDialog() {
    const faceIds = [...this.sel.faces];
    if (!faceIds.length) { this.toast('Select one or more faces to give thickness'); return; }
    const model = this.model;
    const compute = () => {
      const t = Math.abs(parseFloat(document.getElementById('thick-val').value) || 0.1)
        * (document.getElementById('thick-flip').checked ? -1 : 1);
      return { t, data: model.thickenGeometry(faceIds, t) };
    };
    const update = () => {
      const { t, data } = compute();
      this.view.clearPreview();
      for (const fd of data) {
        this.view.previewFill([{ outer: fd.outer, holes: fd.holes }], fd.quad ? 0x9db8dc : 0x2f6fdb, fd.quad ? 0.22 : 0.35);
        this.view.previewLoop(fd.outer, 0x2b2b2b);
      }
      const info = document.getElementById('thick-info');
      if (info) info.textContent = `${data.filter(d => d.quad).length} wall faces + ${data.length - data.filter(d => d.quad).length} offset faces will be created`;
    };
    this._onDialogClose = () => this.view.clearPreview();
    this.dialog('Give Thickness', `
      <div class="form-row"><label>Thickness</label>
        <input id="thick-val" type="number" step="0.05" min="0.01" value="0.10" style="width:90px"> m</div>
      <div class="form-row"><label class="chk"><input id="thick-flip" type="checkbox"> Flip direction</label></div>
      <p class="dim" id="thick-info"></p>
      <p class="dim">Offsets a copy of each selected face and stitches the boundary into a
      watertight solid (mitered corners). Closed shells become hollow solids.</p>`,
      [['Cancel', null], ['Thicken', () => {
        const { data } = compute();
        if (!data.length) { this.toast('Invalid thickness', true); return; }
        const ids = this.run('thicken', m => m.commitThicken(data));
        this.view.clearPreview();
        this.toast(`${ids.length} faces created — selection kept its original faces`);
      }]]);
    document.getElementById('thick-val').addEventListener('input', update);
    document.getElementById('thick-flip').addEventListener('change', update);
    update();
  }

  refreshGroups() {
    const wrap = document.getElementById('grouplist');
    if (!wrap) return;
    this.model.pruneGroups();
    if (!this.model.groups.size) {
      wrap.innerHTML = '<div class="dim" style="padding:9px 12px;">No groups yet — select geometry, then Edit ▸ Group (Ctrl+G).</div>';
      return;
    }
    wrap.innerHTML = '';
    const selGid = this.singleGroupSelection();
    for (const [gid, g] of this.model.groups) {
      const row = document.createElement('div');
      row.className = 'grow' + (gid === selGid ? ' active' : '');
      const ent = this.model.groupEntities(gid);
      row.innerHTML = `<span class="gdot${g.solid ? ' on' : ''}" title="${g.solid ? 'Solid' : 'Hollow'}"></span>
        <span class="gname"></span><span class="gcount">${ent.faces.size}</span>`;
      row.querySelector('.gname').textContent = g.name;
      row.title = `${g.name} — ${ent.faces.size} faces (${g.solid ? 'solid' : 'hollow'}). Click to select, double-click to rename.`;
      row.addEventListener('click', () => this.selectGroup(gid));
      row.addEventListener('dblclick', () => this.renameGroupDialog(gid));
      wrap.appendChild(row);
    }
  }

  // ------------------------------------------------------------------ selection
  selectionVerts() {
    const out = new Set();
    const model = this.model;
    for (const id of this.sel.faces) {
      const f = model.faces.get(id);
      if (f) for (const ring of model.rings(f)) ring.forEach(v => out.add(v));
    }
    for (const id of this.sel.edges) {
      const e = model.edges.get(id);
      if (e) { out.add(e.a); out.add(e.b); }
    }
    return out;
  }
  snapshotSelection() {
    const model = this.model;
    const edges = [];
    for (const id of this.sel.edges) {
      const e = model.edges.get(id);
      if (e) edges.push({ a: model.vp(e.a), b: model.vp(e.b) });
    }
    const faces = [];
    for (const id of this.sel.faces) {
      const f = model.faces.get(id);
      if (f) faces.push({ outer: model.pts(f.loop), holes: f.holes.map(h => model.pts(h)), color: f.color });
    }
    return { edges, faces };
  }
  renderGhost(snapshot, fn) {
    const view = this.view;
    if (snapshot.faces.length)
      view.previewFill(snapshot.faces.map(f => ({
        outer: f.outer.map(fn),
        holes: f.holes.map(h => h.map(fn)),
      })), 0x2f6fdb, 0.20);
    for (const e of snapshot.edges) view.previewLine([fn(e.a), fn(e.b)], 0x1f6fd6);
  }
  toggleEntities(picked) {
    for (const id of picked.faces) {
      if (this.sel.faces.has(id)) this.sel.faces.delete(id); else this.sel.faces.add(id);
    }
    for (const id of picked.edges) {
      if (this.sel.edges.has(id)) this.sel.edges.delete(id); else this.sel.edges.add(id);
    }
    this.onSelectionChanged();
  }
  // ------------------------------------------------------------- asset select
  selectAsset(id, mode = 'replace') {
    const rec = this.assets && this.assets.get(id);
    if (!rec) return;
    if (mode === 'toggle') {
      if (this.selAssets.has(id)) this.selAssets.delete(id); else this.selAssets.add(id);
    } else {
      this.sel = { edges: new Set(), faces: new Set() };
      this.selAssets = new Set([id]);
    }
    this.onSelectionChanged();
  }
  // Asset-only mutations (place/move/define) never touch the kernel, so they
  // skip the transaction layer — but they must still reach autosave.
  assetsChanged() {
    if (this._eip) return;
    this._saveAutosave();
  }
  // Register a downloaded model as a catalog type in the Element Browser.
  // Doors/windows land in the existing Door/Window categories under a
  // "BlenderKit" family (so they sit beside the built-in types); objects get
  // their own category. Dimensions default to the instance's own bounding
  // box — the opening matches the model until sized otherwise with the VCB.
  async defineAssetKind(id, kind) {
    const rec = this.assets && this.assets.get(id);
    if (!rec) { this.toast('That asset is no longer in the scene', true); return; }
    if (!this.db) { this.toast('Element Browser database unavailable', true); return; }
    kind = (kind === 'door' || kind === 'window') ? kind : 'object';
    try {
      const cats = await this.db.getCatalog();
      let cat, famId;
      if (kind === 'object') {
        cat = cats.categories.find(c => c.id === 'cat_bk_objects');
        if (!cat) { cat = { id: 'cat_bk_objects', name: 'Objects (Downloaded)' }; await this.db.putCategory(cat); }
        famId = 'fam_bk_objects';
        if (!cats.families.some(f => f.id === famId)) await this.db.putFamily({ id: famId, categoryId: cat.id, name: 'BlenderKit' });
      } else {
        const catName = kind === 'door' ? 'Door' : 'Window';
        cat = cats.categories.find(c => c.name === catName);
        if (!cat) { cat = { id: 'cat_bk_' + kind, name: catName }; await this.db.putCategory(cat); }
        famId = 'fam_bk_' + kind;
        if (!cats.families.some(f => f.id === famId)) await this.db.putFamily({ id: famId, categoryId: cat.id, name: 'BlenderKit' });
      }
      const thumb = (window.BlenderKitBrowser && BlenderKitBrowser.thumbFor && BlenderKitBrowser.thumbFor(rec.assetId)) || '';
      const params = {
        assetId: rec.assetId, assetName: rec.name, kind, thumbUrl: thumb,
        width: +Math.max(0.1, rec.size.x).toFixed(3),
        height: +Math.max(0.1, rec.size.z).toFixed(3),
        depth: +Math.max(0.02, rec.size.y).toFixed(3),
        sill: kind === 'window' ? 0.9 : 0,
      };
      await this.db.ensureType(famId, rec.name, params);
      rec.kind = kind;
      this.assets.changed('defined', rec);
      this.onSelectionChanged(); // kind chip in Entity Info refreshes
      this.toast(`“${rec.name}” defined as ${kind === 'object' ? 'an object' : 'a ' + kind} — it is in the Element Browser${kind !== 'object' ? ' (drag it onto a wall)' : ''}`);
    } catch (e) {
      this.toast('Could not define the asset: ' + (e.message || e), true);
    }
  }
  clearSelection() {
    this.sel = { edges: new Set(), faces: new Set() };
    this.selGridId = null;
    this.selGridZ = null;
    this.selGridIds.clear();
    this.selAssets.clear();
    this.onSelectionChanged();
  }
  pruneSelection() {
    for (const id of [...this.sel.faces]) if (!this.model.faces.has(id)) this.sel.faces.delete(id);
    for (const id of [...this.sel.edges]) if (!this.model.edges.has(id)) this.sel.edges.delete(id);
    if (this.assets) for (const id of [...this.selAssets]) if (!this.assets.get(id)) this.selAssets.delete(id);
  }
  onSelectionChanged() {
    this.view.updateSelectionVisuals();
    if (this.view.updateAssetSelection && this.assets)
      this.view.updateAssetSelection(this.selAssets, this.assets);
    this.updateInfo();
    // the selected grid highlights in its own overlay (setGrids rebuild)
    if (this.gridManager && this.gridManager.grids.length && this.view.setGrids)
      this.view.setGrids(this.gridManager.grids, this.levelManager.levels, this.selGridIds.size ? this.selGridIds : (this.selGridId || null), this.selGridZ);
    if (this.tool && this.tool.id === 'scale') { this.tool.activate(); this.tool.status(); }
  }
  updateInfo() {
    const el = document.getElementById('entityinfo');
    const model = this.model;

    // ----- selected grid line(s): always-visible selection state -----
    if (this.selGridIds && this.selGridIds.size && !this.sel.faces.size && !this.sel.edges.size) {
      const names = [...this.selGridIds].map(id => {
        const g = this.gridManager && this.gridManager.getGrid(id);
        return g ? g.name : id;
      }).sort();
      const lv = this.selGridZ != null && this.levelManager.levels.find(l => Math.abs(l.elevation - this.selGridZ) < 1e-6);
      el.innerHTML = `
        <div class="ok-badge" style="margin-top:2px">Grid Line${names.length > 1 ? 's' : ''} selected${lv ? ' · ' + lv.name : ''}</div>
        <div style="margin-top:6px;font-weight:600;font-size:15px;color:#b45309">${names.join(', ')}</div>
        <div style="color:#6a7178;font-size:12px;margin-top:4px">Drag the line to move it · Del to delete · endpoint grips stretch · click empty space to deselect</div>`;
      return;
    }

    // ----- downloaded-asset instance(s) selected: asset inspector -----
    if (this.selAssets.size && !this.sel.faces.size && !this.sel.edges.size && this.assets) {
      const recs = [...this.selAssets].map(id => this.assets.get(id)).filter(Boolean);
      if (recs.length === 1) {
        const r = recs[0];
        const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const dims = `${r.size.x.toFixed(2)} × ${r.size.y.toFixed(2)} × ${r.size.z.toFixed(2)} m`;
        el.innerHTML = `
          <div class="solid-badge" style="margin-top:2px">Downloaded Asset — ${esc(r.kind)}${r.host ? ' · hosted on ' + esc(r.host.wallId) : ''}</div>
          <div style="margin-top:6px;font-weight:600">${esc(r.name)}</div>
          <div style="color:#6a7178;font-size:12px;margin-top:2px">${dims} · ${r.host ? `opening ${fmtLen(r.host.width)} × ${fmtLen(r.host.height)} at ${fmtLen(r.host.sill)} sill` : 'free object'}</div>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="mini-btn" data-ak="door">Define as Door</button>
            <button class="mini-btn" data-ak="window">Define as Window</button>
            <button class="mini-btn" data-ak="object">Define as Object</button>
          </div>
          <div style="margin-top:6px;display:flex;gap:6px">
            <button class="mini-btn" data-am>Move (M)</button>
            <button class="mini-btn" data-arm>Remove</button>
          </div>`;
        el.querySelectorAll('[data-ak]').forEach(b =>
          b.addEventListener('click', () => this.defineAssetKind(r.id, b.dataset.ak)));
        el.querySelector('[data-am]').addEventListener('click', () => this.setTool('move'));
        el.querySelector('[data-arm]').addEventListener('click', () => { this.selectAsset(r.id); this.deleteSelection(); });
        return;
      }
      el.innerHTML = `<div class="solid-badge">${recs.length} downloaded assets selected</div>
        <div style="margin-top:6px"><button class="mini-btn" id="ai-arm">Remove all</button></div>`;
      el.querySelector('#ai-arm').addEventListener('click', () => this.deleteSelection());
      return;
    }

    // ----- one whole group selected: group inspector -----
    const gid = this.singleGroupSelection();
    if (gid != null && model.groups.has(gid)) {
      const g = model.groups.get(gid);
      const ent = model.groupEntities(gid);
      const fids = [...ent.faces];
      let area = 0;
      for (const id of fids) { const f = model.faces.get(id); if (f) area += model.faceArea(f); }
      let badge, btn;
      if (!fids.length) {
        badge = '<div class="warn-badge">Empty group</div>';
      } else {
        const open = model.shellOpenEdges(fids);
        if (open === 0) {
          const vol = model.shellVolume(fids);
          if (g.solid) {
            badge = `<div class="solid-badge">✓ Solid — volume ${fmtVol(vol)}</div>`;
            btn = '<button class="mini-btn" data-act="hollow">Make Hollow</button>';
          } else {
            badge = `<div class="ok-badge">Watertight shell</div>
                     <div class="stats">Volume when filled: ${fmtVol(vol)}</div>`;
            btn = '<button class="mini-btn primary" data-act="full">Make Full (solid)</button>';
          }
        } else {
          badge = `<div class="warn-badge">Open shell — ${open} open edge${open > 1 ? 's' : ''} (not watertight)</div>`;
        }
      }
      el.innerHTML = `
        <div class="gi-name">Group <input id="gi-gname" value=""></div>
        <div class="stats">${ent.faces.size} faces · ${ent.edges.size} edges · ${area.toFixed(2)} m²</div>
        ${badge || ''}${btn || ''}
        <div class="dim" style="margin-top:4px">Double-click to edit inside · Ctrl+Shift+G to ungroup</div>`;
      const nameInput = el.querySelector('#gi-gname');
      nameInput.value = g.name;
      nameInput.addEventListener('change', () => {
        if (nameInput.value.trim()) this.run('rename group', () => { g.name = nameInput.value.trim(); });
      });
      const b = el.querySelector('.mini-btn');
      if (b) b.addEventListener('click', () => this.makeSolid(gid, b.dataset.act === 'full'));
      return;
    }

    // ----- one whole BIM element selected: element inspector -----
    const ent = this.singleElementSelection();
    if (ent) {
      // scripted element: editable input per declared param — the script's
      // OWN parameter list IS the properties section, whatever it declares
      const script = ent.type === 'script' && this.scriptElements
        ? this.scriptElements.get(ent.params.scriptId) : null;
      if (ent.type === 'script') {
        const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        if (!script) {
          el.innerHTML = `<div class="gi-name"><span class="gi-cat">Scripted</span> <span class="gi-eid">${ent.id}</span></div>
            <div class="warn-badge">Script missing: ${esc(ent.params.scriptName || ent.params.scriptId)}</div>
            <div class="stats dim" style="margin-top:4px">Re-save it via the “script” command, then pick this element's type again.</div>`;
          return;
        }
        const fields = script.params.map(pd => {
          const v = ent.params.values[pd.id];
          if (pd.type === 'checkbox')
            return `<div class="gi-prow"><span>${esc(pd.label)}</span><input type="checkbox" data-sp="${pd.id}"${v ? ' checked' : ''}></div>`;
          if (pd.type === 'select')
            return `<div class="gi-prow"><span>${esc(pd.label)}</span><select data-sp="${pd.id}">${pd.options.map(o =>
              `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
          return `<div class="gi-prow"><span>${esc(pd.label)}</span><input data-sp="${pd.id}" value="${v != null ? v : pd.def}"></div>`;
        }).join('');
        el.innerHTML = `
          <div class="gi-name"><span class="gi-cat">Scripted</span> <span class="gi-eid">${ent.id}</span></div>
          <div class="stats">${esc(script.name)} — edit a value and the geometry regenerates</div>
          <div class="gi-params">${fields}</div>
          <button class="mini-btn" id="gi-scr-edit">✎ Edit Script</button>
          <button class="mini-btn" id="gi-del">Delete</button>`;
        el.querySelectorAll('[data-sp]').forEach(inp => {
          inp.addEventListener('change', () => {
            const pd = script.params.find(x => x.id === inp.dataset.sp);
            const raw = pd.type === 'checkbox' ? inp.checked : inp.value;
            this.run('edit scripted element', () => {
              try { this.scriptElements.rebuildEntity(ent.id, { values: { [pd.id]: raw } }); }
              catch (e) { throw e; }
            });
            this.selectElement(ent.id); // keep it selected across the rebuild
            this.updateInfo();
          });
        });
        el.querySelector('#gi-scr-edit').addEventListener('click', () => this.scriptElements.openEditor(script.id));
        el.querySelector('#gi-del').addEventListener('click', () => {
          this.selectElement(ent.id);
          this.action('deleteSelection');
        });
        return;
      }
      const info = this.elements ? this.elements.catalogInfoFor(ent) : null;
      const q = this.elementQuantities(ent);
      const fam = (info && info.familyName) || '—';
      const siblings = this.elements ? this.elements.siblingTypes(ent) : [];
      const typeOpts = siblings.length
        ? `<select id="gi-type">${siblings.map(t =>
          `<option value="${t.id}"${info && t.id === info.typeId ? ' selected' : ''}>${t.name}</option>`).join('')}</select>`
        : `<span>${(info && info.typeName) || '—'}</span>`;
      const lvl = ent.params && ent.params.baseLevel ? this.levelManager.getLevel(ent.params.baseLevel) : null;
      const p = ent.params || {};
      const rows = [];
      if (lvl) rows.push(['Base Level', lvl.name]);
      if (p.height != null && ent.type !== 'door' && ent.type !== 'window') rows.push(['Height', fmtLen(p.height)]);
      if (p.thickness != null) rows.push(['Thickness', fmtLen(p.thickness)]);
      if (p.width != null) rows.push(['Width', fmtLen(p.width)]);
      if (p.locationLine) rows.push(['Location Line', { centerline: 'Centerline', exterior: 'Exterior face', interior: 'Interior face' }[p.locationLine] || p.locationLine]);
      el.innerHTML = `
        <div class="gi-name"><span class="gi-cat">${(info && info.categoryName) || ent.type}</span> <span class="gi-eid">${ent.id}</span></div>
        <div class="stats">${fam}</div>
        <div class="gi-typerow"><span class="gi-tylab">Type</span>${typeOpts}</div>
        <div class="stats">${q.faces} faces · ${q.openings > 0.0005
          ? `${q.area.toFixed(2)} m² net <span class="dim">(gross ${q.gross.toFixed(2)} − openings ${q.openings.toFixed(2)})</span>`
          : q.area.toFixed(2) + ' m²'}${q.volume != null ? ' · ' + q.volume.toFixed(3) + ' m³' : ''}</div>
        ${q.bbox ? `<div class="stats dim">Bounding box ${q.bbox.size.map(x => x.toFixed(2)).join(' × ')} m</div>` : ''}
        ${rows.length ? `<div class="gi-params">${rows.map(r => `<div class="gi-prow"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}</div>` : ''}
        <button class="mini-btn primary" id="gi-eip">✏ Edit In Place</button>
        <button class="mini-btn" id="gi-del">Delete</button>
        <div class="dim" style="margin-top:4px">Hold <b>Ctrl</b> (or <b>Tab</b>) to query individual faces (m²) and edges (m)</div>`;
      const tsel = el.querySelector('#gi-type');
      if (tsel) tsel.addEventListener('change', () => {
        const t = siblings.find(x => x.id === tsel.value);
        if (t) this.applyElementType(ent, t);
      });
      el.querySelector('#gi-eip').addEventListener('click', () => this.enterEditInPlace(ent.id));
      el.querySelector('#gi-del').addEventListener('click', () => {
        this.selectElement(ent.id);
        this.action('deleteSelection');
      });
      return;
    }

    // ----- plain selection -----
    if (!this.sel.faces.size && !this.sel.edges.size) {
      el.innerHTML = `<div class="dim">Nothing selected</div>
        <div class="stats">${model.faces.size} faces · ${model.edges.size} edges · ${model.vertices.size} vertices · ${model.groups.size} groups</div>
        <div class="dim" style="margin-top:4px">Select faces ▸ Ctrl+G to group · select faces ▸ Give Thickness</div>`;
      return;
    }
    let len = 0;
    for (const id of this.sel.edges) { const e = model.edges.get(id); if (e) len += model.edgeLength(e); }
    let area = 0;
    for (const id of this.sel.faces) { const f = model.faces.get(id); if (f) area += model.faceArea(f); }
    const parts = [];
    if (this.sel.faces.size) parts.push(`${this.sel.faces.size} face${this.sel.faces.size > 1 ? 's' : ''}`);
    if (this.sel.edges.size) parts.push(`${this.sel.edges.size} edge${this.sel.edges.size > 1 ? 's' : ''}`);
    el.innerHTML = `<div class="selcount">${parts.join(' · ')}</div>
      ${this.sel.faces.size ? `<div>Area: ${area.toFixed(3)} m²</div>` : ''}
      ${this.sel.edges.size ? `<div>Length: ${fmtLen(len)}</div>` : ''}
      ${this.sel.faces.size ? '<button class="mini-btn primary" id="gi-thicken">Give Thickness…</button>' : ''}
      ${this._wallHint()}
      <div class="dim" style="margin-top:4px">Shift/Ctrl+click adds to the selection · areas are net of openings · Ctrl+G groups</div>`;
    const tb = el.querySelector('#gi-thicken');
    if (tb) tb.addEventListener('click', () => this.thickenDialog());
  }
  _wallHint() {
    if (this.sel.faces.size !== 1 || this.sel.edges.size) return '';
    const f = this.model.faces.get([...this.sel.faces][0]);
    if (!f) return '';
    const n = G.loopNormal(this.model.pts(f.loop));
    if (G.isZero(n) || Math.abs(n.z) >= 0.7) return '';
    return '<div class="dim" style="margin-top:6px">Wall face — press <b>W</b> (Resize Wall) to set an exact room dimension</div>';
  }

  // ------------------------------------------------------------------ edit ops
  // Element Browser "+" with a Grid Place selection active: place instances
  // of the chosen catalog type ON the selected grid targets. Columns go to
  // the selected intersections — ones that already carry a column are
  // SKIPPED (never stacked); wall types place along selected grid lines.
  placeTypeAtGridSelection(typeId) {
    const gp = this.tools && this.tools.gridplace;
    if (!gp || !this.db || !this.elements) return false;
    const hasIx = gp.selIx && gp.selIx.size > 0;
    const hasLines = gp.selLine && gp.selLine.size > 0;
    const hasCells = gp.selCell && gp.selCell.size > 0;
    if (!hasIx && !hasLines && !hasCells) return false; // no grid selection -> arm the tool
    const cat2 = this.elements._catalog || {};
    const type = (cat2.types || []).find(t => t.id === typeId);
    if (!type) return false;
    const fam = (cat2.families || []).find(f => f.id === type.familyId);
    const catName = (((cat2.categories || []).find(c => c.id === (fam || {}).categoryId) || {}).name || '').toLowerCase();
    const dp = type.defaultParameters || {};
    if (catName.indexOf('column') >= 0) {
      const pts = gp._selectedPoints();
      // occupancy is PER LEVEL: a Level-1 column does not block the Level-2
      // column at the same grid point (each story carries its own)
      const bl = this.bimOptions.baseLevel;
      const occupied = p => this.bim.entities.some(e =>
        e.type === 'column' && e.params && e.params.base &&
        (e.params.baseLevelId || e.params.baseLevel) === bl &&
        Math.hypot(e.params.base[0] - p[0], e.params.base[1] - p[1]) < 0.26);
      const free = pts.filter(p => !occupied(p));
      const skipped = pts.length - free.length;
      if (!free.length) { this.toast(skipped ? `All ${skipped} selected intersection${skipped === 1 ? '' : 's'} already ${skipped === 1 ? 'has' : 'have'} a column — nothing to add` : 'No intersections selected'); return true; }
      const w = Math.max(0.05, +dp.width || 0.3), d = Math.max(0.05, +dp.depth || 0.3);
      const z0 = this.levelManager.getElevation(this.bimOptions.baseLevel);
      let n = 0;
      this.transaction.run('place at grids', m => {
        m.bimHold = true;
        try {
          for (const p of free) {
            const params = {
              base: [p[0], p[1], z0], width: w, depth: d,
              baseLevelId: this.bimOptions.baseLevel,
              topLevelId: this.bimOptions.topConstraint !== 'unconnected' ? this.bimOptions.topConstraint : null,
              baseOffset: 0, topOffset: 0,
              height: Math.max(0.1, this.bimOptions.unconnectedHeight || 3),
              catalogTypeId: typeId,
            };
            const faces = this.structural.buildColumn(G, m, params);
            const b = this.structural.columnBounds(params);
            const roles = {}; const edges = [];
            for (const f of faces) {
              if (f.userData) continue;
              const c = m.faceCentroid(f);
              roles[f.id] = Math.abs(c.z - b.zEnd) < 1e-6 ? 'top' : Math.abs(c.z - b.zStart) < 1e-6 ? 'bottom' : 'side';
              for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
                const e = m.findEdge(r[i], r[(i + 1) % r.length]);
                if (e && !e.userData) edges.push(e.id);
              }
            }
            this.bim.create('column', {
              ...params, baseLevel: params.baseLevelId,
              topConstraint: params.topLevelId || 'unconnected', height: b.height,
            }, roles, edges);
            n++;
          }
        } finally { m.bimHold = false; }
      });
      this.cleanupWires();
      if (window.ElementBrowser && ElementBrowser.refresh) ElementBrowser.refresh();
      this.toast(`Placed ${n} × ${type.name}${skipped ? ` — skipped ${skipped} (column${skipped === 1 ? '' : 's'} already there)` : ''}`);
      return true;
    }
    if (catName.indexOf('wall') >= 0 && hasLines) {
      const prevT = gp.state.wallThickness;
      gp.state.wallThickness = Math.max(0.05, +dp.thickness || 0.2);
      const prevWhat = gp.state.placeWhat, prevSel = gp.state.selectWhat;
      gp.state.placeWhat = 'walls'; gp.state.selectWhat = 'lines';
      try { gp._place(); } finally {
        gp.state.wallThickness = prevT; gp.state.placeWhat = prevWhat; gp.state.selectWhat = prevSel;
      }
      if (window.ElementBrowser && ElementBrowser.refresh) ElementBrowser.refresh();
      return true;
    }
    // Structural Framing (beams) with grid LINES selected: place spans
    if ((catName.indexOf('framing') >= 0 || catName.indexOf('beam') >= 0) && hasLines) {
      const prev = {
        profile: gp.state.beamProfile, height: gp.state.beamHeight, width: gp.state.beamWidth,
        flw: gp.state.flangeWidth, flt: gp.state.flangeThickness,
        what: gp.state.placeWhat, sel: gp.state.selectWhat,
      };
      const BP = window.BeamProfiles;
      const norm = BP ? BP.normalize({
        profile: dp.profile || 'rectangular', height: dp.height, webWidth: dp.webWidth || dp.width,
        flangeWidth: dp.flangeWidth, flangeThickness: dp.flangeThickness,
      }) : null;
      gp.state.beamProfile = norm ? norm.profile : (dp.profile || 'rectangular');
      if (norm) {
        gp.state.beamHeight = norm.height; gp.state.beamWidth = norm.webWidth;
        gp.state.flangeWidth = norm.flangeWidth; gp.state.flangeThickness = norm.flangeThickness;
      }
      gp.state.placeWhat = 'beams'; gp.state.selectWhat = 'lines';
      try { gp._place(); } finally {
        gp.state.beamProfile = prev.profile; gp.state.beamHeight = prev.height; gp.state.beamWidth = prev.width;
        gp.state.flangeWidth = prev.flw; gp.state.flangeThickness = prev.flt;
        gp.state.placeWhat = prev.what; gp.state.selectWhat = prev.sel;
      }
      if (window.ElementBrowser && ElementBrowser.refresh) ElementBrowser.refresh();
      return true;
    }
    // Floor / Slab with grid CELLS selected: fill every selected bay
    if ((catName === 'floor' || catName === 'slab') && hasCells) {
      const prevT = gp.state.slabThickness, prevK = gp.state.slabKind;
      const prevWhat = gp.state.placeWhat, prevSel = gp.state.selectWhat;
      gp.state.slabThickness = Math.max(0.05, +dp.thickness || 0.2);
      gp.state.slabKind = catName === 'floor' ? 'floor' : 'slab';
      gp.state.placeWhat = 'floors'; gp.state.selectWhat = 'cells';
      try { gp._place(); } finally {
        gp.state.slabThickness = prevT; gp.state.slabKind = prevK;
        gp.state.placeWhat = prevWhat; gp.state.selectWhat = prevSel;
      }
      if (window.ElementBrowser && ElementBrowser.refresh) ElementBrowser.refresh();
      return true;
    }
    this.toast(catName.indexOf('wall') >= 0
      ? 'Walls need Grid LINES selected (Grid Place: Select → Grid Lines)'
      : (catName.indexOf('framing') >= 0 || catName.indexOf('beam') >= 0)
        ? 'Beams need Grid LINES selected (Grid Place: Select → Grid Lines)'
        : (catName === 'floor' || catName === 'slab')
          ? 'Floors need Grid CELLS selected (Grid Place: Select → Grid Cells)'
          : `${(fam || {}).categoryId ? (catName || 'this category') : 'This type'} places by drawing — doors/windows need a wall host`);
    return true;
  }
  // Clean Up: purge every wire edge (attached to no face) in one undoable
  // step — construction residue from BIM operations plus any orphaned
  // free-drawn lines. Everything with a face is untouched.
  cleanupWires() {
    const wires = this.model.wireEdges();
    if (!wires.length) { this.toast('Clean Up: nothing to remove — no stray lines found'); return 0; }
    let n = 0;
    this.transaction.run('clean up', m => { n = m.purgeWireEdges(); });
    this.view.clearPreview();
    this.toast(`Clean Up: removed ${n} stray line${n === 1 ? '' : 's'}`);
    return n;
  }
  // Unhide all softened (Ctrl+erased) edges — display-only inverse.
  unhideAllEdges() {
    let n = 0;
    this.transaction.run('unhide all', m => { n = m.unhideAllEdges(); });
    this.toast(n ? `Unhid ${n} edge${n === 1 ? '' : 's'}` : 'No hidden edges');
    return n;
  }
  // Export the visible solid geometry as a glTF 2.0 scene (.gltf, embedded
  // buffer) — faces triangulated exactly as the viewport renders them,
  // per-face colors become PBR base-color materials. Z-up is converted to
  // glTF's Y-up by a root-node rotation; units are meters (glTF native).
  exportGltf() {
    if (!window.GltfExporter) { this.toast('Exporter unavailable', true); return; }
    const gltf = GltfExporter.fromModel(this.model);
    const json = JSON.stringify(gltf);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'model/gltf+json' }));
    a.download = 'model.gltf';
    a.click();
    const mesh = gltf.meshes[0];
    const tris = mesh.primitives.reduce((s2, p2) => s2 + (p2._triCount || 0), 0);
    this.toast(`Exported model.gltf — ${tris} triangles, ${mesh.primitives.length} material${mesh.primitives.length === 1 ? '' : 's'}`);
  }
  deleteSelection() {
    // selected asset instances go first — hosted ones heal their wall inside
    // one transaction (the rebuild re-cuts every OTHER hosted element)
    if (this.selAssets.size && this.assets) {
      const ids = [...this.selAssets];
      const names = [];
      this.run('delete assets', () => {
        const walls = new Set();
        for (const id of ids) {
          const rec = this.assets.get(id);
          if (!rec) continue;
          if (rec.host && rec.host.wallId) walls.add(rec.host.wallId);
          this.assets.remove(id, { heal: false });
          names.push(rec.name);
        }
        for (const wid of walls) this.bim.rebuildWallWithHosts(wid);
      });
      this.selAssets.clear();
      this.onSelectionChanged();
      if (names.length) this.toast(`Removed “${names[0]}”${names.length > 1 ? ` + ${names.length - 1} more` : ''}`);
      return;
    }
    // selected grid lines go first (their hosted elements re-project)
    if (this.selGridIds.size) {
      const ids = [...this.selGridIds];
      const names = [], refused = [];
      this.run('delete grid', () => {
        for (const id of ids) {
          const g = this.gridManager.getGrid(id);
          const err = this.gridManager.removeGrid(id);
          if (typeof err === 'string') refused.push({ id, err }); // locked or elements attached
          else if (g) names.push(g.name);
        }
      });
      this.selGridIds = new Set(refused.map(r => r.id));
      this.selGridId = this.selGridIds.size ? [...this.selGridIds][0] : null;
      this.selGridZ = null;
      if (names.length) this.toast(`Grid ${names.join(', ')} deleted`);
      if (refused.length) this.toast(refused[0].err, true); // stays selected so the user can act
      this.onSelectionChanged();
      return;
    }
    if (!this.sel.faces.size && !this.sel.edges.size) return;
    // locked elements keep their geometry — only the free part of the
    // selection goes, and the user hears why
    const faces = [...this.sel.faces].filter(id => {
      const f = this.model.faces.get(id);
      return f && !this.isFaceLocked(f);
    });
    const edges = [...this.sel.edges].filter(id => {
      const e = this.model.edges.get(id);
      return e && !this.isEdgeLocked(e);
    });
    const skipped = this.sel.faces.size - faces.length + this.sel.edges.size - edges.length;
    if (skipped) this.toast(`Skipped ${skipped} locked item${skipped === 1 ? '' : 's'} — unlock in the Element Browser to delete`, true);
    if (!faces.length && !edges.length) { this.clearSelection(); return; }
    this.run('delete', m => {
      for (const id of faces) m.deleteFace(id);
      const edgeIds = edges.filter(id => m.edges.has(id));
      if (edgeIds.length) m.deleteEdgeIds(edgeIds);
    });
    this.sel = { edges: new Set(), faces: new Set() };
  }
  copySel() {
    if (!this.sel.faces.size && !this.sel.edges.size) { this.toast('Nothing selected'); return; }
    this.clipboard = this.model.serializeSubset(this.sel);
    this.toast(`Copied ${this.clipboard.f.length} faces, ${this.clipboard.e.length} edges`);
  }
  paste() {
    if (!this.clipboard) { this.toast('Clipboard is empty'); return; }
    const faces = this.run('paste', m => m.importSubset(this.clipboard, G.v()));
    if (faces) this.sel = { edges: new Set(), faces: new Set(faces.map(f => f.id)) };
    this.toast(`Pasted ${faces.length} faces (in place — use Move to position)`);
  }

  // ------------------------------------------------------------------ unit of work
  // Engine used by TransactionManager (app.transaction). App.begin/run remain
  // as thin delegates so existing call sites keep working.
  _beginTx(label = 'edit') {
    if (this._openTx && !this._openTx.finished) {
      // B1 hardening: a stale open transaction (caller crashed mid-edit) is
      // rolled back to its snapshot — the model returns to the last committed
      // state, and the user HEARS about it instead of silently losing work
      const stale = this._openTx.label;
      this._openTx.rollback();
      this.toast(`"${stale}" was interrupted — rolled back to the last saved step`, true);
    }
    // ROOT guard: every transaction carries an edge-sweep bracket — split
    // residue born inside any mutation path is reaped at commit/rollback
    if (this.model && this.model.beginEdgeSweep) this.model.beginEdgeSweep();
    this._openTx = new Transaction(this, label);
    return this._openTx;
  }
  _runTx(label, fn) {
    const tx = this._beginTx(label);
    let out;
    try {
      out = fn(this.model, tx);
      tx.commit();
    } catch (e) {
      tx.rollback();
      console.error(`[${label}] operation failed and was rolled back`, e);
      this.toast(`${label} failed — model restored`, true);
      return undefined;
    }
    return out;
  }
  begin(label = 'edit') { return this.transaction.begin(label); }
  run(label, fn) { return this.transaction.run(label, fn); }

  // ------------------------------------------------------------------ structural
  // Trim (or re-grow) level-bounded walls against overhead structure:
  // H_wall = story − t_slab − h_beam_web for everything crossing the wall's
  // baseline. Walls TRIM when structure lands above them and GROW BACK when
  // it is deleted — the dynamic infill behavior, driven entirely by the
  // parametric registry. `pool` may append not-yet-registered pending
  // elements (a slab/beam about to be built) via preTrimWallsFor().
  // Returns the number of walls whose height changed.
  syncStructuralWalls(pool = null) {
    if (!this.structural || this._syncingWalls) return 0;
    this._syncingWalls = true;
    let n = 0;
    try {
      for (const ent of this.bim.entities) {
        if (ent.type !== 'wall' || !ent.params || !ent.params.base) continue;
        const p = ent.params;
        if (!p.topConstraint || p.topConstraint === 'unconnected') continue; // explicit height
        if (this._fitWallClearance(ent, pool)) n++;
      }
    } finally { this._syncingWalls = false; }
    return n;
  }
  // One wall's clearance re-fit. The built wall sits ~1 mm below the
  // governing soffit (beams already carry their own 0.5 mm drop, so the
  // stagger keeps any two stacked faces from ever coinciding — no
  // z-fighting, invisible at any zoom).
  _fitWallClearance(ent, pool = null) {
    const p = ent.params;
    const cl = this.structural.wallClearance(p, {
      model: this.model,
      structure: pool ? [...this.bim.entities, ...pool] : undefined,
    });
    const reveal = cl.deductions.length ? 1e-3 : 0;
    const topZ = cl.topZ - reveal;
    const baseZ = p.base[2];
    const h = Math.max(0.05, topZ - baseZ);
    if (Math.abs(h - (p.height || 0)) < 1e-4) return false;
    const changed = this.transaction.run('wall clearance', () =>
      this.bim.syncWallTop(ent.id, topZ, cl.deductions));
    return changed === true;
  }
  // Pre-trim walls against a PENDING structural element (not yet in the
  // registry): the wall regenerates below the new soffit BEFORE the beam or
  // slab lands, so nothing ever sweeps through wall material.
  preTrimWallsFor(pendingEnt) {
    if (!this.structural) return 0;
    return this.syncStructuralWalls([pendingEnt]);
  }
  // Drop-panel columns re-fit when slabs appear, move or vanish above them:
  // the head must hang UNDER the covering slab (flat-slab construction) and
  // grows back to the level plane when the slab is deleted. Mirrors the wall
  // clearance sync — the parametric registry drives everything. `pool` may
  // append not-yet-registered pending slabs (pre-fit before a sweep).
  // Returns the number of columns whose head moved.
  syncDropPanels(pool = null) {
    if (!this.structural) return 0;
    const structure = pool ? [...this.bim.entities, ...pool] : null;
    let n = 0;
    for (const ent of this.bim.entities) {
      if (ent.type !== 'column' || !ent.params || !ent.faces.length) continue;
      if (!this.structural.isDropPanel(ent.params)) continue;
      const desired = this.structural.columnSolidTop(this.model, ent.params, structure);
      // current solid top straight from the built geometry (source of truth —
      // survives undo/redo and file loads without extra bookkeeping)
      let cur = -Infinity;
      for (const fid of ent.faces) {
        const f = this.model.faces.get(fid);
        if (!f) continue;
        const c = this.model.faceCentroid(f);
        if (c) cur = Math.max(cur, c.z);
      }
      if (cur === -Infinity) continue;
      if (Math.abs(cur - desired) < 1e-4) continue; // already fits
      const changed = this.transaction.run('drop panel fit', () =>
        this.bim.refitDropPanelColumn(ent.id, desired));
      if (changed === true) n++;
    }
    if (n) this.view.rebuild();
    return n;
  }

  // ------------------------------------------------------------------ undo
  undo() {
    if (!this.undoStack.length) { this.toast('Nothing to undo'); return; }
    this.redoStack.push(this.model.serialize());
    this.model.load(this.undoStack.pop());
    if (this.assets && this.model.assetListData) this.assets.restore(this.model.assetListData);
    // restored params can disagree with cached catalog types — re-resolve
    if (this.elements && this.elements.invalidateAllTypes) { this.elements.invalidateAllTypes(); this.syncElementsToDb(); }
    if (this.view.clearPins) this.view.clearPins(); // pinned areas belong to the overwritten state
    if (this.activeGroup != null && !this.model.groups.has(this.activeGroup)) this.exitGroup();
    if (this._eip) this._eip.reisolate(); // snapshots carry no hidden flags — re-hide the rest
    this.clearSelection();
    this._snapCache = null;
    this.view.rebuild();
    this.onLevelsChanged(); // level edits are transactional too — resync planes/dropdowns
    this.onGridsChanged();  // grids ride the same snapshots
    if (window.LayerPanel) LayerPanel.refresh(); // layer ops are transactional too
    this.updateInfo();
    this.refreshGroups();
    this._updateEditBox();
    if (!this._eip) this._saveAutosave();
  }
  redo() {
    if (!this.redoStack.length) { this.toast('Nothing to redo'); return; }
    this.undoStack.push(this.model.serialize());
    this.model.load(this.redoStack.pop());
    if (this.assets && this.model.assetListData) this.assets.restore(this.model.assetListData);
    if (this.elements && this.elements.invalidateAllTypes) { this.elements.invalidateAllTypes(); this.syncElementsToDb(); }
    if (this.view.clearPins) this.view.clearPins();
    if (this.activeGroup != null && !this.model.groups.has(this.activeGroup)) this.exitGroup();
    if (this._eip) this._eip.reisolate();
    this.clearSelection();
    this._snapCache = null;
    this.view.rebuild();
    this.onLevelsChanged();
    this.onGridsChanged();
    if (window.LayerPanel) LayerPanel.refresh();
    this.updateInfo();
    this.refreshGroups();
    this._updateEditBox();
    if (!this._eip) this._saveAutosave();
  }
  opDone() {
    // free-mode edits that structurally changed stamped faces detach those
    // BIM entities (the plain B-Rep survives untouched)
    if (this.model.bimDirty && this.model.bimDirty.size) {
      for (const id of this.model.bimDirty) {
        this.bim.detach(id);
        if (this.db) this.db.deleteElement(id).catch(() => { }); // row follows the entity
      }
      this.model.bimDirty.clear();
    }
    // entities whose geometry was deleted entirely leave the registry too
    // (the active Edit In Place element is exempt — finish() re-adopts it)
    for (const ent of [...this.bim.entities]) {
      if (this._eip && ent === this._eip.ent) continue;
      if (ent._pending) continue; // mid-commit pre-registration (joined walls register before extruding)
      if (!ent.faces.some(id => this.model.faces.has(id))) {
        this.bim.detach(ent.id);
        if (this.db) this.db.deleteElement(ent.id).catch(() => { }); // row follows the entity
      }
    }
    this.pruneSelection();
    this.model.pruneGroups();
    // hosted asset instances die with their wall (like hosted doors)
    if (this.assets) {
      const gone = this.assets.checkOrphans();
      if (gone) this.toast(`${gone} hosted asset${gone === 1 ? '' : 's'} removed with its wall`);
    }
    if (this.activeGroup != null && !this.model.groups.has(this.activeGroup)) this.exitGroup();
    // dynamic infill walls follow structure changes — DEFERRED: opDone also
    // fires mid-tool (geometry committed, entity not yet registered); syncing
    // there would transiently re-grow walls into freshly built structure
    if (!this._wallSyncQueued) {
      this._wallSyncQueued = true;
      queueMicrotask(() => {
        this._wallSyncQueued = false;
        this.syncStructuralWalls(); // deletions/edits re-fit walls (grow back)
        this.syncDropPanels(); // drop heads re-hang under slabs (or grow back)
      });
    }
    this._snapCache = null; // new endpoints/midpoints/centers must become snap candidates
    // ring-edge repair: splits can bear faces whose HOLE rings reference
    // vertex pairs with no edge (validate flags "ring pair has no edge" and
    // the hole reads as a torn face). edgesForRing is idempotent.
    for (const f of this.model.faces.values()) {
      this.model.edgesForRing(f.loop, true);
      for (const h of (f.holes || [])) this.model.edgesForRing(h, true);
    }
    this.bim.syncEntityLists(); // drift invariant: lists cover all stamped pieces
    // element isolation: walls touched by structural intruders regenerate
    // from their params — column inside => split around it; column gone =>
    // one whole wall, gap healed
    if (this.bim && this.bim._hostsDirty && this.bim._hostsDirty.size) {
      const dirty = [...this.bim._hostsDirty];
      this.bim._hostsDirty.clear();
      for (const wid of dirty) {
        const ent = this.bim.getEntityById(wid);
        if (!ent) continue;
        if (ent.type === 'wall') this.bim.rebuildWallWithHosts(wid, false);
        else if (ent.type === 'beam') this.bim.rebuildBeamEntity(wid);
        else if (ent.type === 'column') this.bim.rebuildColumnEntity(wid);
      }
    }
    this.refreshEdgeStamps();
    this.view.rebuild();
    this.updateInfo();
    this.refreshGroups();
    this._updateEditBox();
    if (!this._eip) this._saveAutosave(); // never persist the mid-edit isolation state
    this._dbSyncDebounced();               // mirrors entities to the database (skips during EIP)
  }

  // ------------------------------------------------------------------ files
  saveFile() {
    const data = JSON.stringify(this.model.serialize());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = 'model.websketch.json';
    a.click();
    this.toast('Model saved as model.websketch.json');
  }
  _saveAutosave() {
    clearTimeout(this._asTimer);
    this._asTimer = setTimeout(() => {
      try { localStorage.setItem('websketch3d', JSON.stringify(this.model.serialize())); } catch (e) { }
    }, 600);
  }
  _restoreAutosave() {
    try {
      const s = localStorage.getItem('websketch3d');
      if (!s) return;
      const data = JSON.parse(s);
      // a project with only datums (grids/levels, no geometry yet) still
      // restores — the vertex-count guard used to throw those saves away
      const hasContent = data && ((data.v && data.v.length) || (data.f && data.f.length)
        || (data.grid && data.grid.length) || (data.lvl && data.lvl.length));
      if (hasContent) {
        this.model.load(data);
        this.view.rebuild();
        // model.load swapped levels/grids wholesale: rebuild their view
        // layers too, or the datum planes/grips hold the pre-load state
        // (grids "disappeared" until a level edit nudged them back)
        this.onLevelsChanged();
        this.onGridsChanged();
        this.rederiveJunctions(); // pre-fix geometry self-heals on open
        // self-healing files: a model that still fails validate after
        // re-derivation is rebuilt wholesale from its parameters
        if (!this.model.validate().ok) {
          this.rebuildFromParams();
          this.toast('Model had invalid geometry — rebuilt from parameters');
        }
        this.view.zoomExtents();
        this.updateInfo();
        this.toast('Restored autosaved model — File ▸ New for a fresh start');
      }
    } catch (e) { }
  }

  // ------------------------------------------------------------------ misc ui
  setStatus(t) {
    if (this.activeGroup != null && this.model.groups.has(this.activeGroup)) {
      const g = this.model.groups.get(this.activeGroup);
      this.hintEl.textContent = `[Editing group "${g.name}" — Esc exits]  ` + (t || '');
    } else {
      this.hintEl.textContent = t || '';
    }
  }
  setVCB(t) { this.vcbEl.value = t; }
  toast(msg, isErr = false) {
    const wrap = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, 2600);
  }
}

function fmtVol(m3) {
  if (m3 >= 1000) return (m3 / 1000).toFixed(2) + ' m³';
  if (m3 < 0.001) return (m3 * 1e6).toFixed(0) + ' cm³';
  return m3.toFixed(3) + ' m³';
}

function vpCursor(toolId) {
  const draw = ['line', 'rect', 'circle', 'polygon', 'arc', 'tape'];
  const cvs = document.querySelector('#viewport canvas');
  if (!cvs) return;
  cvs.style.cursor = draw.includes(toolId) ? 'crosshair'
    : toolId === 'select' ? 'default'
      : toolId === 'pushpull' ? 'ns-resize'
        : toolId === 'orbit' ? 'move'
          : toolId === 'pan' ? 'move'
            : 'default';
}

window.addEventListener('DOMContentLoaded', () => {
  try { window.app = new App(); }
  catch (e) { // surface boot crashes into the DOM — headless runs have no console
    const d = document.createElement('div');
    d.id = 'booterr';
    d.textContent = 'BOOT FAILED: ' + (e && (e.stack || e.message) || e);
    d.style.cssText = 'position:fixed;left:8px;top:60px;z-index:99999;background:#fff;color:#c5221f;font:11px monospace;max-width:640px;white-space:pre-wrap;padding:6px;border:1px solid #c5221f';
    document.body.appendChild(d);
    throw e;
  }
});
