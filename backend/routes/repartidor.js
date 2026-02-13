/**
 * REPARTIDOR ROUTES
 * Backend endpoints for repartidor-specific functionality
 * - Collections (cobros) from DSEDAC.CAC/CVC
 * - Commissions with 30% threshold logic
 * - Historical deliveries and signatures
 */

const express = require('express');
const router = express.Router();
const { query, queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const { generateInvoicePDF } = require('../app/services/pdfService');
const { isDeliveryStatusAvailable } = require('../utils/delivery-status-check');

// Commission configuration (30% threshold for repartidores)
const REPARTIDOR_CONFIG = {
    threshold: 30.0, // 30% minimum to earn commission
    tiers: [
        { min: 100.01, max: 103.00, pct: 1.0 },
        { min: 103.01, max: 106.00, pct: 1.3 },
        { min: 106.01, max: 110.00, pct: 1.6 },
        { min: 110.01, max: 999.99, pct: 2.0 }
    ]
};

// =============================================================================
// GET /collections/summary/:repartidorId
// Resumen de cobros por cliente para un repartidor
// =============================================================================
router.get('/collections/summary/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, month } = req.query;

        // Validar repartidorId
        if (!repartidorId || repartidorId.trim() === '') {
            return res.json({
                success: true,
                repartidorId: repartidorId || '',
                period: { year: new Date().getFullYear(), month: new Date().getMonth() + 1 },
                summary: { totalCollectable: 0, totalCollected: 0, totalCommission: 0, overallPercentage: 0, thresholdMet: false, clientCount: 0 },
                clients: []
            });
        }

        const selectedYear = parseInt(year) || new Date().getFullYear();
        const selectedMonth = parseInt(month) || new Date().getMonth() + 1;
        const cleanRepartidorId = repartidorId.toString().trim();

        logger.info(`[REPARTIDOR] Getting collections summary for ${cleanRepartidorId} (${selectedMonth}/${selectedYear})`);

        // CORRECTO: Usar OPP → CPC → CAC para repartidores
        // OPP tiene CODIGOREPARTIDOR, CPC vincula con documentos de CAC
        const sql = `
            SELECT 
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE,
                CPC.CODIGOFORMAPAGO as FORMA_PAGO,
                SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 
                    THEN CPC.IMPORTETOTAL 
                    ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
                END) as TOTAL_COBRADO,
                COUNT(*) as NUM_DOCUMENTOS
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE OPP.MESREPARTO = ${selectedMonth}
              AND OPP.ANOREPARTO = ${selectedYear}
              AND TRIM(OPP.CODIGOREPARTIDOR) = '${cleanRepartidorId}'
            GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')), CPC.CODIGOFORMAPAGO
            ORDER BY TOTAL_COBRABLE DESC
            FETCH FIRST 100 ROWS ONLY
        `;

        let rows = [];
        try {
            rows = await query(sql, true, false) || [];
        } catch (queryError) {
            logger.warn(`[REPARTIDOR] Query error in collections/summary: ${queryError.message}`);
            // Devolver respuesta vacía en lugar de error 500
            return res.json({
                success: true,
                repartidorId: cleanRepartidorId,
                period: { year: selectedYear, month: selectedMonth },
                summary: { totalCollectable: 0, totalCollected: 0, totalCommission: 0, overallPercentage: 0, thresholdMet: false, clientCount: 0 },
                clients: [],
                warning: 'No hay datos disponibles para este período'
            });
        }

        // Calculate commissions for each client
        const clients = rows.map(row => {
            const collectable = parseFloat(row.TOTAL_COBRABLE) || 0;
            const collected = parseFloat(row.TOTAL_COBRADO) || 0;
            const percentage = collectable > 0 ? (collected / collectable) * 100 : 0;
            const thresholdMet = percentage >= REPARTIDOR_CONFIG.threshold;

            // Only calculate commission if threshold met AND > 100%
            let commission = 0;
            let tier = 0;
            if (thresholdMet && percentage > 100) {
                const excess = collected - collectable;
                for (const t of REPARTIDOR_CONFIG.tiers) {
                    if (percentage >= t.min && percentage <= t.max) {
                        commission = excess * (t.pct / 100);
                        tier = REPARTIDOR_CONFIG.tiers.indexOf(t) + 1;
                        break;
                    }
                }
            }

            // Map forma pago
            const fp = String(row.FORMA_PAGO || '').toUpperCase();
            let paymentType = 'Otro';
            if (fp.includes('CTR') || fp.includes('CONTADO')) paymentType = 'Contado';
            else if (fp.includes('REP')) paymentType = 'Reposición';
            else if (fp.includes('MEN')) paymentType = 'Mensual';

            return {
                clientId: row.CLIENTE,
                clientName: row.NOMBRE_CLIENTE || row.CLIENTE,
                collectable,
                collected,
                percentage: parseFloat(percentage.toFixed(2)),
                thresholdMet,
                thresholdProgress: Math.min(percentage / REPARTIDOR_CONFIG.threshold, 1),
                commission: parseFloat(commission.toFixed(2)),
                tier,
                paymentType,
                numDocuments: row.NUM_DOCUMENTOS
            };
        });

        // Calculate totals
        const totalCollectable = clients.reduce((sum, c) => sum + c.collectable, 0);
        const totalCollected = clients.reduce((sum, c) => sum + c.collected, 0);
        const totalCommission = clients.reduce((sum, c) => sum + c.commission, 0);
        const overallPercentage = totalCollectable > 0 ? (totalCollected / totalCollectable) * 100 : 0;

        res.json({
            success: true,
            repartidorId,
            period: { year: selectedYear, month: selectedMonth },
            summary: {
                totalCollectable: parseFloat(totalCollectable.toFixed(2)),
                totalCollected: parseFloat(totalCollected.toFixed(2)),
                totalCommission: parseFloat(totalCommission.toFixed(2)),
                overallPercentage: parseFloat(overallPercentage.toFixed(2)),
                thresholdMet: overallPercentage >= REPARTIDOR_CONFIG.threshold,
                clientCount: clients.length
            },
            clients
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in collections/summary: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// GET /collections/daily/:repartidorId
// Acumulado diario de cobros del mes
// =============================================================================
router.get('/collections/daily/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, month } = req.query;

        const selectedYear = parseInt(year) || new Date().getFullYear();
        const selectedMonth = parseInt(month) || new Date().getMonth() + 1;

        logger.info(`[REPARTIDOR] Getting daily collections for ${repartidorId}`);

        const cleanRepartidorId = repartidorId.toString().trim();

        // CORRECTO: Usar OPP → CPC para repartidores
        const sql = `
            SELECT 
                OPP.DIAREPARTO as DIA,
                SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 
                    THEN CPC.IMPORTETOTAL 
                    ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0) 
                END) as TOTAL_COBRADO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE OPP.ANOREPARTO = ${selectedYear}
              AND OPP.MESREPARTO = ${selectedMonth}
              AND TRIM(OPP.CODIGOREPARTIDOR) = '${cleanRepartidorId}'
            GROUP BY OPP.DIAREPARTO
            ORDER BY OPP.DIAREPARTO
        `;

        let rows = [];
        try {
            rows = await query(sql, false) || [];
        } catch (queryError) {
            logger.warn(`[REPARTIDOR] Query error in collections/daily: ${queryError.message}`);
            return res.json({ success: true, daily: [] });
        }

        const daily = rows.map(row => ({
            day: row.DIA,
            date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(row.DIA).padStart(2, '0')}`,
            collectable: parseFloat(row.TOTAL_COBRABLE) || 0,
            collected: parseFloat(row.TOTAL_COBRADO) || 0
        }));

        res.json({
            success: true,
            daily
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in collections/daily: ${error.message}`);
        // Devolver respuesta vacía en lugar de error 500
        res.json({ success: true, daily: [], warning: error.message });
    }
});



// =============================================================================
// GET /history/documents/:clientId
// Historial de documentos (albaranes/facturas) de un cliente
// FIX: GROUP BY to eliminate duplicates, JOIN DELIVERY_STATUS for real status
// =============================================================================
router.get('/history/documents/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        const { repartidorId, limit, offset, dateFrom, dateTo } = req.query;

        logger.info(`[REPARTIDOR] Getting documents for client ${clientId} (dateFrom=${dateFrom}, dateTo=${dateTo})`);

        let repartidorJoin = '';
        if (repartidorId) {
            const cleanIds = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');
            repartidorJoin = `
                INNER JOIN DSEDAC.OPP OPP
                    ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
                    AND TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanIds})`;
        }

        // Date range filter (YYYY-MM-DD format)
        let dateFilter = '';
        if (dateFrom) {
            const parts = dateFrom.split('-');
            if (parts.length === 3) {
                const numFrom = parseInt(parts[0]) * 10000 + parseInt(parts[1]) * 100 + parseInt(parts[2]);
                dateFilter += ` AND (CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) >= ${numFrom}`;
            }
        }
        if (dateTo) {
            const parts = dateTo.split('-');
            if (parts.length === 3) {
                const numTo = parseInt(parts[0]) * 10000 + parseInt(parts[1]) * 100 + parseInt(parts[2]);
                dateFilter += ` AND (CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) <= ${numTo}`;
            }
        }

        const pageLimit = parseInt(limit) || 200;
        const pageOffset = parseInt(offset) || 0;

        const CurrentYear = new Date().getFullYear();
        const yearParam = req.query.year;
        const clientCode = clientId;

        // Conditionally include DELIVERY_STATUS join
        const dsAvail = isDeliveryStatusAvailable();
        const dsJoin = dsAvail
            ? `LEFT JOIN JAVIER.DELIVERY_STATUS DS ON 
                DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(CPC.SERIEALBARAN) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))`
            : '';
        const dsStatusCol = dsAvail ? 'DS.STATUS as DELIVERY_STATUS' : "CAST(NULL AS VARCHAR(20)) as DELIVERY_STATUS";
        const dsUpdatedCol = dsAvail ? 'DS.UPDATED_AT as DELIVERY_UPDATED_AT' : "CAST(NULL AS TIMESTAMP) as DELIVERY_UPDATED_AT";
        const dsFirmaCol = dsAvail ? 'DS.FIRMA_PATH' : "CAST(NULL AS VARCHAR(255)) as FIRMA_PATH";
        const dsObsCol = dsAvail ? 'DS.OBSERVACIONES' : "CAST(NULL AS VARCHAR(512)) as OBSERVACIONES";

        const sql = `
            SELECT 
                CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                CPC.ANODOCUMENTO as ANO, CPC.MESDOCUMENTO as MES, CPC.DIADOCUMENTO as DIA,
                CPC.CODIGOCLIENTEALBARAN,
                CPC.IMPORTETOTAL,
                COALESCE((
                    SELECT SUM(CV.IMPORTEPENDIENTE) 
                    FROM DSEDAC.CVC CV 
                    WHERE CV.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                      AND CV.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                      AND CV.SERIEDOCUMENTO = CPC.SERIEALBARAN
                      AND CV.NUMERODOCUMENTO = CPC.NUMEROALBARAN
                ), 0) as IMPORTE_PENDIENTE,
                CPC.CONFORMADOSN,
                CPC.SITUACIONALBARAN,
                CPC.HORALLEGADA,
                CPC.HORACREACION,
                ${dsStatusCol},
                ${dsUpdatedCol},
                ${dsFirmaCol},
                ${dsObsCol},
                COALESCE((SELECT CAC2.NUMEROFACTURA FROM DSEDAC.CAC CAC2
                    WHERE CAC2.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND CAC2.SERIEALBARAN = CPC.SERIEALBARAN
                      AND CAC2.TERMINALALBARAN = CPC.TERMINALALBARAN AND CAC2.NUMEROALBARAN = CPC.NUMEROALBARAN
                    FETCH FIRST 1 ROW ONLY), 0) as NUMEROFACTURA,
                COALESCE((SELECT TRIM(CAC2.SERIEFACTURA) FROM DSEDAC.CAC CAC2
                    WHERE CAC2.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND CAC2.SERIEALBARAN = CPC.SERIEALBARAN
                      AND CAC2.TERMINALALBARAN = CPC.TERMINALALBARAN AND CAC2.NUMEROALBARAN = CPC.NUMEROALBARAN
                    FETCH FIRST 1 ROW ONLY), '') as SERIEFACTURA,
                COALESCE((SELECT CAC2.EJERCICIOFACTURA FROM DSEDAC.CAC CAC2
                    WHERE CAC2.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND CAC2.SERIEALBARAN = CPC.SERIEALBARAN
                      AND CAC2.TERMINALALBARAN = CPC.TERMINALALBARAN AND CAC2.NUMEROALBARAN = CPC.NUMEROALBARAN
                    FETCH FIRST 1 ROW ONLY), 0) as EJERCICIOFACTURA,
                COALESCE((SELECT FIRMANOMBRE FROM DSEDAC.CACFIRMAS 
                    WHERE EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND SERIEALBARAN = CPC.SERIEALBARAN 
                      AND TERMINALALBARAN = CPC.TERMINALALBARAN AND NUMEROALBARAN = CPC.NUMEROALBARAN
                    FETCH FIRST 1 ROW ONLY), '') as LEGACY_FIRMA_NOMBRE,
                (SELECT DIA FROM DSEDAC.CACFIRMAS 
                    WHERE EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND SERIEALBARAN = CPC.SERIEALBARAN 
                      AND TERMINALALBARAN = CPC.TERMINALALBARAN AND NUMEROALBARAN = CPC.NUMEROALBARAN
                    FETCH FIRST 1 ROW ONLY) as LEGACY_DIA,
                (SELECT MES FROM DSEDAC.CACFIRMAS 
                    WHERE EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND SERIEALBARAN = CPC.SERIEALBARAN 
                      AND TERMINALALBARAN = CPC.TERMINALALBARAN AND NUMEROALBARAN = CPC.NUMEROALBARAN
                    FETCH FIRST 1 ROW ONLY) as LEGACY_MES,
                (SELECT ANO FROM DSEDAC.CACFIRMAS 
                    WHERE EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND SERIEALBARAN = CPC.SERIEALBARAN 
                      AND TERMINALALBARAN = CPC.TERMINALALBARAN AND NUMEROALBARAN = CPC.NUMEROALBARAN
                    FETCH FIRST 1 ROW ONLY) as LEGACY_ANO,
                (SELECT HORA FROM DSEDAC.CACFIRMAS 
                    WHERE EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND SERIEALBARAN = CPC.SERIEALBARAN 
                      AND TERMINALALBARAN = CPC.TERMINALALBARAN AND NUMEROALBARAN = CPC.NUMEROALBARAN
                    FETCH FIRST 1 ROW ONLY) as LEGACY_HORA
            FROM DSEDAC.CPC CPC
            ${repartidorJoin}
            ${dsJoin}
            WHERE CPC.CODIGOCLIENTEALBARAN = '${clientCode}'
              AND CPC.EJERCICIOALBARAN >= ${yearParam ? parseInt(yearParam) : CurrentYear - 2}
              AND CPC.EJERCICIOALBARAN <= ${yearParam ? parseInt(yearParam) : CurrentYear}
              ${dateFilter}
            ORDER BY CPC.EJERCICIOALBARAN DESC, CPC.ANODOCUMENTO DESC, CPC.MESDOCUMENTO DESC, CPC.DIADOCUMENTO DESC, CPC.NUMEROALBARAN DESC
        `;

        const rows = await query(sql);

        // --- DEDUPLICATION v2: Group by unique albaran key AND factura key to eliminate all duplicates ---
        const uniqueMap = new Map();
        rows.forEach(row => {
            const serie = (row.SERIEALBARAN || '').toString().trim();
            const numFactura = parseInt(row.NUMEROFACTURA) || 0;
            // Use factura key if this is a factura to avoid same factura appearing from different albaranes
            const key = numFactura > 0
                ? `FAC-${row.EJERCICIOALBARAN}-${(row.SERIEFACTURA || serie).toString().trim()}-${numFactura}`
                : `ALB-${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`;
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, row);
            } else if (numFactura > 0) {
                // For facturas, prefer row with highest albaran number (latest)
                const existing = uniqueMap.get(key);
                if ((row.NUMEROALBARAN || 0) > (existing.NUMEROALBARAN || 0)) {
                    uniqueMap.set(key, row);
                }
            }
        });
        const uniqueRows = Array.from(uniqueMap.values());
        if (uniqueRows.length < rows.length) {
            logger.info(`[REPARTIDOR] Deduplication v2: ${rows.length} raw rows -> ${uniqueRows.length} unique documents for client ${clientId}`);
        }

        const documents = uniqueRows.map(row => {
            const importe = parseFloat(row.IMPORTETOTAL) || 0;
            const pendiente = parseFloat(row.IMPORTE_PENDIENTE) || 0;

            // --- SENIOR STATUS LOGIC ---
            // --- SENIOR STATUS LOGIC v2 (Time-Aware) ---
            // 1. App Status (Highest Priority - Real Time)
            let status = 'pending';
            const appStatus = (row.DELIVERY_STATUS || '').trim().toLowerCase();
            const legacyStatus = (row.SITUACIONALBARAN || '').trim().toUpperCase(); // F=Facturado, R=Repartido, X=Printed/Active
            const isDispatched = (row.CONFORMADOSN || '').trim().toUpperCase() === 'S';

            // Current Date for comparison
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const docDate = new Date(row.ANO, row.MES - 1, row.DIA);

            if (appStatus === 'delivered') {
                status = 'delivered';
            } else if (appStatus === 'no_delivered' || appStatus === 'absent') {
                status = 'no_delivered';
            } else {
                // 2. Legacy ERP Status
                if (legacyStatus === 'F' || legacyStatus === 'R') {
                    // F: Facturado, R: Realizado/Repartido -> Green
                    status = 'delivered';
                } else if (isDispatched) {
                    // S: Salido de Almacén.
                    // Logic: If it's a past date, assume Delivered (Green). If Today, assume En Ruta (Blue).
                    if (docDate < today) {
                        status = 'delivered';
                    } else {
                        status = 'en_ruta';
                    }
                }
                // Default remains 'pending' (Red)
            }

            const hasFirmaPath = !!row.FIRMA_PATH;
            const numFactura = parseInt(row.NUMEROFACTURA) || 0;
            const serieFactura = (row.SERIEFACTURA || '').trim();
            const ejercicioFactura = parseInt(row.EJERCICIOFACTURA) || 0;
            const isFactura = numFactura > 0;

            // Legacy signature detection (from CACFIRMAS)
            const legacyNombre = (row.LEGACY_FIRMA_NOMBRE || '').trim();
            const hasLegacySig = legacyNombre.length > 0 || (row.LEGACY_ANO && row.LEGACY_ANO > 0);

            // Format Time (HORALLEGADA is HHMMS or HHMMSS)
            let timeFormatted = null;
            if (row.HORALLEGADA && row.HORALLEGADA > 0) {
                let hStr = row.HORALLEGADA.toString().padStart(6, '0'); // Confirm 6 digits for HHMMSS
                // 130202 -> 13:02
                const hh = hStr.substring(0, 2);
                const mm = hStr.substring(2, 4);
                timeFormatted = `${hh}:${mm}`;
            }
            if (pendiente > 0 && pendiente < importe) status = 'partial';

            const serie = (row.SERIEALBARAN || 'A').trim();

            return {
                id: `${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`,
                type: isFactura ? 'factura' : 'albaran',
                number: isFactura ? numFactura : row.NUMEROALBARAN,
                albaranNumber: row.NUMEROALBARAN,
                facturaNumber: numFactura || null,
                serieFactura: serieFactura || null,
                ejercicioFactura: ejercicioFactura || null,
                serie: serie,
                ejercicio: row.EJERCICIOALBARAN,
                terminal: row.TERMINALALBARAN,
                date: `${row.ANO}-${String(row.MES).padStart(2, '0')}-${String(row.DIA).padStart(2, '0')}`,
                time: (row.HORALLEGADA && row.HORALLEGADA > 0)
                    ? `${String(row.HORALLEGADA).padStart(6, '0').substring(0, 2)}:${String(row.HORALLEGADA).padStart(6, '0').substring(2, 4)}`
                    : null,
                amount: importe,
                pending: pendiente,
                status,
                hasSignature: hasFirmaPath || hasLegacySig,
                signaturePath: row.FIRMA_PATH || null,
                deliveryDate: row.DELIVERY_DATE || null,
                deliveryRepartidor: row.DELIVERY_REPARTIDOR || null,
                deliveryObs: row.OBSERVACIONES || null,
                legacySignatureName: legacyNombre || null,
                hasLegacySignature: hasLegacySig,
                legacyDate: (row.LEGACY_ANO > 0)
                    ? `${row.LEGACY_ANO}-${String(row.LEGACY_MES).padStart(2, '0')}-${String(row.LEGACY_DIA).padStart(2, '0')} ${String(row.LEGACY_HORA).padStart(6, '0').substring(0, 2)}:${String(row.LEGACY_HORA).padStart(6, '0').substring(2, 4)}`
                    : null
            };
        });

        res.json({
            success: true,
            clientId,
            total: documents.length,
            documents
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in history/documents: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// GET /history/objectives/:repartidorId
// Seguimiento del objetivo 30% por mes
// =============================================================================
router.get('/history/objectives/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { clientId } = req.query;

        logger.info(`[REPARTIDOR] Getting objectives for ${repartidorId}${clientId ? ` client ${clientId}` : ''}`);

        // Handle comma-separated repartidor IDs
        const cleanRepartidorId = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');
        let clientFilter = '';
        if (clientId) {
            clientFilter = `AND TRIM(CPC.CODIGOCLIENTEALBARAN) = '${clientId.trim()}'`;
        }

        // SENIOR: No date restriction, no row limit - fetch all historical data
        const sql = `
            SELECT 
                OPP.ANOREPARTO as ANO,
                OPP.MESREPARTO as MES,
                SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 
                    THEN CPC.IMPORTETOTAL 
                    ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
                END) as TOTAL_COBRADO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanRepartidorId})
              ${clientFilter}
            GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO
            ORDER BY OPP.ANOREPARTO DESC, OPP.MESREPARTO DESC
        `;

        const rows = await query(sql, false);

        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

        const objectives = rows.map(row => {
            const collectable = parseFloat(row.TOTAL_COBRABLE) || 0;
            const collected = parseFloat(row.TOTAL_COBRADO) || 0;
            const percentage = collectable > 0 ? (collected / collectable) * 100 : 0;

            return {
                month: `${months[row.MES - 1]} ${row.ANO}`,
                year: row.ANO,
                monthNum: row.MES,
                collectable,
                collected,
                percentage: parseFloat(percentage.toFixed(2)),
                thresholdMet: percentage >= REPARTIDOR_CONFIG.threshold
            };
        });

        res.json({
            success: true,
            objectives
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in history/objectives: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// GET /history/objectives-detail/:repartidorId
// Desglose jerárquico: Año → Cliente → FI1 → FI2 → FI3 → FI4 → Productos
// =============================================================================
router.get('/history/objectives-detail/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, clientId } = req.query;

        const selectedYear = parseInt(year) || new Date().getFullYear();
        const cleanIds = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');

        logger.info(`[REPARTIDOR] Objectives detail for ${repartidorId}, year ${selectedYear}${clientId ? `, client ${clientId}` : ''}`);

        // 1. Get client codes delivered by this repartidor in this year
        let clientFilter = '';
        if (clientId) {
            clientFilter = `AND TRIM(CPC.CODIGOCLIENTEALBARAN) = '${clientId.trim()}'`;
        }

        const clientsSql = `
            SELECT DISTINCT TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENT_CODE,
                TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) as CLIENT_NAME
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanIds})
              AND OPP.ANOREPARTO = ${selectedYear}
              ${clientFilter}
        `;

        const clientRows = await query(clientsSql, false);
        if (clientRows.length === 0) {
            return res.json({ success: true, clients: [], year: selectedYear });
        }

        // Build client name map
        const clientNames = {};
        clientRows.forEach(r => {
            const code = (r.CLIENT_CODE || '').trim();
            clientNames[code] = (r.CLIENT_NAME || '').trim() || `CLIENTE ${code}`;
        });

        // 2. Query LACLAE for all those clients with FI hierarchy
        const CHUNK_SIZE = 500;
        const allCodes = Object.keys(clientNames);
        const chunks = [];
        for (let i = 0; i < allCodes.length; i += CHUNK_SIZE) {
            const chunk = allCodes.slice(i, i + CHUNK_SIZE).map(c => `'${c}'`).join(',');
            chunks.push(`L.LCCDCL IN (${chunk})`);
        }
        const clientInFilter = `(${chunks.join(' OR ')})`;

        const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT')`;

        const dataSql = `
            SELECT
                TRIM(L.LCCDCL) as CLIENT_CODE,
                TRIM(L.LCCDRF) as PRODUCT_CODE,
                COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.LCDESC)) as PRODUCT_NAME,
                COALESCE(TRIM(A.UNIDADMEDIDA), 'UDS') as UNIT_TYPE,
                L.LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST,
                SUM(L.LCCTUD) as UNITS,
                COALESCE(TRIM(AX.FILTRO01), '') as FI1_CODE,
                COALESCE(TRIM(AX.FILTRO02), '') as FI2_CODE,
                COALESCE(TRIM(AX.FILTRO03), '') as FI3_CODE,
                COALESCE(TRIM(AX.FILTRO04), '') as FI4_CODE
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARTX AX ON L.LCCDRF = AX.CODIGOARTICULO
            WHERE ${clientInFilter}
              AND L.LCAADC = ${selectedYear}
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCCDCL, L.LCCDRF, A.DESCRIPCIONARTICULO, L.LCDESC, A.UNIDADMEDIDA, L.LCMMDC, AX.FILTRO01, AX.FILTRO02, AX.FILTRO03, AX.FILTRO04
            ORDER BY SALES DESC
        `;

        const rows = await query(dataSql, false);

        // 3. Load FI names from metadata cache
        let fi1Names = {}, fi2Names = {}, fi3Names = {}, fi4Names = {};
        try {
            const { isCacheReady, getCachedFi1Names, getCachedFi2Names, getCachedFi3Names, getCachedFi4Names } = require('../services/metadataCache');
            if (isCacheReady()) {
                fi1Names = getCachedFi1Names() || {};
                fi2Names = getCachedFi2Names() || {};
                fi3Names = getCachedFi3Names() || {};
                fi4Names = getCachedFi4Names() || {};
            } else {
                const fi1Rows = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI1`, false, false);
                fi1Rows.forEach(r => { fi1Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
                const fi2Rows = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI2`, false, false);
                fi2Rows.forEach(r => { fi2Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
                const fi3Rows = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI3`, false, false);
                fi3Rows.forEach(r => { fi3Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
                const fi4Rows = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI4`, false, false);
                fi4Rows.forEach(r => { fi4Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
            }
        } catch (e) {
            logger.warn(`[REPARTIDOR] Could not load FI names: ${e.message}`);
        }

        // 4. Build hierarchy: Client → FI1 → FI2 → FI3 → FI4 → Products
        const clientMap = new Map();

        rows.forEach(row => {
            const cCode = (row.CLIENT_CODE || '').trim();
            const pCode = (row.PRODUCT_CODE || '').trim();
            const pName = (row.PRODUCT_NAME || '').trim() || 'Sin nombre';
            const unitType = (row.UNIT_TYPE || '').trim();
            const month = parseInt(row.MONTH);
            const sales = parseFloat(row.SALES) || 0;
            const cost = parseFloat(row.COST) || 0;
            const units = parseFloat(row.UNITS) || 0;
            const fi1 = (row.FI1_CODE || '').trim() || 'SIN_CAT';
            const fi2 = (row.FI2_CODE || '').trim() || 'General';
            const fi3 = (row.FI3_CODE || '').trim() || '';
            const fi4 = (row.FI4_CODE || '').trim() || '';

            // Client level
            if (!clientMap.has(cCode)) {
                clientMap.set(cCode, {
                    code: cCode,
                    name: clientNames[cCode] || `CLIENTE ${cCode}`,
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    productCount: new Set(),
                    families: new Map()
                });
            }
            const client = clientMap.get(cCode);
            client.totalSales += sales;
            client.totalCost += cost;
            client.totalUnits += units;
            client.productCount.add(pCode);

            // FI1 level
            if (!client.families.has(fi1)) {
                client.families.set(fi1, {
                    code: fi1,
                    name: fi1Names[fi1] ? `${fi1} - ${fi1Names[fi1]}` : (fi1 === 'SIN_CAT' ? 'Sin Categoría' : fi1),
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    children: new Map()
                });
            }
            const fi1Level = client.families.get(fi1);
            fi1Level.totalSales += sales;
            fi1Level.totalCost += cost;
            fi1Level.totalUnits += units;

            // FI2 level
            if (!fi1Level.children.has(fi2)) {
                fi1Level.children.set(fi2, {
                    code: fi2,
                    name: fi2Names[fi2] ? `${fi2} - ${fi2Names[fi2]}` : fi2,
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    children: new Map()
                });
            }
            const fi2Level = fi1Level.children.get(fi2);
            fi2Level.totalSales += sales;
            fi2Level.totalCost += cost;
            fi2Level.totalUnits += units;

            // FI3 level (skip if empty)
            const fi3Key = fi3 || '_default';
            if (!fi2Level.children.has(fi3Key)) {
                fi2Level.children.set(fi3Key, {
                    code: fi3 || '',
                    name: fi3 && fi3Names[fi3] ? `${fi3} - ${fi3Names[fi3]}` : (fi3 || 'General'),
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    children: new Map()
                });
            }
            const fi3Level = fi2Level.children.get(fi3Key);
            fi3Level.totalSales += sales;
            fi3Level.totalCost += cost;
            fi3Level.totalUnits += units;

            // FI4 level (skip if empty)
            const fi4Key = fi4 || '_default';
            if (!fi3Level.children.has(fi4Key)) {
                fi3Level.children.set(fi4Key, {
                    code: fi4 || '',
                    name: fi4 && fi4Names[fi4] ? `${fi4} - ${fi4Names[fi4]}` : (fi4 || 'General'),
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    products: new Map()
                });
            }
            const fi4Level = fi3Level.children.get(fi4Key);
            fi4Level.totalSales += sales;
            fi4Level.totalCost += cost;
            fi4Level.totalUnits += units;

            // Product level
            if (!fi4Level.products.has(pCode)) {
                fi4Level.products.set(pCode, {
                    code: pCode, name: pName, unitType,
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    monthlyData: {}
                });
            }
            const product = fi4Level.products.get(pCode);
            product.totalSales += sales;
            product.totalCost += cost;
            product.totalUnits += units;
            product.monthlyData[month] = (product.monthlyData[month] || 0) + sales;
        });

        // 5. Convert Maps to arrays for JSON, sorted by sales desc
        const mapToArray = (map) => Array.from(map.values()).sort((a, b) => (b.totalSales || 0) - (a.totalSales || 0));

        const clients = mapToArray(clientMap).map(client => ({
            code: client.code,
            name: client.name,
            totalSales: client.totalSales,
            totalCost: client.totalCost,
            totalUnits: client.totalUnits,
            productCount: client.productCount.size,
            margin: client.totalSales > 0 ? ((client.totalSales - client.totalCost) / client.totalSales * 100) : 0,
            families: mapToArray(client.families).map(fi1 => ({
                code: fi1.code, name: fi1.name,
                totalSales: fi1.totalSales, totalCost: fi1.totalCost, totalUnits: fi1.totalUnits,
                children: mapToArray(fi1.children).map(fi2 => ({
                    code: fi2.code, name: fi2.name,
                    totalSales: fi2.totalSales, totalCost: fi2.totalCost, totalUnits: fi2.totalUnits,
                    children: mapToArray(fi2.children).map(fi3 => ({
                        code: fi3.code, name: fi3.name,
                        totalSales: fi3.totalSales, totalCost: fi3.totalCost, totalUnits: fi3.totalUnits,
                        children: mapToArray(fi3.children).map(fi4 => ({
                            code: fi4.code, name: fi4.name,
                            totalSales: fi4.totalSales, totalCost: fi4.totalCost, totalUnits: fi4.totalUnits,
                            products: Array.from(fi4.products.values()).sort((a, b) => b.totalSales - a.totalSales)
                        }))
                    }))
                }))
            }))
        }));

        // Grand totals
        let grandSales = 0, grandCost = 0, grandUnits = 0;
        clients.forEach(c => { grandSales += c.totalSales; grandCost += c.totalCost; grandUnits += c.totalUnits; });

        logger.info(`[REPARTIDOR] Objectives detail: ${clients.length} clients, ${rows.length} data rows`);

        res.json({
            success: true,
            year: selectedYear,
            grandTotal: { sales: grandSales, cost: grandCost, units: grandUnits, margin: grandSales > 0 ? ((grandSales - grandCost) / grandSales * 100) : 0 },
            clients
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in objectives-detail: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// GET /history/signature
// Retrieve real signature (base64) for a given albaran
// =============================================================================
router.get('/history/signature', async (req, res) => {
    try {
        const { ejercicio, serie, terminal, numero } = req.query;
        if (!ejercicio || !numero) {
            return res.json({ success: true, hasSignature: false });
        }

        const albId = `${ejercicio}-${(serie || 'A').trim()}-${terminal || '0'}-${numero}`;
        logger.info(`[REPARTIDOR] Getting signature for albaran ${albId}`);
        let signatureSource = null; // Track where we found the signature

        // 1. Check DELIVERY_STATUS for FIRMA_PATH
        let firmaPath = null;
        try {
            const dsRows = await query(`
                SELECT FIRMA_PATH FROM JAVIER.DELIVERY_STATUS WHERE ID = '${albId}'
            `, false);
            logger.info(`[REPARTIDOR] Step 1 DELIVERY_STATUS: ${dsRows.length} rows for ID='${albId}'`);
            if (dsRows.length > 0 && dsRows[0].FIRMA_PATH) {
                firmaPath = dsRows[0].FIRMA_PATH;
            }
        } catch (e) {
            logger.warn(`[REPARTIDOR] DELIVERY_STATUS query error: ${e.message}`);
        }

        // 2. Check REPARTIDOR_FIRMAS via REPARTIDOR_ENTREGAS
        let firmaBase64 = null;
        let firmante = null;
        let fechaFirma = null;
        try {
            const firmaRows = await query(`
                SELECT RF.FIRMA_BASE64, RF.FIRMANTE_NOMBRE, RF.FECHA_FIRMA
                FROM JAVIER.REPARTIDOR_FIRMAS RF
                INNER JOIN JAVIER.REPARTIDOR_ENTREGAS RE ON RE.ID = RF.ENTREGA_ID
                WHERE RE.NUMERO_ALBARAN = ${numero}
                  AND RE.EJERCICIO_ALBARAN = ${ejercicio}
                  AND TRIM(RE.SERIE_ALBARAN) = '${(serie || 'A').trim()}'
                FETCH FIRST 1 ROW ONLY
            `, false);
            if (firmaRows.length > 0) {
                firmaBase64 = firmaRows[0].FIRMA_BASE64;
                firmante = firmaRows[0].FIRMANTE_NOMBRE;
                fechaFirma = firmaRows[0].FECHA_FIRMA;
                if (firmaBase64) signatureSource = 'REPARTIDOR_FIRMAS';
                logger.info(`[REPARTIDOR] Step 2 REPARTIDOR_FIRMAS: found row, hasBase64=${!!firmaBase64}`);
            } else {
                logger.info(`[REPARTIDOR] Step 2 REPARTIDOR_FIRMAS: 0 rows for numero=${numero}, ejercicio=${ejercicio}, serie='${(serie || 'A').trim()}'`);
            }
        } catch (e) {
            logger.warn(`[REPARTIDOR] REPARTIDOR_FIRMAS query error: ${e.message}`);
        }

        // 3. If no base64, try reading from FIRMA_PATH file
        if (!firmaBase64 && firmaPath) {
            try {
                const fs = require('fs');
                const path = require('path');
                // Try multiple base paths for the signature file
                const basePaths = [
                    path.join(__dirname, '../../uploads'),
                    path.join(__dirname, '../../uploads/photos')
                ];
                for (const basePath of basePaths) {
                    const fullPath = path.join(basePath, firmaPath);
                    if (fs.existsSync(fullPath)) {
                        const fileBuffer = fs.readFileSync(fullPath);
                        firmaBase64 = fileBuffer.toString('base64');
                        signatureSource = 'FILE:' + fullPath;
                        logger.info(`[REPARTIDOR] Found signature file at ${fullPath}`);
                        break;
                    }
                }
                if (!firmaBase64) {
                    logger.warn(`[REPARTIDOR] Signature file not found for path: ${firmaPath}`);
                }
            } catch (e) {
                logger.warn(`[REPARTIDOR] File read error for ${firmaPath}: ${e.message}`);
            }
        }

        // 4. CACFIRMAS (legacy ERP signatures) — last resort
        if (!firmaBase64) {
            try {
                // Query ALL CACFIRMAS rows for this albaran (no FIRMABASE64 filter)
                const cacRows = await query(`
                    SELECT FIRMABASE64, TRIM(FIRMANOMBRE) as FIRMANOMBRE, DIA, MES, ANO, HORA,
                           LENGTH(FIRMABASE64) as FIRMA_LEN
                    FROM DSEDAC.CACFIRMAS
                    WHERE EJERCICIOALBARAN = ${ejercicio}
                      AND TRIM(SERIEALBARAN) = '${(serie || 'A').trim()}'
                      AND TERMINALALBARAN = ${terminal || 0}
                      AND NUMEROALBARAN = ${numero}
                    FETCH FIRST 5 ROWS ONLY
                `, false);
                logger.info(`[REPARTIDOR] Step 4 CACFIRMAS: ${cacRows.length} rows for ej=${ejercicio}, serie='${(serie || 'A').trim()}', term=${terminal || 0}, num=${numero}`);

                // Try to find one with actual base64 data
                for (const cacRow of cacRows) {
                    const rawB64 = cacRow.FIRMABASE64;
                    const b64Len = parseInt(cacRow.FIRMA_LEN) || 0;
                    const nombre = (cacRow.FIRMANOMBRE || '').trim();
                    logger.info(`[REPARTIDOR] CACFIRMAS row: len=${b64Len}, name='${nombre}', hasData=${!!rawB64 && b64Len > 10}`);

                    if (rawB64 && b64Len > 10) {
                        let b64 = rawB64.toString();
                        b64 = b64.replace(/^data:image\/\w+;base64,/, '');
                        firmaBase64 = b64;
                        signatureSource = 'CACFIRMAS';
                        if (!firmante && nombre.length > 0) firmante = nombre;
                        if (!fechaFirma && cacRow.ANO > 0) {
                            fechaFirma = `${cacRow.ANO}-${String(cacRow.MES).padStart(2, '0')}-${String(cacRow.DIA).padStart(2, '0')} ${String(cacRow.HORA).padStart(6, '0').substring(0, 2)}:${String(cacRow.HORA).padStart(6, '0').substring(2, 4)}`;
                        }
                        logger.info(`[REPARTIDOR] Found legacy signature in CACFIRMAS for ${albId}`);
                        break;
                    }
                }

                // If no base64 but we have rows with FIRMANOMBRE, report as name-only signature
                if (!firmaBase64 && cacRows.length > 0) {
                    const nameRow = cacRows.find(r => (r.FIRMANOMBRE || '').trim().length > 0);
                    if (nameRow) {
                        firmante = (nameRow.FIRMANOMBRE || '').trim();
                        signatureSource = 'CACFIRMAS_NAME_ONLY';
                        if (!fechaFirma && nameRow.ANO > 0) {
                            fechaFirma = `${nameRow.ANO}-${String(nameRow.MES).padStart(2, '0')}-${String(nameRow.DIA).padStart(2, '0')} ${String(nameRow.HORA).padStart(6, '0').substring(0, 2)}:${String(nameRow.HORA).padStart(6, '0').substring(2, 4)}`;
                        }
                        logger.info(`[REPARTIDOR] CACFIRMAS name-only signature: '${firmante}' for ${albId}`);
                    } else {
                        logger.info(`[REPARTIDOR] CACFIRMAS: rows exist but no FIRMABASE64 and no FIRMANOMBRE`);
                    }
                } else if (cacRows.length === 0) {
                    logger.info(`[REPARTIDOR] CACFIRMAS: NO row at all for this albaran`);
                }
            } catch (e) {
                logger.warn(`[REPARTIDOR] CACFIRMAS lookup error: ${e.message}`);
            }
        }

        const hasSignature = !!(firmaBase64 || firmaPath || signatureSource);

        logger.info(`[REPARTIDOR] Signature result for ${albId}: hasSignature=${hasSignature}, source=${signatureSource || 'none'}, hasBase64=${!!firmaBase64}, firmante='${firmante || ''}'`);

        res.json({
            success: true,
            hasSignature,
            signature: hasSignature ? {
                base64: firmaBase64 || null,
                path: firmaPath || null,
                firmante: firmante || null,
                fecha: fechaFirma || null,
                source: signatureSource || null
            } : null
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in history/signature: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// GET /debug/signatures - Find albaranes with actual signatures in CACFIRMAS
// Temporary diagnostic endpoint
// =============================================================================
router.get('/debug/signatures', async (req, res) => {
    try {
        // Find recent albaranes that have signatures in CACFIRMAS
        const rows = await query(`
            SELECT 
                CF.EJERCICIOALBARAN, TRIM(CF.SERIEALBARAN) as SERIE, 
                CF.TERMINALALBARAN, CF.NUMEROALBARAN,
                TRIM(CF.FIRMANOMBRE) as FIRMANTE,
                CF.ANO, CF.MES, CF.DIA,
                LENGTH(CF.FIRMABASE64) as FIRMA_SIZE,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE
            FROM DSEDAC.CACFIRMAS CF
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.EJERCICIOALBARAN = CF.EJERCICIOALBARAN
                AND CPC.SERIEALBARAN = CF.SERIEALBARAN
                AND CPC.TERMINALALBARAN = CF.TERMINALALBARAN
                AND CPC.NUMEROALBARAN = CF.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE CF.FIRMABASE64 IS NOT NULL 
              AND LENGTH(TRIM(CF.FIRMABASE64)) > 10
              AND CF.EJERCICIOALBARAN >= 2025
            ORDER BY CF.ANO DESC, CF.MES DESC, CF.DIA DESC
            FETCH FIRST 50 ROWS ONLY
        `, false);

        const signatures = rows.map(r => ({
            albaran: `${r.EJERCICIOALBARAN}-${r.SERIE}-${r.TERMINALALBARAN}-${r.NUMEROALBARAN}`,
            cliente: `${r.CLIENTE} - ${r.NOMBRE_CLIENTE}`,
            firmante: r.FIRMANTE || 'N/A',
            fecha: r.ANO > 0 ? `${r.DIA}/${r.MES}/${r.ANO}` : 'N/A',
            firmaSize: r.FIRMA_SIZE || 0
        }));

        logger.info(`[REPARTIDOR] Debug: Found ${signatures.length} albaranes with signatures in CACFIRMAS`);
        res.json({ 
            success: true, 
            total: signatures.length, 
            signatures,
            note: 'These are albaranes with actual Base64 signatures in CACFIRMAS'
        });
    } catch (error) {
        logger.error(`[REPARTIDOR] Debug signatures error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// GET /history/delivery-summary/:repartidorId
// Summary of deliveries: totals entregados/pendientes by date range
// =============================================================================
router.get('/history/delivery-summary/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, month } = req.query;

        const selectedYear = parseInt(year) || new Date().getFullYear();
        const selectedMonth = parseInt(month) || new Date().getMonth() + 1;
        const cleanIds = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');

        logger.info(`[REPARTIDOR] Delivery summary for ${repartidorId}, ${selectedMonth}/${selectedYear}`);

        const sql = `
            SELECT 
                OPP.DIAREPARTO as DIA,
                COUNT(DISTINCT CPC.EJERCICIOALBARAN || '-' || CPC.SERIEALBARAN || '-' || CAST(CPC.TERMINALALBARAN AS VARCHAR(10)) || '-' || CAST(CPC.NUMEROALBARAN AS VARCHAR(10))) as TOTAL_ALBARANES,
                SUM(CASE WHEN TRIM(CPC.CONFORMADOSN) = 'S' OR CPC.SITUACIONALBARAN IN ('F', 'R') ${isDeliveryStatusAvailable() ? "OR DS.STATUS = 'ENTREGADO'" : ''} THEN 1 ELSE 0 END) as ENTREGADOS,
                SUM(CASE WHEN ${isDeliveryStatusAvailable() ? "DS.STATUS = 'NO_ENTREGADO'" : '1=0'} THEN 1 ELSE 0 END) as NO_ENTREGADOS,
                SUM(CASE WHEN ${isDeliveryStatusAvailable() ? "DS.STATUS = 'PARCIAL'" : '1=0'} THEN 1 ELSE 0 END) as PARCIALES,
                SUM(CPC.IMPORTETOTAL) as IMPORTE_TOTAL
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            ${isDeliveryStatusAvailable() ? `LEFT JOIN JAVIER.DELIVERY_STATUS DS 
                ON DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(CPC.SERIEALBARAN) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))` : ''}
            WHERE OPP.ANOREPARTO = ${selectedYear}
              AND OPP.MESREPARTO = ${selectedMonth}
              AND TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanIds})
            GROUP BY OPP.DIAREPARTO
            ORDER BY OPP.DIAREPARTO
        `;

        const rows = await query(sql, false) || [];

        let totalAlbaranes = 0, totalEntregados = 0, totalNoEntregados = 0, totalParciales = 0, totalImporte = 0;

        const daily = rows.map(row => {
            const albs = parseInt(row.TOTAL_ALBARANES) || 0;
            const ent = parseInt(row.ENTREGADOS) || 0;
            const noEnt = parseInt(row.NO_ENTREGADOS) || 0;
            const parc = parseInt(row.PARCIALES) || 0;
            const imp = parseFloat(row.IMPORTE_TOTAL) || 0;

            totalAlbaranes += albs;
            totalEntregados += ent;
            totalNoEntregados += noEnt;
            totalParciales += parc;
            totalImporte += imp;

            return {
                day: row.DIA,
                date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(row.DIA).padStart(2, '0')}`,
                total: albs,
                delivered: ent,
                notDelivered: noEnt,
                partial: parc,
                pending: albs - ent - noEnt - parc,
                amount: imp
            };
        });

        res.json({
            success: true,
            period: { year: selectedYear, month: selectedMonth },
            summary: {
                totalAlbaranes,
                entregados: totalEntregados,
                noEntregados: totalNoEntregados,
                parciales: totalParciales,
                pendientes: totalAlbaranes - totalEntregados - totalNoEntregados - totalParciales,
                importeTotal: parseFloat(totalImporte.toFixed(2))
            },
            daily
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in delivery-summary: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// GET /document/albaran/:year/:serie/:terminal/:number/pdf
// Generate Albaran PDF with optional embedded signature
// =============================================================================
router.get('/document/albaran/:year/:serie/:terminal/:number/pdf', async (req, res) => {
    try {
        const { year, serie, terminal, number } = req.params;

        logger.info(`[PDF] Generating Albaran PDF: ${year}-${serie}-${terminal}-${number}`);

        // 1. Fetch Header from CAC
        const headerSql = `
            SELECT 
                CAC.EJERCICIOALBARAN, CAC.SERIEALBARAN, CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.DIADOCUMENTO as DIAFACTURA, CAC.MESDOCUMENTO as MESFACTURA, CAC.ANODOCUMENTO as ANOFACTURA,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.PROVINCIA, '')) as PROVINCIACLIENTEFACTURA,
                TRIM(COALESCE(CLI.CODIGOPOSTAL, '')) as CPCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
            WHERE CAC.NUMEROALBARAN = ${number} 
              AND CAC.SERIEALBARAN = '${serie}' 
              AND CAC.EJERCICIOALBARAN = ${year}
              AND CAC.TERMINALALBARAN = ${terminal}
            FETCH FIRST 1 ROW ONLY
        `;
        const headers = await query(headerSql, false);

        if (!headers || headers.length === 0) {
            return res.status(404).json({ success: false, error: 'Albarán no encontrado' });
        }
        const header = headers[0];

        // 2. Fetch Lines from LAC
        const linesSql = `
            SELECT 
                LAC.CODIGOARTICULO,
                LAC.DESCRIPCION as DESCRIPCIONARTICULO,
                '' as LOTEARTICULO,
                LAC.CANTIDADUNIDADES as CANTIDADARTICULO,
                0 as CAJASARTICULO,
                LAC.IMPORTEVENTA as IMPORTENETOARTICULO,
                0 as PORCENTAJEIVAARTICULO,
                0 as PORCENTAJERECARGOARTICULO,
                LAC.PORCENTAJEDESCUENTO as PORCENTAJEDESCUENTOARTICULO,
                LAC.PRECIOVENTA as PRECIOARTICULO
            FROM DSEDAC.LAC LAC
            WHERE LAC.EJERCICIOALBARAN = ${year}
              AND LAC.SERIEALBARAN = '${serie}'
              AND LAC.TERMINALALBARAN = ${terminal}
              AND LAC.NUMEROALBARAN = ${number}
            ORDER BY LAC.SECUENCIA
        `;
        const lines = await query(linesSql, false) || [];

        // 3. Try to get signature - comprehensive cascade lookup
        let signatureBase64 = null;
        const albId = `${year}-${serie.trim()}-${terminal}-${number}`;
        const fs = require('fs');
        const pathModule = require('path');

        // Step 3a: Check DELIVERY_STATUS for FIRMA_PATH
        try {
            const dsRows = await query(`SELECT FIRMA_PATH FROM JAVIER.DELIVERY_STATUS WHERE ID = '${albId}'`, false);
            if (dsRows.length > 0 && dsRows[0].FIRMA_PATH) {
                const basePaths = [
                    pathModule.join(__dirname, '../../uploads'),
                    pathModule.join(__dirname, '../../uploads/photos')
                ];
                for (const basePath of basePaths) {
                    const fullPath = pathModule.join(basePath, dsRows[0].FIRMA_PATH);
                    if (fs.existsSync(fullPath)) {
                        signatureBase64 = fs.readFileSync(fullPath).toString('base64');
                        logger.info(`[PDF] Found signature file at ${fullPath}`);
                        break;
                    }
                }
            }
        } catch (e) {
            logger.warn(`[PDF] DELIVERY_STATUS signature lookup error: ${e.message}`);
        }

        // Step 3b: Try REPARTIDOR_FIRMAS if no file signature
        if (!signatureBase64) {
            try {
                const firmaRows = await query(`
                    SELECT RF.FIRMA_BASE64 FROM JAVIER.REPARTIDOR_FIRMAS RF
                    INNER JOIN JAVIER.REPARTIDOR_ENTREGAS RE ON RE.ID = RF.ENTREGA_ID
                    WHERE RE.NUMERO_ALBARAN = ${number}
                      AND RE.EJERCICIO_ALBARAN = ${year}
                      AND RE.SERIE_ALBARAN = '${serie.trim()}'
                    FETCH FIRST 1 ROW ONLY
                `, false);
                if (firmaRows.length > 0 && firmaRows[0].FIRMA_BASE64) {
                    signatureBase64 = firmaRows[0].FIRMA_BASE64;
                    logger.info(`[PDF] Using signature from REPARTIDOR_FIRMAS`);
                }
            } catch (e) {
                logger.warn(`[PDF] REPARTIDOR_FIRMAS lookup error: ${e.message}`);
            }
        }

        // Step 3c: Try CACFIRMAS (legacy ERP signatures) as last resort
        if (!signatureBase64) {
            try {
                const cacRows = await query(`
                    SELECT FIRMABASE64 FROM DSEDAC.CACFIRMAS
                    WHERE EJERCICIOALBARAN = ${year}
                      AND SERIEALBARAN = '${serie.trim()}'
                      AND TERMINALALBARAN = ${terminal}
                      AND NUMEROALBARAN = ${number}
                    FETCH FIRST 1 ROW ONLY
                `, false);
                if (cacRows.length > 0 && cacRows[0].FIRMABASE64) {
                    let b64 = cacRows[0].FIRMABASE64;
                    b64 = b64.replace(/^data:image\/\w+;base64,/, '');
                    signatureBase64 = b64;
                    logger.info(`[PDF] Using legacy signature from CACFIRMAS`);
                }
            } catch (e) {
                logger.warn(`[PDF] CACFIRMAS lookup error: ${e.message}`);
            }
        }

        logger.info(`[PDF] Signature for ${albId}: ${signatureBase64 ? 'FOUND' : 'NOT FOUND'}`);

        // 4. Generate PDF with optional signature
        const buffer = await generateInvoicePDF({ header, lines, signatureBase64 });

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename=Albaran_${year}_${serie}_${number}.pdf`,
            'Content-Length': buffer.length
        });
        res.send(buffer);

    } catch (e) {
        logger.error(`[PDF] Error generating albaran PDF: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =============================================================================
// GET /config
// Get commission configuration
// =============================================================================
router.get('/config', (req, res) => {
    res.json({
        success: true,
        config: {
            threshold: REPARTIDOR_CONFIG.threshold,
            tiers: REPARTIDOR_CONFIG.tiers.map((t, i) => ({
                tier: i + 1,
                min: t.min,
                max: t.max,
                rate: t.pct
            }))
        }
    });
});

// =============================================================================
// POST /entregas
// Crear o actualizar una entrega
// =============================================================================
router.post('/entregas', async (req, res) => {
    try {
        const {
            numeroAlbaran,
            ejercicioAlbaran,
            serieAlbaran = 'A',
            codigoCliente,
            nombreCliente,
            codigoRepartidor,
            codigoConductor,
            estado = 'PENDIENTE',
            fechaPrevista,
            importeTotal,
            esCTR = false,
            observaciones
        } = req.body;

        logger.info(`[REPARTIDOR] Creating/updating entrega for albaran ${numeroAlbaran}`);

        // Check if delivery already exists
        const checkSql = `
            SELECT ID FROM JAVIER.REPARTIDOR_ENTREGAS 
            WHERE NUMERO_ALBARAN = ${numeroAlbaran} 
              AND EJERCICIO_ALBARAN = ${ejercicioAlbaran} 
              AND SERIE_ALBARAN = '${serieAlbaran}'
        `;
        const existing = await query(checkSql, false);

        let entregaId;

        if (existing.length > 0) {
            // Update existing
            entregaId = existing[0].ID;
            const updateSql = `
                UPDATE JAVIER.REPARTIDOR_ENTREGAS SET
                    ESTADO = '${estado}',
                    FECHA_ENTREGA = ${estado === 'ENTREGADO' ? 'CURRENT_TIMESTAMP' : 'NULL'},
                    OBSERVACIONES = ${observaciones ? `'${observaciones.replace(/'/g, "''")}'` : 'NULL'}
                WHERE ID = ${entregaId}
            `;
            await query(updateSql, false);
        } else {
            // Insert new
            const insertSql = `
                INSERT INTO JAVIER.REPARTIDOR_ENTREGAS (
                    NUMERO_ALBARAN, EJERCICIO_ALBARAN, SERIE_ALBARAN,
                    CODIGO_CLIENTE, NOMBRE_CLIENTE,
                    CODIGO_REPARTIDOR, CODIGO_CONDUCTOR,
                    ESTADO, FECHA_PREVISTA, IMPORTE_TOTAL, ES_CTR, OBSERVACIONES
                ) VALUES (
                    ${numeroAlbaran}, ${ejercicioAlbaran}, '${serieAlbaran}',
                    '${codigoCliente}', ${nombreCliente ? `'${nombreCliente.replace(/'/g, "''")}'` : 'NULL'},
                    '${codigoRepartidor}', ${codigoConductor ? `'${codigoConductor}'` : 'NULL'},
                    '${estado}', ${fechaPrevista ? `'${fechaPrevista}'` : 'CURRENT_DATE'},
                    ${importeTotal || 0}, '${esCTR ? 'S' : 'N'}',
                    ${observaciones ? `'${observaciones.replace(/'/g, "''")}'` : 'NULL'}
                )
            `;
            await query(insertSql, false);

            // Get the new ID
            const newIdResult = await query(checkSql, false);
            entregaId = newIdResult[0]?.ID;
        }

        res.json({
            success: true,
            entregaId,
            message: existing.length > 0 ? 'Entrega actualizada' : 'Entrega creada'
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in POST /entregas: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// POST /entregas/:entregaId/firma
// Guardar firma digital de una entrega
// =============================================================================
router.post('/entregas/:entregaId/firma', async (req, res) => {
    try {
        const { entregaId } = req.params;
        const {
            firmaBase64,
            firmaNombre,
            firmaDNI,
            dispositivo,
            latitud,
            longitud
        } = req.body;

        logger.info(`[REPARTIDOR] Saving signature for entrega ${entregaId}`);

        if (!firmaBase64) {
            return res.status(400).json({ success: false, error: 'Firma base64 requerida' });
        }

        // Delete existing signature if any
        await query(`DELETE FROM JAVIER.REPARTIDOR_FIRMAS WHERE ENTREGA_ID = ${entregaId}`, false);

        // Insert new signature
        const insertSql = `
            INSERT INTO JAVIER.REPARTIDOR_FIRMAS (
                ENTREGA_ID, FIRMA_BASE64, FIRMANTE_NOMBRE, FIRMANTE_DNI,
                DISPOSITIVO, LATITUD, LONGITUD
            ) VALUES (
                ${entregaId},
                '${firmaBase64.substring(0, 1000000)}',
                ${firmaNombre ? `'${firmaNombre.replace(/'/g, "''")}'` : 'NULL'},
                ${firmaDNI ? `'${firmaDNI}'` : 'NULL'},
                ${dispositivo ? `'${dispositivo}'` : 'NULL'},
                ${latitud || 'NULL'},
                ${longitud || 'NULL'}
            )
        `;

        await query(insertSql, false);

        // Update entrega status to delivered
        await query(`
            UPDATE JAVIER.REPARTIDOR_ENTREGAS SET 
                ESTADO = 'ENTREGADO', 
                FECHA_ENTREGA = CURRENT_TIMESTAMP 
            WHERE ID = ${entregaId}
        `, false);

        res.json({
            success: true,
            message: 'Firma guardada y entrega completada'
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in POST /entregas/:id/firma: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// POST /entregas/:entregaId/lineas
// Guardar estado de líneas de artículos
// =============================================================================
router.post('/entregas/:entregaId/lineas', async (req, res) => {
    try {
        const { entregaId } = req.params;
        const { lineas } = req.body;

        logger.info(`[REPARTIDOR] Saving ${lineas?.length || 0} lines for entrega ${entregaId}`);

        if (!Array.isArray(lineas)) {
            return res.status(400).json({ success: false, error: 'Lineas array requerido' });
        }

        // Delete existing lines
        await query(`DELETE FROM JAVIER.REPARTIDOR_ENTREGA_LINEAS WHERE ENTREGA_ID = ${entregaId}`, false);

        // Insert new lines
        for (const linea of lineas) {
            const insertSql = `
                INSERT INTO JAVIER.REPARTIDOR_ENTREGA_LINEAS (
                    ENTREGA_ID, LINEA_ALBARAN, CODIGO_ARTICULO, DESCRIPCION_ARTICULO,
                    CANTIDAD_PEDIDA, CANTIDAD_ENTREGADA, CANTIDAD_RECHAZADA,
                    ESTADO, OBSERVACIONES, MOTIVO_NO_ENTREGA
                ) VALUES (
                    ${entregaId},
                    ${linea.lineaAlbaran || 0},
                    '${linea.codigoArticulo || ''}',
                    ${linea.descripcion ? `'${linea.descripcion.replace(/'/g, "''").substring(0, 200)}'` : 'NULL'},
                    ${linea.cantidadPedida || 0},
                    ${linea.cantidadEntregada || 0},
                    ${linea.cantidadRechazada || 0},
                    '${linea.estado || 'PENDIENTE'}',
                    ${linea.observaciones ? `'${linea.observaciones.replace(/'/g, "''")}'` : 'NULL'},
                    ${linea.motivoNoEntrega ? `'${linea.motivoNoEntrega}'` : 'NULL'}
                )
            `;
            await query(insertSql, false);
        }

        // Determine overall delivery status
        const allDelivered = lineas.every(l => l.estado === 'ENTREGADO');
        const noneDelivered = lineas.every(l => l.estado === 'NO_ENTREGADO');
        const overallStatus = allDelivered ? 'ENTREGADO' : (noneDelivered ? 'NO_ENTREGADO' : 'PARCIAL');

        await query(`
            UPDATE JAVIER.REPARTIDOR_ENTREGAS SET ESTADO = '${overallStatus}' WHERE ID = ${entregaId}
        `, false);

        res.json({
            success: true,
            lineasGuardadas: lineas.length,
            estadoEntrega: overallStatus
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in POST /entregas/:id/lineas: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// POST /cobros
// Registrar un cobro realizado
// =============================================================================
router.post('/cobros', async (req, res) => {
    try {
        const {
            entregaId,
            codigoCliente,
            nombreCliente,
            codigoRepartidor,
            tipoDocumento,
            numeroDocumento,
            ejercicioDocumento,
            importeCobrado,
            importePendiente = 0,
            formaPago,
            notas
        } = req.body;

        logger.info(`[REPARTIDOR] Recording cobro for ${tipoDocumento} ${numeroDocumento}`);

        const insertSql = `
            INSERT INTO JAVIER.REPARTIDOR_COBROS (
                ENTREGA_ID, CODIGO_CLIENTE, NOMBRE_CLIENTE,
                CODIGO_REPARTIDOR, TIPO_DOCUMENTO, NUMERO_DOCUMENTO, EJERCICIO_DOCUMENTO,
                IMPORTE_COBRADO, IMPORTE_PENDIENTE, FORMA_PAGO, NOTAS
            ) VALUES (
                ${entregaId || 'NULL'},
                '${codigoCliente}',
                ${nombreCliente ? `'${nombreCliente.replace(/'/g, "''")}'` : 'NULL'},
                '${codigoRepartidor}',
                '${tipoDocumento}',
                ${numeroDocumento},
                ${ejercicioDocumento},
                ${importeCobrado},
                ${importePendiente},
                ${formaPago ? `'${formaPago}'` : 'NULL'},
                ${notas ? `'${notas.replace(/'/g, "''")}'` : 'NULL'}
            )
        `;

        await query(insertSql, false);

        // Update CTR status if applicable
        if (entregaId) {
            await query(`
                UPDATE JAVIER.REPARTIDOR_ENTREGAS SET 
                    CTR_COBRADO = 'S',
                    IMPORTE_COBRADO = IMPORTE_COBRADO + ${importeCobrado}
                WHERE ID = ${entregaId} AND ES_CTR = 'S'
            `, false);
        }

        res.json({
            success: true,
            message: 'Cobro registrado correctamente'
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in POST /cobros: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// GET /entregas/:entregaId/firma
// Obtener firma de una entrega
// =============================================================================
router.get('/entregas/:entregaId/firma', async (req, res) => {
    try {
        const { entregaId } = req.params;

        const sql = `
            SELECT FIRMA_BASE64, FIRMANTE_NOMBRE, FECHA_FIRMA
            FROM JAVIER.REPARTIDOR_FIRMAS 
            WHERE ENTREGA_ID = ${entregaId}
            FETCH FIRST 1 ROW ONLY
        `;

        const rows = await query(sql, false);

        if (rows.length === 0) {
            return res.json({ success: true, hasSignature: false });
        }

        res.json({
            success: true,
            hasSignature: true,
            signature: {
                base64: rows[0].FIRMA_BASE64,
                firmante: rows[0].FIRMANTE_NOMBRE,
                fecha: rows[0].FECHA_FIRMA
            }
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in GET /entregas/:id/firma: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// GET /rutero/week/:repartidorId
// Resumen semanal para el calendario (LUN 30, MAR 31...)
// Estado basado en cobros de CONTADO, REPOSICION, MENSUAL
// =============================================================================
router.get('/rutero/week/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { date } = req.query; // Fecha de referencia (ej. hoy)

        const refDate = date ? new Date(date) : new Date();
        const currentDay = refDate.getDate();

        // Calculate start/end of week (Monday to Sunday)
        const dayOfWeek = refDate.getDay() || 7; // 1 (Mon) to 7 (Sun)
        const startOfWeek = new Date(refDate);
        startOfWeek.setDate(currentDay - dayOfWeek + 1);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        // Generate array of expected dates
        const weekDays = [];
        const d = new Date(startOfWeek);
        while (d <= endOfWeek) {
            weekDays.push({
                sday: d.getDate(),
                smonth: d.getMonth() + 1,
                syear: d.getFullYear(),
                formatted: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            });
            d.setDate(d.getDate() + 1);
        }

        const cleanRepartidorId = repartidorId.toString().trim();
        const startDateStr = weekDays[0].formatted;
        const endDateStr = weekDays[6].formatted;

        logger.info(`[REPARTIDOR] Getting weekly stats ${startDateStr} to ${endDateStr} for ${cleanRepartidorId}`);

        // Today's numeric date for past-date logic
        const now = new Date();
        const todayNum = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

        // Query to get daily aggregates
        // ENTREGADOS: ERP-confirmed (CONFORMADOSN) + app-confirmed (DELIVERY_STATUS) + past dates
        const dsWeekAvail = isDeliveryStatusAvailable();
        const sql = `
            SELECT
                OPP.DIAREPARTO as DIA,
                OPP.MESREPARTO as MES,
                OPP.ANOREPARTO as ANO,
                COUNT(DISTINCT CPC.NUMEROALBARAN) as TOTAL_ALBARANES,
                COUNT(DISTINCT CASE
                    WHEN TRIM(CPC.CONFORMADOSN) = 'S' OR CPC.SITUACIONALBARAN IN ('F', 'R') THEN CPC.NUMEROALBARAN
                    ${dsWeekAvail ? "WHEN DS.STATUS = 'ENTREGADO' THEN CPC.NUMEROALBARAN" : ''}
                    WHEN (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) < ${todayNum}
                         THEN CPC.NUMEROALBARAN
                    ELSE NULL
                END) as ENTREGADOS
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            ${dsWeekAvail ? `LEFT JOIN JAVIER.DELIVERY_STATUS DS
                ON DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(CPC.SERIEALBARAN) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))` : ''}
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO)
                BETWEEN ${weekDays[0].syear * 10000 + weekDays[0].smonth * 100 + weekDays[0].sday}
                    AND ${weekDays[6].syear * 10000 + weekDays[6].smonth * 100 + weekDays[6].sday}
              AND TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanRepartidorId.split(',').map(id => `'${id.trim()}'`).join(',')})
            GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO, OPP.DIAREPARTO
        `;

        const rows = await query(sql, false);

        // Map results to weekDays
        const days = weekDays.map(wd => {
            const row = rows.find(r => r.ANO === wd.syear && r.MES === wd.smonth && r.DIA === wd.sday);

            const totalAlbaranes = row ? parseInt(row.TOTAL_ALBARANES) : 0;
            const entregados = row ? parseInt(row.ENTREGADOS) : 0;

            // Status Logic:
            // 0 albaranes -> 'none' (Gray)
            // all completed -> 'good' (Green)
            // some pending -> 'bad' (Red)
            let status = 'none';
            if (totalAlbaranes > 0) {
                if (entregados >= totalAlbaranes) {
                    status = 'good';
                } else {
                    status = 'bad';
                }
            }

            return {
                date: wd.formatted,
                day: wd.sday,
                dayName: ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'][new Date(wd.formatted).getDay()],
                clients: totalAlbaranes,
                completed: entregados,
                status: status
            };
        });

        res.json({
            success: true,
            days
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in /rutero/week: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});


// =============================================================================
// GET /history/:repartidorId
// Retrieve historical deliveries with filtering
// =============================================================================
router.get('/history/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { startDate, endDate, search } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, error: 'Fechas requeridas' });
        }

        // Convert dates to integers YYYYMMDD
        const startInt = parseInt(startDate.replace(/-/g, ''));
        const endInt = parseInt(endDate.replace(/-/g, ''));
        const cleanRepartidorId = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');

        logger.info(`[REPARTIDOR] History for ${repartidorId} from ${startInt} to ${endInt}`);

        const dsHistAvail = isDeliveryStatusAvailable();
        let sql = `
            SELECT 
                CPC.ANODOCUMENTO || '-' || RIGHT('0' || CPC.MESDOCUMENTO, 2) || '-' || RIGHT('0' || CPC.DIADOCUMENTO, 2) as FECHA,
                CPC.NUMEROALBARAN,
                CPC.SERIEALBARAN,
                CPC.EJERCICIOALBARAN,
                CAC.NUMEROFACTURA,
                CAC.SERIEFACTURA,
                CAC.EJERCICIOFACTURA,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CODIGO_CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE,
                CPC.IMPORTETOTAL as TOTAL,
                ${dsHistAvail ? "DS.STATUS as ESTADO_ENTREGA" : "CAST(NULL AS VARCHAR(20)) as ESTADO_ENTREGA"},
                ${dsHistAvail ? "DS.FIRMA_PATH" : "CAST(NULL AS VARCHAR(255)) as FIRMA_PATH"}
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI 
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            ${dsHistAvail ? `LEFT JOIN JAVIER.DELIVERY_STATUS DS 
                ON DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(CPC.SERIEALBARAN) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))` : ''}
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ${startInt} AND ${endInt}
              AND TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanRepartidorId})
        `;

        if (search) {
            const cleanSearch = search.toUpperCase().replace(/'/g, "''");
            sql += ` AND (
                UPPER(CLI.NOMBRECLIENTE) LIKE '%${cleanSearch}%' OR 
                UPPER(CLI.NOMBREALTERNATIVO) LIKE '%${cleanSearch}%' OR
                CAST(CPC.NUMEROALBARAN AS CHAR(20)) LIKE '%${cleanSearch}%' OR
                CAST(CAC.NUMEROFACTURA AS CHAR(20)) LIKE '%${cleanSearch}%'
            )`;
        }

        sql += ` ORDER BY FECHA DESC, CPC.NUMEROALBARAN DESC FETCH FIRST 200 ROWS ONLY`;

        const rows = await query(sql, false) || [];

        res.json({ success: true, count: rows.length, data: rows });
    } catch (e) {
        logger.error(`[REPARTIDOR] Error in /history: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =============================================================================
// GET /document/invoice/:year/:serie/:number/pdf
// Generate formal Invoice PDF
// =============================================================================
router.get('/document/invoice/:year/:serie/:number/pdf', async (req, res) => {
    try {
        const { year, serie, number } = req.params;

        logger.info(`[PDF] Generating Invoice PDF: ${year}-${serie}-${number}`);

        // 1. Fetch Header (From CAC - First matching Albaran)
        // We use CAC because actual Invoice tables like FAC/FCL might be missing or inaccessible
        const headerSql = `
            SELECT 
                CAC.EJERCICIOALBARAN, CAC.SERIEALBARAN, CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.DIADOCUMENTO as DIAFACTURA, CAC.MESDOCUMENTO as MESFACTURA, CAC.ANODOCUMENTO as ANOFACTURA, -- Fallback to Alb date
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.PROVINCIA, '')) as PROVINCIACLIENTEFACTURA,
                TRIM(COALESCE(CLI.CODIGOPOSTAL, '')) as CPCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
            WHERE CAC.NUMEROFACTURA = ${number} 
              AND CAC.SERIEFACTURA = '${serie}' 
              AND CAC.EJERCICIOFACTURA = ${year}
            FETCH FIRST 1 ROW ONLY
        `;
        const headers = await query(headerSql, false);

        if (!headers || headers.length === 0) {
            return res.status(404).json({ success: false, error: 'Factura no encontrada (CAC)' });
        }
        const header = headers[0];

        // 2. Fetch Lines (From LAC - Aggregated from all Albaranes in this Invoice)
        const linesSql = `
            SELECT 
                LAC.CODIGOARTICULO,
                LAC.DESCRIPCION as DESCRIPCIONARTICULO,
                '' as LOTEARTICULO, -- Column missing in LAC
                LAC.CANTIDADUNIDADES as CANTIDADARTICULO,
                0 as CAJASARTICULO, -- Column missing in LAC
                LAC.IMPORTEVENTA as IMPORTENETOARTICULO,
                0 as PORCENTAJEIVAARTICULO, -- Column missing in LAC
                0 as PORCENTAJERECARGOARTICULO, -- Column missing in LAC
                LAC.PORCENTAJEDESCUENTO as PORCENTAJEDESCUENTOARTICULO,
                LAC.PRECIOVENTA as PRECIOARTICULO
            FROM DSEDAC.LAC LAC
            INNER JOIN DSEDAC.CAC CAC 
                 ON LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN 
                 AND LAC.SERIEALBARAN = CAC.SERIEALBARAN 
                 AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN 
                 AND LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
            WHERE CAC.NUMEROFACTURA = ${number} 
              AND CAC.SERIEFACTURA = '${serie}' 
              AND CAC.EJERCICIOFACTURA = ${year}
            ORDER BY CAC.ANODOCUMENTO, CAC.MESDOCUMENTO, CAC.DIADOCUMENTO, CAC.NUMEROALBARAN, LAC.SECUENCIA
        `;
        const lines = await query(linesSql, false) || [];

        // 3. Generate PDF
        const buffer = await generateInvoicePDF({ header, lines });

        // 4. Send Response
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename=Factura_${year}_${serie}_${number}.pdf`,
            'Content-Length': buffer.length
        });
        res.send(buffer);

    } catch (e) {
        logger.error(`[PDF] Error generating invoice: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});


// =============================================================================
// GET /history/clients/:repartidorId
// Get list of clients delivered by this repartidor (Last 6 months)
// =============================================================================
router.get('/history/clients/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { search } = req.query;

        const cleanRepartidorId = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');

        // Fetch ALL clients ever delivered with totals
        let sql = `
            SELECT
                TRIM(CPC.CODIGOCLIENTEALBARAN) as ID,
                TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) as NAME,
                TRIM(COALESCE(CLI.DIRECCION, '')) as ADDRESS,
                COUNT(DISTINCT CPC.NUMEROALBARAN) as TOTAL_DOCS,
                COALESCE(SUM(CPC.IMPORTETOTAL), 0) as TOTAL_AMOUNT,
                MAX(OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) as LAST_VISIT
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanRepartidorId})
        `;

        if (search) {
            const cleanSearch = search.toUpperCase().replace(/'/g, "''");
            sql += ` AND (UPPER(CLI.NOMBRECLIENTE) LIKE '%${cleanSearch}%' OR UPPER(CLI.NOMBREALTERNATIVO) LIKE '%${cleanSearch}%' OR TRIM(CPC.CODIGOCLIENTEALBARAN) LIKE '%${cleanSearch}%')`;
        }

        sql += ` GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')), TRIM(COALESCE(CLI.DIRECCION, ''))
                 ORDER BY LAST_VISIT DESC`;

        logger.info(`[REPARTIDOR] History SQL with repartidorId ${repartidorId}: ${sql.replace(/\s+/g, ' ')}`);
        const rows = await query(sql, false);
        logger.info(`[REPARTIDOR] Found ${rows.length} historical clients for repartidor ${repartidorId}`);

        const clients = rows.map(r => {
            const lastVisit = r.LAST_VISIT || 0;
            const lvYear = Math.floor(lastVisit / 10000);
            const lvMonth = Math.floor((lastVisit % 10000) / 100);
            const lvDay = lastVisit % 100;
            const lastVisitStr = lastVisit > 0
                ? `${String(lvDay).padStart(2, '0')}/${String(lvMonth).padStart(2, '0')}/${lvYear}`
                : null;

            return {
                id: (r.ID || '').trim(),
                name: (r.NAME || '').trim() || `CLIENTE ${r.ID}`,
                address: (r.ADDRESS || '').trim(),
                totalDocuments: r.TOTAL_DOCS || 0,
                totalAmount: parseFloat(r.TOTAL_AMOUNT) || 0,
                lastVisit: lastVisitStr
            };
        });

        res.json({ success: true, clients });
    } catch (e) {
        logger.error(`[REPARTIDOR] Error getting history clients: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =============================================================================
// GET /history/legacy-signature/:id
// Returns the Base64 signature from CACFIRMAS as an image
// ===================================
router.get('/history/legacy-signature/:id', async (req, res) => {
    try {
        const { id } = req.params; // Format: YEAR-SERIES-TERMINAL-NUMBER
        const parts = id.split('-');
        if (parts.length < 4) return res.status(400).send('Invalid ID format');

        const [year, series, terminal, number] = parts;

        const sql = `
            SELECT FIRMABASE64
            FROM DSEDAC.CACFIRMAS
            WHERE EJERCICIOALBARAN = ${year}
              AND SERIEALBARAN = '${series}'
              AND TERMINALALBARAN = ${terminal}
              AND NUMEROALBARAN = ${number}
        `;

        const rows = await query(sql, false);
        if (rows.length === 0 || !rows[0].FIRMABASE64) {
            return res.status(404).send('Signature not found');
        }

        let base64Image = rows[0].FIRMABASE64;
        base64Image = base64Image.replace(/^data:image\/\w+;base64,/, "");
        const imgBuffer = Buffer.from(base64Image, 'base64');

        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': imgBuffer.length
        });
        res.end(imgBuffer);

    } catch (error) {
        logger.error(`Error fetching legacy signature: ${error.message}`);
        res.status(500).send('Error fetching signature');
    }
});

module.exports = router;
