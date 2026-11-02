[CmdletBinding()]
param([switch]$Run)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sourceCommit = '9008cdf'
$paths = @(& git -C $taskRoot ls-tree -r --name-only $sourceCommit -- backend/services/pedidos)
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the reviewed source commit.' }
$paths = @($paths | Where-Object { $_ -match '^backend/services/pedidos/[A-Za-z0-9_.-]+\.js$' })
$paths += 'backend/services/bolsa-comercial.service.js'
$paths += 'backend/adapters/pedidos-transaction-connection.js'
$bundle = @{}
foreach ($taskPath in $paths) {
    $taskSource = (& git -C $taskRoot show "${sourceCommit}:$taskPath") -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot load a reviewed source file.' }
    $bundle[$taskPath.Substring(8)] = $taskSource
}
if (-not $Run) {
    [ordered]@{ mode = 'DRY_RUN'; connected = $false; sourceCommit = $sourceCommit; sourceFiles = $bundle.Count; writes = 'JAVIER.TEST_* owned fixtures only'; confirmsOrders = $false } | ConvertTo-Json
    exit 0
}
$bundle64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($bundle | ConvertTo-Json -Depth 5 -Compress)))
$nodeSource = @'
'use strict';
require('./config/load-env').loadEnv(process.cwd());
const odbc = require('odbc'), Module = require('module'), path = require('path'), crypto = require('crypto');
const bundle = JSON.parse(Buffer.from('SOURCE_BUNDLE', 'base64').toString('utf8'));
const root = process.cwd(), cs = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
const ownedIds = new Set(), targets = new Set(), connections = [];
const allowedTargets = new Set(['TEST_PEDIDOS_CAB', 'TEST_PEDIDOS_LIN', 'TEST_PEDIDOS_STOCK_RESERVE', 'TEST_PEDIDO_IDEMPOTENCY', 'TEST_PEDIDOS_SEQ'].map((x) => 'JAVIER.' + x));
const marker = 'QAcreate20261102' + crypto.randomBytes(4).toString('hex');
const key = 'QA' + crypto.randomBytes(11).toString('hex'), concurrentKey = 'QA' + crypto.randomBytes(11).toString('hex');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function guard(sql) {
  for (const match of sql.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|LOCK\s+TABLE)\s+([A-Z0-9_".]+)/gi)) {
    const target = match[1].replace(/"/g, '').toUpperCase();
    if (!allowedTargets.has(target)) fail('UNEXPECTED_WRITE_TARGET_REJECTED');
    targets.add(target);
  }
  if (/\b(CREATE|ALTER|DROP|CALL|TRUNCATE)\b/i.test(sql)) fail('NON_DML_OPERATION_REJECTED');
}
(async () => {
  if (String(process.env.REPARTO_TABLE_SET).trim() !== 'isolated_test') fail('ISOLATED_TEST_REQUIRED');
  const observer = await odbc.connect(cs), pool = await odbc.pool({ connectionString: cs, initialSize: 1, maxSize: 3 });
  let serial = Promise.resolve();
  const read = (sql, params = []) => {
    if (!/^\s*(SELECT|WITH)\b/i.test(sql) || /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|CALL)\b/i.test(sql)) fail('WRITE_OUTSIDE_TRANSACTION_REJECTED');
    const p = serial.then(() => observer.query(sql, params)); serial = p.catch(() => {}); return p;
  };
  const fakeDb = { queryWithParams: read, query: (sql) => read(sql), getPool: () => pool, initDb: () => Promise.resolve() };
  const dbPath = require.resolve('./config/db'), dbModule = new Module(dbPath, module); dbModule.filename = dbPath; dbModule.exports = fakeDb; require.cache[dbPath] = dbModule;
  function makeService(label, injectAfterIdempotency = false) {
    const cache = new Map();
    const driver = { ...odbc, connect: async (config) => {
      const c = await odbc.connect(config), query = c.query.bind(c); connections.push(label);
      c.query = async (sql, params) => {
        guard(sql); const rows = params === undefined ? await query(sql) : await query(sql, params);
        if (/SELECT\s+ID\s+FROM\s+JAVIER\.TEST_PEDIDOS_CAB\s+WHERE\s+EJERCICIO/i.test(sql)) for (const r of rows) ownedIds.add(Number(r.ID));
        if (injectAfterIdempotency && /INSERT\s+INTO\s+JAVIER\.TEST_PEDIDO_IDEMPOTENCY/i.test(sql)) fail('QA_FAULT_AFTER_IDEMPOTENCY');
        return rows;
      };
      return c;
    } };
    function load(relative) {
      if (cache.has(relative)) return cache.get(relative).exports;
      const filename = path.join(root, relative), m = new Module(filename, module); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename)); cache.set(relative, m);
      const native = Module.createRequire(filename);
      m.require = (request) => {
        if (request === 'odbc') return driver;
        const resolved = request.startsWith('.') ? path.relative(root, path.resolve(path.dirname(filename), request)).replace(/\\/g, '/') : request;
        if (['config/db', 'config/db.js'].includes(resolved)) return fakeDb;
        for (const candidate of [resolved, resolved + '.js', resolved + '/index.js']) if (Object.hasOwn(bundle, candidate)) return load(candidate);
        return native(request);
      };
      let source = bundle[relative];
      if (relative === 'services/pedidos/index.js') {
        const hook = 'purgeExpiredDraftReservations({ limit: 25 }).catch';
        if (source.split(hook).length !== 2) fail('MAINTENANCE_HOOK_NOT_UNIQUE');
        source = source.replace(hook, 'Promise.resolve({ purged: 0 }).catch');
      }
      m._compile(source, filename); return m.exports;
    }
    return load('services/pedidos/index.js');
  }
  async function snapshot(requestKey, requestMarker) {
    const header = await read('SELECT ID,NUMEROPEDIDO,ESTADO,CODIGOCLIENTE,CODIGOVENDEDOR,IMPORTETOTAL,CREATED_AT FROM JAVIER.TEST_PEDIDOS_CAB WHERE OBSERVACIONES=? ORDER BY ID', [requestMarker]);
    for (const r of header) ownedIds.add(Number(r.ID));
    const ids = [...ownedIds]; const marks = ids.map(() => '?').join(',');
    const lines = ids.length ? await read(`SELECT ID,PEDIDO_ID,CODIGOARTICULO,CANTIDADENVASES,CANTIDADUNIDADES,PRECIOVENTA,IMPORTEVENTA FROM JAVIER.TEST_PEDIDOS_LIN WHERE PEDIDO_ID IN (${marks}) ORDER BY PEDIDO_ID,ID`, ids) : [];
    const reserve = ids.length ? await read(`SELECT PEDIDO_ID,CODIGOARTICULO,CANTIDADENVASES,CANTIDADUNIDADES FROM JAVIER.TEST_PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID IN (${marks}) ORDER BY PEDIDO_ID,CODIGOARTICULO`, ids) : [];
    const idem = await read('SELECT IDEMPOTENCY_KEY,PEDIDO_ID,PAYLOAD_HASH FROM JAVIER.TEST_PEDIDO_IDEMPOTENCY WHERE IDEMPOTENCY_KEY=?', [requestKey]);
    const sequence = await read('SELECT * FROM JAVIER.TEST_PEDIDOS_SEQ WHERE EJERCICIO=?', [new Date().getFullYear()]);
    return { header, lines, reserve, idem, sequence };
  }
  let fixtureOwnershipVerified = false;
  const sequenceValue = (snapshot) => {
    if (snapshot.sequence.length !== 1 || !Number.isInteger(Number(snapshot.sequence[0].ULTIMO_NUMERO))) fail('SEQUENCE_NOT_UNAMBIGUOUS');
    return Number(snapshot.sequence[0].ULTIMO_NUMERO);
  };
  let evidence = { sourceCommit: '9008cdf', scope: 'transactional CREATE only; bundled pedidos/bolsa/adapter modules fixed to source commit, other dependencies from installed backend; real source order106/line121; auth/UI/confirm excluded; lazy purge disabled in memory to protect other fixtures', marker, keys: [key, concurrentKey] };
  try {
    const reference = await read('SELECT * FROM JAVIER.TEST_PEDIDOS_LIN WHERE ID=? AND PEDIDO_ID=?', [121, 106]);
    if (reference.length !== 1 || String(reference[0].CODIGOARTICULO).trim() !== '3519') fail('REAL_REFERENCE_LINE_NOT_FOUND');
    const r = reference[0];
    const payload = { clientCode: '4300032160', vendedorCode: '35', userId: '35', userRole: 'COMERCIAL', tipoventa: 'CC', observaciones: marker, idempotencyKey: key, lines: [{ codigoArticulo: '3519', descripcion: String(r.DESCRIPCION || r.DESCRIPCIONARTICULO || '').trim(), cantidadEnvases: 1, cantidadUnidades: 1, unidadesCaja: Number(r.UNIDADESCAJA) || 1, unidadMedida: 'CAJAS', precio: Number(r.PRECIOVENTA), precioCosto: Number(r.PRECIOCOSTO) }] };
    evidence.before = await snapshot(key, marker);
    evidence.beforeConcurrent = await snapshot(concurrentKey, marker + 'C');
    if (evidence.before.header.length || evidence.before.idem.length || evidence.beforeConcurrent.header.length || evidence.beforeConcurrent.idem.length) fail('FIXTURE_COLLISION');
    sequenceValue(evidence.before);
    fixtureOwnershipVerified = true;
    let faultCode = null;
    try { await makeService('fault', true).createOrder(payload); } catch (e) { faultCode = e.code || 'UNKNOWN'; }
    evidence.faultCode = faultCode; evidence.afterFault = await snapshot(key, marker);
    evidence.rollbackPassed = faultCode === 'IDEMPOTENCY_UNAVAILABLE' && !evidence.afterFault.header.length && !evidence.afterFault.lines.length && !evidence.afterFault.reserve.length && !evidence.afterFault.idem.length && JSON.stringify(evidence.before.sequence) === JSON.stringify(evidence.afterFault.sequence);
    if (!evidence.rollbackPassed) fail('CREATE_ROLLBACK_NOT_CONFIRMED');
    const service = makeService('success'); let t = Date.now();
    const created = await service.createOrder(payload); evidence.createElapsedMs = Date.now() - t;
    evidence.createdId = Number(created.header?.id ?? created.header?.ID ?? created.id);
    evidence.afterCreate = await snapshot(key, marker);
    if (!evidence.createdId || evidence.afterCreate.header.length !== 1 || evidence.afterCreate.idem.length !== 1 || evidence.afterCreate.lines.length !== 1 || evidence.afterCreate.reserve.length !== 1 || evidence.createdId !== Number(evidence.afterCreate.header[0].ID) || evidence.createdId !== Number(evidence.afterCreate.idem[0].PEDIDO_ID)) fail('CREATE_ROWS_NOT_CONFIRMED');
    evidence.createSequencePassed = sequenceValue(evidence.afterCreate) === sequenceValue(evidence.before) + 1 && Number(evidence.afterCreate.header[0].NUMEROPEDIDO) === sequenceValue(evidence.afterCreate);
    if (!evidence.createSequencePassed) fail('CREATE_SEQUENCE_NOT_SINGLE_INCREMENT');
    t = Date.now(); const replay = await service.createOrder(payload); evidence.replayElapsedMs = Date.now() - t;
    evidence.afterReplay = await snapshot(key, marker);
    evidence.replayPassed = replay.idempotent === true && Number(replay.header?.id ?? replay.header?.ID ?? replay.id) === evidence.createdId && JSON.stringify(evidence.afterCreate) === JSON.stringify(evidence.afterReplay);
    if (!evidence.replayPassed) fail('CREATE_REPLAY_NOT_CONFIRMED');
    const concurrentPayload = { ...payload, idempotencyKey: concurrentKey, observaciones: marker + 'C' };
    t = Date.now(); const both = await Promise.all([makeService('workerA').createOrder(concurrentPayload), makeService('workerB').createOrder(concurrentPayload)]); evidence.concurrentElapsedMs = Date.now() - t;
    evidence.concurrentResults = both.map((o) => ({ id: Number(o.header?.id ?? o.header?.ID ?? o.id), idempotent: o.idempotent === true }));
    evidence.afterConcurrent = await snapshot(concurrentKey, marker + 'C');
    evidence.concurrentPassed = evidence.concurrentResults[0].id === evidence.concurrentResults[1].id && evidence.afterConcurrent.header.length === 1 && evidence.afterConcurrent.idem.length === 1 && evidence.afterConcurrent.lines.length === 2 && evidence.afterConcurrent.reserve.length === 2 && evidence.concurrentResults[0].id === Number(evidence.afterConcurrent.header[0].ID) && evidence.concurrentResults[0].id === Number(evidence.afterConcurrent.idem[0].PEDIDO_ID) && evidence.concurrentResults.filter((o) => o.idempotent).length === 1;
    evidence.concurrentSequencePassed = sequenceValue(evidence.afterConcurrent) === sequenceValue(evidence.afterReplay) + 1 && Number(evidence.afterConcurrent.header[0].NUMEROPEDIDO) === sequenceValue(evidence.afterConcurrent);
    if (!evidence.concurrentSequencePassed) fail('CONCURRENT_SEQUENCE_NOT_SINGLE_INCREMENT');
    if (!evidence.concurrentPassed) fail('INDEPENDENT_CREATE_CONCURRENCY_FAILED');
    evidence.passed = true;
  } catch (e) {
    evidence.passed = false; evidence.error = { code: e.code || 'CREATE_PROBE_FAILED', odbc: (e.odbcErrors || []).map((x) => ({ state: x.state, code: x.code })) }; process.exitCode = 1;
  } finally {
    const cleanup = await odbc.connect(cs);
    try {
      await cleanup.beginTransaction(); await cleanup.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await cleanup.query('LOCK TABLE JAVIER.TEST_PEDIDOS_STOCK_RESERVE IN EXCLUSIVE MODE'); await cleanup.query('LOCK TABLE JAVIER.TEST_PEDIDOS_CAB IN EXCLUSIVE MODE');
      const rows = await cleanup.query('SELECT ID,CODIGOCLIENTE,CODIGOVENDEDOR FROM JAVIER.TEST_PEDIDOS_CAB WHERE OBSERVACIONES IN (?,?)', [marker, marker + 'C']);
      if (rows.some((x) => String(x.CODIGOCLIENTE).trim() !== '4300032160' || String(x.CODIGOVENDEDOR).trim() !== '35')) fail('CLEANUP_OWNERSHIP_MISMATCH');
      if (!fixtureOwnershipVerified) fail('CLEANUP_OWNERSHIP_NOT_ESTABLISHED');
      const ids = [...new Set([...ownedIds, ...rows.map((x) => Number(x.ID))])];
      const existingIds = ids.length ? await cleanup.query(`SELECT ID,OBSERVACIONES,CODIGOCLIENTE,CODIGOVENDEDOR FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID IN (${ids.map(() => '?').join(',')})`, ids) : [];
      if (existingIds.some((x) => ![marker, marker + 'C'].includes(String(x.OBSERVACIONES).trim()) || String(x.CODIGOCLIENTE).trim() !== '4300032160' || String(x.CODIGOVENDEDOR).trim() !== '35')) fail('CLEANUP_ID_OWNERSHIP_MISMATCH');
      await cleanup.query('DELETE FROM JAVIER.TEST_PEDIDO_IDEMPOTENCY WHERE IDEMPOTENCY_KEY IN (?,?)', [key, concurrentKey]);
      if (ids.length) {
        const marks = ids.map(() => '?').join(',');
        for (const table of ['TEST_PEDIDOS_STOCK_RESERVE', 'TEST_PEDIDOS_LIN']) await cleanup.query(`DELETE FROM JAVIER.${table} WHERE PEDIDO_ID IN (${marks})`, ids);
        await cleanup.query(`DELETE FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID IN (${marks}) AND OBSERVACIONES IN (?,?)`, [...ids, marker, marker + 'C']);
      }
      await cleanup.commit(); evidence.cleanup = { removedIds: ids, identitiesRewound: false, sequenceRewound: false };
    } catch (e) { await cleanup.rollback(); evidence.cleanup = { code: e.code || 'SCOPED_CLEANUP_FAILED' }; process.exitCode = 1; } finally { await cleanup.close(); }
    evidence.afterCleanup = await snapshot(key, marker); evidence.afterCleanupConcurrent = await snapshot(concurrentKey, marker + 'C');
    evidence.cleanupPassed = !evidence.afterCleanup.header.length && !evidence.afterCleanup.lines.length && !evidence.afterCleanup.reserve.length && !evidence.afterCleanup.idem.length && !evidence.afterCleanupConcurrent.header.length && !evidence.afterCleanupConcurrent.idem.length;
    evidence.writeTargets = [...targets].sort(); evidence.dedicatedConnections = connections;
    console.log('CREATE_INTEGRITY_PROBE=' + JSON.stringify(evidence));
    await observer.close(); await pool.close();
  }
})().catch((e) => { console.error(JSON.stringify({ success: false, code: e.code || 'CREATE_PROBE_SETUP_FAILED', odbc: (e.odbcErrors || []).map((x) => ({ state: x.state, code: x.code })) })); process.exitCode = 1; });
'@
$nodeSource = $nodeSource.Replace('SOURCE_BUNDLE', $bundle64)
$nodeSource | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
