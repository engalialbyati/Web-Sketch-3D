// rcinfo.js — ETABS-style element data on selection: applied loads,
// analysis forces per pattern/combination, and the design summary for the
// picked element. Reachable from the right-click menu and the Design
// ribbon's Element Data button.
// Original code — units as stored: loads kN/kN·m, analysis N/N·mm.
(function (root) {
  'use strict';

  const STRUCTURAL = ['beam', 'column', 'wall', 'slab', 'roof'];

  // entities under the current selection (face stamps → entity)
  function selStructuralEnts(app) {
    const out = [];
    const seen = new Set();
    for (const fid of (app.sel && app.sel.faces) || []) {
      const f = app.model.faces.get(fid);
      const uid = f && f.userData && f.userData.bimEntityId;
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      const ent = app.bim.getEntityById(uid);
      if (ent && STRUCTURAL.includes(ent.type)) out.push(ent);
    }
    return out;
  }

  // ---------------------------------------------------------- data gather
  function identity(app, ent) {
    const d = root.RCDefine.ensure(app);
    let sec = null, dims = '';
    if (ent.type === 'beam' || ent.type === 'column') {
      sec = d.frameSections.find(s => s.name === ent.params.designSection);
      const g = sec && sec.dims || {};
      dims = sec ? `${((g.b || g.bf || g.dia || 0) * 1000).toFixed(0)}×${((g.h || g.dia || 0) * 1000).toFixed(0)} mm` : '—';
    } else {
      sec = d.areaSections.find(s => s.name === ent.params.designSection);
      dims = sec ? `t = ${((sec.thickness || 0) * 1000).toFixed(0)} mm` : '—';
    }
    const mat = ent.params.materialOverwrite || (sec && sec.material) || 'default';
    return { type: ent.type, id: ent.id, section: sec ? sec.name : '(auto)', dims, material: mat };
  }

  function appliedLoads(app, ent) {
    const p = ent.params;
    const rows = [];
    for (const L of p.frameLoads || []) {
      if (L.type === 'dist')
        rows.push([L.pattern, 'Uniform', `${L.w || 0} kN/m`, L.dir || 'gravity']);
      else
        rows.push([L.pattern, 'Point', `${L.P || 0} kN @ a=${L.a || 0} m`, '']);
    }
    for (const J of p.jointLoads || [])
      rows.push([J.pattern, `Joint @ ${J.end === 'j' ? 'J' : 'I'}`, `Fx=${J.fx || 0} Fy=${J.fy || 0} Fz=${J.fz || 0} kN`, '']);
    for (const L of p.surfaceLoads || [])
      rows.push([L.pattern, 'Surface', `${L.pressure || 0} kN/m²`, L.dir === 'up' ? 'up' : 'down']);
    return rows; // [pattern, kind, magnitude, dir]
  }

  // analysis end forces for one frame member, per case (N, N·mm → kN, kN·m)
  function frameForces(R, entId, caseName) {
    const src = R.combos.find(c => c.name === caseName) || R.patterns.find(p => p.name === caseName);
    if (!src) return null;
    const m = (src.members || []).find(x => x.id === entId);
    if (!m) return null;
    const kn = v => v / 1e3, kNm = v => v / 1e6;
    let sMin = null, sMax = null;
    if (m.stations && m.stations.length) {
      for (const st of m.stations) {
        if (sMin == null || st.M < sMin) sMin = st.M;
        if (sMax == null || st.M > sMax) sMax = st.M;
      }
    }
    return {
      P: kn(Math.max(Math.abs(m.Fi || 0), Math.abs(m.Fj || 0))),
      V3: kn(Math.max(Math.abs(m.Vi || 0), Math.abs(m.Vj || 0))),
      V2: kn(Math.max(Math.abs(m.Vi2 || 0), Math.abs(m.Vj2 || 0))),
      T: kNm(Math.abs(m.Ti || 0)),
      M3i: kNm(m.Mi || 0), M3j: kNm(m.Mj || 0),
      M2i: kNm(m.Mi2 || 0), M2j: kNm(m.Mj2 || 0),
      Mmax: sMax, Mmin: sMin,
      offI: m.offI || 0, offJ: m.offJ || 0,
    };
  }

  // shell force envelope for one slab/wall entity, per case
  function shellForces(R, entId, caseName) {
    const src = R.combos.find(c => c.name === caseName) || R.patterns.find(p => p.name === caseName);
    if (!src || !src.shells) return null;
    const cells = src.shells.filter(s => s && s.forces && s.entId === entId);
    if (!cells.length) return null;
    const env = k => {
      let mx = 0, mn = 0;
      for (const c of cells) {
        const v = c.forces[k] || 0;
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
      return [mx, mn];
    };
    const out = { nCells: cells.length };
    for (const k of ['M11', 'M22', 'M12', 'Q11', 'Q22', 'N11', 'N22', 'N12']) {
      const [mx, mn] = env(k);
      out[k] = [mx / 1e3, mn / 1e3]; // kN·m/m or kN/m
    }
    return out;
  }

  // design summary for one element, on demand (memoized PM curves make this cheap)
  function designFor(app, ent, comboName) {
    const R = app.rcResults;
    if (!R) return { error: 'Run the analysis first.' };
    try {
      if (ent.type === 'beam') {
        const r = root.RCBeam.designAllBeams(app, comboName);
        return r.error ? { error: r.error } : (r.results.find(x => x.id === ent.id) || { error: 'No design row.' });
      }
      if (ent.type === 'column') {
        const r = root.RCColumn.designAllColumns(app, comboName);
        return r.error ? { error: r.error } : (r.results.find(x => x.id === ent.id) || { error: 'No design row.' });
      }
      if (ent.type === 'wall') {
        const r = root.RCWall.designAllWalls(app, comboName);
        return r.error ? { error: r.error } : (r.results.find(x => x.id === ent.id) || { error: 'No design row.' });
      }
      if (ent.type === 'slab' || ent.type === 'roof') {
        const r = root.RCSlab.designAllSlabs(app, comboName);
        return r.error ? { error: r.error } : (r.results.find(x => x.id === ent.id) || { error: 'No design row.' });
      }
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
    return { error: 'No design procedure for this type.' };
  }

  // ---------------------------------------------------------- rendering
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const table = (head, rows) => '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead><tr style="text-align:left;opacity:.7">' + head.map(h => `<th style="padding:2px 6px;border-bottom:1px solid #d7dde3">${h}</th>`).join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  const td = (v, extra) => `<td style="padding:2px 6px"${extra ? ' ' + extra : ''}>${v}</td>`;

  function renderLoads(rows) {
    if (!rows.length) return '<p style="font-size:11px;opacity:.6;margin:2px 0 0">No applied loads on this element.</p>';
    return table(['Pattern', 'Kind', 'Magnitude', 'Dir'],
      rows.map(r => '<tr>' + td(esc(r[0])) + td(esc(r[1])) + td(esc(r[2])) + td(esc(r[3])) + '</tr>'));
  }

  function renderAnalysis(ent, f) {
    if (!f) return '<p style="font-size:11px;opacity:.6;margin:2px 0 0">No forces for this element in the selected case.</p>';
    if (ent.type === 'beam' || ent.type === 'column') {
      return table(['P (kN)', 'V2 (kN)', 'V3 (kN)', 'T (kN·m)', 'M2 i/j (kN·m)', 'M3 i/j (kN·m)', 'M span max/min'],
        ['<tr>' + td(f.P.toFixed(1)) + td(f.V2.toFixed(1)) + td(f.V3.toFixed(1)) + td(f.T.toFixed(1)) +
        td(`${f.M2i.toFixed(1)} / ${f.M2j.toFixed(1)}`) + td(`${f.M3i.toFixed(1)} / ${f.M3j.toFixed(1)}`) +
        td(f.Mmax == null ? '—' : `${f.Mmax.toFixed(1)} / ${f.Mmin.toFixed(1)}`) + '</tr>' ]);
    }
    const offNote = (f.offI != null || f.offJ != null)
      ? `<p style="font-size:11px;opacity:.7;margin:2px 0 2px">Auto end offsets: I ${Math.round(f.offI || 0)} mm · J ${Math.round(f.offJ || 0)} mm — design forces taken at the adjoining member faces (ETABS auto from connectivity)</p>`
      : '';
    const row = (k) => td(`${f[k][0].toFixed(2)} / ${f[k][1].toFixed(2)}`);
    return offNote + `<p style="font-size:11px;opacity:.7;margin:2px 0 2px">${f.nCells} shell cell(s) — max/min:</p>` +
      table(['M11', 'M22', 'M12 (kN·m/m)', 'Q11', 'Q22', 'N11', 'N22', 'N12 (kN/m)'],
        ['<tr>' + ['M11', 'M22', 'M12', 'Q11', 'Q22', 'N11', 'N22', 'N12'].map(k => row(k)).join('') + '</tr>']);
  }

  function renderDesign(ent, d) {
    if (!d) return '';
    if (d.error) return `<p style="font-size:11px;color:#c62828;margin:2px 0 0">${esc(d.error)}</p>`;
    const badge = ok => ok
      ? '<span style="padding:1px 6px;border-radius:3px;font-size:10px;font-weight:bold;background:#e8f5e9;color:#2e7d32">OK</span>'
      : '<span style="padding:1px 6px;border-radius:3px;font-size:10px;font-weight:bold;background:#ffebee;color:#c62828">FAIL</span>';
    const bars = b => b ? `${b.count}Ø${b.dia}${b.spacing ? '@' + b.spacing : ''}` : '—';
    if (ent.type === 'beam') {
      return table(['Mu top/bot at faces (kN·m)', 'Vu at face (kN)', 'As req top/bot (mm²)', 'Top bars', 'Bot bars', 'Stirrups', 'Torsion'],
        ['<tr>' + td(`${(d.MuTop / 1e6).toFixed(1)} / ${(d.MuBot / 1e6).toFixed(1)}`) +
        td((d.Vu / 1e3).toFixed(1)) +
        td(`${Math.round(d.AsTop)} / ${Math.round(d.AsBot)}`) +
        td(bars(d.topBars)) + td(bars(d.botBars)) + td(d.stirrups ? `Ø${d.stirrups.dia}@${d.stirrups.spacing}` : '—') +
        td(d.torsion ? (d.torsion.needed ? (d.torsion.ok === false ? 'SECTION TOO SMALL' : `At/s=${d.torsion.AtOverS}`) : 'below threshold') : '—') + '</tr>']);
    }
    if (ent.type === 'column') {
      const dcr = d.dcr != null ? d.dcr : 0;
      return table(['Pu (kN)', 'Mx / My (kN·m)', 'DCR', 'Pcap (kN)', 'Status'],
        ['<tr>' + td(d.Pu.toFixed(0)) + td(`${d.Mx.toFixed(1)} / ${d.My.toFixed(1)}`) +
        td(`<b style="color:${dcr > 1 ? '#c62828' : '#2e7d32'}">${dcr.toFixed(2)}</b>`) +
        td(d.Pcap != null ? d.Pcap.toFixed(0) : '—') +
        td(`<b>${esc(d.status || '')}</b>`) + '</tr>']);
    }
    if (ent.type === 'wall') {
      return table(['Station', 'P (kN)', 'M (kN·m)', 'V (kN)', 'DCR', 'Avh/s (mm²/mm)', 'Status'],
        ['<tr>' + td(esc(d.station || '—')) + td(d.Pu.toFixed(0)) + td(d.Mx.toFixed(0)) + td(d.Vu.toFixed(0)) +
        td(`<b style="color:${d.dcr > 1 ? '#c62828' : '#2e7d32'}">${(d.dcr || 0).toFixed(2)}</b>`) +
        td(d.shear ? d.shear.Avhs.toFixed(4) : '—') + td(`<b>${esc(d.status || '')}</b>`) + '</tr>']);
    }
    // slab / roof
    const ow = d.owShear;
    return table(['M11 max/min', 'M22 max/min (kN·m/m)', 'D1 bot / top', 'D2 bot / top', 'One-way shear', 'Status'],
      ['<tr>' + td(`${d.maxM11.toFixed(1)} / ${d.minM11.toFixed(1)}`) + td(`${d.maxM22.toFixed(1)} / ${d.minM22.toFixed(1)}`) +
      td(`${bars(d.botBarsD1)} / ${bars(d.topBarsD1)}`) + td(`${bars(d.botBarsD2)} / ${bars(d.topBarsD2)}`) +
      td(ow ? `${(ow.Vu / 1e3).toFixed(0)} vs ${(ow.Vc / 1e3).toFixed(0)} kN/m ${badge(ow.ok)}` : '—') +
      td('') + '</tr>']);
  }

  // ---------------------------------------------------------- dialog
  function openForEntity(app, entId) {
    const ent = app.bim.getEntityById(entId);
    if (!ent || !STRUCTURAL.includes(ent.type)) { app.toast('Pick a structural element', true); return; }
    const R = app.rcResults;
    const d = root.RCDefine.ensure(app);
    const names = R ? (R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name)) : [];
    const comboSel = names.length
      ? `<select id="ei-case" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${names.map(n => `<option value="${n}">${n}</option>`).join('')}</select>`
      : '<span style="font-size:11px;opacity:.6">no analysis yet</span>';

    const body = () => {
      const id = identity(app, ent);
      const caseEl = document.getElementById('ei-case'); // absent on first render
      const caseName = names.length ? (caseEl ? caseEl.value : names[0]) : null;
      const f = caseName ? (ent.type === 'beam' || ent.type === 'column'
        ? frameForces(R, ent.id, caseName)
        : shellForces(R, ent.id, caseName)) : null;
      const des = caseName ? designFor(app, ent, caseName) : null;
      return '<div style="max-height:62vh;overflow:auto;font-size:12px">' +
        `<p style="margin:0 0 6px"><b>${esc(id.type)} ${esc(id.id)}</b> · section <b>${esc(id.section)}</b> (${esc(id.dims)}) · material ${esc(id.material)}</p>` +
        '<p style="margin:8px 0 2px;font-weight:bold;font-size:11px;opacity:.8">APPLIED LOADS</p>' + renderLoads(appliedLoads(app, ent)) +
        '<p style="margin:10px 0 2px;font-weight:bold;font-size:11px;opacity:.8">ANALYSIS — ' + esc(caseName || 'not run') + '</p>' + renderAnalysis(ent, f) +
        (caseName ? '<p style="margin:10px 0 2px;font-weight:bold;font-size:11px;opacity:.8">DESIGN — ' + esc(caseName) + '</p>' + renderDesign(ent, des) : '') +
        '</div>';
    };

    const html = [
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Case</span>' + comboSel + '</div>',
      '<div id="ei-body">' + body() + '</div>',
    ].join('');
    app.dialog('RC Element Data', html, [
      ['Refresh', () => {
        const b = document.getElementById('ei-body');
        if (b) b.innerHTML = body();
        return false; // keep the dialog open
      }],
      ['Close', null],
    ]);
  }

  function open(app) {
    const ents = selStructuralEnts(app);
    if (!ents.length) { app.toast('Select a structural element first', true); return; }
    if (ents.length > 1) app.toast(ents.length + ' element(s) selected — showing the first');
    openForEntity(app, ents[0].id);
  }

  root.RCInfo = { open, openForEntity, selStructuralEnts, elementInfo: identity };
})(window);
