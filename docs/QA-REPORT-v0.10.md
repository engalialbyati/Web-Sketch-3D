# WebSketch 3D — QA Report: Complex Villa Test Cycle

**Tester:** automated QA agent (Autodesk-style test pass)
**Build:** v0.10 tool batch (post-`63ab331`)
**Method:** the villa was drawn by driving the app's real event pipeline
(synthetic pointer events through the actual tool handlers at computed
screen coordinates) — not by calling the kernel directly. Every stage was
asserted (wall counts, face counts, `validate()`, entity registration),
and every failure was reproduced, diagnosed and either fixed or logged.

## Scope exercised

1. Wall tool: 12+ wall segments by clicking across three storeys
   (main block 16×10, left wing, right wing, L2/L3 upper floors)
2. Wall selection → temporary dimension → pencil → typed length edit
3. Split Wall, Align, Reference Plane tools on the live model
4. Rebuild from Parameters on a 34-wall hosted-opening model
5. BlenderKit asset import → define as door/window → hosted placement
6. Materials: 7 named materials across 265 faces
7. Deletion of a wall crossing the entire model (stress case)

## Defects found & fixed during this cycle

| ID | Severity | Defect | Fix |
|---|---|---|---|
| DEF-01 | High | Esc after drawing left the Wall tool armed — the next selection click silently started another wall (stray 27 m diagonal observed) | Esc with nothing in progress returns to Select (Revit post-draw state) |
| DEF-02 | Critical | `setVertex` crashed (`_vhAdd` on an invalidated hash) when stretching a wall after reopening a model — the length edit silently failed | `_vhAdd` guards the null hash; next `vertexAt` rebuilds lazily |
| DEF-03 | Critical | Rebuild from Parameters rebuilt walls through the plan-trim splitter, orphaning hosted windows/doors (24 windows vanished visually, entities ghosted empty) | Hosted walls rebuild via `rebuildWallWithHosts` (re-extrude + re-cut + re-register); spans splitter kept for structural trims only |
| DEF-04 | High | Rebuild's `adopt()` claimed every unstamped face in the model — free-drawn geometry swallowed into elements (orphan-face source) | Adoption scoped to faces born during that entity's rebuild (before-set) |
| DEF-05 | Medium | On-edge tracking pulled wall clicks toward edges on other floors of a dense model | Parametric tools only snap to edges within ±1 m of the drawing plane, tighter pixel radius |
| DEF-06 | High | Deleting a wall that crossed the entire model (auto-intersected into faces it crossed) left self-loop edges and torn faces — no user-facing repair existed | New **Edit ▸ Audit & Repair Model**: iterated tear detection (ring pairs, vertex revisits, self-loops) + parametric wall rebuild until stable |

## Verified working (no defects)

- Wall tool click drawing, chain continuation, Ctrl snap override
- Temporary dimension display + typed length edit (exact, openings re-cut)
- Floor sketch mode + commit; Split Wall with hover preview; Align; Reference Plane
- BlenderKit search → GLB download → define as Door/Window → hosted placement (openings re-cut, model links the GLB)
- Materials: registry + world-space texture mapping across element faces
- Rebuild from Parameters (after DEF-03/04): 34 walls, 24 windows, 1 door — all preserved, 0 orphan faces, model valid

## Known limitations (not defects)

1. Floor sketch mode locks the camera to plan — an isometric sketch aid is roadmap
2. Deleting a wall that crosses other faces requires Audit & Repair afterwards (heal is manual-by-command, not automatic)
3. Background/hidden browser panes throttle rAF — automation against a hidden pane sees stale frames (environment, not the app)

## Regression coverage added

`revitools.test.js` (rebuild w/ hosted window, free-face protection),
`edgesel.test.js` (+2), `alignbatch.test.js` (5), `villa.test.js` (builder
validity), `draw.test.js` (fillet suite), `linestyle.test.js` (sweep bend
suite) — **640 tests green** at cycle end.
