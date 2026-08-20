/**
 * WhatsApp Cloud API (Meta) — corporate bot send for albaranes/facturas.
 *
 * When disabled/misconfigured, callers MUST keep LOCAL_USER_ACTION share.
 *
 * Env:
 *   WHATSAPP_CLOUD_ENABLED=true
 *   WHATSAPP_ACCESS_TOKEN=...
 *   WHATSAPP_PHONE_NUMBER_ID=...
 *   WHATSAPP_API_VERSION=v21.0          (optional)
 *   WHATSAPP_SEND_MODE=template|document (default template — cold outreach)
 *   WHATSAPP_TEMPLATE_NAME=albaran_documento
 *   WHATSAPP_TEMPLATE_LANG=es
 */

'use strict';

const FormData = require('form-data');
const logger = require('../middleware/logger');

const API_VERSION = String(process.env.WHATSAPP_API_VERSION || 'v21.0').trim();
const PHONE_NUMBER_ID = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const ACCESS_TOKEN = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
const SEND_MODE = String(process.env.WHATSAPP_SEND_MODE || 'template').trim().toLowerCase();
const TEMPLATE_NAME = String(process.env.WHATSAPP_TEMPLATE_NAME || 'albaran_documento').trim();
const TEMPLATE_LANG = String(process.env.WHATSAPP_TEMPLATE_LANG || 'es').trim();

function isEnabled() {
  return String(process.env.WHATSAPP_CLOUD_ENABLED || '').toLowerCase() === 'true';
}

function isConfigured() {
  return isEnabled() && Boolean(PHONE_NUMBER_ID) && Boolean(ACCESS_TOKEN);
}

function normalizeE164Digits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(digits)) {
    const err = new Error('PHONE_INVALID');
    err.code = 'PHONE_INVALID';
    throw err;
  }
  // Spain local mobiles often arrive as 9 digits (6xx...); prefix 34.
  if (digits.length === 9 && digits.startsWith('6')) {
    return `34${digits}`;
  }
  return digits;
}

function graphUrl(path) {
  return `https://graph.facebook.com/${API_VERSION}/${path}`;
}

async function graphJson(url, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      ...headers,
    },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      json?.error?.message || `WhatsApp Graph API ${res.status}`,
    );
    err.code = json?.error?.code || 'WHATSAPP_GRAPH_ERROR';
    err.status = res.status;
    err.details = json?.error || null;
    throw err;
  }
  return json;
}

/**
 * Upload PDF to Meta media store. Returns media id (valid ~30 days).
 */
async function uploadDocument({ pdfBuffer, filename }) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error('PDF buffer requerido');
  }
  const safeName = String(filename || 'documento.pdf')
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 120) || 'documento.pdf';

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'application/pdf');
  form.append('file', pdfBuffer, {
    filename: safeName,
    contentType: 'application/pdf',
  });

  const url = graphUrl(`${PHONE_NUMBER_ID}/media`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      ...form.getHeaders(),
    },
    body: form,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok || !json.id) {
    const err = new Error(json?.error?.message || 'WhatsApp media upload failed');
    err.code = 'WHATSAPP_MEDIA_UPLOAD_FAILED';
    err.status = res.status;
    err.details = json?.error || null;
    throw err;
  }
  return { mediaId: String(json.id), filename: safeName };
}

async function sendSessionDocument({ to, mediaId, filename, caption }) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'document',
    document: {
      id: mediaId,
      filename,
      ...(caption ? { caption: String(caption).slice(0, 1024) } : {}),
    },
  };
  return graphJson(graphUrl(`${PHONE_NUMBER_ID}/messages`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Utility template with DOCUMENT header + body params.
 * Template must be pre-approved in Meta Business Manager.
 * Expected shape (example):
 *   header: DOCUMENT
 *   body: "Albarán {{1}} — {{2}}"
 */
async function sendTemplateDocument({
  to,
  mediaId,
  filename,
  bodyParams = [],
}) {
  const components = [
    {
      type: 'header',
      parameters: [
        {
          type: 'document',
          document: {
            id: mediaId,
            filename,
          },
        },
      ],
    },
  ];
  if (Array.isArray(bodyParams) && bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams
        .slice(0, 10)
        .map((text) => ({ type: 'text', text: String(text ?? '').slice(0, 1024) })),
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANG },
      components,
    },
  };
  return graphJson(graphUrl(`${PHONE_NUMBER_ID}/messages`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Send albarán/factura PDF from the corporate WhatsApp number.
 * @returns {{ success: true, messageId: string, mode: string, to: string }}
 */
async function sendDocumentFromBot({
  telefono,
  pdfBuffer,
  filename,
  caption,
  bodyParams,
}) {
  if (!isConfigured()) {
    const err = new Error('WhatsApp Cloud API no configurada');
    err.code = 'WHATSAPP_NOT_CONFIGURED';
    throw err;
  }

  const to = normalizeE164Digits(telefono);
  const { mediaId, filename: safeName } = await uploadDocument({
    pdfBuffer,
    filename,
  });

  let result;
  if (SEND_MODE === 'document') {
    result = await sendSessionDocument({
      to,
      mediaId,
      filename: safeName,
      caption,
    });
  } else {
    result = await sendTemplateDocument({
      to,
      mediaId,
      filename: safeName,
      bodyParams: bodyParams || [safeName, caption || 'Documento Granja Mari Pepa'].filter(Boolean),
    });
  }

  const messageId = result?.messages?.[0]?.id
    ? String(result.messages[0].id)
    : '';
  if (!messageId) {
    const err = new Error('WhatsApp no devolvió message id');
    err.code = 'WHATSAPP_MESSAGE_ID_REQUIRED';
    throw err;
  }

  logger.info('[WhatsAppCloud] document sent', {
    toSuffix: to.slice(-4),
    mode: SEND_MODE,
    messageId,
  });

  return {
    success: true,
    messageId,
    mode: SEND_MODE === 'document' ? 'SESSION_DOCUMENT' : 'TEMPLATE_DOCUMENT',
    to,
  };
}

module.exports = {
  isEnabled,
  isConfigured,
  normalizeE164Digits,
  uploadDocument,
  sendDocumentFromBot,
  SEND_MODE,
  TEMPLATE_NAME,
};
