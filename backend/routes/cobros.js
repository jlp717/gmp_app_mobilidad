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
const { db2QualifiedTable, db2InsertSql } = require('../utils/db2-identifiers');
const { getDb2WriteSchema } = require('../utils/db2-schemas');
const { buildCvcVendorScopeFilter } = require('../utils/common');
const crypto = require('crypto');

const APP_SCHEMA = getDb2WriteSchema();
const COBROS_TABLE = db2QualifiedTable(APP_SCHEMA, 'COBROS');

// CTR / contra-reembolso: cobro en manos del repartidor, no del comercial.
const FORMAS_PAGO_REPARTIDOR = ['01', 'CO', 'CTR', 'EF'];

// Req: invalidate cobros cache for a client after a mutation. Best-effort, no throw.
// Las claves reales de cachedQuery viven bajo "gmp:query:query:<cacheKey>:vendor:..."
// (namespace Redis "query" + prefijo "query" del CacheKeyGenerator), por eso el
// patrón debe incluir "query:query:" para que la invalidación encuentre las claves.
async function invalidateCobrosCache(codigoCliente) {
    try {
        const cli = String(codigoCliente || '').trim();
        if (!cli) return;
        await Promise.all([
            invalidateCachePattern(`query:query:cobros:pendientes:cvc:${cli}:*`),
            invalidateCachePattern(`query:query:cobros:historico:${cli}:*`),
            invalidateCachePattern('query:query:cobros:pending-summary:*'),
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

function db2StringLiteral(value) {
    const escaped = sanitizeCode(value).split('\'').join('\'\'');
    return '\'' + escaped + '\'';
}

function buildPendingSummaryPageDocsCte(rows) {
    const docs = [];
    const seen = new Set();
    for (const row of rows || []) {
        if (docs.length >= 100) break;
        const client = sanitizeCode(row.CLIENTE);
        const serie = sanitizeCode(row.SERIE_DOCUMENTO);
        const numero = sanitizeCode(row.NUMERO_DOCUMENTO);
        if (!client || !serie || !numero) continue;
        const key = [client, serie, numero].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        docs.push({ client, serie, numero, docKey: serie + '-' + numero });
    }
    if (docs.length === 0) return '';
    const values = docs
        .map((doc) => '(' + [doc.client, doc.serie, doc.numero, doc.docKey].map(db2StringLiteral).join(', ') + ')')
        .join(',\n          ');
    return 'WITH PAGE_DOCS (CLIENTE, SERIE, NUMERO, DOC_KEY) AS (VALUES\n          ' + values + '\n        )';
}

function applyPendingSummaryDocTotals(row, appAdjustments) {
    const code = sanitizeCode(row.CLIENTE);
    if (!code) return null;
    const docKey = sanitizeCode(row.SERIE_DOCUMENTO) + '-' + row.NUMERO_DOCUMENTO;
    const appPaid = appAdjustments.get(code + '|' + docKey) || 0;
    const rawTotal = parseFloat(row.TOTAL_PENDIENTE) || 0;
    const rawVencido = parseFloat(row.TOTAL_VENCIDO) || 0;
    const total = Math.max(0, rawTotal - appPaid);
    if (toCents(total) <= 0) return null;
    const vencido = rawVencido > 0 ? Math.min(total, Math.max(0, rawVencido - appPaid)) : 0;
    return { code, total, vencido };
}

function computePendingSummaryPortfolioTotals(rows, appAdjustments) {
    const clients = new Set();
    let grandTotal = 0;
    let grandTotalVencido = 0;
    for (const row of rows || []) {
        const applied = applyPendingSummaryDocTotals(row, appAdjustments);
        if (!applied) continue;
        clients.add(applied.code);
        grandTotal += applied.total;
        grandTotalVencido += applied.vencido;
    }
    return { grandTotal, grandTotalVencido, clientCount: clients.size };
}

async function getAppSideCobrosByDocForVendorScope(vendorClause, vendorParams) {
    const adjustments = new Map();
    const addAdjustment = (clientCode, docKey, amount) => {
        const code = sanitizeCode(clientCode);
        const doc = sanitizeCode(docKey);
        if (!code || !doc) return;
        const key = code + '|' + doc;
        adjustments.set(key, (adjustments.get(key) || 0) + (parseFloat(amount) || 0));
    };

    const runQuery = vendorParams.length > 0
        ? (sql, params) => queryWithParams(sql, params)
        : (sql) => query(sql, false);

    try {
        const comercialSql = [
            'SELECT TRIM(C.CODIGO_CLIENTE) AS CLIENTE,',
            '       TRIM(C.REFERENCIA) AS REF,',
            '       COALESCE(SUM(C.IMPORTE), 0) AS TOTAL_APP',
            '  FROM ' + APP_SCHEMA + '.COBROS C',
            ' WHERE EXISTS (',
            '   SELECT 1',
            '     FROM DSEDAC.CVC CVC',
            '    WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(C.CODIGO_CLIENTE)',
            '      AND CVC.IMPORTEPENDIENTE <> 0',
            '      AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> \'S\')',
            vendorClause,
            ' )',
            ' GROUP BY TRIM(C.CODIGO_CLIENTE), TRIM(C.REFERENCIA)',
        ].join('\n');
        const appRows = await runQuery(comercialSql, vendorParams);
        for (const row of appRows || []) {
            const reference = sanitizeCode(row.REF);
            const match = reference.match(/([^:]+-\d+)$/);
            addAdjustment(row.CLIENTE, match ? match[1] : reference, row.TOTAL_APP);
        }
    } catch (error) {
        logger.warn('[COBROS] App-side COBROS portfolio subtract skipped: ' + error.message);
    }

    try {
        const repartidorSql = [
            'SELECT TRIM(R.CODIGOCLIENTEALBARAN) AS CLIENTE,',
            '       TRIM(R.SERIEDOCUMENTO) AS SERIE,',
            '       TRIM(CAST(R.NUMERODOCUMENTO AS VARCHAR(20))) AS NUMERO,',
            '       COALESCE(SUM(R.IMPORTEVENCIMIENTO), 0) AS TOTAL_REP',
            '  FROM ' + APP_SCHEMA + '.REPARTIDOR_COBROS R',
            ' WHERE EXISTS (',
            '   SELECT 1',
            '     FROM DSEDAC.CVC CVC',
            '    WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(R.CODIGOCLIENTEALBARAN)',
            '      AND TRIM(CVC.SERIEDOCUMENTO) = TRIM(R.SERIEDOCUMENTO)',
            '      AND TRIM(CAST(CVC.NUMERODOCUMENTO AS VARCHAR(20))) = TRIM(CAST(R.NUMERODOCUMENTO AS VARCHAR(20)))',
            '      AND CVC.IMPORTEPENDIENTE <> 0',
            '      AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> \'S\')',
            vendorClause,
            ' )',
            ' GROUP BY TRIM(R.CODIGOCLIENTEALBARAN), TRIM(R.SERIEDOCUMENTO), TRIM(CAST(R.NUMERODOCUMENTO AS VARCHAR(20)))',
        ].join('\n');
        const repRows = await runQuery(repartidorSql, vendorParams);
        for (const row of repRows || []) {
            addAdjustment(row.CLIENTE, sanitizeCode(row.SERIE) + '-' + row.NUMERO, row.TOTAL_REP);
        }
    } catch (error) {
        logger.warn('[COBROS] App-side REPARTIDOR_COBROS portfolio subtract skipped: ' + error.message);
    }

    return adjustments;
}

function toCents(value) {
    return Math.round((Number(value) || 0) * 100);
}

function normalizeNumericCode(value) {
    const raw = sanitizeCode(value);
    if (!/^\d+$/.test(raw)) return null;
    return raw.replace(/^0+/, '') || '0';
}

function codesMatch(left, right) {
    const leftCode = sanitizeCode(left);
    const rightCode = sanitizeCode(right);
    if (leftCode === rightCode) return true;
    if (leftCode.toUpperCase() === rightCode.toUpperCase()) return true;
    const leftNumeric = normalizeNumericCode(leftCode);
    const rightNumeric = normalizeNumericCode(rightCode);
    return leftNumeric !== null && rightNumeric !== null && leftNumeric === rightNumeric;
}

function isColumnNotFound(err) {
    const msg = String(err?.message || '').toLowerCase();
    const codes = (err?.odbcErrors || []).map(e => e.code);
    const states = (err?.odbcErrors || []).map(e => e.state);
    return codes.includes(-205) || states.includes('42S22') || msg.includes('sql0205') || msg.includes('column not found');
}

function currentHhmmss(date = new Date()) {
    return parseInt(
        `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`,
        10,
    );
}

function buildCobroInsert({
    id,
    codigoCliente,
    referencia,
    importe,
    formaPago,
    tipoVenta,
    tipoModo,
    tipoUsuario,
    codigoUsuario,
    observaciones,
    idempotencyToken,
    includeErpColumns,
}) {
    const columns = [
        'ID', 'CODIGO_CLIENTE', 'REFERENCIA', 'IMPORTE', 'FORMA_PAGO',
        'TIPO_VENTA', 'TIPO_MODO', 'TIPO_USUARIO', 'CODIGO_USUARIO',
        'OBSERVACIONES', 'IDEMPOTENCY_TOKEN',
    ];
    const params = [
        id, codigoCliente, referencia, importe,
        formaPago, tipoVenta, tipoModo,
        tipoUsuario, codigoUsuario, observaciones,
        idempotencyToken,
    ];

    if (includeErpColumns) {
        const now = new Date();
        columns.push(
            'SUBEMPRESARECIBO', 'EJERCICIORECIBO', 'SERIERECIBO', 'TERMINALRECIBO',
            'CODIGOCLIENTEFACTURA', 'CODIGOVENDEDOR', 'TIPORECIBO',
            'DIADOCUMENTO', 'MESDOCUMENTO', 'ANODOCUMENTO', 'HORADOCUMENTO',
            'IMPORTECOBRADO', 'IDMARCALIQUIDACION',
        );
        params.push(
            String(process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP').substring(0, 3),
            now.getFullYear(),
            String(process.env.PEDIDOS_SYSTEM_SERIE || 'R').substring(0, 1),
            parseInt(process.env.PEDIDOS_SYSTEM_TERMINAL || '10', 10),
            String(codigoCliente || '').padEnd(10).slice(0, 10),
            String(codigoUsuario || '').padEnd(2).slice(0, 2),
            'C',
            now.getDate(),
            now.getMonth() + 1,
            now.getFullYear(),
            currentHhmmss(now),
            importe,
            String(id).slice(0, 30),
        );
    }

    return {
        sql: db2InsertSql(COBROS_TABLE, columns),
        params,
    };
}

function normalizeCodeList(value) {
    const values = Array.isArray(value) ? value : sanitizeCode(value).split(',');
    return values
        .map((code) => sanitizeCode(code))
        .filter((code) => code && code.toUpperCase() !== 'ALL');
}

function getCobrosContext(req) {
    const user = req.user || {};
    const role = user.role || user.userRole || 'COMERCIAL';
    return {
        userId: user.code || user.codigo || user.codigoVendedor || user.userId || user.id,
        userRole: role,
        isJefeVentas: user.isJefeVentas === true || role === 'JEFE_VENTAS' || role === 'ADMIN',
        vendorCodes: user.vendorCodes || user.vendedorCodes || [],
        clientCodes: user.clientCodes || user.clienteCodes || [],
    };
}

function forbiddenVendor(res, message) {
    return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_VENDOR',
        error: message,
    });
}

function authorizeCobrosClientScope(req, codigoCliente, action = 'consultar') {
    const context = getCobrosContext(req);
    if (context.isJefeVentas) return { ok: true };

    const user = req.user || {};
    const hasClientScope = Object.prototype.hasOwnProperty.call(user, 'clientCodes')
        || Object.prototype.hasOwnProperty.call(user, 'clienteCodes');
    if (!hasClientScope) return { ok: true };

    const allowedClientCodes = normalizeCodeList(context.clientCodes);
    if (allowedClientCodes.some((clientCode) => codesMatch(clientCode, codigoCliente))) {
        return { ok: true };
    }

    return {
        ok: false,
        status: 403,
        body: {
            success: false,
            code: 'FORBIDDEN_CLIENT_VENDOR',
            error: 'No autorizado para ' + action + ' este cliente',
        },
    };
}

// Req #15: Calcula estado VENCIDO/PENDIENTE/AL_DIA a partir de fecha vencimiento.
function isFormaPagoRepartidorResponsibility(formaPago) {
    const code = sanitizeCode(formaPago).toUpperCase();
    if (!code) return false;
    if (FORMAS_PAGO_REPARTIDOR.includes(code)) return true;
    return code.includes('CTR') || code.includes('REEMB');
}

function isCobradoPorRepartidor({ repartidorPaid = 0, formaPago }) {
    if ((parseFloat(repartidorPaid) || 0) > 0) return true;
    return isFormaPagoRepartidorResponsibility(formaPago);
}

function toIsoTimestamp(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value);
}

function mapHistoricoRow(row) {
    const fechaIso = toIsoTimestamp(row.FECHA);
    const importe = parseFloat(row.IMPORTE) || 0;
    const formaPago = sanitizeCode(row.FORMA_PAGO) || null;
    const referencia = sanitizeCode(row.REFERENCIA);
    const observaciones = String(row.OBSERVACIONES || '').trim();
    const id = row.ID;
    const codigoCliente = sanitizeCode(row.CODIGO_CLIENTE);
    return {
        id,
        codigoCliente,
        importe,
        formaPago,
        referencia,
        observaciones,
        fecha: fechaIso,
        ID: id,
        CODIGO_CLIENTE: codigoCliente,
        IMPORTE: importe,
        FORMA_PAGO: formaPago,
        REFERENCIA: referencia,
        OBSERVACIONES: observaciones,
        FECHA: fechaIso,
    };
}

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
        const clientScope = authorizeCobrosClientScope(req, codigoCliente, 'consultar cobros');
        if (!clientScope.ok) {
            return res.status(clientScope.status).json(clientScope.body);
        }
        logger.info(`[COBROS] Obteniendo pendientes para cliente: ${codigoCliente}`);

        // Req #15: Read real debt from DSEDAC.CVC (ERP unpaid invoices).
        // DB2 metadata verified: the active CVC layout uses long business names,
        // not legacy CV* aliases. Do not fall back to app orders unless CVC itself
        // is unavailable in an old environment.
        const sql = `
            SELECT
                TRIM(C.SERIEDOCUMENTO) AS SERIE_DOCUMENTO,
                C.NUMERODOCUMENTO AS NUMERO_DOCUMENTO,
                C.XDEDOCUMENTO AS XDE,
                TRIM(C.CODIGOCLIENTEALBARAN) AS CODIGO_CLIENTE,
                C.IMPORTEVENCIMIENTO AS IMPORTE_TOTAL,
                C.IMPORTECANCELADO AS IMPORTE_COBRADO,
                C.IMPORTEPENDIENTE AS IMPORTE_PENDIENTE,
                C.ANOEMISION AS ANO_DOCUMENTO,
                C.MESEMISION AS MES_DOCUMENTO,
                C.DIAEMISION AS DIA_DOCUMENTO,
                C.ANOVENCIMIENTO AS ANO_VENCIMIENTO,
                C.MESVENCIMIENTO AS MES_VENCIMIENTO,
                C.DIAVENCIMIENTO AS DIA_VENCIMIENTO,
                TRIM(C.SUBEMPRESADOCUMENTO) AS SUBEMPRESA,
                TRIM(C.TIPODOCUMENTO) AS TIPO_DOCUMENTO,
                TRIM(C.CODIGOFORMAPAGO) AS FORMA_PAGO
            FROM DSEDAC.CVC C
            WHERE TRIM(C.CODIGOCLIENTEALBARAN) = ?
              AND C.IMPORTEPENDIENTE > 0.01
              AND (C.ANULADOSN IS NULL OR C.ANULADOSN <> 'S')
            ORDER BY C.ANOVENCIMIENTO ASC, C.MESVENCIMIENTO ASC, C.DIAVENCIMIENTO ASC
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
        const toIsoDate = (year, month, day) => {
            const y = parseInt(year, 10);
            const m = parseInt(month, 10);
            const d = parseInt(day, 10);
            if (!Number.isFinite(y) || y <= 0 || !Number.isFinite(m) || m <= 0 || !Number.isFinite(d) || d <= 0) {
                return null;
            }
            return `${y}-${format2(m)}-${format2(d)}T00:00:00.000Z`;
        };

        // H4: post-process app-side cobros (REPARTIDOR_COBROS + COBROS comerciales)
        // todavia no propagados al ERP, indexados por "SERIE-NUMERO" del documento.
        // Esto evita que el usuario vea como "pendiente" lo que ya fue cobrado.
        const appCobrosByDoc = new Map(); // key="SERIE-NUMERO" -> totalCobradoApp
        const appRepartidorByDoc = new Map(); // key="SERIE-NUMERO" -> total cobrado por repartidor
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
                const total = parseFloat(r.TOTAL) || 0;
                appRepartidorByDoc.set(k, (appRepartidorByDoc.get(k) || 0) + total);
                appCobrosByDoc.set(k, (appCobrosByDoc.get(k) || 0) + total);
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
                const serie = (row.SERIE_DOCUMENTO || '').trim();
                const numero = row.NUMERO_DOCUMENTO || 0;
                const tipoDoc = (row.TIPO_DOCUMENTO || 'FAC').trim();
                const fechaDoc = toIsoDate(row.ANO_DOCUMENTO, row.MES_DOCUMENTO, row.DIA_DOCUMENTO);
                const fechaVencimiento = toIsoDate(row.ANO_VENCIMIENTO, row.MES_VENCIMIENTO, row.DIA_VENCIMIENTO);
                const estado = computeEstadoVencimiento(fechaVencimiento, fechaDoc);
                // H4: descuenta cobros app-side aun no propagados al ERP.
                const docKey = `${serie}-${numero}`;
                const appPaid = appCobrosByDoc.get(docKey) || 0;
                const repartidorPaid = appRepartidorByDoc.get(docKey) || 0;
                const erpPendiente = parseFloat(row.IMPORTE_PENDIENTE) || 0;
                const erpCobrado = parseFloat(row.IMPORTE_COBRADO) || 0;
                const importePendienteAjustado = Math.max(0, erpPendiente - appPaid);
                const importeCobradoAjustado = erpCobrado + appPaid;
                const formaPago = (row.FORMA_PAGO || '').trim() || null;
                const cobradoPorRepartidor = isCobradoPorRepartidor({ repartidorPaid, formaPago });
                const esCTR = isFormaPagoRepartidorResponsibility(formaPago);
                return {
                    id: `cvc_${serie}_${numero}_${row.XDE || 1}`,
                    tipo: tipoDoc === 'CAC' ? 'albaran' : 'factura',
                    referencia: docKey,
                    fecha: fechaDoc,
                    fechaVencimiento,
                    importeTotal: parseFloat(row.IMPORTE_TOTAL) || 0,
                    importePendiente: importePendienteAjustado,
                    importeCobrado: importeCobradoAjustado,
                    estado: importePendienteAjustado <= 0.01 ? 'COBRADO' : estado,
                    formaPago,
                    descripcion: `${tipoDoc} ${docKey}`,
                    appPaymentApplied: appPaid > 0 ? appPaid : undefined,
                    cobradoPorRepartidor,
                    esCTR,
                    responsabilidad: cobradoPorRepartidor ? 'REPARTIDOR' : 'COMERCIAL',
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
        let numCobrado = 0;
        let totalAppDiscount = 0;
        cobros.forEach(c => {
            if (c.appPaymentApplied) {
                totalAppDiscount += c.appPaymentApplied;
            }
            // H4: COBRADO entries (totalmente cobrados app-side) NO suman al
            // pendiente; siguen visibles para que el usuario sepa que ya pago.
            if (c.estado === 'COBRADO') {
                numCobrado += 1;
                return;
            }
            total += c.importePendiente;
            if (c.estado === 'VENCIDO') {
                totalVencido += c.importePendiente;
                numVencidos += 1;
            }
        });

        // Debug: log when app-side discount significantly reduces pending amounts
        if (totalAppDiscount > 0) {
            logger.info(`[COBROS] ${codigoCliente}: ${numCobrado} docs fully paid app-side, total discount=${totalAppDiscount.toFixed(2)}, remaining pending=${total.toFixed(2)}`);
        }

        res.json({
            success: true,
            cobros,
            resumen: {
                totalPendiente: total,
                total,
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
 * GET /api/cobros/:codigoCliente/historico
 * Historial de cobros comerciales registrados en JAVIER.COBROS (app-side).
 */
router.get('/:codigoCliente/historico', async (req, res) => {
    try {
        const codigoCliente = sanitizeCode(req.params.codigoCliente);
        const clientScope = authorizeCobrosClientScope(req, codigoCliente, 'consultar historico de cobros');
        if (!clientScope.ok) {
            return res.status(clientScope.status).json(clientScope.body);
        }

        const safeLimit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
        const safeOffset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        const sql = `
            SELECT
                C.ID, C.CODIGO_CLIENTE, C.IMPORTE, C.FORMA_PAGO,
                C.REFERENCIA, C.OBSERVACIONES, C.FECHA
            FROM ${APP_SCHEMA}.COBROS C
            WHERE TRIM(C.CODIGO_CLIENTE) = ?
            ORDER BY C.FECHA DESC
            OFFSET ${safeOffset} ROWS FETCH FIRST ${safeLimit} ROWS ONLY`;

        const cacheKey = `cobros:historico:${codigoCliente}:${safeLimit}:${safeOffset}`;
        const rows = await cachedQuery(
            (sqlText) => queryWithParams(sqlText, [codigoCliente]),
            sql,
            cacheKey,
            TTL.MEDIUM
        );
        const historico = (rows || []).map(mapHistoricoRow);

        res.json({ success: true, historico });
    } catch (error) {
        logger.error('[COBROS] Error historico: ' + error.message);
        res.status(500).json({ success: false, error: 'Error obteniendo historico de cobros' });
    }
});

/**
 * GET /api/cobros/:codigoCliente/estado
 */
router.get('/:codigoCliente/estado', async (req, res) => {
    try {
        const codigoCliente = sanitizeCode(req.params.codigoCliente);
        const clientScope = authorizeCobrosClientScope(req, codigoCliente, 'consultar estado de cliente');
        if (!clientScope.ok) {
            return res.status(clientScope.status).json(clientScope.body);
        }
        let totalPendiente = 0;
        let numPedidos = 0;

        // Req #15: Read real debt from CVC
        try {
            const rows = await queryWithParams(`
                SELECT COALESCE(SUM(C.IMPORTEPENDIENTE), 0) AS TOTAL_PENDIENTE,
                       COUNT(*) AS NUM_DOCS
                FROM DSEDAC.CVC C
                WHERE TRIM(C.CODIGOCLIENTEALBARAN) = ?
                  AND C.IMPORTEPENDIENTE > 0.01
                  AND (C.ANULADOSN IS NULL OR C.ANULADOSN <> 'S')
            `, [codigoCliente], false);
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
                `, [codigoCliente], false);
                totalPendiente = parseFloat(rows?.[0]?.TOTAL_PENDIENTE) || 0;
                numPedidos = parseInt(rows?.[0]?.NUM_PEDIDOS) || 0;
            } catch (e) {
                logger.warn('[COBROS] Error calculando estado: ' + e.message);
            }
        }

        // Align client state with /pendientes and /pending-summary by subtracting
        // app-side collections that may not have propagated to ERP yet.
        try {
            const appRows = await queryWithParams(`
                SELECT COALESCE(SUM(IMPORTE), 0) AS TOTAL_APP
                  FROM ${APP_SCHEMA}.COBROS
                 WHERE TRIM(CODIGO_CLIENTE) = ?
            `, [codigoCliente], false);
            const repRows = await queryWithParams(`
                SELECT COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_REP
                  FROM ${APP_SCHEMA}.REPARTIDOR_COBROS
                 WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
            `, [codigoCliente], false);
            const totalApp = parseFloat(appRows?.[0]?.TOTAL_APP) || 0;
            const totalRep = parseFloat(repRows?.[0]?.TOTAL_REP) || 0;
            totalPendiente = Math.max(0, totalPendiente - totalApp - totalRep);
            if (totalPendiente <= 0.01) {
                totalPendiente = 0;
                numPedidos = 0;
            }
        } catch (adjustErr) {
            logger.warn('[COBROS] Error ajustando estado con cobros app-side: ' + adjustErr.message);
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
                limiteCredito,
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
    return crypto.createHash('sha256').update(token).digest('hex');
}

