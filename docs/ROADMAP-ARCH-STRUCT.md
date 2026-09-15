# WebSketch 3D — Architecture & Structure Roadmap
### The goal: a free Revit for architects and structural engineers — nothing else

Source: the *Comprehensive BIM Element Taxonomy* document (project root), filtered to the
two disciplines this app serves. Everything MEP, HVAC, piping, electrical, fire protection,
civil/bridges/rail, 4D construction logistics, and thermal/energy analysis is **deliberately
out of scope** — this is not a TODO list, it is a boundary.

Legend: ✅ shipped · 🔶 partial / in progress · ⬜ to build · effort **S** (< a session) ·
**M** (a few sessions) · **L** (multi-session)

---

## Where we are today (v0.7.1)

**Foundation (✅):** custom B-Rep kernel (extrude/sweep/loft/revolve/follow-me, owner-cut
openings), transactions + undo, parametric element registry, ribbon UI with tabs, layers
with linetype/lineweight, line properties inspector, families catalog + element browser,
scripted elements, BlenderKit assets, polylines, dynamic input, mirror/array/scale.

**Architecture elements (✅):** walls (joined, mitred, hosted doors/windows/openings),
floors/slabs (with openings), roofs (flat/mono/gable), stairs (straight/U), handrails.

**Structural elements (✅):** columns (families incl. drop panels), beams (rect/T/L with
framing trims), pad footings + pedestals, level-based bearing rules (v0.7).

**Datums (✅):** levels, grids (straight + curved, intersections, grid-place).

**IFC (🔶):** import phase 1 (reference meshes) + phase 2 (schema-driven elements:
storeys, walls, slabs, columns, beams, footings; grids/curtain-walls/fills in progress).
No export yet.

---

## Phase 1 — IFC round-trip & georeference  *(interoperability first)*

The importer exists; without an exporter the app can consume Revit models but never
return one. This is the single highest-leverage phase.

| # | Feature | Effort | Notes |
|---|---------|-------|-------|
| 1.1 | ✅ **IFC4 STEP writer** — IfcProject/Site/Building/Storey + IfcWall, IfcSlab, IfcColumn, IfcBeam, IfcRoof, IfcStair, IfcRailing | M | Shipped: parametric extrusions, hosted openings via IfcRelVoidsElement/FillsElement, B-Rep fallbacks for complex solids. Verified round-trip: demo building (85 walls/60 columns/85 beams/21 doors/50 windows) exports and re-imports 100% as elements, model validates |
| 1.2 | ✅ Project base point, survey point, true/project north | S | Edit ▸ Georeferencing… dialog; model.geo survives save/load; north-arrow indicator; IfcProjectedCRS + IfcMapConversion on export; IfcMapConversion read back on import (verified round-trip: 500000E 4649776N 15° EPSG:32633) |
| 1.3 | ✅ IfcSpace export | S | Shipped with Phase 2 rooms — verified round-trip |
| 1.4 | ✅ Finish the in-flight import work (grids, curtain walls, door/window fills) | S | Done by the IFC agent (committed) |

---

## Phase 2 — Rooms, areas & schedules  *(IfcSpace tier)*

The biggest architectural gap. Rooms unlock tags, area takeoff, color-fill plans, and
later the analytical surface tier.

| # | Feature | Effort | Notes |
|---|---------|-------|-------|
| 2.1 | ✅ Room tool — click inside a wall-enclosed region on a level → room object with boundary tracking | M | Planar segment arrangement over wall centerlines (crossings + T-junctions split, DCEL face walk); live hover preview of the enclosing ring with area |
| 2.2 | ✅ Room properties — name, number, department, area (read-only), perimeter | S | Text-kind param fields in the entity panel; edits recolor the fill plate |
| 2.3 | ✅ Color-fill plans — paint rooms by name/department parameter | S | Pastel palette hash; plate at level + 2 mm |
| 2.4 | ✅ Area schedules — table of rooms with export (CSV) | M | Room schedule section in Schedules (excluded from the structural takeoff); element schedules already existed |
| 2.5 | 🔶 Zones — group rooms (fire compartments, apartments) | S | `zone` text param carried + scheduled; dedicated zone objects (colored overlays, totals) still open |

---

## Phase 3 — Annotation & drawing production

Revit's daily value is drawings, not 3D. This phase makes the app produce them.
Built on a new annotation-entity layer: persistent, selectable, world-anchored.

