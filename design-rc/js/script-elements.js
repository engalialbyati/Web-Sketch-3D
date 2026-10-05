'use strict';
// ---------------------------------------------------------------------------
// script-elements.js — Scripted Elements: user-coded parametric element types.
//
// The user gets code from THEIR OWN AI (Gemini, ChatGPT…) in a browser tab,
// copies it, and pastes it into the app's editor (command `script`). There is
// no AI in here — the app only supplies the CONTRACT (the copyable template
// below) so any AI knows what shape to write, then compiles and runs the
// pasted script against the real B-Rep kernel.
//
// A script is a JS expression returning:
//   ({
//     name: 'Fire Stair',
//     placement: 'direction',          // 'point' (1 click) | 'direction' (start+end)
//     params: [                        // → THE PROPERTIES PANEL (any params)
//       { id: 'steps', label: 'Steps', type: 'number', def: 16, min: 2, max: 80 },
//       { id: 'width', label: 'Width', type: 'length', def: 1.2 },
//       { id: 'style', label: 'Style', type: 'select', options: ['solid', 'open'] },
//       { id: 'rails', label: 'Rails', type: 'checkbox', def: true },
//     ],
//     build(c) { /* geometry from c.p + c.origin + c.dir */ },
//   })
//
// Scripts persist as SOURCE TEXT (IndexedDB `scripts` store, db.js v3) and
// recompile on load. Entities are ordinary bimEntities (type 'script'), so
// selection, undo, autosave and project files already carry them.
// ---------------------------------------------------------------------------
(function () {

  // ------------------------------------------------------------ the contract
  // This text is the copyable spec users hand to their AI. It must stay
  // complete, commented and runnable — it doubles as the starter template.
  const TEMPLATE = `({
  // ── WebSketch3D Scripted Element ─────────────────────────────────────
  // Give this whole template to your AI and tell it what to build.
  // It must return an object with: name, placement, params, build(c).
  //
  name: 'Hollow Box',              // shows in the Element Browser
  placement: 'point',              // 'point' = click once | 'direction' = click start + end (c.dir = the run direction)

  // Every param below becomes an editable field in the Properties panel.
  //   type: 'number' | 'length' (metres) | 'select' | 'checkbox'
  params: [
    { id: 'width',  label: 'Width',  type: 'length', def: 1.0, min: 0.1, max: 20 },
    { id: 'depth',  label: 'Depth',  type: 'length', def: 2.0, min: 0.1, max: 20 },
    { id: 'height', label: 'Height', type: 'length', def: 0.5, min: 0.05, max: 20 },
    { id: 'walls',  label: 'Wall thickness', type: 'length', def: 0.1, min: 0.01, max: 1 },
  ],

  // build() creates REAL solid geometry (B-Rep), not meshes.
  //   c.p            your params: c.p.width, c.p.height …
  //   c.origin       {x, y, z}  where the user clicked (z = ground/level)
  //   c.dir          {x, y}     unit run direction ('direction' placement; else {x:1, y:0})
  //   c.face(ring, holes?)  → a face from a closed ring of points (holes = array of rings)
  //   c.extrude(face, h)    → pull the face along its normal by h (negative goes the other way)
  //   c.normal(ring)        → the ring's normal {x,y,z} — orient rings so extrude goes the way you want
  //   c.role(faceId, 'tread')  label faces for the Properties panel
  //   c.G            the geometry helpers (G.v, G.add, G.sub, G.mul, G.norm, G.dist…)
  //   c.toast(msg)   tell the user something
  build(c) {
    const G = c.G, o = c.origin, d = c.dir;
    // unit vectors: along the run, across it, and up
    const D = G.v(d.x, d.y, 0), L = G.v(-d.y, d.x, 0), U = G.v(0, 0, 1);
    const at = (s, off, z) => G.v(o.x + D.x * s + L.x * off, o.y + D.y * s + L.y * off, o.z + z);
    const rect = (z) => [at(0, 0, z), at(c.p.depth, 0, z), at(c.p.depth, c.p.width, z), at(0, c.p.width, z)];
    const outer = c.face(rect(0));
    if (!c.extrude(outer, c.p.height)) { c.toast('extrude failed'); return; }
    c.role(outer.id, 'body');
  },
})`;

  // ---------------------------------------------------------- shipped examples
  // The Fire Stair is the reference implementation (ported from the user's
  // Three.js demo): steps RECOMPUTE when params change — a longer run with
  // the same riser makes MORE steps, each still real-world sized.
  const FIRE_STAIR = `({
  name: 'Fire Stair',
  placement: 'direction',
  params: [
    { id: 'steps',  label: 'Steps',        type: 'number',  def: 16, min: 2, max: 80 },
    { id: 'width',  label: 'Width',        type: 'length',  def: 1.2, min: 0.6, max: 3 },
    { id: 'rise',   label: 'Total Rise',   type: 'length',  def: 2.8, min: 0.4, max: 12 },
    { id: 'tread',  label: 'Tread Depth',  type: 'length',  def: 0.28, min: 0.2, max: 0.4 },
    { id: 'layout', label: 'Layout',       type: 'select',  options: ['straight', 'dog-leg'] },
    { id: 'landing', label: 'Top Landing', type: 'checkbox', def: true },
    { id: 'landingDepth', label: 'Landing Depth', type: 'length', def: 1.2, min: 0.6, max: 3 },
  ],
  build(c) {
    const G = c.G, o = c.origin, d = c.dir, p = c.p;
    const D = G.v(d.x, d.y, 0), L = G.v(-d.y, d.x, 0);
    const at = (s, off, z) => G.v(o.x + D.x * s + L.x * off, o.y + D.y * s + L.y * off, o.z + z);
    const n = Math.max(2, Math.round(p.steps));
    const riser = p.rise / n;
    // one sawtooth flight as a monolithic solid: the stepped profile ring
    // (riser → tread per step) extruded across the stair width. off shifts
    // it sideways (dog-leg flight 2 runs beside flight 1); dirSign flips the
    // run direction.
    const flight = (count, s0, z0, dirSign, off) => {
      const ring = [at(s0, off, z0)];
      for (let i = 1; i <= count; i++) {
        const z = z0 + riser * i;
        const s1 = s0 + dirSign * p.tread * (i - 1);
        ring.push(at(s1, off, z));                     // riser
        ring.push(at(s1 + dirSign * p.tread, off, z)); // tread
      }
      ring.push(at(s0 + dirSign * p.tread * count, off, z0)); // back drop
      if (G.dot(c.normal(ring), L) < 0) ring.reverse(); // extrude toward +L
      const f = c.face(ring);
      if (!c.extrude(f, p.width)) throw new Error('flight extrude failed');
      for (const fid of c.created()) c.role(fid, 'flight');
    };
    // horizontal slab (ring in plan at zTop, extruded DOWN by th)
    const slab = (s0, s1, off0, off1, zTop, th) => {
      const ring = [at(s0, off0, zTop), at(s1, off0, zTop), at(s1, off1, zTop), at(s0, off1, zTop)];
      const f = c.face(ring);
      if (!c.extrude(f, -th)) throw new Error('slab extrude failed');
    };
    if (p.layout === 'dog-leg') {
      const n1 = Math.ceil(n / 2), n2 = n - n1;
      const gap = 0.15;
      flight(n1, 0, 0, 1, 0);                                   // flight 1 up the +D side
      const midZ = riser * n1, midS = p.tread * n1;
      slab(midS, midS + p.landingDepth, 0, p.width * 2 + gap, midZ, 0.1); // rest landing
      flight(n2, midS + p.landingDepth, midZ, -1, p.width + gap);         // flight 2 back alongside
      // exit floor continuing past flight 2's arrival tread (no overlap)
      if (p.landing) {
        const sTop = midS + p.landingDepth - p.tread * n2; // flight 2's arrival
        slab(sTop - p.landingDepth, sTop, p.width + gap, p.width * 2 + gap, p.rise, 0.1);
      }
    } else {
      flight(n, 0, 0, 1, 0);
      if (p.landing) slab(p.tread * n, p.tread * n + p.landingDepth, 0, p.width, p.rise, 0.1);
    }
    c.toast(n + ' steps · riser ' + (riser * 1000).toFixed(0) + ' mm · tread ' + (p.tread * 1000).toFixed(0) + ' mm');
  },
})`;

  // Both layouts build; the Fire Stair is the reference implementation
  // (ported from the user's Three.js demo): steps RECOMPUTE when params
  // change — a longer rise with the same tread makes MORE steps.

  const RAILING = `({
  name: 'Railing',
  placement: 'direction',
  params: [
    { id: 'length', label: 'Length', type: 'length', def: 3.0, min: 0.2, max: 30 },
    { id: 'height', label: 'Height', type: 'length', def: 1.05, min: 0.5, max: 2 },
    { id: 'posts',  label: 'Posts',  type: 'number', def: 5, min: 2, max: 40 },
  ],
  build(c) {
    const G = c.G, o = c.origin, d = c.dir, p = c.p;
    const D = G.v(d.x, d.y, 0), N = G.v(-d.y, d.x, 0);
    const at = (s, off, z) => G.v(o.x + D.x * s + N.x * off, o.y + D.y * s + N.y * off, o.z + z);
    const box = (s0, s1, off0, off1, z0, z1) => {
      const ring = [at(s0, off0, z0), at(s1, off0, z0), at(s1, off1, z0), at(s0, off1, z0)];
      const f = c.face(ring);
      if (!c.extrude(f, z1 - z0)) throw new Error('box failed');
    };
    const n = Math.max(2, Math.round(p.posts));
    const t = 0.06; // post/rail thickness
    for (let i = 0; i < n; i++) {
      const s = p.length * i / (n - 1);
      box(s, s + t, 0, t, 0, p.height);                       // post
    }
    box(0, p.length, 0, t, p.height - t, p.height);           // top rail
  },
})`;

  const EXAMPLES = { 'Fire Stair': FIRE_STAIR, Railing: RAILING, 'Hollow Box (template)': TEMPLATE };

  // ------------------------------------------------------------- the manager
  const PARAM_TYPES = new Set(['number', 'length', 'select', 'checkbox']);

  class ScriptElementsManager {
    constructor(app) {
      this.app = app;
      this.scripts = new Map(); // id -> compiled script record
    }

    // ---------------------------------------------------------- compile
    // Compiles and validates pasted source. Never throws — returns
    // { script } or { error } (+line when derivable from the SyntaxError).
    compile(src) {
      let def = null;
      try { def = (new Function('return (' + src + ')'))(); }
      catch (e) { return { error: `Syntax error: ${e.message}` }; }
      if (!def || typeof def !== 'object' || Array.isArray(def))
        return { error: 'the code must return an object like ({ name, params, build }) — keep the outer parentheses' };
      const name = String(def.name || '').trim();
      if (!name) return { error: 'missing "name" (a short label, e.g. \'Fire Stair\')' };
      if (typeof def.build !== 'function')
        return { error: 'missing "build(c)" — the function that creates the geometry' };
      const params = this.normalizeParams(def.params);
      if (params.error) return params;
      return {
        script: {
          id: def.id || null, // assigned on save
          name,
          placement: def.placement === 'direction' ? 'direction' : 'point',
          params: params.list,
          build: def.build,
        },
      };
    }

    normalizeParams(raw) {
      if (raw == null) return { list: [] };
      if (!Array.isArray(raw)) return { error: '"params" must be an array of {id, label, type, def}' };
      const list = [];
      const seen = new Set();
      for (const p of raw) {
        if (!p || typeof p !== 'object') return { error: 'each param must be an object {id, label, type, def}' };
        const id = String(p.id || '').trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id))
          return { error: `param id "${id || '?'}" must be a valid name (letters/digits/_, not starting with a digit)` };
        if (seen.has(id)) return { error: `duplicate param id "${id}"` };
        seen.add(id);
        const type = PARAM_TYPES.has(p.type) ? p.type : 'number';
        const item = {
          id, label: String(p.label || id),
          type,
          def: type === 'checkbox' ? p.def !== false : (type === 'select'
            ? (p.options && p.options.length ? String(p.options.includes(p.def) ? p.def : p.options[0]) : '')
            : (+p.def || 0)),
        };
        if (type === 'number' || type === 'length') {
          if (p.min != null && isFinite(+p.min)) item.min = +p.min;
          if (p.max != null && isFinite(+p.max)) item.max = +p.max;
          if (item.min != null && item.def < item.min) item.def = item.min;
          if (item.max != null && item.def > item.max) item.def = item.max;
        }
        if (type === 'select') {
          item.options = (p.options || []).map(x => String(x));
          if (!item.options.length) return { error: `select param "${id}" needs options: [...]` };
        }
        list.push(item);
      }
      return { list };
    }

    defaultValues(script) {
      const v = {};
      for (const p of script.params) v[p.id] = p.def;
      return v;
    }
    coerceValue(param, raw) {
      if (param.type === 'checkbox') return !!raw;
      if (param.type === 'select') return param.options.includes(raw) ? raw : param.options[0];
      let v = +raw;
      if (!isFinite(v)) v = param.def;
      if (param.min != null) v = Math.max(param.min, v);
      if (param.max != null) v = Math.min(param.max, v);
      return v;
    }

    // ------------------------------------------------------------- build
    // Runs the script's build() against the model, tracking everything it
    // creates by diffing the kernel. Throws on script errors (the caller's
    // transaction rolls the partial geometry back).
    buildInto(model, script, values, placement, opts = {}) {
      const G = window.G;
      const app = this.app;
      const facesBefore = new Set(model.faces.keys());
      const edgesBefore = new Set(model.edges.keys());
      const roles = {};
      let toasts = 0;
      const c = {
        G,
        model,
        p: {},
        origin: { x: placement.base[0], y: placement.base[1], z: placement.base[2] },
        dir: placement.end
          ? (() => {
            const dx = placement.end[0] - placement.base[0], dy = placement.end[1] - placement.base[1];
            const L2 = Math.hypot(dx, dy) || 1;
            return { x: dx / L2, y: dy / L2 };
          })()
          : { x: 1, y: 0 },
        face: (ring, holes) => model.addFaceFromRings(ring, holes),
        // forceBaseCap defaults ON: scripts want solids, and a downward
        // extrude without a base cap would be an open shell (floor precedent)
        extrude: (face, h, forceBaseCap) => !!model.pushPull(face, h, forceBaseCap === false ? false : true),
        normal: ring => G.loopNormal(ring),
        role: (fid, role) => { roles[fid] = String(role || 'body'); },
        created: () => [...model.faces.keys()].filter(id => !facesBefore.has(id)),
        // preview builds (drag ghosts) run many times a second — a script
        // that toasts would spam the DOM at mousemove rate, so they are muted
        toast: (msg, isErr) => { if (!opts.preview && toasts++ < 3) app.toast(String(msg), !!isErr); },
      };
      for (const p of script.params) c.p[p.id] = this.coerceValue(p, values[p.id]);
      try {
        script.build(c);
      } catch (e) {
        throw new Error(`script build failed: ${e && e.message ? e.message : e}`);
      }
      const faces = [...model.faces.keys()].filter(id => !facesBefore.has(id)).map(id => model.faces.get(id));
      if (!faces.length) throw new Error('the script created no geometry');
      const edges = [...model.edges.keys()].filter(id => !edgesBefore.has(id));
      // bim.create() derives the entity's face list from the roles map —
      // every created face must appear (unlabeled ones are the 'body')
      for (const f of faces) {
        if (!roles[f.id]) roles[f.id] = 'body';
        f.userData = { bimEntityId: '__pending__', bimType: 'script', role: roles[f.id] };
      }
      return { faces, edges, roles };
    }

    // Place a new instance (the tool's commit path).
    place(scriptId, values, placement) {
      const script = this.scripts.get(scriptId);
      if (!script) { this.app.toast('That script no longer exists — re-save it in the editor', true); return null; }
      const app = this.app, m = app.model;
      let rec = null;
      app.run('place ' + script.name, () => {
        m.bimHold = true;
        let built;
        try {
          built = this.buildInto(m, script, values, placement);
        } finally { m.bimHold = false; }
        const ent = app.bim.create('script', {
          scriptId, scriptName: script.name,
          placement: { base: [...placement.base], end: placement.end ? [...placement.end] : null },
          values: { ...values },
        }, built.roles, built.edges);
        rec = ent;
      });
      return rec;
    }

    // Regenerate an existing entity (property edits). Runs inside the
    // caller's transaction; throws (→ rollback) on script failure.
    rebuildEntity(id, patch = {}) {
      const app = this.app, m = app.model;
      const ent = app.bim.getEntityById(id);
      if (!ent || ent.type !== 'script') throw new Error('not a scripted element');
      const script = this.scripts.get(ent.params.scriptId);
      if (!script) throw new Error(`script "${ent.params.scriptName || ent.params.scriptId}" is missing — re-save it`);
      const values = {};
      for (const p of script.params)
        values[p.id] = this.coerceValue(p, (patch.values && patch.values[p.id]) != null
          ? patch.values[p.id] : ent.params.values[p.id]);
      const placement = patch.placement || ent.params.placement;
      m.bimHold = true;
      try {
        for (const fid of [...ent.faces]) m.faces.delete(fid);
        for (const eid of [...ent.edges]) m.edges.delete(eid);
        m.gc();
        // deleting recorded edges can remove edges shared with surviving
        // geometry — recreate ring edges survivors still need (wall precedent)
        for (const f2 of m.faces.values()) {
          m.edgesForRing(f2.loop, true);
          for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
        }
        const built = this.buildInto(m, script, values, placement);
        ent.params.values = values;
        ent.params.placement = placement;
        ent.params.scriptName = script.name;
        ent.faces = built.faces.map(f => f.id);
        ent.edges = [...built.edges];
        for (const fid of ent.faces) {
          const f3 = m.faces.get(fid);
          f3.userData = { bimEntityId: id, bimType: 'script', role: built.roles[fid] || 'body' };
        }
        return true;
      } finally {
        m.bimHold = false;
      }
    }

    // -------------------------------------------------------- persistence
    async loadAll() {
      if (!this.app.db) return;
      try {
        const rows = await this.app.db.getAllScripts();
        for (const row of rows) {
          const r = this.compile(row.src);
          if (r.error) { console.warn(`[scripts] "${row.name}" failed to compile: ${r.error}`); continue; }
          r.script.id = row.id;
          r.script.src = row.src; // Edit Script needs the source text back
          this.scripts.set(row.id, r.script);
        }
      } catch (e) { /* store may not exist yet (pre-v3 db) */ }
    }
    get(id) { return this.scripts.get(id) || null; }
    list() { return [...this.scripts.values()]; }

    // Validate → persist source → register compiled → catalog type.
    async save(src, existingId = null) {
      const app = this.app;
      const r = this.compile(src);
      if (r.error) { app.toast(r.error, true); return null; }
      const script = r.script;
      // dry-run against a scratch model: runtime errors surface at save
      // time, not on first placement
      try {
        const scratch = new Model();
        scratch.bimHold = true;
        this.buildInto(scratch, script, this.defaultValues(script),
          { base: [0, 0, 0], end: script.placement === 'direction' ? [3, 0, 0] : null });
      } catch (e) {
        app.toast(`Check failed: ${e.message}`, true);
        return null;
      }
      const id = existingId || ('scr_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e4).toString(36));
      script.id = id;
      script.src = src;
      try {
        await app.db.putScript({ id, name: script.name, src, updatedAt: Date.now() });
      } catch (e) { app.toast('Could not save the script: ' + e.message, true); return null; }
      this.scripts.set(id, script);
      await this.ensureCatalogType(script);
      app.toast(`“${script.name}” saved — it is in the Element Browser under Scripted`);
      if (window.ElementBrowser && ElementBrowser.refresh) ElementBrowser.refresh();
      return script;
    }

    async ensureCatalogType(script) {
      const app = this.app;
      if (!app.db) return;
      try {
        const cats = await app.db.getCatalog();
        let cat = cats.categories.find(c => c.id === 'cat_scripted');
        if (!cat) { cat = { id: 'cat_scripted', name: 'Scripted' }; await app.db.putCategory(cat); }
        const famId = 'fam_scripted_' + script.id;
        if (!cats.families.some(f => f.id === famId))
          await app.db.putFamily({ id: famId, categoryId: cat.id, name: script.name });
        const params = { scriptId: script.id, scriptName: script.name };
        for (const p of script.params) params[p.id] = p.def;
        await app.db.ensureType(famId, script.name, params);
      } catch (e) { /* catalog is a convenience — never block the save */ }
    }

    // ------------------------------------------------------------ editor
    openEditor(existingId = null) {
      const app = this.app;
      const existing = existingId ? this.scripts.get(existingId) : null;
      const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      app.dialog(existing ? `Edit Script — ${esc(existing.name)}` : 'Scripted Element — paste code from your AI', `
        <div style="font-size:12px;color:#6a7178;margin-bottom:8px">
          Ask your AI (Gemini, ChatGPT…) for an element, give it the template, then paste the code below.
          <b>Check</b> compiles and test-builds it; <b>Preview</b> shows it in the viewport;
          <b>Accept & Add</b> saves it into the Element Browser.
        </div>
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
          <button class="mini-btn" id="scr-copy">Copy Template</button>
          <button class="mini-btn" id="scr-ex-fire">Insert: Fire Stair</button>
          <button class="mini-btn" id="scr-ex-rail">Insert: Railing</button>
          <button class="mini-btn" id="scr-check">Check</button>
          <button class="mini-btn" id="scr-preview">Preview</button>
          <button class="mini-btn" id="scr-accept" style="color:#1d6b3a;border-color:#1d6b3a">✓ Accept & Add</button>
        </div>
        <textarea id="scr-src" spellcheck="false" autocomplete="off"
          style="width:100%;height:340px;font:12px/1.5 ui-monospace,Menlo,monospace;border:1px solid #c3c9cf;border-radius:6px;padding:8px;box-sizing:border-box;white-space:pre;tab-size:2">${esc(existing ? (existing.src || '') : '')}</textarea>
        <div id="scr-msg" style="font-size:12px;margin-top:6px;min-height:18px;color:#6a7178"></div>`,
        [['Close', null], ['Save', () => {
          const src = document.getElementById('scr-src').value;
          this.save(src, existingId);
        }]]);
      const $ = id => document.getElementById(id);
      $('scr-copy').addEventListener('click', () => {
        const t = TEMPLATE;
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject())
          .then(() => { $('scr-msg').textContent = 'Template copied — paste it to your AI with one line about what to build.'; $('scr-msg').style.color = '#1d6b3a'; })
          .catch(() => { $('scr-src').value = t; $('scr-msg').textContent = 'Clipboard blocked — template inserted below instead (copy it manually).'; });
      });
      $('scr-ex-fire').addEventListener('click', () => { $('scr-src').value = FIRE_STAIR; $('scr-msg').textContent = 'Fire Stair example inserted — Check it, or edit and re-Check.'; });
      $('scr-ex-rail').addEventListener('click', () => { $('scr-src').value = RAILING; $('scr-msg').textContent = 'Railing example inserted.'; });
      $('scr-check').addEventListener('click', () => {
        const r = this.compile($('scr-src').value);
        if (r.error) { $('scr-msg').textContent = '✗ ' + r.error; $('scr-msg').style.color = '#c5221f'; return; }
        try {
          const scratch = new Model();
          scratch.bimHold = true;
          this.buildInto(scratch, r.script, this.defaultValues(r.script),
            { base: [0, 0, 0], end: r.script.placement === 'direction' ? [3, 0, 0] : null });
          $('scr-msg').textContent = `✓ “${r.script.name}” builds: ${r.script.params.length} params, placement '${r.script.placement}'. Save to add it to the browser.`;
          $('scr-msg').style.color = '#1d6b3a';
        } catch (e) {
          $('scr-msg').textContent = '✗ ' + e.message;
          $('scr-msg').style.color = '#c5221f';
        }
      });
      // PREVIEW — build the script into a scratch model and show it as a ghost
      // in the live viewport: the user SEES the element before accepting it.
      // ACCEPT — the previewed build is what gets saved (what you saw is what
      // you add); the Element Browser refreshes and the ghost clears.
      const drawPreview = () => {
        const r = this.compile($('scr-src').value);
        if (r.error) { $('scr-msg').textContent = '✗ ' + r.error; $('scr-msg').style.color = '#c5221f'; return false; }
        try {
          const scratch = new Model();
          scratch.bimHold = true;
          const built = this.buildInto(scratch, r.script, this.defaultValues(r.script),
            { base: [0, 0, 0], end: r.script.placement === 'direction' ? [3, 0, 0] : null });
          app.view.clearPreview();
          for (const f of built.faces) {
            for (const ring of scratch.rings(f)) {
              const pts = scratch.pts(ring);
              app.view.previewLine(pts, 0xd946ef);
            }
          }
          this._previewOk = true;
          $('scr-msg').textContent = `✓ Previewing “${r.script.name}” at the origin — ${built.faces.length} faces. Accept & Add to keep it, or edit and Preview again.`;
          $('scr-msg').style.color = '#1d6b3a';
          return true;
        } catch (e) {
          $('scr-msg').textContent = '✗ ' + e.message;
          $('scr-msg').style.color = '#c5221f';
          return false;
        }
      };
      $('scr-preview').addEventListener('click', () => { this._previewOk = false; drawPreview(); });
      $('scr-accept').addEventListener('click', () => {
        if (!this._previewOk && !drawPreview()) return;
        const src = document.getElementById('scr-src').value;
        this.save(src, existingId);
        app.view.clearPreview();
        this._previewOk = false;
        app.toast('Script accepted — find it under “Scripted” in the Element Browser');
        app.closeDialog();
      });
      $('scr-src').addEventListener('keydown', ev => {
        ev.stopPropagation(); // typing here must not reach app hotkeys / VCB
        if (ev.key === 'Tab') {
          ev.preventDefault();
          const t = ev.target, s = t.selectionStart;
          t.value = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
          t.selectionStart = t.selectionEnd = s + 2;
        }
      });
    }
  }

  window.ScriptElements = {
    Manager: ScriptElementsManager,
    TEMPLATE, FIRE_STAIR, RAILING, EXAMPLES,
  };

  // command palette entry (`script` / `scripts`) — an Engine command
  // feature, so the palette and the SDK surface pick it up automatically
  if (window.Engine) {
    try {
      Engine.features.register({
        id: 'scripted-elements',
        kind: 'command',
        label: 'Scripted Element — paste code from your AI',
        commands: ['script', 'scripts'],
        run(app) { if (app.scriptElements) app.scriptElements.openEditor(); },
      });
    } catch (e) { console.warn('[scripts] command registration failed:', e); }
  }
})();
