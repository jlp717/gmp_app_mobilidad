'use strict';

const express = require('express');
const { verifyToken } = require('../middleware/auth');
const logger = require('../middleware/logger');
const { processMessage } = require('../src/chatbot/llm-orchestrator');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    llm: 'available',
    model: process.env.CHATBOT_MODEL || 'fallback',
    timestamp: new Date().toISOString(),
  });
});

router.post('/message', verifyToken, async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }

    const result = await processMessage({
      message,
      user: req.user || {},
      clientCode: req.body?.clientCode,
      conversationHistory: Array.isArray(req.body?.conversationHistory)
        ? req.body.conversationHistory
        : [],
    });

    if (result && result.success === false && result.statusCode) {
      return res.status(result.statusCode).json(result);
    }

    res.json(result);
  } catch (error) {
    logger.error(`[CHATBOT] message error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Chatbot error' });
  }
});

module.exports = router;
