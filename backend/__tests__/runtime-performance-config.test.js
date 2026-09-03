'use strict';

const fs = require('fs');
const path = require('path');

describe('runtime performance configuration', () => {
  const backendRoot = path.join(__dirname, '..');

  function readPedidosImplementation() {
    return [
      'services/pedidos.service.js',
      'services/pedidos/index.js',
      'services/pedidos/search.js',
      'services/pedidos/catalog.js',
      'services/pedidos/write.js',
      'services/pedidos/analytics.js',
      'services/pedidos/shared.js',
    ].map((relative) => fs.readFileSync(path.join(backendRoot, relative), 'utf8')).join('\n');
  }

  afterEach(() => {
    jest.resetModules();
    delete process.env.PM2_INSTANCES;
    delete process.env.UV_THREADPOOL_SIZE;
    delete process.env.NODE_OPTIONS;
    delete process.env.DB_TOTAL_CONNECTION_BUDGET;
    delete process.env.DB_TOTAL_QUERY_CONCURRENCY;
    delete process.env.DB_POOL_MAX;
    delete process.env.DB_QUERY_CONCURRENCY;
  });

  test('PM2 defaults to 8 cluster workers with 128 libuv threads and 512 MB old-space', () => {
    const config = require('../ecosystem.config');
    const app = config.apps.find((entry) => entry.name === 'gmp-api');

    expect(app.instances).toBe('8');
    expect(app.exec_mode).toBe('cluster');
    expect(app.env.UV_THREADPOOL_SIZE).toBe('128');
    expect(app.env.NODE_OPTIONS).toBe('--max-old-space-size=512');
    expect(app.env.HTTP_REQUEST_TIMEOUT_MS).toBe('30000');
    expect(app.env.DB_POOL_MAX).toBe('5');
    expect(app.env.DB_QUERY_CONCURRENCY).toBe('4');
    expect(app.watch).toBe(false);
    expect(app.kill_timeout).toBe(5000);
    expect(app.max_memory_restart).toBe('512M');
    expect(app.max_restarts).toBe(50);
    expect(app.restart_delay).toBe(1000);
    expect(app.exp_backoff_restart_delay).toBe(500);
  });

  test('DB layer contains slow-query logging, circuit breaker, and request context hooks', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'config/db.js'), 'utf8');

    expect(source).toMatch(/DB_QUERY_SLOW_MS/);
    expect(source).toMatch(/SLOW_QUERY/);
    expect(source).toMatch(/DB_CIRCUIT_OPEN/);
    expect(source).toMatch(/runWithDbRequestContext/);
    expect(source).toMatch(/startPoolMetrics/);
  });

  test('Redis cache is fail-fast and exposes batch writes', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'services/redis-cache.js'), 'utf8');

    expect(source).toMatch(/disableOfflineQueue/);
    expect(source).toMatch(/enableOfflineQueue:\s*false/);
    expect(source).toMatch(/L1_CACHE_TTL_MS/);
    expect(source).toMatch(/async setMany/);
    expect(source).toMatch(/multi\.setEx/);
    expect(source).toMatch(/getRedisClient/);
  });

  test('request timeout and route error helpers suppress duplicate responses', () => {
    const serverSource = fs.readFileSync(path.join(backendRoot, 'server.js'), 'utf8');
    const commonSource = fs.readFileSync(path.join(backendRoot, 'utils/common.js'), 'utf8');
    const httpCacheSource = fs.readFileSync(path.join(backendRoot, 'middleware/http-cache.js'), 'utf8');

    expect(serverSource).toMatch(/LATE_RESPONSE_SUPPRESSED/);
    expect(serverSource).toMatch(/requestTimedOut/);
    expect(commonSource).toMatch(/Response already completed/);
    expect(commonSource).toMatch(/DB_QUERY_QUEUE_TIMEOUT/);
    expect(httpCacheSource).toMatch(/requestTimedOut/);
  });

  test('objectives evolution avoids per-vendor LACLAE scans for multi-vendor scopes', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'routes/objectives.js'), 'utf8');

    expect(source).toMatch(/scoped aggregate/);
    expect(source).toMatch(/fetchObjectiveEvolutionRows/);
    expect(source).toMatch(/fetchObjectiveEvolutionRowsByClientScope/);
    expect(source).toMatch(/getClientCodesFromCache\(vendorCode\)/);
    expect(source).toMatch(/COMMISSION_CLIENT_SCOPE_MAX_CODES/);
    expect(source).toMatch(/TRIM\(L\.R1_T8CDVD\) IN/);
    expect(source).toMatch(/code !== 'UNK'/);
    expect(source).toMatch(/code\.length <= 2/);
    expect(source).toMatch(/no valid vendor codes/);
    expect(source).not.toMatch(/vendorCodesArray\.map\(code => buildVendorObjectiveTargets/);
  });

  test('commissions single-vendor uses client scope while batch query avoids CASE predicates', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'routes/commissions.js'), 'utf8');
    const calculateVendorDataBlock = source.slice(
      source.indexOf('async function calculateVendorData'),
      source.indexOf('async function getCurrentPaymentSnapshot'),
    );

    expect(source).toMatch(/fetchSingleVendorCommissionSalesRows/);
    expect(source).toMatch(/salesFallbackPromise/);
    expect(source).toMatch(/Normal commission\/objective views must use client scope/);
    expect(source).not.toMatch(/SELECT S\.VENDOR_CODE/);
    expect(source).not.toMatch(/TRIM\(\$\{vendorColExpr\}\) IN/);
    expect(source).toMatch(/batchFetchVendorDataChunked/);
    expect(source).toMatch(/COMMISSION_ALL_VENDOR_CHUNK_SIZE/);
    expect(source).toMatch(/returning stale cached summary/);
    expect(source).toMatch(/getCommissionSalesRowsFromClientCache/);
    expect(source).toMatch(/getCommissionSalesRowsByClientScopeForVendors/);
    expect(source).toMatch(/sales-by-client-scope:GROUP/);
    expect(source).toMatch(/sales-by-client-scope/);
    expect(source).toMatch(/previousMarDecVendorCol/);
    expect(calculateVendorDataBlock).toMatch(/const safeVendorCodes = getCodeVariants\(vendedorCode\)/);
    expect(calculateVendorDataBlock).toMatch(/usedClientScopeSalesRows/);
    expect(calculateVendorDataBlock).not.toMatch(/buildCommissionVendorFilter\(vendedorCode, safeYear, 'L'\)/);
  });

  test('DDD clients list paginates cached client codes before LACLAE enrichment', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'src/shared/routes/ddd-adapters.js'), 'utf8');

    expect(source).toMatch(/fastPath: true/);
    expect(source).toMatch(/slice\(safeOffset, safeOffset \+ safeLimit\)/);
    expect(source).toMatch(/AND L\.LCCDCL IN \(\$\{placeholders\}\)/);
  });

  test('DDD rutero sales endpoints use canonical DSED LACLAE tables without DATE column casts', () => {
    const source = fs.readFileSync(
      path.join(backendRoot, 'src/modules/rutero/infrastructure/db2-rutero-repository.js'),
      'utf8',
    );

    expect(source).toMatch(/FROM DSED\.LACLAE L/);
    expect(source).toMatch(/LEFT JOIN DSEDAC\.CLI/);
    expect(source).toMatch(/L\.LCAADC = \?/);
    expect(source).toMatch(/L\.LCMMDC = \?/);
    expect(source).toMatch(/L\.LCDDDC = \?/);
    expect(source).toMatch(/L\.R1_T8CDVD = CAST\(\? AS CHAR\(2\)\)/);
    expect(source).not.toMatch(/JAVIER\.LACLAE/);
    expect(source).not.toMatch(/JAVIER\.CLIENTES/);
    expect(source).not.toMatch(/DATE\(LAC\.FECHA\)/);
    expect(source).not.toMatch(/TRIM\(L\.R1_T8CDVD\)/);
  });

  test('pedido client authorization avoids CASE vendor predicates in hot client scope checks', () => {
    const commonSource = fs.readFileSync(path.join(backendRoot, 'utils/common.js'), 'utf8');
    const legacyRoutes = fs.readFileSync(path.join(backendRoot, 'routes/pedidos.js'), 'utf8');
    const dddRoutes = fs.readFileSync(path.join(backendRoot, 'src/shared/routes/ddd-adapters.js'), 'utf8');
    const clientFilterBlock = commonSource.slice(
      commonSource.indexOf('function buildClientVendorParamFilter'),
      commonSource.indexOf('function expandVendorCodesForSql'),
    );

    expect(legacyRoutes).toMatch(/broadManagerScope/);
    expect(dddRoutes).toMatch(/broadManagerScope/);
    expect(clientFilterBlock).toMatch(/LAC\.LCMMDC < \$\{TRANSITION_MONTH\}/);
    expect(clientFilterBlock).toMatch(/LAC\.\$\{VENDOR_COLUMN\} IN/);
    expect(clientFilterBlock).not.toMatch(/TRIM\(\$\{laclaeVendorCol\}\)/);
    expect(dddRoutes).toMatch(/broadManagerScope[\s\S]*vendorCodes: assignedVendors\.length > 0 \? assignedVendors : vendorScope\.codes/);
  });

  test('pedido order analytics uses qualified vendor filters without TRIM', () => {
    const source = readPedidosImplementation();

    expect(source).toMatch(/function buildPedidoCabVendorFilter/);
    expect(source).toMatch(/buildPedidoCabVendorFilter\(vendedorCodes, 'C'\)/);
    expect(source).toMatch(/CAST\(\? AS CHAR\(2\)\)/);
    expect(source).not.toMatch(/AND TRIM\(CODIGOVENDEDOR\) IN/);
  });

  test('pedido product catalog paginates before page-level enrichment and caches final response', () => {
    const source = readPedidosImplementation();
    const getProductsBlock = source.slice(
      source.indexOf('async function getProducts'),
      source.indexOf('async function getProductDetail'),
    );

    expect(getProductsBlock).toMatch(/pedidos:products_final_v3/);
    expect(getProductsBlock).toMatch(/ART_RANKED AS/);
    expect(getProductsBlock).toMatch(/ART_PAGE AS/);
    expect(getProductsBlock).toMatch(/WHERE RN > \?/);
    expect(getProductsBlock).toMatch(/JOIN ART_PAGE P ON S\.CODIGOARTICULO = P\.CODIGOARTICULO/);
    expect(getProductsBlock).toMatch(/JOIN ART_PAGE P ON SR\.CODIGOARTICULO = P\.CODIGOARTICULO/);
    expect(getProductsBlock).toMatch(/JOIN ART_PAGE P ON TRIM\(L\.CODIGOARTICULO\) = P\.CODIGOARTICULO/);
    expect(getProductsBlock).not.toMatch(/FROM DSEDAC\.ARO[\s\S]*GROUP BY CODIGOARTICULO[\s\S]*\) S ON A\.CODIGOARTICULO/);
  });

  test('pedido delivery and family helpers avoid known cold-path log noise', () => {
    const source = readPedidosImplementation();

    expect(source).toMatch(/Promise\.all\(\[vendorRowsPromise, allVendorRowsPromise\]\)/);
    expect(source).toMatch(/LCCDCL = CAST\(\? AS CHAR\(10\)\)/);
    expect(source).toMatch(/R1_T8CDVD = CAST\(\? AS CHAR\(2\)\)/);
    expect(source).toMatch(/LEFT JOIN DSEDAC\.FAM F ON A\.CODIGOFAMILIA = F\.CODIGOFAMILIA/);
    expect(source).not.toMatch(/WHERE TRIM\(LCCDCL\) = \?/);
    expect(source).not.toMatch(/MAX\(TRIM\(DESCRIPCIONFAMILIA\)\)/);
  });

  test('KPI dashboard uses vendor client cache before DB2 LACLAE fallback', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'kpi/routes.js'), 'utf8');

    expect(source).toMatch(/getClientCodesFromCache\(codes\.join\(','\)\)/);
    expect(source).toMatch(/setVendorClientSetCache\(cacheKey, cachedResult\)/);
  });

  test('DDD commission and purchase history cold paths use bounded DB2 predicates', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'src/shared/routes/ddd-adapters.js'), 'utf8');
    const purchaseHistoryBlock = source.slice(
      source.indexOf("router.get('/purchase-history-global'"),
      source.indexOf("router.post('/complementary'", source.indexOf("router.get('/purchase-history-global'")),
    );
    const dddCommissionsBlock = source.slice(
      source.indexOf('function createCommissionsRoutes'),
      source.indexOf('module.exports'),
    );

    expect(source).toMatch(/function buildLaclaeDateRangeFilter/);
    expect(purchaseHistoryBlock).toMatch(/buildLaclaeDateRangeFilter\('L', from, to\)/);
    expect(purchaseHistoryBlock).toMatch(/TRIM\(L\.LCCDVD\) IN/);
    expect(purchaseHistoryBlock).toMatch(/TRIM\(L\.LCCDCL\) = \?/);
    expect(purchaseHistoryBlock).toMatch(/TRIM\(L\.LCCDRF\) = \?/);
    expect(purchaseHistoryBlock).toMatch(/C\.CODIGOCLIENTE = L\.LCCDCL/);
    expect(purchaseHistoryBlock).not.toMatch(/LCAADC \* 10000/);
    expect(purchaseHistoryBlock).not.toMatch(/CASE WHEN/);
    expect(dddCommissionsBlock).toMatch(/require\('\.\.\/\.\.\/\.\.\/routes\/commissions'\)/);
    expect(dddCommissionsBlock).toMatch(/calculateVendorData\(safeVendedorCode, selectedYear, config\)/);
    expect(dddCommissionsBlock).not.toMatch(/FROM DSED\.LACLAE L/);
    expect(dddCommissionsBlock).not.toMatch(/L\.LCAADC IN \(\?, \?\)/);
  });

  test('cobros pending summary uses client aggregation instead of document-wide CVC rebuild', () => {
    const source = fs.readFileSync(
      path.join(backendRoot, 'src/modules/cobros/infrastructure/db2-cobros-repository.js'),
      'utf8',
    );
    const pendingSummaryBlock = source.slice(
      source.indexOf('async getPendingSummary'),
      source.indexOf('async getAppSideCobrosByDocForVendorScope'),
    );

    expect(pendingSummaryBlock).toMatch(/CVC_CLIENTS AS/);
    expect(pendingSummaryBlock).toMatch(/getClientCodesFromCache\(vendorCodes\.join\(','\)\)/);
    expect(pendingSummaryBlock).toMatch(/buildCvcClientScopeFilter/);
    expect(pendingSummaryBlock).toMatch(/FETCH FIRST \$\{clientFetchLimit\} ROWS ONLY/);
    expect(pendingSummaryBlock).toMatch(/getAppSideCobrosByClient\(vendorClause, vendorParams\)/);
    expect(pendingSummaryBlock).not.toMatch(/CVC_DOCS_RAW/);
    expect(pendingSummaryBlock).not.toMatch(/APP_COBROS AS/);
    expect(pendingSummaryBlock).not.toMatch(/DOC_NET AS/);
    expect(source).toMatch(/groupedRows\.length > 0 && adjustmentVendorCodes\.length > 0/);
  });
});
