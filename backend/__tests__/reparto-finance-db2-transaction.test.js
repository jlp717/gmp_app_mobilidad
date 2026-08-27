'use strict';

Object.assign(process.env, {
  NODE_ENV: 'test',
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
});

const {
  createRepartoFinanceDb2Repository,
  resolveFinanceBindings,
} = require('../repositories/reparto-finance-db2-repository');

describe('reparto finance DB2 transaction boundary', () => {
  test('uses IBM i compatible isolation setup instead of BEGIN WORK', async () => {
    const repository = createRepartoFinanceDb2Repository({
      bindings: resolveFinanceBindings(process.env),
    });
    const connection = { query: jest.fn().mockResolvedValue([]) };

    await repository.beginWork(connection);
    await repository.commit(connection);
    await repository.rollback(connection);

    expect(connection.query.mock.calls.map(([sql]) => sql)).toEqual([
      'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
      'COMMIT',
      'ROLLBACK',
    ]);
  });
});

test('daily delivered total is sourced from canonical test confirmations', async () => {
  const calls = [];
  const repository = createRepartoFinanceDb2Repository({
    bindings: resolveFinanceBindings(process.env),
    queryWithParams: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      return [{ TOTAL_REPARTIDO: '123.45' }];
    }),
  });

  await expect(repository.selectConfirmedDeliveredAmount({
    ids: ['02', '44'], date: '2026-08-27',
  })).resolves.toEqual([{ TOTAL_REPARTIDO: '123.45' }]);
  expect(calls).toHaveLength(1);
  expect(calls[0].sql).toContain('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES C');
  expect(calls[0].sql).toContain('JAVIER.TEST_REPARTO_LINEAS');
  expect(calls[0].sql).toContain("C.STATUS IN ('ENTREGADO', 'PARCIAL')");
  expect(calls[0].params).toEqual(['02', '44', '2026-08-27']);
});
