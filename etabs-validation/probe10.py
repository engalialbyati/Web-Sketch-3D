# -*- coding: utf-8 -*-
import comtypes, comtypes.client, comtypes.typeinfo
from comtypes.client._generate import GetModule
tlib = comtypes.typeinfo.LoadRegTypeLib(
    comtypes.GUID('{542F7A9D-3A7D-4061-97B3-3A1276FF83BD}'), 1, 0, 0)
GetModule(tlib)
import comtypes.gen.ETABSv1 as ETABSv1
obj = comtypes.client.GetActiveObject('CSI.ETABS.API.ETABSObject')
sap = obj.QueryInterface(ETABSv1.cOAPI).SapModel

# set design type user=beam: (Name, DesignTypeOption, DesignType)
ret = sap.FrameObj.SetDesignType('B1', 2, 1)
print('SetDesignType B1 ->', ret)
ret = sap.DesignConcrete.StartDesign()
print('StartDesign ret', ret)
r = sap.DesignConcrete.GetSummaryResultsBeam('B1', 0, [], [], [], [], [], [],
                                             [], [], [], [], [], [], [])
print('BEAM B1 rows:', r[0])
if r[0]:
    print('  Loc', list(r[2])[:5])
    print('  TopCombo', list(r[3])[:5], ' TopArea mm2', [round(a*1e6,1) for a in r[4]][:5])
    print('  BotCombo', list(r[5])[:5], ' BotArea mm2', [round(a*1e6,1) for a in r[6]][:5])
    print('  VMajor', list(r[7])[:5], ' VMajorArea mm2', [round(a*1e6,1) for a in r[8]][:5])
