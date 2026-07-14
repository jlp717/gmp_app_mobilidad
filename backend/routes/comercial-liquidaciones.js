'use strict';

const express = require('express');
const { z } = require('zod');
const { verifyToken } = require('../middleware/auth');
const logger = require('../middleware/logger');
const { emailLimiter } = require('../middleware/security');
const service = require('../services/comercial-liquidacion.service');
const pdfService = require('../services/comercial-liquidacion-pdf.service');
const emailPdfService = require('../services/emailPdfService');

const router = express.Router();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
}, { message: 'Fecha invalida' });

const moneySchema = z.coerce.number().min(0).max(99999999);
const signedMoneySchema = z.coerce.number().min(-99999999).max(99999999);
const vendedorSchema = z.string().trim().min(1).max(20);
const idempotencySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);

const dailySummaryQuerySchema = z.object({
  date: dateSchema,
  numeroLiquidacion: z.coerce.number().int().positive().optional(),
});

const closeBodySchema = z.object({
  vendedorId: vendedorSchema,
  date: dateSchema,
  ingresoBanco: moneySchema,
  entregado: moneySchema,
  idempotencyKey: idempotencySchema,
  sendEmail: z.boolean().optional().default(false),
  totals: z.object({
    efectivo: moneySchema.optional(),
    tarjeta: moneySchema.optional(),
    cheques: moneySchema.optional(),
    postdatados: moneySchema.optional(),
    totalCobros: moneySchema.optional(),
    saldoActual: signedMoneySchema.optional(),
    totalAIngresar: moneySchema.optional(),
  }).optional(),
});

function isElevatedRole(user) {
  return user?.role === 'JEFE_VENTAS'
    || user?.role === 'ADMIN'
    || user?.isJefeVentas === true;
}

function getUserVendorCode(user) {
  return String(user?.code || user?.codigo || user?.codigoVendedor || user?.vendedorId || user?.userId || user?.id || '').trim();
}

function canAccessVendor(user, vendedorId) {
  if (!user) return false;
  if (isElevatedRole(user)) return true;
  return getUserVendorCode(user) === String(vendedorId || '').trim();
}

function buildEmailHtml({ vendor, summary, liquidacion }) {
  const fmt = (v) => Number(v || 0).toFixed(2).replace('.', ',');
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px;">
      <h2 style="color: #003d7a;">Liquidacion diaria comercial</h2>
      <p>Comercial: <strong>${vendor?.name || vendor?.code || ''}</strong></p>
      <p>Fecha: <strong>${summary?.date || ''}</strong></p>
      <p>Total a ingresar: <strong>${fmt(summary?.totalAIngresar)} EUR</strong></p>
      <p>Ingreso banco: ${fmt(liquidacion?.ingresoBanco)} EUR - Entregado: ${fmt(liquidacion?.entregado)} EUR</p>
      <p style="color: #666; font-size: 12px;">Documento generado por GMP App Mobilidad.</p>
    </div>
  `;
}

function emailLimiterWhenRequested(req, res, next) {
  if (req.body?.sendEmail === true) {
    return emailLimiter(req, res, next);
  }
  return next();
}

router.get('/daily-summary/:vendedorId', verifyToken, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'MISSING_TOKEN' });
  }

  const vendedorId = String(req.params.vendedorId || '').trim();
  if (!vendedorSchema.safeParse(vendedorId).success) {
    return res.status(400).json({ success: false, error: 'Vendedor invalido', code: 'VALIDATION_ERROR' });
  }

  const parsed = dailySummaryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'Parametros invalidos', code: 'VALIDATION_ERROR' });
  }

  if (!canAccessVendor(req.user, vendedorId)) {
    return res.status(403).json({ success: false, error: 'No autorizado para este vendedor', code: 'FORBIDDEN_VENDOR' });
  }

  try {
    const result = await service.getDailySummary({
      vendedorId,
      date: parsed.data.date,
      numeroLiquidacion: parsed.data.numeroLiquidacion,
      includeCommercialCloseability: true,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    logger.error(`[COMERCIAL_LIQ] daily-summary error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Error al cargar liquidacion', code: 'INTERNAL_ERROR' });
  }
});

router.post('/', verifyToken, emailLimiterWhenRequested, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'MISSING_TOKEN' });
  }

  const parsed = closeBodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Payload invalido',
      code: 'VALIDATION_ERROR',
    });
  }

  let body = parsed.data;
  if (!canAccessVendor(req.user, body.vendedorId)) {
    return res.status(403).json({ success: false, error: 'No autorizado para este vendedor', code: 'FORBIDDEN_VENDOR' });
  }

  try {
    try {
      service.validateClosePayload(body);
    } catch (validationError) {
      if (!service.shouldTryServerRecalculation(body)) throw validationError;
      body = await service.prepareClosePayload(body);
      service.validateClosePayload(body);
    }
    const result = await service.closeLiquidacion({
      ...body,
      createdBy: req.user.id || req.user.code || req.user.email || 'comercial',
    });
    const emailWarnings = [];

    if (result.created && body.sendEmail) {
      const summaryResult = await service.getDailySummary({ vendedorId: body.vendedorId, date: body.date });
      const recipient = summaryResult?.vendorEmail;
      if (!recipient) {
        emailWarnings.push({ success: false, code: 'MISSING_VENDOR_EMAIL' });
      } else {
      const vendor = { code: body.vendedorId, name: req.user.name, email: recipient };
      const summary = { date: body.date, ...(body.totals || {}) };
      const pdfFilename = `Liquidacion_${body.vendedorId}_${body.date}.pdf`;

      try {
        const pdfBuffer = await pdfService.buildLiquidacionPdfBuffer({ vendor, summary, liquidacion: result.liquidacion });
        const emailPayload = pdfService.buildLiquidacionEmailPayload({ vendor, summary, pdfFilename });
        await emailPdfService.sendEmailWithPdf({
          to: emailPayload.to,
          subject: emailPayload.subject,
          htmlBody: buildEmailHtml({ vendor, summary, liquidacion: result.liquidacion }),
          pdfBuffer,
          pdfFilename: emailPayload.pdfFilename,
        });
      } catch (emailError) {
        logger.warn('[COMERCIAL_LIQ] email send failed', { code: 'EMAIL_SEND_FAILED' });
        emailWarnings.push({ success: false, code: 'EMAIL_SEND_FAILED' });
      }
      }
    }

    return res.status(result.created ? 201 : 200).json({
      success: true,
      created: result.created,
      liquidacion: result.liquidacion,
      emailWarnings,
    });
  } catch (error) {
    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      return res.status(409).json({ success: false, code: error.code, error: error.message });
    }
    if (error.code === 'PERSIST_FAILED') {
      return res.status(500).json({ success: false, code: error.code, error: 'No se pudo guardar liquidacion' });
    }
    return res.status(400).json({ success: false, error: error.message, code: 'VALIDATION_ERROR' });
  }
});

module.exports = router;
