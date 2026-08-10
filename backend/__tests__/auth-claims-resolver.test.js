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
  test.each([
    ['commercial', profile(), null, 'COMERCIAL', ['COMERCIAL']],
    ['sales manager', profile({ isJefeVentas: true }), null, 'JEFE_VENTAS', ['COMERCIAL', 'JEFE_VENTAS']],
    ['driver', profile(), { isRepartidor: true, codigoConductor: '050', matricula: '1234ABC' }, 'REPARTIDOR', ['COMERCIAL', 'REPARTIDOR']],
    ['manager and driver', profile({ isJefeVentas: true }), { isRepartidor: true, codigoConductor: '050', matricula: '1234ABC' }, 'JEFE_VENTAS', ['COMERCIAL', 'JEFE_VENTAS', 'REPARTIDOR']],
  ])('resolves the %s role matrix', async (_label, user, reparto, role, availableRoles) => {
    const { repository, resolver } = harness({ user, reparto });

    const claims = await resolver.resolve({ code: '050' });

    expect(claims).toEqual({
      id: 'V050',
      user: '050',
      name: 'Persona',
      role,
      availableRoles,
      activeMode: role === 'JEFE_VENTAS' ? 'COMERCIAL' : role,
      availableModes: [
        'COMERCIAL',
        ...(availableRoles.includes('JEFE_VENTAS') ? ['ALMACEN', 'REPARTIDOR'] : []),
        ...(!availableRoles.includes('JEFE_VENTAS') && availableRoles.includes('REPARTIDOR')
          ? ['REPARTIDOR']
          : []),
      ],
      isJefeVentas: role === 'JEFE_VENTAS',
      isRepartidor: role === 'REPARTIDOR',
      codigoConductor: role === 'REPARTIDOR' ? '050' : null,
      matricula: role === 'REPARTIDOR' ? '1234ABC' : null,
      vendorCodes: role === 'JEFE_VENTAS' ? ['050', '051', 'UNK'] : ['050'],
      vendedorCodes: role === 'JEFE_VENTAS' ? ['050', '051', 'UNK'] : ['050'],
      tipoVendedor: 'R',
      showCommissions: false,
      claimsVersion: AUTH_CLAIMS_VERSION,
    });
    expect(repository.findByCode).toHaveBeenCalledWith('050');
    expect(repository.findRepartidorAssociation).toHaveBeenCalledWith('050');
    if (role === 'REPARTIDOR') {
      expect(repository.getVendorVisibilityScope).not.toHaveBeenCalled();
    } else {
      expect(repository.getVendorVisibilityScope).toHaveBeenCalledWith('050', { role });
    }
    expect(Object.isFrozen(claims)).toBe(true);
    expect(Object.isFrozen(claims.availableRoles)).toBe(true);
    expect(Object.isFrozen(claims.vendorCodes)).toBe(true);
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

  test('keeps vendor 80 out of manager scope and gives drivers only their canonical code', async () => {
    const { repository, resolver } = harness({
      user: profile({ code: '80', isJefeVentas: true }),
      reparto: { isRepartidor: true, codigoConductor: '80', matricula: '8080GMP' },
    });
    repository.getVendorVisibilityScope.mockResolvedValue(['80', '72', '73', '81', '83']);

    await expect(resolver.resolve({ code: '80' })).resolves.toEqual(expect.objectContaining({
      id: 'V80',
      role: 'REPARTIDOR',
      availableRoles: ['COMERCIAL', 'REPARTIDOR'],
      isJefeVentas: false,
      vendorCodes: ['80'],
      vendedorCodes: ['80'],
    }));
    expect(repository.getVendorVisibilityScope).not.toHaveBeenCalled();
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
