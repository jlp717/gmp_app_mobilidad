'use strict';

/**
 * PDF de cobro comercial → Carlos, Javier y el comercial.
 * Best-effort / non-blocking. Reutiliza el PDF de reparto y el directorio staff.
 */

const logger = require('../middleware/logger');
const { queryWithParams } = require('../config/db');
const {
  buildCobroPdfBuffer,
  buildCobroPdfFileName,
} = require('./reparto-cobro-pdf-service');
const {
  resolveVendorProfile,
  resolveRoleEmails,
  VARIANCE_ROLE_KEYS,
} = require('./staff-email-directory-service');
const {
  resolveRepartoEmailDelivery,
  redactDeliverySummary,
} = require('./reparto-email-delivery-policy');
const { sendEmailWithPdf } = require('./emailPdfService');

function normalizeText(value) {
  return String(value ?? '').trim();
}

async function resolveCommercialCobroRecipients({
  comercialCode,
} = {}, {
  query = queryWithParams,
  env = process.env,
} = {}) {
  const emails = new Set();
  const details = [];

  const code = normalizeText(comercialCode).substring(0, 2);
  if (code) {
    try {
      const profile = await resolveVendorProfile(code, { query });
      details.push({
        label: 'comercial',
        vendorCode: profile.vendorCode,
        email: profile.email,
        nombre: profile.nombre,
      });
      if (profile.email) emails.add(profile.email.toLowerCase());
    } catch (error) {
      logger.warn(`[comercial-cobro-notify] vendor resolve: ${error.message}`);
      details.push({ label: 'comercial', vendorCode: code, email: null });
    }
  }

  try {
    const roles = await resolveRoleEmails([...VARIANCE_ROLE_KEYS], { query, env });
    for (const role of roles) {
      details.push({
        label: role.roleKey,
        vendorCode: role.vendorCode,
        email: role.email,
        nombre: role.nombre,
      });
      if (role.email) emails.add(role.email.toLowerCase());
    }
  } catch (error) {
    logger.warn(`[comercial-cobro-notify] role resolve: ${error.message}`);
  }

  return { emails: [...emails], details };
}

/**
 * Tras registrar un cobro comercial: PDF a Carlos, Javier y comercial.
 * Nunca lanza al caller.
 */
async function notifyCommercialCobro({
  paymentId,
  codigoCliente,
  referencia,
  importe,
  formaPago,
  codigoUsuario,
  observaciones,
} = {}, {
  query = queryWithParams,
  env = process.env,
  sendEmail = sendEmailWithPdf,
} = {}) {
  try {
    const identity = normalizeText(paymentId);
    const comercialCode = normalizeText(codigoUsuario);
    if (!identity || !comercialCode) {
      return { skipped: true, reason: 'invalid_identity' };
    }

    const resolution = await resolveCommercialCobroRecipients(
      { comercialCode },
      { query, env },
    );
    if (!resolution.emails.length) {
      return { skipped: true, reason: 'no_recipients' };
    }

    let delivery;
    try {
      delivery = resolveRepartoEmailDelivery({
        recipients: resolution.emails,
        env,
        mode: 'automatic',
      });
    } catch (error) {
      logger.warn(`[comercial-cobro-notify] policy: ${error.code || error.message}`);
      return { skipped: true, reason: 'policy_rejected' };
    }

    const amount = Number(importe);
    const payload = {
      cobroId: identity,
      documento: normalizeText(referencia),
      codigoCliente: normalizeText(codigoCliente),
      nombreCliente: '',
      repartidorId: comercialCode,
      importe: Number.isFinite(amount) ? amount.toFixed(2) : '0.00',
      pendiente: '0.00',
      formaPago: normalizeText(formaPago),
      origen: 'COMERCIAL',
      registradoAt: new Date().toISOString(),
      notas: normalizeText(observaciones),
    };

    const subject = `Cobro comercial ${payload.documento} - ${payload.importe} EUR`;
    const textBody = [
      'ID de cobro: ' + payload.cobroId,
      'Documento: ' + payload.documento,
      'Cliente: ' + payload.codigoCliente,
      'Comercial: ' + comercialCode,
      'Importe: ' + payload.importe + ' EUR',
      'Forma de pago: ' + payload.formaPago,
      'Origen: COMERCIAL',
    ].join('\n');
    const htmlBody = `<pre style="font-family:sans-serif">${textBody.replace(/</g, '&lt;')}</pre>`;

    const pdfBuffer = await buildCobroPdfBuffer(payload);
    const pdfFilename = buildCobroPdfFileName(payload);
    const results = [];
    for (const to of delivery.effectiveRecipients) {
      try {
        await sendEmail({
          to,
          subject,
          htmlBody,
          textBody,
          pdfBuffer,
          pdfFilename,
        });
        results.push({ to, success: true });
      } catch (error) {
        logger.error('[comercial-cobro-notify] email failed', {
          code: normalizeText(error?.code) || 'SMTP_FAILURE',
        });
        results.push({ success: false });
      }
    }

    return {
      skipped: false,
      ...redactDeliverySummary(results),
    };
  } catch (error) {
    logger.warn('[comercial-cobro-notify] failed', {
      code: normalizeText(error?.code) || 'NOTIFICATION_FAILURE',
      message: String(error?.message || '').slice(0, 180),
    });
    return { skipped: true, reason: 'notification_failed' };
  }
}

module.exports = {
  notifyCommercialCobro,
  resolveCommercialCobroRecipients,
};
