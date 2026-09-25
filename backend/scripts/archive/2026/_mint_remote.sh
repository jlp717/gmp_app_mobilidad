# ARCHIVE one-off [2026/anio-gitlog]: header-no-leido;_scratch-sh | _-scratch shell gitignored; mint remoto puntual | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
#!/bin/bash
set -euo pipefail
OUT="/c/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend/scripts/_mint_out.json"
/usr/bin/ssh -o BatchMode=yes gmp@192.168.1.230 'cd /opt/gmp-api/backend && node scripts/_ssh_mint_repartidor_jwt.js' \
  | /usr/bin/grep '^{"ok"' > "$OUT"
