/**
 * DB2 access for repartidor routes (G2-B1).
 * Owns ALL SQL previously embedded in backend/routes/repartidor.js.
 * Read-only against DSEDAC — no INSERT/UPDATE/DELETE/MERGE on DSEDAC.
 */
'use strict';

const { query, queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const {
  isDeliveryStatusAvailable,
  isDeliveryStatusNewSchema,
  getDeliveryStatusJoin,
  getDeliveryStatusColumns,
  getDeliveryStatusTable,
} = require('../utils/delivery-status-check');
const dayMoveRepo = require('./repartidor-rutero-day-move-db2-repository');
const { resolveRepartoRuntime, TABLE_MAPPINGS } = require('../config/reparto-runtime');

const MUTATION_RE = /\b(INSERT|UPDATE|DELETE|MERGE)\b/i;
const CANONICAL_CONFIRMATION_STATUSES = Object.freeze([
  'ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO',
]);

// Search is deliberately normalized on both sides without relying on a DB2
// UDF. Tokens remain parameterized, bounded and owner-scoped; the relaxed
// pattern only covers small omitted/extra-character typos, never fuzzy ranking.
const REPARTIDOR_SEARCH_MAX_TOKENS = 6;
const REPARTIDOR_SEARCH_TOKEN_MAX_LENGTH = 40;
const REPARTIDOR_SEARCH_REPLACEMENTS = Object.freeze([
  ['Á', 'A'], ['À', 'A'], ['Ä', 'A'], ['Â', 'A'],
  ['É', 'E'], ['È', 'E'], ['Ë', 'E'], ['Ê', 'E'],
  ['Í', 'I'], ['Ì', 'I'], ['Ï', 'I'], ['Î', 'I'],
  ['Ó', 'O'], ['Ò', 'O'], ['Ö', 'O'], ['Ô', 'O'],
  ['Ú', 'U'], ['Ù', 'U'], ['Ü', 'U'], ['Û', 'U'],
  ['Ñ', 'N'], [' ', ''], ['.', ''], [',', ''], ['-', ''],
  ['/', ''], ['\\', ''], ['_', ''], ['&', ''], ["'", ''],
  ['(', ''], [')', ''], ['[', ''], [']', ''], ['{', ''], ['}', ''],
  [';', ''], [':', ''], ['!', ''], ['?', ''], ['+', ''], ['=', ''],
  ['*', ''], ['#', ''], ['%', ''], ['@', ''], ['"', ''], ['|', ''],
  ['<', ''], ['>', ''], ['`', ''], ['~', ''], ['$', ''], ['^', ''],
]);

function normalizeRepartidorSearchTokens(search) {
  const normalized = String(search || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  if (!normalized) return [];
  return [...new Set(normalized.split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => token.slice(0, REPARTIDOR_SEARCH_TOKEN_MAX_LENGTH)))]
    .slice(0, REPARTIDOR_SEARCH_MAX_TOKENS);
}

function db2SearchSqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function db2NormalizedSearchExpression(column) {
  return REPARTIDOR_SEARCH_REPLACEMENTS.reduce(
    (expression, [from, to]) =>
      `REPLACE(${expression}, ${db2SearchSqlLiteral(from)}, ${db2SearchSqlLiteral(to)})`,
    `UPPER(COALESCE(${column}, ''))`,
  );
}

function buildFlexibleRepartidorSearch(search, columns) {
  const tokens = normalizeRepartidorSearchTokens(search);
  if (!tokens.length) return { clause: '', params: [], cacheKey: '' };
  const params = [];
  const fastSimpleSearch = tokens.length === 1 && /^[A-Z0-9]+$/.test(tokens[0]);
  const groups = tokens.map((token) => {
    const patterns = [`%${token}%`];
    if (token.length >= 4) patterns.push(`%${[...token].join('%')}%`);
    const matches = [];
    for (const column of columns) {
      // Simple ASCII tokens (the common "cha" case) avoid the nested
      // REPLACE chain; accents/punctuation keep the normalized path.
      const expression = fastSimpleSearch && /^[A-Z0-9]+$/.test(token)
        ? `UPPER(COALESCE(${column}, ''))`
        : db2NormalizedSearchExpression(column);
      for (const pattern of patterns) {
        matches.push(`${expression} LIKE ?`);
        params.push(pattern);
      }
    }
    return `(${matches.join(' OR ')})`;
  });
  return {
    clause: `AND ${groups.join(' AND ')}`,
    params,
    cacheKey: tokens.join(' '),
  };
}

const LEGACY_ROUTE_READ_TABLES = Object.freeze({
  isolated_test: Object.freeze({
    deliveries: 'JAVIER.TEST_REPARTIDOR_ENTREGAS',
    signatures: 'JAVIER.TEST_REPARTIDOR_FIRMAS',
  }),
  production: Object.freeze({
    deliveries: 'JAVIER.REPARTIDOR_ENTREGAS',
    signatures: 'JAVIER.REPARTIDOR_FIRMAS',
  }),
});

function resolveRouteTableSet() {
  try {
    const runtime = resolveRepartoRuntime(process.env);
    if (runtime?.valid && Object.hasOwn(LEGACY_ROUTE_READ_TABLES, runtime.tableSet)) return runtime.tableSet;
  } catch (_error) { /* fail closed below */ }
  const explicit = String(process.env.REPARTO_TABLE_SET || '').trim().toLowerCase();
  return explicit === 'isolated_test' ? explicit : null;
}

function resolveLegacyRouteReadTable(kind) {
  return LEGACY_ROUTE_READ_TABLES[resolveRouteTableSet()]?.[kind] || null;
}

function resolveDeliveryStatusReadTable() {
  const tableSet = resolveRouteTableSet();
  const expected = TABLE_MAPPINGS[tableSet]?.notifications?.deliveryStatus;
  if (!expected) return null;
  return getDeliveryStatusTable() === expected ? expected : null;
}

function resolveConfirmationTables() {
  try {
    const runtime = resolveRepartoRuntime(process.env);
    const confirmation = runtime?.tables?.confirmation;
    if (runtime?.valid && confirmation?.confirmations && confirmation?.evidences) {
      return confirmation;
    }
  } catch (_error) {
    // Invalid runtime: isolated tests still overlay JAVIER.TEST_*.
  }
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    return null;
  }
  return {
    confirmations: 'JAVIER.TEST_REPARTO_CONFIRMACIONES',
    lines: 'JAVIER.TEST_REPARTO_LINEAS',
    evidences: 'JAVIER.TEST_REPARTO_EVIDENCIAS',
  };
}

/// History reads ERP documents and overlays the single selected app table-set.
function resolveConfirmationReadTables() {
  const primary = resolveConfirmationTables();
  return primary ? [primary] : [];
}

function confirmationStatusOverlayTables() {
  const primary = resolveConfirmationTables();
  return primary ? [primary] : [];
}

function confirmationDocumentIdExpr(alias = 'CPC') {
  return `TRIM(VARCHAR(${alias}.EJERCICIOALBARAN)) || '-' || TRIM(${alias}.SERIEALBARAN) || '-' || TRIM(VARCHAR(${alias}.TERMINALALBARAN)) || '-' || TRIM(VARCHAR(${alias}.NUMEROALBARAN)) || '-' || TRIM(${alias}.CODIGOCLIENTEALBARAN)`;
}

function confirmationOverlayJoins(tablesList = confirmationStatusOverlayTables()) {
  return (tablesList || []).map((tables, index) => {
    const overlayAlias = `TC${index}`;
    return `LEFT JOIN ${tables.confirmations} ${overlayAlias} ON TRIM(${overlayAlias}.DOCUMENT_ID) = ${confirmationDocumentIdExpr('CPC')}`;
  }).join('\n');
}

function confirmationOverlayDeliveredSql(tablesList = confirmationStatusOverlayTables()) {
  return (tablesList || []).map((_, index) =>
    `WHEN UPPER(TRIM(COALESCE(TC${index}.STATUS, ''))) IN ('ENTREGADO', 'NO_ENTREGADO', 'RECHAZADO') THEN 1`).join('\n                        ');
}

function confirmationOverlayStatusCases() {
  return confirmationStatusOverlayTables().map((_, index) => {
    const overlayAlias = `TC${index}`;
    return `WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(${overlayAlias}.STATUS, ''))) IN
                        ('NO_ENTREGADO', 'RECHAZADO') THEN 1 ELSE 0 END) = 1 THEN 'NO_ENTREGADO'
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(${overlayAlias}.STATUS, ''))) = 'PARCIAL'
                        THEN 1 ELSE 0 END) = 1 THEN 'PARCIAL'
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(${overlayAlias}.STATUS, ''))) = 'ENTREGADO'
                        THEN 1 ELSE 0 END) = 1 THEN 'ENTREGADO'`;
  }).join('\n                    ');
}

function confirmationByAlbaranJoin(baseAlias = 'CAC', confirmationAlias = 'C_APP') {
  const tables = confirmationStatusOverlayTables()[0];
  if (!tables) return '';
  return `LEFT JOIN ${tables.confirmations} ${confirmationAlias}
          ON ${confirmationAlias}.DOCUMENTO_EJERCICIO = ${baseAlias}.EJERCICIOALBARAN
         AND TRIM(${confirmationAlias}.DOCUMENTO_SERIE) = TRIM(${baseAlias}.SERIEALBARAN)
         AND ${confirmationAlias}.DOCUMENTO_TERMINAL = ${baseAlias}.TERMINALALBARAN
         AND ${confirmationAlias}.DOCUMENTO_NUMERO = ${baseAlias}.NUMEROALBARAN
         AND UPPER(TRIM(${confirmationAlias}.STATUS)) IN ('ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO')`;
}

