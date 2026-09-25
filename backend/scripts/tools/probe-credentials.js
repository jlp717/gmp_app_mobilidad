// tools/probe-credentials.js - moved from scripts/probe-credentials.js (WS2 tools consolidation, rama test).
// helper credenciales probe SOLO env sin secreto
// Uso: require desde otros tools GMP_PROBE_USER GMP_PROBE_PASSWORD Env: R DB2:  (detalle: backend/scripts/tools/README.md).
'use strict';

function getProbeCredentials(label = 'probe') {
  const username = process.env.GMP_PROBE_USER || process.env.GMP_API_USER || process.env.API_USER;
  const password = process.env.GMP_PROBE_PASSWORD || process.env.GMP_API_PASSWORD || process.env.API_PASS;
  if (!username || !password) {
    throw new Error(`${label}: set GMP_PROBE_USER and GMP_PROBE_PASSWORD for authenticated probes`);
  }
  return { username, password };
}

module.exports = { getProbeCredentials };
