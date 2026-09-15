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
  circle: FreeTools.CircleTool, arc: FreeTools.ArcTool, pushpull: FreeTools.PushPullTool,
  move: FreeTools.MoveTool, rotate: FreeTools.RotateTool, scale: FreeTools.ScaleTool,
  offset: FreeTools.OffsetTool, paint: FreeTools.PaintTool, eraser: FreeTools.EraserTool,
  trim: FreeTools.TrimTool, mirror: FreeTools.MirrorTool, array: FreeTools.ArrayTool,
  edgeoffset: EdgeOffset.EdgeOffsetTool,
  revolve: FreeTools.RevolveTool, followme: FreeTools.FollowMeTool,
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
