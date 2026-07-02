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

function loadEnv(baseDir = process.cwd()) {
  for (const envFile of candidateEnvFiles()) {
    const fullPath = path.isAbsolute(envFile)
      ? envFile
      : path.resolve(baseDir, envFile);
    if (!fs.existsSync(fullPath)) continue;
    dotenv.config({ path: fullPath });
    process.env.GMP_LOADED_ENV_FILE = fullPath;
    return fullPath;
  }
  return null;
}

module.exports = { loadEnv };
