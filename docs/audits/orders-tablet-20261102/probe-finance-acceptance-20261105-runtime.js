'use strict';

const bundle = global.__FINANCE_ACCEPTANCE_BUNDLE__;
const crypto = require('crypto');
const Module = require('module');
const path = require('path').posix;

const sealedCommit = 'ef793d74821f7a8fdaade9a2227f26973bc527f2';
const actor = Object.freeze({ userId: '35', userRole: 'COMERCIAL' });
const methods = Object.freeze(['CONTADO', 'TJ', 'TR']);
const allowedNative = new Set(['crypto', 'fs', 'path', 'cluster', 'dotenv', 'odbc']);
const targetTables = Object.freeze([
  'JAVIER.TEST_COBROS',
  'JAVIER.TEST_LIQUIDACION_COMERCIAL',
]);
const lockTables = new Set([
  'JAVIER.TEST_REPARTIDOR_COBROS',
  ...targetTables,
]);

const trim = value => String(value ?? '').trim();
const cents = value => Math.round(Number(value) * 100);
const encode = value => JSON.stringify(
  value,
  (_, item) => typeof item === 'bigint' ? item.toString() : item,
);
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object' && !(value instanceof Date)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const hash = value => crypto.createHash('sha256')
  .update(typeof value === 'string' ? value : encode(canonical(value)))
  .digest('hex');
const rowsHash = rows => hash(rows.map(row => encode(canonical(row))).sort());

function check(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function diagnostic(error) {
  return {
    code: /^[A-Z][A-Z0-9_]{2,90}$/.test(error?.code || '')
      ? error.code
      : 'FINANCE_ACCEPTANCE_FAILED',
    odbc: (error?.odbcErrors || []).map(item => ({
      state: /^[A-Z0-9]{5}$/.test(item.state || '') ? item.state : null,
      code: Number.isFinite(Number(item.code)) ? Number(item.code) : null,
    })),
  };
}

const evidence = {
  job: 'FINANCE_ACCEPTANCE_20261105',
  mode: bundle?.mode,
  sourceCommit: bundle?.commit,
  profile: null,
  phase: 'SETUP',
  queryCount: 0,
  physicalDml: 0,
  physicalCommit: 0,
  physicalRollback: 0,
  virtualBegin: 0,
  virtualCommit: 0,
  virtualRollback: 0,
  virtualClose: 0,
  exportsSuppressed: 0,
  allConnectionsClosed: false,
};

let odbc;
let connectionString;
let activeReadConnection = null;
let writerConnection = null;
let readConnectionOpen = false;
let writerConnectionOpen = false;
let writerFacade = null;
let queryChain = Promise.resolve();
let businessDate = null;
let candidates = [];
let candidateByToken = new Map();
let settlementToken = null;
let settlementExpected = null;
let metadataColumns = new Map();
let watchdog;
const modules = new Map();
const stubs = {};

function cleanSql(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolved(from, request) {
  const key = path.normalize(path.join(path.dirname(from), request));
  check(!key.startsWith('../') && !path.isAbsolute(key), 'SOURCE_PATH_ESCAPE');
  return key.endsWith('.js') ? key : `${key}.js`;
}

function load(key) {
  if (Object.hasOwn(stubs, key)) return stubs[key];
  if (modules.has(key)) return modules.get(key).exports;
  check(Object.hasOwn(bundle.sources, key), 'UNSEALED_DEPENDENCY');
  const mod = new Module(`/sealed-finance-acceptance/${key}`, module);
  mod.filename = `/sealed-finance-acceptance/${key}`;
  modules.set(key, mod);
  mod.require = request => {
    if (allowedNative.has(request)) return require(request);
    check(request.startsWith('.'), 'EXTERNAL_DEPENDENCY_REJECTED');
    return load(resolved(key, request));
  };
  mod._compile(bundle.sources[key], mod.filename);
  return mod.exports;
}

function staticClosureCheck() {
  const edges = [];
  for (const [key, source] of Object.entries(bundle.sources)) {
    for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const request = match[1];
      if (allowedNative.has(request)) continue;
      check(request.startsWith('.'), 'UNSEALED_EXTERNAL_IMPORT');
      const target = resolved(key, request);
      check(Object.hasOwn(stubs, target) || Object.hasOwn(bundle.sources, target),
        'INCOMPLETE_SEALED_CLOSURE');
      edges.push(`${key}->${target}`);
    }
  }
  evidence.closureEdgeCount = edges.length;
}

function isReadSql(text) {
  return /^(SELECT|WITH)\s/i.test(text)
    && !/;|\b(INSERT|UPDATE|DELETE|MERGE|CALL|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(text);
}

function inspectMutation(text, params) {
  check(bundle.mode === 'Rollback' && writerConnection, 'MUTATION_REJECTED_OUTSIDE_ROLLBACK');
  check(!/\b(DELETE|UPDATE|MERGE|CALL|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(text),
    'NON_INSERT_MUTATION_REJECTED');
  const match = /^INSERT INTO (JAVIER\.TEST_COBROS|JAVIER\.TEST_LIQUIDACION_COMERCIAL) \(([^)]+)\) VALUES \(([^)]+)\)$/i.exec(text);
  check(match, 'WRITE_SQL_OUTSIDE_EXACT_TARGETS');
  const table = match[1].toUpperCase();
  const columns = match[2].split(',').map(value => trim(value).toUpperCase());
  const placeholders = match[3].split(',').map(trim);
  check(columns.length === params.length && placeholders.every(value => value === '?'),
    'INSERT_PARAMETER_SHAPE_REJECTED');
  const known = metadataColumns.get(table);
  check(known && columns.every(column => known.has(column)),
    'INSERT_COLUMN_METADATA_UNVERIFIED');
  const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));

  if (table === 'JAVIER.TEST_COBROS') {
    const expected = candidateByToken.get(trim(row.IDEMPOTENCY_TOKEN));
    check(expected, 'FOREIGN_PAYMENT_TOKEN_REJECTED');
    check(trim(row.CODIGO_CLIENTE) === expected.clientCode
      && trim(row.REFERENCIA) === expected.reference
      && cents(row.IMPORTE) === expected.amountCents
      && trim(row.FORMA_PAGO) === expected.paymentMethod
      && trim(row.CODIGOVENDEDOR) === '35'
      && trim(row.CODIGO_USUARIO) === '35'
      && trim(row.TIPO_USUARIO) === 'COMERCIAL'
      && trim(row.TIPO_VENTA) === 'CC'
      && row.TIPO_MODO == null
      && row.OBSERVACIONES === expected.observations,
    'PAYMENT_INSERT_FINGERPRINT_REJECTED');
  } else {
    check(trim(row.IDEMPOTENCY_TOKEN) === settlementToken
      && trim(row.CODIGO_VENDEDOR) === '35'
      && String(row.FECHA).slice(0, 10) === businessDate
      && trim(row.STATUS) === 'SAVED'
      && trim(row.CREATED_BY) === '35',
    'SETTLEMENT_INSERT_IDENTITY_REJECTED');
    check(settlementExpected
      && Object.entries(settlementExpected).every(([column, value]) => (
        cents(row[column]) === cents(value)
      )), 'SETTLEMENT_INSERT_MONETARY_REJECTED');
  }
  return { kind: 'INSERT', table };
}

