# -*- coding: utf-8 -*-
import comtypes, comtypes.client, comtypes.typeinfo
from comtypes.client._generate import GetModule
tlib = comtypes.typeinfo.LoadRegTypeLib(
    comtypes.GUID('{542F7A9D-3A7D-4061-97B3-3A1276FF83BD}'), 1, 0, 0)
GetModule(tlib)
import comtypes.gen.ETABSv1 as ETABSv1
obj = comtypes.client.GetActiveObject('CSI.ETABS.API.ETABSObject')
sap = obj.QueryInterface(ETABSv1.cOAPI).SapModel
dt = sap.DatabaseTables

ret, n, names, keys = dt.GetAvailableTables()
print('ret', ret, 'tables:', n)
hits = [t for t in list(names) if 'Concrete Beam Design' in t or 'Concrete Column Design' in t]
for t in hits: print('  ', t)
if hits:
    for t in hits[:2]:
        r = dt.GetTableForDisplayArray(t, [], [], 'All', 0)
        print(f'\n=== {t}: ret={r[0]} fields={len(list(r[3]))}')
        flds = list(r[3]); rows = list(r[4])
        print('   fields:', flds[:12])
        for row in rows[:3]:
            print('   row:', list(row)[:12])
