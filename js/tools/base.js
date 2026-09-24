'use strict';
// ---------------------------------------------------------------------------
// Tool framework: shared helpers + the Tool base class (lifecycle contract:
// activate() deactivate() cleanup() onDown() onMove() onUp() onKey() onVCB() status()).
// Coordinate convention: z-up. Each tool receives raw PointerEvents; screen
// math goes through the Viewport coordinate API (clientToCanvasPixels etc.).
// ---------------------------------------------------------------------------
const AXES = { x: G.v(1, 0, 0), y: G.v(0, 1, 0), z: G.v(0, 0, 1) };
const AXIS_COLOR = { x: 0xd23c2e, y: 0x3d9e4e, z: 0x3e66c4 };

function fmtLen(m) {
  const a = Math.abs(m);
  if (a >= 1000) return (m / 1000).toFixed(2) + ' km';
  if (a >= 1) return m.toFixed(2) + ' m';
  if (a >= 0.01) return (m * 100).toFixed(1) + ' cm';
  return (m * 1000).toFixed(0) + ' mm';
}
function fmtCoord(p) {
  if (!p) return '';
  return `[${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]`;
}
// coordinate readout near the cursor while drawing (below the dimension label).
// Also arms the CAD snap marker for the hovered snap — every tool that
// reports cursor coords gets the small box + label for endpoints,
// midpoints, intersections etc., so snapping reads the same in the
// dimension tool, drawing tools, and everything else.
function showCursorCoords(view, s, inf, p, dy = 18) {
  if (!s || !p) return;
  view.hudLabel(s.x, s.y + dy, (inf && inf.label ? inf.label + '  ' : '') + fmtCoord(p), '#5a3fa0');
  if (inf && inf.kind && inf.kind !== 'axis' && inf.kind !== 'free'
    && typeof view.showSnapDot === 'function') view.showSnapDot(inf.p || p, inf.kind);
}
function parseLen(s) {
  if (s == null) return null;
  s = String(s).trim().toLowerCase();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(km|m|cm|mm|ft|in|'|")?$/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const u = m[2];
  if (u === 'cm') v *= 0.01;
  else if (u === 'mm') v *= 0.001;
  else if (u === 'km') v *= 1000;
  else if (u === 'ft' || u === "'") v *= 0.3048;
  else if (u === 'in' || u === '"') v *= 0.0254;
  return v;
}
function parseAngle(s) {
  if (s == null) return null;
  s = String(s).trim().toLowerCase().replace('deg', '').replace('°', '').replace('rad', '');
  const v = parseFloat(s);
  if (isNaN(v)) return null;
  if (/rad/.test(String(s))) return v; // not reached, placeholder
  return v * Math.PI / 180;
}
function projectToPlane(p, plane) {
  const d = G.dot(plane.n, p) - plane.d;
  return G.sub(p, G.mul(plane.n, d));
}
function pointInLoop(p, pts, u, v) {
  const q = pts.map(x => G.to2D(x, pts[0], u, v));
  const P = G.to2D(p, pts[0], u, v);
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (((q[i].y > P.y) !== (q[j].y > P.y)) &&
      (P.x < (q[j].x - q[i].x) * (P.y - q[i].y) / (q[j].y - q[i].y) + q[i].x)) inside = !inside;
  }
  return inside;
}

// =========================================================== base
class Tool {
  constructor(app) { this.app = app; }
  get id() { return this.constructor.id; }
  activate() { }
  deactivate() { this.cleanup(); }
  cleanup() {
    this.app.view.clearPreview();
    this.app.view.hideSnapDot();
    this.app.view.setHoverFace(null);
    this.app.view.setHoverEdges(null);
  }
  onDown(ev) { } onMove(ev) { } onUp(ev) { } onDoubleClick(ev) { }
  onKey(ev) { return false; }
  onVCB(text) { return false; }
  get hint() { return ''; }
  status() { this.app.setStatus(this.hint); }
}

// =========================================================== select
window.Tool = Tool;
window.AXES = AXES;
window.AXIS_COLOR = AXIS_COLOR;
window.fmtLen = fmtLen;
window.fmtCoord = fmtCoord;
window.showCursorCoords = showCursorCoords;
window.parseLen = parseLen;
window.parseAngle = parseAngle;
window.projectToPlane = projectToPlane;
window.pointInLoop = pointInLoop;
