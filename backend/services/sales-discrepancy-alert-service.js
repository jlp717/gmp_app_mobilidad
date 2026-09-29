'use strict';

const crypto = require('crypto');
const logger = require('../middleware/logger');
const { sendHtmlEmail, escapeHtml } = require('./emailPdfService');
const { getRedisClient } = require('./redis-cache');
const {
  buildRepartoMessageId,
  resolveSalesAlertEmailDelivery,
} = require('./reparto-email-delivery-policy');

const PRODUCT_RECIPIENT = 'javier.lacal.pelegrin@gmail.com';
const CLAIM_LEASE_MS = 120000;
const SUCCESS_TTL_SECONDS = 30 * 24 * 60 * 60;

const CLAIM_SCRIPT = [
  'if redis.call("EXISTS", KEYS[2]) == 1 then return "sent" end',
  'local claimed = redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2])',
  'if claimed then return "claimed" end',
  'return "busy"',
].join('\n');

const RENEW_SCRIPT = [
  'if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end',
  'return redis.call("PEXPIRE", KEYS[1], ARGV[2])',
].join('\n');

const RELEASE_SCRIPT = [
  'if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end',
  'return redis.call("DEL", KEYS[1])',
].join('\n');

const COMPLETE_SCRIPT = [
  'if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end',
  'redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])',
  'redis.call("DEL", KEYS[1])',
  'return 1',
].join('\n');

function cents(value) {
  return Math.round(Number(value) * 100);
}

function finiteLegacyAmount(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value !== 'string' || !value.trim()) return 0;
  const normalized = value.trim();
  const decimalPattern = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
  if (!decimalPattern.test(normalized)) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectVisibleTodaySales(payload) {
  const gross = payload?.todaySalesGross;
  const documents = payload?.todayDocumentsGross;
  const grossContractValid = Number.isFinite(gross)
    && Number.isInteger(documents)
    && documents >= 0;
  return {
    amount: grossContractValid ? Number(gross) : finiteLegacyAmount(payload?.todaySales),
    source: grossContractValid ? 'gross' : 'legacy',
  };
}

function safeKeyPart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32);
}

function claimKeys(date, scope) {
  const identity = `${safeKeyPart(date)}:${safeKeyPart(scope)}`;
  return {
    claim: `gmp:sales-discrepancy-alert:claim:${identity}`,
    sent: `gmp:sales-discrepancy-alert:sent:${identity}`,
  };
}

function isAmbiguousSmtpError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'TIMEOUT'].includes(code)
    || /timeout|timed out|connection reset|respuesta.*perdid/.test(message);
}

function formatEuro(value) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
}

