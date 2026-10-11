// rctables.js — ETABS "Show Tables" parity: the analysis and design results
// presented as database tables with the canonical ETABS table names
// (Joint Displacements, Base Reactions, Element Joint Forces - Frames,
// Concrete Column/Beam Design Summary - ACI 318-19, Material List by
// Object Type — all cTable* classes in the decompiled ETABS/CSI.ETABS).
(function (root) {
  'use strict';

  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  function grid(headers, rows, maxWidth) {
    if (!rows.length) return '<p style="font-size:11.5px;opacity:.6;margin:4px 0">No rows.</p>';
    const head = headers.map(h => `<th style="padding:3px 8px;border-bottom:1px solid #d7dde3;text-align:left;white-space:nowrap">${esc(h)}</th>`).join('');
    const body = rows.map(r => '<tr>' + r.map(c =>
      `<td style="padding:2px 8px;white-space:nowrap">${c == null ? '' : c}</td>`).join('') + '</tr>').join('');
    return `<div style="max-height:${maxWidth || '58vh'};overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:11.5px">` +
      `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // case selector: combos first, then patterns; ENVELOPE first
  function caseOptions(app) {
    const R = app.rcResults;
    const names = R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name);
    return '<option value="ENVELOPE">ENVELOPE - governing</option>' +
      names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  }

  // ------------------------------------------------ joint displacements
  // ETABS "Joint Displacements": Output Case, Story, Label, UX..RZ
  function jointDisplacements(app, comboName) {
    const U = root.RCModel.comboU(app, comboName);
    if (!U) return { name: 'Joint Displacements', headers: [], rows: [] };
    const model = app.rcResults.model;
    const nd = model.nodes;
    const rows = [];
    for (let n = 0; n < nd.length; n++) {
      const i = n * 6;
      const ux = U[i], uy = U[i + 1], uz = U[i + 2];
      const rx = U[i + 3], ry = U[i + 4], rz = U[i + 5];
      const mag = Math.max(Math.abs(ux), Math.abs(uy), Math.abs(uz));
      rows.push({ n, ux, uy, uz, rx, ry, rz, mag });
    }
    rows.sort((a, b) => b.mag - a.mag);
    const f = v => v.toFixed(4);
    return {
      name: 'Joint Displacements',
      headers: ['Node', 'X (m)', 'Y (m)', 'Z (m)', 'UX (mm)', 'UY (mm)', 'UZ (mm)', 'RX (mrad)', 'RY (mrad)', 'RZ (mrad)', '|U| max (mm)'],
      rows: rows.map(r => [r.n + 1, nd[r.n].x.toFixed(2), nd[r.n].y.toFixed(2), nd[r.n].z.toFixed(2),
        f(r.ux), f(r.uy), f(r.uz), f(r.rx * 1e3), f(r.ry * 1e3), f(r.rz * 1e3),
        `<b>${r.mag.toFixed(4)}</b>`]),
    };
  }

  // ------------------------------------------------ base reactions
  // ETABS "Base Reactions": Output Case, FX..FZ, MX..MZ per support + totals
  function baseReactions(app, comboName) {
    const R = app.rcResults;
    // per-case rows (never summed across combos — combos overlap); each
    // case gets its own subtotal row
    const sources = root.RCModel.designSources(app, comboName);
    const headers = ['Output Case', 'Node', 'FX (kN)', 'FY (kN)', 'FZ (kN)',
      'MX (kN·m)', 'MY (kN·m)', 'MZ (kN·m)'];
    const rows = [];
    for (const src of sources) {
      let t = [0, 0, 0, 0, 0, 0];
      for (const r of (src.reactions || []))
        for (let k = 0; k < 6; k++) t[k] += r.R[k] / (k < 3 ? 1e3 : 1e6);
      for (const r of (src.reactions || []))
        rows.push([src.name, r.node + 1,
          (r.R[0] / 1e3).toFixed(2), (r.R[1] / 1e3).toFixed(2), (r.R[2] / 1e3).toFixed(2),
          (r.R[3] / 1e6).toFixed(2), (r.R[4] / 1e6).toFixed(2), (r.R[5] / 1e6).toFixed(2)]);
      rows.push([`<b>Σ ${esc(src.name)}</b>`, '',
        `<b>${t[0].toFixed(1)}</b>`, `<b>${t[1].toFixed(1)}</b>`, `<b>${t[2].toFixed(1)}</b>`,
        t[3].toFixed(1), t[4].toFixed(1), t[5].toFixed(1)]);
    }
    return { name: 'Base Reactions', headers, rows };
  }

  // ------------------------------------------ material list by object type
  // ETABS "Material List by Object Type": type, section, count, volume
  function materialList(app) {
    const R = app.rcResults;
    const model = R.model;
    const d = root.RCDefine.ensure(app);
    const acc = new Map();
    for (const ent of app.bim.entities) {
      if (!['beam', 'column', 'wall', 'slab', 'floor', 'roof'].includes(ent.type)) continue;
      const sec = d.frameSections.find(s2 => s2.name === ent.params.designSection) ||
        d.areaSections.find(s2 => s2.name === ent.params.designSection);
      const secName = sec ? sec.name : '—';
      const matName = ent.params.materialOverwrite || (sec ? sec.material : 'CONC25');
      let vol = 0;
      const p = ent.params;
      if (ent.type === 'beam') {
        const bl = p.baseline; if (!bl) continue;
        const L = Math.hypot(bl[1][0] - bl[0][0], bl[1][1] - bl[0][1], bl[1][2] - bl[0][2]);
        vol = (p.width || 0.3) * (p.height || 0.5) * L;
      } else if (ent.type === 'column') {
        vol = (p.width || 0.4) * (p.depth || 0.4) * ((+p.height || 3));
      } else if (ent.type === 'wall') {
        if (!p.base || !p.end) continue;
        const L = Math.hypot(p.end[0] - p.base[0], p.end[1] - p.base[1]);
        vol = L * (+p.height || 3) * (p.thickness || 0.2);
      } else {
        if (!p.regions) continue;
        // shoelace over each region's outer ring (m²) × thickness
        for (const reg of p.regions) {
          const o = (reg.outer || []).map(q => [q[0], q[1]]);
          if (o.length < 3) continue;
          let A = 0;
          for (let i = 0, j = o.length - 1; i < o.length; j = i++)
            A += (o[j][0] + o[i][0]) * (o[j][1] - o[i][1]);
          vol += Math.abs(A / 2) * (p.thickness || 0.2);
        }
      }
      const key = `${ent.type}|${secName}|${matName}`;
      const a = acc.get(key) || { type: ent.type, sec: secName, mat: matName, n: 0, vol: 0 };
      a.n++; a.vol += vol;
      acc.set(key, a);
    }
    return {
      name: 'Material List by Object Type',
      headers: ['Type', 'Section', 'Material', 'Count', 'Total Volume (m³)'],
      rows: [...acc.values()].sort((a, b) => b.vol - a.vol)
        .map(a => [a.type, a.sec, a.mat, a.n, `<b>${a.vol.toFixed(2)}</b>`]),
    };
  }

  // --------------------------------- concrete column design summary (ACI)
  // ETABS "Concrete Column Design Summary - ACI 318-19": Story, Label,
  // Station, PMMCombo, PMMRatio, As, VMaj/VMin combos+rebar, Status
  function columnSummary(app) {
    const d = root.RCDefine.ensure(app);
    const res = root.RCColumn.designAllColumns(app, 'ENVELOPE', 'design', true);
    if (res.error) return { name: 'error', headers: [], rows: [[res.error]] };
    const lvlName = ent => {
      const lvl = app.levelManager.levels.find(l => l.id === (ent.params.baseLevel || ''));
      return lvl ? lvl.name : (ent.params.base ? 'z=' + (+ent.params.base[2]).toFixed(1) : '—');
    };
    const rows = res.results.map(r => {
      const color = r.dcr > 1 ? '#c62828' : r.dcr > 0.9 ? '#f57f17' : '#2e7d32';
      const ed = root.RCModel.elementDeflections(app, 'ENVELOPE');
      const driftOf = id => { const c2 = ed.columns.find(x => x.id === id); return c2 ? c2.drift : null; };
      return [
        lvlName(window.app.bim.getEntityById(r.id) || {}),
        esc(r.id), 'Top', esc(r.combo || '—'),
        `<b style="color:${r.dcr > 1 ? '#c62828' : '#2e7d32'}">${r.dcr.toFixed(3)}</b>`,
        `${(r.Pu).toFixed(0)}`, `${r.Mx.toFixed(1)} / ${r.My.toFixed(1)}`,
        esc(r.status), `${(r.shear.Vu).toFixed(0)} / ${r.shear.phiVn.toFixed(0)}`,
        shearDcrText(r),
        driftOf(r.id) != null ? driftOf(r.id).toFixed(2) : '—'];
    });
    return {
      name: 'Concrete Column Design Summary - ACI 318-19',
      headers: ['Story', 'Element', 'Station', 'PMM Combo', 'PMM Ratio',
        'Pu (kN)', 'Mx/My (kN·m)', 'Status', 'Vu/φVn (kN)', 'Shear DCR', 'Lateral Drift (mm)'],
      rows,
    };
  }
  function shearDcrText(r) {
    const c = r.shear && r.shear.dcr > 1 ? '#c62828' : '#2e7d32';
    return `<b style="color:${c}">${r.shear ? r.shear.dcr.toFixed(3) : '—'}</b>`;
  }

  // ---------------------------------- concrete beam design summary (ACI)
  // ETABS "Concrete Beam Design Summary - ACI 318-19": Top/Bot combos +
  // rebar, shear, plus our deflection check (ETABS ImmediateDeflection)
  function beamSummary(app) {
    const res = root.RCBeam.designAllBeams(app, 'ENVELOPE');
    if (res.error) return { name: 'error', headers: [], rows: [[res.error]] };
    const defs = root.RCModel.beamDeflections(app, 'ENVELOPE') || new Map();
    const rows = res.results.map(r => {
      const v = defs.get(r.id);
      const dcr = (r.MuTop + r.MuBot) > 0.5 ? 0.9 : 0.3; // governed by rebar selection
      return [
        esc(r.id), esc(r.combo || '—'),
        `${(r.MuTop / 1e6).toFixed(1)} / ${(r.MuBot / 1e6).toFixed(1)}`,
        `${Math.round(r.AsTop)} / ${Math.round(r.AsBot)}`,
        r.stirrups ? `Ø${r.stirrups.dia}@${r.stirrups.spacing}` : '—',
        (r.Vu / 1e3).toFixed(1),
        v ? `${v.dmax_mm.toFixed(2)} (1/${v.ratio})` : '—',
        v ? (v.ok250 ? '<span style="color:#2e7d32">OK</span>' : '<span style="color:#c62828">OVER</span>') : '—'];
    });
    return {
      name: 'Concrete Beam Design Summary - ACI 318-19',
      headers: ['Element', 'Combo', 'Mu Top/Bot (kN·m)', 'As Top/Bot (mm²)',
        'Stirrups', 'Vu (kN)', 'δmax (mm, 1/L)', 'L/250'],
      rows,
    };
  }

  // ------------------------------------------------ story drifts (ETABS)
  // "Story Drifts": Story, Direction, Drift, Drift Ratio per level pair
  function storyDrifts(app, comboName) {
    const ed = root.RCModel.elementDeflections(app, comboName);
    if (!ed || !ed.stories.length) return { name: 'Story Drifts', headers: ['Story'], rows: [['No displacement data']] };
    const rows = [];
    for (const st of ed.stories) {
      const rx = Math.abs(st.ratioX), ryy = Math.abs(st.ratioY);
      rows.push([st.story, 'X', st.driftX.toFixed(2), (rx * 100).toFixed(4) + '%',
        Math.abs(st.driftX) > st.limit ? '<span style="color:#c62828">OVER L/500</span>' : '<span style="color:#2e7d32">OK</span>']);
      rows.push([st.story, 'Y', st.driftY.toFixed(2), (ryy * 100).toFixed(4) + '%',
        Math.abs(st.driftY) > st.limit ? '<span style="color:#c62828">OVER L/500</span>' : '<span style="color:#2e7d32">OK</span>']);
    }
    return { name: 'Story Drifts', headers: ['Story', 'Direction', 'Drift (mm)', 'Drift/Height', 'L/500 Ref'], rows };
  }

  // ------------------------------------------------ slab deflections
  // max |Uz| over the slab mesh + relative (max − min) = panel service δ
  function slabDeflections(app, comboName) {
    const ed = root.RCModel.elementDeflections(app, comboName);
    if (!ed || !ed.slabs.length) return { name: 'Slab Deflections', headers: ['Slab'], rows: [['No displacement data']] };
    return {
      name: 'Slab Deflections',
      headers: ['Slab', 'Max |UZ| (mm)', 'Relative δ max−min (mm)', 'Mesh Nodes'],
      rows: ed.slabs.map(sl => [sl.id, sl.maxUz.toFixed(3), sl.rel.toFixed(3), sl.nNodes]),
    };
  }

  // ============================================================ dialog
  const TABLES = [
    ['Joint Displacements', 'jointDisplacements', true],
    ['Story Drifts', 'storyDrifts', true],
    ['Slab Deflections', 'slabDeflections', true],
    ['Base Reactions', 'baseReactions', true],
    ['Concrete Column Design Summary - ACI 318-19', 'columnSummary', false],
    ['Concrete Beam Design Summary - ACI 318-19', 'beamSummary', false],
    ['Material List by Object Type', 'materialList', false],
  ];

  function open(app, cat) {
    if (cat !== 'analysisTables') return;
    if (!app.rcResults) { app.toast('Run the analysis first', true); return; }
    root.RCModel.ensureAutoCombos(app);
    const html = [
      '<p style="margin:0 0 6px;font-size:12px;opacity:.8">ETABS Show Tables parity — analysis and design results as database tables.</p>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:260px;flex:none;opacity:.75;font-size:12px">Table</span>' +
      `<select id="at-table" style="flex:1;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${TABLES.map(t2 => `<option value="${t2[1]}">${esc(t2[0])}</option>`).join('')}</select></div>`,
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:260px;flex:none;opacity:.75;font-size:12px">Load Case / Combination</span>' +
      `<select id="at-case" style="flex:1;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${caseOptions(app)}</select></div>`,
      '<div id="at-body" style="margin-top:6px"></div>',
    ].join('');
    app.dialog('Show Tables — Analysis & Design Data', html, [['Close', null]]);
    const render = () => {
      const tName = document.getElementById('at-table').value;
      const cName = document.getElementById('at-case').value;
      const tDef = TABLES.find(t2 => t2[1] === tName);
      let t;
      try {
        t = root.RCTables[tDef[1]](app, cName);
      } catch (e) {
        document.getElementById('at-body').innerHTML =
          `<p style="font-size:11.5px;color:#c62828">${esc(String(e && e.message).slice(0, 120))}</p>`;
        return;
      }
      const title = `<p style="font-size:12px;margin:0 0 4px"><b>${esc(t.name)}</b>` +
        (tDef[2] ? ` · case: <b>${esc(cName)}</b>` : '') + '</p>';
      document.getElementById('at-body').innerHTML = title + grid(t.headers, t.rows);
    };
    document.getElementById('at-table').addEventListener('change', render);
    document.getElementById('at-case').addEventListener('change', render);
    setTimeout(render, 0);
  }

  root.RCTables = { open, jointDisplacements, baseReactions, materialList, columnSummary, beamSummary, storyDrifts, slabDeflections };
})(window);
