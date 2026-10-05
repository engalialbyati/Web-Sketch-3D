'use strict';
// features/etabs.js — the ETABS modeling workflow on top of the structural app.
//   New Building  — story + gridline wizard (ETABS's initial model template)
//   Frame Sections — a named section library assigned to selected members
//   Replicate     — copy selected members to other stories (Similar Stories)
//   Supports      — fixed / pinned column bases (joint restraints)
//   Design Prefs  — fc', fy, cover and default bars for the design checks
(function () {
  const G = () => window.G;

  // ---------------------------------------------------------- New Building
  // Stories (count + height) + orthogonal gridlines in one dialog; levels
  // are appended after any existing ones and the grid system is generated
  // through GridManager so snapping works immediately.
  function newBuildingDialog(app) {
    app.dialog('New Building — Stories & Gridlines', `
      <div class="dim" style="margin:0 0 8px">ETABS-style initial model: story levels and an orthogonal grid
      system. Existing levels are kept; new stories are appended above them.</div>
      <div class="form-row"><label>Stories above the base</label><input type="number" id="nb-st" min="1" max="60" value="4" style="width:70px"></div>
      <div class="form-row"><label>Story height (m)</label><input type="number" id="nb-sh" step="0.1" min="1" value="3" style="width:70px"></div>
      <div class="form-row"><label>X spacings (m, comma list)</label><input id="nb-xs" value="6, 6, 6" style="width:150px"></div>
      <div class="form-row"><label>Y spacings (m, comma list)</label><input id="nb-ys" value="5, 5, 5" style="width:150px"></div>
    `, [
      ['Cancel', null],
      ['Create', () => {
        const nStories = Math.max(1, Math.min(60, parseInt(document.getElementById('nb-st').value) || 4));
        const sh = Math.max(1, parseFloat(document.getElementById('nb-sh').value) || 3);
        const xs = document.getElementById('nb-xs').value || '';
        const ys = document.getElementById('nb-ys').value || '';
        // levels: keep existing, append stories above the current highest
        const lvls = app.model.levels = app.model.levels || [];
        let z = lvls.length ? Math.max(...lvls.map(l => l.elevation || 0)) : 0;
        if (!lvls.length) lvls.push({ id: 'lvl_1', name: 'Base', elevation: 0 });
        let n = lvls.length;
        for (let i = 0; i < nStories; i++) {
          z += sh;
          n++;
          lvls.push({ id: 'lvl_' + n, name: 'Story ' + (n - 1), elevation: +z.toFixed(3) });
        }
        // gridlines
        let r = null;
        if (app.gridManager && (xs.trim() || ys.trim())) {
          app.run('generate grids', () => {
            r = app.gridManager.generateOrthogonal({ xSpacings: xs, ySpacings: ys });
            if (r.error) throw new Error(r.error);
          });
        }
        if (app.view && app.view.setGrids) app.view.setGrids(app.model.grids || [], app.model.levels);
        app.toast('Created ' + nStories + ' stories @ ' + sh + ' m' +
          (r && r.grids ? ' + ' + r.grids.length + ' gridlines' : '') +
          ' — draw columns on the grid, then Replicate up');
        return true;
      }],
    ]);
  }

  // ---------------------------------------------------------- Frame Sections
  const DEFAULT_SECTIONS = () => ([
    { id: 'B25x50', kind: 'beam', b: 0.25, h: 0.5 },
    { id: 'B30x60', kind: 'beam', b: 0.30, h: 0.6 },
    { id: 'C30x30', kind: 'column', b: 0.30, h: 0.30 },
    { id: 'C40x40', kind: 'column', b: 0.40, h: 0.40 },
    { id: 'C40x60', kind: 'column', b: 0.40, h: 0.60 },
  ]);

  function getSections(app) {
    if (!app.model.frameSections) app.model.frameSections = DEFAULT_SECTIONS();
    return app.model.frameSections;
  }

  // Assign a section to the selected members: params carry the dims (so the
  // 3D geometry rebuilds with the new size) plus the section name for the
  // schedule and design reports.
  function applySection(app, ents, sec) {
    let n = 0;
    app.run('assign section', () => {
      for (const e of ents) {
        if (sec.kind === 'beam' && e.type === 'beam') {
          e.params.webWidth = sec.b; e.params.height = sec.h;
        } else if (sec.kind === 'column' && e.type === 'column') {
          e.params.width = sec.b; e.params.depth = sec.h;
        } else continue;
        e.params.section = sec.id;
        n++;
      }
    });
    if (n && app.rebuildFromParams) app.rebuildFromParams();
    return n;
  }

  function sectionsDialog(app) {
    const secs = getSections(app).map(s => ({ ...s }));
    const ents = selectedEntities(app);
    const beams = ents.filter(e => e.type === 'beam');
    const cols = ents.filter(e => e.type === 'column');
    const render = () => `
      <div class="dim" style="margin:0 0 8px">Named concrete sections (b×h, m). Select beams/columns first,
      then a section and Assign — the members resize and the analysis follows.</div>
      <table class="ob-table" style="width:100%;border-collapse:collapse;font-size:11px">
        <tr style="text-align:left"><th>Id</th><th>Type</th><th>b (m)</th><th>h (m)</th><th></th></tr>
        ${secs.map((s, i) => `<tr>
          <td><input data-f="id" data-i="${i}" value="${s.id}" style="width:78px"></td>
          <td><select data-f="kind" data-i="${i}"><option value="beam"${s.kind === 'beam' ? ' selected' : ''}>beam</option><option value="column"${s.kind === 'column' ? ' selected' : ''}>column</option></select></td>
          <td><input type="number" data-f="b" data-i="${i}" value="${s.b}" step="0.05" min="0.1" style="width:64px"></td>
          <td><input type="number" data-f="h" data-i="${i}" value="${s.h}" step="0.05" min="0.1" style="width:64px"></td>
          <td><button data-assign="${i}" class="btn small" ${secs[i].id.startsWith('B') === (beams.length > 0) || (secs[i].kind === 'beam' ? beams.length : cols.length) ? '' : 'disabled'}>Assign</button></td>
        </tr>`).join('')}
      </table>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
        <button id="fs-add" class="btn small">+ Add</button>
        <span class="dim">${beams.length} beam(s), ${cols.length} column(s) selected</span>
      </div>`;
    app.dialog('Frame Sections', render(), [
      ['Close', null],
      ['Save Library', () => {
        const root = document.querySelector('#dialog .dialog-body') || document;
        root.querySelectorAll('[data-f]').forEach(el => {
          const s = secs[+el.dataset.i];
          if (!s) return;
          s[el.dataset.f] = (el.dataset.f === 'id' || el.dataset.f === 'kind') ? el.value : (parseFloat(el.value) || 0);
        });
        app.model.frameSections = secs;
        app.toast(secs.length + ' sections saved');
        return true;
      }],
    ]);
    setTimeout(() => {
      const root = document.querySelector('#dialog .dialog-body');
      if (!root) return;
      const rerender = () => { root.innerHTML = render(); wire(); };
      const wire = () => {
        root.querySelector('#fs-add').onclick = () => {
          secs.push({ id: 'S' + (secs.length + 1), kind: 'beam', b: 0.3, h: 0.5 });
          rerender();
        };
        root.querySelectorAll('[data-assign]').forEach(b => {
          b.onclick = () => {
            // read the row's current editor values first
            root.querySelectorAll('[data-f]').forEach(el => {
              const s = secs[+el.dataset.i];
              if (!s) return;
              s[el.dataset.f] = (el.dataset.f === 'id' || el.dataset.f === 'kind') ? el.value : (parseFloat(el.value) || 0);
            });
            const sec = secs[+b.dataset.assign];
            const targets = sec.kind === 'beam' ? beams : cols;
            if (!targets.length) { app.toast('Select ' + sec.kind + 's first', true); return; }
            const n = applySection(app, targets, sec);
            app.toast(sec.id + ' applied to ' + n + ' ' + sec.kind + '(s)');
          };
        });
      };
      wire();
    }, 0);
  }

  // ------------------------------------------------------------- Replicate
  // Copy the selected parametric entities to other stories: the geometry is
  // cloned through the model's subset import and a NEW entity is registered
  // with the params shifted to the target elevation.
  function entityBaseElevation(ent) {
    const p = ent.params || {};
    if (p.base && Array.isArray(p.base)) return p.base[2] || 0;
    if (p.baseline && p.baseline.length) return p.baseline[0][2] || 0;
    if (p.regions && p.regions.length && p.regions[0].outer && p.regions[0].outer.length)
      return p.regions[0].outer[0][2] || 0;
    return null;
  }

  function shiftParams(params, dz) {
    const p = JSON.parse(JSON.stringify(params || {}));
    const up = pt => { if (Array.isArray(pt)) pt[2] = (pt[2] || 0) + dz; };
    if (p.base) up(p.base);
    if (p.end) up(p.end);
    if (p.baseline) p.baseline.forEach(up);
    if (p.regions) p.regions.forEach(r => (r.outer || []).forEach(up));
    delete p.hostWallId; // hosted openings re-derive from their new host
    return p;
  }

  function replicateEntity(app, ent, dz) {
    const m = app.model, Gv = G();
    const faces = (ent.faces || []).map(id => m.faces.get(id)).filter(Boolean);
    if (!faces.length) return null;
    const sel = { faces: new Set(faces.map(f => f.id)), edges: new Set(ent.edges || []) };
    const data = m.serializeSubset(sel);
    const nf = m.importSubset(data, Gv.v(0, 0, dz));
    if (!nf || !nf.length) return null;
    const roles = {};
    for (const f of nf) {
      roles[f.id] = 'side';
      if (f.userData) f.userData = null;
    }
    return app.bim.create(ent.type, shiftParams(ent.params, dz), roles, []);
  }

  function replicateDialog(app) {
    const ents = selectedEntities(app).filter(e =>
      ['column', 'beam', 'wall', 'floor', 'brace', 'foundation'].includes(e.type));
    if (!ents.length) { app.toast('Select the story\'s members first (columns, beams, walls, floors)', true); return; }
    const bases = ents.map(entityBaseElevation);
    const z0 = Math.min(...bases.filter(b => b != null));
    if (z0 == null) { app.toast('Cannot read the selection\'s base elevation', true); return; }
    const lvls = (app.model.levels || []).filter(l => (l.elevation || 0) > z0 + 1e-6);
    if (!lvls.length) { app.toast('No stories above the selection — add levels first', true); return; }
    app.dialog('Replicate to Stories (Similar Stories)', `
      <div class="dim" style="margin:0 0 8px">${ents.length} element(s) with base at ${z0.toFixed(2)} m are
      copied to every checked story, exactly like ETABS's Similar Stories.</div>
      ${lvls.map(l => `<div class="form-row"><label>
        <input type="checkbox" class="rp-lvl" value="${l.id}" checked> ${l.name} (${(l.elevation || 0).toFixed(2)} m)
      </label></div>`).join('')}
    `, [
      ['Cancel', null],
      ['Replicate', () => {
        const checked = [...document.querySelectorAll('.rp-lvl:checked')].map(el =>
          app.model.levels.find(l => l.id === el.value)).filter(Boolean);
        if (!checked.length) { app.toast('Check at least one story', true); return false; }
        let made = 0;
        app.run('replicate to stories', () => {
          for (const l of checked) {
            const dz = (l.elevation || 0) - z0;
            if (Math.abs(dz) < 1e-6) continue;
            for (const e of ents) if (replicateEntity(app, e, dz)) made++;
          }
        });
        if (app.view) { if (app.view.rebuild) app.view.rebuild(); app.view.invalidate(); }
        app.toast('Replicated ' + made + ' element(s) to ' + checked.length + ' story(ies)');
        return true;
      }],
    ]);
  }

  // --------------------------------------------------------------- Supports
  function supportsDialog(app) {
    const ents = selectedEntities(app).filter(e => e.type === 'column');
    if (!ents.length) { app.toast('Select columns to assign their base support', true); return; }
    const cur = ents.every(e => e.params && e.params.baseFix === 'pinned') ? 'pinned'
      : ents.every(e => e.params && e.params.baseFix === 'fixed') ? 'fixed' : '';
    app.dialog('Supports — Column Base Restraint', `
      <div class="dim" style="margin:0 0 8px">${ents.length} column(s) selected. Fixed restrains all 6 DOF
      (default); Pinned releases the moments — the analysis support follows.</div>
      <div class="form-row"><label>Restraint</label>
        <select id="sp-fix">
          <option value="fixed"${cur === 'fixed' ? ' selected' : ''}>Fixed</option>
          <option value="pinned"${cur === 'pinned' ? ' selected' : ''}>Pinned</option>
        </select></div>
    `, [
      ['Cancel', null],
      ['Assign', () => {
        const v = document.getElementById('sp-fix').value;
        for (const e of ents) e.params.baseFix = v;
        app.toast(v + ' base assigned to ' + ents.length + ' column(s)');
        return true;
      }],
    ]);
  }

  // ----------------------------------------------------------- Design Prefs
  const DEFAULT_PREFS = () => ({ fc: 30, fy: 420, cover: 40, barTop: 16, barBot: 20, colBar: 20, colPerFace: 2 });
  function getPrefs(app) {
    if (!app.model.designPrefs) app.model.designPrefs = DEFAULT_PREFS();
    return app.model.designPrefs;
  }

  function designPrefsDialog(app) {
    const p = { ...getPrefs(app) };
    const f = (id, label, val, step) =>
      `<div class="form-row"><label>${label}</label><input type="number" id="${id}" step="${step || 1}" value="${val}" style="width:90px"></div>`;
    app.dialog('Design Preferences — ACI 318-19', `
      <div class="dim" style="margin:0 0 8px">Material and detailing defaults for every design check
      (per-element rebar, when present, still wins).</div>
      ${f('dp-fc', "fc' (MPa)", p.fc, 5)}
      ${f('dp-fy', 'fy (MPa)', p.fy, 10)}
      ${f('dp-cov', 'Cover (mm)', p.cover, 5)}
      ${f('dp-bart', 'Beam top bar Ø (mm)', p.barTop, 2)}
      ${f('dp-barb', 'Beam bottom bar Ø (mm)', p.barBot, 2)}
      ${f('dp-colbar', 'Column bar Ø (mm)', p.colBar, 2)}
      ${f('dp-colpf', 'Column bars per face', p.colPerFace, 1)}
    `, [
      ['Cancel', null],
      ['Save', () => {
        const num = id => parseFloat((document.getElementById(id) || {}).value);
        const np = {
          fc: num('dp-fc') || 30, fy: num('dp-fy') || 420, cover: num('dp-cov') || 40,
          barTop: num('dp-bart') || 16, barBot: num('dp-barb') || 20,
          colBar: num('dp-colbar') || 20, colPerFace: Math.max(1, num('dp-colpf') || 2),
        };
        app.model.designPrefs = np;
        app.toast("Design preferences saved (fc' " + np.fc + ", fy " + np.fy + ')');
        return true;
      }],
    ]);
  }

  // selection → BIM entities (faces carry userData.bimEntityId)
  function selectedEntities(app) {
    const out = new Map();
    for (const fid of (app.sel && app.sel.faces) || []) {
      const f = app.model.faces.get(fid);
      const uid = f && f.userData && f.userData.bimEntityId;
      if (uid) {
        const ent = app.bim.getEntityById(uid);
        if (ent) out.set(uid, ent);
      }
    }
    return [...out.values()];
  }

  window.EtabsUI = {
    newBuildingDialog, sectionsDialog, replicateDialog, supportsDialog, designPrefsDialog,
    getSections, getPrefs, DEFAULT_SECTIONS, DEFAULT_PREFS, selectedEntities,
    applySection, replicateEntity, entityBaseElevation,
  };
})();
