'use strict';

const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const logger = require('../middleware/logger');
const { verifyToken, requireRoles } = require('../middleware/auth');
const financeService = require('../services/repartidor-finance-service');
const {
  notifyAfterConfirm,
} = require('../services/reparto-variance-notification-service');
const {
  processLiquidacionOutboxIntent,
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
    || role === 'ADMIN'
    || (role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR');
  if (!allowed) {
    return res.status(403).json({
      success: false,
      code: 'REPARTO_CONFIRMATION_ROLE_REQUIRED',
      error: 'Solo un repartidor o administrador puede confirmar una entrega',
    });
  }
  return next();
}

const EVIDENCE_REQUEST_TIMEOUT_MS = 15000;
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
  if (role === 'ADMIN') {
    if (!target) throw new EvidenceError('EVIDENCE_REPARTIDOR_REQUIRED', 'repartidorId es obligatorio para administrador', 400);
    return target;
  }
  // JEFE in Perfil Reparto stages evidence for the selected driver (Ver como).
  if (role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR') {
    if (!target) {
      throw new EvidenceError(
        'EVIDENCE_REPARTIDOR_REQUIRED',
        'repartidorId es obligatorio para jefe en perfil reparto',
        400,
      );
    }
    return target;
  }
  if (target && !codesMatch(authenticated, target)) {
    throw new EvidenceError('EVIDENCE_OWNERSHIP_REQUIRED', 'No tienes permisos para esta entrega', 403);
  }
  return authenticated;
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

const singleCodeSchema = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/);
const numericCodeSchema = z.string().trim().min(1).max(20).regex(/^\d+$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((raw) => {
  const date = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}, 'Fecha invalida');
const idempotencyTokenSchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const detailDocIdSchema = z.string().trim().regex(
  /^[A-Za-z0-9]{1,10}-\d{4}-[A-Za-z0-9]{1,10}-\d{1,10}-\d{1,10}-\d{1,10}$/,
);
const moneySchema = z.coerce.number().min(0).max(99999999);

const paramsSchema = z.object({
  repartidorId: singleCodeSchema,
});

const codeListSchema = z.string().trim().min(1).max(500).regex(/^[A-Za-z0-9_,-]+$/);

const listParamsSchema = z.object({
  repartidorId: codeListSchema,
});

const numericParamsSchema = z.object({
  repartidorId: numericCodeSchema,
});

const dailySummaryQuerySchema = z.object({
  date: dateSchema.default(() => new Date().toISOString().slice(0, 10)),
});

const summaryQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
  month: z.coerce.number().int().min(1).max(12).default(new Date().getMonth() + 1),
});

// Compat: APK 4.1.2+52 envia solo limit (a veces 200) sin from/to.
// Defaults = ventana ±180 dias; limit se clampea a 100.
const vencimientosDefaultFromIso = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 180);
  return d.toISOString().slice(0, 10);
};
const vencimientosDefaultToIso = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 180);
  return d.toISOString().slice(0, 10);
};
const vencimientosQuerySchema = z.object({
  from: dateSchema.default(vencimientosDefaultFromIso),
  to: dateSchema.default(vencimientosDefaultToIso),
  limit: z.preprocess(
    (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return 50;
      return Math.min(100, Math.max(1, Math.trunc(n)));
    },
    z.number().int().min(1).max(100),
  ).default(50),
  cursor: z.string().trim().min(1).max(512).optional(),
  clientCode: z.string().trim().max(20).optional(),
  estado: z.enum(['pendiente', 'vencido']).optional(),
}).refine((query) => query.from <= query.to, {
  path: ['to'],
  message: 'El final del rango debe ser igual o posterior al inicio',
});

const cobroSchema = z.object({
  entregaId: z.union([z.string(), z.number()]).optional().nullable(),
  codigoCliente: z.string().trim().min(1).max(20),
  nombreCliente: z.string().trim().max(120).optional(),
  codigoRepartidor: singleCodeSchema,
  tipoDocumento: z.string().trim().min(1).max(10),
  origenDocumento: z.string().trim().max(1).optional().default('B'),
  subempresaDocumento: z.string().trim().max(3).optional().default('GMP'),
  ejercicioDocumento: z.coerce.number().int().min(2000).max(2100),
  serieDocumento: z.string().trim().max(5),
  terminalDocumento: z.coerce.number().int().min(0).max(999),
  numeroDocumento: z.coerce.number().int().min(1),
  xdeDocumento: z.coerce.number().int().min(0).max(99).optional().default(1),
  dexDocumento: z.coerce.number().int().min(0).max(99).optional().default(1),
  importeCobrado: moneySchema,
  importePendiente: moneySchema.default(0),
  formaPago: z.string().trim().min(1).max(20),
  pantallaOrigen: z.enum(['RUTERO', 'VENCIMIENTOS']).default('RUTERO'),
  idempotencyToken: idempotencyTokenSchema,
  notas: z.string().trim().max(500).optional(),
});

