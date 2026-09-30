'use strict';
// ---------------------------------------------------------------------------
// Feature: Poly Haven online textures — 863 CC0 PBR texture scans browsed
// right inside the Materials dialog (the same source the SketchUp material
// browsers lean on; everything there is CC0, needs no attribution and —
// unlike the catalogue — the whole API is CORS-open, so no bridge is
// involved). A click downloads the 1k diffuse map, downscales it to a
// save-friendly data URL and registers it as a named material tiled at the
// scan's REAL-WORLD size (the API reports physical dimensions).
// ---------------------------------------------------------------------------
(function () {
  const API = 'https://api.polyhaven.com';
  const PAGE = 30;

  // ---- pure helpers (also the headless test surface) ------------------------
  /** Filter the asset index into {id, …asset} entries: case-insensitive
   *  name/tag/author match plus an exact category filter; download_count
   *  desc, then name, for a stable grid order. */
  function filterAssets(index, q, cat) {
    const term = (q || '').trim().toLowerCase();
    const out = [];
    for (const id in index) {
      const a = index[id];
      if (cat && !(a.categories || []).includes(cat)) continue;
      if (term) {
        const hay = (a.name || '') + ' ' + (a.tags || []).join(' ') + ' ' +
          Object.keys(a.authors || {}).join(' ');
        if (!hay.toLowerCase().includes(term)) continue;
      }
      out.push({ id, name: a.name, tags: a.tags, categories: a.categories,
        download_count: a.download_count, thumbnail_url: a.thumbnail_url, dimensions: a.dimensions });
    }
    out.sort((x, y) => (y.download_count || 0) - (x.download_count || 0) ||
      (x.name || '').localeCompare(y.name || ''));
    return out;
  }

  /** Asset → material spec: physical tile size from the scan's dimensions
   *  (the API reports millimetres), clamped to sane metres. */
  function specFor(asset) {
    const d = asset && asset.dimensions;
    const mm = Array.isArray(d) ? Math.max(d[0] || 0, d[1] || 0) : 0;
    const size = Math.max(0.1, Math.min(10, Math.round((mm / 1000) * 100) / 100));
    return { size, name: (asset && asset.name ? asset.name : 'Texture') + ' (CC0 · Poly Haven)' };
  }

  /** files/<id> JSON → best diffuse URL. 1k is the save-size sweet spot;
   *  fall up (2k, 4k) rather than down so odd entries still work. */
  function pickDiffuse(files) {
    const d = files && files.Diffuse;
    if (!d) return null;
    for (const res of ['1k', '2k', '4k']) {
      const jpg = d[res] && d[res].jpg;
      if (jpg && jpg.url) return jpg.url;
    }
    return null;
  }

  /** Downscale target for a source image: fit inside the cap, never upscale. */
  function fitSize(w, h, cap) {
    const c = cap || 1024;
    const mx = Math.max(w || 0, h || 0);
    if (!mx || mx <= c) return { w: Math.max(1, w | 0), h: Math.max(1, h | 0) };
    const k = c / mx;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  // ---- fetching --------------------------------------------------------------
  let _index = null, _indexP = null;
  function fetchIndex() {
    if (_index) return Promise.resolve(_index);
    if (_indexP) return _indexP;
    _indexP = fetch(API + '/assets?t=textures')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => { _index = d; return d; })
      .catch(e => { _indexP = null; throw e; });
    return _indexP;
  }

  function fetchDiffuseDataUrl(id) {
    return fetch(API + '/files/' + encodeURIComponent(id))
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(files => {
        const url = pickDiffuse(files);
        if (!url) throw new Error('no diffuse map');
        return fetch(url).then(rr => { if (!rr.ok) throw new Error('HTTP ' + rr.status); return rr.blob(); });
      })
      .then(bl => new Promise((res, rej) => {
        const url = URL.createObjectURL(bl);
        const img = new Image();
        img.onload = () => {
          try {
            const { w, h } = fitSize(img.naturalWidth, img.naturalHeight);
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            res(c.toDataURL('image/jpeg', 0.82));
          } catch (e) { URL.revokeObjectURL(url); rej(e); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image decode failed')); };
        img.src = url;
      }));
  }

  // ---- dialog section --------------------------------------------------------
  function mount(app, body) {
    const host = body.querySelector('#ph-mount');
    if (!host) return;
    host.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;margin:2px 0 4px;flex-wrap:wrap">
        <b>Online textures — Poly Haven</b><span class="dim">CC0 · no attribution needed · stored in the model once added</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <input id="ph-q" type="search" placeholder="Search Poly Haven textures…" style="flex:1;min-width:120px">
        <select id="ph-cat"><option value="">All categories</option></select>
      </div>
      <div id="ph-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px;max-height:200px;overflow-y:auto;padding:2px"></div>
      <div style="margin:2px 0"><button class="mini-btn" id="ph-more" style="display:none">More…</button>
        <span class="dim" id="ph-status"></span></div>`;
    const grid = host.querySelector('#ph-grid');
    const qEl = host.querySelector('#ph-q'), cEl = host.querySelector('#ph-cat');
    const more = host.querySelector('#ph-more'), status = host.querySelector('#ph-status');
    let shown = 0;
    const rerender = reset => {
      if (reset) shown = 0;
      const list = filterAssets(app._phIndex, qEl.value, cEl.value);
      if (reset) grid.innerHTML = '';
      const end = Math.min(shown + PAGE, list.length);
      for (; shown < end; shown++) {
        const a = list[shown];
        const card = document.createElement('button');
        card.className = 'mini-btn';
        card.style.cssText = 'padding:2px;text-align:center;font-size:10px;line-height:1.25';
        const spec = specFor(a);
        card.title = `${a.name} — ${spec.size.toFixed(2)} m tile · CC0 · click to add, or drag onto a face to paint`;
        card.draggable = true; // drop downloads the diffuse, registers, paints
        card.dataset.dragMat = JSON.stringify({ ph: { id: a.id, name: a.name, size: spec.size } });
        card.innerHTML = `<img src="${a.thumbnail_url}" alt="" loading="lazy"
            style="width:64px;height:64px;object-fit:cover;display:block;margin:0 auto;background:#e8eaed">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.name}</div>`;
        card.addEventListener('click', () => {
          status.textContent = 'Loading ' + a.name + '…';
          fetchDiffuseDataUrl(a.id)
            .then(src => {
              status.textContent = '';
              app.run('polyhaven material', mm => {
                if (window.MaterialsFeature) {
                  MaterialsFeature.ensureMat(mm, { name: spec.name, texture: { kind: 'image', src, size: spec.size } });
                  mm.touch();
                }
              });
              app.toast(`${spec.name} added — "Paint sel." from the table below (tile ${spec.size.toFixed(2)} m)`);
            })
            .catch(e => { status.textContent = ''; app.toast('Could not load ' + a.name + ' — ' + (e.message || e), true); });
        });
        grid.appendChild(card);
      }
      more.style.display = shown < list.length ? '' : 'none';
      if (!list.length && !grid.children.length) grid.innerHTML = '<span class="dim">no matches</span>';
    };
    qEl.addEventListener('input', () => rerender(true));
    cEl.addEventListener('change', () => rerender(true));
    more.addEventListener('click', () => rerender(false));

    status.textContent = 'Loading catalogue…';
    fetchIndex()
      .then(idx => {
        app._phIndex = idx;
        const cats = new Set();
        for (const id in idx) for (const c of (idx[id].categories || []))
          if (!c.startsWith('collection:')) cats.add(c);
        cEl.innerHTML = '<option value="">All categories</option>' +
          [...cats].sort().map(c => `<option value="${c}">${c[0].toUpperCase() + c.slice(1)}</option>`).join('');
        status.textContent = Object.keys(idx).length.toLocaleString() + ' textures';
        rerender(true);
      })
      .catch(() => {
        status.textContent = '';
        qEl.disabled = true;
        grid.innerHTML = '<span class="dim">catalogue unavailable (offline?) — bundled and procedural textures still work</span>';
      });
  }

  window.PHTextures = { filterAssets, specFor, pickDiffuse, fitSize, fetchIndex, mount };
})();
