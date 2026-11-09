'use strict';

const express = require('express');
const request = require('supertest');
jest.mock('../middleware/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }));
jest.mock('../middleware/security', () => ({ bolsaLimiter: (_req, _res, next) => next() }));
jest.mock('../services/bolsa-comercial.service', () => ({}));
// Keep real signed-token verification and claims projection. The isolated session
// port acknowledges fixture sessions without Redis or any production connection.
jest.mock('../src/modules/auth/application/auth-claims-session-store', () => ({
  AuthSessionStoreError: class AuthSessionStoreError extends Error {},
  createAuthClaimsSessionStore: () => ({ isActive: async () => true, revoke: async () => {}, reset: () => {} }),
}));
const auth = require('../middleware/auth');
const { AUTH_CLAIMS_VERSION } = require('../src/modules/auth/application/auth-claims-resolver');
const { createPricePolicyRouter } = require('../routes/bolsa');
const { createCommercialPricePolicyService, CommercialPricePolicyError } = require('../services/commercial-price-policy');
const KEY = 'adf45c52-0c3a-47e1-a814-02ae4d4fb825';
const BODY = { confirmed: true, expectedRevision: 0, reason: 'Coste revisado', policyUnit: 'UNIDADES', manufacturingCost: '0.8', targetMarginPct: '20', minimumPrice: null, minimumOrigin: 'ERP_BASE' };
function token(role, extra = {}) { return auth.signAccessToken({ user: '80', role, sid: 'session-fixture', sub: '80', jti: 'jti-fixture', claimsVersion: AUTH_CLAIMS_VERSION, ...extra }); }
function setup() {
  const row = { articleCode: '1001', erpUnit: '', tariffCode: 2, tariffPrice: '6.9', tariffState: 'PRESENTE', policyUnit: null, unitState: 'NO_VERIFICADA', revision: 0, manufacturingCost: null, targetMarginPct: null, minimumOrigin: 'ERP_BASE', minimumPrice: null };
  const repository = { list: jest.fn(async () => ({ total: 1, items: [row] })), audit: jest.fn(async () => ({ total: 0, items: [] })), update: jest.fn(async (_input, derive) => { derive(row); return { articleCode: '1001', revision: 1, replayed: false }; }) };
  const app = express();
  app.use(express.json());
  app.use('/api/bolsa/price-policy', createPricePolicyRouter({ service: createCommercialPricePolicyService({ repository }) }));
  return { app, repository };
}
afterAll(() => auth.shutdown());

describe('manager-only owned price policy HTTP contract', () => {
  test.each(['', 'Bearer invented.payload.signature'])('unsigned request cannot read private policy, case %#', async (authorization) => {
    const { app, repository } = setup();
    const req = request(app).get('/api/bolsa/price-policy');
    if (authorization) req.set('Authorization', authorization);
    const res = await req;
    expect(res.status).toBe(401);
    expect(repository.list).not.toHaveBeenCalled();
  });
  test.each(['COMERCIAL', 'REPARTIDOR', 'JEFE', 'DIRECTOR'])('signed %s cannot list, audit or edit; flags and request role do not grant authority', async (role) => {
    const { app, repository } = setup();
    const authorization = `Bearer ${token(role, { isJefeVentas: true })}`;
    for (const [method, url] of [['get', '/api/bolsa/price-policy'], ['get', '/api/bolsa/price-policy/1001/audit'], ['put', '/api/bolsa/price-policy/1001']]) {
      const req = request(app)[method](url).set('Authorization', authorization);
      if (method === 'put') req.send({ ...BODY, role: 'ADMIN' });
      const res = await req;
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toMatch(/manufacturingCost|targetMarginPct|COSTE|MARGEN/);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.audit).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
  test.each(['ADMIN', 'JEFE_VENTAS'])('signed %s can view all rows including unverified UOM and explicitly confirm an edit', async (role) => {
    const { app, repository } = setup();
    const authorization = `Bearer ${token(role)}`;
    const listing = await request(app).get('/api/bolsa/price-policy?page=1&pageSize=25').set('Authorization', authorization);
    expect(listing.status).toBe(200);
    expect(listing.body).toMatchObject({ success: true, total: 1, page: 1, pageSize: 25, items: [{ articleCode: '1001', erpUnit: '', effectiveFloor: null, enforceable: false, coverageError: expect.any(String) }] });
    const edit = await request(app).put('/api/bolsa/price-policy/1001').set('Authorization', authorization).set('Idempotency-Key', KEY).send(BODY);
    expect(edit.status).toBe(200);
    expect(edit.body).toEqual({ success: true, articleCode: '1001', revision: 1, replayed: false });
    expect(repository.update.mock.calls[0][0].actor).toEqual({ code: '80', role });
    const audit = await request(app).get('/api/bolsa/price-policy/1001/audit').set('Authorization', authorization);
    expect(audit.status).toBe(200);
    expect(audit.body.items).toEqual([]);
  });
  test.each([
    { payload: { ...BODY, confirmed: false } }, { payload: { ...BODY, role: 'ADMIN' } },
    { key: '' }, { url: '/api/bolsa/price-policy/12345678901' },
    { payload: { ...BODY, expectedRevision: '0' } }, { payload: { ...BODY, manufacturingCost: '1.00001' } },
  ])('invalid edit produces actionable 422 with no repository call, case %#', async (change) => {
    const { app, repository } = setup();
    const res = await request(app).put(change.url || '/api/bolsa/price-policy/1001').set('Authorization', `Bearer ${token('ADMIN')}`).set('Idempotency-Key', change.key ?? KEY).send(change.payload || BODY);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('COMMERCIAL_PRICE_POLICY_INVALID');
    expect(repository.update).not.toHaveBeenCalled();
  });
  test.each([404, 409, 503])('typed persistence status %s survives HTTP without leaking internal details', async (status) => {
    const { app, repository } = setup();
    repository.update.mockRejectedValue(new CommercialPricePolicyError('POLICY_FIXTURE_ERROR', 'Actualiza y revisa.', status, { manufacturingCost: 'private', payloadHash: 'private' }));
    const res = await request(app).put('/api/bolsa/price-policy/1001').set('Authorization', `Bearer ${token('ADMIN')}`).set('Idempotency-Key', KEY).send(BODY);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ success: false, code: 'POLICY_FIXTURE_ERROR', error: 'Actualiza y revisa.' });
  });
  test('unexpected database error is redacted in HTTP', async () => {
    const { app, repository } = setup();
    repository.list.mockRejectedValue(new Error('ODBC private statement and cost'));
    const res = await request(app).get('/api/bolsa/price-policy').set('Authorization', `Bearer ${token('ADMIN')}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/ODBC|cost|statement/);
  });
});
