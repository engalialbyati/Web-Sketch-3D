'use strict';
// app.js — RC Studio controller: state, menus, dialogs, explorer, results.
// The ETABS workflow: New Model (stories+grids) -> draw on plan -> Define
// (sections / patterns / auto lateral) -> Assign (sections / loads /
// restraints) -> Analyze -> Display (deformed / M / V / P / reactions).
(function () {
  const app = window.app = {
    model: null,
    story: 1,          // active story index (0 = base)
    tool: 'select',
    sel: [],
    chain: true,
    disp: { kind: 'model', combo: 0, scale: 80 },
    extrude: false,
    planMode: false,
  };

  app.elev = function () { return this.model.stories[this.story] ? this.model.stories[this.story].elevation : 0; };

  app.dirty = function () {
    if (this.model.results && !this.locked) this.model.results = null;
    UI.refreshAll();
  };
  app.select = function (f) {
    this.sel = f ? [f] : [];
    UI.inspector();
    V3.build();
    app.plan && app.plan.draw();
  };
  // ETABS box selection: objects fully inside the window; Shift adds
  app.selectMany = function (frames, additive) {
    if (additive) {
      const have = new Set(this.sel);
      for (const f of frames) if (!have.has(f)) this.sel.push(f);
    } else {
      this.sel = frames;
    }
    UI.inspector();
    UI.toast(this.sel.length + ' member(s) selected');
    V3.build();
    app.plan && app.plan.draw();
  };

  // ================================================================ UI
  const UI = window.UI = {};

  UI.init = function () {
    app.model = RCModel.newModel();
    app.plan = new Plan(document.getElementById('planCanvas'), app);
    V3.init(app);
    UI.wireShortcuts();
    UI.newModelDialog(true);
    UI.refreshAll();
  };

  UI.refreshAll = function () {
    UI.storyBar();
    UI.explorer();
    UI.inspector();
    UI.legend();
    V3.build();
    app.plan.draw();
  };

  UI.storyBar = function () {
    const s = document.getElementById('storySelect');
    s.innerHTML = app.model.stories.map((st, i) =>
      `<option value="${i}" ${i === app.story ? 'selected' : ''}>${st.name} (Z = ${st.elevation.toFixed(1)} m)</option>`).join('');
  };
  UI.changeStory = function (v) {
    app.story = parseInt(v, 10) || 0;
    document.getElementById('viewportTitle').textContent = app.planMode
      ? 'Plan View — ' + app.model.stories[app.story].name
      : '3D View — Global Coordinate System';
    UI.refreshAll();
  };

  // ---------------------------------------------------------------- explorer
  UI.explorer = function () {
    const m = app.model;
    const node = (icon, label, action) =>
      `<div class="tree-node text-slate-600" onclick="${action}"><i class="${icon} text-slate-400 mr-1.5"></i><span>${label}</span></div>`;
    const res = m.results;
    let html = '';
    html += `<div class="tree-node font-semibold text-slate-800"><i class="fa-solid fa-building text-sky-600 mr-1.5"></i>Structure</div>`;
    html += `<div class="pl-4">${node('fa-regular fa-calendar-days', m.stories.length + ' stories (' + (m.stories[1] ? (m.stories[1].elevation) : 3) + ' m typ.)', 'UI.editStoriesGrids()')}
      ${node('fa-solid fa-border-all', m.grids.x.length + '×' + m.grids.y.length + ' gridlines', 'UI.editStoriesGrids()')}
      ${node('fa-solid fa-vector-square', m.joints.length + ' joints · ' + m.frames.length + ' frames', '')}</div>`;
    html += `<div class="tree-node font-semibold text-slate-800 mt-1"><i class="fa-solid fa-cubes text-emerald-600 mr-1.5"></i>Materials & Sections</div>`;
    html += `<div class=\"pl-4\">` + m.materials.map(mt => `<div class=\"tree-node text-slate-600\" onclick=\"UI.materialsDialog()\"><i class=\"fa-solid fa-cube text-emerald-500 mr-1.5\"></i>${mt.id}: Ec ${mt.Ec}</div>`).join('') + `</div>`;
    html += `<div class="pl-4">` + m.sections.map(s2 =>
      `<div class="tree-node text-slate-600" onclick="UI.sectionsDialog()"><i class="fa-solid fa-shapes text-sky-500 mr-1.5"></i>${s2.id} (${s2.kind})</div>`).join('') + `</div>`;
    html += `<div class="tree-node font-semibold text-slate-800 mt-1"><i class="fa-solid fa-weight-hanging text-amber-600 mr-1.5"></i>Loads</div>`;
    html += `<div class="pl-4">` + m.patterns.map(p =>
      `<div class="tree-node text-slate-600" onclick="UI.patternsDialog()"><i class="fa-regular fa-circle-dot text-amber-500 mr-1.5"></i>${p.id} (${p.type})</div>`).join('')
      + (m.autoSeismic ? node('fa-solid fa-tower-broadcast', 'Auto seismic: Cs ' + (m.autoSeismic.mode === 'cs' ? m.autoSeismic.cs : 'ASCE'), 'UI.autoLateralDialog()') : '')
      + (m.autoWind ? node('fa-solid fa-wind', 'Auto wind ' + m.autoWind.v + ' m/s (' + m.autoWind.exposure + ')', 'UI.autoLateralDialog()') : '')
      + (m.frameLoads.length ? node('fa-solid fa-arrow-down', m.frameLoads.length + ' frame load assignments', 'UI.assignFrameLoadDialog()') : '')
      + `</div>`;
    if (res) {
      html += `<div class="tree-node font-semibold text-slate-800 mt-1"><i class="fa-solid fa-chart-simple text-purple-600 mr-1.5"></i>Results</div>`;
      html += `<div class="pl-4">`
        + node('fa-solid fa-wave-square', 'Deformed shape (×' + app.disp.scale + ')', "UI.setDisplay('deformed')")
        + node('fa-solid fa-chart-area', 'Moment M3-3', "UI.setDisplay('moment')")
        + node('fa-solid fa-chart-line', 'Shear V2-2', "UI.setDisplay('shear')")
        + node('fa-solid fa-arrows-up-down', 'Axial P', "UI.setDisplay('axial')")
        + node('fa-solid fa-table-list', 'Reactions & envelope', "UI.setDisplay('reactions')")
        + `</div>`;
    }
    document.getElementById('explorerTree').innerHTML = html;
  };

  UI.inspector = function () {
    const el = document.getElementById('inspectorDetails');
    document.getElementById('selectedCountText').textContent = app.sel.length + ' Selected';
    if (!app.sel.length) { el.innerHTML = '<div class="text-slate-400">Click a member to inspect</div>'; return; }
    const f = app.sel[0];
    const m = app.model;
    const a = RCModel.jointById(m, f.i), b = RCModel.jointById(m, f.j);
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const loads = m.frameLoads.filter(l => l.frameId === f.id)
      .map(l => l.pattern + ' ' + l.w + ' kN/m ' + (l.dir || 'gravity')).join('; ');
    let resLine = '';
    if (m.results) {
      const env = m.results.envelope.find(e2 => e2.frameId === f.id);
      if (env) resLine = `<div class="flex justify-between"><span>M / V / P max:</span><span class="font-bold text-rose-600">${(env.maxM / 1e6).toFixed(1)} / ${(env.maxV / 1e3).toFixed(1)} / ${(env.maxN / 1e3).toFixed(1)}</span></div>`
        + `<div class="flex justify-between"><span>Governing:</span><span>${env.gov || ''}</span></div>`;
    }
    el.innerHTML = `
      <div class="flex justify-between"><span>Element:</span><span class="font-bold text-sky-800">${f.kind === 'column' ? 'Column' : 'Beam'} ${f.id}</span></div>
      <div class="flex justify-between"><span>Section:</span><span>${f.section}</span></div>
      <div class="flex justify-between"><span>Length:</span><span>${L.toFixed(2)} m</span></div>
      ${(f.releaseI && f.releaseI.m3) || (f.releaseJ && f.releaseJ.m3) ? '<div class="flex justify-between"><span>Releases:</span><span class="text-purple-700 font-semibold">M3</span></div>' : ''}
      ${loads ? `<div class="flex justify-between"><span>Loads:</span><span>${loads}</span></div>` : ''}
      ${resLine}`;
  };

  UI.legend = function () {
    const bars = document.getElementById('legendColorBars');
    const title = document.getElementById('legendTitle');
    const k = app.disp.kind;
    if (k === 'moment' || k === 'shear' || k === 'axial') {
      const res = app.model.results;
      const combo = res ? res.combos[app.disp.combo] || '' : '';
      title.textContent = { moment: 'Bending Moment M3-3 [kN·m]', shear: 'Shear V2-2 [kN]', axial: 'Axial P [kN]' }[k];
      bars.innerHTML = `<div class="text-slate-300">${combo}</div>
        <div class="flex items-center space-x-2"><span class="w-3.5 h-3.5 rounded bg-rose-500 inline-block"></span><span>high</span></div>
        <div class="flex items-center space-x-2"><span class="w-3.5 h-3.5 rounded bg-emerald-500 inline-block"></span><span>low</span></div>`;
    } else if (k === 'deformed') {
      title.textContent = 'Deformed shape';
      bars.innerHTML = `<div class="flex items-center space-x-2"><span class="w-3.5 h-3.5 rounded bg-emerald-400 inline-block"></span><span>displaced (×${app.disp.scale})</span></div>
        <div class="flex items-center space-x-2"><span class="w-3.5 h-3.5 rounded bg-slate-500 inline-block"></span><span>undeformed</span></div>`;
    } else {
      title.textContent = 'Member colors';
      bars.innerHTML = `
        <div class="flex items-center space-x-2"><span class="w-3.5 h-3.5 rounded bg-sky-400 inline-block"></span><span>Columns</span></div>
        <div class="flex items-center space-x-2"><span class="w-3.5 h-3.5 rounded bg-amber-400 inline-block"></span><span>Beams</span></div>
        <div class="flex items-center space-x-2"><span class="w-3.5 h-3.5 rounded bg-red-400 inline-block"></span><span>Selected</span></div>`;
    }
  };

  // ---------------------------------------------------------------- dialogs
  UI.dialog = function (title, bodyHtml, buttons) {
    const root = document.getElementById('dialogRoot');
    root.innerHTML = `
      <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" id="dlgBack">
        <div class="bg-white rounded-lg shadow-2xl border border-slate-300 w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
          <div class="bg-slate-800 text-white px-4 py-2 flex items-center justify-between text-xs font-semibold">
            <span>${title}</span>
            <button onclick="UI.closeDialog()" class="text-slate-400 hover:text-white"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="p-4 overflow-y-auto space-y-2 text-xs">${bodyHtml}</div>
          <div class="bg-slate-100 px-4 py-2 border-t border-slate-200 flex justify-end gap-2" id="dlgBtns"></div>
        </div>
      </div>`;
    const bw = document.getElementById('dlgBtns');
    for (const [label, fn, primary] of buttons) {
      const b = document.createElement('button');
      b.className = 'px-4 py-1.5 rounded font-sans text-xs font-semibold ' + (primary ? 'bg-sky-600 hover:bg-sky-700 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-700');
      b.textContent = label;
      b.onclick = () => { if (!fn || fn() !== false) UI.closeDialog(); };
      bw.appendChild(b);
    }
  };
  UI.closeDialog = function () { document.getElementById('dialogRoot').innerHTML = ''; };
  const frow = (id, label, val, step) =>
    `<div class="flex items-center justify-between gap-3"><label class="text-slate-600">${label}</label><input type="number" id="${id}" step="${step || 1}" value="${val}" class="rc-input" style="width:110px"></div>`;
  const trow = (id, label, val) =>
    `<div class="flex items-center justify-between gap-3"><label class="text-slate-600">${label}</label><input type="text" id="${id}" value="${val}" class="rc-input" style="width:150px"></div>`;
  const num = id => parseFloat((document.getElementById(id) || {}).value);

  // ---- New model wizard (stories + grids), ETABS initial model
  UI.newModelDialog = function (first) {
    UI.dialog('New Model — Stories & Grid System (ETABS template)', `
      <div class="text-slate-500">Creates the story stack and an orthogonal grid system.</div>
      ${frow('nm-st', 'Number of stories', 4, 1)}
      ${frow('nm-sh', 'Story height (m)', 3, 0.1)}
      ${trow('nm-x', 'X spacings (m, comma list)', '6, 6, 6')}
      ${trow('nm-y', 'Y spacings (m, comma list)', '5, 5, 5')}
      <div class="flex items-center gap-4 pt-1">
        <label class="flex items-center gap-1.5"><input type="checkbox" id="nm-cols" checked> columns at all grid intersections</label>
        <label class="flex items-center gap-1.5"><input type="checkbox" id="nm-beams" checked> beams on all gridlines</label>
      </div>`, [
      [first ? 'Create' : 'Cancel', null, !first],
      ['Create Model', () => {
        const n = Math.max(1, parseInt(num('nm-st')) || 4);
        const sh = Math.max(1, num('nm-sh') || 3);
        app.model = RCModel.newModel();
        app.model.storyHeight = sh;
        app.model.stories = [{ name: 'Base', elevation: 0 }];
        for (let i = 1; i <= n; i++) app.model.stories.push({ name: 'Story ' + i, elevation: +(i * sh).toFixed(3) });
        const nums = v => String(v).split(/[,;\s]+/).filter(Boolean).map(parseFloat).filter(v => v > 0);
        let x = nums((document.getElementById('nm-x') || {}).value || '6');
        let y = nums((document.getElementById('nm-y') || {}).value || '5');
        if (!x.length) x = [6, 6];
        if (!y.length) y = [5, 5];
        const cum = a => { let s = 0; return a.map(v => (s += v)); };
        app.model.grids.x = cum(x).map((p, i) => ({ label: String(i + 1), pos: p }));
        app.model.grids.y = cum(y).map((p, i) => ({ label: String.fromCharCode(65 + i), pos: p }));
        // template members: columns + beams on every story
        if (document.getElementById('nm-cols').checked)
          for (let s = 1; s <= n; s++)
            for (const gx of app.model.grids.x) for (const gy of app.model.grids.y)
              RCModel.addColumn(app.model, s, gx.pos, gy.pos);
        if (document.getElementById('nm-beams').checked)
          for (let s = 1; s <= n; s++)
            for (const gy of app.model.grids.y)
              for (let i = 0; i + 1 < app.model.grids.x.length; i++)
                RCModel.addBeam(app.model, s, app.model.grids.x[i].pos, gy.pos, app.model.grids.x[i + 1].pos, gy.pos);
        app.story = n;
        app.sel = [];
        UI.toast('Model created: ' + n + ' stories, ' + app.model.frames.length + ' members');
        UI.refreshAll();
        V3.setAngle('iso');
      }, true],
    ]);
  };

  UI.editStoriesGrids = function () {
    const m = app.model;
    UI.dialog('Stories & Grid System', `
      <div class="text-slate-500">Gridline positions are cumulative spacings in metres.</div>
      ${frow('eg-st', 'Number of stories', m.stories.length - 1, 1)}
      ${frow('eg-sh', 'Story height (m)', m.storyHeight || 3, 0.1)}
      ${trow('eg-x', 'X spacings', m.grids.x.map(g => g.pos - (m.grids.x[m.grids.x.indexOf(g) - 1] ? m.grids.x[m.grids.x.indexOf(g) - 1].pos : 0)).map(v => +v.toFixed(2)).join(', '))}
      ${trow('eg-y', 'Y spacings', m.grids.y.map(g => g.pos - (m.grids.y[m.grids.y.indexOf(g) - 1] ? m.grids.y[m.grids.y.indexOf(g) - 1].pos : 0)).map(v => +v.toFixed(2)).join(', '))}
      <div class="text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">Changing the grid regenerates stories (members keep their coordinates).</div>`, [
      ['Cancel', null],
      ['Apply', () => {
        const n = Math.max(1, parseInt(num('eg-st')) || 1);
        const sh = Math.max(1, num('eg-sh') || 3);
        m.storyHeight = sh;
        m.stories = [{ name: 'Base', elevation: 0 }];
        for (let i = 1; i <= n; i++) m.stories.push({ name: 'Story ' + i, elevation: +(i * sh).toFixed(3) });
        const nums = v => String(v).split(/[,;\s]+/).filter(Boolean).map(parseFloat).filter(v => v > 0);
        const cum = a => { let s = 0; return a.map(v => +(s += v).toFixed(3)); };
        m.grids.x = cum(nums((document.getElementById('eg-x') || {}).value)).map((p, i) => ({ label: String(i + 1), pos: p }));
        m.grids.y = cum(nums((document.getElementById('eg-y') || {}).value)).map((p, i) => ({ label: String.fromCharCode(65 + i), pos: p }));
        app.story = Math.min(app.story, n);
        UI.toast('Stories + grids updated');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---- replicate story members upward (Similar Stories)
  UI.replicateStoryDialog = function () {
    const m = app.model;
    const z = app.elev();
    const mine = m.frames.filter(f => {
      const a = RCModel.jointById(m, f.i);
      return f.kind === 'beam' ? Math.abs(a.z - z) < 1e-6 : Math.abs(RCModel.jointById(m, f.j).z - z) < 1e-6;
    });
    const above = m.stories.filter((s, i) => s.elevation > z + 1e-6 && i >= 1);
    if (!mine.length) { UI.toast('No members at ' + m.stories[app.story].name, true); return; }
    if (!above.length) { UI.toast('No stories above — add stories first', true); return; }
    UI.dialog('Replicate Story (Similar Stories)', `
      <div class="text-slate-500">${mine.length} member(s) at ${m.stories[app.story].name} are copied to every checked story above.</div>
      ${above.map(s => `<label class="flex items-center gap-2"><input type="checkbox" class="rp-cb" value="${s.elevation}" checked> ${s.name} (Z = ${s.elevation} m)</label>`).join('')}`, [
      ['Cancel', null],
      ['Replicate', () => {
        let made = 0;
        for (const cb of document.querySelectorAll('.rp-cb:checked')) {
          const dz = parseFloat(cb.value) - z;
          for (const f of mine) {
            if (f.kind === 'column') RCModel.addColumn(m, m.stories.findIndex(s => Math.abs(s.elevation - (z + dz)) < 1e-6), RCModel.jointById(m, f.i).x, RCModel.jointById(m, f.i).y);
            else {
              const a = RCModel.jointById(m, f.i), b = RCModel.jointById(m, f.j);
              RCModel.addBeam(m, m.stories.findIndex(s => Math.abs(s.elevation - (z + dz)) < 1e-6), a.x, a.y, b.x, b.y);
            }
            made++;
          }
        }
        UI.toast('Replicated ' + made + ' member(s)');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---- Define: sections
  UI.sectionsDialog = function () {
    const m = app.model;
    const rows = m.sections.map((s, i) => `<tr>
      <td><input class="rc-input sec-id" data-i="${i}" value="${s.id}" style="width:80px"></td>
      <td><select class="rc-input sec-kind" data-i="${i}"><option ${s.kind === 'column' ? 'selected' : ''}>column</option><option ${s.kind === 'beam' ? 'selected' : ''}>beam</option></select></td>
      <td><input type="number" step="0.05" class="rc-input sec-b" data-i="${i}" value="${s.b}"></td>
      <td><input type="number" step="0.05" class="rc-input sec-h" data-i="${i}" value="${s.h}"></td>
      <td><select class="rc-input sec-mat" data-i="${i}">${m.materials.map(mt => `<option ${(s.material || 'C30') === mt.id ? 'selected' : ''}>${mt.id}</option>`).join('')}</select></td>
      <td class="font-mono text-[10px] text-slate-500">${((s.b * s.h) * 1e6 / 1e3).toFixed(0)}e3 mm&sup2; | I33=${(s.b * s.h ** 3 / 12 * 1e12 / 1e9).toFixed(2)}e9</td></tr>`).join('');
    UI.dialog('Frame Section Properties', `
      <table class="w-full text-xs border-collapse"><tr class="text-left text-slate-500"><th>Id</th><th>Type</th><th>b (m)</th><th>h (m)</th><th>Material</th><th>A / I33</th></tr>${rows}</table>
      <button onclick="UI.addSectionRow()" class="etabs-btn bg-slate-100 border-slate-300">+ Add</button>`, [
      ['Close', null],
      ['Save', () => {
        document.querySelectorAll('.sec-id').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.id = el.value.trim() || s.id; });
        document.querySelectorAll('.sec-kind').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.kind = el.value; });
        document.querySelectorAll('.sec-b').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.b = parseFloat(el.value) || s.b; });
        document.querySelectorAll('.sec-h').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.h = parseFloat(el.value) || s.h; });
        document.querySelectorAll('.sec-mat').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.material = el.value; });
        UI.toast('Sections saved');
        UI.refreshAll();
      }, true],
    ]);
  };
  UI.addSectionRow = function () {
    app.model.sections.push({ id: 'S' + (app.model.sections.length + 1), kind: 'beam', b: 0.3, h: 0.5 });
    UI.sectionsDialog();
  };

  // ---- Define: load patterns
  UI.patternsDialog = function () {
    const m = app.model;
    const rows = m.patterns.map((p, i) => `<tr>
      <td><input class="rc-input pat-id" data-i="${i}" value="${p.id}" style="width:90px"></td>
      <td><select class="rc-input pat-type" data-i="${i}">${['dead', 'live', 'wind', 'quake'].map(t => `<option ${p.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input type="number" step="0.1" class="rc-input pat-sw" data-i="${i}" value="${p.swMult || 0}"></td></tr>`).join('');
    UI.dialog('Define Load Patterns', `
      <div class="text-slate-500">Self-weight multiplier adds element weight to the pattern. Types drive the ACI 318-19 / ASCE 7-16 combinations.</div>
      <table class="w-full text-xs border-collapse"><tr class="text-left text-slate-500"><th>Id</th><th>Type</th><th>SW ×</th></tr>${rows}</table>
      <button onclick="UI.addPatternRow()" class="etabs-btn bg-slate-100 border-slate-300">+ Add</button>`, [
      ['Close', null],
      ['Save', () => {
        document.querySelectorAll('.pat-id').forEach(el => { const p = m.patterns[+el.dataset.i]; if (p) p.id = el.value.trim() || p.id; });
        document.querySelectorAll('.pat-type').forEach(el => { const p = m.patterns[+el.dataset.i]; if (p) p.type = el.value; });
        document.querySelectorAll('.pat-sw').forEach(el => { const p = m.patterns[+el.dataset.i]; if (p) p.swMult = parseFloat(el.value) || 0; });
        UI.toast('Patterns saved');
        UI.refreshAll();
      }, true],
    ]);
  };
  UI.addPatternRow = function () {
    app.model.patterns.push({ id: 'P' + (app.model.patterns.length + 1), name: 'Pattern', type: 'other', swMult: 0 });
    UI.patternsDialog();
  };

  UI.showCombos = function () {
    const combos = RCModel.buildCombinations(app.model.patterns, app.model.autoSeismic);
    UI.dialog('Load Combinations (auto per ACI 318-19 / ASCE 7)', `
      <div class="text-slate-500">Generated from the pattern types; the seismic §12.4.2 pair appears when a quake pattern/auto-seismic exists.</div>
      <table class="w-full text-xs font-mono border-collapse border border-slate-300">
        ${combos.map(c => `<tr><td class="p-1.5 border border-slate-300">${c.name}</td></tr>`).join('')}
      </table>`, [['Close', null, true]]);
  };

  // ---- Define: auto lateral
  UI.autoLateralDialog = function () {
    const m = app.model;
    const as = m.autoSeismic || { enabled: true, mode: 'asce', sds: 1.0, sd1: 0.6, R: 8, Ie: 1, dir: '+x' };
    const aw = m.autoWind || { enabled: true, v: 40, exposure: 'C', dir: '+x' };
    UI.dialog('Auto Lateral Loads — ASCE 7-16', `
      <div class="font-semibold text-slate-700">Seismic (§12.8 equivalent lateral force)</div>
      <label class="flex items-center gap-2"><input type="checkbox" id="al-se" ${as.enabled !== false ? 'checked' : ''}> enabled</label>
      ${frow('al-sds', 'SDS (g)', as.sds, 0.05)}
      ${frow('al-sd1', 'SD1 (g)', as.sd1, 0.05)}
      ${frow('al-r', 'R', as.R, 0.5)}
      ${frow('al-ie', 'Ie', as.Ie, 0.1)}
      ${frow('al-t', 'T (s, 0 = auto Ta)', as.T || 0, 0.05)}
      <div class="flex items-center justify-between"><label>Direction</label><select id="al-sdir" class="rc-input" style="width:110px">${['+x', '-x', '+y', '-y'].map(d => `<option ${as.dir === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div class="font-semibold text-slate-700 pt-2">Wind (§26/27 qz)</div>
      <label class="flex items-center gap-2"><input type="checkbox" id="al-we" ${aw.enabled !== false ? 'checked' : ''}> enabled</label>
      ${frow('al-v', 'V (m/s)', aw.v, 5)}
      <div class="flex items-center justify-between"><label>Exposure</label><select id="al-exp" class="rc-input" style="width:110px">${['B', 'C', 'D'].map(e2 => `<option ${aw.exposure === e2 ? 'selected' : ''}>${e2}</option>`).join('')}</select></div>
      <div class="flex items-center justify-between"><label>Direction</label><select id="al-wdir" class="rc-input" style="width:110px">${['+x', '-x', '+y', '-y'].map(d => `<option ${aw.dir === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>`, [
      ['Cancel', null],
      ['Save', () => {
        m.autoSeismic = { enabled: document.getElementById('al-se').checked, mode: 'asce', sds: num('al-sds'), sd1: num('al-sd1'), R: num('al-r'), Ie: num('al-ie'), T: num('al-t') || null, dir: document.getElementById('al-sdir').value };
        m.autoWind = { enabled: document.getElementById('al-we').checked, v: num('al-v'), exposure: document.getElementById('al-exp').value, dir: document.getElementById('al-wdir').value };
        UI.toast('Auto lateral saved — Run Analysis applies it');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---- Define: materials (ETABS Define > Materials)
  UI.materialsDialog = function () {
    const m = app.model;
    const rows = m.materials.map((mt, i) => `<tr>
      <td><input class="rc-input mat-id" data-i="${i}" value="${mt.id}" style="width:60px"></td>
      <td><input class="rc-input mat-name" data-i="${i}" value="${mt.name}" style="width:130px"></td>
      <td><input type="number" step="500" class="rc-input mat-ec" data-i="${i}" value="${mt.Ec}"></td>
      <td><input type="number" step="0.5" class="rc-input mat-d" data-i="${i}" value="${mt.density}"></td>
      <td><input type="number" step="5" class="rc-input mat-fc" data-i="${i}" value="${mt.fc}"></td></tr>`).join('');
    UI.dialog('Materials', `
      <table class="w-full text-xs border-collapse"><tr class="text-left text-slate-500"><th>Id</th><th>Name</th><th>Ec (MPa)</th><th>&gamma; (kN/m&sup3;)</th><th>f'c (MPa)</th></tr>${rows}</table>
      <div class="text-slate-500">Sections reference a material by id; Ec drives stiffness, &gamma; the self-weight and seismic mass.</div>`, [
      ['Close', null],
      ['Save', () => {
        document.querySelectorAll('.mat-id').forEach(el => { const t = m.materials[+el.dataset.i]; if (t) t.id = el.value.trim() || t.id; });
        document.querySelectorAll('.mat-name').forEach(el => { const t = m.materials[+el.dataset.i]; if (t) t.name = el.value; });
        document.querySelectorAll('.mat-ec').forEach(el => { const t = m.materials[+el.dataset.i]; if (t) t.Ec = parseFloat(el.value) || t.Ec; });
        document.querySelectorAll('.mat-d').forEach(el => { const t = m.materials[+el.dataset.i]; if (t) t.density = parseFloat(el.value) || t.density; });
        document.querySelectorAll('.mat-fc').forEach(el => { const t = m.materials[+el.dataset.i]; if (t) t.fc = parseFloat(el.value) || t.fc; });
        UI.toast('Materials saved');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---- Define: mass source (ETABS Define > Mass Source)
  UI.massSourceDialog = function () {
    const m = app.model;
    const ms = m.massSource || RCModel.DEFAULT_MASS_SOURCE();
    UI.dialog('Mass Source', `
      <div class="text-slate-500">What the modal analysis and auto-seismic weight count as mass.</div>
      <label class="flex items-center gap-2"><input type="checkbox" id="ms-sw" ${ms.selfWeight !== false ? 'checked' : ''}> Element self-weight</label>
      <label class="flex items-center gap-2"><input type="checkbox" id="ms-ad" ${ms.additional !== false ? 'checked' : ''}> Additional joint masses (Assign &gt; Joint &gt; Mass)</label>
      <div class="flex items-center justify-between"><label>Live pattern (for mass)</label>
        <select id="ms-lp" class="rc-input" style="width:130px"><option value="">(none)</option>${m.patterns.map(p => `<option ${ms.livePattern === p.id ? 'selected' : ''}>${p.id}</option>`).join('')}</select></div>
      ${frow('ms-lf', 'Live fraction', ms.liveFraction || 0, 0.05)}`, [
      ['Cancel', null],
      ['Save', () => {
        m.massSource = {
          selfWeight: document.getElementById('ms-sw').checked,
          additional: document.getElementById('ms-ad').checked,
          livePattern: document.getElementById('ms-lp').value || null,
          liveFraction: num('ms-lf') || 0,
        };
        UI.toast('Mass source saved');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---- Assign: frame releases (ETABS Assign > Frame > Releases)
  UI.assignReleasesDialog = function () {
    const m = app.model;
    if (!app.sel.length) { UI.toast('Select members first', true); return; }
    const f = app.sel[0];
    const cb = (end, k, label) => `<label class="flex items-center gap-1.5 text-[11px]"><input type="checkbox" class="rel-cb" data-end="${end}" data-k="${k}" ${f['release' + end] && f['release' + end][k] ? 'checked' : ''}>${label}</label>`;
    UI.dialog('Assign Frame Releases / Partial Fixity', `
      <div class="text-slate-500">${app.sel.length} member(s) — applies to all selected.</div>
      <div class="grid grid-cols-2 gap-4">
        <div class="border border-slate-200 rounded p-2">
          <div class="font-semibold text-slate-700 mb-1">Start (I end)</div>
          <div class="grid grid-cols-2 gap-1">
            ${cb('I', 'm3', 'M3 (major)')}${cb('I', 'm2', 'M2 (minor)')}
            ${cb('I', 'p', 'Axial P')}${cb('I', 't', 'Torsion T')}
            ${cb('I', 'v2', 'V2')}${cb('I', 'v3', 'V3')}
          </div>
        </div>
        <div class="border border-slate-200 rounded p-2">
          <div class="font-semibold text-slate-700 mb-1">End (J end)</div>
          <div class="grid grid-cols-2 gap-1">
            ${cb('J', 'm3', 'M3 (major)')}${cb('J', 'm2', 'M2 (minor)')}
            ${cb('J', 'p', 'Axial P')}${cb('J', 't', 'Torsion T')}
            ${cb('J', 'v2', 'V2')}${cb('J', 'v3', 'V3')}
          </div>
        </div>
      </div>
      <div class="text-slate-500">M3 release = pin the major-axis end moment (the classic ETABS beam release).</div>`, [
      ['Cancel', null],
      ['Clear Releases', () => {
        for (const fr of app.sel) { fr.releaseI = null; fr.releaseJ = null; }
        UI.toast('Releases cleared');
        UI.refreshAll();
      }],
      ['Assign', () => {
        const ri = {}, rj = {};
        document.querySelectorAll('.rel-cb').forEach(el => {
          (el.dataset.end === 'I' ? ri : rj)[el.dataset.k] = el.checked;
        });
        for (const fr of app.sel) {
          fr.releaseI = Object.values(ri).some(Boolean) ? ri : null;
          fr.releaseJ = Object.values(rj).some(Boolean) ? rj : null;
        }
        UI.toast('Releases assigned to ' + app.sel.length + ' member(s)');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---- Assign: joint restraints (ETABS DOF checkbox form)
  UI.assignRestraintDialog = function () {
    const m = app.model;
    const zMin = Math.min(...m.stories.map(s => s.elevation));
    const base = m.joints.filter(j => Math.abs(j.z - zMin) < 1e-6);
    UI.dialog('Joint Restraints (Supports) — ' + base.length + ' base joints', `
      <div class="text-slate-500">Restraint DOFs (ETABS Joint Assignment form). Applies to every base joint.</div>
      <div class="grid grid-cols-3 gap-2">
        ${['UX', 'UY', 'UZ', 'RX', 'RY', 'RZ'].map((d, i) =>
      `<label class="flex items-center gap-1.5"><input type="checkbox" class="sp-dof" data-d="${i}" checked>${d}</label>`).join('')}
      </div>
      <div class="flex gap-2 pt-1">
        <button onclick="document.querySelectorAll('.sp-dof').forEach(c => c.checked = true)" class="etabs-btn bg-slate-100 border-slate-300">All (Fixed)</button>
        <button onclick="document.querySelectorAll('.sp-dof').forEach((c, i) => c.checked = i < 3)" class="etabs-btn bg-slate-100 border-slate-300">Pinned</button>
        <button onclick="document.querySelectorAll('.sp-dof').forEach(c => c.checked = false)" class="etabs-btn bg-slate-100 border-slate-300">Free</button>
      </div>`, [
      ['Cancel', null],
      ['Assign', () => {
        const fx = [0, 0, 0, 0, 0, 0];
        let any = false;
        document.querySelectorAll('.sp-dof').forEach(el => { if (el.checked) { fx[+el.dataset.d] = 1; any = true; } });
        for (const j of base) j.restraint = any ? fx : null;
        UI.toast('Restraints assigned to ' + base.length + ' base joints');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---- Assign: joint additional mass
  UI.assignJointMassDialog = function () {
    const m = app.model;
    const top = m.stories[m.stories.length - 1].elevation;
    const targets = m.joints.filter(j => Math.abs(j.z - top) < 1e-6);
    UI.dialog('Joint Additional Mass', `
      <div class="text-slate-500">Lumped mass (tonnes) at the TOP story joints (${targets.length} joints) — tributary cladding/services.
      Honored when Define &gt; Mass Source includes additional masses.</div>
      ${frow('jm-m', 'Mass per joint (t)', 2, 0.5)}`, [
      ['Cancel', null],
      ['Clear All', () => { m.jointMasses = []; UI.toast('Joint masses cleared'); UI.refreshAll(); }],
      ['Assign to Top Story', () => {
        const mt = num('jm-m') || 0;
        for (const j of targets) {
          m.jointMasses = m.jointMasses.filter(x => x.jointId !== j.id);
          if (mt > 0) m.jointMasses.push({ jointId: j.id, m: mt });
        }
        UI.toast(mt > 0 ? mt + ' t per joint on ' + targets.length + ' joints' : 'cleared');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---- Assign: section to selection
  UI.assignFrameSectionDialog = function () {
    const m = app.model;
    if (!app.sel.length) { UI.toast('Select members first (click in the viewport)', true); return; }
    UI.dialog('Assign Frame Section', `
      <div class="text-slate-500">${app.sel.length} member(s) selected.</div>
      <div class="flex items-center justify-between"><label>Section</label>
        <select id="as-sec" class="rc-input" style="width:150px">${m.sections.map(s => `<option>${s.id}</option>`).join('')}</select></div>`, [
      ['Cancel', null],
      ['Assign', () => {
        const v = document.getElementById('as-sec').value;
        for (const f of app.sel) f.section = v;
        UI.toast(v + ' assigned to ' + app.sel.length + ' member(s)');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---- Assign: distributed frame load
  UI.assignFrameLoadDialog = function () {
    const m = app.model;
    if (!app.sel.length) { UI.toast('Select members first', true); return; }
    UI.dialog('Assign Frame Distributed Load', `
      <div class="text-slate-500">${app.sel.length} member(s) selected.</div>
      <div class="flex items-center justify-between"><label>Pattern</label>
        <select id="fl-pat" class="rc-input" style="width:130px">${m.patterns.map(p => `<option>${p.id}</option>`).join('')}</select></div>
      ${frow('fl-w', 'Magnitude (kN/m)', 10, 0.5)}
      <div class="flex items-center justify-between"><label>Direction</label>
        <select id="fl-dir" class="rc-input" style="width:130px">${['gravity', '+x', '-x', '+y', '-y'].map(d => `<option>${d}</option>`).join('')}</select></div>`, [
      ['Cancel', null],
      ['Assign', () => {
        const pat = document.getElementById('fl-pat').value;
        const w = num('fl-w') || 0;
        const dir = document.getElementById('fl-dir').value;
        for (const f of app.sel) {
          m.frameLoads = m.frameLoads.filter(l => !(l.frameId === f.id && l.pattern === pat));
          m.frameLoads.push({ frameId: f.id, pattern: pat, w, dir });
        }
        UI.toast(w + ' kN/m (' + pat + ') on ' + app.sel.length + ' member(s)');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---- Assign: base restraints
  UI.assignRestraintDialog = function () {
    const m = app.model;
    const zMin = Math.min(...m.stories.map(s => s.elevation));
    const base = m.joints.filter(j => Math.abs(j.z - zMin) < 1e-6);
    const fixedN = base.filter(j => j.restraint !== 'pinned').length;
    UI.dialog('Joint Restraints (Supports)', `
      <div class="text-slate-500">${base.length} base joints. Default: fixed (all 6 DOF).</div>
      <div class="flex items-center justify-between"><label>Restraint</label>
        <select id="sp-fix" class="rc-input" style="width:130px"><option value="fixed">Fixed</option><option value="pinned">Pinned</option></select></div>
      <div class="text-slate-500">Or use the Draw ▸ Restraints tool to click-toggle individual joints.</div>`, [
      ['Cancel', null],
      ['Assign to Base', () => {
        const v = document.getElementById('sp-fix').value;
        for (const j of base) j.restraint = v;
        UI.toast(v + ' restraints on ' + base.length + ' base joints');
        UI.refreshAll();
      }, true],
    ]);
  };

  // ---------------------------------------------------------------- analyze
  UI.runAnalysis = function () {
    const t0 = performance.now();
    const res = RCModel.runAnalysis(app.model, {}); // standard linear
    const ms = Math.round(performance.now() - t0);
    if (res.error) { UI.toast(res.error, true); return; }
    // bbox for diagram scaling
    let mx = 1e-9;
    for (const j of app.model.joints) mx = Math.max(mx, Math.abs(j.x), Math.abs(j.y), Math.abs(j.z));
    res.bbox = mx * 2;
    app.locked = true;
    UI.updateLock();
    app.disp = { kind: 'moment', combo: 0, scale: 80 };
    UI.setDisplay('moment');
    const auto = res.auto;
    UI.toast('Analysis complete (' + ms + ' ms' + (auto && auto.seismic ? ' · V = ' + auto.seismic.V.toFixed(0) + ' kN' : '') + ')');
    UI.refreshAll();
  };

  UI.runModal = function () {
    const t0 = performance.now();
    const res = RCModel.runModal(app.model, { nModes: 6 });
    if (res.error) { UI.toast(res.error, true); return; }
    const ms = Math.round(performance.now() - t0);
    const rows = res.modes.map((mo, i) => `<tr>
      <td class="p-1 border">${i + 1}</td>
      <td class="p-1 border text-right">${mo.T.toFixed(3)} s</td>
      <td class="p-1 border text-right">${mo.f.toFixed(2)} Hz</td>
      <td class="p-1 border text-right">${(mo.massRatio.x * 100).toFixed(0)}% / ${(mo.massRatio.y * 100).toFixed(0)}% / ${(mo.massRatio.z * 100).toFixed(0)}%</td></tr>`).join('');
    UI.dialog('Modal Analysis — Ritz vectors (Wilson/CSI), ' + ms + ' ms', `
      ${res.mechanisms ? `<div class="text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">⚠ ${res.mechanisms} mechanism(s): the structure can sway rigidly (pin-based unbraced frame?). Results below exclude them.</div>` : ''}
      <table class="w-full text-xs border-collapse border border-slate-300">
        <tr class="bg-slate-100 text-left"><th class="p-1 border">#</th><th class="p-1 border">T (s)</th><th class="p-1 border">f (Hz)</th><th class="p-1 border">Mass X/Y/Z</th></tr>
        ${rows}
      </table>`, [['Close', null, true]]);
  };

  // ---------------------------------------------------------------- display
  UI.setDisplay = function (kind) {
    const m = app.model;
    if (kind !== 'model' && kind !== 'undeformed' && !m.results && kind !== 'reactions') {
      UI.toast('Run the analysis first (F5)', true);
      return;
    }
    if (kind === 'undeformed') kind = 'model';
    ['btnUndeformed', 'btnDeformed', 'btnMoment', 'btnShear', 'btnAxial'].forEach(id => document.getElementById(id).classList.remove('active'));
    const btn = { model: 'btnUndeformed', deformed: 'btnDeformed', moment: 'btnMoment', shear: 'btnShear', axial: 'btnAxial' }[kind];
    if (btn) document.getElementById(btn).classList.add('active');
    if (kind === 'reactions') { UI.resultsTable(); return; }
    app.disp.kind = kind;
    document.getElementById('displayModeTitle').textContent = { model: 'Undeformed', deformed: 'Deformed ×' + app.disp.scale, moment: 'Moment M3-3', shear: 'Shear V2-2', axial: 'Axial P' }[kind];
    document.getElementById('comboLabel').textContent = m.results ? (m.results.combos[app.disp.combo] || '') : '';
    UI.legend();
    UI.explorer();
    V3.build();
    app.plan.draw();
  };

  UI.resultsTable = function () {
    const res = app.model.results;
    if (!res) { UI.toast('Run the analysis first', true); return; }
    const comboSel = `<select id="rt-combo" class="rc-input" style="width:220px" onchange="app.disp.combo=this.selectedIndex;UI.setDisplay(app.disp.kind)">${res.combos.map((c, i) => `<option ${i === app.disp.combo ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
    let sumRz = 0, sumFx = 0;
    const r = res.results[app.disp.combo] || res.results[0];
    if (r) for (const rr of r.reactions) { sumRz += rr.R[2]; sumFx += rr.R[0]; }
    const rows = res.envelope.filter(e2 => e2.maxM > 0 || e2.maxN > 0).slice(0, 40).map(e2 =>
      `<tr><td class="p-1 border">${e2.kind}</td><td class="p-1 border">${e2.frameId}</td>
       <td class="p-1 border text-right">${(e2.maxM / 1e6).toFixed(1)}</td>
       <td class="p-1 border text-right">${(e2.maxV / 1e3).toFixed(1)}</td>
       <td class="p-1 border text-right">${(e2.maxN / 1e3).toFixed(1)}</td>
       <td class="p-1 border">${e2.gov || ''}</td></tr>`).join('');
    const drift = res.storyDrift.map(d => `<tr><td class="p-1 border">${d.story}</td><td class="p-1 border text-right">${d.ratio.toFixed(4)}</td></tr>`).join('');
    UI.dialog('Analysis Results — forces, reactions, drift', `
      <div class="flex gap-2 items-center"><span class="font-semibold">Combination:</span>${comboSel}
      <span class="ml-2 text-slate-500">ΣRz = ${(sumRz / 1e3).toFixed(0)} kN · ΣFx = ${(sumFx / 1e3).toFixed(0)} kN${res.auto.seismic ? ' · Seismic V = ' + res.auto.seismic.V.toFixed(0) + ' kN (Cs ' + res.auto.seismic.cs.toFixed(3) + ')' : ''}</span></div>
      ${res.storyDrift.length ? `<table class="w-full text-xs border-collapse border border-slate-300"><tr class="bg-slate-100"><th class="p-1 border">Story</th><th class="p-1 border">Drift ratio</th></tr>${drift}</table>` : ''}
      <table class="w-full text-xs border-collapse border border-slate-300">
        <tr class="bg-slate-100 text-left"><th class="p-1 border">Kind</th><th class="p-1 border">Frame</th><th class="p-1 border">M max (kN·m)</th><th class="p-1 border">V max (kN)</th><th class="p-1 border">P max (kN)</th><th class="p-1 border">Combo</th></tr>
        ${rows}
      </table>`, [['Close', null, true]]);
  };

  // ---------------------------------------------------------------- tools
  UI.setDrawTool = function (tool) {
    app.tool = tool;
    document.querySelectorAll('#tool_select,#tool_column,#tool_beam,#tool_restraint').forEach(b => b.classList.remove('active'));
    const b = document.getElementById('tool_' + tool);
    if (b) b.classList.add('active');
    const banner = document.getElementById('drawPromptBanner');
    const txt = document.getElementById('drawPromptText');
    const prompts = {
      select: null,
      column: 'Quick Columns: click a grid intersection (column rises from the story below)',
      beam: 'Draw Beams: click the start joint, then the end joint (chain on; right-click ends)',
      restraint: 'Restraints: click a joint to cycle fixed → pinned → free',
    };
    if (prompts[tool]) { txt.textContent = prompts[tool]; banner.classList.remove('hidden'); }
    else banner.classList.add('hidden');
    document.getElementById('statusHint').textContent = tool === 'select'
      ? 'Select: click a beam/column to inspect'
      : prompts[tool];
  };

  UI.setViewMode = function (mode) {
    app.planMode = mode === 'PLAN';
    document.getElementById('planCanvas').classList.toggle('hidden', !app.planMode);
    document.getElementById('cadCanvas').classList.toggle('hidden', app.planMode);
    document.getElementById('viewportTitle').textContent = app.planMode
      ? 'Plan View — ' + app.model.stories[app.story].name
      : '3D View — Global Coordinate System';
    if (!app.planMode) { V3.resize(); V3.setAngle('iso'); }
    else app.plan.draw();
  };

  UI.toggleExtrude = function () {
    app.extrude = !app.extrude;
    document.getElementById('extrudeLabel').textContent = app.extrude ? 'ON' : 'OFF';
    V3.build();
  };

  UI.deleteSelected = function () {
    const m = app.model;
    if (!app.sel.length) return;
    m.frames = m.frames.filter(f => !app.sel.includes(f));
    // clean orphan joints
    const used = new Set();
    for (const f of m.frames) { used.add(f.i); used.add(f.j); }
    m.joints = m.joints.filter(j => used.has(j.id));
    m.frameLoads = m.frameLoads.filter(l => !app.sel.some(f => f.id === l.frameId));
    app.sel = [];
    UI.toast('Deleted');
    UI.refreshAll();
  };

  UI.updateLock = function () {
    const badge = document.getElementById('lockStatusBadge');
    if (app.locked) {
      badge.className = 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[10px] px-1.5 py-0.5 rounded font-mono';
      badge.innerHTML = '<i class="fa-solid fa-lock mr-1"></i>ANALYZED';
    } else {
      badge.className = 'bg-amber-600/30 text-amber-300 border border-amber-500/40 text-[10px] px-1.5 py-0.5 rounded font-mono';
      badge.innerHTML = '<i class="fa-solid fa-lock-open mr-1"></i>UNLOCKED';
    }
  };

  // ---------------------------------------------------------------- file
  UI.saveModel = function () {
    const a = document.createElement('a');
    a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(app.model));
    a.download = 'rc-studio-model.json';
    a.click();
    UI.toast('Model saved');
  };
  UI.exportModelJSON = function () { UI.saveModel(); };
  UI.openFile = function (file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        app.model = JSON.parse(r.result);
        app.sel = [];
        app.story = Math.min(app.story, app.model.stories.length - 1);
        UI.toast('Model loaded');
        UI.refreshAll();
        V3.setAngle('iso');
      } catch (e) { UI.toast('Invalid model file', true); }
    };
    r.readAsText(file);
  };

  // ---------------------------------------------------------------- misc
  let toastT;
  UI.toast = function (msg, err) {
    let t = document.getElementById('rcToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'rcToast';
      t.style.cssText = 'position:fixed;bottom:38px;right:12px;background:#0f172a;color:#fff;padding:8px 14px;border-radius:6px;font:12px system-ui;z-index:1000;transition:opacity .3s;box-shadow:0 4px 14px rgba(0,0,0,.4)';
      document.body.appendChild(t);
    }
    t.style.borderColor = err ? '#dc2626' : '#0ea5e9';
    t.innerHTML = (err ? '<span style="color:#f87171">⚠ </span>' : '') + msg;
    t.style.opacity = 1;
    clearTimeout(toastT);
    toastT = setTimeout(() => t.style.opacity = 0, 2600);
  };

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { });
    else document.exitFullscreen().catch(() => { });
  }
  window.toggleFullscreen = toggleFullscreen;

  UI.wireShortcuts = function () {
    window.addEventListener('keydown', e => {
      if (e.key === 'F5') { e.preventDefault(); UI.runAnalysis(); }
      else if (e.key === 'F4') { e.preventDefault(); UI.setDisplay('model'); }
      else if (e.key === 'F6') { e.preventDefault(); UI.setDisplay('deformed'); }
      else if (e.key === 'F7') { e.preventDefault(); UI.setDisplay('moment'); }
      else if (e.key === 'Escape') { UI.setDrawTool('select'); app.select(null); }
      else if (e.key === 'Delete') UI.deleteSelected();
      else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const z = app.elev();
        const mine = app.model.frames.filter(f => {
          const a = RCModel.jointById(app.model, f.i);
          return f.kind === 'beam' ? Math.abs(a.z - z) < 1e-6 : Math.abs(RCModel.jointById(app.model, f.j).z - z) < 1e-6;
        });
        app.selectMany(mine, false);
      }
    });
    document.getElementById('fileOpen').addEventListener('change', e => {
      if (e.target.files[0]) UI.openFile(e.target.files[0]);
      e.target.value = '';
    });
  };

  window.addEventListener('DOMContentLoaded', UI.init);
})();
