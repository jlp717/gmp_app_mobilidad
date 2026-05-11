'use strict';

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockPoolConnect = jest.fn();
const mockConnQuery = jest.fn();
const mockConnClose = jest.fn();

jest.mock('../config/db', () => ({
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
  getPool: () => ({ connect: mockPoolConnect }),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { Db2CobrosRepository } = require('../src/modules/cobros/infrastructure/db2-cobros-repository');

function orderRow(overrides = {}) {
  return {
    ID: 22,
    CODIGOCLIENTE: 'C001',
    CODIGOVENDEDOR: '01',
    SERIEPEDIDO: 'M',
    NUMEROPEDIDO: 1,
    IMPORTETOTAL: '100.00',
    ESTADO: 'CONFIRMADO',
    ...overrides,
  };
}

function setupRepository({ existingToken = [], paid = '0.00', order = orderRow() } = {}) {
  mockQuery.mockResolvedValue([{ 1: 1 }]);
  mockPoolConnect.mockResolvedValue({ query: mockConnQuery, close: mockConnClose });
  mockConnClose.mockResolvedValue(undefined);
  mockConnQuery.mockImplementation(async (sql) => {
    if (/^BEGIN WORK$/i.test(sql) || /^COMMIT$/i.test(sql) || /^ROLLBACK$/i.test(sql)) return [];
    if (/LOCK TABLE JAVIER\.COBROS IN EXCLUSIVE MODE/i.test(sql)) return [];
    if (/FROM JAVIER\.PEDIDOS_CAB PC/i.test(sql)) return order ? [order] : [];
    if (/FROM JAVIER\.COBROS\s+WHERE ID = \?/i.test(sql)) return existingToken;
    if (/COALESCE\(SUM\(IMPORTE\)/i.test(sql)) return [{ TOTAL_COBRADO: paid }];
    if (/INSERT INTO JAVIER\.COBROS/i.test(sql)) return [];
    return [];
  });
  return new Db2CobrosRepository();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockQueryWithParams.mockReset();
  mockPoolConnect.mockReset();
  mockConnQuery.mockReset();
  mockConnClose.mockReset();
});

describe('commercial cobros hardening', () => {
  test('registerPayment records a partial payment and returns remaining pending amount', async () => {
    const repo = setupRepository({ paid: '20.00' });

    const result = await repo.registerPayment({
      clientCode: 'C001',
      amount: 30,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      observations: 'parcial',
      userId: '01',
      userRole: 'COMERCIAL',
      idempotencyToken: 'cobro-token-partial-001',
    });

    expect(result.status).toBe('PARCIAL');
    expect(result.pendingBefore).toBe(80);
    expect(result.pendingAfter).toBe(50);
    const insertCall = mockConnQuery.mock.calls.find(([sql]) => /INSERT INTO JAVIER\.COBROS/i.test(sql));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      'cobro-token-partial-001',
      'C001',
      'PEDIDO:22:M-1',
      30,
      'CONTADO',
      'COMERCIAL',
      '01',
    ]));
  });

  test('registerPayment replays same idempotency token without duplicate insert', async () => {
    const repo = setupRepository({
      existingToken: [{
        ID: 'cobro-token-replay-001',
        CODIGO_CLIENTE: 'C001',
        REFERENCIA: 'PEDIDO:22:M-1',
        IMPORTE: '30.00',
        FORMA_PAGO: 'CONTADO',
        CODIGO_USUARIO: '01',
      }],
      paid: '30.00',
    });

    const result = await repo.registerPayment({
      clientCode: 'C001',
      amount: 30,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      userId: '01',
      userRole: 'COMERCIAL',
      idempotencyToken: 'cobro-token-replay-001',
    });

    expect(result.idempotent).toBe(true);
    expect(mockConnQuery.mock.calls.some(([sql]) => /INSERT INTO JAVIER\.COBROS/i.test(sql))).toBe(false);
  });

  test('registerPayment rejects same idempotency token with different payload', async () => {
    const repo = setupRepository({
      existingToken: [{
        ID: 'cobro-token-conflict-001',
        CODIGO_CLIENTE: 'C001',
        REFERENCIA: 'PEDIDO:22:M-1',
        IMPORTE: '30.00',
        FORMA_PAGO: 'CONTADO',
        CODIGO_USUARIO: '01',
      }],
    });

    await expect(repo.registerPayment({
      clientCode: 'C001',
      amount: 31,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      userId: '01',
      userRole: 'COMERCIAL',
      idempotencyToken: 'cobro-token-conflict-001',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('registerPayment rejects commercial overpay', async () => {
    const repo = setupRepository({ paid: '95.00' });

    await expect(repo.registerPayment({
      clientCode: 'C001',
      amount: 10,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      userId: '01',
      userRole: 'COMERCIAL',
      idempotencyToken: 'cobro-token-overpay-001',
    })).rejects.toMatchObject({ code: 'OVERPAY_NOT_ALLOWED' });
  });

  test('registerPayment allows manager overpay only with an override reason', async () => {
    const repo = setupRepository({ paid: '95.00' });

    await expect(repo.registerPayment({
      clientCode: 'C001',
      amount: 10,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
      allowOverpay: true,
      idempotencyToken: 'cobro-token-manager-overpay-001',
    })).rejects.toMatchObject({ code: 'OVERRIDE_REASON_REQUIRED' });

    const allowed = await repo.registerPayment({
      clientCode: 'C001',
      amount: 10,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
      allowOverpay: true,
      overrideReason: 'Regularizacion autorizada',
      idempotencyToken: 'cobro-token-manager-overpay-002',
    });

    expect(allowed.status).toBe('SOBRECOBRADO');
    expect(allowed.pendingAfter).toBe(-5);
  });

  test('registerPayment blocks commercial access to another vendor order', async () => {
    const repo = setupRepository({ order: orderRow({ CODIGOVENDEDOR: '02' }) });

    await expect(repo.registerPayment({
      clientCode: 'C001',
      amount: 10,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      userId: '01',
      userRole: 'COMERCIAL',
      idempotencyToken: 'cobro-token-authz-001',
    })).rejects.toMatchObject({ code: 'FORBIDDEN_CLIENT_VENDOR' });
  });
});
