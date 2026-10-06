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
7. **Analyze ▸ Loads ▸ Auto Lateral** — ASCE 7-16 generated loads:
   seismic §12.8 equivalent lateral force (Cs from SDS/SD1/R/Ie or a user
   coefficient, Ta = Ct·hn^x, vertical distribution wx·hx², §12.4.2
   combos with Ev = 0.2·SDS·D) and wind §26/27 (qz = 0.613·Kz·Kd·V² by
   exposure) with base-shear reporting.
8. **Analyze ▸ Response Spectrum** — ASCE 7-16 §12.9 modal response
   spectrum: Ritz modes scaled by the §11.4.5 design spectrum, CQC
   combination (Der Kiureghian) with the missing-mass correction,
   per-direction base shear and mass participation; ρ/Ω₀ enter the
   §12.4.2/§12.4.3 combos including overstrength.
9. **Analyze ▸ Run / Modal / Diagrams** — P-delta static analysis with
   story drift ratios (Table 12.12-1 check), force diagrams per
   combination, and modal analysis by load-dependent Ritz vectors
   (Wilson/CSI's documented method, X+Y+Z start loads) with modal
   participating mass ratios; mechanisms are detected and reported.
10. **Design ▸ Preferences + checks** — fc'/fy/cover/bars feed the ACI
   318-19 report with DCRs and REQUIRED steel (As and bar count) per beam.


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
