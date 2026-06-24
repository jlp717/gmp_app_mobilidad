'use strict';

const { getPool } = require('../../config/db');
const { handleChatMessage } = require('./chatbot_handler');
const {
  createChatbotUserContext,
  getAllowedVendorCodes,
  normalizeCode,
} = require('./chatbot_authorization');

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

  const pool = getPool();
  const conn = pool?.connect ? await pool.connect() : pool;
  if (!conn) {
    return { success: false, error: 'Chatbot database connection unavailable' };
  }

  try {
    const context = buildChatbotContext(user, conversationHistory);
    const response = await handleChatMessage(
      conn,
      text,
      context.vendorScope,
      clientCode,
      context
    );
    if (response && typeof response === 'object') {
      return {
        success: true,
        response: response.text || '',
        metadata: response.metadata || {},
      };
    }
    return { success: true, response };
  } finally {
    if (conn && typeof conn.close === 'function') {
      await conn.close();
    }
  }
}

module.exports = { processMessage };
