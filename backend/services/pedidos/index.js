/**
 * PEDIDOS SERVICE (CommonJS)
 * ==========================
 * Service for order management (PEDIDOS module).
 * App buffers stay JAVIER by default; ERP reads/exports use explicit DSEDAC paths.
 */

const crypto = require('crypto');
const { query, queryWithParams, getPool, initDb } = require('../../config/db');
const {
    db2Schema,
    db2QualifiedTable,
    db2QualifiedTableName,
    db2ColumnList,
    db2Placeholders,
    db2InsertSql,
} = require('../../utils/db2-identifiers');
const {
    getDb2WriteSchema,
    getDb2WriteSchemaRequested,
    getDb2WriteSchemaDiagnostic,
    isDsedacWriteApproved,
    isDsedacAppBuffersAllowed,
    assertMoneyFitsWriteSchema,
} = require('../../utils/db2-schemas');
const ERP_SCHEMA = getDb2WriteSchema();
const PRICING_CONFIG_SCHEMA = 'JAVIER';
const BOLSA_PRODUCT_PRICE_TABLE = `${PRICING_CONFIG_SCHEMA}.BOLSA_PRODUCTO_PRECIO`;
const CLIENT_SPECIAL_PRICE_TABLE = 'DSEDAC.PES';
const CLIENT_UNIT_AMOUNT_PROMO_TABLE = 'DSEDAC.PPU';
const PROMOTIONS_SCHEMA = db2Schema('DSEDAC', 'PROMOTIONS_SCHEMA');
const PROMOTION_SOURCE_TABLES = new Set(['PRD', 'PMR', 'PMRC', 'PMP', 'CPES']);
// App stock reserves are JAVIER-only (G2: no DSEDAC DML literals in deployable services).
const DELETE_STOCK_RESERVE_BY_PEDIDO_SQL =
    'DELETE FROM JAVIER.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?';
const DRAFT_STOCK_RESERVATION_HOURS = 24;
const DRAFT_STOCK_RESERVATION_STATES_SQL = "'BORRADOR', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION', 'CONFIRMANDO'";
const ACTIVE_STOCK_RESERVATION_CONDITION = `
(
    TRIM(C.ESTADO) = 'CONFIRMADO'
    OR (
        TRIM(C.ESTADO) IN (${DRAFT_STOCK_RESERVATION_STATES_SQL})
        AND SR.CREATED_AT >= CURRENT TIMESTAMP - ${DRAFT_STOCK_RESERVATION_HOURS} HOURS
    )
)`;
const SELECT_ORDER_VENDOR_FOR_AUTH_SQL = ERP_SCHEMA === 'DSEDAC'
    ? 'SELECT ID, TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR, TRIM(CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE FROM DSEDAC.PEDIDOS_CAB WHERE ID = ?'
    : "SELECT ID, TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR, TRIM(COALESCE(NULLIF(CODIGOCLIENTE, ''), CODIGOCLIENTEALBARAN)) AS CODIGOCLIENTE FROM JAVIER.PEDIDOS_CAB WHERE ID = ?";
const logger = require('../../middleware/logger');
const { cachedQuery, invalidateOnMutation } = require('../query-optimizer');
const { redisCache, TTL } = require('../redis-cache');

// Best-effort cache invalidation tras una mutacion de pedidos.
// No bloquea el flujo si Redis esta caido ni si el modulo esta mockeado en tests.
function invalidatePedidosCache(pedidoId) {
    try {
        if (typeof invalidateOnMutation !== 'function') return;
        const result = invalidateOnMutation('PEDIDOS', pedidoId);
        if (result && typeof result.catch === 'function') {
            result.catch((err) => {
                logger.warn(`[PEDIDOS] Cache invalidation skipped: ${err.message}`);
            });
        }
    } catch (err) {
        logger.warn(`[PEDIDOS] Cache invalidation skipped: ${err.message}`);
    }
}
const { LACLAE_SALES_FILTER } = require('../../utils/common');
const { CircuitBreaker } = require('../circuit-breaker');
const { getClientDays } = require('../laclae');

if (typeof CircuitBreaker !== 'function') {
    throw new Error('CircuitBreaker import failed: got ' + typeof CircuitBreaker);
}

const pedidosBreaker = new CircuitBreaker({
    name: 'pedidos-db',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 15000
});

const productsBreaker = new CircuitBreaker({
    name: 'products-db', 
    failureThreshold: 3,
    successThreshold: 2,
    timeout: parseInt(process.env.PRODUCTS_CIRCUIT_TIMEOUT_MS, 10) || 30000
});

// ============================================================================
// TABLE DDL
// ============================================================================

const CREATE_PEDIDOS_CAB = `
CREATE TABLE ${ERP_SCHEMA}.PEDIDOS_CAB (
    ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    SUBEMPRESA CHAR(3) DEFAULT 'GMP',
    EJERCICIO NUMERIC(4) NOT NULL,
    NUMEROPEDIDO NUMERIC(6) NOT NULL,
    SERIEPEDIDO CHAR(1) DEFAULT 'M',
    TERMINAL NUMERIC(3) DEFAULT 999,
    DIADOCUMENTO NUMERIC(2),
    MESDOCUMENTO NUMERIC(2),
    ANODOCUMENTO NUMERIC(4),
    HORADOCUMENTO NUMERIC(6) DEFAULT 0,
    CODIGOCLIENTE CHAR(10) NOT NULL,
    NOMBRECLIENTE VARCHAR(60),
    CODIGOVENDEDOR CHAR(2) NOT NULL,
    CODIGOFORMAPAGO CHAR(2) DEFAULT '02',
    CODIGOTARIFA NUMERIC(2) DEFAULT 1,
    CODIGOALMACEN NUMERIC(4) DEFAULT 1,
    TIPOVENTA CHAR(2) DEFAULT 'CC',
    ESTADO VARCHAR(12) DEFAULT 'BORRADOR',
    IMPORTETOTAL NUMERIC(11,2) DEFAULT 0,
    IMPORTEBASE NUMERIC(11,2) DEFAULT 0,
    IMPORTEIVA NUMERIC(11,2) DEFAULT 0,
    IMPORTECOSTO NUMERIC(11,2) DEFAULT 0,
    IMPORTEMARGEN NUMERIC(11,2) DEFAULT 0,
    OBSERVACIONES VARCHAR(200) DEFAULT '',
    DESCUENTO_GLOBAL DECIMAL(5,2) DEFAULT 0,
    ORIGEN CHAR(1) DEFAULT 'A',
    FECHAREPARTO DATE,
    DIAREPARTO NUMERIC(2) DEFAULT 0,
    MESREPARTO NUMERIC(2) DEFAULT 0,
    ANOREPARTO NUMERIC(4) DEFAULT 0,
    CODIGOREPARTIDOR CHAR(2) DEFAULT ' ',
    CODIGOVEHICULO CHAR(10) DEFAULT ' ',
    RUTA VARCHAR(10) DEFAULT '',
    DIASREPARTO VARCHAR(80) DEFAULT '',
    REPARTO_VALIDADO_SN CHAR(1) DEFAULT 'N',
    REPARTO_VALIDADO_AT TIMESTAMP,
    TARGET_SCHEMA CHAR(10) DEFAULT 'JAVIER',
    SYNC_STATUS VARCHAR(16) DEFAULT 'LOCAL',
    SYNC_AT TIMESTAMP,
    SYSTEM_SUBEMPRESAPEDIDO CHAR(3) DEFAULT ' ',
    SYSTEM_EJERCICIOPEDIDO NUMERIC(4) DEFAULT 0,
    SYSTEM_SERIEPEDIDO CHAR(1) DEFAULT ' ',
    SYSTEM_TERMINALPEDIDO NUMERIC(3) DEFAULT 0,
    SYSTEM_NUMEROPEDIDO NUMERIC(6) DEFAULT 0,
    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;

const CREATE_PEDIDOS_LIN = `
CREATE TABLE ${ERP_SCHEMA}.PEDIDOS_LIN (
    ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    PEDIDO_ID INTEGER NOT NULL,
    SECUENCIA NUMERIC(4) DEFAULT 1,
    CODIGOARTICULO CHAR(10) NOT NULL,
    DESCRIPCION CHAR(40),
    CANTIDADENVASES NUMERIC(7,2) DEFAULT 0,
    CANTIDADUNIDADES NUMERIC(10,5) DEFAULT 0,
    UNIDADMEDIDA VARCHAR(12) DEFAULT 'CAJAS',
    UNIDADESCAJA NUMERIC(10,5) DEFAULT 1,
    PRECIOVENTA NUMERIC(9,4) DEFAULT 0,
    PRECIOCOSTO NUMERIC(9,4) DEFAULT 0,
    PRECIOTARIFA NUMERIC(9,4) DEFAULT 0,
    PRECIOTARIFACLIENTE NUMERIC(9,4) DEFAULT 0,
    PRECIOMINIMO NUMERIC(9,4) DEFAULT 0,
    IMPORTEVENTA NUMERIC(10,2) DEFAULT 0,
    IMPORTECOSTO NUMERIC(10,2) DEFAULT 0,
    IMPORTEMARGEN NUMERIC(10,2) DEFAULT 0,
    PORCENTAJEMARGEN NUMERIC(7,2) DEFAULT 0,
    DESCUENTO_LINEA DECIMAL(5,2) DEFAULT 0,
    UNIDADESFRACCION NUMERIC(10,5) DEFAULT 0,
    TIPOLINEA CHAR(1) DEFAULT 'R',
    TIPOVENTA CHAR(2) DEFAULT 'CC',
    CLASELINEA CHAR(2) DEFAULT 'VT',
    ORDEN NUMERIC(4) DEFAULT 0,
    CODIGOIVA CHAR(1) DEFAULT '2',
    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;

const CREATE_PEDIDOS_SEQ = `
CREATE TABLE ${ERP_SCHEMA}.PEDIDOS_SEQ (
    EJERCICIO NUMERIC(4) NOT NULL PRIMARY KEY,
    ULTIMO_NUMERO NUMERIC(6) DEFAULT 0
)`;

const CREATE_PEDIDOS_STOCK_RESERVE = `
CREATE TABLE ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE (
    ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    PEDIDO_ID INTEGER NOT NULL,
    CODIGOARTICULO CHAR(10) NOT NULL,
    CANTIDADENVASES NUMERIC(7,2) DEFAULT 0,
    CANTIDADUNIDADES NUMERIC(10,5) DEFAULT 0,
    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;

const CREATE_PEDIDO_IDEMPOTENCY = `
CREATE TABLE ${ERP_SCHEMA}.PEDIDO_IDEMPOTENCY (
    IDEMPOTENCY_KEY VARCHAR(128) NOT NULL PRIMARY KEY,
    PEDIDO_ID INTEGER NOT NULL,
    PAYLOAD_HASH VARCHAR(64) NOT NULL,
    CLIENT_CODE CHAR(10),
    VENDEDOR_CODE CHAR(2),
    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;

// ============================================================================
// HELPERS
// ============================================================================

function isTableNotFound(err) {
    const msg = (err.message || '').toLowerCase();
    const codes = (err.odbcErrors || []).map(e => e.code);
    return codes.includes(-204) || msg.includes('sql0204');
}

function isColumnNotFound(err) {
    const msg = (err.message || '').toLowerCase();
    const codes = (err.odbcErrors || []).map(e => e.code);
    const states = (err.odbcErrors || []).map(e => e.state);
    return codes.includes(-205) || states.includes('42S22') || msg.includes('sql0205') || msg.includes('column not found');
}

function isDuplicateKeyError(err) {
    const msg = String(err?.message || '');
    return /DUPLICATE|PRIMARY|UNIQUE|SQL0803/i.test(msg);
}

let orderSequenceTail = Promise.resolve();
let atomicSequenceUpdateSupported = null;
const systemExportTails = new Map();

function withOrderSequenceLock(callback) {
    const run = orderSequenceTail.then(callback, callback);
    orderSequenceTail = run.catch(() => {});
    return run;
}

function withSystemExportLock(key, callback) {
    const tail = systemExportTails.get(key) || Promise.resolve();
    const run = tail.then(callback, callback);
    const nextTail = run.catch(() => {});
    systemExportTails.set(key, nextTail);
    nextTail.finally(() => {
        if (systemExportTails.get(key) === nextTail) {
            systemExportTails.delete(key);
        }
    }).catch(() => {});
    return run;
}

function systemExportLockKey(target, ejercicio) {
    return [
        target.exportSchema || 'DSEDAC',
        target.subempresa,
        target.serie,
        target.terminal,
        ejercicio,
    ].map((part) => String(part ?? '').trim()).join(':');
}

function isUnsupportedAtomicSequenceUpdate(err) {
    const msg = String(err?.message || '');
    const states = (err?.odbcErrors || []).map((row) => String(row.state || ''));
    const codes = (err?.odbcErrors || []).map((row) => Number(row.code));
    return states.some((state) => state === '42601' || state === '42000')
        || codes.some((code) => code === -104 || code === -199)
        || /SQL0104|SQL0199|syntax/i.test(msg);
}

const IVA_RATE_BY_CODE = Object.freeze({
    '1': 0.10,
    '2': 0.21,
    '3': 0.04,
    '4': 0.0,
    '5': 0.10,
});

function resolveIvaFromCodigo(codigoIva) {
    const code = String(codigoIva || '').trim();
    if (!code || code === '0') {
        return { codigoIva: '2', ivaRate: 0.21 };
    }
    if (Object.prototype.hasOwnProperty.call(IVA_RATE_BY_CODE, code)) {
        return { codigoIva: code, ivaRate: IVA_RATE_BY_CODE[code] };
    }
    return { codigoIva: '2', ivaRate: 0.21 };
}

function parseBooleanFlag(value) {
    if (value === true || value === 1) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'si', 's'].includes(normalized);
}

function roundPrice(value) {
    const number = parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(number * 10000) / 10000;
}

function priceWithIva(value, ivaRate) {
    return roundPrice(roundPrice(value) * (1 + normalizeIvaRateValue(ivaRate, 0.21)));
}

function applyProductPriceView(product, includeIva = false) {
    if (!product) return product;
    const view = { ...product };
    const iva = resolveIvaFromCodigo(view.codigoIva || view.CODIGOIVA);
    view.codigoIva = iva.codigoIva;
    view.ivaRate = iva.ivaRate;
    view.includeIva = parseBooleanFlag(includeIva);

    const priceFields = ['precioTarifa1', 'precioMinimo', 'precioCliente', 'precioTarifaCliente'];
    for (const field of priceFields) {
        const base = view[field];
        if (base === null || base === undefined) continue;
        const sinIva = roundPrice(base);
        const conIva = priceWithIva(sinIva, iva.ivaRate);
        view[`${field}SinIva`] = sinIva;
        view[`${field}ConIva`] = conIva;
        if (view.includeIva) view[field] = conIva;
    }

    if (Array.isArray(view.tariffs)) {
        view.tariffs = view.tariffs.map((tariff) => {
            const next = { ...tariff };
            const price = roundPrice(next.price);
            next.priceSinIva = price;
            next.priceConIva = priceWithIva(price, iva.ivaRate);
            if (next.precioUnitario !== undefined && next.precioUnitario !== null) {
                const unit = roundPrice(next.precioUnitario);
                next.precioUnitarioSinIva = unit;
                next.precioUnitarioConIva = priceWithIva(unit, iva.ivaRate);
            }
            if (view.includeIva) {
                next.price = next.priceConIva;
                if (next.precioUnitarioConIva !== undefined) {
                    next.precioUnitario = next.precioUnitarioConIva;
                }
            }
            return next;
        });
    }

    return view;
}

function normalizeIvaRateValue(value, fallback = 0.21) {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed > 1 ? parsed / 100 : parsed;
}

function codigoIvaFromRate(rate) {
    const normalized = normalizeIvaRateValue(rate, null);
    if (normalized === null) return null;
    const found = Object.entries(IVA_RATE_BY_CODE)
        .find(([, ivaRate]) => Math.abs(ivaRate - normalized) < 0.0001);
    return found ? found[0] : null;
}

function resolveIvaFromLine(line = {}, fallbackCode = '2') {
    const explicitCode = trimString(line.codigoIva ?? line.CODIGOIVA);
    if (explicitCode) return resolveIvaFromCodigo(explicitCode);

    const rawRate = line.ivaRate ?? line.IVARATE ?? line.TIPOIVA;
    if (rawRate !== undefined && rawRate !== null && rawRate !== '') {
        const rate = normalizeIvaRateValue(rawRate, 0.21);
        const code = codigoIvaFromRate(rate) || fallbackCode || '2';
        return { codigoIva: code, ivaRate: rate };
    }

    return resolveIvaFromCodigo(fallbackCode);
}

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

    const err = new Error('tipoventa/saleType debe ser CC (Venta), VC (Venta sin nombre) o NV (No venta)');
    err.code = 'INVALID_SALE_TYPE';
    err.status = 400;
    throw err;
}

function getPedidoSaleTypeLabel(value = 'CC') {
    return PEDIDO_SALE_TYPE_LABELS[normalizePedidoSaleType(value)];
}

