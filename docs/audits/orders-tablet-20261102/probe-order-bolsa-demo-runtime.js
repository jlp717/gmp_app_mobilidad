'use strict';

// Filled only by probe-order-bolsa-demo.ps1. This module is intentionally not
// executable by itself: no DB work can occur without a reviewed full SHA.
const odbc = require('odbc');
const Module = require('module');
const path = require('path');
const crypto = require('crypto');

const sourceBundleBytes = Buffer.from('SOURCE_BUNDLE', 'base64');
const sealed = JSON.parse(sourceBundleBytes.toString('utf8'));
const bundle = sealed.files;
const externalPackages = new Set(sealed.externals || []);
const sourceCommit = 'SOURCE_COMMIT';
const runtimeSha256 = 'RUNTIME_SHA256';
const expectedSourceManifestSha256 = 'SOURCE_MANIFEST_SHA256';
const mode = 'RUN_MODE';
const authorization = JSON.parse(Buffer.from('RUN_AUTHORIZATION', 'base64').toString('utf8'));
const root = process.cwd();
const marker = `OTDBag${crypto.randomBytes(6).toString('hex')}`;
const idemKey = `OTDBAG${crypto.randomBytes(10).toString('hex')}`;
const testTables = Object.freeze([
  'JAVIER.TEST_PEDIDOS_CAB', 'JAVIER.TEST_PEDIDOS_LIN', 'JAVIER.TEST_PEDIDOS_SEQ',
  'JAVIER.TEST_PEDIDOS_STOCK_RESERVE', 'JAVIER.TEST_PEDIDO_IDEMPOTENCY',
  'JAVIER.TEST_BOLSA_COMERCIAL', 'JAVIER.TEST_MOVIMIENTOS_BOLSA',
  'JAVIER.TEST_PEDIDO_STATE_EVENTS',
]);
const lockOnlyTables = Object.freeze([
  'JAVIER.TEST_REPARTO_CONFIRMACIONES', 'JAVIER.TEST_REPARTO_EVIDENCIAS',
  'JAVIER.TEST_REPARTO_CONFIRM_EVIDENCIAS', 'JAVIER.TEST_REPARTIDOR_COBROS',
  'JAVIER.TEST_COBROS',
]);
const writeTargets = new Set(testTables);
const lockTargets = new Set([...testTables, ...lockOnlyTables]);
const writes = new Set();
const writeCounts = new Map();
let ownedId = null;
const closers = [];
const noLog = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });
const noRedis = Object.freeze({ redisCache: { async get() { return null; }, async getRemote() { return null; }, async set() {}, async incrementVersion() { return '1'; } }, TTL: { SHORT: 60, MEDIUM: 300, LONG: 900 }, async deleteCachePattern() {} });
const noOptimizer = Object.freeze({ cachedQuery: async (fn, sql, ...args) => fn(sql, Array.isArray(args.at(-1)) ? args.at(-1) : []), async invalidateOnMutation() {}, patternFor: () => '' });
const sealedConfigCache = new Map();
let readonlyLockAttempts = 0;
let readonlySetAttempts = 0;
let dedicatedConnectionCount = 0;

