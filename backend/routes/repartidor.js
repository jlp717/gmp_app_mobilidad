/**
 * REPARTIDOR ROUTES
 * Backend endpoints for repartidor-specific functionality
 * - Collections (cobros) from DSEDAC.CAC/CVC
 * - Commissions with 30% threshold logic
 * - Historical deliveries and signatures
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const logger = require('../middleware/logger');
const { sanitizeCodeListForParams, sanitizeForSQL, chunkedInQuery } = require('../utils/common');
const { generateInvoicePDF } = require('../app/services/pdfService');
const { isDeliveryStatusAvailable, isDeliveryStatusNewSchema, getDeliveryStatusJoin, getDeliveryStatusColumns } = require('../utils/delivery-status-check');
const { sendEmailWithPdf, generateInvoiceEmailHtml, generateDeliveryEmailHtml, cachePdf, getCachedPdf } = require('../services/emailPdfService');
const { verifyToken } = require('../middleware/auth');
const { CircuitBreaker: RepartidorCircuitBreaker } = require('../services/circuit-breaker');

const repartidorBreaker = new RepartidorCircuitBreaker({
    name: 'repartidor',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 10000
});
const REPARTIDOR_PDF_CACHE_VERSION = 'v2';
const { generateDeliveryReceipt } = require('../app/services/deliveryReceiptService');
const facturasService = require('../services/facturas.service');
const pdfService = require('../services/pdf.service');

const PRIVILEGED_REPARTIDOR_ROLES = new Set(['ADMIN', 'JEFE_VENTAS']);
const REPARTIDOR_READ_PAGE_MAX = 100;

function sendRouteError(res, status, code) {
    return res.status(status).json({ success: false, code, error: 'No se pudo completar la solicitud' });
}

function parseBoundedInt(value, { min, max, name, fallback }) {
    if (value === undefined || value === null || value === '') return { value: fallback };
    if (!/^\d+$/.test(String(value))) return { error: `${name}_INVALID` };
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return { error: `${name}_INVALID` };
    return { value: parsed };
}

function parseIsoDate(value, name) {
    if (!value) return { value: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: `${name}_INVALID` };
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return { error: `${name}_INVALID` };
    return { value: Number(value.replace(/-/g, '')) };
}

function parsePagination(query, defaultLimit = REPARTIDOR_READ_PAGE_MAX, maxOffset = REPARTIDOR_READ_PAGE_MAX) {
    const limit = parseBoundedInt(query.limit, {
        min: 1,
        max: REPARTIDOR_READ_PAGE_MAX,
        name: 'LIMIT',
        fallback: defaultLimit
    });
    const offset = parseBoundedInt(query.offset, {
        min: 0,
        max: maxOffset,
        name: 'OFFSET',
        fallback: 0
    });
    return { limit, offset };
}

function authorizedRepartidorIds(req, res, rawIds) {
    const rawParts = String(rawIds || '').split(',').map((id) => id.trim()).filter(Boolean);
    const ids = [...new Set(rawParts)];
    if (ids.length > REPARTIDOR_READ_PAGE_MAX || ids.some((id) => !/^[A-Za-z0-9]{1,2}$/.test(id))) {
        sendRouteError(res, 400, 'REPARTIDOR_ID_INVALID');
        return null;
    }
    if (!ids.length) {
        sendRouteError(res, 400, 'REPARTIDOR_ID_INVALID');
        return null;
    }
    const user = req.user;
    if (!user) {
        sendRouteError(res, 401, 'AUTH_REQUIRED');
        return null;
    }
    const role = String(user.role || '').trim().toUpperCase();
    if (PRIVILEGED_REPARTIDOR_ROLES.has(role)) return ids;
    if (role !== 'REPARTIDOR') {
        sendRouteError(res, 403, 'REPARTIDOR_ACCESS_DENIED');
        return null;
    }
    const ownIds = String(user.code || user.id || '').trim();
    if (ids.length !== 1 || !/^[A-Za-z0-9]{1,2}$/.test(ownIds) || ids[0] !== ownIds) {
        sendRouteError(res, 403, 'REPARTIDOR_ACCESS_DENIED');
        return null;
    }
    return ids;
}

function parseAlbaranOwnershipKey(source) {
    const year = parseBoundedInt(source.year ?? source.ejercicio, { min: 2000, max: 2100, name: 'YEAR', fallback: null });
    const terminal = parseBoundedInt(source.terminal, { min: 0, max: 9999, name: 'TERMINAL', fallback: null });
    const number = parseBoundedInt(source.number ?? source.numero, { min: 1, max: 999999999, name: 'NUMBER', fallback: null });
    const series = String(source.series ?? source.serie ?? '').trim().toUpperCase();
    if (year.error || terminal.error || number.error || year.value === null || terminal.value === null || number.value === null || !/^[A-Z0-9]{1,3}$/.test(series)) {
        return null;
    }
    return { year: year.value, series, terminal: terminal.value, number: number.value };
}

function parseInvoiceOwnershipKey(source) {
    const year = parseBoundedInt(source.year ?? source.ejercicio, { min: 2000, max: 2100, name: 'YEAR', fallback: null });
    const number = parseBoundedInt(source.number ?? source.numero, { min: 1, max: 999999999, name: 'NUMBER', fallback: null });
    const series = String(source.series ?? source.serie ?? '').trim().toUpperCase();
    if (year.error || number.error || year.value === null || number.value === null || !/^[A-Z0-9]{1,3}$/.test(series)) {
        return null;
    }
    return { year: year.value, series, number: number.value };
}

async function resolveAlbaranOwners(key) {
    return queryWithParams(`
        SELECT DISTINCT TRIM(OPP.CODIGOREPARTIDOR) AS OWNER_ID
        FROM DSEDAC.CPC CPC
        INNER JOIN DSEDAC.OPP OPP
            ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            AND CPC.SUBEMPRESA = OPP.SUBEMPRESA
            AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
        WHERE CPC.EJERCICIOALBARAN = ?
          AND TRIM(CPC.SERIEALBARAN) = ?
          AND CPC.TERMINALALBARAN = ?
          AND CPC.NUMEROALBARAN = ?
        FETCH FIRST 2 ROWS ONLY
    `, [key.year, key.series, key.terminal, key.number], false);
}

async function resolveInvoiceOwners(key) {
    return queryWithParams(`
        SELECT DISTINCT TRIM(OPP.CODIGOREPARTIDOR) AS OWNER_ID
        FROM DSEDAC.CAC CAC
        INNER JOIN DSEDAC.CPC CPC
            ON CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
            AND TRIM(CPC.SERIEALBARAN) = TRIM(CAC.SERIEALBARAN)
            AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
            AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
        INNER JOIN DSEDAC.OPP OPP
            ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            AND CPC.SUBEMPRESA = OPP.SUBEMPRESA
            AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
        WHERE CAC.EJERCICIOFACTURA = ?
          AND TRIM(CAC.SERIEFACTURA) = ?
          AND CAC.NUMEROFACTURA = ?
        FETCH FIRST 2 ROWS ONLY
    `, [key.year, key.series, key.number], false);
}

async function resolveDeliveryOwners(entregaId) {
    return queryWithParams(`
        SELECT DISTINCT TRIM(CODIGOREPARTIDOR) AS OWNER_ID
        FROM JAVIER.REPARTIDOR_ENTREGAS
        WHERE ID = ?
        FETCH FIRST 2 ROWS ONLY
    `, [entregaId], false);
}

function authorizeResolvedOwner(req, res, rows) {
    const owners = [...new Set((rows || []).map((row) => String(row.OWNER_ID || '').trim()).filter(Boolean))];
    if (owners.length === 0) {
        sendRouteError(res, 404, 'DOCUMENT_NOT_FOUND');
        return false;
    }
    if (owners.length > 1) {
        sendRouteError(res, 409, 'DOCUMENT_OWNER_AMBIGUOUS');
        return false;
    }
    const role = String(req.user?.role || '').trim().toUpperCase();
    if (PRIVILEGED_REPARTIDOR_ROLES.has(role)) {
        req.documentOwnerId = owners[0];
        return true;
    }
    const ownId = String(req.user?.code || req.user?.id || '').trim();
    if (role !== 'REPARTIDOR' || !/^[A-Za-z0-9]{1,2}$/.test(ownId) || ownId !== owners[0]) {
        sendRouteError(res, 403, 'DOCUMENT_ACCESS_DENIED');
        return false;
    }
    req.documentOwnerId = owners[0];
    return true;
}

function documentOwnershipGuard(keyParser, ownerResolver, sourceSelector) {
    return async (req, res, next) => {
        const key = keyParser(sourceSelector(req));
        if (!key) return sendRouteError(res, 422, 'DOCUMENT_KEY_INVALID');
        try {
            const rows = await ownerResolver(key);
            if (!authorizeResolvedOwner(req, res, rows)) return;
            req.documentOwnershipKey = key;
            return next();
        } catch (_error) {
            logger.error('[REPARTIDOR] Document ownership lookup failed');
            return sendRouteError(res, 503, 'DOCUMENT_OWNER_LOOKUP_FAILED');
        }
    };
}

const albaranQueryOwnership = documentOwnershipGuard(parseAlbaranOwnershipKey, resolveAlbaranOwners, (req) => req.query);
const albaranParamOwnership = documentOwnershipGuard(parseAlbaranOwnershipKey, resolveAlbaranOwners, (req) => req.params);
const invoiceParamOwnership = documentOwnershipGuard(parseInvoiceOwnershipKey, resolveInvoiceOwners, (req) => req.params);
const documentBodyOwnership = documentOwnershipGuard(
    (body) => String(body.type || 'albaran').toLowerCase() === 'factura'
        ? parseInvoiceOwnershipKey(body)
        : String(body.type || 'albaran').toLowerCase() === 'albaran'
            ? parseAlbaranOwnershipKey(body)
            : null,
    async (key) => Object.prototype.hasOwnProperty.call(key, 'terminal')
        ? resolveAlbaranOwners(key)
        : resolveInvoiceOwners(key),
    (req) => req.body || {}
);

async function deliveryOwnership(req, res, next) {
    const entregaId = String(req.params.entregaId || '').trim();
    if (!/^\d{1,18}$/.test(entregaId)) return sendRouteError(res, 422, 'DELIVERY_ID_INVALID');
    try {
        const rows = await resolveDeliveryOwners(entregaId);
        if (!authorizeResolvedOwner(req, res, rows)) return;
        return next();
    } catch (_error) {
        logger.error('[REPARTIDOR] Delivery ownership lookup failed');
        return sendRouteError(res, 503, 'DOCUMENT_OWNER_LOOKUP_FAILED');
    }
}

async function legacySignatureOwnership(req, res, next) {
    const parts = String(req.params.id || '').split('-');
    const key = parts.length === 4
        ? parseAlbaranOwnershipKey({ year: parts[0], series: parts[1], terminal: parts[2], number: parts[3] })
        : null;
    if (!key) return sendRouteError(res, 422, 'DOCUMENT_KEY_INVALID');
    try {
        const rows = await resolveAlbaranOwners(key);
        if (!authorizeResolvedOwner(req, res, rows)) return;
        req.documentOwnershipKey = key;
        return next();
    } catch (_error) {
        logger.error('[REPARTIDOR] Legacy signature ownership lookup failed');
        return sendRouteError(res, 503, 'DOCUMENT_OWNER_LOOKUP_FAILED');
    }
}
function canonicalRepartoMutationRequired(_req, res) {
    return res.status(410).json({
        success: false,
        code: 'CANONICAL_REPARTO_ROUTE_REQUIRED',
        error: 'Usa POST /api/repartidor-finanzas/rutero/confirm-delivery-cobro',
    });
}

// Legacy write endpoints are permanently retired. Canonical confirmation and
// finance routes own every repartidor mutation and expose idempotent contracts.
router.post('/entregas', verifyToken, canonicalRepartoMutationRequired);
router.post('/entregas/:entregaId/firma', verifyToken, canonicalRepartoMutationRequired);
router.post('/entregas/:entregaId/lineas', verifyToken, canonicalRepartoMutationRequired);
router.post('/cobros', verifyToken, canonicalRepartoMutationRequired);
// Ownership gates resolve a unique
// document owner from the complete document key before any signature, PDF or
// sharing work can execute.
router.get('/history/signature', verifyToken, albaranQueryOwnership);
router.get('/entregas/:entregaId/firma', verifyToken, deliveryOwnership);
router.get('/history/legacy-signature/:id', verifyToken, legacySignatureOwnership);
router.get('/document/albaran/:year/:serie/:terminal/:number/pdf', verifyToken, albaranParamOwnership);
router.get('/document/invoice/:year/:serie/:number/pdf', verifyToken, invoiceParamOwnership);
router.post('/document/send-email', verifyToken, documentBodyOwnership);
router.post('/document/share/whatsapp', verifyToken, documentBodyOwnership);

// Commission configuration (30% threshold for repartidores)
const REPARTIDOR_CONFIG = {
    threshold: 30.0, // 30% minimum to earn commission
    tiers: [
        { min: 100.01, max: 103.00, pct: 1.0 },
        { min: 103.01, max: 106.00, pct: 1.3 },
        { min: 106.01, max: 110.00, pct: 1.6 },
        { min: 110.01, max: 999.99, pct: 2.0 }
    ]
};

// =============================================================================
// GET /collections/summary/:repartidorId
// Resumen de cobros por cliente para un repartidor
// =============================================================================
router.get('/collections/summary/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, month } = req.query;

        const yearResult = parseBoundedInt(year, { min: 2000, max: 2100, name: 'YEAR', fallback: new Date().getFullYear() });
        const monthResult = parseBoundedInt(month, { min: 1, max: 12, name: 'MONTH', fallback: new Date().getMonth() + 1 });
        if (yearResult.error || monthResult.error) return sendRouteError(res, 422, yearResult.error || monthResult.error);
        const selectedYear = yearResult.value;
        const selectedMonth = monthResult.value;
        const repartidorParams = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorParams) return;

        const repartidorKey = repartidorParams.join(',');
        logger.info(`[REPARTIDOR] Getting collections summary for ${repartidorKey} (${selectedMonth}/${selectedYear})`);

        const cacheKey = `repartidor:collections:summary:${repartidorKey}:${selectedYear}:${selectedMonth}`;

        // CVC can contain repeated physical rows for the same instalment. Build
        // one CPC document and one CVC instalment first, then aggregate. A
        // missing CVC document is not evidence that the invoice was paid.
        const sql = `
            WITH SOURCE_DOCUMENTS AS (
                SELECT
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) AS NOMBRE_CLIENTE,
                    TRIM(CPC.CODIGOFORMAPAGO) AS FORMA_PAGO,
                    CPC.IMPORTETOTAL,
                    ROW_NUMBER() OVER (
                        PARTITION BY CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                            TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN,
                            CPC.NUMEROALBARAN, TRIM(CPC.CODIGOCLIENTEALBARAN)
                        ORDER BY OPP.SUBEMPRESA, OPP.EJERCICIOORDENPREPARACION,
                            OPP.NUMEROORDENPREPARACION
                    ) AS DOCUMENT_RANK
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESA = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                LEFT JOIN DSEDAC.CLI CLI
                    ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
                WHERE OPP.MESREPARTO = ?
                  AND OPP.ANOREPARTO = ?
                  AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorParams.map(() => '?').join(',')})
            ),
            UNIQUE_DOCUMENTS AS (
                SELECT * FROM SOURCE_DOCUMENTS WHERE DOCUMENT_RANK = 1
            ),
            CVC_INSTALLMENTS AS (
                SELECT
                    TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
                    TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
                    TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
                    CVC.EJERCICIODOCUMENTO,
                    TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
                    CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO,
                    COALESCE(CVC.XDEDOCUMENTO, 1) AS XDEDOCUMENTO,
                    COALESCE(CVC.DEXDOCUMENTO, 1) AS DEXDOCUMENTO,
                    TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    MAX(COALESCE(CVC.IMPORTECANCELADO, 0)) AS IMPORTE_COBRADO,
                    MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0)) AS IMPORTE_PENDIENTE,
                    CASE
                        WHEN MIN(COALESCE(CVC.IMPORTECANCELADO, 0)) <> MAX(COALESCE(CVC.IMPORTECANCELADO, 0))
                          OR MIN(COALESCE(CVC.IMPORTEPENDIENTE, 0)) <> MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0))
                        THEN 1 ELSE 0
                    END AS AMBIGUOUS_INSTALLMENT
                FROM DSEDAC.CVC CVC
                INNER JOIN UNIQUE_DOCUMENTS DOC
                    ON TRIM(CVC.TIPODOCUMENTO) = 'CAC'
                    AND TRIM(CVC.ORIGENDOCUMENTO) = 'B'
                    AND TRIM(CVC.SUBEMPRESADOCUMENTO) = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND TRIM(CVC.SERIEDOCUMENTO) = DOC.SERIEALBARAN
                    AND CVC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND TRIM(CVC.CODIGOCLIENTEALBARAN) = DOC.CLIENTE
                WHERE COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
                GROUP BY CVC.TIPODOCUMENTO, CVC.ORIGENDOCUMENTO,
                    CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO,
                    CVC.SERIEDOCUMENTO, CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO, CVC.XDEDOCUMENTO,
                    CVC.DEXDOCUMENTO, CVC.CODIGOCLIENTEALBARAN
            ),
            CVC_DOCUMENTS AS (
                SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE,
                    SUM(IMPORTE_COBRADO) AS IMPORTE_COBRADO,
                    SUM(IMPORTE_PENDIENTE) AS IMPORTE_PENDIENTE,
                    SUM(AMBIGUOUS_INSTALLMENT) AS AMBIGUOUS_INSTALLMENTS
                FROM CVC_INSTALLMENTS
                GROUP BY SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE
            )
            SELECT
                DOC.CLIENTE,
                DOC.NOMBRE_CLIENTE,
                DOC.FORMA_PAGO,
                SUM(DOC.IMPORTETOTAL) AS TOTAL_COBRABLE,
                SUM(CVC_DOC.IMPORTE_COBRADO) AS TOTAL_COBRADO,
                SUM(CVC_DOC.IMPORTE_PENDIENTE) AS TOTAL_PENDIENTE,
                COUNT(*) AS NUM_DOCUMENTOS,
                SUM(CASE WHEN CVC_DOC.NUMERODOCUMENTO IS NULL THEN 0 ELSE 1 END) AS CVC_DOCUMENTOS,
                SUM(CASE WHEN COALESCE(CVC_DOC.AMBIGUOUS_INSTALLMENTS, 0) > 0 THEN 1 ELSE 0 END) AS CVC_AMBIGUOUS_DOCUMENTS
            FROM UNIQUE_DOCUMENTS DOC
            LEFT JOIN CVC_DOCUMENTS CVC_DOC
                ON CVC_DOC.SUBEMPRESADOCUMENTO = TRIM(DOC.SUBEMPRESAALBARAN)
                AND CVC_DOC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                AND CVC_DOC.SERIEDOCUMENTO = DOC.SERIEALBARAN
                AND CVC_DOC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                AND CVC_DOC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                AND CVC_DOC.CLIENTE = DOC.CLIENTE
            GROUP BY DOC.CLIENTE, DOC.NOMBRE_CLIENTE, DOC.FORMA_PAGO
            ORDER BY TOTAL_COBRABLE DESC
            FETCH FIRST 100 ROWS ONLY
        `;

        const sqlParams = [selectedMonth, selectedYear, ...repartidorParams];

        let rows = [];
        try {
            rows = await cachedQuery(queryWithParams, sql, cacheKey, TTL.MEDIUM, sqlParams) || [];
        } catch (_queryError) {
            logger.warn('[REPARTIDOR] Query error in collections/summary');
            return sendRouteError(res, 503, 'REPARTIDOR_DATA_UNAVAILABLE');
        }
        if (rows.some((row) =>
            Number(row.CVC_DOCUMENTOS || 0) !== Number(row.NUM_DOCUMENTOS || 0) ||
            Number(row.CVC_AMBIGUOUS_DOCUMENTS || 0) > 0
        )) {
            return sendRouteError(res, 503, 'REPARTIDOR_COLLECTION_DATA_INCOMPLETE');
        }

        // Calculate commissions for each client
        const clients = rows.map(row => {
            const collectable = parseFloat(row.TOTAL_COBRABLE) || 0;
            const collected = parseFloat(row.TOTAL_COBRADO) || 0;
            const pending = parseFloat(row.TOTAL_PENDIENTE) || 0;
            const percentage = collectable > 0 ? (collected / collectable) * 100 : 0;
            const thresholdMet = percentage >= REPARTIDOR_CONFIG.threshold;

            // Only calculate commission if threshold met AND > 100%
            let commission = 0;
            let tier = 0;
            if (thresholdMet && percentage > 100) {
                const excess = collected - collectable;
                for (const t of REPARTIDOR_CONFIG.tiers) {
                    if (percentage >= t.min && percentage <= t.max) {
                        commission = excess * (t.pct / 100);
                        tier = REPARTIDOR_CONFIG.tiers.indexOf(t) + 1;
                        break;
                    }
                }
            }

            // Map forma pago
            const fp = String(row.FORMA_PAGO || '').toUpperCase();
            let paymentType = 'Otro';
            if (fp.includes('CTR') || fp.includes('CONTADO')) paymentType = 'Contado';
            else if (fp.includes('REP')) paymentType = 'Reposición';
            else if (fp.includes('MEN')) paymentType = 'Mensual';

            return {
                clientId: row.CLIENTE,
                clientName: row.NOMBRE_CLIENTE || row.CLIENTE,
                collectable,
                collected,
                pending,
                collectionAvailability: 'AVAILABLE',
                percentage: parseFloat(percentage.toFixed(2)),
                thresholdMet,
                thresholdProgress: Math.min(percentage / REPARTIDOR_CONFIG.threshold, 1),
                commission: parseFloat(commission.toFixed(2)),
                tier,
                paymentType,
                numDocuments: row.NUM_DOCUMENTOS
            };
        });

        // Calculate totals
        const totalCollectable = clients.reduce((sum, c) => sum + c.collectable, 0);
        const totalCollected = clients.reduce((sum, c) => sum + c.collected, 0);
        const totalCommission = clients.reduce((sum, c) => sum + c.commission, 0);
        const overallPercentage = totalCollectable > 0 ? (totalCollected / totalCollectable) * 100 : 0;

        res.json({
            success: true,
            repartidorId,
            period: { year: selectedYear, month: selectedMonth },
            summary: {
                totalCollectable: parseFloat(totalCollectable.toFixed(2)),
                totalCollected: parseFloat(totalCollected.toFixed(2)),
                totalCommission: parseFloat(totalCommission.toFixed(2)),
                overallPercentage: parseFloat(overallPercentage.toFixed(2)),
                thresholdMet: overallPercentage >= REPARTIDOR_CONFIG.threshold,
                clientCount: clients.length
            },
            collectionAvailability: 'AVAILABLE',
            clients
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in collections/summary');
        sendRouteError(res, 503, 'REPARTIDOR_SUMMARY_FAILED');
    }
});

// =============================================================================
// GET /collections/daily/:repartidorId
// Acumulado diario de cobros del mes
// =============================================================================
router.get('/collections/daily/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, month } = req.query;

        const yearResult = parseBoundedInt(year, { min: 2000, max: 2100, name: 'YEAR', fallback: new Date().getFullYear() });
        const monthResult = parseBoundedInt(month, { min: 1, max: 12, name: 'MONTH', fallback: new Date().getMonth() + 1 });
        if (yearResult.error || monthResult.error) return sendRouteError(res, 422, yearResult.error || monthResult.error);
        const selectedYear = yearResult.value;
        const selectedMonth = monthResult.value;

        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        const repartidorKey = repartidorIdList.join(',');
        logger.info(`[REPARTIDOR] Getting daily collections for ${repartidorKey}`);

        const cacheKey = `repartidor:collections:daily:${repartidorKey}:${selectedYear}:${selectedMonth}`;

        const sql = `
            WITH SOURCE_DOCUMENTS AS (
                SELECT
                    OPP.DIAREPARTO AS DIA,
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    CPC.IMPORTETOTAL,
                    ROW_NUMBER() OVER (
                        PARTITION BY CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                            TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN,
                            CPC.NUMEROALBARAN, TRIM(CPC.CODIGOCLIENTEALBARAN)
                        ORDER BY OPP.DIAREPARTO, OPP.SUBEMPRESA,
                            OPP.EJERCICIOORDENPREPARACION, OPP.NUMEROORDENPREPARACION
                    ) AS DOCUMENT_RANK
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESA = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                WHERE OPP.ANOREPARTO = ?
                  AND OPP.MESREPARTO = ?
                  AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorIdList.map(() => '?').join(',')})
            ),
            UNIQUE_DOCUMENTS AS (
                SELECT * FROM SOURCE_DOCUMENTS WHERE DOCUMENT_RANK = 1
            ),
            CVC_INSTALLMENTS AS (
                SELECT
                    TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
                    TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
                    TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
                    CVC.EJERCICIODOCUMENTO,
                    TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
                    CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO,
                    COALESCE(CVC.XDEDOCUMENTO, 1) AS XDEDOCUMENTO,
                    COALESCE(CVC.DEXDOCUMENTO, 1) AS DEXDOCUMENTO,
                    TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    MAX(COALESCE(CVC.IMPORTECANCELADO, 0)) AS IMPORTE_COBRADO,
                    MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0)) AS IMPORTE_PENDIENTE,
                    CASE
                        WHEN MIN(COALESCE(CVC.IMPORTECANCELADO, 0)) <> MAX(COALESCE(CVC.IMPORTECANCELADO, 0))
                          OR MIN(COALESCE(CVC.IMPORTEPENDIENTE, 0)) <> MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0))
                        THEN 1 ELSE 0
                    END AS AMBIGUOUS_INSTALLMENT
                FROM DSEDAC.CVC CVC
                INNER JOIN UNIQUE_DOCUMENTS DOC
                    ON TRIM(CVC.TIPODOCUMENTO) = 'CAC'
                    AND TRIM(CVC.ORIGENDOCUMENTO) = 'B'
                    AND TRIM(CVC.SUBEMPRESADOCUMENTO) = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND TRIM(CVC.SERIEDOCUMENTO) = DOC.SERIEALBARAN
                    AND CVC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND TRIM(CVC.CODIGOCLIENTEALBARAN) = DOC.CLIENTE
                WHERE COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
                GROUP BY CVC.TIPODOCUMENTO, CVC.ORIGENDOCUMENTO,
                    CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO,
                    CVC.SERIEDOCUMENTO, CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO, CVC.XDEDOCUMENTO,
                    CVC.DEXDOCUMENTO, CVC.CODIGOCLIENTEALBARAN
            ),
            CVC_DOCUMENTS AS (
                SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE,
                    SUM(IMPORTE_COBRADO) AS IMPORTE_COBRADO,
                    SUM(IMPORTE_PENDIENTE) AS IMPORTE_PENDIENTE,
                    SUM(AMBIGUOUS_INSTALLMENT) AS AMBIGUOUS_INSTALLMENTS
                FROM CVC_INSTALLMENTS
                GROUP BY SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE
            )
            SELECT
                DOC.DIA,
                SUM(DOC.IMPORTETOTAL) AS TOTAL_COBRABLE,
                SUM(CVC_DOC.IMPORTE_COBRADO) AS TOTAL_COBRADO,
                SUM(CVC_DOC.IMPORTE_PENDIENTE) AS TOTAL_PENDIENTE,
                COUNT(*) AS NUM_DOCUMENTOS,
                SUM(CASE WHEN CVC_DOC.NUMERODOCUMENTO IS NULL THEN 0 ELSE 1 END) AS CVC_DOCUMENTOS,
                SUM(CASE WHEN COALESCE(CVC_DOC.AMBIGUOUS_INSTALLMENTS, 0) > 0 THEN 1 ELSE 0 END) AS CVC_AMBIGUOUS_DOCUMENTS
            FROM UNIQUE_DOCUMENTS DOC
            LEFT JOIN CVC_DOCUMENTS CVC_DOC
                ON CVC_DOC.SUBEMPRESADOCUMENTO = TRIM(DOC.SUBEMPRESAALBARAN)
                AND CVC_DOC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                AND CVC_DOC.SERIEDOCUMENTO = DOC.SERIEALBARAN
                AND CVC_DOC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                AND CVC_DOC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                AND CVC_DOC.CLIENTE = DOC.CLIENTE
            GROUP BY DOC.DIA
            ORDER BY DOC.DIA
        `;

        let rows = [];
        try {
            rows = await cachedQuery(queryWithParams, sql, cacheKey, TTL.MEDIUM, [selectedYear, selectedMonth, ...repartidorIdList]) || [];
        } catch (_queryError) {
            logger.warn('[REPARTIDOR] Query error in collections/daily');
            return sendRouteError(res, 503, 'REPARTIDOR_DATA_UNAVAILABLE');
        }
        if (rows.some((row) =>
            Number(row.CVC_DOCUMENTOS || 0) !== Number(row.NUM_DOCUMENTOS || 0) ||
            Number(row.CVC_AMBIGUOUS_DOCUMENTS || 0) > 0
        )) {
            return sendRouteError(res, 503, 'REPARTIDOR_COLLECTION_DATA_INCOMPLETE');
        }

        const daily = rows.map(row => ({
            day: row.DIA,
            date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(row.DIA).padStart(2, '0')}`,
            collectable: parseFloat(row.TOTAL_COBRABLE) || 0,
            collected: parseFloat(row.TOTAL_COBRADO) || 0,
            pending: parseFloat(row.TOTAL_PENDIENTE) || 0,
            collectionAvailability: 'AVAILABLE'
        }));

        res.json({
            success: true,
            collectionAvailability: 'AVAILABLE',
            daily
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in collections/daily');
        sendRouteError(res, 503, 'REPARTIDOR_DAILY_FAILED');
    }
});



// =============================================================================
// GET /history/documents/:clientId
// Historial de documentos (albaranes/facturas) de un cliente
// FIX: GROUP BY to eliminate duplicates, JOIN DELIVERY_STATUS for real status
// =============================================================================
router.get('/history/documents/:clientId', verifyToken, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { repartidorId, limit, offset, dateFrom, dateTo, year } = req.query;
        if (!repartidorId) return sendRouteError(res, 400, 'REPARTIDOR_ID_REQUIRED');

        const yearResult = parseBoundedInt(year, { min: 2000, max: 2100, name: 'YEAR', fallback: null });
        const dateFromResult = parseIsoDate(dateFrom, 'DATE_FROM');
        const dateToResult = parseIsoDate(dateTo, 'DATE_TO');
        // Keep the endpoint's own nextOffset values reusable across long
        // histories while retaining a finite bound against abusive scans.
        const pagination = parsePagination({ limit, offset }, 50, 1000000);
        const validationError = yearResult.error || dateFromResult.error || dateToResult.error || pagination.limit.error || pagination.offset.error;
        if (validationError) return sendRouteError(res, 422, validationError);
        if (dateFromResult.value && dateToResult.value && dateFromResult.value > dateToResult.value) {
            return sendRouteError(res, 422, 'DATE_RANGE_INVALID');
        }

        logger.info(`[REPARTIDOR] Getting documents for client ${clientId}`);

        let repartidorJoin = '';
        const repartidorParams = [];
        const ids = authorizedRepartidorIds(req, res, repartidorId);
        if (!ids) return;
        repartidorParams.push(...ids);
        repartidorJoin = `
            INNER JOIN DSEDAC.OPP OPP
                ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
                AND OPP.SUBEMPRESA = CPC.SUBEMPRESA
                AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
                AND TRIM(OPP.CODIGOREPARTIDOR) IN (${ids.map(() => '?').join(',')})`;

        // Date range filter (YYYY-MM-DD format)
        let dateFilter = '';
        const dateParams = [];
        if (dateFromResult.value) {
            dateFilter += ` AND (CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) >= ?`;
            dateParams.push(dateFromResult.value);
        }
        if (dateToResult.value) {
            dateFilter += ` AND (CPC.ANODOCUMENTO * 10000 + CPC.MESDOCUMENTO * 100 + CPC.DIADOCUMENTO) <= ?`;
            dateParams.push(dateToResult.value);
        }

        const pageLimit = pagination.limit.value;
        const pageOffset = pagination.offset.value;
        const clientCode = clientId;

        // Conditionally include DELIVERY_STATUS join (auto-detects OLD vs NEW schema)
        const dsJoin = getDeliveryStatusJoin('CPC', 'DS');
        const dsCols = getDeliveryStatusColumns('DS');
        const dsAvail = isDeliveryStatusAvailable();

        let yearFilter = '';
        const yearFilterParams = [];
        if (yearResult.value) {
            yearFilter = ` AND CPC.EJERCICIOALBARAN = ?`;
            yearFilterParams.push(yearResult.value);
        }

        const sql = `
            WITH SOURCE_DOCUMENTS AS (
                SELECT
                    CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,
                    CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                    CPC.ANODOCUMENTO AS ANO, CPC.MESDOCUMENTO AS MES,
                    CPC.DIADOCUMENTO AS DIA,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTEALBARAN,
                    CPC.IMPORTETOTAL,
                    CAC_J.IMPORTETOTAL AS IMPORTETOTAL_FACTURA,
                    CPC.CONFORMADOSN, CPC.SITUACIONALBARAN,
                    CPC.HORALLEGADA, CPC.HORACREACION,
                    ${dsCols},
                    COALESCE(CAC_J.NUMEROFACTURA, 0) AS NUMEROFACTURA,
                    COALESCE(TRIM(CAC_J.SERIEFACTURA), '') AS SERIEFACTURA,
                    COALESCE(CAC_J.EJERCICIOFACTURA, 0) AS EJERCICIOFACTURA,
                    COALESCE(CF_J.FIRMANOMBRE, '') AS LEGACY_FIRMA_NOMBRE,
                    CF_J.DIA AS LEGACY_DIA, CF_J.MES AS LEGACY_MES,
                    CF_J.ANO AS LEGACY_ANO, CF_J.HORA AS LEGACY_HORA,
                    ROW_NUMBER() OVER (
                        PARTITION BY CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                            TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN,
                            CPC.NUMEROALBARAN, TRIM(CPC.CODIGOCLIENTEALBARAN)
                        ORDER BY COALESCE(CF_J.ANO, 0) DESC,
                            COALESCE(CF_J.MES, 0) DESC, COALESCE(CF_J.DIA, 0) DESC,
                            COALESCE(CF_J.HORA, 0) DESC, OPP.SUBEMPRESA,
                            OPP.EJERCICIOORDENPREPARACION,
                            OPP.NUMEROORDENPREPARACION
                    ) AS ALBARAN_RANK
                FROM DSEDAC.CPC CPC
                ${repartidorJoin}
                ${dsJoin}
                LEFT JOIN DSEDAC.CAC CAC_J
                    ON CAC_J.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
                    AND CAC_J.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                    AND TRIM(CAC_J.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
                    AND CAC_J.TERMINALALBARAN = CPC.TERMINALALBARAN
                    AND CAC_J.NUMEROALBARAN = CPC.NUMEROALBARAN
                    AND TRIM(CAC_J.CODIGOCLIENTEALBARAN) = TRIM(CPC.CODIGOCLIENTEALBARAN)
                LEFT JOIN DSEDAC.CACFIRMAS CF_J
                    ON CF_J.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                    AND TRIM(CF_J.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
                    AND CF_J.TERMINALALBARAN = CPC.TERMINALALBARAN
                    AND CF_J.NUMEROALBARAN = CPC.NUMEROALBARAN
                WHERE TRIM(CPC.CODIGOCLIENTEALBARAN) = ?
                  AND CPC.NUMEROALBARAN < 900000
                  AND CPC.EJERCICIOALBARAN > 0
                  ${yearFilter}
                  ${dateFilter}
            ),
            UNIQUE_DOCUMENTS AS (
                SELECT * FROM SOURCE_DOCUMENTS WHERE ALBARAN_RANK = 1
            ),
            CVC_INSTALLMENTS AS (
                SELECT
                    TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
                    TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
                    TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
                    CVC.EJERCICIODOCUMENTO,
                    TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
                    CVC.TERMINALDOCUMENTO, CVC.NUMERODOCUMENTO,
                    COALESCE(CVC.XDEDOCUMENTO, 1) AS XDEDOCUMENTO,
                    COALESCE(CVC.DEXDOCUMENTO, 1) AS DEXDOCUMENTO,
                    TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0)) AS IMPORTE_PENDIENTE,
                    CASE
                        WHEN MIN(COALESCE(CVC.IMPORTEPENDIENTE, 0)) <> MAX(COALESCE(CVC.IMPORTEPENDIENTE, 0))
                        THEN 1 ELSE 0
                    END AS AMBIGUOUS_INSTALLMENT
                FROM DSEDAC.CVC CVC
                INNER JOIN UNIQUE_DOCUMENTS DOC
                    ON TRIM(CVC.TIPODOCUMENTO) = 'CAC'
                    AND TRIM(CVC.ORIGENDOCUMENTO) = 'B'
                    AND TRIM(CVC.SUBEMPRESADOCUMENTO) = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND TRIM(CVC.SERIEDOCUMENTO) = DOC.SERIEALBARAN
                    AND CVC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND TRIM(CVC.CODIGOCLIENTEALBARAN) = DOC.CODIGOCLIENTEALBARAN
                WHERE COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
                GROUP BY CVC.TIPODOCUMENTO, CVC.ORIGENDOCUMENTO,
                    CVC.SUBEMPRESADOCUMENTO, CVC.EJERCICIODOCUMENTO,
                    CVC.SERIEDOCUMENTO, CVC.TERMINALDOCUMENTO,
                    CVC.NUMERODOCUMENTO, CVC.XDEDOCUMENTO,
                    CVC.DEXDOCUMENTO, CVC.CODIGOCLIENTEALBARAN
            ),
            CVC_DOCUMENTS AS (
                SELECT SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE,
                    SUM(IMPORTE_PENDIENTE) AS IMPORTE_PENDIENTE,
                    SUM(AMBIGUOUS_INSTALLMENT) AS AMBIGUOUS_INSTALLMENTS
                FROM CVC_INSTALLMENTS
                GROUP BY SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO,
                    TERMINALDOCUMENTO, NUMERODOCUMENTO, CLIENTE
            ),
            DOCUMENT_ROWS AS (
                SELECT DOC.*,
                    CASE
                        WHEN CVC_DOC.NUMERODOCUMENTO IS NULL
                          OR COALESCE(CVC_DOC.AMBIGUOUS_INSTALLMENTS, 0) > 0
                        THEN 0 ELSE 1
                    END AS CVC_PRESENT,
                    CVC_DOC.IMPORTE_PENDIENTE AS CVC_PENDING,
                    CASE WHEN DOC.NUMEROFACTURA > 0 THEN
                        'F-' || TRIM(CHAR(DOC.SUBEMPRESAALBARAN)) || '-' ||
                        TRIM(CHAR(DOC.EJERCICIOFACTURA)) || '-' ||
                        DOC.SERIEFACTURA || '-' || TRIM(CHAR(DOC.NUMEROFACTURA))
                    ELSE
                        'A-' || TRIM(CHAR(DOC.SUBEMPRESAALBARAN)) || '-' ||
                        TRIM(CHAR(DOC.EJERCICIOALBARAN)) || '-' ||
                        DOC.SERIEALBARAN || '-' || TRIM(CHAR(DOC.TERMINALALBARAN)) ||
                        '-' || TRIM(CHAR(DOC.NUMEROALBARAN))
                    END AS LOGICAL_KEY
                FROM UNIQUE_DOCUMENTS DOC
                LEFT JOIN CVC_DOCUMENTS CVC_DOC
                    ON CVC_DOC.SUBEMPRESADOCUMENTO = TRIM(DOC.SUBEMPRESAALBARAN)
                    AND CVC_DOC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
                    AND CVC_DOC.SERIEDOCUMENTO = DOC.SERIEALBARAN
                    AND CVC_DOC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
                    AND CVC_DOC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
                    AND CVC_DOC.CLIENTE = DOC.CODIGOCLIENTEALBARAN
            ),
            LOGICAL_DOCUMENTS AS (
                SELECT LOGICAL_KEY,
                    MAX(ANO * 10000 + MES * 100 + DIA) AS SORT_DATE,
                    MAX(CASE WHEN NUMEROFACTURA > 0 THEN NUMEROFACTURA ELSE NUMEROALBARAN END) AS SORT_NUMBER
                FROM DOCUMENT_ROWS
                GROUP BY LOGICAL_KEY
            ),
            NUMBERED_DOCUMENTS AS (
                SELECT LOGICAL_DOCUMENTS.*,
                    COUNT(*) OVER () AS TOTAL_COUNT,
                    ROW_NUMBER() OVER (
                        ORDER BY SORT_DATE DESC, SORT_NUMBER DESC, LOGICAL_KEY DESC
                    ) AS LOGICAL_POSITION
                FROM LOGICAL_DOCUMENTS
            ),
            PAGED_DOCUMENTS AS (
                SELECT * FROM NUMBERED_DOCUMENTS
                ORDER BY LOGICAL_POSITION
                OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
            ),
            TOTAL_META AS (
                SELECT COUNT(*) AS TOTAL_COUNT FROM LOGICAL_DOCUMENTS
            )
            SELECT DOC.*, COALESCE(PAGE.TOTAL_COUNT, META.TOTAL_COUNT) AS TOTAL_COUNT,
                PAGE.LOGICAL_POSITION,
                CASE WHEN PAGE.LOGICAL_KEY IS NULL THEN 1 ELSE 0 END AS META_ONLY
            FROM TOTAL_META META
            LEFT JOIN PAGED_DOCUMENTS PAGE ON 1 = 1
            LEFT JOIN DOCUMENT_ROWS DOC ON DOC.LOGICAL_KEY = PAGE.LOGICAL_KEY
            ORDER BY PAGE.LOGICAL_POSITION, DOC.ANO DESC, DOC.MES DESC, DOC.DIA DESC,
                DOC.NUMEROALBARAN DESC, DOC.SERIEALBARAN DESC,
                DOC.TERMINALALBARAN DESC
        `;

        const allParams = [...repartidorParams, clientCode, ...yearFilterParams, ...dateParams, pageOffset, pageLimit];
        const rows = await queryWithParams(sql, allParams, false);
        const totalDocuments = Number(rows?.[0]?.TOTAL_COUNT || 0);

        // SQL performs the primary dedupe; retain a defensive in-memory guard
        // so a malformed adapter result cannot duplicate an albaran.
        const uniqueMap = new Map();
        (rows || []).filter((row) => Number(row.META_ONLY || 0) !== 1).forEach(row => {
            const subempresa = String(row.SUBEMPRESAALBARAN || '').trim();
            const serie = (row.SERIEALBARAN || '').toString().trim();
            const key = `ALB-${subempresa}-${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`;

            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, { ...row });
            }
        });
        const uniqueRows = Array.from(uniqueMap.values());
        if (uniqueRows.length < (rows || []).filter((row) => Number(row.META_ONLY || 0) !== 1).length) {
            logger.info(`[REPARTIDOR] Defensive document dedupe applied for client ${clientId}`);
        }

        // --- Helper: compute status for a row ---
        function computeRowStatus(row) {
            const appStatus = (row.DELIVERY_STATUS || '').trim().toLowerCase();
            const legacyStatus = (row.SITUACIONALBARAN || '').trim().toUpperCase();

            if (appStatus === 'delivered' || appStatus === 'entregado') {
                return 'delivered';
            }
            if (['no_delivered', 'no_entregado', 'no_realizada', 'no_realizado', 'absent', 'rechazado', 'rechazada'].includes(appStatus)) {
                return 'no_delivered';
            }
            if (appStatus === 'parcial' || appStatus === 'partial') return 'partial';
            if (appStatus === 'en_ruta') return 'en_ruta';
            // Any explicit canonical status wins over legacy flags. Unknown
            // values stay pending instead of being upgraded to delivered.
            if (appStatus) return 'pending';
            if (legacyStatus === 'F' || legacyStatus === 'R') return 'delivered';
            // CONFORMADOSN is a completion flag, not merely a dispatch flag;
            // it remains delivered when the document date is today.
            if ((row.CONFORMADOSN || '').trim().toUpperCase() === 'S') return 'delivered';
            return 'pending';
        }

        // --- Helper: build document from row ---
        function buildDocument(row, overrides = {}) {
            const rawAmount = Number.isFinite(Number(row.IMPORTETOTAL)) ? Number(row.IMPORTETOTAL) : 0;
            const importe = overrides.amount !== undefined ? overrides.amount : rawAmount;
            const status = computeRowStatus(row);
            const hasFirmaPath = !!row.FIRMA_PATH;
            const numFactura = parseInt(row.NUMEROFACTURA) || 0;
            const serieFactura = (row.SERIEFACTURA || '').trim();
            const ejercicioFactura = parseInt(row.EJERCICIOFACTURA) || 0;
            const isFactura = numFactura > 0;
            const legacyNombre = (row.LEGACY_FIRMA_NOMBRE || '').trim();
            const hasLegacySig = legacyNombre.length > 0;
            const subempresa = String(row.SUBEMPRESAALBARAN || '').trim();
            const serie = (row.SERIEALBARAN || 'A').trim();
            const pendingAvailability = overrides.pendingAvailability ||
                (Number(row.CVC_PRESENT || 0) === 1 ? 'AVAILABLE' : 'UNAVAILABLE');

            const document = {
                id: `${subempresa}-${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`,
                subempresa,
                type: overrides.type || (isFactura ? 'factura' : 'albaran'),
                number: overrides.number !== undefined ? overrides.number : (isFactura ? numFactura : row.NUMEROALBARAN),
                albaranNumber: row.NUMEROALBARAN,
                facturaNumber: numFactura || null,
                serieFactura: serieFactura || null,
                ejercicioFactura: ejercicioFactura || null,
                serie: serie,
                ejercicio: row.EJERCICIOALBARAN,
                terminal: row.TERMINALALBARAN,
                date: `${row.ANO}-${String(row.MES).padStart(2, '0')}-${String(row.DIA).padStart(2, '0')}`,
                time: (row.HORALLEGADA && row.HORALLEGADA > 0)
                    ? `${String(row.HORALLEGADA).padStart(6, '0').substring(0, 2)}:${String(row.HORALLEGADA).padStart(6, '0').substring(2, 4)}`
                    : null,
                amount: importe,
                pendingAvailability,
                status: overrides.status || status,
                hasSignature: hasFirmaPath || hasLegacySig,
                signaturePath: row.FIRMA_PATH || null,
                deliveryDate: row.DELIVERY_UPDATED_AT || null,
                deliveryRepartidor: row.DELIVERY_REPARTIDOR || null,
                deliveryObs: row.OBSERVACIONES || null,
                legacySignatureName: legacyNombre || null,
                hasLegacySignature: hasLegacySig,
                legacyDate: (row.LEGACY_ANO > 0)
                    ? `${row.LEGACY_ANO}-${String(row.LEGACY_MES).padStart(2, '0')}-${String(row.LEGACY_DIA).padStart(2, '0')} ${String(row.LEGACY_HORA).padStart(6, '0').substring(0, 2)}:${String(row.LEGACY_HORA).padStart(6, '0').substring(2, 4)}`
                    : null,
                // When grouped by factura, include constituent albaranes
                ...(overrides.albaranes ? { albaranes: overrides.albaranes } : {})
            };
            if (pendingAvailability === 'AVAILABLE') {
                document.pending = overrides.pending !== undefined
                    ? overrides.pending
                    : (Number.isFinite(Number(row.CVC_PENDING)) ? Number(row.CVC_PENDING) : 0);
            }
            return document;
        }

        // --- DEDUPLICATION PASS 2: Group albaranes by factura ---
        // When multiple albaranes share the same factura number, show ONE factura entry
        // with the summed amount (matching the factura PDF total).
        const facturaGroups = new Map(); // facturaKey -> [rows]
        const noFacturaRows = [];
        uniqueRows.forEach(row => {
            const numFactura = parseInt(row.NUMEROFACTURA) || 0;
            if (numFactura > 0) {
                const serieF = (row.SERIEFACTURA || '').trim();
                const ejercicioF = parseInt(row.EJERCICIOFACTURA) || 0;
                const subempresa = String(row.SUBEMPRESAALBARAN || '').trim();
                const fKey = `F-${subempresa}-${ejercicioF}-${serieF}-${numFactura}`;
                if (!facturaGroups.has(fKey)) {
                    facturaGroups.set(fKey, []);
                }
                facturaGroups.get(fKey).push(row);
            } else {
                noFacturaRows.push(row);
            }
        });

        const documents = [];

        // Add grouped factura entries
        for (const [fKey, fRows] of facturaGroups.entries()) {
            // CAC repeats the invoice header amount once for every constituent
            // albaran. Use that header exactly once; only sum CPC amounts when
            // CAC did not provide a header amount.
            const invoiceAmounts = [...new Set(fRows
                .filter((row) => row.IMPORTETOTAL_FACTURA !== null && row.IMPORTETOTAL_FACTURA !== undefined && row.IMPORTETOTAL_FACTURA !== '')
                .map((row) => Number(row.IMPORTETOTAL_FACTURA))
                .filter(Number.isFinite)
                .map((amount) => Number(amount.toFixed(2))))];
            if (invoiceAmounts.length > 1) {
                throw new Error('ambiguous invoice header amount');
            }
            const totalAmount = invoiceAmounts.length === 1
                ? invoiceAmounts[0]
                : fRows.reduce((sum, row) => sum + (Number.isFinite(Number(row.IMPORTETOTAL)) ? Number(row.IMPORTETOTAL) : 0), 0);

            // Use the most recent row for display metadata (date, status, etc.)
            const primaryRow = fRows[0]; // Already sorted by date DESC

            const statuses = fRows.map(r => computeRowStatus(r));
            let bestStatus = 'pending';
            if (statuses.every((status) => status === 'delivered')) bestStatus = 'delivered';
            else if (statuses.includes('no_delivered')) bestStatus = 'no_delivered';
            else if (statuses.includes('partial')) bestStatus = 'partial';
            else if (statuses.includes('pending')) bestStatus = 'pending';
            else if (statuses.includes('en_ruta')) bestStatus = 'en_ruta';

            const pendingAvailable = fRows.every((row) => Number(row.CVC_PRESENT || 0) === 1);
            const pendingAmount = pendingAvailable
                ? fRows.reduce((sum, row) => sum + (Number.isFinite(Number(row.CVC_PENDING)) ? Number(row.CVC_PENDING) : 0), 0)
                : undefined;

            const albaranes = fRows.map(r => {
                const s = (r.SERIEALBARAN || 'A').trim();
                return {
                    subempresa: String(r.SUBEMPRESAALBARAN || '').trim(),
                    serie: s,
                    terminal: r.TERMINALALBARAN,
                    numero: r.NUMEROALBARAN,
                    ejercicio: r.EJERCICIOALBARAN,
                    amount: Number.isFinite(Number(r.IMPORTETOTAL)) ? Number(r.IMPORTETOTAL) : 0
                };
            });

            documents.push(buildDocument(primaryRow, {
                type: 'factura',
                number: parseInt(primaryRow.NUMEROFACTURA),
                amount: totalAmount,
                status: bestStatus,
                pendingAvailability: pendingAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
                pending: pendingAmount,
                albaranes: albaranes.length > 1 ? albaranes : undefined
            }));

            if (fRows.length > 1) {
                logger.info(`[REPARTIDOR] Factura ${fKey}: grouped ${fRows.length} albaranes, total=${totalAmount.toFixed(2)}`);
            }
        }

        // Add non-factura albaranes as individual entries
        noFacturaRows.forEach(row => {
            documents.push(buildDocument(row));
        });

        // Sort by date DESC, then number DESC
        documents.sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            return (b.number || 0) - (a.number || 0);
        });

        res.json({
            success: true,
            clientId,
            total: totalDocuments,
            deliveryStatusAvailability: dsAvail ? 'AVAILABLE' : 'LEGACY_ONLY',
            pagination: {
                limit: pageLimit,
                offset: pageOffset,
                hasMore: pageOffset + documents.length < totalDocuments,
                nextOffset: pageOffset + documents.length
            },
            documents
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in history/documents');
        sendRouteError(res, 503, 'REPARTIDOR_DOCUMENTS_FAILED');
    }
});

// =============================================================================
// GET /history/objectives/:repartidorId
// Seguimiento del objetivo 30% por mes
// =============================================================================
router.get('/history/objectives/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { clientId } = req.query;
        const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';

        logger.info(`[REPARTIDOR] Getting objectives for ${repartidorId}${normalizedClientId ? ` client ${normalizedClientId}` : ''}`);
        const cleanRepartidorIds = authorizedRepartidorIds(req, res, repartidorId);
        if (!cleanRepartidorIds) return;
        let clientFilter = '';
        const queryParams = [...cleanRepartidorIds];
        if (normalizedClientId) {
            clientFilter = `AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?`;
            queryParams.push(normalizedClientId);
        }

        // SENIOR: No date restriction, no row limit - fetch all historical data
        const placeholders = cleanRepartidorIds.map(() => '?').join(',');
        const sql = `
            SELECT 
                OPP.ANOREPARTO as ANO,
                OPP.MESREPARTO as MES,
                SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 
                    THEN CPC.IMPORTETOTAL 
                    ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
                END) as TOTAL_COBRADO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                AND CPC.SUBEMPRESA = OPP.SUBEMPRESA
                AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${placeholders})
              ${clientFilter}
            GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO
            ORDER BY OPP.ANOREPARTO DESC, OPP.MESREPARTO DESC
            FETCH FIRST 500 ROWS ONLY
        `;

        const rows = await cachedQuery(
            queryWithParams,
            sql,
            `repartidor:objectives:${cleanRepartidorIds.join(',')}:${normalizedClientId || 'all'}`,
            TTL.REALTIME,
            queryParams
        );

        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

        const objectives = rows.map(row => {
            const collectable = parseFloat(row.TOTAL_COBRABLE) || 0;
            const collected = parseFloat(row.TOTAL_COBRADO) || 0;
            const percentage = collectable > 0 ? (collected / collectable) * 100 : 0;

            return {
                month: `${months[row.MES - 1]} ${row.ANO}`,
                year: row.ANO,
                monthNum: row.MES,
                collectable,
                collected,
                percentage: parseFloat(percentage.toFixed(2)),
                thresholdMet: percentage >= REPARTIDOR_CONFIG.threshold
            };
        });

        res.json({
            success: true,
            objectives
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in history/objectives');
        sendRouteError(res, 503, 'REPARTIDOR_OBJECTIVES_FAILED');
    }
});

// =============================================================================
// GET /history/objectives-detail/:repartidorId
// Desglose jerárquico: Año → Cliente → FI1 → FI2 → FI3 → FI4 → Productos
// =============================================================================
router.get('/history/objectives-detail/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, clientId } = req.query;

        const yearResult = parseBoundedInt(year, { min: 2000, max: 2100, name: 'YEAR', fallback: new Date().getFullYear() });
        if (yearResult.error) return sendRouteError(res, 422, yearResult.error);
        const selectedYear = yearResult.value;
        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        const repartidorKey = repartidorIdList.join(',');

        logger.info(`[REPARTIDOR] Objectives detail for ${repartidorId}, year ${selectedYear}${clientId ? `, client ${clientId}` : ''}`);

        // 1. Get client codes delivered by this repartidor in this year
        let clientFilter = '';
        const clientFilterParams = [];
        if (clientId) {
            clientFilter = `AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?`;
            clientFilterParams.push(clientId.trim());
        }

        const clientsSql = `
            SELECT DISTINCT TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENT_CODE,
                TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) as CLIENT_NAME
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                AND CPC.SUBEMPRESA = OPP.SUBEMPRESA
                AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorIdList.map(() => '?').join(',')})
              AND OPP.ANOREPARTO = ?
              ${clientFilter}
            FETCH FIRST 1000 ROWS ONLY
        `;

        const clientSqlParams = [...repartidorIdList, selectedYear, ...clientFilterParams];
        const clientRows = await cachedQuery(queryWithParams, clientsSql, `repartidor:objDetail:${repartidorKey}:${selectedYear}:${clientId || 'all'}`, TTL.REALTIME, clientSqlParams);
        if (clientRows.length === 0) {
            return res.json({ success: true, clients: [], year: selectedYear });
        }

        // Build client name map
        const clientNames = {};
        clientRows.forEach(r => {
            const code = (r.CLIENT_CODE || '').trim();
            clientNames[code] = (r.CLIENT_NAME || '').trim() || `CLIENTE ${code}`;
        });

        // 2. Query LACLAE for all those clients with FI hierarchy
        const CHUNK_SIZE = 500;
        const allCodes = Object.keys(clientNames);
        const laclaeParams = [];
        const chunks = [];
        for (let i = 0; i < allCodes.length; i += CHUNK_SIZE) {
            const chunk = allCodes.slice(i, i + CHUNK_SIZE);
            chunks.push(`L.LCCDCL IN (${chunk.map(() => '?').join(',')})`);
            laclaeParams.push(...chunk);
        }
        const clientInFilter = `(${chunks.join(' OR ')})`;

        const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT')`;

        const dataSql = `
            SELECT
                TRIM(L.LCCDCL) as CLIENT_CODE,
                TRIM(L.LCCDRF) as PRODUCT_CODE,
                COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.LCDESC)) as PRODUCT_NAME,
                COALESCE(TRIM(A.UNIDADMEDIDA), 'UDS') as UNIT_TYPE,
                L.LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST,
                SUM(L.LCCTUD) as UNITS,
                COALESCE(TRIM(AX.FILTRO01), '') as FI1_CODE,
                COALESCE(TRIM(AX.FILTRO02), '') as FI2_CODE,
                COALESCE(TRIM(AX.FILTRO03), '') as FI3_CODE,
                COALESCE(TRIM(AX.FILTRO04), '') as FI4_CODE
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARTX AX ON L.LCCDRF = AX.CODIGOARTICULO
            WHERE ${clientInFilter}
              AND L.LCAADC = ?
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCCDCL, L.LCCDRF, A.DESCRIPCIONARTICULO, L.LCDESC, A.UNIDADMEDIDA, L.LCMMDC, AX.FILTRO01, AX.FILTRO02, AX.FILTRO03, AX.FILTRO04
            ORDER BY SALES DESC
        `;

        const dataParams = [...laclaeParams, selectedYear];
        const rows = await queryWithParams(dataSql, dataParams, false);

        // 3. Load FI names from metadata cache
        let fi1Names = {}, fi2Names = {}, fi3Names = {}, fi4Names = {};
        try {
            const { isCacheReady, getCachedFi1Names, getCachedFi2Names, getCachedFi3Names, getCachedFi4Names } = require('../services/metadataCache');
            if (isCacheReady()) {
                fi1Names = getCachedFi1Names() || {};
                fi2Names = getCachedFi2Names() || {};
                fi3Names = getCachedFi3Names() || {};
                fi4Names = getCachedFi4Names() || {};
            } else {
                const [fi1Rows, fi2Rows, fi3Rows, fi4Rows] = await Promise.all([
                    query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI1`, false, false),
                    query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI2`, false, false),
                    query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI3`, false, false),
                    query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI4`, false, false),
                ]);
                fi1Rows.forEach(r => { fi1Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
                fi2Rows.forEach(r => { fi2Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
                fi3Rows.forEach(r => { fi3Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
                fi4Rows.forEach(r => { fi4Names[(r.CODIGOFILTRO || '').trim()] = (r.DESCRIPCIONFILTRO || '').trim(); });
            }
        } catch (e) {
            logger.warn(`[REPARTIDOR] Could not load FI names: ${e.message}`);
        }

        // 4. Build hierarchy: Client → FI1 → FI2 → FI3 → FI4 → Products
        const clientMap = new Map();

        rows.forEach(row => {
            const cCode = (row.CLIENT_CODE || '').trim();
            const pCode = (row.PRODUCT_CODE || '').trim();
            const pName = (row.PRODUCT_NAME || '').trim() || 'Sin nombre';
            const unitType = (row.UNIT_TYPE || '').trim();
            const month = parseInt(row.MONTH);
            const sales = parseFloat(row.SALES) || 0;
            const cost = parseFloat(row.COST) || 0;
            const units = parseFloat(row.UNITS) || 0;
            const fi1 = (row.FI1_CODE || '').trim() || 'SIN_CAT';
            const fi2 = (row.FI2_CODE || '').trim() || 'General';
            const fi3 = (row.FI3_CODE || '').trim() || '';
            const fi4 = (row.FI4_CODE || '').trim() || '';

            // Client level
            if (!clientMap.has(cCode)) {
                clientMap.set(cCode, {
                    code: cCode,
                    name: clientNames[cCode] || `CLIENTE ${cCode}`,
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    productCount: new Set(),
                    families: new Map()
                });
            }
            const client = clientMap.get(cCode);
            client.totalSales += sales;
            client.totalCost += cost;
            client.totalUnits += units;
            client.productCount.add(pCode);

            // FI1 level
            if (!client.families.has(fi1)) {
                client.families.set(fi1, {
                    code: fi1,
                    name: fi1Names[fi1] ? `${fi1} - ${fi1Names[fi1]}` : (fi1 === 'SIN_CAT' ? 'Sin Categoría' : fi1),
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    children: new Map()
                });
            }
            const fi1Level = client.families.get(fi1);
            fi1Level.totalSales += sales;
            fi1Level.totalCost += cost;
            fi1Level.totalUnits += units;

            // FI2 level
            if (!fi1Level.children.has(fi2)) {
                fi1Level.children.set(fi2, {
                    code: fi2,
                    name: fi2Names[fi2] ? `${fi2} - ${fi2Names[fi2]}` : fi2,
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    children: new Map()
                });
            }
            const fi2Level = fi1Level.children.get(fi2);
            fi2Level.totalSales += sales;
            fi2Level.totalCost += cost;
            fi2Level.totalUnits += units;

            // FI3 level (skip if empty)
            const fi3Key = fi3 || '_default';
            if (!fi2Level.children.has(fi3Key)) {
                fi2Level.children.set(fi3Key, {
                    code: fi3 || '',
                    name: fi3 && fi3Names[fi3] ? `${fi3} - ${fi3Names[fi3]}` : (fi3 || 'General'),
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    children: new Map()
                });
            }
            const fi3Level = fi2Level.children.get(fi3Key);
            fi3Level.totalSales += sales;
            fi3Level.totalCost += cost;
            fi3Level.totalUnits += units;

            // FI4 level (skip if empty)
            const fi4Key = fi4 || '_default';
            if (!fi3Level.children.has(fi4Key)) {
                fi3Level.children.set(fi4Key, {
                    code: fi4 || '',
                    name: fi4 && fi4Names[fi4] ? `${fi4} - ${fi4Names[fi4]}` : (fi4 || 'General'),
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    products: new Map()
                });
            }
            const fi4Level = fi3Level.children.get(fi4Key);
            fi4Level.totalSales += sales;
            fi4Level.totalCost += cost;
            fi4Level.totalUnits += units;

            // Product level
            if (!fi4Level.products.has(pCode)) {
                fi4Level.products.set(pCode, {
                    code: pCode, name: pName, unitType,
                    totalSales: 0, totalCost: 0, totalUnits: 0,
                    monthlyData: {}
                });
            }
            const product = fi4Level.products.get(pCode);
            product.totalSales += sales;
            product.totalCost += cost;
            product.totalUnits += units;
            product.monthlyData[month] = (product.monthlyData[month] || 0) + sales;
        });

        // 5. Convert Maps to arrays for JSON, sorted by sales desc
        const mapToArray = (map) => Array.from(map.values()).sort((a, b) => (b.totalSales || 0) - (a.totalSales || 0));

        const clients = mapToArray(clientMap).map(client => ({
            code: client.code,
            name: client.name,
            totalSales: client.totalSales,
            totalCost: client.totalCost,
            totalUnits: client.totalUnits,
            productCount: client.productCount.size,
            margin: client.totalSales > 0 ? ((client.totalSales - client.totalCost) / client.totalSales * 100) : 0,
            families: mapToArray(client.families).map(fi1 => ({
                code: fi1.code, name: fi1.name,
                totalSales: fi1.totalSales, totalCost: fi1.totalCost, totalUnits: fi1.totalUnits,
                children: mapToArray(fi1.children).map(fi2 => ({
                    code: fi2.code, name: fi2.name,
                    totalSales: fi2.totalSales, totalCost: fi2.totalCost, totalUnits: fi2.totalUnits,
                    children: mapToArray(fi2.children).map(fi3 => ({
                        code: fi3.code, name: fi3.name,
                        totalSales: fi3.totalSales, totalCost: fi3.totalCost, totalUnits: fi3.totalUnits,
                        children: mapToArray(fi3.children).map(fi4 => ({
                            code: fi4.code, name: fi4.name,
                            totalSales: fi4.totalSales, totalCost: fi4.totalCost, totalUnits: fi4.totalUnits,
                            products: Array.from(fi4.products.values()).sort((a, b) => b.totalSales - a.totalSales)
                        }))
                    }))
                }))
            }))
        }));

        // Grand totals
        let grandSales = 0, grandCost = 0, grandUnits = 0;
        clients.forEach(c => { grandSales += c.totalSales; grandCost += c.totalCost; grandUnits += c.totalUnits; });

        logger.info(`[REPARTIDOR] Objectives detail: ${clients.length} clients, ${rows.length} data rows`);

        res.json({
            success: true,
            year: selectedYear,
            grandTotal: { sales: grandSales, cost: grandCost, units: grandUnits, margin: grandSales > 0 ? ((grandSales - grandCost) / grandSales * 100) : 0 },
            clients
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in objectives-detail');
        sendRouteError(res, 503, 'REPARTIDOR_OBJECTIVES_DETAIL_FAILED');
    }
});

// =============================================================================
// GET /history/signature
// Retrieve real signature (base64) for a given albaran
// =============================================================================
router.get('/history/signature', verifyToken, async (req, res) => {
    try {
        const { ejercicio, serie, terminal, numero } = req.query;
        if (!ejercicio || !numero) {
            return res.json({ success: true, hasSignature: false });
        }

        const albId = `${ejercicio}-${(serie || 'A').trim()}-${terminal || '0'}-${numero}`;
        logger.info(`[REPARTIDOR] Getting signature for albaran ${albId}`);
        let signatureSource = null; // Track where we found the signature

        // 1. Check DELIVERY_STATUS for FIRMA_PATH (OLD schema only)
        let firmaPath = null;
        const dsOldAvail = isDeliveryStatusAvailable() && !isDeliveryStatusNewSchema();
        if (dsOldAvail) {
            const dsRows = await queryWithParams(`
                SELECT FIRMA_PATH FROM JAVIER.DELIVERY_STATUS WHERE ID = ?
            `, [albId], false);
            logger.info(`[REPARTIDOR] Step 1 DELIVERY_STATUS: ${dsRows.length} rows for ID='${albId}'`);
            if (dsRows.length > 0 && dsRows[0].FIRMA_PATH) {
                firmaPath = dsRows[0].FIRMA_PATH;
            }
        }
        // 2. Check REPARTIDOR_FIRMAS via REPARTIDOR_ENTREGAS
        let firmaBase64 = null;
        let firmante = null;
        let fechaFirma = null;
        const firmaRows = await queryWithParams(`
            SELECT RF.FIRMABASE64, RF.FIRMANOMBRE, RF.DIA, RF.MES, RF.ANO, RF.HORA
            FROM JAVIER.REPARTIDOR_FIRMAS RF
            INNER JOIN JAVIER.REPARTIDOR_ENTREGAS RE ON RE.ID = RF.ENTREGA_ID
            WHERE RE.NUMEROORDENPREPARACION = ?
              AND RE.EJERCICIOALBARAN = ?
              AND TRIM(RE.SERIEALBARAN) = ?
            FETCH FIRST 1 ROW ONLY
        `, [parseInt(numero), parseInt(ejercicio), (serie || 'A').trim()], false);
        if (firmaRows.length > 0) {
            firmaBase64 = firmaRows[0].FIRMABASE64;
            firmante = firmaRows[0].FIRMANOMBRE;
            fechaFirma = (firmaRows[0].ANO > 0)
                ? `${firmaRows[0].ANO}-${String(firmaRows[0].MES).padStart(2, '0')}-${String(firmaRows[0].DIA).padStart(2, '0')} ${String(firmaRows[0].HORA).padStart(6, '0').substring(0, 2)}:${String(firmaRows[0].HORA).padStart(6, '0').substring(2, 4)}`
                : null;
            if (firmaBase64) signatureSource = 'REPARTIDOR_FIRMAS';
            logger.info(`[REPARTIDOR] Step 2 REPARTIDOR_FIRMAS: found row, hasBase64=${!!firmaBase64}`);
        } else {
            logger.info(`[REPARTIDOR] Step 2 REPARTIDOR_FIRMAS: 0 rows for numero=${numero}, ejercicio=${ejercicio}, serie='${(serie || 'A').trim()}'`);
        }
        // 3. If no base64, try reading from FIRMA_PATH file
        if (!firmaBase64 && firmaPath) {
            try {
                const pathsToTry = [];

                // If FIRMA_PATH is an absolute path, try it directly first
                if (path.isAbsolute(firmaPath)) {
                    pathsToTry.push(firmaPath);
                }
                // Try multiple base paths for relative paths
                const basePaths = [
                    path.join(__dirname, '../../uploads'),
                    path.join(__dirname, '../../uploads/photos')
                ];
                for (const basePath of basePaths) {
                    pathsToTry.push(path.join(basePath, firmaPath));
                }

                for (const fullPath of pathsToTry) {
                    if (fs.existsSync(fullPath)) {
                        const fileBuffer = await fsPromises.readFile(fullPath);
                        if (fileBuffer.length > 50) {
                            firmaBase64 = fileBuffer.toString('base64');
                            signatureSource = 'FILE';
                            logger.info(`[REPARTIDOR] Found signature file at ${fullPath} (${fileBuffer.length} bytes)`);
                            break;
                        } else {
                            logger.warn(`[REPARTIDOR] Signature file too small (${fileBuffer.length}B): ${fullPath}`);
                        }
                    }
                }
                if (!firmaBase64) {
                    logger.warn(`[REPARTIDOR] Signature file not found for path: ${firmaPath} — tried: ${pathsToTry.join(', ')}`);
                }
            } catch (e) {
                logger.warn('[REPARTIDOR] Stored signature read failed');
            }
        }

        // 4. CACFIRMAS (legacy ERP signatures) — last resort
        if (!firmaBase64) {
            // Query ALL CACFIRMAS rows for this albaran (no FIRMABASE64 filter)
            const cacRows = await queryWithParams(`
                SELECT FIRMABASE64, TRIM(FIRMANOMBRE) as FIRMANOMBRE, DIA, MES, ANO, HORA,
                       LENGTH(FIRMABASE64) as FIRMA_LEN
                FROM DSEDAC.CACFIRMAS
                WHERE EJERCICIOALBARAN = ?
                  AND TRIM(SERIEALBARAN) = ?
                  AND TERMINALALBARAN = ?
                  AND NUMEROALBARAN = ?
                FETCH FIRST 5 ROWS ONLY
            `, [parseInt(ejercicio), (serie || 'A').trim(), parseInt(terminal || 0), parseInt(numero)], false);
            logger.info(`[REPARTIDOR] Step 4 CACFIRMAS: ${cacRows.length} rows for ej=${ejercicio}, serie='${(serie || 'A').trim()}', term=${terminal || 0}, num=${numero}`);

            // Try to find one with actual base64 data
            for (const cacRow of cacRows) {
                const rawB64 = cacRow.FIRMABASE64;
                const b64Len = parseInt(cacRow.FIRMA_LEN) || 0;
                const nombre = (cacRow.FIRMANOMBRE || '').trim();
                logger.info(`[REPARTIDOR] CACFIRMAS row: len=${b64Len}, name='${nombre}', hasData=${!!rawB64 && b64Len > 10}`);

                if (rawB64 && b64Len > 10) {
                    let b64 = rawB64.toString();
                    b64 = b64.replace(/^data:image\/\w+;base64,/, '');
                    firmaBase64 = b64;
                    signatureSource = 'CACFIRMAS';
                    if (!firmante && nombre.length > 0) firmante = nombre;
                    if (!fechaFirma && cacRow.ANO > 0) {
                        fechaFirma = `${cacRow.ANO}-${String(cacRow.MES).padStart(2, '0')}-${String(cacRow.DIA).padStart(2, '0')} ${String(cacRow.HORA).padStart(6, '0').substring(0, 2)}:${String(cacRow.HORA).padStart(6, '0').substring(2, 4)}`;
                    }
                    logger.info(`[REPARTIDOR] Found legacy signature in CACFIRMAS for ${albId}`);
                    break;
                }
            }

            // If no base64 but we have rows with FIRMANOMBRE, report as name-only signature
            if (!firmaBase64 && cacRows.length > 0) {
                const nameRow = cacRows.find(r => (r.FIRMANOMBRE || '').trim().length > 0);
                if (nameRow) {
                    firmante = (nameRow.FIRMANOMBRE || '').trim();
                    signatureSource = 'CACFIRMAS_NAME_ONLY';
                    if (!fechaFirma && nameRow.ANO > 0) {
                        fechaFirma = `${nameRow.ANO}-${String(nameRow.MES).padStart(2, '0')}-${String(nameRow.DIA).padStart(2, '0')} ${String(nameRow.HORA).padStart(6, '0').substring(0, 2)}:${String(nameRow.HORA).padStart(6, '0').substring(2, 4)}`;
                    }
                    logger.info(`[REPARTIDOR] CACFIRMAS name-only signature: '${firmante}' for ${albId}`);
                } else {
                    logger.info(`[REPARTIDOR] CACFIRMAS: rows exist but no FIRMABASE64 and no FIRMANOMBRE`);
                }
            } else if (cacRows.length === 0) {
                logger.info(`[REPARTIDOR] CACFIRMAS: NO row at all for this albaran`);
            }
        }

        const hasSignature = !!(firmaBase64 || firmaPath || signatureSource);

        logger.info(`[REPARTIDOR] Signature result for ${albId}: hasSignature=${hasSignature}, source=${signatureSource || 'none'}, hasBase64=${!!firmaBase64}, firmante='${firmante || ''}'`);

        // Sanitize source — never expose server paths to client
        const safeSource = signatureSource ? signatureSource.replace(/FILE:.*/, 'FILE').replace(/\/opt.*/, '') : null;

        res.json({
            success: true,
            hasSignature,
            signature: hasSignature ? {
                base64: firmaBase64 || null,
                path: firmaPath ? 'stored' : null,
                firmante: firmante || null,
                fecha: fechaFirma || null,
                source: safeSource || null
            } : null
        });

    } catch (error) {
        logger.error('[REPARTIDOR] History signature request failed');
        sendRouteError(res, 503, 'REPARTIDOR_SIGNATURE_FAILED');
    }
});

