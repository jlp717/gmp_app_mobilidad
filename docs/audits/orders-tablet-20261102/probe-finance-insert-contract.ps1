[CmdletBinding()]
param([ValidateSet('DryRun', 'ReadOnly')][string]$Mode = 'DryRun')

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$commit = '4a099e89f29378a502598e4698e0c651cccd46d2'
$fingerprint = '8b29b38741087910608fdfc71f28527a9b240ab7fd7ef9fc0180143d03c73a69'
$paths = @(
  'src/modules/cobros/infrastructure/db2-cobros-repository.js',
  'src/modules/cobros/domain/cobros-repository.js',
  'src/modules/cobros/domain/commercial-payment-contract.js',
  'src/core/domain/repository.js', 'utils/db2-identifiers.js', 'utils/db2-schemas.js',
  'utils/common.js', 'utils/db2-app-buffer-capability.js', 'utils/comercial-erp-tables.js',
  'utils/erp-document-label.js', 'config/reparto-runtime.js', 'config/g4-dsedac-erp-mapping.js',
  'config/load-env.js', 'config/app-profile.js', 'services/debt-view-contract.js',
  'services/comercial-devoluciones-service.js', 'services/dsedac-exports.service.js',
  'adapters/pedidos-local-order-state-guard.js'
)

$sources = [ordered]@{}
foreach ($path in $paths) {
  $sources[$path] = (& git -C $root show ($commit + ':backend/' + $path)) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw ('SEALED_SOURCE_UNAVAILABLE: ' + $path) }
}

$runtime = @'
'use strict';
const bundle = global.__FINANCE_INSERT_CONTRACT_BUNDLE__;
const crypto = require('crypto');
const Module = require('module');
const path = require('path').posix;
const encode = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const trim = value => String(value ?? '').trim();
const cents = value => Math.round(Number(value) * 100);
function check(condition, code) { if (!condition) throw Object.assign(new Error(code), {code}); }
function diagnostic(error) {
  return {
    code: /^[A-Z][A-Z0-9_]{2,80}$/.test(error?.code || '') ? error.code : 'FINANCE_INSERT_CONTRACT_FAILED',
    odbc: (error?.odbcErrors || []).map(item => ({
      state: /^[A-Z0-9]{5}$/.test(item.state || '') ? item.state : null,
      code: Number(item.code) || null,
    })),
  };
}

const sealedCommit = '4a099e89f29378a502598e4698e0c651cccd46d2';
const expectedFingerprint = '8b29b38741087910608fdfc71f28527a9b240ab7fd7ef9fc0180143d03c73a69';
const allowedNative = new Set(['crypto', 'fs', 'path', 'cluster', 'dotenv']);
const stubs = {};
const modules = new Map();
let connection;
let queryCount = 0;
let reads = Promise.resolve();

function resolved(from, request) {
  const key = path.normalize(path.join(path.dirname(from), request));
  check(!key.startsWith('../') && !path.isAbsolute(key), 'SOURCE_PATH_ESCAPE');
  return key.endsWith('.js') ? key : `${key}.js`;
}

function load(key) {
  if (Object.hasOwn(stubs, key)) return stubs[key];
  if (modules.has(key)) return modules.get(key).exports;
  check(Object.hasOwn(bundle.sources, key), 'UNSEALED_DEPENDENCY');
  const mod = new Module(`/sealed-finance/${key}`, module);
  mod.filename = `/sealed-finance/${key}`;
  modules.set(key, mod);
  mod.require = request => {
    if (allowedNative.has(request)) return require(request);
    check(request.startsWith('.'), 'EXTERNAL_DEPENDENCY_REJECTED');
    return load(resolved(key, request));
  };
  mod._compile(bundle.sources[key], mod.filename);
  return mod.exports;
}

function normalizeSql(sql) {
  return String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
}

