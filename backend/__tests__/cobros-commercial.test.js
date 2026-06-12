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
  test('getPendingSummary for manager ALL aggregates CVC without joining CLP', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        CLIENTE: ' C001 ',
        NOMBRE: 'Cliente Uno',
        SERIE_DOCUMENTO: 'M',
        NUMERO_DOCUMENTO: 1,
        TOTAL_PENDIENTE: '100.00',
        TOTAL_VENCIDO: '25.50',
      },
      {
        CLIENTE: ' C001 ',
        NOMBRE: 'Cliente Uno',
        SERIE_DOCUMENTO: 'M',
        NUMERO_DOCUMENTO: 2,
        TOTAL_PENDIENTE: '25.50',
        TOTAL_VENCIDO: '0.00',
      },
    ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
    });

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/FROM\s+DSEDAC\.CVC\s+CVC/i);
    expect(sql).not.toMatch(/LEFT\s+JOIN\s+DSEDAC\.CLP/i);
    expect(sql).not.toMatch(/\bJOIN\s+DSEDAC\.CLP/i);
    expect(sql).toMatch(/TRIM\(CVC\.CODIGOCLIENTEALBARAN\)\s*<>\s*''/i);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(result).toEqual({
      summary: {
        C001: { nombre: 'Cliente Uno', total: 125.5, vencido: 25.5, count: 2, estado: 'VENCIDO' },
      },
      grandTotal: 125.5,
      grandTotalVencido: 25.5,
      clientCount: 1,
    });
  });

  test('getPendingSummary subtracts app-side payments only from the matching document', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          CLIENTE: 'C001',
          NOMBRE: 'Cliente Uno',
          SERIE_DOCUMENTO: 'M',
          NUMERO_DOCUMENTO: 1,
          TOTAL_PENDIENTE: '100.00',
          TOTAL_VENCIDO: '100.00',
        },
        {
          CLIENTE: 'C001',
          NOMBRE: 'Cliente Uno',
          SERIE_DOCUMENTO: 'M',
          NUMERO_DOCUMENTO: 2,
          TOTAL_PENDIENTE: '50.00',
          TOTAL_VENCIDO: '0.00',
        },
      ])
      .mockResolvedValueOnce([{ CLIENTE: 'C001', REF: 'CVC:M-2', TOTAL_APP: '50.00' }])
      .mockResolvedValueOnce([]);
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
    });

    expect(result).toEqual({
      summary: {
        C001: { nombre: 'Cliente Uno', total: 100, vencido: 100, count: 1, estado: 'VENCIDO' },
      },
      grandTotal: 100,
      grandTotalVencido: 100,
      clientCount: 1,
    });
  });

  test('getPendingSummary treats documents due today as vencido', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const repo = new Db2CobrosRepository();

    await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
    });

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/<=\s*\(YEAR\(CURRENT_DATE\) \* 10000 \+ MONTH\(CURRENT_DATE\) \* 100 \+ DAY\(CURRENT_DATE\)\)/i);
  });

  test('getPendingSummary for manager ALL scopes to visible vendorCodes', async () => {
    mockQueryWithParams.mockResolvedValueOnce([]);
    const repo = new Db2CobrosRepository();

    await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
      vendorCodes: ['01', '02'],
    });

    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/TRIM\(CLP\.VENDEDORCOMERCIAL\)\s+IN\s*\(\?,\?\)/i);
    expect(sql).not.toMatch(/TRIM\(CVC\.CODIGOCLIENTEALBARAN\)\s*<>\s*''/i);
    expect(params).toEqual(['01', '02']);
  });

  test('getPendingSummary rejects manager selected vendor outside visible scope', async () => {
    const repo = new Db2CobrosRepository();

    await expect(repo.getPendingSummary('03', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
      vendorCodes: ['01', '02'],
    })).rejects.toMatchObject({ code: 'FORBIDDEN_VENDOR' });

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('getPendingSummary for manager selected vendors filters CVC with CLP semi-join', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      { CLIENTE: 'C002', TOTAL_PENDIENTE: '80.00', TOTAL_VENCIDO: '0.00', NUM_DOCS: '1' },
    ]);
    const repo = new Db2CobrosRepository();

    await repo.getPendingSummary('01,02', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
    });

    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/FROM\s+DSEDAC\.CVC\s+CVC/i);
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+DSEDAC\.CLP\s+CLP/i);
    expect(sql).toMatch(/TRIM\(CLP\.CODIGOCLIENTE\)\s*=\s*TRIM\(CVC\.CODIGOCLIENTEALBARAN\)/i);
    expect(sql).toMatch(/TRIM\(CLP\.VENDEDORCOMERCIAL\)\s+IN\s*\(\?,\?\)/i);
    expect(sql).not.toMatch(/LEFT\s+JOIN\s+DSEDAC\.CLP/i);
    expect(params).toEqual(['01', '02']);
  });

  test('getPendingSummary forbids COMERCIAL from ALL and another vendor', async () => {
    const repo = new Db2CobrosRepository();
    const context = { userId: '01', userRole: 'COMERCIAL' };

    await expect(repo.getPendingSummary('ALL', context))
      .rejects.toMatchObject({ code: 'FORBIDDEN_VENDOR' });
    await expect(repo.getPendingSummary('02', context))
      .rejects.toMatchObject({ code: 'FORBIDDEN_VENDOR' });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('getPendientes reads CVC detail and subtracts app-side payments by document', async () => {
    mockQuery.mockResolvedValue([{ 1: 1 }]);
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CVC\s+C/i.test(sql)) {
        return [{
          SERIE_DOCUMENTO: 'M',
          NUMERO_DOCUMENTO: 123,
          XDE: 1,
          CODIGO_CLIENTE: 'C001',
          IMPORTE_TOTAL: 100,
          IMPORTE_COBRADO: 20,
          IMPORTE_PENDIENTE: 80,
          ANO_DOCUMENTO: 2026,
          MES_DOCUMENTO: 6,
          DIA_DOCUMENTO: 1,
          ANO_VENCIMIENTO: 2026,
          MES_VENCIMIENTO: 6,
          DIA_VENCIMIENTO: 30,
          SUBEMPRESA: 'GMP',
          TIPO_DOCUMENTO: 'FAC',
          FORMA_PAGO: '02',
        }];
      }
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [];
      if (/FROM JAVIER\.COBROS/i.test(sql)) return [{ REF: 'CVC:M-123', TOTAL: 30 }];
      return [];
    });
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendientes('C001', {
      userId: '01',
      userRole: 'COMERCIAL',
    });

    expect(result.resumen.source).toBe('CVC');
    expect(result.resumen.totalPendiente).toBe(50);
    expect(result.cobros[0]).toMatchObject({
      tipo: 'factura',
      referencia: 'M-123',
      importeTotal: 100,
      importeCobrado: 50,
      importePendiente: 50,
      descripcion: 'FAC M-123',
    });
    const [cvcSql, params] = mockQueryWithParams.mock.calls.find(([sql]) =>
      /FROM\s+DSEDAC\.CVC\s+C/i.test(sql),
    );
    expect(cvcSql).toMatch(/DSEDAC\.CLP/);
    expect(params).toEqual(['C001', '01']);
  });

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

  test('registerPayment sums previous payments by exact normalized reference only', async () => {
    const repo = setupRepository({ paid: '0.00' });

    await repo.registerPayment({
      clientCode: 'C001',
      amount: 30,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      observations: 'parcial',
      userId: '01',
      userRole: 'COMERCIAL',
      idempotencyToken: 'cobro-token-exact-ref-001',
    });

    const previousPaymentsCall = mockConnQuery.mock.calls.find(([sql]) =>
      /COALESCE\(SUM\(IMPORTE\)/i.test(sql),
    );
    expect(previousPaymentsCall).toBeDefined();
    expect(previousPaymentsCall[0]).not.toMatch(/LIKE/i);
    expect(previousPaymentsCall[1]).toEqual(['C001', 'PEDIDO:22:M-1', 'M-1']);
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

  test('getAppSideCobrosByDoc groups REPARTIDOR_COBROS by raw columns for DB2 prepare', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      { SERIE: 'M', NUMERO: 123, TOTAL: '30.00' },
    ]);
    const repo = new Db2CobrosRepository();

    const adjustments = await repo.getAppSideCobrosByDoc('C001');

    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/GROUP BY SERIEDOCUMENTO, NUMERODOCUMENTO/i);
    expect(sql).not.toMatch(/TRIM\(CAST\(NUMERODOCUMENTO AS VARCHAR/i);
    expect(adjustments.get('M-123')).toBe(30);
  });

  test('registerPayment accepts a real CVC document reference and stores a stable CVC reference', async () => {
    mockQuery.mockResolvedValue([{ 1: 1 }]);
    mockPoolConnect.mockResolvedValue({ query: mockConnQuery, close: mockConnClose });
    mockConnClose.mockResolvedValue(undefined);
    mockConnQuery.mockImplementation(async (sql) => {
      if (/^BEGIN WORK$/i.test(sql) || /^COMMIT$/i.test(sql) || /^ROLLBACK$/i.test(sql)) return [];
      if (/LOCK TABLE JAVIER\.COBROS IN EXCLUSIVE MODE/i.test(sql)) return [];
      if (/FROM JAVIER\.PEDIDOS_CAB PC/i.test(sql)) return [];
      if (/FROM DSEDAC\.CVC C/i.test(sql)) {
        return [{
          ID: 'CVC:M-123',
          SOURCE: 'CVC',
          CODIGOCLIENTE: 'C001',
          CODIGOVENDEDOR: '01',
          SERIEPEDIDO: 'M',
          NUMEROPEDIDO: 123,
          IMPORTETOTAL: '80.00',
          ESTADO: 'PENDIENTE',
        }];
      }
      if (/FROM JAVIER\.COBROS\s+WHERE ID = \?/i.test(sql)) return [];
      if (/COALESCE\(SUM\(IMPORTE\)/i.test(sql)) return [{ TOTAL_COBRADO: '30.00' }];
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: '0.00' }];
      if (/INSERT INTO JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });
    const repo = new Db2CobrosRepository();

    const result = await repo.registerPayment({
      clientCode: 'C001',
      amount: 20,
      paymentMethod: 'CONTADO',
      reference: 'M-123',
      observations: 'parcial CVC',
      userId: '01',
      userRole: 'COMERCIAL',
      idempotencyToken: 'cobro-token-cvc-ref-001',
    });

    expect(result.status).toBe('PARCIAL');
    expect(result.reference).toBe('CVC:M-123');
    expect(result.pendingBefore).toBe(50);
    expect(result.pendingAfter).toBe(30);
    const insertCall = mockConnQuery.mock.calls.find(([sql]) => /INSERT INTO JAVIER\.COBROS/i.test(sql));
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      'cobro-token-cvc-ref-001',
      'C001',
      'CVC:M-123',
      20,
      'CONTADO',
      'COMERCIAL',
      '01',
    ]));
    const repartidorCall = mockConnQuery.mock.calls.find(([sql]) =>
      /FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql) && /TRIM\(SERIEDOCUMENTO\) = \?/i.test(sql),
    );
    expect(repartidorCall).toBeDefined();
    expect(repartidorCall[1]).toEqual(['C001', 'M', '123']);
  });
});
