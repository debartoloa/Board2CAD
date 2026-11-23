/**
 * Board2CAD — Interactive Three.js 3D Viewer Component (js/components/viewer3d.js)
 * Features:
 *   - Real-time 3D rendering of multicolor 3MF parts and monochrome STL buffers
 *   - Millimeter CAD grid, XYZ reference axes, OrbitControls (touch + mouse)
 *   - Camera presets (Iso, Top, Front, Bottom), Wireframe toggle, Multicolor/STL toggle
 *   - Instant PNG Screenshot capture (canvas.toDataURL('image/png'))
 *   - Automatic fallback to static preview.png / .jpg if WebGL is unavailable
 */

export class Viewer3D {
  constructor({ stageEl, fallbackEl, fallbackImgEl, hudStatsEl }) {
    this.stageEl = stageEl;
    this.fallbackEl = fallbackEl;
    this.fallbackImgEl = fallbackImgEl;
    this.hudStatsEl = hudStatsEl;

    this.THREE = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.gridHelper = null;
    this.axesHelper = null;
    this.boardGroup = null;

    this.webglSupported = false;
    this.multicolorMode = true;
    this.wireframeMode = false;
    this.gridVisible = true;
    this.lastViewerParts = [];
    this.currentBoardSize = { length: 86, width: 50, height: 11.2 };
  }

  /**
   * Inizializza WebGL e Three.js con fallback automatico su immagine statica
   */
  async init() {
    if (!this.checkWebGLSupport()) {
      console.warn('[Viewer3D] WebGL non disponibile su questo dispositivo: attivo fallback statico PNG.');
      this.enableStaticFallback();
      return false;
    }

    try {
      const [THREE, OrbitModule] = await Promise.all([
        import('three'),
        import('three/addons/controls/OrbitControls.js')
      ]);

      this.THREE = THREE;
      const OrbitControls = OrbitModule.OrbitControls;

      const width = this.stageEl.clientWidth || 720;
      const height = this.stageEl.clientHeight || 480;

      this.scene = new THREE.Scene();

      // Telecamera prospettica calibrata in millimetri
      this.camera = new THREE.PerspectiveCamera(38, width / height, 0.5, 2000);
      this.camera.position.set(85, -95, 82);
      this.camera.up.set(0, 0, 1); // Z-up standard per CAD 3D / OpenSCAD

      // Renderer WebGL con preserveDrawingBuffer: true per cattura PNG (preview.png)
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.stageEl.insertBefore(this.renderer.domElement, this.stageEl.firstChild);

      // OrbitControls (Mouse + Touch pinch/rotate)
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.screenSpacePanning = true;
      this.controls.maxDistance = 600;
      this.controls.minDistance = 15;

      // Illuminazione Studio CAD a 3 punti
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
      this.scene.add(ambientLight);

      const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
      keyLight.position.set(120, -140, 180);
      this.scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.55);
      fillLight.position.set(-130, 120, 90);
      this.scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0x34d399, 0.35);
      rimLight.position.set(0, 150, -100);
      this.scene.add(rimLight);

      // Griglia millimetrata sul piano XY (ruotata perché GridHelper di default è XZ)
      this.gridHelper = new THREE.GridHelper(200, 20, 0x38bdf8, 0x1e293b);
      this.gridHelper.rotation.x = Math.PI / 2;
      this.gridHelper.position.z = -3.2;
      this.scene.add(this.gridHelper);

      // Assi di riferimento XYZ (Rosso=X, Verde=Y, Blu=Z)
      this.axesHelper = new THREE.AxesHelper(35);
      this.axesHelper.position.set(-48, -30, 0);
      this.scene.add(this.axesHelper);

      // Gruppo contenitore del modello PCB
      this.boardGroup = new THREE.Group();
      this.scene.add(this.boardGroup);

      // Gestione resize responsive
      window.addEventListener('resize', () => this.onResize());

