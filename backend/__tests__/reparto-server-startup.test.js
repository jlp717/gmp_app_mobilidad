'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const serverPath = path.join(backendRoot, 'server.js');
const appPath = path.join(backendRoot, 'app.js');

function loadServerSource() {
  return fs.readFileSync(serverPath, 'utf8');
}

function loadAppSource() {
  return fs.readFileSync(appPath, 'utf8');
}

function invalidRouteModeProcess(overrides = {}) {
  return spawnSync(process.execPath, ['server.js'], {
    cwd: backendRoot,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SKIP_PRODUCTION_CONFIG_VALIDATION: 'true',
      USE_TS_ROUTES: 'true',
      USE_DDD_ROUTES: 'true',
      ...overrides,
    },
  });
}

function invalidStartupMutationProcess(overrides = {}) {
  return spawnSync(process.execPath, ['server.js'], {
    cwd: backendRoot,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SKIP_PRODUCTION_CONFIG_VALIDATION: 'true',
      USE_TS_ROUTES: 'false',
      USE_DDD_ROUTES: 'false',
      REPARTO_ENVIRONMENT: 'test',
      REPARTO_TABLE_SET: 'isolated_test',
      REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
      REPARTO_WRITES_ENABLED: 'false',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
      REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
      REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'true',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
      REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
      ODBC_DSN: 'GMP',
      REPARTO_STARTUP_REPARTO_MIGRATIONS: 'true',
      ...overrides,
    },
  });
}

