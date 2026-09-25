'use strict';

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: jest.fn(),
  getPool: jest.fn(),
  initDb: jest.fn(),
  closePool: jest.fn(),
}));

const { buildCvcVendorScopeFilter } = require('../utils/common');

describe('buildCvcVendorScopeFilter', () => {
  test('uses indexable CHAR(2) equality without TRIM on CVC.CODIGOVENDEDOR', () => {
    const scoped = buildCvcVendorScopeFilter('35');
    expect(scoped.clause).toMatch(/AND CVC\.CODIGOVENDEDOR IN \(/);
    expect(scoped.clause).not.toMatch(/TRIM\(CVC\.CODIGOVENDEDOR\)/);
    expect(scoped.params).toEqual(['35']);
  });

  test('never emits WHERE VENDEDOR=ALL', () => {
    const scoped = buildCvcVendorScopeFilter('ALL');
    expect(scoped.clause).not.toMatch(/VENDEDOR\s*=\s*'ALL'/i);
  });
});
