'use strict';
// fea.js — Finite Element Analysis engine (ETABS-style) for WebSketch 3D.
//
// The direct stiffness method: build element stiffness matrices in local
// coordinates, transform to global, assemble the global K, apply boundary
// conditions, solve K·u = f, then recover element end forces.
//
// Element library:
//   - Frame (1D): 6 DOF per node-set (axial + 2 bending planes + torsion),
//     used for beams and columns. EI from the section, EA from the area.
//   - Shell (2D): MITC4-like quadrilateral with membrane + plate bending,
//     used for walls and slabs (drilled down to constant-strain triangles
//     for robustness on arbitrary meshes).
//
// Load system: load patterns (DL, LL, WL...) with case data, plus automatic
// code combinations (ACI 318-19 §5.3.1).
//
// Solver: LDL^T with node reordering; supports multiple load vectors in one
// factorization. Modal via inverse iteration on the shifted stiffness.
(function () {
  const G = window.G;

  // =========================================================== linear algebra
  // Solve K·X = F for multiple right-hand sides. K is destroyed.
  function solveLDLT(K, F) {
    const n = K.length;
    const m = F[0].length;
    // LDL^T in place (lower triangle used)
    for (let j = 0; j < n; j++) {
      let d = K[j][j];
      for (let k = 0; k < j; k++) d -= K[j][k] * K[j][k] * K[k][k];
      if (Math.abs(d) < 1e-14) d = 1e-14; // near-singular guard
      K[j][j] = d;
      for (let i = j + 1; i < n; i++) {
        let s = K[i][j];
        for (let k = 0; k < j; k++) s -= K[i][k] * K[k][k] * K[j][k];
        K[i][j] = s / d;
      }
    }
    // forward/back substitution for each RHS
    const X = F.map(f => {
      const x = new Float64Array(n);
      // L·y = f (forward — no divide)
      for (let i = 0; i < n; i++) {
        let s = f[i];
        for (let k = 0; k < i; k++) s -= K[i][k] * x[k];
        x[i] = s;
      }
      // D·z = y (diagonal — all divides first)
      for (let i = 0; i < n; i++) x[i] /= K[i][i];
      // L^T·x = z (back — pure back-substitution, no divide)
      for (let i = n - 1; i >= 0; i--) {
        for (let k = i + 1; k < n; k++) x[i] -= K[k][i] * x[k];
      }
      return x;
    });
    return X;
  }

  // ============================================== frame element (6 DOF/node)
  // Local DOFs: [u1x, u1y, u1z, r1x, r1y, r1z, u2x, u2y, u2z, r2x, r2y, r2z]
  // The element axis is local x; bending in local y and z planes; torsion
  // about local x. For 3D frames this gives 12 DOF total.
  function frameK(E, A, Iy, Iz, J, L, Gm, As2, As3) {
    const EA = E * A / L;
    // Timoshenko shear deformation (optional): phi = 12EI/(G·As·L²).
    // As2 = shear area in local y (bent by Iz), As3 = local z (bent by Iy).
    // No As → Euler-Bernoulli (phi = 0).
    const Gy = Gm || E / 2.6;
    const phiY = (As2 && Gy) ? 12 * E * Iz / (Gy * As2 * L * L) : 0;
    const phiZ = (As3 && Gy) ? 12 * E * Iy / (Gy * As3 * L * L) : 0;
    const cy = 12 * E * Iz / (L * L * L * (1 + phiY));
    const cz = 12 * E * Iy / (L * L * L * (1 + phiZ));
    const my = 6 * E * Iz / (L * L * (1 + phiY));
    const mz = 6 * E * Iy / (L * L * (1 + phiZ));
    const by = (4 + phiY) * E * Iz / (L * (1 + phiY));
    const dy = (2 - phiY) * E * Iz / (L * (1 + phiY));
    const bz = (4 + phiZ) * E * Iy / (L * (1 + phiZ));
    const dz = (2 - phiZ) * E * Iy / (L * (1 + phiZ));
    const t = (Gm || E / 2.6) * J / L; // St-Venant torsion; caller passes G = E/(2(1+ν))
    const K = [];
    for (let i = 0; i < 12; i++) { K.push(new Float64Array(12)); }
    // axial
    K[0][0] = EA; K[0][6] = -EA; K[6][0] = -EA; K[6][6] = EA;
    // torsion
    K[3][3] = t; K[3][9] = -t; K[9][3] = -t; K[9][9] = t;
    // bending about local z (displacement in y)
    K[1][1] = cy; K[1][5] = my; K[1][7] = -cy; K[1][11] = my;
    K[5][1] = my; K[5][5] = by; K[5][7] = -my; K[5][11] = dy;
    K[7][1] = -cy; K[7][5] = -my; K[7][7] = cy; K[7][11] = -my;
    K[11][1] = my; K[11][5] = dy; K[11][7] = -my; K[11][11] = by;
    // bending about local y (displacement in z) — sign-congruent to the
    // z-plane block via diag(1,−1,1,−1) (rotation positive sense flipped);
    // K[8][10] and K[10][8] are +mz to keep the element positive-semidefinite
    K[2][2] = cz; K[2][4] = -mz; K[2][8] = -cz; K[2][10] = -mz;
    K[4][2] = -mz; K[4][4] = bz; K[4][8] = mz; K[4][10] = dz;
    K[8][2] = -cz; K[8][4] = mz; K[8][8] = cz; K[8][10] = mz;
    K[10][2] = -mz; K[10][4] = dz; K[10][8] = mz; K[10][10] = bz;
    return K;
  }

  // ================================================ geometric stiffness (P-delta)
  // Consistent geometric stiffness of the cubic Hermitian beam in LOCAL
  // coordinates: Kg(P) with P the axial force, TENSION POSITIVE. The tangent
  // system is K + Kg(P): tension stiffens the transverse response, compression
  // softens it (Euler buckling is the point where K + Kg(-Pcr) goes singular).
  // The x-z plane block is the diag(1,−1,1,−1) sign-congruent of the x-y
  // block, matching frameK's rotation-positive convention in that plane.
  function frameKg(P, L) {
    const Kg = [];
    for (let i = 0; i < 12; i++) Kg.push(new Float64Array(12));
    if (!P) return Kg;
    const c = P / (30 * L);
    // x-y plane, dofs [v1, r1z, v2, r2z] = [1, 5, 7, 11]
    const Ky4 = [
      [36, 3 * L, -36, 3 * L],
      [3 * L, 4 * L * L, -3 * L, -L * L],
      [-36, -3 * L, 36, -3 * L],
      [3 * L, -L * L, -3 * L, 4 * L * L],
    ];
    const yDofs = [1, 5, 7, 11], zDofs = [2, 4, 8, 10];
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        Kg[yDofs[i]][yDofs[j]] = c * Ky4[i][j];
        // z-plane: conjugate by diag(1,−1,1,−1) on the local dof pairs
        const s = (i % 2 === 0 ? 1 : -1) * (j % 2 === 0 ? 1 : -1);
        Kg[zDofs[i]][zDofs[j]] = c * Ky4[i][j] * s;
      }
    return Kg;
  }

  // Transformation: 3×3 rotation from global to local (x along the element)
  // Consistent (shape-function) equivalent joint loads for a uniform member
  // load, LOCAL coordinates, 12-DOF convention matching frameK. wy acts in
  // local +y, wz in local +z (N/mm). The fixed-end forces on the element
  // used in recovery are the NEGATIVE of this vector (u = 0 clamped).
  function consistentUDL(wy, wz, L, points) {
    const f = new Float64Array(12);
    if (wy) {
      f[1] = wy * L / 2; f[5] = wy * L * L / 12;
      f[7] = wy * L / 2; f[11] = -wy * L * L / 12;
    }
    if (wz) {
      // x-z plane uses the sign-flipped rotation convention (diag(1,−1,1,−1))
      f[2] = wz * L / 2; f[4] = -wz * L * L / 12;
      f[8] = wz * L / 2; f[10] = wz * L * L / 12;
    }
    // concentrated transverse loads: same convention as the UDL vector —
    // P (local +y) at distance a from end i; a2 = L − a
    for (const pt of points || []) {
      const P = pt.P, a = Math.max(0, Math.min(L, pt.a));
      const a2 = L - a;
      f[1] += P * a2 * a2 * (L + 2 * a) / (L * L * L);
      f[5] += P * a * a2 * a2 / (L * L);
      f[7] += P * a * a * (L + 2 * a2) / (L * L * L);
      f[11] += -P * a * a * a2 / (L * L);
    }
    return f;
  }
  function rotationMatrix(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    const x = [dx / L, dy / L, dz / L];
    // pick a reference axis not parallel to x
    let ref = Math.abs(x[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    // local z = x × ref (perpendicular to the element, roughly vertical or horizontal)
    let z = [
      x[1] * ref[2] - x[2] * ref[1],
      x[2] * ref[0] - x[0] * ref[2],
      x[0] * ref[1] - x[1] * ref[0],
    ];
    const zl = Math.hypot(...z) || 1;
    z = [z[0] / zl, z[1] / zl, z[2] / zl];
    // local y = z × x
    const y = [
      z[1] * x[2] - z[2] * x[1],
      z[2] * x[0] - z[0] * x[2],
      z[0] * x[1] - z[1] * x[0],
    ];
    return [x, y, z];
  }

  function transformFrame(Klocal, R) {
    // build 12×12 transformation T (block diagonal of 4 R's)
    const T = [];
    for (let i = 0; i < 12; i++) T.push(new Float64Array(12));
    for (let b = 0; b < 4; b++)
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          T[b * 3 + i][b * 3 + j] = R[i][j];
    // Kglobal = T^T · Klocal · T
    const Kt = [];
    for (let i = 0; i < 12; i++) Kt.push(new Float64Array(12));
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 12; j++) {
        let s = 0;
        for (let k = 0; k < 12; k++) s += Klocal[i][k] * T[k][j];
        Kt[i][j] = s;
      }
    const Kg = [];
    for (let i = 0; i < 12; i++) Kg.push(new Float64Array(12));
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 12; j++) {
        let s = 0;
        for (let k = 0; k < 12; k++) s += T[k][i] * Kt[k][j];
        Kg[i][j] = s;
      }
    return Kg;
  }

  // ============================================ shell element (2D, triangles)
  // Constant-strain triangle for membrane + discrete Kirchhoff triangle for
  // plate bending — combined 6 DOF per node. For simplicity here we use a
  // flat triangle with in-plane stiffness and thin-plate bending; adequate
  // for wall/slab stiffness participation in building analysis.
  function shellK(E, nu, t, p1, p2, p3) {
    // area and local frame
    const u = G.sub(p2, p1), v = G.sub(p3, p1);
    const nrm = G.cross(u, v);
    const area2 = G.len(nrm);
    if (area2 < 1e-12) return null;
    const area = area2 / 2;
    const n = G.mul(nrm, 1 / area2);
    // local coordinate system
    const ex = G.norm(u);
    const ey = G.cross(n, ex);
    const toL = p => [G.dot(G.sub(p, p1), ex), G.dot(G.sub(p, p1), ey)];
    const l1 = [0, 0], l2 = toL(p2), l3 = toL(p3);
    // CST membrane stiffness (3 nodes × 2 dof = 6)
    const B = [
      [l2[1] - l3[1], 0, l3[1] - l1[1], 0, l1[1] - l2[1], 0],
      [0, l3[0] - l2[0], 0, l1[0] - l3[0], 0, l2[0] - l1[0]],
      [l3[0] - l2[0], l2[1] - l3[1], l1[0] - l3[0], l3[1] - l1[1], l2[0] - l1[0], l1[1] - l2[1]],
    ].map(r => r.map(x => x / area2));
    const d0 = E / (1 - nu * nu);
    const D = [
      [d0, d0 * nu, 0],
      [d0 * nu, d0, 0],
      [0, 0, d0 * (1 - nu) / 2],
    ];
    const Kmem = [];
    for (let i = 0; i < 6; i++) Kmem.push(new Float64Array(6));
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        let s = 0;
        for (let a = 0; a < 3; a++)
          for (let b = 0; b < 3; b++)
            s += B[a][i] * D[a][b] * B[b][j];
        Kmem[i][j] = s * t * area;
      }
    // Simple plate bending: diagonal heuristic (t³·E/12 per unit area per node)
    // — captures slab/wall vertical stiffness without full DKT complexity
    const kb = E * t * t * t / 12 / (1 - nu * nu) * area / 3;
    const Kplate = [];
    for (let i = 0; i < 9; i++) Kplate.push(new Float64Array(9));
    for (let nd = 0; nd < 3; nd++) {
      Kplate[nd * 3 + 2][nd * 3 + 2] = kb;       // wz
      Kplate[nd * 3 + 0][nd * 3 + 0] = kb * 0.1; // rx
      Kplate[nd * 3 + 1][nd * 3 + 1] = kb * 0.1; // ry
    }
    return { Kmem, Kplate, area, normal: n, toL };
  }

  // ==================================== flat shell quad (4-node, 5 dof/node)
  // Bilinear membrane (Q4, 2x2 Gauss) + Mindlin plate with selective reduced
  // integration (bending 2x2, shear 1x1 at center) — the classic SRI quad,
  // shear-lock-free for thin plates. Local dofs per node:
  //   [u_ex, u_ey, u_ez, th_ex, th_ey] — 5, drilling excluded.
  // Nodes are given in GLOBAL coords; the element builds its local frame
  // (ex along p1->p2, ez = normal) and transforms.
  function shellQ4(E, nu, t, p1, p2, p3, p4) {
    // local frame
    const ex = G.norm(G.sub(p2, p1));
    let ez = G.cross(G.sub(p2, p1), G.sub(p3, p1));
    if (G.len(ez) < 1e-12) return null;
    ez = G.norm(ez);
    const ey = G.cross(ez, ex);
    // to local 2D
    const toL = p => [G.dot(G.sub(p, p1), ex), G.dot(G.sub(p, p1), ey)];
    const lp = [toL(p1), toL(p2), toL(p3), toL(p4)];
    const area = Math.abs((lp[1][0]-lp[0][0])*(lp[2][1]-lp[0][1]) - (lp[2][0]-lp[0][0])*(lp[1][1]-lp[0][1])) / 2 +
                 Math.abs((lp[2][0]-lp[0][0])*(lp[3][1]-lp[0][1]) - (lp[3][0]-lp[0][0])*(lp[2][1]-lp[0][1])) / 2;
    if (!(area > 1e-9)) return null;
    // proper shape functions + derivatives on the reference square [-1,1]^2
    const shape = (xi, et) => ({
      N: [0.25*(1-xi)*(1-et), 0.25*(1+xi)*(1-et), 0.25*(1+xi)*(1+et), 0.25*(1-xi)*(1+et)],
      dN: [[-0.25*(1-et), 0.25*(1-et), 0.25*(1+et), -0.25*(1+et)],
           [-0.25*(1-xi), -0.25*(1+xi), 0.25*(1+xi), 0.25*(1-xi)]], // dN/dxi, dN/det
    });
    // Jacobian at a point
    const Jac = (xi, et) => {
      const d = shape(xi, et).dN;
      const J11 = d[0][0]*lp[0][0] + d[0][1]*lp[1][0] + d[0][2]*lp[2][0] + d[0][3]*lp[3][0];
      const J12 = d[0][0]*lp[0][1] + d[0][1]*lp[1][1] + d[0][2]*lp[2][1] + d[0][3]*lp[3][1];
      const J21 = d[1][0]*lp[0][0] + d[1][1]*lp[1][0] + d[1][2]*lp[2][0] + d[1][3]*lp[3][0];
      const J22 = d[1][0]*lp[0][1] + d[1][1]*lp[1][1] + d[1][2]*lp[2][1] + d[1][3]*lp[3][1];
      const det = J11*J22 - J12*J21;
      return { det, inv: [J22/det, -J12/det, -J21/det, J11/det] };
    };
    const dNs = (xi, et) => {
      const d = shape(xi, et).dN, J = Jac(xi, et);
      // dN/dx = invJ * dN/dxi
      return [
        [J.inv[0]*d[0][0] + J.inv[1]*d[1][0], J.inv[0]*d[0][1] + J.inv[1]*d[1][1], J.inv[0]*d[0][2] + J.inv[1]*d[1][2], J.inv[0]*d[0][3] + J.inv[1]*d[1][3]],
        [J.inv[2]*d[0][0] + J.inv[3]*d[1][0], J.inv[2]*d[0][1] + J.inv[3]*d[1][1], J.inv[2]*d[0][2] + J.inv[3]*d[1][2], J.inv[2]*d[0][3] + J.inv[3]*d[1][3]],
      ];
    };
    // constitutive
    const d0 = E / (1 - nu * nu);
    const Dm = [[d0, d0*nu, 0], [d0*nu, d0, 0], [0, 0, d0*(1-nu)/2]];                 // membrane
    const Db = [[d0*t*t*t/12, d0*nu*t*t*t/12, 0],
                [d0*nu*t*t*t/12, d0*t*t*t/12, 0],
                [0, 0, d0*(1-nu)*t*t*t/24]];                                          // bending (kappa)
    const Gc = E / (2 * (1 + nu));
    const Ds = [[Gc * t * 5 / 6, 0], [0, Gc * t * 5 / 6]];                            // shear
    // dof layout local: node n (0..3): [u, v, w, thx, thy] -> 20 dofs
    const K = [];
    for (let i = 0; i < 20; i++) K.push(new Float64Array(20));
    const Bm = () => { const B = []; for (let i = 0; i < 3; i++) B.push(new Float64Array(20)); return B; };
    const Bb = () => { const B = []; for (let i = 0; i < 3; i++) B.push(new Float64Array(20)); return B; };
    const Bs = () => { const B = []; for (let i = 0; i < 2; i++) B.push(new Float64Array(20)); return B; };
    const fillB = (xi, et, Bm_, Bb_, Bs_) => {
      const dn = dNs(xi, et), N = shape(xi, et).N;
      for (let n = 0; n < 4; n++) {
        const o = n * 5;
        // membrane: e_x = dN/dx, e_y = dN/dy, gamma = dN/dy + dN/dx
        Bm_[0][o] = dn[0][n]; Bm_[1][o+1] = dn[1][n]; Bm_[2][o] = dn[1][n]; Bm_[2][o+1] = dn[0][n];
        // bending: kappa_x = -d thy/dx, kappa_y = d thx/dy, kappa_xy = d thx/dx - d thy/dy
        // WARNING: plate bending convention NOT yet verified against theory —
        // multi-element slab meshes give ~2.6× too-flexible results. The
        // frame-only analysis path is fully verified and unaffected.
        Bb_[0][o+4] = -dn[0][n]; Bb_[1][o+3] = dn[1][n];
        Bb_[2][o+3] = dn[0][n]; Bb_[2][o+4] = -dn[1][n];
        // shear: gamma_x = dz/dx - thx, gamma_y = dz/dy - thy
        Bs_[0][o+2] = dn[0][n]; Bs_[0][o+4] = -N[n];
        Bs_[1][o+2] = dn[1][n]; Bs_[1][o+3] = +N[n];
      }
    };
    // explicit assembly loop (membrane + bending 2x2, shear 1x1)
    const gw = 0.5773502692;
    for (const xi of [-gw, gw]) for (const et of [-gw, gw]) {
      const w = 1;
      const J = Jac(xi, et), detJ = J.det;
      const Bm_ = Bm(), Bb_ = Bb(), Bs_ = Bs();
      fillB(xi, et, Bm_, Bb_, Bs_);
      for (let i = 0; i < 20; i++)
        for (let j = 0; j < 20; j++) {
          let sm = 0, sb = 0;
          for (let a = 0; a < 3; a++) {
            sm += Bm_[a][i] * Dm[a][0] * Bm_[0][j] + Bm_[a][i] * Dm[a][1] * Bm_[1][j] + Bm_[a][i] * Dm[a][2] * Bm_[2][j];
            sb += Bb_[a][i] * Db[a][0] * Bb_[0][j] + Bb_[a][i] * Db[a][1] * Bb_[1][j] + Bb_[a][i] * Db[a][2] * Bb_[2][j];
          }
          K[i][j] += (sm + sb) * w * detJ;
        }
    }
    {
      const Bm_ = Bm(), Bb_ = Bb(), Bs_ = Bs();
      fillB(0, 0, Bm_, Bb_, Bs_);
      for (let i = 0; i < 20; i++)
        for (let j = 0; j < 20; j++) {
          let ss = 0;
          for (let a = 0; a < 2; a++) ss += Bs_[a][i] * Ds[a][0] * Bs_[0][j] + Bs_[a][i] * Ds[a][1] * Bs_[1][j];
          K[i][j] += ss * area; // center point weight = full area
        }
    }
    return { K, area, ex, ey, ez, lp };
  }

  // ================================================================ assembly
  // Build the global system from a mesh description:
  //   nodes: [{x,y,z, fixed?: [ux,uy,uz,rx,ry,rz]}] — METERS (model units)
  //   frames: [{ni, nj, E, A, Iy, Iz, J}] — E in MPa, A in mm², I/J in mm⁴
  //   shells: [{n1, n2, n3, E, nu, t}] — E in MPa, t in mm
  //   loads: array of load vectors (each a Map nodeIdx→[fx,fy,fz,mx,my,mz]) in N
  //   opts.geo: array aligned with `frames` of axial forces (N, TENSION
  //             POSITIVE) for P-delta — K + Kg(P) is assembled instead of K
  //   opts.memberLoads: array aligned with `frames` of null or {wy, wz}
  //             uniform member loads in LOCAL element coordinates (N/mm),
  //             applied as consistent equivalent joint loads; end-force
  //             recovery adds the fixed-end forces so span moments are exact
  // Geometry is scaled to mm internally so the section units stay ETABS-
  // style (MPa/mm²/mm⁴); displacements U are returned in mm, forces in N.
  // Returns { U (array of displacement vectors), frames (end forces), nodes }
  // Shell quads: 4-node flat shells, 5 local dofs/node transformed to the
  // 6-dof global set — shared by assembleAndSolve and computeReactions so
  // both assemble the IDENTICAL stiffness (reaction equilibrium depends on it)
  function scatterShellK(K, sh, nodes) {
    const p1 = nodes[sh.n1], p2 = nodes[sh.n2], p3 = nodes[sh.n3], p4 = nodes[sh.n4];
    if (!p4) return;
    const q = shellQ4(sh.E, sh.nu, sh.t, p1, p2, p3, p4);
    if (!q) return;
    const Rg = [[q.ex.x, q.ex.y, q.ex.z], [q.ey.x, q.ey.y, q.ey.z], [q.ez.x, q.ez.y, q.ez.z]]; // local x,y,z as rows
    const ns = [sh.n1, sh.n2, sh.n3, sh.n4];
    // local 20 -> global scatter with per-node 6x5 transform
    // T: LOCAL(20) x GLOBAL(24) — u_local = T . u_global
    const T = [];
    for (let i = 0; i < 20; i++) T.push(new Float64Array(24));
    for (let n = 0; n < 4; n++) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) T[n * 5 + c][n * 6 + r] = Rg[r][c];
        for (let c = 0; c < 2; c++) T[n * 5 + 3 + c][n * 6 + 3 + r] = Rg[r][c];
      }
    }
    const Kt = [];
    for (let i = 0; i < 20; i++) Kt.push(new Float64Array(24));
    for (let i = 0; i < 20; i++)
      for (let j = 0; j < 24; j++) {
        let s2 = 0;
        for (let k = 0; k < 20; k++) s2 += q.K[i][k] * T[k][j];
        Kt[i][j] = s2;
      }
    for (let i = 0; i < 24; i++)
      for (let j = 0; j < 24; j++) {
        let s2 = 0;
        for (let k = 0; k < 20; k++) s2 += T[k][i] * Kt[k][j];
        const gn = Math.floor(i / 6), gd = i % 6;
        const gn2 = Math.floor(j / 6), gd2 = j % 6;
        K[ns[gn] * 6 + gd][ns[gn2] * 6 + gd2] += s2;
      }
  }

  function assembleAndSolve(nodesIn, frames, shells, loads, opts = {}) {
    const nodes = nodesIn.map(n => ({ x: n.x * 1000, y: n.y * 1000, z: n.z * 1000, fixed: n.fixed }));
    const nNodes = nodes.length;
    const nDof = nNodes * 6;
    // global stiffness (dense — buildings are small enough)
    const K = [];
    for (let i = 0; i < nDof; i++) K.push(new Float64Array(nDof));
    // frame elements
    const frameInfo = [];
    frames.forEach((el, elIdx) => {
      const a = nodes[el.ni], b = nodes[el.nj];
      const L = G.dist(a, b);
      if (L < 1e-6) return;
      let Kl = frameK(el.E, el.A, el.Iy, el.Iz, el.J, L, el.G);
      // P-delta: soften/stiffen the transverse terms with the axial force
      if (opts.geo && opts.geo[elIdx] != null && opts.geo[elIdx] !== 0) {
        const Kg = frameKg(opts.geo[elIdx], L);
        for (let i = 0; i < 12; i++)
          for (let j = 0; j < 12; j++) Kl[i][j] += Kg[i][j];
      }
      const R = rotationMatrix(a, b);
      const Kg = transformFrame(Kl, R);
      const dofs = [];
      for (const ni of [el.ni, el.nj])
        for (let d = 0; d < 6; d++) dofs.push(ni * 6 + d);
      for (let i = 0; i < 12; i++)
        for (let j = 0; j < 12; j++)
          K[dofs[i]][dofs[j]] += Kg[i][j];
      const ml = (opts.memberLoads && opts.memberLoads[elIdx]) || null;
      let feq0 = ml ? consistentUDL(ml.wy || 0, ml.wz || 0, L, ml.points) : null;
      // end releases (ETABS Assign > Frame > Releases): condense the local
      // stiffness and the member-load vector together
      if (el.releases && el.releases.length) {
        const rr = applyReleases(Kl, feq0, el.releases);
        Kl = rr.K;
        feq0 = rr.feq;
      }
      frameInfo.push({ el, dofs, Kl, R, L, feq: feq0, wlWy: ml ? (ml.wy || 0) : 0, wlWz: ml ? (ml.wz || 0) : 0 });
    });
    // shell quads via the shared scatter (identical stiffness in every pass)
    for (const sh of shells) scatterShellK(K, sh, nodes);
    // loads → dense RHS vectors (nodal maps + member-load equivalents)
    const F = loads.map(lv => {
      const f = new Float64Array(nDof);
      for (const [ni, vals] of lv) {
        for (let d = 0; d < 6; d++) f[ni * 6 + d] += (vals[d] || 0);
      }
      // member loads: feq is LOCAL; a local vector maps to global as Rᵀ·v
      for (const fi of frameInfo) {
        if (!fi.feq) continue;
        for (let b = 0; b < 4; b++)
          for (let i = 0; i < 3; i++) {
            let gv = 0;
            for (let j = 0; j < 3; j++) gv += fi.R[j][i] * fi.feq[b * 3 + j];
            f[fi.dofs[b * 3 + i]] += gv;
          }
      }
      return f;
    });
    // nodal springs: diagonal stiffness additions (opts.nodalSprings:
    // [{ni, k:[kx,ky,kz,mx,my,mz]}] — N/mm and N·mm/rad)
    for (const sp of opts.nodalSprings || []) {
      for (let d = 0; d < 6; d++) {
        if (!sp.k || !sp.k[d]) continue;
        K[sp.ni * 6 + d][sp.ni * 6 + d] += sp.k[d];
      }
    }
    // rigid diaphragm ties (opts.rigidLinks: [{master, slave, dofs:[...]}]) —
    // penalty coupling of the in-plane dofs to the master node
    for (const rl of opts.rigidLinks || []) {
      let kref = 0;
      for (let i = 0; i < nDof; i++) kref = Math.max(kref, K[i][i]);
      const kp = 1e8 * Math.max(kref, 1);
      for (const dof of rl.dofs) {
        const m = rl.master * 6 + dof, s2 = rl.slave * 6 + dof;
        K[m][m] += kp; K[s2][s2] += kp;
        K[m][s2] -= kp; K[s2][m] -= kp;
      }
    }
    // boundary conditions: zero out fixed dofs (penalty-free row/col wipe)
    for (let ni = 0; ni < nNodes; ni++) {
      const fix = nodes[ni].fixed;
      if (!fix) continue;
      for (let d = 0; d < 6; d++) {
        if (!fix[d]) continue;
        const dof = ni * 6 + d;
        for (let j = 0; j < nDof; j++) { K[dof][j] = 0; K[j][dof] = 0; }
        K[dof][dof] = 1;
        for (const f of F) f[dof] = 0;
      }
    }
    // solve
    const U = solveLDLT(K, F.length ? F : [new Float64Array(nDof)]);
    // recover frame end forces in LOCAL coordinates
    // u_local = T · u_global (T = block-diag of R), then f_local = Kl · u_local
    const results = frameInfo.map(fi => {
      const ug = new Float64Array(12);
      for (let i = 0; i < 12; i++) ug[i] = U[0][fi.dofs[i]] || 0;
      const ud = new Float64Array(12);
      for (let b = 0; b < 4; b++)
        for (let i = 0; i < 3; i++) {
          let s = 0;
          for (let j = 0; j < 3; j++) s += fi.R[i][j] * ug[b * 3 + j];
          ud[b * 3 + i] = s;
        }
      const f = new Float64Array(12);
      for (let i = 0; i < 12; i++)
        for (let j = 0; j < 12; j++)
          f[i] += fi.Kl[i][j] * ud[j];
      // span loads: add the fixed-end forces (u = 0 clamped state)
      if (fi.feq) for (let i = 0; i < 12; i++) f[i] -= fi.feq[i];
      return { el: fi.el, L: fi.L, forces: f, wl: fi.feq ? { wy: fi.wlWy, wz: fi.wlWz, L: fi.L } : null };
    });
    return { U, frames: results, nodes: nodesIn, nDof };
  }

  // Reactions: for fixed dofs, R = K·u - f (computed from the ORIGINAL K,
  // which was destroyed — so we re-assemble when reactions are requested).
  function computeReactions(nodesIn, frames, shells, loads, U, opts = {}) {
    // K was destroyed by solveLDLT; re-assemble quickly
    const nodes = nodesIn.map(n => ({ x: n.x * 1000, y: n.y * 1000, z: n.z * 1000, fixed: n.fixed }));
    const nNodes = nodes.length;
    const nDof = nNodes * 6;
    const K = [];
    for (let i = 0; i < nDof; i++) K.push(new Float64Array(nDof));
    frames.forEach((el, elIdx) => {
      const a = nodes[el.ni], b = nodes[el.nj];
      const L = G.dist(a, b);
      if (L < 1e-6) return;
      let Kl = frameK(el.E, el.A, el.Iy, el.Iz, el.J, L, el.G);
      if (opts.geo && opts.geo[elIdx] != null && opts.geo[elIdx] !== 0) {
        const Kg = frameKg(opts.geo[elIdx], L);
        for (let i = 0; i < 12; i++)
          for (let j = 0; j < 12; j++) Kl[i][j] += Kg[i][j];
      }
      if (el.releases && el.releases.length) Kl = applyReleases(Kl, null, el.releases).K;
      const R = rotationMatrix(a, b);
      const Kg = transformFrame(Kl, R);
      const dofs = [];
      for (const ni of [el.ni, el.nj]) for (let d = 0; d < 6; d++) dofs.push(ni * 6 + d);
      for (let i = 0; i < 12; i++)
        for (let j = 0; j < 12; j++) K[dofs[i]][dofs[j]] += Kg[i][j];
    });
    // shells: the true assembled stiffness — the old fake triangle coupling
    // made reactions at frame/shell shared nodes diverge by orders of magnitude
    for (const sh of shells) scatterShellK(K, sh, nodes);
    const f = new Float64Array(nDof);
    for (const [ni, vals] of (loads[0] || new Map()))
      for (let d = 0; d < 6; d++) f[ni * 6 + d] += (vals[d] || 0);
    // member loads: reactions balance the equivalent joint loads too
    if (opts.memberLoads) {
      frames.forEach((el, elIdx) => {
        const ml = opts.memberLoads[elIdx];
        if (!ml) return;
        const a = nodes[el.ni], b = nodes[el.nj];
        const L = G.dist(a, b);
        if (L < 1e-6) return;
        let feq = consistentUDL(ml.wy || 0, ml.wz || 0, L);
        // released members contribute their CONDENSED equivalent loads
        if (el.releases && el.releases.length) {
          const Kl2 = frameK(el.E, el.A, el.Iy, el.Iz, el.J, L, el.G, el.As2, el.As3);
          feq = applyReleases(Kl2, feq, el.releases).feq;
        }
        const R = rotationMatrix(a, b);
        const dofs = [];
        for (const ni of [el.ni, el.nj]) for (let d = 0; d < 6; d++) dofs.push(ni * 6 + d);
        for (let b2 = 0; b2 < 4; b2++)
          for (let i = 0; i < 3; i++) {
            let gv = 0;
            for (let j = 0; j < 3; j++) gv += R[j][i] * feq[b2 * 3 + j];
            f[dofs[b2 * 3 + i]] += gv;
          }
      });
    }
    const reactions = [];
    for (let ni = 0; ni < nNodes; ni++) {
      if (!nodes[ni].fixed) continue;
      const R = [0, 0, 0, 0, 0, 0];
      for (let d = 0; d < 6; d++) {
        if (!nodes[ni].fixed[d]) continue;
        let s = 0;
        for (let j = 0; j < nDof; j++) s += K[ni * 6 + d][j] * (U[0][j] || 0);
        R[d] = s - f[ni * 6 + d];
      }
      reactions.push({ node: ni, R });
    }
    return reactions;
  }

  // ============================================ modal (eigen) analysis
  // Lumped mass vector (tonnes) per translational DOF — element tributary
  // mass split to its nodes; rotational inertia is ignored (standard lumped
  // practice; ρ in t/mm³, concrete 24 kN/m³ → 2.4e-9 t/mm³). `extra` adds
  // imposed mass (tonnes per node — e.g. superimposed dead / fraction of
  // live per ASCE 7 §12.7.2 mass source) to all three translations.
  function lumpedMass(nodes, frames, shells, extra) {
    const M = new Float64Array(nodes.length * 6);
    for (const el of frames) {
      const a = nodes[el.ni], b = nodes[el.nj];
      const L = G.dist(a, b);
      if (L < 1e-6) continue;
      const rho = el.rho || 2.4e-9;
      const m = rho * el.A * L / 2;
      for (const ni of [el.ni, el.nj]) { M[ni * 6] += m; M[ni * 6 + 1] += m; M[ni * 6 + 2] += m; }
    }
    for (const sh of shells) {
      const rho = sh.rho || 2.4e-9;
      if (sh.n4 != null) {
        // quad: p1->p2 x p1->p3 diagonal cross products give 2 triangles
        const p1 = nodes[sh.n1], p2 = nodes[sh.n2], p3 = nodes[sh.n3], p4 = nodes[sh.n4];
        const a1 = G.len(G.cross(G.sub(p2, p1), G.sub(p3, p1))) / 2;
        const a2 = G.len(G.cross(G.sub(p3, p1), G.sub(p4, p1))) / 2;
        const share = rho * sh.t * (a1 + a2) / 4;
        for (const ni of [sh.n1, sh.n2, sh.n3, sh.n4]) { M[ni * 6] += share; M[ni * 6 + 1] += share; M[ni * 6 + 2] += share; }
      } else {
        const p1 = nodes[sh.n1], p2 = nodes[sh.n2], p3 = nodes[sh.n3];
        const u = G.sub(p2, p1), v = G.sub(p3, p1);
        const area = G.len(G.cross(u, v)) / 2;
        const m = rho * sh.t * area / 3;
        for (const ni of [sh.n1, sh.n2, sh.n3]) { M[ni * 6] += m; M[ni * 6 + 1] += m; M[ni * 6 + 2] += m; }
      }
    }
    if (extra) {
      for (let ni = 0; ni < nodes.length; ni++) {
        const m = extra[ni] || 0;
        if (m) { M[ni * 6] += m; M[ni * 6 + 1] += m; M[ni * 6 + 2] += m; }
      }
    }
    return M;
  }

  // Jacobi eigenvalue solver for a small dense symmetric matrix — returns
  // { values (ascending), vectors (columns) }. Sufficient for the p×p
  // projected operator in subspace iteration (p ≤ ~16).
  function jacobiEigen(Ain, maxSweeps = 30) {
    const n = Ain.length;
    const A = Ain.map(r => Float64Array.from(r));
    const V = [];
    for (let i = 0; i < n; i++) {
      const row = new Float64Array(n);
      row[i] = 1;
      V.push(row);
    }
    for (let sweep = 0; sweep < maxSweeps; sweep++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-24) break;
      for (let p = 0; p < n - 1; p++) {
        for (let q = p + 1; q < n; q++) {
          if (Math.abs(A[p][q]) < 1e-18) continue;
          const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (let k = 0; k < n; k++) {
            const akp = A[k][p], akq = A[k][q];
            A[k][p] = c * akp - s * akq;
            A[k][q] = s * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = A[p][k], aqk = A[q][k];
            A[p][k] = c * apk - s * aqk;
            A[q][k] = s * apk + c * aqk;
          }
          for (let k = 0; k < n; k++) {
            const vkp = V[k][p], vkq = V[k][q];
            V[k][p] = c * vkp - s * vkq;
            V[k][q] = s * vkp + c * vkq;
          }
        }
      }
    }
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[a][a] - A[b][b]);
    return {
      values: idx.map(i => A[i][i]),
      vectors: idx.map(i => V.map(row => row[i])), // eigenvector i = column
    };
  }

  // Smallest eigenpairs of K·φ = ω²·M·φ via subspace iteration.
  // Rotational DOFs carry no mass → their modes sit at infinite frequency
  // and subspace iteration never converges to them (safe to keep them in K).
  // Units: N, mm, tonnes → ω² in (rad/s)². Returns modes
  // [{ f, T, phi: Float64Array(nDof) }] with f in Hz.
  // extraMass (optional): array of imposed mass in TONNES per node — the
  // mass source beyond self-weight (superimposed dead + optional fraction
  // of live, per the chosen seismic mass definition).
  function modalAnalysis(nodesIn, frames, shells, nModesWanted = 6, extraMass) {
    const nodes = nodesIn.map(n => ({ x: n.x * 1000, y: n.y * 1000, z: n.z * 1000, fixed: n.fixed }));
    const nNodes = nodes.length;
    const nDof = nNodes * 6;
    // assemble K (same path as the static solve)
    const K = [];
    for (let i = 0; i < nDof; i++) K.push(new Float64Array(nDof));
    for (const el of frames) {
      const a = nodes[el.ni], b = nodes[el.nj];
      const L = G.dist(a, b);
      if (L < 1e-6) continue;
      const Kl = frameK(el.E, el.A, el.Iy, el.Iz, el.J, L, el.G, el.As2, el.As3);
      const R = rotationMatrix(a, b);
      const Kg = transformFrame(Kl, R);
      const dofs = [];
      for (const ni of [el.ni, el.nj]) for (let d = 0; d < 6; d++) dofs.push(ni * 6 + d);
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) K[dofs[i]][dofs[j]] += Kg[i][j];
    }
    // Shells contribute MASS only to the eigenproblem: the plate heuristic
    // (E·t³·area) is orders of magnitude stiffer than the frame, and in
    // float64 subspace iteration that conditioning drowns the building's
    // soft sway modes. Building sway is frame-dominated, so the modal
    // stiffness comes from the frame system alone.
    const M = lumpedMass(nodes, frames, shells, extraMass);
    // Partition free dofs into translational (carry lumped mass) and
    // rotational (massless). Guyan static condensation removes the
    // rotational block EXACTLY for the stiffness — the eigenproblem then
    // runs on positive-definite (Ktt~, Mtt) with full rank on both sides.
    // φ_rot = −Krr⁻¹·Krt·φ_trans.
    const ft = [], fr = [];
    for (let ni = 0; ni < nNodes; ni++) {
      const fixed = nodes[ni].fixed;
      for (let d = 0; d < 6; d++) {
        if (fixed && fixed[d]) continue;
        (d < 3 ? ft : fr).push(ni * 6 + d);
      }
    }
    if (!ft.length || !ft.some(d => M[d] > 0)) return { modes: [] };
    const nt = ft.length, nr = fr.length;
    const Ktt = [], Ktr = [], Krt = [], Krr = [];
    for (let i = 0; i < nt; i++) {
      Ktt.push(Float64Array.from(ft.map(d => K[ft[i]][d])));
      if (nr) Ktr.push(Float64Array.from(fr.map(d => K[ft[i]][d])));
    }
    for (let i = 0; i < nr; i++) {
      Krt.push(Float64Array.from(ft.map(d => K[fr[i]][d])));
      Krr.push(Float64Array.from(fr.map(d => K[fr[i]][d])));
    }
    let Kc = Ktt.map(r => Float64Array.from(r));
    if (nr) {
      // W = Krr⁻¹·Krt: the RHS vectors are the COLUMNS of Krt (= rows of
      // Ktr, already stored as fr-space vectors). solveLDLT returns the
      // solutions as ROWS, so Wmat[k][j] = W[j][k] in that storage.
      const W = solveLDLT(Krr.map(r => Float64Array.from(r)), Ktr.map(r => Float64Array.from(r)));
      for (let i = 0; i < nt; i++)
        for (let j = 0; j < nt; j++) {
          let s = 0;
          for (let k = 0; k < nr; k++) s += Ktr[i][k] * W[j][k];
          Kc[i][j] -= s;
        }
    }
    const Mr = ft.map(d => M[d]);
    const p = Math.max(2, Math.min(nModesWanted + 3, nt));
    // start vectors: coordinate unit directions — always linearly
    // independent and aligned with the sway/vertical modes of buildings
    let X = [];
    for (let j = 0; j < p; j++) {
      const v = new Float64Array(nt);
      v[j % nt] = 1;
      X.push(v);
    }
    mOrtho(X, Mr);
    let lam = null, degenerate = false;
    // Rayleigh shift Kc + αM keeps the inverse iteration solvable when the
    // structure has mechanisms (singular Kc — pin-based unbraced frames);
    // mechanism modes then surface as near-zero frequencies and are filtered.
    let trK = 0, trM = 0;
    for (let i = 0; i < nt; i++) { trK += Kc[i][i]; trM += Mr[i]; }
    const alpha = trM > 0 ? 1e-8 * Math.max(trK, 1e-30) / trM : 0;
    const Ks = Kc.map((row, i) => Float64Array.from(row, (v, j) => v + (i === j ? alpha * Mr[i] : 0)));
    for (let iter = 0; iter < 15; iter++) {
      // Y = Ks⁻¹·(M·X) — one factorization, p right-hand sides
      const RHS = X.map(x => {
        const r = new Float64Array(nt);
        for (let i = 0; i < nt; i++) r[i] = Mr[i] * x[i];
        return r;
      });
      const Y = solveLDLT(Ks.map(r => Float64Array.from(r)), RHS);
      // projected pair: Ky = YᵀKY = Yᵀ(MX) (since KY = MX by construction),
      // My = YᵀMY. The Ritz problem is GENERALIZED: Ky z = λ My z.
      const Ky = [], My = [];
      for (let i = 0; i < p; i++) {
        const kyRow = new Float64Array(p), myRow = new Float64Array(p);
        for (let j = 0; j < p; j++) {
          let ky = 0, my = 0;
          for (let k = 0; k < nt; k++) {
            ky += Y[i][k] * RHS[j][k];
            my += Y[i][k] * Mr[k] * Y[j][k];
          }
          kyRow[j] = ky; myRow[j] = my;
        }
        Ky.push(kyRow); My.push(myRow);
      }
      const { values, vectors } = generalizedEigen(Ky, My); // ascending λ = ω²
      if (!values || !values.length) {
        degenerate = true;
        if (!lam) lam = [];
        // the projected mass matrix degenerated — the structure has a true
        // MECHANISM (e.g. pin-based unbraced frame): Kc is singular, the
        // inverse iteration produced non-finite Ritz vectors. Stop cleanly.
        break;
      }
      const Xnew = [];
      for (let oi = 0; oi < values.length; oi++) {
        const v = new Float64Array(nt);
        for (let k = 0; k < p; k++) for (let i = 0; i < nt; i++) v[i] += vectors[oi][k] * Y[k][i];
        Xnew.push(v);
      }
      mOrtho(Xnew, Mr);
      const lamNew = values.slice();
      if (lam && lamNew.length >= lam.length &&
        lamNew.slice(0, Math.min(lam.length, nModesWanted)).every((v, i) => Math.abs(v - lam[i]) < 1e-9 * Math.abs(v || 1))) {
        lam = lamNew; X = Xnew; break;
      }
      lam = lamNew; X = Xnew;
    }
    const modes = [];
    let mechanisms = 0;
    for (let i = 0; i < Math.min(nModesWanted + 4, lam.length); i++) {
      const omega2 = Math.max(lam[i], 0);
      if (!isFinite(omega2)) { mechanisms++; continue; } // solver fallout
      if (Math.sqrt(omega2) / (2 * Math.PI) < 0.05) { mechanisms++; continue; } // rigid/mechanism
      if (modes.length >= nModesWanted) break;
      const phi = new Float64Array(nDof);
      for (let k = 0; k < nt; k++) phi[ft[k]] = X[i][k];
      // expand rotations back: φ_rot = −Krr⁻¹·Krt·φ_trans
      if (nr && omega2 > 0) {
        const rhs = Krt.map(r => {
          let s = 0;
          for (let k = 0; k < nt; k++) s += r[k] * phi[ft[k]];
          return Float64Array.from([s]);
        });
        const rot = solveLDLT(Krr.map(r => Float64Array.from(r)), rhs);
        for (let k = 0; k < nr; k++) phi[fr[k]] = -rot[k][0];
      }
      // mass-normalize for reporting
      let mNorm = 0;
      for (let k = 0; k < nt; k++) mNorm += Mr[k] * X[i][k] * X[i][k];
      if (mNorm > 0) { const s = 1 / Math.sqrt(mNorm); for (let k = 0; k < nt; k++) phi[ft[k]] *= s; }
      const omega = Math.sqrt(omega2);
      modes.push({ f: omega / (2 * Math.PI), T: omega > 0 ? 2 * Math.PI / omega : Infinity, phi });
    }
    if (degenerate && !modes.length) mechanisms = Math.max(mechanisms, 1);
    return { modes, mechanisms };
  }

  // Generalized symmetric eigenproblem A z = λ B z for small dense pairs:
  // Cholesky B = L·Lᵀ, standard eig of C = L⁻¹AL⁻ᵀ, back-transform.
  // λ returned ascending; vectors[i] is the eigenvector for values[i].
  function generalizedEigen(A, B) {
    const n = A.length;
    // Cholesky of B (with jitter fallback for a semi-definite projection)
    let L = cholesky(B);
    if (!L) {
      const jitter = 1e-12 * (B.reduce((s, r) => s + r[0], 0) / n + 1);
      L = cholesky(B.map((r, i) => r.map((v, j) => v + (i === j ? jitter : 0))));
      if (!L) return { values: [], vectors: [] };
    }
    // Linv (solve L·Linv = I) and LinvT
    const Linv = [];
    for (let j = 0; j < n; j++) {
      const e = new Float64Array(n);
      e[j] = 1;
      Linv.push(triSolve(L, e, true));
    }
    // C = Linv · A · Linvᵀ  (Linv[j] stores COLUMN j of L⁻¹, so (L⁻¹)[a][b] = Linv[b][a])
    const T1 = [];
    for (let i = 0; i < n; i++) {
      const row = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += Linv[k][i] * A[k][j];
        row[j] = s;
      }
      T1.push(row);
    }
    const C2 = [];
    for (let i = 0; i < n; i++) {
      const t = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += T1[i][k] * Linv[k][j];
        t[j] = s;
      }
      C2.push(t);
    }
    const eig = jacobiEigen(C2);
    // back-transform z = L⁻ᵀ y
    const vectors = eig.values.map((_, i) => {
      const y = eig.vectors[i];
      const z = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += Linv[j][k] * y[k];
        z[j] = s;
      }
      return z;
    });
    return { values: eig.values, vectors };
  }

  function cholesky(B) {
    const n = B.length;
    const L = [];
    for (let i = 0; i < n; i++) L.push(new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = B[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (s <= 0) return null;
          L[i][i] = Math.sqrt(s);
        } else L[i][j] = s / L[j][j];
      }
    }
    return L;
  }

  // forward/back substitution for a triangular matrix
  function triSolve(L, b, lower) {
    const n = L.length;
    const x = new Float64Array(n);
    if (lower) {
      for (let i = 0; i < n; i++) {
        let s = b[i];
        for (let k = 0; k < i; k++) s -= L[i][k] * x[k];
        x[i] = s / L[i][i];
      }
    } else {
      for (let i = n - 1; i >= 0; i--) {
        let s = b[i];
        for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
        x[i] = s / L[i][i];
      }
    }
    return x;
  }

  // M-orthonormalize the columns of X against the diagonal mass Mr
  function mOrtho(X, Mr) {
    for (let j = 0; j < X.length; j++) {
      for (let jj = 0; jj < j; jj++) {
        let dot = 0;
        for (let i = 0; i < X[j].length; i++) dot += X[jj][i] * Mr[i] * X[j][i];
        for (let i = 0; i < X[j].length; i++) X[j][i] -= dot * X[jj][i];
      }
      let nrm = 0;
      for (let i = 0; i < X[j].length; i++) nrm += X[j][i] * Mr[i] * X[j][i];
      nrm = Math.sqrt(Math.max(nrm, 1e-30));
      for (let i = 0; i < X[j].length; i++) X[j][i] /= nrm;
    }
  }

  // ================================================== load-dependent Ritz vectors
  // Wilson, Yuan & Dickens (1982), as documented for ETABS in CSI's
  // Analysis Reference ("Ritz vectors"): a first static solve against the
  // acceleration load M*r, then repeated solves + M-orthogonalization build
  // a basis shaped by the loading - better conditioned than subspace
  // iteration, and it yields modal participating mass ratios directly.
  function ritzModalAnalysis(nodesIn, frames, shells, nWanted, extraMass, dir) {
    if (nWanted == null) nWanted = 8;
    if (dir == null) dir = 'gravity';
    const sys = buildCondensedSystem(nodesIn, frames, shells, extraMass);
    if (!sys) return { modes: [], mechanisms: 0 };
    const ft = sys.ft, fr = sys.fr, nt = sys.nt, nr = sys.nr;
    const Kc = sys.Kc, Krr = sys.Krr, Krt = sys.Krt, Mr = sys.Mr, nDof = sys.nDof;
    // Rayleigh shift for mechanisms (see modalAnalysis)
    let trK = 0, trM = 0;
    for (let i = 0; i < nt; i++) { trK += Kc[i][i]; trM += Mr[i]; }
    const alpha = trM > 0 ? 1e-8 * Math.max(trK, 1e-30) / trM : 0;
    const Ks = Kc.map((row, i) => Float64Array.from(row, (v, j) => v + (i === j ? alpha * Mr[i] : 0)));

    // acceleration direction r over the translational dofs
    const rvec = new Float64Array(nt);
    const rc = dir === 'x' ? 0 : dir === 'y' ? 1 : 2; // gravity = z
    ft.forEach((d, i) => { if (d % 6 === rc) rvec[i] = 1; });
    let R = new Float64Array(nt);
    for (let i = 0; i < nt; i++) R[i] = Mr[i] * rvec[i];
    if (!R.some(v => v !== 0)) {
      ft.forEach((d, i) => { if (d % 6 < 3) rvec[i] = 1; });
      for (let i = 0; i < nt; i++) R[i] = Mr[i] * rvec[i];
    }

    const p = Math.max(2, Math.min(nWanted + 6, nt));
    const psi = [];
    // CSI's default Ritz start loads (Analysis Reference): acceleration in
    // X, Y and Z. A single gravity start misses soft lateral modes of
    // buildings with flexible beams; the three-start basis spans them.
    const starts = dir === 'x' || dir === 'y' ? [dir] : ['z', 'x', 'y'];
    for (const sd of starts) {
      const sc = sd === 'x' ? 0 : sd === 'y' ? 1 : 2;
      const rv = new Float64Array(nt);
      ft.forEach((d, i) => { if (d % 6 === sc) rv[i] = 1; });
      let Rcur = new Float64Array(nt);
      for (let i = 0; i < nt; i++) Rcur[i] = Mr[i] * rv[i];
      if (!Rcur.some(v => v !== 0)) continue;
      const budget = Math.max(2, Math.ceil(p / starts.length));
      for (let j = 0; j < budget && psi.length < p; j++) {
        const sol = solveLDLT(Ks.map(r2 => Float64Array.from(r2)), [Float64Array.from(Rcur)]);
        const v = Float64Array.from(sol[0]);
        for (const q of psi) {
          let d2 = 0;
          for (let i = 0; i < nt; i++) d2 += q[i] * Mr[i] * v[i];
          for (let i = 0; i < nt; i++) v[i] -= d2 * q[i];
        }
        let nrm = 0;
        for (let i = 0; i < nt; i++) nrm += Mr[i] * v[i] * v[i];
        nrm = Math.sqrt(Math.max(nrm, 0));
        if (!(nrm > 1e-14)) break; // this start deflated
        for (let i = 0; i < nt; i++) v[i] /= nrm;
        psi.push(v);
        const nxt = new Float64Array(nt);
        for (let i = 0; i < nt; i++) nxt[i] = Mr[i] * v[i];
        Rcur = nxt;
      }
    }
    // pad with M-orthogonalized coordinate directions when the starts
    // deflated early — a complete span keeps sum(gamma^2) = total mass
    for (let i = 0; i < nt && psi.length < p; i++) {
      const v = new Float64Array(nt);
      v[i] = 1;
      for (const q of psi) {
        let d2 = 0;
        for (let k = 0; k < nt; k++) d2 += q[k] * Mr[k] * v[k];
        for (let k = 0; k < nt; k++) v[k] -= d2 * q[k];
      }
      let nrm = 0;
      for (let k = 0; k < nt; k++) nrm += Mr[k] * v[k] * v[k];
      nrm = Math.sqrt(Math.max(nrm, 0));
      if (nrm > 1e-14) { for (let k = 0; k < nt; k++) v[k] /= nrm; psi.push(v); }
    }
    if (!psi.length) return { modes: [], mechanisms: 0 };

    // projected pair on span(psi): Kpsi = Ks*psi_k first, then the Gram sums
    const n2 = psi.length;
    const Kpsi = psi.map(v => {
      const out = new Float64Array(nt);
      for (let i = 0; i < nt; i++) {
        let s2 = 0;
        for (let k = 0; k < nt; k++) s2 += Ks[i][k] * v[k];
        out[i] = s2;
      }
      return out;
    });
    const Kt = [], Mt = [];
    for (let i = 0; i < n2; i++) {
      const kr = new Float64Array(n2), mr = new Float64Array(n2);
      for (let j = 0; j <= i; j++) {
        let a = 0, b = 0;
        for (let k = 0; k < nt; k++) {
          a += psi[i][k] * Kpsi[j][k];
          b += psi[i][k] * Mr[k] * psi[j][k];
        }
        kr[j] = a; mr[j] = b;
      }
      Kt.push(kr); Mt.push(mr);
    }
    for (let i = 0; i < n2; i++) for (let j = 0; j < i; j++) { Kt[j][i] = Kt[i][j]; Mt[j][i] = Mt[i][j]; }
    const ge = generalizedEigen(Kt, Mt);
    const values = ge.values, vectors = ge.vectors;
    if (!values || !values.length) return { modes: [], mechanisms: 1 };

    const modes = [];
    let mechanisms = 0;
    // per-direction total mass (isotropic lumped mass: same value each way)
    const mTotDir = { x: 0, y: 0, z: 0 };
    ft.forEach((d, k) => {
      if (d % 6 === 0) mTotDir.x += Mr[k];
      else if (d % 6 === 1) mTotDir.y += Mr[k];
      else if (d % 6 === 2) mTotDir.z += Mr[k];
    });
    ['x', 'y', 'z'].forEach(dd => { if (!(mTotDir[dd] > 0)) mTotDir[dd] = 1; });
    for (let i = 0; i < values.length && modes.length < nWanted; i++) {
      let omega2 = values[i] - alpha; // remove the Rayleigh shift
      if (!isFinite(omega2)) { mechanisms++; continue; }
      if (omega2 < 0) omega2 = 0;
      const f = Math.sqrt(omega2) / (2 * Math.PI);
      if (f < 0.05) { mechanisms++; continue; }
      const xt = new Float64Array(nt);
      for (let k = 0; k < n2; k++) {
        const z = vectors[i][k];
        if (!z) continue;
        for (let t = 0; t < nt; t++) xt[t] += z * psi[k][t];
      }
      const phi = new Float64Array(nDof);
      for (let k = 0; k < nt; k++) phi[ft[k]] = xt[k];
      if (nr && omega2 > 0) {
        const rhs = Krt.map(r2 => {
          let s2 = 0;
          for (let k = 0; k < nt; k++) s2 += r2[k] * phi[ft[k]];
          return Float64Array.from([s2]);
        });
        const rot = solveLDLT(Krr.map(r2 => Float64Array.from(r2)), rhs);
        for (let k = 0; k < nr; k++) phi[fr[k]] = -rot[k][0];
      }
      let mNorm = 0;
      for (let k = 0; k < nt; k++) mNorm += Mr[k] * xt[k] * xt[k];
      if (mNorm > 0) { const sc = 1 / Math.sqrt(mNorm); for (let k = 0; k < nt; k++) phi[ft[k]] *= sc; }
      // SIGNED participation factors Γ (modal force sign matters for CQC
      // cross terms) + the mass-ratio squares
      const massRatio = { x: 0, y: 0, z: 0 };
      const gammaDir = { x: 0, y: 0, z: 0 };
      const comps = [['x', 0], ['y', 1], ['z', 2]];
      for (let c = 0; c < 3; c++) {
        const key = comps[c][0], comp = comps[c][1];
        let gamma = 0;
        ft.forEach((d, k) => { if (d % 6 === comp) gamma += Mr[k] * (phi[d] || 0); });
        gammaDir[key] = gamma;
        massRatio[key] = gamma * gamma / mTotDir[key];
      }
      const omega = Math.sqrt(omega2);
      modes.push({ f: omega / (2 * Math.PI), T: omega > 0 ? 2 * Math.PI / omega : Infinity, phi, massRatio, gamma: gammaDir });
    }
    return { modes, mechanisms };
  }

  // Condensed translational system shared by the eigen and Ritz solvers:
  // Guyan-condenses the massless rotational DOFs, returns the reduced pair.
  function buildCondensedSystem(nodesIn, frames, shells, extraMass) {
    const nodes = nodesIn.map(n => ({ x: n.x * 1000, y: n.y * 1000, z: n.z * 1000, fixed: n.fixed }));
    const nNodes = nodes.length;
    const nDof = nNodes * 6;
    const K = [];
    for (let i = 0; i < nDof; i++) K.push(new Float64Array(nDof));
    for (const el of frames) {
      const a = nodes[el.ni], b = nodes[el.nj];
      const L = G.dist(a, b);
      if (L < 1e-6) continue;
      const Kl = frameK(el.E, el.A, el.Iy, el.Iz, el.J, L, el.G, el.As2, el.As3);
      const R = rotationMatrix(a, b);
      const Kg = transformFrame(Kl, R);
      const dofs = [];
      for (const ni of [el.ni, el.nj]) for (let d = 0; d < 6; d++) dofs.push(ni * 6 + d);
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) K[dofs[i]][dofs[j]] += Kg[i][j];
    }
    // shells: MASS only (see modalAnalysis for the conditioning rationale)
    const M = lumpedMass(nodes, frames, shells, extraMass);
    const ft = [], fr = [];
    for (let ni = 0; ni < nNodes; ni++) {
      const fixed = nodes[ni].fixed;
      for (let d = 0; d < 6; d++) {
        if (fixed && fixed[d]) continue;
        (d < 3 ? ft : fr).push(ni * 6 + d);
      }
    }
    if (!ft.length || !ft.some(d => M[d] > 0)) return null;
    const nt = ft.length, nr = fr.length;
    const Ktt = [], Ktr = [], Krt = [], Krr = [];
    for (let i = 0; i < nt; i++) {
      Ktt.push(Float64Array.from(ft.map(d => K[ft[i]][d])));
      if (nr) Ktr.push(Float64Array.from(fr.map(d => K[ft[i]][d])));
    }
    for (let i = 0; i < nr; i++) {
      Krt.push(Float64Array.from(ft.map(d => K[fr[i]][d])));
      Krr.push(Float64Array.from(fr.map(d => K[fr[i]][d])));
    }
    const Kc = Ktt.map(r => Float64Array.from(r));
    if (nr) {
      const W = solveLDLT(Krr.map(r => Float64Array.from(r)), Ktr.map(r => Float64Array.from(r)));
      for (let i = 0; i < nt; i++)
        for (let j = 0; j < nt; j++) {
          let s = 0;
          for (let k = 0; k < nr; k++) s += Ktr[i][k] * W[j][k];
          Kc[i][j] -= s;
        }
    }
    const Mr = ft.map(d => M[d]);
    return { nodes, nNodes, nDof, ft, fr, nt, nr, Kc, Krr, Krt, Mr };
  }

  // =========================================== frame end releases (ETABS)
  // Static condensation of released local DOFs (Assign > Frame > Releases):
  // K' = Kss - Ksr*Krr^-1*Krs in full 12-dof storage (released rows/cols
  // zeroed, epsilon diagonal against fully-released joints), and the
  // consistent member-load vector is condensed the same way so span-load
  // results stay exact on released members.
  function applyReleases(Kl, feqIn, releases) {
    if (!releases || !releases.length) return { K: Kl, feq: feqIn };
    const rel = [...new Set(releases)].filter(i => i >= 0 && i < 12).sort((a, b) => a - b);
    const kept = [];
    for (let i = 0; i < 12; i++) if (!rel.includes(i)) kept.push(i);
    const nr = rel.length, ns = kept.length;
    const sub = (rows, cols) => rows.map(r => Float64Array.from(cols.map(c => Kl[r][c])));
    const Krr = sub(rel, rel), Krs = sub(rel, kept), Ksr = sub(kept, rel), Kss = sub(kept, kept);
    // X = Krr^-1 * Krs : RHS columns of Krs = rows of Ksr
    const sols = solveLDLT(Krr.map(r => Float64Array.from(r)), Ksr.map(r => Float64Array.from(r)));
    // sols[j] (kept-length) = Krr^-1 * Krs[:,j] -> condensed:
    const Kc = Kss.map(r => Float64Array.from(r));
    for (let i = 0; i < ns; i++)
      for (let j = 0; j < ns; j++) {
        let acc = 0;
        for (let k = 0; k < nr; k++) acc += Ksr[i][k] * sols[j][k];
        Kc[i][j] -= acc;
      }
    // epsilon diagonal on released dofs (guards a joint where EVERY
    // connected element releases the same dof)
    let dmax = 0;
    for (let i = 0; i < 12; i++) dmax = Math.max(dmax, Kl[i][i]);
    const eps = 1e-9 * (dmax || 1);
    const K = [];
    for (let i = 0; i < 12; i++) K.push(new Float64Array(12));
    for (let i = 0; i < ns; i++)
      for (let j = 0; j < ns; j++) K[kept[i]][kept[j]] = Kc[i][j];
    for (const r of rel) K[r][r] = eps;
    // member-load fixed-end vector: feq' = feq_s - Ksr*Krr^-1*feq_r
    let feq = feqIn;
    if (feqIn) {
      const fr = Float64Array.from(rel.map(r => feqIn[r] || 0));
      const y = solveLDLT(Krr.map(r => Float64Array.from(r)), [fr])[0];
      const f2 = new Float64Array(12);
      for (let i = 0; i < ns; i++) {
        let acc = 0;
        for (let k = 0; k < nr; k++) acc += Ksr[i][k] * y[k];
        f2[kept[i]] = (feqIn[kept[i]] || 0) - acc;
      }
      feq = f2;
    }
    return { K, feq, released: rel };
  }

  // ============================================================ shell forces
  function shellForces(nodesIn, shells, U0) {
    const nodes = nodesIn.map(n => ({ x: n.x * 1000, y: n.y * 1000, z: n.z * 1000, fixed: n.fixed }));
    return shells.map(sh => {
      const p1 = nodes[sh.n1], p2 = nodes[sh.n2], p3 = nodes[sh.n3], p4 = nodes[sh.n4];
      if (!p4) return { ...sh, forces: null };
      const qq = shellQ4(sh.E, sh.nu, sh.t, p1, p2, p3, p4);
      if (!qq) return { ...sh, forces: null };
      const Rgg = [[qq.ex.x, qq.ex.y, qq.ex.z], [qq.ey.x, qq.ey.y, qq.ey.z], [qq.ez.x, qq.ez.y, qq.ez.z]];
      const ns2 = [sh.n1, sh.n2, sh.n3, sh.n4];
      const TT = [];
      for (let i = 0; i < 20; i++) TT.push(new Float64Array(24));
      for (let nn = 0; nn < 4; nn++) for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) TT[nn*5+c][nn*6+r] = Rgg[r][c];
        for (let c = 0; c < 2; c++) TT[nn*5+3+c][nn*6+3+r] = Rgg[r][c];
      }
      const uLoc = new Float64Array(20);
      for (let nn = 0; nn < 4; nn++) for (let lg = 0; lg < 6; lg++) {
        const gVal = U0[ns2[nn]*6 + lg];
        if (gVal === 0) continue;
        for (let ll = 0; ll < 5; ll++) {
          const tVal = TT[nn*5 + ll][nn*6 + lg];
          if (tVal !== 0) uLoc[nn*5 + ll] += tVal * gVal;
        }
      }
      const toL = p => [G.dot(G.sub(p, p1), qq.ex), G.dot(G.sub(p, p1), qq.ey)];
      const lp = [toL(p1), toL(p2), toL(p3), toL(p4)];
      const shape = (xi, et) => ({
        N: [0.25*(1-xi)*(1-et), 0.25*(1+xi)*(1-et), 0.25*(1+xi)*(1+et), 0.25*(1-xi)*(1+et)],
        dN: [[-0.25*(1-et), 0.25*(1-et), 0.25*(1+et), -0.25*(1+et)],
             [-0.25*(1-xi), -0.25*(1+xi), 0.25*(1+xi), 0.25*(1-xi)]],
      });
      const dNs = (xi, et) => {
        const d = shape(xi, et).dN;
        const J11 = d[0][0]*lp[0][0] + d[0][1]*lp[1][0] + d[0][2]*lp[2][0] + d[0][3]*lp[3][0];
        const J12 = d[0][0]*lp[0][1] + d[0][1]*lp[1][1] + d[0][2]*lp[2][1] + d[0][3]*lp[3][1];
        const J21 = d[1][0]*lp[0][0] + d[1][1]*lp[1][0] + d[1][2]*lp[2][0] + d[1][3]*lp[3][0];
        const J22 = d[1][0]*lp[0][1] + d[1][1]*lp[1][1] + d[1][2]*lp[2][1] + d[1][3]*lp[3][1];
        const det = J11*J22 - J12*J21;
        return [
          [J22/det*d[0][0] - J12/det*d[1][0], J22/det*d[0][1] - J12/det*d[1][1], J22/det*d[0][2] - J12/det*d[1][2], J22/det*d[0][3] - J12/det*d[1][3]],
          [-J21/det*d[0][0] + J11/det*d[1][0], -J21/det*d[0][1] + J11/det*d[1][1], -J21/det*d[0][2] + J11/det*d[1][2], -J21/det*d[0][3] + J11/det*d[1][3]],
        ];
      };
      const d0 = sh.E / (1 - sh.nu * sh.nu);
      const t3 = sh.t ** 3;
      const Db = [[d0*t3/12, d0*sh.nu*t3/12, 0], [d0*sh.nu*t3/12, d0*t3/12, 0], [0, 0, d0*(1-sh.nu)*t3/24]];
      const Dm = [[d0, d0*sh.nu, 0], [d0*sh.nu, d0, 0], [0, 0, d0*(1-sh.nu)/2]];
      const dnC = dNs(0, 0);
      // center shape values (SRI 1-point, same as the stiffness's shear part)
      const nC = shape(0, 0).N;
      let kxx = 0, kyy = 0, kxy = 0, nxx = 0, nyy = 0, nxy = 0;
      let gamX = 0, gamY = 0;
      for (let n = 0; n < 4; n++) {
        const o = n * 5;
        kxx += -dnC[0][n] * uLoc[o + 4];
        kyy += +dnC[1][n] * uLoc[o + 3];
        kxy += +dnC[0][n] * uLoc[o + 3] - dnC[1][n] * uLoc[o + 4];
        nxx += +dnC[0][n] * uLoc[o];
        nyy += +dnC[1][n] * uLoc[o + 1];
        nxy += +dnC[1][n] * uLoc[o] + dnC[0][n] * uLoc[o + 1];
        // transverse shear strains — identical interpolation to the
        // stiffness's Bs (γx = Σ dN/dx·w − Σ N·θy, γy = Σ dN/dy·w + Σ N·θx)
        gamX += dnC[0][n] * uLoc[o + 2] - nC[n] * uLoc[o + 4];
        gamY += dnC[1][n] * uLoc[o + 2] + nC[n] * uLoc[o + 3];
      }
      const M11 = Db[0][0] * kxx + Db[0][1] * kyy;
      const M22 = Db[1][1] * kyy + Db[1][0] * kxx;
      const M12 = Db[2][2] * kxy;
      const N11 = Dm[0][0] * nxx + Dm[0][1] * nyy;
      const N22 = Dm[1][1] * nyy + Dm[1][0] * nxx;
      const N12 = Dm[2][2] * nxy;
      const Gc = sh.E / (2 * (1 + sh.nu));
      const Q11 = Gc * sh.t * 5 / 6 * gamX; // N/mm
      const Q22 = Gc * sh.t * 5 / 6 * gamY;
      return { n1: sh.n1, n2: sh.n2, n3: sh.n3, n4: sh.n4, entId: sh.entId,
        forces: { M11, M22, M12, Q11, Q22, N11, N22, N12 } };
    });
  }

  window.FEA = { shellForces, shellQ4, assembleAndSolve, computeReactions, frameK, frameKg, consistentUDL, applyReleases, rotationMatrix, transformFrame, shellK, solveLDLT, lumpedMass, modalAnalysis, ritzModalAnalysis };
})();
