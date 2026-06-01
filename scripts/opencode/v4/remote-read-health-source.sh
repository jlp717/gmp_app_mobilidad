#!/bin/bash
set -euo pipefail

echo "== server imports and port =="
sed -n '1,90p' /opt/gmp-api/backend/server.js

echo "== middleware and health =="
sed -n '160,340p' /opt/gmp-api/backend/server.js

echo "== access deny search =="
grep -RIn --exclude-dir=node_modules -E 'Acceso denegado|Forbidden|forbidden|403|deny|deneg' \
  /opt/gmp-api/backend/server.js \
  /opt/gmp-api/backend/src \
  /opt/gmp-api/backend/middleware \
  /opt/gmp-api/backend/routes 2>/dev/null | sed -n '1,100p'