// =============================================================================
// GET /debug/signatures - Find albaranes with actual signatures in CACFIRMAS
// Temporary diagnostic endpoint
// =============================================================================
router.get('/debug/signatures', verifyToken, async (req, res) => {
    try {
        const debugEnabled = process.env.NODE_ENV !== 'production'
            && process.env.ENABLE_REPARTIDOR_SIGNATURE_DEBUG === 'true';
        if (!debugEnabled) return res.sendStatus(404);
        if (String(req.user?.role || '').trim().toUpperCase() !== 'ADMIN') {
            return sendRouteError(res, 403, 'DEBUG_ACCESS_DENIED');
        }
        // Find recent albaranes that have signatures in CACFIRMAS
        const rows = await query(`
            SELECT 
                CF.EJERCICIOALBARAN, TRIM(CF.SERIEALBARAN) as SERIE, 
                CF.TERMINALALBARAN, CF.NUMEROALBARAN,
                TRIM(CF.FIRMANOMBRE) as FIRMANTE,
                CF.ANO, CF.MES, CF.DIA,
                LENGTH(CF.FIRMABASE64) as FIRMA_SIZE,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE
            FROM DSEDAC.CACFIRMAS CF
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.EJERCICIOALBARAN = CF.EJERCICIOALBARAN
                AND CPC.SERIEALBARAN = CF.SERIEALBARAN
                AND CPC.TERMINALALBARAN = CF.TERMINALALBARAN
                AND CPC.NUMEROALBARAN = CF.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE CF.FIRMABASE64 IS NOT NULL 
              AND LENGTH(TRIM(CF.FIRMABASE64)) > 10
              AND CF.EJERCICIOALBARAN >= 2025
            ORDER BY CF.ANO DESC, CF.MES DESC, CF.DIA DESC
            FETCH FIRST 50 ROWS ONLY
        `, false);

        const signatures = rows.map(r => ({
            albaran: `${r.EJERCICIOALBARAN}-${r.SERIE}-${r.TERMINALALBARAN}-${r.NUMEROALBARAN}`,
            cliente: `${r.CLIENTE} - ${r.NOMBRE_CLIENTE}`,
            firmante: r.FIRMANTE || 'N/A',
            fecha: r.ANO > 0 ? `${r.DIA}/${r.MES}/${r.ANO}` : 'N/A',
            firmaSize: r.FIRMA_SIZE || 0
        }));

        logger.info(`[REPARTIDOR] Debug: Found ${signatures.length} albaranes with signatures in CACFIRMAS`);
        res.json({
            success: true,
            total: signatures.length,
            signatures,
            note: 'These are albaranes with actual Base64 signatures in CACFIRMAS'
        });
    } catch (error) {
        logger.error('[REPARTIDOR] Debug signatures failed');
        sendRouteError(res, 503, 'DEBUG_SIGNATURES_FAILED');
    }
});

