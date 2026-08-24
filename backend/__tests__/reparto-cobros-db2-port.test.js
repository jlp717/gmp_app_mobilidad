'use strict';

const fs = require('fs');
const path = require('path');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const {
  COMMERCIAL_COLUMNS,
  LEDGER_COLUMNS,
  RepartoCobrosCapabilityError,
  createRepartoCobrosDb2Port,
} = require('../repositories/reparto-cobros-db2-port');

function runtime() {
  return resolveRepartoRuntime({
    NODE_ENV: 'test',
    REPARTO_ENVIRONMENT: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    REPARTO_WRITES_ENABLED: 'true',
    REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
    ODBC_DSN: 'GMP',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  });
}

function payment(overrides = {}) {
  return {
    confirmationId: 88,
    entregaId: 'must-not-be-persisted',
    codigoCliente: 'C1',
    codigoRepartidor: '17',
    tipoDocumento: 'CAC',
    origenDocumento: 'B',
    subempresaDocumento: '001',
    ejercicioDocumento: 2026,
    serieDocumento: 'A',
    terminalDocumento: 1,
    numeroDocumento: 8,
    xdeDocumento: 1,
    dexDocumento: 1,
    importeCobrado: 10,
    importePendiente: 5,
    formaPago: 'EFECTIVO',
    idempotencyToken: 'idem-12345678',
    pantallaOrigen: 'RUTERO',
    operador: '17',
    notas: 'ok',
    ...overrides,
  };
}

function replayRow(overrides = {}) {
  return {
    ID: 91,
    CODIGOCLIENTEALBARAN: 'C1',
    CODIGOCLIENTEFACTURA: 'C1',
    CODIGOVENDEDOR: '17',
    CODIGOVENDEDORCOBRO: '17',
    TIPODOCUMENTO: 'CAC',
    ORIGENDOCUMENTO: 'B',
    SUBEMPRESADOCUMENTO: '001',
    EJERCICIODOCUMENTO: 2026,
    SERIEDOCUMENTO: 'A',
    TERMINALDOCUMENTO: 1,
    NUMERODOCUMENTO: 8,
    XDEDOCUMENTO: 1,
    DEXDOCUMENTO: 1,
    IMPORTEVENCIMIENTO: 10,
    IMPORTEPENDIENTE: 5,
    CODIGOFORMAPAGO: 'EF',
    PANTALLA_ORIGEN: 'RUTERO',
    OPERADOR: '17',
    OBSERVACIONES: 'ok',
    ...overrides,
  };
}

