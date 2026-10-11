# RC Parity Roadmap — decompiled ETABS deep analysis vs WebSketch 3D

Date: 2026-10-11 · Sources: `D:\REA\ETABS REA\decompiled` (1,516 cTable* classes,
CsiNaDesign code classes, beam/col/wall/slab designer modules) + `design_docs/*.md`.

## A. What the decompiled code actually contains for RC (no foundation)

| ETABS subsystem | Evidence (file:line) | Status in app |
|---|---|---|
| Concrete Beam Design Summary | `cTableConcreteBeamDesignSummaryACI31819.cs` | ✅ done (Show Tables) |
| Concrete Column Design Summary (PMMRatio, As, VMaj/VMin) | `cTableConcreteColumnDesignSummaryACI31819.cs` | ✅ done |
| Column shear (ColumnNetShearCapacity) | `cDsnCodeConcRC_ACI_08.cs:132-147` | ✅ done |
| Biaxial PMM (CSiCol fiber surface, 5 methods) | `cPMMSurface.cs:348-519` | ✅ done |
| Wall panel shear (αc, 8/10√f'c caps, Asv-min) | `_08.cs:149-180` | ✅ done |
| Pier/spandrel labels → forces | `cTablePierForces.cs`, `cTableSpandrelForces.cs` | ◐ labels + spandrel design done; forces tables missing |
| Punching (footing forms; slab native) | `cFootingDesignFull.cs:1342-1486` | ✅ done (slab) |
| Slab design flexure+shear data (strip/FEM) | `cTableConcreteSlabDesignFlexureAndShear.cs` | ◐ FEM per-panel done; per-strip station data not |
| **Beam flexural STRESS CHECKS: Normal / Long-Term / Transfer** | `cTableConcreteBeamDesignFlexureStressCheck*.cs` | ❌ MISSING |
| **Slab flexural STRESS CHECKS: Normal / Long-Term / Transfer** | `cTableConcreteSlabDesignFlexureStressCheck*.cs` | ❌ MISSING |
| **Beam-Column JOINT envelope (JS ratio, B/C ratios)** | `cTableConcreteDesignJointEnvelopeACI31819.cs`, PhiJointShear=0.85 (`cConcreteCode_ACI_318_08.cs:404`) | ❌ MISSING |
| Design Forces tables (per-station P/V/M) | `cTableBeamDesignForces.cs`, `cTableColumnDesignForces.cs` | ❌ (end forces only) |
| Pattern live load r | PatternLiveFactor=0.75 default (`_08.cs:405`) | ❌ MISSING |
| UtilizationFactorLimit, MultiResponseCaseDesign, NumInteractionCurves | `cConcreteCode_ACI_318_11.cs` | ✅ (ENVELOPE, 7 angles/30 pts) |
| Cracked/long-term deflection engine | native (not decompiled) — implements ACI 318 Ch. 24 | ❌ only gross-EI elastic |

The user's report is correct: **deflection calculation was display + gross-EI elastic only**.
ETABS's concrete deflection = cracked-section Ie (Branson) + sustained-load
long-term multipliers, surfaced through the Flexural Stress Check tables.

## B. Fix plan (executed tonight, no approval gate)

1. **Service deflection engine (beams)** — ACI 318-19 Ch. 24 exactly:
   - fr = 0.62λ√f'c (24.2.3.6), Mcr = fr·Ig/yt
   - Icr (cracked transformed), Ie = Icr + (Ig−Icr)(Mcr/Ma)³ ≤ Ig (Branson 24.2.3.5)
   - λΔ = ξ/(1+50ρ'), ξ=2.0 sustained 5yr+, ρ'=0 (24.2.4.1)
   - δ immediate (D), δ immediate (L), δ long-term = (1+λΔ)·δD + δL
   - Checks: δ_L ≤ L/360; δ_total,LT ≤ L/240 (ACI Table 24.2.2)
   - Wire into beamDeflections consumers: Element Data, Beam Summary table,
     new "Deflection Check" entry in Show Tables.
2. **Slab panel deflection check** — mesh δ per service case: δD, δ(D+L),
   δLT = (1+λΔ)δD + δL; limits L/240 total. Shown in slab Element Data +
   Slab Deflections table gains long-term columns.
3. **Beam-column joint shear** (ETABS Joint Envelope parity):
   Vu,js = Σ unbalanced beam face moments at the joint (major/minor axis),
   φVn = 0.85·γ·√f'c·bj·hc with γ = 1.66/1.25/1.0 (interior/exterior/corner,
   ACI 21.3.4 SI form). JS ratio per column per axis → column summary column +
   Element Data line. Simplification documented: beam-capacity-based demand
   replaced by combo-factored beam face moments (service of design combos).
4. **Design Forces tables** — per-station P/V2/V3/M3 rows per member per combo
   (Beams + Columns) in Show Tables, matching `cTable*DesignForces` fields.
5. **Pattern live load (r=0.75)** — virtual LIVE-A / LIVE-B patterns (alternate
   loadable entities) generated for the LIVE pattern; auto combos
   1.0D + 0.75(LIVE-A) and 1.0D + 0.75(LIVE-B) added to the ACI set, so the
   ENVELOPE design captures skip-live patterning (ETABS PatternLiveFactor).
6. Pier/Spandrel forces tables — deferred (labels + design exist).

Verification: demo rebuild, all tables render, hand-check Mcr/Ie numbers,
commit + push.
