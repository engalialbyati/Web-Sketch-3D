'use strict';
// rebardoc.test.js — Unit tests for Rebar Detailing Documentation, AutoCAD DXF, and BBS generator.
module.exports = h => {
  const { test, ok, eq } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const sandbox = {
    window: { addEventListener() { } },
    document: { createElement: () => ({ style: {} }), getElementById: () => null },
    console,
    Buffer,
    setTimeout,
    clearTimeout
  };
  const ctx = vm.createContext(sandbox);

  for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js', 'js/features/rebardoc.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }

  const { RebarDoc } = sandbox.window;

  test('RebarDoc module exists and exposes public API', () => {
    ok(RebarDoc, 'RebarDoc loaded');
    ok(typeof RebarDoc.openSheet === 'function', 'openSheet function');
    ok(typeof RebarDoc.exportDxf === 'function', 'exportDxf function');
    ok(typeof RebarDoc.exportDxfBbs === 'function', 'exportDxfBbs function');
  });

  test('AutoCAD DXF generation: valid sections, layers, and entities', () => {
    const dxf = RebarDoc.exportDxf({
      ent: { id: 'bm_dxf_test', name: 'BEAM-101' },
      type: 'beam',
      dims: { w: 0.3, h: 0.5, l: 4.5 },
      params: { crank: 2, topN: 2, botN: 3 },
      schedule: [
        {
          mark: '01',
          desc: 'Top Longitudinal Steel',
          shape: 'lshape',
          shapeCode: '21',
          bar: { us: '#5', mm: 15.9, kgM: 1.552 },
          count: 2,
          len: 4.80,
          weight: 14.9
        },
        {
          mark: '02',
          desc: 'Bent-Up 45° Truss Bar',
          shape: 'crank',
          shapeCode: '26',
          bar: { us: '#6', mm: 19.1, kgM: 2.235 },
          count: 2,
          len: 5.10,
          weight: 22.8
        },
        {
          mark: '03',
          desc: 'Closed Rectangular Stirrups',
          shape: 'stirrup',
          shapeCode: '51',
          bar: { us: '#3', mm: 9.5, kgM: 0.560 },
          count: 22,
          len: 1.48,
          weight: 18.2
        }
      ]
    });

    ok(typeof dxf === 'string', 'DXF is string output');
    ok(dxf.includes('SECTION\r\n2\r\nHEADER'), 'contains HEADER section');
    ok(dxf.includes('$ACADVER\r\n1\r\nAC1009'), 'AC1009 AutoCAD format');
    ok(dxf.includes('$INSUNITS\r\n70\r\n4'), 'INSUNITS mm scale');
    ok(dxf.includes('SECTION\r\n2\r\nTABLES'), 'contains TABLES section');
    ok(dxf.includes('LAYER\r\n2\r\nS-BORDER'), 'S-BORDER layer');
    ok(dxf.includes('LAYER\r\n2\r\nS-CONC-OUTLINE'), 'S-CONC-OUTLINE layer');
    ok(dxf.includes('LAYER\r\n2\r\nS-REBAR-MAIN'), 'S-REBAR-MAIN layer');
    ok(dxf.includes('LAYER\r\n2\r\nS-REBAR-TIES'), 'S-REBAR-TIES layer');
    ok(dxf.includes('LAYER\r\n2\r\nS-REBAR-BENT'), 'S-REBAR-BENT layer for 45° bent bars');
    ok(dxf.includes('LAYER\r\n2\r\nS-DIMENSIONS'), 'S-DIMENSIONS layer');
    ok(dxf.includes('LAYER\r\n2\r\nS-BBS-GRID'), 'S-BBS-GRID layer for schedule');
    ok(dxf.includes('SECTION\r\n2\r\nENTITIES'), 'contains ENTITIES section');
    ok(dxf.includes('LINE'), 'LINE entities present');
    ok(dxf.includes('CIRCLE'), 'CIRCLE entities for rebar dots present');
    ok(dxf.includes('TEXT'), 'TEXT entities present');
    ok(dxf.includes('BENT-UP TRUSS BAR (45 DEG CRANK)'), 'bent-up truss text in DXF');
    ok(dxf.endsWith('EOF'), 'DXF terminates with EOF');
  });

  test('Beam with bent-up bars generates shape 26 (crank) in schedule', () => {
    const dxf = RebarDoc.exportDxf({
      ent: { id: 'bm_bent', name: 'BEAM-201' },
      type: 'beam',
      dims: { w: 0.35, h: 0.6, l: 5.0 },
      params: { crank: 2, topN: 2, botN: 4 },
      schedule: [
        { mark: '01', desc: 'Top Main', shape: 'lshape', shapeCode: '21', bar: { us: '#5', mm: 15.9, kgM: 1.55 }, count: 2, len: 5.2, weight: 16.1 },
        { mark: '02', desc: 'Bot Straight', shape: 'straight', shapeCode: '00', bar: { us: '#7', mm: 22.2, kgM: 3.04 }, count: 2, len: 4.9, weight: 29.8 },
        { mark: '03', desc: 'Bent-Up Truss 45°', shape: 'crank', shapeCode: '26', bar: { us: '#7', mm: 22.2, kgM: 3.04 }, count: 2, len: 5.4, weight: 32.8 },
        { mark: '04', desc: 'Stirrups', shape: 'stirrup', shapeCode: '51', bar: { us: '#4', mm: 12.7, kgM: 0.99 }, count: 25, len: 1.7, weight: 42.1 }
      ]
    });
    ok(dxf.includes('Bent-Up Truss 45°'), 'schedule includes bent-up truss bar');
    ok(dxf.includes('26'), 'schedule includes shape code 26');
  });

  test('Column Detailing DXF generation: cross-section, vertical elevation, and lap splice', () => {
    const dxf = RebarDoc.exportDxf({
      ent: { id: 'col_dxf_test', name: 'COL-101' },
      type: 'column',
      dims: { w: 0.4, d: 0.4, h: 3.2 },
      params: { width: 0.4, depth: 0.4, height: 3.2 },
      schedule: [
        { mark: '01', desc: 'Vertical Longitudinal Column Bars', shape: 'straight', shapeCode: '00', bar: { us: '#8', mm: 25.4, kgM: 3.973 }, count: 8, len: 4.25, weight: 135.1 },
        { mark: '02', desc: 'End Confinement Hoops (135° Hooks)', shape: 'stirrup', shapeCode: '51', bar: { us: '#3', mm: 9.5, kgM: 0.560 }, count: 16, len: 1.50, weight: 13.4 },
        { mark: '03', desc: 'Mid-Height Confinement Column Ties', shape: 'stirrup', shapeCode: '51', bar: { us: '#3', mm: 9.5, kgM: 0.560 }, count: 10, len: 1.50, weight: 8.4 }
      ]
    });
    ok(typeof dxf === 'string', 'Column DXF is string');
    ok(dxf.includes('VIEW 1: COLUMN CROSS-SECTION'), 'Column section text');
    ok(dxf.includes('VIEW 2: VERTICAL ELEVATION & CONFINEMENT HOOPS'), 'Column elevation text');
    ok(dxf.includes('CLASS B LAP SPLICE'), 'Class B lap splice callout');
    ok(dxf.includes('S-REBAR-TIES'), 'Rebar ties layer present');
    ok(dxf.endsWith('EOF'), 'DXF terminates with EOF');
  });

  test('Slab Detailing DXF generation: edge section and two-way mesh plan', () => {
    const dxf = RebarDoc.exportDxf({
      ent: { id: 'slab_dxf_test', name: 'SLAB-101' },
      type: 'slab',
      dims: { w: 4.5, l: 4.5, h: 0.2 },
      params: { thickness: 0.2 },
      schedule: [
        { mark: '01', desc: 'Bottom Primary Mesh (X-Dir)', shape: 'straight', shapeCode: '00', bar: { us: '#4', mm: 12.7, kgM: 0.994 }, count: 23, len: 4.42, weight: 101.0 },
        { mark: '02', desc: 'Bottom Secondary Mesh (Y-Dir)', shape: 'straight', shapeCode: '00', bar: { us: '#4', mm: 12.7, kgM: 0.994 }, count: 23, len: 4.42, weight: 101.0 }
      ]
    });
    ok(dxf.includes('VIEW 1: SLAB EDGE SECTION'), 'Slab edge section text');
    ok(dxf.includes('VIEW 2: TWO-WAY BOTTOM FLEXURAL MESH PLAN'), 'Slab plan text');
    ok(dxf.includes('Lx = 4.50 m'), 'Slab span dimension');
  });

  test('Foundation Detailing DXF generation: footing section and starter dowels', () => {
    const dxf = RebarDoc.exportDxf({
      ent: { id: 'fnd_dxf_test', name: 'FND-101' },
      type: 'foundation',
      dims: { w: 1.5, l: 1.5, h: 0.5 },
      params: { width: 1.5, depth: 1.5, thickness: 0.5 },
      schedule: [
        { mark: '01', desc: 'Bottom Mat X-Dir', shape: 'lshape', shapeCode: '21', bar: { us: '#6', mm: 19.1, kgM: 2.235 }, count: 10, len: 1.75, weight: 39.1 },
        { mark: '02', desc: 'Column Starter Dowels', shape: 'lshape', shapeCode: '21', bar: { us: '#7', mm: 22.2, kgM: 3.042 }, count: 4, len: 1.55, weight: 18.9 }
      ]
    });
    ok(dxf.includes('VIEW 1: FOOTING ELEVATION SECTION'), 'Footing section text');
    ok(dxf.includes('VIEW 2: BOTTOM REBAR MAT & COLUMN DOWEL PLAN'), 'Footing plan text');
  });

  test('Wall Detailing DXF generation: two curtains and boundary elements', () => {
    const dxf = RebarDoc.exportDxf({
      ent: { id: 'wall_dxf_test', name: 'WALL-101' },
      type: 'wall',
      dims: { w: 0.25, h: 3.0, l: 4.5 },
      params: { thickness: 0.25, height: 3.0 },
      schedule: [
        { mark: '01', desc: 'Vertical Wall Curtains', shape: 'straight', shapeCode: '00', bar: { us: '#5', mm: 15.9, kgM: 1.552 }, count: 46, len: 3.60, weight: 257.0 },
        { mark: '02', desc: 'Horizontal Shear Bars', shape: 'straight', shapeCode: '00', bar: { us: '#4', mm: 12.7, kgM: 0.994 }, count: 32, len: 4.42, weight: 140.6 }
      ]
    });
    ok(dxf.includes('VIEW 1: WALL SECTION'), 'Wall section text');
    ok(dxf.includes('VIEW 2: WALL ELEVATION & TWO CURTAINS'), 'Wall elevation text');
  });

  test('openSheet selects active element when user selects Column or Beam', () => {
    let openedTitle = null;
    let openedHtml = null;
    const mockApp = {
      dialog(title, html) {
        openedTitle = title;
        openedHtml = html;
      },
      toast() {},
      singleElementSelection() {
        return { id: 'col_user_sel', name: 'C1-COLUMN', type: 'column', params: { width: 0.4, depth: 0.4, height: 3.2 } };
      },
      bim: {
        entities: [
          { id: 'beam_1', name: 'B1-BEAM', type: 'beam', params: { webWidth: 0.3, height: 0.5, length: 5.0 } },
          { id: 'col_user_sel', name: 'C1-COLUMN', type: 'column', params: { width: 0.4, depth: 0.4, height: 3.2 } }
        ]
      }
    };

    RebarDoc.openSheet({ app: mockApp });
    ok(openedTitle && openedTitle.includes('C1-COLUMN'), 'Title specifies selected column');
    ok(openedHtml && openedHtml.includes('C1-COLUMN'), 'HTML contains selected column mark');
    ok(openedHtml && openedHtml.includes('VIEW 1: COLUMN SECTION'), 'Draws column section');
    ok(openedHtml && openedHtml.includes('rd-select-element'), 'Contains interactive element switcher');
    ok(openedHtml && openedHtml.includes('rd-select-style'), 'Contains interactive style switcher');
  });
};

