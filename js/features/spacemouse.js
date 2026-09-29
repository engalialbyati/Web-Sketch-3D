'use strict';
// ---------------------------------------------------------------------------
// Feature: 3Dconnexion SpaceMouse (WebHID).
//
// Chrome/Electron only: WebHID requests the device (vendor 0x256F /
// 0x2595 — 3Dconnexion), reads the 13-byte translation/rotation reports,
// and drives orbit / pan / zoom through the View's own navigation APIs.
// Two-finger translation = pan, rotation = orbit, Z-axis push = zoom.
// View ▸ Connect 3D Mouse. Commands: spacemouse, 3dmouse.
// ---------------------------------------------------------------------------
(function () {
  if (!window.Engine) return;

  function connect(app) {
    if (!navigator.hid) { app.toast('3D mouse needs a Chromium browser (or the desktop app)', true); return; }
    navigator.hid.requestDevice({ filters: [{ vendorId: 0x256F }, { vendorId: 0x2595 }] })
      .then(devices => {
        const dev = devices[0];
        if (!dev) { app.toast('No 3D mouse selected', true); return; }
        return dev.open().then(() => attach(app, dev));
      })
      .catch(e => app.toast('3D mouse: ' + (e.message || e), true));
  }

  function attach(app, dev) {
    const view = app.view;
    let last = 0;
    dev.addEventListener('inputreport', ev => {
      if (ev.data.byteLength < 7) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      if (!last) { last = now; return; }
      last = now;
      const d = new DataView(ev.data);
      // standard SpaceMouse report: 6 × int16 LE (tx ty tz rx ry rz), scale ~±350
      const ch = i => d.getInt16(i * 2, true) / 350;
      const tx = ch(0), ty = ch(1), tz = ch(2), rx = ch(3), ry = ch(4), rz = ch(5);
      const dead = v => Math.abs(v) < 0.08 ? 0 : v;
      const [Tx, Ty, Tz, Rx, Ry, Rz] = [tx, ty, tz, rx, ry, rz].map(dead);
      if (!Tx && !Ty && !Tz && !Rx && !Ry && !Rz) return;
      const s = dt * 6;
      if (Rz) view.orbit(Rz * 120 * s, 0);
      if (Rx) view.orbit(0, -Rx * 120 * s);
      if (Ry) view.orbit(Ry * 120 * s, 0);
      // translate: X right, Y up, Z push/pull → zoom; pan in screen space
      if (Tx || Ty) view.pan(Tx * 400 * s, Ty * 400 * s);
      if (Tz) view.zoomBy(Math.pow(0.5, Tz * 3 * s));
      view.invalidate();
    });
    app.toast(`3D mouse connected: ${dev.productName || 'SpaceMouse'} — translate pans, rotate orbits, push zooms`);
  }

  Engine.features.register({
    id: 'spacemouse', kind: 'command', label: 'Connect 3D Mouse',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="3" width="6" height="10" rx="3"/><path d="M6 16l2.5-2M18 16l-2.5-2M12 17v4"/></svg>',
    commands: ['spacemouse', '3dmouse', 'connect 3d mouse'],
    run(app) { connect(app); },
  });
  window.SpaceMouseFeature = { connect };
})();
