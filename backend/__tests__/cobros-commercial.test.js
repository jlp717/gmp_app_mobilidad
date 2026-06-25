'use strict';

const crypto = require('crypto');

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

function setupRegisterPaymentMocks({ existingToken = [], paid = '0.00', order = orderRow(), repartidorPaid = '0.00' } = {}) {
  return async (sql) => {
    if (/FROM JAVIER\.PEDIDOS_CAB PC/i.test(sql)) return order ? [order] : [];
    if (/FROM DSEDAC\.CVC C/i.test(sql)) return [];
    if (/FROM JAVIER\.COBROS\s+WHERE ID = \?/i.test(sql)) return existingToken;
    if (/COALESCE\(SUM\(IMPORTE\)/i.test(sql)) return [{ TOTAL_COBRADO: paid }];
    if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: repartidorPaid }];
    if (/INSERT INTO JAVIER\.COBROS/i.test(sql)) return [];
    return [];
  };
}

function setupRepository({ existingToken = [], paid = '0.00', order = orderRow() } = {}) {
  mockQuery.mockResolvedValue([{ 1: 1 }]);
  mockQueryWithParams.mockImplementation(setupRegisterPaymentMocks({ existingToken, paid, order }));
  return new Db2CobrosRepository();
}

function paymentIdForTest(value) {
  return `CBR-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockQueryWithParams.mockReset();
  mockPoolConnect.mockReset();
  mockConnQuery.mockReset();
  mockConnClose.mockReset();
});

describe('Db2CobrosRepository ensureCobrosTable', () => {
  test('rejects typed COBROS_TABLE_UNAVAILABLE and does not issue CREATE TABLE', async () => {
    mockQuery.mockRejectedValueOnce(new Error('SQL0204 Table JAVIER.COBROS not found'));
    const repo = new Db2CobrosRepository();

    await expect(repo.ensureCobrosTable()).rejects.toMatchObject({
      code: 'COBROS_TABLE_UNAVAILABLE',
      status: 503,
      message: 'Servicio de cobros no disponible: tabla de cobros no configurada',
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/SELECT 1 FROM/i);
    expect(mockQuery.mock.calls.some(([sql]) => /CREATE TABLE/i.test(sql))).toBe(false);
  });
});

function mockRepoPendingSummaryDb({
  pageRows = [],
  aggregateRows = null,
  pageCobros = [],
  pageRepartidor = [],
} = {}) {
  const docKey = (row) => `${String(row.SERIE_DOCUMENTO || '').trim()}-${String(row.NUMERO_DOCUMENTO || '').trim()}`;
  const paymentByDoc = new Map();
  const addPayment = (client, reference, amount) => {
    const code = String(client || '').trim();
    const ref = String(reference || '').trim();
    if (!code || !ref) return;
    const match = ref.match(/([^:]+-\d+)$/);
    const key = `${code}|${match ? match[1] : ref}`;
    paymentByDoc.set(key, (paymentByDoc.get(key) || 0) + (parseFloat(amount) || 0));
  };
  pageCobros.forEach((row) => addPayment(row.CLIENTE, row.REF, row.TOTAL_APP));
  pageRepartidor.forEach((row) => addPayment(row.CLIENTE, row.DOC_KEY, row.TOTAL_REP ?? row.TOTAL_APP));
  const clientPageRows = () => {
    const byClient = new Map();
    for (const row of pageRows) {
      const client = String(row.CLIENTE || '').trim();
      if (!client) continue;
      const rawTotal = parseFloat(row.TOTAL_PENDIENTE) || 0;
      const rawVencido = parseFloat(row.TOTAL_VENCIDO) || 0;
      const paid = paymentByDoc.get(`${client}|${docKey(row)}`) || 0;
      const netTotal = Math.max(0, rawTotal - paid);
      if (netTotal <= 0) continue;
      const netVencido = rawVencido > 0 ? Math.min(netTotal, Math.max(0, rawVencido - paid)) : 0;
      const current = byClient.get(client) || {
        CLIENTE: client,
        NOMBRE: row.NOMBRE,
        DOC_COUNT: 0,
        TOTAL_PENDIENTE: 0,
        TOTAL_VENCIDO: 0,
      };
      current.DOC_COUNT += 1;
      current.TOTAL_PENDIENTE += netTotal;
      current.TOTAL_VENCIDO += netVencido;
      byClient.set(client, current);
    }
    return [...byClient.values()].sort((a, b) =>
      (parseFloat(b.TOTAL_PENDIENTE) || 0) - (parseFloat(a.TOTAL_PENDIENTE) || 0) ||
      String(a.CLIENTE || '').localeCompare(String(b.CLIENTE || ''))
    );
  };
  const aggregate = aggregateRows == null
    ? [{ GRAND_TOTAL: pageRows.reduce((sum, row) => sum + (parseFloat(row.TOTAL_PENDIENTE) || 0), 0), GRAND_TOTAL_VENCIDO: pageRows.reduce((sum, row) => sum + (parseFloat(row.TOTAL_VENCIDO) || 0), 0), CLIENT_COUNT: new Set(pageRows.map((row) => String(row.CLIENTE || '').trim()).filter(Boolean)).size, VENCIDO_CLIENT_COUNT: new Set(pageRows.filter((row) => (parseFloat(row.TOTAL_VENCIDO) || 0) > 0).map((row) => String(row.CLIENTE || '').trim()).filter(Boolean)).size }]
    : aggregateRows;
  const routeSql = async (sql) => {
    if (/OFFSET\s+\d+\s+ROWS/i.test(sql)) return clientPageRows();
    if (/WITH\s+PAGE_DOCS/i.test(sql)) {
      if (/\.COBROS/i.test(sql)) return pageCobros;
      if (/REPARTIDOR_COBROS/i.test(sql)) return pageRepartidor;
      return [];
    }
    if (/WITH\s+CVC_DOCS/i.test(sql)) {
      return aggregate.map((row) => ({
        ...row,
        CVC_GRAND_TOTAL: row.CVC_GRAND_TOTAL ?? row.GRAND_TOTAL ?? 0,
        CVC_GRAND_TOTAL_VENCIDO: row.CVC_GRAND_TOTAL_VENCIDO ?? row.GRAND_TOTAL_VENCIDO ?? 0,
        VENCIDO_CLIENT_COUNT: row.VENCIDO_CLIENT_COUNT ?? ((parseFloat(row.GRAND_TOTAL_VENCIDO) || 0) > 0 ? (row.CLIENT_COUNT || 0) : 0),
      }));
    }
    if (/CVC_GRAND_TOTAL/i.test(sql)) {
      const row = aggregate[0] || {};
      return [{
        CVC_GRAND_TOTAL: row.GRAND_TOTAL ?? row.CVC_GRAND_TOTAL ?? 0,
        CVC_GRAND_TOTAL_VENCIDO: row.GRAND_TOTAL_VENCIDO ?? row.CVC_GRAND_TOTAL_VENCIDO ?? 0,
      }];
    }
    return [];
  };
  mockQuery.mockImplementation(routeSql);
  mockQueryWithParams.mockImplementation(routeSql);
}

function findRepoSqlCall(matcher) {
  const call = [...mockQuery.mock.calls, ...mockQueryWithParams.mock.calls].find(([sql]) => matcher(sql));
  return call ? call[0] : '';
}

describe('commercial cobros hardening', () => {
  test('getPendingSummary for manager ALL aggregates CVC without joining CLP', async () => {
    const pageRows = [
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
    ];
    mockRepoPendingSummaryDb({ pageRows });
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
    });

    const sql = findRepoSqlCall((candidate) => /OFFSET\s+\d+\s+ROWS/i.test(candidate));
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
      cvcGrandTotal: 125.5,
      cvcGrandTotalVencido: 25.5,
      appAdjustmentsTotal: 0,
      appOrdersTotal: 0,
      clientCount: 1,
      vencidoClientCount: 1,
      source: 'CVC',
      pagination: { limit: 100, page: 1, offset: 0, returnedDocuments: 1 },
    });
  });

  test('getPendingSummary applies bounded page/offset to full client totals for ALL', async () => {
    mockRepoPendingSummaryDb({
      pageRows: [
        { CLIENTE: 'C001', NOMBRE: 'Cliente Uno', SERIE_DOCUMENTO: 'M', NUMERO_DOCUMENTO: 1, TOTAL_PENDIENTE: '100.00', TOTAL_VENCIDO: '0.00' },
      ],
    });
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
      limit: 25,
      page: 3,
    });

    expect(result.pagination).toEqual({ limit: 25, page: 3, offset: 50, returnedDocuments: 1 });
    const summarySql = findRepoSqlCall((candidate) => /OFFSET\s+50\s+ROWS/i.test(candidate));
    expect(summarySql).toMatch(/CLIENT_NET/i);
    expect(summarySql).toMatch(/ORDER BY\s+C\.TOTAL_PENDIENTE\s+DESC,\s+C\.CLIENTE\s+ASC/i);
    expect(summarySql).toMatch(/OFFSET\s+50\s+ROWS\s+FETCH\s+FIRST\s+25\s+ROWS\s+ONLY/i);
    const pageAdjustmentSql = findRepoSqlCall((candidate) => /WITH\s+PAGE_DOCS/i.test(candidate));
    expect(pageAdjustmentSql).toBe('');
    const totalsSql = findRepoSqlCall((candidate) => /WITH\s+CVC_DOCS/i.test(candidate) && /AS\s+GRAND_TOTAL/i.test(candidate));
    expect(totalsSql).toBeTruthy();
    expect(totalsSql).toMatch(/COUNT\(DISTINCT CASE WHEN NET_TOTAL > 0 THEN CLIENTE ELSE NULL END\)\s+AS\s+CLIENT_COUNT/i);
    expect(totalsSql).toMatch(/VENCIDO_CLIENT_COUNT/i);
    expect(totalsSql).not.toMatch(/ORDER BY\s+TOTAL_PENDIENTE/i);
  });

  test('getPendingSummary derives page from explicit offset and skips blank client rows', async function () {
    mockRepoPendingSummaryDb({
      pageRows: [
        { CLIENTE: '   ', NOMBRE: '', SERIE_DOCUMENTO: 'O', NUMERO_DOCUMENTO: 999, TOTAL_PENDIENTE: '999999.99', TOTAL_VENCIDO: '999999.99' },
        { CLIENTE: 'C001', NOMBRE: 'Cliente Uno', SERIE_DOCUMENTO: 'M', NUMERO_DOCUMENTO: 1, TOTAL_PENDIENTE: '100.00', TOTAL_VENCIDO: '0.00' },
      ],
      aggregateRows: [{ GRAND_TOTAL: '100.00', GRAND_TOTAL_VENCIDO: '0.00', CLIENT_COUNT: 1 }],
    });
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
      limit: 25,
      offset: 50,
    });

    expect(result.pagination).toEqual({ limit: 25, page: 3, offset: 50, returnedDocuments: 1 });
    expect(Object.keys(result.summary)).toEqual(['C001']);
    expect(result.summary.C001).toEqual({ nombre: 'Cliente Uno', total: 100, vencido: 0, count: 1, estado: 'PENDIENTE' });
    expect(result.grandTotal).toBe(100);
    expect(result.grandTotalVencido).toBe(0);
    const summarySql = findRepoSqlCall((candidate) => /OFFSET\s+50\s+ROWS/i.test(candidate));
    expect(summarySql).toMatch(/OFFSET\s+50\s+ROWS\s+FETCH\s+FIRST\s+25\s+ROWS\s+ONLY/i);
  });

  test('getPendingSummary subtracts app-side payments only from the matching document', async () => {
    const pageRows = [
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
    ];
    mockRepoPendingSummaryDb({
      pageRows,
      pageCobros: [{ CLIENTE: 'C001', REF: 'CVC:M-2', TOTAL_APP: '50.00' }],
      aggregateRows: [{ GRAND_TOTAL: '100.00', GRAND_TOTAL_VENCIDO: '100.00', CLIENT_COUNT: 1 }],
    });
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
      cvcGrandTotal: 100,
      cvcGrandTotalVencido: 100,
      appAdjustmentsTotal: 0,
      appOrdersTotal: 0,
      clientCount: 1,
      vencidoClientCount: 1,
      source: 'CVC',
      pagination: { limit: 100, page: 1, offset: 0, returnedDocuments: 1 },
    });
  });

  test('getPendingSummary grandTotal aggregates full portfolio across pagination', async () => {
    mockRepoPendingSummaryDb({
      pageRows: [
        { CLIENTE: 'C001', NOMBRE: 'Cliente Uno', SERIE_DOCUMENTO: 'M', NUMERO_DOCUMENTO: 1, TOTAL_PENDIENTE: '100.00', TOTAL_VENCIDO: '0.00' },
      ],
      aggregateRows: [
        { GRAND_TOTAL: '300.00', GRAND_TOTAL_VENCIDO: '50.00', CLIENT_COUNT: 2 },
      ],
    });
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
      limit: 1,
      page: 1,
    });

    expect(result.summary).toEqual({
      C001: { nombre: 'Cliente Uno', total: 100, vencido: 0, count: 1, estado: 'PENDIENTE' },
    });
    expect(result.grandTotal).toBe(300);
    expect(result.grandTotalVencido).toBe(50);
    expect(result.clientCount).toBe(2);
    expect(result.cvcGrandTotal).toBe(300);
    expect(result.cvcGrandTotalVencido).toBe(50);
    expect(result.appOrdersTotal).toBe(0);
    const cvcRawSql = findRepoSqlCall((candidate) => /CVC_GRAND_TOTAL/i.test(candidate));
    expect(cvcRawSql).toMatch(/FROM\s+DSEDAC\.CVC\s+CVC/i);
    const portfolioTotalsSql = findRepoSqlCall((candidate) => /WITH\s+CVC_DOCS/i.test(candidate) && /AS\s+GRAND_TOTAL/i.test(candidate));
    expect(portfolioTotalsSql).toBeTruthy();
  });

  test('getPendingSummary uses aggregate-only totals query across pagination', async () => {
    mockRepoPendingSummaryDb({
      pageRows: [
        { CLIENTE: 'C001', SERIE_DOCUMENTO: 'M', NUMERO_DOCUMENTO: 1, TOTAL_PENDIENTE: '100.00', TOTAL_VENCIDO: '0.00' },
      ],
      aggregateRows: [{ GRAND_TOTAL: '300.00', GRAND_TOTAL_VENCIDO: '50.00', CLIENT_COUNT: 2 }],
    });
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
      limit: 1,
      page: 1,
    });

    expect(result.grandTotal).toBe(300);
    expect(result.grandTotalVencido).toBe(50);
    expect(result.clientCount).toBe(2);
    const totalsSql = findRepoSqlCall((candidate) => /WITH\s+CVC_DOCS/i.test(candidate) && /AS\s+GRAND_TOTAL/i.test(candidate));
    expect(totalsSql).toMatch(/SELECT\s+COALESCE\(SUM\(NET_TOTAL\),\s*0\)\s+AS\s+GRAND_TOTAL/i);
    expect(totalsSql).toMatch(/COUNT\(DISTINCT CASE WHEN NET_TOTAL > 0 THEN CLIENTE ELSE NULL END\)\s+AS\s+CLIENT_COUNT/i);
    expect(totalsSql).toMatch(/CVC_GRAND_TOTAL/i);
  });

  test('getPendingSummary treats documents due today as vencido', async () => {
    mockRepoPendingSummaryDb();
    const repo = new Db2CobrosRepository();

    await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
    });

    const sql = findRepoSqlCall((candidate) => /FROM\s+DSEDAC\.CVC\s+CVC/i.test(candidate));
    expect(sql).toMatch(/<=\s*\(YEAR\(CURRENT_DATE\) \* 10000 \+ MONTH\(CURRENT_DATE\) \* 100 \+ DAY\(CURRENT_DATE\)\)/i);
  });

  test('getPendingSummary for manager ALL scopes to visible vendorCodes', async () => {
    mockRepoPendingSummaryDb();
    const repo = new Db2CobrosRepository();

    await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
      vendorCodes: ['01', '02'],
    });

    const sql = findRepoSqlCall((candidate) => /OFFSET\s+\d+\s+ROWS/i.test(candidate));
    expect(sql).toMatch(/TRIM\(CLP\.VENDEDORCOMERCIAL\)\s+IN\s*\(/i);
    expect(sql).toMatch(/IN\s*\('01','1','02','2'\)/i);
    expect(sql).not.toMatch(/TRIM\(CVC\.CODIGOCLIENTEALBARAN\)\s*<>\s*''/i);
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
    mockRepoPendingSummaryDb({
      pageRows: [
        { CLIENTE: 'C002', NOMBRE: 'Cliente Dos', SERIE_DOCUMENTO: 'M', NUMERO_DOCUMENTO: 1, TOTAL_PENDIENTE: '80.00', TOTAL_VENCIDO: '0.00' },
      ],
    });
    const repo = new Db2CobrosRepository();

    await repo.getPendingSummary('01,02', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
    });

    const sql = findRepoSqlCall((candidate) => /OFFSET\s+\d+\s+ROWS/i.test(candidate));
    expect(sql).toMatch(/FROM\s+DSEDAC\.CVC\s+CVC/i);
    expect(sql).toMatch(/TRIM\(CVC\.CODIGOCLIENTEALBARAN\)\s+IN\s*\(/i);
    expect(sql).toMatch(/SELECT\s+TRIM\(CLP\.CODIGOCLIENTE\)\s+FROM\s+DSEDAC\.CLP\s+CLP/i);
    expect(sql).toMatch(/UNION\s+SELECT\s+DISTINCT\s+TRIM\(LAC\.LCCDCL\)/i);
    expect(sql).toMatch(/TRIM\(CLP\.VENDEDORCOMERCIAL\)\s+IN\s*\(/i);
    expect(sql).toMatch(/IN\s*\('01','1','02','2'\)/i);
    expect(sql).not.toMatch(/LEFT\s+JOIN\s+DSEDAC\.CLP/i);
  });

  test('getPendingSummary for large manager scope avoids ODBC bind limit', async () => {
    mockRepoPendingSummaryDb();
    const repo = new Db2CobrosRepository();
    const vendorCodes = [
      '95', '02', '03', '27', '05', '18', '25', '10', '97', '13',
      '43', '16', '56', '19', '59', '44', '49', '22', '98', '33',
      '34', '26', '21', 'A3', '93', '94', '47', '01', '15', '36',
      '64', '48', '81', 'V1', '41', '37', '70', '75', '72', '65',
      '62', '80', '73', '83', '84', '85', '89', '66', '46', '74',
      'CD', '86', '79', '38', '87', '57', '67', '09', '00', '53',
      'V2', '51', '42', 'A2', '90', 'A4', '68', '50', '23', '08',
      '14', '17', '30', '31', '32', '92', '24', '28', '35', '39',
      'ZD', 'ZB', 'ZE', 'Z7', '88', '96', 'A5', 'A6', 'A7', '82',
      '20', 'UNK',
    ];

    await repo.getPendingSummary(vendorCodes.join(','), {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
      vendorCodes,
    });

    const sql = findRepoSqlCall((candidate) => /OFFSET\s+\d+\s+ROWS/i.test(candidate));
    expect(sql).toMatch(/TRIM\(CLP\.VENDEDORCOMERCIAL\)\s+IN\s*\('[^']+'/i);
    expect(sql).toMatch(/'UNK'/);
    expect(sql).not.toMatch(/TRIM\(CLP\.VENDEDORCOMERCIAL\)\s+IN\s*\([^)]*\?/i);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('getPendingSummary embeds three-character vendor sentinels to avoid DB2 truncation', async () => {
    mockRepoPendingSummaryDb();
    const repo = new Db2CobrosRepository();

    await repo.getPendingSummary('UNK', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
    });

    const sql = findRepoSqlCall((candidate) => /OFFSET\s+\d+\s+ROWS/i.test(candidate));
    expect(sql).toMatch(/TRIM\(CLP\.VENDEDORCOMERCIAL\)\s+IN\s*\('UNK'\)/i);
    expect(sql).not.toMatch(/TRIM\(CLP\.VENDEDORCOMERCIAL\)\s+IN\s*\([^)]*\?/i);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
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

  test('getPendientes subtracts repartidor collections from pending total', async () => {
    mockQuery.mockResolvedValue([{ 1: 1 }]);
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CVC\s+C/i.test(sql)) {
        return [{
          SERIE_DOCUMENTO: 'M',
          NUMERO_DOCUMENTO: 9,
          XDE: 1,
          CODIGO_CLIENTE: 'C001',
          IMPORTE_TOTAL: 100,
          IMPORTE_COBRADO: 0,
          IMPORTE_PENDIENTE: 100,
          ANO_DOCUMENTO: 2026,
          MES_DOCUMENTO: 6,
          DIA_DOCUMENTO: 1,
          ANO_VENCIMIENTO: 2026,
          MES_VENCIMIENTO: 6,
          DIA_VENCIMIENTO: 30,
          SUBEMPRESA: 'GMP',
          TIPO_DOCUMENTO: 'FAC',
          FORMA_PAGO: '01',
        }];
      }
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql)) {
        return [{ SERIE: 'M', NUMERO: 9, TOTAL: 25.28 }];
      }
      if (/FROM JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendientes('C001', {
      userId: '93',
      userRole: 'COMERCIAL',
      vendorCodes: ['93'],
    });

    expect(result.resumen.totalPendiente).toBeCloseTo(74.72, 2);
    expect(result.cobros[0].importePendiente).toBeCloseTo(74.72, 2);
    expect(result.cobros[0].cobradoPorRepartidor).toBe(true);
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
    expect(cvcSql).toMatch(/DSED\.LACLAE/);
    expect(cvcSql).toMatch(/IN\s*\('01','1'\)/i);
    expect(params).toEqual(['C001']);
  });

  test('getPendientes groups duplicate CVC rows by document reference', async () => {
    mockQuery.mockResolvedValue([{ 1: 1 }]);
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CVC\s+C/i.test(sql)) {
        return [
          {
            SERIE_DOCUMENTO: 'M',
            NUMERO_DOCUMENTO: 123,
            XDE: 1,
            CODIGO_CLIENTE: 'C001',
            IMPORTE_TOTAL: 60,
            IMPORTE_COBRADO: 0,
            IMPORTE_PENDIENTE: 60,
            ANO_DOCUMENTO: 2026,
            MES_DOCUMENTO: 6,
            DIA_DOCUMENTO: 1,
            ANO_VENCIMIENTO: 2026,
            MES_VENCIMIENTO: 6,
            DIA_VENCIMIENTO: 1,
            SUBEMPRESA: 'GMP',
            TIPO_DOCUMENTO: 'FAC',
            FORMA_PAGO: '02',
          },
          {
            SERIE_DOCUMENTO: 'M',
            NUMERO_DOCUMENTO: 123,
            XDE: 1,
            CODIGO_CLIENTE: 'C001',
            IMPORTE_TOTAL: 40,
            IMPORTE_COBRADO: 0,
            IMPORTE_PENDIENTE: 40,
            ANO_DOCUMENTO: 2026,
            MES_DOCUMENTO: 6,
            DIA_DOCUMENTO: 1,
            ANO_VENCIMIENTO: 2026,
            MES_VENCIMIENTO: 7,
            DIA_VENCIMIENTO: 1,
            SUBEMPRESA: 'GMP',
            TIPO_DOCUMENTO: 'FAC',
            FORMA_PAGO: '02',
          },
        ];
      }
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [];
      if (/FROM JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendientes('C001', {
      userId: '01',
      userRole: 'COMERCIAL',
    });

    expect(result.resumen.totalPendiente).toBe(100);
    expect(result.cobros).toHaveLength(1);
    expect(result.cobros[0]).toMatchObject({
      referencia: 'M-123',
      importeTotal: 100,
      importePendiente: 100,
      estado: 'VENCIDO',
    });
  });

  test('getPendientes merges CVC debt with provisional app orders', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/QSYS2\.SYSCOLUMNS2/i.test(sql)) return [{ COLUMN_NAME: 'ORIGEN' }];
      return [{ 1: 1 }];
    });
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CVC\s+C/i.test(sql)) {
        return [{
          SERIE_DOCUMENTO: 'M',
          NUMERO_DOCUMENTO: 123,
          XDE: 1,
          CODIGO_CLIENTE: 'C001',
          IMPORTE_TOTAL: 40,
          IMPORTE_COBRADO: 0,
          IMPORTE_PENDIENTE: 40,
          ANO_DOCUMENTO: 2026,
          MES_DOCUMENTO: 6,
          DIA_DOCUMENTO: 1,
          ANO_VENCIMIENTO: 2026,
          MES_VENCIMIENTO: 7,
          DIA_VENCIMIENTO: 1,
          SUBEMPRESA: 'GMP',
          TIPO_DOCUMENTO: 'FAC',
          FORMA_PAGO: '02',
        }];
      }
      if (/FROM\s+JAVIER\.PEDIDOS_CAB\s+PC/i.test(sql)) {
        return [{
          ID: 22,
          EJERCICIO: 2026,
          SERIEPEDIDO: 'M',
          NUMEROPEDIDO: 7,
          DIADOCUMENTO: 23,
          MESDOCUMENTO: 6,
          ANODOCUMENTO: 2026,
          IMPORTETOTAL: 30,
          TIPOVENTA: 'CC',
          ESTADO: 'CONFIRMADO',
        }];
      }
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [];
      if (/FROM JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });
    const repo = new Db2CobrosRepository();

    const result = await repo.getPendientes('C001', {
      userId: '01',
      userRole: 'COMERCIAL',
    });

    expect(result.resumen.totalPendiente).toBe(70);
    expect(result.resumen.source).toBe('CVC+PEDIDOS_CAB');
    expect(result.resumen.pedidosApp).toEqual({ cantidad: 1, total: 30 });
    expect(result.cobros.map((cobro) => cobro.tipo)).toEqual(['factura', 'pedido_app']);
    expect(result.cobros[1]).toMatchObject({
      id: 'PEDIDO:22:M-7',
      referencia: 'M-7',
      provisional: true,
      importePendiente: 30,
      docKey: { source: 'PEDIDOS_CAB', id: 22, serie: 'M', numero: 7 },
    });
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
    const insertCall = mockQueryWithParams.mock.calls.find(([sql]) => /INSERT INTO JAVIER\.COBROS/i.test(sql));
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

  test('registerPayment does not use LOCK TABLE or manual pool transaction', async () => {
    const repo = setupRepository({ paid: '0.00' });

    await repo.registerPayment({
      clientCode: 'C001',
      amount: 30,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      observations: 'sin lock',
      userId: '01',
      userRole: 'COMERCIAL',
      idempotencyToken: 'cobro-token-no-lock-001',
    });

    expect(mockPoolConnect).not.toHaveBeenCalled();
    const allSql = [
      ...mockQuery.mock.calls.map(([sql]) => sql),
      ...mockQueryWithParams.mock.calls.map(([sql]) => sql),
    ];
    expect(allSql.some((sql) => /LOCK TABLE/i.test(sql))).toBe(false);
    expect(allSql.some((sql) => /^BEGIN WORK$/i.test(sql))).toBe(false);
    expect(allSql.some((sql) => /^COMMIT$/i.test(sql))).toBe(false);
  });

  test('registerPayment stores a DB2-safe ID and the idempotency token separately', async () => {
    const token = 'cobro-token-exceeds-db2-id-length-000001';
    const expectedId = paymentIdForTest(token);
    const repo = setupRepository({ paid: '0.00' });

    await repo.registerPayment({
      clientCode: 'C001',
      amount: 30,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      observations: 'parcial',
      userId: '01',
      userRole: 'COMERCIAL',
      idempotencyToken: token,
    });

    const lookupCall = mockQueryWithParams.mock.calls.find(([sql]) => /FROM JAVIER\.COBROS\s+WHERE ID = \? OR IDEMPOTENCY_TOKEN = \?/i.test(sql));
    expect(lookupCall[1]).toEqual([expectedId, token]);
    const insertCall = mockQueryWithParams.mock.calls.find(([sql]) => /INSERT INTO JAVIER\.COBROS/i.test(sql));
    expect(insertCall[0]).toContain('IDEMPOTENCY_TOKEN');
    expect(insertCall[1][0]).toBe(expectedId);
    expect(insertCall[1][0].length).toBeLessThanOrEqual(36);
    expect(insertCall[1][10]).toBe(token);
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

    const previousPaymentsCall = mockQueryWithParams.mock.calls.find(([sql]) =>
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
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT INTO JAVIER\.COBROS/i.test(sql))).toBe(false);
  });

  test('registerPayment replays idempotency after duplicate insert race', async () => {
    const token = 'cobro-token-race-001';
    const expectedId = paymentIdForTest(token);
    mockQuery.mockResolvedValue([{ 1: 1 }]);
    let insertAttempts = 0;
    mockQueryWithParams.mockImplementation(async (sql, params) => {
      if (/FROM JAVIER\.PEDIDOS_CAB PC/i.test(sql)) return [orderRow()];
      if (/FROM DSEDAC\.CVC C/i.test(sql)) return [];
      if (/FROM JAVIER\.COBROS\s+WHERE ID = \?/i.test(sql)) {
        if (insertAttempts > 0) {
          return [{
            ID: expectedId,
            CODIGO_CLIENTE: 'C001',
            REFERENCIA: 'PEDIDO:22:M-1',
            IMPORTE: '30.00',
            FORMA_PAGO: 'CONTADO',
            CODIGO_USUARIO: '01',
          }];
        }
        return [];
      }
      if (/COALESCE\(SUM\(IMPORTE\)/i.test(sql)) return [{ TOTAL_COBRADO: '0.00' }];
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql)) return [{ TOTAL_REP: '0.00' }];
      if (/INSERT INTO JAVIER\.COBROS/i.test(sql)) {
        insertAttempts += 1;
        throw new Error('SQL0803 Duplicate key on JAVIER.COBROS');
      }
      return [];
    });
    const repo = new Db2CobrosRepository();

    const result = await repo.registerPayment({
      clientCode: 'C001',
      amount: 30,
      paymentMethod: 'CONTADO',
      reference: 'M-1',
      userId: '01',
      userRole: 'COMERCIAL',
      idempotencyToken: token,
    });

    expect(result.idempotent).toBe(true);
    expect(insertAttempts).toBe(1);
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

  test('getAppSideCobrosByDoc groups COBROS by normalized document reference', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      { REF: 'CVC:M-123', TOTAL: '30.00' },
    ]);
    const repo = new Db2CobrosRepository();

    const adjustments = await repo.getAppSideCobrosByDoc('C001');

    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/FROM JAVIER\.COBROS/i);
    expect(sql).toMatch(/GROUP BY TRIM\(REFERENCIA\)/i);
    expect(params).toEqual(['C001']);
    expect(adjustments.get('M-123')).toBe(30);
  });

  test('registerPayment accepts a real CVC document reference and stores a stable CVC reference', async () => {
    mockQuery.mockResolvedValue([{ 1: 1 }]);
    mockQueryWithParams.mockImplementation(async (sql) => {
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
    const insertCall = mockQueryWithParams.mock.calls.find(([sql]) => /INSERT INTO JAVIER\.COBROS/i.test(sql));
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      'cobro-token-cvc-ref-001',
      'C001',
      'CVC:M-123',
      20,
      'CONTADO',
      'COMERCIAL',
      '01',
    ]));
    const repartidorCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql) && /TRIM\(SERIEDOCUMENTO\) = \?/i.test(sql),
    );
    expect(repartidorCall).toBeDefined();
    expect(repartidorCall[1]).toEqual(['C001', 'M', '123']);
  });
});
