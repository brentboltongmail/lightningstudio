import * as THREE from 'three';
import { Viewport } from './viewport.js';
import { ModelManager } from './modelManager.js';
import { GeometryClipper } from './clipper.js';
import { UI } from './ui.js';
import { SessionStorage } from './storage.js';

class App {
  constructor() {
    this.viewport = new Viewport('canvas3d', 'viewport-container');
    this.modelManager = new ModelManager(this.viewport);
    this.ui = new UI();

    // Box Clipper State
    this.boxMode = 'crop'; // 'crop' (keep inside) or 'carve' (cut away)
    this.boxBounds = {
      minX: -0.5, maxX: 0.5,
      minY: -0.5, maxY: 0.5,
      minZ: -0.5, maxZ: 0.5
    };

    // Plane Slicer State
    this.planeAxis = 'y'; // 'x', 'y', 'z'
    this.planeOffset = 0.0;
    this.planeFlip = false;

    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.setupModelCallbacks();
    this.setupViewportCallbacks();

    // Attempt to restore last loaded file from IndexedDB
    try {
      const cached = await SessionStorage.getLastModel();
      if (cached && cached.arrayBuffer && !cached.isSample) {
        this.ui.setLoading(true, `Restoring ${cached.fileName}...`, 'Reloading previously opened 3D model');
        await this.modelManager.loadFromArrayBuffer(cached.arrayBuffer, cached.fileName);
        this.ui.setLoading(false);
        this.ui.showToast(`Restored previous file: ${cached.fileName}`, 'success', 4000);
        return;
      }
    } catch (err) {
      console.warn('Could not restore cached session:', err);
    }

    // Default to sample model if no previous file was cached
    setTimeout(() => {
      this.modelManager.loadSampleModel();
      this.ui.showToast('Sample model loaded! Try Box Clip or Plane Slice.', 'info', 4000);
    }, 150);
  }

  setupModelCallbacks() {
    this.modelManager.onModelLoaded = (stats, tree) => {
      this.ui.updateStats(stats, this.modelManager.currentFileName);
      this.ui.renderHierarchyTree(
        tree,
        (uuid) => this.selectNodeByUuid(uuid),
        (uuid) => this.modelManager.toggleNodeVisibility(uuid)
      );
      this.syncBoxSlidersFromMesh();
      this.syncPlaneVisualizer();
    };

    this.modelManager.onModelUpdated = (stats, tree) => {
      this.ui.updateStats(stats, this.modelManager.currentFileName);
      this.ui.renderHierarchyTree(
        tree,
        (uuid) => this.selectNodeByUuid(uuid),
        (uuid) => this.modelManager.toggleNodeVisibility(uuid)
      );
      if (this.viewport.selectedObject) {
        this.ui.showSelectedMesh(this.viewport.selectedObject);
      }
    };
  }

  setupViewportCallbacks() {
    this.viewport.onObjectSelected = (obj) => {
      this.ui.showSelectedMesh(obj);
    };

    this.viewport.onBoxTransformed = () => {
      // 3D gizmo modified the box
      this.updateBoxRangeDisplay();
    };

    this.viewport.onPlaneTransformed = (planeMesh) => {
      // 3D gizmo modified the plane
      const pos = planeMesh.position;
      if (this.planeAxis === 'x') this.planeOffset = pos.x;
      else if (this.planeAxis === 'y') this.planeOffset = pos.y;
      else if (this.planeAxis === 'z') this.planeOffset = pos.z;

      this.ui.planePosVal.textContent = this.planeOffset.toFixed(2);
    };
  }