function fakeConnection({ missingColumn, uniqueIndex = true, replay = [], commercialAmount = 0, insertError } = {}) {
  const resolved = runtime();
  const [ledgerSchema, ledgerTable] = resolved.tables.finance.cobros.split('.');
  const [commercialSchema, commercialTable] = resolved.tables.finance.commercialCobros.split('.');
  const calls = [];
  const lifecycle = {
    beginTransaction: jest.fn(() => { throw new Error('nested transaction'); }),
    commit: jest.fn(() => { throw new Error('nested commit'); }),
    rollback: jest.fn(() => { throw new Error('nested rollback'); }),
    close: jest.fn(() => { throw new Error('owned connection close'); }),
  };
  const execute = jest.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('QSYS2.SYSTABLES')) {
      return [
        { TABLE_SCHEMA: ledgerSchema, TABLE_NAME: ledgerTable },
        { TABLE_SCHEMA: commercialSchema, TABLE_NAME: commercialTable },
      ];
    }
    if (sql.includes('QSYS2.SYSCOLUMNS')) {
      return [
        ...LEDGER_COLUMNS.map((COLUMN_NAME) => ({ TABLE_SCHEMA: ledgerSchema, TABLE_NAME: ledgerTable, COLUMN_NAME })),
        ...COMMERCIAL_COLUMNS.map((COLUMN_NAME) => ({ TABLE_SCHEMA: commercialSchema, TABLE_NAME: commercialTable, COLUMN_NAME })),
      ].filter((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}` !== missingColumn);
    }
    if (sql.includes('QSYS2.SYSINDEXES')) return uniqueIndex ? [{ INDEX_NAME: 'UQ_TOKEN' }] : [];
    if (sql.includes('WHERE IDEMPOTENCY_TOKEN = ?')) return replay;
    if (sql.includes('COALESCE(SUM(IMPORTE)')) return [{ TOTAL_COBRADO: commercialAmount }];
    if (sql.includes('IDENTITY_VAL_LOCAL')) return [{ ID: 91 }];
    if (sql.startsWith('INSERT INTO') && insertError) throw insertError;
    return [];
  });
  return { connection: { execute, ...lifecycle }, calls, lifecycle };
}

describe('reparto cobros DB2 transaction-bound port', () => {
  test('requires the finance capability independently from confirmation', () => {
    const confirmationOnly = resolveRepartoRuntime({
      NODE_ENV: 'test',
      REPARTO_ENVIRONMENT: 'test',
      REPARTO_TABLE_SET: 'isolated_test',
      REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
      REPARTO_WRITES_ENABLED: 'true',
      REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'true',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
      ODBC_DSN: 'GMP',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
      REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    });
    expect(confirmationOnly.confirmationCapabilityApproved).toBe(true);
    expect(confirmationOnly.financeCapabilityApproved).toBe(false);
    expect(() => createRepartoCobrosDb2Port({ runtime: confirmationOnly }))
      .toThrow(RepartoCobrosCapabilityError);
  });

  test('rejects altered mappings and never embeds physical finance table names in source', () => {
    const resolved = runtime();
    const altered = {
      ...resolved,
      tables: { ...resolved.tables, finance: { ...resolved.tables.finance, cobros: 'JAVIER.TEST_OTHER_COBROS' } },
    };
    expect(() => createRepartoCobrosDb2Port({ runtime: altered })).toThrow(RepartoCobrosCapabilityError);

    const source = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'reparto-cobros-db2-port.js'), 'utf8');
    expect(source).not.toContain('TEST_REPARTIDOR_COBROS');
    expect(source).not.toContain('TEST_COBROS');
    expect(source).not.toContain('ENTREGA_APP_ID');
  });

  test('fails capability before binding when columns or unique token index are absent', async () => {
    const missingColumn = fakeConnection({ missingColumn: 'TEST_REPARTIDOR_COBROS.IDEMPOTENCY_TOKEN' });
    const port = createRepartoCobrosDb2Port({ runtime: runtime() });
    await expect(port.assertCapabilities(missingColumn.connection)).rejects.toMatchObject({
      code: 'REPARTO_COBROS_CAPABILITY_UNAVAILABLE', statusCode: 503,
    });
    expect(() => port.forConnection(missingColumn.connection)).toThrow(RepartoCobrosCapabilityError);

    const noIndex = fakeConnection({ uniqueIndex: false });
    await expect(port.assertCapabilities(noIndex.connection)).rejects.toMatchObject({ statusCode: 503 });
    expect(() => port.forConnection(noIndex.connection)).toThrow(RepartoCobrosCapabilityError);
  });

  test('uses only the supplied approved connection and never owns its transaction lifecycle', async () => {
    const fake = fakeConnection();
    const port = createRepartoCobrosDb2Port({
      runtime: runtime(),
      now: () => new Date(2026, 7, 3, 10, 0, 0),
      logger: { info: jest.fn() },
    });
    await port.assertCapabilities(fake.connection);
    await expect(port.forConnection(fake.connection).insertCobro(payment())).resolves.toEqual({ id: '91', created: true });

    expect(fake.lifecycle.beginTransaction).not.toHaveBeenCalled();
    expect(fake.lifecycle.commit).not.toHaveBeenCalled();
    expect(fake.lifecycle.rollback).not.toHaveBeenCalled();
    expect(fake.lifecycle.close).not.toHaveBeenCalled();
    const insert = fake.calls.find((call) => call.sql.startsWith('INSERT INTO'));
    expect(insert.sql).toContain(runtime().tables.finance.cobros);
    expect(insert.sql).not.toContain('ENTREGA_APP_ID');
    expect(insert.params).not.toContain('must-not-be-persisted');
  });

  test('uses an empty observation instead of NULL for IBM i not-null ledgers', async () => {
    const fake = fakeConnection();
    const port = createRepartoCobrosDb2Port({ runtime: runtime() });
    await port.assertCapabilities(fake.connection);
    await expect(port.forConnection(fake.connection).insertCobro(payment({ notas: undefined }))).resolves.toEqual({ id: '91', created: true });
    const insert = fake.calls.find((call) => call.sql.startsWith('INSERT INTO'));
    expect(insert.params.at(-1)).toBe('');
  });

  test('returns an exact replay and rejects a changed payload without inserting', async () => {
    const exact = fakeConnection({ replay: [replayRow()] });
    const port = createRepartoCobrosDb2Port({ runtime: runtime() });
    await port.assertCapabilities(exact.connection);
    await expect(port.forConnection(exact.connection).insertCobro(payment())).resolves.toEqual({ id: '91', created: false });
    const replaySelect = exact.calls.find((call) => call.sql.includes('WHERE IDEMPOTENCY_TOKEN = ?'));
    expect(replaySelect.sql).toMatch(/FETCH FIRST 2 ROWS ONLY[\s\S]*FOR UPDATE WITH RS/);
    expect(replaySelect.sql).not.toMatch(/FOR UPDATE WITH RS[\s\S]*FETCH FIRST 2 ROWS ONLY/);
    expect(exact.calls.some((call) => call.sql.startsWith('INSERT INTO'))).toBe(false);

    const conflict = fakeConnection({ replay: [replayRow({ IMPORTEVENCIMIENTO: 11 })] });
    await port.assertCapabilities(conflict.connection);
    await expect(port.forConnection(conflict.connection).insertCobro(payment())).rejects.toMatchObject({
      code: 'REPARTO_COBRO_IDEMPOTENCY_CONFLICT', statusCode: 409,
    });
    expect(conflict.calls.some((call) => call.sql.startsWith('INSERT INTO'))).toBe(false);
  });

  test('fails closed when the exact commercial document key already has a payment', async () => {
    const fake = fakeConnection({ commercialAmount: 1 });
    const port = createRepartoCobrosDb2Port({ runtime: runtime() });
    await port.assertCapabilities(fake.connection);

    await expect(port.forConnection(fake.connection).insertCobro(payment())).rejects.toMatchObject({
      code: 'REPARTO_COBRO_COMMERCIAL_CONFLICT', statusCode: 409,
    });
    const crosscheck = fake.calls.find((call) => call.sql.includes('COALESCE(SUM(IMPORTE)'));
    expect(crosscheck.params).toEqual(['C1', 'CVC:CAC:B:001:2026:A:1:8:1:1']);
    expect(fake.calls.some((call) => call.sql.startsWith('INSERT INTO'))).toBe(false);
  });
});

  test.each([
    { code: 'SQL0803' },
    { sqlState: '23505' },
  ])('preserves duplicate token identity errors for transaction replay: %j', async (duplicate) => {
    const fake = fakeConnection({ insertError: Object.assign(new Error('duplicate token'), duplicate) });
    const port = createRepartoCobrosDb2Port({ runtime: runtime() });
    await port.assertCapabilities(fake.connection);

    await expect(port.forConnection(fake.connection).insertCobro(payment())).rejects.toMatchObject({
      code: 'REPARTO_COBRO_IDEMPOTENCY_RACE',
      statusCode: 409,
      cause: expect.objectContaining(duplicate),
    });
  });

test('maps a non-unique ledger failure to a sanitized 503', async () => {
  const fake = fakeConnection({ insertError: Object.assign(new Error('driver failure'), { code: 'HY000' }) });
  const port = createRepartoCobrosDb2Port({ runtime: runtime() });
  await port.assertCapabilities(fake.connection);

  await expect(port.forConnection(fake.connection).insertCobro(payment())).rejects.toMatchObject({
    code: 'REPARTO_COBROS_CAPABILITY_UNAVAILABLE',
    statusCode: 503,
  });
});
