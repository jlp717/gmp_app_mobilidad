const express = require('express');
const router = express.Router();
const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const logger = require('../middleware/logger');
const { verifyToken } = require('../middleware/auth');
const { isDeliveryStatusAvailable, isDeliveryStatusNewSchema, getDeliveryStatusJoin } = require('../utils/delivery-status-check');
const { resolveConfirmationTables, resolveFinanceWriteTables } = require('../repositories/repartidor-route-db2-repository');
const dayMoveRepo = require('../repositories/repartidor-rutero-day-move-db2-repository');
const ruteroOrdenRepo = require('../repositories/repartidor-rutero-orden-db2-repository');
const { applySavedOrder, applyDayMovePositions } = require('../services/repartidor-rutero-orden-service');
const {
    resolveDeliveryAmount,
    documentAmountKey,
    sanitizeErpAmount,
} = require('../services/delivery-amount-resolver');
const {
    loadDeliveryLineAmountStats,
    emptyLineStats,
} = require('../services/delivery-line-amount-stats');
const {
    buildCvcAvailabilityQuery,
    documentKey,
    mapCvcAvailabilityRows,
} = require('../services/delivery-cobro-availability');
const REPARTIDOR_ROUTE_ORDER_FETCH_MAX = 500;

/**
 * Strip leading vendor code from VDD names (e.g., "08 DAMIAN" â†’ "DAMIAN")
 */
function stripVendorCode(name) {
    if (!name) return '';
    return name.replace(/^\d+\s+/, '').trim();
}

function normalizeCode(value) {
    return String(value || '').trim();
}

function normalizeNumericCode(value) {
    const raw = normalizeCode(value);
    if (!/^\d+$/.test(raw)) return null;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    return digits.replace(/^0+/, '') || '0';
}

function codesMatch(left, right) {
    const leftCode = normalizeCode(left);
    const rightCode = normalizeCode(right);
    if (leftCode === rightCode) return true;
    const leftNumeric = normalizeNumericCode(leftCode);
    const rightNumeric = normalizeNumericCode(rightCode);
    return leftNumeric !== null && rightNumeric !== null && leftNumeric === rightNumeric;
}

function canonicalRepartidorCode(value) {
    const raw = normalizeCode(value).toUpperCase();
    if (!/^[A-Z0-9]{1,2}$/.test(raw) || raw === 'ALL') return null;
    return /^\d{1,2}$/.test(raw) ? raw.padStart(2, '0') : raw;
}

function parseRepartidorSelector(value, { single = false } = {}) {
    const raw = normalizeCode(value);
    if (!raw || raw.length > 500 || /^ALL$/i.test(raw)) return null;
    const parts = raw.split(',');
    if (single && parts.length !== 1) return null;
    const codes = parts.map(canonicalRepartidorCode);
    if (codes.some((code) => !code) || codes.length > 100) return null;
    return [...new Set(codes)];
}

function actorRepartidorCodes(user) {
    const declaredCodes = Array.isArray(user?.repartidorCodes) ? user.repartidorCodes : (normalizeCode(user?.role).toUpperCase() === 'REPARTIDOR' ? [user?.code] : []);
    return [...new Set((declaredCodes).map(canonicalRepartidorCode).filter(Boolean))];
}

function canAccessRepartidor(req, repartidorId) {
    const user = req.user || {};
    const role = normalizeCode(user.role).toUpperCase();
    const activeMode = normalizeCode(user.activeMode).toUpperCase();
    const repartoActor = role === 'REPARTIDOR'
        || ((role === 'JEFE_VENTAS' || role === 'ADMIN') && activeMode === 'REPARTIDOR');
    if (!repartoActor) return false;
    const target = canonicalRepartidorCode(repartidorId);
    const allowed = actorRepartidorCodes(user);
    if (!target || allowed.length === 0 || !allowed.some((code) => codesMatch(code, target))) return false;
    if (role !== 'REPARTIDOR') return true;
    const own = canonicalRepartidorCode(user.code || user.id || user.user);
    return allowed.length === 1 && codesMatch(own, target) && codesMatch(allowed[0], target);
}

function ensureRepartidorAccess(req, res, repartidorId) {
    if (canAccessRepartidor(req, repartidorId)) return true;
    logger.warn(`[ENTREGAS] Forbidden ${req.user?.code || 'unknown'} -> repartidor ${repartidorId}`);
    res.status(403).json({ success: false, code: 'REPARTIDOR_ACCESS_DENIED', error: 'No tienes permisos para operar sobre este repartidor' });
    return false;
}

function requireConcreteAlbaranOwner(req, res) {
    const role = normalizeCode(req.user?.role).toUpperCase();
    const activeMode = normalizeCode(req.user?.activeMode).toUpperCase();
    if (role !== 'REPARTIDOR' && role !== 'JEFE_VENTAS' && role !== 'ADMIN') {
        res.status(403).json({ success: false, code: 'REPARTIDOR_ACCESS_DENIED', error: 'No tienes permisos para consultar entregas' });
        return { allowed: false, hintedOwner: null };
    }
    if ((role === 'JEFE_VENTAS' || role === 'ADMIN') && activeMode !== 'REPARTIDOR') {
        res.status(403).json({ success: false, code: 'REPARTO_MODE_REQUIRED', error: 'Activa el Perfil Reparto para consultar entregas' });
        return { allowed: false, hintedOwner: null };
    }
    const selected = parseRepartidorSelector(req.query?.repartidorId, { single: true }) || (role === 'REPARTIDOR' ? parseRepartidorSelector(req.user?.code, { single: true }) : null);
    if (!selected) {
        res.status(422).json({ success: false, code: 'REPARTIDOR_ID_REQUIRED', error: 'Selecciona un unico repartidor concreto' });
        return { allowed: false, hintedOwner: null };
    }
    if (!canAccessRepartidor(req, selected[0])) {
        res.status(403).json({ success: false, code: 'REPARTIDOR_ACCESS_DENIED', error: 'No tienes permisos para consultar este repartidor' });
        return { allowed: false, hintedOwner: null };
    }
    return { allowed: true, hintedOwner: selected[0] };
}

function parseDeliveryItemId(itemId) {
    const parts = String(itemId || '').split('-');
    if (parts.length < 4) return null;
    const ejercicio = parseInt(parts[0], 10);
    const serie = parts[1] || '';
    const terminal = parseInt(parts[2], 10);
    const numero = parseInt(parts[3], 10);
    if (!ejercicio || !Number.isFinite(terminal) || !numero) return null;
    return { ejercicio, serie, terminal, numero, cliente: normalizeCode(parts[4]) || null };
}

async function getDeliveryOwner(itemId, clientCode) {
    const parsed = parseDeliveryItemId(itemId);
    if (!parsed) return null;
    const cliente = normalizeCode(clientCode || parsed.cliente);
    const params = [parsed.ejercicio, parsed.serie, parsed.terminal, parsed.numero];
    let clientFilter = '';
    if (cliente) { clientFilter = ' AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?'; params.push(cliente); }
    const rows = await queryWithParams(`
        SELECT TRIM(OPP.CODIGOREPARTIDOR) AS CODIGO_REPARTIDOR
        FROM DSEDAC.CPC CPC
        INNER JOIN DSEDAC.OPP OPP
          ON OPP.SUBEMPRESA = CPC.SUBEMPRESAPEDIDO
         AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
         AND OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
        WHERE CPC.EJERCICIOALBARAN = ?
          AND TRIM(CPC.SERIEALBARAN) = ?
          AND CPC.TERMINALALBARAN = ?
          AND CPC.NUMEROALBARAN = ?
          ${clientFilter}
    `, params, false, false);
    const owners = [...new Set(rows.map((row) => normalizeCode(row.CODIGO_REPARTIDOR)).filter(Boolean))];
    return owners.length === 1 ? owners[0] : null;
}

/**
 * Validate Spanish DNI/NIE format with check letter (mod 23).
 * @param {string} value - DNI/NIE string
 * @returns {boolean} true if format is valid
 */
class RepartoHttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function todayIsoDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isoDocumentDate(row, fallbackIso) {
    const year = Number(row?.ANODOCUMENTO);
    const month = Number(row?.MESDOCUMENTO);
    const day = Number(row?.DIADOCUMENTO);
    const fallback = fallbackIso || todayIsoDate();
    if (!Number.isInteger(year) || year < 1990
        || !Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(day) || day < 1 || day > 31) {
        return fallback;
    }
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
        return fallback;
    }
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIsoCalendarDate(raw) {
    if (raw === undefined) {
        const now = new Date();
        return { date: now.toISOString().slice(0, 10), day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear(), toISOString: () => now.toISOString() };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const [year, month, day] = raw.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
    return { date: raw, day, month, year, toISOString: () => `${raw}T00:00:00.000Z` };
}

function parseBoundedInteger(raw, { defaultValue, min, max }) {
    if (raw === undefined) return defaultValue;
    if (!/^\d+$/.test(String(raw))) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function sendEntregasUnavailable(res, code, message) {
    return res.status(503).json({ success: false, code, error: message });
}
function sendRepartoError(res, error) {
    if (error instanceof RepartoHttpError) return res.status(error.status).json({ success: false, code: error.code, error: error.message });
    return res.status(503).json({ success: false, code: 'CANONICAL_RECEIPT_UNAVAILABLE', error: 'No se pudo generar el recibo canonico' });
}
const moment = require('moment'); // Ensure moment is available

// --- HELPER: Get Gamification Stats (Real DB) ---
async function getGamificationStats(repartidorId) {
    try {
        const currentYear = new Date().getFullYear();

        // Parallelize level + streak queries (independent) with cache
        const [levelResult, streakResult] = await Promise.all([
            cachedQuery(queryWithParams, `
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.CPC
            WHERE TRIM(CODIGOREPARTIDOR) = ?
              AND ANODOCUMENTO = ?
        `, `entregas:gamification:level:${repartidorId}:${currentYear}`, TTL.SHORT, [repartidorId, currentYear]),
            cachedQuery(queryWithParams, `
            SELECT DISTINCT DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO
            FROM DSEDAC.CPC
            WHERE TRIM(CODIGOREPARTIDOR) = ?
              AND CONCAT(ANODOCUMENTO, CONCAT(RIGHT('0' || MESDOCUMENTO, 2), RIGHT('0' || DIADOCUMENTO, 2))) >= ?
        `, `entregas:gamification:streak:${repartidorId}`, TTL.SHORT, [repartidorId, moment().subtract(7, 'days').format('YYYYMMDD')])
        ]);
        const totalDeliveries = levelResult[0]?.TOTAL || 0;
        const streakDays = streakResult.length; // Approximate active days in last week

        let level = 'BRONCE';
        let nextLevel = 'PLATA';
        let progress = 0.0;

        if (totalDeliveries < 100) {
            level = 'BRONCE';
            nextLevel = 'PLATA';
            progress = totalDeliveries / 100;
        } else if (totalDeliveries < 500) {
            level = 'PLATA';
            nextLevel = 'ORO';
            progress = (totalDeliveries - 100) / 400;
        } else if (totalDeliveries < 2000) {
            level = 'ORO';
            nextLevel = 'PLATINO';
            progress = (totalDeliveries - 500) / 1500;
        } else {
            level = 'PLATINO';
            nextLevel = 'DIAMANTE';
            progress = 1.0;
        }

        return { level, nextLevel, progress, streakDays, totalDeliveries };
    } catch (e) {
        logger.error(`Error calculating gamification: ${e.message}`);
        return { level: 'BRONCE', nextLevel: 'PLATA', progress: 0, streakDays: 0, totalDeliveries: 0 };
    }
}

// --- HELPER: Get Heuristic AI Suggestions ---
function getSmartSuggestions(albaranes) {
    const suggestions = [];

    // 1. Cash Alert
    const totalCash = albaranes
        .filter(a => a.esCTR)
        .reduce((sum, a) => sum + (a.importe || 0), 0);

    if (totalCash > 1000) {
        suggestions.push(`âš ï¸ Llevas ${totalCash.toFixed(0)}â‚¬ en efectivo. Considera hacer un ingreso.`);
    } else if (totalCash > 500) {
        suggestions.push(`â„¹ï¸ Acumulas ${totalCash.toFixed(0)}â‚¬ en cobros.`);
    }

    // 2. Urgent Deliveries
    const urgentCount = albaranes.filter(a => a.esCTR).length;
    if (urgentCount > 3) {
        suggestions.push(`ðŸ”¥ Tienes ${urgentCount} clientes con cobro obligatorio prioritario.`);
    }

    // 3. Efficiency (Duplicate clients)
    const clientCounts = {};
    albaranes.forEach(a => {
        clientCounts[a.nombreCliente] = (clientCounts[a.nombreCliente] || 0) + 1;
    });
    const multiDrop = Object.entries(clientCounts).find(([_, count]) => count > 1);
    if (multiDrop) {
        suggestions.push(`ðŸ“¦ ${multiDrop[0]} tiene ${multiDrop[1]} entregas. Â¡AgrÃºpalas!`);
    }

    return suggestions.length > 0 ? suggestions[0] : null; // Return top suggestion
}

// ===================================
// GET /pendientes/:repartidorId
// ===================================
router.get('/pendientes/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { date, limit, offset } = req.query;

        const pageLimit = parseBoundedInteger(limit, { defaultValue: 100, min: 1, max: REPARTIDOR_ROUTE_ORDER_FETCH_MAX });
        const pageOffset = parseBoundedInteger(offset, { defaultValue: 0, min: 0, max: 1000000 });
        const targetDate = parseIsoCalendarDate(date);
        if (pageLimit === null || pageOffset === null) {
            return res.status(400).json({ success: false, code: 'INVALID_PAGINATION', error: 'limit y offset deben ser enteros dentro del rango permitido' });
        }
        if (!targetDate) {
            return res.status(400).json({ success: false, code: 'INVALID_DATE', error: 'date debe ser una fecha de calendario YYYY-MM-DD valida' });
        }

        const dia = targetDate.day;
        const mes = targetDate.month;
        const ano = targetDate.year;

        logger.info(`[ENTREGAS] Getting pending deliveries for repartidor ${repartidorId} (${dia}/${mes}/${ano})`);

        // Handle multiple IDs (comma separated) case
        const idList = parseRepartidorSelector(repartidorId);
        if (!idList || idList.length === 0) {
            return res.status(422).json({ success: false, code: 'REPARTIDOR_ID_INVALID', error: 'Selector de repartidor invalido' });
        }
        const unauthorized = idList.find(id => !canAccessRepartidor(req, id));
        if (unauthorized) {
            return res.status(403).json({
                success: false,
                error: 'No tienes permisos para consultar este repartidor'
            });
        }
        const placeholders = idList.map(() => '?').join(',');
        const sortBy = req.query.sortBy || 'default';
        const routeOrderMode = req.query.routeOrder === 'true' && sortBy === 'default' && idList.length === 1;

        // Load payment conditions from JAVIER.PAYMENT_CONDITIONS table
        let paymentConditions = {};
        try {
            const pcRows = await cachedQuery(query, `
                SELECT CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, COLOR
                FROM JAVIER.PAYMENT_CONDITIONS
                WHERE ACTIVO = 'S'
            `, 'entregas:paymentConditions', TTL.LONG);

            pcRows.forEach(pc => {
                const code = (pc.CODIGO || '').trim();
                paymentConditions[code] = {
                    desc: (pc.DESCRIPCION || '').trim(),
                    type: (pc.TIPO || 'CREDITO').trim(),
                    diasPago: pc.DIAS_PAGO || 0,
                    mustCollect: pc.DEBE_COBRAR === 'S',
                    canCollect: pc.PUEDE_COBRAR === 'S',
                    color: (pc.COLOR || 'green').trim()
                };
            });
            if (Object.keys(paymentConditions).length === 0) throw new Error('empty catalog');
            logger.info('[ENTREGAS] Payment catalog loaded');
        } catch (pcError) {
            logger.error('[ENTREGAS] Payment catalog unavailable');
            return sendEntregasUnavailable(res, 'PAYMENT_CATALOG_UNAVAILABLE', 'El catalogo de formas de pago no esta disponible');
        }


        // CORRECTO: Usar OPP â†’ CPC â†’ CAC para repartidores
        // OPP tiene CODIGOREPARTIDOR, CPC vincula con CAC
        // IMPORTANTE: Usar IMPORTEBRUTO (sin IVA) para cobros
        // FIX: ID format must match exactly with frontend and update endpoint
        // Check if requested date is in the past (all deliveries assumed completed)

        // Conditionally include DELIVERY_STATUS join (table may not exist)
        const dsAvailable = isDeliveryStatusAvailable();
        const dsJoin = dsAvailable ? getDeliveryStatusJoin('CPC', 'DS') : '';
        const dsColumns = dsAvailable
            ? (isDeliveryStatusNewSchema()
                ? `DS.STATUS as DS_STATUS,
                  CAST(NULL AS VARCHAR(512)) as DS_OBS,
                  CAST(NULL AS VARCHAR(255)) as DS_FIRMA`
                : `DS.STATUS as DS_STATUS,
                  DS.OBSERVACIONES as DS_OBS,
                  DS.FIRMA_PATH as DS_FIRMA`)
            : `CAST(NULL AS VARCHAR(20)) as DS_STATUS,
              CAST(NULL AS VARCHAR(512)) as DS_OBS,
              CAST(NULL AS VARCHAR(255)) as DS_FIRMA`;

        const dayMoveTable = dayMoveRepo.tryResolveDayOverrideTable();
        const dayMoveEnabled = Boolean(dayMoveTable);
        const weekStartYmd = dayMoveEnabled ? dayMoveRepo.monday(targetDate.date) : null;
        const weekEndDate = weekStartYmd
            ? new Date(`${weekStartYmd}T12:00:00Z`)
            : null;
        if (weekEndDate) weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
        const weekEndYmd = weekEndDate ? weekEndDate.toISOString().slice(0, 10) : null;
        const dayMoveJoin = dayMoveEnabled ? `
            LEFT JOIN ${dayMoveTable} ROUTE_MOVE
              ON ROUTE_MOVE.REPARTIDOR_ID = TRIM(OPP.CODIGOREPARTIDOR)
             AND ROUTE_MOVE.WEEK_START = ?
             AND TRIM(ROUTE_MOVE.DOCUMENT_ID) =
                 TRIM(VARCHAR(CPC.EJERCICIOALBARAN)) || '-' || TRIM(CPC.SERIEALBARAN) || '-' ||
                 TRIM(VARCHAR(CPC.TERMINALALBARAN)) || '-' || TRIM(VARCHAR(CPC.NUMEROALBARAN)) || '-' ||
                 TRIM(CPC.CODIGOCLIENTEALBARAN)
        ` : '';
        const dayMoveDateWhere = dayMoveEnabled ? `
              AND (
                (ROUTE_MOVE.DOCUMENT_ID IS NOT NULL AND ROUTE_MOVE.TARGET_DATE = ?)
                OR (ROUTE_MOVE.DOCUMENT_ID IS NULL
                    AND OPP.DIAREPARTO = ?
                    AND OPP.MESREPARTO = ?
                    AND OPP.ANOREPARTO = ?)
              )
        ` : `
              AND OPP.DIAREPARTO = ?
              AND OPP.MESREPARTO = ?
              AND OPP.ANOREPARTO = ?
        `;
        const dayMoveWeekRangeWhere = dayMoveEnabled ? `
              AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
        ` : '';
        const sql = `
            WITH ranked_deliveries AS (
              SELECT
              CAC.SUBEMPRESAALBARAN,
              CAC.EJERCICIOALBARAN,
              CAC.SERIEALBARAN,
              CAC.TERMINALALBARAN,
              CAC.NUMEROALBARAN,
              CAC.NUMEROFACTURA,
              CAC.SERIEFACTURA,
              TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
              TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, 'CLIENTE')) as NOMBRE_CLIENTE,
              TRIM(CLI.NOMBREALTERNATIVO) as NOMBRE_COMERCIAL,
              TRIM(CLI.NOMBRECLIENTE) as NOMBRE_FISCAL,
              TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCION,
              TRIM(COALESCE(CLI.POBLACION, '')) as POBLACION,
              TRIM(COALESCE(CLI.TELEFONO1, '')) as TELEFONO,
              TRIM(COALESCE(CLI.TELEFONO2, '')) as TELEFONO2,
              CPC.IMPORTETOTAL,
              CAC.IMPORTETOTAL AS CAC_IMPORTETOTAL,
              CPC.IMPORTEBRUTO,
              CPC.IMPORTEBASEIMPONIBLE1 as CPC_BASE1,
              CPC.IMPORTEBASEIMPONIBLE2 as CPC_BASE2,
              CPC.IMPORTEBASEIMPONIBLE3 as CPC_BASE3,
              CPC.PORCENTAJEIVA1 as CPC_PCTIVA1,
              CPC.PORCENTAJEIVA2 as CPC_PCTIVA2,
              CPC.PORCENTAJEIVA3 as CPC_PCTIVA3,
              CPC.IMPORTEIVA1 as CPC_IVA1,
              CPC.IMPORTEIVA2 as CPC_IVA2,
              CPC.IMPORTEIVA3 as CPC_IVA3,
              TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
              CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
              TRIM(CPC.CODIGORUTA) as RUTA,
              TRIM(OPP.CODIGOREPARTIDOR) as CODIGO_REPARTIDOR,
              ${dayMoveEnabled ? 'ROUTE_MOVE.TARGET_POSITION AS ROUTE_MOVE_POSITION,' : 'CAST(NULL AS INTEGER) AS ROUTE_MOVE_POSITION,'}
              OPP.NUMEROORDENPREPARACION as ORDEN_PREPARACION,
              COALESCE(TRIM(VDD.NOMBREVENDEDOR), TRIM(OPP.CODIGOREPARTIDOR)) as NOMBRE_REPARTIDOR,
              CPC.DIALLEGADA, CPC.HORALLEGADA,
              TRIM(CPC.CONFORMADOSN) as CONFORMADO,
              ${dsColumns},
              ROW_NUMBER() OVER (
                PARTITION BY CAC.SUBEMPRESAALBARAN, CAC.EJERCICIOALBARAN,
                  CAC.SERIEALBARAN, CAC.TERMINALALBARAN,
                  CAC.NUMEROALBARAN, TRIM(CPC.CODIGOCLIENTEALBARAN)
                ORDER BY OPP.SUBEMPRESA, OPP.EJERCICIOORDENPREPARACION,
                  OPP.NUMEROORDENPREPARACION
              ) AS DELIVERY_RANK
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC
              ON CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
              AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
              AND CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC
              ON CAC.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
              AND CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
              AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
              AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
              AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
              AND TRIM(CAC.CODIGOCLIENTEALBARAN) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            ${dayMoveJoin}
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            ${dsJoin}
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${placeholders})
              ${dayMoveWeekRangeWhere}
              ${dayMoveDateWhere}
            )
            SELECT * FROM ranked_deliveries
            WHERE DELIVERY_RANK = 1
            ORDER BY EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN, CLIENTE
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
        `;

        // Table initialization removed to prevent AS400 errors.
        // Tables JAVIER.DELIVERY_STATUS and JAVIER.CLIENT_SIGNERS are assumed to exist.

        let rows = [];
        try {
            const queryParams = dayMoveEnabled ? [
                weekStartYmd,
                ...idList,
                Number(weekStartYmd.replace(/-/g, '')),
                Number(weekEndYmd.replace(/-/g, '')),
                targetDate.date,
                dia,
                mes,
                ano,
                routeOrderMode ? 0 : pageOffset,
                routeOrderMode ? REPARTIDOR_ROUTE_ORDER_FETCH_MAX + 1 : pageLimit + 1,
            ] : [
                ...idList, dia, mes, ano,
                routeOrderMode ? 0 : pageOffset,
                routeOrderMode ? REPARTIDOR_ROUTE_ORDER_FETCH_MAX + 1 : pageLimit + 1,
            ];
            // Cache only the owner/date/page-scoped ERP source. Canonical
            // confirmation and cobro overlays are applied below on every
            // request, so a fresh payment/confirmation is never hidden.
            const routeCacheKey = [
                'repartidor:rutero-pending:v2',
                idList.slice().sort().join(','),
                targetDate.date,
                pageLimit,
                pageOffset,
                routeOrderMode ? 'ordered' : 'paged',
                sortBy,
                dayMoveEnabled ? 'moves' : 'base',
            ].join(':');
            rows = await cachedQuery(
                queryWithParams,
                sql,
                routeCacheKey,
                TTL.REALTIME,
                queryParams,
            ) || [];
        } catch (queryError) {
            logger.error('[ENTREGAS] Pending-delivery query unavailable');
            return sendEntregasUnavailable(res, 'PENDING_DELIVERIES_UNAVAILABLE', 'No se pudo consultar el listado de entregas');
        }

        const sourceHasMore = routeOrderMode
            ? rows.length > REPARTIDOR_ROUTE_ORDER_FETCH_MAX
            : rows.length > pageLimit;
        if (routeOrderMode && sourceHasMore && pageOffset >= REPARTIDOR_ROUTE_ORDER_FETCH_MAX) {
            return sendEntregasUnavailable(res, 'ROUTE_TOO_LARGE', 'La ruta supera el límite de 500 paradas');
        }
        rows = rows.slice(0, routeOrderMode ? REPARTIDOR_ROUTE_ORDER_FETCH_MAX : pageLimit);
        // Defensive deduplication. SQL already paginates DELIVERY_RANK = 1 rows.
        // Group by Albaran ID + Client and SUM financial fields
        const aggregatedMap = new Map();
        rows.forEach(row => {
            const serie = (row.SERIEALBARAN || '').trim();
            const cliente = (row.CLIENTE || '').trim();
            const id = `${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}-${cliente}`;

            if (!aggregatedMap.has(id)) {
                // Initialize with a copy to avoid mutating original row
                aggregatedMap.set(id, { ...row });
            } else {
                const existing = aggregatedMap.get(id);
                // Sum financial fields
                existing.IMPORTETOTAL = (parseFloat(existing.IMPORTETOTAL) || 0) + (parseFloat(row.IMPORTETOTAL) || 0);
                existing.CAC_IMPORTETOTAL = (parseFloat(existing.CAC_IMPORTETOTAL) || 0)
                    + (parseFloat(row.CAC_IMPORTETOTAL) || 0);
                existing.IMPORTEBRUTO = (parseFloat(existing.IMPORTEBRUTO) || 0) + (parseFloat(row.IMPORTEBRUTO) || 0);
                existing.CPC_BASE1 = (parseFloat(existing.CPC_BASE1) || 0) + (parseFloat(row.CPC_BASE1) || 0);
                existing.CPC_BASE2 = (parseFloat(existing.CPC_BASE2) || 0) + (parseFloat(row.CPC_BASE2) || 0);
                existing.CPC_BASE3 = (parseFloat(existing.CPC_BASE3) || 0) + (parseFloat(row.CPC_BASE3) || 0);
                existing.CPC_IVA1 = (parseFloat(existing.CPC_IVA1) || 0) + (parseFloat(row.CPC_IVA1) || 0);
                existing.CPC_IVA2 = (parseFloat(existing.CPC_IVA2) || 0) + (parseFloat(row.CPC_IVA2) || 0);
                existing.CPC_IVA3 = (parseFloat(existing.CPC_IVA3) || 0) + (parseFloat(row.CPC_IVA3) || 0);
                // Keep the latest status/info if they differ? 
                // Usually status is the same per Albaran ID.
            }
        });
        const uniqueRows = Array.from(aggregatedMap.values());

        const clientCodes = Array.from(new Set(
            uniqueRows
                .map(row => (row.CLIENTE || '').trim())
                .filter(Boolean)
        ));
        const geoByClient = new Map();
        if (clientCodes.length > 0) {
            try {
                const geoRows = await ruteroOrdenRepo.fetchClientGeo(clientCodes);
                for (const [clientCode, geo] of geoRows.entries()) {
                    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
                        geoByClient.set(clientCode, geo);
                    }
                }
            } catch (geoError) {
                logger.warn(`[ENTREGAS] Could not load route GPS: ${geoError?.message || geoError}`);
            }
        }
        const parseMoney = (val) => {
            if (val === null || val === undefined) return 0;
            if (typeof val === 'number') return val;

            const str = val.toString();
            if (str.includes(',') && str.includes('.')) {
                if (str.indexOf('.') < str.indexOf(',')) {
                    return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
                }
            }
            if (str.includes(',') && !str.includes('.')) {
                return parseFloat(str.replace(',', '.')) || 0;
            }
            return parseFloat(str) || 0;
        };

        const cobroRigurosoClientes = new Set();
        const creditLimitByClient = new Map();
        const pendingDebtByClient = new Map();
        let cvcAvailabilityByKey = new Map();
        if (clientCodes.length > 0) {
            const clxPlaceholders = clientCodes.map(() => '?').join(',');
            const clpPlaceholders = clientCodes.map(() => '?').join(',');
            const cvcPlaceholders = clientCodes.map(() => '?').join(',');
            const clientOverlayKey = clientCodes.slice().sort().join(',');
            const cachedOverlayQuery = (sql, cacheKey, params = clientCodes) => cachedQuery(
                (querySql, queryParams) => queryWithParams(querySql, queryParams, false, false),
                sql,
                cacheKey,
                15,
                params,
            );
            const cvcDocumentPlan = buildCvcAvailabilityQuery(uniqueRows);
            const cvcDocumentCacheKey = cvcDocumentPlan
                ? cvcDocumentPlan.documents.map(documentKey).sort().join(',')
                : 'empty';

            const [clxRows, clpRows, cvcRows, cvcDocumentRows] = await Promise.allSettled([
                cachedOverlayQuery(`
                    SELECT TRIM(CODIGOCLIENTE) as CLIENTE
                    FROM DSEDAC.CLX
                    WHERE TRIM(CODIGOCLIENTE) IN (${clxPlaceholders})
                      AND TRIM(COALESCE(COBRORIGUROSOSN, '')) = 'S'
                `, `entregas:rutero:client-risk:clx:${clientOverlayKey}`),
                cachedOverlayQuery(`
                    SELECT
                      TRIM(CODIGOCLIENTE) as CLIENTE,
                      IMPORTELIMITERIESGO,
                      IMPORTELIMITERIESGOEMPRESA
                    FROM DSEDAC.CLP
                    WHERE TRIM(CODIGOCLIENTE) IN (${clpPlaceholders})
                `, `entregas:rutero:client-risk:clp:${clientOverlayKey}`),
                cachedOverlayQuery(`
                    SELECT
                      TRIM(CODIGOCLIENTEALBARAN) as CLIENTE,
                      COALESCE(SUM(IMPORTEPENDIENTE), 0) as PENDIENTE
                    FROM DSEDAC.CVC
                    WHERE TRIM(CODIGOCLIENTEALBARAN) IN (${cvcPlaceholders})
                      AND COALESCE(ANULADOSN, '') <> 'S'
                      AND IMPORTEPENDIENTE <> 0
                    GROUP BY TRIM(CODIGOCLIENTEALBARAN)
                `, `entregas:rutero:client-risk:cvc:${clientOverlayKey}`),
                cvcDocumentPlan
                    ? cachedOverlayQuery(
                        cvcDocumentPlan.sql,
                        `entregas:rutero:document-cobro:${cvcDocumentCacheKey}`,
                        cvcDocumentPlan.params,
                    )
                    : Promise.resolve([]),
            ]);
            if ([clxRows, clpRows, cvcRows, cvcDocumentRows].some((result) => result.status === 'rejected')) {
                logger.error('[ENTREGAS] Client financial batch unavailable');
                return sendEntregasUnavailable(res, 'PENDING_DELIVERIES_UNAVAILABLE', 'No se pudo completar el listado de entregas');
            }


            (clxRows.status === 'fulfilled' ? (clxRows.value || []) : []).forEach(row => {
                const cliente = (row.CLIENTE || '').trim();
                if (cliente) cobroRigurosoClientes.add(cliente);
            });
            if (clxRows.status === 'rejected') {
                logger.warn(`[ENTREGAS] Could not load CLX.COBRORIGUROSOSN: ${clxRows.reason?.message || clxRows.reason}`);
            }

            (clpRows.status === 'fulfilled' ? (clpRows.value || []) : []).forEach(row => {
                const cliente = (row.CLIENTE || '').trim();
                const limit = parseMoney(row.IMPORTELIMITERIESGO) ||
                    parseMoney(row.IMPORTELIMITERIESGOEMPRESA);
                if (cliente && limit > 0) creditLimitByClient.set(cliente, limit);
            });
            if (clpRows.status === 'rejected') {
                logger.warn(`[ENTREGAS] Could not load CLP credit limits: ${clpRows.reason?.message || clpRows.reason}`);
            }

            (cvcRows.status === 'fulfilled' ? (cvcRows.value || []) : []).forEach(row => {
                const cliente = (row.CLIENTE || '').trim();
                if (cliente) pendingDebtByClient.set(cliente, parseMoney(row.PENDIENTE));
            });
            if (cvcRows.status === 'rejected') {
                logger.warn(`[ENTREGAS] Could not load CVC pending debt for credit-limit check: ${cvcRows.reason?.message || cvcRows.reason}`);
            }
            cvcAvailabilityByKey = mapCvcAvailabilityRows(
                cvcDocumentRows.status === 'fulfilled' ? (cvcDocumentRows.value || []) : [],
                cvcDocumentPlan?.documents || [],
            );
        }

        // LAC is only needed while all header/tax sources are still zero.
        // Normal priced deliveries are fully resolved by CPC/CAC and must not
        // trigger one expensive LAC scan per document on manager routes.
        const lineStatsDocuments = uniqueRows.filter((row) => {
            const cpcNetoSum = [row.CPC_BASE1, row.CPC_BASE2, row.CPC_BASE3]
                .reduce((sum, value) => sum + sanitizeErpAmount(value), 0);
            const cpcIvaSum = [row.CPC_IVA1, row.CPC_IVA2, row.CPC_IVA3]
                .reduce((sum, value) => sum + sanitizeErpAmount(value), 0);
            const headerProjection = resolveDeliveryAmount({
                cpcTotal: row.IMPORTETOTAL,
                cacTotal: row.CAC_IMPORTETOTAL,
                cpcNetoSum,
                cpcIvaSum,
            });
            return headerProjection.pricingState !== 'READY';
        });
        let lineStatsByKey = new Map();
        try {
            lineStatsByKey = await loadDeliveryLineAmountStats(
                lineStatsDocuments.map((row) => ({
                    ejercicio: row.EJERCICIOALBARAN,
                    serie: row.SERIEALBARAN,
                    terminal: row.TERMINALALBARAN,
                    numero: row.NUMEROALBARAN,
                    cliente: row.CLIENTE,
                })),
                (sql, params) => queryWithParams(sql, params, false, false),
            );
        } catch (lineStatsError) {
            logger.warn(`[ENTREGAS] Could not load LAC line amount stats: ${lineStatsError.message || lineStatsError}`);
        }
        // Process rows
        const projectedAlbaranes = uniqueRows.map(row => {
            const serie = (row.SERIEALBARAN || '').trim();
            const cliente = (row.CLIENTE || '').trim();
            const base1 = parseMoney(row.CPC_BASE1);
            const base2 = parseMoney(row.CPC_BASE2);
            const base3 = parseMoney(row.CPC_BASE3);
            const pctIva1 = parseMoney(row.CPC_PCTIVA1);
            const pctIva2 = parseMoney(row.CPC_PCTIVA2);
            const pctIva3 = parseMoney(row.CPC_PCTIVA3);
            const iva1 = parseMoney(row.CPC_IVA1);
            const iva2 = parseMoney(row.CPC_IVA2);
            const iva3 = parseMoney(row.CPC_IVA3);
            const netoSum = Math.round((base1 + base2 + base3) * 100) / 100;
            const ivaSum = Math.round((iva1 + iva2 + iva3) * 100) / 100;
            const lineStats = lineStatsByKey.get(documentAmountKey({
                ejercicio: row.EJERCICIOALBARAN,
                serie,
                terminal: row.TERMINALALBARAN,
                numero: row.NUMEROALBARAN,
                cliente,
            })) || emptyLineStats();
            const resolvedAmount = resolveDeliveryAmount({
                cpcTotal: parseMoney(row.IMPORTETOTAL),
                cacTotal: parseMoney(row.CAC_IMPORTETOTAL),
                cpcNetoSum: netoSum,
                cpcIvaSum: ivaSum,
                lacLineSum: lineStats.lineSum,
                qtyLines: lineStats.qtyLines,
                zeroPriceQtyLines: lineStats.zeroPriceQtyLines,
            });
            const importeAlbaran = resolvedAmount.amount;
            const limiteCredito = creditLimitByClient.get(cliente) || 0;
            const riesgoActual = pendingDebtByClient.get(cliente) || 0;
            const creditoSuperaLimite =
                limiteCredito > 0 && (riesgoActual + importeAlbaran) > limiteCredito;
            const cobroRiguroso =
                cobroRigurosoClientes.has(cliente) || creditoSuperaLimite;
            const fp = (row.FORMA_PAGO || '').toUpperCase().trim();

            // Try robust matching
            const numericPaymentCode = /^\d+$/.test(fp) ? String(Number(fp)) : '';
            const paymentInfo = paymentConditions[fp] || paymentConditions[numericPaymentCode] || (() => { throw new RepartoHttpError(503, 'PAYMENT_CONDITION_UNKNOWN', 'La forma de pago del albaran no figura en el catalogo autorizado'); })();

            // The payment catalog determines whether collection is mandatory,
            // but the actual collectability comes from the unique active CVC
            // installment for this exact document identity. This prevents the
            // UI from offering a payment that the confirmation transaction will
            // necessarily reject as missing or ambiguous.
            const cvcAvailability = cvcAvailabilityByKey.get(documentKey({
                SUBEMPRESAALBARAN: row.SUBEMPRESAALBARAN,
                EJERCICIOALBARAN: row.EJERCICIOALBARAN,
                SERIEALBARAN: serie,
                TERMINALALBARAN: row.TERMINALALBARAN,
                NUMEROALBARAN: row.NUMEROALBARAN,
                CLIENTE: cliente,
            })) || { state: 'MISSING', importeDisponibleCobro: 0 };
            const importeDisponibleCobro = cvcAvailability.state === 'AVAILABLE'
                ? cvcAvailability.importeDisponibleCobro
                : 0;
            const esCTR = paymentInfo.mustCollect || cobroRiguroso;
            const puedeCobrarse = importeDisponibleCobro > 0.004;

            const numeroFactura = row.NUMEROFACTURA || 0;
            const serieFactura = (row.SERIEFACTURA || '').trim();
            const esFactura = numeroFactura > 0;

            // --- DELIVERY STATUS LOGIC (HYBRID SENIOR STATUS v2) ---
            // Priority: 1) DELIVERY_STATUS (App confirmation - Real Time)
            //           2) Legacy CONFORMADOSN == 'S' (Paper confirmation processed)
            //           3) Today + DIALLEGADA (Legacy "On Route" - Loaded but not confirmed)
            //           4) Default (Pending)

            let status = (row.DS_STATUS || '').trim();
            const legacyConfirmed = (row.CONFORMADOSN || '').trim() === 'S';

            if (!status || status === '') {
                if (legacyConfirmed) {
                    status = 'ENTREGADO'; // Legacy Confirmed
                } else if (row.DIALLEGADA > 0) {
                    status = 'EN_RUTA';   // Today + Planned + Not Confirmed = On Route
                } else {
                    status = 'PENDIENTE';
                }
            }

            // --- COLOR LOGIC ---
            let colorEstado = 'green';
            if (status === 'ENTREGADO') {
                colorEstado = 'green';
            } else {
                if (esFactura) {
                    colorEstado = 'purple';
                } else if (esCTR || puedeCobrarse) {
                    colorEstado = 'red';
                } else {
                    colorEstado = 'green';
                }
            }

            const importeTotal = importeAlbaran;
            const importeBruto = parseMoney(row.IMPORTEBRUTO);

            // Build IVA breakdown array (only non-zero bases)
            const ivaBreakdown = [];
            if (base1 > 0) ivaBreakdown.push({ base: base1, pct: pctIva1, iva: iva1 });
            if (base2 > 0) ivaBreakdown.push({ base: base2, pct: pctIva2, iva: iva2 });
            if (base3 > 0) ivaBreakdown.push({ base: base3, pct: pctIva3, iva: iva3 });

            return {
                id: `${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}-${cliente}`,
                subempresa: row.SUBEMPRESAALBARAN,
                ejercicio: row.EJERCICIOALBARAN,
                serie: serie,
                terminal: row.TERMINALALBARAN,
                numero: row.NUMEROALBARAN,
                numeroFactura: numeroFactura,
                serieFactura: serieFactura,
                documentoTipo: esFactura ? 'FACTURA' : 'ALBARAN',
                codigoCliente: cliente,
                nombreCliente: (row.NOMBRE_CLIENTE || '').trim() || cliente || 'CLIENTE',
                nombreComercial: (row.NOMBRE_COMERCIAL || '').trim() || row.NOMBRE_CLIENTE?.trim(),
                nombreFiscal: (row.NOMBRE_FISCAL || '').trim() || '',
                direccion: row.DIRECCION?.trim(),
                poblacion: row.POBLACION?.trim(),
                telefono: row.TELEFONO?.trim(),
                telefono2: row.TELEFONO2?.trim() || '',
                importe: importeTotal,
                importeBruto: importeBruto,
                netoSum: netoSum,
                ivaSum: ivaSum,
                ivaBreakdown: ivaBreakdown,
                checksum: `${Math.round((netoSum + ivaSum) * 100) / 100}`,
                lineSum: resolvedAmount.lineSum,
                amountSource: resolvedAmount.source,
                pricingState: resolvedAmount.pricingState,
                discrepancy: resolvedAmount.discrepancy,
                formaPago: fp,
                formaPagoDesc: paymentInfo.desc,
                tipoPago: paymentInfo.type,
                diasPago: paymentInfo.diasPago,
                esCTR: esCTR,
                puedeCobrarse: puedeCobrarse,
                importeDisponibleCobro,
                cobroDocumentoEstado: cvcAvailability.state,
                cobroRiguroso: cobroRiguroso,
                creditoSuperaLimite: creditoSuperaLimite,
                limiteCredito: limiteCredito,
                riesgoCreditoActual: riesgoActual,
                colorEstado: colorEstado,
                fecha: isoDocumentDate(row, targetDate.date),
                ruta: row.RUTA?.trim(),
                codigoRepartidor: row.CODIGO_REPARTIDOR?.trim() || '',
                nombreRepartidor: stripVendorCode(row.NOMBRE_REPARTIDOR) || row.CODIGO_REPARTIDOR?.trim() || '',
                ordenPreparacion: row.ORDEN_PREPARACION || null,
                routeMovePosition: Number.isInteger(Number(row.ROUTE_MOVE_POSITION)) ? Number(row.ROUTE_MOVE_POSITION) : null,
                estado: status,
                observaciones: row.DS_OBS,
                firma: row.DS_FIRMA
            };
        });
        const albaranes = await overlayCanonicalConfirmationStatuses(projectedAlbaranes, idList);

        // --- FILTERING: Search by client name, code, albarÃ¡n or factura number ---
        const searchQuery = req.query.search?.toLowerCase().trim() || '';
        let filteredAlbaranes = albaranes;
        if (searchQuery) {
            filteredAlbaranes = albaranes.filter(a =>
                a.nombreCliente?.toLowerCase().includes(searchQuery) ||
                a.codigoCliente?.toLowerCase().includes(searchQuery) ||
                String(a.numero).includes(searchQuery) ||
                String(a.numeroFactura).includes(searchQuery)
            );
        }

        // --- SPECIFIC FILTERS (Split Search) ---
        const searchClient = req.query.searchClient?.toLowerCase().trim() || '';
        if (searchClient) {
            filteredAlbaranes = filteredAlbaranes.filter(a =>
                a.nombreCliente?.toLowerCase().includes(searchClient) ||
                a.codigoCliente?.toLowerCase().includes(searchClient)
            );
        }

        const searchAlbaran = req.query.searchAlbaran?.trim() || '';
        if (searchAlbaran) {
            filteredAlbaranes = filteredAlbaranes.filter(a =>
                String(a.numero).includes(searchAlbaran) ||
                String(a.numeroFactura).includes(searchAlbaran)
            );
        }

        // --- FILTER BY PAYMENT TYPE ---
        const filterTipo = req.query.tipoPago || ''; // e.g., 'CONTADO', 'CREDITO', 'DOMICILIADO'
        if (filterTipo) {
            filteredAlbaranes = filteredAlbaranes.filter(a =>
                a.tipoPago?.toUpperCase() === filterTipo.toUpperCase()
            );
        }

        // --- FILTER BY COLLECTION STATUS ---
        const filterCobrar = req.query.debeCobrar; // 'S' or 'N'
        if (filterCobrar === 'S') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.esCTR === true);
        } else if (filterCobrar === 'N') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.esCTR === false);
        }

        // --- FILTER BY DOCUMENT TYPE (ALBARAN/FACTURA) ---
        const filterDocTipo = req.query.docTipo; // 'ALBARAN' or 'FACTURA'
        if (filterDocTipo === 'ALBARAN') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.documentoTipo === 'ALBARAN');
        } else if (filterDocTipo === 'FACTURA') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.documentoTipo === 'FACTURA');
        }

        // --- SORTING ---
        if (sortBy === 'importe_desc') {
            filteredAlbaranes.sort((a, b) => b.importe - a.importe);
        } else if (sortBy === 'importe_asc') {
            filteredAlbaranes.sort((a, b) => a.importe - b.importe);
        } else if ((sortBy === 'default' || !req.query.sortBy) && idList.length === 1) {
            try {
                const fechaYmd = `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
                const savedOrden = await ruteroOrdenRepo.listOrder(idList[0], fechaYmd);
                filteredAlbaranes = applySavedOrder(filteredAlbaranes, savedOrden);
            } catch (ordenError) {
                logger.warn(`[ENTREGAS] Saved rutero order unavailable: ${ordenError?.message || ordenError}`);
            }
        }

        if (dayMoveEnabled) {
            filteredAlbaranes = applyDayMovePositions(
                filteredAlbaranes,
                filteredAlbaranes
                    .map((item) => ({
                        documentId: item.id,
                        targetPosition: item.routeMovePosition,
                    }))
                    .filter((item) => Number.isInteger(item.targetPosition)),
            );
        }
        const hasPostQueryFilter = Boolean(
            searchQuery
            || searchClient
            || searchAlbaran
            || filterTipo
            || filterCobrar
            || filterDocTipo,
        );
        const hasMore = routeOrderMode
            ? sourceHasMore || pageOffset + pageLimit < filteredAlbaranes.length
            : sourceHasMore;
        const paginatedAlbaranes = routeOrderMode
            ? filteredAlbaranes.slice(pageOffset, pageOffset + pageLimit)
            : filteredAlbaranes;
        // Summaries describe this response page so the Flutter provider can
        // add them safely while it loads the remaining route pages.
        const summaryAlbaranes = routeOrderMode ? paginatedAlbaranes : albaranes;
        const totalBruto = summaryAlbaranes.reduce((sum, a) => sum + (a.importe || 0), 0);
        const totalACobrar = summaryAlbaranes.filter(a => a.esCTR).reduce((sum, a) => sum + (a.importeDisponibleCobro || 0), 0);
        const totalOpcional = summaryAlbaranes.filter(a => a.puedeCobrarse && !a.esCTR).reduce((sum, a) => sum + (a.importeDisponibleCobro || 0), 0);
        const completedCount = summaryAlbaranes.filter(a => a.estado === 'ENTREGADO').length;
        // The cursor represents rows consumed from the source page, not only
        // rows that survive post-query filters. Otherwise an empty filtered
        // page repeats forever while sourceHasMore remains true.
        const nextOffset = hasMore
            ? pageOffset + pageLimit
            : pageOffset + paginatedAlbaranes.length;
        const totalIsExact = !hasMore && (routeOrderMode || !hasPostQueryFilter);
        const exactTotal = totalIsExact
            ? (routeOrderMode ? filteredAlbaranes.length : nextOffset)
            : null;
        const pagination = {
            limit: pageLimit,
            offset: pageOffset,
            hasMore,
            nextOffset,
            total: exactTotal,
            totalIsExact
        };
        const totalUnfiltered = albaranes.length;

        logger.info(`[ENTREGAS] Date=${targetDate.toISOString().split('T')[0]} Repartidor=${repartidorId} â†’ albaranes=${paginatedAlbaranes.length} (offset=${pageOffset}, limit=${pageLimit}), totalBruto=${totalBruto.toFixed(2)}, totalACobrar=${totalACobrar.toFixed(2)}, totalOpcional=${totalOpcional.toFixed(2)}, completed=${completedCount}`);

        res.json({
            success: true,
            albaranes: paginatedAlbaranes,
            total: exactTotal,
            originalTotal: totalUnfiltered,
            limit: pageLimit,
            offset: pageOffset,
            hasMore,
            nextOffset,
            totalIsExact,
            pagination,
            resumen: {
                totalBruto: Math.round(totalBruto * 100) / 100,
                totalACobrar: Math.round(totalACobrar * 100) / 100,
                totalOpcional: Math.round(totalOpcional * 100) / 100,
                completedCount
            }
        });
    } catch (error) {
        if (error instanceof RepartoHttpError) {
            return res.status(error.status).json({ success: false, code: error.code, error: error.message });
        }
        logger.error('[ENTREGAS] Pending-delivery processing unavailable');
        return sendEntregasUnavailable(res, 'PENDING_DELIVERIES_UNAVAILABLE', 'No se pudo procesar el listado de entregas');
    }
});

// ===================================
// GET /payment-conditions - List available payment conditions
// ===================================
router.get('/payment-conditions', verifyToken, async (req, res) => {
    try {
        const conditions = await query(`
            SELECT CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, COLOR
            FROM JAVIER.PAYMENT_CONDITIONS
            WHERE ACTIVO = 'S'
            ORDER BY TIPO, CODIGO
        `, false);

        res.json({
            success: true,
            conditions: conditions.map(c => ({
                codigo: (c.CODIGO || '').trim(),
                descripcion: (c.DESCRIPCION || '').trim(),
                tipo: (c.TIPO || '').trim(),
                diasPago: c.DIAS_PAGO || 0,
                debeCobrar: c.DEBE_COBRAR === 'S',
                puedeCobrar: c.PUEDE_COBRAR === 'S',
                color: (c.COLOR || 'green').trim()
            }))
        });
    } catch (_error) {
        logger.error('[ENTREGAS] Payment conditions unavailable');
        return sendEntregasUnavailable(res, 'PAYMENT_CATALOG_UNAVAILABLE', 'El catalogo de formas de pago no esta disponible');
    }
});

// ===================================
// GET /albaran/:numero/:ejercicio
// ===================================
function confirmationTables() {
    return resolveConfirmationTables() || {
        confirmations: 'JAVIER.TEST_REPARTO_CONFIRMACIONES',
        lines: 'JAVIER.TEST_REPARTO_LINEAS',
    };
}

function financeCobrosTable() {
    const finance = resolveFinanceWriteTables();
    const cobros = finance?.cobros;
    if (cobros === 'JAVIER.TEST_REPARTIDOR_COBROS'
        || cobros === 'JAVIER.REPARTIDOR_COBROS') {
        return cobros;
    }
    return null;
}

function paymentMethodLabel(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (['EF', 'EFECTIVO', 'CONTADO', 'F0'].includes(normalized)) return 'EFECTIVO';
    if (['TJ', 'TARJETA', 'TPV'].includes(normalized)) return 'TARJETA';
    if (['BI', 'BIZUM'].includes(normalized)) return 'BIZUM';
    if (['TR', 'TRANSFERENCIA', 'TRANSFER', 'T0'].includes(normalized)) return 'TRANSFERENCIA';
    if (['CH', 'CHEQUE', 'TALON'].includes(normalized)) return 'CHEQUE';
    return normalized || null;
}

const CANONICAL_LIST_STATUSES = Object.freeze(['ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO']);

async function overlayCanonicalConfirmationStatuses(albaranes, repartidorIds) {
    if (!Array.isArray(albaranes) || !albaranes.length) return albaranes;
    const documentIds = [...new Set(albaranes.map((item) => String(item.id || '').trim()).filter(Boolean))];
    const drivers = [...new Set((repartidorIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!documentIds.length || !drivers.length) return albaranes;
    const tables = confirmationTables();
    if (!tables?.confirmations) return albaranes;
    const cobrosTable = financeCobrosTable();
    try {
        const documentPlaceholders = documentIds.map(() => '?').join(', ');
        const driverPlaceholders = drivers.map(() => '?').join(', ');
        const paymentSelect = cobrosTable
            ? `,
              C.ID AS CONFIRMATION_ID,
              CO.ID AS COBRO_ID,
              CO.IMPORTEVENCIMIENTO AS IMPORTE_COBRADO,
              CO.IMPORTEPENDIENTE AS IMPORTE_PENDIENTE_COBRO,
              TRIM(CO.CODIGOFORMAPAGO) AS FORMA_PAGO_COBRO`
            : `,
              C.ID AS CONFIRMATION_ID,
              CAST(NULL AS INTEGER) AS COBRO_ID,
              CAST(NULL AS DECIMAL(15, 2)) AS IMPORTE_COBRADO,
              CAST(NULL AS DECIMAL(15, 2)) AS IMPORTE_PENDIENTE_COBRO,
              CAST(NULL AS VARCHAR(10)) AS FORMA_PAGO_COBRO`;
        const paymentJoin = cobrosTable
            ? ` LEFT JOIN ${cobrosTable} CO
                 ON TRIM(CO.IDEMPOTENCY_TOKEN) = TRIM(C.IDEMPOTENCY_KEY)`
            : '';
        const overlayCacheKey = 'repartidor:rutero:confirmations:'
            + documentIds.slice().sort().join(',')
            + ':' + drivers.slice().sort().join(',');
        const rows = await cachedQuery(
            (sql, params) => queryWithParams(sql, params, false, false),
            `SELECT TRIM(C.DOCUMENT_ID) AS DOCUMENT_ID,
                    TRIM(C.STATUS) AS STATUS
                    ${paymentSelect}
               FROM ${tables.confirmations} C
               ${paymentJoin}
              WHERE TRIM(C.DOCUMENT_ID) IN (${documentPlaceholders})
                AND TRIM(C.REPARTIDOR_ID) IN (${driverPlaceholders})`,
            overlayCacheKey,
            5,
            [...documentIds, ...drivers],
        );
        const byId = new Map();
        for (const row of Array.isArray(rows) ? rows : []) {
            const id = String(row.DOCUMENT_ID || row.document_id || '').trim();
            const status = String(row.STATUS || row.status || '').trim().toUpperCase();
            if (!id || !CANONICAL_LIST_STATUSES.includes(status)) continue;
            const importeCobrado = Number(row.IMPORTE_COBRADO ?? row.importe_cobrado);
            const importePendienteCobro = Number(
                row.IMPORTE_PENDIENTE_COBRO ?? row.importe_pendiente_cobro,
            );
            const hasCobro = Number.isFinite(importeCobrado) && importeCobrado > 0.004;
            byId.set(id, {
                status,
                confirmationId: row.CONFIRMATION_ID == null && row.confirmation_id == null
                    ? null
                    : String(row.CONFIRMATION_ID ?? row.confirmation_id),
                cobroId: row.COBRO_ID == null && row.cobro_id == null
                    ? null
                    : String(row.COBRO_ID ?? row.cobro_id),
                cobrado: hasCobro,
                importeCobrado: hasCobro ? Math.round(importeCobrado * 100) / 100 : null,
                importePendienteCobro: hasCobro && Number.isFinite(importePendienteCobro)
                    ? Math.round(importePendienteCobro * 100) / 100
                    : null,
                formaPagoCobro: paymentMethodLabel(
                    row.FORMA_PAGO_COBRO ?? row.forma_pago_cobro,
                ),
                cobroParcial: hasCobro
                    && Number.isFinite(importePendienteCobro)
                    && importePendienteCobro > 0.004,
            });
        }
        if (!byId.size) return albaranes;
        return albaranes.map((item) => {
            const match = byId.get(String(item.id || '').trim());
            if (!match) return item;
            return {
                ...item,
                estado: match.status,
                colorEstado: match.status === 'ENTREGADO' ? 'green' : item.colorEstado,
                confirmationId: match.confirmationId,
                cobroId: match.cobroId,
                cobrado: match.cobrado,
                importeCobrado: match.importeCobrado,
                importePendienteCobro: match.importePendienteCobro,
                formaPagoCobro: match.formaPagoCobro,
                cobroParcial: match.cobroParcial,
            };
        });
    } catch (_error) {
        logger.warn('[ENTREGAS] Canonical confirmation overlay unavailable');
        return albaranes;
    }
}

async function loadCanonicalDetailProjection(documentId, repartidorId, clientCode) {
    const tables = confirmationTables();
    if (!tables?.confirmations || !tables?.lines) {
        return { availability: 'UNAVAILABLE', confirmation: null, linesById: new Map() };
    }
    try {
        const confirmations = await queryWithParams(`
            SELECT ID, STATUS, CONFIRMED_AT
            FROM ${tables.confirmations}
            WHERE TRIM(DOCUMENT_ID) = ?
              AND TRIM(REPARTIDOR_ID) = ?
              AND TRIM(CLIENTE_CODIGO) = ?
        `, [documentId, repartidorId, clientCode], false, false);
        if (confirmations.length === 0) {
            return { availability: 'NONE', confirmation: null, linesById: new Map() };
        }
        if (confirmations.length !== 1) {
            throw new RepartoHttpError(409, 'AMBIGUOUS_CONFIRMATION', 'Existe mas de una confirmacion para la identidad solicitada');
        }
        const confirmation = confirmations[0];
        const lines = await queryWithParams(`
            SELECT LINEA_ID, CANTIDAD_ENTREGADA, CANTIDAD_RECHAZADA, CANTIDAD_PENDIENTE,
                   MOTIVO_DIFERENCIA, OBSERVACIONES
            FROM ${tables.lines}
            WHERE CONFIRMACION_ID = ?
            ORDER BY LINEA_ID
        `, [confirmation.ID], false, false);
        const linesById = new Map();
        for (const line of lines) {
            const lineId = String(line.LINEA_ID);
            if (linesById.has(lineId)) {
                throw new RepartoHttpError(409, 'AMBIGUOUS_CONFIRMATION_LINE', 'La confirmacion contiene lineas duplicadas');
            }
            linesById.set(lineId, line);
        }
        return { availability: 'AVAILABLE', confirmation, linesById };
    } catch (error) {
        if (error instanceof RepartoHttpError) throw error;
        logger.warn('[ENTREGAS] Canonical confirmation schema unavailable for detail projection');
        return { availability: 'UNAVAILABLE', confirmation: null, linesById: new Map() };
    }
}

function confirmedQuantity(value) {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

async function resolveClienteForDetail({ numero, ejercicio, serie, terminal, clienteHint }) {
    let cliente = normalizeCode(clienteHint);
    if (cliente) return cliente;

    // Compat: old clients omit cliente but still send serie+terminal.
    // Resolve only when the delivery identity is unique.
    if (serie === undefined || serie === null || terminal === undefined || terminal === null || terminal === '') {
        return '';
    }
    const rows = await queryWithParams(`
        SELECT DISTINCT TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE
        FROM DSEDAC.CPC CPC
        WHERE CPC.NUMEROALBARAN = ?
          AND CPC.EJERCICIOALBARAN = ?
          AND TRIM(CPC.SERIEALBARAN) = ?
          AND CPC.TERMINALALBARAN = ?
    `, [numero, ejercicio, String(serie).trim(), terminal], false, false);
    if (rows.length === 1) {
        return normalizeCode(rows[0].CLIENTE);
    }
    return '';
}

router.get('/albaran/:numero/:ejercicio', verifyToken, async (req, res) => {
    try {
        const { numero, ejercicio } = req.params;
        const serie = req.query.serie;
        const terminal = req.query.terminal;
        const ownerSelection = requireConcreteAlbaranOwner(req, res);
        if (!ownerSelection.allowed) return;
        // Accept canonical `cliente` and legacy `codigoCliente` alias.
        const cliente = await resolveClienteForDetail({
            numero,
            ejercicio,
            serie,
            terminal,
            clienteHint: req.query.cliente || req.query.codigoCliente,
        });
        if (!cliente) {
            return res.status(400).json({
                success: false,
                code: 'CLIENT_REQUIRED',
                error: 'El cliente es obligatorio para identificar el albarÃ¡n',
            });
        }

        // 1. Build WHERE clause with parameterized query
        const headerParams = [numero, ejercicio, cliente];
        let whereClause = `CPC.NUMEROALBARAN = ? AND CPC.EJERCICIOALBARAN = ? AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?`;
        if (serie !== undefined && serie !== null && String(serie).length > 0) {
            whereClause += ` AND TRIM(CPC.SERIEALBARAN) = ?`;
            headerParams.push(String(serie).trim());
        }
        if (terminal !== undefined && terminal !== null && String(terminal).length > 0) {
            whereClause += ` AND CPC.TERMINALALBARAN = ?`;
            headerParams.push(terminal);
        }

        // 2. Get Header from CPC + CAC (collectable amount resolved below)
        const headerSql = `
            SELECT
                CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN,
                CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                CPC.IMPORTETOTAL as IMPORTE,
                CAC.IMPORTETOTAL as CAC_IMPORTE,
                CPC.IMPORTEBRUTO as IMPORTE_BRUTO,
                CPC.IMPORTEBASEIMPONIBLE1 as CPC_BASE1,
                CPC.IMPORTEBASEIMPONIBLE2 as CPC_BASE2,
                CPC.IMPORTEBASEIMPONIBLE3 as CPC_BASE3,
                CPC.PORCENTAJEIVA1 as CPC_PCTIVA1,
                CPC.PORCENTAJEIVA2 as CPC_PCTIVA2,
                CPC.PORCENTAJEIVA3 as CPC_PCTIVA3,
                CPC.IMPORTEIVA1 as CPC_IVA1,
                CPC.IMPORTEIVA2 as CPC_IVA2,
                CPC.IMPORTEIVA3 as CPC_IVA3,
                CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as CLIENTE_NOM,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIR,
                TRIM(COALESCE(CLI.POBLACION, '')) as POB,
                CAC.NUMEROFACTURA,
                CAC.SERIEFACTURA,
                TRIM(OPP.CODIGOREPARTIDOR) AS CODIGO_REPARTIDOR
            FROM DSEDAC.CPC CPC
            INNER JOIN DSEDAC.OPP OPP
                ON OPP.SUBEMPRESA = CPC.SUBEMPRESAPEDIDO
                AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
                AND OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            LEFT JOIN DSEDAC.CAC CAC ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
                AND TRIM(CAC.CODIGOCLIENTEALBARAN) = TRIM(CPC.CODIGOCLIENTEALBARAN)
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE ${whereClause}
        `;

        const headers = await queryWithParams(headerSql, headerParams);
        if (headers.length === 0) return res.status(404).json({ success: false, error: 'Albaran not found' });
        if (headers.length !== 1) return res.status(409).json({ success: false, code: 'AMBIGUOUS_DELIVERY_IDENTITY', error: 'La identidad del albarÃ¡n no es inequÃ­voca' });

        const header = { ...headers[0] };
        if (!ensureRepartidorAccess(req, res, header.CODIGO_REPARTIDOR)) return;
        if (ownerSelection.hintedOwner && !codesMatch(ownerSelection.hintedOwner, header.CODIGO_REPARTIDOR)) {
            return res.status(403).json({ success: false, code: 'DELIVERY_OWNERSHIP_REQUIRED', error: 'El albaran no pertenece al repartidor seleccionado' });
        }

        // 3. Get Items from LAC (Simplified for ODBC compatibility - NO ALIASES)
        // Parameterized query to prevent SQL injection
        const itemParams = [
            header.SUBEMPRESAALBARAN,
            header.EJERCICIOALBARAN,
            (header.SERIEALBARAN || '').trim(),
            header.TERMINALALBARAN,
            header.NUMEROALBARAN,
            header.CLIENTE
        ];
        let itemsSql = `
            SELECT
                SECUENCIA,
                CODIGOARTICULO,
                DESCRIPCION,
                CANTIDADUNIDADES,
                CANTIDADENVASES,
                PRECIOVENTA,
                IMPORTEVENTA,
                UNIDADMEDIDA
            FROM DSEDAC.LAC
            WHERE SUBEMPRESAALBARAN = ? AND EJERCICIOALBARAN = ?
              AND TRIM(SERIEALBARAN) = ? AND TERMINALALBARAN = ?
              AND NUMEROALBARAN = ?
              AND TRIM(CODIGOCLIENTEALBARAN) = ?
        `;

        itemsSql += ' ORDER BY SECUENCIA';
        const documentId = `${header.EJERCICIOALBARAN}-${(header.SERIEALBARAN || '').trim()}-${header.TERMINALALBARAN}-${header.NUMEROALBARAN}-${header.CLIENTE}`;
        const canonical = await loadCanonicalDetailProjection(documentId, header.CODIGO_REPARTIDOR, header.CLIENTE);
        const canonicalStatus = canonical.confirmation ? String(canonical.confirmation.STATUS || '').trim() : '';

        const items = await queryWithParams(itemsSql, itemParams);

        // IVA breakdown for detail
        const base1 = parseFloat(header.CPC_BASE1) || 0;
        const base2 = parseFloat(header.CPC_BASE2) || 0;
        const base3 = parseFloat(header.CPC_BASE3) || 0;
        const pctIva1 = parseFloat(header.CPC_PCTIVA1) || 0;
        const pctIva2 = parseFloat(header.CPC_PCTIVA2) || 0;
        const pctIva3 = parseFloat(header.CPC_PCTIVA3) || 0;
        const iva1 = parseFloat(header.CPC_IVA1) || 0;
        const iva2 = parseFloat(header.CPC_IVA2) || 0;
        const iva3 = parseFloat(header.CPC_IVA3) || 0;
        const netoSum = Math.round((base1 + base2 + base3) * 100) / 100;
        const ivaSum = Math.round((iva1 + iva2 + iva3) * 100) / 100;
        const ivaBreakdown = [];
        if (base1 > 0) ivaBreakdown.push({ base: base1, pct: pctIva1, iva: iva1 });
        if (base2 > 0) ivaBreakdown.push({ base: base2, pct: pctIva2, iva: iva2 });
        if (base3 > 0) ivaBreakdown.push({ base: base3, pct: pctIva3, iva: iva3 });

        const albaranItems = items.map(i => {
                const confirmedLine = canonical.linesById.get(String(i.SECUENCIA));
                const unidades = parseFloat(i.CANTIDADUNIDADES) || 0;
                const envases = parseFloat(i.CANTIDADENVASES) || 0;
                const cantidadPedida = unidades > 0 ? unidades : envases;
                const cantidadEntregada = confirmedLine ? confirmedQuantity(confirmedLine.CANTIDAD_ENTREGADA) : null;
                const secuencia = String(i.SECUENCIA ?? '').trim();
                const codigoArticulo = String(i.CODIGOARTICULO ?? '').trim() || secuencia;
                const totalLinea = sanitizeErpAmount(i.IMPORTEVENTA);
                return {
                    itemId: secuencia,
                    codigoArticulo,
                    descripcion: i.DESCRIPCION,
                    cantidadPedida,
                    bultos: envases,
                    cantidadCajas: 0,
                    totalLinea,
                    unidad: i.UNIDADMEDIDA,
                    precioUnitario: cantidadPedida !== 0 ? totalLinea / cantidadPedida : 0,
                    cantidadEntregada,
                    cantidadRechazada: confirmedLine ? confirmedQuantity(confirmedLine.CANTIDAD_RECHAZADA) : null,
                    cantidadPendiente: confirmedLine ? confirmedQuantity(confirmedLine.CANTIDAD_PENDIENTE) : null,
                    confirmationState: canonical.availability === 'UNAVAILABLE' ? 'UNAVAILABLE' : (confirmedLine ? 'CONFIRMED' : 'NOT_CONFIRMED'),
                    estado: confirmedLine ? (cantidadEntregada >= cantidadPedida ? 'ENTREGADO' : 'PARCIAL') : 'PENDIENTE'
                };
            }).filter((line) => line.cantidadPedida > 0 || line.bultos > 0);

        const lineSumRounded = Math.round(
            albaranItems.reduce((sum, item) => sum + (Number(item.totalLinea) || 0), 0) * 100,
        ) / 100;
        const zeroPriceQtyLines = albaranItems.filter(
            (item) => (Number(item.cantidadPedida) || 0) > 0 && Math.abs(Number(item.totalLinea) || 0) < 0.005,
        ).length;
        const resolvedAmount = resolveDeliveryAmount({
            cpcTotal: parseFloat(header.IMPORTE) || 0,
            cacTotal: parseFloat(header.CAC_IMPORTE) || 0,
            cpcNetoSum: netoSum,
            cpcIvaSum: ivaSum,
            lacLineSum: lineSumRounded,
            qtyLines: albaranItems.length,
            zeroPriceQtyLines,
        });
        const detailCvcPlan = buildCvcAvailabilityQuery([{
            SUBEMPRESAALBARAN: header.SUBEMPRESAALBARAN,
            EJERCICIOALBARAN: header.EJERCICIOALBARAN,
            SERIEALBARAN: header.SERIEALBARAN,
            TERMINALALBARAN: header.TERMINALALBARAN,
            NUMEROALBARAN: header.NUMEROALBARAN,
            CLIENTE: header.CLIENTE,
        }]);
        const detailCvcRows = detailCvcPlan
            ? await queryWithParams(detailCvcPlan.sql, detailCvcPlan.params, false, false)
            : [];
        const detailCvcAvailability = mapCvcAvailabilityRows(
            detailCvcRows,
            detailCvcPlan?.documents || [],
        ).get(documentKey(detailCvcPlan?.documents?.[0]))
            || { state: 'MISSING', importeDisponibleCobro: 0 };

        const albaran = {
            id: documentId,
            numeroAlbaran: header.NUMEROALBARAN,
            ejercicio: header.EJERCICIOALBARAN,
            serie: (header.SERIEALBARAN || '').trim(),
            terminal: header.TERMINALALBARAN,
            codigoCliente: header.CLIENTE,
            nombreCliente: header.CLIENTE_NOM,
            direccion: header.DIR,
            poblacion: header.POB,
            numeroFactura: header.NUMEROFACTURA || 0,
            serieFactura: (header.SERIEFACTURA || '').trim(),
            documentoTipo: (header.NUMEROFACTURA || 0) > 0 ? 'FACTURA' : 'ALBARAN',
            fecha: isoDocumentDate(header, todayIsoDate()),
            importe: resolvedAmount.amount,
            importeBruto: parseFloat(header.IMPORTE_BRUTO) || 0,
            netoSum: netoSum,
            ivaSum: ivaSum,
            ivaBreakdown: ivaBreakdown,
            checksum: `${Math.round((netoSum + ivaSum) * 100) / 100}`,
            formaPago: (header.FORMA_PAGO || '').trim(),
            puedeCobrarse: detailCvcAvailability.state === 'AVAILABLE'
                && detailCvcAvailability.importeDisponibleCobro > 0.004,
            importeDisponibleCobro: detailCvcAvailability.importeDisponibleCobro,
            cobroDocumentoEstado: detailCvcAvailability.state,
            items: albaranItems,
            confirmationAvailability: canonical.availability,
            confirmedAt: canonical.confirmation?.CONFIRMED_AT || null,
            estado: canonicalStatus || 'PENDIENTE',
            lineSum: lineSumRounded,
            amountSource: resolvedAmount.source,
            pricingState: resolvedAmount.pricingState,
            discrepancy: resolvedAmount.discrepancy
                || Math.abs(resolvedAmount.amount - Math.round((netoSum + ivaSum) * 100) / 100) > 0.01,
        };

        res.json({ success: true, albaran });
    } catch (error) {
        if (error instanceof RepartoHttpError) {
            return res.status(error.status).json({ success: false, code: error.code, error: error.message });
        }
        logger.error('[ENTREGAS] Delivery detail unavailable');
        return sendEntregasUnavailable(res, 'DELIVERY_DETAIL_UNAVAILABLE', 'No se pudo consultar el detalle de la entrega');
    }
});

// ===================================
// POST /update - Update delivery status with duplicate prevention
// ===================================
function canonicalEndpointRequired(endpoint) {
    return (_req, res) => res.status(410).json({
        success: false,
        code: 'REPARTO_CANONICAL_ENDPOINT_REQUIRED',
        error: 'Este endpoint ha sido retirado; usa el flujo canÃ³nico de reparto',
        canonicalEndpoint: endpoint,
    });
}

router.post('/update', verifyToken, canonicalEndpointRequired(
    '/api/repartidor-finanzas/rutero/confirm-delivery-cobro',
));

router.post('/uploads/photo', verifyToken, canonicalEndpointRequired(
    '/api/repartidor-finanzas/rutero/evidence/photo',
));
router.post('/uploads/signature', verifyToken, canonicalEndpointRequired(
    '/api/repartidor-finanzas/rutero/evidence/signature',
));

async function requireDeliveryOwnership(req, entregaId) {
    if (!parseDeliveryItemId(entregaId)) throw new RepartoHttpError(400, 'INVALID_DELIVERY_ID', 'Identificador de entrega invÃ¡lido');
    const owner = await getDeliveryOwner(entregaId);
    if (!owner) throw new RepartoHttpError(404, 'DELIVERY_NOT_FOUND', 'Entrega no encontrada');
    if (!canAccessRepartidor(req, owner)) throw new RepartoHttpError(403, 'DELIVERY_OWNERSHIP_REQUIRED', 'No tienes permisos para esta entrega');
    return owner;
}

async function canonicalReceiptProjection(req, entregaId) {
    const parsed = parseDeliveryItemId(entregaId);
    if (!parsed?.cliente) throw new RepartoHttpError(400, 'CLIENT_REQUIRED', 'El cliente es obligatorio en la identidad de entrega');

    const owner = await requireDeliveryOwnership(req, entregaId);
    const headers = await queryWithParams(`
        SELECT ID, DOCUMENT_ID, REPARTIDOR_ID, CLIENTE_CODIGO, CLIENTE_NOMBRE,
               DOCUMENTO_SERIE, DOCUMENTO_TERMINAL, DOCUMENTO_NUMERO,
               OCCURRED_AT, CONFIRMED_AT, RECEPTOR_NOMBRE, RECEPTOR_APELLIDOS,
               RECEPTOR_DNI, FIRMA_EVIDENCE_ID, RESULT_JSON
        FROM JAVIER.TEST_REPARTO_CONFIRMACIONES
        WHERE DOCUMENT_ID = ? AND REPARTIDOR_ID = ? AND CLIENTE_CODIGO = ?
    `, [entregaId, owner, parsed.cliente], false, false);
    if (headers.length > 1) throw new RepartoHttpError(409, 'AMBIGUOUS_CONFIRMATION', 'Existe mas de una confirmacion autorizada para esta entrega');
    const header = headers[0];
    if (!header) throw new RepartoHttpError(503, 'CANONICAL_RECEIPT_UNAVAILABLE', 'No hay una confirmaciÃ³n estructurada para generar el recibo');
    const lines = await queryWithParams(`
        SELECT LINEA_ID, CODIGO_ARTICULO, DESCRIPCION, CANTIDAD_PEDIDA,
               CANTIDAD_ENTREGADA, CANTIDAD_RECHAZADA, CANTIDAD_PENDIENTE, PRECIO_UNITARIO
        FROM JAVIER.TEST_REPARTO_LINEAS
        WHERE CONFIRMACION_ID = ?
        ORDER BY LINEA_ID
    `, [header.ID], false, false);
    let signatureBuffer = null;
    let signatureMimeType = null;
    if (header.FIRMA_EVIDENCE_ID) {
        const evidenceRows = await queryWithParams(`
            SELECT CONTENT_BLOB, MIME_TYPE
            FROM JAVIER.TEST_REPARTO_EVIDENCIAS
            WHERE EVIDENCE_ID = ?
              AND DOCUMENT_ID = ?
              AND REPARTIDOR_ID = ?
              AND EVIDENCE_KIND = 'FIRMA'
        `, [header.FIRMA_EVIDENCE_ID, entregaId, owner], false, false);
        if (evidenceRows.length !== 1 || !evidenceRows[0].CONTENT_BLOB) {
            throw new RepartoHttpError(503, 'CANONICAL_SIGNATURE_UNAVAILABLE', 'La evidencia de firma confirmada no esta disponible');
        }
        signatureBuffer = Buffer.isBuffer(evidenceRows[0].CONTENT_BLOB) ? evidenceRows[0].CONTENT_BLOB : Buffer.from(evidenceRows[0].CONTENT_BLOB);
        signatureMimeType = String(evidenceRows[0].MIME_TYPE || '').trim() || null;
    }
    if (!lines.length) throw new RepartoHttpError(503, 'CANONICAL_RECEIPT_UNAVAILABLE', 'Faltan lÃ­neas estructuradas de la entrega');
    const receiptLines = lines.filter((line) => Number(line.CANTIDAD_ENTREGADA || 0) > 0).map((line) => ({
        SECUENCIA: line.LINEA_ID,
        ARTICULO: line.CODIGO_ARTICULO,
        DESCRIPCION: line.DESCRIPCION,
        CANTIDAD_PEDIDA: Number(line.CANTIDAD_PEDIDA || 0),
        CANTIDAD_ENTREGADA: Number(line.CANTIDAD_ENTREGADA || 0),
        CANTIDAD_RECHAZADA: Number(line.CANTIDAD_RECHAZADA || 0),
        CANTIDAD_PENDIENTE: Number(line.CANTIDAD_PENDIENTE || 0),
        BULTOS: Number(line.CANTIDAD_ENTREGADA || 0),
        IMPORTE: Number(line.CANTIDAD_ENTREGADA || 0) * Number(line.PRECIO_UNITARIO || 0)
    }));
    const total = receiptLines.reduce((sum, line) => sum + line.IMPORTE, 0);
    return {
        canonicalProjection: true, confirmationId: String(header.ID),
        confirmationVersion: String(header.CONFIRMED_AT || header.OCCURRED_AT || ''), ejercicio: parsed.ejercicio,
        serie: String(header.DOCUMENTO_SERIE || '').trim(), terminal: Number(header.DOCUMENTO_TERMINAL), numero: Number(header.DOCUMENTO_NUMERO),
        albaranNum: `${String(header.DOCUMENTO_SERIE || '').trim()}-${header.DOCUMENTO_TERMINAL}-${header.DOCUMENTO_NUMERO}`,
        clientCode: String(header.CLIENTE_CODIGO || '').trim(), clientName: String(header.CLIENTE_NOMBRE || '').trim(),
        fecha: header.CONFIRMED_AT || header.OCCURRED_AT, confirmedAt: header.CONFIRMED_AT || null,
        repartidor: owner, items: receiptLines,
        subtotal: total, iva: null, total,
        receiverName: String(header.RECEPTOR_NOMBRE || '').trim(), receiverSurnames: String(header.RECEPTOR_APELLIDOS || '').trim(),
        receiverDni: String(header.RECEPTOR_DNI || '').trim(),
        signatureEvidenceId: header.FIRMA_EVIDENCE_ID || null,
        signatureBuffer, signatureMimeType
    };
}

function canonicalReceiptEndpointRequired(_req, res) {
    return res.status(410).json({
        success: false,
        code: 'REPARTO_CANONICAL_RECEIPT_ENDPOINT_REQUIRED',
        error: 'Este comprobante se obtiene desde la confirmaciÃ³n canÃ³nica de reparto',
        canonicalEndpoint: '/api/repartidor-finanzas/rutero/confirmations/:confirmationId/receipt',
    });
}

// Legacy endpoints never query a delivery or dispatch a receipt.
router.all('/receipt/:entregaId', verifyToken, canonicalReceiptEndpointRequired);
router.all('/receipt/:entregaId/email', verifyToken, canonicalReceiptEndpointRequired);
router.all('/receipt/:entregaId/whatsapp', verifyToken, canonicalReceiptEndpointRequired);

router.post('/receipt/:entregaId', verifyToken, async (req, res) => {
    try {
        const deliveryData = await canonicalReceiptProjection(req, req.params.entregaId);
        const { saveReceipt } = require('../app/services/deliveryReceiptService');
        const result = await saveReceipt(deliveryData, null);
        return res.status(200).json({ success: true, pdfBase64: result.buffer.toString('base64'), fileName: result.fileName, disposition: result.disposition });
    } catch (error) { return sendRepartoError(res, error); }
});

router.post('/receipt/:entregaId/email', verifyToken, async (req, res) => {
    try {
        await canonicalReceiptProjection(req, req.params.entregaId);
        throw new RepartoHttpError(503, 'CANONICAL_RECIPIENT_UNAVAILABLE', 'No hay un destinatario de correo canÃ³nico disponible');
    } catch (error) { return sendRepartoError(res, error); }
});

router.post('/receipt/:entregaId/whatsapp', verifyToken, async (req, res) => {
    try {
        await canonicalReceiptProjection(req, req.params.entregaId);
        throw new RepartoHttpError(503, 'CANONICAL_RECIPIENT_UNAVAILABLE', 'No hay un destinatario de mensajerÃ­a canÃ³nico disponible');
    } catch (error) { return sendRepartoError(res, error); }
});

module.exports = router;
