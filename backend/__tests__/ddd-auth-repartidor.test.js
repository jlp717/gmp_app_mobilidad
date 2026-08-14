'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const mockAuthRepo = {
  findByCode: jest.fn(), findRepartidorAssociation: jest.fn(),
  getVendorVisibilityScope: jest.fn(), logLoginAttempt: jest.fn(),
};
const mockDbPool = { execute: jest.fn() };
const mockVisibility = jest.fn((code) => [code]);
const mockAccess = jest.fn(() => 'access');
const mockRefresh = jest.fn(() => 'refresh');
const mockRegister = jest.fn();
const mockRevokeSession = jest.fn();
let mockPayload = null;
const mockVerify = jest.fn((req, res, next) => {
  if (req.get('authorization') !== 'Bearer valid-token' || !mockPayload) {
    return res.status(401).json({ code: 'TOKEN_EXPIRED' });
  }
  req.tokenPayload = { ...mockPayload };
  req.user = {
    id: mockPayload.id, code: mockPayload.user, role: mockPayload.role,
    isJefeVentas: mockPayload.isJefeVentas === true,
  };
  next();
});
const pass = (req, res, next) => next();

jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../middleware/security', () => ({
  loginLimiter: pass, sanitizeInput: pass, bruteForceIpTracker: pass,
  validateBody: pass, detectSqlInjection: pass,
}));
jest.mock('../middleware/auth', () => ({
  signAccessToken: mockAccess, signRefreshToken: mockRefresh,
  registerSession: mockRegister, revokeSession: mockRevokeSession, verifyToken: mockVerify,
  setAuthClaimsResolver: jest.fn(), handleSwitchRole: jest.fn(),
  ACCESS_TTL_MS: 3600000, REFRESH_TTL_MS: 604800000,
}));
jest.mock('../middleware/audit', () => ({
  auditLogin: jest.fn(), getClientIP: jest.fn(() => '127.0.0.1'),
}));
jest.mock('../services/vendor-pin-auth', () => ({
  verifyVendorPin: jest.fn().mockResolvedValue({ valid: true, method: 'test' }),
}));
jest.mock('../services/query-optimizer', () => ({ cachedQuery: jest.fn() }));
jest.mock('../services/redis-cache', () => ({ TTL: {} }));
jest.mock('../services/laclae', () => ({ getClientCodesFromCache: jest.fn() }));
jest.mock('../config/db', () => ({ query: jest.fn(), queryWithParams: jest.fn() }));
jest.mock('../utils/common', () => ({ getVendorVisibilityScope: mockVisibility }));
jest.mock('../src/modules/auth', () => ({ Db2AuthRepository: jest.fn(() => mockAuthRepo) }));
jest.mock('../src/modules/pedidos', () => ({ Db2PedidosRepository: jest.fn() }));
jest.mock('../src/modules/cobros', () => ({ Db2CobrosRepository: jest.fn() }));
jest.mock('../src/modules/entregas', () => ({ Db2EntregasRepository: jest.fn() }));
jest.mock('../src/modules/rutero', () => ({ Db2RuteroRepository: jest.fn() }));
jest.mock('../src/modules/clients/infrastructure/db2-client-repository', () => ({
  Db2ClientRepository: jest.fn(),
}));
jest.mock('../src/core/infrastructure/database/db2-connection-pool', () => ({
  Db2ConnectionPool: jest.fn(() => mockDbPool),
}));
jest.mock('../src/core/infrastructure/cache/response-cache', () => ({
  ResponseCache: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), invalidatePattern: jest.fn() })),
}));
jest.mock('../src/core/infrastructure/cache/performance-cache', () => ({
  performanceCache: { getTTL: jest.fn(), getOrFetch: jest.fn() },
}));
const { createAuthRoutes } = require('../src/shared/routes/ddd-adapters');
const legacyAuthRoutes = require('../routes/auth');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/auth', createAuthRoutes());
  return instance;
}
function legacyApp() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/auth', legacyAuthRoutes);
  return instance;
}
function user(overrides = {}) {
  return {
    id: 'V050', code: '050', name: 'Persona real', role: 'COMERCIAL',
    isJefeVentas: false, isActive: true, _passwordHash: '1234',
    permitePreventa: true, permiteReparto: false,
    tipoVendedor: 'R', showCommissions: false, matricula: null, ...overrides,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockPayload = null;
  mockAuthRepo.findByCode.mockResolvedValue(user());
  mockAuthRepo.findRepartidorAssociation.mockResolvedValue(null);
  mockAuthRepo.logLoginAttempt.mockResolvedValue({ ok: true });
  mockAuthRepo.getVendorVisibilityScope.mockImplementation(async (code, { role }) => (
    role === 'JEFE_VENTAS' ? ['001', '002', '82', '20', 'UNK'] : mockVisibility(code)
  ));
  mockVisibility.mockImplementation((code) => [code]);
  mockDbPool.execute.mockResolvedValue([]);
});

