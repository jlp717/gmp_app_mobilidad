const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query, getPool } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL, deleteCachePattern } = require('../services/redis-cache');
const {
    getCurrentDate,
    buildVendedorFilter,
    formatCurrency,
    LACLAE_SALES_FILTER
} = require('../utils/common');

// Imports from laclae service
const {
    getWeekCountsFromCache,
    getTotalClientsFromCache,
    getClientsForDay: getClientsForDayService,
    reloadRuteroConfig,
    getClientCurrentDay,
    getNaturalOrder
} = require('../services/laclae');
const { sendAuditEmail, sendAuditEmailNow } = require('../services/emailService');

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// =============================================================================
// ROUTER CALENDAR
// =============================================================================
router.get('/router/calendar', async (req, res) => {
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
      WHERE L.ANODOCUMENTO = ${year} AND L.MESDOCUMENTO = ${month} 
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
        const activities = await cachedQuery(query, sql, cacheKey, TTL.MEDIUM);

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
        logger.error(`Router error: ${error.message} `);
        res.status(500).json({ error: 'Error obteniendo rutero', details: error.message });
    }
});

// =============================================================================
// RUTERO WEEK (Fast CACHE version)
// =============================================================================
router.get('/rutero/week', async (req, res) => {
    try {
        const { vendedorCodes, role } = req.query;
        const now = getCurrentDate();

        logger.info(`[RUTERO WEEK] vendedorCodes: "${vendedorCodes}", role: "${role}"`);

        // Try to use cache first (instant response)
        const cachedCounts = getWeekCountsFromCache(vendedorCodes, role || 'comercial');

        if (cachedCounts) {
            // Calculate total unique clients from cache
            const totalClients = getTotalClientsFromCache(vendedorCodes, role || 'comercial');
            const todayName = DAY_NAMES[now.getDay()];

            logger.info(`[RUTERO WEEK] From cache: ${JSON.stringify(cachedCounts)}, total: ${totalClients}`);

            return res.json({
                week: cachedCounts,
                todayName,
                role: role || 'comercial',
                totalUniqueClients: totalClients
            });
        }

        // Fallback: Cache not ready, return empty
        logger.warn(`[RUTERO WEEK] Cache not ready, returning empty`);
        res.json({
            week: { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 },
            todayName: DAY_NAMES[now.getDay()],
            role: role || 'comercial',
            totalUniqueClients: 0,
            cacheStatus: 'loading'
        });
    } catch (error) {
        logger.error(`Rutero week error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo rutero semana', details: error.message });
    }
});

// =============================================================================
// RUTERO VENDEDORES
// =============================================================================
router.get('/rutero/vendedores', async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const prevYear = currentYear - 1;

        const sql = `
            WITH ActiveVendors AS (
                SELECT DISTINCT TRIM(R1_T8CDVD) as CODE
                FROM DSED.LACLAE
                WHERE LCAADC IN (${currentYear}, ${prevYear}) 
                  AND R1_T8CDVD IS NOT NULL 
                  AND TRIM(R1_T8CDVD) <> ''
            )
            SELECT
                AV.CODE as code,
                D.NOMBREVENDEDOR as name
            FROM ActiveVendors AV
            LEFT JOIN DSEDAC.VDD D ON AV.CODE = TRIM(D.CODIGOVENDEDOR)
            ORDER BY AV.CODE
        `;

        // Cache 1 hour
        const cacheKey = `vendedores:active:${currentYear}`;
        const vendedores = await cachedQuery(query, sql, cacheKey, TTL.LONG);

        res.json({
            vendedores: vendedores.map(v => ({
                code: v.CODE?.trim(),
                name: v.NAME?.trim() || `Vendedor ${v.CODE}`
            }))
        });
    } catch (error) {
        logger.error(`Error fetching vendedores: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// RUTERO MOVE CLIENTS
// =============================================================================
router.post('/rutero/move_clients', async (req, res) => {
    let conn;
    try {
        const { vendedor, moves, targetPosition } = req.body;

        if (!vendedor || !moves || !Array.isArray(moves)) {
            return res.status(400).json({ error: 'Datos inválidos. Se requiere vendedor y array de movimientos.' });
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
        await conn.beginTransaction();

        const movedClientsInfo = [];

        for (const move of moves) {
            const { client, toDay, position } = move;
            if (!client || !toDay) continue;

            const dayLower = toDay.toLowerCase();
            const clientTrimmed = client.trim();

            let previousDay = getClientCurrentDay(vendedor, clientTrimmed);
            let previousOrder = null;

            try {
                const prevRes = await conn.query(`
                    SELECT TRIM(DIA) as DIA, ORDEN FROM JAVIER.RUTERO_CONFIG 
                    WHERE VENDEDOR = '${vendedor}' AND TRIM(CLIENTE) = '${clientTrimmed}'
                `);
                if (prevRes && prevRes.length > 0) {
                    previousDay = prevRes[0].DIA?.trim() || previousDay;
                    previousOrder = prevRes[0].ORDEN;
                }
            } catch (e) {
                logger.warn(`Could not get previous config: ${e.message}`);
            }

            logger.info(`📋 Move: Cliente ${clientTrimmed} estaba en día "${previousDay || 'ninguno'}"`);

            await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${vendedor}' AND TRIM(CLIENTE) = '${clientTrimmed}'`);

            let targetOrder;
            const effectivePosition = position ?? targetPosition ?? 'end';

            if (effectivePosition === 'start' || effectivePosition === 0) {
                await conn.query(`
                    UPDATE JAVIER.RUTERO_CONFIG 
                    SET ORDEN = ORDEN + 10 
                    WHERE VENDEDOR = '${vendedor}' AND DIA = '${dayLower}'
                `);
                targetOrder = 0;
            } else if (typeof effectivePosition === 'number' && effectivePosition > 0) {
                targetOrder = effectivePosition * 10;
                await conn.query(`
                    UPDATE JAVIER.RUTERO_CONFIG 
                    SET ORDEN = ORDEN + 10 
                    WHERE VENDEDOR = '${vendedor}' AND DIA = '${dayLower}' AND ORDEN >= ${targetOrder}
                `);
            } else {
                const maxOrderRes = await conn.query(`
                    SELECT MAX(ORDEN) as MAX_ORD 
                    FROM JAVIER.RUTERO_CONFIG 
                    WHERE VENDEDOR = '${vendedor}' AND DIA = '${dayLower}'
                `);
                targetOrder = (maxOrderRes[0]?.MAX_ORD || 0) + 10;
            }

            await conn.query(`
                INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) 
                VALUES ('${vendedor}', '${dayLower}', '${clientTrimmed}', ${targetOrder})
            `);

            movedClientsInfo.push({
                client: clientTrimmed,
                clientName: move.clientName || 'Cliente',
                fromDay: previousDay || null,
                toDay: dayLower,
                previousPosition: previousOrder,
                newPosition: targetOrder
            });
        }

        await conn.commit();

        try {
            for (const moved of movedClientsInfo) {
                await conn.query(`
                    INSERT INTO JAVIER.RUTERO_LOG 
                    (VENDEDOR, TIPO_CAMBIO, DIA_ORIGEN, DIA_DESTINO, CLIENTE, NOMBRE_CLIENTE, POSICION_ANTERIOR, POSICION_NUEVA, DETALLES)
                    VALUES ('${vendedor}', 'CAMBIO_DIA', '${moved.fromDay}', '${moved.toDay}', '${moved.client}', 
                            '${(moved.clientName || '').replace(/'/g, "''")}', 
                            ${moved.previousPosition ?? 'NULL'}, ${moved.newPosition}, 
                            'Movido de ${moved.fromDay} a ${moved.toDay}')
                `);
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
                WHERE VENDEDOR = '${vendedor}' AND DIA = '${day}'
            `);
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
        if (conn) { try { await conn.rollback(); } catch (e) { } }
        logger.error(`Rutero move error: ${error.message}`);
        res.status(500).json({ error: 'Error moviendo clientes', details: error.message });
    } finally {
        if (conn) { try { await conn.close(); } catch (e) { } }
    }
});

// =============================================================================
// RUTERO CONFIGURATION (GET/POST)
// =============================================================================
router.post('/rutero/config', async (req, res) => {
    let conn;
    try {
        const { vendedor, dia, orden } = req.body;

        if (!vendedor || !dia || !orden || !Array.isArray(orden)) {
            return res.status(400).json({ error: 'Datos inválidos. Se requiere vendedor, dia y array de orden.' });
        }

        const pool = getPool();
        if (!pool) throw new Error("Database pool not initialized");

        conn = await pool.connect();
        await conn.beginTransaction();

        let previousPositions = {};
        try {
            const prevRows = await conn.query(`
                SELECT CLIENTE, ORDEN FROM JAVIER.RUTERO_CONFIG 
                WHERE VENDEDOR = '${vendedor}' AND DIA = '${dia}'
            `);
            prevRows.forEach(row => {
                previousPositions[row.CLIENTE?.trim()] = row.ORDEN;
            });
        } catch (e) {
            logger.warn(`Could not fetch previous positions: ${e.message}`);
        }

        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${vendedor}' AND DIA = '${dia}'`);

        if (orden.length > 0) {
            const clientCodes = orden.map(o => `'${o.cliente}'`).join(',');
            await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${vendedor}' AND CLIENTE IN (${clientCodes})`);

            for (const item of orden) {
                if (item.cliente) {
                    await conn.query(`
                      INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) 
                      VALUES ('${vendedor}', '${dia}', '${item.cliente}', ${parseInt(item.posicion) || 0})
                    `);
                }
            }
        }

        await conn.commit();

        // Invalidate cache for this vendor's config to ensure immediate updates
        try {
            const cachePattern = `rutero:config:v2:${vendedor}:*`;
            await deleteCachePattern(cachePattern);
            logger.info(`♻️ Cache invalidated for pattern: ${cachePattern}`);
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
                    await conn.query(`
                        INSERT INTO JAVIER.RUTERO_LOG 
                        (VENDEDOR, TIPO_CAMBIO, DIA_ORIGEN, DIA_DESTINO, CLIENTE, NOMBRE_CLIENTE, POSICION_ANTERIOR, POSICION_NUEVA, DETALLES)
                        VALUES ('${vendedor}', 'REORDENAMIENTO', '${dia}', '${dia}', '${item.cliente}', 
                                '', NULL, ${parseInt(item.posicion) || 0}, 
                                '${logDetail} a posición ${item.posicion}')
                    `);
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
                const clientCodes = orden.map(o => `'${o.cliente}'`).join(',');
                const names = await query(`SELECT CODIGOCLIENTE as C, COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), TRIM(NOMBRECLIENTE)) as N FROM DSEDAC.CLI WHERE CODIGOCLIENTE IN (${clientCodes}) FETCH FIRST 1000 ROWS ONLY`);
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
        if (conn) {
            try { await conn.rollback(); } catch (e) { }
        }
        logger.error(`Rutero config save error: ${error.message}`);
        res.status(500).json({ error: 'Error guardando orden', details: error.message });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { }
        }
    }
});

router.get('/rutero/config', async (req, res) => {
    try {
        const { vendedor, dia } = req.query;
        if (!vendedor || !dia) return res.status(400).json({ error: 'Vendedor y dia requeridos' });

        const rows = await query(`
      SELECT CLIENTE, ORDEN 
      FROM JAVIER.RUTERO_CONFIG 
      WHERE VENDEDOR = '${vendedor}' AND DIA = '${dia}' 
      ORDER BY ORDEN ASC
    `);

        res.json({ config: rows });
    } catch (error) {
        logger.error(`Rutero config fetch error: ${error.message}`);
        res.status(500).json({ error: 'Error recuperando orden' });
    }
});

// =============================================================================
// RUTERO DAY COUNTS
// =============================================================================
router.get('/rutero/counts', async (req, res) => {
    try {
        const { vendedorCodes, role } = req.query;
        const counts = getWeekCountsFromCache(vendedorCodes, role || 'comercial');

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
router.get('/rutero/positions/:day', async (req, res) => {
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
// RUTERO DAY (OPTIMIZED WITH CACHING) - Hotfix Update Check
// =============================================================================
router.get('/rutero/day/:day', async (req, res) => {
    try {
        const { day } = req.params;
        const { vendedorCodes, year, role, month, week, ignoreOverrides } = req.query; // Added ignoreOverrides
        const shouldIgnoreOverrides = ignoreOverrides === 'true' || ignoreOverrides === '1' || ignoreOverrides === true;

        if (shouldIgnoreOverrides) {
            logger.info(`[RUTERO DAY] Ignoring overrides for ${vendedorCodes} on ${day}`);
        }

        const now = getCurrentDate();
        const currentYear = parseInt(year) || now.getFullYear();
        const previousYear = currentYear - 1;

        // Determine the reference date (The "End Date" for calculation)
        // IMPORTANT: We want to compare COMPLETED weeks only.
        // If user is viewing week 3, we compare weeks 1-2 (completed weeks).
        // So referenceDate should be the Sunday of week (selected - 1), NOT week selected.
        let referenceDate;
        let completedWeeks = 0; // Track how many weeks are completed for the period label

        if (month && week) {
            const m = parseInt(month);
            const w = parseInt(week);

            // Calculate the Sunday that ends the PREVIOUS week (completed weeks)
            // If viewing week 1, there are no completed weeks yet -> use Jan 1
            // If viewing week 2, use end of week 1
            // If viewing week 3, use end of week 2, etc.

            const firstDayOfMonth = new Date(currentYear, m - 1, 1);
            // Find first Sunday of month (or end of first week)
            let daysUntilSunday = (7 - firstDayOfMonth.getDay()) % 7;
            if (daysUntilSunday === 0) daysUntilSunday = 7; // If Jan 1 is Sunday, first week ends that day
            let firstSunday = new Date(currentYear, m - 1, 1 + daysUntilSunday);

            if (w <= 1) {
                // Week 1: No completed weeks yet, use start of year for minimal comparison
                referenceDate = new Date(currentYear, 0, 1);
                completedWeeks = 0;
            } else {
                // For week N, completed weeks are 1 to (N-1)
                // End of week (N-1) is the Sunday before the current week
                completedWeeks = w - 1;
                referenceDate = new Date(firstSunday);
                referenceDate.setDate(firstSunday.getDate() + (w - 2) * 7); // -2 because we want previous week's Sunday
            }
        } else {
            // Default to Today logic - use last completed Sunday
            const today = new Date(now);
            const dayOfWeek = today.getDay();
            // If today is Sunday (0), go back 7 days to previous Sunday
            // Otherwise, go back to last Sunday
            const d = dayOfWeek === 0 ? 7 : dayOfWeek;
            referenceDate = new Date(today);
            referenceDate.setDate(today.getDate() - d);

            // Calculate completed weeks from start of year
            const startOfYear = new Date(currentYear, 0, 1);
            completedWeeks = Math.floor((referenceDate - startOfYear) / (7 * 86400000)) + 1;
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
        const safeClientFilter = clientBatch.map(c => `'${c.replace(/'/g, "''")}'`).join(',');

        // --- 2. Heavy Queries with Caching ---

        // Cache Key Components
        const clientsHash = safeClientFilter.length > 50 ? safeClientFilter.substring(0, 50) + clientBatch.length : safeClientFilter;
        const cacheTTL = TTL.MEDIUM; // 5 minutes

        // A. Client Details
        const detailsSql = `
            SELECT 
                CODIGOCLIENTE as CODE,
                COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), NOMBRECLIENTE) as NAME,
                DIRECCION as ADDRESS,
                POBLACION as CITY,
                TELEFONO1 as PHONE,
                TELEFONO2 as PHONE2
            FROM DSEDAC.CLI
            WHERE CODIGOCLIENTE IN (${safeClientFilter})
              AND (ANOBAJA = 0 OR ANOBAJA IS NULL)
        `;
        const clientDetailsRows = await cachedQuery(query, detailsSql, `rutero:details:v3:${clientsHash}`, TTL.LONG);

        // B. Current Sales (Heavy)
        const currentSalesSql = `
            SELECT 
                L.LCCDCL as CODE,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) IN (${safeClientFilter})
              AND L.LCAADC = ${currentYear}
              AND ${LACLAE_SALES_FILTER}
              AND (L.LCMMDC < ${endMonthCurrent} OR (L.LCMMDC = ${endMonthCurrent} AND L.LCDDDC <= ${endDayCurrent}))
            GROUP BY L.LCCDCL
        `;
        const currentSalesRows = await cachedQuery(query, currentSalesSql, `rutero:sales:v2:${currentYear}:${endMonthCurrent}:${endDayCurrent}:${clientsHash}`, cacheTTL);

        // Map Sales Data
        const currentSalesMap = new Map();
        currentSalesRows.forEach(r => {
            currentSalesMap.set(r.CODE.trim(), {
                sales: parseFloat(r.SALES) || 0,
                cost: parseFloat(r.COST) || 0
            });
        });

        // C. Prev Sales (Heavy)
        let prevYearRows = [];
        if (endMonthPrevious > 0) {
            const prevSalesSql = `
                SELECT 
                    L.LCCDCL as CODE,
                    SUM(L.LCIMVT) as SALES,
                    SUM(L.LCIMCT) as COST
                FROM DSED.LACLAE L
                WHERE TRIM(L.LCCDCL) IN (${safeClientFilter})
                  AND L.LCAADC = ${previousYear}
                  AND ${LACLAE_SALES_FILTER}
                  AND (L.LCMMDC < ${endMonthPrevious} OR (L.LCMMDC = ${endMonthPrevious} AND L.LCDDDC <= ${endDayPrevious}))
                GROUP BY L.LCCDCL
            `;
            prevYearRows = await cachedQuery(query, prevSalesSql, `rutero:sales:v2:${previousYear}:${endMonthPrevious}:${endDayPrevious}:${clientsHash}`, cacheTTL);
        }

        const prevYearMap = new Map();
        prevYearRows.forEach(r => {
            prevYearMap.set(r.CODE.trim(), {
                sales: parseFloat(r.SALES) || 0,
                cost: parseFloat(r.COST) || 0
            });
        });

        // C2. TOTAL Prev Year Sales (Full Year) - To determine if client is "NEW" vs just no sales in period
        // A client is "NEW" only if they had ZERO sales in the ENTIRE previous year
        let prevYearTotalMap = new Map();
        const prevYearTotalSql = `
            SELECT 
                L.LCCDCL as CODE,
                SUM(L.LCIMVT) as SALES
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) IN (${safeClientFilter})
              AND L.LCAADC = ${previousYear}
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCCDCL
        `;
        const prevYearTotalRows = await cachedQuery(query, prevYearTotalSql, `rutero:sales:total:${previousYear}:${clientsHash}`, TTL.LONG);
        prevYearTotalRows.forEach(r => {
            prevYearTotalMap.set(r.CODE.trim(), parseFloat(r.SALES) || 0);
        });

        // Merge Data
        const currentYearRows = clientDetailsRows.map(r => {
            const code = r.CODE.trim();
            const salesData = currentSalesMap.get(code) || { sales: 0, cost: 0 };
            return {
                ...r,
                SALES: salesData.sales,
                COST: salesData.cost
            };
        });

        // D. GPS (Cacheable)
        let gpsMap = new Map();
        try {
            const gpsSql = `
                SELECT CODIGO, LATITUD, LONGITUD
                FROM DSEMOVIL.CLIENTES
                WHERE CODIGO IN (${safeClientFilter})
                  AND LATITUD IS NOT NULL AND LATITUD <> 0
            `;
            const gpsResult = await cachedQuery(query, gpsSql, `rutero:gps:v3:${clientsHash}`, TTL.LONG);
            gpsResult.forEach(g => {
                gpsMap.set(g.CODIGO?.trim() || '', {
                    lat: parseFloat(g.LATITUD) || null,
                    lon: parseFloat(g.LONGITUD) || null
                });
            });
        } catch (e) {
            logger.warn(`Could not load GPS data: ${e.message}`);
        }

        // E. Client Notes (No Cache - Realtime)
        let notesMap = new Map();
        try {
            const notesRows = await query(`
                SELECT CLIENT_CODE, OBSERVACIONES, MODIFIED_BY
                FROM JAVIER.CLIENT_NOTES
                WHERE CLIENT_CODE IN (${safeClientFilter})
            `, false, false);
            notesRows.forEach(n => {
                notesMap.set(n.CLIENT_CODE?.trim(), {
                    text: n.OBSERVACIONES,
                    modifiedBy: n.MODIFIED_BY
                });
            });
        } catch (e) {
            // Table may not exist yet
        }

        // Retrieve custom order from cache if possible, or query
        const primaryVendor = vendedorCodes ? vendedorCodes.split(',')[0].trim() : '';
        let orderMap = new Map();

        // Only load custom order if NOT ignoring overrides
        if (primaryVendor && !shouldIgnoreOverrides) {
            // Direct query (No Cache) to ensure instant updates
            const configRows = await query(`
                SELECT CLIENTE, ORDEN 
                FROM JAVIER.RUTERO_CONFIG 
                WHERE VENDEDOR = '${primaryVendor}' AND DIA = '${day.toLowerCase()}'
             `, false); // false = no debug log clutter

            configRows.forEach(r => orderMap.set(r.CLIENTE.trim(), r.ORDEN));
            logger.info(`[RUTERO SORT] Loaded ${configRows.length} overrides for ${primaryVendor}/${day}`);
        }

        const clients = currentYearRows.map(r => {
            const code = r.CODE?.trim() || '';
            const prevSales = prevYearMap.get(code) || { sales: 0, cost: 0 };
            const prevYearTotalSales = prevYearTotalMap.get(code) || 0; // Total sales in entire previous year
            const gps = gpsMap.get(code) || { lat: null, lon: null };
            const note = notesMap.get(code);

            const salesCurrent = r.SALES || 0;
            const salesPrev = prevSales.sales || 0; // Sales in equivalent period of prev year

            // Calculate Growth (comparing equivalent periods)
            let growth = 0;
            if (salesPrev > 0) {
                growth = ((salesCurrent - salesPrev) / salesPrev) * 100;
            } else if (salesCurrent > 0) {
                growth = 100;
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
                }
            }

            return {
                code,
                name: r.NAME?.trim(),
                address: r.ADDRESS?.trim(),
                city: r.CITY?.trim(),
                phone: r.PHONE?.trim(),
                phone2: r.PHONE2?.trim(),
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
            if (shouldIgnoreOverrides) {
                // Original Route Fallback: Stable Sort by CODE
                return (a.name || '').localeCompare(b.name || '');
            } else {
                // Custom Route Fallback: Optimization Sort by SALES (Desc)
                // This keeps high-value clients visible if not manually ordered
                return b.status.ytdSales - a.status.ytdSales;
            }
        });

        res.json({
            clients,
            count: clients.length,
            day,
            year: currentYear,
            compareYear: previousYear,
            period: {
                weeks: completedWeeks, // Number of completed weeks being compared
                current: completedWeeks > 0 ? `1 Ene - ${endDayCurrent} ${['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][endMonthCurrent - 1]}` : 'Sin semanas completadas',
                previous: completedWeeks > 0 && endMonthPrevious > 0 ? `1 Ene - ${endDayPrevious} ${['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][endMonthPrevious - 1]}` : 'Sin comparación'
            }
        });

    } catch (error) {
        logger.error(`Rutero Day Error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo rutero diario', details: error.message });
    }
});

// =============================================================================
// DIAGNOSTIC: Client-Vendor Assignment
// =============================================================================
router.get('/diagnose/client/:code', async (req, res) => {
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
            const clientData = await query(`
                SELECT 
                    TRIM(CODIGOCLIENTE) as CODE,
                    TRIM(COALESCE(NOMBREALTERNATIVO, NOMBRECLIENTE)) as NAME,
                    TRIM(CODIGOVENDEDOR) as VENDOR_CLI,
                    TRIM(CODIGOREPARTIDOR) as REPARTIDOR_CLI,
                    TRIM(POBLACION) as CITY,
                    TRIM(CODIGORUTA) as ROUTE
                FROM DSEDAC.CLI
                WHERE CODIGOCLIENTE = '${clientCode}'
                FETCH FIRST 1 ROWS ONLY
            `);
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
            const laclaeData = await query(`
                SELECT DISTINCT
                    TRIM(L.R1_T8CDVD) as VENDOR_LACLAE,
                    L.LCYEAB as YEAR,
                    L.R1_T8DIVL as VIS_L, L.R1_T8DIVM as VIS_M, L.R1_T8DIVX as VIS_X,
                    L.R1_T8DIVJ as VIS_J, L.R1_T8DIVV as VIS_V, L.R1_T8DIVS as VIS_S
                FROM DSED.LACLAE L
                WHERE TRIM(L.LCCDCL) = '${clientCode}'
                ORDER BY L.LCYEAB DESC
                FETCH FIRST 10 ROWS ONLY
            `);
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
            const configData = await query(`
                SELECT TRIM(VENDEDOR) as VENDEDOR, TRIM(DIA) as DIA, ORDEN
                FROM JAVIER.RUTERO_CONFIG
                WHERE TRIM(CLIENTE) = '${clientCode}'
                FETCH FIRST 10 ROWS ONLY
            `);
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
                const vendorData = await query(`
                    SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME
                    FROM DSEDAC.VDD
                    WHERE CODIGOVENDEDOR = '${results.clientInfo.VENDOR_CLI}'
                    FETCH FIRST 1 ROWS ONLY
                `);
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
        logger.error(`Diagnose Error: ${error.message}`);
        res.status(500).json({ error: 'Error en diagnóstico', details: error.message });
    }
});

// =============================================================================
// DIAGNOSTIC: Vendor Cache Dump
// =============================================================================
router.get('/diagnose/vendor/:code', (req, res) => {
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
router.get('/rutero/client/:code/detail', async (req, res) => {
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
        const monthlySalesSql = `
            SELECT 
                L.LCYEAB as YEAR,
                L.LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST,
                SUM(L.LCIMVT - L.LCIMCT) as MARGIN
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) = '${clientCode}'
              AND L.LCYEAB IN (${currentYear}, ${previousYear})
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCYEAB, L.LCMMDC
            ORDER BY L.LCYEAB DESC, L.LCMMDC ASC
        `;
        const monthlySales = await query(monthlySalesSql, false, false);

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
        const yearlyHistorySql = `
            SELECT 
                L.LCYEAB as YEAR,
                SUM(L.LCIMVT) as SALES
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) = '${clientCode}'
              AND L.LCYEAB >= ${currentYear - 5}
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCYEAB
            ORDER BY L.LCYEAB DESC
        `;
        const yearlyHistory = await query(yearlyHistorySql, false, false);
        const yearlyTotals = yearlyHistory.map(row => ({
            year: row.YEAR,
            sales: formatCurrencyLocal(row.SALES),
            salesFormatted: formatCurrencyString(row.SALES)
        }));

        // Calculate purchase frequency (orders in current year)
        const frequencySql = `
            SELECT 
                COUNT(DISTINCT L.LCDIDL || '-' || L.LCMIDL || '-' || L.LCAIDL) as ORDER_COUNT,
                COUNT(*) as LINE_COUNT,
                MAX(L.LCAIDL * 10000 + L.LCMIDL * 100 + L.LCDIDL) as LAST_ORDER_DATE
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) = '${clientCode}'
              AND L.LCYEAB = ${currentYear}
              AND ${LACLAE_SALES_FILTER}
        `;
        const frequencyResult = await query(frequencySql, false, false);
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
        logger.error(`Rutero Client Detail Error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo detalle de cliente', details: error.message });
    }
});

module.exports = router;