function guardSql(sql, params = [], { writer = false } = {}) {
  const text = cleanSql(sql);
  check(Array.isArray(params), 'SQL_PARAMS_ARRAY_REQUIRED');
  check(!text.includes(';'), 'MULTI_STATEMENT_REJECTED');
  if (isReadSql(text)) return { kind: 'READ', text };
  if (/^SET TRANSACTION ISOLATION LEVEL READ COMMITTED$/i.test(text)) {
    check(writer && bundle.mode === 'Rollback', 'TRANSACTION_SETTING_REJECTED');
    return { kind: 'VIRTUAL_SET', text };
  }
  const lock = /^LOCK TABLE (JAVIER\.TEST_[A-Z0-9_]+) IN EXCLUSIVE MODE$/i.exec(text);
  if (lock) {
    check(writer && lockTables.has(lock[1].toUpperCase()), 'LOCK_TARGET_REJECTED');
    return { kind: 'LOCK', text };
  }
  check(writer, 'READONLY_SQL_REQUIRED');
  return { ...inspectMutation(text, params), text };
}

async function nativeQuery(connection, sql, params = [], options = {}) {
  const classification = guardSql(sql, params, options);
  if (classification.kind === 'VIRTUAL_SET') return [];
  const operation = queryChain.then(() => connection.query(sql, params, { timeout: 25 }));
  queryChain = operation.catch(() => undefined);
  const result = await operation;
  evidence.queryCount += 1;
  if (classification.kind === 'INSERT') evidence.physicalDml += 1;
  return result;
}

async function openNativeConnection() {
  const connection = await odbc.connect({
    connectionString,
    connectionTimeout: 10,
    loginTimeout: 10,
  });
  check(connection && typeof connection.query === 'function', 'ODBC_CONNECTION_UNAVAILABLE');
  return connection;
}

