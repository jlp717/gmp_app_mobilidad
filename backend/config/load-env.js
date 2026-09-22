const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function candidateEnvFiles() {
  if (process.env.GMP_ENV_FILE) {
    return [process.env.GMP_ENV_FILE];
  }

  if (process.env.NODE_ENV === 'production') {
    return ['.env.production', '.env.produccion', '.env'];
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
    if (!key.startsWith('REPARTO_') && !ROUTING_CAPABILITY_OVERLAY_KEYS.includes(key)) continue;
    if (value === undefined) continue;
    process.env[key] = String(value);
  }
}

function loadEnv(baseDir = process.cwd()) {
  for (const envFile of candidateEnvFiles()) {
    const fullPath = path.isAbsolute(envFile)
      ? envFile
      : path.resolve(baseDir, envFile);
    if (!fs.existsSync(fullPath)) continue;
    const parsed = dotenv.parse(fs.readFileSync(fullPath));
    dotenv.config({ path: fullPath });
    // Stale PM2 fail-closed flags must not hide isolated_test from backend/.env.
    overlayRepartoFlags(parsed);
    enforceCommercialSessionTtlFloor();
    process.env.GMP_LOADED_ENV_FILE = fullPath;
    return fullPath;
  }
  enforceCommercialSessionTtlFloor();
  return null;
}

module.exports = {
  loadEnv,
  overlayRepartoFlags,
  enforceCommercialSessionTtlFloor,
  parseTtlMs,
};
