/**
 * COBROS MODULE (Legacy JS implementation)
 * Antigravity - GMP Sales App
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL, invalidateCache: invalidateCachePattern } = require('../services/redis-cache');
const logger = require('../middleware/logger');
const { v4: uuidv4 } = require('uuid');

// Schema dinamico: JAVIER en dev, DSEDAC en produccion (ver PEDIDOS_CONFIRMATION_SCHEMA en .env).
const APP_SCHEMA = String(process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER').trim().toUpperCase();

// Req: invalidate cobros cache for a client after a mutation. Best-effort, no throw.
async function invalidateCobrosCache(codigoCliente) {
    try {
        const cli = String(codigoCliente || '').trim();
        if (!cli) return;
        await Promise.all([
            invalidateCachePattern(`cobros:pendientes:cvc:${cli}`),
            invalidateCachePattern('cobros:pending-summary:*'),
        ]);
    } catch (err) {
        logger.warn(`[COBROS] Cache invalidation skipped: ${err.message}`);
    }
}

const router = express.Router();

// Req #19: Rate limiter para POST /cobros/registrar (escritura sensible)
// 10 cobros/min por IP+usuario para prevenir abuso/duplicados accidentales.
const registrarCobroLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const user = req.user?.codigo || req.user?.codigoVendedor || req.user?.userId || 'anon';
        return `${req.ip}::${user}`;
    },
    message: { success: false, error: 'Demasiados intentos. Espera un minuto antes de registrar más cobros.' }
});

// Helper to sanitize code (kept for non-SQL uses)
function sanitizeCode(val) {
    if (val == null) return '';
    return String(val).trim();
}

// Req #15: Calcula estado VENCIDO/PENDIENTE/AL_DIA a partir de fecha vencimiento.
function computeEstadoVencimiento(fechaVencimientoIso, fechaDocumentoIso) {
    if (!fechaVencimientoIso) return 'PENDIENTE';
    const venc = new Date(fechaVencimientoIso);
    if (isNaN(venc.getTime())) return 'PENDIENTE';
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    venc.setHours(0, 0, 0, 0);
    if (venc.getTime() < now.getTime()) return 'VENCIDO';
    return 'PENDIENTE';
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
            logger.warn(`[COBROS] CVC query failed (will use PEDIDOS_CAB fallback): ${cvcErr.message}`);
            // Fallback to PEDIDOS_CAB for environments without CVC
            const fallbackSql = `
                SELECT PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
                    PC.DIADOCUMENTO, PC.MESDOCUMENTO, PC.ANODOCUMENTO,
                    PC.IMPORTETOTAL, PC.TIPOVENTA, PC.ESTADO
                FROM ${APP_SCHEMA}.PEDIDOS_CAB PC
                WHERE TRIM(PC.CODIGOCLIENTE) = ?
                  AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
                  AND PC.IMPORTETOTAL > 0
                ORDER BY PC.ANODOCUMENTO DESC, PC.MESDOCUMENTO DESC
                FETCH FIRST 100 ROWS ONLY`;
            resultado = await queryWithParams(fallbackSql, [codigoCliente]);
        }

        const format2 = (n) => String(n).padStart(2, '0');

        // H4: post-process app-side cobros (REPARTIDOR_COBROS + COBROS comerciales)
        // todavia no propagados al ERP, indexados por "SERIE-NUMERO" del documento.
        // Esto evita que el usuario vea como "pendiente" lo que ya fue cobrado.
        const appCobrosByDoc = new Map(); // key="SERIE-NUMERO" -> totalCobradoApp
        try {
            const repRows = await queryWithParams(
                `SELECT TRIM(SERIEDOCUMENTO) || '-' || TRIM(CAST(NUMERODOCUMENTO AS VARCHAR(20))) AS DOC_KEY,
                        COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL
                   FROM ${APP_SCHEMA}.REPARTIDOR_COBROS
                  WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
                  GROUP BY TRIM(SERIEDOCUMENTO), TRIM(CAST(NUMERODOCUMENTO AS VARCHAR(20)))`,
                [codigoCliente], false, false
            );
            for (const r of (repRows || [])) {
                const k = String(r.DOC_KEY || '').trim();
                if (!k) continue;
                appCobrosByDoc.set(k, (appCobrosByDoc.get(k) || 0) + (parseFloat(r.TOTAL) || 0));
            }
        } catch (e) {
            logger.warn(`[COBROS] App-side REPARTIDOR_COBROS subtract fallo: ${e.message}`);
        }
        try {
            const comRows = await queryWithParams(
                `SELECT TRIM(REFERENCIA) AS REF, COALESCE(SUM(IMPORTE), 0) AS TOTAL
                   FROM ${APP_SCHEMA}.COBROS
                  WHERE TRIM(CODIGO_CLIENTE) = ?
                  GROUP BY TRIM(REFERENCIA)`,
                [codigoCliente], false, false
            );
            for (const r of (comRows || [])) {
                const refRaw = String(r.REF || '').trim();
                // Las REFERENCIA pueden venir "SERIE-NUMERO" o "PEDIDO:id:SERIE-NUMERO".
                const m = refRaw.match(/([^:]+-\d+)$/);
                const k = m ? m[1] : refRaw;
                if (!k) continue;
                appCobrosByDoc.set(k, (appCobrosByDoc.get(k) || 0) + (parseFloat(r.TOTAL) || 0));
            }
        } catch (e) {
            logger.warn(`[COBROS] App-side COBROS subtract fallo: ${e.message}`);
        }

        const cobros = (resultado || []).map(row => {
            // CVC format
            if (row.IMPORTE_PENDIENTE !== undefined) {
                const dia = format2(row.DIA_DOCUMENTO || 1);
                const mm = format2(row.MES_DOCUMENTO || 1);
                const ano = row.ANO_DOCUMENTO || 2024;
                const serie = (row.SERIE_DOCUMENTO || '').trim();
                const numero = row.NUMERO_DOCUMENTO || 0;
                const tipoDoc = (row.TIPO_DOCUMENTO || 'FAC').trim();
                const fechaDoc = `${ano}-${mm}-${dia}T00:00:00.000Z`;
                const estado = computeEstadoVencimiento(row.FECHA_VENCIMIENTO, fechaDoc);
                // H4: descuenta cobros app-side aun no propagados al ERP.
                const docKey = `${serie}-${numero}`;
                const appPaid = appCobrosByDoc.get(docKey) || 0;
                const erpPendiente = parseFloat(row.IMPORTE_PENDIENTE) || 0;
                const erpCobrado = parseFloat(row.IMPORTE_COBRADO) || 0;
                const importePendienteAjustado = Math.max(0, erpPendiente - appPaid);
                const importeCobradoAjustado = erpCobrado + appPaid;
                return {
                    id: `cvc_${serie}_${numero}_${row.XDE || 1}`,
                    tipo: tipoDoc === 'CAC' ? 'albaran' : 'factura',
                    referencia: docKey,
                    fecha: fechaDoc,
                    fechaVencimiento: row.FECHA_VENCIMIENTO || null,
                    importeTotal: parseFloat(row.IMPORTE_TOTAL) || 0,
                    importePendiente: importePendienteAjustado,
                    importeCobrado: importeCobradoAjustado,
                    estado: importePendienteAjustado <= 0.01 ? 'COBRADO' : estado,
                    formaPago: (row.FORMA_PAGO || '').trim() || null,
                    descripcion: `${tipoDoc} ${docKey}`,
                    appPaymentApplied: appPaid > 0 ? appPaid : undefined,
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
                estado: 'PENDIENTE',
                descripcion: `Pedido ${row.SERIEPEDIDO}-${row.NUMEROPEDIDO}`
            };
        });

        let total = 0;
        let totalVencido = 0;
        let numVencidos = 0;
        cobros.forEach(c => {
            // H4: COBRADO entries (totalmente cobrados app-side) NO suman al
            // pendiente; siguen visibles para que el usuario sepa que ya pago.
            if (c.estado === 'COBRADO') return;
            total += c.importePendiente;
            if (c.estado === 'VENCIDO') {
                totalVencido += c.importePendiente;
                numVencidos += 1;
            }
        });

        res.json({
            success: true,
            cobros,
            resumen: {
                totalPendiente: total,
                totalVencido,
                numDocumentos: cobros.length,
                numVencidos,
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
                    FROM ${APP_SCHEMA}.PEDIDOS_CAB PC
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

// Normaliza/valida un idempotencyToken (8-128 chars seguros, hash si supera 64).
function normalizeIdempotencyToken(rawToken) {
    const token = String(rawToken || '').trim();
    if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(token)) {
        const err = new Error('idempotencyToken requerido (8-128 chars [A-Za-z0-9_.:-])');
        err.code = 'INVALID_IDEMPOTENCY_TOKEN';
        err.status = 400;
        throw err;
    }
    if (token.length <= 64) return token;
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * POST /api/cobros/:codigoCliente/registrar
 * Req #19: protegido con rate limiter (10/min/usuario)
 * Req CRITICO: idempotencyToken obligatorio para evitar duplicados por reintentos
 * de red o doble-click. Si el mismo token llega 2 veces con el mismo payload,
 * devolvemos OK sin duplicar. Si llega con payload distinto, 409 conflict.
 */
