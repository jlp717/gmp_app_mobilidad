/**
 * Load Planner 3D — Three.js Scene
 *
 * Professional 3D truck loading visualization with:
 * - PBR materials, shadows, ambient occlusion
 * - OrbitControls (rotate/zoom/pan)
 * - Raycaster hit-testing + drag-and-drop on floor plane
 * - 3 camera presets (perspective, top, front)
 * - 3 color modes (product, client, weight)
 * - CSS2D labels with LOD
 * - Flutter bridge (bidirectional JSON messaging)
 */

import * as THREE from './lib/three.module.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './lib/CSS2DRenderer.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const COLORS = {
  background: 0x0F172A,
  floor: 0x1A2332,
  gridMinor: 0x00D4FF,
  gridMajor: 0x00D4FF,
  wallColor: 0x00D4FF,
  edgeColor: 0x00D4FF,
  selectedEmissive: 0x00D4FF,
  collisionEmissive: 0xFF3B5C,
  cabColor: 0x00D4FF,
};

// 16-color high-contrast palette (dark background optimized)
const BOX_PALETTE = [
  0xFF6B6B, 0x4ECDC4, 0x45B7D1, 0xFFA07A,
  0x98D8C8, 0xF06292, 0x81C784, 0xFFD54F,
  0x7986CB, 0xE57373, 0x66BB6A, 0x42A5F5,
  0xAB47BC, 0x26A69A, 0xFF7043, 0xFFA726,
];

// Weight thermal gradient stops
const WEIGHT_GRADIENT = [
  { t: 0.0, r: 0.18, g: 0.55, b: 0.95 },  // blue (light)
  { t: 0.33, r: 0.13, g: 0.85, b: 0.45 },  // green
  { t: 0.66, r: 0.95, g: 0.85, b: 0.15 },  // yellow
  { t: 1.0, r: 0.95, g: 0.22, b: 0.22 },   // red (heavy)
];

const MAX_WEIGHT_KG = 30;
const CM_TO_M = 0.01; // We work in meters in Three.js, data comes in cm

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

let scene, camera, renderer, css2dRenderer, controls;
let truckGroup, boxesGroup;
let raycaster, pointer;
let boxMeshes = []; // Array of { mesh, edges, label, data }
let boxesData = []; // Raw box data from Flutter
let truckDims = null; // { lengthCm, widthCm, heightCm, maxPayloadKg }
let colorMode = 'product';
let selectedIndex = null;
let isDragging = false;
let dragIndex = -1;
let dragPlane = null;
let dragOffset = new THREE.Vector3();
let pointerDownTime = 0;
let pointerDownPos = { x: 0, y: 0 };
let animationId = null;

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.FogExp2(COLORS.background, 0.15);

  // Camera
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(5, 4, 6);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  document.body.appendChild(renderer.domElement);

  // CSS2D Renderer (labels)
  css2dRenderer = new CSS2DRenderer();
  css2dRenderer.setSize(window.innerWidth, window.innerHeight);
  css2dRenderer.domElement.style.position = 'absolute';
  css2dRenderer.domElement.style.top = '0';
  css2dRenderer.domElement.style.left = '0';
  css2dRenderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(css2dRenderer.domElement);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.maxDistance = 20;
  controls.maxPolarAngle = Math.PI * 0.48; // Don't go below floor
  controls.minPolarAngle = 0.1;
  controls.target.set(0, 0, 0);
  controls.update();

  // Lights
  setupLights();

  // Raycaster
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  // Groups
  truckGroup = new THREE.Group();
  boxesGroup = new THREE.Group();
  scene.add(truckGroup);
  scene.add(boxesGroup);

  // Drag plane (horizontal at y=0 in Three.js space, which is the truck floor)
  dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // Events
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('resize', onResize);

  // Start render loop
  animate();

  // Hide loading
  document.getElementById('loading').classList.add('hidden');

  // Notify Flutter
  window._sceneInitDone = true;
  sendToFlutter('sceneReady', {});
}

