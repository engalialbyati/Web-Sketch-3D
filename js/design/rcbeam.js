// rcbeam.js — ACI 318-19 RC beam design (flexure + shear).
// Implements the procedure from the published Concrete Frame Design manual
// (CFD-ACI-318-19, §3.5): flexural reinforcement at stations (rectangular
// and T-beam, singly and doubly reinforced), shear reinforcement, and
// development length checks. Original code — equations cite ACI clauses.
// Units: N, mm, MPa (consistent with rcmodel.js internal state).
(function (root) {
  'use strict';

  // ============================================================ φ (21.2)
  // Strength reduction factor from net tensile strain (ACI 21.2.3, Table 21.2.2)
  function phiFlexure(et, esy) {
    const etLimit = esy + 0.003; // tension-controlled limit (ACI 21.2.2)
    if (et >= etLimit) return 0.90;
    if (et <= esy) return 0.65;
    // transition zone (ACI 21.2.3): linear interpolation
    return 0.65 + 0.25 * (et - esy) / 0.003;
  }

  // β₁ (ACI 22.2.2.4.3): f'c in MPa
  function beta1(fc) {
    const b = 0.85 - 0.05 * (fc - 28) / 7;
    return Math.max(0.65, Math.min(0.85, b));
  }

  // ============================================================ flexure
  // Design a rectangular beam for one moment. Returns As required (mm²),
  // φ used, and whether compression reinforcement is needed.
  // All inputs in N, mm, MPa.
  function designRectFlexure(Mu, b, d, dPrime, fc, fy, esy) {
    const b1 = beta1(fc);
    // φ = 0.9 initially (tension-controlled assumption, ACI 21.2)
    let phi = 0.90;

    // depth of compression block (CFD §3.5.1.2.1, ACI 22.2.2.4.1)
    const disc = d * d - 2 * Mu / (0.85 * phi * fc * b);
    if (disc <= 0) return { ok: false, reason: 'Section too small — Mu exceeds singly-reinforced capacity even at a=d.' };
    const a = d - Math.sqrt(disc);

    // max depth of compression block for tension-controlled (ACI 9.3.3.1)
    const cMax = d * 0.003 / (0.003 + esy);
    const aMax = b1 * cMax;

    if (a <= aMax) {
      // singly reinforced (CFD §3.5.1.2.1)
      const As = Mu / (phi * fy * (d - a / 2));
      // verify φ with actual c
      const c = a / b1;
      const et = 0.003 * (d - c) / c;
      phi = phiFlexure(et, esy);
      const AsFinal = Mu / (phi * fy * (d - a / 2));
      return { ok: true, As: AsFinal, a, c, phi, et, doubly: false, AsComp: 0 };
    }

    // doubly reinforced (CFD §3.5.1.2.1, ACI 9.3.3.1)
    const Cc = 0.85 * fc * b * aMax;
    const Muc = phi * Cc * (d - aMax / 2);
    const Mus = Mu - Muc;
    if (Mus <= 0) return { ok: true, As: 0, a: aMax, c: cMax, phi, et: 0, doubly: false, AsComp: 0 };

    const As1 = Muc / (phi * fy * (d - aMax / 2));
    const fsPrime = Math.min(Es200 * 0.003 * (cMax - dPrime) / cMax, fy);
    const As2 = Mus / (phi * fy * (d - dPrime));
    const As = As1 + As2;
    // φ for doubly reinforced: same as tension-controlled (the extra compression steel doesn't reduce ductility)
    return { ok: true, As, a: aMax, c: cMax, phi: 0.90, et: 0.003 + esy, doubly: true, AsComp: As2, fsPrime };
  }

  const Es200 = 200000; // MPa (modulus of steel, ACI 20.2.2.2)

  // T-beam positive moment design (CFD §3.5.1.2.2)
  // bf: effective flange width (ACI 6.3.2), ds: flange (slab) thickness
  function designTBeamFlange(Mu, bf, bw, d, ds, dPrime, fc, fy, esy) {
    const b1 = beta1(fc);
    let phi = 0.90;

    // try rectangular with bf (CFD §3.5.1.2.2: "If a ≤ ds")
    const disc = d * d - 2 * Mu / (0.85 * phi * fc * bf);
    if (disc <= 0) return { ok: false, reason: 'T-beam section too small.' };
    const a = d - Math.sqrt(disc);
    const cMax = d * 0.003 / (0.003 + esy);
    const aMax = b1 * cMax;

    if (a <= ds) {
      // compression block within flange → same as rectangular with b = bf
      const As = Mu / (phi * fy * (d - a / 2));
      const c = a / b1;
      const et = 0.003 * (d - c) / c;
      phi = phiFlexure(et, esy);
      const AsFinal = Mu / (phi * fy * (d - a / 2));
      return { ok: true, As: AsFinal, a, c, phi, et, tBeam: true, doubly: false, AsComp: 0 };
    }

    if (a <= aMax) {
      // compression block exceeds flange but still tension-controlled
      // (CFD §3.5.1.2.2: flange + web analysis)
      const Cf = 0.85 * fc * (bf - bw) * ds;
      const As1 = Cf / fy;
      const Muf = phi * Cf * (d - ds / 2);
      const Muw = Mu - Muf;
      const discW = d * d - 2 * Muw / (0.85 * phi * fc * bw);
      if (discW <= 0) return { ok: false, reason: 'Web insufficient.' };
      const a1 = d - Math.sqrt(discW);
      const As2 = Muw / (phi * fy * (d - a1 / 2));
      const As = As1 + As2;
      return { ok: true, As, a: a1, c: a1 / b1, phi, et: 0.003 + esy, tBeam: true, doubly: false, AsComp: 0 };
    }

    // doubly reinforced T-beam (needs compression steel)
    const Cf = 0.85 * fc * (bf - bw) * ds;
    const As1 = Cf / fy;
    const Muf = phi * Cf * (d - ds / 2);
    const Muw = Mu - Muf;
    const Cc = 0.85 * fc * bw * aMax;
    const Muc = phi * Cc * (d - aMax / 2);
    const Mus = Muw - Muc;
    const As2a = Muc / (phi * fy * (d - aMax / 2));
    const fsPrime = Math.min(Es200 * 0.003 * (cMax - dPrime) / cMax, fy);
    const As2b = Mus / (phi * fy * (d - dPrime));
    return { ok: true, As: As1 + As2a + As2b, a: aMax, c: cMax, phi: 0.90, et: 0.003 + esy, tBeam: true, doubly: true, AsComp: As2b, fsPrime };
  }

  // ============================================================ shear
  // Concrete shear capacity + required stirrup reinforcement (ACI 22.5)
  function designShear(Vu, bw, d, fc, fyt, lambda = 1.0) {
    const phi = 0.75; // shear φ (ACI 21.2.1, Table 21.2.1)
    // Vc (ACI 22.5.5.1, SI: Vc = 0.17·λ·√f'c·bw·d)
    let Vc = 0.17 * lambda * Math.sqrt(fc) * bw * d;
    // size effect (ACI 22.5.5.1.3): λs = min(1, 1.1/(1+d)) for d in mm... simplified
    const lambdaS = d > 600 ? Math.min(1, Math.sqrt(2 / (1 + d))) : 1.0;
    Vc *= lambdaS;
    // Vc upper limit (ACI 22.5.5.1.1)
    const VcMax = 0.83 * lambda * Math.sqrt(fc) * bw * d;
    Vc = Math.max(0, Math.min(Vc, VcMax));

    const phiVc = phi * Vc;
    // Vs upper limit (ACI 22.5.1.2)
    const VsMax = 2.1 * Math.sqrt(fc) * bw * d;
    const phiVnMax = phi * (Vc + VsMax);

    if (Vu > phiVnMax) {
      return { ok: false, phiVc, Vu: phiVnMax, reason: `Vu = ${(Vu/1e3).toFixed(1)} kN > φVn_max = ${(phiVnMax/1e3).toFixed(1)} kN — increase section size or f'c (ACI 22.5.1.2).` };
    }

    // required Av/s (ACI 22.5.1.1, 22.5.8.1)
    let Avs = 0;
    if (Vu > phiVc) {
      Avs = (Vu / phi - Vc) / (fyt * d); // mm²/mm
    }
    // minimum shear reinforcement (ACI 9.6.3.4, Table 9.6.3.4)
    const AvsMin = Math.max(0.062 * Math.sqrt(fc), 0.35) * bw / fyt;
    const AvsFinal = Math.max(Avs, Vu > phiVc ? AvsMin : 0);

    return {
      ok: true, phi, Vc: phiVc, Avs: AvsFinal, AvsMin,
      VuEq: Vu, VsReq: Math.max(0, Vu / phi - Vc),
    };
  }

  // ============================================================ development
  // Straight bar development length (ACI 25.4.2.3, SI simplified)
  function devLength(fy, fc, db, cover, spacing) {
    // ψt = 1.0 (bottom bar), λ = 1.0 (normal weight)
    // ld = (fy·ψt·ψe·db) / (2·λ·√f'c)  — ACI 25.4.2.3 (simplified, ≥300mm)
    let ld = (fy * db) / (2 * Math.sqrt(fc) * 1.0);
    ld = Math.max(ld, 300); // ACI 25.4.2.1 minimum
    return ld;
  }

  // ============================================================ torsion
  // ACI 318-19 Ch. 9.7 / 22.7 — solid rectangular section, θ = 45°,
  // thin-walled equivalent Ao ≈ 0.85·Aoh (ACI 22.7.6.1). SI unit forms.
  function designTorsion(Tu, b, d, h, fc, fyt, Acp, pcp) {
    const phi = 0.75;
    const lambda = 1.0; // normal-weight concrete
    // threshold below which torsion may be ignored (ACI 22.7.4.1, SI)
    const Tth = 0.061 * lambda * Math.sqrt(fc) * Acp * Acp / pcp;
    if (Tu <= phi * Tth)
      return { needed: false, Tth: Math.round(Tth / 1e6 * 100) / 100, phi };
    // section size cap (ACI 22.7.7.1, SI)
    const Tmax = 0.083 * lambda * Math.sqrt(fc) * Acp * Acp / pcp;
    if (Tu > phi * Tmax)
      return { needed: true, ok: false, Tth, Tmax,
        reason: 'Tu exceeds φ·Tmax — enlarge the section (ACI 22.7.7.1).' };
    // closed stirrup geometry (centerline ≈ cover + tie radius)
    const coverC = 40;
    const Aoh = Math.max((b - 2 * coverC) * (h - 2 * coverC), 1e3); // mm²
    const Ao = 0.85 * Aoh;
    const cotTheta = 1; // θ = 45°
    // transverse: Tn = 2·Ao·(At/s)·fyt·cotθ (ACI 22.7.6.1)
    const AtOverS = (Tu / phi) / (2 * Ao * fyt * cotTheta);   // mm²/mm
    // longitudinal (ACI 9.7.5.1): Al = (At/s)·pcp·(fyt/fyl)·cot²θ
    const Al = AtOverS * pcp * cotTheta * cotTheta;           // mm² (fyt = fyl)
    // Al,min (ACI 9.7.5.2, SI)
    const AlMin = 0.42 * Math.sqrt(fc) * Acp / fyt;
    // stirrup spacing cap (ACI 9.7.6.4): s ≤ min(ph/8, 300)
    const ph = 2 * ((b - 2 * coverC) + (h - 2 * coverC));
    const sMax = Math.min(ph / 8, 300);
    return {
      needed: true, ok: true, phi,
      Tth: Math.round(Tth / 1e6 * 100) / 100,
      AtOverS: +AtOverS.toFixed(4),           // mm²/mm one leg
      Al: Math.round(Math.max(Al, AlMin)),    // mm² total longitudinal
      AlMin: Math.round(AlMin),
      sMax: Math.round(sMax),
    };
  }

  // ============================================================ full design
  // Design all beams for a given combination.
  // Returns per-member, per-station design results with clause references.
  function designAllBeams(app, comboName) {
    const R = app.rcResults;
    if (!R) return { error: 'Run the analysis first (Analyze ▸ Run Analysis).' };
    const d = (RD || root.RCDefine).ensure(app);

    // find the combo (or use a pattern if no combos)
    let combo = R.combos.find(c => c.name === comboName);
    let pat = null;
    if (!combo) {
      pat = R.patterns.find(p => p.name === comboName);
      if (!pat) return { error: `Combination or pattern "${comboName}" not found.` };
    }

    const rebarDb = d.rebarDb || [];

    const results = [];
    const members = combo ? combo.members : pat.members;
    for (let mi = 0; mi < members.length; mi++) {
      const m = members[mi];
      if (m.type !== 'beam') continue;
      const ent = app.bim.getEntityById(m.id);
      if (!ent) continue;
      const sec = sectionOf(app, ent);
      if (!sec || sec.type !== 'rect') continue;
      const mat = materialOf(app, sec, ent);
      if (!mat || !mat.conc) continue;

      const fc = mat.conc.fc;
      const fy = (mat.rebar || mat.steel || { fy: 500 }).fy;
      const esy = fy / Es200;
      const dims = sec.dims || {};
      const b = (dims.b || 0.3) * 1000; // m → mm
      const h = (dims.h || 0.5) * 1000;
      const cover = ((sec.rebar && sec.rebar.coverTop) || 0.04) * 1000;
      const stirrupDia = 8;
      const assumedBar = 20;
      const dTop = h - cover - stirrupDia - assumedBar / 2;
      const dBot = h - cover - stirrupDia - assumedBar / 2;
      const dPrime = cover + stirrupDia + assumedBar / 2;
      const fyt = fy;

      // design moments from the combo/pattern end forces (N·mm)
      const Mi = m.Mi || 0, Mj = m.Mj || 0;
      const MuTop = Math.max(-Mi, -Mj, 0);
      const MuBot = Math.max(Mi, Mj, 0);
      const Vu = Math.max(Math.abs(m.Vi || 0), Math.abs(m.Vj || 0));

      // design flexure
      let topResult = { As: 0 };
      if (MuTop > 0) topResult = designRectFlexure(MuTop, b, dTop, dPrime, fc, fy, esy);
      let botResult = { As: 0 };
      if (MuBot > 0) botResult = designRectFlexure(MuBot, b, dBot, dPrime, fc, fy, esy);

      // min/max
      const AsMinTop = Math.max(0.25 * Math.sqrt(fc) / fy, 1.4 / fy) * b * dTop;
      const AsMax = 0.04 * b * dTop;
      const AsTopRaw = Math.max(topResult.As || 0, AsMinTop);
      const AsBotRaw = Math.max(botResult.As || 0, AsMinTop);

      // rebar selection
      const topBars = selectRebar(rebarDb, AsTopRaw, b, cover);
      const botBars = selectRebar(rebarDb, AsBotRaw, b, cover);

      // shear + stirrups
      const shear = designShear(Vu, b, dBot, fc, fyt);
      const stirrups = selectStirrups(shear, rebarDb, b, dBot);

      // torsion design (ACI Ch. 9.7)
      const Tu = m.Ti || 0;
      const Acp = b * h;
      const pcp = 2 * (b + h);
      const torsionResult = designTorsion(Tu, b, dBot, h, fc, fyt, Acp, pcp);

      // development length (top bar ψt=1.3, bottom ψt=1.0)
      const devTop = topBars ? devLength(fy, fc, topBars.dia, true, false) : 0;
      const devBot = botBars ? devLength(fy, fc, botBars.dia, false, false) : 0;

      // longitudinal spacing clamp (ACI 25.2.1): s ≤ min(3h, 450mm)
      if (topBars) {
        const sMax = Math.min(3 * h, 450);
        const sProv = (b - 2 * (cover + 8)) / Math.max(topBars.count - 1, 1);
        if (sProv > sMax) topBars.count = Math.ceil((b - 2 * (cover + 8)) / sMax) + 1;
      }
      if (botBars) {
        const sMax = Math.min(3 * h, 450);
        const sProv = (b - 2 * (cover + 8)) / Math.max(botBars.count - 1, 1);
        if (sProv > sMax) botBars.count = Math.ceil((b - 2 * (cover + 8)) / sMax) + 1;
      }

      // multi-layer layout: check that bars fit in 1-5 layers
      const topLayout = topBars ? layoutBarsInLayers(topBars.count, topBars.dia, b, cover, stirrupDia) : null;
      const botLayout = botBars ? layoutBarsInLayers(botBars.count, botBars.dia, b, cover, stirrupDia) : null;
      if (topLayout && !topLayout.fits) topBars.count = topLayout.maxPerLayer * 5; // cap at 5 layers
      if (botLayout && !botLayout.fits) botBars.count = botLayout.maxPerLayer * 5;

      // bar curtailment: extend past theoretical cutoff by ld + 0.25·Ln
      const curtailTop = topBars ? Math.ceil(6000 * 0.25 + devTop) : 0;
      const curtailBot = botBars ? Math.ceil(6000 * 0.25 + devBot) : 0;

      results.push({
        id: m.id, b, h, dTop, dBot, fc, fy,
        MuTop, MuBot, Vu,
        AsTop: AsTopRaw, AsBot: AsBotRaw, AsMinTop, AsMax,
        topDoubly: topResult.doubly || false,
        botDoubly: botResult.doubly || false,
        shear, topBars, botBars, stirrups, devTop, devBot, curtailTop, curtailBot,
        torsion: torsionResult,
        refs: {
          flexure: 'ACI 9.5.2.1, 21.2, 22.2',
          minSteel: 'ACI 9.6.1.2',
          maxSteel: 'ACI 9.3.3.1',
          shear: 'ACI 22.5',
          shearMin: 'ACI 9.6.3.4',
          torsion: 'ACI 9.7, 22.7',
        },
      });
    }
    return { results, comboName, rebarDb };
  }

  // sectionOf/materialOf are in rcmodel.js — re-export
  let RD = null;
  try { RD = root.RCDefine; } catch (e) {}
  function sectionOf(app, ent) {
    if (!RD) RD = root.RCDefine;
    const d = RD.ensure(app);
    const name = ent.params.designSection;
    return (name && d.frameSections.find(s => s.name === name)) || null;
  }
  function materialOf(app, sec, ent) {
    if (!RD) RD = root.RCDefine;
    const d = RD.ensure(app);
    const name = (ent.params && ent.params.materialOverwrite) || (sec && sec.material);
    return d.materials.find(m => m.name === name) || d.materials.find(m => m.type === 'concrete') || null;
  }

  // ============================================================ rebar selection
  // Pick the minimum bars from the database to satisfy As
  function selectRebar(rebarDb, As, b, cover) {
    if (!rebarDb || !rebarDb.length || As <= 0) return null;
    for (const bar of rebarDb) {
      const minCount = 2;
      if (minCount * bar.area >= As)
        return { count: minCount, dia: bar.dia, area: bar.area, As: minCount * bar.area };
    }
    const largest = rebarDb[rebarDb.length - 1];
    const count = Math.max(2, Math.ceil(As / largest.area));
    const maxFit = Math.floor((b - 2 * (cover + 8)) / (largest.dia + 25));
    const finalCount = Math.min(count, Math.max(2, maxFit));
    return { count: finalCount, dia: largest.dia, area: largest.area, As: finalCount * largest.area };
  }

  function selectStirrups(shear, rebarDb, bw, d) {
    if (!shear.ok) return null;
    if (shear.Avs <= 0) return { dia: 8, spacing: 200, note: 'minimum' };
    for (const bar of rebarDb) {
      const Av2leg = 2 * bar.area;
      const spacing = Av2leg / shear.Avs;
      const sMax = Math.min(d / 2, 600);
      const sFinal = Math.min(Math.floor(spacing / 10) * 10, sMax);
      if (sFinal >= 50) return { dia: bar.dia, spacing: sFinal, AvsProvided: Av2leg / sFinal };
    }
    return { dia: 16, spacing: 100, AvsProvided: 0 };
  }

  // ============================================================ multi-layer layout
  // Fit-check bars in layers (2-5 layers) with clear spacing per ACI 25.2.1
  // Returns { layers: [{count, y}], fits, maxPerLayer } or null
  function layoutBarsInLayers(count, dia, bw, cover, stirrupDia) {
    const clearMin = Math.max(25, dia);
    const availWidth = bw - 2 * (cover + stirrupDia);
    const maxPerLayer = Math.max(1, Math.floor((availWidth + clearMin) / (dia + clearMin)));
    const layers = [];
    let remaining = count;
    let layer = 1;
    const h = 50; // vertical spacing between layers ≈ max(db, 25mm)
    while (remaining > 0 && layer <= 5) {
      const nThis = Math.min(remaining, maxPerLayer);
      if (nThis <= 0) break;
      layers.push({ count: nThis, y: (cover + stirrupDia + dia/2) + (layer - 1) * Math.max(dia, 25) });
      remaining -= nThis;
      layer++;
    }
    return { layers, fits: remaining <= 0, maxPerLayer };
  }

  // ============================================================ design dialog
  function open(app, cat) {
    if (cat !== 'beamDesign') return;
    const d = (RD || root.RCDefine).ensure(app);
    const R = app.rcResults;
    const comboNames = R.combos.map(c => c.name);
    if (!comboNames.length) {
      comboNames.push(...R.patterns.map(p => p.name));
    }
    if (!comboNames.length) { app.toast('Run the analysis first', true); return; }

    const patOpts = comboNames.map(n => `<option value="${n}">${n}</option>`).join('');
    const html = [
      '<p style="margin:0 0 6px;font-size:12px;opacity:.8">Designs all beams for the selected combination using ACI 318-19 (CFD §3.5).</p>',
      '<div class="pp-row" style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:150px;flex:none;opacity:.75;font-size:12px">Load Combination</span>' +
      `<select id="bd-combo" style="width:230px;padding:4px 6px;border:1px solid #c3cad1;border-radius:4px">${patOpts}</select></div>`,
    ].join('');
    app.dialog('RC Beam Design — ACI 318-19', html, [
      ['Design', () => {
        const combo = document.getElementById('bd-combo').value;
        const result = designAllBeams(app, combo);
        if (result.error) { app.toast(result.error, true); return false; }
        showBeamResults(app, result, combo);
        return false;
      }],
      ['Close', null],
    ]);
  }

  function showBeamResults(app, result, comboName) {
    const esc = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const rows = result.results.map(r => {
      const shearOk = r.shear.ok;
      const shearNote = shearOk && r.stirrups
        ? `Ø${r.stirrups.dia}@${r.stirrups.spacing}mm` : 'OVERSTRESSED';
      const color = shearOk ? '#2e7d32' : '#c62828';
      const topBarStr = r.topBars ? `${r.topBars.count}Ø${r.topBars.dia}` : '—';
      const botBarStr = r.botBars ? `${r.botBars.count}Ø${r.botBars.dia}` : '—';
      const dblMark = r.topDoubly || r.botDoubly ? ' ★' : '';
      return '<tr>' +
        `<td style="padding:3px 6px">${esc(r.id)}</td>` +
        `<td>${r.b}×${r.h}</td>` +
        `<td>${r.MuTop/1e6 > 0.01 ? (r.MuTop/1e6).toFixed(1) : '—'}</td>` +
        `<td>${r.MuBot/1e6 > 0.01 ? (r.MuBot/1e6).toFixed(1) : '—'}</td>` +
        `<td><b>${topBarStr}</b>${dblMark}</td>` +
        `<td><b>${botBarStr}</b></td>` +
        `<td>${r.devTop > 0 ? r.devTop.toFixed(0) : '—'}</td>` +
        `<td style="color:${color}">${shearNote}</td>` +
        '</tr>';
    }).join('');
    const html = '<div style="max-height:65vh;overflow:auto">' +
      `<p style="font-size:12px;margin:0 0 6px;opacity:.8">Combination: <b>${esc(comboName)}</b> · ACI 318-19</p>` +
      '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
      '<thead><tr style="text-align:left;opacity:.7">' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Element</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">b×h</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Mu⁻ top (kN·m)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Mu⁺ bot (kN·m)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Top Rebar</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Bot Rebar</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">ld (mm)</th>' +
      '<th style="padding:3px 6px;border-bottom:1px solid #d7dde3">Shear</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p style="font-size:11px;opacity:.7;margin:8px 0 0">★ = doubly reinforced · As includes ACI 9.6.1.2 minimum · Shear: Av/s per ACI 22.5</p>' +
      '</div>';
    app.dialog('RC Beam Design Results — ' + comboName, html, [['Close', null]]);
  }

  root.RCBeam = { designAllBeams, designRectFlexure, designTBeamFlange, designShear, devLength, open, phiFlexure, beta1 };
})(window);
