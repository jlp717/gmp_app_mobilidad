(function () {
'use strict';

var THREE = window.THREE;
var OrbitControls = window.OrbitControls;

/* ═══════════════════════════════════════════════════════════════════════════════
 *  Load Planner 3D — High-Performance Engine v2
 *
 *  Performance first:
 *    • On-demand rendering (dirty flag — GPU idle when nothing changes)
 *    • MeshPhongMaterial (≈50 % cheaper than MeshStandard PBR)
 *    • No CSS2DRenderer  (eliminates DOM layout pass per frame)
 *    • No per-box wireframes / AO planes (draw calls reduced 3×)
 *    • Shadow map 1024 (−75 % fill vs 2048)
 *    • Pixel-ratio capped at 1.5 for tablets
 *    • Geometry + material dispose on clear (no GPU memory leaks)
 *
 *  Visual quality:
 *    • Procedural truck (cab, container, wheels, rear doors)
 *    • Bright edge wireframe on cargo container (clearly visible)
 *    • Professional color palette with per-mode gradients
 *    • Emissive glow for selection / collision
 *    • Smooth camera transitions (sine easing)
 *
 *  Functional:
 *    • Client-side gravity settling  (boxes rest on surfaces)
 *    • Client-side 3D bin packing    (Extreme-Point heuristic)
 *    • Full Flutter bridge compatibility
 * ═══════════════════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

var CM = 0.01; // cm → metres

var COL = {
  bg:       0x12161e,
  ground:   0x0e1118,
  floor:    0x1a2540,
  gridMin:  0x2a4070,
  gridMaj:  0x3a5090,
  wall:     0x2a5a8a,
  edge:     0x4cc8e8,
  cab:      0x1e3050,
  glass:    0x3a6699,
  wheel:    0x181820,
  rim:      0x383848,
  door:     0x253348,
  rail:     0x182030,
  sel:      0x00ccff,
  hit:      0xff3344,
  marker:   0x22bb55,
};

var WALL_ALPHA  = 0.14;
var EDGE_ALPHA  = 0.60;
var WALL_ANIM   = 350;   // ms

var PALETTE = [
  0x5B8DEF, 0x2EC4A0, 0xF06292, 0xFFB74D,
  0x81C784, 0x9575CD, 0x4DD0E1, 0xE57373,
  0xAED581, 0x7986CB, 0xFFD54F, 0x4DB6AC,
  0xBA68C8, 0xFF8A65, 0x64B5F6, 0xA1887F,
];

var WT_GRAD = [
  { t: 0.00, r: 0.36, g: 0.55, b: 0.94 },
  { t: 0.33, r: 0.18, g: 0.77, b: 0.63 },
  { t: 0.66, r: 1.00, g: 0.84, b: 0.33 },
  { t: 1.00, r: 0.90, g: 0.26, b: 0.26 },
];

var DLV_GRAD = [
  { t: 0.0, r: 0.18, g: 0.77, b: 0.63 },
  { t: 0.5, r: 1.00, g: 0.84, b: 0.33 },
  { t: 1.0, r: 0.90, g: 0.26, b: 0.26 },
];

var MAX_WEIGHT_KG = 30;

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

var scene, camera, renderer, controls;
var truckGroup, boxGroup;
var raycaster, pointer;
var meshes   = [];   // [{ mesh, data }]
var boxData  = [];   // raw box data array
var truck    = null; // { lengthCm, widthCm, heightCm, maxPayloadKg }
var cMode    = 'product';
var selIdx   = null;
var wallList = [];
var wallsOn  = true;

// Drag state
var dragging  = false;
var dIdx      = -1;
var dPlane, dOff;
var downTime  = 0;
var downPos   = { x: 0, y: 0 };

// On-demand rendering
var dirty = true;
function markDirty() { dirty = true; }

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.bg);

  // Camera
  camera = new THREE.PerspectiveCamera(
    38, window.innerWidth / window.innerHeight, 0.1, 80
  );
  camera.position.set(6, 5, 8);

  // Renderer — performance-optimised
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1.0;
  if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = 'srgb';
  document.body.appendChild(renderer.domElement);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance   = 1;
  controls.maxDistance   = 20;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = 0.05;
  controls.addEventListener('change', markDirty);

  // Lights & environment
  setupLights();
  setupGround();

  // Groups
  truckGroup = new THREE.Group();
  boxGroup   = new THREE.Group();
  scene.add(truckGroup);
  scene.add(boxGroup);

  // Raycaster
  raycaster = new THREE.Raycaster();
  pointer   = new THREE.Vector2();
  dPlane    = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  dOff      = new THREE.Vector3();

  // Events
  var el = renderer.domElement;
  el.addEventListener('pointerdown',   onPointerDown);
  el.addEventListener('pointermove',   onPointerMove);
  el.addEventListener('pointerup',     onPointerUp);
  el.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('resize', onResize);

  // Render loop
  animate();

  // Signal Flutter
  hideLoading();
  window._sceneInitDone = true;
  sendToFlutter('sceneReady', {});
}

// ─────────────────────────────────────────────────────────────────────────────
// LIGHTING — 3 lights total (ambient + hemisphere + 1 directional)
// ─────────────────────────────────────────────────────────────────────────────

function setupLights() {
  scene.add(new THREE.AmbientLight(0x404860, 0.55));

  var hemi = new THREE.HemisphereLight(0x5588bb, 0x182030, 0.35);
  hemi.position.set(0, 20, 0);
  scene.add(hemi);

  var dir = new THREE.DirectionalLight(0xffeedd, 0.95);
  dir.position.set(5, 10, 4);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.near   = 0.5;
  dir.shadow.camera.far    = 30;
  dir.shadow.camera.left   = -10;
  dir.shadow.camera.right  =  10;
  dir.shadow.camera.top    =  10;
  dir.shadow.camera.bottom = -10;
  dir.shadow.bias = -0.001;
  scene.add(dir);
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUND
// ─────────────────────────────────────────────────────────────────────────────

function setupGround() {
  var geo = new THREE.PlaneGeometry(80, 80);
  var mat = new THREE.MeshPhongMaterial({ color: COL.ground });
  var gnd = new THREE.Mesh(geo, mat);
  gnd.rotation.x   = -Math.PI / 2;
  gnd.position.y    = -0.02;
  gnd.receiveShadow = true;
  scene.add(gnd);
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUCK MODEL — procedural box truck
// ─────────────────────────────────────────────────────────────────────────────

function buildTruck(dims) {
  disposeGroup(truckGroup);
  wallList = [];
  truck = dims;

  var L  = dims.lengthCm * CM;
  var W  = dims.widthCm  * CM;
  var H  = dims.heightCm * CM;
  var hL = L / 2;
  var hW = W / 2;

  buildContainer(L, W, H, hL, hW);
  buildCab(L, W, H, hL, hW);
  buildWheels(L, W, hL, hW);
  buildRearDoors(L, W, H, hL, hW);

  // Frame camera
  var maxD = Math.max(L, W, H);
  camera.position.set(L * 0.9, maxD * 1.1, W * 1.5);
  controls.target.set(0, H * 0.35, 0);
  controls.update();

  // Fit shadow camera
  scene.traverse(function (c) {
    if (c.isDirectionalLight && c.castShadow) {
      var s = maxD * 1.3;
      c.shadow.camera.left   = -s;
      c.shadow.camera.right  =  s;
      c.shadow.camera.top    =  s;
      c.shadow.camera.bottom = -s;
      c.shadow.camera.updateProjectionMatrix();
    }
  });

  markDirty();
}

// — Cargo container (floor + grid + walls + edges) —————————————————————————

function buildContainer(L, W, H, hL, hW) {
  var WT = 0.035;

  // Floor slab
  var floorMat = new THREE.MeshPhongMaterial({ color: COL.floor });
  var floor = new THREE.Mesh(
    new THREE.BoxGeometry(L + 0.02, WT, W + 0.02), floorMat
  );
  floor.position.set(0, -WT / 2 + 0.001, 0);
  floor.receiveShadow = true;
  floor.castShadow    = true;
  truckGroup.add(floor);

  // Floor grid — visible 0.5 m minor, 1 m major
  var gMinor = new THREE.LineBasicMaterial({ color: COL.gridMin, opacity: 0.12, transparent: true });
  var gMajor = new THREE.LineBasicMaterial({ color: COL.gridMaj, opacity: 0.22, transparent: true });
  var xi, zi;
  for (xi = -hL; xi <= hL + 0.001; xi += 0.5) {
    var isMaj = Math.abs(xi % 1.0) < 0.01;
    addLine(xi, 0.003, -hW, xi, 0.003, hW, isMaj ? gMajor : gMinor);
  }
  for (zi = -hW; zi <= hW + 0.001; zi += 0.5) {
    var isMaj2 = Math.abs(zi % 1.0) < 0.01;
    addLine(-hL, 0.003, zi, hL, 0.003, zi, isMaj2 ? gMajor : gMinor);
  }

  // Walls — semi-transparent with thickness
  var wallMat = new THREE.MeshPhongMaterial({
    color: COL.wall, transparent: true, opacity: WALL_ALPHA,
    side: THREE.DoubleSide, depthWrite: false,
  });

  // Back wall (cab side)
  var backW = makeMesh(new THREE.BoxGeometry(WT, H, W), wallMat.clone());
  backW.position.set(-hL - WT / 2, H / 2, 0);
  backW.castShadow = true;
  truckGroup.add(backW);
  wallList.push(backW);

  // Left wall
  var leftW = makeMesh(new THREE.BoxGeometry(L + WT * 2, H, WT), wallMat.clone());
  leftW.position.set(0, H / 2, -hW - WT / 2);
  leftW.castShadow = true;
  truckGroup.add(leftW);
  wallList.push(leftW);

  // Right wall
  var rightW = makeMesh(new THREE.BoxGeometry(L + WT * 2, H, WT), wallMat.clone());
  rightW.position.set(0, H / 2, hW + WT / 2);
  rightW.castShadow = true;
  truckGroup.add(rightW);
  wallList.push(rightW);

  // Ceiling
  var ceilMat = wallMat.clone();
  ceilMat.opacity = 0.06;
  var ceil = makeMesh(new THREE.BoxGeometry(L + WT * 2, WT, W + WT * 2), ceilMat);
  ceil.position.set(0, H + WT / 2, 0);
  truckGroup.add(ceil);
  wallList.push(ceil);

  // Cargo edge wireframe — bright and visible
  var edgeMat = new THREE.LineBasicMaterial({
    color: COL.edge, opacity: EDGE_ALPHA, transparent: true,
  });
  var edgeGeo = new THREE.BoxGeometry(L, H, W);
  var edges   = new THREE.LineSegments(new THREE.EdgesGeometry(edgeGeo), edgeMat);
  edges.position.set(0, H / 2, 0);
  truckGroup.add(edges);

  // Bottom frame rails
  var railMat = new THREE.MeshPhongMaterial({ color: COL.rail, shininess: 5 });
  var rH = 0.08, rW = 0.04;
  var lRail = makeMesh(new THREE.BoxGeometry(L + 0.2, rH, rW), railMat);
  lRail.position.set(0, -rH / 2 - 0.02, -hW + 0.1);
  lRail.castShadow = true;
  truckGroup.add(lRail);

  var rRail = makeMesh(new THREE.BoxGeometry(L + 0.2, rH, rW), railMat);
  rRail.position.set(0, -rH / 2 - 0.02, hW - 0.1);
  rRail.castShadow = true;
  truckGroup.add(rRail);

  // Cross members
  var crossN = Math.max(2, Math.floor(L / 0.8));
  for (var ci = 0; ci < crossN; ci++) {
    var cx = -hL + (L / (crossN - 1)) * ci;
    var cross = makeMesh(new THREE.BoxGeometry(rW, rH * 0.6, W - 0.1), railMat);
    cross.position.set(cx, -rH / 2 - 0.02, 0);
    truckGroup.add(cross);
  }
}

// — Cab —————————————————————————————————————————————————————————————————————

function buildCab(L, W, H, hL, hW) {
  var cabL = Math.min(W * 0.7, 1.5);
  var cabH = H * 0.78;
  var cabW = W + 0.08;

  var cabMat = new THREE.MeshPhongMaterial({ color: COL.cab, shininess: 20 });
  var body = makeMesh(new THREE.BoxGeometry(cabL, cabH, cabW), cabMat);
  body.position.set(-hL - cabL / 2 - 0.04, cabH / 2, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  truckGroup.add(body);

  // Windshield
  var glassMat = new THREE.MeshPhongMaterial({
    color: COL.glass, transparent: true, opacity: 0.4,
    shininess: 90, side: THREE.DoubleSide,
  });
  var ws = makeMesh(new THREE.PlaneGeometry(cabW - 0.15, cabH * 0.5), glassMat);
  ws.position.set(-hL - cabL - 0.04, cabH * 0.6, 0);
  ws.rotation.y = Math.PI / 2;
  ws.rotation.x = -0.12;
  truckGroup.add(ws);

  // Side windows
  var swGeo = new THREE.PlaneGeometry(cabL * 0.5, cabH * 0.35);
  var swMat = glassMat.clone(); swMat.opacity = 0.3;
  var swL = makeMesh(swGeo, swMat);
  swL.position.set(-hL - cabL * 0.5 - 0.04, cabH * 0.6, -cabW / 2 - 0.01);
  truckGroup.add(swL);
  var swR = makeMesh(swGeo.clone(), swMat.clone());
  swR.position.set(-hL - cabL * 0.5 - 0.04, cabH * 0.6, cabW / 2 + 0.01);
  truckGroup.add(swR);

  // Headlights
  var hlMat = new THREE.MeshPhongMaterial({
    color: 0xFFFFCC, emissive: 0xFFFFCC, emissiveIntensity: 0.5,
    shininess: 80,
  });
  var hlGeo = new THREE.CircleGeometry(0.06, 12);
  var hlL = makeMesh(hlGeo, hlMat);
  hlL.position.set(-hL - cabL - 0.045, cabH * 0.3, -cabW / 2 + 0.2);
  hlL.rotation.y = Math.PI / 2;
  truckGroup.add(hlL);
  var hlR = makeMesh(hlGeo.clone(), hlMat.clone());
  hlR.position.set(-hL - cabL - 0.045, cabH * 0.3, cabW / 2 - 0.2);
  hlR.rotation.y = Math.PI / 2;
  truckGroup.add(hlR);

  // Bumper
  var bumpMat = new THREE.MeshPhongMaterial({ color: 0x1A1A28, shininess: 10 });
  var bump = makeMesh(new THREE.BoxGeometry(0.08, 0.14, cabW + 0.05), bumpMat);
  bump.position.set(-hL - cabL - 0.08, 0.14, 0);
  bump.castShadow = true;
  truckGroup.add(bump);

  // Roof
  var roofMat = new THREE.MeshPhongMaterial({ color: COL.cab, shininess: 15 });
  var roof = makeMesh(new THREE.BoxGeometry(cabL + 0.02, 0.04, cabW + 0.04), roofMat);
  roof.position.set(-hL - cabL / 2 - 0.04, cabH + 0.02, 0);
  roof.castShadow = true;
  truckGroup.add(roof);
}

// — Wheels ——————————————————————────────────────────────────────────————————

function buildWheels(L, W, hL, hW) {
  var R = 0.18, ww = 0.12;
  var cabL = Math.min(W * 0.7, 1.5);
  var tireGeo = new THREE.CylinderGeometry(R, R, ww, 16);
  var tireMat = new THREE.MeshPhongMaterial({ color: COL.wheel, shininess: 2 });
  var rimGeo  = new THREE.CylinderGeometry(R * 0.5, R * 0.5, ww + 0.02, 12);
  var rimMat  = new THREE.MeshPhongMaterial({ color: COL.rim, shininess: 40 });

  var positions = [
    { x: hL * 0.7,              z: -hW - 0.06 },
    { x: hL * 0.7,              z:  hW + 0.06 },
    { x: -hL - cabL * 0.6,     z: -hW - 0.06 },
    { x: -hL - cabL * 0.6,     z:  hW + 0.06 },
  ];

  for (var i = 0; i < positions.length; i++) {
    var p = positions[i];
    var tire = makeMesh(tireGeo.clone(), tireMat.clone());
    tire.rotation.x = Math.PI / 2;
    tire.position.set(p.x, R * 0.8, p.z);
    tire.castShadow = true;
    truckGroup.add(tire);

    var rim = makeMesh(rimGeo.clone(), rimMat.clone());
    rim.rotation.x = Math.PI / 2;
    rim.position.set(p.x, R * 0.8, p.z);
    truckGroup.add(rim);
  }
}

// — Rear doors ——————————————————————————————————————————————————————————————

function buildRearDoors(L, W, H, hL, hW) {
  var doorMat = new THREE.MeshPhongMaterial({ color: COL.door, shininess: 10 });
  var doorW = W / 2 - 0.02;
  var doorGeo = new THREE.BoxGeometry(0.025, H - 0.04, doorW);

  var dL = makeMesh(doorGeo, doorMat);
  dL.position.set(hL + 0.013, H / 2, -doorW / 2 - 0.01);
  dL.castShadow = true;
  truckGroup.add(dL);
  wallList.push(dL);

  var dR = makeMesh(doorGeo.clone(), doorMat.clone());
  dR.position.set(hL + 0.013, H / 2, doorW / 2 + 0.01);
  dR.castShadow = true;
  truckGroup.add(dR);
  wallList.push(dR);

  // Rear marker lights
  var mkMat = new THREE.MeshPhongMaterial({
    color: COL.marker, emissive: COL.marker, emissiveIntensity: 0.3,
    shininess: 50,
  });
  var mkGeo = new THREE.CircleGeometry(0.035, 10);
  var mkL = makeMesh(mkGeo, mkMat);
  mkL.position.set(hL + 0.026, H * 0.1, -hW + 0.1);
  mkL.rotation.y = -Math.PI / 2;
  truckGroup.add(mkL);
  var mkR = makeMesh(mkGeo.clone(), mkMat.clone());
  mkR.position.set(hL + 0.026, H * 0.1, hW - 0.1);
  mkR.rotation.y = -Math.PI / 2;
  truckGroup.add(mkR);
}

// ─────────────────────────────────────────────────────────────────────────────
// BOX RENDERING — MeshPhong, per-box color, no wireframes / labels
// ─────────────────────────────────────────────────────────────────────────────

function buildBoxMeshes(boxes) {
  clearBoxes();
  boxData = boxes;
  if (!truck) return;

  var hL = truck.lengthCm * CM / 2;
  var hW = truck.widthCm  * CM / 2;

  for (var i = 0; i < boxes.length; i++) {
    var b  = boxes[i];
    var bw = b.w * CM;
    var bd = b.d * CM;
    var bh = b.h * CM;

    var color = boxColor(b, i);
    var mat = new THREE.MeshPhongMaterial({
      color: color,
      shininess: 35,
      specular: 0x222233,
    });
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;

    var px = b.x * CM - hL + bw / 2;
    var py = b.z * CM + bh / 2;
    var pz = b.y * CM - hW + bd / 2;
    mesh.position.set(px, py, pz);
    mesh.userData = { idx: i };

    boxGroup.add(mesh);
    meshes.push({ mesh: mesh, data: b });
  }

  markDirty();
}

function clearBoxes() {
  for (var i = boxGroup.children.length - 1; i >= 0; i--) {
    var c = boxGroup.children[i];
    boxGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
  meshes = [];
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR MODES
// ─────────────────────────────────────────────────────────────────────────────

function boxColor(box, index) {
  switch (cMode) {
    case 'client':   return PALETTE[hash(box.clientCode)  % PALETTE.length];
    case 'weight':   return weightCol(box.weight);
    case 'delivery': return deliveryCol(box.deliveryOrder, boxData.length);
    default:         return PALETTE[hash(box.articleCode) % PALETTE.length];
  }
}

function weightCol(w) {
  return gradCol(WT_GRAD, Math.min(w / MAX_WEIGHT_KG, 1));
}
function deliveryCol(order, total) {
  if (!order || !total || total <= 1) return new THREE.Color(0x4ECDC4);
  return gradCol(DLV_GRAD, Math.min((order - 1) / (total - 1), 1));
}
function gradCol(grad, t) {
  for (var i = 0; i < grad.length - 1; i++) {
    var a = grad[i], c = grad[i + 1];
    if (t >= a.t && t <= c.t) {
      var f = (t - a.t) / (c.t - a.t);
      return new THREE.Color(
        a.r + (c.r - a.r) * f,
        a.g + (c.g - a.g) * f,
        a.b + (c.b - a.b) * f
      );
    }
  }
  var last = grad[grad.length - 1];
  return new THREE.Color(last.r, last.g, last.b);
}

function hash(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
  return Math.abs(h);
}

function applyColors() {
  for (var i = 0; i < meshes.length; i++) {
    meshes[i].mesh.material.color = new THREE.Color(boxColor(meshes[i].data, i));
  }
  if (selIdx !== null) setSelected(selIdx);
  markDirty();
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTION & COLLISION — emissive glow
// ─────────────────────────────────────────────────────────────────────────────

function setSelected(index) {
  selIdx = index;
  for (var i = 0; i < meshes.length; i++) {
    var m = meshes[i].mesh;
    if (i === index) {
      m.material.emissive = new THREE.Color(COL.sel);
      m.material.emissiveIntensity = 0.45;
      m.scale.setScalar(1.02);
    } else {
      m.material.emissive = new THREE.Color(0x000000);
      m.material.emissiveIntensity = 0;
      m.scale.setScalar(1);
    }
  }
  markDirty();
}

function setCollision(index, hasHit) {
  if (index < 0 || index >= meshes.length) return;
  var m = meshes[index].mesh;
  if (hasHit) {
    m.material.emissive = new THREE.Color(COL.hit);
    m.material.emissiveIntensity = 0.6;
  } else if (index === selIdx) {
    m.material.emissive = new THREE.Color(COL.sel);
    m.material.emissiveIntensity = 0.45;
  } else {
    m.material.emissive = new THREE.Color(0x000000);
    m.material.emissiveIntensity = 0;
  }
  markDirty();
}

// ─────────────────────────────────────────────────────────────────────────────
// WALL TOGGLE — animated opacity
// ─────────────────────────────────────────────────────────────────────────────

function animateWalls(visible) {
  wallsOn = visible;
  var target = visible ? WALL_ALPHA : 0;
  var starts = [];
  for (var i = 0; i < wallList.length; i++) starts.push(wallList[i].material.opacity);
  var t0 = performance.now();

  function step(now) {
    var p = Math.min((now - t0) / WALL_ANIM, 1);
    var e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    for (var j = 0; j < wallList.length; j++) {
      wallList[j].material.opacity = starts[j] + (target - starts[j]) * e;
      wallList[j].material.transparent = true;
      wallList[j].visible = wallList[j].material.opacity > 0.002;
    }
    markDirty();
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMERA PRESETS — smooth sine transitions
// ─────────────────────────────────────────────────────────────────────────────

function setView(mode) {
  if (!truck) return;
  var L = truck.lengthCm * CM;
  var W = truck.widthCm  * CM;
  var H = truck.heightCm * CM;
  var mx = Math.max(L, W, H);

  var endPos, endTgt;
  switch (mode) {
    case 'top':
      endPos = new THREE.Vector3(0, mx * 2.2, 0.001);
      endTgt = new THREE.Vector3(0, 0, 0);
      break;
    case 'front':
      endPos = new THREE.Vector3(0, H * 0.5, mx * 2.2);
      endTgt = new THREE.Vector3(0, H * 0.35, 0);
      break;
    default: // perspective
      endPos = new THREE.Vector3(L * 0.9, mx * 1.1, W * 1.5);
      endTgt = new THREE.Vector3(0, H * 0.35, 0);
      break;
  }

  var sPos = camera.position.clone();
  var sTgt = controls.target.clone();
  var dur  = 700;
  var t0   = performance.now();

  function step(now) {
    var t = Math.min((now - t0) / dur, 1);
    var e = -(Math.cos(Math.PI * t) - 1) / 2;
    camera.position.lerpVectors(sPos, endPos, e);
    controls.target.lerpVectors(sTgt, endTgt, e);
    controls.update();
    markDirty();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─────────────────────────────────────────────────────────────────────────────
// POINTER EVENTS — tap / long-press drag / orbit
// ─────────────────────────────────────────────────────────────────────────────

function ndc(ev) {
  var r = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((ev.clientX - r.left) / r.width)  * 2 - 1,
   -((ev.clientY - r.top)  / r.height) * 2 + 1
  );
}

function hitBoxes(pt) {
  raycaster.setFromCamera(pt, camera);
  var arr = [];
  for (var i = 0; i < meshes.length; i++) arr.push(meshes[i].mesh);
  return raycaster.intersectObjects(arr);
}

function onPointerDown(ev) {
  if (ev.pointerType === 'touch' && !ev.isPrimary) return;
  downTime = performance.now();
  downPos  = { x: ev.clientX, y: ev.clientY };
  pointer.copy(ndc(ev));

  var hits = hitBoxes(pointer);
  dIdx = hits.length > 0 ? hits[0].object.userData.idx : -1;
}

function onPointerMove(ev) {
  if (dIdx < 0) return;
  var dx = ev.clientX - downPos.x;
  var dy = ev.clientY - downPos.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var elapsed = performance.now() - downTime;

  // Start drag after long press + small movement
  if (!dragging && elapsed > 200 && dist > 5) {
    dragging = true;
    controls.enabled = false;
    pointer.copy(ndc(ev));
    raycaster.setFromCamera(pointer, camera);
    var pt = new THREE.Vector3();
    raycaster.ray.intersectPlane(dPlane, pt);
    dOff.subVectors(meshes[dIdx].mesh.position, pt);
    dOff.y = 0;
    meshes[dIdx].mesh.material.transparent = true;
    meshes[dIdx].mesh.material.opacity = 0.7;
    sendToFlutter('boxDragStart', { index: dIdx });
  }

  if (dragging && dIdx >= 0 && truck) {
    pointer.copy(ndc(ev));
    raycaster.setFromCamera(pointer, camera);
    var pt2 = new THREE.Vector3();
    raycaster.ray.intersectPlane(dPlane, pt2);
    if (!pt2) return;
    var np = pt2.add(dOff);

    var hL = truck.lengthCm * CM / 2;
    var hW = truck.widthCm  * CM / 2;
    var params = meshes[dIdx].mesh.geometry.parameters;
    var bwH = (params ? params.width  : 0.3) / 2;
    var bdH = (params ? params.depth  : 0.3) / 2;
    np.x = clamp(np.x, -hL + bwH, hL - bwH);
    np.z = clamp(np.z, -hW + bdH, hW - bdH);

    meshes[dIdx].mesh.position.x = np.x;
    meshes[dIdx].mesh.position.z = np.z;
    markDirty();

    // Convert back to API coords
    var dataX = (np.x + hL - bwH) / CM;
    var dataY = (np.z + hW - bdH) / CM;
    sendToFlutter('boxDragMove', {
      index: dIdx,
      x: Math.round(dataX * 10) / 10,
      y: Math.round(dataY * 10) / 10,
    });
  }
}

function onPointerUp(ev) {
  if (dragging && dIdx >= 0 && truck) {
    var m = meshes[dIdx].mesh;
    m.material.transparent = false;
    m.material.opacity = 1;
    var hL = truck.lengthCm * CM / 2;
    var hW = truck.widthCm  * CM / 2;
    var params = m.geometry.parameters;
    var bwH = (params ? params.width  : 0.3) / 2;
    var bdH = (params ? params.depth  : 0.3) / 2;
    sendToFlutter('boxDragEnd', {
      index: dIdx,
      x: Math.round((m.position.x + hL - bwH) / CM * 10) / 10,
      y: Math.round((m.position.z + hW - bdH) / CM * 10) / 10,
    });
    dragging = false;
    controls.enabled = true;
    markDirty();
  } else if (dIdx >= 0) {
    var el2 = performance.now() - downTime;
    var dx2 = ev.clientX - downPos.x;
    var dy2 = ev.clientY - downPos.y;
    if (el2 < 300 && Math.sqrt(dx2 * dx2 + dy2 * dy2) < 10) {
      sendToFlutter('boxSelected', { index: dIdx });
    }
  } else {
    var el3 = performance.now() - downTime;
    var dx3 = ev.clientX - downPos.x;
    var dy3 = ev.clientY - downPos.y;
    if (el3 < 300 && Math.sqrt(dx3 * dx3 + dy3 * dy3) < 10) {
      sendToFlutter('canvasTapped', {});
    }
  }
  dIdx = -1;
  dragging = false;
}

function onPointerCancel() {
  if (dragging && dIdx >= 0) {
    meshes[dIdx].mesh.material.transparent = false;
    meshes[dIdx].mesh.material.opacity = 1;
  }
  dIdx = -1;
  dragging = false;
  controls.enabled = true;
  markDirty();
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAVITY SETTLING — ensure boxes rest on surfaces
// ─────────────────────────────────────────────────────────────────────────────

function settleGravity(boxes) {
  // Sort by z ascending (process from floor up)
  var sorted = [];
  for (var i = 0; i < boxes.length; i++) sorted.push(i);
  sorted.sort(function (a, b) { return boxes[a].z - boxes[b].z; });

  for (var si = 0; si < sorted.length; si++) {
    var idx = sorted[si];
    var b = boxes[idx];
    var supportZ = 0; // floor

    for (var j = 0; j < boxes.length; j++) {
      if (j === idx) continue;
      var o = boxes[j];
      // Only consider boxes already at or below this one
      if (o.z + o.h > b.z + 0.1) continue;
      // Check XY overlap (with 0.5cm tolerance)
      if (b.x < o.x + o.w - 0.5 && b.x + b.w > o.x + 0.5 &&
          b.y < o.y + o.d - 0.5 && b.y + b.d > o.y + 0.5) {
        supportZ = Math.max(supportZ, o.z + o.h);
      }
    }

    boxes[idx] = assign(b, { z: supportZ });
  }
  return boxes;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D BIN PACKING — Extreme-Point heuristic
// ─────────────────────────────────────────────────────────────────────────────

function repackBoxes() {
  if (!truck || boxData.length === 0) return;
  var L = truck.lengthCm;
  var W = truck.widthCm;
  var H = truck.heightCm;

  // Sort by volume descending
  var items = boxData.map(function (b, i) { return assign({}, b); });
  items.sort(function (a, b) {
    return (b.w * b.d * b.h) - (a.w * a.d * a.h);
  });

  var eps = [{ x: 0, y: 0, z: 0 }]; // extreme points
  var placed  = [];
  var overflow = [];

  for (var i = 0; i < items.length; i++) {
    var box = items[i];
    var best = null;
    var bestScore = Infinity;
    var bestW = box.w, bestD = box.d;

    // Try both orientations (swap w, d)
    var orients = [[box.w, box.d], [box.d, box.w]];

    for (var oi = 0; oi < orients.length; oi++) {
      var ow = orients[oi][0];
      var od = orients[oi][1];

      for (var ei = 0; ei < eps.length; ei++) {
        var ep = eps[ei];
        if (ep.x + ow > L + 0.5 || ep.y + od > W + 0.5 || ep.z + box.h > H + 0.5) continue;

        // Check overlap with placed boxes
        var ok = true;
        for (var pi = 0; pi < placed.length; pi++) {
          var p = placed[pi];
          if (ep.x < p.x + p.w - 0.5 && ep.x + ow > p.x + 0.5 &&
              ep.y < p.y + p.d - 0.5 && ep.y + od > p.y + 0.5 &&
              ep.z < p.z + p.h - 0.5 && ep.z + box.h > p.z + 0.5) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        // Score: bottom → back → left
        var score = ep.z * 10000 + ep.x * 100 + ep.y;
        if (score < bestScore) {
          bestScore = score;
          best = ep;
          bestW = ow;
          bestD = od;
        }
      }
    }

    if (best) {
      var nb = assign({}, box, { x: best.x, y: best.y, z: best.z, w: bestW, d: bestD });
      placed.push(nb);

      // New extreme points
      eps.push({ x: best.x + bestW, y: best.y, z: best.z });
      eps.push({ x: best.x, y: best.y + bestD, z: best.z });
      eps.push({ x: best.x, y: best.y, z: best.z + box.h });

      // Remove used EP
      var epIdx = eps.indexOf(best);
      if (epIdx >= 0) eps.splice(epIdx, 1);

      // Purge EPs inside the new box
      eps = eps.filter(function (e) {
        return !(e.x >= nb.x && e.x < nb.x + nb.w &&
                 e.y >= nb.y && e.y < nb.y + nb.d &&
                 e.z >= nb.z && e.z < nb.z + nb.h);
      });
    } else {
      overflow.push(box);
    }
  }

  // Apply gravity settle on packed result
  placed = settleGravity(placed);

  // Update scene
  boxData = placed;
  buildBoxMeshes(placed);
  if (selIdx !== null) setSelected(selIdx);

  // Notify Flutter
  sendToFlutter('boxesRepacked', {
    placed:   placed.map(function (b) { return { id: b.id, x: b.x, y: b.y, z: b.z, w: b.w, d: b.d, h: b.h }; }),
    overflow: overflow.map(function (b) { return { id: b.id }; }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER LOOP — on-demand (GPU idle when nothing changes)
// ─────────────────────────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);
  controls.update(); // required for damping — fires 'change' if camera moves
  if (dirty) {
    renderer.render(scene, camera);
    dirty = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIZE
// ─────────────────────────────────────────────────────────────────────────────

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  markDirty();
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function sendToFlutter(type, payload) {
  try {
    if (window.FlutterBridge) {
      var msg = assign({ type: type }, payload);
      window.FlutterBridge.postMessage(JSON.stringify(msg));
    }
  } catch (e) { console.warn('Bridge error:', e); }
}

function hideLoading() {
  var el = document.getElementById('loading');
  if (el) el.classList.add('hidden');
}

function makeMesh(geo, mat) { return new THREE.Mesh(geo, mat); }

function addLine(x1, y1, z1, x2, y2, z2, mat) {
  var g = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x1, y1, z1),
    new THREE.Vector3(x2, y2, z2),
  ]);
  truckGroup.add(new THREE.Line(g, mat));
}

function disposeGroup(group) {
  while (group.children.length > 0) {
    var c = group.children[0];
    group.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) {
        for (var mi = 0; mi < c.material.length; mi++) c.material[mi].dispose();
      } else {
        c.material.dispose();
      }
    }
    // Recurse for sub-groups
    if (c.children && c.children.length > 0) disposeGroup(c);
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function assign(target) {
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    if (src) for (var k in src) { if (src.hasOwnProperty(k)) target[k] = src[k]; }
  }
  return target;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLUTTER BRIDGE — bidirectional API
// ─────────────────────────────────────────────────────────────────────────────

window.ThreeBridge = {

  loadScene: function (truckJson, boxesJson) {
    try {
      var t = typeof truckJson === 'string' ? JSON.parse(truckJson) : truckJson;
      var b = typeof boxesJson === 'string' ? JSON.parse(boxesJson) : boxesJson;
      buildTruck(t);
      // Settle gravity before rendering
      b = settleGravity(b);
      buildBoxMeshes(b);
      // Report settled positions back
      sendToFlutter('boxesSettled', {
        boxes: b.map(function (bx) { return { id: bx.id, x: bx.x, y: bx.y, z: bx.z }; }),
      });
    } catch (e) { console.error('loadScene:', e); }
  },

  updateBoxes: function (boxesJson) {
    try {
      var b = typeof boxesJson === 'string' ? JSON.parse(boxesJson) : boxesJson;
      b = settleGravity(b);
      buildBoxMeshes(b);
      if (selIdx !== null) setSelected(selIdx);
      sendToFlutter('boxesSettled', {
        boxes: b.map(function (bx) { return { id: bx.id, x: bx.x, y: bx.y, z: bx.z }; }),
      });
    } catch (e) { console.error('updateBoxes:', e); }
  },

  updateBoxPosition: function (index, x, y, z) {
    if (index < 0 || index >= meshes.length || !truck) return;
    var entry = meshes[index];
    var hL = truck.lengthCm * CM / 2;
    var hW = truck.widthCm  * CM / 2;
    var params = entry.mesh.geometry.parameters;
    var bwH = (params ? params.width  : 0.3) / 2;
    var bdH = (params ? params.depth  : 0.3) / 2;
    var bhH = (params ? params.height : 0.3) / 2;
    entry.mesh.position.set(
      x * CM - hL + bwH,
      z * CM + bhH,
      y * CM - hW + bdH
    );
    markDirty();
  },

  selectBox: function (index) {
    setSelected(index === null || index === undefined || index < 0 ? null : index);
  },

  setViewMode: function (mode) { setView(mode); },

  setColorMode: function (mode) { cMode = mode; applyColors(); },

  setCollisionState: function (index, hasCollision) { setCollision(index, hasCollision); },

  toggleWalls: function (visible) { animateWalls(visible); },

  highlightOverflow: function (orderNumbers) {
    var set = {};
    if (orderNumbers) {
      for (var k = 0; k < orderNumbers.length; k++) set[orderNumbers[k]] = true;
    }
    for (var i = 0; i < meshes.length; i++) {
      var m = meshes[i].mesh;
      if (set[meshes[i].data.orderNumber]) {
        m.material.opacity = 0.3;
        m.material.transparent = true;
      } else {
        m.material.opacity = 1;
        m.material.transparent = false;
      }
    }
    markDirty();
  },

  repack: function () { repackBoxes(); },

  settleGravityVisual: function () {
    if (boxData.length === 0) return;
    boxData = settleGravity(boxData);
    buildBoxMeshes(boxData);
    if (selIdx !== null) setSelected(selIdx);
    sendToFlutter('boxesSettled', {
      boxes: boxData.map(function (b) { return { id: b.id, x: b.x, y: b.y, z: b.z }; }),
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

init();

})();
