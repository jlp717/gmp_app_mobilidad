const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../middleware/logger');
const { getPool, query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL, deleteCachePattern } = require('../services/redis-cache');
const {
    getCurrentDate,
    buildVendedorFilter,
    formatCurrency,
    LACLAE_SALES_FILTER,
    sanitizeForSQL,
    lookupClientAssignedVendorCodes,
    handleRouteError
} = require('../utils/common');
const { db2ErpTable } = require('../utils/db2-schemas');

// Imports from laclae service
const {
    getWeekCountsFromCache,
    getTotalClientsFromCache,
    getClientsForDay: getClientsForDayService,
    reloadRuteroConfig,
    loadLaclaeCache,
    getClientCurrentDay,
    getNaturalOrder,
    laclaeCacheLastLoadTime
} = require('../services/laclae');
const { sendAuditEmail, sendAuditEmailNow } = require('../services/emailService');

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const RUTERO_WEEKDAY_INDEX = {
    lunes: 0,
    martes: 1,
    miercoles: 2,
    jueves: 3,
    viernes: 4,
    sabado: 5,
    domingo: 6
};
const ORDER_STATUS_EMPTY_LABEL = 'SIN VENTA';

function dateParts(dateValue) {
    const year = dateValue.getFullYear();
    const month = dateValue.getMonth() + 1;
    const day = dateValue.getDate();
    return {
        year,
        month,
        day,
        iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    };
}

function parseIsoDateOnly(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const parsed = new Date(year, month - 1, day);
    if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
    ) {
        return null;
    }
    return dateParts(parsed);
}

function resolveRuteroOrderDate({ date, year, month, week, normalizedDay, now }) {
    const explicitDate = parseIsoDateOnly(date);
    if (explicitDate) return explicitDate;

    const currentYear = parseInt(year, 10) || now.getFullYear();
    const currentMonth = parseInt(month, 10) || (now.getMonth() + 1);
    const selectedWeek = parseInt(week, 10);
    const dayIndex = RUTERO_WEEKDAY_INDEX[normalizedDay];

    if (!Number.isFinite(selectedWeek) || selectedWeek < 1 || dayIndex === undefined) {
        return dateParts(now);
    }

    const firstOfMonth = new Date(currentYear, currentMonth - 1, 1);
    const lastOfMonth = new Date(currentYear, currentMonth, 0);
    const firstWeekday = firstOfMonth.getDay() === 0 ? 7 : firstOfMonth.getDay();
    const mondayDay = 1 + (selectedWeek - 1) * 7 - (firstWeekday - 1);
    const selectedDay = mondayDay + dayIndex;
    const clampedDay = Math.min(Math.max(selectedDay, 1), lastOfMonth.getDate());

    return dateParts(new Date(currentYear, currentMonth - 1, clampedDay));
}

function emptyRuteroOrderStatus(orderDate) {
    return {
        state: 'SIN_PEDIDO',
        label: ORDER_STATUS_EMPTY_LABEL,
        hasOrder: false,
        confirmedCount: 0,
        draftCount: 0,
        totalCount: 0,
        date: orderDate.iso
    };
}

function normalizeRuteroVendorCodes(vendedorCodes) {
    const raw = String(vendedorCodes || '').trim();
    if (!raw || raw.toUpperCase() === 'ALL') return [];
    return raw
        .split(',')
        .map(code => code.trim())
        .filter(Boolean);
}

function normalizePlannerVendorCode(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';
    return /^\d+$/.test(raw) ? (raw.replace(/^0+/, '') || '0') : raw;
}

function plannerCodesMatch(left, right) {
    return normalizePlannerVendorCode(left) === normalizePlannerVendorCode(right);
}

const PLANNER_SCOPE_SENTINELS = new Set(['UNK', 'NONE', 'NULL', 'N/A', '0']);

function sanitizePlannerScopeCodes(codes) {
    return [...new Set((Array.isArray(codes) ? codes : [])
        .map((code) => String(code || '').trim())
        .filter((code) => code && !PLANNER_SCOPE_SENTINELS.has(normalizePlannerVendorCode(code))))];
}

function getPlannerUserContext(req) {
    const user = req.user || {};
    const role = String(user.role || '').trim().toUpperCase();
    const code = String(user.code || user.codigovendedor || '').trim();
    const privileged = user.isJefeVentas === true || ['JEFE_VENTAS', 'ADMIN'].includes(role);
    const visibleCodes = [...new Set([
        ...(Array.isArray(user.vendorCodes) ? user.vendorCodes : []),
        ...(Array.isArray(user.vendedorCodes) ? user.vendedorCodes : []),
    ].map(value => String(value || '').trim()).filter(Boolean))];
    return { role, code, privileged, visibleCodes };
}

function writePlannerVendorField(req, location, field, value) {
    if (!req[location] || typeof req[location] !== 'object') {
        req[location] = {};
    }
    req[location][field] = value;
    if (location !== 'query' || !req.query) return;
    if (field !== 'vendedor') req.query.vendedor = value;
    if (field !== 'vendedorCodes') req.query.vendedorCodes = value;
}

function plannerForbidden(res, error = 'No autorizado para este vendedor') {
    return res.status(403).json({ error, code: 'INSUFFICIENT_ROLE' });
}

function requirePlannerPrivilege(req, res, next) {
    const context = getPlannerUserContext(req);
    if (!context.code) {
        return res.status(401).json({ error: 'Autenticación requerida', code: 'MISSING_TOKEN' });
    }
    if (!context.privileged) return plannerForbidden(res, 'Acceso restringido a responsables de ventas');
    return next();
}

function requirePlannerVendedoresAccess(req, res, next) {
    const context = getPlannerUserContext(req);
    if (!context.code) {
        return res.status(401).json({ error: 'Autenticación requerida', code: 'MISSING_TOKEN' });
    }
    if (context.role === 'REPARTIDOR' && !context.privileged) {
        return plannerForbidden(res, 'Acceso restringido a responsables de ventas');
    }
    return next();
}

function requirePlannerVendorScope({ location, field, mutation = false, requireValue = true }) {
    return (req, res, next) => {
        const context = getPlannerUserContext(req);
        if (!context.code) {
            return res.status(401).json({ error: 'Autenticación requerida', code: 'MISSING_TOKEN' });
        }
        if (mutation && context.role === 'REPARTIDOR') {
            return plannerForbidden(res, 'REPARTIDOR no puede modificar ruteros comerciales');
        }

        const raw = req[location]?.[field];
        if (raw == null || String(raw).trim() === '') {
            return requireValue && !context.privileged ? plannerForbidden(res) : next();
        }

        const requestedCodes = String(raw).split(',').map(code => code.trim()).filter(Boolean);
        if (requestedCodes.length === 0) return context.privileged ? next() : plannerForbidden(res);

        if (context.privileged) {
            const requestedAll = requestedCodes.some(code => code.toUpperCase() === 'ALL');
            if (context.visibleCodes.length === 0) return next();
            if (requestedAll) {
                // Expand literal ALL to the manager's visible vendor claims so
                // "Todos los comerciales" keeps working in commercial Ruta.
                const expanded = sanitizePlannerScopeCodes(context.visibleCodes).join(',');
                if (!expanded) return plannerForbidden(res);
                writePlannerVendorField(req, location, field, expanded);
                return next();
            }
            const allowedCodes = requestedCodes.filter(requested =>
                context.visibleCodes.some(visible => plannerCodesMatch(requested, visible)));
            if (allowedCodes.length === 0) return plannerForbidden(res);
            if (allowedCodes.length !== requestedCodes.length) {
                writePlannerVendorField(req, location, field, allowedCodes.join(','));
            }
            return next();
        }

        const ownedCodes = sanitizePlannerScopeCodes([context.code, ...context.visibleCodes]);
        if (ownedCodes.length === 0) return plannerForbidden(res);

        if (mutation) {
            const ownsEveryCode = requestedCodes.every(code =>
                code.toUpperCase() !== 'ALL' &&
                ownedCodes.some(owned => plannerCodesMatch(code, owned)));
            return ownsEveryCode ? next() : plannerForbidden(res);
        }

        // GET: never 403 a commercial over a leftover ALL / other-vendor
        // filter. Serve their own scope so Ruta still loads.
        const requestedAll = requestedCodes.some(code => code.toUpperCase() === 'ALL');
        const allowedCodes = requestedAll
            ? ownedCodes
            : requestedCodes.filter(code =>
                ownedCodes.some(owned => plannerCodesMatch(code, owned)));
        const clamped = allowedCodes.length > 0 ? allowedCodes : ownedCodes;
        const alreadyExact = !requestedAll
            && clamped.length === requestedCodes.length
            && requestedCodes.every((code, index) => plannerCodesMatch(code, clamped[index]));
        if (!alreadyExact) {
            writePlannerVendorField(req, location, field, clamped.join(','));
        }
        return next();
    };
}

async function requirePlannerClientOwnership(req, res, next) {
    const context = getPlannerUserContext(req);
    if (!context.code) {
        return res.status(401).json({ error: 'Autenticación requerida', code: 'MISSING_TOKEN' });
    }
    if (context.privileged) return next();
    if (context.role === 'REPARTIDOR') return plannerForbidden(res, 'No autorizado para consultar este cliente');

    const clientCode = String(req.params?.code || '').trim();
    if (!/^[A-Za-z0-9]{1,10}$/.test(clientCode)) {
        return plannerForbidden(res, 'No autorizado para consultar este cliente');
    }
    try {
        const assignedCodes = await lookupClientAssignedVendorCodes(clientCode);
        const ownsClient = assignedCodes.some(code => plannerCodesMatch(code, context.code));
        return ownsClient ? next() : plannerForbidden(res, 'No autorizado para consultar este cliente');
    } catch (_error) {
        return plannerForbidden(res, 'No autorizado para consultar este cliente');
    }
}

