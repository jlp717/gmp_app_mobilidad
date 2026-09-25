# ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-sh | _-scratch shell gitignored; check TTL sesion puntual | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
#!/bin/bash
set -euo pipefail
cd /opt/gmp-api
echo "HEAD=$(git rev-parse --short HEAD)"
echo "LOG=$(git log -1 --oneline)"
git merge-base --is-ancestor 93e4479 HEAD && echo "SESSION_COMMIT_IN_HEAD=yes" || echo "SESSION_COMMIT_IN_HEAD=no"
node -e 'const e=require("./ecosystem.config.js"); const a=(e.apps&&e.apps[0])||{}; const env=Object.assign({}, a.env||{}, a.env_production||{}); console.log(JSON.stringify({JWT_ACCESS_EXPIRES:env.JWT_ACCESS_EXPIRES||null,JWT_REFRESH_EXPIRES:env.JWT_REFRESH_EXPIRES||null,AUTH_REDIS_TIMEOUT_MS:env.AUTH_REDIS_TIMEOUT_MS||null,NODE_ENV:env.NODE_ENV||null}));'
