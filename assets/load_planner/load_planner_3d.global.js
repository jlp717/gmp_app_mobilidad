(function() {
'use strict';
const THREE = window.THREE;
const OrbitControls = window.OrbitControls;
const CSS2DRenderer = window.CSS2DRenderer;
const CSS2DObject = window.CSS2DObject;


// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const COLORS = {
  background: 0x0F172A,
  floor: 0x1E293B,
  floorAccent: 0x334155,
  gridMinor: 0x00D4FF,
  gridMajor: 0x00D4FF,
  wallColor: 0x38BDF8,
  wallEdge: 0x00D4FF,
  cabBody: 0x1E3A5F,
  cabWindow: 0x38BDF8,
  roofRail: 0x64748B,
  selectedEmissive: 0x00D4FF,
  collisionEmissive: 0xFF3B5C,
  rearMarker: 0x22C55E,
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

// Delivery sequence gradient (green = load first → red = load last)
const DELIVERY_GRADIENT = [
  { t: 0.0, r: 0.13, g: 0.77, b: 0.37 },   // green (load first / deliver last)
  { t: 0.5, r: 0.95, g: 0.85, b: 0.15 },    // yellow (middle)
  { t: 1.0, r: 0.95, g: 0.22, b: 0.22 },    // red (load last / deliver first)
];

const MAX_WEIGHT_KG = 30;
const CM_TO_M = 0.01;
const MAX_VISIBLE_LABELS = 25;
const MIN_BOX_SIZE_CM = 5; // Minimum visual size for tiny boxes

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

var scene, camera, renderer, css2dRenderer, controls;
var truckGroup, boxesGroup, wallsGroup;
var raycaster, pointer;
var boxMeshes = []; // Array of { mesh, edges, label, labelDiv, data, volume }
var boxesData = [];
var truckDims = null;
var colorMode = 'product';
var selectedIndex = null;
var isDragging = false;
var dragIndex = -1;
var dragPlane = null;
var dragOffset = new THREE.Vector3();
var pointerDownTime = 0;
var pointerDownPos = { x: 0, y: 0 };
var animationId = null;
var wallsVisible = true;

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.FogExp2(COLORS.background, 0.12);

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
  controls.maxPolarAngle = Math.PI * 0.48;
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
  wallsGroup = new THREE.Group();
  scene.add(truckGroup);
  scene.add(boxesGroup);

  // Drag plane
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
  var ambient = new THREE.AmbientLight(0x8090B0, 0.5);
  scene.add(ambient);

  // Hemisphere — sky/ground gradient
  var hemi = new THREE.HemisphereLight(0x4488CC, 0x1A2332, 0.4);
  scene.add(hemi);

  // Main directional (sun-like, with shadows)
  var dir = new THREE.DirectionalLight(0xFFFFFF, 0.9);
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
  var accent = new THREE.PointLight(0x00D4FF, 0.3, 15);
  accent.position.set(-3, 5, -2);
  scene.add(accent);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRUCK CONSTRUCTION — Realistic design
// ═══════════════════════════════════════════════════════════════════════════════

function buildTruck(dims) {
  truckGroup.clear();
  truckDims = dims;

  var L = dims.lengthCm * CM_TO_M;
  var W = dims.widthCm * CM_TO_M;
  var H = dims.heightCm * CM_TO_M;

  var halfL = L / 2;
  var halfW = W / 2;

  // ── FLOOR ──────────────────────────────────────────────────────────────
  // Metallic floor with subtle texture
  var floorGeo = new THREE.PlaneGeometry(L, W);
  var floorMat = new THREE.MeshStandardMaterial({
    color: COLORS.floor,
    roughness: 0.7,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });
  var floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.001, 0);
  floor.receiveShadow = true;
  floor.name = 'truck-floor';
  truckGroup.add(floor);

  // Floor planks (visual texture — horizontal lines across floor)
  var plankMat = new THREE.LineBasicMaterial({ color: COLORS.floorAccent, opacity: 0.3, transparent: true });
  var plankStep = 0.12; // 12cm planks
  for (var pz = -halfW; pz <= halfW; pz += plankStep) {
    var plankGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfL, 0.002, pz),
      new THREE.Vector3(halfL, 0.002, pz),
    ]);
    truckGroup.add(new THREE.Line(plankGeo, plankMat));
  }

  // ── GRID ───────────────────────────────────────────────────────────────
  var gridGroup = new THREE.Group();
  var minorStep = 0.5;
  var majorStep = 1.0;

  var minorMat = new THREE.LineBasicMaterial({ color: COLORS.gridMinor, opacity: 0.04, transparent: true });
  for (var x = -halfL; x <= halfL + 0.001; x += minorStep) {
    var geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.003, -halfW),
      new THREE.Vector3(x, 0.003, halfW),
    ]);
    gridGroup.add(new THREE.Line(geo, minorMat));
  }
  for (var z = -halfW; z <= halfW + 0.001; z += minorStep) {
    var geo2 = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfL, 0.003, z),
      new THREE.Vector3(halfL, 0.003, z),
    ]);
    gridGroup.add(new THREE.Line(geo2, minorMat));
  }

  var majorMat = new THREE.LineBasicMaterial({ color: COLORS.gridMajor, opacity: 0.08, transparent: true });
  for (var mx = -halfL; mx <= halfL + 0.001; mx += majorStep) {
    var geo3 = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(mx, 0.004, -halfW),
      new THREE.Vector3(mx, 0.004, halfW),
    ]);
    gridGroup.add(new THREE.Line(geo3, majorMat));
  }
  for (var mz = -halfW; mz <= halfW + 0.001; mz += majorStep) {
    var geo4 = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfL, 0.004, mz),
      new THREE.Vector3(halfL, 0.004, mz),
    ]);
    gridGroup.add(new THREE.Line(geo4, majorMat));
  }
  truckGroup.add(gridGroup);

  // ── WALLS (toggleable group) ───────────────────────────────────────────
  wallsGroup = new THREE.Group();
  wallsGroup.name = 'walls';

  var wallThickness = 0.025; // 2.5cm thick walls

  // Wall material — translucent metal panels
  var wallMat = new THREE.MeshStandardMaterial({
    color: COLORS.wallColor,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    roughness: 0.4,
    metalness: 0.6,
  });

  // Left wall panel
  var leftWallGeo = new THREE.BoxGeometry(L, H, wallThickness);
  var leftWall = new THREE.Mesh(leftWallGeo, wallMat.clone());
  leftWall.position.set(0, H / 2, -halfW - wallThickness / 2);
  leftWall.receiveShadow = true;
  wallsGroup.add(leftWall);

  // Right wall panel
  var rightWall = new THREE.Mesh(leftWallGeo, wallMat.clone());
  rightWall.position.set(0, H / 2, halfW + wallThickness / 2);
  rightWall.receiveShadow = true;
  wallsGroup.add(rightWall);

  // Front wall (cab-side, solid)
  var frontWallGeo = new THREE.BoxGeometry(wallThickness, H, W + wallThickness * 2);
  var frontWallMat = new THREE.MeshStandardMaterial({
    color: COLORS.cabBody,
    transparent: true,
    opacity: 0.25,
    roughness: 0.3,
    metalness: 0.7,
  });
  var frontWall = new THREE.Mesh(frontWallGeo, frontWallMat);
  frontWall.position.set(-halfL - wallThickness / 2, H / 2, 0);
  frontWall.receiveShadow = true;
  wallsGroup.add(frontWall);

  // Roof panel (very translucent)
  var roofGeo = new THREE.BoxGeometry(L, wallThickness, W + wallThickness * 2);
  var roofMat = new THREE.MeshStandardMaterial({
    color: COLORS.wallColor,
    transparent: true,
    opacity: 0.04,
    side: THREE.DoubleSide,
    roughness: 0.3,
    metalness: 0.5,
  });
  var roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(0, H + wallThickness / 2, 0);
  wallsGroup.add(roof);

  // ── EDGE FRAME (structural outline) ────────────────────────────────────
  var edgeMat = new THREE.LineBasicMaterial({ color: COLORS.wallEdge, opacity: 0.4, transparent: true });

  // Bottom rectangle
  addEdgeLine(wallsGroup, edgeMat, [-halfL, 0, -halfW], [halfL, 0, -halfW]);
  addEdgeLine(wallsGroup, edgeMat, [-halfL, 0, halfW], [halfL, 0, halfW]);
  addEdgeLine(wallsGroup, edgeMat, [-halfL, 0, -halfW], [-halfL, 0, halfW]);
  addEdgeLine(wallsGroup, edgeMat, [halfL, 0, -halfW], [halfL, 0, halfW]);

  // Top rectangle
  addEdgeLine(wallsGroup, edgeMat, [-halfL, H, -halfW], [halfL, H, -halfW]);
  addEdgeLine(wallsGroup, edgeMat, [-halfL, H, halfW], [halfL, H, halfW]);
  addEdgeLine(wallsGroup, edgeMat, [-halfL, H, -halfW], [-halfL, H, halfW]);
  addEdgeLine(wallsGroup, edgeMat, [halfL, H, -halfW], [halfL, H, halfW]);

  // Vertical pillars
  addEdgeLine(wallsGroup, edgeMat, [-halfL, 0, -halfW], [-halfL, H, -halfW]);
  addEdgeLine(wallsGroup, edgeMat, [-halfL, 0, halfW], [-halfL, H, halfW]);
  addEdgeLine(wallsGroup, edgeMat, [halfL, 0, -halfW], [halfL, H, -halfW]);
  addEdgeLine(wallsGroup, edgeMat, [halfL, 0, halfW], [halfL, H, halfW]);

  // ── ROOF RAILS (cylinders along top edges) ─────────────────────────────
  var railRadius = 0.012;
  var railMat = new THREE.MeshStandardMaterial({
    color: COLORS.roofRail,
    roughness: 0.3,
    metalness: 0.8,
  });

  // Longitudinal rails (left & right top edges)
  var railGeoL = new THREE.CylinderGeometry(railRadius, railRadius, L, 8);
  railGeoL.rotateZ(Math.PI / 2);
  var railLeft = new THREE.Mesh(railGeoL, railMat);
  railLeft.position.set(0, H + railRadius, -halfW);
  wallsGroup.add(railLeft);
  var railRight = new THREE.Mesh(railGeoL.clone(), railMat);
  railRight.position.set(0, H + railRadius, halfW);
  wallsGroup.add(railRight);

  // Cross rails (front & back top edges)
  var railGeoW = new THREE.CylinderGeometry(railRadius, railRadius, W, 8);
  railGeoW.rotateX(Math.PI / 2);
  var railFront = new THREE.Mesh(railGeoW, railMat);
  railFront.position.set(-halfL, H + railRadius, 0);
  wallsGroup.add(railFront);
  var railBack = new THREE.Mesh(railGeoW.clone(), railMat);
  railBack.position.set(halfL, H + railRadius, 0);
  wallsGroup.add(railBack);

  truckGroup.add(wallsGroup);

  // ── REAR OPENING MARKERS ───────────────────────────────────────────────
  // Dashed lines at rear to show open loading area
  var rearDashMat = new THREE.LineDashedMaterial({
    color: COLORS.rearMarker,
    dashSize: 0.08,
    gapSize: 0.04,
    opacity: 0.5,
    transparent: true,
  });

  // Bottom rear line
  var rearBottomGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(halfL, 0.005, -halfW),
    new THREE.Vector3(halfL, 0.005, halfW),
  ]);
  var rearBottom = new THREE.Line(rearBottomGeo, rearDashMat);
  rearBottom.computeLineDistances();
  truckGroup.add(rearBottom);

  // Side rear markers (small arrows/indicators)
  var rearArrowMat = new THREE.MeshStandardMaterial({
    color: COLORS.rearMarker,
    transparent: true,
    opacity: 0.6,
  });
  var arrowGeo = new THREE.ConeGeometry(0.04, 0.08, 4);
  arrowGeo.rotateZ(Math.PI / 2); // Point toward +X (out the back)
  var arrowL = new THREE.Mesh(arrowGeo, rearArrowMat);
  arrowL.position.set(halfL + 0.06, H * 0.5, -halfW);
  truckGroup.add(arrowL);
  var arrowR = new THREE.Mesh(arrowGeo.clone(), rearArrowMat);
  arrowR.position.set(halfL + 0.06, H * 0.5, halfW);
  truckGroup.add(arrowR);

  // "CARGA" label at rear
  var rearLabelDiv = document.createElement('div');
  rearLabelDiv.className = 'dim-label';
  rearLabelDiv.textContent = '← CARGA';
  rearLabelDiv.style.color = 'rgba(34, 197, 94, 0.7)';
  rearLabelDiv.style.fontSize = '12px';
  var rearLabel = new CSS2DObject(rearLabelDiv);
  rearLabel.position.set(halfL + 0.15, H * 0.5, 0);
  truckGroup.add(rearLabel);

  // ── CAB (simplified front section) ─────────────────────────────────────
  var cabLength = Math.min(L * 0.15, 0.6); // Proportional cab, max 60cm
  var cabHeight = H * 1.15; // Cab slightly taller than cargo area
  var cabWidth = W + wallThickness * 2;

  // Cab body
  var cabBodyGeo = new THREE.BoxGeometry(cabLength, cabHeight, cabWidth);
  var cabBodyMat = new THREE.MeshStandardMaterial({
    color: COLORS.cabBody,
    roughness: 0.3,
    metalness: 0.6,
    transparent: true,
    opacity: 0.35,
  });
  var cabBody = new THREE.Mesh(cabBodyGeo, cabBodyMat);
  cabBody.position.set(-halfL - cabLength / 2 - wallThickness, cabHeight / 2, 0);
  cabBody.castShadow = true;
  truckGroup.add(cabBody);

  // Windshield (front face of cab — lighter, more transparent)
  var windshieldGeo = new THREE.PlaneGeometry(cabWidth * 0.75, cabHeight * 0.4);
  var windshieldMat = new THREE.MeshStandardMaterial({
    color: COLORS.cabWindow,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    roughness: 0.1,
    metalness: 0.2,
  });
  var windshield = new THREE.Mesh(windshieldGeo, windshieldMat);
  windshield.position.set(-halfL - cabLength - wallThickness + 0.005, cabHeight * 0.65, 0);
  windshield.rotation.y = Math.PI / 2;
  truckGroup.add(windshield);

  // Side windows
  var sideWindowGeo = new THREE.PlaneGeometry(cabLength * 0.6, cabHeight * 0.3);
  var sideWindowLeft = new THREE.Mesh(sideWindowGeo, windshieldMat.clone());
  sideWindowLeft.position.set(-halfL - cabLength / 2 - wallThickness, cabHeight * 0.65, -cabWidth / 2 + 0.005);
  truckGroup.add(sideWindowLeft);
  var sideWindowRight = new THREE.Mesh(sideWindowGeo.clone(), windshieldMat.clone());
  sideWindowRight.position.set(-halfL - cabLength / 2 - wallThickness, cabHeight * 0.65, cabWidth / 2 - 0.005);
  truckGroup.add(sideWindowRight);

  // Cab edge outline
  var cabEdgeMat = new THREE.LineBasicMaterial({ color: COLORS.wallEdge, opacity: 0.25, transparent: true });
  var cabEdgeGeo = new THREE.BoxGeometry(cabLength, cabHeight, cabWidth);
  var cabEdges = new THREE.LineSegments(new THREE.EdgesGeometry(cabEdgeGeo), cabEdgeMat);
  cabEdges.position.copy(cabBody.position);
  truckGroup.add(cabEdges);

  // Wheels (simple cylinders under the truck)
  buildWheels(halfL, halfW, cabLength, wallThickness);

  // ── DIMENSION LABELS ───────────────────────────────────────────────────
  addDimLabel((L * 100).toFixed(0) + 'cm', new THREE.Vector3(0, -0.15, halfW + 0.2));
  addDimLabel((W * 100).toFixed(0) + 'cm', new THREE.Vector3(halfL + 0.2, -0.15, 0));
  addDimLabel((H * 100).toFixed(0) + 'cm', new THREE.Vector3(halfL + 0.2, H / 2, halfW + 0.2));

  // ── CAMERA SETUP ───────────────────────────────────────────────────────
  var maxDim = Math.max(L, W, H);
  camera.position.set(L * 0.8, maxDim * 1.0, W * 1.2);
  controls.target.set(0, H * 0.3, 0);
  controls.update();

  // Adjust shadow camera
  var shadowCam = null;
  for (var ci = 0; ci < scene.children.length; ci++) {
    if (scene.children[ci].isDirectionalLight && scene.children[ci].shadow) {
      shadowCam = scene.children[ci].shadow.camera;
      break;
    }
  }
  if (shadowCam) {
    var ext = maxDim * 1.5;
    shadowCam.left = -ext;
    shadowCam.right = ext;
    shadowCam.top = ext;
    shadowCam.bottom = -ext;
    shadowCam.updateProjectionMatrix();
  }
}

