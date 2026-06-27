const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const logger = require('../middleware/logger');
const { verifyToken } = require('../middleware/auth');
const { sanitizeCodeListForParams, sanitizeForSQL } = require('../utils/common');
const { isDeliveryStatusAvailable, isDeliveryStatusNewSchema, getDeliveryStatusJoin } = require('../utils/delivery-status-check');

/**
 * Strip leading vendor code from VDD names (e.g., "08 DAMIAN" → "DAMIAN")
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
    return { ejercicio, serie, terminal, numero };
}

async function getDeliveryOwner(itemId) {
    const dsNewSchema = isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();

    if (dsNewSchema) {
        // NEW schema: DELIVERY_STATUS has albaran columns + OPERADOR
        const parsed = parseDeliveryItemId(itemId);
        if (!parsed) return null;
        const rows = await queryWithParams(`
            SELECT TRIM(OPERADOR) AS CODIGO_REPARTIDOR
            FROM JAVIER.DELIVERY_STATUS
            WHERE EJERCICIOALBARAN = ?
              AND TRIM(SERIEALBARAN) = ?
              AND TERMINALALBARAN = ?
              AND NUMEROALBARAN = ?
            FETCH FIRST 1 ROW ONLY
        `, [parsed.ejercicio, parsed.serie, parsed.terminal, parsed.numero], false, false);
        return rows[0]?.CODIGO_REPARTIDOR?.trim() || null;
    }

    // OLD schema: query DSEDAC.CPC + DSEDAC.OPP
    const parsed = parseDeliveryItemId(itemId);
    if (!parsed) return null;
    const rows = await queryWithParams(`
        SELECT TRIM(OPP.CODIGOREPARTIDOR) AS CODIGO_REPARTIDOR
        FROM DSEDAC.CPC CPC
        INNER JOIN DSEDAC.OPP OPP
          ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
        WHERE CPC.EJERCICIOALBARAN = ?
          AND TRIM(CPC.SERIEALBARAN) = ?
          AND CPC.TERMINALALBARAN = ?
          AND CPC.NUMEROALBARAN = ?
        FETCH FIRST 1 ROW ONLY
    `, [parsed.ejercicio, parsed.serie, parsed.terminal, parsed.numero], false, false);
    return rows[0]?.CODIGO_REPARTIDOR?.trim() || null;
}

/**
 * Validate Spanish DNI/NIE format with check letter (mod 23).
 * @param {string} value - DNI/NIE string
 * @returns {boolean} true if format is valid
 */
function isValidDniNie(value) {
    if (!value) return false;
    const cleaned = value.trim().toUpperCase();
    const regex = /^([XYZ]\d{7}|\d{8})[A-Z]$/;
    if (!regex.test(cleaned)) return false;
    const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
    let numStr = cleaned.slice(0, -1)
        .replace('X', '0').replace('Y', '1').replace('Z', '2');
    const num = parseInt(numStr, 10);
    if (isNaN(num)) return false;
    return cleaned[cleaned.length - 1] === letters[num % 23];
}

