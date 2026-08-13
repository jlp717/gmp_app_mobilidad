'use strict';

const { AuthClaimsError } = require('../src/modules/auth/application/auth-claims-resolver');
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
    tipoVendedor: 'R', showCommissions: false,
    claimsVersion: 1,
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
        vendorCodes: ['050'], vendedorCodes: ['050'],
        tipoVendedor: 'R', TIPOVENDEDOR: 'R',
        showCommissions: false, claimsVersion: 1,
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
      tipoVendedor: 'R',
      showCommissions: false,
      claimsVersion: 1,
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

  test('disambiguates ambiguous name login by unique matching PIN', async () => {
    const { handler, authRepository, authClaimsResolver, verifyVendorPin, tokenService } = harness();
    authRepository.findByCode.mockResolvedValue(null);
    authRepository.findNameLoginCandidates.mockResolvedValue([
      { id: '22', code: '22', name: '22 DIEGO ALCAZAR', isActive: true, _passwordHash: '0484' },
      { id: '98', code: '98', name: '98 DIEGO (98)', isActive: true, _passwordHash: '9322' },
    ]);
    verifyVendorPin.mockImplementation(async ({ dbPin, candidatePin }) => ({
      valid: String(dbPin).trim() === String(candidatePin).trim(),
      method: 'test',
    }));
    authClaimsResolver.resolve.mockResolvedValue(claims({
      id: 'V98', user: '98', name: '98 DIEGO (98)', vendorCodes: Object.freeze(['98']),
      vendedorCodes: Object.freeze(['98']),
    }));
    const res = response();

    await handler(request({ username: 'diego', password: '9322' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.code).toBe('98');
    expect(authClaimsResolver.resolve).toHaveBeenCalledWith({ code: '98' });
    expect(tokenService.signAccessToken).toHaveBeenCalled();
  });
});
