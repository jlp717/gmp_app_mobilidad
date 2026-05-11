'use strict';

const express = require('express');
const { z } = require('zod');
const logger = require('../middleware/logger');
const { verifyToken, requireRoles } = require('../middleware/auth');
const financeService = require('../services/repartidor-finance-service');
const { deleteCachePattern, invalidateCache } = require('../services/redis-cache');

let Sentry = null;
try {
  Sentry = require('@sentry/node');
} catch (_) {
  Sentry = null;
}

const router = express.Router();

const singleCodeSchema = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/);
const numericCodeSchema = z.string().trim().min(1).max(20).regex(/^\d+$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((raw) => {
  const date = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}, 'Fecha invalida');
const idempotencyTokenSchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
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

const vencimientosQuerySchema = z.object({
  from: dateSchema,
  to: dateSchema,
  limit: z.coerce.number().int().min(1).max(500).default(100),
  clientCode: z.string().trim().max(20).optional(),
  estado: z.enum(['pendiente', 'vencido']).optional(),
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

const deliverySchema = z.object({
  itemId: z.string().trim().min(1).max(160),
  status: z.enum(['ENTREGADO']).default('ENTREGADO'),
  repartidorId: singleCodeSchema,
  observaciones: z.string().trim().max(1000).optional(),
  firma: z.string().trim().max(500).optional(),
  fotos: z.array(z.string().trim().max(500)).optional(),
  latitud: z.coerce.number().min(-90).max(90).optional(),
  longitud: z.coerce.number().min(-180).max(180).optional(),
  forceUpdate: z.boolean().optional().default(false),
});

const ruteroConfirmSchema = z.object({
  delivery: deliverySchema,
  cobro: cobroSchema,
}).superRefine((value, ctx) => {
  if (!codesMatch(value.delivery.repartidorId, value.cobro.codigoRepartidor)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['delivery', 'repartidorId'],
      message: 'delivery.repartidorId y cobro.codigoRepartidor deben coincidir',
    });
  }
  if (
    value.cobro.entregaId &&
    String(value.cobro.entregaId).trim() !== value.delivery.itemId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cobro', 'entregaId'],
      message: 'cobro.entregaId debe coincidir con delivery.itemId',
    });
  }
});