function setupLights() {
  // Ambient — soft fill
  const ambient = new THREE.AmbientLight(0x8090B0, 0.5);
  scene.add(ambient);

  // Hemisphere — sky/ground gradient
  const hemi = new THREE.HemisphereLight(0x4488CC, 0x1A2332, 0.4);
  scene.add(hemi);

  // Main directional (sun-like, with shadows)
  const dir = new THREE.DirectionalLight(0xFFFFFF, 0.9);
  dir.position.set(5, 8, 4);
  dir.castShadow = true;
  dir.shadow.mapSize.width = 2048;
  dir.shadow.mapSize.height = 2048;
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 25;
  dir.shadow.camera.left = -8;
  dir.shadow.camera.right = 8;
  dir.shadow.camera.top = 8;
  dir.shadow.camera.bottom = -8;
  dir.shadow.bias = -0.0005;
  scene.add(dir);

  // Accent light (subtle neon cyan kick)
  const accent = new THREE.PointLight(0x00D4FF, 0.3, 15);
  accent.position.set(-3, 5, -2);
  scene.add(accent);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRUCK CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════════════

function buildTruck(dims) {
  truckGroup.clear();
  truckDims = dims;

  const L = dims.lengthCm * CM_TO_M;
  const W = dims.widthCm * CM_TO_M;
  const H = dims.heightCm * CM_TO_M;

  // Center truck so origin is at center-bottom
  const halfL = L / 2;
  const halfW = W / 2;

  // Floor
  const floorGeo = new THREE.PlaneGeometry(L, W);
  const floorMat = new THREE.MeshStandardMaterial({
    color: COLORS.floor,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.001, 0); // Slightly above 0 to avoid z-fighting
  floor.receiveShadow = true;
  floor.name = 'truck-floor';
  truckGroup.add(floor);

  // Grid (50cm minor, 1m major)
  const gridGroup = new THREE.Group();
  const minorStep = 0.5; // meters
  const majorStep = 1.0;

  // Minor grid lines
  const minorMat = new THREE.LineBasicMaterial({ color: COLORS.gridMinor, opacity: 0.06, transparent: true });
  for (let x = -halfL; x <= halfL; x += minorStep) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.002, -halfW),
      new THREE.Vector3(x, 0.002, halfW),
    ]);
    gridGroup.add(new THREE.Line(geo, minorMat));
  }
  for (let z = -halfW; z <= halfW; z += minorStep) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfL, 0.002, z),
      new THREE.Vector3(halfL, 0.002, z),
    ]);
    gridGroup.add(new THREE.Line(geo, minorMat));
  }

  // Major grid lines
  const majorMat = new THREE.LineBasicMaterial({ color: COLORS.gridMajor, opacity: 0.12, transparent: true });
  for (let x = -halfL; x <= halfL; x += majorStep) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.003, -halfW),
      new THREE.Vector3(x, 0.003, halfW),
    ]);
    gridGroup.add(new THREE.Line(geo, majorMat));
  }
  for (let z = -halfW; z <= halfW; z += majorStep) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfL, 0.003, z),
      new THREE.Vector3(halfL, 0.003, z),
    ]);
    gridGroup.add(new THREE.Line(geo, majorMat));
  }
  truckGroup.add(gridGroup);

  // Walls (semi-transparent)
  const wallMat = new THREE.MeshStandardMaterial({
    color: COLORS.wallColor,
    transparent: true,
    opacity: 0.04,
    side: THREE.DoubleSide,
    roughness: 0.5,
    metalness: 0.1,
  });

  // Back wall (at -halfL, i.e. the cab end)
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
  backWall.position.set(-halfL, H / 2, 0);
  backWall.rotation.y = Math.PI / 2;
  truckGroup.add(backWall);

  // Left wall
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
  leftWall.position.set(0, H / 2, -halfW);
  truckGroup.add(leftWall);

  // Right wall
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
  rightWall.position.set(0, H / 2, halfW);
  truckGroup.add(rightWall);

  // Edges (wireframe box outline)
  const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.edgeColor, opacity: 0.35, transparent: true });
  const edgeGeo = new THREE.BoxGeometry(L, H, W);
  const edgeLines = new THREE.LineSegments(
    new THREE.EdgesGeometry(edgeGeo),
    edgeMat
  );
  edgeLines.position.set(0, H / 2, 0);
  truckGroup.add(edgeLines);

  // Cab indicator (subtle marker at -halfL end)
  const cabGeo = new THREE.BoxGeometry(0.05, H * 0.3, W * 0.8);
  const cabMat = new THREE.MeshStandardMaterial({
    color: COLORS.cabColor,
    transparent: true,
    opacity: 0.08,
    roughness: 0.5,
  });
  const cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.set(-halfL - 0.03, H * 0.15, 0);
  truckGroup.add(cab);

  // Dimension labels
  addDimLabel(`${(L).toFixed(1)}m`, new THREE.Vector3(0, -0.15, halfW + 0.15));
  addDimLabel(`${(W).toFixed(1)}m`, new THREE.Vector3(halfL + 0.15, -0.15, 0));
  addDimLabel(`${(H).toFixed(1)}m`, new THREE.Vector3(halfL + 0.15, H / 2, halfW + 0.15));

  // Adjust camera and controls to fit truck
  const maxDim = Math.max(L, W, H);
  camera.position.set(L * 0.8, maxDim * 1.0, W * 1.2);
  controls.target.set(0, H * 0.3, 0);
  controls.update();

  // Adjust shadow camera to truck size
  const shadowCam = scene.children.find(c => c.isDirectionalLight)?.shadow?.camera;
  if (shadowCam) {
    const ext = maxDim * 1.2;
    shadowCam.left = -ext;
    shadowCam.right = ext;
    shadowCam.top = ext;
    shadowCam.bottom = -ext;
    shadowCam.updateProjectionMatrix();
  }
}

