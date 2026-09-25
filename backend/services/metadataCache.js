/**
 * Metadata Cache Service
 * Caches FI names and Family names to avoid repeated database queries
 */

const logger = require('../middleware/logger');
const { getPool } = require('../config/db');
const { comercialErpTable } = require('../utils/comercial-erp-tables');

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
        const famSql = `SELECT CODIGOFAMILIA, DESCRIPCIONFAMILIA FROM ${comercialErpTable('FAM')}`;
        const fiSql = (t) => `SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM ${comercialErpTable(t)}`;

        async function safeQuery(sql) {
            const c = await dbPool.connect();
            try {
                return await c.query(sql);
            } finally {
                await c.close();
            }
        }

        function toCodeMap(rows, codeKey, nameKey) {
            const map = {};
            rows.forEach(r => {
                const code = (r[codeKey] || '').toString().trim();
                const name = (r[nameKey] || '').toString().trim();
                if (code) map[code] = name;
            });
            return map;
        }

        // 6 queries en paralelo (1 RTT): try/catch por tabla, mismo contrato.
        const [famOut, fi1Out, fi2Out, fi3Out, fi4Out, fi5Out] = await Promise.all([
            safeQuery(famSql).then(
                (rows) => ({ ok: true, map: toCodeMap(rows, 'CODIGOFAMILIA', 'DESCRIPCIONFAMILIA') }),
                (e) => ({ ok: false, error: e }),
            ),
            safeQuery(fiSql('FI1')).then(
                (rows) => ({ ok: true, map: toCodeMap(rows, 'CODIGOFILTRO', 'DESCRIPCIONFILTRO') }),
                (e) => ({ ok: false, error: e }),
            ),
            safeQuery(fiSql('FI2')).then(
                (rows) => ({ ok: true, map: toCodeMap(rows, 'CODIGOFILTRO', 'DESCRIPCIONFILTRO') }),
                (e) => ({ ok: false, error: e }),
            ),
            safeQuery(fiSql('FI3')).then(
                (rows) => ({ ok: true, map: toCodeMap(rows, 'CODIGOFILTRO', 'DESCRIPCIONFILTRO') }),
                (e) => ({ ok: false, error: e }),
            ),
            safeQuery(fiSql('FI4')).then(
                (rows) => ({ ok: true, map: toCodeMap(rows, 'CODIGOFILTRO', 'DESCRIPCIONFILTRO') }),
                (e) => ({ ok: false, error: e }),
            ),
            safeQuery(fiSql('FI5')).then(
                (rows) => ({ ok: true, map: toCodeMap(rows, 'CODIGOFILTRO', 'DESCRIPCIONFILTRO') }),
                (e) => ({ ok: false, error: e }),
            ),
        ]);

        if (famOut.ok) {
            familyNames = famOut.map;
            logger.info(`  📁 FAM: ${Object.keys(familyNames).length} families`);
        } else {
            logger.warn(`  ⚠️ FAM table failed: ${famOut.error.message}`);
        }
        if (fi1Out.ok) {
            fi1Names = fi1Out.map;
            logger.info(`  📁 FI1: ${Object.keys(fi1Names).length} entries`);
        } else {
            logger.warn(`  ⚠️ FI1 table failed: ${fi1Out.error.message}`);
        }
        if (fi2Out.ok) {
            fi2Names = fi2Out.map;
            logger.info(`  📁 FI2: ${Object.keys(fi2Names).length} entries`);
        } else {
            logger.warn(`  ⚠️ FI2 table failed: ${fi2Out.error.message}`);
        }
        if (fi3Out.ok) {
            fi3Names = fi3Out.map;
            logger.info(`  📁 FI3: ${Object.keys(fi3Names).length} entries`);
        } else {
            logger.warn(`  ⚠️ FI3 table failed: ${fi3Out.error.message}`);
        }
        if (fi4Out.ok) {
            fi4Names = fi4Out.map;
            logger.info(`  📁 FI4: ${Object.keys(fi4Names).length} entries`);
        } else {
            logger.warn(`  ⚠️ FI4 table failed: ${fi4Out.error.message}`);
        }
        if (fi5Out.ok) {
            fi5Names = fi5Out.map;
            logger.info(`  📁 FI5: ${Object.keys(fi5Names).length} entries`);
        } else {
            logger.warn(`  ⚠️ FI5 table failed: ${fi5Out.error.message}`);
        }

        cacheReady = true;
        cacheLoadTime = Date.now() - start;
        logger.info(`📦 Metadata cache loaded in ${cacheLoadTime}ms`);
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
