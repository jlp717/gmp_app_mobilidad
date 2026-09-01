'use strict';

const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const logger = require('../middleware/logger');
const { verifyToken } = require('../middleware/auth');
const financeService = require('../services/repartidor-finance-service');
const {
  dailySummaryController,
  vencimientosController,
  commissionsSummaryController,
} = require('../src/controllers/repartidorFinanzas.controller');
const repartoVarianceNotificationService = require('../services/reparto-variance-notification-service');
const {
  processLiquidacionOutboxIntent,
  requeueFailedLiquidacionOutbox,
} = require('../services/repartidor-liquidacion-outbox-service');
const {
  buildConfirmationCommand,
  RepartoContractError,
} = require('../services/reparto-confirmation-contract');
const { RepartoPersistenceError } = require('../services/reparto-confirmation-service');
const { RepartoCatalogError } = require('../services/reparto-catalog-service');
const { createRepartoConfirmationRuntime } = require('../services/reparto-confirmation-factory');
const {
  EvidenceError,
  PHOTO_MAX_BYTES,
  unavailableDeliveryEvidenceService,
} = require('../services/delivery-evidence-service');
const { deleteCachePattern, invalidateCache } = require('../services/redis-cache');
const { sendEmailWithPdf, generateDeliveryEmailHtml } = require('../services/emailPdfService');
const whatsappGateway = require('../services/whatsappGatewayService');
const {
  RepartoEmailDeliveryPolicyError,
  resolveRepartoEmailDelivery,
  buildRepartoMessageId,
} = require('../services/reparto-email-delivery-policy');
const {
  recordDocumentEmailLedger,
} = require('../repositories/repartidor-route-db2-repository');

let Sentry = null;
try {
  Sentry = require('@sentry/node');
} catch (_) {
  Sentry = null;
}

const router = express.Router();

// No DB2 repository is wired here by default. The factory is intentionally
// fail-closed until the isolated TEST_REPARTO capability gate is approved.
function buildCanonicalRuntime(dependencies) {
  const confirmation = createRepartoConfirmationRuntime(dependencies);
  return Object.freeze({
    ...confirmation,
    evidenceService: dependencies?.evidenceService || unavailableDeliveryEvidenceService(),
    receiptService: dependencies?.receiptService || Object.freeze({
      async getReceipt() {
        throw new RepartoPersistenceError('El recibo canÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³nico de reparto no estÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ habilitado en este entorno', { code: 'REPARTO_RECEIPT_RUNTIME_UNAVAILABLE', statusCode: 503 });
      },
    }),
    receiptPdfService: dependencies?.receiptPdfService || Object.freeze({
      async render() {
        throw new RepartoPersistenceError('El generador canÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³nico de recibos no estÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ habilitado en este entorno', { code: 'REPARTO_RECEIPT_RUNTIME_UNAVAILABLE', statusCode: 503 });
      },
    }),
    recordDocumentEmailLedger: dependencies?.recordDocumentEmailLedger || recordDocumentEmailLedger,
  });
}

let canonicalConfirmationRuntime = buildCanonicalRuntime();

function setCanonicalConfirmationRuntime(dependencies) {
  canonicalConfirmationRuntime = buildCanonicalRuntime(dependencies);
}

function resetCanonicalConfirmationRuntime() {
  canonicalConfirmationRuntime = buildCanonicalRuntime();
}

function unavailableLiquidacionService() {
  const unavailable = async () => {
    throw new RepartoPersistenceError('La liquidacion transaccional no esta habilitada en este entorno', {
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
    });
  };
  return Object.freeze({
    closeDay: unavailable, createExpense: unavailable, createAdjustment: unavailable,
    createBankDeposit: unavailable, getDayEntries: unavailable,
  });
}

let canonicalLiquidacionService = unavailableLiquidacionService();

function setCanonicalLiquidacionService(service) {
  if (!service || typeof service.closeDay !== 'function') {
    throw new TypeError('liquidacionService.closeDay is required');
  }
  const fallback = unavailableLiquidacionService();
  const bind = (name) => typeof service[name] === 'function'
    ? service[name].bind(service) : fallback[name];
  canonicalLiquidacionService = Object.freeze({
    closeDay: bind('closeDay'), createExpense: bind('createExpense'),
    createAdjustment: bind('createAdjustment'), createBankDeposit: bind('createBankDeposit'),
    getDayEntries: bind('getDayEntries'),
  });
}

function resetCanonicalLiquidacionService() {
  canonicalLiquidacionService = unavailableLiquidacionService();
}

function requireCanonicalConfirmationRole(req, res, next) {
  const user = req.user;
  if (!user || !(user.id || user.user || user.code)) {
    return res.status(401).json({
      success: false,
      code: 'AUTHENTICATED_ACTOR_REQUIRED',
      error: 'Contexto autenticado incompleto',
    });
  }
  const role = String(user.role || '').trim().toUpperCase();
  const activeMode = String(user.activeMode || '').trim().toUpperCase();
  // JEFE in Perfil Reparto (activeMode=REPARTIDOR) may supervise confirmations.
  const allowed = role === 'REPARTIDOR'
    || ((role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode === 'REPARTIDOR');
  if (!allowed) {
    return res.status(403).json({
      success: false,
      code: 'REPARTO_CONFIRMATION_ROLE_REQUIRED',
      error: 'Solo un repartidor o administrador puede confirmar una entrega',
    });
  }
  return next();
}

const EVIDENCE_REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REPARTO_EVIDENCE_REQUEST_TIMEOUT_MS, 10) || 15000;
const EVIDENCE_TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'HYT00', 'HYT01']);
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1, fields: 3, parts: 4, fieldSize: 16 * 1024 },
});

function actorCode(user) {
  return String(user?.code || user?.id || user?.user || '').trim();
}

function evidenceRepartidorId(req, requested) {
  const role = String(req.user?.role || '').trim().toUpperCase();
  const activeMode = String(req.user?.activeMode || '').trim().toUpperCase();
  const authenticated = actorCode(req.user);
  const target = String(requested || '').trim();
  if (target && (target.toUpperCase() === 'ALL'
      || target.includes(',') || !/^[A-Za-z0-9_-]{1,20}$/.test(target))) {
    throw new EvidenceError('EVIDENCE_REPARTIDOR_REQUIRED', 'Debe seleccionarse un unico repartidor concreto', 422);
  }
  const visible = financeFleetCodes(req.user);
  if (role === 'REPARTIDOR') {
    if (visible.length !== 1 || !codesMatch(visible[0], authenticated)) {
      throw new EvidenceError('EVIDENCE_OWNERSHIP_REQUIRED', 'No tienes permisos para esta entrega', 403);
    }
    if (target && !codesMatch(visible[0], target)) {
      throw new EvidenceError('EVIDENCE_OWNERSHIP_REQUIRED', 'No tienes permisos para esta entrega', 403);
    }
    return visible[0];
  }
  if ((role !== 'JEFE_VENTAS' && role !== 'ADMIN') || activeMode !== 'REPARTIDOR') {
    throw new EvidenceError('EVIDENCE_REPARTO_MODE_REQUIRED', 'Activa el Perfil Reparto', 403);
  }
  if (!target) {
    throw new EvidenceError('EVIDENCE_REPARTIDOR_REQUIRED', 'Debe seleccionarse un unico repartidor concreto', 422);
  }
  const selected = visible.find((code) => codesMatch(code, target));
  if (!selected) {
    throw new EvidenceError('EVIDENCE_OWNERSHIP_REQUIRED', 'No tienes permisos para esta entrega', 403);
  }
  return selected;
}

