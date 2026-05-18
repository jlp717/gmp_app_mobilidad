/**
 * NEXUS AI — Chatbot Route
 * 
 * Security: verifyToken middleware required for all endpoints.
 * LLM-first with regex fallback.
 */

const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { verifyToken } = require('../middleware/auth');
const { getPool } = require('../config/db');
const { processMessage } = require('../src/chatbot/llm-orchestrator');
const { logChatEvent } = require('../src/chatbot/moderation');

// All chatbot endpoints require authentication
router.use(verifyToken);

// ── Chat Message Endpoint ────────────────────────────────────────────────────

router.post('/message', async (req, res) => {
    let conn;
    try {
        const { message, conversationHistory } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: 'Mensaje requerido' });
        }

        // Extract user context from JWT token (set by verifyToken middleware)
        const userContext = {
            userCode: req.user.code,
            isJefeVentas: req.user.isJefeVentas,
            role: req.user.role,
            vendedorCodes: [req.user.code] // Single vendor scope from auth
        };

        // Get database connection
        const pool = getPool();
        if (!pool) throw new Error("Database pool not initialized");

        conn = await pool.connect();

        try {
            const response = await processMessage(
                conn,
                message.trim(),
                userContext,
                conversationHistory || []
            );

            // Audit log
            logChatEvent(req.user.code, message, response, {
                llmUsed: true,
                moderationBlocked: response.includes('Solo puedo ayudarte')
            });

            res.json({
                response,
                timestamp: new Date().toISOString(),
                user: req.user.code
            });
        } finally {
            if (conn) {
                try { await conn.close(); } catch (e) { }
            }
        }
    } catch (error) {
        logger.error(`[CHATBOT] Route error: ${error.message}`);
        if (conn && conn.connected) {
            try { await conn.close(); } catch (e) { }
        }

        res.status(500).json({
            error: 'Error procesando mensaje',
            response: 'Lo siento, hubo un error interno. Intenta de nuevo.'
        });
    }
});

// ── Health Check (no auth needed) ────────────────────────────────────────────

router.get('/health', (req, res) => {
    const hasGroqKey = !!process.env.GROQ_API_KEY;
    res.json({
        status: 'ok',
        llm: hasGroqKey ? 'enabled' : 'disabled (using regex fallback)',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
