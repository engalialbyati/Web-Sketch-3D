# Design RC — Structural Analysis & RC Design

A focused companion app to WebSketch 3D, stripped to the structural workflow
only. Open `design-rc/index.html` (or serve the repo root and visit
`/design-rc/`).

## The ETABS workflow

1. **File ▸ New Building (Stories & Grids)** — story count + height and
   orthogonal gridline spacings in one wizard.
2. **Structure tab** — draw columns/beams on the grid at Story 1.
3. **Structure ▸ Replicate** (Model Tools) — copy the story to every
   story above (Similar Stories).
4. **Structure ▸ Sections** — named frame sections (C40x60, B30x60...)
   assigned to the selected members; geometry and analysis follow.
5. **Structure ▸ Supports** — fixed or pinned column bases.
6. **Analyze ▸ Loads** — load patterns + assignments (kN/m, kPa).
7. **Analyze ▸ Run / Modal / Diagrams** — P-delta static analysis, force
   diagrams per combination, frequencies and animated mode shapes
   (mechanisms — e.g. pin-based unbraced frames — are detected and
   reported instead of trusted).
8. **Design ▸ Preferences + checks** — fc'/fy/cover/bars feed the ACI
   318-19 report with DCRs per member.

## What it keeps

- **Structure tab**: Column, Beam, Brace, Wall, Opening (wall/slab/roof),
  Split Wall, Floor, Roof, Foundation, Strip Footing, Base Plate, Stairs,
  grids and levels.
- **Analyze tab** (ETABS-style):
  - Run Analysis — 1D/2D/3D FEA of the drawn model, ACI 318-19 §5.3.1
    load combinations, P-delta via iterated geometric stiffness.
  - Loads — Define Load Patterns (type, self-weight multiplier, default
    pressures) and Assign Loads to the selection (kN/m on frames, kPa on
    slabs/walls, per pattern and direction).
  - Diagrams — moment/shear/axial force diagrams and the deformed shape
    drawn on the model, per combination; Modal — frequencies, periods and
    animated mode shapes from the chosen mass source.
- **Design tab**: ACI 318-19 checks — beam flexure/shear, column P-M
  interaction — with a DCR report.

Removed relative to WebSketch 3D: materials/textures, reinforcement
detailing (MNL-66 cages/sheets/BBS), asset libraries (BlenderKit, PolyHaven,
families), architecture (doors, windows, curtains, rooms, railings),
IFC/DXF interop, demo buildings.

Run the tests: `node test/run.js` from this folder.