const liquidacionSchema = z.object({
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

const tiersSchema = z.object({
  tiers: z.array(z.object({
    thresholdPct: z.coerce.number().min(0).max(100),
    commissionPct: z.coerce.number().min(0).max(100),
  })).min(1).max(20),
});

const rangeQuerySchema = z.object({
  from: dateSchema,
  to: dateSchema,
});

function captureException(error, context) {
  if (Sentry && typeof Sentry.captureException === 'function') {
    Sentry.captureException(error, { extra: sanitizeContext(context) });
  }
}

function redactValue(key, value) {
  const sensitiveKeys = new Set([
    'codigoCliente',
    'clientCode',
    'codigoRepartidor',
    'repartidorId',
    'nombreCliente',
    'notas',
    'firma',
    'observaciones',
    'repartidorEmail',
    'email',
    'idempotencyToken',
  ]);
  if (sensitiveKeys.has(key)) return '[REDACTED]';
  if (typeof value === 'string' && value.length > 80) return `${value.slice(0, 80)}...`;
  return value;
}

function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return context;
  const safe = {};
  for (const [key, value] of Object.entries(context)) {
    if (value && typeof value === 'object') {
      safe[key] = sanitizeBody(value);
    } else {
      safe[key] = redactValue(key, value);
    }
  }
  return safe;
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(sanitizeBody);
  const safe = {};
  for (const [key, value] of Object.entries(body)) {
    if (value && typeof value === 'object') {
      safe[key] = sanitizeBody(value);
    } else {
      safe[key] = redactValue(key, value);
    }
  }
  return safe;
}

function sendError(res, error, context) {
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

  logger.error(`[REPARTIDOR_FINANZAS] ${context.action}: ${error.message}`);
  captureException(error, context);
  return res.status(500).json({
    success: false,
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
    logger.warn(`[REPARTIDOR_FINANZAS] Forbidden ${req.user?.code || 'unknown'} -> ${repartidorId}`);
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
      logger.warn(`[REPARTIDOR_FINANZAS] Cache invalidation failed for ${pattern}: ${error.message}`);
    }
  }
}

router.get('/daily-summary/:repartidorId', verifyToken, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
  try {
    const params = listParamsSchema.parse(req.params);
    const query = dailySummaryQuerySchema.parse(req.query);
    const result = await financeService.getDailySummary({
      repartidorId: params.repartidorId,
      date: query.date,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, { action: 'GET /daily-summary', params: req.params, query: req.query });
  }
});

router.get('/summary/:repartidorId', verifyToken, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {
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
    const query = vencimientosQuerySchema.parse(req.query);
    const vencimientos = await financeService.getVencimientos({
      repartidorId: params.repartidorId,
      from: query.from,
      to: query.to,
      limit: query.limit,
      clientCode: query.clientCode,
      estado: query.estado,
    });
    return res.json({
      success: true,
      repartidorId: params.repartidorId,
      range: { from: query.from, to: query.to, limit: query.limit },
      vencimientos,
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

router.post('/rutero/confirm-delivery-cobro', verifyToken, requireRepartidorAccess((req) => req.body?.cobro?.codigoRepartidor || req.body?.delivery?.repartidorId), async (req, res) => {
  try {
    const body = ruteroConfirmSchema.parse(req.body);
    const operador = (req.user && (req.user.code || req.user.id)) || 'unknown';
    const result = await financeService.confirmRuteroDeliveryWithCobro({
      delivery: body.delivery,
      cobro: {
        ...body.cobro,
        operador,
      },
    });
    await invalidateFinanceCaches(body.cobro.codigoRepartidor);
    return res.status(result.created ? 201 : 200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error && error.code === 'ALREADY_DELIVERED') {
      return res.status(409).json({
        success: false,
        error: error.message,
        alreadyDelivered: true,
        previousRepartidor: error.previousRepartidor,
        previousDate: error.previousDate,
      });
    }
    if (error && (
      error.code === 'IDEMPOTENCY_CONFLICT' ||
      error.code === 'INCONSISTENT_IDEMPOTENCY' ||
      error.code === 'DOCUMENT_NOT_ASSIGNED' ||
      error.code === 'PAYMENT_ALREADY_REGISTERED'
    )) {
      return res.status(error.code === 'DOCUMENT_NOT_ASSIGNED' ? 403 : 409).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    return sendError(res, error, {
      action: 'POST /rutero/confirm-delivery-cobro',
      body: req.body,
    });
  }
});

router.post('/liquidaciones', verifyToken, requireRepartidorAccess((req) => req.body.repartidorId), async (req, res) => {
  try {
    const body = liquidacionSchema.extend({
      repartidorId: numericCodeSchema,
    }).parse(req.body);
    const createdBy = (req.user && (req.user.code || req.user.id)) || 'unknown';
    const result = await financeService.closeLiquidacion({
      ...body,
      createdBy,
    });

    await invalidateFinanceCaches(body.repartidorId);

    if (result.created && body.sendEmails) {
      financeService.sendLiquidacionEmails({
        liquidacion: result.liquidacion,
        repartidorEmail: req.user?.email,
        repartidorName: req.user?.name,
        cobros: [],
      }).catch((error) => {
        logger.error(`[REPARTIDOR_FINANZAS] Email send failed after close: ${error.message}`);
        captureException(error, { action: 'sendLiquidacionEmails', idempotencyToken: body.idempotencyToken });
      });
    }

    return res.status(result.created ? 201 : 200).json({
      success: true,
      created: result.created,
      liquidacion: result.liquidacion,
    });
  } catch (error) {
    if (error && (
      error.code === 'DUPLICATE_DAILY_LIQUIDACION' ||
      error.code === 'IDEMPOTENCY_CONFLICT'
    )) {
      return res.status(409).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    return sendError(res, error, { action: 'POST /liquidaciones', body: req.body });
  }
});

router.post('/liquidaciones/:idempotencyToken/resend-emails', verifyToken, async (req, res) => {
  try {
    const token = idempotencyTokenSchema.parse(req.params.idempotencyToken);
    const liquidacion = await financeService.findLiquidacionByToken(token);
    if (!liquidacion) {
      return res.status(404).json({
        success: false,
        error: 'Liquidacion no encontrada',
      });
    }
    if (!canAccessRepartidor(req, liquidacion.repartidorId)) {
      return res.status(403).json({
        success: false,
        error: 'No tienes permisos para reenviar esta liquidacion',
      });
    }

    const results = await financeService.sendLiquidacionEmails({
      liquidacion,
      repartidorEmail: req.user?.email,
      repartidorName: req.user?.name,
      cobros: [],
    });
    return res.json({ success: true, liquidacion, emailResults: results });
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

module.exports = router;