const legacyLiquidacionSchema = z.object({
  repartidorId: singleCodeSchema,
  date: dateSchema,
  idempotencyToken: idempotencyTokenSchema,
  matricula: z.string().trim().max(20).optional(),
  codigoVehiculo: z.string().trim().max(10).optional(),
  sendEmails: z.boolean().optional().default(true),
  totals: z.object({
    totalEfectivo: moneySchema.default(0),
    totalCheques: moneySchema.default(0),
    totalTarjeta: moneySchema.default(0),
    totalPostdatados: moneySchema.default(0),
    saldoActual: z.coerce.number().min(-99999999).max(99999999).default(0),
    totalCobrosDia: moneySchema.default(0),
    totalAIngresar: moneySchema.default(0),
    ingresoBanco: moneySchema.default(0),
    gastos: moneySchema.default(0),
    efectivo2: moneySchema.default(0),
    entregado2: moneySchema.default(0),
  }),
});

// Liquidation amounts and operation lists are derived exclusively by the
// server-side transaction. Keep this boundary deliberately small so an old
// client cannot make a daily close balance on client supplied totals.
const liquidacionCloseSchema = z.object({
  repartidorId: numericCodeSchema,
  date: dateSchema,
  idempotencyToken: idempotencyTokenSchema,
  matricula: z.string().trim().max(20).optional(),
  codigoVehiculo: z.string().trim().max(10).optional(),
  sendEmails: z.boolean().optional().default(true),
}).strict();

const LIQUIDACION_DERIVED_FIELDS = new Set([
  'totals', 'snapshot', 'deliveries', 'payments', 'expenses', 'adjustments',
  'bankDeposits', 'openingBalance', 'pending', 'balance', 'breakdown',
  'totalEfectivo', 'totalCheques',
  'totalTarjeta', 'totalPostdatados', 'totalCobrosDia', 'totalAIngresar',
  'ingresoBanco', 'gastos', 'efectivo2', 'entregado2', 'saldoActual',
]);

function parseLiquidacionCloseRequest(body) {
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body : body;
  const forbidden = value && typeof value === 'object'
    ? Object.keys(value).filter((key) => LIQUIDACION_DERIVED_FIELDS.has(key))
    : [];
  if (forbidden.length) {
    const error = new Error('Los importes y operaciones de liquidacion los calcula el servidor');
    error.code = 'LIQUIDACION_CLIENT_DERIVED_FIELDS_FORBIDDEN';
    error.statusCode = 422;
    error.details = { fields: forbidden };
    throw error;
  }
  try {
    return liquidacionCloseSchema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError && error.errors.some((item) => item.code === 'unrecognized_keys')) {
      const typed = new Error('El cierre de liquidacion contiene campos no permitidos');
      typed.code = 'LIQUIDACION_CLIENT_FIELDS_FORBIDDEN';
      typed.statusCode = 422;
      typed.details = { fields: error.errors.flatMap((item) => item.keys || []) };
      throw typed;
    }
    throw error;
  }
}

const tiersSchema = z.object({
  tiers: z.array(z.object({
    thresholdPct: z.coerce.number().min(0).max(100),
    commissionPct: z.coerce.number().min(0).max(100),
  })).min(1).max(20),
});

// Defaults sensatos para que el frontend no tenga que mandar siempre los
// rangos: si no se mandan, asumimos "este mes en curso".
const firstDayCurrentMonthIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const rangeQuerySchema = z.object({
  from: dateSchema.default(firstDayCurrentMonthIso),
  to: dateSchema.default(todayIso),
}).refine((query) => query.from <= query.to, {
  path: ['to'],
  message: 'El final del rango debe ser igual o posterior al inicio',
});

class UnsupportedRepartidorSelectorError extends Error {
  constructor() {
    super('Usa codigos de repartidor explicitos; el selector ALL no esta soportado');
    this.name = 'UnsupportedRepartidorSelectorError';
    this.code = 'UNSUPPORTED_REPARTIDOR_SELECTOR';
    this.statusCode = 422;
  }
}

