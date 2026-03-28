/**
 * COBROS MODULE (Legacy JS implementation)
 * Antigravity - GMP Sales App
 */

const express = require('express');
const { query } = require('../config/db');
const logger = require('../middleware/logger');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Helper to sanitize code
function sanitizeCode(val) {
    if (val == null) return '';
    return String(val).replace(/'/g, "''").trim();
}

/**
 * GET /api/cobros/:codigoCliente/pendientes
 */
router.get('/:codigoCliente/pendientes', async (req, res) => {
    try {
        const codigoCliente = sanitizeCode(req.params.codigoCliente);
        logger.info(`[COBROS] Obteniendo pendientes para cliente: ${codigoCliente}`);

        // Ensure table exists before querying it
        try {
            await query(`SELECT 1 FROM JAVIER.COBROS FETCH FIRST 1 ROW ONLY`);
        } catch(e) {
            await query(`
                CREATE TABLE JAVIER.COBROS (
                    ID VARCHAR(64) PRIMARY KEY,
                    CODIGO_CLIENTE VARCHAR(20),
                    REFERENCIA VARCHAR(100),
                    IMPORTE DECIMAL(10,2),
                    FORMA_PAGO VARCHAR(50),
                    TIPO_VENTA VARCHAR(20),
                    TIPO_MODO VARCHAR(20),
                    TIPO_USUARIO VARCHAR(20),
                    CODIGO_USUARIO VARCHAR(20),
                    OBSERVACIONES VARCHAR(500),
                    FECHA TIMESTAMP DEFAULT CURRENT TIMESTAMP
                )
            `);
            logger.info('[COBROS] Tabla JAVIER.COBROS creada correctamente en el GET');
        }

        const sql = `
        SELECT
          CAC.SUBEMPRESAALBARAN,
          CAC.EJERCICIOALBARAN,
          CAC.SERIEALBARAN,
          CAC.TERMINALALBARAN,
          CAC.NUMEROALBARAN,
          CAC.NUMEROFACTURA,
          CAC.SERIEFACTURA,
          CAC.ANODOCUMENTO,
          CAC.MESDOCUMENTO,
          CAC.DIADOCUMENTO,
          CAC.IMPORTETOTAL,
          COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) as IMPORTE_PENDIENTE,
          CAC.CODIGOTIPOALBARAN
        FROM DSEDAC.CAC
        LEFT JOIN DSEDAC.CVC 
          ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
          AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
          AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
          AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
        WHERE TRIM(CAC.CODIGOCLIENTEFACTURA) = '${codigoCliente}'
          AND COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0
          -- Excluir los que ya hemos cobrado localmente
          AND NOT EXISTS (
            SELECT 1 FROM JAVIER.COBROS JC 
            WHERE JC.CODIGO_CLIENTE = CAC.CODIGOCLIENTEFACTURA 
              AND JC.REFERENCIA LIKE '%' || 
                (CASE WHEN CAC.NUMEROFACTURA > 0 
                      THEN TRIM(CAC.SERIEFACTURA) || '-' || CAST(CAC.NUMEROALBARAN AS VARCHAR(20))
                      ELSE CAST(CAC.NUMEROALBARAN AS VARCHAR(20)) END) || '%'
          )
        ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC
        FETCH FIRST 100 ROWS ONLY`;

        const resultado = await query(sql, []);

        const ahora = new Date();
        const mesActual = ahora.getMonth() + 1;
        const anoActual = ahora.getFullYear();

        const format2 = (n) => String(n).padStart(2, '0');
        
        const cobros = Math.floor(resultado.length > 0 ? resultado : []).map(row => {
            const mes = Number(row.MESDOCUMENTO);
            const ano = Number(row.ANODOCUMENTO);
            const esFactura = Number(row.NUMEROFACTURA) > 0;
            const esDelMesActual = ano === anoActual && mes === mesActual;

            let tipo = 'normal';
            if (esFactura) tipo = esDelMesActual ? 'albaran' : 'factura';

            const referencia = esFactura
                ? `${row.SERIEFACTURA}-${row.NUMEROFACTURA}`
                : `ALB-${row.NUMEROALBARAN}`;

            const dia = format2(row.DIADOCUMENTO);
            const mm = format2(row.MESDOCUMENTO);
            const fechaStr = `${ano}-${mm}-${dia}T00:00:00.000Z`;

            return {
                id: uuidv4(),
                tipo,
                referencia,
                fecha: fechaStr,
                importeTotal: parseFloat(row.IMPORTETOTAL) || 0,
                importePendiente: parseFloat(row.IMPORTE_PENDIENTE) || 0,
                descripcion: esFactura
                    ? `Factura ${row.SERIEFACTURA}-${row.NUMEROFACTURA}`
                    : `Albarán ${row.NUMEROALBARAN}`
            };
        });

        // Sum up total
        let total = 0;
        let cantAlbaranes = 0;
        let totalAlbaranes = 0;
        let cantFacturas = 0;
        let totalFacturas = 0;
        
        cobros.forEach(c => {
            total += c.importePendiente;
            if (c.tipo === 'albaran') {
                cantAlbaranes++;
                totalAlbaranes += c.importePendiente;
            } else if (c.tipo === 'factura') {
                cantFacturas++;
                totalFacturas += c.importePendiente;
            }
        });

        res.json({
            success: true,
            cobros,
            resumen: {
                totalPendiente: total,
                albaranes: { cantidad: cantAlbaranes, total: totalAlbaranes },
                facturas: { cantidad: cantFacturas, total: totalFacturas }
            }
        });

    } catch (error) {
        logger.error('[COBROS] Error: ' + error.message);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
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

        logger.info(`[COBROS] Registrando cobro para ${codigoCliente}: ${importe}€`);

        // Create table dynamically if it doesn't exist
        try {
            await query(`SELECT 1 FROM JAVIER.COBROS FETCH FIRST 1 ROW ONLY`);
        } catch(e) {
            await query(`
                CREATE TABLE JAVIER.COBROS (
                    ID VARCHAR(64) PRIMARY KEY,
                    CODIGO_CLIENTE VARCHAR(20),
                    REFERENCIA VARCHAR(100),
                    IMPORTE DECIMAL(10,2),
                    FORMA_PAGO VARCHAR(50),
                    TIPO_VENTA VARCHAR(20),
                    TIPO_MODO VARCHAR(20),
                    TIPO_USUARIO VARCHAR(20),
                    CODIGO_USUARIO VARCHAR(20),
                    OBSERVACIONES VARCHAR(500),
                    FECHA TIMESTAMP DEFAULT CURRENT TIMESTAMP
                )
            `);
            logger.info('[COBROS] Tabla JAVIER.COBROS creada correctamente');
        }

        await query(
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

module.exports = router;
