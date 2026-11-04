/**
 * PEDIDOS SERVICE (CommonJS)
 * ==========================
 * Service for order management (PEDIDOS module).
 * App buffers stay JAVIER by default; ERP reads/exports use explicit DSEDAC paths.
 */

const {
    parseLineDiscountPct,
    parseGlobalDiscountPct,
    resolveStoredPieDiscountPct,
    resolveStoredLineDiscountPct,
    applyPctToAmount,
    isCobroPropio,
} = require('./discounts');
const { roundPrice, trimString, OrderStateError, MAX_ORDER_LINES, DB2_BULK_INSERT_CHUNK_SIZE, STOCK_RESERVE_BULK_INSERT_CHUNK_SIZE, numberValue, integerValue, truncate, ERP_SCHEMA, PEDIDOS_CAB_TABLE, PEDIDOS_LIN_TABLE, PEDIDOS_SEQ_TABLE, PEDIDOS_STOCK_RESERVE_TABLE, DRAFT_STOCK_RESERVATION_HOURS, DRAFT_STOCK_RESERVATION_STATES_SQL, ACTIVE_STOCK_RESERVATION_CONDITION } = require('./_shared');
const orderLifecycle = require('./order-lifecycle');
const {
    appendOrderStateEvent,
    canonicalPayload,
    normalizeOriginalClientAt,
    payloadHash,
    readOrderStateTimeline,
} = require('./order-state-events');
const {
    withDraftCreationTransaction,
    withDraftMutationTransaction,
    withDraftPurgeTransaction,
    withLocalConfirmationTransaction,
} = require('./local-confirmation-transaction');
const { assertErpTariffFloorForOrder } = require('./erp-tariff-floor');
const promotions = require('./promotions');
const catalogAux = require('./catalog-aux');
const discovery = require('./discovery');
const similarity = require('./similarity');
const history = require('./history');
const { normalizeDayList, CRUT_DELIVERY_COLUMNS, deliveryDaysFromRows, LACLAE_DELIVERY_COLUMNS, getNextDeliveryDate, parseDeliveryDate, DAY_LABELS, formatDateDisplay, deliveryDaysShort, pad2, resolvePedidoActorCodes, normalizePedidoSaleType, getPedidosConfirmationTarget, resolvePedidoTerminal, normalizePedidoIdempotencyKey, generatePedidoIdempotencyKey, resolveIdempotentCreateOrder, storePedidoIdempotency, lookupPedidoIdempotency, createIdempotencyConflictError, createIdempotencyUnavailableError, publicOrderStatus, formatPedidoNumeroAcisa, assertOrderEditable, isAuthorizedForceConfirm, canonicalOrderStatus } = orderLifecycle;
const { getActivePromotionsV2 } = promotions;
const { getSimilarProducts } = similarity;
const { query, queryWithParams, getPool } = require('../../config/db');
const {
    db2QualifiedTableName,
    db2ColumnList,
    db2Placeholders,
    db2InsertSql,
} = require('../../utils/db2-identifiers');
const {
    db2AppTable,
    assertMoneyFitsWriteSchema,
} = require('../../utils/db2-schemas');
const {
    lockLocalCancellationGuards,
} = require('../../adapters/pedidos-local-order-state-guard');
const PRICING_CONFIG_SCHEMA = 'JAVIER';
const BOLSA_PRODUCT_PRICE_TABLE = `${PRICING_CONFIG_SCHEMA}.BOLSA_PRODUCTO_PRECIO`;
const { comercialErpTable } = require('../../utils/comercial-erp-tables');
const {
    isGiftLine,
    applyGiftPromotionsToLines,
    assertMinCobroAllowsOrder,
} = require('../pedidos-comercial-gates');
const CLIENT_SPECIAL_PRICE_TABLE = comercialErpTable('PES');
const CLIENT_UNIT_AMOUNT_PROMO_TABLE = comercialErpTable('PPU');
// App stock reserves are JAVIER-only (G2: no DSEDAC DML literals in deployable services).
// (SELECT_ORDER_VENDOR_FOR_AUTH_SQL era orphan sin uso aqui: single-source en ./_shared, consumida por order-states.)
const DELETE_STOCK_RESERVE_BY_PEDIDO_SQL =
    `DELETE FROM ${PEDIDOS_STOCK_RESERVE_TABLE} WHERE PEDIDO_ID = ?`;
const PURGEABLE_DRAFT_STATES = new Set([
    'BORRADOR',
    'PENDIENTE',
    'PEND_APROB',
    'PENDIENTE_APROBACION',
]);
const PURGEABLE_DRAFT_STATES_SQL =
    "'BORRADOR', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION'";
const logger = require('../../middleware/logger');
const { cachedQuery, invalidateOnMutation, patternFor } = require('../query-optimizer');
const { redisCache, TTL, deleteCachePattern } = require('../redis-cache');

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

/**
 * VDDX.PEDIDOSPENDIENTESSINCRONIZAR — umbral ERP de auto-envío.
 * isolated_test → JAVIER.TEST_VDDX (expand-contract); prod → DSEDAC.VDDX.
 * Semántica: 0 / NULL / ausente = auto-envío DESACTIVADO (sin default silencioso
 * en código). Para demo TEST, pinear umbral con
 * `node scripts/sync-test-vddx-autosync-threshold.js --apply --default-zero 3`.
 */
function vddxSyncThresholdTable() {
    if (String(process.env.REPARTO_TABLE_SET || '').trim().toLowerCase() === 'isolated_test') {
        return 'JAVIER.TEST_VDDX';
    }
    return comercialErpTable('VDDX');
}

async function getPedidosPendientesSyncThreshold(vendedorCode) {
    const code = truncate(vendedorCode, 2);
    if (!code) return 0;
    try {
        const rows = await queryWithParams(
            `SELECT PEDIDOSPENDIENTESSINCRONIZAR AS THRESHOLD
               FROM ${vddxSyncThresholdTable()}
              WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
              FETCH FIRST 1 ROW ONLY`,
            [code],
            false,
        );
        const raw = rows?.[0]?.THRESHOLD ?? rows?.[0]?.threshold;
        const threshold = parseInt(raw, 10);
        return Number.isFinite(threshold) && threshold > 0 ? threshold : 0;
    } catch (err) {
        logger.warn(`[PEDIDOS] VDDX sync threshold read failed: ${err.message}`);
        return 0;
    }
}

const PEDIDOS_ROUTE_CACHE_VERSION_NS = 'meta';
const PEDIDOS_ROUTE_CACHE_VERSION_KEY = 'pedidos:route:ver';

async function getPedidosRouteCacheVersion() {
    try {
        if (!redisCache || typeof redisCache.getRemote !== 'function') return '0';
        const remote = await redisCache.getRemote(PEDIDOS_ROUTE_CACHE_VERSION_NS, PEDIDOS_ROUTE_CACHE_VERSION_KEY);
        if (remote != null && remote !== '') return String(remote);
        const local = await redisCache.get(PEDIDOS_ROUTE_CACHE_VERSION_NS, PEDIDOS_ROUTE_CACHE_VERSION_KEY);
        return local == null || local === '' ? '0' : String(local);
    } catch {
        return '0';
    }
}

async function bumpPedidosRouteCacheVersion(reasonTag = '') {
    try {
        if (redisCache && typeof redisCache.incrementVersion === 'function') {
            await redisCache.incrementVersion(
                PEDIDOS_ROUTE_CACHE_VERSION_NS,
                PEDIDOS_ROUTE_CACHE_VERSION_KEY,
                TTL.LONG || 1800,
            );
            logger.info(`[PEDIDOS] Route cache version bump${reasonTag ? ` (${reasonTag})` : ''}`);
            return;
        }
    } catch (err) {
        logger.warn(`[PEDIDOS] Route cache version bump failed${reasonTag ? ` (${reasonTag})` : ''}: ${err.message}`);
    }
}

async function invalidateRuteroCachesAfterPedido(vendedorCode) {
    try {
        const code = String(vendedorCode || '').trim();
        // Single SCAN family for compound order-status v4 (+ legacy v3/app:* keys).
        // patternFor('rutero:orders', 2) → query:query:rutero:orders:*
        const patterns = [
            patternFor('rutero:orders', 2),
            'query:rutero:day:payload:v4:*',
        ];
        if (code) {
            const normalized = code.replace(/^0+/, '') || code;
            // Prefer scoped day-payload deletes when vendor known (narrower than *).
            patterns.length = 1; // keep orders family only
            patterns.push(
                `query:rutero:day:payload:v4:scope:${normalized}:primary:*`,
                `query:rutero:day:payload:v4:scope:${code}:primary:*`,
            );
        }
        await Promise.all(patterns.map((p) => deleteCachePattern(p).catch(() => 0)));
    } catch (err) {
        logger.warn(`[PEDIDOS] Rutero cache invalidation skipped: ${err.message}`);
    }
}
const { formatErpDocumentLabel } = require('../../utils/erp-document-label');
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
CREATE TABLE ${PEDIDOS_CAB_TABLE} (
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
CREATE TABLE ${PEDIDOS_LIN_TABLE} (
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

function isColumnNotFound(err) {
    const msg = (err.message || '').toLowerCase();
    const codes = (err.odbcErrors || []).map(e => e.code);
    const states = (err.odbcErrors || []).map(e => e.state);
    return codes.includes(-205) || states.includes('42S22') || msg.includes('sql0205') || msg.includes('column not found');
}

function isDuplicateKeyError(err) {
    const msg = String(err?.message || '');
    const odbcErrors = Array.isArray(err?.odbcErrors) ? err.odbcErrors : [];
    const hasDuplicateState = odbcErrors.some((item) =>
        String(item?.state || '').toUpperCase() === '23505'
        || Number(item?.code) === -803
    );
    return hasDuplicateState || /DUPLICATE|PRIMARY|UNIQUE|SQL0803/i.test(msg);
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

function resolveServerLineUnitPrice({
    clientTariff,
    precioMinimo,
    requestedPrice,
    userRole,
    motivo,
    articleCode,
    isGift = false,
}) {
    if (isGift === true) return 0;
    const tariff = roundPrice(clientTariff);
    const min = roundPrice(precioMinimo);
    const requested = roundPrice(requestedPrice);
    void userRole;
    void motivo;
    const unit = requested > 0 ? requested : (tariff > 0 ? tariff : (min > 0 ? min : 0));
    if (unit <= 0) {
        const err = new Error(`Sin tarifa servidor para ${articleCode || 'articulo'}`);
        err.status = 422;
        err.code = 'PRICE_UNAVAILABLE';
        throw err;
    }
    return unit;
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

    const priceFields = ['precioTarifa1', 'precioMinimo', 'precioCliente', 'precioTarifaCliente', 'precioCompetitivo', 'precioMinimoPolitica'];
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
            FROM ${comercialErpTable('CRUT')}
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
            return { days: crutDays, source: comercialErpTable('CRUT') };
        }
        if (cleanVendor) {
            const allVendorRows = await queryWithParams(`
                SELECT DIAREPARTOLUNESSN, DIAREPARTOMARTESSN, DIAREPARTOMIERCOLESSN,
                       DIAREPARTOJUEVESSN, DIAREPARTOVIERNESSN, DIAREPARTOSABADOSN,
                       DIAREPARTODOMINGOSN
                FROM ${comercialErpTable('CRUT')}
                WHERE TRIM(CODIGOCLIENTE) = ?
                  AND COALESCE(TRIM(MARCAACTUALIZACION), '') <> 'B'
                ORDER BY SECUENCIA
                FETCH FIRST 10 ROWS ONLY`,
                [cleanClient],
                false
            );
            const allCrutDays = deliveryDaysFromRows(allVendorRows, CRUT_DELIVERY_COLUMNS);
            if (allCrutDays.length > 0) {
                return { days: allCrutDays, source: comercialErpTable('CRUT') };
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
            FROM ${comercialErpTable('LACLAE')}
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
                FROM ${comercialErpTable('LACLAE')}
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
            return { days: laclaeDays, source: comercialErpTable('LACLAE') };
        }
        if (cleanVendor) {
            const allLaclaeDays = deliveryDaysFromRows(allVendorRows, LACLAE_DELIVERY_COLUMNS);
            if (allLaclaeDays.length > 0) {
                return { days: allLaclaeDays, source: comercialErpTable('LACLAE') };
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
        driverName: trimString(row.NOMBREVENDEDOR || row.DRIVERNAME),
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
              FROM ${comercialErpTable('CLI')} CLI
              LEFT JOIN ${comercialErpTable('CLC')} CLC
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
        // Version bump invalidates route-namespace catalog keys without SCAN.
        await bumpPedidosRouteCacheVersion(reasonTag || 'stock');
        // One SCAN for cachedQuery keys under query:query:pedidos:* (not multi-pattern).
        if (redisCache && typeof redisCache.invalidatePattern === 'function') {
            await redisCache.invalidatePattern('query:query:pedidos:*');
        }
    } catch (err) {
        logger.warn(`[PEDIDOS] Stock cache invalidation skipped${reasonTag ? ` (${reasonTag})` : ''}: ${err.message}`);
    }
}

async function getDefaultTruckAssignment({ clientCode, vendedorCode, deliveryDate: _deliveryDate, routeCode }) {
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
                   TRIM(VDD.NOMBREVENDEDOR) AS NOMBREVENDEDOR,
                   COUNT(*) AS USOS,
                   MAX(OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) AS ULTIMA_FECHA
            FROM ${comercialErpTable('OPP')} OPP
            LEFT JOIN ${comercialErpTable('CPC')} CPC
              ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
             AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
            LEFT JOIN ${comercialErpTable('VEH')} VEH ON TRIM(VEH.CODIGOVEHICULO) = TRIM(OPP.CODIGOVEHICULO)
            LEFT JOIN ${comercialErpTable('VDD')} VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            WHERE (TRIM(CPC.CODIGOCLIENTEALBARAN) = ?${vendorFilter})
              AND OPP.ANOREPARTO >= YEAR(CURRENT DATE) - 1
              AND TRIM(OPP.CODIGOVEHICULO) <> ''
            GROUP BY TRIM(OPP.CODIGOVEHICULO), TRIM(OPP.CODIGOREPARTIDOR),
                     TRIM(CPC.CODIGORUTA), TRIM(VEH.MATRICULA), TRIM(VEH.DESCRIPCIONVEHICULO),
                     TRIM(VDD.NOMBREVENDEDOR)
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
                source: comercialErpTable('OPP'),
            };
        }
    } catch (error) {
        logger.warn(`[PEDIDOS] Default truck lookup failed for ${cleanClient}/${cleanVendor}: ${error.message}`);
    }

    const defaults = explicitRouteCode ? {} : await getClientOrderDefaults(cleanClient);
    return {
        vehicleCode: '',
        driverCode: '',
        driverName: '',
        vehicleMatricula: '',
        vehicleDescription: '',
        routeCode: explicitRouteCode || defaults.routeCode || '',
        confidence: 'sin-datos',
        source: defaults.routeCode ? comercialErpTable('CLI') : 'none',
    };
}

async function getDeliveryOptions({ clientCode, vendedorCode, deliveryDate }) {
    if (!clientCode || !vendedorCode) {
        throw new Error('clientCode and vendedorCode are required');
    }

    const cleanClient = trimString(clientCode).substring(0, 10);
    const cleanVendor = trimString(vendedorCode).split(',')[0].substring(0, 2);
    const cleanDate = deliveryDate ? trimString(deliveryDate).substring(0, 10) : '';
    const cacheKey = `pedidos:delivery-options:${await getPedidosRouteCacheVersion()}:${cleanClient}:${cleanVendor}:${cleanDate || 'next'}`;
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
        driverName: assignment.driverName || '',
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
                TRIM(D.NOMBREVENDEDOR) AS driverName,
                V.TONELADAS      AS toneladas,
                V.CARGAMAXIMA    AS cargaMaxima
            FROM ${comercialErpTable('VEH')} V
            LEFT JOIN ${comercialErpTable('VDD')} D
              ON TRIM(D.CODIGOVENDEDOR) = TRIM(V.CODIGOCONDUCTOR)
            ORDER BY V.CODIGOVEHICULO
        `;
        const rows = await queryWithParams(sql, []);
        return (rows || []).map(row => ({
            code:        trimString(row.CODE        || row.code        || '').substring(0, 10),
            matricula:   trimString(row.MATRICULA   || row.matricula   || ''),
            description: trimString(row.DESCRIPTION || row.description || ''),
            driverCode:  trimString(row.DRIVERCODE  || row.driverCode  || '').substring(0, 2),
            driverName:  trimString(row.DRIVERNAME  || row.driverName  || row.NOMBREVENDEDOR || row.nombrevendedor || ''),
            toneladas:   numberValue(row.TONELADAS  || row.toneladas),
            cargaMaxima: numberValue(row.CARGAMAXIMA|| row.cargaMaxima),
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] getAvailableVehicles error: ${error.message}`);
        return [];
    }
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

// REQ-02.3: strip diacritics so "jamon" matches "JAMÓN". Mirrors the
// TRANSLATE() applied to the DB2 column in getProducts. Pure function,
// no SQL involved — safe to run before binding.
function normalizeSearchTerm(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
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

const PRICE_SCALE_UNITS = 10000n;
const PERCENT_100_SCALE_UNITS = 1000000n;
const DECIMAL_11_4_MAX_UNITS = 99999999999n;

function parseScaleFourUnits(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text) return null;
    const match = /^([+-]?)(\d+)(?:\.(\d{0,4}))?$/.exec(text);
    if (!match) return null;

    const fraction = (match[3] || '').padEnd(4, '0');
    const absoluteUnits = (BigInt(match[2]) * PRICE_SCALE_UNITS) + BigInt(fraction || '0');
    return match[1] === '-' ? -absoluteUnits : absoluteUnits;
}

function grossMarginFloorOverflowError() {
    const error = new Error('El suelo de margen excede la precision monetaria admitida.');
    error.code = 'GROSS_MARGIN_FLOOR_OVERFLOW';
    error.status = 422;
    return error;
}

function assertDecimalElevenFour(units) {
    if (units > DECIMAL_11_4_MAX_UNITS) throw grossMarginFloorOverflowError();
    return units;
}

function effectiveMinPriceFromRow(row = {}) {
    const configuredUnits = parseScaleFourUnits(row.PRECIO_MINIMO ?? row.precioMinimo);
    const safeConfiguredUnits = configuredUnits !== null && configuredUnits > 0n
        ? assertDecimalElevenFour(configuredUnits)
        : 0n;
    const costUnits = parseScaleFourUnits(row.COSTE_FABRICACION ?? row.costeFabricacion);
    const marginUnits = parseScaleFourUnits(row.MARGEN_OBJETIVO_PCT ?? row.margenObjetivoPct);

    let marginFloorUnits = 0n;
    if (costUnits !== null && costUnits > 0n
        && marginUnits !== null && marginUnits >= 0n
        && marginUnits < PERCENT_100_SCALE_UNITS) {
        const denominator = PERCENT_100_SCALE_UNITS - marginUnits;
        const numerator = costUnits * PERCENT_100_SCALE_UNITS;
        marginFloorUnits = assertDecimalElevenFour(
            (numerator + denominator - 1n) / denominator,
        );
    }

    const effectiveUnits = safeConfiguredUnits > marginFloorUnits
        ? safeConfiguredUnits
        : marginFloorUnits;
    return Number(effectiveUnits) / Number(PRICE_SCALE_UNITS);
}

function resolveMargenObjetivoPct(row) {
    const fromRow = parseFloat(row?.MARGEN_OBJETIVO_PCT ?? row?.margenObjetivoPct);
    if (Number.isFinite(fromRow) && fromRow > 0 && fromRow < 100) return fromRow;
    const fromEnv = parseFloat(process.env.MARGEN_OBJETIVO_PCT);
    if (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv < 100) return fromEnv;
    return 20;
}

