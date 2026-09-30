'use strict';
// ---------------------------------------------------------------------------
// Feature: Asset Library — a bundled, offline component tray (IngeTrazo's
// trees/figures/vehicles parity): every asset is generated as REAL kernel
// geometry (closed prisms in named groups), so library items are selectable,
// paintable, pushable and booleanable from the moment they land — no mesh
// import, no bridge, no download. Sizes are real-world; `s` scales.
//
//   Insert ▸ Asset Library…      commands: assetlib, assets, library
// ---------------------------------------------------------------------------
(function () {
  // builders are pure (G + model) so the test sandbox can exercise them;
  // only the registry/dialog wiring below needs the Engine/DOM
  // ------------------------------------------------------------- primitives
  /** A closed n-gon prism from center/height/radius — the one solid every
   *  asset is built from. Returns the face ids. */
  function prism(model, cx, cy, z0, h, radius, n, color, rot = 0, taper = 1) {
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      ring.push(G.v(cx + radius * Math.cos(a), cy + radius * Math.sin(a), z0));
    }
    const ring2 = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      ring2.push(G.v(cx + radius * taper * Math.cos(a), cy + radius * taper * Math.sin(a), z0 + h));
    }
    const ids = [];
    const mk = (pts, holes) => { const f = model.addFaceFromRings(pts, holes || [], { gid: 0, color }); if (f) ids.push(f.id); };
    mk(ring2);                       // top
    mk([...ring].reverse());         // bottom
    for (let i = 0; i < n; i++) {    // sides (quad; rings share welded verts)
      const j = (i + 1) % n;
      mk([ring[i], ring[j], ring2[j], ring2[i]]);
    }
    return ids;
  }

  function group(model, name, faceIds) {
    const g = model.createGroup({ faces: new Set(faceIds), edges: new Set() }, name);
    g.solid = true;
    return g;
  }

  // ------------------------------------------------------------- the library
  const LIB = {
    tree: {
      label: 'Tree — deciduous', h: 6, icon: '<path d="M12 22v-7"/><circle cx="12" cy="10" r="6"/>',
      build(m, s) {
        const ids = [
          ...prism(m, 0, 0, 0, 3.2 * s, 0.16 * s, 6, '#6d4c33'),
          ...prism(m, 0, 0, 2.9 * s, 3.0 * s, 1.6 * s, 10, '#3d7a3a'),
        ];
        return group(m, 'Tree', ids);
      },
    },
    conifer: {
      label: 'Tree — conifer', h: 7, icon: '<path d="M12 22v-4"/><path d="M12 2l5 7h-3l4 6H6l4-6H7z"/>',
      build(m, s) {
        const ids = [
          ...prism(m, 0, 0, 0, 1.6 * s, 0.14 * s, 6, '#5d4030'),
          ...prism(m, 0, 0, 1.4 * s, 2.0 * s, 1.5 * s, 10, '#2e5d2e'),
          ...prism(m, 0, 0, 3.1 * s, 1.7 * s, 1.15 * s, 10, '#2e5d2e'),
          ...prism(m, 0, 0, 4.5 * s, 1.4 * s, 0.8 * s, 10, '#356b35'),
        ];
        return group(m, 'Conifer', ids);
      },
    },
    person: {
      label: 'Person (1.75 m)', h: 1.75, icon: '<circle cx="12" cy="4.5" r="1.8"/><path d="M12 6.5V15M12 9l-3 2M12 9l3 2M12 15l-2.5 6M12 15l2.5 6"/>',
      build(m, s) {
        const ids = [
          ...prism(m, -0.10 * s, 0, 0, 0.90 * s, 0.075 * s, 4, '#37474f', Math.PI / 4),
          ...prism(m, 0.10 * s, 0, 0, 0.90 * s, 0.075 * s, 4, '#37474f', Math.PI / 4),
          ...prism(m, 0, 0, 0.90 * s, 0.55 * s, 0.19 * s, 4, '#c0392b', Math.PI / 4),
          ...prism(m, 0, 0, 1.45 * s, 0.27 * s, 0.11 * s, 8, '#e0b89a'),
        ];
        return group(m, 'Person', ids);
      },
    },
    car: {
      label: 'Car (4.4 × 1.8)', h: 1.45, icon: '<path d="M3 16v-3l2-4h14l2 4v3z"/><circle cx="7" cy="16" r="1.6"/><circle cx="17" cy="16" r="1.6"/>',
      build(m, s) {
        const w = 0.9 * s; // half-width
        const ids = [];
        // body: two stacked boxes (drawn as square prisms, axis-aligned)
        ids.push(...box(m, -2.2 * s, -w, 0.30 * s, 4.4 * s, w * 2, 0.55 * s, '#8e9aa5'));
        ids.push(...box(m, -1.25 * s, -w * 0.92, 0.85 * s, 2.3 * s, w * 1.84, 0.50 * s, '#4a545d'));
        for (const [x] of [[-1.45], [1.45]]) {
          ids.push(...prism(m, x * s, 0, 0, 0.68 * s, 0.30 * s, 10, '#212121', 0, 0.55));
        }
        return group(m, 'Car', ids);
      },
    },
    bench: {
      label: 'Bench (1.8 m)', h: 0.45, icon: '<path d="M3 11h18M5 11v8M19 11v8M3 11V8h18v3"/>',
      build(m, s) {
        const ids = [
          ...box(m, -0.9 * s, -0.22 * s, 0.38 * s, 1.8 * s, 0.44 * s, 0.06 * s, '#8d6e63'),
          ...box(m, -0.85 * s, -0.20 * s, 0, 0.06 * s, 0.40 * s, 0.38 * s, '#4a545d'),
          ...box(m, 0.79 * s, -0.20 * s, 0, 0.06 * s, 0.40 * s, 0.38 * s, '#4a545d'),
          ...box(m, -0.8 * s, 0.15 * s, 0.44 * s, 1.6 * s, 0.06 * s, 0.40 * s, '#8d6e63'),
        ];
        return group(m, 'Bench', ids);
      },
    },
    lamp: {
      label: 'Street light (5 m)', h: 5, icon: '<path d="M8 22V6a4 4 0 018 0v2"/><path d="M16 4h4"/>',
      build(m, s) {
        const ids = [
          ...prism(m, 0, 0, 0, 4.6 * s, 0.07 * s, 8, '#546e7a'),
          ...box(m, -0.12 * s, -0.10 * s, 4.6 * s, 0.9 * s, 0.20 * s, 0.14 * s, '#546e7a'),
          ...box(m, 0.55 * s, -0.10 * s, 4.42 * s, 0.25 * s, 0.20 * s, 0.10 * s, '#fff2b0'),
        ];
        return group(m, 'Street light', ids);
      },
    },
    bollard: {
      label: 'Bollard', h: 0.9, icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4"/>',
      build(m, s) {
        return group(m, 'Bollard', prism(m, 0, 0, 0, 0.9 * s, 0.09 * s, 12, '#37474f', 0, 1.15));
      },
    },
  };

  /** Axis-aligned closed box (the prism's square cousin). */
  function box(m, x0, y0, z0, sx, sy, sz, color) {
    const X = x0 + sx, Y = y0 + sy, Z = z0 + sz;
    const P = (x, y, z) => G.v(x, y, z);
    const quads = [
      [P(x0, y0, z0), P(x0, Y, z0), P(X, Y, z0), P(X, y0, z0)],
      [P(x0, y0, Z), P(X, y0, Z), P(X, Y, Z), P(x0, Y, Z)],
      [P(x0, y0, z0), P(X, y0, z0), P(X, y0, Z), P(x0, y0, Z)],
      [P(X, y0, z0), P(X, Y, z0), P(X, Y, Z), P(X, y0, Z)],
      [P(X, Y, z0), P(x0, Y, z0), P(x0, Y, Z), P(X, Y, Z)],
      [P(x0, Y, z0), P(x0, y0, z0), P(x0, y0, Z), P(x0, Y, Z)],
    ];
    return quads.map(q => m.addFaceFromRings(q, [], { gid: 0, color }).id);
  }

  // ------------------------------------------------------------- the dialog
  function dialog(app) {
    const sizeId = 'asset-size';
    const cards = Object.entries(LIB).map(([id, a]) => `
      <div style="text-align:center; min-width:110px">
        <button class="mini-btn" data-asset="${id}" style="width:104px;height:76px;display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6">${a.icon}</svg>
        </button>
        <div style="font-size:11px;margin-top:4px">${a.label}</div>
      </div>`).join('');
    app.dialog('Asset Library — bundled, offline, real geometry', `
      <div>
        <p class="dim" style="margin-top:0">Every item is built as real kernel faces in a named group —
        selectable, paintable, pushable, booleanable. Real-world sizes; the
        scale multiplies them. BlenderKit (Insert ribbon) remains the online
        library.</p>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px">${cards}</div>
        <div style="margin:6px 0">
          <span class="dim">Imported models (CC BY / CC0 — credits in assets/components/CREDITS.md):</span><br>
          ${window.ComponentsFeature ? ComponentsFeature.dialogSection() : ''}
        </div>
        ${window.OnlineLib ? OnlineLib.section() : ''}
        <div style="display:flex;gap:6px;align-items:center">
          Scale <input id="${sizeId}" type="number" value="1" min="0.1" step="0.1" style="width:64px">
          <span class="dim">× real-world size · lands at the view's ground center — Move (M) to place</span>
        </div>
      </div>`, [['Close', null]]);
    // wire on the next frame, or a timeout when the tab is backgrounded and
    // frames never come (rAF stalls in non-rendering tabs) — idempotent
    let wired = false;
    const wire = () => {
      if (wired) return;
      wired = true;
      const body = document.querySelector('.dialog-body') || document.body;
      if (window.ComponentsFeature) ComponentsFeature.wire(app, body);
      if (window.OnlineLib) OnlineLib.wire(app, body);
      body.querySelectorAll('[data-asset]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.asset;
        const s = Math.max(0.1, parseFloat((body.querySelector('#' + sizeId) || {}).value) || 1);
        const a = LIB[id];
        // footprint stand-ins for the wireframe ghost (real-world sizes × scale)
        const FOOT = { tree: [0.55, 0.55], conifer: [0.7, 0.7], person: [0.55, 0.4], car: [4.4, 1.8], bench: [1.8, 0.55], lamp: [0.35, 0.35], bollard: [0.25, 0.25] };
        const [w, d] = (FOOT[id] || [0.6, 0.6]).map(v => v * s);
        // arm click-to-place: the ghost follows the cursor, the next
        // viewport click builds the real geometry at that ground point
        app.armAssetPlacement({
          label: a.label,
          size: { w, d, h: (a.h || 1) * s },
          place: (x, y) => {
            let gid = null;
            app.run('place asset', m => {
              // isolation: the asset welds to itself, never into a host element
              const g = m.isolate(() => a.build(m, s));
              const vids = new Set();
              for (const fid of m.groupEntities(g.id).faces) {
                const f = m.faces.get(fid);
                if (!f) continue;
                // island stamp — the asset is its own element under the
                // independence contract from the moment it lands
                (f.userData || (f.userData = {})).assetGid = 'asset:' + g.id;
                for (const ring of m.rings(f)) for (const vi of ring) vids.add(vi);
              }
              m.transformVertices([...vids], p => ({ x: p.x + x, y: p.y + y, z: p.z }));
              m.touch();
              gid = g.id;
            });
            app.selectGroup(gid);
            app.toast(`${a.label} placed at (${x.toFixed(1)}, ${y.toFixed(1)})`);
          },
        });
      }));
    };
    if (typeof requestAnimationFrame === 'function') {
      let fired = false;
      requestAnimationFrame(() => { fired = true; wire(); });
      setTimeout(() => { if (!fired) wire(); }, 300); // background tab fallback
    } else setTimeout(wire, 0);
  }

  window.AssetLib = { LIB, prism, box, dialog };
  if (!window.Engine) return;
  Engine.features.register({
    id: 'assetlib', kind: 'command', label: 'Asset Library…',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 19l2-9h12l2 9z"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>',
    commands: ['assetlib', 'asset library', 'library', 'components'],
    run(app) { dialog(app); },
  });
})();
