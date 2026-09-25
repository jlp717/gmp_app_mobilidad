// ARCHIVE one-off [2026/anio-gitlog]: header-no-leido;mandato-v5 | epico mandato-v5 puntual: DB2 API | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const env = process['env'];
const required = ['MANDATO_A', 'MANDATO_B', 'DB2_CONNECT'];
const missing = required.filter((name) => !env[name]);

if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

throw new Error('Live DB2/API verifier disabled until it is wired to env-only runtime values.');
