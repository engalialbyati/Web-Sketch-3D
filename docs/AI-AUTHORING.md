# WebSketch 3D — AI Authoring Guide (`.websketch.json`)

This document is written to be given **to an AI as context** so it can write a
WebSketch 3D model file from scratch. Everything described here was verified
against the app: the worked example at the end loads through **File ▸ Open**
and generates a correct 3D building.

---

## 1. The authoring model — write PARAMETERS, not geometry

A saved model (`File ▸ Save As…` → `model.websketch.json`) contains the full
B-Rep: thousands of vertices, edges and faces. **An AI never writes those.**

The app **self-heals parameter-only files**: on open, any structural element
that owns no geometry is rebuilt from its parameters automatically
(toast: *"Model rebuilt from parameters"*). So the AI authors:

- the **levels** (floor datums),
- the **grids** (optional naming/alignment datums),
- the **layers** (usually just the default),
- and a list of **BIM entities**, each with its `type` + `params`,

…and the app generates every vertex, edge and face itself — including wall
junctions, column-slab punches and beam end trims.

**Units are meters. The world is Z-up.** X/Y is the plan, Z is height.
0,0,0 is the project origin at the lowest level.

---

## 2. Minimal file skeleton

```json
{
  "v": [], "e": [], "f": [], "c": [], "g": [],
  "lvl":  [ ...levels... ],
  "grid": [ ...grids (optional)... ],
  "lyr":  [ { "id": "0", "name": "0", "color": null, "visible": true, "locked": false, "lt": 0, "lw": 0 } ],
  "cur": "0",
  "assets": [],
  "bim":  [ ...entities... ]
}
```

`v / e / f / c / g` stay **empty arrays** for AI-authored files — they are the
generated B-Rep (vertices, edges, faces, curves, groups). Keep every key;
the loader expects them.

---

## 3. Levels

```json
{ "id": "lvl_1", "name": "Ground", "elevation": 0 }
{ "id": "lvl_2", "name": "First Floor", "elevation": 3.2 }
```

- `elevation` is absolute world Z in meters. Sort ascending (the app sorts too).
- Ids conventionally run `lvl_1`, `lvl_2`, … — must be unique strings.
- Elements reference levels by id (`baseLevel`, `baseLevelId`,
  `referenceLevelId`). References are optional but recommended: they drive
  level isolation (trim/split/merge act per level) and the Level browser.

**Consistency rule:** an element's absolute Z coordinates must agree with the
level elevation it references (a wall on `lvl_2` at elevation 3.2 has
`base[2] = 3.2`). Do not mix.

---

## 4. Grids (optional)

```json
{ "id": "grA", "name": "A", "s": [0, -2], "e": [0, 10] }
{ "id": "gr1", "name": "1", "s": [-2, 0], "e": [10, 0] }
```

`s`/`e` are `[x, y]` plan endpoints. Convention: lettered grids run one way,
numbered the other. Optional keys: `sys` (system name), `curved: 1` + `m`
(mid point), `bbl` (bubble end), `ve: [zMin, zMax]` (vertical extent),
`lk: 1` (locked), `hd: 1` (hidden).

---

## 5. Layers

Keep the default layer `0` unless the model needs more:

```json
{ "id": "walls", "name": "Walls", "color": "#b7a98a", "visible": true, "locked": false, "lt": 0, "lw": 0 }
```

Every entity carries `"layerId": "0"` (or another layer id). Unknown ids fall
back to `"0"`.

---

## 6. Element catalog

Each entity has this shape:

```json
{ "id": "wall_1", "type": "wall", "params": { ... }, "faces": [], "edges": [], "layerId": "0" }
```

- `id`: unique string, conventionally `<type>_<n>` (wall_1, column_7, …).
- `faces` / `edges`: **always empty arrays** in an authored file — the app fills them.
- `name` (optional string) shows in the Element Browser.

All coordinates are `[x, y, z]` meters, world-absolute.

### 6.1 Wall (straight run) — `"type": "wall"`

```json
{
  "base": [0, 0, 0], "end": [8, 0, 0],
  "height": 3.2, "thickness": 0.2,
  "locationLine": "centerline", "primitive": "line",
  "closed": false, "joins": { "start": 0, "end": 0 },
  "baseLevel": "lvl_1"
}
```

| param | meaning |
|---|---|
| `base` / `end` | centerline endpoints. `base[2]` = level elevation (absolute Z) |
| `height` | meters upward from `base[2]` |
| `thickness` | plan width, centered on the base→end line |
| `locationLine` | always `"centerline"` for authored walls |
| `primitive` / `closed` / `joins` | always `"line"` / `false` / `{0,0}` |

Runs may cross columns — the app's junction engine splits/retreats them at
load (the Revit face rule). Walls only need to be *sketched* centerline to
centerline.

### 6.2 Wall (shaped footprint) — closed variant

```json
{
  "closed": true,
  "footprint": [[0,0,0],[6,0,0],[6,0.2,0],[3.2,0.2,0],[3.2,4,0],[0,4,0]],
  "height": 3.2, "thickness": 0.2,
  "locationLine": "centerline", "primitive": "line", "baseLevel": "lvl_1"
}
```