async function getRuteroOrderStatusMap(clientCodes, { vendedorCodes, orderDate }) {
    const statusMap = new Map();
    clientCodes.forEach(code => {
        statusMap.set(code, emptyRuteroOrderStatus(orderDate));
    });

    if (!clientCodes.length) return { statusMap, degraded: false };

    const clientPlaceholders = clientCodes.map(() => '?').join(',');
    const vendorCodes = normalizeRuteroVendorCodes(vendedorCodes);
    const useVendorFilter = vendorCodes.length > 0 && vendorCodes.length <= 50;
    const vendorFilterSql = useVendorFilter
        ? ` AND TRIM(C.CODIGOVENDEDOR) IN (${vendorCodes.map(() => '?').join(',')})`
        : '';

    // JAVIER.PEDIDOS_CAB is the app/test buffer. Commercial Ruta reads live
    // ERP orders from DSEDAC.CPC: client=CODIGOCLIENTEALBARAN, not ESTADO.
    const sql = `
        SELECT
            TRIM(C.CODIGOCLIENTEALBARAN) AS CODE,
            COUNT(*) AS TOTAL_COUNT,
            MAX(C.NUMEROPEDIDO) AS LAST_ORDER_NUMBER
        FROM ${db2ErpTable('CPC')} C
        WHERE TRIM(C.CODIGOCLIENTEALBARAN) IN (${clientPlaceholders})
          AND C.ANODOCUMENTO = ?
          AND C.MESDOCUMENTO = ?
          AND C.DIADOCUMENTO = ?
          AND TRIM(C.SUBEMPRESAPEDIDO) = 'GMP'
          ${vendorFilterSql}
        GROUP BY TRIM(C.CODIGOCLIENTEALBARAN)
    `;

    const params = [
        ...clientCodes,
        orderDate.year,
        orderDate.month,
        orderDate.day,
        ...(useVendorFilter ? vendorCodes : []),
    ];

    try {
        const rows = await queryWithParams(sql, params, false, false);
        (rows || []).forEach((row) => {
            const code = (row.CODE ?? row.code ?? '').toString().trim();
            if (!code) return;
            const totalCount = parseInt(row.TOTAL_COUNT ?? row.total_count, 10) || 0;
            const lastOrderNumber = parseInt(row.LAST_ORDER_NUMBER ?? row.last_order_number, 10) || null;
            if (totalCount <= 0) return;

            statusMap.set(code, {
                state: 'CONFIRMADO',
                label: 'VENTA CONFIRMADA',
                hasOrder: true,
                confirmedCount: totalCount,
                draftCount: 0,
                totalCount,
                lastOrderId: null,
                lastOrderNumber,
                date: orderDate.iso,
            });
        });
        return { statusMap, degraded: false };
    } catch (_error) {
        logger.error('[RUTERO DAY] CPC production order status query failed');
        return { statusMap, degraded: true };
    }
}

// =============================================================================
// ROUTER CALENDAR
// =============================================================================
router.get('/router/calendar', requirePlannerVendorScope({ location: 'query', field: 'vendedorCodes' }), async (req, res) => {
    try {
        const { vendedorCodes } = req.query;
        const now = getCurrentDate();
        const year = parseInt(req.query.year) || now.getFullYear();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

        const sql = `
SELECT
L.ANODOCUMENTO as year, L.MESDOCUMENTO as month, L.DIADOCUMENTO as day,
  L.CODIGOCLIENTEALBARAN as clientCode, C.NOMBRECLIENTE as clientName,
  C.DIRECCION as clientAddress, C.POBLACION as clientCity,
  C.TELEFONO1 as clientPhone, L.CODIGOVENDEDOR as vendedorCode,
  SUM(L.IMPORTEVENTA) as totalSale,
  SUM(L.IMPORTEMARGENREAL) as totalMargin,
  COUNT(*) as numLines,
  COUNT(DISTINCT L.CODIGOARTICULO) as numProducts
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE L.ANODOCUMENTO = ? AND L.MESDOCUMENTO = ? 
        AND L.TIPOVENTA IN ('CC', 'VC')
        AND L.TIPOLINEA IN ('AB', 'VT')
        AND L.SERIEALBARAN NOT IN ('N', 'Z')
        ${vendedorFilter}
      GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO, L.DIADOCUMENTO,
  L.CODIGOCLIENTEALBARAN, C.NOMBRECLIENTE, C.DIRECCION, C.POBLACION,
  C.TELEFONO1, L.CODIGOVENDEDOR
      ORDER BY L.DIADOCUMENTO DESC, totalSale DESC
    `;

        // Cache calendar for 15 minutes
        const cacheKey = `calendar:${year}:${month}:${vendedorCodes}`;
        const activities = await cachedQuery(queryWithParams, sql, cacheKey, TTL.MEDIUM, [year, month]);

        // Group by day
        const dayMap = {};
        activities.forEach(a => {
            const day = a.DAY;
            if (!dayMap[day]) {
                dayMap[day] = { day, visits: [], totalSales: 0, totalClients: 0 };
            }
            dayMap[day].visits.push({
                client: {
                    code: a.CLIENTCODE?.trim(),
                    name: a.CLIENTNAME?.trim(),
                    address: a.CLIENTADDRESS?.trim(),
                    city: a.CLIENTCITY?.trim(),
                    phone: a.CLIENTPHONE?.trim()
                },
                vendedorCode: a.VENDEDORCODE?.trim(),
                sale: formatCurrency(a.TOTALSALE),
                margin: formatCurrency(a.TOTALMARGIN),
                numLines: parseInt(a.NUMLINES) || 0,
                numProducts: parseInt(a.NUMPRODUCTS) || 0
            });
            dayMap[day].totalSales += formatCurrency(a.TOTALSALE);
            dayMap[day].totalClients++;
        });

        res.json({
            period: { year, month },
            days: Object.values(dayMap).sort((a, b) => b.day - a.day),
            summary: {
                totalDaysWithActivity: Object.keys(dayMap).length,
                totalVisits: activities.length,
                totalSales: activities.reduce((sum, a) => sum + formatCurrency(a.TOTALSALE), 0)
            }
        });

    } catch (error) {
        handleRouteError(error, res, 'Error obteniendo rutero', 500);
    }
});

// =============================================================================
// RUTERO WEEK (Fast CACHE version)
// =============================================================================
router.get('/rutero/week', requirePlannerVendorScope({ location: 'query', field: 'vendedorCodes' }), async (req, res) => {
    try {
        const { vendedorCodes, role } = req.query;
        const now = getCurrentDate();
        const todayName = DAY_NAMES[now.getDay()];
        const currentRole = role || 'comercial';
        const ignoreOverridesBool = req.query.ignoreOverrides === 'true';

        logger.info(`[RUTERO WEEK] vendedorCodes: "${vendedorCodes}", role: "${currentRole}", ignoreOverrides: ${ignoreOverridesBool}`);

        // Try to use cache first (instant response)
        const cachedCounts = getWeekCountsFromCache(vendedorCodes, currentRole, ignoreOverridesBool);

        if (cachedCounts) {
            // Calculate total unique clients from cache
            const totalClients = getTotalClientsFromCache(vendedorCodes, currentRole);

            // Calculate delivery progress for today
            let weekProgress = {};
            try {
                    const todayClients = cachedCounts[todayName] || 0;
                    if (todayClients > 0) {
                            const UNK_SENTINEL = new Set(['UNK', 'NONE', 'NULL', 'N/A', '0', '', 'undefined', 'null']);
                            const cleanCodes = vendedorCodes ? vendedorCodes.split(',').map(c => c.trim()).filter(c => !UNK_SENTINEL.has(c.toUpperCase())) : [];
                        let deliveredToday = 0;
                        if (cleanCodes.length > 0) {
                            // HYBRID approach: Count from ERP data (primary) + App status (supplement)
                            // 1. Primary: Count from OPP/CPC where CONFORMADOSN = 'S' for today (ERP native)
                            const now = new Date();
                            const dia = now.getDate();
                            const mes = now.getMonth() + 1;
                            const ano = now.getFullYear();
                            try {
                                const erpPlaceholders = cleanCodes.map(() => '?').join(',');
                                const erpSql = `
                                    SELECT COUNT(DISTINCT CPC.NUMEROALBARAN) as DELIVERED
                                    FROM DSEDAC.OPP OPP
                                    INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                                    WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${erpPlaceholders})
                                      AND OPP.DIAREPARTO = ?
                                      AND OPP.MESREPARTO = ?
                                      AND OPP.ANOREPARTO = ?
                                      AND (TRIM(CPC.CONFORMADOSN) = 'S' OR CPC.SITUACIONALBARAN IN ('F', 'R'))
                                `;
                                const erpParams = [...cleanCodes, dia, mes, ano];
                                const erpRows = await queryWithParams(erpSql, erpParams, false, false);
                                deliveredToday = parseInt(erpRows[0]?.DELIVERED) || 0;
                            } catch (erpErr) {
                                logger.warn(`[RUTERO WEEK] ERP delivery count error: ${erpErr.message}`);
                            }

                            // 2. Supplement: Add app-confirmed deliveries from DELIVERY_STATUS (if table exists)
                            try {
                                const { isDeliveryStatusNewSchema } = require('../utils/delivery-status-check');
                                const dsNew = isDeliveryStatusNewSchema();
                                const appPlaceholders = cleanCodes.map(() => '?').join(',');
                                const countCol = dsNew ? 'COUNT(DISTINCT DS.IDEMPOTENCY_TOKEN)' : 'COUNT(DISTINCT DS.ID)';
                                const repCol = dsNew ? 'DS.OPERADOR' : 'DS.REPARTIDOR_ID';
                                const dateCol = dsNew ? 'DS.UPDATED_AT' : 'DS.FECHAACTUALIZACION';
                                const appSql = `
                                    SELECT ${countCol} as DELIVERED
                                    FROM JAVIER.DELIVERY_STATUS DS
                                    WHERE DS.STATUS = 'ENTREGADO'
                                      AND ${repCol} IN (${appPlaceholders})
                                      AND DATE(${dateCol}) = CURRENT DATE
                                `;
                                const appRows = await queryWithParams(appSql, cleanCodes, false, false);
                                const appDelivered = parseInt(appRows[0]?.DELIVERED) || 0;
                                // Use the higher of the two counts (avoid double counting)
                                deliveredToday = Math.max(deliveredToday, appDelivered);
                            } catch (dsErr) {
                                // DELIVERY_STATUS table may not exist — this is OK, ERP data is primary
                            }
                        }
                    weekProgress[todayName] = {
                        total: todayClients,
                        delivered: deliveredToday,
                        percentage: Math.round((deliveredToday / todayClients) * 100)
                    };
                }
            } catch (progressErr) {
                logger.warn(`[RUTERO WEEK] Progress calc error: ${progressErr.message}`);
            }

            logger.info(`[RUTERO WEEK] From cache: ${JSON.stringify(cachedCounts)}, total: ${totalClients}, progress: ${JSON.stringify(weekProgress)}`);

            return res.json({
                week: cachedCounts,
                todayName,
                role: currentRole,
                totalUniqueClients: totalClients,
                weekProgress
            });
        }

        // Fallback: Cache not ready, try direct DB query 
        logger.warn(`[RUTERO WEEK] Cache not ready, querying DB for basic counts`);
        try {
            // SECURITY: Use parameterized query to prevent SQL injection
            const cleanCodes = vendedorCodes ? vendedorCodes.split(',').map(c => c.trim()).filter(c => c) : [];
            // CDVI uses SN columns for days: DIAVISITALUNESSN, DIAVISITAMARTESSN, etc.
            const fallbackSql = `
                SELECT 
                    SUM(CASE WHEN DIAVISITALUNESSN = 'S' THEN 1 ELSE 0 END) as LUNES,
                    SUM(CASE WHEN DIAVISITAMARTESSN = 'S' THEN 1 ELSE 0 END) as MARTES,
                    SUM(CASE WHEN DIAVISITAMIERCOLESSN = 'S' THEN 1 ELSE 0 END) as MIERCOLES,
                    SUM(CASE WHEN DIAVISITAJUEVESSN = 'S' THEN 1 ELSE 0 END) as JUEVES,
                    SUM(CASE WHEN DIAVISITAVIERNESSN = 'S' THEN 1 ELSE 0 END) as VIERNES,
                    SUM(CASE WHEN DIAVISITASABADOSN = 'S' THEN 1 ELSE 0 END) as SABADO,
                    SUM(CASE WHEN DIAVISITADOMINGOSN = 'S' THEN 1 ELSE 0 END) as DOMINGO
                FROM DSEDAC.CDVI
                WHERE 1=1
            `;
            
            let fbRows = [];
            if (cleanCodes.length > 0) {
                const placeholders = cleanCodes.map(() => '?').join(',');
                const fullSql = fallbackSql.replace('WHERE 1=1', `WHERE TRIM(CODIGOVENDEDOR) IN (${placeholders})`);
                fbRows = await queryWithParams(fullSql, cleanCodes, false, false);
            }
            const fallbackCounts = { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 };
            let fallbackTotal = 0;

            if (fbRows.length > 0) {
                const r = fbRows[0];
                fallbackCounts.lunes = parseInt(r.LUNES) || 0;
                fallbackCounts.martes = parseInt(r.MARTES) || 0;
                fallbackCounts.miercoles = parseInt(r.MIERCOLES) || 0;
                fallbackCounts.jueves = parseInt(r.JUEVES) || 0;
                fallbackCounts.viernes = parseInt(r.VIERNES) || 0;
                fallbackCounts.sabado = parseInt(r.SABADO) || 0;
                fallbackCounts.domingo = parseInt(r.DOMINGO) || 0;
                fallbackTotal = Object.values(fallbackCounts).reduce((a, b) => a + b, 0);
            }

            return res.json({
                week: fallbackCounts,
                todayName,
                role: currentRole,
                totalUniqueClients: fallbackTotal,
                cacheStatus: 'loading'
            });
        } catch (fbErr) {
            logger.error(`[RUTERO WEEK] Fallback query also failed: ${fbErr.message}`);
            res.json({
                week: { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 },
                todayName,
                role: currentRole,
                totalUniqueClients: 0,
                cacheStatus: 'error'
            });
        }
    } catch (error) {
        handleRouteError(error, res, 'Error obteniendo rutero semana', 500);
    }
});

