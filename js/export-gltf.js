'use strict';
// ---------------------------------------------------------------------------
// export-gltf.js — glTF 2.0 scene writer (pure: model in, gltf JSON out).
//
// Rendering-engine handoff: faces are triangulated exactly as the viewport
// renders them (same loop-normal + in-plane basis + ShapeUtils path in the
// browser; a convex fan fallback keeps the module node-testable), per-face
// colors become PBR base-color materials, alpha < 1 becomes BLEND mode.
// Softened (hidden) edges and hidden faces are simply never written —
// they are display state, not geometry, so lighting and materials are
// unaffected. The app is Z-up (SketchUp); glTF is Y-up, so a root node
// carries the -90° X rotation. Units are meters (glTF native).
// ---------------------------------------------------------------------------
(function (root) {

  // Triangulate one face's outer loop (+ holes) in its own plane. Uses
  // THREE.ShapeUtils when present (browser — identical to the viewport);
  // otherwise a fan, correct for convex rings (unit tests use boxes).
  function triangulate(outer2D, holes2D) {
    if (root.THREE && THREE.ShapeUtils && THREE.ShapeUtils.triangulateShape) {
      try {
        const t = THREE.ShapeUtils.triangulateShape(
          outer2D.map(p => ({ x: p.x, y: p.y })), holes2D.map(h => h.map(p => ({ x: p.x, y: p.y }))));
        if (t && t.length) return t.map(tri => [tri[0], tri[1], tri[2]]);
      } catch (e) { /* fall through to fan */ }
    }
    if (holes2D && holes2D.length) return []; // concave-with-holes needs THREE
    const out = [];
    for (let i = 1; i + 1 < outer2D.length; i++) out.push([0, i, i + 1]);
    return out;
  }

  function hexToRgb(hex) {
    if (!hex) return null;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(bytes) {
    if (root.btoa) {
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
      return btoa(s);
    }
    if (typeof Buffer !== 'undefined' && Buffer.from) return Buffer.from(bytes).toString('base64');
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
      out += (b1 == null) ? '==' : B64[((b1 & 15) << 2) | ((b2 || 0) >> 6)];
      out += (b2 == null) ? '=' : B64[b2 & 63];
    }
    return out;
  }

  const GltfExporter = {
    /** Build a complete glTF 2.0 asset from the model. */
    fromModel(model) {
      // 1) triangulate every visible face, grouped by material key
      const groups = new Map(); // key -> {positions:[], normals:[], indices:[], color, alpha, tris}
      for (const f of model.faces.values()) {
        if (f.hidden) continue;
        const outer = model.pts(f.loop);
        if (outer.length < 3) continue;
        const n = G.loopNormal(outer);
        if (G.isZero(n)) continue;
        const { u, v } = G.basisForNormal(n);
        const o = outer[0];
        const t2 = p => ({ x: (p.x - o.x) * u.x + (p.y - o.y) * u.y + (p.z - o.z) * u.z,
          y: (p.x - o.x) * v.x + (p.y - o.y) * v.y + (p.z - o.z) * v.z });
        const tris = triangulate(outer.map(t2), (f.holes || []).map(h => model.pts(h).map(t2)));
        if (!tris.length) continue;
        const rgb = hexToRgb(f.color) || { r: 0.78, g: 0.78, b: 0.8 };
        const alpha = f.alpha == null ? 1 : f.alpha;
        const key = f.color + '|' + alpha;
        let g = groups.get(key);
        if (!g) { g = { positions: [], normals: [], indices: [], rgb, alpha, tris: 0 }; groups.set(key, g); }
        const base = g.positions.length / 3;
        const all = outer.concat((f.holes || []).flatMap(h => model.pts(h)));
        for (const p of all) { g.positions.push(p.x, p.y, p.z); g.normals.push(n.x, n.y, n.z); }
        for (const t of tris) { g.indices.push(base + t[0], base + t[1], base + t[2]); g.tris++; }
      }

      // 2) one binary buffer: positions, normals, indices per group
      const buffers = [];
      const bufferViews = [];
      const accessors = [];
      const primitives = [];
      let byteLen = 0;
      const pushView = (arr, target) => {
        const bytes = new Uint8Array(arr.buffer);
        while (byteLen % 4) { byteLen++; } // 4-byte alignment
        const view = { buffer: 0, byteOffset: byteLen, byteLength: bytes.byteLength, target };
        if (target === 34963) { view.byteOffset = byteLen; } // ELEMENT_ARRAY
        bufferViews.push(view);
        byteLen += bytes.byteLength;
        buffers.push(bytes);
        return bufferViews.length - 1;
      };
      let posMin = [Infinity, Infinity, Infinity], posMax = [-Infinity, -Infinity, -Infinity];
      const groupsArr = [...groups.values()];
      groupsArr.forEach((g, gi) => {
        for (let i = 0; i < g.positions.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            const c = g.positions[i + k];
            posMin[k] = Math.min(posMin[k], c); posMax[k] = Math.max(posMax[k], c);
          }
        }
        const pv = pushView(new Float32Array(g.positions), 34962);
        const nv = pushView(new Float32Array(g.normals), 34962);
        const iv = pushView(new Uint32Array(g.indices), 34963);
        const pa = accessors.push({ bufferView: pv, componentType: 5126, count: g.positions.length / 3, type: 'VEC3', min: [...posMin], max: [...posMax] }) - 1;
        const na = accessors.push({ bufferView: nv, componentType: 5126, count: g.normals.length / 3, type: 'VEC3' }) - 1;
        const ia = accessors.push({ bufferView: iv, componentType: 5125, count: g.indices.length, type: 'SCALAR' }) - 1;
        primitives.push({
          attributes: { POSITION: pa, NORMAL: na },
          indices: ia,
          material: gi,
          mode: 4,
          _triCount: g.tris,
        });
      });

      // 3) concatenate + base64-embed (btoa -> Buffer -> pure JS fallback,
      //    so the module runs in browser, node, and the test sandbox alike)
      const bin = new Uint8Array(byteLen);
      let off = 0;
      for (const chunk of buffers) {
        while (off % 4) off++;
        bin.set(chunk, off);
        off += chunk.byteLength;
      }
      const uri = 'data:application/octet-stream;base64,' + base64(bin);

      const materials = groupsArr.map(g => ({
        pbrMetallicRoughness: { baseColorFactor: [g.rgb.r, g.rgb.g, g.rgb.b, g.alpha], metallicFactor: 0, roughnessFactor: 0.9 },
        alphaMode: g.alpha < 1 ? 'BLEND' : 'OPAQUE',
        doubleSided: true,
      }));

      return {
        asset: { version: '2.0', generator: 'WebSketch 3D' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: 'WebSketch model', rotation: [-0.7071067811865476, 0, 0, 0.7071067811865476] }], // Z-up -> Y-up
        meshes: [{ name: 'Model', primitives }],
        materials,
        accessors,
        bufferViews,
        buffers: [{ byteLength: byteLen, uri }],
      };
    },
  };

  root.GltfExporter = GltfExporter;
})(typeof window !== 'undefined' ? window : globalThis);
