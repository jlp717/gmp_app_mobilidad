const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query, queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

// Ensure directories exist
const photosDir = path.join(__dirname, '../../uploads/photos');
if (!fs.existsSync(photosDir)) {
    fs.mkdirSync(photosDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, photosDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `entrega-${uniqueSuffix}${ext}`);
    }
});
const upload = multer({ storage: storage });
const moment = require('moment'); // Ensure moment is available

// --- HELPER: Get Gamification Stats (Real DB) ---
async function getGamificationStats(repartidorId) {
    try {
        const currentYear = new Date().getFullYear();

        // 1. Level: Count total deliveries this year
        const levelSql = `
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.CPC
            WHERE TRIM(CODIGOREPARTIDOR) = '${repartidorId}'
              AND ANODOCUMENTO = ${currentYear}
        `;
        const levelResult = await query(levelSql, false);
        const totalDeliveries = levelResult[0]?.TOTAL || 0;

        let level = 'BRONCE';
        let nextLevel = 'PLATA';
        let progress = 0.0;

        if (totalDeliveries < 100) {
            level = 'BRONCE';
            nextLevel = 'PLATA';
            progress = totalDeliveries / 100;
        } else if (totalDeliveries < 500) {
            level = 'PLATA';
            nextLevel = 'ORO';
            progress = (totalDeliveries - 100) / 400;
        } else if (totalDeliveries < 2000) {
            level = 'ORO';
            nextLevel = 'PLATINO';
            progress = (totalDeliveries - 500) / 1500;
        } else {
            level = 'PLATINO';
            nextLevel = 'DIAMANTE';
            progress = 1.0;
        }

        // 2. Streak: Check last 7 days activity
        const streakSql = `
            SELECT DISTINCT DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO
            FROM DSEDAC.CPC
            WHERE TRIM(CODIGOREPARTIDOR) = '${repartidorId}'
              AND CONCAT(ANODOCUMENTO, CONCAT(RIGHT('0' || MESDOCUMENTO, 2), RIGHT('0' || DIADOCUMENTO, 2))) >= 
                  '${moment().subtract(7, 'days').format('YYYYMMDD')}'
        `;
        const streakResult = await query(streakSql, false);
        const streakDays = streakResult.length; // Approximate active days in last week

        return { level, nextLevel, progress, streakDays, totalDeliveries };
    } catch (e) {
        logger.error(`Error calculating gamification: ${e.message}`);
        return { level: 'BRONCE', nextLevel: 'PLATA', progress: 0, streakDays: 0, totalDeliveries: 0 };
    }
}

// --- HELPER: Get Heuristic AI Suggestions ---
function getSmartSuggestions(albaranes) {
    const suggestions = [];

    // 1. Cash Alert
    const totalCash = albaranes
        .filter(a => a.esCTR)
        .reduce((sum, a) => sum + (a.importe || 0), 0);

    if (totalCash > 1000) {
        suggestions.push(`⚠️ Llevas ${totalCash.toFixed(0)}€ en efectivo. Considera hacer un ingreso.`);
    } else if (totalCash > 500) {
        suggestions.push(`ℹ️ Acumulas ${totalCash.toFixed(0)}€ en cobros.`);
    }

    // 2. Urgent Deliveries
    const urgentCount = albaranes.filter(a => a.esCTR).length;
    if (urgentCount > 3) {
        suggestions.push(`🔥 Tienes ${urgentCount} clientes con cobro obligatorio prioritario.`);
    }

    // 3. Efficiency (Duplicate clients)
    const clientCounts = {};
    albaranes.forEach(a => {
        clientCounts[a.nombreCliente] = (clientCounts[a.nombreCliente] || 0) + 1;
    });
    const multiDrop = Object.entries(clientCounts).find(([_, count]) => count > 1);
    if (multiDrop) {
        suggestions.push(`📦 ${multiDrop[0]} tiene ${multiDrop[1]} entregas. ¡Agrúpalas!`);
    }

    return suggestions.length > 0 ? suggestions[0] : null; // Return top suggestion
}

