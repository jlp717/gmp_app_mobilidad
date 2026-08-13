'use strict';

/**
 * Startup guard for ERP column contracts.
 * If AS/400 renames a column used by sales/notifications, we fail loud in logs
 * instead of silently returning wrong totals.
 */

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const { SALES_FILTERS, LAC_COLUMN_MAPPING } = require('../utils/salesQuery');

const LACLAE_REQUIRED = Object.freeze([
  SALES_FILTERS.salesColumn,
  SALES_FILTERS.costColumn,
  SALES_FILTERS.yearColumn,
  SALES_FILTERS.monthColumn,
  SALES_FILTERS.vendorColumn,
  SALES_FILTERS.clientColumn,
  'TPDC',
  'LCTPVT',
  'LCCLLN',
  'LCSRAB',
]);

const VDDX_REQUIRED = Object.freeze([
  'CODIGOVENDEDOR',
  'CORREOELECTRONICO',
]);

const VDD_REQUIRED = Object.freeze([
  'CODIGOVENDEDOR',
  'NOMBREVENDEDOR',
]);

const CRUT_REQUIRED = Object.freeze([
  'CODIGOCLIENTE',
  'HORAREPARTODESDE',
  'HORAREPARTOHASTA',
  'HORAVISITA',
  'OBSERVACIONESREPARTO',
]);

async function listColumns(schema, table, { query = queryWithParams } = {}) {
  const rows = await query(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?`,
    [schema, table],
  );
  return new Set(
    (rows || []).map((row) => String(row.COLUMN_NAME || row.column_name || '').trim().toUpperCase()),
  );
}

function missingFrom(required, available) {
  return required.filter((col) => !available.has(String(col).toUpperCase()));
}

/**
 * @returns {Promise<{ ok: boolean, checks: Array<object> }>}
 */
async function validateErpColumnContracts({ query = queryWithParams } = {}) {
  const checks = [];

  async function check(schema, table, required, note) {
    try {
      const available = await listColumns(schema, table, { query });
      const missing = missingFrom(required, available);
      const entry = {
        schema,
        table,
        note,
        missing,
        ok: missing.length === 0,
        mappedAliases: note === 'LAC_COLUMN_MAPPING'
          ? Object.entries(LAC_COLUMN_MAPPING).map(([longName, shortName]) => ({ longName, shortName }))
          : undefined,
      };
      checks.push(entry);
      if (!entry.ok) {
        logger.error(
          `[erp-column-contract] MISSING ${schema}.${table}: ${missing.join(', ')}`,
        );
      } else {
        logger.info(`[erp-column-contract] OK ${schema}.${table} (${required.length} cols)`);
      }
    } catch (error) {
      checks.push({
        schema,
        table,
        note,
        ok: false,
        error: error.message,
      });
      logger.error(`[erp-column-contract] probe failed ${schema}.${table}: ${error.message}`);
    }
  }

  await check('DSED', 'LACLAE', LACLAE_REQUIRED, 'salesQuery SALES_FILTERS');
  // LACLAE may live as DSEDAC or DSED depending on environment — try both
  if (checks[checks.length - 1] && !checks[checks.length - 1].ok) {
    await check('DSEDAC', 'LACLAE', LACLAE_REQUIRED, 'salesQuery SALES_FILTERS fallback schema');
  }
  await check('DSEDAC', 'VDDX', VDDX_REQUIRED, 'staff emails');
  await check('DSEDAC', 'VDD', VDD_REQUIRED, 'vendor names');
  await check('DSEDAC', 'CRUT', CRUT_REQUIRED, 'rutero hours/obs');

  // Mapping sanity: short names in LAC_COLUMN_MAPPING must be in required set or listed
  const shortNames = Object.values(LAC_COLUMN_MAPPING);
  const unknownShort = shortNames.filter((name) => !LACLAE_REQUIRED.includes(name) && !['TPDC', 'LCTPVT', 'LCCLLN', 'LCSRAB'].includes(name));
  checks.push({
    schema: 'logical',
    table: 'LAC_COLUMN_MAPPING',
    note: 'alias map long→short (salesQuery.js) — change ERP names only with deliberate code+contract update',
    ok: unknownShort.length === 0,
    missing: unknownShort,
    mappedAliases: Object.entries(LAC_COLUMN_MAPPING).map(([longName, shortName]) => ({ longName, shortName })),
  });

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

module.exports = {
  validateErpColumnContracts,
  LACLAE_REQUIRED,
  VDDX_REQUIRED,
  VDD_REQUIRED,
  CRUT_REQUIRED,
};