// =============================================================================
// GET /history/delivery-summary/:repartidorId
// Summary of deliveries: totals entregados/pendientes by date range
// =============================================================================
router.get('/history/delivery-summary/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { year, month } = req.query;

        const yearResult = parseBoundedInt(year, { min: 2000, max: 2100, name: 'YEAR', fallback: new Date().getFullYear() });
        const monthResult = parseBoundedInt(month, { min: 1, max: 12, name: 'MONTH', fallback: new Date().getMonth() + 1 });
        if (yearResult.error || monthResult.error) return sendRouteError(res, 422, yearResult.error || monthResult.error);
        const selectedYear = yearResult.value;
        const selectedMonth = monthResult.value;
        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        // Only include days up to today if viewing current month/year
        // This prevents future pre-loaded albaranes from inflating the % entrega
        const now = new Date();
        const isCurrentPeriod = selectedYear === now.getFullYear() && selectedMonth === (now.getMonth() + 1);
        const dayFilter = isCurrentPeriod ? `AND OPP.DIAREPARTO <= ?` : '';
        const dayFilterParams = isCurrentPeriod ? [now.getDate()] : [];

        logger.info(`[REPARTIDOR] Delivery summary for ${repartidorId}, ${selectedMonth}/${selectedYear}${isCurrentPeriod ? ` (capped to day ${now.getDate()})` : ''}`);

        // Subquery deduplicates by unique albaran key FIRST, then outer query aggregates by day.
        // This prevents inflated counts when multiple CPC rows exist per albaran.
        const dsAvail = isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();
        // The legacy ID does not encode subempresa or client, so it cannot be
        // joined safely for a cross-client aggregate. Use canonical status
        // only when every delivery identity component is available.
        const dsJoinSub = dsAvail ? `
            LEFT JOIN JAVIER.DELIVERY_STATUS DS
                ON DS.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
                AND DS.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND TRIM(DS.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
                AND DS.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND DS.NUMEROALBARAN = CPC.NUMEROALBARAN
                AND TRIM(DS.CODIGOCLIENTEALBARAN) = TRIM(CPC.CODIGOCLIENTEALBARAN)
        ` : '';
        const canonicalStatusCases = dsAvail ? `
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(DS.STATUS, ''))) IN
                        ('NO_ENTREGADO', 'NO_REALIZADA', 'NO_REALIZADO', 'RECHAZADO', 'RECHAZADA', 'ABSENT')
                        THEN 1 ELSE 0 END) = 1 THEN 'NO_ENTREGADO'
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(DS.STATUS, ''))) IN ('PARCIAL', 'PARTIAL')
                        THEN 1 ELSE 0 END) = 1 THEN 'PARCIAL'
                    WHEN MAX(CASE WHEN UPPER(TRIM(COALESCE(DS.STATUS, ''))) IN ('ENTREGADO', 'DELIVERED')
                        THEN 1 ELSE 0 END) = 1 THEN 'ENTREGADO'
                    WHEN MAX(CASE WHEN TRIM(COALESCE(DS.STATUS, '')) <> '' THEN 1 ELSE 0 END) = 1
                        THEN 'PENDIENTE'` : '';

        const baseSql = `
            SELECT DIA,
                COUNT(*) as TOTAL_ALBARANES,
                SUM(CASE WHEN FINAL_STATUS = 'ENTREGADO' THEN 1 ELSE 0 END) as ENTREGADOS,
                SUM(CASE WHEN FINAL_STATUS = 'NO_ENTREGADO' THEN 1 ELSE 0 END) as NO_ENTREGADOS,
                SUM(CASE WHEN FINAL_STATUS = 'PARCIAL' THEN 1 ELSE 0 END) as PARCIALES,
                CAST(SUM(IMPORTE) AS DECIMAL(15,2)) as IMPORTE_TOTAL
            FROM (
                SELECT 
                    OPP.DIAREPARTO as DIA,
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    TRIM(CPC.SERIEALBARAN) as SERIE,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                    CAST(MAX(CPC.IMPORTETOTAL) AS DECIMAL(15,2)) as IMPORTE,
                    CASE
                        ${canonicalStatusCases}
                        WHEN MAX(CASE WHEN TRIM(COALESCE(CPC.CONFORMADOSN, '')) = 'S' THEN 1 ELSE 0 END) = 1
                            THEN 'ENTREGADO'
                        ELSE 'PENDIENTE'
                    END AS FINAL_STATUS
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESA = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                ${dsJoinSub}
                WHERE OPP.ANOREPARTO = ?
                  AND OPP.MESREPARTO = ?
                  ${dayFilter}
                  AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorIdList.map(() => '?').join(',')})
                GROUP BY OPP.DIAREPARTO, CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN, TRIM(CPC.SERIEALBARAN),
                    CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                    TRIM(CPC.CODIGOCLIENTEALBARAN)
            ) ALBS
            GROUP BY DIA
            ORDER BY DIA
        `;

        const rows = await queryWithParams(
            baseSql,
            [selectedYear, selectedMonth, ...dayFilterParams, ...repartidorIdList],
            false
        ) || [];

        let totalAlbaranes = 0, totalEntregados = 0, totalNoEntregados = 0, totalParciales = 0, totalImporte = 0;

        const daily = rows.map(row => {
            const albs = parseInt(row.TOTAL_ALBARANES) || 0;
            const ent = parseInt(row.ENTREGADOS) || 0;
            const noEnt = parseInt(row.NO_ENTREGADOS) || 0;
            const parc = parseInt(row.PARCIALES) || 0;
            const imp = parseFloat(row.IMPORTE_TOTAL) || 0;
            if ([albs, ent, noEnt, parc].some((value) => value < 0) || ent + noEnt + parc > albs) {
                throw new Error('delivery status invariant violated');
            }

            totalAlbaranes += albs;
            totalEntregados += ent;
            totalNoEntregados += noEnt;
            totalParciales += parc;
            totalImporte += imp;

            return {
                day: row.DIA,
                date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(row.DIA).padStart(2, '0')}`,
                total: albs,
                delivered: ent,
                notDelivered: noEnt,
                partial: parc,
                pending: Math.max(0, albs - ent - noEnt - parc),
                amount: imp
            };
        });

        const pendientesRaw = totalAlbaranes - totalEntregados - totalNoEntregados - totalParciales;
        res.json({
            success: true,
            period: { year: selectedYear, month: selectedMonth },
            summary: {
                totalAlbaranes,
                entregados: Math.min(totalEntregados, totalAlbaranes),
                noEntregados: totalNoEntregados,
                parciales: totalParciales,
                pendientes: Math.max(0, pendientesRaw),
                importeTotal: parseFloat(totalImporte.toFixed(2))
            },
            daily
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in delivery-summary');
        sendRouteError(res, 503, 'REPARTIDOR_DELIVERY_SUMMARY_FAILED');
    }
});

// =============================================================================
// GET /document/albaran/:year/:serie/:terminal/:number/pdf
// Generate Albaran PDF with optional embedded signature
// =============================================================================
router.get('/document/albaran/:year/:serie/:terminal/:number/pdf', verifyToken, async (req, res) => {
    try {
        const { year, terminal, number } = req.params;
        const parsedYear = parseInt(year);
        const parsedTerminal = parseInt(terminal);
        const parsedNumber = parseInt(number);
        if (!parsedYear || !parsedNumber) {
            return res.status(400).json({ success: false, error: 'Parámetros year/number/terminal inválidos' });
        }
        const SENTINEL_SERIES = new Set(['UNK', 'NONE', 'NULL', 'N/A', '0', 'undefined', 'null']);
        const rawSerie = req.params.serie || '';
        const serie = SENTINEL_SERIES.has(rawSerie.toUpperCase()) ? '' : rawSerie.replace(/[^A-Z0-9]/gi, '').substring(0, 3);

        logger.info(`[PDF] Generating Albaran PDF: ${parsedYear}-${serie}-${parsedTerminal}-${parsedNumber}`);

        // 1. Fetch Header from CAC + IVA breakdown from CPC
        const headers = await queryWithParams(`
            SELECT 
                CAC.EJERCICIOALBARAN, CAC.SERIEALBARAN, CAC.NUMEROALBARAN, CAC.TERMINALALBARAN,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.DIADOCUMENTO as DIAFACTURA, CAC.MESDOCUMENTO as MESFACTURA, CAC.ANODOCUMENTO as ANOFACTURA,
                CAC.IMPORTETOTAL,
                CAC.IMPORTEBRUTO,
                CAC.IMPORTEBASEIMPONIBLE1,
                CAC.PORCENTAJEIVA1,
                CAC.IMPORTEIVA1,
                CAC.IMPORTEBASEIMPONIBLE2,
                CAC.PORCENTAJEIVA2,
                CAC.IMPORTEIVA2,
                CAC.IMPORTEBASEIMPONIBLE3,
                CAC.PORCENTAJEIVA3,
                CAC.IMPORTEIVA3,
                CAC.IMPORTEBASEIMPONIBLE4,
                CAC.PORCENTAJEIVA4,
                CAC.IMPORTEIVA4,
                CAC.IMPORTEBASEIMPONIBLE5,
                CAC.PORCENTAJEIVA5,
                CAC.IMPORTEIVA5,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
                TRIM(CLI.NOMBREALTERNATIVO) as NOMBRECOMERCIALFACTURA,
                TRIM(CLI.NOMBRECLIENTE) as NOMBREFISCALFACTURA,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.PROVINCIA, '')) as PROVINCIACLIENTEFACTURA,
                TRIM(COALESCE(CLI.CODIGOPOSTAL, '')) as CPCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
            WHERE CAC.NUMEROALBARAN = ?
              AND (? = '' OR TRIM(CAC.SERIEALBARAN) = ?)
              AND CAC.EJERCICIOALBARAN = ?
              AND CAC.TERMINALALBARAN = ?
            FETCH FIRST 1 ROW ONLY
        `, [parsedNumber, serie, serie, parsedYear, parsedTerminal], false);

        if (!headers || headers.length === 0) {
            return res.status(404).json({ success: false, error: 'Albarán no encontrado' });
        }
        const header = {
            ...headers[0],
            clienteNombre: headers[0].NOMBRECLIENTEFACTURA,
            nombreComercial: headers[0].NOMBRECOMERCIALFACTURA || headers[0].NOMBRECLIENTEFACTURA,
            nombreFiscal: headers[0].NOMBREFISCALFACTURA || headers[0].NOMBRECLIENTEFACTURA,
            clienteId: headers[0].CODIGOCLIENTEFACTURA,
            clienteDireccion: headers[0].DIRECCIONCLIENTEFACTURA,
            clientePoblacion: headers[0].POBLACIONCLIENTEFACTURA,
            clienteNif: headers[0].CIFCLIENTEFACTURA,
            serie: headers[0].SERIEALBARAN,
            numero: headers[0].NUMEROALBARAN,
            total: parseFloat(headers[0].IMPORTETOTAL) || 0,
        };

        header.IVA_BREAKDOWN = {};
        for (let slot = 1; slot <= 5; slot++) {
            header.IVA_BREAKDOWN[`BI${slot}`] = headers[0][`IMPORTEBASEIMPONIBLE${slot}`] || 0;
            header.IVA_BREAKDOWN[`IVA${slot}_PCT`] = headers[0][`PORCENTAJEIVA${slot}`] || 0;
            header.IVA_BREAKDOWN[`IVA${slot}_IMP`] = headers[0][`IMPORTEIVA${slot}`] || 0;
        }

        // Legacy fallback: old CPC headers may carry IVA breakdown when CAC slots are empty.
        try {
            const hasCacBreakdown = Object.values(header.IVA_BREAKDOWN)
                .some(value => Math.abs(parseFloat(value) || 0) > 0);
            const ivaRows = await queryWithParams(`
                SELECT 
                    IMPORTEBASEIMPONIBLE1 as BI1, PORCENTAJEIVA1 as IVA1_PCT, IMPORTEIVA1 as IVA1_IMP,
                    IMPORTEBASEIMPONIBLE2 as BI2, PORCENTAJEIVA2 as IVA2_PCT, IMPORTEIVA2 as IVA2_IMP,
                    IMPORTEBASEIMPONIBLE3 as BI3, PORCENTAJEIVA3 as IVA3_PCT, IMPORTEIVA3 as IVA3_IMP,
                    IMPORTETOTAL
                FROM DSEDAC.CPC
                WHERE EJERCICIOALBARAN = ?
                  AND TRIM(SERIEALBARAN) = ?
                  AND TERMINALALBARAN = ?
                  AND NUMEROALBARAN = ?
                FETCH FIRST 1 ROW ONLY
            `, [year, (serie || '').trim(), terminal, number], false);
            if (!hasCacBreakdown && ivaRows.length > 0) {
                header.IVA_BREAKDOWN = ivaRows[0];
            }
        } catch (e) {
            logger.warn('[PDF] Albaran IVA lookup failed');
        }

        // 2. Fetch Lines from LAC
        const lines = await queryWithParams(`
            SELECT 
                LAC.CODIGOARTICULO,
                LAC.DESCRIPCION as DESCRIPCIONARTICULO,
                '' as LOTEARTICULO,
                LAC.CANTIDADUNIDADES as CANTIDADARTICULO,
                LAC.CANTIDADENVASES as CAJASARTICULO,
                LAC.IMPORTEVENTA as IMPORTENETOARTICULO,
                TRIM(LAC.CODIGOIVA) as CODIGOIVA,
                0 as PORCENTAJERECARGOARTICULO,
                LAC.PORCENTAJEDESCUENTO as PORCENTAJEDESCUENTOARTICULO,
                LAC.PRECIOVENTA as PRECIOARTICULO
            FROM DSEDAC.LAC LAC
            WHERE LAC.EJERCICIOALBARAN = ?
              AND TRIM(LAC.SERIEALBARAN) = ?
              AND LAC.TERMINALALBARAN = ?
              AND LAC.NUMEROALBARAN = ?
            ORDER BY LAC.SECUENCIA
        `, [parsedYear, serie, parsedTerminal, parsedNumber], false) || [];

        // 3. Try to get signature - comprehensive cascade lookup
        let signatureBase64 = null;
        let signatureSource = null;
        const albId = `${parsedYear}-${serie}-${parsedTerminal}-${parsedNumber}`;

        // Step 3a: Check DELIVERY_STATUS for FIRMA_PATH (OLD schema only)
        try {
            const dsOldAvail = isDeliveryStatusAvailable() && !isDeliveryStatusNewSchema();
            if (dsOldAvail) {
                const dsRows = await queryWithParams(`SELECT FIRMA_PATH FROM JAVIER.DELIVERY_STATUS WHERE ID = ?`, [albId], false);
                if (dsRows.length > 0 && dsRows[0].FIRMA_PATH) {
                    const basePaths = [
                        path.join(__dirname, '../../uploads'),
                        path.join(__dirname, '../../uploads/photos')
                    ];
                    for (const basePath of basePaths) {
                        const fullPath = path.join(basePath, dsRows[0].FIRMA_PATH);
                        if (fs.existsSync(fullPath)) {
                            signatureBase64 = (await fsPromises.readFile(fullPath)).toString('base64');
                            signatureSource = 'FILE';
                            logger.info(`[PDF] Found signature file at ${fullPath}`);
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            logger.warn('[PDF] Albaran stored signature lookup failed');
        }

        // Step 3b: Try REPARTIDOR_FIRMAS if no file signature
        if (!signatureBase64) {
            try {
                const firmaRows = await queryWithParams(`
                    SELECT RF.FIRMABASE64 FROM JAVIER.REPARTIDOR_FIRMAS RF
                    INNER JOIN JAVIER.REPARTIDOR_ENTREGAS RE ON RE.ID = RF.ENTREGA_ID
                    WHERE RE.NUMEROORDENPREPARACION = ?
                      AND RE.EJERCICIOALBARAN = ?
                      AND TRIM(RE.SERIEALBARAN) = ?
                    FETCH FIRST 1 ROW ONLY
                `, [parsedNumber, parsedYear, serie], false);
                if (firmaRows.length > 0 && firmaRows[0].FIRMABASE64) {
                    signatureBase64 = firmaRows[0].FIRMABASE64;
                    signatureSource = 'REPARTIDOR_FIRMAS';
                    logger.info(`[PDF] Using signature from REPARTIDOR_FIRMAS`);
                }
            } catch (e) {
                logger.warn('[PDF] Albaran app signature lookup failed');
            }
        }

        // Step 3c: Try CACFIRMAS (legacy ERP signatures) as last resort
        if (!signatureBase64) {
            try {
                const cacRows = await queryWithParams(`
                    SELECT FIRMABASE64 FROM DSEDAC.CACFIRMAS
                    WHERE EJERCICIOALBARAN = ?
                      AND TRIM(SERIEALBARAN) = ?
                      AND TERMINALALBARAN = ?
                      AND NUMEROALBARAN = ?
                    FETCH FIRST 1 ROW ONLY
                `, [parsedYear, serie, parsedTerminal, parsedNumber], false);
                if (cacRows.length > 0 && cacRows[0].FIRMABASE64) {
                    let b64 = cacRows[0].FIRMABASE64;
                    b64 = b64.replace(/^data:image\/\w+;base64,/, '');
                    signatureBase64 = b64;
                    signatureSource = 'CACFIRMAS';
                    logger.info(`[PDF] Using legacy signature from CACFIRMAS`);
                }
            } catch (e) {
                logger.warn('[PDF] Albaran legacy signature lookup failed');
            }
        }

        logger.info(`[PDF] Signature for ${albId}: ${signatureBase64 ? 'FOUND' : 'NOT FOUND'}`);

        // 4. Generate PDF with optional signature (documentType = albaran)
        const buffer = await generateInvoicePDF({ header, lines, signatureBase64, signatureSource, documentType: 'albaran' });

        const safeFilename = `Albaran_${parsedYear}_${serie}_${parsedNumber}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
            'Content-Length': buffer.length,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.send(buffer);

    } catch (e) {
        logger.error('[PDF] Albaran generation failed');
        sendRouteError(res, 503, 'DOCUMENT_PDF_FAILED');
    }
});

