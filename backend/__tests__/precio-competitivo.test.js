'use strict';

const express = require('express');
const request = require('supertest');
const {
  LOOKUP_SQL,
  INSERT_SQL,
  emptyState,
  parseCreateInput,
  selectLatestValid,
  toPublic,
  createPrecioCompetitivoService,
} = require('../services/precio-competitivo-service');
const { createPrecioCompetitivoRouter } = require('../routes/precio-competitivo');

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
