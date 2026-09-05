# WebSketch 3D — Architecture & Drawing Engine

This document explains how the application is built: the layering, the
boundary-representation (B-Rep) drawing engine at its core, the parametric
BIM layer on top of it, and every major pipeline (input → transaction →
geometry → render → export) with flowcharts and graphs.

All diagrams are [Mermaid](https://mermaid.js.org/) — GitHub renders them
natively.

## Table of contents

1. [System overview](#1-system-overview)
2. [The drawing engine: B-Rep data model](#2-the-drawing-engine-b-rep-data-model)
3. [Input pipeline: from mouse to geometry](#3-input-pipeline-from-mouse-to-geometry)
4. [Transactions, undo and the guard](#4-transactions-undo-and-the-guard)
5. [Face healing: draw, punch, split, arrange](#5-face-healing-draw-punch-split-arrange)
6. [Push/Pull — the sweep kernel](#6-pushpull--the-sweep-kernel)
7. [Parametric BIM layer](#7-parametric-bim-layer)
8. [Hosted openings (doors / windows)](#8-hosted-openings-doors--windows)
9. [Structural elements & dynamic walls](#9-structural-elements--dynamic-walls)
10. [Rendering pipeline](#10-rendering-pipeline)
11. [Persistence & export](#11-persistence--export)
12. [Testing](#12-testing)
13. [Feature SDK (extension surface)](#13-feature-sdk-extension-surface)

---

## 1. System overview

Three layers with a strict downward dependency rule — the kernel never knows
a feature exists, features never touch kernel internals:

```mermaid
flowchart TB
    subgraph FEATURES["FEATURES  (js/features/*.js)"]
        F1["Column tool"]
        F2["Beam tool (Rect / T / L)"]
        F3["Clean Up command"]
    end
    subgraph UI["UI  (ui-cad.js, index.html)"]
        R["Ribbon / options bar"]
        CB["Command bar / VCB"]
        EB["Element browser"]
        IP["Entity info"]
    end
    subgraph SDK["ENGINE SDK  (js/engine/api.js)"]
        EV["Engine.events — pub/sub bus"]
        FR["Engine.features — declarative registry"]
        TG["Engine.txGuard — validate-on-commit"]
    end
    subgraph APP["APPLICATION  (js/app.js)"]
        TX["TransactionManager"]
        BM["BimEntityManager"]
        LM["LevelManager"]
        SM["StructuralManager facade"]
        IN["Inference & snapping"]
    end
    subgraph KERNEL["KERNEL"]
        GEO["geometry.js — pure math (G)"]
        MODEL["model.js — B-Rep + topology + validate"]
        RENDER["render.js — viewport & picking"]
    end
    FEATURES --> SDK
    UI --> APP
    SDK --> APP
    APP --> KERNEL
    RENDER --> MODEL
    MODEL --> GEO
```

Key property: **everything mutates through a transaction** and every
notification is **push** (`Engine.events`), never polling.

## 2. The drawing engine: B-Rep data model

The model is a boundary representation: solids are shells of faces, faces
are rings of vertices connected by edges. Arcs/circles are segment chains
sharing a `curveId` (metadata lives in `curves`).

```mermaid
erDiagram
    MODEL ||--o{ VERTEX : "welded within 0.1 mm"
    MODEL ||--o{ EDGE : ""
    MODEL ||--o{ FACE : ""
    MODEL ||--o{ CURVE : "arc circle metadata"
    MODEL ||--o{ GROUP : "organizational"
    MODEL ||--o{ BIM_ENTITY : "parametric registry"
    MODEL ||--o{ LEVEL : "vertical datums"
    VERTEX ||--o{ EDGE : "endpoint"
    EDGE ||--o{ FACE : "ring member 1 or 2"
    FACE ||--o{ FACE : "holes"
    BIM_ENTITY ||--o{ FACE : "stamped userData"
    BIM_ENTITY ||--o{ EDGE : "profile stamps"
```

```mermaid
classDiagram
    class Face {
        +int id
        +list loop
        +list holes
        +hex color
        +float alpha
        +bool hidden
        +json extrude
    }
    class Edge {
        +int id
        +int a
        +int b
        +int curveId
        +bool hidden
    }
    class BimEntity {
        +string id
        +string type
        +json params
        +list faces
        +list edges
    }
    class Extrude {
        +axis
        +anchor
        +sides
        +cap
        +through
    }
    Face *-- Extrude : live push/pull state
    BimEntity o-- Face : userData.bimEntityId
```

**Invariants** (each enforced in one place, unit-tested in `test/`):

| # | Invariant | Where |
|---|---|---|
| 1 | Vertices closer than `WELD_EPS` (0.1 mm) share one id — drawn geometry connects instead of floating | `Model.vertexAt` (spatial hash) |
| 2 | No T-junctions: a point landing on an edge splits it, in every referencing ring | `weldVertex / splitEdgeAt` |
| 3 | No double faces / internal partitions: coincident quads mean union — the partition is deleted | `pushPull` twin culling |
| 4 | Every ring pair has an edge; shells are valid or the transaction rolls back | `validate()` + tx guard |

### 2a. Kernel indexes (why drags stay smooth as models grow)

Every kernel operation used to be a full scan — `findEdge` walked all edges,
`gc()` invalidated the whole vertex weld hash (so the next weld rebuilt it
over every vertex), and `autoIntersect` recomputed both face AABBs for every
candidate pair. Each is fine at 50 faces and effectively quadratic by a few
hundred — which is exactly where "dragging an element feels laggy" came
from. Three indexes keep the hot paths near constant-time:

| Index | Maintained by | Answers |
|---|---|---|
| `_edgeIndex` — canonical vertex-pair → edge id | `_addEdge` / `_delEdge`; every edge mutation funnels through them, `load()` rebuilds | `findEdge(a, b)` in O(1) |
| `_vh` — 0.2 mm spatial hash of vertices | incremental `_vhAdd` / `_vhRemove` on create, move (`setVertex`), and `gc()` — never wholesale-invalidated mid-edit | tolerance welding in O(1) |
| per-scan AABB memo | `autoIntersect` caches each face's box, dropping entries only for faces an intersection mutated | broad-phase overlap without re-boxing |

One flag on top: `model.noAutoIntersect`. Placement **previews** (the
Scripted Elements drag ghost) build disposable geometry that is deleted the
moment the preview refreshes, so intersecting it with the model is pure
waste — with the flag set, a full Fire Stair ghost build costs ~2 ms on a
small model (was ~90 ms) and stays interactive into the thousands of faces.

## 3. Input pipeline: from mouse to geometry

```mermaid
sequenceDiagram
    participant U as User
    participant V as Viewport (render.js)
    participant T as Tool
    participant E as DrawPrimitiveEngine
    participant A as App
    participant M as Model
    U->>V: mouse down / move
    V->>T: onDown / onMove (tool dispatch)
    T->>A: inferPoint(ev) — axis locks, snapping, grid, level planes
    A-->>T: 3D point + snap info
    T->>E: primitive clicks (line / rect / arc / pick…)
    E-->>T: onCommit({pts, kind, closed})
    T->>A: transaction.run(label, fn)
    A->>M: snapshot (serialize) → mutate → validate
    M-->>A: ok / rollback
    A->>V: opDone → rebuild, previews cleared
    V-->>U: updated frame
```

Free-mode tools (Line, Rect, Push/Pull…) call `model.addEdge /
addFaceFromRings / pushPull` directly. Precise-mode tools share the same
kernel but wrap results in **parametric entities** (§7).

## 4. Transactions, undo and the guard

```mermaid
flowchart LR
    A["app.transaction.run(label, fn)"] --> B["begin: serialize() snapshot"]
    B --> C["fn(model) mutates the B-Rep"]
    C --> D{"commit"}
    D --> E{"validate() ok?"}
    E -- no --> F["rollback: model.load(snapshot)<br/>toast: rolled back"]
    E -- yes --> G["undoStack.push snapshot"]
    G --> H["opDone(): detach dead entities,<br/>deferred wall-clearance sync,<br/>view.rebuild, autosave"]
    H --> I["Engine.events: model:changed"]
```

Undo/redo are pure snapshot swaps — no inverse operations to write or get
wrong. Snapshots deep-copy every array a later edit mutates in place.

## 5. Face healing: draw, punch, split, arrange

Drawing a closed loop on existing coplanar geometry never creates overlaps —
the kernel partitions instead (`punchOrSplit`):

```mermaid
flowchart TD
    A["new closed loop on a plane"] --> B{"strictly inside a host face?"}
    B -- yes --> C["PUNCH: host gains a hole"]
    B -- no --> D{"touches host boundary?"}
    D -- yes --> E["TRIM: cut the touched region out"]
    D -- no --> F{"crosses host edges?"}
    F -- yes --> G["ARRANGE: segment both, rebuild<br/>minimal cells (crossing rects →<br/>intersection + outer regions)"]
    F -- no --> H["plain new face"]
```

Edge erase (`dissolveEdge`) heals back:

```mermaid
flowchart TD
    A["erase edge"] --> B{"adjacent faces"}
    B -- "2, coplanar" --> C["MERGE: loops fuse,<br/>collinear junctions weld away"]
    B -- "2, angled" --> D["OPEN: both faces removed<br/>(SketchUp corner erase)"]
    B -- "1 / wire" --> E["straight removal,<br/>spike rings healed"]
```

Ctrl+erase **softens** instead: a display-only `hidden` flag — the line
disappears from the viewport but every face, boundary, weld and join still
sees it (geometry, lighting, materials and exports are untouched).
Edit ▸ Unhide All restores them.

## 6. Push/Pull — the sweep kernel

One operation builds walls, slabs, columns, beams — the SketchUp workhorse:

```mermaid
flowchart TD
    A["pushPull(face, dist)"] --> B{"face has live extrude state?"}
    B -- yes --> C["incremental move along stored axis"]
    B -- no --> D{"neighborhood"}
    D -- "lone face" --> E["cap the base → closed solid"]
    D -- "on unconnected host" --> F["punch now → connect"]
    D -- "punched hole" --> G["no cap: sweep MERGES with host"]
    E --> H
    F --> H
    G --> H{"parallel face in sweep path?<br/>(findBlockingFace)"}
    H -- "crosses before distance" --> I["THROUGH-PUNCH: clamp,<br/>hole the far face, tunnel lining"]
    H -- no --> J["plain prism: side quads + moved face"]
    J --> K["autoIntersect: slice every<br/>crossing face at the chords"]
```

Post-sweep hygiene: coplanar twins are culled (unions leave no internal
partitions), and `shellVolume` resolves each orientation tree's sign
geometrically (ray-parity probe), so punched hosts + rising tubes measure
exactly.

## 7. Parametric BIM layer

Precise Drawing wraps kernel solids in **parametric entities**
(`model.bimEntities`): `{id, type, params, faces, edges}`. Every created
face/edge carries `userData {bimEntityId, bimType, role}`.

```mermaid
flowchart LR
    subgraph DRAW["Draw path (wall example)"]
        A["baseline via DrawPrimitiveEngine"] --> B["bandRing / miteredRing<br/>(joins: miter, butt, buttTrim)"]
        B --> C["pushPull(height) — clearance-aware"]
        C --> D["classifyRoles: top / bottom /<br/>exterior / caps"]
        D --> E["bim.create('wall', params, roles)"]
    end
    subgraph EDIT["Parametric edits later"]
        F["stretchWall / syncWallHeight"] --> G["vertices move —<br/>neighbors stay welded"]
        H["type change / resize"] --> I["rebuildWallWithHosts:<br/>re-extrude + re-cut every<br/>hosted opening"]
    end
    E --> I
```

Levels are vertical datums (`LevelManager`); walls, slabs, beams and columns
derive their vertical bounds from levels + instance offsets.

## 8. Hosted openings (doors / windows)

```mermaid
sequenceDiagram
    participant Tool as HostedInsertionTool
    participant HC as HostedCut
    participant M as Model
    Tool->>HC: locate(wall params, spec) → rect on host face
    Tool->>HC: cut(): draw rect + far rect as faces
    HC->>M: punchOrSplit both host faces (through or pocket)
    HC->>M: delete void faces + reapRingEdges (no wire residue)
    HC->>M: stitch reveal band (jamb / head / threshold)
    HC->>M: frame() → frame + leaf faces
    Note over HC: flip (facing / hand) rebuilds only the frame/leaf
```

### 8a. Scripted Elements & downloaded assets

Two extension paths deliberately avoid touching the kernel:

- **Scripted Elements** (`js/script-elements.js`): a user script is a JS
  expression `({ name, placement, params, build(c) })`, compiled with
  `new Function` and run through the SAME kernel calls the built-in tools
  use — `buildInto()` diffs the model before/after to collect the created
  faces/edges, every face gets a role, and `bim.create('script', …)` turns
  the result into a parametric entity. Declared params render as editable
  Entity Info inputs; editing re-runs `buildInto` in a transaction. Source
  text persists in the IndexedDB `scripts` store (v3) and recompiles on
  load. `ScriptPlaceTool` places it — the drag ghost is real geometry built
  under `bimHold` + `noAutoIntersect`, throttled to ~14 builds/s with
  snap-input dedupe.
- **BlenderKit assets** (`js/assets.js`): downloaded GLBs live as foreign
  `THREE.Group`s under a dedicated root — serialized by hash, not by
  geometry. `healMaterials` repairs the two recurring import defects
  (WebP-decoded black albedo via canvas sampling, all-zero COLOR_0).
  Assets defined as Door/Window become hosted insertions that cut their
  host wall through the same `HostedCut` machinery above, fitted uniformly
  to the opening and re-cut when the wall rebuilds.

## 9. Structural elements & dynamic walls

`StructuralManager` (pure module, `app.structural` facade) implements the
elevation datums, the parametric beam sections, infill-wall clearance and
the join-priority takeoff:

```mermaid
flowchart TD
    subgraph RULES["Elevation rules"]
        C1["Column: Zs = Z(base)+baseOffset<br/>Ze = Z(top)+topOffset"]
        B1["Beam (Top justification):<br/>hangs [Z−h, Z]"]
        S1["Slab: [Z−ts, Z]"]
    end
    subgraph PROFILES["Beam sections — swept along the baseline"]
        P1["Rectangular — 4 verts"]
        P2["T-beam — 8 verts, flange flush<br/>with the slab band"]
        P3["L-beam — 6 verts, side-selectable"]
    end
    subgraph CLEARANCE["Dynamic infill walls"]
        W1["wall bounded between levels"] --> W2["query slabs + beams<br/>crossing its baseline"]
        W2 --> W3["H = story − t_slab − h_web<br/>top = min(soffits, beam bottoms)"]
        W3 --> W4["trim when structure lands,<br/>GROW BACK when it is deleted"]
    end
    RULES --> CLEARANCE
    PROFILES --> SW["buildBeam: section face + pushPull<br/>(0.5 mm anti-z-fight drop)"]
```

Join priority — enforced constructively (slabs punched at columns, walls
terminating under beams) and in the quantity takeoff (exact prism clipping,
overlap credited to the higher-precedence element):

```mermaid
flowchart LR
    A["Column (1)"] --> B["Drop Beam (2)"]
    B --> C["Slab (3)"]
    C --> D["Infill Wall (4)"]
    style A fill:#d4a017,color:#fff
    style B fill:#7b8a3a,color:#fff
    style C fill:#3a7b6a,color:#fff
    style D fill:#4a5a7b,color:#fff
```

Construction-wire hygiene: `bimHold` is a depth-counted bracket — edges born
during a BIM operation and left attached to no face are reaped on release;
wall commits and join rebuilds carry wider `beginEdgeSweep / endEdgeSweep`
brackets across their multi-phase flow. Free-drawn lines (born outside any
hold) are never touched. A manual **Edit ▸ Clean Up Stray Lines** command
purges any remaining wire edges in one undoable step.

## 10. Rendering pipeline

```mermaid
flowchart LR
    A["model mutation"] --> B["opDone()"]
    B --> C["view.rebuild()"]
    C --> D["face mesh: triangulate every face<br/>(loop normal + in-plane basis + earcut)"]
    C --> E["edge lines: every boundary edge<br/>(softened / hidden skipped)"]
    C --> F["BimElement groups: one selectable<br/>mesh per parametric entity"]
    D --> G["Three.js scene"]
    E --> G
    F --> G
    G --> H["previews: tool overlays<br/>(loops, quads, fills, sticky labels)"]
    G --> I["picking: raycast face → id →<br/>whole entity or sub-element (Ctrl)"]
```

## 11. Persistence & export

```mermaid
flowchart TD
    A["model.serialize()"] --> B["JSON: vertices, edges (incl. hidden flag),<br/>faces, curves, groups, levels, bim entities"]
    B --> C["undo snapshots · autosave (localStorage) · Save As…"]
    C --> D["load(): pure state swap"]
    E["File ▸ Export glTF…"] --> F["GltfExporter.fromModel:<br/>triangulate visible faces,<br/>per-face color → PBR materials,<br/>Z-up → Y-up root rotation,<br/>embedded base64 buffer"]
    F --> G["model.gltf — Blender / Unreal /<br/>Twinmotion handoff"]
    H["Export PNG"] --> I["viewport canvas capture"]
```

Softened edges and hidden faces are display state — never written to glTF,
so lighting and materials are unaffected by what you hide while modeling.

## 12. Testing

`node test/run.js` — 169 tests, no DOM, no WebGL: `geometry.js`, `model.js`
and the pure modules are loaded into an isolated V8 context (`vm`) and
driven through their public APIs. Suites cover the healing kernel (punch /
trim / arrange / dissolve), push/pull semantics, transactions, walls &
joins, hosted cuts, structural elements (elevation rules, profiles,
clearance, priority takeoff), wire hygiene, soften round-trip and the glTF
writer.

## 13. Feature SDK (extension surface)

The drawing engine is organized so that new features plug in without
touching internals. Three layers with a strict downward dependency rule:

```
┌──────────────────────────────────────────────────────────────┐
│  FEATURES (tools, BIM elements, UI extensions)               │  ← you write here
│    js/features/*.js — one file per feature                   │
├──────────────────────────────────────────────────────────────┤
│  SDK  (js/engine/api.js)                                     │
│    Engine.events    pub/sub bus (push invalidation)          │
│    Engine.features  registry: declarative descriptors        │
│    Engine.tx        transaction guard (validate-on-commit)   │
│    Engine.registry  feeds TOOLS / ribbon / commands / UI     │
├──────────────────────────────────────────────────────────────┤
│  KERNEL (existing, stabilized)                               │
│    js/geometry.js  pure math — no state, fully tested        │
│    js/model.js     B-Rep + topological ops + validate()      │
│    js/render.js    viewport + picking                        │
│    js/app.js       transactions, undo, entities, inference   │
└──────────────────────────────────────────────────────────────┘
```

### Rules

1. **Features never import kernel internals** — they talk to `app.model`
   and `app.transaction` through the SDK surface, and register themselves
   with a declarative descriptor. The kernel never knows a feature exists.
2. **Everything mutates through a transaction** (`app.run(label, fn)`). The
   transaction guard validates structure on commit and rolls back on
   *errors* (warnings are advisory) — corrupt state cannot enter the model.
3. **All change notification is push.** `Engine.events` emits
   `model:changed`, `entities:changed`, `selection:changed`,
   `tool:changed`, `feature:registered`. UI listens instead of polling.
4. **Snapshots are deep** (see model.js serialize) and undo is a pure
   state swap — no inverse operations to write or get wrong.

### Writing a new feature (the whole contract)

```js
Engine.features.register({
  id: 'beam',                       // unique — registry refuses duplicates
  kind: 'tool',                     // 'tool' | 'panel' | 'command'
  label: 'Beam', icon: '<svg…/>', key: 'B', mode: 'bim',
  commands: ['beam', 'bm'],         // command-bar aliases, free
  options: [                        // options-bar + properties fields, free
    { key: 'width',  type: 'number', label: 'Width',  step: 0.05, default: 0.2 },
    { key: 'height', type: 'number', label: 'Height', step: 0.05, default: 0.4 },
  ],
  tool: BeamTool,                   // standard Tool lifecycle class
  state: { width: 0.2, height: 0.4 }, // feature-owned, injected on activate
});
```

The registry validates the descriptor (shape, unique id, options schema) and
wires: the ribbon button, the command aliases, the options-bar fields bound
to `state` (with `onOption` hooks), the type-selector slot, and undo labels.
A malformed descriptor is refused loudly — the app never sees a half-wired
feature.

### Event bus

```js
const off = Engine.events.on('model:changed', e => render(e.dirty));
Engine.events.emit('model:changed', { label: 'wall', dirty: [...] });
off();
```

Listener exceptions are caught and logged — one bad listener can never break
an emitter. Events are synchronous (ordering is deterministic); async work
lives inside features, not the bus.

### Security / robustness model

- **Schema gates** — descriptors and JSON families are validated on entry.
- **Transaction guard** — structural `validate()` errors on commit roll the
  edit back; the toast names the failed operation.
- **Listener isolation** — bus handlers run in try/catch.
- **Deep snapshots** — undo state can't alias live arrays.
- **No eval / no remote code** — families are data (OBJ/primitives), never
  scripts; JSON parses are wrapped and refused on bad shape.

### Performance path

Current: single merged render mesh rebuilt per commit (fine to a few
thousand faces), O(N) picking via Three.js raycast, string-diffed UI panels.

Next steps, in order of value:
1. **Versioned rebuilds** — `model.version` bumps on every mutation;
   `view.rebuild()` early-exits when the version is unchanged.
2. **Incremental triangulation** — per-face triangle cache; a commit only
   re-triangulates faces whose ids changed (`model:changed` carries `dirty`).
3. **Spatial hash** — uniform-grid AABB index over faces for broad-phase
   intersection and hover picking; maintained by the same dirty set.
4. **Worker offload** — validate() and heavy booleans in a Web Worker once
   the kernel is moduleized (the SDK surface makes this a swap, not a
   rewrite).

### BIM storage & element layer (v2)

The Revit-style hierarchy sits beside the kernel without piercing it:

```
FEATURES   ui-browser.js (palette) · edit-inplace.js (sandbox) · BimElement.js
           (unified Groups, sub-element query, catalog mapping)
SDK        Engine.events: db:ready · editinplace:{entered,finished,cancelled}
FACADE     app.db (BimDatabase) · app.elements (BimElementRegistry)
           app.enterEditInPlace/finish/cancel · app.syncElementsToDb
KERNEL     model.js serializeSubset exports each element's B-Rep; hidden flags
           isolate the sandbox (the kernel already skips hidden geometry)
```

- **db.js** is a pure storage layer: relational tables (categories/families/
  types/elements) over an adapter — IndexedDB in the browser, an in-memory
  Map store under Node. Same code, fully testable headlessly.
- **The model stays the working set.** The database is a mirror: every
  commit upserts each entity's brep_data + quantities; detach/delete removes
  rows; catalog types are created on demand for unmatched sizes.
- **One element = one Group** (`render.elementsRoot`). The merged face mesh
  renders only plain Free-Drawing geometry; `pickFaceAt` raycasts the merged
  mesh AND every element Group, so element picking needs no parallel
  selection system.
- **Edit In Place** is visibility-based isolation plus `model.bimHold`, so
  structural edits keep their stamps; finish() re-derives ownership as
  "stamped ∪ created-since-entry", which is also the re-isolation rule
  applied after in-session undo/redo (snapshots carry no hidden flags).
