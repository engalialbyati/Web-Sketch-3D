'use strict';
// g.js — minimal 3-vector helpers for the FEA engine (self-contained app).
(function () {
  const v = (x, y, z) => ({ x, y, z });
  window.G = {
    v,
    sub: (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z),
    dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    cross: (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x),
    len: a => Math.hypot(a.x, a.y, a.z),
    dist: (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z),
    norm: a => { const l = Math.hypot(a.x, a.y, a.z) || 1; return v(a.x / l, a.y / l, a.z / l); },
    mul: (a, s) => v(a.x * s, a.y * s, a.z * s),
  };
})();
