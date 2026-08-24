'use strict';

const {
  resolveVendorEmail,
  resolveRoleEmails,
  resolveDeliveryVarianceRecipients,
  resolveDayRouteComercialCodes,
  resolveLiquidacionRecipients,
  clearCache,
  normalizeVendorCode,
} = require('../services/staff-email-directory-service');

describe('staff-email-directory-service', () => {
  beforeEach(() => {
    clearCache();
  });

  test('normalizeVendorCode uppercases and rejects junk', () => {
    expect(normalizeVendorCode('a2')).toBe('A2');
    expect(normalizeVendorCode('30')).toBe('30');
    expect(normalizeVendorCode('')).toBe('');
    expect(normalizeVendorCode('***')).toBe('');
  });

  test('resolveVendorEmail uses VDDX first then V_DIM_VENDEDOR fallback', async () => {
    const query = jest.fn(async (sql) => {
      if (sql.includes('DSEDAC.VDDX')) {
        return [{ EMAIL: ' ', NOMBRE: '30 CARLOS' }];
      }
      if (sql.includes('V_DIM_VENDEDOR')) {
        return [{ EMAIL: 'carlos@example.test' }];
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const email = await resolveVendorEmail('30', { query });
    expect(email).toBe('carlos@example.test');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual(['30']);
    expect(query.mock.calls[1][1]).toEqual(['30']);
  });

  test('resolveVendorEmail returns null and does not invent when empty', async () => {
    const query = jest.fn(async () => [{ EMAIL: '' }]);
    const email = await resolveVendorEmail('A2', { query });
    expect(email).toBeNull();
  });

  test('resolveRoleEmails prefers NAME_MATCH and skips vendor when !requireName misses', async () => {
    const query = jest.fn(async (sql, params) => {
      if (sql.includes('ROLE_TARGETS')) {
        return [
          { ROLE_KEY: 'CARLOS_CORBALAN', VENDOR_CODE: '30', NAME_MATCH: '!CORBALAN' },
          { ROLE_KEY: 'JAVIER_LACAL', VENDOR_CODE: 'A2', NAME_MATCH: 'LACAL' },
        ];
      }
      if (sql.includes('LIKE ?') && params[0] === '%CORBALAN%') {
        return []; // not in ERP yet
      }
      if (sql.includes('LIKE ?') && params[0] === '%LACAL%') {
        return [{ CODIGO: 'A2', NOMBRE: 'A2 JAVIER LACAL', EMAIL: 'javier@example.test' }];
      }
      if (sql.includes('VDDX') && params[0] === '30') {
        throw new Error('must not fall back to vendor 30 when !CORBALAN misses');
      }
      return [];
    });

    const roles = await resolveRoleEmails(['CARLOS_CORBALAN', 'JAVIER_LACAL'], {
      query,
      env: {
        NODE_ENV: 'test',
        REPARTO_ENVIRONMENT: 'test',
        REPARTO_TABLE_SET: 'isolated_test',
        ODBC_DSN: 'GMP',
        REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
        REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
        REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
        REPARTO_WRITES_ENABLED: 'false',
        REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
        REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
        REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
        REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
        REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
        REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
      },
    });

    expect(roles.find((r) => r.roleKey === 'CARLOS_CORBALAN')).toEqual(
      expect.objectContaining({ email: null, resolvedVia: null }),
    );
    expect(roles.find((r) => r.roleKey === 'JAVIER_LACAL')).toEqual(
      expect.objectContaining({
        email: 'javier@example.test',
        vendorCode: 'A2',
        resolvedVia: 'NAME_MATCH',
      }),
    );
  });

  test('preserves required roles when the role catalog query fails', async () => {
    const query = jest.fn(async (sql) => {
      if (sql.includes('ROLE_TARGETS')) throw new Error('DB2 unavailable');
      return [];
    });

    const roles = await resolveRoleEmails(['CARLOS_CORBALAN', 'JAVIER_LACAL'], {
      query,
      env: isolatedEnv,
    });

    expect(roles).toEqual([
      expect.objectContaining({ roleKey: 'CARLOS_CORBALAN', email: null }),
      expect.objectContaining({ roleKey: 'JAVIER_LACAL', email: null }),
    ]);
  });
  test('resolveRoleEmails maps role keys to live vendor emails', async () => {
    const query = jest.fn(async (sql, params) => {
      if (sql.includes('NOTIFICATION_ROLE_TARGETS') || sql.includes('TEST_NOTIFICATION_ROLE_TARGETS')) {
        expect(params).toEqual(expect.arrayContaining(['OFICINA', 'JAVIER_LACAL']));
        return [
          { ROLE_KEY: 'OFICINA', VENDOR_CODE: '32', NAME_MATCH: null },
          { ROLE_KEY: 'JAVIER_LACAL', VENDOR_CODE: 'A2', NAME_MATCH: null },
        ];
      }
      if (sql.includes('DSEDAC.VDDX') && params[0] === '32') {
        return [{ EMAIL: 'oficina@example.test', NOMBRE: 'OFICINA' }];
      }
      if (sql.includes('DSEDAC.VDDX') && params[0] === 'A2') {
        return [{ EMAIL: '', NOMBRE: 'A2 JAVIER LACAL' }];
      }
      if (sql.includes('V_DIM_VENDEDOR') && params[0] === 'A2') {
        return [{ EMAIL: '' }];
      }
      return [];
    });

    const roles = await resolveRoleEmails(['OFICINA', 'JAVIER_LACAL'], {
      query,
      env: {
        NODE_ENV: 'test',
        REPARTO_ENVIRONMENT: 'test',
        REPARTO_TABLE_SET: 'isolated_test',
        ODBC_DSN: 'GMP',
        REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
        REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
        REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
        REPARTO_WRITES_ENABLED: 'false',
        REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
        REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
        REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
        REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
        REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
        REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
      },
    });

    expect(roles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        roleKey: 'OFICINA',
        vendorCode: '32',
        email: 'oficina@example.test',
      }),
      expect.objectContaining({
        roleKey: 'JAVIER_LACAL',
        vendorCode: 'A2',
        email: null,
      }),
    ]));
  });

  test('resolveDeliveryVarianceRecipients dedupes emails across roles and actors', async () => {
    const query = jest.fn(async (sql, params) => {
      if (sql.includes('ROLE_TARGETS')) {
        return [
          { ROLE_KEY: 'OFICINA', VENDOR_CODE: '32', NAME_MATCH: null },
          { ROLE_KEY: 'CARLOS_CORBALAN', VENDOR_CODE: '30', NAME_MATCH: null },
          { ROLE_KEY: 'JAVIER_LACAL', VENDOR_CODE: 'A2', NAME_MATCH: null },
        ];
      }
      const code = params[0];
      const map = {
        '94': 'rep@example.test',
        '15': 'com@example.test',
        '32': 'oficina@example.test',
        '30': 'carlos@example.test',
        A2: '',
      };
      if (sql.includes('VDDX')) return [{ EMAIL: map[code] || '' }];
      if (sql.includes('V_DIM_VENDEDOR')) return [{ EMAIL: '' }];
      return [];
    });

    const env = {
      NODE_ENV: 'test',
      REPARTO_ENVIRONMENT: 'test',
      REPARTO_TABLE_SET: 'isolated_test',
      ODBC_DSN: 'GMP',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
      REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
      REPARTO_WRITES_ENABLED: 'false',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
      REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
      REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
      REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
      REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    };

    const result = await resolveDeliveryVarianceRecipients({
      repartidorId: '94',
      comercialCode: '15',
    }, { query, env });

    expect(result.emails.sort()).toEqual([
      'carlos@example.test',
      'com@example.test',
      'rep@example.test',
    ].sort());
    expect(result.details.find((d) => d.label === 'JAVIER_LACAL').email).toBeNull();
  });

  const isolatedEnv = {
    NODE_ENV: 'test',
    REPARTO_ENVIRONMENT: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    ODBC_DSN: 'GMP',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    REPARTO_WRITES_ENABLED: 'false',
    REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
    REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
    REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
    REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
    REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
  };

  test('resolveLiquidacionRecipients includes only required roles and repartidor', async () => {
    const query = jest.fn(async (sql, params) => {
      if (sql.includes('ROLE_TARGETS')) {
        return [
          { ROLE_KEY: 'OFICINA', VENDOR_CODE: '32', NAME_MATCH: null },
          { ROLE_KEY: 'CARLOS_CORBALAN', VENDOR_CODE: '30', NAME_MATCH: null },
          { ROLE_KEY: 'JAVIER_LACAL', VENDOR_CODE: 'A2', NAME_MATCH: null },
        ];
      }
      const code = params[0];
      const map = {
        '08': 'rep@example.test',
        '15': 'com15@example.test',
        '80': 'com80@example.test',
        '32': 'oficina@example.test',
        '30': 'carlos@example.test',
        A2: '',
      };
      if (sql.includes('VDDX')) return [{ EMAIL: map[code] || '' }];
      if (sql.includes('V_DIM_VENDEDOR')) return [{ EMAIL: '' }];
      return [];
    });

    const result = await resolveLiquidacionRecipients({
      repartidorId: '08',
      comercialCodes: ['15', '80', '08'],
    }, { query, env: isolatedEnv });

    expect(result.emails.sort()).toEqual([
      'carlos@example.test',
      'rep@example.test',
    ].sort());
    expect(result.details.find((d) => d.label === 'comercial:08')).toBeUndefined();
  });

  test('resolveDayRouteComercialCodes unions confirmations and cobros of the day', async () => {
    const query = jest.fn(async (sql) => {
      if (sql.includes('TEST_REPARTO_CONFIRMACIONES')) {
        return [{ COMERCIAL: '15' }, { COMERCIAL: ' 80 ' }];
      }
      if (sql.includes('TEST_REPARTIDOR_COBROS')) {
        return [{ COMERCIAL: '15' }, { COMERCIAL: 'A2' }];
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const codes = await resolveDayRouteComercialCodes({
      repartidorId: '08',
      date: '2026-08-14',
    }, { query, env: isolatedEnv });

    expect(codes.sort()).toEqual(['15', '80', 'A2'].sort());
    expect(query.mock.calls[0][1]).toEqual(['08', '2026-08-14']);
    expect(query.mock.calls[1][1]).toEqual(['08', 14, 8, 2026]);
  });
});
