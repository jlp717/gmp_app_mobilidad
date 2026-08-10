'use strict';

process.env.JWT_ACCESS_SECRET = 'x'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'y'.repeat(64);
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../services/redis-cache', () => ({
  redisCache: { isConnected: false, client: null },
}));
const auth = require('../middleware/auth');

function response() {
  const res = {
    body: null, statusCode: 200,
    status: jest.fn((code) => { res.statusCode = code; return res; }),
    json: jest.fn((body) => { res.body = body; return res; }),
  };
  return res;
}
async function rotate(payload) {
  const sid = `sid-${payload.user}`;
  const accessJti = `access-${payload.user}`;
  const refreshJti = `refresh-${payload.user}`;
  const claims = {
    availableRoles: [payload.role], tipoVendedor: '-', showCommissions: true,
    claimsVersion: 1, isRepartidor: false, codigoConductor: null, matricula: null,
    ...payload,
  };
  auth.setAuthClaimsResolver({ resolve: jest.fn(async () => claims) });
  const token = auth.signRefreshToken({ ...claims, sub: payload.id, sid, jti: refreshJti });
  await auth.registerSession(payload.id, token, 'jest', '127.0.0.1', {
    sid, accessJti, refreshJti,
  });
  const res = response();
  await auth.handleRefreshToken({
    body: { refreshToken: token }, ip: '127.0.0.1', get: jest.fn(() => 'jest'),
  }, res);
  expect(res.statusCode).toBe(200);
  return auth.verifyAccessToken(res.body.accessToken);
}
test('refresh preserves REPARTIDOR identity and ownership', async () => {
  const decoded = await rotate({
    id: 'V050', user: '050', name: 'Repartidor real', role: 'REPARTIDOR',
    isJefeVentas: false, isRepartidor: true, codigoConductor: '050',
    matricula: '1234ABC', vendorCodes: ['050'], vendedorCodes: ['050'],
  });
  expect(decoded).toEqual(expect.objectContaining({
    role: 'REPARTIDOR', isRepartidor: true, codigoConductor: '050',
    matricula: '1234ABC', vendorCodes: ['050'], vendedorCodes: ['050'],
  }));
});

test.each([
  {
    id: 'V010', user: '010', name: 'Comercial', role: 'COMERCIAL',
    isJefeVentas: false, vendorCodes: ['010', '11'], vendedorCodes: ['010', '11'],
  },
  {
    id: 'V001', user: '001', name: 'Jefe', role: 'JEFE_VENTAS',
    isJefeVentas: true, vendorCodes: ['001', '002', '82', '20', 'UNK'],
    vendedorCodes: ['001', '002', '82', '20', 'UNK'],
  },
])('refresh preserves $role scopes without reparto escalation', async (payload) => {
  const decoded = await rotate(payload);
  expect(decoded).toEqual(expect.objectContaining({
    role: payload.role,
    isJefeVentas: payload.isJefeVentas,
    isRepartidor: false,
    codigoConductor: null,
    matricula: null,
    vendorCodes: payload.vendorCodes,
    vendedorCodes: payload.vendedorCodes,
  }));
});

