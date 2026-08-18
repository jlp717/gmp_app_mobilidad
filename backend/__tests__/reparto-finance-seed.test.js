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
  resolveFinanceBindings,
} = require('../repositories/reparto-finance-db2-repository');

describe('isolated_test finance single-source contract', () => {
  test('disables runtime copy independently of Jest', async () => {
    const queryWithParams = jest.fn();
    const repo = createRepartoFinanceDb2Repository({ queryWithParams });
    const result = await repo.seedIsolatedTestFinanceFromProduction({
      info: { cobrosAligned: true, cobrosHasDocumentColumns: true, has: () => true },
      ids: ['94'],
      dateYmd: 20260817,
    });
    expect(result).toEqual({ skipped: true, reason: 'explicit_copy_script_required' });
    expect(queryWithParams).not.toHaveBeenCalled();
    expect(skipIsolatedTestFinanceSeed()).toBe(true);
  });

  test('refuses a non-TEST write target', () => {
    expect(() => assertIsolatedTestWriteTable('JAVIER.REPARTIDOR_COBROS'))
      .toThrow(FinanceRepoSchemaError);
  });

  test('refuses runtime copy even when legacy caller passes force', async () => {
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
    expect(result).toEqual({ skipped: true, reason: 'explicit_copy_script_required' });
    expect(queryWithParams).not.toHaveBeenCalled();
  });

  test('structured daily sums query only TEST app state', async () => {
    const queryWithParams = jest.fn()
      .mockResolvedValueOnce([{ TOTAL: '12' }])
      .mockResolvedValueOnce([{ TOTAL: '3' }])
      .mockResolvedValueOnce([{ TOTAL: '-1' }]);
    const repo = createRepartoFinanceDb2Repository({ queryWithParams });
    const sums = await repo.selectDailyStructuredSums({ ids: ['94'], dateYmd: 20260817 });
    expect(sums).toEqual({ gastos: 12, ingresoBanco: 3, ajustes: -1 });
    const sql = queryWithParams.mock.calls.map(([text]) => text).join('\n');
    expect(sql).toContain('JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS');
    expect(sql).toContain('JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS');
    expect(sql).toContain('JAVIER.TEST_REPARTIDOR_LIQUIDACION_AJUSTES');
    expect(sql).not.toMatch(/JAVIER\.(?!TEST_)(?:REPARTIDOR_|REPARTO_)/);
  });

  test('production runtime keeps production app mapping', () => {
    const bindings = resolveFinanceBindings({
      NODE_ENV: 'production',
      REPARTO_ENVIRONMENT: 'production',
      REPARTO_TABLE_SET: 'production',
      REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
      REPARTO_WRITES_ENABLED: 'false',
      ODBC_DSN: 'GMP',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
      REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
    });
    expect(bindings.tables.cobros).toBe('JAVIER.REPARTIDOR_COBROS');
    expect(bindings.tables.balances).toBe('JAVIER.REPARTIDOR_FINANCIAL_BALANCES');
    expect(bindings.tables.liquidationOps).toBe('JAVIER.REPARTIDOR_LIQUIDACION_OPS');
  });
});
