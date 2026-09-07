# WebSketch 3D vs Autodesk Revit — Gap Analysis & Roadmap
**Prepared as: Senior Structural / Architectural Engineer · Date: 2026-09-07 · App version: v0.1**

---

## 1. Executive Summary

WebSketch 3D already implements the **parametric modeling core** of Revit: levels, grid
systems, hosted walls/doors/windows, floors/slabs, columns and beams with joins,
clearance trimming and quantity precedence — over a custom B-Rep kernel with 251
passing tests. That is the hard 30%, and it works.

The gaps are concentrated in three areas:
1. **Documentation** — Revit's #1 pillar (views, annotation, schedules, sheets) is
   almost entirely absent.
2. **Performance at building scale** — a 5-story framing test hit a hard wall at
   ~1,000 faces (split cascades + per-element full rebuilds).
3. **Exchange** — no IFC. An architect or engineer cannot move work in or out.

The single highest-leverage move: **fix the scale/perf wall and add schedules** —
both unlock real project use with modest effort. Everything else is sequenced below.

---

## 2. Where the app already matches Revit (keep & polish)

| Capability | Status |
|---|---|
| Parametric walls (miter/butt joins, location line, hosted cuts) | ✅ matches |
| Floors/slabs with sketch validation + column punching | ✅ matches |
| Columns (base/top levels + offsets, 28 families, drop panels) | ✅ matches |
| Beams (Rect/T/L, clearance trimming of infill walls) | ✅ matches |
| Hosted doors/windows (reveal cuts, arrays by count+spacing) | ✅ matches |
| Levels + named grid systems (ETABS quick setup, per-level visibility) | ✅ matches |
| Grid intersection snapping ("A-1") + parametric reattachment | ✅ matches |
| Relational catalog (Category→Family→Type, IndexedDB) | ✅ matches |
| Quantities engine (priority takeoff, net/gross) | ✅ engine only — **no UI** |
| Edit In Place, snapshot undo, transaction guard | ✅ matches |
| Scripted elements (Fire Stair + Railing shipped) | ✅ (Revit has no direct equal) |
| Asset pipeline (BlenderKit GLB/blend), layers | ✅ beyond Revit's scope |