// =============================================================================
// RUTERO VENDEDORES
// =============================================================================
router.get('/rutero/vendedores', requirePlannerVendedoresAccess, async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const { role } = req.query;
        const context = getPlannerUserContext(req);
        let sql;
        let params = [];

        if (role === 'repartidor') {
            sql = `
                    SELECT TRIM(V.CODIGOVENDEDOR) as code, TRIM(D.NOMBREVENDEDOR) as name
                    FROM DSEDAC.VEH V
                    JOIN DSEDAC.VDD D ON V.CODIGOVENDEDOR = D.CODIGOVENDEDOR
                    ORDER BY D.NOMBREVENDEDOR
                `;
        } else {
            sql = `
                    SELECT TRIM(VDD.CODIGOVENDEDOR) as code, TRIM(VDD.NOMBREVENDEDOR) as name
                    FROM DSEDAC.VDD VDD
                    WHERE EXISTS (
                        SELECT 1
                        FROM DSEDAC.VDC VDC
                        WHERE TRIM(VDC.CODIGOVENDEDOR) = TRIM(VDD.CODIGOVENDEDOR)
                          AND VDC.SUBEMPRESA = 'GMP'
                    )
                    ORDER BY VDD.NOMBREVENDEDOR
                `;
        }

        const cacheKey = `vendedores:active:${currentYear}:${role || 'comercial'}`;
        const vendedores = await cachedQuery(queryWithParams, sql, {
            cacheKey,
            ttl: TTL.LONG,
            params
        }, params);

        const mapped = vendedores.map(v => {
            const code = (v.CODE || v.code || v.Code || '').toString().trim();
            const name = (v.NAME || v.name || v.Name || '').toString().trim();
            return { code, name: name || `Vendedor ${code}` };
        }).filter(v => v.code && v.code.length > 0);

        mapped.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

        const allowedCodes = context.privileged
            ? sanitizePlannerScopeCodes(context.visibleCodes)
            : sanitizePlannerScopeCodes([context.code, ...context.visibleCodes]);
        const scoped = allowedCodes.length > 0
            ? mapped.filter((vendor) => allowedCodes.some((allowed) => plannerCodesMatch(vendor.code, allowed)))
            : mapped;

        logger.info(`[VENDEDORES] Returning ${scoped.length} active ${role || 'comercial'} vendors`);

        res.json({ vendedores: scoped });
    } catch (error) {
        logger.error(`Error fetching vendedores: ${error.message}`);
        res.status(500).json({ error: 'Error fetching vendedores' });
    }
});