async function openReadSession() {
  check(!activeReadConnection && !writerConnection, 'CONNECTION_PHASE_OVERLAP_REJECTED');
  activeReadConnection = await openNativeConnection();
  readConnectionOpen = true;
  return activeReadConnection;
}

async function closeReadSession() {
  if (!activeReadConnection) return;
  const connection = activeReadConnection;
  await connection.close();
  activeReadConnection = null;
  readConnectionOpen = false;
}

async function execute(sql, params = []) {
  if (writerConnection) {
    return nativeQuery(writerConnection, sql, params, { writer: true });
  }
  check(activeReadConnection, 'READ_SESSION_REQUIRED');
  return nativeQuery(activeReadConnection, sql, params, { writer: false });
}

function createWriterFacade() {
  return {
    query: (sql, params = []) => nativeQuery(writerConnection, sql, params, { writer: true }),
    beginTransaction: async () => { evidence.virtualBegin += 1; },
    commit: async () => { evidence.virtualCommit += 1; },
    rollback: async () => { evidence.virtualRollback += 1; },
    close: async () => { evidence.virtualClose += 1; },
  };
}

async function openWriterTransaction() {
  check(bundle.mode === 'Rollback' && !activeReadConnection && !writerConnection,
    'WRITER_PHASE_REJECTED');
  writerConnection = await openNativeConnection();
  writerConnectionOpen = true;
  await writerConnection.beginTransaction();
  writerFacade = createWriterFacade();
}

async function rollbackAndCloseWriter() {
  if (!writerConnection) return;
  const connection = writerConnection;
  try {
    await connection.rollback();
    evidence.physicalRollback += 1;
  } finally {
    await connection.close();
    writerConnection = null;
    writerFacade = null;
    writerConnectionOpen = false;
  }
}

function noUnusedOperation() {
  throw Object.assign(new Error('UNUSED_DEPENDENCY_CALLED'), { code: 'UNUSED_DEPENDENCY_CALLED' });
}

stubs['config/db.js'] = {
  query: (sql, params = []) => execute(sql, params),
  queryWithParams: (sql, params = []) => execute(sql, params),
};
stubs['middleware/logger.js'] = { info() {}, warn() {}, error() {}, debug() {} };
stubs['services/laclae.js'] = { getClientCodesFromCache: noUnusedOperation };
stubs['services/comercial-devolucion-pdf-service.js'] = {
  buildReturnPdfPath: noUnusedOperation,
  buildDevolucionPdfBuffer: noUnusedOperation,
  devolucionPdfFileName: noUnusedOperation,
};
stubs['src/repositories/bSales.repository.js'] = { bSalesRepository: {} };
stubs['optional/dsedac-exports.impl.js'] = {};
stubs['services/dsedac-exports.service.js'] = {
  exportGate: () => ({ enabled: false }),
  exportCobroToSystem: async () => {
    evidence.exportsSuppressed += 1;
    return { skipped: true };
  },
};
stubs['adapters/pedidos-local-order-state-guard.js'] = {
  lockLocalOrderCoordinator: noUnusedOperation,
};
stubs['adapters/pedidos-transaction-connection.js'] = {
  openDedicatedPedidosTransactionConnection: async () => {
    check(writerFacade, 'WRITER_FACADE_UNAVAILABLE');
    return writerFacade;
  },
};

async function currentBusinessDate() {
  const rows = await execute(
    "SELECT VARCHAR_FORMAT(CURRENT DATE, 'YYYY-MM-DD') AS TODAY FROM SYSIBM.SYSDUMMY1",
  );
  const value = trim(rows[0]?.TODAY);
  check(/^\d{4}-\d{2}-\d{2}$/.test(value), 'BUSINESS_DATE_UNAVAILABLE');
  return value;
}

async function assertBusinessDateUnchanged() {
  check(await currentBusinessDate() === businessDate, 'BUSINESS_DATE_CHANGED_DURING_PROBE');
}

