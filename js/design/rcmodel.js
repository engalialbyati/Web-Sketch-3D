// rcmodel.js — the bridge from the drawn BIM model to the FEA engine.
// Builds a 3D frame model (beams + columns) from the bim entities and their
// RC Define assignments (sections, material overwrites, releases, base
// fixity, frame loads), solves every load pattern in one factorization
// (window.FEA), combines per the defined load combinations, and stores
// member forces on app.rcResults.
//
// Analysis scope (v1, matching ETABS's "frames only" gravity workflow):
//   - members: beams + columns. Walls/slabs are reported as skipped —
//     diaphragm/shell behavior arrives with the slab design phase.
//   - loads: self-weight (DEAD pattern multiplier), uniform + point frame
//     loads, lateral nodal loads (gx/gy). Surface loads transfer to frames
//     by tributary rules in a later phase.
//   - supports: columns reaching the lowest level — fixed, or pinned per
//     the Base Fixity assignment.
// Units: model in meters/kN → engine N/mm; results N·mm → kN·m on output.
(function (root) {
  'use strict';

  const FE = () => root.FEA;
  const RD = () => root.RCDefine;

  const mm = m => m * 1000;

  function sectionOf(app, ent) {
    const d = RD().ensure(app);
    const name = ent.params.designSection;
    return (name && d.frameSections.find(s => s.name === name)) || null;
  }

  function materialOf(app, sec, ent) {
    const d = RD().ensure(app);
    const name = (ent.params && ent.params.materialOverwrite) || (sec && sec.material);
    return d.materials.find(m => m.name === name) || d.materials.find(m => m.type === 'concrete') || null;
  }

  // local torsion constant J (St-Venant, rectangular): Roark-style approx
  function rectJ(b, h) {
    const a = Math.min(b, h), c = Math.max(b, h), r = a / c;
    return a ** 3 * c * (1 / 3 - 0.21 * r * (1 - r ** 4 / 12));
  }

  // ------------------------------------------------------------- build model
  // returns { nodes, frames, memberLoads, patterns, skipped, map } — the
  // map ties each analyzed frame element back to its bim entity.
  function buildModel(app) {
    const d = RD().ensure(app);
    const ents = app.bim.entities.filter(e => e.type === 'beam' || e.type === 'column');
    const nodes = [], nodeKey = new Map(), frames = [], map = [];
    const skipped = { walls: 0, slabs: 0, noSection: 0, noLoads: [] };

    const nodeAt = (x, y, z) => {
      const k = `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`;
      if (nodeKey.has(k)) return nodeKey.get(k);
      const idx = nodes.length;
      nodes.push({ x, y, z, fixed: null });
      nodeKey.set(k, idx);
      return idx;
    };

    for (const ent of ents) {
      if (ent.type !== 'beam' && ent.type !== 'column') { skipped.walls++; continue; }
      const sec = sectionOf(app, ent);
      if (!sec) { skipped.noSection++; continue; }
      const mat = materialOf(app, sec, ent);
      const props = RD().frameSectionProps(sec);        // A, I22, I33 (m⁴ → mm⁴ below)
      const dims = sec.dims || {};
      const bmm = (dims.b ?? dims.bf ?? 0) * 1000, hmm = (dims.h ?? dims.dia ?? 0) * 1000;
      const A = props.A * 1e6;                          // m² → mm²
      const I33 = props.I33 * 1e12, I22 = (props.I22 || 0) * 1e12;
      const J = rectJ(bmm || 300, hmm || 300);
      const nu = mat && mat.iso ? mat.iso.u : 0.2;
      const Ec = mat ? RD().matE(mat) : 25000;          // MPa (auto or explicit)
      const Gm = Ec / (2 * (1 + nu));

      let ni, nj;
      if (ent.type === 'beam' && Array.isArray(ent.params.baseline) && ent.params.baseline.length >= 2) {
        const [p1, p2] = ent.params.baseline;
        ni = nodeAt(p1[0], p1[1], p1[2]);
        nj = nodeAt(p2[0], p2[1], p2[2]);
      } else if (ent.type === 'column' && Array.isArray(ent.params.base)) {
        const [x, y, z] = ent.params.base;
        const hgt = +ent.params.height || 3;
        ni = nodeAt(x, y, z);
        nj = nodeAt(x, y, z + hgt);
      } else { skipped.noSection++; continue; }
      if (ni === nj) continue;

      // engine convention (verified): for horizontal members the vertical
      // bending stiffness lives in the Iz slot → strong axis as Iz
      frames.push({
        ni, nj, E: Ec, G: Gm, A,
        Iy: I22, Iz: I33, J,
        releases: ent.params.releases
          ? [ent.params.releases.i === 'pinM3' ? 5 : -1, ent.params.releases.j === 'pinM3' ? 11 : -1]
              .filter(v => v >= 0)
          : null,
      });
      map.push({ ent, idx: frames.length - 1, len: null });
    }

    // supports: columns reaching the lowest base elevation
    let zMin = Infinity;
    for (const f of frames) {
      const n = nodes[f.ni];
      if (n && n.z < zMin) zMin = n.z;
    }
    const fixAll = [1, 1, 1, 1, 1, 1], fixPin = [1, 1, 1, 0, 1, 1]; // pinned frees ry
    for (const f of frames) {
      const n = nodes[f.ni];
      if (Math.abs(n.z - zMin) > 1e-6) continue;
      const ent = map.find(m => m.idx === frames.indexOf(f));
      const fixity = ent && ent.ent.params.baseFixity;
      n.fixed = fixity === 'pinned' ? fixPin : fixAll;
    }

    return { nodes, frames, map, skipped, patternsData: d };
  }

  // ----------------------------------------------------------- pattern loads
  // returns { loads: [Map per pattern], memberLoads: [array per pattern] }
  function buildLoads(app, model) {
    const d = model.patternsData;
    const pats = d.loadPatterns;
    const loads = [], memberLoads = [];
    const byId = id => app.bim.getEntityById(id);

    for (const pat of pats) {
      const nodal = new Map();
      const addNodal = (ni, fx, fy, fz) => {
        const cur = nodal.get(ni) || [0, 0, 0, 0, 0, 0];
        cur[0] += fx; cur[1] += fy; cur[2] += fz;
        nodal.set(ni, cur);
      };
      const ml = new Array(model.frames.length).fill(null);

      // self-weight: DEAD-family pattern multiplier × A × unit weight.
      // Beams: transverse UDL. Columns: axial, split half to each end node.
      if (pat.selfWtMult) {
        for (let i = 0; i < model.frames.length; i++) {
          const m = model.map.find(x => x.idx === i);
          if (!m) continue;
          const sec = sectionOf(app, m.ent);
          const mat = materialOf(app, sec, m.ent);
          const gamma = (mat && mat.weight ? mat.weight.value : 25) * 1000; // N/m³
          const A = (RD().frameSectionProps(sec).A || 0) * 1e6;            // mm²
          const w = A * gamma * 1e-9 * pat.selfWtMult;                     // N/mm
          if (!(w > 0)) continue;
          if (m.ent.type === 'beam') ml[i] = { ...(ml[i] || {}), wy: (ml[i]?.wy || 0) - w };
          else {
            const a = model.nodes[model.frames[i].ni], b = model.nodes[model.frames[i].nj];
            const lenM = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
            const half = w * lenM / 2;
            addNodal(model.frames[i].ni, 0, 0, -half);
            addNodal(model.frames[i].nj, 0, 0, -half);
          }
        }
      }

      // element loads assigned on members
      for (let i = 0; i < model.frames.length; i++) {
        const m = model.map.find(x => x.idx === i);
        if (!m) continue;
        const loadsOn = m.ent.params.frameLoads || [];
        for (const L of loadsOn) {
          if (L.pattern !== pat.name) continue;
          if (L.type === 'dist') {
            const wNmm = (L.w || 0); // kN/m ≡ N/mm
            if (L.dir === 'gravity') ml[i] = { ...(ml[i] || {}), wy: (ml[i]?.wy || 0) - wNmm };
            else if (L.dir === 'up') ml[i] = { ...(ml[i] || {}), wy: (ml[i]?.wy || 0) + wNmm };
            else {
              // lateral (global X/Y): nodal half-length each side
              const a = model.nodes[model.frames[i].ni], b = model.nodes[model.frames[i].nj];
              const lenM = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
              const F = wNmm * lenM / 2 * 1000; // kN/m·m → N
              const s = L.dir === 'gx' ? 1 : 0, t = L.dir === 'gy' ? 1 : 0;
              addNodal(model.frames[i].ni, F * s, F * t, 0);
              addNodal(model.frames[i].nj, F * s, F * t, 0);
            }
          } else if (L.type === 'point') {
            if (m.ent.type !== 'beam') continue; // point loads on beams only (v1)
            ml[i] = ml[i] || {};
            ml[i].points = ml[i].points || [];
            ml[i].points.push({ P: (L.P || 0) * 1000, a: (L.a || 0) * 1000 }); // kN→N, m→mm
          }
        }
      }

      loads.push(nodal);
      memberLoads.push(ml);
    }
    return { loads, memberLoads, patternNames: pats.map(p => p.name) };
  }

  // ------------------------------------------------------------------- run
  // solves every pattern in one factorization, then linear-combines the
  // member end forces per 'add' combination. Results in N and N·mm.
  function runAnalysis(app, opts = {}) {
    const model = buildModel(app);
    if (!model.frames.length) return { error: 'No beams/columns with assigned sections to analyze.' };
    const { loads, memberLoads, patternNames } = buildLoads(app, model);

    const t0 = performance.now();
    const d = RD().ensure(app);
    // combos: linear ('add') only in v1; entries referencing unknown cases are skipped
    const comboDefs = d.combos.filter(c => (c.type || 'add') === 'add');
    const patIdx = new Map(patternNames.map((n, i) => [n, i]));

    // solve pattern-by-pattern (member end forces are recovered per RHS;
    // a small building solves in milliseconds)
    const results = { patterns: [], combos: [], model, ms: 0, nDof: model.nodes.length * 6, nodes: model.nodes.length };
    for (let p = 0; p < loads.length; p++) {
      const r = FE().assembleAndSolve(model.nodes, model.frames, [], [loads[p]], { memberLoads: memberLoads[p] || null });
      results.patterns.push({
        name: patternNames[p],
        members: r.frames.map((f, i) => ({
          idx: i,
          Fi: f.forces[0], Vi: f.forces[1], Mi: f.forces[5],  // i-end axial, shear, major moment (N, N·mm)
          Fj: f.forces[6], Vj: -f.forces[7], Mj: -f.forces[11],
          Ti: f.forces[3],
          id: model.map[i] ? model.map[i].ent.id : `f${i}`,
          type: model.map[i] ? model.map[i].ent.type : '?',
        })),
      });
    }

    // combinations over pattern end-forces
    for (const cb of comboDefs) {
      const w = new Array(loads.length).fill(0);
      let used = 0;
      for (const item of cb.cases) {
        const pi = patIdx.get(item.name);
        if (pi != null) { w[pi] += item.scale || 1; used++; }
      }
      if (!used) continue;
      const members = results.patterns[0].members.map((m0, mi) => {
        const acc = { Fi: 0, Vi: 0, Mi: 0, Fj: 0, Vj: 0, Mj: 0, Ti: 0 };
        for (let p = 0; p < loads.length; p++) {
          const s = w[p];
          if (!s) continue;
          const mf = results.patterns[p].members[mi];
          acc.Fi += s * mf.Fi; acc.Vi += s * mf.Vi; acc.Mi += s * mf.Mi;
          acc.Fj += s * mf.Fj; acc.Vj += s * mf.Vj; acc.Mj += s * mf.Mj;
          acc.Ti += s * mf.Ti;
        }
        return { id: m0.id, type: m0.type, ...acc };
      });
      results.combos.push({ name: cb.name, members });
    }

    results.ms = performance.now() - t0;
    app.rcResults = results;
    return results;
  }

  // ------------------------------------------------------------ force table
  // rows: per member, envelope of the worst combo (or patterns if none)
  function forceTable(app) {
    const R = app.rcResults;
    if (!R) return null;
    const src = R.combos.length ? R.combos : R.patterns.map(p => ({ name: p.name, members: p.members }));
    return src.map(cs => ({
      name: cs.name,
      members: cs.members.map(m => ({
        id: m.id, type: m.type,
        Mi: m.Mi / 1e6, Mj: m.Mj / 1e6,   // kN·m
        Vi: m.Vi / 1e3, Vj: m.Vj / 1e3,   // kN
        P: (Math.abs(m.Fi) > Math.abs(m.Fj) ? m.Fi : m.Fj) / 1e3, // kN (worst end)
      })),
    }));
  }

  // ---------------------------------------------------- analyze ribbon entry
  function open(app, cat) {
    if (cat === 'runAnalysis') {
      const r = runAnalysis(app);
      if (r.error) { app.toast(r.error, true); return; }
      app.toast('Analysis complete — ' + r.nodes + ' nodes, ' + r.model.frames.length + ' members, ' +
        r.patterns.length + ' pattern(s), ' + r.combos.length + ' combo(s), ' + r.ms.toFixed(0) + ' ms');
      return;
    }
    if (cat === 'forceTable') {
      const table = forceTable(app);
      if (!table) { app.toast('Run the analysis first', true); return; }
      const esc2 = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const render = idx => {
        const cs = table[Math.min(idx, table.length - 1)];
        const rows = cs.members.map(m =>
          '<tr><td style="padding:3px 8px">' + esc2(m.type) + '</td><td>' + esc2(m.id) + '</td>' +
          '<td>' + m.P.toFixed(1) + '</td><td>' + m.Vi.toFixed(1) + ' / ' + m.Vj.toFixed(1) + '</td>' +
          '<td>' + m.Mi.toFixed(1) + ' / ' + m.Mj.toFixed(1) + '</td></tr>').join('');
        return '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
          '<thead><tr style="text-align:left;opacity:.7"><th style="padding:4px 8px;border-bottom:1px solid #d7dde3">Type</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">Element</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">P (kN)</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">V i/j (kN)</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">M i/j (kN&middot;m)</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>';
      };
      const html = '<div style="max-height:60vh;overflow:auto"><div id="ft-wrap">' + render(0) + '</div></div>';
      const buttons = [];
      if (table.length > 1) for (const cs of table) buttons.push([cs.name.slice(0, 18), () => {
        document.getElementById('ft-wrap').innerHTML = render(table.indexOf(cs));
        return false;
      }]);
      buttons.push(['Close', null]);
      app.dialog('Member Forces', html, buttons);
      return;
    }
  }

  root.RCModel = { buildModel, buildLoads, runAnalysis, forceTable, open };
})(window);
