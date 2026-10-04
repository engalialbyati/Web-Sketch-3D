'use strict';
// features/analysis.js — ETABS-style structural analysis for WebSketch 3D.
// Extracts the FEA mesh from the parametric model (columns, beams, walls,
// slabs), applies load patterns + code combinations, solves via js/fea.js,
// and hands the results to the RC design engine (js/rcdesign.js).
//
// Workflow (ETABS parity):
//   1. Model → mesh: columns = vertical frame elements, beams = horizontal
//      frames, walls = shell triangles, slabs = shell triangles
//   2. Load patterns: DL (self-weight), SDL, LL, WL — computed from
//      geometry + materials (concrete density 24 kN/m³)
//   3. Combinations: ACI 318-19 §5.3.1 (1.4D, 1.2D+1.6L+0.5Lr, ...)
//   4. Analysis: linear static (K·u = f), reactions at supports
//   5. Design: beam capacity checks + column interaction
(function () {
  const CONCRETE = { Ec: 25000, density: 24, nu: 0.2 }; // MPa, kN/m³

  // ================================================================ meshing
  // Nodes are keyed by a quantized position so shared joints between
  // columns and beams merge automatically (ETABS joint behavior).
  function extractMesh(app) {
    const bim = app.bim, m = app.model, G = window.G;
    const nodeIndex = new Map();
    const nodes = [];
    const nodeAt = (p) => {
      const k = Math.round(p.x * 100) / 100 + ',' + Math.round(p.y * 100) / 100 + ',' + Math.round(p.z * 100) / 100;
      if (nodeIndex.has(k)) return nodeIndex.get(k);
      const idx = nodes.length;
      nodes.push({ x: p.x, y: p.y, z: p.z, fixed: null });
      nodeIndex.set(k, idx);
      return idx;
    };
    const frames = [];
    const shells = [];
    const meta = { columns: 0, beams: 0, walls: 0, slabs: 0, byEntity: new Map() };

    for (const ent of bim.entities) {
      const p = ent.params || {};
      // ---- columns: vertical frame elements
      if (ent.type === 'column' && p.base) {
        const b = p.width || 0.3, d = p.depth || p.width || 0.3;
        const h = p.height || 3;
        const A = b * d * 1e6;               // mm²
        const Iz = b * d * d * d / 12 * 1e12; // mm⁴ (about the strong axis)
        const Iy = d * b * b * b / 12 * 1e12;
        const J = (b * d) ** 3 * 36 ** -1 * 1 * 1e12 * 0.1; // approximate torsion
        const ni = nodeAt(G.v(p.base[0], p.base[1], p.base[2]));
        const nj = nodeAt(G.v(p.base[0], p.base[1], p.base[2] + h));
        frames.push({ ni, nj, E: CONCRETE.Ec, A, Iy, Iz, J, kind: 'column', entityId: ent.id });
        meta.columns++;
        meta.byEntity.set(ent.id, { kind: 'column', frames: [frames.length - 1] });
      }
      // ---- beams: horizontal frame elements along their baseline
      if (ent.type === 'beam' && p.baseline) {
        const bl = p.baseline;
        for (let i = 0; i + 1 < bl.length; i++) {
          const A2 = bl[i], B2 = bl[i + 1];
          const h = p.height || 0.4, bw = p.webWidth || 0.25;
          const A = bw * h * 1e6;
          const Iz = bw * h * h * h / 12 * 1e12;
          const Iy = h * bw * bw * bw / 12 * 1e12;
          const J = 0.1 * (bw + h) ** 3 * (1 / 3) * 1e12;
          const ni = nodeAt(G.v(A2[0], A2[1], A2[2] || (bl[0][2] || 0)));
          const nj = nodeAt(G.v(B2[0], B2[1], B2[2] || (bl[0][2] || 0)));
          frames.push({ ni, nj, E: CONCRETE.Ec, A, Iy, Iz, J, kind: 'beam', entityId: ent.id });
          meta.beams++;
          const cur = meta.byEntity.get(ent.id) || { kind: 'beam', frames: [] };
          cur.frames.push(frames.length - 1);
          meta.byEntity.set(ent.id, cur);
        }
      }
      // ---- walls: shell elements (vertical quads from the wall band)
      if ((ent.type === 'wall' || ent.type === 'shearwall') && p.base && p.end && !p.closed) {
        const t = p.thickness || 0.2;
        const h = p.height || 3;
        const A2 = p.base, B2 = p.end;
        const nSegs = Math.max(1, Math.ceil(Math.hypot(B2[0] - A2[0], B2[1] - A2[1]) / 1.5));
        const nFloors = Math.max(1, Math.ceil(h / 1.5));
        for (let i = 0; i < nSegs; i++) {
          for (let j = 0; j < nFloors; j++) {
            const t0 = i / nSegs, t1 = (i + 1) / nSegs;
            const z0 = (A2[2] || 0) + h * j / nFloors;
            const z1 = (A2[2] || 0) + h * (j + 1) / nFloors;
            const lerp = (a, b, t) => a + (b - a) * t;
            const p1 = G.v(lerp(A2[0], B2[0], t0), lerp(A2[1], B2[1], t0), z0);
            const p2 = G.v(lerp(A2[0], B2[0], t1), lerp(A2[1], B2[1], t1), z0);
            const p3 = G.v(lerp(A2[0], B2[0], t1), lerp(A2[1], B2[1], t1), z1);
            const p4 = G.v(lerp(A2[0], B2[0], t0), lerp(A2[1], B2[1], t0), z1);
            const n1 = nodeAt(p1), n2 = nodeAt(p2), n3 = nodeAt(p3), n4 = nodeAt(p4);
            shells.push({ n1, n2, n3, E: CONCRETE.Ec, nu: CONCRETE.nu, t: t * 1000, kind: 'wall' });
            shells.push({ n1, n3, n4, E: CONCRETE.Ec, nu: CONCRETE.nu, t: t * 1000, kind: 'wall' });
          }
        }
        meta.walls++;
      }
      // ---- slabs/floors: horizontal shells from the region outline
      if ((ent.type === 'floor' || ent.type === 'slab') && p.regions) {
        const t = p.thickness || 0.15;
        for (const reg of p.regions) {
          const outer = reg.outer;
          if (!outer || outer.length < 3) continue;
          // fan triangulate (convex-ish outlines)
          const idx = outer.map(q => nodeAt(G.v(q[0], q[1], q[2] || 0)));
          for (let i = 1; i + 1 < idx.length; i++) {
            shells.push({ n1: idx[0], n2: idx[i], n3: idx[i + 1],
              E: CONCRETE.Ec, nu: CONCRETE.nu, t: t * 1000, kind: 'slab', entityId: ent.id });
          }
        }
        meta.slabs++;
      }
    }
    // supports: any node at the lowest elevation with columns under it → fixed
    const zMin = nodes.length ? Math.min(...nodes.map(n => n.z)) : 0;
    for (const n of nodes) {
      if (Math.abs(n.z - zMin) < 0.05) n.fixed = [1, 1, 1, 1, 1, 1];
    }
    return { nodes, frames, shells, meta };
  }

  // ============================================================== load cases
  // DL: self-weight of the structural elements (kN → N)
  // LL: area loads on the slabs (tributary → nodal loads)
  // Each load vector is a Map nodeIdx → [fx, fy, fz, mx, my, mz]
  function buildLoads(app, mesh, opts = {}) {
    const G = window.G;
    const m = app.model;
    const loads = { DL: new Map(), SDL: new Map(), LL: new Map(), WL: new Map() };
    const add = (caseName, ni, vals) => {
      const map = loads[caseName];
      if (!map.has(ni)) map.set(ni, [0, 0, 0, 0, 0, 0]);
      for (let i = 0; i < 6; i++) map.get(ni)[i] += vals[i] || 0;
    };
    // --- self-weight DL: element weight distributed to its two nodes
    for (const fr of mesh.frames) {
      const a = mesh.nodes[fr.ni], b = mesh.nodes[fr.nj];
      const L = G.dist(a, b); // m
      const w = (fr.A / 1e6) * CONCRETE.density; // kN/m
      const fz = -w * L / 2 * 1000;               // N (down)
      add('DL', fr.ni, [0, 0, fz]);
      add('DL', fr.nj, [0, 0, fz]);
    }
    for (const sh of mesh.shells) {
      const p1 = mesh.nodes[sh.n1], p2 = mesh.nodes[sh.n2], p3 = mesh.nodes[sh.n3];
      const u = G.sub(p2, p1), v = G.sub(p3, p1);
      const area = G.len(G.cross(u, v)) / 2 / 1e6; // m²
      const w = (sh.t / 1000) * CONCRETE.density;
      const fz = -w * area / 3 * 1000;
      add('DL', sh.n1, [0, 0, fz]);
      add('DL', sh.n2, [0, 0, fz]);
      add('DL', sh.n3, [0, 0, fz]);
    }
    // --- LL: user override or default 2 kPa on slab nodes (tributary-free:
    // apply per slab triangle / 3)
    const qLL = (opts.liveLoad != null ? opts.liveLoad : 2) * 1000; // N/m²
    const qSDL = (opts.superDead != null ? opts.superDead : 1.5) * 1000;
    for (const sh of mesh.shells) {
      if (sh.kind !== 'slab') continue;
      const p1 = mesh.nodes[sh.n1], p2 = mesh.nodes[sh.n2], p3 = mesh.nodes[sh.n3];
      const u = G.sub(p2, p1), v = G.sub(p3, p1);
      const area = G.len(G.cross(u, v)) / 2 / 1e6;
      const fLL = -qLL * area / 3;
      const fSDL = -qSDL * area / 3;
      add('LL', sh.n1, [0, 0, fLL]);
      add('LL', sh.n2, [0, 0, fLL]);
      add('LL', sh.n3, [0, 0, fLL]);
      add('SDL', sh.n1, [0, 0, fSDL]);
      add('SDL', sh.n2, [0, 0, fSDL]);
      add('SDL', sh.n3, [0, 0, fSDL]);
    }
    // --- WL: user override or default 1 kPa on wall-shell nodes (horizontal)
    const qWL = (opts.wind != null ? opts.wind : 1) * 1000;
    for (const sh of mesh.shells) {
      if (sh.kind !== 'wall') continue;
      const p1 = mesh.nodes[sh.n1], p2 = mesh.nodes[sh.n2], p3 = mesh.nodes[sh.n3];
      const u = G.sub(p2, p1), v = G.sub(p3, p1);
      const area = G.len(G.cross(u, v)) / 2 / 1e6;
      const fx = qWL * area / 3;
      add('WL', sh.n1, [fx, 0, 0]);
      add('WL', sh.n2, [fx, 0, 0]);
      add('WL', sh.n3, [fx, 0, 0]);
    }
    return loads;
  }

  // ACI 318-19 §5.3.1 strength combinations
  const COMBINATIONS = [
    { name: '1.4D', factors: { DL: 1.4 } },
    { name: '1.2D+1.6L+0.5S', factors: { DL: 1.2, SDL: 1.2, LL: 1.6 } },
    { name: '1.2D+1.6S+0.5L', factors: { DL: 1.2, SDL: 1.6, LL: 0.5 } },
    { name: '1.2D+1.0W+1.0L', factors: { DL: 1.2, SDL: 1.2, WL: 1.0, LL: 1.0 } },
    { name: '0.9D+1.0W', factors: { DL: 0.9, WL: 1.0 } },
  ];

  function combineLoads(mesh, loads, combo) {
    const merged = new Map();
    for (const [pat, factor] of Object.entries(combo.factors)) {
      const lv = loads[pat];
      if (!lv) continue;
      for (const [ni, vals] of lv) {
        if (!merged.has(ni)) merged.set(ni, [0, 0, 0, 0, 0, 0]);
        for (let i = 0; i < 6; i++) merged.get(ni)[i] += factor * vals[i];
      }
    }
    return merged;
  }

  // ================================================== run + envelope design
  function runAnalysis(app, opts = {}) {
    const G = window.G;
    const FEA = window.FEA;
    const RC = window.RCDesign;
    const mesh = extractMesh(app);
    if (!mesh.frames.length && !mesh.shells.length) {
      return { error: 'No structural elements found — draw columns, beams, walls or slabs first' };
    }
    const loads = buildLoads(app, mesh, opts);
    const results = [];
    for (const combo of COMBINATIONS) {
      const combined = combineLoads(mesh, loads, combo);
      if (!combined.size) continue;
      const sol = FEA.assembleAndSolve(mesh.nodes, mesh.frames, mesh.shells, [combined]);
      const reactions = FEA.computeReactions(mesh.nodes, mesh.frames, mesh.shells, [combined], sol.U);
      results.push({ combo: combo.name, U: sol.U[0], frames: sol.frames, reactions });
    }
    // envelope per frame element
    const envelope = mesh.frames.map((fr, i) => {
      let maxM = 0, maxV = 0, maxN = 0, gov = null;
      for (const res of results) {
        const fe = res.frames.find(f2 => f2.el === fr);
        if (!fe) continue;
        // local: [fx1, fy1, fz1, mx1, my1, mz1, fx2, ...]
        const axial = Math.abs(fe.forces[0]);
        const Mz1 = Math.abs(fe.forces[5]); // bending about local z
        const My1 = Math.abs(fe.forces[4]);
        const M = Math.max(Mz1, My1);
        const Vy = Math.abs(fe.forces[1]);
        const Vz = Math.abs(fe.forces[2]);
        const V = Math.max(Vy, Vz);
        if (M > maxM) { maxM = M; gov = res.combo; }
        maxV = Math.max(maxV, V);
        maxN = Math.max(maxN, axial);
      }
      return { frameIndex: i, kind: fr.kind, entityId: fr.entityId, maxM, maxV, maxN, gov };
    });
    // displacement envelope
    let maxDrift = 0, maxNode = -1;
    for (let i = 0; i < mesh.nodes.length; i++) {
      for (const res of results) {
        const dx = Math.abs(res.U[i * 6] || 0);
        if (dx > maxDrift) { maxDrift = dx; maxNode = i; }
      }
    }
    return { mesh, loads, results, envelope, maxDrift, maxNode, combos: COMBINATIONS.map(c => c.name) };
  }

  // Design every beam and column in the model against the envelope
  function runDesign(app, analysis) {
    const RC = window.RCDesign;
    if (!analysis || analysis.error) return { error: 'Run the analysis first' };
    const designs = [];
    const bim = app.bim;
    for (const env of analysis.envelope) {
      if (!env.entityId) continue;
      const ent = bim.getEntityById(env.entityId);
      if (!ent) continue;
      const p = ent.params || {};
      if (env.kind === 'column') {
        const b = (p.width || 0.3) * 1000, h = (p.depth || p.width || 0.3) * 1000;
        // from MNL-66 rebar if present, else 4Ø16
        const bars = p.rebar ? p.rebar.bars : RC.defaultBars(b, h, 2, 16);
        const sec = { b, h, fc: 30, fy: 420, cover: 40, bars };
        const check = RC.checkColumn(sec, env.maxN / 1000, env.maxM / 1e6);
        designs.push({ entityId: env.entityId, type: 'column', label: ent.id, env, check });
      } else if (env.kind === 'beam') {
        const bw = (p.webWidth || 0.25) * 1000, h = (p.height || 0.4) * 1000;
        const AsBot = p.rebar ? p.rebar.AsBot : 628; // 2Ø20
        const AsTop = p.rebar ? p.rebar.AsTop : 314;
        const sec = { b: bw, h, cover: 40, fc: 30, fy: 420,
          top: { As: AsTop }, bot: { As: AsBot }, stirrups: { Av: 101, s: 200 } };
        const check = RC.designBeam(sec, env.maxM / 1e6, env.maxV / 1000);
        designs.push({ entityId: env.entityId, type: 'beam', label: ent.id, env, check });
      }
    }
    const failing = designs.filter(d => !d.check.ok);
    return { designs, failing };
  }

  window.StructuralAnalysis = { extractMesh, buildLoads, runAnalysis, runDesign, COMBINATIONS, CONCRETE };
})();