async function withRead(sql, params = []) {
  const normalized = normalizeSql(sql);
  check(/^(SELECT|WITH)\s/i.test(normalized) && Array.isArray(params), 'READONLY_SQL_REQUIRED');
  check(!/;|\b(INSERT|UPDATE|DELETE|MERGE|LOCK|SET|CALL|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(normalized), 'READONLY_SQL_MUTATION_REJECTED');
  check(queryCount < 60, 'READONLY_QUERY_BUDGET_EXHAUSTED');
  queryCount += 1;
  const result = reads.then(() => connection.query(sql, params, {timeout: 12}));
  reads = result.catch(() => {});
  return result;
}

function buildCaptureFacade(state) {
  const expectedColumns = [
    'ID', 'CODIGO_CLIENTE', 'REFERENCIA', 'IMPORTE', 'FORMA_PAGO',
    'TIPO_VENTA', 'TIPO_MODO', 'TIPO_USUARIO', 'CODIGO_USUARIO',
    'OBSERVACIONES', 'IDEMPOTENCY_TOKEN', 'SUBEMPRESARECIBO',
    'EJERCICIORECIBO', 'SERIERECIBO', 'TERMINALRECIBO', 'NUMERORECIBO',
    'CODIGOCLIENTEFACTURA', 'CODIGOVENDEDOR', 'TIPORECIBO',
    'DIADOCUMENTO', 'MESDOCUMENTO', 'ANODOCUMENTO', 'HORADOCUMENTO',
    'IMPORTECOBRADO', 'IDMARCALIQUIDACION',
  ];

  return {
    async query(sql, params = []) {
      const text = normalizeSql(sql);
      check(Array.isArray(params) && !text.includes(';'), 'FACADE_SQL_SHAPE_REJECTED');
      if (/^(SELECT|WITH)\b/i.test(text)) {
        check(!/\b(INSERT|UPDATE|DELETE|MERGE|LOCK|SET|CALL|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(text), 'FACADE_READ_MUTATOR_REJECTED');
        return withRead(sql, params);
      }
      if (/^SET TRANSACTION ISOLATION LEVEL READ COMMITTED$/i.test(text)) {
        state.virtualSet += 1;
        return [];
      }
      if (/^LOCK TABLE JAVIER\.TEST_(REPARTIDOR_COBROS|COBROS) IN EXCLUSIVE MODE$/i.test(text)) {
        state.virtualLocks += 1;
        return [];
      }

      const insert = /^INSERT INTO JAVIER\.TEST_COBROS \(([^)]+)\) VALUES \(([^)]+)\)$/i.exec(text);
      check(insert && insert[2].split(',').every(value => trim(value) === '?'), 'FACADE_DML_TARGET_REJECTED');
      state.insertAttempts += 1;
      check(state.insertAttempts === 1, 'MULTIPLE_INSERT_ATTEMPTS_REJECTED');
      const columns = insert[1].split(',').map(value => trim(value).toUpperCase());
      check(columns.length === params.length, 'PAYMENT_INSERT_BIND_COUNT_REJECTED');
      const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
      const [year, month, day] = state.businessDate.split('-').map(Number);
      state.comparisons = {
        columnsMatch: JSON.stringify(columns) === JSON.stringify(expectedColumns),
        idMatches: row.ID === `CBR-${hash(state.paymentToken).slice(0, 32)}`,
        tokenMatches: row.IDEMPOTENCY_TOKEN === state.paymentToken,
        clientMatches: trim(row.CODIGO_CLIENTE) === state.clientCode,
        referenceMatches: trim(row.REFERENCIA) === state.reference,
        amountMatches: cents(row.IMPORTE) === state.amountCents && cents(row.IMPORTECOBRADO) === state.amountCents,
        methodMatches: trim(row.FORMA_PAGO) === 'CONTADO',
        vendorMatches: trim(row.CODIGOVENDEDOR) === '35',
        userMatches: trim(row.CODIGO_USUARIO) === '35',
        roleMatches: trim(row.TIPO_USUARIO) === 'COMERCIAL',
        saleTypeMatches: trim(row.TIPO_VENTA) === 'CC',
        modeMatches: row.TIPO_MODO == null,
        observationsMatch: row.OBSERVACIONES === state.observations,
        dateMatches: Number(row.ANODOCUMENTO) === year && Number(row.MESDOCUMENTO) === month && Number(row.DIADOCUMENTO) === day,
      };
      check(Object.values(state.comparisons).every(Boolean), 'PAYMENT_INSERT_FINGERPRINT_REJECTED');
      throw Object.assign(new Error('FINANCE_INSERT_CAPTURED'), {code: 'FINANCE_INSERT_CAPTURED'});
    },
    async beginTransaction() { state.virtualBegin += 1; },
    async commit() { state.virtualCommit += 1; throw Object.assign(new Error('VIRTUAL_COMMIT_REJECTED'), {code: 'VIRTUAL_COMMIT_REJECTED'}); },
    async rollback() { state.virtualRollback += 1; },
    async close() { state.virtualClose += 1; },
  };
}

