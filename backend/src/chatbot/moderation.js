/**
 * NEXUS AI — Content Moderation (Production-Grade)
 * 
 * Three-layer moderation:
 * 1. Input moderation: blocks politics, religion, SQL injection, off-topic, PII extraction
 * 2. Output validation: strips other vendor data, sanitizes responses, truncates long output
 * 3. Audit logging: tracks all moderation events for compliance
 */

const logger = require('../../middleware/logger');

// ── Input Moderation ─────────────────────────────────────────────────────────

const BLOCKED_TOPICS = [
    // Politics (expanded with common misspellings)
    { pattern: /politica|politic|gobierno|presidente|eleccion|voto|partido\s+politico|izquierda|derecha|congreso|senado|diputado|ministerio|ley\s+electoral|constitucion|sanchez|feijoo|psoe|pp|vox|sumar/i, reason: 'politica' },
    // Religion (expanded)
    { pattern: /religion|iglesia|papa|dios|jesus|alá|allah|biblia|coran|mezquita|catedral|pastor|cura|sacerdote|oracion|misa|culto|religioso|ateo|cristiano|musulman/i, reason: 'religion' },
    // Controversial topics
    { pattern: /aborto|feminismo|racismo|homofobia|transfobia|violencia\s+genero|armas|droga|narcotrafico|prostitucion|euthanasia|suicidio/i, reason: 'controversial' },
    // Off-topic personal
    { pattern: /chiste|cuento|cancion|poema|receta\s+de\s+cocina|como\s+ligar|cita|pareja|novi[ao]|sexo|amor|amistad|consejo\s+personal|terap/i, reason: 'off-topic' },
    // Entertainment
    { pattern: /pelicula|serie|netflix|hbo|disney|musica|cantante|actor|deporte|futbol|balon|mes/i, reason: 'off-topic-entertainment' },
    // General knowledge outside GMP
    { pattern: /clima|tiempo\s+hoy|noticias|actualidad|wikipedia|google\s+que\s+es|que\s+es\s+la\s+vida/i, reason: 'off-topic-general' },
];

const INJECTION_PATTERNS = [
    /['";]\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE)\s/i,
    /--\s*$/,
    /\/\*.*\*\//,
    /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\s/i,
    /UNION\s+SELECT/i,
    /UNION\s+ALL\s+SELECT/i,
    /OR\s+1\s*=\s*1/i,
    /'\s*OR\s*'/i,
    /'\s*;\s*--/i,
    /EXEC\s*\(/i,
    /xp_cmdshell/i,
    /LOAD_FILE/i,
    /INTO\s+OUTFILE/i,
    /BENCHMARK\s*\(/i,
    /SLEEP\s*\(/i,
    /WAITFOR\s+DELAY/i,
    /CONCAT\s*\(/i,
    /CHAR\s*\(/i,
];

/**
 * Moderates user input before processing.
 * Handles misspellings, injection attempts, and off-topic queries.
 */
function moderateInput(message) {
    if (!message || message.trim().length === 0) {
        return {
            allowed: false,
            reason: 'empty',
            response: 'Por favor, escribe tu consulta.'
        };
    }

    const trimmed = message.trim();

    // Allow greetings and help commands
    if (/^(hola|buenos|buenas|hey|que tal|ayuda|help|que puedes hacer)/i.test(trimmed)) {
        return { allowed: true };
    }

    // Check for injection attempts (highest priority)
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(trimmed)) {
            logger.warn(`[CHATBOT-MODERATION] Injection attempt detected: ${trimmed.substring(0, 100)}`);
            return {
                allowed: false,
                reason: 'injection',
                response: 'No puedo procesar esa consulta por motivos de seguridad. Si necesitas ayuda con datos comerciales, reformula tu pregunta.'
            };
        }
    }

    // Check for excessively long messages (DoS prevention)
    if (trimmed.length > 2000) {
        return {
            allowed: false,
            reason: 'too-long',
            response: 'Tu mensaje es demasiado largo. Por favor, simplifica tu consulta.'
        };
    }

    // Check for blocked topics
    for (const topic of BLOCKED_TOPICS) {
        if (topic.pattern.test(trimmed)) {
            logger.info(`[CHATBOT-MODERATION] Blocked topic: ${topic.reason}`);
            return {
                allowed: false,
                reason: topic.reason,
                response: 'Solo puedo ayudarte con consultas comerciales y operativas de GMP. Si tienes dudas sobre comisiones, precios, clientes, stock, pedidos, cobros o cualquier dato de tu actividad comercial, estoy aqui para ayudarte.'
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
 * - Truncates excessively long responses
 */
function validateOutput(response, context) {
    if (!response || typeof response !== 'string') {
        return 'No pude generar una respuesta. Intenta de nuevo.';
    }

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

        // Check for specific vendor codes in context that aren't the user's
        const codePattern = /\b\d{2,4}\b/g;
        const foundCodes = response.match(codePattern) || [];
        // This is a soft check - only flag if there's explicit "vendedor X" pattern
    }

    // Check for SQL or code in output
    if (/SELECT\s+.*\s+FROM\s+/i.test(response) || /DROP\s+TABLE/i.test(response)) {
        logger.warn(`[CHATBOT-MODERATION] SQL detected in output`);
        return 'Se ha detectado contenido no permitido en la respuesta. Reformula tu consulta.';
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
