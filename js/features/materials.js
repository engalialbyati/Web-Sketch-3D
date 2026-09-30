'use strict';
// ---------------------------------------------------------------------------
// Feature: Named Materials — registry, RAL palette, procedural textures at
// real-world size, and per-material quantity takeoff.
//
// A material is {id, name, color, alpha, texture:{kind,size}|null} in
// model.materials (survives undo/autosave/files). Painting stamps
// face.matId — color still rides the face (old files + glTF unchanged);
// edit-and-restamp re-stamps every use in ONE undoable step. Textures are
// procedural Canvas patterns (brick/concrete/wood/tiles/grass/metal)
// tiled at their real-world size (planar projection in each face's own
// basis) and drawn in a dedicated overlay pass over the shaded faces.
// ---------------------------------------------------------------------------
(function () {
  const TEXTURES = [
    { kind: 'brick', label: 'Brick', size: 0.22 },
    { kind: 'concrete', label: 'Concrete', size: 1.0 },
    { kind: 'wood', label: 'Wood', size: 0.9 },
    { kind: 'tiles', label: 'Tiles', size: 0.33 },
    { kind: 'grass', label: 'Grass', size: 0.5 },
    { kind: 'metal', label: 'Metal', size: 0.6 },
  ];
  const texCache = new Map();

  // bundled CC0 photo textures (assets/textures — see its SOURCES.md)
  const BUNDLED = [
    { file: 'wood_bark.png', label: 'Bark', size: 0.5 },
    { file: 'wood_bark_olive.png', label: 'Olive bark', size: 0.5 },
    { file: 'stone_rock.png', label: 'Rock', size: 1.5 },
    { file: 'stone_moss_wall.png', label: 'Moss wall', size: 1.5 },
    { file: 'stone_river_pebbles.png', label: 'Pebbles', size: 0.4 },
    { file: 'grass_lawn.png', label: 'Lawn', size: 0.6 },
    { file: 'paving_concrete.png', label: 'Paving', size: 0.5 },
  ];
  // fetch a bundled CC0 photo texture as a data URL (click-add and the
  // drag-and-drop paint path share it)
  function bundledSrc(b) {
    return fetch('assets/textures/' + b.file)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(bl => new Promise(res => { const rd = new FileReader(); rd.onload = () => res(String(rd.result || '')); rd.readAsDataURL(bl); }));
  }
  function addBundled(app, b) {
    bundledSrc(b)
      .then(src => {
        app.run('bundled material', mm => {
          const id = 'mat_' + b.file.replace('.png', '');
          mm.materials.set(id, { id, name: b.label + ' (CC0)', color: null, alpha: 1, texture: { kind: 'image', src, size: b.size } });
          mm.touch();
        });
        app.toast(`${b.label} added — pick it in the paint tray`);
        materialsDialog(app); // refresh rows + tray
      })
      .catch(e => app.toast('Texture files need the served app or desktop build (file:// cannot fetch them)', true));
  }

  function canvasTexture(kind, src) {
    const key = src ? 'img:' + src.length + ':' + (src || '').slice(-48) : kind;
    if (texCache.has(key)) return texCache.get(key);
    if (kind === 'image' && src) {
      const t = new THREE.TextureLoader().load(src, () => {
        if (window.app && app.view && app.view.invalidate) app.view.invalidate();
      });
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      texCache.set(key, t);
      return t;
    }
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#d9d4c8'; x.fillRect(0, 0, 256, 256);
    const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(42);
    if (kind === 'brick') {
      x.fillStyle = '#b5b0a4'; x.fillRect(0, 0, 256, 256);
      const bh = 32, bw = 64;
      for (let r = 0; r < 8; r++) for (let col = -1; col < 5; col++) {
        const ox = (r % 2) * bw / 2;
        x.fillStyle = `rgb(${150 + rnd() * 40},${70 + rnd() * 25},${58 + rnd() * 20})`;
        x.fillRect(col * bw + ox + 2, r * bh + 2, bw - 4, bh - 4);
      }
    } else if (kind === 'concrete') {
      for (let i = 0; i < 2600; i++) {
        x.fillStyle = `rgba(${90 + rnd() * 120},${90 + rnd() * 120},${88 + rnd() * 115},${0.05 + rnd() * 0.09})`;
        x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2.4, 1 + rnd() * 2.4);
      }
    } else if (kind === 'wood') {
      for (let i = 0; i < 60; i++) {
        x.strokeStyle = `rgba(${105 + rnd() * 60},${66 + rnd() * 36},${34 + rnd() * 22},${0.25 + rnd() * 0.4})`;
        x.lineWidth = 1 + rnd() * 2.4;
        x.beginPath();
        const y0 = rnd() * 256; x.moveTo(0, y0);
        x.bezierCurveTo(85, y0 + (rnd() - .5) * 22, 170, y0 + (rnd() - .5) * 22, 256, y0 + (rnd() - .5) * 12);
        x.stroke();
      }
    } else if (kind === 'tiles') {
      x.fillStyle = '#e8e4da'; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = '#a9a49a'; x.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
    } else if (kind === 'grass') {
      x.fillStyle = '#7d9c5a'; x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 3200; i++) {
        x.fillStyle = `rgba(${70 + rnd() * 70},${110 + rnd() * 70},${44 + rnd() * 40},0.35)`;
        x.fillRect(rnd() * 256, rnd() * 256, 1.4, 2.6);
      }
    } else if (kind === 'metal') {
      x.fillStyle = '#b9c0c6'; x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 70; i++) {
        x.strokeStyle = `rgba(255,255,255,${0.03 + rnd() * 0.05})`; x.lineWidth = 1 + rnd() * 2;
        x.beginPath(); x.moveTo(0, rnd() * 256); x.lineTo(256, rnd() * 256); x.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(key, t);
    return t;
  }

  function ensureMat(m, def) {
    if (!m.materials) m.materials = new Map();
    const id = def.id || ('mat_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4));
    const mat = { id, name: def.name || id, color: def.color || null, alpha: def.alpha == null ? 1 : def.alpha, texture: def.texture ? { ...def.texture } : null };
    m.materials.set(id, mat);
    return mat;
  }

  // ---- drag & drop painting --------------------------------------------------
  // Anything carrying data-drag-mat (tray swatches, dialog rows, online
  // texture cards) is a drag source; dropping on the viewport paints the
  // face under the cursor. A BIM face paints its WHOLE element — a wall
  // takes the material on every face INCLUDING its door/window opening
  // reveals — and an asset island paints as one unit. Drop = paint the
  // thing you hit.
  const MAT_MIME = 'application/x-websketch-material';
  const attrJSON = obj => JSON.stringify(obj).replace(/"/g, '&quot;');

  function paintTargets(m, fid, entities = []) {
    const f = m.faces.get(fid);
    if (!f) return [fid];
    const eid = f.userData && f.userData.bimEntityId;
    if (eid) {
      // LIVE stamp query — the entity's own face list goes stale the
      // moment a hosted cut stamps its reveal faces to the wall without
      // extending ent.faces; the model is the truth. The opening is
      // deliberately NOT painted: reveal/lining faces (the band the
      // hosted cut stitches inside a door/window hole, and native
      // Door/Window linings) keep their neutral look when a material is
      // dropped on the wall — select them explicitly to paint them.
      const out = [...m.faces.keys()].filter(x => {
        const ff = m.faces.get(x);
        return ff.userData && ff.userData.bimEntityId === eid && ff.userData.role !== 'lining';
      });
      return out.length ? out : [fid];
    }
    const gid = f.userData && f.userData.assetGid;
    if (gid) {
      return [...m.faces.keys()].filter(x => {
        const ff = m.faces.get(x);
        return ff.userData && ff.userData.assetGid === gid;
      });
    }
    return [fid];
  }

  function stamp(mm, targets, mat) {
    for (const t of targets) {
      const ff = mm.faces.get(t);
      if (!ff) continue;
      ff.matId = mat && mat.id ? mat.id : null;
      ff.color = mat ? (mat.color || null) : null;
      ff.alpha = mat ? (mat.alpha == null ? 1 : mat.alpha) : 1;
    }
  }

  function paintDropAt(app, mat, ev) {
    const v = app.view, m = app.model;
    const fid = v.pickFaceAt(v.eventPt(ev));
    if (!fid) { app.toast('Drop the material ON a face (wall, floor, roof…)', true); return false; }
    const targets = paintTargets(m, fid, app.bim ? app.bim.entities : []);
    app.run('paint material', mm => {
      stamp(mm, targets, mat);
      mm.touch();
    });
    rebuildPass(app);
    const what = targets.length > 1 ? ` — whole element (${targets.length} faces)` : '';
    app.toast(`${(mat && mat.name) || 'Material'} painted${what}`);
    return true;
  }

  function resolveDrop(app, payload, ev) {
    const syncTray = () => { if (app.refreshSwatchesIfMaterialsChanged) app.refreshSwatchesIfMaterialsChanged(); };
    if (payload.matId) {
      const mat = app.model.materials && app.model.materials.get(payload.matId);
      if (mat) return paintDropAt(app, mat, ev);
      app.toast('That material no longer exists', true);
      return;
    }
    if (payload.ral) {
      const { code, hex, name } = payload.ral;
      const id = 'mat_ral_' + code;
      app.run('ral material', mm => {
        if (!mm.materials.has(id)) mm.materials.set(id, { id, name: `RAL ${code} ${name}`, color: hex, alpha: 1, texture: null });
        mm.touch();
      });
      syncTray();
      return paintDropAt(app, app.model.materials.get(id), ev);
    }
    if (payload.ph) {
      const { id, name, size } = payload.ph;
      const mid = 'mat_ph_' + id;
      const existing = app.model.materials && app.model.materials.get(mid);
      if (existing) return paintDropAt(app, existing, ev);
      app.toast('Loading ' + name + '…');
      PHTextures.fetchDiffuseDataUrl(id)
        .then(src => {
          app.run('polyhaven material', mm => {
            if (!mm.materials.has(mid)) mm.materials.set(mid, { id: mid, name: name + ' (CC0 · Poly Haven)', color: null, alpha: 1, texture: { kind: 'image', src, size } });
            mm.touch();
          });
          syncTray();
          paintDropAt(app, app.model.materials.get(mid), ev);
        })
        .catch(e => app.toast('Could not load ' + name + ' — ' + (e.message || e), true));
      return;
    }
    if (payload.bundled) {
      const b = BUNDLED.find(x => x.file === payload.bundled.file);
      if (!b) return;
      const mid = 'mat_' + b.file.replace('.png', '');
      const existing = app.model.materials && app.model.materials.get(mid);
      if (existing) return paintDropAt(app, existing, ev);
      app.toast('Loading ' + b.label + '…');
      bundledSrc(b)
        .then(src => {
          app.run('bundled material', mm => {
            if (!mm.materials.has(mid)) mm.materials.set(mid, { id: mid, name: b.label + ' (CC0)', color: null, alpha: 1, texture: { kind: 'image', src, size: b.size } });
            mm.touch();
          });
          syncTray();
          paintDropAt(app, app.model.materials.get(mid), ev);
        })
        .catch(e => app.toast('Could not load ' + b.label + ' — ' + (e.message || e), true));
      return;
    }
    // a plain tray color (or the default/eraser swatch) — paint-tool rules:
    // color rides the face, no registry identity, no texture overlay
    paintDropAt(app, { id: null, name: payload.name || 'Color', color: payload.color || null, alpha: payload.alpha == null ? 1 : payload.alpha }, ev);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('dragstart', ev => {
      const el = ev.target && ev.target.closest ? ev.target.closest('[data-drag-mat]') : null;
      if (!el || !el.draggable) return;
      try {
        const payload = JSON.parse(el.dataset.dragMat || '{}');
        ev.dataTransfer.setData(MAT_MIME, JSON.stringify(payload));
        ev.dataTransfer.setData('text/plain', (payload.name || (payload.ph && payload.ph.name) || 'material'));
        ev.dataTransfer.effectAllowed = 'copy';
        document.body.classList.add('mat-drag'); // drop passes the dialog backdrop
      } catch (e) { /* not ours */ }
    });
    document.addEventListener('dragend', () => document.body.classList.remove('mat-drag'));
    document.addEventListener('dragover', ev => {
      const types = ev.dataTransfer ? [...(ev.dataTransfer.types || [])] : [];
      if (!types.includes(MAT_MIME)) return;
      if (!ev.target || !ev.target.closest || !ev.target.closest('#viewport')) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', ev => {
      document.body.classList.remove('mat-drag');
      let raw = null;
      try { raw = ev.dataTransfer && ev.dataTransfer.getData(MAT_MIME); } catch (e) { /* not ours */ }
      if (!raw) return;
      if (!ev.target || !ev.target.closest || !ev.target.closest('#viewport')) return;
      ev.preventDefault();
      const app = window.app;
      if (!app || !app.view || !app.model) return;
      try { resolveDrop(app, JSON.parse(raw), ev); }
      catch (e) { app.toast('Paint failed — ' + (e.message || e), true); }
    });
  }

  // ---- texture overlay pass -------------------------------------------------
  function rebuildPass(app) {
    const view = app.view, m = app.model;
    if (!view || !view.scene) return;
    if (!app._texturePass) { app._texturePass = new THREE.Group(); app._texturePass.name = 'texture-pass'; view.scene.add(app._texturePass); }
    while (app._texturePass.children.length) app._texturePass.remove(app._texturePass.children[0]);
    if (!m.materials) return;
    for (const f of m.faces.values()) {
      if (!f.matId || f.hidden) continue;
      const mat = m.materials.get(f.matId);
      if (!mat || !mat.texture) continue;
      const outer = m.pts(f.loop);
      const n = G.loopNormal(outer);
      if (G.isZero(n)) continue;
      const { u, v } = G.basisForNormal(n);
      const o = outer[0];
      const t2 = p => ({ x: (p.x - o.x) * u.x + (p.y - o.y) * u.y + (p.z - o.z) * u.z, y: (p.x - o.x) * v.x + (p.y - o.y) * v.y + (p.z - o.z) * v.z });
      const from2 = p => ({ x: o.x + p.x * u.x + p.y * v.x, y: o.y + p.x * u.y + p.y * v.y, z: o.z + p.x * u.z + p.y * v.z });
      const uv = p => [p.x / mat.texture.size, p.y / mat.texture.size];
      const pos = [], uvs = [];
      const emit = ring2 => {
        for (let i = 1; i + 1 < ring2.length; i++) {
          for (const idx of [0, i, i + 1]) {
            const p3 = from2(ring2[idx]);
            pos.push(p3.x, p3.y, p3.z);
            uvs.push(...uv(ring2[idx]));
          }
        }
      };
      emit(outer.map(t2));
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      const tm = new THREE.MeshLambertMaterial({ map: canvasTexture(mat.texture.kind, mat.texture.src), color: mat.color ? mat.color : 0xffffff, transparent: (mat.alpha ?? 1) < 1, opacity: mat.alpha ?? 1, side: THREE.DoubleSide, fog: true });
      const mesh = new THREE.Mesh(g, tm);
      mesh.renderOrder = 1;
      app._texturePass.add(mesh);
    }
    view.invalidate && view.invalidate();
  }

  // ---- dialogs ----------------------------------------------------------------
  function materialsDialog(app) {
    const m = app.model;
    if (!m.materials) m.materials = new Map();
    const ral = window.RAL_COLORS || {};
    const ralOpts = Object.keys(ral).sort().map(k => `<option value="${k}">RAL ${k} — ${ral[k].name}</option>`).join('');
    const rows = [...m.materials.values()].map(mat => {
      const uses = [...m.faces.values()].filter(f => f.matId === mat.id);
      const area = uses.reduce((s, f) => s + (m.faceArea ? m.faceArea(f) : 0), 0);
      return `<tr draggable="true" data-drag-mat="${attrJSON({ matId: mat.id })}" title="Drag onto a wall/floor in the viewport to paint the whole element">
        <td><input data-mat="${mat.id}" data-f="name" value="${mat.name}" style="width:130px"></td>
        <td><input data-mat="${mat.id}" data-f="color" type="color" value="${mat.color || '#cccccc'}"></td>
        <td><select data-mat="${mat.id}" data-f="tex"><option value="">—</option>${TEXTURES.map(t => `<option value="${t.kind}" ${mat.texture && mat.texture.kind === t.kind ? 'selected' : ''}>${t.label}</option>`).join('')}<option value="image" ${mat.texture && mat.texture.kind === 'image' ? 'selected' : ''}>Image file…</option></select></td>
        <td><input data-mat="${mat.id}" data-f="size" type="number" step="0.05" min="0.05" value="${mat.texture ? mat.texture.size : 0.5}" style="width:64px"></td>
        <td>${uses.length} faces · ${area.toFixed(2)} m²</td>
        <td><button class="mini-btn" data-paint="${mat.id}">Paint sel.</button> <button class="mini-btn" data-del="${mat.id}">Delete</button></td>
      </tr>`;
    }).join('');
    app.dialog('Materials — registry, RAL palette, quantities', `
      <div>
        <p class="dim" style="margin-top:0">Named materials: edit one row and every painted face re-stamps
        (one undo step). Textures tile at their real-world size (m). Quantities update live.</p>
        <div style="display:flex; gap:8px; margin-bottom:8px; align-items:center; flex-wrap:wrap">
          <button class="mini-btn primary" id="mat-add">New Material</button>
          <select id="mat-ral">${ralOpts}</select>
          <button class="mini-btn" id="mat-ral-add">Add RAL as Material</button>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:8px; align-items:center; flex-wrap:wrap">
          <span class="dim">Bundled photo textures (CC0 · ambientCG):</span>
          ${BUNDLED.map(b => `<button class="mini-btn" draggable="true" data-drag-mat="${attrJSON({ bundled: { file: b.file } })}" data-bundled="${b.file}" title="${b.label} — ${b.size} m tile · click to add, or drag onto a face to paint">${b.label}</button>`).join('')}
        </div>
        <div id="ph-mount" style="border-top:1px solid #d8d8d8; padding-top:6px; margin-bottom:8px"></div>
        <table class="prop-table" style="width:100%">
          <tr><th>Name</th><th>Color</th><th>Texture</th><th>Tile (m)</th><th>Use</th><th></th></tr>
          ${rows || '<tr><td colspan="6" class="dim">No named materials yet.</td></tr>'}
        </table>
      </div>`, [['Close', null]]);
    requestAnimationFrame(() => {
      const body = document.querySelector('.dialog-body') || document.body;
      const rerender = () => { materialsDialog(app); rebuildPass(app); };
      if (window.PHTextures) PHTextures.mount(app, body); // online CC0 section
      body.querySelector('#mat-add')?.addEventListener('click', () => {
        app.run('new material', mm => { ensureMat(mm, { name: 'Material ' + (mm.materials.size + 1), color: '#b0b0b0' }); mm.touch(); });
        rerender();
      });
      body.querySelectorAll('[data-bundled]').forEach(btn => btn.addEventListener('click', () => {
        const b = BUNDLED.find(x => x.file === btn.dataset.bundled);
        if (b) addBundled(app, b);
      }));
      body.querySelector('#mat-ral-add')?.addEventListener('click', () => {
        const k = body.querySelector('#mat-ral').value, r = ral[k];
        if (!r) return;
        app.run('new RAL material', mm => { ensureMat(mm, { name: 'RAL ' + k + ' ' + r.name, color: r.rgb_hex }); mm.touch(); });
        rerender();
      });
      body.querySelectorAll('[data-mat]').forEach(el => el.addEventListener('change', () => {
        const id = el.dataset.mat, f = el.dataset.f, val = el.value;
        app.run('edit material', mm => {
          const mat = mm.materials.get(id);
          if (!mat) return;
          if (f === 'name') mat.name = val;
          else if (f === 'color') mat.color = val;
          else if (f === 'tex') {
            if (val === 'image') return; // handled after the file picker below
            mat.texture = val ? { kind: val, size: mat.texture ? mat.texture.size : 0.5 } : null;
          }
          else if (f === 'size') mat.texture = mat.texture ? { ...mat.texture, size: Math.max(0.05, parseFloat(val) || 0.5) } : null;
          // edit-and-restamp: every use keeps identity and updates
          for (const face of mm.faces.values()) if (face.matId === id) { face.color = mat.color; face.alpha = mat.alpha; }
          mm.touch();
        });
        rerender();
      }));
      body.querySelectorAll('select[data-f="tex"]').forEach(sel => sel.addEventListener('change', () => {
        if (sel.value !== 'image') return;
        const id = sel.dataset.mat;
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = () => {
          const file = inp.files && inp.files[0];
          if (!file) { sel.value = ''; return; }
          const rd = new FileReader();
          rd.onload = () => {
            const src = String(rd.result || '');
            if (src.length > 1.6e6) app.toast('Image is large (' + (src.length / 1e6).toFixed(1) + ' MB as data) — saves may slow; smaller images are safer', true);
            app.run('material image', mm => {
              const mat = mm.materials.get(id);
              if (!mat) return;
              const size = mat.texture ? mat.texture.size : 1.0;
              mat.texture = { kind: 'image', src, size };
              mm.touch();
            });
            rerender();
          };
          rd.readAsDataURL(file);
        };
        inp.click();
      }));
      body.querySelectorAll('[data-paint]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.paint;
        app.run('paint material', mm => {
          const mat = mm.materials.get(id);
          for (const fid of app.sel.faces) { const f = mm.faces.get(fid); if (f) { f.matId = id; f.color = mat.color; f.alpha = mat.alpha; } }
          mm.touch();
        });
        app.toast('Selection painted');
      }));
      body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        app.run('delete material', mm => {
          mm.materials.delete(b.dataset.del);
          for (const f of mm.faces.values()) if (f.matId === b.dataset.del) f.matId = null;
          mm.touch();
        });
        rerender();
      }));
    });
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'materials', kind: 'command', label: 'Materials…',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 12l8-8 8 8-8 8z"/><path d="M12 4v16" opacity=".4"/></svg>',
      commands: ['materials', 'material registry', 'ral'],
      run(app) { materialsDialog(app); },
    });
    Engine.events.on('model:changed', () => {
      const app = Engine.app;
      if (!app) return;
      rebuildPass(app);
      if (app.refreshSwatchesIfMaterialsChanged) app.refreshSwatchesIfMaterialsChanged();
    });
  }
  window.MaterialsFeature = { materialsDialog, ensureMat, TEXTURES, rebuildPass, paintTargets, attrJSON, MAT_MIME };
})();
