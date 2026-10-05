'use strict';
// ---------------------------------------------------------------------------
// Feature: Section Planes — live cuts with section fill (SketchUp-style).
//
// A section plane is model state ({id, point, normal, enabled}) that rides
// undo/autosave/file round-trips. The renderer clips everything model-side
// (custom face shader discard + native clippingPlanes on the edge passes)
// and tints the cut interior — the fill — red; grid, sky, and selection
// overlays are never clipped. Up to four planes at once.
//
// Place: right-click a face ▸ "Add Section Plane here" (the plane takes the
// face's point + normal), or View ▸ Section Planes… for axis cuts through
// the model center and enable/flip/delete controls.
// ---------------------------------------------------------------------------
(function () {
  if (!window.Engine) return;

  function sync(app) {
    if (app.view && app.view.applySectionPlanes)
      app.view.applySectionPlanes(app.model.sectionPlanes || []);
  }

  function addPlane(app, point, normal) {
    const m = app.model;
    app.run('add section plane', mm => {
      mm.sectionPlanes.push({
        id: 'sec_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4),
        point: { ...point }, normal: { ...normal }, enabled: true,
      });
      mm.touch();
    });
    sync(app);
    app.toast('Section plane added — View ▸ Section Planes… to flip, toggle or remove');
  }

  function sectionDialog(app) {
    const m = app.model;
    const rows = (m.sectionPlanes || []).map((p, i) => {
      const on = p.enabled !== false;
      const nn = { x: p.normal.x, y: p.normal.y, z: p.normal.z };
      const ax = Math.abs(nn.x) > Math.abs(nn.y) && Math.abs(nn.x) > Math.abs(nn.z) ? 'X'
        : Math.abs(nn.y) >= Math.abs(nn.z) ? 'Y' : 'Z';
      return `<tr>
        <td>Section ${i + 1} <span class="dim">(${ax}, through ${p.point.x.toFixed(2)}, ${p.point.y.toFixed(2)}, ${p.point.z.toFixed(2)})</span></td>
        <td><button class="mini-btn" data-sec="${i}" data-act="toggle">${on ? 'Disable' : 'Enable'}</button></td>
        <td><button class="mini-btn" data-sec="${i}" data-act="flip">Flip</button></td>
        <td><button class="mini-btn" data-sec="${i}" data-act="del">Delete</button></td>
      </tr>`;
    }).join('');
    app.dialog('Section Planes', `
      <div>
        <p class="dim" style="margin-top:0">Live cuts with section fill. Up to four active planes;
        grid and overlays are never clipped.</p>
        <table class="prop-table" style="width:100%">${rows || '<tr><td class="dim">No section planes yet — right-click a face, or add an axis cut:</td></tr>'}</table>
        <div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap">
          <button class="mini-btn" data-act="addx">Horizontal cut (XY)</button>
          <button class="mini-btn" data-act="addy">Cut along YZ</button>
          <button class="mini-btn" data-act="addz">Cut along XZ</button>
        </div>
      </div>`,
      [['Close', null]]);
    requestAnimationFrame(() => {
      const body = document.querySelector('.dialog-body') || document.body;
      const c = m.bbox ? m.bbox([...m.vertices.keys()]) : null;
      const center = c ? c.center : G.v(0, 0, 0);
      body.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.sec, act = b.dataset.act;
        app.run('section plane ' + act, mm => {
          const p = mm.sectionPlanes[i];
          if (!p) return;
          if (act === 'toggle') p.enabled = p.enabled === false;
          else if (act === 'flip') { p.normal = { x: -p.normal.x, y: -p.normal.y, z: -p.normal.z }; }
          else if (act === 'del') mm.sectionPlanes.splice(i, 1);
          mm.touch();
        });
        sync(app);
        sectionDialog(app); // re-render the list
      }));
      body.querySelectorAll('[data-act^="add"]').forEach(b => b.addEventListener('click', () => {
        const n = { addx: G.v(0, 0, 1), addy: G.v(1, 0, 0), addz: G.v(0, 1, 0) }[b.dataset.act];
        addPlane(app, { ...center }, { ...n });
        sectionDialog(app);
      }));
    });
  }

  Engine.features.register({
    id: 'sectionplanes', kind: 'command', label: 'Section Planes…',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="9" width="18" height="12" rx="1"/><path d="M7 21V9l10-4v16" opacity=".5"/></svg>',
    commands: ['section planes', 'sectionplanes', 'sectionplane', 'cut plane'],
    run(app) {
      // via the View menu / command bar
      const A = app;
      if (A._sectionDialog) return A._sectionDialog();
      A._sectionDialog = () => sectionDialog(A);
      A._sectionDialog();
    },
  });

  // keep the viewport clipped after every commit / undo / redo / file open
  Engine.events.on('model:changed', () => {
    const app = Engine.app;
    if (app) sync(app);
  });
  Engine.events.on('ready', () => {
    const app = Engine.app;
    if (app) sync(app);
  });

  // expose for the app context menu
  window.SectionPlanesFeature = { addPlane, sync, sectionDialog };
})();