| # | Feature | Effort | Notes |
|---|---------|-------|-------|
| 3.1 | ⬜ Annotation entity framework — stored in the model, serialized, undoable, level-lockable | M | The substrate for everything below |
| 3.2 | ⬜ Aligned + linear dimensions between references (walls, grids, vertices), tracking geometry edits | M | The hard part is stable references; vertex/element ids survive most edits today |
| 3.3 | ⬜ Tags by category (door/window/room/wall) with leaders; Tag All Untagged | S | Reads entity params — registry is ready |
| 3.4 | ⬜ Text notes with leaders, find & replace | S | |
| 3.5 | ⬜ Spot elevations/coordinates | S | Trivial once 3.1 exists |
| 3.6 | ⬜ Angular, radial, arc-length dimensions | M | Guide-arc math already exists (polar guides) |
| 3.7 | ⬜ Section/elevation markers → saved clipped views (2D projection of the model along a cut plane) | L | The "view system lite" — no sheets yet |
| 3.8 | ⬜ Detail components, filled/masking regions, revision clouds | M | Linetypes/regions groundwork done |
| 3.9 | ⬜ Drawing sheets — arrange views on titled sheets, print/PDF | L | Optional finale of this phase |

---

## Phase 4 — Architecture completion

| # | Feature | Effort | Notes |
|---|---------|-------|-------|
| 4.1 | ⬜ Compound walls — layered material stacks (core/insulation/finish) with priority-based corner joins | L | The taxonomy's compound-wall tier; joins are the algorithm to get right |
| 4.2 | ⬜ Curtain walls — UV grid → mullions (IfcMember) + panels (IfcPlate) | M | Import-side bounds logic (WIP) inverts into authoring |
| 4.3 | ⬜ Ceilings (IfcCovering) — suspended grids | M | |
| 4.4 | ⬜ Ramps (IfcRamp) | S | Stairs infra generalizes |
| 4.5 | ⬜ Wall sweeps & reveals (hosted profile sweeps: cornices, baseboards) | M | Extrude-along-path exists; hosting + mitering is the work |
| 4.6 | ⬜ Spiral & winder stair runs | M | |
| 4.7 | ⬜ Elevators/escalators (IfcTransportElement) — shaft + car as parametric families | M | Optional; asset-based first pass is cheaper |
| 4.8 | ⬜ Site-lite: property lines, simple TIN topography import + building pads | L | Only what an architect needs for context |

---

## Phase 5 — Structure completion

| # | Feature | Effort | Notes |
|---|---------|-------|-------|
| 5.1 | ⬜ Analytical model — decoupled 1D centerlines + nodes (per the taxonomy's multi-representation rule), member end releases | M | Beams/columns already carry centerlines; add the analytical rep + toggle view |
| 5.2 | ⬜ Structural export — IFC structural entities or analysis-neutral format (for Robot/ETABS pipelines) | M | |
| 5.3 | ⬜ Strip & mat foundations, piles + pile caps | M | Footing entity generalizes |
| 5.4 | ⬜ Bracing + trusses (assemblies from the beam engine) | M | Scripted-elements can seed parametric truss types |
| 5.5 | ⬜ Base plates, gussets, bolt groups | M | Fabrication detail — after 5.1/5.2 |
| 5.6 | ⬜ Rebar — area reinforcement on slabs/walls, bar sets with hooks, IfcReinforcingBar export | L | The last big structural block; needs its own sub-roadmap |
| 5.7 | ⬜ Precast pieces (hollow-core, spandrels) | L | Optional, market-dependent |

---

## Cross-cutting engineering tracks (run alongside phases)

- **Multi-representation elements** (from the taxonomy): params (have) + B-Rep (have) +
  LOD/bounding rep (⬜ — keeps hospital-scale imports interactive) + analytical centerline (Phase 5.1).
- **Constraint/dimension solver** — locked dimensions driving geometry (Revit's family
  engine heart). Long-term; annotation (3.2) is the stepping stone.
- **Performance**: keep the Rust/WASM track alive for kernel hot paths as models grow.

---

## Explicitly out of scope (do not build)

MEP in every form (ducts, pipes, cable trays, fixtures, plant equipment, fire
protection), electrical distribution, BMS/sensors, civil linear infrastructure
(alignments/corridors/bridges/rail/tunnels), 4D construction logistics (scaffolding,
cranes, formwork), thermal/energy/daylight analysis, and CFD. If a workflow needs those,
the answer is IFC round-trip to a discipline tool — which is exactly why Phase 1 comes first.

---

## Suggested order of attack

1 → 2 → 3 is the spine (interoperate, then rooms, then drawings). Phases 4 and 5 can then
interleave by demand — 4.1 compound walls and 5.1 analytical model are the two most
requested items to pull forward when users ask.
