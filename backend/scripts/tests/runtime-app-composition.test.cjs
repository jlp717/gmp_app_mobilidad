'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createHarness, loadComposedApp } = require('../runtime-app-composition-harness.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function labelOf(labels, value) {
  return labels.get(value) || value?.name || null;
}

function hasMount(snapshot, prefix, expectedLabels) {
  return snapshot.rootMounts.find((entry) => entry.kind === 'use'
    && entry.args[0] === prefix
    && expectedLabels.every((label, index) => labelOf(snapshot.labels, entry.args[index + 1]) === label));
}

function mountIndex(snapshot, predicate) {
  return snapshot.rootMounts.findIndex(predicate);
}

test('DDD composition registers canonical guards, DDD auth fallback and exclusive DDD domains', { concurrency: false }, () => {
  const composed = loadComposedApp({ repoRoot, mode: 'ddd' });
  {
    const snapshot = composed;
    const finance = hasMount(snapshot, '/api/repartidor-finanzas', ['verifyToken', 'repartoFinanzasWriteGuard', 'invalidationMiddleware', 'canonicalRepartidorFinanzasRoutes']);
    assert.ok(finance, 'canonical finance mount must retain verifyToken and its labelled router');
    const financeMounts = snapshot.rootMounts.filter((entry) => entry.kind === 'use' && entry.args[0] === '/api/repartidor-finanzas');
    assert.equal(financeMounts.length, 1);
    assert.ok(hasMount(snapshot, '/api/repartidor', ['verifyToken', 'repartoFamilyWriteGuard']));
    assert.ok(hasMount(snapshot, '/api/entregas', ['verifyToken', 'repartoWriteGuard']));
    assert.deepEqual(snapshot.factoryCalls, [
      'createAuthRoutes', 'createPedidosRoutes', 'createCobrosRoutes', 'createClientsRoutes', 'createCommissionsRoutes',
    ]);
    assert.equal(snapshot.setterCalls.length, 2);
    assert.ok(hasMount(snapshot, '/api/auth', ['dddAuthRoutes']));
    const authMounts = snapshot.rootMounts.filter((entry) => entry.kind === 'use' && entry.args[0] === '/api/auth');
    assert.equal(labelOf(snapshot.labels, authMounts[0].args[1]), 'dddAuthRoutes');
    assert.equal(labelOf(snapshot.labels, authMounts[1].args[1]), 'authRoutes');
    assert.ok(hasMount(snapshot, '/api/pedidos', ['pedidosLimiter', 'dddPedidosRoutes']));
    assert.ok(hasMount(snapshot, '/api/cobros', ['cobrosLimiter', 'dddCobrosRoutes']));
    assert.equal(hasMount(snapshot, '/api/pedidos', ['pedidosLimiter', 'pedidosRoutes']), undefined);
    assert.equal(hasMount(snapshot, '/api/cobros', ['cobrosLimiter', 'cobrosRoutes']), undefined);
    assert.ok(hasMount(snapshot, '/api/clients', ['dddClientsRoutes']));
    assert.ok(hasMount(snapshot, '/api/clients', ['clientsRoutes']));
    assert.ok(hasMount(snapshot, '/api/commissions', ['dddCommissionsRoutes']));
    assert.ok(hasMount(snapshot, '/api/commissions', ['commissionsRoutes']));
    assert.ok(hasMount(snapshot, '/api/products', ['productsRoutes']));
    const financeIndex = mountIndex(snapshot, (entry) => entry === finance);
    const apiAuthIndex = mountIndex(snapshot, (entry) => entry.kind === 'use' && entry.args[0] === '/api' && labelOf(snapshot.labels, entry.args[1]) === 'verifyToken');
    const apiInvalidationIndex = mountIndex(snapshot, (entry) => entry.kind === 'use' && entry.args[0] === '/api' && labelOf(snapshot.labels, entry.args[1]) === 'invalidationMiddleware');
    const apiCacheIndex = mountIndex(snapshot, (entry) => entry.kind === 'use' && entry.args[0] === '/api' && labelOf(snapshot.labels, entry.args[1]) === 'cacheMiddleware');
    assert.ok(financeIndex >= 0);
    assert.ok(apiAuthIndex > financeIndex);
    assert.ok(apiInvalidationIndex > apiAuthIndex && apiCacheIndex > apiInvalidationIndex);
    assert.equal(mountIndex(snapshot, (entry) => entry.kind === 'use' && labelOf(snapshot.labels, entry.args[0]) === 'invalidationMiddleware'), -1);
    assert.deepEqual(snapshot.operations, { network: 0, process: 0, protectedRead: 0, unexpectedImport: 0 });
  }
});

