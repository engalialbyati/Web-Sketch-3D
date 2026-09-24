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
    // ON-DEMAND SHADOWS: the sun and the model are static between edits —
    // re-render the (2048²) shadow map only when the scene actually changes
    // (rebuild() flags it). Re-rendering it every frame was pure GPU waste.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    // ON-DEMAND RENDERING: a CAD scene is static while the user thinks.
    // invalidate() marks the frame dirty (model/preview/overlay change);
    // camera movement and a short settle window after any interaction also
    // render. Idle GPU cost drops to ~zero instead of a permanent 60 fps.
    this._dirty = true;
    this._settleUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 500;
    this._camSig = '';
    this.perfHud = false;          // View ▸ Performance HUD toggle
    this._fps = 0; this._fpsLast = 0; this._fpsFrames = 0;

    // HUD overlay for text labels near the cursor
    this.hud = document.createElement('canvas');
    this.hud.className = 'hud';
    container.appendChild(this.hud);
    this.hudCtx = this.hud.getContext('2d');
    this.hudItems = [];
    this.hudGlyphs = []; // AutoCAD osnap markers (endpoint square, midpoint triangle, center circle)
    this.snapMarks = []; // tool-placed point markers (e.g. an arc's start/end)
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
    this.persp = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
    this.persp.up.set(0, 0, 1);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -4000, 4000);
    this.ortho.up.set(0, 0, 1);

    this._buildEnvironment();
    this._buildModelGroups();
    this._buildOverlays();

    // BVH-accelerated raycasts (the ThatOpen pattern): patch the prototype
    // once, and every mesh whose geometry got a boundsTree raycasts in
    // O(log n) instead of O(triangles). Element meshes get their tree in
    // rebuildElement/_syncElementGeometry (BimElement.js) right after the
    // buffers are filled; trees die with the geometry (disposeBoundsTree
    // is wired into THREE's dispose below).
    if (window.MeshBVHLib) {
      THREE.Mesh.prototype.raycast = MeshBVHLib.acceleratedRaycast;
      THREE.LineSegments.prototype.raycast = MeshBVHLib.acceleratedRaycast;
      THREE.BufferGeometry.prototype.computeBoundsTree = MeshBVHLib.computeBoundsTree;
      THREE.BufferGeometry.prototype.disposeBoundsTree = MeshBVHLib.disposeBoundsTree;
      const _geoDispose = THREE.BufferGeometry.prototype.dispose;
      THREE.BufferGeometry.prototype.dispose = function () {
        if (this.boundsTree) this.disposeBoundsTree();
        _geoDispose.call(this);
      };
    }

    this.raycaster = new THREE.Raycaster();

    // ---- GPU ID-BUFFER PICKING (the ThatOpen FastModelPicker pattern) ----
    // Element meshes carry a uniform per-vertex pickId; the merged free-face
    // mesh carries per-face ids. A pick renders ONLY those meshes with the
    // id-encoding shader into a reusable target, scissored to 4×4 px around
    // the cursor — one readPixels replaces the O(#elements) raycast loop.
    // faceId still comes from a single-element BVH raycast (exact + cheap);
    // identification (WHICH element) is the part the GPU now owns.
    this.gpuPick = true;
    this._pickRegistry = [null]; // pickId -> {entity} | {face}
    this._pickTarget = null;
    this._pickMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      vertexShader: [
        'attribute float pickId;',
        'varying float vPickId;',
        'void main() {',
        '  vPickId = pickId;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying float vPickId;',
        'void main() {',
        '  float id = floor(vPickId) + 0.5;',
        '  float b = floor(id / 65536.0);',
        '  float g = floor((id - b * 65536.0) / 256.0);',
        '  float r = id - b * 65536.0 - g * 256.0;',
        '  gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);',
        '}',
      ].join('\n'),
    });

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
    // reinforcement gets its OWN pass: full-opacity bars over the ghosted
    // solids in X-ray. Sharing the 55% ghost material buried every cage
    // inside concrete (depth-written front faces rejected the interior).
    this.rebarMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.faceMat.clone());
    this.rebarMesh.material.uniforms.uAlphaMul.value = 1.0;
    this.rebarMesh.material.depthWrite = false;

    this.scene.add(this.rebarMesh);

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

    // styled edges (CAD linetypes/lineweights + raw-geometry layers): one
    // LineSegments per non-continuous linetype (dash patterns) and one
    // clip-space ribbon mesh per heavy weight (>=2 px — WebGL line width is
    // capped at 1, so weight renders as a screen-parallel quad). Children are
    // rebuilt together with edgeLines in rebuild().
    this.styledEdges = new THREE.Group();
    this.styledEdges.name = 'styled-edges';
    this.scene.add(this.styledEdges);
    this.heavyMat = new THREE.ShaderMaterial({
      uniforms: {
        uRes: { value: new THREE.Vector2(800, 600) },
        uPx: { value: 2 },
        uColor: { value: new THREE.Color(0x26262a) },
      },
      vertexShader: [
        'attribute vec3 other;',      // the segment's far endpoint
        'attribute float side;',      // -1/+1: which edge of the ribbon
        'uniform vec2 uRes; uniform float uPx;',
        'void main() {',
        '  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(other, 1.0);',
        '  vec2 d = c0.xy / c0.w - c1.xy / c1.w;',
        '  float l = length(d);',
        '  if (l > 1e-9) {',
        '    vec2 p = vec2(-d.y, d.x) / l * uPx * 2.0 / uRes * c0.w;',
        '    c0.xy += p * side;',
        '  }',
        '  gl_Position = c0;',
        '}',
      ].join('\n'),
      fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }',
    });

    // LIGHT REBAR: billboarded centerline ribbons (one quad per bar
    // segment) instead of the pipe solids - a 3000-bar cage drops from
    // ~250k triangles + 500k edges to ~20k quads with no model edges.
    // OPAQUE with depth writes: the bars output full alpha anyway, and the
    // earlier transparent:true + renderOrder trick (drawn after the X-ray
    // ghosts) disabled depth writes — bars could not occlude EACH OTHER and
    // background bars painted over foreground ones (buffer order, not Z).
    // Now the Z buffer owns occlusion; the X-ray ghosts (no depth write)
    // still blend their thin veil ON TOP, so cages stay visible inside.
    this.rebarRibbonMat = this.heavyMat.clone();
    this.rebarRibbonMat.uniforms.uColor.value = new THREE.Color(0x3b4046);
    this.rebarRibbonMat.uniforms.uPx.value = 3.2;
    this.rebarRibbonMat.transparent = false;
    this.rebarRibbonMat.depthTest = true;
    this.rebarRibbonMat.depthWrite = true;
    this.rebarRibbon = new THREE.Mesh(new THREE.BufferGeometry(), this.rebarRibbonMat);
    this.rebarRibbon.frustumCulled = false;
    this.rebarRibbon.visible = false;
    this.scene.add(this.rebarRibbon);

    // DETAIL rebar: GPU-INSTANCED hex prisms (the CSI/ETABS approach — any
    // cage size is ONE draw call). Same opaque + depth-write contract: real
    // Z occlusion between bars and against all opaque geometry.
    this.rebarSolidsMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.5, metalness: 0.35 });
    this.rebarSolidsMat.transparent = false;
    this.rebarSolidsMat.depthTest = true;
    this.rebarSolidsMat.depthWrite = true;
    this.rebarSolids = new THREE.Mesh(new THREE.BufferGeometry(), this.rebarSolidsMat);
    this.rebarSolids.visible = false;
    this.scene.add(this.rebarSolids);
    this._rbSerialBuilt = -1;
    this._rbInstPid = null;
    this._rbSelPid = null;
    this._rebarPrismGeoCached = null;
    this.rebarMode = 'detail';

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
    // geometry changed: a stale osnap glyph may point at deleted geometry
    // (the "endpoint still there after erase" freeze) — drop it now
    this.hideSnapDot();
    // no-op gate: rebuild runs on every opDone(), but ops that changed
    // nothing (no-op transactions, notification-triggered refreshes) leave
    // the B-Rep and the view filters untouched — the scene is already in
    // sync, so the whole triangulation pass is skipped. model.version is
    // bumped by every kernel choke point and by touch() for in-place display
    // edits (paint, hide/soften, entity/layer visibility).
    const model = this.app.model;
    const ff = this.faceFilter || null, ef = this.edgeFilter || null, elf = this.elementFilter || null;
    const sig = model.version + '/' + model.faces.size + '/' + model.edges.size + '/' + model.vertices.size;
    if (this._rbModel === model && this._rbSig === sig && this._rbFF === ff && this._rbEF === ef && this._rbELF === elf) return;
    this._rbModel = model; this._rbSig = sig; this._rbVersion = model.version;
    this._rbFF = ff; this._rbEF = ef; this._rbELF = elf;
    // scene geometry changed: re-render this frame AND refresh the cached
    // shadow map (element shadows track the model, not the camera)
    this.invalidate();
    // unified element Groups first: they claim their faces; the merged mesh
    // renders only the remaining (plain Free Drawing) geometry
    const elementFaceIds = (this.app.elements && this.app.elements.rebuild) ? this.app.elements.rebuild() : new Set();
    // element-geometry signature (count + id sum): deleting/editing an
    // element changes element-owned faces WITHOUT touching the merged mesh
    // below — without this, geoChanged stayed false and the cached shadow
    // map kept rendering deleted elements' shadows
    let elemSig = elementFaceIds.size;
    for (const id of elementFaceIds) elemSig += id;
    const elemGeoChanged = this._rbElemSig !== undefined && this._rbElemSig !== elemSig;
    this._rbElemSig = elemSig;
    // element-owned edges render inside their own Groups now — collect their
    // ids once so the merged edge pass (and its O(all-edges) walk) skips them
    const elementEdgeIds = new Set();
    for (const fid of elementFaceIds) {
      const f = model.faces.get(fid);
      if (!f) continue;
      for (const ring of model.rings(f)) {
        const pts = model.pts(ring);
        for (let i = 0; i < pts.length; i++) {
          const e = model.findEdge(ring[i], ring[(i + 1) % pts.length]);
          if (e) elementEdgeIds.add(e.id);
        }
      }
    }
    // display-only view filters (Level View plan isolation) — never model state
    // hidden elements leave the render (and with it, picking) entirely —
    // isEntityHidden includes the entity's layer being OFF
    if (this.app.elements)
      for (const el of this.app.elements.list()) {
        el.group.visible = !this.app.isEntityHidden(el.entity.id) && (elf ? !!elf(el.entity) : true);
        // layer 1 = the GPU pick pass; layer 0 = normal render
        if (el.mesh) el.mesh.layers.enable(1);
      }
    // GPU pick ids: one per element mesh (uniform), continuing per-face for
    // the merged free-face mesh below
    this._pickRegistry = [null];
    let pickId = 1;
    const pickArr = [];
    let elCount = 0;
    if (this.app.elements)
      for (const el of this.app.elements.list()) {
        if (!el.mesh || !el.mesh.geometry.getAttribute('position')) continue;
        const n = el.mesh.geometry.getAttribute('position').count;
        el.mesh.geometry.setAttribute('pickId',
          new THREE.BufferAttribute(new Float32Array(n).fill(pickId), 1));
        this._pickRegistry[pickId] = { entity: el.entity.id };
        el.mesh.userData.pickId = pickId++;
        elCount++;
      }
    // GPU broad-phase auto-gate (measured): the scissored id-render +
    // readback costs a fixed ~1.2ms; raycasting N BVH'd element meshes
    // costs ~0.007ms each + per-mesh overhead. Below ~120 elements the
    // plain CPU loop is faster, so the GPU pass switches on above that.
    // view.gpuPickOverride forces either mode for testing.
    this.gpuPick = this.gpuPickOverride !== undefined
      ? this.gpuPickOverride : elCount > 120;
    // per-face triangulation cache — the earcut in THREE.ShapeUtils is
    // allocation-heavy and was re-run for EVERY face on EVERY commit; a
    // commit that moves one wall re-triangulated the whole model. Entries are
    // content-keyed (vertex ids + quantized coordinates + paint state), so
    // correctness never depends on which code path mutated the face.
    if (!this._triCache) this._triCache = new Map();
    const cache = this._triCache;
    // prune dead-face entries occasionally so long edit sessions cannot grow
    // the cache without bound
    if (cache.size > model.faces.size + 256)
      for (const fid of cache.keys()) if (!model.faces.has(fid)) cache.delete(fid);
    const pos = [], col = [], nor = [];
    this.triangleFace = [];
    this._mergedFaces = []; // [{id, aabb}] — picking broad-phase index
    let geoChanged = false;
    const prevFaceCount = this._rbFaceCount || 0;
    // raw-geometry layers: OFF layers leave the merged mesh (and picking);
    // a layer color tints unpainted faces, same ByLayer rule as element groups
    const appLayers = (this.app.layers || []);
    const hiddenLayers = new Set(appLayers.filter(l => l.visible === false).map(l => l.id));
    const layerTints = new Map(appLayers.filter(l => l.color).map(l => [l.id, l.color]));
    // rebar display NEVER flows through the face pass: solid bars are
    // GPU-instanced prisms built from the centerline records (a materialized
    // 500k-face pipe cage turned every rebuild into a 1.3 s triangulation
    // stall and dragged orbiting to ~5 fps)
    for (const f of model.faces.values()) {
      if (f.hidden || (ff && !ff(f)) || elementFaceIds.has(f.id)) continue;
      if (f.userData && f.userData.rebar) continue; // instanced pass owns rebar
      if (hiddenLayers.has(f.layerId || '0')) continue;
      // content key: ring vertex ids + quantized coords + color/alpha
      const parts = [];
      for (const ring of model.rings(f)) {
        const pts = model.pts(ring);
        for (let j = 0; j < ring.length; j++) {
          const p = pts[j];
          parts.push(ring[j], Math.round(p.x * 1e5), Math.round(p.y * 1e5), Math.round(p.z * 1e5));
        }
      }
      const key = parts.join(',') + '|' + (f.color || '') + ',' + (f.alpha == null ? 1 : f.alpha)
        + ',' + (layerTints.get(f.layerId || '0') || '');
      let entry = cache.get(f.id);
      if (!entry || entry.key !== key) {
        const outer = model.pts(f.loop);
        const n = G.loopNormal(outer);
        if (G.isZero(n)) { cache.delete(f.id); continue; }
        const { u, v } = G.basisForNormal(n);
        const o = outer[0];
        const contour = outer.map(p => new THREE.Vector2(G.to2D(p, o, u, v).x, G.to2D(p, o, u, v).y));
        const holes = f.holes.map(h => model.pts(h).map(p => new THREE.Vector2(G.to2D(p, o, u, v).x, G.to2D(p, o, u, v).y)));
        let tris = [];
        try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { tris = []; }
        const all = outer.concat(f.holes.flatMap(h => model.pts(h)));
        const paint = f.color || layerTints.get(f.layerId || '0') || null; // ByLayer tint
        const c = paint ? hexToRgb(paint) : { r: 1, g: 1, b: 1 };
        const a = f.alpha == null ? 1 : f.alpha;
        const tp = [];
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (const t of tris) {
          for (const idx of t) {
            const p = all[idx];
            tp.push(p.x, p.y, p.z);
            if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
            if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z;
          }
        }
        entry = { key, pos: tp, n, r: c.r, g: c.g, b: c.b, a, aabb: [x0, y0, z0, x1, y1, z1] };
        cache.set(f.id, entry);
        geoChanged = true; // this face's triangles changed
      }
      const P = pos, N2 = nor, C = col, K = pickArr;
      for (let k = 0; k < entry.pos.length; k += 3) {
        P.push(entry.pos[k], entry.pos[k + 1], entry.pos[k + 2]);
        N2.push(entry.n.x, entry.n.y, entry.n.z);
        C.push(entry.r, entry.g, entry.b, entry.a);
      }
      const ntri = entry.pos.length / 9;
      for (let k = 0; k < ntri; k++) {
        this.triangleFace.push(f.id);
        K.push(pickId, pickId, pickId); // per-vertex constant: the face's id
      }
      this._pickRegistry[pickId++] = { face: f.id };
      this._mergedFaces.push({ id: f.id, aabb: entry.aabb });
    }
    this._rbFaceCount = this._mergedFaces.length;
    if (this._rbFaceCount !== prevFaceCount) geoChanged = true; // faces born/died
    if (elemGeoChanged) geoChanged = true; // element meshes born/died/edited
    // the shadow map only needs refreshing when triangles actually changed —
    // paint jobs and selection passes were re-rendering 2048² shadows for
    // nothing
    if (geoChanged) this.renderer.shadowMap.needsUpdate = true;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    if (pickArr.length) fg.setAttribute('pickId', new THREE.Float32BufferAttribute(pickArr, 1));
    this.faceMesh.layers.enable(1); // layer 1 = GPU pick pass
    if (fg.computeBoundsTree && pos.length > 9 * 64) // BVH pays off above a few dozen tris
      fg.computeBoundsTree({ maxLeafSize: 1, strategy: window.MeshBVHLib ? MeshBVHLib.SAH : 2 });
    this.faceMesh.geometry.dispose();
    this.faceMesh.geometry = fg;
    // rebarMesh pass RETIRED: solid bars render as GPU-instanced prisms from
    // the centerline cache below (the pipe-face buffer was the detail-mode
    // stall). The mesh object stays for pick-pass compatibility, always empty.
    this.rebarMesh.visible = false;
    // ---- REBAR DISPLAY: ribbons (light) AND instanced solid prisms (detail)
    // from ONE source — records ∪ face-stamped centerlines, deduped by pid —
    // rebuilt only when the rebar serial changes so mode switches and
    // selection rebuilds never re-walk the bars
    {
      const serial = model._rebarSerial || 0;
      if (serial !== this._rbSerialBuilt) {
        this._rbSerialBuilt = serial;
        const bars = [];
        if (model._rebarRecords)
          for (const rec of model._rebarRecords.values())
            bars.push({ pid: rec.pid, line: rec.line, dia: rec.dia });
        const recPids = model._rebarRecords;
        for (const f of model.faces.values()) {
          const meta = f.userData && f.userData.rebar;
          if (!meta || !meta.line || (recPids && recPids.has(meta.pid))) continue;
          bars.push({ pid: meta.pid, line: meta.line, dia: meta.diameter });
        }
        // one quad per segment — 4 corners (a,-1) (a,+1) (b,+1) (b,-1) plus an
        // explicit index: a bare 2-vertex push makes the non-indexed mesh weld
        // triangles ACROSS segments (and across bars), so separate rebar looks
        // connected to its neighbours
        const rp = [], ro = [], rs = [], ridx = [];
        const pushSeg = (a, b2) => {
          const b0 = rp.length / 3;
          rp.push(a[0], a[1], a[2], a[0], a[1], a[2], b2[0], b2[1], b2[2], b2[0], b2[1], b2[2]);
          ro.push(b2[0], b2[1], b2[2], b2[0], b2[1], b2[2], a[0], a[1], a[2], a[0], a[1], a[2]);
          rs.push(-1, 1, 1, -1);
          ridx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
        };
        // instanced hex prisms — CSI-style solid bars: one instance per
        // polyline segment, ~24 tris each, ONE draw call for any cage size.
        // Each segment is lengthened by ~0.85 r per end so bent joints close.
        const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
        const UP = new THREE.Vector3(0, 1, 0), D = new THREE.Vector3();
        const PC = new THREE.Vector3(), SC = new THREE.Vector3();
        const mats = [], pids = [];
        for (const b of bars) {
          for (let k = 1; k < b.line.length; k++) {
            const a = b.line[k - 1], c = b.line[k];
            pushSeg(a, c);
            const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
            const len = Math.hypot(dx, dy, dz);
            if (!(len > 1e-9)) continue;
            const r = Math.max(0.003, ((a[3] != null ? a[3] : b.dia) + (c[3] != null ? c[3] : b.dia)) / 4);
            D.set(dx / len, dy / len, dz / len);
            Q.setFromUnitVectors(UP, D);
            PC.set((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
            SC.set(r, (len + r * 1.7) / 2, r);
            mats.push(M.compose(PC, Q, SC).clone());
            pids.push(b.pid);
          }
        }
        const rbg = new THREE.BufferGeometry();
        rbg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
        rbg.setAttribute('other', new THREE.Float32BufferAttribute(ro, 3));
        rbg.setAttribute('side', new THREE.Float32BufferAttribute(rs, 1));
        rbg.setIndex(ridx);
        this.rebarRibbon.geometry.dispose();
        this.rebarRibbon.geometry = rbg;
        // swap in a right-sized InstancedMesh (capacity is fixed at build)
        const old = this.rebarSolids;
        const nm = new THREE.InstancedMesh(this._rebarPrismGeoCached || (this._rebarPrismGeoCached = this._rebarPrismGeo()),
          this.rebarSolidsMat, Math.max(mats.length, 1));
        nm.count = mats.length;
        for (let i = 0; i < mats.length; i++) nm.setMatrixAt(i, mats[i]);
        if (nm.instanceMatrix) nm.instanceMatrix.needsUpdate = true;
        nm.frustumCulled = false;
        nm.visible = this.rebarMode === 'detail';
        const white = new THREE.Color(0xffffff);
        for (let i = 0; i < mats.length; i++) nm.setColorAt(i, white); // highlight base
        if (nm.instanceColor) nm.instanceColor.needsUpdate = true;
        this.scene.remove(old);
        if (old.dispose) old.dispose();
        this.rebarSolids = nm;
        this.scene.add(nm);
        this._rbInstPid = pids;
        this._rbSelPid && this.setRebarSelection(this._rbSelPid);
      }
      this.rebarRibbon.visible = this.rebarMode === 'light';
      if (this.rebarSolids) this.rebarSolids.visible = this.rebarMode === 'detail';
    }

    // edges (element edges included — shared/welded edges belong to the
    // whole scene graph; hidden edges are skipped like hidden faces).
    // Non-continuous linetypes and heavy lineweights (the Properties panel's
    // CAD line styles) bucket into styledEdges instead of the plain pass.
    const ep = [];
    const dashPts = {}; // ltIdx -> [xyz,...]
    const heavyPts = {}; // lwIdx -> [xyz,...]
    const LTT = window.Model ? Model.LINETYPES : [];
    const LWW = window.Model ? Model.LINEWEIGHTS : [];
    for (const e of model.edges.values()) {
      // rebar pipe edges are pure overhead: 100k-bar cages carry ~500k
      // edges (a ~1M-vertex line buffer drawn EVERY frame). The pipes
      // render as faces in the rebar pass - their wireframe adds noise
      if (e.userData && e.userData.rebar) continue;
      if (e.hidden || (ef && !ef(e))) continue;
      if (elementEdgeIds.has(e.id)) continue; // renders inside its element Group
      const eu = e.userData && e.userData.bimEntityId;
      if (eu && this.app.isEntityHidden(eu)) continue; // hidden element edges go too
      if (!eu && hiddenLayers.has(e.layerId || '0')) continue; // raw-edge layer OFF
      const a = model.vp(e.a), b = model.vp(e.b);
      if (!a || !b) continue;
      const st = model.resolveEdgeStyle ? model.resolveEdgeStyle(e) : { lt: 0, lw: 0 };
      const lt = LTT[st.lt] ? st.lt : 0;
      const lwPx = (LWW[st.lw] || LWW[0]).px;
      if (lwPx >= 2) {
        // heavy: a clip-space ribbon, chopped into dashes when the linetype
        // is patterned (the pattern survives the width)
        const arr = (heavyPts[st.lw] = heavyPts[st.lw] || []);
        if (lt > 0 && LTT[lt].dash > 0.05) {
          const L = G.dist(a, b), D = LTT[lt].dash, GP = LTT[lt].gap;
          let t0 = 0;
          while (t0 < L) {
            const t1 = Math.min(t0 + D, L);
            const p1 = G.add(a, G.mul(G.sub(b, a), t0 / L));
            const p2 = t1 >= L ? b : G.add(a, G.mul(G.sub(b, a), t1 / L));
            arr.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
            t0 = t1 + GP;
          }
        } else arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
      } else if (lt > 0) {
        (dashPts[lt] = dashPts[lt] || []).push(a.x, a.y, a.z, b.x, b.y, b.z);
      } else ep.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    this.edgeLines.geometry.dispose();
    this.edgeLines.geometry = eg;

    // rebuild the styled buckets
    for (const ch of [...this.styledEdges.children]) {
      this.styledEdges.remove(ch);
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material && ch.material !== this.heavyMat) ch.material.dispose();
    }
    const mkDashed = (pts, lt) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(g, new THREE.LineDashedMaterial({
        color: 0x26262a, dashSize: LTT[lt].dash, gapSize: LTT[lt].gap,
      }));
      l.computeLineDistances();
      this.styledEdges.add(l);
    };
    for (const lt of Object.keys(dashPts)) mkDashed(dashPts[lt], +lt);
    for (const lw of Object.keys(heavyPts)) {
      const pts = heavyPts[lw];
      const px = (LWW[+lw] || LWW[0]).px;
      const nSeg = pts.length / 6;
      const vp = [], vo = [], vs = [], idx = [];
      for (let i = 0; i < nSeg; i++) {
        const o = i * 6, b0 = vp.length / 3;
        // four ribbon corners: (a,-1) (a,+1) (b,+1) (b,-1); each vertex knows
        // the segment's OTHER endpoint for the in-shader perpendicular
        vp.push(pts[o], pts[o + 1], pts[o + 2], pts[o], pts[o + 1], pts[o + 2],
          pts[o + 3], pts[o + 4], pts[o + 5], pts[o + 3], pts[o + 4], pts[o + 5]);
        vo.push(pts[o + 3], pts[o + 4], pts[o + 5], pts[o + 3], pts[o + 4], pts[o + 5],
          pts[o], pts[o + 1], pts[o + 2], pts[o], pts[o + 1], pts[o + 2]);
        vs.push(-1, 1, 1, -1);
        idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
      g.setAttribute('other', new THREE.Float32BufferAttribute(vo, 3));
      g.setAttribute('side', new THREE.Float32BufferAttribute(vs, 1));
      g.setIndex(idx);
      const mat = this.heavyMat.clone();
      mat.uniforms.uPx.value = px;
      this.styledEdges.add(new THREE.Mesh(g, mat));
    }

    this.updateSelectionVisuals();
    this._syncMeasureFaces(); // green highlights follow faces through edits
    this.app._snapCache = null;
  }

  setFaceStyle(style) { // 'shaded' | 'wireframe' | 'monochrome'
    this.invalidate();
    this.faceStyle = style;
    this.faceMesh.visible = style !== 'wireframe';
    if (this.elementsRoot) this.elementsRoot.visible = style !== 'wireframe';
    this.faceUniforms.uMono.value = style === 'monochrome' ? 1.0 : 0.0;
  }
  setRebarMode(mode) {
    // 'detail' = instanced solid bars, 'light' = centerline ribbons — both
    // ride the SAME cached buffers, so switching is instant (no rebuild)
    this.rebarMode = mode === 'light' ? 'light' : 'detail';
    this.rebarRibbon.visible = this.rebarMode === 'light';
    if (this.rebarSolids) this.rebarSolids.visible = this.rebarMode === 'detail';
    this.rebarMesh.visible = false; // retired pass, kept for pick compat
    this.invalidate();
    try { localStorage.setItem('websketch3d.rebarMode', this.rebarMode); } catch (e) { }
  }
  setXray(on) {
    this.faceUniforms.uAlphaMul.value = on ? (this.xrayAlpha != null ? this.xrayAlpha : 0.28) : 1.0;
    // X-ray must REVEAL interiors: with depth-write on, the ghosted front
    // faces depth-reject everything behind them (reinforcement cages
    // inside concrete vanished). Drop the depth write while x-ray is on -
    // later-drawn interior faces blend over the ghosts instead.
    if (this.faceMat) this.faceMat.depthWrite = !on;
    this.xray = on; this.invalidate();
  }
  // Sketch Mode: ghost the model so sketch lines dominate (edges stay crisp)
  setGhost(on) {
    this.invalidate();
    this.faceUniforms.uAlphaMul.value = on ? 0.22
      : (this.xray ? (this.xrayAlpha != null ? this.xrayAlpha : 0.28) : 1.0);
    this.ghosted = on;
  }
  setShadows(on) {
    this.invalidate();
    if (on) this.renderer.shadowMap.needsUpdate = true;
    this.sun.castShadow = on;
    this.shadowCatcher.visible = on;
  }
  setFog(on) {
    this.invalidate();
    this.fogOn = on;
    this.faceUniforms.fogOn.value = on ? 1.0 : 0.0;
    this.ground.material.fog = on;
    this.grid.material.fog = on;
    this.edgeLines.material.fog = on;
    this.ground.material.needsUpdate = true;
  }
  setEdges(on) { this.edgeLines.visible = on; this.selEdges.visible = on; this.invalidate(); }
  setGrid(on) { this.grid.visible = on; this.ground.visible = on; this.invalidate(); }
  // the 1 m reference grid follows the ACTIVE BASE LEVEL — the plane being
  // drawn on. Level 0 remains the world ground (terrain veil + shadows).
  setGridLevel(z) { this.grid.position.z = +z || 0; this.invalidate(); }
  /** Analytical model overlay (Phase 5.1): 1D centerlines of columns/
   *  beams/braces drawn as thick screen-space lines on the HUD. */
  setAnalytical(members) {
    this._analytical = members || null;
    this.invalidate();
  }
  _drawAnalytical(ctx, cam, w, h) {
    const mem = this._analytical;
    if (!mem || !mem.length) return;
    const prj = p0 => {
      const v = new THREE.Vector3(p0[0], p0[1], p0[2]).project(cam);
      if (v.z > 1) return null;
      return { x: (v.x + 1) / 2 * w, y: (-v.y + 1) / 2 * h };
    };
    ctx.save();
    ctx.lineWidth = 2.2;
    const COLS = { column: '#c0392b', beam: '#8e44ad', brace: '#d35400', wall: '#7f8c8d' };
    for (const m2 of mem) {
      const A = prj(m2.a), B = prj(m2.b);
      if (!A || !B) continue;
      ctx.strokeStyle = COLS[m2.kind] || '#333';
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
      // node dots
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(A.x - 2, A.y - 2, 4, 4);
      ctx.fillRect(B.x - 2, B.y - 2, 4, 4);
    }
    ctx.restore();
  }

  /** True-north arrow (georeference 1.2): a short arrow at the world origin
   *  pointing along TRUE north — the model's +Y rotated by the project→true
   *  angle. Hidden until an angle is set. */
  setNorthArrow(angle) {
    this.invalidate();
    if (!this.northArrow) {
      const mat = new THREE.LineBasicMaterial({ color: 0xc0392b, depthTest: false });
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
      const l = new THREE.Line(g, mat);
      l.renderOrder = 28;
      const head = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.12, 0.8, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.12, 0.8, 0)]);
      const hl = new THREE.Line(head, mat);
      const grp = new THREE.Group();
      grp.add(l); grp.add(hl);
      grp.name = 'north-arrow';
      this.northArrow = grp;
      this.scene.add(grp);
    }
    if (angle == null) { this.northArrow.visible = false; return; }
    this.northArrow.visible = true;
    this.northArrow.rotation.z = -angle; // CW-positive angle rotates the arrow
    this.northArrow.scale.setScalar(2.5); // 2.5 m arrow — legible at model scale
  }
  setAxes(on) { this.axesGroup.visible = on; this.invalidate(); }

  // Vertical level reference planes (Precise Drawing mode). Each level gets a
  // subtle wireframe rectangle + an elevation label sprite at its height.
  setLevels(levels, grids) {
    this.invalidate();
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
  setGrids(grids, levels, selGridId = null, selGridZ = null) {
    this.invalidate();
    if (!this.gridsGroup) {
      this.gridsGroup = new THREE.Group();
      this.gridsGroup.visible = false;
      this.scene.add(this.gridsGroup);
    }
    // selGridId is a single id OR a Set of ids (box / shift multi-selection)
    const selOf = id => selGridId == null ? false
      : (selGridId instanceof Set ? selGridId.has(id) : selGridId === id);
    while (this.gridsGroup.children.length) {
      const c = this.gridsGroup.children[0];
      this.gridsGroup.remove(c);
      if (c.material && c.material.map) c.material.map.dispose();
      if (c.material) c.material.dispose();
    }
    this._gridGrips = []; // [{ gridId, which:'start'|'end', p:{x,y,z} }]
    // a grid renders ONLY at the levels where it is visible: hidden on
    // Level 1 must not hide it on Level 2 (per-level eye in the browser)
    const lvObjs = (levels || []).filter(l => l.elevation != null).sort((a, b) => a.elevation - b.elevation);
    for (const g of grids || []) {
      if (g.hidden) continue; // master-hidden grids leave the viewport entirely
      const visible = lvObjs.filter(l => g.covers(l.elevation) && !g.hiddenAt(l.id));
      if (!visible.length) continue;
      const zs = visible.map(l => l.elevation);
      const zGrip = zs[0];
      const poly = g.polyline();
      const selGrid = selOf(g.id); // selected grids read in amber
      // amber only the copy on the LEVEL it was selected from (a level-2
      // selection highlights the level-2 line, not every copy) — but if the
      // recorded z matches none of the rendered copies, fall back to ALL of
      // them: selection feedback must never silently disappear
      const zKnown = selGridZ == null || zs.some(z => Math.abs(z - selGridZ) < 1e-6);
      for (const z of zs) {
        const sel = selGrid && (selGridZ == null || !zKnown || Math.abs(z - selGridZ) < 1e-6);
        const pts = poly.map(p => new THREE.Vector3(p[0], p[1], z));
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({
          // selected: strong yellow, BOLD — long dashes read as a thick
          // solid stroke at distance; unselected stays the fine datum dash
          color: sel ? 0xffd400 : 0x64748b,
          dashSize: sel ? 2.0 : 0.5, gapSize: sel ? 0.12 : 0.25,
          linewidth: 3,
          transparent: true, opacity: sel ? 1.0 : 0.85, fog: false,
          depthTest: false, // datums read THROUGH geometry — a wall drawn on
          // its grid never hides the line (it must stay visible to select)
        }));
        line.computeLineDistances(); // dashed materials need the arc lengths
        line.renderOrder = 6;
        this.gridsGroup.add(line);
        if (sel) {
          // bold stroke: an offset second dashed pass (dash phase shifted by
          // half a dash) fills the gaps of the first — together they read as
          // one thick continuous line
          const off = pts.map((q, i) => new THREE.Vector3(q.x, q.y, q.z + (i === 0 ? 0 : 0)));
          const core = new THREE.Line(geo.clone(), new THREE.LineDashedMaterial({
            color: 0xffd400, dashSize: 0.12, gapSize: 2.0, // inverse phase
            transparent: true, opacity: 1.0, fog: false, depthTest: false,
          }));
          core.computeLineDistances();
          core.renderOrder = 7;
          this.gridsGroup.add(core);
        }
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
        // selected grid reads amber end-to-end: line, bubbles AND grips
        const spr = selGrid ? this._gridBubble(g.name, 0xf59e0b) : this._gridBubble(g.name);
        spr.position.set(end.p[0] + end.d.x * 0.7, end.p[1] + end.d.y * 0.7, zGrip);
        this.gridsGroup.add(spr);
      }
      // drag grips (small squares) at both endpoints — amber when the grid
      // is selected (grips live at the lowest covered level only)
      for (const which of ['start', 'end']) {
        const p = which === 'start' ? S : E;
        const spr = this._gridGrip(selGrid ? 0xf59e0b : 0x64748b);
        spr.position.set(p[0], p[1], zGrip);
        this.gridsGroup.add(spr);
        this._gridGrips.push({ gridId: g.id, which, p: { x: p[0], y: p[1], z: zGrip } });
      }
    }
  }
  // circular bubble with the axis name centered inside (R ≈ 0.4 m world)
  _gridBubble(name, color) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const cx = cv.getContext('2d');
    cx.beginPath(); cx.arc(64, 64, 56, 0, Math.PI * 2);
    cx.lineWidth = color ? 10 : 6; cx.strokeStyle = color ? '#e6a800' : '#64748b'; cx.stroke();
    cx.fillStyle = color ? 'rgba(255,236,150,1)' : 'rgba(226,232,240,0.85)'; cx.fill();
    cx.font = '700 52px Segoe UI, sans-serif';
    cx.fillStyle = color ? '#5c3d00' : '#334155';
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
    this.invalidate();
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
    this.invalidate();
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

    // selected faces (triangulated overlay) — triangles come from the
    // rebuild()'s per-face triangulation cache when present (no re-earcut
    // per selection change); element-owned faces triangulate here (they
    // live in their own meshes, not the cache)
    const pos = [], nor = [];
    for (const id of sel.faces) {
      const f = model.faces.get(id); if (!f || f.hidden) continue;
      const entry = this._triCache && this._triCache.get(id);
      if (entry && entry.pos.length) {
        for (let k = 0; k < entry.pos.length; k += 3) {
          pos.push(entry.pos[k], entry.pos[k + 1], entry.pos[k + 2]);
          nor.push(entry.n.x, entry.n.y, entry.n.z);
        }
        continue;
      }
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
    this.invalidate();
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
    this.invalidate();
    for (const ch of [...this.previewGroup.children]) {
      this.previewGroup.remove(ch);
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) ch.material.dispose();
    }
    this.clearSticky(); // sticky labels share the preview lifecycle
  }
  previewLine(pts, color = 0x2b2b2b, dashed = false, dashSize = 0.45, gapSize = 0.3) {
    this.invalidate();
    if (!pts || pts.length < 2) return null;
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, p.y, p.z)));
    let mat;
    if (dashed) {
      mat = new THREE.LineDashedMaterial({ color, dashSize, gapSize, depthTest: false });
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
    this.invalidate();
    if (!pts || pts.length < 2) return;
    this.previewLine(pts.concat([pts[0]]), color);
  }
  previewFill(ringsList, color = 0x2f6fdb, alpha = 0.18) {
    this.invalidate();
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
    const colors = { endpoint: 0x1a7f37, midpoint: 0x0e8385, center: 0xb35900, axis: 0xd23c2e, edge: 0xd23c2e, face: 0x3e66c4, ground: 0x3d9e4e, intersection: 0x9c27b0, perpendicular: 0xe67e22 };
    this.snapDot.material.color.setHex(colors[kind] || 0x1a7f37);
    this.snapDot.geometry.attributes.position.setXYZ(0, p.x, p.y, p.z);
    this.snapDot.geometry.attributes.position.needsUpdate = true;
    this.snapDot.visible = true;
    // AutoCAD osnap marker: the shape rides the snap point in SCREEN space —
    // a small square at an endpoint, a triangle at a midpoint, a circle at a
    // center — so it stays crisp at any zoom (world-space shapes shrink).
    // Remembered and re-projected every frame so the glyph survives a
    // resting mouse (hudItems alone live only during motion).
    if (['endpoint', 'midpoint', 'center', 'edge', 'intersection', 'perpendicular'].includes(kind)) {
      this._lastSnap = { p: { x: p.x, y: p.y, z: p.z }, kind };
    }
  }
  // re-project the remembered osnap marker for this frame (camera may move)
  _repushSnapGlyph() {
    const s0 = this._lastSnap;
    if (!s0 || !this.snapDot.visible) return;
    const s = this.toScreen(s0.p);
    if (isFinite(s.x) && isFinite(s.y)) this.hudGlyphs.push({ sx: s.x, sy: s.y, kind: s0.kind, label: 1 });
  }
  // one AutoCAD osnap marker frame: the kind's symbol sits ON the point —
  // endpoint □, midpoint △, center ○, edge ◇, intersection × — white-filled
  // with a colored rim so it reads on ANY background (the old 2 px outline
  // vanished over dark geometry). Live hover markers also carry a small
  // label box with the snap name, the CAD tooltip look; tool-placed marks
  // (arc endpoints etc.) draw the symbol only, so placed points don't spam
  // chips.
  _drawSnapGlyph(ctx, x, y, kind, withLabel) {
    const col = { endpoint: '#1a7f37', midpoint: '#0e8385', center: '#b35900', edge: '#d23c2e', intersection: '#9c27b0', perpendicular: '#e67e22' }[kind] || '#475569';
    const name = { endpoint: 'Endpoint', midpoint: 'Midpoint', center: 'Center', edge: 'On Line', intersection: 'Intersection', perpendicular: 'Perpendicular' }[kind] || kind;
    ctx.lineWidth = 1.8;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = col;
    ctx.beginPath();
    if (kind === 'endpoint') { // the small box
      ctx.rect(x - 4.5, y - 4.5, 9, 9);
    } else if (kind === 'midpoint') {
      ctx.moveTo(x, y - 5.5); ctx.lineTo(x + 6, y + 4.5); ctx.lineTo(x - 6, y + 4.5); ctx.closePath();
    } else if (kind === 'center') {
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    } else if (kind === 'intersection') { // × — two strokes through a filled box
      ctx.rect(x - 5, y - 5, 10, 10);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
      ctx.stroke();
    } else if (kind === 'perpendicular') { // ⊥ — stem on a base, corner-marked
      ctx.rect(x - 5.5, y - 5.5, 11, 11);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 3.5); // stem
      ctx.moveTo(x - 4.5, y + 3.5); ctx.lineTo(x + 4.5, y + 3.5); // base
      ctx.moveTo(x - 3, y + 1); ctx.lineTo(x, y + 1); ctx.lineTo(x, y - 2); // right-angle tick
      ctx.stroke();
    } else { // edge: nearest-on-line — a small diamond
      ctx.moveTo(x, y - 5.5); ctx.lineTo(x + 5.5, y); ctx.lineTo(x, y + 5.5); ctx.lineTo(x - 5.5, y); ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    if (withLabel) {
      const t = ctx.measureText(name);
      const bx = x + 10, by = y - 27, bw = t.width + 12, bh = 19;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 4); else ctx.rect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillText(name, bx + 6, by + 13.5);
    }
  }
  hideSnapDot() { this.snapDot.visible = false; this._lastSnap = null; }
  /** Tool-placed point markers: [{p, kind}] — squares at the arc's placed
   *  points, drawn like the osnap glyphs and re-projected every frame. */
  setSnapMarks(marks) { this.snapMarks = marks || []; this.invalidate(); }
  clearSnapMarks() { if (this.snapMarks.length) { this.snapMarks = []; this.invalidate(); } }
  hudLabel(sx, sy, text, color = '#333') {
    if (!text || !isFinite(sx) || !isFinite(sy)) return;
    this.hudItems.push({ sx, sy, text, color });
  }
  stickyLabel(p, text, color = '#333', dx = 0, dy = -12) {
    this.invalidate();
    if (!p || !text || !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return;
    this.hudSticky.push({ x: p.x, y: p.y, z: p.z, text, color, dx, dy });
  }
  // OpenCADStudio-style dynamic-input guides for a live segment a->b: a dashed
  // in-plane horizontal reference from the anchor, a dashed arc sweeping from
  // that reference to the segment direction, and the polar-angle label at the
  // mid-sweep. n = the drawing plane's normal (defaults to the ground plane).
  // Pure overlay — callers keep their own length labels. Returns the polar
  // angle in degrees (0..360 CCW from in-plane +X) or null when the segment
  // has no in-plane extent (a plumb line) and nothing was drawn.
  polarGuides(a, b, n = null) {
    this.invalidate();
    if (!a || !b) return null;
    const nn = n && !G.isZero(n) ? G.norm(n) : G.v(0, 0, 1);
    // in-plane frame: u = world X projected into the plane (world Y when the
    // plane faces X), v = 90° CCW from u so the angle reads like a bearing
    let u = G.sub(G.v(1, 0, 0), G.mul(nn, nn.x));
    if (G.len(u) < 1e-6) u = G.sub(G.v(0, 1, 0), G.mul(nn, nn.y));
    if (G.len(u) < 1e-6) return null;
    u = G.norm(u);
    const v = G.cross(nn, u);
    const d = G.sub(b, a);
    const du = G.dot(d, u), dv = G.dot(d, v);
    const L = Math.hypot(du, dv);
    if (L < 1e-6) return null; // plumb segment: no in-plane angle to show
    const ang = Math.atan2(dv, du);
    const deg = ((ang * 180 / Math.PI) % 360 + 360) % 360;
    const GUIDE = 0x0a7d80, dash = Math.max(0.06, L * 0.02);
    // horizontal reference from the anchor, along +X, as long as the segment
    this.previewLine([a, G.add(a, G.mul(u, Math.max(L, 0.05)))], GUIDE, true, dash, dash * 0.7);
    // sweep arc (skip when the segment already lies on the reference)
    if (deg > 1.5 && deg < 358.5) {
      const r = Math.min(Math.max(0.45 * L, 0.18), 1.6);
      const segs = Math.max(8, Math.ceil(deg / 6));
      const arc = [];
      for (let i = 0; i <= segs; i++) {
        const t = ang * i / segs;
        arc.push(G.add(a, G.add(G.mul(u, Math.cos(t) * r), G.mul(v, Math.sin(t) * r))));
      }
      this.previewLine(arc, GUIDE, true, dash, dash * 0.7);
      // angle label just outside the arc's mid-sweep
      const m = ang / 2;
      const lp = G.add(a, G.add(G.mul(u, Math.cos(m) * r), G.mul(v, Math.sin(m) * r)));
      const sa = this.toScreen(a), sp = this.toScreen(lp);
      if (sa && sp) {
        const dxs = sp.x - sa.x, dys = sp.y - sa.y, dl = Math.hypot(dxs, dys) || 1;
        this.stickyLabel(lp, `${deg.toFixed(1)}\u00B0`, '#0a5f61', dxs / dl * 15, dys / dl * 15);
      }
    }
    return { angleDeg: deg, len: L };
  }
  clearSticky() { this.hudSticky.length = 0; this.invalidate(); }
  /**
   * Pin a persistent measurement badge at a world point (Measure Area).
   * faceId (optional) links the pin to the measured face: the face stays
   * filled GREEN until the pins are cleared.
   */
  pinLabel(p, text, color = '#1d4f9c', faceId = null) {
    this.invalidate();
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
    this.invalidate();
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
    } else {
      // near plane ~1% of the camera distance, clamped to [0.1, 0.5]: the
      // old floor of 0.02 mm-scale nears gave a 200,000:1 depth ratio that
      // starved the 24-bit Z buffer (rebar occlusion artifacts). 0.1 keeps
      // everything from the lens out visible while preserving depth
      // precision across the scene.
      const near = Math.min(0.5, Math.max(0.1, dist * 0.01));
      if (Math.abs(near - this.persp.near) > 1e-9) {
        this.persp.near = near;
        this.persp.updateProjectionMatrix();
      }
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
  /** The world point under a screen point: the nearest element-mesh or
   *  merged-face hit along the cursor ray (falling back to the ground plane
   *  when the ray points downward into empty space). Drives zoom-to-cursor. */
  worldAtScreen(s) {
    this.applyCamera();
    this.raycaster.setFromCamera(this.ndcAt(s), this.activeCamera());
    const targets = this.elementsRoot ? this.elementsRoot.children : [];
    const hits = targets.length ? this.raycaster.intersectObjects(targets, true) : [];
    const ray = this.raycaster.ray;
    const merged = this._pickMergedFaces(ray.origin, ray.direction);
    let d = Infinity, P = null;
    if (hits.length) { d = hits[0].distance; P = hits[0].point.clone(); }
    if (merged.length && merged[0].t < d) {
      d = merged[0].t;
      P = ray.origin.clone().add(ray.direction.clone().multiplyScalar(d));
    }
    if (!P && ray.direction.z < -1e-9 && ray.origin.z > -1e-9) {
      const t = -ray.origin.z / ray.direction.z; // ground plane z = 0
      // near-horizon rays hit the ground absurdly far away — pivoting the
      // zoom target out there would teleport the view, so only trust a
      // ground point within a local neighborhood of the camera
      if (t > 0 && t < Math.max(30, this.cam.dist * 2))
        P = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    }
    return P;
  }
  zoomBy(f, s) {
    const old = this.cam.dist;
    this.cam.dist = Math.max(0.002, Math.min(1800, old * f));
    if (!s) return;
    // zoom-to-cursor: scale the camera→cursor-point vector by the zoom
    // ratio — the point under the mouse stays fixed on screen while the
    // orbit target dives toward it, so you can park the view right on any
    // element (rebar hooks, small faces) and keep zooming into it.
    const k = this.cam.dist / old;
    if (!isFinite(k) || k === 1) return;
    const P = this.worldAtScreen(s);
    if (!P) return;
    const t = this.cam.target;
    this.cam.target = {
      x: P.x + (t.x - P.x) * k,
      y: P.y + (t.y - P.y) * k,
      z: P.z + (t.z - P.z) * k,
    };
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
  /** Frame a sphere: camera aimed at its center, distance so it fills
   *  the view; the shadow camera follows so close-ups stay lit. */
  zoomTo(center, radius) {
    this.cam.target = G.clone(center);
    this.cam.dist = Math.max(radius / Math.tan(this.cam.fov * RAD / 2) * 1.15, 0.8);
    const sc2 = radius * 1.35;
    const s = this.sun.shadow.camera;
    s.left = -sc2; s.right = sc2; s.top = sc2; s.bottom = sc2;
    s.updateProjectionMatrix();
  }
  /** Re-aim the orbit pivot without changing distance: a selection-driven
   *  orbit start swings the camera to circle the selected element. */
  aimAt(center) { this.cam.target = G.clone(center); }
  zoomExtents() {
    const model = this.app.model;
    const vids = [...model.vertices.keys()];
    const bb = model.bbox(vids);
    if (bb) this.zoomTo(bb.center, Math.max(G.len(bb.size) / 2, 0.6));
    else this.zoomTo(G.v(), 6);
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
  // Object-mode pick (Precise Drawing): raycast ONLY the per-element Groups.
  // Returns { entityId, faceId } of the closest hit, or null. Locked/hidden
  // elements are not targets. This is the O(#elements) path — the merged-mesh
  // and edge-list scans stay in Free Drawing (the "edit mode").
  // ---- GPU pick pass (broad phase) -----------------------------------------
  // Renders ONLY pickable meshes (element meshes + the merged free-face mesh)
  // with the id-encoding shader into a reusable target, scissored to 4×4 px
  // around the cursor, and reads all 16 pixels. The result is the SET of
  // candidate elements/faces under the cursor — the exact hit (smallest
  // coincident face, locked/hidden filters) is then resolved by raycasting
  // just those 2-3 candidates instead of every element in the model.
  // Pickable meshes live on layer 1 (enabled alongside 0 at rebuild); the
  // pick render looks at layer 1 only, so nothing is toggled per pass.
  // Returns { elements:Set<entityId>, faces:Set<fid> } (empty = clean miss)
  // or undefined when the GPU path is unavailable.
  _gpuPickCandidates(s) {
    if (!this.gpuPick) return undefined;
    if (!this._pickRegistry || this._pickRegistry.length < 2) return undefined;
    const r = this.renderer;
    const canvas = this.canvas;
    try {
      if (!this._pickTarget || this._pickTarget.width !== canvas.width || this._pickTarget.height !== canvas.height) {
        if (this._pickTarget) this._pickTarget.dispose();
        this._pickTarget = new THREE.WebGLRenderTarget(canvas.width, canvas.height, { depthBuffer: true });
      }
      const cam = this.activeCamera();
      this.applyCamera();
      const pr = r.getPixelRatio() || 1;
      const W = canvas.width, H = canvas.height;
      const prevMask = cam.layers.mask;
      const prevOverride = this.scene.overrideMaterial;
      cam.layers.set(1);
      this.scene.overrideMaterial = this._pickMat;
      r.setRenderTarget(this._pickTarget);
      r.setScissorTest(true);
      const x = Math.max(0, Math.min(W - 4, Math.round(s.x * pr) - 2));
      const y = Math.max(0, Math.min(H - 4, Math.round((H / pr - s.y) * pr) - 2));
      r.setScissor(x, y, 4, 4);
      r.clear();
      r.render(this.scene, cam);
      const buf = new Uint8Array(4 * 16);
      r.readRenderTargetPixels(this._pickTarget, x, y, 4, 4, buf);
      r.setScissorTest(false);
      r.setRenderTarget(null);
      this.scene.overrideMaterial = prevOverride;
      cam.layers.mask = prevMask;
      const out = { elements: new Set(), faces: new Set() };
      for (let i = 0; i < 16; i++) {
        const id = buf[i * 4] + buf[i * 4 + 1] * 256 + buf[i * 4 + 2] * 65536;
        if (id <= 0) continue;
        const e = this._pickRegistry[id];
        if (!e) continue;
        if (e.entity) out.elements.add(e.entity);
        else if (e.face != null) out.faces.add(e.face);
      }
      return out;
    } catch (e) {
      this.gpuPick = false; // unsupported context/config: CPU path from now on
      return undefined;
    }
  }
  // Face id inside ONE element (after the GPU pass named the element): a
  // single-group BVH raycast — exact face + triangle, a fraction of a ms.
  _elementFaceAt(el, s) {
    this.raycaster.setFromCamera(this.ndcAt(s), this.activeCamera());
    const hits = this.raycaster.intersectObjects(el.group.children, true)
      .filter(h => h.object.userData && h.object.userData.triangleFace);
    if (!hits.length) return null;
    const d0 = hits[0].distance;
    let best = null, bestArea = Infinity;
    for (const h of hits) {
      if (h.distance - d0 > 1e-4) break;
      const fid = h.object.userData.triangleFace[h.faceIndex];
      if (fid == null) continue;
      const f = this.app.model.faces.get(fid);
      if (!f) continue;
      const area = this.app.model.faceArea(f);
      if (area < bestArea) { bestArea = area; best = fid; }
    }
    return best;
  }
  pickElementAt(s) {
    if (!this.elementsRoot || !this.elementsRoot.children.length) return null;
    const app = this.app;
    this.applyCamera();
    this.raycaster.setFromCamera(this.ndcAt(s), this.activeCamera());
    const pickable = obj => {
      const eid = obj.userData && obj.userData.elementId;
      if (!eid) return true;
      return !app.isEntityLocked(eid) && !app.isEntityHidden(eid);
    };
    // GPU broad phase: the 4×4 id-render names the 1-3 elements under the
    // cursor; the exact raycast below runs on THOSE groups only. Semantic
    // note: the smallest-coincident-face rule still applies across the
    // candidates, so behavior matches the full CPU path.
    const gpu = this._gpuPickCandidates(s);
    let targets;
    if (gpu !== undefined) {
      if (!gpu.elements.size) return null;
      targets = this.elementsRoot.children.filter(
        g => g.userData && g.userData.elementId && gpu.elements.has(g.userData.elementId) && pickable(g));
    } else {
      targets = this.elementsRoot.children.filter(pickable);
    }
    // MESH hits only: the per-element edge LineSegments are raycastable with
    // a generous line threshold — a far element's edge line would 'catch' the
    // click before the intended face (selecting a distant column under the
    // cursor's beam). Face meshes carry the triangle map; lines do not.
    const hits = this.raycaster.intersectObjects(targets, true)
      .filter(h => h.object.userData && h.object.userData.triangleFace);
    if (!hits.length) return gpu !== undefined ? null : null;
    // coincident hits: prefer the SMALLEST face (the beam under the slab, not
    // the slab) — same rule as pickFaceAt
    const d0 = hits[0].distance;
    let best = null, bestArea = Infinity;
    for (const h of hits) {
      if (h.distance - d0 > 1e-4) break;
      const eid = h.object.userData.elementId;
      const map = h.object.userData.triangleFace;
      const fid = map ? map[h.faceIndex] : null;
      if (fid == null) continue;
      const f = this.app.model.faces.get(fid);
      if (!f) continue;
      const area = this.app.model.faceArea(f);
      if (area < bestArea) { bestArea = area; best = { entityId: eid, faceId: fid }; }
    }
    return best;
  }
  pickFaceAt(s) {
    if (!this.faceMesh.visible) return null;
    const app = this.app;
    // GPU broad phase: candidate elements from the id-render; the exact
    // element raycast below then touches only those groups. The merged-mesh
    // AABB scan is already broad-phase cheap and stays as-is.
    const gpu = this._gpuPickCandidates(s);
    this.applyCamera();
    this.raycaster.setFromCamera(this.ndcAt(s), this.activeCamera());
    // the merged Free-Drawing mesh is picked through the rebuild()'s cached
    // per-face AABB + triangle index instead of a Three.js raycast over the
    // whole (single, huge) geometry — that O(all-triangles) scan was the
    // hover/mouse-move cost in large Free-mode models. Element Groups are
    // ordinary small meshes and stay on the raycaster; each carries its own
    // triangle -> faceId map in userData. Locked / hidden elements are not
    // pick targets at all.
    const pickable = obj => {
      const eid = obj.userData && obj.userData.elementId;
      if (!eid) return true;
      return !app.isEntityLocked(eid) && !app.isEntityHidden(eid);
    };
    const targets = gpu !== undefined
      ? (this.elementsRoot ? this.elementsRoot.children.filter(
          g => g.userData && g.userData.elementId && gpu.elements.has(g.userData.elementId) && pickable(g)) : [])
      : (this.elementsRoot ? this.elementsRoot.children.filter(pickable) : []);
    const hits = targets.length ? this.raycaster.intersectObjects(targets, true) : [];
    const ray = this.raycaster.ray;
    const merged = this._pickMergedFaces(ray.origin, ray.direction);
    if (!hits.length && !merged.length) return null;
    // on coincident (coplanar) hits prefer the smallest face — drawing over a
    // face should select the shape you just drew, not the face under it
    const d0 = Math.min(hits.length ? hits[0].distance : Infinity, merged.length ? merged[0].t : Infinity);
    let best = null, bestArea = Infinity;
    const consider = fid => {
      if (fid == null) return;
      const f = this.app.model.faces.get(fid);
      if (!f) return;
      if (this.app.isFaceLocked(f) || this.app.isEntityHidden(f.userData && f.userData.bimEntityId)) return;
      const area = this.app.model.faceArea(f);
      if (area < bestArea) { bestArea = area; best = fid; }
    };
    for (const h of hits) {
      if (h.distance - d0 > 1e-4) break;
      const map = h.object.userData && h.object.userData.triangleFace;
      if (map) consider(map[h.faceIndex]);
    }
    for (const m of merged) {
      if (m.t - d0 > 1e-4) break;
      consider(m.fid);
    }
    return best;
  }
  // Broad-phase ray pick over the merged mesh using the triangulation cache:
  // per-face AABB slab test prunes the tree, Möller–Trumbore finds the entry
  // hit per surviving face. Returns [{t, fid}] sorted by t — the same
  // information intersectObjects produced for the merged mesh.
  _pickMergedFaces(ro, rd) {
    const out = [];
    if (!this._mergedFaces || !this._triCache) return out;
    for (const mf of this._mergedFaces) {
      const e = this._triCache.get(mf.id);
      if (!e || !e.pos.length) continue;
      const b = mf.aabb;
      let tmin = 0, tmax = Infinity, ok = true;
      for (let ax = 0; ax < 3; ax++) {
        const o = ax === 0 ? ro.x : ax === 1 ? ro.y : ro.z;
        const d = ax === 0 ? rd.x : ax === 1 ? rd.y : rd.z;
        const lo = b[ax], hi = b[ax + 3];
        if (Math.abs(d) < 1e-12) {
          if (o < lo || o > hi) { ok = false; break; }
        } else {
          let t1 = (lo - o) / d, t2 = (hi - o) / d;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (!ok) continue;
      const p = e.pos;
      let best = Infinity;
      for (let i = 0; i < p.length; i += 9) {
        const e1x = p[i + 3] - p[i], e1y = p[i + 4] - p[i + 1], e1z = p[i + 5] - p[i + 2];
        const e2x = p[i + 6] - p[i], e2y = p[i + 7] - p[i + 1], e2z = p[i + 8] - p[i + 2];
        const px = rd.y * e2z - rd.z * e2y, py = rd.z * e2x - rd.x * e2z, pz = rd.x * e2y - rd.y * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tx = ro.x - p[i], ty = ro.y - p[i + 1], tz = ro.z - p[i + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (rd.x * qx + rd.y * qy + rd.z * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t >= 0 && t < best) best = t;
      }
      if (best < Infinity) out.push({ t: best, fid: mf.id });
    }
    out.sort((x, y) => x.t - y.t);
    return out;
  }
  // unit hexagonal prism along +Y (circumradius 1, half-length 1) — the
  // instanced rebar shape. Hex keeps the MNL-66 pipe look at a fraction of
  // the triangle count (24 tris/segment vs a 6-ring extrusion's 20+ faces).
  _rebarPrismGeo() {
    const S = 6;
    const ring = [];
    for (let i = 0; i < S; i++) {
      const a = (i + 0.5) * Math.PI * 2 / S;
      ring.push([Math.cos(a), Math.sin(a)]);
    }
    const pos = [], nor = [], idx = [];
    const bot = [], top = [];
    for (let i = 0; i < S; i++) {
      bot.push(pos.length / 3); pos.push(ring[i][0], -1, ring[i][1]); nor.push(ring[i][0], 0, ring[i][1]);
      top.push(pos.length / 3); pos.push(ring[i][0], 1, ring[i][1]); nor.push(ring[i][0], 0, ring[i][1]);
    }
    const cb = pos.length / 3; pos.push(0, -1, 0); nor.push(0, -1, 0);
    const ct = pos.length / 3; pos.push(0, 1, 0); nor.push(0, 1, 0);
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      idx.push(bot[i], bot[j], top[j], bot[i], top[j], top[i]); // sides
      idx.push(cb, bot[j], bot[i]);                              // bottom fan
      idx.push(ct, top[i], top[j]);                              // top fan
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  }
  // pick a solid rebar instance (detail mode): instanceId -> bar pid
  pickRebarAt(s) {
    if (!this.rebarSolids || !this.rebarSolids.visible || !this._rbInstPid || !this._rbInstPid.length) return null;
    if (!(this.rebarSolids instanceof THREE.InstancedMesh)) return null;
    this.applyCamera();
    this.raycaster.setFromCamera(this.ndcAt(s), this.activeCamera());
    const hits = this.raycaster.intersectObject(this.rebarSolids, false);
    for (const h of hits) {
      if (h.instanceId != null && this._rbInstPid[h.instanceId] != null) return this._rbInstPid[h.instanceId];
    }
    return null;
  }
  // highlight every segment of one bar (by pid) in the instanced pass
  setRebarSelection(pid) {
    this._rbSelPid = pid || null;
    const im = this.rebarSolids;
    if (!im || !im.instanceColor || !this._rbInstPid) return;
    const base = new THREE.Color(0xffffff), hot = new THREE.Color(0xffd24a);
    for (let i = 0; i < this._rbInstPid.length; i++)
      im.setColorAt(i, pid != null && this._rbInstPid[i] === pid ? hot : base);
    im.instanceColor.needsUpdate = true;
    this.invalidate();
  }
  // Downloaded-asset instances (BlenderKit): the groups under the
  // blenderkit-assets root are real meshes, so a plain raycast finds them.
  // Returns the nearest instance id (their userData.blenderkit.id) or null.
  pickAssetAt(s) {    const root = this.assetsRoot;
    if (!root || !root.visible || !root.children.length) return null;
    this.applyCamera();
    this.raycaster.setFromCamera(this.ndcAt(s), this.activeCamera());
    const hits = this.raycaster.intersectObjects(root.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o !== this.scene) {
        const bk = o.userData && o.userData.blenderkit;
        if (bk && bk.id) return bk.id;
        o = o.parent;
      }
    }
    return null;
  }
  // Selected instances get a bounding-box outline — the same affordance the
  // grid-line selection uses (foreign groups have no face/edge overlays).
  updateAssetSelection(selIds, assets) {
    if (!this._assetSelGroup) {
      this._assetSelGroup = new THREE.Group();
      this._assetSelGroup.name = 'asset-selection';
      this.scene.add(this._assetSelGroup);
    }
    for (const ch of [...this._assetSelGroup.children]) {
      this._assetSelGroup.remove(ch);
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) ch.material.dispose();
    }
    if (!selIds || !selIds.size) return;
    for (const id of selIds) {
      const rec = assets.get(id);
      if (!rec || !rec.object.parent) continue;
      const box = new THREE.Box3().setFromObject(rec.object);
      if (box.isEmpty()) continue;
      const helper = new THREE.Box3Helper(box, 0x1d4f9c);
      helper.material.depthTest = false;
      helper.renderOrder = 30;
      this._assetSelGroup.add(helper);
    }
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
  // ---------------------------------------------------------------- annotations
  // Phase 3 drawing entities (model.annotations), rendered on the HUD canvas
  // every frame: dimensions (extension + dim lines, arrows, length text),
  // tags (leader + identity box, text re-resolved from the target entity),
  // text notes (optional leader), spot elevations (+ absolute when the
  // georeference base point is set). Selected annotation highlighted.
  _drawAnnotations(ctx, cam, w, h) {
    const model = this.app.model;
    const anns = model && model.annotations;
    if (!anns || !anns.length) return;
    const sel = this.app.selAnn || null;
    const prj = p0 => {
      const v = new THREE.Vector3(p0[0], p0[1], p0[2]).project(cam);
      if (v.z > 1) return null;
      return { x: (v.x + 1) / 2 * w, y: (-v.y + 1) / 2 * h };
    };
    const text = (sx, sy, str, color, bg) => {
      const t = ctx.measureText(str);
      ctx.fillStyle = bg || 'rgba(255,255,255,0.85)';
      ctx.fillRect(sx - t.width / 2 - 5, sy - 9, t.width + 10, 16);
      ctx.fillStyle = color;
      const prev = ctx.textAlign;
      ctx.textAlign = 'center';
      ctx.fillText(str, sx, sy + 3);
      ctx.textAlign = prev;
    };
    const arrow = (x, y, dx, dy, color) => {
      const l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - ux * 9 - uy * 3.5, y - uy * 9 + ux * 3.5);
      ctx.moveTo(x, y);
      ctx.lineTo(x - ux * 9 + uy * 3.5, y - uy * 9 - ux * 3.5);
      ctx.stroke();
    };
    const line = (a2, b2, color, dashed) => {
      ctx.strokeStyle = color;
      if (dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(a2.x, a2.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.stroke();
      if (dashed) ctx.setLineDash([]);
    };
    for (const a of anns) {
      const on = a.id === sel;
      const cMain = on ? '#e07a00' : '#333';
      if (a.kind === 'dim') {
        const RF = window.Annotate && Annotate.resolveRef;
        const p1 = RF ? RF(this.app, a.r1, a.p1) : a.p1;
        const p2 = RF ? RF(this.app, a.r2, a.p2) : a.p2;
        const off = a.off || [0, 0.6, 0];
        const A = prj([p1[0] + off[0], p1[1] + off[1], p1[2] + off[2]]);
        const B = prj([p2[0] + off[0], p2[1] + off[1], p2[2] + off[2]]);
        const E1 = prj(p1), E2 = prj(p2);
        if (!A || !B || !E1 || !E2) continue;
        const col = on ? '#e07a00' : '#9a9a9a';
        line(E1, A, col, true);
        line(E2, B, col, true);
        line(A, B, cMain);
        const dx = B.x - A.x, dy = B.y - A.y;
        arrow(A.x, A.y, dx, dy, cMain);
        arrow(B.x, B.y, -dx, -dy, cMain);
        const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
        const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 - 12 };
        text(mid.x, mid.y, a.text != null ? a.text : len.toFixed(3), on ? '#a35a00' : '#333');
      } else if (a.kind === 'tag') {
        const anchor = prj(a.at);
        const box = prj(a.box || a.at);
        if (!anchor || !box) continue;
        line(anchor, box, on ? '#e07a00' : '#1d4f9c');
        const txt = window.AnnotateTagText ? AnnotateTagText(this.app, a) : (a.text || '');
        const t = ctx.measureText(txt);
        ctx.fillStyle = on ? 'rgba(255,235,204,0.92)' : 'rgba(228,238,252,0.92)';
        ctx.fillRect(box.x, box.y - 16, t.width + 12, 18);
        ctx.strokeStyle = on ? '#e07a00' : '#8fa8cc';
        ctx.strokeRect(box.x, box.y - 16, t.width + 12, 18);
        ctx.fillStyle = '#1d4f9c';
        const prev = ctx.textAlign;
        ctx.textAlign = 'left';
        ctx.fillText(txt, box.x + 6, box.y - 3);
        ctx.textAlign = prev;
      } else if (a.kind === 'text') {
        const at = prj(a.at);
        if (!at) continue;
        if (a.leaderFrom) {
          const lf = prj(a.leaderFrom);
          if (lf) line(lf, at, on ? '#e07a00' : '#9a9a9a');
        }
        text(at.x, at.y, a.text || '', on ? '#a35a00' : '#333');
      } else if (a.kind === 'dimang') {
        const V = prj(a.V), R1 = prj(a.p1), R2 = prj(a.p2);
        if (!V || !R1 || !R2) continue;
        const col = on ? '#e07a00' : '#9a9a9a';
        line(V, R1, col, true);
        line(V, R2, col, true);
        const rr = Math.min(Math.max(Math.hypot(R1.x - V.x, R1.y - V.y), 24), Math.hypot(R2.x - V.x, R2.y - V.y) + 30);
        let a1 = Math.atan2(R1.y - V.y, R1.x - V.x), a2 = Math.atan2(R2.y - V.y, R2.x - V.x);
        let dAng = a2 - a1;
        while (dAng > Math.PI) dAng -= Math.PI * 2;
        while (dAng < -Math.PI) dAng += Math.PI * 2;
        ctx.strokeStyle = cMain;
        ctx.beginPath();
        ctx.arc(V.x, V.y, rr, a1, a1 + dAng, dAng < 0);
        ctx.stroke();
        const am = a1 + dAng / 2;
        const deg = Math.abs(dAng) * 180 / Math.PI;
        text(V.x + Math.cos(am) * (rr + 6), V.y + Math.sin(am) * (rr + 6), deg.toFixed(1) + '\u00B0', on ? '#a35a00' : '#333');
      } else if (a.kind === 'dimrad') {
        const C = prj(a.c), Rm = prj(a.rim);
        if (!C || !Rm) continue;
        line(C, Rm, cMain);
        arrow(Rm.x, Rm.y, Rm.x - C.x, Rm.y - C.y, cMain);
        text((C.x + Rm.x) / 2, (C.y + Rm.y) / 2 - 8, 'R ' + (+a.r).toFixed(3), on ? '#a35a00' : '#333');
      } else if (a.kind === 'cloud' || a.kind === 'region') {
        const pts = (a.pts || []).map(prj).filter(Boolean);
        if (pts.length < 3) continue;
        if (a.kind === 'region') {
          ctx.fillStyle = 'rgba(47,111,219,0.18)';
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i2 = 1; i2 < pts.length; i2++) ctx.lineTo(pts[i2].x, pts[i2].y);
          ctx.closePath();
          ctx.fill();
          ctx.save();
          ctx.setLineDash([6, 3]);
          ctx.strokeStyle = on ? '#e07a00' : '#2f6fdb';
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.strokeStyle = on ? '#e07a00' : '#d23c2e';
          for (let i2 = 0; i2 < pts.length; i2++) {
            const q1 = pts[i2], q2 = pts[(i2 + 1) % pts.length];
            const segL = Math.hypot(q2.x - q1.x, q2.y - q1.y);
            const n2 = Math.max(2, Math.round(segL / 22));
            for (let k = 0; k < n2; k++) {
              const t1 = k / n2, t2 = (k + 1) / n2;
              const m1 = { x: q1.x + (q2.x - q1.x) * t1, y: q1.y + (q2.y - q1.y) * t1 };
              const m2 = { x: q1.x + (q2.x - q1.x) * t2, y: q1.y + (q2.y - q1.y) * t2 };
              const bulge = 0.55;
              const mx2 = (m1.x + m2.x) / 2 + (m2.y - m1.y) * bulge * 0.5;
              const my2 = (m1.y + m2.y) / 2 - (m2.x - m1.x) * bulge * 0.5;
              const r2 = Math.hypot(m2.x - m1.x, m2.y - m1.y) / 2 * 1.25;
              ctx.beginPath();
              ctx.moveTo(m1.x, m1.y);
              ctx.arcTo(mx2, my2, m2.x, m2.y, r2);
              ctx.stroke();
            }
          }
        }
      } else if (a.kind === 'spot') {
        const at = prj(a.at);
        if (!at) continue;
        ctx.strokeStyle = on ? '#e07a00' : '#0a5f61';
        ctx.beginPath();
        ctx.moveTo(at.x - 5, at.y - 6);
        ctx.lineTo(at.x + 5, at.y - 6);
        ctx.lineTo(at.x, at.y);
        ctx.closePath();
        ctx.stroke();
        const geo = model.geo;
        const z = a.at[2];
        const str = geo && geo.basePoint
          ? z.toFixed(3) + ' (' + (geo.basePoint.elev + z).toFixed(3) + ')'
          : z.toFixed(3);
        text(at.x + 4, at.y - 14, str, on ? '#a35a00' : '#0a5f61');
      }
    }
  }
  /** Screen-space annotation pick (Select tool): dims by point-to-segment
   *  distance, tags/notes/spots by proximity to their anchor box. */
  pickAnnotation(s) {
    const model = this.app.model;
    const anns = model && model.annotations;
    if (!anns || !anns.length || !isFinite(s.x) || !isFinite(s.y)) return null;
    const cam = this.activeCamera();
    const w = this.hud.width, h = this.hud.height;
    let best = null, bestD = 11;
    for (const a of anns) {
      const prj = p0 => {
        const v = new THREE.Vector3(p0[0], p0[1], p0[2]).project(cam);
        if (v.z > 1) return null;
        return { x: (v.x + 1) / 2 * w, y: (-v.y + 1) / 2 * h };
      };
      if (a.kind === 'dim') {
        const A = prj([a.p1[0] + (a.off || [0, 0.6, 0])[0], a.p1[1] + (a.off || [0, 0.6, 0])[1], a.p1[2]]);
        const B = prj([a.p2[0] + (a.off || [0, 0.6, 0])[0], a.p2[1] + (a.off || [0, 0.6, 0])[1], a.p2[2]]);
        if (!A || !B) continue;
        const dx = B.x - A.x, dy = B.y - A.y;
        const t = Math.max(0, Math.min(1, ((s.x - A.x) * dx + (s.y - A.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(s.x - (A.x + t * dx), s.y - (A.y + t * dy));
        if (d < bestD) { bestD = d; best = a; }
      } else {
        const at = prj(a.box || a.at);
        if (!at) continue;
        const d = Math.hypot(s.x - at.x, s.y - at.y);
        if (d < bestD + 12) { bestD = d; best = a; } // text boxes get slack
      }
    }
    return best;
  }
  _drawHudItem(ctx, sx, sy, text, color) {
    if (!isFinite(sx) || !isFinite(sy)) return;
    const t = ctx.measureText(text);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(sx + 10, sy - 20, t.width + 10, 18);
    ctx.fillStyle = color;
    ctx.fillText(text, sx + 15, sy - 7);
  }
  /** Mark the frame dirty: something in the scene, a preview, or an
   *  overlay changed and the next tick must re-render. Also opens a short
   *  settle window so bursts of small mutations (hover previews, sticky
   *  labels) keep the frame live without each site remembering to call it. */
  invalidate() {
    this._dirty = true;
    this._settleUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 250;
  }
  /** Cheap camera fingerprint: any orbit/pan/zoom changes it. */
  _cameraSig() {
    const c = this.activeCamera();
    const p = c.position, q = c.quaternion;
    return p.x.toFixed(3) + ',' + p.y.toFixed(3) + ',' + p.z.toFixed(3) + ','
      + q.x.toFixed(4) + ',' + q.y.toFixed(4) + ',' + q.z.toFixed(4) + ',' + q.w.toFixed(4);
  }
  _tick() {
    requestAnimationFrame(this._tick);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.applyCamera();
    const camSig = this._cameraSig();
    const camMoved = camSig !== this._camSig;
    if (camMoved) this._camSig = camSig;
    // ON-DEMAND: render only when something changed (or the camera moved,
    // or we're inside a settle window). A static scene costs one rAF no-op.
    if (!this._dirty && !camMoved && now >= this._settleUntil) {
      if (this.hudSticky.length || this.hudPins.length) {
        // labels are camera-anchored; nothing moved, nothing to redraw
      }
      return;
    }
    this._dirty = false;
    // fps EMA over rendered frames
    this._fpsFrames++;
    if (now - this._fpsLast > 500) {
      this._fps = Math.round(this._fpsFrames * 1000 / (now - this._fpsLast));
      this._fpsLast = now; this._fpsFrames = 0;
    }
    // SECTION VIEW (Phase 3.7): the active saved view carries a clip plane —
    // everything in front of the cut is culled, opening the model like a
    // section. Toggled by view._activeSection (activateView/clearSection).
    if (this._activeSection && this._activeSection.clip) {
      if (!this.renderer.localClippingEnabled) this.renderer.localClippingEnabled = true;
      if (!this._sectionPlane) this._sectionPlane = new THREE.Plane();
      const c = this._activeSection.clip;
      this._sectionPlane.set(new THREE.Vector3(c.n[0], c.n[1], c.n[2]), c.d);
      this.renderer.clippingPlanes = [this._sectionPlane];
    } else if (this.renderer.clippingPlanes && this.renderer.clippingPlanes.length) {
      this.renderer.clippingPlanes = [];
    }
    this.renderer.render(this.scene, this.activeCamera());
    // HUD
    const ctx = this.hudCtx;
    const w = this.hud.width, h = this.hud.height;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '600 12.5px system-ui, sans-serif';
    for (const it of this.hudItems) this._drawHudItem(ctx, it.sx, it.sy, it.text, it.color);
    this.hudItems = [];
    this._repushSnapGlyph();
    // tool-placed point marks (arc start/end …): re-projected every frame
    // so they survive a resting mouse and camera moves, like sticky labels
    for (const mk of this.snapMarks || []) {
      const s = this.toScreen(mk.p);
      if (isFinite(s.x) && isFinite(s.y)) this.hudGlyphs.push({ sx: s.x, sy: s.y, kind: mk.kind || 'endpoint' });
    }
    for (const g of this.hudGlyphs) this._drawSnapGlyph(ctx, g.sx, g.sy, g.kind, g.label);
    this.hudGlyphs = [];
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
    // ANNOTATIONS (Phase 3): dims/tags/notes/spots live on the HUD canvas —
    // world-anchored drawing entities that re-project every frame (they
    // never enter the B-Rep mesh).
    this._drawAnnotations(ctx, cam, w, h);
    this._drawAnalytical(ctx, cam, w, h);
    // Performance HUD (View ▸ Performance HUD): the article's diagnosis
    // numbers at a glance — fps, draw calls, triangles
    if (this.perfHud) {
      const info = this.renderer.info;
      const lines = `${this._fps} fps · ${info.render.calls} draws · ${(info.render.triangles / 1000).toFixed(1)}k tris`
        + ` · ${this.app.model.faces.size} faces · ${this.app.bim.entities.length} elements`;
      const t = ctx.measureText(lines);
      ctx.fillStyle = 'rgba(20, 24, 28, 0.82)';
      ctx.fillRect(10, 10, t.width + 18, 22);
      ctx.fillStyle = '#8ab4f8';
      ctx.textAlign = 'left';
      ctx.fillText(lines, 19, 25);
      ctx.textAlign = 'left';
      // keep the readout live while enabled
      this._dirty = true;
    }
  }
  _resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    this.hud.width = w; this.hud.height = h;
    this.hud.style.width = w + 'px'; this.hud.style.height = h + 'px';
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    // heavy-line ribbons expand in clip space — keep the px→NDC scale honest
    for (const ch of this.styledEdges.children)
      if (ch.material && ch.material.uniforms && ch.material.uniforms.uRes)
        ch.material.uniforms.uRes.value.set(w, h);
    this.invalidate();
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
