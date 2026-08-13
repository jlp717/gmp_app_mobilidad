const express = require('express');
const router = express.Router();
const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const logger = require('../middleware/logger');
const { verifyToken } = require('../middleware/auth');
const { sanitizeCodeListForParams } = require('../utils/common');
const { isDeliveryStatusAvailable, isDeliveryStatusNewSchema, getDeliveryStatusJoin } = require('../utils/delivery-status-check');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const ruteroOrdenRepo = require('../repositories/repartidor-rutero-orden-db2-repository');
const { applySavedOrder } = require('../services/repartidor-rutero-orden-service');

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

function isPrivilegedUser(req) {
    const user = req.user || {};
    return user.isJefeVentas === true || user.role === 'JEFE_VENTAS' || user.role === 'ADMIN';
}

function canAccessRepartidor(req, repartidorId) {
    if (isPrivilegedUser(req)) return true;
    if (req.user?.role !== 'REPARTIDOR') return false;
    const userCode = normalizeCode(req.user.code || req.user.id || req.user.user);
    const targetCode = normalizeCode(repartidorId);
    const userNumeric = normalizeNumericCode(userCode);
    const targetNumeric = normalizeNumericCode(targetCode);
    return userCode === targetCode ||
        (userNumeric !== null && targetNumeric !== null && userNumeric === targetNumeric);
}

