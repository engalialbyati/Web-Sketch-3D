'use strict';
// Auto-installs every family in /families at startup (objFile entries are
// fetched from this folder). Later installs via app.families.install() also
// persist to localStorage so downloaded families survive reloads.
(function () {
  const persist = () => {
    try {
      const out = [];
      for (const f of window.app.families.list) {
        if (FamilyManager.BUILT_INS.some(b => b.id === f.id)) continue;
        const { build, ...rest } = f;
        out.push(rest);
      }
      localStorage.setItem('families', JSON.stringify(out));
    } catch (e) { }
  };
  const load = () => {
    if (!window.app || !window.app.families) return;
    try { for (const f of JSON.parse(localStorage.getItem('families') || '[]')) app.families.install(JSON.stringify(f)); } catch (e) { }
    // scan the families folder (directory listing works with the dev server)
    fetch('../families/').then(r => r.ok ? r.text() : null).then(html => {
      if (!html) return;
      const names = [...html.matchAll(/href="([^"?]+\.json)"/g)].map(m => m[1]);
      return Promise.all(names.map(n => fetch('../families/' + n).then(r => r.text()).then(async t => {
        const d = JSON.parse(t);
        if (d.objFile) { d.obj = await fetch('../families/' + d.objFile).then(r => r.text()); }
        const res = app.families.install(JSON.stringify(d));
        if (typeof res === 'object') console.log('family installed:', d.id);
      })));
    }).catch(() => { });
    const origInstall = app.families.install.bind(app.families);
    app.families.install = t => { const r = origInstall(t); if (r && typeof r === 'object') persist(); return r; };
  };
  if (document.readyState === 'complete') load();
  else window.addEventListener('load', load);
})();
