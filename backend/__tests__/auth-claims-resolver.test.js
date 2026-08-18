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
    permitePreventa: true,
    permiteReparto: false,
    tipoVendedor: 'R',
    showCommissions: false,
    matricula: null,
    ...overrides,
  };
}

function harness({ user = profile() } = {}) {
  const repository = {
    findByCode: jest.fn().mockResolvedValue(user),
    getVendorVisibilityScope: jest.fn(async (code, { role }) => (
      role === 'JEFE_VENTAS' ? [code, '051', 'UNK'] : [code]
    )),
    listRepartidorFleet: jest.fn(async () => [
      { code: String(user?.code || '050').trim().toUpperCase(), name: 'Repartidor' },
      { code: '051', name: 'Otro' },
    ]),
  };
  return { repository, resolver: createAuthClaimsResolver({ authRepository: repository }) };
}

describe('authoritative auth claims resolver', () => {
  test('targets claims version 4', () => {
    expect(AUTH_CLAIMS_VERSION).toBe(4);
  });

  test('uses ERP preventista flag as the authoritative COMERCIAL base', async () => {
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
      repartidorCodes: [],
      tipoVendedor: 'R',
      showCommissions: false,
      claimsVersion: AUTH_CLAIMS_VERSION,
    });
    expect(repository.findByCode).toHaveBeenCalledWith('050');
    expect(repository.getVendorVisibilityScope).toHaveBeenCalledWith('050', { role: 'COMERCIAL' });
    expect(Object.isFrozen(claims)).toBe(true);
    expect(Object.isFrozen(claims.availableRoles)).toBe(true);
    expect(Object.isFrozen(claims.vendorCodes)).toBe(true);
    expect(Object.isFrozen(claims.repartidorCodes)).toBe(true);
  });

  test('defaults pure ERP repartidores to REPARTIDOR', async () => {
    const { resolver } = harness({
      user: profile({
        code: '044',
        name: '44 ROMERA',
        permitePreventa: false,
        permiteReparto: true,
        tipoVendedor: 'P',
      }),
    });

    await expect(resolver.resolve({ code: '44' })).resolves.toEqual(expect.objectContaining({
      role: 'REPARTIDOR',
      availableRoles: ['REPARTIDOR'],
      activeMode: 'REPARTIDOR',
      availableModes: ['COMERCIAL', 'REPARTIDOR'],
      isRepartidor: true,
      codigoConductor: '044',
      vendorCodes: ['044'],
    }));
  });

  test('adds REPARTIDOR without replacing the default COMERCIAL role for dual profiles', async () => {
    const { resolver } = harness({
      user: profile({ permitePreventa: true, permiteReparto: true, matricula: '1234ABC' }),
    });

    await expect(resolver.resolve({ code: '050' })).resolves.toEqual(expect.objectContaining({
      role: 'COMERCIAL',
      availableRoles: ['COMERCIAL', 'REPARTIDOR'],
      activeMode: 'COMERCIAL',
      availableModes: ['COMERCIAL', 'REPARTIDOR'],
      isRepartidor: false,
      codigoConductor: null,
      matricula: null,
      vendorCodes: ['050'],
    }));
  });

  test('projects an explicitly selected REPARTIDOR with only the canonical vendor code', async () => {
    const { repository, resolver } = harness({
      user: profile({ permitePreventa: true, permiteReparto: true, matricula: '1234ABC' }),
    });

    await expect(resolver.resolve({ code: '050', selectedRole: 'REPARTIDOR' })).resolves.toEqual(
      expect.objectContaining({
        role: 'REPARTIDOR',
        isRepartidor: true,
        codigoConductor: '050',
        matricula: '1234ABC',
        vendorCodes: ['050'],
        vendedorCodes: ['050'],
      }),
    );
    expect(repository.getVendorVisibilityScope).not.toHaveBeenCalled();
  });

  test('derives manager behavior from the ERP jefe flag for any canonical code', async () => {
    const { repository, resolver } = harness({
      user: profile({ code: 'MGR7', isJefeVentas: true, permitePreventa: true }),
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

  test('projects only the selected COMERCIAL role and never retains manager scope', async () => {
    const { resolver } = harness({
      user: profile({
        isJefeVentas: true,
        permitePreventa: true,
        permiteReparto: true,
        matricula: '1234ABC',
      }),
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
  });

  test('keeps JEFE supervision when Perfil Reparto is selected even with ERP driver flag', async () => {
    const { repository, resolver } = harness({
      user: profile({
        isJefeVentas: true,
        permitePreventa: true,
        permiteReparto: true,
        matricula: '1234ABC',
      }),
    });
    repository.getVendorVisibilityScope.mockResolvedValue(['050', 'TEAM']);

    await expect(resolver.resolve({ code: '050', selectedRole: 'REPARTIDOR' })).resolves.toEqual(
      expect.objectContaining({
        role: 'JEFE_VENTAS',
        activeMode: 'REPARTIDOR',
        availableRoles: ['COMERCIAL', 'JEFE_VENTAS'],
        isJefeVentas: true,
        isRepartidor: false,
        codigoConductor: null,
        matricula: null,
        vendorCodes: ['050', 'TEAM'],
      }),
    );
    expect(repository.getVendorVisibilityScope).toHaveBeenCalledWith('050', { role: 'JEFE_VENTAS' });
  });

  test('projects ALMACEN only as a manager UI mode without minting a new role', async () => {
    const { resolver } = harness({ user: profile({ isJefeVentas: true, permitePreventa: true }) });

    await expect(resolver.resolve({ code: '050', selectedMode: 'ALMACEN' })).resolves.toEqual(
      expect.objectContaining({
        role: 'JEFE_VENTAS', activeMode: 'ALMACEN', isJefeVentas: true,
        availableRoles: ['COMERCIAL', 'JEFE_VENTAS'],
        availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
      }),
    );
  });

  test('projects REPARTIDOR as JEFE supervision mode without personal association', async () => {
    const { repository, resolver } = harness({
      user: profile({ code: 'J17', isJefeVentas: true, permitePreventa: true }),
    });
    repository.getVendorVisibilityScope.mockResolvedValue(['J17', 'TEAM']);

    await expect(resolver.resolve({
      code: 'j17',
      selectedRole: 'JEFE_VENTAS',
      selectedMode: 'REPARTIDOR',
    })).resolves.toEqual(expect.objectContaining({
      role: 'JEFE_VENTAS',
      activeMode: 'REPARTIDOR',
      isJefeVentas: true,
      isRepartidor: false,
      codigoConductor: null,
      matricula: null,
      vendorCodes: ['J17', 'TEAM'],
    }));
  });

  test('uses production JEFE visibility lookup while emitting normalized ADMIN claims', async () => {
    const { repository, resolver } = harness({
      user: profile({ code: 'A17', tipoVendedor: ' admin ', permitePreventa: true }),
    });
    await expect(resolver.resolve({ code: 'a17' })).resolves.toEqual(expect.objectContaining({
      id: 'VA17',
      role: 'ADMIN',
      availableRoles: ['COMERCIAL', 'ADMIN'],
      activeMode: 'COMERCIAL',
      availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
      isJefeVentas: false,
      isRepartidor: false,
      codigoConductor: null,
      matricula: null,
      vendorCodes: ['A17', '051', 'UNK'],
      tipoVendedor: 'admin',
    }));
    expect(repository.getVendorVisibilityScope).toHaveBeenCalledWith('A17', { role: 'JEFE_VENTAS' });
  });

  test('preserves JEFE visibility when an ADMIN profile is also a sales manager', async () => {
    const { repository, resolver } = harness({
      user: profile({
        code: 'A17',
        tipoVendedor: ' admin ',
        isJefeVentas: true,
        permitePreventa: true,
      }),
    });
    repository.getVendorVisibilityScope.mockResolvedValue(['A17', 'TEAM']);

    await expect(resolver.resolve({ code: 'a17' })).resolves.toEqual(expect.objectContaining({
      role: 'ADMIN',
      availableRoles: ['COMERCIAL', 'ADMIN', 'JEFE_VENTAS'],
      activeMode: 'COMERCIAL',
      isJefeVentas: true,
      vendorCodes: ['A17', 'TEAM'],
    }));
    expect(repository.getVendorVisibilityScope).toHaveBeenCalledWith('A17', { role: 'JEFE_VENTAS' });
  });

  test('projects REPARTIDOR as ADMIN supervision mode without personal association', async () => {
    const { repository, resolver } = harness({
      user: profile({ code: 'A17', tipoVendedor: ' admin ', permitePreventa: true }),
    });
    repository.getVendorVisibilityScope.mockResolvedValue(['A17', 'TEAM']);

    await expect(resolver.resolve({
      code: 'a17',
      selectedRole: 'ADMIN',
      selectedMode: 'REPARTIDOR',
    })).resolves.toEqual(expect.objectContaining({
      role: 'ADMIN',
      activeMode: 'REPARTIDOR',
      isJefeVentas: false,
      isRepartidor: false,
      codigoConductor: null,
      matricula: null,
      vendorCodes: ['A17', 'TEAM'],
    }));
  });

  test('gives ADMIN supervision precedence over a personal ERP repartidor flag', async () => {
    const { repository, resolver } = harness({
      user: profile({
        code: 'A17',
        tipoVendedor: ' admin ',
        permitePreventa: true,
        permiteReparto: true,
        matricula: '1234ABC',
      }),
    });
    repository.getVendorVisibilityScope.mockResolvedValue(['A17', 'TEAM']);

    await expect(resolver.resolve({ code: 'a17', selectedRole: 'REPARTIDOR' })).resolves.toEqual(
      expect.objectContaining({
        role: 'ADMIN',
        availableRoles: ['COMERCIAL', 'ADMIN'],
        activeMode: 'REPARTIDOR',
        availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
        isJefeVentas: false,
        isRepartidor: false,
        codigoConductor: null,
        matricula: null,
        vendorCodes: ['A17', 'TEAM'],
      }),
    );
    expect(repository.getVendorVisibilityScope).toHaveBeenCalledWith('A17', { role: 'JEFE_VENTAS' });
  });

  test('rejects ALMACEN for non-managers and every role not associated with the subject', async () => {
    const { resolver } = harness();

    await expect(resolver.resolve({ code: '050', selectedMode: 'ALMACEN' })).rejects.toMatchObject({
      name: 'AuthClaimsError', status: 403, code: 'ROLE_NOT_ASSOCIATED',
    });
    await expect(resolver.resolve({ code: '050', selectedRole: 'JEFE_VENTAS' })).rejects.toBeInstanceOf(AuthClaimsError);
    await expect(resolver.resolve({ code: '050', selectedRole: 'ADMIN' })).rejects.toMatchObject({
      name: 'AuthClaimsError', status: 403, code: 'ROLE_NOT_ASSOCIATED',
    });
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
    repository.findByCode.mockRejectedValue(new Error('sensitive DB detail'));

    await expect(resolver.resolve({ code: '050' })).rejects.toMatchObject({
      status: 503,
      code: 'AUTH_PROFILE_UNAVAILABLE',
      message: 'Perfil de autorización no disponible',
    });
  });
});
