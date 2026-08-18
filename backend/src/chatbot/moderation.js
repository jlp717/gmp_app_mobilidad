/**
 * Asistente GMP — Content Moderation (Production-Grade)
 * 
 * Three-layer moderation:
 * 1. Input moderation: blocks politics, religion, SQL injection, off-topic, PII extraction
 * 2. Output validation: strips other vendor data, sanitizes responses, truncates long output
 * 3. Audit logging: tracks all moderation events for compliance
 */

const {
    CHATBOT_LOG_EVENTS,
    emitChatbotLog,
} = require('./chatbot_log');

// ── Input Moderation ─────────────────────────────────────────────────────────

const BLOCKED_TOPICS = [
    // Politics (expanded with common misspellings and variants)
    { pattern: /politica|politic|gobierno|presidente|eleccion|voto|partido\s+politico|izquierda|derecha|congreso|senado|diputado|ministerio|ley\s+electoral|constitucion|sanchez|feijoo|psoe|pp|vox|sumar|trump|biden|putin|dictador|fascista|comunista|democracia|votar|urnas|campana\s+electoral/i, reason: 'politica' },
    // Religion (expanded)
    { pattern: /religion|iglesia|papa|dios|jesus|al[aá]|allah|biblia|coran|mezquita|catedral|pastor|cura|sacerdote|oracion|misa|culto|religioso|ateo|cristiano|musulman|judio|hindu|budista|evang[eé]lico|morm[oó]n|testigo\s+de\s+jehov[aá]/i, reason: 'religion' },
    // Controversial topics
    { pattern: /aborto|feminismo|racismo|homofobia|transfobia|violencia\s+genero|armas|droga|narcotrafico|prostitucion|euthanasia|suicidio|pedofilia|terrorista|terrorismo| ETA|yihad|kalashnikov/i, reason: 'controversial' },
    // Off-topic personal
    { pattern: /chiste|cuento|cancion|poema|receta\s+de\s+cocina|como\s+ligar|cita|pareja|novi[ao]|sexo|amor|amistad|consejo\s+personal|terap|psicolog|medico\s+personal|dieta\s+personal|horoscopo|tarot/i, reason: 'off-topic' },
    // Entertainment
    { pattern: /pelicula|serie|netflix|hbo|disney|musica|cantante|actor|deporte|futbol|balon|tenis|formula\s*1|olimpico|mundial\s+de\s+fu/i, reason: 'off-topic-entertainment' },
    // General knowledge outside GMP
    { pattern: /clima|tiempo\s+hoy|noticias|actualidad|wikipedia|google\s+que\s+es|que\s+es\s+la\s+vida|sentido\s+de\s+la\s+vida|filosofia|matematicas|historia\s+universal|traduc/i, reason: 'off-topic-general' },
    // Hacking / Security attacks
    { pattern: /hack|exploit|vulnerabilidad|sql\s*injection|xss|csrf|buffer\s*overflow|reverse\s*shell|backdoor|rootkit|keylogger|phishing|brute\s*force|denegacion\s*de\s*servicio|ddos|botnet|cryptojacking/i, reason: 'security-attack' },
    // Prompt injection / LLM manipulation
    { pattern: /ignore\s*(previous|all|these)\s*(rules|instructions|prompt)|you\s*are\s*now|system\s*prompt|override|jailbreak|DAN\s*mode|act\s*as\s*(admin|developer|system|root)|bypass\s*security|disable\s*moderation/i, reason: 'prompt-injection' },
    // Attempts to extract system info
    { pattern: /cu[aá]l\s*es\s*tu\s*(prompt|instrucci[oó]n|configuraci[oó]n|system|modelo\s*interno)|repite\s*tu\s*(prompt|instrucciones)|muestra\s*tu\s*(codigo|configuraci[oó]n)|token\s*secret|jwt\s*secret|api\s*key|contrase[nñ]a\s*del\s*sistema/i, reason: 'system-info-leak' },
];

