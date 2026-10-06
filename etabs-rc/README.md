# RC Studio — ETABS-style Structural Analysis

A standalone app with the ETABS look and workflow (titlebar, menu bar,
drawing toolbar, Model Explorer, dark 3D viewport, plan view, status bar),
built on our own FEA engine — no proprietary code or assets.

Open `index.html` (or serve the repo root and visit `/etabs-rc/`).
All libraries (Tailwind, Three.js, FontAwesome) are vendored in `lib/` —
fully offline.

## Workflow (what works now)

1. **File ▸ New Model** — stories + orthogonal gridlines; optional
   auto-template (columns at every intersection + beams on gridlines).
2. **Draw** — Quick Columns (click a grid point; the column rises from the
   story below), Draw Beams (click joint-to-joint, chaining), Restraints
   (click a joint to cycle fixed → pinned → free).
3. **Define** — Materials (Ec/density/f'c per section), Section Properties
   (with A/I33 summary), Mass Source (self-weight + additional masses +
   live fraction), Load Patterns (type + self-weight
   multiplier), Auto Lateral Loads (ASCE 7-16 §12.8 seismic with the Cs
   caps and Ta = Ct·hn^x; §26/27 wind qz by exposure), auto ACI 318-19 /
   ASCE 7 combinations.
4. **Assign** — sections to selection, distributed frame loads (kN/m,
   any direction), **Frame Releases** (M2/M3 end pins — true static
   condensation in the engine, wL²/8 exact on released beams), Joint
   Restraints (per-DOF checkbox form: fixed/pinned/roller), Joint
   Additional Mass.
5. **Analyze (F5)** — P-delta static analysis, story drift ratios,
   reactions; Modal (F5 menu) — Ritz vectors with mass participation.
6. **Display** — undeformed / deformed shape, moment M3 / shear V2 /
   axial P ribbons in the 3D view and color-mapped plan, results table.

Model format: JSON (save/open). Units kN-m internally; engine in N-mm.

Not yet: concrete design checks (the rcdesign.js engine is bundled and
ready — UI pending), response-spectrum case, walls/slabs.

Run tests: `node test/model.test.js` style via the harness in `test/`.