Sources: [Autodesk Revit overview](https://www.autodesk.com/products/revit/overview),
[Revit for Structural Engineering](https://www.autodesk.com/products/revit/structural),
[Revit 2026 what's new](https://help.autodesk.com/view/RVT/2026/ENU/?guid=GUID-C81929D7-02CB-4BF7-A637-9B98EC9EB38B).

---

## 3. Bug register (from the 5-story QA test)

| # | Severity | Finding |
|---|---|---|
| B1 | **High (data loss)** | An interrupted transaction (page error mid-placement) corrupts the undo stack: the next transaction silently rolls it back and a later **undo lost 2 committed beams + ~2,000 faces**. Repro: kill a placement mid-transaction, then run another edit, then undo. |
| B2 | **High (scale)** | Split-cascade explosion: 17 beams through 20 columns → **2,548 faces** (~143/beam). Per-element transactions each trigger a full-model rebuild; batches time out past ~1,000 faces. Single-transaction batching (Grid Place pattern) placed 31 beams in 2.0 s — the kernel is fine, the **per-op rebuild schedule** is the bottleneck. |
| B3 | Medium | **File ▸ New does not clear datum state** — grids and extra levels from the previous project survive; duplicate level names (same or different elevations) are accepted with no warning. Revit refuses duplicate level names. |
| B4 | Low | Hosted door/window and scripted-stair placement could not be exercised through API replication during this test pass (harness limitation, not proven app bugs) — they need a **dedicated end-to-end GUI regression script** (recommended P0). |
| B5 | Known (README v1 limits) | Offset fails on arc loops; no boolean union; push into separate solids overlaps; holed-region extrusion leaves open prism sides; shared-mesh splits can drop BIM stamps where walls merge. |

---

## 4. Gap analysis & prioritized roadmap

### P0 — Correctness + completion of what exists (do first)
| Item | Why | Effort |
|---|---|---|
| **Object-Mode selection in BIM** (owner proposal, Blender-style): Precise Drawing selects whole elements only — raycast against the per-element Groups (`BimElement` meshes already carry `elementId`), never the merged mesh or edge list. Free Drawing stays the face/edge/vertex "edit mode"; Edit In Place is the sanctioned sub-element path (Revit's exact contract) | Revit-faithful UX **and** kills the O(all faces+edges) hover/pick scans — `pickEdgeAt` iterates every model edge per mouse move today | **S — do this first** |
| **Per-element (dirty-only) rebuilds** (consequence of the object model): a changed entity rebuilds only its own Group; drop the merged-mesh pass and full-model edge loop for element-owned geometry. This *is* the "versioned/incremental rebuild" from ARCHITECTURE.md, scoped by element | Renders stop paying whole-model cost per edit | M |
| Fix B1 (transaction interruption discipline) | Data loss is trust loss | M |
| Fix B2 (kernel half): batched transactions as the default placement path + **spatial-hash broad phase** for the split/intersection search (a new element asks only nearby buckets, not all faces). Note: the object-mode work above fixes picking/rendering, NOT the split cascade — beams through columns still generate ~140 faces each | Unblocks dense multi-story frames | M–L |
| Fix B3: File ▸ New clears grids/levels; refuse duplicate level names | Project hygiene | S |
| **Schedules UI** — surface the existing `quantityReport()`/`elementQuantities()` as door/window/wall/material tables (db join already exists) | Cheapest big win; Revit's most-used deliverable | M |
| **Foundation placement tool** — builder + db types already exist, only the tool/UI is missing | Completes the structural set | S–M |
| Linear/radial array tool; mirror/flip | Basic editing parity | M |
| GUI regression script (5-story model, replayable) | Protects all of the above | M |

### P1 — Documentation, Revit's #1 pillar (currently ~absent)
| Item | Why | Effort |
|---|---|---|
| Real per-level plan views (promote Level View isolation into a saved view list) | Every Revit deliverable starts here | M |
| Sections & elevations (clip planes on the existing renderer) | Core documentation | M–L |
| Persistent annotation: dimensions, tags, text (today only ephemeral overlays) | Drawings without annotation aren't drawings | L |
| Sheets/titleblocks | Printing/export deliverable | L |

### P2 — Interoperability
| Item | Why | Effort |
|---|---|---|
| **IFC import via web-ifc** (IfcWall/Slab/Column/Grid/Storey map 1:1 onto existing managers; discussed in-session) | The single most-requested exchange for real Revit projects | L |
| STEP via opencascade.js | Only if mechanical CAD matters | L |
| (Export side already: glTF 2.0, PNG, JSON) | — | — |

### P3 — Missing element types
| Item | Notes | Effort |
|---|---|---|
| Native stairs (promote the script) | Stair-by-run with code checks: **2R+T ≈ 635 mm (IBC) / tread ≥ 210–250 mm, riser ≤ 190 mm (EN)** | M |
| Native railings; roofs (pitched/flat by footprint); sloped floors | — | M each |
| Curtain walls / storefront | Biggest visible arch gap | L |
| Rooms/spaces with automatic area computation | Feeds schedules + area plans | M |
| Ceilings, shafts | Later | M |

### P4 — Structural professional tier (only after P0–P3)
Analytical model + loads/boundary conditions (Revit 2026/2027's headline structural
features), rebar, steel connections, analysis round-trip (Robot/ETABS via IFC).
**Worksharing, phasing, design options: explicitly out of scope** for a solo web app.

---

## 5. Five-story QA test report (appendix)

**Setup**: 5 levels @ 3.2 m; grid 6+6+6+4.5 × 5+5+7 m (9 lines, 20 intersections).
**Placed**: 20 full-height columns (L1→L5, gridRef-snapped) in 39 ms; 15+2 beams
(Rect + T) on lift 1; 1 structural slab (25 mm… 250 mm) over full footprint with
column punching; 1 perimeter wall. **DB mirror verified**: 37 element rows —
Column 20, Structural Framing 15, Slab 1, Wall 1 + 9 grid rows; correct
Category→Family→Type resolution.

**Where it stopped**: walls 2–5 and upper lifts — per-element rebuilds exceeded
interactive budgets past ~1,000 faces (B2). Hosted doors/windows + Fire Stair script
were not API-replicable in this pass (B4); their GUI flows are covered by unit tests
and prior manual sessions.

**Perf measurements**: columns 20×/39 ms; beams 17×/~4 min (per-element tx) vs
31×/2.0 s (single tx batch) — the batching fix is proven, it needs to become the
default placement path.

---

## Addendum — the two-half performance picture (post-object-mode proposal)

B2 decomposes into two independent halves with different fixes:

1. **Pick/render half** (hover/select scans, full-model re-triangulation per
   commit) — solved by the P0 object-mode + per-element rebuild items. The
   per-element Groups already exist in `BimElement.js`; the change is routing
   BIM-mode selection through them and rebuilding only dirty entities.
2. **Kernel half** (split cascade: interpenetrating elements split into ~140
   faces each, intersection search scans the whole model) — unaffected by the
   mode split; needs spatial-hash broad phase + batched transactions.

The 5-story wall lifts only when BOTH halves are done.

---

*Delivered as planning only — no features were implemented for this document.*