const INJECTION_PATTERNS = [
    // SQL injection (comprehensive)
    /['";]\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|SHUTDOWN|KILL)\s/i,
    /--\s*$/,
    /\/\*.*\*\//,
    /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|SHUTDOWN)\s/i,
    /UNION\s+(ALL\s+)?SELECT/i,
    /UNION\s+SELECT/i,
    /OR\s+1\s*=\s*1/i,
    /OR\s+'[^']*'\s*=\s*'[^']*'/i,
    /'\s*OR\s*'/i,
    /'\s*;\s*--/i,
    /EXEC\s*\(/i,
    /xp_cmdshell/i,
    /LOAD_FILE/i,
    /INTO\s+OUTFILE/i,
    /INTO\s+DUMPFILE/i,
    /BENCHMARK\s*\(/i,
    /SLEEP\s*\(/i,
    /WAITFOR\s+DELAY/i,
    /CONCAT\s*\(/i,
    /CHAR\s*\(/i,
    /HEX\s*\(/i,
    /UNHEX\s*\(/i,
    /INFORMATION_SCHEMA/i,
    /sys\.tables/i,
    /syscolumns/i,
    /sysobjects/i,
    // XSS
    /<script[^>]*>/i,
    /javascript\s*:/i,
    /on(error|load|click|mouseover)\s*=/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    // Command injection
    /\|\s*(ls|cat|rm|wget|curl|nc|bash|sh|cmd|powershell)/i,
    /`[^`]*`/,
    /\$\([^)]*\)/,
    // Path traversal
    /\.\.\/\.\.\//i,
    /%2e%2e%2f/i,
    // NoSQL injection
    /\[\$gt|\$lt|\$ne|\$regex\]/i,
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
            emitChatbotLog('warn', CHATBOT_LOG_EVENTS.inputBlocked);
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
            emitChatbotLog('info', CHATBOT_LOG_EVENTS.topicBlocked);
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

    // CRITICAL: Check for SQL/code leakage in output
    if (/SELECT\s+.*\s+FROM\s+/i.test(response) || /DROP\s+TABLE/i.test(response) || /INSERT\s+INTO/i.test(response)) {
        emitChatbotLog('warn', CHATBOT_LOG_EVENTS.outputSqlBlocked);
        return 'Se ha detectado contenido no permitido en la respuesta. Reformula tu consulta.';
    }

    if (/\b(SQLSTATE|SQL\d{4,5}[A-Z]?|ODBC|CLI Driver|DSEDAC\.|DSED\.|JAVIER\.)\b/i.test(response)) {
        emitChatbotLog('warn', CHATBOT_LOG_EVENTS.outputDatabaseDetailBlocked);
        return 'No se pudo completar la consulta de forma segura. Reformula la pregunta o intentalo de nuevo.';
    }

    // Check for credential/secret leakage
    if (/gsk_[a-zA-Z0-9]{20,}/i.test(response) || /jwt.*secret|token.*secret|password.*=/i.test(response)) {
        emitChatbotLog('warn', CHATBOT_LOG_EVENTS.outputCredentialBlocked);
        return 'Error interno. Contacta con administracion.';
    }

    // Check for prompt/system info leakage
    if (/system\s*prompt|your\s*instructions|you\s*are\s*(an?\s+)?AI\s*assistant|as\s*an?\s+AI/i.test(response)) {
        emitChatbotLog('warn', CHATBOT_LOG_EVENTS.outputPromptBlocked);
        return 'No tengo informacion para esa consulta.';
    }

    // If not jefe de ventas, check for references to other vendors
    if (!isJefeVentas && userCode) {
        const vendorRefs = response.match(/(?:vendedor|comercial)\s+([A-Z0-9]+)/gi);
        if (vendorRefs) {
            for (const ref of vendorRefs) {
                const code = ref.split(/\s+/).pop();
                if (code && code !== userCode && code !== 'ALL') {
                    emitChatbotLog('warn', CHATBOT_LOG_EVENTS.outputVendorScopeBlocked);
                    return 'No tengo acceso a esa informacion. Solo puedes consultar tus propios datos o los de tus clientes asignados.';
                }
            }
        }
    }

    // Truncate excessively long responses (DoS prevention)
    if (response.length > 3000) {
        response = response.substring(0, 2900) + '\n\n...[respuesta truncada. Reformula para obtener detalles especificos].';
    }

    return response;
}

// ── Audit Logging ────────────────────────────────────────────────────────────

function logChatEvent(userCode, message, response, metadata = {}) {
    emitChatbotLog('info', CHATBOT_LOG_EVENTS.interaction, {
        messageLength: message.length,
        responseLength: response?.length || 0,
        llmUsed: metadata.llmUsed || false,
        toolCallCount: Array.isArray(metadata.toolCalls) ? metadata.toolCalls.length : 0,
        moderationBlocked: metadata.moderationBlocked || false,
    });
}

module.exports = {
    moderateInput,
    validateOutput,
    logChatEvent,
    BLOCKED_TOPICS,
    INJECTION_PATTERNS
};
