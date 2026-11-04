'use strict';

process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockGetPool = jest.fn();

jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../services/redis-cache', () => ({
  redisCache: { isConnected: false, client: null },
  TTL: { MEDIUM: 300 },
}));
jest.mock('../config/db', () => ({
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
  getPool: (...args) => mockGetPool(...args),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (queryFn, sql, _key, _ttl, params = []) => queryFn(sql, params),
}));

const express = require('express');
const request = require('supertest');
const auth = require('../middleware/auth');
const warehouseRouter = require('../routes/warehouse');

let identityCounter = 0;

async function signedToken({ role, activeMode }) {
  identityCounter += 1;
  const code = role === 'ADMIN' ? 'A17' : role === 'JEFE_VENTAS' ? '050' : '060';
  const subject = `V${code}`;
  const sid = `warehouse-mode-sid-${identityCounter}`;
  const accessJti = `warehouse-mode-access-${identityCounter}`;
  const refreshJti = `warehouse-mode-refresh-${identityCounter}`;
  const claims = {
    id: subject,
    user: code,
    name: 'Warehouse test',
    role,
    activeMode,
    availableRoles: [role],
    availableModes: ['COMERCIAL', 'ALMACEN'],
    isJefeVentas: role === 'ADMIN' || role === 'JEFE_VENTAS',
    isRepartidor: false,
    codigoConductor: null,
    matricula: null,
    vendorCodes: [code],
    vendedorCodes: [code],
    repartidorCodes: [],
    tipoVendedor: role === 'ADMIN' ? 'ADMIN' : 'R',
    showCommissions: true,
    claimsVersion: 4,
    sub: subject,
    sid,
  };
  const accessToken = auth.signAccessToken({ ...claims, jti: accessJti });
  const refreshToken = auth.signRefreshToken({ ...claims, jti: refreshJti });
  await auth.registerSession(subject, refreshToken, 'jest', '127.0.0.1', {
    sid,
    accessJti,
    refreshJti,
  });
  return accessToken;
}

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/warehouse', warehouseRouter);
  return instance;
}

describe('warehouse router role and active-mode authorization', () => {
  beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue([]);
    mockQueryWithParams.mockReset().mockResolvedValue([]);
    mockGetPool.mockReset();
  });

  test.each([
    ['COMERCIAL', 'ALMACEN'],
    ['JEFE_VENTAS', 'COMERCIAL'],
    ['ADMIN', 'COMERCIAL'],
    ['REPARTIDOR', 'ALMACEN'],
  ])('denies signed %s in %s mode before any SQL', async (role, activeMode) => {
    const token = await signedToken({ role, activeMode });

    const response = await request(app())
      .post('/api/warehouse/manual-layout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicleCode: '01',
        date: '2026-11-04',
        layoutJson: { boxes: [] },
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'WAREHOUSE_MODE_REQUIRED',
    }));
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  test('denies an unauthenticated delete before any SQL', async () => {
    const response = await request(app())
      .post('/api/warehouse/manual-layout/7/delete');

    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  test.each(['JEFE_VENTAS', 'ADMIN'])(
    'allows a signed %s in ALMACEN mode to preserve the existing write handler',
    async (role) => {
      const token = await signedToken({ role, activeMode: 'ALMACEN' });

      const response = await request(app())
        .post('/api/warehouse/manual-layout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleCode: '01',
          date: '2026-11-04',
          layoutJson: { boxes: [] },
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, action: 'created' });
      expect(mockQueryWithParams).toHaveBeenCalledTimes(2);
      expect(mockQueryWithParams.mock.calls[0][0]).toContain('SELECT ID FROM JAVIER.ALMACEN_CARGA_MANUAL');
      expect(mockQueryWithParams.mock.calls[1][0]).toContain('INSERT INTO JAVIER.ALMACEN_CARGA_MANUAL');
    },
  );
});
