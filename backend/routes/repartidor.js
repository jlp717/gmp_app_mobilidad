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

        // Get all deliveries assigned to this repartidor with their collections
        // Usamos CODIGOVENDEDOR como fallback ya que TRANSPORTISTA no siempre está poblado
        const sql = `
            SELECT 
                TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')) as NOMBRE_CLIENTE,
                CAC.CODIGOFORMAPAGO as FORMA_PAGO,
                SUM(CAC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 
                    THEN CAC.IMPORTETOTAL 
                    ELSE CAC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
                END) as TOTAL_COBRADO,
                COUNT(*) as NUM_DOCUMENTOS
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEFACTURA)
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
                AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
            WHERE CAC.ANODOCUMENTO = ${selectedYear}
              AND CAC.MESDOCUMENTO = ${selectedMonth}
              AND TRIM(CAC.CODIGOVENDEDOR) = '${cleanRepartidorId}'
            GROUP BY TRIM(CAC.CODIGOCLIENTEFACTURA), TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')), CAC.CODIGOFORMAPAGO
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
        const sql = `
            SELECT 
                CAC.DIADOCUMENTO as DIA,
                SUM(CAC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 
                    THEN CAC.IMPORTETOTAL 
                    ELSE CAC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0) 
                END) as TOTAL_COBRADO
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
                AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
            WHERE CAC.ANODOCUMENTO = ${selectedYear}
              AND CAC.MESDOCUMENTO = ${selectedMonth}
              AND TRIM(CAC.CODIGOVENDEDOR) = '${cleanRepartidorId}'
            GROUP BY CAC.DIADOCUMENTO
            ORDER BY CAC.DIADOCUMENTO
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
// GET /history/clients/:repartidorId
// Lista de clientes atendidos por el repartidor
// =============================================================================
router.get('/history/clients/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { search } = req.query;

        logger.info(`[REPARTIDOR] Getting client list for ${repartidorId}`);

        const cleanRepartidorId = repartidorId.toString().trim();
        let whereSearch = '';
        if (search && search.length >= 2) {
            const s = search.toUpperCase().replace(/'/g, "''"); // Escapar comillas simples
            whereSearch = `AND (TRIM(CLI.CODIGOCLIENTE) LIKE '%${s}%' OR UPPER(COALESCE(CLI.NOMBRECLIENTE, '')) LIKE '%${s}%')`;
        }

        const sql = `
            SELECT DISTINCT
                TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')) as NOMBRE,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCION,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACION,
                COUNT(*) as TOTAL_DOCUMENTOS
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEFACTURA)
            WHERE TRIM(CAC.CODIGOVENDEDOR) = '${cleanRepartidorId}'
              AND CAC.ANODOCUMENTO >= ${new Date().getFullYear() - 1}
              ${whereSearch}
            GROUP BY TRIM(CAC.CODIGOCLIENTEFACTURA), TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')), TRIM(COALESCE(CLI.DIRECCION, '')), TRIM(COALESCE(CLI.POBLACION, ''))
            ORDER BY TOTAL_DOCUMENTOS DESC
            FETCH FIRST 50 ROWS ONLY
        `;

        let rows = [];
        try {
            rows = await query(sql, false) || [];
        } catch (queryError) {
            logger.warn(`[REPARTIDOR] Query error in history/clients: ${queryError.message}`);
            return res.json({ success: true, clients: [] });
        }

        const clients = rows.map(row => ({
            id: row.CLIENTE || '',
            name: row.NOMBRE || row.CLIENTE || 'Cliente',
            address: `${row.DIRECCION || ''}, ${row.POBLACION || ''}`.trim().replace(/^,\s*|,\s*$/g, '') || '',
            totalDocuments: row.TOTAL_DOCUMENTOS || 0
        }));

        res.json({
            success: true,
            clients
        });

    } catch (error) {
        logger.error(`[REPARTIDOR] Error in history/clients: ${error.message}`);
        // Devolver respuesta vacía en lugar de error 500
        res.json({ success: true, clients: [], warning: error.message });
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

        let transportistaFilter = '';
        if (repartidorId) {
            transportistaFilter = `AND TRIM(CAC.CODIGOVENDEDOR) = '${repartidorId.toString().trim()}'`;
        }

        const sql = `
            SELECT 
                CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA,
                CAC.SERIEFACTURA,
                CAC.EJERCICIOALBARAN,
                CAC.ANODOCUMENTO as ANO,
                CAC.MESDOCUMENTO as MES,
                CAC.DIADOCUMENTO as DIA,
                CAC.IMPORTETOTAL,
                COALESCE(CVC.IMPORTEPENDIENTE, 0) as IMPORTE_PENDIENTE,
                CAC.CODIGOFORMAPAGO
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
                AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
            WHERE TRIM(CAC.CODIGOCLIENTEFACTURA) = '${clientId.trim()}'
              AND CAC.ANODOCUMENTO >= ${new Date().getFullYear() - 1}
              ${transportistaFilter}
            ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC
            FETCH FIRST 50 ROWS ONLY
        `;

        const rows = await query(sql, false);

        const documents = rows.map(row => {
            const isFactura = row.NUMEROFACTURA && row.NUMEROFACTURA > 0;
            const importe = parseFloat(row.IMPORTETOTAL) || 0;
            const pendiente = parseFloat(row.IMPORTE_PENDIENTE) || 0;

            let status = 'delivered';
            if (pendiente >= importe) status = 'notDelivered';
            else if (pendiente > 0) status = 'partial';

            return {
                id: isFactura
                    ? `FAC-${row.EJERCICIOALBARAN}-${row.NUMEROFACTURA}`
                    : `ALB-${row.EJERCICIOALBARAN}-${row.NUMEROALBARAN}`,
                type: isFactura ? 'factura' : 'albaran',
                number: isFactura ? row.NUMEROFACTURA : row.NUMEROALBARAN,
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
            clientFilter = `AND TRIM(CAC.CODIGOCLIENTEFACTURA) = '${clientId.trim()}'`;
        }

        const sql = `
            SELECT 
                CAC.ANODOCUMENTO as ANO,
                CAC.MESDOCUMENTO as MES,
                SUM(CAC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 
                    THEN CAC.IMPORTETOTAL 
                    ELSE CAC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
                END) as TOTAL_COBRADO
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
                AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
            WHERE TRIM(CAC.CODIGOVENDEDOR) = '${cleanRepartidorId}'
              AND CAC.ANODOCUMENTO >= ${new Date().getFullYear() - 1}
              ${clientFilter}
            GROUP BY CAC.ANODOCUMENTO, CAC.MESDOCUMENTO
            ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC
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

module.exports = router;
