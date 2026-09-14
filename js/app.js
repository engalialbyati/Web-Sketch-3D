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
  polyline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 18l5-8 6 4 5-9"/><circle cx="4" cy="18" r="1.6" fill="currentColor" stroke="none"/><circle cx="9" cy="10" r="1.6" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="5" r="1.6" fill="currentColor" stroke="none"/></svg>',
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
  mirror: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 2v20" stroke-dasharray="3 2.4"/><path d="M9 6L3 12l6 6z"/><path d="M15 6l6 6-6 6z" opacity=".45"/></svg>',
  array: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6" opacity=".45"/><rect x="3" y="15" width="6" height="6" opacity=".45"/><rect x="15" y="15" width="6" height="6" opacity=".45"/></svg>',
  ellipse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="12" cy="12" rx="9" ry="5.5"/><path d="M12 12h9" opacity=".5"/></svg>',
  revolve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 12a8 8 0 1 1 3 6.2"/><path d="M4 12V7m0 5h5" opacity=".6"/><rect x="13" y="10" width="7" height="4" rx="1"/></svg>',
  followme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 16c4 0 6-8 10-8 3.5 0 5 4 8 4"/><path d="M3 16l2.5-3M3 16l3.6 1.2M21 12l-3-1.5M21 12l-2.6 2.4"/></svg>',
};

// command aliases contributed by SDK features (command -> tool id)
const ENGINE_COMMANDS = new Map();

const TOOL_DEFS = {
  // SketchUp-style direct modeling ribbon
  free: [
    { id: 'select', label: 'Select', key: 'Space' },
    'sep',
    { id: 'line', label: 'Line', key: 'L' },
    { id: 'polyline', label: 'Polyline', key: '' },
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
    { id: 'mirror', label: 'Mirror', key: 'I' },
    { id: 'array', label: 'Array', key: 'Y' },
    { id: 'revolve', label: 'Revolve', key: 'U' },
    { id: 'followme', label: 'Follow Me', key: 'N' },
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
    { id: 'opening', label: 'Opening', key: '' },
    'sep',
    { id: 'pushpull', label: 'Push/Pull', key: 'P' },
    { id: 'move', label: 'Move', key: 'M' },
    { id: 'mirror', label: 'Mirror', key: 'I' },
    { id: 'array', label: 'Array', key: 'Y' },
    'sep',
    { id: 'eraser', label: 'Eraser', key: 'E' },
    { id: 'trim', label: 'Trim', key: 'X' },
    { id: 'tape', label: 'Tape Measure', key: 'T' },
    { id: 'measurearea', label: 'Measure Area', key: 'A' },
    'sep',
    { id: 'orbit', label: 'Orbit', key: 'O' },
    { id: 'pan', label: 'Pan', key: 'H' },
  ],
  // Structural design ribbon — calculators over the same model. Empty for
  // now: the owner walks the contents in step by step (column design first)
  design: [
    { id: 'select', label: 'Select', key: 'Space' },
  ],
};

// ---------------------------------------------------------------------------
// Ribbon groups — the OpenCADStudio pattern: the toolbar renders NAMED
// GROUPS per mode (their RibbonGroup { title, tools }), not an anonymous
// button row with separators. Each mode acts as a ribbon tab (the #modetabs
// row); inside it every panel carries a title under its buttons.
//
// Group entries are tool ids, or one of the special tokens handled by
// _buildToolbar: undo, redo, zoomext, shadows, xray, wire, browser, layers,
// families, kit, levelsbtn, gridsbtn, levelview. Tools registered at runtime
// by Engine features (and so absent here) fall into a trailing "Tools" group.
// ---------------------------------------------------------------------------
const RIBBON_GROUPS = {
  free: [
    { title: 'Select', tools: ['select'] },
    { title: 'Draw', tools: ['line', 'polyline', 'rect', 'circle', 'arc', 'polygon', 'extrude'] },
    { title: 'Modify', tools: ['pushpull', 'offset', 'resize', 'move', 'rotate', 'scale', 'mirror', 'array'] },
    { title: 'Tools', tools: ['paint', 'eraser', 'trim', 'tape', 'measurearea', 'area'] },
    { title: 'Navigate', tools: ['orbit', 'pan'] },
    { title: 'Quick', tools: ['zoomext', 'undo', 'redo'] },
    { title: 'Display', tools: ['shadows', 'xray', 'wire'] },
    { title: 'Palettes', tools: ['browser', 'layers', 'families', 'kit'] },
  ],
  bim: [
    { title: 'Select', tools: ['select'] },
    { title: 'Datum', tools: ['levelsbtn', 'gridsbtn', 'gridplace', 'levelview'] },
    { title: 'Build', tools: ['draw', 'wall', 'floor', 'convert'] },
    { title: 'Structure', tools: ['column', 'beam', 'foundation', 'roof'] },
    { title: 'Circulation', tools: ['stairs', 'handrail'] },
    { title: 'Hosts', tools: ['door', 'window', 'opening'] },
    { title: 'Modify', tools: ['pushpull', 'move', 'mirror', 'array'] },
    { title: 'Tools', tools: ['eraser', 'trim', 'tape', 'measurearea'] },
    { title: 'Navigate', tools: ['orbit', 'pan'] },
    { title: 'Quick', tools: ['zoomext', 'undo', 'redo'] },
    { title: 'Display', tools: ['shadows', 'xray', 'wire'] },
    { title: 'Palettes', tools: ['browser', 'layers', 'families', 'kit'] },
  ],
  design: [
    { title: 'Select', tools: ['select'] },
    { title: 'Quick', tools: ['zoomext', 'undo', 'redo'] },
    { title: 'Display', tools: ['shadows', 'xray', 'wire'] },
    { title: 'Palettes', tools: ['browser', 'layers', 'families', 'kit'] },
  ],
};

