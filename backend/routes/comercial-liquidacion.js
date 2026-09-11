'use strict';

const express = require('express');
const logger = require('../middleware/logger');
const {
  sanitizeVendorCodes,
  parseIsoDate,
  todayIsoDate,
  listReturns,
  getDailySummary,
  saveLiquidacion,
  registerReturn,
} = require('../services/comercial-devoluciones-service');

const router = express.Router();

function getContext(req) {
  const user = req.user || {};
  const role = user.role || user.userRole || 'COMERCIAL';
  return {
    userId: user.code || user.codigo || user.codigoVendedor || user.userId || user.id,
    isJefeVentas: user.isJefeVentas === true || role === 'JEFE_VENTAS' || role === 'ADMIN',
    vendorCodes: user.vendorCodes || user.vendedorCodes || [],
  };
}

function codesMatch(left, right) {
  return String(left || '').trim().toUpperCase() === String(right || '').trim().toUpperCase();
}

function forbidden(res, message) {
  return res.status(403).json({
    success: false,
    code: 'FORBIDDEN_VENDOR',
    error: message,
  });
}

function resolveVendorCodes(req) {
  const context = getContext(req);
  const requestedRaw = String(
    req.query.vendedor
    || req.query.vendedorCodes
    || req.body?.vendedor
    || req.body?.vendedorCodes
    || '',
  ).trim();
  const requestedIsAll = requestedRaw.toUpperCase() === 'ALL';
  const requestedCodes = requestedIsAll ? [] : sanitizeVendorCodes(requestedRaw.split(','));
  const visible = sanitizeVendorCodes([
    ...(Array.isArray(context.vendorCodes) ? context.vendorCodes : []),
    context.userId,
  ]);
  const userCode = String(context.userId || '').trim();

  if (!context.isJefeVentas && requestedIsAll) {
    return { error: 'COMERCIAL no puede consultar ALL' };
  }
  if (!context.isJefeVentas) {
    const codes = requestedCodes.length > 0 ? requestedCodes : sanitizeVendorCodes([userCode]);
    if (codes.some((code) => !codesMatch(code, userCode))) {
      return { error: 'COMERCIAL solo puede consultar su vendedor' };
    }
    return { codes };
  }

  if (requestedIsAll) {
    return { codes: visible };
  }
  if (requestedCodes.length === 0) {
    return { codes: visible };
  }
  if (visible.length > 0 && requestedCodes.some((code) => !visible.some((item) => codesMatch(code, item)))) {
    return { error: 'JEFE_VENTAS no puede consultar vendedores fuera de su alcance' };
  }
  return { codes: requestedCodes };
}

function resolveDate(req) {
  const raw = req.query.fecha || todayIsoDate();
  const parsed = parseIsoDate(raw);
  if (!parsed) {
    return { error: 'fecha invalida; usa YYYY-MM-DD' };
  }
  return { date: parsed.iso };
}

function sendTypedError(res, error, fallbackCode) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  logger.error(`[COMERCIAL_LIQUIDACION] ${error?.code || fallbackCode}: ${error?.message || error}`);
  if (res.headersSent) return;
  return res.status(status >= 400 && status <= 599 ? status : 500).json({
    success: false,
    code: status >= 500 ? (error?.code || fallbackCode) : (error?.code || 'REQUEST_ERROR'),
    error: status >= 500 ? 'Error interno del servidor' : (error?.message || 'Solicitud invalida'),
  });
}

router.get('/devoluciones', async (req, res) => {
  try {
    const vendors = resolveVendorCodes(req);
    if (vendors.error) return forbidden(res, vendors.error);
    const fecha = resolveDate(req);
    if (fecha.error) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: fecha.error });
    }
    const clientCode = String(req.query.cliente || req.query.clientCode || '').trim();
    const returns = await listReturns({
      vendorCodes: vendors.codes,
      date: fecha.date,
      clientCode,
    });
    return res.json({
      success: true,
      date: fecha.date,
      count: returns.length,
      returns,
    });
  } catch (error) {
    return sendTypedError(res, error, 'DEVOLUCIONES_LIST_ERROR');
  }
});

router.get('/resumen-diario', async (req, res) => {
  try {
    const vendors = resolveVendorCodes(req);
    if (vendors.error) return forbidden(res, vendors.error);
    const fecha = resolveDate(req);
    if (fecha.error) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: fecha.error });
    }
    const payload = await getDailySummary({
      vendorCodes: vendors.codes,
      date: fecha.date,
    });
    return res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    return sendTypedError(res, error, 'LIQUIDACION_SUMMARY_ERROR');
  }
});

function resolveWriteDate(req) {
  const raw = req.body?.fecha || req.query.fecha || todayIsoDate();
  const parsed = parseIsoDate(raw);
  if (!parsed) return { error: 'fecha invalida; usa YYYY-MM-DD' };
  return { date: parsed.iso };
}

router.post('/guardar', async (req, res) => {
  try {
    const vendors = resolveVendorCodes(req);
    if (vendors.error) return forbidden(res, vendors.error);
    const fecha = resolveWriteDate(req);
    if (fecha.error) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: fecha.error });
    }
    const body = req.body || {};
    const saved = await saveLiquidacion({
      vendorCodes: vendors.codes,
      date: fecha.date,
      ingresoBanco: body.ingresoBanco,
      entregado: body.entregado,
      expectedTotal: body.expectedTotal ?? body.totalEsperado,
      totals: body.totals || {},
      createdBy: getContext(req).userId,
      idempotencyToken: req.get('Idempotency-Key') || body.idempotencyToken,
    });
    return res.status(saved.idempotent ? 200 : 201).json({
      success: true,
      saved,
    });
  } catch (error) {
    return sendTypedError(res, error, 'LIQUIDACION_SAVE_ERROR');
  }
});

router.post('/devoluciones', async (req, res) => {
  try {
    const vendors = resolveVendorCodes(req);
    if (vendors.error) return forbidden(res, vendors.error);
    const fecha = resolveWriteDate(req);
    if (fecha.error) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: fecha.error });
    }
    const body = req.body || {};
    const created = await registerReturn({
      vendorCodes: vendors.codes,
      date: fecha.date,
      clientCode: body.cliente || body.clientCode,
      amount: body.importe ?? body.amount,
      units: body.unidades ?? body.units,
      serie: body.serie,
      numero: body.numero,
      documentoOrigen: body.documentoOrigen || body.origen,
      yaCobrada: body.yaCobrada !== false,
      createdBy: getContext(req).userId,
      idempotencyToken: req.get('Idempotency-Key') || body.idempotencyToken,
    });
    return res.status(created.idempotent ? 200 : 201).json({
      success: true,
      return: created,
    });
  } catch (error) {
    return sendTypedError(res, error, 'DEVOLUCION_SAVE_ERROR');
  }
});

module.exports = router;
