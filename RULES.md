# WebSketch 3D — Reinforcement Rules (the governing set)

These are the code-applied defaults for every reinforcement feature. Where
FreeCAD-Reinforcement and ACI 318 differ, **ACI governs**; FreeCAD's placement
conventions (covers to the bar surface, count formulas, lap geometry) apply
where ACI is silent.

## Covers and bars
- Covers are measured to the **bar surface** (not the axis), FreeCAD convention.
- Bar placement: just inside the ties at cover + tie dia + bar r.
- Distribution: first bar at FrontCover + dia/2, last the same off the far
  side; count = ceil((span − dia)/spacing) + 1 in spacing mode.

## Stirrups / ties (ACI 318 Ch. 25 + seismic)
- **One continuous closed loop**, all four corners rounded on nesting arcs
  whose bend centers land exactly on the corner longitudinal bar axes.
- 135° seismic lap at a top corner, tails extending inward
  **≥ max(6 db, 75 mm)**; laps **alternate** top corners down the span.
- Inside bend diameter **6 db** (bars ≤ 25 mm); centerline bend radius 3.5 db.
- The tie never leaves its outline — nothing enters the cover zone.

## Beams

### Beam connections (MNL-66(20) BM-202/203/204 + ACI 9.8)
- **End support detection**: a column whose center lies within 0.75 m of a
  beam end face (and whose box the beam line actually enters) is the
  support; a perpendicular beam crossing within 0.6 m is a girder.
- **Far-side development (BM-202/204)**: at a supported end, top AND bottom
  bars run to the far side of the column/girder ties --
  `tip = center + planReach - 40 mm cover - 12 mm tie` -- and take the
  standard 90-degree hook (12db tail) there. The framing trim keeps the
  solid at the near face, so the bar extension is exactly the joint width
  less covers.
- **Tie cap (BM-203/204)**: through each supported 0.6 m connection zone,
  tie spacing steps down to max 8 in (203 mm) -- non-seismic layouts only
  (seismic zone rules already govern).
- **Integrity reinforcement (ACI 9.8.1.2/9.8.1.4)**: at least 2 continuous
  top + 2 continuous bottom bars on every beam (default on, dialog
  toggle); at a DISCONTINUOUS end both rows anchor with standard 90-degree
  hooks at the face.
 — shear (ACI 318 special seismic)
- First stirrup **50 mm (2 in)** from the support face (to the tie surface).
- Confinement zones **2h** at both ends at **sc ≤ min(d/4, 125 mm)**.
- Mid-span at **sm ≤ d/2**, d = h − (cover + tie + r).
- **Multi-leg rule**: when clear transverse leg spacing exceeds **300 mm**,
  inner hoops wrap intermediate bars so no gap exceeds 300 mm.

## Beams — longitudinal (ACI 315 / 318 §25.3)
- End hooks: **90°** with **12 db** extension (toward the core) or **180°**
  hairpin (legs 7 db apart = 6 db inside dia) with configurable return.
- Extra top bars (negative moment): **Ln/4** from each support face, outer
  end hooked; extra bottom bars stop **Ln/8** short of both supports.
- Second layer when primary clear gaps < max(db, 25 mm), 25 mm clear offset.
- **Bent-up bars**: symmetric 45° cranks starting ~Ln/6 from each face,
  arcs at every inflection, 90° hooks down at the top elevation.

## Columns
- Ties per the cage types (Single Tie / Two Ties / Multiple / Circular
  helix); circular sections auto-select the helix cage.
- v0.8 continuous beams: the **column** caps at a crossing beam's soffit
  + 0.1 mm; deleting the beam grows the column back to its drawn height.

## Insertion offsets (cardinal points)
- Beams: lateral offset ⟂ to the run (angle-proof) + Location Line
  (Center / Left Face / Right Face).
- Columns: global offsetX/offsetY; the analytical axis (grids, schedules)
  never moves.
- Flush alignment: **Δ = (hostReach − targetReach) / 2**; hosts are found
  automatically (column at beam end; beam crossing a column ⟂ to the axis).

## Schedules
- Every bar carries a unique pid; the Bar Bending Schedule counts **bars**,
  never tube faces. Weight **0.006165·d² kg/m** (d in mm), rows aggregated
  by host + shape + dia + length.

## Walls

### Openings (MNL-66(20) WALL-206/207/208)
- Hosted door/window/opening entities on the wall (hostWallId + station)
  drive the reinforcement; the regular mesh SPLITS around each hole
  (verticals resume above/below, horizontals run left/right; slivers
  under 150 mm / 250 mm drop).
- WALL-206: 2 horizontal bars at the head and sill + 2 vertical bars each
  jamb, each running 24 in min past the opening. A floor-level opening
  gets no sill steel.
- WALL-208: one 48 in diagonal bar per corner per curtain crossing the
  corner at 45 deg; where the wall is tight the bar clamps to fit (24 in
  minimum, below that nothing -- MNL-208 alternates hooked bars).
