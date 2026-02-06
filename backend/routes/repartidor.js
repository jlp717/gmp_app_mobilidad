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
                TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')) as NOMBRE_CLIENTE,
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
            GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')), CPC.CODIGOFORMAPAGO
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
// =============================================================================
router.get('/history/documents/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        const { repartidorId } = req.query;

        logger.info(`[REPARTIDOR] Getting documents for client ${clientId}`);

        // CORRECTO: Usar OPP → CPC para filtrar por repartidor
        let repartidorJoin = '';
        let repartidorFilter = '';
        if (repartidorId) {
            repartidorJoin = `
                INNER JOIN DSEDAC.OPP OPP 
                    ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION`;
            repartidorFilter = `AND TRIM(OPP.CODIGOREPARTIDOR) = '${repartidorId.toString().trim()}'`;
        }

        const sql = `
            SELECT 
                CPC.NUMEROALBARAN,
                CPC.EJERCICIOALBARAN,
                CPC.ANODOCUMENTO as ANO,
                CPC.MESDOCUMENTO as MES,
                CPC.DIADOCUMENTO as DIA,
                CPC.IMPORTETOTAL,
                COALESCE(CVC.IMPORTEPENDIENTE, 0) as IMPORTE_PENDIENTE,
                CPC.CODIGOFORMAPAGO
            FROM DSEDAC.CPC CPC
            ${repartidorJoin}
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE TRIM(CPC.CODIGOCLIENTEALBARAN) = '${clientId.trim()}'
              AND CPC.ANODOCUMENTO >= ${new Date().getFullYear() - 1}
              ${repartidorFilter}
            ORDER BY CPC.ANODOCUMENTO DESC, CPC.MESDOCUMENTO DESC, CPC.DIADOCUMENTO DESC
            FETCH FIRST 50 ROWS ONLY
        `;

        const rows = await query(sql, false);

        const documents = rows.map(row => {
            const importe = parseFloat(row.IMPORTETOTAL) || 0;
            const pendiente = parseFloat(row.IMPORTE_PENDIENTE) || 0;

            let status = 'delivered';
            if (pendiente >= importe) status = 'notDelivered';
            else if (pendiente > 0) status = 'partial';

            return {
                id: `ALB-${row.EJERCICIOALBARAN}-${row.NUMEROALBARAN}`,
                type: 'albaran',
                number: row.NUMEROALBARAN,
                date: `${row.ANO}-${String(row.MES).padStart(2, '0')}-${String(row.DIA).padStart(2, '0')}`,
                amount: importe,
                pending: pendiente,
                status,
                hasSignature: status === 'delivered' // Assume delivered = has signature
            };
        });

        res.json({
            success: true,
            clientId,
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

        const cleanRepartidorId = repartidorId.toString().trim();
        let clientFilter = '';
        if (clientId) {
            clientFilter = `AND TRIM(CPC.CODIGOCLIENTEALBARAN) = '${clientId.trim()}'`;
        }

        // CORRECTO: Usar OPP → CPC para repartidores
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
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '${cleanRepartidorId}'
              AND OPP.ANOREPARTO >= ${new Date().getFullYear() - 1}
              ${clientFilter}
            GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO
            ORDER BY OPP.ANOREPARTO DESC, OPP.MESREPARTO DESC
            FETCH FIRST 12 ROWS ONLY
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

        // Query to get daily aggregates with JAVIER status
        const sql = `
            SELECT 
                OPP.DIAREPARTO as DIA,
                OPP.MESREPARTO as MES,
                OPP.ANOREPARTO as ANO,
                COUNT(DISTINCT CPC.NUMEROALBARAN) as TOTAL_ALBARANES,
                SUM(CASE WHEN DS.STATUS = 'ENTREGADO' THEN 1 ELSE 0 END) as ENTREGADOS
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN JAVIER.DELIVERY_STATUS DS 
                ON DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(CPC.SERIEALBARAN) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))
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
                DS.STATUS as ESTADO_ENTREGA,
                DS.FIRMA_PATH
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
            LEFT JOIN JAVIER.DELIVERY_STATUS DS 
                ON DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(CPC.SERIEALBARAN) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))
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

        // Last 6 months
        const dateLimit = moment().subtract(6, 'months').format('YYYYMMDD');

        let sql = `
            SELECT DISTINCT
                TRIM(CPC.CODIGOCLIENTEALBARAN) as ID,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NAME,
                TRIM(COALESCE(CLI.DIRECCION, '')) as ADDRESS,
                COUNT(CPC.NUMEROALBARAN) as TOTAL_DOCS
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI 
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) >= ${dateLimit}
              AND TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanRepartidorId})
        `;

        if (search) {
            const cleanSearch = search.toUpperCase().replace(/'/g, "''");
            sql += ` AND (UPPER(CLI.NOMBRECLIENTE) LIKE '%${cleanSearch}%' OR UPPER(CLI.NOMBREALTERNATIVO) LIKE '%${cleanSearch}%')`;
        }

        sql += ` GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')), TRIM(COALESCE(CLI.DIRECCION, ''))
                 ORDER BY NAME FETCH FIRST 50 ROWS ONLY`;

        logger.info(`[REPARTIDOR] History SQL with repartidorId ${repartidorId}: ${sql.replace(/\s+/g, ' ')}`);
        const rows = await query(sql, false);
        logger.info(`[REPARTIDOR] Found ${rows.length} historical clients for repartidor ${repartidorId} since ${dateLimit}`);

        const clients = rows.map(r => ({
            id: (r.ID || '').trim(),
            name: (r.NAME || '').trim() || `CLIENTE ${r.ID}`,
            address: (r.ADDRESS || '').trim(),
            totalDocuments: r.TOTAL_DOCS || 0
        }));

        res.json({ success: true, clients });
    } catch (e) {
        logger.error(`[REPARTIDOR] Error getting history clients: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =============================================================================
