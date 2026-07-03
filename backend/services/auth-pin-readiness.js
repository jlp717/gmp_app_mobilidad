'use strict';

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

const DEFAULT_CACHE_MS = parseInt(process.env.AUTH_PIN_READINESS_CACHE_MS || '30000', 10);
const DEFAULT_EXAMPLE_LIMIT = parseInt(process.env.AUTH_PIN_READINESS_EXAMPLE_LIMIT || '5', 10);

let cachedResult = null;
let cachedUntil = 0;

function toInt(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function boundedLimit(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_EXAMPLE_LIMIT;
    return Math.max(0, Math.min(20, parsed));
}

async function loadAuthPinHashCoverage(exampleLimit) {
    const rows = await queryWithParams(`
        SELECT
            COUNT(*) AS TOTAL_ACTIVE_VENDORS,
            COALESCE(SUM(
                CASE
                    WHEN H.CODIGOVENDEDOR IS NULL
                      OR TRIM(COALESCE(H.PIN_HASH, '')) = ''
                    THEN 1
                    ELSE 0
                END
            ), 0) AS MISSING_HASHES
        FROM DSEDAC.VDPL1 P
        JOIN DSEDAC.VDC V
          ON P.CODIGOVENDEDOR = V.CODIGOVENDEDOR
         AND V.SUBEMPRESA = 'GMP'
        LEFT JOIN JAVIER.VENDOR_PIN_HASHES H
          ON TRIM(P.CODIGOVENDEDOR) = TRIM(H.CODIGOVENDEDOR)
        WHERE TRIM(P.CODIGOVENDEDOR) <> ''
          AND TRIM(COALESCE(P.CODIGOPIN, '')) <> ''
    `, [], false);

    const totalActiveVendors = toInt(rows?.[0]?.TOTAL_ACTIVE_VENDORS ?? rows?.[0]?.totalActiveVendors);
    const missingHashes = toInt(rows?.[0]?.MISSING_HASHES ?? rows?.[0]?.missingHashes);
    let missingExamples = [];

    if (missingHashes > 0 && exampleLimit > 0) {
        const exampleRows = await queryWithParams(`
            SELECT TRIM(P.CODIGOVENDEDOR) AS CODIGOVENDEDOR
            FROM DSEDAC.VDPL1 P
            JOIN DSEDAC.VDC V
              ON P.CODIGOVENDEDOR = V.CODIGOVENDEDOR
             AND V.SUBEMPRESA = 'GMP'
            LEFT JOIN JAVIER.VENDOR_PIN_HASHES H
              ON TRIM(P.CODIGOVENDEDOR) = TRIM(H.CODIGOVENDEDOR)
            WHERE TRIM(P.CODIGOVENDEDOR) <> ''
              AND TRIM(COALESCE(P.CODIGOPIN, '')) <> ''
              AND (
                  H.CODIGOVENDEDOR IS NULL
                  OR TRIM(COALESCE(H.PIN_HASH, '')) = ''
              )
            ORDER BY TRIM(P.CODIGOVENDEDOR)
            FETCH FIRST ${exampleLimit} ROWS ONLY
        `, [], false);

        missingExamples = exampleRows
            .map(row => String(row.CODIGOVENDEDOR || '').trim())
            .filter(Boolean);
    }

    return {
        status: missingHashes === 0 ? 'ready' : 'not_ready',
        totalActiveVendors,
        hashedVendors: Math.max(0, totalActiveVendors - missingHashes),
        missingHashes,
        missingExamples,
    };
}

async function checkAuthPinHashReadiness(options = {}) {
    const now = options.now || Date.now();
    const cacheMs = Number.isFinite(options.cacheMs) ? options.cacheMs : DEFAULT_CACHE_MS;

    if (!options.force && cachedResult && cachedUntil > now) {
        return { ...cachedResult, cached: true };
    }

    try {
        const result = await loadAuthPinHashCoverage(boundedLimit(options.exampleLimit));
        const response = {
            ...result,
            checkedAt: new Date(now).toISOString(),
            cached: false,
        };
        cachedResult = response;
        cachedUntil = now + Math.max(0, cacheMs);
        return response;
    } catch (error) {
        logger.warn(`[AUTH-READINESS] PIN hash readiness check failed: ${error.message}`);
        return {
            status: 'error',
            totalActiveVendors: 0,
            hashedVendors: 0,
            missingHashes: null,
            missingExamples: [],
            error: error.message,
            checkedAt: new Date(now).toISOString(),
            cached: false,
        };
    }
}

function resetAuthPinReadinessCache() {
    cachedResult = null;
    cachedUntil = 0;
}

module.exports = {
    checkAuthPinHashReadiness,
    resetAuthPinReadinessCache,
    _private: {
        loadAuthPinHashCoverage,
        toInt,
        boundedLimit,
    },
};
