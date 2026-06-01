#!/bin/bash
set -euo pipefail

for file in \
  /opt/gmp-tools/.env \
  /opt/gmp-api/backend/.env \
  /opt/gmp-api/.env \
  /var/www/mari-pepa/.env \
  /var/www/mari-pepa/backend/.env
do
  [ -f "$file" ] || continue
  echo "FILE:$file"
  grep -E 'ELEVEN|VOICE|TTS' "$file" | sed -E 's/(=).*/=PRESENT/' || true
done
