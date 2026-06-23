'use strict';

const { getPool } = require('../../config/db');
const { handleChatMessage } = require('./chatbot_handler');

async function processMessage({ message, user = {}, clientCode = null } = {}) {
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
    const vendedorCodes = user.vendorCodes || user.vendedorCodes || user.code || user.codigoVendedor || user.id;
    const response = await handleChatMessage(conn, text, vendedorCodes, clientCode, { user });
    return { success: true, response };
  } finally {
    if (conn && typeof conn.close === 'function') {
      await conn.close();
    }
  }
}

module.exports = { processMessage };