async function verifyTableCatalog(table) {
  const name = table.split('.')[1];
  const columns = await execute(
    `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    ['JAVIER', name],
  );
  check(columns.length > 0, 'TEST_TABLE_COLUMNS_UNAVAILABLE');
  metadataColumns.set(table, new Set(columns.map(row => trim(row.COLUMN_NAME).toUpperCase())));
  const constraints = await execute(
    `SELECT C.CONSTRAINT_NAME, C.CONSTRAINT_TYPE, C.ENABLED,
            K.COLUMN_NAME, K.ORDINAL_POSITION
       FROM QSYS2.SYSCST C
       JOIN QSYS2.SYSKEYCST K
         ON K.CONSTRAINT_SCHEMA = C.CONSTRAINT_SCHEMA
        AND K.CONSTRAINT_NAME = C.CONSTRAINT_NAME
        AND K.TABLE_SCHEMA = C.TABLE_SCHEMA
        AND K.TABLE_NAME = C.TABLE_NAME
      WHERE C.TABLE_SCHEMA = ? AND C.TABLE_NAME = ?
        AND C.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
      ORDER BY C.CONSTRAINT_TYPE, K.ORDINAL_POSITION`,
    ['JAVIER', name],
  );
  check(constraints.some(row => trim(row.CONSTRAINT_TYPE) === 'PRIMARY KEY'
      && trim(row.ENABLED) === 'YES' && trim(row.COLUMN_NAME) === 'ID'),
  'ENABLED_PRIMARY_KEY_ID_REQUIRED');
  const uniqueConstraints = new Map();
  for (const row of constraints.filter(item => (
    trim(item.CONSTRAINT_TYPE) === 'UNIQUE' && trim(item.ENABLED) === 'YES'
  ))) {
    const key = trim(row.CONSTRAINT_NAME);
    uniqueConstraints.set(key, [...(uniqueConstraints.get(key) || []), row]);
  }
  const exactUniqueConstraint = [...uniqueConstraints.values()].some(rows => (
    rows.length === 1
      && Number(rows[0].ORDINAL_POSITION) === 1
      && trim(rows[0].COLUMN_NAME) === 'IDEMPOTENCY_TOKEN'
  ));
  const indexes = await execute(
    `SELECT I.INDEX_NAME, I.IS_UNIQUE, K.COLUMN_NAME, K.ORDINAL_POSITION
       FROM QSYS2.SYSINDEXES I
       JOIN QSYS2.SYSKEYS K
         ON K.INDEX_SCHEMA = I.INDEX_SCHEMA
        AND K.INDEX_NAME = I.INDEX_NAME
      WHERE I.TABLE_SCHEMA = ? AND I.TABLE_NAME = ?
      ORDER BY I.INDEX_NAME, K.ORDINAL_POSITION`,
    ['JAVIER', name],
  );
  const uniqueIndexes = new Map();
  for (const row of indexes.filter(item => (
    ['U', 'V'].includes(trim(item.IS_UNIQUE).toUpperCase())
  ))) {
    const key = trim(row.INDEX_NAME);
    uniqueIndexes.set(key, [...(uniqueIndexes.get(key) || []), row]);
  }
  const exactUniqueIndex = [...uniqueIndexes.values()].some(rows => (
    rows.length === 1
      && Number(rows[0].ORDINAL_POSITION) === 1
      && trim(rows[0].COLUMN_NAME) === 'IDEMPOTENCY_TOKEN'
  ));
  check(exactUniqueConstraint || exactUniqueIndex,
  'ENABLED_IDEMPOTENCY_UNIQUE_REQUIRED');
  const journal = await execute(
    "SELECT JOURNALED, JOURNAL_LIBRARY, JOURNAL_NAME, JOURNAL_IMAGES FROM TABLE(QSYS2.OBJECT_STATISTICS('JAVIER','*FILE',CAST(? AS VARCHAR(128)))) X",
    [name],
  );
  check(journal.length === 1 && trim(journal[0].JOURNALED) === 'YES'
      && trim(journal[0].JOURNAL_LIBRARY) === 'JAVIER'
      && trim(journal[0].JOURNAL_NAME) === 'QSQJRN'
      && trim(journal[0].JOURNAL_IMAGES) === '*BOTH',
  'TEST_TABLE_JOURNAL_UNVERIFIED');
  const triggers = await execute(
    `SELECT TRIGGER_NAME FROM QSYS2.SYSTRIGGERS
      WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?`,
    ['JAVIER', name],
  );
  check(triggers.length === 0, 'TEST_TABLE_TRIGGER_SIDE_EFFECT_REJECTED');
  return {
    columnCount: columns.length,
    constraints: constraints.length,
    indexes: indexes.length,
    triggerCount: 0,
  };
}

async function boundedSnapshot() {
  const cobros = await execute(
    `SELECT ID, IDEMPOTENCY_TOKEN, IMPORTE, FORMA_PAGO, CODIGOVENDEDOR, FECHA
       FROM JAVIER.TEST_COBROS
      WHERE TRIM(CODIGOVENDEDOR) = ?
        AND YEAR(FECHA) = ? AND MONTH(FECHA) = ? AND DAY(FECHA) = ?
      ORDER BY ID`,
    ['35', Number(businessDate.slice(0, 4)), Number(businessDate.slice(5, 7)),
      Number(businessDate.slice(8, 10))],
  );
  const liquidacion = await execute(
    `SELECT ID, IDEMPOTENCY_TOKEN, CODIGO_VENDEDOR, FECHA, TOTAL_A_INGRESAR, STATUS
       FROM JAVIER.TEST_LIQUIDACION_COMERCIAL
      WHERE TRIM(CODIGO_VENDEDOR) = ? AND FECHA = ?
      ORDER BY ID`,
    ['35', businessDate],
  );
  return { cobros, liquidacion };
}

function ownedTokens() {
  return new Set([...candidateByToken.keys(), settlementToken].filter(Boolean));
}

function snapshotDigest(snapshot) {
  const own = ownedTokens();
  const result = {};
  for (const [name, rows] of Object.entries(snapshot)) {
    const owned = rows.filter(row => own.has(trim(row.IDEMPOTENCY_TOKEN)));
    const foreign = rows.filter(row => !own.has(trim(row.IDEMPOTENCY_TOKEN)));
    result[name] = {
      count: rows.length,
      ownedCount: owned.length,
      foreignCount: foreign.length,
      foreignSha256: rowsHash(foreign),
    };
  }
  return result;
}

async function discoverCandidates(repository) {
  const clientRows = await execute(
    `SELECT DISTINCT TRIM(CODIGOCLIENTEALBARAN) AS CLIENT_CODE
       FROM DSEDAC.CVC
      WHERE CODIGOVENDEDOR = CAST(? AS CHAR(2))
        AND IMPORTEPENDIENTE > 0
        AND (ANULADOSN IS NULL OR ANULADOSN <> 'S')
        AND TIPODOCUMENTO = CAST(? AS CHAR(3))
        AND ORIGENDOCUMENTO = CAST(? AS CHAR(1))
      ORDER BY CLIENT_CODE FETCH FIRST 30 ROWS ONLY`,
    ['35', 'COB', 'F'],
  );
  const selected = [];
  const seenReferences = new Set();
  for (const clientRow of clientRows) {
    const clientCode = trim(clientRow.CLIENT_CODE);
    const pending = await repository.getPendientes(clientCode, {
      userId: '35',
      userRole: 'COMERCIAL',
      vendorCodes: ['35'],
      limit: 50,
    });
    for (const document of pending.cobros || []) {
      if (selected.length >= methods.length) break;
      if (document.docKey?.source !== 'CVC' || document.cobrable !== true
          || document.responsabilidad !== 'COMERCIAL'
          || document.documentoNoDisponible === true
          || cents(document.importePendiente) <= 0
          || seenReferences.has(trim(document.id))) continue;
      const order = await repository.findOrderForPayment(clientCode, document.id, execute);
      const reference = trim(document.id);
      const orderReference = trim(order?.ID);
      const referenceMatches = orderReference.startsWith('CVC:')
        && orderReference === reference;
      if (!order || trim(order.SOURCE) !== 'CVC'
          || !referenceMatches
          || trim(order.CODIGOVENDEDOR) !== '35'
          || cents(order.IMPORTETOTAL) !== cents(document.importePendiente)
          || cents(order.IMPORTE_DOCUMENTO) < cents(document.importePendiente)) continue;
      if (await repository.resolveOrderSaleType(order, execute) !== 'CC') continue;
      seenReferences.add(reference);
      selected.push({
        clientCode,
        reference,
        referenceMatches,
        amount: Number(document.importePendiente),
        amountCents: cents(document.importePendiente),
        pendingBeforeCents: cents(document.importePendiente),
      });
    }
    if (selected.length >= methods.length) break;
  }
  evidence.candidateClientCount = clientRows.length;
  evidence.eligibleCandidateCount = selected.length;
  check(selected.length === methods.length, 'THREE_REAL_CANDIDATES_UNAVAILABLE');
  return selected;
}

function bindCandidateOperations(selected) {
  const bound = selected.map((candidate, index) => {
    const fingerprint = hash(
      `${candidate.clientCode}|${candidate.reference}|${candidate.amountCents}|${businessDate}`,
    );
    const paymentMethod = methods[index];
    const idempotencyToken = `fin-accept-${businessDate.replaceAll('-', '')}-${paymentMethod.toLowerCase()}-${fingerprint.slice(0, 20)}`;
    const observations = 'Aceptacion financiera comercial TEST DEMO; rollback obligatorio';
    return {
      ...candidate,
      fingerprint,
      paymentMethod,
      idempotencyToken,
      observations,
      ...actor,
    };
  });
  candidateByToken = new Map(bound.map(candidate => [candidate.idempotencyToken, candidate]));
  const candidateSetSha256 = hash(bound.map(candidate => ({
    fingerprint: candidate.fingerprint,
    method: candidate.paymentMethod,
    amountCents: candidate.amountCents,
  })));
  settlementToken = `fin-accept-${businessDate.replaceAll('-', '')}-liq35-${candidateSetSha256.slice(0, 20)}`;
  evidence.candidateSetSha256 = candidateSetSha256;
  evidence.candidates = bound.map(candidate => ({
    fingerprint: candidate.fingerprint,
    method: candidate.paymentMethod,
    amountCents: candidate.amountCents,
    referenceMatches: candidate.referenceMatches,
  }));
  return bound;
}

function assertAuthorization() {
  const authorization = bundle.authorization;
  check(authorization?.action === 'FINANCE_ACCEPTANCE_ROLLBACK'
      && authorization.approved === true
      && authorization.sourceCommit === sealedCommit
      && authorization.businessDate === businessDate
      && authorization.candidateSetSha256 === evidence.candidateSetSha256,
  'ROLLBACK_AUTHORIZATION_STALE_OR_MISMATCHED');
}

async function assertDebtRestored(repository, candidate) {
  const pending = await repository.getPendientes(candidate.clientCode, {
    userId: '35',
    userRole: 'COMERCIAL',
    vendorCodes: ['35'],
    limit: 50,
  });
  const document = (pending.cobros || []).find(item => trim(item.id) === candidate.reference);
  check(document && cents(document.importePendiente) === candidate.pendingBeforeCents,
    'CANONICAL_DEBT_NOT_RESTORED');
}

async function executeRollbackAcceptance(repository, finance, before) {
  assertAuthorization();
  await closeReadSession();
  await openWriterTransaction();
  let operationError;
  try {
    for (const candidate of candidates) {
      await assertBusinessDateUnchanged();
      const payload = {
        clientCode: candidate.clientCode,
        amount: candidate.amount,
        paymentMethod: candidate.paymentMethod,
        reference: candidate.reference,
        observations: candidate.observations,
        userId: candidate.userId,
        userRole: candidate.userRole,
        idempotencyToken: candidate.idempotencyToken,
      };
      const fresh = await repository.registerPayment(payload);
      const replay = await repository.registerPayment(payload);
      check(fresh.idempotent === false && replay.idempotent === true
          && fresh.id === replay.id && cents(fresh.pendingAfter) === 0,
      'PAYMENT_REPLAY_OR_BALANCE_REJECTED');
      const rows = await execute(
        'SELECT ID, IMPORTE, FORMA_PAGO FROM JAVIER.TEST_COBROS WHERE IDEMPOTENCY_TOKEN = ?',
        [candidate.idempotencyToken],
      );
      check(rows.length === 1 && cents(rows[0].IMPORTE) === candidate.amountCents
          && trim(rows[0].FORMA_PAGO) === candidate.paymentMethod,
      'PAYMENT_PERSISTENCE_REJECTED');
    }

    await assertBusinessDateUnchanged();
    const summary = await finance.getDailySummary(
      { vendorCodes: ['35'], date: businessDate },
      { queryWithParams: execute },
    );
    const expectedBuckets = Object.fromEntries(candidates.map(candidate => [
      candidate.paymentMethod,
      candidate.amount,
    ]));
    check(Number(summary.cobros?.count) === 3
        && cents(summary.summary?.totalEfectivo) === cents(expectedBuckets.CONTADO)
        && cents(summary.summary?.totalTarjeta) === cents(expectedBuckets.TJ)
        && cents(summary.summary?.totalTransferencia) === cents(expectedBuckets.TR),
    'DAILY_SUMMARY_METHOD_BUCKETS_REJECTED');
    settlementExpected = {
      INGRESO_BANCO: summary.summary.totalAIngresar,
      ENTREGADO: 0,
      TOTAL_ESPERADO: summary.summary.totalAIngresar,
      TOTAL_EFECTIVO: summary.summary.totalEfectivo,
      TOTAL_CHEQUES: summary.summary.totalCheques,
      TOTAL_POSTDATADOS: summary.summary.totalPostdatados,
      SALDO_ACTUAL: summary.summary.saldoActual,
      DEVOLUCIONES_YA_COBRADAS: summary.summary.devolucionesYaCobradas,
      TOTAL_A_INGRESAR: summary.summary.totalAIngresar,
    };
    const actions = {
      vendorCodes: ['35'],
      date: businessDate,
      ingresoBanco: summary.summary.totalAIngresar,
      entregado: 0,
      expectedRevision: null,
      createdBy: '35',
      idempotencyToken: settlementToken,
    };
    const deps = {
      queryWithParams: execute,
      openDedicatedConnection: async () => writerFacade,
    };
    const saved = await finance.saveLiquidacion(actions, deps);
    const replay = await finance.saveLiquidacion(actions, deps);
    check(saved.idempotent === false && replay.idempotent === true
        && saved.status === 'SAVED' && replay.status === 'SAVED'
        && saved.token === settlementToken && replay.token === settlementToken,
    'SETTLEMENT_REPLAY_REJECTED');
    evidence.summary = {
      count: summary.cobros.count,
      bucketsCents: {
        CONTADO: cents(summary.summary.totalEfectivo),
        TJ: cents(summary.summary.totalTarjeta),
        TR: cents(summary.summary.totalTransferencia),
      },
      totalAIngresarCents: cents(summary.summary.totalAIngresar),
    };
  } catch (error) {
    operationError = error;
  }
  try {
    await rollbackAndCloseWriter();
  } catch (error) {
    operationError ||= error;
  }

  let observerError;
  try {
    check(!writerConnection && !writerConnectionOpen,
      'OBSERVER_REQUIRES_CLOSED_WRITER');
    evidence.phase = 'OBSERVER';
    await openReadSession();
    const after = await boundedSnapshot();
    const afterDigest = snapshotDigest(after);
    evidence.after = afterDigest;
    check(afterDigest.cobros.ownedCount === 0
        && afterDigest.liquidacion.ownedCount === 0,
    'ROLLBACK_LEFT_OWNED_ROWS');
    check(before.cobros.foreignSha256 === afterDigest.cobros.foreignSha256
        && before.liquidacion.foreignSha256 === afterDigest.liquidacion.foreignSha256,
    'ROLLBACK_CHANGED_UNRELATED_ROWS');
    for (const candidate of candidates) {
      await assertDebtRestored(repository, candidate);
    }
    evidence.debtsRestored = candidates.length;
  } catch (error) {
    observerError = error;
  } finally {
    try {
      await closeReadSession();
    } catch (error) {
      observerError ||= error;
    }
  }
  if (observerError) evidence.observerError = diagnostic(observerError);
  if (operationError) throw operationError;
  if (observerError) throw observerError;
  check(evidence.physicalDml === 4
      && evidence.physicalCommit === 0
      && evidence.physicalRollback === 1
      && evidence.virtualBegin === 8
      && evidence.virtualCommit === 8
      && evidence.virtualRollback === 0
      && evidence.virtualClose === 8
      && evidence.exportsSuppressed === 3,
  'ROLLBACK_UOW_OPERATION_COUNTS_REJECTED');
}

async function run() {
  check(bundle && bundle.commit === sealedCommit
      && ['ReadOnly', 'Rollback'].includes(bundle.mode),
  'INVALID_SEALED_BUNDLE');
  const manifest = bundle.commit + '\n' + Object.keys(bundle.sources).sort()
    .map(key => `${key}:${hash(bundle.sources[key])}`).join('\n');
  check(hash(manifest) === bundle.manifestSha256, 'SOURCE_MANIFEST_MISMATCH');
  staticClosureCheck();

  load('config/load-env.js').loadEnv(process.cwd());
  check(trim(process.env.APP_ENV).toLowerCase() === 'demo', 'DEMO_PROFILE_REQUIRED');
  const profile = load('config/app-profile.js').applyAppProfile(process.env);
  check(profile.verified === true && profile.profile === 'demo'
      && profile.tableSet === 'isolated_test'
      && profile.erpExportEnabled === false
      && profile.productionWritesEnabled === false,
  'VERIFIED_ISOLATED_DEMO_REQUIRED');
  evidence.profile = {
    profile: profile.profile,
    tableSet: profile.tableSet,
    verified: profile.verified,
    erpExportEnabled: profile.erpExportEnabled,
    productionWritesEnabled: profile.productionWritesEnabled,
  };

  const runtime = load('config/reparto-runtime.js').resolveRepartoRuntime(process.env);
  check(runtime.valid && runtime.tableSet === 'isolated_test',
    'ISOLATED_RUNTIME_REQUIRED');
  const schemas = load('utils/db2-schemas.js');
  check(schemas.db2AppTable('COBROS') === 'JAVIER.TEST_COBROS'
      && schemas.db2AppTable('LIQUIDACION_COMERCIAL') === 'JAVIER.TEST_LIQUIDACION_COMERCIAL'
      && schemas.db2AppTable('REPARTIDOR_COBROS') === 'JAVIER.TEST_REPARTIDOR_COBROS',
  'EXACT_TEST_TABLES_REQUIRED');

  const finance = load('services/comercial-devoluciones-service.js');
  finance.assertIsolatedTestWrites();
  const { Db2CobrosRepository } = load(
    'src/modules/cobros/infrastructure/db2-cobros-repository.js',
  );
  const repository = new Db2CobrosRepository({
    transactionConnectionFactory: async () => {
      check(writerFacade, 'WRITER_FACADE_UNAVAILABLE');
      return writerFacade;
    },
  });

  odbc = require('odbc');
  connectionString = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
  evidence.phase = 'READONLY_PREFLIGHT';
  await openReadSession();
  const catalog = {};
  for (const table of targetTables) catalog[table] = await verifyTableCatalog(table);
  businessDate = await currentBusinessDate();
  evidence.businessDate = businessDate;
  candidates = bindCandidateOperations(await discoverCandidates(repository));
  const beforeRows = await boundedSnapshot();
  const before = snapshotDigest(beforeRows);
  evidence.before = before;
  check(before.cobros.ownedCount === 0 && before.liquidacion.ownedCount === 0,
    'OWNED_ROWS_ALREADY_EXIST');
  check(beforeRows.cobros.length === 0, 'CURRENT_PERIOD_COMMERCIAL_COLLECTIONS_EXIST');
  check(beforeRows.liquidacion.length === 0, 'CURRENT_PERIOD_SETTLEMENT_EXISTS');
  const preSummary = await finance.getDailySummary(
    { vendorCodes: ['35'], date: businessDate },
    { queryWithParams: execute },
  );
  check(Number(preSummary.cobros?.count || 0) === 0,
    'CURRENT_PERIOD_SUMMARY_NOT_EMPTY');
  check((preSummary.lqd?.latestRows || []).every(row => (
    cents(row.gastos) === 0 && cents(row.efectivo2) === 0 && cents(row.entregado2) === 0
  )), 'ERP_LQD_AUXILIARY_VALUES_UNSUPPORTED');
  evidence.catalog = catalog;
  evidence.lastLqdRows = preSummary.lqd?.latestRows?.length || 0;

  if (bundle.mode === 'ReadOnly') {
    await closeReadSession();
    evidence.phase = 'READONLY_DONE';
    return;
  }
  await executeRollbackAcceptance(repository, finance, before);
  evidence.phase = 'ROLLBACK_DONE';
}

(async () => {
  watchdog = setTimeout(async () => {
    evidence.success = false;
    evidence.error = { code: 'FINANCE_ACCEPTANCE_WATCHDOG_TIMEOUT' };
    try { await rollbackAndCloseWriter(); } catch { /* process exit releases the lease */ }
    try { await closeReadSession(); } catch { /* process exit releases the lease */ }
    evidence.allConnectionsClosed = !readConnectionOpen && !writerConnectionOpen;
    process.stdout.write(`FINANCE_ACCEPTANCE=${encode(evidence)}\n`);
    process.exit(1);
  }, 210000);
  let failure;
  try {
    await run();
  } catch (error) {
    failure = diagnostic(error);
  } finally {
    try { await closeReadSession(); } catch (error) { failure ||= diagnostic(error); }
    try { await rollbackAndCloseWriter(); } catch (error) { failure ||= diagnostic(error); }
    clearTimeout(watchdog);
  }
  evidence.allConnectionsClosed = !activeReadConnection && !writerConnection
    && !readConnectionOpen && !writerConnectionOpen;
  evidence.success = !failure && evidence.allConnectionsClosed
    && evidence.physicalCommit === 0;
  if (failure) evidence.error = failure;
  if (!evidence.success) process.exitCode = 1;
  process.stdout.write(`FINANCE_ACCEPTANCE=${encode(evidence)}\n`);
})().catch(() => {
  process.stdout.write('FINANCE_ACCEPTANCE={"success":false,"error":{"code":"UNEXPECTED_FINANCE_ACCEPTANCE_FAILURE"}}\n');
  process.exitCode = 1;
});
