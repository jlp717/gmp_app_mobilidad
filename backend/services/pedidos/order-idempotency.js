// order-idempotency.js — split de order-lifecycle.js: idempotencia + sale-type + payload-hash.
// Codigo movido verbatim; resolvePedidoActorCodes se importa de ./order-states (one-way, sin ciclo).
const crypto = require('crypto');
const { parseLineDiscountPct, parseGlobalDiscountPct } = require('./discounts');
const { queryWithParams } = require('../../config/db');
const logger = require('../../middleware/logger');
const {
    trimString,
    truncate,
    isTableNotFound,
    PEDIDO_IDEMPOTENCY_TABLE,
    PEDIDOS_CAB_TABLE,
    ERP_SCHEMA,
} = require('./_shared');
const { resolvePedidoActorCodes } = require('./order-states');
const {
    appendOrderStateEvent,
    normalizeOriginalClientAt,
    normalizeState,
} = require('./order-state-events');
const { withDraftCreationTransaction } = require('./local-confirmation-transaction');

function generatePedidoIdempotencyKey() {
    return crypto.randomBytes(12).toString('hex');
}

function normalizePedidoIdempotencyKey(rawToken) {
    const token = String(rawToken || '').trim();
    if (!/^[A-Za-z0-9]{8,28}$/.test(token)) {
        const err = new Error('idempotencyKey/clientRequestId requerido (8-28 chars [A-Za-z0-9])');
        err.code = 'INVALID_IDEMPOTENCY_KEY';
        err.status = 400;
        throw err;
    }
    return token;
}

function extractIdempotencyKeyFromRequest(req) {
    const header = req?.headers?.['idempotency-key'] || req?.headers?.['Idempotency-Key'];
    const bodyKey = req?.body?.clientRequestId || req?.body?.idempotencyKey;
    const raw = header || bodyKey;
    if (!raw) return null;
    return normalizePedidoIdempotencyKey(raw);
}

function ensurePedidoIdempotencyKeyFromRequest(req) {
    const header = req?.headers?.['idempotency-key'] || req?.headers?.['Idempotency-Key'];
    const bodyKey = req?.body?.clientRequestId || req?.body?.idempotencyKey;
    const raw = header || bodyKey;
    if (!raw || !String(raw).trim()) {
        return generatePedidoIdempotencyKey();
    }
    return normalizePedidoIdempotencyKey(raw);
}

const PEDIDO_SALE_TYPE_LABELS = Object.freeze({
    CC: 'Venta',
    VC: 'Venta sin nombre',
    NV: 'No venta',
    CT: 'Contado',
});

function normalizePedidoSaleType(value = 'CC') {
    const rawValue = value === undefined || value === null || trimString(value) === ''
        ? 'CC'
        : trimString(value);
    const canonical = rawValue
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (canonical === 'CC' || canonical === 'VENTA') return 'CC';
    if (
        canonical === 'VC' ||
        canonical === 'VENTA_SIN_NOMBRE' ||
        canonical === 'VENTA_SIN_NOMBRES' ||
        canonical === 'SIN_NOMBRE' ||
        canonical === 'SIN_NOMBRES'
    ) {
        return 'VC';
    }
    if (
        canonical === 'NV' ||
        canonical === 'NO_VENTA' ||
        canonical === 'NO_VENTAS' ||
        canonical === 'NOVENTA'
    ) {
        return 'NV';
    }
    if (
        canonical === 'CT' ||
        canonical === 'CTR' ||
        canonical === 'CONTADO' ||
        canonical === 'CONTRA_REEMBOLSO' ||
        canonical === 'CONTRAREEMBOLSO'
    ) {
        return 'CT';
    }

    const err = new Error('tipoventa/saleType debe ser CC (Venta), VC (Venta sin nombre), NV (No venta) o CT (Contado)');
    err.code = 'INVALID_SALE_TYPE';
    err.status = 400;
    throw err;
}

function getPedidoSaleTypeLabel(value = 'CC') {
    return PEDIDO_SALE_TYPE_LABELS[normalizePedidoSaleType(value)];
}

