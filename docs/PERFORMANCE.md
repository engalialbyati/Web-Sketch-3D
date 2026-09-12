# Performance Work — Freeze Fixes & the Rust/WASM Track

This document explains the main-thread freeze fixes shipped in commit `55c96b1`
(and follow-ups), what changed, and why. It also describes the Rust/WASM
kernel track that follows the same strategy.

The analysis that drove this work came from studying **OpenCADStudio**
(https://github.com/HakanSeven12/OpenCADStudio) — a Rust + wgpu CAD app with a
WASM web build that stays responsive on large models. The relevant lessons:

| OpenCADStudio design | What it means for a JS app |
|---|---|
| On-demand rendering (frame ticks only while animating) | WebSketch already does this (`_tick` / `rebuild()` gate in `js/render.js`) — not a bottleneck |
| One Web Worker for the single heaviest job (file parse); everything else made cheap by caching, not threading | Move the *one* worst main-thread job off-thread; don't thread everything |
| Epoch + per-entity delta caches; full rebuild is the fallback, not the default | Partial invalidation beats full rebuilds |
| Delta-based undo with caps; history destruction off-thread | Snapshot undo is the next big cost to attack |
| Serialization off the hot path (thread/worker) | `JSON.stringify` on the main thread is the classic freeze |

The freezes were **not GPU/renderer problems**. They were synchronous,
main-thread work around the renderer. Each fix below targets one.

---

## Fix 1 — Autosave stringify moved to a Web Worker

**Where:** `js/app.js` (`_saveAutosave` / `_saveAutosaveNow`) +
new `js/autosaveWorker.js`.

**Before:**
```js
localStorage.setItem('websketch3d', JSON.stringify(this.model.serialize()));
```
`JSON.stringify` of a whole building model is one of the most expensive
synchronous operations a web page can do, and it ran on the main thread
600 ms after **every edit and every undo/redo**.

**After:** the main thread calls `this.model.serialize()` (cheap — it builds
plain arrays/objects) and posts the snapshot to a worker. The worker does the
expensive `JSON.stringify` and posts the string back; only then does the main
thread do `localStorage.setItem` with the pre-built string (workers have no
`localStorage` access, and `setItem` of an existing string is fast compared to
stringifying).

Details:
- **Coalescing:** if the worker is still busy when a newer autosave fires,
  the new snapshot is parked in `_asPending` and only the *latest* one is
  stringified when the worker frees up — rapid edits never queue stale work.
- **Fallback:** if `Worker` construction fails (exotic CSP, ancient runtime),
  the old inline path runs unchanged.
- **Restore path untouched:** `_restoreAutosave` reads the same
  `localStorage` key in the same JSON format — nothing about the persisted
  format changed.

**Why this is safe:** `serialize()` output is plain JSON-able data (it was
already fed to `JSON.stringify`), so the structured clone used by
`postMessage` carries it losslessly.

## Fix 2 — `structuredClone` instead of `JSON.parse(JSON.stringify(...))`

**Where:** `js/app.js` transaction guard (scratch-model validation) and the
BIM param-definitions deep clone; `js/model.js` already used this pattern for
its internal clone helper.

**Before:** deep copies round-tripped through JSON — a full serialize **plus**
a full parse, allocating twice the model size in strings, on the main thread,
inside the transaction guard that runs at commit time.

**After:** `structuredClone` (with a JSON fallback for ancient runtimes) —
typically 2–5× faster and no intermediate string garbage. The transaction
guard's scratch validation and the entity-params clone no longer double-
serialize the model.

## Fix 3 — Undo/redo: paint the viewport first, refresh panels when idle

**Where:** `js/app.js` `undo()` / `redo()` / new `_deferUI()`.

**Before:** undo ran `view.rebuild()` and then synchronously refreshed
levels, grids, the layer panel, entity info, groups, and the edit box in one
burst — all before the next frame.

**After:** `view.rebuild()` still runs immediately (the 3D view is the point
of undo), but every panel/DOM refresh moved into `requestIdleCallback`
(`setTimeout(30)` fallback). The rebuilt viewport paints first; the chrome
catches up a beat later. This is the same philosophy as OpenCADStudio's
opt-in frame subscriptions: never spend the frame budget on work the user
isn't looking at.

---

## What was intentionally NOT changed (yet)

- **`view.rebuild()` cost itself** — full-model rebuild on undo is still
  O(model). The proper fix is OpenCADStudio-style dirty-flags/epoch caching
  (re-tessellate only changed entities). The per-face triangulation cache
  already mitigates it; a delta journal is the next structural step.
- **`syncElementsToDb()`** — already interleaves its per-entity work with
  IndexedDB awaits, so the event loop gets yields between entities. If
  profiling still shows stutters, per-entity serialization can move into the
  worker too.
- **Undo snapshots** still serialize the full model at commit time; the
  snapshot *clone* got cheaper (Fix 2) but true delta-undo is future work.
- **Raycasting** (`intersectObjects` over the whole scene during drags) —
  candidate for a BVH or GPU picking later.

---

## The Rust/WASM track (`rust/`)

Strategy: port the geometry kernel's hot paths to Rust, compile to WASM with
`wasm-bindgen`, call them from the existing JS app — keep 100% of the UI.
Rendering stays WebGL/Three.js (it was never the bottleneck).

First port: **`planar_cycles`** (`rust/src/lib.rs`) — the half-edge planar
subdivision trace from `js/model.js` `splitFaceArrangement`. It builds
per-vertex angular adjacency, walks minimal closed loops with the DCEL
successor rule, and returns positively-oriented cells. This runs on **every
face partition** — every wall/column/slab/beam interaction in a BIM build.

- `rust/bench/bench.html` benchmarks the Rust version against a faithful JS
  mirror of the original algorithm on synthetic N×N grid graphs, verifying
  both find the identical (N−1)² cells before timing.
- Build: `cd rust && wasm-pack build --target web` (output in `rust/pkg/`,
  git-ignored; `index.html` picks it up via the bench page / future wiring).

## Environment (post-reformat machine setup)

Installed and verified end-to-end (a throwaway wasm-bindgen crate was
compiled with `wasm-pack build --target web` including `wasm-opt`):

- Git 2.55, Node.js 24 LTS / npm 11
- Rust 1.98 stable-msvc (VS Build Tools 2022 + C++ workload provides `link.exe`)
- `wasm32-unknown-unknown` target, `wasm-pack` 0.15

## Verification

- Full test suite after every fix: **334 passed, 0 failed** (`npm test`).
- Live browser check: app boots, worker is wired (`app._asWorker`), and an
  autosave cycle writes through the worker path to `localStorage`.
