'use strict';

jest.mock('../config/db', () => ({
  queryWithParams: jest.fn(),
  getPool: jest.fn(),
  initDb: jest.fn(),
}));
jest.mock('../middleware/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../utils/db2-schemas', () => ({
  db2AppTable: (name) => `JAVIER.TEST_${name}`,
}));
jest.mock('../utils/comercial-erp-tables', () => ({
  comercialErpTable: (name) => `DSEDAC.${name}`,
}));

const bolsa = require('../services/bolsa-comercial.service');

function bagRow(overrides = {}) {
  return {
    ID: 9,
    CODIGOVENDEDOR: '73',
    EJERCICIO: 2026,
    MES: 11,
    LIMITE_PCT: 3,
    LIMITE_IMPORTE: 0,
    SALDO_DISPONIBLE: 300,
    CONSUMIDO: 0,
    ACUMULADO: 0,
    ...overrides,
  };
}

function ledgerDouble({ movements = [] } = {}) {
  const calls = [];
  const existingKeys = new Set();
  const queryFn = jest.fn((sql, params = []) => {
    calls.push({ sql, params });
    if (/M\.TIPO IN/i.test(sql)) return Promise.resolve(movements);
    if (/SELECT IDEMPOTENCY_KEY/i.test(sql)) {
      return Promise.resolve(
        params.filter((key) => existingKeys.has(key)).map((IDEMPOTENCY_KEY) => ({ IDEMPOTENCY_KEY })),
      );
    }
    if (/INSERT INTO JAVIER\.TEST_MOVIMIENTOS_BOLSA/i.test(sql)) {
      existingKeys.add(params.at(-1));
    }
    return Promise.resolve({ count: 1 });
  });
  return { queryFn, calls, existingKeys };
}

