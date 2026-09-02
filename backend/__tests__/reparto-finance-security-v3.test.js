'use strict';

const express = require('express');
const request = require('supertest');
const { RepartoPersistenceError } = require('../services/reparto-confirmation-service');
const { createRepartidorLiquidacionService } = require('../services/repartidor-liquidacion-service');

Object.assign(process.env, {
  REPARTO_ENVIRONMENT: 'test', REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24', ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC', REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER', REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false', JWT_ACCESS_SECRET: 'test-jwt-secret-for-testing-only',
  REPARTO_EMAIL_TEST_ALLOWLIST: 'cliente@example.com',
  REPARTO_EMAIL_TEST_SINK: 'cliente@example.com',
});

let mockUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
const mockFinance = {
  getDailySummary: jest.fn(), getSummary: jest.fn(), getSaldoActual: jest.fn(),
};
const mockSendEmailWithPdf = jest.fn();
const mockRecordDocumentEmailLedger = jest.fn();

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { ...mockUser }; next(); },
  requireRoles: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../services/repartidor-finance-service', () => mockFinance);
jest.mock('../services/redis-cache', () => ({
  deleteCachePattern: jest.fn().mockResolvedValue(undefined), invalidateCache: jest.fn(),
}));
jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: mockSendEmailWithPdf,
  generateDeliveryEmailHtml: jest.fn().mockReturnValue('<p>receipt</p>'),
}));
jest.mock('../repositories/repartidor-route-db2-repository', () => ({
  recordDocumentEmailLedger: mockRecordDocumentEmailLedger,
}));

const routes = require('../routes/repartidor-finanzas');
const evidenceId = `ev_${'a'.repeat(64)}`;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function app() {
  const value = express();
  value.use(express.json({ limit: '2mb' }));
  value.use('/finanzas', routes);
  return value;
}

function receipt(overrides = {}) {
  return {
    confirmationId: '7', repartidorId: '94', firmaEvidenceId: null,
    documento: { serie: 'A', numero: 7 }, cliente: {}, lineas: [],
    ...overrides,
  };
}

function inject(overrides = {}) {
  const dependencies = {
    catalogService: { validateConfirmation: jest.fn() },
    confirmationService: { confirm: jest.fn() },
    receiptService: {
      getReceipt: overrides.getReceipt || jest.fn().mockResolvedValue(receipt()),
    },
    evidenceService: {
      stageSignature: overrides.stageSignature || jest.fn(),
      stagePhoto: overrides.stagePhoto || jest.fn(),
      retrieve: overrides.retrieve || jest.fn(),
    },
    receiptPdfService: {
      render: overrides.render || jest.fn().mockResolvedValue({
        pdf: Buffer.from('%PDF-1.4\n%%EOF'), fileName: 'receipt.pdf',
      }),
    },
    recordDocumentEmailLedger: overrides.recordDocumentEmailLedger
      || mockRecordDocumentEmailLedger,
  };
  routes.setCanonicalConfirmationRuntime(dependencies);
  return dependencies;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
  mockFinance.getDailySummary.mockResolvedValue({
    repartidorId: '94,95', summary: { saldoActual: 17.25, status: 'OPEN' },
  });
  mockSendEmailWithPdf.mockResolvedValue({ messageId: 'smtp-1' });
  mockRecordDocumentEmailLedger.mockResolvedValue(undefined);
  routes.resetCanonicalConfirmationRuntime();
  routes.resetCanonicalLiquidacionService();
});

afterEach(() => {
  routes.resetCanonicalConfirmationRuntime();
  routes.resetCanonicalLiquidacionService();
});

test('cuentas uses the identical aggregate daily-summary balance', async () => {
  mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['94', '95'] };
  const daily = await request(app())
    .get('/finanzas/daily-summary/94,95').query({ date: '2026-08-18' });
  const account = await request(app()).get('/finanzas/cuentas/94,95');

  expect(daily.status).toBe(200);
  expect(account.status).toBe(200);
  expect(account.body.cuenta.saldoActual).toBe(daily.body.summary.saldoActual);
  expect(mockFinance.getSaldoActual).not.toHaveBeenCalled();
});