function evidenceSelection(req, requested) {
  const repartidorId = evidenceRepartidorId(req, requested);
  const role = String(req.user?.role || '').trim().toUpperCase();
  return {
    repartidorId,
    allowedRepartidorIds: role === 'REPARTIDOR' ? [repartidorId] : financeFleetCodes(req.user),
  };
}

function artifactActor(req, requested) {
  return { role: req.user?.role, repartidorId: evidenceRepartidorId(req, requested) };
}

function evidenceDocumentId(body) {
  return body?.documentId || body?.entregaId;
}

function setEvidenceRequestTimeout(req, res) {
  req.setTimeout?.(EVIDENCE_REQUEST_TIMEOUT_MS);
  res.setTimeout?.(EVIDENCE_REQUEST_TIMEOUT_MS);
}

let canonicalReceiptTimeoutMs = EVIDENCE_REQUEST_TIMEOUT_MS;

function setCanonicalReceiptTimeoutMs(value) {
  if (!Number.isInteger(value) || value < 1 || value > 60000) throw new TypeError('receipt timeout must be between 1 and 60000 ms');
  canonicalReceiptTimeoutMs = value;
}

function withCanonicalReceiptTimeout(work) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const timeoutError = new RepartoPersistenceError('El recibo no se pudo generar a tiempo', { code: 'REPARTO_RECEIPT_TIMEOUT', statusCode: 504 });
      reject(timeoutError);
      controller.abort(timeoutError);
    }, canonicalReceiptTimeoutMs);
  });
  // Receipt reads are intentionally not retried: they carry PII and a timeout
  // can mean the authoritative ledger state is still being resolved.
  return Promise.race([Promise.resolve().then(() => work(controller.signal)), timeout])
    .finally(() => clearTimeout(timer));
}
function isEvidenceTimeout(error) {
  const codes = [
    error?.code,
    error?.cause?.code,
    ...(Array.isArray(error?.odbcErrors)
      ? error.odbcErrors.flatMap((item) => [item?.state, item?.code])
      : []),
  ].map((code) => String(code || '').trim().toUpperCase());
  return codes.some((code) => EVIDENCE_TIMEOUT_CODES.has(code));
}

function sendEvidenceError(res, error, action) {
  if (isEvidenceTimeout(error)) {
    return sendError(res, new EvidenceError(
      'EVIDENCE_TIMEOUT',
      'El almacen de evidencias no respondio a tiempo',
      504,
    ), { action });
  }
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      code: tooLarge ? 'EVIDENCE_TOO_LARGE' : 'INVALID_EVIDENCE_MULTIPART',
      error: tooLarge ? 'La evidencia supera el límite de 4 MiB' : 'Formulario multipart inválido',
    });
  }
  return sendError(res, error, { action });
}

const {
  singleCodeSchema,
  numericCodeSchema,
  dateSchema,
  idempotencyTokenSchema,
  liquidacionPdfParamsSchema,
  liquidacionPdfQuerySchema,
  detailDocIdSchema,
  moneySchema,
  paramsSchema,
  codeListSchema,
  listParamsSchema,
  numericParamsSchema,
  dailySummaryQuerySchema,
  summaryQuerySchema,
  vencimientosQuerySchema,
  cobroSchema,
  legacyLiquidacionSchema,
  liquidacionCloseSchema,
  parseLiquidacionCloseRequest,
  tiersSchema,
  rangeQuerySchema,
  UnsupportedRepartidorSelectorError,
  assertExplicitRepartidorSelector,
  normalizedRepartidorSelection,
} = require('../src/validators/repartidorFinanzas.validators');

function hasFinanceListRole(user) {
  const role = String(user?.role || '').trim().toUpperCase();
  const activeMode = String(user?.activeMode || '').trim().toUpperCase();
  return (role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode === 'REPARTIDOR';
}

function financeFleetCodes(user) {
  return (Array.isArray(user?.repartidorCodes) ? user.repartidorCodes : [])
    .filter((code) => typeof code === 'string' || typeof code === 'number')
    .map(normalizeCode).filter(Boolean);
}

function requireFinanceRepartidorSelector(req, res, next) {
  try {
    // Validate the selector before ownership checks. Otherwise malformed
    // values are misclassified as a foreign-driver 403 instead of a typed
    // client error and the HTTP contract becomes ambiguous.
    const { repartidorId } = listParamsSchema.parse(req.params);
    const selected = normalizedRepartidorSelection(repartidorId);
    if (selected.length > 1 && !hasFinanceListRole(req.user)) {
      return res.status(403).json({
        success: false,
        code: 'MULTIPLE_REPARTIDOR_SELECTOR_FORBIDDEN',
        error: 'Solo JEFE_VENTAS o ADMIN pueden consultar varios repartidores',
      });
    }
    return next();
  } catch (error) {
    return sendError(res, error, {
      action: 'repartidor selector',
      params: req.params,
    });
  }
}

function captureException(error, context) {
  if (Sentry && typeof Sentry.captureException === 'function') {
    const rawCode = String(error?.code || '').trim().toUpperCase();
    const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode) ? rawCode : 'UNEXPECTED_ERROR';
    const statusCode = Number.isInteger(error?.statusCode)
      && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
    // A plain allowlisted incident deliberately has no message, stack, cause,
    // SQL, binds or driver-owned properties. Never forward the original Error.
    const safeIncident = Object.freeze({ name: 'RepartidorFinanzasIncident', code, statusCode });
    Sentry.captureException(safeIncident, { extra: sentryContext(context) });
  }
}

function sentryContext(context) {
  // Strictly copy this fixed allowlist. Request payloads, identifiers and any
  // nested value can contain PII or credentials, including case variants.
  const source = context && typeof context === 'object' ? context : {};
  const extra = {};
  for (const key of ['action', 'requestId', 'status', 'code']) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      extra[key] = value;
    }
  }
  return extra;
}

