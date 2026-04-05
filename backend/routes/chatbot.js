const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { getPool } = require('../config/db');
const { handleChatMessage } = require('../src/chatbot/chatbot_handler');

// =============================================================================
// AI CHATBOT ENDPOINT
// =============================================================================
router.post('/message', async (req, res) => {
    let conn;
    try {
        const { message, vendedorCodes, clientCode } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: 'Mensaje requerido' });
        }

        // Get database connection using shared pool for transaction/session
        // The chatbot handler requires a raw connection object
        const pool = getPool();
        if (!pool) throw new Error("Database pool not initialized");

        conn = await pool.connect();

        try {
            const response = await handleChatMessage(
                conn,
                message,
                vendedorCodes ? (Array.isArray(vendedorCodes) ? vendedorCodes : vendedorCodes.split(',')) : [],
                clientCode
            );
            res.json({ response, timestamp: new Date().toISOString() });
        } finally {
            // Always close local connection obtained from pool.connect()
            await conn.close();
        }
    } catch (error) {
        logger.error(`Chatbot error: ${error.message}`);
        // If conn wasn't closed in inner try, close it here (though inner finally handles it)
        // Safety check just in case
        if (conn && conn.connected) {
            try { await conn.close(); } catch (e) { }
        }

        res.status(500).json({
            error: 'Error procesando mensaje',
            response: '❌ Lo siento, hubo un error. Intenta de nuevo.'
        });
    }
});

module.exports = router;
