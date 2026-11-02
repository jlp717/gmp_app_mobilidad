'use strict';

const express = require('express');
const request = require('supertest');
const {
  LOOKUP_SQL,
  LOOKUP_BATCH_SQL,
  INSERT_SQL,
  emptyState,
  parseCreateInput,
  selectLatestValid,
  toPublic,
  createPrecioCompetitivoService,
} = require('../services/precio-competitivo-service');
const { createPrecioCompetitivoRouter } = require('../routes/precio-competitivo');
const {
  ROWS: SEED_ROWS,
  SEED_LOCK_SQL,
  SOURCE_ORDER_SQL,
  UPSERT_SQL,
  canonicalSeedRows,
  seedPrecioCompetitivo,
} = require('../scripts/seed-precio-competitivo-test');

const base = {
  codigoArticulo: 'ART0000001',
  codigoCliente: '4300000354',
  codigoTarifa: 1,
  precioCompetitivo: 4.5,
  validoDesde: '2026-10-01',
  validoHasta: '2026-12-31',
  usuario: 'javi',
  updatedAt: '2026-10-01T10:00:00.000Z',
  id: 1,
};

describe('competitive price selection', () => {
  test('returns the latest valid row and never a zero when the row is absent or expired', () => {
    const present = selectLatestValid([
      { ...base, id: 1, validoDesde: '2026-09-01', precioCompetitivo: 3, margenPct: 10, updatedAt: '2026-09-01T00:00:00.000Z' },
      { ...base, id: 2, validoDesde: '2026-10-01', precioCompetitivo: 4.5, margenPct: 15, updatedAt: '2026-10-02T00:00:00.000Z' },
    ], '2026-10-15');
    expect(toPublic(present, base.codigoArticulo, base.codigoCliente)).toMatchObject({
      found: true,
      precioCompetitivo: 4.5,
      margenPct: 15,
    });

    expect(selectLatestValid([], '2026-10-15')).toBeNull();
    expect(emptyState(base.codigoArticulo, base.codigoCliente)).toMatchObject({
      found: false,
      precioCompetitivo: null,
      margenPct: null,
    });

    const expired = selectLatestValid([
      { ...base, validoDesde: '2026-01-01', validoHasta: '2026-09-30', precioCompetitivo: 9, margenPct: 20 },
    ], '2026-10-15');
    expect(expired).toBeNull();
    expect(toPublic(expired, base.codigoArticulo, base.codigoCliente).precioCompetitivo).toBeNull();
  });

  test('accepts margin 0 and 100 and rejects values outside that range', () => {
    expect(parseCreateInput({ ...base, margenPct: 0 }).margenPct).toBe(0);
    expect(parseCreateInput({ ...base, margenPct: 100 }).margenPct).toBe(100);
    expect(() => parseCreateInput({ ...base, margenPct: -0.01 })).toThrow(expect.objectContaining({
      code: 'PRECIO_COMPETITIVO_MARGEN_INVALID',
    }));
    expect(() => parseCreateInput({ ...base, margenPct: 100.01 })).toThrow(expect.objectContaining({
      code: 'PRECIO_COMPETITIVO_MARGEN_INVALID',
    }));
  });

  test('lookup SQL is parameterized and returns an explicit empty state', async () => {
    expect(LOOKUP_SQL).toContain('ORDER BY VALIDO_DESDE DESC, UPDATED_AT DESC, ID DESC');
    expect(LOOKUP_SQL).toContain('FETCH FIRST 1 ROW ONLY');
    expect(LOOKUP_SQL).not.toMatch(/\$\{|'\s*\+|concat\(/i);
    expect(INSERT_SQL).toContain('JAVIER.TEST_PRECIO_COMPETITIVO');
    expect(INSERT_SQL).not.toMatch(/DSEDAC|DSED\./);

    const query = jest.fn().mockResolvedValue([]);
    const service = createPrecioCompetitivoService({ queryWithParams: query, clock: () => new Date('2026-10-15T12:00:00.000Z') });
    const missing = await service.lookup({ codigoArticulo: 'ART0000001', codigoCliente: '4300000354' });
    expect(missing).toMatchObject({ found: false, precioCompetitivo: null, margenPct: null });
    expect(query.mock.calls[0][1]).toEqual(['ART0000001', '4300000354', '2026-10-15', '2026-10-15']);

    query.mockResolvedValueOnce([{
      ID: 9,
      CODIGOARTICULO: 'ART0000001',
      CODIGOCLIENTE: '4300000354',
      CODIGOTARIFA: 1,
      PRECIO_COMPETITIVO: 4.5,
      MARGEN_PCT: 0,
      VALIDO_DESDE: '2026-10-01',
      VALIDO_HASTA: null,
      USUARIO: 'javi',
      UPDATED_AT: '2026-10-01T10:00:00.000Z',
    }]);
    await expect(service.lookup({
      codigoArticulo: 'ART0000001',
      codigoCliente: '4300000354',
    })).resolves.toMatchObject({ found: true, margenPct: 0, precioCompetitivo: 4.5 });
  });

  test('batch lookup uses one ROW_NUMBER query and preserves real price and stored margin', async () => {
    expect(LOOKUP_BATCH_SQL).toMatch(/ROW_NUMBER\(\)\s+OVER/i);
    expect(LOOKUP_BATCH_SQL).toMatch(/PARTITION BY TRIM\(P\.CODIGOARTICULO\), TRIM\(P\.CODIGOCLIENTE\)/i);
    const query = jest.fn().mockResolvedValue([
      {
        ID: 1, CODIGOARTICULO: '3519', CODIGOCLIENTE: '4300032160', CODIGOTARIFA: 1,
        PRECIO_COMPETITIVO: 27.54, MARGEN_PCT: 24.69,
        VALIDO_DESDE: '2026-09-01', VALIDO_HASTA: null, USUARIO: 'pedido-106',
      },
      {
        ID: 2, CODIGOARTICULO: '3075', CODIGOCLIENTE: '4300032160', CODIGOTARIFA: 1,
        PRECIO_COMPETITIVO: 49.572, MARGEN_PCT: 24.71,
        VALIDO_DESDE: '2026-09-01', VALIDO_HASTA: null, USUARIO: 'pedido-106',
      },
    ]);
    const service = createPrecioCompetitivoService({
      queryWithParams: query,
      clock: () => new Date('2026-11-02T10:00:00.000Z'),
    });

    const rows = await service.lookupBatch({
      articleCodes: ['3519', '3075', '3519'],
      codigoCliente: '4300032160',
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/IN \(\?, \?\)/);
    expect(query.mock.calls[0][1]).toEqual([
      '4300032160', '3519', '3075', '2026-11-02', '2026-11-02',
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ codigoArticulo: '3519', precioCompetitivo: 27.54, margenPct: 24.69 }),
      expect.objectContaining({ codigoArticulo: '3075', precioCompetitivo: 49.572, margenPct: 24.71 }),
    ]);
  });

  test('batch lookup has an explicit empty result and does not invent tariff-one prices', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = createPrecioCompetitivoService({ queryWithParams: query });

    await expect(service.lookupBatch({
      articleCodes: ['3519', '3075'],
      codigoCliente: '4300032160',
      onDate: '2026-11-02',
    })).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

test('real-order TEST seed is repeatable through a parameterized MERGE', async () => {
  expect(UPSERT_SQL).toMatch(/^MERGE INTO JAVIER\.TEST_PRECIO_COMPETITIVO/i);
  expect(UPSERT_SQL).not.toMatch(/DSEDAC|DSED\./i);
  expect(SEED_ROWS).toEqual([
    ['3519', '4300032160', 1, 27.54, 24.69, '2026-09-28', null, 'pedido-106'],
    ['3075', '4300032160', 1, 49.572, 24.71, '2026-09-28', null, 'pedido-106'],
  ]);
  const stored = new Map();
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql, params) => {
      if (sql === SOURCE_ORDER_SQL) {
        return Promise.resolve([
          {
            CODIGOARTICULO: '3519', CODIGOCLIENTE: '4300032160', CODIGOTARIFA: 1,
            PRECIOVENTA: 27.54, PORCENTAJEMARGEN: 24.69, VALIDO_DESDE: '2026-09-28',
          },
          {
            CODIGOARTICULO: '3075', CODIGOCLIENTE: '4300032160', CODIGOTARIFA: 1,
            PRECIOVENTA: 49.572, PORCENTAJEMARGEN: 24.71, VALIDO_DESDE: '2026-09-28',
          },
        ]);
      }
      if (sql === UPSERT_SQL) {
        stored.set(`${params[0]}|${params[1]}|${params[5]}`, params);
      }
      return Promise.resolve([]);
    }),
  };
  const env = {
    APP_ENV: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    REPARTO_ENVIRONMENT: 'test',
    DB2_WRITE_SCHEMA: 'JAVIER',
  };

  await seedPrecioCompetitivo(connection, env);
  await seedPrecioCompetitivo(connection, env);

  expect(connection.beginTransaction).toHaveBeenCalledTimes(2);
  expect(connection.commit).toHaveBeenCalledTimes(2);
  expect(connection.rollback).not.toHaveBeenCalled();
  expect(connection.query.mock.calls.filter(([sql]) => sql === SEED_LOCK_SQL)).toHaveLength(2);
  expect(connection.query.mock.calls.filter(([sql]) => sql === SOURCE_ORDER_SQL)).toHaveLength(2);
  expect(connection.query.mock.calls.filter(([sql]) => sql === UPSERT_SQL)).toHaveLength(4);
  expect(stored.size).toBe(2);
});

test('canonical seed fails closed if confirmed order 106 is missing or changed', () => {
  expect(() => canonicalSeedRows([])).toThrow(/canonical confirmed order 106/i);
  expect(() => canonicalSeedRows([{
    CODIGOARTICULO: '3519', CODIGOCLIENTE: '4300032160', CODIGOTARIFA: 1,
    PRECIOVENTA: 27.54, PORCENTAJEMARGEN: 24.69, VALIDO_DESDE: '2026-09-27',
  }])).toThrow(/canonical confirmed order 106/i);
  expect(() => canonicalSeedRows([
    {
      CODIGOARTICULO: '3519', CODIGOCLIENTE: '4300032160', CODIGOTARIFA: 1,
      PRECIOVENTA: 27.55, PORCENTAJEMARGEN: 24.69, VALIDO_DESDE: '2026-09-28',
    },
    {
      CODIGOARTICULO: '3075', CODIGOCLIENTE: '4300032160', CODIGOTARIFA: 1,
      PRECIOVENTA: 49.572, PORCENTAJEMARGEN: 24.71, VALIDO_DESDE: '2026-09-28',
    },
  ])).toThrow(/canonical confirmed order 106/i);
});

test('TEST seed rolls back the whole locked batch on any MERGE failure', async () => {
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql) => {
      if (sql === SOURCE_ORDER_SQL) {
        return Promise.resolve([
          {
            CODIGOARTICULO: '3519', CODIGOCLIENTE: '4300032160', CODIGOTARIFA: 1,
            PRECIOVENTA: 27.54, PORCENTAJEMARGEN: 24.69, VALIDO_DESDE: '2026-09-28',
          },
          {
            CODIGOARTICULO: '3075', CODIGOCLIENTE: '4300032160', CODIGOTARIFA: 1,
            PRECIOVENTA: 49.572, PORCENTAJEMARGEN: 24.71, VALIDO_DESDE: '2026-09-28',
          },
        ]);
      }
      if (sql === UPSERT_SQL) return Promise.reject(new Error('merge failed'));
      return Promise.resolve([]);
    }),
  };
  const env = {
    APP_ENV: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    REPARTO_ENVIRONMENT: 'test',
    DB2_WRITE_SCHEMA: 'JAVIER',
  };

  await expect(seedPrecioCompetitivo(connection, env)).rejects.toThrow('merge failed');
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
});

test('GET returns the empty state instead of zero when the service has no row', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/precios-competitivos', createPrecioCompetitivoRouter({
    lookup: async () => emptyState('ART0000001', '4300000354'),
    create: async () => { throw new Error('not used'); },
  }));

  const response = await request(app).get('/api/precios-competitivos').query({
    codigoArticulo: 'ART0000001',
    codigoCliente: '4300000354',
  });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    success: true,
    found: false,
    precioCompetitivo: null,
    margenPct: null,
  });
  expect(response.body.precioCompetitivo).not.toBe(0);
});
