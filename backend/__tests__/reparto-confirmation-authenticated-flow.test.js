'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-for-authenticated-flow-32';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-authenticated-flow-32';
process.env.AUTH_SESSION_STORE_MODE = 'memory';

const express = require('express');
const request = require('supertest');

const mockAuthRepository = {
  findByCode: jest.fn(),
  getVendorVisibilityScope: jest.fn(),
  listRepartidorFleet: jest.fn(),
  logLoginAttempt: jest.fn(),
};
const mockVerifyVendorPin = jest.fn();
const mockValidateConfirmation = jest.fn();
const mockConfirm = jest.fn();

const passThrough = (_req, _res, next) => next();

jest.mock('../src/modules/auth', () => ({
  Db2AuthRepository: jest.fn(() => mockAuthRepository),
}));
jest.mock('../services/vendor-pin-auth', () => ({
  verifyVendorPin: (...args) => mockVerifyVendorPin(...args),
}));
jest.mock('../middleware/security', () => ({
  loginLimiter: passThrough,
  sanitizeInput: passThrough,
  bruteForceIpTracker: passThrough,
}));
jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: jest.fn(),
  getPool: jest.fn(),
}));
jest.mock('../services/redis-cache', () => ({
  deleteCachePattern: jest.fn().mockResolvedValue(true),
  invalidateCache: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/reparto-variance-notification-service', () => ({
  notifyAfterCobro: jest.fn().mockResolvedValue(undefined),
  notifyAfterConfirm: jest.fn().mockResolvedValue(undefined),
}));

const auth = require('../middleware/auth');
const authRoutes = require('../routes/auth');
const finanzasRoutes = require('../routes/repartidor-finanzas');
const { AUTH_CLAIMS_VERSION } = require('../src/modules/auth/application/auth-claims-resolver');

function managerProfile() {
  return {
    id: 'V05',
    code: '05',
    name: 'Diego Jefe Ventas',
    isActive: true,
    isJefeVentas: true,
    permitePreventa: true,
    permiteReparto: false,
    tipoVendedor: 'J',
    showCommissions: true,
    matricula: null,
    _passwordHash: '1234',
  };
}

function confirmationPayload() {
  return {
    delivery: {
      itemId: '2026-S-10-404-4300009479',
      status: 'ENTREGADO',
      repartidorId: '94',
      occurredAt: '2026-04-23T11:30:00.000Z',
      receiver: {
        nombre: 'Ana',
        apellidos: 'Lopez Ruiz',
        dni: '12345678Z',
      },
      lineas: [{
        lineaId: '1',
        codigoArticulo: 'ART-1',
        cantidadPedida: 4,
        cantidadEntregada: 4,
        cantidadRechazada: 0,
        cantidadPendiente: 0,
      }],
      firma: `ev_${'a'.repeat(64)}`,
    },
    cobro: {
      entregaId: '2026-S-10-404-4300009479',
      importeCobrado: 189.60,
      formaPago: 'EFECTIVO',
    },
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/repartidor-finanzas', finanzasRoutes);
  return app;
}

describe('authenticated reparto confirmation flow', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = makeApp();
    mockAuthRepository.findByCode.mockResolvedValue(managerProfile());
    mockAuthRepository.getVendorVisibilityScope.mockResolvedValue(['05']);
    mockAuthRepository.listRepartidorFleet.mockResolvedValue([
      { code: '05', name: 'Diego' },
      { code: '94', name: 'Repartidor 94' },
    ]);
    mockAuthRepository.logLoginAttempt.mockResolvedValue({ ok: true });
    mockVerifyVendorPin.mockResolvedValue({ valid: true, method: 'test' });
    mockValidateConfirmation.mockResolvedValue(undefined);
    mockConfirm.mockResolvedValue({
      created: true,
      idempotent: false,
      cobroId: 12,
      idempotencyKey: 'auth-flow-20260901',
    });
    finanzasRoutes.setCanonicalConfirmationRuntime({
      catalogService: { validateConfirmation: mockValidateConfirmation },
      confirmationService: { confirm: mockConfirm },
    });
  });

  afterEach(() => {
    finanzasRoutes.resetCanonicalConfirmationRuntime();
  });

  test('login -> switch to Perfil Reparto -> confirm delivery and cobro', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: '05', password: '1234' });

    expect(login.status).toBe(200);
    expect(login.body.user).toEqual(expect.objectContaining({
      code: '05',
      role: 'JEFE_VENTAS',
      activeMode: 'COMERCIAL',
      repartidorCodes: [],
      claimsVersion: AUTH_CLAIMS_VERSION,
    }));

    const switched = await request(app)
      .post('/api/auth/switch-role')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ userId: '05', newRole: 'REPARTIDOR' });

    expect(switched.status).toBe(200);
    expect(switched.body).toEqual(expect.objectContaining({
      role: 'JEFE_VENTAS',
      activeMode: 'REPARTIDOR',
      repartidorCodes: ['05', '94'],
    }));

    const response = await request(app)
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .set('Authorization', `Bearer ${switched.body.token}`)
      .set('Idempotency-Key', 'auth-flow-20260901')
      .send(confirmationPayload());

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      created: true,
      cobroId: 12,
    }));
    expect(mockValidateConfirmation).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          role: 'JEFE_VENTAS',
          privileged: true,
          repartidorId: '94',
        }),
        delivery: expect.objectContaining({ repartidorId: '94' }),
        cobro: expect.objectContaining({ importeCobrado: 189.60 }),
      }),
      { signal: expect.any(AbortSignal) },
    );

    mockConfirm.mockResolvedValueOnce({
      created: true,
      idempotent: false,
      cobroId: null,
      idempotencyKey: 'auth-flow-unpaid',
    });
    const unpaidPayload = confirmationPayload();
    delete unpaidPayload.cobro;

    const unpaidResponse = await request(app)
      .post('/api/repartidor-finanzas/rutero/confirm-delivery-cobro')
      .set('Authorization', `Bearer ${switched.body.token}`)
      .set('Idempotency-Key', 'auth-flow-unpaid')
      .send(unpaidPayload);

    expect(unpaidResponse.status).toBe(201);
    expect(unpaidResponse.body).toEqual(expect.objectContaining({
      success: true,
      created: true,
      cobroId: null,
    }));
    expect(mockConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ cobro: undefined }),
      { signal: expect.any(AbortSignal) },
    );
  });
});