// =============================================================================
// RUTERO MOVE CLIENTS
// =============================================================================
router.post('/rutero/move_clients', requirePlannerVendorScope({ location: 'body', field: 'vendedor', mutation: true, requireValue: false }), async (req, res) => {
    let conn;
    try {
        const { vendedor, moves, targetPosition } = req.body;

        if (!vendedor || !moves || !Array.isArray(moves)) {
            return res.status(400).json({ error: 'Datos inválidos. Se requiere vendedor y array de movimientos.' });
        }

        if (vendedor.includes(',')) {
            return res.status(400).json({ error: 'Vendedor debe ser un código único, no una lista.' });
        }

        // SECURITY: Verify user authorization
        // User must be either a JEFE_VENTAS (can modify any rutero) or the owner of this rutero
        const userCode = req.user?.codigovendedor || req.user?.code;
        const isJefeVentas = getPlannerUserContext(req).privileged;
        
        if (!userCode) {
            return res.status(401).json({ error: 'Autenticación requerida', code: 'MISSING_TOKEN' });
        }
        
        if (!isJefeVentas && userCode !== vendedor) {
            logger.warn(`[AUTH] User ${userCode} attempted to move clients in rutero for vendor ${vendedor} without permission`);
            return res.status(403).json({ error: 'No tienes permisos para modificar el rutero de otro vendedor', code: 'INSUFFICIENT_ROLE' });
        }

        const DIAS_PROHIBIDOS = ['domingo'];
        const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

        for (const move of moves) {
            const dayLower = (move.toDay || '').toLowerCase();
            if (DIAS_PROHIBIDOS.includes(dayLower)) {
                return res.status(400).json({
                    error: 'No se permite mover clientes al Domingo',
                    invalidDay: move.toDay
                });
            }
            if (!DIAS_VALIDOS.includes(dayLower)) {
                return res.status(400).json({
                    error: `Día inválido: ${move.toDay}`,
                    validDays: DIAS_VALIDOS
                });
            }
        }

        const pool = getPool();
        if (!pool) throw new Error("Database pool not initialized");

        conn = await pool.connect();
        // Removed beginTransaction to avoid DB2 Journaling silent failure

        const movedClientsInfo = [];

        for (const move of moves) {
            const { client, toDay, position, fromDay } = move;
            if (!client || !toDay) continue;

            const dayLower = toDay.toLowerCase();
            const clientTrimmed = client.trim();

            // Determine source day: prefer explicit fromDay, then RUTERO_CONFIG, then natural
            let previousDay = fromDay ? fromDay.toLowerCase() : getClientCurrentDay(vendedor, clientTrimmed);
            let previousOrder = null;

            try {
                const prevRes = await conn.query(`
                    SELECT TRIM(DIA) as DIA, ORDEN FROM JAVIER.RUTERO_CONFIG
                    WHERE VENDEDOR = ? AND TRIM(CLIENTE) = ?
                    AND ORDEN >= 0
                    ORDER BY ORDEN ASC
                    FETCH FIRST 1 ROWS ONLY
                `, [vendedor, clientTrimmed]);
                if (prevRes && prevRes.length > 0) {
                    if (!fromDay) previousDay = prevRes[0].DIA?.trim() || previousDay;
                    previousOrder = prevRes[0].ORDEN;
                }
            } catch (e) {
                logger.warn(`Could not get previous config: ${e.message}`);
            }

            logger.info(`📋 Move: Cliente ${clientTrimmed} de "${previousDay || 'ninguno'}" a "${dayLower}"`);

            // Delete ALL existing entries for this client (positives + blocks)
            await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = ? AND TRIM(CLIENTE) = ?`, [vendedor, clientTrimmed]);

            // Insert BLOCKING entry for source day (ORDEN = -1) so client no longer appears there
            if (previousDay && previousDay !== dayLower) {
                await conn.query(`
                    INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN)
                    VALUES (?, ?, ?, -1)
                `, [vendedor, previousDay, clientTrimmed]);
                logger.info(`🚫 Block entry created: ${clientTrimmed} blocked from ${previousDay}`);
            }

            let targetOrder;
            const effectivePosition = position ?? targetPosition ?? 'end';

            if (effectivePosition === 'start' || effectivePosition === 0) {
                await conn.query(`
                    UPDATE JAVIER.RUTERO_CONFIG
                    SET ORDEN = ORDEN + 10
                    WHERE VENDEDOR = ? AND DIA = ? AND ORDEN >= 0
                `, [vendedor, dayLower]);
                targetOrder = 0;
            } else if (typeof effectivePosition === 'number' && effectivePosition > 0) {
                targetOrder = effectivePosition * 10;
                await conn.query(`
                    UPDATE JAVIER.RUTERO_CONFIG
                    SET ORDEN = ORDEN + 10
                    WHERE VENDEDOR = ? AND DIA = ? AND ORDEN >= ?
                `, [vendedor, dayLower, targetOrder]);
            } else {
                const maxOrderRes = await conn.query(`
                    SELECT MAX(ORDEN) as MAX_ORD
                    FROM JAVIER.RUTERO_CONFIG
                    WHERE VENDEDOR = ? AND DIA = ? AND ORDEN >= 0
                `, [vendedor, dayLower]);

                // Si movemos al final, y no hay overrides (MAX_ORD is null), debemos ponerlo después de los naturales.
                // Los naturales asumen orden 20000+natOrder o 99999 si no tienen.
                // Para asegurarnos de que quede al final de todo, usamos un número muy alto si no se pasa posición.
                const currentMax = maxOrderRes[0]?.MAX_ORD || 0;
                targetOrder = Math.max(currentMax + 10, 199990); // 199990 garantiza que va al fondo de los naturales (que llegan a 99999)
            }

            await conn.query(`
                INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN)
                VALUES (?, ?, ?, ?)
            `, [vendedor, dayLower, clientTrimmed, targetOrder]);

            movedClientsInfo.push({
                client: clientTrimmed,
                clientName: move.clientName || 'Cliente',
                fromDay: previousDay || null,
                toDay: dayLower,
                previousPosition: previousOrder,
                newPosition: targetOrder
            });
        }
        // 🎯 FIX: Clear Redis cache for the day endpoint before doing DB transactions
        try {
            await deleteCachePattern(`rutero:config:v2:${vendedor}:*`);
            await deleteCachePattern(`query:rutero:details:v3:*`);
            await deleteCachePattern(`query:rutero:sales:*`);
            await deleteCachePattern(`query:rutero:gps:*`);
        } catch (e) {
            logger.warn(`Failed to invalidate cache patterns: ${e.message}`);
        }

        try {
            for (const moved of movedClientsInfo) {
                await conn.query(`
                    INSERT INTO JAVIER.RUTERO_LOG 
                    (VENDEDOR, TIPO_CAMBIO, DIA_ORIGEN, DIA_DESTINO, CLIENTE, NOMBRE_CLIENTE, POSICION_ANTERIOR, POSICION_NUEVA, DETALLES)
                    VALUES (?, 'CAMBIO_DIA', ?, ?, ?, ?, ?, ?, ?)
                `, [vendedor, moved.fromDay, moved.toDay, moved.client, sanitizeForSQL(moved.clientName || ''), moved.previousPosition, moved.newPosition, `Movido de ${moved.fromDay} a ${moved.toDay}`]);
            }
        } catch (logErr) {
            logger.warn(`Log insert failed (non-blocking): ${logErr.message}`);
        }

        await reloadRuteroConfig();

        const affectedDays = [...new Set(moves.map(m => m.toDay.toLowerCase()))];
        const updatedCounts = {};

        for (const day of affectedDays) {
            const countRes = await conn.query(`
                SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG
                WHERE VENDEDOR = ? AND DIA = ? AND ORDEN >= 0
            `, [vendedor, day]);
            updatedCounts[day] = countRes[0]?.CNT || 0;
        }

        try {
            sendAuditEmail(vendedor, 'Cambio de Día (Movimiento)', {
                action: 'Move Clients',
                count: movedClientsInfo.length,
                movedClients: movedClientsInfo.map(m => ({
                    code: m.client,
                    name: m.clientName,
                    fromDay: m.fromDay,
                    toDay: m.toDay,
                    previousPosition: m.previousPosition,
                    newPosition: m.newPosition
                }))
            });
        } catch (e) { /* ignore email errors */ }

        res.json({
            success: true,
            message: 'Clientes movidos correctamente',
            movedClients: movedClientsInfo,
            updatedCounts
        });

    } catch (error) {
        if (conn) { try { await conn.rollback(); } catch (e) { logger.warn(`Rollback failed: ${e.message}`); } }
        handleRouteError(error, res, 'Error moviendo clientes', 500);
    } finally {
        if (conn) { try { await conn.close(); } catch (e) { logger.warn(`Connection close failed: ${e.message}`); } }
    }
});

// =============================================================================
// RUTERO CONFIGURATION (GET/POST)
// =============================================================================
router.post('/rutero/config', requirePlannerVendorScope({ location: 'body', field: 'vendedor', mutation: true, requireValue: false }), async (req, res) => {
    try {
        const { vendedor, dia, orden } = req.body;

        if (!vendedor || !dia || !orden || !Array.isArray(orden)) {
            return res.status(400).json({ error: 'Datos inválidos. Se requiere vendedor, dia y array de orden.' });
        }

        // Guard: vendedor must be a single code, not a comma-separated list
        if (vendedor.includes(',')) {
            return res.status(400).json({ error: 'Vendedor debe ser un código único, no una lista.' });
        }

        // SECURITY: Verify user authorization
        // User must be either a JEFE_VENTAS (can modify any rutero) or the owner of this rutero
        const userCode = req.user?.codigovendedor || req.user?.code;
        const isJefeVentas = getPlannerUserContext(req).privileged;
        
        if (!userCode) {
            return res.status(401).json({ error: 'Autenticación requerida', code: 'MISSING_TOKEN' });
        }
        
        if (!isJefeVentas && userCode !== vendedor) {
            logger.warn(`[AUTH] User ${userCode} attempted to modify rutero for vendor ${vendedor} without permission`);
            return res.status(403).json({ error: 'No tienes permisos para modificar el rutero de otro vendedor', code: 'INSUFFICIENT_ROLE' });
        }

        const pool = getPool();
        if (!pool) throw new Error("Database pool not initialized");

        // 🎯 FIX: Clear Redis cache for the day endpoint before doing DB transactions
        try {
            await deleteCachePattern(`rutero:config:v2:${vendedor}:*`);
            await deleteCachePattern(`query:rutero:details:v3:*`);
            await deleteCachePattern(`query:rutero:sales:*`);
            await deleteCachePattern(`query:rutero:gps:*`);
        } catch (e) {
            logger.warn(`Failed to invalidate cache patterns: ${e.message}`);
        }

        // Helper to run SQL with detailed error logging.
        // Gets a FRESH connection each time to avoid DB2 dirty-connection issues.
        async function execSql(label, sql, params) {
            let c;
            try {
                c = await pool.connect();
                const result = params ? await c.query(sql, params) : await c.query(sql);
                return result;
            } catch (err) {
                const odbcDetail = (err.odbcErrors || []).map(e => `[${e.code}/${e.state}] ${e.message}`).join('; ');
                logger.error(`❌ SQL FAILED (${label}): ${odbcDetail || err.message}`);
                logger.error(`   SQL was: ${sql.substring(0, 500)}`);
                throw err;
            } finally {
                if (c) try { await c.close(); } catch (_) {}
            }
        }

        let previousPositions = {};
        try {
            const prevRows = await execSql('fetch-previous',
                `SELECT CLIENTE, ORDEN FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = ? AND DIA = ?`,
                [vendedor, dia]
            );
            prevRows.forEach(row => {
                previousPositions[row.CLIENTE?.trim()] = row.ORDEN;
            });
        } catch (e) {
            logger.warn(`Could not fetch previous positions: ${e.message}`);
        }

        // Delete ALL POSITIVE overrides for this day, so the new `orden` array becomes the absolute truth
        // BUT we MUST preserve blocking entries (ORDEN = -1)!
        await execSql('delete-positive',
            `DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = ? AND DIA = ? AND ORDEN >= 0`,
            [vendedor, dia]
        );

        if (orden.length > 0) {
            const updatingClients = orden.filter(o => o.cliente).map(o => o.cliente.trim());
            if (updatingClients.length > 0) {
                const placeholders = updatingClients.map(() => '?').join(',');
                await execSql('delete-blocks-for-updating',
                    `DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = ? AND DIA = ? AND TRIM(CLIENTE) IN (${placeholders})`,
                    [vendedor, dia, ...updatingClients]
                );
            }

            const incomingClients = new Set();

            for (const item of orden) {
                if (!item.cliente) continue;
                incomingClients.add(item.cliente.trim());

                const posNueva = parseInt(item.posicion) || 0;
                let posAnterior = item.posicionOriginal !== undefined ? parseInt(item.posicionOriginal) : posNueva;
                const hadPreviousOverride = previousPositions[item.cliente.trim()] !== undefined;

                const hayCambio = posAnterior !== posNueva;

                if (hayCambio || hadPreviousOverride) {
                    await execSql(`insert-client-${item.cliente}`,
                        `INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES (?, ?, ?, ?)`,
                        [vendedor, dia, item.cliente, posNueva]
                    );
                }
            }

            // SMART MERGE PART 2: THE "GHOST" CLIENTS
            // Only block clients that previously had a POSITIVE override (were explicitly managed).
            const clientsInConfig = Object.keys(previousPositions);

            for (const clientCode of clientsInConfig) {
                if (!incomingClients.has(clientCode)) {
                    const previousOrder = previousPositions[clientCode];
                    if (previousOrder >= 0) {
                        logger.info(`🚫 Smart Merge blocking previously-managed client ${clientCode} on day ${dia} (removed from reorder)`);
                        await execSql(`block-ghost-${clientCode}`,
                            `INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES (?, ?, ?, -1)`,
                            [vendedor, dia, clientCode]
                        );
                    } else if (previousOrder === -1) {
                        // Block already exists in DB (step 1 only deletes ORDEN >= 0)
                        // No action needed — the existing -1 row is preserved automatically
                        logger.debug(`🔒 Smart Merge: existing block for ${clientCode} on ${dia} already preserved (not deleted)`);
                    }
                }
            }
        }

        // Invalidate cache for this vendor's config to ensure immediate updates
        try {
            const cachePattern = `rutero:config:v2:${vendedor}:*`;
            await deleteCachePattern(cachePattern);
            await deleteCachePattern(`query:rutero:details:v3:*`);
            await deleteCachePattern(`query:rutero:sales:*`);
            await deleteCachePattern(`query:rutero:gps:*`);
            logger.info(`♻️ Cache invalidated for pattern: ${cachePattern} and query caches`);
        } catch (cacheErr) {
            logger.warn(`Cache invalidation failed: ${cacheErr.message}`);
        }

        try {
            // Determine who modified (if req.user exists from auth middleware)
            const modifier = req.user ? (req.user.code || req.user.codigovendedor || 'UNK') : 'SYSTEM';
            const logDetail = modifier !== vendedor
                ? `Reordenado por ${modifier} (Jefe/Admin) para ${vendedor}`
                : `Reordenado por propietario`;

            for (const item of orden) {
                if (item.cliente) {
                    try {
                        await execSql(`log-${item.cliente}`,
                            `INSERT INTO JAVIER.RUTERO_LOG (VENDEDOR, TIPO_CAMBIO, DIA_ORIGEN, DIA_DESTINO, CLIENTE, NOMBRE_CLIENTE, POSICION_ANTERIOR, POSICION_NUEVA, DETALLES) VALUES (?, 'REORDENAMIENTO', ?, ?, ?, '', NULL, ?, ?)`,
                            [vendedor, dia, dia, item.cliente, parseInt(item.posicion) || 0, `${logDetail} a posicion ${item.posicion}`]
                        );
                    } catch (_) { /* non-blocking */ }
                }
            }
        } catch (logErr) {
            logger.warn(`Log insert failed (non-blocking): ${logErr.message}`);
        }

        await reloadRuteroConfig();
        logger.info(`✅ Planner config updated for vendor ${vendedor} (by ${req.user ? req.user.codigovendedor : 'unknown'})`);

        try {
            let clientNamesMap = {};
            if (orden.length > 0) {
                // SECURITY: Use parameterized query to prevent SQL injection
                const clientCodesList = orden.map(o => o.cliente);
                const placeholders = clientCodesList.map(() => '?').join(',');
                const sql = `SELECT CODIGOCLIENTE as C, COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), TRIM(NOMBRECLIENTE)) as N FROM DSEDAC.CLI WHERE CODIGOCLIENTE IN (${placeholders}) FETCH FIRST 1000 ROWS ONLY`;
                const names = await queryWithParams(sql, clientCodesList);
                names.forEach(n => clientNamesMap[n.C.trim()] = n.N.trim());
            }

            const clientesConCambio = orden.map(o => {
                const clienteId = o.cliente?.trim();
                const posNueva = parseInt(o.posicion) || 0;
                let posAnterior = o.posicionOriginal !== undefined ? parseInt(o.posicionOriginal) : previousPositions[clienteId];
                if (posAnterior === undefined) posAnterior = posNueva;

                const hayCambio = posAnterior !== posNueva;

                return {
                    codigo: o.cliente,
                    nombre: clientNamesMap[o.cliente] || 'Desconocido',
                    posicion: posNueva,
                    posicionAnterior: posAnterior,
                    hayCambio: hayCambio
                };
            });

            const clientesCambiados = clientesConCambio.filter(c => c.hayCambio);

            logger.info(`📊 Reorder: ${clientesCambiados.length} de ${orden.length} clientes cambiaron de posición`);

            const auditDetails = {
                action: 'Actualización de Rutero',
                diaObjetivo: dia,
                totalClientes: orden.length,
                cambiosDetectados: clientesCambiados.length,
                clientesAfectados: clientesConCambio
            };

            sendAuditEmailNow(vendedor, `Modificación Rutero (${dia})`, auditDetails);
        } catch (emailErr) {
            logger.warn(`Email audit skipped: ${emailErr.message}`);
        }

        res.json({ success: true, message: 'Orden actualizado y notificado' });

    } catch (error) {
        const odbcDetail = (error.odbcErrors || []).map(e => `[${e.code}/${e.state}] ${e.message}`).join('; ');
        logger.error(`Rutero config save error: ${odbcDetail || error.message}`);
        handleRouteError(error, res, 'Error guardando orden', 500);
    }
});

router.get('/rutero/config', requirePlannerVendorScope({ location: 'query', field: 'vendedor' }), async (req, res) => {
    try {
        const { vendedor, dia } = req.query;
        if (!vendedor || !dia) return res.status(400).json({ error: 'Vendedor y dia requeridos' });

        const rows = await queryWithParams(`
      SELECT CLIENTE, ORDEN
      FROM JAVIER.RUTERO_CONFIG
      WHERE VENDEDOR = ? AND DIA = ? AND ORDEN >= 0
      ORDER BY ORDEN ASC
    `, [vendedor, dia]);

        res.json({ config: rows });
    } catch (error) {
        logger.error(`Rutero config fetch error: ${error.message}`);
        res.status(500).json({ error: 'Error recuperando orden' });
    }
});

// =============================================================================
// RUTERO DAY COUNTS
// =============================================================================
router.get('/rutero/counts', requirePlannerVendorScope({ location: 'query', field: 'vendedorCodes' }), async (req, res) => {
    try {
        const { vendedorCodes, role, ignoreOverrides } = req.query;
        const shouldIgnore = ignoreOverrides === 'true' || ignoreOverrides === '1' || ignoreOverrides === true;

        const counts = getWeekCountsFromCache(vendedorCodes, role || 'comercial', shouldIgnore);

        if (!counts) {
            return res.json({
                counts: { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 },
                cacheStatus: 'loading'
            });
        }

        const totalClients = getTotalClientsFromCache(vendedorCodes, role || 'comercial');

        res.json({
            counts,
            totalUniqueClients: totalClients,
            cacheStatus: 'ready'
        });
    } catch (error) {
        logger.error(`Rutero counts error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo contadores' });
    }
});