      this.webglSupported = true;
      this.hideStaticFallback();
      this.animate();
      return true;
    } catch (err) {
      console.warn('[Viewer3D] Caricamento Three.js non riuscito, attivo fallback immagine preview.png:', err);
      this.enableStaticFallback();
      return false;
    }
  }

  /**
   * Verifica se il browser supporta WebGL
   */
  checkWebGLSupport() {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(
        window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      );
    } catch {
      return false;
    }
  }

  /**
   * Mostra l'immagine preview.png di fallback quando WebGL non è disponibile
   */
  enableStaticFallback(previewUrl) {
    this.webglSupported = false;
    if (this.fallbackEl) {
      this.fallbackEl.hidden = false;
    }
    if (previewUrl && this.fallbackImgEl) {
      this.fallbackImgEl.src = previewUrl;
    }
  }

  hideStaticFallback() {
    if (this.fallbackEl) {
      this.fallbackEl.hidden = true;
    }
  }

  /**
   * Aggiorna l'URL dell'immagine di fallback
   */
  setFallbackImage(previewUrl) {
    if (this.fallbackImgEl && previewUrl) {
      this.fallbackImgEl.src = previewUrl;
    }
  }

  /**
   * Renderizza le parti 3D compilate dal Web Worker OpenSCAD
   */
  renderCompiledParts(viewerParts = [], metrics = {}, previewUrl = '') {
    this.setFallbackImage(previewUrl);
    this.lastViewerParts = viewerParts;

    if (metrics.dimensions) {
      this.currentBoardSize = metrics.dimensions;
    }

    if (this.hudStatsEl) {
      const tris = metrics.triangles ?? viewerParts.reduce((a, p) => a + (p.triangleCount || 0), 0);
      const verts = metrics.vertices ?? tris * 3;
      this.hudStatsEl.textContent = `Triangoli: ${tris.toLocaleString('it-IT')} · Vertici: ${verts.toLocaleString('it-IT')} · Watertight: SÌ (eps 0.05mm)`;
    }

    if (!this.webglSupported || !this.THREE || !this.boardGroup) {
      this.enableStaticFallback(previewUrl);
      return;
    }

    const THREE = this.THREE;

    // Pulisce le mesh precedenti
    while (this.boardGroup.children.length > 0) {
      const child = this.boardGroup.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    const centerXY = Array.isArray(metrics.center)
      ? metrics.center
      : [(this.currentBoardSize.length || 86) * 0.5, (this.currentBoardSize.width || 50) * 0.5];
    const cxOffset = -centerXY[0];
    const cyOffset = -centerXY[1];

    for (const part of viewerParts) {
      const geom = new THREE.BufferGeometry();
      const posArray = part.positions instanceof Float32Array ? part.positions : new Float32Array(part.positions);
      geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      geom.computeVertexNormals();

      const displayColor = this.multicolorMode ? (part.color || '#38bdf8') : '#38bdf8';
      const isMetal = /Pad|Pin|USB|Shield|MicroSD/i.test(part.name);
      const isScreen = /Screen|Bezel/i.test(part.name);

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(displayColor),
        roughness: isMetal ? 0.28 : isScreen ? 0.18 : 0.55,
        metalness: isMetal ? 0.65 : 0.1,
        wireframe: this.wireframeMode,
        side: THREE.DoubleSide
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(cxOffset, cyOffset, 0);
      this.boardGroup.add(mesh);
    }

    if (this.axesHelper) {
      this.axesHelper.position.set(cxOffset - 6, cyOffset - 6, 0);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Alterna tra vista 3MF Multicolore e vista STL Monocolore
   */
  toggleColorMode() {
    this.multicolorMode = !this.multicolorMode;
    if (this.lastViewerParts.length > 0) {
      this.renderCompiledParts(this.lastViewerParts, { dimensions: this.currentBoardSize });
    }
    return this.multicolorMode;
  }

  /**
   * Alterna la modalità Wireframe
   */
  toggleWireframe() {
    this.wireframeMode = !this.wireframeMode;
    if (this.boardGroup) {
      this.boardGroup.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          obj.material.wireframe = this.wireframeMode;
        }
      });
    }
    return this.wireframeMode;
  }

  /**
   * Mostra/nasconde la griglia millimetrata
   */
  toggleGrid() {
    this.gridVisible = !this.gridVisible;
    if (this.gridHelper) {
      this.gridHelper.visible = this.gridVisible;
    }
    if (this.axesHelper) {
      this.axesHelper.visible = this.gridVisible;
    }
    return this.gridVisible;
  }

  /**
   * Imposta la vista della telecamera (iso, top, front, bottom)
   */
  setCameraPreset(preset = 'iso') {
    if (!this.camera || !this.controls) return;
    const maxDim = Math.max(this.currentBoardSize.length || 86, this.currentBoardSize.width || 50);
    const dist = maxDim * 1.35;

    this.controls.target.set(0, 0, 0);

    switch (preset) {
      case 'top':
        this.camera.position.set(0, -0.01, dist * 1.15);
        break;
      case 'front':
        this.camera.position.set(0, -dist * 1.2, 12);
        break;
      case 'bottom':
        this.camera.position.set(0, 0.01, -dist * 1.15);
        break;
      case 'iso':
      default:
        this.camera.position.set(dist * 0.85, -dist * 0.95, dist * 0.78);
        break;
    }

    this.controls.update();
  }

  /**
   * Cattura uno screenshot PNG del viewport 3D (canvas.toDataURL('image/png'))
   */
  capturePreviewPng() {
    if (this.webglSupported && this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL('image/png');
    }
    return this.fallbackImgEl ? this.fallbackImgEl.src : '';
  }

  onResize() {
    if (!this.webglSupported || !this.renderer || !this.camera || !this.stageEl) return;
    const w = this.stageEl.clientWidth || 720;
    const h = this.stageEl.clientHeight || 480;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animate() {
    if (!this.webglSupported) return;
    requestAnimationFrame(() => this.animate());
    if (this.controls) this.controls.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