// Ensure directories exist
const photosDir = path.join(__dirname, '../../uploads/photos');
if (!fs.existsSync(photosDir)) {
    fs.mkdirSync(photosDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, photosDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `entrega-${uniqueSuffix}${ext}`);
    }
});
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max
        files: 1 // Max 1 file per request
    }
});
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
        suggestions.push(`⚠️ Llevas ${totalCash.toFixed(0)}€ en efectivo. Considera hacer un ingreso.`);
    } else if (totalCash > 500) {
        suggestions.push(`ℹ️ Acumulas ${totalCash.toFixed(0)}€ en cobros.`);
    }

    // 2. Urgent Deliveries
    const urgentCount = albaranes.filter(a => a.esCTR).length;
    if (urgentCount > 3) {
        suggestions.push(`🔥 Tienes ${urgentCount} clientes con cobro obligatorio prioritario.`);
    }

    // 3. Efficiency (Duplicate clients)
    const clientCounts = {};
    albaranes.forEach(a => {
        clientCounts[a.nombreCliente] = (clientCounts[a.nombreCliente] || 0) + 1;
    });
    const multiDrop = Object.entries(clientCounts).find(([_, count]) => count > 1);
    if (multiDrop) {
        suggestions.push(`📦 ${multiDrop[0]} tiene ${multiDrop[1]} entregas. ¡Agrúpalas!`);
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

        const pageLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 1000);
        const pageOffset = Math.max(parseInt(offset) || 0, 0);

        let targetDate = new Date();
        if (date) {
            targetDate = new Date(date);
        }

        const dia = targetDate.getDate();
        const mes = targetDate.getMonth() + 1;
        const ano = targetDate.getFullYear();

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
            logger.info(`[ENTREGAS] Loaded ${Object.keys(paymentConditions).length} payment conditions from DB`);
        } catch (pcError) {
            logger.warn(`[ENTREGAS] Could not load PAYMENT_CONDITIONS: ${pcError.message}, using defaults`);
        }

        const DEFAULT_PAYMENT = { desc: 'CRÉDITO', type: 'CREDITO', diasPago: 30, mustCollect: false, canCollect: false, color: 'green' };

        // CORRECTO: Usar OPP → CPC → CAC para repartidores
        // OPP tiene CODIGOREPARTIDOR, CPC vincula con CAC
        // IMPORTANTE: Usar IMPORTEBRUTO (sin IVA) para cobros
        // FIX: ID format must match exactly with frontend and update endpoint
        // Check if requested date is in the past (all deliveries assumed completed)
        const today = new Date();
        const todayNum = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
        const requestNum = ano * 10000 + mes * 100 + dia;
        const isPastDate = requestNum < todayNum;

        // Conditionally include DELIVERY_STATUS join (table may not exist)
        const dsAvailable = isDeliveryStatusAvailable();
        const dsJoin = dsAvailable ? getDeliveryStatusJoin('CPC', 'DS') : '';
        const dsColumns = dsAvailable
            ? (isDeliveryStatusNewSchema()
                ? `DS.STATUS as DS_STATUS,
                  CAST(NULL AS VARCHAR(512)) as DS_OBS,
                  CAST(NULL AS VARCHAR(255)) as DS_FIRMA`
                : `DS.ESTADO as DS_STATUS,
                  DS.OBSERVACIONES as DS_OBS,
                  DS.FIRMA_PATH as DS_FIRMA`)
            : `CAST(NULL AS VARCHAR(20)) as DS_STATUS,
              CAST(NULL AS VARCHAR(512)) as DS_OBS,
              CAST(NULL AS VARCHAR(255)) as DS_FIRMA`;

        const sql = `
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
              ${dsColumns}
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC
              ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC
              ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
              AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
              AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
              AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            ${dsJoin}
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${placeholders})
              AND OPP.DIAREPARTO = ?
              AND OPP.MESREPARTO = ?
              AND OPP.ANOREPARTO = ?
            ORDER BY CAC.NUMEROALBARAN
        `;

        // Table initialization removed to prevent AS400 errors.
        // Tables JAVIER.DELIVERY_STATUS and JAVIER.CLIENT_SIGNERS are assumed to exist.

        let rows = [];
        try {
            const queryParams = [...idList, dia, mes, ano];
            rows = await queryWithParams(sql, queryParams) || [];
        } catch (queryError) {
            logger.error(`[ENTREGAS] Query error in pendientes: ${queryError.message}`);
            return res.json({ success: true, albaranes: [], total: 0 });
        }

        // --- DEDUPLICATION & AGGREGATION ---
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
            let paymentInfo = paymentConditions[fp] || paymentConditions[parseInt(fp).toString()]; // Try '01' vs '1'
            if (!paymentInfo) paymentInfo = DEFAULT_PAYMENT;

            // Determine if repartidor MUST collect money
            // CLX.COBRORIGUROSOSN complements PAYMENT_CONDITIONS without replacing it.
            let esCTR = paymentInfo.mustCollect || cobroRiguroso;
            let puedeCobrarse = paymentInfo.canCollect || cobroRiguroso;

            // Debug specific rows to see why logic fails
            if (rows.length < 5 || Math.random() < 0.05) {
                logger.debug(`[ENTREGAS_DEBUG] Albaran: ${row.NUMEROALBARAN}, Cliente: '${cliente}', FP: '${fp}', Info: ${JSON.stringify(paymentInfo)}, cobroRiguroso: ${cobroRiguroso}, esCTR: ${esCTR}`);
            }

            if (!paymentInfo.mustCollect && !paymentInfo.canCollect && paymentInfo === DEFAULT_PAYMENT) {
                if (fp === 'CTR' || fp.includes('CONTADO') || fp.includes('METALICO')) {
                    esCTR = true;
                    puedeCobrarse = true;
                } else if (fp.includes('REP') || fp.includes('MENSUAL')) {
                    // Check specific logic? Assume optional for now or none
                }
            }
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
                } else if (isPastDate) {
                    // Fallback for past dates if CONFORMADOSN is missing but date implies done?
                    // Verify if we should trust Date alone for past. 
                    // User said "Past = Delivered" usually manually. 
                    // Let's keep PastDate as backup ONLY if > 2 days? 
                    // Actually, if Yesterday is 'S', then usually PastDate has S. 
                    // If PastDate has NO S, maybe it's "No Entregado"?
                    // Safe bet: Trust 'S'. If not 'S' and Past Date -> 'ENTREGADO' (Assumption) OR 'NO_ENTREGADO'?
                    // The user said "antes salia 100%". 
                    // Let's stick to "Past Date = Delivered" as a safety net for now, 
                    // but 'S' allows intra-day update!
                    status = 'ENTREGADO';
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
                documentoTipo: esFactura ? 'FACTURA' : 'ALBARÁN',
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

        // --- FILTERING: Search by client name, code, albarán or factura number ---
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
            filteredAlbaranes = filteredAlbaranes.filter(a => a.documentoTipo === 'ALBARÁN');
        } else if (filterDocTipo === 'FACTURA') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.documentoTipo === 'FACTURA');
        }

        // --- SORTING ---
        const sortBy = req.query.sortBy || 'default'; // 'default', 'importe_asc', 'importe_desc'
        if (sortBy === 'importe_desc') {
            filteredAlbaranes.sort((a, b) => b.importe - a.importe);
        } else if (sortBy === 'importe_asc') {
            filteredAlbaranes.sort((a, b) => a.importe - b.importe);
        }
        // 'default' keeps the original ORDER BY CAC.NUMEROALBARAN from SQL

        // Calculate totals for summary (always from unfiltered `albaranes` for accurate KPIs)
        const totalBruto = albaranes.reduce((sum, a) => sum + (a.importe || 0), 0);
        const totalACobrar = albaranes.filter(a => a.esCTR).reduce((sum, a) => sum + (a.importe || 0), 0);
        const totalOpcional = albaranes.filter(a => a.puedeCobrarse && !a.esCTR).reduce((sum, a) => sum + (a.importe || 0), 0);
        const completedCount = albaranes.filter(a => a.estado === 'ENTREGADO').length;

        const totalFiltered = filteredAlbaranes.length;
        const totalUnfiltered = albaranes.length;
        const paginatedAlbaranes = filteredAlbaranes.slice(pageOffset, pageOffset + pageLimit);

        logger.info(`[ENTREGAS] Date=${targetDate.toISOString().split('T')[0]} Repartidor=${repartidorId} → albaranes=${paginatedAlbaranes.length} (offset=${pageOffset}, limit=${pageLimit}), totalBruto=${totalBruto.toFixed(2)}, totalACobrar=${totalACobrar.toFixed(2)}, totalOpcional=${totalOpcional.toFixed(2)}, completed=${completedCount}`);

        res.json({
            success: true,
            albaranes: paginatedAlbaranes,
            total: totalFiltered,
            originalTotal: totalUnfiltered,
            limit: pageLimit,
            offset: pageOffset,
            hasMore: pageOffset + pageLimit < totalFiltered,
            resumen: {
                totalBruto: Math.round(totalBruto * 100) / 100,
                totalACobrar: Math.round(totalACobrar * 100) / 100,
                totalOpcional: Math.round(totalOpcional * 100) / 100,
                completedCount
            }
        });
    } catch (error) {
        logger.error(`Error in /pendientes: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
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
    } catch (error) {
        logger.error(`Error in /payment-conditions: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// GET /albaran/:numero/:ejercicio
// ===================================
router.get('/albaran/:numero/:ejercicio', verifyToken, async (req, res) => {
    try {
        const { numero, ejercicio } = req.params;
        const serie = req.query.serie;
        const terminal = req.query.terminal;

        // 1. Build WHERE clause with parameterized query
        const headerParams = [numero, ejercicio];
        let whereClause = `CPC.NUMEROALBARAN = ? AND CPC.EJERCICIOALBARAN = ?`;
        if (serie) { whereClause += ` AND CPC.SERIEALBARAN = ?`; headerParams.push(serie); }
        if (terminal) { whereClause += ` AND CPC.TERMINALALBARAN = ?`; headerParams.push(terminal); }

        // 2. Get Header from CPC (uses IMPORTETOTAL - correct final amount)
        const headerSql = `
            SELECT
                CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
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
                ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            LEFT JOIN DSEDAC.CAC CAC ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE ${whereClause}
            FETCH FIRST 1 ROWS ONLY
        `;

        const headers = await queryWithParams(headerSql, headerParams);
        if (headers.length === 0) return res.status(404).json({ success: false, error: 'Albaran not found' });

        // AGGREGATE: If multiple CPC rows exist for the same Albaran detail request
        // Sum the financial fields across all matching rows
        const header = { ...headers[0] };
        if (!ensureRepartidorAccess(req, res, header.CODIGO_REPARTIDOR)) return;
        if (headers.length > 1) {
            header.IMPORTE = 0;
            header.IMPORTE_BRUTO = 0;
            header.CPC_BASE1 = 0; header.CPC_BASE2 = 0; header.CPC_BASE3 = 0;
            header.CPC_IVA1 = 0; header.CPC_IVA2 = 0; header.CPC_IVA3 = 0;

            headers.forEach(h => {
                header.IMPORTE += (parseFloat(h.IMPORTE) || 0);
                header.IMPORTE_BRUTO += (parseFloat(h.IMPORTE_BRUTO) || 0);
                header.CPC_BASE1 += (parseFloat(h.CPC_BASE1) || 0);
                header.CPC_BASE2 += (parseFloat(h.CPC_BASE2) || 0);
                header.CPC_BASE3 += (parseFloat(h.CPC_BASE3) || 0);
                header.CPC_IVA1 += (parseFloat(h.CPC_IVA1) || 0);
                header.CPC_IVA2 += (parseFloat(h.CPC_IVA2) || 0);
                header.CPC_IVA3 += (parseFloat(h.CPC_IVA3) || 0);
            });
        }

        // 3. Get Items from LAC (Simplified for ODBC compatibility - NO ALIASES)
        // Parameterized query to prevent SQL injection
        const itemParams = [numero, ejercicio];
        let itemsSql = `
            SELECT
                SECUENCIA,
                CODIGOARTICULO,
                DESCRIPCION,
                CANTIDADUNIDADES,
                CANTIDADENVASES,
                CANTIDADCAJAS,
                IMPORTEVENTA,
                UNIDADMEDIDA
            FROM DSEDAC.LAC
            WHERE NUMEROALBARAN = ? AND EJERCICIOALBARAN = ?
        `;
        if (serie) { itemsSql += ` AND SERIEALBARAN = ?`; itemParams.push(serie); }
        if (terminal) { itemsSql += ` AND TERMINALALBARAN = ?`; itemParams.push(terminal); }

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
            id: `${header.EJERCICIOALBARAN}-${(header.SERIEALBARAN || '').trim()}-${header.TERMINALALBARAN}-${header.NUMEROALBARAN}`,
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
            documentoTipo: (header.NUMEROFACTURA || 0) > 0 ? 'FACTURA' : 'ALBARÁN',
            fecha: `${header.DIADOCUMENTO}/${header.MESDOCUMENTO}/${header.ANODOCUMENTO}`,
            importe: parseFloat(header.IMPORTE) || 0,
            importeBruto: parseFloat(header.IMPORTE_BRUTO) || 0,
            netoSum: netoSum,
            ivaSum: ivaSum,
            ivaBreakdown: ivaBreakdown,
            checksum: `${Math.round((netoSum + ivaSum) * 100) / 100}`,
            formaPago: (header.FORMA_PAGO || '').trim(),
            items: items.map(i => ({
                itemId: i.SECUENCIA,
                codigoArticulo: i.CODIGOARTICULO,
                descripcion: i.DESCRIPCION,
                cantidadPedida: parseFloat(i.CANTIDADUNIDADES) || 0,
                bultos: parseFloat(i.CANTIDADENVASES) || 0,
                cantidadCajas: parseFloat(i.CANTIDADCAJAS) || 0,
                totalLinea: parseFloat(i.IMPORTEVENTA) || 0,
                unidad: i.UNIDADMEDIDA,
                precioUnitario: (parseFloat(i.CANTIDADUNIDADES) || 0) !== 0 ? (parseFloat(i.IMPORTEVENTA) || 0) / parseFloat(i.CANTIDADUNIDADES) : 0,
                cantidadEntregada: 0,
                estado: 'PENDIENTE'
            })),
            estado: 'PENDIENTE'
        };

        // Discrepancy detection: compare header total vs sum of line amounts
        const lineSum = albaran.items.reduce((sum, item) => sum + item.totalLinea, 0);
        const lineSumRounded = Math.round(lineSum * 100) / 100;
        albaran.lineSum = lineSumRounded;
        albaran.discrepancy = Math.abs(albaran.importe - lineSumRounded) > 0.01;

        res.json({ success: true, albaran });
    } catch (error) {
        logger.error(`Error in /albaran: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// POST /update - Update delivery status with duplicate prevention
// ===================================
router.post('/update', verifyToken, async (req, res) => {
    try {
        const { itemId: reqItemId, albaranId, status, repartidorId, observaciones, firma, fotos, latitud, longitud, forceUpdate } = req.body;
        const itemId = reqItemId || albaranId; // Support both naming conventions

        if (!itemId || !status || !repartidorId) {
            return res.status(400).json({ success: false, error: 'Faltan datos obligatorios: itemId, status, repartidorId' });
        }
        if (!['ENTREGADO', 'EN_RUTA', 'PENDIENTE', 'NO_ENTREGADO', 'PARCIAL'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Estado no valido' });
        }
        if (!ensureRepartidorAccess(req, res, repartidorId)) return;

        const owner = await getDeliveryOwner(itemId);
        if (owner && !codesMatch(owner, repartidorId)) {
            logger.warn(`[ENTREGAS] Delivery owner mismatch item=${itemId} owner=${owner} bodyRep=${repartidorId}`);
            return res.status(403).json({
                success: false,
                error: 'La entrega no pertenece al repartidor indicado'
            });
        }

        logger.info(`[ENTREGAS] Updating ${itemId} to ${status} (Rep: ${repartidorId}, Force: ${forceUpdate || false})`);

        const dsNewSchema = isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();
        const lookupKey = dsNewSchema ? `liq_${itemId}` : itemId;
        const lookupColumn = dsNewSchema ? 'IDEMPOTENCY_TOKEN' : 'ID';

        // VALIDATION: Check if already delivered
        if (status === 'ENTREGADO') {
            try {
                const statusCol = dsNewSchema ? 'STATUS' : 'ESTADO';
                const dateCol = dsNewSchema ? 'UPDATED_AT' : 'FECHAACTUALIZACION';
                const repCol = dsNewSchema ? 'OPERADOR' : 'REPARTIDOR_ID';
                const existing = await queryWithParams(
                    `SELECT ${statusCol}, ${dateCol}, ${repCol} FROM JAVIER.DELIVERY_STATUS WHERE ${lookupColumn} = ?`,
                    [lookupKey]
                );

                if (existing.length > 0 && existing[0][statusCol] === 'ENTREGADO') {
                    if (!forceUpdate) {
                        logger.warn(`[ENTREGAS] Duplicate confirmation attempt for ${itemId}`);
                        return res.status(409).json({
                            success: false,
                            error: 'Esta entrega ya fue confirmada anteriormente',
                            alreadyDelivered: true,
                            previousRepartidor: existing[0][repCol],
                            previousDate: existing[0][dateCol]
                        });
                    }
                    logger.info(`[ENTREGAS] Force update enabled for ${itemId}`);
                }
            } catch (checkErr) {
                logger.warn(`[ENTREGAS] Check failed: ${checkErr.message}`);
            }
        }

        // Upsert into JAVIER.DELIVERY_STATUS
        let previousState = null;
        try {
            const prev = await queryWithParams(
                `SELECT ID, STATUS, ESTADO, OBSERVACIONES, FIRMA_PATH, LATITUD, LONGITUD, OPERADOR, PANTALLA_ORIGEN, REPARTIDOR_ID
                 FROM JAVIER.DELIVERY_STATUS
                 WHERE ${lookupColumn} = ?
                 FETCH FIRST 1 ROWS ONLY`,
                [lookupKey]
            );
            if (prev.length > 0) previousState = prev[0];
        } catch (_) {}

        // Delete existing
        await queryWithParams(
            `DELETE FROM JAVIER.DELIVERY_STATUS WHERE ${lookupColumn} = ?`,
            [lookupKey]
        );

        const lat = latitud || 0;
        const lon = longitud || 0;
        let inspectorId = repartidorId;
        if (inspectorId && inspectorId.length > 20) {
            inspectorId = inspectorId.substring(0, 20);
        }

        try {
            if (dsNewSchema) {
                await queryWithParams(`
                    INSERT INTO JAVIER.DELIVERY_STATUS 
                    (STATUS, LATITUD, LONGITUD, OPERADOR, PANTALLA_ORIGEN, IDEMPOTENCY_TOKEN, UPDATED_AT)
                    VALUES (?, ?, ?, ?, 'ENTREGAS', ?, CURRENT TIMESTAMP)
                `, [status, lat, lon, inspectorId, lookupKey]);
            } else {
                await queryWithParams(`
                    INSERT INTO JAVIER.DELIVERY_STATUS 
                    (ID, ESTADO, OBSERVACIONES, FIRMA_PATH, LATITUD, LONGITUD, REPARTIDOR_ID, FECHAACTUALIZACION)
                    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)
                `, [itemId, status, observaciones || '', firma || '', lat, lon, inspectorId]);
            }
        } catch (insertErr) {
            logger.error(`[ENTREGAS] INSERT failed for ${itemId}: ${insertErr.message}`);
            if (previousState) {
                try {
                    if (dsNewSchema) {
                        await queryWithParams(`
                            INSERT INTO JAVIER.DELIVERY_STATUS
                            (STATUS, LATITUD, LONGITUD, OPERADOR, PANTALLA_ORIGEN, IDEMPOTENCY_TOKEN, UPDATED_AT)
                            VALUES (?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)
                        `, [previousState.STATUS || 'PENDIENTE', previousState.LATITUD || 0, previousState.LONGITUD || 0, previousState.OPERADOR || '', previousState.PANTALLA_ORIGEN || 'ENTREGAS', lookupKey]);
                    } else {
                        await queryWithParams(`
                            INSERT INTO JAVIER.DELIVERY_STATUS
                            (ID, ESTADO, OBSERVACIONES, FIRMA_PATH, LATITUD, LONGITUD, REPARTIDOR_ID, FECHAACTUALIZACION)
                            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)
                        `, [
                            previousState.ID, previousState.ESTADO,
                            previousState.OBSERVACIONES || '',
                            previousState.FIRMA_PATH || '',
                            previousState.LATITUD || 0, previousState.LONGITUD || 0,
                            previousState.REPARTIDOR_ID || ''
                        ]);
                    }
                    logger.warn(`[ENTREGAS] Restored previous state for ${itemId}`);
                } catch (restoreErr) {
                    logger.error(`[ENTREGAS] CRITICAL: Could not restore ${itemId}: ${restoreErr.message}`);
                }
            }
            throw insertErr;
        }
        logger.info(`[ENTREGAS] ✅ Delivery ${itemId} updated to ${status} by ${inspectorId} (ReqRep: ${repartidorId})`);

        res.json({ success: true, message: 'Estado actualizado correctamente' });
    } catch (error) {
        logger.error(`[ENTREGAS] Error in /update: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// POST /uploads/photo
// ===================================
router.post('/uploads/photo', verifyToken, upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file' });
    res.json({ success: true, path: req.file.path });
});

// ===================================
// POST /uploads/signature
// ===================================
router.post('/uploads/signature', verifyToken, async (req, res) => {
    try {
        const { entregaId, firma, clientCode, dni, nombre } = req.body; // firma is base64
        if (!firma) return res.status(400).json({ success: false, error: 'No signature' });
        if (!entregaId) {
            return res.status(400).json({ success: false, error: 'entregaId obligatorio' });
        }
        const owner = await getDeliveryOwner(entregaId);
        if (!owner) {
            return res.status(404).json({
                success: false,
                error: 'Entrega no encontrada para firma'
            });
        }
        if (!canAccessRepartidor(req, owner)) {
            return res.status(403).json({
                success: false,
                error: 'No tienes permisos para firmar esta entrega'
            });
        }

        // Validate DNI format if provided
        if (dni && !isValidDniNie(dni)) {
            return res.status(400).json({ success: false, error: 'Formato de DNI/NIF no válido' });
        }

        // Create organized directory structure: /uploads/photos/YYYY/MM/
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');

        const organizedDir = path.join(photosDir, year, month);
        if (!fs.existsSync(organizedDir)) {
            await fsPromises.mkdir(organizedDir, { recursive: true });
        }

        // Clean entregaId for filename (replace special chars)
        const safeEntregaId = (entregaId || 'unknown').toString().replace(/[^a-zA-Z0-9-]/g, '_');
        const safeClientCode = (clientCode || 'CLI').toString().replace(/[^a-zA-Z0-9]/g, '');

        // Filename format: FIRMA_YYYY-MM-DD_ClientCode_EntregaId_Timestamp.png
        // Example: FIRMA_2026-02-05_12345_2026-A-1-999_1707123456789.png
        const fileName = `FIRMA_${year}-${month}-${day}_${safeClientCode}_${safeEntregaId}_${Date.now()}.png`;
        const filePath = path.join(organizedDir, fileName);

        // Relative path for database storage (easier for migrations)
        const relativePath = `${year}/${month}/${fileName}`;

        // Save base64 to file
        const base64Data = firma.replace(/^data:image\/png;base64,/, "");
        await fsPromises.writeFile(filePath, base64Data, 'base64');

        logger.info(`[SIGN] Saved signature: ${relativePath} for delivery ${entregaId}`);

        // Save Signer Info (Upsert)
        if (clientCode && dni) {
            try {
                // Upsert logic (Delete + Insert is safest fallback)
                const safeClientCode = clientCode.replace(/[^a-zA-Z0-9]/g, '');
                const safeDni = dni.replace(/[^a-zA-Z0-9]/g, '');
                const safeNombre = sanitizeForSQL(nombre || '');
                await queryWithParams(`
                    DELETE FROM JAVIER.CLIENT_SIGNERS 
                    WHERE CODIGOCLIENTE = ? AND DNI = ?
                `, [safeClientCode, safeDni]);

                await queryWithParams(`
                    INSERT INTO JAVIER.CLIENT_SIGNERS (CODIGOCLIENTE, DNI, NOMBRE, LAST_USED, USAGE_COUNT)
                    VALUES (?, ?, ?, CURRENT DATE, 1)
                `, [safeClientCode, safeDni, safeNombre]);

                logger.info(`[SIGN] Saved signer info for client ${clientCode}`);
            } catch (dbError) {
                logger.warn(`[SIGN] Failed to save signer info: ${dbError.message}`);
                // Don't fail the request just for this
            }
        }

        res.json({ success: true, path: relativePath });
    } catch (error) {
        logger.error(`[SIGN] Error saving signature: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// GET /signers/:clientCode
// ===================================
router.get('/signers/:clientCode', verifyToken, async (req, res) => {
    try {
        const { clientCode } = req.params;
        const { entregaId } = req.query;
        if (!isPrivilegedUser(req)) {
            if (!entregaId) return res.json({ success: true, signers: [] });
            const owner = await getDeliveryOwner(entregaId);
            if (!owner || !canAccessRepartidor(req, owner)) {
                return res.status(403).json({
                    success: false,
                    error: 'No tienes permisos para consultar firmantes de este cliente'
                });
            }
        }
        const rows = await queryWithParams(`
            SELECT DNI, NOMBRE
            FROM JAVIER.CLIENT_SIGNERS
            WHERE CODIGOCLIENTE = ?
            ORDER BY LAST_USED DESC
            FETCH FIRST 5 ROWS ONLY
        `, [clientCode.replace(/[^a-zA-Z0-9]/g, '')]);

        res.json({ success: true, signers: rows });
    } catch (error) {
        logger.error(`Error get signers: ${error.message}`);
        res.json({ success: true, signers: [] }); // Fail graceful
    }
});

// ===================================
// POST /receipt/:entregaId - Generate delivery receipt PDF
// ===================================
router.post('/receipt/:entregaId', verifyToken, async (req, res) => {
    try {
        const { entregaId } = req.params;
        const { signaturePath, items, clientCode, clientName, albaranNum, facturaNum, fecha, subtotal, iva, total, formaPago, repartidor, ordenPreparacion, firmante, firmanteDni } = req.body;

        const { saveReceipt } = require('../app/services/deliveryReceiptService');

        // Parse entregaId to get DB identifiers: "EJERCICIO-SERIE-TERMINAL-NUMERO"
        const parts = entregaId.split('-');
        const ejercicio = parts[0] ? parseInt(parts[0]) : null;
        const serie = parts[1] || '';
        const terminal = parts[2] ? parseInt(parts[2]) : null;
        const numero = parts[3] ? parseInt(parts[3]) : null;

        const deliveryData = {
            ejercicio, serie, terminal, numero,
            albaranNum: albaranNum || `${serie}-${terminal}-${numero}`,
            facturaNum,
            clientCode,
            clientName,
            fecha,
            items: items || [],
            subtotal: subtotal || 0,
            iva: iva || 0,
            total: total || 0,
            formaPago,
            repartidor: stripVendorCode(repartidor),
            ordenPreparacion,
            firmante,
            firmanteDni
        };

        // Resolve signature path if relative - SECURITY: prevent path traversal
        let fullSignaturePath = null;
        if (signaturePath) {
            // Validate no path traversal
            const normalizedSig = path.normalize(signaturePath).replace(/\\/g, '/');
            if (normalizedSig.includes('..') || path.isAbsolute(normalizedSig)) {
                logger.warn(`[RECEIPT] Rejected suspicious signature path: ${signaturePath}`);
                fullSignaturePath = null;
            } else {
                fullSignaturePath = path.join(photosDir, normalizedSig);
                // Verify resolved path is within photosDir
                const resolvedPath = path.resolve(fullSignaturePath);
                const resolvedBase = path.resolve(photosDir);
                if (!resolvedPath.startsWith(resolvedBase)) {
                    logger.warn(`[RECEIPT] Path traversal attempt blocked: ${signaturePath}`);
                    fullSignaturePath = null;
                } else {
                    logger.info(`[RECEIPT] Signature path: relative='${signaturePath}' full='${fullSignaturePath}' exists=${fs.existsSync(fullSignaturePath)}`);
                    if (!fs.existsSync(fullSignaturePath)) {
                        fullSignaturePath = null;
                        logger.warn(`[RECEIPT] Signature not found at path`);
                    }
                }
            }
        } else {
            logger.info(`[RECEIPT] No signature path provided for ${entregaId}`);
        }

        // Fallback: try to get signature from DB if no file found
        if (!fullSignaturePath && ejercicio && numero) {
            try {
                const dsNewSchema = isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();
                // Try DELIVERY_STATUS (OLD schema only - NEW schema has no FIRMA_PATH)
                if (!dsNewSchema) {
                    const albId = `${ejercicio}-${(serie || '').trim()}-${terminal || 0}-${numero}`;
                    const dsRows = await queryWithParams(`SELECT FIRMA_PATH FROM JAVIER.DELIVERY_STATUS WHERE ID = ?`, [albId], false);
                    if (dsRows.length > 0 && dsRows[0].FIRMA_PATH) {
                        const fpTest = path.join(photosDir, dsRows[0].FIRMA_PATH);
                        if (fs.existsSync(fpTest)) {
                            fullSignaturePath = fpTest;
                            logger.info(`[RECEIPT] Found signature via DELIVERY_STATUS: ${fpTest}`);
                        }
                    }
                }
                // Try REPARTIDOR_FIRMAS for base64 
                if (!fullSignaturePath) {
                    const firmaRows = await queryWithParams(`
                        SELECT RF.FIRMABASE64, RF.FIRMANOMBRE, RF.DIA, RF.MES, RF.ANO, RF.HORA FROM JAVIER.REPARTIDOR_FIRMAS RF
                        INNER JOIN JAVIER.REPARTIDOR_ENTREGAS RE ON RE.ID = RF.ENTREGA_ID
                        WHERE RE.NUMEROORDENPREPARACION = ?
                          AND RE.EJERCICIOALBARAN = ?
                          AND TRIM(RE.SERIEALBARAN) = ?
                        FETCH FIRST 1 ROW ONLY
                    `, [numero, ejercicio, (serie || '').trim()], false);
                    if (firmaRows.length > 0 && firmaRows[0].FIRMABASE64) {
                        deliveryData.signatureBase64 = firmaRows[0].FIRMABASE64;
                        deliveryData.firmante = firmaRows[0].FIRMANOMBRE || null;
                        logger.info(`[RECEIPT] Using base64 signature from REPARTIDOR_FIRMAS`);
                    }
                }
            } catch (e) {
                logger.warn(`[RECEIPT] DB signature fallback error: ${e.message}`);
            }
        }

        const result = await saveReceipt(deliveryData, fullSignaturePath);

        // Convert PDF to base64 for mobile sharing
        const pdfBase64 = result.buffer.toString('base64');

        logger.info(`[RECEIPT] Generated receipt for ${entregaId} (signature: ${fullSignaturePath ? 'YES' : 'NO'})`);
        res.json({
            success: true,
            pdfPath: result.relativePath,
            pdfBase64: pdfBase64,
            fileName: path.basename(result.filePath)
        });
    } catch (error) {
        logger.error(`[RECEIPT] Error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// POST /receipt/:entregaId/email - Send receipt via email
// ===================================
router.post('/receipt/:entregaId/email', verifyToken, async (req, res) => {
    try {
        const { entregaId } = req.params;
        const { email, subject, body, signaturePath, items, clientCode, clientName, albaranNum, facturaNum, fecha, subtotal, iva, total, formaPago, repartidor, ordenPreparacion, firmante, firmanteDni } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const { saveReceipt } = require('../app/services/deliveryReceiptService');
        const { sendEmailWithPdf, generateDeliveryEmailHtml } = require('../services/emailPdfService');

        // Parse entregaId for DB lookup
        const parts = entregaId.split('-');
        const ejercicio = parts[0] ? parseInt(parts[0]) : null;
        const serie = parts[1] || '';
        const terminal = parts[2] ? parseInt(parts[2]) : null;
        const numero = parts[3] ? parseInt(parts[3]) : null;

        const deliveryData = {
            ejercicio, serie, terminal, numero,
            albaranNum: albaranNum || `${serie}-${terminal}-${numero}`,
            facturaNum,
            clientCode,
            clientName,
            fecha,
            items: items || [],
            subtotal: subtotal || 0,
            iva: iva || 0,
            total: total || 0,
            formaPago,
            repartidor: stripVendorCode(repartidor),
            ordenPreparacion,
            firmante,
            firmanteDni
        };

        // Resolve signature path - SECURITY: prevent path traversal
        let fullSignaturePath = null;
        if (signaturePath) {
            const normalizedSig = path.normalize(signaturePath).replace(/\\/g, '/');
            if (normalizedSig.includes('..') || path.isAbsolute(normalizedSig)) {
                logger.warn(`[RECEIPT-EMAIL] Rejected suspicious signature path: ${signaturePath}`);
                fullSignaturePath = null;
            } else {
                fullSignaturePath = path.join(photosDir, normalizedSig);
                const resolvedPath = path.resolve(fullSignaturePath);
                const resolvedBase = path.resolve(photosDir);
                if (!resolvedPath.startsWith(resolvedBase)) {
                    logger.warn(`[RECEIPT-EMAIL] Path traversal attempt blocked: ${signaturePath}`);
                    fullSignaturePath = null;
                } else if (!fs.existsSync(fullSignaturePath)) {
                    fullSignaturePath = null;
                    logger.warn(`[RECEIPT-EMAIL] Signature not found: ${signaturePath}`);
                }
            }
        }

        const receipt = await saveReceipt(deliveryData, fullSignaturePath);
        const docNum = facturaNum || albaranNum || `${serie}-${terminal}-${numero}`;
        const pdfFilename = `Nota_Entrega_${String(docNum).replace(/[^\w.-]+/g, '_')}.pdf`;
        const emailSubject = subject || `Nota de Entrega - Albaran ${docNum}`;
        const textBody = body || `Adjunto le remitimos la nota de entrega ${docNum}.`;
        const htmlBody = generateDeliveryEmailHtml({
            serie: serie || '',
            numero: terminal !== null && numero !== null ? `${terminal}-${numero}` : docNum,
            fecha,
            total: Number(total || 0),
            clienteNombre: clientName,
            customBody: body
        });

        const emailResult = await sendEmailWithPdf({
            to: email,
            subject: emailSubject,
            htmlBody,
            textBody,
            pdfBuffer: receipt.buffer,
            pdfFilename
        });

        logger.info(`[RECEIPT] Email sent to ${email} for ${entregaId}`);
        res.json({ success: true, messageId: emailResult.messageId });
    } catch (error) {
        logger.error(`[RECEIPT] Email error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// POST /receipt/:entregaId/whatsapp - WhatsApp share with PDF base64
// ===================================
router.post('/receipt/:entregaId/whatsapp', verifyToken, async (req, res) => {
    try {
        const { entregaId } = req.params;
        const { telefono, signaturePath, items, clientCode, clientName, albaranNum, facturaNum, fecha, subtotal, iva, total, formaPago, repartidor, ordenPreparacion, firmante, firmanteDni } = req.body;

        if (!telefono) {
            return res.status(400).json({ success: false, error: 'Telefono is required' });
        }

        const { generateDeliveryReceipt } = require('../app/services/deliveryReceiptService');
        const { cachePdf, getCachedPdf } = require('../services/emailPdfService');

        // Parse entregaId for DB lookup
        const parts = entregaId.split('-');
        const ejercicio = parts[0] ? parseInt(parts[0]) : null;
        const serie = parts[1] || '';
        const terminal = parts[2] ? parseInt(parts[2]) : null;
        const numero = parts[3] ? parseInt(parts[3]) : null;

        const deliveryData = {
            ejercicio, serie, terminal, numero,
            albaranNum: albaranNum || `${serie}-${terminal}-${numero}`,
            facturaNum,
            clientCode,
            clientName,
            fecha,
            items: items || [],
            subtotal: subtotal || 0,
            iva: iva || 0,
            total: total || 0,
            formaPago,
            repartidor: stripVendorCode(repartidor),
            ordenPreparacion,
            firmante,
            firmanteDni
        };

        // Generate or retrieve cached PDF
        const cacheKey = `receipt_${entregaId}`;
        let pdfBuffer = getCachedPdf(cacheKey);

        if (!pdfBuffer) {
            // Resolve signature path - SECURITY: prevent path traversal
            let fullSignaturePath = null;
            if (signaturePath) {
                const normalizedSig = path.normalize(signaturePath).replace(/\\/g, '/');
                if (normalizedSig.includes('..') || path.isAbsolute(normalizedSig)) {
                    logger.warn(`[RECEIPT-WHATSAPP] Rejected suspicious signature path: ${signaturePath}`);
                    fullSignaturePath = null;
                } else {
                    fullSignaturePath = path.join(photosDir, normalizedSig);
                    const resolvedPath = path.resolve(fullSignaturePath);
                    const resolvedBase = path.resolve(photosDir);
                    if (!resolvedPath.startsWith(resolvedBase)) {
                        logger.warn(`[RECEIPT-WHATSAPP] Path traversal attempt blocked: ${signaturePath}`);
                        fullSignaturePath = null;
                    } else if (!fs.existsSync(fullSignaturePath)) {
                        fullSignaturePath = null;
                        logger.warn(`[RECEIPT-WHATSAPP] Signature not found: ${signaturePath}`);
                    }
                }
            }

            pdfBuffer = await generateDeliveryReceipt(deliveryData, fullSignaturePath);
            if (pdfBuffer) {
                cachePdf(cacheKey, pdfBuffer);
            }
        }

        if (!pdfBuffer) {
            return res.status(500).json({ success: false, error: 'No se pudo generar el PDF de la entrega' });
        }

        // Convert PDF to base64 for Flutter to share as document
        const pdfBase64 = pdfBuffer.toString('base64');
        const docNum = facturaNum || albaranNum || `${serie}-${terminal}-${numero}`;
        const pdfFilename = `Nota_Entrega_${docNum}.pdf`;

        // Generate WhatsApp message
        const message = `Granja Mari Pepa - Entrega\n\n` +
            `Albaran: ${docNum}\n` +
            `Fecha: ${fecha || 'N/A'}\n` +
            `Total: ${(total || 0).toFixed(2)} EUR\n\n` +
            `Cliente: ${clientName || 'Cliente'}\n\n` +
            `Gracias por su confianza.`;

        const phoneClean = telefono.replace(/\D/g, '');
        const whatsappUrl = `https://wa.me/${phoneClean}?text=${encodeURIComponent(message)}`;

        logger.info(`[RECEIPT] WhatsApp generated: ${docNum} to ${phoneClean}`);

        res.json({
            success: true,
            whatsappUrl,
            message,
            pdfBase64,
            pdfFilename,
            mimeType: 'application/pdf'
        });
    } catch (error) {
        logger.error(`[RECEIPT] WhatsApp error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

