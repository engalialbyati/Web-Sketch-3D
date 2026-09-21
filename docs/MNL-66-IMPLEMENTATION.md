# MNL-66(20) ACI Detailing Manual — Implementation Roadmap (from the book)

Extracted directly from the PDF (MNL-66.pdf, 502 pages, 20,351 text lines).
This is the complete inventory of every detail figure in the manual, mapped
to app features with implementation status.

---

## COMPLETE DETAIL FIGURE INVENTORY

### COLUMNS (10 figures)
| Figure | Title | Status |
|---|---|---|
| COL-1 | Column Schedule | **done** (scheduleDialog) |
| COL-20 | Transverse Reinforcement Schedule | **gap** |
| COL-100 | Typical Column, Ordinary/Intermediate MF (SDC A,B,C) | **done** (singletie cage) |
| COL-101-103 | Special Moment Frame Column (SDC D,E,F) | **done** (seismic zones) |
| COL-104 | Column Supporting Wall, SDC D-F | **gap** |
| COL-200 | Column Splice Details, Non-MF | **gap** (lap splices) |
| COL-201 | Column with Capital + Spiral | **partial** (circular cage) |
| COL-202 | Bar Splice: End Bearing, Mechanical, Welded | **gap** |

### BEAMS (18 figures)
| Figure | Title | Status |
|---|---|---|
| BM-1_1-1_3 | Typical Beam Schedule | **done** (scheduleDialog) |
| BM-2_1-2_3 | Integrity Reinforcement, Perimeter | **gap** |
| BM-3_1-3_3 | Integrity Reinforcement, Non-Perimeter | **gap** |
| BM-100 | Required Integrity Reinf, Perimeter | **gap** |
| BM-101 | Integrity Reinf, Other Than Perimeter | **gap** |
| BM-102 | Beam Subjected to Torsion | **gap** |
| BM-103 | Beam, Ordinary Moment Frame SDC B | **partial** |
| BM-104 | Beam, Special Moment Frame SDC D-F | **done** (seismic zones) |
| BM-200/201 | Supported Beam into Beam/Girder | **partial** (bearing) |
| BM-202 | Beam Reinf Development at Column | **gap** (ld calc) |
| BM-203 | Beam Reinf Development at Column (Alt) | **gap** |
| BM-204 | Beam-to-Girder Connection | **gap** |
| BM-205 | Beam-to-Girder Connection (Alt) | **gap** |
| BM-206/207 | Beam with Step in Top of Slab | **gap** |
| BM-208/209 | Standard Hook Detail + Stirrup/Tie Hook | **done** (hooks) |

### SLABS (14 figures)
| Figure | Title | Status |
|---|---|---|
| SLAB-1 | One-Way Slab Schedule | **done** (scheduleDialog) |
| SLAB-2_1-2_3 | Two-Way Slab Schedule | **done** |
| SLAB-100 | Slab-to-Beam at Balcony | **gap** |
| SLAB-200/201 | Two-Way Slab Corner Reinforcement | **GAP — high priority** |
| SLAB-202/203 | Two-Way Slab at Openings | **partial** (clip, no trim bars) |
| SLAB-204 | Slope in Elevated Slab | **gap** |
| SLAB-205 | Slab with Concrete Curb | **gap** |
| SLAB-206 | Slab with Embedded Ductwork | **gap** |
| SLAB-207 | Step in Elevated Slab | **gap** |
| SLAB-208 | Slab Thickness Change/Step Bottom | **gap** |

### WALLS (18 figures)
| Figure | Title | Status |
|---|---|---|
| WALL-1_1-1_2 | Shear Wall Schedule | **done** (scheduleDialog) |
| WALL-100A/B | Basement Wall to Foundation + Shear Wall | **done** (wall rebar) |
| WALL-101A/B | Basement Wall + Shear Wall + Brick | **done** |
| WALL-102 | Exterior Wall Without Basement | **done** |
| WALL-103 | Interior Wall | **done** |
| WALL-104 | Exterior Wall Supporting Precast Beam | **gap** |
| WALL-110/111 | Diagonally Reinforced Coupling Beam | **gap** |
| WALL-120 | Cantilever Retaining Wall | **gap** |
| WALL-121 | Cantile Retaining Wall with Shear Key | **gap** |
| WALL-140-142 | Precast Wall + Footing | **gap** |
| WALL-200 | Wall Construction Joint | **gap** |
| WALL-201 | Vertical Pipe Embed in Wall | **gap** |
| WALL-202 | Single-Layer Horizontal at Corners | **done** |
| WALL-203 | Slab on Wall, Single Layer | **done** |
| WALL-204/205 | Double-Layer Wall-to-Wall Corner | **done** (two curtains) |
| WALL-206 | Door/Window Opening, Single Layer | **gap** (trim bars) |
| WALL-207 | Door/Window Opening, Two Layers | **gap** |
| WALL-208 | Wall Reinforcement at Openings | **gap** |
| WALL-220-222 | Retaining Wall Joints | **gap** |