function paymentIdFromIdempotencyToken(token) {
    return `CBR-${crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}

function isSameCobroPayload(row, expected) {
    return String(row.CODIGO_CLIENTE || "").trim() === expected.codigoCliente
        && String(row.REFERENCIA || "").trim() === expected.referencia
        && Math.round((parseFloat(row.IMPORTE) || 0) * 100) === Math.round(expected.importe * 100)
        && String(row.FORMA_PAGO || "").trim() === expected.formaPago;
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
        const clientScope = authorizeCobrosClientScope(req, codigoCliente, 'registrar cobros');
        if (!clientScope.ok) {
            return res.status(clientScope.status).json(clientScope.body);
        }
        const {
            referencia, importe, formaPago, observaciones,
            tipoVenta, tipoModo, tipoUsuario, codigoUsuario,
            idempotencyToken,
        } = req.body;

        let normalizedIdempotencyToken;
        let paymentId;
        try {
            normalizedIdempotencyToken = normalizeIdempotencyToken(idempotencyToken);
            paymentId = paymentIdFromIdempotencyToken(normalizedIdempotencyToken);
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
        const authenticatedUserCode = sanitizeCode(getCobrosContext(req).userId);
        const codigoUsuarioTrim = authenticatedUserCode || String(codigoUsuario || '').trim();
        const obsTrim = String(observaciones || '').substring(0, 500);

        if (!codigoCliente || !referenciaTrim || importeNum <= 0) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PAYMENT_PAYLOAD',
                error: 'cliente, referencia e importe positivo requeridos',
            });
        }

        logger.info(`[COBROS] Registrando cobro para ${codigoCliente}: ${importeNum} ref=${referenciaTrim} paymentId=${paymentId.slice(0, 12)}...`);

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
                   FROM ${APP_SCHEMA}.COBROS WHERE ID = ? OR IDEMPOTENCY_TOKEN = ?`,
                [paymentId, normalizedIdempotencyToken], false, false
            );
            if (existingRows && existingRows.length > 0) {
                const e = existingRows[0];
                const samePayload = isSameCobroPayload(e, {
                    codigoCliente,
                    referencia: referenciaTrim,
                    importe: importeNum,
                    formaPago: formaPagoTrim,
                });
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
            let insert = buildCobroInsert({
                id: paymentId,
                idempotencyToken: normalizedIdempotencyToken,
                codigoCliente,
                referencia: referenciaTrim,
                importe: importeNum,
                formaPago: formaPagoTrim,
                tipoVenta: tipoVentaTrim,
                tipoModo: tipoModoTrim,
                tipoUsuario: tipoUsuarioTrim,
                codigoUsuario: codigoUsuarioTrim,
                observaciones: obsTrim,
                includeErpColumns: true,
            });
            try {
                await queryWithParams(insert.sql, insert.params, false);
            } catch (erpInsertErr) {
                if (!isColumnNotFound(erpInsertErr)) throw erpInsertErr;
                logger.warn(`[COBROS] ERP-compatible columns missing in ${APP_SCHEMA}.COBROS, using legacy insert`);
                insert = buildCobroInsert({
                    id: paymentId,
                    idempotencyToken: normalizedIdempotencyToken,
                    codigoCliente,
                    referencia: referenciaTrim,
                    importe: importeNum,
                    formaPago: formaPagoTrim,
                    tipoVenta: tipoVentaTrim,
                    tipoModo: tipoModoTrim,
                    tipoUsuario: tipoUsuarioTrim,
                    codigoUsuario: codigoUsuarioTrim,
                    observaciones: obsTrim,
                    includeErpColumns: false,
                });
                await queryWithParams(insert.sql, insert.params, false);
            }
        } catch (insertErr) {
            // Si hubo race entre el SELECT y el INSERT, vuelve a intentar el
            // replay-check antes de fallar (PK colision sobre ID).
            const msg = String(insertErr.message || '');
            if (/DUPLICATE|PRIMARY|UNIQUE|SQL0803/i.test(msg)) {
                logger.warn(`[COBROS] Colision PK (race idempotencia) paymentId=${paymentId.slice(0, 12)}: ${msg}`);
                const existingRows = await queryWithParams(
                    `SELECT ID, CODIGO_CLIENTE, REFERENCIA, IMPORTE, FORMA_PAGO, CODIGO_USUARIO
                       FROM ${APP_SCHEMA}.COBROS WHERE ID = ? OR IDEMPOTENCY_TOKEN = ?`,
                    [paymentId, normalizedIdempotencyToken], false, false
                );
                const existing = existingRows && existingRows[0];
                if (existing && !isSameCobroPayload(existing, {
                    codigoCliente,
                    referencia: referenciaTrim,
                    importe: importeNum,
                    formaPago: formaPagoTrim,
                })) {
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
            throw insertErr;
        }

        // Invalida cache de pendientes para que la siguiente consulta vea el nuevo cobro
        invalidateCobrosCache(codigoCliente);

        res.json({ success: true, mensaje: 'Cobro registrado correctamente', id: paymentId });

    } catch (error) {
        logger.error('[COBROS] Error registrando: ' + error.message);
        res.status(500).json({ success: false, error: 'Error registrando cobro' });
    }
});