function sendError(res, error, context) {
  if (error && error.code === 'REPARTO_SCHEMA_UNAVAILABLE') {
    logger.error(`[REPARTIDOR_FINANZAS] ${context.action}: esquema de reparto no disponible`);
    return res.status(503).json({
      success: false,
      code: error.code,
      error: 'El origen de datos de reparto no esta disponible. Reintenta mas tarde.',
    });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request',
      details: error.errors.map((item) => ({
        path: item.path.join('.'),
        message: item.message,
      })),
    });
  }

  const typedStatus = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
    ? error.statusCode
    : null;
  const rawCode = String(error?.code || '').trim().toUpperCase();
  const safeCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode) ? rawCode : 'UNEXPECTED_ERROR';
  const safeLog = {
    action: context?.action || 'unknown',
    code: safeCode,
    statusCode: typedStatus || 500,
  };
  // Never log SQL text, bind values, ODBC messages, or stack traces here:
  // delivery payloads contain PII and DB2 diagnostics can echo SQL.
  logger.error('[REPARTIDOR_FINANZAS] request failed', safeLog);
  captureException(error, context);
  if (typedStatus) {
    return res.status(typedStatus).json({
      success: false,
      code: safeCode,
      error: typedStatus >= 500 ? 'Servicio temporalmente no disponible' : error.message,
    });
  }
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    error: 'Error interno del servidor',
  });
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
  return leftNumeric !== null &&
    rightNumeric !== null &&
    leftNumeric === rightNumeric;
}

function canAccessRepartidor(req, repartidorId, { allowMultiple = false } = {}) {
  const user = req.user || {};
  const role = String(user.role || '').trim().toUpperCase();
  const selected = String(repartidorId || '').split(',').map(normalizeCode).filter(Boolean);
  if (!selected.length || selected.some((code) => /^ALL$/i.test(code))) return false;
  if (!allowMultiple && selected.length !== 1) return false;
  if (role === 'ADMIN' || role === 'JEFE_VENTAS') {
    if (!hasFinanceListRole(user)) return false;
    const visible = financeFleetCodes(user);
    return visible.length > 0
      && selected.every((target) => visible.some((allowed) => codesMatch(allowed, target)));
  }
  if (role !== 'REPARTIDOR' || selected.length !== 1) return false;
  const userCode = normalizeCode(user.code || user.id || user.user);
  const visible = financeFleetCodes(user);
  return visible.length === 1 && codesMatch(userCode, selected[0])
    && codesMatch(visible[0], selected[0]);
}

function requireRepartidorAccess(resolveRepartidorId, options) {
  return (req, res, next) => {
    const repartidorId = resolveRepartidorId(req);
    const raw = String(repartidorId || '').trim();
    if (!options?.allowMultiple && (!raw || raw.includes(',') || /^ALL$/i.test(raw))) {
      return res.status(422).json({
        success: false,
        code: 'REPARTIDOR_ID_MULTI_NOT_ALLOWED',
        error: 'Selecciona un unico repartidor concreto',
      });
    }
    if (canAccessRepartidor(req, repartidorId, options)) return next();
    logger.warn('[REPARTIDOR_FINANZAS] Access denied', {
      code: 'REPARTIDOR_ACCESS_DENIED',
    });
    return res.status(403).json({
      success: false,
      code: 'REPARTIDOR_ACCESS_DENIED',
      error: 'No tienes permisos para operar sobre este repartidor',
    });
  };
}

function requireSingleFinanceRepartidorSelector(req, res, next) {
  const raw = String(req.params?.repartidorId || '').trim();
  if (!raw || raw.includes(',') || /^ALL$/i.test(raw)) {
    return res.status(422).json({
      success: false,
      code: 'REPARTIDOR_ID_MULTI_NOT_ALLOWED',
      error: 'Selecciona un unico repartidor concreto',
    });
  }
  return next();
}

async function invalidateFinanceCaches(repartidorId) {
  // Scoped invalidation: one driver's payment must not wipe per-driver caches
  // for the whole fleet (that forced every repartidor to rebuild heavy CTEs).
  // Batch/fleet summary keys embed joined id lists, so only the shared overlay
  // entries (cheap to rebuild on cached per-driver bases) are dropped globally.
  // Fleet rutero/history/document patterns stay global: a payment legitimately
  // affects cross-driver JEFE views.
  const patterns = [
    // Double-prefix "query:query:" is mandatory: cachedQuery stores keys as
    // gmp:query:query:<key>, so single-prefix patterns never matched anything.
    `query:query:repartidor:finance:${repartidorId}:*`,
    // Scoped per driver: summary/daily/overlay keys embed joined id lists
    // ("05,94"), so the glob matches every cache entry that carries this
    // driver without wiping fleet-wide caches for the others.
    `query:query:repartidor:collections:*${repartidorId}*`,
    'query:query:repartidor:history-documents:*',
    'query:query:repartidor:rutero-*',
    'query:query:entregas:rutero:client-risk:*',
    'query:query:entregas:rutero:document-cobro:*',
  ];
  for (const pattern of patterns) {
    try {
      if (deleteCachePattern) {
        await deleteCachePattern(pattern);
      } else if (invalidateCache) {
        await invalidateCache(pattern);
      }
    } catch (error) {
      // Do not expose cache key patterns, driver messages, or repartidor IDs.
      logger.warn('[REPARTIDOR_FINANZAS] Cache invalidation failed', {
        code: 'FINANCE_CACHE_INVALIDATION_FAILED',
      });
    }
  }
}

router.get('/daily-summary/:repartidorId', verifyToken, requireFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId, { allowMultiple: true }), (req, res, next) => dailySummaryController(req, res, next));

router.get('/summary/:repartidorId', verifyToken, requireFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId, { allowMultiple: true }), async (req, res) => {
  try {
    const params = listParamsSchema.parse(req.params);
    const query = summaryQuerySchema.parse(req.query);
    const result = await financeService.getSummary({
      repartidorId: params.repartidorId,
      year: query.year,
      month: query.month,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, { action: 'GET /summary', params: req.params, query: req.query });
  }
});

router.get('/vencimientos/:repartidorId', verifyToken, requireFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId, { allowMultiple: true }), (req, res, next) => vencimientosController(req, res, next));

