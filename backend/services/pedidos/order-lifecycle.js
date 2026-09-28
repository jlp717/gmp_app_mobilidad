// order-lifecycle.js — split verbatim de services/pedidos/index.js (lote 2026-09-28): idempotencia, estados, actor/terminal, objetivo-confirm y dias de reparto.
// Contenido movido tal cual, sin cambios de logica. index.js actua como fachada.
const crypto = require('crypto');
const { parseLineDiscountPct, parseGlobalDiscountPct } = require('./discounts');
const { queryWithParams } = require('../../config/db');
const { db2Schema, db2QualifiedTable } = require('../../utils/db2-identifiers');
const { db2AppTable, getDb2WriteSchema, getDb2WriteSchemaRequested, getDb2WriteSchemaDiagnostic, isDsedacWriteApproved, isDsedacAppBuffersAllowed } = require('../../utils/db2-schemas');
const logger = require('../../middleware/logger');
const { trimString, truncate, isTableNotFound, VALID_ORDER_STATES, ORDER_TRANSITIONS, OrderStateError, DEFAULT_PEDIDOS_ERP_TERMINAL, integerValue } = require('./_shared');
const ERP_SCHEMA = getDb2WriteSchema();
const PEDIDOS_CAB_TABLE = db2AppTable('PEDIDOS_CAB');
const PEDIDO_IDEMPOTENCY_TABLE = db2AppTable('PEDIDO_IDEMPOTENCY');
const SELECT_ORDER_VENDOR_FOR_AUTH_SQL = ERP_SCHEMA === 'DSEDAC'
    ? 'SELECT ID, TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR, TRIM(CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE FROM DSEDAC.PEDIDOS_CAB WHERE ID = ?'
    : `SELECT ID, TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR, TRIM(COALESCE(NULLIF(CODIGOCLIENTE, ''), CODIGOCLIENTEALBARAN)) AS CODIGOCLIENTE FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`;
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
        descuentoLinea: Number(parseLineDiscountPct(line)).toFixed(2),
    })).sort((a, b) => a.codigoArticulo.localeCompare(b.codigoArticulo));

    const payload = {
        clientCode: truncate(clientCode, 10),
        vendedorCode: resolvePedidoActorCodes({ CODIGOVENDEDOR: vendedorCode }).vendedor,
        tipoventa: normalizePedidoSaleType(tipoventa),
        observaciones: trimString(observaciones),
        descuentoGlobal: Number(parseGlobalDiscountPct({ descuentoGlobal })).toFixed(2),
        lines: canonicalLines,
    };

    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function lookupPedidoIdempotency(idempotencyKey) {
    try {
        const rows = await queryWithParams(
            `SELECT PEDIDO_ID, PAYLOAD_HASH
               FROM ${PEDIDO_IDEMPOTENCY_TABLE}
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
    const { getOrderDetail } = require('./index'); // puente split: def vive en index
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
        `SELECT TRIM(ESTADO) AS ESTADO FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`,
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
    // Export to ${comercialErpTable('CPC')} is independent of local write schema (JAVIER.PEDIDOS_*).
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

async function checkDraftAccumulation(vendedorCode, { autoConfirm = false, threshold = null, options = {} } = {}) {
    const { getPedidosPendientesSyncThreshold, confirmOrder } = require('./index'); // puente split: def vive en index
    const code = truncate(vendedorCode, 2);
    if (!code) return { warning: false, drafts: [], threshold: 0, count: 0 };

    const resolvedThreshold = threshold == null
        ? await getPedidosPendientesSyncThreshold(code)
        : (parseInt(threshold, 10) || 0);

    let drafts = [];
    try {
        drafts = await queryWithParams(
            `SELECT ID, NUMEROPEDIDO, TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE,
                    TRIM(NOMBRECLIENTE) AS NOMBRECLIENTE, IMPORTETOTAL, CREATED_AT
             FROM ${PEDIDOS_CAB_TABLE}
             WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
               AND TRIM(ESTADO) = 'BORRADOR'
             ORDER BY ID ASC`,
            [code],
            false,
        );
    } catch (err) {
        logger.warn(`[PEDIDOS] checkDraftAccumulation read error: ${err.message}`);
        return { warning: false, drafts: [], error: err.message, threshold: resolvedThreshold, count: 0 };
    }

    const count = (drafts || []).length;
    if (!resolvedThreshold || count < resolvedThreshold) {
        return {
            warning: false,
            drafts: drafts || [],
            count,
            threshold: resolvedThreshold,
            autoSendEnabled: resolvedThreshold > 0,
        };
    }

    const oldest = drafts[0];
    if (!autoConfirm) {
        return {
            warning: true,
            count,
            threshold: resolvedThreshold,
            autoSendEnabled: true,
            oldestId: oldest.ID,
            oldestNumber: oldest.NUMEROPEDIDO,
            message: `Tienes ${count} borradores acumulados (umbral ${resolvedThreshold}). Se recomienda confirmar el mas antiguo (#${oldest.NUMEROPEDIDO}).`,
            drafts,
        };
    }

    try {
        await confirmOrder(oldest.ID, 'CC', {
            ...options,
            userId: options.userId || 'AUTO_DRAFT_GUARD',
            forceConfirm: true,
        });
        logger.warn(`[PEDIDOS] Auto-confirmed draft #${oldest.NUMEROPEDIDO} (id=${oldest.ID}) por acumulacion (${count}, umbral=${resolvedThreshold})`);
        return {
            warning: true,
            autoConfirmed: true,
            autoConfirmedId: oldest.ID,
            autoConfirmedNumber: oldest.NUMEROPEDIDO,
            count,
            threshold: resolvedThreshold,
            autoSendEnabled: true,
            message: `Tenias ${count} borradores (umbral ${resolvedThreshold}). El mas antiguo (#${oldest.NUMEROPEDIDO}) se ha confirmado automaticamente.`,
            drafts,
        };
    } catch (confirmErr) {
        logger.error(`[PEDIDOS] checkDraftAccumulation auto-confirm failed for #${oldest.NUMEROPEDIDO}: ${confirmErr.message}`);
        return {
            warning: true,
            autoConfirmed: false,
            autoConfirmError: confirmErr.message,
            count,
            threshold: resolvedThreshold,
            autoSendEnabled: true,
            oldestId: oldest.ID,
            oldestNumber: oldest.NUMEROPEDIDO,
            drafts,
            message: `${count} borradores acumulados. No se pudo auto-confirmar el mas antiguo (${confirmErr.code || confirmErr.message}).`,
        };
    }
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
    lookupPedidoIdempotency,
    storePedidoIdempotency,
    createIdempotencyConflictError,
    createIdempotencyUnavailableError,
    resolveIdempotentCreateOrder,
    canonicalOrderStatus,
    publicOrderStatus,
    storedOrderStatus,
    isOrderTransitionAllowed,
    getOrderVendorForAuth,
    getOrderStatusForUpdate,
    assertOrderEditable,
    pedidosSchemaName,
    primaryPedidoCode,
    normalizePedidoActorCode,
    resolvePedidoActorCodes,
    resolvePedidoTerminal,
    formatPedidoNumeroAcisa,
    isAuthorizedForceConfirm,
    getPedidosConfirmationTarget,
    DELIVERY_DAY_ORDER,
    DAY_NAMES_BY_JS_INDEX,
    DAY_LABELS,
    DAY_SHORT,
    CRUT_DELIVERY_COLUMNS,
    LACLAE_DELIVERY_COLUMNS,
    normalizeDayName,
    normalizeDayList,
    deliveryDaysShort,
    yesFlag,
    pad2,
    parseDeliveryDate,
    formatDateDisplay,
    getNextDeliveryDate,
    deliveryDaysFromRows,
    checkDraftAccumulation,
};
