# 3D GLB Studio & Geometry Clipper

A modern, fast, web-based 3D editor designed to import `.glb` files, interactively clip/slice/cut sections out of the 3D geometry with texture preservation, and export the resulting model back out as a clean, standalone `.glb` file.

---

## 💡 Quick Answer: Do I need separate PNG texture files?
**No!** The `.glb` (*GL Transmission Format Binary*) format is a self-contained single-file container. All 3D geometry meshes, material definitions, and embedded textures (PNG/JPEG images) are already bundled directly inside the `.glb` file. When you load a `.glb`, all materials and textures load automatically.

---

## 🚀 How to Launch the Editor

### Option 1: One-Click Launcher (Windows)
Double-click `start.bat` in this folder.

### Option 2: Python Command Line
Run the following command in PowerShell / Terminal:
```bash
python serve.py
```
This starts the local web server and automatically opens `http://localhost:8080` in your default web browser.

---

## ✨ Features & Tools

### 1. Import & Demo Models
- **Drag & Drop**: Simply drag any `.glb` or `.gltf` file directly into the 3D viewport.
- **Open GLB Button**: Select a 3D model from your computer.
- **Sample Model Button**: Instantly load a built-in sci-fi drone demo to test clipping tools without needing an external file.

### 2. Geometry Clipping & Cutting Tools
- **3D Box Clipper (Keep Inside / Crop)**:
  - Position and scale an interactive 3D bounding box over your model.
  - Crops the model so only the geometry inside the box is kept.
- **3D Box Carve (Cut Away / Delete Inside)**:
  - Subtracts/carves the box region out of your 3D model.
- **Plane Slicer (Cross-Section Cut)**:
  - Position a cutting plane along the X, Y, or Z axis (or arbitrary angle) to slice through the model.
  - Flip toggle allows keeping either the upper or lower side.
- **True Geometry Modification**:
  - Unlike visual-only clipping planes which do not modify the exportable model, this editor performs **physical polygon-level triangle slicing**.
  - All UV texture coordinates, vertex normals, materials, and groups are recalculated and preserved.
- **Part / Sub-Mesh Selection & Deletion**:
  - Click on any mesh component in the 3D viewport or the Scene Outliner tree.
  - Delete individual parts, isolate parts, or toggle visibility.

### 3. Viewport & Navigation
- **Orbit Controls**: Left-click drag to rotate, Right-click drag to pan, Scroll wheel to zoom.
- **Camera Views**: Quick buttons for Front, Top, Right, and Isometric views, plus Focus (`F`).
- **Render Modes**: PBR Shaded view, Wireframe overlay, and X-Ray / Transparent preview.
- **Ground Grid**: Toggleable ground reference grid.
- **Undo (`Ctrl+Z`) & Reset**: Step backwards through cuts or reset back to the original model.

### 4. GLB Export
- Click **Export as GLB** to package the modified geometries, materials, and embedded textures into a binary `.glb` file and download it directly to your computer.

---

## 📁 Project Structure
```
3DEditor/
├── index.html           # Main application interface (Tailwind + Three.js)
├── css/
│   └── style.css        # Glassmorphic dark theme styles & animations
├── js/
│   ├── app.js           # Main coordinator & event binder
│   ├── viewport.js      # Three.js 3D viewport, camera presets, gizmos
│   ├── modelManager.js  # GLB loader, exporter, procedural demo, undo history
│   ├── clipper.js       # Real polygon slicing & CSG clipping engine
│   └── ui.js            # Hierarchy tree view, metrics, and toast notifications
├── serve.py             # Zero-dependency Python local server
├── start.bat            # Windows one-click batch launcher
└── README.md            # Documentation
```