// =============================================================================
// RUTERO AVAILABLE POSITIONS
// =============================================================================
router.get('/rutero/positions/:day', requirePlannerVendorScope({ location: 'query', field: 'vendedorCodes' }), async (req, res) => {
    try {
        const { day } = req.params;
        const { vendedorCodes, role } = req.query;

        const dayClients = getClientsForDayService(vendedorCodes, day, role || 'comercial');

        if (!dayClients) {
            return res.json({ positions: [], count: 0, cacheStatus: 'loading' });
        }

        res.json({
            positions: dayClients.length > 0
                ? Array.from({ length: dayClients.length + 1 }, (_, i) => ({
                    value: i,
                    label: i === 0 ? 'Al inicio' : (i === dayClients.length ? 'Al final' : `Posición ${i}`)
                }))
                : [{ value: 0, label: 'Primera posición' }],
            count: dayClients.length,
            cacheStatus: 'ready'
        });
    } catch (error) {
        logger.error(`Rutero positions error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo posiciones' });
    }
});

// =============================================================================
// RUTERO FULL CACHE RELOAD (CDVI + LACLAE + RUTERO_CONFIG)
// =============================================================================
router.post('/rutero/reload-cache', async (req, res) => {
    // SECURITY: Only JEFE_VENTAS can reload cache
    const isJefeVentas = req.user?.isJefeVentas || req.user?.role === 'JEFE_VENTAS';
    if (!isJefeVentas) {
        logger.warn(`[AUTH] Non-jefe user ${req.user?.codigovendedor} attempted to reload cache`);
        return res.status(403).json({ error: 'Acceso restringido a Jefes de Ventas', code: 'INSUFFICIENT_ROLE' });
    }
    
    try {
        logger.info(`[CACHE RELOAD] Full cache reload requested by ${req.user ? req.user.codigovendedor : 'unknown'}`);
        const start = Date.now();
        await loadLaclaeCache();
        // Also invalidate Redis query caches so clients/rutero queries use fresh data
        try {
            await deleteCachePattern('clients:*');
            await deleteCachePattern('rutero:*');
            logger.info('[CACHE RELOAD] Redis query caches invalidated (clients + rutero)');
        } catch (redisErr) {
            logger.warn(`[CACHE RELOAD] Redis invalidation failed (non-blocking): ${redisErr.message}`);
        }
        const duration = Date.now() - start;
        logger.info(`[CACHE RELOAD] Complete in ${duration}ms`);
        res.json({ success: true, duration, message: 'Cache CDVI + LACLAE + RUTERO_CONFIG + Redis recargada' });
    } catch (error) {
        handleRouteError(error, res, 'Error recargando caché', 500);
    }
});

// =============================================================================
// RUTERO DAY - DIRECT DB QUERY (NO CACHE) - For refresh button
// NOTE: This endpoint intentionally reloads cache to ensure fresh data.
// For normal requests, use /rutero/day/:day which uses cached data.
// =============================================================================
router.get('/rutero/day-direct/:day', requirePlannerVendorScope({ location: 'query', field: 'vendedorCodes' }), async (req, res) => {
    try {
        const { day } = req.params;
        const { vendedorCodes, year, role, month, week, ignoreOverrides } = req.query;

        // SECURITY: Validate day parameter
        const normalizedDay = day ? day.toLowerCase() : '';
        if (!DAY_NAMES.includes(normalizedDay)) {
            return res.status(400).json({ error: 'Día inválido', day });
        }

        // Require vendedorCodes (otherwise config query below fails with null param)
        if (!vendedorCodes || !vendedorCodes.trim()) {
            return res.status(400).json({ error: 'vendedorCodes es obligatorio' });
        }

        // SECURITY: Validate vendedorCodes is not injection attempt
        if (!/^[a-zA-Z0-9,_\s]+$/.test(vendedorCodes)) {
            return res.status(400).json({ error: 'Código de vendedor inválido' });
        }

        logger.info(`[RUTERO DAY DIRECT] Query without cache for ${vendedorCodes} on ${normalizedDay}`);

        // laclaeCacheLastLoadTime is exported as a getter function from services/laclae.js
        const lastLoadTime = typeof laclaeCacheLastLoadTime === 'function'
            ? laclaeCacheLastLoadTime()
            : laclaeCacheLastLoadTime;
        const shouldReload = !lastLoadTime || (Date.now() - lastLoadTime > 5 * 60 * 1000);

        if (shouldReload) {
            logger.info('[RUTERO DAY DIRECT] Cache stale, reloading...');
            try {
                await loadLaclaeCache();
                await reloadRuteroConfig();
            } catch (cacheErr) {
                logger.warn(`[RUTERO DAY DIRECT] Cache reload failed (continuing): ${cacheErr.message}`);
            }
        }

        // Now use the fresh cache
        const shouldIgnoreOverrides = ignoreOverrides === 'true' || ignoreOverrides === '1' || ignoreOverrides === true;
        let dayClientCodes = getClientsForDayService(vendedorCodes, day, role || 'comercial', shouldIgnoreOverrides);

        if (!dayClientCodes || dayClientCodes.length === 0) {
            return res.json({ clients: [], count: 0, day, cacheStatus: 'fresh' });
        }

        const batchSize = 200;
        const clientBatch = dayClientCodes.slice(0, batchSize);

        // SECURITY: Use parameterized query to prevent SQL injection
        const placeholders = clientBatch.map(() => '?').join(',');
        const clientDetailsSql = `
            SELECT
                CODIGOCLIENTE as CODE,
                COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), NOMBRECLIENTE) as NAME,
                DIRECCION as ADDRESS,
                POBLACION as CITY,
                TELEFONO1 as PHONE,
                TELEFONO2 as PHONE2
            FROM DSEDAC.CLI
            WHERE CODIGOCLIENTE IN (${placeholders})
              AND (ANOBAJA = 0 OR ANOBAJA IS NULL)
        `;
        const clientDetails = await queryWithParams(clientDetailsSql, clientBatch, false, false);

        // Get RUTERO_CONFIG order for sorting
        // For multi-vendor (comma-separated), only query first vendor's order (most common use case)
        const firstVendor = vendedorCodes.split(',')[0].trim();
        const configSql = `
            SELECT TRIM(CLIENTE) as CLIENTE, ORDEN
            FROM JAVIER.RUTERO_CONFIG
            WHERE VENDEDOR = ? AND DIA = ? AND ORDEN >= 0
        `;
        const configRows = await queryWithParams(configSql, [firstVendor, normalizedDay], false, false);
        
        const configOrder = {};
        configRows.forEach(r => { configOrder[r.CLIENTE?.trim()] = r.ORDEN; });

        // Build client list with order
        const clients = clientDetails.map(c => ({
            code: c.CODE?.trim(),
            name: c.NAME?.trim(),
            address: c.ADDRESS?.trim(),
            city: c.CITY?.trim(),
            phone: c.PHONE?.trim(),
            phone2: c.PHONE2?.trim(),
            ruteroOrder: configOrder[c.CODE?.trim()] ?? 99999
        }));

        // Sort by rutero order
        if (!shouldIgnoreOverrides) {
            clients.sort((a, b) => a.ruteroOrder - b.ruteroOrder);
        }

        logger.info(`[RUTERO DAY DIRECT] Returning ${clients.length} clients (fresh from DB)`);
        
        res.json({
            clients,
            count: clients.length,
            day,
            cacheStatus: 'fresh'
        });

    } catch (error) {
        logger.error(`[RUTERO DAY DIRECT] Error: ${error.message}\n${error.stack?.substring(0, 400)}`);
        handleRouteError(error, res, 'Error obteniendo rutero', 500);
    }
});

// =============================================================================
// RUTERO FULL CACHE RELOAD (CDVI + LACLAE + RUTERO_CONFIG)
// =============================================================================
router.post('/rutero/reload-cache-old', async (req, res) => {
    // SECURITY: Only JEFE_VENTAS can reload cache
    const isJefeVentas = req.user?.isJefeVentas || req.user?.role === 'JEFE_VENTAS';
    if (!isJefeVentas) {
        logger.warn(`[AUTH] Non-jefe user ${req.user?.codigovendedor} attempted to reload cache (old endpoint)`);
        return res.status(403).json({ error: 'Acceso restringido a Jefes de Ventas', code: 'INSUFFICIENT_ROLE' });
    }
    
    try {
        logger.info(`[CACHE RELOAD] Full cache reload requested by ${req.user ? req.user.codigovendedor : 'unknown'}`);
        const start = Date.now();
        await loadLaclaeCache();
        // Also invalidate Redis query caches so clients/rutero queries use fresh data
        try {
            await deleteCachePattern('clients:*');
            await deleteCachePattern('rutero:*');
            logger.info('[CACHE RELOAD] Redis query caches invalidated (clients + rutero)');
        } catch (redisErr) {
            logger.warn(`[CACHE RELOAD] Redis invalidation failed (non-blocking): ${redisErr.message}`);
        }
        const duration = Date.now() - start;
        logger.info(`[CACHE RELOAD] Complete in ${duration}ms`);
        res.json({ success: true, duration, message: 'Cache CDVI + LACLAE + RUTERO_CONFIG + Redis recargada' });
    } catch (error) {
        handleRouteError(error, res, 'Error recargando caché', 500);
    }
});

// =============================================================================
// RUTERO DAY (OPTIMIZED WITH CACHING) - Hotfix Update Check
// =============================================================================
router.get('/rutero/day/:day', requirePlannerVendorScope({ location: 'query', field: 'vendedorCodes' }), async (req, res) => {
    try {
        const { day } = req.params;
        const { vendedorCodes, year, role, month, week, ignoreOverrides, date } = req.query; // Added ignoreOverrides
        
        // SECURITY: Validate day parameter
        const normalizedDay = day ? day.toLowerCase() : '';
        if (!DAY_NAMES.includes(normalizedDay)) {
            return res.status(400).json({ error: 'Día inválido', day });
        }
        
        const shouldIgnoreOverrides = ignoreOverrides === 'true' || ignoreOverrides === '1' || ignoreOverrides === true;

        if (shouldIgnoreOverrides) {
            logger.info(`[RUTERO DAY] Ignoring overrides for ${vendedorCodes} on ${day}`);
        }

        const now = getCurrentDate();
        const currentYear = parseInt(year) || now.getFullYear();
        const previousYear = currentYear - 1;
        const orderDate = resolveRuteroOrderDate({
            date,
            year,
            month,
            week,
            normalizedDay,
            now
        });

        // Determine the reference date (The "End Date" for calculation)
        // IMPORTANT: We want to compare COMPLETED weeks only.
        // referenceDate is ALWAYS the last completed Sunday (before today or selected week)
        // completedWeeks is ALWAYS the total number of weeks from Jan 1 to referenceDate
        let referenceDate;
        let completedWeeks = 0;

        // Helper: Find the last Sunday before or on a given date
        const getLastSunday = (date) => {
            const d = new Date(date);
            const dayOfWeek = d.getDay(); // 0=Sunday, 1=Monday, ...
            // If today is Sunday (0), go back 7 days to previous Sunday (we don't count current week)
            // Otherwise, go back to last Sunday
            const daysBack = dayOfWeek === 0 ? 7 : dayOfWeek;
            d.setDate(d.getDate() - daysBack);
            return d;
        };

        if (month && week) {
            const m = parseInt(month);
            const w = parseInt(week);

            // Calculate the reference point: end of the week BEFORE the selected week
            // First, find the first day of the selected month
            const firstDayOfMonth = new Date(currentYear, m - 1, 1);
            const firstWeekdayOfMonth = firstDayOfMonth.getDay(); // 0=Sunday, 1=Monday, ...

            // Find the first Sunday of the month (end of week 1)
            // If day 1 is Sunday (0), then the first Sunday IS day 1
            // If day 1 is Monday (1), the first Sunday is day 7
            // If day 1 is Saturday (6), the first Sunday is day 2
            let daysUntilFirstSunday = (7 - firstWeekdayOfMonth) % 7;
            // NOTE: If firstWeekdayOfMonth === 0 (Sunday), daysUntilFirstSunday = 0, meaning day 1 IS a Sunday

            // The Sunday that ends week 1 of the month
            const firstSundayOfMonth = new Date(currentYear, m - 1, 1 + daysUntilFirstSunday);

            // The Sunday that ends week W of the month
            const sundayOfWeekW = new Date(firstSundayOfMonth);
            sundayOfWeekW.setDate(firstSundayOfMonth.getDate() + (w - 1) * 7);

            // For COMPLETED weeks comparison:
            // If we are in week W, we compare data up to the Sunday that ends week (W-1)
            // For week 1: there is no completed week in this month yet, use the Sunday BEFORE month start
            // For week 2: use the Sunday that ends week 1 (firstSundayOfMonth)
            // For week N: use the Sunday that ends week (N-1)

            if (w <= 1) {
                // Week 1: no completed weeks in this month yet
                // Use the Sunday before the first day of the month
                referenceDate = getLastSunday(firstDayOfMonth);
            } else {
                // Week N (N >= 2): use the Sunday that ends week (N-1)
                referenceDate = new Date(firstSundayOfMonth);
                referenceDate.setDate(firstSundayOfMonth.getDate() + (w - 2) * 7);
            }

            // Ensure referenceDate doesn't go before Jan 1 of current year
            const startOfYear = new Date(currentYear, 0, 1);
            if (referenceDate < startOfYear) {
                referenceDate = new Date(startOfYear);
                completedWeeks = 0;
            } else {
                // Calculate completed weeks from Jan 1 to referenceDate
                const msPerDay = 86400000;
                const daysSinceStart = Math.floor((referenceDate - startOfYear) / msPerDay);
                completedWeeks = Math.floor(daysSinceStart / 7) + 1;
            }
        } else {
            // Default: use last completed Sunday before today
            const today = new Date(now);
            referenceDate = getLastSunday(today);

            // Calculate completed weeks from start of year
            const startOfYear = new Date(currentYear, 0, 1);
            if (referenceDate < startOfYear) {
                referenceDate = new Date(startOfYear);
                completedWeeks = 0;
            } else {
                const msPerDay = 86400000;
                const daysSinceStart = Math.floor((referenceDate - startOfYear) / msPerDay);
                completedWeeks = Math.floor(daysSinceStart / 7) + 1;
            }
        }

        let endMonthCurrent = referenceDate.getMonth() + 1;
        let endDayCurrent = referenceDate.getDate();
        let endMonthPrevious, endDayPrevious;

        // Calculate Previous Year Cutoff (Same Week Number logic)
        // Calculate the week number of referenceDate in currentYear
        const startOfCurrentYear = new Date(currentYear, 0, 1);
        const daysSinceStart = Math.floor((referenceDate - startOfCurrentYear) / 86400000);
        const weekNumber = Math.floor(daysSinceStart / 7) + 1;

        // Find the equivalent Sunday (same week number) in previous year
        const startOfPreviousYear = new Date(previousYear, 0, 1);
        const firstSundayOffsetPrev = (7 - startOfPreviousYear.getDay()) % 7;
        const equivalentSundayPrev = new Date(previousYear, 0, 1 + firstSundayOffsetPrev + (weekNumber - 1) * 7);

        endMonthPrevious = equivalentSundayPrev.getMonth() + 1;
        endDayPrevious = equivalentSundayPrev.getDate();

        if (DAY_NAMES.indexOf(day.toLowerCase()) === -1) {
            return res.status(400).json({ error: 'Día inválido', day });
        }

        // 1. Get client codes for the selected day from CACHE (Fast)
        // Pass ignoreOverrides flag
        let dayClientCodes = getClientsForDayService(vendedorCodes, day, role || 'comercial', shouldIgnoreOverrides);

        if (!dayClientCodes) {
            logger.warn(`[RUTERO DAY] Cache not ready`);
            return res.json({ clients: [], count: 0, day, cacheStatus: 'loading' });
        }

        if (dayClientCodes.length === 0) {
            return res.json({
                clients: [], count: 0, day, year: currentYear, compareYear: previousYear
            });
        }

// Limit clients for safety
        const batchSize = 200;
        const clientBatch = dayClientCodes.slice(0, batchSize);

        // SECURITY: Use parameterized query to prevent SQL injection
        const clientPlaceholders = clientBatch.map(() => '?').join(',');
        const clientsHash = crypto.createHash('md5').update(clientBatch.join(',')).digest('hex');
        const cacheTTL = TTL.MEDIUM; // 5 minutes

        // --- 2. Heavy Queries with Caching ---
        // Parallelize all heavy queries for maximum performance
        const detailsSql = `
            SELECT 
                CODIGOCLIENTE as CODE,
                COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), NOMBRECLIENTE) as NAME,
                DIRECCION as ADDRESS,
                POBLACION as CITY,
                TELEFONO1 as PHONE,
                TELEFONO2 as PHONE2
            FROM DSEDAC.CLI
            WHERE CODIGOCLIENTE IN (${clientPlaceholders})
              AND (ANOBAJA = 0 OR ANOBAJA IS NULL)
        `;
        const currentSalesSql = `
            SELECT 
                L.LCCDCL as CODE,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST
            FROM DSED.LACLAE L
            WHERE L.LCCDCL IN (${clientPlaceholders})
              AND L.LCAADC = ?
              AND ${LACLAE_SALES_FILTER}
              AND (L.LCMMDC < ? OR (L.LCMMDC = ? AND L.LCDDDC <= ?))
            GROUP BY L.LCCDCL
        `;
        const prevSalesSql = endMonthPrevious > 0 ? `
            SELECT 
                L.LCCDCL as CODE,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST
            FROM DSED.LACLAE L
            WHERE L.LCCDCL IN (${clientPlaceholders})
              AND L.LCAADC = ?
              AND ${LACLAE_SALES_FILTER}
              AND (L.LCMMDC < ? OR (L.LCMMDC = ? AND L.LCDDDC <= ?))
            GROUP BY L.LCCDCL
        ` : null;
        const prevYearTotalSql = `
            SELECT 
                L.LCCDCL as CODE,
                SUM(L.LCIMVT) as SALES
            FROM DSED.LACLAE L
            WHERE L.LCCDCL IN (${clientPlaceholders})
              AND L.LCAADC = ?
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCCDCL
        `;
        const gpsSql = `
            SELECT CODIGO, LATITUD, LONGITUD
            FROM DSEMOVIL.CLIENTES
            WHERE CODIGO IN (${clientPlaceholders})
              AND LATITUD IS NOT NULL AND LATITUD <> 0
        `;
        const notesSql = `
            SELECT CLIENT_CODE, OBSERVACIONES, MODIFIED_BY
            FROM JAVIER.CLIENT_NOTES
            WHERE CLIENT_CODE IN (${clientPlaceholders})
        `;

        // Execute all queries in parallel
        const [
            clientDetailsRows,
            currentSalesRows,
            prevYearRowsResult,
            prevYearTotalRows,
            gpsResult,
            notesResult,
            orderStatusResult
        ] = await Promise.all([
            cachedQuery(queryWithParams, detailsSql, `rutero:details:v3:${clientsHash}`, TTL.LONG, clientBatch),
            cachedQuery(queryWithParams, currentSalesSql, `rutero:sales:v2:${currentYear}:${endMonthCurrent}:${endDayCurrent}:${clientsHash}`, cacheTTL, [...clientBatch, currentYear, endMonthCurrent, endMonthCurrent, endDayCurrent]),
            prevSalesSql ? cachedQuery(queryWithParams, prevSalesSql, `rutero:sales:v2:${previousYear}:${endMonthPrevious}:${endDayPrevious}:${clientsHash}`, cacheTTL, [...clientBatch, previousYear, endMonthPrevious, endMonthPrevious, endDayPrevious]) : Promise.resolve([]),
            cachedQuery(queryWithParams, prevYearTotalSql, `rutero:sales:total:${previousYear}:${clientsHash}`, TTL.LONG, [...clientBatch, previousYear]),
            cachedQuery(queryWithParams, gpsSql, `rutero:gps:v3:${clientsHash}`, TTL.LONG, clientBatch).catch(e => { logger.warn(`GPS query failed: ${e.message}`); return []; }),
            cachedQuery(queryWithParams, notesSql, `rutero:notes:v1:${clientsHash}`, TTL.SHORT, clientBatch).catch(e => { logger.warn(`Notes query failed: ${e.message}`); return []; }),
            getRuteroOrderStatusMap(clientBatch, { vendedorCodes, orderDate })
        ]);
        const orderStatusMap = orderStatusResult?.statusMap instanceof Map
            ? orderStatusResult.statusMap
            : new Map();
        const orderStatusDegraded = orderStatusResult?.degraded === true;

        // Build maps from results - use safe accessor to handle both uppercase/lowercase columns
        const prevYearRows = prevYearRowsResult || [];
        const currentSalesMap = new Map();
        (currentSalesRows || []).forEach(r => {
            const code = (r.CODE ?? r.code ?? '').toString().trim();
            if (code) {
                currentSalesMap.set(code, {
                    sales: parseFloat(r.SALES ?? r.sales) || 0,
                    cost: parseFloat(r.COST ?? r.cost) || 0
                });
            }
        });
        const prevYearMap = new Map();
        prevYearRows.forEach(r => {
            const code = (r.CODE ?? r.code ?? '').toString().trim();
            if (code) {
                prevYearMap.set(code, {
                    sales: parseFloat(r.SALES ?? r.sales) || 0,
                    cost: parseFloat(r.COST ?? r.cost) || 0
                });
            }
        });
        const prevYearTotalMap = new Map();
        prevYearTotalRows.forEach(r => {
            const code = (r.CODE ?? r.code ?? '').toString().trim();
            if (code) {
                prevYearTotalMap.set(code, parseFloat(r.SALES ?? r.sales) || 0);
            }
        });
        const gpsMap = new Map();
        (gpsResult || []).forEach(g => {
            const gpsCode = (g.CODIGO ?? g.codigo ?? '').toString().trim();
            if (gpsCode) {
                gpsMap.set(gpsCode, {
                    lat: parseFloat(g.LATITUD ?? g.latitud) || null,
                    lon: parseFloat(g.LONGITUD ?? g.longitud) || null
                });
            }
        });
        const notesMap = new Map();
        (notesResult || []).forEach(n => {
            const noteCode = (n.CLIENT_CODE ?? n.client_code ?? '').toString().trim();
            if (noteCode) {
                notesMap.set(noteCode, {
                    text: n.OBSERVACIONES ?? n.observaciones,
                    modifiedBy: n.MODIFIED_BY ?? n.modified_by
                });
            }
        });

        // Merge Data
        const currentYearRows = clientDetailsRows.map(r => {
            const code = (r.CODE ?? r.code ?? '').toString().trim();
            const salesData = currentSalesMap.get(code) || { sales: 0, cost: 0 };
            return {
                ...r,
                SALES: salesData.sales,
                COST: salesData.cost
            };
        });

        // Retrieve custom order from cache if possible, or query
        const primaryVendor = vendedorCodes ? vendedorCodes.split(',')[0].trim() : '';
        let orderMap = new Map();

        // Only load custom order if NOT ignoring overrides
        if (primaryVendor && !shouldIgnoreOverrides) {
            // SECURITY: Use parameterized query to prevent SQL injection
            const configRows = await queryWithParams(`
                SELECT CLIENTE, ORDEN 
                FROM JAVIER.RUTERO_CONFIG 
                WHERE VENDEDOR = ? AND DIA = ?
            `, [primaryVendor, normalizedDay], false, false); // false = no debug log clutter

            configRows.forEach(r => {
                const clienteCode = (r.CLIENTE ?? r.cliente ?? '').toString().trim();
                const orden = parseInt(r.ORDEN ?? r.orden) || 0;
                if (clienteCode && orden >= 0) {
                    orderMap.set(clienteCode, orden);
                }
            });
            logger.info(`[RUTERO SORT] Loaded ${configRows.length} overrides for ${primaryVendor}/${normalizedDay}`);
        }

        const clients = currentYearRows.map(r => {
            const code = (r.CODE ?? r.code ?? '').toString().trim();
            const prevSales = prevYearMap.get(code) || { sales: 0, cost: 0 };
            const prevYearTotalSales = prevYearTotalMap.get(code) || 0; // Total sales in entire previous year
            const gps = gpsMap.get(code) || { lat: null, lon: null };
            const note = notesMap.get(code);
            const orderStatus = orderStatusMap.get(code) || emptyRuteroOrderStatus(orderDate);

            const salesCurrent = r.SALES || 0;
            const salesPrev = prevSales.sales || 0; // Sales in equivalent period of prev year

            // Calculate Growth (comparing equivalent periods)
            let growth = 0;
            if (salesPrev > 0) {
                growth = ((salesCurrent - salesPrev) / salesPrev) * 100;
                // Cap growth at ±999% to prevent unrealistic values
                growth = Math.max(-999, Math.min(999, growth));
            } else if (salesCurrent > 0) {
                growth = 100; // New client indicator
            }

            const phones = [];
            if (r.PHONE?.trim()) phones.push({ type: 'Teléfono', number: r.PHONE.trim() });
            if (r.PHONE2?.trim()) phones.push({ type: 'Móvil', number: r.PHONE2.trim() });

            // Determine Order
            let clientOrder = 9999;
            if (shouldIgnoreOverrides) {
                // "Original" Mode: Use Natural Order from CDVI
                // If 0 (no natural order), remains 9999 (will be sorted by Code below)
                const natOrder = getNaturalOrder(primaryVendor, code, day);
                if (natOrder > 0) clientOrder = natOrder;
            } else {
                // "Custom" Mode: Use Config Order
                if (orderMap.has(code)) {
                    clientOrder = orderMap.get(code);
                } else {
                    // FALLBACK: Preserve AS400 Natural Route behavior for unconfigured clients!
                    // Shifted by 20000 to place them strictly below custom-sorted ones, 
                    // while retaining their exact relative AS400 order.
                    const natOrder = getNaturalOrder(primaryVendor, code, day);
                    clientOrder = natOrder > 0 ? (20000 + natOrder) : 99999;
                }
            }

            return {
                code,
                name: (r.NAME ?? r.name)?.trim() || null,
                address: (r.ADDRESS ?? r.address)?.trim() || null,
                city: (r.CITY ?? r.city)?.trim() || null,
                phone: (r.PHONE ?? r.phone)?.trim() || null,
                phone2: (r.PHONE2 ?? r.phone2)?.trim() || null,
                phones,
                // Frontend expects 'status' object with raw numbers
                status: {
                    ytdSales: salesCurrent,
                    ytdPrevYear: salesPrev, // Sales in equivalent period
                    prevYearTotal: prevYearTotalSales, // Total sales in entire previous year (for NEW detection)
                    yoyVariation: parseFloat(growth.toFixed(1)),
                    isPositive: growth >= 0
                },
                lat: gps.lat,
                lon: gps.lon,
                orderStatus,
                observation: note ? note.text : null,
                observationBy: note ? note.modifiedBy : null,
                order: clientOrder
            };
        });

        // SORTING STRATEGY
        clients.sort((a, b) => {
            // 1. Primary Sort: Order (Natural or Custom)
            if (a.order !== b.order) {
                return a.order - b.order;
            }

            // 2. Secondary Sort (Tie-breaker for 9999s)
            // Fix: Use strictly Name to avoid visual jumping compared to Route Config UI
            return (a.name || '').localeCompare(b.name || '');
        });

        res.json({
            clients,
            count: clients.length,
            day,
            year: currentYear,
            compareYear: previousYear,
            orderDate: orderDate.iso,
            orderStatusDegraded,
            period: {
                weeks: completedWeeks, // Number of completed weeks being compared
                current: completedWeeks > 0 ? `1 Ene - ${endDayCurrent} ${['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][endMonthCurrent - 1]}` : 'Sin semanas completadas',
                previous: completedWeeks > 0 && endMonthPrevious > 0 ? `1 Ene - ${endDayPrevious} ${['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][endMonthPrevious - 1]}` : 'Sin comparación'
            }
        });

    } catch (error) {
        return handleRouteError(error, res, 'Error obteniendo rutero diario', 500);
    }
});