function buildCreateOrderPayload({
    clientCode,
    vendedorCode,
    tipoventa = 'CC',
    observaciones = '',
    descuentoGlobal = 0,
    lines = [],
    originalClientAt,
}, { includeOriginalClientAt = true } = {}) {
    const canonicalLines = (lines || []).map((line) => ({
        codigoArticulo: trimString(line.codigoArticulo || line.CODIGOARTICULO),
        cantidadEnvases: Number(parseFloat(line.cantidadEnvases ?? line.CANTIDADENVASES) || 0).toFixed(4),
        cantidadUnidades: Number(parseFloat(line.cantidadUnidades ?? line.CANTIDADUNIDADES ?? line.cantidad) || 0).toFixed(4),
        precioVenta: Number(parseFloat(line.precioVenta ?? line.precio ?? line.PRECIOVENTA) || 0).toFixed(4),
        unidadMedida: trimString(line.unidadMedida || line.UNIDADMEDIDA || 'CAJAS'),
        claseLinea: trimString(line.claseLinea || line.CLASELINEA || 'VT'),
        descuentoLinea: Number(parseLineDiscountPct(line)).toFixed(2),
    })).sort((a, b) => a.codigoArticulo.localeCompare(b.codigoArticulo));

    const payload = {
        clientCode: truncate(clientCode, 10),
        vendedorCode: resolvePedidoActorCodes({ CODIGOVENDEDOR: vendedorCode }).vendedor,
        tipoventa: normalizePedidoSaleType(tipoventa),
        observaciones: trimString(observaciones),
        descuentoGlobal: Number(parseGlobalDiscountPct({ descuentoGlobal })).toFixed(2),
    };
    if (includeOriginalClientAt) {
        payload.originalClientAt = normalizeOriginalClientAt(originalClientAt);
    }
    payload.lines = canonicalLines;
    return payload;
}

