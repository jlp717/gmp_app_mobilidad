'use strict';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

const REPARTIDOR_FLEET_SQL = `
  SELECT DISTINCT
    TRIM(X.CODIGOVENDEDOR) AS CODE,
    COALESCE(NULLIF(TRIM(D.NOMBREVENDEDOR), ''), TRIM(X.CODIGOVENDEDOR)) AS NAME
  FROM DSEDAC.VDDX X
  LEFT JOIN DSEDAC.VDD D
    ON TRIM(D.CODIGOVENDEDOR) = TRIM(X.CODIGOVENDEDOR)
  WHERE X.CODIGOVENDEDOR IS NOT NULL
    AND TRIM(X.CODIGOVENDEDOR) <> ''
    AND TRIM(X.PERMITEREPARTOSN) = 'S'
    AND COALESCE(NULLIF(TRIM(X.JEFEVENTASSN), ''), 'N') <> 'S'
  ORDER BY CODE
`;

const EXCLUDED_PREFIXES = Object.freeze([
  'ZZ', 'ZD', 'ZB', 'ZE', 'Z7', 'ZA', 'ZC', 'ZF', 'ZG', 'ZH', 'ZI', 'ZJ',
  'ZK', 'ZL', 'ZM', 'ZN', 'ZO', 'ZP', 'ZQ', 'ZR', 'ZS', 'ZT', 'ZU', 'ZV',
  'ZW', 'ZX', 'ZY', 'Z0', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z8', 'Z9',
  'XX', 'TT', 'TEST',
]);
const EXCLUDED_CODES = new Set(['UNK', '00', '0', '', 'NULL', 'NONE', 'N/A', '97', '98']);

function canonicalRepartidorCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,2}$/.test(raw) || raw === 'ALL') return '';
  return /^\d{1,2}$/.test(raw) ? raw.padStart(2, '0') : raw;
}

function normalizeFleetRows(rows) {
  const byCode = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = canonicalRepartidorCode(row?.CODE ?? row?.code);
    const name = String(row?.NAME ?? row?.name ?? code).trim();
    if (!code || EXCLUDED_CODES.has(code)) continue;
    if (EXCLUDED_PREFIXES.some((prefix) => code.startsWith(prefix))) continue;
    if (name.toUpperCase().startsWith('ZZ')) continue;
    byCode.set(code, Object.freeze({ code, name: name || code }));
  }
  return Object.freeze([...byCode.values()].sort((left, right) =>
    left.code.localeCompare(right.code, undefined, { numeric: true })));
}

function createRepartidorFleetDirectory({ execute, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  if (typeof execute !== 'function') {
    throw new TypeError('repartidor fleet directory requires an execute function');
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 0 || typeof now !== 'function') {
    throw new TypeError('invalid repartidor fleet cache configuration');
  }

  let cached = null;
  let expiresAt = 0;
  let inFlight = null;

  async function list() {
    const currentTime = Number(now());
    if (cached && currentTime < expiresAt) return cached;
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(() => execute(REPARTIDOR_FLEET_SQL))
      .then((rows) => {
        const normalized = normalizeFleetRows(rows);
        cached = normalized;
        expiresAt = Number(now()) + ttlMs;
        return normalized;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return Object.freeze({
    list,
    invalidate() {
      cached = null;
      expiresAt = 0;
    },
  });
}

module.exports = {
  DEFAULT_TTL_MS,
  REPARTIDOR_FLEET_SQL,
  canonicalRepartidorCode,
  createRepartidorFleetDirectory,
  normalizeFleetRows,
};
