# -*- coding: utf-8 -*-
# App (WebSketch FEA) vs ETABS validation diff.
# Loads both result files, maps axes/signs, superposes ETABS combo forces
# from its pattern results (exact for linear analysis), and reports the
# agreement statistics + worst members.
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

def etabs_combo_force(mname, combo, key):
    """Superpose ETABS pattern end-values for a combo, e.g. 'M3_0'."""
    s = 0.0
    for pat, f in combo['cases']:
        s += f * etF[mname][pat][key if not key.startswith('M') or True else key]
    return s

# ETABS axis mapping (verified empirically across all 65 members):
#   beams   : gravity bending = M3, gravity shear = V2, axial = P (sgn +1)
#   columns : app M(i/j) <-> et M2, app M2 <-> et M3, app V(i/j) <-> et V3,
#             app V2 <-> et V2 with sgn -1; app P is the AVERAGE of the end
#             axials in compression-positive convention (et P is tension+,
#             so sgn -1; the average shows up as ~half a story's column
#             self-weight on base columns)
def fields(n):
    if kind[n] == 'beam':
        return [('P',    'P0',    'P',    1),
                ('M_i',  'M3_0',  'Mi',   1),
                ('M_j',  'M3_1',  'Mj',   1),
                ('V_i',  'V2_0',  'Vi',   1),
                ('V_j',  'V2_1',  'Vj',   1)]
    return [('P',    'P0',    'P',    -1),
            ('M_i',  'M2_0',  'Mi',   1),
            ('M_j',  'M2_1',  'Mj',   1),
            ('M2_i', 'M3_0',  'M2i',  1),
            ('M2_j', 'M3_1',  'M2j',  1),
            ('V_i',  'V3_0',  'Vi',   1),
            ('V_j',  'V3_1',  'Vj',   1),
            ('V2_i', 'V2_0',  'V2i',  -1),
            ('V2_j', 'V2_1',  'V2j',  -1)]

def rel(a, b):
    d = abs(a - b)
    scale = max(abs(a), abs(b), 1e-9)
    return d, d / scale * 100.0

report = {'patterns': {}, 'combos': {}}

def compare(appV, etV, label, bucket):
    d, pct = rel(appV, etV)
    row = bucket.setdefault(label, [])
    row.append((pct, d, appV, etV))

# ---------- pattern forces (per member, per end value)
for pat in ('DEAD', 'LIVE'):
    bucket = report['patterns'].setdefault(pat, {})
    worst = []
    for n in sorted(mdl):
        av = appPat[pat][n]
        for label, ek, ak, sgn in fields(n):
            compare(av[ak], sgn * etF[n][pat][ek], f'{kind[n]}.{label}', bucket)
    # combo-level summary rows collected below

# ---------- combos: app combo vs superposed ETABS
for cmb in COMBOS:
    bucket = report['combos'].setdefault(cmb['name'], {})
    for n in sorted(mdl):
        av = appCmb[cmb['name']][n]
        for label, ek, ak, sgn in fields(n):
            ev = sum(f * etF[n][p][ek] for p, f in cmb['cases'])
            compare(av[ak], sgn * ev, f'{kind[n]}.{label}', bucket)

# ---------- print summary
print('=' * 74)
print('APP (WebSketch FEA) vs ETABS 23 — 65-member 5-story frame, kN / kN·m')
print('=' * 74)
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

# ---------- worst offenders + a few spot checks
print('\n--- worst 12 absolute differences (combos)')
rows = []
for cname, bucket in report['combos'].items():
    for label, rs in bucket.items():
        for pct, d, av, ev in rs:
            rows.append((d, cname, label, av, ev))
rows.sort(reverse=True)
for d, cname, label, av, ev in rows[:12]:
    print(f'  {cname:10} {label:8} Δ={d:8.3f}   app={av:9.3f}  etabs={ev:9.3f}')

# ---------- design side: app DCR vs ETABS required rebar
print('\n' + '=' * 74)
print('DESIGN — app DCR vs ETABS ACI 318-19 required areas')
print('=' * 74)
appD = app.get('design') or {}
etD = et.get('design') or {}
cols = [(n, v) for n, v in sorted(etD.items()) if kind.get(n) == 'column' and isinstance(v, dict) and v.get('rows')]
beams = [(n, v) for n, v in sorted(etD.items()) if kind.get(n) == 'beam' and isinstance(v, dict) and v.get('rows')]
print(f'ETABS design rows available: {len(cols)} columns, {len(beams)} beams')
if cols:
    print(f"\n{'col':5} {'worst PMM ratio (et)':>20} {'PMM area mm2 (et)':>18} {'app DCR':>9}")
    for n, v in cols[:8]:
        pr = v.get('pmmRatio') or []
        pa = v.get('pmmArea') or []
        worst_r = max((r for r in pr), default=0)
        worst_a = max((a for a in pa), default=0)
        dcr = appD.get(n, {}).get('pmm') or appD.get(n, {}).get('DCR') or ''
        print(f'{n:5} {worst_r:20.3f} {worst_a*1e6:18.0f} {str(dcr):>9}')
if beams:
    print(f"\n{'beam':5} {'top mm2 (et)':>13} {'bot mm2 (et)':>13}   app (Mu kN·m, DCR)")
    for n, v in beams[:8]:
        ta = max((a for a in (v.get('topArea') or [0])), default=0) * 1e6
        ba = max((a for a in (v.get('botArea') or [0])), default=0) * 1e6
        info = appD.get(n, {})
        print(f'{n:5} {ta:13.0f} {ba:13.0f}   {info}')

# ---------- save machine-readable diff
out = {'patterns': {}, 'combos': {}}
for sect in ('patterns', 'combos'):
    for name, bucket in report[sect].items():
        out[sect][name] = {label: {
            'n': len(rs), 'median_pct': sorted(r[0] for r in rs)[len(rs)//2],
            'p90_pct': sorted(r[0] for r in rs)[int(len(rs)*0.9)],
            'max_pct': max(r[0] for r in rs)} for label, rs in bucket.items()}
with open(os.path.join(HERE, 'diff-summary.json'), 'w') as f:
    json.dump(out, f, indent=1)
print('\nwrote diff-summary.json')
