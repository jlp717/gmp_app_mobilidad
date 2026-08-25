'use strict';
const express = require('express');
const request = require('supertest');
const { RepartoPersistenceError } = require('../services/reparto-confirmation-service');
const { EvidenceError } = require('../services/delivery-evidence-service');
const { networkOptimizer, responseCoalescing } = require('../middleware/network-optimizer');
let mockUser = { id: 'R1', code: 'R1', role: 'REPARTIDOR', repartidorCodes: ['R1'] };
jest.mock('../middleware/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: jest.fn().mockResolvedValue({ messageId: 'm1' }),
  generateDeliveryEmailHtml: jest.fn().mockReturnValue('<p>nota</p>'),
}));
jest.mock('../services/whatsappGatewayService', () => ({
  isBotConfigured: jest.fn().mockReturnValue(false),
  isBotReady: jest.fn().mockReturnValue(false),
  sendDocumentFromBot: jest.fn(),
  baileys: { isConfigured: jest.fn().mockReturnValue(false) },
  cloud: { isConfigured: jest.fn().mockReturnValue(false) },
}));
jest.mock('../middleware/auth', () => ({ verifyToken: (req, _res, next) => { req.user = mockUser; next(); }, requireRoles: () => (_req, _res, next) => next() }));
jest.mock('../services/repartidor-finance-service', () => ({}));
jest.mock('../services/redis-cache', () => ({ deleteCachePattern: jest.fn(), invalidateCache: jest.fn() }));
const routes = require('../routes/repartidor-finanzas');
const sig = `ev_${'a'.repeat(64)}`;
function app() { const value = express(); value.use(express.json()); value.use('/finanzas', routes); return value; }
function productionMountedApp() { const value = express(); value.use(networkOptimizer); value.use(responseCoalescing); value.use('/api/repartidor-finanzas', routes); return value; }
function receipt() { return { confirmationId: '7', repartidorId: 'R1', firmaEvidenceId: sig, lineas: [{ cantidadPedida: 1, cantidadEntregada: 1, cantidadRechazada: 0, cantidadPendiente: 0, precioUnitario: 1 }], cliente: {}, receptor: {}, incidencia: {} }; }
function inject(overrides = {}) { routes.setCanonicalConfirmationRuntime({ catalogService: { validateConfirmation: jest.fn() }, confirmationService: { confirm: jest.fn() }, receiptService: { getReceipt: overrides.getReceipt || jest.fn().mockResolvedValue(receipt()) }, evidenceService: { stageSignature: jest.fn(), stagePhoto: jest.fn(), retrieve: overrides.retrieve || jest.fn().mockResolvedValue({ kind: 'FIRMA', contentBase64: 'iVBORw0KGgo=' }) }, receiptPdfService: { render: overrides.render || jest.fn().mockResolvedValue({ pdf: Buffer.from('%PDF-1.4'), fileName: 'RECIBO_REPARTO_7.pdf' }) }, recordDocumentEmailLedger: overrides.recordDocumentEmailLedger || jest.fn().mockResolvedValue(undefined) }); }
afterEach(() => { mockUser = { id: 'R1', code: 'R1', role: 'REPARTIDOR', repartidorCodes: ['R1'] }; routes.resetCanonicalConfirmationRuntime(); routes.setCanonicalReceiptTimeoutMs(15000); });
test('GET returns snapshot PDF and private no-store', async () => { const retrieve = jest.fn().mockResolvedValue({ kind: 'FIRMA', contentBase64: 'iVBORw0KGgo=' }); inject({ retrieve }); const res = await request(app()).get('/finanzas/rutero/confirmations/7/receipt'); expect(res.status).toBe(200); expect(res.headers['cache-control']).toBe('private, no-store'); expect(res.body.pdfBase64).toBe(Buffer.from('%PDF-1.4').toString('base64')); expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({ evidenceId: sig, actor: { role: 'REPARTIDOR', repartidorId: 'R1' }, signal: expect.any(AbortSignal) })); });
test('GET supports exactly one canonical idempotency selector without returning the PII snapshot', async () => { const getReceipt = jest.fn().mockResolvedValue(receipt()); inject({ getReceipt }); const res = await request(app()).get('/finanzas/rutero/confirmations/receipt?idempotencyKey=receipt-key-7'); expect(res.status).toBe(200); expect(getReceipt).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'receipt-key-7', signal: expect.any(AbortSignal) })); expect(res.body.receipt).toBeUndefined(); });
test('GET rejects an ambiguous or invalid canonical receipt selector', async () => { inject(); for (const path of ['/finanzas/rutero/confirmations/receipt', '/finanzas/rutero/confirmations/receipt?idempotencyKey=short', '/finanzas/rutero/confirmations/receipt?idempotencyKey=receipt-key-7&confirmationId=7']) { const res = await request(app()).get(path); expect(res.status).toBe(422); expect(res.body.code).toBe('REPARTO_RECEIPT_INVALID_LOOKUP'); } });
test('GET by confirmation id rejects every query selector before receipt service access', async () => { const getReceipt = jest.fn(); inject({ getReceipt }); for (const path of ['/finanzas/rutero/confirmations/7/receipt?idempotencyKey=receipt-key-7', '/finanzas/rutero/confirmations/7/receipt?other=value']) { const res = await request(app()).get(path); expect(res.status).toBe(422); expect(res.body.code).toBe('REPARTO_RECEIPT_INVALID_LOOKUP'); expect(res.headers['cache-control']).toBe('private, no-store'); } expect(getReceipt).not.toHaveBeenCalled(); });
test.each([[null, 401], [{ id: 'C', code: 'C', role: 'COMERCIAL' }, 403]])('requires role', async (actor, status) => { mockUser = actor; const getReceipt = jest.fn(); inject({ getReceipt }); const res = await request(app()).get('/finanzas/rutero/confirmations/7/receipt'); expect(res.status).toBe(status); expect(res.headers['cache-control']).toBe('private, no-store'); expect(getReceipt).not.toHaveBeenCalled(); });
test.each([[404, 'REPARTO_RECEIPT_NOT_FOUND'], [422, 'REPARTO_RECEIPT_INVALID_ID'], [409, 'REPARTO_RECEIPT_PAYMENT_AMBIGUOUS'], [503, 'REPARTO_RECEIPT_VALUATION_UNAVAILABLE']])('maps typed %s', async (status, code) => { const retrieve = jest.fn(); inject({ getReceipt: jest.fn().mockRejectedValue(new RepartoPersistenceError('private DB2 SQL diagnostic', { code, statusCode: status })), retrieve }); const res = await request(app()).get('/finanzas/rutero/confirmations/7/receipt'); expect(res.status).toBe(status); expect(res.headers['cache-control']).toBe('private, no-store'); expect(res.body.code).toBe(code); expect(retrieve).not.toHaveBeenCalled(); if (status >= 500) expect(JSON.stringify(res.body)).not.toMatch(/DB2|SQL|diagnostic/i); });
test('does not retrieve before ownership and sanitizes retrieve failure', async () => { const retrieve = jest.fn(); inject({ getReceipt: jest.fn().mockRejectedValue(new RepartoPersistenceError('No', { code: 'REPARTO_RECEIPT_OWNERSHIP_REQUIRED', statusCode: 403 })), retrieve }); expect((await request(app()).get('/finanzas/rutero/confirmations/7/receipt')).status).toBe(403); expect(retrieve).not.toHaveBeenCalled(); inject({ retrieve: jest.fn().mockRejectedValue(new EvidenceError('EVIDENCE_TIMEOUT', 'private DB2 diagnostic', 504)) }); const res = await request(app()).get('/finanzas/rutero/confirmations/7/receipt'); expect(res.status).toBe(504); expect(JSON.stringify(res.body)).not.toMatch(/DB2|diagnostic/i); });

