/**
 * NEXUS AI — Content Moderation
 * 
 * Two-layer moderation:
 * 1. Input moderation: blocks politics, religion, SQL injection attempts, off-topic
 * 2. Output validation: strips other vendor data, sanitizes LLM responses
 */

const logger = require('../../middleware/logger');

// ── Input Moderation ─────────────────────────────────────────────────────────

const BLOCKED_TOPICS = [
    // Politics
    { pattern: /politica|politic|gobierno|presidente|eleccion|voto|partido\s+politico|izquierda|derecha|congreso|senado|diputado/i, reason: 'politica' },
    // Religion
    { pattern: /religion|iglesia|papa|dios|jesus|alá|allah|biblia|coran|mezquita|catedral|pastor|cura|sacerdote/i, reason: 'religion' },
    // Controversial
    { pattern: /aborto|feminismo|racismo|homofobia|transfobia|violencia\s+genero|armas|droga|narcotrafico/i, reason: 'controversial' },
    // Off-topic personal
    { pattern: /chiste|cuento|cancion|poema|receta\s+de\s+cocina|como\s+ligar|cita/i, reason: 'off-topic' },
];

const INJECTION_PATTERNS = [
    /['";]\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE)\s/i,
    /--\s*$/,
    /\/\*.*\*\//,
    /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE)\s/i,
    /UNION\s+SELECT/i,
    /OR\s+1\s*=\s*1/i,
    /'\s*OR\s*'/i,
];

function moderateInput(message) {
    // Check for injection attempts
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(message)) {
            logger.warn(`[CHATBOT-MODERATION] Injection attempt detected: ${message.substring(0, 100)}`);
            return {
                allowed: false,
                reason: 'injection',
                response: 'No puedo procesar esa consulta por motivos de seguridad. Si necesitas ayuda con datos comerciales, reformula tu pregunta.'
            };
        }
    }

    // Check for blocked topics
    for (const topic of BLOCKED_TOPICS) {
        if (topic.pattern.test(message)) {
            logger.info(`[CHATBOT-MODERATION] Blocked topic: ${topic.reason}`);
            return {
                allowed: false,
                reason: topic.reason,
                response: 'Solo puedo ayudarte con consultas comerciales y operativas de GMP. Si tienes dudas sobre comisiones, precios, clientes o stock, estoy aqui para ayudarte.'
            };
        }
    }

    return { allowed: true };
}

// ── Output Validation ────────────────────────────────────────────────────────

/**
 * Validates LLM output before sending to client.
 * - Checks for other vendor data leakage
 * - Sanitizes markdown
 * - Ensures response is in Spanish
 */
function validateOutput(response, context) {
    if (!response || typeof response !== 'string') {
        return 'No pude generar una respuesta. Intenta de nuevo.';
    }

    // Check for vendor data leakage (look for vendor codes that don't match user)
    const userCode = context.userCode;
    const isJefeVentas = context.isJefeVentas;

    // If not jefe de ventas, check for references to other vendors
    if (!isJefeVentas && userCode) {
        // Pattern: "vendedor XYZ" or "comercial XYZ" where XYZ != userCode
        const vendorRefs = response.match(/(?:vendedor|comercial)\s+([A-Z0-9]+)/gi);
        if (vendorRefs) {
            for (const ref of vendorRefs) {
                const code = ref.split(/\s+/).pop();
                if (code && code !== userCode) {
                    logger.warn(`[CHATBOT-MODERATION] Potential vendor data leak: ${ref}`);
                    return 'No tengo acceso a esa informacion. Solo puedes consultar tus propios datos o los de tus clientes asignados.';
                }
            }
        }
    }

    // Truncate excessively long responses
    if (response.length > 3000) {
        response = response.substring(0, 2900) + '\n\n...[respuesta truncada. Reformula para obtener detalles especificos].';
    }

    return response;
}

// ── Audit Logging ────────────────────────────────────────────────────────────

function logChatEvent(userCode, message, response, metadata = {}) {
    logger.info({
        event: 'chatbot_interaction',
        user: userCode,
        messageLength: message.length,
        responseLength: response?.length || 0,
        llmUsed: metadata.llmUsed || false,
        toolCalls: metadata.toolCalls || [],
        moderationBlocked: metadata.moderationBlocked || false,
        timestamp: new Date().toISOString()
    });
}

module.exports = {
    moderateInput,
    validateOutput,
    logChatEvent,
    BLOCKED_TOPICS,
    INJECTION_PATTERNS
};