function resolvePrecioMinimoPolitica(competitivo, margenPct) {
    const comp = roundPrice(competitivo);
    const margin = parseFloat(margenPct);
    if (!(comp > 0) || !(margin > 0) || !(margin < 100)) return 0;
    return roundPrice(comp / (1 - margin / 100));
}

const PRECIO_HISTORICO_TEST_TABLE = null;

function savePrecioHistoricoTEST({ clientCode, lines }) {
    void clientCode;
    void lines;
    return Promise.resolve(0);
}

async function getPrecioHistoricoTEST({ clientCode, articleCode }) {
    try {
        const rows = await queryWithParams(
            `SELECT L.PRECIOVENTA,
                    C.CREATED_AT AS FECHA
               FROM ${PEDIDOS_CAB_TABLE} C
               JOIN ${PEDIDOS_LIN_TABLE} L ON L.PEDIDO_ID = C.ID
              WHERE TRIM(C.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
                AND TRIM(L.CODIGOARTICULO) = ?
                AND TRIM(C.ESTADO) = 'CONFIRMADO'
                AND L.PRECIOVENTA > 0
                AND TRIM(COALESCE(L.CLASELINEA, 'VT')) NOT IN ('G', 'SC')
              ORDER BY C.CREATED_AT DESC, C.ID DESC, L.ID DESC
              FETCH FIRST 2 ROWS ONLY`,
            [truncate(clientCode, 10), truncate(articleCode, 10)],
            false,
        );
        return Array.isArray(rows) ? rows : [];
    } catch (err) {
        logger.warn(`[PEDIDOS] TEST historico precios read skip: ${err.message}`);
        return [];
    }
}