(async () => {
  const evidence = {
    job: 'FINANCE_INSERT_CONTRACT_OBSERVER', mode: bundle?.mode,
    sourceCommit: bundle?.commit, connected: false, closed: false,
    physicalDml: 0, physicalTransactions: 0, physicalCommits: 0,
  };
  try {
    check(bundle?.mode === 'ReadOnly' && bundle.commit === sealedCommit, 'READONLY_SEALED_BUNDLE_REQUIRED');
    const manifest = bundle.commit + '\n' + Object.keys(bundle.sources).sort().map(key => `${key}:${hash(bundle.sources[key])}`).join('\n');
    check(hash(manifest) === bundle.manifestSha256, 'SOURCE_MANIFEST_MISMATCH');
    check(bundle.candidateFingerprint === expectedFingerprint, 'CANDIDATE_FINGERPRINT_BINDING_REQUIRED');
    check(!trim(process.env.APP_ENV) || trim(process.env.APP_ENV).toLowerCase() === 'demo', 'DEMO_PROFILE_REQUIRED');
    process.env.APP_ENV = 'demo';
    load('config/load-env.js').loadEnv(process.cwd());
    const profile = load('config/app-profile.js').applyAppProfile(process.env);
    check(profile.verified && profile.profile === 'demo' && profile.tableSet === 'isolated_test' && !profile.erpExportEnabled && !profile.productionWritesEnabled, 'ISOLATED_DEMO_PROFILE_REQUIRED');

    const odbc = require('odbc');
    const connectionString = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
    stubs['config/db.js'] = {query: withRead, queryWithParams: withRead};
    stubs['middleware/logger.js'] = {info() {}, warn() {}, error() {}, debug() {}};
    stubs['services/laclae.js'] = {getClientCodesFromCache() { throw Object.assign(new Error('UNUSED_DEPENDENCY_CALLED'), {code: 'UNUSED_DEPENDENCY_CALLED'}); }};
    stubs['services/comercial-devolucion-pdf-service.js'] = {};
    stubs['src/repositories/bSales.repository.js'] = {bSalesRepository: {}};
    stubs['optional/dsedac-exports.impl.js'] = {};
    stubs['adapters/pedidos-transaction-connection.js'] = {openDedicatedPedidosTransactionConnection() { throw Object.assign(new Error('NATIVE_TRANSACTION_REJECTED'), {code: 'NATIVE_TRANSACTION_REJECTED'}); }};

    connection = await odbc.connect({connectionString, connectionTimeout: 10, loginTimeout: 10});
    evidence.connected = true;
    const {Db2CobrosRepository} = load('src/modules/cobros/infrastructure/db2-cobros-repository.js');
    let captureFacade;
    const state = {
      insertAttempts: 0, virtualSet: 0, virtualLocks: 0, virtualBegin: 0,
      virtualCommit: 0, virtualRollback: 0, virtualClose: 0, comparisons: null,
    };
    const repository = new Db2CobrosRepository({transactionConnectionFactory: async () => captureFacade});
    const dateRows = await withRead("SELECT VARCHAR_FORMAT(CURRENT DATE, 'YYYY-MM-DD') AS TODAY FROM SYSIBM.SYSDUMMY1");
    const businessDate = trim(dateRows[0]?.TODAY);
    const clients = await withRead("SELECT DISTINCT TRIM(CODIGOCLIENTEALBARAN) AS CLIENT_CODE FROM DSEDAC.CVC WHERE CODIGOVENDEDOR=CAST(? AS CHAR(2)) AND IMPORTEPENDIENTE>0 AND (ANULADOSN IS NULL OR ANULADOSN<>'S') AND TIPODOCUMENTO=CAST(? AS CHAR(3)) AND ORIGENDOCUMENTO=CAST(? AS CHAR(1)) ORDER BY CLIENT_CODE FETCH FIRST 6 ROWS ONLY", ['35', 'COB', 'F']);
    let selected = null;
    for (const candidate of clients) {
      const clientCode = trim(candidate.CLIENT_CODE);
      const pending = await repository.getPendientes(clientCode, {userId: '35', userRole: 'COMERCIAL', vendorCodes: ['35'], limit: 20});
      const eligible = (pending.cobros || []).filter(doc => doc.docKey?.source === 'CVC' && doc.cobrable === true && doc.responsabilidad === 'COMERCIAL' && doc.documentoNoDisponible !== true && cents(doc.importePendiente) > 0).slice(0, 2);
      for (const document of eligible) {
        const order = await repository.findOrderForPayment(clientCode, document.id, withRead);
        if (!order || trim(order.SOURCE) !== 'CVC' || trim(order.CODIGOVENDEDOR) !== '35' || cents(order.IMPORTETOTAL) !== cents(document.importePendiente) || Number(order.IMPORTE_DOCUMENTO) < Number(document.importePendiente)) continue;
        if (await repository.resolveOrderSaleType(order, withRead) !== 'CC') continue;
        const candidateFingerprint = hash(`${clientCode}|${document.id}|${cents(document.importePendiente)}|${businessDate}`);
        if (candidateFingerprint === expectedFingerprint) selected = {clientCode, reference: document.id, amountCents: cents(document.importePendiente), fingerprint: candidateFingerprint};
        if (selected) break;
      }
      if (selected) break;
    }
    check(selected, 'VERIFIED_CANDIDATE_CHANGED');

    Object.assign(state, selected, {
      businessDate,
      paymentToken: `fin-contract-${hash(`${selected.fingerprint}|CONTADO`).slice(0, 24)}`,
      observations: 'Diagnostico TEST sin escritura fisica',
    });
    captureFacade = buildCaptureFacade(state);
    let captureError = null;
    try {
      await repository.registerPayment({
        clientCode: state.clientCode,
        reference: state.reference,
        amount: state.amountCents / 100,
        paymentMethod: 'CONTADO',
        idempotencyToken: state.paymentToken,
        userId: '35',
        userRole: 'COMERCIAL',
        vendorCodes: ['35'],
        observations: state.observations,
      });
    } catch (error) {
      captureError = error;
    }
    evidence.candidateFingerprint = selected.fingerprint;
    evidence.businessDate = businessDate;
    evidence.candidateClientCount = clients.length;
    evidence.insertAttempts = state.insertAttempts;
    evidence.comparisons = state.comparisons;
    evidence.captureDiagnostic = diagnostic(captureError);
    evidence.virtual = {
      begin: state.virtualBegin, set: state.virtualSet, locks: state.virtualLocks,
      rollback: state.virtualRollback, close: state.virtualClose, commit: state.virtualCommit,
    };
    check(captureError?.code === 'FINANCE_INSERT_CAPTURED', 'INSERT_CAPTURE_NOT_REACHED');
    check(state.insertAttempts === 1 && state.virtualCommit === 0, 'INSERT_CAPTURE_LIFECYCLE_INVALID');
    check(state.virtualBegin === 1 && state.virtualRollback === 1 && state.virtualClose === 1, 'VIRTUAL_TRANSACTION_LIFECYCLE_INVALID');
    evidence.success = true;
  } catch (error) {
    evidence.success = false;
    evidence.error = diagnostic(error);
    process.exitCode = 1;
  } finally {
    await reads;
    if (connection) {
      try { await connection.close(); evidence.closed = true; }
      catch (error) { evidence.success = false; evidence.closeError = diagnostic(error); process.exitCode = 1; }
    }
    evidence.queryCount = queryCount;
    process.stdout.write(`FINANCE_INSERT_CONTRACT=${encode(evidence)}\n`);
  }
})().catch(error => {
  process.stdout.write(`FINANCE_INSERT_CONTRACT=${encode({success: false, error: diagnostic(error), physicalDml: 0})}\n`);
  process.exitCode = 1;
});
'@