function buildWheels(halfL, halfW, cabLength, wallThickness) {
  var wheelRadius = 0.08;
  var wheelWidth = 0.06;
  var wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 12);
  wheelGeo.rotateX(Math.PI / 2);
  var wheelMat = new THREE.MeshStandardMaterial({
    color: 0x1A1A2E,
    roughness: 0.8,
    metalness: 0.2,
  });
  var hubMat = new THREE.MeshStandardMaterial({
    color: 0x64748B,
    roughness: 0.3,
    metalness: 0.8,
  });
  var hubGeo = new THREE.CylinderGeometry(wheelRadius * 0.4, wheelRadius * 0.4, wheelWidth + 0.01, 8);
  hubGeo.rotateX(Math.PI / 2);

  // Rear axle wheels (at ~70% back from cab)
  var rearAxleX = halfL * 0.5;
  var frontAxleX = -halfL - cabLength * 0.5 - wallThickness;
  var wheelZ = halfW + 0.04;
  var wheelY = -wheelRadius * 0.3;

  var positions = [
    [rearAxleX, wheelY, -wheelZ],
    [rearAxleX, wheelY, wheelZ],
    [frontAxleX, wheelY, -wheelZ],
    [frontAxleX, wheelY, wheelZ],
  ];

  for (var wi = 0; wi < positions.length; wi++) {
    var pos = positions[wi];
    var wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(pos[0], pos[1], pos[2]);
    truckGroup.add(wheel);
    var hub = new THREE.Mesh(hubGeo, hubMat);
    hub.position.set(pos[0], pos[1], pos[2]);
    truckGroup.add(hub);
  }
}

