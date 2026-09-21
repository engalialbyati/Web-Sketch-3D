'use strict';
// features/elementrebar.js — Whole-Element Reinforcement: one pick on any
// face of a beam / column / foundation / floor generates the full cage.
// Beam ties+rows, column reuse, footing mesh+starters, slab mesh clipping.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  function load() {
    const sandbox = { window: { addEventListener() { } }, console, Buffer, setTimeout, clearTimeout };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js',
      'js/features/rebar.js', 'js/features/columnrebar.js', 'js/features/elementrebar.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    if (!sandbox.window.ElementRebar) throw new Error('ElementRebar not exported');
    return sandbox.window;
  }
  const W = load();
  const ER = W.ElementRebar;
  const { G, Model } = W;

  // ------------------------------------------------------------ world bits
  function box(m, x0, x1, y0, y1, z0, z1) {
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings([
      G.v(x0, y0, z1), G.v(x1, y0, z1), G.v(x1, y1, z1), G.v(x0, y1, z1)]);
    m.pushPull(f, -(z1 - z0));
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    return faces;
  }
  function stamp(m, faces, id, type, params) {
    for (const fid of faces) {
      const f = m.faces.get(fid);
      if (!f.userData) f.userData = {};
      f.userData.bimEntityId = id;
      f.userData.bimType = type;
    }
    return { id, type, params, faces };
  }
  const faceWithNormal = (m, nz) => {
    for (const [id, f] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (Math.abs(n.x - nz[0]) < 1e-6 && Math.abs(n.z - nz[2]) < 1e-6) return id;
    }
    return null;
  };
  // push-pull caps share +z winding in this model — pick faces by centroid
  const faceAtZ = (m, z) => {
    for (const [id, f] of m.faces) {
      const c = m.faceCentroid(f);
      if (c && Math.abs(c.z - z) < 1e-6) return id;
    }
    return null;
  };

  // ------------------------------------------------------------------ beam
  const beamParams = () => ({ type: 'beam', beam: {
    side: 0.03, end: 0.05, tieDia: 0.008, bentAngle: 135, bentFactor: 6,
    mode: 'amount', value: 5,
    topCount: 2, topDia: 0.014, botCount: 3, botDia: 0.016,
    top: 0.03, bot: 0.03, skin: 0, skinDia: 0.012, integrity: false,
  } });
  function beamWorld() {
    const m = new Model();
    const bp = { baseline: [[0, 0, 3], [4, 0, 3]], profile: 'rectangular',
      webWidth: 0.3, height: 0.5, referenceLevelId: 'lvl1', zJustification: 'Bottom' };
    const ent = stamp(m, box(m, 0, 4, -0.15, 0.15, 3, 3.5), 'b1', 'beam', bp);
    return { m, ent };
  }

  test('beam: ties along the span + top/bottom rows at the covers', () => {
    const { m, ent } = beamWorld();
    const pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), beamParams(), [ent]);
    ok(!pv.error, pv.error || 'no error');
    eq(pv.ties, 5, '5 ties by amount');
    eq(pv.bars, 5, '2 top + 3 bottom bars');
    const ties = pv.paths.filter(p => p.dia === 0.008 && p.pts.length > 2);
    eq(ties.length, 5, 'tie centerlines');
    const xs = ties.map(p => p.pts.reduce((s, q) => s + q.x, 0) / p.pts.length).sort((a, b) => a - b);
    near(xs[0], 0.054, 1e-9, 'first tie at end cover + tie r');
    near(xs[4], 4 - 0.054, 1e-9, 'last tie at the far end cover');
    const bars = pv.paths.filter(p => p.pts.length === 2);
    const bot = bars.filter(p => Math.abs(p.pts[0].z - 3.046) < 1e-9);
    const top = bars.filter(p => Math.abs(p.pts[0].z - 3.455) < 1e-9);
    eq(bot.length, 3, 'bottom row 46mm above the soffit (cover+tie+r)');
    eq(top.length, 2, 'top row 45mm below the top');
    const ys = bot.map(p => p.pts[0].y).sort((a, b) => a - b);
    near(ys[0], -0.104, 1e-9, 'bottom row hugs the side');
    near(ys[1], 0, 1e-9, 'even spread across the web');
    for (const b of bars) {
      near(Math.abs(b.pts[1].x - b.pts[0].x), 3.9, 1e-9, 'bars the clear span long');
      near(b.pts[0].z, b.pts[1].z, 1e-9, 'bars level');
    }
  });

  test('seismic tie layout: ACI 318 zones (first 50mm, 2h @ min(d/4,125), mid @ d/2)', () => {
    const SP = ER.seismicTiePositions;
    // 4 m span, h = 0.5, d = 0.454: sc = min(0.1135, 0.125) = 0.1135, sm = 0.227
    const span = 4, h = 0.5, dEff = 0.454;
    const pos = SP(span, h, dEff);
    ok(pos.length > 10, `${pos.length} ties`);
    near(pos[0], 0.05, 1e-9, 'first tie 50 mm off the support face');
    near(pos[pos.length - 1], span - 0.05, 1e-6, 'mirror: last tie 50 mm off the far face');
    const sc = Math.min(dEff / 4, 0.125), zone = 2 * h, sm = dEff / 2;
    // every gap with BOTH ends inside a confinement zone <= sc; a gap
    // straddling the zone boundary is the first middle tie - it answers to
    // d/2 like the rest of the central portion
    for (let i = 1; i < pos.length; i++) {
      const bothInZone = pos[i] <= zone + 1e-9 || pos[i - 1] >= span - zone - 1e-9;
      if (bothInZone) ok(pos[i] - pos[i - 1] <= sc + 2e-4,
        `zone gap ${((pos[i] - pos[i - 1]) * 1000).toFixed(1)} mm <= sc`);
    }
    // every central gap <= d/2 (+ rounding)
    for (let i = 1; i < pos.length; i++) {
      if (pos[i - 1] >= zone - 1e-9 && pos[i] <= span - zone + 1e-9)
        ok(pos[i] - pos[i - 1] <= sm + 2e-4,
          `mid gap ${((pos[i] - pos[i - 1]) * 1000).toFixed(1)} mm <= d/2`);
    }
    // zones are DENSER than the middle: min zone gap < min mid gap
    const zoneGaps = [], midGaps = [];
    for (let i = 1; i < pos.length; i++) {
      if (pos[i - 1] < zone || pos[i] > span - zone) zoneGaps.push(pos[i] - pos[i - 1]);
      else if (pos[i - 1] >= zone && pos[i] <= span - zone) midGaps.push(pos[i] - pos[i - 1]);
    }
    ok(Math.min(...zoneGaps) < Math.min(...midGaps) - 1e-6, 'confinement denser than mid-span');
    // short beam: zones (2 x 2h = 2 m) cover the 1.6 m span -> all gaps <= sc
    const short = SP(1.6, 0.5, 0.454);
    for (let i = 1; i < short.length; i++)
      ok(short[i] - short[i - 1] <= sc + 2e-4, 'short span: zone spacing throughout');
    near(short[0], 0.05, 1e-9, 'short span first tie still 50 mm');
  });

  test('beam: seismic mode places ties on the ACI layout (element build)', () => {
    const { m, ent } = beamWorld();
    const p = beamParams();
    p.beam.seismic = true; p.beam.first = 0.05;
    const pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), p, [ent]);
    ok(!pv.error, pv.error || 'no error');
    const ties = pv.paths.filter(q => q.dia === 0.008 && q.pts.length > 2);
    const xs = ties.map(q => q.pts.reduce((s, r) => s + r.x, 0) / q.pts.length).sort((a, b) => a - b);
    near(xs[0], 0.05 + 0.004, 2e-3, 'first tie at 50 mm + tie r from the end');
    near(xs[xs.length - 1], 4 - 0.054, 2e-3, 'last tie mirrored');
    const dEff = 0.5 - (0.03 + 0.008 + 0.008); // h - (cover + tie + r)
    const sc = Math.min(dEff / 4, 0.125);
    let worstZone = 0;
    for (let i = 1; i < xs.length; i++) {
      // both ends of the gap inside a confinement zone (2h = 1 m here);
      // a boundary-straddling gap is the first mid-span tie (d/2 governs)
      const bothInZone = xs[i] <= 1.0 + 1e-9 || xs[i - 1] >= 3.0 - 1e-9;
      if (bothInZone) worstZone = Math.max(worstZone, xs[i] - xs[i - 1]);
    }
    ok(worstZone <= sc + 3e-3, `worst confinement gap ${worstZone.toFixed(4)} <= ${sc.toFixed(4)}`);
    const dHalf = dEff / 2;
    let worstMid = 0;
    for (let i = 1; i < xs.length; i++)
      if (xs[i - 1] >= 1.0 - 1e-9 && xs[i] <= 3.0 + 1e-9) worstMid = Math.max(worstMid, xs[i] - xs[i - 1]);
    ok(worstMid <= dHalf + 3e-3, `worst mid gap ${worstMid.toFixed(4)} <= d/2 ${dHalf.toFixed(4)}`);
    eq(pv.ties, xs.length, 'tie count');
  });

  test('beam ACI detailing: standard hooks, curtailed extras, layers, cranks', () => {
    const { m, ent } = beamWorld();
    const P = () => {
      const p = beamParams();
      p.beam.mode = 'amount'; p.beam.value = 4; p.beam.seismic = false;
      return p;
    };
    // ---- 90-degree standard end hooks on both rows
    let p = P();
    p.beam.topHook = '90'; p.beam.botHook = '90';
    let pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), p, [ent]);
    ok(!pv.error, pv.error || 'no error');
    const hooked = pv.paths.filter(q => q.pts.length > 2 && (q.dia === 0.014 || q.dia === 0.016));
    ok(hooked.length >= 5, `${hooked.length} hooked bars`);
    const top = hooked.filter(q => Math.abs(q.pts[0].z - 3.455) < 1e-6 || Math.abs(q.pts[0].z - 3.455) < 1e-3);
    // top tips: 12 db + 3.5 db below the row (3.455 - 0.217 = 3.238)
    const topHooked = hooked.filter(q => q.dia === 0.014);
    ok(topHooked.length === 2, '2 top bars hooked');
    for (const q of topHooked) near(Math.min(...q.pts.map(w => w.z)), 3.455 - (12 + 3.5) * 0.014, 2e-3,
      'top hook tips 12db down');
    const botHooked = hooked.filter(q => q.dia === 0.016);
    for (const q of botHooked) near(Math.max(...q.pts.map(w => w.z)), 3.046 + (12 + 3.5) * 0.016, 2e-3,
      'bottom hook tips 12db up');
    // the vertical hook legs sit 3.5 db in from the end faces
    const xs = [...new Set(botHooked[0].pts.map(w => +w.x.toFixed(3)))];
    ok(xs.includes(+(3.5 * 0.016).toFixed(3)) || Math.min(...xs) <= 3.5 * 0.016 + 2e-3,
      'hook bend 3.5 db from the support face');
    // ---- 180-degree hairpin returns
    p = P();
    p.beam.topHook = '180'; p.beam.botHook = 'none';
    pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), p, [ent]);
    const hp = pv.paths.filter(q => q.dia === 0.014 && q.pts.length > 2);
    ok(hp.length === 2, 'hairpins on both top bars');
    for (const q of hp) {
      near(Math.min(...q.pts.map(w => w.z)), 3.455 - 7 * 0.014, 3e-3, 'return leg 7 db toward the core (6 db inside dia)');
      ok(q.pts.some(w => w.x < 0.4 + 1e-6 && w.x > 0.3), `return runs ~0.4 m back (x=${Math.min(...q.pts.map(w => w.x)).toFixed(3)})`);
    }
    // ---- curtailed extras: top Ln/4 at the supports, bottom Ln/8 short
    p = P();
    p.beam.topHook = 'none'; p.beam.topExtra = 2; p.beam.topCut = 0.25;
    p.beam.botExtra = 1; p.beam.botCut = 0.125;
    pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), p, [ent]);
    const Ln = 4 - 0.1;
    const zTop = 3.455, zBot = 3.046;
    const topCut = pv.paths.filter(q => q.dia === 0.014 && Math.abs(q.pts[0].z - zTop) < 1e-3
      && Math.max(...q.pts.map(w => w.x)) - Math.min(...q.pts.map(w => w.x)) < Ln * 0.26 + 0.02);
    ok(topCut.length >= 2, `${topCut.length} curtailed top bars (Ln/4 end segments)`);
    for (const q of topCut) {
      const x0 = Math.min(...q.pts.map(w => w.x)), x1 = Math.max(...q.pts.map(w => w.x));
      const left = x0 < 0.1, right = x1 > 3.9;
      ok(left || right, 'curtailed top bar hugs a support face');
      near(left ? x0 : 4 - x1, 0.05, 2e-3, 'outer end at the end cover');
    }
    const botMid = pv.paths.filter(q => q.dia === 0.016 && q.pts.length === 2
      && Math.abs(q.pts[0].z - zBot) < 1e-3
      && Math.min(...q.pts.map(w => w.x)) > 0.5 && Math.max(...q.pts.map(w => w.x)) < 3.5);
    ok(botMid.length >= 1, 'bottom extra stopped short of both supports');
    for (const q of botMid) {
      near(Math.min(...q.pts.map(w => w.x)), 0.05 + Ln / 8, 4e-3, 'bottom extra cut at Ln/8');
      near(4 - Math.max(...q.pts.map(w => w.x)), 0.05 + Ln / 8, 4e-3, 'mirrored at the far face');
    }
    // ---- second layer when the primary cannot host the extras
    // (6 extras on the 0.3 m web: 13.7 mm gaps < max(db, 25 mm))
    p = P();
    p.beam.topHook = 'none'; p.beam.topExtra = 6;
    pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), p, [ent]);
    const layer2 = pv.paths.filter(q => q.dia === 0.014
      && Math.abs(Math.min(...q.pts.map(w => w.z)) - (zTop - (0.014 + 0.025))) < 2e-3);
    ok(layer2.length >= 3, `${layer2.length} extras in a second layer 25 mm clear below`);
    // ---- cranked (bent-up) bars
    p = P();
    p.beam.crank = 2; p.beam.crankAt = 1 / 6;
    pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), p, [ent]);
    const cranked = pv.paths.filter(q => q.pts.length > 6
      && Math.abs(Math.max(...q.pts.map(w => w.z)) - zTop) < 2e-3);
    ok(cranked.length === 2, `${cranked.length} bent-up bars`);
    for (const q of cranked) {
      // hooks DOWN at both ends at the top elevation
      near(q.pts[0].z, zTop - (12 + 3.5) * 0.016, 3e-3, 'crank end hooks 12 db down');
      near(q.pts[q.pts.length - 1].z, zTop - (12 + 3.5) * 0.016, 3e-3, 'crank far hook 12 db down');
      // 45-degree diagonal between the rows, starting ~Ln/6 from the face
      const diag = q.pts.find(w => w.z > zBot + 0.05 && w.z < zTop - 0.05 && w.x > 0.5 && w.x < 1.3);
      ok(diag, 'diagonal rises between the rows');
      if (diag) ok(diag.x > 0.05 + Ln / 6 - 0.42 && diag.x < 0.05 + Ln / 6 + 0.42, 'crank starts near Ln/6');
      const xm = 0.05 + (4 - 0.1) / 2 + 0.05;
      near((Math.min(...q.pts.map(w => w.x)) + Math.max(...q.pts.map(w => w.x))) / 2, 2, 0.05,
        'bent-up bar symmetric about midspan');
    }
    // ---- stirrup laps alternate along the top corners
    p = P();
    p.beam.mode = 'amount'; p.beam.value = 4; p.beam.seismic = false;
    pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), p, [ent]);
    const ties = pv.paths.filter(q => q.dia === 0.008 && q.pts.length > 2);
    ok(ties.length === 4, '4 ties');
    const lapY = ties.map(q => q.pts[0].y);
    ok(lapY[0] * lapY[1] < 0 && lapY[1] * lapY[2] < 0,
      `lap corners alternate (${lapY.map(v => v.toFixed(3)).join(', ')})`);
  });

  test('beam multi-leg (ACI 300 mm): wide beams get inner hoops, narrow do not', () => {
    // narrow 0.3 beam: clear between legs ~0.224 m - no hoops
    const N = m2Beam(0.3);
    const narrow = ER.previewElementRebar(N.m, faceAtZ(N.m, 3.0), beamParams(), [N.ent]);
    ok(!narrow.error, narrow.error || 'no error');
    const nOuter = narrow.paths.filter(q => q.dia === 0.008 && q.pts.length > 2).length;
    ok(narrow.ties === nOuter, `narrow beam: outer ties only (${narrow.ties})`);

    // wide 0.7 beam: clear a_ts = 0.7 - 2*(0.03+0.004) - 0.008 = 0.524 > 0.3
    const W = m2Beam(0.7);
    const p = beamParams();
    p.beam.mode = 'amount'; p.beam.value = 4; // uniform 4 stations for exact counts
    p.beam.seismic = false;
    const pv = ER.previewElementRebar(W.m, faceAtZ(W.m, 3.0), p, [W.ent]);
    ok(!pv.error, pv.error || 'no error');
    const hoopish = pv.paths.filter(q => q.dia === 0.008 && q.pts.length > 2);
    // k = ceil(0.524/0.3) = 2 -> one interior line -> ONE hoop per station
    eq(hoopish.length, 4 * 2, '4 stations x (outer + 1 inner hoop)');
    // leg lines across the transverse axis (y): outer tie legs at the
    // covers (+-0.316), the inner hoop's legs at its extremes - every
    // adjacent leg-to-leg gap must be <= 300 mm
    const outer = hoopish.find(q => Math.max(...q.pts.map(r2 => Math.abs(r2.y))) > 0.3);
    const hoop = hoopish.find(q => Math.max(...q.pts.map(r2 => Math.abs(r2.y))) < 0.3);
    near(Math.max(...outer.pts.map(r2 => Math.abs(r2.y))), 0.316, 2e-3, 'outer legs at the covers');
    const hoopLeg = Math.max(...hoop.pts.map(r2 => Math.abs(r2.y)));
    near(hoopLeg, 0.1053, 3e-3, 'hoop legs on the 300 mm division lines');
    const legLines = [-0.316, -hoopLeg, hoopLeg, 0.316];
    for (let i = 1; i < legLines.length; i++)
      ok(legLines[i] - legLines[i - 1] <= 0.300 + 3e-3,
        `leg-to-leg ${((legLines[i] - legLines[i - 1]) * 1000).toFixed(1)} mm <= 300`);
    // hooks: tail length >= max(6 db, 75 mm) - outer and inner alike
    for (const q of hoopish) {
      const e0 = q.pts[0], T = q.pts[1];
      const L = Math.hypot(e0.x - T.x, e0.y - T.y, e0.z - T.z);
      ok(L >= 0.075 - 1e-6, `hook tail ${ (L * 1000).toFixed(1) } mm >= 75`);
    }
    ok(hoop, 'inner hoop present');
    ok(Math.max(...hoop.pts.map(r2 => Math.abs(r2.y))) <= 0.316 + 1e-6, 'hoop inside the outer legs');
    ok(Math.min(...hoop.pts.map(r2 => r2.z)) > 3.02 && Math.max(...hoop.pts.map(r2 => r2.z)) < 3.48,
      'hoop spans between the bar rows');
  });

  function m2Beam(width) {
    const m = new Model();
    const bp = { baseline: [[0, -(width / 2 - 0.15), 3], [4, -(width / 2 - 0.15), 3]], profile: 'rectangular',
      webWidth: width, height: 0.5, referenceLevelId: 'lvl1', zJustification: 'Bottom' };
    const ent = stamp(m, box(m, 0, 4, -(width / 2), width / 2, 3, 3.5), 'bw', 'beam', bp);
    return { m, ent };
  }

  test('beam: skin bars stack between the rows; committed cage is loose + tagged', () => {
    const { m, ent } = beamWorld();
    const p = beamParams();
    p.beam.skin = 1;
    const res = ER.buildElementRebar(m, faceWithNormal(m, [1, 0, 0] /* other end face too */), p, [ent]);
    ok(!res.error && res.ids.length > 40, `${res.ids ? res.ids.length : 0} faces`);
    eq(res.bars, 7, '2 top + 3 bottom + 2 skin');
    const faces = res.ids.map(id => m.faces.get(id)).filter(Boolean);
    ok(faces.every(f => f.loose === true), 'rebar faces are loose');
    ok(faces.every(f => f.userData && f.userData.rebar && f.userData.rebar.host === 'beam'),
      'userData.rebar.host = beam');
  });

  // --------------------------------------------------------------- column
  test('column: whole-element from a SIDE face (auto top face), circular→helix', () => {
    const m = new Model();
    const ent = stamp(m, box(m, 0, 0.3, 0, 0.3, 0, 3), 'c1', 'column',
      { base: [0.15, 0.15, 0], width: 0.3, depth: 0.3, height: 3 });
    const p = { type: 'column', column: {
      type: 'singletie',
      tie: { l: 0.04, r: 0.04, t: 0.04, b: 0.04, front: 0.05, dia: 0.008,
        bentAngle: 135, bentFactor: 6, rounding: 0, mode: 'amount', value: 6 },
      main: { dia: 0.016, tOffset: 0.05, bOffset: 0.05, type: 'straight' },
    } };
    const res = ER.buildElementRebar(m, faceWithNormal(m, [1, 0, 0]), p, [ent]);
    ok(!res.error, res.error || 'no error');
    eq(res.ties, 6, '6 ties');
    eq(res.bars, 4, '4 corner mains');
    ok(res.ids.length > 100 && res.ids.every(id => m.faces.has(id)), 'faces created and live');

    // circular column (octagonal top face) auto-selects the helix cage
    const m2 = new Model();
    const ring = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      ring.push(G.v(0.15 + 0.15 * Math.cos(a), 0.15 + 0.15 * Math.sin(a), 3));
    }
    const before = new Set(m2.faces.keys());
    const f = m2.addFaceFromRings(ring);
    m2.pushPull(f, -3);
    const ent2 = stamp(m2, [...m2.faces.keys()].filter(id => !before.has(id)), 'c2', 'column',
      { base: [0.15, 0.15, 0], width: 0.3, depth: 0.3, height: 3 });
    const res2 = ER.buildElementRebar(m2, ent2.faces[0], { type: 'column', column: p.column }, [ent2]);
    ok(!res2.error, res2.error || 'circular ok');
    const helix = [...m2.faces.values()].filter(ff => ff.userData && ff.userData.rebar
      && ff.userData.rebar.shape === 'helical');
    ok(helix.length > 0, 'circular section got the helix cage automatically');
  });

  // ----------------------------------------------------------- foundation
  const fndParams = () => ({ type: 'foundation', foundation: {
    bottom: 0.04, side: 0.05, topLayer: 'X',
    xDia: 0.012, xMode: 'amount', xValue: 5,
    yDia: 0.012, yMode: 'amount', yValue: 5,
    stubX: 3, stubY: 3, stubDia: 0.014, lap: 0.5, leg: 0.15, colW: 0.4, colL: 0.4,
  } });
  function fndWorld() {
    const m = new Model();
    const ent = stamp(m, box(m, 0, 1.2, 0, 1.2, -0.5, 0), 'f1', 'foundation',
      { base: [0.6, 0.6, 0], width: 1.2, depth: 1.2, thickness: 0.5, baseLevel: 'lvl0' });
    return { m, ent };
  }

  test('foundation: layered two-way mesh + L starter stubs', () => {
    const { m, ent } = fndWorld();
    const pv = ER.previewElementRebar(m, faceWithNormal(m, [0, 0, 1]), fndParams(), [ent]);
    ok(!pv.error, pv.error || 'no error');
    eq(pv.bars, 10, '5 X + 5 Y mesh bars');
    const bars = pv.paths.filter(p => p.pts.length === 2);
    const yLayer = bars.filter(p => Math.abs(p.pts[0].z - -0.454) < 1e-9);
    const xLayer = bars.filter(p => Math.abs(p.pts[0].z - -0.442) < 1e-9);
    eq(yLayer.length, 5, 'Y layer rests on the bottom cover');
    eq(xLayer.length, 5, 'X layer stacks on the Y layer (topLayer X)');
    near(Math.min(...yLayer.map(b => b.pts[0].x)), 0.056, 1e-9, 'Y bar row starts at the side cover');
    for (const b of yLayer) near(Math.abs(b.pts[0].y - b.pts[1].y), 1.088, 1e-9, 'Y bar the clear length');
    const xs = xLayer.map(p => p.pts[0].y).sort((a, b) => a - b);
    near(xs[0], 0.056, 1e-9, 'X bar row at the side cover');
    near(xs[2], 0.6, 1e-9, 'middle row centered');
    // starters: 3/side X + 3/side Y − 4 shared corners = 8
    const stubs = pv.paths.filter(p => p.dia === 0.014 && p.pts.length > 2);
    eq(stubs.length, 8, '8 starter stubs');
    eq(pv.ties, 8, 'starters counted');
    for (const s of stubs) {
      const zs = s.pts.map(q => q.z);
      near(Math.max(...zs), 0.5, 1e-6, 'riser reaches pad top + lap');
      near(Math.min(...zs), -0.429, 1e-6, 'leg sits just above the bottom mesh');
      ok(s.pts[0].z < s.pts[s.pts.length - 1].z, 'leg first, riser up');
    }
    ok(!pv.column, 'no column above');
  });

  test('foundation: column standing on the pad overrides the starter section', () => {
    const { m, ent } = fndWorld();
    const col = { id: 'cx', type: 'column',
      params: { base: [0.6, 0.6, 0], width: 0.3, depth: 0.3, height: 3 } };
    const pv = ER.previewElementRebar(m, faceWithNormal(m, [0, 0, 1]), fndParams(), [ent, col]);
    ok(pv.column === true, 'column detected');
    const stubs = pv.paths.filter(p => p.dia === 0.014 && p.pts.length > 2);
    eq(stubs.length, 8, 'still 8 starters (3/side on a 0.3 section)');
    const xs = [...new Set(stubs.map(p => p.pts[p.pts.length - 1].x).map(v => v.toFixed(4)))].map(Number).sort((a, b) => a - b);
    near(xs[0], 0.45, 1e-9, 'starters on the column face lines');
    near(xs[1], 0.6, 1e-9, 'centered on the column');
  });

  // ----------------------------------------------------------------- slab
  function slabWorld(withHole) {
    const m = new Model();
    const z = 3.2, t = 0.2;
    const outer = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]]
      .map(q => G.v(q[0], q[1], z));
    const holes = withHole
      ? [[[3, 0.5], [4, 0.5], [4, 1.5], [3, 1.5]].map(q => G.v(q[0], q[1], z))] : [];
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings(outer, holes);
    m.pushPull(f, -t);
    const ent = stamp(m, [...m.faces.keys()].filter(id => !before.has(id)), 's1', 'floor',
      { regions: [{ outer: withHole ? [[3, 0.5], [4, 0.5], [4, 1.5], [3, 1.5]] : [] }], thickness: t });
    return { m, ent };
  }
  const slabParams = () => ({ type: 'slab', slab: {
    bottom: 0.025, top: 0.025, side: 0.025,
    xDia: 0.012, xSpacing: 0.2, yDia: 0.012, ySpacing: 0.2,
    topMesh: false, topDia: 0,
  } });

  test('slab: mesh clipped to the L-outline', () => {
    const { m, ent } = slabWorld(false);
    const pv = ER.previewElementRebar(m, faceWithNormal(m, [0, 0, 1]), slabParams(), [ent]);
    ok(!pv.error, pv.error || 'no error');
    ok(pv.bars > 40, `${pv.bars} bars`);
    const bars = pv.paths.filter(p => p.pts.length === 2);
    // every Y-bar above the notch (y > 2.05) stays inside the vertical arm
    for (const b of bars) {
      const alongX = Math.abs(b.pts[1].x - b.pts[0].x) > Math.abs(b.pts[1].y - b.pts[0].y);
      if (!alongX && b.pts[0].y > 2.05)
        ok(Math.max(b.pts[0].x, b.pts[1].x) <= 2 + 1e-6, 'Y-bar above the notch stays in the arm');
      if (alongX && b.pts[0].y > 2.05)
        ok(Math.max(b.pts[0].x, b.pts[1].x) <= 6 + 1e-6, 'X-bar geometry sane');
    }
    // layering: Y bars just above the cover, X bars on top of them
    const yz = bars.filter(p => Math.abs(p.pts[0].x - p.pts[1].x) < 1e-9).map(p => p.pts[0].z);
    const xz = bars.filter(p => Math.abs(p.pts[0].y - p.pts[1].y) < 1e-9).map(p => p.pts[0].z);
    near(yz[0], 3.2 - 0.031, 1e-9, 'Y layer at bottom cover + r');
    near(xz[0], 3.2 - 0.043, 1e-9, 'X layer stacked on the Y layer');
  });

  test('slab: openings split the bars; slivers drop; preview never mutates', () => {
    const { m, ent } = slabWorld(true);
    const n0 = m.faces.size;
    const pv = ER.previewElementRebar(m, faceWithNormal(m, [0, 0, 1]), slabParams(), [ent]);
    eq(m.faces.size, n0, 'preview adds nothing');
    const xBars = pv.paths.filter(p => p.pts.length === 2
      && Math.abs(p.pts[0].y - p.pts[1].y) < 1e-9);
    ok(xBars.length > 0, 'X bars present');
    let split = 0;
    for (const b of xBars) {
      const y = b.pts[0].y, a = Math.min(b.pts[0].x, b.pts[1].x), c = Math.max(b.pts[0].x, b.pts[1].x);
      ok(c - a >= 0.25 - 1e-9, 'no sliver bars');
      if (y > 0.5 + 1e-6 && y < 1.5 - 1e-6) {
        ok(!(a < 3 - 1e-6 && c > 4 + 1e-6), 'no bar straddles the opening');
        if (a < 2.9 && c > 4.1) ok(false, 'straddler escaped');
      }
    }
    // a scanline through the hole must yield TWO bars on that row
    const rows = new Map();
    for (const b of xBars) {
      const y = b.pts[0].y.toFixed(4);
      if (!rows.has(y)) rows.set(y, 0);
      rows.set(y, rows.get(y) + 1);
    }
    const throughHole = [...rows.entries()].filter(([y]) => +y > 0.55 && +y < 1.45);
    ok(throughHole.some(([, n]) => n === 2), 'rows through the opening carry 2 bars');
  });

  test('facade: faces without an element are refused; unknown types rejected', () => {
    const m = new Model();
    const faces = box(m, 0, 1, 0, 1, 0, 1); // no entity stamp
    const r = ER.buildElementRebar(m, faces[0], beamParams(), []);
    ok(/no element/.test(r.error), r.error);
    const m2 = new Model();
    const f2 = box(m2, 0, 1, 0, 1, 0, 1);
    const wall = stamp(m2, f2, 'w1', 'wall', {});
    const r2 = ER.buildElementRebar(m2, f2[0], beamParams(), [wall]);
    ok(/not reinforced|no base\/end/.test(r2.error), r2.error); // walls now have rebar - the error is structural
  });
};
