'use strict';

const path = require('path');

Object.assign(process.env, {
  NODE_ENV: 'test',
  GMP_ENV_FILE: path.join(__dirname, '__missing-controller-env'),
  USE_TS_ROUTES: 'false',
  USE_DDD_ROUTES: 'false',
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
  REPARTO_WRITES_ENABLED: 'true',
  REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
  REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
  ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
});

const request = require('supertest');
let mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true, activeMode: 'REPARTIDOR', repartidorCodes: ['12', '99'] };

jest.mock('../../middleware/auth', () => {
  const actual = jest.requireActual('../../middleware/auth');
  return {
    ...actual,
    verifyToken: (req, res, next) => {
      if (!req.get('authorization')) {
        return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Authentication required' });
      }
      req.user = mockUser;
      return next();
    },
  };
});

jest.mock('../../services/repartidor-finance-service', () => ({
  getDailySummary: jest.fn(async ({ repartidorId, date }) => ({ repartidorId, date, totals: {} })),
  getVencimientos: jest.fn(async () => ({ items: [], total: 0, hasMore: false, nextCursor: null })),
  getCommissionSummary: jest.fn(async ({ repartidorId, from, to }) => ({ repartidorId, range: { from, to }, commission: 0 })),
}));

const financeService = require('../../services/repartidor-finance-service');
const app = require('../../app');

describe('backend/app controller contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true, activeMode: 'REPARTIDOR', repartidorCodes: ['12', '99'] };
  });

  test('public live endpoint returns 200 JSON without starting a listener', async () => {
    const response = await request(app).get('/api/live').set('User-Agent', 'GMP-App/1.0 Dart/3.0');
    expect(response.status).toBe(200);
    expect(response.type).toMatch(/json/);
    expect(response.body).toMatchObject({ status: 'ok', timestamp: expect.any(String) });
    expect(global.__httpServer).toBeUndefined();
  });

  test('protected finance endpoint returns typed 401 without token', async () => {
    const response = await request(app).get('/api/repartidor-finanzas/daily-summary/12?date=2026-04-30').set('User-Agent', 'GMP-App/1.0 Dart/3.0');
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, code: 'AUTH_REQUIRED' });
  });

  test('authorized daily summary returns 200 and delegates exact params', async () => {
    const response = await request(app)
      .get('/api/repartidor-finanzas/daily-summary/12?date=2026-04-30')
      .set('User-Agent', 'GMP-App/1.0 Dart/3.0')
      .set('Authorization', 'Bearer test');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      repartidorId: '12',
      date: '2026-04-30',
      totals: {},
      canReverseCobros: false,
    });
    expect(financeService.getDailySummary).toHaveBeenCalledTimes(1);
    expect(financeService.getDailySummary).toHaveBeenCalledWith({
      repartidorId: '12',
      date: '2026-04-30',
    });
  });

  test('commercial cannot read another repartidor finance profile', async () => {
    mockUser = { id: '12', code: '12', role: 'REPARTIDOR', isRepartidor: true };
    const response = await request(app)
      .get('/api/repartidor-finanzas/daily-summary/99?date=2026-04-30')
      .set('User-Agent', 'GMP-App/1.0 Dart/3.0')
      .set('Authorization', 'Bearer test');
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  test('malformed date is rejected by zod as typed 400', async () => {
    const response = await request(app)
      .get('/api/repartidor-finanzas/daily-summary/12?date=2026-02-31')
      .set('User-Agent', 'GMP-App/1.0 Dart/3.0')
      .set('Authorization', 'Bearer test');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: 'Invalid request' });
    expect(response.body.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'date' }),
    ]));
  });

  test('empty cursor query is rejected by zod as typed 400', async () => {
    const response = await request(app)
      .get('/api/repartidor-finanzas/vencimientos/12?cursor=')
      .set('User-Agent', 'GMP-App/1.0 Dart/3.0')
      .set('Authorization', 'Bearer test');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: 'Invalid request' });
  });

  test('unknown public route returns stable JSON 404', async () => {
    const response = await request(app).get('/health/not-found').set('User-Agent', 'GMP-App/1.0 Dart/3.0');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, code: 'NOT_FOUND', error: 'Not found' });
  });
});
