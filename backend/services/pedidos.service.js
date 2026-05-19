/**
 * PEDIDOS SERVICE (CommonJS)
 * ==========================
 * Service for order management (PEDIDOS module).
 * Tables live in schema JAVIER; product/stock reads go to DSEDAC.
 */

const { query, queryWithParams, getPool, initDb } = require('../config/db');
const ERP_SCHEMA = process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER';
const logger = require('../middleware/logger');
const { cachedQuery, invalidateOnMutation } = require('./query-optimizer');
const { redisCache, TTL } = require('./redis-cache');

// Best-effort cache invalidation tras una mutación de pedidos.
// No bloquea el flujo si Redis está caído ni si el módulo está mockeado en tests.
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
const { LACLAE_SALES_FILTER } = require('../utils/common');
const { CircuitBreaker } = require('./circuit-breaker');
const { getClientDays } = require('./laclae');

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
    timeout: 10000
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
    ESTADO VARCHAR(24) DEFAULT 'BORRADOR',
    IMPORTETOTAL NUMERIC(11,2) DEFAULT 0,
    IMPORTEBASE NUMERIC(11,2) DEFAULT 0,
    IMPORTEIVA NUMERIC(11,2) DEFAULT 0,
    IMPORTECOSTO NUMERIC(11,2) DEFAULT 0,
    IMPORTEMARGEN NUMERIC(11,2) DEFAULT 0,
    OBSERVACIONES VARCHAR(200) DEFAULT '',
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
    TIPOLINEA CHAR(1) DEFAULT 'R',
    TIPOVENTA CHAR(2) DEFAULT 'CC',
    CLASELINEA CHAR(2) DEFAULT 'VT',
    ORDEN NUMERIC(4) DEFAULT 0,
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

const VALID_ORDER_STATES = ['BORRADOR', 'PENDIENTE_APROBACION', 'CONFIRMADO', 'ENVIADO', 'ANULADO'];

const ORDER_TRANSITIONS = {
    BORRADOR: new Set(['PENDIENTE_APROBACION', 'CONFIRMADO', 'ANULADO']),
    PENDIENTE_APROBACION: new Set(['CONFIRMADO', 'BORRADOR', 'ANULADO']),
    CONFIRMADO: new Set(['ENVIADO', 'ANULADO']),
    ENVIADO: new Set(),
    ANULADO: new Set(),
};

function canonicalOrderStatus(status) {
    const normalized = trimString(status).toUpperCase();
    // Map legacy PENDIENTE (w/o _APROBACION) to BORRADOR; PENDIENTE_APROBACION is its own state
    if (normalized === 'PENDIENTE') return 'BORRADOR';
    return VALID_ORDER_STATES.includes(normalized) ? normalized : 'BORRADOR';
}

function storedOrderStatus(status) {
    return canonicalOrderStatus(status);
}

function isOrderTransitionAllowed(fromStatus, toStatus) {
    const from = canonicalOrderStatus(fromStatus);
    const to = canonicalOrderStatus(toStatus);
    return ORDER_TRANSITIONS[from]?.has(to) === true;
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
    const schema = String(raw || 'JAVIER').trim().toUpperCase();
    if (!['JAVIER', 'DSEDAC'].includes(schema)) {
        throw new Error(`PEDIDOS_CONFIRMATION_SCHEMA invalido: ${schema}. Use JAVIER o DSEDAC.`);
    }
    return schema;
}