The plan polygon (L-/Z-/U-shaped walls). Winding **counter-clockwise seen
from above** (positive shoelace area). All points at the base Z.

### 6.3 Column — `"type": "column"`

```json
{ "base": [8, 0, 0], "width": 0.4, "depth": 0.4, "height": 3.2, "baseLevelId": "lvl_1", "rotation": 0 }
```

| param | meaning |
|---|---|
| `base` | plan center + base Z (keep `base[2]` = level elevation) |
| `width` / `depth` | X / Y plan size (before rotation), meters |
| `height` | full story height — the column spans level→level |
| `rotation` | plan rotation, radians (optional) |
| `family` | `"circular"` for a round column (then set width = depth = diameter) |

`baseLevelId` (+ optional `baseOffset` meters) is the datum; `topLevelId` or
`height` bounds the top. A column whose top plane coincides with a slab top
punches through the slab monolithically — that is automatic.

### 6.4 Beam — `"type": "beam"`

```json
{
  "baseline": [[0, 0, 3.2], [8, 0, 3.2]],
  "profile": "rectangular", "webWidth": 0.3, "height": 0.6,
  "zJustification": "Top", "referenceLevelId": "lvl_2"
}
```

| param | meaning |
|---|---|
| `baseline` | two `[x,y,z]` points, centerline-to-centerline (ends trim to columns automatically) |
| `webWidth` / `height` | section width / depth, meters |
| `zJustification` | `"Top"` — the beam hangs DOWN from the reference plane |
| `referenceLevelId` | the level whose elevation = the beam's TOP plane |
| `zTop` | optional absolute top Z (use when no level matches the soffit) |

Beam tops usually sit AT the level elevation (`referenceLevelId`), hanging
below the floor slab.

### 6.5 Floor / slab — `"type": "floor"`

```json
{
  "regions": [
    {
      "outer": [[0,0,3.2],[8,0,3.2],[8,8,3.2],[0,8,3.2]],
      "holes": [ [[3,3,3.2],[4,3,3.2],[4,4,3.2],[3,4,3.2]] ]
    }
  ],
  "thickness": 0.15, "baseLevel": "lvl_2"
}
```

| param | meaning |
|---|---|
| `outer` | plan ring at the slab's **TOP plane** Z — the body extrudes DOWN by `thickness` |
| `holes` | interior cut rings (stair shafts, shafts), same Z as `outer` |
| `thickness` | meters, downward |

**Winding: counter-clockwise from above** for every ring (positive area).
Multiple regions make a multi-wing slab.

### 6.6 Foundation (isolated pad) — `"type": "foundation"`

```json
{ "base": [0, 0, 0], "width": 1.8, "depth": 1.8, "thickness": 0.6, "baseLevel": "lvl_1" }
```

The pad hangs DOWN from the base Z by `thickness`. `base[2]` = the level
elevation (usually 0 for ground).

### 6.7 Roof (flat) — `"type": "roof"`

```json
{
  "kind": "flat", "pitch": 10, "overhang": 0,
  "regions": [{ "outer": [[0,0,6.4],[8,0,6.4],[8,8,6.4],[0,8,6.4]], "holes": [] }],
  "thickness": 0.2, "baseLevel": "lvl_3"
}
```

Same ring convention as floors (top-plane ring, CCW, extrudes down).
`kind` may be `"flat"`, `"mono"` or `"gable"` (pitched needs a rectangular
outline).

---

## 7. Not authorable from parameters alone

These types exist in the app but their geometry is NOT rebuilt from params —
an authored file should not include them (they would load as empty):

- **`"door"` / `"window"` / `"opening"`** — hosted in a wall; created by the
  wall-opening workflow (or the IFC importer). Author walls without openings,
  then cut them in-app.
- **`"stairs"`** — parametric stairs place through the Stairs tool (they also
  cut their host floor).
- Asset instances and scripted elements — app-managed.

**Authoring strategy:** put the structure (walls, columns, beams, floors,
foundations, roofs) in the JSON; add doors/windows/stairs interactively
afterwards.

---

## 8. Verified worked example

This exact file loads (File ▸ Open) and produces a one-room building:
a pad footing, four columns on a 2×2 grid, perimeter walls, a first-floor
slab and an edge beam — 11 elements, self-healed geometry.

