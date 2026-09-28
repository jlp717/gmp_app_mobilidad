// _shared.js — split verbatim de services/pedidos/index.js (lote 2026-09-28): helpers puros compartidos (sin dependencias).
// Contenido movido tal cual, sin cambios de logica. index.js actua como fachada.
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
};