$hasher = [Security.Cryptography.SHA256]::Create()
try {
  [string[]]$keys = $sources.Keys
  [Array]::Sort($keys, [StringComparer]::Ordinal)
  $lines = foreach ($key in $keys) {
    $sourceHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($sources[$key]))).Replace('-', '').ToLowerInvariant()
    $key + ':' + $sourceHash
  }
  $manifest = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($commit + "`n" + ($lines -join "`n")))).Replace('-', '').ToLowerInvariant()
  $runtimeHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($runtime))).Replace('-', '').ToLowerInvariant()
} finally {
  $hasher.Dispose()
}

$wrapperHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Mode -eq 'DryRun') {
  [ordered]@{
    mode = 'DryRun'
    connected = $false
    sourceCommit = $commit
    sourceCount = $sources.Count
    manifestSha256 = $manifest
    runtimeSha256 = $runtimeHash
    wrapperSha256 = $wrapperHash
    candidateFingerprint = $fingerprint
    profile = 'demo/isolated_test'
    physicalDml = 0
    physicalTransactions = 0
    runEnabled = $false
  } | ConvertTo-Json -Depth 4
  exit 0
}

$bundle = [ordered]@{
  commit = $commit
  mode = 'ReadOnly'
  sources = $sources
  manifestSha256 = $manifest
  candidateFingerprint = $fingerprint
}
$bundle64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($bundle | ConvertTo-Json -Depth 6 -Compress)))
$runtime64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runtime))
$job = "global.__FINANCE_INSERT_CONTRACT_BUNDLE__=JSON.parse(Buffer.from('$bundle64','base64').toString('utf8'));`nrequire('vm').runInThisContext(Buffer.from('$runtime64','base64').toString('utf8'),{filename:'finance-insert-contract.js'});"
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && timeout 100s node -'
exit $LASTEXITCODE
