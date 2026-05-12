/**
 * COBROS MODULE (Legacy JS implementation)
 * Antigravity - GMP Sales App
 */

const express = require('express');
const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const logger = require('../middleware/logger');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Helper to sanitize code (kept for non-SQL uses)
function sanitizeCode(val) {
    if (val == null) return '';
    return String(val).trim();
}

/**
 * GET /api/cobros/:codigoCliente/pendientes
 * Solo devuelve pedidos confirmados pendientes de cobro
 */
router.get('/:codigoCliente/pendientes', async (req, res) => {
    try {
        const codigoCliente = sanitizeCode(req.params.codigoCliente);
        logger.info(`[COBROS] Obteniendo pendientes para cliente: ${codigoCliente}`);

        // Req #15: Read real debt from DSEDAC.CVC (ERP unpaid invoices)
        // CVC = Cabeceras Vencimientos Cobros (real document-level debt from ERP)
        const sql = `
            SELECT
                TRIM(C.CVCDRF) AS SERIE_DOCUMENTO,
                C.CVNUDC AS NUMERO_DOCUMENTO,
                C.CVXDDC AS XDE,
                TRIM(C.CVCDCL) AS CODIGO_CLIENTE,
                C.CVIMVT AS IMPORTE_TOTAL,
                C.CVIMCO AS IMPORTE_COBRADO,
                (C.CVIMVT - C.CVIMCO) AS IMPORTE_PENDIENTE,
                C.CVAADC AS ANO_DOCUMENTO,
                C.CVMMDC AS MES_DOCUMENTO,
                C.CVDDDC AS DIA_DOCUMENTO,
                C.CVFCVC AS FECHA_VENCIMIENTO,
                TRIM(C.CVSEEM) AS SUBEMPRESA,
                TRIM(C.CVCDTD) AS TIPO_DOCUMENTO
            FROM DSEDAC.CVC C
            WHERE TRIM(C.CVCDCL) = ?
              AND (C.CVIMVT - C.CVIMCO) > 0.01
            ORDER BY C.CVFCVC ASC
            FETCH FIRST 100 ROWS ONLY`;

        const cacheKey = `cobros:pendientes:cvc:${codigoCliente}`;
        let resultado;
        try {
            resultado = await cachedQuery(
                (sql) => queryWithParams(sql, [codigoCliente]),
                sql,
                cacheKey,
                TTL.MEDIUM
            );
        } catch (cvcErr) {
            logger.warn(`[COBROS] CVC query failed, falling back to PEDIDOS_CAB: ${cvcErr.message}`);
            // Fallback to PEDIDOS_CAB for environments without CVC
            const fallbackSql = `
                SELECT PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
                    PC.DIADOCUMENTO, PC.MESDOCUMENTO, PC.ANODOCUMENTO,
                    PC.IMPORTETOTAL, PC.TIPOVENTA, PC.ESTADO
                FROM JAVIER.PEDIDOS_CAB PC
                WHERE TRIM(PC.CODIGOCLIENTE) = ?
                  AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
                  AND PC.IMPORTETOTAL > 0
                ORDER BY PC.ANODOCUMENTO DESC, PC.MESDOCUMENTO DESC
                FETCH FIRST 100 ROWS ONLY`;
            resultado = await queryWithParams(fallbackSql, [codigoCliente]);
        }

        const format2 = (n) => String(n).padStart(2, '0');

        const cobros = (resultado || []).map(row => {
            // CVC format
            if (row.IMPORTE_PENDIENTE !== undefined) {
                const dia = format2(row.DIA_DOCUMENTO || 1);
                const mm = format2(row.MES_DOCUMENTO || 1);
                const ano = row.ANO_DOCUMENTO || 2024;
                const serie = (row.SERIE_DOCUMENTO || '').trim();
                const numero = row.NUMERO_DOCUMENTO || 0;
                const tipoDoc = (row.TIPO_DOCUMENTO || 'FAC').trim();
                return {
                    id: `cvc_${serie}_${numero}_${row.XDE || 1}`,
                    tipo: tipoDoc === 'CAC' ? 'albaran' : 'factura',
                    referencia: `${serie}-${numero}`,
                    fecha: `${ano}-${mm}-${dia}T00:00:00.000Z`,
                    fechaVencimiento: row.FECHA_VENCIMIENTO || null,
                    importeTotal: parseFloat(row.IMPORTE_TOTAL) || 0,
                    importePendiente: parseFloat(row.IMPORTE_PENDIENTE) || 0,
                    importeCobrado: parseFloat(row.IMPORTE_COBRADO) || 0,
                    descripcion: `${tipoDoc} ${serie}-${numero}`
                };
            }
            // Fallback PEDIDOS_CAB format
            return {
                id: `ped_${row.ID}`,
                tipo: 'pedido_app',
                referencia: `${row.SERIEPEDIDO}-${row.NUMEROPEDIDO}`,
                fecha: `${row.ANODOCUMENTO}-${format2(row.MESDOCUMENTO)}-${format2(row.DIADOCUMENTO)}T00:00:00.000Z`,
                importeTotal: parseFloat(row.IMPORTETOTAL) || 0,
                importePendiente: parseFloat(row.IMPORTETOTAL) || 0,
                descripcion: `Pedido ${row.SERIEPEDIDO}-${row.NUMEROPEDIDO}`
            };
        });

        let total = 0;
        cobros.forEach(c => { total += c.importePendiente; });

        res.json({
            success: true,
            cobros,
            resumen: {
                totalPendiente: total,
                documentos: { cantidad: cobros.length, total },
                source: resultado?.[0]?.IMPORTE_PENDIENTE !== undefined ? 'CVC' : 'PEDIDOS_CAB'
            }
        });
    } catch (error) {
        logger.error('[COBROS] Error: ' + error.message);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

/**
 * GET /api/cobros/:codigoCliente/estado
 */
router.get('/:codigoCliente/estado', async (req, res) => {
    try {
        const codigoCliente = sanitizeCode(req.params.codigoCliente);
        let totalPendiente = 0;
        let numPedidos = 0;

        // Req #15: Read real debt from CVC
        try {
            const rows = await queryWithParams(`
                SELECT COALESCE(SUM(C.CVIMVT - C.CVIMCO), 0) AS TOTAL_PENDIENTE,
                       COUNT(*) AS NUM_DOCS
                FROM DSEDAC.CVC C
                WHERE TRIM(C.CVCDCL) = ?
                  AND (C.CVIMVT - C.CVIMCO) > 0.01
            `, [codigoCliente], []);
            totalPendiente = parseFloat(rows?.[0]?.TOTAL_PENDIENTE) || 0;
            numPedidos = parseInt(rows?.[0]?.NUM_DOCS) || 0;
        } catch (cvcErr) {
            // Fallback to PEDIDOS_CAB
            try {
                const rows = await queryWithParams(`
                    SELECT COALESCE(SUM(PC.IMPORTETOTAL), 0) AS TOTAL_PENDIENTE,
                           COUNT(*) AS NUM_PEDIDOS
                    FROM JAVIER.PEDIDOS_CAB PC
                    WHERE TRIM(PC.CODIGOCLIENTE) = ?
                      AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
                      AND PC.IMPORTETOTAL > 0
                `, [codigoCliente], []);
                totalPendiente = parseFloat(rows?.[0]?.TOTAL_PENDIENTE) || 0;
                numPedidos = parseInt(rows?.[0]?.NUM_PEDIDOS) || 0;
            } catch (e) {
                logger.warn('[COBROS] Error calculando estado: ' + e.message);
            }
        }

        // Get credit limit from CLI
        let limiteCredito = 0;
        try {
            const cliRows = await queryWithParams(`
                SELECT LIMITECREDITO FROM DSEDAC.CLI
                WHERE TRIM(CODIGOCLIENTE) = ?
                FETCH FIRST 1 ROW ONLY
            `, [codigoCliente], []);
            limiteCredito = parseFloat(cliRows?.[0]?.LIMITECREDITO) || 0;
        } catch (_) { /* no credit limit data */ }

        res.json({
            success: true,
            estadoCliente: {
                codigo: codigoCliente,
                nombre: '',
                limiteCredito: 0,
                totalPendiente,
                diasMora: 0,
                estado: totalPendiente > 0 ? 'EN_ROJO' : 'ACTIVO',
                motivo: numPedidos > 0 ? `${numPedidos} pedido(s) pendiente(s)` : null
            }
        });
    } catch (error) {
        logger.error('[COBROS] Error estado: ' + error.message);
        res.status(500).json({ success: false, error: 'Error obteniendo estado del cliente' });
    }
});

/**
 * POST /api/cobros/:codigoCliente/registrar
 */
router.post('/:codigoCliente/registrar', async (req, res) => {
    try {
        const codigoCliente = sanitizeCode(req.params.codigoCliente);
        const { 
            referencia, importe, formaPago, observaciones,
            tipoVenta, tipoModo, tipoUsuario, codigoUsuario
        } = req.body;

        logger.info(`[COBROS] Registrando cobro para ${codigoCliente}: ${importe}ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬`);

        // COBROS table created at startup by init-tables.js

        await queryWithParams(
            `INSERT INTO JAVIER.COBROS (
                ID, CODIGO_CLIENTE, REFERENCIA, IMPORTE, FORMA_PAGO,
                TIPO_VENTA, TIPO_MODO, TIPO_USUARIO, CODIGO_USUARIO,
                OBSERVACIONES
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                uuidv4(), codigoCliente, referencia || '', parseFloat(importe) || 0,
                formaPago || 'CONTADO', tipoVenta || 'CC', tipoModo || 'NORMAL',
                tipoUsuario || 'COMERCIAL', codigoUsuario || '',
                (observaciones || '').substring(0, 500)
            ], false
        );

        res.json({ success: true, mensaje: 'Cobro registrado correctamente' });

    } catch (error) {
        logger.error('[COBROS] Error registrando: ' + error.message);
        res.status(500).json({ success: false, error: 'Error registrando cobro' });
    }
});

/**
 * GET /api/cobros/pending-summary/:vendedorCode
 * Returns total pending amounts grouped by client for a given vendor
 * Supports single vendor, multiple vendors (comma-separated), or ALL
 */
router.get('/pending-summary/:vendedorCode', async (req, res) => {
    try {
        const vendedorCodeParam = req.params.vendedorCode;
        logger.info(`[COBROS] Pending summary for vendor: ${vendedorCodeParam}`);

        // Parse vendor codes - support single, multiple (comma-separated), or ALL
        const isAll = vendedorCodeParam.toUpperCase() === 'ALL';
        const vendorCodes = isAll 
            ? [] 
            : vendedorCodeParam.split(',').map(v => v.trim()).filter(v => v.length > 0);
        
        // For many vendor codes, embed directly in SQL to avoid ODBC parameter limit (CWB0111)
        // IBM i ODBC driver has issues with 90+ parameters in IN clause
        const MAX_PARAMS = 50;
        const useParamBinding = vendorCodes.length <= MAX_PARAMS;
        
                let vendorFilter = '';
        let vendorParams = [];
        
        if (!isAll) {
            if (useParamBinding) {
                vendorFilter = AND TRIM(CLP.VENDEDORCOMERCIAL) IN ();
                vendorParams = vendorCodes;
            } else {
                const sanitized = vendorCodes.map(v => '').join(',');
                vendorFilter = AND TRIM(CLP.VENDEDORCOMERCIAL) IN ();
            }
        }

        const sql = \
          SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                 SUM(CVC.IMPORTEPENDIENTE) AS TOTAL_PENDIENTE,
                 COUNT(*) AS NUM_DOCS,
                 SUM(CASE WHEN (CVC.ANOVENCIMIENTO*10000+CVC.MESVENCIMIENTO*100+CVC.DIAVENCIMIENTO) 
                     < (YEAR(CURRENT_DATE)*10000+MONTH(CURRENT_DATE)*100+DAY(CURRENT_DATE))
                     THEN CVC.IMPORTEPENDIENTE ELSE 0 END) AS TOTAL_VENCIDO
          FROM DSEDAC.CVC CVC
          LEFT JOIN DSEDAC.CLP CLP ON TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
          WHERE CVC.IMPORTEPENDIENTE <> 0
            AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
            \
          GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN)
          ORDER BY TOTAL_PENDIENTE DESC
        \;

        const cacheKeyVendedor = `cobros:pending-summary:${vendedorCodeParam}`;
        const rows = await cachedQuery(query, sql, cacheKeyVendedor, TTL.SHORT);

        const summary = {};
        let grandTotal = 0;
        (rows || []).forEach(r => {
            const code = (r.CLIENTE || '').trim();
            const total = parseFloat(r.TOTAL_PENDIENTE) || 0;
            const count = parseInt(r.NUM_PEDIDOS) || 0;
            summary[code] = { total, count };
            grandTotal += total;
        });

        res.json({
            success: true,
            summary,
            grandTotal,
            clientCount: Object.keys(summary).length,
        });

    } catch (error) {
        logger.error('[COBROS] Error pending-summary: ' + error.message);
        res.status(500).json({ success: false, error: 'Error obteniendo resumen' });
    }
});

module.exports = router;
