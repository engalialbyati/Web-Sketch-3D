'use strict';
// ---------------------------------------------------------------------------
// Feature: Imported Components — the CC-BY/CC0 model set (see
// assets/components/CREDITS.md), placed from the Asset Library dialog.
//
// Light models (few fused faces) land as REAL kernel geometry through the
// soup-fuse pipeline — editable, booleanable, schedulable. Dense organic
// meshes (nothing coplanar to fuse — the 15k-face figure) land as foreign
// Three.js objects registered like BlenderKit assets: fast, movable,
// never bloating undo snapshots.
//
// The build-from-faces core is pure (G + THREE optional) so the headless
// suite exercises it.
// ---------------------------------------------------------------------------
(function () {

  const MANIFEST = [
    { file: 'banco.json', label: 'Park bench', credit: 'Kator Legaz · CC BY 4.0' },
    { file: 'fuente.json', label: 'Fountain', credit: 'Pndrdm & Puybaret · CC BY 4.0' },
    { file: 'pickup.json', label: 'Pickup truck', credit: 'Scopia · CC BY 4.0' },
    { file: 'suv.json', label: 'SUV', credit: 'Scopia · CC BY 4.0' },
    { file: 'sofa.json', label: 'Sofa', credit: 'Blend Swap · CC0' },
    { file: 'chica.json', label: 'Standing woman (dense mesh)', credit: 'Reallusion · CC BY 4.0', dense: true },
  ];
  const KERNEL_FACE_LIMIT = 600;

  /** Component faces → triangle soup. Pure; triangulates each polygon in
   *  its own plane (THREE.ShapeUtils when present, convex fan otherwise),
   *  welds on a 0.1 µm grid, carries per-face color. */
  function buildSoup(comp) {
    const positions = [], triangles = [], triAttrs = [];
    const index = new Map();
    const q = v => Math.round(v * 1e7);
    const vid = p => {
      const k = q(p[0]) + ',' + q(p[1]) + ',' + q(p[2]);
      let i = index.get(k);
      if (i === undefined) { i = positions.length; positions.push({ x: p[0], y: p[1], z: p[2] }); index.set(k, i); }
      return i;
    };
    const hex = c => c ? '#' + c.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('') : null;
    for (const f of comp.faces) {
      const pts = f.v;
      if (!pts || pts.length < 3) continue;
      const p3 = pts.map(p => ({ x: p[0], y: p[1], z: p[2] }));
      const n = G.loopNormal(p3);
      if (G.isZero(n)) continue;
      const { u, v } = G.basisForNormal(n);
      const o = p3[0];
      const t2 = p => ({ x: (p.x - o.x) * u.x + (p.y - o.y) * u.y + (p.z - o.z) * u.z, y: (p.x - o.x) * v.x + (p.y - o.y) * v.y + (p.z - o.z) * v.z });
      const from2 = p => { const P = [o.x + p.x * u.x + p.y * v.x, o.y + p.x * u.y + p.y * v.y, o.z + p.x * u.z + p.y * v.z]; return P; };
      const outer2 = p3.map(t2);
      let tris = null;
      if (typeof THREE !== 'undefined' && THREE.ShapeUtils && THREE.ShapeUtils.triangulateShape) {
        try { tris = THREE.ShapeUtils.triangulateShape(outer2, []); } catch (e) { tris = null; }
      }
      if (!tris) { tris = []; for (let i = 1; i + 1 < outer2.length; i++) tris.push([0, i, i + 1]); }
      const attrs = { color: hex(f.c), alpha: 1 };
      for (const t of tris) {
        const ids = t.map(ti => vid(from2(outer2[ti])));
        if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
        triangles.push(ids);
        triAttrs.push(attrs);
      }
    }
    return { positions, triangles, triAttrs };
  }

  /** A dense component as a foreign Three.js group (vertex-colored mesh). */
  function foreignObject(soup) {
    const P = soup.positions;
    const pos = new Float32Array(soup.triangles.length * 9);
    const col = new Float32Array(soup.triangles.length * 9);
    const cv = new THREE.Color();
    soup.triangles.forEach((t, i) => {
      const a = { color: soup.triAttrs[i] ? soup.triAttrs[i].color : null };
      cv.set(a.color || '#b9bcc0');
      t.forEach((vi, k) => {
        const p = P[vi];
        pos[i * 9 + k * 3] = p.x; pos[i * 9 + k * 3 + 1] = p.y; pos[i * 9 + k * 3 + 2] = p.z;
        col[i * 9 + k * 3] = cv.r; col[i * 9 + k * 3 + 1] = cv.g; col[i * 9 + k * 3 + 2] = cv.b;
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const grp = new THREE.Group();
    grp.add(mesh);
    return grp;
  }

  /** Place a fetched component at (x, y). Returns a result descriptor. */
  function place(app, comp, x, y, opts = {}) {
    return placeSoup(app, buildSoup(comp), comp.name, x, y, opts);
  }

  /** A fused model earns the kernel path only when it builds a CLEAN B-rep.
   *  Some light fuses are pinched — glass panes sharing an edge, coincident
   *  shells — rings that visit a vertex twice or 4-fold edges (46 of the
   *  925 catalogue models are this shape). Placing those as kernel faces
   *  poisons the model, so the probe builds the fusion once in a throwaway
   *  model and validates; anything imperfect places as a foreign mesh. */
  function kernelProbeOk(soup) {
    const M = (typeof window !== 'undefined' && window.Model) || (typeof Model !== 'undefined' ? Model : null);
    if (!M) return true; // no probe available — keep the size-only rule
    try {
      const probe = new M();
      const g = SolidOps.facesFromSoup(probe, { positions: soup.positions, triangles: soup.triangles, triAttrs: soup.triAttrs }, 'probe');
      return !!g && probe.validate().ok;
    } catch (e) { return false; }
  }

  /** Place any triangle soup (welded indices, per-tri color attrs) through
   *  the dual path — the shared entry the imported models and the online
   *  catalogue both use. Light models fuse into kernel geometry inside an
   *  isolation scope (asset island), dense ones become foreign meshes. */
  function placeSoup(app, soup, name, x, y, opts = {}) {
    if (!soup || !soup.triangles || !soup.triangles.length) return { ok: false, error: 'no triangles' };
    if (opts.forceForeign) return placeForeignSoup(app, soup, name, x, y);
    // probe the fusion cheaply: fusing is O(n) — try, and if it stays dense,
    // fall back to the foreign path (the soup is unchanged by fuse)
    const fused = SoupFuse.fuse({ positions: soup.positions, triangles: soup.triangles.map(t => t.slice()), triAttrs: soup.triAttrs });
    if (fused.length > KERNEL_FACE_LIMIT || !kernelProbeOk(soup)) return placeForeignSoup(app, soup, name, x, y);
    let gid = null;
    app.run('place component', m => {
      // isolation: the fused model welds to itself, never into a host element
      const g = m.isolate(() => SolidOps.facesFromSoup(m, { positions: soup.positions, triangles: soup.triangles, triAttrs: soup.triAttrs }, name));
      if (!g) throw new Error('fusion produced nothing');
      const vids = new Set();
      for (const fid of m.groupEntities(g.gid).faces) {
        const f = m.faces.get(fid);
        if (!f) continue;
        // island stamp — its own element under the independence contract
        (f.userData || (f.userData = {})).assetGid = 'asset:' + g.gid;
        for (const ring of m.rings(f)) for (const vi of ring) vids.add(vi);
      }
      m.transformVertices([...vids], p => ({ x: p.x + x, y: p.y + y, z: p.z }));
      m.touch();
      gid = g.gid;
    });
    app.selectGroup(gid);
    return { ok: true, mode: 'kernel', gid, faces: fused.length, triangles: soup.triangles.length, name };
  }

  function placeForeignSoup(app, soup, name, x, y) {
    const grp = foreignObject(soup);
    grp.position.set(x, y, 0);
    const size = new THREE.Box3().setFromObject(grp).getSize(new THREE.Vector3());
    const rec = app.assets._instantiate('component:' + name, name, 'object', { scene: grp, size: { x: size.x, y: size.y, z: size.z } });
    app.view.invalidate();
    return { ok: true, mode: 'foreign', recId: rec.id, triangles: soup.triangles.length, name };
  }

  // ------------------------------------------------------------ dialog hook
  function dialogSection() {
    return MANIFEST.map(c => `<button class="mini-btn" data-comp="${c.file}" title="${c.credit} — ${c.file}">${c.label}</button>`).join(' ');
  }

  function wire(app, body, rerender) {
    body.querySelectorAll('[data-comp]').forEach(b => b.addEventListener('click', () => {
      const def = MANIFEST.find(c => c.file === b.dataset.comp);
      if (!def) return;
      app.setStatus('Loading ' + def.label + '…');
      fetch('assets/components/' + def.file)
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(comp => {
          app.setStatus('');
          // arm click-to-place: the real mesh as the ghost, the next
          // viewport click places it at that ground point
          const soup = buildSoup(comp);
          app.armAssetPlacement({
            label: def.label,
            ghost: foreignObject(soup),
            place: (x, y) => {
              const res = placeSoup(app, soup, def.label + ' (' + def.credit + ')', x, y, { forceForeign: !!def.dense });
              if (!res.ok) { app.toast('Could not place ' + def.label, true); return; }
              app.toast(res.mode === 'kernel'
                ? `${def.label}: ${res.triangles.toLocaleString()} triangles → ${res.faces} kernel faces (editable solid) — ${def.credit}`
                : `${def.label}: dense mesh placed as a foreign object (${res.triangles.toLocaleString()} triangles) — ${def.credit}`);
            },
          });
        })
        .catch(e => app.toast('Component files need the served app or desktop build — ' + (e.message || e), true));
    }));
  }

  window.ComponentsFeature = { MANIFEST, buildSoup, place, placeSoup, kernelProbeOk, foreignObject, dialogSection, wire, KERNEL_FACE_LIMIT };
})();
