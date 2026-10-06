'use strict';
// model.js — RC Studio structural model (ETABS-style).
// The model is joint/frame based, like ETABS: stories + gridlines define
// the workspace; members connect joints; sections/patterns/assignments
// carry the design data; analysis feeds the js/fea.js engine (nodes in
// metres, E in MPa, A in mm², I in mm⁴, forces in N, displacements mm).
(function () {
  const CONCRETE = { Ec: 25000, nu: 0.2, density: 24 }; // MPa, kN/m³

  const DEFAULT_SECTIONS = () => ([
    { id: 'C30x30', kind: 'column', b: 0.30, h: 0.30, material: 'C30' },
    { id: 'C40x40', kind: 'column', b: 0.40, h: 0.40, material: 'C40' },
    { id: 'C40x60', kind: 'column', b: 0.40, h: 0.60, material: 'C40' },
    { id: 'B25x50', kind: 'beam', b: 0.25, h: 0.50, material: 'C30' },
    { id: 'B30x60', kind: 'beam', b: 0.30, h: 0.60, material: 'C30' },
  ]);

  const DEFAULT_PATTERNS = () => ([
    { id: 'DEAD', name: 'Dead', type: 'dead', swMult: 1 },
    { id: 'SUPER', name: 'Superimposed Dead', type: 'dead', swMult: 0 },
    { id: 'LIVE', name: 'Live', type: 'live', swMult: 0 },
    { id: 'WINDX', name: 'Wind X', type: 'wind', swMult: 0 },
  ]);

  const DEFAULT_MATERIALS = () => ([
    { id: 'C30', name: 'Concrete C30', Ec: 25000, density: 24, fc: 30 },
    { id: 'C40', name: 'Concrete C40', Ec: 28000, density: 25, fc: 40 },
  ]);

  // ETABS Define > Mass Source: self-weight multipliers, additional joint
  // masses, and a live-load fraction — used by modal + auto seismic weight
  const DEFAULT_MASS_SOURCE = () => ({ selfWeight: true, additional: true, livePattern: null, liveFraction: 0 });

  function newModel() {
    return {
      v: 1,
      stories: [{ name: 'Story1', elevation: 0 }],
      storyHeight: 3,
      grids: { x: [], y: [] },
      joints: [],   // {id, x, y, z, restraint: null|'fixed'|'pinned'|[6 dof flags]}
      jointMasses: [], // {jointId, m} tonnes (Assign > Joint > Additional Mass)
      frames: [],   // {id, kind, i, j, section, releaseI, releaseJ}
      sections: DEFAULT_SECTIONS(),
      materials: DEFAULT_MATERIALS(),
      massSource: DEFAULT_MASS_SOURCE(),
      active: { column: 'C30x30', beam: 'B25x50' },
      patterns: DEFAULT_PATTERNS(),
      frameLoads: [], // {frameId, pattern, w (kN/m), dir}
      jointLoads: [], // {jointId, pattern, fx, fy, fz} kN
      autoSeismic: null,
      autoWind: null,
      results: null, modal: null,
      nextJ: 1, nextF: 1,
    };
  }

  // ETABS local end releases: [P, V2, V3, T, M2, M3] per end
  const RELEASE_DOF = { p: 0, v2: 1, v3: 2, t: 3, m2: 4, m3: 5 };
  function releaseDofs(releaseI, releaseJ) {
    const out = [];
    if (releaseI) for (const k of Object.keys(releaseI)) if (releaseI[k] && RELEASE_DOF[k] != null) out.push(RELEASE_DOF[k]);
    if (releaseJ) for (const k of Object.keys(releaseJ)) if (releaseJ[k] && RELEASE_DOF[k] != null) out.push(6 + RELEASE_DOF[k]);
    return out;
  }

  const key = (x, y, z) => (Math.round(x * 1000) + '|' + Math.round(y * 1000) + '|' + Math.round(z * 1000));

  function jointAt(m, x, y, z) {
    const k = key(x, y, z);
    for (const j of m.joints) if (key(j.x, j.y, j.z) === k) return j;
    const j = { id: 'J' + (m.nextJ++), x, y, z, restraint: null };
    m.joints.push(j);
    return j;
  }

  function storyElevation(m, idx) { return m.stories[idx].elevation; }

  // ETABS plan drawing: a COLUMN at story s rises from s−1 to s; a BEAM runs
  // between two joints at the story's elevation
  function addColumn(m, storyIdx, x, y, sectionId) {
    if (storyIdx < 1) return null; // columns start at Story1 (above the base Story0... stories[0] IS base at 0)
    const z0 = storyElevation(m, storyIdx - 1), z1 = storyElevation(m, storyIdx);
    const a = jointAt(m, x, y, z0), b = jointAt(m, x, y, z1);
    for (const f of m.frames)
      if ((f.i === a.id && f.j === b.id) || (f.i === b.id && f.j === a.id)) return f;
    const f = { id: 'C' + (m.nextF++), kind: 'column', i: a.id, j: b.id, section: sectionId || m.active.column };
    m.frames.push(f);
    return f;
  }

  function addBeam(m, storyIdx, x1, y1, x2, y2, sectionId) {
    const z = storyElevation(m, storyIdx);
    const a = jointAt(m, x1, y1, z), b = jointAt(m, x2, y1 === y1 ? y2 : y2, z);
    if (a === b) return null;
    for (const f of m.frames)
      if ((f.i === a.id && f.j === b.id) || (f.i === b.id && f.j === a.id)) return f;
    const f = { id: 'B' + (m.nextF++), kind: 'beam', i: a.id, j: b.id, section: sectionId || m.active.beam };
    m.frames.push(f);
    return f;
  }

  function jointById(m, id) { return m.joints.find(j => j.id === id); }
  function frameSection(m, f) { return m.sections.find(s => s.id === f.section) || m.sections[0]; }

  // ================================================== analysis mesh
  // Joints ARE nodes; frames get their section's A/I; supports at the lowest
  // elevation are fixed unless a restraint overrides them (ETABS defaults).
  function buildMesh(m) {
    const nodes = m.joints.map(j => ({
      x: j.x, y: j.y, z: j.z,
      fixed: supportOf(m, j),
    }));
    const index = new Map(m.joints.map((j, i) => [j.id, i]));
    const frames = m.frames.map(f => {
      const s = frameSection(m, f);
      const mat = m.materials.find(x => x.id === (s.material || 'C30')) || m.materials[0];
      const b = Math.max(s.b, 0.05), h = Math.max(s.h, 0.05);
      const releases = releaseDofs(f.releaseI, f.releaseJ);
      return {
        ni: index.get(f.i), nj: index.get(f.j),
        E: mat.Ec,
        A: b * h * 1e6,
        Iy: h * b * b * b / 12 * 1e12,
        Iz: b * h * h * h / 12 * 1e12,
        J: 0.1 * (b + h) ** 3 / 3 * 1e12,
        rho: mat.density / 9.81 * 1e-9, // t/mm3 for the modal mass
        kind: f.kind, frameId: f.id,
        releases: releases.length ? releases : undefined,
      };
    });
    return { nodes, frames, index };
  }

  function supportOf(m, j) {
    // ETABS Assign > Joint > Restraints: an explicit 6-flag DOF array wins
    if (Array.isArray(j.restraint)) return j.restraint;
    const zMin = Math.min(...m.stories.map(s => s.elevation));
    if (Math.abs(j.z - zMin) < 1e-6) {
      if (j.restraint === 'pinned') return [1, 1, 1, 0, 0, 0];
      return [1, 1, 1, 1, 1, 1]; // fixed base by default
    }
    if (j.restraint === 'fixed') return [1, 1, 1, 1, 1, 1];
    if (j.restraint === 'pinned') return [1, 1, 1, 0, 0, 0];
    return null;
  }

  // ================================================== loads
  const DIRS = {
    gravity: [0, 0, -1], '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0],
  };

  function buildLoads(m, mesh, opts) {
    opts = opts || {};
    const FEA = window.FEA, G = window.G;
    const loads = {}, memberLoads = {};
    for (const p of m.patterns) {
      loads[p.id] = new Map();
      memberLoads[p.id] = new Array(mesh.frames.length).fill(null);
    }
    const add = (pid, ni, vals) => {
      const map = loads[pid]; if (!map) return;
      if (!map.has(ni)) map.set(ni, [0, 0, 0, 0, 0, 0]);
      for (let i = 0; i < 6; i++) map.get(ni)[i] += vals[i] || 0;
    };
    const addML = (fi, pid, wy, wz) => {
      const cur = memberLoads[pid][fi] || { wy: 0, wz: 0 };
      cur.wy += wy; cur.wz += wz;
      memberLoads[pid][fi] = cur;
    };

    // self-weight: beams as consistent member loads (exact wL²/8 moments),
    // columns as nodal halves (pure axial path)
    for (const p of m.patterns) {
      if (!p.swMult) continue;
      mesh.frames.forEach((fr, fi) => {
        const a = mesh.nodes[fr.ni], b = mesh.nodes[fr.nj];
        const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const w = (fr.A / 1e6) * CONCRETE.density * p.swMult; // kN/m
        if (fr.kind === 'beam') {
          const R = FEA.rotationMatrix(a, b);
          addML(fi, p.id, -w * R[1][2], -w * R[2][2]); // gravity onto local y/z
        } else {
          const fz = -w * L / 2 * 1000;
          add(p.id, fr.ni, [0, 0, fz]);
          add(p.id, fr.nj, [0, 0, fz]);
        }
      });
    }

    // assigned frame UDLs (kN/m == N/mm)
    for (const a of m.frameLoads) {
      const fi = mesh.frames.findIndex(f => f.frameId === a.frameId);
      if (fi < 0 || !loads[a.pattern]) continue;
      const fr = mesh.frames[fi];
      const R = FEA.rotationMatrix(mesh.nodes[fr.ni], mesh.nodes[fr.nj]);
      const d = DIRS[a.dir || 'gravity'] || DIRS.gravity;
      addML(fi, a.pattern, (d[0] * R[1][0] + d[1] * R[1][1] + d[2] * R[1][2]) * a.w,
        (d[0] * R[2][0] + d[1] * R[2][1] + d[2] * R[2][2]) * a.w);
    }

    // assigned joint loads (kN → N)
    for (const jl of m.jointLoads) {
      const ni = mesh.index.get(jl.jointId);
      if (ni == null || !loads[jl.pattern]) continue;
      add(jl.pattern, ni, [(jl.fx || 0) * 1000, (jl.fy || 0) * 1000, (jl.fz || 0) * 1000]);
    }

    // auto lateral (ASCE 7-16 §12.8 / §26) — ported from design-rc
    const auto = { seismic: null, wind: null };
    applyAutoLateral(m, mesh, loads, memberLoads, add, auto);
    return { loads, memberLoads, auto };
  }

  const EXPOSURES = {
    B: { alpha: 7.0, zg: 365.76, zmin: 9.14 },
    C: { alpha: 9.5, zg: 274.32, zmin: 9.14 },
    D: { alpha: 11.5, zg: 213.36, zmin: 4.57 },
  };

  function applyAutoLateral(m, mesh, loads, memberLoads, add, out) {
    const FEA = window.FEA;
    const as = m.autoSeismic;
    if (as && as.enabled !== false) {
      let zMax = 0;
      for (const n of mesh.nodes) zMax = Math.max(zMax, n.z);
      const csInfo = seismicCs(as, zMax);
      const cs = csInfo.cs;
      const ms = m.massSource || DEFAULT_MASS_SOURCE();
      const w = new Float64Array(mesh.nodes.length);
      // additional joint masses (Assign > Joint > Additional Mass)
      if (ms.additional !== false) for (const jm of m.jointMasses || []) {
        const ni = mesh.index.get(jm.jointId);
        if (ni != null) w[ni] += (jm.m || 0) * 9.81 * 1000;
      }
      for (const p of m.patterns) {
        if (p.type === 'dead' && ms.selfWeight !== false) {
          for (const [ni, v] of loads[p.id]) w[ni] += Math.abs(v[2] || 0);
          const ml = memberLoads[p.id];
          if (ml) mesh.frames.forEach((fr, fi) => {
            const mm = ml[fi]; if (!mm) return;
            const R = FEA.rotationMatrix(mesh.nodes[fr.ni], mesh.nodes[fr.nj]);
            const vz = Math.abs((mm.wy || 0) * R[1][2] + (mm.wz || 0) * R[2][2]);
            if (!vz) return;
            const L = Math.hypot(mesh.nodes[fr.nj].x - mesh.nodes[fr.ni].x, mesh.nodes[fr.nj].y - mesh.nodes[fr.ni].y, mesh.nodes[fr.nj].z - mesh.nodes[fr.ni].z);
            w[fr.ni] += vz * L * 1000 / 2; w[fr.nj] += vz * L * 1000 / 2;
          });
        }
      }
      const lf = ms.livePattern && ms.liveFraction > 0 ? { pat: ms.livePattern, f: ms.liveFraction } : null;
      if (lf && m.frameLoads) for (const fl of m.frameLoads.filter(x => x.pattern === lf.pat)) {
        // vertical component of the UDL in gravity direction
        if ((fl.dir || 'gravity') === 'gravity') {
          const fi = mesh.frames.findIndex(x => x.frameId === fl.frameId);
          if (fi >= 0) {
            const fr = mesh.frames[fi];
            const a2 = mesh.nodes[fr.ni], b2 = mesh.nodes[fr.nj];
            const Lm = Math.hypot(b2.x - a2.x, b2.y - a2.y, b2.z - a2.z);
            w[fr.ni] += lf.f * fl.w * Lm * 1000 / 2;
            w[fr.nj] += lf.f * fl.w * Lm * 1000 / 2;
          }
        }
      }
      let W = 0; for (let i = 0; i < w.length; i++) W += w[i];
      const pid = 'EQX';
      if (!loads[pid]) { loads[pid] = new Map(); memberLoads[pid] = new Array(mesh.frames.length).fill(null); }
      const map = loads[pid];
      const dirV = DIRS[as.dir || '+x'] || DIRS['+x'];
      let sumCx = 0;
      const cv = new Float64Array(mesh.nodes.length);
      for (let i = 0; i < mesh.nodes.length; i++) {
        cv[i] = w[i] * Math.pow(Math.max(mesh.nodes[i].z, 0), 2);
        sumCx += cv[i];
      }
      const V = cs * W;
      if (sumCx > 0) for (let i = 0; i < mesh.nodes.length; i++) {
        const F = V * cv[i] / sumCx;
        if (F) { if (!map.has(i)) map.set(i, [0, 0, 0, 0, 0, 0]); map.get(i)[0] += F * dirV[0]; map.get(i)[1] += F * dirV[1]; }
      }
      out.seismic = { cs: cs, T: csInfo.T, V: V / 1000, W: W / 1000 };
    }
    const aw = m.autoWind;
    if (aw && aw.enabled !== false && aw.v > 0) {
      const dirV = DIRS[aw.dir || '+x'] || DIRS['+x'];
      const kd = aw.kd != null ? aw.kd : 0.85;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, zMax = 0;
      for (const n of mesh.nodes) {
        x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x);
        y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
        zMax = Math.max(zMax, n.z);
      }
      const width = Math.max(Math.abs(dirV[0]) > 0 ? (y1 - y0) : (x1 - x0), 1);
      const pid = aw.pattern || 'WINDX';
      if (!loads[pid]) { loads[pid] = new Map(); memberLoads[pid] = new Array(mesh.frames.length).fill(null); }
      const map = loads[pid];
      const bands = [];
      const lvls = m.stories.map(s => s.elevation).sort((a, b) => a - b);
      for (let i = 0; i + 1 < lvls.length; i++) bands.push({ z0: lvls[i], z1: lvls[i + 1] });
      if (!bands.length) bands.push({ z0: 0, z1: zMax || 1 });
      const nodeBand = new Int32Array(mesh.nodes.length).fill(-1);
      const cnt = bands.map(() => 0);
      for (let i = 0; i < mesh.nodes.length; i++) {
        const z = mesh.nodes[i].z;
        for (let b2 = 0; b2 < bands.length; b2++)
          if (z >= bands[b2].z0 - 1e-6 && z < bands[b2].z1 + 1e-6) { nodeBand[i] = b2; cnt[b2]++; break; }
      }
      let totalF = 0;
      const e = EXPOSURES[aw.exposure || 'C'];
      for (let i = 0; i < mesh.nodes.length; i++) {
        const b2 = nodeBand[i];
        if (b2 < 0 || !cnt[b2]) continue;
        const h = Math.max(bands[b2].z1 - bands[b2].z0, 0.1);
        const zc = (bands[b2].z0 + bands[b2].z1) / 2;
        const zz = Math.max(zc, e.zmin);
        const kz = 2.01 * Math.pow(zz / e.zg, 2 / e.alpha);
        const qz = 0.613 * kz * kd * aw.v * aw.v;
        const F = qz * width * h / cnt[b2];
        if (!map.has(i)) map.set(i, [0, 0, 0, 0, 0, 0]);
        map.get(i)[0] += F * dirV[0]; map.get(i)[1] += F * dirV[1];
        totalF += F;
      }
      out.wind = { V: aw.v, exposure: aw.exposure || 'C', baseShear_kN: totalF / 1000 };
    }
  }

  function seismicCs(as, buildingHeight) {
    if (as.cs != null && as.mode === 'cs') return { cs: as.cs, T: as.T || 0 };
    const RIe = (as.R || 8) / (as.Ie || 1);
    let T = as.T;
    if (!(T > 0)) {
      const ct = as.system === 'steelMomentFrame' ? 0.0724 : as.system === 'eccentricBraced' ? 0.0731 : as.system === 'steelMomentFrame' ? 0.0724 : 0.0466;
      const x = as.system === 'steelMomentFrame' ? 0.8 : 0.9;
      T = 0.0466 * Math.pow(Math.max(buildingHeight, 1), 0.9);
      if (as.system === 'steelMomentFrame') T = 0.0724 * Math.pow(Math.max(buildingHeight, 1), 0.8);
    }
    const sds = as.sds != null ? as.sds : 1.0;
    const sd1 = as.sd1 != null ? as.sd1 : 0.6;
    let cs = sds / RIe;
    const tl = as.tl || 4;
    if (T <= tl) cs = Math.min(cs, sd1 / (T * RIe));
    else cs = Math.min(cs, sd1 * tl / (T * T * RIe));
    cs = Math.max(cs, 0.044 * sds * (as.Ie || 1), 0.01);
    return { cs, T };
  }

  // ACI 318-19 §5.3.1 (+ ASCE 7 §12.4.2 when seismic present)
  function buildCombinations(patterns, as) {
    const g = t => patterns.filter(p => p.type === t).map(p => p.id);
    const D = g('dead'), L = g('live'), W = g('wind'), Q = g('quake');
    const mk = name => ({ name, factors: {} });
    const combos = [];
    const c1 = mk('1.4D'); for (const id of D) c1.factors[id] = 1.4; combos.push(c1);
    const c2 = mk('1.2D+1.6L+0.5S'); for (const id of D) c2.factors[id] = 1.2; for (const id of L) c2.factors[id] = 1.6; combos.push(c2);
    const c3 = mk('1.2D+1.0W+1.0L'); for (const id of D) c3.factors[id] = 1.2; for (const id of W) c3.factors[id] = 1.0; for (const id of L) c3.factors[id] = 1.0; combos.push(c3);
    const c4 = mk('0.9D+1.0W'); for (const id of D) c4.factors[id] = 0.9; for (const id of W) c4.factors[id] = 1.0; combos.push(c4);
    if (Q.length) {
      const sds = as && as.sds != null ? as.sds : 0.2;
      const rho = as && as.rho > 0 ? as.rho : 1.0;
      const c5 = mk('Ev+Eh+D+L'); for (const id of D) c5.factors[id] = 1.2 + 0.2 * sds; for (const id of Q) c5.factors[id] = rho; for (const id of L) c5.factors[id] = 0.5; combos.push(c5);
      const c6 = mk('0.9D-Ev+Eh'); for (const id of D) c6.factors[id] = 0.9 - 0.2 * sds; for (const id of Q) c6.factors[id] = rho; combos.push(c6);
    }
    return combos;
  }

  // ================================================== run
  function runAnalysis(m, opts) {
    opts = opts || {};
    const FEA = window.FEA;
    const mesh = buildMesh(m);
    if (!mesh.frames.length) return { error: 'Draw columns and beams first' };
    const ls = buildLoads(m, mesh, opts);
    const _as = m.autoSeismic;
    const patList = (_as && _as.enabled !== false && !m.patterns.some(pp => pp.type === 'quake'))
      ? m.patterns.concat([{ id: 'EQX', name: 'Seismic', type: 'quake' }]) : m.patterns;
    const combos = buildCombinations(patList, _as);
    const results = [];
    for (const combo of combos) {
      const merged = new Map();
      const ml = new Array(mesh.frames.length).fill(null);
      let any = false;
      for (const [pat, factor] of Object.entries(combo.factors)) {
        const lv = ls.loads[pat];
        if (!lv) continue;
        for (const [ni, vals] of lv) {
          if (!merged.has(ni)) merged.set(ni, [0, 0, 0, 0, 0, 0]);
          for (let i = 0; i < 6; i++) merged.get(ni)[i] += factor * vals[i];
          any = true;
        }
        const mls = ls.memberLoads[pat];
        if (mls) mls.forEach((mm, i) => {
          if (!mm) return;
          const cur = ml[i] || { wy: 0, wz: 0 };
          cur.wy += factor * (mm.wy || 0); cur.wz += factor * (mm.wz || 0);
          ml[i] = cur; any = true;
        });
      }
      if (!any) continue;
      const mlArg = ml.some(x => x) ? ml : null;
      let sol = FEA.assembleAndSolve(mesh.nodes, mesh.frames, [], [merged], { memberLoads: mlArg });
      let geo = null;
      if (opts.pDelta) {
        const fIdx = new Map(mesh.frames.map((f, i) => [f, i]));
        for (let it = 0; it < 6; it++) {
          geo = new Array(mesh.frames.length).fill(null);
          for (const fe of sol.frames) geo[fIdx.get(fe.el)] = -fe.forces[0];
          const next = FEA.assembleAndSolve(mesh.nodes, mesh.frames, [], [merged], { geo, memberLoads: mlArg });
          let dMax = 0, uMax = 1e-12;
          for (let i = 0; i < mesh.nodes.length * 6; i++) {
            dMax = Math.max(dMax, Math.abs((next.U[0][i] || 0) - (sol.U[0][i] || 0)));
            uMax = Math.max(uMax, Math.abs(next.U[0][i] || 0));
          }
          sol = next;
          if (dMax < 1e-6 * Math.max(uMax, 1e-9)) break;
        }
      }
      const reactions = FEA.computeReactions(mesh.nodes, mesh.frames, [], [merged], sol.U, { geo, memberLoads: mlArg });
      results.push({ combo: combo.name, U: sol.U[0], frames: sol.frames, reactions });
    }
    // envelope per frame
    const envelope = mesh.frames.map((fr, i) => {
      let maxM = 0, maxV = 0, maxN = 0, gov = null;
      for (const res of results) {
        const fe = res.frames.find(f2 => f2.el === fr);
        if (!fe) continue;
        let M = Math.max(Math.abs(fe.forces[4]), Math.abs(fe.forces[5]), Math.abs(fe.forces[10]), Math.abs(fe.forces[11]));
        // span loads superpose their parabolic hump between the end values
        if (fe.wl) {
          const a = mesh.nodes[fr.ni], b = mesh.nodes[fr.nj];
          const Lmm = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 1000;
          for (const w2 of [fe.wl.wy || 0, fe.wl.wz || 0]) {
            if (!w2) continue;
            let best = 0;
            for (let st = 1; st < 8; st++) {
              const t = st / 8;
              best = Math.max(best, Math.abs(w2 * t * (1 - t) * Lmm * Lmm / 2));
            }
            M = Math.max(M, best);
          }
        }
        const V = Math.max(Math.abs(fe.forces[1]), Math.abs(fe.forces[2]));
        const N = Math.abs(fe.forces[0]);
        if (M > maxM) { maxM = M; gov = res.combo; }
        maxV = Math.max(maxV, V); maxN = Math.max(maxN, N);
      }
      return { frameId: fr.frameId, kind: fr.kind, maxM, maxV, maxN, gov };
    });
    // story drift ratios
    const storyDrift = [];
    if (m.stories.length >= 2) {
      const sorted = m.stories.map(s => ({ z: s.elevation, name: s.name })).sort((a, b) => a.z - b.z);
      for (let li = 1; li < sorted.length; li++) {
        const zLow = sorted[li - 1].z, zHigh = sorted[li].z, h = zHigh - zLow;
        if (!(h > 1e-6)) continue;
        let dLow = 0, dHigh = 0;
        for (const res of results) for (let i = 0; i < mesh.nodes.length; i++) {
          const z = mesh.nodes[i].z;
          const d = Math.hypot(res.U[i * 6] || 0, res.U[i * 6 + 1] || 0);
          if (Math.abs(z - zLow) < 0.05) dLow = Math.max(dLow, d);
          if (Math.abs(z - zHigh) < 0.05) dHigh = Math.max(dHigh, d);
        }
        storyDrift.push({ story: sorted[li].name, ratio: (dHigh - dLow) / 1000 / h });
      }
    }
    const out = {
      mesh, results, envelope, storyDrift, auto: ls.auto,
      combos: combos.map(c => c.name),
      maxDrift: Math.max(0, ...storyDrift.map(d => d.ratio)),
    };
    m.results = out;
    return out;
  }

  function runModal(m, opts) {
    opts = opts || {};
    const FEA = window.FEA;
    const mesh = buildMesh(m);
    if (!mesh.frames.length) return { error: 'Draw columns and beams first' };
    // mass source: additional joint masses (self-weight is built in)
    const ms = m.massSource || DEFAULT_MASS_SOURCE();
    const extra = new Float64Array(mesh.nodes.length);
    if (ms.additional !== false) for (const jm of m.jointMasses || []) {
      const ni = mesh.index.get(jm.jointId);
      if (ni != null) extra[ni] += jm.m || 0;
    }
    const res = FEA.ritzModalAnalysis(mesh.nodes, mesh.frames, [], opts.nModes || 8, ms.additional === false ? null : extra, opts.dir || 'z');
    m.modal = res;
    return res;
  }

  window.RCModel = {
    CONCRETE, newModel, addColumn, addBeam, jointAt, jointById, frameSection, releaseDofs, DEFAULT_MATERIALS, DEFAULT_MASS_SOURCE,
    buildMesh, buildLoads, buildCombinations, runAnalysis, runModal,
    seismicCs, DEFAULT_SECTIONS, DEFAULT_PATTERNS,
  };
})();
