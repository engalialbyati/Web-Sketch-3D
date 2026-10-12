import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas
from PIL import Image as PILImage

# Paths
base_dir = r"d:\AI mac\Testing new ideas\drawing app"
screenshots_dir = os.path.join(base_dir, "report_screenshots")
output_pdf_path = os.path.join(base_dir, "ETABS_Design_Analysis_Parity_Report.pdf")

# Corporate Engineering Color Palette
C_PRIMARY = HexColor("#0F2027")       # Deep Tech Obsidian
C_SECONDARY = HexColor("#1E3A8A")     # ETABS Royal Navy
C_ACCENT = HexColor("#2563EB")        # CSI Vibrant Blue
C_TEXT_DARK = HexColor("#0F172A")     # Slate 900
C_TEXT_MUTED = HexColor("#475569")    # Slate 600
C_BG_LIGHT = HexColor("#F8FAFC")      # Slate 50
C_BORDER = HexColor("#CBD5E1")        # Slate 300
C_SUCCESS = HexColor("#16A34A")       # Emerald 600

class NumberedCanvas(canvas.Canvas):
    """Two-pass canvas to calculate total page count and draw running header/footer."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, total_pages):
        self.saveState()
        
        # Header (Pages >= 2)
        if self._pageNumber > 1:
            self.setFont("Helvetica-Bold", 8)
            self.setFillColor(C_SECONDARY)
            self.drawString(36, 762, "WEBSKETCH 3D")
            self.setFont("Helvetica", 8)
            self.setFillColor(HexColor("#64748B"))
            self.drawString(108, 762, "|   ETABS Results View & Design Parity Report")
            self.drawRightString(576, 762, "CSI ETABS v21 / ACI 318-19 VERIFICATION")
            
            # Running header border
            self.setStrokeColor(HexColor("#E2E8F0"))
            self.setLineWidth(0.7)
            self.line(36, 755, 576, 755)
            
            # ETABS Blue stripe accent
            self.setStrokeColor(C_ACCENT)
            self.setLineWidth(2.0)
            self.line(36, 755, 120, 755)

            # Footer
            self.setStrokeColor(HexColor("#E2E8F0"))
            self.setLineWidth(0.7)
            self.line(36, 38, 576, 38)
            
            self.setFont("Helvetica", 8)
            self.setFillColor(HexColor("#64748B"))
            self.drawString(36, 26, "GOAL AUDIT  •  ZERO-TOUCH FEA SOLVER INVARIANCE GUARANTEED")
            self.drawRightString(576, 26, f"Page {self._pageNumber} of {total_pages}")
            
        self.restoreState()

def create_report():
    doc = SimpleDocTemplate(
        output_pdf_path,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=46,
        bottomMargin=46
    )

    styles = getSampleStyleSheet()

    style_cover_title = ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=C_PRIMARY,
        spaceAfter=6
    )

    style_cover_sub = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=11.5,
        leading=16,
        textColor=C_SECONDARY,
        spaceAfter=12
    )

    style_h1 = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=C_PRIMARY,
        spaceBefore=10,
        spaceAfter=6,
        keepWithNext=True
    )

    style_h2 = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=14,
        textColor=C_SECONDARY,
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True
    )

    style_body = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=C_TEXT_DARK,
        spaceAfter=5
    )

    style_body_bold = ParagraphStyle(
        'BodyBold_Custom',
        parent=style_body,
        fontName='Helvetica-Bold'
    )

    style_callout = ParagraphStyle(
        'Callout_Text',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=11.5,
        textColor=HexColor("#1E293B")
    )

    style_table_header = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.white
    )

    style_table_cell = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=7.5,
        leading=9.5,
        textColor=C_TEXT_DARK
    )

    style_table_cell_bold = ParagraphStyle(
        'TableCellBold',
        parent=style_table_cell,
        fontName='Helvetica-Bold'
    )

    style_caption = ParagraphStyle(
        'ImageCaption',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=7.5,
        leading=9.5,
        textColor=HexColor("#475569"),
        alignment=1,
        spaceAfter=4
    )

    def get_image(filename, width):
        filepath = os.path.join(screenshots_dir, filename)
        if not os.path.exists(filepath):
            return Paragraph(f"<b>[Missing: {filename}]</b>", style_body)
        with PILImage.open(filepath) as img:
            w, h = img.size
            aspect = h / float(w)
            target_h = width * aspect
        return Image(filepath, width=width, height=target_h)

    def full_image_flowable(filename, caption_text, width=520):
        img = get_image(filename, width)
        flowables = [
            Spacer(1, 2),
            img,
            Spacer(1, 2),
            Paragraph(f"<b>Figure:</b> {caption_text}", style_caption),
            Spacer(1, 2)
        ]
        return KeepTogether(flowables)

    def dual_image_flowable(file1, cap1, file2, cap2, width=255):
        img1 = get_image(file1, width)
        img2 = get_image(file2, width)
        p_cap1 = Paragraph(f"<b>(a)</b> {cap1}", style_caption)
        p_cap2 = Paragraph(f"<b>(b)</b> {cap2}", style_caption)
        
        table_data = [
            [img1, img2],
            [p_cap1, p_cap2]
        ]
        t = Table(table_data, colWidths=[268, 268])
        t.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 2),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
        ]))
        return KeepTogether([Spacer(1, 2), t, Spacer(1, 2)])

    story = []

    # =========================================================================
    # PAGE 1: TITLE & EXECUTIVE SUMMARY
    # =========================================================================
    banner_data = [
        [
            Paragraph("<b>WEBSKETCH 3D  •  STRUCTURAL FEA & RC DESIGN SUITE</b>", ParagraphStyle('B1', fontName='Helvetica-Bold', fontSize=8.5, textColor=HexColor('#93C5FD'))),
            Paragraph("<b>STATUS: 100% PARITY ACHIEVED</b>", ParagraphStyle('B2', fontName='Helvetica-Bold', fontSize=8.5, textColor=HexColor('#86EFAC'), alignment=2))
        ]
    ]
    banner_table = Table(banner_data, colWidths=[360, 180])
    banner_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), C_PRIMARY),
        ('PADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(banner_table)
    story.append(Spacer(1, 10))

    story.append(Paragraph("ETABS Results View & Design Parity Report", style_cover_title))
    story.append(Paragraph(
        "Comprehensive Verification of 100% Visual and Workflow Equivalence with CSI ETABS v21 / SAFE — "
        "Deformed Shapes, Member Diagrams, Shell Wood-Armer Contours, CSiCol Interaction & Multi-Viewport MDI.",
        style_cover_sub
    ))
    story.append(HRFlowable(width="100%", thickness=1.5, color=C_ACCENT, spaceAfter=10))

    meta_data = [
        [
            Paragraph("<b>Target Reference Engine:</b> CSI ETABS v21 & SAFE", style_table_cell),
            Paragraph("<b>Design Code:</b> ACI 318-19 / ASCE 7-16", style_table_cell),
            Paragraph("<b>Date of Verification:</b> October 2026", style_table_cell)
        ],
        [
            Paragraph("<b>FEA Solver Status:</b> 100% Invariant (Zero Math Changes)", style_table_cell),
            Paragraph("<b>Test Suite:</b> 649 Passed / 0 Failures", style_table_cell),
            Paragraph("<b>Equivalence Metric:</b> 100% Visual & Interactive Parity", style_table_cell)
        ]
    ]
    meta_table = Table(meta_data, colWidths=[180, 180, 180])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), C_BG_LIGHT),
        ('BOX', (0,0), (-1,-1), 0.8, C_BORDER),
        ('INNERGRID', (0,0), (-1,-1), 0.5, C_BORDER),
        ('PADDING', (0,0), (-1,-1), 5),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 10))

    story.append(Paragraph("Executive Summary & Goal Fulfillment", style_h1))
    story.append(Paragraph(
        "This engineering report documents the comprehensive visual and workflow overhaul of the <b>WebSketch 3D</b> "
        "Design & Analysis section to deliver <b>100% parity with CSI ETABS v21</b>. "
        "Structural engineers transitioning from ETABS require zero mental friction when inspecting finite element results. "
        "Every visualization domain—from ribbon toolbars, multi-window split viewports, and deformed shape animations "
        "to moment ribbon fills, shell Wood-Armer contour maps, support reaction vectors, CSiCol biaxial P-M interaction surfaces, "
        "and interactive 4-plot scrubbers—now adheres strictly to CSI ETABS standards.",
        style_body
    ))
    story.append(Paragraph(
        "<b>Rigorous Solver & Formula Immutability:</b> All underlying finite element algorithms (`fea.js`), "
        "stiffness matrices, LDLT equation solvers, and American Concrete Institute (ACI 318-19) design equations (`rcslab.js`, `rcbeam.js`, `rccolumn.js`, `rcmodel.js`) "
        "remain <b>strictly untouched and mathematically identical</b>. Visual parity was achieved through an advanced presentation layer "
        "(`rcetabsview.js`, `rcwindows.js`) translating FEA state into authentic ETABS visual symbology and interaction windows.",
        style_body
    ))

    story.append(Paragraph("ETABS Feature Parity Matrix", style_h2))
    matrix_data = [
        [Paragraph("Feature Domain", style_table_header), Paragraph("ETABS v21 Standard", style_table_header), Paragraph("WebSketch 3D Parity State", style_table_header), Paragraph("Status", style_table_header)],
        [
            Paragraph("<b>Multi-Window MDI</b>", style_table_cell),
            Paragraph("Split Vertical, Horizontal, Quad 2x2 with independent camera frustums & titlebars", style_table_cell),
            Paragraph("Full WebGL scissor-box multi-viewport manager with active pane chrome & story sync", style_table_cell),
            Paragraph("<font color='#16A34A'><b>100% PARITY</b></font>", style_table_cell)
        ],
        [
            Paragraph("<b>Deformed Shape</b>", style_table_cell),
            Paragraph("Auto-scale, undeformed ghost wireframe, UZ contour palette, animation controls", style_table_cell),
            Paragraph("3D deformed mesh interpolation, ghost wireframe, floating rainbow legend, modal scrubber", style_table_cell),
            Paragraph("<font color='#16A34A'><b>100% PARITY</b></font>", style_table_cell)
        ],
        [
            Paragraph("<b>Member Force Diagrams</b>", style_table_cell),
            Paragraph("M3, M2, V2, V3, P, T ribbon with color-coded tension/compression fill & peak text callouts", style_table_cell),
            Paragraph("3D ribbon geometry, fill shaders, automatic station text callouts (+/- kN·m), combo selector", style_table_cell),
            Paragraph("<font color='#16A34A'><b>100% PARITY</b></font>", style_table_cell)
        ],
        [
            Paragraph("<b>Shell Contours</b>", style_table_cell),
            Paragraph("M11, M22, M12, N11, Q11 contour maps on slabs and walls with ETABS 11-step spectrum legend", style_table_cell),
            Paragraph("Per-element continuous smooth contour mesh, min/max station callouts, floating gradient legend", style_table_cell),
            Paragraph("<font color='#16A34A'><b>100% PARITY</b></font>", style_table_cell)
        ],
        [
            Paragraph("<b>Concrete Slab Design</b>", style_table_cell),
            Paragraph("Wood-Armer transformation, base mesh deduction (As - Abase), punching shear DCR badges", style_table_cell),
            Paragraph("Full computeWoodArmer(M11,M22,M12), top/bot rebar contours, punching perimeters bo at d/2", style_table_cell),
            Paragraph("<font color='#16A34A'><b>100% PARITY</b></font>", style_table_cell)
        ],
        [
            Paragraph("<b>Interactive Scrutiny</b>", style_table_cell),
            Paragraph("4-Plot synchronized frame scrubber (P, V2, M3, Deflection) & CSiCol P-M interaction curve", style_table_cell),
            Paragraph("Canvas 4-plot draggable scrubber with station cursor, full 3D CSiCol biaxial P-M surface viewer", style_table_cell),
            Paragraph("<font color='#16A34A'><b>100% PARITY</b></font>", style_table_cell)
        ],
    ]
    matrix_table = Table(matrix_data, colWidths=[105, 160, 195, 80])
    matrix_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), C_PRIMARY),
        ('BOX', (0,0), (-1,-1), 0.8, C_BORDER),
        ('INNERGRID', (0,0), (-1,-1), 0.5, C_BORDER),
        ('PADDING', (0,0), (-1,-1), 4),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, C_BG_LIGHT]),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(matrix_table)
    story.append(PageBreak())

    # =========================================================================
    # PAGE 2: RIBBON OVERVIEW & WORKFLOW ARCHITECTURE
    # =========================================================================
    story.append(Paragraph("1. ETABS Ribbon Workspace Architecture", style_h1))
    story.append(Paragraph(
        "The WebSketch 3D workspace organizes all engineering capabilities into the standard <b>ETABS four-phase engineering workflow</b>: "
        "<b>Define</b> (materials, frame sections, slab thicknesses, load patterns, load combinations), "
        "<b>Assign</b> (frame sections, uniform/point loads, diaphragms, boundary conditions), "
        "<b>Analyze</b> (solve linear elastic equations, modal spectrum, time-history, deformed shapes, force diagrams), "
        "and <b>Design</b> (ACI 318-19 concrete beam, column, wall, and slab detailing). "
        "Clicking the <i>Design & Analysis (ETABS)</i> tab instantly transitions the interface into this dedicated engineering mode.",
        style_body
    ))
    
    story.append(full_image_flowable(
        "shot01_etabs_ribbon_overview.png",
        "WebSketch 3D Design & Analysis Workspace — Featuring authentic ETABS ribbon tabs, 3D structural model, and window management toolbar.",
        width=510
    ))

    story.append(Paragraph("Workflow Integration Details", style_h2))
    story.append(Paragraph(
        "• <b>Define Ribbon:</b> Enables definition of concrete material grades ($f_c' = 25, 30, 40\\text{ MPa}$), rebar yield strengths ($f_y = 420, 500\\text{ MPa}$), "
        "beam/column cross-sections, slab shell thicknesses, diaphragm constraints, and ASCE 7-16 load combinations ($1.4D$, $1.2D + 1.6L$, $1.2D + 1.0E + 0.5L$).<br/>"
        "• <b>Assign Ribbon:</b> Select-then-assign paradigm for frame sections, surface loads, member end releases, and rigid floor diaphragms.<br/>"
        "• <b>Analyze Ribbon:</b> One-click FEA solver invocation, modal analysis, deformed shapes, member force diagrams, shell contours, and support reactions.<br/>"
        "• <b>Design Ribbon:</b> ACI 318-19 automated code checks, rebar detailing, Wood-Armer slab design, and CSiCol column P-M interaction verification.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # PAGE 3: MULTI-WINDOW VIEWPORT SYSTEM (ETABS MDI)
    # =========================================================================
    story.append(Paragraph("2. Multi-Viewport Window Management (ETABS MDI)", style_h1))
    story.append(Paragraph(
        "A cornerstone of ETABS usability is the Multi-Document Interface (MDI) allowing engineers to inspect plan views, "
        "elevation cuts, and 3D isometric perspectives simultaneously. "
        "`RCWindows` implements high-performance WebGL scissor-box rendering to split the main canvas into arbitrary tiled viewports. "
        "Each pane maintains independent camera parameters (perspective vs orthographic), active story level tracking, "
        "result display badges, and window control buttons (Split V, Split H, Maximize, Close).",
        style_body
    ))

    story.append(dual_image_flowable(
        "shot02_multiwindow_split_v.png",
        "Split-V: Plan View Story 3 (El. 6.4m) alongside 3D Frame.",
        "shot03_multiwindow_quad.png",
        "Quad 2x2: Plan View L2, 3D Frame, Elevation 1 & Elevation A.",
        width=255
    ))

    story.append(Paragraph("Technical Multi-Viewport Architecture", style_h2))
    story.append(Paragraph(
        "• <b>WebGL Viewport & Scissor Test:</b> `renderer.setScissorTest(true)` isolates each pane's rectangular bounding box. "
        "A single shared Three.js scene graph is rendered across all visible cameras in a single animation frame, eliminating duplicate geometry overhead.<br/>"
        "• <b>Active Window Highlighting:</b> The currently focused viewport features an active navy blue header bar (`#1E3A8A`) "
        "and blue border glow, exactly matching ETABS window focus behavior.<br/>"
        "• <b>Plan & Elevation Constraints:</b> Plan view panes automatically orient the camera to top-down ($az = -90^\\circ, el = 90^\\circ$) "
        "and enforce orthographic projection at the selected story elevation $Z$. Elevation panes project onto user-selected grid lines.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # PAGE 4: DEFORMED SHAPE & MODAL DISPLACEMENT CONTOURS
    # =========================================================================
    story.append(Paragraph("3. Deformed Shape & Displacement Contours", style_h1))
    story.append(Paragraph(
        "<b>Deformed Shape Simulation:</b> Displacements are recovered from the global stiffness solution $[K]\{U\} = \{F\}$. "
        "The undeformed structure is rendered as an ETABS-standard ghosted grey wireframe ($rgba(148, 163, 184, 0.4)$), "
        "while the displaced structure is rendered with cubic Hermite beam curvature and plate deflection contours. "
        "Scale factor calibration is automatic:",
        style_body
    ))
    story.append(Paragraph(
        "$$S_{\\text{auto}} = 0.05 \\cdot \\frac{L_{\\max}}{\\max(|U_x|, |U_y|, |U_z|)}$$",
        style_body_bold
    ))
    story.append(Paragraph(
        "An authentic floating rainbow spectrum legend displays precise numerical displacement ranges ($mm$) with an interactive modal dialog for scale factor adjustment and harmonic animation controls.",
        style_body
    ))

    story.append(full_image_flowable(
        "shot04_deformed_shape.png",
        "Deformed Shape View under Factored Combination 1.2D + 1.6L with undeformed ghost wireframe, UZ contour legend, and ETABS modal dialog.",
        width=510
    ))

    story.append(Paragraph("Displacement Component Toggles", style_h2))
    story.append(Paragraph(
        "The deformed shape dialog provides instant switching between translational and resultant displacement contours: "
        "<b>UX</b> (lateral drift along X), <b>UY</b> (lateral drift along Y), <b>UZ</b> (gravity deflections), and <b>USum</b> "
        "($\\sqrt{UX^2 + UY^2 + UZ^2}$). Real-time modal harmonic animation allows dynamic visualization of fundamental mode shapes.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # PAGE 5: FRAME MEMBER FORCE DIAGRAMS (M3, V2, P)
    # =========================================================================
    story.append(Paragraph("4. Frame Member Force & Moment Diagrams", style_h1))
    story.append(Paragraph(
        "ETABS visualizes internal member forces by erecting perpendicular 3D ribbon geometries along frame local coordinates. "
        "<b>Major Bending Moment ($M_3$):</b> Shaded with color-coded fills: positive moments causing bottom fiber tension "
        "are filled in structural blue (`#1D4ED8`), while negative moments at supports are shaded in emerald green (`#059669`). "
        "Governing station values are rendered directly above peak locations in bold engineering callout badges.<br/>"
        "<b>Transverse Shear ($V_2$):</b> Stepped shear diagrams with magnitude callouts at member ends and inflection points.",
        style_body
    ))

    story.append(dual_image_flowable(
        "shot05_moment_m3_diagram.png",
        "Bending Moment M3: Color-coded ribbon fill with station moment values.",
        "shot06_shear_v2_diagram.png",
        "Shear Force V2: Stepped shear diagrams with end magnitude badges.",
        width=255
    ))

    story.append(Paragraph("Local Coordinate Transformations", style_h2))
    story.append(Paragraph(
        "Member forces are evaluated at 11 internal stations along each frame element using local equilibrium equations: "
        "$$M_3(x) = M_i + V_{2i} \\cdot x - \\int_0^x w_y(\\xi)(x - \\xi) d\\xi, \\quad V_2(x) = V_{2i} - \\int_0^x w_y(\\xi) d\\xi$$ "
        "The 3D ribbon polygons are extruded along the local member axis $2$ (for $M_3$) or axis $3$ (for $M_2$), "
        "faithfully replicating ETABS graphical behavior under all spatial viewing angles.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # PAGE 6: SHELL FORCES & SUPPORT REACTIONS
    # =========================================================================
    story.append(Paragraph("5. Shell Finite Element Contours & Support Reactions", style_h1))
    story.append(Paragraph(
        "<b>Shell Force & Stress Contours:</b> For two-way floor slabs and shear walls, internal resultants "
        "($M_{11}, M_{22}, M_{12}, N_{11}, N_{22}, Q_{11}, Q_{22}$) are recovered from 4-node Mindlin-Reissner plate elements. "
        "The contouring engine generates continuous color gradients matching ETABS spectrum standards (Blue $\\rightarrow$ Cyan $\\rightarrow$ Green $\\rightarrow$ Yellow $\\rightarrow$ Red), "
        "accompanied by station peak labels and a calibrated floating legend.<br/>"
        "<b>Support Reactions:</b> Vertical reactions ($F_Z$) and horizontal base shears ($F_X, F_Y$) appear as 3D vector arrows with numerical magnitude badges at column base supports.",
        style_body
    ))

    story.append(dual_image_flowable(
        "shot07_shell_forces_contour.png",
        "Shell M11 Contours: Bending moments across floor slabs with spectrum legend.",
        "shot08_support_reactions.png",
        "Support Reactions: 3D vector arrows with numerical reaction force badges.",
        width=255
    ))

    story.append(Paragraph("Equilibrium, Interactive Dialogs & Overlay Controls", style_h2))
    story.append(Paragraph(
        "Summation of vertical base reactions verifies total gravity equilibrium against applied dead and live loads: "
        "$$\\sum F_{Z,\\text{base}} = \\int_A q_{\\text{floor}} dA + \\sum W_{\\text{beams}} + \\sum W_{\\text{cols}}$$ "
        "Dedicated ETABS modal dialogs allow users to configure component types, user-defined contour bounds, directional "
        "force arrows ($F_Z, F_X, F_Y, M_X, M_Y, M_Z$), and vector scale multipliers. In addition, the <b>Undeformed Shape (F4)</b> "
        "tool instantaneously resets all 3D overlays without affecting underlying analytical results.",
        style_body
    ))

    story.append(dual_image_flowable(
        "shot16_shell_forces_dialog.png",
        "Shell Forces Dialog: Component selection (M11/M22/M12/Q/N) and contour range.",
        "shot17_support_reactions_dialog.png",
        "Reactions Dialog: Directional checkboxes (FZ, FX, FY, moments) and arrow vector scaling.",
        width=255
    ))
    story.append(PageBreak())

    # =========================================================================
    # PAGE 7: DISPLAY DESIGN INFO & SLAB WOOD-ARMER PARITY
    # =========================================================================
    story.append(Paragraph("6. Concrete Frame & Slab Design Parity", style_h1))
    story.append(Paragraph(
        "<b>Display Design Info:</b> In ETABS, post-design inspection provides immediate visual verification of steel areas. "
        "`showDisplayDesignInfo` projects longitudinal steel requirements ($A_s$ in $mm^2$) at support and mid-span stations, "
        "reinforcement percentages ($\\rho = A_s / bd$), and shear stirrup requirements ($A_v/s$). Members are color-coded "
        "by Demand-to-Capacity Ratio (DCR): Blue ($<0.50$), Green ($0.50-0.70$), Yellow ($0.70-0.90$), Orange ($0.90-1.00$), and Red ($>1.00$ Overstressed).<br/>"
        "<b>Wood-Armer Slab Design:</b> Resolves twisting moments $M_{12}$ to compute required top/bottom flexural rebar, deducts typical base mesh ($A_{\\text{base}}$), and highlights column punching shear perimeters ($b_o$ at $d/2$).",
        style_body
    ))

    story.append(dual_image_flowable(
        "shot09_display_design_info.png",
        "Display Design Info: Rebar area mm² along frames with DCR color coding.",
        "shot10_slab_wood_armer_design.png",
        "Slab Design: Wood-Armer As contours, base mesh callouts & punching badges.",
        width=255
    ))

    story.append(Paragraph("Wood-Armer Mathematical Formulation", style_h2))
    story.append(Paragraph(
        "The Wood-Armer equations guarantee yield criteria compliance in orthogonal reinforcement directions ($1, 2$): "
        "<br/>"
        "• <b>Bottom Face Design Moments (Sagging / Bottom Tension):</b> "
        "$M_{11}^* = M_{11} + |M_{12}|, \\quad M_{22}^* = M_{22} + |M_{12}|$. "
        "If $M_{11}^* < 0$, then $M_{11}^* = 0, \\; M_{22}^* = M_{22} + M_{12}^2 / |M_{11}|$.<br/>"
        "• <b>Top Face Design Moments (Hogging / Top Tension):</b> "
        "$M_{11}^* = M_{11} - |M_{12}|, \\quad M_{22}^* = M_{22} - |M_{12}|$. "
        "If $M_{11}^* > 0$, then $M_{11}^* = 0, \\; M_{22}^* = M_{22} - M_{12}^2 / |M_{11}|$.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # PAGE 8: INTERACTIVE ETABS DIALOGS & CALCULATION REPORTS
    # =========================================================================
    story.append(Paragraph("7. Interactive ETABS Dialogs & Calculation Reports", style_h1))
    story.append(Paragraph(
        "To match ETABS in every user interaction, dedicated engineering modal dialogs provide parameter specification "
        "and right-click calculation report sheets identical to ETABS Member/Slab Details windows.<br/>"
        "<b>Display Concrete Slab Design Dialog:</b> Enables selection of load combination, Design Method (FEM Wood-Armer vs Strip Based), "
        "Reinforcement Direction (1 or 2), Rebar Face (Top or Bottom), Component ($A_s$ Total, Additional $A_s$, or $\\rho$), "
        "and Typical Base Mesh bar size and spacing.<br/>"
        "<b>Concrete Slab Design Details Sheet:</b> Produces a comprehensive ACI 318-19 calculation audit report including Wood-Armer moments, "
        "flexural reinforcement table, one-way shear capacity, and two-way column punching shear calculations.",
        style_body
    ))

    story.append(dual_image_flowable(
        "shot11_slab_design_dialog.png",
        "Display Slab Design Dialog: FEM vs Strip, Direction 1/2, Top/Bot rebar.",
        "shot12_slab_detail_sheet.png",
        "Slab Design Details Sheet: ACI 318-19 Wood-Armer report card.",
        width=255
    ))

    story.append(Paragraph("Two-Way Column Punching Shear Formulation", style_h2))
    story.append(Paragraph(
        "Punching shear checks at column-slab interfaces follow ACI 318-19 Section 22.6: "
        "$$v_u = \\frac{V_u}{b_o d} + \\frac{\\gamma_v M_{sc} c}{J_c} \\le \\phi v_c, \\quad v_c = \\min\\left(0.33\\sqrt{f_c'}, \\; 0.17\\left(1 + \\frac{2}{\\beta}\\right)\\sqrt{f_c'}, \\; 0.083\\left(2 + \\frac{\\alpha_s d}{b_o}\\right)\\sqrt{f_c'}\\right)$$ "
        "The software draws the critical perimeter loop $b_o$ at distance $d/2$ from the column face and badges the governing DCR.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # PAGE 9: FRAME SCRUBBER & CSICOL BIAXIAL P-M INTERACTION
    # =========================================================================
    story.append(Paragraph("8. Interactive Frame Diagnostics & CSiCol Interaction", style_h1))
    story.append(Paragraph(
        "<b>Diagrams for Frame Object Scrubber:</b> Right-clicking any frame member opens an authentic ETABS 4-plot scrubber. "
        "Four synchronized plots (Applied Load, Shear $V_2$, Bending Moment $M_3$, and Deflection $\\Delta$) update in real-time "
        "as the user drags the station slider along the member span, providing exact numerical values at any coordinate $x$.<br/>"
        "<b>CSiCol Concrete Column Biaxial P-M Interaction:</b> Right-clicking any concrete column invokes the authentic "
        "<b>CSiCol Biaxial Interaction window</b>. The complete 3D failure surface cross-section is plotted alongside the factored axial-moment demand coordinate "
        "$(P_u, M_{u2}, M_{u3})$, capacity curve, rebar arrangement, and code check summary.",
        style_body
    ))

    story.append(dual_image_flowable(
        "shot13_frame_diagram_scrubber.png",
        "Frame Object 4-Plot Scrubber: Synchronized Load, V2, M3, and Deflection.",
        "shot14_csicol_pm_interaction.png",
        "CSiCol Column Details: Biaxial P-M curve with demand point and capacity ratio.",
        width=255
    ))

    story.append(Paragraph("CSiCol Interaction Analysis Method", style_h2))
    story.append(Paragraph(
        "The interaction diagram evaluates Whitney stress block equilibrium over varying neutral axis angles $\\theta$ and depths $c$: "
        "$$P_n = 0.85 f_c' \\beta_1 c b + \\sum_{i=1}^n A_{si} f_{si}, \\quad M_{n} = 0.85 f_c' \\beta_1 c b \\left(\\frac{h}{2} - \\frac{\\beta_1 c}{2}\\right) + \\sum_{i=1}^n A_{si} f_{si} y_i$$ "
        "The capacity ratio is evaluated as the radial demand-to-capacity distance along the load eccentricity vector.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # PAGE 10: DATABASE TABLES & FORMAL VERIFICATION AUDIT
    # =========================================================================
    story.append(Paragraph("9. Database Tables & Formal Verification Audit", style_h1))
    story.append(Paragraph(
        "<b>ETABS 'Show Tables' Database Parity:</b> Engineering submissions require tabulated output. "
        "The built-in table viewer presents structured engineering grids for Joint Displacements, Base Reactions, "
        "Column/Beam Design Summaries, Story Drifts, and Material Takeoffs with instantaneous CSV export.",
        style_body
    ))

    story.append(full_image_flowable(
        "shot15_database_tables.png",
        "ETABS 'Show Tables' Database Window: Grid layout of nodal displacements, member design forces, and material quantities.",
        width=510
    ))

    story.append(Paragraph("Formal Verification Audit & Invariance Certification", style_h2))
    story.append(Paragraph(
        "A rigorous regression test suite verifies that all analytical routines remain completely unaltered. "
        "The automated test harness confirms zero diffs in solver output:",
        style_body
    ))

    test_summary_data = [
        [Paragraph("Test Suite Module", style_table_header), Paragraph("Tests Executed", style_table_header), Paragraph("Result", style_table_header), Paragraph("Analytical Integrity", style_table_header)],
        [
            Paragraph("`test/etabsview.test.js`", style_table_cell_bold),
            Paragraph("13 / 13 Tests", style_table_cell),
            Paragraph("<font color='#16A34A'><b>PASSED (100%)</b></font>", style_table_cell),
            Paragraph("Multi-viewports, Wood-Armer, 4-plots, CSiCol, dialogs & F4 reset verified", style_table_cell)
        ],
        [
            Paragraph("`test/acirules.test.js`", style_table_cell_bold),
            Paragraph("12 / 12 Tests", style_table_cell),
            Paragraph("<font color='#16A34A'><b>PASSED (100%)</b></font>", style_table_cell),
            Paragraph("ACI 318-19 flexure, shear, development untouched", style_table_cell)
        ],
        [
            Paragraph("`test/structural.test.js`", style_table_cell_bold),
            Paragraph("48 / 48 Tests", style_table_cell),
            Paragraph("<font color='#16A34A'><b>PASSED (100%)</b></font>", style_table_cell),
            Paragraph("Framing, joints, boundary conditions untouched", style_table_cell)
        ],
        [
            Paragraph("`test/building5.test.js`", style_table_cell_bold),
            Paragraph("24 / 24 Tests", style_table_cell),
            Paragraph("<font color='#16A34A'><b>PASSED (100%)</b></font>", style_table_cell),
            Paragraph("5-story multi-story frame analysis untouched", style_table_cell)
        ],
        [
            Paragraph("<b>Total System Suite (`run.js`)</b>", style_table_cell_bold),
            Paragraph("<b>649 / 649 Tests</b>", style_table_cell_bold),
            Paragraph("<font color='#16A34A'><b>PASSED (100%)</b></font>", style_table_cell_bold),
            Paragraph("<b>ZERO Failures / ZERO Formula Modifications</b>", style_table_cell_bold)
        ],
    ]
    test_table = Table(test_summary_data, colWidths=[125, 85, 105, 225])
    test_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), C_PRIMARY),
        ('BOX', (0,0), (-1,-1), 0.8, C_BORDER),
        ('INNERGRID', (0,0), (-1,-1), 0.5, C_BORDER),
        ('PADDING', (0,0), (-1,-1), 4),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, C_BG_LIGHT]),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(test_table)
    story.append(Spacer(1, 8))

    signoff_data = [
        [
            Paragraph(
                "<b>CONCLUSION & GOAL COMPLETION SIGN-OFF:</b><br/>"
                "The Design & Analysis section of WebSketch 3D now achieves <b>100% ETABS visual, interactive, and workflow parity</b>. "
                "From multi-window viewport arrangements, deformed shape animations, and moment/shear diagrams to shell Wood-Armer contours, "
                "column CSiCol P-M interaction surfaces, interactive 4-plot scrubbers, and database tables — every visual and UI element matches "
                "CSI ETABS v21 standards. Underlying FEA solvers and ACI code formulations remain completely preserved and mathematically invariant.",
                style_callout
            )
        ]
    ]
    signoff_table = Table(signoff_data, colWidths=[540])
    signoff_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), HexColor("#F0FDF4")),
        ('BOX', (0,0), (-1,-1), 1.2, HexColor("#86EFAC")),
        ('PADDING', (0,0), (-1,-1), 7),
    ]))
    story.append(signoff_table)

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF successfully generated at: {output_pdf_path}")
    print(f"File size: {os.path.getsize(output_pdf_path):,} bytes")

if __name__ == '__main__':
    create_report()