// =============================================================================
// GET /config
// Get commission configuration
// =============================================================================
router.get('/config', verifyToken, (req, res) => {
    res.json({
        success: true,
        config: {
            threshold: REPARTIDOR_CONFIG.threshold,
            tiers: REPARTIDOR_CONFIG.tiers.map((t, i) => ({
                tier: i + 1,
                min: t.min,
                max: t.max,
                rate: t.pct
            }))
        }
    });
});

// Legacy writes are retired above; the following endpoint is read-only.
// =============================================================================
// POST /entregas/:entregaId/lineas
// Guardar estado de líneas de artículos
// =============================================================================
// =============================================================================
// POST /cobros
// Registrar un cobro realizado
// =============================================================================
// =============================================================================
// GET /entregas/:entregaId/firma
// Obtener firma de una entrega
// =============================================================================
router.get('/entregas/:entregaId/firma', verifyToken, async (req, res) => {
    try {
        const { entregaId } = req.params;

        const rows = await queryWithParams(`
            SELECT FIRMABASE64, FIRMANOMBRE, DIA, MES, ANO, HORA
            FROM JAVIER.REPARTIDOR_FIRMAS 
            WHERE ENTREGA_ID = ?
            FETCH FIRST 1 ROW ONLY
        `, [entregaId], false);

        if (rows.length === 0) {
            return res.json({ success: true, hasSignature: false });
        }

        const fechaFirma = (rows[0].ANO > 0)
            ? `${rows[0].ANO}-${String(rows[0].MES).padStart(2, '0')}-${String(rows[0].DIA).padStart(2, '0')} ${String(rows[0].HORA).padStart(6, '0').substring(0, 2)}:${String(rows[0].HORA).padStart(6, '0').substring(2, 4)}`
            : null;

        res.json({
            success: true,
            hasSignature: true,
            signature: {
                base64: rows[0].FIRMABASE64,
                firmante: rows[0].FIRMANOMBRE,
                fecha: fechaFirma
            }
        });

    } catch (error) {
        logger.error('[REPARTIDOR] Delivery signature request failed');
        sendRouteError(res, 503, 'REPARTIDOR_SIGNATURE_FAILED');
    }
});

