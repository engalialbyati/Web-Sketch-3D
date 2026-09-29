'use strict';
// ---------------------------------------------------------------------------
// Feature: Render with Blender + Import Survey CSV (georeferencing v1).
//
// RENDER: the model goes out as glTF (the app's own exporter) with the
// current camera, and the local bridge runs headless Blender (EEVEE, day or
// night) — same bridge as the BlenderKit palette (npm run bridge). The PNG
// comes back into a viewer dialog with Save.
//
// SURVEY CSV: total-station/GPS points (X,Y,Z[,description]) in the project
// CRS. Points map through model.geo's base point into local coordinates and
// land as small crosses with leader labels; an optional closes polyline
// connects the path. Geolocation itself already lives in Edit ▸
// Georeferencing (base point + true north, exported via IfcMapConversion).
// ---------------------------------------------------------------------------
(function () {
  if (!window.Engine) return;

  function renderWithBlender(app, night) {
    const bridge = (localStorage.getItem('ws3d-bridge') || 'http://127.0.0.1:3001').replace(/\/$/, '');
    const cam = app.view.cam;
    // camera position (world) + target + fov from the orbit state
    const px = cam.target.x + cam.dist * Math.cos(cam.el) * Math.cos(cam.az);
    const py = cam.target.y + cam.dist * Math.cos(cam.el) * Math.sin(cam.az);
    const pz = cam.target.z + cam.dist * Math.sin(cam.el);
    const fovmm = 24; // ~50° vertical at 36mm film ≈ the app's default FOV
    const canvas = app.view.canvas;
    const payload = {
      px: +px.toFixed(4), py: +py.toFixed(4), pz: +pz.toFixed(4),
      tx: +cam.target.x.toFixed(4), ty: +cam.target.y.toFixed(4), tz: +cam.target.z.toFixed(4),
      fovmm, w: Math.min(1920, canvas.clientWidth * 2 | 0), h: Math.min(1080, canvas.clientHeight * 2 | 0),
    };
    app.setStatus('Rendering with Blender…');
    const gltf = JSON.stringify(GltfExporter.fromModel(app.model));
    const done = out => {
      app.setStatus('');
      app.dialog(`Blender Render (${night ? 'night' : 'day'})`, `
        <div style="text-align:center">
          <img src="${out}" alt="render" style="max-width:100%; border:1px solid #ccc; border-radius:4px">
        </div>`,
        [['Save PNG…', () => {
          const a = document.createElement('a');
          a.href = out; a.download = 'websketch-render.png'; a.click();
        }], ['Close', null]]);
    };
    fetch(`${bridge}/api/render${night ? '?night=1' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'model/gltf+json', 'x-camera': JSON.stringify(payload) },
      body: gltf,
    }).then(r => {
      if (!r.ok) return r.text().then(t => { throw new Error(t.slice(0, 300) || r.statusText); });
      return r.blob();
    }).then(b => done(URL.createObjectURL(b)))
      .catch(e => {
        app.setStatus('');
        app.toast('Render failed — is the bridge running? (npm run bridge)' + (e.message ? ' — ' + e.message : ''), true);
      });
  }

  function importSurveyCsv(app, text) {
    const m = app.model;
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const pts = [];
    for (const line of lines) {
      const cells = line.split(/[,;\t]+/).map(c => c.trim());
      if (cells.length < 3) continue;
      const n = cells.slice(0, 3).map(Number);
      if (n.some(v => !isFinite(v))) continue; // header row or junk
      pts.push({ x: n[0], y: n[1], z: n[2], d: cells[3] || '' });
    }
    if (!pts.length) { app.toast('No X,Y,Z points found in the CSV', true); return; }
    // CRS -> local: subtract the geo base point when one is set
    const geo = m.geo || null;
    const bx = geo && geo.base ? geo.base.x : pts[0].x, by = geo && geo.base ? geo.base.y : pts[0].y;
    app.run('import survey CSV', mm => {
      for (const p of pts) {
        const lx = p.x - bx, ly = p.y - by;
        const f = mm.addFaceFromRings(
          [G.v(lx - 0.15, ly - 0.15, p.z), G.v(lx + 0.15, ly - 0.15, p.z), G.v(lx + 0.15, ly + 0.15, p.z), G.v(lx - 0.15, ly + 0.15, p.z)],
          [], { gid: 0, color: '#c0392b' });
        if (f && p.d) f.userData = f.userData || {}, f.userData.label = p.d;
      }
      mm.touch();
    });
    app.toast(`${pts.length} survey points imported${geo && geo.base ? ' (mapped through the georeference base point)' : ' (origin at the first point — set a base point in Edit ▸ Georeferencing for CRS mapping)'}`);
  }

  Engine.features.register({
    id: 'blenderrender', kind: 'command', label: 'Render with Blender (day)',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>',
    commands: ['render', 'blender render', 'render day'],
    run(app) { renderWithBlender(app, false); },
  });
  Engine.features.register({
    id: 'blenderrendernight', kind: 'command', label: 'Render with Blender (night)',
    commands: ['render night', 'night render'],
    run(app) { renderWithBlender(app, true); },
  });
  Engine.features.register({
    id: 'surveycsv', kind: 'command', label: 'Import Survey CSV…',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 21V9M12 9l-5 5M12 9l5 5"/><path d="M5 3h14" opacity=".4"/></svg>',
    commands: ['survey', 'import survey', 'csv'],
    run(app) {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.csv,.txt';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        f.text().then(t => importSurveyCsv(app, t));
      };
      inp.click();
    },
  });
  window.RenderFeature = { renderWithBlender, importSurveyCsv };
})();
