const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query, queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const { sanitizeCodeList, sanitizeForSQL } = require('../utils/common');
const { isDeliveryStatusAvailable } = require('../utils/delivery-status-check');

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

        // Handle multiple IDs (comma separated) case - SECURITY: sanitize
        const ids = sanitizeCodeList(repartidorId);
        if (!ids) {
            return res.status(400).json({ error: 'Invalid repartidor ID format' });
        }

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
        // Check if requested date is in the past (all deliveries assumed completed)
        const today = new Date();
        const todayNum = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
        const requestNum = ano * 10000 + mes * 100 + dia;
        const isPastDate = requestNum < todayNum;

        // Conditionally include DELIVERY_STATUS join (table may not exist)
        const dsAvailable = isDeliveryStatusAvailable();
        const dsJoin = dsAvailable ? `
            LEFT JOIN JAVIER.DELIVERY_STATUS DS
              ON DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(COALESCE(CPC.SERIEALBARAN, '')) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10))) || '-' || TRIM(CPC.CODIGOCLIENTEALBARAN)` : '';
        const dsColumns = dsAvailable
            ? `DS.STATUS as DS_STATUS,
              DS.OBSERVACIONES as DS_OBS,
              DS.FIRMA_PATH as DS_FIRMA`
            : `CAST(NULL AS VARCHAR(20)) as DS_STATUS,
              CAST(NULL AS VARCHAR(512)) as DS_OBS,
              CAST(NULL AS VARCHAR(255)) as DS_FIRMA`;

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
              TRIM(COALESCE(CLI.TELEFONO2, '')) as TELEFONO2,
              CPC.IMPORTETOTAL,
              CPC.IMPORTEBRUTO,
              CPC.IMPORTEBASEIMPONIBLE1 as CPC_BASE1,
              CPC.IMPORTEBASEIMPONIBLE2 as CPC_BASE2,
              CPC.IMPORTEBASEIMPONIBLE3 as CPC_BASE3,
              CPC.PORCENTAJEIVA1 as CPC_PCTIVA1,
              CPC.PORCENTAJEIVA2 as CPC_PCTIVA2,
              CPC.PORCENTAJEIVA3 as CPC_PCTIVA3,
              CPC.IMPORTEIVA1 as CPC_IVA1,
              CPC.IMPORTEIVA2 as CPC_IVA2,
              CPC.IMPORTEIVA3 as CPC_IVA3,
              TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
              CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
              TRIM(CPC.CODIGORUTA) as RUTA,
              TRIM(OPP.CODIGOREPARTIDOR) as CODIGO_REPARTIDOR,
              CPC.DIALLEGADA, CPC.HORALLEGADA,
              TRIM(CPC.CONFORMADOSN) as CONFORMADO,
              ${dsColumns}
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC
              ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC
              ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
              AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
              AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
              AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            ${dsJoin}
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

        // --- DEDUPLICATION & AGGREGATION ---
        // Group by Albaran ID + Client and SUM financial fields
        const aggregatedMap = new Map();
        rows.forEach(row => {
            const serie = (row.SERIEALBARAN || '').trim();
            const cliente = (row.CLIENTE || '').trim();
            const id = `${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}-${cliente}`;

            if (!aggregatedMap.has(id)) {
                // Initialize with a copy to avoid mutating original row
                aggregatedMap.set(id, { ...row });
            } else {
                const existing = aggregatedMap.get(id);
                // Sum financial fields
                existing.IMPORTETOTAL = (parseFloat(existing.IMPORTETOTAL) || 0) + (parseFloat(row.IMPORTETOTAL) || 0);
                existing.IMPORTEBRUTO = (parseFloat(existing.IMPORTEBRUTO) || 0) + (parseFloat(row.IMPORTEBRUTO) || 0);
                existing.CPC_BASE1 = (parseFloat(existing.CPC_BASE1) || 0) + (parseFloat(row.CPC_BASE1) || 0);
                existing.CPC_BASE2 = (parseFloat(existing.CPC_BASE2) || 0) + (parseFloat(row.CPC_BASE2) || 0);
                existing.CPC_BASE3 = (parseFloat(existing.CPC_BASE3) || 0) + (parseFloat(row.CPC_BASE3) || 0);
                existing.CPC_IVA1 = (parseFloat(existing.CPC_IVA1) || 0) + (parseFloat(row.CPC_IVA1) || 0);
                existing.CPC_IVA2 = (parseFloat(existing.CPC_IVA2) || 0) + (parseFloat(row.CPC_IVA2) || 0);
                existing.CPC_IVA3 = (parseFloat(existing.CPC_IVA3) || 0) + (parseFloat(row.CPC_IVA3) || 0);
                // Keep the latest status/info if they differ? 
                // Usually status is the same per Albaran ID.
            }
        });
        const uniqueRows = Array.from(aggregatedMap.values());

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
                logger.debug(`[ENTREGAS_DEBUG] Albaran: ${row.NUMEROALBARAN}, FP: '${fp}', Info: ${JSON.stringify(paymentInfo)}, esCTR: ${esCTR}`);
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

            // --- DELIVERY STATUS LOGIC (HYBRID SENIOR STATUS v2) ---
            // Priority: 1) DELIVERY_STATUS (App confirmation - Real Time)
            //           2) Legacy CONFORMADOSN == 'S' (Paper confirmation processed)
            //           3) Today + DIALLEGADA (Legacy "On Route" - Loaded but not confirmed)
            //           4) Default (Pending)

            let status = (row.DS_STATUS || '').trim();
            const legacyConfirmed = (row.CONFORMADOSN || '').trim() === 'S';

            if (!status || status === '') {
                if (legacyConfirmed) {
                    status = 'ENTREGADO'; // Legacy Confirmed
                } else if (isPastDate) {
                    // Fallback for past dates if CONFORMADOSN is missing but date implies done?
                    // Verify if we should trust Date alone for past. 
                    // User said "Past = Delivered" usually manually. 
                    // Let's keep PastDate as backup ONLY if > 2 days? 
                    // Actually, if Yesterday is 'S', then usually PastDate has S. 
                    // If PastDate has NO S, maybe it's "No Entregado"?
                    // Safe bet: Trust 'S'. If not 'S' and Past Date -> 'ENTREGADO' (Assumption) OR 'NO_ENTREGADO'?
                    // The user said "antes salia 100%". 
                    // Let's stick to "Past Date = Delivered" as a safety net for now, 
                    // but 'S' allows intra-day update!
                    status = 'ENTREGADO';
                } else if (row.DIALLEGADA > 0) {
                    status = 'EN_RUTA';   // Today + Planned + Not Confirmed = On Route
                } else {
                    status = 'PENDIENTE';
                }
            }

            // --- COLOR LOGIC ---
            let colorEstado = 'green';
            if (status === 'ENTREGADO') {
                colorEstado = 'green';
            } else {
                if (esFactura) {
                    colorEstado = 'purple';
                } else if (esCTR || puedeCobrarse) {
                    colorEstado = 'red';
                } else {
                    colorEstado = 'green';
                }
            }

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

            // Use IMPORTETOTAL (correct final amount incl. IVA) instead of IMPORTEBRUTO (gross pre-discount)
            let importeTotal = parseMoney(row.IMPORTETOTAL);
            // AUDIT FIX: Sanitize sentinel amounts
            if (Math.abs(importeTotal) >= 900000 || Object.is(importeTotal, -0)) {
                importeTotal = 0;
            }
            const importeBruto = parseMoney(row.IMPORTEBRUTO);

            // IVA breakdown from CPC (up to 3 tax bases)
            const base1 = parseMoney(row.CPC_BASE1);
            const base2 = parseMoney(row.CPC_BASE2);
            const base3 = parseMoney(row.CPC_BASE3);
            const pctIva1 = parseMoney(row.CPC_PCTIVA1);
            const pctIva2 = parseMoney(row.CPC_PCTIVA2);
            const pctIva3 = parseMoney(row.CPC_PCTIVA3);
            const iva1 = parseMoney(row.CPC_IVA1);
            const iva2 = parseMoney(row.CPC_IVA2);
            const iva3 = parseMoney(row.CPC_IVA3);

            const netoSum = Math.round((base1 + base2 + base3) * 100) / 100;
            const ivaSum = Math.round((iva1 + iva2 + iva3) * 100) / 100;

            // Build IVA breakdown array (only non-zero bases)
            const ivaBreakdown = [];
            if (base1 > 0) ivaBreakdown.push({ base: base1, pct: pctIva1, iva: iva1 });
            if (base2 > 0) ivaBreakdown.push({ base: base2, pct: pctIva2, iva: iva2 });
            if (base3 > 0) ivaBreakdown.push({ base: base3, pct: pctIva3, iva: iva3 });

            const serie = (row.SERIEALBARAN || '').trim();
            const cliente = (row.CLIENTE || '').trim();

            return {
                id: `${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}-${cliente}`,
                subempresa: row.SUBEMPRESAALBARAN,
                ejercicio: row.EJERCICIOALBARAN,
                serie: serie,
                terminal: row.TERMINALALBARAN,
                numero: row.NUMEROALBARAN,
                numeroFactura: numeroFactura,
                serieFactura: serieFactura,
                documentoTipo: esFactura ? 'FACTURA' : 'ALBARÁN',
                codigoCliente: cliente,
                nombreCliente: row.NOMBRE_CLIENTE?.trim(),
                direccion: row.DIRECCION?.trim(),
                poblacion: row.POBLACION?.trim(),
                telefono: row.TELEFONO?.trim(),
                telefono2: row.TELEFONO2?.trim() || '',
                importe: importeTotal,
                importeBruto: importeBruto,
                netoSum: netoSum,
                ivaSum: ivaSum,
                ivaBreakdown: ivaBreakdown,
                checksum: `${Math.round((netoSum + ivaSum) * 100) / 100}`,
                formaPago: fp,
                formaPagoDesc: paymentInfo.desc,
                tipoPago: paymentInfo.type,
                diasPago: paymentInfo.diasPago,
                esCTR: esCTR,
                puedeCobrarse: puedeCobrarse,
                colorEstado: colorEstado,
                fecha: `${row.DIADOCUMENTO}/${row.MESDOCUMENTO}/${row.ANODOCUMENTO}`,
                ruta: row.RUTA?.trim(),
                codigoRepartidor: row.CODIGO_REPARTIDOR?.trim() || '',
                estado: status,
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

        // --- SPECIFIC FILTERS (Split Search) ---
        const searchClient = req.query.searchClient?.toLowerCase().trim() || '';
        if (searchClient) {
            filteredAlbaranes = filteredAlbaranes.filter(a =>
                a.nombreCliente?.toLowerCase().includes(searchClient) ||
                a.codigoCliente?.toLowerCase().includes(searchClient)
            );
        }

        const searchAlbaran = req.query.searchAlbaran?.trim() || '';
        if (searchAlbaran) {
            filteredAlbaranes = filteredAlbaranes.filter(a =>
                String(a.numeroAlbaran).includes(searchAlbaran) ||
                String(a.numeroFactura).includes(searchAlbaran)
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

        // 2. Get Header from CPC (uses IMPORTETOTAL - correct final amount)
        const headerSql = `
            SELECT
                CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                CPC.IMPORTETOTAL as IMPORTE,
                CPC.IMPORTEBRUTO as IMPORTE_BRUTO,
                CPC.IMPORTEBASEIMPONIBLE1 as CPC_BASE1,
                CPC.IMPORTEBASEIMPONIBLE2 as CPC_BASE2,
                CPC.IMPORTEBASEIMPONIBLE3 as CPC_BASE3,
                CPC.PORCENTAJEIVA1 as CPC_PCTIVA1,
                CPC.PORCENTAJEIVA2 as CPC_PCTIVA2,
                CPC.PORCENTAJEIVA3 as CPC_PCTIVA3,
                CPC.IMPORTEIVA1 as CPC_IVA1,
                CPC.IMPORTEIVA2 as CPC_IVA2,
                CPC.IMPORTEIVA3 as CPC_IVA3,
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

        // AGGREGATE: If multiple CPC rows exist for the same Albaran detail request
        // Sum the financial fields across all matching rows
        const header = { ...headers[0] };
        if (headers.length > 1) {
            header.IMPORTE = 0;
            header.IMPORTE_BRUTO = 0;
            header.CPC_BASE1 = 0; header.CPC_BASE2 = 0; header.CPC_BASE3 = 0;
            header.CPC_IVA1 = 0; header.CPC_IVA2 = 0; header.CPC_IVA3 = 0;

            headers.forEach(h => {
                header.IMPORTE += (parseFloat(h.IMPORTE) || 0);
                header.IMPORTE_BRUTO += (parseFloat(h.IMPORTE_BRUTO) || 0);
                header.CPC_BASE1 += (parseFloat(h.CPC_BASE1) || 0);
                header.CPC_BASE2 += (parseFloat(h.CPC_BASE2) || 0);
                header.CPC_BASE3 += (parseFloat(h.CPC_BASE3) || 0);
                header.CPC_IVA1 += (parseFloat(h.CPC_IVA1) || 0);
                header.CPC_IVA2 += (parseFloat(h.CPC_IVA2) || 0);
                header.CPC_IVA3 += (parseFloat(h.CPC_IVA3) || 0);
            });
        }

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

        // IVA breakdown for detail
        const base1 = parseFloat(header.CPC_BASE1) || 0;
        const base2 = parseFloat(header.CPC_BASE2) || 0;
        const base3 = parseFloat(header.CPC_BASE3) || 0;
        const pctIva1 = parseFloat(header.CPC_PCTIVA1) || 0;
        const pctIva2 = parseFloat(header.CPC_PCTIVA2) || 0;
        const pctIva3 = parseFloat(header.CPC_PCTIVA3) || 0;
        const iva1 = parseFloat(header.CPC_IVA1) || 0;
        const iva2 = parseFloat(header.CPC_IVA2) || 0;
        const iva3 = parseFloat(header.CPC_IVA3) || 0;
        const netoSum = Math.round((base1 + base2 + base3) * 100) / 100;
        const ivaSum = Math.round((iva1 + iva2 + iva3) * 100) / 100;
        const ivaBreakdown = [];
        if (base1 > 0) ivaBreakdown.push({ base: base1, pct: pctIva1, iva: iva1 });
        if (base2 > 0) ivaBreakdown.push({ base: base2, pct: pctIva2, iva: iva2 });
        if (base3 > 0) ivaBreakdown.push({ base: base3, pct: pctIva3, iva: iva3 });

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
            importeBruto: parseFloat(header.IMPORTE_BRUTO) || 0,
            netoSum: netoSum,
            ivaSum: ivaSum,
            ivaBreakdown: ivaBreakdown,
            checksum: `${Math.round((netoSum + ivaSum) * 100) / 100}`,
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

        if (!itemId || !status || !repartidorId) {
            return res.status(400).json({ success: false, error: 'Faltan datos obligatorios: itemId, status, repartidorId' });
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
        // AUDIT FIX: Save old state for recovery before delete
        let previousState = null;
        try {
            const prev = await queryWithParams(`SELECT * FROM JAVIER.DELIVERY_STATUS WHERE ID = ?`, [itemId]);
            if (prev.length > 0) previousState = prev[0];
        } catch (_) {}

        // 1. Delete existing (if any)
        await queryWithParams(`DELETE FROM JAVIER.DELIVERY_STATUS WHERE ID = ?`, [itemId]);

        // 2. Insert new record
        const lat = latitud || 0;
        const lon = longitud || 0;

        // Identify who is performing the update
        // repartidorId from body = the actual repartidor who did the delivery
        // req.user.code = who is logged in (could be Jefe viewing as repartidor)
        // Always store the ACTUAL repartidor from the body, not the logged-in user
        let inspectorId = repartidorId;

        // Safety truncation
        if (inspectorId && inspectorId.length > 20) {
            inspectorId = inspectorId.substring(0, 20);
        }

        try {
            await queryWithParams(`
                INSERT INTO JAVIER.DELIVERY_STATUS 
                (ID, STATUS, OBSERVACIONES, FIRMA_PATH, LATITUD, LONGITUD, REPARTIDOR_ID, UPDATED_AT)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)
            `, [itemId, status, observaciones || '', firma || '', lat, lon, inspectorId]);
        } catch (insertErr) {
            // AUDIT FIX: Restore previous state if INSERT fails after DELETE
            logger.error(`[ENTREGAS] INSERT failed for ${itemId}: ${insertErr.message}`);
            if (previousState) {
                try {
                    await queryWithParams(`
                        INSERT INTO JAVIER.DELIVERY_STATUS
                        (ID, STATUS, OBSERVACIONES, FIRMA_PATH, LATITUD, LONGITUD, REPARTIDOR_ID, UPDATED_AT)
                        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)
                    `, [
                        previousState.ID, previousState.STATUS,
                        previousState.OBSERVACIONES || '',
                        previousState.FIRMA_PATH || '',
                        previousState.LATITUD || 0, previousState.LONGITUD || 0,
                        previousState.REPARTIDOR_ID || ''
                    ]);
                    logger.warn(`[ENTREGAS] Restored previous state for ${itemId}`);
                } catch (restoreErr) {
                    logger.error(`[ENTREGAS] CRITICAL: Could not restore ${itemId}: ${restoreErr.message}`);
                }
            }
            throw insertErr;
        }
        logger.info(`[ENTREGAS] ✅ Delivery ${itemId} updated to ${status} by ${inspectorId} (ReqRep: ${repartidorId})`);

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

        // Create organized directory structure: /uploads/photos/YYYY/MM/
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');

        const organizedDir = path.join(photosDir, year, month);
        if (!fs.existsSync(organizedDir)) {
            fs.mkdirSync(organizedDir, { recursive: true });
        }

        // Clean entregaId for filename (replace special chars)
        const safeEntregaId = (entregaId || 'unknown').toString().replace(/[^a-zA-Z0-9-]/g, '_');
        const safeClientCode = (clientCode || 'CLI').toString().replace(/[^a-zA-Z0-9]/g, '');

        // Filename format: FIRMA_YYYY-MM-DD_ClientCode_EntregaId_Timestamp.png
        // Example: FIRMA_2026-02-05_12345_2026-A-1-999_1707123456789.png
        const fileName = `FIRMA_${year}-${month}-${day}_${safeClientCode}_${safeEntregaId}_${Date.now()}.png`;
        const filePath = path.join(organizedDir, fileName);

        // Relative path for database storage (easier for migrations)
        const relativePath = `${year}/${month}/${fileName}`;

        // Save base64 to file
        const base64Data = firma.replace(/^data:image\/png;base64,/, "");
        fs.writeFileSync(filePath, base64Data, 'base64');

        logger.info(`[SIGN] Saved signature: ${relativePath} for delivery ${entregaId}`);

        // Save Signer Info (Upsert)
        if (clientCode && dni) {
            try {
                // Upsert logic (Delete + Insert is safest fallback)
                const safeClientCode = clientCode.replace(/[^a-zA-Z0-9]/g, '');
                const safeDni = dni.replace(/[^a-zA-Z0-9]/g, '');
                const safeNombre = sanitizeForSQL(nombre || '');
                await queryWithParams(`
                    DELETE FROM JAVIER.CLIENT_SIGNERS 
                    WHERE CODIGOCLIENTE = ? AND DNI = ?
                `, [safeClientCode, safeDni]);

                await queryWithParams(`
                    INSERT INTO JAVIER.CLIENT_SIGNERS (CODIGOCLIENTE, DNI, NOMBRE, LAST_USED, USAGE_COUNT)
                    VALUES (?, ?, ?, CURRENT DATE, 1)
                `, [safeClientCode, safeDni, safeNombre]);

                logger.info(`[SIGN] Saved signer info for client ${clientCode}: ${dni} - ${nombre}`);
            } catch (dbError) {
                logger.warn(`[SIGN] Failed to save signer info: ${dbError.message}`);
                // Don't fail the request just for this
            }
        }

        // Return relative path (more portable) and full path
        res.json({ success: true, path: relativePath, fullPath: filePath });
    } catch (error) {
        logger.error(`[SIGN] Error saving signature: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// GET /signers/:clientCode
// ===================================
router.get('/signers/:clientCode', async (req, res) => {
    try {
        const { clientCode } = req.params;
        const safeCode = clientCode.replace(/[^a-zA-Z0-9]/g, '');
        const rows = await query(`
            SELECT DNI, NOMBRE
            FROM JAVIER.CLIENT_SIGNERS
            WHERE CODIGOCLIENTE = '${safeCode}'
            ORDER BY LAST_USED DESC
            FETCH FIRST 5 ROWS ONLY
        `);

        res.json({ success: true, signers: rows });
    } catch (error) {
        logger.error(`Error get signers: ${error.message}`);
        res.json({ success: true, signers: [] }); // Fail graceful
    }
});

// ===================================
// POST /receipt/:entregaId - Generate delivery receipt PDF
// ===================================
router.post('/receipt/:entregaId', async (req, res) => {
    try {
        const { entregaId } = req.params;
        const { signaturePath, items, clientCode, clientName, albaranNum, facturaNum, fecha, subtotal, iva, total, formaPago, repartidor } = req.body;

        const { saveReceipt } = require('../app/services/deliveryReceiptService');

        // Parse entregaId to get DB identifiers: "EJERCICIO-SERIE-TERMINAL-NUMERO"
        const parts = entregaId.split('-');
        const ejercicio = parts[0] ? parseInt(parts[0]) : null;
        const serie = parts[1] || '';
        const terminal = parts[2] ? parseInt(parts[2]) : null;
        const numero = parts[3] ? parseInt(parts[3]) : null;

        const deliveryData = {
            ejercicio, serie, terminal, numero,
            albaranNum: albaranNum || `${ejercicio}/${serie}${String(terminal || 0).padStart(2, '0')}/${numero}`,
            facturaNum,
            clientCode,
            clientName,
            fecha,
            items: items || [],
            subtotal: subtotal || 0,
            iva: iva || 0,
            total: total || 0,
            formaPago,
            repartidor
        };

        // Resolve signature path if relative - SECURITY: prevent path traversal
        let fullSignaturePath = null;
        if (signaturePath) {
            // Validate no path traversal
            const normalizedSig = path.normalize(signaturePath).replace(/\\/g, '/');
            if (normalizedSig.includes('..') || path.isAbsolute(normalizedSig)) {
                logger.warn(`[RECEIPT] Rejected suspicious signature path: ${signaturePath}`);
                fullSignaturePath = null;
            } else {
                fullSignaturePath = path.join(photosDir, normalizedSig);
                // Verify resolved path is within photosDir
                const resolvedPath = path.resolve(fullSignaturePath);
                const resolvedBase = path.resolve(photosDir);
                if (!resolvedPath.startsWith(resolvedBase)) {
                    logger.warn(`[RECEIPT] Path traversal attempt blocked: ${signaturePath}`);
                    fullSignaturePath = null;
                } else {
                    logger.info(`[RECEIPT] Signature path: relative='${signaturePath}' full='${fullSignaturePath}' exists=${fs.existsSync(fullSignaturePath)}`);
                    if (!fs.existsSync(fullSignaturePath)) {
                        fullSignaturePath = null;
                        logger.warn(`[RECEIPT] Signature not found at path`);
                    }
                }
            }
        } else {
            logger.info(`[RECEIPT] No signature path provided for ${entregaId}`);
        }

        // Fallback: try to get signature base64 from DB if no file found
        if (!fullSignaturePath && ejercicio && numero) {
            try {
                const albId = `${ejercicio}-${(serie || '').trim()}-${terminal || 0}-${numero}`;
                // Try DELIVERY_STATUS
                const dsRows = await query(`SELECT FIRMA_PATH FROM JAVIER.DELIVERY_STATUS WHERE ID = '${albId}'`, false);
                if (dsRows.length > 0 && dsRows[0].FIRMA_PATH) {
                    const fpTest = path.join(photosDir, dsRows[0].FIRMA_PATH);
                    if (fs.existsSync(fpTest)) {
                        fullSignaturePath = fpTest;
                        logger.info(`[RECEIPT] Found signature via DELIVERY_STATUS: ${fpTest}`);
                    }
                }
                // Try REPARTIDOR_FIRMAS for base64 
                if (!fullSignaturePath) {
                    const firmaRows = await query(`
                        SELECT RF.FIRMA_BASE64, RF.FIRMANTE_NOMBRE FROM JAVIER.REPARTIDOR_FIRMAS RF
                        INNER JOIN JAVIER.REPARTIDOR_ENTREGAS RE ON RE.ID = RF.ENTREGA_ID
                        WHERE RE.NUMERO_ALBARAN = ${numero}
                          AND RE.EJERCICIO_ALBARAN = ${ejercicio}
                          AND RE.SERIE_ALBARAN = '${(serie || '').trim()}'
                        FETCH FIRST 1 ROW ONLY
                    `, false);
                    if (firmaRows.length > 0 && firmaRows[0].FIRMA_BASE64) {
                        deliveryData.signatureBase64 = firmaRows[0].FIRMA_BASE64;
                        deliveryData.firmante = firmaRows[0].FIRMANTE_NOMBRE || null;
                        logger.info(`[RECEIPT] Using base64 signature from REPARTIDOR_FIRMAS`);
                    }
                }
            } catch (e) {
                logger.warn(`[RECEIPT] DB signature fallback error: ${e.message}`);
            }
        }

        const result = await saveReceipt(deliveryData, fullSignaturePath);

        // Convert PDF to base64 for mobile sharing
        const pdfBase64 = result.buffer.toString('base64');

        logger.info(`[RECEIPT] Generated receipt for ${entregaId} (signature: ${fullSignaturePath ? 'YES' : 'NO'})`);
        res.json({
            success: true,
            pdfPath: result.relativePath,
            pdfBase64: pdfBase64,
            fileName: path.basename(result.filePath)
        });
    } catch (error) {
        logger.error(`[RECEIPT] Error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// POST /receipt/:entregaId/email - Send receipt via email
// ===================================
router.post('/receipt/:entregaId/email', async (req, res) => {
    try {
        const { entregaId } = req.params;
        const { email, signaturePath, items, clientCode, clientName, albaranNum, facturaNum, fecha, subtotal, iva, total, formaPago, repartidor } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const { saveReceipt } = require('../app/services/deliveryReceiptService');
        const { sendDeliveryReceipt } = require('../app/services/emailService');

        // Parse entregaId for DB lookup
        const parts = entregaId.split('-');
        const ejercicio = parts[0] ? parseInt(parts[0]) : null;
        const serie = parts[1] || '';
        const terminal = parts[2] ? parseInt(parts[2]) : null;
        const numero = parts[3] ? parseInt(parts[3]) : null;

        const deliveryData = {
            ejercicio, serie, terminal, numero,
            albaranNum: albaranNum || `${ejercicio}/${serie}${String(terminal || 0).padStart(2, '0')}/${numero}`,
            facturaNum,
            clientCode,
            clientName,
            fecha,
            items: items || [],
            subtotal: subtotal || 0,
            iva: iva || 0,
            total: total || 0,
            formaPago,
            repartidor
        };

        // Resolve signature path
        let fullSignaturePath = null;
        if (signaturePath) {
            fullSignaturePath = path.join(photosDir, signaturePath);
            if (!fs.existsSync(fullSignaturePath)) {
                if (fs.existsSync(signaturePath)) {
                    fullSignaturePath = signaturePath;
                } else {
                    fullSignaturePath = null;
                    logger.warn(`[RECEIPT-EMAIL] Signature not found: ${signaturePath}`);
                }
            }
        }

        const receipt = await saveReceipt(deliveryData, fullSignaturePath);

        // Send email
        const emailResult = await sendDeliveryReceipt(email, receipt.buffer, {
            albaranNum: facturaNum || albaranNum,
            clientName,
            total: (total || 0).toFixed(2),
            fecha
        });

        logger.info(`[RECEIPT] Email sent to ${email} for ${entregaId}`);
        res.json({ success: true, messageId: emailResult.messageId });
    } catch (error) {
        logger.error(`[RECEIPT] Email error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

