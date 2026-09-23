'use strict';

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
  query: mockQuery,
  queryWithParams: mockQueryWithParams,
  getPool: () => ({ connect: jest.fn() }),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn((fn, sql) => fn(sql)),
}));

jest.mock('../services/redis-cache', () => ({
  redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePattern: jest.fn() },
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));

const pedidosService = require('../services/pedidos.service');

describe('GET /pedidos/families contract (detailed)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
  });

  test('getFamiliesDetailed maps FAM names and marks Impulso/Nestlé from DB rows', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        CODE: '003',
        NAME: 'NESTLE IMPULSO',
        PREFAMILY: 'Z',
        ART_COUNT: 191,
      },
      {
        CODE: '001',
        NAME: 'CONGELADO',
        PREFAMILY: '',
        ART_COUNT: 779,
      },
      {
        CODE: '0031',
        NAME: 'NESTLE RESTAURACION',
        PREFAMILY: 'C',
        ART_COUNT: 70,
      },
    ]);

    const families = await pedidosService.getFamiliesDetailed();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/CODIGOFAMILIA/i);
    expect(sql).toMatch(/DESCRIPCIONFAMILIA/i);
    expect(sql).toMatch(/GROUP BY TRIM\(A\.CODIGOFAMILIA\)/i);
    expect(sql).toMatch(/LEFT JOIN/i);
    expect(sql).not.toMatch(/'\s*\+|CONCAT\s*\(/i);

    expect(families).toEqual([
      {
        code: '003',
        name: 'NESTLE IMPULSO',
        prefamily: 'Z',
        artCount: 191,
        isNestle: true,
        isImpulso: true,
      },
      {
        code: '001',
        name: 'CONGELADO',
        prefamily: '',
        artCount: 779,
        isNestle: false,
        isImpulso: false,
      },
      {
        code: '0031',
        name: 'NESTLE RESTAURACION',
        prefamily: 'C',
        artCount: 70,
        isNestle: true,
        isImpulso: false,
      },
    ]);
  });

  test('getFamilies returns distinct CODIGOFAMILIA codes only', async () => {
    mockQuery.mockResolvedValueOnce([
      { CODE: '001' },
      { CODE: '003' },
    ]);
    const codes = await pedidosService.getFamilies();
    expect(codes).toEqual(['001', '003']);
  });
});
