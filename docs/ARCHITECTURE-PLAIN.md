# WebSketch 3D — Architecture & Drawing Engine
### Plain-Language Edition — written for civil engineers

This is the same engine the programmers' document
([ARCHITECTURE.md](ARCHITECTURE.md)) describes, but explained the way an
engineer explains a building: what each part **does for you on site**, with
no code. If you can read a method statement, you can read this.

---

## 1. What WebSketch 3D is, in one paragraph

It is a 3D drawing and modeling program that runs in your browser (or as a
Windows desktop app — no installation, double-click the exe). It gives you
**two ways of working on the same model**, and you can switch between them
at any time:

| Mode | Works like | Best for |
|---|---|---|
| **Free Drawing** | SketchUp | Sketching ideas, sweeping profiles along paths, quick solids, cleaning up lines |
| **Precise Drawing (BIM)** | Revit | Walls, columns, beams, slabs, doors and windows with real dimensions, levels, quantities and reinforcement |

Both modes draw into **the same model**. Nothing is converted or lost when
you switch — it is one building seen with two tools.

---

## 2. The drawing engine — "the as-built model"

Underneath everything is a drawing engine that behaves like the **real,
built structure**: every wall, slab and pipe is a true solid with real
surfaces (faces) meeting at real edges — not a picture of a solid, not a
mesh of triangles that ignores where one material stops and the next starts.

Because the model knows where every surface is, it can do what the real
world does:

- **Draw on something and it divides it.** Sketch a closed shape on a slab
  and it becomes its own patch — like saw-cutting a slab into panels. Draw a
  circle on a wall face and the wall gets a real round hole.
- **Erase a line and things heal.** Delete the edge between two coplanar
  patches and they fuse back into one — like removing a construction joint.
- **Meeting solids join cleanly.** A column landing in a slab punches
  through it; a wall meeting a wall miters like two casings on a carpenter's
  corner. No overlaps, no double-counted concrete.
- **Quantities are measured, not estimated.** Volumes and areas come from
  the actual solid geometry — the same way you would measure off an
  as-built: per element, net of openings.

**Auto Face Creation** (Draw menu) is the SketchUp convenience: tick it on
and the moment a chain of lines closes a loop, the surface fills by itself —
draw a rectangle with four lines and the face appears on the fourth click.

---

## 3. Levels and heights — datums, exactly like drawings

Heights are organized by **levels** (Ground, First Floor, Roof…), the same
datums your elevation marks use. Walls and slabs hang between them: change a
level's height and everything bounded to it follows — that is the whole
point of the parametric layer (next section).

Sometimes the building does not care about your levels: a mezzanine at
+1.50 m between two 3.00 m floors, for example. For that there is
**Base Level = "None — draw at the picked height"**: point at the top of a
1.50 m wall and the drawing plane sits at 1.50 m. You draw where the
building actually is; the program follows your cursor's height, and the
reference grid moves with you so you always see the plane you are on.

---

## 4. Precise Drawing elements — "the shop drawings drive the site"

In Precise mode, every element (wall, column, beam, slab, footing…) carries
its **design parameters** — thickness, height, section, level — the way a
shop drawing carries its dimensions. The 3D geometry is *built from* those
numbers:

- Change the wall type from 200 mm to 300 mm → the wall rebuilds itself,
  and the openings cut into it re-cut themselves to suit.
- Stretch a wall → its neighbors stay joined, junctions stay clean.
- Delete the beam that was limiting a wall's height → the wall **grows back
  to full storey height** automatically.

Every element also carries **standard data from day one**, in the Revit
tradition: Phasing (existing / new construction / demolition), Identity
(Mark, Comments), structural usage, and whether the element bounds rooms.
You fill them in the properties panel; they ride the element through save,
undo and export. The panel edits are staged — change several values, press
Apply once.

### Drawn things can become elements too

Model something freehand — sweep a profile along a path to make a curved
wall, for example — select it and **Convert to Element**. The program does
not rebuild what you drew: your geometry *is* the design (the element is
marked "fixed"), it appears in the element browser with a name, it carries
the standard data, and it reports its quantities like any other element.

---

## 5. Sweeps and pipes — the plumber's bend rule, enforced

**Follow Me** sweeps a drawn cross-section along a line or curve — how you
make pipes, ducts, curved walls, handrails, arches.

Bends follow the rule every plumber knows: **a bend radius tighter than the
pipe itself collapses on the inside**. The program checks this *before*
building anything:

