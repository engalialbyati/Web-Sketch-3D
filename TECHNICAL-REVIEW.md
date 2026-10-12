# Technical Review — Design & Analysis Workspace

**App:** WebSketch 3D RC module · **Code standard:** ACI 318-19 (SI units, N·mm·MPa internally)
**Scope:** every ribbon tab of the Design & Analysis workspace — Define, Assign, Analyze, Design —
tool by tool, input value by input value: what each value **is**, **where it is consumed**
(which equation, which file:line), and **the ACI 318-19 clause** the equation comes from, with the
actual code snippet so you can audit it.

> Reading key: `rcbeam.js:41` = file `js/design/rcbeam.js`, line 41. All equations run in
> **N, mm, MPa**; display in kN, kN·m, mm. Cross-references marked **[ETABS]** cite the decompiled
> source (`D:\REA\ETABS REA\decompiled`) — those are CSI implementation facts, not ACI.

---

# 1. DEFINE TAB

## 1.1 Materials (Define ▸ Materials)

Each material record (`rcdefine.js:42 defaultMaterials`) carries:

| Field | Meaning | Used? | Where |
|---|---|---|---|
| `conc.fc` | **Specified compressive strength f'c** (MPa) | ✅ everywhere | every strength equation below |
| `iso.E` | Young's modulus (0 = auto) | ✅ | stiffness assembly `rcmodel.js:104` |
| `iso.u` | Poisson's ratio ν | ✅ | `rcmodel.js:103` → G = E/2(1+ν) |
| `iso.a` | Thermal expansion α | ❌ **unused** | no thermal load case exists yet |
| `iso.G` | Shear modulus (0 = auto) | ✅ | `rcmodel.js:105` |
| `weight.value` | Unit weight (25 kN/m³) or mass | ✅ | self-weight + Ec auto |
| `damping.modalRatio` | ζ (0.05) | ✅ | Response-spectrum scaling `rcmodel.js` (rsDialog) |
| `conc.lightweight` | λ flag | ✅ | λ in Vc, fr, torsion |
| `conc.strainAtFc / strainUltimate` | Hognestad curve params | ❌ **unused** | fiber PM uses Whitney block |
| `rebar.fy` | Yield strength (500 MPa) | ✅ | all flexure/shear steel equations |
| `tempProps`, `ssCurve` | T-stress / stress-strain tables | ❌ **unused** | no creep/shrink/thermal engine |

