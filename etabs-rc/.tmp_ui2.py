import io
p = 'js/app.js'
s = io.open(p, encoding='utf-8', newline='').read()

# ---- menu entries: Define gains Materials + Mass Source; Assign gains Releases + Additional Mass
old = """    <div class="relative menu-item">
      <button class="px-2.5 py-1 hover:bg-slate-300 rounded">Define</button>
      <div class="menu-dropdown">
        <div class="dropdown-row" onclick="UI.sectionsDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-shapes text-sky-600"></i> Section Properties...</span></div>"""
assert s.count(old) == 1
new = """    <div class="relative menu-item">
      <button class="px-2.5 py-1 hover:bg-slate-300 rounded">Define</button>
      <div class="menu-dropdown">
        <div class="dropdown-row" onclick="UI.materialsDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-cubes text-emerald-600"></i> Materials...</span></div>
        <div class="dropdown-row" onclick="UI.sectionsDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-shapes text-sky-600"></i> Section Properties...</span></div>
        <div class="dropdown-divider"></div>
        <div class="dropdown-row" onclick="UI.massSourceDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-weight-scale text-indigo-600"></i> Mass Source...</span></div>"""
s = s.replace(old, new)

old = """        <div class="dropdown-row" onclick="UI.assignFrameSectionDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-tag text-sky-600"></i> Frame -> Section Property...</span></div>
        <div class="dropdown-row" onclick="UI.assignFrameLoadDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-arrows-down-to-line text-rose-600"></i> Frame -> Distributed Load...</span></div>
        <div class="dropdown-row" onclick="UI.assignRestraintDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-anchor text-amber-600"></i> Joint -> Restraints (base joints)...</span></div>"""
assert s.count(old) == 1
new = """        <div class="dropdown-row" onclick="UI.assignFrameSectionDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-tag text-sky-600"></i> Frame -> Section Property...</span></div>
        <div class="dropdown-row" onclick="UI.assignFrameLoadDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-arrows-down-to-line text-rose-600"></i> Frame -> Distributed Load...</span></div>
        <div class="dropdown-row" onclick="UI.assignReleasesDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-unlink text-purple-600"></i> Frame -> Releases / Partial Fixity...</span></div>
        <div class="dropdown-divider"></div>
        <div class="dropdown-row" onclick="UI.assignRestraintDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-anchor text-amber-600"></i> Joint -> Restraints (Supports)...</span></div>
        <div class="dropdown-row" onclick="UI.assignJointMassDialog()"><span class="flex items-center gap-2"><i class="fa-solid fa-weight-hanging text-indigo-600"></i> Joint -> Additional Mass...</span></div>"""
s = s.replace(old, new)

