# -*- coding: utf-8 -*-
import comtypes, comtypes.client, comtypes.typeinfo
from comtypes.client._generate import GetModule
tlib = comtypes.typeinfo.LoadRegTypeLib(
    comtypes.GUID('{542F7A9D-3A7D-4061-97B3-3A1276FF83BD}'), 1, 0, 0)
GetModule(tlib)
import comtypes.gen.ETABSv1 as ETABSv1
obj = comtypes.client.GetActiveObject('CSI.ETABS.API.ETABSObject')
sap = obj.QueryInterface(ETABSv1.cOAPI).SapModel

cnt, frs, _ = sap.FrameObj.GetNameList()
for n in frs:
    sap.FrameObj.SetDesignSection(n, 'B300×500' if n.startswith('B') else 'C400×400', False)
print('design sections set')

print('StartDesign ret', sap.DesignConcrete.StartDesign())
r = sap.DesignConcrete.GetSummaryResultsBeam('B1', 0, [], [], [], [], [], [],
                                             [], [], [], [], [], [], [])
print('BEAM B1 rows:', r[0])
if r[0]:
    print('  Loc      ', list(r[2])[:6])
    print('  TopArea  ', [round(a*1e6,1) for a in r[4]][:6])
    print('  BotArea  ', [round(a*1e6,1) for a in r[6]][:6])
r = sap.DesignConcrete.GetSummaryResultsColumn('C1', 0, [], [], [], [], [],
                                               [], [], [], [], [], [])
print('COLUMN C1 rows:', r[0], 'pmmArea mm2:', [round(a*1e6,1) for a in r[5]][:6])
