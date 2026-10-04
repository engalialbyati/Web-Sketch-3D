'use strict';
// features/analysis-ui.js — Structural Analysis & Design UI (ETABS-style).
// Adds the Analyze and Design ribbon tabs, the Run Analysis dialog, the
// results browser (reactions, envelope forces, drift), and the design
// checks report (beam capacity ratios, column interaction).
(function () {
  function init(app) {
    if (app._analysisUI) return;
    app._analysisUI = true;
  }

  // Run the analysis and show the results browser
  function analyzeDialog(app) {
    if (!window.StructuralAnalysis) { app.toast('Analysis module not loaded', true); return; }
    const counts = { col: app.bim.entities.filter(e => e.type === 'column').length,
      beam: app.bim.entities.filter(e => e.type === 'beam').length,
      wall: app.bim.entities.filter(e => e.type === 'wall').length,
      slab: app.bim.entities.filter(e => ['floor', 'slab'].includes(e.type)).length };
    if (!counts.col && !counts.beam && !counts.wall && !counts.slab) {
      app.toast('Draw structural elements first (columns, beams, walls, slabs)', true);
      return;
    }
    let results = null;
    app.dialog('Structural Analysis — Load Cases & Run', `
      <div class="dim" style="margin:0 0 10px">
        Linear static analysis of ${counts.col} columns, ${counts.beam} beams, ${counts.wall} walls, ${counts.slab} slabs.
        Self-weight (24 kN/m³) + live/super-dead/wind loads, combined per ACI 318-19 §5.3.1.
      </div>
      <div class="form-row"><label>Live load (kPa)</label><input type="number" id="sa-ll" step="0.5" value="2.0" style="width:90px"></div>
      <div class="form-row"><label>Super dead (kPa)</label><input type="number" id="sa-sdl" step="0.5" value="1.5" style="width:90px"></div>
      <div class="form-row"><label>Wind pressure (kPa)</label><input type="number" id="sa-wl" step="0.25" value="1.0" style="width:90px"></div>
    `, [
      ['Cancel', null],
      ['Run Analysis', () => {
        const ll = parseFloat(document.getElementById('sa-ll').value) || 2;
        const sdl = parseFloat(document.getElementById('sa-sdl').value) || 1.5;
        const wl = parseFloat(document.getElementById('sa-wl').value) || 1;
        app.closeDialog();
        const t0 = performance.now();
        results = window.StructuralAnalysis.runAnalysis(app, { liveLoad: ll, superDead: sdl, wind: wl });
        const ms = Math.round(performance.now() - t0);
        if (results.error) { app.toast(results.error, true); return false; }
        app._lastAnalysis = results;
        showResults(app, results, ms);
        return false;
      }],
    ]);
  }

  function showResults(app, results, ms) {
    const mesh = results.mesh;
    // reactions summary (base shear, total vertical)
    let baseFx = 0, baseFz = 0;
    for (const res of results.results) {
      for (const r of res.reactions) { baseFx += r.R[0]; baseFz += r.R[2]; }
    }
    const nReact = results.results[0] ? results.results[0].reactions.length : 0;
    // envelope table per element (top 30)
    const rows = results.envelope
      .filter(e => e.entityId)
      .sort((a, b) => Math.max(b.maxM, b.maxN) - Math.max(a.maxM, a.maxN))
      .slice(0, 30)
      .map((e, i) => {
        const ent = app.bim.getEntityById(e.entityId);
        const label = ent ? ent.id : '?';
        const M = (e.maxM / 1e6).toFixed(1), V = (e.maxN / 1e3).toFixed(0), N = (e.maxN / 1e3).toFixed(0);
        return `<tr><td>${e.kind}</td><td>${label}</td>
          <td style="text-align:right">${M} kN·m</td>
          <td style="text-align:right">${V} kN</td>
          <td style="text-align:right">${N} kN</td><td>${e.gov || ''}</td></tr>`;
      }).join('');
    app.dialog('Analysis Results — ' + results.combos.length + ' combos, ' + ms + ' ms', `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:0 0 10px">
        <div style="border:1px solid var(--line,#ccc);border-radius:6px;padding:6px 10px">
          <div style="font-size:10px;opacity:.7;text-transform:uppercase">Nodes</div>
          <div style="font-size:18px;font-weight:600">${mesh.nodes.length}</div>
        </div>
        <div style="border:1px solid var(--line,#ccc);border-radius:6px;padding:6px 10px">
          <div style="font-size:10px;opacity:.7;text-transform:uppercase">Frame elements</div>
          <div style="font-size:18px;font-weight:600">${mesh.frames.length}</div>
        </div>
        <div style="border:1px solid var(--line,#ccc);border-radius:6px;padding:6px 10px">
          <div style="font-size:10px;opacity:.7;text-transform:uppercase">Shell elements</div>
          <div style="font-size:18px;font-weight:600">${mesh.shells.length}</div>
        </div>
      </div>
      <div style="margin:0 0 8px">
        <b>Max lateral drift:</b> ${(results.maxDrift * 1000).toFixed(1)} mm
        · <b>Reactions:</b> ${nReact} support nodes (ΣFx ${Math.abs(baseFx / 1e3).toFixed(0)} kN, ΣFz ${(baseFz / 1e3).toFixed(0)} kN across combos)
      </div>
      <table class="ob-table" style="width:100%;border-collapse:collapse;font-size:11px">
        <tr style="text-align:left"><th>Kind</th><th>Element</th><th>Max M</th><th>Max V</th><th>Max N</th><th>Governing combo</th></tr>
        ${rows}
      </table>
    `, [
      ['Close', null],
      ['Design All Elements →', () => {
        app.closeDialog();
        designDialog(app);
        return false;
      }],
    ]);
  }

  function designDialog(app) {
    if (!window.RCDesign) { app.toast('RC design module not loaded', true); return; }
    if (!app._lastAnalysis) { app.toast('Run the analysis first (Analyze tab ▸ Run Analysis)', true); return; }
    const t0 = performance.now();
    const design = window.StructuralAnalysis.runDesign(app, app._lastAnalysis);
    const ms = Math.round(performance.now() - t0);
    if (design.error) { app.toast(design.error, true); return; }
    const rows = design.designs.map(d => {
      const dcr = d.type === 'column'
        ? { f: d.check.DCR.moment, a: d.check.DCR.axial }
        : { f: Math.max(d.check.dcr.flexurePos, d.check.dcr.flexureNeg), s: d.check.dcr.shear };
      const worst = Math.max(...Object.values(dcr).filter(v => v != null));
      const color = worst > 1 ? '#dc2626' : worst > 0.85 ? '#d97706' : '#16a34a';
      const detail = d.type === 'column'
        ? `P ${(d.check.PuMax).toFixed(0)}kN cap, M ${(d.check.Mcap).toFixed(1)}kN·m cap, ρ ${(d.check.rho * 100).toFixed(1)}%`
        : `φMn+ ${(d.check.phiMnPos).toFixed(1)}kN·m, φVn ${(d.check.shear.phiVn).toFixed(0)}kN, s≤${d.check.detail.stirrupSMax}mm`;
      return `<tr>
        <td>${d.type}</td><td>${d.label}</td>
        <td style="text-align:right;color:${color};font-weight:600">${(worst * 100).toFixed(0)}%</td>
        <td style="font-size:10px">${detail}</td></tr>`;
    }).join('');
    const pass = design.designs.length - design.failing.length;
    app.dialog('RC Design — ACI 318-19 — ' + pass + '/' + design.designs.length + ' pass', `
      <div class="dim" style="margin:0 0 8px">
        Beam flexure (φMn ≥ Mu), shear (φVc + φVs ≥ Vu), min/max steel.
        Columns: P-M interaction via strain compatibility, φ per Table 21.2.2.
        fc'=30 MPa, fy=420 MPa (edit per element in Entity Info).
      </div>
      <table class="ob-table" style="width:100%;border-collapse:collapse;font-size:11px">
        <tr style="text-align:left"><th>Type</th><th>Element</th><th>DCR</th><th>Capacity details</th></tr>
        ${rows}
      </table>
      ${design.failing.length ? `<div style="margin-top:8px;color:#dc2626">⚠ ${design.failing.length} element(s) exceed capacity — enlarge the section or add reinforcement</div>` : '<div style="margin-top:8px;color:#16a34a">✓ All elements pass ACI 318-19 checks</div>'}
    `, [
      ['Close', null],
      ['← Back to Results', () => { app.closeDialog(); showResults(app, app._lastAnalysis, 0); return false; }],
    ]);
  }

  window.AnalysisUI = { init, analyzeDialog, designDialog, showResults };
})();
