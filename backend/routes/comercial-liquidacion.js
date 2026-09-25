'use strict';

const express = require('express');
const logger = require('../middleware/logger');
const {
  sanitizeVendorCodes,
  parseIsoDate,
  todayIsoDate,
  listReturns,
  listPgCollectedDocuments,
  getDailySummary,
  saveLiquidacion,
  registerReturn,
  renderReturnPdf,
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
    if (visible.length > 1) {
      return { codes: visible };
    }
    return { error: 'COMERCIAL no puede consultar ALL' };
  }
  if (!context.isJefeVentas) {
    const codes = requestedCodes.length > 0 ? requestedCodes : sanitizeVendorCodes([userCode]);
    if (codes.some((code) => !visible.some((item) => codesMatch(code, item)))) {
      return { error: 'COMERCIAL solo puede consultar vendedores de su alcance' };
    }
    return { codes };
  }

  // F2a-03: JEFE via canonico. ALL => literalAll con catalogo o set>=20;
  // jamas set vacio (codes:[]) al servicio.
  const { resolveVendorScope, getCachedActiveGmpVendorCatalog } = require('../middleware/vendor-scope');
  const scope = resolveVendorScope(
    req.user || {},
    requestedIsAll ? 'ALL' : (requestedCodes.length ? requestedCodes : 'ALL'),
    { visibleCodes: visible },
  );
  if (!scope.ok) {
    return { error: scope.reason === 'empty_request' ? 'JEFE_VENTAS sin alcance de vendedores' : 'JEFE_VENTAS no puede consultar vendedores fuera de su alcance' };
  }
  if (scope.literalAll) {
    const catalog = getCachedActiveGmpVendorCatalog();
    const codes = catalog.length ? catalog : visible;
    if (!codes.length) {
      return { error: 'JEFE_VENTAS sin catalogo de vendedores' };
    }
    return { codes, literalAll: true };
  }
  if (!scope.codes.length) {
    return { error: 'JEFE_VENTAS sin alcance de vendedores' };
  }
  return { codes: scope.codes };
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

// F2b-05: texto max 64 con allowlist; cliente alfanumerico max 10.
// Malicioso o largo => 400, nunca filtro crudo al servicio.
const LIQUIDACION_TEXT_RE = /^[A-Za-z0-9 _.\-áéíóúÁÉÍÓÚñÑüÜ]+$/;
const LIQUIDACION_TEXT_MAX = 64;
const LIQUIDACION_CODE_RE = /^[A-Za-z0-9]+$/;

function clampLiquidacionText(value, field, res) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (text.length > LIQUIDACION_TEXT_MAX || !LIQUIDACION_TEXT_RE.test(text)) {
    res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: `filtro ${field} invalido (max 64, sin simbolos de control)` });
    return null;
  }
  return text;
}

function clampLiquidacionClient(value, res) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (text.length > 10 || !LIQUIDACION_CODE_RE.test(text)) {
    res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: 'cliente invalido (alfanumerico, max 10)' });
    return null;
  }
  return text;
}

function wantsPdf(req) {
  const accept = String(req.get('Accept') || '').toLowerCase();
  const format = String(req.query.format || req.body?.format || '').toLowerCase();
  return accept.includes('application/pdf') || format === 'pdf';
}

function sendPdf(res, buffer, fileName) {
  const safeName = String(fileName || 'DEVOLUCION.pdf').replace(/[\r\n"]/g, '');
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${safeName}"`);
  return res.send(buffer);
}

router.get('/devoluciones/pdf', async (req, res) => {
  try {
    const vendors = resolveVendorCodes(req);
    if (vendors.error) return forbidden(res, vendors.error);
    const fecha = resolveDate(req);
    if (fecha.error) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: fecha.error });
    }
    const serie = clampLiquidacionText(req.query.serie, 'serie', res);
    if (serie === null) return;
    const numero = clampLiquidacionText(req.query.numero, 'numero', res);
    if (numero === null) return;
    if (!serie || !numero) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'serie y numero obligatorios',
      });
    }
    const rendered = await renderReturnPdf({
      vendorCodes: vendors.codes,
      date: fecha.date,
      serie,
      numero,
    });
    return sendPdf(res, rendered.buffer, rendered.fileName);
  } catch (error) {
    return sendTypedError(res, error, 'DEVOLUCION_PDF_ERROR');
  }
});

router.get('/devoluciones', async (req, res) => {
  try {
    const vendors = resolveVendorCodes(req);
    if (vendors.error) return forbidden(res, vendors.error);
    const fecha = resolveDate(req);
    if (fecha.error) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: fecha.error });
    }
    const clientCode = clampLiquidacionClient(req.query.cliente || req.query.clientCode, res);
    if (clientCode === null) return;
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

router.get('/ya-cobrados-pg', async (req, res) => {
  try {
    const vendors = resolveVendorCodes(req);
    if (vendors.error) return forbidden(res, vendors.error);
    const clientCode = clampLiquidacionClient(req.query.cliente || req.query.clientCode, res);
    if (clientCode === null) return;
    const documents = await listPgCollectedDocuments({
      vendorCodes: vendors.codes,
      clientCode,
    });
    return res.json({
      success: true,
      count: documents.length,
      documents,
      impactoLqd: 'YA_COBRADOS',
    });
  } catch (error) {
    return sendTypedError(res, error, 'PG_COBRADOS_LIST_ERROR');
  }
});

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
      formaPago: body.formaPago || body.fp,
      albaranOrigen: body.albaranOrigen || body.albaran,
      vencimiento: body.vencimiento,
      impactoLqd: body.impactoLqd,
      createdBy: getContext(req).userId,
      idempotencyToken: req.get('Idempotency-Key') || body.idempotencyToken,
    });
    if (wantsPdf(req)) {
      const rendered = await renderReturnPdf({
        vendorCodes: vendors.codes,
        date: created.date || fecha.date,
        serie: created.serie,
        numero: created.numero,
      });
      return sendPdf(res.status(created.idempotent ? 200 : 201), rendered.buffer, rendered.fileName);
    }
    return res.status(created.idempotent ? 200 : 201).json({
      success: true,
      return: created,
    });
  } catch (error) {
    return sendTypedError(res, error, 'DEVOLUCION_SAVE_ERROR');
  }
});

module.exports = router;
