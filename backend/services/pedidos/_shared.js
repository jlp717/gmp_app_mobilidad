// _shared.js — helpers puros + single-source de consts DB2 del dominio pedidos.
// Centraliza ERP_SCHEMA, PEDIDOS_*, PROMOTIONS_*, DRAFT_*, ACTIVE_* y
// SELECT_ORDER_VENDOR_FOR_AUTH_SQL para eliminar duplicados entre ficheros.
// Sin cambios de logica: valores movidos verbatim desde index/order-lifecycle/similarity/history/promotions.
const { db2AppTable, getDb2WriteSchema } = require('../../utils/db2-schemas');
const { db2Schema } = require('../../utils/db2-identifiers');

function isTableNotFound(err) {
    const msg = (err.message || '').toLowerCase();
    const codes = (err.odbcErrors || []).map(e => e.code);
    return codes.includes(-204) || msg.includes('sql0204');
}

function roundPrice(value) {
    const number = parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(number * 10000) / 10000;
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

function numberValue(raw) {
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
}

function integerValue(raw) {
    const num = parseInt(raw, 10);
    return Number.isFinite(num) ? num : 0;
}

function truncate(value, length) {
    return trimString(value).substring(0, length);
}

// --- Single-source DB2: tablas app + schema escritura (verbatim de index.js) ---
const ERP_SCHEMA = getDb2WriteSchema();
const PEDIDOS_CAB_TABLE = db2AppTable('PEDIDOS_CAB');
const PEDIDOS_LIN_TABLE = db2AppTable('PEDIDOS_LIN');
const PEDIDOS_SEQ_TABLE = db2AppTable('PEDIDOS_SEQ');
const PEDIDOS_STOCK_RESERVE_TABLE = db2AppTable('PEDIDOS_STOCK_RESERVE');
const PEDIDO_IDEMPOTENCY_TABLE = db2AppTable('PEDIDO_IDEMPOTENCY');

// --- Single-source stock-reserve drafts (verbatim de index.js) ---
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

// --- Single-source auth-vendor lookup (verbatim de order-lifecycle.js; en index.js era orphan sin uso) ---
const SELECT_ORDER_VENDOR_FOR_AUTH_SQL = ERP_SCHEMA === 'DSEDAC'
    ? 'SELECT ID, TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR, TRIM(CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE FROM DSEDAC.PEDIDOS_CAB WHERE ID = ?'
    : `SELECT ID, TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR, TRIM(COALESCE(NULLIF(CODIGOCLIENTE, ''), CODIGOCLIENTEALBARAN)) AS CODIGOCLIENTE FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`;

// --- Single-source promociones (verbatim de promotions.js) ---
const PROMOTIONS_SCHEMA = db2Schema('DSEDAC', 'PROMOTIONS_SCHEMA');
const PROMOTION_SOURCE_TABLES = new Set(['PRD', 'PMR', 'PMRC', 'PMP', 'CPES']);

module.exports = {
    isTableNotFound,
    roundPrice,
    trimString,
    OrderStateError,
    VALID_ORDER_STATES,
    MAX_ORDER_LINES,
    DB2_BULK_INSERT_CHUNK_SIZE,
    STOCK_RESERVE_BULK_INSERT_CHUNK_SIZE,
    DEFAULT_PEDIDOS_ERP_TERMINAL,
    ORDER_TRANSITIONS,
    canonicalOrderStatus,
    numberValue,
    integerValue,
    truncate,
    ERP_SCHEMA,
    PEDIDOS_CAB_TABLE,
    PEDIDOS_LIN_TABLE,
    PEDIDOS_SEQ_TABLE,
    PEDIDOS_STOCK_RESERVE_TABLE,
    PEDIDO_IDEMPOTENCY_TABLE,
    DRAFT_STOCK_RESERVATION_HOURS,
    DRAFT_STOCK_RESERVATION_STATES_SQL,
    ACTIVE_STOCK_RESERVATION_CONDITION,
    SELECT_ORDER_VENDOR_FOR_AUTH_SQL,
    PROMOTIONS_SCHEMA,
    PROMOTION_SOURCE_TABLES,
};
