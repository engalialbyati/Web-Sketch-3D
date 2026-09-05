'use strict';
// ---------------------------------------------------------------------------
// Viewport: Three.js scene with a SketchUp-style look (z-up).
// ---------------------------------------------------------------------------
const RAD = Math.PI / 180;

class Viewport {
  constructor(container, app) {
    this.app = app;
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    // HUD overlay for text labels near the cursor
    this.hud = document.createElement('canvas');
    this.hud.className = 'hud';
    container.appendChild(this.hud);
    this.hudCtx = this.hud.getContext('2d');
    this.hudItems = [];
    // Persistent, world-anchored labels (listening dimensions, badges, flip
    // buttons). Unlike hudItems — which live for one frame and so are only
    // visible while something keeps pushing them (a moving mouse) — these are
    // re-projected from their world anchor every frame and stay on screen
    // until the next clearPreview(), so dimensions remain readable while the
    // pointer rests and they track orbit/pan/zoom.
    this.hudSticky = [];
    // Pinned measurements (Measure Area tool): same world-anchored projection
    // as hudSticky, but they survive clearPreview() and tool switches — only
    // an explicit clearPins() (Esc in the tool, model swap) removes them.
    this.hudPins = [];
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xe8eef2, 120, 460);
    this.fogOn = true;