function assertExplicitRepartidorSelector(repartidorId) {
  const codes = String(repartidorId || '').split(',').map((code) => code.trim().toUpperCase());
  if (codes.includes('ALL')) throw new UnsupportedRepartidorSelectorError();
}

function normalizedRepartidorSelection(repartidorId) {
  const selected = String(repartidorId || '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  assertExplicitRepartidorSelector(selected.join(','));
  return selected;
}

function hasFinanceListRole(user) {
  const role = String(user?.role || '').trim().toUpperCase();
  return role === 'ADMIN' || role === 'JEFE_VENTAS';
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

function canAccessRepartidor(req, repartidorId) {
  const user = req.user || {};
  if (user.isJefeVentas || user.role === 'JEFE_VENTAS' || user.role === 'ADMIN') {
    return true;
  }
  if (user.role !== 'REPARTIDOR') return false;
  const userCode = normalizeCode(user.code || user.id || user.user);
  const targetCode = normalizeCode(repartidorId);
  const userNumericCode = normalizeNumericCode(userCode);
  const targetNumericCode = normalizeNumericCode(targetCode);
  return userCode === targetCode ||
    (userNumericCode !== null &&
      targetNumericCode !== null &&
      userNumericCode === targetNumericCode);
}

function requireRepartidorAccess(resolveRepartidorId) {
  return (req, res, next) => {
    const repartidorId = resolveRepartidorId(req);
    if (canAccessRepartidor(req, repartidorId)) return next();
    logger.warn('[REPARTIDOR_FINANZAS] Access denied', {
      code: 'REPARTIDOR_ACCESS_DENIED',
    });
    return res.status(403).json({
      success: false,
      error: 'No tienes permisos para operar sobre este repartidor',
    });
  };
}

async function invalidateFinanceCaches(repartidorId) {
  const patterns = [
    `query:repartidor:finance:${repartidorId}:*`,
    `repartidor:finance:${repartidorId}:*`,
    `query:repartidor:collections:${repartidorId}:*`,
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

router.get('/daily-summary/:repartidorId', verifyToken, requireFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
  try {
    const params = listParamsSchema.parse(req.params);
    const query = dailySummaryQuerySchema.parse(req.query);
    const result = await financeService.getDailySummary({
      repartidorId: params.repartidorId,
      date: query.date,
    });
    return res.json({ success: true, ...result, canReverseCobros: false });
  } catch (error) {
    return sendError(res, error, { action: 'GET /daily-summary', params: req.params, query: req.query });
  }
});

router.get('/summary/:repartidorId', verifyToken, requireFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
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

router.get('/vencimientos/:repartidorId', verifyToken, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
  try {
    const params = listParamsSchema.parse(req.params);
    assertExplicitRepartidorSelector(params.repartidorId);
    const query = vencimientosQuerySchema.parse(req.query);
    const page = await financeService.getVencimientos({
      repartidorId: params.repartidorId,
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: query.cursor,
      clientCode: query.clientCode,
      estado: query.estado,
    });
    return res.json({
      success: true,
      repartidorId: params.repartidorId,
      range: { from: query.from, to: query.to, limit: query.limit },
      vencimientos: page.items,
      pagination: {
        total: page.total,
        limit: query.limit,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      },
    });
  } catch (error) {
    return sendError(res, error, { action: 'GET /vencimientos', params: req.params, query: req.query });
  }
});

router.post('/cobros', verifyToken, requireRepartidorAccess((req) => req.body.codigoRepartidor), async (req, res) => {
  try {
    const body = cobroSchema.parse(req.body);
    const operador = (req.user && (req.user.code || req.user.id)) || 'unknown';
    const result = await financeService.registerCobro({
      ...body,
      operador,
    });
    await invalidateFinanceCaches(body.codigoRepartidor);
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
    const isPrivileged = user.role === 'ADMIN' || user.role === 'JEFE_VENTAS' || user.isJefeVentas === true;

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
      repartidorId: evidenceRepartidorId(req, req.body?.repartidorId),
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
        repartidorId: evidenceRepartidorId(req, req.body?.repartidorId),
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
    const evidence = await canonicalConfirmationRuntime.evidenceService.retrieve({
      evidenceId: req.params.evidenceId,
      actor: { role: req.user?.role, repartidorId: actorCode(req.user) },
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

async function serveCanonicalReceipt(req, res, lookup) {
  req.setTimeout?.(canonicalReceiptTimeoutMs + 1000);
  res.setTimeout?.(canonicalReceiptTimeoutMs + 1000);
  setCanonicalReceiptHeaders(res);
  try {
    const actor = { role: req.user?.role, repartidorId: actorCode(req.user) };
    const { receipt, rendered } = await withCanonicalReceiptTimeout(async (signal) => {
      const receipt = await canonicalConfirmationRuntime.receiptService.getReceipt({ ...lookup, actor, signal });
    let signature = null;
    if (receipt.firmaEvidenceId) {
      // getReceipt authorizes confirmation ownership before this evidence read.
      signature = await canonicalConfirmationRuntime.evidenceService.retrieve({ evidenceId: receipt.firmaEvidenceId, actor, signal });
      if (signature.kind !== 'FIRMA') {
        throw new RepartoPersistenceError('La firma del recibo no estÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ disponible', { code: 'REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', statusCode: 503 });
      }
    }
      const rendered = await canonicalConfirmationRuntime.receiptPdfService.render({ receipt, signature, signal });
      return { receipt, rendered };
    });
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
  if (!parsed.success || Object.keys(req.query || {}).some((key) => key !== 'idempotencyKey')) {
    return res.status(422).json({
      success: false,
      code: 'REPARTO_RECEIPT_INVALID_LOOKUP',
      error: 'Debe indicarse solo una clave de idempotencia valida',
    });
  }
  return serveCanonicalReceipt(req, res, { idempotencyKey: parsed.data });
});

router.get('/rutero/confirmations/:confirmationId/receipt', setCanonicalArtifactHeaders, verifyToken, requireCanonicalConfirmationRole,
  (req, res) => {
    setCanonicalReceiptHeaders(res);
    if (Object.keys(req.query || {}).length !== 0) {
      return res.status(422).json({
        success: false,
        code: 'REPARTO_RECEIPT_INVALID_LOOKUP',
        error: 'El recibo por confirmacion no admite selectores adicionales',
      });
    }
    return serveCanonicalReceipt(req, res, { confirmationId: req.params.confirmationId });
  });

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
    if (result.created) {
      Promise.resolve()
        .then(() => notifyAfterConfirm({ command, result }))
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
      'LIQUIDACION_DAY_ALREADY_CLOSED',
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
    error: 'Solo JEFE_VENTAS o ADMIN puede crear ajustes',
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

router.get('/liquidaciones/:repartidorId/desglose', verifyToken,
  requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
    try {
      const { repartidorId } = numericParamsSchema.parse(req.params);
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
    idempotencyTokenSchema.parse(req.params.idempotencyToken);
    return res.status(503).json({
      success: false,
      code: 'LIQUIDACION_OUTBOX_RESEND_UNAVAILABLE',
      error: 'El reenvio solo estara disponible mediante el outbox canonico idempotente',
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

router.put('/commissions/tiers', verifyToken, requireRoles('JEFE_VENTAS', 'ADMIN'), async (req, res) => {
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

router.get('/commissions/summary/:repartidorId', verifyToken, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
  try {
    const params = listParamsSchema.parse(req.params);
    assertExplicitRepartidorSelector(params.repartidorId);
    const query = rangeQuerySchema.parse(req.query);
    const summary = await financeService.getCommissionSummary({
      repartidorId: params.repartidorId,
      from: query.from,
      to: query.to,
    });
    return res.json({ success: true, ...summary });
  } catch (error) {
    return sendError(res, error, { action: 'GET /commissions/summary', params: req.params, query: req.query });
  }
});

router.delete('/test-cleanup/:idempotencyToken', verifyToken, requireRoles('JEFE_VENTAS', 'ADMIN'), async (req, res) => {
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

router.get('/vencimientos/:repartidorId/:docId/detalle', verifyToken, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
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

router.get('/cuentas/:repartidorId', verifyToken, requireFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
  try {
    const { repartidorId } = listParamsSchema.parse(req.params);
    const saldoActual = await financeService.getSaldoActual(repartidorId);

    // A read failure is not an empty summary: that would report a false
    // ultimoCierre to the driver. It is mapped through the typed route error.
    const dateYmd = new Date().toISOString().slice(0, 10);
    const summary = await financeService.getDailySummary({
      repartidorId,
      date: dateYmd
    });

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

router.get('/evolution/:repartidorId', verifyToken, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
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
