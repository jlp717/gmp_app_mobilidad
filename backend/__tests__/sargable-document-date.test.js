'use strict';

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: jest.fn(),
  getPool: jest.fn(),
  initDb: jest.fn(),
  closePool: jest.fn(),
}));

const { sargableDocumentDateBound } = require('../utils/common');

describe('sargableDocumentDateBound', () => {
  test('builds inclusive lower bound without multiplying date columns', () => {
    const bound = sargableDocumentDateBound('gte', '2026-03-15');
    expect(bound.sql).toContain('ANODOCUMENTO > ?');
    expect(bound.sql).not.toMatch(/ANODOCUMENTO \* 10000/);
    expect(bound.params).toEqual([2026, 2026, 3, 3, 15]);
  });

  test('builds inclusive upper bound', () => {
    const bound = sargableDocumentDateBound('lte', '2026-03-15');
    expect(bound.sql).toContain('ANODOCUMENTO < ?');
    expect(bound.params).toEqual([2026, 2026, 3, 3, 15]);
  });

  test('rejects non-ISO dates', () => {
    expect(sargableDocumentDateBound('gte', '15/03/2026')).toBeNull();
    expect(sargableDocumentDateBound('gte', '2026-02-30')).toBeNull();
  });
});