/**
 * GET /api/cobros/pending-summary/:vendedorCode
 * Returns total pending amounts grouped by client for a given vendor
 * Supports single vendor, multiple vendors (comma-separated), or ALL
 *
 * Source: DSEDAC.CVC (ERP vencimientos reales — deuda comercial del cliente).
 * FIX 2026-05-16: Enriquece cada entrada con NOMBREALTERNATIVO y NOMBRECLIENTE
 * de DSEDAC.CLI para que el frontend no tenga que mostrar "Cliente XXX".
 */
router.get('/pending-summary/:vendedorCode', async (req, res) => {
    try {
        const vendedorCodeParam = req.params.vendedorCode;
        logger.info(`[COBROS] Pending summary for vendor: ${vendedorCodeParam}`);

        const requested = sanitizeCode(vendedorCodeParam);
        const context = getCobrosContext(req);
        const manager = context.isJefeVentas === true;
        const userCode = sanitizeCode(context.userId);
        const isAll = requested.toUpperCase() === 'ALL';
        const requestedLimit = parseInt(req.query.limit, 10);
        const pendingSummaryLimit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(requestedLimit, 1), 100)
            : 100;
        const requestedPage = parseInt(req.query.page, 10);
        const pendingSummaryPage = Number.isFinite(requestedPage)
            ? Math.max(requestedPage, 1)
            : 1;
        const pendingSummaryOffset = (pendingSummaryPage - 1) * pendingSummaryLimit;
        const visibleVendorCodes = normalizeCodeList(context.vendorCodes);
        let selectedVendorCodes = isAll
            ? (manager ? visibleVendorCodes : [])
            : normalizeCodeList(requested);

        if (!manager && isAll) {
            return forbiddenVendor(res, 'COMERCIAL no puede consultar ALL');
        }
        if (!manager && selectedVendorCodes.some((code) => !codesMatch(code, userCode))) {
            return forbiddenVendor(res, 'COMERCIAL solo puede consultar su vendedor');
        }
        if (manager && visibleVendorCodes.length > 0) {
            if (isAll) {
                selectedVendorCodes = visibleVendorCodes;
            } else if (selectedVendorCodes.some((code) => !visibleVendorCodes.some((visible) => codesMatch(code, visible)))) {
                return forbiddenVendor(res, 'JEFE_VENTAS no puede consultar vendedores fuera de su alcance');
            }
        }

        // Align vendor scope with clients list: CLP + LACLAE (+ LACLAE cache when warm).
        let vendorClause = '';
        let vendorParams = [];
        if (selectedVendorCodes.length > 0) {
            const scoped = buildCvcVendorScopeFilter(selectedVendorCodes);
            vendorClause = scoped.clause;
            vendorParams = scoped.params;
        }

        // B7: unscoped global summaries include ~1.143 CVC rows with empty client
        // (mostly serie O, ~7.36M€ ERP noise). Exclude when no vendor semi-join filter.
        const emptyClientFilter = selectedVendorCodes.length === 0
            ? "AND TRIM(CVC.CODIGOCLIENTEALBARAN) <> ''"
            : '';

        // Keep the legacy route aligned with the DDD repository: CVC is the source
        // of real debt, CLP is only a semi-join scope filter, and app-side cobros
        // are subtracted before reporting client state.
        const portfolioSql = `
          SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                 TRIM(CVC.SERIEDOCUMENTO) AS SERIE_DOCUMENTO,
                 CVC.NUMERODOCUMENTO AS NUMERO_DOCUMENTO,
                 SUM(CVC.IMPORTEPENDIENTE) AS TOTAL_PENDIENTE,
                 SUM(CASE WHEN (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO)
                     <= (YEAR(CURRENT_DATE) * 10000 + MONTH(CURRENT_DATE) * 100 + DAY(CURRENT_DATE))
                     THEN CVC.IMPORTEPENDIENTE ELSE 0 END) AS TOTAL_VENCIDO
            FROM DSEDAC.CVC CVC
            WHERE CVC.IMPORTEPENDIENTE <> 0
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              ${emptyClientFilter}
              ${vendorClause}
            GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN), TRIM(CVC.SERIEDOCUMENTO), CVC.NUMERODOCUMENTO
        `;

        const pageSql = `
          SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                 TRIM(CVC.SERIEDOCUMENTO) AS SERIE_DOCUMENTO,
                 CVC.NUMERODOCUMENTO AS NUMERO_DOCUMENTO,
                 SUM(CVC.IMPORTEPENDIENTE) AS TOTAL_PENDIENTE,
                 SUM(CASE WHEN (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO)
                     <= (YEAR(CURRENT_DATE) * 10000 + MONTH(CURRENT_DATE) * 100 + DAY(CURRENT_DATE))
                     THEN CVC.IMPORTEPENDIENTE ELSE 0 END) AS TOTAL_VENCIDO,
                 TRIM(MIN(CLI.NOMBREALTERNATIVO)) AS NOMBRE_ALT,
                 TRIM(MIN(CLI.NOMBRECLIENTE)) AS NOMBRE_CLI
            FROM DSEDAC.CVC CVC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
            WHERE CVC.IMPORTEPENDIENTE <> 0
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              ${emptyClientFilter}
              ${vendorClause}
            GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN), TRIM(CVC.SERIEDOCUMENTO), CVC.NUMERODOCUMENTO
            ORDER BY TOTAL_PENDIENTE DESC, CLIENTE ASC, SERIE_DOCUMENTO ASC, NUMERO_DOCUMENTO ASC
            OFFSET ${pendingSummaryOffset} ROWS FETCH FIRST ${pendingSummaryLimit} ROWS ONLY
        `;

        const cacheKeyVendedor = `cobros:pending-summary:${vendedorCodeParam}:${context.userRole}:${context.userId}:${selectedVendorCodes.join(',')}:limit:${pendingSummaryLimit}:page:${pendingSummaryPage}`;
        const cacheKeyPortfolio = `cobros:pending-summary-portfolio:${vendedorCodeParam}:${context.userRole}:${context.userId}:${selectedVendorCodes.join(',')}`;
        const pageQueryFn = vendorParams.length > 0
            ? () => queryWithParams(pageSql, vendorParams)
            : () => query(pageSql, false);
        const portfolioQueryFn = vendorParams.length > 0
            ? () => queryWithParams(portfolioSql, vendorParams)
            : () => query(portfolioSql, false);
        const [rows, portfolioRows] = await Promise.all([
            cachedQuery(pageQueryFn, pageSql, cacheKeyVendedor, TTL.SHORT),
            cachedQuery(portfolioQueryFn, portfolioSql, cacheKeyPortfolio, TTL.SHORT),
        ]);

        const appAdjustments = new Map();
        const addAdjustment = (clientCode, docKey, amount) => {
            const code = sanitizeCode(clientCode);
            const doc = sanitizeCode(docKey);
            if (!code || !doc) return;
            const key = `${code}|${doc}`;
            appAdjustments.set(key, (appAdjustments.get(key) || 0) + (parseFloat(amount) || 0));
        };

        const pageDocsCte = buildPendingSummaryPageDocsCte(rows || []);
        if (pageDocsCte) {
            try {
                const comercialSql = [
                    pageDocsCte,
                    'SELECT P.CLIENTE AS CLIENTE,',
                    '       P.DOC_KEY AS REF,',
                    '       COALESCE(SUM(C.IMPORTE), 0) AS TOTAL_APP',
                    '  FROM PAGE_DOCS P',
                    '  JOIN ' + APP_SCHEMA + '.COBROS C',
                    '    ON TRIM(C.CODIGO_CLIENTE) = P.CLIENTE',
                    '   AND (TRIM(C.REFERENCIA) = P.DOC_KEY OR TRIM(C.REFERENCIA) LIKE ' + db2StringLiteral('%:') + ' || P.DOC_KEY)',
                    ' GROUP BY P.CLIENTE, P.DOC_KEY',
                ].join('\n');
                const appRows = await queryWithParams(comercialSql, []);
                for (const row of appRows || []) {
                    const reference = sanitizeCode(row.REF);
                    const match = reference.match(/([^:]+-\d+)$/);
                    addAdjustment(row.CLIENTE, match ? match[1] : reference, row.TOTAL_APP);
                }
            } catch (error) {
                logger.warn('[COBROS] App-side COBROS summary subtract skipped: ' + error.message);
            }

            try {
                const repartidorSql = [
                    pageDocsCte,
                    'SELECT P.CLIENTE AS CLIENTE,',
                    '       P.DOC_KEY AS DOC_KEY,',
                    '       COALESCE(SUM(R.IMPORTEVENCIMIENTO), 0) AS TOTAL_REP',
                    '  FROM PAGE_DOCS P',
                    '  JOIN ' + APP_SCHEMA + '.REPARTIDOR_COBROS R',
                    '    ON TRIM(R.CODIGOCLIENTEALBARAN) = P.CLIENTE',
                    '   AND TRIM(R.SERIEDOCUMENTO) = P.SERIE',
                    '   AND TRIM(CAST(R.NUMERODOCUMENTO AS VARCHAR(20))) = P.NUMERO',
                    ' GROUP BY P.CLIENTE, P.DOC_KEY',
                ].join('\n');
                const repRows = await queryWithParams(repartidorSql, []);
                for (const row of repRows || []) addAdjustment(row.CLIENTE, row.DOC_KEY, row.TOTAL_REP);
            } catch (error) {
                logger.warn('[COBROS] App-side REPARTIDOR_COBROS summary subtract skipped: ' + error.message);
            }
        }

        const portfolioAdjustments = await getAppSideCobrosByDocForVendorScope(vendorClause, vendorParams);

        const summary = {};
        (rows || []).forEach(r => {
            const applied = applyPendingSummaryDocTotals(r, appAdjustments);
            if (!applied) return;
            const code = applied.code;
            const nombreAlt = (r.NOMBRE_ALT || '').trim();
            const nombreCli = (r.NOMBRE_CLI || '').trim();
            if (!summary[code]) {
                summary[code] = {
                    total: 0,
                    vencido: 0,
                    count: 0,
                    estado: 'AL_DIA',
                    nombre: nombreAlt || nombreCli || null,
                };
            }
            summary[code].total += applied.total;
            summary[code].vencido += applied.vencido;
            summary[code].count += 1;
            summary[code].estado = summary[code].vencido > 0 ? 'VENCIDO' : 'PENDIENTE';
        });

        const { grandTotal, grandTotalVencido, clientCount } = computePendingSummaryPortfolioTotals(
            portfolioRows,
            portfolioAdjustments,
        );

        res.json({
            success: true,
            summary,
            grandTotal,
            grandTotalVencido,
            clientCount,
            source: 'CVC',
            pagination: {
                limit: pendingSummaryLimit,
                page: pendingSummaryPage,
                offset: pendingSummaryOffset,
                returnedDocuments: (rows || []).length,
            },
        });

    } catch (error) {
        logger.error('[COBROS] Error pending-summary: ' + error.message);
        res.status(500).json({ success: false, error: 'Error obteniendo resumen' });
    }
});

module.exports = router;