describe('reparto server startup wiring', () => {
  test('resolves route mode before importing the composed application', () => {
    const source = loadServerSource();
    const resolverPosition = source.indexOf("require('./config/reparto-runtime')");
    const appPosition = source.indexOf("const app = require('./app')");

    expect(resolverPosition).toBeGreaterThanOrEqual(0);
    expect(resolverPosition).toBeLessThan(appPosition);
    expect(source).toContain('resolveRepartoRouteMode(process.env)');
    expect(source).toContain('resolveRepartoRuntime(process.env)');
    expect(source).toContain("error.code = 'INVALID_REPARTO_ROUTE_MODE'");
    expect(source).not.toContain('const app = express()');
  });

  test.each([
    [{ USE_TS_ROUTES: 'true', USE_DDD_ROUTES: 'true' }],
    [{ USE_TS_ROUTES: 'true', USE_DDD_ROUTES: 'false' }],
    [{ USE_TS_ROUTES: 'not-a-boolean', USE_DDD_ROUTES: 'false' }],
  ])('rejects invalid route flags before a server can listen: %j', (overrides) => {
    const result = invalidRouteModeProcess(overrides);
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(output).toContain('Invalid reparto route mode');
    if (overrides.USE_TS_ROUTES === 'true' && overrides.USE_DDD_ROUTES === 'false') {
      expect(output).toContain('USE_TS_ROUTES is retired; only false is supported');
    }
    expect(output).not.toContain('Listening on ALL interfaces');
  });

  test('requiring app exits naturally without opening listeners or cleanup timers', () => {
    const importProbe = [
      'let intervalCalls = 0;',
      'const originalSetInterval = global.setInterval;',
      'global.setInterval = (...args) => { intervalCalls += 1; return originalSetInterval(...args); };',
      "require('./app');",
      "const ignored = new Set([process.stdin, process.stdout, process.stderr]);",
      "const handles = process._getActiveHandles().filter((handle) => !ignored.has(handle)).map((handle) => handle.constructor.name);",
      "console.error(JSON.stringify({ intervalCalls, handles }));",
      "process.exit(intervalCalls === 0 && handles.length === 0 ? 0 : 2);",
    ].join(' ');
    const result = spawnSync(process.execPath, ['-e', importProbe], {
      cwd: backendRoot,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, NODE_ENV: 'test', USE_TS_ROUTES: 'false', USE_DDD_ROUTES: 'false' },
    });

    expect(result.error).toBeUndefined();
    expect({ status: result.status, diagnostics: result.stderr.trim() }).toEqual({
      status: 0,
      diagnostics: JSON.stringify({ intervalCalls: 0, handles: [] }),
    });
  });

  test('keeps PM2 port 3335 as the default while honouring explicit PORT', () => {
    const source = loadServerSource();

    expect(source).toContain('const PORT = process.env.PORT || 3335;');
    expect(source).not.toContain('const PORT = process.env.PORT || 3334;');
  });

  test('asserts startup mutation policy before importing app DB dependencies', () => {
    const source = loadServerSource();
    const policyPosition = source.indexOf('assertRepartoStartupMutationPolicy({');
    const appImportPosition = source.indexOf("const app = require('./app')");

    expect(policyPosition).toBeGreaterThanOrEqual(0);
    expect(policyPosition).toBeLessThan(appImportPosition);
  });

  test('rejects contradictory startup mutation settings before initDb or listen', () => {
    const result = invalidStartupMutationProcess();
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(output).toContain('Invalid reparto startup mutation policy');
    expect(output).not.toContain('Configuration validated successfully');
    expect(output).not.toContain('Listening on ALL interfaces');
  });

  test('contains no automatic schema or module initializer wiring', () => {
    const source = loadServerSource();
    const startServerSource = source.slice(
      source.indexOf('async function startServer()'),
      source.indexOf('function startRuntimeMonitoring()'),
    );

    expect(startServerSource).not.toMatch(
      /initAllTables|initWarehouseTables|initCommissionTables|initPedidosTables|initKpiModule|initKpiTables/,
    );
    expect(startServerSource).not.toMatch(/\b\w+\.init(?:\w*Tables|\w*Module)\s*\(/);
    expect(source).toContain('await initDb();');
    expect(source).toContain('await initSchemaCheck();');
    expect(loadAppSource()).toContain("app.use('/api/kpi', kpiModule.kpiRoutes);");
  });

  test('connects canonical app once and verifies finance catalog before listen', () => {
    const serverSource = loadServerSource();
    const appSource = loadAppSource();
    const canonicalMount = "app.use('/api/repartidor-finanzas', verifyToken, repartoFinanzasWriteGuard, canonicalRepartidorFinanzasRoutes);";
    const firstFamilyBranch = appSource.indexOf('if (USE_TS_ROUTES && global.__TS_APP__)');

    expect(appSource.split(canonicalMount)).toHaveLength(2);
    expect(appSource.indexOf(canonicalMount)).toBeGreaterThan(0);
    expect(appSource.indexOf(canonicalMount)).toBeLessThan(firstFamilyBranch);
    expect(appSource).toContain('createRepartidorLiquidacionBootstrap({');
    expect(appSource).toContain('setCanonicalLiquidacionService(');
    expect(serverSource).toContain('await canonicalLiquidacionBootstrap.verifyCatalogReadOnly();');
    expect(appSource).toContain('canonicalLiquidacionBootstrap.enabled === true');
    expect(appSource).toContain('&& liquidacionWritable');
    expect(serverSource.indexOf('await canonicalLiquidacionBootstrap.verifyCatalogReadOnly();'))
      .toBeGreaterThan(serverSource.indexOf('await initDb();'));
    expect(serverSource.indexOf('await canonicalLiquidacionBootstrap.verifyCatalogReadOnly();'))
      .toBeLessThan(serverSource.indexOf('app.listen(PORT, BIND_HOST'));
    expect(serverSource).toContain("const BIND_HOST = String(process.env.GMP_BIND_HOST || '0.0.0.0')");
    expect(serverSource).toContain("new Set(['0.0.0.0', '127.0.0.1', '::', '::1'])");
    expect(serverSource).not.toContain('Failed to load TS routes; falling back');
    expect(serverSource).not.toContain('Failed to load DDD routes; falling back');
  });
});
