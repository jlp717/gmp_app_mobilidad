'use strict';

/**
 * GET /api/notifications/snapshot
 * Aggregates the 13 reads used by the Flutter notification badge into one
 * authenticated response. Reuses existing services/route handlers (and their
 * caches). Partial failures become null via Promise.allSettled. TTL 60s/user.
 */

const express = require('express');
const logger = require('../middleware/logger');
const { getOrSetCache } = require('../services/redis-cache');

const SNAPSHOT_TTL_SECONDS = 120;
const LOADER_KEYS = Object.freeze([
    'orders',
    'kpi',
    'ruteroHoy',
    'ruteroManana',
    'facturas',
    'commissions',
    'bolsa',
    'metrics',
    'topClients',
    'stats',
]);
// Badge first: cheap loaders. Heavy LACLAE/dashboard after, so login+JEFE warmer
// do not share queryGate=4 with two full /rutero/day scans.
const SNAPSHOT_PRIORITY_KEYS = Object.freeze([
    'orders',
    'kpi',
    'ruteroHoy',
    'ruteroManana',
]);

function dartWeekday(date) {
    const js = date.getDay();
    return js === 0 ? 7 : js;
}

function weekdayName(date) {
    return ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'][dartWeekday(date) - 1];
}

function dateKey(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
}

function resolveVendorScope(user) {
    const raw = Array.isArray(user?.vendedorCodes)
        ? user.vendedorCodes
        : Array.isArray(user?.vendorCodes)
            ? user.vendorCodes
            : String(user?.vendedorCodes || user?.vendorCodes || '').split(',');
    const list = raw
        .map((code) => String(code || '').trim())
        .filter((code) => code && code.toUpperCase() !== 'ALL');
    const isJefe = user?.isJefeVentas === true
        || ['JEFE_VENTAS', 'ADMIN', 'JEFE'].includes(String(user?.role || '').toUpperCase());
    if (list.length > 0) {
        return { csv: list.join(','), list, isJefe, primary: list[0] };
    }
    if (isJefe) {
        return { csv: 'ALL', list: [], isJefe, primary: '' };
    }
    const own = String(user?.code || user?.codigo || user?.id || '').trim();
    return { csv: own, list: own ? [own] : [], isJefe, primary: own };
}

function lastRouteHandler(router, routePath) {
    const stack = router?.stack;
    if (!Array.isArray(stack)) return null;
    const layer = stack.find((item) => item.route && item.route.path === routePath && item.route.methods.get);
    if (!layer) return null;
    const handlers = layer.route.stack;
    return handlers[handlers.length - 1]?.handle || null;
}

function invokeExpressHandler(handler, reqLike) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value, err) => {
            if (settled) return;
            settled = true;
            if (err) reject(err);
            else resolve(value);
        };
        const res = {
            statusCode: 200,
            locals: {},
            status(code) {
                this.statusCode = code;
                return this;
            },
            set() { return this; },
            setHeader() { return this; },
            getHeader() { return undefined; },
            json(body) {
                if (this.statusCode >= 400) finish(null);
                else finish(body ?? null);
            },
            send(body) {
                if (typeof body === 'string') {
                    try { body = JSON.parse(body); } catch (_err) { /* keep string */ }
                }
                this.json(body);
            },
        };
        const req = {
            method: 'GET',
            query: {},
            params: {},
            headers: {},
            get(name) {
                return this.headers[String(name).toLowerCase()];
            },
            ...reqLike,
        };
        Promise.resolve(handler(req, res))
            .then(() => {
                if (!settled) finish(null);
            })
            .catch((err) => finish(null, err));
    });
}

