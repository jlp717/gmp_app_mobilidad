'use strict';

const express = require('express');
const request = require('supertest');

const mockQueryWithParams = jest.fn();
const mockConnQuery = jest.fn();
const mockConnClose = jest.fn();
const mockSendLiquidacionEmail = jest.fn();

let mockAuthUser = {
  id: '72',
  code: '72',
  role: 'COMERCIAL',
  email: 'josemiguel.acacio@mari-pepa.com',
  name: 'Jose Miguel',
};

jest.mock('../config/db', () => ({
  queryWithParams: (...args) => mockQueryWithParams(...args),
  getPool: () => ({
    connect: jest.fn().mockResolvedValue({
      query: (...args) => mockConnQuery(...args),
      close: mockConnClose,
    }),
  }),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, res, next) => {
    if (!req.headers.authorization) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = { ...mockAuthUser };
    next();
  },
}));

jest.mock('../middleware/security', () => ({
  emailLimiter: (req, res, next) => next(),
}));

jest.mock('../services/comercial-liquidacion-pdf.service', () => ({
  buildLiquidacionPdfBuffer: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
  buildLiquidacionEmailPayload: jest.fn(({ vendor, summary, pdfFilename }) => ({
    to: vendor.email,
    subject: `Liquidacion ${summary.date}`,
    pdfFilename,
  })),
}));

jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: (...args) => mockSendLiquidacionEmail(...args),
}));

const comercialLiquidacionService = require('../services/comercial-liquidacion.service');
const comercialLiquidacionRoutes = require('../routes/comercial-liquidaciones');

const REFERENCE = {
  vendorCode: '72',
  date: '2026-06-27',
  liquidacionNumero: 91,
  efectivo: 844.29,
  tarjeta: 568.89,
  totalCobros: 1413.18,
  saldo: -1.69,
  totalAIngresar: 842.6,
  ingresoBanco: 840,
  delta: 2.6,
  email: 'josemiguel.acacio@mari-pepa.com',
  idempotencyKey: 'liq-comercial-20260627-72',
};

