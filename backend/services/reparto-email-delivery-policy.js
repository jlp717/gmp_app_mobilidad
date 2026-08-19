'use strict';

const crypto = require('crypto');

class RepartoEmailDeliveryPolicyError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message);
    this.name = 'RepartoEmailDeliveryPolicyError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function uniqueEmails(values) {
  return [...new Set((values || []).map(normalizeEmail).filter(Boolean))];
}

function isIsolatedTest(env) {
  return String(env?.REPARTO_TABLE_SET || '').trim().toLowerCase() === 'isolated_test';
}

function testAllowlist(env) {
  return uniqueEmails(String(env?.REPARTO_EMAIL_TEST_ALLOWLIST || '').split(','));
}

/**
 * Enforces the no-leak test-mail policy.  In isolated_test automatic messages
 * are deduplicated and redirected to one explicitly allowlisted sink.  Manual
 * messages keep their requested recipient but must also be allowlisted.
 */
function resolveRepartoEmailDelivery({ recipients, env = process.env, mode = 'automatic' } = {}) {
  const requestedRecipients = uniqueEmails(recipients);
  if (mode === 'manual' && requestedRecipients.length === 0) {
    throw new RepartoEmailDeliveryPolicyError(
      'El destinatario de correo de reparto es obligatorio y debe ser válido',
      'REPARTO_EMAIL_RECIPIENT_REQUIRED',
      422,
    );
  }
  if (!isIsolatedTest(env)) {
    return {
      effectiveRecipients: requestedRecipients,
      redirected: false,
      policy: 'standard',
    };
  }

  const allowlist = testAllowlist(env);
  const sink = normalizeEmail(env?.REPARTO_EMAIL_TEST_SINK);
  if (!allowlist.length) {
    throw new RepartoEmailDeliveryPolicyError(
      'El correo de reparto en isolated_test requiere allowlist explícita',
      'REPARTO_EMAIL_TEST_POLICY_UNCONFIGURED',
      503,
    );
  }

  if (requestedRecipients.length === 0 && mode === 'automatic') {
    if (!sink || !allowlist.includes(sink)) {
      throw new RepartoEmailDeliveryPolicyError(
        'El fallback técnico de correo en isolated_test requiere sink incluido en allowlist',
        'REPARTO_EMAIL_TEST_POLICY_UNCONFIGURED',
        503,
      );
    }
    return {
      effectiveRecipients: [sink],
      redirected: false,
      policy: 'isolated_test_empty_recipient_fallback',
    };
  }

  const notAllowed = requestedRecipients.filter((email) => !allowlist.includes(email));
  if (notAllowed.length) {
    throw new RepartoEmailDeliveryPolicyError(
      'Todos los destinatarios de correo de reparto deben estar autorizados en isolated_test',
      'REPARTO_EMAIL_RECIPIENT_NOT_ALLOWED',
      403,
    );
  }
  return {
    effectiveRecipients: requestedRecipients,
    redirected: false,
    policy: 'isolated_test_allowlist',
  };
}

function safeToken(value, fallback) {
  const token = String(value || '').replace(/[\r\n<>@]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 48);
  return token || fallback;
}

/**
 * Stable SMTP Message-ID. It is intentionally not an exactly-once guarantee:
 * SMTP can accept a message while the connection response is lost.
 */
function buildRepartoMessageId({ kind, identity, recipient, env = process.env } = {}) {
  const domain = safeToken(env?.REPARTO_EMAIL_MESSAGE_ID_DOMAIN || env?.SMTP_MESSAGE_ID_DOMAIN, 'mari-pepa.local');
  const stableInput = [String(kind || ''), String(identity || ''), normalizeEmail(recipient)].join('|');
  const digest = crypto.createHash('sha256').update(stableInput).digest('hex').slice(0, 32);
  return `<gmp-reparto-${safeToken(kind, 'message')}-${digest}@${domain}>`;
}

function redactDeliverySummary(results) {
  const attempted = Array.isArray(results) ? results.length : 0;
  const sent = Array.isArray(results) ? results.filter((result) => result?.success).length : 0;
  return { attempted, sent, failed: Math.max(0, attempted - sent), allSucceeded: attempted > 0 && sent === attempted };
}

module.exports = {
  RepartoEmailDeliveryPolicyError,
  resolveRepartoEmailDelivery,
  buildRepartoMessageId,
  redactDeliverySummary,
};
