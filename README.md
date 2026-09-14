# WebSketch 3D — a SketchUp-style 3D modeler for the browser (and desktop)

[![release](https://img.shields.io/badge/release-v0.7.0%20%22First%20Working%20Product%22-blue)](https://github.com/engalialbyati/Web-Sketch-3D/releases/tag/v0.7.0)
[![tests](https://img.shields.io/badge/tests-350%20passing-brightgreen)]() 
[![no build step](https://img.shields.io/badge/runtime-pure%20static%20files-blue)]()
[![license](https://img.shields.io/badge/license-MIT-lightgrey)]()

A SketchUp-like drawing application built with Three.js and a custom edge/face
solid modeler, plus a Revit-style **Precise Drawing** (parametric BIM) mode:
walls, floors, doors/windows, structural columns/beams/slabs with level
datums, dynamic infill-wall clearance, quantity takeoff, and glTF export for
rendering engines (Twinmotion/Unreal/Blender). Runs 100% locally — no build
step, no server required. **The Revit method is the default**: the app boots
into Precise Drawing (your last chosen mode is remembered).

It also grows past the built-ins: **Scripted Elements** turn pasted code from
any AI into parametric element types (the app ships the contract template —
your AI writes the element, the app renders its parameters as editable
inputs), a **BlenderKit palette** drops free models into the scene (GLB
imports need no Blender; downloaded doors/windows cut real wall openings),
and AutoCAD-style **layers**, column design **families**, and datum **grids**
round out the drafting workflow. The kernel is indexed (edge-pair lookup,
incremental weld hashing, memoized AABBs) so interactive drags stay smooth as
models grow.

![WebSketch 3D — house model](docs/screenshot.png)

### v0.7 — First Working Product

v0.7 is the first end-user release, shipped as a Windows installer plus the
web build. The headline additions:

- **Desktop app**: `WebSketch3D-Setup-0.7.0.exe` on the
  [release page](https://github.com/engalialbyati/Web-Sketch-3D/releases/tag/v0.7.0) —
  a signed-free NSIS installer (choose folder, Desktop/Start-Menu shortcuts)
  wrapping the full app in an Electron window with the same
  localStorage/IndexedDB persistence as the web build.
- **Ribbon UI**: tab-based ribbon (Draw / Model / Insert / Annotate / View /
  Manage) with titled tool panels; tools auto-switch their engine mode.
- **True polylines (AutoCAD semantics)**: the Line/Polyline tool chains
  segments as ONE entity — click any segment to select the whole chain — and
  **Join Edges into Polyline** welds gaps (≤2 cm), fuses collinear runs, and
  chains separately drawn lines into one polyline.
- **Drawing in 3D**: Z-axis lines work from the very first segment (cursor-ray
  axis math; on-screen axis-lock chip + an **axis button in the input bar**),
  `V` flips rectangles/arcs onto vertical planes (arc endpoints stay locked —
  the plane rotates through the chord), and arcs can be typed end-to-end via
  dynamic input (chord Length/Angle, then Radius/Sweep °).
- **AutoCAD osnap markers everywhere**: green endpoint squares, midpoint
  triangles, center circles — on hover with any tool, over every kind of
  geometry (lines, polylines, rects, arcs, circles, element edges).
- **Edge extrude (right-click ▸ Extrude Edge…)**: sweep lines/curves into
  ribbon faces along the curve's own plane normal (Newell), the edge's
  in-plane slope, the local out-of-plane perpendicular, the span direction
  (vaults), a world axis, or **toward the mouse** (live preview, click to
  commit). Open paths sweep with clamped end tangents — squared-off caps,
  no sliver faces.
- **Convert Faces/Edge to Element**: pick a name and kind (or a custom type) —
  the drawn geometry becomes a *fixed* element (no parametric dims), its type
  lands in the Element Browser and is reused by name on later conversions.
- **Safer deletes**: deleting a selected edge never cascade-deletes the faces
  it borders (a clear message points to the Eraser for deliberate
  dissolution); free lines survive parametric rebuilds.

### v0.6 — Element Independence (the IFC contract)

v0.6 rebuilds the engine contract around how real BIM tools work (IFC,
Bonsai, Revit): **every element is a geometric island**. Elements never
punch, split, or weld each other — where one bears on another (wall under a
beam, column under a beam, drop head under a slab) the support reaches
`ELEMENT_EPS` (0.1 mm) INTO the supported element: solid joints at any
zoom, no z-fighting, no reveal gaps.

- **No cross-element cutting**: a column in a wall, a beam through a column,
  a column through a slab — all simply overlap. Connections are
  relationships, not booleans (exactly IFC's `IfcRelConnects` philosophy).
- **Bearing rules (real-life stacking)**: beams hang from their level
  `[L−h, L]`; **v0.7: columns run continuously through the beam zone to
  their top constraint** (the joint cube is the column's — beams stop at
  its faces; v0.6 capped columns at the beam soffit, which left a void at
  every joint); slabs top at their level; walls run to the governing
  soffit.
- **Performance**: the independence gate also makes builds linear — the
  5-story demo builds **6× faster**, and Rebuild-from-Parameters is now
  staged (progress in the status bar, the UI never freezes) with a
  100×-faster orphan sweep.
- **Closed loops of element edges no longer auto-create faces** — face
  auto-creation belongs to free-drawn lines only.

### The 5-story demo building

**File ▸ Load 5-Story Building** constructs a full RC apartment block through
the app's own tool API — 292 elements: foundations, 60 columns, 85 beams,
70 walls (floor-to-beam-soffit), slabs with hosted stair-shaft openings,
doors/windows cut into their hosts, and IBC-compliant dog-leg stairs.
Full gallery + project write-up: **[docs/portfolio](docs/portfolio/README.md)**.

**File ▸ Load Revit Test Building (Grids)** is the Element-Browser pathway
test: 7 real grid lines (A-D × 1-3) with all 60 columns grid-attached (drag a
grid in plan and its columns re-center), levels created through the Level
Manager, pad footings, the full beam grid, column-punched slabs, a flat roof,
and **six rooms per floor** (partition + dividers) with 21 doors and 50
windows — 325 live parametric elements in one click.

| | |
|---|---|
| ![Hero isometric](docs/portfolio/01-hero-iso.png) | ![Front elevation](docs/portfolio/02-front-elevation.png) |
| ![Corner detail](docs/portfolio/03-corner-detail.png) | ![Entity Info](docs/portfolio/04-ui-element-info.png) |
| ![Plan view](docs/portfolio/05-plan-view.png) | ![Stair cutaway](docs/portfolio/06-stair-cutaway.png) |

> Deep dive: **[Architecture & Drawing Engine](docs/ARCHITECTURE.md)** —
> layering, the B-Rep kernel, healing/push-pull flowcharts, the parametric
> BIM layer, structural rules, rendering and export pipelines (Mermaid
> diagrams).

> **AI authoring:** models can be *written* as JSON, not just saved —
> **[docs/AI-AUTHORING.md](docs/AI-AUTHORING.md)** is a complete spec
> (element types, parameters, placement rules, a verified example) made to be
> pasted to an AI so it can generate a whole building as a
> `.websketch.json` you open with File ▸ Open.

## Run it

- **Windows installer (recommended)**: grab
  `WebSketch3D-Setup-0.7.0.exe` from the
  [v0.7.0 release](https://github.com/engalialbyati/Web-Sketch-3D/releases/tag/v0.7.0)
  — installs a desktop app with Start-Menu/Desktop shortcuts.
- **From source**: double-click `index.html` (works from `file://`), **or**
- Serve it: `py -m http.server 8742` → open http://127.0.0.1:8742
- **Desktop build from source**: `npm install && npm run desktop`
  (dev window), `npm run dist` (rebuild the installer).

## Optional: BlenderKit asset library (local bridge)

The toolbar's **BlenderKit Assets** palette searches BlenderKit's free model
library and drops models into the scene as real geometry. BlenderKit serves
native `.blend` files, which browsers cannot parse, so the feature needs the
small local bridge:

```sh
npm install            # express + cors (the only dependencies in the repo)
npm run bridge         # http://localhost:3001
```

- **No Blender needed for most assets.** Most BlenderKit models also publish
  a ready-made glTF; the bridge downloads it directly (cards carry a blue
  **GLB** badge, amber **blend** = needs Blender). With no Blender installed
  the palette notices via `/api/health`, turns on the **GLB only** filter,
  and blend-only cards are disabled instead of failing after a big download.
- Only blend-only assets need [Blender](https://www.blender.org/) on the
  machine (or set `BLENDER_PATH`) for the `blender -b` → glTF conversion;
  the palette opens without the bridge but will say so.
- Downloaded/converted `.glb` files are cached in `cache/` — once per asset.
- Models land at the cursor's ground point (origin if the cursor never
  entered the viewport), are normalized to ≤ 5 m, cast/receive shadows, and
  live beside the B-Rep model as foreign Three.js groups (registered in
  `BlenderKitBrowser.assets`; not part of undo/autosave).
- Env knobs: `PORT`, `BLENDER_PATH`, `BLENDER_TIMEOUT_MS`.

## Implemented tools (the SketchUp core 10 + extras)

| Tool | Shortcut | Notes |
|---|---|---|
| Select | Space | click / window / crossing select, Shift adds, double-click selects face border |
| Line | L | chaining; click any existing endpoint (green square) to continue an old line; closing a loop of lines creates a face; live `[x, y, z]` readout; arrow-key axis locks work from the FIRST segment (Z included — a chip in the viewport shows the lock); dynamic input (Length/Angle + the axis button); exact length via VCB |
| Polyline | — | the Line tool's chained mode under its own name: every segment of a drawing session is ONE polyline entity — click any segment to select the whole chain; extrude/convert/offset treat it end to end |
| Rectangle | R | on ground or any face; `V` after the first corner flips the plane vertical (3D rects); exact `w,h` via VCB; drawn inside a face punches it out; drawn ACROSS a face edge it splits the face and extends beyond it |
| Circle | C | radius + sides (`r,s` or `24s` via VCB); `V` flips the plane vertical; center + cursor coordinates shown while drawing |
| Polygon | — | like circle, default 6 sides |
| Arc | A | start–end–bulge with **dynamic input**: type the chord (Length/Angle), then Radius or Sweep °; `V` flips the plane vertical THROUGH the chord (start/end stay locked in world space); placed points carry endpoint-square markers; exact radius or bulge via VCB |
| Push/Pull | P | drag or click-move-click; exact distance; double-click repeats; re-push extends walls; collapse to 0; SketchUp merge semantics — pushing a shape drawn on a face **outward merges** with the host solid (shared walls extend, no twin quads), **inward carves a recess**, and pushing **through** punches a clean hole in the far face. Inward drags **snap to the far face** (hover it or near its depth) for an exact through-punch; pushing **past** it tunnels through and continues as a capped protrusion |
| Offset | F | faces and circles; inward ring becomes a face with a hole |
| Resize Wall | W | Revit-style: click a wall, the distance to the opposite wall is shown; type a new size (e.g. `4`) or `+1`/`-0.5`; connected walls stretch |
| Move | M | auto-selects; Ctrl = copy; axis locks; exact distance |
| Rotate | Q | protractor on face normal or ground; exact angle |
| Scale | S | corner = uniform, face = 2-axis, edge = 1-axis grips; exact factor |
| Paint Bucket | B | materials tray; Alt+click samples |
| Eraser | E | click or drag; arcs/circles erase as one; erasing heals coplanar faces |
| Tape Measure | T | distance readout |
| Orbit / Pan / Zoom | O / H / Z | middle-drag orbits anywhere; Shift+middle pans; wheel zooms |

Plus: measurements box (VCB) with m/cm/mm/km/ft/in parsing, inference engine
(endpoints, midpoints, centers, on-face, axis alignment — with the snap kind and
world coordinates displayed next to the cursor while drawing), undo/redo (100 steps),
cut/copy/paste, hide/unhide, reverse faces, select all, delete, context menu,
Entity Info (area/length), face styles (Shaded/Monochrome/Wireframe/X-Ray),
shadows, fog, grid/axes toggles, perspective/parallel projection, 7 standard
views, zoom extents, PNG export, save/open `.json` models, autosave/restore
via localStorage.

Lines drawn on a face stay visible (faces render with a polygon offset, so
coincident edges always win the depth test). A closed shape drawn on a face
connects to it like SketchUp: fully inside it punches a hole; **straddling an
edge it splits the face** into the remainder, the covered region (push/pull
that), and the outside tab — each sharing real boundary edges. This also works
on faces that were already pushed (e.g. the top of an extrusion) and on faces
that already have holes: each existing hole ends up fully on one side of the
cut — with the covered region, the remainder, or, for a shape drawn *around*
an existing hole, on the newly drawn face itself (the old hole's cap is
consumed). Push/pull then merges outward, carves inward, or punches through,
as described above.

## Groups, solids & thickness

- **Group**: select geometry → `Ctrl+G` (or Edit ▸ Group / right-click) → name it.
  Clicking any part selects the whole group; move/rotate/scale/paint act on it
  as one object. **Double-click to edit inside** (orange dashed box, Esc exits);
  new geometry drawn inside joins the group. The Groups tray lists them all.
- **Make Full (solid)**: select a group whose faces form a watertight shell →
  Entity Info shows *Watertight* + a **Make Full** button → the group becomes a
  solid with its computed volume (✓ Solid — volume X m³, like SketchUp's solid
  groups). Open shells report their open-edge count instead.
- **Give Thickness**: select any faces (one face, 4 walls, or a whole box) →
  Entity Info ▸ *Give Thickness…* (or Edit ▸ Give Thickness / right-click).
  Offsets a copy along the normals with proper mitered corners and stitches the
  boundary into a watertight solid — a floor becomes a slab, a box becomes a
  hollow-shelled solid. Live preview, flip-direction toggle, exact value.

## Resize Wall (Revit-style dimension editing)

Press **W** (or right-click a wall ▸ Resize Wall), hover a wall: a purple
dimension line to the opposite wall shows the current room size. Click the
wall, then:

- **type an exact size** — e.g. a 4×3 room, click a wall on the 3 m side, type
  `4` + Enter → the room becomes 4×4, walls/floor/ceiling stretch to follow
- **type a delta** — `+1` grows that dimension by 1 m, `-0.5` shrinks it
- **drag** the wall with live dimension readout
- **Esc** cancels mid-drag; Ctrl+Z undoes a committed resize

Works on rooms made of a pushed rectangle, 4 individually drawn wall faces, or
walls thickened together — only the selected wall's own slab moves (the band
between the face you clicked and the wall's far skin, found as the nearest
parallel overlapping face), the perpendicular walls stretch (mitered corners
stay joined), and geometry that merely crosses the wall — or sits beyond it —
stays put. The dimension reference is the parallel face with the largest
footprint overlap across the room, so a small stub or cylinder facet inside
the room can't hijack the measurement. A skinless selection (a lone face)
moves just that face's plane.

## Architecture (v0.7)

Layered strictly downward — UI never touches raw model state:

1. **UI shell** — `index.html` + `js/app.js` (menus, mode switching, the
   ribbon, selection, inference, transactions, clipboard, autosave, the DB
   mirror) and the palette modules `js/ui-cad.js` (options bars / dynamic
   input), `ui-browser.js` (Element Browser), `ui-layers.js` (layers),
   `ui-families.js` (column families), `ui-schedules.js` (schedules).
2. **Ribbon** — `RIBBON_TABS` (app.js): tab-based tool layout
   (Draw / Model / Insert / Annotate / View / Manage); each tool declares
   which engine mode it lives in and picking it auto-switches modes. Tools
   self-register through the **feature registry** (`js/engine/api.js`):
   `Engine.features.register({ id, kind, tool, icon, commands, mode })` —
   features in `js/features/*` (column, beam, foundation, roof, stairs,
   handrail, grid placement, measure-area, demos…) load like plugins and
   grow the ribbon, the toolbar, and the command bar automatically.
3. **Tools** — `js/tools/` with a shared lifecycle contract (`base.js`):
   `free.js` (direct modeling, incl. polyline chaining + dynamic input),
   `bim.js` (parametric elements + Convert), `draw.js` (the shared
   2D-primitive sketch engine), `assets.js`, `script.js`; `registry.js`
   combines them into the flat id→class map.
4. **Element layer** — `js/BimElement.js` (entity→Group rendering,
   incremental dirty-signature rebuilds, catalog mapping),
   `js/StructuralManager.js` (pure structural families + datum rules),
   `js/edit-inplace.js` (isolation sandbox), `js/SnapSystem.js`
   (inference candidates), `js/GridManager.js` / `GridLine.js` (datums),
   `js/db.js` (IndexedDB relational store), `js/families.js` /
   `families-loader.js` / `columnFamilies.js` (design catalog),
   `js/script-elements.js` (AI-pasted parametric types),
   `js/export-gltf.js`, `js/assets.js` + `BlenderKitBrowser.js`,
   `js/autosaveWorker.js` (off-thread persistence).
5. **Kernel & viewport** — `js/model.js` (the B-Rep solid modeler) and
   `js/render.js` (Three.js viewport with on-demand rendering, per-face
   triangulation cache, merged element Groups + edge batches, HUD osnap
   glyphs).

## Files

- `index.html` — UI shell (menus, mode tabs, toolbar, tray, status bar)
- `css/style.css` — light theme + ribbon, dialogs, palettes, osnap glyphs
- `electron/main.js` — desktop wrapper: zero-dependency localhost static
  server + BrowserWindow (localStorage/IndexedDB parity with the web build)
- `js/lib/` — Three.js r128 + loaders (local copies, offline-friendly)
- `js/geometry.js` — vector/plane math, offsets, triangulation helpers
- `js/model.js` — the solid modeler: edges/faces/curves, auto-facing, face
  splitting and healing, push/pull with capping + collapse, serialization,
  and `validate()` (BREP invariant audit). Three welding invariants keep
  adjacent geometry connected: vertices within 1e-4 m share one id (spatial
  hash), points drawn on an edge split it (and new edges chain through
  existing vertices — no T-junctions in either direction), and push/pull
  reuses base-ring vertex ids with no coincident twin faces
- `js/render.js` — Three.js viewport: sky, ground, axes, face shader
  (backface tinting, fog, x-ray/mono), shadows, overlays, picking; the single
  coordinate boundary — public API `clientToWorldRay` /
  `clientToCanvasPixels` / `worldToScreenPixels` (raw `ev.clientX/Y` never
  escapes past `Viewport.eventPt`)
- `js/tools/base.js` — the Tool lifecycle contract (`activate deactivate
  cleanup onDown onMove onUp onKey onVCB dynSpec/dynApply/dynCommit status`)
  + shared helpers
- `js/tools/free.js` — the SketchUp-style direct-modeling tools, including
  the polyline-chaining Line tool and the local-normal Extrude Curve tool
  (namespace `FreeTools`)
- `js/tools/bim.js` — Revit-style parametric tools (namespace `BimTools`),
  including Convert Faces/Edge to Element (fixed named types)
- `js/tools/registry.js` — combines the namespaces into the flat tool map
- `js/engine/api.js` — the feature registry tools and features plug into
- `js/features/` — feature plugins (structural elements, stairs, roofs,
  grid placement, demos, …)
- `js/db.js` — the persistent relational store: Categories / Families / Types /
  Elements tables over IndexedDB (in-memory adapter elsewhere, so the CRUD
  layer runs headless in `test/db.test.js`)
- `js/BimElement.js` — the element architecture: one parametric entity = one
  unified Three.js `Group`, sub-element measurement queries, and the
  entity ➔ Category➔Family➔Type catalog mapping with dynamic type creation
- `js/edit-inplace.js` — the in-place Edit Mode sandbox
- `js/StructuralManager.js` — pure structural families + datum/takeoff rules
- `js/SnapSystem.js` — inference candidates (endpoints, midpoints, centers)
- `test/` — Node unit tests (`npm test`; no DOM needed — the harness loads
  geometry.js + model.js into a `vm` sandbox)

## BIM hierarchy: database, elements, Edit In Place

Precise Drawing is backed by a Revit-style hierarchy as the primary mode:

- **Relational database** (`js/db.js`, IndexedDB): `Categories` (Wall, Floor,
  Slab, Window, Door, Foundation, Column) ➔ `Families` ("Basic Wall",
  "Fixed Glass Window", …) ➔ `Types` (with `default_parameters` JSON:
  thickness, default height, material) ➔ `Elements` (type + level +
  transform + instance `parameters` JSON + `brep_data` — vertices, edges,
  face loops, roles — plus computed quantities: area, volume, bounding box).
  Every commit mirrors the live model into the Elements table (detached or
  deleted elements drop their rows), unknown wall/window sizes grow the
  catalog as dynamic types, and `queryElementsByCategory()` is a real
  three-hop join through the indexes.
- **Elements as one object** (`js/BimElement.js`): each entity renders as a
  unified `Group`; clicking any face selects the WHOLE element and the
  Entity Info tray shows Category/Family/Type (a working type selector —
  switching a wall type rebuilds its geometry), instance parameters, and
  quantities. Holding **Ctrl** (or **Tab**) while hovering raycasts down to
  individual faces (planar area, m²) and edges (3D length, m) — a pure
  measurement query that never detaches the container.
- **Edit In Place** (double-click an element, Edit ▸ Edit In Place…, the
  inspector button, or the context menu): everything else hides — the B-Rep
  kernel skips hidden geometry in every operation, so the Free tools
  (Push/Pull with automatic face intersections, Edge Trim, …) edit exactly
  the isolated mesh. A top banner offers **✓ Finish** (validate, re-adopt
  every touched/new face into the element, regenerate the mesh, refresh
  bbox/quantities, commit the updated B-Rep to the database, push ONE undo
  step, return to Precise Drawing) and **✕ Cancel** (snapshot restore; Esc).
  Undo inside the session re-isolates automatically.
- **Element Browser** (`js/ui-browser.js`, toolbar button): an
  AutoCAD-style palette with the Category ➔ Family ➔ Type tree and live
  element counts. Drag it anywhere (floating), drop it near a viewport edge
  to dock left/right, collapse or hide it. Drag a type into the 3D viewport
  to arm its placement tool with the type pre-loaded — "Generic — 200 mm"
  activates the Wall tool at 200 mm; a window type activates the Window tool
  at its width/height/sill. Expanding a type lists its placed elements;
  clicking one selects it in the model.

## Contextual 2D Draw palette (Revit)

Precise Drawing shares one **DrawPrimitiveEngine** (`js/tools/draw.js`) across
the Draw / Wall / Floor tools: click a primitive chip on the options bar and
every sketching tool accepts the same input methods. Pure geometry lives in
`DrawGeom` (unit-tested in `test/draw.test.js`); the engine owns clicks,
previews, dimension badges, chaining, and the VCB.

- **Primitives**: Line (click-click), Rectangle (corner-diagonal), Polygon
  (side count N + Inscribed/Circumscribed, center-drag sets radius+rotation),
  Circle (center-drag or typed radius), Arc by start-end-bulge, Arc by
  center-start-sweep, Fillet (two intersecting lines + radius — tangent arc
  inserted, both lines trimmed at the tangent points), and Pick Lines (hover
  any model edge or level datum; click converts it to path segments).
- **Modifiers**: Location Line (Centerline / Finish Face Exterior / Interior)
  offsets the wall band ±t/2 along the in-plane normal; Chain continues from
  the previous endpoint (Esc cancels the in-progress segment, the next Esc
  breaks the chain without exiting, a third exits); a numeric **Offset**
  shifts every committed path parallel (mitered corners).
- **Listening dimensions**: floating length badges track each segment in
  screen space, an angular badge appears when a segment is off-axis, and
  typing a number feeds the VCB — Enter clamps the live segment to that exact
  length (or radius / angle / `w,h` for rectangles).
- Walls extrude open paths into offset bands (arcs included) and closed
  sketches into location-line-grown footprints; Floors accept closed
  primitives directly or accumulate chained lines/arcs until the boundary
  closes (Esc finishes a 3+ point boundary).

## Bidirectional Free <-> Precise interop

BIM walls stay parametric under Free-mode editing, and the editing contract is
explicit (the Revit method):

- **Push/Pull on a wall's top face** never breaks the solid: the push is
  routed to `bimEntityManager.syncWallHeight` — the top ring moves to the new
  elevation and `params.height` updates; the entity, its faces, and their
  role stamps all survive (the live badge reads "x.xx m wall height").
- **Edit Boundary (floors & roofs)**: select a slab or roof and hit
  **✏ Edit Boundary** — its saved sketch re-opens (outer boundary + openings,
  re-seated on the level's CURRENT plane; automatic column punches are
  re-cut fresh, never sketch lines), and a re-commit regenerates the SAME
  element: walls under it re-trim, columns re-punch their footprints.
- **Instance parameters in Entity Info**: walls (height, thickness, location
  line), columns (width, depth, height, rotation°), beams (web width,
  height), floors (thickness), doors/windows (width, height, sill) — every
  edit writes the param and regenerates the element from it.
- **The no-detach guard**: any other freeform edit (Push/Pull, Trim, Eraser)
  on a BIM element's faces is REFUSED with a pointer to the parametric path
  ("edit its values in Entity Info, or use Edit In Place"). Free geometry is
  untouched; soften (Ctrl+erase) stays allowed; Edit In Place suspends the
  guard for its session. Elements no longer silently lose their parametric
  identity to a stray click.
- **Shape handles**: selecting a wall in Select mode shows a listening
  length dimension plus blue triangular handles at the baseline's start,
  midpoint, and end. Click the badge and type a new length (Enter stretches
  the wall along its baseline); drag an endpoint to stretch/rotate, drag the
  midpoint to translate — all edits move the wall's own vertices
  parametrically (`stretchWall`), so the entity and its stamps stay intact.

## Sketch Mode (Edit Boundary) & Free-to-BIM conversion

Activating **Floor** enters Revit-style Sketch Mode: the model ghosts, the
selection locks out, level reference planes stay visible, and every Draw
primitive accumulates magenta (`#d946ef`) boundary lines on the Base Level
plane. The options bar grows a green **✓ Commit** and red **✗ Cancel**.

- **Validation** (`SketchValidator`, unit-tested): endpoints weld on a 1 mm
  grid — dangling ends fail "Lines must be in closed loops", proper crossings
  fail "Lines cannot intersect", and the failing vertex is highlighted with an
  orange marker and banner while sketching continues. Loops fully contained in
  an outer loop become **openings** (stair shafts); disjoint loops become
  separate slab regions.
- **Commit** tessellates each region (outer + holes) through the model's
  B-Rep, extrudes **downward** by the slab thickness, registers a `slab`
  entity with role stamps, exits sketch mode, and commits the transaction —
  Esc with nothing pending discards.
- **Convert to BIM** (Precise ▸ Convert tool): click any closed Free Drawing
  face — *To Slab* extrudes it down 0.25 m and registers a `slab`; *To Wall*
  extrudes it along its normal up to the Top Constraint and registers a
  `wall`. Already-stamped faces are refused (edit those parametrically
  instead).

## Hosted insertions (Doors, Windows, Wall Openings)

The Door / Window / Wall Opening tools place elements **only on host walls**:
hovering empty space shows a "Click on a host wall" indicator; over a wall the
preview snaps to the baseline, orients with the wall direction, and shows live
distances from the opening center to **both** wall ends. VCB `w,h[,sill]`
resizes before placing (doors 0.9x2.1 sill 0, windows 1.2x1.5 sill 0.9).

Placement stores the host linkage (`hostWallId`, `distanceFromStart`,
`sillHeight`, `width`, `height`) and cuts the wall with exact volume: both
wall faces holed (or boundary-split for floor-level doors), a welded reveal
band stitched through the thickness — no internal caps, watertight
(unit-tested). Frames, a swung door leaf, and window mullions are attached
and stamped. Selecting a door/window shows Revit-style **flip controls**:
↔ exterior/interior facing and ↕ hand swing, rebuilt parametrically. If the
host wall is stretched or moved, `rebuildWallWithHosts` regenerates the wall
from its params and re-cuts every hosted element at its parametric position.
BIM-originated cuts run under a `bimHold` so the structural-edit detach rule
never eats their own host.

Downloaded BlenderKit assets can join the same system: any placed asset can
be **defined as a Door, Window, or Object** in the asset palette — doors and
windows become hosted insertions that cut a real opening in their wall (the
asset is uniformly fitted to the opening, oriented with the wall, and
re-cut automatically when the wall changes), objects stay free.

## Scripted Elements — code your own parametric types

No AI is built into the app — you bring your own. Ask Gemini/ChatGPT/… for
an element, hand it the app's template (one click copies the full contract),
paste the code back, and it becomes a real element type with editable
parameters.

![Scripted Elements editor](docs/scripted-elements.png)

- **Tools ▸ Scripted Element…** (or type `script`, or the ＋ row in the
  Element Browser) opens the paste editor: **Copy Template** gives your AI
  the spec, **Insert: Fire Stair / Railing** load shipped examples,
  **Check** compiles and test-builds against the real kernel, **Save**
  registers the type under the Element Browser's **Scripted** category.
- The contract is a small JS expression — `({ name, placement, params,
  build(c) })` — where `build` draws with the same kernel the app uses
  (`c.face`, `c.extrude`, `c.role`, …). Whatever parameters the script
  declares (steps, width, riser, tread, layout — anything) appear as
  **editable inputs in Entity Info**; changing one regenerates the element.
- The shipped **Fire Stair** example builds straight and dog-leg egress
  stairs (steps recompute when you change the count — the tread stays
  constant), plus landings and rails as kernel solids.
- Placement previews are the *real* geometry, throttled to ~14 builds/s
  with snap dedupe and muted script toasts, and preview builds skip model
  intersection entirely — dragging stays smooth even in large projects.

Scripts persist in IndexedDB (v3 `scripts` store — the source text is what
round-trips; entities recompile on load). If another stale tab holds an old
database version, the app detects the lock, falls back to a session store,
and tells you to close it — the browser panels never hang.

## Verification engine & regression suite

`model.validate()` is the invariant checker: edge-sharing (duplicate/self-loop
edges are errors; edges traversed by 3+ rings are flagged as non-manifold
folds), ring integrity (missing verts, repeats, hole-touches-outer),
degenerates (zero-area faces and self-loops are errors; slivers below 1e-6
area / 1e-5 length are flagged), unwelded duplicate segments, and a
**watertight Euler check** — every closed shell component computes
V-E+F = 2(S-G); odd or negative characteristics are reported with the
offending face IDs. Every violation message names entity IDs.

The headless suite (`npm test`, 350 tests) covers the regression flows: L-push
cavity culling with exact volumes, four-wall room generation, cross-mode
detachment (dirty-tracking), hosted door cuts with exact volume and
watertightness, sketch validation, the draw-primitive geometry, layers and
grid placement, wall join/stub/bottom caps, the BlenderKit bridge contract
and asset material healing, and the Scripted Elements system end to end
(contract validation, Fire Stair/Railing builds against the real kernel,
step-count regeneration, and the placement tool's gesture/throttling). The
coordinate invariance check runs in the browser console as
`runCoordInvariantTest()` — clientToWorldRay -> ground-plane point ->
worldToScreenPixels is pixel-exact regardless of toolbar/banner visibility
(the ray API consumes page coordinates; screen pixels are canvas-local).

## Levels & BIM entities

`LevelManager` (app facade over `model.levels`) provides `getLevel`,
`getElevation`, and `addLevel` (Edit ▸ Levels… adds levels; elevation
reference planes render in Precise mode). `BimEntityManager` (over
`model.bimEntities`) tracks parametric walls/floors; every B-Rep face/edge a
BIM tool creates carries `userData {bimEntityId, bimType, role}` with roles
`top | bottom | exterior | interior | start_cap | end_cap`. Queries:
`getEntityById`, `getEntityForFace`, `detach` (strips metadata, keeps
geometry). Levels, entities, and metadata all survive undo, autosave, and
file round-trips. Known limit: where two BIM walls geometrically merge, the
shared-mesh split can replace faces and drop their stamps
(`model.validate()` will flag any resulting corruption).

## Structural elements (StructuralManager.js)

`StructuralManager` (pure module; `app.structural` facade) implements the
structural families and their vertical datum rules:

- **Column** — `Z_start = Z(baseLevel) + baseOffset`,
  `Z_end = Z(topLevel) + topOffset` (falls back to the unconnected height).
  The Column tool derives x/y from the click and the base offset from the
  picked plane; the sweep starts at the TOP plane and pushes down, so a
  slab at the top level is punched and the column passes through
  monolithically.
- **Beam** — top justification (default) hangs the beam DOWNWARD from its
  reference level: `[Z − h, Z]` (Bottom/Center also supported). Parametric
  cross-sections **Rectangular** (`b_w × h`, 4-vertex loop), **T-Beam**
  (centered symmetric, 8 vertices — flange flush with the slab band, stem
  dropping below) and **L-Beam** (6 vertices, `flangeSide` Left/Right — web
  centered on the baseline, flange catching the interior slab). The Beam
  tool (B) sweeps the section along a drawn baseline through the B-Rep
  kernel, so beams weld into columns/walls like hand-drawn solids. The
  sweep sits 0.5 mm below the level plane so nothing coplanar z-fights.
- **Slab** — extrudes DOWN from its level: `[Z − t_s, Z]` (the Floor sketch
  tool). Columns passing through punch their footprints as openings, so
  slab geometry never duplicates column volume.
- **Foundation** — isolated footing pads (plus optional pedestal) hanging
  below their level; `buildFooting` + quantity support (API-level).

**Dynamic infill walls.** A level-bounded wall bounded between two levels
queries every slab and drop beam crossing its baseline and terminates under
the lowest underside — `H_wall = (Z_top − Z_base) − t_slab − h_beam_web`,
where the beam web is measured below the slab soffit, so the formula and
the geometric termination agree. Walls trim when structure lands above
them and **grow back when it is deleted** (`app.syncStructuralWalls`,
re-run after every committed op via a deferred pass). Built walls sit
~1 mm below the governing soffit so stacked faces never coincide.

**Join priority.** `Column (1) ≻ Drop Beam (2) ≻ Slab (3) ≻ Infill Wall (4)`
is enforced constructively (slabs punched at columns, walls terminate under
beams/slabs) and in the takeoff: `app.structural.quantityReport(model)`
computes gross/net volumes per element, crediting overlap volume to the
higher-precedence element (exact prism clipping — beams split into flange +
web bands, slabs into regions), so quantities never double-count monolithic
concrete.

**Soften / hide edges & glTF export.** Ctrl+erase (Eraser + Ctrl held)
*softens* an edge instead of dissolving it: a display-only `hidden` flag —
the line disappears from the viewport but every face, boundary, weld and
join still sees it, so lighting, materials and geometry are untouched
(SketchUp soften semantics without the normal-smoothing side effects).
Edit ▸ Unhide All Edges (command bar: `unhide`) restores them. File ▸
Export glTF… (command: `gltf`) writes the visible solid geometry as a
glTF 2.0 scene — faces triangulated exactly as the viewport renders them,
per-face colors as PBR base-color materials, Z-up converted to Y-up,
meters native — for handoff to Blender/Unreal/Twinmotion/etc. Softened
edges and hidden faces are never written: they are display state, not
geometry.

**Construction-wire hygiene.** BIM operations sweep their own residue:
`bimHold` is a depth-counted bracket — edges born during a parametric
operation and left attached to no face are reaped when the outermost
operation ends; wall commits and join rebuilds carry a wider
`beginEdgeSweep`/`endEdgeSweep` bracket across their multi-phase flow. Free
lines drawn in Free Drawing are never touched (they are born outside any
hold). For anything older files carry there is **Edit ▸ Clean Up Stray
Lines** (command bar: `clean` / `cleanup` / `purge`): one undoable step
that purges every wire edge via `Model.purgeWireEdges()`.

`StructuralManager` is pure (no DOM/THREE) and unit-tested in
`test/structural.test.js` (33 tests: elevation bounds, profile shapes and
areas, swept volumes, clearance formula, punching, priority takeoff).

## Two engines, one model

The tab bar switches between **Free Drawing** (SketchUp-style direct
modeling) and **Precise Drawing** (Revit-style parametric primitives). Both
share the canvas, camera, selection, and B-Rep — switching mode deactivates
the active tool (aborting in-progress drawing without committing dirty
geometry), swaps the ribbon and UI palette, and leaves camera, scene,
selection, and the model untouched. Tool shortcuts are scoped to the active
mode's ribbon (L = Line in Free, Wall in Precise).

## Testing

```
npm test          # or: node test/run.js
```

36 tests cover the model layer: vertex/edge deduplication, face creation,
edge splits (including wrap-around cuts), auto-facing, push/pull (box,
incremental re-push, collapse to zero, inward carve, through-punch with exact
analytic volumes), face splitting (straddle, holed hosts, pushed hosts, hole
absorption), serialization roundtrips, and `model.validate()` itself (dangling
ids, missing edges, degenerate rings, non-manifold warnings). Every mutating
test finishes with a `validate()` check.

`model.validate()` returns `{ ok, errors, warnings }`: **errors** are
corruption (rings referencing missing vertices, ring pairs without edges,
consecutive duplicate vertices, zero-area loops, holes touching the outer
ring); **warnings** are legal-but-noteworthy topology (non-manifold folds,
standalone edges, unused vertices). In the browser, set
`app.validateOnCommit = true` to run it after every committed transaction and
log any violation to the console.

## Transactions (unit of work)

Every model mutation runs inside a transaction, so undo snapshots, snap-cache
invalidation, view rebuilds, and UI syncs cannot be forgotten. The public API
is the centralized manager:

```js
app.transaction.run('push/pull', m => m.pushPull(face, 0.5)); // one-shot
const tx = app.transaction.begin('erase'); // interactive drag: begin on first change
//  ...mutate...
app.transaction.commit();                  // pushes undo + full UI sync
app.transaction.rollback();                // Escape / cancel: restores the snapshot
```

`run()` rolls back and toasts if the operation throws. A forgotten commit is
caught: the next `begin()` auto-rollbacks the stale transaction with a console
warning. Tools never touch `undoStack`/`opDone` directly — undo/redo and the
transaction layer are the only callers (`app.run`/`app.begin` remain as thin
delegates).

## Known limitations (v1)

- Lines crossing existing coplanar edges split both edges at the shared point
  and subdivide the faces beneath (SketchUp-style planar arrangement), and
  **overlapping coplanar shapes auto-partition**: two crossing rectangles
  become three independent selectable faces (intersection + both outers) via
  a minimal-cycle planar arrangement of the segmented edge graph (segmented
  to a fixpoint over the live edge set, so freshly split sub-edges get their
  crossings too). Line drawing is strictly planar once started on the ground
  or a face — snaps can't pull vertices off the plane; arrow-key axis locks
  can. Push/Pull rejects degenerate/zero-area faces, merges adjacent
  same-depth openings (the divider partition is culled — SketchUp union), and
  unions two solids pushed to a coincident face (restored on collapse)
- **3D face–face intersections are automatic**: every push/pull commit runs
  an AABB broad phase and slices crossing surfaces along the plane–plane
  line — each face divides along its own inside-extent chord (interval ends
  land on that face's boundary, so T-junctions like a slab ending mid-wall
  cut the wall cleanly), chord edges chain-split through on-segment vertices,
  and adjacent faces sharing the segment report no change. Split pieces are
  re-seeded, so a slab pushed through a wall cuts it at both the top and the
  bottom plane
- **Pockets that break a side of the host solid open it**: pushing an L drawn
  at a box corner inward splits the front/left walls — the reveal quads are
  consumed (the notch opens through the side instead of lining it), keeping
  the shell watertight. Faces that *own* extrude state (pushed faces) are
  never replaced by a split, so collapse anchors survive; side/cap/extended
  faces may be split by 3D crossings
- **Pushing into a blocking slab punches and clamps**: the blocking search
  runs for every push (a face drawn in a host's hole or free-floating on
  open ground alike). A sweep that passes a thick blocking body — a roof
  slab — punches *both* faces (a true tunnel, with the wall quads seamed at
  each crossing plane); a tip that would end *inside* the body is clamped
  to its underside (the push becomes the opening — no geometry buried in
  the slab), and a divided push owner hands its extrude state to the
  larger piece so re-pushes keep working
- A region whose boundary runs along existing **window openings** forms as
  the region minus the openings (correct), but its extrusion leaves the
  prism sides that border the voids open — full holed-region arrangement is
  out of scope
- Offset doesn't work on loops containing arcs (circles are fine)
- Pulling a box top below its base overlaps walls instead of boolean-cutting
- Push/pull merge works for shapes drawn on a face: punched out of it, split
  across its edge, or touching its boundary (an L in a corner trims the host
  and its pull extends the box walls — one watertight solid, no internal
  faces, no coplanar twin quads). Pushing a protrusion into a *separate*
  solid still overlaps it — no general boolean union yet, and through-punching
  isn't applied on incremental re-pushes (only on the initial push)
- Grouped geometry is an organizational layer, not an isolation boundary:
  shapes drawn on a grouped face punch/split/push through the group like any
  other face (SketchUp isolates groups fully — a deliberate divergence so wall
  windows always connect)
- No components/tags, Follow Me, solid-tool booleans, or guides — see
  Help ▸ SketchUp Feature List in the app for the full planned matrix
