'use strict';
// ---------------------------------------------------------------------------
// Feature: Walkthrough — Walk (WASD at eye height) and Look Around.
//
// First-person navigation mapped onto the orbit camera: eye position E and
// view direction D become target = E + D·k, dist = k, az/el = spherical of
// −D — the camera lands exactly at E looking along D, and Esc returns to
// normal orbit (target stays put). Drag to look, Shift = run,
// R/F (or Q/E) move the eye up/down. Look Around pivots in place.
//
// View ▸ Walk / View ▸ Look Around. Commands: walk, lookaround.
// ---------------------------------------------------------------------------
(function () {
  if (!window.Engine || !window.Tool) return;

  const EYE = 1.65; // m

  function lookAngles(fp) {
    const D = {
      x: Math.cos(fp.pitch) * Math.cos(fp.yaw),
      y: Math.cos(fp.pitch) * Math.sin(fp.yaw),
      z: Math.sin(fp.pitch),
    };
    return { D };
  }
  function applyFP(app, fp) {
    const view = app.view, cam = view.cam;
    const { D } = lookAngles(fp);
    const k = 0.05;
    cam.ortho = false;
    cam.target = { x: fp.pos.x + D.x * k, y: fp.pos.y + D.y * k, z: fp.pos.z + D.z * k };
    cam.dist = k;
    cam.el = Math.asin(Math.max(-0.999, Math.min(0.999, -D.z)));
    cam.az = Math.atan2(-D.y, -D.x);
    view.viewLocked = false;
    view.applyCamera();
    view.invalidate();
  }
  function fromCamera(app) {
    // enter walkthrough from the current view: eye = camera position,
    // look direction = camera→target
    const cam = app.view.cam;
    const len = Math.max(cam.dist, 1e-6);
    const dir = {
      x: (cam.target.x - (cam.target.x + len * 0)) / len, // computed below properly
      y: 0, z: 0,
    };
    // camera position from spherical (mirror of applyCamera)
    const px = cam.target.x + len * Math.cos(cam.el) * Math.cos(cam.az);
    const py = cam.target.y + len * Math.cos(cam.el) * Math.sin(cam.az);
    const pz = cam.target.z + len * Math.sin(cam.el);
    const D = { x: (cam.target.x - px) / len, y: (cam.target.y - py) / len, z: (cam.target.z - pz) / len };
    return {
      pos: { x: px, y: py, z: Math.max(pz, EYE) },
      yaw: Math.atan2(D.y, D.x),
      pitch: Math.asin(Math.max(-0.999, Math.min(0.999, D.z))),
    };
  }

  class WalkBaseTool extends Tool {
    constructor(app) { super(app); this.fp = null; this._keys = new Set(); this._last = 0; this._raf = 0; }
    get moves() { return true; } // Walk moves; Look Around overrides
    activate() {
      this.fp = fromCamera(this.app);
      this._bind();
      this.status();
    }
    cleanup() { super.cleanup(); this._unbind(); }
    _bind() {
      const c = this.app.view.canvas;
      this._onDown = ev => { this._drag = { x: ev.clientX, y: ev.clientY }; };
      this._onMove = ev => {
        if (!this._drag) return;
        const dx = ev.clientX - this._drag.x, dy = ev.clientY - this._drag.y;
        this._drag = { x: ev.clientX, y: ev.clientY };
        this.fp.yaw -= dx * 0.0045;
        this.fp.pitch = Math.max(-1.45, Math.min(1.45, this.fp.pitch + dy * 0.0045));
        applyFP(this.app, this.fp);
      };
      this._onUp = () => { this._drag = null; };
      this._onKey = ev => {
        if (ev.repeat && this._keys.has(ev.code)) return;
        this._keys.add(ev.code);
        if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') return;
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.code)) ev.preventDefault();
      };
      this._onKeyUp = ev => this._keys.delete(ev.code);
      c.addEventListener('pointerdown', this._onDown);
      window.addEventListener('pointermove', this._onMove);
      window.addEventListener('pointerup', this._onUp);
      window.addEventListener('keydown', this._onKey);
      window.addEventListener('keyup', this._onKeyUp);
      const loop = t => {
        this._step(t);
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }
    _unbind() {
      cancelAnimationFrame(this._raf);
      const c = this.app.view && this.app.view.canvas;
      if (c) c.removeEventListener('pointerdown', this._onDown);
      window.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('pointerup', this._onUp);
      window.removeEventListener('keydown', this._onKey);
      window.removeEventListener('keyup', this._onKeyUp);
    }
    _step(t) {
      if (!this._last) this._last = t;
      const dt = Math.min(0.05, (t - this._last) / 1000);
      this._last = t;
      const run = this._keys.has('ShiftLeft') || this._keys.has('ShiftRight') ? 3 : 1;
      const v = 1.8 * run * dt; // m/s
      const k = this._keys;
      let mx = 0, my = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) mx += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) mx -= 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) my -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) my += 1;
      let changed = false;
      if (mx || my) {
        const c = Math.cos(this.fp.yaw), s = Math.sin(this.fp.yaw);
        this.fp.pos.x += (mx * c - my * s) * v;
        this.fp.pos.y += (mx * s + my * c) * v;
        changed = true;
      }
      if (this.moves) {
        if (k.has('KeyR') || k.has('KeyE')) { this.fp.pos.z += v; changed = true; }
        if (k.has('KeyF') || k.has('KeyQ')) { this.fp.pos.z -= v; changed = true; }
      }
      if (changed) applyFP(this.app, this.fp);
    }
    get hint() {
      return this.moves
        ? 'Walk: W/A/S/D (or arrows) to move at eye height · drag to look · Shift runs · R/F up-down · Esc returns to orbit'
        : 'Look Around: drag to pivot in place · Esc returns to orbit';
    }
  }

  class WalkTool extends WalkBaseTool { static id = 'walk'; }
  class LookAroundTool extends WalkBaseTool {
    static id = 'lookaround';
    get moves() { return false; }
  }

  Engine.features.register({
    id: 'walk', kind: 'tool', label: 'Walk', mode: 'free', tool: WalkTool,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="13" cy="4.5" r="1.8"/><path d="M11 21l1.5-6-2.5-3 1-4.5 3 2 3 .5"/><path d="M10 12l-4 2"/></svg>',
    commands: ['walk', 'walkthrough'],
  });
  Engine.features.register({
    id: 'lookaround', kind: 'tool', label: 'Look Around', mode: 'free', tool: LookAroundTool,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><path d="M2 12h3M19 12h3M12 2v3M12 19v3"/></svg>',
    commands: ['lookaround', 'look around'],
  });
})();
