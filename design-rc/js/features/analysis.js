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
      // ---- beams: horizontal frame elements along their baseline.
      // One element per span: member loads are applied as CONSISTENT
      // equivalent joint loads with fixed-end recovery, so span moments
      // (wL²/8) are exact without interior nodes — subdividing would
      // multiply the system size (real buildings have hundreds of spans).
      if (ent.type === 'beam' && p.baseline) {
        const bl = p.baseline;
        const h = p.height || 0.4, bw = p.webWidth || 0.25;
        const A = bw * h * 1e6;
        const Iz = bw * h * h * h / 12 * 1e12;
        const Iy = h * bw * bw * bw / 12 * 1e12;
        const J = 0.1 * (bw + h) ** 3 * (1 / 3) * 1e12;
        for (let i = 0; i + 1 < bl.length; i++) {
          const A2 = bl[i], B2 = bl[i + 1];
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
            shells.push({ n1, n2: n3, n3: n4, E: CONCRETE.Ec, nu: CONCRETE.nu, t: t * 1000, kind: 'wall' });
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
    // supports: any node at the lowest elevation with columns under it →
    // fixed, unless the column's base was assigned a PINNED restraint
    // (params.baseFix — ETABS joint restraints)
    const zMin = nodes.length ? Math.min(...nodes.map(n => n.z)) : 0;
    for (const n of nodes) {
      if (Math.abs(n.z - zMin) < 0.05) n.fixed = [1, 1, 1, 1, 1, 1];
    }
    for (const el of frames) {
      if (el.kind !== 'column') continue;
      const ent = bim.getEntityById(el.entityId);
      if (ent && ent.params && ent.params.baseFix === 'pinned') {
        const a = nodes[el.ni], b = nodes[el.nj];
        (Math.abs(a.z - zMin) < Math.abs(b.z - zMin) ? a : b).fixed = [1, 1, 1, 0, 0, 0];
      }
    }
    return { nodes, frames, shells, meta };
  }

  // ============================================================ load patterns
  // ETABS-style: named patterns (Dead/Live/Wind/...), each with a self-weight
  // multiplier and optional default area pressures; loads are ASSIGNED to
  // elements (ent.params.loads) per pattern and combined automatically per
  // ACI 318-19. Patterns live on the model so they persist with saves.
  const DEFAULT_PATTERNS = () => ([
    { id: 'DL', name: 'Dead', type: 'dead', swMult: 1, slab: 0, wall: 0 },
    { id: 'SDL', name: 'SuperImposed Dead', type: 'dead', swMult: 0, slab: 1.5, wall: 0 },
    { id: 'LL', name: 'Live', type: 'live', swMult: 0, slab: 2, wall: 0 },
    { id: 'WL', name: 'Wind', type: 'wind', swMult: 0, slab: 0, wall: 1 },
  ]);

  function getPatterns(app) {
    if (!app.model.loadPatterns) app.model.loadPatterns = DEFAULT_PATTERNS();
    return app.model.loadPatterns;
  }

  // direction name → unit vector in GLOBAL axes (model frame, Z up)
  const DIRS = {
    gravity: [0, 0, -1], '-z': [0, 0, -1], '+z': [0, 0, 1],
    '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0],
  };

  // Build every pattern's load state:
  //   loads: { patternId: Map nodeIdx → [fx..mz] in N }
  //   memberLoads: { patternId: array aligned with mesh.frames of null|{wy,wz} }
  //     (uniform frame loads in LOCAL element coords, N/mm)
  // Explicit per-entity assignments (ent.params.loads) override the pattern's
  // default area pressures; entities without an assignment get the default.
  function buildLoads(app, mesh, opts = {}) {
    const patterns = getPatterns(app).map(p => ({ ...p }));
    // quick-run overrides from the Analyze dialog keep the old one-click flow
    const byId = Object.fromEntries(patterns.map(p => [p.id, p]));
    if (opts.liveLoad != null && byId.LL) byId.LL.slab = opts.liveLoad;
    if (opts.superDead != null && byId.SDL) byId.SDL.slab = opts.superDead;
    if (opts.wind != null && byId.WL) byId.WL.wall = opts.wind;

    const loads = {}, memberLoads = {};
    for (const p of patterns) { loads[p.id] = new Map(); memberLoads[p.id] = new Array(mesh.frames.length).fill(null); }
    const add = (pid, ni, vals) => {
      const map = loads[pid];
      if (!map) return;
      if (!map.has(ni)) map.set(ni, [0, 0, 0, 0, 0, 0]);
      for (let i = 0; i < 6; i++) map.get(ni)[i] += vals[i] || 0;
    };

    // --- self-weight, scaled by the pattern's SW mult. Horizontal members
    // (beams/braces) ride the CONSISTENT member-load path so their span
    // moments are exact; vertical members stay nodal (pure axial path).
    const FEAmod = window.FEA;
    for (const p of patterns) {
      if (!p.swMult) continue;
      mesh.frames.forEach((fr, idx) => {
        const a = mesh.nodes[fr.ni], b = mesh.nodes[fr.nj];
        const L = window.G.dist(a, b); // m
        const w = (fr.A / 1e6) * CONCRETE.density * p.swMult; // kN/m
        if (fr.kind === 'beam' || fr.kind === 'brace') {
          const R = FEAmod.rotationMatrix(a, b);
          const wy = -w * R[1][2]; // gravity (0,0,-w) onto local y
          const wz = -w * R[2][2]; // ...and local z
          const cur = memberLoads[p.id][idx] || { wy: 0, wz: 0 };
          cur.wy += wy; cur.wz += wz;
          memberLoads[p.id][idx] = cur;
        } else {
          const fz = -w * L / 2 * 1000; // N (down), nodal
          add(p.id, fr.ni, [0, 0, fz]);
          add(p.id, fr.nj, [0, 0, fz]);
        }
      });
      for (const sh of mesh.shells) {
        const area = shellArea(mesh, sh);
        const w = (sh.t / 1000) * CONCRETE.density * p.swMult;
        const fz = -w * area / 3 * 1000;
        add(p.id, sh.n1, [0, 0, fz]);
        add(p.id, sh.n2, [0, 0, fz]);
        add(p.id, sh.n3, [0, 0, fz]);
      }
    }

    // --- entity assignments + default area pressures
    const assigned = new Set(); // `patternId:entityId` pairs
    for (const ent of app.bim.entities) {
      const list = ent.params && ent.params.loads;
      if (!Array.isArray(list)) continue;
      for (const a of list) {
        if (!loads[a.pattern]) continue;
        assigned.add(a.pattern + ':' + ent.id);
        if (a.kind === 'udl') applyFrameUDL(mesh, memberLoads[a.pattern], ent, a);
        else if (a.kind === 'pressure') applyShellPressure(mesh, add, a, ent);
      }
    }
    // pattern defaults fill only unassigned entities
    for (const p of patterns) {
      if (!(p.slab > 0) && !(p.wall > 0)) continue;
      for (const ent of app.bim.entities) {
        if (assigned.has(p.id + ':' + ent.id)) continue;
        const isSlab = ['floor', 'slab'].includes(ent.type);
        const isWall = ent.type === 'wall' || ent.type === 'shearwall';
        if (isSlab && p.slab > 0) applyShellPressure(mesh, add, { pattern: p.id, q: p.slab, dir: 'gravity' }, ent);
        if (isWall && p.wall > 0) applyShellPressure(mesh, add, { pattern: p.id, q: p.wall, dir: '+x' }, ent);
      }
    }
    const auto = applyAutoLateral(app, mesh, { patterns, loads, memberLoads }, opts);
    return { patterns, loads, memberLoads, auto };
  }

  function shellArea(mesh, sh) {
    const G = window.G;
    const p1 = mesh.nodes[sh.n1], p2 = mesh.nodes[sh.n2], p3 = mesh.nodes[sh.n3];
    return G.len(G.cross(G.sub(p2, p1), G.sub(p3, p1))) / 2; // m²
  }

  // uniform frame load (kN/m) in a global direction → local wy/wz per element
  function applyFrameUDL(mesh, mlArray, ent, a) {
    const FEA = window.FEA;
    const dir = DIRS[a.dir || 'gravity'] || DIRS.gravity;
    const w = a.w; // kN/m == N/mm
    mesh.frames.forEach((fr, idx) => {
      if (fr.entityId !== ent.id) return;
      const R = FEA.rotationMatrix(mesh.nodes[fr.ni], mesh.nodes[fr.nj]);
      const wy = (dir[0] * R[1][0] + dir[1] * R[1][1] + dir[2] * R[1][2]) * w;
      const wz = (dir[0] * R[2][0] + dir[1] * R[2][1] + dir[2] * R[2][2]) * w;
      const cur = mlArray[idx] || { wy: 0, wz: 0 };
      cur.wy += wy; cur.wz += wz;
      mlArray[idx] = cur;
    });
  }

  // uniform pressure (kPa) in a global direction → consistent nodal loads
  function applyShellPressure(mesh, add, a, ent) {
    const dir = DIRS[a.dir || 'gravity'] || DIRS.gravity;
    const q = a.q * 1000; // N/m²
    for (const sh of mesh.shells) {
      if (sh.entityId !== ent.id) continue;
      const area = shellArea(mesh, sh);
      const f = [q * area / 3 * dir[0], q * area / 3 * dir[1], q * area / 3 * dir[2]];
      add(a.pattern, sh.n1, f);
      add(a.pattern, sh.n2, f);
      add(a.pattern, sh.n3, f);
    }
  }

  // ============================================ auto lateral loads (ETABS parity)
  // Seismic: ASCE 7-16 §12.8 equivalent lateral force — V = Cs·W with the
  // §12.8.3 vertical distribution Cvx = wx·hx²/Σ(wx·hx²); Cs per §12.8.2
  // (user coefficient or SDS/SD1/R/Ie/T with the Ta = Ct·hn^x approximation,
  // §12.8.2.1 / Table 12.8-2). Wind: ASCE 7-16 §26/27 velocity pressure
  // qz = 0.613·Kz·Kd·V² (SI) with the exposure power-law Kz of §26.10.1,
  // distributed to the stories as tributary-area nodal forces.
  // Settings live on model.autoSeismic / model.autoWind (saved with the model).
  const EXPOSURES = { // ASCE 7-16 Table 26.10-1 (SI: zg metres)
    B: { alpha: 7.0, zg: 365.76, zmin: 9.14 },
    C: { alpha: 9.5, zg: 274.32, zmin: 9.14 },
    D: { alpha: 11.5, zg: 213.36, zmin: 4.57 },
  };
  const CT_SYSTEMS = { // ASCE 7-16 Table 12.8-2 (SI coefficients, hn in m)
    'rcMomentFrame': { ct: 0.0466, x: 0.9 },
    'steelMomentFrame': { ct: 0.0724, x: 0.8 },
    'eccentricBraced': { ct: 0.0731, x: 0.75 },
    'allOther': { ct: 0.0488, x: 0.75 },
  };

  function kz(z, exposure) {
    const e = EXPOSURES[exposure] || EXPOSURES.C;
    const zz = Math.max(z, e.zmin);
    return 2.01 * Math.pow(zz / e.zg, 2 / e.alpha);
  }

  // Seismic response coefficient per ASCE 7-16 §12.8.2 from the model params
  function seismicCs(as, buildingHeight) {
    if (as == null) return { cs: 0, T: 0, note: 'no seismic input' };
    if (as.cs != null) return { cs: as.cs, T: as.T || 0, note: 'user Cs' };
    const RIe = (as.R || 8) / (as.Ie || 1);
    // period: user T, else the approximate Ta = Ct·hn^x
    let T = as.T;
    let note = '';
    if (!(T > 0)) {
      const sys = CT_SYSTEMS[as.system] || CT_SYSTEMS.allOther;
      T = sys.ct * Math.pow(Math.max(buildingHeight, 1), sys.x);
      note = 'Ta = Ct·hn^x';
    }
    const sds = as.sds != null ? as.sds : 0.2;
    const sd1 = as.sd1 != null ? as.sd1 : 0.1;
    let cs = sds / RIe;                                   // §12.8-2
    const tl = as.tl || 4.0;
    if (T <= tl) cs = Math.min(cs, sd1 / (T * RIe));      // §12.8-3
    else cs = Math.min(cs, sd1 * tl / (T * T * RIe));     // §12.8-4
    cs = Math.max(cs, 0.044 * sds * (as.Ie || 1), 0.01);  // §12.8-5/6
    return { cs, T, note };
  }

  // Apply the auto lateral loads to the pattern maps. Seismic weight W and
  // the mass source agree: self-weight + SDL (+ live fraction), all in N.
  function applyAutoLateral(app, mesh, loadState, opts) {
    const m = app.model;
    const G = window.G;
    const out = { seismic: null, wind: null };

    // ---- seismic (ASCE 7-16 §12.8)
    const as = m.autoSeismic;
    if (as && as.enabled !== false) {
      let zMax = 0;
      for (const n of mesh.nodes) zMax = Math.max(zMax, n.z);
      const { cs, T, note } = seismicCs(as, zMax);
      // seismic weight per node from the pattern load maps (N)
      const w = new Float64Array(mesh.nodes.length);
      const countW = (pid, frac) => {
        const lv = loadState.loads[pid];
        if (lv) for (const [ni, vals] of lv) w[ni] += (frac || 1) * Math.abs(vals[2] || 0);
        // beam self-weight rides the consistent member-load path: add its
        // gravity equivalent back into the nodal seismic weight
        const ml = loadState.memberLoads[pid];
        if (ml) mesh.frames.forEach((fr, fi) => {
          const m = ml[fi];
          if (!m) return;
          const R = window.FEA.rotationMatrix(mesh.nodes[fr.ni], mesh.nodes[fr.nj]);
          const vz = Math.abs((m.wy || 0) * R[1][2] + (m.wz || 0) * R[2][2]); // N/mm vertical
          if (!vz) return;
          const L = window.G.dist(mesh.nodes[fr.ni], mesh.nodes[fr.nj]);
          const fz = (frac || 1) * vz * L * 1000 / 2; // N per end node
          w[fr.ni] += fz; w[fr.nj] += fz;
        });
      };
      for (const pat of loadState.patterns) {
        if (pat.type === 'dead') countW(pat.id, 1);
        if (pat.type === 'live') countW(pat.id, as.liveFraction != null ? as.liveFraction : 0);
      }
      let W = 0;
      for (let i = 0; i < w.length; i++) W += w[i];
      // §12.8.3: Cvx = wx·hx²/Σ(wx·hx²) — node-level distribution
      const dirV = DIRS[as.dir || '+x'] || DIRS['+x'];
      const pid = as.pattern || 'EQ';
      if (!loadState.loads[pid]) { loadState.loads[pid] = new Map(); loadState.memberLoads[pid] = new Array(mesh.frames.length).fill(null); loadState.patterns.push({ id: pid, name: 'Seismic', type: 'quake' }); }
      const map = loadState.loads[pid];
      const addF = (ni, f) => {
        if (!map.has(ni)) map.set(ni, [0, 0, 0, 0, 0, 0]);
        map.get(ni)[0] += f * dirV[0]; map.get(ni)[1] += f * dirV[1];
      };
      let sumCx = 0;
      const cv = new Float64Array(mesh.nodes.length);
      for (let i = 0; i < mesh.nodes.length; i++) {
        cv[i] = w[i] * Math.pow(Math.max(mesh.nodes[i].z, 0), 2);
        sumCx += cv[i];
      }
      const V = cs * W;
      if (sumCx > 0) for (let i = 0; i < mesh.nodes.length; i++) {
        const F = V * cv[i] / sumCx;
        if (F) addF(i, F);
      }
      out.seismic = { cs, T, V: V / 1000, W: W / 1000, note, pattern: pid };
    }

    // ---- wind (ASCE 7-16 §26.10.1/§27.3): qz by node elevation,
    // tributary area from the mesh bounding box and story heights
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
      // face width ⊥ wind; planar models (extent ≈ 0) get a 1 m tributary strip
      const width = Math.max(Math.abs(dirV[0]) > 0 ? (y1 - y0) : (x1 - x0), 1);

      const pid = aw.pattern || 'WL';
      if (!loadState.loads[pid]) { loadState.loads[pid] = new Map(); loadState.memberLoads[pid] = new Array(mesh.frames.length).fill(null); }
      const map = loadState.loads[pid];
      // story heights from level elevations (fallback: single band)
      const lvls = (app.model.levels || []).map(l => l.elevation || 0).sort((a, b) => a - b);
      const bands = [];
      for (let i = 0; i + 1 < lvls.length; i++) bands.push({ z0: lvls[i], z1: lvls[i + 1] });
      if (!bands.length) bands.push({ z0: 0, z1: zMax || 1 });
      const nodeBand = new Int32Array(mesh.nodes.length).fill(-1);
      const bandCount = bands.map(() => 0);
      for (let i = 0; i < mesh.nodes.length; i++) {
        const z = mesh.nodes[i].z;
        for (let b = 0; b < bands.length; b++)
          if (z >= bands[b].z0 - 1e-6 && z < bands[b].z1 + 1e-6) { nodeBand[i] = b; bandCount[b]++; break; }
      }
      let totalF = 0;
      for (let i = 0; i < mesh.nodes.length; i++) {
        const b = nodeBand[i];
        if (b < 0 || !bandCount[b]) continue;
        const h = Math.max(bands[b].z1 - bands[b].z0, 0.1);
        const zc = (bands[b].z0 + bands[b].z1) / 2;
        const qz = 0.613 * kz(zc, aw.exposure || 'C') * kd * aw.v * aw.v; // N/m²
        const F = qz * width * h / bandCount[b]; // N per node
        if (!map.has(i)) map.set(i, [0, 0, 0, 0, 0, 0]);
        map.get(i)[0] += F * dirV[0]; map.get(i)[1] += F * dirV[1];
        totalF += F;
      }
      out.wind = { V: aw.v, exposure: aw.exposure || 'C', baseShear_kN: totalF / 1000, pattern: pid };
    }
    return out;
  }

  // ACI 318-19 §5.3.1 strength combinations built from the pattern TYPES:
  // D = dead patterns (incl. self-weight), L = live, W = wind, S = snow/roof.
  function buildCombinations(patterns, sdsIn) {
    const g = t => patterns.filter(p => p.type === t).map(p => p.id);
    const D = g('dead'), L = g('live'), W = g('wind'), S = g('snow'), Lr = g('roof');
    const Sr = S.length ? S : Lr;
    const mk = name => ({ name, factors: {} });
    const c1 = mk('1.4D'); for (const id of D) c1.factors[id] = 1.4;
    const c2 = mk('1.2D+1.6L+0.5S'); for (const id of D) c2.factors[id] = 1.2; for (const id of L) c2.factors[id] = 1.6; for (const id of Sr) c2.factors[id] = 0.5;
    const c3 = mk('1.2D+1.6S+0.5L'); for (const id of D) c3.factors[id] = 1.2; for (const id of Sr) c3.factors[id] = 1.6; for (const id of L) c3.factors[id] = 0.5;
    const c4 = mk('1.2D+1.0W+1.0L'); for (const id of D) c4.factors[id] = 1.2; for (const id of W) c4.factors[id] = 1.0; for (const id of L) c4.factors[id] = 1.0;
    const c5 = mk('0.9D+1.0W'); for (const id of D) c5.factors[id] = 0.9; for (const id of W) c5.factors[id] = 1.0;
    const combos = [c1, c2, c3, c4, c5];
    // ASCE 7-16 §12.4.2 strength combos with seismic (Ev = 0.2·SDS·D folded
    // into the dead factor; rho = 1.0, overstrength not applied)
    if (patterns.some(pp => pp.type === 'quake')) {
      const Q = patterns.filter(pp => pp.type === 'quake').map(pp => pp.id);
      const sds = sdsIn != null ? sdsIn : 0.2;
      const c6 = mk('Ev+Eh+D+L'); for (const id of D) c6.factors[id] = 1.2 + 0.2 * sds; for (const id of Q) c6.factors[id] = 1.0; for (const id of L) c6.factors[id] = 0.5;
      const c7 = mk('0.9D-Ev+Eh'); for (const id of D) c7.factors[id] = 0.9 - 0.2 * sds; for (const id of Q) c7.factors[id] = 1.0;
      combos.push(c6, c7);
    }
    return combos;
  }
  const COMBINATIONS = buildCombinations(DEFAULT_PATTERNS());

  // merge a combination: nodal maps + member loads, both scaled by factors
  function combineLoads(mesh, loadState, combo) {
    const merged = new Map();
    const ml = new Array(mesh.frames.length).fill(null);
    for (const [pat, factor] of Object.entries(combo.factors)) {
      const lv = loadState.loads[pat];
      if (!lv) continue;
      for (const [ni, vals] of lv) {
        if (!merged.has(ni)) merged.set(ni, [0, 0, 0, 0, 0, 0]);
        for (let i = 0; i < 6; i++) merged.get(ni)[i] += factor * vals[i];
      }
      const mls = loadState.memberLoads[pat];
      if (mls) mls.forEach((m, i) => {
        if (!m) return;
        const cur = ml[i] || { wy: 0, wz: 0 };
        cur.wy += factor * (m.wy || 0);
        cur.wz += factor * (m.wz || 0);
        ml[i] = cur;
      });
    }
    const anyML = ml.some(m => m);
    return { nodal: merged, memberLoads: anyML ? ml : null };
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
    const loadState = buildLoads(app, mesh, opts);
    const as = app.model.autoSeismic;
    const combos = buildCombinations(loadState.patterns, as && as.sds != null ? as.sds : null);
    const frameIndex = new Map(mesh.frames.map((f, i) => [f, i]));
    const results = [];
    for (const combo of combos) {
      const combined = combineLoads(mesh, loadState, combo);
      if (!combined.nodal.size && !combined.memberLoads) continue;
      let sol = FEA.assembleAndSolve(mesh.nodes, mesh.frames, mesh.shells, [combined.nodal], { memberLoads: combined.memberLoads });
      let geo = null, iterations = 0;
      if (opts.pDelta) {
        // P-delta: iterate the geometric stiffness from the current axial
        // forces (tension+; end force f[0] is compression-positive) until
        // the displacement field stops moving. Converges fast for the
        // P/Pcr ratios of real buildings.
        for (iterations = 1; iterations <= 6; iterations++) {
          geo = new Array(mesh.frames.length).fill(null);
          for (const fe of sol.frames) geo[frameIndex.get(fe.el)] = -fe.forces[0];
          const next = FEA.assembleAndSolve(mesh.nodes, mesh.frames, mesh.shells, [combined.nodal], { geo, memberLoads: combined.memberLoads });
          let dMax = 0, uMax = 1e-12;
          for (let i = 0; i < mesh.nodes.length * 6; i++) {
            const du = Math.abs((next.U[0][i] || 0) - (sol.U[0][i] || 0));
            dMax = Math.max(dMax, du);
            uMax = Math.max(uMax, Math.abs(next.U[0][i] || 0));
          }
          sol = next;
          if (dMax < 1e-6 * Math.max(uMax, 1e-9) || dMax < 1e-9) break;
        }
      }
      const reactions = FEA.computeReactions(mesh.nodes, mesh.frames, mesh.shells, [combined.nodal], sol.U, { geo, memberLoads: combined.memberLoads });
      results.push({ combo: combo.name, U: sol.U[0], frames: sol.frames, reactions, pDeltaIterations: iterations });
    }
    // envelope per frame element
    const envelope = mesh.frames.map((fr, i) => {
      let maxM = 0, maxV = 0, maxN = 0, gov = null;
      for (const res of results) {
        const fe = res.frames.find(f2 => f2.el === fr);
        if (!fe) continue;
        // local: [fx1, fy1, fz1, mx1, my1, mz1, fx2, ...]
        const axial = Math.abs(fe.forces[0]);
        // span loads superpose their parabolic hump between the end values —
        // end moments alone would miss the wL²/8 midspan of a UDL
        let Mz1 = Math.abs(fe.forces[5]); // bending about local z
        let My1 = Math.abs(fe.forces[4]);
        if (fe.wl) {
          const a = mesh.nodes[fe.el.ni], b = mesh.nodes[fe.el.nj];
          const Lmm = window.G.dist(a, b) * 1000;
          const hump = (wy, wz) => {
            let best = 0;
            for (let st = 1; st < 8; st++) {
              const t = st / 8;
              best = Math.max(best, Math.abs(wy * t * (1 - t) * Lmm * Lmm / 2));
            }
            return best;
          };
          Mz1 = Math.max(Mz1, hump(fe.wl.wy || 0, 0));
          My1 = Math.max(My1, hump(fe.wl.wz || 0, 0));
        }
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
    // per-story drift ratios (mm/mm) vs ASCE 7-16 Table 12.12-1:
    // design story drift = max lateral displacement difference over the
    // story, divided by the story height (Cd not applied — elastic drift)
    const storyDrift = [];
    {
      const lvls = (app.model.levels || []).map(l => ({ z: l.elevation || 0, name: l.name })).sort((a, b) => a.z - b.z);
      if (lvls.length >= 2) {
        for (let li = 1; li < lvls.length; li++) {
          const zLow = lvls[li - 1].z, zHigh = lvls[li].z;
          const h = zHigh - zLow;
          if (!(h > 1e-6)) continue;
          let dLowMax = 0, dHighMax = 0;
          for (const res of results) {
            for (let i = 0; i < mesh.nodes.length; i++) {
              const z = mesh.nodes[i].z;
              const disp = Math.hypot(res.U[i * 6] || 0, res.U[i * 6 + 1] || 0);
              if (Math.abs(z - zLow) < 0.05) dLowMax = Math.max(dLowMax, disp);
              if (Math.abs(z - zHigh) < 0.05) dHighMax = Math.max(dHighMax, disp);
            }
          }
          const ratio = (dHighMax - dLowMax) / 1000 / h; // mm → m over m
          storyDrift.push({ story: lvls[li].name || ('+' + zHigh.toFixed(1)), ratio, deltaMm: (dHighMax - dLowMax) });
        }
      }
    }
    const maxDriftRatio = storyDrift.length ? Math.max(...storyDrift.map(d => d.ratio)) : 0;
    return { mesh, loadState, results, envelope, maxDrift, maxNode, storyDrift, maxDriftRatio, auto: loadState.auto, combos: combos.map(c => c.name), patterns: loadState.patterns };
  }

  // Design every beam and column in the model against the envelope
  function runDesign(app, analysis) {
    const RC = window.RCDesign;
    if (!analysis || analysis.error) return { error: 'Run the analysis first' };
    const designs = [];
    const bim = app.bim;
    // design preferences (ETABS Design > Preferences); per-element rebar wins
    const pr = (app.model && app.model.designPrefs) || { fc: 30, fy: 420, cover: 40, barTop: 16, barBot: 20, colBar: 20, colPerFace: 2 };
    const Ab = d => Math.PI * d * d / 4; // one bar area from a Ø
    for (const env of analysis.envelope) {
      if (!env.entityId) continue;
      const ent = bim.getEntityById(env.entityId);
      if (!ent) continue;
      const p = ent.params || {};
      if (env.kind === 'column') {
        const b = (p.width || 0.3) * 1000, h = (p.depth || p.width || 0.3) * 1000;
        // from MNL-66 rebar if present, else the preference bars per face
        const bars = p.rebar ? p.rebar.bars : RC.defaultBars(b, h, pr.colPerFace || 2, pr.colBar || 20);
        const sec = { b, h, fc: pr.fc, fy: pr.fy, cover: pr.cover, bars };
        const check = RC.checkColumn(sec, env.maxN / 1000, env.maxM / 1e6);
        designs.push({ entityId: env.entityId, type: 'column', label: ent.id + (p.section ? ' [' + p.section + ']' : ''), env, check });
      } else if (env.kind === 'beam') {
        const bw = (p.webWidth || 0.25) * 1000, h = (p.height || 0.4) * 1000;
        const AsBot = p.rebar ? p.rebar.AsBot : 2 * Ab(pr.barBot || 20);
        const AsTop = p.rebar ? p.rebar.AsTop : 2 * Ab(pr.barTop || 16);
        const sec = { b: bw, h, cover: pr.cover, fc: pr.fc, fy: pr.fy,
          top: { As: AsTop }, bot: { As: AsBot }, stirrups: { Av: 101, s: 200 } };
        const check = RC.designBeam(sec, env.maxM / 1e6, env.maxV / 1000);
        // required steel (CSI Concrete Design Manual reporting sequence)
        const req = RC.beamRequiredAs(pr.fc, pr.fy, bw, h, env.maxM / 1e6, pr.cover);
        const abar = Math.PI * (pr.barBot || 20) * (pr.barBot || 20) / 4;
        check.required = { As: req.As, nBars: Math.ceil(req.As / abar), barDia: pr.barBot || 20 };
        designs.push({ entityId: env.entityId, type: 'beam', label: ent.id + (p.section ? ' [' + p.section + ']' : ''), env, check });
      }
    }
    const failing = designs.filter(d => !d.check.ok);
    return { designs, failing };
  }

  // Modal analysis: natural frequencies + mode shapes from self-weight
  // mass plus the chosen seismic mass source (superimposed dead on slabs
  // and an optional fraction of live — ASCE 7 §12.7.2 style). Displacements
  // in phi are unitless (mass-normalized), so the display scales them like
  // the deformed shape.
  function runModal(app, nModes = 6, opts = {}) {
    const FEA = window.FEA;
    const G = window.G;
    const mesh = extractMesh(app);
    if (!mesh.frames.length && !mesh.shells.length) {
      return { error: 'No structural elements found — draw columns, beams, walls or slabs first' };
    }
    // imposed mass per node (tonnes): SDL + frac·LL on slab triangles,
    // distributed /3 like the load patterns (q in N/m² → t = q·A/g)
    const qSDL = (opts.superDead != null ? opts.superDead : 1.5) * 1000;
    const llFrac = opts.liveFraction != null ? opts.liveFraction : 0;
    const qLL = (opts.liveLoad != null ? opts.liveLoad : 2) * 1000;
    const extra = new Float64Array(mesh.nodes.length);
    let imposedT = 0;
    for (const sh of mesh.shells) {
      if (sh.kind !== 'slab') continue;
      const p1 = mesh.nodes[sh.n1], p2 = mesh.nodes[sh.n2], p3 = mesh.nodes[sh.n3];
      const u = G.sub(p2, p1), v = G.sub(p3, p1);
      const area = G.len(G.cross(u, v)) / 2; // m²
      const m = (qSDL + llFrac * qLL) * area / 3 / 9810; // t per node
      extra[sh.n1] += m; extra[sh.n2] += m; extra[sh.n3] += m;
      imposedT += 3 * m;
    }
    const t0 = performance.now();
    // Ritz vectors are the ETABS default (CSI Analysis Reference) — better
    // conditioned and they carry modal participating mass ratios directly
    const method = opts.method === 'eigenvector' ? 'eigenvector' : 'ritz';
    const res = method === 'ritz'
      ? FEA.ritzModalAnalysis(mesh.nodes, mesh.frames, mesh.shells, nModes, extra, opts.dir || 'gravity')
      : FEA.modalAnalysis(mesh.nodes, mesh.frames, mesh.shells, nModes, extra);
    return {
      mesh, modes: res.modes, mechanisms: res.mechanisms || 0, method,
      massSource: 'self-weight' + (imposedT > 0 ? ' + SDL' + (llFrac > 0 ? ' + ' + (llFrac * 100).toFixed(0) + '% LL' : '') : '') +
        (imposedT > 0 ? ' (+' + imposedT.toFixed(1) + ' t imposed)' : ''),
      ms: Math.round(performance.now() - t0),
    };
  }

  window.StructuralAnalysis = { extractMesh, buildLoads, runAnalysis, runDesign, runModal, COMBINATIONS, CONCRETE, getPatterns, DEFAULT_PATTERNS, buildCombinations, DIRS };
})();
