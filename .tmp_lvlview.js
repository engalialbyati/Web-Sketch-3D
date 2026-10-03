const fs = require('fs');
let s = fs.readFileSync('js/app.js', 'utf8');
const anchor = [
  "      base.addEventListener('change', () => {",
  "        this.bimOptions.baseLevel = base.value;",
  '        // the 1 m reference grid lives at the ACTIVE base level',
  '        if (this.view && this.view.setGridLevel)',
  "          this.view.setGridLevel(this.levelManager.getElevation(base.value));",
  '      });',
].join('\n');
if (!s.includes(anchor)) { console.log('ANCHOR MISSING'); process.exit(1); }
const replacement = [
  "      base.addEventListener('change', () => {",
  '        this.bimOptions.baseLevel = base.value;',
  '        // the 1 m reference grid lives at the ACTIVE base level',
  '        const elev = this.levelManager.getElevation(base.value);',
  '        if (this.view && this.view.setGridLevel)',
  '          this.view.setGridLevel(elev);',
  '        // drawing on an elevated level from a 3D view mis-aims every click:',
  '        // the screen point of the ground plane hits the elevated plane',
  '        // offset by the camera angle. Auto-switch to a top-down view at',
  "        // the new elevation — Revit's plan-view behavior",
  "        if (base.value !== 'none' && this.mode === 'bim') {",
  '          const c = this.view.activeCamera();',
  '          const bb = [];',
  '          for (const f of this.model.faces.values()) for (const v of (f.loop || [])) { const p = this.model.vp(v); if (p) bb.push(p); }',
  '          let cx = 8, cy = 4;',
  '          if (bb.length) {',
  '            cx = bb.reduce((s2, p) => s2 + p.x, 0) / bb.length;',
  '            cy = bb.reduce((s2, p) => s2 + p.y, 0) / bb.length;',
  '          }',
  '          c.position.set(cx, cy - 0.5, elev + 28);',
  '          c.up.set(0, 1, 0);',
  '          c.lookAt(cx, cy, elev);',
  '          this.view.invalidate();',
  '          if (this.view.render) this.view.render();',
  "          this.setStatus(`Level view: drawing on ${base.options[base.selectedIndex].text} — plan view for accurate placement`);",
  '        }',
  '      });',
].join('\n');
s = s.replace(anchor, replacement);
fs.writeFileSync('js/app.js', s);
console.log('auto plan view installed');