describe('append-only bolsa order trace and reversal', () => {
  test('neutral confirmation appends one zero-impact registration', async () => {
    const calls = [];
    const queryFn = jest.fn((sql, params) => {
      calls.push({ sql, params });
      if (/FROM JAVIER\.TEST_BOLSA_COMERCIAL.*CODIGOVENDEDOR/i.test(sql)) {
        return Promise.resolve([bagRow()]);
      }
      if (/SELECT IDEMPOTENCY_KEY/i.test(sql)) return Promise.resolve([]);
      return Promise.resolve({ count: 1 });
    });
    const result = await bolsa.applyOrderMovementsWith(queryFn, {
      vendedorCode: '73',
      pedidoId: 81,
    });
    expect(result.registration).toEqual({
      created: true,
      idempotencyKey: 'pedido-81-bag-registration',
    });
    const insert = calls.find(({ sql }) => /INSERT INTO JAVIER\.TEST_MOVIMIENTOS_BOLSA/i.test(sql));
    expect(insert.params).toEqual(expect.arrayContaining([
      9, '73', 81, 'REGISTRO', 0, 300, 300, 'pedido-81-bag-registration',
    ]));
  });

  test('neutral cancellation appends one idempotent zero-impact reversal in the original month', async () => {
    const { queryFn, calls, existingKeys } = ledgerDouble({
      movements: [{
        ID: 901,
        BOLSA_ID: 9,
        LINEA_ID: null,
        TIPO: 'REGISTRO',
        IMPORTE: 0,
        CODIGO_ARTICULO: '',
        DESCRIPCION: 'Pedido confirmado sin impacto economico en bolsa',
        PRECIO_MINIMO_CONGELADO: 0,
        PRECIO_VENTA: 0,
        CANTIDAD: 0,
        UNIDAD_MEDIDA: '',
        IDEMPOTENCY_KEY: 'pedido-81-bag-registration',
        SALDO_DISPONIBLE: 300,
        CONSUMIDO: 0,
        ACUMULADO: 0,
        EJERCICIO: 2026,
        MES: 9,
      }],
    });

    const first = await bolsa.reverseOrderMovementsWith(queryFn, {
      pedidoId: 81,
      vendedorCode: '73',
    });
    const replay = await bolsa.reverseOrderMovementsWith(queryFn, {
      pedidoId: 81,
      vendedorCode: '73',
    });

    expect(first).toMatchObject({
      count: 1,
      reversed: [{
        originalMovementId: 901,
        originalBolsaId: 9,
        ejercicio: 2026,
        mes: 9,
        type: 'REVERSO_REGISTRO',
        amount: 0,
      }],
    });
    expect(replay).toEqual({ reversed: [], count: 0 });
    expect(existingKeys).toContain('pedido-81-movement-901-reverse');
    expect(calls.some(({ sql }) => /^UPDATE\s+JAVIER\.(?:TEST_)?BOLSA_COMERCIAL/i.test(sql.trim())))
      .toBe(false);
  });

  test('neutral confirmation replay does not append another registration', async () => {
    const queryFn = jest.fn((sql) => {
      if (/FROM JAVIER\.TEST_BOLSA_COMERCIAL.*CODIGOVENDEDOR/i.test(sql)) return Promise.resolve([bagRow()]);
      if (/SELECT IDEMPOTENCY_KEY/i.test(sql)) {
        return Promise.resolve([{ IDEMPOTENCY_KEY: 'pedido-81-bag-registration' }]);
      }
      return Promise.resolve({ count: 1 });
    });
    const result = await bolsa.applyOrderMovementsWith(queryFn, {
      vendedorCode: '73', pedidoId: 81,
    });
    expect(result.registration.created).toBe(false);
    expect(queryFn.mock.calls.some(([sql]) => /INSERT INTO JAVIER\.TEST_MOVIMIENTOS_BOLSA/i.test(sql))).toBe(false);
  });

  test('reverses original consumption in its original bolsa id', async () => {
    const calls = [];
    const queryFn = jest.fn((sql, params) => {
      calls.push({ sql, params });
      if (/M\.TIPO IN/i.test(sql)) return Promise.resolve([{
        ID: 17, BOLSA_ID: 4, LINEA_ID: 2, TIPO: 'CONSUMO', IMPORTE: 12,
        CODIGO_ARTICULO: '2974', DESCRIPCION: 'PES', PRECIO_MINIMO_CONGELADO: 29.28,
        PRECIO_VENTA: 28, CANTIDAD: 2, UNIDAD_MEDIDA: 'CAJAS',
        SALDO_DISPONIBLE: 20, CONSUMIDO: 18, ACUMULADO: 0, EJERCICIO: 2026, MES: 10,
      }]);
      if (/WHERE IDEMPOTENCY_KEY/i.test(sql)) return Promise.resolve([]);
      if (/SELECT SALDO_DISPONIBLE, CONSUMIDO/i.test(sql)) {
        return Promise.resolve([{ SALDO_DISPONIBLE: 20, CONSUMIDO: 18, ACUMULADO: 0 }]);
      }
      return Promise.resolve({ count: 1 });
    });
    const result = await bolsa.reverseOrderMovementsWith(queryFn, {
      pedidoId: 81, vendedorCode: '73',
    });
    expect(result).toMatchObject({ count: 1 });
    expect(result.reversed[0]).toMatchObject({
      originalMovementId: 17,
      originalBolsaId: 4,
      ejercicio: 2026,
      mes: 10,
      type: 'REVERSO_CONSUMO',
      saldoPosterior: 32,
    });
    expect(calls.some(({ sql, params }) =>
      /CONSUMIDO = CONSUMIDO -/i.test(sql) && params[2] === 4)).toBe(true);
  });

  test('reversing accumulation exposes an available deficit instead of blocking cancellation', async () => {
    const queryFn = jest.fn((sql) => {
      if (/M\.TIPO IN/i.test(sql)) return Promise.resolve([{
        ID: 18, BOLSA_ID: 5, LINEA_ID: 3, TIPO: 'ACUMULACION', IMPORTE: 10,
        SALDO_DISPONIBLE: 5, CONSUMIDO: 0, ACUMULADO: 10, EJERCICIO: 2026, MES: 9,
      }]);
      if (/WHERE IDEMPOTENCY_KEY/i.test(sql)) return Promise.resolve([]);
      if (/SELECT SALDO_DISPONIBLE, CONSUMIDO/i.test(sql)) {
        return Promise.resolve([{ SALDO_DISPONIBLE: 5, CONSUMIDO: 0, ACUMULADO: 10 }]);
      }
      return Promise.resolve({ count: 1 });
    });
    const result = await bolsa.reverseOrderMovementsWith(queryFn, {
      pedidoId: 81, vendedorCode: '73',
    });
    expect(result.reversed[0].saldoPosterior).toBe(-5);
  });

  test('reversal replay is idempotent and performs no aggregate update', async () => {
    const queryFn = jest.fn((sql) => {
      if (/M\.TIPO IN/i.test(sql)) return Promise.resolve([{
        ID: 17, BOLSA_ID: 4, TIPO: 'CONSUMO', IMPORTE: 12,
      }]);
      if (/IDEMPOTENCY_KEY IN/i.test(sql)) {
        return Promise.resolve([{ IDEMPOTENCY_KEY: 'pedido-81-movement-17-reverse' }]);
      }
      return Promise.resolve({ count: 1 });
    });
    const result = await bolsa.reverseOrderMovementsWith(queryFn, {
      pedidoId: 81, vendedorCode: '73',
    });
    expect(result).toEqual({ reversed: [], count: 0 });
    expect(queryFn.mock.calls.some(([sql]) => /^UPDATE JAVIER\.TEST_BOLSA_COMERCIAL/i.test(sql.trim()))).toBe(false);
  });

  test('fails closed if aggregate amount cannot support the inverse', async () => {
    const queryFn = jest.fn((sql) => {
      if (/M\.TIPO IN/i.test(sql)) return Promise.resolve([{
        ID: 17, BOLSA_ID: 4, TIPO: 'CONSUMO', IMPORTE: 12,
      }]);
      if (/WHERE IDEMPOTENCY_KEY/i.test(sql)) return Promise.resolve([]);
      if (/SELECT SALDO_DISPONIBLE, CONSUMIDO/i.test(sql)) {
        return Promise.resolve([{ SALDO_DISPONIBLE: 20, CONSUMIDO: 1, ACUMULADO: 0 }]);
      }
      return Promise.resolve({ count: 1 });
    });
    await expect(bolsa.reverseOrderMovementsWith(queryFn, {
      pedidoId: 81, vendedorCode: '73',
    })).rejects.toThrow(/Consumo agregado inconsistente/);
  });
});