- If your bend is too tight but there is straight length on either side, it
  **re-sizes the bend automatically to the standard minimum** —
  R ≥ 1.5 × diameter, the long-radius elbow standard — and tells you what
  it did ("bend auto-sized from R 0.30 to R 1.20 m").
- If there is nothing to re-size against (a closed ring, or the straights
  are too short), it **refuses with the exact minimum**: "Fillet radius too
  small for the selected profile size. Minimum radius is 1.20 m."

The collapsed, self-intersecting geometry simply cannot occur.

The same discipline applies to the **fillet tool** (rounding a corner
between two lines): it always rounds *into* the corner with the exact
radius you typed — on the ground or in a vertical plane — and trims both
lines to the tangent points, like a proper curve set-out.

---

## 6. Materials — one continuous surface, like a real pour

Paint a material (bricks, concrete, tiles, any image texture) and it maps in
**one continuous world space**: two slabs side by side painted the same
material read as a single surface — the tile pattern runs across the joint
instead of restarting at each slab's corner, exactly like a real material
takeoff laying one pattern across a whole floor.

- Painting a **wall** paints the whole wall, around its door and window
  openings.
- Select several faces and paint once — one step, one undo.
- Paint a **group** and the whole group takes the material.
- Downloaded 3D models (doors, furniture) take solid colors so a tint never
  destroys their own look.
- For presentations: **View ▸ Edges** hides every line for clean
  walkthroughs, and the setting survives closing the app.

---

## 7. Reinforcement — the ACI detailing manual, live

Select any face of a beam, column, foundation, wall or floor and one dialog
generates the **full rebar cage** — ties, longitudinal rows, skin bars,
footing meshes with L-starters, slab meshes clipped around real openings —
following the ACI Detailing Manual (MNL-66). The bars are real 3D solids:
X-ray mode shows the steel through the concrete, and the Display Settings
dialog tunes color and transparency for screenshots and reviews.

---

## 8. Undo and safety — a site photographer, and a checking engineer

- **Undo is a photographer.** Before every operation the program takes a
  complete snapshot of the model. Ctrl+Z simply shows the previous photo.
  There are no "half-undone" states, ever.
- **A checking engineer reads every edit.** Each operation must pass a
  structural validation of the model (every face properly bounded, no
  dangling geometry, no torn openings). A failed check rolls the edit back
  and tells you why — bad geometry cannot enter the model.
- **Your data stays yours.** Everything runs locally in your browser or the
  desktop app; the model autosaves as you work, exports to glTF (Blender,
  Unreal, Twinmotion), IFC, PNG and print sheets. Nothing is uploaded.

---

## 9. Working day-to-day — the moves worth knowing

| You want to | Do this |
|---|---|
| Draw starting **on a line at height** | Hover the line (an "On Line" marker appears), click — the drawing continues at that height |
| Select a run of edges along one side | Click one edge, tap **Shift + +** repeatedly (it follows the line, through corners); **Shift + −** steps back |
| Round a corner | Fillet tool (Draw tab) → click line 1, hover line 2, type the radius + Enter, click |
| Draw a circle by two points | Circle tool → Options Bar ▸ Method ▸ **Start, End (2 points)** |
| Draw an arc by radius | Arc tool → Method ▸ **Start, End, Radius** → two clicks, type R, pick the side |
| Stand a shape vertically | Press **V** while drawing — it stands parallel to X or Y, never skewed |
| Make a pipe / curved wall | Draw the cross-section, **Follow Me**, click the path; bends that are too tight fix themselves |
| Turn drawn geometry into an element | Select it (triple-click grabs the whole solid) → Convert to Element |
| Clean presentation view | View ▸ Edges (off), then screenshot or walk through |
| Run it as a desktop program | Download the installer from the GitHub Releases page |

---

## 10. Plain-language dictionary

| The programmers' document says | In construction terms |
|---|---|
| B-Rep kernel | The as-built solid model — real faces and edges |
| Face healing (punch / split / merge) | Saw-cutting panels, forming openings, removing joints |
| Parametric entity | An element built from its shop-drawing dimensions |
| Transaction / snapshot | The undo photograph |
| validate() | The checking engineer who rejects bad geometry |
| Level datum | Floor-to-floor elevation mark |
| Fixed element | "What I drew is the design" — geometry claimed as an element |
| Bend auto-sizing (1.5·D) | Long-radius elbow standard |
| World-space material mapping | One pattern laid across the whole surface |
| Soften edge | Hide the line, keep the joint |

---

*WebSketch 3D is MIT-licensed and runs entirely on your machine. The
technical document with diagrams is
[ARCHITECTURE.md](ARCHITECTURE.md); the user-facing overview is the
[README](../README.md).*
