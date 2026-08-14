'use strict';

process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);

jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../services/redis-cache', () => ({
  redisCache: { isConnected: false, client: null },
}));

const express = require('express');
const request = require('supertest');
const auth = require('../middleware/auth');
const { createAuthClaimsResolver } = require('../src/modules/auth/application/auth-claims-resolver');

function repository({ manager, driver = false }) {
  return {
    findByCode: jest.fn(async (code) => ({
      code, name: manager ? 'Jefe' : 'Comercial', isActive: true,
      isJefeVentas: manager, permitePreventa: true, permiteReparto: driver,
      tipoVendedor: 'R', showCommissions: true, matricula: driver ? '1234ABC' : null,
    })),
    getVendorVisibilityScope: jest.fn(async (code, { role }) => (
      role === 'JEFE_VENTAS' ? [code, '051'] : [code]
    )),
  };
}

async function canonicalSession(claims, suffix) {
  const sid = `sid-${suffix}`;
  const accessJti = `access-${suffix}`;
  const refreshJti = `refresh-${suffix}`;
  const accessToken = auth.signAccessToken({ ...claims, sub: claims.id, sid, jti: accessJti });
  const refreshToken = auth.signRefreshToken({ ...claims, sub: claims.id, sid, jti: refreshJti });
  await auth.registerSession(claims.id, refreshToken, 'jest', '127.0.0.1', {
    sid, accessJti, refreshJti,
  });
  return { sid, accessJti, refreshJti, accessToken, refreshToken };
}

function appFor(claims, identity) {
  const app = express();
  app.use(express.json());
  app.post('/switch', (req, res) => {
    req.user = { id: claims.id, code: claims.user };
    req.tokenPayload = { ...claims, sub: claims.id, sid: identity.sid, jti: identity.accessJti };
    return auth.handleSwitchRole(req, res);
  });
  app.post('/refresh', (req, res) => auth.handleRefreshToken(req, res));
  app.post('/logout', (req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const payload = auth.verifyAccessToken(token);
    req.user = { id: payload?.id, code: payload?.user };
    req.tokenPayload = payload;
    return auth.handleLogout(req, res);
  });
  app.get('/protected', auth.verifyToken, (_req, res) => res.json({ ok: true }));
  return app;
}

