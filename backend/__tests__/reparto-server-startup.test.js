'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const serverPath = path.join(backendRoot, 'server.js');

function loadServerSource() {
  return fs.readFileSync(serverPath, 'utf8');
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
  test('uses the centralized runtime and route-mode resolvers before route mounting', () => {
    const source = loadServerSource();
    const resolverPosition = source.indexOf("require('./config/reparto-runtime')");
    const appPosition = source.indexOf('const app = express()');

    expect(resolverPosition).toBeGreaterThanOrEqual(0);
    expect(resolverPosition).toBeLessThan(appPosition);
    expect(source).toContain('resolveRepartoRouteMode(process.env)');
    expect(source).toContain('resolveRepartoRuntime(process.env)');
    expect(source).toContain("error.code = 'INVALID_REPARTO_ROUTE_MODE'");
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

  test('keeps PM2 port 3335 as the default while honouring explicit PORT', () => {
    const source = loadServerSource();

    expect(source).toContain('const PORT = process.env.PORT || 3335;');
    expect(source).not.toContain('const PORT = process.env.PORT || 3334;');
  });

  test('asserts the startup mutation policy before loading DB dependencies', () => {
    const source = loadServerSource();
    const policyPosition = source.indexOf('assertRepartoStartupMutationPolicy({');
    const dbImportPosition = source.indexOf("require('./config/db')");

    expect(policyPosition).toBeGreaterThanOrEqual(0);
    expect(policyPosition).toBeLessThan(dbImportPosition);
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
      source.indexOf('// ==================== OPTIMIZATION MONITORING ENDPOINTS'),
    );

    expect(startServerSource).not.toMatch(
      /initAllTables|initWarehouseTables|initCommissionTables|initPedidosTables|initKpiModule|initKpiTables/,
    );
    expect(startServerSource).not.toMatch(/\b\w+\.init(?:\w*Tables|\w*Module)\s*\(/);
    expect(source).toContain('await initDb();');
    expect(source).toContain('await initSchemaCheck();');
    expect(source).toContain("app.use('/api/kpi', kpiModule.kpiRoutes);");
  });

  test('mounts the canonical finance contract once and before route-family selection', () => {
    const source = loadServerSource();
    const canonicalMount = "app.use('/api/repartidor-finanzas', verifyToken, repartoFinanzasWriteGuard, canonicalRepartidorFinanzasRoutes);";
    const firstFamilyBranch = source.indexOf('if (USE_TS_ROUTES && global.__TS_APP__)');

    expect(source.split(canonicalMount)).toHaveLength(2);
    expect(source.indexOf(canonicalMount)).toBeGreaterThan(0);
    expect(source.indexOf(canonicalMount)).toBeLessThan(firstFamilyBranch);
    expect(source).toContain('createRepartidorLiquidacionBootstrap({');
    expect(source).toContain('setCanonicalLiquidacionService(');
    expect(source).not.toContain('Failed to load TS routes; falling back');
    expect(source).not.toContain('Failed to load DDD routes; falling back');
  });
});