### FOUNDATIONS (30 figures)
| Figure | Title | Status |
|---|---|---|
| FND-1 | Shallow Footing Schedule | **done** |
| FND-10 | Pedestal Reinforcement Details | **done** (starters) |
| FND-100 | Isolated Footing Supporting Column | **done** |
| FND-101-104 | Footing + Steel Column (various) | **gap** |
| FND-105/106 | Special Structural Wall on Continuous Footing | **done** |
| FND-107 | Exterior Ordinary Wall on Footing | **done** |
| FND-108 | CMU Wall on Continuous Footing | **gap** |
| FND-109 | Mat Foundation Connections | **gap** |
| FND-110 | Combined Footing at Expansion Joint | **gap** |
| FND-111-116 | Grade Beam Details (CMU, brick, stud) | **gap** |
| FND-130-132 | Elevator Pit | **gap** |
| FND-150 | Drilled Pier | **gap** |
| FND-161-166 | Pile Caps (1-6 pile) | **gap** |
| FND-200 | Slab-on-Ground Trench | **gap** |
| FND-201 | Sump in Pit | **gap** |
| FND-202-209 | Grade Beam/Step/Embed Details | **gap** |

### SLAB-ON-GROUND (12 figures)
| Figure | Title | Status |
|---|---|---|
| SOG-100 | Construction Joint (CJ) | **gap** |
| SOG-101 | Contraction Joint | **gap** |
| SOG-102/103 | Thickened SOG Supporting Wall | **gap** |
| SOG-104 | Mat Construction Joint | **gap** |
| SOG-105/106 | SOG with 12" Depression | **gap** |
| SOG-107 | SOG with 12-24" Depression | **gap** |
| SOG-108 | Thickened SOG Edge | **gap** |
| SOG-150/151 | Joint at Existing SOG (WWF/bars) | **gap** |
| SOG-200-204 | Joint Filler/Isolation/Reinforcement | **gap** |

---

## COVERAGE SUMMARY

| Category | Figures | Done | Partial | Gap | Coverage |
|---|---|---|---|---|---|
| Columns | 10 | 5 | 1 | 4 | 55% |
| Beams | 18 | 5 | 3 | 10 | 44% |
| Slabs | 14 | 3 | 1 | 10 | 29% |
| Walls | 18 | 8 | 0 | 10 | 56% |
| Foundations | 30 | 5 | 0 | 25 | 22% |
| SOG | 12 | 0 | 0 | 12 | 0% |
| **Total** | **102** | **31** | **5** | **66** | **36%** |

---

## EXECUTION PLAN (updated from the book)

### Phase 3 — Slab details (DONE c220f80)
- SLAB-200/201: Two-way slab **corner reinforcement** (per ACI 8.6.1.2)
- SLAB-202/203: Opening **trim bars** (additional steel around holes)
- SLAB-208: Slab thickness change / step in bottom

### Phase 4 — Beam connections (next)
- BM-202/203: Beam reinforcing **development length** at column (ldh, ld)
- BM-204/205: **Beam-to-girder** connection details
- BM-2/3: **Integrity reinforcement** (continuous perimeter beams)

### Phase 5 — Wall openings
- WALL-206-208: **Trim bars** around door/window openings

### Phase 6 — Column splices
- COL-200: **Lap splice** locations and lengths
- COL-202: **End-bearing / mechanical / welded** splice types

### Phase 7 — Advanced foundations
- FND-150: Drilled pier
- FND-161-166: Pile caps
- FND-109: Mat foundation
- FND-111+: Grade beams

### Phase 8 — Slab-on-ground (long tail)
- SOG-100+: All joint types and thickened edges

### Appendix (Section 4)
- Lap splice tables by bar size and fc'
- Development length formulas
- Standard hook dimensions table
- Bar support (chair) schedules

---

*Source: MNL-66.pdf in the project root — extracted with pdftotext, filtered
through copyright-watermark noise. 102 unique detail figures inventoried.*
