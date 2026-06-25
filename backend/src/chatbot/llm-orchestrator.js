'use strict';

const { getPool } = require('../../config/db');
const { handleChatMessage } = require('./chatbot_handler');
const {
  createChatbotUserContext,
  getAllowedVendorCodes,
  normalizeCode,
} = require('./chatbot_authorization');
const {
  logChatEvent,
  moderateInput,
  validateOutput,
} = require('./moderation');

const ALLOWED_CHATBOT_ROLES = new Set([
  'COMERCIAL',
  'JEFE_VENTAS',
  'JEFE',
  'GERENTE',
  'ADMIN',
  'REPARTIDOR',
  'ALMACEN',
]);

function normalizeVendorScope(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(raw.map(normalizeCode).filter(Boolean))];
}

function buildChatbotContext(user = {}, conversationHistory = []) {
  const base = createChatbotUserContext(user);
  const tokenScope = normalizeVendorScope(user.vendorCodes || user.vendedorCodes);
  const contextForScope = {
    ...base,
    vendorScope: tokenScope,
  };
  const vendorScope = base.isJefeVentas
    ? ['ALL']
    : getAllowedVendorCodes(contextForScope).filter(Boolean);

  return {
    ...base,
    vendorScope: vendorScope.length ? vendorScope : normalizeVendorScope(base.userCode),
    conversationHistory: Array.isArray(conversationHistory)
      ? conversationHistory.slice(-12)
      : [],
    richResponses: true,
  };
}

function isAllowedChatbotRole(context = {}) {
  const role = normalizeCode(context.role);
  return ALLOWED_CHATBOT_ROLES.has(role);
}

async function processMessage({
  message,
  user = {},
  clientCode = null,
  conversationHistory = [],
} = {}) {
  const text = String(message || '').trim();
  if (!text) {
    return { success: false, error: 'message is required' };
  }

  const context = buildChatbotContext(user, conversationHistory);
  if (!isAllowedChatbotRole(context)) {
    return {
      success: false,
      statusCode: 403,
      error: 'chatbot role not allowed',
    };
  }

  const moderation = moderateInput(text);
  if (!moderation.allowed) {
    const response = moderation.response || 'No puedo procesar esa consulta.';
    logChatEvent(context.userCode, text, response, {
      moderationBlocked: true,
      reason: moderation.reason,
    });
    return {
      success: true,
      response,
      metadata: {
        moderation: {
          blocked: true,
          reason: moderation.reason,
        },
      },
    };
  }

  const pool = getPool();
  const conn = pool?.connect ? await pool.connect() : pool;
  if (!conn) {
    return { success: false, error: 'Chatbot database connection unavailable' };
  }

  try {
    const response = await handleChatMessage(
      conn,
      text,
      context.vendorScope,
      clientCode,
      context
    );
    const rawText = response && typeof response === 'object'
      ? response.text || ''
      : response;
    const safeText = validateOutput(rawText, context);
    const metadata = response && typeof response === 'object'
      ? response.metadata || {}
      : {};
    logChatEvent(context.userCode, text, safeText, {
      toolCalls: metadata.toolCalls || [],
      moderationBlocked: safeText !== rawText,
    });
    if (response && typeof response === 'object') {
      return {
        success: true,
        response: safeText,
        metadata,
      };
    }
    return { success: true, response: safeText };
  } finally {
    if (conn && typeof conn.close === 'function') {
      await conn.close();
    }
  }
}

module.exports = { processMessage };
