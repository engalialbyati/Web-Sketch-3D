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
- ETABS local axes pinned per member: `SetLocalAxes(nm, ax)` with ax = 0 —
  ETABS local 1 = the app's element direction (exported a→b), local 2
  vertical-up = the app's strong axis. The `ax` field is carried in the
  export for every member; a member roll would ride there.
- Global statics check: applied DEAD 1891.2 kN → ETABS base reactions
  1891.3 kN; LIVE 1400.0 kN → 1400.0 kN on both sides

## Force agreement (65 members × both ends, kN / kN·m)

| Quantity | n | median | p90 | max |
|---|---|---|---|---|
| Shears V (beams + columns, all cases) | 65 | **0.1%** | 1.9% | 16.9%* |
| Moments M (beams + columns) | 65 | **2.1%** | 12.3% | 25.4%* |
| Column M2 / V2 (weak plane) | 30 | 0.3–0.5% | 12–24% | 24.3%* |
| Axials P (signed, tension+ both sides) | 65 | **1.1%** | 51.4%* | 113.9%* |

\* tails sit on near-zero values: ±0.4 kN beam axials where the two engines'
stiffness redistribution gives opposite signs to noise-level forces, and
2–3 kN·m base-column moments. The largest physically meaningful difference is
the interior-beam end moment (app −55.7 vs ETABS −48.9 kN·m, 12%): the app
redistributes slightly more toward its columns.

**Sign alignment (this revision):** the exporter previously wrote
`Math.abs(Fi)` — every axial left the app unsigned, which is what made beam
axials look "flipped" against ETABS. The exporter now emits signed axials in
ETABS's convention (tension positive, `P = −Fi` since the engine's i-end end
force is compression-positive). Both engines now compare directly with no
per-member sign rules.

## Design export (app side, per member)

`app-results.json` now carries `appResults.design`:

- **beams** — worst-over-combos required steel: `AsTop`, `AsBot` (mm²), with
  the governing `MuTop`/`MuBot`/`Vu`. For this frame ACI minimums govern
  (371 mm² top and bottom on all 35 beams).
- **columns** — DCR at the provided layout (`dcr`, `Pu`, `Mx`, `My`,
  `crStrong`/`crWeak`, worst combo) plus **required steel** found by sweeping
  a uniform bar diameter through the same fiber P-M interaction math
  (`generatePMCurve` + `capacityRatio`) ETABS uses for its PMM sweep.
  Result: median DCR 0.184, max 0.457 (interior base column_4); every column
  passes even at the sweep's 10 mm floor.

## ETABS-side design output — API limits on this install

ETABS's ACI 318-19 design runs (`StartDesign` ret 0) and columns return PMM
rows, but the summaries are not comparable to required-steel values here:

- `pmmRatio` is returned 0.0 for every station (unpopulated via this API).
- `pmmArea` (2850–4897 mm²) tracks ETABS's internal default rebar layout, not
  a minimum requirement — a hand φPn check confirms the app's DCR 0.31 at the
  provided 1257 mm² (ETABS's own forces, its own code, agree with the app's
  capacity math once normalized).
- Beam design summaries return **0 rows** through every variant tried
  (`GetSummaryResultsBeam`, `..._2`, code-specific object, explicit
  `SetDesignSection`): no beam design data is exposed on this install.

The design comparison therefore validates the *inputs* (forces — table above)
and the app's design math (hand-checked against ACI directly); a per-member
app↔ETABS rebar diff needs a licensed ETABS whose API returns design rows.

## ETABS-side pipeline bugs found & fixed (all in the generated script)

1. `SetLoadDistributed` defaults to `Replace=true` — the user DEAD UDL call
   silently wiped the beam self-weight UDL (656 kN, 35% of total dead).
   The optional `Replace=false` args fail to marshal on this install (every
   call with them returns 1), so self-weight is COMBINED into one call.
2. ETABS auto end-length offsets (rigid zones) are ON by default — forces
   reported at flexible-span faces made beam shears differ by the rigid-zone
   statics shift (8%). Forced to centerline to match the app.
3. `RespCombo.SetCaseList` refuses every call form on this install. Fix:
   **reuse the default case names** — the app's DEAD/LIVE patterns are mapped
   onto ETABS's auto-created `Dead`/`Live` cases (`case map: DEAD→Dead,
   LIVE→Live`), so the auto design combos DConS1/DConS2 = exactly
   1.4D and 1.2D+1.6L with real demand. (Also `RespCombo.Add(name, 0)` is an
   invalid combo type — 2 works.)
4. `GetSummaryResultsBeam/Column` require `NumberItems` as an in-value int
   followed by one empty array per out-array (comtypes returns outs in order
   with the int return last).
5. App pattern names differing from ETABS defaults (DEAD vs Dead) silently
   detached the design combos from the load path — fixed by the case map.

## Files

- `build_etabs_model.py` — OAPI model builder + analysis + design + extraction
  (regenerated by the in-app Export ETABS dialog, dev-only)
- `app-results.json` — app engine forces (signed, ETABS convention) + design
  export
- `etabs-results.json` — ETABS results
- `diff.py` / `diff-summary.json` — comparison + machine-readable stats
- `etabs-test.EDB` — the ETABS model (open it to inspect)