function parseIntConfig(raw, fallback) {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getPedidosConfirmationTarget() {
    const schema = pedidosSchemaName(
        process.env.PEDIDOS_CONFIRMATION_SCHEMA ||
        process.env.PEDIDOS_ERP_SCHEMA ||
        process.env.PEDIDOS_TARGET_SCHEMA ||
        'JAVIER'
    );
    const exportEnabled = String(process.env.PEDIDOS_EXPORT_TO_SYSTEM || 'false').trim().toLowerCase() === 'true';
    const shouldExportToSystem = schema === 'DSEDAC' && exportEnabled;
    const subempresa = trimString(process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP').substring(0, 3) || 'GMP';
    const serie = trimString(process.env.PEDIDOS_SYSTEM_SERIE || 'P').substring(0, 1) || 'P';
    const terminal = parseIntConfig(process.env.PEDIDOS_SYSTEM_TERMINAL, 10);
    return {
        schema,
        mode: shouldExportToSystem ? 'SYSTEM' : 'LOCAL',
        shouldExportToSystem,
        subempresa,
        serie,
        terminal,
        codigoOperacion: trimString(process.env.PEDIDOS_SYSTEM_CODIGO_OPERACION || 'V').substring(0, 1) || 'V',
        situacionPedido: trimString(process.env.PEDIDOS_SYSTEM_SITUACION_PEDIDO || 'A').substring(0, 1) || 'A',
        codigoTipoPedido: trimString(process.env.PEDIDOS_SYSTEM_CODIGO_TIPO_PEDIDO || '').substring(0, 3),
        codigoUsuario: trimString(process.env.PEDIDOS_SYSTEM_CODIGO_USUARIO || 'APP').substring(0, 10) || 'APP',
        tables: {
            cab: `${schema}.CPC`,
            lin: `${schema}.LPC`,
            obs: `${schema}.OCPC`,
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
        const params = [cleanClient, currentYear - 1];
        let vendorFilter = '';
        if (cleanVendor) {
            vendorFilter = ' AND TRIM(R1_T8CDVD) = ?';
            params.push(cleanVendor);
        }
        const rows = await queryWithParams(`
            SELECT R1_T8DIRL, R1_T8DIRM, R1_T8DIRX, R1_T8DIRJ,
                   R1_T8DIRV, R1_T8DIRS, R1_T8DIRD
            FROM DSED.LACLAE
            WHERE TRIM(LCCDCL) = ?
              AND LCAADC >= ?
              ${vendorFilter}
            FETCH FIRST 20 ROWS ONLY`,
            params,
            false
        );
        const laclaeDays = deliveryDaysFromRows(rows, LACLAE_DELIVERY_COLUMNS);
        if (laclaeDays.length > 0) {
            return { days: laclaeDays, source: 'DSED.LACLAE' };
        }
        if (cleanVendor) {
            const allVendorRows = await queryWithParams(`
                SELECT R1_T8DIRL, R1_T8DIRM, R1_T8DIRX, R1_T8DIRJ,
                       R1_T8DIRV, R1_T8DIRS, R1_T8DIRD
                FROM DSED.LACLAE
                WHERE TRIM(LCCDCL) = ?
                  AND LCAADC >= ?
                FETCH FIRST 20 ROWS ONLY`,
                [cleanClient, currentYear - 1],
                false
            );
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

async function getDefaultTruckAssignment({ clientCode, vendedorCode, deliveryDate, routeCode }) {
    const cleanClient = trimString(clientCode);
    const cleanVendor = trimString(vendedorCode).split(',')[0].substring(0, 2);

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
            return {
                ...assignment,
                routeCode: routeCode || assignment.routeCode,
                confidence: 'media',
                source: 'DSEDAC.OPP',
            };
        }
    } catch (error) {
        logger.warn(`[PEDIDOS] Default truck lookup failed for ${cleanClient}/${cleanVendor}: ${error.message}`);
    }

    return {
        vehicleCode: '',
        driverCode: '',
        vehicleMatricula: '',
        vehicleDescription: '',
        routeCode: routeCode || '',
        confidence: 'sin-datos',
        source: 'none',
    };
}

async function getDeliveryOptions({ clientCode, vendedorCode, deliveryDate }) {
    if (!clientCode || !vendedorCode) {
        throw new Error('clientCode and vendedorCode are required');
    }

    const deliveryPlan = await resolveDeliveryPlan({ clientCode, vendedorCode, deliveryDate });
    const assignment = await getDefaultTruckAssignment({
        clientCode,
        vendedorCode,
        deliveryDate: deliveryPlan.date.iso,
    });

    return {
        clientCode: trimString(clientCode),
        vendedorCode: trimString(vendedorCode).split(',')[0].substring(0, 2),
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

function splitFixedText(value, width, count) {
    const text = trimString(value);
    const chunks = [];
    for (let i = 0; i < count; i++) {
        chunks.push(text.substring(i * width, (i + 1) * width));
    }
    return chunks;
}

function cajaUnidadFlag(unidadMedida) {
    const unit = trimString(unidadMedida).toUpperCase();
    if (unit === 'CAJA' || unit === 'CAJAS' || unit === '') return 'C';
    return 'U';
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
        await conn.query('BEGIN WORK');
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

async function nextSystemPedidoNumber(conn, target, ejercicio) {
    await conn.query(`LOCK TABLE ${target.tables.cab} IN EXCLUSIVE MODE`);
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

function buildDsedacCpcInsert({ target, header, systemRef, deliveryPlan, routeCode, saleType, userId }) {
    const docDay = integerValue(header.DIADOCUMENTO) || new Date().getDate();
    const docMonth = integerValue(header.MESDOCUMENTO) || new Date().getMonth() + 1;
    const docYear = integerValue(header.ANODOCUMENTO) || integerValue(header.EJERCICIO) || new Date().getFullYear();
    const hora = integerValue(header.HORADOCUMENTO) || currentHhmmss();
    const vendedor = truncate(header.CODIGOVENDEDOR, 2);
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
        'CODIGORUTA', 'CODIGOFORMAPAGO', 'CODIGOTARIFA', 'CODIGOALMACEN', 'RECARGOSN',
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
        vendedor, vendedor, vendedor, vendedor,
        truncate(routeCode, 4), truncate(header.CODIGOFORMAPAGO || '02', 2),
        integerValue(header.CODIGOTARIFA) || 1, integerValue(header.CODIGOALMACEN) || 1, 'N',
        base, base, base,
        total, costo, margen,
        target.situacionPedido, target.codigoOperacion, observaciones[0], observaciones[1],
        docDay, docMonth, docYear, hora,
        vendedor, truncate(userId || target.codigoUsuario, 10), target.codigoTipoPedido,
        deliveryPlan.date.day, deliveryPlan.date.month, deliveryPlan.date.year,
    ];

    return {
        sql: `INSERT INTO ${target.tables.cab} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        params,
    };
}

function buildDsedacLpcInsert({ target, header, line, systemRef, deliveryPlan, routeCode, saleType }) {
    const docDay = integerValue(header.DIADOCUMENTO) || new Date().getDate();
    const docMonth = integerValue(header.MESDOCUMENTO) || new Date().getMonth() + 1;
    const docYear = integerValue(header.ANODOCUMENTO) || integerValue(header.EJERCICIO) || new Date().getFullYear();
    const hora = integerValue(header.HORADOCUMENTO) || currentHhmmss();
    const vendedor = truncate(header.CODIGOVENDEDOR, 2);
    const cliente = truncate(header.CODIGOCLIENTE, 10);
    const effectiveSaleType = truncate(saleType || line.TIPOVENTA || header.TIPOVENTA || 'CC', 2) || 'CC';

    const columns = [
        'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO',
        'SECUENCIAPEDIDO', 'DIADOCUMENTO', 'MESDOCUMENTO', 'ANODOCUMENTO', 'HORADOCUMENTO',
        'CODIGOCLIENTEALBARAN', 'CODIGOCLIENTEFACTURA', 'CODIGOCLIENTECADENA',
        'CODIGOVENDEDOR', 'CODIGOVENDEDORCOBRO', 'CODIGOPROMOTORPREVENTA', 'CODIGOCOMERCIAL',
        'CODIGORUTA', 'CODIGOFORMAPAGO', 'CODIGOTARIFA', 'CODIGOALMACEN', 'RECARGOSN',
        'TIPOLINEA', 'TIPOVENTA', 'CLASELINEA', 'CODIGOARTICULO', 'DESCRIPCION',
        'CANTIDADENVASES', 'CANTIDADUNIDADES', 'PRECIOVENTA', 'IMPORTEVENTA',
        'PRECIOCOSTO', 'IMPORTECOSTO', 'CAJASUNIDADES', 'PRECIOTARIFACLIENTE',
        'PRECIOTARIFA01', 'CODIGOESTADO',
    ];
    const params = [
        systemRef.subempresa, systemRef.ejercicio, systemRef.serie, systemRef.terminal, systemRef.numero,
        integerValue(line.SECUENCIA || line.ORDEN) || 1,
        docDay, docMonth, docYear, hora,
        cliente, cliente, '',
        vendedor, vendedor, vendedor, vendedor,
        truncate(routeCode, 4), truncate(header.CODIGOFORMAPAGO || '02', 2),
        integerValue(header.CODIGOTARIFA) || 1, integerValue(header.CODIGOALMACEN) || 1, 'N',
        truncate(line.TIPOLINEA || 'R', 1) || 'R',
        effectiveSaleType,
        truncate(line.CLASELINEA || 'VT', 2) || 'VT',
        truncate(line.CODIGOARTICULO, 10),
        truncate(line.DESCRIPCION, 40),
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
        sql: `INSERT INTO ${target.tables.lin} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        params,
    };
}

function buildDsedacOcpcInsert({ target, header, systemRef, userId }) {
    const chunks = splitFixedText(header.OBSERVACIONES, 120, 10);
    if (chunks.every(chunk => !trimString(chunk))) return null;

    const docDay = integerValue(header.DIADOCUMENTO) || new Date().getDate();
    const docMonth = integerValue(header.MESDOCUMENTO) || new Date().getMonth() + 1;
    const docYear = integerValue(header.ANODOCUMENTO) || integerValue(header.EJERCICIO) || new Date().getFullYear();
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
        truncate(userId || target.codigoUsuario, 10),
    ];
    return {
        sql: `INSERT INTO ${target.tables.obs} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        params,
    };
}

async function exportCommercialOrderToSystem(conn, { header, lines, deliveryPlan, routeCode, saleType, userId }) {
    const target = getPedidosConfirmationTarget();
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
    const numero = await nextSystemPedidoNumber(conn, target, ejercicio);
    const systemRef = {
        subempresa: target.subempresa,
        ejercicio,
        serie: target.serie,
        terminal: target.terminal,
        numero,
    };

    const cab = buildDsedacCpcInsert({ target, header, systemRef, deliveryPlan, routeCode, saleType, userId });
    await conn.query(cab.sql, cab.params);

    for (const line of lines || []) {
        const lin = buildDsedacLpcInsert({ target, header, line, systemRef, deliveryPlan, routeCode, saleType });
        await conn.query(lin.sql, lin.params);
    }

    const obs = buildDsedacOcpcInsert({ target, header, systemRef, userId });
    if (obs) {
        await conn.query(obs.sql, obs.params);
    }

    return {
        targetSchema: target.schema,
        syncStatus: 'SYNCED',
        synced: true,
        systemRef,
    };
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
    for (const line of lines) {
        const code = trimString(line.CODIGOARTICULO);
        if (!code) continue;
        const resEnv = parseFloat(line.CANTIDADENVASES) || 0;
        const resUni = parseFloat(line.CANTIDADUNIDADES) || 0;
        if (resEnv > 0 || resUni > 0) {
            await executor(
                `INSERT INTO ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE (PEDIDO_ID, CODIGOARTICULO, CANTIDADENVASES, CANTIDADUNIDADES) VALUES (?, ?, ?, ?)`,
                [orderId, code, resEnv, resUni]
            );
        }
    }
}

// ============================================================================
// TABLE INITIALIZATION
// ============================================================================

async function initPedidosTables() {
    const pool = getPool();
    if (!pool) { logger.warn('[PEDIDOS] No DB pool available for init'); return; }

    const tables = [
        { name: '${ERP_SCHEMA}.PEDIDOS_CAB', ddl: CREATE_PEDIDOS_CAB },
        { name: '${ERP_SCHEMA}.PEDIDOS_LIN', ddl: CREATE_PEDIDOS_LIN },
        { name: '${ERP_SCHEMA}.PEDIDOS_SEQ', ddl: CREATE_PEDIDOS_SEQ },
        { name: '${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE', ddl: CREATE_PEDIDOS_STOCK_RESERVE },
    ];

    let conn;
    try {
        conn = await pool.connect();

        for (const t of tables) {
            try {
                await conn.query(`SELECT 1 FROM ${t.name} FETCH FIRST 1 ROW ONLY`);
                logger.info(`[PEDIDOS] ${t.name} ready`);
            } catch (e) {
                if (isTableNotFound(e)) {
                    // Close dirty connection, get a fresh one
                    try { await conn.close(); } catch (_) { /* ignore */ }
                    conn = await pool.connect();
                    await conn.query(t.ddl);
                    logger.info(`[PEDIDOS] Created ${t.name}`);
                } else {
                    throw e;
                }
            }
        }

        // Ensure additive PEDIDOS_CAB columns exist in older JAVIER installs.
        const cabColumns = [
            { name: 'ORIGEN', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN ORIGEN CHAR(1) DEFAULT 'A'` },
            { name: 'FECHAREPARTO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN FECHAREPARTO DATE` },
            { name: 'DIAREPARTO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN DIAREPARTO NUMERIC(2) DEFAULT 0` },
            { name: 'MESREPARTO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN MESREPARTO NUMERIC(2) DEFAULT 0` },
            { name: 'ANOREPARTO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN ANOREPARTO NUMERIC(4) DEFAULT 0` },
            { name: 'CODIGOREPARTIDOR', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN CODIGOREPARTIDOR CHAR(2) DEFAULT ' '` },
            { name: 'CODIGOVEHICULO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN CODIGOVEHICULO CHAR(10) DEFAULT ' '` },
            { name: 'RUTA', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN RUTA VARCHAR(10) DEFAULT ''` },
            { name: 'DIASREPARTO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN DIASREPARTO VARCHAR(80) DEFAULT ''` },
            { name: 'REPARTO_VALIDADO_SN', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN REPARTO_VALIDADO_SN CHAR(1) DEFAULT 'N'` },
            { name: 'REPARTO_VALIDADO_AT', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN REPARTO_VALIDADO_AT TIMESTAMP` },
            { name: 'TARGET_SCHEMA', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN TARGET_SCHEMA CHAR(10) DEFAULT 'JAVIER'` },
            { name: 'SYNC_STATUS', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYNC_STATUS VARCHAR(16) DEFAULT 'LOCAL'` },
            { name: 'SYNC_AT', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYNC_AT TIMESTAMP` },
            { name: 'SYSTEM_SUBEMPRESAPEDIDO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYSTEM_SUBEMPRESAPEDIDO CHAR(3) DEFAULT ' '` },
            { name: 'SYSTEM_EJERCICIOPEDIDO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYSTEM_EJERCICIOPEDIDO NUMERIC(4) DEFAULT 0` },
            { name: 'SYSTEM_SERIEPEDIDO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYSTEM_SERIEPEDIDO CHAR(1) DEFAULT ' '` },
            { name: 'SYSTEM_TERMINALPEDIDO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYSTEM_TERMINALPEDIDO NUMERIC(3) DEFAULT 0` },
            { name: 'SYSTEM_NUMEROPEDIDO', ddl: `ALTER TABLE ${ERP_SCHEMA}.PEDIDOS_CAB ADD COLUMN SYSTEM_NUMEROPEDIDO NUMERIC(6) DEFAULT 0` },
        ];

        for (const col of cabColumns) {
            try {
                await conn.query(`SELECT ${col.name} FROM ${ERP_SCHEMA}.PEDIDOS_CAB FETCH FIRST 1 ROW ONLY`);
            } catch (colErr) {
                if (!isColumnNotFound(colErr)) {
                    logger.warn(`[PEDIDOS] Could not verify ${col.name} column: ${colErr.message}`);
                    continue;
                }
                try {
                    try { await conn.close(); } catch (_) { /* ignore */ }
                    conn = await pool.connect();
                    await conn.query(col.ddl);
                    logger.info(`[PEDIDOS] Added missing ${col.name} column to PEDIDOS_CAB`);
                } catch (alterErr) {
                    logger.warn(`[PEDIDOS] Could not add ${col.name} column: ${alterErr.message}`);
                }
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

async function getProducts({ search, clientCode, family, marca, prefamily, limit = 50, offset = 0 }) {
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
    // Req #14: filtro por prefamilia (e.g. Nestlé). Buscamos en 3 columnas
    // (prefamilia, marca, descripcion) para que el chip "Nestlé" encuentre
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
    const clientCodeTrimmed = (clientCode || '').trim();

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
        SELECT
            TRIM(A.CODIGOARTICULO) AS code,
            TRIM(A.DESCRIPCIONARTICULO) AS name,
            TRIM(A.CODIGOMARCA) AS brand,
            TRIM(A.CODIGOFAMILIA) AS family,
            TRIM(A.CODIGOEAN) AS ean,
            A.UNIDADESCAJA AS unitsPerBox,
            A.UNIDADESFRACCION AS unitsFraction,
            A.UNIDADESRETRACTIL AS unitsRetractil,
            TRIM(A.UNIDADMEDIDA) AS unitMeasure,
            A.PESO AS weight,
            COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS stockEnvases,
            COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS stockUnidades,
            COALESCE(T1.PRECIOTARIFA, 0) AS precioTarifa1,
            COALESCE(T2.PRECIOTARIFA, 0) AS precioMinimo,
            COALESCE(TC.PRECIOTARIFA, 0) AS precioCliente,
            TRIM(COALESCE(A.FORMATO, '')) AS formato,
            COALESCE(A.PRODUCTOPESADOSN, '') AS productoPesado,
            COALESCE(PH.SALES_THIS_YEAR, 0) AS salesThisYear,
            COALESCE(PH.SALES_PREV_YEAR, 0) AS salesPrevYear,
            CASE WHEN COALESCE(PH.PURCHASE_COUNT, 0) > 0 THEN 1 ELSE 0 END AS hasPurchased
        FROM DSEDAC.ART A
        LEFT JOIN (
            SELECT
                TRIM(L.LCCDRF) AS CODIGOARTICULO,
                SUM(CASE WHEN L.LCAADC = ? AND (L.LCMMDC < ? OR (L.LCMMDC = ? AND L.LCDDDC <= ?)) THEN L.LCIMVT ELSE 0 END) AS SALES_THIS_YEAR,
                SUM(CASE WHEN L.LCAADC = ? AND (L.LCMMDC < ? OR (L.LCMMDC = ? AND L.LCDDDC <= ?)) THEN L.LCIMVT ELSE 0 END) AS SALES_PREV_YEAR,
                COUNT(*) AS PURCHASE_COUNT
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) = ?
              AND L.LCAADC IN (?, ?)
              AND ((L.LCAADC = ? AND (L.LCMMDC < ? OR (L.LCMMDC = ? AND L.LCDDDC <= ?)))
                OR (L.LCAADC = ? AND (L.LCMMDC < ? OR (L.LCMMDC = ? AND L.LCDDDC <= ?)))
              )
              AND ${LACLAE_SALES_FILTER}
            GROUP BY TRIM(L.LCCDRF)
        ) PH ON TRIM(A.CODIGOARTICULO) = PH.CODIGOARTICULO
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
            JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
            GROUP BY SR.CODIGOARTICULO
        ) RES ON A.CODIGOARTICULO = RES.CODIGOARTICULO
        LEFT JOIN DSEDAC.ARA T1 ON A.CODIGOARTICULO = T1.CODIGOARTICULO AND T1.CODIGOTARIFA = 1
        LEFT JOIN DSEDAC.ARA T2 ON A.CODIGOARTICULO = T2.CODIGOARTICULO AND T2.CODIGOTARIFA = 2
        LEFT JOIN DSEDAC.ARA TC ON A.CODIGOARTICULO = TC.CODIGOARTICULO
            AND TC.CODIGOTARIFA = (
                SELECT CLC.CODIGOTARIFA
                FROM DSEDAC.CLC CLC
                WHERE TRIM(CLC.CODIGOCLIENTE) = ?
                FETCH FIRST 1 ROW ONLY
            )
        ${where}
        ORDER BY
            CASE WHEN COALESCE(PH.PURCHASE_COUNT, 0) > 0 THEN 0 ELSE 1 END ASC,
            COALESCE(PH.SALES_THIS_YEAR, 0) ASC,
            COALESCE(PH.PURCHASE_COUNT, 0) DESC,
            A.DESCRIPCIONARTICULO ASC
        OFFSET ? ROWS FETCH FIRST ? ROWS ONLY`;

    const finalParams = [...historyParams, clientCodeTrimmed, ...params, offset, limit];

    const cacheKey = `pedidos:products_v2:${clientCodeTrimmed}:${search || ''}:${family || ''}:${marca || ''}:${prefamily || ''}:${offset}:${limit}`;

    try {
        const rows = await cachedQuery(
            (sql) => queryWithParams(sql, finalParams),
            sql,
            cacheKey,
            TTL.SHORT // 5 min
        );
        return rows.map(r => {
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

            return {
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
                precioCliente: parseFloat(r.PRECIOCLIENTE) || 0,
                formato: (r.FORMATO || '').trim(),
                productoPesado: (r.PRODUCTOPESADO || '').trim() === 'S',
                unitType: unitType,
                // Purchase analytics for ordering + badges
                salesThisYear: salesTY,
                salesPrevYear: salesPY,
                hasPurchased: hasPurchased === 1,
                yoyChange: salesPY > 0 ? ((salesTY - salesPY) / salesPY * 100) : (salesTY > 0 ? 100 : 0),
            };
        });
    } catch (error) {
        logger.error(`[PEDIDOS] getProducts error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// PRODUCT DETAIL (with Circuit Breaker protection)
// ============================================================================

async function getProductDetail(code, clientCode) {
    const trimCode = code.trim();
    const cacheKey = `product:detail:${trimCode}:${clientCode || 'all'}`;

    const cached = await redisCache.get(cacheKey);
    if (cached) return cached;

    try {
        const result = await productsBreaker.execute(
            () => getProductDetailRaw(trimCode, clientCode),
            () => null
        );
        
        if (result) await redisCache.set(cacheKey, result, TTL.MEDIUM);
        return result;
    } catch (error) {
        logger.error(`[PEDIDOS] getProductDetail CB error: ${error.message}`);
        return getProductDetailRaw(trimCode, clientCode);
    }
}

async function getProductDetailRaw(code, clientCode) {
    // Base product ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â expanded with ALL useful fields from ART + FAM description
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
        WHERE TRIM(A.CODIGOARTICULO) = ?`;

    // All tariffs
    const tariffSql = `
        SELECT T.CODIGOTARIFA,
            TRIM(TRF.DESCRIPCIONTARIFA) AS tarifaDesc,
            T.PRECIOTARIFA
        FROM DSEDAC.ARA T
        JOIN DSEDAC.TRF TRF ON T.CODIGOTARIFA = TRF.CODIGOTARIFA
        WHERE TRIM(T.CODIGOARTICULO) = ? AND T.PRECIOTARIFA > 0`;

    // Stock by warehouse
    const stockSql = `
        SELECT ARO.CODIGOALMACEN,
            TRIM(ALM.DESCRIPCIONALMACEN) AS almacenDesc,
            SUM(ARO.ENVASESDISPONIBLES) AS envases,
            SUM(ARO.UNIDADESDISPONIBLES) AS unidades
        FROM DSEDAC.ARO
        JOIN DSEDAC.ALM ON ARO.CODIGOALMACEN = ALM.CODIGOALMACEN
        WHERE TRIM(ARO.CODIGOARTICULO) = ?
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
        const product = {
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
        if (clientCode) {
            const h0 = Date.now();
            logger.info(`[PEDIDOS] getProductDetail stage=HISTORICO code=${trimCode} client=${clientCode}`);
            try {
                const clientPriceSql = `
                    SELECT L.PRECIOVENTA AS PRECIOCLIENTE
                    FROM DSEDAC.LINDTO L
                    WHERE TRIM(L.CODIGOARTICULO) = ?
                      AND TRIM(L.CODIGOCLIENTEALBARAN) = ?
                      AND L.TIPOVENTA IN ('CC', 'VC')
                      AND L.CLASELINEA IN ('AB', 'VT')
                      AND L.SERIEALBARAN NOT IN ('N', 'Z')
                    ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
                    FETCH FIRST 1 ROW ONLY`;
                const priceRows = await queryWithParams(clientPriceSql, [trimCode, clientCode.trim()]);
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
        logger.info(`[PEDIDOS] getProductDetail stage=TARIFA_CLIENTE code=${trimCode} client=${clientCode || 'none'}`);
        let clientTarifaCode = 1;
        try {
            if (clientCode) {
                const cliTarifaSql = `
                    SELECT COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFA
                    FROM DSEDAC.CLC
                    WHERE TRIM(CODIGOCLIENTE) = ?
                    FETCH FIRST 1 ROW ONLY`;
                const cliRows = await queryWithParams(cliTarifaSql, [clientCode.trim()]);
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

async function getStock(code, almacen = 1) {
    // Real stock minus reserved stock from confirmed orders
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
              AND C.ESTADO = 'CONFIRMADO'
        ) R`;

    const trimCode = code.trim();
    const cacheKey = `pedidos:stock:${trimCode}:${almacen}`;

    try {
        const rows = await cachedQuery(
            (sql) => queryWithParams(sql, [trimCode, almacen, trimCode]),
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

// ============================================================================
// ORDER SEQUENCE
// ============================================================================

async function getNextOrderNumber(ejercicio) {
    // Atomic UPDATE+INSERT pattern (no MERGE ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â not supported on all DB2/i versions)
    // Step 1: Try UPDATE existing row
    try {
        await queryWithParams(
            `UPDATE ${ERP_SCHEMA}.PEDIDOS_SEQ SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1 WHERE EJERCICIO = ?`,
            [ejercicio], false
        );
    } catch (updErr) {
        logger.warn(`[PEDIDOS] SEQ UPDATE failed: ${updErr.message}`);
    }

    // Step 2: Check if row exists after UPDATE
    const checkRows = await queryWithParams(
        `SELECT ULTIMO_NUMERO FROM ${ERP_SCHEMA}.PEDIDOS_SEQ WHERE EJERCICIO = ?`,
        [ejercicio], false
    );

    if (checkRows && checkRows.length > 0) {
        return checkRows[0].ULTIMO_NUMERO;
    }

    // Step 3: Row doesn't exist ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â INSERT new year
    try {
        await queryWithParams(
            `INSERT INTO ${ERP_SCHEMA}.PEDIDOS_SEQ (EJERCICIO, ULTIMO_NUMERO) VALUES (?, 1)`,
            [ejercicio], false
        );
        return 1;
    } catch (insErr) {
        // Concurrent INSERT race ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â another process created it first, just UPDATE+SELECT
        logger.warn(`[PEDIDOS] SEQ INSERT race: ${insErr.message}`);
        await queryWithParams(
            `UPDATE ${ERP_SCHEMA}.PEDIDOS_SEQ SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1 WHERE EJERCICIO = ?`,
            [ejercicio], false
        );
        const retryRows = await queryWithParams(
            `SELECT ULTIMO_NUMERO FROM ${ERP_SCHEMA}.PEDIDOS_SEQ WHERE EJERCICIO = ?`,
            [ejercicio], false
        );
        return retryRows[0]?.ULTIMO_NUMERO || 1;
    }
}

// ============================================================================
// CREATE ORDER
// ============================================================================

async function createOrder({ clientCode, clientName, vendedorCode, tipoventa = 'CC', almacen = 1, tarifa = 1, formaPago = '02', observaciones = '', descuentoGlobal = 0, lines = [], origen = 'A' }) {
    if (!clientCode || !vendedorCode) {
        throw new Error('clientCode and vendedorCode are required');
    }
    if (!lines || lines.length === 0) {
        throw new Error('At least one line is required');
    }

    const now = new Date();
    const ejercicio = now.getFullYear();
    const dia = now.getDate();
    const mes = now.getMonth() + 1;
    const ano = now.getFullYear();
    const hora = parseInt(`${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`, 10);

    const numeroPedido = await getNextOrderNumber(ejercicio);

    // Insert header ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â ORIGEN column may not exist in older installs
    let cabSql, cabParams;
    try {
        // Try with ORIGEN first (normal case)
        cabSql = `
            INSERT INTO ${ERP_SCHEMA}.PEDIDOS_CAB (
                EJERCICIO, NUMEROPEDIDO, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
                CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGOFORMAPAGO,
                CODIGOTARIFA, CODIGOALMACEN, TIPOVENTA, OBSERVACIONES, DESCUENTO_GLOBAL, ORIGEN
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        cabParams = [
            ejercicio, numeroPedido, dia, mes, ano, hora,
            clientCode.trim(), (clientName || '').substring(0, 60), (vendedorCode || '').split(',')[0].trim().substring(0, 2),
            formaPago, tarifa, almacen, tipoventa, (observaciones || '').substring(0, 200), parseFloat(descuentoGlobal) || 0, origen
        ];
        await queryWithParams(cabSql, cabParams, false);
    } catch (cabErr) {
        // If column not found (42S22) ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â retry without ORIGEN
        const states = (cabErr.odbcErrors || []).map(e => e.state);
        if (states.includes('42S22') || (cabErr.message || '').includes('-205')) {
            logger.warn(`[PEDIDOS] ORIGEN column missing, inserting without it`);
            cabSql = `
                INSERT INTO ${ERP_SCHEMA}.PEDIDOS_CAB (
                    EJERCICIO, NUMEROPEDIDO, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
                    CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGOFORMAPAGO,
                    CODIGOTARIFA, CODIGOALMACEN, TIPOVENTA, OBSERVACIONES
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            cabParams = [
                ejercicio, numeroPedido, dia, mes, ano, hora,
                clientCode.trim(), (clientName || '').substring(0, 60), (vendedorCode || '').split(',')[0].trim().substring(0, 2),
                formaPago, tarifa, almacen, tipoventa, (observaciones || '').substring(0, 200)
            ];
            await queryWithParams(cabSql, cabParams, false);
        } else {
            throw cabErr;
        }
    }

    // Retrieve the generated ID
    const idRows = await queryWithParams(
        `SELECT ID FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE EJERCICIO = ? AND NUMEROPEDIDO = ? ORDER BY ID DESC FETCH FIRST 1 ROW ONLY`,
        [ejercicio, numeroPedido]
    );
    const pedidoId = idRows[0]?.ID;
    if (!pedidoId) throw new Error('Failed to retrieve created order ID');

    // Insert lines with compensation pattern: if any line fails, delete the header
    try {
        for (let i = 0; i < lines.length; i++) {
            const ln = lines[i];
            
            let cantidadEnvases = parseFloat(ln.cantidadEnvases) || 0;
            let cantidadUnidades = parseFloat(ln.cantidadUnidades) || parseFloat(ln.cantidad) || 0;
            let unidadesCaja = parseFloat(ln.unidadesCaja) || 1;
            let unidadMedida = ln.unidadMedida || 'CAJAS';
            let precio = parseFloat(ln.precio) || parseFloat(ln.precioVenta) || 0;
            
            const importeVenta = calculateLineImporte({
                unidadMedida,
                cantidadEnvases,
                cantidadUnidades,
                unidadesCaja,
                precioVenta: precio
            });
            const billingQty = unidadMedida === 'CAJAS' ? cantidadEnvases : cantidadUnidades;
            const importeCosto = parseFloat(ln.importeCosto) || Math.round((billingQty * (parseFloat(ln.precioCosto) || 0)) * 100) / 100;
            const importeMargen = importeVenta - importeCosto;
            const pctMargen = importeVenta > 0 ? ((importeMargen / importeVenta) * 100) : 0;

            const linSql = `
                INSERT INTO ${ERP_SCHEMA}.PEDIDOS_LIN (
                    PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION,
                    CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA,
                    PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
                    IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
                    TIPOLINEA, TIPOVENTA, CLASELINEA, ORDEN
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            const linParams = [
                pedidoId, i + 1,
                (ln.codigoArticulo || '').trim(), (ln.descripcion || '').substring(0, 40),
                cantidadEnvases, cantidadUnidades,
                unidadMedida, unidadesCaja,
                precio, parseFloat(ln.precioCosto) || 0,
                parseFloat(ln.precioTarifa) || 0, parseFloat(ln.precioTarifaCliente) || 0,
                parseFloat(ln.precioMinimo) || 0,
                importeVenta, importeCosto, importeMargen,
                Math.round(pctMargen * 100) / 100,
                ln.tipoLinea || 'R', ln.tipoventa || tipoventa, ln.claseLinea || 'VT', i + 1
            ];

            await queryWithParams(linSql, linParams, false);
        }
    } catch (linErr) {
        // COMPENSATION: If lines fail, delete the header to avoid orphaned orders
        logger.error(`[PEDIDOS] Failed to insert lines for order ${pedidoId}, rolling back header: ${linErr.message}`);
        try {
            await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`, [pedidoId], false);
            logger.info(`[PEDIDOS] Successfully rolled back orphaned header ID=${pedidoId}`);
        } catch (delErr) {
            logger.error(`[PEDIDOS] CRITICAL: Failed to rollback orphaned header ID=${pedidoId}: ${delErr.message}`);
        }
        throw linErr;
    }

    // Recalculate totals
    await recalculateOrderTotals(pedidoId);

    // Invalida caché de listados de pedidos para reflejar el nuevo borrador.
    invalidatePedidosCache(pedidoId);

    // Return created order
    return getOrderDetail(pedidoId);
}

// ============================================================================
// GET ORDERS
// ============================================================================

async function getOrders({ vendedorCodes, status, year, month, dateFrom, dateTo, search, minAmount, maxAmount, sortBy, sortOrder, limit = 50, offset = 0 }) {
    if (!vendedorCodes) throw new Error('vendedorCodes is required');

    const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';

    // Req #7: Si IMPORTETOTAL viene a 0 (borradores sin recalcular), calcular fallback
    // desde la suma real de IMPORTEVENTA en PEDIDOS_LIN. IMPORTE_CALCULADO se prioriza
    // sobre IMPORTETOTAL en el adaptador de routes.
    let sql = `
        SELECT C.ID, C.EJERCICIO, C.NUMEROPEDIDO, C.SERIEPEDIDO,
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
            C.CREATED_AT, C.UPDATED_AT,
            COALESCE(LC.LINE_COUNT, 0) AS LINE_COUNT
        FROM ${ERP_SCHEMA}.PEDIDOS_CAB C
        LEFT JOIN (
            SELECT PEDIDO_ID,
                   COUNT(*) AS LINE_COUNT,
                   COALESCE(SUM(IMPORTEVENTA), 0) AS LINE_TOTAL,
                   COALESCE(SUM(IMPORTECOSTO), 0) AS LINE_COST
            FROM ${ERP_SCHEMA}.PEDIDOS_LIN
            GROUP BY PEDIDO_ID
        ) LC ON C.ID = LC.PEDIDO_ID
        WHERE 1=1`;

    const params = [];

    if (!isAll) {
        const vendorList = vendedorCodes.split(',').map(v => v.trim()).filter(Boolean);
        // DB2 ODBC has a limit on parameter markers; 50+ vendors ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â  ALL
        if (vendorList.length > 50) {
            // Treat as ALL ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â no vendor filter
        } else if (vendorList.length === 1) {
            sql += ` AND TRIM(C.CODIGOVENDEDOR) = ?`;
            params.push(vendorList[0]);
        } else {
            sql += ` AND TRIM(C.CODIGOVENDEDOR) IN (${vendorList.map(() => '?').join(',')})`;
            params.push(...vendorList);
        }
    }

    if (status) {
        sql += ` AND TRIM(C.ESTADO) = ?`;
        params.push(status.trim());
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
    sql += ` OFFSET ${parseInt(offset)} ROWS FETCH FIRST ${parseInt(limit)} ROWS ONLY`;

    try {
        const rows = await queryWithParams(sql, params);
        if (!rows || rows.length === 0) {
            return [];
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
            return {
                id: r.ID,
                ejercicio: r.EJERCICIO,
                numeroPedido: r.NUMEROPEDIDO,
                numeroPedidoFormatted: `${r.SERIEPEDIDO || 'M'}-${ano}-${numPedido}`,
                serie: r.SERIEPEDIDO,
                fecha: `${dia}/${mes}/${ano}`,
                fechaFormatted: `${dia}/${mes}/${ano} ${hh}:${mm}`,
                clienteCode: r.CODIGOCLIENTE,
                clienteName: r.NOMBRECLIENTE || `Cliente ${r.CODIGOCLIENTE}`,
                vendedorCode: r.CODIGOVENDEDOR,
                tipoventa: r.TIPOVENTA,
                estado: r.ESTADO,
                // Req #7: prioriza el total calculado desde líneas si IMPORTETOTAL
                // está a 0 (típico en borradores sin recalcular cabecera).
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

async function getOrderDetail(orderId) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

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
            ORDEN, CREATED_AT
        FROM ${ERP_SCHEMA}.PEDIDOS_LIN
        WHERE PEDIDO_ID = ?
        ORDER BY SECUENCIA`;

    try {
        const [cabRows, linRows] = await Promise.all([
            queryWithParams(cabSql, [id]),
            queryWithParams(linSql, [id]),
        ]);

        if (!cabRows || cabRows.length === 0) {
            throw new Error('Pedido no encontrado');
        }

        const cab = cabRows[0];
        const fechaReparto = cab.FECHAREPARTO ? parseDeliveryDate(cab.FECHAREPARTO) : null;
        return {
            header: {
                id: cab.ID,
                ejercicio: cab.EJERCICIO,
                numeroPedido: cab.NUMEROPEDIDO,
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
                estado: cab.ESTADO,
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
            lines: (linRows || []).map(l => ({
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
                tipoLinea: l.TIPOLINEA,
                tipoventa: l.TIPOVENTA,
                claseLinea: l.CLASELINEA,
                orden: l.ORDEN,
                createdAt: l.CREATED_AT,
            })),
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
    } else if (envases > 0 && unidades > 0 && um === 'CAJAS') {
        const expectedEquivalentUnits = envases * uc;
        const unitsAreBoxEquivalence = Math.abs(unidades - expectedEquivalentUnits) < 0.0001
            || unidades >= expectedEquivalentUnits;
        importe = unitsAreBoxEquivalence
            ? envases * precio
            : (envases + (unidades / uc)) * precio;
    } else if (um === 'CAJAS') {
        importe = envases * precio;
    } else {
        // PIEZAS, BANDEJAS, ESTUCHES, UNIDADES, etc.
        importe = unidades * precio;
    }
    return Math.round(importe * 100) / 100;
}

// ============================================================================
// ADD / UPDATE / DELETE LINE
// ============================================================================

async function addOrderLine(pedidoId, lineData) {
    const id = parseInt(pedidoId);
    if (isNaN(id)) throw new Error('Invalid pedidoId');

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

    // P1-A: Use shared calculator for consistent importe across add/create
    const importeVenta = calculateLineImporte({ unidadMedida, cantidadEnvases, cantidadUnidades, unidadesCaja, precioVenta: precio });
    const billingQty = (unidadMedida === 'CAJAS') ? cantidadEnvases : cantidadUnidades;
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
            TIPOLINEA, TIPOVENTA, CLASELINEA, ORDEN
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
        id, nextSeq,
        (lineData.codigoArticulo || '').trim(), (lineData.descripcion || '').substring(0, 40),
        cantidadEnvases, cantidadUnidades,
        unidadMedida, unidadesCaja,
        precio, precioCosto,
        parseFloat(lineData.precioTarifa) || 0, parseFloat(lineData.precioTarifaCliente) || 0,
        parseFloat(lineData.precioMinimo) || 0,
        importeVenta, importeCosto, importeMargen,
        Math.round(pctMargen * 100) / 100,
        descuentoLinea,
        lineData.tipoLinea || 'R', lineData.tipoventa || 'CC', lineData.claseLinea || 'VT', nextSeq
    ];

    await queryWithParams(sql, params, false);
    await recalculateOrderTotals(id);

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
        throw new Error('claseLinea inválida');
    }

    // Fetch current line to get pedidoId and defaults
    const currentRows = await queryWithParams(
        `SELECT PEDIDO_ID, CANTIDADENVASES, CANTIDADUNIDADES, PRECIOVENTA, PRECIOCOSTO, UNIDADMEDIDA, UNIDADESCAJA, CLASELINEA FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE ID = ?`,
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
    invalidatePedidosCache(pedidoId);
    return getOrderDetail(pedidoId);
}

async function deleteOrderLine(lineId, pedidoId) {
    const lid = parseInt(lineId);
    const pid = parseInt(pedidoId);
    if (isNaN(lid) || isNaN(pid)) throw new Error('Invalid lineId or pedidoId');

    await assertOrderEditable(pid);

    await queryWithParams(
        `DELETE FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE ID = ? AND PEDIDO_ID = ?`,
        [lid, pid], false
    );

    await recalculateOrderTotals(pid);
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
            COALESCE(SUM(IMPORTEVENTA), 0) as RAW_BASE,
            COALESCE(SUM(IMPORTECOSTO), 0) as RAW_COSTO
         FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE PEDIDO_ID = ?`,
        [id]
    );
    const rawBase = parseFloat(rows[0]?.RAW_BASE) || 0;
    const rawCosto = parseFloat(rows[0]?.RAW_COSTO) || 0;

    await queryWithParams(
        `UPDATE ${ERP_SCHEMA}.PEDIDOS_CAB SET
            IMPORTEBASE = ?,
            IMPORTECOSTO = ?,
            IMPORTETOTAL = ROUND(? * (1 - COALESCE(DESCUENTO_GLOBAL, 0) / 100), 2),
            IMPORTEMARGEN = ROUND(? * (1 - COALESCE(DESCUENTO_GLOBAL, 0) / 100), 2) - ?,
            IMPORTEIVA = 0,
            UPDATED_AT = CURRENT_TIMESTAMP
        WHERE ID = ?`,
        [rawBase, rawCosto, rawBase, rawBase, rawCosto, id], false
    );
}

// ============================================================================
// CONFIRM / CANCEL
// ============================================================================

async function confirmOrder(orderId, saleType, options = {}) {
    const id = parseInt(orderId);
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
            AND ESTADO = 'BORRADOR'`,
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

    const currentState = (currentRows[0].ESTADO || '').trim();

    // Si rowsAffected es 0 y el estado NO es CONFIRMANDO de este request,
    // significa que otro proceso lo tomo (CONFIRMADO/ENVIADO) o estaba en
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
                ORDEN
         FROM ${ERP_SCHEMA}.PEDIDOS_LIN WHERE PEDIDO_ID = ?`, [id]);

    const stockWarnings = [];
    const outOfStockProducts = [];

    // P0-BOLSA: Validate bolsa comercial before confirming
    try {
        const bolsaService = require('./bolsa-comercial.service');
        const bolsaResult = await bolsaService.validateOrderWithBolsa(vendedorCode, lines);
        if (!bolsaResult.valid && !options.forceConfirm) {
            await revertConfirming('BOLSA_INSUFICIENTE');
            return {
                blocked: true,
                reason: 'BOLSA_INSUFICIENTE',
                deficit: bolsaResult.deficit,
                saldoBolsa: bolsaResult.saldo,
                warnings: bolsaResult.warnings,
                message: `Bolsa comercial insuficiente. Déficit: ${bolsaResult.deficit.toFixed(2)}. Saldo: ${bolsaResult.saldo.toFixed(2)}`,
            };
        }
        if (bolsaResult.consumo > 0) {
            options._bolsaConsumo = bolsaResult.consumo;
        }
    } catch (bolsaErr) {
        logger.warn(`[PEDIDOS] Bolsa validation skipped: ${bolsaErr.message}`);
    }

    for (const line of lines) {
        const code = (line.CODIGOARTICULO || '').trim();
        if (!code) continue;
        try {
            // Force fresh stock read (bypass cache) for confirmation
            const stock = await getStock(code);
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
    if (stockWarnings.length > 0 && !options.forceConfirm) {
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

    // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ Stock reservation: insert rows for each line ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬
    if (target.shouldExportToSystem) {
        try {
            await withPedidosTransaction(async (conn) => {
                syncResult = await exportCommercialOrderToSystem(conn, {
                    header: currentRows[0],
                    lines,
                    deliveryPlan,
                    routeCode,
                    saleType,
                    userId: options.userId,
                });
                const update = buildConfirmOrderUpdate({
                    id,
                    deliveryPlan,
                    vehicleCode,
                    driverCode,
                    routeCode,
                    saleType,
                    syncResult,
                });
                await conn.query(update.sql, update.params);
                await reserveStockLines((sql, params) => conn.query(sql, params), lines, id);
            });
            logger.info(`[PEDIDOS] Order #${id} exported to ${syncResult.targetSchema}.CPC and confirmed`);
        } catch (systemErr) {
            logger.error(`[PEDIDOS] System export failed for order #${id}: ${systemErr.message}`);
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
            saleType,
            syncResult,
        });
        await queryWithParams(update.sql, update.params, false);

        try {
            await reserveStockLines((sql, params) => queryWithParams(sql, params, false), lines, id);
            logger.info(`[PEDIDOS] Stock reserved for order #${id}`);
        } catch (resErr) {
        logger.error(`[PEDIDOS] CRITICAL: Stock reservation failed for order #${id}, rolling back: ${resErr.message}`);
        // P0-B: Rollback ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â set estado back to BORRADOR if reservation fails
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
    try {
        if (redisCache && typeof redisCache.invalidatePattern === 'function') {
            await redisCache.invalidatePattern('pedidos:*');
        }
    } catch (e) {
        logger.warn(`[PEDIDOS] Failed to invalidate cache: ${e.message}`);
    }

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
            saleType: saleType || order?.header?.tipoventa,
            deliveryDate: deliveryPlan.date.iso,
            deliveryDays: deliveryPlan.allowedDays,
            vehicleCode,
            driverCode,
            routeCode,
            lineCount: lines.length,
            stockWarningCount: stockWarnings.length,
            forceConfirm: !!options.forceConfirm,
            userId: options.userId || 'SYSTEM'
        };
        logger.info(`[AUDIT] ✅ ORDER_CONFIRMED #${id} | Client:${auditEntry.clientCode} | Total:${auditEntry.total} | Lines:${lines.length}`);
    } catch (auditErr) { /* silent */ }

    // P0-BOLSA: Consume from bolsa after successful confirmation
    if (options._bolsaConsumo > 0) {
        try {
            const bolsaService = require('./bolsa-comercial.service');
            await bolsaService.consumirBolsa(vendedorCode, id, options._bolsaConsumo);
        } catch (bolsaErr) {
            logger.warn(`[PEDIDOS] Bolsa consumption failed (order confirmed anyway): ${bolsaErr.message}`);
        }
    }

    // Invalida caché tras confirmación (cambia ESTADO, importes y stock reservas).
    invalidatePedidosCache(id);

    return { ...order, stockWarnings };
}

async function cancelOrder(orderId, options = {}) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    // STATE GUARD: Get current state before cancelling
    const currentRows = await queryWithParams(
        `SELECT ESTADO, CODIGOCLIENTE, IMPORTETOTAL FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`,
        [id], false
    );
    
    if (!currentRows || currentRows.length === 0) {
        throw new Error('Pedido no encontrado');
    }
    
    const currentState = (currentRows[0].ESTADO || '').trim();
    
    // Prevent double-cancel
    if (currentState === 'ANULADO') {
        throw new Error('El pedido ya está anulado');
    }
    
    // Prevent cancelling shipped orders
    if (currentState === 'ENVIADO') {
        throw new Error('No se puede anular un pedido que ya ha sido enviado');
    }
    
    // Only allow cancelling BORRADOR or CONFIRMADO orders
    if (!['BORRADOR', 'CONFIRMADO'].includes(currentState)) {
        throw new Error(`No se puede anular un pedido en estado: ${currentState}`);
    }

    // Get order info for audit before cancelling
    let orderBefore;
    try { orderBefore = await getOrderDetail(id); } catch (e) { /* ok */ }

    await queryWithParams(
        `UPDATE ${ERP_SCHEMA}.PEDIDOS_CAB SET ESTADO = 'ANULADO', UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?`,
        [id], false
    );

    // Release stock reservations (only if order was CONFIRMADO)
    const releasedCodes = [];
    if (currentState === 'CONFIRMADO') {
        try {
            const reservations = await queryWithParams(
                `SELECT CODIGOARTICULO FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?`, [id]
            );
            releasedCodes.push(...reservations.map(r => (r.CODIGOARTICULO || '').trim()).filter(Boolean));
            await queryWithParams(`DELETE FROM ${ERP_SCHEMA}.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?`, [id], false);
            logger.info(`[PEDIDOS] Stock reservations released for cancelled order #${id}`);
        } catch (e) {
            logger.warn(`[PEDIDOS] Stock reservation release error: ${e.message}`);
        }
    }

    // P4-A: Invalidate stock and product cache for released products
    try {
        if (redisCache && typeof redisCache.invalidatePattern === 'function') {
            await redisCache.invalidatePattern('pedidos:*');
        }
    } catch (e) {
        logger.warn(`[PEDIDOS] Failed to invalidate cache: ${e.message}`);
    }

    // AUD: Audit log for cancellation
    try {
        logger.info(`[AUDIT] ❌ ORDER_CANCELLED #${id} | Client:${currentRows[0].CODIGOCLIENTE || '?'} | Total:${currentRows[0].IMPORTETOTAL || 0} | From:${currentState} | By:${options.userId || 'SYSTEM'}`);
    } catch (auditErr) { /* silent */ }

    return getOrderDetail(id);
}

// ============================================================================
// ORDER STATUS UPDATE (for Pendiente AprobaciÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n)
// ============================================================================

async function updateOrderStatus(orderId, newStatus, options = {}) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    const requestedStatus = canonicalOrderStatus(newStatus);
    if (!ORDER_TRANSITIONS[requestedStatus]) {
        throw new OrderStateError(
            'INVALID_ORDER_STATUS',
            `Estado no válido: ${newStatus}`,
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
            await redisCache.invalidatePattern('pedidos:*');
        }
    } catch (e) {
        logger.warn(`[PEDIDOS] Failed to invalidate cache: ${e.message}`);
    }

    // AUD: Audit log
    try {
        logger.info(`[AUDIT] 🔄 ORDER_STATUS_CHANGED #${id} | ${orderBefore?.header?.estado || '?'} -> ${status} | By:${options.userId || 'SYSTEM'}`);
    } catch (auditErr) { /* silent */ }

    return getOrderDetail(id);
}

// ============================================================================
// ORDER STATS
// ============================================================================

async function getOrderStats(vendedorCodes, dateFrom, dateTo) {
    const whereParts = [];
    const params = [];

    if (vendedorCodes && vendedorCodes.trim().toUpperCase() !== 'ALL') {
        const codes = vendedorCodes.split(',').map(c => c.trim()).filter(Boolean);
        // DB2 ODBC limit on parameter markers; 50+ vendors ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â  ALL
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
        }
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
        GROUP BY ESTADO`;

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
            byStatus[(s.ESTADO || '').trim()] = parseInt(s.CNT) || 0;
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
        `SELECT CODIGOCLIENTE, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, NUMEROPEDIDO
         FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID = ?`,
        [id]
    );
    if (!orderRows || orderRows.length === 0) throw new Error('Pedido no encontrado');

    const order = orderRows[0];
    const clientCode = (order.CODIGOCLIENTE || '').trim();

    const albaranSql = `
        SELECT TRIM(C.NUMEROALBARAN) AS NUMEROALBARAN,
               TRIM(C.SERIEALBARAN) AS SERIEALBARAN,
               C.DIADOCUMENTO, C.MESDOCUMENTO, C.ANODOCUMENTO,
               TRIM(C.CODIGOCLIENTE) AS CODIGOCLIENTE,
               C.IMPORTEALBARAN,
               TRIM(C.SITUACIONALBARAN) AS SITUACION,
               TRIM(C.ESTADOENVIO) AS ESTADOENVIO
        FROM DSEDAC.CAC C
        WHERE TRIM(C.CODIGOCLIENTE) = ?
          AND C.ANODOCUMENTO = ?
          AND C.ELIMINADOSN <> 'N'
        ORDER BY C.ANODOCUMENTO DESC, C.MESDOCUMENTO DESC, C.DIADOCUMENTO DESC
        FETCH FIRST 3 ROWS ONLY`;

    try {
        const rows = await queryWithParams(albaranSql, [clientCode, order.ANODOCUMENTO]);
        return (rows || []).map(r => ({
            numeroAlbaran: r.NUMEROALBARAN,
            serie: r.SERIEALBARAN,
            fecha: `${String(r.DIADOCUMENTO).padStart(2, '0')}/${String(r.MESDOCUMENTO).padStart(2, '0')}/${r.ANODOCUMENTO}`,
            situacion: (r.SITUACION || '').trim(),
            estadoEnvio: (r.ESTADOENVIO || '').trim(),
            importe: parseFloat(r.IMPORTEALBARAN) || 0,
        }));
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

    const trimClient = clientCode.trim();
    const trimVendor = (vendedorCode || '').trim();

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
        WHERE TRIM(L.CODIGOCLIENTEALBARAN) = ?
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
        // Handle multi-vendor codes (comma-separated) ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â use first code only
        // CODIGOVENDEDOR is CHAR(2), can't hold the full comma string
        const singleVendor = trimVendor.split(',')[0].trim().substring(0, 2);
        const similarSql = `
            SELECT TRIM(L.CODIGOARTICULO) AS code,
                TRIM(L.DESCRIPCION) AS name,
                COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) AS clientCount
            FROM DSEDAC.LINDTO L
            WHERE TRIM(L.CODIGOVENDEDOR) = ?
              AND L.ANODOCUMENTO = YEAR(CURRENT_DATE)
              AND L.TIPOVENTA IN ('CC', 'VC')
              AND L.CLASELINEA IN ('AB', 'VT')
              AND L.SERIEALBARAN NOT IN ('N', 'Z')
              AND NOT EXISTS (
                  SELECT 1 FROM DSEDAC.LINDTO L2
                  WHERE L2.CODIGOARTICULO = L.CODIGOARTICULO
                    AND TRIM(L2.CODIGOCLIENTEALBARAN) = ?
                    AND (L2.ANODOCUMENTO * 12 + L2.MESDOCUMENTO)
                        >= (YEAR(CURRENT_DATE) * 12 + MONTH(CURRENT_DATE) - 3)
              )
            GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
            HAVING COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) >= 3
            ORDER BY clientCount DESC
            FETCH FIRST 10 ROWS ONLY`;
        try {
            const similarRows = await queryWithParams(similarSql, [singleVendor, trimClient]);
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

    // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ Enrich recommendations with real product data (price, stock) ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬
    const allCodes = [
        ...history.map(h => h.code),
        ...similar.map(s => s.code),
    ].filter(Boolean);

    if (allCodes.length > 0) {
        try {
            const placeholders = allCodes.map(() => '?').join(',');
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
                        WHERE TRIM(CLC.CODIGOCLIENTE) = ?
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
    // Req #14: incluir prefamilia para agrupaciones tipo "Nestlé".
    // Se devuelven tanto código simple (compat) como objeto completo cuando el caller
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
 * agrupar dinámicamente (ej.: chip "Nestlé" suma todas las familias cuya
 * prefamilia comience por NESTL%, etc.).
 */
async function getFamiliesDetailed() {
    const sql = `
        SELECT
            TRIM(CODIGOFAMILIA) AS CODE,
            COALESCE(MAX(TRIM(DESCRIPCIONFAMILIA)), '') AS NAME,
            COALESCE(MAX(TRIM(CODIGOPREFAMILIA)), '') AS PREFAMILY,
            COUNT(*) AS ART_COUNT
        FROM DSEDAC.ART
        WHERE (ANOBAJA = 0 OR ANOBAJA IS NULL)
          AND CODIGOFAMILIA <> ''
        GROUP BY TRIM(CODIGOFAMILIA)
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
 * borradores y opcionalmente auto-confirma el más antiguo. Se diseña como
 * función pura (lectura) por defecto; el caller (route POST /pedidos)
 * decide si invocar la auto-confirmación pasando `autoConfirm: true`.
 */
async function checkDraftAccumulation(vendedorCode, { autoConfirm = false, threshold = 3, options = {} } = {}) {
    const code = String(vendedorCode || '').trim();
    if (!code) return { warning: false, drafts: [] };

    let drafts = [];
    try {
        drafts = await queryWithParams(
            `SELECT ID, NUMEROPEDIDO, TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE,
                    TRIM(NOMBRECLIENTE) AS NOMBRECLIENTE, IMPORTETOTAL, CREATED_AT
             FROM ${ERP_SCHEMA}.PEDIDOS_CAB
             WHERE TRIM(CODIGOVENDEDOR) = ?
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
            message: `Tienes ${drafts.length} borradores acumulados. Se recomienda confirmar el más antiguo (#${oldest.NUMEROPEDIDO}).`,
            drafts,
        };
    }

    // Auto-confirm path (opt-in): seguro con try/catch que NO bloquea creación
    try {
        await confirmOrder(oldest.ID, 'CC', {
            ...options,
            userId: options.userId || 'AUTO_DRAFT_GUARD',
            forceConfirm: true,
        });
        logger.warn(`[PEDIDOS] Auto-confirmed draft #${oldest.NUMEROPEDIDO} (id=${oldest.ID}) por acumulación (${drafts.length})`);
        return {
            warning: true,
            autoConfirmed: true,
            autoConfirmedId: oldest.ID,
            autoConfirmedNumber: oldest.NUMEROPEDIDO,
            count: drafts.length,
            message: `Tenías ${drafts.length} borradores. El más antiguo (#${oldest.NUMEROPEDIDO}) se ha confirmado automáticamente.`,
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
            message: `${drafts.length} borradores acumulados. No se pudo auto-confirmar el más antiguo (${confirmErr.code || confirmErr.message}).`,
        };
    }
}

// Cache de descubrimiento: tabla fuente + columnas presentes.
let _promoSource = null; // { table: 'PRD'|'PMR'|'NONE', cols: Set<string> }

async function detectPromoSource() {
    if (_promoSource) return _promoSource;
    const candidates = ['PRD', 'PMR'];
    for (const t of candidates) {
        try {
            const cols = await queryWithParams(
                `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
                  WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = ?`,
                [t], false, false
            );
            if (Array.isArray(cols) && cols.length > 0) {
                const set = new Set(cols.map(c => String(c.COLUMN_NAME || '').trim().toUpperCase()));
                _promoSource = { table: t, cols: set };
                logger.info(`[PEDIDOS] Tabla de promociones detectada: DSEDAC.${t} (${set.size} cols)`);
                return _promoSource;
            }
        } catch (_) { /* sigue probando */ }
    }
    _promoSource = { table: 'NONE', cols: new Set() };
    logger.warn(`[PEDIDOS] Ninguna tabla de promociones (PRD/PMR) existe en DSEDAC. Promociones desactivadas.`);
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

        // ── PMR schema: gift promotions (client-specific, no product-level data) ──
        if (src.table === 'PMR') {
            return getActivePromotionsPMR(trimmedClientCode, today);
        }

        // ── PRD schema: product-level price promotions (original logic) ──
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
            FROM DSEDAC.${src.table} P
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
            logger.info(`[PEDIDOS] Promociones activas hoy=${today}: ${rows?.length || 0} fila(s) desde DSEDAC.${src.table}`);
            if (!rows || rows.length === 0) {
                try {
                    const probe = await queryWithParams(`SELECT COUNT(*) AS TOTAL FROM DSEDAC.${src.table}`, [], false, false);
                    const total = parseInt(probe?.[0]?.TOTAL) || 0;
                    logger.info(`[PEDIDOS] DSEDAC.${src.table} total filas=${total}; vigentes hoy=0`);
                } catch (_) { /* ok */ }
            }
        } catch (e) {
            logger.warn(`[PEDIDOS] Query promociones DSEDAC.${src.table} fallo: ${e.message}`);
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

// Wrapper: routes call updateOrderLine(pedidoId, lineId, data)
async function updateOrderLineRoute(pedidoId, lineId, data) { return updateOrderLine(lineId, data); }
// Wrapper: routes call deleteOrderLine(pedidoId, lineId)
async function deleteOrderLineRoute(pedidoId, lineId) { return deleteOrderLine(lineId, pedidoId); }

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
    //     sumando los vencimientos con ANOCOBRO = año actual.
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
    // CVC.ANOCOBRO = año actual, pero ANOCOBRO solo se rellena cuando el ERP
    // procesa el cobro (puede haber retraso o estar a 0). El resultado era
    // que TODOS los clientes mostraban "Cobrado: 0,00 €".
    //
    // Mejor criterio: sumar IMPORTECANCELADO de los vencimientos del cliente
    // emitidos en el año actual, sin filtrar por ANOCOBRO. Esto refleja
    // cuanto del facturado este año YA se ha cobrado, que es lo que el
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
    const cacheKey = `pedidos:complementary:${productCodes.sort().join(',')}`;

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
        return rows.map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            cooccurrences: parseInt(r.COOCCURRENCES) || 0,
            price: parseFloat(r.PRICE) || 0,
            unitsPerBox: parseFloat(r.UNITSPERBOX) || 1,
            stockEnvases: parseFloat(r.STOCKENVASES) || 0,
            stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
            source: 'complementary',
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
        'carne': ['pollo', 'cerdo', 'vacuno', 'ternera', 'cordero', 'cabrito', 'lacÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'paleta', 'jamÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'panceta', 'tocino', 'chuleta', 'costilla', 'filete', 'solomillo', 'pechuga', 'muslo', 'pierna', 'brazo', 'hamburguesa', 'butifarra', 'morcilla', 'chorizo', 'salami', 'salchicha', 'bacon', 'lomo', 'presunto', 'cecina', 'fuet', 'sobrasada'],
        'pescado': ['pescado', 'salmÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'salmon', 'merluza', 'bacalao', 'atÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Âºn', 'atun', 'bonito', 'sardina', 'caballa', 'bacoreta', 'dorada', 'lubina', 'rape', 'rodaballo', ' lenguado', 'trucha', 'carpa', 'tenca', 'anguila', 'palometa', 'chicharro', 'jurel', 'estornino', 'melva', 'alitÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Âºn', 'coco', 'marrajo', 'cazÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'marrajo', 'tiburÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'congrio', 'anchoa', 'boquerÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'caballa'],
        'marisco': ['marisco', 'gamba', 'langostino', 'camarÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'camaron', 'bogavante', 'langosta', 'cangrejo', 'centollo', 'nÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â©cora', 'mejillÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'mejillon', 'almeja', 'berberecho', 'ostiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'ostra', 'caracol', 'calamar', 'pulpo', 'sepia', 'chipirÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'potÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'volande', 'bufÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â©', 'burga', 'chocho'],
        'verdura': ['verdura', 'hortaliza', 'lechuga', 'tomate', 'patata', 'pimiento', 'cebolla', 'ajo', 'zanahoria', 'calabacÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â­n', 'calabacin', 'berenjena', 'alcachofa', 'espÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡rrago', 'esparragos', 'guisante', 'judÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â­a', ' judia', 'habichuela', 'brÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³coli', 'brocoli', 'coliflor', 'col', 'repollo', 'acelga', 'espinaca', 'berro', 'canÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'canon', 'rucula', 'rÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Âºcula', 'endibia', 'escarola', 'apio', 'nabo', 'rÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡bano', 'rabano', 'remolacha', 'batata', 'boniato'],
        'fruta': ['fruta', 'manzana', 'pera', 'naranja', 'plÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡tano', 'platano', 'limÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'limon', 'pomelo', 'mandarina', 'kiwi', 'uva', 'sandÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â­a', 'sandia', 'melÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'melon', 'fresa', 'frambuesa', 'mora', 'arÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ndano', 'arandano', 'cereza', 'ciruela', 'melocotÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'melocoton', 'albaricoque', 'nectarina', 'higo', 'granada', 'mango', 'papaya', 'piÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â±a', 'pina', 'aguacate', 'coco', 'calabaza', 'calabaza'],
        'lÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡cteo': ['leche', 'queso', 'yogur', 'yogurt', 'mantequilla', 'nata', 'crema', 'cuajada', 'requesÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'requeson', 'ricotta', 'mascarpone', 'parmesano', 'gruyere', 'emmental', 'cheddar', 'brie', 'camembert', 'roquefort', 'cabrales', 'gorgonzola', 'manchego', 'tierno', 'semicurado', 'curado', 'viejo', 'fresco'],
        'huevo': ['huevo', 'huevos', 'clara', 'yema', 'yemas'],
        'panaderÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â­a': ['pan', 'baguette', 'brioche', 'croissant', 'croasÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡n', 'ensaÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¯mada', 'mollete', 'chapata', 'pita', 'naan', 'tortilla', 'panecillo', 'bollo'],
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
        'lonchas': ['loncha', 'lonchas', 'lamina', 'lÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡minas', 'laminas', 'flete', 'fletes'],
        'filetes': ['filete', 'filetes', 'filet', 'steak', 'steaks', 'bistec', 'bistecs'],
        'trozos': ['trozo', 'trozos', 'pedazo', 'pedazos', 'porciÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'porciones', 'portion', 'portions', 'troceado', 'trocead', 'picado', 'picad'],
        'deshuesado': ['deshuesado', 'deshuesad', 'sin hueso', 'deshuesar', 'hueso', 'bone', 'boneless'],
        'pelado': ['pelado', 'pelad', 'sin piel', 'pelar', 'skin', 'skinned', 'mondado'],
        'vacÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â­o': ['vacio', 'vacÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â­o', 'blanco', 'vaciar', 'vacÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â­o'],
        'vivo': ['vivo', 'viva', 'vivoa', 'vivas'],
        'fresco': ['fresco', 'fresca', 'refrigerado', 'refrigerad', 'nevera', 'cold'],
        'envasado': ['envasado', 'pack', 'paquete', 'bolsa', 'bandeja', 'caja', 'tarro', 'bote'],
    };
    
    // ========================================
    // PROCESSED/RAW DETECTION
    // ========================================
    const processedPatterns = [
        'empanadilla', 'empanada', 'empanad', 'cocido', 'hervido', 'asado', 'horneado',
        'albÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³ndiga', 'albondiga', 'nugget', 'nuggets', 'croqueta', 'croquetas',
        'fileteado', 'filetead', 'rebanado', 'rebanad', 'preparado', 'preparad', 
        'receta', 'listo', 'cocinar', 'gourmet', 'cocinado', 'procesad',
        'salami', 'chorizo', 'ibÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â©rico', 'iberico', 'jamÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'jamon', 'paleta',
        'lacÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'lacon', 'panceta', 'cecina', 'fuet', 'sobrasada', 'mortadela',
        'patÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â©', 'pate', 'foie', 'butifarra', 'morcilla', 'longaniza', 'cheddar',
        'manchego', 'queso', 'hamburguesa', 'salchicha', 'guiso', 'estofado',
        'carneada', 'cecina', 'beicon', 'tocino', 'salazÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'salazon'
    ];
    
    // ========================================
    // MAIN INGREDIENT DETECTION (what's the base)
    // ========================================
    const ingredientPatterns = {
        'pollo': ['pollo', 'gallina', 'capÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'capon', 'pavo', 'codorniz'],
        'cerdo': ['cerdo', 'porcino', 'cochino', 'gorrino', 'ibÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â©rico', 'iberico'],
        'vacuno': ['vacuno', 'ternera', 'res', 'buey', 'vaca', 'buey'],
        'cordero': ['cordero', 'cabra', 'cÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â§ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â°'],
        'pescado_blanco': ['merluza', 'bacalao', 'lubina', 'dorada', 'rape', 'lenguado', 'rodaballo', 'pescada'],
        'pescado_azul': ['salmÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'salmon', 'atÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Âºn', 'atun', 'bonito', 'sardina', 'caballa', 'jurel', 'chicharro'],
        'marisco': ['gamba', 'langostino', 'camarÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'camaron', 'bogavante', 'langosta', 'cangrejo', 'mejilla', 'mejillon', 'almeja', 'pulpo', 'calamar', 'sepia'],
        'verdura': ['verdura', 'hortaliza', 'lechuga', 'tomate', 'patata', 'cebolla', 'ajo', 'zanahoria', 'pimiento', 'berenjena', 'calabacÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â­n', 'calabacin', 'alcachofa', 'espÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡rrago', 'esparragos', 'guisante', 'judÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â­a', 'judia', 'habichuela', 'brÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³coli', 'brocoli'],
        'fruta': ['fruta', 'manzana', 'pera', 'naranja', 'plÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¡tano', 'platano', 'limÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'limon', 'kiwi', 'uva', 'sandÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â­a', 'sandia', 'melÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â³n', 'melon', 'fresa'],
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
            reasons.push(`Formato compatible: ${origEssence.format} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Â¢ ${candEssence.format}`);
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
                JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
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
                JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
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

async function getOrderAnalytics(vendedorCodes) {
    const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
    let vendorFilter = '';
    const vendorParams = [];
    
    if (!isAll) {
        const vendorList = vendedorCodes.split(',').map(v => v.trim()).filter(Boolean);
        if (vendorList.length > 0) {
            const placeholders = vendorList.map(() => '?').join(',');
            vendorFilter = `AND TRIM(CODIGOVENDEDOR) IN (${placeholders})`;
            vendorParams.push(...vendorList);
        }
    }

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
          ${vendorFilter}
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
          ${vendorFilter}
        GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
        ORDER BY totalSales DESC
        FETCH FIRST 10 ROWS ONLY
    `;

    const statusSql = `
        SELECT TRIM(ESTADO) AS status, COUNT(*) AS count
        FROM ${ERP_SCHEMA}.PEDIDOS_CAB
        WHERE EJERCICIO = YEAR(CURRENT_DATE)
          ${vendorFilter}
        GROUP BY ESTADO
    `;

    try {
        const [monthly, topProducts, statusDist] = await Promise.all([
            cachedQuery((s) => queryWithParams(s, vendorParams), sql, cacheKey + ':monthly', TTL.SHORT),
            cachedQuery((s) => queryWithParams(s, vendorParams), topSql, cacheKey + ':top', TTL.SHORT),
            cachedQuery((s) => queryWithParams(s, vendorParams), statusSql, cacheKey + ':status', TTL.SHORT),
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
                acc[(r.status || r.STATUS || '').trim()] = parseInt(r.count || r.COUNT) || 0;
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
            COALESCE(L.LCIMVT / NULLIF(SUM(L.LCCTUD), 0), 0) AS AVG_PRICE
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
                JOIN ${ERP_SCHEMA}.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
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
            matchReasons: ['BÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬ÃƒÂ¢Ã¢€Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã¢€Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢€Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢€â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢€Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢€Å¡Ãƒâ€šÃ‚Âºsqueda manual']
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] searchProductsWithStock error: ${error.message}`);
        return [];
    }
}

module.exports = {
    initPedidosTables,
    getProducts,
    searchProducts,
    getProductDetail,
    getStock,
    getProductStock,
    getClientPricing,
    getDeliveryOptions,
    getAvailableVehicles,
    getPedidosConfirmationTarget,
    createOrder,
    getOrders,
    getOrderDetail,
    addOrderLine,
    updateOrderLine: updateOrderLineRoute,
    deleteOrderLine: deleteOrderLineRoute,
    confirmOrder,
    cancelOrder,
    updateOrderStatus,
    getRecommendations,
    getFamilies,
    getFamiliesDetailed,
    getBrands,
    getProductFamilies,
    getProductBrands,
    getActivePromotions,
    checkDraftAccumulation,
    getClientBalance,
    cloneOrder,
    getComplementaryProducts,
    getOrderAnalytics,
    generateOrderPdf,
    getSimilarProducts,
    searchProductsWithStock,
    calculateLineImporte,
    isOrderTransitionAllowed,
    assertOrderEditable,
    getOrderStats,
    getOrderAlbaran,
    getProductHistory,
    pedidosBreaker,
};
