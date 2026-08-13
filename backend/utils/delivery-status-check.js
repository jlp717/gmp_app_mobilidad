/**
 * DELIVERY_STATUS Table Availability & Schema Check
 *
 * Tracks whether the runtime-mapped delivery overlay table exists and which
 * schema version it uses.
 * - OLD schema (pre-migration 024): ID VARCHAR composite key + FIRMA_PATH
 * - NEW schema (post-migration 024): EJERCICIOALBARAN / SERIEALBARAN / ...
 *
 * isolated_test uses JAVIER.TEST_DELIVERY_STATUS when present in TABLE_MAPPINGS.
 */

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');

let _isAvailable = false;
let _isNewSchema = false;
let _schemaChecked = false;
let _tableQualified = 'JAVIER.DELIVERY_STATUS';
let _tableName = 'DELIVERY_STATUS';

function resolveDeliveryStatusTable(env = process.env) {
  try {
    const runtime = resolveRepartoRuntime(env);
    const mapped = runtime?.tables?.notifications?.deliveryStatus;
    if (mapped && /^JAVIER\.[A-Z][A-Z0-9_]*$/.test(mapped)) {
      return mapped;
    }
  } catch (_) {
    /* fall through */
  }
  return 'JAVIER.DELIVERY_STATUS';
}

async function checkSchema() {
  if (_schemaChecked) return;
  _schemaChecked = true;
  _tableQualified = resolveDeliveryStatusTable();
  _tableName = _tableQualified.split('.')[1];

  try {
    const exists = await queryWithParams(`
      SELECT 1 AS OK FROM QSYS2.SYSTABLES
       WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = ?
       FETCH FIRST 1 ROW ONLY
    `, [_tableName], false, false);
    if (!exists?.length) {
      _isAvailable = false;
      _isNewSchema = false;
      logger.warn(`[DELIVERY_STATUS] ${_tableQualified} missing`);
      return;
    }

    const rows = await queryWithParams(`
      SELECT COLUMN_NAME
        FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA = 'JAVIER'
         AND TABLE_NAME = ?
         AND COLUMN_NAME = 'EJERCICIOALBARAN'
       FETCH FIRST 1 ROW ONLY
    `, [_tableName], false, false);
    _isNewSchema = rows && rows.length > 0;
    _isAvailable = true;
    logger.info(`[DELIVERY_STATUS] ${_tableQualified} schema=${_isNewSchema ? 'NEW' : 'OLD'}`);
  } catch (e) {
    _isAvailable = false;
    _isNewSchema = false;
    logger.warn(`[DELIVERY_STATUS] check failed: ${e.message}`);
  }
}

module.exports = {
  async initSchemaCheck() {
    await checkSchema();
  },

  isDeliveryStatusAvailable() {
    return _isAvailable;
  },

  isDeliveryStatusNewSchema() {
    return _isNewSchema;
  },

  getDeliveryStatusTable() {
    return _tableQualified;
  },

  setDeliveryStatusAvailable(available) {
    _isAvailable = !!available;
  },

  getDeliveryStatusJoin(cpcAlias = 'CPC', dsAlias = 'DS') {
    if (!_isAvailable) return '';
    const table = _tableQualified;
    if (_isNewSchema) {
      return `
                LEFT JOIN ${table} ${dsAlias} ON
                    ${dsAlias}.EJERCICIOALBARAN = ${cpcAlias}.EJERCICIOALBARAN
                    AND ${dsAlias}.SERIEALBARAN = ${cpcAlias}.SERIEALBARAN
                    AND ${dsAlias}.TERMINALALBARAN = ${cpcAlias}.TERMINALALBARAN
                    AND ${dsAlias}.NUMEROALBARAN = ${cpcAlias}.NUMEROALBARAN
            `;
    }
    return `
            LEFT JOIN ${table} ${dsAlias} ON
                ${dsAlias}.ID = TRIM(CAST(${cpcAlias}.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(COALESCE(${cpcAlias}.SERIEALBARAN, '')) || '-' || TRIM(CAST(${cpcAlias}.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(${cpcAlias}.NUMEROALBARAN AS VARCHAR(10)))
        `;
  },

  getDeliveryStatusColumns(dsAlias = 'DS') {
    if (!_isAvailable) {
      return `
                CAST(NULL AS VARCHAR(20)) as DELIVERY_STATUS,
                CAST(NULL AS TIMESTAMP) as DELIVERY_UPDATED_AT,
                CAST(NULL AS VARCHAR(255)) as FIRMA_PATH,
                CAST(NULL AS VARCHAR(512)) as DS_OBS,
                CAST(NULL AS VARCHAR(255)) as DS_FIRMA,
                CAST(NULL AS VARCHAR(20)) as DELIVERY_REPARTIDOR
            `;
    }
    if (_isNewSchema) {
      return `
                ${dsAlias}.STATUS as DELIVERY_STATUS,
                ${dsAlias}.UPDATED_AT as DELIVERY_UPDATED_AT,
                CAST(NULL AS VARCHAR(255)) as FIRMA_PATH,
                CAST(NULL AS VARCHAR(512)) as OBSERVACIONES,
                CAST(NULL AS VARCHAR(255)) as DS_OBS,
                CAST(NULL AS VARCHAR(255)) as DS_FIRMA,
                CAST(NULL AS VARCHAR(20)) as DELIVERY_REPARTIDOR
            `;
    }
    return `
                ${dsAlias}.STATUS as DELIVERY_STATUS,
                ${dsAlias}.UPDATED_AT as DELIVERY_UPDATED_AT,
                ${dsAlias}.FIRMA_PATH,
                ${dsAlias}.OBSERVACIONES,
                ${dsAlias}.OBSERVACIONES as DS_OBS,
                ${dsAlias}.FIRMA_PATH as DS_FIRMA,
                ${dsAlias}.REPARTIDOR_ID as DELIVERY_REPARTIDOR
        `;
  },
};