function canonicalAuthApp() {
  const app = express();
  app.use(express.json());
  app.post('/switch', auth.verifyToken, (req, res) => auth.handleSwitchRole(req, res));
  app.post('/refresh', (req, res) => auth.handleRefreshToken(req, res));
  app.post('/logout', auth.verifyToken, (req, res) => auth.handleLogout(req, res));
  app.get('/protected', auth.verifyToken, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('warehouse is an authorized UI mode, not a privilege role', () => {
  test('manager switches to ALMACEN, refresh preserves DB-backed role/mode, and logout revokes it', async () => {
    const repo = repository({ manager: true });
    const resolver = createAuthClaimsResolver({ authRepository: repo });
    auth.setAuthClaimsResolver(resolver);
    const claims = await resolver.resolve({ code: '050' });
    const identity = await canonicalSession(claims, 'warehouse-manager');
    const app = appFor(claims, identity);

    const switched = await request(app)
      .post('/switch')
      .send({ userId: '050', newRole: 'ALMACEN' });

    expect(switched.status).toBe(200);
    expect(switched.body).toEqual(expect.objectContaining({
      success: true, role: 'JEFE_VENTAS', activeMode: 'ALMACEN',
      availableRoles: ['COMERCIAL', 'JEFE_VENTAS'],
      availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
      vendedorCodes: ['050', '051'],
      user: expect.objectContaining({
        role: 'JEFE_VENTAS', activeMode: 'ALMACEN', isJefeVentas: true,
        codigoConductor: null, vendedorCodes: ['050', '051'],
      }),
    }));
    const switchedClaims = auth.verifyAccessToken(switched.body.token);
    expect(switchedClaims).toEqual(expect.objectContaining({
      role: 'JEFE_VENTAS', activeMode: 'ALMACEN', isJefeVentas: true,
      vendorCodes: ['050', '051'],
    }));
    expect(switchedClaims.sid).not.toBe(identity.sid);

    const oldSessionDenied = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${identity.accessToken}`);
    expect(oldSessionDenied.status).toBe(401);
    expect(oldSessionDenied.body.code).toBe('SESSION_REVOKED');

    const refreshed = await request(app)
      .post('/refresh')
      .send({ refreshToken: switched.body.refreshToken });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toEqual(expect.objectContaining({
      role: 'JEFE_VENTAS', activeMode: 'ALMACEN',
    }));
    const refreshedClaims = auth.verifyAccessToken(refreshed.body.accessToken);
    expect(refreshedClaims).toEqual(expect.objectContaining({
      role: 'JEFE_VENTAS', activeMode: 'ALMACEN', isJefeVentas: true,
    }));
    expect(refreshed.body.user).toEqual(expect.objectContaining({
      role: 'JEFE_VENTAS', activeMode: 'ALMACEN', isJefeVentas: true,
      availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'], vendedorCodes: ['050', '051'],
    }));
    expect(refreshedClaims.sid).toBe(switchedClaims.sid);
    expect(refreshedClaims.jti).not.toBe(switchedClaims.jti);
    const switchedRefreshClaims = auth.verifyRefreshToken(switched.body.refreshToken);
    const refreshedRefreshClaims = auth.verifyRefreshToken(refreshed.body.refreshToken);
    expect(refreshedRefreshClaims.sid).toBe(switchedRefreshClaims.sid);
    expect(refreshedRefreshClaims.jti).not.toBe(switchedRefreshClaims.jti);
    expect(repo.findByCode).toHaveBeenCalledTimes(3);

    const loggedOut = await request(app)
      .post('/logout')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(loggedOut.status).toBe(200);

    const deniedAfterLogout = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(deniedAfterLogout.status).toBe(401);
    expect(deniedAfterLogout.body.code).toBe('SESSION_REVOKED');
  });

  test.each([
    ['commercial', false, '060'],
    ['driver', true, '061'],
  ])('%s cannot select ALMACEN', async (_label, driver, code) => {
    const resolver = createAuthClaimsResolver({
      authRepository: repository({ manager: false, driver }),
    });
    auth.setAuthClaimsResolver(resolver);
    const claims = await resolver.resolve({ code });
    const identity = await canonicalSession(claims, `warehouse-${code}`);
    const app = appFor(claims, identity);

    const denied = await request(app)
      .post('/switch')
      .send({ userId: code, newRole: 'ALMACEN' });

    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('ROLE_NOT_ASSOCIATED');
  });

  test('manager-driver JEFE -> REPARTIDOR -> JEFE replaces claims and scope exactly', async () => {
    const repo = repository({ manager: true, driver: true });
    const resolver = createAuthClaimsResolver({ authRepository: repo });
    auth.setAuthClaimsResolver(resolver);
    const jefeClaims = await resolver.resolve({ code: '050' });
    const initial = await canonicalSession(jefeClaims, 'manager-driver');
    const app = canonicalAuthApp();

    const reparto = await request(app)
      .post('/switch')
      .set('Authorization', `Bearer ${initial.accessToken}`)
      .send({ userId: '050', newRole: 'REPARTIDOR' });

    expect(reparto.status).toBe(200);
    expect(reparto.body).toEqual(expect.objectContaining({
      role: 'REPARTIDOR', activeMode: 'REPARTIDOR',
      isJefeVentas: false, isRepartidor: true,
      codigoConductor: '050', vendedorCodes: ['050'],
      availableRoles: ['COMERCIAL', 'JEFE_VENTAS', 'REPARTIDOR'],
      availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
      user: expect.objectContaining({
        role: 'REPARTIDOR', activeMode: 'REPARTIDOR',
        isJefeVentas: false, isRepartidor: true,
        codigoConductor: '050', matricula: '1234ABC',
        vendedorCodes: ['050'],
      }),
    }));
    const repartoClaims = auth.verifyAccessToken(reparto.body.token);
    expect(repartoClaims.sid).not.toBe(initial.sid);
    expect((await request(app).get('/protected')
      .set('Authorization', `Bearer ${initial.accessToken}`)).status).toBe(401);
    expect((await request(app).get('/protected')
      .set('Authorization', `Bearer ${reparto.body.token}`)).status).toBe(200);

    const jefe = await request(app)
      .post('/switch')
      .set('Authorization', `Bearer ${reparto.body.token}`)
      .send({ userId: '050', newRole: 'JEFE_VENTAS' });

    expect(jefe.status).toBe(200);
    expect(jefe.body).toEqual(expect.objectContaining({
      role: 'JEFE_VENTAS', activeMode: 'COMERCIAL',
      isJefeVentas: true, isRepartidor: false,
      codigoConductor: null, matricula: null,
      vendedorCodes: ['050', '051'],
      availableRoles: ['COMERCIAL', 'JEFE_VENTAS', 'REPARTIDOR'],
      availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
      user: expect.objectContaining({
        role: 'JEFE_VENTAS', activeMode: 'COMERCIAL',
        isJefeVentas: true, isRepartidor: false,
        codigoConductor: null, matricula: null,
        vendedorCodes: ['050', '051'],
      }),
    }));
    const jefeClaimsAfter = auth.verifyAccessToken(jefe.body.token);
    expect(jefeClaimsAfter.sid).not.toBe(repartoClaims.sid);
    expect((await request(app).get('/protected')
      .set('Authorization', `Bearer ${reparto.body.token}`)).status).toBe(401);

    const refreshed = await request(app)
      .post('/refresh')
      .send({ refreshToken: jefe.body.refreshToken });
    expect(refreshed.status).toBe(200);
    const refreshedAccess = auth.verifyAccessToken(refreshed.body.accessToken);
    const refreshedRefresh = auth.verifyRefreshToken(refreshed.body.refreshToken);
    const jefeRefresh = auth.verifyRefreshToken(jefe.body.refreshToken);
    expect(refreshedAccess.sid).toBe(jefeClaimsAfter.sid);
    expect(refreshedAccess.jti).not.toBe(jefeClaimsAfter.jti);
    expect(refreshedRefresh.sid).toBe(jefeRefresh.sid);
    expect(refreshedRefresh.jti).not.toBe(jefeRefresh.jti);
    expect(refreshed.body.user.vendedorCodes).toEqual(['050', '051']);
  });
});