// =============================================================================
// GET /rutero/week/:repartidorId
// Resumen semanal para el calendario (LUN 30, MAR 31...)
// Estado basado en cobros de CONTADO, REPOSICION, MENSUAL
// =============================================================================
router.get('/rutero/week/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { date } = req.query; // Fecha de referencia (ej. hoy)
        const dateResult = parseIsoDate(date, 'DATE');
        if (dateResult.error) return sendRouteError(res, 422, dateResult.error);

        const refDate = date ? new Date(`${date}T12:00:00`) : new Date();
        const currentDay = refDate.getDate();

        // Calculate start/end of week (Monday to Sunday)
        const dayOfWeek = refDate.getDay() || 7; // 1 (Mon) to 7 (Sun)
        const startOfWeek = new Date(refDate);
        startOfWeek.setDate(currentDay - dayOfWeek + 1);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        // Generate array of expected dates
        const weekDays = [];
        const d = new Date(startOfWeek);
        while (d <= endOfWeek) {
            weekDays.push({
                sday: d.getDate(),
                smonth: d.getMonth() + 1,
                syear: d.getFullYear(),
                formatted: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            });
            d.setDate(d.getDate() + 1);
        }

        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        const weekStartNum = weekDays[0].syear * 10000 + weekDays[0].smonth * 100 + weekDays[0].sday;
        const weekEndNum = weekDays[6].syear * 10000 + weekDays[6].smonth * 100 + weekDays[6].sday;

        // One row per complete albaran identity prevents documents with the
        // same number but a different company/year/series/terminal from being
        // merged. Delivery truth comes only from explicit ERP/app state.
        const dsWeekAvail = isDeliveryStatusAvailable();
        const dsWeekJoin = getDeliveryStatusJoin('CPC', 'DS');
        const sql = `
            WITH DOCUMENTOS_SEMANA AS (
                SELECT
                    OPP.DIAREPARTO as DIA,
                    OPP.MESREPARTO as MES,
                    OPP.ANOREPARTO as ANO,
                    CPC.SUBEMPRESAALBARAN,
                    CPC.EJERCICIOALBARAN,
                    CPC.SERIEALBARAN,
                    CPC.TERMINALALBARAN,
                    CPC.NUMEROALBARAN,
                    MAX(CASE
                        WHEN TRIM(CPC.CONFORMADOSN) = 'S'
                          OR CPC.SITUACIONALBARAN IN ('F', 'R') THEN 1
                        ${dsWeekAvail ? "WHEN DS.STATUS = 'ENTREGADO' THEN 1" : ''}
                        ELSE 0
                    END) as ENTREGADO
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.SUBEMPRESA = OPP.SUBEMPRESA
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                ${dsWeekAvail ? dsWeekJoin : ''}
                WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO)
                    BETWEEN ? AND ?
                  AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorIdList.map(() => '?').join(',')})
                GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO, OPP.DIAREPARTO,
                    CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN,
                    CPC.TERMINALALBARAN, CPC.NUMEROALBARAN
            )
            SELECT
                DIA, MES, ANO,
                COUNT(*) as TOTAL_ALBARANES,
                SUM(ENTREGADO) as ENTREGADOS
            FROM DOCUMENTOS_SEMANA
            GROUP BY ANO, MES, DIA
            ORDER BY ANO, MES, DIA
        `;

        const sqlParams = [weekStartNum, weekEndNum, ...repartidorIdList];
        const rows = await queryWithParams(sql, sqlParams, false);

        // Map results to weekDays
        const days = weekDays.map(wd => {
            const row = rows.find(r => r.ANO === wd.syear && r.MES === wd.smonth && r.DIA === wd.sday);

            const totalAlbaranes = row ? parseInt(row.TOTAL_ALBARANES) : 0;
            const entregados = row ? parseInt(row.ENTREGADOS) : 0;

            // Status Logic:
            // 0 albaranes -> 'none' (Gray)
            // all completed -> 'good' (Green)
            // some pending -> 'bad' (Red)
            let status = 'none';
            if (totalAlbaranes > 0) {
                if (entregados >= totalAlbaranes) {
                    status = 'good';
                } else {
                    status = 'bad';
                }
            }

            return {
                date: wd.formatted,
                day: wd.sday,
                dayName: ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'][new Date(wd.formatted).getDay()],
                clients: totalAlbaranes,
                completed: entregados,
                status: status
            };
        });

        res.json({
            success: true,
            days
        });

    } catch (_error) {
        logger.error('[REPARTIDOR] Error in /rutero/week');
        sendRouteError(res, 503, 'REPARTIDOR_WEEK_FAILED');
    }
});


