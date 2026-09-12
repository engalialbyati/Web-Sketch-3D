//! WebSketch 3D — geometry kernel hot paths (Rust/WASM).
//!
//! First port: `planar_cycles`, the half-edge planar-subdivision trace from
//! `js/model.js` (`splitFaceArrangement`): builds per-vertex angular adjacency,
//! walks minimal closed loops via the DCEL successor rule, and keeps the
//! positively-oriented (CCW) cells. Runs on every face partition — i.e. on
//! every wall/column/slab/beam interaction in a BIM build.

use wasm_bindgen::prelude::*;

const TWO_PI: f64 = std::f64::consts::TAU;

/// Extract positively-oriented minimal loops from a planar edge graph.
///
/// * `px`, `py` — vertex coordinates (2D projection of the face plane)
/// * `edges`    — flat pairs of vertex indices [a0, b0, a1, b1, ...]
///
/// Returns a flat `Vec<u32>`: `[len, v0, v1, ..., len, v0, v1, ...]` —
/// each loop prefixed with its vertex count.
#[wasm_bindgen]
pub fn planar_cycles(px: &[f64], py: &[f64], edges: &[u32]) -> Vec<u32> {
    let n = px.len().min(py.len());
    // adjacency: (neighbor, angle) sorted CCW per vertex
    let mut adj: Vec<Vec<(u32, f64)>> = vec![Vec::new(); n];
    for chunk in edges.chunks_exact(2) {
        let (a, b) = (chunk[0] as usize, chunk[1] as usize);
        if a >= n || b == a || b >= n {
            continue;
        }
        adj[a].push((b as u32, (py[b] - py[a]).atan2(px[b] - px[a])));
        adj[b].push((a as u32, (py[a] - py[b]).atan2(px[a] - px[b])));
    }
    for list in adj.iter_mut() {
        list.sort_by(|x, y| x.1.partial_cmp(&y.1).unwrap_or(std::cmp::Ordering::Equal));
    }

    // DCEL successor: neighbor of `to` coming next after (to -> from) in
    // CLOCKWISE order (full-circle sweep so degree-2 corners are reachable).
    let next = |from: usize, to: usize| -> Option<usize> {
        let list = &adj[to];
        if list.is_empty() {
            return None;
        }
        let rev = (py[from] - py[to]).atan2(px[from] - px[to]);
        let mut best: Option<(usize, f64)> = None;
        for &(other, angle) in list {
            if other as usize == from {
                continue;
            }
            let mut d = rev - angle;
            while d <= 1e-12 {
                d += TWO_PI; // sweep (0, 2π]
            }
            if d > TWO_PI - 1e-9 {
                d -= TWO_PI;
            }
            if best.is_none() || d < best.unwrap().1 {
                best = Some((other as usize, d));
            }
        }
        best.map(|(w, _)| w)
    };

    let m = edges.len() / 2;
    // visited directed edges as pairs packed into u64
    let mut visited = std::collections::HashSet::<u64>::with_capacity(2 * m);
    let mut out = Vec::new();

    for chunk in edges.chunks_exact(2) {
        let (a, b) = (chunk[0], chunk[1]);
        for &(s, t) in &[(a, b), (b, a)] {
            let (s, t) = (s as usize, t as usize);
            if visited.contains(&(key(s, t))) {
                continue;
            }
            let mut loop_v: Vec<u32> = vec![s as u32];
            let mut cur = s;
            let mut nxt = t;
            let mut ok = true;
            while nxt != s {
                visited.insert(key(cur, nxt));
                loop_v.push(nxt as u32);
                let w = match next(cur, nxt) {
                    Some(w) => w,
                    None => {
                        ok = false;
                        break;
                    }
                };
                if loop_v.len() > 2 * m + 4 {
                    ok = false;
                    break;
                }
                cur = nxt;
                nxt = w;
            }
            if ok && loop_v.len() >= 3 {
                visited.insert(key(cur, s));
                // pinched walk (repeated vertex) is not a cell
                let mut seen = std::collections::HashSet::with_capacity(loop_v.len());
                if loop_v.iter().all(|v| seen.insert(*v)) {
                    // signed shoelace area: positive => CCW cell
                    let mut area = 0.0;
                    for i in 0..loop_v.len() {
                        let j = (i + 1) % loop_v.len();
                        let (xi, yi) = (px[loop_v[i] as usize], py[loop_v[i] as usize]);
                        let (xj, yj) = (px[loop_v[j] as usize], py[loop_v[j] as usize]);
                        area += xi * yj - xj * yi;
                    }
                    if area > 2e-7 {
                        out.push(loop_v.len() as u32);
                        out.extend_from_slice(&loop_v);
                    }
                }
            }
        }
    }
    out
}

#[inline]
fn key(a: usize, b: usize) -> u64 {
    (a as u64) << 32 | b as u64
}

/// Sanity check export used by the bench page: count loops found.
#[wasm_bindgen]
pub fn planar_cycles_count(px: &[f64], py: &[f64], edges: &[u32]) -> u32 {
    let out = planar_cycles(px, py, edges);
    let mut n = 0;
    let mut i = 0;
    while i < out.len() {
        n += 1;
        i += 1 + out[i] as usize;
    }
    n
}
