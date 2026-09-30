'use strict';
// ---------------------------------------------------------------------------
// Feature: Online Component Library — the IngeTrazo/Sweet Home 3D catalogue
// (ingetrazo.com/biblioteca: ~1500 models) browsed from the Asset Library
// dialog and placed through the same dual-path importer as the bundled
// components (kernel geometry when it fuses, foreign mesh when dense).
//
// LICENSING drives everything here: the index carries license + author per
// model, and only CC BY 4.0 / CC0 entries are shown (585 Free-Art-License
// models are copyleft and stay hidden — same call as the bundled trees).
// The credit is displayed on the card, toasted at placement, and kept in
// the placed object's name so it travels with the drawing.
//
// The catalogue sends no CORS headers, so everything goes through the local
// bridge (`npm run bridge`): /api/library/{index,thumb,model}, which caches
// to disk — offline after first use, like their desktop tray.
//
// The OBJ/MTL parser, the catalogue transform (rotate → fit-to-declared-size
// → cm→m → stand up) and the zip reader are pure and headless-testable.
// ---------------------------------------------------------------------------
(function () {
  const BRIDGE = ((typeof window !== 'undefined' && window.BLENDERKIT_BRIDGE_URL) || 'http://localhost:3001').replace(/\/$/, '');
  const USABLE = { 'CC-BY-4.0': 'CC BY 4.0', 'CC0-1.0': 'CC0 1.0' };
  const PAGE = 48;
  // The catalogue is indexed in Spanish; the UI is English. Model names use
  // nombre_en when the index carries one; categories translate through this
  // table (unknown ones pass through untouched).
  const CAT_EN = {
    'Cocina': 'Kitchen', 'Cuarto de Baño': 'Bathroom', 'Dormitorio': 'Bedroom',
    'Escaleras': 'Stairs', 'Exterior': 'Outdoor', 'Iluminación': 'Lighting',
    'Oficina': 'Office', 'Personajes': 'People', 'Puertas y Ventanas': 'Doors & Windows',
    'Salón': 'Living room', 'Varios': 'Miscellaneous', 'Vehículos': 'Vehicles',
  };
  const catEn = c => CAT_EN[c] || c;
  // The Doors & Windows category inserts as hosted ELEMENTS: the model's own
  // rectangular border sizes the opening (width × height, cm-rounded,
  // clamped sane), the model fits inside it, and the wall gets a real cut.
  const DW_CATEGORY = 'Puertas y Ventanas';
  /** Opening spec from a model's bbox for a hosted insert. Pure. */
  function hostedSpec(mode, size) {
    const width = Math.max(0.3, Math.min(5, Math.round((size.x || 1) * 100) / 100));
    const height = Math.max(0.3, Math.min(5, Math.round((size.z || 1) * 100) / 100));
    return { width, height, sill: mode === 'window' ? 0.9 : 0 };
  }

  // ------------------------------------------------------------- pure: MTL/OBJ
  /** newmtl name → Kd [r,g,b] (null when the material states no diffuse). */
  function parseMTL(text) {
    const out = {};
    let cur = null;
    for (const line of String(text).split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] === 'newmtl' && t[1]) { cur = t[1]; if (!(cur in out)) out[cur] = null; }
      else if (t[0] === 'Kd' && cur && t.length >= 4) {
        const kd = [parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3])];
        if (kd.every(isFinite)) out[cur] = kd;
      }
    }
    return out;
  }

  /** Wavefront OBJ → welded triangle soup (our standard shape). Handles
   *  v, f with v / v/vt / v/vt/vn / //vn tokens and negative indices,
   *  fan-triangulates n-gons, carries the active usemtl's Kd per triangle,
   *  and keeps ONLY face-referenced vertices — catalogue files carry strays
   *  no face uses, and sizing to those lands the model at half scale. */
  function parseOBJ(text, mtl) {
    const v = [], tris = [], attrs = [];
    let kd = null;
    for (const line of String(text).split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] === 'v' && t.length >= 4) {
        const p = [+t[1], +t[2], +t[3]];
        if (p.every(isFinite)) v.push(p);
      } else if (t[0] === 'usemtl') {
        kd = (mtl && t[1] in mtl) ? mtl[t[1]] : null;
      } else if (t[0] === 'f' && t.length >= 4) {
        const idx = [];
        for (let k = 1; k < t.length; k++) {
          let raw = parseInt(t[k].split('/')[0], 10);
          if (!isFinite(raw)) continue;
          if (raw < 0) raw = v.length + raw + 1; // OBJ negative = from the end
          if (raw >= 1 && raw <= v.length) idx.push(raw - 1);
        }
        for (let i = 1; i + 1 < idx.length; i++) { // fan; skips degenerates
          const [a, b, c] = [idx[0], idx[i], idx[i + 1]];
          if (a !== b && b !== c && a !== c) { tris.push([a, b, c]); attrs.push(kd); }
        }
      }
    }
    // remap onto face-used vertices (drops strays, compacts the soup)
    const remap = new Map(), positions = [];
    for (const tri of tris) for (let i = 0; i < 3; i++) {
      let m = remap.get(tri[i]);
      if (m === undefined) {
        m = positions.length;
        remap.set(tri[i], m);
        positions.push({ x: v[tri[i]][0], y: v[tri[i]][1], z: v[tri[i]][2] });
      }
      tri[i] = m;
    }
    const hex = c => c ? '#' + c.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('') : null;
    return { positions, triangles: tris, triAttrs: attrs.map(c => ({ color: hex(c), alpha: 1 })) };
  }

  // ------------------------------------------------- pure: catalogue transform
  // A catalogue OBJ is Y-up and in arbitrary units; the index entry is the
  // truth. Same pipeline IngeTrazo's tray runs: rotate by the entry's 3×3
  // (row-major), stretch axis-wise to the declared cm [w, d, h], /100 to
  // meters, stand up ((x,y,z) → (x,−z,y)), ground at z=0, XY-center.
  function transformSoup(entry, soup) {
    const cm = (entry.cm || []).map(Number);
    let rot = (entry.rot || []).map(Number);
    if (rot.length !== 9 || !rot.every(isFinite)) rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const P = soup.positions;
    const rotP = p => ({
      x: rot[0] * p.x + rot[1] * p.y + rot[2] * p.z,
      y: rot[3] * p.x + rot[4] * p.y + rot[5] * p.z,
      z: rot[6] * p.x + rot[7] * p.y + rot[8] * p.z,
    });
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const rp = P.map(rotP);
    for (const p of rp) for (let a = 0; a < 3; a++) {
      if (p[a === 0 ? 'x' : a === 1 ? 'y' : 'z'] < lo[a]) lo[a] = p[a === 0 ? 'x' : a === 1 ? 'y' : 'z'];
      if (p[a === 0 ? 'x' : a === 1 ? 'y' : 'z'] > hi[a]) hi[a] = p[a === 0 ? 'x' : a === 1 ? 'y' : 'z'];
    }
    const span = a => Math.max(1e-9, hi[a] - lo[a]);
    // file axes are (width, height, depth); declared cm is [w, d, h]
    const fit = cm.length >= 3 && cm.every(isFinite) && cm.some(c => c > 0)
      ? [cm[0] / span(0), cm[2] / span(1), cm[1] / span(2)] : [1, 1, 1];
    let zlo = Infinity, xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
    for (let i = 0; i < P.length; i++) {
      // fit to cm in file axes, /100 → meters, then stand up to Z
      const fx = (rp[i].x - lo[0]) * fit[0] / 100;
      const fy = (rp[i].y - lo[1]) * fit[1] / 100;
      const fz = (rp[i].z - lo[2]) * fit[2] / 100;
      P[i] = { x: fx, y: -fz, z: fy };
      if (fx < xlo) xlo = fx; if (fx > xhi) xhi = fx;
      if (-fz < ylo) ylo = -fz; if (-fz > yhi) yhi = -fz;
      if (fy < zlo) zlo = fy;
    }
    const cx = (xlo + xhi) / 2, cy = (ylo + yhi) / 2;
    for (let i = 0; i < P.length; i++) {
      P[i] = { x: P[i].x - cx, y: P[i].y - cy, z: P[i].z - zlo };
    }
    return soup;
  }

  // ------------------------------------------------------------- pure: filter
  /** Only license-compatible models: CC BY 4.0 (with credit) and CC0. */
  function filterUsable(models) {
    return (models || []).filter(m => m && m.id && USABLE[m.licencia]);
  }

  // ------------------------------------------------------------ pure: zip read
  /** Minimal zip reader (stored + deflate-raw). Names decode as ASCII when
   *  TextDecoder is unavailable (vm tests); deflate needs the browser's
   *  DecompressionStream and is skipped where absent. Returns Map name→bytes. */
  async function zipRead(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = u8.length - 22; // locate End Of Central Directory
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not a zip archive');
    const count = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const out = new Map();
    const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
    const name = (s, l) => dec ? dec.decode(u8.subarray(s, s + l))
      : Array.from(u8.subarray(s, s + l), c => String.fromCharCode(c)).join('');
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break; // central header
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true); // local header
      if (dv.getUint32(off, true) !== 0x04034b50) { p += 46 + nlen + elen + clen; continue; }
      const lnlen = dv.getUint16(off + 26, true), lelen = dv.getUint16(off + 28, true);
      const nm = name(off + 30, lnlen);
      const start = off + 30 + lnlen + lelen;
      const comp = u8.subarray(start, start + csize);
      if (method === 0) out.set(nm, comp);
      else if (method === 8 && typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined')
        out.set(nm, new Uint8Array(await new Response(
          new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
      p += 46 + nlen + elen + clen;
    }
    return out;
  }

  // --------------------------------------------------------- model → soup → place
  async function fetchIndex() {
    const r = await fetch(BRIDGE + '/api/library/index');
    if (!r.ok) throw new Error('bridge HTTP ' + r.status);
    const d = await r.json();
    return (d && d.modelos) || [];
  }

  async function fetchModelSoup(entry) {
    const r = await fetch(BRIDGE + '/api/library/model?id=' + encodeURIComponent(entry.id));
    if (!r.ok) throw new Error('bridge HTTP ' + r.status);
    const files = await zipRead(await r.arrayBuffer());
    const objName = (entry.obj && files.has(entry.obj)) ? entry.obj
      : [...files.keys()].find(n => n.toLowerCase().endsWith('.obj'));
    if (!objName) throw new Error('zip carries no OBJ');
    const dec = new TextDecoder();
    const mtlName = objName.replace(/\.obj$/i, '.mtl');
    const mtl = files.has(mtlName) ? parseMTL(dec.decode(files.get(mtlName))) : {};
    return transformSoup(entry, parseOBJ(dec.decode(files.get(objName)), mtl));
  }

  /** Download + place one catalogue entry at (x, y). Returns placeSoup's
   *  descriptor (mode/face counts) plus the credit it must carry. */
  async function placeEntry(app, entry, x, y) {
    const soup = await fetchModelSoup(entry);
    const label = entry.nombre_en || entry.nombre || entry.id;
    const credit = (entry.autor || 'unknown') + ' · ' + (USABLE[entry.licencia] || entry.licencia);
    const res = ComponentsFeature.placeSoup(app, soup, label + ' (' + credit + ')', x, y);
    res.credit = credit;
    return res;
  }

  // ------------------------------------------------------------------ dialog
  let INDEX = null, INDEX_ERR = null;

  function section() {
    return `<div id="onlinelib" style="margin-top:8px"></div>`;
  }

  function wire(app, body) {
    const host = body.querySelector('#onlinelib');
    if (!host || !window.ComponentsFeature) return;
    host.innerHTML = `<p class="dim" style="margin:4px 0">Online catalogue (ingetrazo.com — Sweet Home 3D models): loading…</p>`;
    loadIndex().then(models => {
      const usable = filterUsable(models);
      if (!usable.length) throw new Error(INDEX_ERR || 'no compatible models');
      buildGrid(app, host, usable);
    }).catch(e => {
      host.innerHTML = `<p class="dim" style="margin:4px 0">Online catalogue unavailable — ${e.message || e}.<br>
        It needs the local bridge running: <code>npm run bridge</code> (then reopen this dialog).</p>`;
    });
  }

  function loadIndex() {
    if (INDEX) return Promise.resolve(INDEX);
    if (INDEX_ERR) return Promise.reject(new Error(INDEX_ERR));
    return fetchIndex().then(m => { INDEX = m; return m; })
      .catch(e => { INDEX_ERR = e.message || String(e); throw e; });
  }

  function buildGrid(app, host, models) {
    const cats = [...new Set(models.map(m => m.categoria || 'Varios'))]
      .sort((a, b) => catEn(a).localeCompare(catEn(b)));
    const excluded = Math.max(0, (INDEX.length || models.length) - models.length);
    host.innerHTML = `
      <div style="margin:4px 0 2px">
        <b>Online catalogue — ${models.length.toLocaleString()} CC BY / CC0 models</b>
        ${excluded ? `<span class="dim"> · ${excluded.toLocaleString()} Free-Art-License models hidden (copyleft)</span>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin:4px 0">
        <input id="ol-q" type="search" placeholder="Search ${models.length.toLocaleString()} models…" style="flex:1;min-width:120px">
        <select id="ol-cat"><option value="">All categories</option>${cats.map(c => `<option value="${c}">${catEn(c)}</option>`).join('')}</select>
        <select id="ol-mode" title="How the Doors &amp; Windows category inserts">
          <option value="door">Doors &amp; Windows: door element (cuts opening)</option>
          <option value="window">window element (cuts opening)</option>
          <option value="free">free object (no opening)</option>
        </select>
      </div>
      <div id="ol-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;max-height:260px;overflow-y:auto;padding:2px"></div>
      <div style="margin:4px 0"><button class="mini-btn" id="ol-more" style="display:none">More…</button>
        <span class="dim" id="ol-status"></span></div>`;
    const grid = host.querySelector('#ol-grid');
    const qEl = host.querySelector('#ol-q'), cEl = host.querySelector('#ol-cat');
    const more = host.querySelector('#ol-more'), status = host.querySelector('#ol-status');
    const filtered = () => {
      const q = qEl.value.trim().toLowerCase(), c = cEl.value;
      return models.filter(m => (!c || (m.categoria || 'Varios') === c) &&
        (!q || (m.nombre_en || '').toLowerCase().includes(q) || (m.nombre || '').toLowerCase().includes(q) ||
          (m.autor || '').toLowerCase().includes(q)));
    };
    let shown = 0;
    const render = reset => {
      if (reset) shown = 0;
      const list = filtered();
      if (reset) grid.innerHTML = '';
      const end = Math.min(shown + PAGE, list.length);
      for (; shown < end; shown++) {
        const m = list[shown];
        const label = m.nombre_en || m.nombre || m.id;
        const card = document.createElement('button');
        card.className = 'mini-btn';
        card.style.cssText = 'padding:2px;text-align:center;font-size:10px;line-height:1.25';
        card.title = `${label} — ${m.autor || '?'} · ${USABLE[m.licencia]} (${m.categoria || 'Varios'})`;
        card.innerHTML = `<img src="${BRIDGE}/api/library/thumb?id=${encodeURIComponent(m.id)}" loading="lazy"
            alt="" style="width:64px;height:64px;object-fit:contain;display:block;margin:0 auto;background:#f2f4f6">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</div>
          <div class="dim" style="font-size:9px">${m.autor || ''}</div>`;
        card.addEventListener('click', () => {
          status.textContent = 'Loading ' + label + '…';
          const mode = m.categoria === DW_CATEGORY
            ? ((host.querySelector('#ol-mode') || {}).value || 'door') : 'free';
          fetchModelSoup(m)
            .then(soup => {
              status.textContent = '';
              const credit = (m.autor || 'unknown') + ' · ' + (USABLE[m.licencia] || m.licencia);
              if (mode !== 'free' && window.ComponentsFeature && window.THREE) {
                // HOSTED ELEMENT: the model becomes a door/window insertion —
                // the wall gets a real opening sized to the model's own
                // rectangular border, re-cut when the wall changes, the model
                // fitted inside (same machinery as the Door/Window tools)
                const grp = ComponentsFeature.foreignObject(soup);
                const sz = new THREE.Box3().setFromObject(grp).getSize(new THREE.Vector3());
                const size = { x: sz.x, y: sz.y, z: sz.z };
                const spec = hostedSpec(mode, size);
                const aid = 'lib:' + m.id;
                app.assets.registerTemplate(aid, { scene: grp, size });
                if (app.mode !== 'bim') app.setMode('bim');
                app.bimOptions.assetId = aid;
                app.bimOptions.assetName = label;
                app.bimOptions.hosted = app.bimOptions.hosted || {};
                app.bimOptions.hosted.width = spec.width;
                app.bimOptions.hosted.height = spec.height;
                app.bimOptions.hosted.sill = spec.sill;
                app.closeDialog();
                app.setTool(mode === 'window' ? 'assetwindow' : 'assetdoor');
                app.toast(`${label} (${credit}) — hover a WALL, click to pin, slide along it, click again to cut the ${spec.width.toFixed(2)}×${spec.height.toFixed(2)} m opening (type w×h[×sill] to resize)`);
                return;
              }
              // free object: arm click-to-place — the downloaded mesh is the
              // ghost, the next viewport click places it at that ground point
              app.armAssetPlacement({
                label,
                ghost: window.ComponentsFeature ? ComponentsFeature.foreignObject(soup) : null,
                place: (x, y) => {
                  const r = ComponentsFeature.placeSoup(app, soup, label + ' (' + credit + ')', x, y);
                  r.credit = credit;
                  app.toast(r.mode === 'kernel'
                    ? `${label}: ${r.triangles.toLocaleString()} triangles → ${r.faces} kernel faces — ${r.credit}`
                    : `${label}: dense mesh (${r.triangles.toLocaleString()} triangles) — ${r.credit}`);
                },
              });
            })
            .catch(e => { status.textContent = ''; app.toast('Could not load ' + label + ' — ' + (e.message || e), true); });
        });
        grid.appendChild(card);
      }
      more.style.display = shown < list.length ? '' : 'none';
      if (!list.length && !grid.children.length) grid.innerHTML = '<span class="dim">no matches</span>';
    };
    qEl.addEventListener('input', () => render(true));
    cEl.addEventListener('change', () => render(true));
    more.addEventListener('click', () => render(false));
    render(true);
  }

  window.OnlineLib = { USABLE, CAT_EN, catEn, DW_CATEGORY, hostedSpec, parseMTL, parseOBJ, transformSoup, filterUsable, zipRead, fetchIndex, fetchModelSoup, placeEntry, section, wire };
  if (typeof window.Engine === 'undefined') return;
})();
