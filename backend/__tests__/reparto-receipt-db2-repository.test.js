'use strict';
const { createRepartoReceiptDb2Repository, RepartoReceiptUnavailableError, REQUIRED } = require('../repositories/reparto-receipt-db2-repository');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
function runtime() { return resolveRepartoRuntime({ NODE_ENV: 'test', REPARTO_ENVIRONMENT: 'test', REPARTO_TABLE_SET: 'isolated_test', ODBC_DSN: 'GMP', REPARTIDOR_FINANCE_READ_SCHEMA: 'JAVIER', REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER', REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER', REPARTO_WRITES_ENABLED: 'true', REPARTO_PRODUCTION_WRITES_APPROVED: 'false', REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false', REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'true', REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true', REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24' }); }
test('rejects an evil confirmation mapping before opening a connection', () => { const safe = runtime(); const evil = { ...safe, tables: { ...safe.tables, confirmation: { ...safe.tables.confirmation, confirmations: 'JAVIER.EVIL' } } }; expect(() => createRepartoReceiptDb2Repository({ runtime: evil, connectionFactory: jest.fn() })).toThrow(RepartoReceiptUnavailableError); });
test('rejects nonnumeric confirmation id before any data or catalogue query', async () => { const factory = jest.fn(); const repository = createRepartoReceiptDb2Repository({ runtime: runtime(), connectionFactory: factory }); await expect(repository.getReceipt('abc')).rejects.toMatchObject({ statusCode: 422 }); expect(factory).not.toHaveBeenCalled(); });

function receiptConnection(confirmation) {
  const resolved = runtime();
  const refs = {
    confirmation: resolved.tables.confirmation.confirmations,
    lines: resolved.tables.confirmation.lines,
    evidences: resolved.tables.confirmation.evidences,
    confirmationEvidences: resolved.tables.confirmation.confirmationEvidences,
    cobros: resolved.tables.finance.cobros,
  };
  const calls = [];
  const execute = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('QSYS2.SYSTABLES')) {
      return Object.values(refs).map((identifier) => {
        const [TABLE_SCHEMA, TABLE_NAME] = identifier.split('.');
        return { TABLE_SCHEMA, TABLE_NAME };
      });
    }
    if (sql.includes('QSYS2.SYSCOLUMNS')) {
      return Object.entries(REQUIRED).flatMap(([key, columns]) => {
        const [TABLE_SCHEMA, TABLE_NAME] = refs[key].split('.');
        return columns.map((COLUMN_NAME) => ({ TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME }));
      });
    }
    if (sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES')) return [confirmation];
    if (sql.includes('FROM JAVIER.TEST_REPARTO_LINEAS')) return [{ LINEA_ID: '1' }];
    if (sql.includes('TEST_REPARTO_CONFIRM_EVIDENCIAS')) return [];
    if (sql.includes('FROM JAVIER.TEST_REPARTIDOR_COBROS')) return [];
    return [];
  });
  return { connection: { execute, close: jest.fn().mockResolvedValue(undefined) }, calls };
}

test('looks up by idempotency key and supports a wholly unpaid confirmation', async () => {
  const fake = receiptConnection({
    ID: 7,
    IDEMPOTENCY_KEY: 'idem-receipt-7',
    CLIENTE_CODIGO: 'C1',
    REPARTIDOR_ID: 'R1',
    DOCUMENTO_TIPO: null,
    DOCUMENTO_ORIGEN: null,
    DOCUMENTO_SUBEMPRESA: null,
    DOCUMENTO_EJERCICIO: null,
    DOCUMENTO_SERIE: null,
    DOCUMENTO_TERMINAL: null,
    DOCUMENTO_NUMERO: null,
    DOCUMENTO_XDE: null,
    DOCUMENTO_DEX: null,
  });
  const repository = createRepartoReceiptDb2Repository({
    runtime: runtime(), connectionFactory: jest.fn().mockResolvedValue(fake.connection),
  });
  await expect(repository.getReceipt({ idempotencyKey: 'idem-receipt-7', allowAnyOwner: true }))
    .resolves.toMatchObject({ payments: [] });
  const lookup = fake.calls.find((call) => call.sql.includes('WHERE IDEMPOTENCY_KEY = ?'));
  expect(lookup.params).toEqual(['idem-receipt-7']);
  expect(fake.calls.some((call) => call.sql.includes('FROM JAVIER.TEST_REPARTIDOR_COBROS'))).toBe(false);
});

test('fails closed for a partial financial identity and for an aborted lookup', async () => {
  const partial = receiptConnection({
    ID: 7, IDEMPOTENCY_KEY: 'idem-receipt-7', CLIENTE_CODIGO: 'C1', REPARTIDOR_ID: 'R1',
    DOCUMENTO_TIPO: 'CAC', DOCUMENTO_ORIGEN: null, DOCUMENTO_SUBEMPRESA: null,
    DOCUMENTO_EJERCICIO: null, DOCUMENTO_SERIE: null, DOCUMENTO_TERMINAL: null,
    DOCUMENTO_NUMERO: null, DOCUMENTO_XDE: null, DOCUMENTO_DEX: null,
  });
  const repository = createRepartoReceiptDb2Repository({
    runtime: runtime(), connectionFactory: jest.fn().mockResolvedValue(partial.connection),
  });
  await expect(repository.getReceipt({ confirmationId: '7', allowAnyOwner: true }))
    .rejects.toMatchObject({ code: 'REPARTO_RECEIPT_UNAVAILABLE', statusCode: 503 });
  const controller = new AbortController();
  controller.abort();
  const factory = jest.fn();
  const aborted = createRepartoReceiptDb2Repository({ runtime: runtime(), connectionFactory: factory });
  await expect(aborted.getReceipt({ confirmationId: '7', allowAnyOwner: true, signal: controller.signal }))
    .rejects.toMatchObject({ code: 'REPARTO_RECEIPT_TIMEOUT', statusCode: 504 });
  expect(factory).not.toHaveBeenCalled();
});

test('authorizes the confirmation owner before reading lines, evidence metadata or payments', async () => {
  const fake = receiptConnection({
    ID: 7, IDEMPOTENCY_KEY: 'idem-receipt-7', CLIENTE_CODIGO: 'C1', REPARTIDOR_ID: 'R1',
  });
  const repository = createRepartoReceiptDb2Repository({
    runtime: runtime(), connectionFactory: jest.fn().mockResolvedValue(fake.connection),
  });

  await expect(repository.getReceipt({ confirmationId: '7', ownerRepartidorId: 'R2' }))
    .rejects.toMatchObject({ code: 'REPARTO_RECEIPT_OWNERSHIP_REQUIRED', statusCode: 403 });
  expect(fake.calls.some((call) => call.sql.includes('FROM JAVIER.TEST_REPARTO_LINEAS'))).toBe(false);
  expect(fake.calls.some((call) => call.sql.includes('TEST_REPARTO_CONFIRM_EVIDENCIAS'))).toBe(false);
  expect(fake.calls.some((call) => call.sql.includes('FROM JAVIER.TEST_REPARTIDOR_COBROS'))).toBe(false);
  const confirmationReads = fake.calls.filter((call) => call.sql.includes('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES'));
  expect(confirmationReads).toHaveLength(1);
  expect(confirmationReads[0].sql).toMatch(/^SELECT ID, REPARTIDOR_ID /);
  expect(confirmationReads[0].sql).not.toMatch(/CLIENTE|RECEPTOR|FIRMA_EVIDENCE_ID/);
});