// =============================================================================
// GET /history/:repartidorId
// Retrieve historical deliveries with filtering
// =============================================================================
router.get('/history/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { startDate, endDate, search, limit, offset } = req.query;

        if (!startDate || !endDate) return sendRouteError(res, 400, 'DATE_RANGE_REQUIRED');
        const startResult = parseIsoDate(startDate, 'START_DATE');
        const endResult = parseIsoDate(endDate, 'END_DATE');
        const pagination = parsePagination({ limit, offset });
        const validationError = startResult.error || endResult.error || pagination.limit.error || pagination.offset.error;
        if (validationError) return sendRouteError(res, 422, validationError);
        if (startResult.value > endResult.value) return sendRouteError(res, 422, 'DATE_RANGE_INVALID');

        const startInt = startResult.value;
        const endInt = endResult.value;
        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;

        logger.info(`[REPARTIDOR] History for ${repartidorId} from ${startInt} to ${endInt}`);

        const dsHistAvail = isDeliveryStatusAvailable();
        const dsHistJoin = getDeliveryStatusJoin('CPC', 'DS');
        let sql = `
            SELECT 
                CPC.ANODOCUMENTO || '-' || RIGHT('0' || CPC.MESDOCUMENTO, 2) || '-' || RIGHT('0' || CPC.DIADOCUMENTO, 2) as FECHA,
                CPC.NUMEROALBARAN,
                CPC.SERIEALBARAN,
                CPC.EJERCICIOALBARAN,
                CAC.NUMEROFACTURA,
                CAC.SERIEFACTURA,
                CAC.EJERCICIOFACTURA,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CODIGO_CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE,
                CPC.IMPORTETOTAL as TOTAL,
                ${dsHistAvail ? "DS.STATUS as ESTADO_ENTREGA" : "CAST(NULL AS VARCHAR(20)) as ESTADO_ENTREGA"},
                ${dsHistAvail && !isDeliveryStatusNewSchema() ? "DS.FIRMA_PATH" : "CAST(NULL AS VARCHAR(255)) as FIRMA_PATH"}
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                AND CPC.SUBEMPRESA = OPP.SUBEMPRESA
                AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI 
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            ${dsHistAvail ? dsHistJoin : ''}
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
              AND TRIM(OPP.CODIGOREPARTIDOR) IN (${repartidorIdList.map(() => '?').join(',')})
        `;

        const sqlParams = [startInt, endInt, ...repartidorIdList];

        if (search) {
            const cleanSearch = `%${search.toUpperCase()}%`;
            sql += ` AND (
                UPPER(CLI.NOMBRECLIENTE) LIKE ? OR 
                UPPER(CLI.NOMBREALTERNATIVO) LIKE ? OR
                CAST(CPC.NUMEROALBARAN AS CHAR(20)) LIKE ? OR
                CAST(CAC.NUMEROFACTURA AS CHAR(20)) LIKE ?
            )`;
            sqlParams.push(cleanSearch, cleanSearch, cleanSearch, cleanSearch);
        }

        sql += ` ORDER BY FECHA DESC, CPC.EJERCICIOALBARAN DESC, CPC.NUMEROALBARAN DESC, CPC.SERIEALBARAN DESC
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;
        sqlParams.push(pagination.offset.value, pagination.limit.value);

        const rows = await queryWithParams(sql, sqlParams, false) || [];

        res.json({
            success: true,
            count: rows.length,
            pagination: { limit: pagination.limit.value, offset: pagination.offset.value },
            data: rows
        });
    } catch (_error) {
        logger.error('[REPARTIDOR] Error in /history');
        sendRouteError(res, 503, 'REPARTIDOR_HISTORY_FAILED');
    }
});

// =============================================================================
// GET /document/invoice/:year/:serie/:number/pdf
// Generate formal Invoice PDF
// =============================================================================
router.get('/document/invoice/:year/:serie/:number/pdf', verifyToken, async (req, res) => {
    try {
        const { year, number } = req.params;
        const { albaranNumber, albaranSerie, albaranTerminal, albaranYear } = req.query;

        const parsedYear = parseInt(req.params.year);
        const parsedNumber = parseInt(req.params.number);
        if (!parsedYear || !parsedNumber) {
            return res.status(400).json({ success: false, error: 'Parámetros year/number inválidos' });
        }
        const SENTINEL_SERIES = new Set(['UNK', 'NONE', 'NULL', 'N/A', '0', 'undefined', 'null']);
        const rawSerie = req.params.serie || '';
        const serie = SENTINEL_SERIES.has(rawSerie.toUpperCase()) ? '' : rawSerie.replace(/[^A-Z0-9]/gi, '').substring(0, 3);

        logger.info(`[PDF] Generating Invoice PDF: ${year}-${serie}-${number} (albaran fallback: ${albaranNumber || 'none'})`);

        // Build header SELECT columns (reused by both queries)
        const headerCols = `
                CAC.EJERCICIOALBARAN, CAC.SERIEALBARAN, CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.TERMINALALBARAN,
                CAC.DIADOCUMENTO as DIAFACTURA, CAC.MESDOCUMENTO as MESFACTURA, CAC.ANODOCUMENTO as ANOFACTURA,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
                TRIM(CLI.NOMBREALTERNATIVO) as NOMBRECOMERCIALFACTURA,
                TRIM(CLI.NOMBRECLIENTE) as NOMBREFISCALFACTURA,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.PROVINCIA, '')) as PROVINCIACLIENTEFACTURA,
                TRIM(COALESCE(CLI.CODIGOPOSTAL, '')) as CPCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA`;

        let headers = await queryWithParams(`
            SELECT ${headerCols}
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
            WHERE CAC.NUMEROFACTURA = ?
              AND (? = '' OR TRIM(CAC.SERIEFACTURA) = ?)
              AND CAC.EJERCICIOFACTURA = ?
            FETCH FIRST 1 ROW ONLY
        `, [parsedNumber, serie, serie, parsedYear], false);

        const parsedAlbaranNumber = parseInt(albaranNumber);
        const parsedAlbaranYear = parseInt(albaranYear || year);
        const parsedAlbaranTerminal = parseInt(albaranTerminal || 0);
        const albaranSerieNorm = albaranNumber
            ? (SENTINEL_SERIES.has((albaranSerie || '').toUpperCase()) ? '' : (albaranSerie || '').replace(/[^A-Z0-9]/gi, '').substring(0, 3))
            : null;

        if ((!headers || headers.length === 0) && parsedAlbaranNumber) {
            logger.info(`[PDF] Factura query returned 0 rows, trying albaran fallback: ${parsedAlbaranYear}-${albaranSerieNorm}-${parsedAlbaranTerminal}-${parsedAlbaranNumber}`);
            headers = await queryWithParams(`
                SELECT ${headerCols}
                FROM DSEDAC.CAC CAC
                LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
                WHERE CAC.NUMEROALBARAN = ?
                  AND (? = '' OR TRIM(CAC.SERIEALBARAN) = ?)
                  AND CAC.EJERCICIOALBARAN = ?
                  AND CAC.TERMINALALBARAN = ?
                FETCH FIRST 1 ROW ONLY
            `, [parsedAlbaranNumber, albaranSerieNorm, albaranSerieNorm, parsedAlbaranYear, parsedAlbaranTerminal], false);
        }

        // 1C. Last resort: Try factura number as albaran number (Flutter may pass albaran number)
        if (!headers || headers.length === 0) {
            logger.info(`[PDF] Both queries failed, trying albaran-as-number fallback: ${parsedYear}-${serie}-${parsedNumber}`);
            headers = await queryWithParams(`
                SELECT ${headerCols}
                FROM DSEDAC.CAC CAC
                LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
                WHERE CAC.NUMEROALBARAN = ?
                  AND (? = '' OR TRIM(CAC.SERIEALBARAN) = ?)
                  AND CAC.EJERCICIOALBARAN = ?
                FETCH FIRST 1 ROW ONLY
            `, [parsedNumber, serie, serie, parsedYear], false);
        }

        if (!headers || headers.length === 0) {
            logger.warn(`[PDF] Invoice not found for any query combination: ${year}-${serie}-${number}`);
            return res.status(404).json({ success: false, error: 'Factura no encontrada (CAC)' });
        }
        const header = {
            ...headers[0],
            clienteNombre: headers[0].NOMBRECLIENTEFACTURA,
            nombreComercial: headers[0].NOMBRECOMERCIALFACTURA || headers[0].NOMBRECLIENTEFACTURA,
            nombreFiscal: headers[0].NOMBREFISCALFACTURA || headers[0].NOMBRECLIENTEFACTURA,
            clienteId: headers[0].CODIGOCLIENTEFACTURA,
            clienteDireccion: headers[0].DIRECCIONCLIENTEFACTURA,
            clientePoblacion: headers[0].POBLACIONCLIENTEFACTURA,
            clienteNif: headers[0].CIFCLIENTEFACTURA,
        };
        const actualEjAlb = header.EJERCICIOALBARAN;
        const actualSerieAlb = (header.SERIEALBARAN || '').toString().trim();
        const actualTermAlb = header.TERMINALALBARAN || 0;
        const actualNumAlb = header.NUMEROALBARAN;

        logger.info(`[PDF] Found CAC header: albaran=${actualEjAlb}-${actualSerieAlb}-${actualTermAlb}-${actualNumAlb}, factura=${header.EJERCICIOFACTURA}-${(header.SERIEFACTURA || '').toString().trim()}-${header.NUMEROFACTURA}`);

        // Fetch IVA breakdown from CPC
        try {
            const ivaRows = await queryWithParams(`
                SELECT 
                    IMPORTEBASEIMPONIBLE1 as BI1, PORCENTAJEIVA1 as IVA1_PCT, IMPORTEIVA1 as IVA1_IMP,
                    IMPORTEBASEIMPONIBLE2 as BI2, PORCENTAJEIVA2 as IVA2_PCT, IMPORTEIVA2 as IVA2_IMP,
                    IMPORTEBASEIMPONIBLE3 as BI3, PORCENTAJEIVA3 as IVA3_PCT, IMPORTEIVA3 as IVA3_IMP,
                    IMPORTETOTAL
                FROM DSEDAC.CPC
                WHERE EJERCICIOALBARAN = ?
                  AND TRIM(SERIEALBARAN) = ?
                  AND TERMINALALBARAN = ?
                  AND NUMEROALBARAN = ?
                FETCH FIRST 1 ROW ONLY
            `, [actualEjAlb, actualSerieAlb, actualTermAlb, actualNumAlb], false);
            if (ivaRows.length > 0) {
                header.IVA_BREAKDOWN = ivaRows[0];
            }
        } catch (e) {
            logger.warn('[PDF] Invoice IVA lookup failed');
        }

        // 2. Fetch Lines - use albaran fields from found header for reliable join
        const lines = await queryWithParams(`
            SELECT 
                LAC.CODIGOARTICULO,
                LAC.DESCRIPCION as DESCRIPCIONARTICULO,
                '' as LOTEARTICULO,
                LAC.CANTIDADUNIDADES as CANTIDADARTICULO,
                LAC.CANTIDADENVASES as CAJASARTICULO,
                LAC.IMPORTEVENTA as IMPORTENETOARTICULO,
                TRIM(LAC.CODIGOIVA) as CODIGOIVA,
                0 as PORCENTAJERECARGOARTICULO,
                LAC.PORCENTAJEDESCUENTO as PORCENTAJEDESCUENTOARTICULO,
                LAC.PRECIOVENTA as PRECIOARTICULO
            FROM DSEDAC.LAC LAC
            WHERE LAC.EJERCICIOALBARAN = ?
              AND TRIM(LAC.SERIEALBARAN) = ?
              AND LAC.TERMINALALBARAN = ?
              AND LAC.NUMEROALBARAN = ?
            ORDER BY LAC.SECUENCIA
        `, [actualEjAlb, actualSerieAlb, actualTermAlb, actualNumAlb], false) || [];

        // 3. Try to get signature - comprehensive cascade (same as albaran PDF)
        let signatureBase64 = null;
        let signatureSource = null;
        const albId = `${actualEjAlb}-${actualSerieAlb}-${actualTermAlb}-${actualNumAlb}`;

        // Step 3a: DELIVERY_STATUS (OLD schema only)
        try {
            const dsOldAvail = isDeliveryStatusAvailable() && !isDeliveryStatusNewSchema();
            if (dsOldAvail) {
                const dsRows = await queryWithParams(`SELECT FIRMA_PATH FROM JAVIER.DELIVERY_STATUS WHERE ID = ?`, [albId], false);
                if (dsRows.length > 0 && dsRows[0].FIRMA_PATH) {
                    const basePaths = [
                        path.join(__dirname, '../../uploads'),
                        path.join(__dirname, '../../uploads/photos')
                    ];
                    for (const basePath of basePaths) {
                        const fullPath = path.join(basePath, dsRows[0].FIRMA_PATH);
                        if (fs.existsSync(fullPath)) {
                            signatureBase64 = (await fsPromises.readFile(fullPath)).toString('base64');
                            signatureSource = 'FILE';
                            break;
                        }
                    }
                }
            }
        } catch (e) { logger.warn('[PDF] Invoice stored signature lookup failed'); }

        // Step 3b: REPARTIDOR_FIRMAS
        if (!signatureBase64) {
            try {
                const firmaRows = await queryWithParams(`
                    SELECT RF.FIRMABASE64 FROM JAVIER.REPARTIDOR_FIRMAS RF
                    INNER JOIN JAVIER.REPARTIDOR_ENTREGAS RE ON RE.ID = RF.ENTREGA_ID
                    WHERE RE.NUMEROORDENPREPARACION = ?
                      AND RE.EJERCICIOALBARAN = ?
                      AND TRIM(RE.SERIEALBARAN) = ?
                    FETCH FIRST 1 ROW ONLY
                `, [actualNumAlb, actualEjAlb, actualSerieAlb], false);
                if (firmaRows.length > 0 && firmaRows[0].FIRMABASE64) {
                    signatureBase64 = firmaRows[0].FIRMABASE64;
                    signatureSource = 'REPARTIDOR_FIRMAS';
                }
            } catch (e) { logger.warn('[PDF] Invoice app signature lookup failed'); }
        }

        // Step 3c: CACFIRMAS legacy
        if (!signatureBase64) {
            try {
                const cacRows = await queryWithParams(`
                    SELECT FIRMABASE64 FROM DSEDAC.CACFIRMAS
                    WHERE EJERCICIOALBARAN = ?
                      AND TRIM(SERIEALBARAN) = ?
                      AND TERMINALALBARAN = ?
                      AND NUMEROALBARAN = ?
                    FETCH FIRST 1 ROW ONLY
                `, [actualEjAlb, actualSerieAlb, actualTermAlb, actualNumAlb], false);
                if (cacRows.length > 0 && cacRows[0].FIRMABASE64) {
                    let b64 = cacRows[0].FIRMABASE64.toString();
                    b64 = b64.replace(/^data:image\/\w+;base64,/, '');
                    signatureBase64 = b64;
                    signatureSource = 'CACFIRMAS';
                }
            } catch (e) { logger.warn('[PDF] Invoice legacy signature lookup failed'); }
        }

        logger.info(`[PDF] Invoice signature for ${albId}: ${signatureBase64 ? 'FOUND' : 'NOT FOUND'}`);

        // 4. Generate PDF with signature (documentType = factura)
        const buffer = await generateInvoicePDF({ header, lines, signatureBase64, signatureSource, documentType: 'factura' });

        // 5. Send Response
        const factNum = header.NUMEROFACTURA || number;
        const factSerie = (header.SERIEFACTURA || serie || '').toString().trim();
        const safeFilename = `Factura_${year}_${factSerie}_${factNum}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
            'Content-Length': buffer.length,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.send(buffer);

    } catch (e) {
        logger.error('[PDF] Invoice generation failed');
        sendRouteError(res, 503, 'DOCUMENT_PDF_FAILED');
    }
});


