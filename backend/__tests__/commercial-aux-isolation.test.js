'use strict';

describe('commercial auxiliary isolated mapping', () => {
  const previous = process.env.REPARTO_TABLE_SET;
  beforeEach(() => {
    jest.resetModules();
    process.env.REPARTO_TABLE_SET = 'isolated_test';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.REPARTO_TABLE_SET;
    else process.env.REPARTO_TABLE_SET = previous;
  });

  test('maps every mutable commercial auxiliary table to JAVIER.TEST_*', () => {
    const { db2AppTable } = require('../utils/db2-schemas');
    expect(db2AppTable('PEDIDOS_SEQ')).toBe('JAVIER.TEST_PEDIDOS_SEQ');
    expect(db2AppTable('PEDIDO_IDEMPOTENCY')).toBe('JAVIER.TEST_PEDIDO_IDEMPOTENCY');
    expect(db2AppTable('PEDIDOS_STOCK_RESERVE')).toBe('JAVIER.TEST_PEDIDOS_STOCK_RESERVE');
    expect(db2AppTable('BOLSA_COMERCIAL')).toBe('JAVIER.TEST_BOLSA_COMERCIAL');
    expect(db2AppTable('MOVIMIENTOS_BOLSA')).toBe('JAVIER.TEST_MOVIMIENTOS_BOLSA');
  });
});
