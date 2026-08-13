'use strict';

const {
  AUTH_CLAIMS_VERSION,
  AuthClaimsError,
  createAuthClaimsResolver,
} = require('../src/modules/auth/application/auth-claims-resolver');

function profile(overrides = {}) {
  return {
    id: 'ignored-id',
    code: '050',
    name: 'Persona',
    isActive: true,
    isJefeVentas: false,
    tipoVendedor: 'R',
    showCommissions: false,
    ...overrides,
  };
}

function harness({ user = profile(), reparto = null } = {}) {
  const repository = {
    findByCode: jest.fn().mockResolvedValue(user),
    findRepartidorAssociation: jest.fn().mockResolvedValue(reparto),
    getVendorVisibilityScope: jest.fn(async (code, { role }) => (
      role === 'JEFE_VENTAS' ? [code, '051', 'UNK'] : [code]
    )),
  };
  return { repository, resolver: createAuthClaimsResolver({ authRepository: repository }) };
}

describe('authoritative auth claims resolver', () => {
  test('targets claims version 2', () => {
    expect(AUTH_CLAIMS_VERSION).toBe(2);
  });

  test('uses the authenticated profile as the authoritative COMERCIAL base', async () => {
    const { repository, resolver } = harness();

    const claims = await resolver.resolve({ code: '050' });

    expect(claims).toEqual({
      id: 'V050',
      user: '050',
      name: 'Persona',
      role: 'COMERCIAL',
      availableRoles: ['COMERCIAL'],
      activeMode: 'COMERCIAL',
      availableModes: ['COMERCIAL'],
      isJefeVentas: false,
      isRepartidor: false,
      codigoConductor: null,
      matricula: null,
      vendorCodes: ['050'],
      vendedorCodes: ['050'],
      tipoVendedor: 'R',
      showCommissions: false,
      claimsVersion: AUTH_CLAIMS_VERSION,
    });
    expect(repository.findByCode).toHaveBeenCalledWith('050');
    expect(repository.findRepartidorAssociation).toHaveBeenCalledWith('050');
    expect(repository.getVendorVisibilityScope).toHaveBeenCalledWith('050', { role: 'COMERCIAL' });
    expect(Object.isFrozen(claims)).toBe(true);
    expect(Object.isFrozen(claims.availableRoles)).toBe(true);
    expect(Object.isFrozen(claims.vendorCodes)).toBe(true);
  });

  test('adds REPARTIDOR without replacing the default COMERCIAL role', async () => {
    const { resolver } = harness({
      reparto: { isRepartidor: true, codigoConductor: '050', matricula: null },
    });

    await expect(resolver.resolve({ code: '050' })).resolves.toEqual(expect.objectContaining({
      role: 'COMERCIAL',
      availableRoles: ['COMERCIAL', 'REPARTIDOR'],
      activeMode: 'COMERCIAL',
      isRepartidor: false,
      codigoConductor: null,
      matricula: null,
      vendorCodes: ['050'],
    }));
  });

  test('projects an explicitly selected REPARTIDOR with only the canonical vendor code', async () => {
    const { repository, resolver } = harness({
      reparto: { isRepartidor: true, codigoConductor: '050', matricula: null },
    });

    await expect(resolver.resolve({ code: '050', selectedRole: 'REPARTIDOR' })).resolves.toEqual(
      expect.objectContaining({
        role: 'REPARTIDOR',
        isRepartidor: true,
        codigoConductor: '050',
        matricula: null,
        vendorCodes: ['050'],
        vendedorCodes: ['050'],
      }),
    );
    expect(repository.getVendorVisibilityScope).not.toHaveBeenCalled();
  });

  test('derives manager behavior from the profile for any canonical code', async () => {
    const { repository, resolver } = harness({
      user: profile({ code: 'MGR7', isJefeVentas: true }),
    });
    repository.getVendorVisibilityScope.mockResolvedValue(['MGR7', 'TEAM']);

    await expect(resolver.resolve({ code: 'mgr7' })).resolves.toEqual(expect.objectContaining({
      id: 'VMGR7',
      role: 'JEFE_VENTAS',
      availableRoles: ['COMERCIAL', 'JEFE_VENTAS'],
      isJefeVentas: true,
      vendorCodes: ['MGR7', 'TEAM'],
    }));
    expect(repository.getVendorVisibilityScope).toHaveBeenCalledWith('MGR7', { role: 'JEFE_VENTAS' });
  });

  test('projects only the selected role and never retains manager scope', async () => {
    const { resolver } = harness({
      user: profile({ isJefeVentas: true }),
      reparto: { isRepartidor: true, codigoConductor: '050', matricula: '1234ABC' },
    });

    await expect(resolver.resolve({ code: '050', selectedRole: 'COMERCIAL' })).resolves.toEqual(
      expect.objectContaining({
        role: 'COMERCIAL',
        isJefeVentas: false,
        isRepartidor: false,
        codigoConductor: null,
        matricula: null,
        vendorCodes: ['050'],
      }),
    );
    await expect(resolver.resolve({ code: '050', selectedRole: 'REPARTIDOR' })).resolves.toEqual(
      expect.objectContaining({
        role: 'REPARTIDOR',
        isJefeVentas: false,
        isRepartidor: true,
        codigoConductor: '050',
        vendorCodes: ['050'],
      }),
    );
  });

  test('projects ALMACEN only as a manager UI mode without minting a new role', async () => {
    const { resolver } = harness({ user: profile({ isJefeVentas: true }) });

    await expect(resolver.resolve({ code: '050', selectedMode: 'ALMACEN' })).resolves.toEqual(
      expect.objectContaining({
        role: 'JEFE_VENTAS', activeMode: 'ALMACEN', isJefeVentas: true,
        availableRoles: ['COMERCIAL', 'JEFE_VENTAS'],
        availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
      }),
    );
  });

  test('projects REPARTIDOR as JEFE supervision mode without personal OPP', async () => {
    const { resolver } = harness({ user: profile({ code: '98', isJefeVentas: true }) });

    await expect(resolver.resolve({
      code: '98',
      selectedRole: 'JEFE_VENTAS',
      selectedMode: 'REPARTIDOR',
    })).resolves.toEqual(
      expect.objectContaining({
        role: 'JEFE_VENTAS',
        activeMode: 'REPARTIDOR',
        isJefeVentas: true,
        isRepartidor: false,
        codigoConductor: null,
        availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
        vendorCodes: ['98', '051', 'UNK'],
      }),
    );
  });

  test('rejects ALMACEN for non-managers and every role not associated with the subject', async () => {
    const { resolver } = harness();

    await expect(resolver.resolve({ code: '050', selectedMode: 'ALMACEN' })).rejects.toMatchObject({
      name: 'AuthClaimsError', status: 403, code: 'ROLE_NOT_ASSOCIATED',
    });
    await expect(resolver.resolve({ code: '050', selectedRole: 'JEFE_VENTAS' })).rejects.toBeInstanceOf(AuthClaimsError);
  });

  test.each([
    ['missing', null],
    ['inactive', profile({ isActive: false })],
  ])('maps %s profiles to typed 401', async (_label, user) => {
    const { resolver } = harness({ user });
    await expect(resolver.resolve({ code: '050' })).rejects.toMatchObject({
      status: 401, code: 'AUTH_SUBJECT_INVALID',
    });
  });

  test('maps repository failures to typed 503 without leaking their message', async () => {
    const { repository, resolver } = harness();
    repository.findRepartidorAssociation.mockRejectedValue(new Error('sensitive DB detail'));

    await expect(resolver.resolve({ code: '050' })).rejects.toMatchObject({
      status: 503,
      code: 'AUTH_PROFILE_UNAVAILABLE',
      message: 'Perfil de autorización no disponible',
    });
  });
});