// =============================================================================
// DIAGNOSTIC: Client-Vendor Assignment
// =============================================================================
router.get('/diagnose/client/:code', requirePlannerPrivilege, async (req, res) => {
    try {
        const clientCode = req.params.code.trim();
        logger.info(`[DIAGNOSE] Investigating client: ${clientCode}`);

        const results = {
            clientCode,
            timestamp: new Date().toISOString(),
            clientInfo: null,
            laclaeHistory: [],
            ruteroConfig: null,
            vendorInfo: null,
            analysis: []
        };

        // 1. Get client info from DSEDAC.CLI
        try {
            const clientData = await queryWithParams(`
                SELECT 
                    TRIM(CODIGOCLIENTE) as CODE,
                    TRIM(COALESCE(NOMBREALTERNATIVO, NOMBRECLIENTE)) as NAME,
                    TRIM(CODIGOVENDEDOR) as VENDOR_CLI,
                    TRIM(CODIGOREPARTIDOR) as REPARTIDOR_CLI,
                    TRIM(POBLACION) as CITY,
                    TRIM(CODIGORUTA) as ROUTE
                FROM DSEDAC.CLI
                WHERE CODIGOCLIENTE = ?
                FETCH FIRST 1 ROWS ONLY
            `, [clientCode]);
            if (clientData.length > 0) {
                results.clientInfo = clientData[0];
                results.analysis.push(`✓ Cliente encontrado en CLI: ${clientData[0].NAME}`);
                results.analysis.push(`  Vendedor asignado en CLI: ${clientData[0].VENDOR_CLI || 'N/A'}`);
                results.analysis.push(`  Repartidor asignado en CLI: ${clientData[0].REPARTIDOR_CLI || 'N/A'}`);
            } else {
                results.analysis.push(`✗ Cliente NO encontrado en DSEDAC.CLI`);
            }
        } catch (e) {
            results.analysis.push(`✗ Error consultando CLI: ${e.message}`);
        }

        // 2. Get sales history from DSED.LACLAE to see which vendors have sold to this client
        try {
            const laclaeData = await queryWithParams(`
                SELECT DISTINCT
                    TRIM(L.R1_T8CDVD) as VENDOR_LACLAE,
                    L.LCYEAB as YEAR,
                    L.R1_T8DIVL as VIS_L, L.R1_T8DIVM as VIS_M, L.R1_T8DIVX as VIS_X,
                    L.R1_T8DIVJ as VIS_J, L.R1_T8DIVV as VIS_V, L.R1_T8DIVS as VIS_S
                FROM DSED.LACLAE L
                WHERE L.LCCDCL = ?
                ORDER BY L.LCYEAB DESC
                FETCH FIRST 10 ROWS ONLY
            `, [clientCode]);
            results.laclaeHistory = laclaeData;

            const vendors = [...new Set(laclaeData.map(r => r.VENDOR_LACLAE))];
            results.analysis.push(`✓ Vendedores en LACLAE (por ventas): ${vendors.join(', ') || 'Ninguno'}`);

            laclaeData.forEach(r => {
                const visitDays = [
                    r.VIS_L === 'S' ? 'L' : '',
                    r.VIS_M === 'S' ? 'M' : '',
                    r.VIS_X === 'S' ? 'X' : '',
                    r.VIS_J === 'S' ? 'J' : '',
                    r.VIS_V === 'S' ? 'V' : '',
                    r.VIS_S === 'S' ? 'S' : ''
                ].filter(d => d).join('');
                results.analysis.push(`  ${r.YEAR}: Vendedor ${r.VENDOR_LACLAE}, Visita: ${visitDays || 'N/A'}`);
            });
        } catch (e) {
            results.analysis.push(`✗ Error consultando LACLAE: ${e.message}`);
        }

        // 3. Check RUTERO_CONFIG for overrides
        try {
            const configData = await queryWithParams(`
                SELECT TRIM(VENDEDOR) as VENDEDOR, TRIM(DIA) as DIA, ORDEN
                FROM JAVIER.RUTERO_CONFIG
                WHERE TRIM(CLIENTE) = ?
                FETCH FIRST 10 ROWS ONLY
            `, [clientCode]);
            if (configData.length > 0) {
                results.ruteroConfig = configData;
                results.analysis.push(`⚠ OVERRIDE en RUTERO_CONFIG:`);
                configData.forEach(c => {
                    results.analysis.push(`  Vendedor: ${c.VENDEDOR}, Día: ${c.DIA}, Orden: ${c.ORDEN}`);
                });
            } else {
                results.analysis.push(`✓ Sin overrides en RUTERO_CONFIG`);
            }
        } catch (e) {
            results.analysis.push(`✓ RUTERO_CONFIG no accesible (normal si no hay tabla)`);
        }

        // 4. Get vendor info for CLI vendor
        if (results.clientInfo?.VENDOR_CLI) {
            try {
                const vendorData = await queryWithParams(`
                    SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME
                    FROM DSEDAC.VDD
                    WHERE CODIGOVENDEDOR = ?
                    FETCH FIRST 1 ROWS ONLY
                `, [results.clientInfo.VENDOR_CLI]);
                if (vendorData.length > 0) {
                    results.vendorInfo = vendorData[0];
                    results.analysis.push(`✓ Vendedor CLI: ${vendorData[0].CODE} - ${vendorData[0].NAME}`);
                }
            } catch (e) {
                results.analysis.push(`✗ Error consultando VDD: ${e.message}`);
            }
        }

        // 5. Check for "ZZ" vendor
        try {
            const zzVendors = await query(`
                SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME
                FROM DSEDAC.VDD
                WHERE CODIGOVENDEDOR LIKE 'ZZ%' OR NOMBREVENDEDOR LIKE '%CAYETANO%'
                FETCH FIRST 5 ROWS ONLY
            `);
            if (zzVendors.length > 0) {
                results.analysis.push(`\n📋 Vendedores ZZ/CAYETANO encontrados:`);
                zzVendors.forEach(v => {
                    results.analysis.push(`  ${v.CODE}: ${v.NAME}`);
                });
            }
        } catch (e) {
            // Ignore
        }

        // Summary
        results.analysis.push(`\n🔍 RESUMEN:`);
        if (results.clientInfo?.VENDOR_CLI === '20' || results.laclaeHistory.some(l => l.VENDOR_LACLAE === '20')) {
            results.analysis.push(`→ El cliente tiene el código "20" asociado (CAYETANO MONTIEL)`);
            results.analysis.push(`→ Esto puede ser el vendedor histórico o actual en la BD`);
        }
        if (results.ruteroConfig && results.ruteroConfig.length > 0) {
            results.analysis.push(`→ Hay overrides en RUTERO_CONFIG que pueden afectar la asignación`);
        }

        res.json(results);

    } catch (error) {
        handleRouteError(error, res, 'Error en diagnóstico', 500);
    }
});

