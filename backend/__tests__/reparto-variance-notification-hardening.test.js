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
    const query = jest.fn(async (sql) => {
      if (String(sql).includes('SELECT ID, CONFIRMATION_ID')) {
        return [{
          ID: 13,
          DOCUMENT_ID: '2026-A-1-3-C3',
          REPARTIDOR_ID: '97',
          COMERCIAL_CODE: '33',
          PAYLOAD_JSON: '{}',
        }];
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
    const pendingUpdate = query.mock.calls.find(([sql]) => String(sql).includes('SET ERROR = ?'));
    expect(pendingUpdate?.[1]).toEqual(['Digest pending: unresolved recipients (1)', 13]);
  });
});