function addEdgeLine(group, mat, from, to) {
  var geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(from[0], from[1], from[2]),
    new THREE.Vector3(to[0], to[1], to[2]),
  ]);
  group.add(new THREE.Line(geo, mat));
}

function addDimLabel(text, position) {
  var div = document.createElement('div');
  div.className = 'dim-label';
  div.textContent = text;
  var label = new CSS2DObject(div);
  label.position.copy(position);
  truckGroup.add(label);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOX RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

function buildBoxes(boxes) {
  boxesGroup.clear();
  boxMeshes = [];
  boxesData = boxes;

  if (!truckDims) return;

  var halfL = truckDims.lengthCm * CM_TO_M / 2;
  var halfW = truckDims.widthCm * CM_TO_M / 2;

  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    // Enforce minimum visual size
    var bw = Math.max(b.w, MIN_BOX_SIZE_CM) * CM_TO_M;
    var bd = Math.max(b.d, MIN_BOX_SIZE_CM) * CM_TO_M;
    var bh = Math.max(b.h, MIN_BOX_SIZE_CM) * CM_TO_M;

    var geo = new THREE.BoxGeometry(bw, bh, bd);
    var color = getBoxColor(b, i);
    var mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.35,
      metalness: 0.15,
      transparent: false,
    });

    var mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Position: data coords (origin = corner) → Three.js (center of truck floor)
    var px = b.x * CM_TO_M - halfL + bw / 2;
    var py = b.z * CM_TO_M + bh / 2;
    var pz = b.y * CM_TO_M - halfW + bd / 2;
    mesh.position.set(px, py, pz);
    mesh.userData = { boxIndex: i };
    boxesGroup.add(mesh);

    // Edges
    var edgeMat = new THREE.LineBasicMaterial({ color: 0xFFFFFF, opacity: 0.2, transparent: true });
    var edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    edges.position.copy(mesh.position);
    boxesGroup.add(edges);

    // CSS2D Label
    var labelDiv = document.createElement('div');
    labelDiv.className = 'box-label hidden'; // Start hidden, smart visibility will show the right ones
    labelDiv.textContent = truncate(b.label, 14);
    var label = new CSS2DObject(labelDiv);
    label.position.set(0, bh / 2 + 0.03, 0);
    mesh.add(label);

    var volume = bw * bd * bh;
    boxMeshes.push({ mesh: mesh, edges: edges, label: label, labelDiv: labelDiv, data: b, volume: volume });
  }

  updateLabelVisibility();
}

