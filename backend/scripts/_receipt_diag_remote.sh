#!/bin/bash
set -euo pipefail
SRC="/c/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend/scripts/_receipt_capability_diag.js"
/usr/bin/scp -o BatchMode=yes "$SRC" gmp@192.168.1.230:/opt/gmp-api/backend/scripts/_receipt_capability_diag.js
/usr/bin/ssh -o BatchMode=yes gmp@192.168.1.230 'cd /opt/gmp-api/backend && node scripts/_receipt_capability_diag.js'
