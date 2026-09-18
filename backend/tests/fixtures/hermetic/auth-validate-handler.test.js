'use strict';

jest.mock('../../../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../middleware/security', () => ({
  loginLimiter: (_req, _res, next) => next(),
  sanitizeInput: (_req, _res, next) => next(),
  bruteForceIpTracker: (_req, _res, next) => next(),
}));
jest.mock('../../../services/vendor-pin-auth', () => ({ verifyVendorPin: jest.fn() }));
jest.mock('../../../src/modules/auth', () => ({
  Db2AuthRepository: jest.fn(() => ({ listRepartidorFleet: jest.fn() })),
}));
jest.mock('../../../src/modules/auth/application/auth-claims-resolver', () => {
  const actual = jest.requireActual('../../../src/modules/auth/application/auth-claims-resolver');
  return { ...actual, createAuthClaimsResolver: jest.fn(() => ({ resolve: jest.fn() })) };
});
jest.mock('../../../src/modules/auth/application/auth-claims-login-handler', () => ({
  createAuthClaimsLoginHandler: jest.fn(() => (_req, _res) => undefined),
}));

const auth = require('../../../middleware/auth');
const { AUTH_CLAIMS_VERSION } = require('../../../src/modules/auth/application/auth-claims-resolver');
const router = require('../../../routes/auth');

function response() {
  const res = { body: undefined, statusCode: 200 };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

function validateStack() {
  const layer = router.stack.find((item) => item.route?.path === '/validate' && item.route.methods.get);
  expect(layer).toBeDefined();
  return layer.route.stack.map((item) => item.handle);
}

async function canonicalToken() {
  const subject = 'V-VALIDATE';
  const sid = 'sid-validate';
  const accessJti = 'access-validate';
  const refreshJti = 'refresh-validate';
  const claims = {
    id: subject, sub: subject, user: 'VALIDATE', name: 'Synthetic', role: 'COMERCIAL',
    sid, jti: accessJti, claimsVersion: AUTH_CLAIMS_VERSION,
  };
  const refresh = auth.signRefreshToken({ ...claims, jti: refreshJti });
  await auth.registerSession(subject, refresh, 'hermetic', '127.0.0.1', {
    sid, accessJti, refreshJti,
  });
  return auth.signAccessToken(claims);
}

afterEach(async () => {
  await auth.invalidateAllSessions('V-VALIDATE');
});

describe('auth validate handler composition without an HTTP listener', () => {
  test('runs the real verifyToken before the real validate projection handler', async () => {
    const [guard, handler] = validateStack();
    expect(guard).toBe(auth.verifyToken);
    expect(typeof handler).toBe('function');
    const req = { headers: { authorization: `Bearer ${await canonicalToken()}` }, ip: '127.0.0.1' };
    const res = response();

    await guard(req, res, () => handler(req, res));

    expect(res.status).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      valid: true, role: 'COMERCIAL', activeMode: 'COMERCIAL', claimsVersion: AUTH_CLAIMS_VERSION,
    });
  });

  test('does not enter validate projection when canonical identity is absent', async () => {
    const [guard, handler] = validateStack();
    const token = auth.signAccessToken({
      id: 'V-VALIDATE', user: 'VALIDATE', role: 'COMERCIAL', claimsVersion: AUTH_CLAIMS_VERSION,
    });
    const req = { headers: { authorization: `Bearer ${token}` }, ip: '127.0.0.1' };
    const res = response();
    const handlerSpy = jest.fn(handler);

    await guard(req, res, handlerSpy);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual(expect.objectContaining({ code: 'AUTH_RELOGIN_REQUIRED' }));
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  test('the projection preserves claimsVersion zero only when directly invoked', () => {
    const [, handler] = validateStack();
    const res = response();

    handler({ user: { role: 'REPARTIDOR', activeMode: 'REPARTIDOR', claimsVersion: 0 } }, res);

    expect(res.body).toEqual({ valid: true, role: 'REPARTIDOR', activeMode: 'REPARTIDOR', claimsVersion: 0 });
  });
});