// =============================================================================
// GET /history/clients/:repartidorId
// Get clients with delivery history from OPP + client info from CLI
// Uses ONLY columns verified to exist: OPP.CODIGOREPARTIDOR, CLI.CODIGOCLIENTE,
// CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, CLI.DIRECCION, CLI.ANOBAJA
// =============================================================================
router.get('/history/clients/:repartidorId', verifyToken, async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { search, limit, offset } = req.query;
        const pagination = parsePagination({ limit, offset }, REPARTIDOR_READ_PAGE_MAX, 1000000);
        const validationError = pagination.limit.error || pagination.offset.error;
        if (validationError) return sendRouteError(res, 422, validationError);

        const repartidorIdList = authorizedRepartidorIds(req, res, repartidorId);
        if (!repartidorIdList) return;
        const fetchLimit = pagination.limit.value + pagination.offset.value + 1;

        // FIX: Use chunkedInQuery to handle 90+ repartidor IDs without exceeding DB2 ODBC parameter limits
        const rows = await chunkedInQuery(
            `
            SELECT
                TRIM(UNIQ.CODIGOCLIENTEALBARAN) as ID,
                TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) as NAME,
                TRIM(COALESCE(CLI.DIRECCION, '')) as ADDRESS,
                COUNT(*) as TOTAL_DOCS,
                COALESCE(SUM(UNIQ.IMPORTETOTAL), 0) as TOTAL_AMOUNT,
                MAX(UNIQ.ANODOCUMENTO * 10000 + UNIQ.MESDOCUMENTO * 100 + UNIQ.DIADOCUMENTO) as LAST_VISIT
            FROM (
                SELECT DISTINCT
                    CPC.CODIGOCLIENTEALBARAN,
                    CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                    CPC.IMPORTETOTAL,
                    CPC.ANODOCUMENTO, CPC.MESDOCUMENTO, CPC.DIADOCUMENTO
                FROM DSEDAC.CPC CPC
                INNER JOIN DSEDAC.OPP OPP
                    ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
                    AND OPP.SUBEMPRESA = CPC.SUBEMPRESA
                    AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
                WHERE @IN_IDS@
                  AND CPC.NUMEROALBARAN < 900000
                  AND CPC.EJERCICIOALBARAN > 0
            ) UNIQ
            LEFT JOIN DSEDAC.CLI CLI
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(UNIQ.CODIGOCLIENTEALBARAN)
            WHERE (CLI.ANOBAJA = 0 OR CLI.ANOBAJA IS NULL)
              @CLIENT_SEARCH@
            GROUP BY TRIM(UNIQ.CODIGOCLIENTEALBARAN), TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')), TRIM(COALESCE(CLI.DIRECCION, ''))
            ORDER BY LAST_VISIT DESC, ID ASC
            FETCH FIRST ? ROWS ONLY
            `,
            'TRIM(OPP.CODIGOREPARTIDOR)',
            repartidorIdList,
            async (sql, params) => {
                // Apply search filter to each chunk query
                const searchFilter = search
                    ? `AND (UPPER(CLI.NOMBRECLIENTE) LIKE ? OR UPPER(CLI.NOMBREALTERNATIVO) LIKE ? OR TRIM(UNIQ.CODIGOCLIENTEALBARAN) LIKE ?)`
                    : '';
                const finalSql = sql.replace('@CLIENT_SEARCH@', searchFilter);
                const finalParams = [...params];
                if (search) {
                    const cleanSearch = `%${search.toUpperCase()}%`;
                    finalParams.push(cleanSearch, cleanSearch, cleanSearch);
                }
                finalParams.push(fetchLimit);
                const cacheKey = `repartidor:clients:${repartidorIdList.join(',')}:${search || ''}:${fetchLimit}`;
                return cachedQuery(queryWithParams, finalSql, cacheKey, TTL.REALTIME, finalParams);
            },
            20
        );
        logger.info(`[REPARTIDOR] Found ${rows.length} clients with deliveries for ${repartidorId}`);

        // Deduplicate by client ID (a client may appear with different repartidors)
        const seen = new Map();
        rows.forEach(r => {
            const id = (r.ID || '').trim();
            if (!id) return;
            const existing = seen.get(id);
            const lv = r.LAST_VISIT || 0;
            if (!existing || lv > existing.LAST_VISIT) {
                seen.set(id, r);
            }
        });

        const sortedClients = Array.from(seen.values())
            .sort((a, b) => (Number(b.LAST_VISIT) - Number(a.LAST_VISIT)) || String(a.ID).localeCompare(String(b.ID)));
        const hasMore = sortedClients.length > pagination.offset.value + pagination.limit.value;
        const clients = sortedClients
            .slice(pagination.offset.value, pagination.offset.value + pagination.limit.value)
            .map(r => {
            const id = (r.ID || '').trim();
            const lv = r.LAST_VISIT || 0;
            const lvYear = Math.floor(lv / 10000);
            const lvMonth = Math.floor((lv % 10000) / 100);
            const lvDay = lv % 100;
            const lastVisitStr = lv > 0
                ? `${String(lvDay).padStart(2, '0')}/${String(lvMonth).padStart(2, '0')}/${lvYear}`
                : null;

            return {
                id,
                name: (r.NAME || '').trim() || `CLIENTE ${id}`,
                address: (r.ADDRESS || '').trim(),
                totalDocuments: parseInt(r.TOTAL_DOCS) || 0,
                totalAmount: parseFloat(r.TOTAL_AMOUNT) || 0,
                lastVisit: lastVisitStr,
                repCode: null,
                repName: null
            };
        });

        res.json({
            success: true,
            clients,
            pagination: { limit: pagination.limit.value, offset: pagination.offset.value, hasMore }
        });
    } catch (_error) {
        logger.error('[REPARTIDOR] Error getting history clients');
        sendRouteError(res, 503, 'REPARTIDOR_CLIENTS_FAILED');
    }
});