function mergeConfiguredPricing(product, productPricing, clientPrice, competitivePrice) {
    const next = { ...product };

    if (productPricing) {
        const configuredMin = effectiveMinPriceFromRow(productPricing);
        const manufacturingCost = roundPrice(productPricing.COSTE_FABRICACION ?? 0);
        const lockedFloor = roundPrice(productPricing.PRECIO_MINIMO ?? 0);
        const marginPct = resolveMargenObjetivoPct(productPricing);

        next.precioMinimoBase = lockedFloor;
        next.costeFabricacion = manufacturingCost;
        next.margenObjetivoPct = marginPct;
        next.precioMinimoCalculado = configuredMin;
        next.precioMinimoSource = BOLSA_PRODUCT_PRICE_TABLE;

        if (configuredMin > 0) next.precioMinimo = configuredMin;
        if (manufacturingCost > 0) next.precioCosto = manufacturingCost;
    }

    if (competitivePrice?.found === true) {
        next.precioCompetitivo = roundPrice(competitivePrice.precioCompetitivo);
        next.margenCompetitivoPct = Number(competitivePrice.margenPct);
        next.precioCompetitivoSource = 'JAVIER.TEST_PRECIO_COMPETITIVO';
        next.precioCompetitivoValidoDesde = competitivePrice.validoDesde;
        next.precioCompetitivoValidoHasta = competitivePrice.validoHasta;
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

function resolveAuthoritativeLinePricing({
    line,
    articleCode,
    clientTariff,
    serverMin,
    productPricing,
    clientPrice,
    userRole,
}) {
    const submitted = line && typeof line === 'object' ? line : {};
    const normalizedArticleCode = truncate(articleCode, 10);
    const authoritativePricing = mergeConfiguredPricing(
        {
            code: normalizedArticleCode,
            precioTarifa1: clientTariff,
            precioCliente: clientTariff,
            precioTarifaCliente: clientTariff,
            precioMinimo: serverMin,
        },
        productPricing,
        clientPrice,
    );
    const authoritativeReference = roundPrice(
        authoritativePricing.precioTarifaCliente || clientTariff,
    );
    const giftLine = isGiftLine(submitted);
    if (!giftLine && authoritativeReference <= 0) {
        const error = new Error(
            `No hay un precio ERP vigente para ${normalizedArticleCode}. Actualiza el catálogo antes de continuar.`,
        );
        error.code = 'ORDER_PRICE_UNAVAILABLE';
        error.status = 503;
        error.articleCode = normalizedArticleCode;
        throw error;
    }
    const quotedReference = roundPrice(submitted.precioTarifaCliente);
    if (quotedReference > 0 && authoritativeReference > 0
        && Math.abs(quotedReference - authoritativeReference) > 0.0001) {
        const error = new Error(
            `El precio de referencia de ${normalizedArticleCode} cambió de ${quotedReference} a ${authoritativeReference}. Revisa el pedido.`,
        );
        error.code = 'ORDER_PRICE_SNAPSHOT_STALE';
        error.status = 409;
        error.articleCode = normalizedArticleCode;
        error.quotedPrice = quotedReference;
        error.currentPrice = authoritativeReference;
        throw error;
    }

    const configuredCost = roundPrice(productPricing?.COSTE_FABRICACION);
    const verifiedGiftCost = giftLine && submitted.precioCostoVerificado === true
        ? roundPrice(submitted.precioCosto)
        : 0;
    const verifiedCost = configuredCost > 0 ? configuredCost : verifiedGiftCost;
    const authoritativeLine = {
        ...submitted,
        precioTarifa: roundPrice(clientTariff),
        precioTarifaCliente: authoritativeReference,
        precioMinimo: authoritativePricing.precioMinimo || roundPrice(serverMin),
        precioEspecialCliente: authoritativePricing.precioEspecialCliente === true,
        permiteBajoMinimo: authoritativePricing.permiteBajoMinimo === true,
        precioClienteSource: authoritativePricing.precioClienteSource || '',
        precioEspecialMotivo: authoritativePricing.precioEspecialMotivo || '',
        precioCosto: verifiedCost,
        importeCosto: undefined,
        precioCostoVerificado: verifiedCost > 0,
        precioCostoSource: configuredCost > 0
            ? BOLSA_PRODUCT_PRICE_TABLE
            : (verifiedGiftCost > 0 ? comercialErpTable('LAC') : ''),
    };
    const salePrice = resolveServerLineUnitPrice({
        clientTariff: authoritativeReference,
        precioMinimo: authoritativeLine.precioMinimo,
        requestedPrice: parseFloat(submitted.precio) || parseFloat(submitted.precioVenta) || 0,
        userRole,
        motivo: submitted.motivoPrecio || submitted.motivo,
        articleCode: normalizedArticleCode,
        isGift: giftLine,
    });

    return {
        line: authoritativeLine,
        price: salePrice,
        referencePrice: authoritativeReference,
        pricing: authoritativePricing,
    };
}

function calculateVerifiedCostMetrics({ importeVenta, billingQty, precioCosto, costVerified }) {
    if (costVerified !== true) {
        return { importeCosto: 0, importeMargen: 0, pctMargen: 0 };
    }
    const importeCosto = Math.round(
        ((Number(billingQty) || 0) * (Number(precioCosto) || 0)) * 100,
    ) / 100;
    const importeMargen = roundMoney((Number(importeVenta) || 0) - importeCosto);
    const pctMargen = Number(importeVenta) > 0
        ? (importeMargen / Number(importeVenta)) * 100
        : 0;
    return { importeCosto, importeMargen, pctMargen };
}

async function getConfiguredPricingMaps(articleCodes, clientCode) {
    const codes = [...new Set((articleCodes || []).map(code => truncate(code, 10)).filter(Boolean))];
    if (codes.length === 0) return { productPricing: new Map(), clientPrices: new Map(), competitivePrices: new Map() };

    const productPricing = new Map();
    const clientPrices = new Map();
    const competitivePrices = new Map();
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
    if (!trimClient) return { productPricing, clientPrices, competitivePrices };

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
            FROM ${comercialErpTable('CLP')} C
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
                    '${comercialErpTable('LINDTO')}' AS SOURCE,
                    ROW_NUMBER() OVER (
                        PARTITION BY TRIM(L.CODIGOARTICULO)
                        ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC, L.NUMERODOCUMENTO DESC
                    ) AS RN
                FROM ${comercialErpTable('LINDTO')} L
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

    try {
        const competitiveService = require('../precio-competitivo-service').createPrecioCompetitivoService();
        const rows = await competitiveService.lookupBatch({
            articleCodes: codes,
            codigoCliente: trimClient,
        });
        for (const row of rows) competitivePrices.set(row.codigoArticulo, row);
    } catch (error) {
        logger.warn(`[PEDIDOS] Precio competitivo TEST no disponible: ${error.code || 'UNKNOWN'}`);
    }

    return { productPricing, clientPrices, competitivePrices };
}

async function applyConfiguredPricingToProducts(products, clientCode) {
    if (!Array.isArray(products) || products.length === 0) return products;
    const maps = await getConfiguredPricingMaps(products.map(p => p.code), clientCode);
    return products.map((product) => {
        const code = String(product.code || '').trim();
        return mergeConfiguredPricing(
            product,
            maps.productPricing.get(code),
            maps.clientPrices.get(code),
            maps.competitivePrices.get(code),
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

function buildDsedacCpcInsert({ target, header, systemRef, deliveryPlan, routeCode, saleType: _saleType, userId: _userId, vehicleCode: _vehicleCode, driverCode: _driverCode }) {
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
        'PORCENTAJEDESCUENTO1',
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
        parseGlobalDiscountPct(header),
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

function buildDsedacLpcInsert({ target, header, line, systemRef, deliveryPlan: _deliveryPlan, routeCode, saleType, userId: _userId }) {
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
        'CANTIDADENVASES', 'CANTIDADUNIDADES', 'PRECIOVENTA', 'PORCENTAJEDESCUENTO', 'IMPORTEVENTA',
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
        parseLineDiscountPct(line),
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

function buildDsedacOcpcInsert({ target, header, systemRef, userId: _userId }) {
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

function exportCommercialOrderToSystem(conn, { header, lines, deliveryPlan, routeCode, saleType, userId, vehicleCode, driverCode }) {
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
    let sql = `UPDATE ${PEDIDOS_CAB_TABLE} SET ESTADO = 'CONFIRMADO',
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

function affectedRowCount(result) {
    if (result && typeof result.count === 'number') return result.count;
    return typeof result === 'number' ? result : null;
}

function confirmationStateError(state) {
    const confirming = state === 'CONFIRMANDO';
    const error = new Error(confirming
        ? 'Pedido ya confirmado o en proceso de confirmacion por otra sesion'
        : `Solo se pueden confirmar pedidos en estado BORRADOR (estado actual: ${state})`);
    error.code = confirming ? 'PEDIDO_ALREADY_CONFIRMING' : 'PEDIDO_INVALID_STATE';
    error.status = 409;
    return error;
}

async function readConfirmationState(queryFn, id) {
    const rows = await queryFn(
        `SELECT TRIM(ESTADO) AS ESTADO FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`,
        [id],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
        const error = new Error('Pedido no encontrado');
        error.code = 'PEDIDO_NOT_FOUND';
        error.status = 404;
        throw error;
    }
    return trimString(rows[0].ESTADO).toUpperCase();
}

async function assertHeaderStateAfterUnknownUpdate(queryFn, id, expectedState, errorMessage) {
    const state = canonicalOrderStatus(await readConfirmationState(queryFn, id));
    if (state !== expectedState) {
        throw new OrderStateError('PEDIDO_STATE_CONFLICT', errorMessage, 409);
    }
}

async function claimLocalOrderForConfirmation(queryFn, id) {
    const initialState = await readConfirmationState(queryFn, id);
    if (initialState === 'CONFIRMADO') {
        return { idempotentReplay: true };
    }
    if (!['BORRADOR', 'PEND_APROB'].includes(initialState)) {
        throw confirmationStateError(initialState);
    }

    const claimResult = await queryFn(
        `UPDATE ${PEDIDOS_CAB_TABLE}
            SET ESTADO = 'CONFIRMANDO', UPDATED_AT = CURRENT_TIMESTAMP
          WHERE ID = ? AND ESTADO IN ('BORRADOR', 'PEND_APROB')`,
        [id],
    );
    const claimedRows = affectedRowCount(claimResult);
    if (claimedRows === 0) {
        const currentState = await readConfirmationState(queryFn, id);
        if (currentState === 'CONFIRMADO') return { idempotentReplay: true };
        throw confirmationStateError(currentState);
    }
    if (claimedRows === null) {
        const currentState = await readConfirmationState(queryFn, id);
        if (currentState !== 'CONFIRMANDO') {
            if (currentState === 'CONFIRMADO') return { idempotentReplay: true };
            throw confirmationStateError(currentState);
        }
    }
    return { idempotentReplay: false };
}

function readOrderLinesForMutation(queryFn, id) {
    return queryFn(
        `SELECT ID, PEDIDO_ID, SECUENCIA,
                TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
                TRIM(DESCRIPCION) AS DESCRIPCION,
                CANTIDADENVASES, CANTIDADUNIDADES,
                TRIM(UNIDADMEDIDA) AS UNIDADMEDIDA, UNIDADESCAJA,
                PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
                IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
                COALESCE(DESCUENTO_LINEA, 0) AS DESCUENTO_LINEA,
                COALESCE(PORCENTAJEDESCUENTO, 0) AS PORCENTAJEDESCUENTO,
                TRIM(TIPOLINEA) AS TIPOLINEA,
                TRIM(TIPOVENTA) AS TIPOVENTA,
                TRIM(CLASELINEA) AS CLASELINEA,
                TRIM(COALESCE(CODIGOIVA, '2')) AS CODIGOIVA,
                ORDEN
           FROM ${PEDIDOS_LIN_TABLE}
          WHERE PEDIDO_ID = ?
          ORDER BY SECUENCIA, ID`,
        [id],
    );
}

function rehydrateLockedPricingProvenance(lines, configuredPricing) {
    return (lines || []).map((line) => {
        const code = truncate(line.CODIGOARTICULO || line.codigoArticulo, 10);
        const productPricing = configuredPricing?.productPricing?.get(code);
        const clientPrice = configuredPricing?.clientPrices?.get(code);
        const authoritative = mergeConfiguredPricing({
            ...line,
            code,
            precioTarifa: Number(line.PRECIOTARIFA) || 0,
            precioTarifaCliente: Number(line.PRECIOTARIFACLIENTE) || 0,
            precioMinimo: Number(line.PRECIOMINIMO) || 0,
        }, productPricing, clientPrice);
        return {
            ...line,
            PRECIOCLIENTESOURCE: authoritative.precioClienteSource || '',
            PRECIOESPECIALCLIENTE: authoritative.precioEspecialCliente === true,
            PERMITEBAJOMINIMO: authoritative.permiteBajoMinimo === true,
            PRECIOTARIFACLIENTE: Number(authoritative.precioTarifaCliente)
                || Number(line.PRECIOTARIFACLIENTE)
                || 0,
            PRECIOMINIMO: Number(authoritative.precioMinimo)
                || Number(line.PRECIOMINIMO)
                || 0,
            PRECIOCOSTO: Number(authoritative.precioCosto)
                || Number(line.PRECIOCOSTO)
                || 0,
        };
    });
}

async function refreshDraftReservationWithStockCheck(queryFn, id) {
    const lines = await readOrderLinesForMutation(queryFn, id);
    const stock = await getStockBatch(
        lines.map((line) => line.CODIGOARTICULO),
        1,
        { excludePedidoId: id, queryFn },
    );
    const availability = evaluateStockAvailability(lines, stock);
    if (availability.stockWarnings.length > 0) {
        const error = new Error('Stock insuficiente para guardar los cambios del borrador.');
        error.code = 'STOCK_CHANGED_DURING_DRAFT_EDIT';
        error.status = 409;
        error.stockWarnings = availability.stockWarnings;
        throw error;
    }
    await refreshDraftStockReservation(id, queryFn);
    return lines;
}

function withEditableDraftMutation(orderId, callback) {
    return withDraftMutationTransaction(async (conn) => {
        const queryFn = (sql, params) => conn.query(sql, params);
        await assertOrderEditable(orderId, queryFn);
        return callback(queryFn);
    });
}

async function readOrderAuditHeader(queryFn, orderId) {
    const headers = await queryFn(
        `SELECT ID, TRIM(ESTADO) AS ESTADO,
                EJERCICIO, NUMEROPEDIDO, TRIM(SERIEPEDIDO) AS SERIEPEDIDO, TERMINAL,
                DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
                TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE, TRIM(NOMBRECLIENTE) AS NOMBRECLIENTE,
                TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR,
                TRIM(CODIGOFORMAPAGO) AS CODIGOFORMAPAGO,
                CODIGOTARIFA, CODIGOALMACEN, TRIM(TIPOVENTA) AS TIPOVENTA,
                IMPORTETOTAL, IMPORTEBASE, IMPORTEIVA, IMPORTECOSTO, IMPORTEMARGEN,
                COALESCE(DESCUENTO_GLOBAL, 0) AS DESCUENTO_GLOBAL,
                COALESCE(PORCENTAJEDESCUENTO1, 0) AS PORCENTAJEDESCUENTO1,
                TRIM(COALESCE(OBSERVACIONES, '')) AS OBSERVACIONES,
                FECHAREPARTO, DIAREPARTO, MESREPARTO, ANOREPARTO,
                TRIM(COALESCE(CODIGOREPARTIDOR, '')) AS CODIGOREPARTIDOR,
                TRIM(COALESCE(CODIGOVEHICULO, '')) AS CODIGOVEHICULO,
                TRIM(COALESCE(RUTA, '')) AS RUTA
           FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`,
        [orderId],
    );
    if (!Array.isArray(headers) || headers.length !== 1) {
        throw new OrderStateError('ORDER_NOT_FOUND', 'Pedido no encontrado', 404);
    }
    return headers[0];
}

async function readOrderAuditSnapshot(queryFn, orderId) {
    const [header, lines] = await Promise.all([
        readOrderAuditHeader(queryFn, orderId),
        readOrderLinesForMutation(queryFn, orderId),
    ]);
    return { header, lines: lines || [] };
}

function appendDraftMutationAudit(queryFn, {
    orderId,
    event,
    before,
    after,
    context = {},
}) {
    const payload = { event, before, after };
    const digest = payloadHash(canonicalPayload(payload)).slice(0, 24);
    const clientDigest = context.idempotencyKey
        ? payloadHash(canonicalPayload({ clientKey: String(context.idempotencyKey) })).slice(0, 24)
        : digest;
    return appendOrderStateEvent(queryFn, {
        pedidoId: orderId,
        fromState: 'BORRADOR',
        toState: 'BORRADOR',
        actorId: context.actorId || context.userId || 'SYSTEM',
        actorRole: context.actorRole || context.userRole,
        deviceId: context.deviceId,
        reason: context.reason,
        idempotencyKey: `pedido-${orderId}-${event.toLowerCase()}-${clientDigest}`,
        originalClientAt: context.originalClientAt,
        payload,
    });
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
        table: PEDIDOS_STOCK_RESERVE_TABLE,
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
        `DELETE FROM ${PEDIDOS_STOCK_RESERVE_TABLE} WHERE PEDIDO_ID = ?`,
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
    const id = parseInt(orderId, 10);
    if (isNaN(id)) throw new Error('Invalid orderId');
    const lines = await executor(
        `SELECT TRIM(L.CODIGOARTICULO) AS CODIGOARTICULO,
                SUM(L.CANTIDADENVASES) AS CANTIDADENVASES,
                SUM(L.CANTIDADUNIDADES) AS CANTIDADUNIDADES
           FROM ${PEDIDOS_LIN_TABLE} L
           JOIN ${PEDIDOS_CAB_TABLE} C ON C.ID = L.PEDIDO_ID
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
    if (String(process.env.REPARTO_TABLE_SET || '').toLowerCase() === 'isolated_test') {
        // TEST auxiliary tables are provisioned only by the approved DDL plan.
        // Never bootstrap or alter shared tables from an isolated runtime.
        return;
    }
    const pool = getPool();
    if (!pool) { logger.warn('[PEDIDOS] No DB pool available for init'); return; }

    const [pedidosCabSchema, pedidosCabTable] = PEDIDOS_CAB_TABLE.split('.');
    const [pedidosLinSchema, pedidosLinTable] = PEDIDOS_LIN_TABLE.split('.');
    const tables = [
        { schema: pedidosCabSchema, table: pedidosCabTable, name: PEDIDOS_CAB_TABLE, ddl: CREATE_PEDIDOS_CAB },
        { schema: pedidosLinSchema, table: pedidosLinTable, name: PEDIDOS_LIN_TABLE, ddl: CREATE_PEDIDOS_LIN },
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
            { table: 'PEDIDOS_CAB', name: 'DESCUENTO_GLOBAL', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN DESCUENTO_GLOBAL DECIMAL(5,2) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'ORIGEN', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN ORIGEN CHAR(1) DEFAULT 'A'` },
            { table: 'PEDIDOS_CAB', name: 'FECHAREPARTO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN FECHAREPARTO DATE` },
            { table: 'PEDIDOS_CAB', name: 'DIAREPARTO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN DIAREPARTO NUMERIC(2) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'MESREPARTO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN MESREPARTO NUMERIC(2) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'ANOREPARTO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN ANOREPARTO NUMERIC(4) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'CODIGOREPARTIDOR', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN CODIGOREPARTIDOR CHAR(2) DEFAULT ' '` },
            { table: 'PEDIDOS_CAB', name: 'CODIGOVEHICULO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN CODIGOVEHICULO CHAR(10) DEFAULT ' '` },
            { table: 'PEDIDOS_CAB', name: 'RUTA', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN RUTA VARCHAR(10) DEFAULT ''` },
            { table: 'PEDIDOS_CAB', name: 'DIASREPARTO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN DIASREPARTO VARCHAR(80) DEFAULT ''` },
            { table: 'PEDIDOS_CAB', name: 'REPARTO_VALIDADO_SN', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN REPARTO_VALIDADO_SN CHAR(1) DEFAULT 'N'` },
            { table: 'PEDIDOS_CAB', name: 'REPARTO_VALIDADO_AT', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN REPARTO_VALIDADO_AT TIMESTAMP` },
            { table: 'PEDIDOS_CAB', name: 'TARGET_SCHEMA', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN TARGET_SCHEMA CHAR(10) DEFAULT 'JAVIER'` },
            { table: 'PEDIDOS_CAB', name: 'SYNC_STATUS', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN SYNC_STATUS VARCHAR(16) DEFAULT 'LOCAL'` },
            { table: 'PEDIDOS_CAB', name: 'SYNC_AT', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN SYNC_AT TIMESTAMP` },
            { table: 'PEDIDOS_CAB', name: 'SYSTEM_SUBEMPRESAPEDIDO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN SYSTEM_SUBEMPRESAPEDIDO CHAR(3) DEFAULT ' '` },
            { table: 'PEDIDOS_CAB', name: 'SYSTEM_EJERCICIOPEDIDO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN SYSTEM_EJERCICIOPEDIDO NUMERIC(4) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'SYSTEM_SERIEPEDIDO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN SYSTEM_SERIEPEDIDO CHAR(1) DEFAULT ' '` },
            { table: 'PEDIDOS_CAB', name: 'SYSTEM_TERMINALPEDIDO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN SYSTEM_TERMINALPEDIDO NUMERIC(3) DEFAULT 0` },
            { table: 'PEDIDOS_CAB', name: 'SYSTEM_NUMEROPEDIDO', ddl: `ALTER TABLE ${PEDIDOS_CAB_TABLE} ADD COLUMN SYSTEM_NUMEROPEDIDO NUMERIC(6) DEFAULT 0` },
            { table: 'PEDIDOS_LIN', name: 'DESCUENTO_LINEA', ddl: `ALTER TABLE ${PEDIDOS_LIN_TABLE} ADD COLUMN DESCUENTO_LINEA DECIMAL(5,2) DEFAULT 0` },
            { table: 'PEDIDOS_LIN', name: 'PORCENTAJEDESCUENTO', ddl: `ALTER TABLE ${PEDIDOS_LIN_TABLE} ADD COLUMN PORCENTAJEDESCUENTO NUMERIC(5,2) DEFAULT 0` },
            { table: 'PEDIDOS_LIN', name: 'UNIDADESFRACCION', ddl: `ALTER TABLE ${PEDIDOS_LIN_TABLE} ADD COLUMN UNIDADESFRACCION NUMERIC(10,5) DEFAULT 0` },
            { table: 'PEDIDOS_LIN', name: 'CODIGOIVA', ddl: `ALTER TABLE ${PEDIDOS_LIN_TABLE} ADD COLUMN CODIGOIVA CHAR(1) DEFAULT '2'` },
        ];

        for (const col of additiveColumns) {
            const targetSchema = col.table === 'PEDIDOS_LIN' ? pedidosLinSchema : pedidosCabSchema;
            const targetTable = col.table === 'PEDIDOS_LIN' ? pedidosLinTable : pedidosCabTable;
            try {
                if (await columnExists(conn, targetSchema, targetTable, col.name)) continue;
                await conn.query(col.ddl);
                logger.info(`[PEDIDOS] Added missing ${col.name} column to ${targetSchema}.${targetTable}`);
            } catch (colErr) {
                logger.warn(`[PEDIDOS] Could not add ${col.name} column to ${targetTable}: ${colErr.message}`);
                try { await conn.close(); } catch { /* ignore */ }
                conn = await pool.connect();
            }
        }
    } catch (err) {
        logger.error(`[PEDIDOS] Table init error: ${err.message}`);
    } finally {
        if (conn) try { await conn.close(); } catch { /* ignore */ }
    }
}

// ============================================================================
// PRODUCTS
// ============================================================================

function buildCatalogRankOrderClause(sortBy, sortOrder) {
    const dir = String(sortOrder || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const field = String(sortBy || 'purchases').toLowerCase().trim();
    switch (field) {
        case 'name':
            return `A.DESCRIPCIONARTICULO ${dir}, TRIM(A.CODIGOARTICULO) ASC`;
        case 'purchases':
        default:
            if (dir === 'DESC') {
                // Más compra primero (importe histórico TY+PY), comprados antes que nuevos.
                return `CASE WHEN COALESCE(PH.PURCHASE_COUNT, 0) > 0 THEN 0 ELSE 1 END ASC,
                        (COALESCE(PH.SALES_THIS_YEAR, 0) + COALESCE(PH.SALES_PREV_YEAR, 0)) DESC,
                        COALESCE(PH.PURCHASE_COUNT, 0) DESC,
                        A.DESCRIPCIONARTICULO ASC,
                        TRIM(A.CODIGOARTICULO) ASC`;
            }
            // Default histórico: menos compra primero (compat contratos).
            return `CASE WHEN COALESCE(PH.PURCHASE_COUNT, 0) > 0 THEN 0 ELSE 1 END ASC,
                    COALESCE(PH.SALES_THIS_YEAR, 0) ASC,
                    COALESCE(PH.PURCHASE_COUNT, 0) DESC,
                    A.DESCRIPCIONARTICULO ASC,
                    TRIM(A.CODIGOARTICULO) ASC`;
    }
}

async function enrichProductsWithLastConfirmedSales(products, clientCode, queryFn = queryWithParams) {
    if (!Array.isArray(products) || products.length === 0) return products;
    const codes = [...new Set(products.map((product) => truncate(product.code, 10)).filter(Boolean))];
    const client = truncate(clientCode, 10);
    if (!client || codes.length === 0) {
        return products.map((product) => ({
            ...product,
            lastSaleStatus: 'not_found',
            lastSalePrice: null,
            lastSaleOrderId: null,
            lastSaleUnitMeasure: null,
            lastSaleAtLocal: null,
            lastSaleTimeZone: 'Europe/Madrid',
            lastSaleSource: null,
        }));
    }
    const placeholders = pricingPlaceholders(codes);
    try {
        const rows = await queryFn(
            `/* LAST_CONFIRMED_SALES */
             SELECT CODE, ORDER_ID, PRICE, UNIT_MEASURE, SOLD_AT_LOCAL
               FROM (
                 SELECT TRIM(L.CODIGOARTICULO) AS CODE,
                        C.ID AS ORDER_ID,
                        L.PRECIOVENTA AS PRICE,
                        TRIM(L.UNIDADMEDIDA) AS UNIT_MEASURE,
                        VARCHAR_FORMAT(C.CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS SOLD_AT_LOCAL,
                        ROW_NUMBER() OVER (
                          PARTITION BY TRIM(L.CODIGOARTICULO)
                          ORDER BY C.CREATED_AT DESC, L.ID DESC
                        ) AS RN
                   FROM ${PEDIDOS_LIN_TABLE} L
                   JOIN ${PEDIDOS_CAB_TABLE} C ON C.ID = L.PEDIDO_ID
                  WHERE TRIM(C.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
                    AND TRIM(C.ESTADO) = 'CONFIRMADO'
                    AND L.PRECIOVENTA > 0
                    AND TRIM(L.CODIGOARTICULO) IN (${placeholders})
               ) LAST_SALE
              WHERE RN = 1`,
            [client, ...codes],
            false,
        );
        const byCode = new Map((rows || []).map((row) => [
            trimString(row.CODE),
            row,
        ]));
        return products.map((product) => {
            const row = byCode.get(trimString(product.code));
            if (!row) {
                return {
                    ...product,
                    lastSaleStatus: 'not_found',
                    lastSalePrice: null,
                    lastSaleOrderId: null,
                    lastSaleUnitMeasure: null,
                    lastSaleAtLocal: null,
                    lastSaleTimeZone: 'Europe/Madrid',
                    lastSaleSource: null,
                };
            }
            return {
                ...product,
                lastSaleStatus: 'available',
                lastSalePrice: roundPrice(row.PRICE),
                lastSaleOrderId: row.ORDER_ID == null ? null : String(row.ORDER_ID).trim(),
                lastSaleUnitMeasure: trimString(row.UNIT_MEASURE) || null,
                lastSaleAtLocal: trimString(row.SOLD_AT_LOCAL) || null,
                lastSaleTimeZone: 'Europe/Madrid',
                lastSaleSource: 'CONFIRMED_ORDER',
            };
        });
    } catch (error) {
        logger.warn(`[PEDIDOS] Confirmed last-sale batch unavailable code=${error?.code || 'UNKNOWN'}`);
        return products.map((product) => ({
            ...product,
            lastSaleStatus: 'unavailable',
            lastSalePrice: null,
            lastSaleOrderId: null,
            lastSaleUnitMeasure: null,
            lastSaleAtLocal: null,
            lastSaleTimeZone: 'Europe/Madrid',
            lastSaleSource: null,
        }));
    }
}

async function getProducts({ search, clientCode, family, marca, prefamily, includeIva = false, onlyStock = false, limit = 50, offset = 0, sortBy, sortOrder }) {
    const params = [];
    let where = "WHERE A.ANOBAJA = 0 AND TRIM(A.CODIGOARTICULO) <> ''";

    // REQ-02.3: tilde-tolerant search. Term normalized in JS (NFD strip);
    // column normalized in SQL via TRANSLATE. Both sides UPPER. Binding kept
    // parameterized — sanitizeForSQL only strips dangerous chars upstream.
    const unaccentSql = (col) => `TRANSLATE(UPPER(${col}),'ÁÉÍÓÚÜÑÀÈÌÒÙÄËÏÖÜ','AEIOUUNAEIOUAEIOU')`;
    if (search) {
        const s = `%${normalizeSearchTerm(search).toUpperCase()}%`;
        where += ` AND (${unaccentSql('A.DESCRIPCIONARTICULO')} LIKE ? OR TRIM(A.CODIGOARTICULO) LIKE ?)`;
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

    // REQ-04: server-side stock filter BEFORE RN pagination. Gross availability
    // in ARO (columns ENVASESDISPONIBLES/UNIDADESDISPONIBLES, same as STOCK CTE
    // below; CODIGOALMACEN=1). EXISTS keeps pages full so `results.length>=50`
    // stays a valid hasMore signal. Net reserves still post-filtered as safety
    // net. Fully parametrized — no interpolation of user input.
    if (parseBooleanFlag(onlyStock)) {
        where += ` AND EXISTS (SELECT 1 FROM ${comercialErpTable('ARO')} S WHERE S.CODIGOARTICULO = TRIM(A.CODIGOARTICULO) AND S.CODIGOALMACEN = ? AND (S.ENVASESDISPONIBLES > 0 OR S.UNIDADESDISPONIBLES > 0))`;
        params.push(1);
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
    const normalizedSortBy = String(sortBy || 'purchases').toLowerCase().trim();
    const normalizedSortOrder = String(sortOrder || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const rankOrderClause = buildCatalogRankOrderClause(normalizedSortBy, normalizedSortOrder);
    const resultCacheKey = `pedidos:products_final_v4:${await getPedidosRouteCacheVersion()}:${clientCodeTrimmed}:${search || ''}:${family || ''}:${marca || ''}:${prefamily || ''}:${offset}:${limit}:${includeIva ? 'iva' : 'net'}:${normalizedSortBy}:${normalizedSortOrder}:${onlyStock ? 'stock' : 'all'}`;
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
            FROM ${comercialErpTable('LACLAE')} L
            WHERE L.LCCDCL = CAST(? AS CHAR(10))
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
                        ${rankOrderClause}
                ) AS RN
            FROM ${comercialErpTable('ART')} A
            LEFT JOIN PH ON TRIM(A.CODIGOARTICULO) = PH.CODIGOARTICULO
            ${where}
        ), ART_PAGE AS (
            SELECT *
              FROM ART_RANKED
             WHERE RN > ?
               AND RN <= ?
        ), CLIENT_TARIFF AS (
            SELECT COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFA
              FROM ${comercialErpTable('CLC')} CLC
             WHERE TRIM(CLC.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
             FETCH FIRST 1 ROW ONLY
        ), STOCK AS (
            SELECT S.CODIGOARTICULO,
                SUM(S.ENVASESDISPONIBLES) AS ENVASES_DISP,
                SUM(S.UNIDADESDISPONIBLES) AS UNIDADES_DISP
            FROM ${comercialErpTable('ARO')} S
            JOIN ART_PAGE P ON S.CODIGOARTICULO = P.CODIGOARTICULO
            WHERE S.CODIGOALMACEN = 1
            GROUP BY S.CODIGOARTICULO
        ), RESERVED AS (
            SELECT SR.CODIGOARTICULO,
                SUM(SR.CANTIDADENVASES) AS RES_ENV,
                SUM(SR.CANTIDADUNIDADES) AS RES_UNI
            FROM ${PEDIDOS_STOCK_RESERVE_TABLE} SR
            JOIN ${PEDIDOS_CAB_TABLE} C ON SR.PEDIDO_ID = C.ID AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
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
                  FROM ${comercialErpTable('LAC')} L
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
        LEFT JOIN ${comercialErpTable('ARA')} T1 ON A.CODIGOARTICULO = T1.CODIGOARTICULO AND T1.CODIGOTARIFA = 1
        LEFT JOIN ${comercialErpTable('ARA')} T2 ON A.CODIGOARTICULO = T2.CODIGOARTICULO AND T2.CODIGOTARIFA = 2
        LEFT JOIN CLIENT_TARIFF CT ON 1 = 1
        LEFT JOIN ${comercialErpTable('ARA')} TC ON A.CODIGOARTICULO = TC.CODIGOARTICULO
            AND TC.CODIGOTARIFA = CT.CODIGOTARIFA
        LEFT JOIN LAST_COST LC ON A.CODIGOARTICULO = LC.CA
        ORDER BY A.RN ASC`;

    const finalParams = [...historyParams, ...params, offset, offset + limit, clientCodeTrimmed];

    const cacheKey = `pedidos:products_v2:${await getPedidosRouteCacheVersion()}:${clientCodeTrimmed}:${search || ''}:${family || ''}:${marca || ''}:${prefamily || ''}:${offset}:${limit}:${normalizedSortBy}:${normalizedSortOrder}:${onlyStock ? 'stock' : 'all'}`;

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
            const hasPurchased = parseInt(r.HASPURCHASED, 10) || 0;

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
                unitsPerBox,
                unitsFraction,
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
                unitType,
                // Purchase analytics for ordering + badges
                salesThisYear: salesTY,
                salesPrevYear: salesPY,
                hasPurchased: hasPurchased === 1,
                yoyChange: salesPY > 0 ? ((salesTY - salesPY) / salesPY * 100) : (salesTY > 0 ? 100 : 0),
            };
            return product;
        });
        const pricedProducts = await applyConfiguredPricingToProducts(products, clientCodeTrimmed);
        const productsWithLastSale = await enrichProductsWithLastConfirmedSales(
            pricedProducts,
            clientCodeTrimmed,
        );
        let finalProducts = productsWithLastSale.map(product => applyProductPriceView(product, includeIva));
        // REQ-04: server filters gross stock pre-pagination (EXISTS on ARO);
        // this local pass only removes net-zero rows eaten by active reserves.
        // Cache key already includes the flag, so filtered/unfiltered pages
        // never mix.
        if (parseBooleanFlag(onlyStock)) {
            finalProducts = finalProducts.filter(p =>
                (Number(p.stockEnvases) || 0) > 0 || (Number(p.stockUnidades) || 0) > 0);
        }
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
        FROM ${comercialErpTable('ART')} A
        LEFT JOIN ${comercialErpTable('FAM')} F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA
        WHERE TRIM(A.CODIGOARTICULO) = CAST(? AS VARCHAR(10))`;

    // All tariffs
    const tariffSql = `
        SELECT T.CODIGOTARIFA,
            TRIM(TRF.DESCRIPCIONTARIFA) AS tarifaDesc,
            T.PRECIOTARIFA
        FROM ${comercialErpTable('ARA')} T
        JOIN ${comercialErpTable('TRF')} TRF ON T.CODIGOTARIFA = TRF.CODIGOTARIFA
        WHERE TRIM(T.CODIGOARTICULO) = CAST(? AS VARCHAR(10)) AND T.PRECIOTARIFA > 0`;

    // Stock by warehouse
    const stockSql = `
        SELECT ARO.CODIGOALMACEN,
            TRIM(ALM.DESCRIPCIONALMACEN) AS almacenDesc,
            SUM(ARO.ENVASESDISPONIBLES) AS envases,
            SUM(ARO.UNIDADESDISPONIBLES) AS unidades
        FROM ${comercialErpTable('ARO')} ARO
        JOIN ${comercialErpTable('ALM')} ALM ON ARO.CODIGOALMACEN = ALM.CODIGOALMACEN
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
            anoBaja: parseInt(raw.ANOBAJA, 10) || 0,
            mesBaja: parseInt(raw.MESBAJA, 10) || 0,
        };

        product.tariffs = (tariffRows || []).map(t => {
            const price = parseFloat(t.PRECIOTARIFA) || 0;
            return {
                code: t.CODIGOTARIFA,
                description: (t.TARIFADESC || '').trim(),
                price,
                precioUnitario: product.unitsPerBox > 1
                    ? Number((price / product.unitsPerBox).toFixed(4))
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
        const mainStock = stockRows?.find((s) => Number(s.CODIGOALMACEN) === 1);
        product.stockEnvases = mainStock ? (parseFloat(mainStock.ENVASES) || 0) : 0;
        product.stockUnidades = mainStock ? (parseFloat(mainStock.UNIDADES) || 0) : 0;

        // Stage: client historical price
        if (trimClient) {
            const h0 = Date.now();
            logger.info(`[PEDIDOS] getProductDetail stage=HISTORICO code=${trimCode} client=${trimClient}`);
            try {
                const clientPriceSql = `
                    SELECT L.PRECIOVENTA AS PRECIOCLIENTE
                    FROM ${comercialErpTable('LINDTO')} L
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
                    FROM ${comercialErpTable('CLC')}
                    WHERE TRIM(CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
                    FETCH FIRST 1 ROW ONLY`;
                const cliRows = await queryWithParams(cliTarifaSql, [trimClient]);
                clientTarifaCode = cliRows && cliRows.length > 0
                    ? parseInt(cliRows[0].CODIGOTARIFA, 10) || 1
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
    const excludedPedidoId = parseInt(options.excludePedidoId, 10);
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
            FROM ${comercialErpTable('ARO')}
            WHERE TRIM(CODIGOARTICULO) = ? AND CODIGOALMACEN = ?
        ) S,
        (
            SELECT COALESCE(SUM(SR.CANTIDADENVASES), 0) AS RES_ENVASES,
                   COALESCE(SUM(SR.CANTIDADUNIDADES), 0) AS RES_UNIDADES
            FROM ${PEDIDOS_STOCK_RESERVE_TABLE} SR
            JOIN ${PEDIDOS_CAB_TABLE} C ON SR.PEDIDO_ID = C.ID
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
    const excludedPedidoId = parseInt(options.excludePedidoId, 10);
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
                      FROM ${comercialErpTable('ARO')}
                     WHERE CODIGOALMACEN = ?
                       AND TRIM(CODIGOARTICULO) IN (${placeholders})
                     GROUP BY TRIM(CODIGOARTICULO)
              ) S
              LEFT JOIN (
                    SELECT TRIM(SR.CODIGOARTICULO) AS CODE,
                           COALESCE(SUM(SR.CANTIDADENVASES), 0) AS RES_ENVASES,
                           COALESCE(SUM(SR.CANTIDADUNIDADES), 0) AS RES_UNIDADES
                     FROM ${PEDIDOS_STOCK_RESERVE_TABLE} SR
                      JOIN ${PEDIDOS_CAB_TABLE} C ON SR.PEDIDO_ID = C.ID
                     WHERE ${ACTIVE_STOCK_RESERVATION_CONDITION}
                       AND TRIM(SR.CODIGOARTICULO) IN (${placeholders})
                       ${excludeCurrentPedidoSql}
                     GROUP BY TRIM(SR.CODIGOARTICULO)
              ) R ON S.CODE = R.CODE`;
        const params = Number.isInteger(excludedPedidoId) && excludedPedidoId > 0
            ? [almacen, ...chunk, ...chunk, excludedPedidoId]
            : [almacen, ...chunk, ...chunk];
        const queryFn = typeof options.queryFn === 'function'
            ? options.queryFn
            : (statement, bindParams) => queryWithParams(statement, bindParams, false);
        const rows = await queryFn(sql, params);
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

function evaluateStockAvailability(lines, stockByCode) {
    const requestedByCode = new Map();
    for (const line of lines || []) {
        const code = trimString(line.CODIGOARTICULO || line.codigoArticulo);
        if (!code) continue;
        const current = requestedByCode.get(code) || {
            envases: 0,
            unidades: 0,
            description: '',
        };
        current.envases += parseFloat(line.CANTIDADENVASES ?? line.cantidadEnvases) || 0;
        current.unidades += parseFloat(line.CANTIDADUNIDADES ?? line.cantidadUnidades) || 0;
        current.description ||= trimString(line.DESCRIPCION || line.descripcion);
        requestedByCode.set(code, current);
    }

    const stockWarnings = [];
    const outOfStockProducts = [];
    for (const [code, requested] of requestedByCode) {
        const stock = stockByCode.get(code) || { envases: 0, unidades: 0 };
        if (requested.envases > 0 && requested.envases > stock.envases) {
            stockWarnings.push({
                product: code,
                description: requested.description,
                requested: requested.envases,
                available: stock.envases,
                unit: 'envases',
            });
            if (stock.envases <= 0) outOfStockProducts.push(code);
        }
        if (requested.unidades > 0 && requested.unidades > stock.unidades) {
            stockWarnings.push({
                product: code,
                description: requested.description,
                requested: requested.unidades,
                available: stock.unidades,
                unit: 'unidades',
            });
            if (stock.unidades <= 0 && requested.envases <= 0) {
                outOfStockProducts.push(code);
            }
        }
    }

    return {
        stockWarnings,
        outOfStockProducts: [...new Set(outOfStockProducts)],
    };
}

// ============================================================================
// ORDER SEQUENCE
// ============================================================================

function pedidosMutationExecutor(queryFn) {
    return typeof queryFn === 'function'
        ? queryFn
        : (sql, params) => queryWithParams(sql, params, false, false);
}

async function tryAtomicNextOrderNumber(ejercicio, queryFn) {
    if (atomicSequenceUpdateSupported === false) return null;

    try {
        const rows = await pedidosMutationExecutor(queryFn)(
            `SELECT ULTIMO_NUMERO FROM FINAL TABLE (
                UPDATE ${PEDIDOS_SEQ_TABLE}
                   SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1
                 WHERE EJERCICIO = ?
            )`,
            [ejercicio],
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

async function updateAndReadNextOrderNumber(ejercicio, queryFn) {
    const execute = pedidosMutationExecutor(queryFn);
    await execute(
        `UPDATE ${PEDIDOS_SEQ_TABLE} SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1 WHERE EJERCICIO = ?`,
        [ejercicio],
    );
    const rows = await execute(
        `SELECT ULTIMO_NUMERO FROM ${PEDIDOS_SEQ_TABLE} WHERE EJERCICIO = ?`,
        [ejercicio],
    );
    return rows?.[0]?.ULTIMO_NUMERO ? integerValue(rows[0].ULTIMO_NUMERO) : null;
}

function getNextOrderNumber(ejercicio, queryFn) {
    return withOrderSequenceLock(async () => {
        const execute = pedidosMutationExecutor(queryFn);
        const atomicValue = await tryAtomicNextOrderNumber(ejercicio, execute);
        if (atomicValue) return atomicValue;

        const fallbackValue = await updateAndReadNextOrderNumber(ejercicio, execute);
        if (fallbackValue) return fallbackValue;

        try {
            await execute(
                `INSERT INTO ${PEDIDOS_SEQ_TABLE} (EJERCICIO, ULTIMO_NUMERO) VALUES (?, 1)`,
                [ejercicio],
            );
            return 1;
        } catch (insErr) {
            if (!isDuplicateKeyError(insErr)) throw insErr;
            logger.warn(`[PEDIDOS] SEQ INSERT race: ${insErr.message}`);
            const retryAtomicValue = await tryAtomicNextOrderNumber(ejercicio, execute);
            if (retryAtomicValue) return retryAtomicValue;
            const retryFallbackValue = await updateAndReadNextOrderNumber(ejercicio, execute);
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
        'DESCUENTO_GLOBAL', 'PORCENTAJEDESCUENTO1', 'ORIGEN',
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
        parseFloat(descuentoGlobal) || 0,
        parseFloat(descuentoGlobal) || 0,
        origen,
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
        sql: db2InsertSql(`${PEDIDOS_CAB_TABLE}`, columns),
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
        columns.push('DESCUENTO_GLOBAL', 'PORCENTAJEDESCUENTO1', 'ORIGEN');
        params.push(
            parseFloat(descuentoGlobal) || 0,
            parseFloat(descuentoGlobal) || 0,
            origen,
        );
    }

    return {
        sql: db2InsertSql(`${PEDIDOS_CAB_TABLE}`, columns),
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
        'PORCENTAJEDESCUENTO',
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
        amounts.descuentoLinea,
    ];

    return {
        table: `${PEDIDOS_LIN_TABLE}`,
        columns,
        sql: db2InsertSql(`${PEDIDOS_LIN_TABLE}`, columns),
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
        table: `${PEDIDOS_LIN_TABLE}`,
        columns,
        sql: db2InsertSql(`${PEDIDOS_LIN_TABLE}`, columns),
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
          FROM ${comercialErpTable('CLC')} CLC
          JOIN ${comercialErpTable('ARA')} ARA ON ARA.CODIGOTARIFA = COALESCE(CLC.CODIGOTARIFA, 1)
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

async function getMinPricesForLines(lines) {
    const articleCodes = [...new Set((lines || [])
        .map(line => truncate(line.codigoArticulo || line.CODIGOARTICULO, 10))
        .filter(Boolean))];
    const minByCode = new Map();
    if (articleCodes.length === 0) return minByCode;

    const placeholders = articleCodes.map(() => '?').join(',');
    const sql = `
        SELECT TRIM(CODIGOARTICULO) AS CODIGOARTICULO, PRECIOTARIFA
          FROM ${comercialErpTable('ARA')}
         WHERE CODIGOTARIFA = 2
           AND TRIM(CODIGOARTICULO) IN (${placeholders})`;
    try {
        const rows = await queryWithParams(sql, articleCodes, false);
        for (const row of rows || []) {
            const code = truncate(row.CODIGOARTICULO, 10);
            if (code) minByCode.set(code, parseFloat(row.PRECIOTARIFA) || 0);
        }
    } catch (error) {
        logger.warn(`[PEDIDOS] Min price prefetch skipped: ${error.message}`);
    }
    return minByCode;
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
          FROM ${comercialErpTable('ART')}
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

async function hydrateGiftArticles(lines) {
    const codes = [...new Set(lines.filter(isGiftLine).map(line => truncate(line.codigoArticulo, 10)))];
    if (!codes.length) return lines;
    const slots = codes.map(() => '?').join(',');
    const rows = await queryWithParams(`
      WITH GIFT_ARTICLES AS (
        SELECT CODIGOARTICULO, DESCRIPCIONARTICULO, UNIDADESCAJA, CODIGOIVA
          FROM ${comercialErpTable('ART')} WHERE CODIGOARTICULO IN (${slots})
      ), LAST_COST AS (
        SELECT L.CODIGOARTICULO, L.PRECIOCOSTO,
          ROW_NUMBER() OVER (PARTITION BY L.CODIGOARTICULO
            ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC) AS RN
          FROM ${comercialErpTable('LAC')} L
          JOIN GIFT_ARTICLES A ON A.CODIGOARTICULO=L.CODIGOARTICULO
         WHERE L.PRECIOCOSTO > 0
      )
      SELECT TRIM(A.CODIGOARTICULO) AS CODE, TRIM(A.DESCRIPCIONARTICULO) AS NAME,
             A.UNIDADESCAJA, A.CODIGOIVA, COALESCE(C.PRECIOCOSTO, 0) AS PRECIOCOSTO
        FROM GIFT_ARTICLES A LEFT JOIN LAST_COST C ON C.CODIGOARTICULO=A.CODIGOARTICULO AND C.RN=1`, codes, false, false);
    const byCode = new Map(rows.map(row => [trimString(row.CODE), row]));
    return lines.map(line => {
        if (!isGiftLine(line)) return line;
        const article = byCode.get(trimString(line.codigoArticulo));
        if (!article) {
            const error = new Error('No se puede verificar el artículo regalo.');
            error.code = 'GIFT_PRODUCT_UNAVAILABLE'; error.status = 409;
            throw error;
        }
        return { ...line, descripcion: `${trimString(article.NAME).slice(0, 31)} (Regalo)`,
            unidadesCaja: Number(article.UNIDADESCAJA) || 1, codigoIva: trimString(article.CODIGOIVA),
            precioCosto: Number(article.PRECIOCOSTO) || 0,
            precioCostoVerificado: Number(article.PRECIOCOSTO) > 0,
            precioCostoSource: comercialErpTable('LAC'),
            precioTarifa: undefined, precioTarifaCliente: undefined, precioMinimo: undefined };
    });
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
    globalDiscountPct,
    lines = [],
    origen = 'A',
    idempotencyKey,
    clientRequestId,
    userId,
    userRole,
    deviceId,
    originalClientAt,
}) {
    const serviceT0 = Date.now();
    const lineCount = Array.isArray(lines) ? lines.length : 0;

    // Best-effort: liberar stock de borradores >24h antes de reservar el nuevo.
    purgeExpiredDraftReservations({ limit: 25 }).catch((err) => {
        logger.warn(`[PEDIDOS] draft TTL purge skipped: ${err.message}`);
    });

    if (!clientCode || !vendedorCode) {
        throw new Error('clientCode and vendedorCode are required');
    }
    if (!lines || lines.length === 0) {
        throw new Error('At least one line is required');
    }
    await assertMinCobroAllowsOrder({
        clientCode: truncate(clientCode, 10),
        vendorCode: vendedorCode,
        saleType: normalizePedidoSaleType(tipoventa),
    });
    lines = applyGiftPromotionsToLines(lines, await getActivePromotionsV2(truncate(clientCode, 10)));
    lines = await hydrateGiftArticles(lines);
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
    const effectiveDescuentoGlobal = parseGlobalDiscountPct({
        descuentoGlobal,
        globalDiscountPct,
    });
    const normalizedOriginalClientAt = normalizeOriginalClientAt(originalClientAt);

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
        descuentoGlobal: effectiveDescuentoGlobal,
        lines,
        originalClientAt: normalizedOriginalClientAt,
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

    const terminal = resolvePedidoTerminal(effectiveVendedorCode, userId);

    const tariffT0 = Date.now();
    const articleCodes = lines.map((line) => truncate(line.codigoArticulo || line.CODIGOARTICULO, 10));
    const [clientTariffs, articleIvaCodes, minPrices, configuredPricing] = await Promise.all([
        getClientTariffsForLines(effectiveClientCode, lines),
        getArticleIvaCodesForLines(lines),
        getMinPricesForLines(lines),
        getConfiguredPricingMaps(articleCodes, effectiveClientCode),
    ]);
    logger.info(`[PEDIDOS] createOrder stage=line_price_validate lineCount=${lineCount} durationMs=${Date.now() - tariffT0}`);

    logger.info(`[PEDIDOS] createOrder stage=line_defaults_prefetch lineCount=${lineCount} durationMs=0`);
    const lineContexts = lines.map((ln, index) => {
        const articleCode = truncate(ln.codigoArticulo || ln.CODIGOARTICULO, 10);
        const clientTariff = clientTariffs.get(articleCode) || 0;
        const serverMin = minPrices.get(articleCode) || 0;
        const resolvedPricing = resolveAuthoritativeLinePricing({
            line: ln,
            articleCode,
            clientTariff,
            serverMin,
            productPricing: configuredPricing.productPricing.get(articleCode),
            clientPrice: configuredPricing.clientPrices.get(articleCode),
            userRole,
        });
        const productIvaCode = articleIvaCodes.get(articleCode);
        const iva = productIvaCode
            ? resolveIvaFromCodigo(productIvaCode)
            : resolveIvaFromLine(ln);
        const line = {
            ...resolvedPricing.line,
            codigoIva: iva.codigoIva,
            ivaRate: iva.ivaRate,
        };
        const cantidadEnvases = parseFloat(line.cantidadEnvases) || 0;
        const cantidadUnidades = parseFloat(line.cantidadUnidades) || parseFloat(line.cantidad) || 0;
        const unidadesCaja = parseFloat(line.unidadesCaja) || 1;
        const unidadMedida = line.unidadMedida || 'CAJAS';
        const descuentoLinea = parseLineDiscountPct(line);
        const precio = resolvedPricing.price;

        const importeBruto = calculateLineImporte({
            unidadMedida,
            cantidadEnvases,
            cantidadUnidades,
            unidadesCaja,
            precioVenta: precio
        });
        const importeVenta = applyPctToAmount(importeBruto, descuentoLinea);
        const billingQty = isBoxUnidadMedida(unidadMedida) ? cantidadEnvases : cantidadUnidades;
        const { importeCosto, importeMargen, pctMargen } = calculateVerifiedCostMetrics({
            importeVenta,
            billingQty,
            precioCosto: line.precioCosto,
            costVerified: line.precioCostoVerificado,
        });

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

    const reservationLines = buildReservationLinesFromCreateContexts(lineContexts);
    let transactionResult;
    try {
        transactionResult = await withDraftCreationTransaction(async (conn) => {
            const queryFn = (sql, params) => conn.query(sql, params);

            // Recheck after the global locks: a concurrent retry may have
            // committed while catalog/pricing data was being prepared.
            const existing = await lookupPedidoIdempotency(normalizedIdempotencyKey, queryFn);
            if (existing) {
                if (existing.payloadHash !== idempotencyState.payloadHash) {
                    throw createIdempotencyConflictError();
                }
                return { pedidoId: existing.pedidoId, idempotent: true };
            }

            // The global reservation mutex is already held. This uncached DB2
            // read is the authoritative anti-overselling check for the draft.
            const lockedStock = await getStockBatch(
                reservationLines.map((line) => line.CODIGOARTICULO),
                effectiveAlmacen,
                { queryFn },
            );
            const lockedAvailability = evaluateStockAvailability(reservationLines, lockedStock);
            if (lockedAvailability.stockWarnings.length > 0) {
                const stockError = new Error('El stock cambió mientras se creaba el borrador.');
                stockError.code = 'STOCK_CHANGED_DURING_DRAFT_CREATE';
                stockError.status = 409;
                stockError.stockWarnings = lockedAvailability.stockWarnings;
                throw stockError;
            }

            const nextOrderT0 = Date.now();
            const numeroPedido = await getNextOrderNumber(ejercicio, queryFn);
            logger.info(`[PEDIDOS] createOrder stage=getNextOrderNumber lineCount=${lineCount} durationMs=${Date.now() - nextOrderT0}`);

            let cabSql;
            let cabParams;
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
                    descuentoGlobal: effectiveDescuentoGlobal,
                    origen,
                    userId,
                }));
                await queryFn(cabSql, cabParams);
            } catch (cabErr) {
                if (!isColumnNotFound(cabErr)) throw cabErr;
                logger.warn(`[PEDIDOS] ERP-compatible columns missing in ${PEDIDOS_CAB_TABLE}, using legacy insert`);
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
                    descuentoGlobal: effectiveDescuentoGlobal,
                    origen,
                    includeOrigen: true,
                }));
                await queryFn(cabSql, cabParams);
            }

            const idRows = await queryFn(
                `SELECT ID FROM ${PEDIDOS_CAB_TABLE} WHERE EJERCICIO = ? AND NUMEROPEDIDO = ? ORDER BY ID DESC FETCH FIRST 1 ROW ONLY`,
                [ejercicio, numeroPedido],
            );
            const pedidoId = idRows?.[0]?.ID;
            if (!pedidoId) throw new Error('Failed to retrieve created order ID');

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
                await executeBulkInsert(queryFn, lineInserts, {
                    chunkSize: DB2_BULK_INSERT_CHUNK_SIZE,
                    label: `${PEDIDOS_LIN_TABLE}`,
                });
            } catch (lineInsertErr) {
                if (!isColumnNotFound(lineInsertErr)) throw lineInsertErr;
                logger.warn(`[PEDIDOS] ERP-compatible columns missing in ${PEDIDOS_LIN_TABLE}, using legacy line bulk insert`);
                const legacyLineInserts = lineContexts.map(({ line, amounts, sequence }) => buildLegacyPedidoLineInsert({
                    pedidoId,
                    sequence,
                    tipoventa: effectiveSaleType,
                    line,
                    amounts,
                }));
                await executeBulkInsert(queryFn, legacyLineInserts, {
                    chunkSize: DB2_BULK_INSERT_CHUNK_SIZE,
                    label: `${PEDIDOS_LIN_TABLE}_LEGACY`,
                });
            }

            await recalculateOrderTotals(pedidoId, queryFn);
            await replaceStockReservationLines(queryFn, reservationLines, pedidoId);
            try {
                await storePedidoIdempotency({
                    idempotencyKey: normalizedIdempotencyKey,
                    pedidoId,
                    payloadHash: idempotencyState.payloadHash,
                    clientCode: effectiveClientCode,
                    vendedorCode: effectiveVendedorCode,
                }, queryFn);
            } catch (storeErr) {
                storeErr.pedidoCreationStage = 'idempotency_store';
                throw storeErr;
            }
            await appendOrderStateEvent(queryFn, {
                pedidoId,
                fromState: null,
                toState: 'BORRADOR',
                actorId: userId || effectiveVendedorCode,
                actorRole: userRole || 'COMERCIAL',
                deviceId,
                idempotencyKey: `pedido-${pedidoId}-created-${normalizedIdempotencyKey}`,
                originalClientAt: normalizedOriginalClientAt,
                payload: {
                    event: 'ORDER_CREATED',
                    idempotencyKey: normalizedIdempotencyKey,
                    header: {
                        clientCode: effectiveClientCode,
                        vendedorCode: effectiveVendedorCode,
                        tipoventa: effectiveSaleType,
                        descuentoGlobal: effectiveDescuentoGlobal,
                    },
                    lines: lineContexts.map(({ line, amounts, sequence }) => ({
                        sequence,
                        codigoArticulo: line.codigoArticulo || line.CODIGOARTICULO,
                        cantidadEnvases: amounts.cantidadEnvases,
                        cantidadUnidades: amounts.cantidadUnidades,
                        unidadMedida: amounts.unidadMedida,
                        precioVenta: amounts.precio,
                        precioTarifa: line.precioTarifa,
                        precioTarifaCliente: line.precioTarifaCliente,
                        precioMinimo: line.precioMinimo,
                        precioClienteSource: line.precioClienteSource,
                        descuentoLinea: amounts.descuentoLinea,
                        importeVenta: amounts.importeVenta,
                        precioCosto: line.precioCosto,
                        importeCosto: amounts.importeCosto,
                        importeMargen: amounts.importeMargen,
                    })),
                },
            });
            return { pedidoId, idempotent: false };
        });
    } catch (creationError) {
        if (creationError.pedidoCreationStage === 'idempotency_store') {
            if (isDuplicateKeyError(creationError)) {
                const raced = await lookupPedidoIdempotency(normalizedIdempotencyKey);
                if (raced && raced.payloadHash === idempotencyState.payloadHash) {
                    const order = await getOrderDetail(raced.pedidoId, { includeBolsa: false });
                    return { ...order, idempotent: true };
                }
                throw createIdempotencyConflictError();
            }
            throw createIdempotencyUnavailableError();
        }
        throw creationError;
    }

    const pedidoId = transactionResult.pedidoId;
    if (transactionResult.idempotent) {
        const replay = await getOrderDetail(pedidoId, { includeBolsa: false });
        return { ...replay, idempotent: true };
    }

    await invalidatePedidosStockCache('draft_create');
    invalidatePedidosCache(pedidoId);
    logger.info(`[PEDIDOS] createOrder stage=stock_validation pedidoId=${pedidoId} lineCount=${lineCount} stock=draft_reserved statusPath=created`);

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
            CASE WHEN COALESCE(C.PORCENTAJEDESCUENTO1, 0) <> 0
                 THEN C.PORCENTAJEDESCUENTO1
                 ELSE COALESCE(C.DESCUENTO_GLOBAL, 0)
            END AS DESCUENTO_GLOBAL,
            C.CREATED_AT, C.UPDATED_AT,
            COALESCE(LC.LINE_COUNT, 0) AS LINE_COUNT,
            COALESCE(BM.BOLSA_MOV_COUNT, 0) AS BOLSA_MOV_COUNT,
            COALESCE(BM.BOLSA_NETO, 0) AS BOLSA_NETO
        FROM ${PEDIDOS_CAB_TABLE} C
        LEFT JOIN (
            SELECT PEDIDO_ID,
                   COUNT(*) AS LINE_COUNT,
                   COALESCE(SUM(IMPORTEVENTA), 0) AS LINE_TOTAL,
                   COALESCE(SUM(IMPORTECOSTO), 0) AS LINE_COST
            FROM ${PEDIDOS_LIN_TABLE}
            GROUP BY PEDIDO_ID
        ) LC ON C.ID = LC.PEDIDO_ID
        LEFT JOIN (
            SELECT PEDIDO_ID,
                   COUNT(*) AS BOLSA_MOV_COUNT,
                   COALESCE(SUM(CASE WHEN TRIM(TIPO) = 'CONSUMO' THEN -IMPORTE ELSE IMPORTE END), 0) AS BOLSA_NETO
              FROM ${db2AppTable('MOVIMIENTOS_BOLSA')}
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
            const y = parseInt(df.substring(0, 4), 10);
            const m = parseInt(df.substring(4, 6), 10);
            const d = parseInt(df.substring(6, 8), 10);
            sql += ` AND (C.ANODOCUMENTO > ? OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO > ?) OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO = ? AND C.DIADOCUMENTO >= ?))`;
            params.push(y, y, m, y, m, d);
        }
    }
    if (dateTo) {
        const dt = String(dateTo).replace(/-/g, '');
        if (dt.length === 8) {
            const y = parseInt(dt.substring(0, 4), 10);
            const m = parseInt(dt.substring(4, 6), 10);
            const d = parseInt(dt.substring(6, 8), 10);
            sql += ` AND (C.ANODOCUMENTO < ? OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO < ?) OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO = ? AND C.DIADOCUMENTO <= ?))`;
            params.push(y, y, m, y, m, d);
        }
    }

    // Year/month fallback (only if no date range applied)
    if (!dateFrom && !dateTo) {
        const currentYear = year || new Date().getFullYear();
        sql += ` AND C.EJERCICIO = ?`;
        params.push(parseInt(currentYear, 10));
        if (month) {
            sql += ` AND C.MESDOCUMENTO = ?`;
            params.push(parseInt(month, 10));
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
                diaReparto: parseInt(r.DIAREPARTO, 10) || 0,
                mesReparto: parseInt(r.MESREPARTO, 10) || 0,
                anoReparto: parseInt(r.ANOREPARTO, 10) || 0,
                repartidorCode: r.CODIGOREPARTIDOR || '',
                vehicleCode: r.CODIGOVEHICULO || '',
                ruta: r.RUTA || '',
                diasReparto: r.DIASREPARTO || '',
                repartoValidado: (r.REPARTO_VALIDADO_SN || '').trim() === 'S',
                lineCount: parseInt(r.LINE_COUNT, 10) || 0,
                bolsaGenerada: (parseInt(r.BOLSA_MOV_COUNT, 10) || 0) > 0,
                bolsaNeto: roundMoney(parseFloat(r.BOLSA_NETO) || 0),
                createdAt: r.CREATED_AT,
                updatedAt: r.UPDATED_AT,
                repartidorNombre: '',
                repartidorTelefono: '',
            };
        });
        await enrichOrdersWithRepartidorContact(orders);
        return { orders, count: orders.length };
    } catch (error) {
        logger.error(`[PEDIDOS] getOrders error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// ORDER DETAIL
// ============================================================================

async function hasErpColumn(schema, table, column) {
    try {
        const rows = await queryWithParams(
            `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? FETCH FIRST 1 ROW ONLY`,
            [schema, table, column],
            false,
        );
        return Array.isArray(rows) && rows.length > 0;
    } catch {
        return false;
    }
}

async function enrichOrdersWithRepartidorContact(orders) {
    const list = Array.isArray(orders) ? orders : [];
    const codes = [...new Set(list.map((o) => String(o.repartidorCode || '').trim()).filter(Boolean))];
    if (codes.length === 0) return list;
    try {
        const placeholders = codes.map(() => 'TRIM(CAST(? AS VARCHAR(2)))').join(',');
        const hasNombre = await hasErpColumn('DSEDAC', 'VDD', 'NOMBREVENDEDOR');
        const nameExpr = hasNombre ? 'TRIM(VDD.NOMBREVENDEDOR)' : `''`;
        const rows = await queryWithParams(
            `SELECT TRIM(VDD.CODIGOVENDEDOR) AS CODE, ${nameExpr} AS NOMBRE FROM ${comercialErpTable('VDD')} VDD WHERE TRIM(VDD.CODIGOVENDEDOR) IN (${placeholders})`,
            codes,
            false,
        );
        const byCode = new Map((rows || []).map((r) => [String(r.CODE || '').trim(), String(r.NOMBRE || '').trim()]));
        for (const order of list) {
            const code = String(order.repartidorCode || '').trim();
            if (!code) continue;
            order.repartidorNombre = byCode.get(code) || '';
            order.repartidorTelefono = '';
        }
    } catch (err) {
        logger.warn(`[PEDIDOS] repartidor contact enrich skip: ${err.message}`);
        for (const order of list) {
            order.repartidorNombre = order.repartidorNombre || '';
            order.repartidorTelefono = order.repartidorTelefono || '';
        }
    }
    return list;
}

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
    const saldoAnterior = toBolsaNumber(row.SALDO_ANTERIOR);
    const saldoPosterior = toBolsaNumber(row.SALDO_POSTERIOR);
    // REQ-15: descuadre visible con idempotencyKey, tolerancia ±0,01.
    if (Math.abs((saldoPosterior - saldoAnterior) - (tipo === 'CONSUMO' ? -importe : importe)) > 0.01) {
        try {
            logger.warn(
                `[BOLSA_SALDO_MISMATCH] id=${row.ID} idempotencyKey=${String(row.IDEMPOTENCY_KEY || '').trim() || 'n/a'} ` +
                `anterior=${saldoAnterior} posterior=${saldoPosterior} importe=${importe} tipo=${tipo}`,
            );
        } catch { /* never break read path */ }
    }
    return {
        id: row.ID,
        tipo,
        importe,
        importeFirmado: tipo === 'CONSUMO' ? -importe : importe,
        saldoAnterior,
        saldoPosterior,
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

async function getBolsaTraceForOrder(orderId) {
    try {
        const rows = await queryWithParams(
            `SELECT ID, TIPO, IMPORTE, SALDO_ANTERIOR, SALDO_POSTERIOR,
                    CODIGO_ARTICULO, DESCRIPCION, PEDIDO_ID, LINEA_ID,
                    PRECIO_MINIMO_CONGELADO, PRECIO_VENTA, CANTIDAD,
                    UNIDAD_MEDIDA, IDEMPOTENCY_KEY, CREATED_AT
               FROM ${db2AppTable('MOVIMIENTOS_BOLSA')}
              WHERE PEDIDO_ID = ?
              ORDER BY CREATED_AT ASC, ID ASC`,
            [orderId],
            false,
            false
        );
        return {
            status: 'available',
            movements: (rows || []).map(mapBolsaMovementRow),
        };
    } catch (error) {
        logger.warn(`[PEDIDOS] Bolsa trace unavailable for order ${orderId} code=${error?.code || 'UNKNOWN'}`);
        return {
            status: 'unavailable',
            code: 'BOLSA_TRACE_UNAVAILABLE',
            movements: [],
        };
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

async function getOrderInventoryReadModel(
    orderId,
    lines,
    warehouseCode = 1,
    queryFn = queryWithParams,
) {
    let reservationStatus = 'unavailable';
    let reservationRows = [];
    let reservation = {
        status: 'UNAVAILABLE',
        reservedUntilLocal: null,
        serverNowLocal: null,
    };
    try {
        reservationRows = await queryFn(
            `/* ORDER_DETAIL_RESERVATION */
             SELECT CASE
                      WHEN TRIM(C.ESTADO) = 'CONFIRMADO' THEN 'CONFIRMED'
                      WHEN TRIM(C.ESTADO) IN ('CANCELANDO', 'CANCELADO') THEN 'RELEASED'
                      WHEN C.CREATED_AT <= CURRENT TIMESTAMP - ${DRAFT_STOCK_RESERVATION_HOURS} HOURS THEN 'EXPIRED'
                      WHEN COUNT(SR.ID) > 0 THEN 'ACTIVE'
                      ELSE 'NONE'
                    END AS STATUS,
                    VARCHAR_FORMAT(CURRENT TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS SERVER_NOW_LOCAL,
                    CASE
                      WHEN TRIM(C.ESTADO) IN ('CONFIRMADO', 'CANCELANDO', 'CANCELADO')
                        THEN CAST(NULL AS VARCHAR(26))
                      ELSE VARCHAR_FORMAT(C.CREATED_AT + ${DRAFT_STOCK_RESERVATION_HOURS} HOURS, 'YYYY-MM-DD"T"HH24:MI:SS.FF6')
                    END AS RESERVED_UNTIL_LOCAL,
                    TRIM(SR.CODIGOARTICULO) AS CODE,
                    COALESCE(SUM(SR.CANTIDADENVASES), 0) AS RESERVED_ENVASES,
                    COALESCE(SUM(SR.CANTIDADUNIDADES), 0) AS RESERVED_UNITS
               FROM ${PEDIDOS_CAB_TABLE} C
               LEFT JOIN ${PEDIDOS_STOCK_RESERVE_TABLE} SR ON SR.PEDIDO_ID = C.ID
              WHERE C.ID = ?
              GROUP BY C.ESTADO, C.CREATED_AT, SR.CODIGOARTICULO`,
            [orderId],
            false,
        );
        const first = reservationRows?.[0];
        if (first) {
            reservationStatus = 'available';
            reservation = {
                status: trimString(first.STATUS) || 'NONE',
                reservedUntilLocal: trimString(first.RESERVED_UNTIL_LOCAL) || null,
                serverNowLocal: trimString(first.SERVER_NOW_LOCAL) || null,
            };
        }
    } catch (error) {
        logger.warn(`[PEDIDOS] Reservation detail unavailable order=${orderId} code=${error?.code || 'UNKNOWN'}`);
    }

    const codes = [...new Set((lines || [])
        .map((line) => truncate(line.codigoArticulo ?? line.CODIGOARTICULO, 10))
        .filter(Boolean))];
    let stockStatus = 'available';
    let stock = new Map();
    try {
        const warehouse = integerValue(warehouseCode) > 0 ? integerValue(warehouseCode) : 1;
        stock = await getStockBatch(codes, warehouse, { queryFn });
    } catch (error) {
        stockStatus = 'unavailable';
        logger.warn(`[PEDIDOS] Stock detail unavailable order=${orderId} code=${error?.code || 'UNKNOWN'}`);
    }

    const reservationsByCode = new Map((reservationRows || [])
        .filter((row) => trimString(row.CODE))
        .map((row) => [trimString(row.CODE), {
            status: reservation.status,
            envases: Number(row.RESERVED_ENVASES) || 0,
            unidades: Number(row.RESERVED_UNITS) || 0,
            reservedUntilLocal: reservation.reservedUntilLocal,
        }]));
    const status = reservationStatus === 'available' && stockStatus === 'available'
        ? 'available'
        : reservationStatus === 'unavailable' && stockStatus === 'unavailable'
            ? 'unavailable'
            : 'partial';
    return {
        status,
        code: status === 'available' ? undefined : 'ORDER_INVENTORY_READ_PARTIAL',
        serverTimeZone: 'Europe/Madrid',
        reservation,
        stockStatus,
        reservationsByCode,
        stock,
    };
}

async function getOrderDetail(orderId, options = {}) {
    const id = parseInt(orderId, 10);
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
            COALESCE(DESCUENTO_GLOBAL, 0) AS DESCUENTO_GLOBAL,
            COALESCE(PORCENTAJEDESCUENTO1, 0) AS PORCENTAJEDESCUENTO1,
            CREATED_AT, UPDATED_AT
        FROM ${PEDIDOS_CAB_TABLE}
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
            COALESCE(DESCUENTO_LINEA, 0) AS DESCUENTO_LINEA,
            COALESCE(PORCENTAJEDESCUENTO, 0) AS PORCENTAJEDESCUENTO,
            ORDEN, CREATED_AT
        FROM ${PEDIDOS_LIN_TABLE}
        WHERE PEDIDO_ID = ?
        ORDER BY SECUENCIA`;

    try {
        const detailQueries = [
            queryWithParams(cabSql, [id]),
            queryWithParams(linSql, [id]),
        ];
        if (includeBolsa) detailQueries.push(getBolsaTraceForOrder(id));
        const [cabRows, linRows, bolsaTrace] = await Promise.all(detailQueries);
        const bolsaMovements = includeBolsa ? bolsaTrace.movements : [];

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

        const detail = {
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
                diaReparto: parseInt(cab.DIAREPARTO, 10) || 0,
                mesReparto: parseInt(cab.MESREPARTO, 10) || 0,
                anoReparto: parseInt(cab.ANOREPARTO, 10) || 0,
                repartidorCode: cab.CODIGOREPARTIDOR || '',
                vehicleCode: cab.CODIGOVEHICULO || '',
                ruta: cab.RUTA || '',
                diasReparto: cab.DIASREPARTO || '',
                repartoValidado: (cab.REPARTO_VALIDADO_SN || '').trim() === 'S',
                descuentoGlobal: resolveStoredPieDiscountPct(cab),
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
                    descuentoLinea: resolveStoredLineDiscountPct(l),
                    lineDiscountPct: resolveStoredLineDiscountPct(l),
                    createdAt: l.CREATED_AT,
                    bolsaMovements: movements,
                    bolsaImpact: summarizeLineBolsaMovements(movements),
                };
            }),
            bolsaMovements,
            bolsaSummary: buildBolsaSummary(bolsaMovements),
            bolsaRead: includeBolsa
                ? {
                    status: bolsaTrace.status,
                    ...(bolsaTrace.code ? { code: bolsaTrace.code } : {}),
                }
                : { status: 'not_requested' },
        };
        if (options.includeReadModel === true) {
            const [timeline, inventory] = await Promise.all([
                readOrderStateTimeline(queryWithParams, id, options.timeline),
                getOrderInventoryReadModel(id, detail.lines, detail.header.almacen),
            ]);
            detail.timeline = timeline;
            detail.inventoryRead = {
                status: inventory.status,
                ...(inventory.code ? { code: inventory.code } : {}),
                serverTimeZone: inventory.serverTimeZone,
                reservation: inventory.reservation,
                stockStatus: inventory.stockStatus,
            };
            detail.lines = detail.lines.map((line) => {
                const code = trimString(line.codigoArticulo);
                return {
                    ...line,
                    stockAvailable: inventory.stock.get(code) || null,
                    reservation: inventory.reservationsByCode.get(code) || {
                        status: inventory.reservation.status,
                        envases: 0,
                        unidades: 0,
                        reservedUntilLocal: inventory.reservation.reservedUntilLocal,
                    },
                };
            });
        }
        return detail;
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
    const id = parseInt(pedidoId, 10);
    if (isNaN(id)) throw new Error('Invalid pedidoId');

    const codigoArticulo = trimString(lineData.codigoArticulo);
    if (!codigoArticulo) {
        throw new OrderStateError('INVALID_LINE_PAYLOAD', 'codigoArticulo is required', 400);
    }
    const claseLinea = lineData.claseLinea === undefined ? 'VT' : trimString(lineData.claseLinea);
    if (!['VT', 'SC'].includes(claseLinea)) {
        throw new OrderStateError('INVALID_LINE_PAYLOAD', 'claseLinea inválida', 400);
    }

    const cantidadEnvases = parseFloat(lineData.cantidadEnvases) || 0;
    const cantidadUnidades = parseFloat(lineData.cantidadUnidades || lineData.cantidad) || 0;
    const precioBase = parseFloat(lineData.precio || lineData.precioVenta) || 0;
    const descuentoLinea = parseLineDiscountPct(lineData);
    const precio = precioBase;
    const configuredPricing = await getConfiguredPricingMaps([codigoArticulo], '');
    const productPricing = configuredPricing.productPricing.get(codigoArticulo);
    const precioCosto = roundPrice(productPricing?.COSTE_FABRICACION);
    const costVerified = precioCosto > 0;
    const unidadesCaja = parseFloat(lineData.unidadesCaja) || 1;
    const unidadMedida = lineData.unidadMedida || 'CAJAS';
    const articleIvaCodes = await getArticleIvaCodesForLines([lineData]);
    const iva = articleIvaCodes.has(codigoArticulo)
        ? resolveIvaFromCodigo(articleIvaCodes.get(codigoArticulo))
        : resolveIvaFromLine(lineData);

    // P1-A: Use shared calculator for consistent importe across add/create
    const importeBruto = calculateLineImporte({ unidadMedida, cantidadEnvases, cantidadUnidades, unidadesCaja, precioVenta: precio });
    const importeVenta = applyPctToAmount(importeBruto, descuentoLinea);
    const billingQty = isBoxUnidadMedida(unidadMedida) ? cantidadEnvases : cantidadUnidades;
    const { importeCosto, importeMargen, pctMargen } = calculateVerifiedCostMetrics({
        importeVenta,
        billingQty,
        precioCosto,
        costVerified,
    });

    const sql = `
        INSERT INTO ${PEDIDOS_LIN_TABLE} (
            PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION,
            CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA,
            PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
            IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
            DESCUENTO_LINEA,
            TIPOLINEA, TIPOVENTA, CLASELINEA, ORDEN, CODIGOIVA
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await withEditableDraftMutation(id, async (queryFn) => {
        const before = await readOrderAuditSnapshot(queryFn, id);
        const seqRows = await queryFn(
            `SELECT COALESCE(MAX(SECUENCIA), 0) + 1 AS NEXT_SEQ FROM ${PEDIDOS_LIN_TABLE} WHERE PEDIDO_ID = ?`,
            [id],
        );
        const nextSeq = seqRows[0]?.NEXT_SEQ || 1;
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
            lineData.tipoLinea || 'R', lineData.tipoventa || 'CC', claseLinea, nextSeq, iva.codigoIva,
        ];
        await queryFn(sql, params);
        await recalculateOrderTotals(id, queryFn);
        await refreshDraftReservationWithStockCheck(queryFn, id);
        const after = await readOrderAuditSnapshot(queryFn, id);
        await appendDraftMutationAudit(queryFn, {
            orderId: id,
            event: 'LINE_ADDED',
            before,
            after,
            context: lineData.auditContext,
        });
    });
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
    claseLinea,
    descuentoLinea,
    lineDiscountPct,
    auditContext,
}, authorizedOrderId) {
    const id = parseInt(lineId, 10);
    const expectedOrderId = parseInt(authorizedOrderId, 10);
    if (isNaN(id) || isNaN(expectedOrderId)) {
        throw new OrderStateError('INVALID_LINE_PAYLOAD', 'lineId y pedidoId autorizados son obligatorios', 400);
    }

    if (claseLinea !== undefined && !['VT', 'SC'].includes(claseLinea)) {
        throw new OrderStateError('INVALID_LINE_PAYLOAD', 'claseLinea inválida', 400);
    }

    // Fetch current line to get pedidoId and defaults
    const currentRows = await queryWithParams(
        `SELECT PEDIDO_ID, CANTIDADENVASES, CANTIDADUNIDADES, PRECIOVENTA, PRECIOCOSTO,
                UNIDADMEDIDA, UNIDADESCAJA, CLASELINEA,
                COALESCE(DESCUENTO_LINEA, 0) AS DESCUENTO_LINEA,
                TRIM(COALESCE(CODIGOIVA, '2')) AS CODIGOIVA,
                TRIM(CODIGOARTICULO) AS CODIGOARTICULO
           FROM ${PEDIDOS_LIN_TABLE} WHERE ID = ? AND PEDIDO_ID = ?`,
        [id, expectedOrderId]
    );
    if (!currentRows || currentRows.length === 0) {
        throw new OrderStateError('LINE_NOT_FOUND', 'Línea de pedido no encontrada', 404);
    }

    const pedidoId = expectedOrderId;
    const codigoArticulo = truncate(currentRows[0].CODIGOARTICULO, 10);
    const configuredPricing = await getConfiguredPricingMaps([codigoArticulo], '');
    const productPricing = configuredPricing.productPricing.get(codigoArticulo);
    const verifiedCost = roundPrice(productPricing?.COSTE_FABRICACION);
    const costVerified = verifiedCost > 0;
    await withEditableDraftMutation(pedidoId, async (queryFn) => {
        const before = await readOrderAuditSnapshot(queryFn, pedidoId);
        const lockedRows = await queryFn(
            `SELECT PEDIDO_ID, CANTIDADENVASES, CANTIDADUNIDADES, PRECIOVENTA, PRECIOCOSTO,
                    UNIDADMEDIDA, UNIDADESCAJA, CLASELINEA,
                    COALESCE(DESCUENTO_LINEA, 0) AS DESCUENTO_LINEA,
                    TRIM(COALESCE(CODIGOIVA, '2')) AS CODIGOIVA,
                    TRIM(CODIGOARTICULO) AS CODIGOARTICULO
               FROM ${PEDIDOS_LIN_TABLE} WHERE ID = ? AND PEDIDO_ID = ?`,
            [id, pedidoId],
        );
        if (!lockedRows || lockedRows.length === 0) {
            throw new OrderStateError('LINE_NOT_FOUND', 'Línea de pedido no encontrada', 404);
        }
        const current = lockedRows[0];
        if (truncate(current.CODIGOARTICULO, 10) !== codigoArticulo) {
            throw new OrderStateError(
                'LINE_CHANGED_DURING_EDIT',
                'El artículo de la línea cambió mientras se editaba.',
                409,
            );
        }
        const newClase = claseLinea !== undefined ? claseLinea : (current.CLASELINEA || 'VT');
        const newEnvases = cantidadEnvases != null ? parseFloat(cantidadEnvases) : parseFloat(current.CANTIDADENVASES) || 0;
        const newUnidades = cantidadUnidades != null
            ? parseFloat(cantidadUnidades)
            : (cantidad != null ? parseFloat(cantidad) : parseFloat(current.CANTIDADUNIDADES) || 0);
        const newPrecio = newClase === 'SC' ? 0
            : (precioVenta != null ? parseFloat(precioVenta) : (precio != null ? parseFloat(precio) : parseFloat(current.PRECIOVENTA) || 0));
        const newCosto = verifiedCost;
        const newUM = unidadMedida || current.UNIDADMEDIDA;
        const unidadesCaja = parseFloat(current.UNIDADESCAJA) || 1;
        const newDiscount = (descuentoLinea != null || lineDiscountPct != null)
            ? parseLineDiscountPct({ descuentoLinea, lineDiscountPct })
            : parseLineDiscountPct({ DESCUENTO_LINEA: current.DESCUENTO_LINEA });
        const importeBruto = newClase === 'SC' ? 0 : calculateLineImporte({
            unidadMedida: newUM,
            cantidadEnvases: newEnvases,
            cantidadUnidades: newUnidades,
            unidadesCaja,
            precioVenta: newPrecio,
        });
        const importeVenta = applyPctToAmount(importeBruto, newDiscount);
        const billingQty = newUM === 'CAJAS' ? newEnvases : newUnidades;
        const { importeCosto, importeMargen, pctMargen } = calculateVerifiedCostMetrics({
            importeVenta,
            billingQty,
            precioCosto: newCosto,
            costVerified,
        });

        await queryFn(
            `UPDATE ${PEDIDOS_LIN_TABLE} SET
                CANTIDADENVASES = ?, CANTIDADUNIDADES = ?, PRECIOVENTA = ?, PRECIOCOSTO = ?, UNIDADMEDIDA = ?,
                IMPORTEVENTA = ?, IMPORTECOSTO = ?, IMPORTEMARGEN = ?, PORCENTAJEMARGEN = ?,
                CLASELINEA = ?, DESCUENTO_LINEA = ?
            WHERE ID = ? AND PEDIDO_ID = ?`,
            [newEnvases, newUnidades, newPrecio, newCosto, newUM, importeVenta, importeCosto, importeMargen,
                Math.round(pctMargen * 100) / 100, newClase, newDiscount, id, pedidoId],
        );
        try {
            await queryFn(
                `UPDATE ${PEDIDOS_LIN_TABLE} SET PORCENTAJEDESCUENTO = ? WHERE ID = ? AND PEDIDO_ID = ?`,
                [newDiscount, id, pedidoId],
            );
        } catch (erpDiscountErr) {
            if (!isColumnNotFound(erpDiscountErr)) throw erpDiscountErr;
        }
        await recalculateOrderTotals(pedidoId, queryFn);
        await refreshDraftReservationWithStockCheck(queryFn, pedidoId);
        const after = await readOrderAuditSnapshot(queryFn, pedidoId);
        await appendDraftMutationAudit(queryFn, {
            orderId: pedidoId,
            event: 'LINE_UPDATED',
            before,
            after,
            context: auditContext,
        });
    });
    await invalidatePedidosStockCache('draft_line_update');
    invalidatePedidosCache(pedidoId);
    return getOrderDetail(pedidoId);
}

async function deleteOrderLine(lineId, pedidoId, auditContext = {}) {
    const lid = parseInt(lineId, 10);
    const pid = parseInt(pedidoId, 10);
    if (isNaN(lid) || isNaN(pid)) throw new Error('Invalid lineId or pedidoId');

    await withEditableDraftMutation(pid, async (queryFn) => {
        const before = await readOrderAuditSnapshot(queryFn, pid);
        const lineRows = await queryFn(
            `SELECT ID FROM ${PEDIDOS_LIN_TABLE} WHERE ID = ? AND PEDIDO_ID = ?`,
            [lid, pid],
        );
        if (!lineRows || lineRows.length === 0) {
            throw new OrderStateError('LINE_NOT_FOUND', 'Línea de pedido no encontrada', 404);
        }
        await queryFn(
            `DELETE FROM ${PEDIDOS_LIN_TABLE} WHERE ID = ? AND PEDIDO_ID = ?`,
            [lid, pid],
        );
        await recalculateOrderTotals(pid, queryFn);
        await refreshDraftReservationWithStockCheck(queryFn, pid);
        const after = await readOrderAuditSnapshot(queryFn, pid);
        await appendDraftMutationAudit(queryFn, {
            orderId: pid,
            event: 'LINE_REMOVED',
            before,
            after,
            context: auditContext,
        });
    });
    await invalidatePedidosStockCache('draft_line_delete');
    invalidatePedidosCache(pid);
    return getOrderDetail(pid);
}

// ============================================================================
// RECALCULATE TOTALS
// ============================================================================

async function recalculateOrderTotals(pedidoId, queryFn) {
    const id = parseInt(pedidoId, 10);
    const execute = pedidosMutationExecutor(queryFn);

    const rows = await execute(
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
            CASE WHEN COALESCE(MAX(C.PORCENTAJEDESCUENTO1), 0) <> 0
                 THEN MAX(C.PORCENTAJEDESCUENTO1)
                 ELSE COALESCE(MAX(C.DESCUENTO_GLOBAL), 0)
            END as DESCUENTO_GLOBAL
         FROM ${PEDIDOS_CAB_TABLE} C
         LEFT JOIN ${PEDIDOS_LIN_TABLE} L ON L.PEDIDO_ID = C.ID
         WHERE C.ID = ?`,
        [id],
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

    await execute(
        `UPDATE ${PEDIDOS_CAB_TABLE} SET
            IMPORTEBASE = ?,
            IMPORTECOSTO = ?,
            IMPORTETOTAL = ?,
            IMPORTEMARGEN = ?,
            IMPORTEIVA = ?,
            UPDATED_AT = CURRENT_TIMESTAMP
        WHERE ID = ?`,
        [importeBase, importeCosto, importeTotal, importeMargen, importeIva, id],
    );

    try {
        await execute(
            `UPDATE ${PEDIDOS_CAB_TABLE} SET
                IMPORTEBASEIMPONIBLEBRUTA1 = ?,
                IMPORTEBASEIMPONIBLE1 = ?,
                IMPORTEBRUTO = ?,
                PORCENTAJEDESCUENTO1 = ?,
                IMPORTEDESCUENTO1 = ?
             WHERE ID = ?`,
            [importeBaseBruta, importeBase, importeBaseBruta, descuentoGlobal,
                roundMoney(importeBaseBruta - importeBase), id],
        );
    } catch (erpColumnErr) {
        if (!isColumnNotFound(erpColumnErr)) throw erpColumnErr;
        logger.warn(`[PEDIDOS] ERP-compatible total columns missing in ${PEDIDOS_CAB_TABLE}, totals kept in legacy columns`);
    }
}

// ============================================================================
// CONFIRM / CANCEL
// ============================================================================

async function confirmOrder(orderId, saleType, options = {}) {
    const id = parseInt(orderId, 10);
    const target = getPedidosConfirmationTarget();
    const localConfirmationRequested = !target.shouldExportToSystem || isCobroPropio(options);
    const effectiveForceConfirm = isAuthorizedForceConfirm(options);
    if (options.forceConfirm === true && !effectiveForceConfirm) {
        logger.warn(`[PEDIDOS] forceConfirm ignored for order #${id}: missing server-side admin override, role, or audit reason`);
    }
    if (isNaN(id)) throw new Error('Invalid orderId');

    const confirmationHeaderSql =
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
         FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`;
    const currentRows = await queryWithParams(confirmationHeaderSql, [id], false);

    if (!currentRows || currentRows.length === 0) {
        throw new Error('Pedido no encontrado');
    }

    const currentState = canonicalOrderStatus(currentRows[0].ESTADO);

    // Un ACK perdido tras COMMIT puede hacer que el cliente repita la misma
    // confirmación. El estado confirmado es el resultado idempotente: devolvemos
    // el detalle existente sin volver a reservar stock ni escribir en bolsa.
    if (currentState === 'CONFIRMADO') {
        if (localConfirmationRequested) {
            const replay = await withLocalConfirmationTransaction((conn) =>
                claimLocalOrderForConfirmation((sql, params) => conn.query(sql, params), id)
            );
            if (!replay.idempotentReplay) {
                throw confirmationStateError(currentState);
            }
        }
        const existingOrder = await getOrderDetail(id);
        return {
            ...existingOrder,
            stockWarnings: [],
            cobroPropio: isCobroPropio(options, currentRows[0]),
            idempotentReplay: true,
        };
    }

    if (!['BORRADOR', 'PEND_APROB'].includes(currentState)) {
        throw confirmationStateError(currentState);
    }
    const effectiveSaleType = normalizePedidoSaleType(saleType || currentRows[0].TIPOVENTA || 'CC');

    const clientCode = trimString(currentRows[0].CODIGOCLIENTE || options.clientCode);
    const vendedorCode = trimString(currentRows[0].CODIGOVENDEDOR || options.vendedorCode);
    await assertMinCobroAllowsOrder({ clientCode, vendorCode: vendedorCode, saleType: effectiveSaleType });
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
    const cobroPropio = isCobroPropio(options, currentRows[0]);
    const exportToSystem = target.shouldExportToSystem && !cobroPropio;
    // Cobro en mano quita la obligación de cobrar, no la entrega. El repartidor
    // asignado sigue viendo la parada.
    const vehicleCode = trimString(options.vehicleCode || inferredAssignment.vehicleCode).substring(0, 10);
    const driverCode = trimString(options.driverCode || inferredAssignment.driverCode).substring(0, 2);
    const routeCode = trimString(options.routeCode || inferredAssignment.routeCode).substring(0, 10);

    // P0-C: Validate stock BEFORE confirming - block if insufficient
    let lines = await queryWithParams(
        `SELECT ID, PEDIDO_ID, SECUENCIA,
                TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
                TRIM(DESCRIPCION) AS DESCRIPCION,
                CANTIDADENVASES, CANTIDADUNIDADES,
                TRIM(UNIDADMEDIDA) AS UNIDADMEDIDA, UNIDADESCAJA,
                PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
                IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
                COALESCE(DESCUENTO_LINEA, 0) AS DESCUENTO_LINEA,
                COALESCE(PORCENTAJEDESCUENTO, 0) AS PORCENTAJEDESCUENTO,
                TRIM(TIPOLINEA) AS TIPOLINEA,
                TRIM(TIPOVENTA) AS TIPOVENTA,
                TRIM(CLASELINEA) AS CLASELINEA,
                TRIM(COALESCE(CODIGOIVA, '2')) AS CODIGOIVA,
                ORDEN
         FROM ${PEDIDOS_LIN_TABLE} WHERE PEDIDO_ID = ?`, [id]);

    let stockWarnings = [];
    let outOfStockProducts = [];
    const confirmationPricing = await getConfiguredPricingMaps(
        lines.map((line) => line.CODIGOARTICULO),
        clientCode,
    );

    // P0-BOLSA: Validate bolsa comercial before confirming
    try {
        const bolsaService = require('../bolsa-comercial.service');
        const headerDiscountRows = await queryWithParams(
            `SELECT COALESCE(DESCUENTO_GLOBAL, 0) AS DESCUENTO_GLOBAL,
                    COALESCE(PORCENTAJEDESCUENTO1, 0) AS PORCENTAJEDESCUENTO1
               FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`,
            [id],
            false,
        );
        const header = headerDiscountRows?.[0] || {};
        const globalDiscountPct = Math.max(
            Number.parseFloat(header.DESCUENTO_GLOBAL) || 0,
            Number.parseFloat(header.PORCENTAJEDESCUENTO1) || 0,
        );
        // Preflight is deliberately before the legacy bolsa validator because
        // that path may initialise a monthly row. The locked check below is the
        // final authority; this one prevents avoidable non-transactional effects.
        const floorPreflight = await assertErpTariffFloorForOrder({
            queryFn: (sql, params) => queryWithParams(sql, params, false),
            lines,
            headerDiscountPct: globalDiscountPct,
            requireVerifiedProfile: options.requireTariffFloorPilotProfile === true,
        });
        if (!exportToSystem && !floorPreflight.active) {
        const bolsaResult = await bolsaService.validateOrderWithBolsa(vendedorCode, lines, {
            globalDiscountPct,
        });
        if (!bolsaResult.valid && !effectiveForceConfirm) {
            return {
                blocked: true,
                reason: 'BOLSA_INSUFICIENTE',
                deficit: bolsaResult.deficit,
                saldoBolsa: bolsaResult.saldo,
                warnings: bolsaResult.warnings,
                message: `Bolsa comercial insuficiente. Deficit: ${bolsaResult.deficit.toFixed(2)}. Saldo: ${bolsaResult.saldo.toFixed(2)}`,
            };
        }
        // Fail-closed: pie discount that undercuts client tariff must never
        // confirm with consumo=0 (silent ledger skip — senior verdict #67).
        if (globalDiscountPct > 0 && !(Number(bolsaResult.consumo) > 0)) {
            let expectedConsumo = 0;
            for (const line of lines || []) {
                const ref = bolsaService.resolveBolsaReferencePrice(line);
                const qty = bolsaService.getLineQuantity(line);
                const effective = bolsaService.resolveEffectiveSalePrice(line, globalDiscountPct);
                if (ref > 0 && qty > 0 && effective + 0.0001 < ref) {
                    expectedConsumo += (ref - effective) * qty;
                }
            }
            expectedConsumo = Math.round((expectedConsumo + Number.EPSILON) * 100) / 100;
            if (expectedConsumo > 0.009) {
                const mismatch = new Error(
                    `Bolsa inconsistente: DESCUENTO_GLOBAL=${globalDiscountPct} implica consumo≈${expectedConsumo.toFixed(2)} pero el validador devolvió 0`,
                );
                mismatch.code = 'BOLSA_DISCOUNT_CONSUMO_MISMATCH';
                mismatch.status = 500;
                throw mismatch;
            }
        }
        options._bolsaConsumo = bolsaResult.consumo || 0;
        options._bolsaAcumulacion = bolsaResult.acumulacion || 0;
        options._bolsaLineMovements = Array.isArray(bolsaResult.lineMovements) ? bolsaResult.lineMovements : [];
        }
        options._bolsaGlobalDiscountPct = globalDiscountPct;
    } catch (bolsaErr) {
        if (String(bolsaErr.code || '').startsWith('HARD_PRICE_FLOOR_')) {
            throw bolsaErr;
        }
        const err = new Error('No se pudo validar bolsa comercial. El pedido no se ha confirmado. Error: ' + bolsaErr.message);
        err.code = bolsaErr.code || 'BOLSA_VALIDATION_FAILED';
        err.status = bolsaErr.status || 503;
        throw err;
    }

    let stockByCode;
    try {
        stockByCode = await getStockBatch(lines.map(line => line.CODIGOARTICULO), 1, { excludePedidoId: id });
    } catch (cause) {
        const error = new Error('No se pudo comprobar el stock. El pedido permanece en borrador.');
        error.code = 'STOCK_VALIDATION_FAILED';
        error.status = 503;
        error.cause = cause;
        throw error;
    }
    ({ stockWarnings, outOfStockProducts } = evaluateStockAvailability(lines, stockByCode));

    // P0-C: stock is an absolute invariant. Administrative force may override
    // commercial bolsa policy, never physical availability/overselling.
    if (stockWarnings.length > 0) {
        // Fetch similar products for out-of-stock items
        const alternatives = [];
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

        return {
            blocked: true,
            reason: 'STOCK_INSUFICIENTE',
            stockWarnings,
            alternatives,
            message: `Stock insuficiente para ${stockWarnings.length} producto(s). Revisa las alternativas o elimina los productos sin stock.`
        };
    }

    const bolsaService = require('../bolsa-comercial.service');
    let consumoAmount = Number(options._bolsaConsumo || 0);
    const mustWriteBolsaLedger = !options.skipBolsaMovement;

    try {
        const txResult = await withLocalConfirmationTransaction(async (conn) => {
            const queryFn = (sql, params) => conn.query(sql, params);
            const lockedHeaderBefore = await readOrderAuditHeader(queryFn, id);
            const lockedInitialState = canonicalOrderStatus(
                await readConfirmationState(queryFn, id),
            );
            if (lockedInitialState === 'CONFIRMADO') {
                return {
                    idempotentReplay: true,
                    stockWarnings: [],
                    outOfStockProducts: [],
                };
            }
            if (!['BORRADOR', 'PEND_APROB'].includes(lockedInitialState)) {
                throw confirmationStateError(lockedInitialState);
            }
            const lockedLines = rehydrateLockedPricingProvenance(
                await readOrderLinesForMutation(queryFn, id),
                confirmationPricing,
            );
            const lockedGlobalDiscountPct = Math.max(
                Number.parseFloat(lockedHeaderBefore.DESCUENTO_GLOBAL) || 0,
                Number.parseFloat(lockedHeaderBefore.PORCENTAJEDESCUENTO1) || 0,
            );
            await assertErpTariffFloorForOrder({
                queryFn,
                lines: lockedLines,
                headerDiscountPct: lockedGlobalDiscountPct,
                requireVerifiedProfile: options.requireTariffFloorPilotProfile === true,
            });
            const claim = await claimLocalOrderForConfirmation(queryFn, id);
            if (claim.idempotentReplay) {
                return {
                    idempotentReplay: true,
                    stockWarnings: [],
                    outOfStockProducts: [],
                };
            }
            if (!exportToSystem) {
                await appendOrderStateEvent(queryFn, {
                    pedidoId: id,
                    fromState: 'BORRADOR',
                    toState: 'CONFIRMANDO',
                    actorId: options.userId || vendedorCode,
                    actorRole: options.userRole || 'COMERCIAL',
                    deviceId: options.deviceId,
                    idempotencyKey: `pedido-${id}-confirming`,
                    payload: {
                        event: 'ORDER_CONFIRMING',
                        before: {
                            header: lockedHeaderBefore,
                            lines: lockedLines,
                        },
                    },
                });
            }

            const lockedBolsa = await bolsaService.validateOrderWithBolsa(
                vendedorCode,
                lockedLines,
                { globalDiscountPct: lockedGlobalDiscountPct, queryFn },
            );
            if (!lockedBolsa.valid && !effectiveForceConfirm) {
                const bolsaError = new Error(
                    lockedBolsa.message || 'La bolsa comercial cambió mientras se confirmaba el pedido.',
                );
                bolsaError.code = lockedBolsa.reason || 'BOLSA_INSUFICIENTE';
                bolsaError.status = 409;
                bolsaError.bolsaResult = lockedBolsa;
                throw bolsaError;
            }
            const lockedConsumo = Number(lockedBolsa.consumo || 0);
            const lockedAcumulacion = Number(lockedBolsa.acumulacion || 0);
            const lockedLineMovements = Array.isArray(lockedBolsa.lineMovements)
                ? lockedBolsa.lineMovements
                : [];
            const lockedConsumoMovements = lockedLineMovements.filter((movement) =>
                movement && movement.tipo === 'CONSUMO'
            );
            const lockedAcumulacionMovements = lockedLineMovements.filter((movement) =>
                movement && movement.tipo === 'ACUMULACION'
            );
            // Relee stock sin cache DESPUÉS del lock de reservas. Esta es
            // la comprobación autoritativa frente a dos dispositivos.
            const lockedStock = await getStockBatch(
                lockedLines.map(line => line.CODIGOARTICULO),
                1,
                { excludePedidoId: id, queryFn },
            );
            const lockedAvailability = evaluateStockAvailability(lockedLines, lockedStock);
            if (lockedAvailability.stockWarnings.length > 0) {
                const stockError = new Error('El stock cambió mientras se confirmaba el pedido.');
                stockError.code = 'STOCK_CHANGED_DURING_CONFIRM';
                stockError.status = 409;
                stockError.stockWarnings = lockedAvailability.stockWarnings;
                throw stockError;
            }

            let syncResult;
            if (exportToSystem) {
                const [lockedHeader] = await queryFn(confirmationHeaderSql, [id]);
                if (!lockedHeader
                    || trimString(lockedHeader.CODIGOCLIENTE || options.clientCode) !== clientCode
                    || trimString(lockedHeader.CODIGOVENDEDOR || options.vendedorCode) !== vendedorCode
                    || normalizePedidoSaleType(saleType || lockedHeader.TIPOVENTA || 'CC') !== effectiveSaleType
                    || isCobroPropio(options, lockedHeader)) {
                    throw new OrderStateError(
                        'PEDIDO_STATE_CONFLICT',
                        'Los datos del pedido cambiaron. Revísalo antes de confirmar.',
                        409,
                    );
                }
                syncResult = await exportCommercialOrderToSystem(conn, {
                    header: lockedHeader,
                    lines: lockedLines,
                    deliveryPlan,
                    routeCode,
                    saleType: effectiveSaleType,
                    vehicleCode,
                    driverCode,
                    userId: options.userId,
                });
            }
            const update = buildConfirmOrderUpdate({
                id, deliveryPlan, vehicleCode, driverCode, routeCode,
                saleType: effectiveSaleType, syncResult,
            });
            const guardedUpdateSql = `${update.sql} AND ESTADO = 'CONFIRMANDO'`;
            const confirmedResult = await conn.query(guardedUpdateSql, update.params);
            const confirmedRows = affectedRowCount(confirmedResult);
            if (confirmedRows === 0) {
                throw confirmationStateError(await readConfirmationState(queryFn, id));
            }
            if (confirmedRows === null) {
                const confirmedState = await readConfirmationState(queryFn, id);
                if (confirmedState !== 'CONFIRMADO') {
                    throw confirmationStateError(confirmedState);
                }
            }
            await replaceStockReservationLines(queryFn, lockedLines, id);

            if (mustWriteBolsaLedger) {
                const bolsaResult = await bolsaService.applyOrderMovementsWith(queryFn, {
                    vendedorCode,
                    pedidoId: id,
                    consumoAmount: lockedConsumo,
                    acumulacionAmount: lockedAcumulacion,
                    consumoMovements: lockedConsumoMovements,
                    acumulacionMovements: lockedAcumulacionMovements,
                });
                if (bolsaResult && bolsaResult.allowed === false) {
                    const bolsaError = new Error(
                        `Bolsa insuficiente al registrar consumo. Deficit: ${bolsaResult.deficit}`,
                    );
                    bolsaError.code = 'BOLSA_MOVEMENT_WRITE_FAILED';
                    bolsaError.status = 409;
                    throw bolsaError;
                }
            }

            if (!exportToSystem) {
                const lockedHeaderAfter = await readOrderAuditHeader(queryFn, id);

                await appendOrderStateEvent(queryFn, {
                    pedidoId: id,
                    fromState: 'CONFIRMANDO',
                    toState: 'CONFIRMADO',
                    actorId: options.userId || vendedorCode,
                    actorRole: options.userRole || 'COMERCIAL',
                    deviceId: options.deviceId,
                    idempotencyKey: `pedido-${id}-confirmed`,
                    payload: {
                        event: 'ORDER_CONFIRMED',
                        before: {
                            header: lockedHeaderBefore,
                            lines: lockedLines,
                        },
                        after: {
                            header: lockedHeaderAfter,
                            lines: lockedLines,
                        },
                        bolsa: {
                            consumo: lockedConsumo,
                            acumulacion: lockedAcumulacion,
                        },
                    },
                });
            }

            return {
                ...lockedAvailability,
                idempotentReplay: false,
                lines: lockedLines,
                consumoAmount: lockedConsumo,
                globalDiscountPct: lockedGlobalDiscountPct,
                syncResult,
            };
        });
        if (txResult.idempotentReplay) {
            const existingOrder = await getOrderDetail(id);
            return {
                ...existingOrder,
                stockWarnings: [],
                cobroPropio,
                idempotentReplay: true,
            };
        }
        lines = txResult.lines;
        consumoAmount = txResult.consumoAmount;
        options._bolsaGlobalDiscountPct = txResult.globalDiscountPct;
        stockWarnings = txResult.stockWarnings;
        outOfStockProducts = txResult.outOfStockProducts;
        logger.info(txResult.syncResult
            ? `[PEDIDOS] Pedido #${id} exportado a ${txResult.syncResult.targetSchema}.CPC con reserva y bolsa`
            : `[PEDIDOS] Pedido #${id}, reserva y bolsa confirmados en una transacción`);
    } catch (localError) {
        if (localError.code === 'STOCK_CHANGED_DURING_CONFIRM') {
            return {
                blocked: true,
                reason: localError.code,
                stockWarnings: localError.stockWarnings || [],
                alternatives: [],
                message: 'El stock cambió mientras confirmabas. Revisa las cantidades e inténtalo de nuevo.',
            };
        }
        if (localError.code === 'BOLSA_MOVEMENT_WRITE_FAILED') {
            throw localError;
        }
        if (localError.bolsaResult) {
            return {
                blocked: true,
                reason: localError.code,
                deficit: localError.bolsaResult.deficit,
                saldoBolsa: localError.bolsaResult.saldo,
                warnings: localError.bolsaResult.warnings || [],
                message: localError.message,
            };
        }
        const error = new Error(
            `No se pudo confirmar pedido, reserva y bolsa de forma atómica. Error: ${localError.message}`,
        );
        error.code = localError.code || (exportToSystem ? 'SYSTEM_EXPORT_FAILED' : 'LOCAL_CONFIRMATION_FAILED');
        error.status = localError.status || 503;
        error.cause = localError;
        throw error;
    }

    if (cobroPropio) {
        try {
            await queryWithParams(
                `UPDATE ${PEDIDOS_CAB_TABLE}
                    SET OBSERVACIONES = SUBSTR(TRIM(COALESCE(OBSERVACIONES, '')), 1, 182) CONCAT ' [COBRO_COMERCIAL]',
                        UPDATED_AT = CURRENT_TIMESTAMP
                  WHERE ID = ?
                    AND LOCATE('[COBRO_COMERCIAL]', COALESCE(OBSERVACIONES, '')) = 0`,
                [id],
                false,
            );
        } catch (markerErr) {
            logger.warn(`[PEDIDOS] Cobro comercial marker skipped for #${id}: ${markerErr.message}`);
        }
    }

    // P4-A: Invalidate stock and product cache to ensure real-time updates for all sales reps
    await invalidatePedidosStockCache('confirm');

    const order = await getOrderDetail(id);

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
            cobroPropio,
            lineCount: lines.length,
            stockWarningCount: stockWarnings.length,
            forceConfirm: effectiveForceConfirm,
            userId: options.userId || 'SYSTEM'
        };
        logger.info(`[AUDIT] âœ… ORDER_CONFIRMED #${id} | Client:${auditEntry.clientCode} | Total:${auditEntry.total} | Lines:${lines.length}`);
    } catch { /* silent */ }

    if (consumoAmount <= 0 && Number(options._bolsaGlobalDiscountPct || 0) > 0) {
        logger.info(`[PEDIDOS] Confirm #${id} with dto=${options._bolsaGlobalDiscountPct} and no bolsa consumo (tariff-neutral after discounts)`);
    }

    // Invalida cache tras confirmacion (cambia ESTADO, importes y stock reservas).
    invalidatePedidosCache(id);
    await invalidateRuteroCachesAfterPedido(
        order?.header?.vendedor || vendedorCode,
    );

    if (order?.header) {
        order.header.cobroPropio = cobroPropio;
        order.header.repartoDestino = driverCode ? 'RUTERO' : 'COMERCIAL';
    }

    return { ...order, stockWarnings, cobroPropio };
}

/**
 * Libera reservas y borra borradores con más de 24h (TEST / JAVIER.TEST_*).
 * SQL parametrizado. Best-effort: no falla el flujo llamante.
 */
async function purgeExpiredDraftReservations({ limit = 50 } = {}) {
    const maxRows = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    // Solo escritura en tablas app (TEST_* en isolated_test). Nunca DSEDAC.
    if (!String(PEDIDOS_CAB_TABLE).startsWith('JAVIER.')) {
        return { purged: 0, skipped: true, reason: 'non_javier_schema' };
    }

    let expiredIds = [];
    try {
        const rows = await queryWithParams(
            `SELECT C.ID
               FROM ${PEDIDOS_CAB_TABLE} C
              WHERE TRIM(C.ESTADO) IN (${PURGEABLE_DRAFT_STATES_SQL})
                AND C.CREATED_AT <= CURRENT TIMESTAMP - ${DRAFT_STOCK_RESERVATION_HOURS} HOURS
              ORDER BY C.CREATED_AT ASC
              FETCH FIRST ${maxRows} ROWS ONLY`,
            [],
            false,
        );
        expiredIds = (rows || [])
            .map((r) => parseInt(r.ID, 10))
            .filter((id) => Number.isInteger(id) && id > 0);
    } catch (err) {
        logger.warn(`[PEDIDOS] purgeExpiredDraftReservations list failed: ${err.message}`);
        return { purged: 0, error: err.message };
    }

    let purged = 0;
    for (const id of expiredIds) {
        try {
            const deleted = await withDraftPurgeTransaction(async (conn) => {
                // El SELECT inicial solo acota candidatos. Esta relectura ocurre
                // bajo locks de reserva -> cabecera y es la decisión autoritativa.
                const currentRows = await conn.query(
                    `SELECT ID, TRIM(ESTADO) AS ESTADO
                       FROM ${PEDIDOS_CAB_TABLE}
                      WHERE ID = ?
                        AND TRIM(ESTADO) IN (${PURGEABLE_DRAFT_STATES_SQL})
                        AND CREATED_AT <= CURRENT TIMESTAMP - ${DRAFT_STOCK_RESERVATION_HOURS} HOURS`,
                    [id],
                );
                if (!Array.isArray(currentRows) || currentRows.length === 0) {
                    return false;
                }
                const currentState = canonicalOrderStatus(currentRows?.[0]?.ESTADO);
                if (!PURGEABLE_DRAFT_STATES.has(currentState)) return false;
                const before = await readOrderAuditSnapshot(
                    (sql, params) => conn.query(sql, params),
                    id,
                );
                const claimed = await conn.query(
                    `UPDATE ${PEDIDOS_CAB_TABLE}
                        SET ESTADO = 'CANCELANDO', UPDATED_AT = CURRENT_TIMESTAMP
                      WHERE ID = ?
                        AND TRIM(ESTADO) IN (${PURGEABLE_DRAFT_STATES_SQL})
                        AND CREATED_AT <= CURRENT TIMESTAMP - ${DRAFT_STOCK_RESERVATION_HOURS} HOURS`,
                    [id],
                );
                if (affectedRowCount(claimed) === 0) return false;
                await appendOrderStateEvent((sql, params) => conn.query(sql, params), {
                    pedidoId: id,
                    fromState: 'BORRADOR',
                    toState: 'CANCELANDO',
                    actorId: 'SYSTEM_TTL',
                    actorRole: 'SYSTEM',
                    reason: 'Reserva de borrador expirada tras 24 horas',
                    idempotencyKey: `pedido-${id}-ttl-expired-start`,
                    payload: { event: 'DRAFT_EXPIRING', before },
                });
                await conn.query(
                    `DELETE FROM ${PEDIDOS_STOCK_RESERVE_TABLE} WHERE PEDIDO_ID = ?`,
                    [id],
                );
                const headerCancel = await conn.query(
                    `UPDATE ${PEDIDOS_CAB_TABLE}
                        SET ESTADO = 'CANCELADO', UPDATED_AT = CURRENT_TIMESTAMP
                      WHERE ID = ? AND ESTADO = 'CANCELANDO'`,
                    [id],
                );
                let affected = affectedRowCount(headerCancel);
                if (affected === null) {
                    const remainingRows = await conn.query(
                        `SELECT ID FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ? AND ESTADO = 'CANCELADO'`,
                        [id],
                    );
                    if (!Array.isArray(remainingRows)) {
                        const verifyError = new Error('No se pudo verificar la expiracion del borrador.');
                        verifyError.code = 'DRAFT_PURGE_DELETE_UNVERIFIED';
                        throw verifyError;
                    }
                    affected = remainingRows.length === 1 ? 1 : 0;
                }
                if (affected < 1) {
                    const raceError = new Error('El borrador cambió durante la purga.');
                    raceError.code = 'DRAFT_PURGE_STATE_CHANGED';
                    throw raceError;
                }
                const after = await readOrderAuditSnapshot(
                    (sql, params) => conn.query(sql, params),
                    id,
                );
                await appendOrderStateEvent((sql, params) => conn.query(sql, params), {
                    pedidoId: id,
                    fromState: 'CANCELANDO',
                    toState: 'CANCELADO',
                    actorId: 'SYSTEM_TTL',
                    actorRole: 'SYSTEM',
                    reason: 'Reserva de borrador expirada tras 24 horas',
                    idempotencyKey: `pedido-${id}-ttl-expired-done`,
                    payload: { event: 'DRAFT_EXPIRED', before, after },
                });
                return true;
            });
            if (deleted) purged += 1;
        } catch (err) {
            logger.warn(`[PEDIDOS] purgeExpiredDraftReservations #${id}: ${err.message}`);
        }
    }

    if (purged > 0) {
        await invalidatePedidosStockCache('draft_ttl_purge').catch(() => undefined);
        logger.info(`[PEDIDOS] Purged ${purged} expired draft(s) (>${DRAFT_STOCK_RESERVATION_HOURS}h)`);
    }
    return { purged, candidates: expiredIds.length };
}

async function cancelOrder(orderId, options = {}) {
    const id = parseInt(orderId, 10);
    if (isNaN(id)) throw new Error('Invalid orderId');
    const reason = trimString(options.reason || options.cancellationReason || options.auditReason);
    if (reason.length < 3) {
        throw new OrderStateError(
            'CANCELLATION_REASON_REQUIRED',
            'Indica un motivo de cancelacion de al menos 3 caracteres.',
            400,
        );
    }
    const initialRows = await queryWithParams(
        `SELECT ESTADO, CODIGOCLIENTE, SYSTEM_NUMEROPEDIDO, TARGET_SCHEMA
           FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`,
        [id],
        false,
    );
    if (!initialRows?.length) {
        throw new OrderStateError('ORDER_NOT_FOUND', 'Pedido no encontrado', 404);
    }
    const initial = initialRows[0];
    const systemNumero = Number.parseInt(initial.SYSTEM_NUMEROPEDIDO, 10) || 0;
    const targetSchema = trimString(initial.TARGET_SCHEMA).toUpperCase();
    if (systemNumero > 0 || (targetSchema && targetSchema !== 'JAVIER')) {
        const documents = await getOrderAlbaran(id);
        throw new OrderStateError(
            'PEDIDO_MANAGED_BY_ERP',
            documents.length > 0
                ? 'El pedido ya tiene albaran o factura en el ERP y no se puede cancelar desde la app.'
                : 'El pedido fue exportado al ERP y requiere su protocolo de cancelacion.',
            409,
        );
    }
    const clientCode = trimString(initial.CODIGOCLIENTE);
    const documentId = `PED-${id}-${clientCode}`;
    const eventBaseDigest = payloadHash(canonicalPayload({
        clientKey: String(options.idempotencyKey || `pedido-${id}-cancel`),
    })).slice(0, 24);
    const eventBaseKey = `pedido-${id}-cancel-${eventBaseDigest}`;
    const bolsaService = require('../bolsa-comercial.service');
    const result = await withLocalConfirmationTransaction(async (conn) => {
        const queryFn = (sql, params) => conn.query(sql, params);
        const before = await readOrderAuditSnapshot(queryFn, id);
        const currentState = canonicalOrderStatus(before.header.ESTADO);
        if (currentState === 'CANCELADO') {
            return { idempotentReplay: true, previousState: currentState, bolsa: { reversed: [], count: 0 } };
        }
        if (!['BORRADOR', 'CONFIRMADO'].includes(currentState)) {
            throw new OrderStateError(
                'PEDIDO_INVALID_STATE',
                `No se puede cancelar el pedido en estado ${currentState || 'DESCONOCIDO'}.`,
                409,
            );
        }
        await lockLocalCancellationGuards(queryFn, documentId, { alreadyCoordinated: true });
        const claimed = await queryFn(
            `UPDATE ${PEDIDOS_CAB_TABLE}
                SET ESTADO = 'CANCELANDO', UPDATED_AT = CURRENT_TIMESTAMP
              WHERE ID = ? AND ESTADO = ?`,
            [id, currentState],
        );
        const claimedCount = affectedRowCount(claimed);
        if (claimedCount === 0) {
            throw new OrderStateError('PEDIDO_STATE_CONFLICT', 'El pedido cambio mientras se cancelaba.', 409);
        }
        if (claimedCount === null) {
            await assertHeaderStateAfterUnknownUpdate(
                queryFn,
                id,
                'CANCELANDO',
                'No se pudo verificar el bloqueo del pedido para cancelarlo.',
            );
        }
        await appendOrderStateEvent(queryFn, {
            pedidoId: id,
            fromState: currentState,
            toState: 'CANCELANDO',
            actorId: options.userId || 'SYSTEM',
            actorRole: options.userRole,
            deviceId: options.deviceId,
            reason,
            idempotencyKey: `${eventBaseKey}-start`,
            payload: { event: 'ORDER_CANCELLING', before },
        });
        await queryFn(DELETE_STOCK_RESERVE_BY_PEDIDO_SQL, [id]);
        const bolsa = currentState === 'CONFIRMADO'
            ? await bolsaService.reverseOrderMovementsWith(queryFn, {
                pedidoId: id,
                vendedorCode: trimString(before.header.CODIGOVENDEDOR),
            })
            : { reversed: [], count: 0 };
        const cancelled = await queryFn(
            `UPDATE ${PEDIDOS_CAB_TABLE}
                SET ESTADO = 'CANCELADO', UPDATED_AT = CURRENT_TIMESTAMP
              WHERE ID = ? AND ESTADO = 'CANCELANDO'`,
            [id],
        );
        const cancelledCount = affectedRowCount(cancelled);
        if (cancelledCount === 0) {
            throw new OrderStateError('PEDIDO_STATE_CONFLICT', 'No se pudo finalizar la cancelacion.', 409);
        }
        if (cancelledCount === null) {
            await assertHeaderStateAfterUnknownUpdate(
                queryFn,
                id,
                'CANCELADO',
                'No se pudo verificar la cancelacion del pedido.',
            );
        }
        const after = await readOrderAuditSnapshot(queryFn, id);
        await appendOrderStateEvent(queryFn, {
            pedidoId: id,
            fromState: 'CANCELANDO',
            toState: 'CANCELADO',
            actorId: options.userId || 'SYSTEM',
            actorRole: options.userRole,
            deviceId: options.deviceId,
            reason,
            idempotencyKey: `${eventBaseKey}-done`,
            payload: { event: 'ORDER_CANCELLED', before, after, bolsa },
        });
        return { idempotentReplay: false, previousState: currentState, bolsa };
    });

    await invalidatePedidosStockCache('order_cancel');
    invalidatePedidosCache(id);
    const order = await getOrderDetail(id);
    return {
        ...order,
        cancelled: true,
        deleted: false,
        estado: 'CANCELADO',
        previousState: result.previousState,
        idempotentReplay: result.idempotentReplay,
        bolsaReversalCount: result.bolsa.count,
    };
}
// ============================================================================
// ORDER STATUS UPDATE
// ============================================================================

function updateOrderStatus(orderId, newStatus, options = {}) {
    const id = parseInt(orderId, 10);
    if (isNaN(id)) throw new Error('Invalid orderId');
    void newStatus;
    void options;
    return Promise.reject(new OrderStateError(
        'ORDER_TRANSITION_ENDPOINT_DISABLED',
        'Usa las operaciones confirmar o cancelar para conservar stock, bolsa y auditoria atomicos.',
        409,
    ));
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
            const y = parseInt(df.substring(0, 4), 10);
            const m = parseInt(df.substring(4, 6), 10);
            const d = parseInt(df.substring(6, 8), 10);
            whereParts.push('(ANODOCUMENTO > ? OR (ANODOCUMENTO = ? AND MESDOCUMENTO > ?) OR (ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO >= ?))');
            params.push(y, y, m, y, m, d);
            hasDateBounds = true;
        }
    }
    if (dateTo) {
        const dt = String(dateTo).replace(/-/g, '');
        if (dt.length === 8) {
            const y = parseInt(dt.substring(0, 4), 10);
            const m = parseInt(dt.substring(4, 6), 10);
            const d = parseInt(dt.substring(6, 8), 10);
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
        FROM ${PEDIDOS_CAB_TABLE} ${where}`;

    const statusSql = `
        SELECT TRIM(ESTADO) AS ESTADO, COUNT(*) AS CNT
        FROM ${PEDIDOS_CAB_TABLE} ${where}
        GROUP BY ESTADO
        ORDER BY ESTADO`;

    const trendSql = `
        SELECT ANODOCUMENTO AS Y, MESDOCUMENTO AS M, DIADOCUMENTO AS D,
            COUNT(*) AS ORDERS, COALESCE(SUM(IMPORTETOTAL), 0) AS AMOUNT
        FROM ${PEDIDOS_CAB_TABLE} ${where ? where + ' AND' : 'WHERE'} ANODOCUMENTO > 0
        GROUP BY ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
        FETCH FIRST 7 ROWS ONLY`;

    const topSql = `
        SELECT TRIM(CODIGOCLIENTE) AS CODE, TRIM(NOMBRECLIENTE) AS NAME,
            COUNT(*) AS ORDERS, COALESCE(SUM(IMPORTETOTAL), 0) AS AMOUNT
        FROM ${PEDIDOS_CAB_TABLE} ${where ? where + ' AND' : 'WHERE'} CODIGOCLIENTE <> ''
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
            byStatus[status] = (byStatus[status] || 0) + (parseInt(s.CNT, 10) || 0);
        }

        const dailyTrend = (trendRows || []).map(r => ({
            date: `${String(r.Y).padStart(4, '0')}-${String(r.M).padStart(2, '0')}-${String(r.D).padStart(2, '0')}`,
            orders: parseInt(r.ORDERS, 10) || 0,
            amount: parseFloat(r.AMOUNT) || 0,
        })).reverse();

        const topClients = (topRows || []).map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            orders: parseInt(r.ORDERS, 10) || 0,
            amount: parseFloat(r.AMOUNT) || 0,
        }));

        return {
            totalOrders: parseInt(stats.TOTALORDERS, 10) || 0,
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
    const id = parseInt(orderId, 10);
    if (isNaN(id)) throw new Error('Invalid orderId');

    const orderRows = await queryWithParams(
        `SELECT CODIGOCLIENTE, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO,
                EJERCICIO, SERIEPEDIDO, TERMINAL, NUMEROPEDIDO,
                SYSTEM_SUBEMPRESAPEDIDO, SYSTEM_EJERCICIOPEDIDO, SYSTEM_SERIEPEDIDO,
                SYSTEM_TERMINALPEDIDO, SYSTEM_NUMEROPEDIDO
         FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`,
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
               COALESCE(C.TERMINALFACTURA, C.TERMINALALBARAN, P.TERMINALALBARAN) AS TERMINALFACTURA,
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
          FROM ${comercialErpTable('CPC')} P
          LEFT JOIN ${comercialErpTable('CAC')} C
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
                    albaranRef: formatErpDocumentLabel({
                        serie: serieAlbaran,
                        terminal: terminalAlbaran,
                        numero: numeroAlbaran,
                    }),
                    facturaRef: hasFactura
                        ? formatErpDocumentLabel({
                            serie: serieFactura,
                            terminal: (r.TERMINALFACTURA === null
                                || r.TERMINALFACTURA === undefined
                                || r.TERMINALFACTURA === '')
                                ? terminalAlbaran
                                : integerValue(r.TERMINALFACTURA),
                            numero: numeroFactura,
                        })
                        : '',
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
// FAMILIES & BRANDS
// ============================================================================

async function getFamilies() {
    // Req #14: incluir prefamilia para agrupaciones tipo "Nestle".
    // Se devuelven tanto codigo simple (compat) como objeto completo cuando el caller
    // lo requiere via getFamiliesDetailed().
    const sql = `SELECT DISTINCT TRIM(CODIGOFAMILIA) AS CODE FROM ${comercialErpTable('ART')} WHERE ANOBAJA = 0 AND CODIGOFAMILIA != '' ORDER BY 1`;
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
        FROM ${comercialErpTable('ART')} A
        LEFT JOIN ${comercialErpTable('FAM')} F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA
        WHERE (A.ANOBAJA = 0 OR A.ANOBAJA IS NULL)
          AND A.CODIGOFAMILIA <> ''
        GROUP BY TRIM(A.CODIGOFAMILIA)
        ORDER BY NAME
    `;
    const cacheKey = 'pedidos:families:detailed:v2';
    try {
        const rows = await cachedQuery((sql) => query(sql), sql, cacheKey, TTL.SHORT);
        return rows.map(r => {
            const code = (r.CODE || '').trim();
            const name = (r.NAME || r.CODE || '').trim();
            const prefamily = (r.PREFAMILY || '').trim();
            // Flags from real FAM/ART fields (QSYS2-verified 2026-09-23):
            // Impulso = CODIGOFAMILIA 003 / DESCRIPCIONFAMILIA "NESTLE IMPULSO".
            // Nestlé = name/code family cluster (prefamilia ERP is often a 1-char bucket).
            const isImpulso = code === '003' || /IMPULSO/i.test(name);
            const isNestle = /NESTL/i.test(name) || /NESTL/i.test(prefamily) || code.startsWith('003');
            return {
                code,
                name,
                prefamily,
                artCount: Number(r.ART_COUNT) || 0,
                isNestle,
                isImpulso,
            };
        }).filter(f => f.code);
    } catch (error) {
        logger.warn(`[PEDIDOS] getFamiliesDetailed error (returning []): ${error.message}`);
        return [];
    }
}

async function getBrands() {
    const sql = `SELECT DISTINCT TRIM(CODIGOMARCA) AS CODE FROM ${comercialErpTable('ART')} WHERE ANOBAJA = 0 AND CODIGOMARCA != '' ORDER BY 1`;
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
 * Si un comercial acumula >= threshold borradores (VDDX.PEDIDOSPENDIENTESSINCRONIZAR),
 * advierte y opcionalmente auto-confirma el mas antiguo.
 * threshold=0 (ERP default mayoritario) desactiva auto-envío.
 */

// ============================================================================
// EXPORTS
// ============================================================================

// Alias wrappers for route compatibility

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

// =============================================================================
// COMPLEMENTARY PRODUCTS
// =============================================================================

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
        FROM ${PEDIDOS_CAB_TABLE}
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
        FROM ${PEDIDOS_LIN_TABLE} L
        JOIN ${PEDIDOS_CAB_TABLE} C ON C.ID = L.PEDIDO_ID
        WHERE C.ESTADO IN ('CONFIRMADO','ENVIADO')
          AND C.EJERCICIO = YEAR(CURRENT_DATE)
          ${topVendorFilter.clause}
        GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
        ORDER BY totalSales DESC
        FETCH FIRST 10 ROWS ONLY
    `;

    const statusSql = `
        SELECT TRIM(ESTADO) AS status, COUNT(*) AS count
        FROM ${PEDIDOS_CAB_TABLE}
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
                orderCount: parseInt(r.orderCount || r.ORDERCOUNT, 10) || 0,
                totalRevenue: parseFloat(r.totalRevenue || r.TOTALREVENUE) || 0,
                totalMargin: parseFloat(r.totalMargin || r.TOTALMARGIN) || 0,
                avgOrderValue: parseFloat(r.avgOrderValue || r.AVGORDERVALUE) || 0,
                uniqueClients: parseInt(r.uniqueClients || r.UNIQUECLIENTS, 10) || 0,
            })),
            topProducts: topProducts.map(r => ({
                code: (r.code || r.CODE || '').trim(),
                name: (r.name || r.NAME || '').trim(),
                totalSales: parseFloat(r.totalSales || r.TOTALSALES) || 0,
                totalEnvases: parseFloat(r.totalEnvases || r.TOTALENVASES) || 0,
                lineCount: parseInt(r.lineCount || r.LINECOUNT, 10) || 0,
            })),
            statusDistribution: statusDist.reduce((acc, r) => {
                const status = canonicalOrderStatus(r.status || r.STATUS);
                acc[status] = (acc[status] || 0) + (parseInt(r.count || r.COUNT, 10) || 0);
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

module.exports = {
    initPedidosTables,
    extractIdempotencyKeyFromRequest: orderLifecycle.extractIdempotencyKeyFromRequest,
    ensurePedidoIdempotencyKeyFromRequest: orderLifecycle.ensurePedidoIdempotencyKeyFromRequest,
    generatePedidoIdempotencyKey: orderLifecycle.generatePedidoIdempotencyKey,
    normalizePedidoIdempotencyKey: orderLifecycle.normalizePedidoIdempotencyKey,
    normalizePedidoSaleType: orderLifecycle.normalizePedidoSaleType,
    getPedidoSaleTypeLabel: orderLifecycle.getPedidoSaleTypeLabel,
    resolveIvaFromCodigo,
    applyProductPriceView,
    buildCreateOrderPayloadHash: orderLifecycle.buildCreateOrderPayloadHash,
    getProducts,
    searchProducts: catalogAux.searchProducts,
    normalizeSearchTerm,
    getProductDetail,
    getStock,
    getStockBatch,
    getProductStock: catalogAux.getProductStock,
    getClientPricing: catalogAux.getClientPricing,
    getDeliveryOptions,
    getAvailableVehicles,
    getPedidosConfirmationTarget: orderLifecycle.getPedidosConfirmationTarget,
    getOrderVendorForAuth: orderLifecycle.getOrderVendorForAuth,
    createOrder,
    getOrders,
    getOrderDetail,
    addOrderLine,
    updateOrderLine,
    deleteOrderLine,
    confirmOrder,
    cancelOrder,
    purgeExpiredDraftReservations,
    updateOrderStatus,
    getConfirmedPedidosForRutero: catalogAux.getConfirmedPedidosForRutero,
    getConfirmedPedidoDetailForRutero: catalogAux.getConfirmedPedidoDetailForRutero,
    getRecommendations: discovery.getRecommendations,
    getFamilies,
    getFamiliesDetailed,
    getBrands,
    getProductFamilies: catalogAux.getProductFamilies,
    getProductBrands: catalogAux.getProductBrands,
    getActivePromotions: promotions.getActivePromotionsV2,
    getClientPromotionCatalog: promotions.getClientPromotionCatalogV2,
    checkDraftAccumulation: orderLifecycle.checkDraftAccumulation,
    getPedidosPendientesSyncThreshold,
    invalidateRuteroCachesAfterPedido,
    invalidatePedidosStockCache,
    getClientBalance: discovery.getClientBalance,
    cloneOrder: discovery.cloneOrder,
    getComplementaryProducts: similarity.getComplementaryProducts,
    getOrderAnalytics,
    generateOrderPdf: history.generateOrderPdf,
    getSimilarProducts: similarity.getSimilarProducts,
    searchProductsWithStock: history.searchProductsWithStock,
    calculateLineImporte,
    assertPrecioWithinClientTariff,
    resolveServerLineUnitPrice,
    isGiftLine,
    applyGiftPromotionsToLines,
    applyConfiguredPricingToProducts,
    applyConfiguredPricingToProduct,
    effectiveMinPriceFromRow,
    resolveMargenObjetivoPct,
    resolvePrecioMinimoPolitica,
    savePrecioHistoricoTEST,
    getPrecioHistoricoTEST,
    PRECIO_HISTORICO_TEST_TABLE,
    isOrderTransitionAllowed: orderLifecycle.isOrderTransitionAllowed,
    canonicalOrderStatus: orderLifecycle.canonicalOrderStatus,
    storedOrderStatus: orderLifecycle.storedOrderStatus,
    assertOrderEditable: orderLifecycle.assertOrderEditable,
    getOrderStats,
    getOrderAlbaran,
    getProductHistory: history.getProductHistory,
    getProductPriceHistory: history.getProductPriceHistory,
    pedidosBreaker,
    _private: {
        getNextOrderNumber,
        getClientOrderDefaults,
        hydrateGiftArticles,
        getDefaultTruckAssignment,
        resolvePedidoTerminal: orderLifecycle.resolvePedidoTerminal,
        exportCommercialOrderToSystem,
        withSystemExportLock,
        isDuplicateKeyError,
        resolveAuthoritativeLinePricing,
        calculateVerifiedCostMetrics,
    },
};
