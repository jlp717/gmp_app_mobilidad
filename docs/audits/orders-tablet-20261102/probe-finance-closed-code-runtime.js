'use strict';

// This evidence harness never loads the deployed business modules, email, PDF,
// routes or protected DB adapter. Product SQL/rules are compiled from f4b025a.
const bundle = global.__FINANCE_PROBE_BUNDLE__;
let odbc;
const crypto = require('crypto');
const Module = require('module');
const path = require('path').posix;
const encode = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' && !(value instanceof Date)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : encode(canonical(value))).digest('hex');
const rowsHash = rows => hash(rows.map(row => encode(canonical(row))).sort());
const trim = value => String(value ?? '').trim();
const cents = value => Math.round(Number(value) * 100);
function check(condition, code) { if (!condition) throw Object.assign(new Error(code), {code}); }
function diagnostic(error) {
  return {code:/^[A-Z][A-Z0-9_]{2,70}$/.test(error?.code || '') ? error.code : 'FINANCE_NATIVE_FAILED',
    odbc:(error?.odbcErrors || []).map(v => ({state:/^[A-Z0-9]{5}$/.test(v.state || '') ? v.state : null, code:Number.isFinite(Number(v.code)) ? Number(v.code) : null}))};
}
const period = '2026-11-03';
const sealedCommit = 'f4b025a11335599bbb4dcd99d382f778bac6e2a0';
const expectedSourceManifest = '6133d1e64128f173230fa100526218e5773d60a2daa3097793131a576e178ea2';
const allowedNativeModules = new Set(['crypto','fs','path','cluster','dotenv']);
const actor = {userId:'35', userRole:'COMERCIAL'};
const documents = [
  {clientCode:'4300040687',reference:'CVC:COB:F:GMP:2026:F:0:13427:1:1',amount:738.46,paymentMethod:'CONTADO',idempotencyToken:'finance-closed-20261103-cash-13427'},
  {clientCode:'4300032575',reference:'CVC:COB:F:GMP:2026:F:0:13423:1:1',amount:139.02,paymentMethod:'TJ',idempotencyToken:'finance-closed-20261103-card-13423'},
  {clientCode:'4300032572',reference:'CVC:COB:F:GMP:2026:F:0:13422:1:1',amount:1031.53,paymentMethod:'TR',idempotencyToken:'finance-closed-20261103-transfer-13422'},
].map(doc => ({...doc,...actor,observations:'Validacion comercial TEST de datos reales; run orders-tablet-20261102'}));
const settlementToken = 'finance-closed-20261103-liq35';
const tokens = new Set([...documents.map(d => d.idempotencyToken),settlementToken]);
const readTables = ['TEST_COBROS','TEST_REPARTIDOR_COBROS','TEST_LIQUIDACION_COMERCIAL'];
const leases = new Set();
const acquisitions = new Set();
const reads = new Set();
const activeQueries = new Set();
const metadataColumns = new Map();
let closing = false;
let postflightOnly = false;
let settlementFingerprint;
let watchdog;
const evidence = {job:'FINANCE_CLOSED_CODE',mode:bundle?.mode,sourceCommit:bundle?.commit,period,
  authCoverage:'Direct repository/service integration; no JWT, HTTP or device coverage',phase:'SETUP',queryCount:0,queryTimeMs:0,mutationCount:0,commitCount:0,rollbackCount:0,closeFailures:[],operations:[]};
