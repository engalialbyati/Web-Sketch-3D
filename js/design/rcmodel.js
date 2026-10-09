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

      // stiffness modifiers (ETABS SetModifiers): a→A, i22→Iy, i33→Iz,
      // torsion→J, mass/weight→self weight — ACI cracked-section values
      // (0.35 beam / 0.7 column) are the practical use
      const mo = sec.modifiers || {};
      const As = 5 / 6 * (bmm || 300) * (hmm || 300); // rectangular shear area
      // engine convention (verified): for horizontal members the vertical
      // bending stiffness lives in the Iz slot → strong axis as Iz
      frames.push({
        ni, nj, E: Ec, G: Gm,
        A: A * (mo.a ?? 1),
        Iy: I22 * (mo.i22 ?? 1), Iz: I33 * (mo.i33 ?? 1),
        J: J * (mo.torsion ?? 1),
        As2: As * (mo.as2 ?? 1), As3: As * (mo.as3 ?? 1),
        rho: (() => { // kg/mm³ for the modal mass
          const g = mat && mat.weight ? mat.weight.value : 25; // kN/m³
          const kgm3 = (mat && mat.weight && mat.weight.as === 'mass') ? g : g * 1000 / 9.81;
          return kgm3 * 1e-12 * (mo.mass ?? 1);
        })(),
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
          const mo = sec.modifiers || {};
          const gamma = (mat && mat.weight ? mat.weight.value : 25) * 1000 * (mo.weight ?? 1); // N/m³
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

      // joint loads (Assign ▸ Joint Loads): forces at member ends
      for (let i = 0; i < model.frames.length; i++) {
        const m = model.map.find(x => x.idx === i);
        if (!m) continue;
        for (const J of m.ent.params.jointLoads || []) {
          if (J.pattern !== pat.name) continue;
          const at = J.end === 'j' ? model.frames[i].nj : model.frames[i].ni;
          addNodal(at, (J.fx || 0) * 1000, (J.fy || 0) * 1000, (J.fz || 0) * 1000);
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
    const base = augmentModel(app, model);   // springs, rigid ties, generated loads
    const { loads, memberLoads, patternNames } = buildLoads2(app, model, base);

    const t0 = performance.now();
    const d = RD().ensure(app);
    const patIdx = new Map(patternNames.map((n, i) => [n, i]));
    const comboDefs = d.combos;

    // solve pattern-by-pattern; iterated P-Delta when a pattern opts in
    // (its auto data or the case options request geo) — axials from the
    // previous pass feed the geometric stiffness, 3 iterations to settle
    const results = { patterns: [], combos: [], model, ms: 0, nDof: model.nodes.length * 6, nodes: model.nodes.length };
    const nStations = 11;
    for (let p = 0; p < loads.length; p++) {
      let geo = null, U = null, forces = null, reactions = null;
      for (let it = 0; it < 3; it++) {
        const r = FE().assembleAndSolve(model.nodes, model.frames, [], [loads[p]],
          { memberLoads: memberLoads[p] || null, geo, nodalSprings: base.nodalSprings });
        U = r.U[0]; forces = r.frames;
        if (!base.pDelta) break;
        // update member axial forces for the next geometric pass
        geo = forces.map(f => (f.forces[0] + f.forces[6]) / 2);
      }
      // support reactions: R = K·u − f at fixed dofs (re-assemble w/o destroy)
      reactions = FE().computeReactions(model.nodes, model.frames, [], [loads[p]],
        [U], { memberLoads: memberLoads[p] || null, geo, nodalSprings: base.nodalSprings });

      // station forces along each member (statics from end forces + loads)
      const members = forces.map((f, i) => {
        if (model.frames[i].dummy) return null;
        const m = model.map[i] || {};
        const ml = (memberLoads[p] || [])[i] || {};
        const L = f.L;
        const wy = ml.wy || 0, pts = ml.points || [];
        const stations = [];
        for (let k = 0; k < nStations; k++) {
          const x = L * k / (nStations - 1);
          // local statics: M(x) = Mi + Vi·x − wy·x²/2 − Σ P⟨x−a⟩ ; shear likewise
          let M = f.forces[5] + (-f.forces[1]) * x;  // Mi(end force) + shear rising
          let V = -f.forces[1];
          M += -wy * x * x / 2; V += -wy * x;
          for (const pt of pts) {
            const a = pt.a;
            if (x >= a) { M -= pt.P * (x - a); V -= pt.P; }
          }
          stations.push({ x: x / 1000, M: -M / 1e6, V: V / 1e3 }); // kN·m, kN
        }
        return {
          idx: i,
          Fi: f.forces[0], Vi: -f.forces[1], Mi: -f.forces[5],
          Fj: f.forces[6], Vj: f.forces[7], Mj: f.forces[11],
          Ti: f.forces[3],
          Vi2: -f.forces[2], Mi2: -f.forces[4],
          Vj2: f.forces[8], Mj2: f.forces[10],
          id: m.ent ? m.ent.id : `f${i}`, type: m.ent ? m.ent.type : '?',
          stations,
        };
      });
      results.patterns.push({ name: patternNames[p], members, reactions });
    }

    // combinations over pattern end-forces — add / absolute / SRSS / envelope
    const mix = (type, vals) => {
      const t = type || 'add';
      if (t === 'srss') return Math.sqrt(vals.reduce((a, v) => a + v * v, 0));
      if (t === 'absolute') return vals.reduce((a, v) => a + Math.abs(v), 0);
      return vals.reduce((a, v) => a + v, 0); // add & envelope share the sum pass
    };
    for (const cb of comboDefs) {
      const w = new Array(loads.length).fill(0);
      let used = 0;
      for (const item of cb.cases) {
        const pi = patIdx.get(item.name);
        if (pi != null) { w[pi] += item.scale || 1; used++; }
      }
      if (!used) continue;
      const type = cb.type || 'add';
      const members = results.patterns[0].members.map((m0, mi) => {
        const pick = k => {
          const vals = [];
          for (let p = 0; p < loads.length; p++) {
            if (w[p]) vals.push(w[p] * results.patterns[p].members[mi][k]);
          }
          if (type === 'envelope') return { min: Math.min(...vals, 0), max: Math.max(...vals, 0) };
          return mix(type, vals);
        };
        const m1 = { Fi: pick('Fi'), Vi: pick('Vi'), Mi: pick('Mi'), Fj: pick('Fj'), Vj: pick('Vj'), Mj: pick('Mj'), Ti: pick('Ti'),
          Vi2: pick('Vi2'), Mi2: pick('Mi2'), Vj2: pick('Vj2'), Mj2: pick('Mj2') };
        // stations (add/srss only — envelope over stations is phase-2)
        if (type !== 'envelope') {
          m1.stations = results.patterns[0].members[mi].stations.map((st, si) => {
            const Mvals = [], Vvals = [];
            for (let p = 0; p < loads.length; p++) {
              if (w[p]) {
                Mvals.push(w[p] * results.patterns[p].members[mi].stations[si].M);
                Vvals.push(w[p] * results.patterns[p].members[mi].stations[si].V);
              }
            }
            return { x: st.x, M: mix(type, Mvals), V: mix(type, Vvals) };
          });
        }
        return { id: m0.id, type: m0.type, ...m1 };
      });
      results.combos.push({ name: cb.name, members });
    }

    // modal: run when a modal load case is defined (numModes honored)
    const modalCase = d.loadCases.find(c => c.type === 'modal');
    if (modalCase) {
      try {
        const m = FE().modalAnalysis(model.nodes, model.frames, [], (modalCase.data && modalCase.data.numModes) || 6);
        results.modal = (m.modes || []).slice(0, 12).map(md => ({ T: md.T, f: md.f || (md.T ? 1 / md.T : 0) }));
      } catch (e) { results.modalError = String(e.message); }
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
        P: (Math.abs(m.Fi) > Math.abs(m.Fj) ? m.Fi : m.Fj) / 1e3, // kN (worst end)
        V2i: (m.Vi2 || 0) / 1e3, V2j: (m.Vj2 || 0) / 1e3,   // kN — ETABS V2 (minor axis)
        V3i: m.Vi / 1e3, V3j: m.Vj / 1e3,                    // kN — ETABS V3 (major/gravity)
        T: (m.Ti || 0) / 1e6,                                // kN·m — ETABS T (torsion)
        M2i: (m.Mi2 || 0) / 1e6, M2j: (m.Mj2 || 0) / 1e6,   // kN·m — ETABS M2 (minor)
        M3i: m.Mi / 1e6, M3j: m.Mj / 1e6,                    // kN·m — ETABS M3 (major/gravity)
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
      const R = app.rcResults;
      const extra = [];
      if (R.modal && R.modal.length) {
        extra.push('<div style="font-size:12px;margin:0 0 6px"><b>Modal periods:</b> ' +
          R.modal.map(md => 'T₁=' + md.T.toFixed(3) + ' s').slice(0, 3).join(' &middot; ') + '</div>');
      }
      const rx = R.patterns[0] && R.patterns[0].reactions;
      if (rx && rx.length) {
        const rows = rx.map(rec =>
          '<tr><td style="padding:3px 8px">node ' + rec.node + '</td><td>' + (rec.R[0]/1e3).toFixed(1) + '</td><td>' + (rec.R[1]/1e3).toFixed(1) + '</td><td>' + (rec.R[2]/1e3).toFixed(1) + '</td></tr>').join('');
        extra.push('<div style="font-size:12px;margin:0 0 6px"><b>Base reactions (kN) — first pattern:</b>' +
          '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="text-align:left;opacity:.7">' +
          '<th style="padding:2px 8px">Support</th><th>Fx</th><th>Fy</th><th>Fz</th></tr></thead><tbody>' + rows + '</tbody></table></div>');
      }
      const esc2 = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const render = idx => {
        const cs = table[Math.min(idx, table.length - 1)];
        const rows = cs.members.map(m =>
          '<tr><td style="padding:3px 8px">' + esc2(m.type) + '</td><td>' + esc2(m.id) + '</td>' +
          '<td>' + m.P.toFixed(1) + '</td>' +
          '<td>' + m.V2i.toFixed(1) + ' / ' + m.V2j.toFixed(1) + '</td>' +
          '<td>' + m.V3i.toFixed(1) + ' / ' + m.V3j.toFixed(1) + '</td>' +
          '<td>' + m.T.toFixed(2) + '</td>' +
          '<td>' + m.M2i.toFixed(1) + ' / ' + m.M2j.toFixed(1) + '</td>' +
          '<td>' + m.M3i.toFixed(1) + ' / ' + m.M3j.toFixed(1) + '</td></tr>').join('');
        return '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
          '<thead><tr style="text-align:left;opacity:.7"><th style="padding:4px 8px;border-bottom:1px solid #d7dde3">Type</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">Element</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">P (kN)</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">V2 i/j (kN)</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">V3 i/j (kN)</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">T (kN&middot;m)</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">M2 i/j (kN&middot;m)</th>' +
          '<th style="padding:4px 8px;border-bottom:1px solid #d7dde3">M3 i/j (kN&middot;m)</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>';
      };
      const html = '<div style="max-height:60vh;overflow:auto">' + extra.join('') + '<div id="ft-wrap">' + render(0) + '</div></div>';
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


  // ==========================================================================
  // AUTO LOADS + ANALYSIS OPTIONS (augmentModel)
  // Generates load vectors for patterns carrying auto seismic / auto wind
  // assignments (ASCE 7-16 parameter set per the API doc), and collects
  // solver options: nodal springs (point springs at column bases) and
  // rigid diaphragm ties (slabs assigned a rigid diaphragm).
  // ==========================================================================
  function storyTable(app, model) {
    const levels = [...new Set(model.nodes.map(n => +n.z.toFixed(4)))].sort((a, b) => a - b);
    const storyW = levels.map(() => 0);
    for (const m of model.map) {
      const sec = sectionOf(app, m.ent);
      const mat = materialOf(app, sec, m.ent);
      const gamma = (mat && mat.weight ? mat.weight.value : 25) * 1000; // N/m³
      const A = (RD().frameSectionProps(sec).A || 0) * 1e6;            // mm²
      const f = model.frames[m.idx];
      const a = model.nodes[f.ni], b = model.nodes[f.nj];
      const lenM = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const W = A * gamma * 1e-9 * lenM; // N
      const zi = levels.findIndex(z => Math.abs(a.z - z) < 1e-4);
      const zj = levels.findIndex(z => Math.abs(b.z - z) < 1e-4);
      if (zi >= 0) storyW[zi] += W / 2;
      if (zj >= 0) storyW[zj] += W / 2;
    }
    return { levels, storyW };
  }

  function augmentModel(app, model) {
    const d = RD().ensure(app);
    const out = { nodalSprings: [], rigidLinks: [], generated: {} };

    // point springs at column bases (params.pointSpring; k in kN/m ≡ N/mm)
    for (const m of model.map) {
      const spName = m.ent.params.pointSpring;
      if (!spName) continue;
      const sp = d.pointSprings.find(x => x.name === spName);
      if (!sp) continue;
      const f = model.frames[m.idx], base = model.nodes[f.ni];
      const zMin = Math.min(...model.nodes.map(n => n.z));
      if (Math.abs(base.z - zMin) > 1e-4) continue;
      out.nodalSprings.push({ ni: f.ni, k: [sp.k1 || 0, sp.k2 || 0, sp.k3 || 0, 0, 0, 0] });
    }

    // rigid diaphragms: slabs/roofs assigned a diaphragm with semiRigid ===
    // false become RIGID LINKS — dummy frame elements (master → slave,
    // stiffness 1e6×) whose standard transformation gives the exact
    // rigid-body in-plane coupling, penalty springs not required
    const diaNodes = new Map(); // name → { z, nodes:Set }
    for (const e of app.bim.entities) {
      if (e.type !== 'slab' && e.type !== 'roof') continue;
      if (!e.params.diaphragm) continue;
      const dia = d.diaphragms.find(x => x.name === e.params.diaphragm);
      if (!dia || dia.semiRigid !== false) continue; // semirigid = members only
      let z = null;
      if (e.params.baseLevel) {
        const lvl = app.levelManager.levels.find(l => l.id === e.params.baseLevel);
        if (lvl) z = +lvl.elevation.toFixed(4);
      }
      if (z == null) {
        const own = model.nodes.map((n, i) => ({ n, i }))
          .filter(x => model.frames.some(f => f.ni === x.i || f.nj === x.i));
        z = own.length ? +own[0].n.z.toFixed(4) : null;
      }
      if (z == null) continue;
      const rec = diaNodes.get(e.params.diaphragm) || { z, nodes: new Set() };
      for (const x of model.nodes.map((n, i) => ({ n, i })))
        if (Math.abs(x.n.z - z) < 1e-4) rec.nodes.add(x.i);
      diaNodes.set(e.params.diaphragm, rec);
    }
    for (const [, rec] of diaNodes) {
      const arr = [...rec.nodes];
      if (arr.length < 2) continue;
      for (let i = 1; i < arr.length; i++) {
        frames.push({
          ni: arr[0], nj: arr[i], E: 2.5e11, G: 1e11,
          A: 1e6, Iy: 1e12, Iz: 1e12, J: 1e12,
          rho: 1e-18, dummy: true,
        });
      }
    }

    // generated loads per auto pattern
    for (const pat of d.loadPatterns) {
      const auto = pat.auto;
      if (!auto) continue;
      if (auto.seismic) {
        const a = auto.seismic;
        const { levels, storyW } = storyTable(app, model);
        const hn = levels[levels.length - 1] - levels[0];
        const SDS = (a.fa || 1) * a.ss, SD1 = (a.fv || 1) * a.s1;
        let T;
        if (a.periodFlag === 3) T = a.userT;
        else if (a.periodFlag === 2 || a.periodFlag === 1) {
          const cts = [[0.028, 0.8], [0.016, 0.9], [0.030, 0.75], [0.020, 0.75]];
          const ctFt = cts[a.ctType || 0][0], x = cts[a.ctType || 0][1];
          T = ctFt * Math.pow(3.2808, 1 - x) * Math.pow(hn, x); // hn in m
        }
        const TL = a.tl || 8, R = a.r || 5, Ie = a.ie || 1;
        let Cs = SDS / (R / Ie);
        if (T <= TL) Cs = Math.min(Cs, SD1 / (R / Ie));
        Cs = Math.max(Cs, 0.044 * SDS / Ie, 0.01);
        const W = storyW.reduce((acc, w) => acc + w, 0);
        const V = Cs * W;
        // vertical distribution: linear in w·h (ASCE 12.8.3 equivalent)
        const k = 1;
        const Fx = levels.map((z, i) => ({ z, w: storyW[i], h: z - levels[0] }));
        let acc = 0;
        for (const x of Fx) acc += x.w * Math.pow(Math.max(x.h, 1), k);
        for (const x of Fx) x.F = V * x.w * Math.pow(Math.max(x.h, 1), k) / (acc || 1);
        // direction: which of the 6 toggles are on (force sign/axis)
        const dirs = a.dirs || { x: true };
        const gens = [];
        if (dirs.x) gens.push({ axis: 0, sign: 1 });
        if (dirs.y) gens.push({ axis: 1, sign: 1 });
        if (dirs.xEcc) gens.push({ axis: 0, sign: 1 });
        if (dirs.yEcc) gens.push({ axis: 1, sign: 1 });
        if (dirs.xMinusEcc) gens.push({ axis: 0, sign: -1 });
        if (dirs.yMinusEcc) gens.push({ axis: 1, sign: -1 });
        out.generated[pat.name] = {
          seismic: {
            Cs: +Cs.toFixed(4), V: +V.toFixed(1), W: +W.toFixed(1), T: +T.toFixed(3),
            stories: Fx.map((x, i) => ({ z: x.z, F: +x.F.toFixed(1), dirs: gens })),
            levels,
          },
        };
      }
      if (auto.wind) {
        const w = auto.wind;
        const zg = { B: 365.76, C: 274.32, D: 213.36 }[w.exposure] || 274.32;
        const alpha = { B: 7.0, C: 9.5, D: 11.5 }[w.exposure] || 9.5;
        const { levels } = storyTable(app, model);
        const qzTop = 0.613 * Math.pow((w.kd || 0.85) * (w.kzt || 1), -0) *
          Math.pow(2.01 / Math.pow(zg, 2 / alpha), -1) * Math.pow(Math.max(levels[levels.length - 1], 9.1), 2 / alpha) *
          Math.pow(w.speed || 47, 2) * 0.5 / 1000; // kN/m² (0.5ρV² form, SI)
        out.generated[pat.name] = {
          wind: { qzTop: +qzTop.toFixed(3), exposure: w.exposure },
        };
      }
    }
    return out;
  }

  // buildLoads2: base patterns + generated auto story forces merged per pattern
  function buildLoads2(app, model, base) {
    const baseLoads = buildLoads(app, model);
    for (const [patName, gen] of Object.entries(base.generated)) {
      if (!gen.seismic) continue;
      const pi = baseLoads.patternNames.indexOf(patName);
      if (pi < 0) continue; // auto pattern must exist as a load pattern
      const nodal = baseLoads.loads[pi];
      for (const st of gen.seismic.stories) {
        for (const dir of st.dirs) {
          const framesAt = model.frames.filter(f => Math.abs(model.nodes[f.ni].z - st.z) < 1e-4);
          const per = F => F / Math.max(1, framesAt.length);
          for (const f of framesAt) {
            const c = nodal.get(f.nj) || [0, 0, 0, 0, 0, 0];
            c[dir.axis] += dir.sign * per(st.F);
            nodal.set(f.nj, c);
          }
        }
      }
    }
    return baseLoads;
  }


  // --------------------------------------------------- assign: joint loads
  // ETABS Assign ▸ Joint Loads: forces at a member end (the analysis node).
  function openAssign(app, cat) {
    if (cat === 'assignJointLoads') {
      const ents = RD().selectedStructuralEnts(app, ['beam', 'column']);
      if (!ents.length) { app.toast('Select beams/columns first', true); return; }
      const d = RD().ensure(app);
      const patOpts = d.loadPatterns.map(p => '<option value="' + p.name + '">' + p.name + ' (' + p.type + ')</option>').join('');
      const html = [
        '<p style="margin:0 0 6px;font-size:12px;opacity:.8">' + ents.length + ' element(s) selected — the load lands on the chosen END node.</p>',
        '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Load Pattern</span>' +
          '<select id="jl-pat" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">' + patOpts + '</select></div>',
        '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">End</span>' +
          '<select id="jl-end" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px"><option value="i">I (start)</option><option value="j">J (end)</option></select></div>',
        '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Fx / Fy / Fz (kN)</span>' +
          '<input id="jl-fx" type="number" step="any" value="0" style="width:70px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">' +
          '<input id="jl-fy" type="number" step="any" value="0" style="width:70px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">' +
          '<input id="jl-fz" type="number" step="any" value="0" style="width:70px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px"></div>',
      ].join('');
      app.dialog('Assign Joint Loads', html, [
        ['Add', () => {
          const pat = document.getElementById('jl-pat').value;
          const end = document.getElementById('jl-end').value;
          const fx = +document.getElementById('jl-fx').value || 0;
          const fy = +document.getElementById('jl-fy').value || 0;
          const fz = +document.getElementById('jl-fz').value || 0;
          if (!fx && !fy && !fz) { app.toast('Enter a force', true); return false; }
          for (const ent of ents) {
            (ent.params.jointLoads = ent.params.jointLoads || []).push({ pattern: pat, end, fx, fy, fz });
          }
          app.toast('Joint loads added to ' + ents.length + ' element(s)');
        }],
        ['Close', null],
      ]);
      return;
    }
    if (cat === 'assignPointSpring') {
      const ents = RD().selectedStructuralEnts(app, ['column']);
      if (!ents.length) { app.toast('Select columns first', true); return; }
      const d = RD().ensure(app);
      const opts = d.pointSprings.map(s2 => '<option value="' + s2.name + '">' + s2.name + '</option>').join('');
      const html = '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Point Spring</span>' +
        '<select id="ps-name" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">' + opts + '</select></div>' +
        '<p style="font-size:11px;opacity:.7;margin:6px 0 0">Applied at the column base when it reaches the lowest level.</p>';
      app.dialog('Assign Point Spring', html, [
        ['Assign', () => {
          const name = document.getElementById('ps-name').value;
          for (const ent of ents) ent.params.pointSpring = name;
          app.toast('Point spring assigned to ' + ents.length + ' column(s)');
        }],
        ['Remove', () => {
          for (const ent of ents) delete ent.params.pointSpring;
          app.toast('Point springs removed');
        }],
        ['Close', null],
      ]);
      return;
    }
  }

  root.RCModel = { buildModel, buildLoads, buildLoads2, augmentModel, runAnalysis, forceTable, open, openAssign };
})(window);

