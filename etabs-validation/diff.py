# -*- coding: utf-8 -*-
# App (WebSketch FEA) vs ETABS validation diff.
# Forces: maps axes/signs (conventions verified empirically), superposes
# ETABS combo forces from its pattern results (exact for linear analysis).
# Design: app required areas / DCR vs ETABS ACI 318-19 summary areas.
import json, os, math

HERE = os.path.dirname(os.path.abspath(__file__))
app = json.load(open(os.path.join(HERE, 'app-results.json')))
et  = json.load(open(os.path.join(HERE, 'etabs-results.json')))

mdl   = {m['name']: m for m in app['model']['members']}
kind  = {n: m['kind'] for n, m in mdl.items()}

appPat = {p['name']: {m['id']: m for m in p['members']}
          for p in app['appResults']['patterns']}
appCmb = {c['name']: {m['id']: m for m in c['members']}
          for c in app['appResults']['combos']}
etF = et['forces']

COMBOS = [{'name': '1.4D', 'cases': [('DEAD', 1.4)]},
          {'name': '1.2D+1.6L', 'cases': [('DEAD', 1.2), ('LIVE', 1.6)]}]

# Axis mapping (verified empirically across all 65 members):
#   P: BOTH sides now tension-positive, signed — direct compare. The app
#      value is the member-average axial; ETABS reports per end, so columns
#      compare against (P0+P1)/2 (beams have no axial UDL: avg == ends).
#   beams   : gravity bending = M3, gravity shear = V2
#   columns : app M(i/j) <-> et M2, app M2 <-> et M3, app V(i/j) <-> et V3,
#             app V2 <-> et V2 with sgn -1
def fields(n):
    if kind[n] == 'beam':
        return [('P',    ('P0', 'P1'), 'P',   1),
                ('M_i',  ('M3_0',),     'Mi',  1),
                ('M_j',  ('M3_1',),     'Mj',  1),
                ('V_i',  ('V2_0',),     'Vi',  1),
                ('V_j',  ('V2_1',),     'Vj',  1)]
    return [('P',    ('P0', 'P1'), 'P',    1),
            ('M_i',  ('M2_0',),     'Mi',   1),
            ('M_j',  ('M2_1',),     'Mj',   1),
            ('M2_i', ('M3_0',),     'M2i',  1),
            ('M2_j', ('M3_1',),     'M2j',  1),
            ('V_i',  ('V3_0',),     'Vi',   1),
            ('V_j',  ('V3_1',),     'Vj',   1),
            ('V2_i', ('V2_0',),     'V2i',  -1),
            ('V2_j', ('V2_1',),     'V2j',  -1)]

def etAvg(mname, pat, keys):
    if len(keys) == 2:
        return (etF[mname][pat][keys[0]] + etF[mname][pat][keys[1]]) / 2.0
    return etF[mname][pat][keys[0]]

def rel(a, b):
    d = abs(a - b)
    scale = max(abs(a), abs(b), 1e-9)
    return d, d / scale * 100.0

report = {'patterns': {}, 'combos': {}}

# ---------- pattern forces (per member, per end value)
for pat in ('DEAD', 'LIVE'):
    bucket = report['patterns'].setdefault(pat, {})
    for n in sorted(mdl):
        av = appPat[pat][n]
        for label, ek, ak, sgn in fields(n):
            ev = etAvg(n, pat, ek)
            d, pct = rel(av[ak], sgn * ev)
            bucket.setdefault(label, []).append((pct, d, av[ak], ev))

# ---------- combos: app combo vs superposed ETABS
for cmb in COMBOS:
    bucket = report['combos'].setdefault(cmb['name'], {})
    for n in sorted(mdl):
        av = appCmb[cmb['name']][n]
        for label, ek, ak, sgn in fields(n):
            if len(ek) == 2:
                ev = sum(f * (etF[n][p][ek[0]] + etF[n][p][ek[1]]) / 2
                         for p, f in cmb['cases'])
            else:
                ev = sum(f * etF[n][p][ek[0]] for p, f in cmb['cases'])
            d, pct = rel(av[ak], sgn * ev)
            bucket.setdefault(label, []).append((pct, d, av[ak], ev))

