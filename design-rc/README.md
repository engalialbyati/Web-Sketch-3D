# Design RC — Structural Analysis & RC Design

A focused companion app to WebSketch 3D, stripped to the structural workflow
only. Open `design-rc/index.html` (or serve the repo root and visit
`/design-rc/`).

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