test('DDD login keeps COMERCIAL default and adds REPARTIDOR as a switchable role', async () => {
  mockAuthRepo.findByCode.mockResolvedValue(user({
    permitePreventa: true, permiteReparto: true, matricula: '1234ABC',
  }));
  const res = await request(app()).post('/api/auth/login')
    .send({ username: '050', password: '1234' });
  expect(res.status).toBe(200);
  expect(res.body.user).toEqual(expect.objectContaining({
    role: 'COMERCIAL', isRepartidor: false,
    codigoConductor: null, matricula: null,
    availableRoles: ['COMERCIAL', 'REPARTIDOR'],
    availableModes: ['COMERCIAL', 'REPARTIDOR'],
    tipoVendedor: 'R', showCommissions: false,
  }));
  expect(res.body).toEqual(expect.objectContaining({
    showCommissions: false, latestVersion: '3.3.1',
  }));
  expect(res.body.vendedorCodes).toEqual(['050']);
  expect(mockAccess).toHaveBeenCalledWith(expect.objectContaining({
    role: 'COMERCIAL', isRepartidor: false,
    availableRoles: ['COMERCIAL', 'REPARTIDOR'],
    vendedorCodes: ['050'],
  }));
});

test('legacy and DDD login preserve compatibility fields with identical values', async () => {
  const payload = { username: '050', password: '1234' };
  const ddd = await request(app()).post('/api/auth/login').send(payload);
  const legacy = await request(legacyApp()).post('/api/auth/login').send(payload);

  expect(ddd.status).toBe(200);
  expect(legacy.status).toBe(200);
  const compatibility = (body) => ({
    tipoVendedor: body.user.tipoVendedor,
    TIPOVENDEDOR: body.user.TIPOVENDEDOR,
    userShowCommissions: body.user.showCommissions,
    showCommissions: body.showCommissions,
    latestVersion: body.latestVersion,
  });
  expect(compatibility(ddd.body)).toEqual({
    tipoVendedor: 'R', TIPOVENDEDOR: 'R', userShowCommissions: false,
    showCommissions: false, latestVersion: '3.3.1',
  });
  expect(compatibility(legacy.body)).toEqual(compatibility(ddd.body));
});

test('DDD login preserves exact COMERCIAL and JEFE_VENTAS scopes', async () => {
  mockVisibility.mockReturnValue(['050', '51']);
  let res = await request(app()).post('/api/auth/login')
    .send({ username: '050', password: '1234' });
  expect(res.body).toEqual(expect.objectContaining({
    role: 'COMERCIAL', isRepartidor: false, vendedorCodes: ['050', '51'],
  }));

  mockAuthRepo.findByCode.mockResolvedValue(user({
    id: 'V001', code: '001', role: 'JEFE_VENTAS', isJefeVentas: true, permitePreventa: true,
  }));
  mockDbPool.execute.mockResolvedValue([{ CODE: '001' }, { CODE: '002' }]);
  res = await request(app()).post('/api/auth/login')
    .send({ username: '001', password: '1234' });
  expect(res.body).toEqual(expect.objectContaining({
    role: 'JEFE_VENTAS', isRepartidor: false,
    vendedorCodes: ['001', '002', '82', '20', 'UNK'],
  }));
  expect(mockAuthRepo.findByCode.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test('profile lookup failure returns typed 503 without token or identity leakage', async () => {
  mockAuthRepo.findByCode.mockRejectedValue(new Error('DB unavailable'));
  const res = await request(app()).post('/api/auth/login')
    .send({ username: '050', password: '1234' });
  expect(res.status).toBe(503);
  expect(res.body).toEqual({
    error: 'Perfil de autorización no disponible', code: 'AUTH_PROFILE_UNAVAILABLE',
  });
  expect(mockAccess).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(mockRegister).not.toHaveBeenCalled();
  const testLogger = require('../middleware/logger');
  const allLogs = Object.values(testLogger).flatMap((method) => method.mock.calls).flat().join(' ');
  expect(allLogs).not.toMatch(/050|Persona real|DB unavailable/);
});

test('GET perfil enforces token, returns normalized redacted claims', async () => {
  expect((await request(app()).get('/api/auth/perfil')).status).toBe(401);
  expect((await request(app()).get('/api/auth/perfil')
    .set('Authorization', 'Bearer invalid')).status).toBe(401);

  mockPayload = {
    id: 'V050', user: '050', name: 'Persona real', role: 'REPARTIDOR',
    isJefeVentas: false, isRepartidor: true, codigoConductor: '050',
    matricula: '1234ABC', vendedorCodes: ['050'],
    password: 'no-leak', pin: 'no-leak',
  };
  const res = await request(app()).get('/api/auth/perfil')
    .set('Authorization', 'Bearer valid-token');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    success: true,
    user: {
      id: 'V050', code: '050', name: 'Persona real', company: 'GMP',
      vendedorCode: '050', role: 'REPARTIDOR', isJefeVentas: false,
      isRepartidor: true, codigoConductor: '050', matricula: '1234ABC',
    },
    role: 'REPARTIDOR', isRepartidor: true, vendedorCodes: ['050'],
  });
  expect(JSON.stringify(res.body)).not.toMatch(/password|pin|token|secret/i);
  expect(mockAuthRepo.findByCode).not.toHaveBeenCalled();
});

test('DDD mount order exposes perfil before legacy fallback', () => {
  const paths = createAuthRoutes().stack.map((layer) => layer.route?.path).filter(Boolean);
  expect(paths).toEqual(['/login', '/validate', '/perfil']);
  const perfilLayer = createAuthRoutes().stack.find((layer) => layer.route?.path === '/perfil');
  expect(perfilLayer.route.stack[0].handle).toBe(mockVerify);
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const ddd = source.indexOf("app.use('/api/auth', dddAuthRoutes)");
  const legacy = source.indexOf("app.use('/api/auth', authRoutes)", ddd);
  expect(ddd).toBeGreaterThan(-1);
  expect(legacy).toBeGreaterThan(ddd);
});