test('JEFE reads one aggregate liquidation ledger while driver multi and foreign scopes fail', async () => {
  const getDayEntries = jest.fn().mockResolvedValue({
    repartidorId: '94,95', date: '2026-08-18', status: 'OPEN',
    expenses: [], adjustments: [], bankDeposits: [],
    totals: { expenses: 0, adjustments: 0, bankDeposits: 0 },
  });
  routes.setCanonicalLiquidacionService({ closeDay: jest.fn(), getDayEntries });
  mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['94', '95'] };
  const aggregate = await request(app())
    .get('/finanzas/liquidaciones/94,95/desglose').query({ date: '2026-08-18' });
  expect(aggregate.status).toBe(200);
  expect(getDayEntries).toHaveBeenCalledWith(
    { repartidorId: '94,95', date: '2026-08-18' },
    { actorId: '7', actorRole: 'JEFE_VENTAS' },
  );

  getDayEntries.mockClear();
  mockUser = { id: '94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
  expect((await request(app()).get('/finanzas/liquidaciones/94,95/desglose')
    .query({ date: '2026-08-18' })).status).toBe(403);
  expect((await request(app()).get('/finanzas/liquidaciones/95/desglose')
    .query({ date: '2026-08-18' })).status).toBe(403);
  expect(getDayEntries).not.toHaveBeenCalled();
});

test('liquidation service aggregates a validated manager code list in one repository call', async () => {
  const transaction = { listStructuredEntries: jest.fn().mockResolvedValue({
    closed: true,
    expenses: [
      { id: '1', repartidorId: '94', date: '2026-08-18', amount: 2,
        category: 'PEAJE', status: 'PENDING', createdAt: '2026-08-18T10:00:00.000Z' },
      { id: '2', repartidorId: '95', date: '2026-08-18', amount: 3,
        category: 'PEAJE', status: 'PENDING', createdAt: '2026-08-18T10:01:00.000Z' },
    ], adjustments: [], bankDeposits: [],
  }) };
  const repository = {
    assertCapabilities: jest.fn().mockResolvedValue(undefined),
    withTransaction: jest.fn(async (work) => work(transaction)),
  };
  const service = createRepartidorLiquidacionService({ repository });
  const result = await service.getDayEntries(
    { repartidorId: '94,95', date: '2026-08-18' },
    { actorId: '7', actorRole: 'JEFE_VENTAS' },
  );
  expect(result).toMatchObject({
    repartidorId: '94,95', status: 'CLOSED', totals: { expenses: 5 },
  });
  expect(transaction.listStructuredEntries).toHaveBeenCalledTimes(1);
  expect(transaction.listStructuredEntries).toHaveBeenCalledWith({
    repartidorId: '94,95', repartidorIds: ['94', '95'], date: '2026-08-18',
  });

  const driverRepository = { ...repository, withTransaction: jest.fn() };
  const driverService = createRepartidorLiquidacionService({ repository: driverRepository });
  await expect(driverService.getDayEntries(
    { repartidorId: '94,95', date: '2026-08-18' },
    { actorId: '94', actorRole: 'REPARTIDOR' },
  )).rejects.toMatchObject({ code: 'LIQUIDACION_ENTRY_FORBIDDEN', statusCode: 403 });
  expect(driverRepository.withTransaction).not.toHaveBeenCalled();
});

test('JEFE evidence requires one selected owner and projects it without a fleet bypass', async () => {
  mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['94'] };
  const stageSignature = jest.fn().mockResolvedValue({
    evidenceId, created: true, idempotent: false,
  });
  inject({ stageSignature });
  const base = {
    documentId: '2026-S-10-404-4300009479',
    signature: `data:image/png;base64,${png.toString('base64')}`,
  };
  for (const repartidorId of [undefined, 'ALL', '94,95']) {
    const response = await request(app()).post('/finanzas/rutero/evidence/signature')
      .send({ ...base, ...(repartidorId ? { repartidorId } : {}) });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('EVIDENCE_REPARTIDOR_REQUIRED');
  }
  expect(stageSignature).not.toHaveBeenCalled();

  const selected = await request(app()).post('/finanzas/rutero/evidence/signature')
    .send({ ...base, repartidorId: '94' });
  expect(selected.status).toBe(201);
  expect(stageSignature).toHaveBeenCalledWith(expect.objectContaining({ repartidorId: '94' }));
});

