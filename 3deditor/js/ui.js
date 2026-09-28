export class UI {
  constructor() {
    this.toastContainer = document.getElementById('toast-container');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.loadingText = document.getElementById('loading-text');
    this.loadingSubtext = document.getElementById('loading-subtext');

    // Hierarchy & Selection
    this.treeContainer = document.getElementById('tree-container');
    this.selectedMeshPanel = document.getElementById('selected-mesh-panel');
    this.selectedPartName = document.getElementById('selected-part-name');
    this.partTriCount = document.getElementById('part-tri-count');
    this.partMatName = document.getElementById('part-mat-name');

    // Stats
    this.statTriangles = document.getElementById('stat-triangles');
    this.statVertices = document.getElementById('stat-vertices');
    this.statMeshes = document.getElementById('stat-meshes');
    this.statMaterials = document.getElementById('stat-materials');
    this.statSizeX = document.getElementById('stat-size-x');
    this.statSizeY = document.getElementById('stat-size-y');
    this.statSizeZ = document.getElementById('stat-size-z');
    this.statMaterialsList = document.getElementById('stat-materials-list');

    // Buttons & Badges
    this.modelFilenameBadge = document.getElementById('model-filename');
    this.nodeCountBadge = document.getElementById('node-count');
    this.btnExportGLB = document.getElementById('btn-export-glb');
    this.btnExportGLBSidebar = document.getElementById('btn-export-glb-sidebar');
    this.btnUndo = document.getElementById('btn-undo');
    this.btnResetModel = document.getElementById('btn-reset-model');
    this.btnApplyBoxClip = document.getElementById('btn-apply-box-clip');
    this.btnApplyPlaneSlice = document.getElementById('btn-apply-plane-slice');

    // Box Controls
    this.boxRangeMinX = document.getElementById('box-range-min-x');
    this.boxRangeMaxX = document.getElementById('box-range-max-x');
    this.boxRangeMinY = document.getElementById('box-range-min-y');
    this.boxRangeMaxY = document.getElementById('box-range-max-y');
    this.boxRangeMinZ = document.getElementById('box-range-min-z');
    this.boxRangeMaxZ = document.getElementById('box-range-max-z');
    this.boxValX = document.getElementById('box-val-x');
    this.boxValY = document.getElementById('box-val-y');
    this.boxValZ = document.getElementById('box-val-z');

    // Plane Controls
    this.planePosSlider = document.getElementById('plane-pos-slider');
    this.planePosVal = document.getElementById('plane-pos-val');
    this.planeDirectionLabel = document.getElementById('plane-direction-label');
  }

  showToast(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    const bgColors = {
      success: 'bg-emerald-900/90 border-emerald-500/50 text-emerald-100',
      error: 'bg-rose-900/90 border-rose-500/50 text-rose-100',
      warning: 'bg-amber-900/90 border-amber-500/50 text-amber-100',
      info: 'bg-blue-900/90 border-blue-500/50 text-blue-100'
    };
    const icons = {
      success: 'fa-circle-check text-emerald-400',
      error: 'fa-circle-xmark text-rose-400',
      warning: 'fa-triangle-exclamation text-amber-400',
      info: 'fa-circle-info text-blue-400'
    };

    toast.className = `flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border backdrop-blur-md shadow-2xl text-xs font-medium transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto ${bgColors[type] || bgColors.info}`;
    toast.innerHTML = `
      <i class="fa-solid ${icons[type] || icons.info} text-sm"></i>
      <span>${message}</span>
    `;

    this.toastContainer.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    // Auto dismiss
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  setLoading(show, title = 'Processing...', subtitle = 'Please wait') {
    if (show) {
      this.loadingText.textContent = title;
      this.loadingSubtext.textContent = subtitle;
      this.loadingOverlay.classList.remove('hidden');
    } else {
      this.loadingOverlay.classList.add('hidden');
    }
  }

  updateStats(stats, filename) {
    if (filename) {
      this.modelFilenameBadge.textContent = filename;
    }

    this.statTriangles.textContent = stats.triangles.toLocaleString();
    this.statVertices.textContent = stats.vertices.toLocaleString();
    this.statMeshes.textContent = stats.meshes.toLocaleString();
    this.statMaterials.textContent = stats.materialsCount.toLocaleString();

    this.statSizeX.textContent = stats.dimensions.x;
    this.statSizeY.textContent = stats.dimensions.y;
    this.statSizeZ.textContent = stats.dimensions.z;

    this.nodeCountBadge.textContent = `${stats.meshes} meshes`;

    // Enable buttons
    const hasModel = stats.meshes > 0;
    this.btnExportGLB.disabled = !hasModel;
    this.btnExportGLBSidebar.disabled = !hasModel;
    this.btnUndo.disabled = !hasModel;
    this.btnResetModel.disabled = !hasModel;
    this.btnApplyBoxClip.disabled = !hasModel;
    this.btnApplyPlaneSlice.disabled = !hasModel;

    // Materials list
    if (stats.materials && stats.materials.length > 0) {
      this.statMaterialsList.innerHTML = stats.materials
        .map(
          m => `
          <div class="flex items-center justify-between py-1 border-b border-slate-800/60">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full border border-slate-600 inline-block shadow-sm" style="background-color: ${m.color}"></span>
              <span class="font-mono truncate max-w-[130px]" title="${m.name}">${m.name}</span>
            </div>
            <span class="text-[10px] text-slate-400 font-mono">${m.hasMap ? 'Texture Map' : 'Solid'}</span>
          </div>
        `
        )
        .join('');
    } else {
      this.statMaterialsList.innerHTML = '<p class="text-slate-500 italic">No materials found</p>';
    }
  }

  renderHierarchyTree(treeNodes, onSelectCallback, onToggleVisCallback) {
    if (!treeNodes || treeNodes.length === 0) {
      this.treeContainer.innerHTML = `
        <div class="text-center py-12 text-slate-500 text-xs">
          <i class="fa-solid fa-cubes block text-2xl mb-2 opacity-50"></i>
          Import a GLB file to inspect and isolate parts
        </div>
      `;
      return;
    }

    this.treeContainer.innerHTML = '';

    const renderNode = (node, depth = 0) => {
      const el = document.createElement('div');
      el.className = 'tree-node rounded px-2 py-1 flex items-center justify-between cursor-pointer';
      el.style.paddingLeft = `${depth * 14 + 8}px`;
      el.dataset.uuid = node.uuid;

      const isMesh = node.type === 'mesh';
      const icon = isMesh ? 'fa-solid fa-cube text-blue-400' : 'fa-solid fa-folder text-amber-400';

      el.innerHTML = `
        <div class="flex items-center gap-1.5 truncate flex-1">
          <i class="${icon} text-[11px]"></i>
          <span class="truncate ${!node.visible ? 'text-slate-500 line-through' : ''}">${node.name}</span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          ${isMesh ? `<span class="text-[9px] text-slate-400 font-mono mr-1">${node.triangles}Δ</span>` : ''}
          <button class="btn-vis text-slate-400 hover:text-white p-0.5" title="Toggle visibility">
            <i class="fa-solid ${node.visible ? 'fa-eye' : 'fa-eye-slash text-slate-600'} text-[10px]"></i>
          </button>
        </div>
      `;

      // Select click
      el.addEventListener('click', (e) => {
        if (e.target.closest('.btn-vis')) return;
        document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
        el.classList.add('selected');
        if (onSelectCallback) onSelectCallback(node.uuid);
      });

      // Visibility toggle click
      const visBtn = el.querySelector('.btn-vis');
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onToggleVisCallback) onToggleVisCallback(node.uuid);
      });

      this.treeContainer.appendChild(el);

      if (node.children && node.children.length > 0) {
        node.children.forEach(child => renderNode(child, depth + 1));
      }
    };

    treeNodes.forEach(node => renderNode(node, 0));
  }

  showSelectedMesh(mesh) {
    if (!mesh) {
      this.selectedMeshPanel.classList.add('hidden');
      return;
    }

    this.selectedMeshPanel.classList.remove('hidden');
    this.selectedPartName.textContent = mesh.name || 'Unnamed Mesh';

    if (mesh.geometry && mesh.geometry.attributes.position) {
      this.partTriCount.textContent = Math.round(mesh.geometry.attributes.position.count / 3).toLocaleString();
    } else {
      this.partTriCount.textContent = '0';
    }

    if (mesh.material) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      this.partMatName.textContent = mat.name || 'Default Material';
    } else {
      this.partMatName.textContent = 'None';
    }

    // Highlight in tree view
    document.querySelectorAll('.tree-node').forEach((el) => {
      if (el.dataset.uuid === mesh.uuid) {
        el.classList.add('selected');
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        el.classList.remove('selected');
      }
    });
  }
}
