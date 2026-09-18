'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const extractor = require('../extract-runtime-matrix.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-runtime-matrix-'));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return root;
}

test('source imports only AST and filesystem modules, never product modules', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'backend', 'scripts', 'extract-runtime-matrix.cjs'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:\.\.\/app|\.\.\/server|.*config\/db|.*middleware\/auth|odbc|redis|node:net|node:child_process)['"]\)/);
  assert.doesNotMatch(source, /\b(?:import|require)\(['"]\.\.\/routes/);
});

test('rejects protected names and symlinks before any content read', () => {
  const root = fixture({ 'backend/app.js': "const app = express(); app.get('/ok', handler);", 'backend/routes/safe.js': "const router = express.Router(); router.get('/safe', handler);" });
  fs.writeFileSync(path.join(root, 'backend', 'routes', '.env.js'), 'CANARY');
  fs.writeFileSync(path.join(root, 'backend', 'routes', 'cline_mcp_settings.json'), 'CANARY');
  fs.writeFileSync(path.join(root, 'backend', 'routes', 'CREDENCIALES.md'), 'CANARY');
  const outside = path.join(root, 'outside.js'); fs.writeFileSync(outside, 'CANARY');
  fs.symlinkSync(outside, path.join(root, 'backend', 'routes', 'linked.js'));
  const originalRead = fs.readFileSync; const reads = [];
  fs.readFileSync = function spy(file, ...args) { reads.push(String(file)); return originalRead.call(this, file, ...args); };
  try { extractor.extractRuntimeMatrix({ repoRoot: root }); } finally { fs.readFileSync = originalRead; }
  assert.equal(reads.some((file) => /(?:\.env\.js|cline_mcp_settings\.json|CREDENCIALES\.md|linked\.js)$/i.test(file)), false);
});

test('rejects a symlinked root or ancestor before reading application content', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-runtime-root-'));
  const realRoot = path.join(parent, 'real');
  fs.mkdirSync(path.join(realRoot, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(realRoot, 'backend', 'app.js'), "const app = express(); app.get('/canary', handler);");
  const rootLink = path.join(parent, 'root-link'); fs.symlinkSync(realRoot, rootLink);
  const originalRead = fs.readFileSync; const reads = [];
  fs.readFileSync = function spy(file, ...args) { reads.push(String(file)); return originalRead.call(this, file, ...args); };
  try { assert.throws(() => extractor.extractRuntimeMatrix({ repoRoot: rootLink }), /APP_SOURCE_UNAVAILABLE/); } finally { fs.readFileSync = originalRead; }
  assert.deepEqual(reads, []);

  const ancestorLink = path.join(parent, 'ancestor-link'); fs.symlinkSync(realRoot, ancestorLink);
  fs.readFileSync = function spy(file, ...args) { reads.push(String(file)); return originalRead.call(this, file, ...args); };
  try { assert.throws(() => extractor.extractRuntimeMatrix({ repoRoot: ancestorLink }), /APP_SOURCE_UNAVAILABLE/); } finally { fs.readFileSync = originalRead; }
  assert.deepEqual(reads, []);
});

test('evaluates only supported flag expressions and preserves unknown conditions', () => {
  const root = fixture({
    'backend/app.js': "const app = express(); if (!USE_DDD_ROUTES) app.get('/legacy', h); else app.get('/ddd', h); if (USE_DDD_ROUTES && featureFlag) app.get('/unknown', h); if (USE_TS_ROUTES || featureFlag) app.get('/retired-or-unknown', h); if (featureFlag === 'CANARY_CONDITION') app.get('/opaque', h);",
  });
  const matrix = extractor.extractRuntimeMatrix({ repoRoot: root });
  const legacy = matrix.modes.legacy.declaredMounts;
  const ddd = matrix.modes.ddd.declaredMounts;
  assert.ok(legacy.some((route) => route.path === '/legacy'));
  assert.ok(!legacy.some((route) => route.path === '/ddd'));
  assert.ok(ddd.some((route) => route.path === '/ddd'));
  assert.ok(!ddd.some((route) => route.path === '/legacy'));
  assert.equal(ddd.find((route) => route.path === '/unknown').conditionUnknown, true);
  assert.equal(legacy.find((route) => route.path === '/retired-or-unknown').conditionUnknown, true);
  assert.equal(JSON.stringify(matrix).includes('CANARY_CONDITION'), false);
  assert.equal(legacy.find((route) => route.path === '/opaque').conditions[0].kind, 'unknown');
});

test('keeps handlers as references and resolves only static factories', () => {
  const root = fixture({
    'backend/app.js': "const app = express(); const adapters = require('./routes/adapters'); app.use('/api/items', adapters.createItemsRoutes()); app.get('/body', (req, res) => res.json({ private: 'never-output' })); app.get('setting');",
    'backend/routes/adapters.js': "const express = require('express'); function createItemsRoutes() { const router = express.Router(); router.head('/:id', handler); router.options('/:id', handler); return router; } module.exports = { createItemsRoutes };",
  });
  const matrix = extractor.extractRuntimeMatrix({ repoRoot: root });
  const body = matrix.modes.legacy.declaredMounts.find((route) => route.path === '/body');
  assert.deepEqual(body.handlers[0].kind, 'inline-function');
  assert.equal(JSON.stringify(matrix).includes('never-output'), false);
  assert.equal(matrix.modes.legacy.declaredMounts.some((route) => route.path === 'setting'), false);
  assert.deepEqual(matrix.modes.legacy.resolvedFactoryRoutes.map((route) => route.method), ['HEAD', 'OPTIONS']);
});

test('classifies literal, interpolation and multiline Flutter calls without echoing dynamic expressions', () => {
  const root = fixture({
    'backend/app.js': "const app = express();",
    'lib/a.dart': "ApiClient.get('/literal');\nApiClient.get('/customers/$id');\nApiClient.post(\n  '/multiline',\n  data: value,\n);\nApiClient.get(endpoint);",
  });
  const consumers = extractor.extractRuntimeMatrix({ repoRoot: root }).consumers.flutter;
  assert.ok(consumers.some((item) => item.path === '/literal' && item.resolution === 'literal'));
  assert.ok(consumers.some((item) => item.reason === 'string-interpolation' && item.resolution === 'dynamic'));
  assert.ok(consumers.some((item) => item.path === '/multiline' && item.resolution === 'literal'));
  assert.ok(consumers.some((item) => item.reason === 'first-argument-nonliteral' && item.resolution === 'dynamic'));
  assert.equal(JSON.stringify(consumers).includes('endpoint)'), false);
});

test('reports source order and overlap without declaring runtime observation', () => {
  const root = fixture({ 'backend/app.js': "const app = express(); app.use('/api/x', first); app.use('/api/x', second);" });
  const matrix = extractor.extractRuntimeMatrix({ repoRoot: root });
  assert.deepEqual(matrix.modes.legacy.declaredMounts.map((route) => route.order), [0, 1]);
  assert.equal(matrix.modes.legacy.potentialOverlaps[0].requiresContractReview, true);
  assert.equal(matrix.coverage.runtimeObserved, false);
});

test('real application inventory has supported modes, unresolved results and separate consumer sources', () => {
  const matrix = extractor.extractRuntimeMatrix({ repoRoot });
  assert.deepEqual(matrix.supportedModes, ['legacy', 'ddd']);
  assert.ok(matrix.modes.legacy.declaredMounts.length > 0);
  assert.ok(matrix.modes.ddd.declaredMounts.length > matrix.modes.legacy.declaredMounts.length);
  assert.ok(matrix.modes.ddd.unresolved.length > 0);
  assert.ok(matrix.modes.ddd.potentialOverlaps.some((item) => item.path === '/api/clients'));
  assert.ok(matrix.consumers.flutter.some((item) => item.path === '/chatbot/message'));
  assert.ok(matrix.consumers.openapi.length > 0);
});
