'use strict';

const { AUTH_CLAIMS_VERSION, AuthClaimsError } = require('../src/modules/auth/application/auth-claims-resolver');
const {
  createAuthClaimsLoginHandler,
} = require('../src/modules/auth/application/auth-claims-login-handler');

function response() {
  const res = {
    statusCode: 200,
    body: null,
    status: jest.fn((status) => { res.statusCode = status; return res; }),
    json: jest.fn((body) => { res.body = body; return res; }),
  };
  return res;
}

function claims(overrides = {}) {
  return Object.freeze({
    id: 'V050', user: '050', name: 'Persona', role: 'REPARTIDOR',
    availableRoles: Object.freeze(['COMERCIAL', 'REPARTIDOR']),
    activeMode: 'REPARTIDOR',
    availableModes: Object.freeze(['COMERCIAL', 'REPARTIDOR']),
    isJefeVentas: false, isRepartidor: true,
    codigoConductor: '050', matricula: '1234ABC',
    vendorCodes: Object.freeze(['050']), vendedorCodes: Object.freeze(['050']),
    repartidorCodes: Object.freeze(['050']),
    tipoVendedor: 'R', showCommissions: false,
    claimsVersion: AUTH_CLAIMS_VERSION,
    ...overrides,
  });
}

function harness() {
  const authRepository = {
    findByCode: jest.fn().mockResolvedValue({
      id: 'legacy', code: '050', name: 'Persona', isActive: true, _passwordHash: '1234',
    }),
    findNameLoginCandidates: jest.fn().mockResolvedValue([]),
    logLoginAttempt: jest.fn().mockResolvedValue({ ok: true }),
  };
  const authClaimsResolver = { resolve: jest.fn().mockResolvedValue(claims()) };
  const verifyVendorPin = jest.fn().mockResolvedValue({ valid: true, method: 'test' });
  const tokenService = {
    signAccessToken: jest.fn(() => ['access', 'token', 'fixture'].join('-')),
    signRefreshToken: jest.fn(() => 'refresh-token'),
    registerSession: jest.fn().mockResolvedValue(),
    revokeSession: jest.fn().mockResolvedValue(),
    ACCESS_TTL_MS: 1_234_000,
    REFRESH_TTL_MS: 5_678_000,
  };
  const createId = jest.fn()
    .mockReturnValueOnce('sid-1')
    .mockReturnValueOnce('access-jti-1')
    .mockReturnValueOnce('refresh-jti-1');
  const handler = createAuthClaimsLoginHandler({
    authRepository,
    authClaimsResolver,
    verifyVendorPin,
    tokenService,
    createId,
  });
  return { authRepository, authClaimsResolver, verifyVendorPin, tokenService, createId, handler };
}

function request(body = { username: '050', password: '1234' }) {
  return {
    body,
    ip: '127.0.0.1',
    get: jest.fn(() => 'jest-agent'),
  };
}

