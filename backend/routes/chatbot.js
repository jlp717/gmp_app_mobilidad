'use strict';

const express = require('express');
const { z } = require('zod');
const { verifyToken } = require('../middleware/auth');
const logger = require('../middleware/logger');
const {
  CHATBOT_LOG_EVENTS,
  emitChatbotLog,
} = require('../src/chatbot/chatbot_log');
const { processMessage } = require('../src/chatbot/llm-orchestrator');

const router = express.Router();

const historyEntrySchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.string().max(2000) }).strict(),
  z.object({ role: z.literal('assistant'), content: z.string().max(3000) }).strict(),
]);

const messageBodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationHistory: z.array(historyEntrySchema).max(12).nullish()
    .transform((history) => history ?? []),
  clientCode: z.string().trim().min(1).max(64).nullish(),
  repartidorId: z.string().trim().min(1).max(64).nullish(),
}).strict();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    llm: 'available',
    model: process.env.CHATBOT_MODEL || 'fallback',
    timestamp: new Date().toISOString(),
  });
});

async function messageHandler(req, res) {
  const parsed = messageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_CHATBOT_PAYLOAD',
      code: 'INVALID_CHATBOT_PAYLOAD',
    });
  }

  try {
    const result = await processMessage({
      message: parsed.data.message,
      user: req.user || {},
      clientCode: parsed.data.clientCode,
      repartidorId: parsed.data.repartidorId,
      conversationHistory: parsed.data.conversationHistory,
    });

    if (result && result.success === false && result.statusCode) {
      return res.status(result.statusCode).json(result);
    }

    res.json(result);
  } catch (error) {
    emitChatbotLog('error', CHATBOT_LOG_EVENTS.messageFailed);
    res.status(500).json({ success: false, error: 'Chatbot error' });
  }
}

router.post('/message', verifyToken, messageHandler);

module.exports = router;
module.exports.messageHandler = messageHandler;
module.exports.messageBodySchema = messageBodySchema;
