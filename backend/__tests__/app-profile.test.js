'use strict';

const {
  applyAppProfile,
  resolveAppProfile,
  sanitizeAppProfile,
} = require('../config/app-profile');

describe('APP_ENV profile resolver', () => {
  test.each([
    ['test', 'test', 'test', 'isolated_test'],
    ['demo', 'staging', 'staging', 'isolated_test'],
    ['production', 'production', 'production', 'production'],
  ])('maps %s deterministically', (appEnv, nodeEnv, repartoEnv, tableSet) => {
    const result = resolveAppProfile({ APP_ENV: appEnv });

    expect(result.valid).toBe(true);
    expect(result.assignments).toMatchObject({
      NODE_ENV: nodeEnv,
      REPARTO_ENVIRONMENT: repartoEnv,
      REPARTO_TABLE_SET: tableSet,
      DB2_READ_SCHEMA: 'DSEDAC',
      DB2_WRITE_SCHEMA: 'JAVIER',
      PEDIDOS_CONFIRMATION_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
      REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
      COMERCIAL_ERP_READ_TEST: 'false',
      ALLOW_DSEDAC_APP_BUFFERS: 'false',
    });
  });

  test.each(['test', 'demo', 'production'])(
    '%s assignments satisfy the existing reparto runtime gate',
    (appEnv) => {
      const { resolveRepartoRuntime } = require('../config/reparto-runtime');
      const profile = resolveAppProfile({ APP_ENV: appEnv });
      const runtime = resolveRepartoRuntime({
        ...profile.assignments,
        ODBC_DSN: 'GMP',
        REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
      });

      expect(runtime.errors).toEqual([]);
      expect(runtime.valid).toBe(true);
    },
  );

  test.each(['test', 'demo'])('%s keeps live reads and isolated TEST_* writes', (appEnv) => {
    const result = resolveAppProfile({ APP_ENV: appEnv });

    expect(result.assignments).toMatchObject({
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
      REPARTO_WRITES_ENABLED: 'true',
      REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
      PEDIDOS_EXPORT_TO_SYSTEM: 'false',
      PEDIDOS_DSEDAC_EXPORT_APPROVED: 'false',
      PEDIDOS_DSEDAC_STORAGE_APPROVED: 'false',
    });
    expect(result.publicProfile).toMatchObject({
      verified: true,
      readSchema: 'DSEDAC',
      writeSchema: 'JAVIER',
      tableSet: 'isolated_test',
      erpExportEnabled: false,
      writesEnabled: true,
      productionWritesEnabled: false,
    });
  });

  test('production is fail-closed and APP_ENV alone never enables mutations', () => {
    const result = resolveAppProfile({ APP_ENV: 'production' });

    expect(result.valid).toBe(true);
    expect(result.assignments).toMatchObject({
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
      REPARTO_WRITES_ENABLED: 'false',
      REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
      REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
      REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
      PEDIDOS_EXPORT_TO_SYSTEM: 'false',
      PEDIDOS_DSEDAC_EXPORT_APPROVED: 'false',
      PEDIDOS_DSEDAC_STORAGE_APPROVED: 'false',
    });
    expect(result.publicProfile).toMatchObject({
      profile: 'production',
      verified: true,
      erpExportEnabled: false,
      writesEnabled: false,
      productionWritesEnabled: false,
    });
    const serverSource = require('fs').readFileSync(
      require('path').resolve(__dirname, '..', 'server.js'),
      'utf8',
    );
    expect(serverSource).toContain('if (appProfile.writesEnabled)');
    expect(serverSource).toContain('Mutation schedulers disabled by active profile');
    expect(serverSource).toContain('KPI mutation scheduler disabled by active profile');
    expect(serverSource).toContain('KPI mutation scheduler remains disabled after DB reconnect');
  });

  test('rejects a missing executable profile and contradictory legacy routing', () => {
    expect(resolveAppProfile({}).valid).toBe(false);

    const contradiction = resolveAppProfile({
      APP_ENV: 'demo',
      NODE_ENV: 'production',
      DB2_WRITE_SCHEMA: 'DSEDAC',
      COMERCIAL_ERP_READ_TEST: 'true',
    });

    expect(contradiction.valid).toBe(false);
    expect(contradiction.errors.join(' ')).toContain('NODE_ENV');
    expect(contradiction.errors.join(' ')).toContain('DB2_WRITE_SCHEMA');
    expect(contradiction.errors.join(' ')).toContain('COMERCIAL_ERP_READ_TEST');
  });

  test('applies a valid profile atomically only after all contradictions pass', () => {
    const target = { APP_ENV: 'test', NODE_ENV: 'production' };
    expect(() => applyAppProfile(target)).toThrow(/NODE_ENV/);
    expect(target.REPARTO_TABLE_SET).toBeUndefined();

    delete target.NODE_ENV;
    const applied = applyAppProfile(target);
    expect(applied.profile).toBe('test');
    expect(target.NODE_ENV).toBe('test');
    expect(target.REPARTO_TABLE_SET).toBe('isolated_test');
  });

  test('legacy config imports cannot reload env files after profile application', () => {
    const originalEnv = process.env;
    process.env = { APP_ENV: 'test' };
    try {
      jest.isolateModules(() => {
        const fs = require('fs');
        const existsSpy = jest.spyOn(fs, 'existsSync');
        const isolatedProfile = require('../config/app-profile');
        isolatedProfile.applyAppProfile(process.env);
        const { loadEnv } = require('../config/load-env');
        existsSpy.mockClear();

        expect(loadEnv('C:\\must-not-be-read')).toBeNull();
        expect(existsSpy).not.toHaveBeenCalled();
      });
    } finally {
      process.env = originalEnv;
      jest.restoreAllMocks();
    }
  });

  test('APP_ENV demo never selects production env files from inherited NODE_ENV', () => {
    const { candidateEnvFiles } = require('../config/load-env');

    expect(candidateEnvFiles({
      APP_ENV: 'demo',
      NODE_ENV: 'production',
    })).toEqual(['.env']);
    expect(candidateEnvFiles({
      NODE_ENV: 'production',
    })).toEqual(['.env', '.env.production', '.env.produccion']);
  });

  test('sanitized diagnostics never expose credentials, DSN or connection strings', () => {
    const result = resolveAppProfile({
      APP_ENV: 'test',
      ODBC_DSN: 'GMP',
      DB_USER: 'secret-user',
      DB_PASSWORD: 'secret-password',
      DB_CONNECTION_STRING: 'secret-connection',
    });
    const serialized = JSON.stringify(sanitizeAppProfile(result));

    expect(serialized).not.toContain('secret-user');
    expect(serialized).not.toContain('secret-password');
    expect(serialized).not.toContain('secret-connection');
    expect(serialized).not.toContain('GMP');
    expect(Object.keys(sanitizeAppProfile(result)).sort()).toEqual([
      'erpExportEnabled',
      'productionWritesEnabled',
      'profile',
      'readSchema',
      'tableSet',
      'verified',
      'writeSchema',
      'writesEnabled',
    ]);
  });

  test('environment verifier builds only a parameterized QSYS2 SELECT', () => {
    const {
      buildCatalogCheck,
      expectedCatalogObjects,
    } = require('../scripts/tools/verify-app-environment');
    const objects = expectedCatalogObjects({ tableSet: 'isolated_test' });
    const check = buildCatalogCheck(objects);

    expect(check.sql).toMatch(/^SELECT /);
    expect(check.sql).toContain('QSYS2.SYSTABLES');
    expect(check.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE)\b/);
    expect(check.params).toContain('TEST_PEDIDOS_CAB');
    expect(check.params).toContain('TEST_PEDIDO_STATE_EVENTS');
    expect(check.params).toContain('TEST_LIQUIDACION_COMERCIAL');
    expect(check.params).toContain('TEST_DEVOLUCIONES_COMERCIAL');
    expect(check.params).toContain('DSEDAC');
    expect(check.params).toContain('DSED');
  });

  test('database verifier uses a dedicated connection and executes SELECT only', async () => {
    const {
      expectedCatalogObjects,
      verifyDatabaseReadOnly,
    } = require('../scripts/tools/verify-app-environment');
    const objects = expectedCatalogObjects({ tableSet: 'isolated_test' });
    const queries = [];
    const close = jest.fn().mockResolvedValue(undefined);
    const { APP_BUFFER_REQUIREMENTS } = require('../utils/db2-app-buffer-capability');
    const bufferObjects = objects.filter(({ table }) => (
      /(?:PEDIDO_STATE_EVENTS|LIQUIDACION_COMERCIAL|DEVOLUCIONES_COMERCIAL)$/.test(table)
    ));
    const connect = jest.fn().mockResolvedValue({
      query: jest.fn().mockImplementation((sql, params) => {
        queries.push({ sql, params });
        if (/SYSDUMMY1/.test(sql)) return Promise.resolve([{ OK: 1 }]);
        if (/QSYS2\.SYSTABLES/.test(sql)) return Promise.resolve(objects.map(({ schema, table }) => ({
          TABLE_SCHEMA: schema,
          TABLE_NAME: table,
        })));
        if (/QSYS2\.SYSCOLUMNS/.test(sql)) return Promise.resolve(bufferObjects.flatMap(({ schema, table }) => {
          const logical = table.replace(/^TEST_/, '');
          return APP_BUFFER_REQUIREMENTS[logical].columns.map((spec) => ({
            TABLE_SCHEMA: schema,
            TABLE_NAME: table,
            COLUMN_NAME: spec.name,
            DATA_TYPE: spec.type,
            LENGTH: spec.length,
            NUMERIC_PRECISION: spec.precision,
            NUMERIC_SCALE: spec.scale,
            IS_NULLABLE: spec.nullable,
          }));
        }));
        if (/QSYS2\.SYSINDEXES/.test(sql)) return Promise.resolve(bufferObjects.flatMap(({ table }) => {
          const logical = table.replace(/^TEST_/, '');
          return [
            ...APP_BUFFER_REQUIREMENTS[logical].uniqueKeys.map((columns, keyIndex) => (
              columns.map((COLUMN_NAME, index) => ({
                TABLE_NAME: table,
                INDEX_NAME: `U_${keyIndex}`,
                IS_UNIQUE: 'U',
                COLUMN_NAME,
                ORDINAL_POSITION: index + 1,
              }))
            )),
            ...APP_BUFFER_REQUIREMENTS[logical].indexes.map((columns, keyIndex) => (
              columns.map((COLUMN_NAME, index) => ({
                TABLE_NAME: table,
                INDEX_NAME: `I_${keyIndex}`,
                IS_UNIQUE: 'D',
                COLUMN_NAME,
                ORDINAL_POSITION: index + 1,
              }))
            )),
          ].flat();
        }));
        if (/QSYS2\.SYSCHKCST/.test(sql)) return Promise.resolve(bufferObjects.flatMap(({ table }) => {
          const logical = table.replace(/^TEST_/, '');
          return APP_BUFFER_REQUIREMENTS[logical].checks.map((CHECK_CLAUSE, index) => ({
            TABLE_SCHEMA: 'JAVIER',
            TABLE_NAME: table,
            CONSTRAINT_NAME: `CK_${index}`,
            CHECK_CLAUSE,
          }));
        }));
        if (/QSYS2\.SYSCST/.test(sql)) return Promise.resolve(bufferObjects.flatMap(({ table }) => {
          const logical = table.replace(/^TEST_/, '');
          return APP_BUFFER_REQUIREMENTS[logical].primaryKey.map((COLUMN_NAME, index) => ({
            TABLE_SCHEMA: 'JAVIER',
            TABLE_NAME: table,
            CONSTRAINT_NAME: `PK_${logical}`,
            CONSTRAINT_TYPE: 'PRIMARY KEY',
            ENABLED: 'YES',
            COLUMN_NAME,
            ORDINAL_POSITION: index + 1,
          }));
        }));
        return Promise.resolve([]);
      }),
      close,
    });

    const result = await verifyDatabaseReadOnly(
      sanitizeAppProfile(resolveAppProfile({ APP_ENV: 'test' })),
      { connect },
    );

    expect(result).toMatchObject({ valid: true, readOnly: true, selectOne: true });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(queries).toHaveLength(7);
    for (const { sql } of queries) {
      expect(sql).toMatch(/^SELECT /);
      expect(sql).not.toMatch(/\b(CALL|INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE)\b/);
    }
  });

  test.each([
    ['missing APP_ENV', {}],
    ['contradictory table family', {
      profile: 'production',
      verified: true,
      readSchema: 'DSEDAC',
      writeSchema: 'JAVIER',
      tableSet: 'isolated_test',
    }],
  ])('database verifier rejects %s before opening a connection', async (_label, profile) => {
    const { verifyDatabaseReadOnly } = require('../scripts/tools/verify-app-environment');
    const connect = jest.fn();

    await expect(verifyDatabaseReadOnly(profile, { connect }))
      .rejects.toMatchObject({ code: 'APP_BUFFER_PROFILE_INVALID' });
    expect(connect).not.toHaveBeenCalled();
  });

  test('runtime profile HTTP handler exposes only the sanitized no-store contract', async () => {
    const express = require('express');
    const request = require('supertest');
    const { createRuntimeProfileHandler } = require('../config/app-profile');
    const app = express();
    app.get('/api/runtime-profile', createRuntimeProfileHandler(() => ({
      profile: 'demo',
      verified: true,
      readSchema: 'DSEDAC',
      writeSchema: 'JAVIER',
      tableSet: 'isolated_test',
      erpExportEnabled: false,
      writesEnabled: true,
      productionWritesEnabled: false,
      credentialMarker: 'must-not-leak',
      dsn: 'must-not-leak',
    })));

    const response = await request(app).get('/api/runtime-profile').expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      success: true,
      profile: {
        profile: 'demo',
        verified: true,
        readSchema: 'DSEDAC',
        writeSchema: 'JAVIER',
        tableSet: 'isolated_test',
        erpExportEnabled: false,
        writesEnabled: true,
        productionWritesEnabled: false,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  });

  test.each([
    '/api/auth/login',
    '/api/pedidos/create',
    '/api/pedidos/confirm/order-1',
    '/api/pedidos/cancel/order-1',
    '/api/cobros',
  ])('production fail-closed blocks %s before its handler', async (path) => {
    const express = require('express');
    const request = require('supertest');
    const { createAppProfileWriteGuard } = require('../config/app-profile');
    const query = jest.fn();
    const app = express();
    app.use(createAppProfileWriteGuard(() => ({
      profile: 'production',
      verified: true,
      readSchema: 'DSEDAC',
      writeSchema: 'JAVIER',
      tableSet: 'production',
      erpExportEnabled: false,
      writesEnabled: false,
      productionWritesEnabled: false,
    })));
    app.post(path, async (req, res) => {
      await query();
      res.json({ success: true });
    });

    const response = await request(app).post(path).send({}).expect(503);

    expect(response.body.code).toBe('APP_PROFILE_WRITES_DISABLED');
    expect(query).not.toHaveBeenCalled();
  });

  test('profile write guard preserves reads and explicit legacy test exemption', async () => {
    const express = require('express');
    const request = require('supertest');
    const { createAppProfileWriteGuard } = require('../config/app-profile');
    const app = express();
    app.use(createAppProfileWriteGuard(
      () => ({ verified: false }),
      { allowUnverifiedForTests: true },
    ));
    app.post('/legacy-test', (req, res) => res.json({ success: true }));
    app.use(createAppProfileWriteGuard(() => ({
      profile: 'production',
      verified: true,
      writesEnabled: false,
    })));
    app.get('/read-only', (req, res) => res.json({ success: true }));

    await request(app).post('/legacy-test').expect(200);
    await request(app).get('/read-only').expect(200);
  });

  test.each([
    [
      'unverified runtime',
      { verified: false },
    ],
    [
      'production without the production write gate',
      {
        profile: 'production',
        verified: true,
        writesEnabled: true,
        productionWritesEnabled: false,
      },
    ],
  ])('profile write guard blocks %s', async (_label, profile) => {
    const express = require('express');
    const request = require('supertest');
    const { createAppProfileWriteGuard } = require('../config/app-profile');
    const app = express();
    const handler = jest.fn((req, res) => res.json({ success: true }));
    app.use(createAppProfileWriteGuard(
      () => profile,
      { allowUnverifiedForTests: false },
    ));
    app.post('/write', handler);

    const response = await request(app).post('/write').expect(503);

    expect(response.body.code).toBe('APP_PROFILE_WRITES_DISABLED');
    expect(handler).not.toHaveBeenCalled();
  });

  test('all package server entrypoints use the canonical APP_ENV-gated server', () => {
    const scripts = require('../package.json').scripts;
    expect(scripts.start).toContain('server.js');
    expect(scripts.dev).toContain('server.js');
    expect(scripts.api).toContain('server.js');
    expect(`${scripts.start} ${scripts.dev} ${scripts.api}`).not.toContain('src/');
  });
});
