// rcreport.js — Design summary report generator.
// Consolidates beam, column, wall, and slab design results into a
// printable HTML report with project header, per-member tables, and
// ACI clause references. Opens in a new window for printing to PDF.
(function (root) {
  'use strict';

  function generate(app, comboName) {
    const d = root.RCDefine.ensure(app);
    const now = new Date();
    const dateStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();

    // run all designs
    let beams = null, cols = null, walls = null, slabs = null;
    const errors = [];
    try { beams = root.RCBeam.designAllBeams(app, comboName); } catch (e) { errors.push('Beams: ' + e.message); }
    try { cols = root.RCColumn.designAllColumns(app, comboName, 'design', true); } catch (e) { errors.push('Columns: ' + e.message); }
    try { walls = root.RCWall.designAllWalls(app, comboName); } catch (e) { errors.push('Walls: ' + e.message); }
    try { slabs = root.RCSlab.designAllSlabs(app, comboName); } catch (e) { errors.push('Slabs: ' + e.message); }

    // project info
    const projName = 'RC Building — Design Report';
    const projDate = dateStr;
    const comboLabel = comboName || 'N/A';
    const codeRef = 'ACI 318-19';

    let html = buildHeader(projName, projDate, comboLabel, codeRef);

    // materials summary
    html += buildSection('Design Materials', buildMaterialsTable(d));

    // beams
    if (beams && beams.results && beams.results.length) {
      html += buildSection('Beam Design — ACI 318-19 §9.5 (Flexure) + §22.5 (Shear)', buildBeamTable(beams.results));
    }

    // columns
    if (cols && cols.results && cols.results.length) {
      html += buildSection('Column Design — ACI 318-19 Biaxial P-M (Fiber Method)', buildColumnTable(cols.results));
    }

    // walls
    if (walls && walls.results && walls.results.length) {
      html += buildSection('Wall Design — ACI 318-19 Ch.11 (In-Plane Shear) + P-M', buildWallTable(walls.results));
    }

    // slabs
    if (slabs && slabs.results && slabs.results.length) {
      html += buildSection('Slab Design — ACI 318-19 Ch.7 (Flexure)', buildSlabTable(slabs.results));
    }

    // errors
    if (errors.length) {
      html += buildSection('Warnings', '<ul>' + errors.map(e => '<li>' + e + '</li>').join('') + '</ul>');
    }

    // footer
    html += buildFooter(comboLabel, codeRef);

    return html;
  }

  function buildHeader(name, date, combo, code) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${name}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; margin: 40px; color: #1a1a2e; font-size: 12px; }
  h1 { font-size: 22px; color: #1a3c6e; border-bottom: 3px solid #1a3c6e; padding-bottom: 10px; margin-bottom: 5px; }
  .subtitle { font-size: 12px; color: #666; margin-bottom: 20px; }
  h2 { font-size: 15px; color: #1a3c6e; border-bottom: 1px solid #c3cad1; padding-bottom: 5px; margin: 25px 0 8px 0; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { background: #f0f2f5; padding: 6px 8px; text-align: left; font-size: 11px; color: #333; border: 1px solid #c3cad1; }
  td { padding: 5px 8px; border: 1px solid #dde2e6; font-size: 11px; }
  tr:nth-child(even) { background: #f8f9fa; }
  .fail { color: #c62828; font-weight: bold; }
  .pass { color: #2e7d32; }
  .warn { color: #f57f17; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10px; color: #999; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: bold; }
  .badge-ok { background: #e8f5e9; color: #2e7d32; }
  .badge-fail { background: #ffebee; color: #c62828; }
  .badge-warn { background: #fff8e1; color: #f57f17; }
  @media print { body { margin: 15mm; } h2 { page-break-after: avoid; } table { page-break-inside: avoid; } }
</style></head><body>`;
  }

  function buildSection(title, content) {
    return `<h2>${title}</h2>\n${content}\n`;
  }

  function buildMaterialsTable(d) {
    const rows = d.materials.map(m => {
      const fc = m.conc ? m.conc.fc : '—';
      const fy = m.rebar ? m.rebar.fy : (m.steel ? m.steel.fy : '—');
      const type = m.type;
      return `<tr><td>${m.name}</td><td>${type}</td><td>${fc}</td><td>${fy}</td></tr>`;
    }).join('');
    return `<table><thead><tr><th>Name</th><th>Type</th><th>f'c (MPa)</th><th>fy (MPa)</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function buildBeamTable(results) {
    let rows = '';
    for (const r of results) {
      const shearStatus = r.shear.ok
        ? `<span class="pass">Ø${r.stirrups ? r.stirrups.dia : 8}@${r.stirrups ? r.stirrups.spacing : 200}mm</span>`
        : `<span class="fail">OVERSTRESSED</span>`;
      const topBarStr = r.topBars ? `${r.topBars.count}Ø${r.topBars.dia}` : '—';
      const botBarStr = r.botBars ? `${r.botBars.count}Ø${r.botBars.dia}` : '—';
      const dbl = r.topDoubly || r.botDoubly ? '<span class="warn">★</span>' : '';
      rows += `<tr>
        <td>${r.id}</td>
        <td>${r.b}×${r.h}</td>
        <td>${(r.MuTop/1e6).toFixed(1)}</td>
        <td>${(r.MuBot/1e6).toFixed(1)}</td>
        <td>${r.AsTop.toFixed(0)}</td>
        <td>${r.AsBot.toFixed(0)}</td>
        <td>${topBarStr}${dbl}</td>
        <td>${botBarStr}</td>
        <td>${shearStatus}</td>
        <td>${r.devTop ? r.devTop.toFixed(0) : '—'}</td>
      </tr>`;
    }
    return `<table>
      <thead><tr>
        <th>Element</th><th>b×h (mm)</th><th>Mu⁻ (kN·m)</th><th>Mu⁺ (kN·m)</th>
        <th>As top (mm²)</th><th>As bot (mm²)</th><th>Top Rebar</th><th>Bot Rebar</th>
        <th>Shear</th><th>ld (mm)</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p style="font-size:10px;color:#999">Flexure: ACI 9.5.2.1 · Min: ACI 9.6.1.2 · Shear: ACI 22.5 · Dev: ACI 25.4.2.3</p>`;
  }

  function buildColumnTable(results) {
    let rows = '';
    for (const r of results) {
      const status = r.dcr > 1
        ? '<span class="badge fail">OVERSTRESSED</span>'
        : r.dcr > 0.9
          ? '<span class="badge warn">NEAR LIMIT</span>'
          : '<span class="badge ok">OK</span>';
      rows += `<tr>
        <td>${r.id}</td>
        <td>${r.b}×${r.h}</td>
        <td>${r.Pu.toFixed(0)}</td>
        <td>${r.Mx.toFixed(1)}</td>
        <td>${r.My.toFixed(1)}</td>
        <td>${r.Pcap.toFixed(0)}</td>
        <td>${r.dcr.toFixed(3)}</td>
        <td>${status}</td>
      </tr>`;
    }
    return `<table>
      <thead><tr>
        <th>Element</th><th>b×h (mm)</th><th>Pu (kN)</th><th>Mx (kN·m)</th>
        <th>My (kN·m)</th><th>φPcap (kN)</th><th>DCR</th><th>Status</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p style="font-size:10px;color:#999">Biaxial P-M interaction (fiber method) · φ per ACI 21.2.3 · P cap 0.80P₀ per ACI 22.4.2</p>`;
  }

  function buildWallTable(results) {
    let rows = '';
    for (const r of results) {
      const status = r.dcr > 1
        ? '<span class="badge fail">OVERSTRESSED</span>'
        : r.dcr > 0.9
          ? '<span class="badge warn">NEAR LIMIT</span>'
          : '<span class="badge ok">OK</span>';
      const vert = `${r.nVertPerFace + 2 * r.endZoneBars}Ø${r.vertDia}@${r.vertSpacing}mm`;
      rows += `<tr>
        <td>${r.id}</td>
        <td>${r.length.toFixed(0)}×${r.thickness.toFixed(0)}</td>
        <td>${r.Pu.toFixed(0)}</td>
        <td>${r.Mx.toFixed(1)}</td>
        <td>${r.dcr.toFixed(3)}</td>
        <td>${vert}</td>
        <td>${r.shear.ok ? 'Avh/s = ' + r.shear.Avhs.toFixed(4) : 'SHEAR FAIL'}</td>
        <td>${status}</td>
      </tr>`;
    }
    return `<table>
      <thead><tr>
        <th>Element</th><th>L×t (mm)</th><th>Pu (kN)</th><th>Mu (kN·m)</th>
        <th>DCR</th><th>Vert. Reinf.</th><th>Horiz. Shear</th><th>Status</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p style="font-size:10px;color:#999">P-M interaction (fiber method) · In-plane shear per ACI Ch.11.5 · Min per ACI Table 11.6.2</p>`;
  }

  function buildSlabTable(results) {
    let rows = '';
    for (const r of results) {
      rows += `<tr>
        <td>${r.id}</td>
        <td>${r.thickness.toFixed(0)}</td>
        <td>${r.maxM11.toFixed(2)}</td>
        <td>${r.botBarsD1 ? `${r.botBarsD1.count}Ø${r.botBarsD1.dia}@${r.botBarsD1.spacing}` : '—'}</td>
        <td>${r.topBarsD1 ? `${r.topBarsD1.count}Ø${r.topBarsD1.dia}@${r.topBarsD1.spacing}` : '—'}</td>
        <td>${r.botBarsD2 ? `${r.botBarsD2.count}Ø${r.botBarsD2.dia}@${r.botBarsD2.spacing}` : '—'}</td>
        <td>${r.topBarsD2 ? `${r.topBarsD2.count}Ø${r.topBarsD2.dia}@${r.topBarsD2.spacing}` : '—'}</td>
        <td>${r.owShear.ok ? '<span class="pass">OK</span>' : '<span class="fail">FAIL</span>'}</td>
      </tr>`;
    }
    return `<table>
      <thead><tr>
        <th>Element</th><th>t (mm)</th><th>M11 max (kN·m/m)</th>
        <th>D1 Bot</th><th>D1 Top</th><th>D2 Bot</th><th>D2 Top</th><th>O.W. Shear</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p style="font-size:10px;color:#999">Flexure from shell M11/M22 · Min ρ = 0.0018 (ACI 7.6.1.1) · Max s = min(3h, 450mm) (ACI 7.7.2.3)</p>`;
  }

  function buildFooter(combo, code) {
    return `<div class="footer">
      Generated by WebSketch 3D RC Design Module · Design code: ${code} · Load combination: ${combo}<br>
      This report is for preliminary design only. Final design must be verified by a licensed structural engineer.
    </div></body></html>`;
  }

  // ============================================================ public API
  function open(app, cat) {
    if (cat !== 'designReport') return;
    const R = app.rcResults;
    if (!R) { app.toast('Run the analysis first (Analyze ▸ Run Analysis)', true); return; }
    const comboNames = R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name);
    if (!comboNames.length) { app.toast('No combinations defined', true); return; }

    const patOpts = comboNames.map(n => `<option value="${n}">${n}</option>`).join('');
    const html = [
      '<p style="margin:0 0 6px;font-size:12px;opacity:.8">Generates a printable design summary report for all beams, columns, walls, and slabs.</p>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Load Combination</span>' +
      `<select id="dr-combo" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${patOpts}</select></div>`,
    ].join('');
    app.dialog('Design Report', html, [
      ['Generate Report', () => {
        const combo = document.getElementById('dr-combo').value;
        const html = generate(app, combo);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        app.toast('Design report opened in new window — use Ctrl+P to print to PDF');
      }],
      ['Close', null],
    ]);
  }

  root.RCReport = { generate, open };
})(window);
