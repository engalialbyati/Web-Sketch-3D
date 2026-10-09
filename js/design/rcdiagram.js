// rcdiagram.js — ETABS-style force diagrams: moment/shear ribbons on the 3D
// model + a detailed per-member results dialog (BMD/SFD canvas + reactions).
// Draws colored force diagrams perpendicular to each beam in the viewport
// after analysis, toggleable from the Analyze ribbon.
(function (root) {
  'use strict';

  let diagramGroup = null;  // THREE.Group for the diagrams
  let currentMode = null;   // 'M3' | 'V3' | 'reaction' | null
  let currentComboIdx = 0;  // which combo to display

  // get the beam entity's world-space start/end points
  function beamEnds(ent) {
    const p = ent.params;
    if (ent.type === 'beam' && Array.isArray(p.baseline) && p.baseline.length >= 2) {
      return { a: p.baseline[0], b: p.baseline[p.baseline.length - 1] };
    }
    if (ent.type === 'column' && Array.isArray(p.base)) {
      const h = +p.height || 3;
      return { a: [p.base[0], p.base[1], p.base[2]], b: [p.base[0], p.base[1], p.base[2] + h] };
    }
    return null;
  }

  // get station forces for a member from the analysis results (for a combo,
  // we linearly combine the pattern station forces)
  function getStationForces(app, comboName) {
    const R = app.rcResults;
    if (!R) return null;
    // if combos exist, linearly combine pattern stations using combo weights
    const d = root.RCDefine ? root.RCDefine.ensure(app) : {};
    const comboDefs = d.combos || [];
    const patIdx = new Map(R.patterns.map((p, i) => [p.name, i]));

    const members = []; // [{id, entId, stations:[{x,M,V}]}]
    if (R.combos.length) {
      const cb = R.combos.find(c => c.name === comboName);
      if (!cb) return null;
      // find weights
      let weights = [];
      const cd = comboDefs.find(c => c.name === comboName);
      if (cd) {
        weights = new Array(R.patterns.length).fill(0);
        for (const item of cd.cases) {
          const pi = patIdx.get(item.name);
          if (pi != null) weights[pi] += item.scale || 1;
        }
      } else {
        weights = [1];
      }
      // combine pattern stations
      if (!R.patterns.length) return null;
      const firstPat = R.patterns[0];
      for (let mi = 0; mi < firstPat.members.length; mi++) {
        const m0 = firstPat.members[mi];
        if (!m0.stations) continue;
        const combined = m0.stations.map((st, si) => {
          let M = 0, V = 0;
          for (let p = 0; p < R.patterns.length; p++) {
            const w = weights[p] || 0;
            if (!w) continue;
            const stP = R.patterns[p].members[mi] && R.patterns[p].members[mi].stations;
            if (stP && stP[si]) { M += w * stP.M; V += w * stP.V; }
          }
          return { x: st.x, M, V };
        });
        members.push({ idx: mi, id: m0.id, stations: combined });
      }
    } else {
      // patterns only
      for (const pat of R.patterns) {
        if (pat.name !== comboName) continue;
        for (const m of pat.members) {
          if (m.stations) members.push({ idx: 0, id: m.id, stations: m.stations });
        }
      }
    }
    return members;
  }

  // ============================================================ 3D viewport
  function showDiagrams(app, mode, comboName) {
    hideDiagrams(app);
    if (!mode) return;
    const THREE = root.THREE;
    if (!THREE) return;
    const view = app.view;
    if (!view || !view.scene) return;

    currentMode = mode;
    const stationData = getStationForces(app, comboName);
    if (!stationData || !stationData.length) { app.toast('No station data available — run analysis first', true); return; }

    diagramGroup = new THREE.Group();
    diagramGroup.name = 'rcForceDiagrams';

    // find max |M| or |V| for scaling
    let maxVal = 0;
    for (const m of stationData)
      for (const st of m.stations)
        maxVal = Math.max(maxVal, Math.abs(mode === 'M3' ? st.M : st.V));
    if (maxVal < 1e-9) return;
    const scaleLen = 500; // mm max perpendicular offset (adjust to model scale)

    for (const md of stationData) {
      const ent = app.bim.getEntityById(md.id);
      if (!ent) continue;
      const ends = beamEnds(ent);
      if (!ends) continue;
      const ax = mm(ends.a[0]), ay = mm(ends.a[1]), az = mm(ends.a[2]);
      const bx = mm(ends.b[0]), by = mm(ends.b[1]), bz = mm(ends.b[2]);
      // beam direction vector
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / len, uy = dy / len, uz = dz / len;
      // perpendicular direction for the diagram (use global Z for horizontal beams)
      // for vertical members use global X
      let px, py, pz;
      if (Math.abs(uz) > 0.9) { px = 1; py = 0; pz = 0; } // vertical member → perpendicular in XY
      else { px = 0; py = 0; pz = 1; }                     // horizontal → perpendicular in Z

      // draw the diagram as line segments
      const pts = [];
      const stations = md.stations;
      const nSt = stations.length;
      for (let si = 0; si < nSt; si++) {
        const st = stations[si];
        const t = st.x / (len || 1); // station position as fraction of length
        const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t;
        const val = mode === 'M3' ? st.M : st.V;
        const offset = (val / maxVal) * scaleLen;
        pts.push([cx + px * offset, cy + py * offset, cz + pz * offset]);
      }

      // base line (the beam itself)
      const baseGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)
      ]);
      const baseLine = new THREE.Line(baseGeo, new THREE.LineBasicMaterial({ color: 0x333333 }));
      diagramGroup.add(baseLine);

      // diagram curve
      const curveGeo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
      const curveMat = new THREE.LineBasicMaterial({ color: mode === 'M3' ? 0xff4444 : 0x2266ff });
      diagramGroup.add(new THREE.Line(curveGeo, curveMat));

      // perpendicular fill lines from beam axis to diagram curve
      const fillGeo = [];
      for (let si = 0; si < nSt; si++) {
        const st = stations[si];
        const t = st.x / (len || 1);
        const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t;
        const val = mode === 'M3' ? st.M : st.V;
        const offset = (val / maxVal) * scaleLen;
        fillGeo.push(new THREE.Vector3(cx, cy, cz));
        fillGeo.push(new THREE.Vector3(cx + px * offset, cy + py * offset, cz + pz * offset));
      }
      const fillLine = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(fillGeo),
        new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.4 })
      );
      diagramGroup.add(fillLine);
    }

    view.scene.add(diagramGroup);
    view.invalidate();
    app.setStatus(`Showing ${mode === 'M3' ? 'Moment M3' : 'Shear V3'} diagrams — combo: ${comboName}`);
  }

  function mm(v) { return v * 1000; } // model meters → THREE mm-ish scale

  function hideDiagrams(app) {
    if (diagramGroup && app.view && app.view.scene) {
      app.view.scene.remove(diagramGroup);
      diagramGroup = null;
    }
    currentMode = null;
    if (app.view) app.view.invalidate();
  }

  // ============================================================ results dialog
  function showForceDialog(app, comboName) {
    const stationData = getStationForces(app, comboName);
    if (!stationData || !stationData.length) { app.toast('Run the analysis first', true); return; }

    // member selector
    const memberOpts = stationData.map((m, i) => `<option value="${i}">${m.id}</option>`).join('');
    const html = [
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:0 0 8px"><span style="width:120px;flex:none;opacity:.75;font-size:12px">Member</span>' +
      `<select id="fd-member" style="width:200px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${memberOpts}</select></div>`,
      '<canvas id="fd-canvas" width="600" height="350" style="border:1px solid #d7dde3;border-radius:4px;background:#fafbfc"></canvas>',
      '<div id="fd-reactions" style="margin-top:8px;font-size:12px"></div>',
    ].join('');
    app.dialog('Force Diagrams — ' + comboName, html, [['Close', null]]);

    const draw = (memberIdx) => {
      const md = stationData[memberIdx];
      if (!md) return;
      const canvas = document.getElementById('fd-canvas');
      if (!canvas) return;
      drawDiagrams(canvas, md, comboName);
    };

    const sel = document.getElementById('fd-member');
    if (sel) {
      sel.addEventListener('change', () => draw(parseInt(sel.value, 10)));
      draw(0);
    }

    // reactions at base (from pattern 0)
    const R = app.rcResults;
    if (R && R.patterns.length && R.patterns[0].reactions) {
      const rx = R.patterns[0].reactions;
      const rxEl = document.getElementById('fd-reactions');
      if (rxEl) {
        const rows = rx.map(rec =>
          `Node ${rec.node}: Fx=${(rec.R[0]/1e3).toFixed(1)} Fy=${(rec.R[1]/1e3).toFixed(1)} Fz=${(rec.R[2]/1e3).toFixed(1)} kN`
        ).join('<br>');
        rxEl.innerHTML = `<b>Reactions (pattern: ${R.patterns[0].name}):</b><br>${rows}`;
      }
    }
  }

  // draw BMD + SFD on a canvas
  function drawDiagrams(canvas, member, comboName) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const st = member.stations;
    if (!st || !st.length) return;
    const n = st.length;

    const padL = 60, padR = 20, padT = 30, padB = 40;
    const plotW = W - padL - padR, plotH = (H - padT - padB) / 2 - 10;
    const maxM = Math.max(...st.map(s => Math.abs(s.M)), 1);
    const maxV = Math.max(...st.map(s => Math.abs(s.V)), 1);
    const xMin = st[0].x, xMax = st[n-1].x;
    const xToPx = x => padL + ((x - xMin) / (xMax - xMin || 1)) * plotW;

    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#333';
    ctx.fillText(`Member: ${member.id}`, padL, 15);
    ctx.fillText(`Combo: ${comboName}`, padL + 200, 15);

    // --- M diagram (top half) ---
    const myBase = padT + plotH;
    const myScale = plotH / maxM;
    ctx.strokeStyle = '#ddd'; ctx.strokeRect(padL, padT, plotW, plotH);
    ctx.fillStyle = '#888';
    ctx.fillText('M3 (kN·m)', padL, padT - 3);
    ctx.fillText('0', padL - 15, myBase + 3);
    ctx.fillText((-maxM/1e6).toFixed(1), padL - 35, padT + 8);
    // zero line
    ctx.strokeStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(padL, myBase); ctx.lineTo(padL + plotW, myBase); ctx.stroke();
    // M curve — ETABS draws moment plotted downward for positive
    ctx.strokeStyle = '#e53935'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = xToPx(st[i].x);
      const py = myBase - (st[i].M / 1e6) * myScale;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    // fill
    ctx.globalAlpha = 0.15; ctx.fillStyle = '#e53935';
    ctx.beginPath(); ctx.moveTo(xToPx(st[0].x), myBase);
    for (let i = 0; i < n; i++) ctx.lineTo(xToPx(st[i].x), myBase - (st[i].M/1e6) * myScale);
    ctx.lineTo(xToPx(st[n-1].x), myBase); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;

    // --- V diagram (bottom half) ---
    const vyBase = padT + plotH * 2 + 20;
    const vyTop = padT + plotH + 20;
    const vyScale = plotH / maxV;
    ctx.strokeStyle = '#ddd'; ctx.strokeRect(padL, vyTop, plotW, plotH);
    ctx.fillStyle = '#888';
    ctx.fillText('V3 (kN)', padL, vyTop - 3);
    ctx.strokeStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(padL, vyBase - plotH/2); ctx.lineTo(padL + plotW, vyBase - plotH/2); ctx.stroke();
    ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = xToPx(st[i].x);
      const py = (vyBase - plotH/2) - (st[i].V / 1e3) * vyScale;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.15; ctx.fillStyle = '#1565c0';
    ctx.beginPath(); ctx.moveTo(xToPx(st[0].x), vyBase - plotH/2);
    for (let i = 0; i < n; i++) ctx.lineTo(xToPx(st[i].x), (vyBase - plotH/2) - (st[i].V/1e3) * vyScale);
    ctx.lineTo(xToPx(st[n-1].x), vyBase - plotH/2); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;

    // x-axis labels
    ctx.fillStyle = '#666';
    ctx.fillText(`${xMin.toFixed(0)} mm`, padL, H - 5);
    ctx.fillText(`${xMax.toFixed(0)} mm`, padL + plotW - 30, H - 5);
  }

  // ============================================================ public API
  function open(app, cat) {
    if (cat === 'showDiagrams') {
      // cycle through modes: off → M3 → V3 → off
      const modes = [null, 'M3', 'V3'];
      const next = modes[(modes.indexOf(currentMode) + 1) % modes.length];
      const comboName = app.rcResults && app.rcResults.patterns.length
        ? app.rcResults.patterns[0].name : null;
      if (next) showDiagrams(app, next, comboName);
      else hideDiagrams(app);
      return;
    }
    if (cat === 'showForceDialog') {
      const comboName = app.rcResults && app.rcResults.patterns.length
        ? app.rcResults.patterns[0].name : null;
      if (!comboName) { app.toast('Run the analysis first', true); return; }
      showForceDialog(app, comboName);
      return;
    }
  }

  root.RCDiagram = { showDiagrams, hideDiagrams, showForceDialog, open };
})(window);