# ---- insert the new dialogs before "// ---- Assign: section to selection"
anchor = "  // ---- Assign: section to selection"
idx = s.index(anchor)
new_dialogs = '''  // ---- Define: materials (ETABS Define > Materials)
  UI.materialsDialog = function () {
    const m = app.model;
    const rows = m.materials.map((mt, i) => `<tr>
      <td><input class="rc-input mat-id" data-i="${i}" value="${mt.id}" style="width:60px"></td>
      <td><input class="rc-input mat-name" data-i="${i}" value="${mt.name}" style="width:130px"></td>
      <td><input type="number" step="500" class="rc-input mat-ec" data-i="${i}" value="${mt.Ec}"></td>
      <td><input type="number" step="0.5" class="rc-input mat-d" data-i="${i}" value="${mt.density}"></td>
      <td><input type="number" step="5" class="rc-input mat-fc" data-i="${i}" value="${mt.fc}"></td></tr>`).join('');
    UI.dialog('Materials', `
      <table class="w-full text-xs border-collapse"><tr class="text-left text-slate-500"><th>Id</th><th>Name</th><th>Ec (MPa)</th><th>γ (kN/m³)</th><th>f'c (MPa)</th></tr>${rows}</table>
      <div class="text-slate-500">Sections reference a material by id; Ec drives the stiffness, γ the self-weight and seismic mass.</div>`, [
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
      <div class="text-slate-500">What the modal analysis and the auto-seismic weight count as mass.</div>
      <label class="flex items-center gap-2"><input type="checkbox" id="ms-sw" ${ms.selfWeight !== false ? 'checked' : ''}> Element self-weight</label>
      <label class="flex items-center gap-2"><input type="checkbox" id="ms-ad" ${ms.additional !== false ? 'checked' : ''}> Additional joint masses (Assign > Joint > Mass)</label>
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
      <div class="text-slate-500">${app.sel.length} member(s) — applies to all selected (ETABS convention).</div>
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
      <div class="text-slate-500">M3 release = pin the major-axis moment (simply-supported beams; the classic ETABS beam release).</div>`, [
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

  // ---- Assign: joint restraints (ETABS DOF form)
  UI.assignRestraintDialog = function () {
    const m = app.model;
    const zMin = Math.min(...m.stories.map(s => s.elevation));
    const base = m.joints.filter(j => Math.abs(j.z - zMin) < 1e-6);
    UI.dialog('Joint Restraints (Supports) — base joints: ' + base.length, `
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
    const zMin = Math.min(...m.stories.map(s => s.elevation));
    const top = m.stories[m.stories.length - 1].elevation;
    const targets = m.joints.filter(j => Math.abs(j.z - top) < 1e-6);
    UI.dialog('Joint Additional Mass', `
      <div class="text-slate-500">Adds lumped mass (tonnes) at the TOP story joints (${targets.length} joints) — tributary cladding/services.
      Honored when Define > Mass Source includes additional masses.</div>
      ${frow('jm-m', 'Mass per joint (t)', 2, 0.5)}`, [
      ['Cancel', null],
      ['Clear All', () => { m.jointMasses = []; UI.toast('Joint masses cleared'); UI.refreshAll(); }],
      ['Assign to Top Story', () => {
        const mt = num('jm-m') || 0;
        for (const j of targets) {
          m.jointMasses = m.jointMasses.filter(x => x.jointId !== j.id);
          if (mt > 0) m.jointMasses.push({ jointId: j.id, m: mt });
        }
        UI.toast((mt > 0 ? mt + ' t per joint on ' + targets.length + ' joints' : 'cleared'));
        UI.refreshAll();
      }, true],
    ]);
  };

'''
s = s[:idx] + new_dialogs + s[idx:]

# ---- sections dialog: ETABS-style with material + summary
old = """  // ---- Define: sections
  UI.sectionsDialog = function () {
    const m = app.model;
    const rows = m.sections.map((s, i) => `<tr>
      <td><input class="rc-input sec-id" data-i="${i}" value="${s.id}" style="width:80px"></td>
      <td><select class="rc-input sec-kind" data-i="${i}"><option ${s.kind === 'column' ? 'selected' : ''}>column</option><option ${s.kind === 'beam' ? 'selected' : ''}>beam</option></select></td>
      <td><input type="number" step="0.05" class="rc-input sec-b" data-i="${i}" value="${s.b}"></td>
      <td><input type="number" step="0.05" class="rc-input sec-h" data-i="${i}" value="${s.h}"></td></tr>`).join('');
    UI.dialog('Frame Section Properties (Concrete)', `
      <table class="w-full text-xs border-collapse"><tr class="text-left text-slate-500"><th>Id</th><th>Type</th><th>b (m)</th><th>h (m)</th></tr>${rows}</table>
      <button onclick="UI.addSectionRow()" class="etabs-btn bg-slate-100 border-slate-300">+ Add</button>`, ["""