// ===================================
// GET /pendientes/:repartidorId
// ===================================
router.get('/pendientes/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { date } = req.query; // Support ?date=YYYY-MM-DD

        let targetDate = new Date();
        if (date) {
            targetDate = new Date(date);
        }

        const dia = targetDate.getDate();
        const mes = targetDate.getMonth() + 1;
        const ano = targetDate.getFullYear();

        logger.info(`[ENTREGAS] Getting pending deliveries for repartidor ${repartidorId} (${dia}/${mes}/${ano})`);

        // Handle multiple IDs (comma separated) case
        const ids = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');

        // Load payment conditions from JAVIER.PAYMENT_CONDITIONS table
        let paymentConditions = {};
        try {
            const pcRows = await query(`
                SELECT CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, COLOR
                FROM JAVIER.PAYMENT_CONDITIONS
                WHERE ACTIVO = 'S'
            `, false);

            pcRows.forEach(pc => {
                const code = (pc.CODIGO || '').trim();
                paymentConditions[code] = {
                    desc: (pc.DESCRIPCION || '').trim(),
                    type: (pc.TIPO || 'CREDITO').trim(),
                    diasPago: pc.DIAS_PAGO || 0,
                    mustCollect: pc.DEBE_COBRAR === 'S',
                    canCollect: pc.PUEDE_COBRAR === 'S',
                    color: (pc.COLOR || 'green').trim()
                };
            });
            logger.info(`[ENTREGAS] Loaded ${Object.keys(paymentConditions).length} payment conditions from DB`);
        } catch (pcError) {
            logger.warn(`[ENTREGAS] Could not load PAYMENT_CONDITIONS: ${pcError.message}, using defaults`);
        }

        const DEFAULT_PAYMENT = { desc: 'CRÉDITO', type: 'CREDITO', diasPago: 30, mustCollect: false, canCollect: false, color: 'green' };

        // CORRECTO: Usar OPP → CPC → CAC para repartidores
        // OPP tiene CODIGOREPARTIDOR, CPC vincula con CAC
        // IMPORTANTE: Usar IMPORTEBRUTO (sin IVA) para cobros
        // FIX: ID format must match exactly with frontend and update endpoint
        const sql = `
            SELECT 
              CAC.SUBEMPRESAALBARAN,
              CAC.EJERCICIOALBARAN,
              CAC.SERIEALBARAN,
              CAC.TERMINALALBARAN,
              CAC.NUMEROALBARAN,
              CAC.NUMEROFACTURA,
              CAC.SERIEFACTURA,
              TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
              TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, 'CLIENTE')) as NOMBRE_CLIENTE,
              TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCION,
              TRIM(COALESCE(CLI.POBLACION, '')) as POBLACION,
              TRIM(COALESCE(CLI.TELEFONO1, '')) as TELEFONO,
              CPC.IMPORTEBRUTO,
              TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
              CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
              TRIM(CPC.CODIGORUTA) as RUTA,
              TRIM(OPP.CODIGOREPARTIDOR) as CODIGO_REPARTIDOR,
              DS.STATUS as DS_STATUS,
              DS.OBSERVACIONES as DS_OBS,
              DS.FIRMA_PATH as DS_FIRMA
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
              ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
              ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
              AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
              AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
              AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            LEFT JOIN JAVIER.DELIVERY_STATUS DS 
              ON DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(COALESCE(CPC.SERIEALBARAN, '')) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${ids})
              AND OPP.DIAREPARTO = ${dia}
              AND OPP.MESREPARTO = ${mes}
              AND OPP.ANOREPARTO = ${ano}
            ORDER BY CAC.NUMEROALBARAN
        `;

        // Table initialization removed to prevent AS400 errors.
        // Tables JAVIER.DELIVERY_STATUS and JAVIER.CLIENT_SIGNERS are assumed to exist.

        let rows = [];
        try {
            rows = await query(sql, false) || [];
        } catch (queryError) {
            logger.error(`[ENTREGAS] Query error in pendientes: ${queryError.message}`);
            return res.json({ success: true, albaranes: [], total: 0 });
        }

        // --- DEDUPLICATION ---
        //Group by Albaran ID to prevent duplicates from multiple OPP rows
        const uniqueMap = new Map();
        rows.forEach(row => {
            // FIX: Ensure ID matches the one used in JOIN (Trimmed Series)
            const serie = (row.SERIEALBARAN || '').trim();
            const id = `${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`;
            if (!uniqueMap.has(id)) {
                uniqueMap.set(id, row);
            }
        });
        const uniqueRows = Array.from(uniqueMap.values());

        // Process rows
        const albaranes = uniqueRows.map(row => {
            const fp = (row.FORMA_PAGO || '').toUpperCase().trim();

            // Try robust matching
            let paymentInfo = paymentConditions[fp] || paymentConditions[parseInt(fp).toString()]; // Try '01' vs '1'
            if (!paymentInfo) paymentInfo = DEFAULT_PAYMENT;

            // Determine if repartidor MUST collect money
            // Fallback: If DB config is default/false, check string patterns (Legacy Logic)
            let esCTR = paymentInfo.mustCollect;
            let puedeCobrarse = paymentInfo.canCollect;

            // Debug specific rows to see why logic fails
            if (rows.length < 5 || Math.random() < 0.05) {
                logger.info(`[ENTREGAS_DEBUG] Albaran: ${row.NUMEROALBARAN}, FP: '${fp}', Info: ${JSON.stringify(paymentInfo)}, esCTR: ${esCTR}`);
            }

            if (!paymentInfo.mustCollect && !paymentInfo.canCollect && paymentInfo === DEFAULT_PAYMENT) {
                if (fp === 'CTR' || fp.includes('CONTADO') || fp.includes('METALICO')) {
                    esCTR = true;
                    puedeCobrarse = true;
                } else if (fp.includes('REP') || fp.includes('MENSUAL')) {
                    // Check specific logic? Assume optional for now or none
                }
            }
            // Ensure consistency
            if (esCTR) puedeCobrarse = true;

            const numeroFactura = row.NUMEROFACTURA || 0;
            const serieFactura = (row.SERIEFACTURA || '').trim();
            const esFactura = numeroFactura > 0;

            // Robust Money Parser
            const parseMoney = (val) => {
                if (val === null || val === undefined) return 0;
                if (typeof val === 'number') return val;

                // Convert to string
                const str = val.toString();

                // If it looks like '1.200,50' (European): remove dots, replace comma with dot
                if (str.includes(',') && str.includes('.')) {
                    // Assume dot is thousand separator if it appears before comma
                    if (str.indexOf('.') < str.indexOf(',')) {
                        return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
                    }
                }

                // If it has only comma '120,50', replace with dot
                if (str.includes(',') && !str.includes('.')) {
                    return parseFloat(str.replace(',', '.')) || 0;
                }

                // If it has only dot '120.50' or '1200', just parse
                return parseFloat(str) || 0;
            };

            const importeParsed = parseMoney(row.IMPORTEBRUTO);

            const serie = (row.SERIEALBARAN || '').trim();

            return {
                id: `${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`,
                subempresa: row.SUBEMPRESAALBARAN,
                ejercicio: row.EJERCICIOALBARAN,
                serie: serie,
                terminal: row.TERMINALALBARAN,
                numero: row.NUMEROALBARAN,
                numeroFactura: numeroFactura,
                serieFactura: serieFactura,
                documentoTipo: esFactura ? 'FACTURA' : 'ALBARÁN',
                codigoCliente: row.CLIENTE?.trim(),
                nombreCliente: row.NOMBRE_CLIENTE?.trim(),
                direccion: row.DIRECCION?.trim(),
                poblacion: row.POBLACION?.trim(),
                telefono: row.TELEFONO?.trim(),
                importe: parseFloat(row.IMPORTEBRUTO) || 0,
                formaPago: fp,
                formaPagoDesc: paymentInfo.desc,
                tipoPago: paymentInfo.type,
                diasPago: paymentInfo.diasPago,
                esCTR: esCTR,
                puedeCobrarse: puedeCobrarse,
                colorEstado: paymentInfo.color,
                fecha: `${row.DIADOCUMENTO}/${row.MESDOCUMENTO}/${row.ANODOCUMENTO}`,
                ruta: row.RUTA?.trim(),
                codigoRepartidor: row.CODIGO_REPARTIDOR?.trim() || '',
                estado: (row.DS_STATUS || 'PENDIENTE').trim(),
                observaciones: row.DS_OBS,
                firma: row.DS_FIRMA
            };
        });

        // --- FILTERING: Search by client name, code, albarán or factura number ---
        const searchQuery = req.query.search?.toLowerCase().trim() || '';
        let filteredAlbaranes = albaranes;
        if (searchQuery) {
            filteredAlbaranes = albaranes.filter(a =>
                a.nombreCliente?.toLowerCase().includes(searchQuery) ||
                a.codigoCliente?.toLowerCase().includes(searchQuery) ||
                String(a.numeroAlbaran).includes(searchQuery) ||
                String(a.numeroFactura).includes(searchQuery)
            );
        }

        // --- FILTER BY PAYMENT TYPE ---
        const filterTipo = req.query.tipoPago || ''; // e.g., 'CONTADO', 'CREDITO', 'DOMICILIADO'
        if (filterTipo) {
            filteredAlbaranes = filteredAlbaranes.filter(a =>
                a.tipoPago?.toUpperCase() === filterTipo.toUpperCase()
            );
        }

        // --- FILTER BY COLLECTION STATUS ---
        const filterCobrar = req.query.debeCobrar; // 'S' or 'N'
        if (filterCobrar === 'S') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.esCTR === true);
        } else if (filterCobrar === 'N') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.esCTR === false);
        }

        // --- FILTER BY DOCUMENT TYPE (ALBARAN/FACTURA) ---
        const filterDocTipo = req.query.docTipo; // 'ALBARAN' or 'FACTURA'
        if (filterDocTipo === 'ALBARAN') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.documentoTipo === 'ALBARÁN');
        } else if (filterDocTipo === 'FACTURA') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.documentoTipo === 'FACTURA');
        }

        // --- SORTING ---
        const sortBy = req.query.sortBy || 'default'; // 'default', 'importe_asc', 'importe_desc'
        if (sortBy === 'importe_desc') {
            filteredAlbaranes.sort((a, b) => b.importe - a.importe);
        } else if (sortBy === 'importe_asc') {
            filteredAlbaranes.sort((a, b) => a.importe - b.importe);
        }
        // 'default' keeps the original ORDER BY CAC.NUMEROALBARAN from SQL

        // Calculate totals for summary (always from unfiltered `albaranes` for accurate KPIs)
        const totalBruto = albaranes.reduce((sum, a) => sum + (a.importe || 0), 0);
        const totalACobrar = albaranes.filter(a => a.esCTR).reduce((sum, a) => sum + (a.importe || 0), 0);
        const totalOpcional = albaranes.filter(a => a.puedeCobrarse && !a.esCTR).reduce((sum, a) => sum + (a.importe || 0), 0);
        const completedCount = albaranes.filter(a => a.estado === 'ENTREGADO').length;

        logger.info(`[ENTREGAS] Date=${targetDate.toISOString().split('T')[0]} Repartidor=${repartidorId} → albaranes=${filteredAlbaranes.length}, totalBruto=${totalBruto.toFixed(2)}, totalACobrar=${totalACobrar.toFixed(2)}, totalOpcional=${totalOpcional.toFixed(2)}, completed=${completedCount}`);

        res.json({
            success: true,
            albaranes: filteredAlbaranes,
            total: filteredAlbaranes.length,
            originalTotal: albaranes.length,
            resumen: {
                totalBruto: Math.round(totalBruto * 100) / 100,
                totalACobrar: Math.round(totalACobrar * 100) / 100,
                totalOpcional: Math.round(totalOpcional * 100) / 100,
                completedCount
            }
        });
    } catch (error) {
        logger.error(`Error in /pendientes: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// GET /payment-conditions - List available payment conditions
// ===================================
router.get('/payment-conditions', async (req, res) => {
    try {
        const conditions = await query(`
            SELECT CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, COLOR
            FROM JAVIER.PAYMENT_CONDITIONS
            WHERE ACTIVO = 'S'
            ORDER BY TIPO, CODIGO
        `, false);

        res.json({
            success: true,
            conditions: conditions.map(c => ({
                codigo: (c.CODIGO || '').trim(),
                descripcion: (c.DESCRIPCION || '').trim(),
                tipo: (c.TIPO || '').trim(),
                diasPago: c.DIAS_PAGO || 0,
                debeCobrar: c.DEBE_COBRAR === 'S',
                puedeCobrar: c.PUEDE_COBRAR === 'S',
                color: (c.COLOR || 'green').trim()
            }))
        });
    } catch (error) {
        logger.error(`Error in /payment-conditions: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// GET /albaran/:numero/:ejercicio
// ===================================
router.get('/albaran/:numero/:ejercicio', async (req, res) => {
    try {
        const { numero, ejercicio } = req.params;
        const serie = req.query.serie;
        const terminal = req.query.terminal;

        // 1. Build WHERE clause
        let whereClause = `CPC.NUMEROALBARAN = ${numero} AND CPC.EJERCICIOALBARAN = ${ejercicio}`;
        if (serie) whereClause += ` AND CPC.SERIEALBARAN = '${serie}'`;
        if (terminal) whereClause += ` AND CPC.TERMINALALBARAN = ${terminal}`;

        // 2. Get Header from CPC (consistent with list endpoint - uses IMPORTEBRUTO)
        const headerSql = `
            SELECT 
                CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                CPC.IMPORTEBRUTO as IMPORTE,
                CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as CLIENTE_NOM, 
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIR, 
                TRIM(COALESCE(CLI.POBLACION, '')) as POB,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA
            FROM DSEDAC.CPC CPC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            LEFT JOIN DSEDAC.CAC CAC ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE ${whereClause}
            FETCH FIRST 1 ROWS ONLY
        `;

        const headers = await query(headerSql, false);
        if (headers.length === 0) return res.status(404).json({ success: false, error: 'Albaran not found' });

        const header = headers[0];

        // 3. Get Items from LAC (Simplified for ODBC compatibility - NO ALIASES)
        // 3. Get Items from LAC (Super Simplified for ODBC)
        // Removed L alias completely to avoid "Error executing sql"
        let itemsSql = `
            SELECT *
            FROM DSEDAC.LAC
            WHERE NUMEROALBARAN = ${numero} AND EJERCICIOALBARAN = ${ejercicio}
        `;
        if (serie) itemsSql += ` AND SERIEALBARAN = '${serie}'`;
        if (terminal) itemsSql += ` AND TERMINALALBARAN = ${terminal}`;

        // Note: We use * because listing columns explicitly was failing. 
        // We will map carefully below.

        const items = await query(itemsSql, false);

        const albaran = {
            id: `${header.EJERCICIOALBARAN}-${(header.SERIEALBARAN || '').trim()}-${header.TERMINALALBARAN}-${header.NUMEROALBARAN}`,
            numeroAlbaran: header.NUMEROALBARAN,
            ejercicio: header.EJERCICIOALBARAN,
            serie: (header.SERIEALBARAN || '').trim(),
            terminal: header.TERMINALALBARAN,
            codigoCliente: header.CLIENTE,
            nombreCliente: header.CLIENTE_NOM,
            direccion: header.DIR,
            poblacion: header.POB,
            numeroFactura: header.NUMEROFACTURA || 0,
            serieFactura: (header.SERIEFACTURA || '').trim(),
            documentoTipo: (header.NUMEROFACTURA || 0) > 0 ? 'FACTURA' : 'ALBARÁN',
            fecha: `${header.DIADOCUMENTO}/${header.MESDOCUMENTO}/${header.ANODOCUMENTO}`,
            importe: parseFloat(header.IMPORTE) || 0,
            formaPago: (header.FORMA_PAGO || '').trim(),
            items: items.map(i => ({
                itemId: i.SECUENCIA,
                codigoArticulo: i.CODIGOARTICULO,
                descripcion: i.DESCRIPCION,
                cantidadPedida: parseFloat(i.CANTIDADUNIDADES) || 0,
                cantidadCajas: parseFloat(i.CANTIDADCAJAS) || 0,
                totalLinea: parseFloat(i.IMPORTEVENTA) || 0,
                unidad: i.UNIDADMEDIDA,
                precioUnitario: (parseFloat(i.CANTIDADUNIDADES) || 0) !== 0 ? (parseFloat(i.IMPORTEVENTA) || 0) / parseFloat(i.CANTIDADUNIDADES) : 0,
                cantidadEntregada: 0,
                estado: 'PENDIENTE'
            })),
            estado: 'PENDIENTE'
        };

        res.json({ success: true, albaran });
    } catch (error) {
        logger.error(`Error in /albaran: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// POST /update - Update delivery status with duplicate prevention
// ===================================
router.post('/update', async (req, res) => {
    try {
        const { itemId: reqItemId, albaranId, status, repartidorId, observaciones, firma, fotos, latitud, longitud, forceUpdate } = req.body;
        const itemId = reqItemId || albaranId; // Support both naming conventions

        if (!itemId) {
            return res.status(400).json({ success: false, error: 'Se requiere itemId o albaranId' });
        }

        logger.info(`[ENTREGAS] Updating ${itemId} to ${status} (Rep: ${repartidorId}, Force: ${forceUpdate || false})`);

        // VALIDATION: Check if already delivered (prevents accidental duplicate confirmations)
        if (status === 'ENTREGADO') {
            try {
                const checkSql = `SELECT STATUS, UPDATED_AT, REPARTIDOR_ID FROM JAVIER.DELIVERY_STATUS WHERE ID = '${itemId}'`;
                const existing = await query(checkSql, false);

                if (existing.length > 0 && existing[0].STATUS === 'ENTREGADO') {
                    // Already delivered - only allow if forceUpdate is true
                    if (!forceUpdate) {
                        logger.warn(`[ENTREGAS] ⚠️ Duplicate confirmation attempt for ${itemId} (previously by ${existing[0].REPARTIDOR_ID} at ${existing[0].UPDATED_AT})`);
                        return res.status(409).json({
                            success: false,
                            error: 'Esta entrega ya fue confirmada anteriormente',
                            alreadyDelivered: true,
                            previousRepartidor: existing[0].REPARTIDOR_ID,
                            previousDate: existing[0].UPDATED_AT
                        });
                    }
                    logger.info(`[ENTREGAS] Force update enabled for ${itemId}, overwriting previous delivery`);
                }
            } catch (checkErr) {
                // Table might not exist yet, continue with insert
                logger.warn(`[ENTREGAS] Check failed (table may not exist): ${checkErr.message}`);
            }
        }

        // Upsert into JAVIER.DELIVERY_STATUS
        // 1. Delete existing (if any)
        await query(`DELETE FROM JAVIER.DELIVERY_STATUS WHERE ID = '${itemId}'`, false);

        // 2. Insert new record
        const obsSafe = observaciones ? observaciones.replace(/'/g, "''") : '';
        const firmaSafe = firma ? firma.replace(/'/g, "''") : '';
        const lat = latitud || 0;
        const lon = longitud || 0;

        const insertSql = `
            INSERT INTO JAVIER.DELIVERY_STATUS 
            (ID, STATUS, OBSERVACIONES, FIRMA_PATH, LATITUD, LONGITUD, REPARTIDOR_ID, UPDATED_AT)
            VALUES ('${itemId}', '${status}', '${obsSafe}', '${firmaSafe}', ${lat}, ${lon}, '${repartidorId}', CURRENT TIMESTAMP)
        `;

        await query(insertSql, false);
        logger.info(`[ENTREGAS] ✅ Delivery ${itemId} updated to ${status} by ${repartidorId}`);

        res.json({ success: true, message: 'Estado actualizado correctamente' });
    } catch (error) {
        logger.error(`[ENTREGAS] Error in /update: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// POST /uploads/photo
// ===================================
router.post('/uploads/photo', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file' });
    res.json({ success: true, path: req.file.path });
});

// ===================================
// POST /uploads/signature
// ===================================
router.post('/uploads/signature', async (req, res) => {
    try {
        const { entregaId, firma, clientCode, dni, nombre } = req.body; // firma is base64
        if (!firma) return res.status(400).json({ success: false, error: 'No signature' });

        // Save base64 to file
        const base64Data = firma.replace(/^data:image\/png;base64,/, "");
        const fileName = `sig-${entregaId}-${Date.now()}.png`;
        const filePath = path.join(photosDir, fileName);

        require('fs').writeFileSync(filePath, base64Data, 'base64');

        // Save Signer Info (Upsert)
        if (clientCode && dni) {
            try {
                // Upsert logic (Delete + Insert is safest fallback)
                await queryWithParams(`
                    DELETE FROM JAVIER.CLIENT_SIGNERS 
                    WHERE CODIGOCLIENTE = ? AND DNI = ?
                `, [clientCode, dni], false, false);

                await queryWithParams(`
                    INSERT INTO JAVIER.CLIENT_SIGNERS (CODIGOCLIENTE, DNI, NOMBRE, LAST_USED, USAGE_COUNT)
                    VALUES (?, ?, ?, CURRENT DATE, 1)
                `, [clientCode, dni, nombre], false, true);

                logger.info(`[SIGN] Saved signer info for client ${clientCode}: ${dni} - ${nombre}`);
            } catch (dbError) {
                logger.warn(`[SIGN] Failed to save signer info: ${dbError.message}`);
                // Don't fail the request just for this
            }
        }

        res.json({ success: true, path: filePath });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// GET /signers/:clientCode
// ===================================
router.get('/signers/:clientCode', async (req, res) => {
    try {
        const { clientCode } = req.params;
        const rows = await queryWithParams(`
            SELECT DNI, NOMBRE
            FROM JAVIER.CLIENT_SIGNERS
            WHERE CODIGOCLIENTE = ?
            ORDER BY LAST_USED DESC
            FETCH FIRST 5 ROWS ONLY
        `, [clientCode]);

        res.json({ success: true, signers: rows });
    } catch (error) {
        logger.error(`Error get signers: ${error.message}`);
        res.json({ success: true, signers: [] }); // Fail graceful
    }
});

module.exports = router;