function json(value) { return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item); }
function fail(code) { throw Object.assign(new Error(code), { code }); }
function check(condition, code) { if (!condition) fail(code); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stableHash(value) { return sha256(json(value)); }
function trim(value) { return value == null ? null : String(value).trim(); }
function maskedRows(rows, fields) {
  return (rows || []).map((row) => Object.fromEntries(fields
    .filter((field) => Object.hasOwn(row, field))
    .map((field) => [field, typeof row[field] === 'bigint' ? row[field].toString() : row[field]])));
}
function cleanTarget(value) { return String(value || '').replaceAll('"', '').toUpperCase(); }
function diagnostic(error) {
  const modulePath = /^[A-Za-z0-9_./-]{1,180}$/.test(error?.modulePath || '') ? error.modulePath : undefined;
  return { code: /^[A-Z][A-Z0-9_]{2,80}$/.test(error?.code || '') ? error.code : 'ORDER_BOLSA_DEMO_FAILED', ...(modulePath ? { modulePath } : {}), odbc: (error?.odbcErrors || []).map(({ state, code }) => ({ state: /^[A-Z0-9]{5}$/.test(state || '') ? state : null, code: Number.isFinite(Number(code)) ? Number(code) : null })) };
}
function bundleModuleMissing(modulePath) { throw Object.assign(new Error('BUNDLE_LOCAL_MODULE_MISSING'), { code: 'BUNDLE_LOCAL_MODULE_MISSING', modulePath }); }
function normalizedCandidates(filename, request) { const resolved = path.relative(root, path.resolve(path.dirname(filename), request)).replace(/\\/g, '/'); return [resolved, `${resolved}.js`, `${resolved}.json`, `${resolved}/index.js`]; }
function normalizeSql(sql) { return String(sql || '').replace(/\s+/g, ' ').trim().replace(/;$/, ''); }
function targetFor(sql, expression) { const match = expression.exec(sql); return match ? cleanTarget(match[1]) : null; }
function loadSealedConfig(relative) {
  if (sealedConfigCache.has(relative)) return sealedConfigCache.get(relative).exports;
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  sealedConfigCache.set(relative, loaded);
  const nativeRequire = Module.createRequire(filename);
  loaded.require = (request) => {
    if (request.startsWith('.')) {
      const resolved = path.relative(root, path.resolve(path.dirname(filename), request)).replace(/\\/g, '/');
      for (const candidate of [resolved, `${resolved}.js`, `${resolved}/index.js`]) if (Object.hasOwn(bundle, candidate)) return loadSealedConfig(candidate);
      fail('BUNDLE_LOCAL_MODULE_MISSING');
    }
    check(externalPackages.has(request), 'UNDECLARED_EXTERNAL_MODULE');
    return nativeRequire(request);
  };
  const source = bundle[relative];
  check(typeof source === 'string', 'BUNDLE_MODULE_MISSING');
  loaded._compile(source, filename);
  return loaded.exports;
}
function guard(sql, params = []) {
  const statement = normalizeSql(sql);
  check(statement && !statement.includes(';'), 'MULTI_STATEMENT_REJECTED');
  check(!/\b(CREATE|ALTER|DROP|TRUNCATE|CALL|GRANT|REVOKE)\b/i.test(statement), 'DDL_OR_CALL_REJECTED');
  if (mode === 'ReadOnly') {
    if (/\bLOCK\b/i.test(statement)) { readonlyLockAttempts += 1; fail('READONLY_LOCK_REJECTED'); }
    if (/\bSET\b/i.test(statement)) { readonlySetAttempts += 1; fail('READONLY_SET_REJECTED'); }
  }
  const writeTarget = targetFor(statement, /\b(?:INSERT\s+INTO\s+|UPDATE\s+(?=[A-Z0-9_".]+\s+SET\b)|DELETE\s+FROM\s+|MERGE\s+INTO\s+)([A-Z0-9_".]+)/i);
  const lockTarget = targetFor(statement, /\bLOCK\s+TABLE\s+([A-Z0-9_".]+)/i);
  if (writeTarget) {
    check(mode === 'Run', 'READONLY_FIREWALL_REJECTED');
    check(writeTargets.has(writeTarget), 'UNEXPECTED_WRITE_TARGET_REJECTED');
    if (/\bDELETE\s+FROM\b/i.test(statement)) {
      check(writeTarget === 'JAVIER.TEST_PEDIDOS_STOCK_RESERVE', 'MANUAL_DELETE_REJECTED');
    }
    writes.add(writeTarget);
    writeCounts.set(writeTarget, (writeCounts.get(writeTarget) || 0) + 1);
    check(writeCounts.get(writeTarget) <= 32, 'WRITE_BOUND_EXCEEDED');
  }
  if (lockTarget) check(lockTargets.has(lockTarget), 'UNEXPECTED_LOCK_TARGET_REJECTED');
  if (!writeTarget && !lockTarget) check(/^\s*(SELECT|WITH|SET TRANSACTION|VALUES)\b/i.test(statement), 'UNEXPECTED_SQL_REJECTED');
  return writeTarget;
}
function insertBindings(statement, params) {
  const match = /\bINSERT INTO [A-Z0-9_".]+\s*\(([^()]+)\)\s*VALUES\s*\(([^()]+)\)\s*\)?$/i.exec(statement);
  check(match, 'UNRECOGNIZED_SINGLE_ROW_INSERT');
  const columns = match[1].split(',').map(v => v.trim().toUpperCase());
  const expressions = match[2].split(',').map(v => v.trim());
  check(columns.length === expressions.length, 'INSERT_BINDING_SHAPE_CHANGED');
  let index = 0;
  const bindings = Object.fromEntries(columns.map((column, i) =>
    [column, expressions[i] === '?' ? params[index++] : undefined]));
  check(index === params.length, 'INSERT_BINDINGS_INCOMPLETE');
  return bindings;
}
function assertEvents(snapshot, expected) {
  const transitions = snapshot.raw.events.map(row => [trim(row.FROM_STATE), trim(row.TO_STATE)]);
  check(json(transitions) === json(expected), 'ORDER_EVENT_TRANSITIONS_INVALID');
  for (const row of snapshot.raw.events) {
    check(trim(row.ACTOR_ID) === '35' && trim(row.ACTOR_ROLE) === 'COMERCIAL'
      && trim(row.DEVICE_ID) === 'QA-ORDER-BOLSA-DEMO', 'ORDER_EVENT_ACTOR_INVALID');
    check(typeof row.PAYLOAD_JSON === 'string'
      && sha256(row.PAYLOAD_JSON) === trim(row.PAYLOAD_HASH), 'ORDER_EVENT_HASH_INVALID');
    const state = trim(row.TO_STATE);
    const payload = JSON.parse(row.PAYLOAD_JSON);
    if (state === 'BORRADOR') {
      check(payload.event === 'ORDER_CREATED' && payload.header && payload.lines?.length === 1,
        'ORDER_CREATED_PAYLOAD_INVALID');
    }
    if (state === 'CONFIRMADO' || state === 'CANCELADO') {
      const confirmed = state === 'CONFIRMADO';
      check(payload.event === (confirmed ? 'ORDER_CONFIRMED' : 'ORDER_CANCELLED')
        && trim(payload.before?.header?.ESTADO) === (confirmed ? 'BORRADOR' : 'CONFIRMADO')
        && trim(payload.after?.header?.ESTADO) === state, 'ORDER_EVENT_PAYLOAD_STATE_INVALID');
    }
    if (state === 'CANCELANDO' || state === 'CANCELADO') {
      check(trim(row.REASON) === 'QA ' + marker, 'ORDER_EVENT_CANCEL_REASON_INVALID');
    }
  }
  check(snapshot.raw.events[0]?.ORIGINAL_CLIENT_AT != null, 'ORDER_EVENT_ORIGINAL_TIME_MISSING');
}
function idOf(result) { const value = result?.header?.id ?? result?.header?.ID ?? result?.id; return Number(value); }
function money(value) { return Number(Number(value || 0).toFixed(4)); }
function tariff(product, code) { return money((product.tariffs || []).find((row) => Number(row.code) === code)?.price); }

async function main() {
  check(['ReadOnly', 'Run'].includes(mode), 'EXECUTION_MODE_REQUIRED');
  check(/^[a-f0-9]{40}$/.test(sourceCommit), 'FULL_SOURCE_COMMIT_REQUIRED');
  check(/^[a-f0-9]{64}$/.test(runtimeSha256), 'RUNTIME_HASH_REQUIRED');
  check(/^[a-f0-9]{64}$/.test(expectedSourceManifestSha256) && sha256(sourceBundleBytes) === expectedSourceManifestSha256, 'SOURCE_MANIFEST_HASH_REQUIRED');
  process.env.APP_ENV = 'demo';
  loadSealedConfig('config/load-env.js').loadEnv(root);
  const profile = loadSealedConfig('config/app-profile.js').applyAppProfile();
  check(profile.verified && profile.profile === 'demo' && profile.tableSet === 'isolated_test'
    && profile.writesEnabled && !profile.productionWritesEnabled && !profile.erpExportEnabled, 'ISOLATED_TEST_REQUIRED');
  const connectionString = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
  let observer;
  let scenario;
  let read;
  let transactionStarted = false;
  let logicalOpen = false;
  let logicalFailed = false;
  let orderService;
  let rollbackBaseline;
  let phase = 'PREFLIGHT';
  let serial = Promise.resolve();
  const sourceManifestSha256 = expectedSourceManifestSha256;
  const candidateFingerprint = sha256('1009|35|4300032160|4.6480|4.1240|14');
  const evidence = { mode, sourceCommit, runtimeSha256, sourceManifestSha256, sourceHashes: Object.fromEntries(Object.entries(bundle).map(([name, content]) => [name, sha256(content)])), marker, candidateFingerprint, candidate: { article: '1009', tariff1: 4.648, tariff2: 4.124, expectedBolsaId: 14 }, writes: [], writeCounts: {}, catalog: [], closed: {}, lifecycle: {}, physicalCommits: 0, logicalCommits: 0, rollbackVerified: false };
  try {
    if (mode === 'Run') {
      check(authorization?.mode === 'Run', 'RUN_AUTHORIZATION_MODE_REQUIRED');
      check(authorization?.approvedDate === new Date().toISOString().slice(0, 10), 'RUN_AUTHORIZATION_DATE_REQUIRED');
      check(authorization?.sourceCommit === sourceCommit && authorization?.runtimeSha256 === runtimeSha256 && authorization?.sourceManifestSha256 === sourceManifestSha256 && authorization?.candidateFingerprint === candidateFingerprint, 'RUN_AUTHORIZATION_BINDING_FAILED');
    }
    observer = await odbc.connect(connectionString); closers.push(['observer', observer]);
    read = (sql, params = []) => {
      guard(sql, params);
      check(!/\b(INSERT|UPDATE|DELETE|MERGE|LOCK|SET)\b/i.test(sql), 'WRITE_OUTSIDE_SERVICE_REJECTED');
      const pending = serial.then(() => (transactionStarted ? scenario : observer).query(sql, params, { timeout: 12 }));
      serial = pending.catch(() => {});
      return pending;
    };
    for (const qualified of testTables) {
      const table = qualified.split('.')[1];
      const physical = await read(
        'SELECT SYSTEM_TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        ['JAVIER', table],
      );
      check(physical.length === 1, 'TEST_TABLE_CATALOG_UNAVAILABLE');
      const journal = await read(
        "SELECT JOURNALED, JOURNAL_LIBRARY, JOURNAL_NAME, JOURNAL_IMAGES FROM TABLE(QSYS2.OBJECT_STATISTICS('JAVIER','*FILE',CAST(? AS VARCHAR(128)))) X",
        [trim(physical[0].SYSTEM_TABLE_NAME)],
      );
      check(journal.length === 1 && trim(journal[0].JOURNALED) === 'YES'
        && trim(journal[0].JOURNAL_LIBRARY) === 'JAVIER'
        && trim(journal[0].JOURNAL_NAME) === 'QSQJRN'
        && trim(journal[0].JOURNAL_IMAGES) === '*BOTH', 'TEST_TABLE_JOURNAL_UNVERIFIED');
      const triggers = await read(
        'SELECT TRIGGER_NAME FROM QSYS2.SYSTRIGGERS WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?',
        ['JAVIER', table],
      );
      check(triggers.length === 0, 'TEST_TABLE_TRIGGER_REJECTED');
      evidence.catalog.push({ table, journal: 'JAVIER/QSQJRN *BOTH', triggerCount: 0 });
    }
    const fakeDb = {
      queryWithParams: read, query: read,
      getPool: () => transactionStarted ? { connectionConfig: { connectionString } } : null,
      initDb: async () => {},
    };
    const dbPath = require.resolve('./config/db');
    const dbModule = new Module(dbPath, module); dbModule.filename = dbPath; dbModule.exports = fakeDb; require.cache[dbPath] = dbModule;
    const cache = new Map();
    async function assertOwnedMutation(target, sql, params) {
      const table = target.split('.')[1];
      const statement = normalizeSql(sql);
      const inserting = /\bINSERT INTO\b/i.test(statement);
      const updating = /\bUPDATE\b.+\bSET\b/i.test(statement);
      if (table === 'TEST_PEDIDOS_SEQ') {
        const year = new Date().getFullYear();
        check(phase === 'CREATE' && params.length === 1 && Number(params[0]) === year,
          'SEQUENCE_SCOPE_REJECTED');
        const sequenceInsert = /\bINSERT INTO JAVIER\.TEST_PEDIDOS_SEQ \(EJERCICIO, ULTIMO_NUMERO\) VALUES \(\?, 1\)$/i.test(statement);
        const sequenceUpdate = /\bUPDATE JAVIER\.TEST_PEDIDOS_SEQ SET ULTIMO_NUMERO = ULTIMO_NUMERO \+ 1 WHERE EJERCICIO = \?\s*\)?$/i.test(statement);
        check(sequenceInsert || sequenceUpdate,
          'SEQUENCE_STATEMENT_REJECTED');
        return;
      }
      if (table === 'TEST_PEDIDOS_CAB' && inserting) {
        const fields = insertBindings(statement, params);
        check(phase === 'CREATE' && ownedId === null && fields.OBSERVACIONES === marker
          && trim(fields.CODIGOVENDEDOR) === '35' && trim(fields.CODIGOCLIENTE) === '4300032160',
          'ORDER_INSERT_SCOPE_REJECTED');
        return;
      }
      if (table === 'TEST_BOLSA_COMERCIAL') {
        check(updating && /\bWHERE ID = \?$/i.test(statement) && Number(params.at(-1)) === 14,
          'BOLSA_UPDATE_SCOPE_REJECTED');
        return;
      }
      if (ownedId === null) {
        const own = await scenario.query('SELECT ID FROM JAVIER.TEST_PEDIDOS_CAB WHERE OBSERVACIONES = ?',
          [marker], { timeout: 12 });
        check(own.length === 1 && Number(own[0].ID) > 0, 'OWNED_ORDER_NOT_FOUND');
        ownedId = Number(own[0].ID);
      }
      if (inserting) {
        const fields = insertBindings(statement, params);
        check(Number(fields.PEDIDO_ID) === ownedId, 'CHILD_INSERT_SCOPE_REJECTED');
        if (table === 'TEST_MOVIMIENTOS_BOLSA') check(Number(fields.BOLSA_ID) === 14, 'MOVEMENT_BOLSA_SCOPE_REJECTED');
        if (table === 'TEST_PEDIDO_IDEMPOTENCY') check(fields.IDEMPOTENCY_KEY === idemKey, 'ORDER_TOKEN_SCOPE_REJECTED');
        return;
      }
      const orderScope = /\bWHERE ID = \?(?: AND ESTADO (?:=|IN\b).*)?$/i.exec(statement);
      const idBind = orderScope ? (statement.slice(0, orderScope.index).match(/\?/g) || []).length : -1;
      const orderUpdate = table === 'TEST_PEDIDOS_CAB' && updating && orderScope
        && Number(params[idBind]) === ownedId && !/\bOR\b/i.test(orderScope[0]);
      const reserveDelete = table === 'TEST_PEDIDOS_STOCK_RESERVE'
        && /\bDELETE FROM [A-Z0-9_."]+ WHERE PEDIDO_ID = \?$/i.test(statement)
        && params.length === 1 && Number(params[0]) === ownedId;
      check(orderUpdate || reserveDelete, 'OWNED_MUTATION_SCOPE_REJECTED');
    }
    const driver = { connect: async () => {
      check(mode === 'Run' && transactionStarted && !logicalFailed, 'DEDICATED_CONNECTION_REJECTED');
      dedicatedConnectionCount += 1;
      return {
        beginTransaction: async () => {
          check(!logicalOpen, 'OVERLAPPING_SERVICE_TRANSACTION');
          logicalOpen = true;
        },
        query: async (sql, params = []) => {
          check(logicalOpen && !logicalFailed, 'SERVICE_TRANSACTION_REQUIRED');
          const target = guard(sql, params);
          if (/^SET TRANSACTION ISOLATION LEVEL READ COMMITTED$/i.test(normalizeSql(sql))) return [];
          if (target) await assertOwnedMutation(target, sql, params);
          return scenario.query(sql, params, { timeout: 12 });
        },
        commit: async () => {
          check(logicalOpen && !logicalFailed, 'SERVICE_COMMIT_REJECTED');
          logicalOpen = false;
          evidence.logicalCommits += 1;
        },
        rollback: async () => { logicalOpen = false; logicalFailed = true; },
        close: async () => check(!logicalOpen, 'SERVICE_CONNECTION_NOT_RELEASED'),
      };
    } };
    function load(relative) {
      if (sealedConfigCache.has(relative)) return sealedConfigCache.get(relative).exports;
      if (cache.has(relative)) return cache.get(relative).exports;
      const filename = path.join(root, relative);
      const loaded = new Module(filename, module);
      loaded.filename = filename;
      loaded.paths = Module._nodeModulePaths(path.dirname(filename));
      cache.set(relative, loaded);
      const nativeRequire = Module.createRequire(filename);
      loaded.require = (request) => {
        if (request === 'odbc') return driver;
        if (request === '../config/db' || request === '../../config/db' || request === './config/db' || request === 'config/db') return fakeDb;
        if (request.endsWith('middleware/logger') || request.endsWith('middleware/logger.js')) return noLog;
        if (request.endsWith('services/redis-cache') || request.endsWith('services/redis-cache.js')) return noRedis;
        if (request.endsWith('services/query-optimizer') || request.endsWith('services/query-optimizer.js')) return noOptimizer;
        if (request.startsWith('.')) {
          const candidates = normalizedCandidates(filename, request);
          if (candidates.includes('config/db.js')) return fakeDb;
          if (candidates.includes('middleware/logger.js')) return noLog;
          if (candidates.includes('services/redis-cache.js')) return noRedis;
          if (candidates.includes('services/query-optimizer.js')) return noOptimizer;
          for (const candidate of candidates) if (Object.hasOwn(bundle, candidate)) return load(candidate);
          bundleModuleMissing(candidates[0]);
        }
        check(externalPackages.has(request), 'UNDECLARED_EXTERNAL_MODULE');
        return nativeRequire(request);
      };
      const source = bundle[relative];
      check(typeof source === 'string', 'BUNDLE_MODULE_MISSING');
      if (relative.endsWith('.json')) { loaded.exports = JSON.parse(source); return loaded.exports; }
      loaded._compile(source, filename);
      return loaded.exports;
    }
    const pedidos = load('services/pedidos/index.js');
    orderService = pedidos;
    const bolsa = load('services/bolsa-comercial.service.js');
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    async function snapshot(orderId) {
      const [header, lines, reserve, idempotency, events, movements, bag] = await Promise.all([
        read('SELECT * FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID = ?', [orderId]),
        read('SELECT * FROM JAVIER.TEST_PEDIDOS_LIN WHERE PEDIDO_ID = ? ORDER BY ID', [orderId]),
        read('SELECT * FROM JAVIER.TEST_PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ? ORDER BY CODIGOARTICULO', [orderId]),
        read('SELECT * FROM JAVIER.TEST_PEDIDO_IDEMPOTENCY WHERE PEDIDO_ID = ? ORDER BY IDEMPOTENCY_KEY', [orderId]),
        read('SELECT * FROM JAVIER.TEST_PEDIDO_STATE_EVENTS WHERE PEDIDO_ID = ? ORDER BY ID', [orderId]),
        read('SELECT * FROM JAVIER.TEST_MOVIMIENTOS_BOLSA WHERE PEDIDO_ID = ? ORDER BY ID', [orderId]),
        read('SELECT * FROM JAVIER.TEST_BOLSA_COMERCIAL WHERE ID = ?', [14]),
      ]);
      const raw = { header, lines, reserve, idempotency, events, movements, bag };
      return {
        hash: stableHash(raw),
        raw,
        masked: {
          header: maskedRows(header, ['ID', 'ESTADO', 'NUMEROPEDIDO', 'IMPORTETOTAL']),
          lines: maskedRows(lines, ['ID', 'PEDIDO_ID', 'CODIGOARTICULO', 'CANTIDADENVASES', 'CANTIDADUNIDADES', 'UNIDADMEDIDA', 'PRECIOVENTA', 'IMPORTEVENTA']),
          reserve: maskedRows(reserve, ['PEDIDO_ID', 'CODIGOARTICULO', 'CANTIDADENVASES', 'CANTIDADUNIDADES', 'ESTADO']),
          idempotency: maskedRows(idempotency, ['PEDIDO_ID', 'PAYLOAD_HASH']),
          events: maskedRows(events, ['ID', 'PEDIDO_ID', 'FROM_STATE', 'TO_STATE', 'ACTOR_ROLE', 'PAYLOAD_HASH', 'ORIGINAL_CLIENT_AT', 'SERVER_OCCURRED_AT']),
          movements: maskedRows(movements, ['ID', 'BOLSA_ID', 'PEDIDO_ID', 'LINEA_ID', 'TIPO', 'IMPORTE', 'SALDO_ANTERIOR', 'SALDO_POSTERIOR']),
          bag: maskedRows(bag, ['ID', 'EJERCICIO', 'MES', 'SALDO_DISPONIBLE', 'ACUMULADO', 'CONSUMIDO']),
        },
      };
    }
    async function assertReplay(before, orderId, code) {
      const after = await snapshot(orderId);
      check(after.hash === before.hash, code);
      return after;
    }
    const confirmationTarget = pedidos.getPedidosConfirmationTarget();
    check(confirmationTarget?.shouldExportToSystem === false && confirmationTarget?.mode === 'LOCAL', 'LOCAL_CONFIRMATION_TARGET_REQUIRED');
    const product = await pedidos.getProductDetail('1009', '4300032160');
    evidence.lifecycle.preflight = { target: confirmationTarget.mode, stockEnvases: money(product.stockEnvases), unitsPerBox: money(product.unitsPerBox), unitMeasure: product.unitMeasure, tariff1: tariff(product, 1), tariff2: tariff(product, 2), precioTarifaCliente: money(product.precioTarifaCliente), ultimoPrecioHistorico: product.precioCliente == null ? null : money(product.precioCliente) };
    check(evidence.lifecycle.preflight.stockEnvases > 0 && evidence.lifecycle.preflight.unitsPerBox === 5 && product.unitMeasure, 'CANDIDATE_STOCK_OR_UOM_CHANGED');
    check(evidence.lifecycle.preflight.tariff1 === 4.648 && evidence.lifecycle.preflight.tariff2 === 4.124 && evidence.lifecycle.preflight.precioTarifaCliente === 4.648, 'CANDIDATE_TARIFF_CHANGED');
    const bagRows = await read('SELECT ID, SALDO_DISPONIBLE, ACUMULADO, CONSUMIDO FROM JAVIER.TEST_BOLSA_COMERCIAL WHERE TRIM(CODIGOVENDEDOR) = ? AND EJERCICIO = ? AND MES = ?', ['35', year, month]);
    check(bagRows.length === 1 && Number(bagRows[0].ID) === 14 && money(bagRows[0].SALDO_DISPONIBLE) === 300, 'CANDIDATE_BOLSA_CHANGED');
    const preflightMoves = await read('SELECT COUNT(*) AS N FROM JAVIER.TEST_MOVIMIENTOS_BOLSA WHERE BOLSA_ID = ?', [14]);
    evidence.lifecycle.journalBefore = { bolsaId: 14, saldo: money(bagRows[0].SALDO_DISPONIBLE), acumulado: money(bagRows[0].ACUMULADO), consumido: money(bagRows[0].CONSUMIDO), movementCount: Number(preflightMoves[0]?.N || 0) };
    if (mode === 'ReadOnly') {
      check(dedicatedConnectionCount === 0 && readonlyLockAttempts === 0 && readonlySetAttempts === 0, 'READONLY_PHYSICAL_GUARD_FAILED');
      evidence.readOnly = { dedicatedConnections: 0, transactionCommands: 0, lockCommands: 0 };
      evidence.passed = true;
      return;
    }
    scenario = await odbc.connect({ connectionString, connectionTimeout: 10, loginTimeout: 10 });
    closers.push(['scenario', scenario]);
    await scenario.beginTransaction();
    transactionStarted = true;
    await scenario.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    const uniqueMarker = await read('SELECT ID FROM JAVIER.TEST_PEDIDOS_CAB WHERE OBSERVACIONES = ?', [marker]);
    const uniqueToken = await read('SELECT PEDIDO_ID FROM JAVIER.TEST_PEDIDO_IDEMPOTENCY WHERE IDEMPOTENCY_KEY = ?', [idemKey]);
    check(uniqueMarker.length === 0 && uniqueToken.length === 0, 'TEST_MARKER_ALREADY_EXISTS');
    const beforeBag = { id: 14, saldoDisponible: money(bagRows[0].SALDO_DISPONIBLE), acumulado: money(bagRows[0].ACUMULADO), consumido: money(bagRows[0].CONSUMIDO) };
    const stockBefore = Object.fromEntries(await pedidos.getStockBatch(['1009']));
    const sequenceSql = 'SELECT ULTIMO_NUMERO FROM JAVIER.TEST_PEDIDOS_SEQ WHERE EJERCICIO = ?';
    const sequenceBefore = await read(sequenceSql, [year]);
    rollbackBaseline = { beforeBag, stockBefore, sequenceSql, sequenceBefore, year };
    const payload = { clientCode: '4300032160', clientName: '', vendedorCode: '35', userId: '35', userRole: 'COMERCIAL', tipoventa: 'CC', almacen: 1, tarifa: 1, formaPago: '', observaciones: marker, origen: 'A', idempotencyKey: idemKey, clientRequestId: idemKey, deviceId: 'QA-ORDER-BOLSA-DEMO', originalClientAt: new Date().toISOString(), lines: [{ codigoArticulo: '1009', descripcion: product.name, cantidadEnvases: 1, cantidadUnidades: 5, unidadesCaja: 5, unidadMedida: product.unitMeasure, precio: 4.124, precioTarifa: 4.648, precioTarifaCliente: 4.648, precioMinimo: 4.124 }] };
    phase = 'CREATE';
    const created = await pedidos.createOrder(payload);
    const orderId = idOf(created);
    check(Number.isInteger(orderId) && orderId > 0 && ownedId === orderId, 'CREATE_ID_MISSING');
    const createdSnapshot = await snapshot(orderId);
    check(createdSnapshot.raw.header.length === 1 && createdSnapshot.raw.lines.length === 1
      && createdSnapshot.raw.reserve.length === 1 && createdSnapshot.raw.idempotency.length === 1
      && createdSnapshot.raw.events.length === 1 && createdSnapshot.raw.movements.length === 0, 'CREATE_SNAPSHOT_INVALID');
    assertEvents(createdSnapshot, [[null, 'BORRADOR']]);
    evidence.lifecycle.create = { orderId, idempotent: created.idempotent === true, snapshot: createdSnapshot.masked };
    phase = 'CREATE_REPLAY';
    const replayCreate = await pedidos.createOrder(payload);
    check(idOf(replayCreate) === orderId && replayCreate.idempotent === true, 'CREATE_REPLAY_FAILED');
    await assertReplay(createdSnapshot, orderId, 'CREATE_REPLAY_CHANGED_ROWS');
    evidence.lifecycle.createReplay = { idempotent: true };
    const confirmOptions = { userId: '35', userRole: 'COMERCIAL', deviceId: 'QA-ORDER-BOLSA-DEMO', idempotencyKey: `${idemKey}:confirm`, auditReason: marker, requireTariffFloorPilotProfile: true };
    phase = 'CONFIRM';
    const confirmed = await pedidos.confirmOrder(orderId, 'CC', confirmOptions);
    const confirmedSnapshot = await snapshot(orderId);
    check(trim(confirmedSnapshot.raw.header[0]?.ESTADO) === 'CONFIRMADO'
      && confirmedSnapshot.raw.reserve.length === 1
      && confirmedSnapshot.raw.events.length === 3
      && confirmedSnapshot.raw.movements.length > 0, 'CONFIRM_SNAPSHOT_INVALID');
    check(idOf(confirmed) === orderId && confirmed?.idempotentReplay !== true, 'CONFIRM_RESULT_INVALID');
    assertEvents(confirmedSnapshot, [[null, 'BORRADOR'], ['BORRADOR', 'CONFIRMANDO'], ['CONFIRMANDO', 'CONFIRMADO']]);
    evidence.lifecycle.confirm = { idempotentReplay: false, snapshot: confirmedSnapshot.masked };
    const afterConfirm = await bolsa.getBolsaStatus('35', new Date().getFullYear(), new Date().getMonth() + 1);
    const movements = await bolsa.getMovimientos('35', new Date().getFullYear(), new Date().getMonth() + 1, 200, {});
    const ownMoves = movements.filter((row) => Number(row.pedidoId) === orderId);
    check(ownMoves.length === 1 && ['CONSUMO', 'ACUMULACION'].includes(String(ownMoves[0].tipo)), 'BOLSA_MOVEMENT_NOT_GENUINE');
    const movementTotal = money(ownMoves.reduce((total, row) => total + Number(row.importe || 0), 0));
    check(movementTotal > 0 && money(afterConfirm.saldoDisponible) !== money(beforeBag.saldoDisponible), 'BOLSA_BALANCE_NOT_CHANGED');
    evidence.lifecycle.bolsaAfterConfirm = { movementTypes: ownMoves.map((row) => row.tipo), movementTotal, saldo: money(afterConfirm.saldoDisponible) };
    phase = 'CONFIRM_REPLAY';
    const replayConfirm = await pedidos.confirmOrder(orderId, 'CC', confirmOptions);
    check(replayConfirm?.idempotentReplay === true, 'CONFIRM_REPLAY_FAILED');
    await assertReplay(confirmedSnapshot, orderId, 'CONFIRM_REPLAY_CHANGED_ROWS');
    const afterConfirmReplay = await bolsa.getMovimientos('35', new Date().getFullYear(), new Date().getMonth() + 1, 200, {});
    check(afterConfirmReplay.filter((row) => Number(row.pedidoId) === orderId).length === ownMoves.length, 'CONFIRM_REPLAY_DUPLICATED_BOLSA');
    evidence.lifecycle.confirmReplay = { idempotentReplay: true };
    const cancelOptions = { userId: '35', userRole: 'COMERCIAL', deviceId: 'QA-ORDER-BOLSA-DEMO', idempotencyKey: `${idemKey}:cancel`, reason: `QA ${marker}` };
    phase = 'CANCEL';
    const cancelled = await pedidos.cancelOrder(orderId, cancelOptions);
    check(cancelled?.idempotentReplay === false && cancelled.bolsaReversalCount === ownMoves.length, 'CANCEL_RESULT_INVALID');
    evidence.lifecycle.cancel = { idempotentReplay: false, reversalCount: cancelled.bolsaReversalCount };
    const cancelledSnapshot = await snapshot(orderId);
    assertEvents(cancelledSnapshot, [[null, 'BORRADOR'], ['BORRADOR', 'CONFIRMANDO'], ['CONFIRMANDO', 'CONFIRMADO'], ['CONFIRMADO', 'CANCELANDO'], ['CANCELANDO', 'CANCELADO']]);
    phase = 'CANCEL_REPLAY';
    const cancelledReplay = await pedidos.cancelOrder(orderId, cancelOptions);
    check(cancelledReplay?.idempotentReplay === true, 'CANCEL_REPLAY_FAILED');
    await assertReplay(cancelledSnapshot, orderId, 'CANCEL_REPLAY_CHANGED_ROWS');
    const header = await read('SELECT ID, TRIM(ESTADO) AS ESTADO FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID = ? AND OBSERVACIONES = ?', [orderId, marker]);
    const reserves = await read('SELECT PEDIDO_ID FROM JAVIER.TEST_PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?', [orderId]);
    const afterCancel = await bolsa.getBolsaStatus('35', new Date().getFullYear(), new Date().getMonth() + 1);
    const afterCancelMoves = await bolsa.getMovimientos('35', new Date().getFullYear(), new Date().getMonth() + 1, 200, {});
    const ownAfterCancel = afterCancelMoves.filter((row) => Number(row.pedidoId) === orderId);
    check(header.length === 1 && String(header[0].ESTADO).trim() === 'CANCELADO', 'CANCEL_STATE_NOT_RETAINED');
    check(reserves.length === 0, 'CANCEL_RESERVATION_NOT_RELEASED');
    check(ownAfterCancel.length === 2 * ownMoves.length, 'BOLSA_REVERSAL_NOT_RECORDED');
    check(money(afterCancel.saldoDisponible) === money(beforeBag.saldoDisponible), 'BOLSA_REVERSAL_NOT_NEUTRAL');
    check(money(afterCancel.acumulado) === beforeBag.acumulado
      && money(afterCancel.consumido) === beforeBag.consumido, 'BOLSA_AGGREGATES_NOT_RESTORED');
    for (const original of ownMoves) {
      const expectedType = `REVERSO_${String(original.tipo).trim()}`;
      const originalRow = confirmedSnapshot.raw.movements.find(row => Number(row.ID) === Number(original.id));
      check(originalRow, 'ORIGINAL_BOLSA_ROW_NOT_FOUND');
      const reverse = cancelledSnapshot.raw.movements.filter(row => trim(row.TIPO) === expectedType
        && money(row.IMPORTE) === money(original.importe)
        && trim(row.LINEA_ID) === trim(originalRow.LINEA_ID)
        && money(row.SALDO_ANTERIOR) === money(originalRow.SALDO_POSTERIOR)
        && money(row.SALDO_POSTERIOR) === money(originalRow.SALDO_ANTERIOR)
        && trim(row.IDEMPOTENCY_KEY) === 'pedido-' + orderId + '-movement-' + original.id + '-reverse');
      check(reverse.length === 1, 'BOLSA_REVERSAL_PAIR_INVALID');
    }
    const stockAfter = Object.fromEntries(await pedidos.getStockBatch(['1009']));
    check(stableHash(stockAfter) === stableHash(stockBefore), 'STOCK_NOT_RESTORED');
    evidence.lifecycle.cancelReplay = { idempotentReplay: true };
    evidence.lifecycle.afterCancel = { state: 'CANCELADO', reserveRows: 0, movementRows: ownAfterCancel.length, saldo: money(afterCancel.saldoDisponible), acumulado: money(afterCancel.acumulado), consumido: money(afterCancel.consumido), stockRestored: true, snapshot: cancelledSnapshot.masked };
    check(!logicalOpen && !logicalFailed, 'SERVICE_TRANSACTION_STATE_INVALID');
    evidence.passed = true;
  } catch (error) {
    evidence.passed = false;
    evidence.error = { phase, ...diagnostic(error) };
    process.exitCode = 1;
  } finally {
    if (transactionStarted) {
      try {
        await serial;
        await scenario.rollback();
        transactionStarted = false;
        evidence.physicalRollbackCompleted = true;
        const [markerRows, tokenRows] = await Promise.all([
          read('SELECT ID FROM JAVIER.TEST_PEDIDOS_CAB WHERE OBSERVACIONES = ?', [marker]),
          read('SELECT PEDIDO_ID FROM JAVIER.TEST_PEDIDO_IDEMPOTENCY WHERE IDEMPOTENCY_KEY = ?', [idemKey]),
        ]);
        check(markerRows.length === 0 && tokenRows.length === 0, 'ROLLBACK_OWNED_HEADER_OR_TOKEN_REMAIN');
        if (ownedId !== null) {
          for (const table of ['TEST_PEDIDOS_LIN', 'TEST_PEDIDOS_STOCK_RESERVE',
            'TEST_PEDIDO_STATE_EVENTS', 'TEST_MOVIMIENTOS_BOLSA']) {
            const rows = await read('SELECT PEDIDO_ID FROM JAVIER.' + table + ' WHERE PEDIDO_ID = ?', [ownedId]);
            check(rows.length === 0, 'ROLLBACK_CHILD_ROWS_REMAIN');
          }
        }
        if (rollbackBaseline) {
          const base = rollbackBaseline;
          const [bag] = await read('SELECT SALDO_DISPONIBLE, ACUMULADO, CONSUMIDO FROM JAVIER.TEST_BOLSA_COMERCIAL WHERE ID = ?', [14]);
          check(bag && money(bag.SALDO_DISPONIBLE) === base.beforeBag.saldoDisponible
            && money(bag.ACUMULADO) === base.beforeBag.acumulado
            && money(bag.CONSUMIDO) === base.beforeBag.consumido, 'ROLLBACK_BOLSA_DIFFERS');
          const stock = Object.fromEntries(await orderService.getStockBatch(['1009']));
          const sequence = await read(base.sequenceSql, [base.year]);
          check(stableHash(stock) === stableHash(base.stockBefore), 'ROLLBACK_STOCK_DIFFERS');
          check(stableHash(sequence) === stableHash(base.sequenceBefore), 'ROLLBACK_SEQUENCE_DIFFERS');
        }
        evidence.rollbackVerified = true;
      } catch (error) {
        evidence.passed = false;
        evidence.rollbackError = diagnostic(error);
        process.exitCode = 1;
      }
    }
    for (const [name, resource] of closers.reverse()) {
      try { if (resource && typeof resource.close === 'function') await resource.close(); evidence.closed[name] = true; }
      catch (_) { evidence.closed[name] = false; process.exitCode = 1; }
    }
    evidence.writes = [...writes].sort();
    evidence.writeCounts = Object.fromEntries([...writeCounts].sort(([left], [right]) => left.localeCompare(right)));
    console.log(`ORDER_BOLSA_DEMO=${json(evidence)}`);
  }
}

main().catch((error) => { console.log(`ORDER_BOLSA_DEMO=${json({ passed: false, error: diagnostic(error), closed: {} })}`); process.exitCode = 1; });
