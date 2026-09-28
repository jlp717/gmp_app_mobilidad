// order-drafts.js — split de order-lifecycle.js: dias de reparto + acumulacion de borradores.
// Codigo movido verbatim; PEDIDOS_CAB_TABLE importada de ./_shared (single-source).
const { queryWithParams } = require('../../config/db');
const logger = require('../../middleware/logger');
const { trimString, truncate, PEDIDOS_CAB_TABLE } = require('./_shared');

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
