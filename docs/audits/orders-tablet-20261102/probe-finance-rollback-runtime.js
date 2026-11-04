'use strict';

const bundle = global.__FINANCE_ROLLBACK_BUNDLE__;
const crypto = require('crypto');
const Module = require('module');
const path = require('path').posix;
const encode = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const trim = value => String(value ?? '').trim();
const cents = value => Math.round(Number(value) * 100);
function check(condition, code) { if (!condition) throw Object.assign(new Error(code), {code}); }
function diagnostic(error) { return {code:/^[A-Z][A-Z0-9_]{2,80}$/.test(error?.code || '') ? error.code : 'FINANCE_ROLLBACK_READONLY_FAILED',odbc:(error?.odbcErrors || []).map(item=>({state:/^[A-Z0-9]{5}$/.test(item.state || '') ? item.state : null,code:Number(item.code) || null}))}; }

const sealedCommit = '4a099e89f29378a502598e4698e0c651cccd46d2';
const expectedFingerprint = '8b29b38741087910608fdfc71f28527a9b240ab7fd7ef9fc0180143d03c73a69';
const allowedNative = new Set(['crypto','fs','path','cluster','dotenv']);
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
async function withRead(sql, params = []) {
  const normalized = String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
  check(/^(SELECT|WITH)\s/i.test(normalized) && Array.isArray(params), 'READONLY_SQL_REQUIRED');
  check(!/;|\b(INSERT|UPDATE|DELETE|MERGE|LOCK|SET|CALL|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(normalized), 'READONLY_SQL_MUTATION_REJECTED');
  check(queryCount < 60, 'READONLY_QUERY_BUDGET_EXHAUSTED');
  queryCount += 1;
  const result = reads.then(() => connection.query(sql, params, {timeout:12}));
  reads = result.catch(() => {});
  return result;
}

(async()=>{
  const evidence = {job:'FINANCE_ROLLBACK_READONLY',mode:bundle?.mode,sourceCommit:bundle?.commit,queryCount:0,connected:false,closed:false,physicalDml:0,physicalCommit:0};
  try {
    check(bundle?.mode === 'ReadOnly' && bundle.commit === sealedCommit, 'READONLY_SEALED_BUNDLE_REQUIRED');
    const manifest = bundle.commit+'\n'+Object.keys(bundle.sources).sort().map(key=>`${key}:${hash(bundle.sources[key])}`).join('\n');
    check(hash(manifest) === bundle.manifestSha256, 'SOURCE_MANIFEST_MISMATCH');
    check(bundle.candidateFingerprint === expectedFingerprint, 'CANDIDATE_FINGERPRINT_BINDING_REQUIRED');
    check(!trim(process.env.APP_ENV) || trim(process.env.APP_ENV).toLowerCase() === 'demo', 'DEMO_PROFILE_REQUIRED');
    process.env.APP_ENV = 'demo';
    load('config/load-env.js').loadEnv(process.cwd());
    const profile = load('config/app-profile.js').applyAppProfile(process.env);
    check(profile.verified && profile.profile === 'demo' && profile.tableSet === 'isolated_test' && !profile.erpExportEnabled && !profile.productionWritesEnabled, 'ISOLATED_DEMO_PROFILE_REQUIRED');
    const odbc = require('odbc');
    const connectionString = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
    stubs['config/db.js'] = {query:withRead,queryWithParams:withRead};
    stubs['middleware/logger.js'] = {info(){},warn(){},error(){},debug(){}};
    stubs['services/laclae.js'] = {getClientCodesFromCache(){ throw Object.assign(new Error('UNUSED_DEPENDENCY_CALLED'),{code:'UNUSED_DEPENDENCY_CALLED'}); }};
    stubs['services/comercial-devolucion-pdf-service.js'] = {};
    stubs['src/repositories/bSales.repository.js'] = {bSalesRepository:{}};
    stubs['optional/dsedac-exports.impl.js'] = {};
    stubs['adapters/pedidos-transaction-connection.js'] = {openDedicatedPedidosTransactionConnection(){ throw Object.assign(new Error('READONLY_TRANSACTION_REJECTED'),{code:'READONLY_TRANSACTION_REJECTED'}); }};
    const {Db2CobrosRepository} = load('src/modules/cobros/infrastructure/db2-cobros-repository.js');
    const repository = new Db2CobrosRepository({transactionConnectionFactory:()=>{ throw Object.assign(new Error('READONLY_TRANSACTION_REJECTED'),{code:'READONLY_TRANSACTION_REJECTED'}); }});
    connection = await odbc.connect({connectionString,connectionTimeout:10,loginTimeout:10});
    evidence.connected = true;
    const dateRows = await withRead("SELECT VARCHAR_FORMAT(CURRENT DATE, 'YYYY-MM-DD') AS TODAY FROM SYSIBM.SYSDUMMY1");
    const businessDate = trim(dateRows[0]?.TODAY);
    const clients = await withRead("SELECT DISTINCT TRIM(CODIGOCLIENTEALBARAN) AS CLIENT_CODE FROM DSEDAC.CVC WHERE CODIGOVENDEDOR=CAST(? AS CHAR(2)) AND IMPORTEPENDIENTE>0 AND (ANULADOSN IS NULL OR ANULADOSN<>'S') AND TIPODOCUMENTO=CAST(? AS CHAR(3)) AND ORIGENDOCUMENTO=CAST(? AS CHAR(1)) ORDER BY CLIENT_CODE FETCH FIRST 6 ROWS ONLY", ['35','COB','F']);
    let selected = null;
    for (const candidate of clients) {
      const clientCode = trim(candidate.CLIENT_CODE);
      const pending = await repository.getPendientes(clientCode,{userId:'35',userRole:'COMERCIAL',vendorCodes:['35'],limit:20});
      const eligible = (pending.cobros || []).filter(doc=>doc.docKey?.source === 'CVC' && doc.cobrable === true && doc.responsabilidad === 'COMERCIAL' && doc.documentoNoDisponible !== true && cents(doc.importePendiente) > 0).slice(0,2);
      for (const document of eligible) {
        const order = await repository.findOrderForPayment(clientCode, document.id, withRead);
        if (!order || trim(order.SOURCE) !== 'CVC' || trim(order.CODIGOVENDEDOR) !== '35' || cents(order.IMPORTETOTAL) !== cents(document.importePendiente) || Number(order.IMPORTE_DOCUMENTO) < Number(document.importePendiente)) continue;
        if (await repository.resolveOrderSaleType(order, withRead) !== 'CC') continue;
        const fingerprint = hash(`${clientCode}|${document.id}|${cents(document.importePendiente)}|${businessDate}`);
        if (fingerprint === expectedFingerprint) selected = {fingerprint,amountCents:cents(document.importePendiente)};
        if (selected) break;
      }
      if (selected) break;
    }
    check(selected, 'VERIFIED_CANDIDATE_CHANGED');
    evidence.candidate = selected;
    evidence.businessDate = businessDate;
    evidence.candidateClientCount = clients.length;
    evidence.success = true;
  } catch (error) { evidence.success=false;evidence.error=diagnostic(error);process.exitCode=1; }
  finally {
    await reads;
    if (connection) {
      try { await connection.close(); evidence.closed=true; }
      catch (error) { evidence.success=false;evidence.closeError=diagnostic(error);process.exitCode=1; }
    }
    evidence.queryCount = queryCount;
    process.stdout.write(`FINANCE_ROLLBACK=${encode(evidence)}\n`);
  }
})().catch(error=>{process.stdout.write(`FINANCE_ROLLBACK=${encode({success:false,error:diagnostic(error)})}\n`);process.exitCode=1;});
