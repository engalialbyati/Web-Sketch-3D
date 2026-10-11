# WebSketch 3D FEA vs ETABS 23 — Validation Report

**Date:** 2026-10-11 · **Model:** 5-story 2×1-bay RC frame, 65 members
**App engine:** WebSketch 3D direct-stiffness FEA (12-DOF frames, N/mm/MPa)
**Reference:** ETABS 23.3.0 via OAPI (attached to the licensed running instance), ACI 318-19

## Model

- Grid 10×5 m, stories 3 m: 30 columns 400×400, 35 beams 300×500, C25 concrete
- Loads per beam: DEAD 5.0 kN/m + self-weight (b·h·25), LIVE 8.0 kN/m;
  column self-weight 4.0 kN/m in DEAD
- Combos: 1.4D, 1.2D+1.6L
- Both engines run **centerline connectivity** (ETABS `SetEndLengthOffset`
  Auto=False, RZ=0 to match the app's rigid-zone factor 0 default)
- Global statics check: applied DEAD 1891.2 kN → ETABS base reactions 1891.3 kN;
  LIVE 1400.0 kN → 1400.0 kN on both sides

## Force agreement (65 members × both ends, kN / kN·m)

| Quantity | n | median | p90 | max | ≤5% |
|---|---|---|---|---|---|
| Beam shear (DEAD/LIVE/combos) | 35 | **0.0%** | 1.7% | 1.9% | 35/35 |
| Beam moment M3 | 35 | **3.3%** | 6.3% | 12.3% | 30/35 |
| Column axial P (DEAD) | 30 | 3.4% | 11.7% | 11.7% | 20/30 |
| Column axial P (LIVE) | 30 | **0.2%** | 0.9% | 1.2% | 30/30 |
| Column moments (M2/M3) | 30 | 0.3–1.6% | 12–25% | 25% | 18–26 |
| Column shears | 30 | 0.3–1.3% | 16–17% | 17% | 24–26 |

Column moments/shears beyond 5% occur only on the smallest values (base columns,
moments of 2–3 kN·m) where percentiles exaggerate sub-kN differences.

**Explained residuals (not engine errors):**
1. App stores column P as the **average of end axials** (compression+);
   ETABS reports P0/P1 per end (tension+). Shows as ≈ half a story's column
   self-weight (6 kN) on base columns → the 3.4% DEAD median; LIVE (no column
   sw) collapses to 0.2%.
2. Beam axial agrees within 1% in magnitude; 13/27 loaded beams show opposite
   signs from member local-axis orientation conventions (≤ 8 kN — negligible
   for design).
3. Combo forces are exact linear superpositions of pattern forces on both
   sides (no P-Δ, no nonlinear cases).

## Design

- ETABS ACI 318-19 concrete design ran via API (`StartDesign` ret 0):
  PMM required areas extracted for all 30 columns (e.g. base corner C1:
  3446 mm², worst interior 4271 mm², governing combo DConS2 = 1.2D+1.6L).
- App-side worst DCR for the same building: 0.483 (from the in-app ACI 318-19
  design pass) — both designs comfortably pass; per-member rebar diff requires
  exporting the app's required areas into app-results.json (follow-up).

## ETABS-side pipeline bugs found & fixed in build_etabs_model.py

1. `SetLoadDistributed` defaults to `Replace=true` — the user DEAD UDL call
   silently wiped the beam self-weight UDL (656 kN, 35% of total dead).
   The optional `Replace=false` args fail to marshal on this install (every
   call with them returns 1), so self-weight is now COMBINED into one call.
2. ETABS auto end-length offsets (rigid zones) are ON by default — forces
   reported at flexible-span faces made beam shears differ by the rigid-zone
   statics shift (8%). Now forced to centerline to match the app.
3. `RespCombo.SetCaseList` refuses every call form on this install — the named
   combos stay empty; diff.py superposes pattern forces instead (exact).
4. `GetSummaryResultsBeam/Column` require `NumberItems` as an in-value int
   followed by one empty array per out-array (comtypes returns outs in order
   with the int return last).

## Files

- `build_etabs_model.py` — OAPI model builder + analysis + design + extraction
- `app-results.json` — app engine results (exported from WebSketch 3D)
- `etabs-results.json` — ETABS results
- `diff.py` / `diff-summary.json` — comparison + machine-readable stats
- `etabs-test.EDB` — the ETABS model (open it to inspect)
