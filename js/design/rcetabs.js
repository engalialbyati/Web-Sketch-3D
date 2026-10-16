// rcetabs.js — DEV-ONLY validation export: serialize the RC model into an
// ETABS OAPI build script (Python + comtypes), run it against the installed
// ETABS, and diff ETABS's member forces / design results against this
// engine's output. Not part of the production build.
// Signatures verified against the ETABS 23 typelib
// {542F7A9D-3A7D-4061-97B3-3A1276FF83BD} and probed live: COM out-params
// return in order with the function's int return LAST.
(function (root) {
  'use strict';

  const kN = v => +(v / 1e3);           // N → kN
  const kNm = v => +(v / 1e6);          // N·mm → kN·m

  function serializeModel(app) {
    const d = root.RCDefine.ensure(app);
    const out = { materials: {}, sections: [], members: [], patterns: [], combos: [] };
    for (const m of d.materials) {
      if (m.type === 'concrete') out.materials[m.name] = { type: 'concrete', fc: m.conc.fc };
      else if (m.type === 'rebar') out.materials[m.name] = {
        type: 'rebar', fy: m.rebar.fy, fu: m.rebar.fu,
        // ETABS OAPI SetORebar_1: Fy, Fu, EFy(expected yield), EFu(expected
        // tensile) are STRESSES — never pass the eFy/eFu strains here
        fye: m.rebar.fye > 0 ? m.rebar.fye : m.rebar.fy,
        fue: m.rebar.fue > 0 ? m.rebar.fue : m.rebar.fu,
      };
    }
    for (const s of d.frameSections) {
      if (s.type !== 'rect') continue;
      out.sections.push({ name: s.name, mat: s.material, b: s.dims.b || 0.3, h: s.dims.h || 0.5, dt: s.designType || 'beam' });
    }
    for (const e of app.bim.entities) {
      if (e.type === 'beam' && Array.isArray(e.params.baseline)) {
        const bl = e.params.baseline;
        const sec = d.frameSections.find(s => s.name === e.params.designSection);
        // SNAP for ETABS parity: draw the member joint-to-joint (column
        // base/top nodes) and carry the drawn offset as insertion offsets —
        // otherwise ETABS would see two disconnected joints, same as the
        // pre-fix analyzer
        const cols = app.bim.entities.filter(x => x.type === 'column' && Array.isArray(x.params.base));
        const snap = (pt) => {
          let best = null, bd = 0.5;
          for (const c of cols) {
            const cb = c.params.base, hgt = +c.params.height || 3;
            for (const cz of [cb[2], cb[2] + hgt]) {
              if (Math.abs(cz - pt[2]) > 1e-4) continue;
              const dd = Math.hypot(cb[0] - pt[0], cb[1] - pt[1]);
              if (dd <= bd) { bd = dd; best = [cb[0], cb[1], cz]; }
            }
          }
          return best || pt;
        };
        const sa = snap(bl[0]), sb = snap(bl[bl.length - 1]);
        // LOCAL AXES: ETABS local 1 follows the exported a→b order, which is
        // exactly the app engine's element direction (baseline[0]→end), and
        // ETABS's angle-0 default keeps local 2 vertical-up — the app's
        // strong axis for gravity members. ax=0 always holds today; if the
        // app ever grows a member roll, this is where it is carried.
        out.members.push({ kind: 'beam', name: e.id, sec: sec ? sec.name : null,
          a: sa, b: sb, ax: 0,
          loads: (e.params.frameLoads || []).map(L => ({ pat: L.pattern, type: L.type, w: L.w || 0, P: L.P || 0, a: L.a || 0 })) });
      } else if (e.type === 'column' && Array.isArray(e.params.base)) {
        const p = e.params;
        const sec = d.frameSections.find(s => s.name === p.designSection);
        out.members.push({ kind: 'column', name: e.id, sec: sec ? sec.name : null,
          a: p.base, b: [p.base[0], p.base[1], p.base[2] + (+p.height || 3)], ax: 0, loads: [] });
      }
    }
    // insertion points: cardinal row (0=Bottom,1=Center,2=Top) and column
    // (0=Left,1=Center,2=Right) from the placement params the rebuilds use;
    // ETABS SetInsertionPoint(Name, CP, Mirror2, Stiff, Off1, Off2, CSys)
    out.insertions = {};
    for (const e of app.bim.entities) {
      if (e.type !== 'beam' || !Array.isArray(e.params.baseline)) continue;
      const j = e.params.zJustification || 'Top';
      const ll = e.params.locationLine || 'center';
      const lat = +e.params.offsetLateral || 0;
      const row = j === 'Bottom' ? 0 : j === 'Center' ? 1 : 2;
      const col = (ll === 'left' || lat < 0) ? 0 : (ll === 'right' || lat > 0) ? 2 : 1;
      // drawn-offset snap → ETABS local 2-axis offset (transverse horizontal)
      const cols = app.bim.entities.filter(x => x.type === 'column' && Array.isArray(x.params.base));
      const p0 = e.params.baseline[0];
      let off2 = 0;
      for (const c of cols) {
        const cb = c.params.base;
        if (Math.abs(cb[2] + (+c.params.height || 3) - p0[2]) > 1e-4) continue;
        if (Math.hypot(cb[0] - p0[0], cb[1] - p0[1]) <= 0.5) {
          off2 = (ll === 'left' ? -(+e.params.webWidth || 0.3) / 2
            : ll === 'right' ? (+e.params.webWidth || 0.3) / 2 : 0) + lat;
          break;
        }
      }
      if (row === 1 && col === 1 && Math.abs(off2) < 1e-9) continue;
      out.insertions[e.id] = { row, col, off2 };
    }
    for (const p of d.loadPatterns) out.patterns.push({ name: p.name, type: p.type });
    for (const c of d.combos) out.combos.push({ name: c.name, cases: c.cases });
    return out;
  }

  // app-side results for the diff: member end forces per case (kN, kN·m).
  // Axials are exported SIGNED in ETABS's convention (tension positive): the
  // engine's i-end end force Fi is compression-positive, so N = −Fi (the
  // member-average axial — ETABS reports per-end, which differs by half the
  // column self-weight). The old Math.abs() export destroyed exactly the
  // sign information that made beam axials look flipped against ETABS.
  function serializeResults(app) {
    const R = app.rcResults;
    if (!R) return null;
    const pick = src => ({
      name: src.name,
      members: src.members.filter(Boolean).map(m => ({
        id: m.id,
        P: kN(-(m.Fi)),
        Vi: kN(m.Vi), Mi: kNm(m.Mi), Vj: kN(m.Vj), Mj: kNm(m.Mj),
        V2i: kN(m.Vi2 || 0), M2i: kNm(m.Mi2 || 0), V2j: kN(m.Vj2 || 0), M2j: kNm(m.Mj2 || 0),
      })),
    });
    const out = { patterns: R.patterns.map(pick), combos: R.combos.map(pick) };
    try { out.design = serializeDesign(app); }
    catch (e) { out.designError = String((e && e.message) || e); }
    return out;
  }

  // ---- per-member ACI 318-19 design on the governing (worst) combo.
  // Beams export required As top/bot (mm²) directly; columns export DCR at
  // the provided layout plus the REQUIRED steel, found by sweeping a uniform
  // bar diameter through the same fiber P-M interaction math ETABS uses for
  // its PMM sweep (generatePMCurve + capacityRatio, memoized per layout).
  function serializeDesign(app) {
    const R = app.rcResults;
    const combos = R.combos.length ? R.combos.map(c => c.name) : R.patterns.map(p => p.name);
    const d = root.RCDefine.ensure(app);
    const beams = {}, columns = {};

    for (const cn of combos) {
      let res;
      try { res = root.RCBeam.designAllBeams(app, cn).results; } catch (e) { continue; }
      for (const r of res || []) {
        const c = beams[r.id] || (beams[r.id] = { AsTop: 0, AsBot: 0, MuTop: 0, MuBot: 0, Vu: 0, combo: cn });
        if ((r.AsTop || 0) > c.AsTop) { c.AsTop = r.AsTop || 0; c.MuTop = r.MuTop || 0; c.combo = cn; }
        if ((r.AsBot || 0) > c.AsBot) { c.AsBot = r.AsBot || 0; c.MuBot = r.MuBot || 0; c.combo = cn; }
        if ((r.Vu || 0) > c.Vu) c.Vu = r.Vu || 0;
      }
    }

    // columns: DCR at the provided layout per combo, then one As sweep at
    // the governing combo (demands are combo-fixed inside designAllColumns)
    const colSecs = d.frameSections.filter(s => (s.designType || 'column') === 'column');
    let govCombo = combos[0], worst = -1;
    const providedRuns = [];
    for (const cn of combos) {
      try {
        const res = root.RCColumn.designAllColumns(app, cn, 'design', true).results;
        providedRuns.push({ cn, byId: new Map(res.map(r => [r.id, r])) });
        for (const r of res) if (r.dcr > worst) { worst = r.dcr; govCombo = cn; }
      } catch (e) { /* skip broken combo */ }
    }
    for (const { cn, byId } of providedRuns) {
      for (const [id, r] of byId) {
        const c = columns[id] || (columns[id] = { dcr: 0, Pu: 0, Mx: 0, My: 0, combo: cn });
        if (r.dcr > c.dcr) Object.assign(c, {
          dcr: r.dcr, Pu: r.Pu, Mx: r.Mx, My: r.My, crStrong: r.crStrong,
          crWeak: r.crWeak, Pcap: r.Pcap, combo: cn, status: r.status });
      }
    }

    // required-As sweep per column SECTION (columns share sections; the
    // sweep overrides rebarSize on the section record and restores it)
    const barCount = reb => 4 + 2 * (reb.nR3 || 0) + 2 * (reb.nR2 || 0);
    const dias = [10, 12, 16, 20, 22, 25, 28, 32, 36, 40];
    const passDia = new Map(); // section name → Map(columnId → min dia passing)
    for (const sec of colSecs) {
      const reb0 = sec.rebar || {};
      const saved = sec.rebar;
      try {
        for (const dia of dias) {
          sec.rebar = { ...reb0, rebarSize: String(dia) };
          let res;
          try { res = root.RCColumn.designAllColumns(app, govCombo, 'design', true).results; }
          catch (e) { break; }
          for (const r of res || []) {
            if (r.dcr <= 1) {
              if (!passDia.has(sec.name)) passDia.set(sec.name, new Map());
              const m = passDia.get(sec.name);
              if (!m.has(r.id)) m.set(r.id, dia);
            }
          }
          if (passDia.get(sec.name) && passDia.get(sec.name).size >=
              app.bim.entities.filter(e => e.type === 'column' &&
                (e.params.designSection === sec.name)).length) break;
        }
      } finally { sec.rebar = saved; }
    }
    for (const sec of colSecs) {
      const m = passDia.get(sec.name);
      if (!m) continue;
      const reb0 = sec.rebar || {};
      const nb = barCount(reb0);
      for (const [id, dia] of m) {
        columns[id] = Object.assign(columns[id] || {}, {
          AsReq: +(nb * Math.PI * dia * dia / 4).toFixed(0),  // mm²
          AsReqDia: dia, AsProvided: +(nb * Math.PI *
            ((parseFloat(reb0.rebarSize)) || 16) ** 2 / 4).toFixed(0),
        });
      }
    }
    return { combo: govCombo, beams, columns };
  }

  function buildScript(model) {
    const sections = `SECTIONS = ${JSON.stringify(model.sections)}`;
    const members = `MEMBERS = ${JSON.stringify(model.members)}`;
    const patterns = `PATTERNS = ${JSON.stringify(model.patterns)}`;
    const combos = `COMBOS = ${JSON.stringify(model.combos)}`;
    const mats = `MATS = ${JSON.stringify(model.materials)}`;
    const insertions = `INSERTIONS = ${JSON.stringify(model.insertions || {})}`;
    return `# -*- coding: utf-8 -*-
# Auto-generated by WebSketch 3D (dev validation export) — builds the same
# model in ETABS via the OAPI, runs analysis + ACI 318-19 design, and dumps
# results to etabs-results.json for diffing against the app engine.
# Pipeline notes (verified live on ETABS 23.3):
#   • SetLoadDistributed defaults to Replace=true and the optional
#     Replace=false args fail to marshal on this install — self-weight is
#     COMBINED with the user DEAD UDL into one call.
#   • ETABS auto rigid end-length offsets are forced OFF (centerline) to
#     match the app engine (rigid-zone factor 0); SetLocalAxes(0) pins the
#     axis convention (ETABS local 1 = the app's element direction).
#   • RespCombo.SetCaseList refuses every call form here — the named combos
#     stay empty; diff.py superposes pattern forces (exact for linear runs).
#   • Design summaries need NumberItems as an in-value int followed by one
#     empty array per out-array.
import json, os, sys, traceback
import comtypes
import comtypes.client
import comtypes.typeinfo
from comtypes.client._generate import GetModule

HERE = os.path.dirname(os.path.abspath(__file__))

SECTIONS = ${sections}
MEMBERS = ${members}
PATTERNS = ${patterns}
COMBOS = ${combos}
MATS = ${mats}
INSERTIONS = ${insertions}

def attach():
    tlib = comtypes.typeinfo.LoadRegTypeLib(
        comtypes.GUID('{542F7A9D-3A7D-4061-97B3-3A1276FF83BD}'), 1, 0, 0)
    GetModule(tlib)
    import comtypes.gen.ETABSv1 as ETABSv1
    try:
        obj = comtypes.client.GetActiveObject('CSI.ETABS.API.ETABSObject')
        print('attached to running ETABS')
    except Exception:
        obj = comtypes.client.CreateObject('CSI.ETABS.API.ETABSObject')
        print('launched new ETABS (may take a minute)')
    return obj.QueryInterface(ETABSv1.cOAPI)

def main():
    etabs = attach()
    sap = etabs.SapModel
    sap.InitializeNewModel(6)   # kN_m_C — fresh blank model

    # ---------------- materials (exact ETABS 23 signatures)
    for name, m in MATS.items():
        if m['type'] == 'concrete':
            sap.PropMaterial.SetMaterial(name, 2)  # CONCRETE
            sap.PropMaterial.SetOConcrete_1(name, m['fc'], False, 0.65, 1, 1,
                                            0.002, 0.003, 0, 0, 0, 0)
        else:
            sap.PropMaterial.SetMaterial(name, 6)  # REBAR
            # SetORebar_1(Name, Fy, Fu, EFy, EFu, SSType, SSHysType,
            #             StrainAtHardening, StrainUltimate, FinalSlope,
            #             UseCaltransSSDefaults, Temp) — EFy/EFu are the
            # expected STRENGTHS (MPa), 0 lets ETABS apply its own default
            sap.PropMaterial.SetORebar_1(name, m['fy'],
                                         m.get('fu') or m['fy'] * 1.08,
                                         m.get('fye') or 0,
                                         m.get('fue') or 0,
                                         1, 1, 0.0068, 0.09, 0.05, False, 0)

    # ---------------- frame sections (rect): T3 = depth, T2 = width — meters
    for s in SECTIONS:
        sap.PropFrame.SetRectangle(s['name'], s['mat'], s['h'], s['b'])

    # ---------------- members (meters)
    names = {}
    zBase = 1e9
    for mb in MEMBERS:
        zBase = min(zBase, mb['a'][2], mb['b'][2])
    for mb in MEMBERS:
        a, b = mb['a'], mb['b']
        nm, ret = sap.FrameObj.AddByCoord(a[0], a[1], a[2], b[0], b[1], b[2],
                                          '', mb['sec'], mb['name'])
        names[mb['name']] = nm
        # pin the local axes: 0° = ETABS default (local 1 = a→b, local 2
        # vertical-up for horizontal members) — matches the app engine
        try: sap.FrameObj.SetLocalAxes(nm, float(mb.get('ax') or 0))
        except Exception as e: print('local axes skipped', mb['name'], e)
        if mb['kind'] == 'beam':
            info = INSERTIONS.get(mb['name'])
            if info:
                cp = info['row'] * 3 + info['col'] + 1
                try:
                    sap.FrameObj.SetInsertionPoint(nm, cp, False, True,
                                                   0.0, float(info.get('off2', 0)),
                                                   'Global')
                except Exception as e:
                    print('insertion point skipped', mb['name'], e)
    print('members added:', len(names))

    # ---------------- centerline connectivity (parity with the app engine)
    for nm in names.values():
        ret = sap.FrameObj.SetEndLengthOffset(nm, False, 0.0, 0.0, 0.0)
        if ret != 0:
            print('end length offset failed:', nm, ret)

    # ---------------- supports: fixed at the lowest nodes
    cnt, allNames, ret = sap.PointObj.GetNameList()
    for i in range(cnt):
        nm = allNames[i]
        x, y, z, ret = sap.PointObj.GetCoordCartesian(nm)
        if abs(z - zBase) < 1e-6:
            sap.PointObj.SetRestraint(nm, (True,) * 6)

    # ---------------- load patterns: REUSE the default cases when the app
    # pattern matches them case-insensitively. ETABS auto-creates the design
    # combos (DConS1/DConS2) referencing the DEFAULT 'Dead'/'Live' names and
    # SetCaseList is broken on this install — so the app's loads must land on
    # those cases for ETABS design to see real demand.
    cnt, cases, _ = sap.LoadCases.GetNameList()
    existing = {str(c).upper(): str(c) for c in cases}
    caseOf = {}
    for p in PATTERNS:
        nm = existing.get(p['name'].upper())
        if not nm:
            t = {'DEAD': 1, 'SUPERDEAD': 2, 'LIVE': 3}.get(p['type'].upper(), 4)
            sap.LoadPatterns.Add(p['name'], t, 0, True)
            nm = p['name']
        sap.LoadPatterns.SetSelfWTMultiplier(nm, 0)
        caseOf[p['name']] = nm
    print('case map:', caseOf)

    # ---------------- member loads: self-weight COMBINED into DEAD
    for mb in MEMBERS:
        nm = names[mb['name']]
        sec = next((s for s in SECTIONS if s['name'] == mb['sec']), None)
        sw = (sec['b'] * sec['h'] * 25.0) if sec else 0.0   # A * 25 kN/m3
        dead = [l for l in mb['loads'] if l['pat'] == 'DEAD' and l['type'] == 'dist']
        wtot = sw + sum(l['w'] for l in dead)
        sap.FrameObj.SetLoadDistributed(nm, caseOf['DEAD'], 1, 10, 0, 1, wtot, wtot)
        for L2 in mb['loads']:
            if L2['type'] == 'dist' and L2['pat'] != 'DEAD':
                sap.FrameObj.SetLoadDistributed(nm, caseOf[L2['pat']], 1, 10, 0, 1,
                                                L2['w'], L2['w'])
            elif L2['type'] == 'point':
                a, b = mb['a'], mb['b']
                L = ((b[0]-a[0])**2 + (b[1]-a[1])**2 + (b[2]-a[2])**2) ** 0.5 or 1
                sap.FrameObj.SetLoadPoint(nm, caseOf[L2['pat']], 1, 10,
                                          min(max(L2['a'] / L, 0), 1), L2['P'])

    # ---------------- combos (names only — see header note)
    for c in COMBOS:
        sap.RespCombo.Add(c['name'], 0)

    # ---------------- save first: the ETABS solver requires a saved model
    edb = os.path.join(HERE, 'etabs-test.EDB')
    sap.File.Save(edb)

    # ---------------- analyze (Modal off — no mass source in this validation)
    cnt, cases, ret = sap.LoadCases.GetNameList()
    for i in range(cnt):
        if cases[i] in ('Modal',):
            sap.Analyze.SetRunCaseFlag(cases[i], False)
    ret = sap.Analyze.RunAnalysis()
    print('RunAnalysis ret', ret)

    # ---------------- concrete design (ACI 318-19) — design sections then
    # design, in the same flow as the analysis (StartDesign refuses re-runs)
    try: sap.DesignConcrete.SetCode('ACI 318-19')
    except Exception as e: print('code set failed:', e)
    dret = sap.DesignConcrete.StartDesign()
    print('StartDesign ret', dret, '(1 = refused / nothing to design)')

    # ---------------- extract analysis forces (patterns only; combos are
    # superposed by diff.py — exact for this linear model)
    results = {'forces': {}, 'design': {}, 'nameMap': names,
               'note': 'combo forces are superposed by diff.py from patterns'}
    for mb in MEMBERS:
        nm = names[mb['name']]
        for cs in [p['name'] for p in PATTERNS]:
            try:
                # one case selected at a time (resolved ETABS case name);
                # results are stored under the APP pattern name so diff.py
                # keys match across engines
                sap.Results.Setup.DeselectAllCasesAndCombosForOutput()
                sap.Results.Setup.SetCaseSelectedForOutput(caseOf[cs])
                r = sap.Results.FrameForce(nm, 1, 0, [], [], [], [], [], [],
                                           [], [], [], [], [])
                n = r[0]
                if not n:
                    results['forces'].setdefault(mb['name'], {}).setdefault(cs, {})['err'] = 'no results'
                    continue
                results['forces'].setdefault(mb['name'], {})[cs] = {
                    'P0': r[8][0], 'V2_0': r[9][0], 'V3_0': r[10][0],
                    'M2_0': r[12][0], 'M3_0': r[13][0],
                    'P1': r[8][n - 1], 'V2_1': r[9][n - 1], 'V3_1': r[10][n - 1],
                    'M2_1': r[12][n - 1], 'M3_1': r[13][n - 1]}
            except Exception as e:
                results['forces'].setdefault(mb['name'], {})[cs] = {'error': str(e)}

    # ---------------- design summary — structured rows
    for mb in MEMBERS:
        nm = names[mb['name']]
        try:
            if mb['kind'] == 'beam':
                # Name, NumberItems(in), then 14 out arrays:
                # FrameName, Location, TopCombo, TopArea, BotCombo, BotArea,
                # VMajorCombo, VMajorArea, TLCombo, TLArea, TTCombo, TTArea,
                # ErrorSummary, WarningSummary -> + ret
                r3 = sap.DesignConcrete.GetSummaryResultsBeam(
                    nm, 0, [], [], [], [], [], [], [], [], [], [], [], [], [])
                n = r3[0]
                results['design'][mb['name']] = {
                    'rows': n,
                    'location': list(r3[2]), 'topCombo': list(r3[3]),
                    'topArea': list(r3[4]), 'botCombo': list(r3[5]),
                    'botArea': list(r3[6]), 'vmajorArea': list(r3[8]),
                }
            else:
                # Name, NumberItems(in), then 12 out arrays:
                # FrameName, MyOption, Location, PMMCombo, PMMArea, PMMRatio,
                # VMajorCombo, AVMajor, VMinorCombo, AVMinor,
                # ErrorSummary, WarningSummary -> + ret
                r3 = sap.DesignConcrete.GetSummaryResultsColumn(
                    nm, 0, [], [], [], [], [], [], [], [], [], [], [])
                n = r3[0]
                results['design'][mb['name']] = {
                    'rows': n,
                    'location': list(r3[3]), 'pmmCombo': list(r3[4]),
                    'pmmArea': list(r3[5]), 'pmmRatio': list(r3[6]),
                }
        except Exception as e:
            results['design'][mb['name']] = {'error': str(e)}

    with open(os.path.join(HERE, 'etabs-results.json'), 'w') as f2:
        json.dump(results, f2, indent=1)
    sap.File.Save(edb)
    print('SAVED', os.path.join(HERE, 'etabs-results.json'))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
  `;
  }

  function open(app, cat) {
    if (cat !== 'exportEtabs') return;
    if (!app.rcResults) { app.toast('Run the analysis first', true); return; }
    const model = serializeModel(app);
    const results = serializeResults(app);
    if (!model.members.length) { app.toast('No beams/columns to export', true); return; }
    const script = buildScript(model);
    const html = '<div style="font-size:12px;max-height:60vh;overflow:auto">' +
      `<p>Model: <b>${model.members.length}</b> members · <b>${model.sections.length}</b> sections · ` +
      `<b>${model.patterns.length}</b> patterns · <b>${model.combos.length}</b> combos</p>` +
      '<p>Writes <b>build_etabs_model.py</b> (OAPI script) and <b>app-results.json</b> ' +
      '(this engine\'s forces for diffing). Run: <code>python build_etabs_model.py</code> ' +
      'with ETABS open — it builds the model, runs analysis + ACI 318-19 design, saves <b>etabs-results.json</b>.</p></div>';
    app.dialog('Export to ETABS (dev)', html, [
      ['Export', () => {
        try {
          const blob1 = new Blob([script], { type: 'text/x-python' });
          const a1 = document.createElement('a');
          a1.href = URL.createObjectURL(blob1);
          a1.download = 'build_etabs_model.py';
          a1.click();
          const blob2 = new Blob([JSON.stringify({ model, appResults: results }, null, 1)], { type: 'application/json' });
          const a2 = document.createElement('a');
          a2.href = URL.createObjectURL(blob2);
          a2.download = 'app-results.json';
          a2.click();
          app.toast('Exported build_etabs_model.py + app-results.json');
        } catch (e) {
          app.toast('Export failed: ' + e.message, true);
        }
        return false;
      }],
      ['Close', null],
    ]);
  }

  root.RCEtabs = { open, serializeModel, serializeResults, buildScript };
})(window);
