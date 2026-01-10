const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query, getPool } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const {
    getCurrentDate,
    buildVendedorFilter,
    formatCurrency,
    LACLAE_SALES_FILTER
} = require('../utils/common');

const {
    getWeekCountsFromCache,
    getTotalClientsFromCache,
    getClientsForDay,
    reloadRuteroConfig,
    getClientCurrentDay
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

        try {
            for (const item of orden) {
                if (item.cliente) {
                    await conn.query(`
                        INSERT INTO JAVIER.RUTERO_LOG 
                        (VENDEDOR, TIPO_CAMBIO, DIA_ORIGEN, DIA_DESTINO, CLIENTE, NOMBRE_CLIENTE, POSICION_ANTERIOR, POSICION_NUEVA, DETALLES)
                        VALUES ('${vendedor}', 'REORDENAMIENTO', '${dia}', '${dia}', '${item.cliente}', 
                                '', NULL, ${parseInt(item.posicion) || 0}, 
                                'Reordenado en ${dia} a posición ${item.posicion}')
                    `);
                }
            }
        } catch (logErr) {
            logger.warn(`Log insert failed (non-blocking): ${logErr.message}`);
        }

        await reloadRuteroConfig();

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

        const dayClients = getClientsForDay(vendedorCodes, day, role || 'comercial');

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
// RUTERO DAY (OPTIMIZED WITH CACHING)
// =============================================================================
router.get('/rutero/day/:day', async (req, res) => {
    try {
        const { day } = req.params;
        const { vendedorCodes, year, role } = req.query;
        const now = getCurrentDate();
        const currentYear = parseInt(year) || now.getFullYear();
        const previousYear = currentYear - 1;

        const endMonthCurrent = now.getMonth() + 1;
        const endDayCurrent = now.getDate();

        const today = new Date(now);
        const dayOfWeek = today.getDay();
        const diffToLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
        const lastSundayDate = new Date(today);
        lastSundayDate.setDate(today.getDate() - diffToLastSunday);

        let endMonthPrevious, endDayPrevious;

        if (lastSundayDate.getFullYear() < currentYear) {
            endMonthPrevious = 0;
            endDayPrevious = 0;
        } else {
            endMonthPrevious = lastSundayDate.getMonth() + 1;
            endDayPrevious = lastSundayDate.getDate();
        }

        if (DAY_NAMES.indexOf(day.toLowerCase()) === -1) {
            return res.status(400).json({ error: 'Día inválido', day });
        }

        // 1. Get client codes for the selected day from CACHE (Fast)
        let dayClientCodes = getClientsForDay(vendedorCodes, day, role || 'comercial');

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
        `;
        const clientDetailsRows = await cachedQuery(query, detailsSql, `rutero:details:${clientsHash}`, TTL.LONG);

        // B. Current Sales (Heavy)
        const currentSalesSql = `
            SELECT 
                L.LCCDCL as CODE,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST
            FROM DSED.LACLAE L
            WHERE L.LCCDCL IN (${safeClientFilter})
              AND L.LCAADC = ${currentYear}
              AND ${LACLAE_SALES_FILTER}
              AND (L.LCMMDC < ${endMonthCurrent} OR (L.LCMMDC = ${endMonthCurrent} AND L.LCDDDC <= ${endDayCurrent}))
            GROUP BY L.LCCDCL
        `;
        const currentSalesRows = await cachedQuery(query, currentSalesSql, `rutero:sales:${currentYear}:${endMonthCurrent}:${endDayCurrent}:${clientsHash}`, cacheTTL);

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
                WHERE L.LCCDCL IN (${safeClientFilter})
                  AND L.LCAADC = ${previousYear}
                  AND ${LACLAE_SALES_FILTER}
                  AND (L.LCMMDC < ${endMonthPrevious} OR (L.LCMMDC = ${endMonthPrevious} AND L.LCDDDC <= ${endDayPrevious}))
                GROUP BY L.LCCDCL
            `;
            prevYearRows = await cachedQuery(query, prevSalesSql, `rutero:sales:${previousYear}:${endMonthPrevious}:${endDayPrevious}:${clientsHash}`, cacheTTL);
        }

        const prevYearMap = new Map();
        prevYearRows.forEach(r => {
            prevYearMap.set(r.CODE.trim(), {
                sales: parseFloat(r.SALES) || 0,
                cost: parseFloat(r.COST) || 0
            });
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
            const gpsResult = await cachedQuery(query, gpsSql, `rutero:gps:${clientsHash}`, TTL.LONG);
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
        if (primaryVendor) {
            const configRows = await cachedQuery(query, `
                SELECT CLIENTE, ORDEN 
                FROM JAVIER.RUTERO_CONFIG 
                WHERE VENDEDOR = '${primaryVendor}' AND DIA = '${day.toLowerCase()}'
             `, `rutero:config:${primaryVendor}:${day.toLowerCase()}`, TTL.SHORT);
            configRows.forEach(r => orderMap.set(r.CLIENTE.trim(), r.ORDEN));
        }

        const clients = currentYearRows.map(r => {
            const code = r.CODE?.trim() || '';
            const prevSales = prevYearMap.get(code) || { sales: 0, cost: 0 };
            const gps = gpsMap.get(code) || { lat: null, lon: null };
            const note = notesMap.get(code);

            const salesCurrent = r.SALES || 0;
            const salesPrev = prevSales.sales || 0;

            // Calculate Growth
            let growth = 0;
            if (salesPrev > 0) {
                growth = ((salesCurrent - salesPrev) / salesPrev) * 100;
            } else if (salesCurrent > 0) {
                growth = 100;
            }

            return {
                code,
                name: r.NAME?.trim(),
                address: r.ADDRESS?.trim(),
                city: r.CITY?.trim(),
                phone: r.PHONE?.trim(),
                phone2: r.PHONE2?.trim(),
                sales: formatCurrency(salesCurrent),
                cost: formatCurrency(r.COST || 0),
                prevYearSales: formatCurrency(salesPrev),
                prevYearCost: formatCurrency(prevSales.cost || 0),
                growth: parseFloat(growth.toFixed(1)),
                lat: gps.lat,
                lon: gps.lon,
                observation: note ? note.text : null,
                observationBy: note ? note.modifiedBy : null,
                order: orderMap.has(code) ? orderMap.get(code) : 9999
            };
        });

        // Sort by custom order, then sales
        clients.sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            return b.sales - a.sales;
        });

        res.json({
            clients,
            count: clients.length,
            day,
            year: currentYear,
            compareYear: previousYear,
            period: {
                current: `1 Ene - ${endDayCurrent} ${['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][endMonthCurrent - 1]}`,
                previous: endMonthPrevious > 0 ? `1 Ene - ${endDayPrevious} ${['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][endMonthPrevious - 1]}` : 'Semana cerrada'
            }
        });

    } catch (error) {
        logger.error(`Rutero Day Error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo rutero diario', details: error.message });
    }
});

module.exports = router;
