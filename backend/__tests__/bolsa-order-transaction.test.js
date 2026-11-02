'use strict';

jest.mock('../config/db', () => ({
  queryWithParams: jest.fn(),
  getPool: jest.fn(() => null),
  initDb: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const bolsaService = require('../services/bolsa-comercial.service');

function bolsaRow() {
  return [{
    ID: 7,
    CODIGOVENDEDOR: '10',
    EJERCICIO: new Date().getFullYear(),
    MES: new Date().getMonth() + 1,
    LIMITE_PCT: 3,
    LIMITE_IMPORTE: 0,
    SALDO_DISPONIBLE: 300,
    CONSUMIDO: 0,
    ACUMULADO: 0,
  }];
}

function movement() {
  return [{
    tipo: 'CONSUMO',
    importe: 6,
    timestamp: '2026-11-02T12:00:00.000Z',
    lineId: 9,
    codigoArticulo: 'ART-9',
    descripcion: 'Producto',
    precioMinimoCongelado: 10,
    precioVenta: 7,
    cantidad: 2,
    unidadMedida: 'CAJAS',
  }];
}

test('uses the caller transaction, locks the ledger and writes deterministic movement keys', async () => {
  const calls = [];
  const queryFn = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM\s+JAVIER\.(?:TEST_)?BOLSA_COMERCIAL/i.test(sql)) return bolsaRow();
    if (/SELECT\s+IDEMPOTENCY_KEY/i.test(sql)) return [];
    return [];
  });

  const result = await bolsaService.applyOrderMovementsWith(queryFn, {
    vendedorCode: '10',
    pedidoId: 42,
    consumoAmount: 6,
    consumoMovements: movement(),
  });

  expect(result.allowed).toBe(true);
  expect(calls[0].sql).toMatch(/^LOCK TABLE JAVIER\.(?:TEST_)?BOLSA_COMERCIAL IN EXCLUSIVE MODE$/i);
  expect(calls[1].sql).toMatch(/^LOCK TABLE JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA IN EXCLUSIVE MODE$/i);
  const insert = calls.find(({ sql }) => /INSERT\s+INTO\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql));
  expect(insert).toBeDefined();
  expect(insert.params).toContain('pedido-42-line-9-under-min');
  expect(calls.map(({ sql }) => sql)).not.toEqual(expect.arrayContaining(['COMMIT', 'ROLLBACK']));
});

test('a replay with an existing key does not update balance or insert a second movement', async () => {
  const queryFn = jest.fn(async (sql) => {
    if (/FROM\s+JAVIER\.(?:TEST_)?BOLSA_COMERCIAL/i.test(sql)) return bolsaRow();
    if (/SELECT\s+IDEMPOTENCY_KEY/i.test(sql)) {
      return [{ IDEMPOTENCY_KEY: 'pedido-42-line-9-under-min' }];
    }
    return [];
  });

  const result = await bolsaService.applyOrderMovementsWith(queryFn, {
    vendedorCode: '10',
    pedidoId: 42,
    consumoAmount: 6,
    consumoMovements: movement(),
  });

  expect(result).toMatchObject({
    allowed: true,
    consumo: { allowed: true, duplicate: true, saldo: 300 },
  });
  const sql = queryFn.mock.calls.map(([statement]) => statement).join('\n');
  expect(sql).not.toMatch(/UPDATE\s+JAVIER\.(?:TEST_)?BOLSA_COMERCIAL/i);
  expect(sql).not.toMatch(/INSERT\s+INTO\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i);
});

test('propagates a movement insert error so the caller can roll back the whole order', async () => {
  const queryFn = jest.fn(async (sql) => {
    if (/FROM\s+JAVIER\.(?:TEST_)?BOLSA_COMERCIAL/i.test(sql)) return bolsaRow();
    if (/SELECT\s+IDEMPOTENCY_KEY/i.test(sql)) return [];
    if (/INSERT\s+INTO\s+JAVIER\.(?:TEST_)?MOVIMIENTOS_BOLSA/i.test(sql)) {
      throw new Error('movement insert failed');
    }
    return [];
  });

  await expect(bolsaService.applyOrderMovementsWith(queryFn, {
    vendedorCode: '10',
    pedidoId: 42,
    consumoAmount: 6,
    consumoMovements: movement(),
  })).rejects.toThrow('movement insert failed');
});