// =============================================================================
// GET /history/legacy-signature/:id
// Returns the Base64 signature from CACFIRMAS as an image
// =============================================================================
router.get('/history/legacy-signature/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params; // Format: YEAR-SERIES-TERMINAL-NUMBER
        const parts = id.split('-');
        if (parts.length < 4) return res.status(400).send('Invalid ID format');

        const [year, series, terminal, number] = parts;

        const rows = await queryWithParams(`
            SELECT FIRMABASE64
            FROM DSEDAC.CACFIRMAS
            WHERE EJERCICIOALBARAN = ?
              AND TRIM(SERIEALBARAN) = ?
              AND TERMINALALBARAN = ?
              AND NUMEROALBARAN = ?
        `, [year, (series || '').trim(), terminal, number], false);
        if (rows.length === 0 || !rows[0].FIRMABASE64) {
            return sendRouteError(res, 404, 'SIGNATURE_NOT_FOUND');
        }

        let base64Image = rows[0].FIRMABASE64;
        base64Image = base64Image.replace(/^data:image\/\w+;base64,/, "");
        const imgBuffer = Buffer.from(base64Image, 'base64');

        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': imgBuffer.length
        });
        res.end(imgBuffer);

    } catch (error) {
        logger.error('[REPARTIDOR] Legacy signature request failed');
        sendRouteError(res, 503, 'REPARTIDOR_SIGNATURE_FAILED');
    }
});

// =============================================================================
// POST /document/send-email
// Server-side email sending with PDF attachment for repartidor documents
// =============================================================================
router.post('/document/send-email', verifyToken, (_req, res) => {
    return sendRouteError(res, 503, 'EMAIL_DELIVERY_LEDGER_REQUIRED');
});

// =============================================================================
// POST /document/share/whatsapp
// WhatsApp share with PDF base64 for repartidor documents (albaranes/facturas)
// =============================================================================
router.post('/document/share/whatsapp', verifyToken, (req, res) => {
    const phone = String(req.body?.telefono || '').replace(/\D/g, '');
    if (!/^\d{7,15}$/.test(phone)) {
        return sendRouteError(res, 422, 'PHONE_INVALID');
    }
    const key = req.documentOwnershipKey;
    const documentType = Object.prototype.hasOwnProperty.call(key, 'terminal') ? 'Albaran' : 'Factura';
    const reference = `${key.series}-${key.number}`;
    const message = `Granja Mari Pepa\n\n${documentType}: ${reference}\n\nEl usuario debe confirmar el envio desde su dispositivo.`;
    return res.json({
        success: true,
        whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
        message,
        localShare: true,
        sent: false,
        deliveryConfirmed: false,
        shareMode: 'LOCAL_USER_ACTION'
    });
});

module.exports = router;
module.exports.repartidorBreaker = repartidorBreaker;
