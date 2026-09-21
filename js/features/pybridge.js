'use strict';
// ---------------------------------------------------------------------------
// features/pybridge.js — the Python engine bridge (Phase 1).
//
// When the local engine (python/engine.py) is online and FreeCAD is
// importable there, reinforcement bars are built by FreeCAD itself — the
// exact OCCT makePipeShell construction FreeCAD-Reinforcement uses — and
// the tessellated meshes land here as loose rebar faces tagged
// engine:'freecad'. The JS engine stays the fallback: engine off, offline,
// or a bar the service could not build falls straight through to
// addRebarPath untouched.
//
// Flow: dialogs preview the cage (recorder paths) → Create prefetches all
// centerlines in ONE /pipes batch → the transaction runs synchronously and
// the wrapped Model.addRebarPath consumes cached meshes by signature.
// ---------------------------------------------------------------------------
(function () {
  const URL_BASE = 'http://127.0.0.1:8765';
  const LS_KEY = 'websketch3d.pyengine';

  const sig = (pts, dia) => dia.toFixed(6) + '|' +
    pts.map(p => p.x.toFixed(6) + ',' + p.y.toFixed(6) + ',' + p.z.toFixed(6)).join(';');

  const PyEngine = {
    url: URL_BASE,
    cache: new Map(),          // sig -> { vertices, facets, engine }
    state: { online: false, freecad: false, version: null },
    // test hook: build through the service's pure-Python debug sweep even
    // without FreeCAD installed (the E2E uses it; production never sets it)
    debugMeshes: false,

    get enabled() {
      try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; }
    },
    setEnabled(on) {
      try { localStorage.setItem(LS_KEY, on ? '1' : ''); } catch (e) { }
      if (on) this.wrapModel(); else this.unwrapModel();
    },

    async probe(timeout = 1500) {
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), timeout);
        const r = await fetch(this.url + '/health', { signal: ac.signal });
        clearTimeout(t);
        const j = await r.json();
        this.state = { online: !!j.ok, freecad: !!j.freecad, version: j.freecadVersion || null };
      } catch (e) {
        this.state = { online: false, freecad: false, version: null };
      }
      return this.state;
    },

    /** True when Create should route bars through the service. */
    get active() {
      return this.enabled && this.state.online && (this.state.freecad || this.debugMeshes);
    },

    /** Prefetch meshes for an entire cage: paths = [{pts, dia}] from a
     *  preview recorder. One batched POST; failures are silently skipped
     *  (those bars fall back to the JS engine). */
    async prefetch(paths) {
      if (!this.active || !paths || !paths.length) return;
      await this.probe(800);
      if (!this.active) return;
      const bars = paths.map(p => ({
        points: p.pts.map(q => [+q.x.toFixed(9), +q.y.toFixed(9), +q.z.toFixed(9)]),
        diameter: p.dia,
        debug: this.debugMeshes && !this.state.freecad,
      }));
      try {
        const r = await fetch(this.url + '/pipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bars }),
        });
        const j = await r.json();
        (j.bars || []).forEach((b, i) => {
          if (!b || !b.ok || !b.vertices || !b.facets) return;
          this.cache.set(sig(paths[i].pts, paths[i].dia), {
            vertices: b.vertices, facets: b.facets,
            engine: b.debug ? 'python-debug' : 'freecad',
          });
        });
      } catch (e) { /* offline mid-flight: JS fallback */ }
    },

    // ---- model hook ------------------------------------------------------
    _orig: null,
    wrapModel() {
      if (this._orig || !window.Model) return;
      const py = this;
      this._orig = window.Model.prototype.addRebarPath;
      window.Model.prototype.addRebarPath = function (pts, diameter, opts) {
        const mesh = pts && pts.length >= 2 && (py.state.freecad || py.debugMeshes)
          ? py.cache.get(sig(pts, diameter)) : null;
        if (!mesh) return py._orig.call(this, pts, diameter, opts);
        return py.addMeshFaces(this, mesh, diameter, opts);
      };
    },
    unwrapModel() {
      if (!this._orig) return;
      window.Model.prototype.addRebarPath = this._orig;
      this._orig = null;
    },
    /** A tessellated bar as loose rebar faces (triangle rings, private
     *  hidden edges so the tube reads as a surface, not a wireframe). */
    addMeshFaces(model, mesh, dia, opts) {
      const ids = [];
      for (const facet of mesh.facets) {
        const ring = facet.map(k => {
          const p = mesh.vertices[k];
          return window.G.v(p[0], p[1], p[2]);
        });
        const f = model.addFaceFromRings(ring, [], { standalone: true });
        if (!f) continue;
        const meta = Object.assign({}, (opts && opts.meta) || {}, {
          engine: mesh.engine, diameter: dia,
          shape: ((opts && opts.meta) || {}).shape || 'pipe',
        });
        f.userData = Object.assign({}, f.userData || {}, { rebar: meta });
        f.color = (opts && opts.color) || '#a94442';
        // seam lines stay out of the view: the mesh IS the surface
        for (const r of model.rings(f))
          for (let i = 0; i < r.length; i++) {
            const e = model.findEdge(r[i], r[(i + 1) % r.length]);
            if (e) e.hidden = true;
          }
        ids.push(f.id);
      }
      return ids;
    },
  };

  PyEngine._sigForTest = sig;
  window.PyEngine = PyEngine;
  if (PyEngine.enabled) {
    PyEngine.wrapModel();
    PyEngine.probe().then(s => {
      if (window.app && s.online && s.freecad)
        window.app.toast('Python engine online — FreeCAD ' + (s.version || '') + ' builds the rebar');
    });
  }
})();
