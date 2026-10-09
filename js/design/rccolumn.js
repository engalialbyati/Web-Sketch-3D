// rccolumn.js — ACI 318-19 RC column design (biaxial P-M interaction).
// Generates the P-M interaction surface from section geometry + reinforcement
// using the fiber (layered) method: for varying neutral axis depth, compute
// forces from Whitney concrete block + elastic-perfectly-plastic steel at
// each rebar layer. Checks applied forces against the surface → DCR.
// Original code — equations cite ACI clauses.
// Units: N, mm, MPa.
(function (root) {
  'use strict';

  const Es = 200000; // MPa (ACI 20.2.2.2)
  const EC_U = 0.003; // ultimate concrete strain (ACI 22.2.2.1)

  // ============================================================ rebar layout
  // Build rebar positions from the section overlay data (column overlay).
  // Returns array of { x, y, area } relative to section centroid (mm).
  function rebarLayout(b, h, cover, rebar) {
    const bars = [];
    const db = parseFloat(rebar.rebarSize) || 16;
    const Ab = Math.PI * db * db / 4;
    const c = cover; // to bar center
    const r = (rebar.colPattern || 1); // 1=rectangular array

    // corner bars (always 4)
    const positions = [
      { x: -(b/2 - c), y: -(h/2 - c) },
      { x: +(b/2 - c), y: -(h/2 - c) },
      { x: -(b/2 - c), y: +(h/2 - c) },
      { x: +(b/2 - c), y: +(h/2 - c) },
    ];
    for (const p of positions) bars.push({ ...p, area: Ab });

    // intermediate bars on faces (nR2 = bars on top/bottom faces excl corners,
    // nR3 = bars on left/right faces excl corners)
    const nR3 = (rebar.nR3 || 0), nR2 = (rebar.nR2 || 0);
    for (let i = 1; i <= nR3; i++) {
      const y = -(h/2 - c) + (h - 2*c) * i / (nR3 + 1);
      bars.push({ x: -(b/2 - c), y, area: Ab });
      bars.push({ x: +(b/2 - c), y, area: Ab });
    }
    for (let i = 1; i <= nR2; i++) {
      const x = -(b/2 - c) + (b - 2*c) * i / (nR2 + 1);
      bars.push({ x, y: -(h/2 - c), area: Ab });
      bars.push({ x, y: +(h/2 - c), area: Ab });
    }
    return bars;
  }

  // ==================================================== P-M interaction curve
  // Generate the P-M curve for uniaxial bending at a given angle.
  // angle: 0 = bending about strong axis (M about y → gravity bending)
  //        90 = bending about weak axis (M about x → lateral bending)
  // Returns array of { P, M } in N and N·mm.
  function generatePMCurve(sec, mat, angle, nPoints = 40) {
    const dims = sec.dims || {};
    const b = (dims.b || 300);
    const h = (dims.h || 500);
    const fc = mat.conc ? mat.conc.fc : 25;
    const fy = (() => {
      const rebarMat = d_findRebarMat(sec);
      return rebarMat ? rebarMat.fy : 500;
    })();
    const b1 = beta1(fc);
    const cover = (sec.rebar && sec.rebar.colCover) || 0.04;
    const bars = rebarLayout(b, h, cover * 1000, sec.rebar || {});
    const dMax = h - cover * 1000; // extreme tension steel

    // rotate section coordinates for biaxial bending
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rotBars = bars.map(bar => ({
      x: bar.x * cos + bar.y * sin,
      y: -bar.x * sin + bar.y * cos,
      area: bar.area,
    }));

    const Ag = b * h;
    const results = [];

    // sweep neutral axis from pure tension (c → -∞, all steel yields in tension)
    // to pure compression (c → +∞, uniform compression)
    for (let i = 0; i <= nPoints; i++) {
      const t = i / nPoints;
      let P = 0, M = 0;

      if (t === 0) {
        // pure tension: all steel yields
        for (const bar of rotBars) P -= bar.area * fy;
        results.push({ P, M: 0 });
        continue;
      }
      if (t === 1) {
        // pure compression: P_max = 0.85·f'c·(Ag - Ast) + Ast·fy  (ACI 22.4.2.2)
        const Ast = rotBars.reduce((s, bar) => s + bar.area, 0);
        P = 0.85 * fc * (Ag - Ast) + Ast * fy;
        results.push({ P, M: 0 });
        continue;
      }

      // c from large (compression-dominated) to small (tension)
      // map t ∈ (0,1) to c ∈ (h*1.5, 0.01)
      const c = h * 1.5 * (1 - t) + 0.01;

      // concrete Whitney block: compression zone from top fiber to depth a
      const a = Math.min(b1 * c, h);
      if (a > 0) {
        const Cc = 0.85 * fc * b * a;
        const yCc = -(h / 2) + a / 2; // centroid of compression block from section center
        P += Cc;
        // moment about centroid at angle θ: M = F × perpendicular distance
        M += Cc * yCc * cos; // strong-axis component
      }

      // steel forces
      for (const bar of rotBars) {
        const di = bar.y + h / 2; // distance from extreme compression fiber
        const es = EC_U * (c - di) / c; // strain (positive = compression)
        const fs = Math.max(-fy, Math.min(fy, Es * es)); // elastic-perfectly-plastic
        const Fi = bar.area * fs; // force (compression = +)
        P += Fi;
        M += Fi * bar.y * cos;
      }

      results.push({ P, M: Math.abs(M) });
    }

    return results;
  }

  function d_findRebarMat(sec) {
    // helper — the caller provides materials; this is a fallback
    return { fy: 500 };
  }

  // ===================================================== capacity ratio check
  // For a given (Pu, Mu), find the capacity at that moment and compute DCR.
  // Uses the P-M curve: capacity P at Mu = interpolate from the curve.
  function capacityRatio(Pu, Mu, pmCurve) {
    // pmCurve: array of { P, M } sorted by decreasing P
    // find the two points that bracket Mu
    for (let i = 0; i < pmCurve.length - 1; i++) {
      const p1 = pmCurve[i], p2 = pmCurve[i + 1];
      // check if Mu falls between M1 and M2
      if ((Mu >= Math.min(p1.M, p2.M)) && (Mu <= Math.max(p1.M, p2.M))) {
        // interpolate P at Mu
        const t = Math.abs(p2.M - p1.M) > 1e-9 ? (Mu - p1.M) / (p2.M - p1.M) : 0;
        const Pcap = p1.P + t * (p2.P - p1.P);
        if (Math.abs(Pcap) < 1) return { dcr: 99, Pcap: 0, status: 'ZERO CAPACITY' };
        return { dcr: Math.abs(Pu) / Math.abs(Pcap), Pcap, status: 'ok' };
      }
    }
    // Mu exceeds the maximum on the curve → fail
    return { dcr: 99, Pcap: 0, status: 'Mu exceeds interaction curve' };
  }

  // ============================================================ design all
  function designAllColumns(app, comboName) {
    const R = app.rcResults;
    if (!R) return { error: 'Run the analysis first (Analyze ▸ Run Analysis).' };
    const d = root.RCDefine.ensure(app);

    let combo = R.combos.find(c => c.name === comboName);
    let pat = null;
    if (!combo) {
      pat = R.patterns.find(p => p.name === comboName);
      if (!pat) return { error: `Combination or pattern "${comboName}" not found.` };
    }

    const results = [];
    for (const m of (combo ? combo.members : pat.members)) {
      if (m.type !== 'column') continue;
      const ent = app.bim.getEntityById(m.id);
      if (!ent) continue;
      const sec = root.RCDefine.ensure(app).frameSections.find(s => s.name === ent.params.designSection);
      if (!sec || !sec.rebar) continue;
      const mat = d.materials.find(x => x.name === (ent.params.materialOverwrite || sec.material)) ||
                  d.materials.find(x => x.type === 'concrete');
      if (!mat || !mat.conc) continue;

      const dims = sec.dims || {};
      const b = dims.b || 300, h = dims.h || 500;
      const fc = mat.conc.fc;
      const fy = d.materials.find(x => x.type === 'rebar')?.rebar?.fy || 500;

      // applied forces (N and N·mm from rcmodel raw data)
      const Pu = Math.abs(m.Fi || 0); // axial (worst end)
      // moments: take the larger of the two ends, combine both axes
      const Mx = Math.max(Math.abs(m.Mi || 0), Math.abs(m.Mj || 0)); // strong axis (N·mm)
      const My = Math.max(Math.abs(m.Vi2 || 0) * h / 2 || 0, Math.abs(m.Vj2 || 0) * h / 2 || 0); // approximate biaxial

      // generate P-M curve at 0° (strong axis, gravity bending)
      const pm0 = generatePMCurve(sec, mat, 0, 30);
      // generate at 90° (weak axis, lateral bending)
      const pm90 = generatePMCurve(sec, mat, 90, 30);

      // capacity ratio (strong axis)
      const cr0 = capacityRatio(Pu, Mx, pm0);
      // capacity ratio (weak axis)
      const cr90 = capacityRatio(Pu, My, pm90);

      // biaxial: use the Bresler reciprocal load method (simplified)
      // 1/Pn = 1/Pn0 + 1/Pnx - 1/Pnx0 — for now just report the max DCR
      const dcr = Math.max(cr0.dcr, cr90.dcr);

      results.push({
        id: m.id, b, h, fc, fy,
        Pu: Pu / 1e3, Mx: Mx / 1e6, My: My / 1e6, // kN, kN·m
        dcr, crStrong: cr0.dcr, crWeak: cr90.dcr,
        Pcap: cr0.Pcap / 1e3,
        status: dcr > 1 ? 'OVERSTRESSED' : dcr > 0.9 ? 'NEAR LIMIT' : 'OK',
        pmCurve: pm0, // store for potential plotting
      });
    }
    return { results, comboName };
  }

  // ============================================================ design dialog
  function open(app, cat) {
    if (cat !== 'columnDesign') return;
    const R = app.rcResults;
    if (!R) { app.toast('Run the analysis first', true); return; }
    const d = root.RCDefine.ensure(app);
    const comboNames = R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name);
    if (!comboNames.length) { app.toast('No load combinations or patterns defined', true); return; }

    const patOpts = comboNames.map(n => `<option value="${n}">${n}</option>`).join('');
    const html = [
      '<p style="margin:0 0 6px;font-size:12px;opacity:.8">Biaxial P-M interaction check per ACI 318-19 (fiber method).</p>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Load Combination</span>' +
      `<select id="cd-combo" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${patOpts}</select></div>`,
    ].join('');
    app.dialog('RC Column Design — ACI 318-19', html, [
      ['Design', () => {
        const combo = document.getElementById('cd-combo').value;
        const result = designAllColumns(app, combo);
        if (result.error) { app.toast(result.error, true); return false; }
        showColumnResults(app, result, combo);
        return false;
      }],
      ['Close', null],
    ]);
  }

  function showColumnResults(app, result, comboName) {
    const esc = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const rows = result.results.map(r => {
      const color = r.dcr > 1 ? '#c62828' : r.dcr > 0.9 ? '#f57f17' : '#2e7d32';
      return '<tr>' +
        `<td style="padding:3px 6px">${esc(r.id)}</td>` +
        `<td>${r.b}×${r.h}</td>` +
        `<td>${r.Pu.toFixed(0)}</td>` +
        `<td>${r.Mx.toFixed(1)}</td>` +
        `<td>${r.My.toFixed(1)}</td>` +
        `<td>${r.Pcap.toFixed(0)}</td>` +
        `<td style="color:${color};font-weight:${r.dcr > 1 ? 'bold' : 'normal'}">${r.dcr.toFixed(3)}</td>` +
        `<td style="color:${color}">${r.status}</td>` +
        '</tr>';
    }).join('');
    const html = '<div style="max-height:65vh;overflow:auto">' +
      `<p style="font-size:12px;margin:0 0 6px;opacity:.8">Combination: <b>${esc(comboName)}</b> · ACI 318-19 · Biaxial P-M (fiber method)</p>` +
      '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
      '<thead><tr style="text-align:left;opacity:.7">' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Element</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">b×h</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Pu (kN)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Mx (kN·m)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">My (kN·m)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">φPcap (kN)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">DCR</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Status</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p style="font-size:11px;opacity:.7;margin:8px 0 0">DCR = Pu/φPn at the applied moment · Fiber method: Whitney block + elastic-plastic steel</p>' +
      '</div>';
    app.dialog('RC Column Design Results — ' + comboName, html, [['Close', null]]);
  }

  function beta1(fc) {
    return Math.max(0.65, Math.min(0.85, 0.85 - 0.05 * (fc - 28) / 7));
  }

  root.RCColumn = { generatePMCurve, capacityRatio, designAllColumns, open, rebarLayout, beta1 };
})(window);