test('returns a sanitized 504 before a hung receipt dependency resets the socket', async () => { routes.setCanonicalReceiptTimeoutMs(5); inject({ getReceipt: jest.fn(() => new Promise(() => {})) }); const res = await request(app()).get('/finanzas/rutero/confirmations/7/receipt'); expect(res.status).toBe(504); expect(res.body).toMatchObject({ success: false, code: 'REPARTO_RECEIPT_TIMEOUT', error: 'Servicio temporalmente no disponible' }); });

test('passes the same AbortSignal through all successful receipt phases', async () => {
  const signals = [];
  const capture = (value) => jest.fn((input) => {
    signals.push(input.signal);
    return Promise.resolve(value);
  });
  const getReceipt = capture(receipt());
  const retrieve = capture({ kind: 'FIRMA', mimeType: 'image/png', contentBase64: 'iVBORw0KGgo=' });
  const render = capture({ pdf: Buffer.from('%PDF-1.4'), fileName: 'RECIBO_REPARTO_7.pdf' });
  inject({ getReceipt, retrieve, render });

  const res = await request(app()).get('/finanzas/rutero/confirmations/7/receipt');

  expect(res.status).toBe(200);
  expect(signals).toHaveLength(3);
  expect(new Set(signals).size).toBe(1);
  expect(signals[0].aborted).toBe(false);
});

test('one global deadline aborts the shared signal while evidence retrieval is blocked', async () => {
  routes.setCanonicalReceiptTimeoutMs(25);
  const signals = [];
  const getReceipt = jest.fn((input) => {
    signals.push(input.signal);
    return Promise.resolve(receipt());
  });
  const retrieve = jest.fn((input) => {
    signals.push(input.signal);
    return new Promise(() => {});
  });
  const render = jest.fn();
  inject({ getReceipt, retrieve, render });

  const res = await request(app()).get('/finanzas/rutero/confirmations/7/receipt');

  expect(res.status).toBe(504);
  expect(res.body.code).toBe('REPARTO_RECEIPT_TIMEOUT');
  expect(signals).toHaveLength(2);
  expect(new Set(signals).size).toBe(1);
  expect(signals[0].aborted).toBe(true);
  expect(render).not.toHaveBeenCalled();
});

