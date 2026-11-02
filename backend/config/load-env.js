const fs = require('fs');
const path = require('path');
const cluster = require('cluster');
const dotenv = require('dotenv');

function candidateEnvFiles(env = process.env) {
  if (env.GMP_ENV_FILE) {
    return [env.GMP_ENV_FILE];
  }

  // APP_ENV is the routing authority. Once it is explicit, inherited
  // NODE_ENV must not silently select a different file (for example a demo
  // process inheriting NODE_ENV=production and reading production flags).
  if (env.APP_ENV) {
    return ['.env'];
  }

  // Migration compatibility only: inspect the canonical base file first so
  // adding APP_ENV there is a genuine one-line switch. Legacy production
  // filenames are considered only when the base file does not exist.
  if (env.NODE_ENV === 'production') {
    return ['.env', '.env.production', '.env.produccion'];
  }

  return ['.env'];
}

// Fail-closed capability flags fixed by the PM2 ecosystem baseline must be
// overridable from backend/.env, otherwise dotenv silently keeps the stale
// PM2 value because process.env already defines the key. Scoped to the
// routing capability flags only: schema routing (REPARTIDOR_FINANCE_*_SCHEMA)
// stays ecosystem-owned so a stray .env line cannot repoint production.
const ROUTING_CAPABILITY_OVERLAY_KEYS = [
  'REPARTIDOR_DAY_MOVE_ENABLED',
  'REPARTIDOR_TRACKING_ENABLED',
];

// Approval gates are deployment-owned. A checked or stale .env file may not
// create them; only values already present in the process environment survive.
const PROFILE_PROTECTED_KEYS = Object.freeze([
  'REPARTO_WRITES_ENABLED',
  'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED',
  'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED',
  'REPARTO_PRODUCTION_WRITES_APPROVED',
  'REPARTO_PRODUCTION_ERP_WRITES_APPROVED',
  'REPARTO_PRODUCTION_CONFIRMATION_APPROVED',
  'PEDIDOS_EXPORT_TO_SYSTEM',
  'PEDIDOS_DSEDAC_EXPORT_APPROVED',
  'PEDIDOS_DSEDAC_STORAGE_APPROVED',
]);

const MIN_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_AUTH_REDIS_TIMEOUT_MS = 3000;

function parseTtlMs(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = String(raw).trim();
  if (/^\d+$/.test(value)) {
    const ms = parseInt(value, 10);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  const match = value.match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  if (!Number.isFinite(amount) || amount <= 0 || !mult) return null;
  return amount * mult;
}

/**
 * Product floor for commercial tablets: access >= 24h, refresh >= 7d.
 * Runs after dotenv so a short prod .env (historically 1h/15m) cannot force
 * mid-day re-login. Does not touch JWT secrets. Test/dev keep auth.js defaults.
 */
function enforceCommercialSessionTtlFloor({
  production = process.env.NODE_ENV === 'production',
} = {}) {
  if (!production) return Object.freeze({ applied: false });

  const before = {
    access: process.env.JWT_ACCESS_EXPIRES || null,
    refresh: process.env.JWT_REFRESH_EXPIRES || null,
    redisTimeout: process.env.AUTH_REDIS_TIMEOUT_MS || null,
  };

  const accessMs = parseTtlMs(process.env.JWT_ACCESS_EXPIRES);
  if (!accessMs || accessMs < MIN_ACCESS_TTL_MS) {
    process.env.JWT_ACCESS_EXPIRES = '24h';
  }

  const refreshMs = parseTtlMs(process.env.JWT_REFRESH_EXPIRES);
  if (!refreshMs || refreshMs < MIN_REFRESH_TTL_MS) {
    process.env.JWT_REFRESH_EXPIRES = '7d';
  }

  const redisTimeout = Number.parseInt(
    process.env.AUTH_REDIS_TIMEOUT_MS || process.env.REDIS_COMMAND_TIMEOUT_MS || '',
    10,
  );
  if (!Number.isFinite(redisTimeout) || redisTimeout < MIN_AUTH_REDIS_TIMEOUT_MS) {
    process.env.AUTH_REDIS_TIMEOUT_MS = String(MIN_AUTH_REDIS_TIMEOUT_MS);
  }

  return Object.freeze({
    applied: true,
    before,
    after: {
      access: process.env.JWT_ACCESS_EXPIRES || null,
      refresh: process.env.JWT_REFRESH_EXPIRES || null,
      redisTimeout: process.env.AUTH_REDIS_TIMEOUT_MS || null,
    },
  });
}

function overlayRepartoFlags(parsed) {
  if (!parsed || typeof parsed !== 'object') return;
  for (const [key, value] of Object.entries(parsed)) {
    if (!ROUTING_CAPABILITY_OVERLAY_KEYS.includes(key)) continue;
    if (value === undefined) continue;
    process.env[key] = String(value);
  }
}

function captureProtectedProfileFlags(env = process.env) {
  return Object.fromEntries(PROFILE_PROTECTED_KEYS.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined,
  ]));
}

