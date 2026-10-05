'use strict';
// ---------------------------------------------------------------------------
// ui-assembly.js — Revit-style Compound Wall Structure / Assembly Editor.
//
// Allows viewing, creating, and modifying multi-layer wall assemblies:
//   • Layer Function (Finish 1 [Exterior], Thermal/Air Layer, Membrane,
//     Structure [Core], Substrate, Finish 2 [Interior])
//   • Material name and visual hatch/color mapping
//   • Thickness per layer in mm or m
//   • Structural core designation
//   • Stratified cross-section diagram showing layered composition
//   • Standard wall presets (Cavity Wall, Insulated Concrete, Brick Veneer, Partition)
//   • Persists to wallEntity.params.layers and synchronizes IFC export
//     (IfcMaterialLayerSet + IfcMaterialLayerSetUsage).
// ---------------------------------------------------------------------------
(function () {
  const PRESETS = [
    {
      name: 'Exterior Insulated Brick (360 mm)',
      layers: [
        { function: 'Finish 1 [Exterior]', material: 'Facing Brick', thickness: 0.100, structural: false, color: '#b45309' },
        { function: 'Thermal/Air Layer', material: 'Air Cavity', thickness: 0.040, structural: false, color: '#bae6fd' },
        { function: 'Thermal/Air Layer', material: 'Rigid Insulation', thickness: 0.060, structural: false, color: '#fef08a' },
        { function: 'Structure [Core]', material: 'Concrete Masonry Unit (CMU)', thickness: 0.150, structural: true, color: '#94a3b8' },
        { function: 'Finish 2 [Interior]', material: 'Gypsum Wall Board', thickness: 0.010, structural: false, color: '#f1f5f9' },
      ],
    },
    {
      name: 'Reinforced Concrete with EIFS (260 mm)',
      layers: [
        { function: 'Finish 1 [Exterior]', material: 'Synthetic Stucco', thickness: 0.010, structural: false, color: '#fdba74' },
        { function: 'Thermal/Air Layer', material: 'EPS Insulation', thickness: 0.080, structural: false, color: '#fef08a' },
        { function: 'Structure [Core]', material: 'Cast-in-Place Concrete', thickness: 0.160, structural: true, color: '#64748b' },
        { function: 'Finish 2 [Interior]', material: 'Plaster / Paint', thickness: 0.010, structural: false, color: '#f8fafc' },
      ],
    },
    {
      name: 'Interior Partition Wall (125 mm)',
      layers: [
        { function: 'Finish 1 [Interior]', material: 'Gypsum Board 1/2"', thickness: 0.0125, structural: false, color: '#e2e8f0' },
        { function: 'Structure [Core]', material: 'Metal Stud / Acoustic Wool', thickness: 0.100, structural: true, color: '#cbd5e1' },
        { function: 'Finish 2 [Interior]', material: 'Gypsum Board 1/2"', thickness: 0.0125, structural: false, color: '#e2e8f0' },
      ],
    },
    {
      name: 'Solid Structural Concrete (200 mm)',
      layers: [
        { function: 'Structure [Core]', material: 'Reinforced Concrete', thickness: 0.200, structural: true, color: '#64748b' },
      ],
    },
  ];

  const FUNCTIONS = [
    'Finish 1 [Exterior]',
    'Thermal/Air Layer',
    'Membrane Layer',
    'Structure [Core]',
    'Substrate',
    'Finish 2 [Interior]',
  ];

  function getLayerColor(f, mat) {
    const m = (mat || '').toLowerCase();
    if (m.includes('brick')) return '#b45309';
    if (m.includes('insul') || m.includes('wool') || m.includes('eps')) return '#fef08a';
    if (m.includes('concrete') || m.includes('cmu')) return '#64748b';
    if (m.includes('gypsum') || m.includes('drywall') || m.includes('plaster')) return '#e2e8f0';
    if (m.includes('air') || m.includes('cavity')) return '#e0f2fe';
    if (m.includes('stucco')) return '#fed7aa';
    if (m.includes('wood') || m.includes('timber') || m.includes('plywood')) return '#d97706';
    if (f.includes('Structure')) return '#94a3b8';
    if (f.includes('Thermal')) return '#fef08a';
    if (f.includes('Finish 1')) return '#ca8a04';
    return '#cbd5e1';
  }

  function open(targetWall) {
    const app = window.app;
    if (!app) return;

    let wall = targetWall;
    if (!wall) {
      // Find selected wall if any
      const ent = app.singleElementSelection && app.singleElementSelection();
      if (ent && ent.type === 'wall') wall = ent;
      else {
        // Fallback to first wall
        wall = app.bim.entities.find(e => e.type === 'wall');
      }
    }

    if (!wall) {
      app.toast('No wall selected. Create a wall or select one first.', true);
      return;
    }

    let layers = [];
    if (Array.isArray(wall.params && wall.params.layers) && wall.params.layers.length) {
      layers = JSON.parse(JSON.stringify(wall.params.layers));
    } else {
      const curT = (+((wall.params && wall.params.thickness) || 0.20)).toFixed(3);
      layers = [
        { function: 'Finish 1 [Exterior]', material: 'Exterior Finish', thickness: 0.020, structural: false },
        { function: 'Structure [Core]', material: 'Concrete Core', thickness: Math.max(0.05, curT - 0.035), structural: true },
        { function: 'Finish 2 [Interior]', material: 'Gypsum Board', thickness: 0.015, structural: false },
      ];
    }

    renderDialog(wall, layers);
  }

  function renderDialog(wall, layers) {
    const app = window.app;
    const backdrop = document.getElementById('dialog-backdrop');
    const dlg = document.getElementById('dialog');
    if (!backdrop || !dlg) return;

    const calcTotal = () => layers.reduce((acc, l) => acc + (+l.thickness || 0), 0);

    const updatePreview = () => {
      const previewBar = dlg.querySelector('#wa-preview-bar');
      const totalSpan = dlg.querySelector('#wa-total-thickness');
      if (!previewBar || !totalSpan) return;

      const total = calcTotal();
      totalSpan.textContent = `${Math.round(total * 1000)} mm (${total.toFixed(3)} m)`;

      if (total <= 0) {
        previewBar.innerHTML = '<div style="padding:10px;text-align:center;color:#94a3b8">No layers defined</div>';
        return;
      }

      previewBar.innerHTML = layers.map((ly, idx) => {
        const pct = Math.max(4, Math.round(((+ly.thickness || 0) / total) * 100));
        const col = getLayerColor(ly.function, ly.material);
        return `
          <div class="wa-slice" style="flex:${pct}; background:${col};" title="${ly.function}: ${ly.material} (${Math.round((+ly.thickness) * 1000)} mm)">
            <span class="wa-slice-text">${Math.round((+ly.thickness) * 1000)} mm</span>
          </div>`;
      }).join('');
    };

    const renderTableRows = () => {
      const tbody = dlg.querySelector('#wa-tbody');
      if (!tbody) return;
      tbody.innerHTML = layers.map((ly, idx) => {
        const isCore = ly.structural || (ly.function && ly.function.includes('Structure'));
        const col = getLayerColor(ly.function, ly.material);
        return `
          <tr data-idx="${idx}" class="${isCore ? 'core-row' : ''}">
            <td style="text-align:center">
              <span class="wa-layer-swatch" style="background:${col}"></span>
              ${idx + 1}
            </td>
            <td>
              <select class="wa-fn-sel" data-field="function">
                ${FUNCTIONS.map(f => `<option value="${f}"${f === ly.function ? ' selected' : ''}>${f}</option>`).join('')}
              </select>
            </td>
            <td>
              <input type="text" class="wa-mat-in" data-field="material" value="${String(ly.material || 'Material').replace(/"/g, '&quot;')}" spellcheck="false">
            </td>
            <td>
              <div class="wa-thick-wrap">
                <input type="number" class="wa-thick-in" data-field="thickness" step="1" min="1" max="2000" value="${Math.round((+ly.thickness || 0.05) * 1000)}">
                <span class="wa-thick-unit">mm</span>
              </div>
            </td>
            <td style="text-align:center">
              <input type="checkbox" class="wa-core-chk" data-field="structural"${isCore ? ' checked' : ''}>
            </td>
            <td style="text-align:center; white-space:nowrap">
              <button class="wa-btn-sm" data-act="up" title="Move Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
              <button class="wa-btn-sm" data-act="down" title="Move Down" ${idx === layers.length - 1 ? 'disabled' : ''}>▼</button>
              <button class="wa-btn-sm wa-btn-del" data-act="del" title="Delete Layer">✕</button>
            </td>
          </tr>
        `;
      }).join('');

      updatePreview();
    };

    const html = `
      <div class="wa-dialog-container">
        <div class="wa-head">
          <div class="wa-head-top">
            <div class="wa-title">
              <span class="wa-icon">🧱</span>
              <span>Wall Assembly & Compound Structure</span>
            </div>
            <button id="wa-x-btn" class="wa-close-x" title="Close">×</button>
          </div>
          <div class="wa-sub">Edit layered cross-section for Wall <strong>${wall.id}</strong> (${wall.params && wall.params.name || 'Basic Wall'})</div>
        </div>

        <div class="wa-preset-bar">
          <span class="wa-lab">Presets:</span>
          <select id="wa-preset-sel">
            <option value="">— Select a Standard Wall Type Preset —</option>
            ${PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}
          </select>
          <span class="wa-flex"></span>
          <button id="wa-flip-btn" class="wa-btn-sec" title="Swap Exterior and Interior layers">⇄ Flip Layers</button>
          <button id="wa-add-btn" class="wa-btn-sec">+ Add Layer</button>
        </div>

        <div class="wa-preview-card">
          <div class="wa-preview-labels">
            <span class="wa-face-lab">◀ Exterior Face</span>
            <span class="wa-total-lab">Total Thickness: <strong id="wa-total-thickness">--</strong></span>
            <span class="wa-face-lab">Interior Face ▶</span>
          </div>
          <div class="wa-preview-bar" id="wa-preview-bar"></div>
        </div>

        <div class="wa-table-scroll">
          <table class="wa-table">
            <thead>
              <tr>
                <th style="width:44px; text-align:center">#</th>
                <th style="width:170px">Function</th>
                <th>Material</th>
                <th style="width:105px; text-align:right">Thickness</th>
                <th style="width:75px; text-align:center" title="Structural Core Layer">Structural</th>
                <th style="width:90px; text-align:center">Actions</th>
              </tr>
            </thead>
            <tbody id="wa-tbody"></tbody>
          </table>
        </div>

        <div class="wa-footer">
          <div class="wa-note">Layers export to IFC as <code>IfcMaterialLayerSet</code> and update the 3D analytical and boundary model.</div>
          <div class="wa-footer-btns">
            <button id="wa-cancel-btn" class="wa-btn-cancel">Cancel</button>
            <button id="wa-save-btn" class="wa-btn-primary">Apply to Wall (Save)</button>
          </div>
        </div>
      </div>
    `;

    dlg.classList.add('wa-dialog-active');
    dlg.innerHTML = html;
    backdrop.classList.remove('hidden');

    renderTableRows();

    // Table inputs change
    const tbody = dlg.querySelector('#wa-tbody');
    tbody.addEventListener('input', e => {
      const tr = e.target.closest('tr[data-idx]');
      if (!tr) return;
      const idx = +tr.dataset.idx;
      const f = e.target.dataset.field;
      if (!f || !layers[idx]) return;

      if (f === 'thickness') {
        const mm = parseFloat(e.target.value) || 10;
        layers[idx].thickness = Math.max(0.001, mm / 1000);
      } else if (f === 'material') {
        layers[idx].material = e.target.value;
      }
      updatePreview();
    });

    tbody.addEventListener('change', e => {
      const tr = e.target.closest('tr[data-idx]');
      if (!tr) return;
      const idx = +tr.dataset.idx;
      const f = e.target.dataset.field;
      if (!f || !layers[idx]) return;

      if (f === 'function') {
        layers[idx].function = e.target.value;
      } else if (f === 'structural') {
        layers[idx].structural = e.target.checked;
      }
      renderTableRows();
    });

    // Row buttons (up, down, delete)
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr[data-idx]');
      if (!tr) return;
      const idx = +tr.dataset.idx;
      const act = btn.dataset.act;

      if (act === 'up' && idx > 0) {
        const item = layers.splice(idx, 1)[0];
        layers.splice(idx - 1, 0, item);
        renderTableRows();
      } else if (act === 'down' && idx < layers.length - 1) {
        const item = layers.splice(idx, 1)[0];
        layers.splice(idx + 1, 0, item);
        renderTableRows();
      } else if (act === 'del') {
        if (layers.length <= 1) {
          app.toast('Wall must have at least one layer', true);
          return;
        }
        layers.splice(idx, 1);
        renderTableRows();
      }
    });

    // Preset selector
    dlg.querySelector('#wa-preset-sel').addEventListener('change', e => {
      const val = e.target.value;
      if (val === '') return;
      const pr = PRESETS[+val];
      if (pr) {
        layers = JSON.parse(JSON.stringify(pr.layers));
        renderTableRows();
        app.toast(`Loaded preset: ${pr.name}`);
      }
    });

    // Add Layer
    dlg.querySelector('#wa-add-btn').addEventListener('click', () => {
      layers.push({
        function: 'Substrate',
        material: 'New Layer',
        thickness: 0.050,
        structural: false,
      });
      renderTableRows();
    });

    // Flip layers
    dlg.querySelector('#wa-flip-btn').addEventListener('click', () => {
      layers.reverse();
      renderTableRows();
      app.toast('Layers reversed (Exterior ⇄ Interior)');
    });

    // Close / Cancel
    const onKeydown = e => {
      if (e.key === 'Escape') closeDialog();
    };
    const closeDialog = () => {
      window.removeEventListener('keydown', onKeydown);
      dlg.classList.remove('wa-dialog-active');
      backdrop.classList.add('hidden');
      dlg.innerHTML = '';
    };
    window.addEventListener('keydown', onKeydown);
    dlg.querySelector('#wa-cancel-btn').addEventListener('click', closeDialog);
    dlg.querySelector('#wa-x-btn')?.addEventListener('click', closeDialog);

    // Save
    dlg.querySelector('#wa-save-btn').addEventListener('click', () => {
      const totalT = calcTotal();
      if (totalT < 0.02) {
        app.toast('Total wall thickness too thin (minimum 20 mm)', true);
        return;
      }

      app.run('edit wall assembly', () => {
        wall.params = wall.params || {};
        wall.params.layers = layers;
        wall.params.thickness = +totalT.toFixed(4);
        if (app.bim && app.bim.rebuildWallWithHosts) {
          app.bim.rebuildWallWithHosts(wall.id);
        }
        if (app.model && app.model.touch) app.model.touch();
      });

      closeDialog();
      app.selectElement(wall.id);
      app.updateInfo();
      app.toast(`Wall assembly applied — ${layers.length} layers, ${Math.round(totalT * 1000)} mm total`);
    });
  }

  window.AssemblyEditor = {
    open,
    PRESETS,
  };
})();
