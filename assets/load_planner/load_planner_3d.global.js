(function() {
'use strict';
var THREE = window.THREE;
var OrbitControls = window.OrbitControls;
var CSS2DRenderer = window.CSS2DRenderer;
var CSS2DObject = window.CSS2DObject;

/**
 * Load Planner 3D — Premium Three.js Scene (Global build)
 *
 * Procedural box truck (cab, cargo, wheels, rear doors),
 * 3-point PBR lighting, gradient skybox environment,
 * animated selection glow, smooth wall transitions,
 * glassmorphism CSS2D labels, LOD fade,
 * Flutter bidirectional bridge.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

var COLORS = {
  background:       0x0A0E1A,
  groundColor:      0x080C14,
  floor:            0x151D2E,
  floorAccent:      0x1E293B,
  gridMinor:        0x00D4FF,
  gridMajor:        0x00D4FF,
  wallColor:        0x00B4D8,
  wallEdge:         0x00D4FF,
  edgeColor:        0x00D4FF,
  selectedEmissive: 0x00D4FF,
  collisionEmissive:0xFF3B5C,
  cabBodyColor:     0x2A3A5C,
  cabWindowColor:   0x4488CC,
  containerColor:   0x1E293B,
  containerEdge:    0x334155,
  wheelColor:       0x1A1A2E,
  wheelRimColor:    0x3A3A5C,
  rearDoorColor:    0x253348,
  rearMarker:       0x22C55E,
  mudguardColor:    0x15202E,
  fogColor:         0x0A0E1A,
  envTop:           0x1A2540,
  envBottom:        0x050810,
};

var BOX_PALETTE = [
  0xFF6B6B, 0x4ECDC4, 0x45B7D1, 0xFFA07A,
  0x98D8C8, 0xF06292, 0x81C784, 0xFFD54F,
  0x7986CB, 0xE57373, 0x66BB6A, 0x42A5F5,
  0xAB47BC, 0x26A69A, 0xFF7043, 0xFFA726,
];

var WEIGHT_GRADIENT = [
  { t: 0.0,  r: 0.18, g: 0.55, b: 0.95 },
  { t: 0.33, r: 0.13, g: 0.85, b: 0.45 },
  { t: 0.66, r: 0.95, g: 0.85, b: 0.15 },
  { t: 1.0,  r: 0.95, g: 0.22, b: 0.22 },
];

var DELIVERY_GRADIENT = [
  { t: 0.0, r: 0.13, g: 0.77, b: 0.37 },
  { t: 0.5, r: 0.95, g: 0.85, b: 0.15 },
  { t: 1.0, r: 0.95, g: 0.22, b: 0.22 },
];

var MAX_WEIGHT_KG = 30;
var CM_TO_M = 0.01;
var MAX_VISIBLE_LABELS = 30;
var SELECTION_PULSE_SPEED = 2.0;
var SELECTION_PULSE_INTENSITY = 0.15;
var WALL_ANIM_DURATION = 400;
var WALL_OPACITY = 0.06;

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

var scene, camera, renderer, css2dRenderer, controls;
var truckGroup, boxesGroup, wallsGroup, environmentGroup;
var raycaster, pointer;
var boxMeshes = [];
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
var wallMeshes = [];
var wallsVisible = true;
var clock = null;
var selectionTime = 0;

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

function init() {
  clock = new THREE.Clock();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.FogExp2(COLORS.fogColor, 0.055);

  camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(6, 5, 8);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = 'srgb';
  document.body.appendChild(renderer.domElement);

  css2dRenderer = new CSS2DRenderer();
  css2dRenderer.setSize(window.innerWidth, window.innerHeight);
  css2dRenderer.domElement.style.position = 'absolute';
  css2dRenderer.domElement.style.top = '0';
  css2dRenderer.domElement.style.left = '0';
  css2dRenderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(css2dRenderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1;
  controls.maxDistance = 30;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minPolarAngle = 0.05;
  controls.target.set(0, 0, 0);
  controls.update();

  setupLights();
  setupEnvironment();

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  truckGroup = new THREE.Group();
  boxesGroup = new THREE.Group();
  wallsGroup = new THREE.Group();
  scene.add(truckGroup);
  scene.add(boxesGroup);

  dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('resize', onResize);

  animate();

  document.getElementById('loading').classList.add('hidden');
  window._sceneInitDone = true;
  sendToFlutter('sceneReady', {});
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIGHTING — Premium 3-Point + Environment
// ═══════════════════════════════════════════════════════════════════════════════

function setupLights() {
  // Soft ambient (SSAO-like)
  var ambient = new THREE.AmbientLight(0x6070A0, 0.35);
  scene.add(ambient);

  // Hemisphere — sky/ground bounce
  var hemi = new THREE.HemisphereLight(0x5580BB, 0x101830, 0.45);
  hemi.position.set(0, 20, 0);
  scene.add(hemi);

  // KEY light (warm white, strong shadows)
  var keyLight = new THREE.DirectionalLight(0xFFF5E8, 1.0);
  keyLight.position.set(6, 10, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 40;
  keyLight.shadow.camera.left = -12;
  keyLight.shadow.camera.right = 12;
  keyLight.shadow.camera.top = 12;
  keyLight.shadow.camera.bottom = -12;
  keyLight.shadow.bias = -0.0003;
  if (keyLight.shadow.normalBias !== undefined) keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  // FILL light (cooler, opposite side)
  var fillLight = new THREE.DirectionalLight(0x8AADD4, 0.4);
  fillLight.position.set(-5, 6, -3);
  scene.add(fillLight);

  // RIM light (neon accent)
  var rimLight = new THREE.PointLight(0x00D4FF, 0.5, 25);
  rimLight.position.set(-4, 7, -5);
  scene.add(rimLight);

  // Subtle warm accent from front
  var frontAccent = new THREE.PointLight(0xFFAA44, 0.15, 15);
  frontAccent.position.set(0, 3, 8);
  scene.add(frontAccent);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT — Ground, Grid, Gradient Skybox
// ═══════════════════════════════════════════════════════════════════════════════

function setupEnvironment() {
  environmentGroup = new THREE.Group();
  scene.add(environmentGroup);

  // Infinite ground plane
  var groundGeo = new THREE.PlaneGeometry(200, 200);
  var groundMat = new THREE.MeshStandardMaterial({
    color: COLORS.groundColor,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  var ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  environmentGroup.add(ground);

  // Subtle world grid
  var gridSize = 40;
  var gridStep = 2.0;
  var gridMat = new THREE.LineBasicMaterial({
    color: COLORS.gridMinor,
    opacity: 0.025,
    transparent: true,
  });
  var x, z;
  for (x = -gridSize; x <= gridSize; x += gridStep) {
    var geo1 = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.001, -gridSize),
      new THREE.Vector3(x, 0.001, gridSize),
    ]);
    environmentGroup.add(new THREE.Line(geo1, gridMat));
  }
  for (z = -gridSize; z <= gridSize; z += gridStep) {
    var geo2 = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-gridSize, 0.001, z),
      new THREE.Vector3(gridSize, 0.001, z),
    ]);
    environmentGroup.add(new THREE.Line(geo2, gridMat));
  }

  // Procedural gradient skybox
  var skyGeo = new THREE.SphereGeometry(80, 32, 16);
  var skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor:    { value: new THREE.Color(COLORS.envTop) },
      bottomColor: { value: new THREE.Color(COLORS.envBottom) },
      offset:      { value: 10 },
      exponent:    { value: 0.8 },
    },
    vertexShader: [
      'varying vec3 vWorldPosition;',
      'void main() {',
      '  vec4 worldPos = modelMatrix * vec4(position, 1.0);',
      '  vWorldPosition = worldPos.xyz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 topColor;',
      'uniform vec3 bottomColor;',
      'uniform float offset;',
      'uniform float exponent;',
      'varying vec3 vWorldPosition;',
      'void main() {',
      '  float h = normalize(vWorldPosition + offset).y;',
      '  gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);',
      '}'
    ].join('\n'),
    side: THREE.BackSide,
    depthWrite: false,
  });
  var sky = new THREE.Mesh(skyGeo, skyMat);
  environmentGroup.add(sky);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRUCK MODEL — Procedural Box Truck
// ═══════════════════════════════════════════════════════════════════════════════

function buildTruck(dims) {
  truckGroup.clear();
  wallMeshes = [];
  truckDims = dims;

  var L = dims.lengthCm * CM_TO_M;
  var W = dims.widthCm * CM_TO_M;
  var H = dims.heightCm * CM_TO_M;
  var halfL = L / 2;
  var halfW = W / 2;

  buildCargoContainer(L, W, H, halfL, halfW);
  buildCab(L, W, H, halfL, halfW);
  buildWheels(L, W, H, halfL, halfW);
  buildRearDoor(L, W, H, halfL, halfW);

  // Dimension labels
  addDimLabel(L.toFixed(1) + 'm', new THREE.Vector3(0, -0.2, halfW + 0.25));
  addDimLabel(W.toFixed(1) + 'm', new THREE.Vector3(halfL + 0.25, -0.2, 0));
  addDimLabel(H.toFixed(1) + 'm', new THREE.Vector3(halfL + 0.25, H / 2, halfW + 0.25));

  // Camera framing
  var maxDim = Math.max(L, W, H);
  camera.position.set(L * 0.9, maxDim * 1.1, W * 1.5);
  controls.target.set(0, H * 0.35, 0);
  controls.update();

  // Shadow camera
  var shadowCam = null;
  for (var ci = 0; ci < scene.children.length; ci++) {
    if (scene.children[ci].isDirectionalLight && scene.children[ci].castShadow) {
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

function buildCargoContainer(L, W, H, halfL, halfW) {
  var WT = 0.035; // wall thickness

  // Floor slab
  var floorGeo = new THREE.BoxGeometry(L + 0.02, WT, W + 0.02);
  var floorMat = new THREE.MeshStandardMaterial({
    color: COLORS.floor, roughness: 0.85, metalness: 0.05,
  });
  var floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.set(0, -WT / 2 + 0.001, 0);
  floor.receiveShadow = true;
  floor.castShadow = true;
  floor.name = 'truck-floor';
  truckGroup.add(floor);

  // Floor detail grid
  var gridGroup = new THREE.Group();
  var minorStep = 0.5;
  var minorMat = new THREE.LineBasicMaterial({ color: COLORS.gridMinor, opacity: 0.07, transparent: true });
  var xi, zi;
  for (xi = -halfL; xi <= halfL + 0.001; xi += minorStep) {
    gridGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xi, 0.003, -halfW),
        new THREE.Vector3(xi, 0.003, halfW),
      ]), minorMat));
  }
  for (zi = -halfW; zi <= halfW + 0.001; zi += minorStep) {
    gridGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-halfL, 0.003, zi),
        new THREE.Vector3(halfL, 0.003, zi),
      ]), minorMat));
  }
  var majorStep = 1.0;
  var majorMat = new THREE.LineBasicMaterial({ color: COLORS.gridMajor, opacity: 0.14, transparent: true });
  for (xi = -halfL; xi <= halfL + 0.001; xi += majorStep) {
    gridGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xi, 0.004, -halfW),
        new THREE.Vector3(xi, 0.004, halfW),
      ]), majorMat));
  }
  for (zi = -halfW; zi <= halfW + 0.001; zi += majorStep) {
    gridGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-halfL, 0.004, zi),
        new THREE.Vector3(halfL, 0.004, zi),
      ]), majorMat));
  }
  truckGroup.add(gridGroup);

  // Walls (semi-transparent with thickness)
  var wallMat = new THREE.MeshStandardMaterial({
    color: COLORS.wallColor,
    transparent: true,
    opacity: WALL_OPACITY,
    side: THREE.DoubleSide,
    roughness: 0.3,
    metalness: 0.2,
    depthWrite: false,
  });

  // Back wall (cab end)
  var backWall = new THREE.Mesh(new THREE.BoxGeometry(WT, H, W), wallMat.clone());
  backWall.position.set(-halfL - WT / 2, H / 2, 0);
  backWall.castShadow = true;
  truckGroup.add(backWall);
  wallMeshes.push(backWall);

  // Left wall
  var leftWall = new THREE.Mesh(new THREE.BoxGeometry(L + WT * 2, H, WT), wallMat.clone());
  leftWall.position.set(0, H / 2, -halfW - WT / 2);
  leftWall.castShadow = true;
  truckGroup.add(leftWall);
  wallMeshes.push(leftWall);

  // Right wall
  var rightWall = new THREE.Mesh(new THREE.BoxGeometry(L + WT * 2, H, WT), wallMat.clone());
  rightWall.position.set(0, H / 2, halfW + WT / 2);
  rightWall.castShadow = true;
  truckGroup.add(rightWall);
  wallMeshes.push(rightWall);

  // Ceiling
  var ceilingMat = wallMat.clone();
  ceilingMat.opacity = 0.03;
  var ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(L + WT * 2, WT, W + WT * 2),
    ceilingMat
  );
  ceiling.position.set(0, H + WT / 2, 0);
  truckGroup.add(ceiling);
  wallMeshes.push(ceiling);

  // Edge wireframe (neon glow)
  var edgeMat = new THREE.LineBasicMaterial({ color: COLORS.edgeColor, opacity: 0.4, transparent: true });
  var edgeGeo = new THREE.BoxGeometry(L, H, W);
  var edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(edgeGeo), edgeMat);
  edgeLines.position.set(0, H / 2, 0);
  truckGroup.add(edgeLines);

  // Bottom frame rails
  var railMat = new THREE.MeshStandardMaterial({ color: 0x15202E, roughness: 0.7, metalness: 0.3 });
  var railH = 0.08, railW2 = 0.04;
  var leftRail = new THREE.Mesh(new THREE.BoxGeometry(L + 0.2, railH, railW2), railMat);
  leftRail.position.set(0, -railH / 2 - 0.02, -halfW + 0.1);
  leftRail.castShadow = true;
  truckGroup.add(leftRail);
  var rightRail = new THREE.Mesh(new THREE.BoxGeometry(L + 0.2, railH, railW2), railMat);
  rightRail.position.set(0, -railH / 2 - 0.02, halfW - 0.1);
  rightRail.castShadow = true;
  truckGroup.add(rightRail);

  // Cross members
  var crossCount = Math.max(2, Math.floor(L / 0.8));
  for (var ci = 0; ci < crossCount; ci++) {
    var cx = -halfL + (L / (crossCount - 1)) * ci;
    var cross = new THREE.Mesh(new THREE.BoxGeometry(railW2, railH * 0.6, W - 0.1), railMat);
    cross.position.set(cx, -railH / 2 - 0.02, 0);
    truckGroup.add(cross);
  }
}

function buildCab(L, W, H, halfL, halfW) {
  var cabL = Math.min(W * 0.7, 1.5);
  var cabH = H * 0.75;
  var cabW = W + 0.08;

  // Body
  var cabBodyMat = new THREE.MeshStandardMaterial({
    color: COLORS.cabBodyColor, roughness: 0.4, metalness: 0.3,
  });
  var cabBody = new THREE.Mesh(new THREE.BoxGeometry(cabL, cabH, cabW), cabBodyMat);
  cabBody.position.set(-halfL - cabL / 2 - 0.04, cabH / 2, 0);
  cabBody.castShadow = true;
  cabBody.receiveShadow = true;
  truckGroup.add(cabBody);

  // Windshield
  var windshieldH = cabH * 0.5;
  var windshieldW = cabW - 0.15;
  var windshieldMat = new THREE.MeshStandardMaterial({
    color: COLORS.cabWindowColor, transparent: true, opacity: 0.35,
    roughness: 0.1, metalness: 0.5, side: THREE.DoubleSide,
  });
  var windshield = new THREE.Mesh(new THREE.PlaneGeometry(windshieldW, windshieldH), windshieldMat);
  windshield.position.set(-halfL - cabL - 0.04, cabH * 0.6, 0);
  windshield.rotation.y = Math.PI / 2;
  windshield.rotation.x = -0.15;
  truckGroup.add(windshield);

  // Side windows
  var sideWindowGeo = new THREE.PlaneGeometry(cabL * 0.5, windshieldH * 0.7);
  var sideWindowMat = windshieldMat.clone();
  sideWindowMat.opacity = 0.25;
  var leftWindow = new THREE.Mesh(sideWindowGeo, sideWindowMat);
  leftWindow.position.set(-halfL - cabL * 0.5 - 0.04, cabH * 0.58, -cabW / 2 - 0.01);
  truckGroup.add(leftWindow);
  var rightWindow = new THREE.Mesh(sideWindowGeo, sideWindowMat);
  rightWindow.position.set(-halfL - cabL * 0.5 - 0.04, cabH * 0.58, cabW / 2 + 0.01);
  truckGroup.add(rightWindow);

  // Headlights
  var headlightGeo = new THREE.CircleGeometry(0.06, 16);
  var headlightMat = new THREE.MeshStandardMaterial({
    color: 0xFFFFCC, emissive: 0xFFFFCC, emissiveIntensity: 0.5, roughness: 0.1,
  });
  var hlLeft = new THREE.Mesh(headlightGeo, headlightMat);
  hlLeft.position.set(-halfL - cabL - 0.045, cabH * 0.3, -cabW / 2 + 0.2);
  hlLeft.rotation.y = Math.PI / 2;
  truckGroup.add(hlLeft);
  var hlRight = new THREE.Mesh(headlightGeo, headlightMat);
  hlRight.position.set(-halfL - cabL - 0.045, cabH * 0.3, cabW / 2 - 0.2);
  hlRight.rotation.y = Math.PI / 2;
  truckGroup.add(hlRight);

  // Bumper
  var bumperMat = new THREE.MeshStandardMaterial({ color: 0x1A1A2E, roughness: 0.7, metalness: 0.4 });
  var bumper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, cabW + 0.05), bumperMat);
  bumper.position.set(-halfL - cabL - 0.08, 0.12, 0);
  bumper.castShadow = true;
  truckGroup.add(bumper);

  // Roof
  var roofMat = new THREE.MeshStandardMaterial({ color: 0x2A3A5C, roughness: 0.5, metalness: 0.2 });
  var roof = new THREE.Mesh(new THREE.BoxGeometry(cabL + 0.02, 0.04, cabW + 0.04), roofMat);
  roof.position.set(-halfL - cabL / 2 - 0.04, cabH + 0.02, 0);
  roof.castShadow = true;
  truckGroup.add(roof);
}

function buildWheels(L, W, H, halfL, halfW) {
  var wheelRadius = 0.18;
  var wheelWidth = 0.12;
  var cabL = Math.min(W * 0.7, 1.5);
  var hubGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 24);
  var tireMat = new THREE.MeshStandardMaterial({ color: COLORS.wheelColor, roughness: 0.9, metalness: 0.0 });
  var rimMat = new THREE.MeshStandardMaterial({ color: COLORS.wheelRimColor, roughness: 0.3, metalness: 0.6 });
  var rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.5, wheelRadius * 0.5, wheelWidth + 0.02, 16);

  var wheelPositions = [
    { x: halfL * 0.7, z: -halfW - 0.06 },
    { x: halfL * 0.7, z: halfW + 0.06 },
    { x: -halfL - cabL * 0.6, z: -halfW - 0.06 },
    { x: -halfL - cabL * 0.6, z: halfW + 0.06 },
  ];

  var mudMat = new THREE.MeshStandardMaterial({ color: COLORS.mudguardColor, roughness: 0.7, metalness: 0.2 });

  for (var wi = 0; wi < wheelPositions.length; wi++) {
    var pos = wheelPositions[wi];
    var tire = new THREE.Mesh(hubGeo, tireMat);
    tire.rotation.x = Math.PI / 2;
    tire.position.set(pos.x, wheelRadius * 0.8, pos.z);
    tire.castShadow = true;
    truckGroup.add(tire);

    var rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(pos.x, wheelRadius * 0.8, pos.z);
    truckGroup.add(rim);

    // Mudguard
    var archGeo = new THREE.BoxGeometry(wheelRadius * 2.5, 0.03, wheelWidth + 0.06);
    var arch = new THREE.Mesh(archGeo, mudMat);
    arch.position.set(pos.x, wheelRadius * 1.65, pos.z);
    arch.castShadow = true;
    truckGroup.add(arch);
  }
}

function buildRearDoor(L, W, H, halfL, halfW) {
  var frameMat = new THREE.MeshStandardMaterial({
    color: COLORS.rearDoorColor, roughness: 0.6, metalness: 0.2,
  });

  var doorW = W / 2 - 0.02;
  var doorGeo = new THREE.BoxGeometry(0.02, H - 0.04, doorW);

  var leftDoor = new THREE.Mesh(doorGeo, frameMat);
  leftDoor.position.set(halfL + 0.01, H / 2, -doorW / 2 - 0.01);
  leftDoor.castShadow = true;
  truckGroup.add(leftDoor);
  wallMeshes.push(leftDoor);

  var rightDoor = new THREE.Mesh(doorGeo, frameMat);
  rightDoor.position.set(halfL + 0.01, H / 2, doorW / 2 + 0.01);
  rightDoor.castShadow = true;
  truckGroup.add(rightDoor);
  wallMeshes.push(rightDoor);

  // Hinges
  var hingeMat = new THREE.MeshStandardMaterial({ color: 0x3A4A6C, roughness: 0.5, metalness: 0.5 });
  var hingeGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.1, 8);
  var hPcts = [0.15, 0.5, 0.85];
  for (var hi = 0; hi < hPcts.length; hi++) {
    var hl = new THREE.Mesh(hingeGeo, hingeMat);
    hl.position.set(halfL + 0.02, H * hPcts[hi], -halfW + 0.01);
    truckGroup.add(hl);
    var hr = new THREE.Mesh(hingeGeo, hingeMat);
    hr.position.set(halfL + 0.02, H * hPcts[hi], halfW - 0.01);
    truckGroup.add(hr);
  }

  // Latch bars
  var latchMat = new THREE.MeshStandardMaterial({ color: 0x4A5A7C, roughness: 0.4, metalness: 0.6 });
  var latchGeo = new THREE.CylinderGeometry(0.01, 0.01, H * 0.6, 8);
  var latchL = new THREE.Mesh(latchGeo, latchMat);
  latchL.position.set(halfL + 0.025, H * 0.5, -0.02);
  truckGroup.add(latchL);
  var latchR = new THREE.Mesh(latchGeo, latchMat);
  latchR.position.set(halfL + 0.025, H * 0.5, 0.02);
  truckGroup.add(latchR);

  // Rear marker lights
  var markerMat = new THREE.MeshStandardMaterial({
    color: COLORS.rearMarker, emissive: COLORS.rearMarker, emissiveIntensity: 0.3, roughness: 0.2,
  });
  var markerGeo = new THREE.CircleGeometry(0.03, 12);
  var mlLeft = new THREE.Mesh(markerGeo, markerMat);
  mlLeft.position.set(halfL + 0.022, H * 0.1, -halfW + 0.08);
  mlLeft.rotation.y = -Math.PI / 2;
  truckGroup.add(mlLeft);
  var mlRight = new THREE.Mesh(markerGeo, markerMat);
  mlRight.position.set(halfL + 0.022, H * 0.1, halfW - 0.08);
  mlRight.rotation.y = -Math.PI / 2;
  truckGroup.add(mlRight);
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
// BOX RENDERING — PBR + AO + Glassmorphism Labels
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
    var bw = b.w * CM_TO_M;
    var bd = b.d * CM_TO_M;
    var bh = b.h * CM_TO_M;

    var geo = new THREE.BoxGeometry(bw, bh, bd, 2, 2, 2);
    var color = getBoxColor(b, i);
    var mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.35,
      metalness: 0.08,
      transparent: false,
    });

    var mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    var px = b.x * CM_TO_M - halfL + bw / 2;
    var py = b.z * CM_TO_M + bh / 2;
    var pz = b.y * CM_TO_M - halfW + bd / 2;
    mesh.position.set(px, py, pz);
    mesh.userData = { boxIndex: i, baseScale: 1.0 };
    boxesGroup.add(mesh);

    // Edges
    var edgeMat = new THREE.LineBasicMaterial({ color: 0xFFFFFF, opacity: 0.18, transparent: true });
    var edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(bw, bh, bd)), edgeMat);
    edges.position.copy(mesh.position);
    boxesGroup.add(edges);

    // AO darkening
    var aoGeo = new THREE.PlaneGeometry(bw * 0.92, bd * 0.92);
    var aoMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide,
    });
    var aoPlane = new THREE.Mesh(aoGeo, aoMat);
    aoPlane.rotation.x = -Math.PI / 2;
    aoPlane.position.set(px, py + bh / 2 + 0.001, pz);
    boxesGroup.add(aoPlane);

    // Glassmorphism label
    var labelDiv = document.createElement('div');
    labelDiv.className = 'box-label';
    labelDiv.innerHTML = '<span class="box-label-text">' + truncate(b.label, 16) + '</span><span class="box-label-weight">' + b.weight.toFixed(1) + 'kg</span>';
    var label = new CSS2DObject(labelDiv);
    label.position.set(0, bh / 2 + 0.05, 0);
    mesh.add(label);

    boxMeshes.push({ mesh: mesh, edges: edges, label: label, labelDiv: labelDiv, aoPlane: aoPlane, data: b });
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
      return deliveryToColor(box.deliveryOrder, boxesData.length);
    case 'product':
    default:
      return BOX_PALETTE[hashCode(box.articleCode) % BOX_PALETTE.length];
  }
}

function weightToColor(weight) {
  var t = Math.min(weight / MAX_WEIGHT_KG, 1.0);
  return gradientColor(WEIGHT_GRADIENT, t);
}

function deliveryToColor(order, total) {
  if (!order || !total || total <= 1) return new THREE.Color(0x4ECDC4);
  var t = Math.min((order - 1) / (total - 1), 1.0);
  return gradientColor(DELIVERY_GRADIENT, t);
}

function gradientColor(gradient, t) {
  var r, g, b;
  for (var i = 0; i < gradient.length - 1; i++) {
    var a = gradient[i];
    var c = gradient[i + 1];
    if (t >= a.t && t <= c.t) {
      var f = (t - a.t) / (c.t - a.t);
      r = a.r + (c.r - a.r) * f;
      g = a.g + (c.g - a.g) * f;
      b = a.b + (c.b - a.b) * f;
      return new THREE.Color(r, g, b);
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
  return str.length > maxLen ? str.substring(0, maxLen - 1) + '\u2026' : str;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECTION & VISUAL STATES — Animated Glow
// ═══════════════════════════════════════════════════════════════════════════════

function setSelected(index) {
  selectedIndex = index;
  selectionTime = 0;

  for (var i = 0; i < boxMeshes.length; i++) {
    var entry = boxMeshes[i];
    var isSelected = (i === index);

    if (isSelected) {
      entry.mesh.material.emissive = new THREE.Color(COLORS.selectedEmissive);
      entry.mesh.material.emissiveIntensity = 0.5;
      entry.edges.material.color = new THREE.Color(COLORS.selectedEmissive);
      entry.edges.material.opacity = 0.9;
      // Update label style
      entry.labelDiv.classList.add('selected-label');
    } else {
      entry.mesh.material.emissive = new THREE.Color(0x000000);
      entry.mesh.material.emissiveIntensity = 0;
      entry.edges.material.color = new THREE.Color(0xFFFFFF);
      entry.edges.material.opacity = 0.18;
      entry.mesh.scale.set(1, 1, 1);
      entry.labelDiv.classList.remove('selected-label');
    }
  }
}

function setCollisionState(index, hasCollision) {
  if (index < 0 || index >= boxMeshes.length) return;
  var entry = boxMeshes[index];

  if (hasCollision) {
    entry.mesh.material.emissive = new THREE.Color(COLORS.collisionEmissive);
    entry.mesh.material.emissiveIntensity = 0.7;
    entry.edges.material.color = new THREE.Color(COLORS.collisionEmissive);
    entry.edges.material.opacity = 1.0;
  } else if (index === selectedIndex) {
    entry.mesh.material.emissive = new THREE.Color(COLORS.selectedEmissive);
    entry.mesh.material.emissiveIntensity = 0.5;
    entry.edges.material.color = new THREE.Color(COLORS.selectedEmissive);
    entry.edges.material.opacity = 0.9;
  } else {
    entry.mesh.material.emissive = new THREE.Color(0x000000);
    entry.mesh.material.emissiveIntensity = 0;
    entry.edges.material.color = new THREE.Color(0xFFFFFF);
    entry.edges.material.opacity = 0.18;
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
// LABEL LOD — Smooth Opacity Fade
// ═══════════════════════════════════════════════════════════════════════════════

function updateLabelVisibility() {
  if (!camera) return;

  for (var i = 0; i < boxMeshes.length; i++) {
    var entry = boxMeshes[i];
    var dist = camera.position.distanceTo(entry.mesh.position);
    var params = entry.mesh.geometry.parameters;
    var size = params ? Math.max(params.width || 0.3, params.depth || 0.3) : 0.3;
    var screenSize = (size / dist) * window.innerHeight * 0.5;

    if (screenSize < 15) {
      entry.labelDiv.style.opacity = '0';
    } else if (screenSize < 30) {
      entry.labelDiv.style.opacity = String(((screenSize - 15) / 15).toFixed(2));
    } else {
      entry.labelDiv.style.opacity = '1';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WALL TOGGLE — Animated Opacity
// ═══════════════════════════════════════════════════════════════════════════════

function animateWallToggle(visible) {
  wallsVisible = visible;
  var target = visible ? WALL_OPACITY : 0.0;
  var startOpacities = [];
  for (var i = 0; i < wallMeshes.length; i++) {
    startOpacities.push(wallMeshes[i].material.opacity);
  }
  var startTime = performance.now();

  function step(now) {
    var t = Math.min((now - startTime) / WALL_ANIM_DURATION, 1.0);
    var ease = 1 - Math.pow(1 - t, 3);

    for (var j = 0; j < wallMeshes.length; j++) {
      wallMeshes[j].material.opacity = startOpacities[j] + (target - startOpacities[j]) * ease;
      wallMeshes[j].material.transparent = true;
      wallMeshes[j].visible = wallMeshes[j].material.opacity > 0.001;
    }
    if (t < 1.0) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA PRESETS — Smooth Sine Easing
// ═══════════════════════════════════════════════════════════════════════════════

function setViewMode(mode) {
  if (!truckDims) return;

  var L = truckDims.lengthCm * CM_TO_M;
  var W = truckDims.widthCm * CM_TO_M;
  var H = truckDims.heightCm * CM_TO_M;
  var maxDim = Math.max(L, W, H);

  var duration = 800;
  var startPos = camera.position.clone();
  var startTarget = controls.target.clone();
  var endPos, endTarget;

  switch (mode) {
    case 'top':
      endPos = new THREE.Vector3(0, maxDim * 2.2, 0.001);
      endTarget = new THREE.Vector3(0, 0, 0);
      break;
    case 'front':
      endPos = new THREE.Vector3(0, H * 0.5, maxDim * 2.2);
      endTarget = new THREE.Vector3(0, H * 0.35, 0);
      break;
    case 'perspective':
    default:
      endPos = new THREE.Vector3(L * 0.9, maxDim * 1.1, W * 1.5);
      endTarget = new THREE.Vector3(0, H * 0.35, 0);
      break;
  }

  var startTime = performance.now();
  function step(now) {
    var t = Math.min((now - startTime) / duration, 1.0);
    var ease = -(Math.cos(Math.PI * t) - 1) / 2;

    camera.position.lerpVectors(startPos, endPos, ease);
    controls.target.lerpVectors(startTarget, endTarget, ease);
    controls.update();

    if (t < 1.0) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ═══════════════════════════════════════════════════════════════════════════════
// POINTER EVENTS (tap, long-press drag, orbit)
// ═══════════════════════════════════════════════════════════════════════════════

function getPointerNDC(event) {
  var rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
}

function onPointerDown(event) {
  if (event.pointerType === 'touch' && event.isPrimary === false) return;

  pointerDownTime = performance.now();
  pointerDownPos = { x: event.clientX, y: event.clientY };
  pointer.copy(getPointerNDC(event));

  raycaster.setFromCamera(pointer, camera);
  var meshes = [];
  for (var i = 0; i < boxMeshes.length; i++) meshes.push(boxMeshes[i].mesh);
  var intersects = raycaster.intersectObjects(meshes);

  if (intersects.length > 0) {
    dragIndex = intersects[0].object.userData.boxIndex;
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
      var mesh = boxMeshes[dragIndex].mesh;

      if (truckDims) {
        var halfL = truckDims.lengthCm * CM_TO_M / 2;
        var halfW = truckDims.widthCm * CM_TO_M / 2;
        var params = mesh.geometry.parameters;
        var bwHalf = (params ? params.width : 0.3) / 2;
        var bdHalf = (params ? params.depth : 0.3) / 2;

        newPos.x = Math.max(-halfL + bwHalf, Math.min(halfL - bwHalf, newPos.x));
        newPos.z = Math.max(-halfW + bdHalf, Math.min(halfW - bdHalf, newPos.z));
      }

      mesh.position.x = newPos.x;
      mesh.position.z = newPos.z;
      boxMeshes[dragIndex].edges.position.x = newPos.x;
      boxMeshes[dragIndex].edges.position.z = newPos.z;
      if (boxMeshes[dragIndex].aoPlane) {
        boxMeshes[dragIndex].aoPlane.position.x = newPos.x;
        boxMeshes[dragIndex].aoPlane.position.z = newPos.z;
      }

      var halfL2 = truckDims.lengthCm * CM_TO_M / 2;
      var halfW2 = truckDims.widthCm * CM_TO_M / 2;
      var params2 = mesh.geometry.parameters;
      var bwHalf2 = (params2 ? params2.width : 0.3) / 2;
      var bdHalf2 = (params2 ? params2.depth : 0.3) / 2;
      var dataX = (newPos.x + halfL2 - bwHalf2) / CM_TO_M;
      var dataY = (newPos.z + halfW2 - bdHalf2) / CM_TO_M;

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
    var params = mesh.geometry.parameters;
    var bwHalf = (params ? params.width : 0.3) / 2;
    var bdHalf = (params ? params.depth : 0.3) / 2;
    var dataX = (mesh.position.x + halfL - bwHalf) / CM_TO_M;
    var dataY = (mesh.position.z + halfW - bdHalf) / CM_TO_M;

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
// ANIMATION LOOP — Selection Pulse
// ═══════════════════════════════════════════════════════════════════════════════

function animate() {
  animationId = requestAnimationFrame(animate);

  var delta = clock.getDelta();
  controls.update();

  // Selection pulse
  if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < boxMeshes.length) {
    selectionTime += delta * SELECTION_PULSE_SPEED;
    var pulse = Math.sin(selectionTime * Math.PI) * SELECTION_PULSE_INTENSITY;
    var entry = boxMeshes[selectedIndex];
    var s = 1.0 + Math.abs(pulse) * 0.03;
    entry.mesh.scale.set(s, s, s);
    entry.mesh.material.emissiveIntensity = 0.4 + Math.abs(pulse) * 0.3;
  }

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
    var params = entry.mesh.geometry.parameters;
    var bwHalf = (params ? params.width : 0.3) / 2;
    var bdHalf = (params ? params.depth : 0.3) / 2;
    var bhHalf = (params ? params.height : 0.3) / 2;

    var px = x * CM_TO_M - halfL + bwHalf;
    var py = z * CM_TO_M + bhHalf;
    var pz = y * CM_TO_M - halfW + bdHalf;

    entry.mesh.position.set(px, py, pz);
    entry.edges.position.set(px, py, pz);
    if (entry.aoPlane) entry.aoPlane.position.set(px, py + bhHalf + 0.001, pz);
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
    animateWallToggle(visible);
  },

  highlightOverflow: function(orderNumbers) {
    var overflowSet = {};
    if (orderNumbers) {
      for (var k = 0; k < orderNumbers.length; k++) overflowSet[orderNumbers[k]] = true;
    }
    for (var i = 0; i < boxMeshes.length; i++) {
      var mesh = boxMeshes[i].mesh;
      var isOverflow = !!overflowSet[boxMeshes[i].data.orderNumber];
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

})();
