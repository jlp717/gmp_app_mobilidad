'use strict';

jest.mock('../../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../services/emailPdfService', () => ({
  sendHtmlEmail: jest.fn(),
  escapeHtml: (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;'),
}));
jest.mock('../../services/redis-cache', () => ({ getRedisClient: jest.fn(() => null) }));

const {
  SalesDiscrepancyAlertService,
  claimKeys,
} = require('../../services/sales-discrepancy-alert-service');

class FakeRedis {
  constructor() {
    this.values = new Map();
    this.renewals = 0;
    this.releases = 0;
    this.failComplete = false;
  }

  async eval(script, { keys, arguments: args }) {
    if (script.includes('EXISTS')) {
      if (this.values.has(keys[1])) return 'sent';
      if (this.values.has(keys[0])) return 'busy';
      this.values.set(keys[0], args[0]);
      return 'claimed';
    }
    if (script.includes('PEXPIRE')) {
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.renewals += 1;
      return 1;
    }
    if (script.includes('ARGV[3]')) {
      if (this.failComplete) throw new Error('redis completion unavailable');
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.values.set(keys[1], args[1]);
      this.values.delete(keys[0]);
      return 1;
    }
    if (script.includes('DEL')) {
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.releases += 1;
      this.values.delete(keys[0]);
      return 1;
    }
    throw new Error('unknown script');
  }
}

const AS_OF = new Date('2026-09-29T12:00:00.000Z');
const PAYLOAD = {
  todaySalesGross: 48928.95,
  todaySales: 48928.95,
  todaySalesFiltered: 48928.95,
  todayDocumentsGross: 326,
  todayContractDate: '2026-09-29',
};
const PROD = {
  NODE_ENV: 'production',
  REPARTO_ENVIRONMENT: 'production',
  REPARTO_TABLE_SET: 'production',
};

function makeService({ expected = 57442.76, documents = 346, redis = new FakeRedis(), sender, env = PROD, leaseMs } = {}) {
  const dashboardService = {
    getTodayGrossAudit: jest.fn(async () => ({ date: '2026-09-29', sales: expected, documents })),
  };
  const emailSender = sender || jest.fn(async ({ messageId }) => ({ success: true, messageId }));
  return {
    redis,
    dashboardService,
    emailSender,
    service: new SalesDiscrepancyAlertService({
      dashboardService,
      redisClientProvider: () => redis,
      emailSender,
      env,
      leaseMs,
    }),
  };
}

describe('SalesDiscrepancyAlertService', () => {
  test('does not alert when the card matches commercial sales and the route sheet is higher', async () => {
    const ctx = makeService({ expected: 48928.95, documents: 326 });
    const result = await ctx.service.audit({
      scope: 'ALL',
      asOf: AS_OF,
      payload: {
        ...PAYLOAD,
        todaySales: 48928.95,
        todaySalesGross: 57442.76,
        todayDocumentsGross: 346,
      },
    });
    expect(result).toEqual({ status: 'matched' });
    expect(ctx.emailSender).not.toHaveBeenCalled();
  });

  test('alerts when the card still shows the unfiltered route sheet', async () => {
    const ctx = makeService({ expected: 48928.95, documents: 326 });
    const result = await ctx.service.audit({
      scope: 'ALL',
      asOf: AS_OF,
      payload: {
        ...PAYLOAD,
        todaySales: 57442.76,
        todaySalesGross: 57442.76,
        todayDocumentsGross: 346,
      },
    });
    expect(result).toEqual({ status: 'sent', redirected: false });
    const mail = ctx.emailSender.mock.calls[0][0];
    expect(mail.to).toBe('javier.lacal.peregrina@gmail.com');
    expect(mail.textBody).toContain('Campo todaySales');
    expect(mail.textBody).toContain('getTodayGrossAudit');
  });

  test('skips commercial scope before DB2', async () => {
    const ctx = makeService();
    await expect(ctx.service.audit({ scope: '18', payload: PAYLOAD, asOf: AS_OF })).resolves.toEqual({
      status: 'skipped', reason: 'ineligible_scope',
    });
    expect(ctx.dashboardService.getTodayGrossAudit).not.toHaveBeenCalled();
  });

  test.each([
    ['missing gross', { ...PAYLOAD, todaySalesGross: undefined }],
    ['invalid gross', { ...PAYLOAD, todaySalesGross: Number.NaN }],
    ['missing documents', { ...PAYLOAD, todayDocumentsGross: undefined }],
    ['negative documents', { ...PAYLOAD, todayDocumentsGross: -1 }],
    ['non-integer documents', { ...PAYLOAD, todayDocumentsGross: 2.5 }],
  ])('alerts with legacy visible amount for %s', async (_label, payload) => {
    const ctx = makeService();
    await expect(ctx.service.audit({ scope: 'ALL', payload, asOf: AS_OF }))
      .resolves.toMatchObject({ status: 'sent' });
    expect(ctx.dashboardService.getTodayGrossAudit).toHaveBeenCalledWith('ALL', AS_OF);
    expect(ctx.emailSender).toHaveBeenCalledTimes(1);
    expect(ctx.emailSender.mock.calls[0][0].textBody).toContain(
      'Sale en la aplicación: 48.928,95',
    );
    expect(ctx.emailSender.mock.calls[0][0].textBody).toContain('Selector aplicado: venta comercial');
  });

  test('missing payload date still audits using expected DB2 date and valid gross selector', async () => {
    const ctx = makeService();
    await expect(ctx.service.audit({
      scope: 'ALL',
      payload: { ...PAYLOAD, todayContractDate: undefined },
      asOf: AS_OF,
    })).resolves.toMatchObject({ status: 'sent' });
    expect(ctx.emailSender.mock.calls[0][0].textBody).toContain('Fecha Europe/Madrid: 2026-09-29');
    expect(ctx.emailSender.mock.calls[0][0].textBody).toContain('Selector aplicado: venta comercial');
  });

  test.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 'not-a-number', '0x10'])
    ('invalid legacy fallback %p becomes zero and alerts', async (todaySales) => {
      const ctx = makeService();
      const payload = {
        ...PAYLOAD,
        todaySalesGross: undefined,
        todayDocumentsGross: undefined,
        todaySales,
      };
      await expect(ctx.service.audit({ scope: 'ALL', payload, asOf: AS_OF }))
        .resolves.toMatchObject({ status: 'sent' });
      expect(ctx.emailSender.mock.calls[0][0].textBody).toContain('Sale en la aplicación: 0,00');
    });

  test('decimal string legacy fallback matches Flutter double.tryParse semantics', async () => {
    const ctx = makeService();
    const payload = {
      ...PAYLOAD,
      todaySalesGross: undefined,
      todayDocumentsGross: undefined,
      todaySales: '48928.95',
    };
    await expect(ctx.service.audit({ scope: 'ALL', payload, asOf: AS_OF }))
      .resolves.toMatchObject({ status: 'sent' });
    expect(ctx.emailSender.mock.calls[0][0].textBody).toContain(
      'Sale en la aplicación: 48.928,95',
    );
  });

  test('null payload falls back to zero without reading diagnostic fields unsafely', async () => {
    const ctx = makeService();
    await expect(ctx.service.audit({ scope: 'ALL', payload: null, asOf: AS_OF }))
      .resolves.toMatchObject({ status: 'sent' });
    expect(ctx.emailSender.mock.calls[0][0].textBody).toContain('Sale en la aplicación: 0,00');
  });

  test('sends expected, visible, signed gap and legacy diagnostic with stable Message-ID', async () => {
    const ctx = makeService();
    await expect(ctx.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF }))
      .resolves.toEqual({ status: 'sent', redirected: false });
    const mail = ctx.emailSender.mock.calls[0][0];
    expect(mail.to).toBe('javier.lacal.peregrina@gmail.com');
    expect(mail.textBody).toContain('Debería salir realmente: 57.442,76');
    expect(mail.textBody).toContain('Sale en la aplicación: 48.928,95');
    expect(mail.textBody).toContain('Diferencia (esperado - aplicación): 8513,81');
    expect(mail.textBody).toContain('Campo todaySales (venta comercial del día en la app): 48.928,95');
    expect(mail.textBody).toContain('getTodayGrossAudit');
    expect(mail.messageId).toMatch(/^<gmp-reparto-sales-discrepancy-/);
  });

  test('redirects isolated_test to localhost even when product recipient is allowlisted', async () => {
    const ctx = makeService({
      env: {
        NODE_ENV: 'production',
        REPARTO_ENVIRONMENT: 'staging',
        REPARTO_TABLE_SET: 'isolated_test',
        REPARTO_EMAIL_TEST_ALLOWLIST: 'javier.lacal.peregrina@gmail.com',
      },
    });
    await ctx.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF });
    expect(ctx.emailSender.mock.calls[0][0].to).toBe('reparto-test@localhost');
  });

  test('does not send without a distributed Redis claim', async () => {
    const ctx = makeService({ redis: null });
    await expect(ctx.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF }))
      .resolves.toEqual({ status: 'skipped', reason: 'claim_unavailable' });
    expect(ctx.emailSender).not.toHaveBeenCalled();
  });

  test('deduplicates concurrent workers', async () => {
    const redis = new FakeRedis();
    let resolveMail;
    const sender = jest.fn(() => new Promise((resolve) => { resolveMail = resolve; }));
    const first = makeService({ redis, sender });
    const second = makeService({ redis, sender });
    const one = first.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF });
    await Promise.resolve();
    await Promise.resolve();
    const two = await second.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF });
    expect(two).toEqual({ status: 'skipped', reason: 'claim_unavailable' });
    expect(sender).toHaveBeenCalledTimes(1);
    resolveMail({ success: true, messageId: 'accepted' });
    await expect(one).resolves.toMatchObject({ status: 'sent' });
  });

  test('explicit SMTP failure releases claim for retry and keeps Message-ID stable', async () => {
    const redis = new FakeRedis();
    const ids = [];
    const sender = jest.fn(async ({ messageId }) => {
      ids.push(messageId);
      if (ids.length === 1) return { success: false };
      return { success: true, messageId };
    });
    const ctx = makeService({ redis, sender });
    await expect(ctx.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF }))
      .resolves.toMatchObject({ status: 'failed' });
    await expect(ctx.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF }))
      .resolves.toMatchObject({ status: 'sent' });
    expect(ids[0]).toBe(ids[1]);
  });

  test('ambiguous SMTP timeout retains lease instead of immediately retrying', async () => {
    const error = new Error('Timeout conectando al servidor de correo');
    error.code = 'ETIMEDOUT';
    const ctx = makeService({ sender: jest.fn(async () => { throw error; }) });
    await expect(ctx.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF }))
      .resolves.toMatchObject({ status: 'ambiguous' });
    expect(ctx.redis.values.has(claimKeys('2026-09-29', 'ALL').claim)).toBe(true);
  });

  test('Redis completion failure after SMTP success is ambiguous and retains the owned lease', async () => {
    const redis = new FakeRedis();
    redis.failComplete = true;
    const sender = jest.fn(async ({ messageId }) => ({ success: true, messageId }));
    const first = makeService({ redis, sender });
    const second = makeService({ redis, sender });

    await expect(first.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF }))
      .resolves.toEqual({
        status: 'ambiguous',
        reason: 'success_marker_unconfirmed',
      });
    expect(redis.values.has(claimKeys('2026-09-29', 'ALL').claim)).toBe(true);

    await expect(second.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF }))
      .resolves.toEqual({ status: 'skipped', reason: 'claim_unavailable' });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(redis.releases).toBe(0);
    expect(redis.values.has(claimKeys('2026-09-29', 'ALL').claim)).toBe(true);
  });

  test('renews token-owned lease while SMTP remains in flight', async () => {
    let resolveMail;
    const sender = jest.fn(() => new Promise((resolve) => { resolveMail = resolve; }));
    const ctx = makeService({ sender, leaseMs: 30 });
    const pending = ctx.service.audit({ scope: 'ALL', payload: PAYLOAD, asOf: AS_OF });
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(ctx.redis.renewals).toBeGreaterThan(0);
    resolveMail({ success: true });
    await pending;
  });

  test('stale token cannot release a newer worker claim', async () => {
    const ctx = makeService();
    const key = claimKeys('2026-09-29', 'ALL').claim;
    ctx.redis.values.set(key, 'new-owner');
    await expect(ctx.service._release(ctx.redis, key, 'stale-owner')).resolves.toBe(false);
    expect(ctx.redis.values.get(key)).toBe('new-owner');
  });
});