function ensureRepartidorAccess(req, res, repartidorId) {
    if (canAccessRepartidor(req, repartidorId)) return true;
    logger.warn(`[ENTREGAS] Forbidden ${req.user?.code || 'unknown'} -> repartidor ${repartidorId}`);
    res.status(403).json({ success: false, error: 'No tienes permisos para operar sobre este repartidor' });
    return false;
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
    return res.status(503).json({ success: false, code: 'CANONICAL_RECEIPT_UNAVAILABLE', error: 'No se pudo generar el recibo canÃ³nico' });
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

        const pageLimit = parseBoundedInteger(limit, { defaultValue: 100, min: 1, max: 100 });
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
        const idList = sanitizeCodeListForParams(repartidorId);
        if (!idList || idList.length === 0) {
            return res.status(400).json({ error: 'Invalid repartidor ID format' });
        }
        const unauthorized = idList.find(id => !canAccessRepartidor(req, id));
        if (unauthorized) {
            return res.status(403).json({
                success: false,
                error: 'No tienes permisos para consultar este repartidor'
            });
        }
        const placeholders = idList.map(() => '?').join(',');

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
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            ${dsJoin}
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${placeholders})
              AND OPP.DIAREPARTO = ?
              AND OPP.MESREPARTO = ?
              AND OPP.ANOREPARTO = ?
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
            const queryParams = [...idList, dia, mes, ano, pageOffset, pageLimit + 1];
            rows = await queryWithParams(sql, queryParams) || [];
        } catch (queryError) {
            logger.error('[ENTREGAS] Pending-delivery query unavailable');
            return sendEntregasUnavailable(res, 'PENDING_DELIVERIES_UNAVAILABLE', 'No se pudo consultar el listado de entregas');
        }

        const sourceHasMore = rows.length > pageLimit;
        rows = rows.slice(0, pageLimit);
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
        if (clientCodes.length > 0) {
            const clxPlaceholders = clientCodes.map(() => '?').join(',');
            const clpPlaceholders = clientCodes.map(() => '?').join(',');
            const cvcPlaceholders = clientCodes.map(() => '?').join(',');

            const [clxRows, clpRows, cvcRows] = await Promise.allSettled([
                queryWithParams(`
                    SELECT TRIM(CODIGOCLIENTE) as CLIENTE
                    FROM DSEDAC.CLX
                    WHERE TRIM(CODIGOCLIENTE) IN (${clxPlaceholders})
                      AND TRIM(COALESCE(COBRORIGUROSOSN, '')) = 'S'
                `, clientCodes, false, false),
                queryWithParams(`
                    SELECT
                      TRIM(CODIGOCLIENTE) as CLIENTE,
                      IMPORTELIMITERIESGO,
                      IMPORTELIMITERIESGOEMPRESA
                    FROM DSEDAC.CLP
                    WHERE TRIM(CODIGOCLIENTE) IN (${clpPlaceholders})
                `, clientCodes, false, false),
                queryWithParams(`
                    SELECT
                      TRIM(CODIGOCLIENTEALBARAN) as CLIENTE,
                      COALESCE(SUM(IMPORTEPENDIENTE), 0) as PENDIENTE
                    FROM DSEDAC.CVC
                    WHERE TRIM(CODIGOCLIENTEALBARAN) IN (${cvcPlaceholders})
                      AND COALESCE(ANULADOSN, '') <> 'S'
                      AND IMPORTEPENDIENTE <> 0
                    GROUP BY TRIM(CODIGOCLIENTEALBARAN)
                `, clientCodes, false, false),
            ]);
            if ([clxRows, clpRows, cvcRows].some((result) => result.status === 'rejected')) {
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
        }

        // Process rows
        const albaranes = uniqueRows.map(row => {
            const serie = (row.SERIEALBARAN || '').trim();
            const cliente = (row.CLIENTE || '').trim();
            const importeAlbaran = parseMoney(row.IMPORTETOTAL);
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

            // Determine if repartidor MUST collect money
            // CLX.COBRORIGUROSOSN complements PAYMENT_CONDITIONS without replacing it.
            let esCTR = paymentInfo.mustCollect || cobroRiguroso;
            let puedeCobrarse = paymentInfo.canCollect || cobroRiguroso;

            // Ensure consistency
            if (esCTR) puedeCobrarse = true;

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

            // Use IMPORTETOTAL (correct final amount incl. IVA) instead of IMPORTEBRUTO (gross pre-discount)
            let importeTotal = importeAlbaran;
            // AUDIT FIX: Sanitize sentinel amounts
            if (Math.abs(importeTotal) >= 900000 || Object.is(importeTotal, -0)) {
                importeTotal = 0;
            }
            const importeBruto = parseMoney(row.IMPORTEBRUTO);

            // IVA breakdown from CPC (up to 3 tax bases)
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
                documentoTipo: esFactura ? 'FACTURA' : 'ALBARÃN',
                codigoCliente: cliente,
                nombreCliente: row.NOMBRE_CLIENTE?.trim(),
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
                formaPago: fp,
                formaPagoDesc: paymentInfo.desc,
                tipoPago: paymentInfo.type,
                diasPago: paymentInfo.diasPago,
                esCTR: esCTR,
                puedeCobrarse: puedeCobrarse,
                cobroRiguroso: cobroRiguroso,
                creditoSuperaLimite: creditoSuperaLimite,
                limiteCredito: limiteCredito,
                riesgoCreditoActual: riesgoActual,
                colorEstado: colorEstado,
                fecha: `${row.DIADOCUMENTO}/${row.MESDOCUMENTO}/${row.ANODOCUMENTO}`,
                ruta: row.RUTA?.trim(),
                codigoRepartidor: row.CODIGO_REPARTIDOR?.trim() || '',
                nombreRepartidor: stripVendorCode(row.NOMBRE_REPARTIDOR) || row.CODIGO_REPARTIDOR?.trim() || '',
                ordenPreparacion: row.ORDEN_PREPARACION || null,
                estado: status,
                observaciones: row.DS_OBS,
                firma: row.DS_FIRMA
            };
        });

        // --- FILTERING: Search by client name, code, albarÃ¡n or factura number ---
        const searchQuery = req.query.search?.toLowerCase().trim() || '';
        let filteredAlbaranes = albaranes;
        if (searchQuery) {
            filteredAlbaranes = albaranes.filter(a =>
                a.nombreCliente?.toLowerCase().includes(searchQuery) ||
                a.codigoCliente?.toLowerCase().includes(searchQuery) ||
                String(a.numeroAlbaran).includes(searchQuery) ||
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
                String(a.numeroAlbaran).includes(searchAlbaran) ||
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
            filteredAlbaranes = filteredAlbaranes.filter(a => a.documentoTipo === 'ALBARÃN');
        } else if (filterDocTipo === 'FACTURA') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.documentoTipo === 'FACTURA');
        }

        // --- SORTING ---
        const sortBy = req.query.sortBy || 'default'; // 'default', 'importe_asc', 'importe_desc'
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

        // Calculate totals for summary (always from unfiltered `albaranes` for accurate KPIs)
        const totalBruto = albaranes.reduce((sum, a) => sum + (a.importe || 0), 0);
        const totalACobrar = albaranes.filter(a => a.esCTR).reduce((sum, a) => sum + (a.importe || 0), 0);
        const totalOpcional = albaranes.filter(a => a.puedeCobrarse && !a.esCTR).reduce((sum, a) => sum + (a.importe || 0), 0);
        const completedCount = albaranes.filter(a => a.estado === 'ENTREGADO').length;

        const totalFiltered = filteredAlbaranes.length;
        const nextOffset = pageOffset + uniqueRows.length;
        const exactTotal = sourceHasMore ? null : nextOffset;
        const pagination = {
            limit: pageLimit,
            offset: pageOffset,
            hasMore: sourceHasMore,
            nextOffset,
            total: exactTotal,
            totalIsExact: !sourceHasMore
        };
        const totalUnfiltered = albaranes.length;
        const paginatedAlbaranes = filteredAlbaranes;

        logger.info(`[ENTREGAS] Date=${targetDate.toISOString().split('T')[0]} Repartidor=${repartidorId} â†’ albaranes=${paginatedAlbaranes.length} (offset=${pageOffset}, limit=${pageLimit}), totalBruto=${totalBruto.toFixed(2)}, totalACobrar=${totalACobrar.toFixed(2)}, totalOpcional=${totalOpcional.toFixed(2)}, completed=${completedCount}`);

        res.json({
            success: true,
            albaranes: paginatedAlbaranes,
            total: exactTotal,
            originalTotal: totalUnfiltered,
            limit: pageLimit,
            offset: pageOffset,
            hasMore: sourceHasMore,
            nextOffset,
            totalIsExact: !sourceHasMore,
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
    try {
        const runtime = resolveRepartoRuntime(process.env);
        const confirmation = runtime?.tables?.confirmation;
        if (confirmation?.confirmations && confirmation?.lines) {
            return confirmation;
        }
    } catch (_error) {
        // Invalid/partial runtime: keep legacy isolated projection names so
        // detail reads still soft-fail cleanly instead of hard-crashing.
    }
    return {
        confirmations: 'JAVIER.TEST_REPARTO_CONFIRMACIONES',
        lines: 'JAVIER.TEST_REPARTO_LINEAS',
    };
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
            WHERE DOCUMENT_ID = ?
              AND REPARTIDOR_ID = ?
              AND CLIENTE_CODIGO = ?
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

        // 2. Get Header from CPC (uses IMPORTETOTAL - correct final amount)
        const headerSql = `
            SELECT
                CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN,
                CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                CPC.IMPORTETOTAL as IMPORTE,
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
            documentoTipo: (header.NUMEROFACTURA || 0) > 0 ? 'FACTURA' : 'ALBARÃN',
            fecha: `${header.DIADOCUMENTO}/${header.MESDOCUMENTO}/${header.ANODOCUMENTO}`,
            importe: parseFloat(header.IMPORTE) || 0,
            importeBruto: parseFloat(header.IMPORTE_BRUTO) || 0,
            netoSum: netoSum,
            ivaSum: ivaSum,
            ivaBreakdown: ivaBreakdown,
            checksum: `${Math.round((netoSum + ivaSum) * 100) / 100}`,
            formaPago: (header.FORMA_PAGO || '').trim(),
            items: items.map(i => {
                const confirmedLine = canonical.linesById.get(String(i.SECUENCIA));
                const cantidadPedida = parseFloat(i.CANTIDADUNIDADES) || 0;
                const cantidadEntregada = confirmedLine ? confirmedQuantity(confirmedLine.CANTIDAD_ENTREGADA) : null;
                return {
                    itemId: String(i.SECUENCIA),
                    codigoArticulo: String(i.CODIGOARTICULO ?? '').trim(),
                    descripcion: i.DESCRIPCION,
                    cantidadPedida,
                    bultos: parseFloat(i.CANTIDADENVASES) || 0,
                    cantidadCajas: 0,
                    totalLinea: parseFloat(i.IMPORTEVENTA) || 0,
                    unidad: i.UNIDADMEDIDA,
                    precioUnitario: cantidadPedida !== 0 ? (parseFloat(i.IMPORTEVENTA) || 0) / cantidadPedida : 0,
                    cantidadEntregada,
                    cantidadRechazada: confirmedLine ? confirmedQuantity(confirmedLine.CANTIDAD_RECHAZADA) : null,
                    cantidadPendiente: confirmedLine ? confirmedQuantity(confirmedLine.CANTIDAD_PENDIENTE) : null,
                    confirmationState: canonical.availability === 'UNAVAILABLE' ? 'UNAVAILABLE' : (confirmedLine ? 'CONFIRMED' : 'NOT_CONFIRMED'),
                    estado: confirmedLine ? (cantidadEntregada >= cantidadPedida ? 'ENTREGADO' : 'PARCIAL') : 'PENDIENTE'
                };
            }),
            confirmationAvailability: canonical.availability,
            confirmedAt: canonical.confirmation?.CONFIRMED_AT || null,
            estado: canonicalStatus || 'PENDIENTE'
        };

        // Discrepancy detection: compare header total vs sum of line amounts
        const lineSum = albaran.items.reduce((sum, item) => sum + item.totalLinea, 0);
        const lineSumRounded = Math.round(lineSum * 100) / 100;
        albaran.lineSum = lineSumRounded;
        albaran.discrepancy = Math.abs(albaran.importe - lineSumRounded) > 0.01;

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