**Ec — auto-computed from f'c and unit weight** (`rcdefine.js`, concreteEc):
```
ACI 318-19 §19.2.2.1(b): Ec = 0.043·wc^1.5·√f'c  (wc kg/m³);  normalweight ≈ 4700√f'c MPa
// rcdefine.js concreteEc()
if (m.conc.lightweight) return 0.043 * Math.pow(wc, 1.5) * Math.sqrt(fc);
return 4700 * Math.sqrt(fc);
```
Consumed at `rcmodel.js:104` → element stiffness EA, EI, GAs (analysis), and at
`rcmodel.js` crackedSectionProps (deflection, Ec again = 4700√f'c, §19.2.2.1(b)).

**Where f'c enters each design equation (complete list):**

| Equation | Uses f'c as | ACI 318-19 clause | Code |
|---|---|---|---|
| a = As·fy/(0.85·f'c·b) | stress block | §22.2.2.4.1 (α=0.85) | `rcbeam.js:41` |
| β1 = 0.85−0.05(f'c−28)/7 ∈[0.65,0.85] | block shape | Table 22.2.2.4.3 | `rcbeam.js:21` |
| φPn column cap 0.80·[0.85f'c(Ag−Ast)+fyAst] | axial | §22.4.2 | `rccolumn.js` (P0 anchor) |
| PM fiber sweep σc = 0.85f'c, εcu=0.003 | section | §22.2.2.1, §22.2.2.4 | `rccolumn.js:56` |
| Beam Vc = 0.17λ√f'c·bw·d | shear | §22.5.5.1 | `rcbeam.js:127` |
| Vs cap = 2.1√f'c·bw·d | shear | §22.5.1.2 | `rcbeam.js:138` |
| Av,min = max(0.062√f'c, 0.35)bw/fyt | shear | §9.6.3.4 | `rcbeam.js:151` |
| Torsion thresholds 0.061/0.083/0.66√f'c | torsion | §22.7.4 / §22.7.6 | `rcbeam.js:174+` |
| As,min = max(0.25√f'c, 1.4)/fy·bw·d | flexure | §9.6.1.2 | `rcbeam.js:299` |
| Wall Vc = αc·0.17√f'c·Aw·(axial) | shear | §11.5.4.3 | `rcwall.js:131` |
| Wall cap 0.66√f'c·Aw | shear | §11.5.4.3 cap | `rcwall.js:134` |
| Slab one-way 0.17√f'c·b·d | shear | §22.5.5.1 | `rcslab.js:112,195` |
| Punching 0.17(1+2/β), 0.083(αs d/bo+2), 0.33 | two-way | Table 22.6.5.2 | `rcslab.js:92` |
| fr = 0.62λ√f'c | rupture | §24.2.3.6 | `rcmodel.js:942` |
| Bearing φ·0.85f'c·A1·√(A2/A1) | bearing | §16.3.1 (old 10.17) | `rccolslab.js` |
| Joint φVn = 0.85·γ·√f'c·bj·hc | joint | [ETABS] φ=0.85; γ per ACI 21.3.4 SI | `rccolumn.js:297` |

**Example trace — f'c in beam flexure (the equation you asked about):**
The demand Mu comes from analysis; the app solves the quadratic directly instead of iterating a:
```
// rcbeam.js:41 designRectFlexure
const disc = d * d - 2 * Mu / (0.85 * phi * fc * b);   // 0.85·f'c·b = Whitney block (ACI 22.2.2.4.1)
const a = d - Math.sqrt(disc);
const As = Mu / (phi * fy * (d - a / 2));              // Mn = As·fy(d−a/2) (ACI 22.3)
```
This is Mu = φ·As·fy·(d − a/2) with a = As·fy/(0.85·f'c·b) — §22.2.2.4.1 + §22.3.1.1.
φ then re-verified from the actual neutral axis:
```
// rcbeam.js:12 phiFlexure — ACI Table 21.2.2 + transition §21.2.2
if (et >= esy + 0.003) return 0.90;                    // tension-controlled
if (et <= esy) return 0.65;                            // compression-controlled (tied)
return 0.65 + 0.25 * (et - esy) / (0.005 - esy);       // linear transition
```

## 1.2 Frame Sections (Define ▸ Frame Sections)

| Field | Meaning | Used? | Where |
|---|---|---|---|
| `dims.b, dims.h` (m) | section size | ✅ | stiffness (A, I), fiber PM bars, covers |
| `material` | → materials registry | ✅ | E, G, fc, weight |
| `designType` beam/column | routing | ✅ | designAllBeams/Columns filters |
| `modifiers {a,i22,i33,as2,as3,torsion,mass,weight}` | ETABS SetModifiers | ✅ | `rcmodel.js` frame push: A·a, Iy·i22… cracked-analysis factors |
| `rigidZone` (0–1) | rigid-zone factor | ✅ | `rcmodel.js` eoI×rz (end offsets) |
| `rebar.coverTop/coverBot/colCover` | cover (m) | ✅ | d = h − cover − stirrup − db/2 |
| `rebar.rebarSize, nR2, nR3` | layout | ✅ | PM fiber bars `rccolumn.js rebarLayout` |
| `rebar.tieSize, tieSpacingLongit` | ties | ✅ | column shear Av, s `rccolumn.js:373+` |
| `rebar.topLeft…` (T-sections) | flange steel | ◐ | designTBeamFlange (partial) |

**Section properties → stiffness:**
```
// rcmodel.js:66-71 — analysis uses REAL section properties × modifiers
const A  = props.A * 1e6 * (mo.a ?? 1);                // mm²
const I33 = props.I33 * 1e12 * (mo.i33 ?? 1);          // mm⁴  (I33 = strong axis for beams)
const J  = rectJ(bmm, hmm) * (mo.torsion ?? 1);
```
ACI 318-19 §6.6.3.1.1 / [ETABS] — for cracked first-order analysis the user sets
i33 = 0.35 etc.; the app never hardcodes them.

## 1.3 Load Patterns / Cases / Combos

| Field | Meaning | Used? | Where |
|---|---|---|---|
| `selfWtMult` | self-weight multiplier | ✅ | `rcmodel.js:476+` w = A·γ·selfWtMult |
| pattern type DEAD/LIVE… | family routing | ✅ | auto combos, long-term split |
| `loadCases[Modal].numModes` | eigen count | ✅ | RS dialog modalAnalysis (on demand) |
| `combos[].cases[{name,scale}]`, type add/srss/absolute/envelope | combination | ✅ | `rcmodel.js` mix() + designSources |
| **ensureAutoCombos** | ETABS DConS parity | ✅ | 1.4D, 1.2D+1.6L, 0.9D, D+0.75L(A/B) |
| `autoSeismic {ss,s1,…}` | ASCE 7 params | ❌ **defined, not wired** | no auto lateral generator yet |
| `autoWind {speed,…}` | ASCE 7 wind | ❌ **defined, not wired** | same |
| `rsFunctions`, `thFunctions` | Sa(T)/time series | ✅ | rsDialog / timeHistoryAnalysis |
| `massSource` | modal mass | ✅ | lumpedMass extra (RS path) |
| `mesh.size` | shell mesh (m) | ✅ | `rcmodel.js:197` wall/slab grid |
| `diaphragms`, `constraints` | rigid ties | ◐ | rigidLinks hook exists in solver; no UI pass |
| `linkProps`, `tendonProps`, `cableSections`, `solidSections` | other elements | ❌ **defined, not analyzed** | registries only |
| `pointSprings/lineSprings/areaSprings` | supports | ✅ | `augmentModel` → nodalSprings |
| `piers/spandrels` labels | wall strips | ✅ | wall design rows + spandrel design |

**Patterned live load (ETABS PatternLiveFactor [ETABS] `cConcreteCode_ACI_318_08.cs:405` = 0.75):**
```
// rcmodel.js:746 ensureAutoCombos — skip-live parity
mk('D+0.75L(A)', [{name: DEAD.name, scale: 1.0}, {name: LIVE.name + '#A', scale: 0.75}]);
// rcmodel.js buildLoads2: '#A/#B' virtual cases gate entity loads by parity
if (wantParity != null && entParity.get(owner.id) !== wantParity) continue;
```
Basis: ACI 318-19 §5.3.1(b) alternate / skip-live factoring (0.75L patterned).

## 1.4 Sync Model → Define

Catalogs drawn elements into sections by dimensions (find-or-create, `ensureAutoSection`),
stamps `params.designSection`. Pure bookkeeping — no equations.

---

# 2. ASSIGN TAB (tool by tool)

| Tool | Inputs | Where consumed |
|---|---|---|
| **Frame Sections** | section name | design + stiffness path (§1.2) |
| **Area Sections** | slab/wall section | thickness → shell t (`rcmodel.js`), wall design |
| **Reset to Auto** | — | clears manual `designSectionManual` |
| **Frame Loads** | w kN/m, P kN, pattern, gravity/up/gx/gy | `rcmodel.js buildLoads2` → consistentUDL equivalent loads |
| **Surface Loads** | q kN/m², pattern, down/up | `rcmodel.js` shells: nodal q·A/4 — ACI §5.2 distribution |
| **Joint Loads** | fx/fy/fz | nodal vector |
| **Point Springs** | k1..k3 | solver diagonal (Winkler) — theory, not ACI |
| **Material Overwrite** | material name | overrides section material |
| **Design Procedure** | concrete/nodesign | filters design passes |
| **Frame Releases** | pin M3 at i/j | `applyReleases` moment release — §6.2.5 idealization |
| **End Length Offsets** | auto or user eoI/eoJ, RZF | **ETABS semantics**: analysis stays centerline; design forces at faces — forces at member faces, not centerline. `rcmodel.js` offI/offJ + `rcbeam.js:270` stationAt(offI) |
| **Base Fixity** | fixed/pinned | support BC `rcmodel.js` fixAll/fixPin |
| **Pier / Spandrel Labels** | P1/S1 | wall design reporting, spandrel grouping |
| **Diaphragms / Strips** | names | slab strip design grouping (v1 auto strips) |

---

# 3. ANALYZE TAB (tool by tool)

**Run Analysis** — direct-stiffness FEA (`fea.js`): 12-DOF frames, 20-DOF Mindlin shells,
skyline UᵀDU factorization, one factorization for all patterns. Equilibrium checked
(reactions = Σloads, 0.9% at 1 m mesh demo).
```
// fea.js assembleAndSolveMulti — factor once, solve per pattern
const U = skySolve(fvecs[p]);        // UᵀDU substitution
framesArr.push(frameInfo.map(fi => { /* f = Kl·ud − feq */ }));
```
Physics: stiffness method (textbook, same as ETABS SAPFire conceptually).

**Response Spectrum / Time History** — CQC-ready modal via subspace iteration
(`modalAnalysis`, Guyan condensation); Newmark-β (γ=½, β=¼ — linear, unconditionally
stable, classic formulation) for TH; Rayleigh damping ζ from `damping.modalRatio`.

**Diagrams (M3/V3)** — station statics from end forces + loads:
```
// rcmodel.js:700 M(x) = Mi + Vi·x − wy·x²/2 − ΣP⟨x−a⟩
let M = f.forces[5] + (-f.forces[1]) * x;
M += -wy * x * x / 2;
```

**Deflection button** — three engines, three datums (all ACI Ch. 24 or pure stiffness):
1. `beamDeflections` — elastic line M/EI double integration, **chord-relative** (span datum)
2. `serviceDeflections` — **cracked** ACI Ch. 24 (the service-deflection check)
3. `elementDeflections` — slab support/total/bending, column drift, story drifts

**Force Table / Show Tables / Story Results / Element Data** — reporting surfaces over the same
result arrays (Joint Displacements, Base Reactions, Design Forces — beams/columns,
Story Drifts, Slab Deflections, Material List — ETABS `cTable*` schemas).

**Deflected shape / Property Lines / Results View** — display modes
([ETABS] `eObjectRepresentationTypes` ClineAndMidPlane / `ResultDisplayTypes`).

---

# 4. DESIGN TAB (tool by tool, every equation)

## 4.1 Beam Design — `designAllBeams` (`rcbeam.js:230`)

Demand: ENVELOPE across combos (per-station max — ETABS Ast-profile parity), faces from
end offsets (`stationAt(offI)`, §3 End Length Offsets above).

| # | Equation | ACI 318-19 | Code |
|---|---|---|---|
| 1 | a = As·fy/(0.85 f'c b); As = Mu/(φ fy (d−a/2)) | §22.2.2.4.1, §22.3 | `rcbeam.js:41-48` |
| 2 | φ by εt (0.9 / 0.65 / linear) | Table 21.2.2, §21.2.2 | `rcbeam.js:12-18` |
| 3 | a_max at εt = εty+0.003 (tension-controlled) | §9.3.3.1 | `rcbeam.js:44` |
| 4 | As,min = max(0.25√f'c, 1.4)/fy·bw·d | §9.6.1.2 | `rcbeam.js:299` |
| 5 | As,max = 0.04·bw·d | [ETABS] MaxAstRatio 0.04 (`cDsnCodeConcRC_ACI_05.cs:135`) | `rcbeam.js:300` |
| 6 | Vc = 0.17λλs√f'c·bw·d (λs size effect) | §22.5.5.1(.3) | `rcbeam.js:127-131` |
| 7 | Vs = Av·fyt·d/s; Vs ≤ 2.1√f'c·bw·d | §22.5.5.5? (cap §22.5.1.2) | `rcbeam.js:138` |
| 8 | Av,min/s = max(0.062√f'c,0.35)bw/fyt | §9.6.3.4 | `rcbeam.js:151` |
| 9 | Stirrup s: min(600,d/2); high shear min(d/4,100,6db,150) | [ETABS] `_05.cs:23-38` (ACI §9.7.6.2 family) | `rcbeam.js:409+` |
| 10 | ld = fy·ψt·db/(2λ√f'c) ≥ 300, ψt=1.3 top | §25.4.2.3 + §25.4.2.1 | `rcbeam.js:162` |
| 11 | Torsion: Tth 0.061√f'c·Acp²/pcp; Tmax 0.083…; Tcr 0.66… | Ch. 22.7 (§22.7.4, 22.7.6, 22.7.5) | `rcbeam.js:174+` |
| 12 | Torsion steel At/s = Tu/(2·0.85Aoh·fyt); Al = (At/s)pcp | §22.7.6.1, §9.7.5.1 | `rcbeam.js:186-189` |
| 13 | Deflection (cracked, in Element Data) | Ch. 24 — §4.5 below | `rcmodel.js:947` |

```
// rcbeam.js:127 designShear — one-way shear
let Vc = 0.17 * lambda * Math.sqrt(fc) * bw * d;     // ACI 22.5.5.1 (SI; = 2√psi)
const VcMax = 0.83 * lambda * Math.sqrt(fc) * bw * d;
```

## 4.2 Column Design — `designAllColumns` (`rccolumn.js:214`)

| # | Equation | ACI 318-19 | Code |
|---|---|---|---|
| 1 | Fiber PM sweep: εcu=0.003, α=0.85, β1, φ(εt) | §22.2.2.1, 22.2.2.4, T21.2.2 | `rccolumn.js:56` |
| 2 | φPn cap = 0.80·P0 tied / 0.85 spiral | §22.4.2 | `rccolumn.js` P0 anchor |
| 3 | Displaced-concrete deduction (bar in block) | §22.2.2.4.5? (net area) | sweep loop |
| 4 | Biaxial capacity methods (vec/sum/ray/axial, MaxOfAll) | [ETABS] `cPMMSurface.cs:348-519` (CSiCol fiber §22.2) | `rccolumn.js:251` |
| 5 | ρ ∈ [0.01, 0.08] | Table 10.6.1.1 | layout accept |
| 6 | min ecc e = max(20, h/30, b/30) | §6.2.5 (historical; [ETABS] pref) | `rccolumn.js` eMin |
| 7 | Column shear Vc(Nu) branches + Vs cap + φVn=0.8(Vc+Vs) | [ETABS] `_ACI_08.cs:132-147` (ACI 318-08 §11.3 SI) | `rccolumn.js:373` |
| 8 | Joint shear φVn = 0.85·γ·√f'c·bj·hc; γ 1.66/1.25/1.0 | [ETABS] φ JointShear 0.85; γ ACI 21.3.4 (SI) | `rccolumn.js:297` |

```
// rccolumn.js:373 columnNetShearCapacitySI — ETABS port (psi→SI annotated inline)
const val3 = 0.291 * sq * Acv * Math.sqrt(1 + Math.max(Nu, 0) / (3.45 * Ag));
let Vs = Math.min(Av * fyt * h / s, 0.664 * sq * Acv);
const phiVn = 0.8 * (Vc + Vs);       // [ETABS] hardcoded 0.8 (ACI-08 vintage)
```

## 4.3 Wall Design — `designAllWalls` (`rcwall.js:252`)

| # | Equation | ACI 318-19 | Code |
|---|---|---|---|
| 1 | Pier forces: P = ΣN22·w, V = ΣN12·w, M = ΣN22(x−x̄)w at base+top | [ETABS] pier integration | `rcwall.js` wallCut |
| 2 | Wall PM fiber curve | §22.2 family | `rcwall.js:47` |
| 3 | Vc = αc·0.17√f'c·Aw·(axial); αc 3.0→2.0 over hw/lw 1.5→2 | §11.5.4.3 | `rcwall.js:122-131` |
| 4 | Vc ≤ 0.66√f'c·Aw | §11.5.4.3 cap | `rcwall.js:134` |
| 5 | ρv,min = 0.0015; ρh escalation when Vu>0.5φVc | Table 11.6.1, §11.6.3 | `rcwall.js` rho blocks |
| 6 | SBE check (boundary elements) | §18.10.6 | `rccolslab.js` checkSBE |
| 7 | Spandrels: jamb-cut N11 → Mu, Vu, As, Avh/s | [ETABS] `SpandrelDesignResult` schema | `rcwall.js:377` |

φ = 0.75 shear (§21.2.4 SI table); [ETABS] decompiled path hardcodes 0.8 — we keep 0.75
(ACI-19 correct), documented difference.

## 4.4 Slab Design — `designAllSlabs` (`rcslab.js`) + Slab Design View (`rcview.js`)

| # | Equation | ACI 318-19 | Code |
|---|---|---|---|
| 1 | As per meter from M11/M22 (Whitney, same flexure as beams) | §22.2/22.3 | `rcslab.js:12` |
| 2 | As,min = 0.0018·b·h | §7.6.1.1 | `rcslab.js:22` |
| 3 | s_max = min(3h, 450) | §7.7.2.3 | `rcslab.js` sMax |
| 4 | One-way shear peak-Q vs 0.17√f'c·b·d | §22.5.5.1 | `rcslab.js:195` |
| 5 | Punching: Jc geometry, γv = 1−1/(1+0.677√(b2/b1)) | §8.5.3.1 (γv; 0.677 = 2/3·√ratio) | `rcslab.js:48+` |
| 6 | Punching Vc = 0.17(1+2/β), 0.083(αs d/bo+2), 0.33√f'c | **Table 22.6.5.2 (SI)** — see §5 bug fix | `rcslab.js:92` |
| 7 | Drop panels: d at panel, perimeter at drop edge | §8.2.3 (critical section at change) | `rccolslab.js` |
| 8 | Strips both directions at mesh stations; As/AsMin/Vu/Avmin | [ETABS] `Concrete Slab Design - Flexure and Shear Data` schema | `rcview.js designSlabStrips` |

```
// rcslab.js:92 — FIXED this review (was psi coefficients: (2+4/β),4 → ×12 overstatement)
const Vc1 = 0.17 * (1 + 2 / beta) * sqrtFc * bo * d;
const Vc2 = 0.083 * (alphaS * d / bo + 2) * sqrtFc * bo * d;
const Vc3 = 0.33 * sqrtFc * bo * d;
```

## 4.5 Deflection engines — ACI Ch. 24 (`rcmodel.js`)

| # | Equation | ACI 318-19 | Code |
|---|---|---|---|
| 1 | Ec = 4700√f'c | §19.2.2.1(b) | `rcmodel.js:938` |
| 2 | fr = 0.62λ√f'c | §24.2.3.6 | `rcmodel.js:942` |
| 3 | Mcr = fr·Ig/yt | §24.2.3.5 | `rcmodel.js:943` |
| 4 | Ie = Icr + (Ig−Icr)(Mcr/Ma)³ ≤ Ig (per-station) | §24.2.3.5 (Branson) | `rcmodel.js:947+` integ() |
| 5 | λΔ = ξ/(1+50ρ'), ξ = 2.0 | §24.2.4.1 | `rcmodel.js` lambdaLT |
| 6 | δLT = (1+λΔ)·δD + δL | §24.2.4 usage | serviceDeflections |
| 7 | Limits: δL ≤ L/360; δtotal,LT ≤ L/240 | Table 24.2.2 | `rcmodel.js` lim360/lim240 |
| 8 | Slab 3 datums: support / total / panel bending | displacement semantics | `elementDeflections` |

```
// rcmodel.js serviceDeflections — the Branson interpolation, per station
const Ie1 = M1 >= Mcr ? Math.min(Icr + (Ig - Icr) * Math.pow(Mcr / M1, 3), Ig) : Ig;
slope.push(slope[i] + 0.5 * (M1/(Ec*Ie1) + M2/(Ec*Ie2)) * dx);   // M/EI double integration
```

## 4.6 Connections & Foundation

| Tool | Equations | ACI | Code |
|---|---|---|---|
| Punching Check | Table 22.6.5.2 + γv 8.5.3.1 | as slab | `rccolslab.js designPunchingShear` |
| SBE Check | c ≥ cw/2… stress-limit & NA-depth | §18.10.6.2/.3 | `rccolslab.js checkSBE` |
| Foundation | one-way 0.17√f'c; two-way Table 22.6.5.2; bearing φ0.85f'cA1√(A2/A1)≤2; flexure §22; ρmin 0.0018 | §16.3.1(10.17.1), §13.3 (mat), §7.6.1.1 | `rccolslab.js designFooting` |
| Auto-Size | DCR loop re-analysis | — (optimization) | `rcmodel.js optimizeDesign` |

---

# 5. Findings from this review (act on them)

1. **BUG FIXED — punching psi/SI mix (critical):** `rcslab.js` punching and
   `rccolslab.js` footing two-way used psi-form coefficients on MPa f'c → capacity
   overstated ~12×. Converted to SI Table 22.6.5.2 forms; regression test now locks
   the hand value φVc = 461.5 kN (400 col, d=165, fc=25, bo=2260). 32/32 tests pass.
2. **Unused Define values (honest gaps):** material `iso.a` (thermal), stress-strain
   curve fields (`strainAtFc`…), `tempProps`, `autoSeismic`, `autoWind`,
   `linkProps/tendonProps/cableSections/solidSections` (registries exist, no elements
   analyzed), diaphragm rigid-tie assignment UI. These are define-only today.
3. **ETABS-sourced (not ACI) items, kept by design:** As,max 0.04; stirrup-spacing
   tight rule; column φVn = 0.8(Vc+Vs); joint γ set; PatternLiveFactor 0.75 —
   each cites its decompiled line in §4.
4. **Vintage difference:** wall φ 0.75 (ACI-19) vs [ETABS] 0.8 hardcode — kept 0.75.

*Generated 2026-10-12 against commit 6d0934c + the punching fix. Every snippet above is
verbatim from the working tree at review time.*


---

# 6. APPENDIX A — Worked numeric examples (hand-checks you can repeat)

## A.1 Beam service deflection — beam 300×600, L = 6 m, f'c = 25, fy = 500

```
Ec  = 4700·√25            = 23 500 MPa            (§19.2.2.1.b)
Ig  = 300·600³/12         = 5.4×10⁹ mm⁴
yt  = 300 mm
fr  = 0.62·√25            = 3.10 MPa              (§24.2.3.6)
Mcr = fr·Ig/yt            = 3.10·5.4e9/300
                          = 55.8×10⁶ N·mm = 55.8 kN·m   (§24.2.3.5)
Ma (demo, 1.0D)           ≈ 15 kN·m  <  Mcr  →  UNCRACKED, Ie = Ig
```
Because Ma < Mcr the Branson term (Mcr/Ma)³ is skipped and the elastic line integrates
with gross EI. From the app run (verified in browser): **δD = 2.02 mm, δL = 0.38 mm**;
long-term (§24.2.4.1, ξ = 2.0, ρ' = 0 → λΔ = 2.0):
```
δLT = (1 + 2.0)·2.02 + 0.38 = 6.44 mm
Limits (Table 24.2.2): L/360 = 16.67 mm (δL 0.38 OK) · L/240 = 25 mm (δLT 6.44 OK)
```
Cracked branch check (a beam with Ma = 80 kN·m > Mcr): Icr from kd-solve ≈ 7.46×10⁸ mm⁴,
Ie = Icr + (Ig−Icr)(55.8/80)³ ≈ 2.6×10⁹ mm⁴ — the code evaluates this **per station**
(`rcmodel.js` serviceDeflections integ loop), which is why the integration uses
station-pair EI averages, not one global Ie.

## A.2 Punching — interior column 400×400, d = 165, f'c = 25 (the regression lock)

```
b1 = b2 = 400+165 = 565 · bo = 2(565+565) = 2260 mm          (§22.6.4.1)
β = 1, αs = 40 (interior)
Vc(a) = 0.17(1+2/1)·√25·2260·165 = 2.55·372 900  = 950.9 kN
Vc(b) = 0.083(40·165/2260 + 2)·5·372 900        = 761.4 kN
Vc(c) = 0.33·√25·2260·165     = 1.65·372 900    = 615.3 kN  ← governs
φVc  = 0.75·615.3                                = 461.5 kN  (Table 21.2.2 φ=0.75)
```
This exact value is asserted in `scratch/test-shell-integration.js` — the test that
caught the psi/SI bug (the old code computed 5.5 MN here).

## A.3 Column PM point (one sweep station)

400×400, 8Ø20 (Ast = 2513 mm²), cover 40: c = 150 mm station:
```
a   = 0.85·150 = 127.5 mm
Cc  = 0.85·25·400·127.5                = 1083.8 kN
εs  = 0.003(320−150)/150 = 0.0034 > εy → steel yields; top bars in block: −0.85f'c·As
φ(εt = 0.0034 > εty+0.003? borderline)  → φ ≈ 0.87 (transition §21.2.2)
P   ≈ Cc + ΣFs ≈ 1150 kN, M from lever arms about centroid
```
The sweep runs tension → pure compression with the non-monotonic repair and the
0.80P0 anchor (§22.4.2) — `rccolumn.js:56 generatePMCurve`.

## A.4 Wall base integration (pier forces)

For the demo shaft wall the base cut integrates the shell row:
P = Σ(−N22)·w = tributary gravity · V = ΣN12·w · M = Σ(−N22)(x−x̄)w — validated
against support reactions (0.9 % equilibrium at 1 m mesh).

---

# 7. APPENDIX B — Units & the psi→SI conversion table

All internals are N·mm·MPa. Every √f'c coefficient in the codebase, with its psi origin:

| psi form (ACI US) | SI form (code) | ratio | Used in |
|---|---|---|---|
| 2√f'c | 0.17√f'c | ×0.083 | beam/slab one-way Vc (§22.5.5.1) |
| 4√f'c | 0.33√f'c | ×0.083 | punching (c) (Table 22.6.5.2) |
| 6√f'c | 0.50√f'c | ×0.083 | punching (a) at β=1 |
| 8√f'c | 0.66√f'c | ×0.083 | Vs cap, wall cap |
| 10√f'c | 0.83√f'c | ×0.083 | Vc max |
| (2+4/β)√f'c | 0.17(1+2/β)√f'c | ×0.083 | punching (a) — the fixed line |
| 3.5√f'c | 0.29√f'c | ×0.083 | column Vc branch (ETABS port) |
| 7.5√f'c fr | 0.62√f'c | ×0.083 | modulus of rupture (§24.2.3.6) |
| 500/2000/2500 psi axial terms | 3.45/13.79/17.24 MPa | ×0.00689 | column Vc(Nu) |

**This table is why the review found the punching bug**: the (2+4/β) family is the only
place where psi coefficients had leaked into MPa arithmetic.

---

# 8. APPENDIX C — Data flow (Define → results)

```
DEFINE registries ──┐
                    ├─► buildModel (rcmodel.js:46)
ASSIGN stamps ──────┤     nodes/frames/shells · end offsets · snapping · beam auto-mesh
                    │     wall openings voided · drilling constraints by shell normal
                    ▼
        assembleAndSolveMulti (fea.js)  ── skyline UᵀDU factor ONCE
                    │                     per-pattern solves + reactions from K₀ snapshot
                    ▼
        rcResults { patterns[].members/stations, combos[], reactions[], shells[], U }
                    ▼
   DESIGN  (ENVELOPE over combos via designSources)
     beams  → As/stirrups/dev/torsion        (ACI 9/22/25)
     cols   → fiber PM + biaxial + shear + joint
     walls  → pier PM + αc shear + spandrels
     slabs  → flexure strips + one-way + punching
     defl.  → Ch.24 cracked Ie + λΔ  (serviceDeflections)
                    ▼
   DISPLAY (diagrams, deflected shape, Show Tables, Element Data,
            Property Lines, Results View, Slab Design window)
```

---

# 9. APPENDIX D — Unused Define values: proposed wiring

| Value | Proposed consumer |
|---|---|
| `iso.a` thermal | thermal strain load case → nodal ΔT loads |
| `conc.strainAtFc/strainUltimate` | replace Whitney with Hognestad in PM fiber (research) |
| `autoSeismic {ss,s1,tl,r,ie…}` | ASCE 7-16 Eq. 12.8-x base-shear → static X/Y lateral patterns |
| `autoWind {speed,exposure…}` | ASCE 7-16 Ch.27 qz → wall projected pressure loads |
| `tendonProps/linkProps/cables` | new element kernels (tendon = prestress losses; links = nonlinear) |
| `diaphragms` | rigid-tie master/slave sets in augmentModel (solver hook exists) |
| `tempProps` | f'c(t), creep coefficient for λΔ > 2.0 |

---

# 10. APPENDIX E — ACI 318-19 clause index (as cited in this review)

§5.3.1(b) pattern live · §6.2.5 min eccentricity · §6.6.3.1.1 stiffness modifiers ·
T7.6.1.1 / §7.7.2.3 slab min-steel/spacing · §8.2.3 drop-panel critical section ·
§8.5.3.1 γv · §9.3.3.1 tension-controlled · §9.6.1.2 As,min · §9.6.3.4 Av,min ·
§9.7.5.1 torsion longitudinal · §9.7.6.2 stirrup spacing · T10.6.1.1 column ρ limits ·
§11.5.4.3 wall αc shear · T11.6.1 wall min steel · §11.6.3 Vu>0.5φVc · §13.3 mats ·
§16.3.1(10.17.1) bearing · §18.10.6 SBE · §19.2.2.1.b Ec · T21.2.2 φ ·
§22.2.2.1 εcu · §22.2.2.4.1 α · T22.2.2.4.3 β1 · §22.3 flexural strength ·
§22.4.2 axial cap · §22.5.1.2 Vs cap · §22.5.5.1 Vc · §22.7.4/22.7.5/22.7.6 torsion ·
T22.6.5.2 punching Vc · §24.2.2 deflection limits · §24.2.3.5 Mcr/Ie · §24.2.3.6 fr ·
§24.2.4.1 λΔ · §25.4.2.1/25.4.2.3 development.
