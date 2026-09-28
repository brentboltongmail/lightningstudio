import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class Viewport {
  constructor(canvasId, containerId) {
    this.canvas = document.getElementById(canvasId);
    this.container = document.getElementById(containerId);

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.transformControls = null;

    // Helpers & Visuals
    this.gridHelper = null;
    this.boxHelper = null;
    this.planeHelperMesh = null;
    this.clipBoxMesh = null;
    this.lights = [];

    // Interaction & State
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.selectedObject = null;
    this.renderMode = 'shaded'; // 'shaded', 'wireframe', 'xray'
    this.activeTool = 'select'; // 'select', 'box-crop', 'plane-slice'

    // Callbacks
    this.onObjectSelected = null;
    this.onBoxTransformed = null;
    this.onPlaneTransformed = null;

    this.init();
  }

  init() {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a); // Slate-950

    // 2. Camera
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.05, 1000);
    this.camera.position.set(3, 2.5, 4);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 4. Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.enableZoom = false; // Disable default jumpy OrbitControls wheel listener
    this.controls.rotateSpeed = 0.8;
    this.controls.panSpeed = 0.8;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 500;
    this.controls.target.set(0, 0.5, 0);

    // 5. Lighting
    this.setupLighting();

    // 6. Ground Grid
    this.setupGrid();

    // 7. Transform Controls (for interactive cutting gizmo)
    this.setupTransformControls();

    // 8. Visual Clip Box & Plane Gizmos
    this.setupClipVisualizers();

    // 9. Event Listeners
    window.addEventListener('resize', () => this.onWindowResize());
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));

    // Custom Smooth & Proportional Wheel Zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();

      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 30; // DOM_DELTA_LINE
      else if (e.deltaMode === 2) delta *= 300; // DOM_DELTA_PAGE

      // Clamp delta per event to prevent sudden huge jumps
      delta = Math.max(-80, Math.min(80, delta));

      // Calculate smooth zoom factor (Shift for micro-precision)
      const sensitivity = e.shiftKey ? 0.0003 : 0.0012;
      const zoomFactor = Math.exp(delta * sensitivity);

      // Distance from camera to target
      const offset = this.camera.position.clone().sub(this.controls.target);
      const currentDist = offset.length();

      const newDist = THREE.MathUtils.clamp(
        currentDist * zoomFactor,
        this.controls.minDistance || 0.05,
        this.controls.maxDistance || 500
      );

      offset.setLength(newDist);
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
    }, { passive: false });

    // Animation Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setupLighting() {
    // Ambient Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);
    this.lights.push(ambientLight);

    // Main Directional Light (Key)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(5, 10, 7.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0001;
    this.scene.add(keyLight);
    this.lights.push(keyLight);

    // Fill Light
    const fillLight = new THREE.DirectionalLight(0x90b0ff, 0.8);
    fillLight.position.set(-5, 5, -5);
    this.scene.add(fillLight);
    this.lights.push(fillLight);

    // Rim Light
    const rimLight = new THREE.DirectionalLight(0xffeedd, 0.6);
    rimLight.position.set(0, -5, -5);
    this.scene.add(rimLight);
    this.lights.push(rimLight);
  }

  setupGrid() {
    this.gridHelper = new THREE.GridHelper(20, 40, 0x3b82f6, 0x1e293b);
    this.gridHelper.position.y = -0.001;
    this.scene.add(this.gridHelper);
  }

  setupTransformControls() {
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.size = 0.8;
    this.transformControls.space = 'world';

    // Disable orbit controls while dragging gizmo
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
    });

    this.transformControls.addEventListener('change', () => {
      if (this.activeTool === 'box-crop' && this.onBoxTransformed) {
        this.onBoxTransformed(this.clipBoxMesh);
      } else if (this.activeTool === 'plane-slice' && this.onPlaneTransformed) {
        this.onPlaneTransformed(this.planeHelperMesh);
      }
    });

    this.scene.add(this.transformControls);
  }

  setupClipVisualizers() {
    // 1. Interactive 3D Clip Box
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const boxMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      wireframe: false,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.clipBoxMesh = new THREE.Mesh(boxGeo, boxMat);
    this.clipBoxMesh.name = '__CLIP_BOX__';

    // Wireframe edges outline for the box
    const edges = new THREE.EdgesGeometry(boxGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x60a5fa, linewidth: 2 });
    const wireframe = new THREE.LineSegments(edges, lineMat);
    this.clipBoxMesh.add(wireframe);
    this.clipBoxMesh.visible = false;
    this.scene.add(this.clipBoxMesh);

    // 2. Interactive Slicing Plane
    const planeGeo = new THREE.PlaneGeometry(3, 3);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.planeHelperMesh = new THREE.Mesh(planeGeo, planeMat);
    this.planeHelperMesh.name = '__SLICE_PLANE__';

    const planeEdges = new THREE.EdgesGeometry(planeGeo);
    const planeLineMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, linewidth: 2 });
    this.planeHelperMesh.add(new THREE.LineSegments(planeEdges, planeLineMat));
    
    // Normal direction arrow helper on the plane
    const dirArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 0.8, 0xfbbf24, 0.2, 0.1);
    this.planeHelperMesh.add(dirArrow);

    this.planeHelperMesh.visible = false;
    this.scene.add(this.planeHelperMesh);
  }

  setToolMode(mode) {
    this.activeTool = mode;
    this.transformControls.detach();

    if (mode === 'box-crop') {
      this.clipBoxMesh.visible = true;
      this.planeHelperMesh.visible = false;
      this.transformControls.attach(this.clipBoxMesh);
      this.transformControls.setMode('translate');
    } else if (mode === 'plane-slice') {
      this.clipBoxMesh.visible = false;
      this.planeHelperMesh.visible = true;
      this.transformControls.attach(this.planeHelperMesh);
      this.transformControls.setMode('translate');
    } else {
      // 'select' mode
      this.clipBoxMesh.visible = false;
      this.planeHelperMesh.visible = false;
      if (this.selectedObject && this.selectedObject.isMesh) {
        // Ready for selection
      }
    }
  }

  setGizmoMode(gizmoMode) {
    // 'translate', 'scale', 'rotate'
    if (this.transformControls) {
      this.transformControls.setMode(gizmoMode);
    }
  }

  onPointerDown(event) {
    // Only raycast in select mode
    if (this.activeTool !== 'select') return;
    if (this.transformControls.dragging) return;

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Get all meshes except helpers
    const candidates = [];
    this.scene.traverse((child) => {
      if (child.isMesh && !child.name.startsWith('__') && child.visible) {
        candidates.push(child);
      }
    });

    const intersects = this.raycaster.intersectObjects(candidates, true);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      this.selectObject(hit);
    } else {
      this.selectObject(null);
    }
  }

  selectObject(object) {
    // Restore previous selection visual
    if (this.selectedObject && this.selectedObject.userData.__origEmissive !== undefined) {
      if (this.selectedObject.material && this.selectedObject.material.emissive) {
        this.selectedObject.material.emissive.setHex(this.selectedObject.userData.__origEmissive);
      }
    }

    this.selectedObject = object;

    if (this.selectedObject && this.selectedObject.isMesh) {
      if (this.selectedObject.material && this.selectedObject.material.emissive) {
        this.selectedObject.userData.__origEmissive = this.selectedObject.material.emissive.getHex();
        this.selectedObject.material.emissive.setHex(0x2563eb); // blue highlight
      }
    }

    if (this.onObjectSelected) {
      this.onObjectSelected(this.selectedObject);
    }
  }

  focusOnObject(object) {
    if (!object) return;

    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
    cameraDistance = Math.max(cameraDistance, 1.5);

    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(dir.multiplyScalar(cameraDistance));
    this.controls.update();
  }

  setCameraPreset(viewName) {
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target);

    switch (viewName) {
      case 'front':
        this.camera.position.set(target.x, target.y, target.z + dist);
        break;
      case 'back':
        this.camera.position.set(target.x, target.y, target.z - dist);
        break;
      case 'top':
        this.camera.position.set(target.x, target.y + dist, target.z + 0.0001);
        break;
      case 'right':
        this.camera.position.set(target.x + dist, target.y, target.z);
        break;
      case 'iso':
      default:
        this.camera.position.set(target.x + dist * 0.7, target.y + dist * 0.7, target.z + dist * 0.7);
        break;
    }
    this.camera.lookAt(target);
    this.controls.update();
  }

  zoomIn(factor = 0.85) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.multiplyScalar(factor);
    this.camera.position.copy(this.controls.target).add(dir);
    this.controls.update();
  }

  zoomOut(factor = 1.18) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.multiplyScalar(factor);
    this.camera.position.copy(this.controls.target).add(dir);
    this.controls.update();
  }

  setRenderMode(mode) {
    this.renderMode = mode;
    this.scene.traverse((child) => {
      if (child.isMesh && !child.name.startsWith('__')) {
        const mat = child.material;
        if (Array.isArray(mat)) {
          mat.forEach(m => this.applyMaterialMode(m, mode));
        } else if (mat) {
          this.applyMaterialMode(mat, mode);
        }
      }
    });
  }

  applyMaterialMode(mat, mode) {
    if (!mat) return;
    if (mode === 'wireframe') {
      mat.wireframe = true;
      mat.transparent = false;
      mat.opacity = 1.0;
    } else if (mode === 'xray') {
      mat.wireframe = false;
      mat.transparent = true;
      mat.opacity = 0.45;
      mat.depthWrite = false;
    } else {
      // shaded
      mat.wireframe = false;
      mat.transparent = mat.userData.__wasTransparent || false;
      mat.opacity = mat.userData.__origOpacity !== undefined ? mat.userData.__origOpacity : 1.0;
      mat.depthWrite = true;
    }
    mat.needsUpdate = true;
  }

  toggleGrid(visible) {
    if (this.gridHelper) {
      this.gridHelper.visible = visible !== undefined ? visible : !this.gridHelper.visible;
      return this.gridHelper.visible;
    }
    return false;
  }

  fitClipBoxToModel(modelRoot) {
    if (!modelRoot) return;
    const box = new THREE.Box3().setFromObject(modelRoot);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    this.clipBoxMesh.position.copy(center);
    this.clipBoxMesh.scale.copy(size);
    this.clipBoxMesh.rotation.set(0, 0, 0);

    // Plane helper default fit
    this.planeHelperMesh.position.copy(center);
    this.planeHelperMesh.scale.set(size.x * 1.5, size.z * 1.5, 1);
  }

  onWindowResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