router.post('/cobros', verifyToken, requireRepartidorAccess((req) => req.body.codigoRepartidor), async (req, res) => {
  try {
    const body = cobroSchema.parse(req.body);
    const operador = (req.user && (req.user.code || req.user.id)) || 'unknown';
    const result = await financeService.registerCobro({
      ...body,
      operador,
    });
    await invalidateFinanceCaches(body.codigoRepartidor);
    if (result.created) {
      Promise.resolve()
        .then(() => repartoVarianceNotificationService.notifyAfterCobro({ cobro: body, result }))
        .catch((notifyError) => {
          logger.warn('[cobro-notify] post-register notify failed', {
            code: notifyError?.code || 'NOTIFICATION_FAILURE',
          });
        });
    }
    return res.status(result.created ? 201 : 200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error && error.code === 'DOCUMENT_NOT_ASSIGNED') {
      return res.status(403).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    if (error && error.code === 'IDEMPOTENCY_CONFLICT') {
      return res.status(409).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    if (error && error.code === 'PAYMENT_ALREADY_REGISTERED') {
      return res.status(409).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    return sendError(res, error, { action: 'POST /cobros', body: req.body });
  }
});

// Req #16 (devoluciones): anula un cobro registrado por el repartidor.
// Body: { idempotencyToken, repartidorId, reason }
const reverseCobroSchema = z.object({
  idempotencyToken: idempotencyTokenSchema,
  repartidorId: singleCodeSchema,
  reason: z.string().trim().min(1).max(500),
});

router.post('/cobros/reverse', verifyToken, requireRepartidorAccess((req) => req.body?.repartidorId), async (req, res) => {
  try {
    const body = reverseCobroSchema.parse(req.body);
    const user = req.user || {};
    const operador = user.code || user.id || 'unknown';
    const isPrivileged = hasFinanceListRole(user);

    const result = await financeService.reverseCobro({
      idempotencyToken: body.idempotencyToken,
      repartidorId: body.repartidorId,
      operador,
      reason: body.reason,
      allowAcrossRepartidores: isPrivileged,
    });
    await invalidateFinanceCaches(body.repartidorId);
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error && error.code === 'COBRO_NOT_FOUND') {
      return res.status(404).json({ success: false, error: error.message, code: error.code });
    }
    if (error && error.code === 'COBRO_ALREADY_LIQUIDADO') {
      return res.status(409).json({ success: false, error: error.message, code: error.code });
    }
    if (error && error.code === 'PAYMENT_AUTHZ_DENIED') {
      return res.status(403).json({ success: false, error: error.message, code: error.code });
    }
    return sendError(res, error, { action: 'POST /cobros/reverse', body: req.body });
  }
});

router.post('/rutero/evidence/signature', setCanonicalArtifactHeaders, verifyToken, requireCanonicalConfirmationRole, async (req, res) => {
  setEvidenceRequestTimeout(req, res);
  try {
    const result = await canonicalConfirmationRuntime.evidenceService.stageSignature({
      documentId: evidenceDocumentId(req.body),
      ...evidenceSelection(req, req.body?.repartidorId),
      dataUri: req.body?.signature || req.body?.firma,
    });
    return res.status(result.created ? 201 : 200).json({ success: true, ...result });
  } catch (error) {
    return sendEvidenceError(res, error, 'POST /rutero/evidence/signature');
  }
});

router.post('/rutero/evidence/photo', setCanonicalArtifactHeaders, verifyToken, requireCanonicalConfirmationRole, (req, res) => {
  setEvidenceRequestTimeout(req, res);
  evidenceUpload.single('photo')(req, res, async (uploadError) => {
    if (uploadError) return sendEvidenceError(res, uploadError, 'POST /rutero/evidence/photo');
    try {
      if (!req.file) throw new EvidenceError('EVIDENCE_REQUIRED', 'Debe adjuntar una evidencia', 400);
      const result = await canonicalConfirmationRuntime.evidenceService.stagePhoto({
        documentId: evidenceDocumentId(req.body),
        ...evidenceSelection(req, req.body?.repartidorId),
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      return res.status(result.created ? 201 : 200).json({ success: true, ...result });
    } catch (error) {
      return sendEvidenceError(res, error, 'POST /rutero/evidence/photo');
    }
  });
});

router.get('/rutero/evidence/:evidenceId', setCanonicalArtifactHeaders, verifyToken, requireCanonicalConfirmationRole, async (req, res) => {
  setEvidenceRequestTimeout(req, res);
  try {
    if (Object.keys(req.query || {}).some((key) => key !== 'repartidorId')) {
      throw new EvidenceError('INVALID_EVIDENCE_REQUEST', 'Selector de evidencia invalido', 422);
    }
    const evidence = await canonicalConfirmationRuntime.evidenceService.retrieve({
      evidenceId: req.params.evidenceId,
      actor: artifactActor(req, req.query?.repartidorId),
    });
    // Response remains JSON/base64. The filename is fixed and never derived
    // from evidence metadata or request input.
    res.set({
      'Cache-Control': 'private, no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline; filename="evidence.json"',
    });
    return res.json({ success: true, ...evidence });
  } catch (error) {
    return sendEvidenceError(res, error, 'GET /rutero/evidence/:evidenceId');
  }
});

// Canonical receipts are immutable renderings of the persisted confirmation.
// The route accepts no body, preventing local quantities, receiver data,
// totals, or signature substitution.
function setCanonicalReceiptHeaders(res) {
  res.set({
    'Cache-Control': 'private, no-store',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
}

function setCanonicalArtifactHeaders(_req, res, next) {
  setCanonicalReceiptHeaders(res);
  return next();
}

async function renderCanonicalReceipt(req, lookup, requestedOwner) {
  const actor = artifactActor(req, requestedOwner);
  return withCanonicalReceiptTimeout(async (signal) => {
    const receipt = await canonicalConfirmationRuntime.receiptService.getReceipt({
      ...lookup, actor, signal,
    });
    let signature = null;
    if (receipt.firmaEvidenceId) {
      signature = await canonicalConfirmationRuntime.evidenceService.retrieve({
        evidenceId: receipt.firmaEvidenceId, actor, signal,
      });
      if (signature.kind !== 'FIRMA') {
        throw new RepartoPersistenceError(
          'La firma del recibo no esta disponible',
          { code: 'REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', statusCode: 503 },
        );
      }
    }
    const rendered = await canonicalConfirmationRuntime.receiptPdfService.render({
      receipt, signature, signal,
    });
    return { receipt, rendered };
  });
}

async function serveCanonicalReceipt(req, res, lookup, requestedOwner) {
  req.setTimeout?.(canonicalReceiptTimeoutMs + 1000);
  res.setTimeout?.(canonicalReceiptTimeoutMs + 1000);
  setCanonicalReceiptHeaders(res);
  try {
    const { receipt, rendered } = await renderCanonicalReceipt(req, lookup, requestedOwner);
    return res.status(200).json({
      success: true,
      confirmationId: receipt.confirmationId,
      pdfBase64: rendered.pdf.toString('base64'),
      fileName: rendered.fileName,
    });
  } catch (error) {
    if (error instanceof EvidenceError || isEvidenceTimeout(error)) {
      return sendEvidenceError(res, error, 'GET canonical receipt');
    }
    if (error instanceof RepartoPersistenceError) {
      if (error.statusCode >= 500) logger.error('[REPARTIDOR_FINANZAS] canonical receipt unavailable', { code: error.code, statusCode: error.statusCode });
      const safeMessage = error.statusCode >= 500
        ? 'Servicio temporalmente no disponible'
        : error.message;
      return res.status(error.statusCode).json({ success: false, code: error.code, error: safeMessage });
    }
    return sendError(res, error, { action: 'GET receipt' });
  }
}

const entryAmount = () => z.number().finite().min(-99999999).max(99999999)
  .refine((amount) => Math.abs((amount * 100) - Math.round(amount * 100)) < 0.000001,
    'amount admite como maximo dos decimales');
const liquidacionEntryBase = {
  repartidorId: numericCodeSchema,
  date: dateSchema,
  amount: entryAmount(),
  idempotencyToken: idempotencyTokenSchema,
  observation: z.string().trim().min(1).max(250).optional(),
};
const liquidacionEntrySchemas = Object.freeze({
  expense: z.object({
    ...liquidacionEntryBase,
    amount: entryAmount().refine((amount) => amount > 0, 'amount debe ser positivo'),
    category: z.string().trim().min(1).max(40),
  }).strict(),
  adjustment: z.object({
    ...liquidacionEntryBase,
    amount: entryAmount().refine((amount) => amount !== 0, 'amount debe ser firmado y no cero'),
    reason: z.string().trim().min(1).max(120),
  }).strict(),
  bankDeposit: z.object({
    ...liquidacionEntryBase,
    amount: entryAmount().refine((amount) => amount > 0, 'amount debe ser positivo'),
    reference: z.string().trim().min(1).max(80),
  }).strict(),
});

function parseLiquidacionEntry(schema, body) {
  try {
    return schema.parse(body);
  } catch (cause) {
    const error = new Error('Entrada de liquidacion invalida');
    error.code = 'INVALID_LIQUIDACION_ENTRY';
    error.statusCode = 422;
    error.details = cause instanceof z.ZodError
      ? cause.errors.map((item) => ({ path: item.path.join('.'), message: item.message }))
      : undefined;
    throw error;
  }
}

router.get('/rutero/confirmations/receipt', setCanonicalArtifactHeaders, verifyToken, requireCanonicalConfirmationRole, async (req, res) => {
  setCanonicalReceiptHeaders(res);
  const parsed = idempotencyTokenSchema.safeParse(req.query?.idempotencyKey);
  const allowed = new Set(['idempotencyKey', 'repartidorId']);
  if (!parsed.success || Object.keys(req.query || {}).some((key) => !allowed.has(key))) {
    return res.status(422).json({
      success: false,
      code: 'REPARTO_RECEIPT_INVALID_LOOKUP',
      error: 'Debe indicarse solo una clave de idempotencia valida',
    });
  }
  return serveCanonicalReceipt(req, res, { idempotencyKey: parsed.data }, req.query?.repartidorId);
});

router.get('/rutero/confirmations/:confirmationId/receipt', setCanonicalArtifactHeaders, verifyToken, requireCanonicalConfirmationRole,
  (req, res) => {
    setCanonicalReceiptHeaders(res);
    if (Object.keys(req.query || {}).some((key) => key !== 'repartidorId')) {
      return res.status(422).json({
        success: false,
        code: 'REPARTO_RECEIPT_INVALID_LOOKUP',
        error: 'El recibo por confirmacion no admite selectores adicionales',
      });
    }
    return serveCanonicalReceipt(req, res, { confirmationId: req.params.confirmationId }, req.query?.repartidorId);
  });

router.post(
  '/rutero/confirmations/:confirmationId/receipt/email',
  verifyToken,
  requireCanonicalConfirmationRole,
  async (req, res) => {
    const parsed = z.object({
      destinatario: z.string().trim().email().max(180),
      repartidorId: z.string().optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        code: 'EMAIL_INVALID',
        error: 'Destinatario de email invalido',
      });
    }
    try {
      const { receipt, rendered } = await renderCanonicalReceipt(
        req, { confirmationId: req.params.confirmationId }, parsed.data.repartidorId,
      );
      const clienteNombre = receipt.cliente?.nombre || receipt.clienteNombre || '';
      const numero = receipt.documento?.numero || receipt.confirmationId;
      const serie = receipt.documento?.serie || '';
      const lineTotal = (Array.isArray(receipt.lineas) ? receipt.lineas : [])
        .reduce((sum, line) => (
          sum + (Number(line.cantidadEntregada || 0) * Number(line.precioUnitario || 0))
        ), 0);
      const delivery = resolveRepartoEmailDelivery({
        recipients: [parsed.data.destinatario],
        mode: 'manual',
      });
      const effectiveRecipient = delivery.effectiveRecipients[0];
      if (!effectiveRecipient) {
        throw new RepartoEmailDeliveryPolicyError(
          'El destinatario efectivo no es valido',
          'REPARTO_EMAIL_RECIPIENT_REQUIRED',
        );
      }
      const logicalKey = `receipt:${receipt.confirmationId}`;
      const expectedMessageId = buildRepartoMessageId({
        kind: 'receipt',
        identity: logicalKey,
        recipient: effectiveRecipient,
      });
      const sent = await sendEmailWithPdf({
        to: effectiveRecipient,
        subject: `Nota de entrega ${serie}-${numero} - Granja Mari Pepa`,
        htmlBody: generateDeliveryEmailHtml({
          numero,
          serie,
          fecha: receipt.confirmedAt || '',
          total: receipt.importeTotal || receipt.total || lineTotal || 0,
          clienteNombre,
        }),
        pdfBuffer: rendered.pdf,
        messageId: expectedMessageId,
        pdfFilename: rendered.fileName || `nota_entrega_${numero}.pdf`,
      });
      const messageId = String(sent?.messageId || '').trim();
      if (!messageId) {
        throw new RepartoPersistenceError('El proveedor de correo no confirmo el envio', {
          code: 'DOCUMENT_EMAIL_MESSAGE_ID_REQUIRED', statusCode: 503,
        });
      }
      try {
        await canonicalConfirmationRuntime.recordDocumentEmailLedger({
          operatorId: actorCode(req.user),
          ownerId: receipt.repartidorId,
          payloadPreview: `logicalKey=${logicalKey};messageId=${messageId}`,
        });
      } catch (_ledgerError) {
        throw new RepartoPersistenceError('No se pudo registrar la entrega del email', {
          code: 'EMAIL_DELIVERY_LEDGER_REQUIRED', statusCode: 503,
        });
      }
      return res.status(200).json({
        success: true,
        message: 'Email enviado correctamente',
        messageId,
        ledgerWritten: true,
        deliveryPolicy: delivery.policy,
      });
    } catch (error) {
      if (error instanceof RepartoEmailDeliveryPolicyError) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          error: error.message,
        });
      }
      if (error instanceof EvidenceError || isEvidenceTimeout(error)) {
        return sendEvidenceError(res, error, 'POST canonical receipt email');
      }
      if (error instanceof RepartoPersistenceError) {
        const safeMessage = error.statusCode >= 500
          ? 'Servicio temporalmente no disponible'
          : error.message;
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          error: safeMessage,
        });
      }
      return sendError(res, error, { action: 'POST receipt email' });
    }
  },
);

