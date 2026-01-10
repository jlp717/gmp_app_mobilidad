/**
 * Metadata Cache Service
 * Caches FI names and Family names to avoid repeated database queries
 */

const logger = require('../middleware/logger');
const { getPool } = require('../config/db');

// Cache storage
let familyNames = {};
let fi1Names = {};
let fi2Names = {};
let fi3Names = {};
let fi4Names = {};
let fi5Names = {};
let cacheReady = false;
let cacheLoadTime = 0;

/**
 * Load all metadata caches from database
 */
async function loadMetadataCache() {
    const start = Date.now();
    logger.info('📦 Loading metadata cache (FI names, Family names)...');

    const dbPool = getPool();
    if (!dbPool) {
        logger.error('❌ Database pool not initialized - cannot load metadata cache');
        return;
    }

    try {
        const conn = await dbPool.connect();
        try {
            // Load Family names
            try {
                const famRows = await conn.query(`SELECT CODIGOFAMILIA, DESCRIPCIONFAMILIA FROM DSEDAC.FAM`);
                familyNames = {};
                famRows.forEach(r => {
                    const code = (r.CODIGOFAMILIA || '').toString().trim();
                    const name = (r.DESCRIPCIONFAMILIA || '').toString().trim();
                    if (code) familyNames[code] = name;
                });
                logger.info(`  📁 FAM: ${Object.keys(familyNames).length} families`);
            } catch (e) {
                logger.warn(`  ⚠️ FAM table failed: ${e.message}`);
            }

            // Load FI1 names
            try {
                const fi1Rows = await conn.query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI1`);
                fi1Names = {};
                fi1Rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) fi1Names[code] = name;
                });
                logger.info(`  📁 FI1: ${Object.keys(fi1Names).length} entries`);
            } catch (e) {
                logger.warn(`  ⚠️ FI1 table failed: ${e.message}`);
            }

            // Load FI2 names
            try {
                const fi2Rows = await conn.query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI2`);
                fi2Names = {};
                fi2Rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) fi2Names[code] = name;
                });
                logger.info(`  📁 FI2: ${Object.keys(fi2Names).length} entries`);
            } catch (e) {
                logger.warn(`  ⚠️ FI2 table failed: ${e.message}`);
            }

            // Load FI3 names
            try {
                const fi3Rows = await conn.query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI3`);
                fi3Names = {};
                fi3Rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) fi3Names[code] = name;
                });
                logger.info(`  📁 FI3: ${Object.keys(fi3Names).length} entries`);
            } catch (e) {
                logger.warn(`  ⚠️ FI3 table failed: ${e.message}`);
            }

            // Load FI4 names
            try {
                const fi4Rows = await conn.query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI4`);
                fi4Names = {};
                fi4Rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) fi4Names[code] = name;
                });
                logger.info(`  📁 FI4: ${Object.keys(fi4Names).length} entries`);
            } catch (e) {
                logger.warn(`  ⚠️ FI4 table failed: ${e.message}`);
            }

            // Load FI5 names
            try {
                const fi5Rows = await conn.query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI5`);
                fi5Names = {};
                fi5Rows.forEach(r => {
                    const code = (r.CODIGOFILTRO || '').toString().trim();
                    const name = (r.DESCRIPCIONFILTRO || '').toString().trim();
                    if (code) fi5Names[code] = name;
                });
                logger.info(`  📁 FI5: ${Object.keys(fi5Names).length} entries`);
            } catch (e) {
                logger.warn(`  ⚠️ FI5 table failed: ${e.message}`);
            }

            cacheReady = true;
            cacheLoadTime = Date.now() - start;
            logger.info(`📦 Metadata cache loaded in ${cacheLoadTime}ms`);

        } finally {
            await conn.close();
        }
    } catch (error) {
        logger.error(`❌ Metadata cache failed: ${error.message}`);
        cacheReady = false;
    }
}

/**
 * Get cached metadata
 */
function getCachedFamilyNames() {
    return cacheReady ? familyNames : null;
}

function getCachedFi1Names() {
    return cacheReady ? fi1Names : null;
}

function getCachedFi2Names() {
    return cacheReady ? fi2Names : null;
}

function getCachedFi3Names() {
    return cacheReady ? fi3Names : null;
}

function getCachedFi4Names() {
    return cacheReady ? fi4Names : null;
}

function getCachedFi5Names() {
    return cacheReady ? fi5Names : null;
}

function isCacheReady() {
    return cacheReady;
}

module.exports = {
    loadMetadataCache,
    getCachedFamilyNames,
    getCachedFi1Names,
    getCachedFi2Names,
    getCachedFi3Names,
    getCachedFi4Names,
    getCachedFi5Names,
    isCacheReady
};
