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
    process.env.GMP_LOADED_ENV_FILE = fullPath;
    return fullPath;
  }
  return null;
}

module.exports = { loadEnv, overlayRepartoFlags };
