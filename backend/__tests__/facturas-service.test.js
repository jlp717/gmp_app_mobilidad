'use strict';

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

jest.mock('../config/db', () => ({
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));

jest.mock('../services/redis-cache', () => ({
  redisCache: {
    get: (...args) => mockRedisGet(...args),
    set: (...args) => mockRedisSet(...args),
  },
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const facturasService = require('../services/facturas.service');

const f4306Header = {
  SERIEFACTURA: 'F',
  NUMEROFACTURA: 4306,
  EJERCICIOFACTURA: 2026,
  DIAFACTURA: 30,
  MESFACTURA: 4,
  ANOFACTURA: 2026,
  CODIGOCLIENTE: '4300010400',
  NOMBRECLIENTEFACTURA: 'CANITO COMIDAS',
  NOMBRECOMERCIALFACTURA: 'CANITO COMIDAS',
  NOMBREFISCALFACTURA: 'CANO MARTINEZ ALEJANDRO',
  DIRECCIONCLIENTEFACTURA: 'CL DOCTOR FLEMIN, 2 BAJO',
  POBLACIONCLIENTEFACTURA: 'AGUILAS',
  CIFCLIENTEFACTURA: '23331620Y',
  TOTALFACTURA: 3618.44,
  IMPORTEBASEIMPONIBLE1: 2987.13,
  PORCENTAJEIVA1: 10,
  IMPORTEIVA1: 298.71,
  IMPORTEBASEIMPONIBLE2: 0,
  PORCENTAJEIVA2: 21,
  IMPORTEIVA2: 0,
  IMPORTEBASEIMPONIBLE3: 229.90,
  PORCENTAJEIVA3: 4,
  IMPORTEIVA3: 9.20,
  IMPORTEBASEIMPONIBLE4: 0,
  PORCENTAJEIVA4: 0,
  IMPORTEIVA4: 0,
  IMPORTEBASEIMPONIBLE5: 85,
  PORCENTAJEIVA5: 10,
  IMPORTEIVA5: 8.50,
};

const j1183AlbaranHeader = {
  EJERCICIOALBARAN: 2026,
  SERIEALBARAN: 'J',
  NUMEROALBARAN: 1183,
  TERMINALALBARAN: 93,
  NUMEROFACTURA: 0,
  SERIEFACTURA: '',
  EJERCICIOFACTURA: 0,
  DIAFACTURA: 26,
  MESFACTURA: 6,
  ANOFACTURA: 2026,
  CODIGOCLIENTEFACTURA: '4300001183',
  NOMBRECLIENTEFACTURA: 'CLIENTE ALBARAN',
  NOMBRECOMERCIALFACTURA: 'CLIENTE ALBARAN',
  NOMBREFISCALFACTURA: 'CLIENTE ALBARAN SL',
  DIRECCIONCLIENTEFACTURA: 'CALLE TEST',
  POBLACIONCLIENTEFACTURA: 'MURCIA',
  PROVINCIACLIENTEFACTURA: 'MURCIA',
  CPCLIENTEFACTURA: '30000',
  CIFCLIENTEFACTURA: 'B00000000',
  IMPORTETOTAL: 1172.49,
  IMPORTEBRUTO: 1065.90,
  IMPORTEBASEIMPONIBLE1: 1065.90,
  PORCENTAJEIVA1: 10,
  IMPORTEIVA1: 106.59,
  IMPORTEBASEIMPONIBLE2: 0,
  PORCENTAJEIVA2: 21,
  IMPORTEIVA2: 0,
  IMPORTEBASEIMPONIBLE3: 0,
  PORCENTAJEIVA3: 4,
  IMPORTEIVA3: 0,
  IMPORTEBASEIMPONIBLE4: 0,
  PORCENTAJEIVA4: 0,
  IMPORTEIVA4: 0,
  IMPORTEBASEIMPONIBLE5: 0,
  PORCENTAJEIVA5: 10,
  IMPORTEIVA5: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue(undefined);
});

describe('facturas service fiscal totals', () => {
  test('getFacturaDetail uses official CFC header with all five IVA slots', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CFC\s+CFC/i.test(sql)) return [f4306Header];
      if (/FROM\s+DSEDAC\.LAC\s+LAC/i.test(sql)) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const factura = await facturasService.getFacturaDetail('F', 4306, 2026);

    expect(factura.header.total).toBe(3618.44);
    expect(factura.header.bases).toEqual([
      { base: 2987.13, pct: 10, iva: 298.71 },
      { base: 229.90, pct: 4, iva: 9.20 },
      { base: 85, pct: 10, iva: 8.50 },
    ]);

    const headerSql = mockQueryWithParams.mock.calls[0][0];
    expect(headerSql).toMatch(/FROM\s+DSEDAC\.CFC\s+CFC/i);
    expect(headerSql).toMatch(/IMPORTEBASEIMPONIBLE5/i);
    expect(headerSql).toMatch(/IMPORTEIVA5/i);
    expect(headerSql).not.toMatch(/SUM\(CAC\.IMPORTETOTAL\)/i);
  });

  test('getFacturasRaw reads list amounts from CFC aggregated fiscal columns', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      {
        SERIE: 'F',
        NUMERO: 4306,
        EJERCICIO: 2026,
        DIA: 30,
        MES: 4,
        ANO: 2026,
        CODIGO_CLIENTE: '4300010400',
        NOMBRE_CLIENTE: 'CANITO COMIDAS',
        NOMBRE_COMERCIAL: 'CANITO COMIDAS',
        NOMBRE_FISCAL: 'CANO MARTINEZ ALEJANDRO',
        TOTAL: 3618.44,
        BASE: 3302.03,
        IVA: 316.41,
      },
    ]);

    const facturas = await facturasService.getFacturasRaw({
      vendedorCodes: 'ALL',
      year: 2026,
      docSearch: '4306',
      documentType: 'factura',
    });

    expect(facturas).toHaveLength(1);
    expect(facturas[0]).toMatchObject({
      id: 'F-4306-2026',
      total: 3618.44,
      base: 3302.03,
      iva: 316.41,
    });
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/FROM\s+DSEDAC\.CFC\s+CFC/i);
  });

  test('getFacturasRaw reads unbilled albaranes from CAC with document type', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      {
        DOCUMENT_TYPE: 'albaran',
        SERIE: 'J',
        NUMERO: 1187,
        EJERCICIO: 2026,
        TERMINAL: 93,
        DIA: 29,
        MES: 6,
        ANO: 2026,
        CODIGO_CLIENTE: '4300009588',
        NOMBRE_CLIENTE: 'CASER RESIDENCIAL SANTO ANGEL',
        NOMBRE_COMERCIAL: 'CASER RESIDENCIAL SANTO ANGEL',
        NOMBRE_FISCAL: 'CASER RESIDENCIAL SANTO ANGEL',
        TOTAL: 125.5,
        BASE: 114.09,
        IVA: 11.41,
      },
    ]);

    const docs = await facturasService.getFacturasRaw({
      vendedorCodes: '93',
      year: 2026,
      documentType: 'albaran',
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: 'ALB-2026-J-93-1187',
      documentType: 'albaran',
      tipoDocumento: 'albaran',
      serie: 'J',
      numero: 1187,
      ejercicio: 2026,
      terminal: 93,
      total: 125.5,
    });

    const sql = mockQueryWithParams.mock.calls[0][0];
    expect(sql).toMatch(/FROM\s+DSEDAC\.CAC\s+CAC/i);
    expect(sql).toMatch(/NOT\s*\(\s*CAC\.NUMEROFACTURA\s+>\s+0/i);
    expect(sql).toMatch(/IMPORTEIVA5/i);
  });

  test('getFacturasRaw bounds list queries with OFFSET/FETCH and clamps limit', async () => {
    mockQueryWithParams.mockResolvedValueOnce([]);

    await facturasService.getFacturasRaw({
      vendedorCodes: '02',
      year: 2026,
      limit: 9999,
      offset: -25,
      documentType: 'factura',
    });

    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/OFFSET\s+\?\s+ROWS\s+FETCH\s+NEXT\s+\?\s+ROWS\s+ONLY/i);
    expect(params[params.length - 2]).toBe(0);
    expect(params[params.length - 1]).toBe(500);
  });

  test('getFacturasRaw applies pagination after merging vendor batches', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([
        {
          SERIE: 'F',
          NUMERO: 1,
          EJERCICIO: 2026,
          DIA: 1,
          MES: 1,
          ANO: 2026,
          CODIGO_CLIENTE: 'C01',
          NOMBRE_CLIENTE: 'Cliente viejo',
          TOTAL: 10,
          BASE: 8,
          IVA: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          SERIE: 'F',
          NUMERO: 2,
          EJERCICIO: 2026,
          DIA: 2,
          MES: 1,
          ANO: 2026,
          CODIGO_CLIENTE: 'C02',
          NOMBRE_CLIENTE: 'Cliente nuevo',
          TOTAL: 20,
          BASE: 16,
          IVA: 4,
        },
      ]);

    const facturas = await facturasService.getFacturasRaw({
      vendedorCodes: '01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16',
      year: 2026,
      limit: 1,
      offset: 1,
      documentType: 'factura',
    });

    expect(mockQueryWithParams).toHaveBeenCalledTimes(2);
    for (const call of mockQueryWithParams.mock.calls) {
      const params = call[1];
      expect(params[params.length - 2]).toBe(0);
      expect(params[params.length - 1]).toBe(2);
    }
    expect(facturas).toHaveLength(1);
    expect(facturas[0].numero).toBe(1);
  });

  test('getFacturasRaw includes owned empty-vendor CFC invoices for scoped vendors', async () => {
    mockQueryWithParams.mockResolvedValueOnce([]);

    await facturasService.getFacturasRaw({
      vendedorCodes: '93,97',
      year: 2026,
      documentType: 'factura',
    });

    const sql = mockQueryWithParams.mock.calls[0][0];
    const params = mockQueryWithParams.mock.calls[0][1];
    expect(sql).toMatch(/TRIM\(CFC\.CODIGOVENDEDOR\) IN \(\?,\?\)/);
    expect(sql).toMatch(/CFC\.CODIGOVENDEDOR IS NULL OR TRIM\(CFC\.CODIGOVENDEDOR\) = ''/);
    expect(sql).toMatch(/SELECT DISTINCT TRIM\(OWN\.CODIGOCLIENTE\)/);
    expect(sql).toMatch(/OWN\.EJERCICIOFACTURA = \?/);
    expect(params).toEqual(expect.arrayContaining(['93', '97', 2026]));
  });

  test('getFacturasRaw keeps strict vendor filter for albaranes', async () => {
    mockQueryWithParams.mockResolvedValueOnce([]);

    await facturasService.getFacturasRaw({
      vendedorCodes: '93',
      year: 2026,
      documentType: 'albaran',
    });

    const sql = mockQueryWithParams.mock.calls[0][0];
    expect(sql).toMatch(/TRIM\(CAC\.CODIGOVENDEDOR\) IN \(\?\)/);
    expect(sql).not.toMatch(/SELECT DISTINCT TRIM\(OWN\.CODIGOCLIENTE\)/);
  });

  test('getSummary totals base and IVA from CFC official totals', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      {
        DOCUMENT_TYPE: 'factura',
        NUM_DOCUMENTOS: 1,
        TOTAL: 3618.44,
        BASE: 3302.03,
        IVA: 316.41,
      },
    ]);

    const summary = await facturasService.getSummary({
      vendedorCodes: 'ALL',
      year: 2026,
      documentType: 'factura',
    });

    expect(summary).toEqual({
      totalFacturas: 1,
      totalDocumentos: 1,
      totalFacturasEmitidas: 1,
      totalAlbaranes: 0,
      totalImporte: 3618.44,
      totalBase: 3302.03,
      totalIva: 316.41,
    });
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/FROM\s+DSEDAC\.CFC\s+CFC/i);
    expect(mockRedisSet.mock.calls[0][1]).toMatch(/^facturas:summary:v4:/);
  });

  test('getSummary totals albaran base and all IVA slots from CAC', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      {
        DOCUMENT_TYPE: 'albaran',
        NUM_DOCUMENTOS: 1,
        TOTAL: 711.55,
        BASE: 671.66,
        IVA: 39.89,
      },
    ]);

    const summary = await facturasService.getSummary({
      vendedorCodes: '93',
      year: 2026,
      documentType: 'albaran',
    });

    expect(summary).toEqual({
      totalFacturas: 1,
      totalDocumentos: 1,
      totalFacturasEmitidas: 0,
      totalAlbaranes: 1,
      totalImporte: 711.55,
      totalBase: 671.66,
      totalIva: 39.89,
    });

    const sql = mockQueryWithParams.mock.calls[0][0];
    expect(sql).toMatch(/FROM\s+DSEDAC\.CAC\s+CAC/i);
    expect(sql).toMatch(/IMPORTEIVA5/i);
  });

  test('getAlbaranDetailForPdf resolves standalone albaran from CAC and LAC', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CAC\s+CAC/i.test(sql)) return [j1183AlbaranHeader];
      if (/FROM\s+DSEDAC\.LAC\s+LAC/i.test(sql)) {
        return [
          {
            CODIGOARTICULO: 'ART1',
            DESCRIPCIONARTICULO: 'PRODUCTO UNICO',
            LOTEARTICULO: '',
            CANTIDADARTICULO: 10,
            CAJASARTICULO: 1,
            IMPORTENETOARTICULO: 1065.90,
            CODIGOIVA: '1',
            PORCENTAJERECARGOARTICULO: 0,
            PORCENTAJEDESCUENTOARTICULO: 0,
            PRECIOARTICULO: 106.59,
          },
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const albaran = await facturasService.getAlbaranDetailForPdf('J', 1183, 2026);

    expect(albaran.documentType).toBe('albaran');
    expect(albaran.header).toMatchObject({
      SERIEALBARAN: 'J',
      NUMEROALBARAN: 1183,
      EJERCICIOALBARAN: 2026,
      TERMINALALBARAN: 93,
      total: 1172.49,
      base: 1065.90,
      iva: 106.59,
    });
    expect(albaran.header.bases).toEqual([
      { base: 1065.90, pct: 10, iva: 106.59 },
    ]);
    expect(albaran.header.IVA_BREAKDOWN).toMatchObject({
      BI1: 1065.90,
      IVA1_PCT: 10,
      IVA1_IMP: 106.59,
      BI5: 0,
      IVA5_IMP: 0,
      IMPORTETOTAL: 1172.49,
    });
    expect(albaran.lines).toHaveLength(1);
    expect(albaran.lines[0]).toMatchObject({
      CODIGOARTICULO: 'ART1',
      DESCRIPCIONARTICULO: 'PRODUCTO UNICO',
      IMPORTENETOARTICULO: 1065.90,
      CODIGOIVA: '1',
    });

    const [headerSql, headerParams] = mockQueryWithParams.mock.calls[0];
    expect(headerSql).toMatch(/FROM\s+DSEDAC\.CAC\s+CAC/i);
    expect(headerSql).toMatch(/NOT\s*\(\s*CAC\.NUMEROFACTURA\s+>\s+0/i);
    expect(headerSql).toMatch(/IMPORTEBASEIMPONIBLE5/i);
    expect(headerParams).toEqual([1183, 'J', 2026]);

    const [linesSql, lineParams] = mockQueryWithParams.mock.calls[1];
    expect(linesSql).toMatch(/FROM\s+DSEDAC\.LAC\s+LAC/i);
    expect(lineParams).toEqual([2026, 'J', 93, 1183]);
  });

  test('getAlbaranDetailForPdf can constrain by terminal when caller provides it', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CAC\s+CAC/i.test(sql)) return [j1183AlbaranHeader];
      if (/FROM\s+DSEDAC\.LAC\s+LAC/i.test(sql)) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await facturasService.getAlbaranDetailForPdf('J', 1183, 2026, 93);

    const [headerSql, headerParams] = mockQueryWithParams.mock.calls[0];
    expect(headerSql).toMatch(/CAC\.TERMINALALBARAN\s+=\s+\?/i);
    expect(headerParams).toEqual([1183, 'J', 2026, 93]);
  });

  test('getSummary applies the same search filters as the invoice list', async () => {
    mockQueryWithParams.mockResolvedValueOnce([
      {
        DOCUMENT_TYPE: 'factura',
        NUM_DOCUMENTOS: 1,
        TOTAL: 70.30,
        BASE: 63.91,
        IVA: 6.39,
      },
    ]);

    const summary = await facturasService.getSummary({
      vendedorCodes: 'ALL',
      year: 2026,
      clientSearch: 'chiringuito',
      docSearch: '4306',
      documentType: 'factura',
    });

    expect(summary.totalFacturas).toBe(1);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/LEFT\s+JOIN\s+DSEDAC\.CLI\s+CLI/i);
    expect(sql).toMatch(/UPPER\(COALESCE\(CLI\.NOMBRECLIENTE/i);
    expect(sql).toMatch(/CFC\.NUMEROFACTURA\s+=\s+\?/i);
    expect(params).toEqual([
      2026,
      '%CHIRINGUITO%',
      '%CHIRINGUITO%',
      '%CHIRINGUITO%',
      'CHIRINGUITO%',
      'CHIRINGUITO%',
      4306,
      '4306%',
      '4306%',
    ]);
    expect(mockRedisSet.mock.calls[0][1]).toContain(':CHIRINGUITO:4306');
  });

  test('getSummary coalesces identical concurrent cache misses', async () => {
    mockQueryWithParams.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return [
        {
          DOCUMENT_TYPE: 'factura',
          NUM_DOCUMENTOS: 2,
          TOTAL: 20,
          BASE: 18,
          IVA: 2,
        },
      ];
    });

    const params = {
      vendedorCodes: '93',
      year: 2026,
      documentType: 'factura',
    };
    const [first, second] = await Promise.all([
      facturasService.getSummary(params),
      facturasService.getSummary(params),
    ]);

    expect(first).toEqual(second);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    expect(mockRedisSet).toHaveBeenCalledTimes(1);
  });

  test('getSummary limits many-vendor summary fan-out', async () => {
    let active = 0;
    let maxActive = 0;
    mockQueryWithParams.mockImplementation(async (sql) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      return [
        {
          DOCUMENT_TYPE: /FROM\s+DSEDAC\.CAC\s+CAC/i.test(sql) ? 'albaran' : 'factura',
          NUM_DOCUMENTOS: 1,
          TOTAL: 1,
          BASE: 1,
          IVA: 0,
        },
      ];
    });

    const vendedorCodes = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).join(',');
    const summary = await facturasService.getSummary({
      vendedorCodes,
      year: 2026,
    });

    expect(mockQueryWithParams).toHaveBeenCalledTimes(6);
    expect(maxActive).toBe(1);
    expect(summary).toMatchObject({
      totalDocumentos: 6,
      totalFacturasEmitidas: 3,
      totalAlbaranes: 3,
    });
  });
});
