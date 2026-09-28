'use strict';
/**
 * Sentry bootstrap GMP backend.
 * - Produccion: SENTRY_DSN OBLIGATORIO (fail-fast al arrancar).
 * - dev/test: opcional y silencioso.
 * @sentry/node es dependencia directa (cero deps nuevas).
 */

let Sentry = null;

try {
  Sentry = require('@sentry/node');
} catch (_) {
  Sentry = null;
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const SENTRY_DSN = process.env.SENTRY_DSN;

if (NODE_ENV === 'production' && !SENTRY_DSN) {
  throw new Error(
    '[Sentry] Arranque abortado: NODE_ENV=production exige SENTRY_DSN configurado. '
    + 'Define la variable de entorno SENTRY_DSN antes de arrancar.'
  );
}

if (Sentry && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,
    includeLocalVariables: NODE_ENV !== 'production',
    enableLogs: true,
  });
}

module.exports = Sentry;