test('verifyToken projects coherent reparto claims and rejects invalid tokens', async () => {
  const sid = 'sid-verify';
  const accessJti = 'access-verify';
  const refreshJti = 'refresh-verify';
  const claims = {
    id: 'V050', user: '050', name: 'Repartidor real', role: 'REPARTIDOR',
    isJefeVentas: false, isRepartidor: true, codigoConductor: '050',
    matricula: '1234ABC', vendorCodes: ['050'], vendedorCodes: ['050'],
  };
  const refreshToken = auth.signRefreshToken({ ...claims, sub: claims.id, sid, jti: refreshJti });
  await auth.registerSession(claims.id, refreshToken, 'jest', '127.0.0.1', {
    sid, accessJti, refreshJti,
  });
  const token = auth.signAccessToken({ ...claims, sub: claims.id, sid, jti: accessJti });
  const req = {
    headers: { authorization: `Bearer ${token}` }, ip: '127.0.0.1',
    method: 'GET', path: '/api/auth/perfil',
  };
  const res = response();
  const next = jest.fn();
  await auth.verifyToken(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(req.tokenPayload).toEqual(expect.objectContaining({
    user: '050', role: 'REPARTIDOR', codigoConductor: '050',
  }));
  expect(req.user).toEqual(expect.objectContaining({
    code: '050', role: 'REPARTIDOR', isRepartidor: true,
    codigoConductor: '050', matricula: '1234ABC',
    vendorCodes: ['050'], vendedorCodes: ['050'],
  }));

  const invalidReq = {
    headers: { authorization: 'Bearer invalid' }, ip: '127.0.0.1',
    method: 'GET', path: '/api/auth/perfil',
  };
  const invalidRes = response();
  const invalidNext = jest.fn();
  await auth.verifyToken(invalidReq, invalidRes, invalidNext);
  expect(invalidRes.statusCode).toBe(401);
  expect(invalidNext).not.toHaveBeenCalled();
});

test('legacy access tokens require a fresh login', async () => {
  const token = auth.signAccessToken({ id: 'V050', user: '050', role: 'REPARTIDOR' });
  const req = {
    headers: { authorization: `Bearer ${token}` }, ip: '127.0.0.1',
    method: 'GET', path: '/api/auth/validate',
  };
  const res = response();
  const next = jest.fn();
  await auth.verifyToken(req, res, next);
  expect(res.statusCode).toBe(401);
  expect(res.body.code).toBe('AUTH_RELOGIN_REQUIRED');
  expect(next).not.toHaveBeenCalled();
});

test('switch-role re-resolves DB-backed claims and revokes the prior access jti', async () => {
  const sid = 'sid-switch-role';
  const accessJti = 'access-before-switch';
  const refreshJti = 'refresh-before-switch';
  const currentClaims = {
    id: 'V050', user: '050', name: 'Persona', role: 'COMERCIAL',
    isJefeVentas: false, isRepartidor: false, vendorCodes: ['050'], vendedorCodes: ['050'],
  };
  const resolvedClaims = {
    ...currentClaims, role: 'REPARTIDOR', isRepartidor: true,
    codigoConductor: '050', matricula: '1234ABC', vendorCodes: ['050'], vendedorCodes: ['050'],
  };
  const resolver = { resolve: jest.fn(async ({ code, selectedRole }) => {
    expect(code).toBe('050');
    expect(selectedRole).toBe('REPARTIDOR');
    return resolvedClaims;
  }) };
  auth.setAuthClaimsResolver(resolver);
  const refreshToken = auth.signRefreshToken({ ...currentClaims, sub: 'V050', sid, jti: refreshJti });
  const oldAccessToken = auth.signAccessToken({ ...currentClaims, sub: 'V050', sid, jti: accessJti });
  await auth.registerSession('V050', refreshToken, 'jest', '127.0.0.1', { sid, accessJti, refreshJti });

  const switchRes = response();
  await auth.handleSwitchRole({
    body: { userId: '050', newRole: 'REPARTIDOR' },
    user: { code: '050' }, tokenPayload: { ...currentClaims, sub: 'V050', sid, jti: accessJti },
    ip: '127.0.0.1', get: jest.fn(() => 'jest'),
  }, switchRes);

  expect(switchRes.statusCode).toBe(200);
  expect(switchRes.body.role).toBe('REPARTIDOR');
  expect(auth.verifyAccessToken(switchRes.body.token)).toEqual(expect.objectContaining({
    role: 'REPARTIDOR', isRepartidor: true, codigoConductor: '050', matricula: '1234ABC',
  }));

  const oldRes = response();
  await auth.verifyToken({
    headers: { authorization: `Bearer ${oldAccessToken}` }, ip: '127.0.0.1',
    method: 'GET', path: '/api/auth/validate',
  }, oldRes, jest.fn());
  expect(oldRes.statusCode).toBe(401);
  expect(oldRes.body.code).toBe('SESSION_REVOKED');
});

test('refresh revokes the session when DB-backed authorization no longer permits its role', async () => {
  const sid = 'sid-refresh-revalidation';
  const accessJti = 'access-refresh-revalidation';
  const refreshJti = 'refresh-refresh-revalidation';
  const claims = { id: 'V050', user: '050', role: 'REPARTIDOR', isRepartidor: true };
  const refreshToken = auth.signRefreshToken({ ...claims, sub: 'V050', sid, jti: refreshJti });
  const accessToken = auth.signAccessToken({ ...claims, sub: 'V050', sid, jti: accessJti });
  await auth.registerSession('V050', refreshToken, 'jest', '127.0.0.1', { sid, accessJti, refreshJti });
  const unavailableRole = Object.assign(new Error('role removed'), { status: 403, code: 'ROLE_NOT_ASSOCIATED' });
  auth.setAuthClaimsResolver({ resolve: jest.fn(async () => { throw unavailableRole; }) });

  const refreshRes = response();
  await auth.handleRefreshToken({ body: { refreshToken }, ip: '127.0.0.1', get: jest.fn(() => 'jest') }, refreshRes);
  expect(refreshRes.statusCode).toBe(403);
  expect(refreshRes.body.code).toBe('ROLE_NOT_ASSOCIATED');

  const verifyRes = response();
  await auth.verifyToken({
    headers: { authorization: `Bearer ${accessToken}` }, ip: '127.0.0.1',
    method: 'GET', path: '/api/auth/validate',
  }, verifyRes, jest.fn());
  expect(verifyRes.statusCode).toBe(401);
  expect(verifyRes.body.code).toBe('SESSION_REVOKED');
});

test('logout revokes the current access token immediately', async () => {
  const sid = 'sid-logout';
  const accessJti = 'access-logout';
  const refreshJti = 'refresh-logout';
  const claims = { id: 'V050', user: '050', role: 'REPARTIDOR', sub: 'V050', sid };
  const refreshToken = auth.signRefreshToken({ ...claims, jti: refreshJti });
  const accessToken = auth.signAccessToken({ ...claims, jti: accessJti });
  await auth.registerSession('V050', refreshToken, 'jest', '127.0.0.1', {
    sid, accessJti, refreshJti,
  });
  const logoutRes = response();
  await auth.handleLogout({ tokenPayload: { sid, sub: 'V050' }, user: { id: 'V050' } }, logoutRes);
  expect(logoutRes.statusCode).toBe(200);

  const verifyRes = response();
  const next = jest.fn();
  await auth.verifyToken({
    headers: { authorization: `Bearer ${accessToken}` }, ip: '127.0.0.1',
    method: 'GET', path: '/api/auth/validate',
  }, verifyRes, next);
  expect(verifyRes.statusCode).toBe(401);
  expect(verifyRes.body.code).toBe('SESSION_REVOKED');
  expect(next).not.toHaveBeenCalled();
});