test('legacy composition uses global auth before business routes and excludes DDD factories', { concurrency: false }, () => {
  const composed = loadComposedApp({ repoRoot, mode: 'legacy' });
  {
    const snapshot = composed;
    assert.deepEqual(snapshot.factoryCalls, []);
    assert.ok(hasMount(snapshot, '/api/pedidos', ['pedidosLimiter', 'pedidosRoutes']));
    assert.ok(hasMount(snapshot, '/api/cobros', ['cobrosLimiter', 'cobrosRoutes']));
    assert.equal(hasMount(snapshot, '/api/pedidos', ['pedidosLimiter', 'dddPedidosRoutes']), undefined);
    assert.equal(hasMount(snapshot, '/api/cobros', ['cobrosLimiter', 'dddCobrosRoutes']), undefined);
    const globalAuth = mountIndex(snapshot, (entry) => entry.kind === 'use' && entry.args[0] === '/api' && labelOf(snapshot.labels, entry.args[1]) === 'verifyToken');
    const globalInvalidation = mountIndex(snapshot, (entry) => entry.kind === 'use' && entry.args[0] === '/api' && labelOf(snapshot.labels, entry.args[1]) === 'invalidationMiddleware');
    const globalCache = mountIndex(snapshot, (entry) => entry.kind === 'use' && entry.args[0] === '/api' && labelOf(snapshot.labels, entry.args[1]) === 'cacheMiddleware');
    const business = mountIndex(snapshot, (entry) => entry.kind === 'use' && entry.args[0] === '/api/dashboard');
    const docs = mountIndex(snapshot, (entry) => entry.kind === 'use' && labelOf(snapshot.labels, entry.args[0]) === 'docsRoutes');
    const limiter = mountIndex(snapshot, (entry) => entry.kind === 'use' && entry.args[0] === '/api/' && labelOf(snapshot.labels, entry.args[1]) === 'globalLimiter');
    assert.ok(globalAuth >= 0 && globalAuth < globalInvalidation && globalInvalidation < globalCache && globalCache < business);
    assert.ok(docs >= 0 && docs < limiter);
    assert.ok(hasMount(snapshot, '/api/repartidor-finanzas', ['verifyToken', 'repartoFinanzasWriteGuard', 'invalidationMiddleware', 'canonicalRepartidorFinanzasRoutes']));
    assert.equal(mountIndex(snapshot, (entry) => entry.kind === 'use' && labelOf(snapshot.labels, entry.args[0]) === 'invalidationMiddleware'), -1);
    assert.deepEqual(snapshot.operations, { network: 0, process: 0, protectedRead: 0, unexpectedImport: 0 });
  }
});

test('retired TypeScript mode fails before importing infrastructure stubs', { concurrency: false }, () => {
  const harness = createHarness({ repoRoot, mode: 'invalid-ts' });
  try {
    assert.throws(() => harness.load(), (error) => error && error.code === 'INVALID_REPARTO_ROUTE_MODE');
    const snapshot = harness.snapshot();
    assert.deepEqual(snapshot.factoryCalls, []);
    assert.deepEqual(snapshot.setterCalls, []);
    assert.deepEqual(snapshot.operations, { network: 0, process: 0, protectedRead: 0, unexpectedImport: 0 });
  } finally {
    harness.close();
  }
});

