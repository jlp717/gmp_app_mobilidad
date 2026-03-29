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
 * Solo devuelve pedidos confirmados pendientes de cobro
 */
router.get('/:codigoCliente/pendientes', async (req, res) => {
    try {
        const codigoCliente = sanitizeCode(req.params.codigoCliente);
        logger.info(`[COBROS] Obteniendo pendientes para cliente: ${codigoCliente}`);

        // Ensure COBROS table exists for tracking payments
        let cobrosTableExists = false;
        try {
            await query(`SELECT 1 FROM JAVIER.COBROS FETCH FIRST 1 ROW ONLY`);
            cobrosTableExists = true;
        } catch(e) {
            try {
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
                cobrosTableExists = true;
                logger.info('[COBROS] Tabla JAVIER.COBROS creada correctamente');
            } catch(createErr) {
                logger.error('[COBROS] Error creando tabla: ' + createErr.message);
            }
        }

        // Check if ORIGEN column exists in PEDIDOS_CAB
        let origenExists = false;
        try {
            await query(`SELECT ORIGEN FROM JAVIER.PEDIDOS_CAB FETCH FIRST 1 ROW ONLY`);
            origenExists = true;
        } catch(e) {
            logger.warn('[COBROS] Columna ORIGEN no existe en PEDIDOS_CAB, usando todos los pedidos');
        }

        // Build query based on whether ORIGEN column exists
        let sql;
        if (origenExists) {
            // Query only APP-CREATED orders (ORIGEN = 'A')
            sql = `
            SELECT
                PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
                PC.DIADOCUMENTO, PC.MESDOCUMENTO, PC.ANODOCUMENTO,
                PC.IMPORTETOTAL, PC.TIPOVENTA, PC.ESTADO
            FROM JAVIER.PEDIDOS_CAB PC
            WHERE TRIM(PC.CODIGOCLIENTE) = '${codigoCliente}'
              AND PC.ORIGEN = 'A'
              AND PC.ESTADO = 'CONFIRMADO'
              AND PC.IMPORTETOTAL > 0`;
        } else {
            // Query all confirmed orders
            sql = `
            SELECT
                PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
                PC.DIADOCUMENTO, PC.MESDOCUMENTO, PC.ANODOCUMENTO,
                PC.IMPORTETOTAL, PC.TIPOVENTA, PC.ESTADO
            FROM JAVIER.PEDIDOS_CAB PC
            WHERE TRIM(PC.CODIGOCLIENTE) = '${codigoCliente}'
              AND PC.ESTADO = 'CONFIRMADO'
              AND PC.IMPORTETOTAL > 0`;
        }

        // Exclude already paid orders
        if (cobrosTableExists) {
            sql += ` AND NOT EXISTS (
                SELECT 1 FROM JAVIER.COBROS JC 
                WHERE JC.CODIGO_CLIENTE = TRIM(PC.CODIGOCLIENTE) 
                  AND JC.REFERENCIA LIKE '%' || TRIM(PC.SERIEPEDIDO) || '-' || CAST(PC.NUMEROPEDIDO AS VARCHAR(20)) || '%'
            )`;
        }

        sql += ` ORDER BY PC.ANODOCUMENTO DESC, PC.MESDOCUMENTO DESC, PC.DIADOCUMENTO DESC FETCH FIRST 100 ROWS ONLY`;

        const resultado = await query(sql, []);

        const ahora = new Date();
        const mesActual = ahora.getMonth() + 1;
        const anoActual = ahora.getFullYear();

        const format2 = (n) => String(n).padStart(2, '0');
        
        const cobros = (resultado && resultado.length > 0 ? resultado : []).map(row => {
            const mes = Number(row.MESDOCUMENTO);
            const ano = Number(row.ANODOCUMENTO);
            const esDelMesActual = ano === anoActual && mes === mesActual;

            const referencia = `${row.SERIEPEDIDO}-${row.NUMEROPEDIDO}`;

            const dia = format2(row.DIADOCUMENTO);
            const mm = format2(row.MESDOCUMENTO);
            const fechaStr = `${ano}-${mm}-${dia}T00:00:00.000Z`;

            return {
                id: uuidv4(),
                tipo: 'pedido_app',
                referencia,
                fecha: fechaStr,
                importeTotal: parseFloat(row.IMPORTETOTAL) || 0,
                importePendiente: parseFloat(row.IMPORTETOTAL) || 0,
                descripcion: `Pedido ${row.SERIEPEDIDO}-${row.NUMEROPEDIDO}`
            };
        });

        // Sum up total
        let total = 0;
        
        cobros.forEach(c => {
            total += c.importePendiente;
        });

        res.json({
            success: true,
            cobros,
            resumen: {
                totalPendiente: total,
                pedidos: { cantidad: cobros.length, total: total }
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
