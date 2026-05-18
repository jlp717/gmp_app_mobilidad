'use strict';

let Sentry = null;

try {
  Sentry = require('@sentry/node');
} catch (_) {
  Sentry = null;
}

if (Sentry && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    includeLocalVariables: process.env.NODE_ENV !== 'production',
    enableLogs: true,
  });
}

module.exports = Sentry;
