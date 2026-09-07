'use strict';
// ui-cad.js — the professional CAD shell around the canvas:
//   • Options Bar (Revit): a contextual strip under the toolbar with the
//     active tool's settings — Type Selector (wall types / families),
//     constraints, Location Line, Chain, Offset — and the Draw panel
//     (line/rect/polygon/circle/arcs/fillet/pick) docked inline.
//   • Properties palette (AutoCAD/Revit): grouped instance properties in
//     the right tray, refreshed live with the same app.bimOptions state.
//   • Command bar ('/') and the mode gear (bottom-right).
'use strict';
(function () {
  const $ = id => document.getElementById(id);

  // Revit-style wall type presets (Basic Wall family)
  const WALL_TYPES = [
    { name: 'Curtain Wall — 50 mm', t: 0.05 },
    { name: 'Generic — 100 mm', t: 0.10 },
    { name: 'Generic — 125 mm', t: 0.125 },
    { name: 'Generic — 150 mm', t: 0.15 },
    { name: 'Generic — 200 mm', t: 0.20 },
    { name: 'Generic — 250 mm', t: 0.25 },
    { name: 'Generic — 300 mm', t: 0.30 },
    { name: 'Exterior Brick — 400 mm', t: 0.40 },
  ];

  // ---------------------------------------------------------------- boot
  const boot = () => {
    // the legacy options strip is superseded by the Options Bar
    const legacy = $('bimoptions');
    if (legacy) legacy.classList.add('hidden');
    const tabs = $('modetabs');
    if (tabs) tabs.style.display = 'none';
    buildOptionsBar();
    buildCommandBar();
    buildGearMenu();
    renderProps();
    setInterval(tick, 250);
  };

  // ------------------------------------------------- shared field binding
  // data-opt="key"      -> app.bimOptions[key]  (selects, numbers, checkboxes)
  // data-hopt="key"     -> app.bimOptions.hosted[key] (hosted tool sizes)
  const bindCadField = inp => {
    // Enter in a hosted size field (Width/Height/Sill/Depth/Count/Spacing)
    // applies the value and places the opening at the current spot
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !inp.dataset.hopt) return;
      const t = window.app && app.tool;
      if (!t || !t.enterPlace || !['door', 'window', 'opening'].includes(t.id)) return;
      e.preventDefault();
      inp.dispatchEvent(new Event('change', { bubbles: true })); // apply the value now
      inp.blur();
      setTimeout(() => { if (app.tool && app.tool.enterPlace) app.tool.enterPlace(); }, 0);
    });
    inp.addEventListener('change', () => {
      const hk = inp.dataset.hopt;
      if (hk) {
        app.bimOptions.hosted = app.bimOptions.hosted || {};
        app.bimOptions.hosted[hk] = parseFloat(inp.value) || (hk === 'count' ? 1 : 0);
        if (hk === 'depth') app.bimOptions.hosted.depthManual = app.bimOptions.hosted.depth > 0;
        if (app.tool && app.tool.spec) {
          const h = app.bimOptions.hosted;
          if (h.width > 0) app.tool.spec.width = h.width;
          if (h.height > 0) app.tool.spec.height = h.height;
          if (h.sill >= 0) app.tool.spec.sill = h.sill;
          if (h.depth > 0 && h.depthManual) app.tool.spec.depth = h.depth;
          if (app.tool._replayLast) app.tool._replayLast();
        }
        return;
      }
      const k = inp.dataset.opt;
      if (!k) return;
      app.bimOptions[k] = inp.type === 'checkbox' ? inp.checked
        : (inp.type === 'number' ? (parseFloat(inp.value) || 0) : inp.value);
      if (k === 'thickness') syncWallTypeSelect();
      if (app._refreshDrawPalette) app._refreshDrawPalette();
      if (app.tool && app.tool.status) app.tool.status();
      if (app.tool && app.tool._replayLast) app.tool._replayLast();
    });
  };
  const bindAll = root => root.querySelectorAll('[data-opt],[data-hopt]').forEach(bindCadField);
  const focusedInside = root => root.contains(document.activeElement);

  // ------------------------------------------------------------ options bar
  let ob = null; // { bar, groups: {wall, hosted, convert, sketchSlot, drawSlot}, typeSel }
  function buildOptionsBar() {
    const bar = document.createElement('div');
    bar.id = 'optionsbar';
    bar.innerHTML = `
      <div class="ob-group ob-typesel">
        <span class="ob-lab">Type</span>
        <select id="ob-type"></select>
      </div>
      <div class="ob-sep"></div>
      <div class="ob-group ob-wall">
        <span class="ob-lab">Base Level</span><select data-opt="baseLevel"></select>
        <span class="ob-lab">Top</span>
        <select data-opt="topConstraint">
          <option value="unconnected">Unconnected</option>
        </select>
        <input class="ob-num" type="number" step="0.1" min="0.05" data-opt="unconnectedHeight"> <span class="ob-lab">m</span>
        <span class="ob-lab">Location Line</span>
        <select data-opt="locationLine">
          <option value="centerline">Wall Centerline</option>
          <option value="exterior">Finish Face: Exterior</option>
          <option value="interior">Finish Face: Interior</option>
        </select>
        <label class="ob-chk"><input type="checkbox" data-opt="chain"> Chain</label>
      </div>
      <div class="ob-group ob-hosted">
        <span class="ob-lab">Width</span><input class="ob-num" type="number" step="0.05" data-hopt="width">
        <span class="ob-lab">Height</span><input class="ob-num" type="number" step="0.05" data-hopt="height">
        <span class="ob-lab">Sill</span><input class="ob-num" type="number" step="0.05" data-hopt="sill">
        <span class="ob-lab">Depth</span><input class="ob-num" type="number" step="0.05" data-hopt="depth" title="Empty = auto (host thickness)">
        <span class="ob-lab">Count</span><input class="ob-num ob-narrow" type="number" step="1" min="1" max="12" data-hopt="count">
        <span class="ob-lab">Spacing</span><input class="ob-num" type="number" step="0.1" data-hopt="spacing">
      </div>
      <div class="ob-group ob-convert">
        <button class="ob-chip" data-cvmode="floor">To Floor</button>
        <button class="ob-chip" data-cvmode="slab">To Slab</button>
        <button class="ob-chip" data-cvmode="wall">To Wall</button>
      </div>
      <div class="ob-group ob-draw" id="ob-drawslot"></div>
      <div class="ob-group ob-sketch" id="ob-sketchslot"></div>
      <div class="ob-group ob-feature" id="ob-feature"></div>
      <div class="ob-group ob-hint" id="ob-hint"></div>`;
    // dock it between the toolbar and the viewport
    const toolbar = $('toolbar');
    toolbar.parentElement.insertBefore(bar, toolbar.nextSibling);
    ob = {
      bar,
      typeSel: bar.querySelector('#ob-type'),
      gWall: bar.querySelector('.ob-wall'),
      gHosted: bar.querySelector('.ob-hosted'),
      gConvert: bar.querySelector('.ob-convert'),
      gDraw: bar.querySelector('#ob-drawslot'),
      gSketch: bar.querySelector('#ob-sketchslot'),
      gFeat: bar.querySelector('#ob-feature'),
      gHint: bar.querySelector('#ob-hint'),
    };
    // move the existing draw palette + sketch bar into their docked slots
    const dp = $('drawpalette'); if (dp) { dp.classList.remove('dp-row'); ob.gDraw.appendChild(dp); }
    const sb = $('sketchbar'); if (sb) { sb.classList.remove('dp-row'); ob.gSketch.appendChild(sb); }
    // convert chips drive bimOptions.convertMode like the old palette chips
    ob.gConvert.addEventListener('click', e => {
      const c = e.target.closest('[data-cvmode]');
      if (!c) return;
      app.bimOptions.convertMode = c.dataset.cvmode;
      refreshConvertChips();
      if (app.tool && app.tool.status) app.tool.status();
    });
    // the type selector
    ob.typeSel.addEventListener('change', () => {
      const v = ob.typeSel.value;
      if (v.startsWith('wall:')) {
        const t = WALL_TYPES[+v.slice(5)];
        if (t) { app.bimOptions.thickness = t.t; if (app.tool && app.tool.status) app.tool.status(); }
      } else if (v.startsWith('fam:')) {
        app.bimOptions.family = v.slice(4);
      }
    });
    bindAll(bar);
    // SDK feature fields: data-feat="<featureId>" inputs write the feature's
    // own state and fire its onOption hook (no bimOptions coupling)
    bar.addEventListener('change', ev => {
      const inp = ev.target.closest('[data-feat]');
      if (!inp) return;
      const d = window.Engine && Engine.features.get(inp.dataset.feat);
      if (!d) return;
      if (inp.tagName === 'SELECT') d.state[inp.dataset.key] = inp.value;
      else {
        const v = parseFloat(inp.value);
        if (isFinite(v)) d.state[inp.dataset.key] = v;
      }
      if (d.onOption) d.onOption(d, inp.dataset.key);
      const t = window.app && app.tool;
      if (t && t.status) t.status();
    });
  }

  function syncWallTypeSelect() {
    const sel = ob.typeSel;
    const tool = app.tool ? app.tool.id : '';
    if (tool === 'wall') {
      const o = app.bimOptions || {};
      const match = WALL_TYPES.findIndex(w => Math.abs(w.t - (o.thickness || 0)) < 1e-9);
      let html = WALL_TYPES.map((w, i) => `<option value="wall:${i}"${i === match ? ' selected' : ''}>Basic Wall: ${w.name}</option>`).join('');
      if (match < 0) html += `<option value="wall:-1" selected>Basic Wall: Custom — ${Math.round((o.thickness || 0) * 1000)} mm</option>`;
      sel.innerHTML = html;
      sel.parentElement.style.display = '';
    } else if (['door', 'window', 'opening'].includes(tool)) {
      const fams = (app.families ? app.families.list : []).filter(f => f.kind === tool);
      if (fams.length) {
        sel.innerHTML = fams.map(f => `<option value="fam:${f.id}"${f.id === app.bimOptions.family ? ' selected' : ''}>${f.label}</option>`).join('');
        sel.parentElement.style.display = '';
      } else sel.parentElement.style.display = 'none';
    } else {
      sel.parentElement.style.display = 'none';
    }
  }
  function refreshConvertChips() {
    ob.gConvert.querySelectorAll('.ob-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.cvmode === app.bimOptions.convertMode));
  }

  // fill level-dependent selects anywhere in the bar
  function fillLevelSelects(root) {
    const opts = app.levelManager.levels.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    root.querySelectorAll('select[data-opt="baseLevel"]').forEach(s => {
      const cur = app.bimOptions.baseLevel;
      s.innerHTML = opts;
      if ([...s.options].some(o => o.value === cur)) s.value = cur;
    });
    root.querySelectorAll('select[data-opt="topConstraint"]').forEach(s => {
      const cur = app.bimOptions.topConstraint;
      s.innerHTML = '<option value="unconnected">Unconnected</option>' + opts;
      if ([...s.options].some(o => o.value === cur)) s.value = cur;
    });
  }

  function renderOptionsBar() {
    const tool = app.tool ? app.tool.id : '';
    const bim = app.mode === 'bim';
    ob.bar.classList.toggle('visible', bim);
    if (!bim) return;
    const o = app.bimOptions || {};
    const sketchTools = ['draw', 'wall', 'floor', 'roof'].includes(tool);
    // SDK feature fields (generic: whatever the descriptor declares)
    const feat = window.Engine && Engine.features.get(tool);
    if (feat && feat.options && feat.options.length && !focusedInside(ob.gFeat)) {
      ob.gFeat.innerHTML = feat.options.map(op => {
        if (op.type === 'select') {
          const cur = feat.state[op.key] ?? op.default ?? (op.choices[0] || {}).value;
          return `<span class="ob-lab">${op.label}</span><select data-feat="${feat.id}" data-key="${op.key}">`
            + op.choices.map(c => `<option value="${c.value}"${c.value === cur ? ' selected' : ''}>${c.label}</option>`).join('')
            + `</select>`;
        }
        return `<span class="ob-lab">${op.label}</span><input class="ob-num" type="number" step="${op.step || 0.05}" data-feat="${feat.id}" data-key="${op.key}" value="${feat.state[op.key] ?? op.default ?? ''}">`;
      }).join('');
      ob.gFeat.style.display = '';
    } else if (!feat) ob.gFeat.style.display = 'none';
    ob.gWall.style.display = ['wall', 'floor', 'draw'].includes(tool) ? '' : 'none';
    // wall-only extras inside gWall: Location Line + Chain
    ob.gWall.querySelectorAll('.ob-lab:nth-of-type(3), [data-opt="locationLine"], .ob-chk').forEach(el2 => {
      el2.style.display = tool === 'wall' ? '' : 'none';
    });
    ob.gHosted.style.display = ['door', 'window', 'opening'].includes(tool) ? '' : 'none';
    ob.gConvert.style.display = tool === 'convert' ? '' : 'none';
    if (tool === 'convert') refreshConvertChips();
    ob.gDraw.style.display = (sketchTools || tool === 'convert') ? '' : 'none';
    ob.gSketch.style.display = app.sketchMode ? '' : 'none';
    // idle hint for passive tools
    ob.gHint.textContent = (!sketchTools && !['door', 'window', 'opening', 'convert'].includes(tool))
      ? ({ select: 'Select an element, or pick a drawing tool from the ribbon', wall: '', floor: '', draw: '' }[tool] || '') : '';
    if (!focusedInside(ob.bar)) {
      fillLevelSelects(ob.bar);
      syncWallTypeSelect();
      ob.bar.querySelectorAll('input[type="number"][data-opt],input[type="number"][data-hopt]').forEach(inp => {
        const src = inp.dataset.hopt ? (o.hosted || {})[inp.dataset.hopt] : o[inp.dataset.opt];
        if (document.activeElement !== inp) inp.value = src == null ? '' : (src === 0 && inp.dataset.hopt === 'depth' ? '' : src);
      });
      ob.bar.querySelectorAll('input[type="checkbox"][data-opt]').forEach(inp => { inp.checked = !!o[inp.dataset.opt]; });
    }
  }

  // ---------------------------------------------------------- command bar
  const runCommand = text => {
    if (!text) return;
    const toolAliases = {
      line: 'line', l: 'line', rect: 'rect', r: 'rect', rectangle: 'rect', circle: 'circle', c: 'circle',
      arc: 'arc', a: 'arc', polygon: 'polygon', pushpull: 'pushpull', p: 'pushpull', push: 'pushpull',
      move: 'move', m: 'move', rotate: 'rotate', q: 'rotate', scale: 'scale', s: 'scale',
      offset: 'offset', f: 'offset', paint: 'paint', b: 'paint', erase: 'erase', e: 'erase',
      eraser: 'erase', trim: 'trim', x: 'trim', tr: 'trim', dissolve: 'trim',
      tape: 'tape', t: 'tape', select: 'select', space: 'select',
      area: 'measurearea', measurearea: 'measurearea', measure: 'measurearea',
      draw: 'draw', d: 'draw', wall: 'wall', floor: 'floor', door: 'door', window: 'window',
      opening: 'opening', convert: 'convert', resize: 'resize', w: 'resize',
      extrude: 'extrude', ex: 'extrude', extrudecurve: 'extrude',
    };
    const [cmd] = text.trim().toLowerCase().split(/\s+/);
    // SDK feature aliases first (col -> column, beam -> beam, ...)
    if (window.Engine) {
      for (const d of Engine.features.list('tool')) {
        if ((d.commands || []).includes(cmd)) {
          if (d.mode === 'bim' && app.mode !== 'bim') app.setMode('bim');
          else if (d.mode === 'free' && app.mode !== 'free') app.setMode('free');
          app.setTool(d.id);
          app.toast('Command: ' + d.id);
          return;
        }
      }
      // command features (clean -> Clean Up, ...) — instant actions, no tool
      for (const d of Engine.features.list('command')) {
        if ((d.commands || []).includes(cmd)) {
          if (d.run) d.run(app);
          return;
        }
      }
    }
    if (cmd === 'properties' || cmd === 'props') { const p2 = $('propsection'); if (p2) p2.classList.toggle('hidden'); return; }
    if (cmd === 'unhide') { app.action('unhideAll'); return; }
    if (cmd === 'gltf' || cmd === 'export') { app.action('exportGltf'); return; }
    if (cmd === 'free') { app.setMode('free'); app.setTool('select'); return; }
    if (cmd === 'bim' || cmd === 'precise') { app.setMode('bim'); app.setTool('select'); return; }
    if (cmd === 'sched' || cmd === 'schedules') {
      if (window.SchedulesUI) SchedulesUI.open();
      return;
    }
    if (cmd === 'grid' || cmd === 'grids') {
      if (app.mode !== 'bim') app.setMode('bim');
      app.gridsDialog();
      return;
    }
    if (toolAliases[cmd]) {
      const id = toolAliases[cmd];
      const bimTools = ['wall', 'floor', 'door', 'window', 'opening', 'draw', 'convert'];
      if (bimTools.includes(id)) { if (app.mode !== 'bim') app.setMode('bim'); }
      else if (app.mode !== 'free') app.setMode('free');
      app.setTool(id);
      app.toast('Command: ' + id);
      return;
    }
    app.toast('Unknown command: ' + cmd + ' (line, wall, door, window, floor, draw, extrude, properties, free, precise…)');
  };
  function buildCommandBar() {
    if ($('cmdbar')) return;
    const cmd = document.createElement('input');
    cmd.id = 'cmdbar';
    cmd.placeholder = 'Command — line, wall, door, window, floor, extrude, properties…  ( / to focus )';
    cmd.spellcheck = false; cmd.autocomplete = 'off';
    $('statusbar').appendChild(cmd);
    cmd.addEventListener('keydown', e => {
      if (e.key === 'Escape') { cmd.blur(); cmd.value = ''; }
      if (e.key !== 'Enter') return;
      runCommand(cmd.value);
      cmd.value = ''; cmd.blur();
    });
    window.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement !== cmd && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        e.preventDefault(); cmd.focus();
      }
    });
  }

  // ------------------------------------------------------------- gear menu
  function buildGearMenu() {
    if ($('gearbtn')) return;
    const gear = document.createElement('button');
    gear.id = 'gearbtn'; gear.title = 'Drawing mode';
    gear.innerHTML = '&#9881;';
    const menu = document.createElement('div');
    menu.id = 'gearmenu'; menu.className = 'hidden';
    menu.innerHTML = '<div class="gm-title">Drawing Mode</div>'
      + '<button data-mode="bim"><span class="gm-dot bim"></span>Precise Drawing <span class="gm-k">Revit-style</span></button>'
      + '<button data-mode="free"><span class="gm-dot free"></span>Free Drawing <span class="gm-k">SketchUp-style</span></button>';
    document.body.appendChild(gear); document.body.appendChild(menu);
    gear.addEventListener('click', () => {
      const r = gear.getBoundingClientRect();
      menu.style.right = '14px';
      menu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
      menu.classList.toggle('hidden');
      menu.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === app.mode));
    });
    menu.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      app.setMode(b.dataset.mode);
      menu.classList.add('hidden');
    });
    document.addEventListener('pointerdown', e => {
      if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== gear) menu.classList.add('hidden');
    });
  }

  // -------------------------------------------------- Properties (tray)
  let lastPropsHtml = null, pendingProps = false;
  const propRow = (label, inner) => `<div class="pp-row"><span class="pp-lab">${label}</span><span class="pp-val">${inner}</span></div>`;
  const propNum = (label, key, step, opts = {}) => `<div class="pp-row"><span class="pp-lab">${label}</span><span class="pp-val"><input type="number" step="${step}" ${opts.cls || ''} data-${opts.hosted ? 'hopt' : 'opt'}="${key}"></span></div>`;

  function propsHtml() {
    const o = app.bimOptions || {};
    const tool = app.tool ? app.tool.id : '';
    const isBimTool = ['wall', 'floor', 'door', 'window', 'opening', 'draw', 'convert'].includes(tool);
    const fams = (app.families ? app.families.list : []).filter(f => f.kind === 'door' || f.kind === 'window');
    const lvlOpts = app.levelManager.levels.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    let h = `<div class="pp-head"><div class="pp-title">${toolName(tool)}</div><div class="pp-sub">${app.mode === 'bim' ? 'Precise Drawing' : 'Free Drawing'}</div></div>`;
    if (isBimTool) {
      h += `<div class="pp-group">Constraints</div>`
        + propRow('Base Level', `<select data-opt="baseLevel">${lvlOpts}</select>`)
        + propRow('Top Constraint', `<select data-opt="topConstraint"><option value="unconnected">Unconnected</option>${lvlOpts}</select>`)
        + propNum('Unconnected Height', 'unconnectedHeight', 0.1);
      if (tool === 'wall') {
        const match = WALL_TYPES.find(w => Math.abs(w.t - (o.thickness || 0)) < 1e-9);
        h += `<div class="pp-group">Type & Dimensions</div>`
          + propRow('Wall Type', `<select data-opt="thickness">${WALL_TYPES.map(w => `<option value="${w.t}"${w.t === o.thickness ? ' selected' : ''}>${w.name}</option>`).join('')}<option value="${o.thickness}"${match ? '' : ' selected'}>Custom — ${Math.round((o.thickness || 0) * 1000)} mm</option></select>`);
      }
      if (['wall', 'draw', 'floor'].includes(tool)) {
        h += `<div class="pp-group">Draw</div>`
          + propRow('Primitive', `<select data-opt="primitive">${['line', 'rect', 'polygon', 'circle', 'arc_ser', 'arc_ce', 'fillet', 'pick'].map(p2 => `<option value="${p2}"${o.primitive === p2 ? ' selected' : ''}>${PRIM_LABEL[p2] || p2}</option>`).join('')}</select>`)
          + propRow('Polygon Sides', `<input type="number" min="3" max="96" step="1" id="pp-sides" value="${o.polygonSides || 6}">`)
          + propRow('Polygon Fit', `<select data-opt="polygonFit"><option value="inscribed"${o.polygonFit === 'inscribed' ? ' selected' : ''}>Inscribed</option><option value="circumscribed"${o.polygonFit === 'circumscribed' ? ' selected' : ''}>Circumscribed</option></select>`)
          + propNum('Line Offset', 'offset', 0.05);
        if (tool === 'wall') {
          h += `<div class="pp-group">Location</div>`
            + propRow('Location Line', `<select data-opt="locationLine"><option value="centerline"${o.locationLine === 'centerline' ? ' selected' : ''}>Wall Centerline</option><option value="exterior"${o.locationLine === 'exterior' ? ' selected' : ''}>Finish Face: Exterior</option><option value="interior"${o.locationLine === 'interior' ? ' selected' : ''}>Finish Face: Interior</option></select>`)
            + propRow('Chain', `<input type="checkbox" data-opt="chain"${o.chain ? ' checked' : ''}>`);
        }
      }
      if (fams.length && ['door', 'window'].includes(tool)) {
        h += `<div class="pp-group">Family</div>`
          + propRow('Family', `<select data-opt="family">${fams.map(f => `<option value="${f.id}"${o.family === f.id ? ' selected' : ''}>${f.label}</option>`).join('')}</select>`);
      }
      if (['door', 'window', 'opening'].includes(tool)) {
        if (!app.bimOptions.hosted) app.bimOptions.hosted = { width: 0, height: 0, sill: 0, count: 1, spacing: 1.5 };
        h += `<div class="pp-group">Dimensions</div>`
          + propNum('Width', 'width', 0.05, { hosted: true })
          + propNum('Height', 'height', 0.05, { hosted: true })
          + propNum('Sill', 'sill', 0.05, { hosted: true })
          + propNum('Depth (0 = auto)', 'depth', 0.05, { hosted: true })
          + propNum('Count', 'count', 1, { hosted: true })
          + propNum('Spacing', 'spacing', 0.1, { hosted: true })
          + `<div class="pp-note">Set size here or on the Options Bar, then click the host (or pin-drag). Count &gt; 1 places an array. Depth follows the host unless you type one.</div>`;
      }
    } else if (tool === 'extrude') {
      h += `<div class="pp-note">Pick a line or arc, then drag or type a distance. V + X/Y/Z sets the direction.</div>`;
    } else {
      h += `<div class="pp-note">Select an element to see its properties, or activate a drawing tool.</div>`;
    }
    return h;
  }
  const PRIM_LABEL = { line: 'Line', rect: 'Rectangle', polygon: 'Polygon', circle: 'Circle', arc_ser: 'Arc (start-end-bulge)', arc_ce: 'Arc (center-ends)', fillet: 'Fillet', pick: 'Pick Lines' };
  const toolName = t => ({ wall: 'Wall', floor: 'Floor', draw: 'Draw', door: 'Door', window: 'Window', opening: 'Wall Opening', convert: 'Convert', select: 'Select', extrude: 'Extrude Curve', line: 'Line', rect: 'Rectangle', circle: 'Circle', arc: 'Arc', pushpull: 'Push/Pull', move: 'Move' }[t] || (t ? t[0].toUpperCase() + t.slice(1) : '—'));

  function renderProps() {
    const host = $('entityinfo');
    if (!host || !window.app) return;
    let sec = $('propsection');
    if (!sec) {
      sec = document.createElement('div');
      sec.id = 'propsection';
      host.insertBefore(sec, host.firstChild);
      sec.addEventListener('focusout', () => setTimeout(() => {
        if (pendingProps && !sec.contains(document.activeElement)) { pendingProps = false; renderProps(); }
      }, 0));
    }
    const html = propsHtml();
    if (html === lastPropsHtml) return; // no churn: open dropdowns stay open
    if (sec.contains(document.activeElement)) { pendingProps = true; return; }
    lastPropsHtml = html;
    sec.innerHTML = html;
    // fill select values (options html is rebuilt every render)
    const o = app.bimOptions || {};
    sec.querySelectorAll('select[data-opt]').forEach(s => {
      const v = o[s.dataset.opt];
      if (v != null && [...s.options].some(x2 => x2.value == v)) s.value = v;
    });
    sec.querySelectorAll('input[type="number"][data-hopt]').forEach(inp => {
      const v = (o.hosted || {})[inp.dataset.hopt];
      inp.value = v == null ? '' : (v === 0 && inp.dataset.hopt === 'depth' ? '' : v);
    });
    sec.querySelectorAll('input[type="number"][data-opt]').forEach(inp => {
      const v = o[inp.dataset.opt];
      if (v != null) inp.value = v;
    });
    bindAll(sec);
    // polygon sides (custom key)
    const sides = sec.querySelector('#pp-sides');
    if (sides) sides.addEventListener('change', () => {
      const v = parseInt(sides.value, 10);
      if (v >= 3 && v <= 96) app.bimOptions.polygonSides = v;
      sides.value = app.bimOptions.polygonSides;
    });
  }

  // ------------------------------------------------------------------ tick
  function tick() {
    renderOptionsBar();
    renderProps();
  }

  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();
