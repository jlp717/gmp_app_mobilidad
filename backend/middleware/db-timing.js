'use strict';

/**
 * DB query timing wrapper. Does not modify config/db.js (intocable).
 * Accumulates ms/n on an AsyncLocalStorage stats object that app.js
 * aliases onto req.dbStats so the JSON request line can emit db_ms.
 */
const { AsyncLocalStorage } = require('async_hooks');
const db = require('../config/db');
const logger = require('./logger');

const statsAls = new AsyncLocalStorage();
const SLOW_MS = Number(process.env.DB_QUERY_SLOW_MS) || 500;

function runWithStats(stats, fn) {
    return statsAls.run(stats || { ms: 0, n: 0 }, fn);
}

function bump(durationMs) {
    const stats = statsAls.getStore();
    if (stats) {
        stats.ms += durationMs;
        stats.n += 1;
    }
    if (durationMs >= SLOW_MS) {
        const id = (stats && stats.requestId) || '-';
        logger.warn(`[SLOW_QUERY_REQ] id=${id} durationMs=${durationMs}`);
    }
}

async function query(sql, logQuery, logError) {
    const t0 = Date.now();
    try {
        return await db.query(sql, logQuery, logError);
    } finally {
        bump(Date.now() - t0);
    }
}

async function queryWithParams(sql, params, logQuery, logError) {
    const t0 = Date.now();
    try {
        return await db.queryWithParams(sql, params, logQuery, logError);
    } finally {
        bump(Date.now() - t0);
    }
}

module.exports = {
    ...db,
    query,
    queryWithParams,
    runWithStats,
};