function addDimLabel(text, position) {
  const div = document.createElement('div');
  div.className = 'dim-label';
  div.textContent = text;
  const label = new CSS2DObject(div);
  label.position.copy(position);
  truckGroup.add(label);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOX RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

function buildBoxes(boxes) {
  // Clear old
  boxesGroup.clear();
  boxMeshes = [];
  boxesData = boxes;

  if (!truckDims) return;

  const halfL = truckDims.lengthCm * CM_TO_M / 2;
  const halfW = truckDims.widthCm * CM_TO_M / 2;

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const w = b.w * CM_TO_M;
    const d = b.d * CM_TO_M;
    const h = b.h * CM_TO_M;

    // Geometry
    const geo = new THREE.BoxGeometry(w, h, d);
    const color = getBoxColor(b, i);
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.4,
      metalness: 0.1,
      transparent: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Position: convert from data coords (origin = corner) to Three.js (origin = center of truck floor)
    const px = b.x * CM_TO_M - halfL + w / 2;
    const py = b.z * CM_TO_M + h / 2; // z in data = y in Three.js (height)
    const pz = b.y * CM_TO_M - halfW + d / 2; // y in data = z in Three.js (depth)
    mesh.position.set(px, py, pz);

    mesh.userData = { boxIndex: i };
    boxesGroup.add(mesh);

    // Edges (subtle border)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xFFFFFF, opacity: 0.25, transparent: true });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    edges.position.copy(mesh.position);
    boxesGroup.add(edges);

    // CSS2D Label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'box-label';
    labelDiv.textContent = truncate(b.label, 14);
    const label = new CSS2DObject(labelDiv);
    label.position.set(0, h / 2 + 0.03, 0);
    mesh.add(label);

    boxMeshes.push({ mesh, edges, label, labelDiv, data: b });
  }

  updateLabelVisibility();
}

function getBoxColor(box, index) {
  switch (colorMode) {
    case 'client':
      return BOX_PALETTE[hashCode(box.clientCode) % BOX_PALETTE.length];
    case 'weight':
      return weightToColor(box.weight);
    case 'product':
    default:
      return BOX_PALETTE[hashCode(box.articleCode) % BOX_PALETTE.length];
  }
}

