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
const { hashPassword } = require('../middleware/auth');

const BCRYPT_PIN_RE = /^\$2[aby]\$/;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const BACKFILL_BATCH_SIZE = parseInt(process.env.PIN_HASH_BACKFILL_BATCH_SIZE || '40', 10);

function parseArgs(argv) {
    const args = new Set(argv);
    const vendorArg = argv.find(arg => arg.startsWith('--vendor='));
    return {
        backfill: args.has('--backfill'),
        dryRun: args.has('--dry-run'),
        updateExisting: args.has('--update-existing'),
        vendorCodes: vendorArg
            ? vendorArg.slice('--vendor='.length).split(',').map(code => code.trim()).filter(Boolean)
            : [],
    };
}

function isBcryptHash(value) {
    return BCRYPT_PIN_RE.test(String(value || '').trim());
}

function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

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

async function loadExistingHashCodes() {
    const rows = await queryWithParams(`
        SELECT TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR
        FROM JAVIER.VENDOR_PIN_HASHES
    `, [], false);
    return new Set(rows.map(row => String(row.CODIGOVENDEDOR || '').trim()).filter(Boolean));
}

async function loadActiveVendorPins(vendorCodes = []) {
    const vendorFilter = vendorCodes.length > 0
        ? `AND TRIM(P.CODIGOVENDEDOR) IN (${vendorCodes.map(() => '?').join(',')})`
        : '';

    return queryWithParams(`
        SELECT TRIM(P.CODIGOVENDEDOR) AS CODIGOVENDEDOR,
               TRIM(P.CODIGOPIN) AS CODIGOPIN
        FROM DSEDAC.VDPL1 P
        JOIN DSEDAC.VDC V
          ON P.CODIGOVENDEDOR = V.CODIGOVENDEDOR
         AND V.SUBEMPRESA = 'GMP'
        WHERE TRIM(P.CODIGOVENDEDOR) <> ''
          AND TRIM(COALESCE(P.CODIGOPIN, '')) <> ''
          ${vendorFilter}
    `, vendorCodes, false);
}

async function upsertHashBatch(entries) {
    if (entries.length === 0) return;

    const valuesSql = entries
        .map(() => '(CAST(? AS VARCHAR(20)), CAST(? AS VARCHAR(100)))')
        .join(', ');
    const params = entries.flatMap(entry => [entry.code, entry.hash]);

    await queryWithParams(`
        MERGE INTO JAVIER.VENDOR_PIN_HASHES AS target
        USING (VALUES ${valuesSql}) AS source(CODIGOVENDEDOR, PIN_HASH)
           ON target.CODIGOVENDEDOR = source.CODIGOVENDEDOR
        WHEN MATCHED THEN
            UPDATE SET PIN_HASH = source.PIN_HASH, UPDATED_AT = CURRENT_TIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (CODIGOVENDEDOR, PIN_HASH, UPDATED_AT)
            VALUES (source.CODIGOVENDEDOR, source.PIN_HASH, CURRENT_TIMESTAMP)
    `, params, false);
}

async function backfillVendorPinHashes(options = {}) {
    await createPinHashesTable();

    const existingCodes = options.updateExisting ? new Set() : await loadExistingHashCodes();
    const rows = await loadActiveVendorPins(options.vendorCodes || []);
    const candidates = rows
        .map(row => ({
            code: String(row.CODIGOVENDEDOR || '').trim(),
            pin: String(row.CODIGOPIN || '').trim(),
        }))
        .filter(row => row.code && row.pin && !existingCodes.has(row.code));

    const entries = [];
    let copiedLegacyBcrypt = 0;
    let hashedPlaintext = 0;

    for (const candidate of candidates) {
        if (isBcryptHash(candidate.pin)) {
            entries.push({ code: candidate.code, hash: candidate.pin });
            copiedLegacyBcrypt++;
        } else {
            entries.push({
                code: candidate.code,
                hash: await hashPassword(candidate.pin, BCRYPT_ROUNDS),
            });
            hashedPlaintext++;
        }
    }

    logger.info(`[Migration] PIN hash backfill candidates=${candidates.length} plaintext=${hashedPlaintext} legacyBcrypt=${copiedLegacyBcrypt} skippedExisting=${rows.length - candidates.length}`);

    if (options.dryRun) {
        logger.info('[Migration] Dry run enabled; no hashes written.');
        return { written: 0, candidates: candidates.length, dryRun: true };
    }

    for (const batch of chunkArray(entries, BACKFILL_BATCH_SIZE)) {
        await upsertHashBatch(batch);
        logger.info(`[Migration] Wrote ${batch.length} vendor PIN hashes.`);
    }

    return { written: entries.length, candidates: candidates.length, dryRun: false };
}

// Run if executed directly
if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    const run = options.backfill
        ? backfillVendorPinHashes(options)
        : createPinHashesTable();

    run.then((result) => {
            if (result) {
                logger.info(`[Migration] PIN hashes backfill completed: ${JSON.stringify(result)}`);
            } else {
                logger.info('[Migration] PIN hashes migration completed.');
            }
            process.exit(0);
        })
        .catch(err => {
            logger.error(`[Migration] Migration failed: ${err.message}`);
            process.exit(1);
        });
}

module.exports = { createPinHashesTable, backfillVendorPinHashes };