    // ---- camera (z-up, SketchUp home-ish view) ----
    this.cam = { target: G.v(0, 0, 0.0), dist: 16, az: -55 * RAD, el: 28 * RAD, ortho: false, fov: 50 };
    this.persp = new THREE.PerspectiveCamera(50, 1, 0.02, 4000);
    this.persp.up.set(0, 0, 1);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -4000, 4000);
    this.ortho.up.set(0, 0, 1);

    this._buildEnvironment();
    this._buildModelGroups();
    this._buildOverlays();

    this.raycaster = new THREE.Raycaster();

    this._resize();
    window.addEventListener('resize', () => this._resize());
    new ResizeObserver(() => this._resize()).observe(container);

    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  // -------------------------------------------------------------- environment
  _buildEnvironment() {
    // sky dome
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x9cc2e6) },
        horizon: { value: new THREE.Color(0xeef3f6) },
        ground: { value: new THREE.Color(0xd7dfd4) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 horizon; uniform vec3 ground;
        void main(){ float h = normalize(vP).z;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h,1.0), 0.55)) : mix(horizon, ground, pow(min(-h,1.0), 0.45));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 32, 15), skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // lights
    this.hemi = new THREE.HemisphereLight(0xdfeaf2, 0xc9c9c2, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.85);
    this.sun.position.set(36, -22, 52);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 200;
    this.sun.shadow.bias = -0.0006;
    this.shadowsOn = true;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // ground + grid + shadow catcher
    // the ground is a translucent veil (no depth write): below-grade
    // geometry — footings, basements, piles — stays visible THROUGH it from
    // above instead of being depth-occluded until the camera dips under z=0
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 800),
      new THREE.MeshBasicMaterial({ color: 0xf2f0ea, fog: true, transparent: true, opacity: 0.55, depthWrite: false }));
    this.ground.position.z = -0.02;
    this.scene.add(this.ground);

    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 800),
      new THREE.ShadowMaterial({ opacity: 0.22 }));
    this.shadowCatcher.position.z = -0.01;
    this.shadowCatcher.receiveShadow = true;
    this.scene.add(this.shadowCatcher);

    this.grid = new THREE.GridHelper(120, 120, 0xb9bfc3, 0xdfe2e4); // 1 m cells
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.8;
    this.scene.add(this.grid);

    // axes
    this.axesGroup = new THREE.Group();
    const mkAxis = (dir, color) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(dir.x * 12, dir.y * 12, dir.z * 12)]);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, fog: false }));
      this.axesGroup.add(l);
    };
    mkAxis(G.v(1, 0, 0), 0xd23c2e);
    mkAxis(G.v(0, 1, 0), 0x3d9e4e);
    mkAxis(G.v(0, 0, 1), 0x3e66c4);
    const label = (txt, pos, color) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const ctx = c.getContext('2d');
      ctx.font = 'bold 44px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.fillText(txt, 32, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, fog: false }));
      sp.scale.set(0.9, 0.9, 1); sp.position.copy(new THREE.Vector3(pos.x, pos.y, pos.z));
      sp.renderOrder = 20;
      this.axesGroup.add(sp);
    };
    label('X', G.v(12.6, 0, 0), 0xd23c2e);
    label('Y', G.v(0, 12.6, 0), 0x3d9e4e);
    label('Z', G.v(0, 0, 12.6), 0x3e66c4);
    this.scene.add(this.axesGroup);
  }

  // -------------------------------------------------------------- model groups
  _buildModelGroups() {
    // faces
    const uniforms = {
      lightDir: { value: G.norm(G.v(36, -22, 52)) },
      uAlphaMul: { value: 1.0 },
      uMono: { value: 0.0 },
      fogNear: { value: 120 }, fogFar: { value: 460 },
      fogColor: { value: new THREE.Color(0xe8eef2) }, fogOn: { value: 1.0 },
    };
    this.faceUniforms = uniforms;
    this.faceMat = new THREE.ShaderMaterial({
      uniforms, side: THREE.DoubleSide, transparent: true,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // push faces back so edges drawn ON faces stay visible
      vertexShader: `
        attribute vec4 color;
        varying vec3 vN; varying vec4 vC; varying float vDepth;
        void main(){
          vN = normal; vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 lightDir; uniform float uAlphaMul; uniform float uMono;
        uniform float fogNear; uniform float fogFar; uniform vec3 fogColor; uniform float fogOn;
        varying vec3 vN; varying vec4 vC; varying float vDepth;
        void main(){
          vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
          float diff = max(dot(n, lightDir), 0.0);
          float fill = max(dot(n, normalize(vec3(-lightDir.x, -lightDir.y, 0.35))), 0.0) * 0.22;
          vec3 base = gl_FrontFacing ? vC.rgb : mix(vec3(0.60,0.66,0.74), vC.rgb, 0.22);
          base = mix(base, vec3(0.97,0.97,0.97), uMono);
          vec3 col = base * (0.60 + diff * 0.40 + fill);
          float f = clamp((vDepth - fogNear) / max(fogFar - fogNear, 0.001), 0.0, 1.0) * fogOn;
          col = mix(col, fogColor, f);
          gl_FragColor = vec4(col, vC.a * uAlphaMul);
        }`,
    });
    this.faceMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.faceMat);
    this.faceMesh.castShadow = true;
    this.scene.add(this.faceMesh);
    this.triangleFace = [];

    // BIM elements render as unified per-element Groups (BimElement.js) —
    // one selectable compound mesh per parametric entity, added here and
    // rebuilt together with the merged mesh in rebuild()
    this.elementsRoot = new THREE.Group();
    this.elementsRoot.name = 'bim-elements';
    this.scene.add(this.elementsRoot);

    // edges
    this.edgeLines = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x26262a }));
    this.scene.add(this.edgeLines);

    // selected edges
    this.selEdges = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x1f6fd6 }));
    this.scene.add(this.selEdges);

    // hover edge
    this.hoverEdges = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x6ea8ff }));
    this.hoverEdges.visible = false;
    this.scene.add(this.hoverEdges);

    // selected faces / hover faces overlays
    this.selFaces = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0x2f6fdb, transparent: true, opacity: 0.38, side: THREE.DoubleSide,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    this.scene.add(this.selFaces);
    // bright perimeter of the selected AREA (outer ring + opening rings) so
    // exactly what is selected is unmistakable at a glance
    this.selOutline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color: 0x1a4ea8, transparent: true, opacity: 0.95, depthTest: false,
    }));
    this.selOutline.renderOrder = 26;
    this.scene.add(this.selOutline);

    this.hoverFace = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0x8ab4f8, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    this.hoverFace.visible = false;
    this.scene.add(this.hoverFace);

    // solid fill + outline of MEASURED faces (Measure Area): the face being
    // hovered and every pinned measurement stay highlighted until cleared.
    // Fully opaque — the WHOLE face reads as blue, exactly like a painted face.
    this.measureFace = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0x2f6fdb, transparent: false, opacity: 1.0, side: THREE.DoubleSide,
      depthWrite: true, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    this.measureFace.visible = false;
    this.scene.add(this.measureFace);
    this.measureOutline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color: 0x1a4ea8, transparent: true, opacity: 0.95, depthTest: false,
    }));
    this.measureOutline.renderOrder = 27;
    this.measureOutline.visible = false;
    this.scene.add(this.measureOutline);
    this._measureHoverFace = null; // transient face under the measuring cursor

    this.previewGroup = new THREE.Group();
    this.scene.add(this.previewGroup);
  }

  _buildOverlays() {
    // inference snap marker
    const dot = (color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      const m = new THREE.PointsMaterial({ color, size: 11, sizeAttenuation: false, depthTest: false });
      const p = new THREE.Points(g, m);
      p.renderOrder = 30; p.visible = false;
      return p;
    };
    this.snapDot = dot(0x1a7f37); this.snapDot.userData.kind = 'endpoint';
    this.scene.add(this.snapDot);

    // dashed box around the group being edited
    this.editBox = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0xe07b00, dashSize: 0.35, gapSize: 0.22, depthTest: false }));
    this.editBox.renderOrder = 22;
    this.editBox.visible = false;
    this.scene.add(this.editBox);
  }

  setGroupEditBox(bb) {
    if (!bb) { this.editBox.visible = false; return; }
    const { min: a, max: b } = bb;
    const P = [
      [a.x, a.y, a.z], [b.x, a.y, a.z], [b.x, b.y, a.z], [a.x, b.y, a.z],
      [a.x, a.y, b.z], [b.x, a.y, b.z], [b.x, b.y, b.z], [a.x, b.y, b.z],
    ];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const pos = [];
    for (const [i, j] of E) pos.push(...P[i], ...P[j]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.editBox.geometry.dispose();
    this.editBox.geometry = g;
    this.editBox.computeLineDistances();
    this.editBox.visible = true;
  }

  // -------------------------------------------------------------- build model
  rebuild() {
    const model = this.app.model;
    // unified element Groups first: they claim their faces; the merged mesh
    // renders only the remaining (plain Free Drawing) geometry
    const elementFaceIds = (this.app.elements && this.app.elements.rebuild) ? this.app.elements.rebuild() : new Set();
    // display-only view filters (Level View plan isolation) — never model state
    const ff = this.faceFilter || null, ef = this.edgeFilter || null, elf = this.elementFilter || null;
    // hidden elements leave the render (and with it, picking) entirely
    if (this.app.elements)
      for (const el of this.app.elements.list())
        el.group.visible = !el.entity.hidden && (elf ? !!elf(el.entity) : true);
    const pos = [], col = [], nor = [];
    this.triangleFace = [];
    const sel = this.app.sel;
    for (const f of model.faces.values()) {
      if (f.hidden || (ff && !ff(f)) || elementFaceIds.has(f.id)) continue;
      const rings = model.rings(f);
      const outer = model.pts(f.loop);
      const n = G.loopNormal(outer);
      if (G.isZero(n)) continue;
      const { u, v } = G.basisForNormal(n);
      const o = outer[0];
      const contour = outer.map(p => new THREE.Vector2(G.to2D(p, o, u, v).x, G.to2D(p, o, u, v).y));
      const holes = f.holes.map(h => model.pts(h).map(p => new THREE.Vector2(G.to2D(p, o, u, v).x, G.to2D(p, o, u, v).y)));
      let tris = [];
      try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { tris = []; }
      const all = outer.concat(f.holes.flatMap(h => model.pts(h)));
      const c = f.color ? hexToRgb(f.color) : { r: 1, g: 1, b: 1 };
      const a = f.alpha == null ? 1 : f.alpha;
      for (const t of tris) {
        for (const idx of t) {
          const p = all[idx];
          pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b, a);
        }
        this.triangleFace.push(f.id);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    this.faceMesh.geometry.dispose();
    this.faceMesh.geometry = fg;

    // edges (element edges included — shared/welded edges belong to the
    // whole scene graph; hidden edges are skipped like hidden faces)
    const ep = [];
    for (const e of model.edges.values()) {
      if (e.hidden || (ef && !ef(e))) continue;
      const eu = e.userData && e.userData.bimEntityId;
      if (eu && this.app.isEntityHidden(eu)) continue; // hidden element edges go too
      const a = model.vp(e.a), b = model.vp(e.b);
      if (!a || !b) continue;
      ep.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    this.edgeLines.geometry.dispose();
    this.edgeLines.geometry = eg;

    this.updateSelectionVisuals();
    this._syncMeasureFaces(); // green highlights follow faces through edits
    this.app._snapCache = null;
  }

  setFaceStyle(style) { // 'shaded' | 'wireframe' | 'monochrome'
    this.faceStyle = style;
    this.faceMesh.visible = style !== 'wireframe';
    if (this.elementsRoot) this.elementsRoot.visible = style !== 'wireframe';
    this.faceUniforms.uMono.value = style === 'monochrome' ? 1.0 : 0.0;
  }
  setXray(on) { this.faceUniforms.uAlphaMul.value = on ? 0.55 : 1.0; this.xray = on; }
  // Sketch Mode: ghost the model so sketch lines dominate (edges stay crisp)
  setGhost(on) {
    this.faceUniforms.uAlphaMul.value = on ? 0.22 : (this.xray ? 0.55 : 1.0);
    this.ghosted = on;
  }
  setShadows(on) {
    this.sun.castShadow = on;
    this.shadowCatcher.visible = on;
  }
  setFog(on) {
    this.fogOn = on;
    this.faceUniforms.fogOn.value = on ? 1.0 : 0.0;
    this.ground.material.fog = on;
    this.grid.material.fog = on;
    this.edgeLines.material.fog = on;
    this.ground.material.needsUpdate = true;
  }
  setEdges(on) { this.edgeLines.visible = on; this.selEdges.visible = on; }
  setGrid(on) { this.grid.visible = on; this.ground.visible = on; }
  setAxes(on) { this.axesGroup.visible = on; }

  // Vertical level reference planes (Precise Drawing mode). Each level gets a
  // subtle wireframe rectangle + an elevation label sprite at its height.
  setLevels(levels, grids) {
    if (!this.levelsGroup) {
      this.levelsGroup = new THREE.Group();
      this.levelsGroup.visible = false;
      this.scene.add(this.levelsGroup);
    }
    while (this.levelsGroup.children.length)
      this.levelsGroup.remove(this.levelsGroup.children[0]);
    // Level planes derive their boundary from the grid system's AABB (+2 m
    // margin beyond the outermost bubbles) so they always encompass the
    // grids wherever they sit in the world. No grids: fixed 12 m half-extent.
    let x0 = -12, y0 = -12, x1 = 12, y1 = 12;
    if (grids && grids.length) {
      let xa = Infinity, ya = Infinity, xb = -Infinity, yb = -Infinity;
      for (const g of grids) {
        if (g.hidden) continue; // hidden grids neither render nor size the planes
        for (const p of g.polyline()) {
          if (p[0] < xa) xa = p[0];
          if (p[0] > xb) xb = p[0];
          if (p[1] < ya) ya = p[1];
          if (p[1] > yb) yb = p[1];
        }
      }
      const M = 2.0; // margin beyond the outermost grid bubbles
      x0 = xa - M; y0 = ya - M; x1 = xb + M; y1 = yb + M;
    }
    for (const lvl of levels || []) {
      if (lvl.hidden) continue; // hidden levels leave the viewport
      // level datums sit slightly ABOVE the grid line planes (grids draw at
      // the same elevations) so they always read on top — no z-fighting, no
      // hiding beneath the dashed grid lines
      const z = lvl.elevation + 0.02;
      const pts = [
        new THREE.Vector3(x0, y0, z), new THREE.Vector3(x1, y0, z),
        new THREE.Vector3(x1, y1, z), new THREE.Vector3(x0, y1, z),
      ];
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      // depthTest OFF: the level datum paints OVER the coplanar grid lines
      // no matter the camera angle — a z-offset alone is invisible at
      // building scale and depth testing still rejects fragments against
      // the already-drawn grid dashes
      const loop = new THREE.LineLoop(g, new THREE.LineBasicMaterial({
        color: 0x7b3fa0, transparent: true, opacity: z === 0 ? 0.55 : 0.32, fog: false,
        depthTest: false,
      }));
      loop.renderOrder = 7; // above grid lines (5) and bubbles (6)
      this.levelsGroup.add(loop);
      // dashes toward the center so the plane reads as a cutting height
      const cg = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, z), new THREE.Vector3(0, 0, z + 0.55),
      ]);
      this.levelsGroup.add(new THREE.Line(cg, new THREE.LineBasicMaterial({
        color: 0x7b3fa0, transparent: true, opacity: 0.6, fog: false, depthTest: false,
      })));
      // text label sprite
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 64;
      const cx = cv.getContext('2d');
      cx.font = '600 30px Segoe UI, sans-serif';
      cx.fillStyle = '#5b3fa8';
      cx.textBaseline = 'middle';
      cx.fillText(`${lvl.name}  ${lvl.elevation.toFixed(2)} m`, 8, 34);
      const tex = new THREE.CanvasTexture(cv);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
      spr.scale.set(3.2, 0.8, 1);
      spr.renderOrder = 8;
      spr.position.set(x0 + 1.6, y0 + 0.4, z);
      this.levelsGroup.add(spr);
    }
  }
  showLevels(on) {
    if (!this.levelsGroup) return;
    this.levelsGroup.visible = !!on;
  }

  // ---------------------------------------------------------------- grids
  // The GridSystem (GridLine.js): each grid renders as a CAD centerline
  // (dashed, dashSize 0.5 / gap 0.25) on every level plane its verticalExtent
  // covers, with circular bubbles (billboard sprites — text never flips
  // upside down) and drag grips at both ends. `levels` is the sorted list of
  // { elevation } the grids are drawn against.
  setGrids(grids, levels, selGridId = null) {
    if (!this.gridsGroup) {
      this.gridsGroup = new THREE.Group();
      this.gridsGroup.visible = false;
      this.scene.add(this.gridsGroup);
    }
    while (this.gridsGroup.children.length) {
      const c = this.gridsGroup.children[0];
      this.gridsGroup.remove(c);
      if (c.material && c.material.map) c.material.map.dispose();
      if (c.material) c.material.dispose();
    }
    this._gridGrips = []; // [{ gridId, which:'start'|'end', p:{x,y,z} }]
    const zs = (levels || []).map(l => l.elevation).filter(z => z != null).sort((a, b) => a - b);
    for (const g of grids || []) {
      if (g.hidden) continue; // hidden grids leave the viewport and the grips
      const covered = zs.filter(z => g.covers(z));
      if (!covered.length) continue;
      const zGrip = covered[0];
      const poly = g.polyline();
      const sel = g.id === selGridId; // selected grid reads in amber
      for (const z of covered) {
        const pts = poly.map(p => new THREE.Vector3(p[0], p[1], z));
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({
          color: sel ? 0xf59e0b : 0x64748b, dashSize: 0.5, gapSize: 0.25,
          transparent: true, opacity: sel ? 1.0 : 0.85, fog: false,
          depthTest: false, // datums read THROUGH geometry — a wall drawn on
          // its grid never hides the line (it must stay visible to select)
        }));
        line.computeLineDistances(); // dashed materials need the arc lengths
        line.renderOrder = 6;
        this.gridsGroup.add(line);
      }
      // bubbles at the requested end(s), just past the endpoint, on the
      // lowest covered level — same plane the drag grips live on
      const S = poly[0], E = poly[poly.length - 1];
      const dir = (g.isCurved && g.mid)
        ? { x: g.mid[0] - S[0], y: g.mid[1] - S[1] }
        : { x: E[0] - S[0], y: E[1] - S[1] };
      const dl = Math.hypot(dir.x, dir.y) || 1;
      const ends = [];
      if (g.bubbleEnd === 'both' || g.bubbleEnd === 'start') ends.push({ p: S, d: { x: -dir.x / dl, y: -dir.y / dl } });
      if (g.bubbleEnd === 'both' || g.bubbleEnd === 'end') ends.push({ p: E, d: { x: dir.x / dl, y: dir.y / dl } });
      for (const end of ends) {
        const spr = this._gridBubble(g.name);
        spr.position.set(end.p[0] + end.d.x * 0.7, end.p[1] + end.d.y * 0.7, zGrip);
        this.gridsGroup.add(spr);
      }
      // drag grips (small squares) at both endpoints
      for (const which of ['start', 'end']) {
        const p = which === 'start' ? S : E;
        const spr = this._gridGrip(sel ? 0xf59e0b : 0x64748b);
        spr.position.set(p[0], p[1], zGrip);
        this.gridsGroup.add(spr);
        this._gridGrips.push({ gridId: g.id, which, p: { x: p[0], y: p[1], z: zGrip } });
      }
    }
  }
  // circular bubble with the axis name centered inside (R ≈ 0.4 m world)
  _gridBubble(name) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const cx = cv.getContext('2d');
    cx.beginPath(); cx.arc(64, 64, 56, 0, Math.PI * 2);
    cx.lineWidth = 6; cx.strokeStyle = '#64748b'; cx.stroke();
    cx.fillStyle = 'rgba(226,232,240,0.85)'; cx.fill();
    cx.font = '700 52px Segoe UI, sans-serif';
    cx.fillStyle = '#334155';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(String(name).slice(0, 3), 64, 68);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
    spr.scale.set(0.9, 0.9, 1); // Ø0.9 m ≈ R 0.45 m bubble
    spr.renderOrder = 6;
    return spr;
  }
  _gridGrip(color = 0x64748b) {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    cx.fillRect(14, 14, 36, 36);
    cx.strokeStyle = '#e2e8f0'; cx.lineWidth = 5;
    cx.strokeRect(14, 14, 36, 36);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
    spr.scale.set(0.34, 0.34, 1);
    spr.renderOrder = 7;
    return spr;
  }
  showGrids(on) {
    if (!this.gridsGroup) return;
    this.gridsGroup.visible = !!on;
  }
  // cached screen-space grip points for the app's drag intercept
  gridGripPoints() { return this._gridGrips || []; }

  // ---------------------------------------------------------------- snap glyph
  // The grid snap indicator: an "X" (intersection) or dot (on-line) glyph with
  // its tooltip text, drawn on a billboard sprite at the snap point.
  setSnapGlyph(inf) {
    if (!this._snapGlyph) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 96;
      this._snapGlyphCv = cv;
      const tex = new THREE.CanvasTexture(cv);
      this._snapGlyph = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false, fog: false,
      }));
      this._snapGlyph.renderOrder = 20;
      this._snapGlyph.visible = false;
      this.scene.add(this._snapGlyph);
    }
    if (!inf) { this._snapGlyph.visible = false; return; }
    const cv = this._snapGlyphCv, cx = cv.getContext('2d');
    cx.clearRect(0, 0, 256, 96);
    const isX = inf.kind === 'gridX';
    const col = isX ? '#b45309' : '#475569';
    cx.strokeStyle = col; cx.lineWidth = 7; cx.lineCap = 'round';
    if (isX) {
      cx.beginPath();
      cx.moveTo(24, 24); cx.lineTo(56, 56); cx.moveTo(56, 24); cx.lineTo(24, 56);
      cx.stroke();
    } else {
      cx.beginPath(); cx.arc(40, 40, 12, 0, Math.PI * 2); cx.stroke();
    }
    cx.font = '600 26px Segoe UI, sans-serif';
    cx.fillStyle = col; cx.textBaseline = 'middle';
    cx.fillText(inf.label || '', 72, 42);
    this._snapGlyph.material.map.needsUpdate = true;
    this._snapGlyph.scale.set(2.6, 0.975, 1);
    this._snapGlyph.position.set(inf.p.x, inf.p.y, inf.p.z + 0.02);
    this._snapGlyph.center.set(0.08, 0.5); // anchor near the glyph, text extends right
    this._snapGlyph.visible = true;
  }

  updateSelectionVisuals() {
    const model = this.app.model, sel = this.app.sel;
    // selected edges
    const ep = [];
    for (const id of sel.edges) {
      const e = model.edges.get(id); if (!e) continue;
      const a = model.vp(e.a), b = model.vp(e.b);
      if (a && b) ep.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    this.selEdges.geometry.dispose();
    this.selEdges.geometry = eg;

    // selected faces (triangulated overlay)
    const pos = [], nor = [];
    for (const id of sel.faces) {
      const f = model.faces.get(id); if (!f || f.hidden) continue;
      const outer = model.pts(f.loop);
      const n = G.loopNormal(outer);
      if (G.isZero(n)) continue;
      const { u, v } = G.basisForNormal(n);
      const o = outer[0];
      const t2 = (p) => new THREE.Vector2(G.to2D(p, o, u, v).x, G.to2D(p, o, u, v).y);
      try {
        const tris = THREE.ShapeUtils.triangulateShape(outer.map(t2), f.holes.map(h => model.pts(h).map(t2)));
        const all = outer.concat(f.holes.flatMap(h => model.pts(h)));
        for (const t of tris) for (const idx of t) {
          const p = all[idx];
          pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z);
        }
      } catch (e) { }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    this.selFaces.geometry.dispose();
    this.selFaces.geometry = fg;

    // selected-area perimeter: every ring of every selected face (holes
    // included, so an opening's boundary reads as part of the area)
    const op = [];
    for (const id of sel.faces) {
      const f = model.faces.get(id); if (!f || f.hidden) continue;
      for (const ring of [f.loop, ...(f.holes || [])]) {
        for (let i = 0; i < ring.length; i++) {
          const a = model.vp(ring[i]), b = model.vp(ring[(i + 1) % ring.length]);
          if (a && b) op.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.Float32BufferAttribute(op, 3));
    this.selOutline.geometry.dispose();
    this.selOutline.geometry = og;
  }

  setHoverFace(faceId, color) {
    this.hoverFace.material.color.setHex(color != null ? color : 0x8ab4f8); // callers may tint
    if (faceId == null) { this.hoverFace.visible = false; return; }
    const model = this.app.model;
    const f = model.faces.get(faceId);
    if (!f) { this.hoverFace.visible = false; return; }
    const pos = [];
    const outer = model.pts(f.loop);
    const n = G.loopNormal(outer);
    if (G.isZero(n)) { this.hoverFace.visible = false; return; }
    const { u, v } = G.basisForNormal(n);
    const o = outer[0];
    const t2 = (p) => new THREE.Vector2(G.to2D(p, o, u, v).x, G.to2D(p, o, u, v).y);
    try {
      const tris = THREE.ShapeUtils.triangulateShape(outer.map(t2), f.holes.map(h => model.pts(h).map(t2)));
      const all = outer.concat(f.holes.flatMap(h => model.pts(h)));
      for (const t of tris) for (const idx of t) { const p = all[idx]; pos.push(p.x, p.y, p.z); }
    } catch (e) { this.hoverFace.visible = false; return; }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.hoverFace.geometry.dispose();
    this.hoverFace.geometry = fg;
    this.hoverFace.visible = true;
  }

  setHoverEdges(edgeIds, color = 0x6ea8ff) {
    this.hoverEdges.material.color.setHex(color); // trim/dissolve previews pass red
    if (!edgeIds || !edgeIds.length) { this.hoverEdges.visible = false; return; }
    const model = this.app.model;
    const ep = [];
    for (const id of edgeIds) {
      const e = model.edges.get(id); if (!e) continue;
      const a = model.vp(e.a), b = model.vp(e.b);
      if (a && b) ep.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    if (!ep.length) { this.hoverEdges.visible = false; return; }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    this.hoverEdges.geometry.dispose();
    this.hoverEdges.geometry = eg;
    this.hoverEdges.visible = true;
  }

  // -------------------------------------------------------------- preview helpers
  clearPreview() {
    for (const ch of [...this.previewGroup.children]) {
      this.previewGroup.remove(ch);
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) ch.material.dispose();
    }
    this.clearSticky(); // sticky labels share the preview lifecycle
  }
  previewLine(pts, color = 0x2b2b2b, dashed = false) {
    if (!pts || pts.length < 2) return null;
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, p.y, p.z)));
    let mat;
    if (dashed) {
      mat = new THREE.LineDashedMaterial({ color, dashSize: 0.45, gapSize: 0.3, depthTest: false });
    } else {
      mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    }
    const l = new THREE.Line(g, mat);
    if (dashed) l.computeLineDistances();
    l.renderOrder = 25;
    this.previewGroup.add(l);
    return l;
  }
  previewLoop(pts, color = 0x2b2b2b) {
    if (!pts || pts.length < 2) return;
    this.previewLine(pts.concat([pts[0]]), color);
  }
  previewFill(ringsList, color = 0x2f6fdb, alpha = 0.18) {
    // ringsList: [{outer:[pts], holes:[[pts]]}]
    const pos = [], nor = [];
    for (const r of ringsList) {
      const n = G.loopNormal(r.outer);
      if (G.isZero(n)) continue;
      const { u, v } = G.basisForNormal(n);
      const o = r.outer[0];
      const t2 = (p) => new THREE.Vector2(G.to2D(p, o, u, v).x, G.to2D(p, o, u, v).y);
      try {
        const tris = THREE.ShapeUtils.triangulateShape(r.outer.map(t2), (r.holes || []).map(h => h.map(t2)));
        const all = r.outer.concat((r.holes || []).flatMap(h => h));
        for (const t of tris) for (const idx of t) { const p = all[idx]; pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); }
      } catch (e) { }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const m = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: alpha, side: THREE.DoubleSide,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 24;
    this.previewGroup.add(mesh);
  }
  previewQuadsBetween(ringA, ringB, color = 0x9db8dc, alpha = 0.15) {
    // translucent side walls between two rings (push/pull preview)
    const pos = [];
    for (let i = 0; i < ringA.length; i++) {
      const a0 = ringA[i], a1 = ringA[(i + 1) % ringA.length];
      const b0 = ringB[i], b1 = ringB[(i + 1) % ringB.length];
      pos.push(a0.x, a0.y, a0.z, a1.x, a1.y, a1.z, b1.x, b1.y, b1.z);
      pos.push(a0.x, a0.y, a0.z, b1.x, b1.y, b1.z, b0.x, b0.y, b0.z);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: alpha, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 23;
    this.previewGroup.add(mesh);
  }
  showSnapDot(p, kind) {
    if (!p) { this.snapDot.visible = false; return; }
    const colors = { endpoint: 0x1a7f37, midpoint: 0x0e8385, center: 0xb35900, axis: 0xd23c2e, edge: 0xd23c2e, face: 0x3e66c4, ground: 0x3d9e4e };
    this.snapDot.material.color.setHex(colors[kind] || 0x1a7f37);
    this.snapDot.geometry.attributes.position.setXYZ(0, p.x, p.y, p.z);
    this.snapDot.geometry.attributes.position.needsUpdate = true;
    this.snapDot.visible = true;
  }
  hideSnapDot() { this.snapDot.visible = false; }
  hudLabel(sx, sy, text, color = '#333') {
    if (!text || !isFinite(sx) || !isFinite(sy)) return;
    this.hudItems.push({ sx, sy, text, color });
  }
  stickyLabel(p, text, color = '#333', dx = 0, dy = -12) {
    if (!p || !text || !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return;
    this.hudSticky.push({ x: p.x, y: p.y, z: p.z, text, color, dx, dy });
  }
  clearSticky() { this.hudSticky.length = 0; }
  /**
   * Pin a persistent measurement badge at a world point (Measure Area).
   * faceId (optional) links the pin to the measured face: the face stays
   * filled GREEN until the pins are cleared.
   */
  pinLabel(p, text, color = '#1d4f9c', faceId = null) {
    if (!p || !text || !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return;
    this.hudPins.push({ x: p.x, y: p.y, z: p.z, text, color, faceId });
    this._syncMeasureFaces();
  }
  clearPins() {
    this.hudPins.length = 0;
    this._syncMeasureFaces();
  }
  /** Transient green highlight (fill + outline) of the face being measured. */
  setMeasureHover(faceId) {
    this._measureHoverFace = faceId;
    this._syncMeasureFaces();
  }
  /** Rebuild the green measured-face overlay (fill + boundary outline) from
   *  the live pins plus the face under the measuring cursor. */
  _syncMeasureFaces() {
    if (!this.measureFace) return;
    const model = this.app.model;
    const extra = this._measureHoverFace != null && model.faces.has(this._measureHoverFace)
      ? [this._measureHoverFace] : [];
    const ids = [...new Set([
      ...this.hudPins.map(p => p.faceId).filter(id => id != null && model.faces.has(id)),
      ...extra,
    ])];
    const pos = [];
    const lines = [];
    for (const fid of ids) {
      const f = model.faces.get(fid);
      const outer = model.pts(f.loop);
      const n = G.loopNormal(outer);
      if (G.isZero(n)) continue;
      const { u, v } = G.basisForNormal(n);
      const o = outer[0];
      const t2 = (p) => new THREE.Vector2(G.to2D(p, o, u, v).x, G.to2D(p, o, u, v).y);
      try {
        const tris = THREE.ShapeUtils.triangulateShape(outer.map(t2), f.holes.map(h => model.pts(h).map(t2)));
        const all = outer.concat(f.holes.flatMap(h => model.pts(h)));
        for (const t of tris) for (const idx of t) { const p = all[idx]; pos.push(p.x, p.y, p.z); }
      } catch (e) { /* skip untriangulatable faces */ }
      // bright boundary of the highlighted face (outer ring + opening rings)
      for (const ring of model.rings(f)) {
        for (let i = 0; i < ring.length; i++) {
          const a = model.vp(ring[i]), b = model.vp(ring[(i + 1) % ring.length]);
          if (a && b) lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.measureFace.geometry.dispose();
    this.measureFace.geometry = fg;
    this.measureFace.visible = pos.length > 0;
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.measureOutline.geometry.dispose();
    this.measureOutline.geometry = og;
    this.measureOutline.visible = lines.length > 0;
  }

  // -------------------------------------------------------------- camera
  activeCamera() { return this.cam.ortho ? this.ortho : this.persp; }
  applyCamera() {
    const { target, dist, az, el } = this.cam;
    const x = target.x + dist * Math.cos(el) * Math.cos(az);
    const y = target.y + dist * Math.cos(el) * Math.sin(az);
    const z = target.z + dist * Math.sin(el);
    const cam = this.activeCamera();
    cam.position.set(x, y, z);
    cam.up.set(0, 0, 1);
    cam.lookAt(new THREE.Vector3(target.x, target.y, target.z));
    if (this.cam.ortho) {
      const h = dist * Math.tan(this.cam.fov * RAD / 2);
      const asp = this.canvas.clientWidth / Math.max(this.canvas.clientHeight, 1);
      this.ortho.top = h; this.ortho.bottom = -h;
      this.ortho.left = -h * asp; this.ortho.right = h * asp;
      this.ortho.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true); // keep picks correct even if the render loop is paused
    this.sky.position.set(target.x, target.y, target.z);
    this.sun.target.position.set(target.x, target.y, target.z);
  }
  orbit(dx, dy) {
    // Standard plan/elevation views lock the camera: the user returns to 3D
    // explicitly via Camera ▸ Standard View: Iso (pan/zoom stay available)
    if (this.viewLocked) {
      if (this.app && this.app.setStatus)
        this.app.setStatus(`View locked (${this.lockedViewName}) — pan/zoom work; pick Camera ▸ Standard View: Iso to orbit again.`);
      return;
    }
    this.cam.az -= dx * 0.0065;
    this.cam.el = Math.max(-89.9 * RAD, Math.min(89.9 * RAD, this.cam.el + dy * 0.0065));
  }
  pan(dx, dy) {
    const cam = this.activeCamera();
    const k = this.cam.dist * 0.0011;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    this.cam.target.x -= (right.x * dx - up.x * dy) * k;
    this.cam.target.y -= (right.y * dx - up.y * dy) * k;
    this.cam.target.z -= (right.z * dx - up.z * dy) * k;
  }
  zoomBy(f) {
    this.cam.dist = Math.max(0.05, Math.min(1800, this.cam.dist * f));
  }
  setStandardView(name) {
    const views = {
      iso: [-55, 28], top: [-90, 89.9], bottom: [-90, -89.9],
      front: [-90, 0], back: [90, 0], right: [0, 0], left: [180, 0],
    };
    const v = views[name] || views.iso;
    this.cam.az = v[0] * RAD; this.cam.el = v[1] * RAD;
    // only Iso (the 3D view) unlocks orbiting — plan/elevation views keep the
    // camera fixed until the user picks another standard view explicitly
    this.viewLocked = name !== 'iso';
    this.lockedViewName = this.viewLocked ? name : null;
  }
  zoomExtents() {
    const model = this.app.model;
    const vids = [...model.vertices.keys()];
    const bb = model.bbox(vids);
    let center, radius;
    if (bb) {
      center = bb.center;
      radius = Math.max(G.len(bb.size) / 2, 0.6);
    } else { center = G.v(); radius = 6; }
    this.cam.target = G.clone(center);
    this.cam.dist = Math.max(radius / Math.tan(this.cam.fov * RAD / 2) * 1.15, 0.8);
    const sc2 = radius * 1.35;
    const s = this.sun.shadow.camera;
    s.left = -sc2; s.right = sc2; s.top = sc2; s.bottom = -sc2;
    s.updateProjectionMatrix();
  }

  // ------------------------------------------------- coordinate boundary
  // Four frames, one rule: below this block every 2D point is a ScreenPt
  // ({x, y} in canvas-local CSS pixels). Page coordinates from DOM events
  // (ev.clientX/clientY — "ClientPt") may ONLY enter through eventPt()/toLocal().
  //
  // The canonical PUBLIC conversions (client-space in, world out):
  //   clientToWorldRay(clientX, clientY)   -> {ro, rd} world ray
  //   clientToCanvasPixels(clientX, clientY) -> {x, y} canvas-local pixels
  //   worldToScreenPixels(Vector3)         -> {x, y, visible}
  // Internals below (eventPt/toLocal/ndcAt/rayFrom/toScreen) implement them;
  // tools and inference consume the three public methods (or eventPt, the
  // single event-entry site) and never raw ev.clientX/Y.
  //
  //   eventPt(ev)   ClientPt -> ScreenPt   the only event-conversion site
  //   toLocal(x,y)  ClientPt -> ScreenPt   raw numbers variant
  //   toClient(s)   ScreenPt -> ClientPt   for page-positioned DOM (menus etc.)
  //   ndcAt(s)      ScreenPt -> NDC [-1,1]²
  //   rayFrom(s)    ScreenPt -> world ray {ro, rd}
  //   groundAt(s)   ScreenPt -> World|null (z = 0 plane)
  //   anyPlaneAt(s) ScreenPt -> World      (fallback point along the ray)
  //   pickFaceAt(s) ScreenPt -> face id|null
  //   toScreen(p)   World    -> ScreenPt   ({x, y, behind})
  clientToWorldRay(clientX, clientY) {
    const { ro, rd } = this.rayFrom(this.toLocal(clientX, clientY));
    return { ro, rd };
  }
  clientToCanvasPixels(clientX, clientY) {
    return this.toLocal(clientX, clientY);
  }
  worldToScreenPixels(p) {
    const s = this.toScreen(p);
    return { x: s.x, y: s.y, visible: !s.behind && isFinite(s.x) && isFinite(s.y) };
  }
  eventPt(ev) {
    return this.clientToCanvasPixels(ev.clientX, ev.clientY);
  }
  toLocal(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
  toClient(s) {
    const r = this.canvas.getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top };
  }
  ndcAt(s) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2((s.x / r.width) * 2 - 1, -(s.y / r.height) * 2 + 1);
  }
  rayFrom(s) {
    this.applyCamera(); // never depend on the render loop (paused when hidden)
    this.raycaster.setFromCamera(this.ndcAt(s), this.activeCamera());
    const ro = this.raycaster.ray.origin;
    const rd = this.raycaster.ray.direction;
    return { ro: G.v(ro.x, ro.y, ro.z), rd: G.v(rd.x, rd.y, rd.z) };
  }
  pickFaceAt(s) {
    if (!this.faceMesh.visible) return null;
    this.applyCamera();
    this.raycaster.setFromCamera(this.ndcAt(s), this.activeCamera());
    // the merged mesh AND every element's unified Group are pick targets;
    // each mesh carries its own triangle -> faceId map in userData.
    // Locked / hidden elements are not pick targets at all.
    const app = this.app;
    const pickable = obj => {
      const eid = obj.userData && obj.userData.elementId;
      if (!eid) return true;
      return !app.isEntityLocked(eid) && !app.isEntityHidden(eid);
    };
    const targets = [this.faceMesh];
    if (this.elementsRoot) targets.push(...this.elementsRoot.children.filter(pickable));
    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    // on coincident (coplanar) hits prefer the smallest face — drawing over a
    // face should select the shape you just drew, not the face under it
    const d0 = hits[0].distance;
    let best = null, bestArea = Infinity;
    for (const h of hits) {
      if (h.distance - d0 > 1e-4) break;
      const map = (h.object.userData && h.object.userData.triangleFace) || this.triangleFace;
      const fid = map[h.faceIndex];
      if (fid == null) continue;
      const f = this.app.model.faces.get(fid);
      if (!f) continue;
      if (this.app.isFaceLocked(f) || this.app.isEntityHidden(f.userData && f.userData.bimEntityId)) continue;
      const area = this.app.model.faceArea(f);
      if (area < bestArea) { bestArea = area; best = fid; }
    }
    return best;
  }
  groundAt(s) {
    const { ro, rd } = this.rayFrom(s);
    return G.rayPlane(ro, rd, { n: G.v(0, 0, 1), d: 0 });
  }
  anyPlaneAt(s) {
    const { ro, rd } = this.rayFrom(s);
    return G.add(ro, G.mul(rd, 12)); // fallback point along ray
  }
  toScreen(p) {
    this.applyCamera();
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.activeCamera());
    const r = this.canvas.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * r.width, y: (-v.y + 1) / 2 * r.height, behind: v.z > 1 };
  }

  // -------------------------------------------------------------- loop
  _drawHudItem(ctx, sx, sy, text, color) {
    if (!isFinite(sx) || !isFinite(sy)) return;
    const t = ctx.measureText(text);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(sx + 10, sy - 20, t.width + 10, 18);
    ctx.fillStyle = color;
    ctx.fillText(text, sx + 15, sy - 7);
  }
  _tick() {
    requestAnimationFrame(this._tick);
    this.applyCamera();
    // HUD
    const ctx = this.hudCtx;
    const w = this.hud.width, h = this.hud.height;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '600 12.5px system-ui, sans-serif';
    for (const it of this.hudItems) this._drawHudItem(ctx, it.sx, it.sy, it.text, it.color);
    this.hudItems = [];
    // persistent labels: re-project the world anchor each frame so they stay
    // visible while the pointer rests and follow the camera
    const cam = this.activeCamera();
    for (const it of this.hudSticky) {
      const v = new THREE.Vector3(it.x, it.y, it.z).project(cam);
      if (v.z > 1) continue; // behind the camera
      this._drawHudItem(ctx, (v.x + 1) / 2 * w + it.dx, (-v.y + 1) / 2 * h + it.dy, it.text, it.color);
    }
    // pinned measurements (Measure Area): world-anchored badges that survive
    // preview clears and tool switches until explicitly removed
    for (const it of this.hudPins) {
      const v = new THREE.Vector3(it.x, it.y, it.z).project(cam);
      if (v.z > 1) continue;
      const x = (v.x + 1) / 2 * w, y = (-v.y + 1) / 2 * h;
      if (!isFinite(x) || !isFinite(y)) continue;
      const t = ctx.measureText(it.text);
      ctx.fillStyle = 'rgba(29, 79, 156, 0.92)';
      ctx.fillRect(x - t.width / 2 - 9, y - 24, t.width + 18, 19);
      ctx.fillStyle = '#ffffff';
      const prevAlign = ctx.textAlign;
      ctx.textAlign = 'center';
      ctx.fillText(it.text, x, y - 10);
      ctx.textAlign = prevAlign;
    }
    this.renderer.render(this.scene, cam);
  }
  _resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    this.hud.width = w; this.hud.height = h;
    this.hud.style.width = w + 'px'; this.hud.style.height = h + 'px';
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
  }
  exportPNG() {
    const a = document.createElement('a');
    a.download = 'websketch.png';
    a.href = this.renderer.domElement.toDataURL('image/png');
    a.click();
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
window.Viewport = Viewport;
window.hexToRgb = hexToRgb;
