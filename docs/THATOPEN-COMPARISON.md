# WebSketch 3D vs ThatOpen's engine — architecture comparison & adoption plan

Source studied: https://thatopen.com/bim-software-open-source/ →
`ThatOpen/engine_components` (cloned to `../thatopen-components`), plus the
`@thatopen/fragments` engine architecture as evidenced by its consumption in
that repo (the fragments package itself is a dependency; its design is
documented in detail in `packages/core/src/core/FastModelPicker` and the
fragments components).

---

## The philosophical difference in one paragraph

ThatOpen is built for **viewing and querying huge, mostly-static IFC models**
(millions of items, read-only after import). Everything is designed around
that: binary pre-baked geometry, worker-side data, GPU picking, per-item
state without re-batching. WebSketch is an **editor**: a live B-Rep kernel
that mutates constantly, where every face can be created, split, pushed or
deleted at any time. The right move is not to copy their architecture — it's
to steal the specific techniques that work for both, and skip the ones that
assume read-only geometry.

## Side by side

| Concern | ThatOpen | WebSketch 3D today | Verdict |
|---|---|---|---|
| Geometry storage | FlatBuffers + pako, typed arrays, representation-id dedup, per-instance transforms | Live JS B-Rep (`Map` of faces/edges/vertices) + serialize to JSON | Ours must stay live; adopt typed-array *outputs* (below) |
| Rendering | Tiles: merged multi-item meshes, per-item = `geometry.groups` + material array; LOD line meshes; edge detection postprocess | Per-element `THREE.Group` + mesh (with `triangleFace` map), merged free-face mesh, on-demand `_tick` | Our per-element meshes = their tiles, roughly; on-demand loop already matches theirs |
| Picking | GPU ID-buffer: per-vertex item id attribute, scissored 4×4px offscreen pass, 1 `readPixels`; depth/normal passes for point+normal | CPU `raycaster.intersectObjects` over element groups | **Their approach strictly better at scale; cheap to add** |
| Visibility/hiding | Rewrite `geometry.groups` index ranges (worker-side) — hide also unpicks | Element group `.visible` / layer filters | Equivalent cost at our scale |
| Highlight/selection | Extra material slots on the same mesh; zero-copy proxy geometries aliasing the source buffers | Separate selection overlay geometries (`selFaces`, `selOutline`, hover) | Ours costs a second buffer set; theirs is free |
| Raycast acceleration | `three-mesh-bvh` prototype-patched globally (`Mesh.prototype.raycast`) | None | **One-liner to adopt** |
| Snapping | Per-item cached `{faces, edges, vertices}`, 1mm vertex quantization, canonical-pair edge dedup, LRU | `SnapSystem` with `_snapCache` | Adopt quantization + dedup ideas |
| Heavy compute | Everything (queries, visibility, data) is async worker RPC; model store itself lives in a worker | Kernel on main thread; only autosave stringify is off-thread (our recent fix) | Adopt incrementally (see plan) |
| Data queries | Regex queries over FlatBuffer in worker; results = integer Set algebra (`join/intersect/remove`) | `bim.entities.filter(...)` per query | Adopt Set-algebra pattern; worker later |
| Streaming | Geometry tiles first, item data deferred & fetched per query, LRU eviction | Autosave to localStorage; everything in memory | Not our bottleneck; revisit for huge models |
| Editability | Weak — format is read/edit-through-recode | Our strength (live B-Rep, push/pull, hosted cuts) | — |

## What to adopt, ranked by value-to-effort for WebSketch

### 1. GPU ID-buffer picking (their `FastModelPicker`) — high value, medium effort
Our CPU raycast walks triangle intersections over every element mesh on every
click and drag-hover. Their approach: bake a per-vertex face-id attribute into
each element mesh at build time (we already rebuild these buffers on
`rebuild()`); on pick, render just the element meshes with a tiny id-encoding
`ShaderMaterial` into a small render target **scissored to 4×4 px around the
cursor** — one `readPixels(1×1)`. Also gives world point (depth pass) and
normal (normal pass) for free, which our tools need anyway. Pairs perfectly
with our on-demand renderer (a pick is just another render). Reference:
`packages/core/src/core/FastModelPicker/src/fast-model-picker.ts`
(id packing `:15-31`, scissor `:578-612` incl. the DPR gotcha).

### 2. `three-mesh-bvh` global patch — high value, trivial effort
Two lines, exactly as they do it in `Components/index.ts:195-202`:
```js
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.LineSegments.prototype.raycast = acceleratedRaycast;
```
Accelerates every remaining CPU raycast (edges, helper geometry, ghosts) and
our `findBlockingFace`-style loops that raycast. Dispose `boundsTree` with
geometry (their `Disposer`).

### 3. Per-item state via `geometry.groups` + material arrays — medium value, medium effort
We already keep per-element meshes — the win is inside each element: give
every B-Rep face a contiguous index range in the element mesh, then
hide/show = group membership, highlight = append a highlight material and set
that face's group `materialIndex` — **no second overlay buffer set**
(`selFaces`/`selOutline` could eventually go). Reference:
`fast-model-picker.ts:442-460` explains the exact contract.

### 4. Snap cache: 1mm quantization + canonical edge dedup + LRU — medium value, low effort
Our `SnapSystem` caches per-model; theirs caches per-item with vertices
quantized to a 1mm grid (`VERTEX_QUANT = 1000`) so triangulation-seam
duplicates collapse, edges deduped via sorted `(min,max)` pairs, LRU 1000.
Directly portable to `js/SnapSystem.js`. Reference:
`packages/core/src/core/SnapResolver/src/snap-resolver.ts:59-132`.

### 5. Query Set-algebra (`ModelIdMap`) — low value now, grows with features
Category/storey filtering as integer `Set` `join/intersect/remove` instead of
array filters; matters when Element Browser grows. Reference:
`packages/core/src/utils/model-id-map.ts`.

### 6. Worker-side kernel RPC (their `FragmentsModels` pattern) — the long game
This is the same destination as our Rust/WASM track: keep only meshes on the
main thread; expose `query/raycast/rebuild` as async RPC over typed arrays.
Their serialization stack (FlatBuffers + pako) is exactly what our
`rust/` crate should emit: a compact binary snapshot instead of JSON.
Don't build this now — build it *when* the Rust kernel ports exist, so the
worker boundary and the WASM boundary are the same boundary.

### Explicitly NOT adopting
- **Streaming/LOD tile system** — solves million-element viewing we don't have.
- **Edge-detection postprocessing** — our explicit B-Rep edge lines are an
  editor feature (selectable, snappable), not just visuals.
- **Read-only fragments format as the primary store** — our live B-Rep is the
  product; but fragments-style binary output is a natural future **export**
  format (fast reload of saved models).
- **polygonOffsetFactor = random()** z-fighting trick — our ELEMENT_EPS is
  principled and tested; random offsets would break our coplanar logic.

## Sequencing (fits the existing perf plan)

1. `three-mesh-bvh` patch (this week, ~30 min incl. disposal wiring)
2. GPU picker (after 1; removes the CPU raycast cost we just profiled)
3. Snap quantization/dedup (with the picker's normal pass available)
4. groups/material-array per-face state (when next touching BimElement)
5. Rust/WASM kernel + worker RPC + binary snapshot (already milestone-planned;
   ThatOpen validates the architecture and supplies the reference patterns)
