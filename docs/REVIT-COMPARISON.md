# WebSketch 3D vs. Professional BIM — Feature Comparison

An honest, working comparison against Autodesk Revit (the reference
professional BIM tool), plus where SketchUp fills the free-drawing side.
Status legend: **✅ full**, **🟡 partial** (works, with limits stated),
**🔴 not yet**.

Last updated: v0.10 tool batch.

## Modeling & elements

| Capability | Revit | WebSketch 3D | Status |
|---|---|---|---|
| Walls (straight/curved, joins, miters) | Full | Straight parametric + mitered/butt/T joins; curved via sweep→Convert (fixed) | 🟡 |
| Wall types & layers | Full | Type presets (curtain…400 mm), custom thickness, layered materials | 🟡 |
| Floors / slabs (shaped, openings) | Full | Sketch any outline; openings; regions with holes; slab-top tools | ✅ |
| Columns (sections) | Full | Parametric + design families (classical/regional/structural) | ✅ |
| Beams (Rect/T/L) | Full | Rect/T/L with flange flush to slab; continuous beam chains | ✅ |
| Foundations | Isolated/strip/combined/mat/pile | Isolated, strip, combined, two-way meshes (MNL-66) | 🟡 |
| Roofs (by extrusion/footprint) | Full | Footprint-style + slope | 🟡 |
| Stairs / railings | Component stairs | Straight/U runs with landings; handrails; ramps | 🟡 |
| Curtain walls | Full | Basic (50 mm type) | 🔴 |
| hosted doors/windows | Full families | Hosted insertions cut real openings; catalogue & BlenderKit models as families | ✅ |
| Ceilings | Full | Ceiling tool | 🟡 |
| Rooms & areas | Full | Room detection with names/numbers/departments | 🟡 |
| Free-form solids | Massing environment | SketchUp-style: push/pull, follow-me, revolve, booleans (union/subtract/trim/intersect/split/shell) | ✅ |

## Datums & project setup

| Capability | Revit | WebSketch 3D | Status |
|---|---|---|---|
| Levels | Full | Levels with elevation, plan views, level view isolation | ✅ |
| Grids | Full | Grid generation + placement, snap targets | ✅ |
| Reference planes | Full | — | 🔴 |
| Base Level "None" | Always requires a level | Free-elevation drawing (snap-following) | ✅+ |
| Georeferencing | Shared coordinates | Survey point, lat/lon, CSV import | 🟡 |

## Editing workflow

| Capability | Revit | WebSketch 3D | Status |
|---|---|---|---|
| Move / copy / rotate / array | Full | Full, with polar arrays | ✅ |
| Mirror | Full | Full | ✅ |
| **Create Similar (CS)** | Full | Context ▸ Create Similar — arms the tool with the element's type | ✅ |
| **Select All Instances** | Full | Context ▸ Select All Instances (by type + name) | ✅ |
| **Paste Aligned to Level** | Full | Edit ▸ Paste Aligned to Level — lowest point lands on the level | ✅ |
| Trim / split | Full | Trim tool, edge splits, face split | 🟡 |
| Align / pin | Full | Pin & lock (project items); no interactive Align-match | 🔴 |
| Edit-in-place (families) | Full | Edit In Place sandbox per element | 🟡 |
| Type catalogs | Full | Element Browser: category→family→type, drag-to-place | 🟡 |

## Analysis & checks

| Capability | Revit | WebSketch 3D | Status |
|---|---|---|---|
| **Interference Check** | Full | Tools ▸ Interference Check — pairwise AABB+triangle clash with witness points, click-to-select | ✅ |
| Quantity takeoff | Schedules | Exact solid clipping with join priority (overlap credited correctly) | ✅ |
| Rebar (ACI MNL-66) | Extensions | Whole-cage generation, 137-book-drawing cross-check, X-ray | ✅+ |
| Structural analysis | Analysis tab | Analytical model overlay + CSV | 🟡 |
| Energy/solar analysis | Full | Sun settings + shadows (no analysis) | 🔴 |

## Documentation

| Capability | Revit | WebSketch 3D | Status |
|---|---|---|---|
| Views (plans/sections) | Full | Plans per level, section planes, camera views | 🟡 |
| Sheets & printing | Full | Print Sheet dialog | 🟡 |
| Dimensions / tags / text | Full (annotation families) | Linear/angular/radial dims, tags, spot elevations, text notes, revision clouds | 🟡 |
| **Sun & shadows** | Full | View ▸ Sun Settings (azimuth/altitude/intensity) | ✅ |
| PNG capture | Full | Snapshot | ✅ |

## Interoperability

| Format | Status | Notes |
|---|---|---|
| glTF export | ✅ | Per-face PBR colors; Blender/Unreal/Twinmotion |
| IFC export | ✅ | Entities + hierarchy |
| **DXF export** | ✅ | R12 LINEs on category layers, m/cm/mm — plan handoff to AutoCAD |
| IFC import | 🟡 | As elements or reference |
| .blend open | 🟡 | Via bridge |
| Save/open (JSON) | ✅ | Human-readable model format |

## Where WebSketch is ahead of a pure Revit flow

1. **One model, two paradigms** — free SketchUp-style modeling and
   parametric BIM over the SAME solids, switchable at any moment.
2. **Draw-from-anything inference** — start any shape from a line/face at
   its real height; the base level can be "None" and follow your cursor.
3. **Swept solids become elements** — Follow Me bodies are claimed as
   first-class elements with full instance data (no massing round-trip).
4. **Runs in a browser file** — no install, no license server; a desktop
   exe ships for offline use.
5. **Verified reinforcement** — MNL-66 cages cross-checked against the
   manual's own 137 drawings.

## Prioritized gaps (the roadmap)

1. Curtain wall systems, reference planes, interactive Align (match lines).
2. Component stairs (winders), shaped-edit foundations (mat/pile caps).
3. Annotation families & graphic schedules (tables on sheets).
4. Worksharing (multi-user), design options.
5. Energy analysis hooks (gbXML export).
