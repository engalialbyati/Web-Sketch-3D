'use strict';
// ---------------------------------------------------------------------------
// Tool registry. Combines the two tool families into the flat id -> class map
// the app dispatches on. Free tools direct-model the B-Rep; BIM tools create
// parametric primitives through the same model + transaction manager.
// ---------------------------------------------------------------------------
const TOOLS = {
  // tools/free/*
  select: FreeTools.SelectTool, edgeselect: FreeTools.EdgeSelectTool, line: FreeTools.LineTool, rect: FreeTools.RectTool,
  // polyline = the Line tool's chained mode under its own name (click-click-
  // click chains; Esc/double-click ends) — one entry point, discoverable
  polyline: FreeTools.LineTool,
  circle: FreeTools.CircleTool, polygon: FreeTools.CircleTool, arc: FreeTools.ArcTool, pushpull: FreeTools.PushPullTool,
  move: FreeTools.MoveTool, rotate: FreeTools.RotateTool, scale: FreeTools.ScaleTool,
  offset: FreeTools.OffsetTool, paint: FreeTools.PaintTool, eraser: FreeTools.EraserTool,
  trim: FreeTools.TrimTool, mirror: FreeTools.MirrorTool, array: FreeTools.ArrayTool,
  edgeoffset: EdgeOffset.EdgeOffsetTool,
  'rebar-straight': Rebar.StraightRebarTool, 'rebar-lshape': Rebar.LShapeRebarTool,
  'rebar-stirrup': Rebar.StirrupRebarTool,
  'rebar-ushape': Rebar.UShapeRebarTool, 'rebar-bent': Rebar.BentShapeRebarTool, 'rebar-helical': Rebar.HelicalRebarTool,
  'rebar-bbs': Rebar.BbsTool,
  'rebar-column': ColumnRebar.ColumnRebarTool,
  'rebar-element': ElementRebar.ElementRebarTool,
  revolve: FreeTools.RevolveTool, followme: FreeTools.FollowMeTool,
  align: FreeTools.AlignTool, refplane: FreeTools.RefPlaneTool, splitwall: FreeTools.SplitWallTool,
  // structural analysis + design command buttons (not interactive tools)
  'analyze-run': class { constructor(app) { this.app = app; } activate() {} get id() { return 'analyze-run'; } get hint() { return 'Run Analysis: extract the FEA mesh, apply ACI 318-19 load combinations, solve, and browse forces, reactions and drift.'; } onDown() { if (window.AnalysisUI) window.AnalysisUI.analyzeDialog(this.app); } },
  'analyze-design': class { constructor(app) { this.app = app; } activate() {} get id() { return 'analyze-design'; } get hint() { return 'Design All: ACI 318-19 capacity checks on every beam and column from the last analysis.'; } onDown() { if (window.AnalysisUI) window.AnalysisUI.designDialog(this.app); } },
  'analyze-diagrams': class { constructor(app) { this.app = app; } activate() {} get id() { return 'analyze-diagrams'; } get hint() { return 'Diagrams: display moment, shear and axial force diagrams plus the deformed shape on the model (from the last analysis).'; } onDown() { if (window.AnalysisDiagrams) window.AnalysisDiagrams.show(this.app, 'moment', 0); } },
  'analyze-modal': class { constructor(app) { this.app = app; } activate() {} get id() { return 'analyze-modal'; } get hint() { return 'Modal Analysis: natural frequencies and periods from self-weight mass, with animated mode shapes.'; } onDown() { if (window.AnalysisUI) window.AnalysisUI.modalDialog(this.app); } },
  'design-beams': class { constructor(app) { this.app = app; } activate() {} get id() { return 'design-beams'; } get hint() { return 'Beam checks: \u03c6Mn \u2265 Mu, \u03c6Vc+\u03c6Vs \u2265 Vu, min/max steel.'; } onDown() { if (window.AnalysisUI) window.AnalysisUI.designDialog(this.app); } },
  'design-columns': class { constructor(app) { this.app = app; } activate() {} get id() { return 'design-columns'; } get hint() { return 'Column checks: P-M interaction via strain compatibility.'; } onDown() { if (window.AnalysisUI) window.AnalysisUI.designDialog(this.app); } },
  'design-check': class { constructor(app) { this.app = app; } activate() {} get id() { return 'design-check'; } get hint() { return 'Full ACI 318-19 design report with DCR color coding.'; } onDown() { if (window.AnalysisUI) window.AnalysisUI.designDialog(this.app); } },
  tape: FreeTools.TapeMeasureTool, orbit: FreeTools.OrbitTool, pan: FreeTools.PanTool,
  zoom: FreeTools.ZoomTool, resize: FreeTools.ResizeTool, extrude: FreeTools.ExtrudeCurveTool,
  // annotations (Phase 3) — dimension/tag/text/spot drawing tools
  dim: Annotate.DimensionTool, tag: Annotate.TagTool,
  text: Annotate.TextTool, spot: Annotate.SpotTool,
  dimang: Annotate2.AngularDimTool, dimrad: Annotate2.RadialDimTool,
  cloud: Annotate2.CloudTool, region: Annotate2.RegionTool,
  section: Annotate2.SectionTool, elevmark: Annotate2.ElevationTool,
  ramp: Arch2.RampTool, ceiling: Arch2.CeilingTool, sweep: Arch2.SweepTool, curtain: Arch2.CurtainTool,
  stripfoot: Struct2.StripFootingTool, brace: Struct2.BraceTool, plate: Struct2.PlateTool,
  // tools/bim/*
  draw: BimTools.DrawTool, wall: BimTools.WallTool, floor: BimTools.FloorTool,
  convert: BimTools.ConvertTool,
  door: BimTools.DoorTool, window: BimTools.WindowTool, opening: BimTools.OpeningTool,
  measurearea: BimTools.MeasureAreaTool,
  // downloaded BlenderKit element types (armed from the Element Browser)
  assetplace: AssetTools.AssetPlaceTool, assetdoor: AssetTools.AssetDoorTool,
  assetwindow: AssetTools.AssetWindowTool,
  // user/AI-coded parametric element types (Scripted Elements)
  // rooms register through the Engine feature system (features/room.js)
  scriptplace: ScriptTools.ScriptPlaceTool,
};
window.TOOLS = TOOLS;
