'use strict';

const express = require('express');
const { verifyToken } = require('../middleware/auth');
const logger = require('../middleware/logger');
const {
  CHATBOT_LOG_EVENTS,
  emitChatbotLog,
} = require('../src/chatbot/chatbot_log');
const {
  authorizeChatbotRepartoScope,
  authorizeResolvedClient,
  buildAuthorizationSafeResponse,
  createChatbotUserContext,
} = require('../src/chatbot/chatbot_authorization');
const { getPool } = require('../config/db');
const { processMessage } = require('../src/chatbot/llm-orchestrator');

const router = express.Router();

// Tier-1: validacion zod strict patron clients.js (fail-closed sin validador).
let chatbotZod = null;
try {
  chatbotZod = require('zod').z;
} catch (e) {
  chatbotZod = null;
}
const chatbotHistoryItemSchema = chatbotZod
  ? chatbotZod.object({
    role: chatbotZod.string().max(20).optional(),
    content: chatbotZod.string().max(2000).optional(),
    text: chatbotZod.string().max(2000).optional(),
  }).strict()
  : null;
const chatbotMessageSchema = chatbotZod
  ? chatbotZod.object({
    message: chatbotZod.string().min(1).max(2000),
    clientCode: chatbotZod.string().regex(/^[A-Za-z0-9]+$/).max(10).optional(),
    repartidorId: chatbotZod.string().regex(/^[A-Za-z0-9,]{1,100}$/).max(100).optional(),
    conversationHistory: chatbotZod.array(chatbotHistoryItemSchema).max(20).optional(),
  }).strict()
  : null;

function validateChatbotMessage(req, res, next) {
  if (!chatbotMessageSchema) {
    return res.status(500).json({ success: false, code: 'VALIDATOR_UNAVAILABLE', error: 'Validador no disponible' });
  }
  const parsed = chatbotMessageSchema.safeParse({
    message: req.body?.message,
    ...(req.body?.clientCode !== undefined ? { clientCode: String(req.body.clientCode) } : {}),
    ...(req.body?.repartidorId !== undefined ? { repartidorId: String(req.body.repartidorId) } : {}),
    ...(req.body?.conversationHistory !== undefined ? { conversationHistory: req.body.conversationHistory } : {}),
  });
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'INVALID_CHATBOT_MESSAGE', error: 'message requerido (1-2000 chars); clientCode alfanumerico max 10' });
  }
  req.chatbotInput = {
    message: parsed.data.message.trim(),
    clientCode: parsed.data.clientCode,
    repartidorId: parsed.data.repartidorId,
    conversationHistory: Array.isArray(parsed.data.conversationHistory)
      ? parsed.data.conversationHistory.slice(-20)
      : [],
  };
  next();
}

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    llm: 'available',
    model: process.env.CHATBOT_MODEL || 'fallback',
    timestamp: new Date().toISOString(),
  });
});

router.post('/message', verifyToken, validateChatbotMessage, async (req, res) => {
  try {
    const { message, clientCode, repartidorId, conversationHistory } = req.chatbotInput;

    // Reutiliza el patron ensureRepartidorAccess de entregas.js via el helper
    // canonico authorizeChatbotRepartoScope (fail fast antes del LLM).
    const repartoAuthorization = authorizeChatbotRepartoScope(req.user || {}, repartidorId);
    if (!repartoAuthorization.allowed) {
      const status = ['REPARTO_SCOPE_REQUIRED', 'REPARTO_SCOPE_INVALID'].includes(repartoAuthorization.code) ? 422 : 403;
      return res.status(status).json({ success: false, code: repartoAuthorization.code, error: 'No tienes permisos para operar sobre este repartidor' });
    }

    // Ownership de clientCode contra la cartera del usuario autenticado via
    // authorizeResolvedClient (DB CLP/LAC/LACLAE). Solo bloquea con owner
    // verificado; si la lookup no verifica (DB caida), decide el orchestrator.
    if (clientCode) {
      let conn = null;
      try {
        const pool = getPool();
        conn = pool?.connect ? await pool.connect() : pool;
        if (conn) {
          const userContext = {
            ...createChatbotUserContext(req.user || {}),
            vendorScope: req.user?.vendorScope || req.user?.vendorCodes || req.user?.vendedorCodes,
          };
          const { owner, authorization } = await authorizeResolvedClient(conn, userContext, clientCode);
          if (owner && owner.verified && !authorization.allowed) {
            return res.status(403).json({
              success: false,
              code: authorization.code || 'FORBIDDEN_CLIENT_SCOPE',
              error: buildAuthorizationSafeResponse(authorization.code),
            });
          }
        }
      } catch (lookupErr) {
        logger.warn(`[CHATBOT] owner lookup best-effort fallo: ${lookupErr.message}`);
      } finally {
        if (conn && typeof conn.close === 'function') {
          try { await conn.close(); } catch (_) { /* best-effort */ }
        }
      }
    }

    const result = await processMessage({
      message,
      user: req.user || {},
      clientCode,
      repartidorId,
      conversationHistory,
    });

    if (result && result.success === false && result.statusCode) {
      return res.status(result.statusCode).json(result);
    }

    res.json(result);
  } catch (error) {
    emitChatbotLog('error', CHATBOT_LOG_EVENTS.messageFailed);
    res.status(500).json({ success: false, error: 'Chatbot error' });
  }
});

module.exports = router;