router.post('/:codigoCliente/registrar', registrarCobroLimiter, async (req, res) => {
    try {
        const codigoCliente = sanitizeCode(req.params.codigoCliente);
        const {
            referencia, importe, formaPago, observaciones,
            tipoVenta, tipoModo, tipoUsuario, codigoUsuario,
            idempotencyToken,
        } = req.body;

        let id;
        try {
            id = normalizeIdempotencyToken(idempotencyToken);
        } catch (tokenErr) {
            return res.status(400).json({
                success: false,
                code: tokenErr.code || 'INVALID_IDEMPOTENCY_TOKEN',
                error: tokenErr.message,
            });
        }

        const importeNum = parseFloat(importe) || 0;
        const referenciaTrim = String(referencia || '').trim();
        const formaPagoTrim = (formaPago || 'CONTADO').trim();
        const tipoVentaTrim = (tipoVenta || 'CC').trim();
        const tipoModoTrim = (tipoModo || 'NORMAL').trim();
        const tipoUsuarioTrim = (tipoUsuario || 'COMERCIAL').trim();
        const codigoUsuarioTrim = String(codigoUsuario || '').trim();
        const obsTrim = String(observaciones || '').substring(0, 500);

        if (!codigoCliente || !referenciaTrim || importeNum <= 0) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PAYMENT_PAYLOAD',
                error: 'cliente, referencia e importe positivo requeridos',
            });
        }

        logger.info(`[COBROS] Registrando cobro para ${codigoCliente}: ${importeNum} ref=${referenciaTrim} token=${id.slice(0, 12)}...`);

        // CROSS-TABLE: si el REPARTIDOR ya cobro este documento al entregar,
        // bloqueamos el cobro comercial (cliente intentando doble-pago).
        try {
            const repartidorRows = await queryWithParams(
                `SELECT COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_REP
                   FROM ${APP_SCHEMA}.REPARTIDOR_COBROS
                  WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
                    AND (TRIM(SERIEDOCUMENTO) || '-' || TRIM(CAST(NUMERODOCUMENTO AS VARCHAR(20)))) = ?`,
                [codigoCliente, referenciaTrim], false, false
            );
            const totalRepartidor = parseFloat(repartidorRows?.[0]?.TOTAL_REP) || 0;
            if (totalRepartidor >= importeNum && totalRepartidor > 0) {
                return res.status(409).json({
                    success: false,
                    code: 'COBRO_ALREADY_COLLECTED_BY_REPARTIDOR',
                    error: `Documento ${referenciaTrim} ya cobrado por el REPARTIDOR (entrega al cliente). Importe cobrado: ${totalRepartidor}.`,
                });
            }
        } catch (xtableErr) {
            logger.warn(`[COBROS] Cross-table REPARTIDOR_COBROS fallo (continuando): ${xtableErr.message}`);
        }

        // Replay check: si el token ya existe en ${APP_SCHEMA}.COBROS, devolvemos 200 si
        // el payload coincide, 409 si difiere. La tabla tiene IDX_COBROS_IDEM.
        try {
            const existingRows = await queryWithParams(
                `SELECT ID, CODIGO_CLIENTE, REFERENCIA, IMPORTE, FORMA_PAGO, CODIGO_USUARIO
                   FROM ${APP_SCHEMA}.COBROS WHERE ID = ?`,
                [id], false, false
            );
            if (existingRows && existingRows.length > 0) {
                const e = existingRows[0];
                const samePayload =
                    String(e.CODIGO_CLIENTE || '').trim() === codigoCliente &&
                    String(e.REFERENCIA || '').trim() === referenciaTrim &&
                    Math.round((parseFloat(e.IMPORTE) || 0) * 100) === Math.round(importeNum * 100) &&
                    String(e.FORMA_PAGO || '').trim() === formaPagoTrim;
                if (!samePayload) {
                    return res.status(409).json({
                        success: false,
                        code: 'IDEMPOTENCY_CONFLICT',
                        error: 'Token de idempotencia reutilizado con otro payload',
                    });
                }
                return res.json({
                    success: true,
                    idempotent: true,
                    mensaje: 'Cobro ya registrado (idempotente)',
                });
            }
        } catch (lookupErr) {
            logger.warn(`[COBROS] Lookup idempotency fallo (siguiendo INSERT): ${lookupErr.message}`);
        }

        try {
            await queryWithParams(
                `INSERT INTO ${APP_SCHEMA}.COBROS (
                    ID, CODIGO_CLIENTE, REFERENCIA, IMPORTE, FORMA_PAGO,
                    TIPO_VENTA, TIPO_MODO, TIPO_USUARIO, CODIGO_USUARIO,
                    OBSERVACIONES, IDEMPOTENCY_TOKEN
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, codigoCliente, referenciaTrim, importeNum,
                    formaPagoTrim, tipoVentaTrim, tipoModoTrim,
                    tipoUsuarioTrim, codigoUsuarioTrim, obsTrim,
                    id,
                ], false
            );
        } catch (insertErr) {
            // Si hubo race entre el SELECT y el INSERT, vuelve a intentar el
            // replay-check antes de fallar (PK colision sobre ID).
            const msg = String(insertErr.message || '');
            if (/DUPLICATE|PRIMARY|UNIQUE|SQL0803/i.test(msg)) {
                logger.warn(`[COBROS] Colision PK (race idempotencia) token=${id.slice(0, 12)}: ${msg}`);
                return res.json({
                    success: true,
                    idempotent: true,
                    mensaje: 'Cobro ya registrado (idempotente)',
                });
            }
            throw insertErr;
        }

        // Invalida cache de pendientes para que la siguiente consulta vea el nuevo cobro
        invalidateCobrosCache(codigoCliente);

        res.json({ success: true, mensaje: 'Cobro registrado correctamente', id });

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
        
        let vendorClause = '';
        let vendorParams = [];
        
        if (!isAll) {
            if (useParamBinding) {
                const placeholders = vendorCodes.map(() => '?').join(',');
                vendorClause = ` AND TRIM(CLP.VENDEDORCOMERCIAL) IN (${placeholders})`;
                vendorParams = vendorCodes;
            } else {
                // For >50 vendor codes, embed safely (codes are 2-char alphanumeric)
                const safeCodes = vendorCodes
                    .filter(v => /^[a-zA-Z0-9]{1,10}$/.test(v))
                    .map(v => `'${v.replace(/'/g, "''")}'`)
                    .join(',');
                vendorClause = ` AND TRIM(CLP.VENDEDORCOMERCIAL) IN (${safeCodes})`;
            }
        }

        const sql = `
          SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                 SUM(CVC.IMPORTEPENDIENTE) AS TOTAL_PENDIENTE,
                 COUNT(*) AS NUM_DOCS,
                 SUM(CASE WHEN (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO)
                     < (YEAR(CURRENT_DATE) * 10000 + MONTH(CURRENT_DATE) * 100 + DAY(CURRENT_DATE))
                     THEN CVC.IMPORTEPENDIENTE ELSE 0 END) AS TOTAL_VENCIDO
           FROM DSEDAC.CVC CVC
           LEFT JOIN DSEDAC.CLP CLP ON TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
           WHERE CVC.IMPORTEPENDIENTE <> 0
             AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
             ${vendorClause}
           GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN)
           ORDER BY TOTAL_PENDIENTE DESC
        `;

        const cacheKeyVendedor = `cobros:pending-summary:${vendedorCodeParam}`;
        const queryFn = vendorParams.length > 0
            ? () => queryWithParams(sql, vendorParams)
            : () => query(sql, false);
        const rows = await cachedQuery(queryFn, sql, cacheKeyVendedor, TTL.SHORT);

        const summary = {};
        let grandTotal = 0;
        let grandTotalVencido = 0;
        (rows || []).forEach(r => {
            const code = (r.CLIENTE || '').trim();
            const total = parseFloat(r.TOTAL_PENDIENTE) || 0;
            const vencido = parseFloat(r.TOTAL_VENCIDO) || 0;
            const count = parseInt(r.NUM_DOCS) || 0;
            // Estado por cliente: VENCIDO si tiene cualquier vencido, PENDIENTE si pending>0 sin vencidos, AL_DIA si total=0
            const estado = vencido > 0 ? 'VENCIDO' : (total > 0 ? 'PENDIENTE' : 'AL_DIA');
            summary[code] = { total, vencido, count, estado };
            grandTotal += total;
            grandTotalVencido += vencido;
        });

        res.json({
            success: true,
            summary,
            grandTotal,
            grandTotalVencido,
            clientCount: Object.keys(summary).length,
        });

    } catch (error) {
        logger.error('[COBROS] Error pending-summary: ' + error.message);
        res.status(500).json({ success: false, error: 'Error obteniendo resumen' });
    }
});

module.exports = router;
