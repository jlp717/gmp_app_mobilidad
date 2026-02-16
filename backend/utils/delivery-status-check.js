/**
 * DELIVERY_STATUS Table Availability Check
 * 
 * Tracks whether JAVIER.DELIVERY_STATUS table exists.
 * Used to conditionally include LEFT JOINs in queries,
 * preventing SQL errors when the table is unavailable.
 */

let _isAvailable = false;

module.exports = {
    /** @returns {boolean} Whether DELIVERY_STATUS table is available */
    isDeliveryStatusAvailable() {
        return _isAvailable;
    },

    /** Set availability flag (called from server.js startup) */
    setDeliveryStatusAvailable(available) {
        _isAvailable = !!available;
    },

    /**
     * Returns the LEFT JOIN clause for DELIVERY_STATUS if available, empty string otherwise.
     * @param {string} cpcAlias - Alias for CPC table (default: 'CPC')
     * @param {string} dsAlias - Alias for DS table (default: 'DS')
     */
    getDeliveryStatusJoin(cpcAlias = 'CPC', dsAlias = 'DS') {
        if (!_isAvailable) return '';
        return `
            LEFT JOIN JAVIER.DELIVERY_STATUS ${dsAlias} ON 
                ${dsAlias}.ID = TRIM(CAST(${cpcAlias}.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(COALESCE(${cpcAlias}.SERIEALBARAN, '')) || '-' || TRIM(CAST(${cpcAlias}.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(${cpcAlias}.NUMEROALBARAN AS VARCHAR(10)))
        `;
    },

    /**
     * Returns DS column references if table is available, NULL aliases otherwise.
     * Use this for SELECT column lists that reference DELIVERY_STATUS fields.
     */
    getDeliveryStatusColumns(dsAlias = 'DS') {
        if (!_isAvailable) {
            return `
                CAST(NULL AS VARCHAR(20)) as DELIVERY_STATUS,
                CAST(NULL AS TIMESTAMP) as DELIVERY_UPDATED_AT,
                CAST(NULL AS VARCHAR(255)) as FIRMA_PATH,
                CAST(NULL AS VARCHAR(512)) as DS_OBS,
                CAST(NULL AS VARCHAR(255)) as DS_FIRMA
            `;
        }
        return `
                ${dsAlias}.STATUS as DELIVERY_STATUS,
                ${dsAlias}.UPDATED_AT as DELIVERY_UPDATED_AT,
                ${dsAlias}.FIRMA_PATH,
                ${dsAlias}.OBSERVACIONES,
                ${dsAlias}.OBSERVACIONES as DS_OBS,
                ${dsAlias}.FIRMA_PATH as DS_FIRMA
        `;
    }
};