class SalesDiscrepancyAlertService {
  constructor({
    dashboardService,
    redisClientProvider = getRedisClient,
    emailSender = sendHtmlEmail,
    env = process.env,
    leaseMs = CLAIM_LEASE_MS,
    successTtlSeconds = SUCCESS_TTL_SECONDS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = {}) {
    this.dashboardService = dashboardService;
    this.redisClientProvider = redisClientProvider;
    this.emailSender = emailSender;
    this.env = env;
    this.leaseMs = leaseMs;
    this.successTtlSeconds = successTtlSeconds;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
  }

  _eval(client, script, keys, args) {
    if (!client || typeof client.eval !== 'function') return Promise.resolve(null);
    return client.eval(script, { keys, arguments: args.map(String) });
  }

  _claim(client, keys, token) {
    return this._eval(client, CLAIM_SCRIPT, [keys.claim, keys.sent], [token, this.leaseMs]);
  }

  async _renew(client, key, token) {
    return Number(await this._eval(client, RENEW_SCRIPT, [key], [token, this.leaseMs])) === 1;
  }

  async _release(client, key, token) {
    return Number(await this._eval(client, RELEASE_SCRIPT, [key], [token])) === 1;
  }

  async _complete(client, keys, token, messageId) {
    return Number(await this._eval(
      client,
      COMPLETE_SCRIPT,
      [keys.claim, keys.sent],
      [token, messageId, this.successTtlSeconds],
    )) === 1;
  }

  async audit({ scope, payload, asOf }) {
    if (String(scope || '').trim().toUpperCase() !== 'ALL') {
      return { status: 'skipped', reason: 'ineligible_scope' };
    }

    const visible = selectVisibleTodaySales(payload);

    let expected;
    try {
      expected = await this.dashboardService.getTodayGrossAudit('ALL', asOf);
    } catch {
      logger.error('[sales-alert] audit source unavailable', { code: 'SALES_ALERT_DB2_READ_FAILED' });
      return { status: 'failed', reason: 'audit_source_unavailable' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expected.date || ''))
      || !Number.isFinite(expected.sales)
      || !Number.isInteger(expected.documents)
      || expected.documents < 0) {
      logger.error('[sales-alert] invalid audit result', { code: 'SALES_ALERT_AUDIT_RESULT_INVALID' });
      return { status: 'failed', reason: 'invalid_audit_result' };
    }

    const expectedCents = cents(expected.sales);
    const visibleCents = cents(visible.amount);
    if (expectedCents === visibleCents) return { status: 'matched' };

    let delivery;
    try {
      delivery = resolveSalesAlertEmailDelivery({ recipient: PRODUCT_RECIPIENT, env: this.env });
    } catch {
      logger.error('[sales-alert] delivery policy rejected', { code: 'SALES_ALERT_DELIVERY_POLICY_REJECTED' });
      return { status: 'failed', reason: 'unsafe_delivery_policy' };
    }

    const keys = claimKeys(expected.date, 'ALL');
    const token = crypto.randomBytes(24).toString('hex');
    let client;
    let claim;
    try {
      client = typeof this.redisClientProvider === 'function' ? this.redisClientProvider() : null;
      claim = await this._claim(client, keys, token);
    } catch {
      logger.error('[sales-alert] redis claim failed', { code: 'SALES_ALERT_REDIS_CLAIM_FAILED' });
      return { status: 'failed', reason: 'claim_unavailable' };
    }
    if (claim !== 'claimed') {
      return { status: 'skipped', reason: claim === 'sent' ? 'already_sent' : 'claim_unavailable' };
    }

    const messageId = buildRepartoMessageId({
      kind: 'sales-discrepancy',
      identity: `${expected.date}:ALL`,
      recipient: PRODUCT_RECIPIENT,
      env: this.env,
    });
    const gap = (expectedCents - visibleCents) / 100;
    const legacy = Number.isFinite(payload?.todaySalesFiltered)
      ? `\nValor filtrado legacy (diagnóstico): ${formatEuro(payload.todaySalesFiltered)}`
      : '';
    const textBody = [
      `Fecha Europe/Madrid: ${expected.date}`,
      'Ámbito: ALL',
      `Debería salir realmente: ${formatEuro(expected.sales)}`,
      `Sale en la aplicación: ${formatEuro(visible.amount)}`,
      `Selector aplicado: ${visible.source === 'gross' ? 'bruto contractual' : 'fallback legacy'}`,
      `Diferencia (esperado - aplicación): ${formatEuro(gap)}`,
      legacy.trim(),
    ].filter(Boolean).join('\n');
    const htmlBody = `<p><strong>Discrepancia en Ventas hoy</strong></p><pre>${escapeHtml(textBody)}</pre>`;

    const renewal = this.setIntervalFn(() => {
      this._renew(client, keys.claim, token).catch(() => {
        logger.warn('[sales-alert] redis lease renewal failed', { code: 'SALES_ALERT_RENEW_FAILED' });
      });
    }, Math.max(10, Math.floor(this.leaseMs / 3)));
    if (typeof renewal?.unref === 'function') renewal.unref();

    let smtpAccepted = false;
    try {
      const result = await this.emailSender({
        to: delivery.effectiveRecipient,
        subject: `Discrepancia Ventas hoy ${expected.date}`,
        htmlBody,
        textBody,
        messageId,
      });
      if (!result?.success) {
        const error = new Error('SMTP_REJECTED');
        error.code = 'SMTP_REJECTED';
        throw error;
      }
      smtpAccepted = true;
      const completed = await this._complete(client, keys, token, messageId);
      if (!completed) {
        logger.warn('[sales-alert] success marker not written', { code: 'SALES_ALERT_COMPLETE_NOT_OWNED' });
        return { status: 'ambiguous', reason: 'success_marker_unconfirmed' };
      }
      return { status: 'sent', redirected: delivery.redirected };
    } catch (error) {
      const ambiguous = smtpAccepted || isAmbiguousSmtpError(error);
      if (!ambiguous) {
        await this._release(client, keys.claim, token).catch(() => false);
      }
      logger.error('[sales-alert] email delivery failed', {
        code: smtpAccepted
          ? 'SALES_ALERT_REDIS_COMMIT_AMBIGUOUS'
          : (ambiguous ? 'SALES_ALERT_SMTP_AMBIGUOUS' : 'SALES_ALERT_SMTP_REJECTED'),
      });
      return {
        status: ambiguous ? 'ambiguous' : 'failed',
        reason: smtpAccepted ? 'success_marker_unconfirmed' : 'smtp_failed',
      };
    } finally {
      this.clearIntervalFn(renewal);
    }
  }
}

module.exports = {
  SalesDiscrepancyAlertService,
  PRODUCT_RECIPIENT,
  CLAIM_LEASE_MS,
  SUCCESS_TTL_SECONDS,
  selectVisibleTodaySales,
  isAmbiguousSmtpError,
  claimKeys,
};
