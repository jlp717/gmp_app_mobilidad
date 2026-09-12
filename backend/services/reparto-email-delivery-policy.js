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

const ISOLATED_TEST_DEFAULT_EMAIL = 'reparto-test@localhost';

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  if (/^[^\s@]+@localhost$/.test(email)) return email;
  return '';
}

function uniqueEmails(values) {
  return [...new Set((values || []).map(normalizeEmail).filter(Boolean))];
}

function isIsolatedTest(env) {
  return String(env?.REPARTO_TABLE_SET || '').trim().toLowerCase() === 'isolated_test';
}

function isolatedTestDefaultEmails() {
  return uniqueEmails([ISOLATED_TEST_DEFAULT_EMAIL]);
}

function testAllowlist(env) {
  const configured = uniqueEmails(String(env?.REPARTO_EMAIL_TEST_ALLOWLIST || '').split(','));
  if (isIsolatedTest(env)) {
    return uniqueEmails([...configured, ...isolatedTestDefaultEmails()]);
  }
  return configured;
}

function testSink(env) {
  const configured = normalizeEmail(env?.REPARTO_EMAIL_TEST_SINK);
  if (configured) return configured;
  return isIsolatedTest(env) ? ISOLATED_TEST_DEFAULT_EMAIL : '';
}

function shouldSkipSmtpForIsolatedTest(email, env = process.env) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isIsolatedTest(env)) return false;
  return normalized.endsWith('.test')
    || normalized.endsWith('@localhost')
    || normalized.endsWith('.localhost');
}

/**
 * Resolves effective SMTP recipients. isolated_test always requires an explicit
 * allowlist/sink. This is deliberately fail-closed so a missing PM2 flag cannot
 * turn a test run into an external production mail delivery.
 */
function deliveryResult({
  intendedRecipients,
  effectiveRecipients,
  redirected,
  policy,
}) {
  const result = {
    intendedRecipients,
    effectiveRecipients,
    redirected,
    policy,
  };
  try {
    // eslint-disable-next-line global-require
    const logger = require('../middleware/logger');
    logger.info(
      `[reparto-email] intended=${(intendedRecipients || []).join(',')} smtp=${(effectiveRecipients || []).join(',')} policy=${policy} redirected=${Boolean(redirected)}`,
    );
  } catch (_error) {
    // logging must never break mail resolution
  }
  return result;
}

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
    return deliveryResult({
      intendedRecipients: requestedRecipients,
      effectiveRecipients: requestedRecipients,
      redirected: false,
      policy: 'direct',
    });
  }
  const allowlist = testAllowlist(env);
  const sink = testSink(env);
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
    return deliveryResult({
      intendedRecipients: [],
      effectiveRecipients: [sink],
      redirected: false,
      policy: 'isolated_test_empty_recipient_fallback',
    });
  }

  const notAllowed = requestedRecipients.filter((email) => !allowlist.includes(email));
  if (mode === 'manual' && notAllowed.length) {
    throw new RepartoEmailDeliveryPolicyError(
      'Todos los destinatarios de correo de reparto deben estar autorizados en isolated_test',
      'REPARTO_EMAIL_RECIPIENT_NOT_ALLOWED',
      403,
    );
  }
  if (!notAllowed.length) {
    return deliveryResult({
      intendedRecipients: requestedRecipients,
      effectiveRecipients: requestedRecipients,
      redirected: false,
      policy: 'isolated_test_allowlist',
    });
  }
  // Automatic isolated_test: never SMTP to product mailboxes. Keep the
  // intended to/cc list for JSON/logs and deliver only to the local sink.
  if (!sink || !allowlist.includes(sink)) {
    throw new RepartoEmailDeliveryPolicyError(
      'El fallback técnico de correo en isolated_test requiere sink incluido en allowlist',
      'REPARTO_EMAIL_TEST_POLICY_UNCONFIGURED',
      503,
    );
  }
  return deliveryResult({
    intendedRecipients: requestedRecipients,
    effectiveRecipients: [sink],
    redirected: true,
    policy: 'isolated_test_redirect',
  });
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

/**
 * Product to/cc list is always the real staff+destinatario set.
 * isolated_test still SMTP-redirects to the sink; it must not drop Carlos
 * from intendedTo/intendedCc.
 */
function composeProductEmailDispatch({
  destinatario,
  staffEmails,
  env = process.env,
} = {}) {
  const intendedTo = uniqueEmails([destinatario]);
  if (!intendedTo.length) {
    throw new RepartoEmailDeliveryPolicyError(
      'El destinatario de correo de reparto es obligatorio y debe ser válido',
      'REPARTO_EMAIL_RECIPIENT_REQUIRED',
      422,
    );
  }
  resolveRepartoEmailDelivery({
    recipients: intendedTo,
    env,
    mode: 'manual',
  });
  const intendedCc = uniqueEmails(staffEmails)
    .filter((email) => !intendedTo.includes(email));
  const intendedRecipients = uniqueEmails([...intendedTo, ...intendedCc]);
  const smtp = resolveRepartoEmailDelivery({
    recipients: intendedRecipients,
    env,
    mode: 'automatic',
  });
  const redirected = Boolean(smtp.redirected);
  return {
    intendedTo,
    intendedCc,
    intendedRecipients,
    smtpTo: redirected ? smtp.effectiveRecipients[0] : intendedTo[0],
    smtpCc: redirected ? [] : intendedCc,
    effectiveRecipients: smtp.effectiveRecipients,
    redirected,
    policy: smtp.policy,
  };
}

module.exports = {
  RepartoEmailDeliveryPolicyError,
  resolveRepartoEmailDelivery,
  composeProductEmailDispatch,
  buildRepartoMessageId,
  redactDeliverySummary,
  normalizeEmail,
  uniqueEmails,
  shouldSkipSmtpForIsolatedTest,
  isIsolatedTest,
  ISOLATED_TEST_DEFAULT_EMAIL,
};