// =============================================================================
// DIAGNOSTIC: Vendor Cache Dump
// =============================================================================
router.get('/diagnose/vendor/:code', requirePlannerPrivilege, (req, res) => {
    try {
        const vendorCode = req.params.code.trim();
        const { getCachedVendorCodes, getWeekCountsFromCache, getTotalClientsFromCache } = require('../services/laclae');

        const vendors = getCachedVendorCodes();
        const hasVendor = vendors.includes(vendorCode);

        // We can't access laclaeCache directly from here as it is not exported, 
        // relying on helper methods.
        const counts = getWeekCountsFromCache(vendorCode, 'comercial');
        const total = getTotalClientsFromCache(vendorCode, 'comercial');

        res.json({
            vendorCode,
            isInCache: hasVendor,
            totalClientsInCache: total,
            weekCounts: counts,
            cachedVendorsSample: vendors.slice(0, 10),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// RUTERO CLIENT DETAIL - Year comparison data for client detail page
// =============================================================================
router.get('/rutero/client/:code/detail', requirePlannerClientOwnership, async (req, res) => {
    try {
        const { code } = req.params;
        const { year } = req.query;
        const clientCode = code.trim();
        const currentYear = parseInt(year) || getCurrentDate().getFullYear();
        const previousYear = currentYear - 1;

        const formatCurrencyLocal = (v) => {
            const n = parseFloat(v) || 0;
            return Math.round(n * 100) / 100;
        };

        const formatCurrencyString = (v) => {
            const n = parseFloat(v) || 0;
            return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
        };

        // Get monthly sales for current and previous year
        const monthlySalesPromise = queryWithParams(`
            SELECT 
                L.LCYEAB as YEAR,
                L.LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST,
                SUM(L.LCIMVT - L.LCIMCT) as MARGIN
            FROM DSED.LACLAE L
            WHERE L.LCCDCL = ?
              AND L.LCYEAB IN (?, ?)
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCYEAB, L.LCMMDC
            ORDER BY L.LCYEAB DESC, L.LCMMDC ASC
        `, [clientCode, currentYear, previousYear], false, false);

        // These three read-only aggregates are independent. Start them together
        // to avoid making the historical detail latency the sum of all DB2 waits.
        const yearlyHistoryPromise = queryWithParams(`
            SELECT
                L.LCYEAB as YEAR,
                SUM(L.LCIMVT) as SALES
            FROM DSED.LACLAE L
            WHERE L.LCCDCL = ?
              AND L.LCYEAB >= ?
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCYEAB
            ORDER BY L.LCYEAB DESC
        `, [clientCode, currentYear - 5], false, false);
        const frequencyResultPromise = queryWithParams(`
            SELECT
                COUNT(DISTINCT L.LCDIDL || '-' || L.LCMIDL || '-' || L.LCAIDL) as ORDER_COUNT,
                COUNT(*) as LINE_COUNT,
                MAX(L.LCAIDL * 10000 + L.LCMIDL * 100 + L.LCDIDL) as LAST_ORDER_DATE
            FROM DSED.LACLAE L
            WHERE L.LCCDCL = ?
              AND L.LCYEAB = ?
              AND ${LACLAE_SALES_FILTER}
        `, [clientCode, currentYear], false, false);
        const monthlySales = await monthlySalesPromise;
        // Group by month and calculate comparisons
        const monthMap = {};
        for (let m = 1; m <= 12; m++) {
            monthMap[m] = {
                month: m,
                currentYear: 0,
                lastYear: 0
            };
        }

        monthlySales.forEach(row => {
            const month = row.MONTH;
            const sales = formatCurrencyLocal(row.SALES);
            if (row.YEAR === currentYear) {
                monthMap[month].currentYear = sales;
            } else if (row.YEAR === previousYear) {
                monthMap[month].lastYear = sales;
            }
        });

        // Build monthlyData array with variations
        const monthlyData = Object.values(monthMap).map(m => {
            const variation = m.lastYear > 0
                ? ((m.currentYear - m.lastYear) / m.lastYear) * 100
                : (m.currentYear > 0 ? 100 : 0);
            return {
                month: m.month,
                currentYear: m.currentYear,
                lastYear: m.lastYear,
                variation: Math.round(variation * 10) / 10,
                currentYearFormatted: formatCurrencyString(m.currentYear),
                lastYearFormatted: formatCurrencyString(m.lastYear)
            };
        });

        // Calculate yearly totals
        const totalCurrentYear = Object.values(monthMap).reduce((sum, m) => sum + m.currentYear, 0);
        const totalLastYear = Object.values(monthMap).reduce((sum, m) => sum + m.lastYear, 0);
        const totalVariation = totalLastYear > 0
            ? ((totalCurrentYear - totalLastYear) / totalLastYear) * 100
            : (totalCurrentYear > 0 ? 100 : 0);

        // Determine if client is NEW (no sales in entire previous year)
        const isNewClient = totalLastYear < 0.01 && totalCurrentYear > 0;

        // Get multi-year history

        const yearlyHistory = await yearlyHistoryPromise;
        const yearlyTotals = yearlyHistory.map(row => ({
            year: row.YEAR,
            sales: formatCurrencyLocal(row.SALES),
            salesFormatted: formatCurrencyString(row.SALES)
        }));

        // Calculate purchase frequency (orders in current year)

        const frequencyResult = await frequencyResultPromise;
        const freq = frequencyResult[0] || {};
        const orderCount = parseInt(freq.ORDER_COUNT) || 0;
        const monthsWithData = monthlyData.filter(m => m.currentYear > 0).length;
        const avgPerMonth = monthsWithData > 0 ? (orderCount / monthsWithData) : 0;

        res.json({
            totals: {
                currentYear: totalCurrentYear,
                lastYear: totalLastYear,
                variation: Math.round(totalVariation * 10) / 10,
                currentYearFormatted: formatCurrencyString(totalCurrentYear),
                lastYearFormatted: formatCurrencyString(totalLastYear),
                monthlyAverageFormatted: formatCurrencyString(totalCurrentYear / 12),
                isNewClient: isNewClient  // Cliente no existía en el año anterior
            },
            monthlyData,
            yearlyTotals,
            purchaseFrequency: {
                totalOrders: orderCount,
                avgOrdersPerMonth: Math.round(avgPerMonth * 10) / 10,
                monthsActive: monthsWithData,
                lineCount: parseInt(freq.LINE_COUNT) || 0
            }
        });

    } catch (error) {
        handleRouteError(error, res, 'Error obteniendo detalle de cliente', 500);
    }
});

module.exports = router;