// GET /history/documents/:clientId
// Get documents for a specific client
// =============================================================================
router.get('/history/documents/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        const { repartidorId } = req.query; // Optional: filter only docs delivered by this repartidor

        let sql = `
            SELECT 
                CPC.ANODOCUMENTO || '-' || RIGHT('0' || CPC.MESDOCUMENTO, 2) || '-' || RIGHT('0' || CPC.DIADOCUMENTO, 2) as FECHA,
                CPC.NUMEROALBARAN,
                CPC.SERIEALBARAN,
                CPC.EJERCICIOALBARAN,
                CAC.NUMEROFACTURA,
                CAC.SERIEFACTURA,
                CAC.EJERCICIOFACTURA,
                CPC.IMPORTETOTAL as AMOUNT,
                COALESCE(CVC.IMPORTEPENDIENTE, 0) as PENDING,
                DS.STATUS,
                DS.FIRMA_PATH
            FROM DSEDAC.CPC CPC
            INNER JOIN DSEDAC.OPP OPP
                ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            LEFT JOIN JAVIER.DELIVERY_STATUS DS 
                ON DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(CPC.SERIEALBARAN) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))
            WHERE TRIM(CPC.CODIGOCLIENTEALBARAN) = '${clientId}'
        `;

        if (repartidorId) {
            const cleanIds = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');
            sql += ` AND TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanIds})`;
        }

        sql += ` ORDER BY FECHA DESC FETCH FIRST 100 ROWS ONLY`;

        const rows = await query(sql, false);

        const documents = rows.map(r => ({
            id: `${r.EJERCICIOALBARAN}-${r.SERIEALBARAN}-${r.NUMEROALBARAN}`,
            type: (r.NUMEROFACTURA && r.NUMEROFACTURA > 0) ? 'factura' : 'albaran',
            number: (r.NUMEROFACTURA && r.NUMEROFACTURA > 0) ? r.NUMEROFACTURA : r.NUMEROALBARAN,
            date: r.FECHA,
            amount: parseFloat(r.AMOUNT) || 0,
            pending: parseFloat(r.PENDING) || 0,
            status: (r.STATUS === 'ENTREGADO') ? 'delivered' : 'notDelivered', // Mapping
            hasSignature: !!r.FIRMA_PATH
        }));

        res.json({ success: true, documents });
    } catch (e) {
        logger.error(`[REPARTIDOR] Error getting client documents: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =============================================================================
// GET /history/objectives/:repartidorId
// Get monthly commission progress
// =============================================================================
router.get('/history/objectives/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const cleanIds = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');
        const currentYear = new Date().getFullYear();

        // Calculate for each month of current year
        const sql = `
            SELECT 
                OPP.MESREPARTO as MONTH,
                SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 THEN CPC.IMPORTETOTAL 
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
            WHERE OPP.ANOREPARTO = ${currentYear}
              AND TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanIds})
            GROUP BY OPP.MESREPARTO
            ORDER BY MONTH DESC
        `;

        const rows = await query(sql, false);
        const monthNames = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

        const objectives = rows.map(r => {
            const collectable = parseFloat(r.TOTAL_COBRABLE) || 0;
            const collected = parseFloat(r.TOTAL_COBRADO) || 0;
            const percentage = collectable > 0 ? (collected / collectable) * 100 : 0;

            return {
                month: monthNames[r.MONTH],
                year: currentYear,
                monthNum: r.MONTH,
                collectable,
                collected,
                percentage,
                thresholdMet: percentage >= REPARTIDOR_CONFIG.threshold
            };
        });

        res.json({ success: true, objectives });
    } catch (e) {
        logger.error(`[REPARTIDOR] Error getting objectives: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;

