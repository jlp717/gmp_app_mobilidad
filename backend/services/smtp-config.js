'use strict';

const net = require('net');

const TLS_MIN_VERSION = 'TLSv1.2';

// Verified 2026-09-02 from gmp-online via openssl s_client:
// CN/SAN = mn05-02.dnspropio.com only. Let's Encrypt, TLSv1.2+, ports 465 and 587 open.
// mail.mari-pepa.com resolves to Cloudflare (188.114.96.5 / 188.114.97.5) with
// SMTP ports closed, and that name is not in the certificate.
const CERTIFIED_SMTP_IDENTITY = 'mn05-02.dnspropio.com';
const NON_SMTP_FRONTENDS = new Set(['mail.mari-pepa.com']);

function firstConfigured(names, fallback = '') {
  for (const name of names || []) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return fallback;
}

function configuredNumber(names, fallback) {
  const value = firstConfigured(names);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function isValidServerName(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) {
    return false;
  }

  if (net.isIP(value) !== 0) return true;
  if (value.endsWith('.') || value.includes('..')) return false;

  return value.split('.').every((label) =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

function isNonSmtpFrontend(value) {
  return NON_SMTP_FRONTENDS.has(String(value || '').trim().toLowerCase());
}

function resolveSmtpHost(configuredHost) {
  const host = String(configuredHost || '').trim();
  if (!host || isNonSmtpFrontend(host)) {
    return CERTIFIED_SMTP_IDENTITY;
  }
  return host;
}

function resolveTlsServername(explicitServername, host) {
  const explicit = String(explicitServername || '').trim();
  if (explicit) {
    return isNonSmtpFrontend(explicit) ? CERTIFIED_SMTP_IDENTITY : explicit;
  }
  if (String(host || '').toLowerCase() === CERTIFIED_SMTP_IDENTITY) {
    return CERTIFIED_SMTP_IDENTITY;
  }
  // Production must name the certificate identity explicitly when the
  // connection host is not the verified mail server.
  if (process.env.NODE_ENV === 'production') {
    return '';
  }
  return host;
}

function buildSmtpConfig(options = {}) {
  const configuredHost = firstConfigured(
    options.hostEnv || ['SMTP_HOST'],
    options.defaultHost || '',
  );
  const host = resolveSmtpHost(configuredHost);
  const port = configuredNumber(options.portEnv || ['SMTP_PORT'], options.defaultPort || 465);
  const user = firstConfigured(options.userEnv || ['SMTP_USER']);
  const password = firstConfigured(
    options.passwordEnv || ['SMTP_PASSWORD', 'SMTP_PASS'],
  );
  const explicitServername = firstConfigured(
    options.tlsServernameEnv || ['SMTP_TLS_SERVERNAME'],
    options.tlsServernameDefault || '',
  );
  const servername = resolveTlsServername(explicitServername, host);
  const secure = port === 465;

  return {
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass: password },
    connectionTimeout: options.connectionTimeout,
    greetingTimeout: options.greetingTimeout,
    socketTimeout: options.socketTimeout,
    tls: {
      servername,
      minVersion: TLS_MIN_VERSION,
      rejectUnauthorized: true,
    },
  };
}

function assertSecureSmtpConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('SMTP configuration is required');
  }
  if (!config.host || !isValidServerName(config.host)) {
    throw new Error('SMTP_HOST must be a valid DNS name or IP address');
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port');
  }
  if (!config.tls || config.tls.rejectUnauthorized !== true) {
    throw new Error('SMTP TLS certificate verification must remain enabled');
  }
  if (config.tls.minVersion !== TLS_MIN_VERSION) {
    throw new Error(`SMTP TLS must use ${TLS_MIN_VERSION} or newer`);
  }
  if (!isValidServerName(config.tls.servername)) {
    throw new Error('SMTP_TLS_SERVERNAME must match a valid certificate identity');
  }
  if (isNonSmtpFrontend(config.host) || isNonSmtpFrontend(config.tls.servername)) {
    throw new Error('SMTP endpoint must be the certified mail server, not a web frontend');
  }
  if (config.port === 465 && config.secure !== true) {
    throw new Error('SMTP port 465 requires implicit TLS');
  }
  if (config.port !== 465 && (config.secure === true || config.requireTLS !== true)) {
    throw new Error('SMTP submission ports require STARTTLS');
  }
  if (!config.auth || !config.auth.user || !config.auth.pass) {
    throw new Error('SMTP credentials are required');
  }

  return config;
}

module.exports = {
  TLS_MIN_VERSION,
  CERTIFIED_SMTP_IDENTITY,
  NON_SMTP_FRONTENDS,
  buildSmtpConfig,
  assertSecureSmtpConfig,
  isValidServerName,
  resolveSmtpHost,
  resolveTlsServername,
};
