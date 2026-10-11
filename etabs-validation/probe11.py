# -*- coding: utf-8 -*-
import comtypes, comtypes.client, comtypes.typeinfo
from comtypes.client._generate import GetModule
tlib = comtypes.typeinfo.LoadRegTypeLib(
    comtypes.GUID('{542F7A9D-3A7D-4061-97B3-3A1276FF83BD}'), 1, 0, 0)
GetModule(tlib)
import comtypes.gen.ETABSv1 as ETABSv1
obj = comtypes.client.GetActiveObject('CSI.ETABS.API.ETABSObject')
sap = obj.QueryInterface(ETABSv1.cOAPI).SapModel

dc = sap.DesignConcrete
# code-specific object
aci = dc.ACI318_19
print('ACI318_19 obj ok:', aci is not None)
try:
    r = aci.GetSummaryResultsBeam('B1', 0, [], [], [], [], [], [],
                                  [], [], [], [], [], [], [])
    print('ACI.GetSummaryResultsBeam rows:', r[0])
    if r[0]:
        print('  TopArea mm2', [round(a*1e6,1) for a in r[4]][:6])
        print('  BotArea mm2', [round(a*1e6,1) for a in r[6]][:6])
except Exception as e:
    print('ACI beam failed:', str(e)[:120])

try:
    r = aci.GetSummaryResultsBeam_2('B1', 0, [], [], [], [], [], [], [], [], [],
                                    [], [], [], [], [], [], [], [], [], [], [], [], [])
    print('ACI.GetSummaryResultsBeam_2 rows:', r[0])
    if r[0]:
        print('  TopProvided mm2', [round(a*1e6,1) for a in r[7]][:6])
        print('  BotProvided mm2', [round(a*1e6,1) for a in r[12]][:6])
except Exception as e:
    print('ACI beam_2 failed:', str(e)[:120])
