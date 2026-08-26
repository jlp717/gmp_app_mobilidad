'use strict';
/**
 * GMP structured telemetry logger.
 * pino JSON with automatic redaction when installed; deterministic JSON-shim
 * fallback so production never crashes before `npm install` runs on .230.
 */

const SENSITIVE_KEYS = [
  'password', 'passwd', 'secret', 'token', 'authorization', 'apikey',
  'api_key', 'connectionstring', 'dsn', 'cookie', 'bearer',
];

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.includes(String(key).toLowerCase().replace(/[-_]/g, ''));
}

/** Deep clone masking sensitive keys. Depth-capped, cycle-safe. */
function redactForLog(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6 || seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1, seen));
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? '[REDACTED]' : redactForLog(val, depth + 1, seen);
  }
  return out;
}

/** Mask sensitive key=value / key: value pairs inside free-form message text. */
function redactText(text) {
  return String(text)
    .replace(/(password|passwd|secret|token|authorization|apiKey|api_key|connectionString)\s*[:=]\s*[^\s,;)}\]]+/gi,
    '$1=[REDACTED]')
    .replace(/Bearer\s+[^\s,;)}\]]+/gi, 'Bearer [REDACTED]');
}

const LEVEL = process.env.LOG_LEVEL
  || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

let pino = null;
try { pino = require('pino'); } catch (_) { /* fallback shim below */ }

let logger;
if (pino) {
  logger = pino({
    level: LEVEL,
    base: { service: 'gmp-api' },
    redact: {
      paths: [
        'password', 'passwd', 'secret', 'token', 'authorization', 'apiKey',
        'api_key', 'connectionString', 'dsn', 'cookie',
        'req.headers.authorization', 'req.headers.cookie',
        '*.password', '*.token', '*.secret',
      ],
      censor: '[REDACTED]',
    },
  });
} else {
  // ponytail: JSON console shim until pino lands in prod node_modules. upgrade: npm install on .230.
  const PRIORITY = { debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
  const emit = (level, bindings, msgOrObj, maybeMsg) => {
    // Interop estilo pino: logger.info(objeto, 'mensaje') o logger.info('mensaje', meta).
    let msg = msgOrObj;
    let data = maybeMsg;
    if (msgOrObj && typeof msgOrObj === 'object') {
      data = msgOrObj;
      msg = maybeMsg !== undefined ? maybeMsg : (msgOrObj.msg || '');
      if (msgOrObj.msg) { data = { ...msgOrObj }; delete data.msg; }
    }
    const entry = {
      time: Date.now(),
      level: PRIORITY[level],
      levelLabel: level,
      service: 'gmp-api',
      ...bindings,
      msg: redactText(typeof msg === 'string' ? msg : String(msg)),
      ...(data ? redactForLog(data) : {}),
    };
    const line = JSON.stringify(entry);
    if (PRIORITY[level] >= 40) process.stderr.write(line + String.fromCharCode(10)); else process.stdout.write(line + String.fromCharCode(10));
  };
  const makeShim = (bindings = {}) => ({
    debug: (msg, data) => emit('debug', bindings, msg, data),
    info: (msg, data) => emit('info', bindings, msg, data),
    warn: (msg, data) => emit('warn', bindings, msg, data),
    error: (msg, data) => emit('error', bindings, msg, data),
    fatal: (msg, data) => emit('fatal', bindings, msg, data),
    child: (more) => makeShim({ ...bindings, ...redactForLog(more) }),
    level: LEVEL,
  });
  logger = makeShim();
}

// Capturar child ANTES de anadir propiedades al propio logger:
// sobrescribir 'child' en la instancia provocaria recursion infinita.
const baseChild = logger.child.bind(logger);
module.exports = logger;
module.exports.redactForLog = redactForLog;
module.exports.redactText = redactText;
module.exports.child = (bindings) => baseChild(redactForLog(bindings || {}));
