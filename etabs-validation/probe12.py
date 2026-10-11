# -*- coding: utf-8 -*-
import comtypes, comtypes.client, comtypes.typeinfo
from comtypes.client._generate import GetModule
tlib = comtypes.typeinfo.LoadRegTypeLib(
    comtypes.GUID('{542F7A9D-3A7D-4061-97B3-3A1276FF83BD}'), 1, 0, 0)
GetModule(tlib)
import comtypes.gen.ETABSv1 as ETABSv1
obj = comtypes.client.GetActiveObject('CSI.ETABS.API.ETABSObject')
sap = obj.QueryInterface(ETABSv1.cOAPI).SapModel

for n in ('B1', 'C1'):
    t, ret = sap.FrameObj.GetDesignProcedure(n)
    print(n, 'design procedure =', t, 'ret', ret, ' (2 = concrete beam? 3 = concrete column?)')

# does beam summary return anything for a COLUMN name (sanity)?
r = sap.DesignConcrete.GetSummaryResultsBeam('C1', 0, [], [], [], [], [], [],
                                             [], [], [], [], [], [], [])
print('GetSummaryResultsBeam(C1) rows:', r[0])
r = sap.DesignConcrete.GetSummaryResultsColumn('B1', 0, [], [], [], [], [],
                                               [], [], [], [], [], [])
print('GetSummaryResultsColumn(B1) rows:', r[0])

# maybe beam design needs to be "started" per-beam via overwrite or the
# detailing... try re-running StartDesign then beam rows again
print('StartDesign ret', sap.DesignConcrete.StartDesign())
r = sap.DesignConcrete.GetSummaryResultsBeam('B1', 0, [], [], [], [], [], [],
                                             [], [], [], [], [], [], [])
print('BEAM B1 rows again:', r[0])