function restoreProtectedProfileFlags(before, parsed, env = process.env) {
  for (const key of PROFILE_PROTECTED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(parsed || {}, key)) continue;
    if (before[key] === undefined) delete env[key];
    else env[key] = before[key];
  }
}

function isMultiProcessRuntime() {
  if (cluster.isWorker) return true;

  const execMode = String(process.env.PM2_EXEC_MODE || '').trim().toLowerCase();
  if (execMode === 'cluster') return true;

  const requestedInstances = String(process.env.PM2_INSTANCES || '').trim().toLowerCase();
  if (requestedInstances === 'max') return true;

  const instanceCount = Number.parseInt(requestedInstances, 10);
  return Number.isFinite(instanceCount) && instanceCount > 1;
}

function enforceSharedAuthSessionStore() {
  if (!isMultiProcessRuntime()) return false;

  // Local memory is process-scoped. A different cluster worker would reject
  // the login's session as revoked, so all workers must use the shared store.
  process.env.AUTH_SESSION_STORE_MODE = 'redis';
  return true;
}

function loadEnv(baseDir = process.cwd()) {
  // server.js applies the canonical APP_ENV contract before importing app/DB
  // modules. Some legacy config modules call loadEnv() again; re-reading and
  // overlaying the file there could undo the already-validated routing.
  const { isAppProfileApplied } = require('./app-profile');
  if (isAppProfileApplied()) {
    enforceSharedAuthSessionStore();
    enforceCommercialSessionTtlFloor();
    return process.env.GMP_LOADED_ENV_FILE || null;
  }
  for (const envFile of candidateEnvFiles()) {
    const fullPath = path.isAbsolute(envFile)
      ? envFile
      : path.resolve(baseDir, envFile);
    if (!fs.existsSync(fullPath)) continue;
    const parsed = dotenv.parse(fs.readFileSync(fullPath));
    const protectedBefore = captureProtectedProfileFlags();
    dotenv.config({ path: fullPath });
    restoreProtectedProfileFlags(protectedBefore, parsed);
    // Only explicitly allowlisted non-mutation capabilities may overlay.
    overlayRepartoFlags(parsed);
    enforceSharedAuthSessionStore();
    enforceCommercialSessionTtlFloor();
    process.env.GMP_LOADED_ENV_FILE = fullPath;
    return fullPath;
  }
  enforceSharedAuthSessionStore();
  enforceCommercialSessionTtlFloor();
  return null;
}

module.exports = {
  candidateEnvFiles,
  captureProtectedProfileFlags,
  loadEnv,
  overlayRepartoFlags,
  restoreProtectedProfileFlags,
  enforceSharedAuthSessionStore,
  enforceCommercialSessionTtlFloor,
  parseTtlMs,
};
