'use strict';

Object.assign(process.env, {
  NODE_ENV: 'test',
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
  REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
  REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
});

const {
  createRepartoFinanceDb2Repository,
  skipIsolatedTestFinanceSeed,
  assertIsolatedTestWriteTable,
  FinanceRepoSchemaError,
} = require('../repositories/reparto-finance-db2-repository');

describe('isolated_test finance seed', () => {
  test('skips durable copy while Jest is running', async () => {
    const queryWithParams = jest.fn();
    const repo = createRepartoFinanceDb2Repository({ queryWithParams });
    const result = await repo.seedIsolatedTestFinanceFromProduction({
      info: { cobrosAligned: true, cobrosHasDocumentColumns: true, has: () => true },
      ids: ['94'],
      dateYmd: 20260817,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('test');
    expect(queryWithParams).not.toHaveBeenCalled();
    expect(skipIsolatedTestFinanceSeed()).toBe(true);
  });

  test('refuses a non-TEST write target', () => {
    expect(() => assertIsolatedTestWriteTable('JAVIER.REPARTIDOR_COBROS'))
      .toThrow(FinanceRepoSchemaError);
  });

  test('copies production into JAVIER.TEST_* only when forced', async () => {
    const queryWithParams = jest.fn().mockResolvedValue([]);
    const repo = createRepartoFinanceDb2Repository({ queryWithParams });
    const result = await repo.seedIsolatedTestFinanceFromProduction({
      info: {
        cobrosAligned: true,
        cobrosHasCollectionDate: true,
        cobrosHasLiquidado: true,
        cobrosHasDocumentColumns: true,
        cobrosHasIdempotencyToken: true,
        balanceCodeColumn: 'CODIGO_REPARTIDOR',
        has: () => true,
      },
      ids: ['94'],
      dateYmd: 20260817,
      force: true,
    });
    expect(result.skipped).toBe(false);
    const sql = queryWithParams.mock.calls.map(([text]) => text).join('\n');
    expect(sql).toMatch(/FROM DSEDAC\.LQD LQD/);
    expect(sql).toMatch(/INSERT INTO JAVIER\.TEST_REPARTIDOR_COBROS/);
    expect(sql).not.toMatch(/INSERT INTO JAVIER\.REPARTIDOR_COBROS/);
    expect(sql).not.toMatch(/INSERT INTO DSEDAC\./);
  });

  test('structured daily sums use TEST when it has rows instead of adding production', async () => {
    const queryWithParams = jest.fn()
      .mockResolvedValueOnce([{ TOTAL: '12' }])
      .mockResolvedValueOnce([{ TOTAL: '3' }])
      .mockResolvedValueOnce([{ TOTAL: '-1' }]);
    const repo = createRepartoFinanceDb2Repository({ queryWithParams });
    const sums = await repo.selectDailyStructuredSums({ ids: ['94'], dateYmd: 20260817 });
    expect(sums).toEqual({ gastos: 12, ingresoBanco: 3, ajustes: -1 });
    const sql = queryWithParams.mock.calls.map(([text]) => text).join('\n');
    expect(sql).toContain('SYSIBM.SYSDUMMY1');
    expect(sql).not.toContain('STRUCTURED_OVERLAY');
  });
});