function confirmationScopedOwnerJoin(repartidorIds, documentAlias = 'CPC', confirmationAlias = 'C_EFFECTIVE') {
  const ownerIds = [...new Set((repartidorIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  const tables = confirmationStatusOverlayTables()[0];
  if (!ownerIds.length || !tables) return { sql: '', params: [] };
  return {
    sql: `LEFT JOIN ${tables.confirmations} ${confirmationAlias}
              ON TRIM(${confirmationAlias}.DOCUMENT_ID) = ${confirmationDocumentIdExpr(documentAlias)}
             AND UPPER(TRIM(${confirmationAlias}.STATUS)) IN ('ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO')
             AND TRIM(${confirmationAlias}.REPARTIDOR_ID) IN (${ownerIds.map(() => '?').join(',')})`,
    params: ownerIds,
    ownerExpression: `COALESCE(NULLIF(TRIM(${confirmationAlias}.REPARTIDOR_ID), ''), TRIM(OPP.CODIGOREPARTIDOR))`,
  };
}

// IBM i exposes these ERP owner columns as fixed-width CHAR(2). The route
// authorization layer already canonicalizes numeric repartidor codes to two
// digits, so comparing the column directly preserves the business semantics
// while allowing the native access path to be considered. Applying TRIM to
// OPP.CODIGOREPARTIDOR made the cold route/history scans needlessly expensive.
function repartidorOwnerFilter(column, ids, separator = ',') {
  return `${column} IN (${ids.map(() => '?').join(separator)})`;
}

function jsonSafeScalar(value) {
  if (typeof value === 'bigint') return Number(value);
  return value;
}

function jsonSafeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const key of Object.keys(out)) {
    out[key] = jsonSafeScalar(out[key]);
  }
  return out;
}

function canonicalDocumentId(row, clientCode) {
  const ejercicio = row?.EJERCICIOALBARAN;
  const serie = String(row?.SERIEALBARAN || '').trim();
  const terminal = row?.TERMINALALBARAN;
  const numero = row?.NUMEROALBARAN;
  const cliente = String(row?.CODIGOCLIENTEALBARAN || clientCode || '').trim();
  if (!ejercicio || !serie || numero == null || numero === '' || !cliente) return '';
  return `${ejercicio}-${serie}-${terminal}-${numero}-${cliente}`;
}

async function overlayCanonicalConfirmations(rows, { repartidorIds, clientCode } = {}) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const tablesList = confirmationStatusOverlayTables();
  if (!tablesList.length) return rows;
  const documentIds = [...new Set(rows.map((row) => canonicalDocumentId(row, clientCode)).filter(Boolean))];
  const drivers = [...new Set((repartidorIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!documentIds.length || !drivers.length) return rows;
  const cobrosTable = (() => {
    const finance = resolveFinanceWriteTables();
    return allowedFinanceCobrosTable(finance?.cobros) ? finance.cobros : null;
  })();
  try {
    const documentPlaceholders = documentIds.map(() => '?').join(', ');
    const driverPlaceholders = drivers.map(() => '?').join(', ');
    const byId = new Map();
    for (const tables of tablesList) {
      const paymentSelect = cobrosTable
        ? `,
              CO.ID AS COBRO_ID,
              CO.IMPORTEVENCIMIENTO AS IMPORTE_COBRADO,
              CO.IMPORTEPENDIENTE AS IMPORTE_PENDIENTE_COBRO,
              TRIM(CO.CODIGOFORMAPAGO) AS FORMA_PAGO_COBRO`
        : `,
              CAST(NULL AS INTEGER) AS COBRO_ID,
              CAST(NULL AS DECIMAL(15, 2)) AS IMPORTE_COBRADO,
              CAST(NULL AS DECIMAL(15, 2)) AS IMPORTE_PENDIENTE_COBRO,
              CAST(NULL AS VARCHAR(10)) AS FORMA_PAGO_COBRO`;
      const paymentJoin = cobrosTable
        ? ` LEFT JOIN ${cobrosTable} CO
               ON TRIM(CO.IDEMPOTENCY_TOKEN) = TRIM(C.IDEMPOTENCY_KEY)`
        : '';
      const confirmRows = await runQueryWithParams(
        `SELECT TRIM(C.DOCUMENT_ID) AS DOCUMENT_ID,
              TRIM(C.STATUS) AS STATUS,
              C.ID,
              C.FIRMA_EVIDENCE_ID
              ${paymentSelect}
         FROM ${tables.confirmations} C
         ${paymentJoin}
        WHERE TRIM(C.DOCUMENT_ID) IN (${documentPlaceholders})
          AND TRIM(C.REPARTIDOR_ID) IN (${driverPlaceholders})`,
        [...documentIds, ...drivers],
        false,
      );
      for (const row of Array.isArray(confirmRows) ? confirmRows : []) {
        const id = String(row.DOCUMENT_ID || row.document_id || '').trim();
        const status = String(row.STATUS || row.status || '').trim().toUpperCase();
        if (!id || !CANONICAL_CONFIRMATION_STATUSES.includes(status)) continue;
        const importeCobrado = Number(row.IMPORTE_COBRADO ?? row.importe_cobrado);
        const importePendienteCobro = Number(
          row.IMPORTE_PENDIENTE_COBRO ?? row.importe_pendiente_cobro,
        );
        const hasCobro = Number.isFinite(importeCobrado) && importeCobrado > 0.004;
        const formaRaw = String(
          row.FORMA_PAGO_COBRO ?? row.forma_pago_cobro ?? '',
        ).trim().toUpperCase();
        let formaPagoCobro = null;
        if (['EF', 'EFECTIVO', 'CONTADO', 'F0'].includes(formaRaw)) formaPagoCobro = 'EFECTIVO';
        else if (['TJ', 'TARJETA', 'TPV'].includes(formaRaw)) formaPagoCobro = 'TARJETA';
        else if (['BI', 'BIZUM'].includes(formaRaw)) formaPagoCobro = 'BIZUM';
        else if (['TR', 'TRANSFERENCIA', 'TRANSFER', 'T0'].includes(formaRaw)) formaPagoCobro = 'TRANSFERENCIA';
        else if (['CH', 'CHEQUE', 'TALON'].includes(formaRaw)) formaPagoCobro = 'CHEQUE';
        else if (formaRaw) formaPagoCobro = formaRaw;
        byId.set(id, {
          status,
          confirmationId: jsonSafeScalar(row.ID ?? row.id ?? null),
          firmaEvidenceId: row.FIRMA_EVIDENCE_ID || row.firma_evidence_id || null,
          cobroId: row.COBRO_ID == null && row.cobro_id == null
            ? null
            : String(row.COBRO_ID ?? row.cobro_id),
          cobrado: hasCobro,
          importeCobrado: hasCobro ? Math.round(importeCobrado * 100) / 100 : null,
          importePendienteCobro: hasCobro && Number.isFinite(importePendienteCobro)
            ? Math.round(importePendienteCobro * 100) / 100
            : null,
          formaPagoCobro,
          cobroParcial: hasCobro
            && Number.isFinite(importePendienteCobro)
            && importePendienteCobro > 0.004,
        });
      }
    }
    if (!byId.size) return rows;
    return rows.map((row) => {
      const match = byId.get(canonicalDocumentId(row, clientCode));
      const safe = jsonSafeRow(row);
      if (!match) return safe;
      return {
        ...safe,
        CANONICAL_STATUS: match.status,
        CANONICAL_CONFIRMATION_ID: match.confirmationId,
        CANONICAL_FIRMA_EVIDENCE_ID: match.firmaEvidenceId,
        CANONICAL_COBRO_ID: match.cobroId,
        CANONICAL_COBRADO: match.cobrado,
        CANONICAL_IMPORTE_COBRADO: match.importeCobrado,
        CANONICAL_IMPORTE_PENDIENTE_COBRO: match.importePendienteCobro,
        CANONICAL_FORMA_PAGO_COBRO: match.formaPagoCobro,
        CANONICAL_COBRO_PARCIAL: match.cobroParcial,
      };
    });
  } catch (_error) {
    return rows;
  }
}

async function getCanonicalConfirmationSignature({
  year, serie, terminal, number, ownerIds,
} = {}) {
  const tablesList = resolveConfirmationReadTables();
  if (!tablesList.length) return null;
  const parsedYear = Number(year);
  const parsedTerminal = Number(terminal);
  const parsedNumber = Number(number);
  const serieNorm = String(serie || '').trim();
  if (!parsedYear || !serieNorm || !Number.isFinite(parsedNumber)) return null;
  try {
    const allowed = new Set((ownerIds || []).map((id) => String(id || '').trim()).filter(Boolean));
    let match = null;
    let evidencesTable = null;
    for (const tables of tablesList) {
      const rows = await runQueryWithParams(
        `SELECT C.ID,
              TRIM(C.STATUS) AS STATUS,
              C.FIRMA_EVIDENCE_ID,
              TRIM(C.REPARTIDOR_ID) AS REPARTIDOR_ID,
              TRIM(C.RECEPTOR_NOMBRE) AS RECEPTOR_NOMBRE,
              TRIM(C.RECEPTOR_APELLIDOS) AS RECEPTOR_APELLIDOS,
              TRIM(C.RECEPTOR_DNI) AS RECEPTOR_DNI
         FROM ${tables.confirmations} C
        WHERE C.DOCUMENTO_EJERCICIO = ?
          AND TRIM(C.DOCUMENTO_SERIE) = ?
          AND C.DOCUMENTO_TERMINAL = ?
          AND C.DOCUMENTO_NUMERO = ?
        FETCH FIRST 8 ROWS ONLY`,
        [parsedYear, serieNorm, Number.isFinite(parsedTerminal) ? parsedTerminal : 0, parsedNumber],
        false,
      );
      const found = (Array.isArray(rows) ? rows : []).find((row) => {
        const owner = String(row.REPARTIDOR_ID || row.repartidor_id || '').trim();
        return !allowed.size || allowed.has(owner);
      });
      if (found) {
        match = found;
        evidencesTable = tables.evidences;
      }
    }
    if (!match) return null;
    const evidenceId = match.FIRMA_EVIDENCE_ID || match.firma_evidence_id;
    let base64 = null;
    if (evidenceId && evidencesTable) {
      const blobs = await runQueryWithParams(
        `SELECT HEX(CONTENT_BLOB) AS CONTENT_HEX
           FROM ${evidencesTable}
          WHERE EVIDENCE_ID = ?
          FETCH FIRST 1 ROW ONLY`,
        [evidenceId],
        false,
      );
      const hex = String(blobs?.[0]?.CONTENT_HEX || blobs?.[0]?.content_hex || '').trim();
      if (hex && hex.length % 2 === 0 && /^[0-9A-Fa-f]+$/.test(hex)) {
        base64 = Buffer.from(hex, 'hex').toString('base64');
      }
    }
    return {
      confirmationId: match.ID ?? match.id ?? null,
      status: String(match.STATUS || match.status || '').trim().toUpperCase(),
      hasSignature: Boolean(base64 || evidenceId),
      base64,
      receptorNombre: String(match.RECEPTOR_NOMBRE || match.receptor_nombre || '').trim(),
      receptorApellidos: String(match.RECEPTOR_APELLIDOS || match.receptor_apellidos || '').trim(),
      receptorDni: String(match.RECEPTOR_DNI || match.receptor_dni || '').trim(),
    };
  } catch (_error) {
    return null;
  }
}

function assertReadOnlySql(sql) {
  const text = String(sql || '');
  if (MUTATION_RE.test(text)) {
    const err = new Error('repartidor-route repository rejects mutating SQL');
    err.code = 'REPARTIDOR_SQL_NOT_READONLY';
    throw err;
  }
  return text;
}

async function runQueryWithParams(sql, params, useCache = false) {
  return queryWithParams(assertReadOnlySql(sql), params, useCache);
}

async function runQuery(sql, a, b) {
  return query(assertReadOnlySql(sql), a, b);
}

async function runCached(sql, cacheKey, ttl, params) {
  return cachedQuery(queryWithParams, assertReadOnlySql(sql), cacheKey, ttl, params);
}

const INVOICE_HEADER_COLS = `
                CAC.EJERCICIOALBARAN, CAC.SERIEALBARAN, CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.TERMINALALBARAN,
                CAC.DIADOCUMENTO as DIAFACTURA, CAC.MESDOCUMENTO as MESFACTURA, CAC.ANODOCUMENTO as ANOFACTURA,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
                TRIM(CLI.NOMBREALTERNATIVO) as NOMBRECOMERCIALFACTURA,
                TRIM(CLI.NOMBRECLIENTE) as NOMBREFISCALFACTURA,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.PROVINCIA, '')) as PROVINCIACLIENTEFACTURA,
                TRIM(COALESCE(CLI.CODIGOPOSTAL, '')) as CPCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA`;

async function resolveAlbaranOwners(key) {
  const confirmationJoin = confirmationByAlbaranJoin('CAC', 'C_APP');
  return runQueryWithParams(`
        SELECT DISTINCT
            COALESCE(NULLIF(TRIM(C_APP.REPARTIDOR_ID), ''), TRIM(OPP.CODIGOREPARTIDOR)) AS OWNER_ID,
            TRIM(CAC.CODIGOVENDEDOR) AS VENDOR_ID
        FROM DSEDAC.CAC CAC
        LEFT JOIN DSEDAC.CPC CPC
            ON CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
            AND TRIM(CPC.SERIEALBARAN) = TRIM(CAC.SERIEALBARAN)
            AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
            AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
        LEFT JOIN DSEDAC.OPP OPP
            ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
            AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
        ${confirmationJoin}
        WHERE CAC.EJERCICIOALBARAN = ?
          AND TRIM(CAC.SERIEALBARAN) = ?
          AND CAC.TERMINALALBARAN = ?
          AND CAC.NUMEROALBARAN = ?
          AND CAC.NUMEROALBARAN > 0 AND CAC.NUMEROALBARAN < 900000
        FETCH FIRST 8 ROWS ONLY
    `, [key.year, key.series, key.terminal, key.number], false);
}

async function resolveInvoiceOwners(key) {
  const confirmationJoin = confirmationByAlbaranJoin('CAC', 'C_APP');
  return runQueryWithParams(`
        SELECT DISTINCT COALESCE(NULLIF(TRIM(C_APP.REPARTIDOR_ID), ''), TRIM(OPP.CODIGOREPARTIDOR)) AS OWNER_ID
        FROM DSEDAC.CAC CAC
        INNER JOIN DSEDAC.CPC CPC
            ON CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
            AND TRIM(CPC.SERIEALBARAN) = TRIM(CAC.SERIEALBARAN)
            AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
            AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
        INNER JOIN DSEDAC.OPP OPP
            ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
            AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
        ${confirmationJoin}
        WHERE CAC.EJERCICIOFACTURA = ?
          AND TRIM(CAC.SERIEFACTURA) = ?
          AND CAC.NUMEROFACTURA = ?
        FETCH FIRST 2 ROWS ONLY
    `, [key.year, key.series, key.number], false);
}

async function resolveDeliveryOwners(entregaId) {
  const table = resolveLegacyRouteReadTable('deliveries');
  if (!table) return [];
  return runQueryWithParams(`
        SELECT DISTINCT TRIM(CODIGOREPARTIDOR) AS OWNER_ID
        FROM ${table}
        WHERE ID = ?
        FETCH FIRST 2 ROWS ONLY
    `, [entregaId], false);
}

async function getCollectionsSummaryBatch(selectedMonth, selectedYear, repartidorParams) {
  const repartidorKey = repartidorParams.join(',');
  const cacheKey = `repartidor:collections:summary:${repartidorKey}:${selectedYear}:${selectedMonth}`;
  const sql = `
            WITH SOURCE_DOCUMENTS AS (
                SELECT
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) AS NOMBRE_CLIENTE,
                    TRIM(CPC.CODIGOFORMAPAGO) AS FORMA_PAGO,
                    CPC.IMPORTETOTAL,
                    ROW_NUMBER() OVER (
                        PARTITION BY CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                            TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN,
                            CPC.NUMEROALBARAN, TRIM(CPC.CODIGOCLIENTEALBARAN)
                        ORDER BY OPP.SUBEMPRESA, OPP.EJERCICIOORDENPREPARACION,
                            OPP.NUMEROORDENPREPARACION
                    ) AS DOCUMENT_RANK
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                LEFT JOIN DSEDAC.CLI CLI
                    ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
                WHERE OPP.MESREPARTO = ?
                  AND OPP.ANOREPARTO = ?
                  AND OPP.CODIGOREPARTIDOR IN (${repartidorParams.map(() => '?').join(',')})
            ),
            UNIQUE_DOCUMENTS AS (
                SELECT * FROM SOURCE_DOCUMENTS WHERE DOCUMENT_RANK = 1
            ),
            CVC_INSTALLMENTS AS (
                SELECT
                    TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
                    TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
                    TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
                    CVC.EJERCICIODOCUMENTO,
                    TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
                    CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO,
                    COALESCE(CVC.XDEDOCUMENTO, 1) AS XDEDOCUMENTO,
                    COALESCE(CVC.DEXDOCUMENTO, 1) AS DEXDOCUMENTO,
                    TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    MAX(COALESCE(CVC.IMPORTECANCELADO, 0)) AS IMPORTE_COBRADO,
                    MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0)) AS IMPORTE_PENDIENTE,
                    CASE
                        WHEN MIN(COALESCE(CVC.IMPORTECANCELADO, 0)) <> MAX(COALESCE(CVC.IMPORTECANCELADO, 0))
                          OR MIN(COALESCE(CVC.IMPORTEPENDIENTE, 0)) <> MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0))
                        THEN 1 ELSE 0
                    END AS AMBIGUOUS_INSTALLMENT
                FROM DSEDAC.CVC CVC
                INNER JOIN UNIQUE_DOCUMENTS DOC
                    ON TRIM(CVC.TIPODOCUMENTO) = 'CAC'
                    AND TRIM(CVC.ORIGENDOCUMENTO) = 'B'
                    AND TRIM(CVC.SUBEMPRESADOCUMENTO) = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND TRIM(CVC.SERIEDOCUMENTO) = DOC.SERIEALBARAN
                    AND CVC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND TRIM(CVC.CODIGOCLIENTEALBARAN) = DOC.CLIENTE
                WHERE COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
                GROUP BY CVC.TIPODOCUMENTO, CVC.ORIGENDOCUMENTO,
                    CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO,
                    CVC.SERIEDOCUMENTO, CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO, CVC.XDEDOCUMENTO,
                    CVC.DEXDOCUMENTO, CVC.CODIGOCLIENTEALBARAN
            ),
            CVC_DOCUMENTS AS (
                SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE,
                    SUM(IMPORTE_COBRADO) AS IMPORTE_COBRADO,
                    SUM(IMPORTE_PENDIENTE) AS IMPORTE_PENDIENTE,
                    SUM(AMBIGUOUS_INSTALLMENT) AS AMBIGUOUS_INSTALLMENTS
                FROM CVC_INSTALLMENTS
                GROUP BY SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE
            )
            SELECT
                DOC.CLIENTE,
                DOC.NOMBRE_CLIENTE,
                DOC.FORMA_PAGO,
                SUM(DOC.IMPORTETOTAL) AS TOTAL_COBRABLE,
                SUM(CVC_DOC.IMPORTE_COBRADO) AS TOTAL_COBRADO,
                SUM(CVC_DOC.IMPORTE_PENDIENTE) AS TOTAL_PENDIENTE,
                COUNT(*) AS NUM_DOCUMENTOS,
                SUM(CASE WHEN CVC_DOC.NUMERODOCUMENTO IS NULL THEN 0 ELSE 1 END) AS CVC_DOCUMENTOS,
                SUM(CASE WHEN COALESCE(CVC_DOC.AMBIGUOUS_INSTALLMENTS, 0) > 0 THEN 1 ELSE 0 END) AS CVC_AMBIGUOUS_DOCUMENTS
            FROM UNIQUE_DOCUMENTS DOC
            LEFT JOIN CVC_DOCUMENTS CVC_DOC
                ON CVC_DOC.SUBEMPRESADOCUMENTO = TRIM(DOC.SUBEMPRESAALBARAN)
                AND CVC_DOC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                AND CVC_DOC.SERIEDOCUMENTO = DOC.SERIEALBARAN
                AND CVC_DOC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                AND CVC_DOC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                AND CVC_DOC.CLIENTE = DOC.CLIENTE
            GROUP BY DOC.CLIENTE, DOC.NOMBRE_CLIENTE, DOC.FORMA_PAGO
            ORDER BY TOTAL_COBRABLE DESC
            FETCH FIRST 100 ROWS ONLY
        `;
  return (await runCached(sql, cacheKey, TTL.MEDIUM, [selectedMonth, selectedYear, ...repartidorParams])) || [];
}

async function getCollectionsDailyBatch(selectedYear, selectedMonth, repartidorIdList) {
  const repartidorKey = repartidorIdList.join(',');
  const cacheKey = `repartidor:collections:daily:${repartidorKey}:${selectedYear}:${selectedMonth}`;
  const sql = `
            WITH SOURCE_DOCUMENTS AS (
                SELECT
                    OPP.DIAREPARTO AS DIA,
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    CPC.IMPORTETOTAL,
                    ROW_NUMBER() OVER (
                        PARTITION BY CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                            TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN,
                            CPC.NUMEROALBARAN, TRIM(CPC.CODIGOCLIENTEALBARAN)
                        ORDER BY OPP.DIAREPARTO, OPP.SUBEMPRESA,
                            OPP.EJERCICIOORDENPREPARACION, OPP.NUMEROORDENPREPARACION
                    ) AS DOCUMENT_RANK
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                WHERE OPP.ANOREPARTO = ?
                  AND OPP.MESREPARTO = ?
                  AND OPP.CODIGOREPARTIDOR IN (${repartidorIdList.map(() => '?').join(',')})
            ),
            UNIQUE_DOCUMENTS AS (
                SELECT * FROM SOURCE_DOCUMENTS WHERE DOCUMENT_RANK = 1
            ),
            CVC_INSTALLMENTS AS (
                SELECT
                    TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
                    TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
                    TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
                    CVC.EJERCICIODOCUMENTO,
                    TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
                    CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO,
                    COALESCE(CVC.XDEDOCUMENTO, 1) AS XDEDOCUMENTO,
                    COALESCE(CVC.DEXDOCUMENTO, 1) AS DEXDOCUMENTO,
                    TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    MAX(COALESCE(CVC.IMPORTECANCELADO, 0)) AS IMPORTE_COBRADO,
                    MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0)) AS IMPORTE_PENDIENTE,
                    CASE
                        WHEN MIN(COALESCE(CVC.IMPORTECANCELADO, 0)) <> MAX(COALESCE(CVC.IMPORTECANCELADO, 0))
                          OR MIN(COALESCE(CVC.IMPORTEPENDIENTE, 0)) <> MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0))
                        THEN 1 ELSE 0
                    END AS AMBIGUOUS_INSTALLMENT
                FROM DSEDAC.CVC CVC
                INNER JOIN UNIQUE_DOCUMENTS DOC
                    ON TRIM(CVC.TIPODOCUMENTO) = 'CAC'
                    AND TRIM(CVC.ORIGENDOCUMENTO) = 'B'
                    AND TRIM(CVC.SUBEMPRESADOCUMENTO) = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND TRIM(CVC.SERIEDOCUMENTO) = DOC.SERIEALBARAN
                    AND CVC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND TRIM(CVC.CODIGOCLIENTEALBARAN) = DOC.CLIENTE
                WHERE COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
                GROUP BY CVC.TIPODOCUMENTO, CVC.ORIGENDOCUMENTO,
                    CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO,
                    CVC.SERIEDOCUMENTO, CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO, CVC.XDEDOCUMENTO,
                    CVC.DEXDOCUMENTO, CVC.CODIGOCLIENTEALBARAN
            ),
            CVC_DOCUMENTS AS (
                SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE,
                    SUM(IMPORTE_COBRADO) AS IMPORTE_COBRADO,
                    SUM(IMPORTE_PENDIENTE) AS IMPORTE_PENDIENTE,
                    SUM(AMBIGUOUS_INSTALLMENT) AS AMBIGUOUS_INSTALLMENTS
                FROM CVC_INSTALLMENTS
                GROUP BY SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE
            )
            SELECT
                DOC.DIA,
                SUM(DOC.IMPORTETOTAL) AS TOTAL_COBRABLE,
                SUM(CVC_DOC.IMPORTE_COBRADO) AS TOTAL_COBRADO,
                SUM(CVC_DOC.IMPORTE_PENDIENTE) AS TOTAL_PENDIENTE,
                COUNT(*) AS NUM_DOCUMENTOS,
                SUM(CASE WHEN CVC_DOC.NUMERODOCUMENTO IS NULL THEN 0 ELSE 1 END) AS CVC_DOCUMENTOS,
                SUM(CASE WHEN COALESCE(CVC_DOC.AMBIGUOUS_INSTALLMENTS, 0) > 0 THEN 1 ELSE 0 END) AS CVC_AMBIGUOUS_DOCUMENTS
            FROM UNIQUE_DOCUMENTS DOC
            LEFT JOIN CVC_DOCUMENTS CVC_DOC
                ON CVC_DOC.SUBEMPRESADOCUMENTO = TRIM(DOC.SUBEMPRESAALBARAN)
                AND CVC_DOC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                AND CVC_DOC.SERIEDOCUMENTO = DOC.SERIEALBARAN
                AND CVC_DOC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                AND CVC_DOC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                AND CVC_DOC.CLIENTE = DOC.CLIENTE
            GROUP BY DOC.DIA
            ORDER BY DOC.DIA
        `;
  return (await runCached(sql, cacheKey, TTL.MEDIUM, [selectedYear, selectedMonth, ...repartidorIdList])) || [];
}

// DB2 CVC joins become unstable near the 20-code mark; keep manager-wide requests bounded.
const COLLECTION_DRIVER_BATCH_SIZE = 5;

function mergeCollectionRows(groups, keyFields) {
  const numeric = ['TOTAL_COBRABLE', 'TOTAL_COBRADO', 'TOTAL_PENDIENTE', 'NUM_DOCUMENTOS', 'CVC_DOCUMENTOS', 'CVC_AMBIGUOUS_DOCUMENTS'];
  const merged = new Map();
  for (const row of groups.flat()) {
    const key = keyFields.map((field) => String(row[field] ?? '')).join('\u0001');
    const existing = merged.get(key);
    if (!existing) merged.set(key, { ...row });
    else for (const field of numeric) existing[field] = Number(existing[field] || 0) + Number(row[field] || 0);
  }
  return [...merged.values()].sort((left, right) => keyFields.map((field) => String(left[field] ?? '').localeCompare(String(right[field] ?? ''))).find(Boolean) || 0);
}

async function loadCollectionsInBatches(repartidorIds, load, keyFields) {
  const ids = [...new Set((repartidorIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const batches = [];
  for (let index = 0; index < ids.length; index += COLLECTION_DRIVER_BATCH_SIZE) batches.push(ids.slice(index, index + COLLECTION_DRIVER_BATCH_SIZE));
  const successful = [];
  let failedBatches = 0;
  for (const batch of batches) {
    try {
      successful.push((await load(batch)) || []);
    } catch (_error) {
      failedBatches += 1;
    }
  }
  if (!successful.length) {
    const error = new Error('REPARTIDOR_COLLECTIONS_UNAVAILABLE');
    error.code = 'REPARTIDOR_COLLECTIONS_UNAVAILABLE';
    throw error;
  }
  const rows = mergeCollectionRows(successful, keyFields);
  Object.defineProperty(rows, 'batchStatus', { value: failedBatches > 0 ? 'PARTIAL' : 'AVAILABLE' });
  return rows;
}

function confirmationOwnerScopeClause(repartidorIds, documentAlias = 'CPC') {
  const ownerIds = [...new Set((repartidorIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  const tablesList = confirmationStatusOverlayTables();
  if (!ownerIds.length || !tablesList.length) return { sql: '', params: [] };
  const ownerPlaceholders = ownerIds.map(() => '?').join(',');
  const statusPlaceholders = CANONICAL_CONFIRMATION_STATUSES.map(() => '?').join(',');
  const sql = tablesList.map((tables) => `OR EXISTS (
        SELECT 1
          FROM ${tables.confirmations} C_SCOPE
         WHERE TRIM(C_SCOPE.DOCUMENT_ID) = ${confirmationDocumentIdExpr(documentAlias)}
           AND UPPER(TRIM(C_SCOPE.STATUS)) IN (${statusPlaceholders})
           AND TRIM(C_SCOPE.REPARTIDOR_ID) IN (${ownerPlaceholders})
      )`).join('\n      ');
  return {
    sql,
    params: tablesList.flatMap(() => [...CANONICAL_CONFIRMATION_STATUSES, ...ownerIds]),
  };
}

async function getCollectionsSummary(selectedMonth, selectedYear, repartidorIds) {
  return loadCollectionsInBatches(repartidorIds, (batch) => getCollectionsSummaryBatch(selectedMonth, selectedYear, batch), ['CLIENTE', 'NOMBRE_CLIENTE', 'FORMA_PAGO']);
}

async function getCollectionsDaily(selectedYear, selectedMonth, repartidorIds) {
  return loadCollectionsInBatches(repartidorIds, (batch) => getCollectionsDailyBatch(selectedYear, selectedMonth, batch), ['DIA']);
}



function historyAlbaranKey(row) {
  return [String(row?.SUBEMPRESAALBARAN || '').trim(), Number(row?.EJERCICIOALBARAN || 0),
    String(row?.SERIEALBARAN || '').trim(), Number(row?.TERMINALALBARAN || 0),
    Number(row?.NUMEROALBARAN || 0)].join('|');
}
function historyDocumentKey(row) {
  return historyAlbaranKey(row) + '|' + String(row?.CODIGOCLIENTEALBARAN || '').trim();
}
function historyNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function historyLogicalKey(row) {
  const number = historyNumber(row.NUMEROFACTURA);
  if (number > 0) return 'F-' + String(row.SUBEMPRESAALBARAN || '').trim() + '-'
    + historyNumber(row.EJERCICIOFACTURA) + '-' + String(row.SERIEFACTURA || '').trim() + '-' + number;
  return 'A-' + String(row.SUBEMPRESAALBARAN || '').trim() + '-' + historyNumber(row.EJERCICIOALBARAN)
    + '-' + String(row.SERIEALBARAN || '').trim() + '-' + historyNumber(row.TERMINALALBARAN)
    + '-' + historyNumber(row.NUMEROALBARAN);
}
function buildHistoryDocumentFilter(rows, alias, columns, valuesOf) {
  const unique = new Map();
  for (const row of rows || []) {
    const values = valuesOf(row);
    const key = values.map((value) => String(value ?? '')).join('\u001f');
    if (!unique.has(key)) unique.set(key, values);
  }
  const tuples = [...unique.values()];
  return {
    clause: tuples.length ? tuples.map(() => '(' + columns.map((column) => alias + '.' + column + ' = ?').join(' AND ') + ')').join(' OR ') : '1 = 0',
    params: tuples.flat(),
  };
}

async function getClientDocumentsFast({
  repartidorIds, clientCode, yearValue, minYearValue, dateFromValue, dateToValue, pageOffset, pageLimit,
}) {
  const ids = repartidorIds;
  const scope = confirmationOwnerScopeClause(ids);
  const effective = confirmationScopedOwnerJoin(ids);
  const ownerFilter = '(' + [repartidorOwnerFilter('OPP.CODIGOREPARTIDOR', ids), scope.sql].filter(Boolean).join(' ') + ')';
  const dsJoin = getDeliveryStatusJoin('CPC', 'DS');
  const dsCols = getDeliveryStatusColumns('DS').split(/\r?\n/)
    .filter((line) => !/\bAS\s+DELIVERY_REPARTIDOR\b/i.test(line)).join('\n').replace(/,\s*$/, '');
  const dateClauses = [];
  const dateParams = [];
  if (dateFromValue) { dateClauses.push('(CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) >= ?'); dateParams.push(dateFromValue); }
  if (dateToValue) { dateClauses.push('(CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) <= ?'); dateParams.push(dateToValue); }
  const yearClauses = [];
  const yearParams = [];
  if (yearValue) { yearClauses.push('CPC.EJERCICIOALBARAN = ?'); yearParams.push(yearValue); }
  else if (minYearValue) { yearClauses.push('CPC.EJERCICIOALBARAN >= ?'); yearParams.push(minYearValue); }

  const baseSql = [
    'WITH SOURCE_DOCUMENTS AS (',
    ' SELECT CPC.SUBEMPRESAALBARAN,CPC.EJERCICIOALBARAN,TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,CPC.TERMINALALBARAN,CPC.NUMEROALBARAN,',
    ' CPC.ANODOCUMENTO AS ANO,CPC.MESDOCUMENTO AS MES,CPC.DIADOCUMENTO AS DIA,TRIM(CPC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTEALBARAN,',
    ' ' + (effective.ownerExpression || 'TRIM(OPP.CODIGOREPARTIDOR)') + ' AS DELIVERY_REPARTIDOR,',
    ' OPP.NUMEROORDENPREPARACION AS PREPARATION_ORDER_NUMBER,OPP.EJERCICIOORDENPREPARACION AS PREPARATION_ORDER_YEAR,',
    ' CPC.IMPORTETOTAL,CPC.CONFORMADOSN,CPC.SITUACIONALBARAN,CPC.HORALLEGADA,CPC.HORACREACION,' + dsCols + ',',
    ' ROW_NUMBER() OVER (PARTITION BY CPC.SUBEMPRESAALBARAN,CPC.EJERCICIOALBARAN,TRIM(CPC.SERIEALBARAN),CPC.TERMINALALBARAN,CPC.NUMEROALBARAN,TRIM(CPC.CODIGOCLIENTEALBARAN)',
    ' ORDER BY OPP.EJERCICIOORDENPREPARACION DESC,OPP.NUMEROORDENPREPARACION DESC,OPP.SUBEMPRESA) AS ALBARAN_RANK',
    ' FROM DSEDAC.OPP OPP INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION=OPP.NUMEROORDENPREPARACION',
    ' AND CPC.SUBEMPRESAPEDIDO=OPP.SUBEMPRESA AND CPC.EJERCICIOORDENPREPARACION=OPP.EJERCICIOORDENPREPARACION',
    effective.sql, dsJoin,
    ' WHERE CPC.CODIGOCLIENTEALBARAN=? AND ' + ownerFilter + ' AND CPC.NUMEROALBARAN<900000 AND CPC.EJERCICIOALBARAN>0',
    ...(yearClauses.length ? [' AND ' + yearClauses.join(' AND ')] : []),
    ...(dateClauses.length ? [' AND ' + dateClauses.join(' AND ')] : []),
    '), UNIQUE_DOCUMENTS AS (SELECT * FROM SOURCE_DOCUMENTS WHERE ALBARAN_RANK=1) SELECT * FROM UNIQUE_DOCUMENTS',
  ].join('\n');
  const baseParams = [...effective.params, clientCode, ...ids, ...scope.params, ...yearParams, ...dateParams];
  const sortedIds = [...ids].map((id) => String(id).trim()).sort();
  const cacheKey = ['client-documents-fast-v1', sortedIds.join(','), String(clientCode || '').trim(),
    yearValue || minYearValue || '', dateFromValue || '', dateToValue || ''].join(':');
  const started = Date.now();
  const baseRows = await cachedQuery(queryWithParams, baseSql, {
    cacheKey, prefix: 'repartidor:history-base', ttl: TTL.REALTIME, role: 'REPARTIDOR',
    vendorCode: sortedIds.join(','), params: { ids: sortedIds, clientCode: String(clientCode || '').trim(),
      yearValue: yearValue || null, minYearValue: minYearValue || null, dateFromValue: dateFromValue || null,
      dateToValue: dateToValue || null, queryType: 'repartidor_history_base' },
    dateFrom: dateFromValue || null, dateTo: dateToValue || null, queryType: 'repartidor_history_base',
  }, baseParams);
  logger.info('[PERF] /history/documents stage=base client=' + (clientCode || '-') + ' rows=' + (baseRows?.length || 0) + ' db/cache=' + (Date.now() - started) + 'ms');
  const uniqueRows = Array.isArray(baseRows) ? baseRows : [];
  if (!uniqueRows.length) return [{ META_ONLY: 1, TOTAL_COUNT: 0 }];

  // The old composite OR predicate generated six bound parameters per
  // document. DB2 for i prepared that statement slowly even when the client
  // only had a small number of documents. Scope the ERP read by the same
  // client/year constraints as the base scan, then keep the exact natural-key
  // match in JS. This preserves correctness without forcing a wide OR plan.
  const invoiceWhere = ['TRIM(CAC.CODIGOCLIENTEALBARAN) = ?', 'CAC.NUMEROALBARAN < 900000'];
  const invoiceParams = [clientCode];
  if (yearValue) { invoiceWhere.push('CAC.EJERCICIOALBARAN = ?'); invoiceParams.push(yearValue); }
  else if (minYearValue) { invoiceWhere.push('CAC.EJERCICIOALBARAN >= ?'); invoiceParams.push(minYearValue); }
  const invoiceRows = await runQueryWithParams([
    'SELECT CAC.SUBEMPRESAALBARAN,CAC.EJERCICIOALBARAN,TRIM(CAC.SERIEALBARAN) AS SERIEALBARAN,CAC.TERMINALALBARAN,CAC.NUMEROALBARAN,',
    ' TRIM(CAC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTEALBARAN,MAX(CAC.IMPORTETOTAL) AS IMPORTETOTAL_FACTURA,',
    ' MAX(COALESCE(CAC.NUMEROFACTURA,0)) AS NUMEROFACTURA,MAX(COALESCE(TRIM(CAC.SERIEFACTURA), \'\')) AS SERIEFACTURA,',
    ' MAX(COALESCE(CAC.EJERCICIOFACTURA,0)) AS EJERCICIOFACTURA FROM DSEDAC.CAC CAC WHERE ' + invoiceWhere.join(' AND '),
    ' GROUP BY CAC.SUBEMPRESAALBARAN,CAC.EJERCICIOALBARAN,TRIM(CAC.SERIEALBARAN),CAC.TERMINALALBARAN,CAC.NUMEROALBARAN,TRIM(CAC.CODIGOCLIENTEALBARAN)',
  ].join('\n'), invoiceParams, false);
  const invoices = new Map((invoiceRows || []).map((row) => [historyDocumentKey(row), row]));
  const rowsWithInvoice = uniqueRows.map((row) => {
    const invoice = invoices.get(historyDocumentKey(row)) || {};
    return { ...row, IMPORTETOTAL_FACTURA: invoice.IMPORTETOTAL_FACTURA ?? null,
      NUMEROFACTURA: historyNumber(invoice.NUMEROFACTURA), SERIEFACTURA: String(invoice.SERIEFACTURA || '').trim(),
      EJERCICIOFACTURA: historyNumber(invoice.EJERCICIOFACTURA) };
  });
  const groups = new Map();
  for (const row of rowsWithInvoice) {
    const key = historyLogicalKey(row);
    const date = historyNumber(row.ANO) * 10000 + historyNumber(row.MES) * 100 + historyNumber(row.DIA);
    const number = historyNumber(row.NUMEROFACTURA) > 0 ? historyNumber(row.NUMEROFACTURA) : historyNumber(row.NUMEROALBARAN);
    const group = groups.get(key) || { key, sortDate: 0, sortNumber: 0 };
    group.sortDate = Math.max(group.sortDate, date); group.sortNumber = Math.max(group.sortNumber, number); groups.set(key, group);
  }
  const sortedGroups = [...groups.values()].sort((a,b) => b.sortDate-a.sortDate || b.sortNumber-a.sortNumber || b.key.localeCompare(a.key));
  const totalDocuments = sortedGroups.length;
  const positions = new Map(sortedGroups.map((group,index) => [group.key, index + 1]));
  const selected = new Set(sortedGroups.slice(pageOffset, pageOffset + pageLimit).map((group) => group.key));
  const pageRows = rowsWithInvoice.filter((row) => selected.has(historyLogicalKey(row))).sort((a,b) => {
    const da = historyNumber(a.ANO) * 10000 + historyNumber(a.MES) * 100 + historyNumber(a.DIA);
    const db = historyNumber(b.ANO) * 10000 + historyNumber(b.MES) * 100 + historyNumber(b.DIA);
    return db - da || historyNumber(b.NUMEROALBARAN) - historyNumber(a.NUMEROALBARAN);
  });
  if (!pageRows.length) return [{ META_ONLY: 1, TOTAL_COUNT: totalDocuments }];

  const cvcFilter = buildHistoryDocumentFilter(pageRows, 'CVC',
    ['SUBEMPRESADOCUMENTO','EJERCICIODOCUMENTO','SERIEDOCUMENTO','TERMINALDOCUMENTO','NUMERODOCUMENTO','CODIGOCLIENTEALBARAN'],
    (row) => [row.SUBEMPRESAALBARAN,row.EJERCICIOALBARAN,row.SERIEALBARAN,row.TERMINALALBARAN,row.NUMEROALBARAN,row.CODIGOCLIENTEALBARAN]);
  const signatureFilter = buildHistoryDocumentFilter(pageRows, 'CF',
    ['EJERCICIOALBARAN','SERIEALBARAN','TERMINALALBARAN','NUMEROALBARAN'],
    (row) => [row.EJERCICIOALBARAN,row.SERIEALBARAN,row.TERMINALALBARAN,row.NUMEROALBARAN]);
  const [cvcRows, signatureRows] = await Promise.all([
    runQueryWithParams([
      'WITH CVC_INSTALLMENTS AS (SELECT TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,CVC.EJERCICIODOCUMENTO,',
      ' TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,CVC.TERMINALDOCUMENTO,CVC.NUMERODOCUMENTO,COALESCE(CVC.XDEDOCUMENTO,1) AS XDEDOCUMENTO,',
      ' COALESCE(CVC.DEXDOCUMENTO,1) AS DEXDOCUMENTO,TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,MAX(COALESCE(CVC.IMPORTEPENDIENTE,0)) AS IMPORTE_PENDIENTE,',
      ' CASE WHEN MIN(COALESCE(CVC.IMPORTEPENDIENTE,0))<>MAX(COALESCE(CVC.IMPORTEPENDIENTE,0)) THEN 1 ELSE 0 END AS AMBIGUOUS_INSTALLMENT',
      ' FROM DSEDAC.CVC CVC WHERE COALESCE(TRIM(CVC.ANULADOSN),\'\')<>\'S\' AND TRIM(CVC.TIPODOCUMENTO)=\'CAC\' AND TRIM(CVC.ORIGENDOCUMENTO)=\'B\' AND (' + cvcFilter.clause + ')',
      ' GROUP BY CVC.SUBEMPRESADOCUMENTO,CVC.EJERCICIODOCUMENTO,CVC.SERIEDOCUMENTO,CVC.TERMINALDOCUMENTO,CVC.NUMERODOCUMENTO,CVC.XDEDOCUMENTO,CVC.DEXDOCUMENTO,CVC.CODIGOCLIENTEALBARAN)',
      ' SELECT SUBEMPRESADOCUMENTO,EJERCICIODOCUMENTO,SERIEDOCUMENTO,TERMINALDOCUMENTO,NUMERODOCUMENTO,CLIENTE,SUM(IMPORTE_PENDIENTE) AS IMPORTE_PENDIENTE,SUM(AMBIGUOUS_INSTALLMENT) AS AMBIGUOUS_INSTALLMENTS',
      ' FROM CVC_INSTALLMENTS GROUP BY SUBEMPRESADOCUMENTO,EJERCICIODOCUMENTO,SERIEDOCUMENTO,TERMINALDOCUMENTO,NUMERODOCUMENTO,CLIENTE',
    ].join('\n'), cvcFilter.params, false),
    runQueryWithParams([
      'SELECT CF.EJERCICIOALBARAN,TRIM(CF.SERIEALBARAN) AS SERIEALBARAN,CF.TERMINALALBARAN,CF.NUMEROALBARAN,',
      ' MAX(COALESCE(CF.FIRMANOMBRE,\'\')) AS LEGACY_FIRMA_NOMBRE,MAX(CF.DIA) AS LEGACY_DIA,MAX(CF.MES) AS LEGACY_MES,MAX(CF.ANO) AS LEGACY_ANO,MAX(CF.HORA) AS LEGACY_HORA',
      ' FROM DSEDAC.CACFIRMAS CF WHERE ' + signatureFilter.clause,
      ' GROUP BY CF.EJERCICIOALBARAN,TRIM(CF.SERIEALBARAN),CF.TERMINALALBARAN,CF.NUMEROALBARAN',
    ].join('\n'), signatureFilter.params, false),
  ]);
  const cvcByKey = new Map((cvcRows || []).map((row) => [[String(row.SUBEMPRESADOCUMENTO || '').trim(),historyNumber(row.EJERCICIODOCUMENTO),
    String(row.SERIEDOCUMENTO || '').trim(),historyNumber(row.TERMINALDOCUMENTO),historyNumber(row.NUMERODOCUMENTO),String(row.CLIENTE || '').trim()].join('|'), row]));
  const signatureByKey = new Map((signatureRows || []).map((row) => [[historyNumber(row.EJERCICIOALBARAN),String(row.SERIEALBARAN || '').trim(),
    historyNumber(row.TERMINALALBARAN),historyNumber(row.NUMEROALBARAN)].join('|'), row]));
  return pageRows.map((row) => {
    const cvc = cvcByKey.get(historyDocumentKey(row));
    const signature = signatureByKey.get([historyNumber(row.EJERCICIOALBARAN),String(row.SERIEALBARAN || '').trim(),
      historyNumber(row.TERMINALALBARAN),historyNumber(row.NUMEROALBARAN)].join('|'));
    const cvcAvailable = Boolean(cvc) && historyNumber(cvc.AMBIGUOUS_INSTALLMENTS) === 0;
    return { ...row, CVC_PRESENT: cvcAvailable ? 1 : 0, CVC_PENDING: cvcAvailable ? historyNumber(cvc.IMPORTE_PENDIENTE) : null,
      LEGACY_FIRMA_NOMBRE: String(signature?.LEGACY_FIRMA_NOMBRE || '').trim(), LEGACY_DIA: historyNumber(signature?.LEGACY_DIA),
      LEGACY_MES: historyNumber(signature?.LEGACY_MES), LEGACY_ANO: historyNumber(signature?.LEGACY_ANO), LEGACY_HORA: historyNumber(signature?.LEGACY_HORA),
      TOTAL_COUNT: totalDocuments, LOGICAL_POSITION: positions.get(historyLogicalKey(row)), META_ONLY: 0 };
  });
}
async function getClientDocuments(options) {
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'test') return getClientDocumentsFast(options);
  return getClientDocumentsLegacy(options);
}

async function getClientDocumentsLegacy({
  repartidorIds,
  clientCode,
  yearValue,
  minYearValue,
  dateFromValue,
  dateToValue,
  pageOffset,
  pageLimit,
}) {
  const ids = repartidorIds;
  const confirmationScope = confirmationOwnerScopeClause(ids);
  const effectiveOwnerJoin = confirmationScopedOwnerJoin(ids);
  const ownerFilter = `(
                ${repartidorOwnerFilter('OPP.CODIGOREPARTIDOR', ids)}
                ${confirmationScope.sql}
            )`;
  const repartidorJoin = `
            INNER JOIN DSEDAC.OPP OPP
                ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
                AND OPP.SUBEMPRESA = CPC.SUBEMPRESAPEDIDO
                AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
            `;

  let dateFilter = '';
  const dateParams = [];
  if (dateFromValue) {
    dateFilter += ` AND (CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) >= ?`;
    dateParams.push(dateFromValue);
  }
  if (dateToValue) {
    dateFilter += ` AND (CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) <= ?`;
    dateParams.push(dateToValue);
  }

  const dsJoin = getDeliveryStatusJoin('CPC', 'DS');
  // The effective-owner overlay below supplies DELIVERY_REPARTIDOR. The
  // delivery-status helper also exposes a column with that name when its
  // table is unavailable/legacy, which produces duplicate CTE column names
  // and DB2 SQLSTATE 42000/-104 during statement preparation.
  const dsCols = getDeliveryStatusColumns('DS')
    .split(/\r?\n/)
    .filter((line) => !/\bAS\s+DELIVERY_REPARTIDOR\b/i.test(line))
    .join('\n')
    .replace(/,\s*$/, '');
  const dsAvail = isDeliveryStatusAvailable();

  // Prefer an exact year, otherwise a bounded window (UI "últimos 3 años").
  // Unscoped history scans routinely timed out at ~29s on production.
  let yearFilter = '';
  const yearFilterParams = [];
  if (yearValue) {
    yearFilter = ` AND CPC.EJERCICIOALBARAN = ?`;
    yearFilterParams.push(yearValue);
  } else if (minYearValue) {
    yearFilter = ` AND CPC.EJERCICIOALBARAN >= ?`;
    yearFilterParams.push(minYearValue);
  }

  // Keep the source scan lean: page first, then attach CVC pending + legacy
  // signatures only for the returned logical page (not the whole history).
  const sql = `
            WITH SOURCE_DOCUMENTS AS (
                SELECT
                    CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,
                    CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                    CPC.ANODOCUMENTO AS ANO, CPC.MESDOCUMENTO AS MES,
                    CPC.DIADOCUMENTO AS DIA,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTEALBARAN,
                    ${effectiveOwnerJoin.ownerExpression || 'TRIM(OPP.CODIGOREPARTIDOR)'} AS DELIVERY_REPARTIDOR,
                    OPP.NUMEROORDENPREPARACION AS PREPARATION_ORDER_NUMBER,
                    OPP.EJERCICIOORDENPREPARACION AS PREPARATION_ORDER_YEAR,
                    CPC.IMPORTETOTAL,
                    CPC.CONFORMADOSN, CPC.SITUACIONALBARAN,
                    CPC.HORALLEGADA, CPC.HORACREACION,
                    ${dsCols},

                    ROW_NUMBER() OVER (
                        PARTITION BY CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                            TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN,
                            CPC.NUMEROALBARAN, TRIM(CPC.CODIGOCLIENTEALBARAN)
                        ORDER BY OPP.EJERCICIOORDENPREPARACION DESC,
                            OPP.NUMEROORDENPREPARACION DESC, OPP.SUBEMPRESA
                    ) AS ALBARAN_RANK
                FROM DSEDAC.CPC CPC
                ${repartidorJoin}
                ${effectiveOwnerJoin.sql}
                ${dsJoin}

                WHERE CPC.CODIGOCLIENTEALBARAN = ?
                  AND ${ownerFilter}
                  AND CPC.NUMEROALBARAN < 900000
                  AND CPC.EJERCICIOALBARAN > 0
                  ${yearFilter}
                  ${dateFilter}
            ),
            UNIQUE_DOCUMENTS AS (
                SELECT * FROM SOURCE_DOCUMENTS WHERE ALBARAN_RANK = 1
            ),
            INVOICE_HEADERS AS (
                SELECT
                    DOC.SUBEMPRESAALBARAN, DOC.EJERCICIOALBARAN,
                    DOC.SERIEALBARAN, DOC.TERMINALALBARAN,
                    DOC.NUMEROALBARAN, DOC.CODIGOCLIENTEALBARAN,
                    MAX(CAC_J.IMPORTETOTAL) AS IMPORTETOTAL_FACTURA,
                    MAX(COALESCE(CAC_J.NUMEROFACTURA, 0)) AS NUMEROFACTURA,
                    MAX(COALESCE(TRIM(CAC_J.SERIEFACTURA), '')) AS SERIEFACTURA,
                    MAX(COALESCE(CAC_J.EJERCICIOFACTURA, 0)) AS EJERCICIOFACTURA
                FROM UNIQUE_DOCUMENTS DOC
                LEFT JOIN DSEDAC.CAC CAC_J
                    ON CAC_J.SUBEMPRESAALBARAN = DOC.SUBEMPRESAALBARAN
                    AND CAC_J.EJERCICIOALBARAN = DOC.EJERCICIOALBARAN
                    AND CAC_J.SERIEALBARAN = DOC.SERIEALBARAN
                    AND CAC_J.TERMINALALBARAN = DOC.TERMINALALBARAN
                    AND CAC_J.NUMEROALBARAN = DOC.NUMEROALBARAN
                    AND CAC_J.CODIGOCLIENTEALBARAN = DOC.CODIGOCLIENTEALBARAN
                GROUP BY DOC.SUBEMPRESAALBARAN, DOC.EJERCICIOALBARAN,
                    DOC.SERIEALBARAN, DOC.TERMINALALBARAN,
                    DOC.NUMEROALBARAN, DOC.CODIGOCLIENTEALBARAN
            ),
            DOCUMENTS_WITH_INVOICE AS (
                SELECT DOC.*,
                    HEAD.IMPORTETOTAL_FACTURA,
                    COALESCE(HEAD.NUMEROFACTURA, 0) AS NUMEROFACTURA,
                    COALESCE(HEAD.SERIEFACTURA, '') AS SERIEFACTURA,
                    COALESCE(HEAD.EJERCICIOFACTURA, 0) AS EJERCICIOFACTURA
                FROM UNIQUE_DOCUMENTS DOC
                LEFT JOIN INVOICE_HEADERS HEAD
                    ON HEAD.SUBEMPRESAALBARAN = DOC.SUBEMPRESAALBARAN
                    AND HEAD.EJERCICIOALBARAN = DOC.EJERCICIOALBARAN
                    AND HEAD.SERIEALBARAN = DOC.SERIEALBARAN
                    AND HEAD.TERMINALALBARAN = DOC.TERMINALALBARAN
                    AND HEAD.NUMEROALBARAN = DOC.NUMEROALBARAN
                    AND HEAD.CODIGOCLIENTEALBARAN = DOC.CODIGOCLIENTEALBARAN
            ),
            DOCUMENT_ROWS AS (
                SELECT DOC.*,
                    CASE WHEN DOC.NUMEROFACTURA > 0 THEN
                        'F-' || TRIM(CHAR(DOC.SUBEMPRESAALBARAN)) || '-' ||
                        TRIM(CHAR(DOC.EJERCICIOFACTURA)) || '-' ||
                        DOC.SERIEFACTURA || '-' || TRIM(CHAR(DOC.NUMEROFACTURA))
                    ELSE
                        'A-' || TRIM(CHAR(DOC.SUBEMPRESAALBARAN)) || '-' ||
                        TRIM(CHAR(DOC.EJERCICIOALBARAN)) || '-' ||
                        DOC.SERIEALBARAN || '-' || TRIM(CHAR(DOC.TERMINALALBARAN)) ||
                        '-' || TRIM(CHAR(DOC.NUMEROALBARAN))
                    END AS LOGICAL_KEY
                FROM DOCUMENTS_WITH_INVOICE DOC
            ),
            LOGICAL_DOCUMENTS AS (
                SELECT LOGICAL_KEY,
                    MAX(ANO * 10000 + MES * 100 + DIA) AS SORT_DATE,
                    MAX(CASE WHEN NUMEROFACTURA > 0 THEN NUMEROFACTURA ELSE NUMEROALBARAN END) AS SORT_NUMBER
                FROM DOCUMENT_ROWS
                GROUP BY LOGICAL_KEY
            ),
            NUMBERED_DOCUMENTS AS (
                SELECT LOGICAL_DOCUMENTS.*,
                    COUNT(*) OVER () AS TOTAL_COUNT,
                    ROW_NUMBER() OVER (
                        ORDER BY SORT_DATE DESC, SORT_NUMBER DESC, LOGICAL_KEY DESC
                    ) AS LOGICAL_POSITION
                FROM LOGICAL_DOCUMENTS
            ),
            PAGED_DOCUMENTS AS (
                SELECT * FROM NUMBERED_DOCUMENTS
                WHERE LOGICAL_POSITION > ?
                  AND LOGICAL_POSITION <= ?
            ),
            PAGE_DOCS AS (
                SELECT DOC.*
                FROM DOCUMENT_ROWS DOC
                INNER JOIN PAGED_DOCUMENTS PAGED_ROW
                    ON DOC.LOGICAL_KEY = PAGED_ROW.LOGICAL_KEY
            ),
            CVC_INSTALLMENTS AS (
                SELECT
                    TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
                    TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
                    TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
                    CVC.EJERCICIODOCUMENTO,
                    TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
                    CVC.TERMINALDOCUMENTO, CVC.NUMERODOCUMENTO,
                    COALESCE(CVC.XDEDOCUMENTO, 1) AS XDEDOCUMENTO,
                    COALESCE(CVC.DEXDOCUMENTO, 1) AS DEXDOCUMENTO,
                    TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0)) AS IMPORTE_PENDIENTE,
                    CASE
                        WHEN MIN(COALESCE(CVC.IMPORTEPENDIENTE, 0)) <> MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0))
                        THEN 1 ELSE 0
                    END AS AMBIGUOUS_INSTALLMENT
                FROM DSEDAC.CVC CVC
                INNER JOIN PAGE_DOCS DOC
                    ON TRIM(CVC.TIPODOCUMENTO) = 'CAC'
                    AND TRIM(CVC.ORIGENDOCUMENTO) = 'B'
                    AND TRIM(CVC.SUBEMPRESADOCUMENTO) = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND TRIM(CVC.SERIEDOCUMENTO) = DOC.SERIEALBARAN
                    AND CVC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND TRIM(CVC.CODIGOCLIENTEALBARAN) = DOC.CODIGOCLIENTEALBARAN
                WHERE COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
                GROUP BY CVC.TIPODOCUMENTO, CVC.ORIGENDOCUMENTO,
                    CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO,
                    CVC.SERIEDOCUMENTO, CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO, CVC.XDEDOCUMENTO,
                    CVC.DEXDOCUMENTO, CVC.CODIGOCLIENTEALBARAN
            ),
            CVC_DOCUMENTS AS (
                SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE,
                    SUM(IMPORTE_PENDIENTE) AS IMPORTE_PENDIENTE,
                    SUM(AMBIGUOUS_INSTALLMENT) AS AMBIGUOUS_INSTALLMENTS
                FROM CVC_INSTALLMENTS
                GROUP BY SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE
            ),
            ENRICHED_PAGE AS (
                SELECT DOC.*,
                    CASE
                        WHEN CVC_DOC.NUMERODOCUMENTO IS NULL
                          OR COALESCE(CVC_DOC.AMBIGUOUS_INSTALLMENTS, 0) > 0
                        THEN 0 ELSE 1
                    END AS CVC_PRESENT,
                    CVC_DOC.IMPORTE_PENDIENTE AS CVC_PENDING,
                    COALESCE(CF_J.FIRMANOMBRE, '') AS LEGACY_FIRMA_NOMBRE,
                    CF_J.DIA AS LEGACY_DIA, CF_J.MES AS LEGACY_MES,
                    CF_J.ANO AS LEGACY_ANO, CF_J.HORA AS LEGACY_HORA
                FROM PAGE_DOCS DOC
                LEFT JOIN CVC_DOCUMENTS CVC_DOC
                    ON CVC_DOC.SUBEMPRESADOCUMENTO = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC_DOC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND CVC_DOC.SERIEDOCUMENTO = DOC.SERIEALBARAN
                    AND CVC_DOC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC_DOC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND CVC_DOC.CLIENTE = DOC.CODIGOCLIENTEALBARAN
                LEFT JOIN DSEDAC.CACFIRMAS CF_J
                    ON CF_J.EJERCICIOALBARAN = DOC.EJERCICIOALBARAN
                    AND TRIM(CF_J.SERIEALBARAN) = DOC.SERIEALBARAN
                    AND CF_J.TERMINALALBARAN = DOC.TERMINALALBARAN
                    AND CF_J.NUMEROALBARAN = DOC.NUMEROALBARAN
            ),
            TOTAL_META AS (
                SELECT COUNT(*) AS TOTAL_COUNT FROM LOGICAL_DOCUMENTS
            )
            SELECT DOC.*, COALESCE(PAGED_ROW.TOTAL_COUNT, META.TOTAL_COUNT) AS TOTAL_COUNT,
                PAGED_ROW.LOGICAL_POSITION,
                CASE WHEN PAGED_ROW.LOGICAL_KEY IS NULL THEN 1 ELSE 0 END AS META_ONLY
            FROM TOTAL_META META
            LEFT JOIN PAGED_DOCUMENTS PAGED_ROW ON META.TOTAL_COUNT = META.TOTAL_COUNT
            LEFT JOIN ENRICHED_PAGE DOC ON DOC.LOGICAL_KEY = PAGED_ROW.LOGICAL_KEY
            ORDER BY PAGED_ROW.LOGICAL_POSITION, DOC.ANO DESC, DOC.MES DESC, DOC.DIA DESC,
                DOC.NUMEROALBARAN DESC, DOC.SERIEALBARAN DESC,
                DOC.TERMINALALBARAN DESC
        `;
  const allParams = [
    ...effectiveOwnerJoin.params,
    clientCode,
    ...ids,
    ...confirmationScope.params,
    ...yearFilterParams,
    ...dateParams,
    pageOffset,
    pageOffset + pageLimit,
  ];
  // La consulta de historico es de solo lectura y su parte ERP puede tardar
  // segundos al recorrer el historico del cliente. Cachear la pagina completa
  // con todos sus filtros evita repetir el escaneo al volver a la pestana.
  // El overlay canonico se recalcula despues para que una confirmacion/cobro
  // reciente no quede bloqueada por la cache.
  const sortedIds = [...ids].map((id) => String(id).trim()).sort();
  const historyCacheKey = [
    'client-documents-v3',
    sortedIds.join(','),
    String(clientCode || '').trim(),
    yearValue || minYearValue || '',
    dateFromValue || '',
    dateToValue || '',
    pageOffset,
    pageLimit,
  ].join(':');
  const historyStartedAt = Date.now();
  const rows = await cachedQuery(queryWithParams, sql, {
    cacheKey: historyCacheKey,
    prefix: 'repartidor:history-documents',
    ttl: TTL.REALTIME,
    role: 'REPARTIDOR',
    vendorCode: sortedIds.join(','),
    params: {
      repartidorIds: sortedIds,
      clientCode: String(clientCode || '').trim(),
      yearValue: yearValue || null,
      minYearValue: minYearValue || null,
      dateFromValue: dateFromValue || null,
      dateToValue: dateToValue || null,
      pageOffset,
      pageLimit,
    },
    dateFrom: dateFromValue || null,
    dateTo: dateToValue || null,
    queryType: 'repartidor_history',
  }, allParams);
  logger.info(`[PERF] /history/documents client=${clientCode || '-'} owners=${sortedIds.length} rows=${rows?.length || 0} db/cache=${Date.now() - historyStartedAt}ms`);
  const overlaid = await overlayCanonicalConfirmations(rows || [], {
    repartidorIds: ids,
    clientCode,
  });
  return {
    rows: overlaid,
    deliveryStatusAvailability: dsAvail ? 'AVAILABLE' : 'LEGACY_ONLY',
  };
}

async function getObjectives(cleanRepartidorIds, normalizedClientId) {
  let clientFilter = '';
  const queryParams = [...cleanRepartidorIds];
  if (normalizedClientId) {
    clientFilter = `AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?`;
    queryParams.push(normalizedClientId);
  }
  const placeholders = cleanRepartidorIds.map(() => '?').join(',');
  const sql = `
            SELECT 
                OPP.ANOREPARTO as ANO,
                OPP.MESREPARTO as MES,
                SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 
                    THEN CPC.IMPORTETOTAL 
                    ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
                END) as TOTAL_COBRADO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE OPP.CODIGOREPARTIDOR IN (${placeholders})
              ${clientFilter}
            GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO
            ORDER BY OPP.ANOREPARTO DESC, OPP.MESREPARTO DESC
            FETCH FIRST 500 ROWS ONLY
        `;
  return runCached(
    sql,
    `repartidor:objectives:${cleanRepartidorIds.join(',')}:${normalizedClientId || 'all'}`,
    TTL.REALTIME,
    queryParams,
  );
}

async function getObjectivesDetailClients(
  repartidorIdList,
  selectedYear,
  clientId,
  { limit = 100, offset = 0 } = {},
) {
  const pageLimit = Number(limit);
  const pageOffset = Number(offset);
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
    const error = new Error('Objectives detail page limit must be between 1 and 100');
    error.code = 'OBJECTIVES_DETAIL_LIMIT_INVALID';
    throw error;
  }
  if (!Number.isSafeInteger(pageOffset) || pageOffset < 0) {
    const error = new Error('Objectives detail page offset must be a non-negative integer');
    error.code = 'OBJECTIVES_DETAIL_OFFSET_INVALID';
    throw error;
  }
  let clientFilter = '';
  const clientFilterParams = [];
  if (clientId) {
    clientFilter = `AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?`;
    clientFilterParams.push(String(clientId).trim());
  }
  const repartidorKey = repartidorIdList.join(',');
  const clientsSql = `
            WITH CLIENT_SCOPE AS (
                SELECT TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENT_CODE,
                    MAX(TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, ''))) AS CLIENT_NAME
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
                WHERE OPP.CODIGOREPARTIDOR IN (${repartidorIdList.map(() => '?').join(',')})
                  AND OPP.ANOREPARTO = ?
                  AND NULLIF(TRIM(CPC.CODIGOCLIENTEALBARAN), '') IS NOT NULL
                  ${clientFilter}
                GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN)
            ), NUMBERED AS (
                SELECT CLIENT_SCOPE.*,
                    ROW_NUMBER() OVER (ORDER BY CLIENT_CODE, CLIENT_NAME) AS LOGICAL_POSITION
                FROM CLIENT_SCOPE
            ), PAGE_ROWS AS (
                SELECT CLIENT_CODE, CLIENT_NAME, LOGICAL_POSITION
                FROM NUMBERED
                WHERE LOGICAL_POSITION > ? AND LOGICAL_POSITION <= ?
            ), SCOPE_TOTAL AS (
                SELECT COUNT(*) AS TOTAL_COUNT
                FROM CLIENT_SCOPE
            )
            SELECT PAGE_ROWS.CLIENT_CODE, PAGE_ROWS.CLIENT_NAME,
                PAGE_ROWS.LOGICAL_POSITION, SCOPE_TOTAL.TOTAL_COUNT
            FROM SCOPE_TOTAL
            LEFT JOIN PAGE_ROWS ON 1 = 1
            ORDER BY PAGE_ROWS.LOGICAL_POSITION
        `;
  const clientSqlParams = [
    ...repartidorIdList,
    selectedYear,
    ...clientFilterParams,
    pageOffset,
    pageOffset + pageLimit,
  ];
  const result = await runCached(
    clientsSql,
    `repartidor:objDetail:${repartidorKey}:${selectedYear}:${clientId || 'all'}:${pageOffset}:${pageLimit}`,
    TTL.REALTIME,
    clientSqlParams,
  );
  const resultRows = Array.isArray(result) ? result : [];
  return {
    total: Number(resultRows[0]?.TOTAL_COUNT || 0),
    rows: resultRows.filter((row) => String(row?.CLIENT_CODE || '').trim()),
  };
}

async function getObjectivesDetailLaclae(allCodes, selectedYear) {
  const uniqueCodes = [...new Set((allCodes || []).map((code) => String(code || '').trim()).filter(Boolean))];
  if (uniqueCodes.length === 0) return [];
  if (uniqueCodes.length > 100) {
    const error = new Error('Objectives detail client page exceeds 100');
    error.code = 'OBJECTIVES_DETAIL_PAGE_TOO_LARGE';
    throw error;
  }
  const clientInFilter = `L.LCCDCL IN (${uniqueCodes.map(() => '?').join(',')})`;
  const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT')`;
  const dataSql = `
            SELECT
                TRIM(L.LCCDCL) as CLIENT_CODE,
                TRIM(L.LCCDRF) as PRODUCT_CODE,
                COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.LCDESC)) as PRODUCT_NAME,
                COALESCE(TRIM(A.UNIDADMEDIDA), 'UDS') as UNIT_TYPE,
                L.LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST,
                SUM(L.LCCTUD) as UNITS,
                COALESCE(TRIM(AX.FILTRO01), '') as FI1_CODE,
                COALESCE(TRIM(AX.FILTRO02), '') as FI2_CODE,
                COALESCE(TRIM(AX.FILTRO03), '') as FI3_CODE,
                COALESCE(TRIM(AX.FILTRO04), '') as FI4_CODE
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARTX AX ON L.LCCDRF = AX.CODIGOARTICULO
            WHERE ${clientInFilter}
              AND L.LCAADC = ?
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCCDCL, L.LCCDRF, A.DESCRIPCIONARTICULO, L.LCDESC, A.UNIDADMEDIDA, L.LCMMDC, AX.FILTRO01, AX.FILTRO02, AX.FILTRO03, AX.FILTRO04
        `;
  return runQueryWithParams(dataSql, [...uniqueCodes, selectedYear], false);
}

async function getFiFilterCatalog() {
  const [fi1Rows, fi2Rows, fi3Rows, fi4Rows] = await Promise.all([
    runQuery(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI1`, false, false),
    runQuery(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI2`, false, false),
    runQuery(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI3`, false, false),
    runQuery(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI4`, false, false),
  ]);
  return { fi1Rows, fi2Rows, fi3Rows, fi4Rows };
}


function appFirmasTable() {
  return resolveLegacyRouteReadTable('signatures');
}

async function getDeliveryStatusFirmaPath(albId) {
  if (!isDeliveryStatusAvailable() || isDeliveryStatusNewSchema()) return [];
  const table = resolveDeliveryStatusReadTable();
  if (!table) return [];
  return runQueryWithParams(
    `SELECT FIRMA_PATH FROM ${table} WHERE ID = ?`,
    [albId],
    false,
  );
}

async function getRepartidorFirmasByAlbaran(numero, ejercicio, serie, terminal) {
  const table = appFirmasTable();
  if (!table) return [];
  return runQueryWithParams(`
            SELECT FIRMABASE64, TRIM(FIRMANOMBRE) AS FIRMANOMBRE, TRIM(FIRMADNI) AS FIRMADNI,
                   DIA, MES, ANO, HORA
            FROM ${table}
            WHERE EJERCICIOALBARAN = ?
              AND TRIM(SERIEALBARAN) = ?
              AND TERMINALALBARAN = ?
              AND NUMEROALBARAN = ?
            FETCH FIRST 1 ROW ONLY
        `, [
    parseInt(ejercicio, 10),
    (serie || 'A').trim(),
    parseInt(terminal || 0, 10),
    parseInt(numero, 10),
  ], false);
}

async function getCacFirmasDetailed(ejercicio, serie, terminal, numero) {
  const params = [
    parseInt(ejercicio, 10),
    (serie || 'A').trim(),
    parseInt(terminal || 0, 10),
    parseInt(numero, 10),
  ];
  try {
    return await runQueryWithParams(`
                SELECT FIRMABASE64, TRIM(FIRMANOMBRE) as FIRMANOMBRE, DIA, MES, ANO, HORA,
                       LENGTH(FIRMABASE64) as FIRMA_LEN
                FROM DSEDAC.CACFIRMAS
                WHERE EJERCICIOALBARAN = ?
                  AND TRIM(SERIEALBARAN) = ?
                  AND TERMINALALBARAN = ?
                  AND NUMEROALBARAN = ?
                FETCH FIRST 5 ROWS ONLY
            `, params, false);
  } catch (_) {
    return runQueryWithParams(`
                SELECT FIRMABASE64, TRIM(FIRMANOMBRE) as FIRMANOMBRE, DIA, MES, ANO, HORA
                FROM DSEDAC.CACFIRMAS
                WHERE EJERCICIOALBARAN = ?
                  AND TRIM(SERIEALBARAN) = ?
                  AND TERMINALALBARAN = ?
                  AND NUMEROALBARAN = ?
                FETCH FIRST 5 ROWS ONLY
            `, params, false);
  }
}

async function getDebugCacSignatures() {
  return runQuery(`
            SELECT 
                CF.EJERCICIOALBARAN, TRIM(CF.SERIEALBARAN) as SERIE, 
                CF.TERMINALALBARAN, CF.NUMEROALBARAN,
                TRIM(CF.FIRMANOMBRE) as FIRMANTE,
                CF.ANO, CF.MES, CF.DIA,
                LENGTH(CF.FIRMABASE64) as FIRMA_SIZE,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE
            FROM DSEDAC.CACFIRMAS CF
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.EJERCICIOALBARAN = CF.EJERCICIOALBARAN
                AND CPC.SERIEALBARAN = CF.SERIEALBARAN
                AND CPC.TERMINALALBARAN = CF.TERMINALALBARAN
                AND CPC.NUMEROALBARAN = CF.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE CF.FIRMABASE64 IS NOT NULL 
              AND LENGTH(TRIM(CF.FIRMABASE64)) > 10
              AND CF.EJERCICIOALBARAN >= 2025
            ORDER BY CF.ANO DESC, CF.MES DESC, CF.DIA DESC
            FETCH FIRST 50 ROWS ONLY
        `, false);
}

async function getEntregaFirma(entregaId) {
  const table = appFirmasTable();
  if (!table) return [];
  return runQueryWithParams(`
            SELECT FIRMABASE64, FIRMANOMBRE, DIA, MES, ANO, HORA
            FROM ${table}
            WHERE ENTREGA_ID = ?
            FETCH FIRST 1 ROW ONLY
        `, [entregaId], false);
}

async function getLegacySignatureBase64(year, series, terminal, number) {
  return runQueryWithParams(`
            SELECT FIRMABASE64
            FROM DSEDAC.CACFIRMAS
            WHERE EJERCICIOALBARAN = ?
              AND TRIM(SERIEALBARAN) = ?
              AND TERMINALALBARAN = ?
              AND NUMEROALBARAN = ?
        `, [year, (series || '').trim(), terminal, number], false);
}

async function getRepartidorFirmaBase64ByAlbaran(numero, year, serie, terminal) {
  const table = appFirmasTable();
  if (!table) return [];
  return runQueryWithParams(`
                    SELECT FIRMABASE64 FROM ${table}
                    WHERE EJERCICIOALBARAN = ?
                      AND TRIM(SERIEALBARAN) = ?
                      AND TERMINALALBARAN = ?
                      AND NUMEROALBARAN = ?
                    FETCH FIRST 1 ROW ONLY
                `, [year, (serie || 'A').trim(), parseInt(terminal || 0, 10), parseInt(numero, 10)], false);
}

async function getCacFirmaBase64(year, serie, terminal, number) {
  return runQueryWithParams(`
                    SELECT FIRMABASE64 FROM DSEDAC.CACFIRMAS
                    WHERE EJERCICIOALBARAN = ?
                      AND TRIM(SERIEALBARAN) = ?
                      AND TERMINALALBARAN = ?
                      AND NUMEROALBARAN = ?
                    FETCH FIRST 1 ROW ONLY
                `, [year, serie, terminal, number], false);
}

async function getDeliverySummary(selectedYear, selectedMonth, dayFilterParams, repartidorIdList) {
  const dayFilter = dayFilterParams.length ? `AND OPP.DIAREPARTO <= ?` : '';
  const confirmationScope = confirmationOwnerScopeClause(repartidorIdList);
  const canonicalOnly = isIsolatedTestTableSet();
  const deliveryStatusTable = resolveDeliveryStatusReadTable();
  const dsAvail = Boolean(deliveryStatusTable) && isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();
        // The legacy ID does not encode subempresa or client, so it cannot be
        // joined safely for a cross-client aggregate. Use canonical status
        // only when every delivery identity component is available.
        const dsJoinSub = dsAvail ? `
            LEFT JOIN ${deliveryStatusTable} DS
                ON DS.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
                AND DS.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND TRIM(DS.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
                AND DS.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND DS.NUMEROALBARAN = CPC.NUMEROALBARAN
                AND TRIM(DS.CODIGOCLIENTEALBARAN) = TRIM(CPC.CODIGOCLIENTEALBARAN)
        ` : '';
        const confirmationJoins = confirmationOverlayJoins();
        const confirmationStatusCases = confirmationOverlayStatusCases();
        const canonicalStatusCases = dsAvail ? `
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(DS.STATUS, ''))) IN
                        ('NO_ENTREGADO', 'NO_REALIZADA', 'NO_REALIZADO', 'RECHAZADO', 'RECHAZADA', 'ABSENT')
                        THEN 1 ELSE 0 END) = 1 THEN 'NO_ENTREGADO'
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(DS.STATUS, ''))) IN ('PARCIAL', 'PARTIAL')
                        THEN 1 ELSE 0 END) = 1 THEN 'PARCIAL'
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(DS.STATUS, ''))) IN ('ENTREGADO', 'DELIVERED')
                        THEN 1 ELSE 0 END) = 1 THEN 'ENTREGADO'
                    WHEN MAX(CASE WHEN TRIM(COALESCE(DS.STATUS, '')) <> '' THEN 1 ELSE 0 END) = 1
                        THEN 'PENDIENTE'` : '';

        
  const baseSql = `
            SELECT DIA,
                COUNT(*) as TOTAL_ALBARANES,
                SUM(CASE WHEN FINAL_STATUS = 'ENTREGADO' THEN 1 ELSE 0 END) as ENTREGADOS,
                SUM(CASE WHEN FINAL_STATUS = 'NO_ENTREGADO' THEN 1 ELSE 0 END) as NO_ENTREGADOS,
                SUM(CASE WHEN FINAL_STATUS = 'PARCIAL' THEN 1 ELSE 0 END) as PARCIALES,
                CAST(SUM(IMPORTE) AS DECIMAL(15,2)) as IMPORTE_TOTAL
            FROM (
                SELECT 
                    OPP.DIAREPARTO as DIA,
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) as SERIE,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    CAST(MAX(CPC.IMPORTETOTAL) AS DECIMAL(15,2)) as IMPORTE,
                    CASE
                        ${canonicalStatusCases}
                        ${confirmationStatusCases}
                        ${canonicalOnly ? '' : "WHEN MAX(CASE WHEN TRIM(COALESCE(CPC.CONFORMADOSN, '')) = 'S' THEN 1 ELSE 0 END) = 1"}
                        ${canonicalOnly ? '' : "    THEN 'ENTREGADO'"}
                        ELSE 'PENDIENTE'
                    END AS FINAL_STATUS
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                ${dsJoinSub}
                ${confirmationJoins}
                WHERE OPP.ANOREPARTO = ?
                  AND OPP.MESREPARTO = ?
                  ${dayFilter}
                  AND (
                    OPP.CODIGOREPARTIDOR IN (${repartidorIdList.map(() => '?').join(',')})
                    ${confirmationScope.sql}
                  )
                GROUP BY OPP.DIAREPARTO, CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN, TRIM(CPC.SERIEALBARAN),
                    CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN)
            ) ALBS
            GROUP BY DIA
            ORDER BY DIA
        `;
  return (await runQueryWithParams(
    baseSql,
    [selectedYear, selectedMonth, ...dayFilterParams, ...repartidorIdList, ...confirmationScope.params],
    false,
  )) || [];
}

function routeWeekDateParts(value) {
  const text = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value || '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match
    ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
    : null;
}

async function getRuteroWeekWithDayMoves(weekStartNum, weekEndNum, repartidorIdList, table) {
  const weekStartText = String(weekStartNum).padStart(8, '0');
  const weekStartYmd = `${weekStartText.slice(0, 4)}-${weekStartText.slice(4, 6)}-${weekStartText.slice(6, 8)}`;
  const moveIds = repartidorIdList.map(() => '?').join(',');
  const expr = dayMoveRepo.documentIdExpression('CPC');
  const weekTables = [resolveConfirmationTables()].filter(Boolean);
  const confirmationScope = confirmationOwnerScopeClause(repartidorIdList);
  const confirmationJoins = confirmationOverlayJoins(weekTables);
  const confirmationDelivered = confirmationOverlayDeliveredSql(weekTables);
  const sql = `
    WITH DOCUMENTOS_SEMANA AS (
      SELECT
        OPP.DIAREPARTO AS DIA,
        OPP.MESREPARTO AS MES,
        OPP.ANOREPARTO AS ANO,
        ROUTE_MOVE.TARGET_DATE AS ROUTE_TARGET_DATE,
        CPC.SUBEMPRESAALBARAN,
        CPC.EJERCICIOALBARAN,
        CPC.SERIEALBARAN,
        CPC.TERMINALALBARAN,
        CPC.NUMEROALBARAN,
        MAX(CASE
          ${confirmationDelivered}
          ELSE 0
        END) AS ENTREGADO
      FROM DSEDAC.OPP OPP
      INNER JOIN DSEDAC.CPC CPC
        ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
       AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
       AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
      LEFT JOIN ${table} ROUTE_MOVE
        ON ROUTE_MOVE.REPARTIDOR_ID IN (${moveIds})
       AND ROUTE_MOVE.REPARTIDOR_ID = OPP.CODIGOREPARTIDOR
       AND ROUTE_MOVE.WEEK_START = ?
       AND TRIM(ROUTE_MOVE.DOCUMENT_ID) = ${expr}
      ${confirmationJoins}
      WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO)
              BETWEEN ? AND ?
        AND (
          OPP.CODIGOREPARTIDOR IN (${repartidorIdList.map(() => '?').join(',')})
          ${confirmationScope.sql}
        )
      GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO, OPP.DIAREPARTO,
        ROUTE_MOVE.TARGET_DATE,
        CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN,
        CPC.TERMINALALBARAN, CPC.NUMEROALBARAN
    )
    SELECT DIA, MES, ANO, ROUTE_TARGET_DATE,
           COUNT(*) AS TOTAL_ALBARANES,
           SUM(ENTREGADO) AS ENTREGADOS
      FROM DOCUMENTOS_SEMANA
     GROUP BY ANO, MES, DIA, ROUTE_TARGET_DATE
     ORDER BY ANO, MES, DIA, ROUTE_TARGET_DATE
  `;
  const params = [
    ...repartidorIdList,
    weekStartYmd,
    weekStartNum,
    weekEndNum,
    ...repartidorIdList,
    ...confirmationScope.params,
  ];
  const cacheKey = 'repartidor:rutero-week:v2:moves:' + table + ':' + repartidorIdList.slice().sort().join(',') + ':' + weekStartNum + ':' + weekEndNum;
  const rows = await runCached(sql, cacheKey, TTL.REALTIME, params);
  return (rows || []).map((row) => {
    const target = routeWeekDateParts(row.ROUTE_TARGET_DATE);
    return {
      ...row,
      DIA: target?.day ?? Number(row.DIA),
      MES: target?.month ?? Number(row.MES),
      ANO: target?.year ?? Number(row.ANO),
    };
  });
}


async function getRuteroWeek(weekStartNum, weekEndNum, repartidorIdList) {
  const dayMoveTable = dayMoveRepo.tryResolveDayOverrideTable();
  if (dayMoveTable) return getRuteroWeekWithDayMoves(weekStartNum, weekEndNum, repartidorIdList, dayMoveTable);
  const weekTables = [resolveConfirmationTables()].filter(Boolean);
  const confirmationScope = confirmationOwnerScopeClause(repartidorIdList);
  const confirmationJoins = confirmationOverlayJoins(weekTables);
  const confirmationDelivered = confirmationOverlayDeliveredSql(weekTables);
  const sql = `
            WITH DOCUMENTOS_SEMANA AS (
                SELECT
                    OPP.DIAREPARTO as DIA,
                    OPP.MESREPARTO as MES,
                    OPP.ANOREPARTO as ANO,
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    CPC.SERIEALBARAN,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    MAX(CASE
                        ${confirmationDelivered}
                        ELSE 0
                    END) as ENTREGADO
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                ${confirmationJoins}
                WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO)
                    BETWEEN ? AND ?
                  AND (
                    OPP.CODIGOREPARTIDOR IN (${repartidorIdList.map(() => '?').join(',')})
                    ${confirmationScope.sql}
                  )
                GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO, OPP.DIAREPARTO,
                    CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN,
                    CPC.TERMINALALBARAN, CPC.NUMEROALBARAN
            )
            SELECT
                DIA, MES, ANO,
                COUNT(*) as TOTAL_ALBARANES,
                SUM(ENTREGADO) as ENTREGADOS
            FROM DOCUMENTOS_SEMANA
            GROUP BY ANO, MES, DIA
            ORDER BY ANO, MES, DIA
        `;
  const params = [weekStartNum, weekEndNum, ...repartidorIdList, ...confirmationScope.params];
  const cacheKey = 'repartidor:rutero-week:v2:base:' + repartidorIdList.slice().sort().join(',') + ':' + weekStartNum + ':' + weekEndNum;
  return runCached(sql, cacheKey, TTL.REALTIME, params);
}

async function getHistoryDeliveries({ startInt, endInt, repartidorIdList, search, offset, limit }) {
  const dsHistAvail = isDeliveryStatusAvailable();
  const dsHistJoin = getDeliveryStatusJoin('CPC', 'DS');
  const confirmationScope = confirmationOwnerScopeClause(repartidorIdList);
  let sql = `
            SELECT 
                CPC.ANODOCUMENTO || '-' || RIGHT('0' || CPC.MESDOCUMENTO, 2) || '-' || RIGHT('0' || CPC.DIADOCUMENTO, 2) as FECHA,
                CPC.NUMEROALBARAN,
                CPC.SERIEALBARAN,
                CPC.EJERCICIOALBARAN,
                CAC.NUMEROFACTURA,
                CAC.SERIEFACTURA,
                CAC.EJERCICIOFACTURA,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CODIGO_CLIENTE,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEALBARAN,
                CPC.TERMINALALBARAN,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE,
                CPC.IMPORTETOTAL as TOTAL,
                ${dsHistAvail ? "DS.STATUS as ESTADO_ENTREGA" : "CAST(NULL AS VARCHAR(20)) as ESTADO_ENTREGA"},
                ${dsHistAvail && !isDeliveryStatusNewSchema() ? "DS.FIRMA_PATH" : "CAST(NULL AS VARCHAR(255)) as FIRMA_PATH"}
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI 
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            ${dsHistAvail ? dsHistJoin : ''}
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
              AND (
                OPP.CODIGOREPARTIDOR IN (${repartidorIdList.map(() => '?').join(',')})
                ${confirmationScope.sql}
              )
        `;
  const sqlParams = [startInt, endInt, ...repartidorIdList, ...confirmationScope.params];
  const historySearch = buildFlexibleRepartidorSearch(search, [
    'CLI.NOMBRECLIENTE',
    'CLI.NOMBREALTERNATIVO',
    'TRIM(CPC.CODIGOCLIENTEALBARAN)',
    'CLI.DIRECCION',
    'CLI.POBLACION',
    'CLI.PROVINCIA',
    'CLI.CODIGOPOSTAL',
    'CLI.NIF',
    'CLI.TELEFONO1',
    'CLI.TELEFONO2',
    'CAST(CPC.NUMEROALBARAN AS VARCHAR(20))',
    'CAST(CAC.NUMEROFACTURA AS VARCHAR(20))',
    'CAST(OPP.NUMEROORDENPREPARACION AS VARCHAR(20))',
  ]);
  sql += ` ${historySearch.clause}`;
  sqlParams.push(...historySearch.params);
  sql += ` ORDER BY FECHA DESC, CPC.EJERCICIOALBARAN DESC, CPC.NUMEROALBARAN DESC, CPC.SERIEALBARAN DESC
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;
  sqlParams.push(offset, limit);
  const rows = (await runQueryWithParams(sql, sqlParams, false)) || [];
  const overlaid = await overlayCanonicalConfirmations(rows, {
    repartidorIds: repartidorIdList,
  });
  return overlaid.map((row) => {
    const canonical = String(row.CANONICAL_STATUS || '').trim().toUpperCase();
    const safe = jsonSafeRow(row);
    if (!canonical) {
      // isolated_test must never promote ERP F/R/CONFORMADOSN to delivered.
      return isIsolatedTestTableSet() ? { ...safe, ESTADO_ENTREGA: 'PENDIENTE' } : safe;
    }
    return { ...safe, ESTADO_ENTREGA: canonical };
  });
}

async function getHistoryClients({ repartidorIdList, search, limit, offset }) {
  const ids = [...new Set((repartidorIdList || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  const pageLimit = Number(limit);
  const pageOffset = Number(offset);
  if (!ids.length || !Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100 ||
      !Number.isInteger(pageOffset) || pageOffset < 0 || pageOffset > 1000000) {
    const error = new Error('History client page is invalid');
    error.code = 'HISTORY_CLIENTS_PAGE_INVALID';
    throw error;
  }
  const clientSearch = buildFlexibleRepartidorSearch(search, [
    'CLI.NOMBRECLIENTE',
    'CLI.NOMBREALTERNATIVO',
    'CLI.CODIGOCLIENTE',
    'CLI.DIRECCION',
    'CLI.POBLACION',
    'CLI.PROVINCIA',
    'CLI.CODIGOPOSTAL',
    'CLI.NIF',
    'CLI.TELEFONO1',
    'CLI.TELEFONO2',
  ]);
  const effectiveOwnerJoin = confirmationScopedOwnerJoin(ids);
  const sql = `
            WITH MATCHED_DELIVERIES AS (
                SELECT DISTINCT
                    CPC.CODIGOCLIENTEALBARAN,
                    ${effectiveOwnerJoin.ownerExpression || 'TRIM(OPP.CODIGOREPARTIDOR)'} AS CODIGOREPARTIDOR,
                    CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                    CPC.IMPORTETOTAL,
                    CPC.ANODOCUMENTO, CPC.MESDOCUMENTO, CPC.DIADOCUMENTO
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                ${effectiveOwnerJoin.sql}
                WHERE (OPP.CODIGOREPARTIDOR IN (${ids.map(() => '?').join(', ')})
                    OR ${effectiveOwnerJoin.sql ? 'C_EFFECTIVE.REPARTIDOR_ID IS NOT NULL' : '1 = 0'})
                  AND CPC.NUMEROALBARAN < 900000
                  AND CPC.EJERCICIOALBARAN > 0
            )
            SELECT
                TRIM(DELIVERIES.CODIGOCLIENTEALBARAN) as ID,
                TRIM(DELIVERIES.CODIGOREPARTIDOR) as OWNER_ID,
                TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) as NAME,
                TRIM(COALESCE(CLI.DIRECCION, '')) as ADDRESS,
                COUNT(*) as TOTAL_DOCS,
                COALESCE(SUM(DELIVERIES.IMPORTETOTAL), 0) as TOTAL_AMOUNT,
                MAX(DELIVERIES.ANODOCUMENTO * 10000 + DELIVERIES.MESDOCUMENTO * 100 + DELIVERIES.DIADOCUMENTO) as LAST_VISIT
            FROM MATCHED_DELIVERIES DELIVERIES
            INNER JOIN DSEDAC.CLI CLI
                ON CLI.CODIGOCLIENTE = DELIVERIES.CODIGOCLIENTEALBARAN
            WHERE (CLI.ANOBAJA = 0 OR CLI.ANOBAJA IS NULL)
              ${clientSearch.clause}
            GROUP BY TRIM(DELIVERIES.CODIGOCLIENTEALBARAN), TRIM(DELIVERIES.CODIGOREPARTIDOR),
                TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')),
                TRIM(COALESCE(CLI.DIRECCION, ''))
            ORDER BY LAST_VISIT DESC, ID ASC, OWNER_ID ASC
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
        `;
  // Reduce by repartidor before applying the intentionally flexible client search.
  const params = [...effectiveOwnerJoin.params, ...ids, ...clientSearch.params];
  // Extra row gives hasMore without a second aggregation query.
  params.push(pageOffset, pageLimit + 1);
  const cacheKey = `repartidor:clients:${ids.join(',')}:${clientSearch.cacheKey}:${pageLimit}:${pageOffset}`;
  return runCached(sql, cacheKey, TTL.REALTIME, params);
}

async function getAlbaranPdfHeader(parsedNumber, serie, parsedYear, parsedTerminal) {
  return runQueryWithParams(`
            SELECT 
                CAC.EJERCICIOALBARAN, CAC.SERIEALBARAN, CAC.NUMEROALBARAN, CAC.TERMINALALBARAN,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.DIADOCUMENTO as DIAFACTURA, CAC.MESDOCUMENTO as MESFACTURA, CAC.ANODOCUMENTO as ANOFACTURA,
                CAC.IMPORTETOTAL,
                CAC.IMPORTEBRUTO,
                CAC.IMPORTEBASEIMPONIBLE1,
                CAC.PORCENTAJEIVA1,
                CAC.IMPORTEIVA1,
                CAC.IMPORTEBASEIMPONIBLE2,
                CAC.PORCENTAJEIVA2,
                CAC.IMPORTEIVA2,
                CAC.IMPORTEBASEIMPONIBLE3,
                CAC.PORCENTAJEIVA3,
                CAC.IMPORTEIVA3,
                CAC.IMPORTEBASEIMPONIBLE4,
                CAC.PORCENTAJEIVA4,
                CAC.IMPORTEIVA4,
                CAC.IMPORTEBASEIMPONIBLE5,
                CAC.PORCENTAJEIVA5,
                CAC.IMPORTEIVA5,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
                TRIM(CLI.NOMBREALTERNATIVO) as NOMBRECOMERCIALFACTURA,
                TRIM(CLI.NOMBRECLIENTE) as NOMBREFISCALFACTURA,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.PROVINCIA, '')) as PROVINCIACLIENTEFACTURA,
                TRIM(COALESCE(CLI.CODIGOPOSTAL, '')) as CPCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
            WHERE CAC.NUMEROALBARAN = ?
              AND (? = '' OR TRIM(CAC.SERIEALBARAN) = ?)
              AND CAC.EJERCICIOALBARAN = ?
              AND CAC.TERMINALALBARAN = ?
            FETCH FIRST 1 ROW ONLY
        `, [parsedNumber, serie, serie, parsedYear, parsedTerminal], false);
}

async function getCpcIvaBreakdown(year, serie, terminal, number) {
  return runQueryWithParams(`
                SELECT 
                    IMPORTEBASEIMPONIBLE1 as BI1, PORCENTAJEIVA1 as IVA1_PCT, IMPORTEIVA1 as IVA1_IMP,
                    IMPORTEBASEIMPONIBLE2 as BI2, PORCENTAJEIVA2 as IVA2_PCT, IMPORTEIVA2 as IVA2_IMP,
                    IMPORTEBASEIMPONIBLE3 as BI3, PORCENTAJEIVA3 as IVA3_PCT, IMPORTEIVA3 as IVA3_IMP,
                    IMPORTETOTAL
                FROM DSEDAC.CPC
                WHERE EJERCICIOALBARAN = ?
                  AND TRIM(SERIEALBARAN) = ?
                  AND TERMINALALBARAN = ?
                  AND NUMEROALBARAN = ?
                FETCH FIRST 1 ROW ONLY
            `, [year, (serie || '').trim(), terminal, number], false);
}

async function getAlbaranLines(parsedYear, serie, parsedTerminal, parsedNumber) {
  return (await runQueryWithParams(`
            SELECT 
                LAC.CODIGOARTICULO,
                LAC.DESCRIPCION as DESCRIPCIONARTICULO,
                '' as LOTEARTICULO,
                LAC.CANTIDADUNIDADES as CANTIDADARTICULO,
                LAC.CANTIDADENVASES as CAJASARTICULO,
                LAC.IMPORTEVENTA as IMPORTENETOARTICULO,
                TRIM(LAC.CODIGOIVA) as CODIGOIVA,
                0 as PORCENTAJERECARGOARTICULO,
                LAC.PORCENTAJEDESCUENTO as PORCENTAJEDESCUENTOARTICULO,
                LAC.PRECIOVENTA as PRECIOARTICULO,
                TRIM(COALESCE(LAC.UNIDADMEDIDA, '')) as UNIDADMEDIDA
            FROM DSEDAC.LAC LAC
            WHERE LAC.EJERCICIOALBARAN = ?
              AND TRIM(LAC.SERIEALBARAN) = ?
              AND LAC.TERMINALALBARAN = ?
              AND LAC.NUMEROALBARAN = ?
            ORDER BY LAC.SECUENCIA
        `, [parsedYear, serie, parsedTerminal, parsedNumber], false)) || [];
}

async function getInvoiceHeaderByFactura(parsedNumber, serie, parsedYear) {
  return runQueryWithParams(`
            SELECT ${INVOICE_HEADER_COLS}
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
            WHERE CAC.NUMEROFACTURA = ?
              AND (? = '' OR TRIM(CAC.SERIEFACTURA) = ?)
              AND CAC.EJERCICIOFACTURA = ?
            FETCH FIRST 1 ROW ONLY
        `, [parsedNumber, serie, serie, parsedYear], false);
}

async function getInvoiceHeaderByAlbaran(parsedAlbaranNumber, albaranSerieNorm, parsedAlbaranYear, parsedAlbaranTerminal) {
  return runQueryWithParams(`
                SELECT ${INVOICE_HEADER_COLS}
                FROM DSEDAC.CAC CAC
                LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
                WHERE CAC.NUMEROALBARAN = ?
                  AND (? = '' OR TRIM(CAC.SERIEALBARAN) = ?)
                  AND CAC.EJERCICIOALBARAN = ?
                  AND CAC.TERMINALALBARAN = ?
                FETCH FIRST 1 ROW ONLY
            `, [parsedAlbaranNumber, albaranSerieNorm, albaranSerieNorm, parsedAlbaranYear, parsedAlbaranTerminal], false);
}

async function getInvoiceHeaderByAlbaranNoTerminal(parsedNumber, serie, parsedYear) {
  return runQueryWithParams(`
                SELECT ${INVOICE_HEADER_COLS}
                FROM DSEDAC.CAC CAC
                LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
                WHERE CAC.NUMEROALBARAN = ?
                  AND (? = '' OR TRIM(CAC.SERIEALBARAN) = ?)
                  AND CAC.EJERCICIOALBARAN = ?
                FETCH FIRST 1 ROW ONLY
            `, [parsedNumber, serie, serie, parsedYear], false);
}

function resolveFinanceWriteTables() {
  try {
    const runtime = resolveRepartoRuntime(process.env);
    if (runtime?.valid && runtime.tables?.finance) return runtime.tables.finance;
  } catch (_error) {
    // Jest and incomplete env fall through to explicit table-set mapping.
  }
  const set = String(process.env.REPARTO_TABLE_SET || '').trim().toLowerCase();
  if (set === 'isolated_test' || set === 'production') {
    return TABLE_MAPPINGS[set].finance;
  }
  return null;
}

function isIsolatedTestTableSet() {
  try {
    const runtime = resolveRepartoRuntime(process.env);
    if (runtime?.tableSet) return runtime.tableSet === 'isolated_test';
  } catch (_error) {
    // Incomplete runtime still honors the explicit table-set flag.
  }
  return String(process.env.REPARTO_TABLE_SET || '').trim().toLowerCase() === 'isolated_test';
}

function allowedFinanceCobrosTable(tableName) {
  return tableName === TABLE_MAPPINGS.isolated_test.finance.cobros
    || tableName === TABLE_MAPPINGS.production.finance.cobros;
}

function allowedFinanceAuditTable(tableName) {
  return tableName === TABLE_MAPPINGS.isolated_test.finance.audit
    || tableName === TABLE_MAPPINGS.production.finance.audit;
}

async function getAppCollectedOverlay({ month, year, repartidorIds } = {}) {
  const finance = resolveFinanceWriteTables();
  const cobrosTable = finance?.cobros;
  const ids = [...new Set((repartidorIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!allowedFinanceCobrosTable(cobrosTable) || !ids.length) {
    return { total: 0, byDay: [] };
  }
  try {
    const placeholders = ids.map(() => '?').join(',');
    const cacheKey = `repartidor:collections:overlay:${ids.join(',')}:${year}:${month}`;
    const rows = await runCached(
      `SELECT DIACOBRO AS DIA, SUM(IMPORTEVENCIMIENTO) AS APP_COBRADO
         FROM ${cobrosTable}
        WHERE MESCOBRO = ?
          AND ANOCOBRO = ?
          AND TRIM(CODIGOVENDEDOR) IN (${placeholders})
        GROUP BY DIACOBRO`,
      cacheKey,
      TTL.REALTIME,
      [month, year, ...ids],
    );
    const byDay = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        day: Number(row.DIA ?? row.dia) || 0,
        collected: Number(row.APP_COBRADO ?? row.app_cobrado) || 0,
      }))
      .filter((row) => row.collected !== 0);
    const total = byDay.reduce((sum, row) => sum + row.collected, 0);
    return { total, byDay };
  } catch (_error) {
    return { total: 0, byDay: [] };
  }
}

async function recordDocumentEmailLedger({ operatorId, ownerId, payloadPreview } = {}) {
  const finance = resolveFinanceWriteTables();
  const auditTable = finance?.audit;
  if (!allowedFinanceAuditTable(auditTable)) {
    const error = new Error('EMAIL_LEDGER_UNAVAILABLE');
    error.code = 'EMAIL_DELIVERY_LEDGER_REQUIRED';
    throw error;
  }
  await queryWithParams(
    `INSERT INTO ${auditTable} (EVENT_TYPE, OPERADOR, CODIGO_REPARTIDOR, PAYLOAD_PREVIEW) VALUES (?, ?, ?, ?)`,
    [
      'DOCUMENT_EMAIL',
      String(operatorId || '').slice(0, 40),
      String(ownerId || '').slice(0, 10),
      String(payloadPreview || '').slice(0, 500),
    ],
  );
}

module.exports = {
  resolveAlbaranOwners,
  resolveInvoiceOwners,
  resolveDeliveryOwners,
  getCollectionsSummary,
  getCollectionsDaily,
  getClientDocuments,
  overlayCanonicalConfirmations,
  resolveConfirmationTables,
  resolveFinanceWriteTables,
  confirmationStatusOverlayTables,
  isIsolatedTestTableSet,
  getAppCollectedOverlay,
  recordDocumentEmailLedger,
  getCanonicalConfirmationSignature,
  getObjectives,
  getObjectivesDetailClients,
  getObjectivesDetailLaclae,
  getFiFilterCatalog,
  getDeliveryStatusFirmaPath,
  getRepartidorFirmasByAlbaran,
  getCacFirmasDetailed,
  getDebugCacSignatures,
  getEntregaFirma,
  getLegacySignatureBase64,
  getRepartidorFirmaBase64ByAlbaran,
  getCacFirmaBase64,
  getDeliverySummary,
  getRuteroWeek,
  getHistoryDeliveries,
  getHistoryClients,
  getAlbaranPdfHeader,
  getCpcIvaBreakdown,
  getAlbaranLines,
  getInvoiceHeaderByFactura,
  getInvoiceHeaderByAlbaran,
  getInvoiceHeaderByAlbaranNoTerminal,
  assertReadOnlySql,
  runQueryWithParams,
  runCached,
  runQuery,
};
