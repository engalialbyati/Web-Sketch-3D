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
};