function buildCreateOrderPayloadHash({
    clientCode,
    vendedorCode,
    tipoventa = 'CC',
    observaciones = '',
    descuentoGlobal = 0,
    lines = [],
}) {
    const canonicalLines = (lines || []).map((line) => ({
        codigoArticulo: trimString(line.codigoArticulo || line.CODIGOARTICULO),
        cantidadEnvases: Number(parseFloat(line.cantidadEnvases ?? line.CANTIDADENVASES) || 0).toFixed(4),
        cantidadUnidades: Number(parseFloat(line.cantidadUnidades ?? line.CANTIDADUNIDADES ?? line.cantidad) || 0).toFixed(4),
        precioVenta: Number(parseFloat(line.precioVenta ?? line.precio ?? line.PRECIOVENTA) || 0).toFixed(4),
        unidadMedida: trimString(line.unidadMedida || line.UNIDADMEDIDA || 'CAJAS'),
        claseLinea: trimString(line.claseLinea || line.CLASELINEA || 'VT'),
        descuentoLinea: Number(parseFloat(line.descuentoLinea ?? line.DESCUENTO_LINEA) || 0).toFixed(2),
    })).sort((a, b) => a.codigoArticulo.localeCompare(b.codigoArticulo));

    const payload = {
        clientCode: truncate(clientCode, 10),
        vendedorCode: resolvePedidoActorCodes({ CODIGOVENDEDOR: vendedorCode }).vendedor,
        tipoventa: normalizePedidoSaleType(tipoventa),
        observaciones: trimString(observaciones),
        descuentoGlobal: Number(parseFloat(descuentoGlobal) || 0).toFixed(2),
        lines: canonicalLines,
    };

    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function lookupPedidoIdempotency(idempotencyKey) {
    try {
        const rows = await queryWithParams(
            `SELECT PEDIDO_ID, PAYLOAD_HASH
               FROM ${ERP_SCHEMA}.PEDIDO_IDEMPOTENCY
              WHERE IDEMPOTENCY_KEY = ?`,
            [idempotencyKey],
            false,
            false,
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
}) {
    const storedClientCode = truncate(clientCode, 10);
    const storedVendedorCode = resolvePedidoActorCodes({ CODIGOVENDEDOR: vendedorCode }).vendedor;
    await queryWithParams(
        `INSERT INTO ${ERP_SCHEMA}.PEDIDO_IDEMPOTENCY
            (IDEMPOTENCY_KEY, PEDIDO_ID, PAYLOAD_HASH, CLIENT_CODE, VENDEDOR_CODE)
         VALUES (?, ?, ?, ?, ?)`,
        [
            truncate(idempotencyKey, 128),
            pedidoId,
            truncate(payloadHash, 64),
            storedClientCode,
            storedVendedorCode,
        ],
        false,
        false,
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

async function resolveIdempotentCreateOrder({
    idempotencyKey,
    clientCode,
    vendedorCode,
    tipoventa,
    observaciones,
    descuentoGlobal,
    lines,
}) {
    if (!idempotencyKey) return null;

    const payloadHash = buildCreateOrderPayloadHash({
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

    if (existing.payloadHash !== payloadHash) {
        throw createIdempotencyConflictError();
    }

    const order = await getOrderDetail(existing.pedidoId);
    return { payloadHash, replay: { ...order, idempotent: true } };
}

/**
 * Sanitize a string for safe SQL interpolation (only used where
 * parameterized queries are not possible, e.g. dynamic IN lists).
 */
function sanitize(val) {
    if (val == null) return '';
    return String(val).replace(/'/g, "''");
}

function trimString(value) {
    return value == null ? '' : String(value).trim();
}

class OrderStateError extends Error {
    constructor(code, message, status = 409) {
        super(message);
        this.name = 'OrderStateError';
        this.code = code;
        this.status = status;
    }
}

const VALID_ORDER_STATES = ['BORRADOR', 'CONFIRMANDO', 'CONFIRMADO'];
const MAX_ORDER_LINES = 200;
const DB2_BULK_INSERT_CHUNK_SIZE = 25;
const STOCK_RESERVE_BULK_INSERT_CHUNK_SIZE = 100;
const DEFAULT_PEDIDOS_ERP_TERMINAL = 93;

const ORDER_TRANSITIONS = {
    BORRADOR: new Set(['CONFIRMADO']),
    CONFIRMANDO: new Set(['CONFIRMADO', 'BORRADOR']),
    CONFIRMADO: new Set(),
};

function canonicalOrderStatus(status) {
    const normalized = trimString(status).toUpperCase();
    if (['PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION'].includes(normalized)) return 'BORRADOR';
    if (['ENVIADO', 'ENTREGADO', 'FACTURADO'].includes(normalized)) return 'CONFIRMADO';
    return VALID_ORDER_STATES.includes(normalized) ? normalized : 'BORRADOR';
}

function publicOrderStatus(status) {
    const normalized = canonicalOrderStatus(status);
    if (normalized === 'CONFIRMADO') return 'CONFIRMADO';
    return 'BORRADOR';
}

function storedOrderStatus(status) {
    return canonicalOrderStatus(status);
}

function isOrderTransitionAllowed(fromStatus, toStatus) {
    const rawFrom = trimString(fromStatus).toUpperCase();
    const rawTo = trimString(toStatus).toUpperCase();
    if (['ENVIADO', 'ENTREGADO', 'FACTURADO', 'ANULADO'].includes(rawFrom)) return false;
    if (rawTo !== 'BORRADOR' && rawTo !== 'CONFIRMADO') return false;
    const from = canonicalOrderStatus(fromStatus);
    const to = canonicalOrderStatus(toStatus);
    return ORDER_TRANSITIONS[from]?.has(to) === true;
}

async function getOrderVendorForAuth(orderId) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');
    const rows = await queryWithParams(
        SELECT_ORDER_VENDOR_FOR_AUTH_SQL,
        [id],
        false
    );
    if (!rows || rows.length === 0) return null;
    return {
        id: rows[0].ID || id,
        vendedorCode: trimString(rows[0].CODIGOVENDEDOR),
        clientCode: trimString(rows[0].CODIGOCLIENTE),
    };
}

async function getOrderStatusForUpdate(orderId) {
    const rows = await queryWithParams(
        `SELECT TRIM(ESTADO) AS ESTADO FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`,
        [orderId],
    );
    if (!rows || rows.length === 0) {
        throw new OrderStateError('ORDER_NOT_FOUND', 'Pedido no encontrado', 404);
    }
    return canonicalOrderStatus(rows[0].ESTADO);
}

async function assertOrderEditable(orderId) {
    const status = await getOrderStatusForUpdate(orderId);
    if (status !== 'BORRADOR') {
        throw new OrderStateError(
            'ORDER_NOT_EDITABLE',
            `Solo se pueden editar lineas en estado BORRADOR (estado actual: ${status})`,
            409,
        );
    }
    return status;
}

function pedidosSchemaName(raw) {
    return db2Schema(raw || 'JAVIER', 'PEDIDOS_CONFIRMATION_SCHEMA');
}

function primaryPedidoCode(value) {
    return trimString(value).split(',')[0].trim();
}

function normalizePedidoActorCode(value, fallback = '') {
    const primary = primaryPedidoCode(value) || primaryPedidoCode(fallback);
    if (!primary) return '';
    if (/^\d+$/.test(primary)) return primary.padStart(2, '0').slice(-2);
    return truncate(primary, 2);
}

function resolvePedidoActorCodes(header = {}, userId) {
    const vendedor = normalizePedidoActorCode(header.CODIGOVENDEDOR);
    const vendedorCobro = normalizePedidoActorCode(header.CODIGOVENDEDORCOBRO, vendedor);
    const promotor = normalizePedidoActorCode(header.CODIGOPROMOTORPREVENTA || header.CODIGOPROMOTOR, vendedor);
    const comercial = normalizePedidoActorCode(header.CODIGOCOMERCIAL, vendedor);
    const vendedorUsuario = normalizePedidoActorCode(userId || header.CODIGOVENDEDORUSUARIO, vendedor);
    const codigoUsuario = primaryPedidoCode(userId || header.CODIGOUSUARIO) || vendedorUsuario || 'APP';
    return {
        vendedor,
        vendedorCobro,
        promotor,
        comercial,
        vendedorUsuario,
        codigoUsuario: truncate(codigoUsuario, 10),
    };
}

function resolvePedidoTerminal(vendedorCode, userId) {
    const actor = resolvePedidoActorCodes({ CODIGOVENDEDOR: vendedorCode }, userId);
    const vendedor = actor.vendedor;
    if (/^\d{1,3}$/.test(vendedor)) {
        const terminal = parseInt(vendedor, 10);
        if (terminal > 0 && terminal <= 999) return terminal;
    }

    const fallback = parseInt(process.env.PEDIDOS_SYSTEM_TERMINAL || '', 10);
    if (Number.isFinite(fallback) && fallback > 0 && fallback <= 999) return fallback;
    return DEFAULT_PEDIDOS_ERP_TERMINAL;
}

function formatPedidoNumeroAcisa(serie, terminal, numeroPedido) {
    const serieLabel = trimString(serie) || 'M';
    const terminalLabel = String(integerValue(terminal) || 0).padStart(3, '0');
    const numeroLabel = String(integerValue(numeroPedido) || 0).padStart(6, '0');
    return `${serieLabel}-${terminalLabel}-${numeroLabel}`;
}

function isAuthorizedForceConfirm(options = {}) {
    if (options.forceConfirm !== true) return false;
    const role = String(options.userRole || '').trim().toUpperCase();
    const reason = trimString(options.forceConfirmReason || options.auditReason);
    return options.adminOverride === true
        && ['ADMIN', 'JEFE_VENTAS'].includes(role)
        && reason.length >= 8;
}

function getPedidosConfirmationTarget() {
    const requestedSchema = getDb2WriteSchemaRequested();
    const schema = getDb2WriteSchema();
    const storageApproved = isDsedacWriteApproved();
    const exportEnabled = String(process.env.PEDIDOS_EXPORT_TO_SYSTEM || 'false').trim().toLowerCase() === 'true';
    const exportApproved = String(process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED || 'false').trim().toLowerCase() === 'true';
    // Export to DSEDAC.CPC is independent of local write schema (JAVIER.PEDIDOS_*).
    const shouldExportToSystem = storageApproved && exportEnabled && exportApproved;
    const exportSchema = 'DSEDAC';
    const subempresa = trimString(process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP').substring(0, 3) || 'GMP';
    const serie = trimString(process.env.PEDIDOS_SYSTEM_SERIE || 'P').substring(0, 1) || 'P';
    const terminal = resolvePedidoTerminal();
    return {
        schema,
        requestedSchema,
        storageApproved,
        appBuffersAllowed: isDsedacAppBuffersAllowed(),
        writeSchemaDiagnostic: getDb2WriteSchemaDiagnostic(),
        exportSchema,
        mode: shouldExportToSystem ? 'SYSTEM' : 'LOCAL',
        shouldExportToSystem,
        exportRequested: exportEnabled,
        exportApproved,
        subempresa,
        serie,
        terminal,
        codigoOperacion: trimString(process.env.PEDIDOS_SYSTEM_CODIGO_OPERACION || 'V').substring(0, 1) || 'V',
        situacionPedido: trimString(process.env.PEDIDOS_SYSTEM_SITUACION_PEDIDO || 'A').substring(0, 1) || 'A',
        codigoTipoPedido: trimString(process.env.PEDIDOS_SYSTEM_CODIGO_TIPO_PEDIDO || '').substring(0, 3),
        codigoUsuario: trimString(process.env.PEDIDOS_SYSTEM_CODIGO_USUARIO || 'APP').substring(0, 10) || 'APP',
        tables: {
            cab: db2QualifiedTable(exportSchema, 'CPC'),
            lin: db2QualifiedTable(exportSchema, 'LPC'),
            obs: db2QualifiedTable(exportSchema, 'OCPC'),
        },
    };
}

const DELIVERY_DAY_ORDER = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DAY_NAMES_BY_JS_INDEX = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const DAY_LABELS = {
    lunes: 'lunes',
    martes: 'martes',
    miercoles: 'miercoles',
    jueves: 'jueves',
    viernes: 'viernes',
    sabado: 'sabado',
    domingo: 'domingo',
};
const DAY_SHORT = {
    lunes: 'L',
    martes: 'M',
    miercoles: 'X',
    jueves: 'J',
    viernes: 'V',
    sabado: 'S',
    domingo: 'D',
};
const CRUT_DELIVERY_COLUMNS = {
    lunes: 'DIAREPARTOLUNESSN',
    martes: 'DIAREPARTOMARTESSN',
    miercoles: 'DIAREPARTOMIERCOLESSN',
    jueves: 'DIAREPARTOJUEVESSN',
    viernes: 'DIAREPARTOVIERNESSN',
    sabado: 'DIAREPARTOSABADOSN',
    domingo: 'DIAREPARTODOMINGOSN',
};
const LACLAE_DELIVERY_COLUMNS = {
    lunes: 'R1_T8DIRL',
    martes: 'R1_T8DIRM',
    miercoles: 'R1_T8DIRX',
    jueves: 'R1_T8DIRJ',
    viernes: 'R1_T8DIRV',
    sabado: 'R1_T8DIRS',
    domingo: 'R1_T8DIRD',
};

function normalizeDayName(value) {
    const normalized = trimString(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const aliases = {
        l: 'lunes',
        lu: 'lunes',
        lunes: 'lunes',
        m: 'martes',
        ma: 'martes',
        martes: 'martes',
        x: 'miercoles',
        mi: 'miercoles',
        miercoles: 'miercoles',
        miercolesn: 'miercoles',
        j: 'jueves',
        ju: 'jueves',
        jueves: 'jueves',
        v: 'viernes',
        vi: 'viernes',
        viernes: 'viernes',
        s: 'sabado',
        sa: 'sabado',
        sabado: 'sabado',
        d: 'domingo',
        do: 'domingo',
        domingo: 'domingo',
    };
    return aliases[normalized] || '';
}

function normalizeDayList(days) {
    if (!days) return [];
    const raw = String(days).trim();
    const source = Array.isArray(days)
        ? days
        : /^[LMXJVSD]+$/i.test(raw)
            ? raw.split('')
            : raw.split(/[,;|\s]+/);
    const set = new Set(source.map(normalizeDayName).filter(Boolean));
    return DELIVERY_DAY_ORDER.filter(day => set.has(day));
}

function deliveryDaysShort(days) {
    return normalizeDayList(days).map(day => DAY_SHORT[day]).join('');
}

function yesFlag(value) {
    return trimString(value).toUpperCase() === 'S' || trimString(value).toUpperCase() === 'Y' || trimString(value) === '1';
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function parseDeliveryDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
        const y = value.getUTCFullYear();
        const m = value.getUTCMonth() + 1;
        const d = value.getUTCDate();
        const iso = `${y}-${pad2(m)}-${pad2(d)}`;
        return { iso, year: y, month: m, day: d, dayName: DAY_NAMES_BY_JS_INDEX[value.getUTCDay()] };
    }

    const raw = trimString(value);
    let y;
    let m;
    let d;
    let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        y = parseInt(match[1], 10);
        m = parseInt(match[2], 10);
        d = parseInt(match[3], 10);
    } else {
        match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!match) throw new Error('Fecha reparto invalida');
        d = parseInt(match[1], 10);
        m = parseInt(match[2], 10);
        y = parseInt(match[3], 10);
    }

    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== m || parsed.getUTCDate() !== d) {
        throw new Error('Fecha reparto invalida');
    }

    return {
        iso: `${y}-${pad2(m)}-${pad2(d)}`,
        year: y,
        month: m,
        day: d,
        dayName: DAY_NAMES_BY_JS_INDEX[parsed.getUTCDay()],
    };
}

function formatDateDisplay(value) {
    const parsed = parseDeliveryDate(value);
    if (!parsed) return '';
    return `${pad2(parsed.day)}/${pad2(parsed.month)}/${parsed.year}`;
}

function getNextDeliveryDate(allowedDays, fromDate = new Date()) {
    const days = normalizeDayList(allowedDays);
    const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
    const start = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()));

    for (let i = 0; i < 31; i++) {
        const candidate = new Date(start);
        candidate.setUTCDate(start.getUTCDate() + i);
        const dayName = DAY_NAMES_BY_JS_INDEX[candidate.getUTCDay()];
        if (days.length === 0 || days.includes(dayName)) {
            return parseDeliveryDate(candidate);
        }
    }

    return parseDeliveryDate(start);
}

function deliveryDaysFromRows(rows, columnMap) {
    const present = new Set();
    for (const row of rows || []) {
        for (const day of DELIVERY_DAY_ORDER) {
            if (yesFlag(row[columnMap[day]])) present.add(day);
        }
    }
    return DELIVERY_DAY_ORDER.filter(day => present.has(day));
}

async function fetchClientDeliveryDays({ clientCode, vendedorCode }) {
    const cleanClient = trimString(clientCode);
    const cleanVendor = trimString(vendedorCode).split(',')[0].substring(0, 2);

    try {
        if (typeof getClientDays === 'function') {
            const cached = getClientDays(cleanVendor, cleanClient);
            const cachedDays = normalizeDayList(cached?.deliveryDays || cached?.deliveryDaysShort);
            if (cachedDays.length > 0) {
                return { days: cachedDays, source: 'laclae-cache' };
            }
        }
    } catch (error) {
        logger.warn(`[PEDIDOS] getClientDays failed for ${cleanClient}/${cleanVendor}: ${error.message}`);
    }

    try {
        const params = [cleanClient];
        let vendorFilter = '';
        if (cleanVendor) {
            vendorFilter = ' AND TRIM(CODIGOVENDEDOR) = ?';
            params.push(cleanVendor);
        }
        const rows = await queryWithParams(`
            SELECT DIAREPARTOLUNESSN, DIAREPARTOMARTESSN, DIAREPARTOMIERCOLESSN,
                   DIAREPARTOJUEVESSN, DIAREPARTOVIERNESSN, DIAREPARTOSABADOSN,
                   DIAREPARTODOMINGOSN
            FROM DSEDAC.CRUT
            WHERE TRIM(CODIGOCLIENTE) = ?
              ${vendorFilter}
              AND COALESCE(TRIM(MARCAACTUALIZACION), '') <> 'B'
            ORDER BY SECUENCIA
            FETCH FIRST 10 ROWS ONLY`,
            params,
            false
        );
        const crutDays = deliveryDaysFromRows(rows, CRUT_DELIVERY_COLUMNS);
        if (crutDays.length > 0) {
            return { days: crutDays, source: 'DSEDAC.CRUT' };
        }
        if (cleanVendor) {
            const allVendorRows = await queryWithParams(`
                SELECT DIAREPARTOLUNESSN, DIAREPARTOMARTESSN, DIAREPARTOMIERCOLESSN,
                       DIAREPARTOJUEVESSN, DIAREPARTOVIERNESSN, DIAREPARTOSABADOSN,
                       DIAREPARTODOMINGOSN
                FROM DSEDAC.CRUT
                WHERE TRIM(CODIGOCLIENTE) = ?
                  AND COALESCE(TRIM(MARCAACTUALIZACION), '') <> 'B'
                ORDER BY SECUENCIA
                FETCH FIRST 10 ROWS ONLY`,
                [cleanClient],
                false
            );
            const allCrutDays = deliveryDaysFromRows(allVendorRows, CRUT_DELIVERY_COLUMNS);
            if (allCrutDays.length > 0) {
                return { days: allCrutDays, source: 'DSEDAC.CRUT' };
            }
        }
    } catch (error) {
        logger.warn(`[PEDIDOS] CRUT delivery days lookup failed for ${cleanClient}/${cleanVendor}: ${error.message}`);
    }

    try {
        const currentYear = new Date().getFullYear();
        const vendorRowsPromise = cleanVendor
            ? queryWithParams(`
            SELECT R1_T8DIRL, R1_T8DIRM, R1_T8DIRX, R1_T8DIRJ,
                   R1_T8DIRV, R1_T8DIRS, R1_T8DIRD
            FROM DSED.LACLAE
            WHERE LCCDCL = CAST(? AS CHAR(10))
              AND LCAADC >= ?
              AND R1_T8CDVD = CAST(? AS CHAR(2))
            FETCH FIRST 20 ROWS ONLY`,
                [cleanClient, currentYear - 1, cleanVendor],
                false
            )
            : Promise.resolve([]);
        const allVendorRowsPromise = cleanVendor
            ? queryWithParams(`
                SELECT R1_T8DIRL, R1_T8DIRM, R1_T8DIRX, R1_T8DIRJ,
                       R1_T8DIRV, R1_T8DIRS, R1_T8DIRD
                FROM DSED.LACLAE
                WHERE LCCDCL = CAST(? AS CHAR(10))
                  AND LCAADC >= ?
                FETCH FIRST 20 ROWS ONLY`,
                [cleanClient, currentYear - 1],
                false
            )
            : Promise.resolve([]);
        const [rows, allVendorRows] = await Promise.all([vendorRowsPromise, allVendorRowsPromise]);
        const laclaeDays = deliveryDaysFromRows(rows, LACLAE_DELIVERY_COLUMNS);
        if (laclaeDays.length > 0) {
            return { days: laclaeDays, source: 'DSED.LACLAE' };
        }
        if (cleanVendor) {
            const allLaclaeDays = deliveryDaysFromRows(allVendorRows, LACLAE_DELIVERY_COLUMNS);
            if (allLaclaeDays.length > 0) {
                return { days: allLaclaeDays, source: 'DSED.LACLAE' };
            }
        }
    } catch (error) {
        logger.warn(`[PEDIDOS] LACLAE delivery days lookup failed for ${cleanClient}/${cleanVendor}: ${error.message}`);
    }

    return { days: [], source: 'none' };
}

async function resolveDeliveryPlan({ clientCode, vendedorCode, deliveryDate, fromDate }) {
    const deliveryInfo = await fetchClientDeliveryDays({ clientCode, vendedorCode });
    const allowedDays = normalizeDayList(deliveryInfo.days);
    const requestedDate = deliveryDate ? parseDeliveryDate(deliveryDate) : getNextDeliveryDate(allowedDays, fromDate);

    if (allowedDays.length > 0 && !allowedDays.includes(requestedDate.dayName)) {
        throw new Error(`Fecha reparto ${formatDateDisplay(requestedDate.iso)} (${DAY_LABELS[requestedDate.dayName]}) no permitida. Dias reparto cliente: ${allowedDays.map(day => DAY_LABELS[day]).join(', ')}`);
    }

    return {
        date: requestedDate,
        allowedDays,
        allowedDaysShort: deliveryDaysShort(allowedDays),
        source: deliveryInfo.source,
        validated: allowedDays.length > 0,
    };
}

function normalizeAssignmentRow(row) {
    if (!row) return {};
    return {
        vehicleCode: trimString(row.CODIGOVEHICULO || row.VEHICLECODE).substring(0, 10),
        driverCode: trimString(row.CODIGOREPARTIDOR || row.DRIVERCODE).substring(0, 2),
        vehicleMatricula: trimString(row.MATRICULA || row.VEHICULOMATRICULA),
        vehicleDescription: trimString(row.DESC_VEHICULO || row.DESCRIPCIONVEHICULO || row.VEHICLEDESCRIPTION),
        routeCode: trimString(row.RUTA || row.CODIGORUTA).substring(0, 10),
    };
}

async function getClientOrderDefaults(clientCode) {
    const cleanClient = trimString(clientCode).substring(0, 10);
    if (!cleanClient) return {};

    try {
        const rows = await queryWithParams(`
            SELECT TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) AS NOMBRECLIENTE,
                   TRIM(COALESCE(CLI.CODIGORUTA, '')) AS CODIGORUTA,
                   COALESCE(CLC.CODIGOTARIFA, 1) AS CODIGOTARIFA,
                   TRIM(COALESCE(NULLIF(TRIM(CLC.CODIGOFORMAPAGO1), ''), NULLIF(TRIM(CLC.CODIGOFORMAPAGO2), ''), '')) AS CODIGOFORMAPAGO
              FROM DSEDAC.CLI CLI
              LEFT JOIN DSEDAC.CLC CLC
                ON TRIM(CLC.CODIGOCLIENTE) = TRIM(CLI.CODIGOCLIENTE)
             WHERE TRIM(CLI.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
             FETCH FIRST 1 ROW ONLY`,
            [cleanClient],
            false
        );
        const row = rows?.[0];
        if (!row) return {};
        return {
            clientName: truncate(row.NOMBRECLIENTE, 60),
            routeCode: truncate(row.CODIGORUTA, 10),
            formaPago: truncate(row.CODIGOFORMAPAGO, 2),
            tarifa: integerValue(row.CODIGOTARIFA) || 1,
        };
    } catch (error) {
        logger.warn(`[PEDIDOS] Client order defaults lookup failed for ${cleanClient}: ${error.message}`);
        return {};
    }
}

async function invalidatePedidosStockCache(reasonTag = '') {
    try {
        if (redisCache && typeof redisCache.invalidatePattern === 'function') {
            await redisCache.invalidatePattern('query:query:pedidos:*');
        }
    } catch (err) {
        logger.warn(`[PEDIDOS] Stock cache invalidation skipped${reasonTag ? ` (${reasonTag})` : ''}: ${err.message}`);
    }
}

async function getDefaultTruckAssignment({ clientCode, vendedorCode, deliveryDate, routeCode }) {
    const cleanClient = trimString(clientCode);
    const cleanVendor = trimString(vendedorCode).split(',')[0].substring(0, 2);
    const explicitRouteCode = trimString(routeCode).substring(0, 10);

    try {
        const params = [cleanClient];
        let vendorFilter = '';
        if (cleanVendor) {
            vendorFilter = ' OR TRIM(CPC.CODIGOVENDEDOR) = ?';
            params.push(cleanVendor);
        }
        const rows = await queryWithParams(`
            SELECT TRIM(OPP.CODIGOVEHICULO) AS CODIGOVEHICULO,
                   TRIM(OPP.CODIGOREPARTIDOR) AS CODIGOREPARTIDOR,
                   TRIM(CPC.CODIGORUTA) AS RUTA,
                   TRIM(VEH.MATRICULA) AS MATRICULA,
                   TRIM(VEH.DESCRIPCIONVEHICULO) AS DESC_VEHICULO,
                   COUNT(*) AS USOS,
                   MAX(OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) AS ULTIMA_FECHA
            FROM DSEDAC.OPP OPP
            LEFT JOIN DSEDAC.CPC CPC
              ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
             AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
            LEFT JOIN DSEDAC.VEH VEH ON TRIM(VEH.CODIGOVEHICULO) = TRIM(OPP.CODIGOVEHICULO)
            WHERE (TRIM(CPC.CODIGOCLIENTEALBARAN) = ?${vendorFilter})
              AND OPP.ANOREPARTO >= YEAR(CURRENT DATE) - 1
              AND TRIM(OPP.CODIGOVEHICULO) <> ''
            GROUP BY TRIM(OPP.CODIGOVEHICULO), TRIM(OPP.CODIGOREPARTIDOR),
                     TRIM(CPC.CODIGORUTA), TRIM(VEH.MATRICULA), TRIM(VEH.DESCRIPCIONVEHICULO)
            ORDER BY USOS DESC, ULTIMA_FECHA DESC
            FETCH FIRST 1 ROW ONLY`,
            params,
            false
        );
        const assignment = normalizeAssignmentRow(rows?.[0]);
        if (assignment.vehicleCode || assignment.driverCode) {
            const defaults = explicitRouteCode || assignment.routeCode ? {} : await getClientOrderDefaults(cleanClient);
            return {
                ...assignment,
                routeCode: explicitRouteCode || assignment.routeCode || defaults.routeCode || '',
                confidence: 'media',
                source: 'DSEDAC.OPP',
            };
        }
    } catch (error) {
        logger.warn(`[PEDIDOS] Default truck lookup failed for ${cleanClient}/${cleanVendor}: ${error.message}`);
    }

    const defaults = explicitRouteCode ? {} : await getClientOrderDefaults(cleanClient);
    return {
        vehicleCode: '',
        driverCode: '',
        vehicleMatricula: '',
        vehicleDescription: '',
        routeCode: explicitRouteCode || defaults.routeCode || '',
        confidence: 'sin-datos',
        source: defaults.routeCode ? 'DSEDAC.CLI' : 'none',
    };
}

async function getDeliveryOptions({ clientCode, vendedorCode, deliveryDate }) {
    if (!clientCode || !vendedorCode) {
        throw new Error('clientCode and vendedorCode are required');
    }

    const cleanClient = trimString(clientCode).substring(0, 10);
    const cleanVendor = trimString(vendedorCode).split(',')[0].substring(0, 2);
    const cleanDate = deliveryDate ? trimString(deliveryDate).substring(0, 10) : '';
    const cacheKey = `pedidos:delivery-options:${cleanClient}:${cleanVendor}:${cleanDate || 'next'}`;
    const cached = await redisCache.get('route', cacheKey);
    if (cached) return cached;

    const deliveryPlan = await resolveDeliveryPlan({ clientCode, vendedorCode, deliveryDate });
    const assignment = await getDefaultTruckAssignment({
        clientCode,
        vendedorCode,
        deliveryDate: deliveryPlan.date.iso,
    });

    const options = {
        clientCode: cleanClient,
        vendedorCode: cleanVendor,
        allowedDeliveryDays: deliveryPlan.allowedDays,
        allowedDeliveryDaysShort: deliveryPlan.allowedDaysShort,
        suggestedDeliveryDate: deliveryPlan.date.iso,
        suggestedDeliveryDateFormatted: formatDateDisplay(deliveryPlan.date.iso),
        selectedDeliveryDate: deliveryPlan.date.iso,
        selectedDeliveryDateFormatted: formatDateDisplay(deliveryPlan.date.iso),
        vehicleCode: assignment.vehicleCode || '',
        driverCode: assignment.driverCode || '',
        vehicleMatricula: assignment.vehicleMatricula || '',
        vehicleDescription: assignment.vehicleDescription || '',
        truckConfidence: assignment.confidence || 'sin-datos',
        truckSource: assignment.source || 'none',
        routeCode: assignment.routeCode || '',
        validated: deliveryPlan.validated,
        deliveryDaysSource: deliveryPlan.source,
    };
    await redisCache.set('route', cacheKey, options, TTL.SHORT);
    return options;
}

async function getAvailableVehicles() {
    try {
        const sql = `
            SELECT
                V.CODIGOVEHICULO AS code,
                V.MATRICULA      AS matricula,
                V.DESCRIPCIONVEHICULO AS description,
                V.CODIGOCONDUCTOR AS driverCode,
                V.TONELADAS      AS toneladas,
                V.CARGAMAXIMA    AS cargaMaxima
            FROM DSEDAC.VEH V
            ORDER BY V.CODIGOVEHICULO
        `;
        const rows = await queryWithParams(sql, []);
        return (rows || []).map(row => ({
            code:        trimString(row.CODE        || row.code        || '').substring(0, 10),
            matricula:   trimString(row.MATRICULA   || row.matricula   || ''),
            description: trimString(row.DESCRIPTION || row.description || ''),
            driverCode:  trimString(row.DRIVERCODE  || row.driverCode  || ''),
            toneladas:   numberValue(row.TONELADAS  || row.toneladas),
            cargaMaxima: numberValue(row.CARGAMAXIMA|| row.cargaMaxima),
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] getAvailableVehicles error: ${error.message}`);
        return [];
    }
}

function numberValue(raw) {
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
}

async function tableExists(conn, schema, table) {
    const rows = await conn.query(
        `SELECT TABLE_NAME
         FROM QSYS2.SYSTABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         FETCH FIRST 1 ROW ONLY`,
        [schema.toUpperCase(), table.toUpperCase()]
    );
    return rows.length > 0;
}

async function columnExists(conn, schema, table, column) {
    const rows = await conn.query(
        `SELECT COLUMN_NAME
         FROM QSYS2.SYSCOLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
         FETCH FIRST 1 ROW ONLY`,
        [schema.toUpperCase(), table.toUpperCase(), column.toUpperCase()]
    );
    return rows.length > 0;
}

function integerValue(raw) {
    const num = parseInt(raw, 10);
    return Number.isFinite(num) ? num : 0;
}

function roundMoney(raw) {
    return Math.round((numberValue(raw) + Number.EPSILON) * 100) / 100;
}

function currentHhmmss() {
    const now = new Date();
    return parseInt(
        `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`,
        10
    );
}

function truncate(value, length) {
    return trimString(value).substring(0, length);
}

function isMissingPricingTableError(error) {
    const message = String(error?.message || error?.sqlMessage || error || '');
    const upperMessage = message.toUpperCase();
    const pricingObjects = [
        BOLSA_PRODUCT_PRICE_TABLE,
        CLIENT_SPECIAL_PRICE_TABLE,
        CLIENT_UNIT_AMOUNT_PROMO_TABLE,
    ];
    return /SQL0204|42704|not\s+found|undefined\s+name/i.test(message)
        && pricingObjects.some(name => upperMessage.includes(name.toUpperCase()) || upperMessage.includes(name.split('.').pop()));
}

function yesNoFlag(value, fallback = false) {
    if (value === null || value === undefined || value === '') return fallback;
    return parseBooleanFlag(value);
}

function pricingPlaceholders(values) {
    return values.map(() => '?').join(',');
}

function effectiveMinPriceFromRow(row) {
    const configuredFloor = roundPrice(row.PRECIO_MINIMO ?? row.precioMinimo ?? 0);
    const cost = roundPrice(row.COSTE_FABRICACION ?? row.costeFabricacion ?? 0);
    const marginPct = parseFloat(row.MARGEN_OBJETIVO_PCT ?? row.margenObjetivoPct) || 0;
    const marginFloor = cost > 0 ? roundPrice(cost * (1 + marginPct / 100)) : 0;
    return Math.max(configuredFloor, marginFloor);
}

function mergeConfiguredPricing(product, productPricing, clientPrice) {
    const next = { ...product };

    if (productPricing) {
        const configuredMin = effectiveMinPriceFromRow(productPricing);
        const manufacturingCost = roundPrice(productPricing.COSTE_FABRICACION ?? 0);
        const lockedFloor = roundPrice(productPricing.PRECIO_MINIMO ?? 0);
        const marginPct = parseFloat(productPricing.MARGEN_OBJETIVO_PCT) || 0;

        next.precioMinimoBase = lockedFloor;
        next.costeFabricacion = manufacturingCost;
        next.margenObjetivoPct = marginPct;
        next.precioMinimoCalculado = configuredMin;
        next.precioMinimoSource = BOLSA_PRODUCT_PRICE_TABLE;

        if (configuredMin > 0) next.precioMinimo = configuredMin;
        if (manufacturingCost > 0) next.precioCosto = manufacturingCost;
    }

    if (clientPrice) {
        const price = roundPrice(clientPrice.PRECIO_ESPECIAL ?? clientPrice.PRECIO_CLIENTE ?? 0);
        if (price > 0) {
            next.precioCliente = price;
            next.precioClienteSource = String(clientPrice.SOURCE || '').trim();
            next.precioEspecialCliente = yesNoFlag(clientPrice.IS_SPECIAL_PRICE, false);
            next.permiteBajoMinimo = yesNoFlag(clientPrice.PERMITE_BAJO_MINIMO, next.precioEspecialCliente);
            next.precioEspecialMotivo = String(clientPrice.MOTIVO || '').trim();
            if (next.precioEspecialCliente) {
                next.precioTarifaCliente = price;
            }
        }
    }

    return next;
}

async function getConfiguredPricingMaps(articleCodes, clientCode) {
    const codes = [...new Set((articleCodes || []).map(code => truncate(code, 10)).filter(Boolean))];
    if (codes.length === 0) return { productPricing: new Map(), clientPrices: new Map() };

    const productPricing = new Map();
    const clientPrices = new Map();
    const placeholders = pricingPlaceholders(codes);

    const productSql = `
        SELECT
            CODIGOARTICULO,
            UNIDAD_BASE,
            FECHA_DESDE,
            FECHA_HASTA,
            COSTE_FABRICACION,
            MARGEN_OBJETIVO_PCT,
            PRECIO_MINIMO,
            SOURCE,
            RN
        FROM (
            SELECT
                TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
                UNIDAD_BASE,
                FECHA_DESDE,
                FECHA_HASTA,
                COSTE_FABRICACION,
                MARGEN_OBJETIVO_PCT,
                PRECIO_MINIMO,
                SOURCE,
                ROW_NUMBER() OVER (
                    PARTITION BY TRIM(CODIGOARTICULO), TRIM(UNIDAD_BASE)
                    ORDER BY FECHA_DESDE DESC, ID DESC
                ) AS RN
            FROM ${BOLSA_PRODUCT_PRICE_TABLE}
            WHERE ACTIVO = 'S'
              AND TRIM(CODIGOARTICULO) IN (${placeholders})
              AND FECHA_DESDE <= CURRENT DATE
              AND (FECHA_HASTA IS NULL OR FECHA_HASTA >= CURRENT DATE)
        ) X
        WHERE RN = 1`;

    try {
        const rows = await queryWithParams(productSql, codes, false);
        for (const row of rows || []) {
            productPricing.set(String(row.CODIGOARTICULO || '').trim(), row);
        }
    } catch (error) {
        if (isMissingPricingTableError(error)) {
            logger.warn(`[PEDIDOS] ${BOLSA_PRODUCT_PRICE_TABLE} no existe todavia; se usan tarifas ERP`);
        } else {
            throw error;
        }
    }

    const trimClient = clientCode ? truncate(clientCode, 10) : '';
    if (!trimClient) return { productPricing, clientPrices };

    const promoPriceSql = `
        SELECT
            CODIGOARTICULO,
            PRECIO_ESPECIAL,
            PROMO_ID,
            IS_SPECIAL_PRICE,
            PERMITE_BAJO_MINIMO,
            MOTIVO,
            SOURCE,
            RN
        FROM (
            SELECT
                TRIM(P.CODIGOARTICULO) AS CODIGOARTICULO,
                P.PRECIO AS PRECIO_ESPECIAL,
                P.PROMOCIONPRECIOESPECIAL AS PROMO_ID,
                'S' AS IS_SPECIAL_PRICE,
                'S' AS PERMITE_BAJO_MINIMO,
                'Precio especial ERP' AS MOTIVO,
                '${CLIENT_SPECIAL_PRICE_TABLE}' AS SOURCE,
                ROW_NUMBER() OVER (
                    PARTITION BY TRIM(P.CODIGOARTICULO)
                    ORDER BY P.FECHA_INICIO DESC, P.PROMOCIONPRECIOESPECIAL DESC, P.SECUENCIA DESC
                ) AS RN
            FROM DSEDAC.CLP C
            JOIN (
                SELECT
                    P0.PROMOCIONPRECIOESPECIAL,
                    P0.CODIGOARTICULO,
                    P0.SECUENCIA,
                    DATE(TIMESTAMP_FORMAT(
                        DIGITS(P0.ANOINICIO) CONCAT RIGHT(DIGITS(P0.MESINICIO), 2) CONCAT RIGHT(DIGITS(P0.DIAINICIO), 2),
                        'YYYYMMDD'
                    )) AS FECHA_INICIO,
                    DATE(TIMESTAMP_FORMAT(
                        DIGITS(P0.ANOFINAL) CONCAT RIGHT(DIGITS(P0.MESFINAL), 2) CONCAT RIGHT(DIGITS(P0.DIAFINAL), 2),
                        'YYYYMMDD'
                    )) AS FECHA_FIN,
                    P0.PRECIO
                FROM ${CLIENT_SPECIAL_PRICE_TABLE} P0
            ) P
              ON P.PROMOCIONPRECIOESPECIAL IN (
                  C.PROMOCIONPRECIOESPECIAL,
                  C.PROMOCIONCLIENTE,
                  C.PROMOCIONDESCUENTOPRODUCTO,
                  C.PROMOCIONIMPORTEUNIDAD,
                  C.PROMOCIONAPORB,
                  C.PROMOCIONRELACIONSDSCLIART
              )
            WHERE TRIM(C.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
              AND TRIM(P.CODIGOARTICULO) IN (${placeholders})
              AND CURRENT DATE BETWEEN P.FECHA_INICIO AND P.FECHA_FIN
              AND P.PRECIO > 0
        ) X
        WHERE RN = 1`;

    try {
        const rows = await queryWithParams(promoPriceSql, [trimClient, ...codes], false);
        for (const row of rows || []) {
            clientPrices.set(String(row.CODIGOARTICULO || '').trim(), row);
        }
    } catch (error) {
        if (isMissingPricingTableError(error)) {
            logger.warn(`[PEDIDOS] ${CLIENT_SPECIAL_PRICE_TABLE} no disponible; se usan tarifa ERP/historico`);
        } else {
            logger.warn(`[PEDIDOS] Lectura precio especial ERP fallo: ${error.message}; se usa tarifa ERP/historico`);
        }
    }

    const missingHistoryCodes = codes.filter(code => !clientPrices.has(code));
    if (missingHistoryCodes.length > 0) {
        const historyPlaceholders = pricingPlaceholders(missingHistoryCodes);
        const historySql = `
            SELECT
                CODIGOARTICULO,
                PRECIO_CLIENTE,
                IS_SPECIAL_PRICE,
                PERMITE_BAJO_MINIMO,
                MOTIVO,
                SOURCE,
                RN
            FROM (
                SELECT
                    TRIM(L.CODIGOARTICULO) AS CODIGOARTICULO,
                    L.PRECIOVENTA AS PRECIO_CLIENTE,
                    'N' AS IS_SPECIAL_PRICE,
                    'N' AS PERMITE_BAJO_MINIMO,
                    'Ultimo precio real del cliente' AS MOTIVO,
                    'DSEDAC.LINDTO' AS SOURCE,
                    ROW_NUMBER() OVER (
                        PARTITION BY TRIM(L.CODIGOARTICULO)
                        ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC, L.NUMERODOCUMENTO DESC
                    ) AS RN
                FROM DSEDAC.LINDTO L
                WHERE TRIM(L.CODIGOCLIENTEALBARAN) = CAST(? AS VARCHAR(10))
                  AND TRIM(L.CODIGOARTICULO) IN (${historyPlaceholders})
                  AND L.PRECIOVENTA > 0
                  AND L.TIPOVENTA IN ('CC', 'VC')
                  AND L.CLASELINEA IN ('AB', 'VT')
                  AND L.SERIEALBARAN NOT IN ('N', 'Z')
            ) X
            WHERE RN = 1`;
        try {
            const rows = await queryWithParams(historySql, [trimClient, ...missingHistoryCodes], false);
            for (const row of rows || []) {
                clientPrices.set(String(row.CODIGOARTICULO || '').trim(), row);
            }
        } catch (error) {
            logger.warn(`[PEDIDOS] Lectura historico LINDTO fallo: ${error.message}; se usa tarifa ERP`);
        }
    }

    return { productPricing, clientPrices };
}

async function applyConfiguredPricingToProducts(products, clientCode) {
    if (!Array.isArray(products) || products.length === 0) return products;
    const maps = await getConfiguredPricingMaps(products.map(p => p.code), clientCode);
    return products.map((product) => {
        const code = String(product.code || '').trim();
        return mergeConfiguredPricing(
            product,
            maps.productPricing.get(code),
            maps.clientPrices.get(code)
        );
    });
}

async function applyConfiguredPricingToProduct(product, clientCode) {
    const [priced] = await applyConfiguredPricingToProducts(product ? [product] : [], clientCode);
    return priced || product;
}

function clampInt(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function splitFixedText(value, width, count) {
    const text = trimString(value);
    const chunks = [];
    for (let i = 0; i < count; i++) {
        chunks.push(text.substring(i * width, (i + 1) * width));
    }
    return chunks;
}

function isBoxUnidadMedida(unidadMedida) {
    const unit = trimString(unidadMedida).toUpperCase();
    return unit === '' || unit === 'CAJA' || unit === 'CAJAS' || unit === 'ENVASE' || unit === 'ENVASES';
}

function cajaUnidadFlag(unidadMedida) {
    return isBoxUnidadMedida(unidadMedida) ? 'C' : 'U';
}

async function withPedidosTransaction(callback) {
    let pool = getPool();
    if (!pool && typeof initDb === 'function') {
        await initDb();
        pool = getPool();
    }
    if (!pool || typeof pool.connect !== 'function') {
        throw new Error('No DB pool available for pedidos transaction');
    }

    const conn = await pool.connect();
    try {
        // IBM i ODBC rejects BEGIN WORK (-104); use isolation + COMMIT/ROLLBACK instead.
        await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        const result = await callback(conn);
        await conn.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await conn.query('ROLLBACK');
        } catch (rollbackError) {
            logger.error(`[PEDIDOS] Rollback failed: ${rollbackError.message}`);
        }
        throw error;
    } finally {
        try {
            await conn.close();
        } catch (_) {
            // ignore close errors
        }
    }
}

function db2BulkInsertSql(qualifiedTable, columns, rowCount) {
    const count = Math.max(1, Number(rowCount) || 1);
    const placeholders = `(${db2Placeholders(columns)})`;
    return `INSERT INTO ${db2QualifiedTableName(qualifiedTable)} (${db2ColumnList(columns)}) VALUES ${Array.from({ length: count }, () => placeholders).join(', ')}`;
}

function assertCompatibleInsertSpecs(specs, label) {
    if (!Array.isArray(specs) || specs.length === 0) return null;
    const first = specs[0];
    const firstColumns = JSON.stringify(first.columns || []);
    for (const spec of specs) {
        if (spec.table !== first.table || JSON.stringify(spec.columns || []) !== firstColumns) {
            throw new Error(`${label} bulk insert specs are not compatible`);
        }
    }
    return first;
}

async function executeBulkInsert(executor, specs, { chunkSize = DB2_BULK_INSERT_CHUNK_SIZE, label = 'bulk_insert' } = {}) {
    if (!Array.isArray(specs) || specs.length === 0) return 0;
    const first = assertCompatibleInsertSpecs(specs, label);
    const size = Math.max(1, Number(chunkSize) || DB2_BULK_INSERT_CHUNK_SIZE);
    let count = 0;
    for (let i = 0; i < specs.length; i += size) {
        const chunk = specs.slice(i, i + size);
        const sql = db2BulkInsertSql(first.table, first.columns, chunk.length);
        const params = chunk.flatMap((spec) => spec.params);
        await executor(sql, params);
        count += chunk.length;
    }
    return count;
}

async function nextSystemPedidoNumber(conn, target, ejercicio) {
    const rows = await conn.query(`
        SELECT COALESCE(MAX(NUMEROPEDIDO), 0) + 1 AS NEXT_NUMERO
        FROM ${target.tables.cab}
        WHERE TRIM(SUBEMPRESAPEDIDO) = ?
          AND EJERCICIOPEDIDO = ?
          AND TRIM(SERIEPEDIDO) = ?
          AND TERMINALPEDIDO = ?`,
        [target.subempresa, ejercicio, target.serie, target.terminal]
    );
    return integerValue(rows?.[0]?.NEXT_NUMERO) || 1;
}

function isRetriableCpcExportError(err) {
    if (isDuplicateKeyError(err)) return true;
    const codes = (err?.odbcErrors || []).map((row) => Number(row.code));
    return codes.some((code) => code === -913 || code === -803 || code === -911);
}

function buildDsedacCpcInsert({ target, header, systemRef, deliveryPlan, routeCode, saleType, userId, vehicleCode, driverCode }) {
    const docDay = integerValue(header.DIADOCUMENTO) || new Date().getDate();
    const docMonth = integerValue(header.MESDOCUMENTO) || new Date().getMonth() + 1;
    const docYear = integerValue(header.ANODOCUMENTO) || integerValue(header.EJERCICIO) || new Date().getFullYear();
    const hora = integerValue(header.HORADOCUMENTO) || currentHhmmss();
    const actor = resolvePedidoActorCodes(header);
    const cliente = truncate(header.CODIGOCLIENTE, 10);
    const observaciones = splitFixedText(header.OBSERVACIONES, 50, 2);
    const total = roundMoney(header.IMPORTETOTAL || header.IMPORTEBASE);
    const base = roundMoney(header.IMPORTEBASE || total);
    const costo = roundMoney(header.IMPORTECOSTO);
    const margen = roundMoney(header.IMPORTEMARGEN || (base - costo));

    const columns = [
        'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO',
        'DIADOCUMENTO', 'MESDOCUMENTO', 'ANODOCUMENTO', 'HORADOCUMENTO',
        'CODIGOCLIENTEALBARAN', 'CODIGOCLIENTEFACTURA', 'CODIGOCLIENTECADENA',
        'CODIGOVENDEDOR', 'CODIGOVENDEDORCOBRO', 'CODIGOPROMOTORPREVENTA', 'CODIGOCOMERCIAL',
        'CODIGORUTA',
        'CODIGOFORMAPAGO', 'CODIGOTARIFA', 'CODIGOALMACEN', 'RECARGOSN',
        'IMPORTEBASEIMPONIBLEBRUTA1', 'IMPORTEBASEIMPONIBLE1', 'IMPORTEBRUTO',
        'IMPORTETOTAL', 'IMPORTECOSTO', 'IMPORTEMARGEN',
        'SITUACIONPEDIDO', 'CODIGOOPERACION', 'OBSERVACION1', 'OBSERVACION2',
        'DIACREACION', 'MESCREACION', 'ANOCREACION', 'HORACREACION',
        'CODIGOVENDEDORUSUARIO', 'CODIGOUSUARIO', 'CODIGOTIPOPEDIDO',
        'DIASERVICIO', 'MESSERVICIO', 'ANOSERVICIO',
    ];
    const params = [
        systemRef.subempresa, systemRef.ejercicio, systemRef.serie, systemRef.terminal, systemRef.numero,
        docDay, docMonth, docYear, hora,
        cliente, cliente, '',
        actor.vendedor, actor.vendedorCobro, actor.promotor, actor.comercial,
        truncate(routeCode, 4),
        truncate(header.CODIGOFORMAPAGO || '02', 2),
        integerValue(header.CODIGOTARIFA) || 1, integerValue(header.CODIGOALMACEN) || 1, 'N',
        base, base, base,
        total, costo, margen,
        target.situacionPedido, target.codigoOperacion, observaciones[0], observaciones[1],
        docDay, docMonth, docYear, hora,
        actor.vendedorUsuario, actor.codigoUsuario || target.codigoUsuario, target.codigoTipoPedido,
        deliveryPlan.date.day, deliveryPlan.date.month, deliveryPlan.date.year,
    ];

    return {
        sql: db2InsertSql(target.tables.cab, columns),
        params,
    };
}

function buildDsedacLpcInsert({ target, header, line, systemRef, deliveryPlan, routeCode, saleType, userId }) {
    const docDay = integerValue(header.DIADOCUMENTO) || new Date().getDate();
    const docMonth = integerValue(header.MESDOCUMENTO) || new Date().getMonth() + 1;
    const docYear = integerValue(header.ANODOCUMENTO) || integerValue(header.EJERCICIO) || new Date().getFullYear();
    const hora = integerValue(header.HORADOCUMENTO) || currentHhmmss();
    const actor = resolvePedidoActorCodes(header);
    const cliente = truncate(header.CODIGOCLIENTE, 10);
    const effectiveSaleType = normalizePedidoSaleType(saleType || line.TIPOVENTA || header.TIPOVENTA || 'CC');
    const iva = resolveIvaFromLine(line);

    const columns = [
        'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO',
        'SECUENCIAPEDIDO', 'DIADOCUMENTO', 'MESDOCUMENTO', 'ANODOCUMENTO', 'HORADOCUMENTO',
        'CODIGOCLIENTEALBARAN', 'CODIGOCLIENTEFACTURA', 'CODIGOCLIENTECADENA',
        'CODIGOVENDEDOR', 'CODIGOVENDEDORCOBRO', 'CODIGOPROMOTORPREVENTA', 'CODIGOCOMERCIAL',
        'CODIGORUTA', 'CODIGOFORMAPAGO', 'CODIGOTARIFA', 'CODIGOALMACEN', 'RECARGOSN',
        'TIPOLINEA', 'TIPOVENTA', 'CLASELINEA', 'CODIGOARTICULO', 'DESCRIPCION',
        'CODIGOIVA',
        'CANTIDADENVASES', 'CANTIDADUNIDADES', 'PRECIOVENTA', 'IMPORTEVENTA',
        'PRECIOCOSTO', 'IMPORTECOSTO', 'CAJASUNIDADES', 'PRECIOTARIFACLIENTE',
        'PRECIOTARIFA01', 'CODIGOESTADO',
    ];
    const params = [
        systemRef.subempresa, systemRef.ejercicio, systemRef.serie, systemRef.terminal, systemRef.numero,
        integerValue(line.SECUENCIA || line.ORDEN) || 1,
        docDay, docMonth, docYear, hora,
        cliente, cliente, '',
        actor.vendedor, actor.vendedorCobro, actor.promotor, actor.comercial,
        truncate(routeCode, 4), truncate(header.CODIGOFORMAPAGO || '02', 2),
        integerValue(header.CODIGOTARIFA) || 1, integerValue(header.CODIGOALMACEN) || 1, 'N',
        truncate(line.TIPOLINEA || 'R', 1) || 'R',
        effectiveSaleType,
        truncate(line.CLASELINEA || 'VT', 2) || 'VT',
        truncate(line.CODIGOARTICULO, 10),
        truncate(line.DESCRIPCION, 40),
        iva.codigoIva,
        numberValue(line.CANTIDADENVASES),
        numberValue(line.CANTIDADUNIDADES),
        numberValue(line.PRECIOVENTA),
        roundMoney(line.IMPORTEVENTA),
        numberValue(line.PRECIOCOSTO),
        roundMoney(line.IMPORTECOSTO),
        cajaUnidadFlag(line.UNIDADMEDIDA),
        numberValue(line.PRECIOTARIFACLIENTE),
        numberValue(line.PRECIOTARIFA),
        '',
    ];

    return {
        table: target.tables.lin,
        columns,
        sql: db2InsertSql(target.tables.lin, columns),
        params,
    };
}

function buildDsedacOcpcInsert({ target, header, systemRef, userId }) {
    const chunks = splitFixedText(header.OBSERVACIONES, 120, 10);
    if (chunks.every(chunk => !trimString(chunk))) return null;

    const docDay = integerValue(header.DIADOCUMENTO) || new Date().getDate();
    const docMonth = integerValue(header.MESDOCUMENTO) || new Date().getMonth() + 1;
    const docYear = integerValue(header.ANODOCUMENTO) || integerValue(header.EJERCICIO) || new Date().getFullYear();
    const actor = resolvePedidoActorCodes(header);
    const columns = [
        'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO',
        'DIAOBSERVACION', 'MESOBSERVACION', 'ANOOBSERVACION', 'SECUENCIA',
        'OBSERVACION01', 'OBSERVACION02', 'OBSERVACION03', 'OBSERVACION04', 'OBSERVACION05',
        'OBSERVACION06', 'OBSERVACION07', 'OBSERVACION08', 'OBSERVACION09', 'OBSERVACION10',
        'CODIGOUSUARIO',
    ];
    const params = [
        systemRef.subempresa, systemRef.ejercicio, systemRef.serie, systemRef.terminal, systemRef.numero,
        docDay, docMonth, docYear, 1,
        ...chunks,
        truncate(actor.codigoUsuario || target.codigoUsuario, 10),
    ];
    return {
        sql: db2InsertSql(target.tables.obs, columns),
        params,
    };
}

async function exportCommercialOrderToSystem(conn, { header, lines, deliveryPlan, routeCode, saleType, userId, vehicleCode, driverCode }) {
    const target = {
        ...getPedidosConfirmationTarget(),
        terminal: resolvePedidoTerminal(header.CODIGOVENDEDOR, userId),
    };
    if (!target.shouldExportToSystem) {
        return {
            targetSchema: 'JAVIER',
            syncStatus: 'LOCAL',
            synced: false,
            systemRef: {
                subempresa: ' ',
                ejercicio: 0,
                serie: ' ',
                terminal: 0,
                numero: 0,
            },
        };
    }

    const ejercicio = integerValue(header.EJERCICIO) || deliveryPlan.date.year || new Date().getFullYear();
    return withSystemExportLock(systemExportLockKey(target, ejercicio), async () => {
        let systemRef = null;
        let cab = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const numero = await nextSystemPedidoNumber(conn, target, ejercicio);
            systemRef = {
                subempresa: target.subempresa,
                ejercicio,
                serie: target.serie,
                terminal: target.terminal,
                numero,
            };
            cab = buildDsedacCpcInsert({ target, header, systemRef, deliveryPlan, routeCode, saleType, userId, vehicleCode, driverCode });
            try {
                await conn.query(cab.sql, cab.params);
                break;
            } catch (e) {
                if (isRetriableCpcExportError(e) && attempt < 2) {
                    logger.warn(`[PEDIDOS] CPC insert retriable error numero=${systemRef?.numero}, retry ${attempt + 1}: ${e.message}`);
                    continue;
                }
                logger.error(`[PEDIDOS] CPC insert failed cols=${cab.params?.length} sql=${cab.sql?.slice(0, 200)} err=${e.message} ${JSON.stringify(e.odbcErrors || [])}`);
                throw e;
            }
        }

        const lpcRows = (lines || []).map(line => buildDsedacLpcInsert({ target, header, line, systemRef, deliveryPlan, routeCode, saleType, userId }));
        try {
            await executeBulkInsert((sql, params) => conn.query(sql, params), lpcRows, {
                chunkSize: DB2_BULK_INSERT_CHUNK_SIZE,
                label: 'DSEDAC.LPC',
            });
        } catch (e) {
            logger.error(`[PEDIDOS] LPC bulk insert failed rows=${lpcRows.length} err=${e.message} ${JSON.stringify(e.odbcErrors || [])}`);
            throw e;
        }

        const obs = buildDsedacOcpcInsert({ target, header, systemRef, userId });
        if (obs) {
            await conn.query(obs.sql, obs.params);
        }

        return {
            targetSchema: target.exportSchema || 'DSEDAC',
            syncStatus: 'SYNCED',
            synced: true,
            systemRef,
        };
    });
}

function buildConfirmOrderUpdate({ id, deliveryPlan, vehicleCode, driverCode, routeCode, saleType, syncResult }) {
    const sync = syncResult || {
        targetSchema: 'JAVIER',
        syncStatus: 'LOCAL',
        synced: false,
        systemRef: { subempresa: ' ', ejercicio: 0, serie: ' ', terminal: 0, numero: 0 },
    };
    const ref = sync.systemRef || {};
    const params = [
        deliveryPlan.date.iso,
        deliveryPlan.date.day,
        deliveryPlan.date.month,
        deliveryPlan.date.year,
        deliveryPlan.allowedDays.join(','),
        deliveryPlan.validated ? 'S' : 'N',
        vehicleCode,
        driverCode,
        routeCode,
        truncate(sync.targetSchema || 'JAVIER', 10),
        truncate(sync.syncStatus || 'LOCAL', 16),
        truncate(ref.subempresa || ' ', 3),
        integerValue(ref.ejercicio),
        truncate(ref.serie || ' ', 1),
        integerValue(ref.terminal),
        integerValue(ref.numero),
    ];
    let sql = `UPDATE ${ERP_SCHEMA}.PEDIDOS_CAB SET ESTADO = 'CONFIRMADO',
        UPDATED_AT = CURRENT_TIMESTAMP,
        FECHAREPARTO = ?,
        DIAREPARTO = ?,
        MESREPARTO = ?,
        ANOREPARTO = ?,
        DIASREPARTO = ?,
        REPARTO_VALIDADO_SN = ?,
        REPARTO_VALIDADO_AT = CURRENT_TIMESTAMP,
        CODIGOVEHICULO = ?,
        CODIGOREPARTIDOR = ?,
        RUTA = ?,
        TARGET_SCHEMA = ?,
        SYNC_STATUS = ?,
        SYNC_AT = ${sync.synced ? 'CURRENT_TIMESTAMP' : 'SYNC_AT'},
        SYSTEM_SUBEMPRESAPEDIDO = ?,
        SYSTEM_EJERCICIOPEDIDO = ?,
        SYSTEM_SERIEPEDIDO = ?,
        SYSTEM_TERMINALPEDIDO = ?,
        SYSTEM_NUMEROPEDIDO = ?`;
    if (saleType) {
        sql += `, TIPOVENTA = ?`;
        params.push(saleType.trim());
    }
    params.push(id);
    sql += ` WHERE ID = ?`;
    return { sql, params };
}

async function reserveStockLines(executor, lines, orderId) {
    const byCode = new Map();
    for (const line of lines) {
        const code = trimString(line.CODIGOARTICULO);
        if (!code) continue;
        const resEnv = parseFloat(line.CANTIDADENVASES) || 0;
        const resUni = parseFloat(line.CANTIDADUNIDADES) || 0;
        if (resEnv <= 0 && resUni <= 0) continue;
        const current = byCode.get(code) || { envases: 0, unidades: 0 };
        current.envases += resEnv;
        current.unidades += resUni;
        byCode.set(code, current);
    }

    const columns = ['PEDIDO_ID', 'CODIGOARTICULO', 'CANTIDADENVASES', 'CANTIDADUNIDADES'];
    const specs = [...byCode.entries()].map(([code, qty]) => ({
        table: `${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE`,
        columns,
        params: [orderId, code, qty.envases, qty.unidades],
    }));
    await executeBulkInsert(executor, specs, {
        chunkSize: STOCK_RESERVE_BULK_INSERT_CHUNK_SIZE,
        label: 'PEDIDOS_STOCK_RESERVE',
    });
}

async function replaceStockReservationLines(executor, lines, orderId) {
    await executor(
        `DELETE FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?`,
        [orderId]
    );
    await reserveStockLines(executor, lines, orderId);
}

function buildReservationLinesFromCreateContexts(lineContexts) {
    return (lineContexts || []).map(({ line, amounts }) => ({
        CODIGOARTICULO: truncate(line.codigoArticulo || line.CODIGOARTICULO, 10),
        CANTIDADENVASES: amounts.cantidadEnvases,
        CANTIDADUNIDADES: amounts.cantidadUnidades,
    }));
}

async function refreshDraftStockReservation(orderId, executor = (sql, params) => queryWithParams(sql, params, false)) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');
    const lines = await executor(
        `SELECT TRIM(L.CODIGOARTICULO) AS CODIGOARTICULO,
                SUM(L.CANTIDADENVASES) AS CANTIDADENVASES,
                SUM(L.CANTIDADUNIDADES) AS CANTIDADUNIDADES
           FROM ${ERP_SCHEMA}.PEDIDOS_LIN L
           JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON C.ID = L.PEDIDO_ID
          WHERE L.PEDIDO_ID = ?
            AND TRIM(C.ESTADO) IN (${DRAFT_STOCK_RESERVATION_STATES_SQL})
          GROUP BY TRIM(L.CODIGOARTICULO)`,
        [id]
    );
    await replaceStockReservationLines(executor, lines || [], id);
}

// ============================================================================
// TABLE INITIALIZATION
// ============================================================================

async function initPedidosTables() {
    const pool = getPool();
    if (!pool) { logger.warn('[PEDIDOS] No DB pool available for init'); return; }

    const tables = [
        { schema: ERP_SCHEMA, table: 'PEDIDOS_CAB', name: `${ERP_SCHEMA}.PEDIDOS_CAB`, ddl: CREATE_PEDIDOS_CAB },
        { schema: ERP_SCHEMA, table: 'PEDIDOS_LIN', name: `${ERP_SCHEMA}.PEDIDOS_LIN`, ddl: CREATE_PEDIDOS_LIN },
        { schema: ERP_SCHEMA, table: 'PEDIDOS_SEQ', name: `${ERP_SCHEMA}.PEDIDOS_SEQ`, ddl: CREATE_PEDIDOS_SEQ },
        { schema: ERP_SCHEMA, table: 'PEDIDOS_STOCK_RESERVE', name: `${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE`, ddl: CREATE_PEDIDOS_STOCK_RESERVE },
        { schema: ERP_SCHEMA, table: 'PEDIDO_IDEMPOTENCY', name: `${ERP_SCHEMA}.PEDIDO_IDEMPOTENCY`, ddl: CREATE_PEDIDO_IDEMPOTENCY },
    ];

    let conn;
    try {
        conn = await pool.connect();

        for (const t of tables) {
            try {
                if (await tableExists(conn, t.schema, t.table)) {
                    logger.info(`[PEDIDOS] ${t.name} ready`);
                    continue;
                }
                await conn.query(t.ddl);
                logger.info(`[PEDIDOS] Created ${t.name}`);
            } catch (e) {
                throw e;
            }
        }

        // Ensure additive PEDIDOS_CAB columns exist in older JAVIER installs.
        const additiveColumns = [
            { table: 'PEDIDOS_CAB', name: 'DESCUENTO_GLOBAL', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN DESCUENTO_GLOBAL DECIMAL(5,2) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'ORIGEN', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN ORIGEN CHAR(1) DEFAULT 'A'` },
            { table: 'PEDIDOS_CAB', name: 'FECHAREPARTO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN FECHAREPARTO DATE` },
            { table: 'PEDIDOS_CAB', name: 'DIAREPARTO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN DIAREPARTO NUMERIC(2) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'MESREPARTO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN MESREPARTO NUMERIC(2) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'ANOREPARTO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN ANOREPARTO NUMERIC(4) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'CODIGOREPARTIDOR', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN CODIGOREPARTIDOR CHAR(2) DEFAULT ' '` },
            { table: 'PEDIDOS_CAB', name: 'CODIGOVEHICULO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN CODIGOVEHICULO CHAR(10) DEFAULT ' '` },
            { table: 'PEDIDOS_CAB', name: 'RUTA', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN RUTA VARCHAR(10) DEFAULT ''` },
            { table: 'PEDIDOS_CAB', name: 'DIASREPARTO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN DIASREPARTO VARCHAR(80) DEFAULT ''` },
            { table: 'PEDIDOS_CAB', name: 'REPARTO_VALIDADO_SN', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN REPARTO_VALIDADO_SN CHAR(1) DEFAULT 'N'` },
            { table: 'PEDIDOS_CAB', name: 'REPARTO_VALIDADO_AT', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN REPARTO_VALIDADO_AT TIMESTAMP` },
            { table: 'PEDIDOS_CAB', name: 'TARGET_SCHEMA', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN TARGET_SCHEMA CHAR(10) DEFAULT 'JAVIER'` },
            { table: 'PEDIDOS_CAB', name: 'SYNC_STATUS', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYNC_STATUS VARCHAR(16) DEFAULT 'LOCAL'` },
            { table: 'PEDIDOS_CAB', name: 'SYNC_AT', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYNC_AT TIMESTAMP` },
            { table: 'PEDIDOS_CAB', name: 'SYSTEM_SUBEMPRESAPEDIDO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYSTEM_SUBEMPRESAPEDIDO CHAR(3) DEFAULT ' '` },
            { table: 'PEDIDOS_CAB', name: 'SYSTEM_EJERCICIOPEDIDO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYSTEM_EJERCICIOPEDIDO NUMERIC(4) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'SYSTEM_SERIEPEDIDO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYSTEM_SERIEPEDIDO CHAR(1) DEFAULT ' '` },
            { table: 'PEDIDOS_CAB', name: 'SYSTEM_TERMINALPEDIDO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYSTEM_TERMINALPEDIDO NUMERIC(3) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'SYSTEM_NUMEROPEDIDO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYSTEM_NUMEROPEDIDO NUMERIC(6) DEFAULT 0` },
            { table: 'PEDIDOS_LIN', name: 'DESCUENTO_LINEA', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_LIN ADD COLUMN DESCUENTO_LINEA DECIMAL(5,2) DEFAULT 0` },
            { table: 'PEDIDOS_LIN', name: 'UNIDADESFRACCION', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_LIN ADD COLUMN UNIDADESFRACCION NUMERIC(10,5) DEFAULT 0` },
            { table: 'PEDIDOS_LIN', name: 'CODIGOIVA', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_LIN ADD COLUMN CODIGOIVA CHAR(1) DEFAULT '2'` },
        ];

        for (const col of additiveColumns) {
            try {
                if (await columnExists(conn, ERP_SCHEMA, col.table, col.name)) continue;
                await conn.query(col.ddl);
                logger.info(`[PEDIDOS] Added missing ${col.name} column to ${col.table}`);
            } catch (colErr) {
                logger.warn(`[PEDIDOS] Could not add ${col.name} column to ${col.table}: ${colErr.message}`);
                try { await conn.close(); } catch (_) { /* ignore */ }
                conn = await pool.connect();
            }
        }
    } catch (err) {
        logger.error(`[PEDIDOS] Table init error: ${err.message}`);
    } finally {
        if (conn) try { await conn.close(); } catch (_) { /* ignore */ }
    }
}

// ============================================================================
// PRODUCTS
// ============================================================================

async function getProducts({ search, clientCode, family, marca, prefamily, includeIva = false, limit = 50, offset = 0 }) {
    const params = [];
    let where = "WHERE A.ANOBAJA = 0 AND TRIM(A.CODIGOARTICULO) <> ''";

    if (search) {
        const s = `%${search.toUpperCase()}%`;
        where += ' AND (UPPER(A.DESCRIPCIONARTICULO) LIKE ? OR TRIM(A.CODIGOARTICULO) LIKE ?)';
        params.push(s, s);
    }
    if (family) {
        where += ' AND TRIM(A.CODIGOFAMILIA) = ?';
        params.push(family.trim());
    }
    if (marca) {
        where += ' AND TRIM(A.CODIGOMARCA) = ?';
        params.push(marca.trim());
    }
    // Req #14: filtro por prefamilia (e.g. Nestle). Buscamos en 3 columnas
    // (prefamilia, marca, descripcion) para que el chip "Nestle" encuentre
    // productos aunque CODIGOPREFAMILIA este vacio en algunos articulos.
    // Tambien aceptamos prefijo corto: NES -> NES%, NESTLE -> NESTLE%
    if (prefamily) {
        const term = String(prefamily).toUpperCase().trim();
        const likeStart = `${term}%`;
        const likeAny = `%${term}%`;
        where += ` AND (
              UPPER(TRIM(A.CODIGOPREFAMILIA)) LIKE ?
           OR UPPER(TRIM(A.CODIGOMARCA))       LIKE ?
           OR UPPER(TRIM(A.DESCRIPCIONARTICULO)) LIKE ?
        )`;
        params.push(likeStart, likeStart, likeAny);
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const prevYear = currentYear - 1;
    const clientCodeTrimmed = truncate(clientCode, 10);

    // Week-based accumulation logic (same as rutero in planner.js:1135-1145)
    const startOfCurrentYear = new Date(currentYear, 0, 1);
    const daysSinceStart = Math.floor((now - startOfCurrentYear) / 86400000);
    const weekNumber = Math.floor(daysSinceStart / 7) + 1;
    const endMonthCurrent = now.getMonth() + 1;
    const endDayCurrent = now.getDate();

    // Find equivalent Sunday (same week number) in previous year
    const startOfPreviousYear = new Date(prevYear, 0, 1);
    const firstSundayOffsetPrev = (7 - startOfPreviousYear.getDay()) % 7;
    const equivalentSundayPrev = new Date(prevYear, 0, 1 + firstSundayOffsetPrev + (weekNumber - 1) * 7);
    const endMonthPrevious = equivalentSundayPrev.getMonth() + 1;
    const endDayPrevious = equivalentSundayPrev.getDate();
    const resultCacheKey = `pedidos:products_final_v3:${clientCodeTrimmed}:${search || ''}:${family || ''}:${marca || ''}:${prefamily || ''}:${offset}:${limit}:${includeIva ? 'iva' : 'net'}`;
    const cachedProducts = await redisCache.get('route', resultCacheKey);
    if (cachedProducts) return cachedProducts;

    const historyParams = [
        // CASE WHEN SALES_THIS_YEAR: year, month_lt, month_eq, day (4)
        currentYear, endMonthCurrent, endMonthCurrent, endDayCurrent,
        // CASE WHEN SALES_PREV_YEAR: year, month_lt, month_eq, day (4)
        prevYear, endMonthPrevious, endMonthPrevious, endDayPrevious,
        // WHERE client code (1)
        clientCodeTrimmed,
        // WHERE L.LCAADC IN (2)
        currentYear, prevYear,
        // WHERE date filter current year: year, month_lt, month_eq, day (4)
        currentYear, endMonthCurrent, endMonthCurrent, endDayCurrent,
        // WHERE date filter prev year: year, month_lt, month_eq, day (4)
        prevYear, endMonthPrevious, endMonthPrevious, endDayPrevious,
    ];

    const sql = `
        WITH PH AS (
            SELECT
                TRIM(L.LCCDRF) AS CODIGOARTICULO,
                SUM(CASE WHEN L.LCAADC = ? AND (L.LCMMDC < ? OR (L.LCMMDC = ? AND L.LCDDDC <= ?)) THEN L.LCIMVT ELSE 0 END) AS SALES_THIS_YEAR,
                SUM(CASE WHEN L.LCAADC = ? AND (L.LCMMDC < ? OR (L.LCMMDC = ? AND L.LCDDDC <= ?)) THEN L.LCIMVT ELSE 0 END) AS SALES_PREV_YEAR,
                COUNT(*) AS PURCHASE_COUNT
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) = CAST(? AS VARCHAR(10))
              AND L.LCAADC IN (?, ?)
              AND ((L.LCAADC = ? AND (L.LCMMDC < ? OR (L.LCMMDC = ? AND L.LCDDDC <= ?)))
                OR (L.LCAADC = ? AND (L.LCMMDC < ? OR (L.LCMMDC = ? AND L.LCDDDC <= ?)))
              )
              AND ${LACLAE_SALES_FILTER}
            GROUP BY TRIM(L.LCCDRF)
        ), ART_RANKED AS (
            SELECT
                TRIM(A.CODIGOARTICULO) AS CODIGOARTICULO,
                TRIM(A.DESCRIPCIONARTICULO) AS DESCRIPCIONARTICULO,
                TRIM(A.CODIGOMARCA) AS CODIGOMARCA,
                TRIM(A.CODIGOFAMILIA) AS CODIGOFAMILIA,
                TRIM(A.CODIGOEAN) AS CODIGOEAN,
                A.UNIDADESCAJA,
                A.UNIDADESFRACCION,
                A.UNIDADESRETRACTIL,
                TRIM(A.UNIDADMEDIDA) AS UNIDADMEDIDA,
                A.PESO,
                TRIM(COALESCE(NULLIF(TRIM(A.CODIGOIVA), ''), '2')) AS CODIGOIVA,
                TRIM(COALESCE(A.FORMATO, '')) AS FORMATO,
                COALESCE(A.PRODUCTOPESADOSN, '') AS PRODUCTOPESADOSN,
                COALESCE(PH.SALES_THIS_YEAR, 0) AS SALES_THIS_YEAR,
                COALESCE(PH.SALES_PREV_YEAR, 0) AS SALES_PREV_YEAR,
                COALESCE(PH.PURCHASE_COUNT, 0) AS PURCHASE_COUNT,
                ROW_NUMBER() OVER (
                    ORDER BY
                        CASE WHEN COALESCE(PH.PURCHASE_COUNT, 0) > 0 THEN 0 ELSE 1 END ASC,
                        COALESCE(PH.SALES_THIS_YEAR, 0) ASC,
                        COALESCE(PH.PURCHASE_COUNT, 0) DESC,
                        A.DESCRIPCIONARTICULO ASC,
                        TRIM(A.CODIGOARTICULO) ASC
                ) AS RN
            FROM DSEDAC.ART A
            LEFT JOIN PH ON TRIM(A.CODIGOARTICULO) = PH.CODIGOARTICULO
            ${where}
        ), ART_PAGE AS (
            SELECT *
              FROM ART_RANKED
             WHERE RN > ?
               AND RN <= ?
        ), CLIENT_TARIFF AS (
            SELECT COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFA
              FROM DSEDAC.CLC CLC
             WHERE TRIM(CLC.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
             FETCH FIRST 1 ROW ONLY
        ), STOCK AS (
            SELECT S.CODIGOARTICULO,
                SUM(S.ENVASESDISPONIBLES) AS ENVASES_DISP,
                SUM(S.UNIDADESDISPONIBLES) AS UNIDADES_DISP
            FROM DSEDAC.ARO S
            JOIN ART_PAGE P ON S.CODIGOARTICULO = P.CODIGOARTICULO
            WHERE S.CODIGOALMACEN = 1
            GROUP BY S.CODIGOARTICULO
        ), RESERVED AS (
            SELECT SR.CODIGOARTICULO,
                SUM(SR.CANTIDADENVASES) AS RES_ENV,
                SUM(SR.CANTIDADUNIDADES) AS RES_UNI
            FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE SR
            JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
            JOIN ART_PAGE P ON SR.CODIGOARTICULO = P.CODIGOARTICULO
            GROUP BY SR.CODIGOARTICULO
        ), LAST_COST AS (
            SELECT CA, PRECIOCOSTO
              FROM (
                SELECT TRIM(L.CODIGOARTICULO) AS CA,
                       L.PRECIOCOSTO,
                       ROW_NUMBER() OVER (
                         PARTITION BY TRIM(L.CODIGOARTICULO)
                         ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
                       ) AS RN
                  FROM DSEDAC.LAC L
                  JOIN ART_PAGE P ON TRIM(L.CODIGOARTICULO) = P.CODIGOARTICULO
                 WHERE L.PRECIOCOSTO > 0
              ) X
             WHERE RN = 1
        )
        SELECT
            A.CODIGOARTICULO AS code,
            A.DESCRIPCIONARTICULO AS name,
            A.CODIGOMARCA AS brand,
            A.CODIGOFAMILIA AS family,
            A.CODIGOEAN AS ean,
            A.UNIDADESCAJA AS unitsPerBox,
            A.UNIDADESFRACCION AS unitsFraction,
            A.UNIDADESRETRACTIL AS unitsRetractil,
            A.UNIDADMEDIDA AS unitMeasure,
            A.PESO AS weight,
            COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS stockEnvases,
            COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS stockUnidades,
            COALESCE(T1.PRECIOTARIFA, 0) AS precioTarifa1,
            COALESCE(T2.PRECIOTARIFA, 0) AS precioMinimo,
            COALESCE(CT.CODIGOTARIFA, 1) AS codigoTarifaCliente,
            COALESCE(TC.PRECIOTARIFA, 0) AS precioCliente,
            COALESCE(LC.PRECIOCOSTO, 0) AS precioCosto,
            A.CODIGOIVA AS codigoIva,
            A.FORMATO AS formato,
            A.PRODUCTOPESADOSN AS productoPesado,
            A.SALES_THIS_YEAR AS salesThisYear,
            A.SALES_PREV_YEAR AS salesPrevYear,
            CASE WHEN A.PURCHASE_COUNT > 0 THEN 1 ELSE 0 END AS hasPurchased
        FROM ART_PAGE A
        LEFT JOIN STOCK S ON A.CODIGOARTICULO = S.CODIGOARTICULO
        LEFT JOIN RESERVED RES ON A.CODIGOARTICULO = RES.CODIGOARTICULO
        LEFT JOIN DSEDAC.ARA T1 ON A.CODIGOARTICULO = T1.CODIGOARTICULO AND T1.CODIGOTARIFA = 1
        LEFT JOIN DSEDAC.ARA T2 ON A.CODIGOARTICULO = T2.CODIGOARTICULO AND T2.CODIGOTARIFA = 2
        LEFT JOIN CLIENT_TARIFF CT ON 1 = 1
        LEFT JOIN DSEDAC.ARA TC ON A.CODIGOARTICULO = TC.CODIGOARTICULO
            AND TC.CODIGOTARIFA = CT.CODIGOTARIFA
        LEFT JOIN LAST_COST LC ON A.CODIGOARTICULO = LC.CA
        ORDER BY A.RN ASC`;

    const finalParams = [...historyParams, ...params, offset, offset + limit, clientCodeTrimmed];

    const cacheKey = `pedidos:products_v2:${clientCodeTrimmed}:${search || ''}:${family || ''}:${marca || ''}:${prefamily || ''}:${offset}:${limit}`;

    try {
        const rows = await cachedQuery(
            (sql) => queryWithParams(sql, finalParams),
            sql,
            cacheKey,
            TTL.SHORT // 5 min
        );
        const products = rows.map(r => {
            const salesTY = parseFloat(r.SALESTHISYEAR) || 0;
            const salesPY = parseFloat(r.SALESPREVYEAR) || 0;
            const hasPurchased = parseInt(r.HASPURCHASED) || 0;

            // Determine unit type clarity for UI
            let unitType = 'unidad'; // default
            const unitsPerBox = parseFloat(r.UNITSPERBOX) || 0;
            const unitsFraction = parseFloat(r.UNITSFRACTION) || 0;
            if (unitsPerBox > 1 && unitsFraction > 0) {
                unitType = 'ambos'; // Cajas + unidades
            } else if (unitsPerBox > 1) {
                unitType = 'caja'; // Solo cajas
            }

            const product = {
                code: (r.CODE || '').trim(),
                name: (r.NAME || '').trim(),
                brand: (r.BRAND || '').trim(),
                family: (r.FAMILY || '').trim(),
                ean: (r.EAN || '').trim(),
                unitsPerBox: unitsPerBox,
                unitsFraction: unitsFraction,
                unitsRetractil: parseFloat(r.UNITSRETRACTIL) || 0,
                unitMeasure: (r.UNITMEASURE || '').trim(),
                weight: parseFloat(r.WEIGHT) || 0,
                stockEnvases: parseFloat(r.STOCKENVASES) || 0,
                stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
                precioTarifa1: parseFloat(r.PRECIOTARIFA1) || 0,
                precioMinimo: parseFloat(r.PRECIOMINIMO) || 0,
                codigoTarifaCliente: parseInt(r.CODIGOTARIFACLIENTE, 10) || 1,
                precioCliente: parseFloat(r.PRECIOCLIENTE) || 0,
                precioTarifaCliente: parseFloat(r.PRECIOCLIENTE) || 0,
                precioCosto: parseFloat(r.PRECIOCOSTO) || 0,
                ...resolveIvaFromCodigo((r.CODIGOIVA || '2').toString().trim()),
                formato: (r.FORMATO || '').trim(),
                productoPesado: (r.PRODUCTOPESADO || '').trim() === 'S',
                unitType: unitType,
                // Purchase analytics for ordering + badges
                salesThisYear: salesTY,
                salesPrevYear: salesPY,
                hasPurchased: hasPurchased === 1,
                yoyChange: salesPY > 0 ? ((salesTY - salesPY) / salesPY * 100) : (salesTY > 0 ? 100 : 0),
            };
            return product;
        });
        const pricedProducts = await applyConfiguredPricingToProducts(products, clientCodeTrimmed);
        const finalProducts = pricedProducts.map(product => applyProductPriceView(product, includeIva));
        await redisCache.set('route', resultCacheKey, finalProducts, TTL.SHORT);
        return finalProducts;
    } catch (error) {
        logger.error(`[PEDIDOS] getProducts error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// PRODUCT DETAIL (with Circuit Breaker protection)
// ============================================================================

async function getProductDetail(code, clientCode, options = {}) {
    const trimCode = truncate(code, 10);
    const trimClient = clientCode ? truncate(clientCode, 10) : undefined;
    const includeIva = parseBooleanFlag(options.includeIva);
    const cacheKey = `product:detail:${trimCode}:${trimClient || 'all'}`;

    const cached = await redisCache.get('route', cacheKey);
    if (cached) return applyProductPriceView(cached, includeIva);

    try {
        let result = await productsBreaker.execute(
            () => getProductDetailRaw(trimCode, trimClient),
            () => null
        );
        if (!result) {
            result = await getProductDetailRaw(trimCode, trimClient);
        }
        
        if (result) await redisCache.set('route', cacheKey, result, TTL.MEDIUM);
        return applyProductPriceView(result, includeIva);
    } catch (error) {
        logger.error(`[PEDIDOS] getProductDetail CB error: ${error.message}`);
        const result = await getProductDetailRaw(trimCode, trimClient);
        return applyProductPriceView(result, includeIva);
    }
}

async function getProductDetailRaw(code, clientCode) {
    // BUG corregido (verificado en runtime): esta funcion usaba `trimCode`,
    // variable que solo existe en getProductDetail(). El ReferenceError
    // resultante hacia fallar TODAS las llamadas y el circuit breaker
    // devolvia null silenciosamente ("Failed: trimCode is not defined").
    const trimCode = truncate(code, 10);
    const trimClient = clientCode ? truncate(clientCode, 10) : undefined;
    // Base product query expanded with ALL useful fields from ART + FAM description
    const baseSql = `
        SELECT TRIM(A.CODIGOARTICULO) AS code,
            TRIM(A.DESCRIPCIONARTICULO) AS name,
            TRIM(COALESCE(A.EXTENSIONDESCRIPCION, '')) AS nameExt,
            TRIM(A.CODIGOMARCA) AS brand,
            TRIM(A.CODIGOFAMILIA) AS family,
            TRIM(COALESCE(F.DESCRIPCIONFAMILIA, '')) AS familyName,
            TRIM(COALESCE(A.CODIGOEAN, '')) AS ean,
            A.UNIDADESCAJA AS unitsPerBox,
            A.UNIDADESFRACCION AS unitsFraction,
            A.UNIDADESRETRACTIL AS unitsRetractil,
            TRIM(A.UNIDADMEDIDA) AS unitMeasure,
            COALESCE(A.PESO, 0) AS weight,
            TRIM(COALESCE(A.CODIGOPREFAMILIA, '')) AS prefamilia,
            TRIM(COALESCE(A.CODIGOSUBFAMILIA, '')) AS subFamily,
            TRIM(COALESCE(A.CODIGOGRUPO, '')) AS grupoGeneral,
            TRIM(COALESCE(A.CODIGOTIPO, '')) AS tipoProducto,
            TRIM(COALESCE(A.CLASIFICACION, '')) AS claseArticulo,
            TRIM(COALESCE(A.CATEGORIAARTICULO, '')) AS categoria,
            TRIM(COALESCE(A.CODIGOGAMA, '')) AS gama,
            TRIM(COALESCE(A.CODIGOIVA, '0')) AS codigoIva,
            COALESCE(A.PESO, 0) AS pesoNeto,
            COALESCE(A.VOLUMEN, 0) AS volumen,
            TRIM(COALESCE(A.GRADOS, '')) AS grados,
            TRIM(COALESCE(A.CALIBRE, '')) AS calibre,
            TRIM(COALESCE(A.OBSERVACION1, '')) AS observacion1,
            TRIM(COALESCE(A.OBSERVACION2, '')) AS observacion2,
            TRIM(COALESCE(A.CODIGOPRESENTACION, '')) AS presentacion,
            TRIM(COALESCE(A.FORMATO, '')) AS formato,
            COALESCE(A.PRODUCTOPESADOSN, '') AS productoPesado,
            COALESCE(A.TRAZABLESN, '') AS trazable,
            COALESCE(A.UNIDADPALE, 0) AS unidadPale,
            COALESCE(A.UNIDADFILAPALE, 0) AS unidadFilaPale,
            A.DIAALTA AS diaAlta,
            A.MESALTA AS mesAlta,
            A.ANOALTA AS anoAlta,
            A.ANOBAJA AS anoBaja,
            A.MESBAJA AS mesBaja
        FROM DSEDAC.ART A
        LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA
        WHERE TRIM(A.CODIGOARTICULO) = CAST(? AS VARCHAR(10))`;

    // All tariffs
    const tariffSql = `
        SELECT T.CODIGOTARIFA,
            TRIM(TRF.DESCRIPCIONTARIFA) AS tarifaDesc,
            T.PRECIOTARIFA
        FROM DSEDAC.ARA T
        JOIN DSEDAC.TRF TRF ON T.CODIGOTARIFA = TRF.CODIGOTARIFA
        WHERE TRIM(T.CODIGOARTICULO) = CAST(? AS VARCHAR(10)) AND T.PRECIOTARIFA > 0`;

    // Stock by warehouse
    const stockSql = `
        SELECT ARO.CODIGOALMACEN,
            TRIM(ALM.DESCRIPCIONALMACEN) AS almacenDesc,
            SUM(ARO.ENVASESDISPONIBLES) AS envases,
            SUM(ARO.UNIDADESDISPONIBLES) AS unidades
        FROM DSEDAC.ARO
        JOIN DSEDAC.ALM ON ARO.CODIGOALMACEN = ALM.CODIGOALMACEN
        WHERE TRIM(ARO.CODIGOARTICULO) = CAST(? AS VARCHAR(10))
        GROUP BY ARO.CODIGOALMACEN, ALM.DESCRIPCIONALMACEN`;

    try {
        logger.info(`[PEDIDOS] getProductDetail code=${trimCode} clientCode=${clientCode || 'none'}`);
        const t0 = Date.now();

        const [baseRows, tariffRows, stockRows] = await Promise.all([
            queryWithParams(baseSql, [trimCode]),
            queryWithParams(tariffSql, [trimCode]),
            queryWithParams(stockSql, [trimCode]),
        ]);

        logger.info(`[PEDIDOS] getProductDetail base=${baseRows?.length || 0} tariffs=${tariffRows?.length || 0} stock=${stockRows?.length || 0} time=${Date.now() - t0}ms`);

        if (!baseRows || baseRows.length === 0) {
            throw new Error('Producto no encontrado');
        }

        const raw = baseRows[0];
        let product = {
            code: (raw.CODE || '').trim(),
            name: (raw.NAME || '').trim(),
            nameExt: (raw.NAMEEXT || '').trim(),
            brand: (raw.BRAND || '').trim(),
            family: (raw.FAMILY || '').trim(),
            familyName: (raw.FAMILYNAME || '').trim(),
            ean: (raw.EAN || '').trim(),
            unitsPerBox: parseFloat(raw.UNITSPERBOX) || 1,
            unitsFraction: parseFloat(raw.UNITSFRACTION) || 0,
            unitsRetractil: parseFloat(raw.UNITSRETRACTIL) || 0,
            unitMeasure: (raw.UNITMEASURE || '').trim(),
            weight: parseFloat(raw.WEIGHT) || 0,
            prefamilia: (raw.PREFAMILIA || '').trim(),
            subFamily: (raw.SUBFAMILY || '').trim(),
            grupoGeneral: (raw.GRUPOGENERAL || '').trim(),
            tipoProducto: (raw.TIPOPRODUCTO || '').trim(),
            claseArticulo: (raw.CLASEARTICULO || '').trim(),
            categoria: (raw.CATEGORIA || '').trim(),
            gama: (raw.GAMA || '').trim(),
            codigoIva: (raw.CODIGOIVA || '0').toString().trim(),
            ...resolveIvaFromCodigo((raw.CODIGOIVA || '0').toString().trim()),
            pesoNeto: parseFloat(raw.PESONETO) || 0,
            volumen: parseFloat(raw.VOLUMEN) || 0,
            grados: (raw.GRADOS || '').trim(),
            calibre: (raw.CALIBRE || '').trim(),
            observacion1: (raw.OBSERVACION1 || '').trim(),
            observacion2: (raw.OBSERVACION2 || '').trim(),
            presentacion: (raw.PRESENTACION || '').trim(),
            formato: (raw.FORMATO || '').trim(),
            productoPesado: (raw.PRODUCTOPESADO || '').trim() === 'S',
            trazable: (raw.TRAZABLE || '').trim() === 'S',
            unidadPale: parseFloat(raw.UNIDADPALE) || 0,
            unidadFilaPale: parseFloat(raw.UNIDADFILAPALE) || 0,
            fechaAlta: raw.ANOALTA > 0 ? `${String(raw.DIAALTA || 1).padStart(2, '0')}/${String(raw.MESALTA || 1).padStart(2, '0')}/${raw.ANOALTA}` : null,
            anoBaja: parseInt(raw.ANOBAJA) || 0,
            mesBaja: parseInt(raw.MESBAJA) || 0,
        };

        product.tariffs = (tariffRows || []).map(t => {
            const price = parseFloat(t.PRECIOTARIFA) || 0;
            return {
                code: t.CODIGOTARIFA,
                description: (t.TARIFADESC || '').trim(),
                price,
                precioUnitario: product.unitsPerBox > 1
                    ? +(price / product.unitsPerBox).toFixed(4)
                    : price,
            };
        });

        product.stock = (stockRows || []).map(s => ({
            almacen: s.CODIGOALMACEN,
            almacenDesc: (s.ALMACENDESC || '').trim(),
            envases: parseFloat(s.ENVASES) || 0,
            unidades: parseFloat(s.UNIDADES) || 0,
        }));

        // Expose stockEnvases/stockUnidades at root level (almacen 1 = default)
        const mainStock = stockRows?.find(s => parseInt(s.CODIGOALMACEN) === 1);
        product.stockEnvases = mainStock ? (parseFloat(mainStock.ENVASES) || 0) : 0;
        product.stockUnidades = mainStock ? (parseFloat(mainStock.UNIDADES) || 0) : 0;

        // Stage: client historical price
        if (trimClient) {
            const h0 = Date.now();
            logger.info(`[PEDIDOS] getProductDetail stage=HISTORICO code=${trimCode} client=${trimClient}`);
            try {
                const clientPriceSql = `
                    SELECT L.PRECIOVENTA AS PRECIOCLIENTE
                    FROM DSEDAC.LINDTO L
                    WHERE TRIM(L.CODIGOARTICULO) = CAST(? AS VARCHAR(10))
                      AND TRIM(L.CODIGOCLIENTEALBARAN) = CAST(? AS VARCHAR(10))
                      AND L.TIPOVENTA IN ('CC', 'VC')
                      AND L.CLASELINEA IN ('AB', 'VT')
                      AND L.SERIEALBARAN NOT IN ('N', 'Z')
                    ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
                    FETCH FIRST 1 ROW ONLY`;
                const priceRows = await queryWithParams(clientPriceSql, [trimCode, trimClient]);
                logger.info(`[PEDIDOS] getProductDetail stage=HISTORICO rows=${priceRows?.length || 0} time=${Date.now() - h0}ms`);
                
                product.precioCliente = priceRows && priceRows.length > 0
                    ? parseFloat(priceRows[0].PRECIOCLIENTE) || 0
                    : null;
            } catch (histErr) {
                logger.warn(`[PEDIDOS] getProductDetail stage=HISTORICO error: ${histErr.message}`);
                product.precioCliente = null;
            }
        }

        // Stage: client tariff price (with fallback to tariff 1)
        const ct0 = Date.now();
        logger.info(`[PEDIDOS] getProductDetail stage=TARIFA_CLIENTE code=${trimCode} client=${trimClient || 'none'}`);
        let clientTarifaCode = 1;
        try {
            if (trimClient) {
                const cliTarifaSql = `
                    SELECT COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFA
                    FROM DSEDAC.CLC
                    WHERE TRIM(CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
                    FETCH FIRST 1 ROW ONLY`;
                const cliRows = await queryWithParams(cliTarifaSql, [trimClient]);
                clientTarifaCode = cliRows && cliRows.length > 0
                    ? parseInt(cliRows[0].CODIGOTARIFA) || 1
                    : 1;
                logger.info(`[PEDIDOS] getProductDetail stage=TARIFA_CLIENTE found tariff=${clientTarifaCode} time=${Date.now() - ct0}ms`);
            }
        } catch (tarifaErr) {
            logger.warn(`[PEDIDOS] getProductDetail stage=TARIFA_CLIENTE fallback to 1: ${tarifaErr.message}`);
            clientTarifaCode = 1;
        }
        
        product.codigoTarifaCliente = clientTarifaCode;
        const foundTariff = product.tariffs.find(t => t.code === clientTarifaCode);
        product.precioTarifaCliente = foundTariff ? foundTariff.price : (product.tariffs.find(t => t.code === 1)?.price ?? 0);
        
        if (!foundTariff) {
            logger.warn(`[PEDIDOS] getProductDetail stage=TARIFA_CLIENTE code=${trimCode} tariff=${clientTarifaCode} NOT FOUND, used fallback tariff=1 price=${product.precioTarifaCliente}`);
        }

        product = await applyConfiguredPricingToProduct(product, trimClient);

        logger.info(`[PEDIDOS] getProductDetail complete code=${trimCode} time=${Date.now() - t0}ms`);
        return product;
    } catch (error) {
        logger.error(`[PEDIDOS] getProductDetail error: ${error.message} code=${trimCode}`);
        throw error;
    }
}

// ============================================================================
// STOCK
// ============================================================================

async function getStock(code, almacen = 1, options = {}) {
    // Real stock minus confirmed reservations and live draft reservations.
    const excludedPedidoId = parseInt(options.excludePedidoId);
    const excludeCurrentPedidoSql = Number.isInteger(excludedPedidoId) && excludedPedidoId > 0
        ? 'AND SR.PEDIDO_ID <> ?'
        : '';
    const sql = `
        SELECT
            COALESCE(S.ENVASES, 0) - COALESCE(R.RES_ENVASES, 0) AS envases,
            COALESCE(S.UNIDADES, 0) - COALESCE(R.RES_UNIDADES, 0) AS unidades
        FROM (
            SELECT SUM(ENVASESDISPONIBLES) AS ENVASES,
                   SUM(UNIDADESDISPONIBLES) AS UNIDADES
            FROM DSEDAC.ARO
            WHERE TRIM(CODIGOARTICULO) = ? AND CODIGOALMACEN = ?
        ) S,
        (
            SELECT COALESCE(SUM(SR.CANTIDADENVASES), 0) AS RES_ENVASES,
                   COALESCE(SUM(SR.CANTIDADUNIDADES), 0) AS RES_UNIDADES
            FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE SR
            JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID
            WHERE TRIM(SR.CODIGOARTICULO) = ?
              AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
              ${excludeCurrentPedidoSql}
        ) R`;

    const trimCode = code.trim();
    const params = Number.isInteger(excludedPedidoId) && excludedPedidoId > 0
        ? [trimCode, almacen, trimCode, excludedPedidoId]
        : [trimCode, almacen, trimCode];
    const cacheKey = Number.isInteger(excludedPedidoId) && excludedPedidoId > 0
        ? `pedidos:stock:${trimCode}:${almacen}:exclude:${excludedPedidoId}`
        : `pedidos:stock:${trimCode}:${almacen}`;

    try {
        const rows = await cachedQuery(
            (sql) => queryWithParams(sql, params),
            sql,
            cacheKey,
            30 // 30s TTL - more frequent for real-time stock
        );
        const row = rows && rows[0];
        return {
            envases: Math.max(0, parseFloat(row?.ENVASES) || 0),
            unidades: Math.max(0, parseFloat(row?.UNIDADES) || 0),
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getStock error: ${error.message}`);
        throw error;
    }
}

async function getStockBatch(codes, almacen = 1, options = {}) {
    const uniqueCodes = [...new Set((codes || []).map(code => truncate(code, 10)).filter(Boolean))];
    const stockByCode = new Map(uniqueCodes.map(code => [code, { envases: 0, unidades: 0 }]));
    if (uniqueCodes.length === 0) return stockByCode;
    const excludedPedidoId = parseInt(options.excludePedidoId);
    const excludeCurrentPedidoSql = Number.isInteger(excludedPedidoId) && excludedPedidoId > 0
        ? 'AND SR.PEDIDO_ID <> ?'
        : '';

    const CHUNK_SIZE = 50;
    for (let i = 0; i < uniqueCodes.length; i += CHUNK_SIZE) {
        const chunk = uniqueCodes.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => 'CAST(? AS VARCHAR(10))').join(',');
        const sql = `
            SELECT S.CODE AS CODE,
                   COALESCE(S.ENVASES, 0) - COALESCE(R.RES_ENVASES, 0) AS ENVASES,
                   COALESCE(S.UNIDADES, 0) - COALESCE(R.RES_UNIDADES, 0) AS UNIDADES
              FROM (
                    SELECT TRIM(CODIGOARTICULO) AS CODE,
                           SUM(ENVASESDISPONIBLES) AS ENVASES,
                           SUM(UNIDADESDISPONIBLES) AS UNIDADES
                      FROM DSEDAC.ARO
                     WHERE CODIGOALMACEN = ?
                       AND TRIM(CODIGOARTICULO) IN (${placeholders})
                     GROUP BY TRIM(CODIGOARTICULO)
              ) S
              LEFT JOIN (
                    SELECT TRIM(SR.CODIGOARTICULO) AS CODE,
                           COALESCE(SUM(SR.CANTIDADENVASES), 0) AS RES_ENVASES,
                           COALESCE(SUM(SR.CANTIDADUNIDADES), 0) AS RES_UNIDADES
                     FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE SR
                      JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID
                     WHERE ${ACTIVE_STOCK_RESERVATION_CONDITION}
                       AND TRIM(SR.CODIGOARTICULO) IN (${placeholders})
                       ${excludeCurrentPedidoSql}
                     GROUP BY TRIM(SR.CODIGOARTICULO)
              ) R ON S.CODE = R.CODE`;
        const params = Number.isInteger(excludedPedidoId) && excludedPedidoId > 0
            ? [almacen, ...chunk, ...chunk, excludedPedidoId]
            : [almacen, ...chunk, ...chunk];
        const rows = await queryWithParams(sql, params, false);
        for (const row of rows || []) {
            const code = trimString(row.CODE);
            if (!code) continue;
            stockByCode.set(code, {
                envases: Math.max(0, parseFloat(row.ENVASES) || 0),
                unidades: Math.max(0, parseFloat(row.UNIDADES) || 0),
            });
        }
    }

    return stockByCode;
}

// ============================================================================
// ORDER SEQUENCE
// ============================================================================

async function tryAtomicNextOrderNumber(ejercicio) {
    if (atomicSequenceUpdateSupported === false) return null;

    try {
        const rows = await queryWithParams(
            `SELECT ULTIMO_NUMERO FROM FINAL TABLE (
                UPDATE ${ERP_SCHEMA}.PEDIDOS_SEQ
                   SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1
                 WHERE EJERCICIO = ?
            )`,
            [ejercicio], false, false
        );
        atomicSequenceUpdateSupported = true;
        return rows?.[0]?.ULTIMO_NUMERO ? integerValue(rows[0].ULTIMO_NUMERO) : null;
    } catch (err) {
        if (!isUnsupportedAtomicSequenceUpdate(err)) throw err;
        atomicSequenceUpdateSupported = false;
        logger.warn(`[PEDIDOS] SEQ atomic UPDATE unsupported, using serialized fallback: ${err.message}`);
        return null;
    }
}

async function updateAndReadNextOrderNumber(ejercicio) {
    await queryWithParams(
        `UPDATE ${ERP_SCHEMA}.PEDIDOS_SEQ SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1 WHERE EJERCICIO = ?`,
        [ejercicio], false
    );
    const rows = await queryWithParams(
        `SELECT ULTIMO_NUMERO FROM ${ERP_SCHEMA}.PEDIDOS_SEQ WHERE EJERCICIO = ?`,
        [ejercicio], false
    );
    return rows?.[0]?.ULTIMO_NUMERO ? integerValue(rows[0].ULTIMO_NUMERO) : null;
}

async function getNextOrderNumber(ejercicio) {
    return withOrderSequenceLock(async () => {
        const atomicValue = await tryAtomicNextOrderNumber(ejercicio);
        if (atomicValue) return atomicValue;

        const fallbackValue = await updateAndReadNextOrderNumber(ejercicio);
        if (fallbackValue) return fallbackValue;

        try {
            await queryWithParams(
                `INSERT INTO ${ERP_SCHEMA}.PEDIDOS_SEQ (EJERCICIO, ULTIMO_NUMERO) VALUES (?, 1)`,
                [ejercicio], false
            );
            return 1;
        } catch (insErr) {
            if (!isDuplicateKeyError(insErr)) throw insErr;
            logger.warn(`[PEDIDOS] SEQ INSERT race: ${insErr.message}`);
            const retryAtomicValue = await tryAtomicNextOrderNumber(ejercicio);
            if (retryAtomicValue) return retryAtomicValue;
            const retryFallbackValue = await updateAndReadNextOrderNumber(ejercicio);
            return retryFallbackValue || 1;
        }
    });
}

// ============================================================================
// CREATE ORDER
// ============================================================================

function buildLocalPedidoCabInsert({
    ejercicio,
    numeroPedido,
    dia,
    mes,
    ano,
    hora,
    clientCode,
    clientName,
    vendedorCode,
    formaPago,
    tarifa,
    almacen,
    tipoventa,
    observaciones,
    descuentoGlobal,
    origen,
    userId,
}) {
    const target = getPedidosConfirmationTarget();
    const terminal = resolvePedidoTerminal(vendedorCode, userId);
    const actor = resolvePedidoActorCodes({ CODIGOVENDEDOR: vendedorCode }, userId);
    const cliente = (clientCode || '').trim().substring(0, 10);
    const obs = (observaciones || '').substring(0, 200);
    const obsParts = splitFixedText(obs, 50, 2);
    const columns = [
        'SUBEMPRESA', 'EJERCICIO', 'NUMEROPEDIDO', 'SERIEPEDIDO', 'TERMINAL',
        'DIADOCUMENTO', 'MESDOCUMENTO', 'ANODOCUMENTO', 'HORADOCUMENTO',
        'CODIGOCLIENTE', 'NOMBRECLIENTE', 'CODIGOVENDEDOR', 'CODIGOFORMAPAGO',
        'CODIGOTARIFA', 'CODIGOALMACEN', 'TIPOVENTA', 'OBSERVACIONES',
        'DESCUENTO_GLOBAL', 'ORIGEN',
        'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'TERMINALPEDIDO',
        'CODIGOCLIENTEALBARAN', 'CODIGOCLIENTEFACTURA', 'CODIGOCLIENTECADENA',
        'CODIGOVENDEDORCOBRO', 'CODIGOPROMOTORPREVENTA', 'CODIGOCOMERCIAL',
        'RECARGOSN', 'IMPORTEBASEIMPONIBLEBRUTA1', 'IMPORTEBASEIMPONIBLE1',
        'IMPORTEBRUTO', 'SITUACIONPEDIDO', 'CODIGOOPERACION',
        'OBSERVACION1', 'OBSERVACION2', 'DIACREACION', 'MESCREACION',
        'ANOCREACION', 'HORACREACION', 'CODIGOVENDEDORUSUARIO',
        'CODIGOUSUARIO', 'CODIGOTIPOPEDIDO',
    ];
    const params = [
        target.subempresa, ejercicio, numeroPedido, target.serie, terminal,
        dia, mes, ano, hora,
        cliente, (clientName || '').substring(0, 60), actor.vendedor, formaPago,
        tarifa, almacen, tipoventa, obs,
        parseFloat(descuentoGlobal) || 0, origen,
        target.subempresa, ejercicio, terminal,
        cliente, cliente, '',
        actor.vendedorCobro, actor.promotor, actor.comercial,
        'N', 0, 0,
        0, target.situacionPedido, target.codigoOperacion,
        obsParts[0], obsParts[1], dia, mes,
        ano, hora, actor.vendedorUsuario,
        actor.codigoUsuario || target.codigoUsuario, target.codigoTipoPedido,
    ];

    return {
        sql: db2InsertSql(`${ERP_SCHEMA}.PEDIDOS_CAB`, columns),
        params,
    };
}

function buildLegacyPedidoCabInsert({
    ejercicio,
    numeroPedido,
    dia,
    mes,
    ano,
    hora,
    clientCode,
    clientName,
    vendedorCode,
    formaPago,
    tarifa,
    almacen,
    tipoventa,
    observaciones,
    descuentoGlobal,
    origen,
    includeOrigen = true,
}) {
    const vendedor = (vendedorCode || '').split(',')[0].trim().substring(0, 2);
    const columns = [
        'EJERCICIO', 'NUMEROPEDIDO', 'DIADOCUMENTO', 'MESDOCUMENTO',
        'ANODOCUMENTO', 'HORADOCUMENTO', 'CODIGOCLIENTE', 'NOMBRECLIENTE',
        'CODIGOVENDEDOR', 'CODIGOFORMAPAGO', 'CODIGOTARIFA', 'CODIGOALMACEN',
        'TIPOVENTA', 'OBSERVACIONES',
    ];
    const params = [
        ejercicio, numeroPedido, dia, mes, ano, hora,
        clientCode.trim(), (clientName || '').substring(0, 60), vendedor,
        formaPago, tarifa, almacen, tipoventa, (observaciones || '').substring(0, 200),
    ];
    if (includeOrigen) {
        columns.push('DESCUENTO_GLOBAL', 'ORIGEN');
        params.push(parseFloat(descuentoGlobal) || 0, origen);
    }

    return {
        sql: db2InsertSql(`${ERP_SCHEMA}.PEDIDOS_CAB`, columns),
        params,
    };
}

function buildLocalPedidoLineInsert({
    pedidoId,
    sequence,
    ejercicio,
    numeroPedido,
    dia,
    mes,
    ano,
    hora,
    clientCode,
    vendedorCode,
    formaPago,
    tarifa,
    almacen,
    tipoventa,
    line,
    amounts,
    terminal,
    userId,
}) {
    const target = getPedidosConfirmationTarget();
    const actor = resolvePedidoActorCodes({ CODIGOVENDEDOR: vendedorCode }, userId);
    const effectiveTerminal = integerValue(terminal) || resolvePedidoTerminal(vendedorCode, userId);
    const cliente = (clientCode || '').trim().substring(0, 10);
    const iva = resolveIvaFromLine(line);
    const columns = [
        'PEDIDO_ID', 'SECUENCIA', 'CODIGOARTICULO', 'DESCRIPCION',
        'CANTIDADENVASES', 'CANTIDADUNIDADES', 'UNIDADMEDIDA', 'UNIDADESCAJA',
        'PRECIOVENTA', 'PRECIOCOSTO', 'PRECIOTARIFA', 'PRECIOTARIFACLIENTE',
        'PRECIOMINIMO', 'IMPORTEVENTA', 'IMPORTECOSTO', 'IMPORTEMARGEN',
        'PORCENTAJEMARGEN', 'DESCUENTO_LINEA', 'TIPOLINEA', 'TIPOVENTA',
        'CLASELINEA', 'ORDEN', 'CODIGOIVA',
        'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO',
        'NUMEROPEDIDO', 'SECUENCIAPEDIDO', 'DIADOCUMENTO', 'MESDOCUMENTO',
        'ANODOCUMENTO', 'HORADOCUMENTO', 'CODIGOCLIENTEALBARAN',
        'CODIGOCLIENTEFACTURA', 'CODIGOCLIENTECADENA', 'CODIGOVENDEDOR',
        'CODIGOVENDEDORCOBRO', 'CODIGOPROMOTORPREVENTA', 'CODIGOCOMERCIAL',
        'CODIGOFORMAPAGO', 'CODIGOTARIFA', 'CODIGOALMACEN', 'RECARGOSN',
        'CAJASUNIDADES', 'PRECIOTARIFA01', 'CODIGOESTADO',
    ];
    const params = [
        pedidoId, sequence,
        (line.codigoArticulo || '').trim(), (line.descripcion || '').substring(0, 40),
        amounts.cantidadEnvases, amounts.cantidadUnidades,
        amounts.unidadMedida, amounts.unidadesCaja,
        amounts.precio, parseFloat(line.precioCosto) || 0,
        parseFloat(line.precioTarifa) || 0, parseFloat(line.precioTarifaCliente) || 0,
        parseFloat(line.precioMinimo) || 0,
        amounts.importeVenta, amounts.importeCosto, amounts.importeMargen,
        Math.round(amounts.pctMargen * 100) / 100,
        amounts.descuentoLinea,
        line.tipoLinea || 'R', line.tipoventa || tipoventa, line.claseLinea || 'VT', sequence, iva.codigoIva,
        target.subempresa, ejercicio, target.serie, effectiveTerminal,
        numeroPedido, sequence, dia, mes,
        ano, hora, cliente,
        cliente, '', actor.vendedor,
        actor.vendedorCobro, actor.promotor, actor.comercial,
        formaPago, tarifa, almacen, 'N',
        cajaUnidadFlag(amounts.unidadMedida), parseFloat(line.precioTarifa) || 0, '',
    ];

    return {
        table: `${ERP_SCHEMA}.PEDIDOS_LIN`,
        columns,
        sql: db2InsertSql(`${ERP_SCHEMA}.PEDIDOS_LIN`, columns),
        params,
    };
}

function buildLegacyPedidoLineInsert({
    pedidoId,
    sequence,
    tipoventa,
    line,
    amounts,
}) {
    const iva = resolveIvaFromLine(line);
    const columns = [
        'PEDIDO_ID', 'SECUENCIA', 'CODIGOARTICULO', 'DESCRIPCION',
        'CANTIDADENVASES', 'CANTIDADUNIDADES', 'UNIDADMEDIDA', 'UNIDADESCAJA',
        'PRECIOVENTA', 'PRECIOCOSTO', 'PRECIOTARIFA', 'PRECIOTARIFACLIENTE',
        'PRECIOMINIMO', 'IMPORTEVENTA', 'IMPORTECOSTO', 'IMPORTEMARGEN',
        'PORCENTAJEMARGEN', 'DESCUENTO_LINEA', 'TIPOLINEA', 'TIPOVENTA',
        'CLASELINEA', 'ORDEN', 'CODIGOIVA',
    ];
    const params = [
        pedidoId, sequence,
        (line.codigoArticulo || '').trim(), (line.descripcion || '').substring(0, 40),
        amounts.cantidadEnvases, amounts.cantidadUnidades,
        amounts.unidadMedida, amounts.unidadesCaja,
        amounts.precio, parseFloat(line.precioCosto) || 0,
        parseFloat(line.precioTarifa) || 0, parseFloat(line.precioTarifaCliente) || 0,
        parseFloat(line.precioMinimo) || 0,
        amounts.importeVenta, amounts.importeCosto, amounts.importeMargen,
        Math.round(amounts.pctMargen * 100) / 100,
        amounts.descuentoLinea,
        line.tipoLinea || 'R', line.tipoventa || tipoventa, line.claseLinea || 'VT', sequence, iva.codigoIva,
    ];

    return {
        table: `${ERP_SCHEMA}.PEDIDOS_LIN`,
        columns,
        sql: db2InsertSql(`${ERP_SCHEMA}.PEDIDOS_LIN`, columns),
        params,
    };
}

async function getClientTariffsForLines(clientCode, lines) {
    const articleCodes = [...new Set((lines || [])
        .map(line => truncate(line.codigoArticulo || line.CODIGOARTICULO, 10))
        .filter(Boolean))];
    const tariffsByCode = new Map();
    if (articleCodes.length === 0) return tariffsByCode;

    const placeholders = articleCodes.map(() => '?').join(',');
    const sql = `
        SELECT TRIM(ARA.CODIGOARTICULO) AS CODIGOARTICULO,
               ARA.PRECIOTARIFA
          FROM DSEDAC.CLC CLC
          JOIN DSEDAC.ARA ARA ON ARA.CODIGOTARIFA = COALESCE(CLC.CODIGOTARIFA, 1)
         WHERE TRIM(CLC.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
           AND TRIM(ARA.CODIGOARTICULO) IN (${placeholders})`;

    try {
        const rows = await queryWithParams(sql, [truncate(clientCode, 10), ...articleCodes], false);
        for (const row of rows || []) {
            const code = truncate(row.CODIGOARTICULO, 10);
            if (code) tariffsByCode.set(code, parseFloat(row.PRECIOTARIFA) || 0);
        }
    } catch (error) {
        logger.warn(`[PEDIDOS] Client tariff prefetch skipped: ${error.message}`);
    }
    return tariffsByCode;
}

async function getArticleIvaCodesForLines(lines) {
    const articleCodes = [...new Set((lines || [])
        .map(line => truncate(line.codigoArticulo || line.CODIGOARTICULO, 10))
        .filter(Boolean))];
    const ivaByCode = new Map();
    if (articleCodes.length === 0) return ivaByCode;

    const placeholders = articleCodes.map(() => '?').join(',');
    const sql = `
        SELECT TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
               TRIM(COALESCE(NULLIF(TRIM(CODIGOIVA), ''), '2')) AS CODIGOIVA
          FROM DSEDAC.ART
         WHERE TRIM(CODIGOARTICULO) IN (${placeholders})`;

    try {
        const rows = await queryWithParams(sql, articleCodes, false);
        for (const row of rows || []) {
            const code = truncate(row.CODIGOARTICULO, 10);
            if (code) ivaByCode.set(code, trimString(row.CODIGOIVA) || '2');
        }
    } catch (error) {
        logger.warn(`[PEDIDOS] Article IVA prefetch skipped: ${error.message}`);
    }
    return ivaByCode;
}

async function createOrder({
    clientCode,
    clientName,
    vendedorCode,
    tipoventa = 'CC',
    almacen = 1,
    tarifa,
    formaPago,
    observaciones = '',
    descuentoGlobal = 0,
    lines = [],
    origen = 'A',
    idempotencyKey,
    clientRequestId,
    userId,
}) {
    const serviceT0 = Date.now();
    const lineCount = Array.isArray(lines) ? lines.length : 0;

    if (!clientCode || !vendedorCode) {
        throw new Error('clientCode and vendedorCode are required');
    }
    if (!lines || lines.length === 0) {
        throw new Error('At least one line is required');
    }
    if (lines.length > MAX_ORDER_LINES) {
        throw new Error(`Un pedido no puede tener mas de ${MAX_ORDER_LINES} lineas`);
    }

    const effectiveClientCode = truncate(clientCode, 10);
    const effectiveActorCodes = resolvePedidoActorCodes({ CODIGOVENDEDOR: vendedorCode }, userId);
    const effectiveVendedorCode = effectiveActorCodes.vendedor;
    const effectiveSaleType = normalizePedidoSaleType(tipoventa);
    if (!effectiveClientCode || !effectiveVendedorCode) {
        throw new Error('clientCode and vendedorCode are required');
    }

    const clientDefaults = await getClientOrderDefaults(effectiveClientCode);
    const effectiveClientName = trimString(clientName) || clientDefaults.clientName || '';
    const effectiveFormaPago = truncate(trimString(formaPago) || clientDefaults.formaPago || '02', 2);
    const effectiveTarifa = integerValue(tarifa) || clientDefaults.tarifa || 1;
    const effectiveAlmacen = integerValue(almacen) || 1;

    const normalizedIdempotencyKey = idempotencyKey
        ? normalizePedidoIdempotencyKey(idempotencyKey)
        : (clientRequestId
            ? normalizePedidoIdempotencyKey(clientRequestId)
            : generatePedidoIdempotencyKey());

    const idempotencyT0 = Date.now();
    const idempotencyState = await resolveIdempotentCreateOrder({
        idempotencyKey: normalizedIdempotencyKey,
        clientCode: effectiveClientCode,
        vendedorCode: effectiveVendedorCode,
        tipoventa: effectiveSaleType,
        observaciones,
        descuentoGlobal,
        lines,
    });
    logger.info(`[PEDIDOS] createOrder stage=idempotency_lookup lineCount=${lineCount} durationMs=${Date.now() - idempotencyT0}`);
    if (idempotencyState?.replay) {
        const replayPedidoId = idempotencyState.replay?.header?.id ?? null;
        logger.info(`[PEDIDOS] createOrder stage=getOrderDetail pedidoId=${replayPedidoId ?? 'n/a'} lineCount=${lineCount} durationMs=0 statusPath=idempotent_replay`);
        logger.info(`[PEDIDOS] createOrder stage=stock_validation lineCount=${lineCount} durationMs=0 stock_ms=0 stock=not_applicable statusPath=not_applicable`);
        logger.info(`[PEDIDOS] createOrder stage=service_total pedidoId=${replayPedidoId ?? 'n/a'} lineCount=${lineCount} statusPath=idempotent_replay totalMs=${Date.now() - serviceT0}`);
        return idempotencyState.replay;
    }

    const now = new Date();
    const ejercicio = now.getFullYear();
    const dia = now.getDate();
    const mes = now.getMonth() + 1;
    const ano = now.getFullYear();
    const hora = parseInt(`${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`, 10);

    const nextOrderT0 = Date.now();
    const numeroPedido = await getNextOrderNumber(ejercicio);
    const terminal = resolvePedidoTerminal(effectiveVendedorCode, userId);
    logger.info(`[PEDIDOS] createOrder stage=getNextOrderNumber lineCount=${lineCount} durationMs=${Date.now() - nextOrderT0}`);

    // Insert header; ORIGEN column may not exist in older installs
    const headerT0 = Date.now();
    let cabSql, cabParams;
    try {
        ({ sql: cabSql, params: cabParams } = buildLocalPedidoCabInsert({
            ejercicio,
            numeroPedido,
            dia,
            mes,
            ano,
            hora,
            clientCode: effectiveClientCode,
            clientName: effectiveClientName,
            vendedorCode: effectiveVendedorCode,
            formaPago: effectiveFormaPago,
            tarifa: effectiveTarifa,
            almacen: effectiveAlmacen,
            tipoventa: effectiveSaleType,
            observaciones,
            descuentoGlobal,
            origen,
            userId,
        }));
        await queryWithParams(cabSql, cabParams, false);
    } catch (cabErr) {
        // If column not found (42S22), retry without ORIGEN
        if (isColumnNotFound(cabErr)) {
            logger.warn(`[PEDIDOS] ERP-compatible columns missing in ${ERP_SCHEMA}.PEDIDOS_CAB, using legacy insert`);
            ({ sql: cabSql, params: cabParams } = buildLegacyPedidoCabInsert({
                ejercicio,
                numeroPedido,
                dia,
                mes,
                ano,
                hora,
                clientCode: effectiveClientCode,
                clientName: effectiveClientName,
                vendedorCode: effectiveVendedorCode,
                formaPago: effectiveFormaPago,
                tarifa: effectiveTarifa,
                almacen: effectiveAlmacen,
                tipoventa: effectiveSaleType,
                observaciones,
                descuentoGlobal,
                origen,
                includeOrigen: true,
            }));
            await queryWithParams(cabSql, cabParams, false);
        } else {
            throw cabErr;
        }
    }
    logger.info(`[PEDIDOS] createOrder stage=header_insert lineCount=${lineCount} durationMs=${Date.now() - headerT0}`);

    // Retrieve the generated ID
    const idLookupT0 = Date.now();
    const idRows = await queryWithParams(
        `SELECT ID FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE EJERCICIO = ? AND NUMEROPEDIDO = ? ORDER BY ID DESC FETCH FIRST 1 ROW ONLY`,
        [ejercicio, numeroPedido]
    );
    const pedidoId = idRows[0]?.ID;
    logger.info(`[PEDIDOS] createOrder stage=id_lookup pedidoId=${pedidoId ?? 'n/a'} lineCount=${lineCount} durationMs=${Date.now() - idLookupT0}`);
    if (!pedidoId) throw new Error('Failed to retrieve created order ID');

    const tariffT0 = Date.now();
    const [clientTariffs, articleIvaCodes] = await Promise.all([
        getClientTariffsForLines(effectiveClientCode, lines),
        getArticleIvaCodesForLines(lines),
    ]);
    logger.info(`[PEDIDOS] createOrder stage=line_defaults_prefetch pedidoId=${pedidoId} lineCount=${lineCount} durationMs=${Date.now() - tariffT0}`);
    const lineContexts = lines.map((ln, index) => {
        const articleCode = truncate(ln.codigoArticulo || ln.CODIGOARTICULO, 10);
        const clientTariff = clientTariffs.get(articleCode) || 0;
        const productIvaCode = articleIvaCodes.get(articleCode);
        const iva = productIvaCode
            ? resolveIvaFromCodigo(productIvaCode)
            : resolveIvaFromLine(ln);
        const line = clientTariff > 0
            ? {
                ...ln,
                precioTarifa: ln.precioTarifa ?? clientTariff,
                precioTarifaCliente: ln.precioTarifaCliente ?? clientTariff,
                codigoIva: iva.codigoIva,
                ivaRate: iva.ivaRate,
            }
            : {
                ...ln,
                codigoIva: iva.codigoIva,
                ivaRate: iva.ivaRate,
            };
        let cantidadEnvases = parseFloat(line.cantidadEnvases) || 0;
        let cantidadUnidades = parseFloat(line.cantidadUnidades) || parseFloat(line.cantidad) || 0;
        let unidadesCaja = parseFloat(line.unidadesCaja) || 1;
        let unidadMedida = line.unidadMedida || 'CAJAS';
        const descuentoLinea = Math.min(100, Math.max(0, parseFloat(line.descuentoLinea) || 0));
        const precioBase = parseFloat(line.precio) || parseFloat(line.precioVenta) || 0;
        let precio = descuentoLinea > 0 ? Math.round(precioBase * (1 - descuentoLinea / 100) * 10000) / 10000 : precioBase;

        const importeVenta = calculateLineImporte({
            unidadMedida,
            cantidadEnvases,
            cantidadUnidades,
            unidadesCaja,
            precioVenta: precio
        });
        const billingQty = isBoxUnidadMedida(unidadMedida) ? cantidadEnvases : cantidadUnidades;
        const importeCosto = parseFloat(line.importeCosto) || Math.round((billingQty * (parseFloat(line.precioCosto) || 0)) * 100) / 100;
        const importeMargen = importeVenta - importeCosto;
        const pctMargen = importeVenta > 0 ? ((importeMargen / importeVenta) * 100) : 0;

        return {
            line,
            sequence: index + 1,
            amounts: {
                cantidadEnvases,
                cantidadUnidades,
                unidadesCaja,
                unidadMedida,
                precio,
                importeVenta,
                importeCosto,
                importeMargen,
                pctMargen,
                descuentoLinea,
            },
        };
    });

    // Insert lines with compensation pattern: if any line fails, delete the header
    const lineInsertT0 = Date.now();
    try {
        const lineInserts = lineContexts.map(({ line, amounts, sequence }) => buildLocalPedidoLineInsert({
            pedidoId,
            sequence,
            ejercicio,
            numeroPedido,
            dia,
            mes,
            ano,
            hora,
            clientCode: effectiveClientCode,
            vendedorCode: effectiveVendedorCode,
            formaPago: effectiveFormaPago,
            tarifa: effectiveTarifa,
            almacen: effectiveAlmacen,
            tipoventa: effectiveSaleType,
            line,
            amounts,
            terminal,
            userId,
        }));

        try {
            await executeBulkInsert((sql, params) => queryWithParams(sql, params, false), lineInserts, {
                chunkSize: DB2_BULK_INSERT_CHUNK_SIZE,
                label: `${ERP_SCHEMA}.PEDIDOS_LIN`,
            });
        } catch (lineInsertErr) {
            if (!isColumnNotFound(lineInsertErr)) throw lineInsertErr;
            logger.warn(`[PEDIDOS] ERP-compatible columns missing in ${ERP_SCHEMA}.PEDIDOS_LIN, using legacy line bulk insert`);
            const legacyLineInserts = lineContexts.map(({ line, amounts, sequence }) => buildLegacyPedidoLineInsert({
                pedidoId,
                sequence,
                tipoventa: effectiveSaleType,
                line,
                amounts,
            }));
            await executeBulkInsert((sql, params) => queryWithParams(sql, params, false), legacyLineInserts, {
                chunkSize: DB2_BULK_INSERT_CHUNK_SIZE,
                label: `${ERP_SCHEMA}.PEDIDOS_LIN_LEGACY`,
            });
        }
        logger.info(`[PEDIDOS] createOrder stage=line_inserts pedidoId=${pedidoId} lineCount=${lineCount} durationMs=${Date.now() - lineInsertT0}`);
    } catch (linErr) {
        // COMPENSATION: If lines fail, delete the header to avoid orphaned orders
        logger.error(`[PEDIDOS] Failed to insert lines for order ${pedidoId}, rolling back header: ${linErr.message}`);
        try {
            await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE PEDIDO_ID = ?`, [pedidoId], false);
            await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`, [pedidoId], false);
            logger.info(`[PEDIDOS] Successfully rolled back orphaned header ID=${pedidoId}`);
        } catch (delErr) {
            logger.error(`[PEDIDOS] CRITICAL: Failed to rollback orphaned header ID=${pedidoId}: ${delErr.message}`);
        }
        throw linErr;
    }

    // Recalculate totals. If this fails, compensate the created draft so the
    // API never leaves a half-created order after returning 500.
    const totalsT0 = Date.now();
    try {
        await recalculateOrderTotals(pedidoId);
        logger.info(`[PEDIDOS] createOrder stage=recalculate_totals pedidoId=${pedidoId} lineCount=${lineCount} durationMs=${Date.now() - totalsT0}`);
    } catch (totalErr) {
        logger.error(`[PEDIDOS] Failed to recalculate totals for order ${pedidoId}, rolling back draft: ${totalErr.message}`);
        try {
            await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE PEDIDO_ID = ?`, [pedidoId], false);
            await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`, [pedidoId], false);
            logger.info(`[PEDIDOS] Successfully rolled back draft ID=${pedidoId} after totals failure`);
        } catch (rollbackErr) {
            logger.error(`[PEDIDOS] CRITICAL: Failed to rollback draft ID=${pedidoId} after totals failure: ${rollbackErr.message}`);
        }
        throw totalErr;
    }

    const reserveT0 = Date.now();
    try {
        const reservationLines = buildReservationLinesFromCreateContexts(lineContexts);
        await replaceStockReservationLines(
            (sql, params) => queryWithParams(sql, params, false),
            reservationLines,
            pedidoId
        );
        await invalidatePedidosStockCache('draft_create');
        logger.info(`[PEDIDOS] createOrder stage=stock_reservation pedidoId=${pedidoId} lineCount=${lineCount} durationMs=${Date.now() - reserveT0} statusPath=draft_reserved`);
    } catch (reserveErr) {
        logger.error(`[PEDIDOS] Failed to reserve stock for draft ${pedidoId}, rolling back draft: ${reserveErr.message}`);
        try {
            await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?`, [pedidoId], false);
            await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE PEDIDO_ID = ?`, [pedidoId], false);
            await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`, [pedidoId], false);
            logger.info(`[PEDIDOS] Successfully rolled back draft ID=${pedidoId} after stock reservation failure`);
        } catch (rollbackErr) {
            logger.error(`[PEDIDOS] CRITICAL: Failed to rollback draft ID=${pedidoId} after stock reservation failure: ${rollbackErr.message}`);
        }
        throw reserveErr;
    }

    logger.info(`[PEDIDOS] createOrder stage=stock_validation pedidoId=${pedidoId} lineCount=${lineCount} durationMs=${Date.now() - reserveT0} stock_ms=${Date.now() - reserveT0} stock=draft_reserved statusPath=created`);

    // Invalida cache de listados de pedidos para reflejar el nuevo borrador.
    invalidatePedidosCache(pedidoId);

    if (normalizedIdempotencyKey && idempotencyState?.payloadHash) {
        const storeT0 = Date.now();
        try {
            await storePedidoIdempotency({
                idempotencyKey: normalizedIdempotencyKey,
                pedidoId,
                payloadHash: idempotencyState.payloadHash,
                clientCode: effectiveClientCode,
                vendedorCode: effectiveVendedorCode,
            });
            logger.info(`[PEDIDOS] createOrder stage=idempotency_store pedidoId=${pedidoId} lineCount=${lineCount} durationMs=${Date.now() - storeT0}`);
        } catch (storeErr) {
            if (isDuplicateKeyError(storeErr)) {
                const raced = await lookupPedidoIdempotency(normalizedIdempotencyKey);
                if (raced && raced.payloadHash === idempotencyState.payloadHash) {
                    const detailT0 = Date.now();
                    const order = await getOrderDetail(raced.pedidoId);
                    logger.info(`[PEDIDOS] createOrder stage=getOrderDetail pedidoId=${raced.pedidoId} lineCount=${lineCount} durationMs=${Date.now() - detailT0} statusPath=idempotent_race`);
                    logger.info(`[PEDIDOS] createOrder stage=stock_validation lineCount=${lineCount} durationMs=0 stock_ms=0 stock=not_applicable statusPath=not_applicable`);
                    logger.info(`[PEDIDOS] createOrder stage=service_total pedidoId=${raced.pedidoId} lineCount=${lineCount} statusPath=idempotent_race totalMs=${Date.now() - serviceT0}`);
                    return { ...order, idempotent: true };
                }
                throw createIdempotencyConflictError();
            }
            logger.error(`[PEDIDOS] Failed to persist dedupe key for draft ${pedidoId}, rolling back draft: ${storeErr.message}`);
            try {
                await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?`, [pedidoId], false);
                await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE PEDIDO_ID = ?`, [pedidoId], false);
                await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`, [pedidoId], false);
                logger.info(`[PEDIDOS] Successfully rolled back draft ID=${pedidoId} after idempotency store failure`);
            } catch (rollbackErr) {
                logger.error(`[PEDIDOS] CRITICAL: Failed to rollback draft ID=${pedidoId} after idempotency store failure: ${rollbackErr.message}`);
            }
            throw createIdempotencyUnavailableError();
        }
    } else {
        logger.info(`[PEDIDOS] createOrder stage=idempotency_store lineCount=${lineCount} skipped=1 durationMs=0`);
    }

    // Return created order
    const detailT0 = Date.now();
    const createdOrder = await getOrderDetail(pedidoId, { includeBolsa: false });
    logger.info(`[PEDIDOS] createOrder stage=getOrderDetail pedidoId=${pedidoId} lineCount=${lineCount} durationMs=${Date.now() - detailT0}`);
    logger.info(`[PEDIDOS] createOrder stage=service_total pedidoId=${pedidoId} lineCount=${lineCount} statusPath=created totalMs=${Date.now() - serviceT0}`);
    return createdOrder;
}

// ============================================================================
// GET ORDERS
// ============================================================================

async function getOrders({ vendedorCodes, status, year, month, dateFrom, dateTo, search, minAmount, maxAmount, sortBy, sortOrder, limit = 20, offset = 0, forceRefresh = false }) {
    if (!vendedorCodes) throw new Error('vendedorCodes is required');

    const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
    const safeLimit = clampInt(limit, 1, 500, 20);
    const safeOffset = clampInt(offset, 0, Number.MAX_SAFE_INTEGER, 0);

    // Req #7: Si IMPORTETOTAL viene a 0 (borradores sin recalcular), calcular fallback
    // desde la suma real de IMPORTEVENTA en PEDIDOS_LIN. IMPORTE_CALCULADO se prioriza
    // sobre IMPORTETOTAL en el adaptador de routes.
    let sql = `
        SELECT C.ID, C.EJERCICIO, C.NUMEROPEDIDO, C.SERIEPEDIDO, C.TERMINAL, C.TERMINALPEDIDO,
            C.DIADOCUMENTO, C.MESDOCUMENTO, C.ANODOCUMENTO, C.HORADOCUMENTO,
            TRIM(C.CODIGOCLIENTE) AS CODIGOCLIENTE,
            TRIM(C.NOMBRECLIENTE) AS NOMBRECLIENTE,
            TRIM(C.CODIGOVENDEDOR) AS CODIGOVENDEDOR,
            TRIM(C.TIPOVENTA) AS TIPOVENTA,
            TRIM(C.ESTADO) AS ESTADO,
            C.IMPORTETOTAL, C.IMPORTEBASE, C.IMPORTEIVA, C.IMPORTECOSTO, C.IMPORTEMARGEN,
            COALESCE(NULLIF(C.IMPORTETOTAL, 0), LC.LINE_TOTAL, 0) AS IMPORTE_CALCULADO,
            COALESCE(LC.LINE_COST, 0) AS TOTAL_COSTO,
            TRIM(C.OBSERVACIONES) AS OBSERVACIONES,
            TRIM(C.CODIGOFORMAPAGO) AS CODIGOFORMAPAGO,
            C.CODIGOTARIFA,
            TRIM(C.ORIGEN) AS ORIGEN,
            C.FECHAREPARTO, C.DIAREPARTO, C.MESREPARTO, C.ANOREPARTO,
            TRIM(C.CODIGOREPARTIDOR) AS CODIGOREPARTIDOR,
            TRIM(C.CODIGOVEHICULO) AS CODIGOVEHICULO,
            TRIM(C.RUTA) AS RUTA,
            TRIM(C.DIASREPARTO) AS DIASREPARTO,
            TRIM(C.REPARTO_VALIDADO_SN) AS REPARTO_VALIDADO_SN,
            TRIM(C.TARGET_SCHEMA) AS TARGET_SCHEMA,
            TRIM(C.SYNC_STATUS) AS SYNC_STATUS,
            TRIM(C.SYSTEM_SUBEMPRESAPEDIDO) AS SYSTEM_SUBEMPRESAPEDIDO,
            C.SYSTEM_EJERCICIOPEDIDO, TRIM(C.SYSTEM_SERIEPEDIDO) AS SYSTEM_SERIEPEDIDO,
            C.SYSTEM_TERMINALPEDIDO, C.SYSTEM_NUMEROPEDIDO,
            C.CREATED_AT, C.UPDATED_AT,
            COALESCE(LC.LINE_COUNT, 0) AS LINE_COUNT,
            COALESCE(BM.BOLSA_MOV_COUNT, 0) AS BOLSA_MOV_COUNT,
            COALESCE(BM.BOLSA_NETO, 0) AS BOLSA_NETO
        FROM ${ERP_SCHEMA}.PEDIDOS_CAB C
        LEFT JOIN (
            SELECT PEDIDO_ID,
                   COUNT(*) AS LINE_COUNT,
                   COALESCE(SUM(IMPORTEVENTA), 0) AS LINE_TOTAL,
                   COALESCE(SUM(IMPORTECOSTO), 0) AS LINE_COST
            FROM ${ERP_SCHEMA}.PEDIDOS_LIN
            GROUP BY PEDIDO_ID
        ) LC ON C.ID = LC.PEDIDO_ID
        LEFT JOIN (
            SELECT PEDIDO_ID,
                   COUNT(*) AS BOLSA_MOV_COUNT,
                   COALESCE(SUM(IMPORTE), 0) AS BOLSA_NETO
              FROM JAVIER.MOVIMIENTOS_BOLSA
             WHERE PEDIDO_ID IS NOT NULL
             GROUP BY PEDIDO_ID
        ) BM ON C.ID = BM.PEDIDO_ID
        WHERE 1=1`;

    const params = [];

    if (!isAll) {
        const vendorList = vendedorCodes.split(',').map(v => v.trim()).filter(Boolean);
        // DB2 ODBC has a limit on parameter markers; 50+ vendors can exceed it.
        if (vendorList.length > 50) {
            // Treat as ALL to avoid oversized IN lists.
        } else if (vendorList.length === 1) {
            sql += ` AND TRIM(C.CODIGOVENDEDOR) = ?`;
            params.push(vendorList[0]);
        } else {
            sql += ` AND TRIM(C.CODIGOVENDEDOR) IN (${vendorList.map(() => '?').join(',')})`;
            params.push(...vendorList);
        }
    }

    if (status) {
        const requestedStatus = publicOrderStatus(status);
        if (requestedStatus === 'CONFIRMADO') {
            sql += ` AND TRIM(C.ESTADO) IN ('CONFIRMADO', 'ENVIADO', 'ENTREGADO', 'FACTURADO')`;
        } else {
            sql += ` AND TRIM(C.ESTADO) IN ('BORRADOR', 'CONFIRMANDO', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION')`;
        }
    }

    // Date range filters
    if (dateFrom) {
        const df = String(dateFrom).replace(/-/g, '');
        if (df.length === 8) {
            const y = parseInt(df.substring(0, 4));
            const m = parseInt(df.substring(4, 6));
            const d = parseInt(df.substring(6, 8));
            sql += ` AND (C.ANODOCUMENTO > ? OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO > ?) OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO = ? AND C.DIADOCUMENTO >= ?))`;
            params.push(y, y, m, y, m, d);
        }
    }
    if (dateTo) {
        const dt = String(dateTo).replace(/-/g, '');
        if (dt.length === 8) {
            const y = parseInt(dt.substring(0, 4));
            const m = parseInt(dt.substring(4, 6));
            const d = parseInt(dt.substring(6, 8));
            sql += ` AND (C.ANODOCUMENTO < ? OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO < ?) OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO = ? AND C.DIADOCUMENTO <= ?))`;
            params.push(y, y, m, y, m, d);
        }
    }

    // Year/month fallback (only if no date range applied)
    if (!dateFrom && !dateTo) {
        const currentYear = year || new Date().getFullYear();
        sql += ` AND C.EJERCICIO = ?`;
        params.push(parseInt(currentYear));
        if (month) {
            sql += ` AND C.MESDOCUMENTO = ?`;
            params.push(parseInt(month));
        }
    }

    // Text search
    if (search) {
        const s = `%${search.toUpperCase()}%`;
        sql += ` AND (UPPER(TRIM(C.NOMBRECLIENTE)) LIKE ? OR UPPER(TRIM(C.CODIGOCLIENTE)) LIKE ? OR UPPER(TRIM(CAST(C.NUMEROPEDIDO AS VARCHAR(10)))) LIKE ?)`;
        params.push(s, s, s);
    }

    // Amount filters
    if (minAmount !== undefined) {
        sql += ` AND C.IMPORTETOTAL >= ?`;
        params.push(parseFloat(minAmount));
    }
    if (maxAmount !== undefined) {
        sql += ` AND C.IMPORTETOTAL <= ?`;
        params.push(parseFloat(maxAmount));
    }

    // Dynamic ORDER BY
    const sortField = (sortBy || 'fecha').toLowerCase();
    const sortDir = (sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    switch (sortField) {
        case 'importe':
            sql += ` ORDER BY C.IMPORTETOTAL ${sortDir}`;
            break;
        case 'cliente':
            sql += ` ORDER BY C.NOMBRECLIENTE ${sortDir}`;
            break;
        case 'numero':
            sql += ` ORDER BY C.NUMEROPEDIDO ${sortDir}`;
            break;
        case 'fecha':
        default:
            sql += ` ORDER BY C.ANODOCUMENTO ${sortDir}, C.MESDOCUMENTO ${sortDir}, C.DIADOCUMENTO ${sortDir}`;
            break;
    }
    sql += `, C.NUMEROPEDIDO DESC`;
    sql += ` OFFSET ${safeOffset} ROWS FETCH FIRST ${safeLimit} ROWS ONLY`;

    // CACHE: Keyed on all filter params to avoid repeated costly scans of PEDIDOS_LIN
    const cacheKey = `pedidos:orders:${vendedorCodes || 'ALL'}:${status || ''}:${year || ''}:${month || ''}:${dateFrom || ''}:${dateTo || ''}:${search || ''}:${minAmount || ''}:${maxAmount || ''}:${sortBy || 'fecha'}:${sortOrder || 'DESC'}:${safeLimit}:${safeOffset}`;

    try {
        const rows = forceRefresh
            ? await queryWithParams(sql, params)
            : await cachedQuery(
                (q) => queryWithParams(q, params),
                sql,
                cacheKey,
                TTL.SHORT
            );
        if (!rows || rows.length === 0) {
            return { orders: [], count: 0 };
        }
        const orders = rows.map(r => {
            const dia = String(r.DIADOCUMENTO).padStart(2, '0');
            const mes = String(r.MESDOCUMENTO).padStart(2, '0');
            const ano = r.ANODOCUMENTO;
            const hora = r.HORADOCUMENTO ? String(r.HORADOCUMENTO).padStart(6, '0') : '000000';
            const hh = hora.substring(0, 2);
            const mm = hora.substring(2, 4);
            const numPedido = String(r.NUMEROPEDIDO).padStart(6, '0');
            const fechaReparto = r.FECHAREPARTO ? parseDeliveryDate(r.FECHAREPARTO) : null;
            const localNumeroPedidoFormatted = formatPedidoNumeroAcisa(r.SERIEPEDIDO, r.TERMINAL ?? r.TERMINALPEDIDO, r.NUMEROPEDIDO);
            const hasSystemRef = integerValue(r.SYSTEM_NUMEROPEDIDO) > 0;
            const systemNumeroPedidoFormatted = hasSystemRef
                ? formatPedidoNumeroAcisa(r.SYSTEM_SERIEPEDIDO || r.SERIEPEDIDO, r.SYSTEM_TERMINALPEDIDO, r.SYSTEM_NUMEROPEDIDO)
                : '';
            return {
                id: r.ID,
                ejercicio: r.EJERCICIO,
                numeroPedido: r.NUMEROPEDIDO,
                numeroPedidoFormatted: systemNumeroPedidoFormatted || localNumeroPedidoFormatted,
                localNumeroPedidoFormatted,
                systemNumeroPedidoFormatted,
                targetSchema: r.TARGET_SCHEMA || 'JAVIER',
                syncStatus: r.SYNC_STATUS || 'LOCAL',
                systemNumeroPedido: integerValue(r.SYSTEM_NUMEROPEDIDO),
                systemTerminalPedido: integerValue(r.SYSTEM_TERMINALPEDIDO),
                serie: r.SERIEPEDIDO,
                fecha: `${dia}/${mes}/${ano}`,
                fechaFormatted: `${dia}/${mes}/${ano} ${hh}:${mm}`,
                clienteCode: r.CODIGOCLIENTE,
                clienteName: r.NOMBRECLIENTE || `Cliente ${r.CODIGOCLIENTE}`,
                vendedorCode: r.CODIGOVENDEDOR,
                tipoventa: r.TIPOVENTA,
                estado: publicOrderStatus(r.ESTADO),
                // Req #7: prioriza el total calculado desde lineas si IMPORTETOTAL
                // esta a 0 (tipico en borradores sin recalcular cabecera).
                total: parseFloat(r.IMPORTE_CALCULADO) || parseFloat(r.IMPORTETOTAL) || 0,
                totalHeader: parseFloat(r.IMPORTETOTAL) || 0,
                totalCalculated: parseFloat(r.IMPORTE_CALCULADO) || 0,
                base: parseFloat(r.IMPORTEBASE) || 0,
                iva: parseFloat(r.IMPORTEIVA) || 0,
                costo: parseFloat(r.IMPORTECOSTO) || parseFloat(r.TOTAL_COSTO) || 0,
                margen: parseFloat(r.IMPORTEMARGEN) || 0,
                observaciones: r.OBSERVACIONES,
                formaPago: r.CODIGOFORMAPAGO,
                tarifa: r.CODIGOTARIFA,
                origen: r.ORIGEN,
                fechaReparto: fechaReparto?.iso || '',
                fechaRepartoFormatted: fechaReparto ? formatDateDisplay(fechaReparto.iso) : '',
                diaReparto: parseInt(r.DIAREPARTO) || 0,
                mesReparto: parseInt(r.MESREPARTO) || 0,
                anoReparto: parseInt(r.ANOREPARTO) || 0,
                repartidorCode: r.CODIGOREPARTIDOR || '',
                vehicleCode: r.CODIGOVEHICULO || '',
                ruta: r.RUTA || '',
                diasReparto: r.DIASREPARTO || '',
                repartoValidado: (r.REPARTO_VALIDADO_SN || '').trim() === 'S',
                lineCount: parseInt(r.LINE_COUNT) || 0,
                bolsaGenerada: (parseInt(r.BOLSA_MOV_COUNT, 10) || 0) > 0,
                bolsaNeto: roundMoney(parseFloat(r.BOLSA_NETO) || 0),
                createdAt: r.CREATED_AT,
                updatedAt: r.UPDATED_AT,
            };
        });
        return { orders, count: orders.length };
    } catch (error) {
        logger.error(`[PEDIDOS] getOrders error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// ORDER DETAIL
// ============================================================================

function toBolsaNumber(value) {
    if (value === undefined || value === null || value === '') return 0;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
}

function toBolsaRawNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function mapBolsaMovementRow(row) {
    const tipo = String(row.TIPO || '').trim();
    const importe = toBolsaNumber(row.IMPORTE);
    return {
        id: row.ID,
        tipo,
        importe,
        importeFirmado: tipo === 'CONSUMO' ? -importe : importe,
        saldoAnterior: toBolsaNumber(row.SALDO_ANTERIOR),
        saldoPosterior: toBolsaNumber(row.SALDO_POSTERIOR),
        codigoArticulo: String(row.CODIGO_ARTICULO || '').trim(),
        descripcion: String(row.DESCRIPCION || '').trim(),
        pedidoId: row.PEDIDO_ID,
        lineId: row.LINEA_ID ?? null,
        precioMinimoCongelado: toBolsaRawNumber(row.PRECIO_MINIMO_CONGELADO),
        precioVenta: toBolsaRawNumber(row.PRECIO_VENTA),
        cantidad: toBolsaRawNumber(row.CANTIDAD),
        unidadMedida: String(row.UNIDAD_MEDIDA || '').trim() || null,
        idempotencyKey: String(row.IDEMPOTENCY_KEY || '').trim() || null,
        fecha: row.CREATED_AT,
    };
}

async function getBolsaMovementsForOrder(orderId) {
    try {
        const rows = await queryWithParams(
            `SELECT ID, TIPO, IMPORTE, SALDO_ANTERIOR, SALDO_POSTERIOR,
                    CODIGO_ARTICULO, DESCRIPCION, PEDIDO_ID, LINEA_ID,
                    PRECIO_MINIMO_CONGELADO, PRECIO_VENTA, CANTIDAD,
                    UNIDAD_MEDIDA, IDEMPOTENCY_KEY, CREATED_AT
               FROM JAVIER.MOVIMIENTOS_BOLSA
              WHERE PEDIDO_ID = ?
              ORDER BY CREATED_AT ASC, ID ASC`,
            [orderId],
            false,
            false
        );
        return (rows || []).map(mapBolsaMovementRow);
    } catch (error) {
        logger.warn(`[PEDIDOS] Bolsa trace unavailable for order ${orderId}: ${error.message}`);
        return [];
    }
}

function buildBolsaSummary(movements) {
    let acumulacion = 0;
    let consumo = 0;
    for (const movement of movements || []) {
        if (movement.tipo === 'ACUMULACION') acumulacion += movement.importe;
        if (movement.tipo === 'CONSUMO') consumo += movement.importe;
    }
    acumulacion = toBolsaNumber(acumulacion);
    consumo = toBolsaNumber(consumo);
    return {
        acumulacion,
        consumo,
        neto: toBolsaNumber(acumulacion - consumo),
        movementCount: (movements || []).length,
    };
}

function summarizeLineBolsaMovements(movements) {
    const summary = buildBolsaSummary(movements);
    return {
        ...summary,
        hasImpact: summary.movementCount > 0,
    };
}

async function getOrderDetail(orderId, options = {}) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');
    const includeBolsa = options.includeBolsa !== false;

    const cabSql = `
        SELECT ID, EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO, TERMINAL,
            DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
            TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE,
            TRIM(NOMBRECLIENTE) AS NOMBRECLIENTE,
            TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR,
            TRIM(CODIGOFORMAPAGO) AS CODIGOFORMAPAGO,
            CODIGOTARIFA, CODIGOALMACEN,
            TRIM(TIPOVENTA) AS TIPOVENTA,
            TRIM(ESTADO) AS ESTADO,
            IMPORTETOTAL, IMPORTEBASE, IMPORTEIVA, IMPORTECOSTO, IMPORTEMARGEN,
            TRIM(OBSERVACIONES) AS OBSERVACIONES,
            FECHAREPARTO, DIAREPARTO, MESREPARTO, ANOREPARTO,
            TRIM(CODIGOREPARTIDOR) AS CODIGOREPARTIDOR,
            TRIM(CODIGOVEHICULO) AS CODIGOVEHICULO,
            TRIM(RUTA) AS RUTA,
            TRIM(DIASREPARTO) AS DIASREPARTO,
            TRIM(REPARTO_VALIDADO_SN) AS REPARTO_VALIDADO_SN,
            TRIM(TARGET_SCHEMA) AS TARGET_SCHEMA,
            TRIM(SYNC_STATUS) AS SYNC_STATUS,
            TRIM(SYSTEM_SUBEMPRESAPEDIDO) AS SYSTEM_SUBEMPRESAPEDIDO,
            SYSTEM_EJERCICIOPEDIDO, TRIM(SYSTEM_SERIEPEDIDO) AS SYSTEM_SERIEPEDIDO,
            SYSTEM_TERMINALPEDIDO, SYSTEM_NUMEROPEDIDO,
            CREATED_AT, UPDATED_AT
        FROM ${ERP_SCHEMA}.PEDIDOS_CAB
        WHERE ID = ?`;

    const linSql = `
        SELECT ID, PEDIDO_ID, SECUENCIA,
            TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
            TRIM(DESCRIPCION) AS DESCRIPCION,
            CANTIDADENVASES, CANTIDADUNIDADES,
            TRIM(UNIDADMEDIDA) AS UNIDADMEDIDA, UNIDADESCAJA,
            PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
            IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
            TRIM(TIPOLINEA) AS TIPOLINEA,
            TRIM(TIPOVENTA) AS TIPOVENTA,
            TRIM(CLASELINEA) AS CLASELINEA,
            TRIM(COALESCE(CODIGOIVA, '2')) AS CODIGOIVA,
            ORDEN, CREATED_AT
        FROM ${ERP_SCHEMA}.PEDIDOS_LIN
        WHERE PEDIDO_ID = ?
        ORDER BY SECUENCIA`;

    try {
        const detailQueries = [
            queryWithParams(cabSql, [id]),
            queryWithParams(linSql, [id]),
        ];
        if (includeBolsa) detailQueries.push(getBolsaMovementsForOrder(id));
        const [cabRows, linRows, bolsaRows] = await Promise.all(detailQueries);
        const bolsaMovements = includeBolsa ? bolsaRows : [];

        if (!cabRows || cabRows.length === 0) {
            throw new Error('Pedido no encontrado');
        }

        const cab = cabRows[0];
        const fechaReparto = cab.FECHAREPARTO ? parseDeliveryDate(cab.FECHAREPARTO) : null;
        const localNumeroPedidoFormatted = formatPedidoNumeroAcisa(cab.SERIEPEDIDO, cab.TERMINAL, cab.NUMEROPEDIDO);
        const hasSystemRef = integerValue(cab.SYSTEM_NUMEROPEDIDO) > 0;
        const systemNumeroPedidoFormatted = hasSystemRef
            ? formatPedidoNumeroAcisa(cab.SYSTEM_SERIEPEDIDO || cab.SERIEPEDIDO, cab.SYSTEM_TERMINALPEDIDO, cab.SYSTEM_NUMEROPEDIDO)
            : '';
        const bolsaByLine = new Map();
        for (const movement of bolsaMovements) {
            const key = movement.lineId === null || movement.lineId === undefined ? '' : String(movement.lineId);
            if (!key) continue;
            if (!bolsaByLine.has(key)) bolsaByLine.set(key, []);
            bolsaByLine.get(key).push(movement);
        }

        return {
            header: {
                id: cab.ID,
                ejercicio: cab.EJERCICIO,
                numeroPedido: cab.NUMEROPEDIDO,
                numeroPedidoFormatted: systemNumeroPedidoFormatted || localNumeroPedidoFormatted,
                localNumeroPedidoFormatted,
                systemNumeroPedidoFormatted,
                targetSchema: cab.TARGET_SCHEMA || 'JAVIER',
                syncStatus: cab.SYNC_STATUS || 'LOCAL',
                systemNumeroPedido: integerValue(cab.SYSTEM_NUMEROPEDIDO),
                systemTerminalPedido: integerValue(cab.SYSTEM_TERMINALPEDIDO),
                serie: cab.SERIEPEDIDO,
                terminal: cab.TERMINAL,
                fecha: `${String(cab.DIADOCUMENTO).padStart(2, '0')}/${String(cab.MESDOCUMENTO).padStart(2, '0')}/${cab.ANODOCUMENTO}`,
                hora: cab.HORADOCUMENTO,
                clienteId: cab.CODIGOCLIENTE,
                clienteNombre: cab.NOMBRECLIENTE,
                vendedor: cab.CODIGOVENDEDOR,
                formaPago: cab.CODIGOFORMAPAGO,
                tarifa: cab.CODIGOTARIFA,
                almacen: cab.CODIGOALMACEN,
                tipoventa: cab.TIPOVENTA,
                estado: publicOrderStatus(cab.ESTADO),
                total: parseFloat(cab.IMPORTETOTAL) || 0,
                base: parseFloat(cab.IMPORTEBASE) || 0,
                iva: parseFloat(cab.IMPORTEIVA) || 0,
                costo: parseFloat(cab.IMPORTECOSTO) || 0,
                margen: parseFloat(cab.IMPORTEMARGEN) || 0,
                observaciones: cab.OBSERVACIONES,
                fechaReparto: fechaReparto?.iso || '',
                fechaRepartoFormatted: fechaReparto ? formatDateDisplay(fechaReparto.iso) : '',
                diaReparto: parseInt(cab.DIAREPARTO) || 0,
                mesReparto: parseInt(cab.MESREPARTO) || 0,
                anoReparto: parseInt(cab.ANOREPARTO) || 0,
                repartidorCode: cab.CODIGOREPARTIDOR || '',
                vehicleCode: cab.CODIGOVEHICULO || '',
                ruta: cab.RUTA || '',
                diasReparto: cab.DIASREPARTO || '',
                repartoValidado: (cab.REPARTO_VALIDADO_SN || '').trim() === 'S',
                createdAt: cab.CREATED_AT,
                updatedAt: cab.UPDATED_AT,
            },
            lines: (linRows || []).map(l => {
                const movements = bolsaByLine.get(String(l.ID)) || [];
                return {
                    id: l.ID,
                    pedidoId: l.PEDIDO_ID,
                    secuencia: l.SECUENCIA,
                    codigoArticulo: l.CODIGOARTICULO,
                    descripcion: l.DESCRIPCION,
                    cantidadEnvases: parseFloat(l.CANTIDADENVASES) || 0,
                    cantidadUnidades: parseFloat(l.CANTIDADUNIDADES) || 0,
                    unidadMedida: l.UNIDADMEDIDA,
                    unidadesCaja: parseFloat(l.UNIDADESCAJA) || 1,
                    precioVenta: parseFloat(l.PRECIOVENTA) || 0,
                    precioCosto: parseFloat(l.PRECIOCOSTO) || 0,
                    precioTarifa: parseFloat(l.PRECIOTARIFA) || 0,
                    precioTarifaCliente: parseFloat(l.PRECIOTARIFACLIENTE) || 0,
                    precioMinimo: parseFloat(l.PRECIOMINIMO) || 0,
                    importeVenta: parseFloat(l.IMPORTEVENTA) || 0,
                    importeCosto: parseFloat(l.IMPORTECOSTO) || 0,
                    importeMargen: parseFloat(l.IMPORTEMARGEN) || 0,
                    porcentajeMargen: parseFloat(l.PORCENTAJEMARGEN) || 0,
                    codigoIva: (l.CODIGOIVA || '2').toString().trim(),
                    ...resolveIvaFromCodigo((l.CODIGOIVA || '2').toString().trim()),
                    tipoLinea: l.TIPOLINEA,
                    tipoventa: l.TIPOVENTA,
                    claseLinea: l.CLASELINEA,
                    orden: l.ORDEN,
                    createdAt: l.CREATED_AT,
                    bolsaMovements: movements,
                    bolsaImpact: summarizeLineBolsaMovements(movements),
                };
            }),
            bolsaMovements,
            bolsaSummary: buildBolsaSummary(bolsaMovements),
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getOrderDetail error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// SHARED LINE IMPORTE CALCULATOR (P1-A FIX)
// ============================================================================

/**
 * Calculates importeVenta consistently for any line, matching createOrder logic.
 * Handles weight products, dual-field (cajas+unidades), box-only, and generic units.
 */
function calculateLineImporte({ unidadMedida, cantidadEnvases, cantidadUnidades, unidadesCaja, precioVenta }) {
    const um = (unidadMedida || 'CAJAS').trim().toUpperCase();
    const envases = parseFloat(cantidadEnvases) || 0;
    const unidades = parseFloat(cantidadUnidades) || 0;
    const uc = parseFloat(unidadesCaja) || 1;
    const precio = parseFloat(precioVenta) || 0;

    let importe = 0;
    if (um === 'KILOGRAMOS' || um === 'LITROS') {
        importe = unidades * precio;
    } else if (envases > 0 && unidades > 0 && isBoxUnidadMedida(um)) {
        const expectedEquivalentUnits = envases * uc;
        const unitsAreBoxEquivalence = Math.abs(unidades - expectedEquivalentUnits) < 0.0001
            || unidades >= expectedEquivalentUnits;
        importe = unitsAreBoxEquivalence
            ? envases * precio
            : (envases + (unidades / uc)) * precio;
    } else if (isBoxUnidadMedida(um)) {
        importe = envases * precio;
    } else {
        // PIEZAS, BANDEJAS, ESTUCHES, UNIDADES, etc.
        importe = unidades * precio;
    }
    return Math.round(importe * 100) / 100;
}

function assertPrecioWithinClientTariff({ precioVenta, tariffPrice, userRole, articleCode }) {
    const salePrice = parseFloat(precioVenta) || 0;
    const tariff = parseFloat(tariffPrice) || 0;
    if (salePrice <= 0 || tariff <= 0) return true;

    const role = String(userRole || '').trim().toUpperCase();
    if (role === 'JEFE_VENTAS' || role === 'ADMIN') return true;

    const deviation = Math.abs(salePrice - tariff) / tariff;
    if (deviation > 0.5) {
        const err = new Error(`Precio de ${articleCode || 'articulo'} se desvia mas del 50% respecto a tarifa cliente`);
        err.code = 'PRICE_TARIFF_DEVIATION';
        err.status = 409;
        throw err;
    }
    return true;
}

// ============================================================================
// ADD / UPDATE / DELETE LINE
// ============================================================================

async function addOrderLine(pedidoId, lineData) {
    const id = parseInt(pedidoId);
    if (isNaN(id)) throw new Error('Invalid pedidoId');

    const codigoArticulo = trimString(lineData.codigoArticulo);
    if (!codigoArticulo) {
        throw new OrderStateError('INVALID_LINE_PAYLOAD', 'codigoArticulo is required', 400);
    }
    const claseLinea = lineData.claseLinea === undefined ? 'VT' : trimString(lineData.claseLinea);
    if (!['VT', 'SC'].includes(claseLinea)) {
        throw new OrderStateError('INVALID_LINE_PAYLOAD', 'claseLinea inválida', 400);
    }

    await assertOrderEditable(id);

    // Get next secuencia
    const seqRows = await queryWithParams(
        `SELECT COALESCE(MAX(SECUENCIA), 0) + 1 AS NEXT_SEQ FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE PEDIDO_ID = ?`,
        [id]
    );
    const nextSeq = seqRows[0]?.NEXT_SEQ || 1;

    const cantidadEnvases = parseFloat(lineData.cantidadEnvases) || 0;
    const cantidadUnidades = parseFloat(lineData.cantidadUnidades || lineData.cantidad) || 0;
    const precioBase = parseFloat(lineData.precio || lineData.precioVenta) || 0;
    const descuentoLinea = Math.min(100, Math.max(0, parseFloat(lineData.descuentoLinea) || 0));
    const precio = descuentoLinea > 0 ? Math.round(precioBase * (1 - descuentoLinea / 100) * 10000) / 10000 : precioBase;
    const precioCosto = parseFloat(lineData.precioCosto) || 0;
    const unidadesCaja = parseFloat(lineData.unidadesCaja) || 1;
    const unidadMedida = lineData.unidadMedida || 'CAJAS';
    const articleIvaCodes = await getArticleIvaCodesForLines([lineData]);
    const iva = articleIvaCodes.has(codigoArticulo)
        ? resolveIvaFromCodigo(articleIvaCodes.get(codigoArticulo))
        : resolveIvaFromLine(lineData);

    // P1-A: Use shared calculator for consistent importe across add/create
    const importeVenta = calculateLineImporte({ unidadMedida, cantidadEnvases, cantidadUnidades, unidadesCaja, precioVenta: precio });
    const billingQty = isBoxUnidadMedida(unidadMedida) ? cantidadEnvases : cantidadUnidades;
    const importeCosto = Math.round((billingQty * precioCosto) * 100) / 100;
    const importeMargen = importeVenta - importeCosto;
    const pctMargen = importeVenta > 0 ? ((importeMargen / importeVenta) * 100) : 0;

    const sql = `
        INSERT INTO ${ERP_SCHEMA}.PEDIDOS_LIN (
            PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION,
            CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA,
            PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
            IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
            DESCUENTO_LINEA,
            TIPOLINEA, TIPOVENTA, CLASELINEA, ORDEN, CODIGOIVA
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
        id, nextSeq,
        codigoArticulo, (lineData.descripcion || '').substring(0, 40),
        cantidadEnvases, cantidadUnidades,
        unidadMedida, unidadesCaja,
        precio, precioCosto,
        parseFloat(lineData.precioTarifa) || 0, parseFloat(lineData.precioTarifaCliente) || 0,
        parseFloat(lineData.precioMinimo) || 0,
        importeVenta, importeCosto, importeMargen,
        Math.round(pctMargen * 100) / 100,
        descuentoLinea,
        lineData.tipoLinea || 'R', lineData.tipoventa || 'CC', claseLinea, nextSeq, iva.codigoIva
    ];

    await queryWithParams(sql, params, false);
    await recalculateOrderTotals(id);
    await refreshDraftStockReservation(id);
    await invalidatePedidosStockCache('draft_line_add');

    return getOrderDetail(id);
}

async function updateOrderLine(lineId, {
    cantidad,
    cantidadEnvases,
    cantidadUnidades,
    precio,
    precioVenta,
    unidadMedida,
    precioCosto,
    claseLinea,
}) {
    const id = parseInt(lineId);
    if (isNaN(id)) throw new Error('Invalid lineId');

    if (claseLinea !== undefined && !['VT', 'SC'].includes(claseLinea)) {
        throw new OrderStateError('INVALID_LINE_PAYLOAD', 'claseLinea inválida', 400);
    }

    // Fetch current line to get pedidoId and defaults
    const currentRows = await queryWithParams(
        `SELECT PEDIDO_ID, CANTIDADENVASES, CANTIDADUNIDADES, PRECIOVENTA, PRECIOCOSTO, UNIDADMEDIDA, UNIDADESCAJA, CLASELINEA, TRIM(COALESCE(CODIGOIVA, '2')) AS CODIGOIVA FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE ID = ?`,
        [id]
    );
    if (!currentRows || currentRows.length === 0) throw new Error('Line not found');

    const current = currentRows[0];
    const pedidoId = current.PEDIDO_ID;

    await assertOrderEditable(pedidoId);

    const newClase = claseLinea !== undefined ? claseLinea : (current.CLASELINEA || 'VT');
    const newEnvases = cantidadEnvases != null ? parseFloat(cantidadEnvases) : parseFloat(current.CANTIDADENVASES) || 0;
    const newUnidades = cantidadUnidades != null
        ? parseFloat(cantidadUnidades)
        : (cantidad != null ? parseFloat(cantidad) : parseFloat(current.CANTIDADUNIDADES) || 0);
    // SC lines always have 0 price and importe
    const newPrecio = newClase === 'SC' ? 0
        : (precioVenta != null ? parseFloat(precioVenta) : (precio != null ? parseFloat(precio) : parseFloat(current.PRECIOVENTA) || 0));
    const newCosto = precioCosto != null ? parseFloat(precioCosto) : parseFloat(current.PRECIOCOSTO) || 0;
    const newUM = unidadMedida || current.UNIDADMEDIDA;
    const unidadesCaja = parseFloat(current.UNIDADESCAJA) || 1;

    const importeVenta = newClase === 'SC' ? 0 : calculateLineImporte({
        unidadMedida: newUM,
        cantidadEnvases: newEnvases,
        cantidadUnidades: newUnidades,
        unidadesCaja,
        precioVenta: newPrecio,
    });
    const billingQty = newUM === 'CAJAS' ? newEnvases : newUnidades;
    const importeCosto = billingQty * newCosto;
    const importeMargen = importeVenta - importeCosto;
    const pctMargen = importeVenta > 0 ? ((importeMargen / importeVenta) * 100) : 0;

    await queryWithParams(
        `UPDATE ${ERP_SCHEMA}.PEDIDOS_LIN SET
            CANTIDADENVASES = ?, CANTIDADUNIDADES = ?, PRECIOVENTA = ?, PRECIOCOSTO = ?, UNIDADMEDIDA = ?,
            IMPORTEVENTA = ?, IMPORTECOSTO = ?, IMPORTEMARGEN = ?, PORCENTAJEMARGEN = ?,
            CLASELINEA = ?
        WHERE ID = ?`,
        [newEnvases, newUnidades, newPrecio, newCosto, newUM, importeVenta, importeCosto, importeMargen,
            Math.round(pctMargen * 100) / 100, newClase, id],
        false
    );

    await recalculateOrderTotals(pedidoId);
    await refreshDraftStockReservation(pedidoId);
    await invalidatePedidosStockCache('draft_line_update');
    invalidatePedidosCache(pedidoId);
    return getOrderDetail(pedidoId);
}

async function deleteOrderLine(lineId, pedidoId) {
    const lid = parseInt(lineId);
    const pid = parseInt(pedidoId);
    if (isNaN(lid) || isNaN(pid)) throw new Error('Invalid lineId or pedidoId');

    await assertOrderEditable(pid);

    const lineRows = await queryWithParams(
        `SELECT ID FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE ID = ? AND PEDIDO_ID = ?`,
        [lid, pid], false
    );
    if (!lineRows || lineRows.length === 0) {
        throw new OrderStateError('LINE_NOT_FOUND', 'Línea de pedido no encontrada', 404);
    }

    await queryWithParams(
        `DELETE FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE ID = ? AND PEDIDO_ID = ?`,
        [lid, pid], false
    );

    await recalculateOrderTotals(pid);
    await refreshDraftStockReservation(pid);
    await invalidatePedidosStockCache('draft_line_delete');
    invalidatePedidosCache(pid);
    return getOrderDetail(pid);
}

// ============================================================================
// RECALCULATE TOTALS
// ============================================================================

async function recalculateOrderTotals(pedidoId) {
    const id = parseInt(pedidoId);
    
    const rows = await queryWithParams(
        `SELECT 
            COALESCE(SUM(L.IMPORTEVENTA), 0) as RAW_BASE,
            COALESCE(SUM(L.IMPORTECOSTO), 0) as RAW_COSTO,
            COALESCE(SUM(CASE
                WHEN COALESCE(NULLIF(TRIM(L.CODIGOIVA), ''), '2') = '1' THEN L.IMPORTEVENTA * 0.10
                WHEN COALESCE(NULLIF(TRIM(L.CODIGOIVA), ''), '2') = '2' THEN L.IMPORTEVENTA * 0.21
                WHEN COALESCE(NULLIF(TRIM(L.CODIGOIVA), ''), '2') = '3' THEN L.IMPORTEVENTA * 0.04
                WHEN COALESCE(NULLIF(TRIM(L.CODIGOIVA), ''), '2') = '4' THEN 0
                WHEN COALESCE(NULLIF(TRIM(L.CODIGOIVA), ''), '2') = '5' THEN L.IMPORTEVENTA * 0.10
                ELSE L.IMPORTEVENTA * 0.21
            END), 0) as RAW_IVA,
            COALESCE(MAX(C.DESCUENTO_GLOBAL), 0) as DESCUENTO_GLOBAL
         FROM ${ERP_SCHEMA}.PEDIDOS_CAB C
         LEFT JOIN ${ERP_SCHEMA}.PEDIDOS_LIN L ON L.PEDIDO_ID = C.ID
         WHERE C.ID = ?`,
        [id]
    );
    const rawBase = parseFloat(rows[0]?.RAW_BASE) || 0;
    const rawCosto = parseFloat(rows[0]?.RAW_COSTO) || 0;
    const rawIva = parseFloat(rows[0]?.RAW_IVA) || 0;
    const descuentoGlobal = parseFloat(rows[0]?.DESCUENTO_GLOBAL) || 0;
    const discountFactor = 1 - (descuentoGlobal / 100);
    const importeBaseBruta = roundMoney(rawBase);
    const importeBase = roundMoney(rawBase * discountFactor);
    const importeIva = roundMoney(rawIva * discountFactor);
    const importeCosto = roundMoney(rawCosto);
    const importeTotal = roundMoney(importeBase + importeIva);
    const importeMargen = roundMoney(importeBase - rawCosto);

    assertMoneyFitsWriteSchema(importeBase, 'IMPORTEBASE', `pedido ${id}`);
    assertMoneyFitsWriteSchema(importeIva, 'IMPORTEIVA', `pedido ${id}`);
    assertMoneyFitsWriteSchema(importeCosto, 'IMPORTECOSTO', `pedido ${id}`);
    assertMoneyFitsWriteSchema(importeTotal, 'IMPORTETOTAL', `pedido ${id}`);
    assertMoneyFitsWriteSchema(importeMargen, 'IMPORTEMARGEN', `pedido ${id}`);

    await queryWithParams(
        `UPDATE ${ERP_SCHEMA}.PEDIDOS_CAB SET
            IMPORTEBASE = ?,
            IMPORTECOSTO = ?,
            IMPORTETOTAL = ?,
            IMPORTEMARGEN = ?,
            IMPORTEIVA = ?,
            UPDATED_AT = CURRENT_TIMESTAMP
        WHERE ID = ?`,
        [importeBase, importeCosto, importeTotal, importeMargen, importeIva, id], false
    );

    try {
        await queryWithParams(
            `UPDATE ${ERP_SCHEMA}.PEDIDOS_CAB SET
                IMPORTEBASEIMPONIBLEBRUTA1 = ?,
                IMPORTEBASEIMPONIBLE1 = ?,
                IMPORTEBRUTO = ?
             WHERE ID = ?`,
            [importeBaseBruta, importeBase, importeBaseBruta, id], false
        );
    } catch (erpColumnErr) {
        if (!isColumnNotFound(erpColumnErr)) throw erpColumnErr;
        logger.warn(`[PEDIDOS] ERP-compatible total columns missing in ${ERP_SCHEMA}.PEDIDOS_CAB, totals kept in legacy columns`);
    }
}

// ============================================================================
// CONFIRM / CANCEL
// ============================================================================

async function confirmOrder(orderId, saleType, options = {}) {
    const id = parseInt(orderId);
    const effectiveForceConfirm = isAuthorizedForceConfirm(options);
    if (options.forceConfirm === true && !effectiveForceConfirm) {
        logger.warn(`[PEDIDOS] forceConfirm ignored for order #${id}: missing server-side admin override, role, or audit reason`);
    }
    if (isNaN(id)) throw new Error('Invalid orderId');

    // CRITICAL: race-condition guard. Reservamos atomicamente el pedido pasando
    // a estado intermedio CONFIRMANDO en una sola sentencia (compare-and-swap).
    // Si el UPDATE no afecta filas, otro request ya tomo el pedido (o el estado
    // no es BORRADOR), y abortamos con un error claro.
    const reserveResult = await queryWithParams(
        `UPDATE ${ERP_SCHEMA}.PEDIDOS_CAB
            SET ESTADO = 'CONFIRMANDO',
                UPDATED_AT = CURRENT_TIMESTAMP
          WHERE ID = ?
            AND ESTADO IN ('BORRADOR', 'PEND_APROB')`,
        [id], false
    );
    const rowsAffected = (reserveResult && typeof reserveResult.count === 'number')
        ? reserveResult.count
        : (typeof reserveResult === 'number' ? reserveResult : null);

    // STATE READ (siempre): trae payload + estado actual tras el intento de reserva.
    const currentRows = await queryWithParams(
        `SELECT ESTADO,
                ID, EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO, TERMINAL,
                DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
                TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE,
                TRIM(NOMBRECLIENTE) AS NOMBRECLIENTE,
                TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR,
                TRIM(CODIGOFORMAPAGO) AS CODIGOFORMAPAGO,
                CODIGOTARIFA, CODIGOALMACEN,
                TRIM(TIPOVENTA) AS TIPOVENTA,
                IMPORTETOTAL, IMPORTEBASE, IMPORTEIVA, IMPORTECOSTO, IMPORTEMARGEN,
                TRIM(OBSERVACIONES) AS OBSERVACIONES
         FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`,
        [id], false
    );

    if (!currentRows || currentRows.length === 0) {
        throw new Error('Pedido no encontrado');
    }

    const currentState = canonicalOrderStatus(currentRows[0].ESTADO);

    // Si rowsAffected es 0 y el estado NO es CONFIRMANDO de este request,
    // significa que otro proceso lo tomo (CONFIRMADO) o estaba en
    // estado invalido. Algunos drivers ODBC no reportan rowsAffected, por
    // eso confiamos en el estado leido.
    if (rowsAffected === 0) {
        if (currentState === 'CONFIRMADO' || currentState === 'CONFIRMANDO') {
            const err = new Error('Pedido ya confirmado o en proceso de confirmacion por otra sesion');
            err.code = 'PEDIDO_ALREADY_CONFIRMING';
            err.status = 409;
            throw err;
        }
        if (currentState !== 'BORRADOR') {
            const err = new Error(`Solo se pueden confirmar pedidos en estado BORRADOR (estado actual: ${currentState})`);
            err.code = 'PEDIDO_INVALID_STATE';
            err.status = 409;
            throw err;
        }
    }
    // Si llegamos aqui con currentState != CONFIRMANDO/BORRADOR, hay corrupcion.
    if (currentState !== 'CONFIRMANDO' && currentState !== 'BORRADOR') {
        const err = new Error(`Estado inesperado tras intento de reserva: ${currentState}`);
        err.code = 'PEDIDO_INVALID_STATE';
        err.status = 409;
        throw err;
    }
    const effectiveSaleType = normalizePedidoSaleType(saleType || currentRows[0].TIPOVENTA || 'CC');

    // Helper: revierte CONFIRMANDO -> BORRADOR cuando un retorno temprano o un
    // fallo deja el pedido bloqueado en estado intermedio. Best-effort: si falla
    // se loguea pero NO se propaga, para no enmascarar el error original.
    const revertConfirming = async (reasonTag) => {
        try {
            await queryWithParams(
                `UPDATE ${ERP_SCHEMA}.PEDIDOS_CAB
                    SET ESTADO = 'BORRADOR', UPDATED_AT = CURRENT_TIMESTAMP
                  WHERE ID = ? AND ESTADO = 'CONFIRMANDO'`,
                [id], false
            );
            logger.info(`[PEDIDOS] CONFIRMANDO->BORRADOR revertido (#${id}) tag=${reasonTag}`);
        } catch (revertErr) {
            logger.error(`[PEDIDOS] No se pudo revertir CONFIRMANDO->BORRADOR para #${id}: ${revertErr.message}`);
        }
    };

    const clientCode = trimString(currentRows[0].CODIGOCLIENTE || options.clientCode);
    const vendedorCode = trimString(currentRows[0].CODIGOVENDEDOR || options.vendedorCode);
    const deliveryPlan = await resolveDeliveryPlan({
        clientCode,
        vendedorCode,
        deliveryDate: options.deliveryDate,
    });
    const inferredAssignment = await getDefaultTruckAssignment({
        clientCode,
        vendedorCode,
        deliveryDate: deliveryPlan.date.iso,
        routeCode: options.routeCode,
    });
    const vehicleCode = trimString(options.vehicleCode || inferredAssignment.vehicleCode).substring(0, 10);
    const driverCode = trimString(options.driverCode || inferredAssignment.driverCode).substring(0, 2);
    const routeCode = trimString(options.routeCode || inferredAssignment.routeCode).substring(0, 10);

    // P0-C: Validate stock BEFORE confirming - block if insufficient
    const lines = await queryWithParams(
        `SELECT ID, PEDIDO_ID, SECUENCIA,
                TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
                TRIM(DESCRIPCION) AS DESCRIPCION,
                CANTIDADENVASES, CANTIDADUNIDADES,
                TRIM(UNIDADMEDIDA) AS UNIDADMEDIDA, UNIDADESCAJA,
                PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
                IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
                TRIM(TIPOLINEA) AS TIPOLINEA,
                TRIM(TIPOVENTA) AS TIPOVENTA,
                TRIM(CLASELINEA) AS CLASELINEA,
                TRIM(COALESCE(CODIGOIVA, '2')) AS CODIGOIVA,
                ORDEN
         FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE PEDIDO_ID = ?`, [id]);

    const stockWarnings = [];
    const outOfStockProducts = [];

    // P0-BOLSA: Validate bolsa comercial before confirming
    try {
        const bolsaService = require('../bolsa-comercial.service');
        const bolsaResult = await bolsaService.validateOrderWithBolsa(vendedorCode, lines);
        if (!bolsaResult.valid && !effectiveForceConfirm) {
            await revertConfirming('BOLSA_INSUFICIENTE');
            return {
                blocked: true,
                reason: 'BOLSA_INSUFICIENTE',
                deficit: bolsaResult.deficit,
                saldoBolsa: bolsaResult.saldo,
                warnings: bolsaResult.warnings,
                message: `Bolsa comercial insuficiente. Deficit: ${bolsaResult.deficit.toFixed(2)}. Saldo: ${bolsaResult.saldo.toFixed(2)}`,
            };
        }
        options._bolsaConsumo = bolsaResult.consumo || 0;
        options._bolsaAcumulacion = bolsaResult.acumulacion || 0;
        options._bolsaLineMovements = Array.isArray(bolsaResult.lineMovements) ? bolsaResult.lineMovements : [];
    } catch (bolsaErr) {
        await revertConfirming('BOLSA_VALIDATION_FAILED');
        const err = new Error('No se pudo validar bolsa comercial. El pedido no se ha confirmado. Error: ' + bolsaErr.message);
        err.code = 'BOLSA_VALIDATION_FAILED';
        err.status = 503;
        throw err;
    }

    const stockByCode = await getStockBatch(lines.map(line => line.CODIGOARTICULO), 1, { excludePedidoId: id });
    for (const line of lines) {
        const code = (line.CODIGOARTICULO || '').trim();
        if (!code) continue;
        try {
            const stock = stockByCode.get(code) || { envases: 0, unidades: 0 };
            const reqEnvases = parseFloat(line.CANTIDADENVASES) || 0;
            const reqUnidades = parseFloat(line.CANTIDADUNIDADES) || 0;
            if (reqEnvases > 0 && reqEnvases > stock.envases) {
                const warning = {
                    product: code,
                    description: (line.DESCRIPCION || '').trim(),
                    requested: reqEnvases,
                    available: stock.envases,
                    unit: 'envases'
                };
                stockWarnings.push(warning);
                if (stock.envases <= 0) outOfStockProducts.push(code);
            }
            if (reqUnidades > 0 && reqUnidades > stock.unidades) {
                const warning = {
                    product: code,
                    description: (line.DESCRIPCION || '').trim(),
                    requested: reqUnidades,
                    available: stock.unidades,
                    unit: 'unidades'
                };
                stockWarnings.push(warning);
                if (stock.unidades <= 0 && reqEnvases <= 0) outOfStockProducts.push(code);
            }
        } catch (e) {
            logger.warn(`[PEDIDOS] Stock check failed for ${code}: ${e.message}`);
        }
    }

    // P0-C: BLOCK confirmation if stock would go negative (unless force-approved)
    if (stockWarnings.length > 0 && !effectiveForceConfirm) {
        // Fetch similar products for out-of-stock items
        let alternatives = [];
        for (const code of outOfStockProducts.slice(0, 5)) {
            try {
                const similar = await getSimilarProducts(code);
                if (similar.length > 0) {
                    alternatives.push({ product: code, alternatives: similar });
                }
            } catch (e) {
                logger.warn(`[PEDIDOS] getSimilarProducts error for ${code}: ${e.message}`);
            }
        }

        await revertConfirming('STOCK_INSUFICIENTE');
        return {
            blocked: true,
            reason: 'STOCK_INSUFICIENTE',
            stockWarnings,
            alternatives,
            message: `Stock insuficiente para ${stockWarnings.length} producto(s). Revisa las alternativas o elimina los productos sin stock.`
        };
    }

    // P0-B: Confirm + reserve in sequence, rollback estado if reserves fail
    const target = getPedidosConfirmationTarget();
    let syncResult = {
        targetSchema: 'JAVIER',
        syncStatus: 'LOCAL',
        synced: false,
        systemRef: { subempresa: ' ', ejercicio: 0, serie: ' ', terminal: 0, numero: 0 },
    };

    // Export confirmed order to ERP when required.
    if (target.shouldExportToSystem) {
        try {
            await withPedidosTransaction(async (conn) => {
                syncResult = await exportCommercialOrderToSystem(conn, {
                    header: currentRows[0],
                    lines,
                    deliveryPlan,
                    routeCode,
                    saleType: effectiveSaleType,
                    vehicleCode,
                    driverCode,
                    userId: options.userId,
                });
                const update = buildConfirmOrderUpdate({
                    id,
                    deliveryPlan,
                    vehicleCode,
                    driverCode,
                    routeCode,
                    saleType: effectiveSaleType,
                    syncResult,
                });
                await conn.query(update.sql, update.params);
                await replaceStockReservationLines((sql, params) => conn.query(sql, params), lines, id);
            });
            logger.info(`[PEDIDOS] Order #${id} exported to ${syncResult.targetSchema}.CPC and confirmed`);
        } catch (systemErr) {
            logger.error(`[PEDIDOS] System export failed for order #${id}: ${systemErr.message}${systemErr.odbcErrors ? ' ' + JSON.stringify(systemErr.odbcErrors) : ''}`);
            // El transaction interno ya hizo rollback de los inserts; revertimos
            // CONFIRMANDO -> BORRADOR para que el usuario pueda reintentar.
            await revertConfirming('SYSTEM_EXPORT_FAILED');
            throw new Error(`No se pudo pasar el pedido a sistema. No se ha confirmado. Error: ${systemErr.message}`);
        }
    } else {
        const update = buildConfirmOrderUpdate({
            id,
            deliveryPlan,
            vehicleCode,
            driverCode,
            routeCode,
            saleType: effectiveSaleType,
            syncResult,
        });
        await queryWithParams(update.sql, update.params, false);

        try {
            await replaceStockReservationLines((sql, params) => queryWithParams(sql, params, false), lines, id);
            logger.info(`[PEDIDOS] Stock reserved for order #${id}`);
        } catch (resErr) {
        logger.error(`[PEDIDOS] CRITICAL: Stock reservation failed for order #${id}, rolling back: ${resErr.message}`);
        // P0-B: Rollback order status if stock reservation fails after confirmation.
        try {
            await queryWithParams(
                `UPDATE ${ERP_SCHEMA}.PEDIDOS_CAB SET ESTADO = 'BORRADOR', UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?`,
                [id], false
            );
            await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?`, [id], false);
        } catch (rollbackErr) {
            logger.error(`[PEDIDOS] CRITICAL: Rollback also failed for order #${id}: ${rollbackErr.message}`);
        }
        throw new Error(`No se pudo completar la reserva de stock. El pedido no ha sido confirmado. Error: ${resErr.message}`);
    }
    }

    // P4-A: Invalidate stock and product cache to ensure real-time updates for all sales reps
    await invalidatePedidosStockCache('confirm');

    let order = await getOrderDetail(id);

    // AUD: Audit log for order confirmation
    try {
        const auditEntry = {
            event: 'ORDER_CONFIRMED',
            orderId: id,
            numeroPedido: order?.header?.numeroPedido,
            clientCode: order?.header?.clienteId,
            clientName: order?.header?.clienteNombre,
            vendedorCode: order?.header?.vendedor,
            total: order?.header?.total,
            saleType: effectiveSaleType || order?.header?.tipoventa,
            deliveryDate: deliveryPlan.date.iso,
            deliveryDays: deliveryPlan.allowedDays,
            vehicleCode,
            driverCode,
            routeCode,
            lineCount: lines.length,
            stockWarningCount: stockWarnings.length,
            forceConfirm: effectiveForceConfirm,
            userId: options.userId || 'SYSTEM'
        };
        logger.info(`[AUDIT] âœ… ORDER_CONFIRMED #${id} | Client:${auditEntry.clientCode} | Total:${auditEntry.total} | Lines:${lines.length}`);
    } catch (auditErr) { /* silent */ }

    // P0-BOLSA: Persist ledger after confirmation. Blocking: no silent success on write failure.
    const consumoAmount = Number(options._bolsaConsumo || 0);
    const acumulacionAmount = Number(options._bolsaAcumulacion || 0);
    if ((consumoAmount || acumulacionAmount) && !options.skipBolsaMovement) {
        try {
            const bolsaService = require('../bolsa-comercial.service');
            const lineMovements = Array.isArray(options._bolsaLineMovements) ? options._bolsaLineMovements : [];
            const consumoMovements = lineMovements.filter(m => m && m.tipo === 'CONSUMO');
            const acumulacionMovements = lineMovements.filter(m => m && m.tipo === 'ACUMULACION');
            if (consumoAmount) {
                const consumoResult = await bolsaService.consumirBolsa(vendedorCode, id, consumoAmount, consumoMovements.length ? consumoMovements : undefined);
                if (consumoResult && consumoResult.allowed === false) {
                    throw new Error('Bolsa insuficiente al registrar consumo. Deficit: ' + consumoResult.deficit);
                }
            }
            if (acumulacionAmount) {
                await bolsaService.acumularBolsa(vendedorCode, id, acumulacionAmount, acumulacionMovements.length ? acumulacionMovements : undefined);
            }
            order = await getOrderDetail(id);
        } catch (bolsaErr) {
            logger.error('[PEDIDOS] Bolsa movement failed for confirmed order #' + id + ': ' + bolsaErr.message);
            if (!target.shouldExportToSystem) {
                try {
                    await queryWithParams(
                        `UPDATE ${ERP_SCHEMA}.PEDIDOS_CAB
                            SET ESTADO = 'BORRADOR',
                                UPDATED_AT = CURRENT_TIMESTAMP
                          WHERE ID = ?
                            AND ESTADO IN ('CONFIRMANDO', 'CONFIRMADO')`,
                        [id],
                        false
                    );
                    logger.info(`[PEDIDOS] Pedido #${id} revertido a BORRADOR tras fallo de bolsa`);
                } catch (rollbackErr) {
                    logger.error('[PEDIDOS] Failed to rollback order state after bolsa error for #' + id + ': ' + rollbackErr.message);
                }
                try {
                    await queryWithParams(
                        DELETE_STOCK_RESERVE_BY_PEDIDO_SQL,
                        [id],
                        false
                    );
                } catch (cleanupErr) {
                    logger.error('[PEDIDOS] Failed to cleanup stock reservation after bolsa error for #' + id + ': ' + cleanupErr.message);
                }
            }
            const err = new Error('No se pudo registrar movimiento de bolsa. El pedido no se ha confirmado correctamente. Error: ' + bolsaErr.message);
            err.code = 'BOLSA_MOVEMENT_WRITE_FAILED';
            err.status = 500;
            throw err;
        }
    }

    // Invalida cache tras confirmacion (cambia ESTADO, importes y stock reservas).
    invalidatePedidosCache(id);

    return { ...order, stockWarnings };
}

async function cancelOrder(orderId, options = {}) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    const currentRows = await queryWithParams(
        `SELECT ESTADO, CODIGOCLIENTE, IMPORTETOTAL FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`,
        [id], false
    );

    if (!currentRows || currentRows.length === 0) {
        throw new OrderStateError('ORDER_NOT_FOUND', 'Pedido no encontrado', 404);
    }

    const currentState = canonicalOrderStatus(currentRows[0].ESTADO);

    if (currentState === 'CONFIRMADO') {
        throw new OrderStateError(
            'PEDIDO_MANAGED_BY_ERP',
            'El pedido confirmado ya lo gestiona el ERP',
            409,
        );
    }

    if (currentState !== 'BORRADOR') {
        throw new OrderStateError(
            'PEDIDO_INVALID_STATE',
            `Solo se pueden eliminar borradores (estado actual: ${currentState})`,
            409,
        );
    }

    const draftStateExists = `EXISTS (
              SELECT 1 FROM ${ERP_SCHEMA}.PEDIDOS_CAB C
               WHERE C.ID = ?
                 AND TRIM(C.ESTADO) IN ('BORRADOR', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION')
            )`;

    await queryWithParams(
        `DELETE FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ? AND ${draftStateExists}`,
        [id, id],
        false,
    )
        .catch(e => logger.warn(`[PEDIDOS] Stock reservation cleanup for draft #${id}: ${e.message}`));
    await queryWithParams(
        `DELETE FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE PEDIDO_ID = ? AND ${draftStateExists}`,
        [id, id],
        false,
    );

    const deleteResult = await queryWithParams(
        `DELETE FROM ${ERP_SCHEMA}.PEDIDOS_CAB
          WHERE ID = ?
            AND TRIM(ESTADO) IN ('BORRADOR', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION')`,
        [id], false
    );
    const deleteRowsAffected = (deleteResult && typeof deleteResult.count === 'number')
        ? deleteResult.count
        : (typeof deleteResult === 'number' ? deleteResult : null);

    if (deleteRowsAffected === 0) {
        const conflictRows = await queryWithParams(
            `SELECT ESTADO, CODIGOCLIENTE, IMPORTETOTAL FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`,
            [id], false
        );
        if (!conflictRows || conflictRows.length === 0) {
            await invalidatePedidosStockCache('draft_cancel_race');
            return { id, deleted: true, estado: 'BORRADOR' };
        }
        const conflictState = canonicalOrderStatus(conflictRows[0].ESTADO);
        throw new OrderStateError(
            'PEDIDO_STATE_CONFLICT',
            `No se pudo eliminar el borrador porque cambio de estado durante la operacion (estado actual: ${conflictState})`,
            409,
        );
    }

    await invalidatePedidosStockCache('draft_cancel');

    try {
        logger.info(`[AUDIT] ORDER_DRAFT_DELETED #${id} | Client:${currentRows[0].CODIGOCLIENTE || '?'} | Total:${currentRows[0].IMPORTETOTAL || 0} | By:${options.userId || 'SYSTEM'}`);
    } catch (auditErr) { /* silent */ }

    return { id, deleted: true, estado: 'BORRADOR' };
}
// ============================================================================
// ORDER STATUS UPDATE
// ============================================================================

async function updateOrderStatus(orderId, newStatus, options = {}) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    const rawRequestedStatus = trimString(newStatus).toUpperCase();
    if (rawRequestedStatus !== 'CONFIRMADO') {
        throw new OrderStateError(
            'INVALID_ORDER_STATUS',
            `Estado no valido: ${newStatus}`,
            400,
        );
    }

    const requestedStatus = canonicalOrderStatus(rawRequestedStatus);
    if (!ORDER_TRANSITIONS[requestedStatus]) {
        throw new OrderStateError(
            'INVALID_ORDER_STATUS',
            `Estado no valido: ${newStatus}`,
            400,
        );
    }

    const currentStatus = await getOrderStatusForUpdate(id);
    if (!isOrderTransitionAllowed(currentStatus, requestedStatus)) {
        throw new OrderStateError(
            'INVALID_ORDER_TRANSITION',
            `Transicion no permitida: ${currentStatus} -> ${requestedStatus}`,
            409,
        );
    }

    const status = storedOrderStatus(requestedStatus);

    // Get order info for audit before updating
    const orderBefore = { header: { estado: currentStatus } };

    await queryWithParams(
        `UPDATE ${ERP_SCHEMA}.PEDIDOS_CAB SET ESTADO = ?, UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?`,
        [status, id], false
    );

    // Invalidate cache
    try {
        if (redisCache && typeof redisCache.invalidatePattern === 'function') {
            // Las claves de cachedQuery viven bajo "gmp:query:query:pedidos:..."
            // (namespace "query" + prefijo "query" del CacheKeyGenerator).
            await redisCache.invalidatePattern('query:query:pedidos:*');
        }
    } catch (e) {
        logger.warn(`[PEDIDOS] Failed to invalidate cache: ${e.message}`);
    }

    // AUD: Audit log
    try {
        logger.info(`[AUDIT] ðŸ”„ ORDER_STATUS_CHANGED #${id} | ${orderBefore?.header?.estado || '?'} -> ${status} | By:${options.userId || 'SYSTEM'}`);
    } catch (auditErr) { /* silent */ }

    return getOrderDetail(id);
}

// ============================================================================
// ORDER STATS
// ============================================================================

async function getOrderStats(vendedorCodes, dateFrom, dateTo) {
    const whereParts = [];
    const params = [];
    let hasDateBounds = false;

    if (vendedorCodes && vendedorCodes.trim().toUpperCase() !== 'ALL') {
        const codes = vendedorCodes.split(',').map(c => c.trim()).filter(Boolean);
        // DB2 ODBC limit on parameter markers; 50+ vendors can exceed it.
        if (codes.length > 50) {
            // no vendor filter
        } else if (codes.length === 1) {
            whereParts.push('TRIM(CODIGOVENDEDOR) = ?');
            params.push(codes[0]);
        } else {
            whereParts.push(`TRIM(CODIGOVENDEDOR) IN (${codes.map(() => '?').join(',')})`);
            params.push(...codes);
        }
    }

    if (dateFrom) {
        const df = String(dateFrom).replace(/-/g, '');
        if (df.length === 8) {
            const y = parseInt(df.substring(0, 4));
            const m = parseInt(df.substring(4, 6));
            const d = parseInt(df.substring(6, 8));
            whereParts.push('(ANODOCUMENTO > ? OR (ANODOCUMENTO = ? AND MESDOCUMENTO > ?) OR (ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO >= ?))');
            params.push(y, y, m, y, m, d);
            hasDateBounds = true;
        }
    }
    if (dateTo) {
        const dt = String(dateTo).replace(/-/g, '');
        if (dt.length === 8) {
            const y = parseInt(dt.substring(0, 4));
            const m = parseInt(dt.substring(4, 6));
            const d = parseInt(dt.substring(6, 8));
            whereParts.push('(ANODOCUMENTO < ? OR (ANODOCUMENTO = ? AND MESDOCUMENTO < ?) OR (ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO <= ?))');
            params.push(y, y, m, y, m, d);
            hasDateBounds = true;
        }
    }

    if (!hasDateBounds) {
        whereParts.push('ANODOCUMENTO = ?');
        params.push(new Date().getFullYear());
    }

    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const statsSql = `
        SELECT
            COUNT(*) AS TOTALORDERS,
            COALESCE(SUM(IMPORTETOTAL), 0) AS TOTALAMOUNT,
            COALESCE(SUM(IMPORTEBASE), 0) AS TOTALBASE,
            COALESCE(SUM(IMPORTEIVA), 0) AS TOTALIVA,
            CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(IMPORTEMARGEN) * 100.0 / NULLIF(SUM(IMPORTEBASE), 0), 0) ELSE 0 END AS AVGMARGIN,
            CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(IMPORTETOTAL) * 1.0 / COUNT(*), 0) ELSE 0 END AS AVGTICKET
        FROM ${ERP_SCHEMA}.PEDIDOS_CAB ${where}`;

    const statusSql = `
        SELECT TRIM(ESTADO) AS ESTADO, COUNT(*) AS CNT
        FROM ${ERP_SCHEMA}.PEDIDOS_CAB ${where}
        GROUP BY ESTADO
        ORDER BY ESTADO`;

    const trendSql = `
        SELECT ANODOCUMENTO AS Y, MESDOCUMENTO AS M, DIADOCUMENTO AS D,
            COUNT(*) AS ORDERS, COALESCE(SUM(IMPORTETOTAL), 0) AS AMOUNT
        FROM ${ERP_SCHEMA}.PEDIDOS_CAB ${where ? where + ' AND' : 'WHERE'} ANODOCUMENTO > 0
        GROUP BY ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
        FETCH FIRST 7 ROWS ONLY`;

    const topSql = `
        SELECT TRIM(CODIGOCLIENTE) AS CODE, TRIM(NOMBRECLIENTE) AS NAME,
            COUNT(*) AS ORDERS, COALESCE(SUM(IMPORTETOTAL), 0) AS AMOUNT
        FROM ${ERP_SCHEMA}.PEDIDOS_CAB ${where ? where + ' AND' : 'WHERE'} CODIGOCLIENTE <> ''
        GROUP BY CODIGOCLIENTE, NOMBRECLIENTE
        ORDER BY AMOUNT DESC
        FETCH FIRST 5 ROWS ONLY`;

    try {
        const [statsRows, statusRows, trendRows, topRows] = await Promise.all([
            queryWithParams(statsSql, params).catch(e => { logger.warn(`[PEDIDOS] stats err: ${e.message}`); return []; }),
            queryWithParams(statusSql, params).catch(e => { logger.warn(`[PEDIDOS] status err: ${e.message}`); return []; }),
            queryWithParams(trendSql, params).catch(e => { logger.warn(`[PEDIDOS] trend err: ${e.message}`); return []; }),
            queryWithParams(topSql, params).catch(e => { logger.warn(`[PEDIDOS] top err: ${e.message}`); return []; }),
        ]);

        const stats = statsRows[0] || {};
        const byStatus = {};
        for (const s of (statusRows || [])) {
            const status = publicOrderStatus(s.ESTADO);
            byStatus[status] = (byStatus[status] || 0) + (parseInt(s.CNT) || 0);
        }

        const dailyTrend = (trendRows || []).map(r => ({
            date: `${String(r.Y).padStart(4, '0')}-${String(r.M).padStart(2, '0')}-${String(r.D).padStart(2, '0')}`,
            orders: parseInt(r.ORDERS) || 0,
            amount: parseFloat(r.AMOUNT) || 0,
        })).reverse();

        const topClients = (topRows || []).map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            orders: parseInt(r.ORDERS) || 0,
            amount: parseFloat(r.AMOUNT) || 0,
        }));

        return {
            totalOrders: parseInt(stats.TOTALORDERS) || 0,
            totalAmount: parseFloat(stats.TOTALAMOUNT) || 0,
            totalBase: parseFloat(stats.TOTALBASE) || 0,
            totalIva: parseFloat(stats.TOTALIVA) || 0,
            avgMargin: parseFloat(stats.AVGMARGIN) || 0,
            avgTicket: parseFloat(stats.AVGTICKET) || 0,
            byStatus,
            dailyTrend,
            topClients,
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getOrderStats error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// ORDER ALBARAN LOOKUP
// ============================================================================

async function getOrderAlbaran(orderId) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    const orderRows = await queryWithParams(
        `SELECT CODIGOCLIENTE, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO,
                EJERCICIO, SERIEPEDIDO, TERMINAL, NUMEROPEDIDO,
                SYSTEM_SUBEMPRESAPEDIDO, SYSTEM_EJERCICIOPEDIDO, SYSTEM_SERIEPEDIDO,
                SYSTEM_TERMINALPEDIDO, SYSTEM_NUMEROPEDIDO
         FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`,
        [id]
    );
    if (!orderRows || orderRows.length === 0) throw new Error('Pedido no encontrado');

    const order = orderRows[0];
    const systemNumero = integerValue(order.SYSTEM_NUMEROPEDIDO);
    const pedidoRef = {
        subempresa: truncate(order.SYSTEM_SUBEMPRESAPEDIDO || getPedidosConfirmationTarget().subempresa, 3),
        ejercicio: systemNumero > 0 ? integerValue(order.SYSTEM_EJERCICIOPEDIDO) : integerValue(order.EJERCICIO),
        serie: truncate(systemNumero > 0 ? order.SYSTEM_SERIEPEDIDO : order.SERIEPEDIDO, 1) || 'P',
        terminal: systemNumero > 0 ? integerValue(order.SYSTEM_TERMINALPEDIDO) : integerValue(order.TERMINAL),
        numero: systemNumero > 0 ? systemNumero : integerValue(order.NUMEROPEDIDO),
    };

    const albaranSql = `
        SELECT COALESCE(C.NUMEROALBARAN, P.NUMEROALBARAN) AS NUMEROALBARAN,
               TRIM(COALESCE(C.SERIEALBARAN, P.SERIEALBARAN)) AS SERIEALBARAN,
               COALESCE(C.TERMINALALBARAN, P.TERMINALALBARAN) AS TERMINALALBARAN,
               COALESCE(C.EJERCICIOALBARAN, P.EJERCICIOALBARAN) AS EJERCICIOALBARAN,
               COALESCE(C.DIADOCUMENTO, P.DIADOCUMENTO) AS DIADOCUMENTO,
               COALESCE(C.MESDOCUMENTO, P.MESDOCUMENTO) AS MESDOCUMENTO,
               COALESCE(C.ANODOCUMENTO, P.ANODOCUMENTO) AS ANODOCUMENTO,
               TRIM(COALESCE(C.CODIGOCLIENTEALBARAN, P.CODIGOCLIENTEALBARAN)) AS CODIGOCLIENTE,
               COALESCE(C.IMPORTETOTAL, P.IMPORTETOTAL, 0) AS IMPORTEALBARAN,
               TRIM(COALESCE(C.SITUACIONALBARAN, P.SITUACIONPEDIDO, '')) AS SITUACION,
               TRIM(COALESCE(C.ESTADOENVIO, '')) AS ESTADOENVIO,
               COALESCE(C.NUMEROFACTURA, 0) AS NUMEROFACTURA,
               TRIM(COALESCE(C.SERIEFACTURA, '')) AS SERIEFACTURA,
               COALESCE(C.EJERCICIOFACTURA, 0) AS EJERCICIOFACTURA
          FROM DSEDAC.CPC P
          LEFT JOIN DSEDAC.CAC C
            ON C.EJERCICIOALBARAN = P.EJERCICIOALBARAN
           AND TRIM(C.SERIEALBARAN) = TRIM(P.SERIEALBARAN)
           AND C.TERMINALALBARAN = P.TERMINALALBARAN
           AND C.NUMEROALBARAN = P.NUMEROALBARAN
         WHERE TRIM(P.SUBEMPRESAPEDIDO) = ?
           AND P.EJERCICIOPEDIDO = ?
           AND TRIM(P.SERIEPEDIDO) = ?
           AND P.TERMINALPEDIDO = ?
           AND P.NUMEROPEDIDO = ?
         ORDER BY COALESCE(C.ANODOCUMENTO, P.ANODOCUMENTO) DESC,
                  COALESCE(C.MESDOCUMENTO, P.MESDOCUMENTO) DESC,
                  COALESCE(C.DIADOCUMENTO, P.DIADOCUMENTO) DESC
         FETCH FIRST 5 ROWS ONLY`;

    try {
        const rows = await queryWithParams(albaranSql, [
            pedidoRef.subempresa,
            pedidoRef.ejercicio,
            pedidoRef.serie,
            pedidoRef.terminal,
            pedidoRef.numero,
        ]);
        return (rows || [])
            .filter(r => integerValue(r.NUMEROALBARAN) > 0)
            .map(r => {
                const numeroAlbaran = integerValue(r.NUMEROALBARAN);
                const serieAlbaran = (r.SERIEALBARAN || '').trim();
                const terminalAlbaran = integerValue(r.TERMINALALBARAN);
                const ejercicioAlbaran = integerValue(r.EJERCICIOALBARAN);
                const numeroFactura = integerValue(r.NUMEROFACTURA);
                const serieFactura = (r.SERIEFACTURA || '').trim();
                const ejercicioFactura = integerValue(r.EJERCICIOFACTURA);
                const hasFactura = numeroFactura > 0 && serieFactura && ejercicioFactura > 0;
                return {
                    numeroAlbaran,
                    serie: serieAlbaran,
                    terminal: terminalAlbaran,
                    ejercicio: ejercicioAlbaran,
                    fecha: `${String(r.DIADOCUMENTO).padStart(2, '0')}/${String(r.MESDOCUMENTO).padStart(2, '0')}/${r.ANODOCUMENTO}`,
                    situacion: (r.SITUACION || '').trim(),
                    estadoEnvio: (r.ESTADOENVIO || '').trim(),
                    importe: parseFloat(r.IMPORTEALBARAN) || 0,
                    numeroFactura,
                    serieFactura,
                    ejercicioFactura,
                    documentType: hasFactura ? 'factura' : 'albaran',
                    documentLabel: hasFactura ? 'Factura' : 'Albaran',
                    albaranRef: `${serieAlbaran}-${String(terminalAlbaran).padStart(3, '0')}-${String(numeroAlbaran).padStart(6, '0')}`,
                    facturaRef: hasFactura ? `${serieFactura}-${String(numeroFactura).padStart(6, '0')}` : '',
                    albaranPdfAvailable: numeroAlbaran > 0 && serieAlbaran && terminalAlbaran > 0 && ejercicioAlbaran > 0,
                    facturaPdfAvailable: hasFactura,
                };
            });
    } catch (error) {
        logger.warn(`[PEDIDOS] getOrderAlbaran: ${error.message}`);
        return [];
    }
}

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

async function getRecommendations(clientCode, vendedorCode) {
    if (!clientCode) throw new Error('clientCode is required');

    const trimClient = truncate(clientCode, 10);
    const trimVendor = truncate((vendedorCode || '').split(',')[0], 2);

    // Strategy 1: Client purchase history (last 12 months)
    // FIX 2026-05-15: ampliamos las metricas devueltas porque la UI mostraba
    // "0 cajas" para muchos productos:
    //  - Antes solo se devolvia SUM(CANTIDADUNIDADES). Para muchos productos
    //    LINDTO guarda la cantidad en CANTIDADENVASES, no en CANTIDADUNIDADES,
    //    y por eso salia 0.
    //  - Ahora devolvemos AMBOS campos sumados (envases + unidades) y ademas
    //    el promedio por compra y el importe total, para que la UI pueda
    //    mostrar "X cajas" o "X unidades" segun la metrica que tenga datos.
    const historySql = `
        SELECT TRIM(L.CODIGOARTICULO) AS code,
            TRIM(L.DESCRIPCION) AS name,
            COUNT(*) AS frequency,
            COALESCE(SUM(L.CANTIDADUNIDADES), 0) AS totalUnits,
            COALESCE(SUM(L.CANTIDADENVASES), 0) AS totalEnvases,
            COALESCE(SUM(L.IMPORTEVENTA), 0) AS totalAmount,
            COALESCE(AVG(L.CANTIDADENVASES), 0) AS avgEnvases,
            MAX(L.ANODOCUMENTO * 10000 + L.MESDOCUMENTO * 100 + L.DIADOCUMENTO) AS lastPurchase
        FROM DSEDAC.LINDTO L
        WHERE TRIM(L.CODIGOCLIENTEALBARAN) = CAST(? AS VARCHAR(10))
          AND L.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 1
          AND L.TIPOVENTA IN ('CC', 'VC')
          AND L.CLASELINEA IN ('AB', 'VT')
          AND L.SERIEALBARAN NOT IN ('N', 'Z')
        GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
        ORDER BY frequency DESC
        FETCH FIRST 20 ROWS ONLY`;

    let history = [];
    try {
        const historyRows = await queryWithParams(historySql, [trimClient]);
        history = (historyRows || []).map(r => {
            const totalUnits = parseFloat(r.TOTALUNITS) || 0;
            const totalEnvases = parseFloat(r.TOTALENVASES) || 0;
            const totalAmount = parseFloat(r.TOTALAMOUNT) || 0;
            const avgEnvases = parseFloat(r.AVGENVASES) || 0;
            // "suggestedUnits" = la metrica que tiene datos (preferimos envases)
            // para que la UI muestre algo sensato y NO "0 cajas".
            const suggestedUnits = avgEnvases > 0
                ? avgEnvases
                : (totalEnvases > 0 ? totalEnvases : totalUnits);
            return {
                code: (r.CODE || '').trim(),
                name: (r.NAME || '').trim(),
                frequency: parseInt(r.FREQUENCY) || 0,
                totalUnits,
                totalEnvases,
                totalAmount,
                avgEnvases,
                suggestedUnits,
                lastPurchase: r.LASTPURCHASE,
                source: 'history',
            };
        });
    } catch (error) {
        logger.error(`[PEDIDOS] getRecommendations history error: ${error.message}`);
    }

    // Strategy 2: Similar clients (only if vendor is provided)
    let similar = [];
    if (trimVendor) {
        // Handle multi-vendor codes (comma-separated); use first code only
        // CODIGOVENDEDOR is CHAR(2), can't hold the full comma string
        const similarSql = `
            SELECT TRIM(L.CODIGOARTICULO) AS code,
                TRIM(L.DESCRIPCION) AS name,
                COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) AS clientCount
            FROM DSEDAC.LINDTO L
            WHERE TRIM(L.CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
              AND L.ANODOCUMENTO = YEAR(CURRENT_DATE)
              AND L.TIPOVENTA IN ('CC', 'VC')
              AND L.CLASELINEA IN ('AB', 'VT')
              AND L.SERIEALBARAN NOT IN ('N', 'Z')
              AND NOT EXISTS (
                  SELECT 1 FROM DSEDAC.LINDTO L2
                  WHERE L2.CODIGOARTICULO = L.CODIGOARTICULO
                    AND TRIM(L2.CODIGOCLIENTEALBARAN) = CAST(? AS VARCHAR(10))
                    AND (L2.ANODOCUMENTO * 12 + L2.MESDOCUMENTO)
                        >= (YEAR(CURRENT_DATE) * 12 + MONTH(CURRENT_DATE) - 3)
              )
            GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
            HAVING COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) >= 3
            ORDER BY clientCount DESC
            FETCH FIRST 10 ROWS ONLY`;
        try {
            const similarRows = await queryWithParams(similarSql, [trimVendor, trimClient]);
            similar = (similarRows || []).map(r => ({
                code: (r.CODE || '').trim(),
                name: (r.NAME || '').trim(),
                clientCount: parseInt(r.CLIENTCOUNT) || 0,
                source: 'similar',
            }));
        } catch (error) {
            logger.error(`[PEDIDOS] getRecommendations similar error: ${error.message}`);
        }
    }

    // Exclude already selected products from fallback recommendations.
    const allCodes = [
        ...history.map(h => h.code),
        ...similar.map(s => s.code),
    ]
        .map((code) => truncate(code, 10))
        .filter(Boolean);

    if (allCodes.length > 0) {
        try {
            const placeholders = allCodes.map(() => 'CAST(? AS VARCHAR(10))').join(',');
            const enrichSql = `
                SELECT
                    TRIM(A.CODIGOARTICULO) AS CODE,
                    TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                    TRIM(A.CODIGOFAMILIA) AS FAMILY,
                    TRIM(A.CODIGOMARCA) AS BRAND,
                    A.UNIDADESCAJA AS UNITSPERBOX,
                    A.UNIDADESFRACCION AS UNITSFRACTION,
                    TRIM(A.UNIDADMEDIDA) AS UNITMEASURE,
                    COALESCE(S.ENVASES_DISP, 0) AS STOCKENVASES,
                    COALESCE(S.UNIDADES_DISP, 0) AS STOCKUNIDADES,
                    COALESCE(T1.PRECIOTARIFA, 0) AS PRECIOTARIFA1,
                    COALESCE(T2.PRECIOTARIFA, 0) AS PRECIOMINIMO,
                    COALESCE(TC.PRECIOTARIFA, 0) AS PRECIOCLIENTE
                FROM DSEDAC.ART A
                LEFT JOIN (
                    SELECT CODIGOARTICULO,
                        SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                        SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                    FROM DSEDAC.ARO WHERE CODIGOALMACEN = 1
                    GROUP BY CODIGOARTICULO
                ) S ON A.CODIGOARTICULO = S.CODIGOARTICULO
                LEFT JOIN DSEDAC.ARA T1 ON A.CODIGOARTICULO = T1.CODIGOARTICULO AND T1.CODIGOTARIFA = 1
                LEFT JOIN DSEDAC.ARA T2 ON A.CODIGOARTICULO = T2.CODIGOARTICULO AND T2.CODIGOTARIFA = 2
                LEFT JOIN DSEDAC.ARA TC ON A.CODIGOARTICULO = TC.CODIGOARTICULO
                    AND TC.CODIGOTARIFA = (
                        SELECT CLC.CODIGOTARIFA FROM DSEDAC.CLC CLC
                        WHERE TRIM(CLC.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
                        FETCH FIRST 1 ROW ONLY
                    )
                WHERE TRIM(A.CODIGOARTICULO) IN (${placeholders})
                  AND A.ANOBAJA = 0`;
            const enrichParams = [trimClient, ...allCodes];
            const enrichRows = await queryWithParams(enrichSql, enrichParams);
            const enrichMap = {};
            for (const r of enrichRows) {
                const code = (r.CODE || '').trim();
                enrichMap[code] = {
                    name: (r.NAME || '').trim(),
                    family: (r.FAMILY || '').trim(),
                    brand: (r.BRAND || '').trim(),
                    unitsPerBox: parseFloat(r.UNITSPERBOX) || 0,
                    unitsFraction: parseFloat(r.UNITSFRACTION) || 0,
                    unitMeasure: (r.UNITMEASURE || '').trim(),
                    stockEnvases: parseFloat(r.STOCKENVASES) || 0,
                    stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
                    precioTarifa1: parseFloat(r.PRECIOTARIFA1) || 0,
                    precioMinimo: parseFloat(r.PRECIOMINIMO) || 0,
                    precioCliente: parseFloat(r.PRECIOCLIENTE) || 0,
                };
            }
            history = history.map(h => ({ ...h, ...(enrichMap[h.code] || {}) }));
            similar = similar.map(s => ({ ...s, ...(enrichMap[s.code] || {}) }));
        } catch (enrichErr) {
            logger.warn(`[PEDIDOS] getRecommendations enrichment error: ${enrichErr.message}`);
        }
    }

    return { clientHistory: history, similarClients: similar };
}

// ============================================================================
// FAMILIES & BRANDS
// ============================================================================

async function getFamilies() {
    // Req #14: incluir prefamilia para agrupaciones tipo "Nestle".
    // Se devuelven tanto codigo simple (compat) como objeto completo cuando el caller
    // lo requiere via getFamiliesDetailed().
    const sql = `SELECT DISTINCT TRIM(CODIGOFAMILIA) AS CODE FROM DSEDAC.ART WHERE ANOBAJA = 0 AND CODIGOFAMILIA != '' ORDER BY 1`;
    const cacheKey = 'pedidos:families';

    try {
        const rows = await cachedQuery((sql) => query(sql), sql, cacheKey, TTL.SHORT);
        return rows.map(r => (r.CODE || '').trim()).filter(Boolean);
    } catch (error) {
        logger.error(`[PEDIDOS] getFamilies error: ${error.message}`);
        throw error;
    }
}

/**
 * Req #14: Detalle de familias con prefamilia, para que el frontend pueda
 * agrupar dinamicamente (ej.: chip "Nestle" suma todas las familias cuya
 * prefamilia comience por NESTL%, etc.).
 */
async function getFamiliesDetailed() {
    const sql = `
        SELECT
            TRIM(A.CODIGOFAMILIA) AS CODE,
            COALESCE(MAX(TRIM(F.DESCRIPCIONFAMILIA)), MIN(TRIM(A.CODIGOFAMILIA))) AS NAME,
            COALESCE(MAX(TRIM(A.CODIGOPREFAMILIA)), '') AS PREFAMILY,
            COUNT(*) AS ART_COUNT
        FROM DSEDAC.ART A
        LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA
        WHERE (A.ANOBAJA = 0 OR A.ANOBAJA IS NULL)
          AND A.CODIGOFAMILIA <> ''
        GROUP BY TRIM(A.CODIGOFAMILIA)
        ORDER BY NAME
    `;
    const cacheKey = 'pedidos:families:detailed';
    try {
        const rows = await cachedQuery((sql) => query(sql), sql, cacheKey, TTL.SHORT);
        return rows.map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || r.CODE || '').trim(),
            prefamily: (r.PREFAMILY || '').trim(),
            artCount: Number(r.ART_COUNT) || 0,
            isNestle: /NESTL/i.test(String(r.PREFAMILY || '')),
        })).filter(f => f.code);
    } catch (error) {
        logger.warn(`[PEDIDOS] getFamiliesDetailed error (returning []): ${error.message}`);
        return [];
    }
}

async function getBrands() {
    const sql = `SELECT DISTINCT TRIM(CODIGOMARCA) AS CODE FROM DSEDAC.ART WHERE ANOBAJA = 0 AND CODIGOMARCA != '' ORDER BY 1`;
    const cacheKey = 'pedidos:brands';

    try {
        const rows = await cachedQuery((sql) => query(sql), sql, cacheKey, TTL.SHORT);
        return rows.map(r => (r.CODE || '').trim()).filter(Boolean);
    } catch (error) {
        logger.error(`[PEDIDOS] getBrands error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// Req #8: DRAFT ACCUMULATION CONTROL
// ============================================================================
/**
 * Si un comercial acumula >= threshold borradores, devuelve la lista de
 * borradores y opcionalmente auto-confirma el mas antiguo. Se disena como
 * funcion pura (lectura) por defecto; el caller (route POST /pedidos)
 * decide si invocar la auto-confirmacion pasando `autoConfirm: true`.
 */
async function checkDraftAccumulation(vendedorCode, { autoConfirm = false, threshold = 3, options = {} } = {}) {
    const code = truncate(vendedorCode, 2);
    if (!code) return { warning: false, drafts: [] };

    let drafts = [];
    try {
        drafts = await queryWithParams(
            `SELECT ID, NUMEROPEDIDO, TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE,
                    TRIM(NOMBRECLIENTE) AS NOMBRECLIENTE, IMPORTETOTAL, CREATED_AT
             FROM ${ERP_SCHEMA}.PEDIDOS_CAB
             WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
               AND TRIM(ESTADO) = 'BORRADOR'
             ORDER BY ID ASC`,
            [code],
            false,
        );
    } catch (err) {
        logger.warn(`[PEDIDOS] checkDraftAccumulation read error: ${err.message}`);
        return { warning: false, drafts: [], error: err.message };
    }

    if (!drafts || drafts.length < threshold) {
        return { warning: false, drafts: drafts || [], count: (drafts || []).length };
    }

    const oldest = drafts[0];
    if (!autoConfirm) {
        return {
            warning: true,
            count: drafts.length,
            threshold,
            oldestId: oldest.ID,
            oldestNumber: oldest.NUMEROPEDIDO,
            message: `Tienes ${drafts.length} borradores acumulados. Se recomienda confirmar el mas antiguo (#${oldest.NUMEROPEDIDO}).`,
            drafts,
        };
    }

    // Auto-confirm path (opt-in): seguro con try/catch que NO bloquea creacion
    try {
        await confirmOrder(oldest.ID, 'CC', {
            ...options,
            userId: options.userId || 'AUTO_DRAFT_GUARD',
            forceConfirm: true,
        });
        logger.warn(`[PEDIDOS] Auto-confirmed draft #${oldest.NUMEROPEDIDO} (id=${oldest.ID}) por acumulacion (${drafts.length})`);
        return {
            warning: true,
            autoConfirmed: true,
            autoConfirmedId: oldest.ID,
            autoConfirmedNumber: oldest.NUMEROPEDIDO,
            count: drafts.length,
            message: `Tenias ${drafts.length} borradores. El mas antiguo (#${oldest.NUMEROPEDIDO}) se ha confirmado automaticamente.`,
            drafts,
        };
    } catch (confirmErr) {
        logger.error(`[PEDIDOS] checkDraftAccumulation auto-confirm failed for #${oldest.NUMEROPEDIDO}: ${confirmErr.message}`);
        return {
            warning: true,
            autoConfirmed: false,
            autoConfirmError: confirmErr.message,
            count: drafts.length,
            oldestId: oldest.ID,
            oldestNumber: oldest.NUMEROPEDIDO,
            drafts,
            message: `${drafts.length} borradores acumulados. No se pudo auto-confirmar el mas antiguo (${confirmErr.code || confirmErr.message}).`,
        };
    }
}

// Cache de descubrimiento: tabla fuente + columnas presentes.
let _promoSource = null; // { table: 'PRD'|'PMR'|'NONE', cols: Set<string> }

function promotionsQualifiedTable(tableName) {
    const normalized = String(tableName || '').trim().toUpperCase();
    if (!PROMOTION_SOURCE_TABLES.has(normalized)) {
        throw new Error(`Tabla de promociones no permitida: ${normalized || '(vacia)'}`);
    }
    return db2QualifiedTable(PROMOTIONS_SCHEMA, normalized);
}

async function detectPromoSource() {
    if (_promoSource) return _promoSource;
    const candidates = ['PRD', 'PMR'];
    for (const t of candidates) {
        try {
            const cols = await queryWithParams(
                `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [PROMOTIONS_SCHEMA, t], false, false
            );
            if (Array.isArray(cols) && cols.length > 0) {
                const set = new Set(cols.map(c => String(c.COLUMN_NAME || '').trim().toUpperCase()));
                _promoSource = { table: t, cols: set };
                logger.info(`[PEDIDOS] Tabla de promociones detectada: ${promotionsQualifiedTable(t)} (${set.size} cols)`);
                return _promoSource;
            }
        } catch (_) { /* sigue probando */ }
    }
    _promoSource = { table: 'NONE', cols: new Set() };
    logger.warn(`[PEDIDOS] Ninguna tabla de promociones (PRD/PMR) existe en ${PROMOTIONS_SCHEMA}. Promociones desactivadas.`);
    return _promoSource;
}

async function getActivePromotions(clientCode) {
    try {
        const trimmedClientCode = String(clientCode || '').trim();
        if (!trimmedClientCode) return [];

        const src = await detectPromoSource();
        if (src.table === 'NONE') return [];

        const now = new Date();
        const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

        // â”€â”€ PMR schema: gift promotions (client-specific, no product-level data) â”€â”€
        if (src.table === 'PMR') {
            return getActivePromotionsPMR(trimmedClientCode, today);
        }

        // â”€â”€ PRD schema: product-level price promotions (original logic) â”€â”€
        const promotionsTable = promotionsQualifiedTable(src.table);
        const has = (col) => src.cols.has(col);

        const colArticulo  = has('CODIGOARTICULO') ? 'P.CODIGOARTICULO' : (has('CDARTICULO') ? 'P.CDARTICULO' : `''`);
        const colDescrip   = has('DESCRIPCION')    ? 'P.DESCRIPCION'    : (has('DESCRIPCIONPROMOCION') ? 'P.DESCRIPCIONPROMOCION' : `''`);
        const colTipo      = has('TIPOPROMOCION')  ? 'P.TIPOPROMOCION'  : `''`;
        const colPrecio    = has('PRECIOPROMOCIONAL') ? 'P.PRECIOPROMOCIONAL' : (has('PRECIO') ? 'P.PRECIO' : '0');
        const colCantMin   = has('CANTIDADMINIMA') ? 'P.CANTIDADMINIMA' : (has('CTMINIMA') ? 'P.CTMINIMA' : '0');
        const colCantReg   = has('CANTIDADREGALO') ? 'P.CANTIDADREGALO' : (has('CTREGALO') ? 'P.CTREGALO' : '0');
        const colAcum      = has('ACUMULABLESN')   ? 'P.ACUMULABLESN'   : `'N'`;
        const colDiaDesde  = has('DIADESDE')       ? 'P.DIADESDE'       : '1';
        const colMesDesde  = has('MESDESDE')       ? 'P.MESDESDE'       : '1';
        const colAnoDesde  = has('ANODESDE')       ? 'P.ANODESDE'       : '2000';
        const colDiaHasta  = has('DIAHASTA')       ? 'P.DIAHASTA'       : '31';
        const colMesHasta  = has('MESHASTA')       ? 'P.MESHASTA'       : '12';
        const colAnoHasta  = has('ANOHASTA')       ? 'P.ANOHASTA'       : '9999';

        const hasDateRange = has('ANOHASTA') && has('ANODESDE');

        const sql = `
            SELECT ${colArticulo} AS CODIGOARTICULO,
                   ${colDescrip}  AS DESCRIPCION,
                   ${colTipo}     AS TIPOPROMOCION,
                   ${colPrecio}   AS PRECIOPROMOCIONAL,
                   ${colDiaDesde} AS DIADESDE,
                   ${colMesDesde} AS MESDESDE,
                   ${colAnoDesde} AS ANODESDE,
                   ${colDiaHasta} AS DIAHASTA,
                   ${colMesHasta} AS MESHASTA,
                   ${colAnoHasta} AS ANOHASTA,
                   ${colCantMin}  AS CANTIDADMINIMA,
                   ${colCantReg}  AS CANTIDADREGALO,
                   ${colAcum}     AS ACUMULABLESN,
                   A.DESCRIPCIONARTICULO AS NOMBRE_ARTICULO,
                   COALESCE(AR.STOCKACTUAL, 0) AS STOCK_ENVASES,
                   0 AS STOCK_UNIDADES
            FROM ${promotionsTable} P
            LEFT JOIN DSEDAC.ART A ON ${colArticulo} = A.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARO AR ON ${colArticulo} = AR.CODIGOARTICULO AND AR.CODIGOALMACEN = 1
            ${hasDateRange
              ? `WHERE (${colAnoHasta} * 10000 + ${colMesHasta} * 100 + ${colDiaHasta}) >= ?
                   AND (${colAnoDesde} * 10000 + ${colMesDesde} * 100 + ${colDiaDesde}) <= ?`
              : ''}
            FETCH FIRST 200 ROWS ONLY
        `;

        let rows = [];
        try {
            rows = hasDateRange
                ? await queryWithParams(sql, [today, today])
                : await queryWithParams(sql, [], []);
            logger.info(`[PEDIDOS] Promociones activas hoy=${today}: ${rows?.length || 0} fila(s) desde ${promotionsTable}`);
            if (!rows || rows.length === 0) {
                try {
                    const probe = await queryWithParams(`SELECT COUNT(*) AS TOTAL FROM ${promotionsTable}`, [], false, false);
                    const total = parseInt(probe?.[0]?.TOTAL) || 0;
                    logger.info(`[PEDIDOS] ${promotionsTable} total filas=${total}; vigentes hoy=0`);
                } catch (_) { /* ok */ }
            }
        } catch (e) {
            logger.warn(`[PEDIDOS] Query promociones ${promotionsTable} fallo: ${e.message}`);
            return [];
        }

        return (rows || []).map(r => ({
            code: String(r.CODIGOARTICULO || '').trim(),
            name: String(r.NOMBRE_ARTICULO || r.DESCRIPCION || '').trim(),
            promoDesc: String(r.DESCRIPCION || '').trim(),
            promoType: (parseFloat(r.CANTIDADREGALO) || 0) > 0 ? 'GIFT' : 'PRICE',
            promoPrice: parseFloat(r.PRECIOPROMOCIONAL) || 0,
            minQty: parseFloat(r.CANTIDADMINIMA) || 0,
            giftQty: parseFloat(r.CANTIDADREGALO) || 0,
            stackable: String(r.ACUMULABLESN || '').trim() === 'S',
            stockEnvases: parseFloat(r.STOCK_ENVASES) || 0,
            stockUnidades: parseFloat(r.STOCK_UNIDADES) || 0,
        }));
    } catch (error) {
        logger.warn('[PEDIDOS] getActivePromotions error (returning []): ' + error.message);
        return [];
    }
}

/**
 * Query promociones de regalo desde DSEDAC.PMR.
 * PMR es una tabla de cabecera: cada fila = una promocion regalo para un cliente especifico.
 * No tiene datos a nivel de producto; el nombre de la promocion describe la oferta.
 */
async function getActivePromotionsPMR(clientCode, today) {
    // Filtrar por cliente y rango de fechas (0 = sin limite)
    const sql = `
        SELECT
            TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO_CODE,
            TRIM(P.NOMBREPROMOCIONREGALO) AS PROMO_NAME,
            P.DIAINICIO, P.MESINICIO, P.ANOINICIO,
            P.DIAFIN, P.MESFIN, P.ANOFIN,
            P.CANTIDADMINIMAPROMOCION,
            P.CANTIDADMAXIMAREGALO,
            P.PROMOCIONACUMULATIVASN
        FROM DSEDAC.PMR P
        WHERE TRIM(P.CODIGOCLIENTE) = ?
          AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
          AND (P.ANOFIN = 0 OR (P.ANOFIN * 10000 + P.MESFIN * 100 + P.DIAFIN) >= ?)
        FETCH FIRST 200 ROWS ONLY
    `;

    let rows = [];
    try {
        rows = await queryWithParams(sql, [clientCode, today, today]);
        logger.info(`[PEDIDOS] Promociones PMR para cliente=${clientCode}, hoy=${today}: ${rows?.length || 0} fila(s)`);
    } catch (e) {
        logger.warn(`[PEDIDOS] Query promociones PMR fallo: ${e.message}`);
        return [];
    }

    return (rows || []).map(r => {
        const promoCode = String(r.PROMO_CODE || '').trim();
        const promoName = String(r.PROMO_NAME || '').trim();
        const diaDesde = parseInt(r.DIAINICIO) || 1;
        const mesDesde = parseInt(r.MESINICIO) || 1;
        const anoDesde = parseInt(r.ANOINICIO) || 0;
        const diaHasta = parseInt(r.DIAFIN) || 0;
        const mesHasta = parseInt(r.MESFIN) || 0;
        const anoHasta = parseInt(r.ANOFIN) || 0;

        return {
            code: promoCode,
            name: promoName,
            promoDesc: promoName,
            promoType: 'GIFT',
            promoCode: promoCode,
            promoPrice: 0,
            regularPrice: 0,
            dateFrom: anoDesde > 0 ? `${diaDesde}/${mesDesde}/${anoDesde}` : '',
            dateTo: anoHasta > 0 ? `${diaHasta}/${mesHasta}/${anoHasta}` : '',
            minQty: parseFloat(r.CANTIDADMINIMAPROMOCION) || 0,
            giftQty: parseFloat(r.CANTIDADMAXIMAREGALO) || 0,
            cumulative: String(r.PROMOCIONACUMULATIVASN || '').trim() === 'S',
            stockEnvases: 0,
            stockUnidades: 0,
        };
    });
}

// Promotion aggregator V2: combines direct gift headers, client-assigned gift
// promotions with article lines, and client-specific special prices.
let _promoSourcesV2 = null; // Map<table, Set<column>>

async function detectPromoSourcesV2() {
    if (_promoSourcesV2) return _promoSourcesV2;
    const candidates = ['PRD', 'PMR', 'PMRC', 'PMP', 'CPES'];
    const found = new Map();
    for (const table of candidates) {
        try {
            const cols = await queryWithParams(
                `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [PROMOTIONS_SCHEMA, table], false, false
            );
            if (Array.isArray(cols) && cols.length > 0) {
                found.set(table, new Set(cols.map(c => String(c.COLUMN_NAME || '').trim().toUpperCase())));
            }
        } catch (_) { /* best-effort source discovery */ }
    }
    _promoSourcesV2 = found;
    if (_promoSourcesV2.size === 0) {
        logger.warn(`[PEDIDOS] Ninguna tabla de promociones existe en ${PROMOTIONS_SCHEMA}. Promociones desactivadas.`);
    } else {
        logger.info(`[PEDIDOS] Fuentes de promociones detectadas: ${Array.from(_promoSourcesV2.keys()).join(',')}`);
    }
    return _promoSourcesV2;
}

async function getActivePromotionsV2(clientCode) {
    try {
        const trimmedClientCode = String(clientCode || '').trim();
        if (!trimmedClientCode) return [];

        const sources = await detectPromoSourcesV2();
        if (!sources || sources.size === 0) return [];

        const now = new Date();
        const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
        const promotions = [];

        if (sources.has('PMR')) {
            promotions.push(...await getActiveGiftPromotionsV2(trimmedClientCode, today, {
                hasClientAssignments: sources.has('PMRC'),
                hasProductLines: sources.has('PMP'),
            }));
        }
        if (sources.has('CPES')) {
            promotions.push(...await getActiveSpecialPricePromotionsV2(trimmedClientCode, today));
        }
        if (sources.has('PRD')) {
            promotions.push(...await getActivePrdPromotionsV2(today, sources.get('PRD') || new Set()));
        }

        return dedupePromotionItemsV2(promotions);
    } catch (error) {
        logger.warn('[PEDIDOS] getActivePromotions error (returning []): ' + error.message);
        return [];
    }
}

async function getActivePrdPromotionsV2(today, cols) {
    try {
        const promotionsTable = promotionsQualifiedTable('PRD');
        const has = (col) => cols.has(col);
        const colArticulo = has('CODIGOARTICULO') ? 'P.CODIGOARTICULO' : (has('CDARTICULO') ? 'P.CDARTICULO' : `''`);
        const colDescrip = has('DESCRIPCION') ? 'P.DESCRIPCION' : (has('DESCRIPCIONPROMOCION') ? 'P.DESCRIPCIONPROMOCION' : `''`);
        const colTipo = has('TIPOPROMOCION') ? 'P.TIPOPROMOCION' : `''`;
        const colPrecio = has('PRECIOPROMOCIONAL') ? 'P.PRECIOPROMOCIONAL' : (has('PRECIO') ? 'P.PRECIO' : '0');
        const colCantMin = has('CANTIDADMINIMA') ? 'P.CANTIDADMINIMA' : (has('CTMINIMA') ? 'P.CTMINIMA' : '0');
        const colCantReg = has('CANTIDADREGALO') ? 'P.CANTIDADREGALO' : (has('CTREGALO') ? 'P.CTREGALO' : '0');
        const colAcum = has('ACUMULABLESN') ? 'P.ACUMULABLESN' : `'N'`;
        const colDiaDesde = has('DIADESDE') ? 'P.DIADESDE' : '1';
        const colMesDesde = has('MESDESDE') ? 'P.MESDESDE' : '1';
        const colAnoDesde = has('ANODESDE') ? 'P.ANODESDE' : '2000';
        const colDiaHasta = has('DIAHASTA') ? 'P.DIAHASTA' : '31';
        const colMesHasta = has('MESHASTA') ? 'P.MESHASTA' : '12';
        const colAnoHasta = has('ANOHASTA') ? 'P.ANOHASTA' : '9999';
        const hasDateRange = has('ANOHASTA') && has('ANODESDE');
        const sql = `
            SELECT ${colArticulo} AS CODIGOARTICULO,
                   ${colDescrip} AS DESCRIPCION,
                   ${colTipo} AS TIPOPROMOCION,
                   ${colPrecio} AS PRECIOPROMOCIONAL,
                   ${colDiaDesde} AS DIADESDE,
                   ${colMesDesde} AS MESDESDE,
                   ${colAnoDesde} AS ANODESDE,
                   ${colDiaHasta} AS DIAHASTA,
                   ${colMesHasta} AS MESHASTA,
                   ${colAnoHasta} AS ANOHASTA,
                   ${colCantMin} AS CANTIDADMINIMA,
                   ${colCantReg} AS CANTIDADREGALO,
                   ${colAcum} AS ACUMULABLESN,
                   A.DESCRIPCIONARTICULO AS NOMBRE_ARTICULO,
                   COALESCE(AR.ENVASESDISPONIBLES, 0) AS STOCK_ENVASES,
                   COALESCE(AR.UNIDADESDISPONIBLES, 0) AS STOCK_UNIDADES
            FROM ${promotionsTable} P
            LEFT JOIN DSEDAC.ART A ON ${colArticulo} = A.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARO AR ON ${colArticulo} = AR.CODIGOARTICULO AND AR.CODIGOALMACEN = 1
            ${hasDateRange
              ? `WHERE (${colAnoHasta} * 10000 + ${colMesHasta} * 100 + ${colDiaHasta}) >= ?
                   AND (${colAnoDesde} * 10000 + ${colMesDesde} * 100 + ${colDiaDesde}) <= ?`
              : ''}
            FETCH FIRST 200 ROWS ONLY
        `;
        const rows = hasDateRange
            ? await queryWithParams(sql, [today, today])
            : await queryWithParams(sql, [], []);
        return (rows || []).map(r => ({
            source: 'PRD',
            code: trimString(r.CODIGOARTICULO),
            productCode: trimString(r.CODIGOARTICULO),
            name: trimString(r.NOMBRE_ARTICULO || r.DESCRIPCION),
            promoDesc: trimString(r.DESCRIPCION),
            promoType: (parseFloat(r.CANTIDADREGALO) || 0) > 0 ? 'GIFT' : 'PRICE',
            promoCode: '',
            promoPrice: parseFloat(r.PRECIOPROMOCIONAL) || 0,
            minQty: parseFloat(r.CANTIDADMINIMA) || 0,
            giftQty: parseFloat(r.CANTIDADREGALO) || 0,
            cumulative: String(r.ACUMULABLESN || '').trim() === 'S',
            stackable: String(r.ACUMULABLESN || '').trim() === 'S',
            stockEnvases: parseFloat(r.STOCK_ENVASES) || 0,
            stockUnidades: parseFloat(r.STOCK_UNIDADES) || 0,
        }));
    } catch (error) {
        logger.warn('[PEDIDOS] getActivePrdPromotionsV2 error (returning []): ' + error.message);
        return [];
    }
}

async function getActiveGiftPromotionsV2(clientCode, today, options = {}) {
    const rows = [];
    const directSql = `
        SELECT
            TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO_CODE,
            TRIM(P.NOMBREPROMOCIONREGALO) AS PROMO_NAME,
            P.DIAINICIO, P.MESINICIO, P.ANOINICIO,
            P.DIAFIN, P.MESFIN, P.ANOFIN,
            P.CANTIDADMINIMAPROMOCION,
            P.CANTIDADMAXIMAREGALO,
            P.CANTIDADMINIMAREGALO,
            P.CANTIDADMAXIMAPROMOCION,
            P.PROMOCIONACUMULATIVASN,
            P.NOREGALARPRODUCTOSCOMPRADOSSN,
            P.PICADOOBLIGATORIOSN,
            TRIM(P.CODIGOCLIENTE) AS CLIENT_CODE,
            CAST(NULL AS VARCHAR(10)) AS PRODUCT_CODE,
            CAST(NULL AS VARCHAR(80)) AS PRODUCT_NAME,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MIN_ENVASES,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MIN_UNIDADES,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MAX_ENVASES,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MAX_UNIDADES,
            CAST(0 AS DECIMAL(15, 5)) AS STOCK_ENVASES,
            CAST(0 AS DECIMAL(15, 5)) AS STOCK_UNIDADES,
            CAST(0 AS INTEGER) AS PRODUCT_ORDER,
            'PMR_DIRECT' AS ASSIGNMENT_SOURCE
        FROM DSEDAC.PMR P
        WHERE TRIM(P.CODIGOCLIENTE) = ?
          AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
          AND (P.ANOFIN = 0 OR (P.ANOFIN * 10000 + P.MESFIN * 100 + P.DIAFIN) >= ?)
        FETCH FIRST 200 ROWS ONLY
    `;
    try {
        rows.push(...(await queryWithParams(directSql, [clientCode, today, today]) || []));
    } catch (e) {
        logger.warn(`[PEDIDOS] Query promociones PMR directas fallo: ${e.message}`);
    }

    if (options.hasClientAssignments && options.hasProductLines) {
        const assignedSql = `
            SELECT
                TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO_CODE,
                TRIM(P.NOMBREPROMOCIONREGALO) AS PROMO_NAME,
                P.DIAINICIO, P.MESINICIO, P.ANOINICIO,
                P.DIAFIN, P.MESFIN, P.ANOFIN,
                P.CANTIDADMINIMAPROMOCION,
                P.CANTIDADMAXIMAREGALO,
                P.CANTIDADMINIMAREGALO,
                P.CANTIDADMAXIMAPROMOCION,
                P.PROMOCIONACUMULATIVASN,
                P.NOREGALARPRODUCTOSCOMPRADOSSN,
                P.PICADOOBLIGATORIOSN,
                TRIM(C.CODIGOCLIENTE) AS CLIENT_CODE,
                TRIM(G.CODIGOARTICULO) AS PRODUCT_CODE,
                TRIM(A.DESCRIPCIONARTICULO) AS PRODUCT_NAME,
                G.CANTIDADMINIMAENVASES AS PRODUCT_MIN_ENVASES,
                G.CANTIDADMINIMAUNIDADES AS PRODUCT_MIN_UNIDADES,
                G.CANTIDADMAXIMAENVASES AS PRODUCT_MAX_ENVASES,
                G.CANTIDADMAXIMAUNIDADES AS PRODUCT_MAX_UNIDADES,
                COALESCE(S.STOCK_ENVASES, 0) AS STOCK_ENVASES,
                COALESCE(S.STOCK_UNIDADES, 0) AS STOCK_UNIDADES,
                G.ORDEN AS PRODUCT_ORDER,
                'PMRC' AS ASSIGNMENT_SOURCE
            FROM DSEDAC.PMRC C
            JOIN DSEDAC.PMR P
              ON TRIM(P.CODIGOPROMOCIONREGALO) = TRIM(C.CODIGOPROMOCIONREGALO)
            LEFT JOIN DSEDAC.PMP G
              ON TRIM(G.CODIGOPROMOCION) = TRIM(C.CODIGOPROMOCIONREGALO)
            LEFT JOIN DSEDAC.ART A
              ON TRIM(A.CODIGOARTICULO) = TRIM(G.CODIGOARTICULO)
            LEFT JOIN (
                SELECT TRIM(CODIGOARTICULO) AS CODE,
                       SUM(ENVASESDISPONIBLES) AS STOCK_ENVASES,
                       SUM(UNIDADESDISPONIBLES) AS STOCK_UNIDADES
                FROM DSEDAC.ARO
                WHERE CODIGOALMACEN = 1
                GROUP BY TRIM(CODIGOARTICULO)
            ) S ON S.CODE = TRIM(G.CODIGOARTICULO)
            WHERE TRIM(C.CODIGOCLIENTE) = ?
              AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
              AND (P.ANOFIN = 0 OR (P.ANOFIN * 10000 + P.MESFIN * 100 + P.DIAFIN) >= ?)
            ORDER BY TRIM(P.CODIGOPROMOCIONREGALO), G.ORDEN, TRIM(G.CODIGOARTICULO)
            FETCH FIRST 500 ROWS ONLY
        `;
        try {
            rows.push(...(await queryWithParams(assignedSql, [clientCode, today, today]) || []));
        } catch (e) {
            logger.warn(`[PEDIDOS] Query promociones PMRC/PMP fallo: ${e.message}`);
        }
    }

    logger.info(`[PEDIDOS] Promociones regalo PMR/PMRC para cliente=${clientCode}, hoy=${today}: ${rows.length} fila(s)`);
    return buildGiftPromotionItemsV2(rows);
}

async function getActiveSpecialPricePromotionsV2(clientCode, today) {
    const sql = `
        SELECT
            TRIM(C.CODIGOARTICULO) AS PRODUCT_CODE,
            TRIM(A.DESCRIPCIONARTICULO) AS PRODUCT_NAME,
            C.PRECIO AS PROMO_PRICE,
            C.DIAINICIO, C.MESINICIO, C.ANOINICIO,
            C.DIAFINAL, C.MESFINAL, C.ANOFINAL,
            TRIM(C.PREFIJOPROMOCION) AS PROMO_PREFIX,
            C.SECUENCIA,
            COALESCE(S.STOCK_ENVASES, 0) AS STOCK_ENVASES,
            COALESCE(S.STOCK_UNIDADES, 0) AS STOCK_UNIDADES
        FROM DSEDAC.CPES C
        LEFT JOIN DSEDAC.ART A
          ON TRIM(A.CODIGOARTICULO) = TRIM(C.CODIGOARTICULO)
        LEFT JOIN (
            SELECT TRIM(CODIGOARTICULO) AS CODE,
                   SUM(ENVASESDISPONIBLES) AS STOCK_ENVASES,
                   SUM(UNIDADESDISPONIBLES) AS STOCK_UNIDADES
            FROM DSEDAC.ARO
            WHERE CODIGOALMACEN = 1
            GROUP BY TRIM(CODIGOARTICULO)
        ) S ON S.CODE = TRIM(C.CODIGOARTICULO)
        WHERE TRIM(C.CODIGOCLIENTE) = ?
          AND TRIM(COALESCE(C.CODIGOARTICULO, '')) <> ''
          AND (C.ANOINICIO = 0 OR (C.ANOINICIO * 10000 + C.MESINICIO * 100 + C.DIAINICIO) <= ?)
          AND (C.ANOFINAL = 0 OR (C.ANOFINAL * 10000 + C.MESFINAL * 100 + C.DIAFINAL) >= ?)
        ORDER BY TRIM(C.CODIGOARTICULO), C.SECUENCIA
        FETCH FIRST 300 ROWS ONLY
    `;
    try {
        const rows = await queryWithParams(sql, [clientCode, today, today]);
        logger.info(`[PEDIDOS] Promociones CPES para cliente=${clientCode}, hoy=${today}: ${rows?.length || 0} fila(s)`);
        return (rows || []).map((r) => {
            const productCode = trimString(r.PRODUCT_CODE);
            const sequence = parseInt(r.SECUENCIA) || 0;
            return {
                source: 'CPES',
                code: productCode,
                productCode,
                name: trimString(r.PRODUCT_NAME) || productCode,
                promoDesc: 'Precio especial cliente',
                promoType: 'PRICE',
                promoCode: `CPES:${productCode}:${sequence}`,
                promoPrice: parseFloat(r.PROMO_PRICE) || 0,
                regularPrice: 0,
                dateFrom: formatPromoDateV2(r.DIAINICIO, r.MESINICIO, r.ANOINICIO),
                dateTo: formatPromoDateV2(r.DIAFINAL, r.MESFINAL, r.ANOFINAL),
                minQty: 1,
                giftQty: 0,
                cumulative: false,
                stackable: false,
                stockEnvases: parseFloat(r.STOCK_ENVASES) || 0,
                stockUnidades: parseFloat(r.STOCK_UNIDADES) || 0,
            };
        });
    } catch (e) {
        logger.warn(`[PEDIDOS] Query promociones CPES fallo: ${e.message}`);
        return [];
    }
}

function buildGiftPromotionItemsV2(rows) {
    const byPromo = new Map();
    const items = [];
    for (const r of rows || []) {
        const promoCode = trimString(r.PROMO_CODE);
        const promoName = trimString(r.PROMO_NAME);
        if (!promoCode) continue;
        const productCode = trimString(r.PRODUCT_CODE);
        const item = {
            source: 'PMR',
            assignmentSource: trimString(r.ASSIGNMENT_SOURCE) || 'PMR',
            code: productCode || promoCode,
            productCode,
            name: trimString(r.PRODUCT_NAME) || promoName || promoCode,
            promoDesc: promoName,
            promoType: 'GIFT',
            promoCode,
            promoPrice: 0,
            regularPrice: 0,
            dateFrom: formatPromoDateV2(r.DIAINICIO, r.MESINICIO, r.ANOINICIO),
            dateTo: formatPromoDateV2(r.DIAFIN, r.MESFIN, r.ANOFIN),
            minQty: parseFloat(r.CANTIDADMINIMAPROMOCION) || 0,
            giftQty: parseFloat(r.CANTIDADMAXIMAREGALO)
                || parseFloat(r.CANTIDADMINIMAREGALO)
                || parseFloat(r.PRODUCT_MAX_ENVASES)
                || parseFloat(r.PRODUCT_MAX_UNIDADES)
                || 0,
            cumulative: String(r.PROMOCIONACUMULATIVASN || '').trim() === 'S',
            stackable: String(r.PROMOCIONACUMULATIVASN || '').trim() === 'S',
            stockEnvases: parseFloat(r.STOCK_ENVASES) || 0,
            stockUnidades: parseFloat(r.STOCK_UNIDADES) || 0,
            noGiftBought: String(r.NOREGALARPRODUCTOSCOMPRADOSSN || '').trim() === 'S',
            giftSelectionLocked: Boolean(productCode),
            giftSkus: [],
            productMinQty: parseFloat(r.PRODUCT_MIN_ENVASES) || parseFloat(r.PRODUCT_MIN_UNIDADES) || 0,
            productMaxQty: parseFloat(r.PRODUCT_MAX_ENVASES) || parseFloat(r.PRODUCT_MAX_UNIDADES) || 0,
            order: parseInt(r.PRODUCT_ORDER) || 0,
        };
        items.push(item);
        if (!byPromo.has(promoCode)) byPromo.set(promoCode, new Set());
        if (productCode) byPromo.get(promoCode).add(productCode);
    }
    for (const item of items) {
        item.giftSkus = Array.from(byPromo.get(item.promoCode) || []);
    }
    return dedupePromotionItemsV2(items);
}

function formatPromoDateV2(day, month, year) {
    const y = parseInt(year) || 0;
    if (y <= 0) return '';
    return `${parseInt(day) || 1}/${parseInt(month) || 1}/${y}`;
}

function dedupePromotionItemsV2(promotions) {
    const seen = new Set();
    const result = [];
    for (const promo of promotions || []) {
        const key = [
            promo.source || '',
            promo.assignmentSource || '',
            promo.promoType || '',
            promo.promoCode || '',
            promo.code || '',
            promo.productCode || '',
            promo.dateFrom || '',
            promo.dateTo || '',
            promo.promoPrice || 0,
            promo.minQty || 0,
            promo.giftQty || 0,
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(promo);
    }
    return result;
}

// ============================================================================
// EXPORTS
// ============================================================================

// Alias wrappers for route compatibility
async function searchProducts(params) { const products = await getProducts(params); return { products, count: products.length }; }
async function getProductStock(code) { return getStock(code); }
async function getClientPricing(clientCode) {
    // Get client tariff code + client-specific prices from last purchases
    const sql = `
        SELECT
            COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFA,
            COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFAVENTADIRECTA,
            COALESCE(PORCENTAJEDECUENTO1, 0) AS PORCENTAJEDESCUENTO1,
            COALESCE(PORCENTAJEDECUENTO21, 0) AS PORCENTAJEDESCUENTO2,
            COALESCE(PORCENTAJEDECUENTO3, 0) AS PORCENTAJEDESCUENTO3
        FROM DSEDAC.CLC
        WHERE TRIM(CODIGOCLIENTE) = ?
        FETCH FIRST 1 ROW ONLY`;
    const rows = await queryWithParams(sql, [String(clientCode || '').trim()]);
    return rows.length > 0 ? rows[0] : null;
}
async function getProductFamilies() { return getFamilies(); }
async function getProductBrands() { return getBrands(); }

// Contrato de llamada (pineado por pedidos_contracts.test.js):
//   updateOrderLine(lineId, data)        â€” lineId primero, payload segundo.
//   deleteOrderLine(lineId, pedidoId)    â€” lineId primero, pedidoId segundo.
// Los antiguos wrappers (pedidoId, lineId, data) invertian los argumentos y
// rompian las rutas legacy de routes/pedidos.js (TypeError al destructurar
// undefined en update y verificacion del pedido equivocado en delete).
// Se exportan las funciones internas directamente; ddd-adapters.js llama ya
// con este mismo orden.

// =============================================================================
// CLIENT BALANCE
// =============================================================================

async function getClientBalance(clientCode) {
    const code = clientCode.trim();
    const cacheKey = `pedidos:balance:${code}`;
    const year = new Date().getFullYear();

    // FIX 2026-05-15:
    //   - "Cobrado" antes usaba L.LCTPVT='CO' en LACLAE, pero esa marca no
    //     existe (LACLAE tiene VT/AB para ventas/abonos, no cobros). Resultado:
    //     siempre 0.
    //   - "Cobrado" REAL del cliente esta en DSEDAC.CVC.IMPORTECANCELADO,
    //     sumando los vencimientos con ANOCOBRO = ano actual.
    //   - "Facturado" se mantiene desde LACLAE (ventas y abonos).
    const sqlFacturado = `
        SELECT COALESCE(SUM(
            CASE WHEN L.LCTPVT IN ('CC','VC')
                  AND L.LCCLLN IN ('AB','VT')
                  AND L.LCSRAB NOT IN ('N','Z','G','D')
                THEN L.LCIMVT ELSE 0 END
        ), 0) AS TOTAL_FACTURADO
        FROM DSED.LACLAE L
        WHERE L.LCCDCL = ?
          AND L.LCAADC = ?
    `;

    // FIX 2026-05-15 (segunda iteracion): la query anterior filtraba por
    // CVC.ANOCOBRO = ano actual, pero ANOCOBRO solo se rellena cuando el ERP
    // procesa el cobro (puede haber retraso o estar a 0). El resultado era
    // que TODOS los clientes mostraban "Cobrado: 0,00 â‚¬".
    //
    // Mejor criterio: sumar IMPORTECANCELADO de los vencimientos del cliente
    // emitidos en el ano actual, sin filtrar por ANOCOBRO. Esto refleja
    // cuanto del facturado este ano YA se ha cobrado, que es lo que el
    // usuario espera ver.
    const sqlCobrado = `
        SELECT COALESCE(SUM(CVC.IMPORTECANCELADO), 0) AS TOTAL_COBRADO
        FROM DSEDAC.CVC CVC
        WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = ?
          AND CVC.ANOEMISION = ?
          AND CVC.IMPORTECANCELADO > 0
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
    `;

    try {
        const [facturadoRows, cobradoRows] = await Promise.all([
            cachedQuery(
                (s) => queryWithParams(s, [code, year]),
                sqlFacturado, `${cacheKey}:facturado`, TTL.SHORT
            ),
            cachedQuery(
                (s) => queryWithParams(s, [code, year]),
                sqlCobrado, `${cacheKey}:cobrado`, TTL.SHORT
            ),
        ]);
        const facturado = parseFloat(facturadoRows?.[0]?.TOTAL_FACTURADO) || 0;
        const cobrado = parseFloat(cobradoRows?.[0]?.TOTAL_COBRADO) || 0;
        return {
            facturadoAnual: facturado,
            cobradoAnual: cobrado,
            saldoPendiente: Math.max(0, facturado - cobrado),
            year,
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getClientBalance error: ${error.message}`);
        return { facturadoAnual: 0, cobradoAnual: 0, saldoPendiente: 0, year };
    }
}

// =============================================================================
// CLONE ORDER
// =============================================================================

async function cloneOrder(orderId) {
    const detail = await getOrderDetail(orderId);
    if (!detail || !detail.header) throw new Error('Order not found');
    return {
        clientCode: detail.header.clienteId,
        clientName: detail.header.clienteNombre,
        tipoventa: detail.header.tipoventa,
        lines: detail.lines.map(l => ({
            codigoArticulo: l.codigoArticulo,
            descripcion: l.descripcion,
            cantidadEnvases: l.cantidadEnvases,
            cantidadUnidades: l.cantidadUnidades,
            unidadMedida: l.unidadMedida,
            unidadesCaja: l.unidadesCaja,
            precioVenta: l.precioVenta,
            precioCosto: l.precioCosto,
            precioTarifa: l.precioTarifa,
            precioTarifaCliente: l.precioTarifaCliente,
            precioMinimo: l.precioMinimo,
        })),
    };
}

// =============================================================================
// COMPLEMENTARY PRODUCTS
// =============================================================================

async function getComplementaryProducts(productCodes, clientCode) {
    if (!productCodes || productCodes.length === 0) return [];

    const trimmedCodes = productCodes.map(c => c.trim());
    const placeholders = trimmedCodes.map(() => '?').join(',');
    const trimClient = clientCode ? truncate(clientCode, 10) : '';
    const cacheKey = `pedidos:complementary:${trimClient || 'no-client'}:${productCodes.sort().join(',')}`;

    const sql = `
        SELECT TRIM(L2.CODIGOARTICULO) AS code,
               TRIM(A.DESCRIPCIONARTICULO) AS NAME,
               COUNT(DISTINCT L2.CODIGOCLIENTEALBARAN || CAST(L2.ANODOCUMENTO AS CHAR(4)) || CAST(L2.NUMERODOCUMENTO AS CHAR(6))) AS cooccurrences,
               COALESCE(T.PRECIOTARIFA, 0) AS price,
               A.UNIDADESCAJA AS unitsPerBox,
               COALESCE(S.ENVASES_DISP, 0) AS stockEnvases,
               COALESCE(S.UNIDADES_DISP, 0) AS stockUnidades
        FROM DSEDAC.LINDTO L1
        JOIN DSEDAC.LINDTO L2
            ON L2.CODIGOCLIENTEALBARAN = L1.CODIGOCLIENTEALBARAN
            AND L2.ANODOCUMENTO = L1.ANODOCUMENTO
            AND L2.NUMERODOCUMENTO = L1.NUMERODOCUMENTO
            AND TRIM(L2.CODIGOARTICULO) NOT IN (${placeholders})
        JOIN DSEDAC.ART A ON TRIM(A.CODIGOARTICULO) = TRIM(L2.CODIGOARTICULO)
        LEFT JOIN DSEDAC.ARA T ON TRIM(L2.CODIGOARTICULO) = TRIM(T.CODIGOARTICULO) AND T.CODIGOTARIFA = 1
        LEFT JOIN (
            SELECT CODIGOARTICULO,
                SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
            FROM DSEDAC.ARO WHERE CODIGOALMACEN = 1
            GROUP BY CODIGOARTICULO
        ) S ON TRIM(L2.CODIGOARTICULO) = TRIM(S.CODIGOARTICULO)
        WHERE TRIM(L1.CODIGOARTICULO) IN (${placeholders})
          AND L1.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 1
          AND L1.TIPOVENTA IN ('CC','VC')
          AND L1.CLASELINEA IN ('AB','VT')
          AND L2.CLASELINEA IN ('AB','VT')
          AND A.ANOBAJA = 0
        GROUP BY L2.CODIGOARTICULO, A.DESCRIPCIONARTICULO, T.PRECIOTARIFA, A.UNIDADESCAJA, S.ENVASES_DISP, S.UNIDADES_DISP
        HAVING COUNT(DISTINCT L2.CODIGOCLIENTEALBARAN || CAST(L2.ANODOCUMENTO AS CHAR(4)) || CAST(L2.NUMERODOCUMENTO AS CHAR(6))) >= 3
        ORDER BY cooccurrences DESC
        FETCH FIRST 10 ROWS ONLY
    `;

    const params = [...trimmedCodes, ...trimmedCodes];

    try {
        const rows = await cachedQuery(
            (s) => queryWithParams(s, params),
            sql, cacheKey, TTL.MEDIUM
        );
        const products = rows.map(r => {
            const price = parseFloat(r.PRICE) || 0;
            return {
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            cooccurrences: parseInt(r.COOCCURRENCES) || 0,
            price,
            precioTarifa1: price,
            precioTarifaCliente: price,
            precioCliente: 0,
            unitsPerBox: parseFloat(r.UNITSPERBOX) || 1,
            stockEnvases: parseFloat(r.STOCKENVASES) || 0,
            stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
            source: 'complementary',
            };
        });
        const pricedProducts = await applyConfiguredPricingToProducts(products, trimClient);
        return pricedProducts.map(product => ({
            ...product,
            price: product.precioTarifaCliente || product.precioCliente || product.price,
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] getComplementaryProducts error: ${error.message}`);
        return [];
    }
}

// =============================================================================
// INTELLIGENT SIMILAR PRODUCTS (3-Level Algorithm - Production Ready)
// =============================================================================

/**
 * Intelligent product analysis - extracts the "essence" of a product
 * Returns: { category, isProcessed, format, mainIngredient, qualifiers }
 */
function analyzeProductEssence(name) {
    const text = (name || '').toLowerCase().trim();
    const words = text.split(/\s+/).filter(w => w.length > 2);
    
    // ========================================
    // CATEGORY DETECTION (what type of product)
    // ========================================
    const categoryPatterns = {
        'carne': ['pollo', 'cerdo', 'vacuno', 'ternera', 'cordero', 'cabrito', 'lacon', 'jamon', 'iberico', 'paleta', 'panceta', 'tocino', 'chuleta', 'costilla', 'filete', 'solomillo', 'pechuga', 'muslo', 'pierna', 'brazo', 'hamburguesa', 'butifarra', 'morcilla', 'chorizo', 'salami', 'salchicha', 'bacon', 'lomo', 'presunto', 'cecina', 'fuet', 'sobrasada'],
        'pescado': ['pescado', 'salmon', 'merluza', 'bacalao', 'atun', 'bonito', 'sardina', 'caballa', 'bacoreta', 'dorada', 'lubina', 'rape', 'rodaballo', 'lenguado', 'trucha', 'carpa', 'tenca', 'anguila', 'palometa', 'chicharro', 'jurel', 'estornino', 'melva', 'coco', 'marrajo', 'congrio', 'anchoa', 'boqueron'],
        'marisco': ['marisco', 'gamba', 'langostino', 'camaron', 'bogavante', 'langosta', 'cangrejo', 'centollo', 'necora', 'navaja', 'vieira', 'mejillon', 'almeja', 'berberecho', 'ostra', 'caracol', 'calamar', 'pulpo', 'sepia', 'volande', 'burga', 'chocho'],
        'verdura': ['verdura', 'hortaliza', 'lechuga', 'tomate', 'patata', 'pimiento', 'cebolla', 'ajo', 'zanahoria', 'calabacin', 'berenjena', 'alcachofa', 'esparrago', 'esparragos', 'guisante', 'judia', 'habichuela', 'brocoli', 'coliflor', 'col', 'repollo', 'acelga', 'espinaca', 'berro', 'canonigo', 'rucula', 'endibia', 'escarola', 'apio', 'nabo', 'rabano', 'remolacha', 'batata', 'boniato'],
        'fruta': ['fruta', 'manzana', 'pera', 'naranja', 'platano', 'limon', 'pomelo', 'mandarina', 'kiwi', 'uva', 'sandia', 'melon', 'fresa', 'frambuesa', 'mora', 'arandano', 'cereza', 'ciruela', 'melocoton', 'albaricoque', 'nectarina', 'higo', 'granada', 'mango', 'papaya', 'pina', 'aguacate', 'coco', 'calabaza'],
        'lacteo': ['leche', 'lacteo', 'lacteos', 'queso', 'yogur', 'yogurt', 'mantequilla', 'nata', 'crema', 'cuajada', 'requeson', 'ricotta', 'mascarpone', 'parmesano', 'gruyere', 'emmental', 'cheddar', 'brie', 'camembert', 'roquefort', 'cabrales', 'gorgonzola', 'manchego', 'tierno', 'semicurado', 'curado', 'viejo', 'fresco'],
        'huevo': ['huevo', 'huevos', 'clara', 'yema', 'yemas'],
        'panaderia': ['pan', 'panaderia', 'baguette', 'brioche', 'croissant', 'mollete', 'chapata', 'pita', 'naan', 'tortilla', 'panecillo', 'bollo'],
        'precocinado': ['precocinado', 'pre-cocinado', 'cocido', 'hervido', 'asado', 'horneado', 'caliente'],
        'congelado': ['congelado', 'ultracongelado', 'congelad', 'frozen', 'ice'],
    };
    
    // ========================================
    // FORMAT DETECTION (how it's presented)
    // ========================================
    const formatPatterns = {
        'entero': ['entero', 'entera', 'enters', 'enteras', 'completo', 'completa', 'sin partir', 'sin cortar', 'integro'],
        'mitad': ['mitad', 'medio', 'media', 'half', 'mitades'],
        'cuarto': ['cuarto', 'cuartos', 'quarter', 'quarters', '4 partes'],
        'dados': ['dado', 'dados', 'cubos', 'cubo', 'dice', 'dices', 'cuadritos', 'cuadrado'],
        'rodajas': ['rodaja', 'rodajas', 'slice', 'slices', 'tira', 'tiras', 'bandeja'],
        'lonchas': ['loncha', 'lonchas', 'lamina', 'laminas', 'flete', 'fletes'],
        'filetes': ['filete', 'filetes', 'filet', 'steak', 'steaks', 'bistec', 'bistecs'],
        'trozos': ['trozo', 'trozos', 'pedazo', 'pedazos', 'porcion', 'porciones', 'portion', 'portions', 'troceado', 'trocead', 'picado', 'picad'],
        'deshuesado': ['deshuesado', 'deshuesad', 'sin hueso', 'deshuesar', 'hueso', 'bone', 'boneless'],
        'pelado': ['pelado', 'pelad', 'sin piel', 'pelar', 'skin', 'skinned', 'mondado'],
        'vacio': ['vacio', 'vacia', 'al vacio', 'vaciar', 'vacuum'],
        'vivo': ['vivo', 'viva', 'vivoa', 'vivas'],
        'fresco': ['fresco', 'fresca', 'refrigerado', 'refrigerad', 'nevera', 'cold'],
        'envasado': ['envasado', 'pack', 'paquete', 'bolsa', 'bandeja', 'caja', 'tarro', 'bote'],
    };
    
    // ========================================
    // PROCESSED/RAW DETECTION
    // ========================================
    const processedPatterns = [
        'empanadilla', 'empanada', 'empanad', 'cocido', 'hervido', 'asado', 'horneado',
        'albondiga', 'albondigas', 'nugget', 'nuggets', 'croqueta', 'croquetas',
        'fileteado', 'filetead', 'rebanado', 'rebanad', 'preparado', 'preparad', 
        'receta', 'listo', 'cocinar', 'gourmet', 'cocinado', 'procesad',
        'salami', 'chorizo', 'iberico', 'jamon', 'paleta',
        'lacon', 'panceta', 'cecina', 'fuet', 'sobrasada', 'mortadela',
        'pate', 'foie', 'butifarra', 'morcilla', 'longaniza', 'cheddar',
        'manchego', 'queso', 'hamburguesa', 'salchicha', 'guiso', 'estofado',
        'carneada', 'cecina', 'beicon', 'tocino', 'salazon',
    ];
    
    // ========================================
    // MAIN INGREDIENT DETECTION (what's the base)
    // ========================================
    const ingredientPatterns = {
        'pollo': ['pollo', 'gallina', 'capon', 'pavo', 'codorniz'],
        'cerdo': ['cerdo', 'porcino', 'cochino', 'gorrino', 'iberico'],
        'vacuno': ['vacuno', 'ternera', 'res', 'buey', 'vaca', 'buey'],
        'cordero': ['cordero', 'cabra', 'cabrito'],
        'pescado_blanco': ['merluza', 'bacalao', 'lubina', 'dorada', 'rape', 'lenguado', 'rodaballo', 'pescada'],
        'pescado_azul': ['salmon', 'atun', 'bonito', 'sardina', 'caballa', 'jurel', 'chicharro'],
        'marisco': ['gamba', 'langostino', 'camaron', 'bogavante', 'langosta', 'cangrejo', 'mejillon', 'almeja', 'pulpo', 'calamar', 'sepia'],
        'verdura': ['verdura', 'hortaliza', 'lechuga', 'tomate', 'patata', 'cebolla', 'ajo', 'zanahoria', 'pimiento', 'berenjena', 'calabacin', 'alcachofa', 'esparrago', 'esparragos', 'guisante', 'judia', 'habichuela', 'brocoli'],
        'fruta': ['fruta', 'manzana', 'pera', 'naranja', 'platano', 'limon', 'kiwi', 'uva', 'sandia', 'melon', 'fresa'],
        'aguacate': ['aguacate', 'palta'],
    };
    
    // ========================================
    // EXECUTE DETECTION
    // ========================================
    let detectedCategory = 'otro';
    let detectedFormat = 'formato_estandar';
    let isProcessed = false;
    let mainIngredient = null;
    const textLower = text;
    
    // Detect category
    for (const [cat, keywords] of Object.entries(categoryPatterns)) {
        if (keywords.some(kw => textLower.includes(kw))) {
            detectedCategory = cat;
            break;
        }
    }
    
    // Detect format
    for (const [fmt, keywords] of Object.entries(formatPatterns)) {
        if (keywords.some(kw => textLower.includes(kw))) {
            detectedFormat = fmt;
            break;
        }
    }
    
    // Detect if processed
    if (processedPatterns.some(kw => textLower.includes(kw))) {
        isProcessed = true;
    }
    
    // Also check for raw indicators (if has these, likely NOT processed)
    const rawIndicators = ['fresco', 'entero', 'crudo', 'natural', 'vivo', 'sin elaborar'];
    const hasRawIndicator = rawIndicators.some(ind => textLower.includes(ind));
    if (hasRawIndicator && !isProcessed) {
        isProcessed = false;
    } else if (hasRawIndicator && processedPatterns.some(kw => textLower.includes(kw))) {
        // If has BOTH processed AND raw indicators, check context
        // "Pollo fresco" = raw, "Empanadillas de pollo" = processed
        const rawIndex = rawIndicators.findIndex(ind => textLower.includes(ind));
        const processedIndex = processedPatterns.findIndex(kw => textLower.includes(kw));
        // If raw comes first, likely raw product
        if (rawIndex < processedIndex && rawIndex >= 0) {
            isProcessed = false;
        }
    }
    
    // Detect main ingredient (useful for detecting "pollo" in "empanadillas de pollo")
    for (const [ing, keywords] of Object.entries(ingredientPatterns)) {
        if (keywords.some(kw => textLower.includes(kw))) {
            mainIngredient = ing;
            break;
        }
    }
    
    return {
        category: detectedCategory,
        format: detectedFormat,
        isProcessed: isProcessed,
        mainIngredient: mainIngredient,
        originalText: name,
        words: words
    };
}

/**
 * Calculates semantic compatibility score between two products
 * Uses intelligent 3-level matching: Family > Attributes > Format
 */
function calculateSemanticScore(origProduct, candidate) {
    let score = 0;
    const reasons = [];

    const origName = (origProduct.NAME || '').trim();
    const candName = (candidate.NAME || '').trim();

    // Analyze product essences
    const origEssence = analyzeProductEssence(origName);
    const candEssence = analyzeProductEssence(candName);

    // ========================================
    // LEVEL 3: ADVANCED - Semantic Compatibility Check
    // ========================================

    // BONUS: If original is processed and candidate has the same main ingredient
    // Example: "Empanadillas de pollo" -> "Pollo entero" is a GOOD recommendation
    if (origEssence.isProcessed && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient) {
        score += 50;
        reasons.push(`Ingrediente principal compatible: ${candEssence.mainIngredient}`);
    }

    // Check category incompatibility
    if (origEssence.category !== 'otro' && candEssence.category !== 'otro' &&
        origEssence.category !== candEssence.category) {

        // If both have categories but they're different, moderate penalty
        // But allow some category crossovers
        const allowedCrossovers = [
            ['carne', 'precocinado'],
            ['pescado', 'precocinado'],
            ['marisco', 'precocinado'],
            ['verdura', 'congelado'],
            ['fruta', 'congelado'],
            ['carne', 'congelado'],
            ['pescado', 'congelado'],
        ];

        const isAllowed = allowedCrossovers.some(([a, b]) =>
            (origEssence.category === a && candEssence.category === b) ||
            (origEssence.category === b && candEssence.category === a)
        );

        if (!isAllowed) {
            score -= 30;
            reasons.push(`Categoria diferente: ${candEssence.category}`);
        } else {
            score += 15;
            reasons.push(`Categoria compatible: ${origEssence.category} -> ${candEssence.category}`);
        }
    }

    // Raw vs Processed relationship (IMPORTANT: they can be complementary!)
    // If looking for PROCESSED and candidate is RAW with same ingredient -> GOOD MATCH
    if (origEssence.isProcessed && !candEssence.isProcessed &&
        origEssence.mainIngredient && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient) {
        score += 40;
        reasons.push(`Ingrediente base para producto elaborado`);
    }

    // If looking for RAW but candidate is PROCESSED with same ingredient -> also good
    if (!origEssence.isProcessed && candEssence.isProcessed &&
        origEssence.mainIngredient && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient) {
        score += 30;
        reasons.push(`Producto elaborado con mismo ingrediente`);
    }

    // Only penalize if formats are completely incompatible
    if (origEssence.format === 'vivo' && candEssence.format !== 'vivo' &&
        (!origEssence.mainIngredient || !candEssence.mainIngredient ||
         origEssence.mainIngredient !== candEssence.mainIngredient)) {
        score -= 40;
        reasons.push('Formato incompatible');
    }

    // ========================================
    // LEVEL 2: FORMAT COMPATIBILITY
    // ========================================
    if (origEssence.format === candEssence.format) {
        score += 30;
        reasons.push(`Mismo formato: ${origEssence.format}`);
    } else if (origEssence.format !== 'formato_estandar' && candEssence.format !== 'formato_estandar') {
        // Different but both have specific formats
        // Check if formats are compatible
        const compatibleFormats = [
            ['entero', 'mitad'],
            ['entero', 'cuarto'],
            ['mitad', 'cuarto'],
            ['dados', 'trozos'],
            ['filetes', 'trozos'],
            ['rodajas', 'lonchas'],
        ];
        
        const isCompatible = compatibleFormats.some(([a, b]) => 
            (origEssence.format === a && candEssence.format === b) ||
            (origEssence.format === b && candEssence.format === a)
        );
        
        if (isCompatible) {
            score += 15;
            reasons.push(`Formato compatible: ${origEssence.format} -> ${candEssence.format}`);
        } else {
            score -= 5;
            reasons.push(`Formato diferente: ${origEssence.format} vs ${candEssence.format}`);
        }
    }
    
    // ========================================
    // LEVEL 1: FAMILY HIERARCHY
    // ========================================
    if (candidate.FAMILIA === origProduct.FAMILIA) {
        score += 25;
        reasons.push('Misma familia');
    }

    if (candidate.SUBFAMILIA && origProduct.SUBFAMILIA && 
        candidate.SUBFAMILIA === origProduct.SUBFAMILIA) {
        score += 40;
        reasons.push('Misma subfamilia');
    }

    if (candidate.GRUPO && origProduct.GRUPO && 
        candidate.GRUPO === origProduct.GRUPO) {
        score += 15;
        reasons.push('Mismo grupo');
    }

    if (candidate.MARCA && origProduct.MARCA && 
        candidate.MARCA === origProduct.MARCA) {
        score += 10;
        reasons.push('Misma marca');
    }
    
    // ========================================
    // LEVEL 2: Technical fields matching
    // ========================================
    if (candidate.TIPO && origProduct.TIPO && 
        candidate.TIPO === origProduct.TIPO) {
        score += 12;
        reasons.push('Mismo tipo');
    }

    if (candidate.FORMATO && origProduct.FORMATO && 
        candidate.FORMATO === origProduct.FORMATO) {
        score += 8;
    }

    if (candidate.PRESENTACION && origProduct.PRESENTACION && 
        candidate.PRESENTACION === origProduct.PRESENTACION) {
        score += 5;
    }

    // ========================================
    // BONUS: Same main ingredient
    // ========================================
    // Bug fix: la variable origHasCandidateIngredient no existia, lanzaba
    // ReferenceError y los productos con mainIngredient devolvian [].
    // Evitamos doble-conteo si LEVEL 3 (linea ~3579) ya bonifico
    // ingrediente principal compatible.
    const alreadyScoredMainIngredient = origEssence.isProcessed &&
        origEssence.mainIngredient === candEssence.mainIngredient;
    if (origEssence.mainIngredient && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient &&
        !alreadyScoredMainIngredient) {
        score += 20;
        reasons.push(`Mismo ingrediente base: ${candEssence.mainIngredient}`);
    }
    
    // ========================================
    // BONUS: Product type compatibility
    // ========================================
    if (origEssence.isProcessed === candEssence.isProcessed) {
        score += 10;
        if (origEssence.isProcessed) {
            reasons.push('Ambos son productos elaborados');
        } else {
            reasons.push('Ambos son productos frescos/crudos');
        }
    }

    const compatible = score > -30;
    return { score, reasons, level: 'advanced', compatible };
}

/**
 * Finds products similar to the given one using intelligent 3-level matching.
 * Level 1 (Basic): Family and Subfamily priority
 * Level 2 (Intermediate): Compare Attributes and Format
 * Level 3 (Advanced): Understand semantic intent (raw vs elaborated)
 */
async function getSimilarProducts(productCode) {
    const code = (productCode || '').trim();
    if (!code) return [];

    const cacheKey = `pedidos:similar_v3:${code}`;
    
    try {
        // 1. Get original product attributes
        const sqlOriginal = `
            SELECT TRIM(CODIGOFAMILIA) AS FAMILIA,
                   TRIM(CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(CODIGOMARCA) AS MARCA,
                   TRIM(COALESCE(CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(CODIGOTIPO, '')) AS TIPO,
                   TRIM(DESCRIPCIONARTICULO) AS DESCRIPTION
            FROM DSEDAC.ART WHERE TRIM(CODIGOARTICULO) = ?
        `;
        const origRows = await queryWithParams(sqlOriginal, [code]);
        if (!origRows || origRows.length === 0) return [];
        const orig = origRows[0];

        // 2. Fetch candidates from the SAME FAMILY that have stock
        const sqlCandidates = `
            SELECT TRIM(B.CODIGOARTICULO) AS CODE,
                   TRIM(B.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(B.CODIGOMARCA) AS MARCA,
                   TRIM(B.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(B.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(COALESCE(B.CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(B.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(B.CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(B.CODIGOTIPO, '')) AS TIPO,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM DSEDAC.ART B
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM DSEDAC.ARO
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON B.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE SR
                JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
                GROUP BY SR.CODIGOARTICULO
            ) RES ON B.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARA T ON B.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE TRIM(B.CODIGOFAMILIA) = ?
              AND TRIM(B.CODIGOARTICULO) != ?
              AND B.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
        `;
        let rows = await cachedQuery(
            (s) => queryWithParams(s, [orig.FAMILIA, code]),
            sqlCandidates, cacheKey, TTL.SHORT
        );

        // 2b. FALLBACK: If no candidates in same family, expand to subfamilia across all families
        if ((!rows || rows.length === 0) && orig.SUBFAMILIA) {
            const sqlFallback = `
            SELECT TRIM(B.CODIGOARTICULO) AS CODE,
                   TRIM(B.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(B.CODIGOMARCA) AS MARCA,
                   TRIM(B.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(B.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(COALESCE(B.CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(B.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(B.CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(B.CODIGOTIPO, '')) AS TIPO,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM DSEDAC.ART B
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM DSEDAC.ARO
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON B.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE SR
                JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
                GROUP BY SR.CODIGOARTICULO
            ) RES ON B.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARA T ON B.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE TRIM(B.CODIGOSUBFAMILIA) = ?
              AND TRIM(B.CODIGOARTICULO) != ?
              AND B.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
            FETCH FIRST 30 ROWS ONLY
            `;
            const fallbackKey = `pedidos:similar_v3_fallback:${code}`;
            rows = await cachedQuery(
                (s) => queryWithParams(s, [orig.SUBFAMILIA, code]),
                sqlFallback, fallbackKey, TTL.SHORT
            );
            logger.info(`[PEDIDOS] getSimilarProducts fallback: subfamilia=${orig.SUBFAMILIA}, found ${(rows || []).length} candidates`);
        }

        // 3. Apply intelligent 3-level scoring
        const scored = [];
        
        for (const r of rows) {
            const candidate = {
                NAME: r.NAME,
                DESCRIPTION: r.NAME, // Use name as description for keyword analysis
                FAMILIA: r.FAMILIA,
                SUBFAMILIA: r.SUBFAMILIA,
                GRUPO: r.GRUPO,
                MARCA: r.MARCA,
                FORMATO: r.FORMATO,
                PRESENTACION: r.PRESENTACION,
                TIPO: r.TIPO
            };
            
            const origProduct = {
                NAME: orig.DESCRIPTION,
                DESCRIPTION: orig.DESCRIPTION,
                FAMILIA: orig.FAMILIA,
                SUBFAMILIA: orig.SUBFAMILIA,
                GRUPO: orig.GRUPO,
                MARCA: orig.MARCA,
                FORMATO: orig.FORMATO,
                PRESENTACION: orig.PRESENTACION,
                TIPO: orig.TIPO
            };
            
            const { score, reasons, compatible } = calculateSemanticScore(origProduct, candidate);

            // Improved threshold: accept products with score > -30 or same family
            const sameFamily = candidate.FAMILIA === origProduct.FAMILIA;
            const sameSubfamily = candidate.SUBFAMILIA && origProduct.SUBFAMILIA &&
                                  candidate.SUBFAMILIA === origProduct.SUBFAMILIA;
            
            // Always include if same subfamily, otherwise check score
            if (sameSubfamily || sameFamily || score > -30) {
                scored.push({
                    code: (r.CODE || '').trim(),
                    name: (r.NAME || '').trim(),
                    brand: (r.MARCA || '').trim(),
                    family: (r.FAMILIA || '').trim(),
                    subfamily: (r.SUBFAMILIA || '').trim(),
                    stockEnvases: Math.max(0, parseFloat(r.STOCK_ENVASES) || 0),
                    stockUnidades: Math.max(0, parseFloat(r.STOCK_UNIDADES) || 0),
                    precio: parseFloat(r.PRECIO) || 0,
                    similarityScore: Math.max(0, score),
                    matchReasons: reasons.length > 0 ? reasons : (sameSubfamily ? ['Misma subfamilia'] : ['Misma familia'])
                });
            }
        }
        
        // 4. Sort and limit to top 10
        scored.sort((a, b) => b.similarityScore - a.similarityScore || b.stockEnvases - a.stockEnvases);
        return scored.slice(0, 10);
    } catch (error) {
        logger.error(`[PEDIDOS] getSimilarProducts error for ${code}: ${error.message}`);
        return [];
    }
}

// =============================================================================
// ORDER ANALYTICS
// =============================================================================

function buildPedidoCabVendorFilter(vendedorCodes, alias = '') {
    const raw = String(vendedorCodes || '').trim();
    if (!raw || raw.toUpperCase() === 'ALL') {
        return { clause: '', params: [] };
    }
    const codes = raw
        .split(',')
        .map(v => v.trim())
        .filter(v => /^[a-zA-Z0-9]+$/.test(v))
        .map(v => v.substring(0, 2))
        .filter(Boolean);
    if (codes.length === 0) {
        return { clause: 'AND 1=0', params: [] };
    }
    const prefix = alias ? `${alias}.` : '';
    return {
        clause: `AND ${prefix}CODIGOVENDEDOR IN (${codes.map(() => 'CAST(? AS CHAR(2))').join(',')})`,
        params: codes,
    };
}

async function getOrderAnalytics(vendedorCodes) {
    const monthlyVendorFilter = buildPedidoCabVendorFilter(vendedorCodes);
    const topVendorFilter = buildPedidoCabVendorFilter(vendedorCodes, 'C');
    const statusVendorFilter = buildPedidoCabVendorFilter(vendedorCodes);

    const cacheKey = `pedidos:analytics:${vendedorCodes}`;

    const sql = `
        SELECT
            ANODOCUMENTO AS year, MESDOCUMENTO AS month,
            COUNT(*) AS orderCount,
            SUM(IMPORTETOTAL) AS totalRevenue,
            SUM(IMPORTEMARGEN) AS totalMargin,
            AVG(IMPORTETOTAL) AS avgOrderValue,
            COUNT(DISTINCT CODIGOCLIENTE) AS uniqueClients
        FROM ${ERP_SCHEMA}.PEDIDOS_CAB
        WHERE ESTADO IN ('CONFIRMADO','ENVIADO')
          AND EJERCICIO = YEAR(CURRENT_DATE)
          ${monthlyVendorFilter.clause}
        GROUP BY ANODOCUMENTO, MESDOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
        FETCH FIRST 6 ROWS ONLY
    `;

    const topSql = `
        SELECT TRIM(L.CODIGOARTICULO) AS code,
               TRIM(L.DESCRIPCION) AS name,
               SUM(L.IMPORTEVENTA) AS totalSales,
               SUM(L.CANTIDADENVASES) AS totalEnvases,
               COUNT(*) AS lineCount
        FROM ${ERP_SCHEMA}.PEDIDOS_LIN L
        JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON C.ID = L.PEDIDO_ID
        WHERE C.ESTADO IN ('CONFIRMADO','ENVIADO')
          AND C.EJERCICIO = YEAR(CURRENT_DATE)
          ${topVendorFilter.clause}
        GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
        ORDER BY totalSales DESC
        FETCH FIRST 10 ROWS ONLY
    `;

    const statusSql = `
        SELECT TRIM(ESTADO) AS status, COUNT(*) AS count
        FROM ${ERP_SCHEMA}.PEDIDOS_CAB
        WHERE EJERCICIO = YEAR(CURRENT_DATE)
          ${statusVendorFilter.clause}
        GROUP BY ESTADO
    `;

    try {
        const [monthly, topProducts, statusDist] = await Promise.all([
            cachedQuery(
                (s, params = []) => queryWithParams(s, params),
                sql,
                { cacheKey: `${cacheKey}:monthly`, prefix: 'pedidos', ttl: TTL.SHORT, params: { vendedorCodes, part: 'monthly' }, queryType: 'pedidos-analytics' },
                monthlyVendorFilter.params,
            ),
            cachedQuery(
                (s, params = []) => queryWithParams(s, params),
                topSql,
                { cacheKey: `${cacheKey}:top`, prefix: 'pedidos', ttl: TTL.SHORT, params: { vendedorCodes, part: 'top' }, queryType: 'pedidos-analytics' },
                topVendorFilter.params,
            ),
            cachedQuery(
                (s, params = []) => queryWithParams(s, params),
                statusSql,
                { cacheKey: `${cacheKey}:status`, prefix: 'pedidos', ttl: TTL.SHORT, params: { vendedorCodes, part: 'status' }, queryType: 'pedidos-analytics' },
                statusVendorFilter.params,
            ),
        ]);

        return {
            monthly: monthly.map(r => ({
                year: r.year || r.YEAR,
                month: r.month || r.MONTH,
                orderCount: parseInt(r.orderCount || r.ORDERCOUNT) || 0,
                totalRevenue: parseFloat(r.totalRevenue || r.TOTALREVENUE) || 0,
                totalMargin: parseFloat(r.totalMargin || r.TOTALMARGIN) || 0,
                avgOrderValue: parseFloat(r.avgOrderValue || r.AVGORDERVALUE) || 0,
                uniqueClients: parseInt(r.uniqueClients || r.UNIQUECLIENTS) || 0,
            })),
            topProducts: topProducts.map(r => ({
                code: (r.code || r.CODE || '').trim(),
                name: (r.name || r.NAME || '').trim(),
                totalSales: parseFloat(r.totalSales || r.TOTALSALES) || 0,
                totalEnvases: parseFloat(r.totalEnvases || r.TOTALENVASES) || 0,
                lineCount: parseInt(r.lineCount || r.LINECOUNT) || 0,
            })),
            statusDistribution: statusDist.reduce((acc, r) => {
                const status = canonicalOrderStatus(r.status || r.STATUS);
                acc[status] = (acc[status] || 0) + (parseInt(r.count || r.COUNT) || 0);
                return acc;
            }, {}),
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getOrderAnalytics error: ${error.message}`);
        return { monthly: [], topProducts: [], statusDistribution: {} };
    }
}

// =============================================================================
// ORDER PDF
// =============================================================================

async function generateOrderPdf(orderId) {
    const detail = await getOrderDetail(orderId);
    if (!detail || !detail.header) throw new Error('Order not found');
    return detail; // Return data, PDF rendering happens in route
}

/**
 * Get product purchase history for a specific client
 * Returns monthly breakdown for last 3 years
 */
async function getProductHistory(productCode, clientCode) {
    if (!productCode || !clientCode) return [];

    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 2;

    const sql = `
        SELECT
            L.LCAADC AS YEAR,
            L.LCMMDC AS MONTH,
            SUM(L.LCIMVT) AS SALES,
            SUM(L.LCIMCT) AS COST,
            SUM(L.LCCTUD) AS UNITS,
            COALESCE(SUM(L.LCIMVT) / NULLIF(SUM(L.LCCTUD), 0), 0) AS AVG_PRICE
        FROM DSED.LACLAE L
        WHERE L.LCAADC >= ?
          AND L.LCCDCL = ?
          AND TRIM(L.LCCDPR) = ?
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
    `;

    try {
        const rows = await queryWithParams(sql, [startYear, clientCode, productCode], false);
        return rows.map(r => ({
            year: parseInt(r.YEAR),
            month: parseInt(r.MONTH),
            sales: parseFloat(r.SALES) || 0,
            cost: parseFloat(r.COST) || 0,
            units: parseFloat(r.UNITS) || 0,
            avgPrice: parseFloat(r.AVG_PRICE) || 0
        }));
    } catch (e) {
        logger.warn(`[PEDIDOS] getProductHistory error: ${e.message}`);
        return [];
    }
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

/**
 * Search products with available stock by name/code/family
 * Used as fallback in stock alternatives modal when no similar products found
 */
async function searchProductsWithStock(searchTerm, limit = 20) {
    const term = (searchTerm || '').trim().toUpperCase();
    if (!term || term.length < 2) return [];
    
    const cacheKey = `pedidos:search_stock:${term}:${limit}`;
    
    try {
        const sql = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.CODIGOMARCA) AS MARCA,
                   TRIM(A.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(A.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM DSEDAC.ART A
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM DSEDAC.ARO
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON A.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE SR
                JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
                GROUP BY SR.CODIGOARTICULO
            ) RES ON A.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARA T ON A.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE A.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
              AND (
                  UPPER(TRIM(A.DESCRIPCIONARTICULO)) LIKE ?
                  OR UPPER(TRIM(A.CODIGOARTICULO)) LIKE ?
                  OR UPPER(TRIM(A.CODIGOFAMILIA)) LIKE ?
                  OR UPPER(TRIM(A.CODIGOSUBFAMILIA)) LIKE ?
              )
            ORDER BY 
                CASE 
                    WHEN UPPER(TRIM(A.CODIGOARTICULO)) LIKE ? THEN 1
                    WHEN UPPER(TRIM(A.DESCRIPCIONARTICULO)) LIKE ? THEN 2
                    ELSE 3
                END,
                S.ENVASES_DISP DESC
            FETCH FIRST ? ROWS ONLY
        `;
        
        const likeTerm = `%${term}%`;
        const rows = await cachedQuery(
            (s) => queryWithParams(s, [likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, limit]),
            sql, cacheKey, TTL.SHORT
        );
        
        return rows.map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            brand: (r.MARCA || '').trim(),
            family: (r.FAMILIA || '').trim(),
            subfamily: (r.SUBFAMILIA || '').trim(),
            stockEnvases: Math.max(0, parseFloat(r.STOCK_ENVASES) || 0),
            stockUnidades: Math.max(0, parseFloat(r.STOCK_UNIDADES) || 0),
            precio: parseFloat(r.PRECIO) || 0,
            similarityScore: 0,
            matchReasons: ['Busqueda manual']
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] searchProductsWithStock error: ${error.message}`);
        return [];
    }
}

module.exports = {
    initPedidosTables,
    extractIdempotencyKeyFromRequest,
    ensurePedidoIdempotencyKeyFromRequest,
    generatePedidoIdempotencyKey,
    normalizePedidoIdempotencyKey,
    normalizePedidoSaleType,
    getPedidoSaleTypeLabel,
    resolveIvaFromCodigo,
    applyProductPriceView,
    buildCreateOrderPayloadHash,
    getProducts,
    searchProducts,
    getProductDetail,
    getStock,
    getStockBatch,
    getProductStock,
    getClientPricing,
    getDeliveryOptions,
    getAvailableVehicles,
    getPedidosConfirmationTarget,
    getOrderVendorForAuth,
    createOrder,
    getOrders,
    getOrderDetail,
    addOrderLine,
    updateOrderLine,
    deleteOrderLine,
    confirmOrder,
    cancelOrder,
    updateOrderStatus,
    getRecommendations,
    getFamilies,
    getFamiliesDetailed,
    getBrands,
    getProductFamilies,
    getProductBrands,
    getActivePromotions: getActivePromotionsV2,
    checkDraftAccumulation,
    getClientBalance,
    cloneOrder,
    getComplementaryProducts,
    getOrderAnalytics,
    generateOrderPdf,
    getSimilarProducts,
    searchProductsWithStock,
    calculateLineImporte,
    assertPrecioWithinClientTariff,
    applyConfiguredPricingToProducts,
    applyConfiguredPricingToProduct,
    effectiveMinPriceFromRow,
    isOrderTransitionAllowed,
    canonicalOrderStatus,
    storedOrderStatus,
    assertOrderEditable,
    getOrderStats,
    getOrderAlbaran,
    getProductHistory,
    pedidosBreaker,
    _private: {
        getNextOrderNumber,
        getClientOrderDefaults,
        getDefaultTruckAssignment,
        resolvePedidoTerminal,
        exportCommercialOrderToSystem,
        withSystemExportLock,
    },
};