function getBoxColor(box, index) {
  switch (colorMode) {
    case 'client':
      return BOX_PALETTE[hashCode(box.clientCode) % BOX_PALETTE.length];
    case 'weight':
      return weightToColor(box.weight);
    case 'delivery':
      return deliveryToColor(box, index);
    case 'product':
    default:
      return BOX_PALETTE[hashCode(box.articleCode) % BOX_PALETTE.length];
  }
}

function weightToColor(weight) {
  var t = Math.min(weight / MAX_WEIGHT_KG, 1.0);
  return gradientColor(WEIGHT_GRADIENT, t);
}

function deliveryToColor(box, index) {
  // Use index as proxy for delivery order (first box = first to deliver)
  var total = boxesData.length;
  var t = total > 1 ? index / (total - 1) : 0;
  return gradientColor(DELIVERY_GRADIENT, t);
}

function gradientColor(gradient, t) {
  for (var i = 0; i < gradient.length - 1; i++) {
    var a = gradient[i];
    var c = gradient[i + 1];
    if (t >= a.t && t <= c.t) {
      var f = (t - a.t) / (c.t - a.t);
      return new THREE.Color(
        a.r + (c.r - a.r) * f,
        a.g + (c.g - a.g) * f,
        a.b + (c.b - a.b) * f
      );
    }
  }
  var last = gradient[gradient.length - 1];
  return new THREE.Color(last.r, last.g, last.b);
}

