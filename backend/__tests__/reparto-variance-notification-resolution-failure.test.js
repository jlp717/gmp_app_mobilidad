'use strict';

const { sendDailyVarianceDigest } = require('../services/reparto-variance-notification-service');

const runtimeEnv = {
  NODE_ENV: 'test',
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EMAIL_TEST_ALLOWLIST: 'javier@example.test',
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

test('daily digest never sends a partial recipient set when directory resolution throws', async () => {
  const query = jest.fn(async (sql) => {
    if (String(sql).includes('SELECT ID, CONFIRMATION_ID')) {
      return [{
        ID: 14,
        DOCUMENT_ID: '2026-A-1-4-C4',
        REPARTIDOR_ID: '08',
        COMERCIAL_CODE: '33',
        PAYLOAD_JSON: '{}',
      }];
    }
    return [];
  });
  const sendEmail = jest.fn();
  const resolveRecipients = jest.fn(async ({ repartidorId, comercialCode }) => {
    if (repartidorId === '08') throw new Error('directory unavailable');
    if (comercialCode === '33') return { emails: ['comercial@example.test'], details: [], missingRequired: [] };
    return { emails: ['javier@example.test'], details: [], missingRequired: [] };
  });

  const result = await sendDailyVarianceDigest({
    query,
    env: runtimeEnv,
    sendEmail,
    resolveRecipients,
    digestDate: '2026-08-17',
  });

  expect(sendEmail).not.toHaveBeenCalled();
  expect(result).toMatchObject({ sent: 0, items: 1, unresolvedRecipients: 1 });
  const pendingUpdate = query.mock.calls.find(([sql]) => String(sql).includes('SET ERROR = ?'));
  expect(pendingUpdate?.[1]).toEqual(['Digest pending: unresolved recipients (1)', 14]);
});
