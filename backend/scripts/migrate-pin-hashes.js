/**
 * Migration: Create JAVIER.VENDOR_PIN_HASHES table
 * =================================================
 * Stores bcrypt hashes for vendor PINs, enabling gradual migration
 * from plaintext PINs in DSEDAC.VDPL1.CODIGOPIN without DBA changes.
 *
 * Table structure:
 *   CODIGOVENDEDOR VARCHAR(20) PRIMARY KEY
 *   PIN_HASH       VARCHAR(100)  -- bcrypt hash (~60 chars)
 *   UPDATED_AT     TIMESTAMP
 *
 * Run: node backend/scripts/migrate-pin-hashes.js
 */

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

async function createPinHashesTable() {
    const tableName = 'JAVIER.VENDOR_PIN_HASHES';

    logger.info(`[Migration] Checking if ${tableName} exists...`);

    try {
        // Check if table exists
        const checkResult = await queryWithParams(`
            SELECT COUNT(*) as CNT 
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'VENDOR_PIN_HASHES'
        `, [], false);

        const exists = checkResult[0]?.CNT > 0;

        if (exists) {
            logger.info(`[Migration] Table ${tableName} already exists. Verifying columns...`);

            // Verify columns
            const colCheck = await queryWithParams(`
                SELECT COLUMN_NAME 
                FROM QSYS2.SYSCOLUMNS 
                WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'VENDOR_PIN_HASHES'
            `, [], false);

            const columns = colCheck.map(c => c.COLUMN_NAME?.trim().toUpperCase());
            const requiredColumns = ['CODIGOVENDEDOR', 'PIN_HASH', 'UPDATED_AT'];
            const missing = requiredColumns.filter(c => !columns.includes(c));

            if (missing.length > 0) {
                logger.error(`[Migration] Missing columns in ${tableName}: ${missing.join(', ')}`);
                logger.error('[Migration] Please drop and recreate the table, or add missing columns manually.');
                process.exit(1);
            }

            logger.info(`[Migration] Table ${tableName} exists with all required columns.`);
            return;
        }

        // Create table
        logger.info(`[Migration] Creating table ${tableName}...`);

        await queryWithParams(`
            CREATE TABLE JAVIER.VENDOR_PIN_HASHES (
                CODIGOVENDEDOR VARCHAR(20) NOT NULL PRIMARY KEY,
                PIN_HASH VARCHAR(100) NOT NULL,
                UPDATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `, [], false);

        logger.info(`[Migration] Table ${tableName} created successfully.`);

        // Create index for faster lookups
        logger.info(`[Migration] Creating index on UPDATED_AT...`);

        await queryWithParams(`
            CREATE INDEX JAVIER.IDX_PIN_HASHES_UPDATED 
            ON JAVIER.VENDOR_PIN_HASHES (UPDATED_AT DESC)
        `, [], false);

        logger.info(`[Migration] Index created successfully.`);
        logger.info(`[Migration] PIN hash migration table ready.`);

    } catch (error) {
        logger.error(`[Migration] Failed to create ${tableName}: ${error.message}`);
        logger.error(`[Migration] SQL State: ${error.odbcErrors?.map(e => e.state).join(', ') || 'N/A'}`);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    createPinHashesTable()
        .then(() => {
            logger.info('[Migration] PIN hashes migration completed.');
            process.exit(0);
        })
        .catch(err => {
            logger.error(`[Migration] Migration failed: ${err.message}`);
            process.exit(1);
        });
}

module.exports = { createPinHashesTable };
