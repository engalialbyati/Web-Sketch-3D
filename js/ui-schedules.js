'use strict';
// ---------------------------------------------------------------------------
// ui-schedules.js — the "Schedules" dialog: quantity takeoff surface.
//
// Reads the LIVE model (app.bim.entities — never a db snapshot) and surfaces
// the two existing quantity engines:
//
//   • App.elementQuantities(ent) — mesh truth per element: face count,
//     net area in m² (openings deducted), gross area (openings added back)
//     and the closed-shell volume in m³. Same numbers the properties panel
//     shows; falls back to the quantities stored in the Elements table
//     (db parameters.quantities) when the live shell is open / not computable.
//
//   • StructuralManager.quantityReport(model) — the priority takeoff:
//     overlap volume is credited to the higher-precedence element
//     (Column ≻ Beam ≻ Slab ≻ Wall), so the per-category grand summary and
//     the per-level strip never double-count monolithic concrete.
//
// Rendering is synchronous from live state (entity type names in the Type
// column); the database is only an ASYNC enrichment pass — nicer Type labels
// via the elements ➔ types join (app.db.getAllElements + getType) and the
// quantities fallback above. The table re-renders in place when it resolves.
//
// Public API:  SchedulesUI.open()   — opens (or refreshes) the dialog.
// ---------------------------------------------------------------------------
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Category display names mirror BimElement.catalogInfoFor's fallback map;
  // the first five are the priority-takeoff order (structural first).
  const CAT_NAMES = {
    wall: 'Wall', slab: 'Slab', floor: 'Floor', door: 'Door', window: 'Window',
    opening: 'Opening', column: 'Column', beam: 'Beam', foundation: 'Foundation',
  };
  const CAT_ORDER = ['column', 'beam', 'slab', 'wall', 'foundation'];
  const catName = t => CAT_NAMES[t] || t;
  const catRank = t => {
    const i = CAT_ORDER.indexOf(t);
    return i < 0 ? CAT_ORDER.length + 1 : i; // customs sort after structural, alphabetically below
  };

  const fmtA = x => x == null ? '—' : x.toFixed(2);           // areas, m²
  const fmtV = x => x == null ? '—' : x.toFixed(3);           // row volumes, m³
  const fmtS = x => (x || 0).toFixed(1);                      // summary volumes, m³
  const plural = n => `${n} element${n === 1 ? '' : 's'}`;
  const pluralCat = s => /s$/i.test(s) ? s : s + 's';         // Columns, Walls… (customs already plural stay put)

  // Dialog state — kept at module scope so the async db enrichment can
  // re-render without losing the selected category filter.
  const state = {
    filter: 'all',
    struct: new Map(),   // elementId -> quantityReport item {id, type, gross, net, lost}
    dbNames: new Map(),  // elementId -> type name from the Elements ➔ types join
    dbQ: new Map(),      // elementId -> stored parameters.quantities
  };

  /** Live quantities with the stored-record fallback:
   *  live values win; a NULL live volume (open shell) or a thrown computation
   *  falls back to the quantities persisted in the Elements table. */
  function pickQ(live, stored) {
    const q = { faces: 0, area: 0, gross: 0, openings: 0, volume: null };
    if (stored) for (const k of Object.keys(q)) if (stored[k] != null) q[k] = stored[k];
    if (live) {
      q.faces = live.faces != null ? live.faces : q.faces;
      q.area = live.area != null ? live.area : q.area;
      q.gross = live.gross != null ? live.gross : q.gross;
      q.openings = live.openings != null ? live.openings : q.openings;
      q.volume = live.volume != null ? live.volume : q.volume;
    }
    return q;
  }

  /** One flat row model per live entity. */
  function buildRow(app, ent) {
    const meta = app.elements && app.elements.catalogInfoFor ? app.elements.catalogInfoFor(ent) : null;
    let live = null;
    try { live = app.elementQuantities(ent); } catch (e) { live = null; }
    const q = pickQ(live, state.dbQ.get(ent.id) || (ent.params && ent.params.quantities) || null);
    const st = state.struct.get(ent.id);
    return {
      id: ent.id,
      type: ent.type,
      cat: catName((meta && meta.categoryName) || ent.type),
      // label preference: db type join > cached typeName > category name
      typeLabel: state.dbNames.get(ent.id) || (meta && meta.typeName) || catName(ent.type),
      levelId: ent.params && ent.params.baseLevel || null,
      q,
      // net volume: priority takeoff when the element is in the report,
      // otherwise the geometric shell volume
      netVol: st ? st.net : q.volume,
      structLine: st && st.gross > 1e-9 && st.net < st.gross - 1e-9
        ? `Takeoff: ${st.net.toFixed(3)} m³ net of ${st.gross.toFixed(3)} m³ gross (joins credited to the higher-priority element)`
        : null,
    };
  }

  /** Priority-takeoff map for the current live entities (synchronous math). */
  function computeStructural(app) {
    state.struct = new Map();
    if (!app.structural || !app.model) return;
    try {
      const rep = app.structural.quantityReport(app.model);
      for (const it of (rep && rep.items) || []) state.struct.set(it.id, it);
    } catch (e) { state.struct = new Map(); }
  }

  const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
  const anyVol = rows => rows.some(r => r.netVol != null);

  function catSummaryLine(cat, rows) {
    const vol = sum(rows, r => r.netVol);
    return `<b>${esc(pluralCat(cat))}:</b> ${plural(rows.length)}` +
      (anyVol(rows) ? ` · ${fmtS(vol)} m³ net` : '');
  }

  /** The whole dialog body: filter, per-category grand summary, table with
   *  totals row, per-level strip. Rendered from state — safe to re-run. */
  function render() {
    const app = window.app;
    const body = $('sch-body');
    if (!app || !body) return;

    const ents = app.bim.entities.slice();
    if (!ents.length) {
      body.innerHTML = '<p class="dim">No elements yet — draw something first</p>';
      return;
    }

    // ---- ROOM SCHEDULE (Phase 2): rooms live in their own table — identity
    // fields + detected area/perimeter, with CSV export. Rooms never enter
    // the structural takeoff below (they are plates, not building fabric).
    const rooms = ents.filter(e => e.type === 'room');
    const lvlName = id => {
      const l = app.levelManager && app.levelManager.levels.find(x => x.id === id);
      return l ? l.name : '—';
    };
    const roomRow = r => {
      const p = r.params || {};
      return `<tr>
        <td class="num">${esc(p.number || '')}</td>
        <td class="sch-name">${esc(p.name || r.id)}</td>
        <td>${esc(p.department || '')}</td>
        <td>${esc(p.zone || '')}</td>
        <td>${esc(lvlName(p.levelId || p.baseLevel))}</td>
        <td class="num">${p.area != null ? (+p.area).toFixed(2) : '—'}</td>
        <td class="num">${p.perimeter != null ? (+p.perimeter).toFixed(2) : '—'}</td>
      </tr>`;
    };
    const roomTotA = rooms.reduce((s, r) => s + (+((r.params || {}).area) || 0), 0);
    const roomTotP = rooms.reduce((s, r) => s + (+((r.params || {}).perimeter) || 0), 0);
    const roomsSection = rooms.length ? `
      <div class="sch-cats"><div class="sch-catline sch-grand"><b>Room schedule:</b> ${rooms.length} room${rooms.length === 1 ? '' : 's'}
        · ${roomTotA.toFixed(1)} m² total
        <button class="mini-btn" id="sch-csv" style="margin-left:8px">Export CSV</button></div></div>
      <table class="lvl-table sch-table" style="margin-bottom:10px">
        <thead><tr><th class="num">No.</th><th>Name</th><th>Department</th><th>Zone</th><th>Level</th>
          <th class="num">Area m²</th><th class="num">Perimeter m</th></tr></thead>
        <tbody>${rooms.map(roomRow).join('')}</tbody>
        <tfoot><tr class="sch-tot"><td colspan="5">Totals · ${rooms.length} rooms</td>
          <td class="num">${roomTotA.toFixed(2)}</td>
          <td class="num">${roomTotP.toFixed(2)}</td></tr></tfoot>
      </table>` : '';
    const rows = ents.filter(e => e.type !== 'room').map(ent => buildRow(app, ent)).sort((a, b) =>
      catRank(a.type) - catRank(b.type) || catRank(a.type) === catRank(b.type) && a.type.localeCompare(b.type) ||
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

    // ---- category groups + selector options (populated categories only) ----
    const byCat = new Map();
    for (const r of rows) {
      if (!byCat.has(r.type)) byCat.set(r.type, []);
      byCat.get(r.type).push(r);
    }
    const cats = [...byCat.keys()].sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b));
    if (state.filter !== 'all' && !byCat.has(state.filter)) state.filter = 'all';
    const shown = state.filter === 'all' ? rows : byCat.get(state.filter);

    // ---- per-level strip (levels in elevation order, unassigned last) ----
    const byLvl = new Map();
    for (const r of shown) {
      if (!byLvl.has(r.levelId)) byLvl.set(r.levelId, []);
      byLvl.get(r.levelId).push(r);
    }
    const lvls = (app.levelManager ? app.levelManager.levels : []).filter(l => byLvl.has(l.id));
    const unassigned = byLvl.has(null) ? byLvl.get(null) : null;

    // ---- rows + totals ----
    const trs = shown.map(r => {
      const lvl = r.levelId && app.levelManager ? app.levelManager.getLevel(r.levelId) : null;
      const num = String(r.id).replace(/^[a-z]+_/, '');
      return `<tr>
        <td class="sch-el"><span class="sch-name">${esc(r.cat)} ${esc(num)}</span> <span class="sch-id">${esc(r.id)}</span></td>
        <td class="sch-type">${esc(r.typeLabel)}</td>
        <td class="sch-lvl">${esc(lvl ? lvl.name : '—')}</td>
        <td class="num">${r.q.faces}</td>
        <td class="num">${fmtA(r.q.area)}</td>
        <td class="num">${fmtA(r.q.gross)}</td>
        <td class="num"${r.structLine ? ` title="${esc(r.structLine)}"` : ''}>${fmtV(r.q.volume)}</td>
      </tr>`;
    }).join('');
    const volCells = shown.some(r => r.q.volume != null);
    const totals = `<tr class="sch-tot">
      <td colspan="3">Totals · ${plural(shown.length)}</td>
      <td class="num">${sum(shown, r => r.q.faces)}</td>
      <td class="num">${fmtA(sum(shown, r => r.q.area))}</td>
      <td class="num">${fmtA(sum(shown, r => r.q.gross))}</td>
      <td class="num">${volCells ? fmtV(sum(shown, r => r.q.volume)) : '—'}</td>
    </tr>`;

    const catLines = cats
      .filter(t => state.filter === 'all' || t === state.filter)
      .map(t => `<div class="sch-catline">${catSummaryLine(catName(t), byCat.get(t))}</div>`)
      .join('');
    const grandLine = state.filter === 'all'
      ? `<div class="sch-catline sch-grand">${catSummaryLine('All categories', rows)}</div>` : '';

    const lvlChips = lvls.map(l => {
      const rs = byLvl.get(l.id);
      return `<span class="sch-lvlchip">${esc(l.name)}: ${plural(rs.length)}${anyVol(rs) ? ` · ${fmtS(sum(rs, r => r.netVol))} m³` : ''}</span>`;
    }).join('');
    const unChips = unassigned ? `<span class="sch-lvlchip sch-nolvl">(no base level): ${plural(unassigned.length)}${anyVol(unassigned) ? ` · ${fmtS(sum(unassigned, r => r.netVol))} m³` : ''}</span>` : '';

    body.innerHTML = `
      ${roomsSection}
      <div class="sch-top">
        <label class="sch-filter">Category
          <select id="sch-cat">
            <option value="all">All (${rows.length})</option>
            ${cats.map(t => `<option value="${esc(t)}">${esc(catName(t))} (${byCat.get(t).length})</option>`).join('')}
          </select>
        </label>
        <span class="dim sch-count">${shown.length} of ${plural(rows.length)} shown</span>
      </div>
      <div class="sch-cats">${catLines}${grandLine}</div>
      <table class="lvl-table sch-table">
        <thead><tr>
          <th>Element</th><th>Type</th><th>Level</th>
          <th class="num">Faces</th><th class="num">Net m²</th><th class="num">Gross m²</th><th class="num">Volume m³</th>
        </tr></thead>
        <tbody>${trs}</tbody>
        <tfoot>${totals}</tfoot>
      </table>
      <div class="sch-levels">${lvlChips}${unChips}</div>
      <p class="dim">Live model state. Areas are net (openings deducted); gross adds them back. Category and level volumes are the structural takeoff — joins credited Column ≻ Beam ≻ Slab ≻ Wall, never double-counted.</p>`;

    const csv = $('sch-csv');
    if (csv) csv.addEventListener('click', () => {
      const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
      const lines = ['Number,Name,Department,Zone,Level,Area m2,Perimeter m'];
      for (const r of rooms) {
        const p = r.params || {};
        lines.push([p.number || '', p.name || r.id, p.department || '', p.zone || '',
          lvlName(p.levelId || p.baseLevel),
          p.area != null ? (+p.area).toFixed(3) : '',
          p.perimeter != null ? (+p.perimeter).toFixed(3) : ''].map(q).join(','));
      }
      lines.push(['', 'TOTAL', '', '', '', roomTotA.toFixed(3), roomTotP.toFixed(3)].map(q).join(','));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
      a.download = 'room-schedule.csv';
      a.click();
    });
    const sel = $('sch-cat');
    if (sel) {
      sel.value = state.filter;
      sel.addEventListener('change', () => { state.filter = sel.value; render(); });
    }
  }

  /** Async Type-label / quantities enrichment from the Elements table. The
   *  table is already on screen with entity type names; this only refines
   *  labels and back-fills volumes for open shells. Fails silently. */
  async function enrichFromDb() {
    const app = window.app;
    if (!app || !app.db) return;
    let rows;
    try { rows = await app.db.getAllElements(); } catch (e) { return; }
    const typeCache = new Map();
    for (const row of (rows || [])) {
      if (!row) continue;
      if (row.typeId != null) {
        let t = typeCache.get(row.typeId);
        if (t === undefined) {
          try { t = await app.db.getType(row.typeId); } catch (e) { t = null; }
          typeCache.set(row.typeId, t);
        }
        if (t && t.name) state.dbNames.set(row.id, t.name);
      }
      const q = row.parameters && row.parameters.quantities;
      if (q) state.dbQ.set(row.id, q);
    }
    if ($('sch-body')) render(); // still open -> re-render with refined labels
  }

  function open() {
    const app = window.app;
    if (!app || !app.bim || !app.dialog) return;
    state.filter = 'all';
    state.dbNames = new Map();
    state.dbQ = new Map();
    computeStructural(app);
    app.dialog('Schedules', '<div id="sch-body"></div>', [['Close', null]]);
    render();
    enrichFromDb();
  }

  window.SchedulesUI = { open };
})();
