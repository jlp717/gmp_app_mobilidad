'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const Module = require('node:module');
const net = require('node:net');
const path = require('node:path');
const childProcess = require('node:child_process');

const PROTECTED_NAME = /^(?:\.env.*|.*\.pem|.*\.key|tokens.*\.json|cline_mcp_settings\.json|CREDENCIALES\.md)$/i;
const BLOCKED_BUILTINS = new Set(['net', 'node:net', 'http', 'node:http', 'https', 'node:https', 'child_process', 'node:child_process', 'worker_threads', 'node:worker_threads']);

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function inert(label) {
  const middleware = function compositionStub(req, res, next) {
    if (typeof next === 'function') next();
  };
  Object.defineProperty(middleware, '__compositionLabel', { value: label });
  return middleware;
}

function restoreEnvironment(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!Object.hasOwn(snapshot, key)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(snapshot)) process.env[key] = value;
}

function replaceProperty(target, key, replacement, restorers) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { ...descriptor, value: replacement });
  restorers.push(() => Object.defineProperty(target, key, descriptor));
}

function assertSafePath(target) {
  let current = path.resolve(target);
  while (true) {
    const basename = path.basename(current);
    if (PROTECTED_NAME.test(basename)) throw new Error('BLOCKED_PROTECTED_PATH');
    const entry = fs.lstatSync(current);
    if (entry.isSymbolicLink()) throw new Error('BLOCKED_COMPOSITION_SYMLINK');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function selectEntry(backendRoot, entry) {
  const fixturesRoot = path.join(backendRoot, 'scripts', 'tests', 'fixtures', 'runtime-composition');
  const entries = {
    app: path.join(backendRoot, 'app.js'),
    unexpectedLocalImport: path.join(fixturesRoot, 'unexpected-local-import.cjs'),
    networkImport: path.join(fixturesRoot, 'network-import.cjs'),
    processExit: path.join(fixturesRoot, 'process-exit.cjs'),
  };
  if (!Object.hasOwn(entries, entry)) throw new Error('BLOCKED_COMPOSITION_ENTRY');
  return entries[entry];
}

function createHarness({ repoRoot, mode, entry = 'app' }) {
  const root = path.resolve(repoRoot);
  assertSafePath(root);
  const backendRoot = path.join(root, 'backend');
  assertSafePath(backendRoot);
  const appPath = selectEntry(backendRoot, entry);
  assertSafePath(appPath);
  if (!['ddd', 'legacy', 'invalid-ts'].includes(mode)) throw new Error('Unsupported composition mode');

  const express = require('express');
  const cors = require('cors');
  const compression = require('compression');
  const rateLimit = require('express-rate-limit');
  const compositionAppPath = path.join(backendRoot, 'app.js');
  const repartoRuntimePath = path.join(backendRoot, 'config', 'reparto-runtime.js');
  const repartoMappingPath = path.join(backendRoot, 'config', 'g4-dsedac-erp-mapping.js');
  assertSafePath(compositionAppPath);
  assertSafePath(repartoRuntimePath);
  assertSafePath(repartoMappingPath);
  const appRequire = Module.createRequire(compositionAppPath);
  const rootMounts = [];
  const factoryCalls = [];
  const setterCalls = [];
  const operations = { network: 0, process: 0, protectedRead: 0, unexpectedImport: 0 };
  const labels = new Map();
  const restorers = [];
  const envSnapshot = { ...process.env };
  const sentryWasPresent = Object.hasOwn(global, '__GMP_SENTRY__');
  const sentryValue = global.__GMP_SENTRY__;
  const modulePaths = new Set([appPath]);
  const realProductPaths = new Set([
    appPath,
    repartoRuntimePath,
    repartoMappingPath,
  ]);

  function labelledRouter(label) {
    const router = express.Router();
    labels.set(router, label);
    return router;
  }

  function labelledMiddleware(label) {
    const middleware = inert(label);
    labels.set(middleware, label);
    return middleware;
  }

  function resolveLocal(request) {
    const resolved = appRequire.resolve(request);
    assertSafePath(resolved);
    modulePaths.add(resolved);
    return resolved;
  }

  const verifyToken = labelledMiddleware('verifyToken');
  const stubsByPath = new Map();
  const register = (request, stub) => stubsByPath.set(resolveLocal(request), stub);
  const globalLimiter = labelledMiddleware('globalLimiter');
  const cobrosLimiter = labelledMiddleware('cobrosLimiter');
  const pedidosLimiter = labelledMiddleware('pedidosLimiter');
  const emailLimiter = labelledMiddleware('emailLimiter');
  const cacheMiddleware = labelledMiddleware('cacheMiddleware');
  const invalidationMiddleware = labelledMiddleware('invalidationMiddleware');

  const canonicalRouter = labelledRouter('canonicalRepartidorFinanzasRoutes');
  canonicalRouter.setCanonicalConfirmationRuntime = (runtime) => setterCalls.push({ setter: 'confirmation', runtime });
  canonicalRouter.setCanonicalLiquidacionService = (service) => setterCalls.push({ setter: 'liquidacion', service });

  const routeStub = (name) => labelledRouter(name);
  register('./config/reparto-confirmation-bootstrap', {
    createCanonicalConfirmationBootstrap: () => ({ runtime: { kind: 'stub-runtime' }, diagnostic: {} }),
  });
  register('./config/repartidor-liquidacion-bootstrap', {
    createRepartidorLiquidacionBootstrap: () => ({ service: null, enabled: false, diagnostic: { configured: false, catalogChecked: false, catalogVerified: false } }),
  });
  register('./middleware/logger', { info() {}, warn() {}, error() {}, debug() {} });
  register('./routes/docs', labelledMiddleware('docsRoutes'));
  register('./middleware/auth', { verifyToken, getSessionStoreReadiness: async () => ({ ready: true, required: false }) });
  register('./config/db', {
    query: async () => [], getPoolMetrics: () => ({}), runWithDbRequestContext: (_context, next) => next(), acquireConfiguredConnection: async () => ({ close: async () => {} }),
  });
  register('./middleware/security', {
    globalLimiter, createSecurityHeaders: () => labelledMiddleware('securityHeaders'), validateContentType: labelledMiddleware('validateContentType'), cobrosLimiter, pedidosLimiter, emailLimiter,
    detectSuspiciousAgents: labelledMiddleware('detectSuspiciousAgents'), validateContentLength: labelledMiddleware('validateContentLength'), addRequestId: labelledMiddleware('addRequestId'),
    detectScannerProbes: labelledMiddleware('detectScannerProbes'), bruteForceIpTracker: labelledMiddleware('bruteForceIpTracker'),
  });
  register('./utils/common', { MIN_YEAR: 2000 });
  register('./services/redis-cache', { getCacheStats: () => ({}), redisCache: { getStats: () => ({ isConnected: false, hitRate: 0 }) } });
  register('./middleware/network-optimizer', { networkOptimizer: labelledMiddleware('networkOptimizer'), responseCoalescing: labelledMiddleware('responseCoalescing') });
  register('./middleware/db-timing', { runWithStats: (_stats, callback) => callback() });
  register('./routes/telemetry', labelledMiddleware('telemetryRoutes'));
  register('./routes/notifications', labelledMiddleware('notificationsRoutes'));
  register('./middleware/http-cache', { cacheMiddleware, invalidationMiddleware, getCacheStats: () => ({}) });
  register('./services/query-optimizer', { createOptimizedQuery: () => ({ getSlowQueries: () => [], getStats: () => [], suggestIndexes: () => [] }), getQueryStats: () => ({}) });
  register('./middleware/audit', { auditMiddleware: labelledMiddleware('auditMiddleware'), getRecentAuditEntries: () => [], getActiveSessions: () => ({}) });
  register('./middleware/compression', { createCompressionMiddleware: () => labelledMiddleware('compressionMiddleware') });
  register('./middleware/prometheus-metrics', {
    prometheusMetrics: labelledMiddleware('prometheusMetrics'), metricsHandler: labelledMiddleware('metricsHandler'), requireInternalMetricsAccess: labelledMiddleware('requireInternalMetricsAccess'),
    canSeeInternalDetails: () => false, publicReadyPayload: (body) => body,
  });
  register('./services/auth-pin-readiness', { checkAuthPinHashReadiness: async () => ({ status: 'ready' }) });
  register('./routes/repartidor-finanzas', canonicalRouter);
  for (const [request, label] of [
    ['./routes/auth', 'authRoutes'], ['./routes/dashboard', 'dashboardRoutes'], ['./routes/analytics', 'analyticsRoutes'], ['./routes/master', 'masterRoutes'],
    ['./routes/clients', 'clientsRoutes'], ['./routes/planner', 'plannerRoutes'], ['./routes/objectives', 'objectivesRoutes'], ['./routes/export', 'exportRoutes'],
    ['./routes/chatbot', 'chatbotRoutes'], ['./routes/filters', 'filtersRoutes'], ['./routes/entregas', 'entregasRoutes'], ['./routes/repartidor', 'repartidorRoutes'],
    ['./routes/user-actions', 'userActionsRoutes'], ['./routes/facturas', 'facturasRoutes'], ['./routes/warehouse', 'warehouseRoutes'], ['./routes/products', 'productsRoutes'],
    ['./routes/bolsa', 'bolsaRoutes'], ['./routes/evolution', 'evolutionRoutes'], ['./routes/pedidos', 'pedidosRoutes'], ['./routes/cobros', 'cobrosRoutes'],
    ['./routes/comercial-liquidacion', 'comercialLiquidacionRoutes'], ['./routes/health-probes', 'healthProbes'], ['./routes/health-check-e2e', 'healthCheckE2e'],
  ]) register(request, routeStub(label));
  register('./routes/commissions', { router: routeStub('commissionsRoutes') });
  register('./kpi', { kpiRoutes: routeStub('kpiRoutes') });
  register('./src/shared/routes/ddd-adapters', {
    createAuthRoutes: () => { factoryCalls.push('createAuthRoutes'); return routeStub('dddAuthRoutes'); },
    createPedidosRoutes: () => { factoryCalls.push('createPedidosRoutes'); return routeStub('dddPedidosRoutes'); },
    createCobrosRoutes: () => { factoryCalls.push('createCobrosRoutes'); return routeStub('dddCobrosRoutes'); },
    createClientsRoutes: () => { factoryCalls.push('createClientsRoutes'); return routeStub('dddClientsRoutes'); },
    createCommissionsRoutes: () => { factoryCalls.push('createCommissionsRoutes'); return routeStub('dddCommissionsRoutes'); },
  });

  const cachedModules = new Map([...modulePaths].map((modulePath) => [modulePath, require.cache[modulePath]]));
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  if (mode === 'ddd') Object.assign(process.env, { NODE_ENV: 'test', USE_TS_ROUTES: 'false', USE_DDD_ROUTES: 'true' });
  if (mode === 'legacy') Object.assign(process.env, { NODE_ENV: 'test', USE_TS_ROUTES: 'false', USE_DDD_ROUTES: 'false' });
  if (mode === 'invalid-ts') Object.assign(process.env, { NODE_ENV: 'test', USE_TS_ROUTES: 'true', USE_DDD_ROUTES: 'false' });
  delete global.__GMP_SENTRY__;

  function trackedExpress() {
    const app = express();
    const use = app.use.bind(app);
    const get = app.get.bind(app);
    app.use = (...args) => { rootMounts.push({ kind: 'use', args }); return use(...args); };
    app.get = (...args) => { rootMounts.push({ kind: 'get', args }); return get(...args); };
    return app;
  }
  Object.assign(trackedExpress, express, { Router: express.Router, json: express.json });

  const preloadedAppPackages = new Map([
    ['express', trackedExpress], ['cors', cors],
    ['compression', compression], ['express-rate-limit', rateLimit],
  ]);
  const originalLoad = Module._load;
  Module._load = function guardedLoad(request, parent, isMain) {
    if (BLOCKED_BUILTINS.has(request)) {
      operations.network += 1;
      throw new Error(`BLOCKED_COMPOSITION_IMPORT:${request}`);
    }
    let resolved;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch (error) { throw error; }
    // Physical node_modules lives inside backendRoot. Only the canonical app
    // may receive these exact, already-loaded dependencies before the local guard.
    if (parent && path.resolve(parent.filename) === compositionAppPath
      && preloadedAppPackages.has(request)) return preloadedAppPackages.get(request);
    if (stubsByPath.has(resolved)) return stubsByPath.get(resolved);
    if (realProductPaths.has(resolved)) return originalLoad.call(this, request, parent, isMain);
    if (isWithin(backendRoot, resolved)) {
      operations.unexpectedImport += 1;
      throw new Error(`UNEXPECTED_LOCAL_IMPORT:${path.basename(resolved)}`);
    }
    throw new Error(`BLOCKED_COMPOSITION_IMPORT:${request}`);
  };
  restorers.push(() => { Module._load = originalLoad; });

  const protectedRead = fs.readFileSync;
  replaceProperty(fs, 'readFileSync', function guardedRead(file, ...args) {
    const basename = path.basename(String(file));
    if (PROTECTED_NAME.test(basename)) {
      operations.protectedRead += 1;
      throw new Error('BLOCKED_PROTECTED_READ');
    }
    return protectedRead.call(this, file, ...args);
  }, restorers);
  replaceProperty(global, 'fetch', () => { operations.network += 1; throw new Error('BLOCKED_COMPOSITION_SIDE_EFFECT'); }, restorers);
  for (const [target, key, category] of [[net, 'createServer', 'network'], [net, 'connect', 'network'], [http, 'createServer', 'network'], [http, 'request', 'network'], [https, 'createServer', 'network'], [https, 'request', 'network'], [childProcess, 'exec', 'process'], [childProcess, 'execFile', 'process'], [childProcess, 'spawn', 'process'], [childProcess, 'fork', 'process'], [childProcess, 'execSync', 'process'], [childProcess, 'execFileSync', 'process'], [childProcess, 'spawnSync', 'process'], [process, 'exit', 'process']]) {
    replaceProperty(target, key, () => { operations[category] += 1; throw new Error('BLOCKED_COMPOSITION_SIDE_EFFECT'); }, restorers);
  }

  let closed = false;
  return {
    load() {
      return require(appPath);
    },
    snapshot() {
      return { rootMounts, factoryCalls, setterCalls, operations, labels };
    },
    close() {
      if (closed) return;
      closed = true;
      for (const restore of restorers.reverse()) restore();
      restoreEnvironment(envSnapshot);
      if (sentryWasPresent) global.__GMP_SENTRY__ = sentryValue;
      else delete global.__GMP_SENTRY__;
      for (const [modulePath, previous] of cachedModules) {
        if (previous) require.cache[modulePath] = previous;
        else delete require.cache[modulePath];
      }
    },
  };
}

function loadComposedApp(options) {
  const harness = createHarness(options);
  try {
    const app = harness.load();
    return { app, ...harness.snapshot() };
  } finally {
    harness.close();
  }
}

module.exports = { createHarness, loadComposedApp };
