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
  const store = new Map([[14, {
    ID: 14,
    DOCUMENT_ID: '2026-A-1-4-C4',
    REPARTIDOR_ID: '08',
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
  const pendingUpdate = query.mock.calls.find(([sql]) => String(sql).includes('SET STATUS = ?, DIGEST_INCLUDED = ?'));
  expect(pendingUpdate?.[1]?.[2]).toBe('Digest pending: unresolved recipients (1)');
  expect(pendingUpdate?.[1]?.[4]).toBe(14);
  expect(pendingUpdate?.[1]?.[1]).toBe('N');
});