test('closed loader rejects an unstubbed local import before its fixture executes', { concurrency: false }, () => {
  delete global.__runtimeCompositionForbiddenExecuted;
  const harness = createHarness({ repoRoot, mode: 'legacy', entry: 'unexpectedLocalImport' });
  try {
    assert.throws(() => harness.load(), /UNEXPECTED_LOCAL_IMPORT:forbidden-local-import\.cjs/);
    assert.equal(global.__runtimeCompositionForbiddenExecuted, undefined);
    assert.equal(harness.snapshot().operations.unexpectedImport, 1);
  } finally {
    harness.close();
    delete global.__runtimeCompositionForbiddenExecuted;
  }
});
test('side-effect and protected-name guards fail closed without reading a protected file', { concurrency: false }, () => {
  const networkHarness = createHarness({ repoRoot, mode: 'legacy', entry: 'networkImport' });
  try {
    assert.throws(() => networkHarness.load(), /BLOCKED_COMPOSITION_IMPORT:node:net/);
    assert.equal(networkHarness.snapshot().operations.network, 1);
  } finally {
    networkHarness.close();
  }

  const processHarness = createHarness({ repoRoot, mode: 'legacy', entry: 'processExit' });
  try {
    assert.throws(() => processHarness.load(), /BLOCKED_COMPOSITION_SIDE_EFFECT/);
    assert.equal(processHarness.snapshot().operations.process, 1);
    for (const protectedName of ['.env', '.env.local', '.envfoo']) {
      assert.throws(() => fs.readFileSync(path.join(repoRoot, protectedName)), /BLOCKED_PROTECTED_READ/);
    }
    assert.throws(() => global.fetch('https://example.invalid'), /BLOCKED_COMPOSITION_SIDE_EFFECT/);
    assert.throws(() => childProcess.execSync('echo must-not-run'), /BLOCKED_COMPOSITION_SIDE_EFFECT/);
    assert.equal(processHarness.snapshot().operations.protectedRead, 3);
    assert.equal(processHarness.snapshot().operations.network, 1);
    assert.equal(processHarness.snapshot().operations.process, 2);
  } finally {
    processHarness.close();
  }
});

test('public API restores loader, environment, Sentry and prior module-cache entries on success and failure', { concurrency: false }, () => {
  const beforeLoader = require('node:module')._load;
  const beforeEnv = { ...process.env };
  const appPath = path.join(repoRoot, 'backend', 'app.js');
  const originalAppCache = require.cache[appPath];
  const previousCacheEntry = { exports: { prior: true } };
  require.cache[appPath] = previousCacheEntry;
  const sentryWasPresent = Object.hasOwn(global, '__GMP_SENTRY__');
  const originalSentry = global.__GMP_SENTRY__;
  const sentinel = { test: 'sentry-sentinel' };
  global.__GMP_SENTRY__ = sentinel;
  try {
    const success = loadComposedApp({ repoRoot, mode: 'legacy' });
    assert.ok(success.app);
    assert.equal(typeof success.close, 'undefined');
    assert.strictEqual(require.cache[appPath], previousCacheEntry);
    assert.strictEqual(require('node:module')._load, beforeLoader);
    assert.deepEqual({ ...process.env }, beforeEnv);
    assert.strictEqual(global.__GMP_SENTRY__, sentinel);

    assert.throws(() => loadComposedApp({ repoRoot, mode: 'invalid-ts' }), (error) => error && error.code === 'INVALID_REPARTO_ROUTE_MODE');
    assert.strictEqual(require.cache[appPath], previousCacheEntry);
    assert.strictEqual(require('node:module')._load, beforeLoader);
    assert.deepEqual({ ...process.env }, beforeEnv);
    assert.strictEqual(global.__GMP_SENTRY__, sentinel);
  } finally {
    if (originalAppCache) require.cache[appPath] = originalAppCache;
    else delete require.cache[appPath];
    if (sentryWasPresent) global.__GMP_SENTRY__ = originalSentry;
    else delete global.__GMP_SENTRY__;
  }
});

test('closed entry selector and symlinked roots fail before import', { concurrency: false }, () => {
  assert.throws(() => createHarness({ repoRoot, mode: 'legacy', entry: 'not-enumerated' }), /BLOCKED_COMPOSITION_ENTRY/);
  const temporaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(require('node:os').tmpdir()), 'gmp-composition-'));
  const linkedRoot = path.join(temporaryRoot, 'repo-link');
  try {
    fs.symlinkSync(repoRoot, linkedRoot, 'junction');
    assert.throws(() => createHarness({ repoRoot: linkedRoot, mode: 'legacy' }), /BLOCKED_COMPOSITION_SYMLINK/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