function hashCode(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
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

  for (var i = 0; i < boxMeshes.length; i++) {
    var entry = boxMeshes[i];
    var isSelected = (i === index);

    if (isSelected) {
      entry.mesh.material.emissive = new THREE.Color(COLORS.selectedEmissive);
      entry.mesh.material.emissiveIntensity = 0.4;
      entry.edges.material.color = new THREE.Color(COLORS.selectedEmissive);
      entry.edges.material.opacity = 0.8;
      // Show label for selected box
      entry.labelDiv.className = 'box-label selected-label';
    } else {
      entry.mesh.material.emissive = new THREE.Color(0x000000);
      entry.mesh.material.emissiveIntensity = 0;
      entry.edges.material.color = new THREE.Color(0xFFFFFF);
      entry.edges.material.opacity = 0.2;
    }
  }

  // Re-apply smart label visibility (selected box label is force-shown above)
  updateLabelVisibility();
}

function setCollisionState(index, hasCollision) {
  if (index < 0 || index >= boxMeshes.length) return;
  var entry = boxMeshes[index];

  if (hasCollision) {
    entry.mesh.material.emissive = new THREE.Color(COLORS.collisionEmissive);
    entry.mesh.material.emissiveIntensity = 0.6;
    entry.edges.material.color = new THREE.Color(COLORS.collisionEmissive);
    entry.edges.material.opacity = 0.9;
  } else if (index === selectedIndex) {
    entry.mesh.material.emissive = new THREE.Color(COLORS.selectedEmissive);
    entry.mesh.material.emissiveIntensity = 0.4;
    entry.edges.material.color = new THREE.Color(COLORS.selectedEmissive);
    entry.edges.material.opacity = 0.8;
  } else {
    entry.mesh.material.emissive = new THREE.Color(0x000000);
    entry.mesh.material.emissiveIntensity = 0;
    entry.edges.material.color = new THREE.Color(0xFFFFFF);
    entry.edges.material.opacity = 0.2;
  }
}

