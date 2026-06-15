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
const { processMessage, resolveVendorScope } = require('../src/chatbot/llm-orchestrator');
const { logChatEvent } = require('../src/chatbot/moderation');
const {
    createChatbotUserContext,
    authorizeResolvedClient,
    buildAuthorizationSafeResponse,
    normalizeCode,
} = require('../src/chatbot/chatbot_authorization');

// ── Health Check (no auth needed — MUST be before verifyToken) ───────────────

router.get('/health', (req, res) => {
    const hasGroqKey = !!process.env.GROQ_API_KEY;
    res.json({
        status: 'ok',
        llm: hasGroqKey ? 'enabled' : 'disabled (using regex fallback)',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        timestamp: new Date().toISOString()
    });
});

// All chatbot endpoints require authentication
router.use(verifyToken);

// ── Chat Message Endpoint ────────────────────────────────────────────────────

router.post('/message', async (req, res) => {
    let conn;
    try {
        const { message, conversationHistory, clientCode: bodyClientCode } = req.body;

        if (typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ error: 'Mensaje requerido' });
        }

        if (message.length > 2000) {
            return res.status(400).json({ error: 'Mensaje demasiado largo' });
        }

        if (conversationHistory !== undefined && !Array.isArray(conversationHistory)) {
            return res.status(400).json({ error: 'conversationHistory debe ser un array' });
        }

        // Extract user context from JWT token only. Never trust body clientCode/vendedor.
        const userContext = createChatbotUserContext(req.user || {});
        if (!userContext.userCode) {
            return res.status(403).json({ error: 'Usuario no autorizado' });
        }
        const vendorScope = resolveVendorScope(
            userContext.userCode,
            userContext.role,
            userContext.isJefeVentas
        );
        const safeConversationHistory = Array.isArray(conversationHistory)
            ? conversationHistory.slice(-5).filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
            : [];

        // Get database connection
        const pool = getPool();
        if (!pool) throw new Error("Database pool not initialized");

        conn = await pool.connect();

        try {
            const enrichedContext = { ...userContext, vendorScope };
            const normalizedBodyClient = normalizeCode(bodyClientCode);
            if (normalizedBodyClient) {
                const { authorization } = await authorizeResolvedClient(
                    conn,
                    enrichedContext,
                    normalizedBodyClient
                );
                if (!authorization.allowed) {
                    const safeResponse = buildAuthorizationSafeResponse(authorization.code);
                    return res.status(403).json({
                        error: 'Cliente fuera de ambito autorizado',
                        response: safeResponse,
                    });
                }
                enrichedContext.hintClientCode = normalizedBodyClient;
            }

            const response = await processMessage(
                conn,
                message.trim(),
                enrichedContext,
                safeConversationHistory
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
                try { await conn.close(); } catch (closeErr) {
                    logger.debug(`[CHATBOT] conn.close ignored: ${closeErr.message}`);
                }
            }
        }
    } catch (error) {
        logger.error(`[CHATBOT] Route error: ${error.message}`);
        if (conn && conn.connected) {
            try { await conn.close(); } catch (closeErr) {
                logger.debug(`[CHATBOT] conn.close ignored: ${closeErr.message}`);
            }
        }

        res.status(500).json({
            error: 'Error procesando mensaje',
            response: 'Lo siento, hubo un error interno. Intenta de nuevo.'
        });
    }
});

module.exports = router;
