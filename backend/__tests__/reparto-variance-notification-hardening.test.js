'use strict';

const {
  notifyAfterConfirm,
  sendDailyVarianceDigest,
} = require('../services/reparto-variance-notification-service');

const runtimeEnv = {
  NODE_ENV: 'test',
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EMAIL_TEST_ALLOWLIST: 'driver@example.test,javier@example.test',
  ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  REPARTO_WRITES_ENABLED: 'false',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
  REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
  REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
  REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
  REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
};

describe('variance notifications required-recipient hardening', () => {
  test('creates an alert for NO_ENTREGADO even without ERP lines', async () => {
    const query = jest.fn(async () => []);
    const sendEmail = jest.fn(async () => ({ success: true }));

    const result = await notifyAfterConfirm({
      command: {
        delivery: { itemId: '2026-A-1-102-4300001', status: 'NO_ENTREGADO', lineas: [] },
        actor: { repartidorId: '94' },
      },
      result: { created: true, confirmationId: '80', deliveryStatus: 'NO_ENTREGADO' },
    }, {
      query,
      env: runtimeEnv,
      sendEmail,
      resolveComercial: jest.fn(async () => null),
      resolveRecipients: jest.fn(async () => ({
        emails: ['driver@example.test'],
        details: [],
        missingRequired: [],
      })),
    });

    expect(result).toMatchObject({ skipped: false, lineCount: 0, sent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('keeps the daily digest pending when a required DB recipient is unresolved', async () => {
    const store = new Map([[13, {
      ID: 13,
      DOCUMENT_ID: '2026-A-1-3-C3',
      REPARTIDOR_ID: '97',
      COMERCIAL_CODE: '33',
      PAYLOAD_JSON: '{}',
      STATUS: 'PENDING',
      DIGEST_INCLUDED: 'N',
      ERROR: null,
    }]]);
    const query = jest.fn(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('SELECT ID, CONFIRMATION_ID')) {
        return [...store.values()].map((row) => ({ ...row }));
      }
      if (text.includes('SELECT STATUS, PAYLOAD_JSON, DIGEST_INCLUDED')) {
        const row = store.get(Number(params[0]));
        return row ? [{ ...row }] : [];
      }
      if (text.includes('SELECT STATUS, PAYLOAD_JSON') && text.includes("DIGEST_INCLUDED = 'N'")) {
        const row = store.get(Number(params[0]));
        return row && row.DIGEST_INCLUDED === 'N' ? [{ ...row }] : [];
      }
      if (text.includes('SELECT STATUS, PAYLOAD_JSON')) {
        const row = store.get(Number(params[0]));
        return row ? [{ ...row }] : [];
      }
      if (text.includes("SET STATUS = 'FAILED', PAYLOAD_JSON = ?")) {
        const row = store.get(Number(params[1]));
        if (row && row.STATUS === 'PENDING' && row.DIGEST_INCLUDED === 'N') {
          row.STATUS = 'FAILED';
          row.PAYLOAD_JSON = params[0];
        }
        return [];
      }
      if (text.includes('SET PAYLOAD_JSON = ?') && text.includes('LOCATE(CAST(? AS VARCHAR(64)), PAYLOAD_JSON) = 0')) {
        const row = store.get(Number(params[1]));
        if (row && row.DIGEST_INCLUDED === 'N' && !String(row.PAYLOAD_JSON).includes(String(params[3]))) {
          row.PAYLOAD_JSON = params[0];
        }
        return [];
      }
      if (text.includes('SET STATUS = ?, DIGEST_INCLUDED = ?')) {
        const row = store.get(Number(params[4]));
        if (row && String(row.PAYLOAD_JSON).includes(String(params[5]))) {
          row.STATUS = params[0];
          row.DIGEST_INCLUDED = params[1];
          row.ERROR = params[2];
          row.PAYLOAD_JSON = params[3];
        }
        return [];
      }
      return [];
    });
    const sendEmail = jest.fn();

    const result = await sendDailyVarianceDigest({
      query,
      env: runtimeEnv,
      sendEmail,
      resolveRecipients: jest.fn(async ({ repartidorId }) => (
        repartidorId === '97'
          ? {
            emails: [],
            details: [{ label: 'repartidor', email: null }],
            missingRequired: ['repartidor'],
          }
          : { emails: ['javier@example.test'], details: [], missingRequired: [] }
      )),
      digestDate: '2026-08-17',
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, items: 1, unresolvedRecipients: 1 });
    const pendingUpdate = query.mock.calls.find(([sql]) => String(sql).includes('SET STATUS = ?, DIGEST_INCLUDED = ?'));
    expect(pendingUpdate?.[1]?.[2]).toBe('Digest pending: unresolved recipients (1)');
    expect(pendingUpdate?.[1]?.[4]).toBe(13);
    expect(pendingUpdate?.[1]?.[1]).toBe('N');
  });
});