let connectionString;
let failure;
let before;
const cleanSql = sql => String(sql).replace(/\/\*[\s\S]*?\*\//g,' ').replace(/\s+/g,' ').trim();
function guard(sql, params = [], writer = false) {
  const text = cleanSql(sql);
  if (/^(SELECT|WITH)\s/i.test(text)) {
    check(!/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|CALL|GRANT|REVOKE)\b/i.test(text),'READ_SQL_MUTATION_REJECTED');
    return;
  }
  check(writer && bundle.mode === 'Run','MUTATION_REJECTED_READONLY_MODE');
  if (/^SET TRANSACTION ISOLATION LEVEL READ COMMITTED$/i.test(text)) return;
  if (/^LOCK TABLE JAVIER\.TEST_(REPARTIDOR_COBROS|COBROS|LIQUIDACION_COMERCIAL) IN EXCLUSIVE MODE$/i.test(text)) return;
  const match = /^INSERT INTO (JAVIER\.TEST_COBROS|JAVIER\.TEST_LIQUIDACION_COMERCIAL) \(([^)]+)\) VALUES \(([^)]+)\)$/i.exec(text);
  check(match,'WRITE_SQL_OUTSIDE_EXACT_INSERT_SCOPE');
  const columns = match[2].split(',').map(value => trim(value).toUpperCase());
  check(columns.length === params.length && match[3].split(',').every(value => trim(value) === '?'),'INSERT_PARAMETER_SHAPE_REJECTED');
  const knownColumns = metadataColumns.get(match[1].split('.')[1].toUpperCase());
  check(knownColumns && columns.every(column => knownColumns.has(column)),'INSERT_COLUMN_METADATA_UNVERIFIED');
  const row = Object.fromEntries(columns.map((column,index) => [column,params[index]]));
  check(tokens.has(row.IDEMPOTENCY_TOKEN),'FOREIGN_TOKEN_INSERT_REJECTED');
  if (match[1].toUpperCase() === 'JAVIER.TEST_COBROS') {
    const doc = documents.find(item => item.idempotencyToken === row.IDEMPOTENCY_TOKEN);
    check(doc && trim(row.CODIGO_CLIENTE) === doc.clientCode && trim(row.REFERENCIA) === doc.reference
      && cents(row.IMPORTE) === cents(doc.amount) && trim(row.FORMA_PAGO) === doc.paymentMethod
      && trim(row.CODIGOVENDEDOR) === '35' && trim(row.CODIGO_USUARIO) === '35' && trim(row.TIPO_USUARIO) === 'COMERCIAL'
      && trim(row.TIPO_VENTA) === 'CC' && row.TIPO_MODO == null && row.OBSERVACIONES === doc.observations,'PAYMENT_INSERT_FINGERPRINT_REJECTED');
  } else {
    check(row.IDEMPOTENCY_TOKEN === settlementToken && trim(row.CODIGO_VENDEDOR) === '35' && row.FECHA === period
      && trim(row.CREATED_BY) === '35' && row.STATUS === 'SAVED','SETTLEMENT_INSERT_FINGERPRINT_REJECTED');
    check(settlementFingerprint && Object.entries(settlementFingerprint).every(([column,value])=>cents(row[column])===cents(value)),'SETTLEMENT_MONETARY_FINGERPRINT_REJECTED');
  }
  evidence.mutationCount++;
}
function deadline(operation, milliseconds, code, onTimeout) {
  let timer;
  const limited = new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      evidence.uncertainOperation=true;
      evidence.timeouts ||= [];
      evidence.timeouts.push({code,phase:evidence.phase});
      try { if(onTimeout) onTimeout(); } catch { /* typed timeout still wins */ }
      reject(Object.assign(new Error(code),{code}));
    },milliseconds);
  });
  return Promise.race([Promise.resolve(operation),limited]).finally(()=>clearTimeout(timer));
}
async function openLease(writer) {
  check(!closing,'PROBE_CLOSING_NO_NEW_LEASES');
  check(!(writer && postflightOnly),'POSTFLIGHT_READONLY_REQUIRED');
  // Track an acquisition before awaiting it, including failed opens.
  const acquisition = odbc.connect({connectionString,connectionTimeout:10,loginTimeout:10});
  acquisitions.add(acquisition);
  let native;
  try { native = await deadline(acquisition,15000,'FINANCE_CONNECT_TIMEOUT'); }
  catch(error) {
    // A late successful acquisition is never exposed to business code.
    acquisition.then(late=>deadline(late.close(),12000,'LATE_CONNECTION_CLOSE_TIMEOUT').catch(()=>{}),()=>{});
    throw error;
  } finally { acquisitions.delete(acquisition); }
  const lease = {native,writer,closed:false};
  leases.add(lease);
  const api = {
    query:async (sql,params=[]) => {
      guard(sql,params,writer);
      const start = process.hrtime.bigint();
      const operation = native.query(sql,params,{timeout:20});
      activeQueries.add(operation);
      try { return await deadline(operation,30000,'FINANCE_QUERY_TIMEOUT',()=>{if(typeof native.cancel==='function')Promise.resolve(native.cancel()).catch(()=>{});}); }
      finally { activeQueries.delete(operation);evidence.queryCount++; evidence.queryTimeMs += Number(process.hrtime.bigint()-start)/1e6; }
    },
    beginTransaction:() => {check(writer && bundle.mode === 'Run' && !postflightOnly,'TRANSACTION_WRITE_MODE_REQUIRED');return deadline(native.beginTransaction(),15000,'FINANCE_BEGIN_TIMEOUT');},
    commit:async () => {await deadline(native.commit(),15000,'FINANCE_COMMIT_TIMEOUT');evidence.commitCount++;},
    rollback:async () => {await deadline(native.rollback(),15000,'FINANCE_ROLLBACK_TIMEOUT');evidence.rollbackCount++;},
    close:() => {
      if (!lease.closePromise) lease.closePromise=(async()=>{await deadline(native.close(),12000,'FINANCE_CLOSE_TIMEOUT');lease.closed=true;leases.delete(lease);})();
      return lease.closePromise;
    },
  };
  lease.api = api;
  if (closing) {
    await api.close();
    check(false,'PROBE_CLOSING_NO_NEW_LEASES');
  }
  return api;
}
function read(sql,params=[]) {
  const operation=(async()=>{
    let connection;
    try { connection = await openLease(false);return await connection.query(sql,params); }
    finally { if (connection) await connection.close(); }
  })();
  reads.add(operation);
  operation.then(()=>reads.delete(operation),()=>reads.delete(operation));
  return operation;
}
const noUnusedOperation = () => {throw Object.assign(new Error('UNUSED_DEPENDENCY_CALLED'),{code:'UNUSED_DEPENDENCY_CALLED'});};
const logger = {info:()=>{},warn:()=>{},error:()=>{},debug:()=>{}};
const stubs = {
  'config/db.js':{query:read,queryWithParams:read},
  'middleware/logger.js':logger,
  'services/laclae.js':{getClientCodesFromCache:noUnusedOperation},
  'services/comercial-devolucion-pdf-service.js':{buildReturnPdfPath:noUnusedOperation,buildDevolucionPdfBuffer:noUnusedOperation,devolucionPdfFileName:noUnusedOperation},
  'src/repositories/bSales.repository.js':{bSalesRepository:new Proxy({}, {get:()=>noUnusedOperation})},
  'optional/dsedac-exports.impl.js':new Proxy({}, {get:()=>noUnusedOperation}),
  'adapters/pedidos-transaction-connection.js':{openDedicatedPedidosTransactionConnection:()=>openLease(true)},
};
const modules = new Map();
function resolved(from, request) {
  const key = path.normalize(path.join(path.dirname(from),request));
  check(!key.startsWith('../') && !path.isAbsolute(key),'SOURCE_PATH_ESCAPE');
  // Node also appends .js to names such as *.service and *.repository.
  return key.endsWith('.js') ? key : key+'.js';
}
function load(key) {
  if (Object.prototype.hasOwnProperty.call(stubs,key)) return stubs[key];
  if (modules.has(key)) return modules.get(key).exports;
  check(Object.prototype.hasOwnProperty.call(bundle.sources,key),'UNSEALED_DEPENDENCY');
  const mod = new Module('/sealed-finance/'+key,module);
  mod.filename='/sealed-finance/'+key;
  modules.set(key,mod);
  mod.require=request => {
    if (allowedNativeModules.has(request)) return require(request);
    check(request.startsWith('.'),'EXTERNAL_DEPENDENCY_REJECTED');
    return load(resolved(key,request));
  };
  mod._compile(bundle.sources[key],mod.filename);
  return mod.exports;
}
async function snapshot() {
  const result={};
  for (const table of readTables) result[table]=await read('SELECT * FROM JAVIER.'+table);
  return result;
}
const ownRows = rows => rows.filter(row => tokens.has(trim(row.IDEMPOTENCY_TOKEN)));
const foreignRows = rows => rows.filter(row => !tokens.has(trim(row.IDEMPOTENCY_TOKEN)));
function snapshotEvidence(data) {
  return Object.fromEntries(Object.entries(data).map(([table,rows])=>[table,{count:rows.length,sha256:rowsHash(rows),ownedRows:ownRows(rows)}]));
}
async function assertDocument(repository,doc) {
  const order=await repository.findOrderForPayment(doc.clientCode,doc.reference,read);
  check(order && trim(order.SOURCE)==='CVC' && trim(order.ID)===doc.reference && trim(order.CODIGOVENDEDOR)==='35','DOCUMENT_IDENTITY_CHANGED');
  check(cents(order.IMPORTETOTAL)===cents(doc.amount) && Number(order.IMPORTE_DOCUMENTO)>=doc.amount,'REAL_DOCUMENT_AMOUNT_CHANGED');
  const forma=trim(order.FORMA_PAGO).toUpperCase();
  check(forma && !['01','CO','CTR','EF'].includes(forma) && !forma.includes('CTR') && !forma.includes('REEMB'),'DRIVER_RESPONSIBILITY_REJECTED');
  const type=await repository.resolveOrderSaleType(order,read);
  check(type==='CC','AUTHORITATIVE_SALE_TYPE_CHANGED');
  const rigorous=await repository.getClientCobroRiguroso(doc.clientCode,{ownerVendorCode:'35',userId:'35',vendorCodes:['35']});
  return {reference:doc.reference,clientCode:doc.clientCode,owner:'35',cvcPending:Number(order.IMPORTETOTAL),documentAmount:Number(order.IMPORTE_DOCUMENTO),formaPago:forma,saleType:type,rigorous};
}
async function run() {
  check(bundle && bundle.commit===sealedCommit && ['ReadOnly','Run'].includes(bundle.mode),'INVALID_SEALED_BUNDLE');
  const manifest=bundle.commit+'\n'+Object.keys(bundle.sources).sort().map(key=>key+':'+hash(bundle.sources[key])).join('\n');
  check(Object.keys(bundle.sources).length===17 && hash(manifest)===expectedSourceManifest && bundle.manifestSha256===expectedSourceManifest,'APPROVED_SOURCE_MANIFEST_REQUIRED');
  // Exhaustive static closure check includes lazy literal imports before DB open.
  const closure=[];
  for (const [key,source] of Object.entries(bundle.sources)) {
    for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const request=match[1];
      if (allowedNativeModules.has(request)) continue;
      check(request.startsWith('.'),'UNSEALED_EXTERNAL_IMPORT');
      const target=resolved(key,request);
      check(Object.prototype.hasOwnProperty.call(stubs,target)||Object.prototype.hasOwnProperty.call(bundle.sources,target),'INCOMPLETE_SEALED_CLOSURE');
      closure.push({from:key,to:target,transportStub:Object.prototype.hasOwnProperty.call(stubs,target)});
    }
  }
  evidence.sourceHashes=Object.fromEntries(Object.entries(bundle.sources).map(([key,source])=>[key,hash(source)]));
  evidence.closure=closure;
  evidence.manifestSha256=expectedSourceManifest;
  // Bootstrap code is now part of the exact approved closure, not the daemon.
  load('config/load-env.js').loadEnv(process.cwd());
  // This transient evidence job selects TEST explicitly. It never changes a
  // file, daemon or protected environment, and refuses an active other profile.
  check(!trim(process.env.APP_ENV) || trim(process.env.APP_ENV).toLowerCase()==='test','FINANCE_PROBE_TEST_PROFILE_REQUIRED');
  process.env.APP_ENV='test';
  evidence.profile=load('config/app-profile.js').applyAppProfile(process.env);
  odbc=require('odbc');
  const schemas=load('utils/db2-schemas.js');
  const runtime=load('config/reparto-runtime.js').resolveRepartoRuntime(process.env);
  check(runtime.valid && runtime.tableSet==='isolated_test','VERIFIED_ISOLATED_RUNTIME_REQUIRED');
  for (const name of ['COBROS','REPARTIDOR_COBROS','PEDIDOS_CAB']) check(schemas.db2AppTable(name)==='JAVIER.TEST_'+name,'EXACT_TEST_TARGET_REQUIRED');
  const exportsFacade=load('services/dsedac-exports.service.js');
  check(exportsFacade.exportGate().enabled===false,'ERP_EXPORT_MUST_BE_DISABLED');
  const finance=load('services/comercial-devoluciones-service.js');
  check(finance.TEST_LIQUIDACION_TABLE==='JAVIER.TEST_LIQUIDACION_COMERCIAL','EXACT_SETTLEMENT_TARGET_REQUIRED');
  finance.assertIsolatedTestWrites();
  const {Db2CobrosRepository}=load('src/modules/cobros/infrastructure/db2-cobros-repository.js');
  const repo=new Db2CobrosRepository({transactionConnectionFactory:()=>openLease(true)});
  connectionString=`DSN=${process.env.ODBC_DSN||'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
  evidence.phase='PREFLIGHT';
  for (const table of readTables) {
    const rows=await read('SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',['JAVIER',table]);
    check(rows.length>0 && rows.some(row=>trim(row.COLUMN_NAME)==='IDEMPOTENCY_TOKEN'),'TEST_TABLE_METADATA_REQUIRED');
    metadataColumns.set(table,new Set(rows.map(row=>trim(row.COLUMN_NAME))));
  }
  const indexes=await read('SELECT INDEX_NAME, IS_UNIQUE FROM QSYS2.SYSINDEXES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?',['JAVIER','TEST_COBROS','UX_TEST_COBROS_TOKEN']);
  check(indexes.length===1 && ['U','V'].includes(trim(indexes[0].IS_UNIQUE)),'UNIQUE_COLLECTION_TOKEN_INDEX_REQUIRED');
  const today=await read("SELECT VARCHAR_FORMAT(CURRENT TIMESTAMP, 'YYYY-MM-DD') AS TODAY FROM SYSIBM.SYSDUMMY1");
  check(trim(today[0]?.TODAY)===period,'CURRENT_BUSINESS_DAY_CHANGED_NO_BACKDATE');
  before=await snapshot();
  check(readTables.every(table=>ownRows(before[table]).length===0),'PROBE_ALREADY_HAS_OWNED_ROWS_NO_RERUN');
  const existingDay=await read('SELECT IDEMPOTENCY_TOKEN FROM JAVIER.TEST_LIQUIDACION_COMERCIAL WHERE TRIM(CODIGO_VENDEDOR)=? AND FECHA=?',['35',period]);
  check(existingDay.length===0,'FOREIGN_SETTLEMENT_EXISTS');
  evidence.before=snapshotEvidence(before);
  evidence.documents=[];
  for (const doc of documents) {
    check(!before.TEST_COBROS.some(row=>trim(row.CODIGO_CLIENTE)===doc.clientCode && [doc.reference,'F-'+doc.reference.split(':')[7],'CVC:F-'+doc.reference.split(':')[7]].includes(trim(row.REFERENCIA))),'EXISTING_COMMERCIAL_OVERLAY');
    evidence.documents.push(await assertDocument(repo,doc));
  }
  const summaryBefore=await finance.getDailySummary({vendorCodes:['35'],date:period},{queryWithParams:read});
  evidence.summaryBefore=summaryBefore;
  check(Number(summaryBefore.cobrosCount || summaryBefore.cobros?.count || summaryBefore.collectionsCount || 0)===0,'CURRENT_PERIOD_ALREADY_HAS_COLLECTIONS');
  settlementFingerprint={
    INGRESO_BANCO:(73846+cents(summaryBefore.summary.saldoActual)-cents(summaryBefore.summary.devolucionesYaCobradas))/100,
    ENTREGADO:0,TOTAL_ESPERADO:(73846+cents(summaryBefore.summary.saldoActual)-cents(summaryBefore.summary.devolucionesYaCobradas))/100,
    TOTAL_EFECTIVO:738.46,TOTAL_CHEQUES:0,TOTAL_POSTDATADOS:0,
    SALDO_ACTUAL:summaryBefore.summary.saldoActual,DEVOLUCIONES_YA_COBRADAS:summaryBefore.summary.devolucionesYaCobradas,
    TOTAL_A_INGRESAR:(73846+cents(summaryBefore.summary.saldoActual)-cents(summaryBefore.summary.devolucionesYaCobradas))/100,
  };
  evidence.expectedSettlement=settlementFingerprint;
  process.stdout.write(encode({checkpoint:'BEFORE_MUTATION',...evidence})+'\n');
  if (bundle.mode==='ReadOnly') {evidence.phase='READONLY_DONE';return;}
  for (const [index,doc] of documents.entries()) {
    evidence.phase='PAYMENT_'+doc.paymentMethod;
    const start=process.hrtime.bigint();
    let fresh,replay;
    if (index===1) {
      const second=new Db2CobrosRepository({transactionConnectionFactory:()=>openLease(true)});
      const outcomes=await Promise.allSettled([repo.registerPayment(doc),second.registerPayment(doc)]);
      check(outcomes.every(item=>item.status==='fulfilled'),'CONCURRENT_PAYMENT_FAILED');
      const values=outcomes.map(item=>item.value);
      check(values.filter(item=>item.idempotent===false).length===1 && values.filter(item=>item.idempotent===true).length===1,'CONCURRENT_PAYMENT_NOT_EXACTLY_ONCE');
      fresh=values.find(item=>!item.idempotent);replay=values.find(item=>item.idempotent);
    } else {fresh=await repo.registerPayment(doc);replay=await repo.registerPayment(doc);}
    check(fresh.idempotent===false && replay.idempotent===true && fresh.id===replay.id && fresh.ownerVendorCode==='35','PAYMENT_REPLAY_NOT_VERIFIED');
    check(cents(fresh.pendingAfter)===0,'PAYMENT_PENDING_NOT_ZERO');
    const rows=await read('SELECT * FROM JAVIER.TEST_COBROS WHERE IDEMPOTENCY_TOKEN=?',[doc.idempotencyToken]);
    check(rows.length===1 && cents(rows[0].IMPORTE)===cents(doc.amount),'PAYMENT_ROWS_NOT_VERIFIED');
    evidence.operations.push({method:doc.paymentMethod,amount:doc.amount,elapsedMs:Number(process.hrtime.bigint()-start)/1e6,fresh,replay,rows});
  }
  evidence.phase='SETTLEMENT';
  const summary=await finance.getDailySummary({vendorCodes:['35'],date:period},{queryWithParams:read});
  evidence.summaryAfter=summary;
  check(summary.cobros.count===3 && cents(summary.summary.totalEfectivo)===73846 && cents(summary.summary.totalTarjeta)===13902 && cents(summary.summary.totalTransferencia)===103153,'THREE_METHOD_SUMMARY_NOT_VERIFIED');
  const actions={vendorCodes:['35'],date:period,ingresoBanco:summary.summary.totalAIngresar,entregado:0,expectedRevision:null,createdBy:'35',idempotencyToken:settlementToken};
  const saved=await finance.saveLiquidacion(actions,{openDedicatedConnection:()=>openLease(true)});
  const replay=await finance.saveLiquidacion(actions,{openDedicatedConnection:()=>openLease(true)});
  check(saved.idempotent===false && replay.idempotent===true,'SETTLEMENT_REPLAY_NOT_VERIFIED');
  evidence.settlement={actions,saved,replay};
  evidence.phase='POSTCHECK';
  const after=await snapshot();
  evidence.after=snapshotEvidence(after);
  for (const table of readTables) check(rowsHash(foreignRows(before[table]))===rowsHash(foreignRows(after[table])),'FOREIGN_ROWS_CHANGED');
  check(after.TEST_COBROS.length===before.TEST_COBROS.length+3 && ownRows(after.TEST_COBROS).length===3,'EXACT_THREE_PAYMENT_ROWS_REQUIRED');
  check(after.TEST_LIQUIDACION_COMERCIAL.length===before.TEST_LIQUIDACION_COMERCIAL.length+1 && ownRows(after.TEST_LIQUIDACION_COMERCIAL).length===1,'EXACT_ONE_SETTLEMENT_ROW_REQUIRED');
  const persistedSettlement=ownRows(after.TEST_LIQUIDACION_COMERCIAL)[0];
  check(Object.entries(settlementFingerprint).every(([column,value])=>cents(persistedSettlement[column])===cents(value)),'SETTLEMENT_PERSISTED_MONETARY_FINGERPRINT_REJECTED');
  check(after.TEST_REPARTIDOR_COBROS.length===before.TEST_REPARTIDOR_COBROS.length,'DRIVER_LEDGER_CHANGED');
  evidence.resetManifest={version:1,sourceCommit:bundle.commit,period,rows:Object.fromEntries(['TEST_COBROS','TEST_LIQUIDACION_COMERCIAL'].map(table=>[table,ownRows(after[table]).map(row=>({id:row.ID,token:row.IDEMPOTENCY_TOKEN,sha256:hash(row),row}))]))};
  evidence.phase='DONE';
}
function buildResetManifest(data) {
  return {version:1,sourceCommit:bundle.commit,period,rows:Object.fromEntries(['TEST_COBROS','TEST_LIQUIDACION_COMERCIAL'].map(table=>[table,ownRows(data[table]).map(row=>({id:row.ID,token:row.IDEMPOTENCY_TOKEN,sha256:hash(row),row}))]))};
}
async function drainAndClose() {
  closing=true;
  await deadline(Promise.allSettled([...acquisitions]),16000,'FINANCE_ACQUISITION_DRAIN_TIMEOUT').catch(error=>{failure ||= diagnostic(error);});
  await deadline(Promise.allSettled([...reads]),35000,'FINANCE_READ_DRAIN_TIMEOUT').catch(error=>{failure ||= diagnostic(error);});
  await deadline(Promise.allSettled([...activeQueries]),35000,'FINANCE_QUERY_DRAIN_TIMEOUT').catch(error=>{failure ||= diagnostic(error);});
  const results=await Promise.allSettled([...leases].map(lease=>lease.api.close()));
  results.forEach(result=>{if(result.status==='rejected')evidence.closeFailures.push(diagnostic(result.reason));});
  if (leases.size || evidence.closeFailures.length || evidence.uncertainOperation) failure ||= {code:'CONNECTION_CLOSURE_OR_OPERATION_UNCERTAIN'};
}
(async()=>{
  watchdog=setTimeout(()=>{
    // Only this transient probe process exits. No daemon/process is signalled.
    evidence.success=false;evidence.error={code:'FINANCE_GLOBAL_WATCHDOG_TIMEOUT'};evidence.allPhysicalConnectionsClosed=false;
    evidence.resetManifestStatus='MANUAL_COMPENSATION_EVIDENCE_INCOMPLETE';
    evidence.ownedTokens=[...tokens];
    closing=true;
    Promise.allSettled([...leases].map(async lease=>{
      try {await deadline(lease.native.rollback(),4000,'WATCHDOG_ROLLBACK_TIMEOUT');} catch { /* still attempt close */ }
      try {await lease.api.close();} catch { /* no false closure claim */ }
    })).finally(()=>{process.stdout.write(encode({checkpoint:'FINAL',...evidence})+'\n');process.exit(1);});
    setTimeout(()=>{process.stdout.write(encode({checkpoint:'FINAL',...evidence})+'\n');process.exit(1);},18000);
  },300000);
  try {await run();} catch(error) {failure=diagnostic(error);}
  finally {
    await drainAndClose();
    if(bundle.mode==='Run' && evidence.mutationCount>0) {
      evidence.resetManifestStatus='MANUAL_COMPENSATION_EVIDENCE_INCOMPLETE';
      evidence.ownedTokens=[...tokens];
      if(leases.size===0 && !evidence.uncertainOperation) {
        try {
          closing=false;postflightOnly=true;
          const partialAfter=await deadline(snapshot(),90000,'FINANCE_POSTFLIGHT_TIMEOUT');
          evidence.partialAfter=snapshotEvidence(partialAfter);
          evidence.resetManifest=buildResetManifest(partialAfter);
          evidence.foreignRowsPreserved=before && readTables.every(table=>rowsHash(foreignRows(before[table]))===rowsHash(foreignRows(partialAfter[table])));
          evidence.resetManifestStatus='COMPLETE_EXACT_OWNED_ROWS';
          if(!evidence.foreignRowsPreserved) failure ||= {code:'FOREIGN_ROWS_CHANGED'};
        } catch(error) {evidence.postflightError=diagnostic(error);failure ||= {code:'MANUAL_COMPENSATION_EVIDENCE_INCOMPLETE'};}
        finally {await drainAndClose();}
      } else {failure ||= {code:'MANUAL_COMPENSATION_EVIDENCE_INCOMPLETE'};}
    }
    clearTimeout(watchdog);
  }
  evidence.allPhysicalConnectionsClosed=leases.size===0 && acquisitions.size===0 && !evidence.uncertainOperation;
  evidence.success=!failure;
  if (failure) {evidence.error=failure;process.exitCode=1;}
  process.stdout.write(encode({checkpoint:'FINAL',...evidence})+'\n');
  if(evidence.uncertainOperation || leases.size) process.exit(1);
})().catch(()=>{process.stdout.write('{"checkpoint":"FINAL","success":false,"code":"UNEXPECTED_FINANCE_HARNESS_FAILURE"}\n');process.exitCode=1;});