function buildCreateOrderPayloadHash(input) {
    const payload = buildCreateOrderPayload(input, { includeOriginalClientAt: true });

    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildCreateOrderPayloadHashV1(input) {
    const payload = buildCreateOrderPayload(input, { includeOriginalClientAt: false });

    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function resolveQueryExecutor(queryFn) {
    return typeof queryFn === 'function'
        ? queryFn
        : (sql, params) => queryWithParams(sql, params, false, false);
}

async function lookupPedidoIdempotency(idempotencyKey, queryFn) {
    try {
        const rows = await resolveQueryExecutor(queryFn)(
            `SELECT PEDIDO_ID, PAYLOAD_HASH
               FROM ${PEDIDO_IDEMPOTENCY_TABLE}
              WHERE IDEMPOTENCY_KEY = ?`,
            [idempotencyKey],
        );
        if (!rows || rows.length === 0) return null;
        return {
            pedidoId: parseInt(rows[0].PEDIDO_ID, 10),
            payloadHash: String(rows[0].PAYLOAD_HASH || '').trim(),
        };
    } catch (lookupErr) {
        if (isTableNotFound(lookupErr)) {
            logger.error(`[PEDIDOS] ${ERP_SCHEMA}.PEDIDO_IDEMPOTENCY missing; refusing create without dedupe`);
            throw createIdempotencyUnavailableError();
        }
        logger.error(`[PEDIDOS] Idempotency lookup failed: ${lookupErr.message}`);
        throw createIdempotencyUnavailableError();
    }
}

async function storePedidoIdempotency({
    idempotencyKey,
    pedidoId,
    payloadHash,
    clientCode,
    vendedorCode,
}, queryFn) {
    const storedClientCode = truncate(clientCode, 10);
    const storedVendedorCode = resolvePedidoActorCodes({ CODIGOVENDEDOR: vendedorCode }).vendedor;
    await resolveQueryExecutor(queryFn)(
        `INSERT INTO ${PEDIDO_IDEMPOTENCY_TABLE}
            (IDEMPOTENCY_KEY, PEDIDO_ID, PAYLOAD_HASH, CLIENT_CODE, VENDEDOR_CODE)
         VALUES (?, ?, ?, ?, ?)`,
        [
            truncate(idempotencyKey, 128),
            pedidoId,
            truncate(payloadHash, 64),
            storedClientCode,
            storedVendedorCode,
        ],
    );
}

function createIdempotencyConflictError(message) {
    const err = new Error(message || 'Token de idempotencia reutilizado con otro payload');
    err.code = 'IDEMPOTENCY_CONFLICT';
    err.status = 409;
    return err;
}

function createIdempotencyUnavailableError(message) {
    const err = new Error(message || 'Idempotencia de pedidos no disponible. Reintenta en unos minutos.');
    err.code = 'IDEMPOTENCY_UNAVAILABLE';
    err.status = 503;
    return err;
}

function affectedRowCount(result) {
    if (typeof result === 'number') return result;
    if (result && typeof result.count === 'number') return result.count;
    return null;
}

function adoptLegacyOriginalClientAt({
    idempotencyKey,
    pedidoId,
    legacyPayloadHash,
    payloadHash,
    originalClientAt,
}) {
    return withDraftCreationTransaction(async (conn) => {
        const queryFn = (sql, params) => conn.query(sql, params);
        await queryFn(`LOCK TABLE ${PEDIDO_IDEMPOTENCY_TABLE} IN EXCLUSIVE MODE`);
        const current = await lookupPedidoIdempotency(idempotencyKey, queryFn);
        if (!current || current.pedidoId !== pedidoId) {
            throw createIdempotencyConflictError();
        }
        if (current.payloadHash === payloadHash) return payloadHash;
        if (current.payloadHash !== legacyPayloadHash) {
            throw createIdempotencyConflictError();
        }
        const stateRows = await queryFn(
            `SELECT TRIM(ESTADO) AS ESTADO FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`,
            [pedidoId],
        );
        if (!Array.isArray(stateRows) || stateRows.length !== 1) {
            throw createIdempotencyConflictError('El pedido idempotente ya no esta disponible.');
        }
        const state = normalizeState(stateRows[0].ESTADO);
        const update = await queryFn(
            `UPDATE ${PEDIDO_IDEMPOTENCY_TABLE}
                SET PAYLOAD_HASH = ?
              WHERE IDEMPOTENCY_KEY = ? AND PEDIDO_ID = ? AND PAYLOAD_HASH = ?`,
            [payloadHash, idempotencyKey, pedidoId, legacyPayloadHash],
        );
        const updated = affectedRowCount(update);
        if (updated === 0) throw createIdempotencyConflictError();
        if (updated === null) {
            const verified = await lookupPedidoIdempotency(idempotencyKey, queryFn);
            if (!verified || verified.pedidoId !== pedidoId || verified.payloadHash !== payloadHash) {
                throw createIdempotencyConflictError();
            }
        }
        await appendOrderStateEvent(queryFn, {
            pedidoId,
            fromState: state,
            toState: state,
            actorId: 'SYSTEM_OFFLINE_REPLAY',
            actorRole: 'SYSTEM',
            reason: 'Adopcion de fecha original para replay offline legado',
            idempotencyKey: `pedido-${pedidoId}-offline-created-at-adopted`,
            originalClientAt,
            payload: {
                event: 'OFFLINE_ORIGINAL_CREATED_AT_ADOPTED',
                originalClientAt,
            },
        });
        return payloadHash;
    });
}

async function resolveIdempotentCreateOrder({
    idempotencyKey,
    clientCode,
    vendedorCode,
    tipoventa,
    observaciones,
    descuentoGlobal,
    lines,
    originalClientAt,
}) {
    const { getOrderDetail } = require('./index'); // puente split: def vive en index
    if (!idempotencyKey) return null;

    const payloadHash = buildCreateOrderPayloadHash({
        clientCode,
        vendedorCode,
        tipoventa,
        observaciones,
        descuentoGlobal,
        lines,
        originalClientAt,
    });
    const legacyPayloadHash = buildCreateOrderPayloadHashV1({
        clientCode,
        vendedorCode,
        tipoventa,
        observaciones,
        descuentoGlobal,
        lines,
    });
    const existing = await lookupPedidoIdempotency(idempotencyKey);
    if (!existing) {
        return { payloadHash, replay: null };
    }

    if (existing.payloadHash !== payloadHash && existing.payloadHash !== legacyPayloadHash) {
        throw createIdempotencyConflictError();
    }

    const normalizedOriginalClientAt = normalizeOriginalClientAt(originalClientAt);
    if (existing.payloadHash === legacyPayloadHash && normalizedOriginalClientAt) {
        await adoptLegacyOriginalClientAt({
            idempotencyKey,
            pedidoId: existing.pedidoId,
            legacyPayloadHash,
            payloadHash,
            originalClientAt: normalizedOriginalClientAt,
        });
    }

    const order = await getOrderDetail(existing.pedidoId);
    return { payloadHash, replay: { ...order, idempotent: true } };
}

module.exports = {
    generatePedidoIdempotencyKey,
    normalizePedidoIdempotencyKey,
    extractIdempotencyKeyFromRequest,
    ensurePedidoIdempotencyKeyFromRequest,
    PEDIDO_SALE_TYPE_LABELS,
    normalizePedidoSaleType,
    getPedidoSaleTypeLabel,
    buildCreateOrderPayloadHash,
    buildCreateOrderPayloadHashV1,
    lookupPedidoIdempotency,
    storePedidoIdempotency,
    createIdempotencyConflictError,
    createIdempotencyUnavailableError,
    resolveIdempotentCreateOrder,
};
