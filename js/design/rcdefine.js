// rcdefine.js — RC Design & Analysis "Define" data + dialogs.
// Workflow mirrors the ETABS Define menu: materials (incl. advanced data +
// library presets), rebar database, frame/area/solid/cable sections, link &
// tendon properties, load patterns/cases/combinations, mass source,
// auto seismic/wind, response-spectrum/time-history functions, diaphragms,
// piers, spandrels, grid systems, springs, joint constraints.
// All original code. Data lives on app.model.rcDesign (save/open/undo carry it).
// Units: metric — MPa, m, kN, mm² where noted.
(function (root) {
  'use strict';

  const MAT_TYPES = ['concrete', 'rebar', 'steel', 'tendon', 'aluminum', 'coldformed', 'nodesign', 'masonry'];
  const MAT_LABEL = {
    concrete: 'Concrete', rebar: 'Rebar', steel: 'Steel', tendon: 'Tendon',
    aluminum: 'Aluminum', coldformed: 'Cold Formed', nodesign: 'No Design', masonry: 'Masonry',
  };
  const MP_TYPES = ['isotropic', 'orthotropic', 'uniaxial', 'anisotropic'];
  const FRAME_TYPES = ['rect', 'circle', 'concTee', 'I', 'channel', 'angle', 'box', 'pipe', 'general', 'autoselect'];
  const FRAME_LABEL = {
    rect: 'Rectangular', circle: 'Circle', concTee: 'Concrete Tee', I: 'I / Wide Flange',
    channel: 'Channel', angle: 'Angle', box: 'Box / Tube', pipe: 'Pipe', general: 'General',
    autoselect: 'Auto Select',
  };
  const PATTERN_TYPES = ['DEAD', 'LIVE', 'ROOFLIVE', 'SNOW', 'WIND', 'QUAKE', 'BRAKE', 'PRESTRESS',
    'TEMPERATURE', 'BOUNSLIP', 'OTHER'];
  const CASE_TYPES = ['static', 'modal', 'response spectrum', 'time history', 'buckling', 'moving load',
    'hyperstatic', 'staged construction'];

  // ------------------------------------------------- library presets (AddQuick)
  const MAT_LIBRARY = [
    { label: 'CONC C25 (normalweight)', patch: { name: 'CONC25', type: 'concrete', weight: { value: 25, as: 'weight' }, iso: { E: 0, u: 0.2, a: 9.9e-6, G: 0, auto: true }, conc: { fc: 25, lightweight: false, fcsFactor: 1, ssType: 0, ssHysType: 0, strainAtFc: 0.0022, strainUltimate: 0.0035, finalSlope: -0.1 } } },
    { label: 'CONC C30 (normalweight)', patch: { name: 'CONC30', type: 'concrete', weight: { value: 25, as: 'weight' }, iso: { E: 0, u: 0.2, a: 9.9e-6, G: 0, auto: true }, conc: { fc: 30, lightweight: false, fcsFactor: 1, ssType: 0, ssHysType: 0, strainAtFc: 0.0022, strainUltimate: 0.0035, finalSlope: -0.1 } } },
    { label: 'CONC C35 (normalweight)', patch: { name: 'CONC35', type: 'concrete', weight: { value: 25, as: 'weight' }, iso: { E: 0, u: 0.2, a: 9.9e-6, G: 0, auto: true }, conc: { fc: 35, lightweight: false, fcsFactor: 1, ssType: 0, ssHysType: 0, strainAtFc: 0.0022, strainUltimate: 0.0035, finalSlope: -0.1 } } },
    { label: 'CONC 4000 psi (normalweight)', patch: { name: 'CONC4KSI', type: 'concrete', weight: { value: 25, as: 'weight' }, iso: { E: 0, u: 0.2, a: 9.9e-6, G: 0, auto: true }, conc: { fc: 27.6, lightweight: false, fcsFactor: 1, ssType: 0, ssHysType: 0, strainAtFc: 0.0022, strainUltimate: 0.0035, finalSlope: -0.1 } } },
    { label: 'REBAR B500B', patch: { name: 'REBAR500', type: 'rebar', grade: 'B500B', iso: { E: 200000, u: 0.3, a: 11.7e-6, G: 76923, auto: false }, weight: { value: 78.5, as: 'weight' }, rebar: { fy: 500, fu: 550, eFy: 0.0025, eFu: 0.06, ssType: 0, ssHysType: 0, strainAtHardening: 0.0068, strainUltimate: 0.09 } } },
    { label: 'REBAR ASTM A615 Gr60', patch: { name: 'A615Gr60', type: 'rebar', region: 'US', standard: 'ASTM', grade: 'A615Gr60', iso: { E: 200000, u: 0.3, a: 11.7e-6, G: 76923, auto: false }, weight: { value: 78.5, as: 'weight' }, rebar: { fy: 420, fu: 620, eFy: 0.0021, eFu: 0.06, ssType: 0, ssHysType: 0, strainAtHardening: 0.006, strainUltimate: 0.09 } } },
    { label: 'STEEL ASTM A992 Fy50', patch: { name: 'STEEL_A992', type: 'steel', region: 'US', standard: 'ASTM', grade: 'A992', iso: { E: 200000, u: 0.3, a: 11.7e-6, G: 76923, auto: false }, weight: { value: 78.5, as: 'weight' }, steel: { fy: 345, fu: 450, eFy: 0.001725, eFu: 0.045, ssType: 0, ssHysType: 0, strainAtHardening: 0.008, strainAtMaxStress: 0.05, strainAtRupture: 0.14 } } },
    { label: 'STEEL S355', patch: { name: 'STEEL_S355', type: 'steel', region: 'EU', standard: 'EN', grade: 'S355', iso: { E: 210000, u: 0.3, a: 12e-6, G: 80769, auto: false }, weight: { value: 78.5, as: 'weight' }, steel: { fy: 355, fu: 490, eFy: 0.00169, eFu: 0.045, ssType: 0, ssHysType: 0, strainAtHardening: 0.008, strainAtMaxStress: 0.05, strainAtRupture: 0.14 } } },
    { label: 'TENDON ASTM A416 Gr270', patch: { name: 'TENDON270', type: 'tendon', region: 'US', standard: 'ASTM', grade: 'A416Gr270', iso: { E: 195000, u: 0.3, a: 11.7e-6, G: 75000, auto: false }, weight: { value: 78.5, as: 'weight' }, tendon: { fy: 1670, fu: 1860 } } },
  ];

  function defaultMaterials() {
    return [
      {
        name: 'CONC25', type: 'concrete', mechType: 'isotropic', region: '', standard: '', grade: '',
        iso: { E: 0, u: 0.2, a: 9.9e-6, G: 0, auto: true }, // E=0 → auto from wc & fc
        ortho: { E11: 0, E22: 0, E33: 0, u12: 0.2, u13: 0.2, u23: 0.2, G12: 0, G13: 0, G23: 0 },
        weight: { value: 25.0, as: 'weight' },
        damping: { modalRatio: 0.05 },
        timeDep: { model: 'none' },
        conc: { fc: 25, lightweight: false, fcsFactor: 1.0, ssType: 0, ssHysType: 0, strainAtFc: 0.0022, strainUltimate: 0.0035, finalSlope: -0.1 },
        ssCurve: [], tempProps: [],
      },
      {
        name: 'CONC30', type: 'concrete', mechType: 'isotropic', region: '', standard: '', grade: '',
        iso: { E: 0, u: 0.2, a: 9.9e-6, G: 0, auto: true },
        ortho: { E11: 0, E22: 0, E33: 0, u12: 0.2, u13: 0.2, u23: 0.2, G12: 0, G13: 0, G23: 0 },
        weight: { value: 25.0, as: 'weight' },
        damping: { modalRatio: 0.05 },
        timeDep: { model: 'none' },
        conc: { fc: 30, lightweight: false, fcsFactor: 1.0, ssType: 0, ssHysType: 0, strainAtFc: 0.0022, strainUltimate: 0.0035, finalSlope: -0.1 },
        ssCurve: [], tempProps: [],
      },
      {
        name: 'REBAR500', type: 'rebar', mechType: 'isotropic', region: '', standard: '', grade: 'B500B',
        iso: { E: 200000, u: 0.3, a: 11.7e-6, G: 76923, auto: false },
        ortho: { E11: 0, E22: 0, E33: 0, u12: 0.2, u13: 0.2, u23: 0.2, G12: 0, G13: 0, G23: 0 },
        weight: { value: 78.5, as: 'weight' },
        damping: { modalRatio: 0.05 },
        timeDep: { model: 'none' },
        rebar: { fy: 500, fu: 550, eFy: 0.0025, eFu: 0.06, ssType: 0, ssHysType: 0, strainAtHardening: 0.0068, strainUltimate: 0.09 },
        ssCurve: [], tempProps: [],
      },
      {
        name: 'STEEL_A992', type: 'steel', mechType: 'isotropic', region: 'US', standard: 'ASTM', grade: 'A992',
        iso: { E: 200000, u: 0.3, a: 11.7e-6, G: 76923, auto: false },
        ortho: { E11: 0, E22: 0, E33: 0, u12: 0.2, u13: 0.2, u23: 0.2, G12: 0, G13: 0, G23: 0 },
        weight: { value: 78.5, as: 'weight' },
        damping: { modalRatio: 0.05 },
        timeDep: { model: 'none' },
        steel: { fy: 345, fu: 450, eFy: 0.001725, eFu: 0.045, ssType: 0, ssHysType: 0, strainAtHardening: 0.008, strainAtMaxStress: 0.05, strainAtRupture: 0.14 },
        ssCurve: [], tempProps: [],
      },
    ];
  }

  // metric bar sizes: area = π d² / 4 (mm²)
  function defaultRebarDb() {
    return [10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40].map(d => ({
      name: String(d), area: +(Math.PI * d * d / 4).toFixed(1), dia: d,
    }));
  }

  function defaultFrameSections() {
    return [
      {
        name: 'FSEC1', type: 'rect', designType: 'beam', material: 'CONC25',
        t3: 0.5, t2: 0.3, tf: 0, twF: 0, twT: 0, mirrorAbout3: false,
        modifiers: { a: 1, as2: 1, as3: 1, torsion: 1, i22: 1, i33: 1, mass: 1, weight: 1 },
        autoList: [], autoStart: '',
        rebar: {
          longMat: 'REBAR500', confineMat: 'CONC25',
          coverTop: 0.04, coverBot: 0.04, topLeft: 0, topRight: 0, botLeft: 0, botRight: 0,
          colPattern: 1, colConfineType: 1, colCover: 0.04, nC: 4, nR3: 0, nR2: 0,
          rebarSize: '16', tieSize: '10', tieSpacingLongit: 0.15, toBeDesigned: true,
        },
      },
    ];
  }

  function defaultState() {
    return {
      materials: defaultMaterials(),
      rebarDb: defaultRebarDb(),
      frameSections: defaultFrameSections(),
      areaSections: [
        { name: 'SLAB1', type: 'slab', material: 'CONC25', thickness: 0.2, ribs: null },
        { name: 'WALL1', type: 'wall', material: 'CONC25', thickness: 0.2, ribs: null },
      ],
      solidSections: [{ name: 'SOLID1', material: 'CONC25' }],
      cableSections: [{ name: 'CABLE1', material: 'STEEL_A992', area: 1e-3 }],
      loadPatterns: [
        { name: 'DEAD', type: 'DEAD', selfWtMult: 1.0, auto: null, color: -1 },
        { name: 'LIVE', type: 'LIVE', selfWtMult: 0.0, auto: null, color: -1 },
      ],
      loadCases: [
        { name: 'Modal', type: 'modal', data: { method: 'eigen', numModes: 12, maxPeriod: 0 } },
      ],
      combos: [],
      massSource: { includeElements: true, includeAddedMass: false, loads: [] },
      autoSeismic: { code: 'ASCE 7-16', ss: 0.5, s1: 0.15, tl: 8, r: 5, omega: 2.5, cd: 2.5, ie: 1.0,
        siteClass: 'D', fa: 1.0, fv: 1.5,
        dirs: { x: true, y: false, xEcc: false, yEcc: false, xMinusEcc: false, yMinusEcc: false },
        ecc: 0.05, periodFlag: 1, ctType: 0, userT: 0.5, topZ: null, bottomZ: null,
        userC: 0.1, userK: 1.0 },
      autoWind: { code: 'ASCE 7-16', speed: 47, exposure: 'B', kd: 0.85, kzt: 1.0, gust: 0.85,
        direction: 'X', userQ: 1.0 },
      rsFunctions: [],
      thFunctions: [],
      diaphragms: [],
      designStrips: [{ name: 'STRIP1', width: 1.0, direction: 'X' }],
      piers: ['P1'],
      spandrels: ['S1'],
      linkProps: [],
      tendonProps: [{ name: 'TEND1', area: 140, mu: 0.25, wobble: 0.001, jacking: 1300, type: 'grouted' }],
      pointSprings: [{ name: 'SPRING1', type: 'linear', k1: 1e6, k2: 1e6, k3: 1e6 }],
      lineSprings: [{ name: 'LSPRING1', kz: 1e5 }],
      areaSprings: [{ name: 'ASPRING1', kz: 1e4 }],
      constraints: [],
    };
  }

  // ----------------------------------------------------------- derived ops
  // ACI 318-19 §19.2.2.1: Ec = 0.043·wc^1.5·√f'c (MPa, wc in kg/m3);
  // normalweight ≈ 4700·√f'c. G = E / (2(1+ν)).
  function concreteEc(m) {
    if (!m.conc) return 0;
    const fc = m.conc.fc;
    if (m.iso.auto) {
      if (m.conc.lightweight) {
        const wc = (m.weight.as === 'weight' ? m.weight.value * 1000 / 9.81 : m.weight.value) || 2320;
        return 0.043 * Math.pow(wc, 1.5) * Math.sqrt(fc);
      }
      return 4700 * Math.sqrt(fc);
    }
    return m.iso.E;
  }
  function matE(m) {
    if (m.type === 'concrete') return concreteEc(m);
    if (m.mechType === 'orthotropic') return m.ortho ? m.ortho.E11 : 0;
    return m.iso ? m.iso.E : 0;
  }
  function matG(m) { return m.iso ? (m.iso.G || matE(m) / (2 * (1 + m.iso.u))) : 0; }

  // ASCE 7 design response spectrum (Sa in g, T in s) — §11.4.5
  function asceSa(fn, T) {
    const SDS = fn.sds, SD1 = fn.sd1, TL = fn.tl || 8;
    if (SDS <= 0) return 0;
    const T0 = 0.2 * SD1 / SDS, Ts = SD1 / SDS;
    if (T <= T0) return SDS * (0.4 + 0.6 * T / Math.max(T0, 1e-9));
    if (T <= Ts) return SDS;
    if (T <= TL) return SD1 / T;
    return SD1 / TL;
  }
  function rsValue(fn, T) {
    const sa = fn.kind === 'user'
      ? (fn.points || []).reduce((best, p, i, arr) => {
          if (i === 0) return p; // linear interp on sorted points
          if (T <= p.T) {
            const a = arr[i - 1], f = (T - a.T) / Math.max(p.T - a.T, 1e-9);
            return { Sa: a.Sa + f * (p.Sa - a.Sa) };
          }
          return p;
        }, { Sa: 0 })
      : { Sa: asceSa(fn, T) };
    return (sa.Sa || 0) * (fn.scale || 9.81);
  }

  function ensure(app) {
    const mdl = app.model;
    if (!mdl.rcDesign) mdl.rcDesign = defaultState();
    const fresh = defaultState();
    for (const k of Object.keys(fresh))
      if (mdl.rcDesign[k] == null) mdl.rcDesign[k] = fresh[k];
    // forward-fill within materials (e.g. older models lack mechType/damping)
    for (const m of mdl.rcDesign.materials || []) {
      if (m.mechType == null) m.mechType = 'isotropic';
      if (m.damping == null) m.damping = { modalRatio: 0.05 };
      if (m.timeDep == null) m.timeDep = { model: 'none' };
      if (m.tempProps == null) m.tempProps = [];
    }
    // migrate legacy frame sections (dims/modifiers/designType were implicit)
    for (const s of mdl.rcDesign.frameSections || []) {
      if (!s.dims) {
        s.dims = {};
        if (s.type === 'circle' || s.type === 'pipe') s.dims.dia = s.t3;
        else if (s.type === 'concTee') { s.dims.h = s.t3; s.dims.bf = s.t2; s.dims.tf = s.tf; s.dims.tw = s.twT; }
        else { s.dims.h = s.t3; s.dims.b = s.t2; s.dims.tf = s.tf; s.dims.tw = s.twT; }
      }
      if (!s.modifiers) s.modifiers = {};
      // official 8-value modifier set: A, As2, As3, J, I22, I33, Mass, Weight
      for (const k of ['a', 'as2', 'as3', 'torsion', 'i22', 'i33', 'mass', 'weight'])
        if (s.modifiers[k] == null) s.modifiers[k] = 1;
      if (!s.designType) s.designType = 'beam';
      if (s.autoList == null) s.autoList = [];
    }
    // migrate legacy auto-seismic (single direction string → 6-direction set)
    const a = mdl.rcDesign.autoSeismic;
    if (a && !a.dirs) {
      const dir = a.direction || 'X';
      a.dirs = {
        x: dir === 'X' || dir === '±X', y: dir === 'Y' || dir === '±Y',
        xEcc: dir === '+X', yEcc: dir === '+Y',
        xMinusEcc: dir === '-X' || dir === '−X' || dir === '±X',
        yMinusEcc: dir === '-Y' || dir === '−Y' || dir === '±Y',
      };
    }
    if (a && a.cd == null) a.cd = 2.5;
    if (a && a.fa == null) a.fa = 1.0;
    if (a && a.fv == null) a.fv = 1.5;
    if (a && a.periodFlag == null) a.periodFlag = 1;
    if (a && a.ctType == null) a.ctType = 0;
    if (a && a.userT == null) a.userT = 0.5;
    return mdl.rcDesign;
  }

  const byName = (list, name) => list.find(x => x.name === name) || null;
  const uniqueName = (list, base) => {
    let n = base, i = 2;
    while (list.some(x => x.name === n)) n = base + (i++);
    return n;
  };

  // derived frame-section properties — computed, never stored (like ETABS)
  function frameSectionProps(s) {
    const g = s.dims || {};
    switch (s.type) {
      case 'rect': { const b = g.b ?? s.t2 ?? 0.3, h = g.h ?? s.t3 ?? 0.5;
        return { A: b * h, I22: h * b ** 3 / 12, I33: b * h ** 3 / 12 }; }
      case 'circle': { const r = (g.dia ?? s.t3 ?? 0.5) / 2, I = Math.PI * r ** 4 / 4;
        return { A: Math.PI * r * r, I22: I, I33: I }; }
      case 'concTee': case 'tee': { const bf = g.bf ?? s.t2 ?? 0.6, tf = g.tf ?? s.tf ?? 0.1,
        hw = (g.h ?? s.t3 ?? 0.5) - tf, tw = g.tw ?? s.twT ?? 0.25;
        const Af = bf * tf, Aw = tw * hw, A = Af + Aw, H = tf + hw;
        const ybar = (Af * (H - tf / 2) + Aw * (hw / 2)) / A;
        const If = bf * tf ** 3 / 12 + Af * (H - tf / 2 - ybar) ** 2;
        const Iw = tw * hw ** 3 / 12 + Aw * (hw / 2 - ybar) ** 2;
        return { A, I22: tw * bf ** 3 / 12, I33: If + Iw, ybar }; }
      case 'I': { const h = g.h ?? s.t3 ?? 0.5, bf = g.bf ?? s.t2 ?? 0.2, tf = g.tf ?? s.tf ?? 0.015,
        tw = g.tw ?? s.tw ?? 0.01;
        const hw = h - 2 * tf, A = 2 * bf * tf + tw * hw;
        return { A, I22: (2 * tf * bf ** 3 + hw * tw ** 3) / 12,
          I33: (bf * h ** 3 - (bf - tw) * hw ** 3) / 12 }; }
      case 'channel': { const h = g.h ?? s.t3 ?? 0.25, b = g.b ?? s.t2 ?? 0.08,
        tf = g.tf ?? s.tf ?? 0.012, tw = g.tw ?? s.tw ?? 0.008, hw = h - 2 * tf;
        return { A: 2 * b * tf + tw * hw, I22: (2 * tf * b ** 3 + hw * tw ** 3) / 12,
          I33: (b * h ** 3 - (b - tw) * hw ** 3) / 12 }; }
      case 'angle': { const h = g.h ?? s.t3 ?? 0.15, b = g.b ?? s.t2 ?? 0.15,
        t = g.tw ?? s.tw ?? 0.012;
        return { A: t * (h + b - t), I22: (t * h ** 3 + (b - t) * t ** 3) / 12,
          I33: (b * t ** 3 + t * (h - t) ** 3) / 12 }; }
      case 'box': { const h = g.h ?? s.t3 ?? 0.3, b = g.b ?? s.t2 ?? 0.3,
        tf = g.tf ?? s.tf ?? 0.012, tw = g.tw ?? s.tw ?? 0.012, hw = h - 2 * tf;
        return { A: b * h - (b - 2 * tw) * hw, I22: (b ** 3 * h - (b - 2 * tw) ** 3 * hw) / 12,
          I33: (b * h ** 3 - (b - 2 * tw) * hw ** 3) / 12 }; }
      case 'pipe': { const r = (g.dia ?? s.t3 ?? 0.3) / 2, t = g.tw ?? s.tw ?? 0.008,
        I = Math.PI * (r ** 4 - (r - t) ** 4) / 4;
        return { A: Math.PI * (r ** 2 - (r - t) ** 2), I22: I, I33: I }; }
      case 'general': { return { A: g.A ?? s.A ?? 0.1, I22: g.I22 ?? s.I22 ?? 1e-4,
        I33: g.I33 ?? s.I33 ?? 1e-3 }; }
      case 'autoselect': return { A: NaN, I33: NaN }; // resolved at analysis time
      default: return { A: 0, I22: 0, I33: 0 };
    }
  }

  // -------------------------------------------------------------- UI helpers
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function row(label, inner) {
    return `<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0">` +
      `<span style="width:160px;flex:none;opacity:.75;font-size:12px">${label}</span>${inner}</div>`;
  }
  const inp = (id, val, type = 'text', step = '') =>
    `<input id="${id}" type="${type}" ${step ? `step="${step}" min="0"` : ''} value="${esc(val)}" style="width:140px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px">`;
  const sel = (id, opts, cur) =>
    `<select id="${id}" style="width:150px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">` +
    opts.map(o => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('') + '</select>';
  const chk = (id, on) => `<input id="${id}" type="checkbox"${on ? ' checked' : ''}>`;
  const secTitle = t => `<div style="font-weight:600;margin:9px 0 3px;font-size:12px;color:#1a3c6e">${t}</div>`;
  function num(elId, fallback) {
    const el = document.getElementById(elId);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  }
  function txt(elId, fallback) {
    const el = document.getElementById(elId);
    return el ? el.value.trim() : fallback;
  }
  // scrollable body so tall editors stay readable inside the dialog
  const BODY_CSS = 'style="max-height:60vh;overflow:auto;padding-right:6px"';

  // editable (x,y) row tables — SS curves, RS/TH points, temperature data
  function rowsEditor(prefix, rows, xLab, yLab) {
    return `<table id="${prefix}-tbl" style="font-size:12px;border-collapse:collapse"><thead><tr>
      <th style="padding:2px 8px;opacity:.7">${xLab}</th><th style="padding:2px 8px;opacity:.7">${yLab}</th><th></th></tr></thead><tbody>` +
      rows.map((r, i) => rowRow(prefix, r, i)).join('') +
      `</tbody></table><button id="${prefix}-add" class="dlg-btn secondary" style="padding:2px 8px;font-size:11px;margin-top:3px">+ Row</button>`;
  }
  function rowRow(prefix, r, i) {
    return `<tr data-i="${i}"><td style="padding:1px"><input class="${prefix}-x" type="number" step="any" value="${esc(r[0])}" style="width:90px;padding:3px 6px;border:1px solid #c3cad1;border-radius:3px"></td>` +
      `<td style="padding:1px"><input class="${prefix}-y" type="number" step="any" value="${esc(r[1])}" style="width:90px;padding:3px 6px;border:1px solid #c3cad1;border-radius:3px"></td>` +
      `<td><button data-rm="${i}" style="padding:1px 6px">×</button></td></tr>`;
  }
  function readRows(scopeEl, prefix) {
    return [...scopeEl.querySelectorAll(`#${prefix}-tbl tbody tr`)].map(tr => [
      parseFloat(tr.querySelector(`.${prefix}-x`).value) || 0,
      parseFloat(tr.querySelector(`.${prefix}-y`).value) || 0,
    ]);
  }
  function wireRows(app, prefix, rows) {
    const btn = document.getElementById(`${prefix}-add`);
    btn.addEventListener('click', () => {
      const tb = document.querySelector(`#${prefix}-tbl tbody`);
      tb.insertAdjacentHTML('beforeend', rowRow(prefix, [0, 0], tb.children.length));
    });
    document.getElementById(`${prefix}-tbl`).addEventListener('click', e => {
      const b = e.target.closest('button[data-rm]');
      if (b) b.closest('tr').remove();
    });
  }

  // generic manager dialog: a list table + Add/Edit/Delete + Close
  function listDialog(app, title, items, columns, renderRow, onAdd, onEdit, onDelete, opts = {}) {
    const rows = items.map((it, i) =>
      `<tr data-i="${i}" style="cursor:pointer">${renderRow(it)}${onDelete ? `<td><button data-del="${i}" class="dlg-btn secondary" style="padding:2px 8px;font-size:11px">Delete</button></td>` : ''}</tr>`).join('');
    const html = `<div ${BODY_CSS}><table style="width:100%;border-collapse:collapse;font-size:12px">` +
      `<thead><tr style="text-align:left;opacity:.7">${columns.map(c => `<th style="padding:4px 6px;border-bottom:1px solid #d7dde3">${c}</th>`).join('')}<th></th></tr></thead>` +
      `<tbody>${rows || `<tr><td colspan="9" style="padding:8px;opacity:.6">${opts.emptyMsg || 'None defined — click Add New.'}</td></tr>`}</tbody></table></div>`;
    const buttons = [];
    if (onAdd) buttons.push(['Add New', () => { onAdd(); return false; }]);
    if (onEdit) buttons.push(['Edit Selected', () => {
      const tr = document.querySelector('#dialog table tbody tr.selected');
      if (!tr) { app.toast('Click a row first', true); return false; }
      onEdit(parseInt(tr.dataset.i, 10)); return false;
    }]);
    if (opts.extra) buttons.push(...opts.extra);
    buttons.push(['Close', null]);
    app.dialog(title, html, buttons);
    const tbody = document.querySelector('#dialog table tbody');
    tbody.addEventListener('click', e => {
      const del = e.target.closest('button[data-del]');
      if (del) { onDelete(parseInt(del.dataset.del, 10)); return; }
      const tr = e.target.closest('tr[data-i]');
      if (tr) {
        tbody.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');
      }
    });
  }

  // =========================================================== MATERIALS ====
  function newMaterial(name) {
    return {
      name, type: 'concrete', mechType: 'isotropic', region: '', standard: '', grade: '',
      iso: { E: 0, u: 0.2, a: 9.9e-6, G: 0, auto: true },
      ortho: { E11: 0, E22: 0, E33: 0, u12: 0.2, u13: 0.2, u23: 0.2, G12: 0, G13: 0, G23: 0 },
      weight: { value: 25, as: 'weight' },
      damping: { modalRatio: 0.05 },
      timeDep: { model: 'none' },
      conc: { fc: 25, lightweight: false, fcsFactor: 1, ssType: 0, ssHysType: 0, strainAtFc: 0.0022, strainUltimate: 0.0035, finalSlope: -0.1 },
      ssCurve: [], tempProps: [],
    };
  }

  function materialEditor(app, d, idx) {
    const isNew = idx < 0;
    const m = isNew ? newMaterial(uniqueName(d.materials, 'MAT'))
      : JSON.parse(JSON.stringify(d.materials[idx]));
    let libSel = '';
    if (isNew) {
      libSel = row('Add from library', sel('m-lib', ['(blank)', ...MAT_LIBRARY.map(x => x.label)], '(blank)'));
    }
    const mech = m.mechType === 'orthotropic' ? [
      secTitle('Orthotropic Properties'),
      row('E11 / E22 / E33', inp('m-E11', m.ortho.E11, 'number', 'any') + ' ' + inp('m-E22', m.ortho.E22, 'number', 'any') + ' ' + inp('m-E33', m.ortho.E33, 'number', 'any')),
      row('ν12 / ν13 / ν23', inp('m-u12', m.ortho.u12, 'number', 'any') + ' ' + inp('m-u13', m.ortho.u13, 'number', 'any') + ' ' + inp('m-u23', m.ortho.u23, 'number', 'any')),
      row('G12 / G13 / G23', inp('m-G12', m.ortho.G12, 'number', 'any') + ' ' + inp('m-G13', m.ortho.G13, 'number', 'any') + ' ' + inp('m-G23', m.ortho.G23, 'number', 'any')),
    ].join('') : [
      secTitle('Isotropic Properties'),
      row('E (MPa)', m.mechType === 'uniaxial' ? inp('m-E', m.iso.E, 'number', 'any') :
        (chk('m-auto', m.iso.auto) + ' <span style="font-size:11px;opacity:.7">auto from f&#8320;/w</span> ' + inp('m-E', m.iso.auto ? '' : m.iso.E, 'number', 'any'))),
      row('Poisson ν', inp('m-u', m.iso.u, 'number', 'any')),
      row('Thermal α (1/°C)', inp('m-a', m.iso.a, 'number', 'any')),
      row('G (MPa)', m.iso.auto ? '<span style="font-size:11px;opacity:.7">E / (2(1+ν))</span>' : inp('m-G', m.iso.G, 'number', 'any')),
    ].join('');
    const conc = m.type === 'concrete' ? [
      secTitle('Concrete (f&#8320; data)'),
      row("f'c (MPa)", inp('m-fc', m.conc.fc, 'number', 'any')),
      row('Lightweight', chk('m-lw', m.conc.lightweight)),
      row('f&#8320; strength factor', inp('m-fcs', m.conc.fcsFactor, 'number', 'any')),
      row('Strain at f&#8320;', inp('m-efc', m.conc.strainAtFc, 'number', 'any')),
      row('Ultimate strain', inp('m-ecu', m.conc.strainUltimate, 'number', 'any')),
      secTitle('User Stress-Strain Curve (optional)'),
      rowsEditor('ssc', m.ssCurve.map(p => [p[0], p[1]]), 'Strain', 'Stress (MPa)'),
    ].join('') : '';
    const ss = (m.type === 'rebar' || m.type === 'steel' || m.type === 'tendon') ? [
      secTitle('Uniaxial (steel / rebar / tendon)'),
      row('fy (MPa)', inp('m-fy', (m.rebar || m.steel || m.tendon || {}).fy, 'number', 'any')),
      row('fu (MPa)', inp('m-fu', (m.rebar || m.steel || m.tendon || {}).fu, 'number', 'any')),
      row('Strain at hardening', inp('m-eh', (m.rebar || m.steel || {}).strainAtHardening ?? '', 'number', 'any')),
    ].join('') : '';
    const html = `<div ${BODY_CSS}>` + [
      libSel,
      row('Name', inp('m-name', m.name)),
      row('Material Type', sel('m-type', MAT_TYPES, m.type)),
      row('Property Type', sel('m-mech', MP_TYPES, m.mechType)),
      row('Region / Standard', inp('m-region', m.region) + ' ' + inp('m-standard', m.standard)),
      row('Grade', inp('m-grade', m.grade)),
      mech,
      secTitle('Weight / Mass & Damping'),
      row('Unit value', inp('m-w', m.weight.value, 'number', 'any') + ' ' + sel('m-was', ['weight', 'mass'], m.weight.as) + ' <span style="font-size:11px;opacity:.7">kN/m³ / kg/m³</span>'),
      row('Damping (modal ratio)', inp('m-damp', m.damping.modalRatio, 'number', 'any')),
      row('Time dependence', sel('m-td', ['none', 'CEB-FIP 1990', 'ACI 209R-92', 'user'], m.timeDep.model)),
      conc, ss,
    ].join('') + '</div>';
    app.dialog((isNew ? 'Add ' : 'Edit ') + 'Material', html, [
      ['OK', () => {
        const name = txt('m-name', m.name);
        if (!name) { app.toast('Name required', true); return false; }
        if (isNew && byName(d.materials, name)) { app.toast('Name already exists', true); return false; }
        // library prefill before reading fields
        if (isNew) {
          const lib = txt('m-lib', '(blank)');
          const preset = MAT_LIBRARY.find(x => x.label === lib);
          if (preset) {
            const nm = txt('m-name', m.name); // keep the typed name
            Object.assign(m, JSON.parse(JSON.stringify(preset.patch)));
            m.name = nm;
          }
        }
        m.name = name;
        m.type = txt('m-type', m.type);
        m.mechType = txt('m-mech', m.mechType);
        m.region = txt('m-region', m.region);
        m.standard = txt('m-standard', m.standard);
        m.grade = txt('m-grade', m.grade);
        m.ortho.E11 = num('m-E11', m.ortho.E11); m.ortho.E22 = num('m-E22', m.ortho.E22); m.ortho.E33 = num('m-E33', m.ortho.E33);
        m.ortho.u12 = num('m-u12', m.ortho.u12); m.ortho.u13 = num('m-u13', m.ortho.u13); m.ortho.u23 = num('m-u23', m.ortho.u23);
        m.ortho.G12 = num('m-G12', m.ortho.G12); m.ortho.G13 = num('m-G13', m.ortho.G13); m.ortho.G23 = num('m-G23', m.ortho.G23);
        m.iso.auto = document.getElementById('m-auto') ? document.getElementById('m-auto').checked : false;
        m.iso.E = num('m-E', m.iso.E);
        m.iso.u = num('m-u', m.iso.u);
        m.iso.a = num('m-a', m.iso.a);
        if (!m.iso.auto) m.iso.G = num('m-G', m.iso.G);
        m.weight.value = num('m-w', m.weight.value);
        m.weight.as = txt('m-was', m.weight.as);
        m.damping.modalRatio = num('m-damp', m.damping.modalRatio);
        m.timeDep.model = txt('m-td', m.timeDep.model);
        if (m.type === 'concrete') {
          m.conc.fc = num('m-fc', 25);
          m.conc.lightweight = document.getElementById('m-lw').checked;
          m.conc.fcsFactor = num('m-fcs', m.conc.fcsFactor);
          m.conc.strainAtFc = num('m-efc', 0.0022);
          m.conc.strainUltimate = num('m-ecu', 0.0035);
          m.ssCurve = readRows(document.getElementById('dialog'), 'ssc');
        }
        if (m.type === 'rebar' || m.type === 'steel' || m.type === 'tendon') {
          const t = m.rebar || m.steel || m.tendon || { strainAtHardening: 0.008 };
          t.fy = num('m-fy', t.fy); t.fu = num('m-fu', t.fu);
          if (m.rebar) m.rebar = t; else if (m.steel) m.steel = t; else m.tendon = t;
        }
        if (isNew) d.materials.push(m); else d.materials[idx] = m;
        renderMaterials(app);
      }],
      ['Cancel', null],
    ]);
    const lib = document.getElementById('m-lib');
    if (lib) lib.addEventListener('change', () => {
      const preset = MAT_LIBRARY.find(x => x.label === lib.value);
      if (preset) document.getElementById('m-name').value = uniqueName(d.materials, preset.patch.name.split(/(?=[A-Z])/)[0]);
    });
    const ssc = document.getElementById('ssc-tbl');
    if (ssc) wireRows(app, 'ssc', m.ssCurve);
  }

  function renderMaterials(app) {
    const d = ensure(app);
    listDialog(app, 'Define Materials', d.materials,
      ['Name', 'Type', "f'c / fy", 'E (MPa)', 'Unit w'],
      m => ['<td style="padding:4px 6px">' + esc(m.name) + '</td>',
        '<td>' + esc(MAT_LABEL[m.type] || m.type) + '</td>',
        '<td>' + (m.conc ? "f'c " + m.conc.fc : ((m.rebar || m.steel || m.tendon) ? 'fy ' + (m.rebar || m.steel || m.tendon).fy : '—')) + ' MPa</td>',
        '<td>' + Math.round(matE(m)) + '</td>',
        '<td>' + m.weight.value + '</td>'].join(''),
      () => materialEditor(app, d, -1),
      i => materialEditor(app, d, i),
      i => { d.materials.splice(i, 1); renderMaterials(app); });
  }

  // ======================================================== REBAR DATABASE ==
  function rebarEditor(app, d, idx) {
    const isNew = idx < 0;
    const b = isNew ? { name: uniqueName(d.rebarDb, '16'), area: 201.1, dia: 16 }
      : JSON.parse(JSON.stringify(d.rebarDb[idx]));
    const html = [
      row('Designation', inp('rb-name', b.name)),
      row('Diameter (mm)', inp('rb-dia', b.dia, 'number', 'any')),
      row('Area (mm²)', inp('rb-area', b.area, 'number', 'any')),
    ].join('');
    app.dialog((isNew ? 'Add ' : 'Edit ') + 'Rebar Size', html, [
      ['OK', () => {
        const name = txt('rb-name', b.name);
        if (!name) { app.toast('Name required', true); return false; }
        b.name = name; b.dia = num('rb-dia', b.dia); b.area = num('rb-area', b.area);
        if (isNew) d.rebarDb.push(b); else d.rebarDb[idx] = b;
        d.rebarDb.sort((x, y) => x.dia - y.dia);
        renderRebarDb(app);
      }],
      ['Cancel', null],
    ]);
  }
  function renderRebarDb(app) {
    const d = ensure(app);
    listDialog(app, 'Rebar Database (bar sizes)', d.rebarDb, ['Name', '⌀ (mm)', 'Area (mm²)'],
      b => '<td style="padding:4px 6px">' + esc(b.name) + '</td><td>' + b.dia + '</td><td>' + b.area + '</td>',
      () => rebarEditor(app, d, -1), i => rebarEditor(app, d, i),
      i => { d.rebarDb.splice(i, 1); renderRebarDb(app); });
  }

  // ======================================================= FRAME SECTIONS ===
  function geoFields(s) {
    const g = s.dims || {};
    switch (s.type) {
      case 'rect': return [row('Depth h (m)', inp('g-h', g.h ?? s.t3 ?? 0.5, 'number', 'any')), row('Width b (m)', inp('g-b', g.b ?? s.t2 ?? 0.3, 'number', 'any'))];
      case 'circle': return [row('Diameter (m)', inp('g-dia', g.dia ?? s.t3 ?? 0.5, 'number', 'any'))];
      case 'concTee': return [row('Total depth (m)', inp('g-h', g.h ?? s.t3 ?? 0.5, 'number', 'any')),
        row('Flange width bf (m)', inp('g-bf', g.bf ?? s.t2 ?? 0.6, 'number', 'any')),
        row('Flange thickness tf (m)', inp('g-tf', g.tf ?? s.tf ?? 0.1, 'number', 'any')),
        row('Web thickness tw (m)', inp('g-tw', g.tw ?? s.twT ?? 0.25, 'number', 'any'))];
      case 'I': return [row('Depth h (m)', inp('g-h', g.h ?? 0.5, 'number', 'any')),
        row('Flange width bf (m)', inp('g-bf', g.bf ?? 0.2, 'number', 'any')),
        row('Flange thickness tf (m)', inp('g-tf', g.tf ?? 0.015, 'number', 'any')),
        row('Web thickness tw (m)', inp('g-tw', g.tw ?? 0.01, 'number', 'any'))];
      case 'channel': return [row('Depth h (m)', inp('g-h', g.h ?? 0.25, 'number', 'any')),
        row('Flange width b (m)', inp('g-b', g.b ?? 0.08, 'number', 'any')),
        row('Flange thickness tf (m)', inp('g-tf', g.tf ?? 0.012, 'number', 'any')),
        row('Web thickness tw (m)', inp('g-tw', g.tw ?? 0.008, 'number', 'any'))];
      case 'angle': return [row('Leg A (m)', inp('g-h', g.h ?? 0.15, 'number', 'any')),
        row('Leg B (m)', inp('g-b', g.b ?? 0.15, 'number', 'any')),
        row('Thickness t (m)', inp('g-tw', g.tw ?? 0.012, 'number', 'any'))];
      case 'box': return [row('Depth h (m)', inp('g-h', g.h ?? 0.3, 'number', 'any')),
        row('Width b (m)', inp('g-b', g.b ?? 0.3, 'number', 'any')),
        row('Flange thickness tf (m)', inp('g-tf', g.tf ?? 0.012, 'number', 'any')),
        row('Web thickness tw (m)', inp('g-tw', g.tw ?? 0.012, 'number', 'any'))];
      case 'pipe': return [row('Diameter (m)', inp('g-dia', g.dia ?? 0.3, 'number', 'any')),
        row('Wall thickness tw (m)', inp('g-tw', g.tw ?? 0.008, 'number', 'any'))];
      case 'general': return [row('Area A (m²)', inp('g-A', g.A ?? 0.1, 'number', 'any')),
        row('I22 (m⁴)', inp('g-I22', g.I22 ?? 1e-4, 'number', 'any')),
        row('I33 (m⁴)', inp('g-I33', g.I33 ?? 1e-3, 'number', 'any'))];
      case 'autoselect': return [row('Try list (sections)', `<input id="g-auto" value="${esc((s.autoList || []).join(','))}" style="width:200px;padding:4px 8px;border:1px solid #c3cad1;border-radius:4px" title="comma-separated section names">`),
        row('Start section', inp('g-autostart', s.autoStart || '', 'text'))];
      default: return [];
    }
  }
  function readGeo(s) {
    s.dims = s.dims || {};
    switch (s.type) {
      case 'rect': s.dims.h = num('g-h', 0.5); s.dims.b = num('g-b', 0.3); s.t3 = s.dims.h; s.t2 = s.dims.b; break;
      case 'circle': s.dims.dia = num('g-dia', 0.5); s.t3 = s.dims.dia; break;
      case 'concTee': s.dims.h = num('g-h', 0.5); s.dims.bf = num('g-bf', 0.6); s.dims.tf = num('g-tf', 0.1); s.dims.tw = num('g-tw', 0.25);
        s.t3 = s.dims.h; s.t2 = s.dims.bf; s.tf = s.dims.tf; s.twT = s.dims.tw; break;
      case 'I': s.dims.h = num('g-h', 0.5); s.dims.bf = num('g-bf', 0.2); s.dims.tf = num('g-tf', 0.015); s.dims.tw = num('g-tw', 0.01); break;
      case 'channel': s.dims.h = num('g-h', 0.25); s.dims.b = num('g-b', 0.08); s.dims.tf = num('g-tf', 0.012); s.dims.tw = num('g-tw', 0.008); break;
      case 'angle': s.dims.h = num('g-h', 0.15); s.dims.b = num('g-b', 0.15); s.dims.tw = num('g-tw', 0.012); break;
      case 'box': s.dims.h = num('g-h', 0.3); s.dims.b = num('g-b', 0.3); s.dims.tf = num('g-tf', 0.012); s.dims.tw = num('g-tw', 0.012); break;
      case 'pipe': s.dims.dia = num('g-dia', 0.3); s.dims.tw = num('g-tw', 0.008); break;
      case 'general': s.dims.A = num('g-A', 0.1); s.dims.I22 = num('g-I22', 1e-4); s.dims.I33 = num('g-I33', 1e-3); break;
      case 'autoselect': s.autoList = txt('g-auto', '').split(',').map(x => x.trim()).filter(Boolean); s.autoStart = txt('g-autostart', ''); break;
    }
  }

  function frameSectionEditor(app, d, idx) {
    const isNew = idx < 0;
    const s = isNew
      ? { name: uniqueName(d.frameSections, 'FSEC'), type: 'rect', designType: 'beam', material: 'CONC25',
          dims: {}, modifiers: { a: 1, as2: 1, as3: 1, torsion: 1, i22: 1, i33: 1, mass: 1, weight: 1 }, autoList: [], autoStart: '',
          rebar: JSON.parse(JSON.stringify(d.frameSections[0].rebar)) }
      : JSON.parse(JSON.stringify(d.frameSections[idx]));
    if (!s.dims) s.dims = {};
    if (!s.modifiers) s.modifiers = { a: 1, i22: 1, i33: 1, mass: 1, weight: 1 };
    const concMats = d.materials.filter(m => m.type === 'concrete').map(m => m.name);
    const steelMats = d.materials.filter(m => m.type === 'steel').map(m => m.name);
    const r = s.rebar;
    const mod = s.modifiers;
    const html = `<div ${BODY_CSS}>` + [
      row('Name', inp('s-name', s.name)),
      row('Section Type', sel('s-type', FRAME_TYPES, s.type)),
      row('Design Type', sel('s-dt', ['beam', 'column', 'brace'], s.designType || 'beam')),
      row('Material', sel('s-mat', concMats.concat(steelMats), s.material)),
      ...geoFields(s),
      secTitle('Stiffness Modifiers (analysis factors)'),
      row('A / As2 / As3 / J ×', inp('mo-a', mod.a, 'number', 'any') + ' ' + inp('mo-as2', mod.as2, 'number', 'any') + ' ' + inp('mo-as3', mod.as3, 'number', 'any') + ' ' + inp('mo-torsion', mod.torsion, 'number', 'any')),
      row('I22 × / I33 ×', inp('mo-i22', mod.i22, 'number', 'any') + ' ' + inp('mo-i33', mod.i33, 'number', 'any')),
      row('Mass × / Weight ×', inp('mo-m', mod.mass, 'number', 'any') + ' ' + inp('mo-w', mod.weight, 'number', 'any')),
      secTitle('Rebar (beam overlay)'),
      row('Longitudinal mat.', sel('s-rmat', d.materials.filter(m => m.type === 'rebar').map(m => m.name), r.longMat)),
      row('Cover top / bot (m)', inp('s-ct', r.coverTop, 'number', 'any') + ' ' + inp('s-cb', r.coverBot, 'number', 'any')),
      row('Top L/R area (mm²)', inp('s-tl', r.topLeft ? r.topLeft * 1e6 : 0, 'number', 'any') + ' ' + inp('s-tr', r.topRight ? r.topRight * 1e6 : 0, 'number', 'any')),
      row('Bot L/R area (mm²)', inp('s-bl', r.botLeft ? r.botLeft * 1e6 : 0, 'number', 'any') + ' ' + inp('s-br', r.botRight ? r.botRight * 1e6 : 0, 'number', 'any')),
      secTitle('Rebar (column overlay)'),
      row('Cover (m)', inp('s-cvc', r.colCover, 'number', 'any')),
      row('Corner bars', inp('s-nc', r.nC, 'number', '1')),
      row('Bars face 3 / 2', inp('s-nr3', r.nR3, 'number', '1') + ' ' + inp('s-nr2', r.nR2, 'number', '1')),
      row('Bar size', sel('s-rs', d.rebarDb.map(b => b.name), r.rebarSize)),
      row('Tie size', sel('s-ts', d.rebarDb.map(b => b.name), r.tieSize)),
      row('Tie spacing (m)', inp('s-tsp', r.tieSpacingLongit, 'number', 'any')),
      row('To Be Designed', chk('s-tbd', r.toBeDesigned)),
    ].join('') + '</div>';
    app.dialog((isNew ? 'Add ' : 'Edit ') + 'Frame Section', html, [
      ['OK', () => {
        const name = txt('s-name', s.name);
        if (!name) { app.toast('Name required', true); return false; }
        if (isNew && byName(d.frameSections, name)) { app.toast('Name already exists', true); return false; }
        s.name = name;
        s.type = txt('s-type', s.type);
        s.designType = txt('s-dt', 'beam');
        s.material = txt('s-mat', s.material);
        readGeo(s);
        mod.a = num('mo-a', 1); mod.as2 = num('mo-as2', 1); mod.as3 = num('mo-as3', 1);
        mod.torsion = num('mo-torsion', 1);
        mod.i22 = num('mo-i22', 1); mod.i33 = num('mo-i33', 1);
        mod.mass = num('mo-m', 1); mod.weight = num('mo-w', 1);
        r.longMat = txt('s-rmat', r.longMat);
        r.coverTop = num('s-ct', r.coverTop);
        r.coverBot = num('s-cb', r.coverBot);
        r.topLeft = num('s-tl', 0) / 1e6; r.topRight = num('s-tr', 0) / 1e6;
        r.botLeft = num('s-bl', 0) / 1e6; r.botRight = num('s-br', 0) / 1e6;
        r.colCover = num('s-cvc', r.colCover);
        r.nC = num('s-nc', r.nC); r.nR3 = num('s-nr3', r.nR3); r.nR2 = num('s-nr2', r.nR2);
        r.rebarSize = txt('s-rs', r.rebarSize);
        r.tieSize = txt('s-ts', r.tieSize);
        r.tieSpacingLongit = num('s-tsp', r.tieSpacingLongit);
        r.toBeDesigned = document.getElementById('s-tbd').checked;
        if (isNew) d.frameSections.push(s); else d.frameSections[idx] = s;
        renderFrameSections(app);
      }],
      ['Cancel', null],
    ]);
  }

  function renderFrameSections(app) {
    const d = ensure(app);
    listDialog(app, 'Define Frame Sections', d.frameSections,
      ['Name', 'Type', 'Design', 'Material', 'Dimensions', 'A (m²) / I33 (m⁴)', 'Rebar', 'Used'],
      s => {
        const p = frameSectionProps(s);
        const dm = s.dims || {};
        const dim = s.type === 'circle' || s.type === 'pipe'
          ? `⌀${((dm.dia ?? 0) * 1000).toFixed(0)}`
          : s.type === 'autoselect' ? (s.autoList || []).slice(0, 3).join('/') + ((s.autoList || []).length > 3 ? '…' : '')
          : `${((dm.b ?? dm.bf ?? 0) * 1000).toFixed(0)}×${((dm.h ?? dm.dia ?? 0) * 1000).toFixed(0)}` +
            (s.type === 'concTee' ? ' T' : '');
        return ['<td style="padding:4px 6px">' + esc(s.name) + '</td>',
          '<td>' + (FRAME_LABEL[s.type] || s.type) + '</td>',
          '<td>' + esc(s.designType || 'beam') + '</td>',
          '<td>' + esc(s.material) + '</td>', '<td>' + dim + '</td>',
          '<td>' + (isNaN(p.A) ? 'auto' : p.A.toFixed(3) + ' / ' + p.I33.toExponential(2)) + '</td>',
          '<td>' + (s.rebar.toBeDesigned ? 'to be designed' : esc(s.rebar.rebarSize)) + '</td>',
          '<td>' + sectionUsage(app, s.name) + '</td>'].join('');
      },
      () => frameSectionEditor(app, d, -1),
      i => frameSectionEditor(app, d, i),
      i => {
        const used = sectionUsage(app, d.frameSections[i].name);
        const doDelete = () => { d.frameSections.splice(i, 1); renderFrameSections(app); };
        if (used > 0) {
          app.dialog('Section In Use', `<p>${esc(d.frameSections[i].name)} is referenced by <b>${used}</b> drawn element(s). Delete it anyway? Those elements fall back to a new auto section on the next sync.</p>`,
            [['Cancel', null], ['Delete Anyway', doDelete]]);
        } else doDelete();
      });
  }

  // ========================================================= AREA SECTIONS ==
  function areaSectionEditor(app, d, idx) {
    const isNew = idx < 0;
    const s = isNew
      ? { name: uniqueName(d.areaSections, 'ASEC'), type: 'slab', material: 'CONC25', thickness: 0.2, ribs: null }
      : JSON.parse(JSON.stringify(d.areaSections[idx]));
    const concMats = d.materials.filter(m => m.type === 'concrete').map(m => m.name);
    const isRib = s.type === 'ribbedslab' || s.type === 'waffleslab';
    s.ribs = s.ribs || { spacing: 0.9, ribWidth: 0.15, ribDepth: 0.35, topping: 0.06 };
    const html = [
      row('Name', inp('a-name', s.name)),
      row('Type', sel('a-type', ['slab', 'deck', 'wall', 'plate', 'ribbedslab', 'waffleslab'], s.type)),
      row('Material', sel('a-mat', concMats, s.material)),
      row('Thickness (m)', inp('a-t', s.thickness, 'number', 'any')),
      isRib ? secTitle('Rib Data') +
        row('Rib spacing (m)', inp('a-rs', s.ribs.spacing, 'number', 'any')) +
        row('Rib width (m)', inp('a-rw', s.ribs.ribWidth, 'number', 'any')) +
        row('Rib depth (m)', inp('a-rd', s.ribs.ribDepth, 'number', 'any')) +
        row('Topping thickness (m)', inp('a-rt', s.ribs.topping, 'number', 'any')) : '',
    ].join('');
    app.dialog((isNew ? 'Add ' : 'Edit ') + 'Area Section', html, [
      ['OK', () => {
        const name = txt('a-name', s.name);
        if (!name) { app.toast('Name required', true); return false; }
        if (isNew && byName(d.areaSections, name)) { app.toast('Name already exists', true); return false; }
        s.name = name; s.type = txt('a-type', s.type); s.material = txt('a-mat', s.material);
        s.thickness = num('a-t', s.thickness);
        if (s.type === 'ribbedslab' || s.type === 'waffleslab') {
          s.ribs = { spacing: num('a-rs', 0.9), ribWidth: num('a-rw', 0.15), ribDepth: num('a-rd', 0.35), topping: num('a-rt', 0.06) };
        }
        if (isNew) d.areaSections.push(s); else d.areaSections[idx] = s;
        renderAreaSections(app);
      }],
      ['Cancel', null],
    ]);
  }
  function renderAreaSections(app) {
    const d = ensure(app);
    listDialog(app, 'Define Area Sections', d.areaSections, ['Name', 'Type', 'Material', 'Thickness / Ribs', 'Used'],
      s => '<td style="padding:4px 6px">' + esc(s.name) + '</td><td>' + esc(s.type) + '</td><td>' + esc(s.material) + '</td><td>' +
        (s.ribs ? `${(s.ribs.spacing * 1000)}mm c/c rib + ${(s.ribs.topping * 1000)}mm top` : (s.thickness * 1000) + ' mm') + '</td><td>' + sectionUsage(app, s.name) + '</td>',
      () => areaSectionEditor(app, d, -1), i => areaSectionEditor(app, d, i),
      i => {
        const used = sectionUsage(app, d.areaSections[i].name);
        const doDelete = () => { d.areaSections.splice(i, 1); renderAreaSections(app); };
        if (used > 0) {
          app.dialog('Section In Use', `<p>${esc(d.areaSections[i].name)} is referenced by <b>${used}</b> drawn element(s). Delete it anyway? Those elements fall back to a new auto section on the next sync.</p>`,
            [['Cancel', null], ['Delete Anyway', doDelete]]);
        } else doDelete();
      });
  }

  // ============================================== SOLID / CABLE / SPRINGS ===
  function renderSolidSections(app) {
    const d = ensure(app);
    listDialog(app, 'Define Solid Sections', d.solidSections, ['Name', 'Material'],
      s => '<td style="padding:4px 6px">' + esc(s.name) + '</td><td>' + esc(s.material) + '</td>',
      () => { d.solidSections.push({ name: uniqueName(d.solidSections, 'SOLID'), material: 'CONC25' }); renderSolidSections(app); },
      null,
      i => { d.solidSections.splice(i, 1); renderSolidSections(app); },
      { emptyMsg: 'Solid geometry is defined by the object; this names the section + material.' });
  }
  function renderCableSections(app) {
    const d = ensure(app);
    listDialog(app, 'Define Cable Sections', d.cableSections, ['Name', 'Material', 'Area (mm²)'],
      s => '<td style="padding:4px 6px">' + esc(s.name) + '</td><td>' + esc(s.material) + '</td><td>' + (s.area * 1e6) + '</td>',
      () => { d.cableSections.push({ name: uniqueName(d.cableSections, 'CABLE'), material: 'STEEL_A992', area: 1e-3 }); renderCableSections(app); },
      null,
      i => { d.cableSections.splice(i, 1); renderCableSections(app); });
  }
  function springDialogs(app, kind) {
    const d = ensure(app);
    const list = kind === 'point' ? d.pointSprings : kind === 'line' ? d.lineSprings : d.areaSprings;
    const title = { point: 'Point Springs', line: 'Line Springs', area: 'Area Springs' }[kind];
    const cols = kind === 'point' ? ['Name', 'Type', 'K1 / K2 / K3 (kN/m)']
      : kind === 'line' ? ['Name', 'Subgrade kz (kN/m/m)'] : ['Name', 'kz (kN/m/m²)'];
    const render = sp => kind === 'point'
      ? `<td style="padding:4px 6px">${esc(sp.name)}</td><td>${esc(sp.type)}</td><td>${sp.k1} / ${sp.k2} / ${sp.k3}</td>`
      : kind === 'line' ? `<td style="padding:4px 6px">${esc(sp.name)}</td><td>${sp.kz}</td>`
      : `<td style="padding:4px 6px">${esc(sp.name)}</td><td>${sp.kz}</td>`;
    const add = () => {
      if (kind === 'point') list.push({ name: uniqueName(list, 'SPRING'), type: 'linear', k1: 1e6, k2: 1e6, k3: 1e6 });
      else if (kind === 'line') list.push({ name: uniqueName(list, 'LSPRING'), kz: 1e5 });
      else list.push({ name: uniqueName(list, 'ASPRING'), kz: 1e4 });
      springDialogs(app, kind);
    };
    const edit = i => {
      const sp = list[i];
      const fields = kind === 'point'
        ? [row('Name', inp('sp-name', sp.name)), row('Type', sel('sp-type', ['linear'], sp.type)),
           row('K1 / K2 / K3', inp('sp-k1', sp.k1, 'number', 'any') + ' ' + inp('sp-k2', sp.k2, 'number', 'any') + ' ' + inp('sp-k3', sp.k3, 'number', 'any'))]
        : kind === 'line'
        ? [row('Name', inp('sp-name', sp.name)), row('Subgrade kz (kN/m/m)', inp('sp-kz', sp.kz, 'number', 'any'))]
        : [row('Name', inp('sp-name', sp.name)), row('kz (kN/m/m²)', inp('sp-kz', sp.kz, 'number', 'any'))];
      app.dialog('Edit ' + title.replace(/s$/, ''), fields.join(''), [
        ['OK', () => {
          sp.name = txt('sp-name', sp.name);
          if (kind === 'point') { sp.type = txt('sp-type', sp.type); sp.k1 = num('sp-k1', sp.k1); sp.k2 = num('sp-k2', sp.k2); sp.k3 = num('sp-k3', sp.k3); }
          else sp.kz = num('sp-kz', sp.kz);
          springDialogs(app, kind);
        }],
        ['Cancel', null],
      ]);
    };
    listDialog(app, 'Define ' + title, list, cols, render, add, edit,
      i => { list.splice(i, 1); springDialogs(app, kind); });
  }

  // ========================================================= LOAD PATTERNS ==
  function loadPatternEditor(app, d, idx) {
    const isNew = idx < 0;
    const p = isNew
      ? { name: uniqueName(d.loadPatterns, 'PATTERN'), type: 'DEAD', selfWtMult: 0, auto: null, color: -1 }
      : JSON.parse(JSON.stringify(d.loadPatterns[idx]));
    const html = [
      row('Name', inp('p-name', p.name)),
      row('Load Type', sel('p-type', PATTERN_TYPES, p.type)),
      row('Self-wt multiplier', inp('p-swt', p.selfWtMult, 'number', 'any')),
      row('Auto load', sel('p-auto', ['None', 'Auto Seismic', 'Auto Wind'], p.auto ? (p.auto.seismic ? 'Auto Seismic' : 'Auto Wind') : 'None')),
    ].join('');
    app.dialog((isNew ? 'Add ' : 'Edit ') + 'Load Pattern', html, [
      ['OK', () => {
        const name = txt('p-name', p.name);
        if (!name) { app.toast('Name required', true); return false; }
        if (isNew && byName(d.loadPatterns, name)) { app.toast('Name already exists', true); return false; }
        p.name = name; p.type = txt('p-type', p.type); p.selfWtMult = num('p-swt', p.selfWtMult);
        const auto = txt('p-auto', 'None');
        p.auto = auto === 'Auto Seismic' ? { seismic: JSON.parse(JSON.stringify(d.autoSeismic)) }
          : auto === 'Auto Wind' ? { wind: JSON.parse(JSON.stringify(d.autoWind)) } : null;
        if (isNew) d.loadPatterns.push(p); else d.loadPatterns[idx] = p;
        renderLoadPatterns(app);
      }],
      ['Cancel', null],
    ]);
  }
  function renderLoadPatterns(app) {
    const d = ensure(app);
    listDialog(app, 'Define Load Patterns', d.loadPatterns, ['Name', 'Type', 'Self-wt mult', 'Auto'],
      p => '<td style="padding:4px 6px">' + esc(p.name) + '</td><td>' + esc(p.type) + '</td><td>' + p.selfWtMult + '</td><td>' + (p.auto ? (p.auto.seismic ? 'Seismic' : 'Wind') : '—') + '</td>',
      () => loadPatternEditor(app, d, -1), i => loadPatternEditor(app, d, i),
      i => { d.loadPatterns.splice(i, 1); renderLoadPatterns(app); });
  }

  // ============================================================= LOAD CASES =
  function loadCaseEditor(app, d, idx) {
    const isNew = idx < 0;
    const c = isNew
      ? { name: uniqueName(d.loadCases, 'CASE'), type: 'static', data: {} }
      : JSON.parse(JSON.stringify(d.loadCases[idx]));
    c.data = c.data || {};
    const names = d.loadPatterns.map(p => p.name);
    const loads = (c.data.loads || []).map((x, i) =>
      `<div>${sel('lc-n' + i, names, x.name)} × ${inp('lc-s' + i, x.scale, 'number', 'any')} <button data-rm="${i}" style="padding:1px 6px">×</button></div>`).join('');
    const byType = {
      static: [
        secTitle('Applied Loads (pattern × scale)'),
        `<div id="lc-loads">${loads || '<span style="opacity:.6;font-size:12px">none</span>'}</div>`,
        row('P-Delta', chk('lc-pd', !!c.data.pDelta)),
        row('Stiffness modifiers', chk('lc-mod', !!c.data.useModifiers) + ' <span style="font-size:11px;opacity:.7">use section modifiers</span>'),
      ],
      modal: [
        row('Method', sel('lc-mmethod', ['eigen', 'ritz'], c.data.method || 'eigen')),
        row('Number of modes', inp('lc-nm', c.data.numModes ?? 12, 'number', '1')),
        row('Max period (s, 0=auto)', inp('lc-mp', c.data.maxPeriod ?? 0, 'number', 'any')),
      ],
      'response spectrum': [
        row('Direction X fn', sel('lc-fx', ['(none)', ...d.rsFunctions.map(f => f.name)], (c.data.fns || {}).X || '(none)')),
        row('Direction Y fn', sel('lc-fy', ['(none)', ...d.rsFunctions.map(f => f.name)], (c.data.fns || {}).Y || '(none)')),
        row('Direction Z fn', sel('lc-fz', ['(none)', ...d.rsFunctions.map(f => f.name)], (c.data.fns || {}).Z || '(none)')),
        row('Modal combination', sel('lc-mc', ['CQC', 'SRSS'], c.data.combo || 'CQC')),
        row('Damping ratio', inp('lc-damp', c.data.damping ?? 0.05, 'number', 'any')),
        row('Scale (g→m/s², 0=auto)', inp('lc-scale', c.data.scale ?? 9.81, 'number', 'any')),
      ],
      'time history': [
        row('Function', sel('lc-thf', d.thFunctions.map(f => f.name), c.data.fn)),
        row('Scale factor', inp('lc-ths', c.data.scale ?? 1, 'number', 'any')),
        row('Damping ratio', inp('lc-damp', c.data.damping ?? 0.05, 'number', 'any')),
        row('Type', sel('lc-tht', ['modal', 'direct integration'], c.data.thType || 'modal')),
      ],
      buckling: [row('Number of modes', inp('lc-nm', c.data.numModes ?? 1, 'number', '1'))],
      'moving load': [], 'hyperstatic': [], 'staged construction': [],
    }[c.type] || [];
    const html = `<div ${BODY_CSS}>` + [
      row('Name', inp('c-name', c.name)),
      row('Case Type', sel('c-type', CASE_TYPES, c.type)),
      ...byType,
    ].join('') + '</div>';
    app.dialog((isNew ? 'Add ' : 'Edit ') + 'Load Case — ' + c.type, html, [
      ['Add Load Row', () => {
        const n = (c.data.loads || []).length;
        c.data.loads = c.data.loads || [];
        c.data.loads.push({ name: names[0] || '', scale: 1 });
        document.getElementById('lc-loads').insertAdjacentHTML('beforeend',
          `<div>${sel('lc-n' + n, names, c.data.loads[n].name)} × ${inp('lc-s' + n, 1, 'number', 'any')} <button data-rm="${n}" style="padding:1px 6px">×</button></div>`);
        return false;
      }],
      ['OK', () => {
        const name = txt('c-name', c.name);
        if (!name) { app.toast('Name required', true); return false; }
        if (isNew && byName(d.loadCases, name)) { app.toast('Name already exists', true); return false; }
        c.name = name; c.type = txt('c-type', c.type);
        const t = c.type;
        if (t === 'static') {
          const rowsN = (c.data.loads || []).length;
          c.data.loads = [];
          for (let i = 0; i < rowsN; i++) {
            const nm = txt('lc-n' + i, '');
            if (nm) c.data.loads.push({ name: nm, scale: num('lc-s' + i, 1) });
          }
          c.data.pDelta = document.getElementById('lc-pd').checked;
          c.data.useModifiers = document.getElementById('lc-mod').checked;
        } else if (t === 'modal') {
          c.data = { method: txt('lc-mmethod', 'eigen'), numModes: num('lc-nm', 12), maxPeriod: num('lc-mp', 0) };
        } else if (t === 'response spectrum') {
          c.data = { fns: {}, combo: txt('lc-mc', 'CQC'), damping: num('lc-damp', 0.05), scale: num('lc-scale', 9.81) };
          const fx = txt('lc-fx', '(none)'), fy = txt('lc-fy', '(none)'), fz = txt('lc-fz', '(none)');
          if (fx !== '(none)') c.data.fns.X = fx;
          if (fy !== '(none)') c.data.fns.Y = fy;
          if (fz !== '(none)') c.data.fns.Z = fz;
        } else if (t === 'time history') {
          c.data = { fn: txt('lc-thf', ''), scale: num('lc-ths', 1), damping: num('lc-damp', 0.05), thType: txt('lc-tht', 'modal') };
        } else if (t === 'buckling') {
          c.data = { numModes: num('lc-nm', 1) };
        } else c.data = {};
        if (isNew) d.loadCases.push(c); else d.loadCases[idx] = c;
        renderLoadCases(app);
      }],
      ['Cancel', null],
    ]);
    const lc = document.getElementById('lc-loads');
    if (lc) lc.addEventListener('click', e => {
      const b = e.target.closest('button[data-rm]');
      if (b) { c.data.loads.splice(parseInt(b.dataset.rm, 10), 1); b.parentElement.remove(); }
    });
  }
  function renderLoadCases(app) {
    const d = ensure(app);
    listDialog(app, 'Define Load Cases', d.loadCases, ['Name', 'Type', 'Setup'],
      c => {
        let s = '—';
        if (c.type === 'static') s = (c.data.loads || []).map(x => `${x.name}×${x.scale}`).join(' + ') + (c.data.pDelta ? ' · P-Δ' : '');
        if (c.type === 'modal') s = `${c.data.numModes} ${c.data.method} modes`;
        if (c.type === 'response spectrum') s = Object.entries(c.data.fns || {}).map(([k, v]) => `${k}:${v}`).join(' ') + ` · ${c.data.combo}`;
        if (c.type === 'time history') s = `${c.data.fn} ×${c.data.scale}`;
        if (c.type === 'buckling') s = `${c.data.numModes} mode(s)`;
        return '<td style="padding:4px 6px">' + esc(c.name) + '</td><td>' + esc(c.type) + '</td><td>' + esc(s) + '</td>';
      },
      () => loadCaseEditor(app, d, -1), i => loadCaseEditor(app, d, i),
      i => { d.loadCases.splice(i, 1); renderLoadCases(app); });
  }

  // ====================================================== LOAD COMBINATIONS =
  // ACI 318-19 §5.3 basic strength combos, built from the patterns that exist
  function autoGenerateCombos(d) {
    const has = n => byName(d.loadPatterns, n);
    const D = has('DEAD') ? 'DEAD' : (d.loadPatterns[0] || {}).name;
    const out = [];
    const add = (name, cases) => { if (!byName(d.combos, name)) out.push({ name, type: 'add', cases }); };
    if (D) {
      add('U1: 1.4D', [{ name: D, scale: 1.4 }]);
      const L = has('LIVE');
      if (L) {
        add('U2: 1.2D+1.6L', [{ name: D, scale: 1.2 }, { name: 'LIVE', scale: 1.6 }]);
      }
      const E = has('QUAKE');
      if (E) {
        add('U3: 1.2D+1.0E+1.0L', [{ name: D, scale: 1.2 }, { name: 'QUAKE', scale: 1.0 }, ...(L ? [{ name: 'LIVE', scale: 1.0 }] : [])]);
        add('U4: 0.9D-1.0E', [{ name: D, scale: 0.9 }, { name: 'QUAKE', scale: -1.0 }]);
      }
      const W = has('WIND');
      if (W) {
        add('U5: 1.2D+1.0W+1.0L', [{ name: D, scale: 1.2 }, { name: 'WIND', scale: 1.0 }, ...(L ? [{ name: 'LIVE', scale: 1.0 }] : [])]);
        add('U6: 0.9D-1.0W', [{ name: D, scale: 0.9 }, { name: 'WIND', scale: -1.0 }]);
      }
    }
    return out;
  }

  function comboEditor(app, d, idx) {
    const isNew = idx < 0;
    const cb = isNew ? { name: uniqueName(d.combos, 'COMBO'), type: 'add', cases: [] } : JSON.parse(JSON.stringify(d.combos[idx]));
    const names = d.loadCases.map(c => c.name).concat(d.loadPatterns.map(p => p.name));
    const rows = cb.cases.map((x, i) =>
      `<div>${sel('cb-n' + i, names, x.name)} ${inp('cb-s' + i, x.scale, 'number', 'any')} <button data-rm="${i}" style="padding:1px 6px">×</button></div>`).join('');
    const html = [row('Name', inp('cb-name', cb.name)),
      row('Combo Type', sel('cb-type', ['add', 'absolute add', 'SRSS', 'envelope'], cb.type || 'add')),
      secTitle('Cases (case/pattern + scale)'),
      `<div id="cb-rows">${rows || '<span style="opacity:.6;font-size:12px">none</span>'}</div>`].join('');
    app.dialog((isNew ? 'Add ' : 'Edit ') + 'Load Combination', html, [
      ['Add Row', () => {
        const n = cb.cases.length;
        cb.cases.push({ name: names[0] || '', scale: 1 });
        document.getElementById('cb-rows').insertAdjacentHTML('beforeend',
          `<div>${sel('cb-n' + n, names, cb.cases[n].name)} ${inp('cb-s' + n, 1, 'number', 'any')} <button data-rm="${n}">×</button></div>`);
        return false;
      }],
      ['OK', () => {
        const name = txt('cb-name', cb.name);
        if (!name) { app.toast('Name required', true); return false; }
        cb.name = name; cb.type = txt('cb-type', 'add');
        for (let i = 0; i < cb.cases.length; i++) {
          cb.cases[i].name = txt('cb-n' + i, cb.cases[i].name);
          cb.cases[i].scale = num('cb-s' + i, 1);
        }
        cb.cases = cb.cases.filter(x => x.name);
        if (isNew) d.combos.push(cb); else d.combos[idx] = cb;
        renderCombos(app);
      }],
      ['Cancel', null],
    ]);
    document.getElementById('cb-rows').addEventListener('click', e => {
      const b = e.target.closest('button[data-rm]');
      if (b) { cb.cases.splice(parseInt(b.dataset.rm, 10), 1); b.parentElement.remove(); }
    });
  }
  function renderCombos(app) {
    const d = ensure(app);
    listDialog(app, 'Define Load Combinations', d.combos, ['Name', 'Type', 'Contents'],
      cb => '<td style="padding:4px 6px">' + esc(cb.name) + '</td><td>' + esc(cb.type || 'add') + '</td><td>' + cb.cases.map(x => `${esc(x.name)}×${x.scale}`).join(' + ') + '</td>',
      () => comboEditor(app, d, -1), i => comboEditor(app, d, i),
      i => { d.combos.splice(i, 1); renderCombos(app); },
      { extra: [['Auto: ACI 318-19 Defaults', () => {
        const made = autoGenerateCombos(d);
        d.combos.push(...made);
        app.toast(made.length ? `${made.length} default combo(s) added` : 'All default combos already exist', !made.length);
        renderCombos(app);
        return false;
      }]] });
  }

  // ------------------------------------------------------------ mass source
  function renderMassSource(app) {
    const d = ensure(app);
    const ms = d.massSource;
    const rows = ms.loads.map((x, i) => `<div>${sel('ms-n' + i, d.loadPatterns.map(p => p.name), x.name)} ${inp('ms-s' + i, x.scale, 'number', 'any')}</div>`).join('');
    const html = [
      row('Include: elements', chk('ms-el', ms.includeElements)),
      row('Include: added mass', chk('ms-add', ms.includeAddedMass)),
      row('Include: loads', chk('ms-ld', ms.loads.length > 0)),
      `<div id="ms-rows">${rows || '<span style="opacity:.6;font-size:12px">no load patterns</span>'}</div>`,
    ].join('');
    app.dialog('Define Mass Source', html, [
      ['Add Load Row', () => {
        const n = ms.loads.length;
        ms.loads.push({ name: (d.loadPatterns[0] || {}).name || '', scale: 1 });
        document.getElementById('ms-rows').insertAdjacentHTML('beforeend',
          `<div>${sel('ms-n' + n, d.loadPatterns.map(p => p.name), ms.loads[n].name)} ${inp('ms-s' + n, 1, 'number', 'any')}</div>`);
        return false;
      }],
      ['OK', () => {
        ms.includeElements = document.getElementById('ms-el').checked;
        ms.includeAddedMass = document.getElementById('ms-add').checked;
        const useLoads = document.getElementById('ms-ld').checked;
        for (let i = 0; i < ms.loads.length; i++) {
          ms.loads[i].name = txt('ms-n' + i, ms.loads[i].name);
          ms.loads[i].scale = num('ms-s' + i, 1);
        }
        if (!useLoads) ms.loads = [];
      }],
      ['Cancel', null],
    ]);
  }

  // ------------------------------------------------- auto seismic / wind
  function renderAutoSeismic(app) {
    const d = ensure(app);
    const a = d.autoSeismic;
    if (!a.dirs) a.dirs = { x: true }; // safety for callers bypassing ensure()
    const dirsHtml = [
      ['as-dx', 'x', 'X'], ['as-dy', 'y', 'Y'],
      ['as-dxe', 'xEcc', '+X (ecc)'], ['as-dye', 'yEcc', '+Y (ecc)'],
      ['as-dxm', 'xMinusEcc', '−X (ecc)'], ['as-dym', 'yMinusEcc', '−Y (ecc)'],
    ].map(([id, k, lab]) =>
      `<label style="margin-right:10px;font-size:12px">${chk(id, !!a.dirs[k])} ${lab}</label>`).join('');
    const html = `<div ${BODY_CSS}>` + [
      row('Code', sel('as-code', ['ASCE 7-16', 'ASCE 7-10', 'IBC 2006', 'User Coefficients'], a.code)),
      a.code === 'User Coefficients' ? [
        row('Coefficient C', inp('as-c', a.userC, 'number', 'any')),
        row('Period coefficient K', inp('as-k', a.userK, 'number', 'any')),
      ].join('') : [
        row('Ss / S1 (g)', inp('as-ss', a.ss, 'number', 'any') + ' ' + inp('as-s1', a.s1, 'number', 'any')),
        row('Site class', sel('as-sc', ['A', 'B', 'C', 'D', 'E', 'F'], a.siteClass)),
        row('Fa / Fv (0 = auto)', inp('as-fa', a.fa, 'number', 'any') + ' ' + inp('as-fv', a.fv, 'number', 'any')),
        row('TL (s)', inp('as-tl', a.tl, 'number', 'any')),
        row('R / Ω / Cd / Ie', inp('as-r', a.r, 'number', 'any') + ' ' + inp('as-om', a.omega, 'number', 'any') + ' ' + inp('as-cd', a.cd, 'number', 'any') + ' ' + inp('as-ie', a.ie, 'number', 'any')),
        secTitle('Seismic Weight Zone'),
        row('Top Z / Bottom Z (m)', inp('as-tz', a.topZ ?? '', 'number', 'any') + ' ' + inp('as-bz', a.bottomZ ?? '', 'number', 'any') + ' <span style="font-size:11px;opacity:.7">blank = full height</span>'),
      ],
      secTitle('Period Option'),
      row('T calculation', `<select id="as-pf" style="width:220px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">
        <option value="1"${a.periodFlag == 1 ? ' selected' : ''}>1 — Program calculated (Ct, x)</option>
        <option value="2"${a.periodFlag == 2 ? ' selected' : ''}>2 — User Ct-type</option>
        <option value="3"${a.periodFlag == 3 ? ' selected' : ''}>3 — User period T</option></select>`),
      String(a.periodFlag) === '2'
        ? row('Ct-type', `<select id="as-ct" style="width:220px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">
        <option value="0"${a.ctType == 0 ? ' selected' : ''}>0 — Ct=0.028 (ft), x=0.8</option>
        <option value="1"${a.ctType == 1 ? ' selected' : ''}>1 — Ct=0.016 (ft), x=0.9</option>
        <option value="2"${a.ctType == 2 ? ' selected' : ''}>2 — Ct=0.030 (ft), x=0.75</option>
        <option value="3"${a.ctType == 3 ? ' selected' : ''}>3 — Ct=0.020 (ft), x=0.75</option></select>`)
        : '',
      String(a.periodFlag) === '3' ? row('User T (s)', inp('as-ut', a.userT, 'number', 'any')) : '',
      secTitle('Direction & Eccentricity'),
      `<div style="margin:2px 0 4px">${dirsHtml}</div>`,
      row('Eccentricity ratio', inp('as-ecc', a.ecc ?? 0.05, 'number', 'any')),
      '<p style="font-size:11px;opacity:.7;margin:6px 0 0">Parameters seed the auto-seismic load (Cs = Sds/(R/Ie) with the ASCE caps; user: C·W/K). Story-force application runs in the analysis engine when patterns marked Auto Seismic are expanded.</p>',
    ].join('') + '</div>';
    app.dialog('Define Auto Seismic Loads — ' + a.code, html, [
      ['OK', () => {
        a.code = txt('as-code', a.code);
        a.ss = num('as-ss', a.ss); a.s1 = num('as-s1', a.s1); a.tl = num('as-tl', a.tl);
        a.r = num('as-r', a.r); a.omega = num('as-om', a.omega); a.cd = num('as-cd', a.cd);
        a.ie = num('as-ie', a.ie);
        a.siteClass = txt('as-sc', a.siteClass);
        a.fa = num('as-fa', a.fa); a.fv = num('as-fv', a.fv);
        a.userC = num('as-c', a.userC); a.userK = num('as-k', a.userK);
        a.dirs = {
          x: document.getElementById('as-dx').checked,
          y: document.getElementById('as-dy').checked,
          xEcc: document.getElementById('as-dxe').checked,
          yEcc: document.getElementById('as-dye').checked,
          xMinusEcc: document.getElementById('as-dxm').checked,
          yMinusEcc: document.getElementById('as-dym').checked,
        };
        a.ecc = num('as-ecc', a.ecc);
        a.periodFlag = parseInt(txt('as-pf', '1'), 10) || 1;
        const ctEl = document.getElementById('as-ct');
        if (ctEl) a.ctType = parseInt(ctEl.value, 10) || 0;
        const utEl = document.getElementById('as-ut');
        if (utEl) a.userT = num('as-ut', a.userT);
        a.topZ = txt('as-tz', '') === '' ? null : num('as-tz', a.topZ);
        a.bottomZ = txt('as-bz', '') === '' ? null : num('as-bz', a.bottomZ);
      }],
      ['Cancel', null],
    ]);
  }
  function renderAutoWind(app) {
    const d = ensure(app);
    const w = d.autoWind;
    const html = [
      row('Code', sel('aw-code', ['ASCE 7-16', 'ASCE 7-10', 'User Pressure'], w.code)),
      w.code === 'User Pressure' ? row('Pressure qw (kN/m²)', inp('aw-q', w.userQ, 'number', 'any')) : [
        row('Speed V (m/s)', inp('aw-v', w.speed, 'number', 'any')),
        row('Exposure', sel('aw-e', ['B', 'C', 'D'], w.exposure)),
        row('Kd / Kzt / gust', inp('aw-kd', w.kd, 'number', 'any') + ' ' + inp('aw-kzt', w.kzt, 'number', 'any') + ' ' + inp('aw-g', w.gust, 'number', 'any')),
      ],
      row('Direction', sel('aw-dir', ['X', 'Y', '±X', '±Y'], w.direction || 'X')),
    ].join('');
    app.dialog('Define Auto Wind Loads — ' + w.code, html, [
      ['OK', () => {
        w.code = txt('aw-code', w.code);
        w.speed = num('aw-v', w.speed); w.exposure = txt('aw-e', w.exposure);
        w.kd = num('aw-kd', w.kd); w.kzt = num('aw-kzt', w.kzt); w.gust = num('aw-g', w.gust);
        w.userQ = num('aw-q', w.userQ); w.direction = txt('aw-dir', w.direction);
      }],
      ['Cancel', null],
    ]);
  }

  // -------------------------------------------------- RS / TH functions
  function rsEditor(app, d, idx) {
    const isNew = idx < 0;
    const fn = isNew
      ? { name: uniqueName(d.rsFunctions, 'RS-Fn'), kind: 'asce', sds: 0.5, sd1: 0.25, tl: 8, damping: 0.05, scale: 9.81, points: [] }
      : JSON.parse(JSON.stringify(d.rsFunctions[idx]));
    fn.points = fn.points || [];
    const html = `<div ${BODY_CSS}>` + [
      row('Name', inp('rf-name', fn.name)),
      row('Function Type', sel('rf-kind', ['asce', 'user'], fn.kind)),
      fn.kind === 'asce' ? [
        row('SDS / SD1 (g)', inp('rf-sds', fn.sds, 'number', 'any') + ' ' + inp('rf-sd1', fn.sd1, 'number', 'any')),
        row('TL (s)', inp('rf-tl', fn.tl, 'number', 'any')),
      ].join('') : [
        secTitle('User Curve (T s, Sa g)'),
        rowsEditor('rfp', fn.points.map(p => [p.T, p.Sa]), 'T (s)', 'Sa (g)'),
      ],
      row('Damping ratio', inp('rf-damp', fn.damping, 'number', 'any')),
      row('Scale (g→m/s²)', inp('rf-scale', fn.scale, 'number', 'any')),
    ].join('') + '</div>';
    app.dialog((isNew ? 'Add ' : 'Edit ') + 'Response Spectrum Function', html, [
      ['OK', () => {
        const name = txt('rf-name', fn.name);
        if (!name) { app.toast('Name required', true); return false; }
        fn.name = name;
        fn.kind = txt('rf-kind', fn.kind);
        fn.sds = num('rf-sds', fn.sds); fn.sd1 = num('rf-sd1', fn.sd1); fn.tl = num('rf-tl', fn.tl);
        fn.damping = num('rf-damp', fn.damping); fn.scale = num('rf-scale', fn.scale);
        if (fn.kind === 'user') {
          fn.points = readRows(document.getElementById('dialog'), 'rfp')
            .map(p => ({ T: p[0], Sa: p[1] })).sort((a, b) => a.T - b.T);
        }
        if (isNew) d.rsFunctions.push(fn); else d.rsFunctions[idx] = fn;
        renderFunctions(app, 'rs');
      }],
      ['Cancel', null],
    ]);
    if (fn.kind === 'user') wireRows(app, 'rfp', fn.points);
  }
  function thEditor(app, d, idx) {
    const isNew = idx < 0;
    const fn = isNew
      ? { name: uniqueName(d.thFunctions, 'TH-Fn'), scale: 1, periodic: false, points: [] }
      : JSON.parse(JSON.stringify(d.thFunctions[idx]));
    fn.points = fn.points || [];
    const html = `<div ${BODY_CSS}>` + [
      row('Name', inp('tf-name', fn.name)),
      row('Scale factor', inp('tf-scale', fn.scale, 'number', 'any')),
      row('Periodic', chk('tf-per', fn.periodic)),
      secTitle('Points (time s, value)'),
      rowsEditor('tfp', fn.points.map(p => [p.t, p.v]), 't (s)', 'Value'),
    ].join('') + '</div>';
    app.dialog((isNew ? 'Add ' : 'Edit ') + 'Time History Function', html, [
      ['OK', () => {
        const name = txt('tf-name', fn.name);
        if (!name) { app.toast('Name required', true); return false; }
        fn.name = name;
        fn.scale = num('tf-scale', fn.scale);
        fn.periodic = document.getElementById('tf-per').checked;
        fn.points = readRows(document.getElementById('dialog'), 'tfp')
          .map(p => ({ t: p[0], v: p[1] })).sort((a, b) => a.t - b.t);
        if (isNew) d.thFunctions.push(fn); else d.thFunctions[idx] = fn;
        renderFunctions(app, 'th');
      }],
      ['Cancel', null],
    ]);
    wireRows(app, 'tfp', fn.points);
  }
  function renderFunctions(app, kind) {
    const d = ensure(app);
    const items = kind === 'rs' ? d.rsFunctions : d.thFunctions;
    const label = kind === 'rs' ? 'Response Spectrum' : 'Time History';
    listDialog(app, `Define ${label} Functions`, items, ['Name', 'Definition'],
      f => {
        const s = kind === 'rs'
          ? (f.kind === 'asce' ? `ASCE SDS=${f.sds} SD1=${f.sd1} β=${f.damping}` : `user curve, ${f.points.length} pts`)
          : `${f.points.length} pts ×${f.scale}${f.periodic ? ' · periodic' : ''}`;
        return `<td style="padding:4px 6px">${esc(f.name)}</td><td>${esc(s)}</td>`;
      },
      () => (kind === 'rs' ? rsEditor : thEditor)(app, d, -1),
      i => (kind === 'rs' ? rsEditor : thEditor)(app, d, i),
      i => { items.splice(i, 1); renderFunctions(app, kind); });
  }

  // ------------------------------------------------------- simple typed lists
  function renderDiaphragms(app) {
    const d = ensure(app);
    listDialog(app, 'Define Diaphragms', d.diaphragms, ['Name', 'Rigidity'],
      x => `<td style="padding:4px 6px">${esc(x.name)}</td><td>${x.semiRigid === false ? 'Rigid' : 'Semirigid'}</td>`,
      () => { d.diaphragms.push({ name: uniqueName(d.diaphragms, 'D1'), semiRigid: true }); renderDiaphragms(app); },
      i => {
        const x = d.diaphragms[i];
        app.dialog('Edit Diaphragm', [row('Name', inp('dg-name', x.name)),
          row('Semirigid', chk('dg-sr', x.semiRigid !== false))].join(''), [
          ['OK', () => { x.name = txt('dg-name', x.name); x.semiRigid = document.getElementById('dg-sr').checked; renderDiaphragms(app); }],
          ['Cancel', null],
        ]);
      },
      i => { d.diaphragms.splice(i, 1); renderDiaphragms(app); });
  }

  function renderConstraints(app) {
    const d = ensure(app);
    const CT = ['Body', 'Diaphragm', 'Rod', 'Weld', 'Equal', 'Line', 'Plate'];
    listDialog(app, 'Define Joint Constraints', d.constraints, ['Name', 'Type', 'Axis'],
      x => `<td style="padding:4px 6px">${esc(x.name)}</td><td>${esc(x.type || 'Body')}</td><td>${esc(x.axis || 'Z')}</td>`,
      () => { d.constraints.push({ name: uniqueName(d.constraints, 'CON'), type: 'Body', axis: 'Z' }); renderConstraints(app); },
      i => {
        const x = d.constraints[i];
        app.dialog('Edit Joint Constraint', [row('Name', inp('cn-name', x.name)),
          row('Type', sel('cn-type', CT, x.type)), row('Axis', sel('cn-axis', ['X', 'Y', 'Z'], x.axis || 'Z'))].join(''), [
          ['OK', () => { x.name = txt('cn-name', x.name); x.type = txt('cn-type', x.type); x.axis = txt('cn-axis', x.axis); renderConstraints(app); }],
          ['Cancel', null],
        ]);
      },
      i => { d.constraints.splice(i, 1); renderConstraints(app); });
  }

  function renderTendons(app) {
    const d = ensure(app);
    listDialog(app, 'Define Tendon Properties', d.tendonProps,
      ['Name', 'Area (mm²)', 'µ', 'Wobble k', 'Jacking (MPa)', 'Type'],
      x => `<td style="padding:4px 6px">${esc(x.name)}</td><td>${x.area}</td><td>${x.mu}</td><td>${x.wobble}</td><td>${x.jacking}</td><td>${esc(x.type)}</td>`,
      () => { d.tendonProps.push({ name: uniqueName(d.tendonProps, 'TEND'), area: 140, mu: 0.25, wobble: 0.001, jacking: 1300, type: 'grouted' }); renderTendons(app); },
      i => {
        const x = d.tendonProps[i];
        app.dialog('Edit Tendon Property', [
          row('Name', inp('tn-name', x.name)),
          row('Area (mm²)', inp('tn-area', x.area, 'number', 'any')),
          row('Friction µ', inp('tn-mu', x.mu, 'number', 'any')),
          row('Wobble k (1/m)', inp('tn-wob', x.wobble, 'number', 'any')),
          row('Jacking stress (MPa)', inp('tn-jack', x.jacking, 'number', 'any')),
          row('Type', sel('tn-type', ['grouted', 'unbonded'], x.type)),
        ].join(''), [
          ['OK', () => {
            x.name = txt('tn-name', x.name); x.area = num('tn-area', x.area);
            x.mu = num('tn-mu', x.mu); x.wobble = num('tn-wob', x.wobble);
            x.jacking = num('tn-jack', x.jacking); x.type = txt('tn-type', x.type);
            renderTendons(app);
          }],
          ['Cancel', null],
        ]);
      },
      i => { d.tendonProps.splice(i, 1); renderTendons(app); });
  }

  function renderLinks(app) {
    const d = ensure(app);
    listDialog(app, 'Define Link Properties', d.linkProps,
      ['Name', 'Type', 'Effective Stiffness (kN/m or kN·m/rad)'],
      x => `<td style="padding:4px 6px">${esc(x.name)}</td><td>${esc(x.type || 'linear')}</td><td>${esc(x.stiffness || '—')}</td>`,
      () => { d.linkProps.push({ name: uniqueName(d.linkProps, 'LINK'), type: 'linear', stiffness: '' }); renderLinks(app); },
      i => {
        const x = d.linkProps[i];
        app.dialog('Edit Link Property', [
          row('Name', inp('lk-name', x.name)),
          row('Type', sel('lk-type', ['linear', 'damper', 'gap', 'hook', 'isolator'], x.type || 'linear')),
          row('Stiffness (k1 or effective)', inp('lk-st', x.stiffness || '', 'text')),
        ].join(''), [
          ['OK', () => { x.name = txt('lk-name', x.name); x.type = txt('lk-type', x.type); x.stiffness = txt('lk-st', x.stiffness); renderLinks(app); }],
          ['Cancel', null],
        ]);
      },
      i => { d.linkProps.splice(i, 1); renderLinks(app); });
  }

  function renderNameList(app, key, title, base) {
    const d = ensure(app);
    const items = d[key].map(n => ({ name: n }));
    listDialog(app, 'Define ' + title, items, ['Name'],
      x => '<td style="padding:4px 6px">' + esc(x.name) + '</td>',
      () => { d[key].push(uniqueName(d[key], base)); renderNameList(app, key, title, base); },
      null,
      i => { d[key].splice(i, 1); renderNameList(app, key, title, base); });
  }

  // ==========================================================================
  // ASSIGN — ETABS semantics (from the published API + observed behavior):
  // assignment targets the current selection; a section's design type
  // (beam / column / wall / slab) must match the element — mismatched
  // elements are SKIPPED with a partial-assignment warning, never an error;
  // "None/auto" clears the explicit assignment back to the bridge.
  // ==========================================================================

  function selectedStructuralEnts(app, kinds) {
    const out = [];
    const seen = new Set();
    for (const fid of (app.sel && app.sel.faces) || []) {
      const f = app.model.faces.get(fid);
      const uid = f && f.userData && f.userData.bimEntityId;
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      const ent = app.bim.getEntityById(uid);
      if (ent && (!kinds || kinds.includes(ent.type))) out.push(ent);
    }
    return out;
  }

  // is a section assignmentable to this element type?
  function assignCompatible(sec, ent, isFrame) {
    if (isFrame) {
      if (!['beam', 'column'].includes(ent.type)) return false;
      return (sec.designType || 'beam') === ent.type; // beam→beam, column→column
    }
    if (sec.type === 'wall') return ent.type === 'wall';
    return ['slab', 'roof'].includes(ent.type);      // slab/deck sections
  }

  // name = section name, or 'auto' to reset the selection to the bridge
  function assignSections(app, ents, name) {
    const d = ensure(app);
    const sec = name === 'auto' ? null : (byName(d.frameSections, name) || byName(d.areaSections, name));
    if (name !== 'auto' && !sec) return { assigned: 0, skipped: ents.length, badName: true };
    const isFrame = name !== 'auto' && !!byName(d.frameSections, name);
    let assigned = 0, skipped = 0;
    for (const ent of ents) {
      if (name === 'auto') {
        ent.params.designSectionManual = false;
        ent.params.designSection = null;
        if (ensureAutoSection(app, ent)) assigned++; else skipped++;
        continue;
      }
      if (!assignCompatible(sec, ent, isFrame)) { skipped++; continue; }
      ent.params.designSection = name;
      ent.params.designSectionManual = true;
      assigned++;
    }
    return { assigned, skipped };
  }

  function renderAssign(app, kind) {
    const d = ensure(app);
    const isFrame = kind === 'assignFrames';
    const kinds = isFrame ? ['beam', 'column'] : ['wall', 'slab', 'roof'];
    const ents = selectedStructuralEnts(app, kinds);
    if (!ents.length) {
      app.toast(`Select ${isFrame ? 'beam/column' : 'wall/slab/roof'} elements first, then Assign`, true);
      return;
    }
    const list = isFrame ? d.frameSections : d.areaSections;
    const optHtml = list.map(s => {
      const dm = s.dims || {};
      const dim = s.type === 'circle' || s.type === 'pipe'
        ? `⌀${((dm.dia ?? 0) * 1000).toFixed(0)}`
        : `${((dm.b ?? dm.bf ?? 0) * 1000).toFixed(0)}×${((dm.h ?? dm.dia ?? 0) * 1000).toFixed(0)}`;
      return `<option value="${esc(s.name)}">${esc(s.name)} — ${dim}${isFrame ? ' · ' + esc(s.designType || '') : ' · ' + esc(s.type)}</option>`;
    }).join('');
    const html = [
      `<p style="margin:0 0 6px;font-size:12px;opacity:.8">${ents.length} element(s) selected` +
      ` — type-mismatched elements will be skipped (ETABS partial-assignment rule).</p>`,
      row(isFrame ? 'Frame Section' : 'Area Section', `<select id="ag-sec" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${optHtml || '<option value="">(none defined)</option>'}</select>`),
      `<p style="font-size:11px;opacity:.7;margin:6px 0 0">Manual assignment overrides the dimension-based auto section until Reset to Auto.</p>`,
    ].join('');
    const apply = reset => {
      const name = reset ? 'auto' : document.getElementById('ag-sec').value;
      const r = assignSections(app, ents, name);
      if (r.assigned) app.toast(`${name === 'auto' ? 'Auto' : name} assigned to ${r.assigned} element(s)`
        + (r.skipped ? ` — ${r.skipped} skipped (type mismatch)` : ''));
      else app.toast(r.badName ? 'Section no longer exists' : 'No compatible elements in selection', true);
      if (r.assigned) app.closeDialog();
    };
    app.dialog('Assign ' + (isFrame ? 'Frame Sections' : 'Area Sections'), html, [
      ['Assign', () => { apply(false); return false; }],
      ['Reset to Auto', () => { apply(true); return false; }],
      ['Close', null],
    ]);
  }

  // ------- generic property assignment (Assign ▸ … for loads/joints/etc.)
  // Same ETABS contract as section assignment: targets the selection,
  // validates compatibility, skips the rest with a count.
  function renderAssignPick(app, cfg) {
    const ents = selectedStructuralEnts(app, cfg.kinds);
    if (!ents.length) { app.toast('Select ' + cfg.pickHint + ' first', true); return; }
    const opts = (typeof cfg.options === 'function' ? cfg.options() : cfg.options)
      .map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    const html = [
      `<p style="margin:0 0 6px;font-size:12px;opacity:.8">${ents.length} element(s) selected.</p>`,
      row(cfg.label, `<select id="ag-val" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${opts}</select>`),
      cfg.note ? `<p style="font-size:11px;opacity:.7;margin:6px 0 0">${cfg.note}</p>` : '',
    ].join('');
    const apply = clear => {
      const val = clear ? null : document.getElementById('ag-val').value;
      let assigned = 0, skipped = 0;
      for (const ent of ents) {
        if (cfg.filter && !cfg.filter(ent, val)) { skipped++; continue; }
        if (cfg.apply) { cfg.apply(ent, val, !!clear); assigned++; continue; }
        if (val == null) delete ent.params[cfg.param];
        else ent.params[cfg.param] = val;
        assigned++;
      }
      if (assigned) {
        app.toast(`${cfg.donePrefix || cfg.label}: ${assigned} element(s) updated`
          + (skipped ? ` — ${skipped} skipped` : ''));
        app.closeDialog();
      } else app.toast('No compatible elements in selection', true);
    };
    const buttons = [['Assign', () => { apply(false); return false; }]];
    if (cfg.allowClear) buttons.push([cfg.clearLabel || 'Clear', () => { apply(true); return false; }]);
    buttons.push(['Close', null]);
    app.dialog(cfg.title, html, buttons);
  }

  // slab design strips (Define ▸ Design Strips)
  function stripEditor(app, d, idx) {
    const isNew = idx < 0;
    const st = isNew ? { name: uniqueName(d.designStrips, 'STRIP'), width: 1.0, direction: 'X' }
      : JSON.parse(JSON.stringify(d.designStrips[idx]));
    const html = [
      row('Name', inp('st-name', st.name)),
      row('Strip width (m)', inp('st-w', st.width, 'number', 'any')),
      row('Direction', sel('st-dir', ['X', 'Y'], st.direction)),
    ].join('');
    app.dialog((isNew ? 'Add ' : 'Edit ') + 'Design Strip', html, [
      ['OK', () => {
        const name = txt('st-name', st.name);
        if (!name) { app.toast('Name required', true); return false; }
        st.name = name; st.width = num('st-w', st.width); st.direction = txt('st-dir', st.direction);
        if (isNew) d.designStrips.push(st); else d.designStrips[idx] = st;
        renderStrips(app);
      }],
      ['Cancel', null],
    ]);
  }
  function renderStrips(app) {
    const d = ensure(app);
    listDialog(app, 'Define Design Strips', d.designStrips, ['Name', 'Width', 'Direction'],
      st => '<td style="padding:4px 6px">' + esc(st.name) + '</td><td>' + st.width + ' m</td><td>' + esc(st.direction) + '</td>',
      () => stripEditor(app, d, -1), i => stripEditor(app, d, i),
      i => { d.designStrips.splice(i, 1); renderStrips(app); });
  }

  // beam end releases (ETABS Assign ▸ Frame ▸ Releases, simplified to the
  // RC-relevant major-axis moment + torsion release per end)
  function renderAssignReleases(app) {
    const ents = selectedStructuralEnts(app, ['beam']);
    if (!ents.length) { app.toast('Select beam elements first', true); return; }
    const opts = [['fixed', 'Fixed'], ['pinM3', 'Pinned — release M3 (major moment)'], ['free', 'Free']];
    const endSel = (id, cur) => `<select id="${id}" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">` +
      opts.map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('') + '</select>';
    const cur = ents[0].params.releases || { i: 'fixed', j: 'fixed' };
    const html = [
      `<p style="margin:0 0 6px;font-size:12px;opacity:.8">${ents.length} beam(s) selected — applied to all.</p>`,
      row('I-End (start)', endSel('rl-i', cur.i)),
      row('J-End (end)', endSel('rl-j', cur.j)),
      '<p style="font-size:11px;opacity:.7;margin:6px 0 0">Released ends carry no major-axis moment — the analysis treats them as pins.</p>',
    ].join('');
    app.dialog('Assign Frame Releases', html, [
      ['Assign', () => {
        const rel = { i: txt('rl-i', 'fixed'), j: txt('rl-j', 'fixed') };
        let n = 0;
        for (const ent of ents) {
          const bothFixed = rel.i === 'fixed' && rel.j === 'fixed';
          if (bothFixed) delete ent.params.releases;
          else ent.params.releases = rel;
          n++;
        }
        app.toast(`Releases assigned to ${n} beam(s)`);
        app.closeDialog();
      }],
      ['Cancel', null],
    ]);
  }

  // ------------------------------------------------------- load assignment
  // ETABS Assign ▸ Frame Loads / Shell Loads: magnitudes attach to elements
  // per load pattern (multiple loads accumulate; removal is per pattern).
  // Self-weight is NOT here — a DEAD pattern with self-weight multiplier 1.0
  // generates it from the section + unit weight at analysis time.
  function loadPatternOptions(app) {
    const d = ensure(app);
    return d.loadPatterns.map(p => ({ value: p.name, label: `${p.name} (${p.type})` }));
  }

  function renderAssignFrameLoads(app) {
    const ents = selectedStructuralEnts(app, ['beam', 'column']);
    if (!ents.length) { app.toast('Select beam/column elements first', true); return; }
    const dirOpts = [['gravity', 'Gravity (−Z, global)'], ['up', '+Z (up)'], ['gx', 'Global +X'], ['gy', 'Global +Y']];
    const html = [
      `<p style="margin:0 0 6px;font-size:12px;opacity:.8">${ents.length} element(s) selected — loads accumulate; assign again to add more.</p>`,
      row('Load Pattern', `<select id="fl-pat" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${
        loadPatternOptions(app).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`),
      row('Load Type', `<select id="fl-type" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">
        <option value="dist">Uniform — kN/m over full length</option>
        <option value="point">Point — kN at distance a</option></select>`),
      row('w or P (kN/m, kN)', inp('fl-val', 10, 'number', 'any')),
      row('a from start (m)', inp('fl-a', 0, 'number', 'any')),
      row('Direction', `<select id="fl-dir" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${
        dirOpts.map(([v, l]) => `<option value="${v}"${v === 'gravity' ? ' selected' : ''}>${l}</option>`).join('')}</select>`),
      '<p style="font-size:11px;opacity:.7;margin:6px 0 0">Beam self-weight comes from the DEAD pattern self-weight multiplier, not from this dialog.</p>',
    ].join('');
    app.dialog('Assign Frame Loads', html, [
      ['Add Load', () => {
        const pat = txt('fl-pat', '');
        const type = txt('fl-type', 'dist');
        const val = num('fl-val', 0);
        const dir = txt('fl-dir', 'gravity');
        if (!pat || val <= 0) { app.toast('Pattern and a positive magnitude are required', true); return false; }
        let n = 0;
        for (const ent of ents) {
          const L = ent.params.frameLoads || (ent.params.frameLoads = []);
          L.push(type === 'dist'
            ? { pattern: pat, type: 'dist', w: val, dir }
            : { pattern: pat, type: 'point', P: val, a: num('fl-a', 0), dir });
          n++;
        }
        app.toast(`${type === 'dist' ? 'Uniform' : 'Point'} load (${pat}) added to ${n} element(s)`);
      }],
      ['Remove Pattern Loads', () => {
        const pat = txt('fl-pat', '');
        let n = 0;
        for (const ent of ents) {
          const before = (ent.params.frameLoads || []).length;
          ent.params.frameLoads = (ent.params.frameLoads || []).filter(L => L.pattern !== pat);
          if (!ent.params.frameLoads.length) delete ent.params.frameLoads;
          if (before !== (ent.params.frameLoads || []).length) n++;
        }
        app.toast(`Pattern "${pat}" loads removed from ${n} element(s)`);
      }],
      ['Close', null],
    ]);
  }

  function renderAssignSurfaceLoads(app) {
    const ents = selectedStructuralEnts(app, ['slab', 'roof', 'wall']);
    if (!ents.length) { app.toast('Select slab/roof/wall elements first', true); return; }
    const html = [
      `<p style="margin:0 0 6px;font-size:12px;opacity:.8">${ents.length} element(s) selected.</p>`,
      row('Load Pattern', `<select id="sl-pat" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${
        loadPatternOptions(app).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`),
      row('Pressure (kN/m²)', inp('sl-p', 5, 'number', 'any')),
      row('Direction', `<select id="sl-dir" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">
        <option value="down" selected>Down (−Z, global)</option><option value="up">Up (+Z)</option></select>`),
      '<p style="font-size:11px;opacity:.7;margin:6px 0 0">Slab self-weight comes from the section thickness + unit weight via the pattern multiplier.</p>',
    ].join('');
    app.dialog('Assign Surface Loads', html, [
      ['Add Load', () => {
        const pat = txt('sl-pat', '');
        const p = num('sl-p', 0);
        if (!pat || p <= 0) { app.toast('Pattern and a positive pressure are required', true); return false; }
        const dir = txt('sl-dir', 'down');
        let n = 0;
        for (const ent of ents) {
          (ent.params.surfaceLoads = ent.params.surfaceLoads || []).push({ pattern: pat, pressure: p, dir });
          n++;
        }
        app.toast(`Surface load (${pat}) added to ${n} element(s)`);
      }],
      ['Remove Pattern Loads', () => {
        const pat = txt('sl-pat', '');
        let n = 0;
        for (const ent of ents) {
          const before = (ent.params.surfaceLoads || []).length;
          ent.params.surfaceLoads = (ent.params.surfaceLoads || []).filter(L => L.pattern !== pat);
          if (!ent.params.surfaceLoads.length) delete ent.params.surfaceLoads;
          if (before !== (ent.params.surfaceLoads || []).length) n++;
        }
        app.toast(`Pattern "${pat}" loads removed from ${n} element(s)`);
      }],
      ['Close', null],
    ]);
  }

  // --------------------------------------------------------------- dispatch
  const DIALOGS = {
    materials: renderMaterials,
    rebar: renderRebarDb,
    frames: renderFrameSections,
    areas: renderAreaSections,
    solid: renderSolidSections,
    cable: renderCableSections,
    springsPoint: app => springDialogs(app, 'point'),
    springsLine: app => springDialogs(app, 'line'),
    springsArea: app => springDialogs(app, 'area'),
    links: renderLinks,
    tendons: renderTendons,
    patterns: renderLoadPatterns,
    cases: renderLoadCases,
    combos: renderCombos,
    mass: renderMassSource,
    seismic: renderAutoSeismic,
    wind: renderAutoWind,
    rs: app => renderFunctions(app, 'rs'),
    th: app => renderFunctions(app, 'th'),
    diaphragms: renderDiaphragms,
    strips: renderStrips,
    piers: app => renderNameList(app, 'piers', 'Pier Labels', 'P'),
    spandrels: app => renderNameList(app, 'spandrels', 'Spandrel Labels', 'S'),
    constraints: renderConstraints,
  };

  function open(app, cat) {
    if (cat === 'grids') { app.gridsDialog(); return; }
    if (cat === 'sync') {
      const r = syncModelToDefine(app);
      app.toast(`Model → Define: ${r.linked} element(s) linked, ${r.created} new section(s) created`
        + (r.missing ? `, ${r.missing} skipped (no dimensions)` : ''));
      return;
    }
    if (cat === 'assignFrames' || cat === 'assignAreas') { renderAssign(app, cat); return; }
    if (cat === 'assignFrameLoads') { renderAssignFrameLoads(app); return; }
    if (cat === 'assignSurfaceLoads') { renderAssignSurfaceLoads(app); return; }
    // Assign ▸ everything else (loads/joints-family assignments)
    const ASSIGN_PICKS = {
      assignPiers: {
        title: 'Assign Wall Piers', label: 'Pier Label', param: 'pierLabel', kinds: ['wall'],
        pickHint: 'wall elements', donePrefix: 'Pier label', allowClear: true, clearLabel: 'Remove Label',
        options: () => ensure(app).piers.map(p => ({ value: p, label: p })),
      },
      assignSpandrels: {
        title: 'Assign Spandrels', label: 'Spandrel Label', param: 'spandrelLabel', kinds: ['beam'],
        pickHint: 'beam elements', donePrefix: 'Spandrel label', allowClear: true, clearLabel: 'Remove Label',
        options: () => ensure(app).spandrels.map(s => ({ value: s, label: s })),
      },
      assignDiaphragms: {
        title: 'Assign Diaphragms', label: 'Diaphragm', param: 'diaphragm', kinds: ['slab', 'roof'],
        pickHint: 'slab/roof elements', donePrefix: 'Diaphragm', allowClear: true, clearLabel: 'Remove',
        options: () => ensure(app).diaphragms.map(x => ({ value: x.name, label: x.name + (x.semiRigid === false ? ' (rigid)' : ' (semirigid)') })),
        note: 'A semirigid diaphragm distributes forces by actual floor stiffness; rigid ties all points in-plane.',
      },
      assignMaterials: {
        title: 'Assign Material Overwrite', label: 'Material', param: 'materialOverwrite',
        kinds: STRUCTURAL_TYPES,
        pickHint: 'structural elements', donePrefix: 'Material overwrite', allowClear: true, clearLabel: 'Clear Overwrite',
        options: () => ensure(app).materials.filter(m => ['concrete', 'steel'].includes(m.type)).map(m => ({ value: m.name, label: m.name })),
        note: 'Overrides the section material for this element only (design + analysis).',
      },
      assignBase: {
        title: 'Assign Column Base Fixity', label: 'Base Fixity', param: 'baseFixity', kinds: ['column'],
        pickHint: 'column elements', donePrefix: 'Base fixity', allowClear: true, clearLabel: 'Program Default',
        options: () => [{ value: 'fixed', label: 'Fixed' }, { value: 'pinned', label: 'Pinned' }],
        note: 'Applied where the column reaches its lowest level (foundation); otherwise ignored.',
      },
      assignProc: {
        title: 'Assign Design Procedure', label: 'Design Procedure', param: 'designProcedure',
        kinds: ['wall', 'slab', 'roof', 'beam', 'column'],
        pickHint: 'structural elements', donePrefix: 'Design procedure', allowClear: true, clearLabel: 'Program Determined',
        options: () => [
          { value: 'concrete', label: 'Concrete Frame Design (ACI 318-19)' },
          { value: 'nodesign', label: 'No Design' },
        ],
      },
    };
    if (ASSIGN_PICKS[cat]) { renderAssignPick(app, ASSIGN_PICKS[cat]); return; }
    if (cat === 'assignReleases') { renderAssignReleases(app); return; }
    if (cat === 'assignStrips') {
      renderAssignPick(app, {
        title: 'Assign Design Strips', label: 'Design Strip', param: 'stripLabels',
        kinds: ['slab', 'roof'], pickHint: 'slab/roof elements', donePrefix: 'Design strip',
        allowClear: true, clearLabel: 'Remove Strip',
        options: () => ensure(app).designStrips.map(s => ({ value: s.name, label: `${s.name} — ${s.width} m · ${s.direction}` })),
        note: 'A slab can carry several strips; each Assign adds one. Clear removes the selected strip.',
        apply: (ent, val, clear) => {
          if (clear) ent.params.stripLabels = (ent.params.stripLabels || []).filter(x => x !== val);
          else if (!(ent.params.stripLabels || []).includes(val)) (ent.params.stripLabels = ent.params.stripLabels || []).push(val);
        },
      });
      return;
    }
    if (cat === 'assignAuto') {
      const ents = selectedStructuralEnts(app);
      if (!ents.length) { app.toast('Select elements first, then Reset to Auto', true); return; }
      const r = assignSections(app, ents, 'auto');
      app.toast(`Reset to auto: ${r.assigned} element(s) relinked by dimensions`
        + (r.skipped ? `, ${r.skipped} skipped (no dimensions)` : ''));
      return;
    }
    const fn = DIALOGS[cat];
    if (fn) ensure(app), fn(app);
  }

  // ==========================================================================
  // MODEL ⇄ DEFINE BRIDGE — drawn elements auto-map to Define sections.
  // Each structural entity carries params.designSection (a reference into
  // the registries, never a copy), so the design engine can walk
  // element → section → demands, and a Define edit updates every linked
  // element at once.
  // ==========================================================================

  const STRUCTURAL_TYPES = ['wall', 'slab', 'roof', 'beam', 'column'];

  // classifying signature of a drawn element: { registry, designType, dims, base }
  // dims are MILLIMETRES (display) — sections store metres internally
  function structuralInfo(ent) {
    if (!ent || !STRUCTURAL_TYPES.includes(ent.type)) return null;
    const p = ent.params || {};
    const mm = v => Math.round((+v || 0) * 1000);
    if (ent.type === 'beam') {
      const w = mm(p.webWidth ?? p.width), h = mm(p.height);
      if (!w || !h) return null;
      const isT = p.profile === 't' || p.profile === 'T';
      return { registry: 'frameSections', designType: 'beam',
        dims: isT ? { h: h / 1000, bf: (mm(p.flangeWidth) || w * 3) / 1000, tf: (mm(p.flangeThickness) || h / 5 / 1000), tw: w / 1000 }
                  : { b: w / 1000, h: h / 1000 },
        type: isT ? 'concTee' : 'rect',
        base: (isT ? 'BT' : 'B') + w + '×' + h, label: (isT ? 'BT' : 'B') + w + '×' + h };
    }
    if (ent.type === 'column') {
      const w = mm(p.width), dep = mm(p.depth || p.width);
      if (!w || !dep) return null;
      return { registry: 'frameSections', designType: 'column', dims: { b: dep / 1000, h: w / 1000 },
        type: 'rect', base: 'C' + w + '×' + dep, label: 'C' + w + '×' + dep };
    }
    if (ent.type === 'wall') {
      const t = mm(p.thickness);
      if (!t) return null;
      return { registry: 'areaSections', designType: 'wall', dims: { thickness: t / 1000 },
        type: 'wall', base: 'W' + t, label: 'W' + t };
    }
    // slab / roof → area section, type 'slab' (ETABS models roofs as slabs)
    const t = mm(p.thickness);
    if (!t) return null;
    const roof = ent.type === 'roof';
    return { registry: 'areaSections', designType: 'slab', dims: { thickness: t / 1000 },
      type: 'slab', base: (roof ? 'R' : 'S') + t, label: (roof ? 'R' : 'S') + t };
  }

  // true when a registry entry matches the element's dims + type exactly
  function sectionMatches(s, info) {
    if (s.type !== info.type) return false;
    if (s.autoBase !== info.base) return false;
    if (info.registry === 'frameSections') {
      const dd = s.dims || {};
      const a = frameSectionProps(s), b = frameSectionProps({ type: s.type, dims: info.dims });
      return Math.abs(dd.h - info.dims.h) < 1e-6 && Math.abs(a.I33 - b.I33) < 1e-9
        && Math.abs(a.A - b.A) < 1e-9;
    }
    return Math.abs((s.thickness || 0) - info.dims.thickness) < 1e-6;
  }

  function defaultConcrete(d) {
    return (byName(d.materials, 'CONC25') || d.materials.find(m => m.type === 'concrete') || {}).name || 'CONC25';
  }

  // find-or-create the auto section for a drawn element; returns the
  // section name and stamps ent.params.designSection.
  // A MANUAL assignment (designSectionManual) wins — like ETABS's design
  // section overwrite, it stays until Reset to Auto.
  function ensureAutoSection(app, ent) {
    if (ent.params.designSectionManual && ent.params.designSection) return ent.params.designSection;
    const info = structuralInfo(ent);
    if (!info) return null;
    const d = ensure(app);
    const list = d[info.registry];
    // 1) already linked & still valid → keep the user's assignment
    const linked = ent.params.designSection && byName(list, ent.params.designSection);
    if (linked && sectionMatches(linked, info)) return linked.name;
    // 2) an existing auto section with identical geometry → reuse it
    const existing = list.find(s => s.autoBase && sectionMatches(s, info));
    if (existing) { ent.params.designSection = existing.name; return existing.name; }
    // 3) create one with readable dims-based name and ETABS-ish defaults
    const s = info.registry === 'frameSections'
      ? { name: uniqueName(list, info.base), type: info.type, designType: info.designType,
          material: defaultConcrete(d), dims: info.dims,
          modifiers: { a: 1, as2: 1, as3: 1, torsion: 1, i22: 1, i33: 1, mass: 1, weight: 1 },
          autoBase: info.base, autoList: [], autoStart: '',
          rebar: JSON.parse(JSON.stringify(d.frameSections[0].rebar)) }
      : { name: uniqueName(list, info.base), type: info.type, material: defaultConcrete(d),
          thickness: info.dims.thickness, ribs: null, autoBase: info.base };
    list.push(s);
    ent.params.designSection = s.name;
    return s.name;
  }

  // after a parametric edit (resize): if the old section is used ONLY by
  // this element, update it in place (rename follows the new dims);
  // otherwise leave the shared section alone and link a matching/new one
  function relinkAfterEdit(app, ent) {
    if (ent.params.designSectionManual && ent.params.designSection) return ent.params.designSection;
    const info = structuralInfo(ent);
    if (!info) return null;
    const d = ensure(app);
    const list = d[info.registry];
    const old = ent.params.designSection && byName(list, ent.params.designSection);
    const others = sectionUsage(app, ent.params.designSection, ent.id);
    if (old && old.autoBase && others === 0) {
      // sole user — mutate the section and refresh its dims-based name
      old.autoBase = info.base;
      if (info.registry === 'frameSections') { old.type = info.type; old.dims = info.dims; }
      else old.thickness = info.dims.thickness;
      old.name = uniqueName(list, info.base);
      ent.params.designSection = old.name;
      return old.name;
    }
    ent.params.designSection = null; // force find-or-create below
    return ensureAutoSection(app, ent);
  }

  // how many drawn elements reference a section (excluding optionally one id)
  function sectionUsage(app, name, excludeId) {
    if (!name || !app || !app.bim) return 0;
    return app.bim.entities.filter(e =>
      e.id !== excludeId && (e.params || {}).designSection === name).length;
  }

  // backfill: catalogue every drawn structural element into Define
  function syncModelToDefine(app) {
    const d = ensure(app);
    const before = { f: d.frameSections.length, a: d.areaSections.length };
    let linked = 0, missing = 0;
    for (const ent of app.bim.entities) {
      if (!STRUCTURAL_TYPES.includes(ent.type)) continue;
      const name = ensureAutoSection(app, ent);
      if (name) linked++; else missing++;
    }
    const created = (d.frameSections.length - before.f) + (d.areaSections.length - before.a);
    return { linked, missing, created };
  }

  root.RCDefine = {
    ensure, open, matE, matG, concreteEc, frameSectionProps, defaultState,
    MAT_LABEL, FRAME_LABEL, asceSa, rsValue,
    // bridge
    structuralInfo, ensureAutoSection, relinkAfterEdit, sectionUsage,
    syncModelToDefine, STRUCTURAL_TYPES,
    // assign
    assignSections, selectedStructuralEnts,
  };
})(window);