test('retrieval and receipt reject owner ambiguity before storage and enforce selected ownership', async () => {
  mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['94'] };
  const retrieve = jest.fn().mockResolvedValue({
    evidenceId, kind: 'FOTO', mimeType: 'image/png', contentBase64: png.toString('base64'),
  });
  const getReceipt = jest.fn().mockRejectedValue(new RepartoPersistenceError(
    'foreign', { code: 'REPARTO_RECEIPT_OWNERSHIP_REQUIRED', statusCode: 403 },
  ));
  inject({ retrieve, getReceipt });

  for (const owner of ['ALL', '94,95']) {
    const response = await request(app())
      .get(`/finanzas/rutero/evidence/${evidenceId}`).query({ repartidorId: owner });
    expect(response.status).toBe(422);
  }
  expect(retrieve).not.toHaveBeenCalled();
  const linked = await request(app())
    .get(`/finanzas/rutero/evidence/${evidenceId}`).query({ repartidorId: '94' });
  expect(linked.status).toBe(200);
  expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
    actor: { role: 'JEFE_VENTAS', repartidorId: '94' },
  }));

  const foreign = await request(app())
    .get('/finanzas/rutero/confirmations/7/receipt').query({ repartidorId: '94' });
  expect(foreign.status).toBe(403);
  expect(getReceipt).toHaveBeenCalledWith(expect.objectContaining({
    actor: { role: 'JEFE_VENTAS', repartidorId: '94' },
  }));
});

test('REPARTIDOR foreign owner override is denied before evidence storage', async () => {
  const stageSignature = jest.fn();
  inject({ stageSignature });
  const response = await request(app()).post('/finanzas/rutero/evidence/signature').send({
    documentId: '2026-S-10-404-4300009479', repartidorId: '95',
    signature: `data:image/png;base64,${png.toString('base64')}`,
  });
  expect(response.status).toBe(403);
  expect(response.body.code).toBe('EVIDENCE_OWNERSHIP_REQUIRED');
  expect(stageSignature).not.toHaveBeenCalled();
});

test('receipt email returns 200 only after provider messageId and DOCUMENT_EMAIL ledger', async () => {
  inject();
  const response = await request(app())
    .post('/finanzas/rutero/confirmations/7/receipt/email')
    .send({ destinatario: 'cliente@example.com' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    success: true, messageId: 'smtp-1', ledgerWritten: true,
  });
  expect(mockRecordDocumentEmailLedger).toHaveBeenCalledWith({
    operatorId: '94', ownerId: '94', payloadPreview: 'logicalKey=receipt:7;messageId=smtp-1',
  });
});

test('receipt email has no false 200 or automatic retry when provider or ledger fails', async () => {
  inject();
  mockSendEmailWithPdf.mockResolvedValueOnce({});
  const missingMessage = await request(app())
    .post('/finanzas/rutero/confirmations/7/receipt/email')
    .send({ destinatario: 'cliente@example.com' });
  expect(missingMessage.status).toBe(503);
  expect(missingMessage.body.code).toBe('DOCUMENT_EMAIL_MESSAGE_ID_REQUIRED');
  expect(mockRecordDocumentEmailLedger).not.toHaveBeenCalled();

  mockSendEmailWithPdf.mockClear();
  mockSendEmailWithPdf.mockResolvedValueOnce({ messageId: 'smtp-2' });
  mockRecordDocumentEmailLedger.mockRejectedValueOnce(new Error('ledger down'));
  const missingLedger = await request(app())
    .post('/finanzas/rutero/confirmations/7/receipt/email')
    .send({ destinatario: 'cliente@example.com' });
  expect(missingLedger.status).toBe(503);
  expect(missingLedger.body.code).toBe('EMAIL_DELIVERY_LEDGER_REQUIRED');
  expect(mockSendEmailWithPdf).toHaveBeenCalledTimes(1);
  expect(mockRecordDocumentEmailLedger).toHaveBeenCalledTimes(1);
});