# ---------- print summary
print('=' * 74)
print('APP (WebSketch FEA) vs ETABS 23 — 65-member 5-story frame, kN / kN·m')
print('=' * 74)
summary = {}
def band(pcts):
    n = len(pcts)
    med = sorted(pcts)[n // 2]
    p90 = sorted(pcts)[int(n * 0.9)]
    within5 = sum(1 for p in pcts if p <= 5)
    within10 = sum(1 for p in pcts if p <= 10)
    return f'n={n:4}  median={med:5.1f}%  p90={p90:5.1f}%  max={max(pcts):6.1f}%  ≤5%:{within5}  ≤10%:{within10}'

for sect in ('patterns', 'combos'):
    for name, bucket in report[sect].items():
        print(f'\n--- {sect.upper()} {name}')
        for label, rows in sorted(bucket.items()):
            print(f'  {label:8} {band([r[0] for r in rows])}')
            pcts = sorted(r[0] for r in rows)
            summary[f'{sect}:{name}:{label}'] = {
                'n': len(pcts), 'median_pct': round(pcts[len(pcts)//2], 2),
                'p90_pct': round(pcts[int(len(pcts)*0.9)], 2),
                'max_pct': round(pcts[-1], 2)}

rows = []
for cname, bucket in report['combos'].items():
    for label, rs in bucket.items():
        for pct, d, av, ev in rs:
            rows.append((d, cname, label, av, ev))
rows.sort(reverse=True)
print('\n--- worst 10 absolute differences (combos)')
for d, cname, label, av, ev in rows[:10]:
    print(f'  {cname:10} {label:8} Δ={d:8.3f}   app={av:9.3f}  etabs={ev:9.3f}')

# ---------- per-member DESIGN diff
print('\n' + '=' * 74)
print('DESIGN — app ACI 318-19 export vs ETABS (API limits on this install)')
print('=' * 74)
appD = app['appResults'].get('design') or {}
etD  = et.get('design') or {}

def areaStats(pairs, tag):
    """pairs: list of (id, app_mm2, et_mm2). Prints + records stats."""
    ok = [(i, a, e) for i, a, e in pairs if a is not None and e is not None and e > 1]
    if not ok:
        print(f'  {tag}: no comparable rows'); return
    ratios = sorted(a / e for _, a, e in ok)
    med = ratios[len(ratios) // 2]
    w = max(ok, key=lambda t: abs(t[1] / t[2] - 1))
    n10 = sum(1 for r in ratios if abs(r - 1) <= 0.10)
    n20 = sum(1 for r in ratios if abs(r - 1) <= 0.20)
    print(f'  {tag}: n={len(ok)}  median app/et={med:.3f}  '
          f'within10%:{n10}/{len(ok)}  within20%:{n20}/{len(ok)}  '
          f'worst: {w[0]} app={w[1]:.0f} et={w[2]:.0f}')
    summary[tag] = {'n': len(ok), 'median_ratio': round(med, 3),
                    'within10': n10, 'within20': n20,
                    'worst': {'id': w[0], 'app': round(w[1]), 'et': round(w[2])}}

# beams: app AsTop/AsBot (worst combo) — ETABS beam design summaries return
# 0 rows through this API on this install, so only the app side is listed
appB = appD.get('beams') or {}
if appB:
    ts = sorted((v.get('AsTop') or 0) for v in appB.values())
    bs = sorted((v.get('AsBot') or 0) for v in appB.values())
    print(f'  app beam AsTop mm²: n={len(ts)} median={ts[len(ts)//2]:.0f} '
          f'max={ts[-1]:.0f} | AsBot median={bs[len(bs)//2]:.0f} max={bs[-1]:.0f}')
    summary['beam_app'] = {'n': len(appB), 'AsTop_med': round(ts[len(ts)//2]),
                           'AsTop_max': round(ts[-1]), 'AsBot_med': round(bs[len(bs)//2]),
                           'AsBot_max': round(bs[-1])}
print('  etabs beam summaries: 0 rows (API returns no beam design data here)')
summary['beam_etabs'] = 'unavailable'

# columns: app required-As sweep + DCR vs ETABS pmmArea.
# CAVEAT: ETABS pmmRatio is unpopulated (0.0) via this API and pmmArea tracks
# its internal default rebar layout — not a comparable minimum requirement.
appC = appD.get('columns') or {}
crows = []
for n, v in sorted(etD.items()):
    if kind.get(n) != 'column' or not isinstance(v, dict) or not v.get('rows'):
        continue
    a = appC.get(n)
    if not a: continue
    crows.append((n, a.get('AsReq'), max(v.get('pmmArea') or [0]) * 1e6))
if crows:
    areaStats(crows, 'column AsReq app vs et pmmArea (see caveat)')
    ds = sorted((v.get('dcr') or 0) for v in appC.values())
    print(f'  app column DCR: median={ds[len(ds)//2]:.3f} max={ds[-1]:.3f} '
          f'(worst member {max(appC.items(), key=lambda kv: kv[1].get("dcr", 0))[0]})')
    summary['column_app_dcr'] = {'median': round(ds[len(ds)//2], 3), 'max': round(ds[-1], 3)}

with open(os.path.join(HERE, 'diff-summary.json'), 'w') as f:
    json.dump(summary, f, indent=1)
print('\nwrote diff-summary.json')
