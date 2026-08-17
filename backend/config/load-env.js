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

function overlayRepartoFlags(parsed) {
  if (!parsed || typeof parsed !== 'object') return;
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith('REPARTO_')) continue;
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
