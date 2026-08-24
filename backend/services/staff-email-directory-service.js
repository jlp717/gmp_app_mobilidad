'use strict';

/**
 * Live staff email directory from ERP (DSEDAC.VDD / VDDX).
 * Role targets store vendor codes and/or name matches — never hardcoded emails.
 *
 * NAME_MATCH rules:
 * - plain "LACAL" → search by name first, then vendor code fallback
 * - "!CORBALAN" → name required; if no match, skip (never wrong vendor fallback)
 */

const { queryWithParams } = require('../config/db');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const logger = require('../middleware/logger');

const CACHE_TTL_MS = Math.min(
  10 * 60 * 1000,
  Math.max(0, Number(process.env.STAFF_EMAIL_CACHE_TTL_MS) || 10 * 60 * 1000),
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VENDOR_CODE_RE = /^[A-Za-z0-9]{1,2}$/;
const ROLE_KEY_RE = /^[A-Z][A-Z0-9_]{1,39}$/;

const VARIANCE_ROLE_KEYS = Object.freeze([  'CARLOS_CORBALAN',
  'JAVIER_LACAL',
]);

const LIQUIDACION_ROLE_KEYS = Object.freeze([  'CARLOS_CORBALAN',
  'JAVIER_LACAL',
]);

/** @type {Map<string, { value: any, expiresAt: number }>} */
const cache = new Map();

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeVendorCode(value) {
  const raw = normalizeText(value).toUpperCase();
  if (!raw || !VENDOR_CODE_RE.test(raw)) return '';
  return raw;
}

function rowValue(row, key) {
  if (!row) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(row, lower)) return row[lower];
  const upper = key.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(row, upper)) return row[upper];
  return undefined;
}

function isValidEmail(value) {
  const email = normalizeText(value);
  return EMAIL_RE.test(email) ? email : '';
}