function referenceLqdRow(overrides = {}) {
  return {
    NUMEROLIQUIDACION: REFERENCE.liquidacionNumero,
    CODIGOVENDEDOR: '72',
    DIALIQUIDACION: 27,
    MESLIQUIDACION: 6,
    ANOLIQUIDACION: 2026,
    IMPORTEEFECTIVO: '844.29',
    IMPORTETARJETA: '568.89',
    IMPORTECHEQUES: '0',
    IMPORTEPOSTDATADOS: '0',
    IMPORTESALDOACTUAL: '-1.69',
    IMPORTETOTALAINGRESAR: '842.60',
    IMPORTEINGRESOENBANCO: '840.00',
    IDMARCALIQUIDACION: REFERENCE.idempotencyKey,
    ...overrides,
  };
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function mockCounterRows(start = REFERENCE.liquidacionNumero) {
  let next = start;
  return () => [{ NEXT_NUMERO: next++ }];
}

function balancedClosePayload(overrides = {}) {
  const ingresoBanco = overrides.ingresoBanco ?? REFERENCE.ingresoBanco;
  const entregado = overrides.entregado
    ?? roundMoney(REFERENCE.totalAIngresar - ingresoBanco);
  return {
    vendedorId: REFERENCE.vendorCode,
    date: REFERENCE.date,
    idempotencyKey: REFERENCE.idempotencyKey,
    ingresoBanco,
    entregado,
    sendEmail: false,
    totals: {
      efectivo: REFERENCE.efectivo,
      tarjeta: REFERENCE.tarjeta,
      totalCobros: REFERENCE.totalCobros,
      saldoActual: REFERENCE.saldo,
      totalAIngresar: REFERENCE.totalAIngresar,
    },
    ...overrides,
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/comercial-liquidaciones', comercialLiquidacionRoutes);
  return app;
}

describe('Comercial liquidacion service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryWithParams.mockReset();
    mockConnQuery.mockReset();
    const counterRows = mockCounterRows();
    mockConnQuery.mockImplementation(async (sql) => {
      if (/SELECT NEXT_NUMERO/i.test(sql)) return counterRows();
      if (/UPDATE\s+JAVIER\.COBROS_NUMERO_COUNTER/i.test(sql)) return [];
      return [];
    });
    comercialLiquidacionService.resetCloseState?.();
  });

  test('mapLqdSummaryRow maps DSEDAC.LQD row to API contract (ref 72 / 2026-06-27)', () => {
    const summary = comercialLiquidacionService.mapLqdSummaryRow(
      referenceLqdRow(),
      REFERENCE.date,
    );

    expect(summary).toMatchObject({
      vendedorId: '72',
      date: REFERENCE.date,
      liquidacionNumero: REFERENCE.liquidacionNumero,
      efectivo: REFERENCE.efectivo,
      tarjeta: REFERENCE.tarjeta,
      totalCobros: REFERENCE.totalCobros,
      saldoActual: REFERENCE.saldo,
      totalAIngresar: REFERENCE.totalAIngresar,
      ingresoBanco: REFERENCE.ingresoBanco,
      cardDetailAggregateOnly: true,
    });
    expect(summary.deltaBanco).toBeCloseTo(REFERENCE.delta, 2);
    expect(summary.cardPayments).toBeUndefined();
    expect(summary.tarjetaDetalle).toBeUndefined();
  });

  test('mapLqdSummaryRow computes delta as totalAIngresar minus ingresoBanco', () => {
    const summary = comercialLiquidacionService.mapLqdSummaryRow(
      referenceLqdRow(),
      REFERENCE.date,
    );

    expect(summary.deltaBanco).toBeCloseTo(
      summary.totalAIngresar - summary.ingresoBanco,
      2,
    );
    expect(summary.deltaBanco).toBeCloseTo(REFERENCE.delta, 2);
  });

  test('mapLqdSummaryRow derives totalCobros when TOTAL_COBROS_DIA is absent', () => {
    const row = referenceLqdRow();
    delete row.TOTAL_COBROS_DIA;

    const summary = comercialLiquidacionService.mapLqdSummaryRow(row, REFERENCE.date);

    expect(summary.totalCobros).toBeCloseTo(REFERENCE.totalCobros, 2);
    expect(summary.efectivo + summary.tarjeta).toBeCloseTo(
      REFERENCE.totalCobros,
      2,
    );
  });

  test('mapLqdSummaryRow ignores unverified TOTAL_COBROS_DIA when present', () => {
    const summary = comercialLiquidacionService.mapLqdSummaryRow(
      referenceLqdRow({ TOTAL_COBROS_DIA: '999999.99' }),
      REFERENCE.date,
    );

    expect(summary.totalCobros).toBeCloseTo(REFERENCE.totalCobros, 2);
  });

  test('mapLqdSummaryRow tolerates missing LQD row with zero defaults', () => {
    const summary = comercialLiquidacionService.mapLqdSummaryRow({}, REFERENCE.date);

    expect(summary).toMatchObject({
      vendedorId: '',
      liquidacionNumero: 0,
      efectivo: 0,
      tarjeta: 0,
      totalCobros: 0,
      saldoActual: 0,
      totalAIngresar: 0,
      ingresoBanco: 0,
      deltaBanco: 0,
      cardDetailAggregateOnly: true,
    });
  });

  test('mapLqdSummaryRow trims padded CODIGOVENDEDOR from DSEDAC.LQD', () => {
    const summary = comercialLiquidacionService.mapLqdSummaryRow(
      referenceLqdRow({ CODIGOVENDEDOR: ' 72 ' }),
      REFERENCE.date,
    );

    expect(summary.vendedorId).toBe('72');
  });

  test('getDailySummary uses parameterized vendor/date filters against DSEDAC.LQD', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([referenceLqdRow()])
      .mockResolvedValueOnce([{ CORREOELECTRONICO: REFERENCE.email }]);

    const result = await comercialLiquidacionService.getDailySummary({
      vendedorId: REFERENCE.vendorCode,
      date: REFERENCE.date,
    });

    expect(result.summary.efectivo).toBeCloseTo(REFERENCE.efectivo, 2);
    expect(result.summary.tarjeta).toBeCloseTo(REFERENCE.tarjeta, 2);
    expect(result.vendorEmail).toBe(REFERENCE.email);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/DSEDAC\.LQD/i);
    expect(sql).not.toMatch(/TOTAL_COBROS_DIA/i);
    expect(sql).not.toMatch(/\$\{REFERENCE\.vendorCode\}/);
    expect(sql).not.toMatch(/'72'/);
    expect(params).toEqual(expect.arrayContaining([REFERENCE.vendorCode, 27, 6, 2026]));
  });

  test('getObligationSummary scopes DSEDAC.CVC by vendedor', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ COLLECTABLE_CENTS: 12500, REGISTERED_CENTS: 4000 }]);

    const result = await comercialLiquidacionService.getObligationSummary('72', REFERENCE.date);

    expect(result.collectableCents).toBe(12500);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/FROM\s+DSEDAC\.CVC\s+CVC/i);
    expect(sql).toMatch(/DSEDAC\.CLP|DSED\.LACLAE|CODIGOVENDEDOR|VENDEDORCOMERCIAL/i);
    expect(params).toContain('72');
    expect(params.length).toBeGreaterThan(3);
  });

  test('GET /daily-summary returns vendor email from VDDX lookup', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([referenceLqdRow()])
      .mockResolvedValueOnce([{ CORREOELECTRONICO: REFERENCE.email }]);

    const result = await comercialLiquidacionService.getDailySummary({
      vendedorId: REFERENCE.vendorCode,
      date: REFERENCE.date,
    });

    expect(result.vendorEmail).toBe(REFERENCE.email);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(2);
    const emailSql = mockQueryWithParams.mock.calls[1][0];
    expect(emailSql).not.toMatch(/'72'/);
    expect(emailSql).not.toMatch(/EMAIL/i);
    expect(emailSql).toMatch(/VDDX/i);
  });

  test('validateClosePayload accepts balanced reference close payload', () => {
    expect(() => comercialLiquidacionService.validateClosePayload(
      balancedClosePayload({ entregado: REFERENCE.delta }),
    )).not.toThrow();
  });

  test('validateClosePayload rejects invalid calendar date', () => {
    expect(() => comercialLiquidacionService.validateClosePayload({
      vendedorId: '72',
      date: '2026-13-40',
      idempotencyKey: REFERENCE.idempotencyKey,
      ingresoBanco: 840,
      entregado: 2.6,
      totals: { totalAIngresar: 842.6 },
    })).toThrow(/fecha/i);
  });

  test('validateClosePayload rejects malformed date and negative money', () => {
    expect(() => comercialLiquidacionService.validateClosePayload({
      vendedorId: '72',
      date: 'not-a-date',
      idempotencyKey: REFERENCE.idempotencyKey,
      ingresoBanco: 840,
      entregado: 0,
      totals: { totalAIngresar: 842.6 },
    })).toThrow(/fecha/i);

    expect(() => comercialLiquidacionService.validateClosePayload({
      vendedorId: '72',
      date: REFERENCE.date,
      idempotencyKey: REFERENCE.idempotencyKey,
      ingresoBanco: -1,
      entregado: 0,
      totals: { totalAIngresar: 842.6 },
    })).toThrow(/importe|money|negativ/i);

    expect(() => comercialLiquidacionService.validateClosePayload({
      vendedorId: '72',
      date: REFERENCE.date,
      idempotencyKey: REFERENCE.idempotencyKey,
      ingresoBanco: 840,
      entregado: -5,
      totals: { totalAIngresar: 842.6 },
    })).toThrow(/importe|money|negativ/i);
  });

  test('validateClosePayload rejects unbalanced banco plus entregado vs totalAIngresar', () => {
    expect(() => comercialLiquidacionService.validateClosePayload({
      vendedorId: REFERENCE.vendorCode,
      date: REFERENCE.date,
      idempotencyKey: REFERENCE.idempotencyKey,
      ingresoBanco: 100,
      entregado: 0,
      totals: { totalAIngresar: REFERENCE.totalAIngresar },
    })).toThrow(/cuadre|balance|descuadre|diferencia/i);
  });

  test('closeLiquidacion replay with same idempotency token returns created=false', async () => {
    const payload = balancedClosePayload({
      idempotencyKey: `${REFERENCE.idempotencyKey}-service-replay`,
    });

    const first = await comercialLiquidacionService.closeLiquidacion(payload);
    const replay = await comercialLiquidacionService.closeLiquidacion(payload);

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.liquidacion.idempotencyKey).toBe(payload.idempotencyKey);
  });

  test('closeLiquidacion rejects idempotency replay with different payload (409)', async () => {
    const token = `${REFERENCE.idempotencyKey}-service-conflict`;
    await comercialLiquidacionService.closeLiquidacion(balancedClosePayload({
      idempotencyKey: token,
    }));

    await expect(comercialLiquidacionService.closeLiquidacion(balancedClosePayload({
      idempotencyKey: token,
      ingresoBanco: 100,
      entregado: REFERENCE.totalAIngresar - 100,
    }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});

describe('Comercial liquidacion routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
    comercialLiquidacionService.resetCloseState?.();
    mockAuthUser = {
      id: '72',
      code: '72',
      role: 'COMERCIAL',
      email: REFERENCE.email,
      name: 'Jose Miguel',
    };
    mockQueryWithParams.mockReset();
    mockConnQuery.mockReset();
    const counterRows = mockCounterRows();
    mockConnQuery.mockImplementation(async (sql) => {
      if (/SELECT NEXT_NUMERO/i.test(sql)) return counterRows();
      if (/UPDATE\s+JAVIER\.COBROS_NUMERO_COUNTER/i.test(sql)) return [];
      return [];
    });
    mockSendLiquidacionEmail.mockReset();
  });

  test('GET /daily-summary requires auth', async () => {
    const res = await request(app)
      .get('/api/comercial-liquidaciones/daily-summary/72')
      .query({ date: REFERENCE.date });

    expect(res.status).toBe(401);
  });

  test('GET /daily-summary returns mapped summary for authorized comercial', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([referenceLqdRow()])
      .mockResolvedValueOnce([{ CORREOELECTRONICO: REFERENCE.email }]);

    const res = await request(app)
      .get('/api/comercial-liquidaciones/daily-summary/72')
      .set('Authorization', 'Bearer test-token')
      .query({ date: REFERENCE.date });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary).toMatchObject({
      efectivo: REFERENCE.efectivo,
      tarjeta: REFERENCE.tarjeta,
      totalCobros: REFERENCE.totalCobros,
      saldoActual: REFERENCE.saldo,
      totalAIngresar: REFERENCE.totalAIngresar,
      ingresoBanco: REFERENCE.ingresoBanco,
      cardDetailAggregateOnly: true,
    });
    expect(res.body.summary.deltaBanco).toBeCloseTo(REFERENCE.delta, 2);
  });

  test('GET /daily-summary rejects invalid calendar date before DB access', async () => {
    const res = await request(app)
      .get('/api/comercial-liquidaciones/daily-summary/72')
      .set('Authorization', 'Bearer test-token')
      .query({ date: '2026-13-40' });

    expect(res.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /daily-summary rejects invalid date before DB access', async () => {
    const res = await request(app)
      .get('/api/comercial-liquidaciones/daily-summary/72')
      .set('Authorization', 'Bearer test-token')
      .query({ date: 'not-a-date' });

    expect(res.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /daily-summary rejects non-calendar date 2026-02-30 before DB access', async () => {
    const res = await request(app)
      .get('/api/comercial-liquidaciones/daily-summary/72')
      .set('Authorization', 'Bearer test-token')
      .query({ date: '2026-02-30' });

    expect(res.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /daily-summary rejects missing date before DB access', async () => {
    const res = await request(app)
      .get('/api/comercial-liquidaciones/daily-summary/72')
      .set('Authorization', 'Bearer test-token')
      .query({});

    expect(res.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /daily-summary rejects COMERCIAL accessing another vendor', async () => {
    const res = await request(app)
      .get('/api/comercial-liquidaciones/daily-summary/99')
      .set('Authorization', 'Bearer test-token')
      .query({ date: REFERENCE.date });

    expect(res.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /daily-summary includes vendor email when profile row exists', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([referenceLqdRow()])
      .mockResolvedValueOnce([{ CORREOELECTRONICO: REFERENCE.email }]);

    const res = await request(app)
      .get('/api/comercial-liquidaciones/daily-summary/72')
      .set('Authorization', 'Bearer test-token')
      .query({ date: REFERENCE.date });

    expect(res.status).toBe(200);
    expect(res.body.vendorEmail).toBe(REFERENCE.email);
    const emailSql = mockQueryWithParams.mock.calls[1]?.[0] || '';
    expect(emailSql).not.toMatch(/'72'/);
    expect(emailSql).not.toMatch(/EMAIL/i);
    expect(emailSql).toMatch(/VDDX|V_DIM_VENDEDOR/i);
  });

  test('POST /liquidaciones requires auth', async () => {
    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .send(balancedClosePayload());

    expect(res.status).toBe(401);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('POST /liquidaciones rejects COMERCIAL closing for another vendor', async () => {
    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(balancedClosePayload({ vendedorId: '99' }));

    expect(res.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('POST /liquidaciones validates date and money before DB access', async () => {
    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send({
        vendedorId: '72',
        date: 'not-a-date',
        idempotencyKey: REFERENCE.idempotencyKey,
        ingresoBanco: 840,
        entregado: 0,
        totals: { totalAIngresar: 842.6 },
      });

    expect(res.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('POST /liquidaciones rejects negative ingresoBanco before DB access', async () => {
    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(balancedClosePayload({ ingresoBanco: -5 }));

    expect(res.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('POST /liquidaciones rejects unbalanced banco plus entregado before DB access', async () => {
    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(balancedClosePayload({
        ingresoBanco: 100,
        entregado: 0,
      }));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/cuadre|balance|descuadre|diferencia/i);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('POST /liquidaciones creates liquidation on balanced close (ref 72)', async () => {
    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(balancedClosePayload({
        idempotencyKey: `${REFERENCE.idempotencyKey}-happy`,
        sendEmail: false,
      }));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(true);
    expect(res.body.liquidacion).toMatchObject({
      idempotencyKey: `${REFERENCE.idempotencyKey}-happy`,
      vendedorId: REFERENCE.vendorCode,
      ingresoBanco: REFERENCE.ingresoBanco,
    });
    expect(res.body.liquidacion.entregado).toBeCloseTo(REFERENCE.delta, 2);
    expect(res.body.emailWarnings).toEqual([]);
    expect(mockSendLiquidacionEmail).not.toHaveBeenCalled();
  });

  test('POST /liquidaciones closes against COBROS_LIQ without canonical JAVIER.COBROS runtime reads', async () => {
    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(balancedClosePayload({
        idempotencyKey: `${REFERENCE.idempotencyKey}-cobros-liq-contract`,
        sendEmail: false,
      }));

    const sql = [
      ...mockQueryWithParams.mock.calls.map(([text]) => text),
      ...mockConnQuery.mock.calls.map(([text]) => text),
    ].join('\n');

    expect(res.status).toBe(201);
    expect(sql).toMatch(/JAVIER\.COBROS_LIQ\b/i);
    expect(sql).not.toMatch(/\bJAVIER\.COBROS\b/i);
  });

  test('POST /liquidaciones fails fast when DB2 persist fails and does not email', async () => {
    const counterRows = mockCounterRows();
    mockConnQuery.mockImplementation(async (sql) => {
      if (/SELECT NEXT_NUMERO/i.test(sql)) return counterRows();
      if (/UPDATE\s+JAVIER\.COBROS_NUMERO_COUNTER/i.test(sql)) return [];
      if (/INSERT INTO/i.test(sql)) throw new Error('DB2 insert failed');
      return [];
    });

    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(balancedClosePayload({
        idempotencyKey: `${REFERENCE.idempotencyKey}-persist-fail`,
        sendEmail: true,
      }));

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PERSIST_FAILED');
    expect(res.body.error).toBe('No se pudo guardar liquidacion');
    expect(mockSendLiquidacionEmail).not.toHaveBeenCalled();
    expect(mockConnQuery.mock.calls.map(([sql]) => sql).join('\n')).toMatch(/ROLLBACK/);
  });

  test('POST /liquidaciones reserves counter before COBROS_LIQ insert without table lock', async () => {
    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(balancedClosePayload({
        idempotencyKey: `${REFERENCE.idempotencyKey}-lock-order`,
        sendEmail: false,
      }));

    expect(res.status).toBe(201);
    const sqls = mockConnQuery.mock.calls.map(([sql]) => sql);
    const lockIndex = sqls.findIndex((sql) => /LOCK TABLE/i.test(sql));
    const lookupIndex = sqls.findIndex((sql) => /WHERE MARCASINCRONIZACION = \?/i.test(sql));
    const reserveIndex = sqls.findIndex((sql) => /UPDATE\s+JAVIER\.COBROS_NUMERO_COUNTER/i.test(sql));
    const insertIndex = sqls.findIndex((sql) => /INSERT INTO .*COBROS_LIQ/i.test(sql));
    expect(lockIndex).toBe(-1);
    expect(lookupIndex).toBeGreaterThan(-1);
    expect(reserveIndex).toBeGreaterThan(lookupIndex);
    expect(insertIndex).toBeGreaterThan(reserveIndex);
    expect(sqls.join('\n')).not.toMatch(/FINAL TABLE/i);
  });

  test('POST /liquidaciones returns emailWarnings but still succeeds when email fails', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([referenceLqdRow()])
      .mockResolvedValueOnce([{ CORREOELECTRONICO: REFERENCE.email }]);
    const counterRows = mockCounterRows();
    mockConnQuery.mockImplementation(async (sql) => {
      if (/SELECT NEXT_NUMERO/i.test(sql)) return counterRows();
      if (/UPDATE\s+JAVIER\.COBROS_NUMERO_COUNTER/i.test(sql)) return [];
      if (/INSERT INTO/i.test(sql)) return [];
      return [];
    });
    mockSendLiquidacionEmail.mockRejectedValueOnce(new Error('SMTP timeout josemiguel.acacio@mari-pepa.com'));

    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send({
        vendedorId: '72',
        date: REFERENCE.date,
        idempotencyKey: `${REFERENCE.idempotencyKey}-email-fail`,
        ingresoBanco: REFERENCE.ingresoBanco,
        entregado: REFERENCE.delta,
        sendEmail: true,
        totals: {
          efectivo: REFERENCE.efectivo,
          tarjeta: REFERENCE.tarjeta,
          totalCobros: REFERENCE.totalCobros,
          saldoActual: REFERENCE.saldo,
          totalAIngresar: REFERENCE.totalAIngresar,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(true);
    expect(Array.isArray(res.body.emailWarnings)).toBe(true);
    expect(res.body.emailWarnings.length).toBeGreaterThan(0);
    expect(res.body.emailWarnings[0]).toMatchObject({
      success: false,
      code: 'EMAIL_SEND_FAILED',
    });
    expect(JSON.stringify(res.body.emailWarnings)).not.toMatch(/SMTP|timeout|mari-pepa/i);
    expect(res.body.liquidacion).toBeDefined();
    expect(mockSendLiquidacionEmail.mock.calls[0][0].to).toBe(REFERENCE.email);
  });

  test('POST /liquidaciones returns controlled warning when vendor email is missing', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([referenceLqdRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const counterRows = mockCounterRows();
    mockConnQuery.mockImplementation(async (sql) => {
      if (/SELECT NEXT_NUMERO/i.test(sql)) return counterRows();
      if (/UPDATE\s+JAVIER\.COBROS_NUMERO_COUNTER/i.test(sql)) return [];
      return [];
    });

    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(balancedClosePayload({
        idempotencyKey: `${REFERENCE.idempotencyKey}-missing-email`,
        sendEmail: true,
      }));

    expect(res.status).toBe(201);
    expect(res.body.emailWarnings).toEqual([
      { success: false, code: 'MISSING_VENDOR_EMAIL' },
    ]);
    expect(mockSendLiquidacionEmail).not.toHaveBeenCalled();
  });

  test('POST /liquidaciones idempotency replay returns created=false', async () => {
    const row = referenceLqdRow();
    mockQueryWithParams
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row]);
    const counterRows = mockCounterRows();
    mockConnQuery.mockImplementation(async (sql) => {
      if (/SELECT NEXT_NUMERO/i.test(sql)) return counterRows();
      if (/UPDATE\s+JAVIER\.COBROS_NUMERO_COUNTER/i.test(sql)) return [];
      return [];
    });

    const payload = {
      vendedorId: '72',
      date: REFERENCE.date,
      idempotencyKey: `${REFERENCE.idempotencyKey}-route-replay`,
      ingresoBanco: REFERENCE.ingresoBanco,
      entregado: REFERENCE.delta,
      sendEmail: false,
      totals: {
        efectivo: REFERENCE.efectivo,
        tarjeta: REFERENCE.tarjeta,
        totalCobros: REFERENCE.totalCobros,
        saldoActual: REFERENCE.saldo,
        totalAIngresar: REFERENCE.totalAIngresar,
      },
    };

    const first = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(payload);
    const replay = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(payload);

    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);
    expect(replay.status).toBe(200);
    expect(replay.body.created).toBe(false);
  });

  test('POST /liquidaciones idempotency replay does not resend emails', async () => {
    const payload = balancedClosePayload({
      idempotencyKey: `${REFERENCE.idempotencyKey}-no-email-replay`,
      sendEmail: true,
    });
    mockQueryWithParams
      .mockResolvedValueOnce([referenceLqdRow()])
      .mockResolvedValueOnce([{ CORREOELECTRONICO: REFERENCE.email }]);

    const first = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(payload);
    const replay = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(payload);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.created).toBe(false);
    expect(mockSendLiquidacionEmail).toHaveBeenCalledTimes(1);
  });

  test('POST /liquidaciones returns 409 on idempotency conflict', async () => {
    const token = `${REFERENCE.idempotencyKey}-route-conflict`;
    const prime = balancedClosePayload({ idempotencyKey: token });
    await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(prime);

    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(balancedClosePayload({
        idempotencyKey: token,
        ingresoBanco: 100,
        entregado: REFERENCE.totalAIngresar - 100,
      }));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('POST /liquidaciones returns 409 when same idempotencyKey differs in vendedor/date/totals but not ingresoBanco/entregado', async () => {
    mockAuthUser = {
      id: '1',
      code: '1',
      role: 'JEFE_VENTAS',
      email: 'jefe@mari-pepa.com',
      name: 'Jefe Ventas',
    };

    const token = `${REFERENCE.idempotencyKey}-scope-conflict`;
    const ingresoBanco = REFERENCE.ingresoBanco;
    const entregado = REFERENCE.delta;
    const primePayload = balancedClosePayload({ idempotencyKey: token, ingresoBanco, entregado });

    const prime = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(primePayload);
    expect(prime.status).toBe(201);
    expect(prime.body.created).toBe(true);

    const conflict = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send({
        ...primePayload,
        vendedorId: '99',
        date: '2026-06-28',
        totals: {
          efectivo: 500,
          tarjeta: 342.6,
          totalCobros: 842.6,
          saldoActual: 0,
          totalAIngresar: REFERENCE.totalAIngresar,
        },
      });

    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({
      success: false,
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(conflict.body.created).not.toBe(true);
  });

  test('GET /daily-summary adds registeredCobros, obligation and closeability without breaking legacy summary', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.LQD/i.test(sql)) return [referenceLqdRow()];
      if (/VDDX/i.test(sql)) return [{ CORREOELECTRONICO: REFERENCE.email }];
      if (/JAVIER\.COBROS/i.test(sql)) {
        return [{ REGISTERED_CENTS: 4000, COLLECTABLE_CENTS: 12500 }];
      }
      return [];
    });

    const res = await request(app)
      .get('/api/comercial-liquidaciones/daily-summary/72')
      .set('Authorization', 'Bearer test-token')
      .query({ date: REFERENCE.date });

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      efectivo: REFERENCE.efectivo,
      tarjeta: REFERENCE.tarjeta,
      totalCobros: REFERENCE.totalCobros,
      registeredCobros: { registeredCents: 4000 },
      obligation: {
        minimumPercent: 60,
        collectableCents: 12500,
        registeredCents: 4000,
        remainingCents: 3500,
        met: false,
      },
      closeability: {
        canClose: false,
        reasons: expect.arrayContaining(['MINIMUM_OBLIGATION_NOT_MET']),
      },
    });
  });

  test('POST /liquidaciones recalculates totals from registered cobros instead of trusting client totals', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/JAVIER\.COBROS/i.test(sql)) {
        return [{ TOTAL_EFECTIVO: '125.00', TOTAL_TARJETA: '0.00', TOTAL_COBROS: '125.00', TOTAL_A_INGRESAR: '125.00' }];
      }
      if (/FROM\s+DSEDAC\.LQD/i.test(sql)) return [referenceLqdRow({ IMPORTEEFECTIVO: '125.00', IMPORTETARJETA: '0.00', IMPORTETOTALAINGRESAR: '125.00' })];
      if (/VDDX/i.test(sql)) return [{ CORREOELECTRONICO: REFERENCE.email }];
      return [];
    });

    const res = await request(app)
      .post('/api/comercial-liquidaciones')
      .set('Authorization', 'Bearer test-token')
      .send(balancedClosePayload({
        idempotencyKey: `${REFERENCE.idempotencyKey}-recalc-from-cobros`,
        ingresoBanco: 125,
        entregado: 0,
        totals: {
          efectivo: 99999.99,
          tarjeta: 99999.99,
          totalCobros: 99999.99,
          saldoActual: 0,
          totalAIngresar: 99999.99,
        },
      }));

    expect(res.status).toBe(201);
    const insertCall = mockConnQuery.mock.calls.find(([sql]) => /INSERT INTO .*COBROS_LIQ/i.test(sql));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toEqual(expect.arrayContaining([125]));
    expect(insertCall[1]).not.toContain(99999.99);
  });

});