function weightToColor(weight) {
  const t = Math.min(weight / MAX_WEIGHT_KG, 1.0);
  let r, g, b;

  for (let i = 0; i < WEIGHT_GRADIENT.length - 1; i++) {
    const a = WEIGHT_GRADIENT[i];
    const c = WEIGHT_GRADIENT[i + 1];
    if (t >= a.t && t <= c.t) {
      const f = (t - a.t) / (c.t - a.t);
      r = a.r + (c.r - a.r) * f;
      g = a.g + (c.g - a.g) * f;
      b = a.b + (c.b - a.b) * f;
      return new THREE.Color(r, g, b);
    }
  }
  const last = WEIGHT_GRADIENT[WEIGHT_GRADIENT.length - 1];
  return new THREE.Color(last.r, last.g, last.b);
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function truncate(str, maxLen) {
  return str.length > maxLen ? str.substring(0, maxLen - 1) + '...' : str;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECTION & VISUAL STATES
// ═══════════════════════════════════════════════════════════════════════════════

function setSelected(index) {
  selectedIndex = index;

  for (let i = 0; i < boxMeshes.length; i++) {
    const { mesh, edges } = boxMeshes[i];
    const isSelected = (i === index);

    if (isSelected) {
      mesh.material.emissive = new THREE.Color(COLORS.selectedEmissive);
      mesh.material.emissiveIntensity = 0.4;
      edges.material.color = new THREE.Color(COLORS.selectedEmissive);
      edges.material.opacity = 0.8;
      edges.material.linewidth = 2;
    } else {
      mesh.material.emissive = new THREE.Color(0x000000);
      mesh.material.emissiveIntensity = 0;
      edges.material.color = new THREE.Color(0xFFFFFF);
      edges.material.opacity = 0.25;
    }
  }
}

function setCollisionState(index, hasCollision) {
  if (index < 0 || index >= boxMeshes.length) return;
  const { mesh, edges } = boxMeshes[index];

  if (hasCollision) {
    mesh.material.emissive = new THREE.Color(COLORS.collisionEmissive);
    mesh.material.emissiveIntensity = 0.6;
    edges.material.color = new THREE.Color(COLORS.collisionEmissive);
    edges.material.opacity = 0.9;
  } else if (index === selectedIndex) {
    mesh.material.emissive = new THREE.Color(COLORS.selectedEmissive);
    mesh.material.emissiveIntensity = 0.4;
    edges.material.color = new THREE.Color(COLORS.selectedEmissive);
    edges.material.opacity = 0.8;
  } else {
    mesh.material.emissive = new THREE.Color(0x000000);
    mesh.material.emissiveIntensity = 0;
    edges.material.color = new THREE.Color(0xFFFFFF);
    edges.material.opacity = 0.25;
  }
}

function updateColorMode(mode) {
  colorMode = mode;
  for (let i = 0; i < boxMeshes.length; i++) {
    const color = getBoxColor(boxMeshes[i].data, i);
    boxMeshes[i].mesh.material.color = new THREE.Color(color);
  }
  // Re-apply selection
  if (selectedIndex !== null) setSelected(selectedIndex);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LABEL LOD
// ═══════════════════════════════════════════════════════════════════════════════

function updateLabelVisibility() {
  if (!camera) return;

  for (const { mesh, labelDiv } of boxMeshes) {
    const dist = camera.position.distanceTo(mesh.position);
    // Hide labels when too far (box would be tiny on screen)
    const size = Math.max(mesh.geometry.parameters.width, mesh.geometry.parameters.depth);
    const screenSize = (size / dist) * window.innerHeight * 0.5;
    labelDiv.className = screenSize < 20 ? 'box-label hidden' : 'box-label';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA PRESETS
// ═══════════════════════════════════════════════════════════════════════════════

function setViewMode(mode) {
  if (!truckDims) return;

  const L = truckDims.lengthCm * CM_TO_M;
  const W = truckDims.widthCm * CM_TO_M;
  const H = truckDims.heightCm * CM_TO_M;
  const maxDim = Math.max(L, W, H);

  // Animate camera transition
  const duration = 600; // ms
  const start = { pos: camera.position.clone(), target: controls.target.clone() };
  let end;

  switch (mode) {
    case 'top':
      end = {
        pos: new THREE.Vector3(0, maxDim * 2.0, 0.001),
        target: new THREE.Vector3(0, 0, 0),
      };
      break;
    case 'front':
      end = {
        pos: new THREE.Vector3(0, H * 0.5, maxDim * 2.0),
        target: new THREE.Vector3(0, H * 0.35, 0),
      };
      break;
    case 'perspective':
    default:
      end = {
        pos: new THREE.Vector3(L * 0.8, maxDim * 1.0, W * 1.2),
        target: new THREE.Vector3(0, H * 0.3, 0),
      };
      break;
  }

  const startTime = performance.now();
  function animateCamera(now) {
    const t = Math.min((now - startTime) / duration, 1.0);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

    camera.position.lerpVectors(start.pos, end.pos, ease);
    controls.target.lerpVectors(start.target, end.target, ease);
    controls.update();

    if (t < 1.0) {
      requestAnimationFrame(animateCamera);
    }
  }
  requestAnimationFrame(animateCamera);
}

// ═══════════════════════════════════════════════════════════════════════════════
// POINTER EVENTS (tap, long-press drag, orbit)
// ═══════════════════════════════════════════════════════════════════════════════

function getPointerNDC(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

function onPointerDown(event) {
  if (event.pointerType === 'touch' && event.isPrimary === false) return; // Only handle first touch

  pointerDownTime = performance.now();
  pointerDownPos = { x: event.clientX, y: event.clientY };
  pointer.copy(getPointerNDC(event));

  // Raycast to detect box under pointer
  raycaster.setFromCamera(pointer, camera);
  const meshes = boxMeshes.map(b => b.mesh);
  const intersects = raycaster.intersectObjects(meshes);

  if (intersects.length > 0) {
    const hit = intersects[0].object;
    dragIndex = hit.userData.boxIndex;
  }
}

function onPointerMove(event) {
  if (dragIndex < 0) return;

  const dx = event.clientX - pointerDownPos.x;
  const dy = event.clientY - pointerDownPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const elapsed = performance.now() - pointerDownTime;

  // Start drag after 200ms hold + 5px move (long-press drag)
  if (!isDragging && elapsed > 200 && dist > 5) {
    isDragging = true;
    controls.enabled = false; // Disable orbit during drag

    // Calculate offset between box position and initial hit point
    pointer.copy(getPointerNDC(event));
    raycaster.setFromCamera(pointer, camera);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, intersection);

    const mesh = boxMeshes[dragIndex].mesh;
    dragOffset.subVectors(mesh.position, intersection);
    dragOffset.y = 0; // Keep on floor plane

    // Set box semi-transparent during drag
    mesh.material.transparent = true;
    mesh.material.opacity = 0.7;

    sendToFlutter('boxDragStart', { index: dragIndex });
  }

  if (isDragging && dragIndex >= 0) {
    pointer.copy(getPointerNDC(event));
    raycaster.setFromCamera(pointer, camera);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, intersection);

    if (intersection) {
      const newPos = intersection.add(dragOffset);
      const mesh = boxMeshes[dragIndex].mesh;

      // Clamp to truck bounds
      if (truckDims) {
        const halfL = truckDims.lengthCm * CM_TO_M / 2;
        const halfW = truckDims.widthCm * CM_TO_M / 2;
        const bw = mesh.geometry.parameters.width / 2;
        const bd = mesh.geometry.parameters.depth / 2;

        newPos.x = Math.max(-halfL + bw, Math.min(halfL - bw, newPos.x));
        newPos.z = Math.max(-halfW + bd, Math.min(halfW - bd, newPos.z));
      }

      mesh.position.x = newPos.x;
      mesh.position.z = newPos.z;
      // Keep same Y (height)

      // Update edge position too
      boxMeshes[dragIndex].edges.position.x = newPos.x;
      boxMeshes[dragIndex].edges.position.z = newPos.z;

      // Convert back to data coordinates and send to Flutter
      const halfL = truckDims.lengthCm * CM_TO_M / 2;
      const halfW = truckDims.widthCm * CM_TO_M / 2;
      const bw = mesh.geometry.parameters.width / 2;
      const bd = mesh.geometry.parameters.depth / 2;
      const dataX = (newPos.x + halfL - bw) / CM_TO_M;
      const dataY = (newPos.z + halfW - bd) / CM_TO_M;

      sendToFlutter('boxDragMove', {
        index: dragIndex,
        x: Math.round(dataX * 10) / 10,
        y: Math.round(dataY * 10) / 10,
      });
    }
  }
}

function onPointerUp(event) {
  if (isDragging && dragIndex >= 0) {
    const mesh = boxMeshes[dragIndex].mesh;
    mesh.material.transparent = false;
    mesh.material.opacity = 1.0;

    // Convert final position to data coordinates
    const halfL = truckDims.lengthCm * CM_TO_M / 2;
    const halfW = truckDims.widthCm * CM_TO_M / 2;
    const bw = mesh.geometry.parameters.width / 2;
    const bd = mesh.geometry.parameters.depth / 2;
    const dataX = (mesh.position.x + halfL - bw) / CM_TO_M;
    const dataY = (mesh.position.z + halfW - bd) / CM_TO_M;

    sendToFlutter('boxDragEnd', {
      index: dragIndex,
      x: Math.round(dataX * 10) / 10,
      y: Math.round(dataY * 10) / 10,
    });

    isDragging = false;
    controls.enabled = true;
  } else if (dragIndex >= 0) {
    // It was a tap (not a drag)
    const elapsed = performance.now() - pointerDownTime;
    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (elapsed < 300 && dist < 10) {
      sendToFlutter('boxSelected', { index: dragIndex });
    }
  } else {
    // Tapped on background
    const elapsed = performance.now() - pointerDownTime;
    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (elapsed < 300 && dist < 10) {
      sendToFlutter('canvasTapped', {});
    }
  }

  dragIndex = -1;
  isDragging = false;
}

function onPointerCancel() {
  if (isDragging && dragIndex >= 0) {
    const mesh = boxMeshes[dragIndex].mesh;
    mesh.material.transparent = false;
    mesh.material.opacity = 1.0;
  }
  dragIndex = -1;
  isDragging = false;
  controls.enabled = true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════════════════════════════════════════

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  css2dRenderer.setSize(window.innerWidth, window.innerHeight);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION LOOP
// ═══════════════════════════════════════════════════════════════════════════════

function animate() {
  animationId = requestAnimationFrame(animate);
  controls.update();
  updateLabelVisibility();
  renderer.render(scene, camera);
  css2dRenderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLUTTER BRIDGE
// ═══════════════════════════════════════════════════════════════════════════════

function sendToFlutter(type, payload) {
  try {
    if (window.FlutterBridge) {
      window.FlutterBridge.postMessage(JSON.stringify({ type, ...payload }));
    }
  } catch (e) {
    console.warn('FlutterBridge send failed:', e);
  }
}

// Expose bridge methods for Flutter to call
window.ThreeBridge = {
  loadScene(truckJson, boxesJson) {
    try {
      const truck = typeof truckJson === 'string' ? JSON.parse(truckJson) : truckJson;
      const boxes = typeof boxesJson === 'string' ? JSON.parse(boxesJson) : boxesJson;
      buildTruck(truck);
      buildBoxes(boxes);
    } catch (e) {
      console.error('loadScene error:', e);
    }
  },

  updateBoxes(boxesJson) {
    try {
      const boxes = typeof boxesJson === 'string' ? JSON.parse(boxesJson) : boxesJson;
      buildBoxes(boxes);
      if (selectedIndex !== null) setSelected(selectedIndex);
    } catch (e) {
      console.error('updateBoxes error:', e);
    }
  },

  updateBoxPosition(index, x, y, z) {
    if (index < 0 || index >= boxMeshes.length || !truckDims) return;
    const { mesh, edges } = boxMeshes[index];
    const halfL = truckDims.lengthCm * CM_TO_M / 2;
    const halfW = truckDims.widthCm * CM_TO_M / 2;
    const bw = mesh.geometry.parameters.width / 2;
    const bd = mesh.geometry.parameters.depth / 2;
    const bh = mesh.geometry.parameters.height / 2;

    const px = x * CM_TO_M - halfL + bw;
    const py = z * CM_TO_M + bh;
    const pz = y * CM_TO_M - halfW + bd;

    mesh.position.set(px, py, pz);
    edges.position.set(px, py, pz);
  },

  selectBox(index) {
    setSelected(index === null || index === undefined || index < 0 ? null : index);
  },

  setViewMode(mode) {
    setViewMode(mode);
  },

  setColorMode(mode) {
    updateColorMode(mode);
  },

  setCollisionState(index, hasCollision) {
    setCollisionState(index, hasCollision);
  },

  highlightOverflow(orderNumbers) {
    // Dim overflow boxes
    const overflowSet = new Set(orderNumbers);
    for (let i = 0; i < boxMeshes.length; i++) {
      const { mesh } = boxMeshes[i];
      const isOverflow = overflowSet.has(boxMeshes[i].data.orderNumber);
      if (isOverflow) {
        mesh.material.opacity = 0.3;
        mesh.material.transparent = true;
      } else {
        mesh.material.opacity = 1.0;
        mesh.material.transparent = false;
      }
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════

init();