function parseNameMatch(raw) {
  const text = normalizeText(raw);
  if (!text) return { token: '', requireName: false };
  if (text.startsWith('!')) {
    return { token: text.slice(1).trim().toUpperCase(), requireName: true };
  }
  return { token: text.toUpperCase(), requireName: false };
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (CACHE_TTL_MS <= 0) return value;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function clearCache() {
  cache.clear();
}

function notificationTables(env = process.env) {
  const runtime = resolveRepartoRuntime(env);
  const tables = runtime?.tables?.notifications;
  if (!runtime.valid || !tables?.roleTargets) {
    throw new Error('Notification role targets table unavailable in reparto runtime');
  }
  return tables;
}

/**
 * Live lookup by vendor code: VDDX then V_DIM_VENDEDOR.
 * @returns {Promise<{ email: string|null, nombre: string|null, vendorCode: string }>}
 */
async function resolveVendorProfile(vendorCode, { query = queryWithParams } = {}) {
  const code = normalizeVendorCode(vendorCode);
  if (!code) {
    return { email: null, nombre: null, vendorCode: '' };
  }

  const cacheKey = `vendorProfile:${code}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const vddxSql = `
    SELECT TRIM(X.CORREOELECTRONICO) AS EMAIL,
           TRIM(V.NOMBREVENDEDOR) AS NOMBRE
      FROM DSEDAC.VDDX X
      LEFT JOIN DSEDAC.VDD V ON TRIM(V.CODIGOVENDEDOR) = TRIM(X.CODIGOVENDEDOR)
     WHERE TRIM(X.CODIGOVENDEDOR) = ?
     FETCH FIRST 1 ROW ONLY
  `;
  let rows = [];
  try {
    rows = await query(vddxSql, [code]);
  } catch (error) {
    logger.warn(`[staff-email] VDDX lookup failed for ${code}: ${error.message}`);
  }

  let email = isValidEmail(rowValue(rows?.[0], 'EMAIL'));
  let nombre = normalizeText(rowValue(rows?.[0], 'NOMBRE')) || null;

  if (!email) {
    const dimSql = `
      SELECT TRIM(CORREOELECTRONICO) AS EMAIL,
             TRIM(NOMBREVENDEDOR) AS NOMBRE
        FROM JAVIER.V_DIM_VENDEDOR
       WHERE TRIM(CODIGOVENDEDOR) = ?
       FETCH FIRST 1 ROW ONLY
    `;
    try {
      rows = await query(dimSql, [code]);
      email = isValidEmail(rowValue(rows?.[0], 'EMAIL'));
      if (!nombre) nombre = normalizeText(rowValue(rows?.[0], 'NOMBRE')) || null;
    } catch (error) {
      logger.warn(`[staff-email] V_DIM_VENDEDOR lookup failed for ${code}: ${error.message}`);
    }
  }

  if (!email) {
    logger.warn(`[staff-email] No live email for vendor ${code} (${nombre || 'sin nombre'}) — skip`);
  }

  return cacheSet(cacheKey, { email: email || null, nombre, vendorCode: code });
}

/** Back-compat: returns email string or null. */
async function resolveVendorEmail(vendorCode, opts = {}) {
  const profile = await resolveVendorProfile(vendorCode, opts);
  return profile.email;
}

/**
 * Resolve vendor by fragment of NOMBREVENDEDOR (ERP master). Prefer row with email.
 */
async function resolveVendorByNameMatch(nameToken, { query = queryWithParams } = {}) {
  const token = normalizeText(nameToken).toUpperCase();
  if (token.length < 3) return null;

  const cacheKey = `name:${token}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const sql = `
    SELECT TRIM(V.CODIGOVENDEDOR) AS CODIGO,
           TRIM(V.NOMBREVENDEDOR) AS NOMBRE,
           TRIM(X.CORREOELECTRONICO) AS EMAIL
      FROM DSEDAC.VDD V
      LEFT JOIN DSEDAC.VDDX X ON TRIM(V.CODIGOVENDEDOR) = TRIM(X.CODIGOVENDEDOR)
     WHERE UPPER(V.NOMBREVENDEDOR) LIKE ?
     ORDER BY CASE WHEN NULLIF(TRIM(X.CORREOELECTRONICO), '') IS NULL THEN 1 ELSE 0 END,
              V.CODIGOVENDEDOR
     FETCH FIRST 10 ROWS ONLY
  `;
  let rows = [];
  try {
    rows = await query(sql, [`%${token}%`]);
  } catch (error) {
    logger.warn(`[staff-email] name match failed for ${token}: ${error.message}`);
    return cacheSet(cacheKey, null);
  }

  if (!rows || rows.length === 0) {
    logger.warn(`[staff-email] NAME_MATCH '${token}' found 0 vendors in DSEDAC.VDD`);
    return cacheSet(cacheKey, null);
  }

  // Prefer exact-ish token presence + email
  const ranked = rows.map((row) => {
    const email = isValidEmail(rowValue(row, 'EMAIL'));
    const nombre = normalizeText(rowValue(row, 'NOMBRE'));
    const code = normalizeVendorCode(rowValue(row, 'CODIGO'));
    return { email: email || null, nombre, vendorCode: code };
  }).filter((row) => row.vendorCode);

  const withEmail = ranked.find((row) => row.email);
  const chosen = withEmail || ranked[0];
  if (rows.length > 1) {
    logger.info(
      `[staff-email] NAME_MATCH '${token}' matched ${rows.length} vendors; using ${chosen.vendorCode} ${chosen.nombre}`,
    );
  }
  if (!chosen.email) {
    logger.warn(`[staff-email] NAME_MATCH '${token}' → ${chosen.vendorCode} has empty VDDX email`);
  }
  return cacheSet(cacheKey, chosen);
}

/**
 * Read NOTIFICATION_ROLE_TARGETS then resolve emails from ERP.
 */
async function resolveRoleEmails(roleKeys, {
  query = queryWithParams,
  env = process.env,
} = {}) {
  const keys = [...new Set(
    (Array.isArray(roleKeys) ? roleKeys : [])
      .map((key) => normalizeText(key).toUpperCase())
      .filter((key) => ROLE_KEY_RE.test(key)),
  )];
  if (keys.length === 0) return [];

  const cacheKey = `roles:${keys.slice().sort().join(',')}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const tables = notificationTables(env);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `
    SELECT TRIM(ROLE_KEY) AS ROLE_KEY,
           TRIM(VENDOR_CODE) AS VENDOR_CODE,
           TRIM(NAME_MATCH) AS NAME_MATCH
      FROM ${tables.roleTargets}
     WHERE ACTIVE = 'S'
       AND TRIM(ROLE_KEY) IN (${placeholders})
  `;
  let rows = [];
  try {
    rows = await query(sql, keys);
  } catch (error) {
    logger.warn(`[staff-email] role targets query failed: ${error.message}`);
    return cacheSet(cacheKey, keys.map((roleKey) => ({
      roleKey,
      vendorCode: '',
      email: null,
      nombre: null,
      nameMatch: null,
      resolvedVia: null,
    })));
  }

  const byRole = new Map();
  for (const row of rows || []) {
    const roleKey = normalizeText(rowValue(row, 'ROLE_KEY')).toUpperCase();
    const vendorCode = normalizeVendorCode(rowValue(row, 'VENDOR_CODE'));
    const nameMatch = normalizeText(rowValue(row, 'NAME_MATCH')) || null;
    if (!roleKey) continue;
    byRole.set(roleKey, { roleKey, vendorCode, nameMatch });
  }

  const results = [];
  for (const roleKey of keys) {
    const target = byRole.get(roleKey);
    if (!target) {
      logger.warn(`[staff-email] role ${roleKey} not found/active in ${tables.roleTargets}`);
      results.push({
        roleKey,
        vendorCode: '',
        email: null,
        nombre: null,
        nameMatch: null,
        resolvedVia: null,
      });
      continue;
    }

    const { token, requireName } = parseNameMatch(target.nameMatch);
    let profile = null;
    let resolvedVia = null;

    if (token) {
      profile = await resolveVendorByNameMatch(token, { query });
      if (profile) resolvedVia = 'NAME_MATCH';
    }

    if (!profile && !requireName && target.vendorCode) {
      profile = await resolveVendorProfile(target.vendorCode, { query });
      resolvedVia = 'VENDOR_CODE';
    } else if (!profile && requireName) {
      logger.warn(
        `[staff-email] role ${roleKey} requires NAME_MATCH '${token}' but no ERP vendor found — `
        + 'update JAVIER.NOTIFICATION_ROLE_TARGETS (do not guess vendor code)',
      );
    }

    results.push({
      roleKey,
      vendorCode: profile?.vendorCode || target.vendorCode || '',
      email: profile?.email || null,
      nombre: profile?.nombre || null,
      nameMatch: target.nameMatch,
      resolvedVia,
    });
  }
  return cacheSet(cacheKey, results);
}

async function resolveDeliveryVarianceRecipients({
  repartidorId,
  comercialCode,
} = {}, {
  query = queryWithParams,
  env = process.env,
} = {}) {
  const emails = new Set();
  const details = [];

  async function addVendor(label, code) {
    const profile = await resolveVendorProfile(code, { query });
    details.push({
      label,
      vendorCode: profile.vendorCode,
      email: profile.email,
      nombre: profile.nombre,
    });
    if (profile.email) emails.add(profile.email.toLowerCase());
  }

  function addMissingRequired(label, value) {
    details.push({
      label,
      vendorCode: normalizeVendorCode(value),
      email: null,
      nombre: null,
    });
  }

  const repartidorCode = normalizeVendorCode(repartidorId);
  if (repartidorCode) {
    await addVendor('repartidor', repartidorCode);
  } else if (repartidorId !== undefined) {
    addMissingRequired('repartidor', repartidorId);
  }
  const comercial = normalizeVendorCode(comercialCode);
  if (comercial) {
    await addVendor('comercial', comercial);
  } else if (comercialCode !== undefined) {
    addMissingRequired('comercial', comercialCode);
  }

  const roles = await resolveRoleEmails([...VARIANCE_ROLE_KEYS], { query, env });
  for (const role of roles) {
    details.push({
      label: role.roleKey,
      vendorCode: role.vendorCode,
      email: role.email,
      nombre: role.nombre,
      resolvedVia: role.resolvedVia,
    });
    if (role.email) emails.add(role.email.toLowerCase());
  }

  const missingRequired = details.filter((detail) => !detail.email).map((detail) => detail.label);
  return { emails: [...emails], details, missingRequired };
}

function parseIsoDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeText(value));
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function uniqueVendorCodes(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeVendorCode)
      .filter(Boolean),
  )];
}

function collectComercialCodes(rows) {
  return uniqueVendorCodes(
    (Array.isArray(rows) ? rows : []).map((row) => rowValue(row, 'COMERCIAL')),
  );
}

/**
 * Comerciales of the driver's deliveries and cobros that day (CPC live).
 * Used so liquidacion PDF goes to the commercial of those routes.
 */
async function resolveDayRouteComercialCodes({
  repartidorId,
  date,
} = {}, {
  query = queryWithParams,
  env = process.env,
} = {}) {
  const driver = normalizeVendorCode(repartidorId);
  const parts = parseIsoDateParts(date);
  if (!driver || !parts) return [];

  let runtime;
  try {
    runtime = resolveRepartoRuntime(env);
  } catch (error) {
    logger.warn(`[staff-email] day comercial runtime failed: ${error.message}`);
    return [];
  }
  const confirmations = runtime?.tables?.confirmation?.confirmations;
  const cobros = runtime?.tables?.finance?.cobros;
  if (!runtime?.valid || !confirmations || !cobros) return [];

  const codes = new Set();

  try {
    const rows = await query(
      `
      SELECT DISTINCT TRIM(COALESCE(NULLIF(TRIM(CPC.CODIGOCOMERCIAL), ''), NULLIF(TRIM(CPC.CODIGOVENDEDOR), ''))) AS COMERCIAL
        FROM ${confirmations} C
        INNER JOIN DSEDAC.CPC CPC
          ON CPC.EJERCICIOALBARAN = C.DOCUMENTO_EJERCICIO
         AND TRIM(CPC.SERIEALBARAN) = TRIM(C.DOCUMENTO_SERIE)
         AND CPC.TERMINALALBARAN = C.DOCUMENTO_TERMINAL
         AND CPC.NUMEROALBARAN = C.DOCUMENTO_NUMERO
       WHERE TRIM(C.REPARTIDOR_ID) = ?
         AND DATE(C.CONFIRMED_AT) = ?
      `,
      [driver, date],
    );
    for (const code of collectComercialCodes(rows)) codes.add(code);
  } catch (error) {
    logger.warn(`[staff-email] day comercial from confirmations failed: ${error.message}`);
  }

  try {
    const rows = await query(
      `
      SELECT DISTINCT TRIM(COALESCE(NULLIF(TRIM(CPC.CODIGOCOMERCIAL), ''), NULLIF(TRIM(CPC.CODIGOVENDEDOR), ''))) AS COMERCIAL
        FROM ${cobros} P
        INNER JOIN DSEDAC.CPC CPC
          ON CPC.EJERCICIOALBARAN = P.EJERCICIODOCUMENTO
         AND TRIM(CPC.SERIEALBARAN) = TRIM(P.SERIEDOCUMENTO)
         AND CPC.TERMINALALBARAN = P.TERMINALDOCUMENTO
         AND CPC.NUMEROALBARAN = P.NUMERODOCUMENTO
       WHERE TRIM(P.CODIGOVENDEDOR) = ?
         AND P.DIACOBRO = ?
         AND P.MESCOBRO = ?
         AND P.ANOCOBRO = ?
      `,
      [driver, parts.day, parts.month, parts.year],
    );
    for (const code of collectComercialCodes(rows)) codes.add(code);
  } catch (error) {
    logger.warn(`[staff-email] day comercial from cobros failed: ${error.message}`);
  }

  return [...codes];
}

async function resolveLiquidacionRecipients({
  repartidorId,
} = {}, {
  query = queryWithParams,
  env = process.env,
} = {}) {
  const emails = new Set();
  const details = [];

  async function addVendor(label, code) {
    const profile = await resolveVendorProfile(code, { query });
    details.push({
      label,
      vendorCode: profile.vendorCode,
      email: profile.email,
      nombre: profile.nombre,
    });
    if (profile.email) emails.add(profile.email.toLowerCase());
  }

  const driver = normalizeVendorCode(repartidorId);
  if (driver) {
    await addVendor('repartidor', driver);
  } else {
    details.push({
      label: 'repartidor',
      vendorCode: '',
      email: null,
      nombre: null,
    });
  }

  const roles = await resolveRoleEmails([...LIQUIDACION_ROLE_KEYS], { query, env });
  for (const role of roles) {
    details.push({
      label: role.roleKey,
      vendorCode: role.vendorCode,
      email: role.email,
      nombre: role.nombre,
      resolvedVia: role.resolvedVia,
    });
    if (role.email) emails.add(role.email.toLowerCase());
  }

  const missingRequired = details.filter((detail) => !detail.email).map((detail) => detail.label);
  return { emails: [...emails], details, missingRequired };
}

module.exports = {
  CACHE_TTL_MS,
  VARIANCE_ROLE_KEYS,
  LIQUIDACION_ROLE_KEYS,
  resolveVendorEmail,
  resolveVendorProfile,
  resolveVendorByNameMatch,
  resolveRoleEmails,
  resolveDeliveryVarianceRecipients,
  resolveDayRouteComercialCodes,
  resolveLiquidacionRecipients,
  clearCache,
  normalizeVendorCode,
  parseNameMatch,
};
