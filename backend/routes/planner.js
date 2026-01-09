const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query, queryWithParams, getPool } = require('../config/db');
const {
    getCurrentDate,
    buildVendedorFilter,
    buildVendedorFilterLACLAE,
    formatCurrency,
    LAC_SALES_FILTER,
    LACLAE_SALES_FILTER
} = require('../utils/common');

const {
    getWeekCountsFromCache,
    getTotalClientsFromCache,
    getClientsForDay,
    getVendedoresFromCache,
    reloadRuteroConfig
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

        const activities = await query(`
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
    `);

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
        // MOVED TO LACLAE SOURCE but OPTIMIZED
        // Scan only recent years (2025, 2026) to avoid full table scan
        const currentYear = new Date().getFullYear();
        const prevYear = currentYear - 1;

        const vendedores = await query(`
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
        `);

        // Cache 1 hour
        res.set('Cache-Control', 'public, max-age=3600');

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
// RUTERO MOVE CLIENTS (Change Day) - CON VALIDACIÓN DE DOMINGO
// =============================================================================
router.post('/rutero/move_clients', async (req, res) => {
    let conn;
    try {
        const { vendedor, moves, targetPosition } = req.body; 
        // moves: [{ client, toDay, clientName, position? }]
        // targetPosition: 'end' | 'start' | number (optional, default 'end')

        if (!vendedor || !moves || !Array.isArray(moves)) {
            return res.status(400).json({ error: 'Datos inválidos. Se requiere vendedor y array de movimientos.' });
        }

        // ⚠️ VALIDACIÓN: Nunca permitir Domingo como día destino
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

            // 0. Capturar día y posición anterior antes de eliminar
            let previousDay = null;
            let previousOrder = null;
            try {
                const prevRes = await conn.query(`
                    SELECT TRIM(DIA) as DIA, ORDEN FROM JAVIER.RUTERO_CONFIG 
                    WHERE VENDEDOR = '${vendedor}' AND TRIM(CLIENTE) = '${clientTrimmed}'
                `);
                if (prevRes && prevRes.length > 0) {
                    previousDay = prevRes[0].DIA?.trim() || null;
                    previousOrder = prevRes[0].ORDEN;
                    logger.info(`📋 Move: Cliente ${clientTrimmed} estaba en día "${previousDay}" orden ${previousOrder}`);
                } else {
                    logger.info(`📋 Move: Cliente ${clientTrimmed} no tenía día asignado previamente`);
                }
            } catch (e) { 
                logger.warn(`Could not get previous day: ${e.message}`);
            }

            // 1. Remove from any previous assignment
            await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${vendedor}' AND TRIM(CLIENTE) = '${clientTrimmed}'`);

            // 2. Determine position based on parameter
            let targetOrder;
            const effectivePosition = position ?? targetPosition ?? 'end';
            
            if (effectivePosition === 'start' || effectivePosition === 0) {
                // Shift all existing clients down and insert at position 0
                await conn.query(`
                    UPDATE JAVIER.RUTERO_CONFIG 
                    SET ORDEN = ORDEN + 10 
                    WHERE VENDEDOR = '${vendedor}' AND DIA = '${dayLower}'
                `);
                targetOrder = 0;
            } else if (typeof effectivePosition === 'number' && effectivePosition > 0) {
                // Insert at specific position, shifting others if needed
                targetOrder = effectivePosition * 10;
                await conn.query(`
                    UPDATE JAVIER.RUTERO_CONFIG 
                    SET ORDEN = ORDEN + 10 
                    WHERE VENDEDOR = '${vendedor}' AND DIA = '${dayLower}' AND ORDEN >= ${targetOrder}
                `);
            } else {
                // Default: Append to end
                const maxOrderRes = await conn.query(`
                    SELECT MAX(ORDEN) as MAX_ORD 
                    FROM JAVIER.RUTERO_CONFIG 
                    WHERE VENDEDOR = '${vendedor}' AND DIA = '${dayLower}'
                `);
                targetOrder = (maxOrderRes[0]?.MAX_ORD || 0) + 10;
            }

            // 3. Insert at calculated position
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
        
        // ═══════════════════════════════════════════════════════════════
        // REGISTRAR EN LOG DE CAMBIOS (JAVIER.RUTERO_LOG)
        // ═══════════════════════════════════════════════════════════════
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

        // Get updated counts for the affected days
        const affectedDays = [...new Set(moves.map(m => m.toDay.toLowerCase()))];
        const updatedCounts = {};
        
        for (const day of affectedDays) {
            const countRes = await conn.query(`
                SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG 
                WHERE VENDEDOR = '${vendedor}' AND DIA = '${day}'
            `);
            updatedCounts[day] = countRes[0]?.CNT || 0;
        }

        // Audit Email con información detallada
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

        // Connect manually for transaction support using pool
        const pool = getPool();
        if (!pool) throw new Error("Database pool not initialized");

        conn = await pool.connect();
        await conn.beginTransaction();

        // ═══════════════════════════════════════════════════════════════
        // CAPTURAR POSICIONES ANTERIORES ANTES DE BORRAR
        // ═══════════════════════════════════════════════════════════════
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

        // 1. Delete existing config for this vendor/day AND for these specific clients anywhere
        // Why? If moving a client from Monday to Tuesday, we must remove them from Monday (if overridden)
        // AND remove them from any previous Tuesday config to avoid duplicates before inserting.

        // A. Clear current day overrides entirely (overwrite logic for this day)
        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${vendedor}' AND DIA = '${dia}'`);

        // B. Ensure clients being saved are removed from ANY other day overrides
        if (orden.length > 0) {
            const clientCodes = orden.map(o => `'${o.cliente}'`).join(',');
            // This deletes them from ANY day (incl. current, which is redundant but safe)
            await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${vendedor}' AND CLIENTE IN (${clientCodes})`);

            // 2. Insert new order
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

        // ═══════════════════════════════════════════════════════════════
        // REGISTRAR EN LOG DE CAMBIOS (JAVIER.RUTERO_LOG)
        // ═══════════════════════════════════════════════════════════════
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

        // Reload cache immediately so other calls see changes
        await reloadRuteroConfig();

        // 3. Send Audit Email (Best Effort)
        try {
            // Fetch names for nicer email
            let clientNamesMap = {};
            if (orden.length > 0) {
                const clientCodes = orden.map(o => `'${o.cliente}'`).join(',');
                const names = await query(`SELECT CODIGOCLIENTE as C, COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), TRIM(NOMBRECLIENTE)) as N FROM DSEDAC.CLI WHERE CODIGOCLIENTE IN (${clientCodes}) FETCH FIRST 1000 ROWS ONLY`);
                names.forEach(n => clientNamesMap[n.C.trim()] = n.N.trim());
            }

            // Calcular clientes que realmente cambiaron de posición
            const clientesConCambio = orden.map(o => {
                const clienteId = o.cliente?.trim();
                const posAnterior = previousPositions[clienteId];
                const posNueva = parseInt(o.posicion) || 0;
                const hayCambio = posAnterior !== undefined && posAnterior !== posNueva;
                
                return {
                    codigo: o.cliente,
                    nombre: clientNamesMap[o.cliente] || 'Desconocido',
                    posicion: posNueva,
                    posicionAnterior: posAnterior !== undefined ? posAnterior : posNueva,
                    hayCambio: hayCambio
                };
            });

            const clientesCambiados = clientesConCambio.filter(c => c.hayCambio);

            const auditDetails = {
                action: 'Actualización de Rutero',
                diaObjetivo: dia,
                totalClientes: orden.length,
                cambiosDetectados: clientesCambiados.length,
                clientesAfectados: clientesConCambio
            };

            // ENVIAR EMAIL AHORA - Este es el "GUARDAR CAMBIOS" del modal
            // Acumula este cambio Y envía todos los pendientes (incluidos move_clients anteriores)
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
// RUTERO DAY COUNTS - Obtener contadores actualizados de cada día
// =============================================================================
router.get('/rutero/counts', async (req, res) => {
    try {
        const { vendedorCodes, role } = req.query;
        
        // Usar caché actualizada que ya considera overrides
        const counts = getWeekCountsFromCache(vendedorCodes, role || 'comercial');
        
        if (!counts) {
            return res.json({ 
                counts: { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 },
                cacheStatus: 'loading'
            });
        }
        
        // También obtener total único de clientes
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
// RUTERO AVAILABLE POSITIONS - Para selector de posición
// =============================================================================
router.get('/rutero/positions/:day', async (req, res) => {
    try {
        const { day } = req.params;
        const { vendedorCodes, role } = req.query;
        
        // Get clients for that day
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
// RUTERO DAY
// =============================================================================
router.get('/rutero/day/:day', async (req, res) => {
    try {
        const { day } = req.params;
        const { vendedorCodes, year, role } = req.query;
        const now = getCurrentDate();
        const currentYear = parseInt(year) || now.getFullYear();
        const previousYear = currentYear - 1;
        const isVisit = role !== 'repartidor';

        // End date for current year: Today (include real-time sales)
        const endMonthCurrent = now.getMonth() + 1;
        const endDayCurrent = now.getDate();

        // End date for PREVIOUS year: "Closed Week" logic (Week - 1)
        // We need to calculate the date of the LAST SUNDAY.
        // If current week is Week 1, this date might be in the previous year (resulting in 0 sales for this year), which is desired.
        const today = new Date(now);
        const dayOfWeek = today.getDay(); // 0 (Sun) - 6 (Sat)
        // Calculate days to subtract to get to previous Sunday.
        // If Sun(0) -> 7 days ago. If Mon(1) -> 1 day ago.
        const diffToLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;

        const lastSundayDate = new Date(today);
        lastSundayDate.setDate(today.getDate() - diffToLastSunday);

        // Now map this date to the Previous Year. 
        // We want the same RELATIVE date (e.g., if last Sunday was Jan 5th, we want Jan 5th of Prev Year)
        // OR better: The user wants "Accumulated until Week - 1".
        // If we are in Week 2, we want Week 1 of Prev Year.
        // Week 1 of Prev Year ends approx same date.
        // Let's use the Date of Last Sunday.
        // If Last Sunday was Dec 28 (Prev Year Context), then we query until Dec 28.

        let endMonthPrevious, endDayPrevious;

        if (lastSundayDate.getFullYear() < currentYear) {
            // We are in Week 1, so "Week - 1" is in previous year -> 0 sales for this year context
            endMonthPrevious = 0;
            endDayPrevious = 0;
        } else {
            endMonthPrevious = lastSundayDate.getMonth() + 1;
            endDayPrevious = lastSundayDate.getDate();
        }

        // Validate day
        if (DAY_NAMES.indexOf(day.toLowerCase()) === -1) {
            return res.status(400).json({ error: 'Día inválido', day });
        }

        // Fetch custom order
        let orderMap = new Map();
        try {
            const primaryVendor = vendedorCodes ? vendedorCodes.split(',')[0].trim() : '';
            if (primaryVendor) {
                const configRows = await query(`
          SELECT CLIENTE, ORDEN 
          FROM JAVIER.RUTERO_CONFIG 
          WHERE VENDEDOR = '${primaryVendor}' AND DIA = '${day.toLowerCase()}'
        `);
                configRows.forEach(r => orderMap.set(r.CLIENTE.trim(), r.ORDEN));
            }
        } catch (e) {
            logger.warn(`Order config error: ${e.message}`);
        }

        // Get client codes for the selected day from CACHE
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

        // Build client filter
        const batchSize = 200;
        const clientBatch = dayClientCodes.slice(0, batchSize);
        const safeClientFilter = clientBatch.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
        // 1. Get Client Details (Names, Addresses, Phones) - Guaranteed for all planned clients
        const clientDetailsRows = await query(`
            SELECT 
                CODIGOCLIENTE as CODE,
                COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), NOMBRECLIENTE) as NAME,
                DIRECCION as ADDRESS,
                POBLACION as CITY,
                TELEFONO1 as PHONE,
                TELEFONO2 as PHONE2
            FROM DSEDAC.CLI
            WHERE CODIGOCLIENTE IN (${safeClientFilter})
        `);

        // 2. Get Sales Data (Current Year) - Using LACLAE with LCIMVT for sales without VAT
        const currentSalesRows = await query(`
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
        `);


        // Map Sales Data
        const currentSalesMap = new Map();
        currentSalesRows.forEach(r => {
            currentSalesMap.set(r.CODE.trim(), {
                sales: parseFloat(r.SALES) || 0,
                cost: parseFloat(r.COST) || 0
            });
        });

        // 3. Get Sales Data (Previous Year) - Using LACLAE with LCIMVT
        // If endMonthPrevious is 0, it means we are in Week 1, so no previous year sales to compare yet against closed weeks.
        let prevYearRows = [];
        if (endMonthPrevious > 0) {
            prevYearRows = await query(`
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
            `);
        }


        const prevYearMap = new Map();
        prevYearRows.forEach(r => {
            prevYearMap.set(r.CODE.trim(), {
                sales: parseFloat(r.SALES) || 0,
                cost: parseFloat(r.COST) || 0
            });
        });

        // 4. Merge Data
        const currentYearRows = clientDetailsRows.map(r => {
            const code = r.CODE.trim();
            const salesData = currentSalesMap.get(code) || { sales: 0, cost: 0 };
            return {
                ...r,
                SALES: salesData.sales,
                COST: salesData.cost
            };
        });

        // Get GPS coordinates
        let gpsMap = new Map();
        try {
            const gpsResult = await query(`
        SELECT CODIGO, LATITUD, LONGITUD
        FROM DSEMOVIL.CLIENTES
        WHERE CODIGO IN (${clientBatch.map(c => `'${c}'`).join(',')})
          AND LATITUD IS NOT NULL AND LATITUD <> 0
      `);
            gpsResult.forEach(g => {
                gpsMap.set(g.CODIGO?.trim() || '', {
                    lat: parseFloat(g.LATITUD) || null,
                    lon: parseFloat(g.LONGITUD) || null
                });
            });
        } catch (e) {
            logger.warn(`Could not load GPS data: ${e.message}`);
        }

        // 5. Get Editable Observations from JAVIER.CLIENT_NOTES
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
            logger.debug(`CLIENT_NOTES not found: ${e.message}`);
        }

        // Build response
        const clients = currentYearRows.map(r => {
            const code = r.CODE?.trim() || '';
            const ytdSales = parseFloat(r.SALES) || 0;
            const ytdCost = parseFloat(r.COST) || 0;
            const ytdMargin = ytdSales > 0 ? ((ytdSales - ytdCost) / ytdSales * 100) : 0;

            const prevData = prevYearMap.get(code) || { sales: 0, cost: 0 };
            const prevSales = prevData.sales;

            const yoyVariation = prevSales > 0
                ? ((ytdSales - prevSales) / prevSales * 100)
                : (ytdSales > 0 ? 100 : 0);
            const isPositive = ytdSales >= prevSales;
            const gps = gpsMap.get(code) || { lat: null, lon: null };
            const notes = notesMap.get(code) || null;

            // Build phones array for WhatsApp selector
            const phones = [];
            if (r.PHONE?.trim()) phones.push({ type: 'Teléfono 1', number: r.PHONE.trim() });
            if (r.PHONE2?.trim()) phones.push({ type: 'Teléfono 2', number: r.PHONE2.trim() });

            return {
                code,
                name: r.NAME?.trim() || 'Sin nombre',
                address: r.ADDRESS?.trim() || '',
                city: r.CITY?.trim() || '',
                phone: r.PHONE?.trim() || '',
                phones: phones, // Array for WhatsApp selector
                observaciones: notes, // Editable notes
                latitude: gps.lat,
                longitude: gps.lon,
                status: {
                    isPositive,
                    ytdSales: Math.round(ytdSales * 100) / 100,
                    ytdPrevYear: Math.round(prevSales * 100) / 100,
                    yoyVariation: Math.round(yoyVariation * 10) / 10,
                    margin: Math.round(ytdMargin * 10) / 10,
                    currentMonthSales: ytdSales,
                    prevMonthSales: prevSales,
                    variation: yoyVariation
                }
            };
        }).sort((a, b) => {
            const orderA = orderMap.has(a.code) ? orderMap.get(a.code) : 999999;
            const orderB = orderMap.has(b.code) ? orderMap.get(b.code) : 999999;
            if (orderA !== orderB) return orderA - orderB;
            return b.status.ytdSales - a.status.ytdSales;
        });

        res.json({
            clients,
            count: clients.length,
            totalDayClients: dayClientCodes.length,
            day,
            year: currentYear,
            compareYear: previousYear
        });

    } catch (error) {
        logger.error(`Rutero day error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo rutero del día', details: error.message });
    }
});

// =============================================================================
// RUTERO CLIENT STATUS (YoY Comparison)
// =============================================================================
router.get('/rutero/client/:code/status', async (req, res) => {
    try {
        const { code } = req.params;
        const clientCode = code.trim();
        const now = getCurrentDate();
        const currentYear = now.getFullYear();

        // Ventas por mes del año actual - usando LACLAE con LCIMVT (sin IVA)
        const currentYearData = await queryWithParams(`
      SELECT LCMMDC as month, SUM(LCIMVT) as sales, SUM(LCIMVT - LCIMCT) as margin
      FROM DSED.LACLAE L
      WHERE LCCDCL = ? AND LCAADC = ${currentYear}
        AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
      GROUP BY LCMMDC
      ORDER BY LCMMDC
    `, [clientCode]);

        // Ventas por mes del año anterior - usando LACLAE con LCIMVT
        const lastYearData = await queryWithParams(`
      SELECT LCMMDC as month, SUM(LCIMVT) as sales, SUM(LCIMVT - LCIMCT) as margin
      FROM DSED.LACLAE L
      WHERE LCCDCL = ? AND LCAADC = ${currentYear - 1}
        AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
      GROUP BY LCMMDC
      ORDER BY LCMMDC
    `, [clientCode]);


        // Crear mapa de comparación
        const comparison = [];
        for (let m = 1; m <= 12; m++) {
            const curr = currentYearData.find(d => d.MONTH === m);
            const last = lastYearData.find(d => d.MONTH === m);
            const currSales = parseFloat(curr?.SALES) || 0;
            const lastSales = parseFloat(last?.SALES) || 0;
            const variation = lastSales > 0 ? ((currSales - lastSales) / lastSales) * 100 : (currSales > 0 ? 100 : 0);

            comparison.push({
                month: m,
                currentYear: currSales,
                lastYear: lastSales,
                variation: Math.round(variation * 10) / 10,
                isPositive: variation >= 0
            });
        }

        res.json(comparison);

    } catch (error) {
        logger.error(`Rutero client status error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo estado del cliente', details: error.message });
    }
});

// =============================================================================
// RUTERO CLIENT DETAIL (Comprehensive View)
// =============================================================================
router.get('/rutero/client/:code/detail', async (req, res) => {
    try {
        const { code } = req.params;
        const { year, filterMonth } = req.query;
        const clientCode = code.trim();
        const now = getCurrentDate();
        const targetYear = parseInt(year) || now.getFullYear();

        // 1. Client Info with Razón Social - parameterized
        const clientInfo = await queryWithParams(`
      SELECT 
        CODIGOCLIENTE as code,
        COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), TRIM(NOMBRECLIENTE)) as razonSocial,
        NOMBRECLIENTE as nombreCompleto,
        NIF, DIRECCION, POBLACION, PROVINCIA, CODIGOPOSTAL,
        TELEFONO1, TELEFONO2, PERSONACONTACTO, CODIGORUTA
      FROM DSEDAC.CLI
      WHERE CODIGOCLIENTE = ?
      FETCH FIRST 1 ROWS ONLY
    `, [clientCode]);

        if (clientInfo.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        // 2. Monthly Sales Breakdown (Current + Last Year)
        let salesByMonth = [];
        try {
            salesByMonth = await queryWithParams(`
        SELECT 
          L.ANODOCUMENTO as year,
          L.MESDOCUMENTO as month,
          SUM(L.IMPORTEVENTA) as sales,
          SUM(L.IMPORTEMARGENREAL) as margin,
          COUNT(DISTINCT L.NUMERODOCUMENTO) as invoices,
          COUNT(DISTINCT L.CODIGOARTICULO) as products
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
          AND C.CCYEAB = L.LCYEAB 
          AND C.CCSRAB = L.LCSRAB 
          AND C.CCTRAB = L.LCTRAB 
          AND C.CCNRAB = L.LCNRAB
        WHERE L.CODIGOCLIENTEALBARAN = ?
          AND L.ANODOCUMENTO IN (${targetYear}, ${targetYear - 1})
           AND L.LCTPVT IN ('CC', 'VC')
           AND L.LCCLLN IN ('AB', 'VT')
           AND L.LCSRAB NOT IN ('N', 'Z')
           AND COALESCE(C.CCSNSD, '') <> 'E'
        GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC
      `, [clientCode]);
        } catch (e) {
            // Fallback without margin
            salesByMonth = await queryWithParams(`
        SELECT 
          ANODOCUMENTO as year,
          MESDOCUMENTO as month,
          SUM(IMPORTEVENTA) as sales,
          0 as margin,
          COUNT(DISTINCT NUMERODOCUMENTO) as invoices,
          COUNT(DISTINCT CODIGOARTICULO) as products
        FROM DSEDAC.LAC L
        WHERE CODIGOCLIENTEALBARAN = ?
          AND ANODOCUMENTO IN (${targetYear}, ${targetYear - 1})
        GROUP BY ANODOCUMENTO, MESDOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
      `, [clientCode]);
        }

        // 3. Product Purchases with Dates - Parameterized to fix safeCode bug
        let productFilter = '';
        if (filterMonth) {
            productFilter = `AND MESDOCUMENTO = ${parseInt(filterMonth)}`;
        }

        let productPurchases = [];
        try {
            productPurchases = await queryWithParams(`
        SELECT 
          L.CODIGOARTICULO as productCode,
          L.DESCRIPCION as productName,
          L.ANODOCUMENTO as year,
          L.MESDOCUMENTO as month,
          L.DIADOCUMENTO as day,
          L.PRECIOVENTA as price,
          L.CANTIDADUNIDADES as quantity,
          L.IMPORTEVENTA as total,
          L.CODIGOLOTE as lote,
          L.REFERENCIADOCUMENTO as ref,
          L.NUMERODOCUMENTO as invoice
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
          AND C.CCYEAB = L.LCYEAB 
          AND C.CCSRAB = L.LCSRAB 
          AND C.CCTRAB = L.LCTRAB 
          AND C.CCNRAB = L.LCNRAB
        WHERE L.CODIGOCLIENTEALBARAN = ?
          AND L.ANODOCUMENTO = ${targetYear}
          AND L.LCTPVT IN ('CC', 'VC')
          AND L.LCCLLN IN ('AB', 'VT')
          AND L.LCSRAB NOT IN ('N', 'Z')
          AND COALESCE(C.CCSNSD, '') <> 'E'
          ${productFilter}
        ORDER BY L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
        FETCH FIRST 300 ROWS ONLY
      `, [clientCode]);
        } catch (e) {
            logger.warn(`Product purchases query failed: ${e.message}`);
        }

        // 4. Yearly Totals (last 3 years) - Parameterized
        let yearlyTotals = [];
        try {
            yearlyTotals = await queryWithParams(`
        SELECT 
          L.ANODOCUMENTO as year,
          SUM(L.IMPORTEVENTA) as totalSales,
          SUM(L.IMPORTEMARGENREAL) as totalMargin
        FROM DSEDAC.LAC L
        WHERE L.CODIGOCLIENTEALBARAN = ?
          AND L.ANODOCUMENTO >= ${targetYear - 2}
        GROUP BY L.ANODOCUMENTO
        ORDER BY L.ANODOCUMENTO DESC
      `, [clientCode]);
        } catch (e) { }

        // 5. Top Products - Parameterized
        let topProducts = [];
        try {
            topProducts = await queryWithParams(`
        SELECT 
          L.CODIGOARTICULO as code,
          MAX(L.DESCRIPCION) as name,
          SUM(L.IMPORTEVENTA) as totalSales,
          SUM(L.CANTIDADUNIDADES) as totalUnits,
          COUNT(*) as purchases
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
          AND C.CCYEAB = L.LCYEAB 
          AND C.CCSRAB = L.LCSRAB 
          AND C.CCTRAB = L.LCTRAB 
          AND C.CCNRAB = L.LCNRAB
        WHERE L.CODIGOCLIENTEALBARAN = ?
          AND L.ANODOCUMENTO = ${targetYear}
          AND L.LCTPVT IN ('CC', 'VC')
          AND L.LCCLLN IN ('AB', 'VT')
          AND L.LCSRAB NOT IN ('N', 'Z')
          AND COALESCE(C.CCSNSD, '') <> 'E'
        GROUP BY L.CODIGOARTICULO
        ORDER BY SUM(L.IMPORTEVENTA) DESC
        FETCH FIRST 20 ROWS ONLY
      `, [clientCode]);
        } catch (e) { }

        // 6. Purchase frequency - Parameterized
        let purchaseFreq = [];
        try {
            purchaseFreq = await queryWithParams(`
        SELECT 
          COUNT(DISTINCT DIADOCUMENTO || MESDOCUMENTO || ANODOCUMENTO) as purchaseDays,
          MIN(MESDOCUMENTO) as firstMonth,
          MAX(MESDOCUMENTO) as lastMonth
        FROM DSEDAC.LAC L
        WHERE CODIGOCLIENTEALBARAN = ?
          AND ANODOCUMENTO = ${targetYear}
      `, [clientCode]);
        } catch (e) { }

        // Build response
        const c = clientInfo[0];

        const monthlyData = [];
        for (let m = 1; m <= 12; m++) {
            const currRow = salesByMonth.find(r => r.YEAR === targetYear && r.MONTH === m);
            const lastRow = salesByMonth.find(r => r.YEAR === targetYear - 1 && r.MONTH === m);

            const currSales = parseFloat(currRow?.SALES) || 0;
            const lastSales = parseFloat(lastRow?.SALES) || 0;
            const variation = lastSales > 0 ? ((currSales - lastSales) / lastSales) * 100 : (currSales > 0 ? 100 : 0);

            monthlyData.push({
                month: m,
                monthName: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][m - 1],
                currentYear: currSales,
                currentYearFormatted: formatCurrency(currSales),
                lastYear: lastSales,
                lastYearFormatted: formatCurrency(lastSales),
                variation: Math.round(variation * 10) / 10,
                isPositive: variation >= 0,
                margin: parseFloat(currRow?.MARGIN) || 0,
                invoices: parseInt(currRow?.INVOICES) || 0,
                products: parseInt(currRow?.PRODUCTS) || 0
            });
        }

        // Calculate Totals for Summary Card
        const totalSalesCurrent = monthlyData.reduce((sum, m) => sum + m.currentYear, 0);
        const totalSalesLast = monthlyData.reduce((sum, m) => sum + m.lastYear, 0);
        const totalVariation = totalSalesLast > 0 ? ((totalSalesCurrent - totalSalesLast) / totalSalesLast) * 100 : 0;
        const avgMonthly = totalSalesCurrent / 12;

        const totals = {
            currentYear: totalSalesCurrent,
            currentYearFormatted: formatCurrency(totalSalesCurrent),
            lastYear: totalSalesLast,
            lastYearFormatted: formatCurrency(totalSalesLast),
            variation: Math.round(totalVariation * 10) / 10,
            isPositive: totalVariation >= 0,
            monthlyAverage: avgMonthly,
            monthlyAverageFormatted: formatCurrency(avgMonthly)
        };

        const freq = purchaseFreq[0] || {};
        const purchaseDays = parseInt(freq.PURCHASEDAYS) || 0;
        const monthsActive = (parseInt(freq.LASTMONTH) || 1) - (parseInt(freq.FIRSTMONTH) || 1) + 1;
        const avgPurchasesPerMonth = monthsActive > 0 ? purchaseDays / monthsActive : 0;

        res.json({
            client: {
                code: c.CODE?.trim(),
                razonSocial: c.RAZONSOCIAL?.trim() || c.NOMBRECOMPLETO?.trim(),
                nombreCompleto: c.NOMBRECOMPLETO?.trim(),
                nif: c.NIF?.trim(),
                address: c.DIRECCION?.trim(),
                city: c.POBLACION?.trim(),
                province: c.PROVINCIA?.trim(),
                postalCode: c.CODIGOPOSTAL?.trim(),
                phone: c.TELEFONO1?.trim(),
                phone2: c.TELEFONO2?.trim(),
                contact: c.PERSONACONTACTO?.trim(),
                route: c.CODIGORUTA?.trim()
            },
            purchaseFrequency: {
                avgPurchasesPerMonth: Math.round(avgPurchasesPerMonth * 10) / 10,
                totalPurchaseDays: purchaseDays,
                isFrequentBuyer: purchaseDays > 12 // Arbitrary threshold
            },
            totals,
            monthlyData,
            topProducts: topProducts.map(p => ({
                code: p.CODE?.trim(),
                name: p.NAME?.trim(),
                totalSalesFormatted: formatCurrency(p.TOTALSALES),
                totalSales: parseFloat(p.TOTALSALES), // Added raw value
                totalUnits: parseInt(p.TOTALUNITS) || 0,
                purchases: parseInt(p.PURCHASES) || 0
            })),
            productPurchases: productPurchases.map(p => ({
                productCode: p.PRODUCTCODE?.trim(),
                productName: p.PRODUCTNAME?.trim(),
                date: `${String(p.DAY).padStart(2, '0')}/${String(p.MONTH).padStart(2, '0')}/${p.YEAR}`,
                quantity: parseInt(p.QUANTITY) || 0,
                price: formatCurrency(p.PRICE),
                totalFormatted: formatCurrency(p.TOTAL), // Match Flutter expected key
                total: parseFloat(p.TOTAL),
                invoice: p.INVOICE,
                lote: p.LOTE
            })),
            yearlyTotals: yearlyTotals.map(y => ({
                year: y.YEAR,
                totalSalesFormatted: formatCurrency(y.TOTALSALES),
                totalSales: parseFloat(y.TOTALSALES),
                totalMargin: parseFloat(y.TOTALMARGIN),
                monthlyAverageFormatted: formatCurrency(parseFloat(y.TOTALSALES) / 12),
                activeMonths: 12 // Simplify
            }))
        });

    } catch (error) {
        logger.error(`Rutero detail error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo detalle', details: error.message });
    }
});

module.exports = router;