function updateColorMode(mode) {
  colorMode = mode;
  for (var i = 0; i < boxMeshes.length; i++) {
    var color = getBoxColor(boxMeshes[i].data, i);
    boxMeshes[i].mesh.material.color = new THREE.Color(color);
  }
  if (selectedIndex !== null) setSelected(selectedIndex);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART LABEL SYSTEM — Cap visible labels, prioritize largest boxes
// ═══════════════════════════════════════════════════════════════════════════════

function updateLabelVisibility() {
  if (!camera || boxMeshes.length === 0) return;

  // If few enough boxes, show all
  if (boxMeshes.length <= MAX_VISIBLE_LABELS) {
    for (var ai = 0; ai < boxMeshes.length; ai++) {
      if (ai === selectedIndex) {
        boxMeshes[ai].labelDiv.className = 'box-label selected-label';
      } else {
        boxMeshes[ai].labelDiv.className = 'box-label';
      }
    }
    return;
  }

  // Sort by volume descending to find top N largest boxes
  var indices = [];
  for (var si = 0; si < boxMeshes.length; si++) {
    indices.push(si);
  }
  indices.sort(function(a, b) {
    return boxMeshes[b].volume - boxMeshes[a].volume;
  });

  // Build set of visible label indices
  var visibleSet = {};
  var count = 0;
  for (var vi = 0; vi < indices.length && count < MAX_VISIBLE_LABELS; vi++) {
    var idx = indices[vi];
    // Also check distance — don't show label if box is too far from camera
    var dist = camera.position.distanceTo(boxMeshes[idx].mesh.position);
    var size = Math.max(
      boxMeshes[idx].mesh.geometry.parameters.width,
      boxMeshes[idx].mesh.geometry.parameters.depth
    );
    var screenSize = (size / dist) * window.innerHeight * 0.5;
    if (screenSize >= 12) { // Only show if box is visible enough on screen
      visibleSet[idx] = true;
      count++;
    }
  }

  // Always show selected box label
  if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < boxMeshes.length) {
    visibleSet[selectedIndex] = true;
  }

  // Apply visibility
  for (var li = 0; li < boxMeshes.length; li++) {
    if (li === selectedIndex) {
      boxMeshes[li].labelDiv.className = 'box-label selected-label';
    } else if (visibleSet[li]) {
      boxMeshes[li].labelDiv.className = 'box-label';
    } else {
      boxMeshes[li].labelDiv.className = 'box-label hidden';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA PRESETS
// ═══════════════════════════════════════════════════════════════════════════════

function setViewMode(mode) {
  if (!truckDims) return;

  var L = truckDims.lengthCm * CM_TO_M;
  var W = truckDims.widthCm * CM_TO_M;
  var H = truckDims.heightCm * CM_TO_M;
  var maxDim = Math.max(L, W, H);

  var duration = 600;
  var startPos = camera.position.clone();
  var startTarget = controls.target.clone();
  var endPos, endTarget;

  switch (mode) {
    case 'top':
      endPos = new THREE.Vector3(0, maxDim * 2.0, 0.001);
      endTarget = new THREE.Vector3(0, 0, 0);
      break;
    case 'front':
      endPos = new THREE.Vector3(0, H * 0.5, maxDim * 2.0);
      endTarget = new THREE.Vector3(0, H * 0.35, 0);
      break;
    case 'perspective':
    default:
      endPos = new THREE.Vector3(L * 0.8, maxDim * 1.0, W * 1.2);
      endTarget = new THREE.Vector3(0, H * 0.3, 0);
      break;
  }

  var startTime = performance.now();
  function animateCamera(now) {
    var t = Math.min((now - startTime) / duration, 1.0);
    var ease = 1 - Math.pow(1 - t, 3);

    camera.position.lerpVectors(startPos, endPos, ease);
    controls.target.lerpVectors(startTarget, endTarget, ease);
    controls.update();

    if (t < 1.0) {
      requestAnimationFrame(animateCamera);
    }
  }
  requestAnimationFrame(animateCamera);
}

// ═══════════════════════════════════════════════════════════════════════════════
// POINTER EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

function getPointerNDC(event) {
  var rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

function onPointerDown(event) {
  if (event.pointerType === 'touch' && event.isPrimary === false) return;

  pointerDownTime = performance.now();
  pointerDownPos = { x: event.clientX, y: event.clientY };
  pointer.copy(getPointerNDC(event));

  raycaster.setFromCamera(pointer, camera);
  var meshes = [];
  for (var pi = 0; pi < boxMeshes.length; pi++) {
    meshes.push(boxMeshes[pi].mesh);
  }
  var intersects = raycaster.intersectObjects(meshes);

  if (intersects.length > 0) {
    var hit = intersects[0].object;
    dragIndex = hit.userData.boxIndex;
  }
}

function onPointerMove(event) {
  if (dragIndex < 0) return;

  var dx = event.clientX - pointerDownPos.x;
  var dy = event.clientY - pointerDownPos.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var elapsed = performance.now() - pointerDownTime;

  if (!isDragging && elapsed > 200 && dist > 5) {
    isDragging = true;
    controls.enabled = false;

    pointer.copy(getPointerNDC(event));
    raycaster.setFromCamera(pointer, camera);
    var intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, intersection);

    var mesh = boxMeshes[dragIndex].mesh;
    dragOffset.subVectors(mesh.position, intersection);
    dragOffset.y = 0;

    mesh.material.transparent = true;
    mesh.material.opacity = 0.7;

    sendToFlutter('boxDragStart', { index: dragIndex });
  }

  if (isDragging && dragIndex >= 0) {
    pointer.copy(getPointerNDC(event));
    raycaster.setFromCamera(pointer, camera);
    var intersection2 = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, intersection2);

    if (intersection2) {
      var newPos = intersection2.add(dragOffset);
      var mesh2 = boxMeshes[dragIndex].mesh;

      if (truckDims) {
        var tHalfL = truckDims.lengthCm * CM_TO_M / 2;
        var tHalfW = truckDims.widthCm * CM_TO_M / 2;
        var mbw = mesh2.geometry.parameters.width / 2;
        var mbd = mesh2.geometry.parameters.depth / 2;

        newPos.x = Math.max(-tHalfL + mbw, Math.min(tHalfL - mbw, newPos.x));
        newPos.z = Math.max(-tHalfW + mbd, Math.min(tHalfW - mbd, newPos.z));
      }

      mesh2.position.x = newPos.x;
      mesh2.position.z = newPos.z;
      boxMeshes[dragIndex].edges.position.x = newPos.x;
      boxMeshes[dragIndex].edges.position.z = newPos.z;

      var dHalfL = truckDims.lengthCm * CM_TO_M / 2;
      var dHalfW = truckDims.widthCm * CM_TO_M / 2;
      var dbw = mesh2.geometry.parameters.width / 2;
      var dbd = mesh2.geometry.parameters.depth / 2;
      var dataX = (newPos.x + dHalfL - dbw) / CM_TO_M;
      var dataY = (newPos.z + dHalfW - dbd) / CM_TO_M;

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
    var mesh = boxMeshes[dragIndex].mesh;
    mesh.material.transparent = false;
    mesh.material.opacity = 1.0;

    var halfL = truckDims.lengthCm * CM_TO_M / 2;
    var halfW = truckDims.widthCm * CM_TO_M / 2;
    var bw = mesh.geometry.parameters.width / 2;
    var bd = mesh.geometry.parameters.depth / 2;
    var dataX = (mesh.position.x + halfL - bw) / CM_TO_M;
    var dataY = (mesh.position.z + halfW - bd) / CM_TO_M;

    sendToFlutter('boxDragEnd', {
      index: dragIndex,
      x: Math.round(dataX * 10) / 10,
      y: Math.round(dataY * 10) / 10,
    });

    isDragging = false;
    controls.enabled = true;
  } else if (dragIndex >= 0) {
    var elapsed = performance.now() - pointerDownTime;
    var dx = event.clientX - pointerDownPos.x;
    var dy = event.clientY - pointerDownPos.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (elapsed < 300 && dist < 10) {
      sendToFlutter('boxSelected', { index: dragIndex });
    }
  } else {
    var elapsed2 = performance.now() - pointerDownTime;
    var dx2 = event.clientX - pointerDownPos.x;
    var dy2 = event.clientY - pointerDownPos.y;
    var dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    if (elapsed2 < 300 && dist2 < 10) {
      sendToFlutter('canvasTapped', {});
    }
  }

  dragIndex = -1;
  isDragging = false;
}

function onPointerCancel() {
  if (isDragging && dragIndex >= 0) {
    var mesh = boxMeshes[dragIndex].mesh;
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

var _labelCounter = 0;
function animate() {
  animationId = requestAnimationFrame(animate);
  controls.update();

  // Update labels less frequently for performance (every 10th frame)
  _labelCounter++;
  if (_labelCounter >= 10) {
    _labelCounter = 0;
    updateLabelVisibility();
  }

  renderer.render(scene, camera);
  css2dRenderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLUTTER BRIDGE
// ═══════════════════════════════════════════════════════════════════════════════

function sendToFlutter(type, payload) {
  try {
    if (window.FlutterBridge) {
      window.FlutterBridge.postMessage(JSON.stringify({ type: type, ...payload }));
    }
  } catch (e) {
    console.warn('FlutterBridge send failed:', e);
  }
}

window.ThreeBridge = {
  loadScene: function(truckJson, boxesJson) {
    try {
      var truck = typeof truckJson === 'string' ? JSON.parse(truckJson) : truckJson;
      var boxes = typeof boxesJson === 'string' ? JSON.parse(boxesJson) : boxesJson;
      buildTruck(truck);
      buildBoxes(boxes);
    } catch (e) {
      console.error('loadScene error:', e);
    }
  },

  updateBoxes: function(boxesJson) {
    try {
      var boxes = typeof boxesJson === 'string' ? JSON.parse(boxesJson) : boxesJson;
      buildBoxes(boxes);
      if (selectedIndex !== null) setSelected(selectedIndex);
    } catch (e) {
      console.error('updateBoxes error:', e);
    }
  },

  updateBoxPosition: function(index, x, y, z) {
    if (index < 0 || index >= boxMeshes.length || !truckDims) return;
    var entry = boxMeshes[index];
    var halfL = truckDims.lengthCm * CM_TO_M / 2;
    var halfW = truckDims.widthCm * CM_TO_M / 2;
    var bw = entry.mesh.geometry.parameters.width / 2;
    var bd = entry.mesh.geometry.parameters.depth / 2;
    var bh = entry.mesh.geometry.parameters.height / 2;

    var px = x * CM_TO_M - halfL + bw;
    var py = z * CM_TO_M + bh;
    var pz = y * CM_TO_M - halfW + bd;

    entry.mesh.position.set(px, py, pz);
    entry.edges.position.set(px, py, pz);
  },

  selectBox: function(index) {
    setSelected(index === null || index === undefined || index < 0 ? null : index);
  },

  setViewMode: function(mode) {
    setViewMode(mode);
  },

  setColorMode: function(mode) {
    updateColorMode(mode);
  },

  setCollisionState: function(index, hasCollision) {
    setCollisionState(index, hasCollision);
  },

  toggleWalls: function(visible) {
    wallsVisible = visible;
    wallsGroup.visible = visible;
  },

  highlightOverflow: function(orderNumbers) {
    var overflowSet = {};
    for (var oi = 0; oi < orderNumbers.length; oi++) {
      overflowSet[orderNumbers[oi]] = true;
    }
    for (var hi = 0; hi < boxMeshes.length; hi++) {
      var isOverflow = overflowSet[boxMeshes[hi].data.orderNumber] === true;
      if (isOverflow) {
        boxMeshes[hi].mesh.material.opacity = 0.3;
        boxMeshes[hi].mesh.material.transparent = true;
      } else {
        boxMeshes[hi].mesh.material.opacity = 1.0;
        boxMeshes[hi].mesh.material.transparent = false;
      }
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════

init();

})();
