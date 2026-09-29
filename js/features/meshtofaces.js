'use strict';
// ---------------------------------------------------------------------------
// Feature: Mesh → Faces — the importer payoff of the soup-fuse pass.
//
// A downloaded BlenderKit model (or any placed foreign mesh) lives beside
// the B-Rep as a Three.js group: untouchable by the kernel, and a
// flat-shaded building arrives as thousands of coplanar triangles. This
// command walks the instance's meshes in world space, welds the triangle
// soup, runs SoupFuse (plane bucketing + union-find + boundary tracing),
// and lands the result as REAL model faces in a named group — few clean
// polygons you can select, paint, push, boolean, and schedule. The foreign
// asset stays (delete it when the conversion looks right).
//
//   Tools ▸ Convert Mesh to Faces…      commands: meshtofaces, mesh to faces
// ---------------------------------------------------------------------------
(function () {
  if (!window.Engine) return;

  /** Every triangle of an Object3D subtree in world space, deduped on a
   *  0.1 µm grid; per-triangle color from the mesh's material. */
  function soupFromObject(root) {
    const positions = [], triangles = [], triAttrs = [];
    const index = new Map();
    const q = v => Math.round(v * 1e7);
    const vid = p => {
      const k = q(p.x) + ',' + q(p.y) + ',' + q(p.z);
      let i = index.get(k);
      if (i === undefined) { i = positions.length; positions.push({ x: p.x, y: p.y, z: p.z }); index.set(k, i); }
      return i;
    };
    const v = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      const pos = g.attributes && g.attributes.position;
      if (!pos) return;
      let color = null;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats[0] && mats[0].color) color = '#' + mats[0].color.getHexString();
      const emit = (a, b, c) => {
        const ia = vid(a), ib = vid(b), ic = vid(c);
        if (ia === ib || ib === ic || ia === ic) return;
        triangles.push([ia, ib, ic]);
        triAttrs.push({ color, alpha: mats[0] && mats[0].transparent ? (mats[0].opacity ?? 1) : 1 });
      };
      const P = i => v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (g.index) {
        for (let i = 0; i + 2 < g.index.count; i += 3)
          emit(P(g.index.getX(i)).clone(), P(g.index.getX(i + 1)).clone(), P(g.index.getX(i + 2)).clone());
      } else {
        for (let i = 0; i + 2 < pos.count; i += 3)
          emit(P(i).clone(), P(i + 1).clone(), P(i + 2).clone());
      }
    });
    return { positions, triangles, triAttrs };
  }

  function convert(app, rec) {
    const soup = soupFromObject(rec.object);
    if (!soup.triangles.length) { app.toast('That asset has no triangles', true); return; }
    const triIn = soup.triangles.length;
    let out = null;
    app.run('convert mesh to faces', m => {
      out = SolidOps.facesFromSoup(m, soup, (rec.name || 'Mesh') + ' (faces)');
      if (!out) throw new Error('nothing survived the fusion');
    });
    if (out)
      app.toast(`${(rec.name || 'Mesh').slice(0, 40)}: ${triIn.toLocaleString()} triangles → ${out.faces} clean faces (group "${out.name}") — the foreign asset stays; delete it when the conversion looks right`);
  }

  function dialog(app) {
    const list = (app.assets && app.assets.list ? app.assets.list() : []);
    if (!list.length) { app.toast('No imported meshes — drop a BlenderKit model first (Insert ▸ BlenderKit Assets)', true); return; }
    const rows = list.map(rec => `<tr>
      <td>${(rec.name || rec.id).slice(0, 48)}</td>
      <td class="dim">${rec.kind || 'object'}</td>
      <td><button class="mini-btn primary" data-conv="${rec.id}">Convert</button></td>
    </tr>`).join('');
    app.dialog('Convert Mesh to Faces', `
      <div>
        <p class="dim" style="margin-top:0">Imports a foreign mesh into the B-Rep as clean polygon
        faces (coplanar triangles fused, holes traced) inside a named group —
        selectable, paintable, booleanable. Flat-shaded imports collapse from
        thousands of triangles to a handful of faces.</p>
        <table class="prop-table" style="width:100%"><tr><th>Asset</th><th>Kind</th><th></th></tr>${rows}</table>
      </div>`, [['Close', null]]);
    requestAnimationFrame(() => {
      const body = document.querySelector('.dialog-body') || document.body;
      body.querySelectorAll('[data-conv]').forEach(b => b.addEventListener('click', () => {
        const rec = app.assets.get(b.dataset.conv);
        if (rec) convert(app, rec);
      }));
    });
  }

  Engine.features.register({
    id: 'meshtofaces', kind: 'command', label: 'Convert Mesh to Faces…',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 18L12 4l8 14z"/><path d="M8 18L12 11l4 7" opacity=".5"/></svg>',
    commands: ['meshtofaces', 'mesh to faces', 'convert mesh', 'import mesh faces'],
    run(app) { dialog(app); },
  });
  window.MeshToFaces = { soupFromObject, convert, dialog };
})();
