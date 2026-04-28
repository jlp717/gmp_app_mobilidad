/**
 * DELIVERY_STATUS Table Availability & Schema Check
 * 
 * Tracks whether JAVIER.DELIVERY_STATUS table exists and which schema version it uses.
 * - OLD schema (pre-migration 024): ID VARCHAR(160) composite key
 * - NEW schema (post-migration 024): EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN
 */

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

let _isAvailable = false;
let _isNewSchema = false;
let _schemaChecked = false;

async function checkSchema() {
    if (_schemaChecked) return;
    _schemaChecked = true;

    try {
        const rows = await queryWithParams(`
            SELECT COLUMN_NAME 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'JAVIER' 
              AND TABLE_NAME = 'DELIVERY_STATUS' 
              AND COLUMN_NAME = 'EJERCICIOALBARAN'
            FETCH FIRST 1 ROW ONLY
        `, [], false, false);
        _isNewSchema = rows && rows.length > 0;
        _isAvailable = true;
        logger.info(`[DELIVERY_STATUS] Table available, schema: ${_isNewSchema ? 'NEW (albaran columns)' : 'OLD (ID composite)'}`);
    } catch (e) {
        _isAvailable = false;
        _isNewSchema = false;
        logger.warn(`[DELIVERY_STATUS] Table not available: ${e.message}`);
    }
}

module.exports = {
    async initSchemaCheck() {
        await checkSchema();
    },

    /** @returns {boolean} Whether DELIVERY_STATUS table is available */
    isDeliveryStatusAvailable() {
        return _isAvailable;
    },

    /** @returns {boolean} Whether NEW schema (albaran columns) is in use */
    isDeliveryStatusNewSchema() {
        return _isNewSchema;
    },

    /** Set availability flag (called from server.js startup) */
    setDeliveryStatusAvailable(available) {
        _isAvailable = !!available;
    },

    /**
     * Returns the LEFT JOIN clause for DELIVERY_STATUS if available, empty string otherwise.
     * Automatically uses OLD or NEW schema JOIN based on detected schema.
     * @param {string} cpcAlias - Alias for CPC table (default: 'CPC')
     * @param {string} dsAlias - Alias for DS table (default: 'DS')
     */
    getDeliveryStatusJoin(cpcAlias = 'CPC', dsAlias = 'DS') {
        if (!_isAvailable) return '';
        if (_isNewSchema) {
            return `
                LEFT JOIN JAVIER.DELIVERY_STATUS ${dsAlias} ON 
                    ${dsAlias}.EJERCICIOALBARAN = ${cpcAlias}.EJERCICIOALBARAN
                    AND ${dsAlias}.SERIEALBARAN = ${cpcAlias}.SERIEALBARAN
                    AND ${dsAlias}.TERMINALALBARAN = ${cpcAlias}.TERMINALALBARAN
                    AND ${dsAlias}.NUMEROALBARAN = ${cpcAlias}.NUMEROALBARAN
            `;
        }
        return `
            LEFT JOIN JAVIER.DELIVERY_STATUS ${dsAlias} ON 
                ${dsAlias}.ID = TRIM(CAST(${cpcAlias}.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(COALESCE(${cpcAlias}.SERIEALBARAN, '')) || '-' || TRIM(CAST(${cpcAlias}.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(${cpcAlias}.NUMEROALBARAN AS VARCHAR(10)))
        `;
    },

    /**
     * Returns DS column references if table is available, NULL aliases otherwise.
     * Uses OLD or NEW column names based on detected schema.
     * 
     * OLD schema (020): ID, STATUS, OBSERVACIONES, FIRMA_PATH, FECHAACTUALIZACION, REPARTIDOR_ID
     * NEW schema (024): STATUS, UPDATED_AT, OPERADOR — NO FIRMA_PATH, OBSERVACIONES, REPARTIDOR_ID
     */
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
            // NEW schema (024) has STATUS and UPDATED_AT but NOT FIRMA_PATH, OBSERVACIONES, REPARTIDOR_ID
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
        // OLD schema (020) has all columns (UPDATED_AT is the actual column name, not FECHAACTUALIZACION)
        return `
                ${dsAlias}.STATUS as DELIVERY_STATUS,
                ${dsAlias}.UPDATED_AT as DELIVERY_UPDATED_AT,
                ${dsAlias}.FIRMA_PATH,
                ${dsAlias}.OBSERVACIONES,
                ${dsAlias}.OBSERVACIONES as DS_OBS,
                ${dsAlias}.FIRMA_PATH as DS_FIRMA,
                ${dsAlias}.REPARTIDOR_ID as DELIVERY_REPARTIDOR
        `;
    }
};