describe('shared auth claims login handler', () => {
  test('emits the authoritative subject/schema and TTLs for every route family', async () => {
    const first = harness();
    const second = harness();
    const legacy = response();
    const ddd = response();

    await first.handler(request(), legacy);
    await second.handler(request(), ddd);

    expect(legacy.statusCode).toBe(200);
    expect(ddd.statusCode).toBe(200);
    expect(legacy.body).toEqual(ddd.body);
    expect(legacy.body).toEqual({
      success: true,
      user: {
        id: 'V050', code: '050', name: 'Persona', company: 'GMP', vendedorCode: '050',
        role: 'REPARTIDOR', availableRoles: ['COMERCIAL', 'REPARTIDOR'],
        activeMode: 'REPARTIDOR', availableModes: ['COMERCIAL', 'REPARTIDOR'],
        isJefeVentas: false, isRepartidor: true,
        codigoConductor: '050', matricula: '1234ABC',
        vendorCodes: ['050'], vendedorCodes: ['050'], repartidorCodes: ['050'],
        tipoVendedor: 'R', TIPOVENDEDOR: 'R',
        showCommissions: false, claimsVersion: AUTH_CLAIMS_VERSION,
      },
      role: 'REPARTIDOR',
      availableRoles: ['COMERCIAL', 'REPARTIDOR'],
      activeMode: 'REPARTIDOR',
      availableModes: ['COMERCIAL', 'REPARTIDOR'],
      isJefeVentas: false,
      isRepartidor: true,
      codigoConductor: '050',
      matricula: '1234ABC',
      vendorCodes: ['050'],
      vendedorCodes: ['050'],
      repartidorCodes: ['050'],
      tipoVendedor: 'R',
      showCommissions: false,
      claimsVersion: AUTH_CLAIMS_VERSION,
      latestVersion: '3.3.1',
      token: ['access', 'token', 'fixture'].join('-'),
      refreshToken: 'refresh-token',
      tokenExpiresIn: 1234,
      refreshExpiresIn: 5678,
    });
    const accessClaims = first.tokenService.signAccessToken.mock.calls[0][0];
    const refreshClaims = first.tokenService.signRefreshToken.mock.calls[0][0];
    expect(accessClaims).toEqual(expect.objectContaining({ sub: 'V050', sid: 'sid-1', jti: 'access-jti-1' }));
    expect(refreshClaims).toEqual(expect.objectContaining({ sub: 'V050', sid: 'sid-1', jti: 'refresh-jti-1' }));
    expect(first.tokenService.registerSession).toHaveBeenCalledWith(
      'V050', 'refresh-token', 'jest-agent', '127.0.0.1', {
        sid: 'sid-1', accessJti: 'access-jti-1', refreshJti: 'refresh-jti-1',
      },
    );
  });

  test('rejects usernames containing removed characters instead of rewriting identity', async () => {
    const { handler, authRepository } = harness();
    const res = response();

    await handler(request({ username: 'D!iego', password: '1234' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_USERNAME');
    expect(authRepository.findByCode).not.toHaveBeenCalled();
  });

  test('logs in by vendor name when PIN matches exactly one candidate', async () => {
    const { handler, authRepository, authClaimsResolver, verifyVendorPin, tokenService } = harness();
    authRepository.findByCode.mockResolvedValue(null);
    authRepository.findNameLoginCandidates.mockResolvedValue([
      { id: '22', code: '22', name: '22 DIEGO ALCAZAR', isActive: true, _passwordHash: 'hash-22' },
      { id: '25', code: '25', name: '25 DIEGO', isActive: true, _passwordHash: 'hash-25' },
      { id: '86', code: '86', name: '86 DIEGO', isActive: true, _passwordHash: 'hash-86' },
      { id: '98', code: '98', name: '98 DIEGO (98)', isActive: true, _passwordHash: 'hash-98' },
    ]);
    authClaimsResolver.resolve.mockResolvedValue(claims({
      id: 'V098', user: '98', name: '98 DIEGO (98)',
      codigoConductor: '98', vendorCodes: Object.freeze(['98']),
      vendedorCodes: Object.freeze(['98']), repartidorCodes: Object.freeze(['98']),
    }));
    verifyVendorPin.mockImplementation(async ({ vendedorCode, skipLockout }) => {
      if (vendedorCode === '98') return { valid: true, method: skipLockout ? 'probe' : 'test' };
      return { valid: false };
    });
    const res = response();

    await handler(request({ username: 'diego', password: 'pin-ok' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.code).toBe('98');
    expect(authRepository.findNameLoginCandidates).toHaveBeenCalledWith('DIEGO', { limit: 10 });
    expect(verifyVendorPin).toHaveBeenCalledWith(expect.objectContaining({
      vendedorCode: '98', candidatePin: 'pin-ok', skipLockout: true,
    }));
    expect(verifyVendorPin).toHaveBeenCalledWith(expect.objectContaining({
      vendedorCode: '98', candidatePin: 'pin-ok',
    }));
    expect(verifyVendorPin.mock.calls.some((call) => call[0].skipLockout === true && call[0].vendedorCode === '22')).toBe(true);
    expect(authClaimsResolver.resolve).toHaveBeenCalledWith({ code: '98' });
    expect(tokenService.signAccessToken).toHaveBeenCalled();
  });

  test('logs in by numeric vendor code without a name lookup', async () => {
    const { handler, authRepository, authClaimsResolver, verifyVendorPin } = harness();
    authRepository.findByCode.mockResolvedValue({
      id: '98', code: '98', name: '98 DIEGO (98)', isActive: true, _passwordHash: 'hash-98',
    });
    authClaimsResolver.resolve.mockResolvedValue(claims({
      id: 'V098', user: '98', name: '98 DIEGO (98)',
      codigoConductor: '98', vendorCodes: Object.freeze(['98']),
      vendedorCodes: Object.freeze(['98']), repartidorCodes: Object.freeze(['98']),
    }));
    const res = response();

    await handler(request({ username: '98', password: 'pin-ok' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.user.code).toBe('98');
    expect(authRepository.findByCode).toHaveBeenCalledWith('98');
    expect(authRepository.findNameLoginCandidates).not.toHaveBeenCalled();
    expect(verifyVendorPin).toHaveBeenCalledTimes(1);
    expect(verifyVendorPin.mock.calls[0][0].skipLockout).toBeUndefined();
  });

  test('rejects vendor-name login when PIN matches more than one candidate', async () => {
    const { handler, authRepository, authClaimsResolver, verifyVendorPin, tokenService } = harness();
    authRepository.findByCode.mockResolvedValue(null);
    authRepository.findNameLoginCandidates.mockResolvedValue([
      { id: '22', code: '22', name: '22 DIEGO ALCAZAR', isActive: true, _passwordHash: 'hash-22' },
      { id: '98', code: '98', name: '98 DIEGO (98)', isActive: true, _passwordHash: 'hash-98' },
    ]);
    verifyVendorPin.mockResolvedValue({ valid: true, method: 'probe' });
    const res = response();

    await handler(request({ username: 'diego', password: 'pin-ok' }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: 'Credenciales invalidas', code: 'INVALID_CREDENTIALS',
    });
    expect(verifyVendorPin.mock.calls.filter((call) => call[0].skipLockout === true)).toHaveLength(2);
    expect(authClaimsResolver.resolve).not.toHaveBeenCalled();
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
  });
  test('re-resolves claims only after valid credentials', async () => {
    const { handler, authClaimsResolver, verifyVendorPin } = harness();
    verifyVendorPin.mockResolvedValue({ valid: false });
    const res = response();

    await handler(request(), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect(authClaimsResolver.resolve).not.toHaveBeenCalled();
  });

  test.each([
    [new AuthClaimsError('invalid', 'AUTH_SUBJECT_INVALID', 401), 401, 'AUTH_SUBJECT_INVALID'],
    [new AuthClaimsError('unavailable', 'AUTH_PROFILE_UNAVAILABLE', 503), 503, 'AUTH_PROFILE_UNAVAILABLE'],
  ])('maps resolver failures without issuing tokens', async (error, status, code) => {
    const { handler, authClaimsResolver, tokenService } = harness();
    authClaimsResolver.resolve.mockRejectedValue(error);
    const res = response();

    await handler(request(), res);

    expect(res.statusCode).toBe(status);
    expect(res.body.code).toBe(code);
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    expect(tokenService.registerSession).not.toHaveBeenCalled();
  });

  test('treats a structured audit failure explicitly without creating a session', async () => {
    const { handler, authRepository, tokenService } = harness();
    authRepository.logLoginAttempt.mockResolvedValue({
      ok: false, code: 'AUTH_AUDIT_UNAVAILABLE',
    });
    const res = response();

    await handler(request(), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('AUTH_AUDIT_UNAVAILABLE');
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    expect(tokenService.registerSession).not.toHaveBeenCalled();
  });

  test('compensates a partially registered session when the store fails', async () => {
    const { handler, tokenService } = harness();
    const storedSids = new Set();
    tokenService.registerSession.mockImplementation(async (_userId, _token, _agent, _ip, { sid }) => {
      storedSids.add(sid);
      const error = new Error('store unavailable');
      error.code = 'AUTH_SESSION_STORE_UNAVAILABLE';
      throw error;
    });
    tokenService.revokeSession.mockImplementation(async (sid) => storedSids.delete(sid));
    const res = response();

    await handler(request(), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('AUTH_SESSION_STORE_UNAVAILABLE');
    expect(tokenService.revokeSession).toHaveBeenCalledWith('sid-1', { userId: 'V050' });
    expect(storedSids.size).toBe(0);
  });
  test('maps session limit failures to typed 409 without pretending the profile is missing', async () => {
    const { handler, tokenService } = harness();
    tokenService.registerSession.mockRejectedValue(Object.assign(
      new Error('Maximum active sessions reached'),
      { code: 'AUTH_SESSION_LIMIT_REACHED', status: 409 },
    ));
    const res = response();

    await handler(request(), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('AUTH_SESSION_LIMIT_REACHED');
  });

  test('maps credential profile/store failures to typed 503', async () => {
    const { handler, authRepository, tokenService } = harness();
    authRepository.findByCode.mockRejectedValue(new Error('sensitive DB detail'));
    const res = response();

    await handler(request(), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      error: 'Perfil de autorización no disponible', code: 'AUTH_PROFILE_UNAVAILABLE',
    });
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
  });

  test('rejects ambiguous name matches when PIN does not select a single vendor', async () => {
    const { handler, authRepository, authClaimsResolver, verifyVendorPin, tokenService } = harness();
    authRepository.findByCode.mockResolvedValue(null);
    authRepository.findNameLoginCandidates.mockResolvedValue([
      { id: '22', code: '22', name: '22 DIEGO ALCAZAR', isActive: true, _passwordHash: 'hash-22' },
      { id: '98', code: '98', name: '98 DIEGO (98)', isActive: true, _passwordHash: 'hash-98' },
    ]);
    verifyVendorPin.mockResolvedValue({ valid: false });
    const res = response();

    await handler(request({ username: 'diego', password: 'pin-miss' }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: 'Credenciales invalidas', code: 'INVALID_CREDENTIALS',
    });
    expect(verifyVendorPin).toHaveBeenCalled();
    expect(authClaimsResolver.resolve).not.toHaveBeenCalled();
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
  });
});