async function loadRuteroDay(ctx, date) {
    const { getClientsForDay } = require('../services/laclae');
    const dayName = weekdayName(date);
    const csv = String(ctx.scope?.csv || '').trim();
    const vendorArg = csv && csv.toUpperCase() !== 'ALL'
        ? csv
        : (Array.isArray(ctx.scope?.list) && ctx.scope.list.length > 0
            ? ctx.scope.list.join(',')
            : '');
    const codes = getClientsForDay(vendorArg, dayName, 'comercial', false) || [];
    return {
        count: codes.length,
        day: dayName,
        date: dateKey(date),
        clients: codes.slice(0, 4).map((code) => ({ name: code })),
    };
}

function createDefaultLoaders() {
    return {
        async orders(ctx) {
            const pedidosService = require('../services/pedidos.service');
            const [borrador, pendiente] = await Promise.all([
                pedidosService.getOrders({
                    vendedorCodes: ctx.scope.csv,
                    status: 'BORRADOR',
                    limit: 10,
                    offset: 0,
                }),
                pedidosService.getOrders({
                    vendedorCodes: ctx.scope.csv,
                    status: 'PENDIENTE',
                    limit: 10,
                    offset: 0,
                }),
            ]);
            return {
                borrador: Number(borrador?.count ?? borrador?.orders?.length ?? 0) || 0,
                pendiente: Number(pendiente?.count ?? pendiente?.orders?.length ?? 0) || 0,
            };
        },
        async kpi(ctx) {
            const kpiRoutes = require('../kpi/routes');
            const handler = lastRouteHandler(kpiRoutes, '/dashboard');
            if (!handler) return null;
            return invokeExpressHandler(handler, {
                user: ctx.user,
                query: { vendorCode: ctx.scope.csv },
            });
        },
        async ruteroHoy(ctx) {
            return loadRuteroDay(ctx, ctx.now);
        },
        async ruteroManana(ctx) {
            return loadRuteroDay(ctx, addDays(ctx.now, 1));
        },
        async facturas(ctx) {
            const facturasService = require('../services/facturas.service');
            const today = dateKey(ctx.now);
            const [hoy, mes] = await Promise.all([
                facturasService.getSummary({
                    vendedorCodes: ctx.scope.csv,
                    dateFrom: today,
                    dateTo: today,
                }),
                facturasService.getSummary({
                    vendedorCodes: ctx.scope.csv,
                    year: ctx.now.getFullYear(),
                    month: ctx.now.getMonth() + 1,
                }),
            ]);
            return { hoy: hoy || null, mes: mes || null };
        },
        async commissions(ctx) {
            if (ctx.user?.showCommissions === false) return null;
            // JEFE ALL commissions cold path is multi-second; badge does not need it.
            if (ctx.scope?.isJefe) return null;
            const commissions = require('./commissions');
            const handler = lastRouteHandler(commissions, '/summary');
            if (!handler) return null;
            const vendedorCode = ctx.scope.primary;
            if (!vendedorCode) return null;
            return invokeExpressHandler(handler, {
                user: ctx.user,
                query: {
                    vendedorCode,
                    year: String(ctx.now.getFullYear()),
                },
            });
        },
        async bolsa(ctx) {
            const bolsaService = require('../services/bolsa-comercial.service');
            const year = ctx.now.getFullYear();
            const month = ctx.now.getMonth() + 1;
            if (ctx.scope.isJefe || ctx.scope.list.length > 1) {
                return bolsaService.getGroupedStatus(ctx.scope.list, year, month);
            }
            if (!ctx.scope.primary) return null;
            return bolsaService.getBolsaStatus(ctx.scope.primary, year, month);
        },
        async metrics(ctx) {
            // Panel metrics for JEFE ALL contend with queryGate; badge uses kpi/orders.
            if (ctx.scope?.isJefe) return null;
            const { __deps } = require('../src/controllers/dashboard.controller');
            const result = await __deps.dashboardService.getMetrics(
                ctx.scope.csv,
                { year: ctx.now.getFullYear(), month: ctx.now.getMonth() + 1 },
            );
            return result?.payload ?? result ?? null;
        },
        async topClients(ctx) {
            if (ctx.scope?.isJefe) return null;
            const analytics = require('./analytics');
            const handler = lastRouteHandler(analytics, '/top-clients');
            if (!handler) return null;
            const body = await invokeExpressHandler(handler, {
                user: ctx.user,
                query: {
                    vendedorCodes: ctx.scope.csv,
                    year: String(ctx.now.getFullYear()),
                    month: String(ctx.now.getMonth() + 1),
                    limit: '3',
                },
            });
            const list = body?.clients || body?.data || [];
            return Array.isArray(list) ? list.slice(0, 3) : [];
        },
        async stats(ctx) {
            const pedidosService = require('../services/pedidos.service');
            const today = dateKey(ctx.now);
            return pedidosService.getOrderStats(ctx.scope.csv, today, today);
        },
    };
}

