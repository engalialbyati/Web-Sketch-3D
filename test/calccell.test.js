'use strict';
// test/calccell.test.js — calculator cells + isotropic G derivation.
// Mirrors the decompiled ETABS evidence:
//   • CSICommon/Calculator.cs — numeric edit boxes accept arithmetic
//     expressions (4700*(28)^0.5) with ^, MOD, PI, SQRT…, unit converters.
//   • aro.cs:15596 — G = E / (2·(1+ν)) recomputed on every E/ν change
//     (SetMPIsotropic takes no G).

module.exports = h => {
  const { test, ok, eq, near } = h;
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');

  const ctx = (() => {
    const sandbox = { window: {}, console, Math, setTimeout, clearTimeout };
    sandbox.window = sandbox;
    const c = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'design', 'rcdefine.js'), 'utf8'), c);
    return c;
  })();
  const RCDefine = ctx.RCDefine;
  const F = RCDefine.evalFormula;

  test('calculator cells: plain numbers pass through untouched', () => {
    near(F('200000'), 200000, 1e-9);
    near(F(' 0.3 '), 0.3, 1e-12);
    near(F('-12.5e2'), -1250, 1e-9);
  });

  test('calculator cells: arithmetic with ^ right-associative and unary minus', () => {
    near(F('4700*(28)^0.5'), 4700 * Math.sqrt(28), 1e-6); // the user's example
    near(F('2^3^2'), 512, 1e-9);
    near(F('-3^2'), -9, 1e-9);
    near(F('2*(3+4)/7'), 2, 1e-12);
  });

  test('calculator cells: functions, PI, MOD (call and infix)', () => {
    near(F('SQRT(2)'), Math.SQRT2, 1e-12);
    near(F('4700*SQRT(28)'), 4700 * Math.sqrt(28), 1e-6);
    near(F('PI'), Math.PI, 1e-12);
    near(F('MOD(10,3)'), 1, 1e-12);
    near(F('10 MOD 3'), 1, 1e-12);
    near(F('LN(EXP(1))'), 1, 1e-12);
    near(F('FACT(5)'), 120, 1e-12);
    near(F('SIN(30)'), 0.5, 1e-12);          // degrees, ETABS edit default
    near(F('ABS(2-5)'), 3, 1e-12);
  });

  test('calculator cells: CSI unit converters', () => {
    near(F('IN2MM(1)'), 25.4, 1e-9);
    near(F('FT2M(1)'), 0.3048, 1e-9);
    near(F('MM2FT(304.8)'), 1, 1e-9);
    near(F('LB2KN(1000)'), 4.4482216153, 1e-6);
    near(F('D2R(180)'), Math.PI, 1e-12);
    near(F('C2F(100)'), 212, 1e-9);
  });

  test('calculator cells: garbage is NaN, never a wrong number', () => {
    eq(isNaN(F('4*(')), true);
    eq(isNaN(F('hello')), true);
    eq(isNaN(F('')), true);
    eq(isNaN(F('1 2')), true);   // trailing garbage rejected
    eq(isNaN(F('SQRT(2) junk')), true);
    eq(isNaN(F('2**3')), true);  // no implicit-multiplication guesses
  });

  test('isotropic G is derived: G = E / (2(1+ν)) on defaults and after ensure()', () => {
    const app = { model: {} };
    const d = RCDefine.ensure(app);
    const reb = d.materials.find(x => x.name === 'REBAR500');
    near(RCDefine.matG(reb), 200000 / (2 * 1.3), 1e-6); // 76923.1
    eq(reb.iso.G === 0 || reb.iso.G > 0, true);         // stored or derived
    // explicit formula agreement on a concrete material
    const conc = d.materials.find(x => x.type === 'concrete');
    const E = RCDefine.matE(conc);
    near(RCDefine.matG(conc), E / (2 * (1 + conc.iso.u)), 1e-6);
  });

  // ---- dialog-level behavior (DOM stub mounts inside app.dialog, exactly
  // like the browser's synchronous innerHTML insertion) --------------------
  function makeDom() {
    const els = {};
    const reg = (id, o) => { els[id] = Object.assign({ _h: {}, style: {},
      classList: { contains: () => false },
      addEventListener(t, fn) { (this._h[t] ??= []).push(fn); },
      fire(t) { (this._h[t] || []).forEach(fn => fn({ target: this })); } }, o); };
    return {
      els,
      mount(html) {
        for (const k of Object.keys(els)) delete els[k];
        for (const m of html.matchAll(/<input id="([\w-]+)"[^>]*>/g)) {
          const tag = m[0];
          reg(m[1], { tagName: 'INPUT', type: /type="checkbox"/.test(tag) ? 'checkbox' : 'text',
            value: (/value="([^"]*)"/.exec(tag) || [, ''])[1], checked: / checked/.test(tag) });
        }
        for (const m of html.matchAll(/<select id="([\w-]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
          const sel = /value="([^"]*)" selected/.exec(m[2]);
          reg(m[1], { tagName: 'SELECT', value: sel ? sel[1] : '' });
        }
        for (const m of html.matchAll(/<(span|div) id="([\w-]+)"/g))
          reg(m[2], { tagName: m[1].toUpperCase(), textContent: '' });
      },
      getElementById(id) { return els[id] || null; },
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    };
  }
  function openEditor(name) {
    const dom = makeDom();
    ctx.document = dom; // install the DOM stub as the context's global
    const app = {
      model: { rcDesign: JSON.parse(JSON.stringify(RCDefine.defaultState())) },
      toast() { }, closeDialog() { },
      dialog(t, html) { dom.mount(html); },
    };
    const idx = app.model.rcDesign.materials.findIndex(x => x.name === name);
    RCDefine.materialEditor(app, app.model.rcDesign, idx);
    return dom;
  }

  test('rebar dialog: G auto-calculates and updates live when E or ν changes', () => {
    const dom = openEditor('REBAR500');
    const g = dom.els['m-g-live'];
    ok(g, 'live G span present');
    near(parseFloat(g.textContent), 76923.1, 0.2); // 200000/(2·1.3)
    dom.els['m-E'].value = '210000';
    dom.els['m-E'].fire('input');
    near(parseFloat(g.textContent), 210000 / 2.6, 0.2);
    dom.els['m-u'].value = '0.25';
    dom.els['m-u'].fire('input');
    near(parseFloat(g.textContent), 210000 / 2.5, 0.2);
  });

  test('concrete dialog: auto-E and derived G both SHOW VALUES, not just formulas', () => {
    const dom = openEditor('CONC25');
    const e = dom.els['m-Elive'], g = dom.els['m-g-live'];
    ok(e && g, 'live E and G spans present');
    near(parseFloat(e.textContent.replace('=', '')), 4700 * Math.sqrt(25), 1);   // = 23500
    near(parseFloat(g.textContent), 4700 * Math.sqrt(25) / 2.4, 1);              // ν=0.2 → 9791.7
    dom.els['m-fc'].value = '40';
    dom.els['m-fc'].fire('input');
    near(parseFloat(e.textContent.replace('=', '')), 4700 * Math.sqrt(40), 2);
    near(parseFloat(g.textContent), 4700 * Math.sqrt(40) / 2.4, 2);              // 12385.6
  });
};