  setupEventListeners() {
    // 1. File Import & Drag and Drop
    const fileInput = document.getElementById('file-input');
    const btnImport = document.getElementById('btn-import');
    const btnLoadSample = document.getElementById('btn-load-sample');
    const dropOverlay = document.getElementById('drop-overlay');

    btnImport.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) this.loadFile(file);
      fileInput.value = '';
    });

    btnLoadSample.addEventListener('click', () => {
      this.ui.setLoading(true, 'Generating Sample Model...', 'Creating procedural meshes and materials');
      setTimeout(async () => {
        this.modelManager.loadSampleModel();
        await SessionStorage.clearSession();
        this.ui.setLoading(false);
        this.ui.showToast('Sample model loaded successfully!', 'success');
      }, 100);
    });

    // Drag & Drop
    const container = document.getElementById('viewport-container');
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropOverlay.classList.remove('hidden');
    });
    container.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null || !container.contains(e.relatedTarget)) {
        dropOverlay.classList.add('hidden');
      }
    });
    container.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropOverlay.classList.add('hidden');
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
        this.loadFile(file);
      } else {
        this.ui.showToast('Please drop a valid .glb or .gltf file', 'warning');
      }
    });

    // 2. Toolbar Modes (Select, Box Crop, Plane Slice)
    const toolSelect = document.getElementById('tool-select');
    const toolBoxCrop = document.getElementById('tool-box-crop');
    const toolPlaneSlice = document.getElementById('tool-plane-slice');
    const panelBoxControls = document.getElementById('panel-box-controls');
    const panelPlaneControls = document.getElementById('panel-plane-controls');
    const tabBtnClip = document.getElementById('tab-btn-clip');
    const tabBtnStats = document.getElementById('tab-btn-stats');
    const tabContentClip = document.getElementById('tab-content-clip');
    const tabContentStats = document.getElementById('tab-content-stats');

    const setTool = (mode) => {
      [toolSelect, toolBoxCrop, toolPlaneSlice].forEach(b => {
        b.classList.remove('bg-blue-600', 'text-white');
        b.classList.add('text-slate-300');
      });

      if (mode === 'select') {
        toolSelect.classList.add('bg-blue-600', 'text-white');
      } else if (mode === 'box-crop') {
        toolBoxCrop.classList.add('bg-blue-600', 'text-white');
        panelBoxControls.classList.remove('hidden');
        panelPlaneControls.classList.add('hidden');
        // Switch right sidebar to clipping tab
        tabBtnClip.click();
      } else if (mode === 'plane-slice') {
        toolPlaneSlice.classList.add('bg-blue-600', 'text-white');
        panelBoxControls.classList.add('hidden');
        panelPlaneControls.classList.remove('hidden');
        tabBtnClip.click();
        this.syncPlaneVisualizer();
      }
      this.viewport.setToolMode(mode);
    };

    toolSelect.addEventListener('click', () => setTool('select'));
    toolBoxCrop.addEventListener('click', () => setTool('box-crop'));
    toolPlaneSlice.addEventListener('click', () => setTool('plane-slice'));

    // Sidebar Tabs
    tabBtnClip.addEventListener('click', () => {
      tabBtnClip.classList.add('text-blue-400', 'bg-slate-800/80');
      tabBtnClip.classList.remove('text-slate-400');
      tabBtnStats.classList.remove('text-blue-400', 'bg-slate-800/80');
      tabBtnStats.classList.add('text-slate-400');
      tabContentClip.classList.remove('hidden');
      tabContentStats.classList.add('hidden');
    });

    tabBtnStats.addEventListener('click', () => {
      tabBtnStats.classList.add('text-blue-400', 'bg-slate-800/80');
      tabBtnStats.classList.remove('text-slate-400');
      tabBtnClip.classList.remove('text-blue-400', 'bg-slate-800/80');
      tabBtnClip.classList.add('text-slate-400');
      tabContentStats.classList.remove('hidden');
      tabContentClip.classList.add('hidden');
    });

    // 3. Viewport Camera & Render Mode buttons
    document.getElementById('cam-view-iso').addEventListener('click', () => this.viewport.setCameraPreset('iso'));
    document.getElementById('cam-view-front').addEventListener('click', () => this.viewport.setCameraPreset('front'));
    document.getElementById('cam-view-top').addEventListener('click', () => this.viewport.setCameraPreset('top'));
    document.getElementById('cam-view-right').addEventListener('click', () => this.viewport.setCameraPreset('right'));
    document.getElementById('cam-zoom-in').addEventListener('click', () => this.viewport.zoomIn());
    document.getElementById('cam-zoom-out').addEventListener('click', () => this.viewport.zoomOut());
    document.getElementById('cam-focus').addEventListener('click', () => {
      if (this.viewport.selectedObject) {
        this.viewport.focusOnObject(this.viewport.selectedObject);
      } else if (this.modelManager.currentModel) {
        this.viewport.focusOnObject(this.modelManager.currentModel);
      }
    });

    // Render modes
    const btnShaded = document.getElementById('view-mode-shaded');
    const btnWireframe = document.getElementById('view-mode-wireframe');
    const btnXray = document.getElementById('view-mode-xray');

    const updateRenderModeBtns = (activeBtn) => {
      [btnShaded, btnWireframe, btnXray].forEach(b => {
        b.classList.remove('bg-blue-600', 'text-white');
        b.classList.add('text-slate-300');
      });
      activeBtn.classList.add('bg-blue-600', 'text-white');
      activeBtn.classList.remove('text-slate-300');
    };

    btnShaded.addEventListener('click', () => {
      this.viewport.setRenderMode('shaded');
      updateRenderModeBtns(btnShaded);
    });
    btnWireframe.addEventListener('click', () => {
      this.viewport.setRenderMode('wireframe');
      updateRenderModeBtns(btnWireframe);
    });
    btnXray.addEventListener('click', () => {
      this.viewport.setRenderMode('xray');
      updateRenderModeBtns(btnXray);
    });

    // Grid toggle
    const toggleGridBtn = document.getElementById('toggle-grid');
    toggleGridBtn.addEventListener('click', () => {
      const isVis = this.viewport.toggleGrid();
      if (isVis) {
        toggleGridBtn.classList.add('text-blue-400', 'bg-slate-800/80');
      } else {
        toggleGridBtn.classList.remove('text-blue-400', 'bg-slate-800/80');
      }
    });

    // 4. Box Clipper Controls (Crop / Carve, Sliders, Fit to Model)
    const btnModeCrop = document.getElementById('btn-mode-crop');
    const btnModeCarve = document.getElementById('btn-mode-carve');

    btnModeCrop.addEventListener('click', () => {
      this.boxMode = 'crop';
      btnModeCrop.classList.add('bg-blue-600', 'text-white');
      btnModeCrop.classList.remove('text-slate-400');
      btnModeCarve.classList.remove('bg-blue-600', 'text-white');
      btnModeCarve.classList.add('text-slate-400');
    });

    btnModeCarve.addEventListener('click', () => {
      this.boxMode = 'carve';
      btnModeCarve.classList.add('bg-blue-600', 'text-white');
      btnModeCarve.classList.remove('text-slate-400');
      btnModeCrop.classList.remove('bg-blue-600', 'text-white');
      btnModeCrop.classList.add('text-slate-400');
    });

    document.getElementById('btn-fit-box').addEventListener('click', () => {
      if (this.modelManager.currentModel) {
        this.viewport.fitClipBoxToModel(this.modelManager.currentModel);
        this.syncBoxSlidersFromMesh();
        this.ui.showToast('Box reset to fit model bounds', 'info');
      }
    });

    // Gizmo Modes
    const gizmoTranslate = document.getElementById('gizmo-mode-translate');
    const gizmoScale = document.getElementById('gizmo-mode-scale');
    gizmoTranslate.addEventListener('click', () => {
      this.viewport.setGizmoMode('translate');
      gizmoTranslate.classList.add('bg-blue-600', 'text-white');
      gizmoTranslate.classList.remove('bg-slate-800', 'text-slate-300');
      gizmoScale.classList.remove('bg-blue-600', 'text-white');
      gizmoScale.classList.add('bg-slate-800', 'text-slate-300');
    });
    gizmoScale.addEventListener('click', () => {
      this.viewport.setGizmoMode('scale');
      gizmoScale.classList.add('bg-blue-600', 'text-white');
      gizmoScale.classList.remove('bg-slate-800', 'text-slate-300');
      gizmoTranslate.classList.remove('bg-blue-600', 'text-white');
      gizmoTranslate.classList.add('bg-slate-800', 'text-slate-300');
    });

    // Box Sliders bindings
    const handleSliderInput = () => {
      if (!this.modelManager.currentModel) return;
      const box = new THREE.Box3().setFromObject(this.modelManager.currentModel);
      const min = box.min;
      const size = box.getSize(new THREE.Vector3());

      const minXPct = parseFloat(this.ui.boxRangeMinX.value) / 100;
      const maxXPct = parseFloat(this.ui.boxRangeMaxX.value) / 100;
      const minYPct = parseFloat(this.ui.boxRangeMinY.value) / 100;
      const maxYPct = parseFloat(this.ui.boxRangeMaxY.value) / 100;
      const minZPct = parseFloat(this.ui.boxRangeMinZ.value) / 100;
      const maxZPct = parseFloat(this.ui.boxRangeMaxZ.value) / 100;

      const newMinX = min.x + minXPct * size.x;
      const newMaxX = min.x + maxXPct * size.x;
      const newMinY = min.y + minYPct * size.y;
      const newMaxY = min.y + maxYPct * size.y;
      const newMinZ = min.z + minZPct * size.z;
      const newMaxZ = min.z + maxZPct * size.z;

      const boxCenter = new THREE.Vector3(
        (newMinX + newMaxX) / 2,
        (newMinY + newMaxY) / 2,
        (newMinZ + newMaxZ) / 2
      );
      const boxSize = new THREE.Vector3(
        Math.max(0.01, newMaxX - newMinX),
        Math.max(0.01, newMaxY - newMinY),
        Math.max(0.01, newMaxZ - newMinZ)
      );

      this.viewport.clipBoxMesh.position.copy(boxCenter);
      this.viewport.clipBoxMesh.scale.copy(boxSize);

      this.ui.boxValX.textContent = `${Math.round((maxXPct - minXPct) * 100)}%`;
      this.ui.boxValY.textContent = `${Math.round((maxYPct - minYPct) * 100)}%`;
      this.ui.boxValZ.textContent = `${Math.round((maxZPct - minZPct) * 100)}%`;
    };

    [
      this.ui.boxRangeMinX, this.ui.boxRangeMaxX,
      this.ui.boxRangeMinY, this.ui.boxRangeMaxY,
      this.ui.boxRangeMinZ, this.ui.boxRangeMaxZ
    ].forEach(slider => slider.addEventListener('input', handleSliderInput));

    // 5. Plane Slicer Controls (Axis, Position, Flip)
    const btnPlaneX = document.getElementById('plane-axis-x');
    const btnPlaneY = document.getElementById('plane-axis-y');
    const btnPlaneZ = document.getElementById('plane-axis-z');
    const btnFlipPlane = document.getElementById('btn-flip-plane');

    const setPlaneAxis = (axis) => {
      this.planeAxis = axis;
      [btnPlaneX, btnPlaneY, btnPlaneZ].forEach(b => {
        b.classList.remove('bg-blue-600', 'text-white');
        b.classList.add('bg-slate-800', 'text-slate-300');
      });

      if (axis === 'x') btnPlaneX.classList.replace('bg-slate-800', 'bg-blue-600');
      if (axis === 'y') btnPlaneY.classList.replace('bg-slate-800', 'bg-blue-600');
      if (axis === 'z') btnPlaneZ.classList.replace('bg-slate-800', 'bg-blue-600');

      this.syncPlaneVisualizer();
    };

    btnPlaneX.addEventListener('click', () => setPlaneAxis('x'));
    btnPlaneY.addEventListener('click', () => setPlaneAxis('y'));
    btnPlaneZ.addEventListener('click', () => setPlaneAxis('z'));

    this.ui.planePosSlider.addEventListener('input', (e) => {
      if (!this.modelManager.currentModel) return;
      const box = new THREE.Box3().setFromObject(this.modelManager.currentModel);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      const pct = parseFloat(e.target.value) / 100; // -1 to 1

      if (this.planeAxis === 'x') {
        this.planeOffset = center.x + pct * (size.x / 2);
      } else if (this.planeAxis === 'y') {
        this.planeOffset = center.y + pct * (size.y / 2);
      } else {
        this.planeOffset = center.z + pct * (size.z / 2);
      }

      this.ui.planePosVal.textContent = this.planeOffset.toFixed(2);
      this.syncPlaneVisualizer();
    });

    btnFlipPlane.addEventListener('click', () => {
      this.planeFlip = !this.planeFlip;
      this.ui.planeDirectionLabel.textContent = this.planeFlip ? 'Keep Lower Side' : 'Keep Upper Side';
      this.syncPlaneVisualizer();
    });

    // 6. APPLY CLIPPING OPERATIONS
    // Apply Box Clip
    this.ui.btnApplyBoxClip.addEventListener('click', () => this.applyBoxClip());

    // Apply Plane Slice
    this.ui.btnApplyPlaneSlice.addEventListener('click', () => this.applyPlaneSlice());

    // 7. Submesh Actions (Delete, Isolate, Toggle)
    document.getElementById('btn-delete-part').addEventListener('click', () => {
      if (this.viewport.selectedObject) {
        const name = this.viewport.selectedObject.name || 'Selected Part';
        this.modelManager.deleteMesh(this.viewport.selectedObject);
        this.ui.showToast(`Deleted ${name}`, 'info');
      }
    });

    document.getElementById('btn-isolate-part').addEventListener('click', () => {
      if (this.viewport.selectedObject) {
        this.modelManager.isolateMesh(this.viewport.selectedObject);
        this.ui.showToast('Isolated selected part', 'info');
      }
    });

    document.getElementById('btn-toggle-part-vis').addEventListener('click', () => {
      if (this.viewport.selectedObject) {
        this.modelManager.toggleNodeVisibility(this.viewport.selectedObject.uuid);
      }
    });

    // 8. History & Undo Actions
    this.ui.btnUndo.addEventListener('click', () => {
      const ok = this.modelManager.undo();
      if (ok) {
        this.ui.showToast('Undid last action', 'info');
      } else {
        this.ui.showToast('No more actions to undo', 'warning');
      }
    });

    this.ui.btnResetModel.addEventListener('click', () => {
      this.modelManager.resetToOriginal();
      this.ui.showToast('Reset model to original state', 'info');
    });

    // Keyboard Shortcuts (Ctrl+Z: Undo, F: Focus, Delete: Delete part)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.ui.btnUndo.click();
      } else if (e.key.toLowerCase() === 'f') {
        document.getElementById('cam-focus').click();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.viewport.selectedObject && document.activeElement.tagName !== 'INPUT') {
          document.getElementById('btn-delete-part').click();
        }
      }
    });

    // 9. EXPORT AS GLB
    const handleExport = async () => {
      try {
        const weld = document.getElementById('opt-weld-vertices')?.checked ?? true;
        const purge = document.getElementById('opt-purge-unused')?.checked ?? true;

        this.ui.setLoading(true, 'Optimizing & Packaging GLB...', 'Welding indexed vertices and packaging textures');
        const result = await this.modelManager.exportGLB(null, { weldVertices: weld, purgeUnused: purge });
        this.ui.setLoading(false);
        const sizeMb = (result.size / (1024 * 1024)).toFixed(2);
        this.ui.showToast(`Exported ${result.name} (${sizeMb} MB) with lossless optimization!`, 'success', 5000);
      } catch (err) {
        this.ui.setLoading(false);
        this.ui.showToast(`Export failed: ${err.message}`, 'error');
      }
    };

    this.ui.btnExportGLB.addEventListener('click', handleExport);
    this.ui.btnExportGLBSidebar.addEventListener('click', handleExport);
  }

  async loadFile(file) {
    try {
      this.ui.setLoading(true, `Loading ${file.name}...`, 'Parsing geometry and embedded textures');
      const arrayBuffer = await file.arrayBuffer();
      await this.modelManager.loadFromArrayBuffer(arrayBuffer, file.name);
      await SessionStorage.saveLastModel(file.name, arrayBuffer, false);
      this.ui.setLoading(false);
      this.ui.showToast(`Loaded ${file.name} (Remembered for next startup)`, 'success');
    } catch (err) {
      this.ui.setLoading(false);
      this.ui.showToast(`Failed to load file: ${err.message}`, 'error');
    }
  }

  selectNodeByUuid(uuid) {
    if (!this.modelManager.currentModel) return;
    let target = null;
    this.modelManager.currentModel.traverse((child) => {
      if (child.uuid === uuid) target = child;
    });

    if (target && target.isMesh) {
      this.viewport.selectObject(target);
    }
  }

  syncBoxSlidersFromMesh() {
    this.ui.boxRangeMinX.value = 0;
    this.ui.boxRangeMaxX.value = 100;
    this.ui.boxRangeMinY.value = 0;
    this.ui.boxRangeMaxY.value = 100;
    this.ui.boxRangeMinZ.value = 0;
    this.ui.boxRangeMaxZ.value = 100;

    this.ui.boxValX.textContent = '100%';
    this.ui.boxValY.textContent = '100%';
    this.ui.boxValZ.textContent = '100%';
  }

  updateBoxRangeDisplay() {
    // When gizmo moves the box, keep stats updated
  }

  syncPlaneVisualizer() {
    if (!this.modelManager.currentModel) return;
    const planeMesh = this.viewport.planeHelperMesh;
    const box = new THREE.Box3().setFromObject(this.modelManager.currentModel);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const planeSize = Math.max(size.x, size.y, size.z) * 1.6;
    planeMesh.scale.set(planeSize, planeSize, 1);

    if (this.planeAxis === 'x') {
      planeMesh.position.set(this.planeOffset || center.x, center.y, center.z);
      planeMesh.rotation.set(0, this.planeFlip ? -Math.PI / 2 : Math.PI / 2, 0);
    } else if (this.planeAxis === 'y') {
      planeMesh.position.set(center.x, this.planeOffset || center.y, center.z);
      planeMesh.rotation.set(this.planeFlip ? Math.PI / 2 : -Math.PI / 2, 0, 0);
    } else {
      // 'z'
      planeMesh.position.set(center.x, center.y, this.planeOffset || center.z);
      planeMesh.rotation.set(0, this.planeFlip ? Math.PI : 0, 0);
    }
  }

  applyBoxClip() {
    if (!this.modelManager.currentModel) return;

    this.ui.setLoading(true, 'Clipping 3D Geometry...', 'Cutting polygons and recalculating buffer attributes');

    setTimeout(() => {
      try {
        const prevStats = this.modelManager.getStatistics();
        this.modelManager.saveSnapshot();

        let modified = 0;
        if (this.boxMode === 'crop') {
          modified = GeometryClipper.cropModelByBox(
            this.modelManager.currentModel,
            this.viewport.clipBoxMesh
          );
        } else {
          modified = GeometryClipper.carveBoxFromModel(
            this.modelManager.currentModel,
            this.viewport.clipBoxMesh
          );
        }

        this.modelManager.notifyUpdate();
        this.ui.setLoading(false);

        const newStats = this.modelManager.getStatistics();
        const triDiff = prevStats.triangles - newStats.triangles;
        this.ui.showToast(`Box cut applied! Removed ${triDiff.toLocaleString()} triangles across ${modified} meshes.`, 'success');
      } catch (err) {
        this.ui.setLoading(false);
        this.ui.showToast(`Clipping error: ${err.message}`, 'error');
        console.error(err);
      }
    }, 50);
  }

  applyPlaneSlice() {
    if (!this.modelManager.currentModel) return;

    this.ui.setLoading(true, 'Slicing 3D Geometry...', 'Executing plane cross-section clipping');

    setTimeout(() => {
      try {
        const prevStats = this.modelManager.getStatistics();
        this.modelManager.saveSnapshot();

        // Calculate world normal and point of plane
        const planePoint = this.viewport.planeHelperMesh.position.clone();
        const planeNormal = new THREE.Vector3(0, 0, 1);
        planeNormal.applyEuler(this.viewport.planeHelperMesh.rotation).normalize();

        const modified = GeometryClipper.sliceModelByPlane(
          this.modelManager.currentModel,
          planePoint,
          planeNormal
        );

        this.modelManager.notifyUpdate();
        this.ui.setLoading(false);

        const newStats = this.modelManager.getStatistics();
        const triDiff = prevStats.triangles - newStats.triangles;
        this.ui.showToast(`Plane slice applied! Removed ${triDiff.toLocaleString()} triangles across ${modified} meshes.`, 'success');
      } catch (err) {
        this.ui.setLoading(false);
        this.ui.showToast(`Slicing error: ${err.message}`, 'error');
        console.error(err);
      }
    }, 50);
  }
}

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