test('production mount keeps every receipt outcome private no-store and outside shared response caches', async () => {
  const cases = [
    [null, {}, 401],
    [{ id: 'R1', code: 'R1', role: 'REPARTIDOR', repartidorCodes: ['R1'] }, { path: '/rutero/confirmations/7/receipt?other=value' }, 422],
    [{ id: 'R1', code: 'R1', role: 'REPARTIDOR', repartidorCodes: ['R1'] }, { error: new RepartoPersistenceError('No', { code: 'REPARTO_RECEIPT_OWNERSHIP_REQUIRED', statusCode: 403 }) }, 403],
    [{ id: 'R1', code: 'R1', role: 'REPARTIDOR', repartidorCodes: ['R1'] }, { error: new RepartoPersistenceError('No', { code: 'REPARTO_RECEIPT_NOT_FOUND', statusCode: 404 }) }, 404],
    [{ id: 'R1', code: 'R1', role: 'REPARTIDOR', repartidorCodes: ['R1'] }, { error: new RepartoPersistenceError('No', { code: 'REPARTO_RECEIPT_VALUATION_UNAVAILABLE', statusCode: 503 }) }, 503],
  ];
  for (const [actor, outcome, status] of cases) {
    mockUser = actor;
    inject({ getReceipt: outcome.error ? jest.fn().mockRejectedValue(outcome.error) : undefined });
    const response = await request(productionMountedApp())
      .get(`/api/repartidor-finanzas${outcome.path || '/rutero/confirmations/7/receipt'}`);
    expect(response.status).toBe(status);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers['x-cache-status']).toBeUndefined();
    expect(response.headers['x-coalesced']).toBeUndefined();
  }

  mockUser = { id: 'R1', code: 'R1', role: 'REPARTIDOR', repartidorCodes: ['R1'] };
  routes.setCanonicalReceiptTimeoutMs(5);
  inject({ getReceipt: jest.fn(() => new Promise(() => {})) });
  const timeout = await request(productionMountedApp())
    .get('/api/repartidor-finanzas/rutero/confirmations/7/receipt');
  expect(timeout.status).toBe(504);
  expect(timeout.headers['cache-control']).toBe('private, no-store');

  routes.setCanonicalReceiptTimeoutMs(15000);
  const render = jest.fn().mockResolvedValue({ pdf: Buffer.from('%PDF-1.4'), fileName: 'RECIBO_REPARTO_7.pdf' });
  inject({ render });
  const first = await request(productionMountedApp()).get('/api/repartidor-finanzas/rutero/confirmations/7/receipt');
  const second = await request(productionMountedApp()).get('/api/repartidor-finanzas/rutero/confirmations/7/receipt');
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.headers['cache-control']).toBe('private, no-store');
  expect(second.headers['x-cache-status']).toBeUndefined();
  expect(second.headers['x-coalesced']).toBeUndefined();
  expect(render).toHaveBeenCalledTimes(2);
});


test('POST receipt WhatsApp returns a local share intent with the canonical PDF', async () => {
  const render = jest.fn().mockResolvedValue({ pdf: Buffer.from('%PDF-1.4'), fileName: 'NOTA_ENTREGA_7.pdf' });
  inject({ render });
  const res = await request(app())
    .post('/finanzas/rutero/confirmations/7/receipt/whatsapp')
    .send({ telefono: '+34 600 123 456', mensaje: 'Entrega confirmada' });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ success: true, localShare: true, sent: false, fileName: 'NOTA_ENTREGA_7.pdf' });
  expect(res.body.whatsappUrl).toContain('https://wa.me/34600123456');
  expect(res.body.whatsappUrl).toContain(encodeURIComponent('Entrega confirmada'));
  expect(render).toHaveBeenCalled();
});

test('POST receipt WhatsApp rejects an invalid phone before rendering', async () => {
  const render = jest.fn();
  inject({ render });
  const res = await request(app())
    .post('/finanzas/rutero/confirmations/7/receipt/whatsapp')
    .send({ telefono: 'abc' });
  expect(res.status).toBe(422);
  expect(res.body.code).toBe('PHONE_INVALID');
  expect(render).not.toHaveBeenCalled();
});
test('POST receipt email rejects invalid destinatario before rendering', async () => {
  const emailPdf = require('../services/emailPdfService');
  inject();
  emailPdf.sendEmailWithPdf.mockClear();
  const res = await request(app())
    .post('/finanzas/rutero/confirmations/7/receipt/email')
    .send({ destinatario: 'not-an-email' });
  expect(res.status).toBe(422);
  expect(res.body.code).toBe('EMAIL_INVALID');
  expect(emailPdf.sendEmailWithPdf).not.toHaveBeenCalled();
});

test('POST receipt email sends the canonical PDF', async () => {
  const emailPdf = require('../services/emailPdfService');
  inject();
  emailPdf.sendEmailWithPdf.mockClear();
  const res = await request(app())
    .post('/finanzas/rutero/confirmations/7/receipt/email')
    .send({ destinatario: 'cliente@empresa.com' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(emailPdf.sendEmailWithPdf).toHaveBeenCalledWith(expect.objectContaining({
    to: 'cliente@empresa.com',
    pdfFilename: 'RECIBO_REPARTO_7.pdf',
  }));
});
