#!/usr/bin/env python
# ---------------------------------------------------------------------------
# engine.py - the WebSketch 3D Python rebar engine (Phase 1 bridge).
#
# A zero-dependency local HTTP service (stdlib only) the web app talks to.
# When FreeCAD is importable, bars are built the way FreeCAD-Reinforcement
# builds them - a circular profile swept along the centerline wire via
# makePipeShell - giving EXACT OCCT B-Rep geometry (true cylinders, true
# bends), tessellated for the WebGL viewer. Without FreeCAD the endpoints
# answer honestly with freecad: false and the app falls back to its JS
# engine; per-bar `debug: true` returns a pure-Python ring sweep so the
# whole pipeline is testable on machines without FreeCAD.
#
# Run:      python engine.py            (or FreeCAD's own python.exe - see README)
# Endpoint: http://127.0.0.1:8765
# ---------------------------------------------------------------------------
import json
import math
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765

# ---- FreeCAD availability -------------------------------------------------
FREECAD = None
FREECAD_ERR = None
try:
    import FreeCAD  # noqa: F401
    import Part
    FREECAD = FreeCAD.Version()
except Exception as e:  # ImportError, DLL mismatch, licence dialog, anything
    FREECAD_ERR = str(e)


def build_pipe_freecad(points, diameter, tolerance):
    """Exact rebar: circular profile swept along the centerline wire
    (the FreeCAD-Reinforcement construction). Returns (vertices, facets)."""
    verts3 = [FreeCAD.Vector(p[0], p[1], p[2]) for p in points]
    wire = Part.Wire(Part.makePolygon(verts3))
    r = diameter / 2.0
    t0 = verts3[1] - verts3[0]
    profile = Part.Wire(Part.makeCircle(r, verts3[0], t0))
    shape = wire.makePipeShell([profile], True, True)
    verts, facets = shape.tessellate(tolerance)
    return ([list(v) for v in verts], [list(f) for f in facets])


# ---- pure-Python debug sweep (test double, no FreeCAD needed) -------------
def _ring(center, tangent, r, segs):
    t = tangent
    a = abs(t[2]) < 0.9 and (0, 0, 1) or (1, 0, 0)
    # orthonormal basis perpendicular to the tangent
    b1 = (t[1] * a[2] - t[2] * a[1], t[2] * a[0] - t[0] * a[2], t[0] * a[1] - t[1] * a[0])
    n1 = math.sqrt(b1[0] ** 2 + b1[1] ** 2 + b1[2] ** 2)
    if n1 < 1e-12:
        b1, n1 = (0, 1, 0), 1.0
    b1 = (b1[0] / n1, b1[1] / n1, b1[2] / n1)
    b2 = (t[1] * b1[2] - t[2] * b1[1], t[2] * b1[0] - t[0] * b1[2], t[0] * b1[1] - t[1] * b1[0])
    out = []
    for j in range(segs):
        a2 = 2 * math.pi * j / segs
        c, s = math.cos(a2) * r, math.sin(a2) * r
        out.append((center[0] + b1[0] * c + b2[0] * s,
                    center[1] + b1[1] * c + b2[1] * s,
                    center[2] + b1[2] * c + b2[2] * s))
    return out


def build_pipe_debug(raw_points, diameter, segs=12):
    """Plain 12-sided ring sweep down the polyline - the same construction
    the JS engine uses (including its consecutive-point dedupe), so the
    bridge can be verified without FreeCAD."""
    points = []
    for q in raw_points:  # the JS sweep drops consecutive duplicates too
        if not points or (q[0] - points[-1][0]) ** 2 + (q[1] - points[-1][1]) ** 2                 + (q[2] - points[-1][2]) ** 2 > 1e-12:
            points.append(q)
    r = diameter / 2.0
    verts, facets = [], []
    rings = []
    for i, p in enumerate(points):
        if i == 0:
            t = (points[1][0] - p[0], points[1][1] - p[1], points[1][2] - p[2])
        else:
            t = (p[0] - points[i - 1][0], p[1] - points[i - 1][1], p[2] - points[i - 1][2])
        n = math.sqrt(t[0] ** 2 + t[1] ** 2 + t[2] ** 2) or 1.0
        t = (t[0] / n, t[1] / n, t[2] / n)
        ring = _ring(p, t, r, segs)
        base = len(verts)
        verts.extend(ring)
        rings.append((base, ring))
    for k in range(len(rings) - 1):
        b0, _ = rings[k]
        b1, _ = rings[k + 1]
        for j in range(segs):
            j2 = (j + 1) % segs
            facets.append([b0 + j, b0 + j2, b1 + j2])
            facets.append([b0 + j, b1 + j2, b1 + j])
    # end caps: fans around each end ring's centroid
    for idx in (0, len(rings) - 1):
        base, ring = rings[idx]
        c = [sum(p[k] for p in ring) / segs for k in range(3)]
        ci = len(verts)
        verts.append(c)
        for j in range(segs):
            j2 = (j + 1) % segs
            tri = [base + j, base + j2, ci] if idx == 0 else [base + j2, base + j, ci]
            facets.append(tri)
    return verts, facets


# ---- HTTP -----------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._json(200, {'ok': True})

    def do_GET(self):
        if self.path.startswith('/health'):
            self._json(200, {
                'ok': True,
                'engine': 'websketch3d-python',
                'freecad': FREECAD is not None,
                'freecadVersion': FREECAD,
                'freecadError': FREECAD_ERR,
                'python': sys.version.split()[0],
            })
        else:
            self._json(404, {'ok': False, 'error': 'unknown endpoint'})

    def do_POST(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
            req = json.loads(self.rfile.read(n) or b'{}')
        except Exception as e:
            self._json(400, {'ok': False, 'error': 'bad JSON: %s' % e})
            return
        if not self.path.startswith('/pipes'):
            self._json(404, {'ok': False, 'error': 'unknown endpoint'})
            return
        out = []
        for bar in req.get('bars', []):
            pts = bar.get('points') or []
            dia = float(bar.get('diameter') or 0)
            tol = float(bar.get('tolerance') or max(0.0015, dia * 0.2))
            if len(pts) < 2 or dia <= 0:
                out.append({'ok': False, 'error': 'need >= 2 points and diameter > 0'})
                continue
            try:
                if bar.get('debug'):
                    verts, facets = build_pipe_debug(pts, dia)
                    out.append({'ok': True, 'debug': True, 'vertices': verts, 'facets': facets})
                elif FREECAD is None:
                    out.append({'ok': False, 'freecad': False,
                                'error': 'FreeCAD is not importable - install FreeCAD or run '
                                         'engine.py with FreeCAD/bin/python.exe (see README)'})
                else:
                    verts, facets = build_pipe_freecad(pts, dia, tol)
                    out.append({'ok': True, 'engine': 'freecad',
                                'vertices': verts, 'facets': facets})
            except Exception as e:
                out.append({'ok': False, 'error': 'build failed: %s' % e})
        self._json(200, {'ok': True, 'bars': out})

    def log_message(self, fmt, *args):
        sys.stderr.write('[engine] %s\n' % (fmt % args))


def main():
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print('[engine] WebSketch 3D python engine on http://127.0.0.1:%d' % PORT)
    print('[engine] FreeCAD: %s' % (FREECAD is not None and ('yes ' + str(FREECAD))
                                    or ('NO (%s)' % FREECAD_ERR)))
    srv.serve_forever()


if __name__ == '__main__':
    main()