assert s.count(old) == 1
new = """  // ---- Define: sections (ETABS Frame Properties form: list + summary)
  UI.sectionsDialog = function () {
    const m = app.model;
    const rows = m.sections.map((s, i) => `<tr>
      <td><input class="rc-input sec-id" data-i="${i}" value="${s.id}" style="width:80px"></td>
      <td><select class="rc-input sec-kind" data-i="${i}"><option ${s.kind === 'column' ? 'selected' : ''}>column</option><option ${s.kind === 'beam' ? 'selected' : ''}>beam</option></select></td>
      <td><input type="number" step="0.05" class="rc-input sec-b" data-i="${i}" value="${s.b}"></td>
      <td><input type="number" step="0.05" class="rc-input sec-h" data-i="${i}" value="${s.h}"></td>
      <td><select class="rc-input sec-mat" data-i="${i}">${m.materials.map(mt => `<option ${(s.material || 'C30') === mt.id ? 'selected' : ''}>${mt.id}</option>`).join('')}</select></td>
      <td class="font-mono text-[10px] text-slate-500 sec-sum" data-i="${i}"></td></tr>`).join('');
    UI.dialog('Frame Section Properties', `
      <table class="w-full text-xs border-collapse"><tr class="text-left text-slate-500"><th>Id</th><th>Type</th><th>b (m)</th><th>h (m)</th><th>Material</th><th>A / I33</th></tr>${rows}</table>
      <button onclick="UI.addSectionRow()" class="etabs-btn bg-slate-100 border-slate-300">+ Add</button>`, ["""
s = s.replace(old, new)

# save handler stores material + updates summaries
old = """      ['Save', () => {
        document.querySelectorAll('.sec-id').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.id = el.value.trim() || s.id; });
        document.querySelectorAll('.sec-kind').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.kind = el.value; });
        document.querySelectorAll('.sec-b').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.b = parseFloat(el.value) || s.b; });
        document.querySelectorAll('.sec-h').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.h = parseFloat(el.value) || s.h; });
        UI.toast('Sections saved');
        UI.refreshAll();
      }, true],"""
assert s.count(old) == 1
s = s.replace(old, """      ['Save', () => {
        document.querySelectorAll('.sec-id').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.id = el.value.trim() || s.id; });
        document.querySelectorAll('.sec-kind').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.kind = el.value; });
        document.querySelectorAll('.sec-b').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.b = parseFloat(el.value) || s.b; });
        document.querySelectorAll('.sec-h').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.h = parseFloat(el.value) || s.h; });
        document.querySelectorAll('.sec-mat').forEach(el => { const s = m.sections[+el.dataset.i]; if (s) s.material = el.value; });
        UI.toast('Sections saved');
        UI.refreshAll();
      }, true],""")

# inspector: releases + material
old = """    el.innerHTML = `
      <div class="flex justify-between"><span>Element:</span><span class="font-bold text-sky-800">${f.kind === 'column' ? 'Column' : 'Beam'} ${f.id}</span></div>
      <div class="flex justify-between"><span>Section:</span><span>${f.section}</span></div>
      <div class="flex justify-between"><span>Length:</span><span>${L.toFixed(2)} m</span></div>
      ${loads ? `<div class="flex justify-between"><span>Loads:</span><span>${loads}</span></div>` : ''}
      ${resLine}`;"""
assert s.count(old) == 1
s = s.replace(old, """    const rel = (f.releaseI && f.releaseI.m3) || (f.releaseJ && f.releaseJ.m3) ? 'M3 released' : '';
    el.innerHTML = `
      <div class="flex justify-between"><span>Element:</span><span class="font-bold text-sky-800">${f.kind === 'column' ? 'Column' : 'Beam'} ${f.id}</span></div>
      <div class="flex justify-between"><span>Section:</span><span>${f.section}</span></div>
      <div class="flex justify-between"><span>Length:</span><span>${L.toFixed(2)} m</span></div>
      ${rel ? `<div class="flex justify-between"><span>Releases:</span><span class="text-purple-700 font-semibold">${rel}</span></div>` : ''}
      ${loads ? `<div class="flex justify-between"><span>Loads:</span><span>${loads}</span></div>` : ''}
      ${resLine}`;""")

# DEFAULT_SECTIONS: carry material
old = "    { id: 'B30x60', kind: 'beam', b: 0.30, h: 0.60 },"
# not in app.js; patch model.js instead below
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('UI upgraded')
