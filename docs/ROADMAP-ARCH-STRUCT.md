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
| 3.1 | ✅ Annotation entity framework — stored in the model, serialized, undoable | M | model.annotations records rendered on the HUD layer; never building fabric |
| 3.2 | ✅ Aligned + linear dimensions between references, tracking geometry edits | M | vertex/wallEnd refs re-resolve while the host lives; dead refs freeze at the stored point |
| 3.3 | ✅ Tags by category with leaders; Tag All Untagged | S | Live templates (rename a room, its tag updates); 268 elements tagged in one click on the demo |
| 3.4 | ✅ Text notes with leaders, find & replace | S | Leader when anchored to geometry; Edit ▸ Find & Replace Notes… |
| 3.5 | ✅ Spot elevations/coordinates | S | Absolute elevation too when the georeference base point is set |
| 3.6 | ✅ Angular, radial dimensions | M | Vertex + two rays → arc-swept angle; circle/arc pick → R dimension. Arc-length rides the arc metadata (deferred) |
| 3.7 | ✅ Section/elevation markers → saved clipped views | L | Section tool draws a cut line → camera perpendicular + WebGL clip plane opens the model; Elevation tool saves horizontal views; File ▸ Sections & Views… lists/opens/deletes; Camera ▸ Exit Section View restores |
| 3.8 | ✅ Filled/masking regions, revision clouds | M | HUD polygon regions with hatch fill; scalloped cloud rings. Detail components (2D families) deferred to the asset pipeline |
| 3.9 | ✅ Print Sheet (current view + title block → browser Print/PDF) | L | File ▸ Print Sheet… composes the live view with a title block (date, base point, sheet no) in a print-ready window. Multi-view sheet layout deferred |

---

## Phase 4 — Architecture completion

| # | Feature | Effort | Notes |
|---|---------|-------|-------|
| 4.1 | 🔶 Compound walls — layer data + IfcMaterialLayerSet export + panel editing | L | params.layers on walls: text field "name:t, name:t" in the panel, exported as IfcMaterialLayerSet/Usage. Geometric layer splitting + priority joins deferred |
| 4.2 | ✅ Curtain walls — generator | M | Two clicks → mullion grid (columns) + glass wall panels along the run; VCB sets panel width/height |
| 4.3 | ✅ Ceilings — region-detected plates at level − drop | M | Click inside an enclosed region; VCB "drop" sets the height |
| 4.4 | ✅ Ramps — sloped slab from level with typed rise | S | Two clicks + VCB "rise" / "rise,width" |
| 4.5 | ✅ Wall sweeps (cornices/baseboards) — hosted profile boxes | M | Click a wall; VCB "height,offset". Reveals (subtractions) deferred |
| 4.6 | ⬜ Spiral & winder stair runs | M | Deferred — the stairs feature covers straight/U today |
| 4.7 | ⬜ Elevators/escalators | M | Deferred — shaft = walls + slab; a scripted element can cover it |
| 4.8 | 🔶 Site-lite: property lines | L | File ▸ Property Lines… table → closed boundary + area entity. TIN/pads deferred |

---

## Phase 5 — Structure completion

| # | Feature | Effort | Notes |
|---|---------|-------|-------|
| 5.1 | ✅ Analytical model — derived 1D centerlines + viewport overlay | M | View ▸ Analytical Model derives members live from the registry (columns red, beams purple, braces orange, walls grey) and draws them |
| 5.2 | ✅ Analytical CSV export — nodes + members | M | File ▸ Export Analytical CSV… (welded node list + member table, analysis-neutral) |
| 5.3 | 🔶 Strip foundations | M | Insert ▸ Strip Footing: click a wall, VCB "width x thickness". Mat = a thick floor slab (existing); piles/caps deferred |
| 5.4 | ✅ Bracing + truss generator | M | Brace tool (two snapped 3D points → diagonal beam); File ▸ Truss Generator (span/height/bays → chords + zig-zag webs) |
| 5.5 | 🔶 Base plates | M | Insert ▸ Base Plate: click a column; VCB "size x thickness". Gussets/bolts deferred |
| 5.6 | ⬜ Rebar | L | Deferred — needs its own sub-roadmap |
| 5.7 | ⬜ Precast | L | Deferred |

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