// ---------------------------------------------------------------------------
// RIBBON TABS — the OpenCADStudio tab row (Draw / Model / Insert / Annotate /
// View / Manage). A tab is a pure toolbar LAYOUT: its tools may belong to
// either engine mode (Free = SketchUp direct, BIM = Revit parametric), and
// picking a tool from a tab auto-switches the engine mode the tool lives in
// (setTool → _pendingTool → setMode). The old per-mode ribbons still exist as
// the fallback for mode-first flows.
// ---------------------------------------------------------------------------
const RIBBON_TABS = {
  draw: { label: 'Draw', groups: [
    { title: 'Select', tools: ['select'] },
    { title: '2D Draw', tools: ['line', 'polyline', 'rect', 'circle', 'arc', 'polygon'] },
    { title: 'Sketch', tools: ['draw', 'wall', 'floor', 'convert'] },
    { title: 'Modify', tools: ['trim', 'offset', 'move', 'rotate', 'scale', 'mirror', 'array', 'resize'] },
  ] },
  model: { label: 'Model', groups: [
    { title: 'Create', tools: ['pushpull', 'extrude', 'revolve', 'followme'] },
    { title: 'Transform', tools: ['move', 'rotate', 'scale', 'mirror', 'array'] },
    { title: 'Tools', tools: ['paint', 'eraser'] },
  ] },
  insert: { label: 'Insert', groups: [
    { title: 'Structure', tools: ['column', 'beam', 'foundation', 'roof'] },
    { title: 'Circulation', tools: ['stairs', 'handrail'] },
    { title: 'Hosts', tools: ['door', 'window', 'opening'] },
    { title: 'Datum', tools: ['gridplace', 'levelsbtn', 'gridsbtn', 'levelview'] },
    { title: 'Libraries', tools: ['browser', 'families', 'kit'] },
  ] },
  annotate: { label: 'Annotate', groups: [
    { title: 'Measure', tools: ['tape', 'measurearea'] },
    { title: 'Display', tools: ['shadows', 'xray', 'wire'] },
  ] },
  view: { label: 'View', groups: [
    { title: 'Navigate', tools: ['orbit', 'pan', 'zoomext'] },
    { title: 'Palettes', tools: ['layers', 'browser'] },
  ] },
  manage: { label: 'Manage', groups: [
    { title: 'Quick', tools: ['undo', 'redo', 'zoomext'] },
    { title: 'Palettes', tools: ['families'] },
  ] },
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
// ---------------------------------------------------------------------------
// AimExtrudeTool — the "toward the mouse" extrude mode's click phase: a live
// ribbon preview follows the cursor for every selected edge; the click that
// ends it extrudes each edge toward the picked point (perpendicular to the
// edge — aiming along an edge can never go degenerate). Esc cancels.
// ---------------------------------------------------------------------------
class AimExtrudeTool extends Tool {
  constructor(app, eids, dist) {
    super(app);
    this.eids = eids;
    this.dist = dist;
  }
  activate() { this.app.view.clearPreview(); this.status(); }
  get hint() {
    return `Extrude toward mouse: click where the extrude should go — ${this.dist.toFixed(2)} m sweep, live preview. Esc cancels.`;
  }
  // AIM POINT FROM THE CURSOR RAY, not the ground plane: aiming UP at empty
  // sky must work (a ground-inferred point can never sit above the model).
  // The ray point closest to the selection's center is the aim target.
  _aimPoint(ev) {
    const app = this.app, m = app.model;
    let fallback = null;
    try {
      const inf = app.inferPoint(ev, null);
      fallback = inf && inf.p;
    } catch (err) { }
    try {
      const view = app.view;
      const { ro, rd } = view.rayFrom(view.eventPt(ev));
      // center of the selected edges
      let c = null, n = 0;
      for (const eid of this.eids) {
        const e = m.edges.get(eid);
        if (!e) continue;
        const A = m.vertices.get(e.a), B = m.vertices.get(e.b);
        if (!A || !B) continue;
        c = c ? G.add(c, G.add(A, B)) : G.add(A, B);
        n += 2;
      }
      if (!n) return fallback;
      c = G.mul(c, 1 / n);
      const s = G.dot(G.sub(c, ro), rd);
      if (!isFinite(s) || s <= 0.05) return fallback;
      return G.add(ro, G.mul(rd, s));
    } catch (err) {
      return fallback;
    }
  }
  _dirFor(e, p) {
    const m = this.app.model;
    const A = m.vertices.get(e.a), B = m.vertices.get(e.b);
    if (!A || !B) return null;
    const mid = G.mul(G.add(A, B), 0.5);
    const ed = G.norm(G.sub(B, A));
    let v = G.sub(p, mid);
    v = G.sub(v, G.mul(ed, G.dot(v, ed)));
    return G.len(v) < 1e-6 ? null : G.norm(v);
  }
  onMove(ev) {
    const app = this.app, view = app.view, m = app.model;
    const p = this._aimPoint(ev);
    if (!p) { view.clearPreview(); return; }
    view.clearPreview();
    for (const eid of this.eids) {
      const e = m.edges.get(eid);
      if (!e) continue;
      const dir = this._dirFor(e, p);
      if (!dir) continue;
      const A = m.vertices.get(e.a), B = m.vertices.get(e.b);
      view.previewQuadsBetween([A, B], [G.add(A, G.mul(dir, this.dist)), G.add(B, G.mul(dir, this.dist))]);
    }
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app;
    const p = this._aimPoint(ev);
    app.view.clearPreview();
    if (!p) { app.toast('Aim at a point away from the edges', true); return; }
    const live = this.eids.filter(id => app.model.edges.has(id));
    app.extrudeEdgesToward(live, p, this.dist);
    app.setTool('select');
  }
  onKey(ev) {
    if (ev.key === 'Escape') { this.app.view.clearPreview(); this.app.setTool('select'); return true; }
    return false;
  }
}

class Transaction {
  static MAX_UNDO = 100;
  constructor(app, label) {
    this.app = app;
    this.label = label;
    this.snapshot = app.model.serialize();
    this.sig = app._undoSig();
    this.snapshot._sig = this.sig; // dedupe key carried with the undo entry
    this.finished = false;
    this.rolledBack = false; // visible to callers: the tx-guard rollback in
                             // commit() restores geometry silently — entity
                             // registrations made for the edit must be undone
  }
  commit() {
    if (this.finished) return;
    const A = this.app;
    // no-op commit: nothing undoable changed between begin() and now (guard
    // refusals, aborted gestures, metadata-cleanups). Pushing the identical
    // snapshot would only pollute the undo stack — Ctrl+Z would appear to
    // "do nothing" once per no-op — and clearing redo for it destroys real
    // history. Skip both; opDone still runs so UI/db stay in sync.
    this._noop = A._undoSig() === this.sig;
    // Engine tx guard: a commit that INTRODUCES new structural errors rolls
    // back. Pre-existing errors (from an earlier crash or external edit) are
    // reported once but never block legitimate work on the model — the guard
    // compares the error state before vs after this edit, not the absolute.
    // A no-op commit cannot have introduced anything — skip the validate.
    if (window.Engine && Engine.txGuard && !this._validated && !this._noop) {
      const after = A.model.validate();
      if (!after.ok && after.errors && after.errors.length) {
        // check whether these errors pre-date this edit: validate the
        // pre-transaction snapshot (a deep copy — safe to load into a scratch)
        let preExisting = 0;
        try {
          const scratch = Object.create(Object.getPrototypeOf(A.model));
          // structuredClone: the JSON round-trip double-serialized the whole
          // snapshot on the main thread — a classic freeze on large models
          scratch.load((window.structuredClone || (o => JSON.parse(JSON.stringify(o))))(this.snapshot));
          const before = scratch.validate();
          preExisting = before.ok ? 0 : (before.errors || []).length;
        } catch (e) { preExisting = 0; }
        if (after.errors.length > preExisting) {
          this.finished = true;
          this.rollback();
          A.toast(`"${this.label}" rolled back — invalid geometry`, true);
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
    if (!this._noop) {
      A.undoStack.push(this.snapshot);
      if (A.undoStack.length > Transaction.MAX_UNDO) A.undoStack.shift();
      A.redoStack.length = 0;
    }
    if (A.model && A.model.endEdgeSweep)
      while (A.model._sweepStack && A.model._sweepStack.length) A.model.endEdgeSweep(); // drain: an interrupted NESTED bracket must not shield residue
    if (A.validateOnCommit && !this._noop) {
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
  constructor(model) { this.model = model; this._idHwm = {}; }
  get entities() { return this.model.bimEntities; }
  _nextId(type) {
    // MONOTONIC — ids are never recycled. Split pieces carry the ORIGINAL
    // element's id as their merge lineage (p.merge.group), so a recycled id
    // would let a NEW element inherit a dead element's split pieces — the
    // "my wall merged with a random element" bug class. The scan re-seeds
    // the high-water mark for loaded models; the floor keeps it rising.
    const prefix = type + '_';
    let max = this._idHwm[type] || 0;
    for (const e of this.entities) {
      if (typeof e.id === 'string' && e.id.startsWith(prefix)) {
        const n = parseInt(e.id.slice(prefix.length), 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    this._idHwm[type] = max + 1;
    return prefix + (max + 1);
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
    // a removed/added BEAM cuts columns at its endpoints — mark them dirty.
    // A beam CROSSING walls also re-trims those walls (the face rule).
    if (ent.type === 'beam' && ent.params && ent.params.baseline) {
      for (const p of ent.params.baseline)
        for (const c of this.entities)
          if (c.type === 'column' && c.params && c.params.base
            && Math.hypot(c.params.base[0] - p[0], c.params.base[1] - p[1]) < 0.75)
            this._hostsDirty.add(c.id);
      for (const w of this.entities) {
        if (w.type !== 'wall' || !w.params || !w.params.base || !w.params.end) continue;
        // wall midpoint or endpoints near the beam's line = likely crossing
        const A2 = ent.params.baseline[0], B2 = ent.params.baseline[ent.params.baseline.length - 1];
        const bdx = B2[0] - A2[0], bdy = B2[1] - A2[1];
        const bL = Math.hypot(bdx, bdy) || 1;
        const nb = [-bdy / bL, bdx / bL];
        const distToBeam = (px, py) => Math.abs((px - A2[0]) * nb[0] + (py - A2[1]) * nb[1]);
        const wmx = (w.params.base[0] + w.params.end[0]) / 2, wmy = (w.params.base[1] + w.params.end[1]) / 2;
        if (distToBeam(w.params.base[0], w.params.base[1]) < 1.2
          || distToBeam(w.params.end[0], w.params.end[1]) < 1.2
          || distToBeam(wmx, wmy) < 1.2)
          this._hostsDirty.add(w.id);
      }
    }
    for (const w of this.entities) {
      if (w.type === 'beam' && w.params && w.params.baseline) {
        // segment proximity, not endpoint-only: a column in the beam's
        // MID-RUN splits it (the element rule) — mark it dirty too
        const bl = w.params.baseline;
        const A2 = bl[0], B2 = bl[bl.length - 1];
        const bdx = B2[0] - A2[0], bdy = B2[1] - A2[1], bL2 = bdx * bdx + bdy * bdy || 1;
        const t = Math.max(0, Math.min(1, ((c.x - A2[0]) * bdx + (c.y - A2[1]) * bdy) / bL2));
        if (Math.hypot(c.x - (A2[0] + bdx * t), c.y - (A2[1] + bdy * t)) < 1.0)
          this._hostsDirty.add(w.id);
        continue;
      }
      if (w.type !== 'wall' || !w.params || !w.params.base || !w.params.end) continue;
      // every wall reacts to intruders now (the plan-trim rule), but the
      // REGENERATION differs: parametric walls rebuild whole from params;
      // freeform walls get a plan-trim rebuild that preserves their drawn
      // baseline and only shortens the span around the intruder
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
  create(type, params, faceRoles, edgeIds = [], opts = {}) {
    const ent = this._createInner(type, params, faceRoles, edgeIds);
    // joined-wall PRE-REGISTRATION opts in before anything below can run:
    // this create fires app.opDone at its end, whose empty-faces reap would
    // detach the not-yet-extruded entity on the spot (the 90° corner wall
    // that rendered but never appeared in the browser — an orphan)
    if (ent && opts.pending) ent._pending = true;
    if (ent) this._markHostsDirty(ent);
    // a NEW wall must respect the face rule from birth: drawn through a
    // standing column/beam, opDone plan-trims it immediately (a wall
    // already grid-trimmed to an intruder's face kisses at 1 mm — under
    // the bite gate this is a no-op)
    if (ent && ent.type === 'wall' && ent.params && ent.params.base
      && ent.params.end && !ent.params.closed) {
      this._hostsDirty = this._hostsDirty || new Set();
      this._hostsDirty.add(ent.id);
    }
    // registration completes the unit of work: tools register AFTER their
    // transaction (whose commit-opDone ran before this entity existed), so
    // without this the face-rule trims sat unprocessed until the NEXT
    // operation — a column landed and the wall stood unsplit until you
    // did something else. Batch placements suspend it (one opDone for all).
    const A = window.app;
    if (ent && A && A.opDone && !this._holdOpDone
      && (!A._openTx || A._openTx.finished)) A.opDone();
    return ent;
  }
  _createInner(type, params, faceRoles, edgeIds = []) {
    const id = this._nextId(type);
    // new elements land on the CURRENT layer (AutoCAD behavior); legacy
    // entities without a layer resolve back to '0' on load
    const ent = { id, type, params, faces: Object.keys(faceRoles).map(Number), edges: [...edgeIds], layerId: this.model.currentLayerId || '0' };
    this.entities.push(ent);
    // REGISTRY INVALIDATION: tools build geometry first and register after —
    // the geometry commit's rebuild cached the view's no-op-gate signature
    // BEFORE this entity existed, and registration changes no model counts,
    // so every later rebuild no-opped and the new element never got its
    // Group (placed columns rendered as ghosts until some edit happened to
    // bump the version). Registration IS a display-state change: touch().
    if (this.model && this.model.touch) this.model.touch();
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
    // capture every ring edge of the geometry about to die: after deletion
    // only THESE can be orphaned — reaping just them is O(deleted), while a
    // full reapOrphanEdges() walks every edge in the model per wall
    // (O(all) x N walls was the Rebuild-from-Parameters freeze)
    const doomed = new Set();
    const collect = fid => {
      const f = m.faces.get(fid);
      if (!f) return;
      for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
        const e = m.findEdge(r[i], r[(i + 1) % r.length]);
        if (e) doomed.add(e.id);
      }
    };
    for (const h of hosted) for (const fid of [...h.faces]) collect(fid);
    for (const fid of [...ent.faces]) collect(fid);
    for (const h of hosted) for (const fid of [...h.faces]) m.faces.delete(fid);
    for (const fid of [...ent.faces]) m.faces.delete(fid);
    for (const eid of [...ent.edges]) m.edges.delete(eid);
    m.gc();
    // deleting the wall's recorded edges can also take edges it SHARED with
    // touching geometry (a hosted opening's reveals, a floor at the corner)
    // — recreate any ring edge a SURVIVOR still needs. Scoped to the faces
    // that actually bordered the doomed set: the old all-faces walk was
    // O(model) per wall — the Rebuild-from-Parameters freeze.
    const survivors = new Set();
    for (const eid of doomed) {
      const e = m.edges.get(eid);
      if (!e) continue;
      for (const f2 of m.facesAdjacentToEdge(e)) survivors.add(f2.id);
    }
    for (const fid of survivors) {
      const f2 = m.faces.get(fid);
      if (!f2) continue;
      m.edgesForRing(f2.loop, true);
      for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
    }
    // edges born from HOSTED CUTS (the notch splits in the wall's old loops)
    // die with their faces — reap them or the fresh re-extrusion welds the
    // stale notch lines back in and fragments. Full reap (one-pass index,
    // cheap) also purges the freed vertices so nothing stale chains in.
    m.reapOrphanEdges();
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
      // snapshot BEFORE the cut: the reveal band born from the cut itself
      // stamps to the hosted element as 'lining' — the same ownership the
      // original placement records, so deleting the element heals cleanly.
      // v0.6: the hold names THIS wall as owner so the cut may open its
      // freshly-stamped faces (every other element stays an island)
      const hb = new Set(m.faces.keys());
      m.bimHold = id;
      let info;
      try {
        info = window.BimTools.HostedCut.cut(G, m, ent.params, spec);
      } finally {
        m.bimHold = false; // release the named hold; the base hold remains
      }
      if (info.error) continue;
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
      // the face rule survives every rebuild path — a wall edited onto a
      // standing column's line re-trims on the spot (cheap null early-out
      // when nothing blocks it)
      if (ok && ent.params && ent.params.base && ent.params.end && !ent.params.closed
        && window.app && window.app.structural && window.app.structural.wallPlanTrims(ent.params))
        this.planTrimWall(id);
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
  // PRE-SPLIT walls for a column about to land: every wall whose run the
  // column's footprint crosses retreats to its face BEFORE the column's
  // sweep — the sweep then travels between the pieces instead of slicing
  // through wall material (the asymmetric slice is what tore the split
  // cascade: 'adding a column to a wall' froze the app).
  // PRE-SPLIT beams for a column about to land: every beam whose run the
  // column rises through splits at its faces BEFORE the column's sweep —
  // the same never-cut-through-material contract as walls.
  preSplitBeamsForColumn(colParams) {
    if (!window.app || !window.app.structural || !colParams.base) return 0;
    let n = 0;
    const c = colParams.base;
    const reach = Math.max(colParams.width || 0.3, colParams.depth || 0.3) + 0.6;
    for (const b of [...this.entities]) {
      if (b.type !== 'beam' || !b.params || !b.params.baseline) continue;
      const bl = b.params.baseline;
      const A2 = bl[0], B2 = bl[bl.length - 1];
      const bdx = B2[0] - A2[0], bdy = B2[1] - A2[1], bL2 = bdx * bdx + bdy * bdy || 1;
      const t = Math.max(0, Math.min(1, ((c[0] - A2[0]) * bdx + (c[1] - A2[1]) * bdy) / bL2));
      if (Math.hypot(c[0] - (A2[0] + bdx * t), c[1] - (A2[1] + bdy * t)) > reach) continue;
      if (this.planTrimBeam(b.id, { pending: [{ type: 'column', params: colParams }] })) n++;
    }
    return n;
  }
  // BEAM-FACE RULE (element mirror of the wall rule): a column rising
  // through a beam's depth splits it into independent BEAM elements — each
  // selectable, editable, deletable alone — sharing a merge group. Piece
  // baselines run CENTER-TO-CENTER (to the splitter's center) so buildBeam
  // lands their ends on the column faces exactly like hand-drawn framing
  // beams. No mid-run columns: a single piece rebuilds (the end-trim heal).
  planTrimBeam(id) {
    const ent = this.getEntityById(id);
    if (!ent || ent.type !== 'beam') return false;
    const p = ent.params;
    if (!p.baseline || p.baseline.length < 2) return false;
    const app = window.app || {};
    const eipEnt = app._eip && app._eip.ent;
    if (eipEnt === ent) return true;
    const m = this.model;
    const pending = (arguments[1] && arguments[1].pending) || null;
    const trims = app.structural ? app.structural.beamPlanTrims(p, pending) : null;
    if (!trims) {
      if (p.merge) return this._deriveGroupSpansBeam(ent);
      return this.rebuildBeamEntity(id); // no mid-run column: end-trim heal
    }
    const bl = p.baseline;
    const A = bl[0], B = bl[bl.length - 1];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
    // spans run center-to-center: each blocked interval contributes its
    // splitter center as the adjacent pieces' baseline endpoint
    const spans = [];
    let cur = 0;
    for (const iv of trims.intervals) {
      if (iv.tc - cur > 0.05) spans.push([cur, iv.tc]);
      cur = iv.tc;
    }
    if (L - cur > 0.05) spans.push([cur, L]);
    if (!spans.length) {
      m.beginEdgeSweep();
      const held = m.bimHold;
      try {
        m.bimHold = true;
        for (const fid of [...ent.faces]) m.faces.delete(fid);
        this._wipeEdges(ent.edges);
        m.gc();
        m.reapOrphanEdges();
        ent.faces = []; ent.edges = [];
        m.bimHold = held;
      } finally { m.endEdgeSweep(); m.bimHold = held; }
      return true;
    }
    return this._splitBeamToSpans(ent, spans, { A, ux, uy, L, pending });
  }
  // split a beam's span into independent beam pieces (see planTrimWall's
  // _splitWallToSpans for the full contract — this is its beam mirror)
  _splitBeamToSpans(ent, spans, g) {
    const m = this.model;
    const p = ent.params;
    const z = g.A[2];
    const at = t => [g.A[0] + g.ux * t, g.A[1] + g.uy * t, z];
    const prev = p.merge || null;
    const orig = prev
      ? { group: prev.group, a: prev.a, b: prev.b }
      : { group: ent.id, a: [g.A[0], g.A[1], z], b: [at(g.L)[0], at(g.L)[1], z] };
    // slots in ORIGINAL-run coordinates — a piece re-split later carries a
    // baseline offset along the run, so piece-local t values would not match
    // what _deriveGroupSpansBeam compares against (tOf on the original run)
    const oa = orig.a, ob = orig.b;
    const oL = Math.hypot(ob[0] - oa[0], ob[1] - oa[1]) || 1;
    const ox = (ob[0] - oa[0]) / oL, oy = (ob[1] - oa[1]) / oL;
    const tOf = q => (q[0] - oa[0]) * ox + (q[1] - oa[1]) * oy;
    const conv = spans.map(([t0, t1]) => [tOf(at(t0)), tOf(at(t1))]);
    let slots = conv;
    if (prev && Array.isArray(prev.slots)) {
      // re-split of an existing piece: sibling slots still guard their own
      // ground — replace only THIS piece's slot with the new spans, or the
      // next derive kicks every sibling out of the merge group
      const myA = tOf(g.A), myB = tOf(at(g.L));
      slots = prev.slots
        .filter(s => !(s[0] < myB - 1e-6 && s[1] > myA + 1e-6))
        .concat(conv)
        .sort((a, b) => a[0] - b[0]);
    }
    m.beginEdgeSweep();
    const held = m.bimHold;
    let ok = true;
    try {
      m.bimHold = true;
      for (const fid of [...ent.faces]) m.faces.delete(fid);
      this._wipeEdges(ent.edges);
      m.gc();
      m.reapOrphanEdges(); // corpses poison the next split cascade
      for (const f2 of m.faces.values()) {
        m.edgesForRing(f2.loop, true);
        for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
      }
      ent.faces = []; ent.edges = [];
      m.bimHold = held;
      for (let s = 0; s < spans.length; s++) {
        const [t0, t1] = spans[s];
        const A2 = at(t0), B2 = at(t1);
        let target;
        if (s === 0) {
          p.baseline = [[A2[0], A2[1], z], [B2[0], B2[1], z]];
          p.merge = { group: orig.group, a: orig.a, b: orig.b, slots };
          target = ent;
        } else {
          target = this._createInner('beam', { ...p,
            baseline: [[A2[0], A2[1], z], [B2[0], B2[1], z]],
            merge: { group: orig.group, a: orig.a, b: orig.b, slots } }, {}, []);
        }
        if (!this._extrudeBeamSpan(target, A2, B2, g.pending)) ok = false;
      }
    } finally { m.endEdgeSweep(); m.bimHold = held; }
    return ok;
  }
  // extrude ONE beam piece from its center-to-center baseline — buildBeam
  // lands the ends on the column faces (pending columns count while the
  // splitter is still being placed)
  _extrudeBeamSpan(piece, A2, B2, pending) {
    const m = this.model;
    const app = window.app || {};
    const p = piece.params;
    const before = new Set(m.faces.keys());
    const held = m.bimHold;
    m.bimHold = true;
    try {
      app.structural.buildBeam(G, m, { ...p,
        baseline: [[A2[0], A2[1], A2[2]], [B2[0], B2[1], B2[2]]] }, pending);
      const nf = [...m.faces.keys()].filter(x => !before.has(x)).map(x => m.faces.get(x)).filter(f2 => f2 && !f2.userData);
      const ne = [];
      for (const f2 of nf) {
        f2.userData = { bimEntityId: piece.id, bimType: 'beam', role: 'body' };
        for (const r of m.rings(f2)) for (let i = 0; i < r.length; i++) {
          const e = m.findEdge(r[i], r[(i + 1) % r.length]);
          if (e) { if (!e.userData) e.userData = { bimEntityId: piece.id, bimType: 'beam', role: 'profile' }; ne.push(e.id); }
        }
      }
      if (!nf.length) return false;
      piece.faces = piece.faces.concat(nf.map(f2 => f2.id));
      piece.edges = [...new Set(piece.edges.concat(ne))];
    } finally { m.bimHold = held; }
    return true;
  }
  // HEAL / REUNITE beams — the wall group-derivation mirror: expand into
  // freed ground (bounded by sibling slots — deleted territory never
  // resurrects), merge pieces whose targets meet, drop edited members.
  _deriveGroupSpansBeam(ent) {
    const app = window.app || {};
    const m = this.model;
    const p = ent.params;
    const mg = p.merge;
    const heldD = m.bimHold;
    if (!mg || !mg.a || !mg.b) { delete p.merge; return true; }
    const oa = mg.a, ob = mg.b;
    const L0 = Math.hypot(ob[0] - oa[0], ob[1] - oa[1]) || 1;
    const ux = (ob[0] - oa[0]) / L0, uy = (ob[1] - oa[1]) / L0;
    const tOf = q => (q[0] - oa[0]) * ux + (q[1] - oa[1]) * uy;
    const offRun = q => Math.abs(-(q[0] - oa[0]) * uy + (q[1] - oa[1]) * ux) >= 1e-4;
    const sectOf = q => [q.profile || 'rectangular', q.webWidth, q.flangeWidth, q.height,
      q.referenceLevelId != null ? q.referenceLevelId : q.baseLevel, q.zJustification, q.zOffset];
    const inSlot = (t0, t1) => (mg.slots || []).some(s =>
      Math.abs(t0 - s[0]) < 1e-6 && Math.abs(t1 - s[1]) < 1e-6);
    const members = [];
    for (const e of [...this.entities]) {
      if (e.type !== 'beam' || !e.params || !e.params.merge || e.params.merge.group !== mg.group) continue;
      const q = e.params;
      if (!q.baseline || q.baseline.length < 2) continue;
      if (JSON.stringify(sectOf(q)) !== JSON.stringify(sectOf(p))
        || offRun(q.baseline[0]) || offRun(q.baseline[q.baseline.length - 1])
        || !inSlot(tOf(q.baseline[0]), tOf(q.baseline[q.baseline.length - 1]))) { delete q.merge; continue; }
      members.push(e);
    }
    if (!members.length) return true;
    const trims = app.structural ? app.structural.beamPlanTrims({ ...p, baseline: [[oa[0], oa[1], oa[2]], [ob[0], ob[1], ob[2]]] }) : null;
    const free = [];
    let cur = 0;
    for (const iv of (trims ? trims.intervals : [])) {
      if (iv.tc - cur > 0.05) free.push([cur, iv.tc]);
      cur = iv.tc;
    }
    if (L0 - cur > 0.05) free.push([cur, L0]);
    const slots = (mg.slots || []).map(s => [s[0], s[1]]);
    const rows = members.map(e => {
      const bl = e.params.baseline;
      const t0 = tOf(bl[0]), t1 = tOf(bl[bl.length - 1]);
      let lo = 0, hi = L0;
      for (const s of slots) {
        if (t0 >= s[0] - 1e-4 && t1 <= s[1] + 1e-4) continue;
        if (s[1] <= t0 + 1e-4) lo = Math.max(lo, s[1]);
        if (s[0] >= t1 - 1e-4) hi = Math.min(hi, s[0]);
      }
      return { e, t0, t1, lo, hi };
    }).sort((a, b) => a.t0 - b.t0);
    for (let i = 0; i < rows.length; i++)
      for (let j = 0; j < rows.length; j++) {
        if (i === j) continue;
        if (rows[j].t0 >= rows[i].t1 - 1e-4) rows[i].hi = Math.min(rows[i].hi, rows[j].t0);
        if (rows[j].t1 <= rows[i].t0 + 1e-4) rows[i].lo = Math.max(rows[i].lo, rows[j].t1);
      }
    for (const r of rows) {
      let a = r.t0, b = r.t1, fi = -1;
      for (let k = 0; k < free.length; k++) {
        const f = free[k];
        if (f[0] <= r.t0 + 1e-4 && f[1] >= r.t1 - 1e-4) { a = Math.max(f[0], r.lo); b = Math.min(f[1], r.hi); fi = k; break; }
      }
      if (b - a < (r.t1 - r.t0) - 1e-9) { a = r.t0; b = r.t1; }
      r.a = a; r.b = b; r.fi = fi;
    }
    // MERGE only within the SAME free interval: beam pieces share the
    // splitter's center as a baseline endpoint by construction, so merely
    // touching targets does NOT mean the blocker left (for walls it does —
    // their pieces are always separated by the intruder's footprint).
    // Same free interval = the ground between them opened up.
    const groups = [];
    for (const r of rows) {
      const last = groups[groups.length - 1];
      if (last && r.fi === last.fi && r.fi >= 0 && r.a <= last.b + 1e-4) {
        last.b = Math.max(last.b, r.b); last.members.push(r.e); last.rows.push(r);
      } else groups.push({ a: r.a, b: r.b, members: [r.e], rows: [r], fi: r.fi });
    }
    if (groups.length === rows.length && groups.every((gr, i) => gr.members[0] === rows[i].e
      && Math.abs(gr.a - rows[i].t0) < 1e-6 && Math.abs(gr.b - rows[i].t1) < 1e-6)) return true;
    m.beginEdgeSweep();
    let ok = true;
    try {
      const A2 = t => [oa[0] + ux * t, oa[1] + uy * t, oa[2]];
      const slotIdxOf = r => (mg.slots || []).findIndex(s =>
        Math.abs(r.t0 - s[0]) < 1e-6 && Math.abs(r.t1 - s[1]) < 1e-6);
      const used = new Set();
      for (const gr of groups) for (const r of gr.rows) used.add(slotIdxOf(r));
      const keptDead = (mg.slots || []).filter((s, i) => !used.has(i));
      const newSlots = groups.map(gr => [gr.a, gr.b]).concat(keptDead).sort((a, b) => a[0] - b[0]);
      m.bimHold = true;
      const allMembers = groups.flatMap(gr => gr.members);
      for (const e of allMembers) {
        for (const fid of [...e.faces]) m.faces.delete(fid);
        this._wipeEdges(e.edges);
      }
      m.gc();
      m.reapOrphanEdges(); // corpses poison the next split cascade
      for (const f2 of m.faces.values()) {
        m.edgesForRing(f2.loop, true);
        for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
      }
      for (const e of allMembers) { e.faces = []; e.edges = []; }
      m.bimHold = heldD;
      for (const gr of groups) {
        const survivor = gr.members[0];
        const gone = [];
        for (const e of gr.members) if (e !== survivor) { gone.push(e.id); this.detach(e.id); }
        // absorbed pieces may own corners (the split re-pointed neighbors
        // at them) — their refs must follow the survivor or the healed
        // corner's miter rebuild dangles the same way
        if (gone.length) this._repointJoinRefs(new Set(gone), survivor.id);
        const whole = groups.length === 1 && gr.a <= 1e-6 && gr.b >= L0 - 1e-6;
        survivor.params.baseline = [[A2(gr.a)[0], A2(gr.a)[1], oa[2]], [A2(gr.b)[0], A2(gr.b)[1], oa[2]]];
        if (whole) delete survivor.params.merge;
        else survivor.params.merge = { group: mg.group, a: oa, b: ob, slots: newSlots };
        if (!this._extrudeBeamSpan(survivor, A2(gr.a), A2(gr.b))) ok = false;
      }
    } finally { m.endEdgeSweep(); m.bimHold = heldD; }
    return ok;
  }
  preSplitWallsForBeam(beamParams) {
    if (!window.app || !window.app.structural || !beamParams.baseline) return 0;
    let n = 0;
    const bl = beamParams.baseline;
    const A2 = bl[0], B2 = bl[bl.length - 1];
    const bdx = B2[0] - A2[0], bdy = B2[1] - A2[1], bL = Math.hypot(bdx, bdy) || 1;
    const reach = (beamParams.height || 0.5) / 2 + 1.2;
    const distSeg = (px, py) => {
      const t = Math.max(0, Math.min(1, ((px - A2[0]) * bdx + (py - A2[1]) * bdy) / (bL * bL)));
      return Math.hypot(px - (A2[0] + bdx * t), py - (A2[1] + bdy * t));
    };
    for (const w of [...this.entities]) {
      if (w.type !== 'wall' || !w.params || !w.params.base || !w.params.end) continue;
      const wm = [(w.params.base[0] + w.params.end[0]) / 2, (w.params.base[1] + w.params.end[1]) / 2];
      if (distSeg(w.params.base[0], w.params.base[1]) > reach
        && distSeg(w.params.end[0], w.params.end[1]) > reach
        && distSeg(wm[0], wm[1]) > reach) continue;
      if (this.planTrimWall(w.id, { pending: [{ type: 'beam', params: beamParams }] })) n++;
    }
    return n;
  }
  // JOIN RE-TARGETING: a neighbor's join record names the element that owns
  // the shared corner. Splits can move that corner onto a NEW piece (piece 0
  // keeps the id but may be the far end), and heals merge pieces back into
  // the survivor — without re-pointing, the next miter rebuild computes
  // against a wall that no longer touches this one: garbage ring, invalid
  // geometry, and the 90° corner visibly comes apart. Handles both record
  // shapes (plain id string and {id, mode}). `nearPt` limits the re-point to
  // refs whose neighbor endpoint coincides with it (a split moves only ONE
  // corner to a new piece; refs to the untouched corner must stay).
  _repointJoinRefs(fromIds, toId, nearPt = null) {
    if (!fromIds || !fromIds.size || !toId) return;
    for (const nb of this.entities) {
      if (nb.type !== 'wall' || !nb.params || !nb.params.joins) continue;
      const j = nb.params.joins;
      for (const side of ['start', 'end']) {
        const rec = j[side];
        const rid = rec == null ? null : typeof rec === 'object' ? rec.id : rec;
        if (rid == null || !fromIds.has(rid)) continue;
        if (nearPt) {
          const pt = side === 'start' ? nb.params.base : nb.params.end;
          if (!pt || Math.hypot(pt[0] - nearPt[0], pt[1] - nearPt[1]) > 1e-3) continue;
        }
        j[side] = typeof rec === 'object' ? { ...rec, id: toId } : toId;
      }
    }
  }
  // HIDDEN CENTERLINES (pure inference — the line is never drawn): the
  // parametric axis of every wall (base->end), beam (baseline) and column
  // (center point). Returns the nearest axis point under the cursor ray
  // within the same pixel reach as the on-edge tracker, so placing a
  // column near a 200 mm wall lands at exactly its 100 mm center without
  // any grid line. Corners stay with the endpoint snaps (higher tier).
  _centerlineSnap(q, ro, rd, view) {
    const PX = 10;
    let best = null, bestD = PX;
    const consider = (p, label, axis, dir) => {
      const sp = view.worldToScreenPixels(p);
      if (!sp.visible) return;
      const d = Math.hypot(sp.x - q.x, sp.y - q.y);
      if (d < bestD) { bestD = d; best = { p: G.clone(p), kind: 'centerline', label, axis, dir }; }
    };
    for (const ent of this.entities) {
      const p = ent.params;
      if (!p) continue;
      if (ent.type === 'column' && p.base) {
        consider(G.v(p.base[0], p.base[1], p.base[2]), `Column ${ent.id} center`);
        continue;
      }
      let A = null, B = null, label = null;
      if (ent.type === 'wall' && !p.closed && p.base && p.end) {
        A = p.base; B = p.end; label = `Wall ${ent.id} centerline`;
      } else if (ent.type === 'beam' && Array.isArray(p.baseline) && p.baseline.length >= 2) {
        A = p.baseline[0]; B = p.baseline[p.baseline.length - 1]; label = `Beam ${ent.id} centerline`;
      } else continue;
      const a = G.v(A[0], A[1], A[2]), b = G.v(B[0], B[1], B[2]);
      const axis = { a, b, half: (p.thickness || p.width || 0.3) / 2 + 0.02 };
      const vec = G.sub(b, a);
      const L = G.len(vec);
      // the run's unit direction — carries to the tool so a column landing
      // on the axis can ALIGN with the host element (parallel placement)
      const dir = { x: vec.x / (L || 1), y: vec.y / (L || 1) };
      if (L < 1e-6) { consider(a, label, axis, dir); continue; }
      vec.x /= L; vec.y /= L; vec.z /= L;
      // closest point between the cursor ray and the axis segment (same
      // ray/line math as the on-edge tracker)
      const r = G.sub(ro, a);
      const bDot = G.dot(rd, vec);
      const den = 1 - bDot * bDot;
      if (Math.abs(den) < 1e-9) continue; // cursor ray parallel to the axis
      const s = (G.dot(vec, r) - bDot * G.dot(rd, r)) / den;
      const t = Math.max(0, Math.min(L, s)); // clamped: never past the ends
      consider(G.add(a, G.mul(vec, t)), label, axis, dir);
    }
    return best;
  }
  // does `pt` sit on an element's band EDGE (the B-Rep side faces of the
  // wall/beam the axis belongs to)? Those tier-1 midpoint snaps are the
  // element's own artifacts — the parametric axis outranks them.
  _axisBandContains(cs, pt) {
    if (!cs || !cs.axis) return false;
    const { a, b, half } = cs.axis;
    const ax = a.x, ay = a.y, dx = b.x - ax, dy = b.y - ay;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) return Math.hypot(pt.x - a.x, pt.y - a.y) <= half;
    const t = Math.max(0, Math.min(1, ((pt.x - ax) * dx + (pt.y - ay) * dy) / L2));
    const d = Math.hypot(pt.x - (ax + dx * t), pt.y - (ay + dy * t));
    return d > 1e-3 && d <= half; // off the axis but inside the band
  }
  // OWNERSHIP RE-STAMP (rebuild settlement): rebuilding walls one-by-one
  // means each later wall's miter weld repartitions earlier walls' faces
  // (new face ids) — the per-wall adopt ran before that churn, so earlier
  // lists go stale and the empty-faces reap would detach LIVE walls (the
  // 'rebuild from parameters loses walls' bug). After the whole rebuild,
  // re-attribute every wall-stamped or unstamped face by GEOMETRY: the
  // centroid must sit in the wall's plan band and z-range. Corner wedges
  // fall in two bands — first match wins (either owner is correct).
  _restampWallFaces() {
    const m = this.model;
    const walls = this.entities.filter(e => e.type === 'wall' && e.params
      && e.params.base && e.params.end && !e.params.closed);
    if (!walls.length) return 0;
    const inBand = (c, b) => {
      const rx = c.x - b.ax, ry = c.y - b.ay;
      const s = rx * b.ux + ry * b.uy;
      const d = Math.abs(-rx * b.uy + ry * b.ux);
      return s >= -0.05 && s <= b.L + 0.05 && d <= b.half
        && c.z >= b.z0 - 0.05 && c.z <= b.z1 + 0.05;
    };
    const bands = walls.map(w => {
      const b = w.params.base, e2 = w.params.end;
      const dx = e2[0] - b[0], dy = e2[1] - b[1];
      const L = Math.hypot(dx, dy) || 1;
      return { w, ax: b[0], ay: b[1], ux: dx / L, uy: dy / L, L,
        half: (w.params.thickness || 0.2) / 2 + 0.05, z0: b[2], z1: b[2] + (w.params.height || 3) };
    });
    let moved = 0;
    for (const [, f] of m.faces) {
      const uid = f.userData && f.userData.bimEntityId;
      const owner = uid ? this.getEntityById(uid) : null;
      if (owner && owner.type !== 'wall') continue;          // non-wall stamps stay
      if (owner && owner.faces.includes(f.id)) {
        const b = bands.find(x => x.w.id === owner.id);
        const c = m.faceCentroid(f);
        if (c && b && inBand(c, b)) continue;                // correct already
      }
      const c = m.faceCentroid(f);
      if (!c) continue;
      const band = bands.find(bd => inBand(c, bd));
      if (band) {
        f.userData = { bimEntityId: band.w.id, bimType: 'wall',
          role: (f.userData && f.userData.role) || 'exterior' };
        moved++;
      }
    }
    for (const w of walls) w.faces = [];
    this.syncEntityLists();
    return moved;
  }
  preSplitWallsForColumn(colParams) {
    if (!window.app || !window.app.structural) return 0;
    let n = 0;
    const c = colParams.base;
    const R = Math.max(colParams.width || 0.3, colParams.depth || 0.3) + 0.6;
    for (const w of [...this.entities]) {
      if (w.type !== 'wall' || !w.params || !w.params.base || !w.params.end) continue;
      const ax = w.params.base[0], ay = w.params.base[1], bx = w.params.end[0], by = w.params.end[1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((c[0] - ax) * dx + (c[1] - ay) * dy) / L2));
      if (Math.hypot(c[0] - (ax + dx * t), c[1] - (ay + dy * t)) > R) continue;
      // pending intruders are entity-shaped: { type, params }
      if (this.planTrimWall(w.id, { pending: [{ type: 'column', params: colParams }] })) n++;
    }
    return n;
  }
  // tear an entity's edge list down through the kernel (index stays
  // consistent), then the wipe sites reap every zero-face edge the face
  // deletes left behind. Raw m.edges.delete() leaves stale index entries,
  // and orphaned edges are POISON to the split cascade: splitFacesAt
  // divides rings through edges adjacent to its vertices, so corpses breed
  // phantom splits until the model explodes (the 'adding a column freezes
  // the app' freeze). model.load heals this via reapOrphanEdges — the live
  // model must reap at the wipe sites too.
  _wipeEdges(ids) {
    for (const eid of ids) if (this.model.edges.has(eid)) this.model._delEdge(eid);
  }
  // THE WALL-FACE RULE (dynamic): a wall ends at the FACE of any column or
  // beam in its path. Rebuild the wall's span around every crossing
  // intruder — same params (baseline, thickness, height, location line),
  // shortened span. This is what runs when a column or beam is placed,
  // moved, or deleted near ANY wall: parametric or freeform.
  planTrimWall(id) {
    const ent = this.getEntityById(id);
    if (!ent || ent.type !== 'wall' || ent.params.closed) return false;
    const p = ent.params;
    if (!p.base || !p.end) return false;
    const app = window.app || {};
    const eipEnt = app._eip && app._eip.ent;
    if (eipEnt === ent) return true; // Edit In Place owns the geometry
    const m = this.model;
    const ax = p.base[0], ay = p.base[1];
    const L = Math.hypot(p.end[0] - ax, p.end[1] - ay) || 1;
    const ux = (p.end[0] - ax) / L, uy = (p.end[1] - ay) / L;
    const trims = app.structural ? app.structural.wallPlanTrims(p, (arguments[1] && arguments[1].pending) || null) : null;
    // free spans = the complement of the blocked intervals on [0, L]
    const spans = [];
    let cur = 0;
    for (const iv of (trims ? trims.intervals : [])) {
      if (iv.t0 - cur > 0.05) spans.push([cur, iv.t0]);
      cur = Math.max(cur, iv.t1);
    }
    if (L - cur > 0.05) spans.push([cur, L]);

    if (!trims) {
      if (p.merge) return this._deriveGroupSpans(ent);
      // plain un-split wall: nothing blocks it — its geometry should be the
      // full param span (the heal); already-whole is a cheap no-op
      if (ent.faces.length && ent.faces.every(fid => m.faces.has(fid))) return true;
      return this._extrudeWallSpan(ent, p.base, p.end, true, true);
    }
    if (!spans.length) {
      // fully consumed: the intruders own this ground — the wall (and its
      // hosted openings) retire
      const heldR = m.bimHold;
      m.beginEdgeSweep();
      try {
        m.bimHold = true;
        for (const h of this.entities.filter(e => e.params && e.params.hostWallId === ent.id)) {
          for (const fid of [...h.faces]) m.faces.delete(fid);
          this.detach(h.id);
          if (this.db) this.db.deleteElement(h.id).catch(() => { });
        }
        for (const fid of [...ent.faces]) m.faces.delete(fid);
        this._wipeEdges(ent.edges);
        m.gc();
        m.reapOrphanEdges(); // corpses poison the next split cascade
        ent.faces = []; ent.edges = [];
        m.bimHold = heldR;
      } finally { m.endEdgeSweep(); m.bimHold = heldR; }
      return true;
    }
    // blocked: (re)allocate the span among independent wall pieces
    return this._splitWallToSpans(ent, spans, { ax, ay, ux, uy, L });
  }
  // SPLIT: the wall's free spans become independent wall ELEMENTS — each
  // selectable, editable, deletable and movable alone — sharing a merge
  // group that remembers the original run (base/end/joins) and the slot
  // each piece occupies on it. Piece 0 keeps the original entity's id;
  // the rest are registered fresh. Hosted openings follow the piece that
  // owns their position (distance re-anchored), or die with consumed ground.
  _splitWallToSpans(ent, spans, g) {
    const m = this.model;
    const p = ent.params;
    const z = p.base[2];
    const at = t => [g.ax + g.ux * t, g.ay + g.uy * t, z];
    const prev = p.merge || null;
    const orig = prev
      ? { group: prev.group, base: prev.base, end: prev.end, joins: prev.joins || {} }
      : { group: ent.id, base: [p.base[0], p.base[1], z], end: [p.end[0], p.end[1], z],
          joins: { start: (p.joins || {}).start, end: (p.joins || {}).end } };
    const jo = orig.joins || {};
    const ob = orig.base, oe = orig.end;
    const L0 = Math.hypot(oe[0] - ob[0], oe[1] - ob[1]) || 1;
    const ox = (oe[0] - ob[0]) / L0, oy = (oe[1] - ob[1]) / L0;
    const tOf = q => (q[0] - ob[0]) * ox + (q[1] - ob[1]) * oy;
    // slots in ORIGINAL-run coordinates — the map the heal derives from.
    // Re-split of an existing piece: sibling slots still guard their own
    // ground — replace only THIS piece's slot with the new spans, or the
    // next derive kicks every sibling out of the merge group
    const conv = spans.map(([t0, t1]) => { const A = at(t0), B = at(t1); return [tOf(A), tOf(B)]; });
    let slots = conv;
    if (prev && Array.isArray(prev.slots)) {
      const myA = tOf([g.ax, g.ay]), myB = tOf(at(g.L));
      slots = prev.slots
        .filter(s => !(s[0] < myB - 1e-6 && s[1] > myA + 1e-6))
        .concat(conv)
        .sort((a, b) => a[0] - b[0]);
    }
    m.beginEdgeSweep();
    let ok = true;
    const held = m.bimHold; // hold-transparent: a caller's hold survives us
    try {
      m.bimHold = true;
      const hosted = this.entities.filter(e => e.params && e.params.hostWallId === ent.id);
      for (const h of hosted) for (const fid of [...h.faces]) m.faces.delete(fid);
      for (const fid of [...ent.faces]) m.faces.delete(fid);
      this._wipeEdges(ent.edges);
      m.gc();
      m.reapOrphanEdges(); // corpses poison the next split cascade
      for (const f2 of m.faces.values()) {
        m.edgesForRing(f2.loop, true);
        for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
      }
      ent.faces = []; ent.edges = [];
      m.bimHold = held;
      const pieces = [];
      for (let s = 0; s < spans.length; s++) {
        const [t0, t1] = spans[s];
        const A = at(t0), B = at(t1);
        const atStart = s === 0 && t0 <= 1e-6;
        const atEnd = s === spans.length - 1 && t1 >= g.L - 1e-6;
        const joins = { start: atStart ? jo.start : undefined, end: atEnd ? jo.end : undefined };
        let target;
        if (s === 0) {
          p.base = [...A]; p.end = [...B]; p.joins = joins;
          p.merge = { group: orig.group, base: ob, end: oe, joins: jo, slots };
          target = ent;
        } else {
          target = this._createInner('wall', { ...p, base: [...A], end: [...B],
            joins, footprint: undefined, closed: false,
            merge: { group: orig.group, base: ob, end: oe, joins: jo, slots } }, {}, []);
        }
        if (!this._extrudeWallSpan(target, A, B, atStart, atEnd)) ok = false;
        pieces.push(target);
      }
      // neighbors' joins referenced THIS element's endpoints; after the
      // split the END corner may live on a new piece (piece 0 keeps the id
      // and the start corner) — re-point only the refs that share that
      // corner, so the next miter rebuild finds the wall that touches it
      if (pieces.length > 1) {
        const last = pieces[pieces.length - 1];
        if (last.id !== ent.id)
          this._repointJoinRefs(new Set([ent.id]), last.id, oe);
      }
      // hosted openings: re-anchor to the piece whose slot holds them
      const tHost0 = tOf([g.ax, g.ay]);
      for (const h of hosted) {
        const t0 = tHost0 + (h.params.distanceFromStart || 0);
        const t1 = t0 + (h.params.width || 0.9);
        let best = -1, bestOverlap = 0;
        slots.forEach((sl, i) => {
          const ov = Math.min(t1, sl[1]) - Math.max(t0, sl[0]);
          if (ov > bestOverlap) { bestOverlap = ov; best = i; }
        });
        if (best < 0 || bestOverlap <= 0) {
          this.detach(h.id);
          if (this.db) this.db.deleteElement(h.id).catch(() => { });
          continue;
        }
        h.params.hostWallId = pieces[best].id;
        h.params.distanceFromStart = t0 - slots[best][0];
        if (!this._recutHosted(h, pieces[best], h.params.distanceFromStart)) {
          this.detach(h.id);
          if (this.db) this.db.deleteElement(h.id).catch(() => { });
        }
      }
      if (this.assets) for (const piece of pieces) this.assets.recutHosted(piece.id, m);
    } finally { m.endEdgeSweep(); m.bimHold = held; }
    return ok;
  }
  // HEAL / REUNITE: nothing blocks THIS piece — re-derive the whole group's
  // span allocation against the intruders that remain. Pieces expand into
  // freed ground (bounded by sibling slot edges: territory of a piece the
  // user deleted never resurrects), and pieces whose targets meet MERGE
  // back into one wall. Members whose span/section left the plan (user
  // edited or moved them) drop out of the group permanently.
  _deriveGroupSpans(ent) {
    const app = window.app || {};
    const m = this.model;
    const p = ent.params;
    const mg = p.merge;
    const heldD = m.bimHold; // hold-transparent: a caller's hold survives us
    if (!mg || !mg.base || !mg.end) { delete p.merge; return true; }
    // SLOTS SYNC across the lineage: a later split updates the slot map only
    // on the pieces it rebuilt; untouched siblings keep a STALE list and the
    // inSlot check below would expel their own lineage at heal time (the
    // "three pieces never fuse back" bug). The freshest map in the lineage
    // (most slots) wins and is written back to every member.
    {
      let fresh = Array.isArray(mg.slots) ? mg.slots : [];
      for (const e of this.entities) {
        const q = e.params && e.params.merge;
        if (e.type === 'wall' && q && q.group === mg.group && Array.isArray(q.slots) && q.slots.length > fresh.length)
          fresh = q.slots;
      }
      for (const e of this.entities) {
        const q = e.params && e.params.merge;
        if (e.type === 'wall' && q && q.group === mg.group)
          q.slots = fresh.map(s => [s[0], s[1]]);
      }
      mg.slots = fresh.map(s => [s[0], s[1]]);
    }
    const ob = mg.base, oe = mg.end;
    const z = p.base[2];
    const L0 = Math.hypot(oe[0] - ob[0], oe[1] - ob[1]) || 1;
    const ux = (oe[0] - ob[0]) / L0, uy = (oe[1] - ob[1]) / L0;
    const tOf = q => (q[0] - ob[0]) * ux + (q[1] - ob[1]) * uy;
    const offRun = q => Math.abs(-(q[0] - ob[0]) * uy + (q[1] - ob[1]) * ux) >= 1e-4;
    // the app keeps span == slot after every split/derive it performs, so a
    // span that no longer MATCHES its slot is a USER edit — that piece is
    // independent from here on (its slot still guards the ground, so
    // siblings never expand into it)
    const inSlot = (t0, t1) => (mg.slots || []).some(s =>
      Math.abs(t0 - s[0]) < 1e-6 && Math.abs(t1 - s[1]) < 1e-6);
    const members = [];
    for (const e of [...this.entities]) {
      // LINEAGE ISOLATION: merge.group is the ORIGINAL element's id, and
      // only pieces of that one lineage may ever fuse or heal with each
      // other. Different elements may JOIN (parametric joins records) but
      // never merge — and because ids are monotonic (never recycled), a
      // lineage id can never collide with a foreign element's id.
      if (e.type !== 'wall' || !e.params || !e.params.merge || e.params.merge.group !== mg.group) continue;
      const q = e.params;
      if (!q.base || !q.end) continue;
      if (Math.abs(q.base[2] - z) > 1e-6
        || Math.abs((q.thickness || 0.2) - (p.thickness || 0.2)) > 1e-6
        || Math.abs((q.height || 3) - (p.height || 3)) > 1e-6
        || offRun(q.base) || offRun(q.end)
        || !inSlot(tOf(q.base), tOf(q.end))) { delete q.merge; continue; } // edited: independent
      members.push(e);
    }
    if (!members.length) return true;
    // free ground on the ORIGINAL run
    const trims = app.structural ? app.structural.wallPlanTrims({ ...p, base: [...ob], end: [...oe] }) : null;
    const free = [];
    let cur = 0;
    for (const iv of (trims ? trims.intervals : [])) {
      if (iv.t0 - cur > 0.05) free.push([cur, iv.t0]);
      cur = Math.max(cur, iv.t1);
    }
    if (L0 - cur > 0.05) free.push([cur, L0]);
    const slots = (mg.slots || []).map(s => [s[0], s[1]]);
    // per-member target: the free interval containing it, clipped by the
    // nearest FOREIGN slot edge on each side (outermost pieces may still
    // run to the original bounds) and by live siblings' current spans
    const rows = members.map(e => {
      const t0 = tOf(e.params.base), t1 = tOf(e.params.end);
      let lo = 0, hi = L0;
      for (const s of slots) {
        if (t0 >= s[0] - 1e-4 && t1 <= s[1] + 1e-4) continue; // my own slot
        if (s[1] <= t0 + 1e-4) lo = Math.max(lo, s[1]);
        if (s[0] >= t1 - 1e-4) hi = Math.min(hi, s[0]);
      }
      return { e, t0, t1, lo, hi };
    }).sort((a, b) => a.t0 - b.t0);
    for (let i = 0; i < rows.length; i++)
      for (let j = 0; j < rows.length; j++) {
        if (i === j) continue;
        if (rows[j].t0 >= rows[i].t1 - 1e-4) rows[i].hi = Math.min(rows[i].hi, rows[j].t0);
        if (rows[j].t1 <= rows[i].t0 + 1e-4) rows[i].lo = Math.max(rows[i].lo, rows[j].t1);
      }
    for (const r of rows) {
      let a = r.t0, b = r.t1;
      for (const f of free)
        if (f[0] <= r.t0 + 1e-4 && f[1] >= r.t1 - 1e-4) { a = Math.max(f[0], r.lo); b = Math.min(f[1], r.hi); break; }
      if (b - a < (r.t1 - r.t0) - 1e-9) { a = r.t0; b = r.t1; } // never shrink on a heal pass
      r.a = a; r.b = b;
    }
    // touching targets merge into one wall (leftmost keeps the identity)
    const groups = [];
    for (const r of rows) {
      const last = groups[groups.length - 1];
      if (last && r.a <= last.b + 1e-4) { last.b = Math.max(last.b, r.b); last.members.push(r.e); last.rows.push(r); }
      else groups.push({ a: r.a, b: r.b, members: [r.e], rows: [r] });
    }
    // stable? nothing expands, nothing merges — done, no rebuild churn
    if (groups.length === rows.length && groups.every((gr, i) => gr.members[0] === rows[i].e
      && Math.abs(gr.a - rows[i].t0) < 1e-6 && Math.abs(gr.b - rows[i].t1) < 1e-6)) return true;
    m.beginEdgeSweep();
    let ok = true;
    try {
      const A2 = t => [ob[0] + ux * t, ob[1] + uy * t, z];
      const slotIdxOf = r => (mg.slots || []).findIndex(s =>
        Math.abs(r.t0 - s[0]) < 1e-6 && Math.abs(r.t1 - s[1]) < 1e-6);
      const used = new Set();
      for (const gr of groups) for (const r of gr.rows) used.add(slotIdxOf(r));
      const keptDead = (mg.slots || []).filter((s, i) => !used.has(i));
      const newSlots = groups.map(gr => [gr.a, gr.b]).concat(keptDead).sort((a, b) => a[0] - b[0]);
      const jo = mg.joins || {};
      // re-anchor every hosted opening of the whole group
      const hostedAll = this.entities.filter(e => e.params && e.params.hostWallId
        && groups.some(gr => gr.members.some(mm => mm.id === e.params.hostWallId)));
      for (const gr of groups) {
        const survivor = gr.members[0];
        for (const h of hostedAll) {
          const host = gr.members.find(mm => mm.id === h.params.hostWallId);
          if (!host) continue;
          const tHost = tOf(host.params.base);
          const t0 = tHost + (h.params.distanceFromStart || 0), t1 = t0 + (h.params.width || 0.9);
          const c0 = Math.max(t0, gr.a), c1 = Math.min(t1, gr.b);
          if (c1 - c0 <= 0) { this.detach(h.id); if (this.db) this.db.deleteElement(h.id).catch(() => { }); continue; }
          h.params.hostWallId = survivor.id;
          h.params.distanceFromStart = t0 - gr.a;
        }
      }
      // wipe all members; absorbed ones detach; survivors retarget + rebuild
      m.bimHold = true;
      const allMembers = groups.flatMap(gr => gr.members);
      for (const e of allMembers) {
        for (const fid of [...e.faces]) m.faces.delete(fid);
        this._wipeEdges(e.edges);
      }
      m.gc();
      m.reapOrphanEdges(); // corpses poison the next split cascade
      for (const f2 of m.faces.values()) {
        m.edgesForRing(f2.loop, true);
        for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
      }
      for (const e of allMembers) { e.faces = []; e.edges = []; }
      m.bimHold = heldD;
      for (const gr of groups) {
        const survivor = gr.members[0];
        const gone = [];
        for (const e of gr.members) if (e !== survivor) { gone.push(e.id); this.detach(e.id); }
        // absorbed pieces may own corners (the split re-pointed neighbors
        // at them) — their refs must follow the survivor or the healed
        // corner's miter rebuild dangles the same way
        if (gone.length) this._repointJoinRefs(new Set(gone), survivor.id);
        const whole = groups.length === 1 && gr.a <= 1e-6 && gr.b >= L0 - 1e-6;
        survivor.params.base = A2(gr.a); survivor.params.end = A2(gr.b);
        survivor.params.joins = { start: gr.a <= 1e-6 ? jo.start : undefined, end: gr.b >= L0 - 1e-6 ? jo.end : undefined };
        if (whole) delete survivor.params.merge;
        else survivor.params.merge = { group: mg.group, base: ob, end: oe, joins: jo, slots: newSlots };
        if (!this._extrudeWallSpan(survivor, survivor.params.base, survivor.params.end, true, true)) ok = false;
        for (const h of hostedAll.filter(x => x.params.hostWallId === survivor.id)) {
          if (!this._recutHosted(h, survivor, h.params.distanceFromStart)) {
            this.detach(h.id);
            if (this.db) this.db.deleteElement(h.id).catch(() => { });
          }
        }
        if (this.assets) this.assets.recutHosted(survivor.id, m);
      }
    } finally { m.endEdgeSweep(); m.bimHold = heldD; }
    return ok;
  }
  // re-cut one hosted opening on its (possibly new) host wall
  _recutHosted(h, wallEnt, dist) {
    const m = this.model;
    const spec = { distanceFromStart: dist, width: h.params.width, height: h.params.height, sillHeight: h.params.sillHeight };
    const info = window.BimTools.HostedCut.cut(G, m, wallEnt.params, spec);
    if (info.error) return false;
    const hb = new Set(m.faces.keys());
    const faces = h.type === 'opening' ? [] : window.BimTools.HostedCut.frame(G, m, info, spec, h.type, { facing: h.params.facing, hand: h.params.hand });
    h.faces = [...m.faces.keys()].filter(x => !hb.has(x));
    for (const fid of h.faces) {
      const face = m.faces.get(fid);
      const isLeaf = h.type === 'door' && faces.length && fid === faces[faces.length - 1].id;
      face.userData = { bimEntityId: h.id, bimType: h.type, role: faces.some(x => x.id === fid) ? (isLeaf ? 'leaf' : 'frame') : 'lining' };
    }
    return true;
  }

  // extrude ONE (possibly shortened) span of a wall and stamp it for the
  // entity. Miter/butt joins survive only on ends coinciding with the
  // wall's ORIGINAL ends; an end retreating to an intruder face gets a
  // clean square cap. ent.faces/edges ACCUMULATE across spans — the split
  // wall stays ONE element with N bodies (delete the column, it merges).
  _extrudeWallSpan(ent, A, B, atStart, atEnd) {
    const m = this.model;
    const p = ent.params;
    const z = p.base[2];
    const joins = p.joins || {};
    const jp = { ...p, base: [A[0], A[1], z], end: [B[0], B[1], z],
      joins: { start: atStart ? joins.start : undefined, end: atEnd ? joins.end : undefined } };
    delete jp.footprint; delete jp.closed;
    let ring;
    try { ring = this.wallRing(jp); } catch (e) { return false; }
    if (!ring || ring.length < 3 || G.ringDegenerate(ring)) return false;
    const before = new Set(m.faces.keys());
    const heldE = m.bimHold;
    m.bimHold = true;
    try {
      const f = m.addFaceFromRings(ring.map(q => G.clone(q)));
      if (!f) return false;
      // stamp BEFORE the sweep: every face pushPull births from this anchor
      // inherits it, so indepSkip protects the whole span during the hold
      // (unstamped children sliced each other at welded junctions)
      f.userData = { bimEntityId: ent.id, bimType: 'wall', role: 'profile' };
      if (!m.pushPull(f, p.height || 3)) return false;
      const nf = [...m.faces.keys()].filter(x => !before.has(x)).map(x => m.faces.get(x)).filter(f2 => f2);
      const h = p.height || 3;
      const roles = WallTool.classifyRoles(G, m, nf,
        [G.v(A[0], A[1], z), G.v(B[0], B[1], z)], false, z, z + h);
      const ne = [];
      for (const f2 of nf) {
        // a foreign element's split-born face keeps ITS stamp (independence);
        // our own children (already carrying ours via the anchor) get roles
        if (!f2.userData || f2.userData.bimEntityId === ent.id)
          f2.userData = { bimEntityId: ent.id, bimType: 'wall', role: roles[f2.id] || 'exterior' };
        for (const r of m.rings(f2)) for (let i = 0; i < r.length; i++) {
          const e = m.findEdge(r[i], r[(i + 1) % r.length]);
          if (e) {
            if (!e.userData) e.userData = { bimEntityId: ent.id, bimType: 'wall', role: 'profile' };
            ne.push(e.id);
          }
        }
      }
      ent.faces = ent.faces.concat(nf.map(f2 => f2.id));
      ent.edges = [...new Set(ent.edges.concat(ne))];
    } finally { m.bimHold = heldE; }
    return true;
  }

  // ------------------------------------------------------ floor openings
  // Regenerate a floor/slab FROM ITS PARAMS (regions with holes — params
  // are truth). Used when an opening is cut or removed.
  // ---- Edit Boundary (the Revit core loop) --------------------------------
  // The saved sketch of a floor/slab/roof, re-projected onto the CURRENT
  // level plane (a moved level re-seats the boundary). Column punch holes are
  // automatic cuts, not sketch lines — excluded here and re-cut fresh on
  // commit (a deleted column's punch simply disappears: Revit-correct).
  boundarySketchPaths(ent) {
    const app = window.app;
    const m = this.model;
    const z = app.levelManager.getElevation(ent.params.baseLevel);
    const proj = q => G.v(q[0], q[1], z);
    const punches = [];
    if ((ent.type === 'floor' || ent.type === 'slab') && app.structural
      && app.structural.columnHolesForSlab) {
      for (const r of ent.params.regions) {
        if (!r.outer || r.outer.length < 3) continue;
        const holes = app.structural.columnHolesForSlab(m,
          { baseLevel: ent.params.baseLevel, thickness: ent.params.thickness, _planeZ: z },
          { outer: r.outer.slice(), holes: (r.holes || []).map(h => h.slice()) });
        for (const h of holes) punches.push(h.ring);
      }
    }
    const rectOf = ring => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const q of ring) {
        if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
        if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
      }
      return { minX, maxX, minY, maxY };
    };
    const isPunch = ring => punches.some(pr => {
      const a = rectOf(ring), b = rectOf(pr);
      return Math.abs(a.minX - b.minX) < 2e-3 && Math.abs(a.maxX - b.maxX) < 2e-3
        && Math.abs(a.minY - b.minY) < 2e-3 && Math.abs(a.maxY - b.maxY) < 2e-3;
    });
    const paths = [];
    for (const r of ent.params.regions) {
      if (r.outer && r.outer.length >= 3) paths.push({ pts: r.outer.map(proj), closed: true });
      for (const h of (r.holes || [])) {
        if (h.length < 3) continue;
        if (isPunch(h)) continue; // automatic column cut — regenerated on commit
        paths.push({ pts: h.map(proj), closed: true });
      }
    }
    return paths;
  }
  // Re-open a floor/slab/roof's sketch: seeds the sketch tool with the saved
  // boundary and switches the Base Level to the element's own level, so the
  // re-commit lands on the right plane. (App-level method — drives the UI.)
  editBoundary(id) {
    const app = window.app;
    const ent = this.getEntityById(id);
    if (!ent || !Array.isArray(ent.params.regions) || !ent.params.regions.length
      || !['floor', 'slab', 'roof'].includes(ent.type)) return false;
    app._boundaryEdit = { id: ent.id, type: ent.type };
    if (app.bimOptions && ent.params.baseLevel != null) {
      app.bimOptions.baseLevel = ent.params.baseLevel;
      if (typeof app._refreshLevelDropdowns === 'function') app._refreshLevelDropdowns();
    }
    app.setTool(ent.type === 'roof' ? 'roof' : 'floor');
    return true;
  }

  rebuildFloorEntity(id) {
    const ent = this.getEntityById(id);
    if (!ent || (ent.type !== 'floor' && ent.type !== 'slab') || !ent.params.regions) return false;
    const m = this.model;
    m.bimHold = true;
    for (const fid of [...ent.faces]) m.faces.delete(fid);
    for (const eid of [...ent.edges]) m.edges.delete(eid);
    m.gc();
    m.reapOrphanEdges();
    for (const f2 of m.faces.values()) {
      m.edgesForRing(f2.loop, true);
      for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
    }
    const th = ent.params.thickness || 0.2;
    const before = new Set(m.faces.keys());
    for (const r of ent.params.regions) {
      const f = m.addFaceFromRings(r.outer.map(q => G.v(q[0], q[1], q[2])),
        (r.holes || []).map(h => h.map(q => G.v(q[0], q[1], q[2]))));
      if (f) m.pushPull(f, -th);
    }
    const made = [...m.faces.keys()].filter(fid => !before.has(fid)).map(fid => m.faces.get(fid));
    ent.faces = made.map(f => f.id);
    ent.edges = [];
    for (const f of made) f.userData = { bimEntityId: id, bimType: ent.type, role: 'body' };
    m.bimHold = false;
    return ent.faces.length > 0;
  }
  // Cut a rectangular plan opening in a floor/slab: the ring is recorded in
  // the host's params.regions[].holes (the parametric truth — rebuilds,
  // saves and loads keep it) and the geometry regenerates with the hole.
  placeFloorOpening(hostId, cx, cy, w, h) {
    const host = this.getEntityById(hostId);
    if (!host || !host.params || !Array.isArray(host.params.regions)) return null;
    // which region contains the point? (ray-cast point-in-polygon)
    let idx = -1;
    host.params.regions.forEach((r, i) => {
      if (idx >= 0 || !r.outer || r.outer.length < 3) return;
      let inside = false;
      for (let a = 0, b = r.outer.length - 1; a < r.outer.length; b = a++) {
        const pa = r.outer[a], pb = r.outer[b];
        if ((pa[1] > cy) !== (pb[1] > cy)
          && cx < (pb[0] - pa[0]) * (cy - pa[1]) / (pb[1] - pa[1]) + pa[0]) inside = !inside;
      }
      if (inside) idx = i;
    });
    if (idx < 0) return null; // clicked outside every region
    const r = host.params.regions[idx];
    r.holes = r.holes || [];
    const z = r.outer[0][2] || 0;
    r.holes.push([[cx - w / 2, cy - h / 2, z], [cx + w / 2, cy - h / 2, z],
      [cx + w / 2, cy + h / 2, z], [cx - w / 2, cy + h / 2, z]]);
    if (!this.rebuildFloorEntity(hostId)) return null;
    // the opening owns NO faces — the hole belongs to the slab (same
    // convention as wall openings)
    return this._createInner('opening', { hostFloorId: hostId, center: [cx, cy, z], width: w, height: h }, {}, []);
  }
  // Remove one floor opening's ring from its host and regenerate. Called by
  // detach for any removal path (Delete key, Eraser, session cleanup).
  _removeFloorOpeningRing(openEnt) {
    const host = this.getEntityById(openEnt.params.hostFloorId);
    if (!host || !Array.isArray(host.params.regions) || !openEnt.params.center) return;
    const [cx, cy] = openEnt.params.center;
    for (const r of host.params.regions) {
      r.holes = (r.holes || []).filter(ring => {
        const mx = ring.reduce((s, q) => s + q[0], 0) / ring.length;
        const my = ring.reduce((s, q) => s + q[1], 0) / ring.length;
        return Math.hypot(mx - cx, my - cy) > 1e-3; // keep the holes that are not ours
      });
    }
    this.rebuildFloorEntity(host.id);
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
        ? window.ColumnFeature.placeColumn(G, m, { x: b[0], y: b[1], z }, p.width, p.depth, p.height, +p.rotation || 0,
          { bimEntityId: id, bimType: 'column' })
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
    } catch (e) {
      // one retry after gc: mid-pass junctions can leave transient debris
      // that makes the first sweep fail; a clean second attempt usually lands
      try {
        m.gc();
        for (const f2 of m.faces.values()) {
          m.edgesForRing(f2.loop, true);
          for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
        }
        built = app.structural.buildBeam(G, m, ent.params);
      } catch (e2) { m.bimHold = false; return false; }
    }
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
    let P1 = G.v(...params.base), P2 = G.v(...params.end);
    // v0.6 FACE-STOP: where the run's ends meet columns, the geometry
    // retreats to the first column face + ELEMENT_EPS (a solid butt joint).
    // Params keep the drawn span — this is derivation, not mutation.
    if (window.app && window.app.structural && window.app.structural.wallEndRetreats) {
      const rt = window.app.structural.wallEndRetreats(params);
      if (rt) {
        const ux = (P2.x - P1.x) / rt.L, uy = (P2.y - P1.y) / rt.L;
        const z = P1.z;
        const q0 = G.v(P1.x + ux * rt.t0, P1.y + uy * rt.t0, z);
        const q1 = G.v(P1.x + ux * rt.t1, P1.y + uy * rt.t1, z);
        if (G.dist(q0, q1) > 0.05) { P1 = q0; P2 = q1; }
      }
    }
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
    // FLOOR OPENINGS: deleting the opening removes its hole from the host
    // (the slab heals whole); deleting the FLOOR takes its openings along
    if (ent0 && ent0.type === 'opening' && ent0.params && ent0.params.hostFloorId)
      this._removeFloorOpeningRing(ent0);
    if (ent0 && (ent0.type === 'floor' || ent0.type === 'slab')) {
      for (const h of this.entities.filter(e => e.params && e.params.hostFloorId === id))
        this.detach(h.id);
    }
    const i = this.entities.findIndex(e => e.id === id);
    if (i < 0) return false;
    const ent = this.entities[i];
    if (this.model && this.model.touch) this.model.touch(); // registry changed: view gate must reopen
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
    this.structural = window.StructuralManager ? window.StructuralManager.attach(this) : null;
    this.families = new FamilyManager();             // loadable hosted families
    this.bimOptions = {                                // Precise Drawing options bar
      baseLevel: 'lvl_1',
      topConstraint: 'unconnected', // level id | 'unconnected'
      unconnectedHeight: 3.0,
      thickness: 0.20,
      locationLine: 'centerline',   // 'centerline' | 'exterior' | 'interior'
      chain: true,
      rotationDeg: null,            // explicit element angle (°) — null = automatic
      parallel: true,               // snapped placements align with the host element
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
    try { this.perfHudOn = !!localStorage.getItem('websketch3d.perfhud'); } catch (e) { this.perfHudOn = false; }
    if (this.perfHudOn && this.view) this.view.perfHud = true;
    this.faceStyle = 'shaded';

    const vp = document.getElementById('viewport');
    this.view = new Viewport(vp, this);
    this.bandEl = document.getElementById('selband');
    this.hintEl = document.getElementById('hint');
    this.vcbEl = document.getElementById('vcb');

    this.mode = 'free';         // 'free' (SketchUp-style) | 'bim' (Revit-style) | 'design' (structural design)
    this._initTools();
    this._initModes();
    this._initRibbonTabs();
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
    // Revit-method first: boot into Precise Drawing unless the user last
    // chose another mode (setMode persists every explicit switch). Runs at
    // the very end — setMode swaps the ribbon/options bar/levels UI and
    // needs every subsystem initialized.
    try {
      const savedMode = localStorage.getItem('websketch3d.mode');
      const bootMode = TOOL_DEFS[savedMode] ? savedMode : 'bim';
      if (bootMode !== this.mode) this.setMode(bootMode);
    } catch (e) {
      if (this.mode !== 'bim') this.setMode('bim');
    }
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
    // element rotation: a typed angle wins everywhere; empty = automatic
    // (Parallel checked: snapped placements follow the host element's axis)
    el('opt-rotation').addEventListener('input', () => {
      const raw = el('opt-rotation').value.trim();
      const v = raw === '' ? null : parseFloat(raw);
      this.bimOptions.rotationDeg = (v != null && isFinite(v)) ? v : null;
    });
    el('opt-parallel').addEventListener('change', () => {
      this.bimOptions.parallel = el('opt-parallel').checked;
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
      base.addEventListener('change', () => {
        this.bimOptions.baseLevel = base.value;
        // the 1 m reference grid lives at the ACTIVE base level
        if (this.view && this.view.setGridLevel)
          this.view.setGridLevel(this.levelManager.getElevation(base.value));
      });
      top.addEventListener('change', () => {
        this.bimOptions.topConstraint = top.value;
        el('opt-height').disabled = top.value !== 'unconnected';
      });
    }
    el('opt-height').disabled = this.bimOptions.topConstraint !== 'unconnected';
    // level edits (rename/elevation/undo/model load) re-seat the grid too
    if (this.view && this.view.setGridLevel)
      this.view.setGridLevel(this.levelManager.getElevation(this.bimOptions.baseLevel));
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
  // v0.6: STAGED — a large building rebuilds in ~40 ms slices between
  // paints (progress in the status bar, the UI never freezes: the owner's
  // report was minutes of lockup). Small models stay synchronous so
  // interactive param edits return instantly. New edits are refused while
  // a staged rebuild runs.
  rebuildFromParams() {
    if (this._rebuilding) { this.toast('A rebuild is already running — one moment', true); return null; }
    const defs = this.bim.entities.map(e => ({ id: e.id, type: e.type, params: (window.structuredClone || (o => JSON.parse(JSON.stringify(o))))(e.params || {}) }));
    const skipped = [];
    let counts = {};
    // rebuildable types — everything else (stairs, scripts, hosted openings,
    // assets) KEEPS its geometry: never wipe what you cannot restore
    const CAN = { foundation: 1, column: 1, wall: 1, slab: 1, floor: 1, beam: 1, roof: 1 };
    // rebuildable = parametric entities only; FIXED converted elements keep
    // their drawn geometry (it IS the design — nothing to rebuild from)
    const canRebuild = e => !!CAN[e.type] && !(e.params && e.params.fixed);
    const wipe = mm => {
      // wipe ONLY what the rebuildable entities own — everything else
      // (other entities' geometry AND unclaimed Free Drawing faces/edges)
      // stays: a stray drawn line must survive a parametric rebuild
      const wipeFaces = new Set(), wipeEdges = new Set();
      for (const e of this.bim.entities) {
        if (!canRebuild(e)) continue;
        for (const fid of e.faces) wipeFaces.add(fid);
        for (const eid of e.edges) wipeEdges.add(eid);
      }
      for (const [fid, f] of [...mm.faces]) if (wipeFaces.has(fid)) mm.faces.delete(fid);
      for (const [eid, e2] of [...mm.edges]) if (wipeEdges.has(eid)) mm.edges.delete(eid);
      mm.gc();
      // recreate ring edges survivors may share with the wiped set
      for (const f of mm.faces.values()) {
        mm.edgesForRing(f.loop, true);
        for (const h of (f.holes || [])) mm.edgesForRing(h, true);
      }
      for (const e of this.bim.entities) if (canRebuild(e)) { e.faces = []; e.edges = []; }
    };
    const adopt = (mm, ent, rolesOf) => {
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
    const rebuildOne = mm => d => {
      const ent = this.bim.getEntityById(d.id);
      if (!ent) return;
      // FIXED converted elements have no parametric form to rebuild from —
      // their drawn geometry survived wipe and stays as-is
      if (ent.params && ent.params.fixed) return;
      try {
        if (d.type === 'foundation') {
          this.structural.buildFooting(G, mm, d.params);
          adopt(mm, ent, (f) => { const c = mm.faceCentroid(f);
            return Math.abs(c.z + (d.params.thickness || 0.5)) < 1e-6 ? 'bottom' : Math.abs(c.z) < 1e-6 ? 'top' : 'side'; });
        } else if (d.type === 'column') {
          const b = d.params.base;
          ColumnFeature.placeColumn(G, mm, { x: b[0], y: b[1], z: b[2] }, d.params.width, d.params.depth, d.params.height, +d.params.rotation || 0,
            { bimEntityId: ent.id, bimType: 'column' });
          adopt(mm, ent, (f) => { const c = mm.faceCentroid(f);
            return Math.abs(c.z - b[2]) < 1e-6 ? 'bottom' : Math.abs(c.z - (b[2] + d.params.height)) < 1e-6 ? 'top' : 'side'; });
        } else if (d.type === 'wall' && d.params.base && d.params.end) {
          const bp = d.params.base, ep = d.params.end;
          const wl = Math.hypot(ep[0] - bp[0], ep[1] - bp[1]) || 1;
          const spans = [];
          let cur = 0;
          const tr = this.structural ? this.structural.wallPlanTrims(d.params) : null;
          for (const iv of (tr ? tr.intervals : [])) {
            if (iv.t0 - cur > 0.05) spans.push([cur, iv.t0]);
            cur = Math.max(cur, iv.t1);
          }
          if (wl - cur > 0.05) spans.push([cur, wl]);
          if (spans.length) {
            this.bim._splitWallToSpans(ent, spans, {
              ax: bp[0], ay: bp[1],
              ux: (ep[0] - bp[0]) / wl, uy: (ep[1] - bp[1]) / wl, L: wl,
            });
            ent.faces = ent.faces.concat([]);
            adopt(mm, ent, () => 'exterior'); // sweep up any strays (holes from hosted cuts etc.)
          }
        } else if ((d.type === 'slab' || d.type === 'floor') && d.params.regions) {
          for (const r of d.params.regions) {
            const f = mm.addFaceFromRings(r.outer.map(q => G.v(...q)), (r.holes || []).map(h => h.map(q => G.v(...q))));
            if (f) mm.pushPull(f, -(d.params.thickness || 0.2));
          }
          adopt(mm, ent, (f) => { const c = mm.faceCentroid(f); return 'edge'; });
        } else if (d.type === 'roof' && window.RoofFeature && d.params.regions) {
          for (const r of d.params.regions) {
            const zr = (r.outer[0] && r.outer[0][2] != null) ? r.outer[0][2]
              : this.levelManager.getElevation(d.params.baseLevel);
            RoofFeature.buildRegion(G, mm, {
              kind: d.params.kind || 'flat', thickness: d.params.thickness || 0.2,
              pitch: d.params.pitch || 15, overhang: d.params.overhang || 0,
              region: r, z: zr });
          }
          adopt(mm, ent, () => 'body');
        } else if (d.type === 'beam') {
          this.structural.buildBeam(G, mm, d.params);
          adopt(mm, ent, () => 'body');
        } else { skipped.push(d.type); return; }
        counts[d.type] = (counts[d.type] || 0) + 1;
      } catch (e) { /* one bad element never kills the repair */ }
    };
    // post-loop: junction re-derivation + ownership settlement + report
    const finish = () => {
      // v0.6: wall/beam plan trims are retired (elements never divide each
      // other) — the calls are kept conditional and cheap no-ops
      for (const ent of this.bim.entities) {
        if (ent.type !== 'wall' || !ent.params || !ent.params.base || !ent.params.end || ent.params.closed) continue;
        if (this.structural && this.structural.wallPlanTrims(ent.params)) this.bim.planTrimWall(ent.id);
      }
      for (const ent of this.bim.entities) {
        if (ent.type !== 'beam' || !ent.params || !ent.params.baseline) continue;
        if (this.structural && this.structural.beamPlanTrims(ent.params)) this.bim.planTrimBeam(ent.id);
      }
      this.bim._restampWallFaces();
      this.view.rebuild(); this.updateInfo();
      const v = this.model.validate();
      this.toast(`Rebuilt from parameters: ${Object.entries(counts).map(([k, n]) => n + ' ' + k + 's').join(', ')}` +
        (skipped.length ? ` (skipped ${skipped.length} unsupported)` : '') +
        (v.ok ? ' — model valid' : ' — validate still flags issues'), !v.ok);
      return { counts, skipped, valid: v.ok };
    };

    if (defs.length < 40) {
      // synchronous: interactive edits on ordinary models
      this.run('rebuild from parameters', mm => {
        mm.bimHold = true;
        try {
          wipe(mm);
          for (const d of defs) rebuildOne(mm)(d);
          // OWNERSHIP SETTLEMENT: later walls' miter welds repartitioned
          // earlier walls' faces — re-stamp or the empty-faces reap would
          // detach every welded neighbor ('rebuild from parameters loses walls')
          this.bim._restampWallFaces();
        } finally { mm.bimHold = false; }
      });
      return finish();
    }

    // STAGED: identical work in time-sliced chunks with a progress status
    this._rebuilding = true;
    const tx = this.transaction.begin('rebuild from parameters');
    const mm = this.model;
    mm.bimHold = true;
    let i = 0;
    let wiped = false;
    const step = () => {
      const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      try {
        if (!wiped) { wipe(mm); wiped = true; }
        const t0 = now();
        while (i < defs.length) {
          rebuildOne(mm)(defs[i++]);
          if (now() - t0 > 40) break;
        }
      } catch (e) { /* slice failure: keep going, the settlement re-stamps */ }
      if (i < defs.length) {
        this.setStatus(`Rebuilding from parameters — ${i}/${defs.length} elements…`);
        setTimeout(step, 0);
        return;
      }
      try { this.bim._restampWallFaces(); } catch (e) { }
      mm.bimHold = false;
      try { tx.commit(); } catch (e) { /* rollback already handled by the guard */ }
      this._rebuilding = false;
      finish();
    };
    this.toast(`Rebuilding ${defs.length} elements — progress in the status bar, edits pause until it finishes`);
    setTimeout(step, 0);
    return { staged: true };
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
    // walls re-derive the FACE rule the same way (after beams — a wall ends
    // at a beam's face too): legacy models drawn through columns self-heal
    // their split on open, and undo/redo re-lands every trim
    for (const ent of [...this.bim.entities]) {
      if (ent.type !== 'wall' || !ent.params || !ent.params.base || !ent.params.end || ent.params.closed) continue;
      if (this.structural && this.structural.wallPlanTrims(ent.params) && this.bim.planTrimWall(ent.id)) n++;
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
          name: (ent.params && ent.params.name) || `${meta.categoryName} ${String(ent.id).replace(/^[a-z]+_/, '')}`,
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
          name: (ent.params && ent.params.name) || `${meta.categoryName} ${String(ent.id).replace(/^[a-z]+_/, '')}`,
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
  // FLAG SETS (the ThatOpen ModelIdMap pattern): hidden/locked as id Sets,
  // rebuilt only when flags/layers/entities change. isEntityHidden/Locked
  // run per face and per edge inside rebuild loops — the old per-call
  // entity-find + layer-find made every rebuild walk the registry ~10k
  // times. Set membership is O(1); stale ids of detached entities are
  // simply absent (the old code's `!e -> false` behavior).
  _flagSets() {
    const ls = this.model.layers || [];
    const sig = this.bim.entities.length + '/' + ls.map(l =>
      (l.visible === false ? 'h' : '') + (l.locked ? 'l' : '')).join('');
    if (this._flagCache && this._flagCacheSig === sig) return this._flagCache;
    const hidden = new Set(), locked = new Set();
    const hiddenL = new Set(ls.filter(l => l.visible === false).map(l => l.id));
    const lockedL = new Set(ls.filter(l => l.locked).map(l => l.id));
    for (const e of this.bim.entities) {
      if (e.hidden || hiddenL.has(e.layerId)) hidden.add(e.id);
      if (e.locked || lockedL.has(e.layerId)) locked.add(e.id);
    }
    this._flagCache = { hidden, locked };
    this._flagCacheSig = sig;
    return this._flagCache;
  }
  isEntityLocked(id) {
    return this._flagSets().locked.has(id);
  }
  isFaceLocked(f) {
    const uid = f && f.userData && f.userData.bimEntityId;
    if (uid) return this._flagSets().locked.has(uid);
    // raw (entity-less) geometry: its own layer decides
    const ly = f && this.getLayer(f.layerId || '0');
    return !!(ly && ly.locked);
  }
  isEdgeLocked(e) {
    const uid = e && e.userData && e.userData.bimEntityId;
    if (uid) return this._flagSets().locked.has(uid);
    const ly = e && this.getLayer(e.layerId || '0');
    return !!(ly && ly.locked);
  }
  isEntityHidden(id) {
    return this._flagSets().hidden.has(id);
  }
  /** Raw (entity-less) geometry on an OFF layer — rebuild paths and pick
   *  filters skip these exactly like hidden elements. */
  isRawLayerHidden(obj) {
    if (!obj || obj.userData && obj.userData.bimEntityId) return false;
    const ly = this.getLayer(obj.layerId || '0');
    return !!ly && ly.visible === false;
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
    this.model.touch(); // display-state change: the rebuild no-op gate must see it
    // bulk master over a set of ELEMENTS (category header in the browser):
    // id is a comma-joined entity id list — one rebuild, one notification
    if (kind === 'elements') {
      const ids = String(id).split(',').filter(Boolean);
      const live = ids.map(x => this.bim.getEntityById(x)).filter(Boolean);
      if (!live.length) return;
      this._flagCache = null; // entity flags mutated — rebuild the id Sets
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
    this.model.touch(); // visibility/ownership is display state the gate must see
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
    this.model.touch(); // isolation flipped hidden flags — bypass the rebuild gate
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
    } else if (ent.type === 'column' && (p.width > 0 || p.depth > 0)) {
      this.run('change type', () => {
        if (p.width > 0) ent.params.width = p.width;
        if (p.depth > 0) ent.params.depth = p.depth;
        if (p.family) ent.params.family = p.family;
        if (p.defaultHeight > 0 && (ent.params.topConstraint || 'unconnected') === 'unconnected')
          ent.params.height = p.defaultHeight;
        if (!this.bim.rebuildColumnEntity(ent.id)) throw new Error('column rebuild failed');
        this.bim._markHostsDirty(ent); // walls re-split to the new footprint
      });
      this.toast(`Column type: ${typeRec.name}`);
    } else if (p.thickness > 0 || p.height > 0 || p.webWidth > 0 || p.width > 0 || p.pitch != null) {
      // every other element kind (beams, floors, slabs, foundations, roofs):
      // copy the type's dimensional parameters and regenerate — params are
      // truth, so the whole model re-derives with the new section
      this.run('change type', () => {
        const keys = ['kind', 'profile', 'family', 'thickness', 'width', 'depth', 'height',
          'diameter', 'pitch', 'overhang', 'webWidth', 'flangeWidth', 'flangeThickness'];
        for (const k of keys) if (p[k] != null && p[k] !== '') ent.params[k] = p[k];
        this.rebuildFromParams();
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
    // Revit-method default: the chosen mode is remembered across sessions
    try { localStorage.setItem('websketch3d.mode', mode); } catch (e) { }
    document.querySelectorAll('#modetabs .mtab').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mode));
    document.body.classList.toggle('mode-bim', mode === 'bim');
    document.body.classList.toggle('mode-design', mode === 'design');
    document.getElementById('bimoptions').classList.toggle('hidden', mode !== 'bim');
    document.getElementById('designpanel').classList.toggle('hidden', mode !== 'design');
    this.view.showLevels(mode === 'bim');
    this.view.showGrids(mode === 'bim' && this.gridManager.grids.length > 0);
    this._buildToolbar();
    this.setTool(TOOL_DEFS[mode][0].id);
    const modeName = mode === 'bim' ? 'Precise Drawing (BIM)'
      : mode === 'design' ? 'Design' : 'Free Drawing';
    this.setStatus(`Mode: ${modeName} — camera, selection, and model are preserved.`);
    // a tool picked from another ribbon tab asked for this mode first
    if (this._pendingTool) {
      const t = this._pendingTool;
      this._pendingTool = null;
      this.setTool(t);
    }
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
  // arrow-key axis lock feedback: reuses the V-lock chip so the state is
  // visible in the viewport for as long as the lock is held
  _axisChip() {
    let chip = document.getElementById('axislockchip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'axislockchip';
      document.getElementById('viewport').appendChild(chip);
    }
    if (this.axisLockMode) { this._axisLockUI(); return; } // V-mode owns the chip
    if (!this.lockAxis) {
      if (!this.axisLockMode) { chip.style.display = 'none'; chip.textContent = ''; }
      return;
    }
    chip.style.display = 'block';
    chip.className = 'on ' + this.lockAxis;
    const names = { x: 'X (red)', y: 'Y (green)', z: 'Z (blue)' };
    chip.textContent = `Locked to ${names[this.lockAxis]} — ArrowDown clears`;
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
    box.innerHTML = '<span class="dlab" id="dyn-lab1">Length</span><input id="dyn-len" autocomplete="off" spellcheck="false">'
      + '<span class="dlab" id="dyn-lab2">Angle</span><input id="dyn-ang" autocomplete="off" spellcheck="false">'
      + '<button id="dyn-ax" class="dax" title="Axis lock — click to cycle X ➔ Y ➔ Z ➔ off. Z draws vertically (same as the arrow keys)">Z: off</button>'
      + '<span class="dtab">Tab</span>';
    vp.appendChild(box);
    box.style.display = 'none';
    this.dynEl = box;
    this.dynLen = box.querySelector('#dyn-len');
    this.dynAng = box.querySelector('#dyn-ang');
    this.dynLab1 = box.querySelector('#dyn-lab1');
    this.dynLab2 = box.querySelector('#dyn-lab2');
    // AXIS BUTTON in the input bar: a visible, clickable axis lock — solves
    // the "first segment can't go vertical" case without touching the
    // keyboard (focus in these inputs eats arrow keys). Cycles X ➔ Y ➔ Z ➔ off.
    const axBtn = box.querySelector('#dyn-ax');
    axBtn.addEventListener('pointerdown', e => e.stopPropagation());
    axBtn.addEventListener('click', e => {
      e.stopPropagation();
      const order = [null, 'x', 'y', 'z'];
      const cur = order.indexOf(this.lockAxis && !this.axisLockMode ? this.lockAxis : null);
      this.lockAxis = order[(cur + 1) % order.length];
      this._axisChip();
      axBtn.textContent = this.lockAxis ? this.lockAxis.toUpperCase() + ': on' : 'Z: off';
      axBtn.classList.toggle('on', !!this.lockAxis);
      // the preview/typed values follow the new axis immediately
      if (this.tool && this.tool._dynRedraw) { this.dynApply(); this.tool._dynRedraw(); }
      else if (this.tool && typeof this.tool.onMove === 'function' && this._dynPos) {
        this.tool.onMove({ clientX: this._dynPos.x, clientY: this._dynPos.y });
      }
    });
    this.dynAxBtn = axBtn;
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
    // field labels follow the tool's stage (e.g. Arc: Radius / Sweep °)
    if (this.dynLab1) {
      const labels = this.tool && typeof this.tool.dynLabels === 'function' ? this.tool.dynLabels() : null;
      this.dynLab1.textContent = labels ? labels[0] : 'Length';
      this.dynLab2.textContent = labels ? (labels[1] || 'Angle') : 'Angle';
    }
    // keep the axis button's label in step with the live lock state (arrow
    // keys may have changed it since the bar last showed)
    if (this.dynAxBtn) {
      this.dynAxBtn.textContent = this.lockAxis ? this.lockAxis.toUpperCase() + ': on' : 'Z: off';
      this.dynAxBtn.classList.toggle('on', !!this.lockAxis);
    }
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
    // ribbon-tab extras: tools listed on the active tab from the OTHER mode
    // stay one keypress away (Insert tab + K = column while in Free Drawing)
    const tab = RIBBON_TABS[this.ribbonTab];
    if (tab) {
      const all = this._allToolDefs();
      for (const gid of tab.groups.flatMap(g => g.tools)) {
        const t = all.get(gid);
        if (t && t.key && t.key.toLowerCase() === k) return t.id;
      }
    }
    return null;
  }
  _allToolDefs() {
    if (!this._allDefs) {
      this._allDefs = new Map();
      for (const mode of ['free', 'bim', 'design'])
        for (const t of TOOL_DEFS[mode])
          if (t !== 'sep' && !this._allDefs.has(t.id)) this._allDefs.set(t.id, t);
    }
    return this._allDefs;
  }
  // ------------------------------------------------------------- ribbon tabs
  // The OpenCADStudio tab row replaces the old mode tabs: Draw / Model /
  // Insert / Annotate / View / Manage. Tabs are layouts; tools keep their
  // engine modes (setTool switches automatically).
  _initRibbonTabs() {
    const row = document.getElementById('modetabs');
    if (!row) return;
    row.innerHTML = '';
    row.style.display = '';
    this.ribbonTab = localStorage.getItem('ws3d-ribbontab') || 'draw';
    if (!RIBBON_TABS[this.ribbonTab]) this.ribbonTab = 'draw';
    for (const [id, t] of Object.entries(RIBBON_TABS)) {
      const b = document.createElement('button');
      b.className = 'mtab';
      b.dataset.tab = id;
      b.textContent = t.label;
      b.addEventListener('click', () => this.setRibbonTab(id));
      row.appendChild(b);
    }
    this._syncRibbonTabs();
  }
  setRibbonTab(id) {
    if (!RIBBON_TABS[id] || id === this.ribbonTab) return;
    this.ribbonTab = id;
    try { localStorage.setItem('ws3d-ribbontab', id); } catch (e) { }
    this._syncRibbonTabs();
    this._buildToolbar();
    document.querySelectorAll('#toolbar .tbtn[data-tool]').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === (this.tool && this.tool.id)));
    this.setStatus(`${RIBBON_TABS[id].label} ribbon`);
  }
  _syncRibbonTabs() {
    document.querySelectorAll('#modetabs .mtab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === this.ribbonTab));
  }
  /** The engine mode a tool id lives in (null when it exists nowhere). */
  _toolMode(id) {
    for (const mode of Object.keys(TOOL_DEFS))
      if (TOOL_DEFS[mode].some(t => t !== 'sep' && t.id === id)) return mode;
    return null;
  }

  setTool(id) {
    // cross-tab pick: a tool ABSENT from the current engine mode switches to
    // the mode it lives in (setMode applies the pending tool once the mode's
    // state is ready). Tools present here — including shared ones like
    // Select — never switch.
    const inCurrent = TOOL_DEFS[this.mode] && TOOL_DEFS[this.mode].some(t => t !== 'sep' && t.id === id);
    if (!inCurrent) {
      const target = this._toolMode(id);
      if (target) {
        this._pendingTool = id;
        this.setMode(target);
        return;
      }
    }
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
    this._axisChip();
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
    bar.innerHTML = ''; // full ribbon swap per tab/mode
    // current open group body — every factory appends here, the group closes
    // when the next group starts (OpenCADStudio-style titled panels)
    let body = null;
    const openGroup = (title) => {
      const g = document.createElement('div');
      g.className = 'tgroup';
      body = document.createElement('div');
      body.className = 'tg-body';
      const label = document.createElement('div');
      label.className = 'tg-title';
      label.textContent = title;
      g.appendChild(body); g.appendChild(label);
      bar.appendChild(g);
    };
    const mk = (html, title, cls = '', dataset = '', click = null) => {
      const b = document.createElement('button');
      b.className = 'tbtn ' + cls;
      b.innerHTML = html;
      b.title = title;
      if (dataset) for (const [k, v] of Object.entries(JSON.parse(dataset))) b.dataset[k] = v;
      if (click) b.addEventListener('click', click);
      body.appendChild(b);
      return b;
    };
    // Tab layout: every tool id from every mode is resolvable (a tab may list
    // free tools next to BIM tools); the per-mode ribbons keep their old
    // leftover catch-all for Engine tools that self-register later.
    const tab = RIBBON_TABS[this.ribbonTab];
    let groups, byId = new Map();
    if (tab) {
      groups = (tab.groups || []).map(g => ({ ...g }));
      for (const mode of ['free', 'bim', 'design'])
        for (const t of TOOL_DEFS[mode])
          if (t !== 'sep' && !byId.has(t.id)) byId.set(t.id, t);
    } else {
      const defs = TOOL_DEFS[this.mode].filter(t => t !== 'sep');
      groups = (RIBBON_GROUPS[this.mode] || []).map(g => ({ ...g }));
      const assigned = new Set(groups.flatMap(g => g.tools));
      const leftover = defs.filter(t => !assigned.has(t.id)).map(t => t.id);
      if (leftover.length) groups.push({ title: 'Tools', tools: leftover });
      byId = new Map(defs.map(t => [t.id, t]));
    }
    for (const grp of groups) {
      const tools = grp.tools.filter(id => id !== 'levelview' || this.mode === 'bim');
      if (!tools.length) continue;
      openGroup(grp.title);
      for (const id of tools) {
        if (id === 'undo') { this.btnUndo = mk(ICONS.undo, 'Undo (Ctrl+Z)', '', '{}', () => this.undo()); continue; }
        if (id === 'redo') { this.btnRedo = mk(ICONS.redo, 'Redo (Ctrl+Y)', '', '{}', () => this.redo()); continue; }
        if (id === 'zoomext') { this.btnExtents = mk(ICONS.zoomext, 'Zoom Extents (Ctrl+Shift+E)', '', '{}', () => this.view.zoomExtents()); continue; }
        if (id === 'shadows') { this.btnShadow = mk(ICONS.shadow, 'Toggle Shadows', 'toggle on', '{}', () => this.action('toggleShadows')); continue; }
        if (id === 'xray') { this.btnXray = mk(ICONS.xray, 'Toggle X-Ray', 'toggle', '{}', () => this.action('toggleXray')); continue; }
        if (id === 'wire') { this.btnWire = mk(ICONS.wire, 'Face Style: Shaded / Monochrome / Wireframe', 'toggle', '{}', () => this.action('cycleFaceStyle')); continue; }
        if (id === 'browser') { this.btnBrowser = mk(ICONS.browser || ICONS.levels, 'Element Browser — Category ➔ Family ➔ Type palette (drag a type into the viewport to place it)', 'toggle', '{}', () => this.toggleElementBrowser()); continue; }
        if (id === 'layers') { this.btnLayers = mk(ICONS.layers || ICONS.browser, 'Layers — AutoCAD-style layer manager (assign elements, on/off, lock, color, current layer)', 'toggle', '{}', () => this.toggleLayersPanel()); continue; }
        if (id === 'families') { this.btnFamilies = mk(ICONS.families || ICONS.browser, 'Families — parametric design catalog (column styles: classical, regional, modern, structural); size one and place it', 'toggle', '{}', () => this.toggleFamiliesPanel()); continue; }
        if (id === 'kit') { this.btnKit = mk(ICONS.blenderkit, 'BlenderKit Assets — search free models and drop them into the scene (needs the local bridge: npm run bridge; GLB-badged models import without Blender)', 'toggle', '{}', () => this.toggleBlenderKit()); continue; }
        if (id === 'levelsbtn') { mk(ICONS.levels, 'Levels — view / add / edit project levels', '', '{}', () => this.levelsDialog()); continue; }
        if (id === 'gridsbtn') { mk(ICONS.grids, 'Grids — generate / edit the grid system (snap targets)', '', '{}', () => this.gridsDialog()); continue; }
        if (id === 'levelview') {
          // Level View: per-level plan isolation — appears only while a
          // standard camera view (Top/Front/…) is locked; pick a level to
          // show just it
          const lvSel = document.createElement('select');
          lvSel.id = 'levelview';
          lvSel.title = 'Level View — show only one level while a standard view (Top/Front…) is active';
          lvSel.style.display = 'none';
          lvSel.addEventListener('change', () => { this.levelView = lvSel.value; this._applyLevelView(); });
          body.appendChild(lvSel);
          continue;
        }
        const t = byId.get(id);
        if (!t) continue;
        const key = t.key ? ` (${t.key === 'Space' ? 'Space' : t.key})` : '';
        mk(ICONS[t.id], t.label + key, '', JSON.stringify({ tool: t.id }), () => this.setTool(t.id));
      }
    }
    this._syncLevelViewControl(); // populate/show the Level View select if a standard view is locked
    this.refreshToolbar();
  }
  refreshToolbar() {
    // ribbon tabs may not carry the display toggles — guard every optional button
    if (this.btnShadow) this.btnShadow.classList.toggle('on', this.shadowsOn);
    if (this.btnXray) this.btnXray.classList.toggle('on', this.xrayOn);
    const fs = { shaded: 'Shaded', monochrome: 'Monochrome', wireframe: 'Wireframe' }[this.faceStyle];
    if (this.btnWire) {
      this.btnWire.classList.toggle('on', this.faceStyle !== 'shaded');
      this.btnWire.title = `Face Style: ${fs} (click to cycle)`;
    }
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
        ['Import IFC…', 'openIfc', ''], ['Remove Imported IFC', 'removeIfc', ''],
        ['Load 5-Story Building', 'demo5', ''],
        ['Load Revit Test Building (Grids)', 'demor5', ''],
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
        ['Fog', 'toggleFog', '', 'fogOn'], ['X-Ray', 'toggleXray', '', 'xrayOn'],
        ['Performance HUD', 'togglePerfHud', '', 'perfHudOn'], '-',
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

  // File ▸ Load 5-Story Building: fresh model (confirm when there is work),
  // then the demo5 scene — footings, 20 columns, 20 beams, punched slabs
  // 2-5, flat roof (the scene test/building5.test.js proves)
  loadDemo5Building() {
    const go = () => {
      const ModelCls = Model;
      this.bindModel(new ModelCls());
      this.undoStack = []; this.redoStack = [];
      this.exitGroup(); this.clearSelection();
      if (!window.Demo5) { this.toast('demo5 feature not loaded', true); return; }
      const done = counts => {
        this.onLevelsChanged();
        // fresh demo = consistent model; the deferred backlog would storm the
        // first user action with hundreds of synchronous rebuilds
        if (this.bim && this.bim._hostsDirty) this.bim._hostsDirty.clear();
        this.view.rebuild();
        this.updateInfo();
        this.refreshGroups();
        if (this.elements && this.elements.refresh) this.elements.refresh();
        this.view.zoomExtents();
        this.toast('5-story building loaded — '
          + Object.entries(counts || {}).map(([k, n]) => n + ' ' + k + 's').join(', '));
        this._saveAutosave();
      };
      const fail = e => this.toast('5-story building failed: ' + (e.message || e), true);
      if (window.Demo5.buildAsync) {
        // staged: the UI paints progress between stages instead of freezing
        this.toast('Building the 5-story building — about a minute…');
        window.Demo5.buildAsync(this, (label, i, n) => {
          this.setStatus('Building 5-story building — ' + label + ' (' + (i + 1) + '/' + n + ')');
        }).then(done, fail);
      } else {
        try { done(window.Demo5.build(this)); } catch (e) { fail(e); }
      }
    };
    const hasWork = this.model.faces.size > 0 || this.bim.entities.length > 0;
    if (hasWork) this.confirmDialog('Load the 5-story building? Unsaved changes will be lost.', go);
    else go();
  }

  // File ▸ Load Revit Test Building: the Element-Browser pathway test —
  // grid lines (columns grid-attached), manager-created levels, footings,
  // columns, beams, punched slabs, roof, six rooms per floor
  loadRevitTestBuilding() {
    const go = () => {
      const ModelCls = Model;
      this.bindModel(new ModelCls());
      this.undoStack = []; this.redoStack = [];
      this.exitGroup(); this.clearSelection();
      if (!window.DemoR5) { this.toast('demo-r5 feature not loaded', true); return; }
      const done = counts => {
        this.onLevelsChanged();
        if (this.onGridsChanged) this.onGridsChanged();
        // a freshly built demo is consistent: the deferred host-dirty backlog
        // (every wall/column/beam the build marked) would otherwise drain on
        // the FIRST user action — hundreds of synchronous rebuilds
        if (this.bim && this.bim._hostsDirty) this.bim._hostsDirty.clear();
        this.view.rebuild();
        this.updateInfo();
        this.refreshGroups();
        if (this.elements && this.elements.refresh) this.elements.refresh();
        this.view.zoomExtents();
        this.toast('Revit test building loaded — '
          + Object.entries(counts || {}).map(([k, n]) => n + ' ' + k + (n === 1 ? '' : 's')).join(', '));
        this._saveAutosave();
      };
      const fail = e => this.toast('Revit test building failed: ' + (e.message || e), true);
      if (window.DemoR5.buildAsync) {
        this.toast('Building the Revit test building…');
        window.DemoR5.buildAsync(this, (label, i, n) => {
          this.setStatus('Building Revit test building — ' + label + ' (' + (i + 1) + '/' + n + ')');
        }).then(done, fail);
      } else {
        try { done(window.DemoR5.build(this)); } catch (e) { fail(e); }
      }
    };
    const hasWork = this.model.faces.size > 0 || this.bim.entities.length > 0;
    if (hasWork) this.confirmDialog('Load the Revit test building? Unsaved changes will be lost.', go);
    else go();
  }

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
      openIfc: () => document.getElementById('ifcinput').click(),
      removeIfc: () => {
        if (!window.IfcImport || !IfcImport.list().length) { A.toast('No imported IFC in the scene'); return; }
        IfcImport.removeAll();
        A.toast('Imported IFC removed');
      },
      demo5: () => A.loadDemo5Building(),
      demor5: () => A.loadRevitTestBuilding(),
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
          m.touch(); // winding flip: no edge/vertex change, render must refresh
        });
      },
      hideSelected: () => {
        A.run('hide', m => {
          for (const id of A.sel.faces) { const f = m.faces.get(id); if (f) f.hidden = true; }
          for (const id of A.sel.edges) { const e = m.edges.get(id); if (e) e.hidden = true; }
          m.touch();
        });
        A.clearSelection();
      },
      unhideAll: () => {
        A.run('unhide', m => {
          for (const f of m.faces.values()) f.hidden = false;
          for (const e of m.edges.values()) e.hidden = false;
          m.touch();
        });
      },
      toggleAxes: () => { A.axesOn = !A.axesOn; A.view.setAxes(A.axesOn); },
      toggleGrid: () => { A.gridOn = !A.gridOn; A.view.setGrid(A.gridOn); },
      toggleGridSnap: () => A.toggleGridSnap(),
      toggleEdges: () => { A.edgesOn = !A.edgesOn; A.view.setEdges(A.edgesOn); },
      toggleShadows: () => { A.shadowsOn = !A.shadowsOn; A.view.setShadows(A.shadowsOn); },
      togglePerfHud: () => {
        A.view.perfHud = !A.view.perfHud;
        A.perfHudOn = A.view.perfHud;
        try { localStorage.setItem('websketch3d.perfhud', A.view.perfHud ? '1' : ''); } catch (e) { }
        A.view.invalidate();
        A.toast('Performance HUD ' + (A.view.perfHud ? 'on — fps, draw calls, triangles' : 'off'));
      },
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
      this.view.invalidate();
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
      this.view.invalidate();
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
      this.view.invalidate();
      if (this.nav && ev.button === 1) { this.nav = null; return; }
      if (ev.button === 0 && this._gridDrag) { this._gridDragEnd(); return; }
      if (ev.button === 0) this.tool.onUp(ev);
    });
    canvas.addEventListener('dblclick', (ev) => { this.view.invalidate(); this.tool.onDoubleClick(ev); });
    canvas.addEventListener('wheel', (ev) => {
      this.view.invalidate();
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
    const ii = document.getElementById('ifcinput');
    if (ii) ii.addEventListener('change', () => {
      const f = ii.files[0];
      if (!f) return;
      ii.value = '';
      this.openIfcFile(f);
    });
  }

  // File ▸ Import IFC… — phase 1: the building lands as category-colored
  // reference meshes in true world position (web-ifc from CDN on first
  // use). Nothing enters the kernel; Remove Imported IFC disposes it whole.
  async openIfcFile(file) {
    if (!window.IfcImport) { this.toast('IFC importer not loaded', true); return; }
    this.setStatus(`Importing “${file.name}” — parsing geometry (first import fetches the ~2 MB parser)…`);
    try {
      const rec = await IfcImport.load(file);
      const top = Object.entries(rec.counts).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([k, n]) => `${n} ${k}`).join(', ');
      this.view.zoomExtents();
      this.toast(`Imported “${file.name}” — ${rec.object.children.length} meshes (${top}${Object.keys(rec.counts).length > 4 ? ', …' : ''}). Reference only: not editable, Remove via File ▸ Remove Imported IFC`);
    } catch (e) {
      console.error(e);
      this.toast(`IFC import failed: ${e && e.message || e}`, true);
    }
    this.setStatus(this.tool ? this.tool.hint : '');
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
        // arc/circle with a start point: V flips the sketch plane vertical
        // (Z-axis arcs) — one press, no axis-lock arming
        if (ht && ['arc', 'circle'].includes(ht.id) && (ht.s || ht.center)) {
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

      // arrows: axis lock — the chip in the status bar makes the state
      // visible (and survives until cleared; ArrowDown or tool switch)
      if (k === 'ArrowRight') { this.lockAxis = 'x'; this._axisChip(); ev.preventDefault(); return; }
      if (k === 'ArrowLeft') { this.lockAxis = 'y'; this._axisChip(); ev.preventDefault(); return; }
      if (k === 'ArrowUp') { this.lockAxis = 'z'; this._axisChip(); ev.preventDefault(); return; }
      if (k === 'ArrowDown') { this.lockAxis = null; this._axisChip(); ev.preventDefault(); return; }

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
        this.run('paint', m => { const ff = m.faces.get(pick.face); if (ff) { ff.color = this.currentMaterial.color; ff.alpha = this.currentMaterial.alpha; } m.touch(); });
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
        } else if (selFaces.length && selFaces.some(f => f.userData && f.userData.bimEntityId)) {
          // selection is already element-owned: no Convert entry is possible,
          // but the menu must not go silent — say WHY (the "nothing happens"
          // confusion: converted faces can only be re-converted after Erase
          // breaks the element claim, or on fresh free geometry)
          const ent = this.bim.getEntityForFace(selFaces.find(f => f.userData && f.userData.bimEntityId));
          items.push([ent
            ? `${ent.type} ${ent.id} — already an element`
            : 'Selection already belongs to elements', () =>
            this.toast('These faces already form an element — convert works on free (unclaimed) faces only', true)]);
        }
      }
      // EXTRUDE EDGE: free line(s) become ribbon faces directly — pure Free
      // Drawing geometry, no element claim (the Extrude Curve tool's J path,
      // reachable from a selection instead of a pick)
      if (this.sel.edges.size) {
        const selEdges = [...this.sel.edges].map(id => this.model.edges.get(id)).filter(Boolean);
        if (selEdges.length)
          items.push([selEdges.length === 1
            ? 'Extrude Edge…'
            : `Extrude ${selEdges.length} Edges…`,
            () => this.extrudeEdgeDialog(selEdges.map(e => e.id))]);
        // JOIN: weld gaps + fuse collinear runs — separate lines become one
        // chain that extrudes/converts as a single polyline
        if (selEdges.length >= 2)
          items.push(['Join Edges into Polyline', () => this.joinSelectedEdges(selEdges.map(e => e.id))]);
      }
      // EDGE ➔ ELEMENT: free line(s) convert directly into solid members —
      // the line becomes the element's centerline (no face needed first)
      if (!this.sel.faces.size && this.sel.edges.size
        && window.BimTools && BimTools.ConvertTool) {
        const selEdges = [...this.sel.edges].map(id => this.model.edges.get(id)).filter(Boolean);
        const freeEdges = selEdges.filter(e => !(e.userData && e.userData.bimEntityId));
        if (freeEdges.length)
          items.push([freeEdges.length === 1
            ? 'Convert Edge to Element…'
            : `Convert ${freeEdges.length} Edges to Element…`,
            () => this.convertEdgeDialog(freeEdges.map(e => e.id))]);
        else if (selEdges.length)
          items.push(['Edge already belongs to an element', () =>
            this.toast('That edge is already part of an element — convert works on free (unclaimed) edges', true)]);
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
    // dismiss on mousedown OUTSIDE the menu only: hiding on the item's own
    // mousedown pulled it out of hit-testing before mouseup, so the native
    // click retargeted to whatever sat behind — menu entries "did nothing"
    const close = (e) => {
      if (menu.contains(e.target)) return;
      menu.classList.add('hidden');
      window.removeEventListener('mousedown', close);
    };
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
      // a handler may refuse (return exactly false) — its inputs were wrong,
      // so the dialog STAYS OPEN for a correction instead of closing and
      // leaving the user with a missed toast ("nothing happened")
      b.addEventListener('click', () => {
        const r = fn ? fn() : undefined;
        if (r !== false) this.closeDialog();
      });
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
    // ALERT on already-claimed geometry: a selected face belongs to an
    // element — say so instead of opening a dialog that cannot convert
    const claimedSample = ids.map(id => this.model.faces.get(id)).find(f => f && f.userData && f.userData.bimEntityId);
    if (claimedSample) {
      const ent = this.bim.getEntityForFace(claimedSample);
      this.toast(ent
        ? `${ent.type} ${ent.id} is already an element — convert works on free (unclaimed) faces only`
        : 'These faces already form an element — convert works on free faces only', true);
      return;
    }
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
      <div class="ob-lab">Element name — the type shown in the Element Browser</div>
      <input type="text" id="cv-name" placeholder="e.g. Fluted Column 300x300"
        style="width:100%;margin:2px 0 10px;padding:5px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
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
      ${multi ? `<p style="opacity:.75;margin:0 0 6px">No geometry is created — the ${ids.length} selected faces are claimed as the element's body. The element is <b>fixed</b>: its drawn geometry is the design, dimensions are display-only.</p>` : `
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
          if (!name) { this.toast('Type a name for the custom element', true); return false; }
          mode = name;
        }
        // the element's display name — an existing catalog type with the same
        // name in the chosen family is reused; otherwise it is created. A
        // BLANK name auto-generates (type label + count) so the flow never
        // stalls waiting for input
        const nameEl = document.getElementById('cv-name');
        const typed = nameEl ? nameEl.value.trim() : '';
        const label = { floor: 'Finish Floor', slab: 'Structural Slab', wall: 'Wall', column: 'Column', beam: 'Beam' }[mode]
          || (mode[0].toUpperCase() + mode.slice(1).replace(/_/g, ' '));
        let name = typed;
        if (!name) {
          let n = 1;
          while (this.bim.entities.some(e => (e.params || {}).name === `${label} ${n}`)) n++;
          name = `${label} ${n}`;
        }
        if (!(window.BimTools && BimTools.ConvertTool)) return false;
        if (multi) {
          const faces = ids.map(id => this.model.faces.get(id)).filter(Boolean)
            .filter(f => !(f.userData && f.userData.bimEntityId));
          if (!faces.length) { this.toast('Those faces are gone or already claimed', true); return false; }
          BimTools.ConvertTool.convertFaces(this, faces, mode, { name });
        } else {
          const hEl = document.getElementById('cv-height');
          const h = hEl ? parseFloat(hEl.value) : NaN;
          const ff = this.model.faces.get(ids[0]);
          if (!ff) { this.toast('That face is gone', true); return false; }
          BimTools.ConvertTool.convertFace(this, ff, mode, { name, height: isNaN(h) ? undefined : h });
        }
        this.toast(typed ? `Converted — "${name}"` : `Converted — named "${name}" (type a name first to choose your own)`);
        this.clearSelection();
      }],
    ]);
    const custom = document.getElementById('cv-custom');
    if (custom) custom.addEventListener('click', e => e.stopPropagation());
  }
  // Convert selected free EDGE(S) into solid members directly — the line is
  // the element's centerline: a horizontal line grows a beam-like prism
  // (width across, height up), a vertical line grows a column-like prism
  // (width × depth centered). The drawn line is CONSUMED by the conversion.
  // Multiple edges become one member each, numbered from the shared name.
  // Extrude selected free EDGE(S) into ribbon faces — the same geometry the
  // Extrude Curve tool (J) produces, but driven from a selection: distance +
  // direction in a dialog, one face per edge. Pure Free Drawing geometry —
  // no element claim, no BIM registration; Push/Pull and Trim work on the
  // result like any drawn face.
  extrudeEdgeDialog(eids) {
    const ids = Array.isArray(eids) ? eids : [eids];
    const e0 = this.model.edges.get(ids[0]);
    if (!e0) return;
    this.dialog(ids.length > 1 ? `Extrude ${ids.length} Edges` : 'Extrude Edge', `
      <div class="ob-lab">Distance (m)</div>
      <input type="number" id="ee-dist" step="0.05" min="0.01" value="1.0"
        style="width:120px;margin:2px 0 10px;padding:4px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
      <div class="ob-lab">Direction</div>
      <select id="ee-dir" style="margin:4px 0 10px;padding:4px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
        <option value="aim" selected>Toward the mouse — click a point to aim the extrude</option>
        <option value="auto">Auto — curve normal: 90° to the profile's own plane (slope/up/sideways for single lines)</option>
        <option value="normal">Curve normal — perpendicular to the curve's plane, along its normal vector</option>
        <option value="edgeplane">In the edge's plane — perpendicular to the edge, following its slope</option>
        <option value="localperp">Local perpendicular — 90° to the edge, sideways out of its plane</option>
        <option value="parallel">Parallel to the edge — along a curve's span (vaults, sweeps)</option>
        <option value="up">+Z (up)</option>
        <option value="down">−Z (down)</option>
        <option value="px">+X</option>
        <option value="nx">−X</option>
        <option value="py">+Y</option>
        <option value="ny">−Y</option>
      </select>
      <p style="opacity:.75;margin:2px 0 0">Each edge becomes a ribbon face (a live preview follows the mouse in Aim mode). The edge stays — Push/Pull the face to give it thickness.</p>
    `, [
      ['Cancel', null],
      ['Extrude', () => {
        const d = parseFloat(document.getElementById('ee-dist').value);
        if (!isFinite(d) || Math.abs(d) < 1e-4) { this.toast('Type an extrude distance', true); return; }
        const dirChoice = document.getElementById('ee-dir').value;
        // AIM mode hands over to the click-to-aim tool: a live preview
        // follows the mouse, the next click extrudes toward that point
        if (dirChoice === 'aim') { this.extrudeTowardMouse(ids, d); return; }
        const dirMap = { up: G.v(0, 0, 1), down: G.v(0, 0, -1), px: G.v(1, 0, 0), nx: G.v(-1, 0, 0), py: G.v(0, 1, 0), ny: G.v(0, -1, 0) };
        const m = this.model;
        let n = 0;
        this.transaction.run('extrude edges', mm => {
          // expand each selection to its whole curve (an arc picked by one
          // edge extrudes as ONE ribbon, segment by segment — same quads the
          // Extrude Curve tool builds)
          const seen = new Set();
          const segs = [];
          for (const eid of ids) {
            const e0 = m.edges.get(eid);
            if (!e0) continue;
            const chain = e0.curveId
              ? [...m.edges.values()].filter(x => x.curveId === e0.curveId)
              : [e0];
            for (const e of chain) if (!seen.has(e.id)) { seen.add(e.id); segs.push(e); }
          }
          // CONNECTED-CHAIN DATA (always computed): the ordered path through
          // the selected edges feeds two derived directions —
          //   spanDir:   first ➔ last point (parallel/vault sweeps)
          //   normalDir: the curve's LOCAL PLANE NORMAL, Newell-style (Σ of
          //              cross products about the centroid) — the direction
          //              perpendicular (90°) to the profile's own plane, in
          //              2D or 3D, independent of world X/Y/Z
          let spanDir = null, normalDir = null, pathLen = 0, chainPts = null;
          {
            const adj = new Map();
            for (const e of segs) for (const v of [e.a, e.b]) {
              if (!adj.has(v)) adj.set(v, []);
              adj.get(v).push(e);
            }
            const ends = [...adj.entries()].filter(([, es]) => es.length === 1).map(([v]) => v);
            if (ends.length >= 2) {
              const prev = new Map([[ends[0], null]]);
              const q = [ends[0]];
              while (q.length) {
                const v = q.shift();
                for (const e of adj.get(v) || []) {
                  const w = e.a === v ? e.b : e.a;
                  if (!prev.has(w)) { prev.set(w, v); q.push(w); }
                }
              }
              if (prev.has(ends[1])) {
                const path = [];
                for (let v = ends[1]; v != null; v = prev.get(v)) path.push(v);
                pathLen = path.length;
                chainPts = path.map(v => m.vp(v)); // ordered stations for the sweep
                if (path.length >= 3) {
                  const s = G.sub(m.vertices.get(path[0]), m.vertices.get(path[path.length - 1]));
                  if (!G.isZero(G.norm(s))) spanDir = G.norm(s);
                  // Newell centroid-fan normal of the chain's points
                  const pts = path.map(v => m.vp(v));
                  let C = G.v(0, 0, 0);
                  for (const p of pts) C = G.add(C, p);
                  C = G.mul(C, 1 / pts.length);
                  let nn = G.v(0, 0, 0);
                  for (let i = 0; i + 1 < pts.length; i++)
                    nn = G.add(nn, G.cross(G.sub(pts[i], C), G.sub(pts[i + 1], C)));
                  nn = G.norm(nn);
                  if (!G.isZero(nn)) {
                    if (nn.z < 0) nn = G.neg(nn); // canonical: point upward
                    normalDir = nn;
                  }
                }
              }
            }
            if (dirChoice === 'parallel' && !spanDir) {
              this.toast('Parallel extrude sweeps a CURVE along its span — a straight edge along itself makes no face. Use an axis direction for straight edges.', true);
              return;
            }
            if (dirChoice === 'normal' && !normalDir) {
              this.toast('Curve normal needs a CURVE (3+ points) — a single straight edge has no profile plane. Use Auto or an axis for straight edges.', true);
              return;
            }
          }
          // STATION-BASED LOCAL SWEEP (open-path boundary conditions):
          // tangent-dependent modes sweep a multi-point chain station by
          // station, with END TANGENTS CLAMPED to forward/backward
          // differences — T0 = P1 − P0 and Tend = Pend − Pend−1, never a
          // wrap-around — so the end caps square off perpendicular to the
          // path's actual end direction (no skewed sliver faces at the open
          // ends), and interior stations use the central difference so
          // adjacent quads share offset vertices exactly (watertight joints).
          const LOCAL_MODES = ['auto', 'normal', 'edgeplane', 'localperp', 'parallel'];
          if (LOCAL_MODES.includes(dirChoice) && chainPts && pathLen >= 3) {
            const P = chainPts;
            const T = P.map((_, i) => {
              if (i === 0) return G.norm(G.sub(P[1], P[0]));                          // clamped forward difference
              if (i === P.length - 1) return G.norm(G.sub(P[P.length - 1], P[P.length - 2])); // clamped backward difference
              return G.norm(G.sub(P[i + 1], P[i - 1]));                               // central difference
            });
            // per-station sweep direction from the STATION tangent (not the
            // segment chord — that per-segment mismatch was the joint gap)
            const dirAt = t => {
              if (dirChoice === 'parallel') return spanDir;
              if (dirChoice !== 'edgeplane' && normalDir) return normalDir;
              const nPlane = G.cross(t, G.v(0, 0, 1));      // station's vertical-plane normal
              let ip = G.isZero(nPlane) ? G.v(0, 0, 1) : G.cross(G.norm(nPlane), t); // in-plane ⊥
              if (G.isZero(ip)) ip = G.v(0, 0, 1);
              if (dirChoice === 'localperp') {
                let w = G.cross(t, ip);
                if (G.isZero(w)) w = G.v(0, 0, 1);
                if (w.z < 0) w = G.neg(w);
                return G.norm(w);
              }
              if (ip.z < 0) ip = G.neg(ip);                 // edgeplane: grow along the slope
              return G.norm(ip);
            };
            const Q = P.map((p, i) => G.add(p, G.mul(dirAt(T[i]), d)));
            let covered = null;
            for (let i = 0; i + 1 < P.length; i++) {
              // sliver guard: a station whose tangent runs along the sweep
              // direction contributes a near-zero-area quad — skip it
              // instead of emitting a distorted face
              const dir = dirAt(T[i]);
              if (Math.abs(G.dot(T[i], dir)) > 0.999) continue;
              if (mm.addFaceFromRings([P[i], P[i + 1], Q[i + 1], Q[i]])) n++;
            }
            // edges already covered by the station sweep (both endpoints on
            // the path as consecutive stations) must not sweep again; edges
            // of OTHER chains in the selection fall through to the per-edge path
            covered = new Set();
            for (const e of segs) {
              const ai = P.indexOf(m.vp(e.a)), bi = P.indexOf(m.vp(e.b));
              if (ai >= 0 && bi >= 0 && Math.abs(ai - bi) === 1) covered.add(e.id);
            }
            this._extrudeCovered = covered;
          } else this._extrudeCovered = null;
          const coveredIds = this._extrudeCovered;
          for (const e of segs) {
            if (coveredIds && coveredIds.has(e.id)) continue;
            const A = m.vertices.get(e.a), B = m.vertices.get(e.b);
            if (!A || !B) continue;
            let dir = dirMap[dirChoice];
            const chordEdge = G.sub(B, A);
            const dUnit = G.norm(chordEdge);
            // IN THE EDGE'S OWN PLANE: the sweep follows the edge's slope —
            // perpendicular to the edge WITHIN its vertical plane (the push/
            // pull analogue: a face extrudes along its normal; an edge along
            // its in-plane perpendicular). Slanted edges keep their wall
            // plane instead of a skewed world-axis ribbon.
            const edgePlanePerp = () => {
              const nPlane = G.cross(dUnit, G.v(0, 0, 1)); // the edge's vertical-plane normal
              let ip = G.cross(G.norm(nPlane), dUnit);      // in-plane, ⊥ the edge
              if (G.isZero(ip)) ip = G.v(0, 0, 1);
              if (ip.z < 0) ip = G.neg(ip);                 // grow along the upward slope
              return G.norm(ip);
            };
            if (dirChoice === 'auto' || dirChoice === 'edgeplane' || dirChoice === 'normal') {
              // CURVE NORMAL first: a multi-point curve extrudes 90° to its
              // OWN plane (Auto and the explicit option) — the Newell normal,
              // never a world axis
              if (dirChoice !== 'edgeplane' && normalDir && pathLen >= 3) {
                dir = normalDir;
              } else if (Math.abs(dUnit.z) > 0.99) {
                // vertical line: extrude sideways (horizontal perpendicular)
                dir = G.norm(G.cross(dUnit, G.v(0, 0, 1)));
                if (G.isZero(dir)) dir = G.v(1, 0, 0);
              } else if (dirChoice === 'edgeplane' || Math.abs(dUnit.z) > 0.01) {
                // slanted single edge (or explicitly chosen): follow its slope
                dir = edgePlanePerp();
              } else dir = G.v(0, 0, 1);
            } else if (dirChoice === 'parallel') {
              dir = spanDir;
            } else if (dirChoice === 'localperp') {
              // LOCAL AXIS, 90° OUT OF THE EDGE'S PLANE: the edge's local
              // frame is (along d, in-plane ⊥ = edgePlanePerp, out-of-plane
              // ⊥ = d × in-plane). This sweeps sideways, perpendicular to
              // both the edge and its slope — the world-axis options'
              // local-space counterpart for single lines.
              dir = G.norm(G.cross(dUnit, edgePlanePerp()));
              if (G.isZero(dir)) dir = G.v(0, 0, 1);
              if (dir.z < 0) dir = G.neg(dir); // grow upward-ish
            }
            const A2 = G.add(A, G.mul(dir, d)), B2 = G.add(B, G.mul(dir, d));
            if (mm.addFaceFromRings([A, B, B2, A2])) n++;
          }
        });
        if (!n) this.toast('Those edges are gone', true);
        else this.toast(`Extruded ${n} edge${n > 1 ? 's' : ''} — ${Math.abs(d).toFixed(2)} m`);
        this.clearSelection();
      }],
    ]);
  }
  // AIM-MODE EXTRUDE: after the dialog, the next click aims the sweep — a
  // live preview follows the mouse; each edge extrudes toward the picked
  // point (perpendicular to the edge, so aiming along an edge is never
  // degenerate). Esc cancels back to Select.
  extrudeTowardMouse(eids, dist) {
    if (this.tool) this.tool.deactivate();
    this.tool = new AimExtrudeTool(this, eids, dist);
    this.tool.activate();
    this.lockAxis = null;
    this.clearAxisLocks();
    this._axisChip();
    this.view.clearPreview();
    document.querySelectorAll('#toolbar .tbtn[data-tool]').forEach(b => b.classList.remove('active'));
    this.setStatus(this.tool.hint);
    this.toast('Aim mode — click in the viewport where the extrude should go (Esc cancels)');
  }
  extrudeEdgesToward(eids, targetPoint, dist) {
    const m = this.model;
    let n = 0;
    this.transaction.run('extrude toward point', mm => {
      const seen = new Set();
      const segs = [];
      for (const eid of eids) {
        const e0 = m.edges.get(eid);
        if (!e0) continue;
        const chain = e0.curveId
          ? [...m.edges.values()].filter(x => x.curveId === e0.curveId)
          : [e0];
        for (const e of chain) if (!seen.has(e.id)) { seen.add(e.id); segs.push(e); }
      }
      for (const e of segs) {
        const A = m.vertices.get(e.a), B = m.vertices.get(e.b);
        if (!A || !B) continue;
        // aim = (target − midpoint) with the along-edge component removed:
        // the sweep goes toward the mouse, never along the edge itself
        const mid = G.mul(G.add(A, B), 0.5);
        const ed = G.norm(G.sub(B, A));
        let v = G.sub(targetPoint, mid);
        v = G.sub(v, G.mul(ed, G.dot(v, ed)));
        if (G.len(v) < 1e-6) continue;
        const dir = G.norm(v);
        const A2 = G.add(A, G.mul(dir, dist)), B2 = G.add(B, G.mul(dir, dist));
        if (mm.addFaceFromRings([A, B, B2, A2])) n++;
      }
    });
    if (!n) this.toast('Could not extrude toward that point — aim more sideways from the edges', true);
    else this.toast(`Extruded ${n} edge${n > 1 ? 's' : ''} toward the point — ${Math.abs(dist).toFixed(2)} m`);
    this.clearSelection();
    return n;
  }
  // Join selected free EDGE(S) into one polyline: endpoint gaps within 2 cm
  // weld shut, and collinear consecutive segments fuse into single edges.
  // The result behaves as one chain everywhere (Extrude, Convert, chains).
  joinSelectedEdges(eids) {
    const m = this.model;
    const EPS = 0.02; // gap weld tolerance
    let welded = 0, merged = 0;
    const ok = this.transaction.run('join edges', () => {
      const work = [...new Set(eids)];
      // edges that bound faces cannot be re-wired (that would break face
      // rings) — they still join the chain, just keep their own segments
      const faceBound = new Set();
      for (const f of m.faces.values()) for (const ring of m.rings(f)) for (let i = 0; i < ring.length; i++) {
        const e = m.findEdge(ring[i], ring[(i + 1) % ring.length]);
        if (e) faceBound.add(e.id);
      }
      const live = () => work.map(id => m.edges.get(id)).filter(e => e && !(e.userData && e.userData.bimEntityId) && !faceBound.has(e.id));
      // 1) WELD endpoint gaps: two free endpoints of different edges within
      // EPS merge onto the same vertex (delete + re-add snapped)
      let progress = true, guard = 0;
      while (progress && guard++ < 50) {
        progress = false;
        const list = live();
        outer1:
        for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
          if (i === j) continue;
          const e1 = list[i], e2 = list[j];
          for (const [k1, p1] of [['a', m.vp(e1.a)], ['b', m.vp(e1.b)]])
            for (const [k2, p2] of [['a', m.vp(e2.a)], ['b', m.vp(e2.b)]]) {
              if (e1[k1] === e2[k2]) continue;
              const d = G.dist(p1, p2);
              if (d > 1e-9 && d <= EPS) {
                const other = k1 === 'a' ? m.vp(e1.b) : m.vp(e1.a);
                m.deleteEdgeIds([e1.id]);
                work.splice(work.indexOf(e1.id), 1);
                const ne = m.addEdge(other, p2);
                if (ne) work.push(ne.id);
                welded++; progress = true;
                break outer1;
              }
            }
        }
      }
      // 2) FUSE collinear runs: A→V + V→C pointing the same way become A→C
      progress = true; guard = 0;
      while (progress && guard++ < 50) {
        progress = false;
        const list = live();
        outer2:
        for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
          if (i === j) continue;
          const e1 = list[i], e2 = list[j];
          for (const v of [e1.a, e1.b]) {
            if (!(e2.a === v || e2.b === v)) continue;
            const A = e1.a === v ? e1.b : e1.a;
            const C = e2.a === v ? e2.b : e2.a;
            if (A === C) continue;
            const pA = m.vp(A), pV = m.vp(v), pC = m.vp(C);
            const d1 = G.sub(pV, pA), d2 = G.sub(pC, pV);
            if (G.len(d1) < 1e-9 || G.len(d2) < 1e-9) continue;
            if (G.len(G.cross(G.norm(d1), G.norm(d2))) > 1e-3) continue; // not collinear
            if (G.dot(d1, d2) <= 0) continue; // V must sit between A and C
            m.deleteEdgeIds([e1.id, e2.id]);
          work.splice(work.indexOf(e1.id), 1); work.splice(work.indexOf(e2.id), 1);
            const ne = m.addEdge(pA, pC);
            if (ne) work.push(ne.id);
            merged++; progress = true;
            break outer2;
          }
        }
      }
      // 3) TAG the chain as ONE POLYLINE (AutoCAD semantics): every touched
      // free edge of the connected selection shares one curveId, so click-
      // selecting any segment selects the whole polyline, and extrude /
      // convert / offset treat it as a single chain. Lines that merely touch
      // (nothing to weld or fuse) STILL become a polyline — that is the point.
      let tagged = 0;
      {
        const list = work.map(id => m.edges.get(id)).filter(e => e && !e.curveId);
        if (list.length >= 2) {
          // numeric chain id outside the kernel's nid() counter space
          const cid = Date.now();
          m.curves.set(cid, { type: 'polyline' });
          for (const e of list) { e.curveId = cid; tagged++; }
        }
      }
      return welded + merged + tagged > 0;
    });
    if (!ok) { this.toast('Pick two or more free edges that touch (or nearly touch) to join', true); return; }
    this.toast(`Joined into a polyline${welded || merged ? ` — ${welded} gap${welded === 1 ? '' : 's'} welded, ${merged} segment${merged === 1 ? '' : 's'} fused` : ''} — click any segment to select the whole chain`);
    this.clearSelection();
  }
  convertEdgeDialog(eids) {
    const ids = Array.isArray(eids) ? eids : [eids];
    const e0 = this.model.edges.get(ids[0]);
    if (!e0) return;
    const A = this.model.vertices.get(e0.a), B = this.model.vertices.get(e0.b);
    const vertical = A && B && Math.abs(B.z - A.z) >= 0.9 * Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
    this.dialog(ids.length > 1 ? `Convert ${ids.length} Edges to Element` : 'Convert Edge to Element', `
      <div class="ob-lab">Element name — the type shown in the Element Browser</div>
      <input type="text" id="ce-name" placeholder="${vertical ? 'e.g. Steel Column SHS 200' : 'e.g. Concrete Beam 200x400'}"
        style="width:100%;margin:2px 0 10px;padding:5px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
      <div class="ob-lab">Element type</div>
      <div style="display:flex;gap:12px;align-items:center;margin:4px 0 10px;flex-wrap:wrap">
        ${[['beam', 'Beam'], ['column', 'Column'], ['wall', 'Wall'], ['__custom', 'Custom…']].map(([v, n], i) => `
        <label style="display:flex;gap:5px;align-items:center;cursor:pointer">
          <input type="radio" name="cetype" value="${v}"${(vertical ? v === 'column' : v === 'beam') ? ' checked' : ''}> ${n}
        </label>`).join('')}
        <input type="text" id="ce-custom" placeholder="e.g. truss, bracing"
          style="width:150px;padding:3px 6px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
      </div>
      <div class="ob-lab">Profile (m) — ${vertical ? 'width × depth of the column' : 'width across × height of the beam'}</div>
      <div style="display:flex;gap:8px;margin:4px 0 6px">
        <input type="number" id="ce-width" step="0.05" min="0.01" value="${vertical ? 0.3 : 0.2}"
          style="width:110px;padding:4px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
        <span style="align-self:center">×</span>
        <input type="number" id="ce-height" step="0.05" min="0.01" value="${vertical ? 0.3 : 0.4}"
          style="width:110px;padding:4px 8px;border:1px solid var(--line,#ccc);border-radius:4px;background:transparent;color:inherit">
      </div>
      <p style="opacity:.75;margin:2px 0 0">The line becomes the member's centerline and is consumed by the conversion. The element is <b>fixed</b>: its geometry is the design.</p>
    `, [
      ['Cancel', null],
      ['Convert', () => {
        const picked = document.querySelector('input[name="cetype"]:checked');
        let mode = picked ? picked.value : 'beam';
        if (mode === '__custom') {
          const cname = (document.getElementById('ce-custom').value || '').trim().toLowerCase().replace(/\s+/g, '_');
          if (!cname) { this.toast('Type a name for the custom element', true); return false; }
          mode = cname;
        }
        // blank name auto-generates — the flow must never stall on input
        const typed = (document.getElementById('ce-name').value || '').trim();
        const label = { column: 'Column', beam: 'Beam' }[mode]
          || (mode[0].toUpperCase() + mode.slice(1).replace(/_/g, ' '));
        let name = typed;
        if (!name) {
          let k = 1;
          while (this.bim.entities.some(e => (e.params || {}).name === `${label} ${k}`)) k++;
          name = `${label} ${k}`;
        }
        const w = parseFloat(document.getElementById('ce-width').value);
        const h = parseFloat(document.getElementById('ce-height').value);
        if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) { this.toast('Profile width and height must be positive', true); return false; }
        if (!(window.BimTools && BimTools.ConvertTool)) return false;
        let n = 0;
        for (const eid of ids) {
          const e = this.model.edges.get(eid);
          if (!e || (e.userData && e.userData.bimEntityId)) continue;
          const made = BimTools.ConvertTool.convertEdge(this, e, mode, { name: ids.length > 1 ? `${name} ${n + 1}` : name, width: w, height: h });
          if (made) n++; // only successful members consume a numbered name
        }
        if (!n) { this.toast('Those edges are gone or already claimed', true); return false; }
        this.clearSelection();
      }],
    ]);
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
  // The standing surface under a geometry pick: a horizontal face of a
  // floor/slab/roof (or free-mode geometry) at the picked plane containing
  // the picked plan point. Vertical elements (walls, columns, beams,
  // foundations) return nothing — clicking a wall means "a column HERE,
  // from the floor", never "float one at the height I happened to click"
  // (the floating column then half-embeds in the wall and no split ever
  // happens — the exact "can't add a column to a wall" report).
  pointStandingZ(p, kind) {
    if (!['endpoint', 'midpoint', 'center', 'edge', 'face'].includes(kind)) return null;
    if (p.z == null) return null;
    return this.model.standingZAt(p);
  }
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
      && inf.kind !== 'gridX' && inf.kind !== 'gridline' && inf.kind !== 'centerline') {
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
      // ThatOpen SnapResolver pattern: candidates are DEDUPLICATED on a 1mm
      // quantized key (triangulation-seam and shared-edge duplicates
      // collapse; endpoint > center > midpoint priority) — and their screen
      // projections are cached per camera signature so a hover move scans
      // 2D distances instead of re-projecting every candidate.
      const seen = new Map();
      const cands = [];
      const addC = (p, kind, label) => {
        const k = Math.round(p.x * 1e3) + ',' + Math.round(p.y * 1e3) + ',' + Math.round(p.z * 1e3);
        if (seen.has(k)) return;
        seen.set(k, 1);
        cands.push({ p, kind, label });
      };
      for (const [, p] of model.vertices) addC(p, 'endpoint', 'Endpoint');
      for (const [, m] of model.curves) if (m.center) addC(m.center, 'center', 'Center');
      for (const e of model.edges.values()) {
        if (e.curveId) continue;
        const a = model.vp(e.a), b = model.vp(e.b);
        if (a && b) addC(G.mul(G.add(a, b), 0.5), 'midpoint', 'Midpoint');
      }
      this._snapCache = cands;
      this._snapProj = null;
    }
    if (!locked) {
      let best = null, bestD = 9;
      // live snap points come first: sketch boundaries are preview-only
      // (never model edges), so tools feed their path endpoints through
      // this._liveSnaps on every planePoint() call
      const live = this._liveSnaps;
      // project the cache ONCE per camera state (orbit/pan/zoom/edit), not
      // once per candidate per mouse move — the hover loop below is then a
      // pure 2D distance scan. The key extends the view's camera signature
      // with ortho zoom and viewport size (neither moves the camera).
      const cam = this.view.activeCamera();
      const camSig = this.view._cameraSig() + '|z' + (cam.zoom || 0).toFixed(4)
        + '|' + this.view.canvas.width + 'x' + this.view.canvas.height;
      if (this._snapProjSig !== camSig || !this._snapProj) {
        const proj = new Array(this._snapCache.length);
        for (let i = 0; i < proj.length; i++) proj[i] = this.view.worldToScreenPixels(this._snapCache[i].p);
        this._snapProj = proj;
        this._snapProjSig = camSig;
      }
      const proj = this._snapProj;
      let bestLive = null, bestLiveD = 9;
      if (live && live.length) {
        for (const c of live) {
          const s = this.view.worldToScreenPixels(c.p);
          if (!s.visible) continue;
          const d = Math.hypot(s.x - q.x, s.y - q.y);
          if (d < bestLiveD) { bestLiveD = d; bestLive = c; }
        }
      }
      const cache = this._snapCache;
      for (let i = 0; i < cache.length; i++) {
        const s = proj[i];
        if (!s.visible) continue;
        const d = Math.hypot(s.x - q.x, s.y - q.y);
        if (d < bestD) { bestD = d; best = cache[i]; }
      }
      best = bestLive && bestLiveD <= bestD ? bestLive : best;
      if (best) {
        // GRID-INTERSECTION PRIORITY over the artifacts of the column
        // STANDING at that intersection: a tier-1 point on the column (face
        // corners, band-edge midpoints, face picks) is an OFFSET of the
        // intersection — the wall being drawn wants the intersection itself
        // (params keep the centerline; FACE-STOP/grid trim retreats the
        // geometry to the column faces). Without this, room-perimeter walls
        // chained column-to-column zigzagged between face artifacts instead
        // of closing the loop (0.8 m diagonal stubs where 6 m spans belong).
        if (this.gridManager && this.gridManager.grids.length && typeof SnapSystem !== 'undefined') {
          const gx = SnapSystem.snap(this, ev);
          if (gx && gx.kind === 'gridX'
            && Math.hypot(best.p.x - gx.p.x, best.p.y - gx.p.y) < 0.75)
            return { p: G.clone(gx.p), kind: 'gridX', label: gx.label };
        }
        // HIDDEN-CENTERLINE override: the wall's own band-edge MIDPOINTS are
        // tier-1 artifacts of its side faces — when the cursor is on the
        // wall, the parametric centerline is the intent (a column centers
        // at mid-thickness, 100 mm on a 200 mm wall). Real ENDPOINTS (wall
        // ends, corners) still win — only band-edge midpoints demote.
        if (best.kind === 'midpoint' && this.bim && this.bim._centerlineSnap) {
          const cl = this.bim._centerlineSnap(q,
            this.view.clientToWorldRay(ev.clientX, ev.clientY).ro,
            this.view.clientToWorldRay(ev.clientX, ev.clientY).rd, this.view);
          if (cl && this.bim._axisBandContains(cl, best.p)) return cl;
        }
        return { p: G.clone(best.p), kind: best.kind, label: best.label };
      }
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

    // HIDDEN CENTERLINES: every parametric element owns an invisible axis
    // (wall base->end, beam baseline, column center). The cursor snaps to
    // the nearest point ON it — a column centers on a 200 mm wall at
    // exactly 100 mm with no grid line at all. Beats raw face edges so the
    // parametric intent wins over the B-Rep's side-face edges.
    if (!locked && this.bim && this.bim.entities.length) {
      const { ro, rd } = this.view.clientToWorldRay(ev.clientX, ev.clientY);
      const cs = this.bim._centerlineSnap(q, ro, rd, this.view);
      if (cs) return cs;
    }

    // On-edge tracking: the closest point between the cursor ray and each
    // straight model edge — sketch along wall faces and column footprints
    // BETWEEN their corner vertices (endpoints above still own the corners).
    // Same ray/line math as the axis inference below.
    if (!locked) {
      const { ro, rd } = this.view.clientToWorldRay(ev.clientX, ev.clientY);
      let eBest = null, eD = 10, eBestId = null;
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
        if (d < eD) { eD = d; eBest = p; eBestId = e.id; }
      }
      if (eBest) return { p: eBest, kind: 'edge', label: 'On Edge', edge: eBestId };
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
      if (p) return { p, kind: 'face', label: 'On Face', face: fid };
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
    // CAMERA-PROXIMITY TIE-BREAK: in Top view a slab's top and bottom rings
    // project to the SAME screen position, and iteration order decided the
    // winner — Pick Lines sometimes grabbed the slab's BOTTOM edge. On a
    // screen-distance tie (<= 0.5 px) the edge closer to the CAMERA wins:
    // the top ring from above, the visible edge over hidden ones in iso.
    let cam = null;
    try { const c = this.view.activeCamera(); cam = c ? G.v(c.position.x, c.position.y, c.position.z) : null; } catch (err) { }
    const camDist2 = e => {
      if (!cam) return 0;
      const a2 = model.vp(e.a), b2 = model.vp(e.b);
      const mx = (a2.x + b2.x) / 2 - cam.x, my = (a2.y + b2.y) / 2 - cam.y, mz = (a2.z + b2.z) / 2 - cam.z;
      return mx * mx + my * my + mz * mz;
    };
    let best = null, bd = tol, bc = Infinity;
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
      if (d > tol) continue;
      const cd = camDist2(e);
      if (!best || d < bd - 0.5 || (d <= bd + 0.5 && cd < bc)) {
        if (d < bd) bd = d;
        best = e; bc = cd;
      }
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
  // ---- Revit-method instance parameters -------------------------------------
  // Editable Entity Info fields per element type (the stairs-block pattern
  // generalized): every edit writes the param and regenerates the element's
  // geometry from it — params are truth, the B-Rep is cache.
  _bimParamFields(ent) {
    const p = ent.params || {};
    // FIXED converted elements: the drawn geometry IS the design — no
    // parametric regeneration, dimensions are display-only
    if (p.fixed) return [];
    const num = (key, label, step) => (p[key] != null
      ? { key, label, kind: 'number', step, value: +(+p[key]).toFixed(4) } : null);
    const rot = { key: 'rotation', label: 'Rotation °', kind: 'number', step: 1,
      value: +(((p.rotation || 0) * 180 / Math.PI).toFixed(1)) };
    const loc = (p.locationLine != null
      ? { key: 'locationLine', label: 'Location Line', kind: 'select', value: p.locationLine,
          options: [['centerline', 'Centerline'], ['exterior', 'Exterior face'], ['interior', 'Interior face']] }
      : null);
    let list;
    switch (ent.type) {
      case 'wall': list = [num('height', 'Height m', 0.05), num('thickness', 'Thickness m', 0.01), loc]; break;
      case 'column': list = [num('width', 'Width m', 0.05), num('depth', 'Depth m', 0.05),
        num('height', 'Height m', 0.05), rot]; break;
      case 'beam': list = [num('webWidth', 'Web Width m', 0.05), num('height', 'Height m', 0.05)]; break;
      case 'floor': case 'slab': list = [num('thickness', 'Thickness m', 0.01)]; break;
      case 'door': case 'window':
        list = [num('width', 'Width m', 0.05), num('height', 'Height m', 0.05), num('sillHeight', 'Sill m', 0.05)];
        break;
      default: list = [];
    }
    return list.filter(Boolean);
  }
  // Write one instance param and regenerate the element. Returns falsy on a
  // failed rebuild (the caller's transaction rolls params + geometry back).
  _applyBimParam(ent, key, v) {
    const p = ent.params;
    if (key === 'rotation') p.rotation = v * Math.PI / 180; // field is degrees
    else p[key] = v;
    switch (ent.type) {
      case 'wall': return !!this.bim.rebuildWallWithHosts(ent.id);
      case 'column': return !!this.bim.rebuildColumnEntity(ent.id);
      case 'beam': return !!this.bim.rebuildBeamEntity(ent.id);
      case 'floor': case 'slab': return !!this.bim.rebuildFloorEntity(ent.id);
      case 'door': case 'window': {
        const host = this.bim.getEntityById(p.hostWallId);
        return !!host && !!this.bim.rebuildWallWithHosts(host.id);
      }
      default: return false;
    }
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
      // lineage badge: this element is a PIECE of a split original — it
      // fuses/heals only within its own lineage (pieces of wall_7 never
      // merge with wall_9, however perfectly they touch)
      const lineage = p.merge && p.merge.group ? p.merge.group : null;
      // editable instance parameters (Revit method) + Edit Boundary eligibility
      const fields = this._bimParamFields(ent);
      const fieldKeys = new Set(fields.map(f => f.key));
      const canBoundary = ['floor', 'slab', 'roof'].includes(ent.type)
        && Array.isArray(p.regions) && p.regions.length > 0;
      const rows = [];
      if (lvl) rows.push(['Base Level', lvl.name]);
      if (p.height != null && !fieldKeys.has('height') && ent.type !== 'door' && ent.type !== 'window') rows.push(['Height', fmtLen(p.height)]);
      if (p.thickness != null && !fieldKeys.has('thickness')) rows.push(['Thickness', fmtLen(p.thickness)]);
      if (p.width != null && !fieldKeys.has('width')) rows.push(['Width', fmtLen(p.width)]);
      if (p.rotation && !fieldKeys.has('rotation')) rows.push(['Rotation', (p.rotation * 180 / Math.PI).toFixed(1) + '°']);
      if (p.locationLine && !fieldKeys.has('locationLine')) rows.push(['Location Line', { centerline: 'Centerline', exterior: 'Exterior face', interior: 'Interior face' }[p.locationLine] || p.locationLine]);
      el.innerHTML = `
        <div class="gi-name"><span class="gi-cat">${(info && info.categoryName) || ent.type}</span> <span class="gi-eid">${ent.id}</span></div>
        ${lineage ? `<div class="stats dim">Piece of ${lineage} — heals only within this lineage</div>` : ''}
        ${p.fixed ? `<div class="stats dim">Fixed element — the drawn geometry is the design${p.name ? ` · “${p.name}”` : ''}</div>` : ''}
        <div class="stats">${fam}</div>
        <div class="gi-typerow"><span class="gi-tylab">Type</span>${typeOpts}</div>
        <div class="stats">${q.faces} faces · ${q.openings > 0.0005
          ? `${q.area.toFixed(2)} m² net <span class="dim">(gross ${q.gross.toFixed(2)} − openings ${q.openings.toFixed(2)})</span>`
          : q.area.toFixed(2) + ' m²'}${q.volume != null ? ' · ' + q.volume.toFixed(3) + ' m³' : ''}</div>
        ${q.bbox ? `<div class="stats dim">Bounding box ${q.bbox.size.map(x => x.toFixed(2)).join(' × ')} m</div>` : ''}
        ${rows.length ? `<div class="gi-params">${rows.map(r => `<div class="gi-prow"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}</div>` : ''}
        ${fields.length ? `
          <div class="gi-params" id="gi-pfld">
            ${fields.map(f => f.kind === 'select'
              ? `<div class="gi-prow"><span>${f.label}</span><select data-pf="${f.key}">${f.options.map(([val, lab]) =>
                `<option value="${val}"${f.value === val ? ' selected' : ''}>${lab}</option>`).join('')}</select></div>`
              : `<div class="gi-prow"><span>${f.label}</span><input data-pf="${f.key}" type="number" step="${f.step}" value="${f.value}"></div>`).join('')}
            <div class="dim" style="margin-top:2px">Edit a value — the element regenerates from its parameters</div>
          </div>` : ''}
        ${ent.type === 'stairs' && window.StairsFeature ? `
          <div class="gi-params" id="gi-stair">
            <div class="gi-prow"><span>Width m</span><input data-st="width" type="number" step="0.05" value="${(+p.width || 1.2).toFixed(2)}"></div>
            <div class="gi-prow"><span>Riser m</span><input data-st="riser" type="number" step="0.005" value="${(+p.riser || 0.175).toFixed(3)}"></div>
            <div class="gi-prow"><span>Tread m</span><input data-st="tread" type="number" step="0.01" value="${(+p.tread || 0.28).toFixed(2)}"></div>
            ${p.run === 'u' ? `<div class="gi-prow"><span>Landing m</span><input data-st="landingDepth" type="number" step="0.05" value="${(+p.landingDepth || 1.2).toFixed(2)}"></div>
            <div class="gi-prow"><span>U Gap m</span><input data-st="uGap" type="number" step="0.05" value="${(+p.uGap || 0.1).toFixed(2)}"></div>` : ''}
            <div class="gi-prow"><span>Rail Height m</span><input data-st="railHeight" type="number" step="0.05" value="${(+p.railHeight || 0.9).toFixed(2)}"></div>
            <div class="gi-prow"><span>Handrail</span><input data-st="handrail" type="checkbox" ${p.handrail !== false ? 'checked' : ''}></div>
            <div class="dim" style="margin-top:2px">Edit a value — the stair (and its host opening) regenerate</div>
          </div>` : ''}
        ${canBoundary ? `<button class="mini-btn primary" id="gi-boundary">✏ Edit Boundary</button>` : ''}
        <button class="mini-btn primary" id="gi-eip">✎ Edit In Place</button>
        <button class="mini-btn" id="gi-del">Delete</button>
        <div class="dim" style="margin-top:4px">Hold <b>Ctrl</b> (or <b>Tab</b>) to query individual faces (m²) and edges (m)</div>`;
      const bndBtn = el.querySelector('#gi-boundary');
      if (bndBtn) bndBtn.addEventListener('click', () => this.bim.editBoundary(ent.id));
      const pfBox = el.querySelector('#gi-pfld');
      if (pfBox) pfBox.querySelectorAll('[data-pf]').forEach(inp => {
        inp.addEventListener('change', () => {
          const key = inp.dataset.pf;
          const v = inp.type === 'number' ? parseFloat(inp.value) : inp.value;
          if (inp.type === 'number' && (!isFinite(v) || v < 0 || (key !== 'sillHeight' && v <= 0))) return;
          const ok = this.transaction.run('edit element params', () => {
            if (!this._applyBimParam(ent, key, v)) throw new Error('regeneration failed');
            return true;
          });
          if (ok) {
            this.selectElement(ent.id); // keep it selected across the rebuild
            this.updateInfo();
            this.toast(`${ent.type} ${key} → ${inp.type === 'number' ? v : v}`);
          }
        });
      });
      const tsel = el.querySelector('#gi-type');
      if (tsel) tsel.addEventListener('change', () => {
        if (p.fixed) { this.toast('Fixed element — its geometry is the drawn design', true); tsel.value = info.typeId; return; }
        const t = siblings.find(x => x.id === tsel.value);
        if (t) this.applyElementType(ent, t);
      });
      // STAIRS: editable dimensions + the Handrail checkbox — every edit
      // regenerates the stair and re-cuts its host opening
      const stairBox = el.querySelector('#gi-stair');
      if (stairBox) stairBox.querySelectorAll('[data-st]').forEach(inp => {
        const apply = () => {
          const key = inp.dataset.st;
          let v = inp.type === 'checkbox' ? inp.checked : parseFloat(inp.value);
          if (inp.type !== 'checkbox' && (!isFinite(v) || v <= 0)) return;
          const patch = { [key]: v };
          const res = this.transaction.run('edit stairs', () =>
            window.StairsFeature.rebuildStairEntity(this, ent.id, patch));
          if (res) {
            this.selectElement(ent.id);
            this.updateInfo();
            this.toast(`Stairs ${key} → ${inp.type === 'checkbox' ? (v ? 'on' : 'off') : v}`
              + (res.warnings && res.warnings.length ? ' (⚠ ' + res.warnings.join('; ') + ')' : ''));
          }
        };
        inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'change', apply);
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
    // ---- LINE inspector (OpenCADStudio Properties parity): one selected
    // line edits its layer / linetype / lineweight / thickness and reports
    // its geometry; several lines take bulk style edits
    if (this.sel.edges.size && !this.sel.faces.size) {
      const eids = [...this.sel.edges];
      const e0 = model.edges.get(eids[0]);
      if (e0) {
        const a = model.vp(e0.a), b = model.vp(e0.b);
        const single = eids.length === 1;
        const st = model.resolveEdgeStyle(e0);
        const LT = Model.LINETYPES, LW = Model.LINEWEIGHTS;
        const lyrs = model.layers.map(l => `<option value="${l.id}"${(e0.layerId || '0') === l.id ? ' selected' : ''}>${l.name}</option>`).join('');
        const ltOpts = `<option value="bylayer"${e0.lt == null ? ' selected' : ''}>ByLayer (${LT[st.lt].name})</option>`
          + LT.map(t => `<option value="${t.id}"${e0.lt === t.id ? ' selected' : ''}>${t.name}</option>`).join('');
        const lwOpts = `<option value="bylayer"${e0.lw == null ? ' selected' : ''}>ByLayer (${LW[st.lw].name})</option>`
          + LW.map(w => `<option value="${w.id}"${e0.lw === w.id ? ' selected' : ''}>${w.mm === 0 ? w.name : w.name + ' mm'}</option>`).join('');
        const d = G.sub(b, a);
        const len = model.edgeLength(e0);
        const ang = ((Math.atan2(d.y, d.x) * 180 / Math.PI) % 360 + 360) % 360;
        const thk = model.edgeThickness(e0.id);
        el.innerHTML = `
          <div class="selcount">${single ? 'Line' : eids.length + ' lines'} selected</div>
          <div class="pp-group" style="margin-top:4px">General</div>
          ${this._propRow('Layer', `<select id="pi-layer">${lyrs}</select>`)}
          ${this._propRow('Linetype', `<select id="pi-lt">${ltOpts}</select>`)}
          ${this._propRow('Lineweight', `<select id="pi-lw">${lwOpts}</select>`)}
          ${single ? this._propRow('Thickness', `<input type="number" step="0.1" id="pi-thk" value="${thk ? +thk.toFixed(3) : 0}" title="Extrusion depth in Z (m) — grows the line into a vertical ribbon face"> <span class="dim">m</span>`) : ''}
          ${single ? `<div class="pp-group">Geometry</div>
          ${this._propRow('Start', `${fmtCoord(a)}`)}
          ${this._propRow('End', `${fmtCoord(b)}`)}
          ${this._propRow('Delta X', fmtLen(d.x))}
          ${this._propRow('Delta Y', fmtLen(d.y))}
          ${this._propRow('Delta Z', fmtLen(d.z))}
          ${this._propRow('Length', `<input type="number" step="0.1" id="pi-len" value="${+len.toFixed(3)}"> <span class="dim">m</span>`)}
          ${this._propRow('Angle', ang.toFixed(2) + '\u00B0')}` : ''}`;
        const style = patch => {
          this.run('line style', m => {
            m.setEdgeStyle(eids, patch);
          });
          this.updateInfo();
        };
        el.querySelector('#pi-layer').addEventListener('change', ev => style({ layerId: ev.target.value }));
        el.querySelector('#pi-lt').addEventListener('change', ev => style({ lt: ev.target.value === 'bylayer' ? null : +ev.target.value }));
        el.querySelector('#pi-lw').addEventListener('change', ev => style({ lw: ev.target.value === 'bylayer' ? null : +ev.target.value }));
        const lenIn = el.querySelector('#pi-len');
        if (lenIn) lenIn.addEventListener('change', ev => {
          const L = parseFloat(ev.target.value);
          if (!(L > 1e-4)) return;
          this.run('line length', m => {
            const e = m.edges.get(e0.id);
            if (!e) return;
            const dir = G.sub(m.vp(e.b), m.vp(e.a));
            if (G.len(dir) < 1e-9) return;
            m.setVertex(e.b, G.add(m.vp(e.a), G.mul(dir, L / G.len(dir))));
          });
          this.updateInfo();
        });
        const thkIn = el.querySelector('#pi-thk');
        if (thkIn) thkIn.addEventListener('change', ev => {
          const t = parseFloat(ev.target.value) || 0;
          this.run('line thickness', m => { m.thickenEdge(e0.id, t); });
          this.updateInfo();
        });
      }
      return;
    }
    // ---- FACE selection: add the layer picker to the area summary
    {
      let len = 0;
      for (const id of this.sel.edges) { const e = model.edges.get(id); if (e) len += model.edgeLength(e); }
      let area = 0;
      for (const id of this.sel.faces) { const f = model.faces.get(id); if (f) area += model.faceArea(f); }
      const f0 = this.sel.faces.size === 1 ? model.faces.get([...this.sel.faces][0]) : null;
      const parts = [];
      if (this.sel.faces.size) parts.push(`${this.sel.faces.size} face${this.sel.faces.size > 1 ? 's' : ''}`);
      if (this.sel.edges.size) parts.push(`${this.sel.edges.size} edge${this.sel.edges.size > 1 ? 's' : ''}`);
      const lyrs = model.layers.map(l => `<option value="${l.id}"${((f0 && f0.layerId) || '0') === l.id ? ' selected' : ''}>${l.name}</option>`).join('');
      el.innerHTML = `<div class="selcount">${parts.join(' · ')}</div>
        ${this.sel.faces.size ? `<div>Area: ${area.toFixed(3)} m²</div>` : ''}
        ${this.sel.faces.size ? this._propRow('Layer', `<select id="pi-flayer">${lyrs}</select>`) : ''}
        ${this.sel.edges.size ? `<div>Length: ${fmtLen(len)}</div>` : ''}
        ${this.sel.faces.size ? '<button class="mini-btn primary" id="gi-thicken">Give Thickness…</button>' : ''}
        ${this._wallHint()}
        <div class="dim" style="margin-top:4px">Shift/Ctrl+click adds to the selection · areas are net of openings · Ctrl+G groups</div>`;
      const fl = el.querySelector('#pi-flayer');
      if (fl) fl.addEventListener('change', ev => {
        this.run('face layer', m => { m.setFaceLayers([...this.sel.faces], ev.target.value); });
        this.updateInfo();
      });
      const tb = el.querySelector('#gi-thicken');
      if (tb) tb.addEventListener('click', () => this.thickenDialog());
      return;
    }
  }
  _propRow(label, inner) {
    return `<div class="pp-row" style="display:flex;align-items:center;gap:6px;margin:2px 0">
      <span style="width:76px;flex:none;opacity:.75;font-size:12px">${label}</span>
      <span style="flex:1;display:flex;align-items:center;gap:4px">${inner}</span></div>`;
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
    // a selection that IS exactly one hosted element (door / window / wall
    // opening) deletes the element and HEALS its host wall: the opening
    // closes up and every other hosted element re-cuts at its parametric
    // position. Without this the raw face-delete below would leave the
    // notch behind — and the door's edge stamps (shared with the wall's
    // cut loops) would cascade-delete the wall's faces entirely.
    const hostedOne = this.singleElementSelection();
    if (hostedOne && (hostedOne.type === 'door' || hostedOne.type === 'window' || hostedOne.type === 'opening')
      && hostedOne.params && hostedOne.params.hostWallId
      && this.bim.getEntityById(hostedOne.params.hostWallId)) {
      const kind = hostedOne.type, hostId = hostedOne.params.hostWallId;
      const faces = [...hostedOne.faces];
      this.run('delete ' + kind, () => {
        this.bim.detach(hostedOne.id);          // leaves the hosted list first
        for (const fid of faces) this.model.faces.delete(fid);
        this.model.gc();
        this.bim.rebuildWallWithHosts(hostId);  // re-extrude + re-cut the rest
      });
      this.sel = { edges: new Set(), faces: new Set() };
      this.onSelectionChanged();
      this.toast(kind.charAt(0).toUpperCase() + kind.slice(1) + ' deleted — wall healed');
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
      // EDGE-DESTRUCTION GUARD: an edge shared with a face's boundary IS
      // that face's geometry — deleting it would cascade-delete the face
      // (the "drew a rect over my line, deleting the line killed the rect"
      // case: the rect welded onto the pre-existing line). Edges between
      // exactly TWO faces still delete (the faces merge/heal); free wire
      // edges delete; face-boundary edges are skipped with an explanation.
      // The Eraser tool remains the deliberate destructive path.
      const edgeIds = [];
      let guarded = 0;
      for (const id of edges) {
        if (!m.edges.has(id)) continue;
        const e = m.edges.get(id);
        const adj = m.facesAdjacentToEdge ? m.facesAdjacentToEdge(e) : [];
        if (adj.length === 2 || adj.length === 0) edgeIds.push(id);
        else guarded++;
      }
      if (guarded) this.toast(`Skipped ${guarded} edge${guarded === 1 ? '' : 's'} — ${guarded === 1 ? 'it borders' : 'they border'} a face; deleting would remove the face too. Use the Eraser to dissolve deliberately.`, true);
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
    if (this._rebuilding) { this.toast('Rebuilding from parameters — edits resume in a moment', true); return undefined; }
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
    // a guard-rolled-back commit (invalid geometry) must read as failure to
    // the caller — the column tool kept registering a ghost entity over the
    // restored model otherwise
    if (tx.rolledBack) return undefined;
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
        if (!p.topConstraint || p.topConstraint === 'unconnected') {
          // explicit height — but structure riding the wall's line still
          // wins: fit DOWN to the governing soffit (never stretch up), or a
          // beam drawn over the wall slices its top off in the kernel and
          // the wall loses its parametric identity instead of trimming
          if (this._fitWallClearance(ent, pool, true)) n++;
          continue;
        }
        if (this._fitWallClearance(ent, pool)) n++;
      }
    } finally { this._syncingWalls = false; }
    return n;
  }
  // One wall's clearance re-fit. The built wall's top reaches ELEMENT_EPS
  // INTO the governing soffit (v0.6 bearing overlap — the joint reads solid
  // at any zoom and no two faces ever share a plane).
  _fitWallClearance(ent, pool = null, downOnly = false) {
    const p = ent.params;
    const cl = this.structural.wallClearance(p, {
      model: this.model,
      structure: pool ? [...this.bim.entities, ...pool] : undefined,
    });
    const overlap = cl.deductions.length ? 1e-4 : 0;
    const topZ = cl.topZ + overlap;
    const baseZ = p.base[2];
    const h = Math.max(0.05, topZ - baseZ);
    if (Math.abs(h - (p.height || 0)) < 5e-4) return false; // bearing-EPS noise, not a refit
    // downOnly (unconnected walls): an explicit height is never STRETCHED —
    // only structure landing on the wall lowers its top
    if (downOnly && h > (p.height || 0) + 1e-4) return false;
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
  // AUTO-JOIN WALLS — the miter machinery (wallRing) only acts on walls whose
  // params carry `joins`, and only the classic Wall-tool click flow stamps
  // them. Walls born any OTHER way (Convert to Wall, scripted elements, demo
  // builders) keep flat end caps, so two walls sharing an endpoint render as
  // isolated boxes: a doubled internal cap (Image 1) and an unmeshed wedge
  // at the outer corner (Image 2). This pass records the missing miter joins
  // on BOTH sides whenever two open walls' endpoints coincide (<= 2 cm, same
  // base z — exactly the classic tool's detection) and rebuilds both through
  // the existing join-aware ring path. Left/right offset paths across the
  // whole connected chain then follow automatically: each endpoint's miter
  // apex is the offset-line intersection = the bisector point at
  // (w/2)/sin(θ/2).
  autoJoinWalls() {
    if (this._autoJoining) return 0;
    this._autoJoining = true;
    try {
      const walls = this.bim.entities.filter(e => e.type === 'wall'
        && !e.params.closed && e.params.base && e.params.end);
      const dirty = new Set();
      for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
        const a = walls[i], b = walls[j];
        if (Math.abs(G.v(...a.params.base).z - G.v(...b.params.base).z) > 1e-3) continue;
        // SLOPPY-CORNER SNAP: endpoints a few cm apart (under half the
        // thinner wall + 2 cm) are the same intended corner — snap both
        // walls' endpoints to the midpoint FIRST (the centerline skeleton
        // gets a shared vertex), then miter. Without this a near-miss
        // corner leaves two isolated boxes: doubled internal cap + wedge.
        const tol = 0.5 * Math.min(a.params.thickness || 0.2, b.params.thickness || 0.2) + 0.02;
        for (const [ea, eb] of [['end', 'end'], ['start', 'end'], ['end', 'start'], ['start', 'start']]) {
          const ka = ea === 'end' ? 'end' : 'base';
          const kb = eb === 'end' ? 'end' : 'base';
          const pa = G.v(...a.params[ka]);
          const pb = G.v(...b.params[kb]);
          if (G.dist(pa, pb) > tol) continue;
          a.params.joins = a.params.joins || {};
          b.params.joins = b.params.joins || {};
          if (a.params.joins[ea] || b.params.joins[eb]) continue; // already joined here
          if (G.dist(pa, pb) > 1e-9) {
            const mid = G.v((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2);
            a.params[ka] = [mid.x, mid.y, mid.z];
            b.params[kb] = [mid.x, mid.y, mid.z];
          }
          a.params.joins[ea] = { id: b.id, mode: 'miter' };
          b.params.joins[eb] = { id: a.id, mode: 'miter' };
          dirty.add(a.id); dirty.add(b.id);
        }
      }
      for (const id of dirty) this.bim.rebuildWallWithHosts(id, false);
      return dirty.size;
    } finally {
      this._autoJoining = false;
    }
  }

  // v0.7 COLUMN SYNC — columns run THROUGH the beam zone to their top
  // constraint (the joint cube is filled by the column; beams stop at its
  // faces via the framing trim). Elements never cut each other — the
  // column simply regenerates from its own params against the structure.
  syncColumnBearing(pool = null) {
    if (!this.structural || !this.structural.columnBearingTop) return 0;
    if (this._syncingColumns) return 0;
    const structure = pool ? [...this.bim.entities, ...pool] : null;
    let n = 0;
    this._syncingColumns = true;
    try {
      for (const ent of this.bim.entities) {
        if (ent.type !== 'column' || !ent.params || !ent.faces.length) continue;
        if (this.structural.isDropPanel(ent.params)) continue; // syncDropPanels owns heads
        const b = this.structural.columnBounds(ent.params);
        const desired = this.structural.columnBearingTop(ent.params, structure);
        const h = Math.max(0.1, desired - b.zStart);
        // sub-millimeter deltas are the bearing ELEMENT_EPS itself (nominal
        // soffit vs soffit+EPS) — refitting them re-extruded every demo
        // column on the FIRST user action after load (a 36-rebuild jank
        // storm the user read as 'the app freezes when I draw a wall')
        if (Math.abs(h - (ent.params.height || 0)) < 5e-4) continue;
        const changed = this.transaction.run('column bearing', () => {
          ent.params.height = h;
          if (!this.bim.rebuildColumnEntity(ent.id)) throw new Error('column rebuild failed');
          return true;
        });
        if (changed === true) n++;
      }
    } finally { this._syncingColumns = false; }
    return n;
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
  /** Cheap identity of ALL undoable model state: the geometry mutation
   *  counter, element counts, and the metadata transactions that change no
   *  geometry (rename level/grid/layer/group, level elevation edits). Two
   *  commits with the same signature have identical undo content, so the
   *  second needs no duplicate snapshot on the undo stack. Entity PARAMETER
   *  values are not listed individually — every parametric edit rebuilds
   *  geometry, which bumps model.version. */
  _undoSig() {
    const m = this.model;
    let s = m.version + '/' + m.faces.size + '/' + m.edges.size + '/' + m.vertices.size
      + '/' + (m.bimEntities || []).length + '/' + (m.levels || []).length + '/' + (m.layers || []).length
      + '/' + (m.grids || []).length;
    for (const l of m.levels) s += '|L' + l.id + ':' + l.elevation + ':' + l.name;
    for (const l of m.layers) s += '|Y' + l.id + ':' + l.name;
    for (const [, g] of m.groups) s += '|G' + g.id + ':' + g.name;
    for (const g of m.grids) s += '|R' + (g ? g.id + ':' + (g.name || '') : '');
    for (const e of m.bimEntities) s += '|E' + e.id;
    return s;
  }
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
    // panel refreshes wait for idle: the rebuild already spent the frame
    // budget — painting the viewport first is what makes undo feel instant
    this._deferUI();
    if (!this._eip) this._saveAutosave();
  }
  /** Post-rebuild UI sync (undo/redo): run when the browser is idle. */
  _deferUI() {
    const fn = () => {
      this.onLevelsChanged(); // level edits are transactional too — resync planes/dropdowns
      this.onGridsChanged();  // grids ride the same snapshots
      if (window.LayerPanel) LayerPanel.refresh(); // layer ops are transactional too
      this.updateInfo();
      this.refreshGroups();
      this._updateEditBox();
    };
    (window.requestIdleCallback || (f => setTimeout(f, 30)))(fn);
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
    this._deferUI();
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
      // a FLOOR opening is a pure parametric record — the hole lives in the
      // host slab's params.regions; the entity owns no B-Rep of its own
      if (ent.type === 'opening' && ent.params && ent.params.hostFloorId) continue;
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
        this.syncColumnBearing(); // v0.6: columns re-cap under beams (or grow back)
        this.autoJoinWalls(); // walls born join-less (Convert, scripts) miter at coincident endpoints
      });
    }
    this._snapCache = null; // new endpoints/midpoints/centers must become snap candidates
    // STRAY-LINE INVARIANT: a faceless, non-deliberate edge can leak when a
    // rebuild orphans an edge that was BORN before the current sweep bracket
    // (the sweep only reaps edges born inside it — e.g. a corner miter
    // rebuild leaving an old cap edge behind). Reap once here, after every
    // operation, so no path can keep one.
    this.model.reapOrphanEdges();
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
      // dependency order: columns stand alone, beams trim against them,
      // walls trim against both — rebuilding a beam against a half-built
      // column is what made placed beams vanish (rebuild deleted the old
      // faces, then failed against the transient junction state)
      const order = { column: 0, beam: 1, wall: 2 };
      dirty.sort((a, b) => (order[(this.bim.getEntityById(a) || {}).type] ?? 3)
        - (order[(this.bim.getEntityById(b) || {}).type] ?? 3));
      let failed = 0;
      const deferred = [];
      for (const wid of dirty) {
        const ent = this.bim.getEntityById(wid);
        if (!ent) continue;
        // mid-commit (joined wall pre-registration): its own tool is still
        // building — queue it for the NEXT opDone instead of trimming a
        // half-born wall against structure
        if (ent._pending) { deferred.push(wid); continue; }
        let ok = true;
        if (ent.type === 'wall') ok = this.bim.planTrimWall(wid);
        else if (ent.type === 'beam') ok = this.bim.planTrimBeam(wid);
        else if (ent.type === 'column') ok = this.bim.rebuildColumnEntity(wid);
        if (!ok) failed++;
      }
      for (const wid of deferred) this.bim._hostsDirty.add(wid);
      // a failed regeneration already deleted the entity's faces — the
      // parametric rebuild is the guaranteed recovery (params are truth)
      if (failed) {
        this.toast(`${failed} element${failed === 1 ? '' : 's'} failed to regenerate — rebuilding model from parameters`, true);
        this.rebuildFromParams();
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
      try {
        const snap = this.model.serialize();
        if (!this._asWorker) {
          try { this._asWorker = new Worker('js/autosaveWorker.js'); } catch (e) { this._asWorker = null; }
        }
        if (!this._asWorker) { // no workers (or blob CSP): old inline path
          try { localStorage.setItem('websketch3d', JSON.stringify(snap)); } catch (e) { }
          return;
        }
        // coalesce: only the LATEST snapshot matters; if the worker is still
        // busy, remember it and post when the previous stringify completes
        if (this._asBusy) { this._asPending = snap; return; }
        this._asBusy = true;
        this._asWorker.onmessage = (ev) => {
          this._asBusy = false;
          if (ev.data) { try { localStorage.setItem('websketch3d', ev.data); } catch (e) { } }
          if (this._asPending) { const p = this._asPending; this._asPending = null; this._saveAutosaveNow(p); }
        };
        this._saveAutosaveNow(snap);
      } catch (e) { }
    }, 600);
  }
  _saveAutosaveNow(snap) {
    this._asBusy = true;
    this._asWorker.postMessage(snap);
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