router.post(
  '/rutero/confirmations/:confirmationId/receipt/whatsapp',
  verifyToken,
  requireCanonicalConfirmationRole,
  async (req, res) => {
    const parsed = z.object({
      telefono: z.string().trim().min(7).max(20),
      repartidorId: z.string().trim().optional(),
      mensaje: z.string().trim().max(900).optional(),
      clienteNombre: z.string().trim().max(180).optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        code: 'PHONE_INVALID',
        error: 'Telefono o mensaje de WhatsApp invalido',
      });
    }
    const phone = parsed.data.telefono.replace(/\D/g, '');
    if (!/^\d{7,15}$/.test(phone)) {
      return res.status(422).json({
        success: false,
        code: 'PHONE_INVALID',
        error: 'Telefono de WhatsApp invalido',
      });
    }
    try {
      const { receipt, rendered } = await renderCanonicalReceipt(
        req, { confirmationId: req.params.confirmationId }, parsed.data.repartidorId,
      );
      const numero = receipt.documento?.numero || receipt.confirmationId;
      const serie = receipt.documento?.serie || '';
      const clienteNombre = parsed.data.clienteNombre || receipt.cliente?.nombre || receipt.clienteNombre || '';
      const caption = parsed.data.mensaje
        || `Granja Mari Pepa\n\nNota de entrega: ${serie}-${numero}\nCliente: ${clienteNombre}`;
      const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(caption)}`;
      const fileName = rendered.fileName || `nota_entrega_${numero}.pdf`;

      if (!whatsappGateway.isBotConfigured()) {
        return res.status(200).json({
          success: true,
          localShare: true,
          sent: false,
          deliveryConfirmed: false,
          shareMode: 'LOCAL_USER_ACTION',
          whatsappUrl,
          message: caption,
          fileName,
          mimeType: 'application/pdf',
        });
      }
      if (!whatsappGateway.isBotReady()
          && whatsappGateway.baileys.isConfigured()
          && !whatsappGateway.cloud.isConfigured()) {
        return res.status(503).json({
          success: false,
          code: 'WHATSAPP_BAILEYS_NOT_PAIRED',
          error: 'WhatsApp corporativo no esta vinculado',
        });
      }

      const result = await whatsappGateway.sendDocumentFromBot({
        telefono: phone,
        pdfBuffer: rendered.pdf,
        filename: fileName,
        caption,
        bodyParams: [String(numero), clienteNombre || 'Cliente'],
      });
      return res.status(200).json({
        success: true,
        localShare: false,
        sent: true,
        deliveryConfirmed: true,
        shareMode: 'BOT_GATEWAY',
        provider: result.provider,
        mode: result.mode,
        messageId: result.messageId,
        fileName,
        mimeType: 'application/pdf',
      });
    } catch (error) {
      if (error instanceof EvidenceError || isEvidenceTimeout(error)) {
        return sendEvidenceError(res, error, 'POST canonical receipt whatsapp');
      }
      if (error instanceof RepartoPersistenceError) {
        const safeMessage = error.statusCode >= 500
          ? 'Servicio temporalmente no disponible'
          : error.message;
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          error: safeMessage,
        });
      }
      if (error?.code === 'WHATSAPP_BAILEYS_NOT_PAIRED') {
        return res.status(503).json({
          success: false,
          code: error.code,
          error: 'WhatsApp corporativo no esta vinculado',
        });
      }
      return sendError(res, error, { action: 'POST canonical receipt whatsapp' });
    }
  },
);
router.post('/rutero/confirm-delivery-cobro', verifyToken, requireCanonicalConfirmationRole, async (req, res) => {
  try {
    const command = buildConfirmationCommand({
      user: req.user,
      headers: req.headers,
      body: req.body,
    });
    // Validate the authoritative catalog before opening the persistence
    // transaction. This prevents an unknown state/reason/payment from being
    // partially written even if a downstream adapter is misconfigured.
    await canonicalConfirmationRuntime.catalogService.validateConfirmation(command);
    const result = await canonicalConfirmationRuntime.confirmationService.confirm(command);
    await invalidateFinanceCaches(command.delivery.repartidorId);
    if (result.created && command.cobro && result.cobroId != null) {
      Promise.resolve()
        .then(() => repartoVarianceNotificationService.notifyAfterCobro({
          cobro: {
            ...command.cobro,
            codigoRepartidor: command.delivery.repartidorId || command.actor?.repartidorId,
            documento: command.delivery.itemId,
            idempotencyToken: command.idempotencyKey,
            pantallaOrigen: 'RUTERO',
          },
          result,
        }))
        .catch((notifyError) => {
          logger.warn('[cobro-notify] post-confirm notify failed', {
            code: notifyError?.code || 'NOTIFICATION_FAILURE',
          });
        });
    }
    if (result.created) {
      Promise.resolve()
        .then(() => repartoVarianceNotificationService.notifyAfterConfirm({ command, result }))
        .catch((notifyError) => {
          logger.warn(`[variance] post-confirm notify failed: ${notifyError?.message || notifyError}`);
        });
    }
    return res.status(result.created ? 201 : 200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof RepartoContractError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        error: error.message,
        details: error.details,
      });
    }
    if (error instanceof RepartoCatalogError || error instanceof RepartoPersistenceError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    return sendError(res, error, {
      action: 'POST /rutero/confirm-delivery-cobro',
      ...(req.id ? { requestId: req.id } : {}),
    });
  }
});

router.post('/liquidaciones', verifyToken, requireRepartidorAccess((req) => req.body?.repartidorId), async (req, res) => {
  try {
    const body = parseLiquidacionCloseRequest(req.body);
    const result = await canonicalLiquidacionService.closeDay(body, {
      actorId: actorCode(req.user),
      actorRole: String(req.user?.role || '').trim(),
    });

    // Cache invalidation is a post-commit concern and only applies to a
    // newly created close. Replays must remain read-only.
    if (result.created) await invalidateFinanceCaches(body.repartidorId);

    if (result.created && result.outboxIntent) {
      Promise.resolve()
        .then(() => processLiquidacionOutboxIntent({
          liquidacion: result.liquidacion,
          repartidorId: body.repartidorId,
          outboxId: result.outboxId ?? result.outboxIntent?.outboxId ?? null,
        }))
        .catch((emailError) => {
          logger.warn('[liq-outbox] post-close send failed: ' + (emailError && emailError.message ? emailError.message : emailError));
        });
    }

    return res.status(result.created ? 201 : 200).json({
      success: true,
      created: result.created,
      liquidacion: result.liquidacion,
      outboxIntent: result.outboxIntent,
    });
  } catch (error) {
    if (error && [
      'DUPLICATE_DAILY_LIQUIDACION', 'IDEMPOTENCY_CONFLICT',
      'LIQUIDACION_DAY_ALREADY_CLOSED', 'LIQUIDACION_NO_COBROS',
    ].includes(error.code)) {
      return res.status(409).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    return sendError(res, error, { action: 'POST /liquidaciones', body: req.body });
  }
});

function validateLiquidacionEntry(schema) {
  return (req, res, next) => {
    try {
      req.liquidacionEntry = parseLiquidacionEntry(schema, req.body);
      return next();
    } catch (error) {
      return sendError(res, error, { action: 'validate liquidation entry' });
    }
  };
}

function requireLiquidacionAdjustmentRole(req, res, next) {
  if (hasFinanceListRole(req.user)) return next();
  return res.status(403).json({
    success: false,
    code: 'LIQUIDACION_ADJUSTMENT_ROLE_REQUIRED',
    error: 'Solo JEFE_VENTAS en Perfil Reparto o ADMIN puede crear ajustes',
  });
}

function requireFinanceManagementRole(req, res, next) {
  if (hasFinanceListRole(req.user)) return next();
  return res.status(403).json({
    success: false,
    code: 'REPARTIDOR_FINANCE_ROLE_REQUIRED',
    error: 'Activa el Perfil Reparto para administrar finanzas',
  });
}

function createLiquidacionEntryHandler(method, action) {
  return async (req, res) => {
    try {
      const result = await canonicalLiquidacionService[method](req.liquidacionEntry, {
        actorId: actorCode(req.user), actorRole: String(req.user?.role || '').trim(),
      });
      if (result.created) await invalidateFinanceCaches(req.liquidacionEntry.repartidorId);
      return res.status(result.created ? 201 : 200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error, { action, body: req.body });
    }
  };
}

router.post('/liquidaciones/gastos', verifyToken,
  validateLiquidacionEntry(liquidacionEntrySchemas.expense),
  requireRepartidorAccess((req) => req.liquidacionEntry.repartidorId),
  createLiquidacionEntryHandler('createExpense', 'POST /liquidaciones/gastos'));

router.post('/liquidaciones/ajustes', verifyToken,
  validateLiquidacionEntry(liquidacionEntrySchemas.adjustment),
  requireLiquidacionAdjustmentRole,
  requireRepartidorAccess((req) => req.liquidacionEntry.repartidorId),
  createLiquidacionEntryHandler('createAdjustment', 'POST /liquidaciones/ajustes'));

router.post('/liquidaciones/ingresos-bancarios', verifyToken,
  validateLiquidacionEntry(liquidacionEntrySchemas.bankDeposit),
  requireRepartidorAccess((req) => req.liquidacionEntry.repartidorId),
  createLiquidacionEntryHandler('createBankDeposit', 'POST /liquidaciones/ingresos-bancarios'));

router.get('/liquidaciones/:idempotencyToken/pdf', verifyToken,
  requireRepartidorAccess((req) => req.query?.repartidorId), async (req, res) => {
    try {
      const { idempotencyToken } = liquidacionPdfParamsSchema.parse(req.params);
      const { repartidorId } = liquidacionPdfQuerySchema.parse(req.query);
      const document = await financeService.buildClosedLiquidacionPdf({
        idempotencyToken,
        repartidorId,
      });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        success: true,
        pdfBase64: document.pdfBuffer.toString('base64'),
        fileName: document.fileName,
        liquidacionId: document.liquidacionId,
        repartidorId: document.repartidorId,
        date: document.date,
        status: document.status,
      });
    } catch (error) {
      return sendError(res, error, { action: 'GET /liquidaciones/:idempotencyToken/pdf', params: req.params });
    }
  });

router.get('/liquidaciones/:repartidorId/desglose', verifyToken,
  requireFinanceRepartidorSelector,
  requireRepartidorAccess((req) => req.params.repartidorId, { allowMultiple: true }), async (req, res) => {
    try {
      const { repartidorId } = listParamsSchema.parse(req.params);
      const { date } = z.object({ date: dateSchema }).strict().parse(req.query);
      const ledger = await canonicalLiquidacionService.getDayEntries({ repartidorId, date }, {
        actorId: actorCode(req.user), actorRole: String(req.user?.role || '').trim(),
      });
      return res.json({ success: true, ledger });
    } catch (cause) {
      const error = cause instanceof z.ZodError
        ? Object.assign(new Error('Consulta de liquidacion invalida'), {
          code: 'INVALID_LIQUIDACION_ENTRY', statusCode: 422,
          details: cause.errors.map((item) => ({ path: item.path.join('.'), message: item.message })),
        }) : cause;
      return sendError(res, error, { action: 'GET /liquidaciones/desglose', params: req.params, query: req.query });
    }
  });

router.post('/liquidaciones/:idempotencyToken/reopen', verifyToken, async (req, res) => {
  try {
    idempotencyTokenSchema.parse(req.params.idempotencyToken);
    return res.status(501).json({
      success: false,
      code: 'LIQUIDACION_REOPEN_RULE_UNDEFINED',
      error: 'La reapertura de liquidaciones esta bloqueada hasta disponer de una regla de negocio aprobada y auditada.',
    });
  } catch (error) {
    return sendError(res, error, { action: 'POST /liquidaciones/reopen', params: req.params });
  }
});
router.post('/liquidaciones/:idempotencyToken/resend-emails', verifyToken, async (req, res) => {
  try {
    const idempotencyToken = idempotencyTokenSchema.parse(req.params.idempotencyToken);
    const result = await requeueFailedLiquidacionOutbox({
      idempotencyToken,
      canAccessRepartidor: (repartidorId) => canAccessRepartidor(req, repartidorId),
    });
    if (!result.requeued) {
      const responses = {
        not_found: [404, 'LIQUIDACION_OUTBOX_NOT_FOUND', 'No existe un envio de liquidacion para esta clave'],
        forbidden: [403, 'REPARTIDOR_ACCESS_DENIED', 'No tienes permisos para operar sobre este repartidor'],
        claimed: [409, 'LIQUIDACION_OUTBOX_IN_FLIGHT', 'El envio esta en curso y no puede reenviarse'],
        not_failed: [409, 'LIQUIDACION_OUTBOX_NOT_RETRYABLE', 'Solo pueden reenviarse fallos de correo cerrados'],
        unsafe_payload: [503, 'LIQUIDACION_OUTBOX_UNSAFE_PAYLOAD', 'El reenvio no esta disponible para este registro'],
        requeue_lost: [409, 'LIQUIDACION_OUTBOX_REQUEUE_CONFLICT', 'El reenvio fue solicitado concurrentemente'],
      };
      const [status, code, error] = responses[result.reason] || responses.requeue_lost;
      return res.status(status).json({ success: false, code, error });
    }
    // The scheduler owns delivery. This endpoint only makes an existing
    // failed intent eligible once more; it never invokes SMTP directly.
    return res.status(202).json({
      success: true,
      requeued: true,
      outboxId: result.outboxId,
    });
  } catch (error) {
    return sendError(res, error, { action: 'POST /liquidaciones/resend-emails', params: req.params });
  }
});

router.get('/commissions/tiers', verifyToken, async (_req, res) => {
  try {
    const tiers = await financeService.getCommissionTiers();
    return res.json({ success: true, tiers });
  } catch (error) {
    return sendError(res, error, { action: 'GET /commissions/tiers' });
  }
});

router.put('/commissions/tiers', verifyToken, requireFinanceManagementRole, async (req, res) => {
  try {
    const body = tiersSchema.parse(req.body);
    const updatedBy = req.user?.code || req.user?.id || 'unknown';
    const tiers = await financeService.saveCommissionTiers({
      tiers: body.tiers,
      updatedBy,
    });
    return res.json({ success: true, tiers });
  } catch (error) {
    return sendError(res, error, { action: 'PUT /commissions/tiers', body: req.body });
  }
});

router.get('/commissions/summary/:repartidorId', verifyToken, requireFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId, { allowMultiple: true }), (req, res, next) => commissionsSummaryController(req, res, next));

router.delete('/test-cleanup/:idempotencyToken', verifyToken, requireFinanceManagementRole, async (req, res) => {
  try {
    if (
      process.env.NODE_ENV !== 'test' ||
      process.env.REPARTIDOR_FINANCE_ENABLE_TEST_CLEANUP !== 'true'
    ) {
      return res.status(403).json({
        success: false,
        error: 'Test cleanup disabled',
      });
    }

    const idempotencyToken = idempotencyTokenSchema.parse(req.params.idempotencyToken);
    await financeService.deleteTestData(idempotencyToken, {
      deleteDeliveryStatus: req.query.deleteDeliveryStatus === 'true',
      deliveryId: req.query.deliveryId,
    });
    return res.json({ success: true, idempotencyToken });
  } catch (error) {
    return sendError(res, error, { action: 'DELETE /test-cleanup', params: req.params });
  }
});

router.get('/vencimientos/:repartidorId/:docId/detalle', verifyToken, requireSingleFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
  try {
    const docId = detailDocIdSchema.parse(req.params.docId);
    const parts = docId.split('-');
    
    const docKey = {
      // The service binds this value into the ERP ownership predicate.  Keep
      // it sourced from the already-authorized path parameter rather than
      // accepting a client-controlled selector in the document id/body.
      repartidorId: req.params.repartidorId,
      tipo: parts[0],
      ejercicio: parseInt(parts[1]),
      serie: parts[2],
      terminal: parseInt(parts[3]),
      numero: parseInt(parts[4]),
      xde: parseInt(parts[5])
    };
    
    const detalle = await financeService.getDetalleVencimiento(docKey);
    if (!detalle) {
      return res.status(404).json({ success: false, error: 'Vencimiento no encontrado' });
    }
    
    res.json({ success: true, detalle });
  } catch (error) {
    return sendError(res, error, { action: 'GET /vencimientos/detalle', params: req.params });
  }
});

router.get('/cuentas/:repartidorId', verifyToken, requireFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId, { allowMultiple: true }), async (req, res) => {
  try {
    const { repartidorId } = listParamsSchema.parse(req.params);
    // A read failure is not an empty summary: that would report a false
    // ultimoCierre to the driver. It is mapped through the typed route error.
    const dateYmd = new Date().toISOString().slice(0, 10);
    const summary = await financeService.getDailySummary({
      repartidorId,
      date: dateYmd
    });

    const saldoActual = Number(summary?.summary?.saldoActual);
    if (!Number.isFinite(saldoActual)) {
      const error = new Error('El saldo diario autoritativo no esta disponible');
      error.code = 'REPARTO_SCHEMA_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }

    res.json({
      success: true, 
      cuenta: { 
        saldoActual, 
        ultimoCierre: summary?.summary?.status === 'CLOSED' ? dateYmd : null 
      } 
    });
  } catch (error) {
    return sendError(res, error, { action: 'GET /cuentas', params: req.params });
  }
});

router.get('/evolution/:repartidorId', verifyToken, requireFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId, { allowMultiple: true }), async (req, res) => {
  try {
    const { repartidorId } = listParamsSchema.parse(req.params);
    assertExplicitRepartidorSelector(repartidorId);
    const [evolution, topProducts] = await Promise.all([
      financeService.getEvolution(repartidorId),
      financeService.getTopProducts(repartidorId)
    ]);
    res.json({ success: true, evolution, topProducts });
  } catch (error) {
    return sendError(res, error, { action: 'GET /evolution', params: req.params });
  }
});

// Test-only dependency seam. It accepts explicit ports, never environment
// flags, so an automated test cannot accidentally enable DB2 writes.
router.setCanonicalConfirmationRuntime = setCanonicalConfirmationRuntime;
router.resetCanonicalConfirmationRuntime = resetCanonicalConfirmationRuntime;
router.getCanonicalConfirmationRuntime = () => canonicalConfirmationRuntime;
router.requireCanonicalConfirmationRole = requireCanonicalConfirmationRole;
router.evidenceRepartidorId = evidenceRepartidorId;
router.evidenceDocumentId = evidenceDocumentId;
router.sendEvidenceError = sendEvidenceError;
router.setCanonicalReceiptTimeoutMs = setCanonicalReceiptTimeoutMs;
router.setCanonicalLiquidacionService = setCanonicalLiquidacionService;
router.resetCanonicalLiquidacionService = resetCanonicalLiquidacionService;

module.exports = router;
