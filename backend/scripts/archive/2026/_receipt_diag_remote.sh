# ARCHIVE one-off [2026/anio-gitlog]: header-no-leido;_scratch-sh | _-scratch shell gitignored; diagnostico remoto recibos puntual | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
#!/bin/bash
set -euo pipefail
SRC="/c/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend/scripts/_receipt_capability_diag.js"
/usr/bin/scp -o BatchMode=yes "$SRC" gmp@192.168.1.230:/opt/gmp-api/backend/scripts/_receipt_capability_diag.js
/usr/bin/ssh -o BatchMode=yes gmp@192.168.1.230 'cd /opt/gmp-api/backend && node scripts/_receipt_capability_diag.js'
