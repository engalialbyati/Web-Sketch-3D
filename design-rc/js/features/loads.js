'use strict';
// features/loads.js — ETABS-style load workflow.
//   Define → Load Patterns: named patterns (Dead/Live/Wind/Snow/...), each
//   with a self-weight multiplier and optional default slab/wall pressures.
//   Assign → Loads to Selection: uniform member loads (kN/m) on selected
//   columns/beams and surface pressures (kPa) on selected slabs/walls, each
//   bound to a pattern with a global direction. Assignments live on
//   entity params so they persist, and StructuralAnalysis.buildLoads turns
//   them into consistent FE loads combined per ACI 318-19.
(function () {
  const TYPES = ['dead', 'live', 'wind', 'snow', 'roof', 'other'];

  function nextPatternId(patterns) {
    let n = patterns.length + 1;
    while (patterns.some(p => p.id === 'P' + n)) n++;
    return 'P' + n;
  }

  // ---------------------------------------------------- Define Load Patterns
  function patternsDialog(app) {
    const SA = window.StructuralAnalysis;
    if (!SA) { app.toast('Analysis module not loaded', true); return; }
    const patterns = SA.getPatterns(app).map(p => ({ ...p }));
    const render = () => {
      const rows = patterns.map((p, i) => `
        <tr>
          <td><input data-f="id" data-i="${i}" value="${p.id}" style="width:52px" ${p.id === 'DL' ? 'disabled title="self-weight anchor"' : ''}></td>
          <td><input data-f="name" data-i="${i}" value="${p.name}" style="width:130px"></td>
          <td><select data-f="type" data-i="${i}">${TYPES.map(t => `<option value="${t}" ${p.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
          <td><input type="number" data-f="swMult" data-i="${i}" value="${p.swMult}" step="0.1" min="0" style="width:56px"></td>
          <td><input type="number" data-f="slab" data-i="${i}" value="${p.slab}" step="0.25" min="0" style="width:64px" title="default pressure on slabs without an explicit assignment"></td>
          <td><input type="number" data-f="wall" data-i="${i}" value="${p.wall}" step="0.25" min="0" style="width:64px" title="default pressure on walls without an explicit assignment"></td>
          <td><button data-del="${i}" class="btn small" ${['DL', 'SDL', 'LL', 'WL'].includes(p.id) ? 'disabled title="built-in"' : ''}>✕</button></td>
        </tr>`).join('');
      return `
        <div class="dim" style="margin:0 0 8px">
          Patterns group into the ACI 318-19 §5.3.1 combinations automatically
          (dead→D, live→L, wind→W, snow/roof→S). Self-weight multiplier adds
          element weight to the pattern; default pressures apply to unassigned
          slabs/walls only.
        </div>
        <table class="ob-table" style="width:100%;border-collapse:collapse;font-size:11px">
          <tr style="text-align:left"><th>Id</th><th>Name</th><th>Type</th><th>SW ×</th><th>Slab kPa</th><th>Wall kPa</th><th></th></tr>
          ${rows}
        </table>
        <div style="margin-top:8px"><button id="lp-add" class="btn small">+ Add Pattern</button></div>`;
    };
    app.dialog('Define Load Patterns', render(), [
      ['Cancel', null],
      ['Save Patterns', () => {
        // read current editor state
        const root = document.querySelector('#dialog .dialog-body') || document;
        root.querySelectorAll('[data-f]').forEach(el => {
          const p = patterns[+el.dataset.i];
          if (!p) return;
          const f = el.dataset.f;
          p[f] = (f === 'name' || f === 'type' || f === 'id') ? el.value : (parseFloat(el.value) || 0);
        });
        if (new Set(patterns.map(p => p.id)).size !== patterns.length) {
          app.toast('Pattern ids must be unique', true);
          return false;
        }
        app.model.loadPatterns = patterns;
        app.toast(patterns.length + ' load patterns saved');
        return true;
      }],
    ]);
    // live editor wiring (add/delete rows re-render the dialog body)
    const wire = () => {
      const root = document.querySelector('#dialog .dialog-body') || document;
      const add = root.querySelector('#lp-add');
      if (add) add.onclick = () => {
        patterns.push({ id: nextPatternId(patterns), name: 'Pattern ' + patterns.length, type: 'other', swMult: 0, slab: 0, wall: 0 });
        rerender();
      };
      root.querySelectorAll('[data-del]').forEach(b => {
        b.onclick = () => { patterns.splice(+b.dataset.del, 1); rerender(); };
      });
    };
    const rerender = () => {
      const root = document.querySelector('#dialog .dialog-body');
      if (!root) return;
      root.innerHTML = render();
      wire();
    };
    setTimeout(wire, 0);
  }

  // ------------------------------------------------ Assign Loads to Selection
  function selectedEntities(app) {
    const out = new Map();
    for (const fid of app.sel.faces) {
      const ent = app.elementForFace(fid);
      if (ent) out.set(ent.id, ent);
    }
    return [...out.values()];
  }

  function assignDialog(app) {
    const SA = window.StructuralAnalysis;
    if (!SA) { app.toast('Analysis module not loaded', true); return; }
    const ents = selectedEntities(app);
    const frames = ents.filter(e => ['column', 'beam', 'brace'].includes(e.type));
    const shells = ents.filter(e => ['floor', 'slab', 'wall', 'shearwall'].includes(e.type));
    if (!frames.length && !shells.length) {
      app.toast('Select columns, beams, slabs or walls first', true);
      return;
    }
    const patterns = SA.getPatterns(app);
    const opts = patterns.map(p => `<option value="${p.id}">${p.id} — ${p.name}</option>`).join('');
    const dirOpts = `<option value="gravity">Gravity (−Z)</option><option value="+x">+X</option><option value="-x">−X</option><option value="+y">+Y</option><option value="-y">−Y</option><option value="+z">+Z</option>`;
    // existing assignments on the selection
    const existing = [];
    for (const e of ents) {
      for (const a of ((e.params && e.params.loads) || [])) {
        existing.push({ ent: e, a });
      }
    }
    const listRows = existing.map((x, i) => `
      <tr><td>${x.ent.type}</td><td>${x.a.pattern}</td>
      <td>${x.a.kind === 'udl' ? x.a.w + ' kN/m' : x.a.q + ' kPa'}</td>
      <td>${x.a.dir || 'gravity'}</td>
      <td><button data-rm="${i}" class="btn small">✕</button></td></tr>`).join('');
    app.dialog('Assign Loads — ' + frames.length + ' frame / ' + shells.length + ' area element(s) selected', `
      <div class="dim" style="margin:0 0 8px">Loads are assigned per load pattern and applied in a global direction, ETABS-style. Frame loads are uniform (kN/m); area loads are uniform pressure (kPa).</div>
      <div class="form-row"><label>Load pattern</label><select id="la-pat">${opts}</select></div>
      <div class="form-row"><label>Direction</label><select id="la-dir">${dirOpts}</select></div>
      ${frames.length ? `<div class="form-row"><label>Frame load (kN/m)</label><input type="number" id="la-w" step="0.5" value="10" style="width:90px">
        <button id="la-frame" class="btn small">Assign to ${frames.length} frame(s)</button></div>` : ''}
      ${shells.length ? `<div class="form-row"><label>Area pressure (kPa)</label><input type="number" id="la-q" step="0.25" value="2" style="width:90px">
        <button id="la-shell" class="btn small">Assign to ${shells.length} area(s)</button></div>` : ''}
      ${existing.length ? `<table class="ob-table" style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px">
        <tr style="text-align:left"><th>Element</th><th>Pattern</th><th>Magnitude</th><th>Direction</th><th></th></tr>${listRows}</table>` : ''}
    `, [
      ['Close', null],
      ['Clear All on Selection', () => {
        for (const e of ents) if (e.params) delete e.params.loads;
        app.toast('Load assignments cleared');
        return true;
      }],
    ]);
    setTimeout(() => {
      const pat = () => document.getElementById('la-pat').value;
      const dir = () => document.getElementById('la-dir').value;
      const fb = document.getElementById('la-frame');
      if (fb) fb.onclick = () => {
        const w = parseFloat(document.getElementById('la-w').value) || 0;
        for (const e of frames) {
          e.params.loads = (e.params.loads || []).filter(a => !(a.pattern === pat() && a.kind === 'udl'));
          e.params.loads.push({ pattern: pat(), kind: 'udl', w, dir: dir() });
        }
        app.toast('UDL ' + w + ' kN/m (' + pat() + ') assigned to ' + frames.length + ' element(s)');
        app.closeDialog();
      };
      const sb = document.getElementById('la-shell');
      if (sb) sb.onclick = () => {
        const q = parseFloat(document.getElementById('la-q').value) || 0;
        for (const e of shells) {
          e.params.loads = (e.params.loads || []).filter(a => !(a.pattern === pat() && a.kind === 'pressure'));
          e.params.loads.push({ pattern: pat(), kind: 'pressure', q, dir: dir() });
        }
        app.toast('Pressure ' + q + ' kPa (' + pat() + ') assigned to ' + shells.length + ' element(s)');
        app.closeDialog();
      };
      document.querySelectorAll('[data-rm]').forEach(b => {
        b.onclick = () => {
          const x = existing[+b.dataset.rm];
          if (x && x.ent.params && x.ent.params.loads) {
            x.ent.params.loads = x.ent.params.loads.filter(a => a !== x.a);
            app.closeDialog();
            assignDialog(app); // re-open with the fresh list
          }
        };
      });
    }, 0);
  }

  window.LoadsUI = { patternsDialog, assignDialog, selectedEntities };
})();
