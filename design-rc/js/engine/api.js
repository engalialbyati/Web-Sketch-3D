'use strict';
// ---------------------------------------------------------------------------
// Engine SDK — the extension surface of the drawing engine.
//
//   Engine.events    pub/sub bus with listener isolation (push invalidation)
//   Engine.features  declarative feature registry (tools get ribbon button,
//                    command aliases, options-bar fields, undo labels for free)
//   Engine.txGuard   validate-on-commit: structural errors roll the edit back
//
// Features depend ONLY on this file plus the public app surface
// (app.run / app.model / app.view / tool lifecycle). See docs/ARCHITECTURE.md.
// ---------------------------------------------------------------------------
window.Engine = (function () {

  // ------------------------------------------------------------- event bus
  class EventBus {
    constructor() { this._subs = new Map(); }
    /** Subscribe. Returns an unsubscribe function. */
    on(evt, fn) {
      if (typeof evt !== 'string' || typeof fn !== 'function')
        throw new Error('Engine.events.on(event, fn): bad arguments');
      if (!this._subs.has(evt)) this._subs.set(evt, new Set());
      this._subs.get(evt).add(fn);
      return () => this._subs.get(evt)?.delete(fn);
    }
    /** Emit synchronously. A throwing listener is logged, never propagated. */
    emit(evt, payload) {
      const subs = this._subs.get(evt);
      if (!subs) return;
      for (const fn of [...subs]) {
        try { fn(payload); }
        catch (e) { console.error(`[engine] ${evt} listener failed:`, e); }
      }
    }
    listenerCount(evt) { return (this._subs.get(evt) || { size: 0 }).size; }
  }

  // ------------------------------------------------------ feature registry
  const OPTION_TYPES = new Set(['number', 'select', 'checkbox', 'chips']);
  function validateDescriptor(d) {
    const errs = [];
    if (!d || typeof d !== 'object') return ['descriptor must be an object'];
    if (!d.id || typeof d.id !== 'string') errs.push('id (string) required');
    if (!d.label || typeof d.label !== 'string') errs.push('label (string) required');
    if (d.kind !== 'tool' && d.kind !== 'panel' && d.kind !== 'command')
      errs.push("kind must be 'tool' | 'panel' | 'command'");
    if (d.kind === 'tool') {
      if (!d.tool || typeof d.tool !== 'function') errs.push('tool (class) required for kind:"tool"');
      if (d.tool && (!d.tool.prototype || typeof d.tool.prototype.onDown !== 'function' || typeof d.tool.prototype.onMove !== 'function'))
        errs.push('tool class must implement the Tool lifecycle (onDown/onMove)');
      if (d.mode !== 'free' && d.mode !== 'bim') errs.push("mode must be 'free' | 'bim'");
    }
    if (d.options) {
      if (!Array.isArray(d.options)) errs.push('options must be an array');
      else for (const o of d.options) {
        if (!o || typeof o !== 'object' || !o.key || !OPTION_TYPES.has(o.type))
          { errs.push(`bad option {key, type: ${[...OPTION_TYPES].join('|')}}`); break; }
        if ((o.type === 'select' || o.type === 'chips') && !Array.isArray(o.choices))
          errs.push(`option "${o.key}": ${o.type} needs choices`);
      }
    }
    if (d.commands && !Array.isArray(d.commands)) errs.push('commands must be an array of strings');
    return errs;
  }

  class FeatureRegistry {
    constructor() { this._byId = new Map(); this.events = new EventBus(); }
    /** Register a feature descriptor. Throws on invalid/duplicate input. */
    register(d) {
      const errs = validateDescriptor(d);
      if (errs.length) throw new Error(`[engine] feature refused: ${errs.join('; ')}`);
      if (this._byId.has(d.id)) throw new Error(`[engine] feature "${d.id}" already registered`);
      this._byId.set(d.id, d);
      this.events.emit('registered', d);
      Engine.events.emit('feature:registered', d);
      return d;
    }
    get(id) { return this._byId.get(id) || null; }
    list(kind) { return [...this._byId.values()].filter(d => !kind || d.kind === kind); }
    get size() { return this._byId.size; }
  }

  // ---------------------------------------------------------------- facade
  const events = new EventBus();
  const features = new FeatureRegistry();

  const Engine = {
    events,
    features,
    app: null,           // bound at boot by app.js
    txGuard: true,       // validate-on-commit (structural errors roll back)

    /** Called once by the app after construction; wires the emission points. */
    bind(app) {
      this.app = app;
      const emit = (evt, payload) => events.emit(evt, payload);
      // push invalidation: the UI listens instead of polling where it can
      const origOpDone = app.opDone.bind(app);
      app.opDone = (...a) => { const r = origOpDone(...a); emit('model:changed', { source: 'opDone' }); return r; };
      const origSetTool = app.setTool.bind(app);
      app.setTool = (id, ...a) => { const r = origSetTool(id, ...a); emit('tool:changed', { id }); return r; };
      const origUndo = app.undo.bind(app);
      app.undo = (...a) => { const r = origUndo(...a); emit('model:changed', { source: 'undo' }); return r; };
      const origRedo = app.redo.bind(app);
      app.redo = (...a) => { const r = origRedo(...a); emit('model:changed', { source: 'redo' }); return r; };
      const origSetMode = app.setMode.bind(app);
      app.setMode = (m, ...a) => { const r = origSetMode(m, ...a); emit('mode:changed', { mode: m }); return r; };
      const origSelect = app.selectFaces ? app.selectFaces.bind(app) : null;
      emit('ready', { features: features.size });
    },
  };

  return Engine;
})();