function defaultCache() {
    return {
        getOrSet: (ns, key, fn, ttl) => getOrSetCache(ns, key, fn, ttl),
    };
}

async function runLoaderWave(loaders, ctx, keys, snapshot) {
    const settled = await Promise.allSettled(
        keys.map((key) => {
            const fn = loaders[key];
            if (typeof fn !== 'function') return Promise.resolve(null);
            return Promise.resolve().then(() => fn(ctx));
        }),
    );
    keys.forEach((key, index) => {
        const result = settled[index];
        if (result.status === 'fulfilled') {
            snapshot[key] = result.value === undefined ? null : result.value;
            return;
        }
        logger.warn(`[notifications] loader ${key} failed: ${result.reason?.message || result.reason}`);
        snapshot[key] = null;
    });
}

async function assembleSnapshot(loaders, ctx) {
    const snapshot = {};
    const deferredKeys = LOADER_KEYS.filter((key) => !SNAPSHOT_PRIORITY_KEYS.includes(key));
    await runLoaderWave(loaders, ctx, SNAPSHOT_PRIORITY_KEYS, snapshot);
    await runLoaderWave(loaders, ctx, deferredKeys, snapshot);
    return snapshot;
}

function snapshotUserKey(user) {
    return String(user?.id || user?.code || user?.codigo || 'anon');
}

function createNotificationsRouter(deps = {}) {
    const router = express.Router();
    const loaders = deps.loaders || createDefaultLoaders();
    const cache = deps.cache || defaultCache();
    const nowFn = deps.now || (() => new Date());

    router.get('/snapshot', async (req, res) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Autenticación requerida',
                code: 'HTTP_401',
            });
        }
        const ctx = {
            user: req.user,
            scope: resolveVendorScope(req.user),
            now: nowFn(),
        };
        const cacheKey = `snapshot:${snapshotUserKey(req.user)}`;
        try {
            let computed = false;
            const snapshot = await cache.getOrSet('notifications', cacheKey, async () => {
                computed = true;
                return assembleSnapshot(loaders, ctx);
            }, SNAPSHOT_TTL_SECONDS);
            res.set('Cache-Control', 'private, max-age=60');
            res.set('X-Cache-Status', computed ? 'MISS' : 'HIT');
            return res.json({ success: true, ...snapshot });
        } catch (error) {
            logger.error(`[notifications] snapshot failed: ${error.message}`);
            return res.status(500).json({
                success: false,
                error: 'Error interno',
                code: 'HTTP_500',
            });
        }
    });

    return router;
}

module.exports = createNotificationsRouter();
module.exports.createNotificationsRouter = createNotificationsRouter;
module.exports.assembleSnapshot = assembleSnapshot;
module.exports.LOADER_KEYS = LOADER_KEYS;
module.exports.SNAPSHOT_PRIORITY_KEYS = SNAPSHOT_PRIORITY_KEYS;
module.exports.SNAPSHOT_TTL_SECONDS = SNAPSHOT_TTL_SECONDS;
module.exports.resolveVendorScope = resolveVendorScope;