```json
{
  "v": [], "e": [], "f": [], "c": [], "g": [],
  "lvl": [
    { "id": "lvl_1", "name": "Ground", "elevation": 0 },
    { "id": "lvl_2", "name": "First Floor", "elevation": 3.2 }
  ],
  "grid": [
    { "id": "grA", "name": "A", "s": [0, -2], "e": [0, 10] },
    { "id": "grB", "name": "B", "s": [8, -2], "e": [8, 10] },
    { "id": "gr1", "name": "1", "s": [-2, 0], "e": [10, 0] },
    { "id": "gr2", "name": "2", "s": [-2, 8], "e": [10, 8] }
  ],
  "lyr": [{ "id": "0", "name": "0", "color": null, "visible": true, "locked": false, "lt": 0, "lw": 0 }],
  "cur": "0",
  "assets": [],
  "bim": [
    { "id": "foundation_1", "type": "foundation", "params": { "base": [0, 0, 0], "width": 1.8, "depth": 1.8, "thickness": 0.6, "baseLevel": "lvl_1" }, "faces": [], "edges": [], "layerId": "0" },
    { "id": "column_1", "type": "column", "params": { "base": [0, 0, 0], "width": 0.4, "depth": 0.4, "height": 3.2, "baseLevelId": "lvl_1" }, "faces": [], "edges": [], "layerId": "0" },
    { "id": "column_2", "type": "column", "params": { "base": [8, 0, 0], "width": 0.4, "depth": 0.4, "height": 3.2, "baseLevelId": "lvl_1" }, "faces": [], "edges": [], "layerId": "0" },
    { "id": "column_3", "type": "column", "params": { "base": [0, 8, 0], "width": 0.4, "depth": 0.4, "height": 3.2, "baseLevelId": "lvl_1" }, "faces": [], "edges": [], "layerId": "0" },
    { "id": "column_4", "type": "column", "params": { "base": [8, 8, 0], "width": 0.4, "depth": 0.4, "height": 3.2, "baseLevelId": "lvl_1" }, "faces": [], "edges": [], "layerId": "0" },
    { "id": "wall_1", "type": "wall", "params": { "base": [0, 0, 0], "end": [8, 0, 0], "height": 3.2, "thickness": 0.2, "locationLine": "centerline", "primitive": "line", "closed": false, "joins": { "start": 0, "end": 0 } }, "faces": [], "edges": [], "layerId": "0" },
    { "id": "wall_2", "type": "wall", "params": { "base": [8, 0, 0], "end": [8, 8, 0], "height": 3.2, "thickness": 0.2, "locationLine": "centerline", "primitive": "line", "closed": false, "joins": { "start": 0, "end": 0 } }, "faces": [], "edges": [], "layerId": "0" },
    { "id": "wall_3", "type": "wall", "params": { "base": [8, 8, 0], "end": [0, 8, 0], "height": 3.2, "thickness": 0.2, "locationLine": "centerline", "primitive": "line", "closed": false, "joins": { "start": 0, "end": 0 } }, "faces": [], "edges": [], "layerId": "0" },
    { "id": "wall_4", "type": "wall", "params": { "base": [0, 8, 0], "end": [0, 0, 0], "height": 3.2, "thickness": 0.2, "locationLine": "centerline", "primitive": "line", "closed": false, "joins": { "start": 0, "end": 0 } }, "faces": [], "edges": [], "layerId": "0" },
    { "id": "floor_1", "type": "floor", "params": { "regions": [{ "outer": [[0, 0, 3.2], [8, 0, 3.2], [8, 8, 3.2], [0, 8, 3.2]], "holes": [] }], "thickness": 0.15, "baseLevel": "lvl_2" }, "faces": [], "edges": [], "layerId": "0" },
    { "id": "beam_1", "type": "beam", "params": { "baseline": [[0, 0, 3.2], [8, 0, 3.2]], "profile": "rectangular", "webWidth": 0.3, "height": 0.6, "zJustification": "Top", "referenceLevelId": "lvl_2" }, "faces": [], "edges": [], "layerId": "0" }
  ]
}
```

---

## 9. Rules, gotchas and QA checklist

1. **Meters, Z-up, world-absolute.** No per-level local coordinates.
2. **Ring winding: CCW seen from +Z** (positive shoelace area) — floors,
   roofs, footprints, holes alike.
3. **Rings live at the TOP plane** for floors/roofs; bodies extrude DOWN.
4. **Walls/floors/levels must agree numerically** — a wall on lvl_2 starts at
   `base[2] = 3.2` if lvl_2's elevation is 3.2.
5. **Minimum sizes:** thickness ≥ 0.02 m, heights ≥ 0.05 m, columns
   ≥ 0.02 m. Sensible buildings: walls 0.1–0.3, columns 0.3–0.8,
   slabs 0.12–0.2, stories 2.8–4 m.
6. **Unique ids** per entity, `<type>_<n>` pattern. Levels/grids unique too.
7. **`faces`/`edges` = `[]`** on every entity — geometry is generated.
8. **JSON must be valid** — quote every key, no trailing commas, no comments.
9. Order of entities in `bim` does not matter.
10. Overlapping runs are fine: walls crossing columns get trimmed, beams end
    at column faces, columns punch flush slabs — all automatic at load.
11. Verify after opening: the Element Browser lists every entity; the toast
    *"Model rebuilt from parameters"* confirms self-heal ran.

## 10. Prompting recipe (for the human)

> "Using the WebSketch 3D authoring spec (attached), write a
> `model.websketch.json` for a 2-story building: grid 3×2 at 6 m, columns
> 0.4 m, story height 3.2 m, perimeter + one partition wall per floor,
> 150 mm slabs, edge beams on grid lines, pad footings under ground columns.
> Output only the JSON."

Then **File ▸ Open…** the file. If something is off, the app toasts what it
rebuilt; check the Element Browser against what you asked for.
