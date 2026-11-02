'use strict';
if(process.env.ORDERS_LIFECYCLE_SELFTEST!=='1')require('./config/load-env').loadEnv(process.cwd());
const odbc=require('odbc'),Module=require('module'),path=require('path'),crypto=require('crypto');
const emit=console.log.bind(console);console.log=()=>{};console.info=()=>{};console.warn=()=>{};console.error=()=>{};
const sealed=JSON.parse(Buffer.from('SOURCE_BUNDLE','base64').toString('utf8'));
const bundle=sealed.files, externalPackages=new Set(sealed.externals);
const encode=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
const trim=v=>String(v??'').trim(), hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:encode(v)).digest('hex');
function fail(code){throw Object.assign(new Error(code),{code});}
function check(ok,code){if(!ok)fail(code);}
function diagnostic(e){return {code:/^[A-Z][A-Z0-9_]{2,70}$/.test(e.code||'')?e.code:'LIFECYCLE_NATIVE_OR_MODULE_FAILED',odbc:(e.odbcErrors||[]).map(x=>({state:/^[A-Z0-9]{5}$/.test(x.state)?x.state:null,code:Number.isFinite(Number(x.code))?Number(x.code):null}))};}
const root=process.cwd(),cache=new Map(),owned=new Set(),writes=new Set(),connections=[],purge=[];
const marker='OTDstate20261102'+crypto.randomBytes(5).toString('hex');
const tables=['TEST_PEDIDOS_CAB','TEST_PEDIDOS_LIN','TEST_PEDIDOS_STOCK_RESERVE','TEST_PEDIDO_IDEMPOTENCY','TEST_PEDIDOS_SEQ','TEST_BOLSA_COMERCIAL','TEST_MOVIMIENTOS_BOLSA','TEST_PEDIDO_STATE_EVENTS'];
const writeTargets=new Set(tables.map(t=>'JAVIER.'+t));
const lockTargets=new Set([...writeTargets,...['TEST_REPARTO_CONFIRMACIONES','TEST_REPARTO_EVIDENCIAS','TEST_REPARTO_CONFIRM_EVIDENCIAS','TEST_REPARTIDOR_COBROS','TEST_COBROS'].map(t=>'JAVIER.'+t)]);
const noLog={debug(){},info(){},warn(){},error(){}};
const noRedis={redisCache:{async get(){return null;},async getRemote(){return null;},async set(){},async incrementVersion(){return '1';}},TTL:{SHORT:300,MEDIUM:600,LONG:1800},async deleteCachePattern(){}};
const noOptimizer={cachedQuery:async(fn,sql,...args)=>fn(sql,Array.isArray(args.at(-1))?args.at(-1):[]),async invalidateOnMutation(){},patternFor:()=>''};
let observer,pool,readSerial=Promise.resolve(),phase='SETUP',activeFixture=null,bagId=null,setupConnection=null,service;
const evidence={sourceCommit:'SOURCE_COMMIT',runtimeSha256:'RUNTIME_SHA256',sourceHashes:Object.fromEntries(Object.entries(bundle).map(([k,v])=>[k,hash(v)])),externalPackages:[...externalPackages],scope:'real DB2 service flow; no HTTP/auth/UI; closed local bundle and cache/logger stubs; only sealed expiry candidate SELECT suppressed; two owned orders retained CANCELADO; canonical monthly initialization explicitly owned if absent',marker,fixtures:[],daemonChanged:false};
function normalizeSql(sql){return String(sql).replace(/\s+/g,' ').trim().replace(/;$/,'');}
function whereParameter(sql,column,params){
 const where=/\bWHERE\s+([\s\S]+)$/i.exec(sql);check(where,'MUTATION_WITHOUT_WHERE');
 const match=new RegExp('(?:^|\\s|\\()'+column+'\\s*=\\s*\\?','i').exec(where[1]);check(match,'MUTATION_WITHOUT_OWNERSHIP');
 const index=(sql.slice(0,where.index+where[0].indexOf(where[1])+match.index+match[0].lastIndexOf('?')).match(/\?/g)||[]).length;
 return params[index];
}
function insertRows(sql,params){
 const match=/^INSERT INTO [A-Z0-9_.]+\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+)$/i.exec(normalizeSql(sql));check(match,'UNREVIEWED_INSERT_SHAPE');
 const columns=match[1].split(',').map(trim),groups=[];let level=0,start=-1,quoted=false;
 for(let i=0;i<match[2].length;i++){const ch=match[2][i];if(ch==="'"){if(quoted&&match[2][i+1]==="'"){i++;continue;}quoted=!quoted;}if(quoted)continue;if(ch==='('&&level++===0)start=i+1;if(ch===')'&&--level===0)groups.push(match[2].slice(start,i));}
 check(!quoted&&level===0&&groups.length>0,'UNREVIEWED_INSERT_VALUES');let offset=0;
 const rows=groups.map(group=>{let depth=0,pos=0,parts=[];for(let i=0;i<group.length;i++){if(group[i]==='(')depth++;if(group[i]===')')depth--;if(group[i]===','&&depth===0){parts.push(group.slice(pos,i));pos=i+1;}}parts.push(group.slice(pos));check(parts.length===columns.length,'INSERT_COLUMN_ARITY');return Object.fromEntries(parts.map((part,i)=>{const n=(part.match(/\?/g)||[]).length;check(n<=1,'MULTI_PARAMETER_VALUE_REJECTED');return [columns[i].toUpperCase(),n?params[offset++]:part.trim()];}));});
 check(offset===params.length,'INSERT_PARAMETER_ARITY');return rows;
}
function guard(sql,params=[]){
 const normalized=normalizeSql(sql);check(!normalized.includes(';'),'MULTI_STATEMENT_REJECTED');
 const atomic=/^SELECT ULTIMO_NUMERO FROM FINAL TABLE \( UPDATE JAVIER\.TEST_PEDIDOS_SEQ SET ULTIMO_NUMERO = ULTIMO_NUMERO \+ 1 WHERE EJERCICIO = \? \)$/i.test(normalized);
 const mutations=[...sql.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|LOCK\s+TABLE)\s+([A-Z0-9_".]+)/gi)];
 if(/^SELECT\b|^WITH\b/i.test(normalized)&&mutations.length===0){check(!/\b(CALL|GRANT|REVOKE|RENAME|CREATE|ALTER|DROP|TRUNCATE|LABEL|COMMENT)\b/i.test(normalized),'READ_SQL_VERB_REJECTED');return;}
 if(normalized==='SET TRANSACTION ISOLATION LEVEL READ COMMITTED')return;
 check(atomic||/^(?:INSERT INTO|UPDATE|DELETE FROM|LOCK TABLE)\b/i.test(normalized),'UNKNOWN_SQL_REJECTED');
 check(mutations.length===1,'SQL_MUTATION_COUNT_REJECTED');
 for(const m of mutations){
  const t=m[2].replace(/"/g,'').toUpperCase(),isLock=/^LOCK/i.test(m[1]);
  check((isLock?lockTargets:writeTargets).has(t),'UNAPPROVED_TARGET');
  check(!/^DELETE/i.test(m[1])||t==='JAVIER.TEST_PEDIDOS_STOCK_RESERVE','PHYSICAL_TRACE_DELETE_REJECTED');
  if(isLock){check(new RegExp('^LOCK TABLE '+t.replace(/\./g,'\\.')+' IN EXCLUSIVE MODE$','i').test(normalized),'LOCK_SHAPE_REJECTED');}
  else if(/^INSERT/i.test(m[1])){
   for(const row of insertRows(sql,params)){
    if(t==='JAVIER.TEST_PEDIDOS_CAB')check(activeFixture&&trim(row.OBSERVACIONES)===activeFixture.input.observaciones&&trim(row.CODIGOCLIENTE)==='4300032160'&&trim(row.CODIGOVENDEDOR)==='35','HEADER_OWNERSHIP_REJECTED');
    else if(t==='JAVIER.TEST_BOLSA_COMERCIAL')check(setupConnection&&trim(row.CODIGOVENDEDOR)==='35'&&Number(row.EJERCICIO)===new Date().getFullYear()&&Number(row.MES)===new Date().getMonth()+1,'MONTHLY_OWNERSHIP_REJECTED');
    else if(t==='JAVIER.TEST_PEDIDOS_SEQ')fail('SEQUENCE_INSERT_NOT_REQUIRED');
    else check(activeFixture&&owned.has(Number(row.PEDIDO_ID))&&Number(row.PEDIDO_ID)===activeFixture.id,'CHILD_OWNERSHIP_REJECTED');
    if(t==='JAVIER.TEST_MOVIMIENTOS_BOLSA')check(Number(row.BOLSA_ID)===bagId,'MOVEMENT_BAG_OWNERSHIP_REJECTED');
    if(t==='JAVIER.TEST_PEDIDO_IDEMPOTENCY')check(activeFixture&&trim(row.IDEMPOTENCY_KEY)===activeFixture.key,'IDEMPOTENCY_OWNERSHIP_REJECTED');
   }
  }else if(t==='JAVIER.TEST_PEDIDOS_SEQ')check(Number(whereParameter(sql,'EJERCICIO',params))===new Date().getFullYear()&&/SET ULTIMO_NUMERO = ULTIMO_NUMERO \+ 1 WHERE/i.test(normalized),'SEQUENCE_SCOPE_REJECTED');
  else if(t==='JAVIER.TEST_BOLSA_COMERCIAL')check(Number(whereParameter(sql,'ID',params))===bagId,'BAG_ROW_OWNERSHIP_REJECTED');
  else if(t==='JAVIER.TEST_PEDIDOS_CAB')check(activeFixture&&owned.has(Number(whereParameter(sql,'ID',params)))&&Number(whereParameter(sql,'ID',params))===activeFixture.id,'HEADER_ROW_OWNERSHIP_REJECTED');
  else if(t==='JAVIER.TEST_PEDIDOS_STOCK_RESERVE')check(activeFixture&&owned.has(Number(whereParameter(sql,'PEDIDO_ID',params)))&&Number(whereParameter(sql,'PEDIDO_ID',params))===activeFixture.id,'RESERVATION_OWNERSHIP_REJECTED');
  else if(t==='JAVIER.TEST_PEDIDOS_LIN'){
   if(/\bWHERE\b[\s\S]*\bPEDIDO_ID\s*=\s*\?/i.test(sql))check(Number(whereParameter(sql,'PEDIDO_ID',params))===activeFixture?.id,'LINE_PARENT_OWNERSHIP_REJECTED');
   else check((activeFixture?.lineIds||[]).includes(Number(whereParameter(sql,'ID',params))),'LINE_ID_OWNERSHIP_REJECTED');
  }
  else fail('UNREVIEWED_MUTATION_REJECTED');
  writes.add(m[1].toUpperCase()+' '+t);
 }
}
const purgeSql="SELECT C.ID FROM JAVIER.TEST_PEDIDOS_CAB C WHERE TRIM(C.ESTADO) IN ('BORRADOR', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION') AND C.CREATED_AT <= CURRENT TIMESTAMP - 24 HOURS ORDER BY C.CREATED_AT ASC FETCH FIRST 25 ROWS ONLY";
const purgeTemplates=[...bundle['services/pedidos/index.js'].matchAll(/`(SELECT C\.ID\s+FROM \$\{PEDIDOS_CAB_TABLE\} C[\s\S]*?FETCH FIRST \$\{maxRows\} ROWS ONLY)`/g)];
check(purgeTemplates.length===1,'PURGE_SOURCE_NOT_UNIQUE');
check(normalizeSql(purgeTemplates[0][1].replace('${PEDIDOS_CAB_TABLE}','JAVIER.TEST_PEDIDOS_CAB').replace('${PURGEABLE_DRAFT_STATES_SQL}',"'BORRADOR', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION'").replace('${DRAFT_STOCK_RESERVATION_HOURS}','24').replace('${maxRows}','25'))===purgeSql,'PURGE_SOURCE_DRIFT');
const capturedPricing={};
function invariantRows(table,rows){return rows.filter(row=>table==='TEST_PEDIDOS_CAB'?!owned.has(Number(row.ID)):['TEST_PEDIDOS_LIN','TEST_PEDIDOS_STOCK_RESERVE','TEST_PEDIDO_IDEMPOTENCY','TEST_MOVIMIENTOS_BOLSA','TEST_PEDIDO_STATE_EVENTS'].includes(table)?!owned.has(Number(row.PEDIDO_ID)):table==='TEST_PEDIDOS_SEQ'?Number(row.EJERCICIO)!==new Date().getFullYear():table==='TEST_BOLSA_COMERCIAL'?Number(row.ID)!==bagId:true).map(row=>encode(row)).sort();}
function fixed(value,scale=4){const text=String(value??'0');check(/^-?\d+(?:\.\d+)?$/.test(text),'DECIMAL_FORMAT_INVALID');const negative=text.startsWith('-'),[whole,fraction='']=text.replace(/^-/,'').split('.');check(fraction.length<=scale||/^0*$/.test(fraction.slice(scale)),'DECIMAL_PRECISION_EXCEEDED');const n=BigInt(whole+fraction.slice(0,scale).padEnd(scale,'0'));return negative?-n:n;}
function rounded(n,d){return n>=0n?(n+d/2n)/d:-((-n+d/2n)/d);}
function assertEconomics(header,line,record){
 const expected=record.expected;if(!expected)return;
 check(fixed(line.PRECIOVENTA)===BigInt(expected.price4)&&fixed(line.PRECIOTARIFACLIENTE)===BigInt(expected.reference4)&&fixed(line.PRECIOCOSTO)===BigInt(expected.cost4),'PERSISTED_UNIT_PRICE_OR_COST_MISMATCH');
 check(fixed(line.DESCUENTO_LINEA,2)===0n&&fixed(header.DESCUENTO_GLOBAL,2)===BigInt(record.input.descuentoGlobal*100),'PERSISTED_DISCOUNT_MISMATCH');
 check(fixed(line.IMPORTEVENTA,2)===BigInt(expected.lineCents)&&fixed(line.IMPORTECOSTO,2)===BigInt(expected.costCents),'PERSISTED_LINE_AMOUNT_MISMATCH');
 check(fixed(header.IMPORTEBASE,2)===BigInt(expected.baseCents)&&fixed(header.IMPORTEIVA,2)===BigInt(expected.ivaCents)&&fixed(header.IMPORTETOTAL,2)===BigInt(expected.totalCents),'PERSISTED_HEADER_TOTAL_MISMATCH');
}
function assertPhaseEffects(before,after){
 const year=new Date().getFullYear(),b=before.TEST_PEDIDOS_SEQ.find(r=>Number(r.EJERCICIO)===year),a=after.TEST_PEDIDOS_SEQ.find(r=>Number(r.EJERCICIO)===year);
 check(a&&b&&Number(a.ULTIMO_NUMERO)-Number(b.ULTIMO_NUMERO)===(phase.endsWith(':CREATE')?1:0),'PHASE_SEQUENCE_DELTA_INVALID');
 const prior=new Set(before.TEST_MOVIMIENTOS_BOLSA.map(m=>Number(m.ID))),added=after.TEST_MOVIMIENTOS_BOLSA.filter(m=>!prior.has(Number(m.ID)));
 if(phase.endsWith(':CREATE'))check(added.length===0&&hash(before.TEST_BOLSA_COMERCIAL)===hash(after.TEST_BOLSA_COMERCIAL),'DRAFT_BAG_EFFECT_REJECTED');
 if(phase.endsWith(':CANCEL')||phase.startsWith('COMPENSATION:')){
  const origins=before.TEST_MOVIMIENTOS_BOLSA.filter(m=>Number(m.PEDIDO_ID)===activeFixture.id&&['CONSUMO','ACUMULACION','REGISTRO'].includes(trim(m.TIPO)));
  check(added.length===origins.length&&added.every(m=>trim(m.TIPO).startsWith('REVERSO_')),'CANCEL_UNEXPECTED_BAG_EFFECT');
  for(const origin of origins)check(added.filter(m=>trim(m.IDEMPOTENCY_KEY)===`pedido-${activeFixture.id}-movement-${Number(origin.ID)}-reverse`&&trim(m.TIPO)==='REVERSO_'+trim(origin.TIPO)&&fixed(m.IMPORTE,2)===fixed(origin.IMPORTE,2)).length===1,'CANCEL_REVERSAL_BEFORE_COMMIT');
 }
}
const auditColumnContract=[
 ['ID','BIGINT',8,18,0,'N','YES','ALWAYS',null],['PEDIDO_ID','INTEGER',4,9,0,'N','NO',null,null],
 ['FROM_STATE','VARCHAR',24,null,null,'Y','NO',null,null],['TO_STATE','VARCHAR',24,null,null,'N','NO',null,null],
 ['ACTOR_ID','VARCHAR',80,null,null,'N','NO',null,null],['ACTOR_ROLE','VARCHAR',32,null,null,'Y','NO',null,null],
 ['DEVICE_ID','VARCHAR',128,null,null,'Y','NO',null,null],['REASON','VARCHAR',500,null,null,'Y','NO',null,null],
 ['IDEMPOTENCY_KEY','VARCHAR',128,null,null,'N','NO',null,null],['PAYLOAD_JSON','CLOB',262144,null,null,'N','NO',null,null],
 ['PAYLOAD_HASH','CHAR',64,null,null,'N','NO',null,null],['ORIGINAL_CLIENT_AT','TIMESTMP',10,null,null,'Y','NO',null,null],
 ['SERVER_OCCURRED_AT','TIMESTMP',10,null,null,'N','NO',null,'CURRENT_TIMESTAMP'],
];
function assertAuditColumns(rows){const actual=rows.map((r,i)=>{check(Number(r.ORDINAL_POSITION)===i+1,'AUDIT_COLUMN_ORDER_INVALID');return [trim(r.COLUMN_NAME),trim(r.DATA_TYPE),Number(r.LENGTH),r.NUMERIC_PRECISION==null?null:Number(r.NUMERIC_PRECISION),r.NUMERIC_SCALE==null?null:Number(r.NUMERIC_SCALE),trim(r.IS_NULLABLE),trim(r.IS_IDENTITY),r.IDENTITY_GENERATION==null?null:trim(r.IDENTITY_GENERATION),r.COLUMN_DEFAULT==null?null:trim(r.COLUMN_DEFAULT)];});check(hash(actual)===hash(auditColumnContract),'AUDIT_EXACT_COLUMN_CONTRACT_INVALID');}
function assertConstraints(rows,required){for(const [name,type,columns] of required){const found=rows.filter(r=>trim(r.CONSTRAINT_NAME)===name).sort((a,b)=>Number(a.ORDINAL_POSITION)-Number(b.ORDINAL_POSITION));check(found.length===columns.length&&found.every((r,i)=>trim(r.CONSTRAINT_TYPE)===type&&trim(r.COLUMN_NAME)===columns[i]&&Number(r.ORDINAL_POSITION)===i+1),'EXACT_CONSTRAINT_CONTRACT_INVALID');}}
const auditCheckContract={
 CK_TEST_PED_STATE_FROM:"FROM_STATE IS NULL OR FROM_STATE IN ('BORRADOR','CONFIRMANDO','CONFIRMADO','CANCELANDO','CANCELADO')",
 CK_TEST_PED_STATE_TO:"TO_STATE IN ('BORRADOR','CONFIRMANDO','CONFIRMADO','CANCELANDO','CANCELADO')",
 CK_TEST_PED_STATE_INITIAL:"FROM_STATE IS NOT NULL OR TO_STATE = 'BORRADOR'",
 CK_TEST_PED_STATE_CANCEL_REASON:"TO_STATE <> 'CANCELADO' OR LENGTH(TRIM(COALESCE(REASON,''))) > 0",
};
function assertAuditChecks(rows){const normalize=value=>trim(value).replace(/\s+/g,'').toUpperCase();check(rows.length===4,'AUDIT_CHECK_COUNT_INVALID');for(const [name,clause] of Object.entries(auditCheckContract)){const found=rows.filter(r=>trim(r.CONSTRAINT_NAME)===name);check(found.length===1&&normalize(found[0].CHECK_CLAUSE)===normalize(clause),'AUDIT_EXACT_CHECK_CONTRACT_INVALID');}}
function auditPricing(payload,record){
 if(!['ORDER_CREATED','ORDER_CONFIRMED'].includes(payload.event))return null;
 const created=payload.event==='ORDER_CREATED',lines=created?payload.lines:payload.after?.lines,header=created?payload.header:payload.after?.header;
 const line=(lines||[]).find(l=>trim(l.codigoArticulo??l.CODIGOARTICULO)==='3519');check(line&&header,'AUDIT_PRICING_LINE_MISSING');
 const source=trim(line.precioClienteSource??line.PRECIOCLIENTESOURCE),costSource=line.precioCostoSource??line.PRECIOCOSTOSOURCE;
 check(source===trim(record.expected.source),'AUDIT_PRICE_SOURCE_MISMATCH');
 check(fixed(line.precioVenta??line.PRECIOVENTA)===BigInt(record.expected.price4)&&fixed(line.precioTarifaCliente??line.PRECIOTARIFACLIENTE)===BigInt(record.expected.reference4)&&fixed(line.precioCosto??line.PRECIOCOSTO)===BigInt(record.expected.cost4),'AUDIT_PRICING_VALUE_MISMATCH');
 check(fixed(line.descuentoLinea??line.DESCUENTO_LINEA,2)===0n&&fixed(header.descuentoGlobal??header.DESCUENTO_GLOBAL,2)===BigInt(record.input.descuentoGlobal*100),'AUDIT_DISCOUNT_MISMATCH');
 if(!costSource){record.auditGaps=[...new Set([...(record.auditGaps||[]),'AUDIT_COST_PROVENANCE_MISSING'])];}
 else check(trim(costSource)===record.expected.costSource,'AUDIT_COST_SOURCE_MISMATCH');
 return {priceSource:source,price4:record.expected.price4,reference4:record.expected.reference4,discountPct:record.input.descuentoGlobal,cost4:record.expected.cost4,auditedCostSource:costSource==null?null:trim(costSource),missing:costSource?[]:['AUDIT_COST_PROVENANCE_MISSING']};
}
function assertBagTransaction(before,after,record){
 const b=before.TEST_BOLSA_COMERCIAL.find(r=>Number(r.ID)===bagId),a=after.TEST_BOLSA_COMERCIAL.find(r=>Number(r.ID)===bagId);check(b&&a,'BAG_MISSING_BEFORE_COMMIT');
 const stable=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['SALDO_DISPONIBLE','CONSUMIDO','ACUMULADO','UPDATED_AT'].includes(k)));check(hash(stable(b))===hash(stable(a)),'BAG_CONFIG_CHANGED_BEFORE_COMMIT');
 const previousIds=new Set(before.TEST_MOVIMIENTOS_BOLSA.map(r=>Number(r.ID))),added=after.TEST_MOVIMIENTOS_BOLSA.filter(r=>!previousIds.has(Number(r.ID))).sort((x,y)=>Number(x.ID)-Number(y.ID));
 let saldo=fixed(b.SALDO_DISPONIBLE,2),consumed=fixed(b.CONSUMIDO,2),accumulated=fixed(b.ACUMULADO,2);
 for(const m of added){check(Number(m.PEDIDO_ID)===record.id&&Number(m.BOLSA_ID)===bagId,'BAG_MOVEMENT_OWNER_BEFORE_COMMIT');const amount=fixed(m.IMPORTE,2),type=trim(m.TIPO);check(fixed(m.SALDO_ANTERIOR,2)===saldo,'BAG_CHAIN_BEFORE_COMMIT');
  if(type==='CONSUMO'){saldo-=amount;consumed+=amount;}else if(type==='ACUMULACION'){saldo+=amount;accumulated+=amount;}else if(type==='REVERSO_CONSUMO'){saldo+=amount;consumed-=amount;}else if(type==='REVERSO_ACUMULACION'){saldo-=amount;accumulated-=amount;}else check(['REGISTRO','REVERSO_REGISTRO'].includes(type)&&amount===0n,'BAG_MOVEMENT_TYPE_BEFORE_COMMIT');
  check(fixed(m.SALDO_POSTERIOR,2)===saldo,'BAG_CHAIN_AFTER_BEFORE_COMMIT');
 }
 check(saldo===fixed(a.SALDO_DISPONIBLE,2)&&consumed===fixed(a.CONSUMIDO,2)&&accumulated===fixed(a.ACUMULADO,2),'BAG_AGGREGATE_BEFORE_COMMIT');
 if(record.expectedBag&&phase.endsWith(':CONFIRM')){
  check(added.filter(m=>trim(m.TIPO)==='CONSUMO').reduce((v,m)=>v+fixed(m.IMPORTE,2),0n)===fixed(record.expectedBag.consumo,2),'BAG_EXPECTED_CONSUMPTION_BEFORE_COMMIT');
  const expected=record.expectedBag.lineMovements||[];for(const m of added.filter(x=>['CONSUMO','ACUMULACION'].includes(trim(x.TIPO)))){check(expected.some(e=>trim(e.tipo)===trim(m.TIPO)&&fixed(e.importe,2)===fixed(m.IMPORTE,2)&&trim(e.codigoArticulo)===trim(m.CODIGO_ARTICULO)&&Number(e.lineId)===Number(m.LINEA_ID)&&fixed(e.cantidad)===fixed(m.CANTIDAD)&&trim(e.unidadMedida)===trim(m.UNIDAD_MEDIDA)&&fixed(e.precioMinimoCongelado)===fixed(m.PRECIO_MINIMO_CONGELADO)&&fixed(e.precioVenta)===fixed(m.PRECIO_VENTA)),'BAG_MOVEMENT_DETAIL_BEFORE_COMMIT');}
 }
}
function read(sql,params=[]){
 if(setupConnection){guard(sql,params);evidence.monthlyFixture.sqlHashes.push(hash(sql));return setupConnection.query(sql,params);}
 check(/^\s*(SELECT|WITH)\b/i.test(sql)&&! /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|CALL)\b/i.test(sql),'WRITE_OUTSIDE_TRANSACTION');
 const normalized=normalizeSql(sql);
 if(/SELECT C\.ID FROM JAVIER\.TEST_PEDIDOS_CAB C/i.test(normalized)&&/CREATED_AT/i.test(normalized)&&/FETCH FIRST/i.test(normalized)){check(normalized===purgeSql&&params.length===0,'PURGE_SQL_DRIFT');purge.push({sqlHash:hash(sql),params,resultCount:0});return Promise.resolve([]);}
 guard(sql,params);
 const p=readSerial.then(async()=>{const rows=await observer.query(sql,params);if(/FROM JAVIER\.BOLSA_PRODUCTO_PRECIO\b/i.test(sql))capturedPricing.product=(rows||[]).find(r=>trim(r.CODIGOARTICULO)==='3519');if(/AS SOURCE/i.test(sql)){for(const r of rows||[])if(trim(r.CODIGOARTICULO)==='3519'&&r.SOURCE&&(!capturedPricing.client||trim(r.SOURCE)==='DSEDAC.PES'))capturedPricing.client=r;}return rows;});readSerial=p.catch(()=>{});return p;
}
const fakeDb={queryWithParams:read,query:sql=>read(sql),getPool:()=>pool,initDb:async()=>{}};
function load(relative){
 if(cache.has(relative))return cache.get(relative).exports;
 const filename=path.join(root,relative),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(relative,m);
 const native=Module.createRequire(filename);
 m.require=request=>{
  if(request==='odbc')return {...odbc,connect:async config=>{
  const c=await odbc.connect(config),q=c.query.bind(c);const receipt={physical:true,closed:false,queries:0,commitGuardPassed:false};connections.push(receipt);let txBefore;
   c.query=async(sql,params=[])=>{guard(sql,params);receipt.queries++;if(!txBefore&&/\b(?:INSERT INTO|UPDATE|DELETE FROM)\b/i.test(normalizeSql(sql))){txBefore={};for(const t of tables)txBefore[t]=await q('SELECT * FROM JAVIER.'+t);}
    const rows=await q(sql,params);if(/^INSERT INTO JAVIER\.TEST_PEDIDOS_CAB\b/i.test(normalizeSql(sql))){const h=await q('SELECT ID,OBSERVACIONES,CODIGOCLIENTE,CODIGOVENDEDOR FROM JAVIER.TEST_PEDIDOS_CAB WHERE OBSERVACIONES=?',[activeFixture.input.observaciones]);check(h.length===1&&trim(h[0].CODIGOCLIENTE)==='4300032160'&&trim(h[0].CODIGOVENDEDOR)==='35','INSERTED_HEADER_OWNERSHIP_UNVERIFIED');owned.add(Number(h[0].ID));activeFixture.id=Number(h[0].ID);}if(/^INSERT INTO JAVIER\.TEST_PEDIDOS_LIN\b/i.test(normalizeSql(sql)))activeFixture.lineIds=(await q('SELECT ID FROM JAVIER.TEST_PEDIDOS_LIN WHERE PEDIDO_ID=?',[activeFixture.id])).map(x=>Number(x.ID));return rows;};
   const commit=c.commit.bind(c);c.commit=async()=>{if(txBefore){const after={};for(const t of tables){after[t]=await q('SELECT * FROM JAVIER.'+t);check(hash(invariantRows(t,txBefore[t]))===hash(invariantRows(t,after[t])),'FOREIGN_DELTA_BEFORE_COMMIT');}
     if(activeFixture?.id){const header=after.TEST_PEDIDOS_CAB.find(r=>Number(r.ID)===activeFixture.id),lines=after.TEST_PEDIDOS_LIN.filter(r=>Number(r.PEDIDO_ID)===activeFixture.id);check(header&&lines.length===1,'OWNED_ROWS_MISSING_BEFORE_COMMIT');assertEconomics(header,lines[0],activeFixture);assertBagTransaction(txBefore,after,activeFixture);}
     assertPhaseEffects(txBefore,after);for(const e of after.TEST_PEDIDO_STATE_EVENTS.filter(e=>Number(e.PEDIDO_ID)===activeFixture?.id)){const json=String(e.PAYLOAD_JSON);check(hash(json)===trim(e.PAYLOAD_HASH),'AUDIT_HASH_BEFORE_COMMIT');auditPricing(JSON.parse(json),activeFixture);}
    }receipt.commitGuardPassed=true;await commit();};
   const close=c.close.bind(c);c.close=async()=>{await close();receipt.closed=true;};return c;
  }};
  const resolved=request.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),request)).replace(/\\/g,'/'):request;
  if(['config/db','config/db.js'].includes(resolved))return fakeDb;
  if(['middleware/logger','middleware/logger.js'].includes(resolved))return noLog;
  if(['services/redis-cache','services/redis-cache.js'].includes(resolved))return noRedis;
  if(['services/query-optimizer','services/query-optimizer.js'].includes(resolved))return noOptimizer;
  for(const candidate of [resolved,resolved+'.js',resolved+'/index.js'])if(Object.hasOwn(bundle,candidate))return load(candidate);
  check(!request.startsWith('.')&&!path.isAbsolute(request),'UNSEALED_LOCAL_DEPENDENCY');
  check(externalPackages.has(request),'UNREVIEWED_EXTERNAL_DEPENDENCY');return native(request);
 };
 if(relative.endsWith('.json'))m.exports=JSON.parse(bundle[relative]);else m._compile(bundle[relative],filename);return m.exports;
}
function money(r){return [Number(r.SALDO_DISPONIBLE),Number(r.CONSUMIDO),Number(r.ACUMULADO)];}
function idOf(o){return Number(o.header?.id??o.header?.ID??o.id);}
function verifyControlTableRouting(){
 const expected={stock:'JAVIER.TEST_PEDIDOS_STOCK_RESERVE',headers:'JAVIER.TEST_PEDIDOS_CAB',confirmations:'JAVIER.TEST_REPARTO_CONFIRMACIONES',evidences:'JAVIER.TEST_REPARTO_EVIDENCIAS',confirmationEvidences:'JAVIER.TEST_REPARTO_CONFIRM_EVIDENCIAS',repartidorCobros:'JAVIER.TEST_REPARTIDOR_COBROS',commercialCobros:'JAVIER.TEST_COBROS'};
 const actual=load('adapters/pedidos-local-order-state-guard.js').TABLES;
 check(encode(actual)===encode(expected),'RESOLVED_CONTROL_TABLE_ROUTING_UNSAFE');return actual;
}
if(process.env.ORDERS_LIFECYCLE_SELFTEST==='1'){
 const results=[];activeFixture={id:100001,key:'QAselftestkey123456789012',input:{observaciones:'QAselftest'}};owned.add(activeFixture.id);bagId=999999;
 function rejected(name,sql,params){let code;try{guard(sql,params);}catch(e){code=e.code;}check(code,'SELFTEST_UNSAFE_SQL_ACCEPTED');results.push({name,rejected:true,code});}
 rejected('production target','UPDATE DSEDAC.CPC SET A=? WHERE ID=?',[1,100001]);
 rejected('unknown verb','GRANT SELECT ON JAVIER.TEST_PEDIDOS_CAB TO PUBLIC',[]);
 rejected('multiple statements','UPDATE JAVIER.TEST_PEDIDOS_CAB SET ESTADO=? WHERE ID=?; DELETE FROM JAVIER.TEST_PEDIDOS_CAB',['CANCELADO',100001]);
 rejected('no ownership','UPDATE JAVIER.TEST_PEDIDOS_CAB SET ESTADO=?',['CANCELADO']);
 rejected('foreign owned id','UPDATE JAVIER.TEST_PEDIDOS_CAB SET ESTADO=? WHERE ID=?',['CANCELADO',100002]);
 rejected('delete audit','DELETE FROM JAVIER.TEST_PEDIDO_STATE_EVENTS WHERE PEDIDO_ID=?',[100001]);
 rejected('foreign bag','UPDATE JAVIER.TEST_BOLSA_COMERCIAL SET SALDO_DISPONIBLE=? WHERE ID=?',[0,999998]);
 rejected('foreign sequence year','UPDATE JAVIER.TEST_PEDIDOS_SEQ SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1 WHERE EJERCICIO = ?',[1999]);
 rejected('foreign child','INSERT INTO JAVIER.TEST_PEDIDOS_LIN (PEDIDO_ID,CODIGOARTICULO) VALUES (?,?)',[100002,'3519']);
 rejected('wrong header marker','INSERT INTO JAVIER.TEST_PEDIDOS_CAB (OBSERVACIONES,CODIGOCLIENTE,CODIGOVENDEDOR) VALUES (?,?,?)',['foreign','4300032160','35']);
 guard('UPDATE JAVIER.TEST_PEDIDOS_CAB SET ESTADO=? WHERE ID=?',['CANCELADO',100001]);results.push({name:'owned header accepted',accepted:true});
 guard('INSERT INTO JAVIER.TEST_PEDIDOS_LIN (PEDIDO_ID,CODIGOARTICULO) VALUES (?,?)',[100001,'3519']);results.push({name:'owned line accepted',accepted:true});
 let drift;try{read(purgeSql.replace('25 ROWS','26 ROWS'),[]);}catch(e){drift=e.code;}check(drift==='PURGE_SQL_DRIFT','SELFTEST_PURGE_DRIFT_NOT_REJECTED');results.push({name:'purge drift rejected before query',rejected:true,code:drift});
 check(fixed('49.572')===495720n&&rounded(275400n*10000n,1000000n)===2754n,'SELFTEST_DECIMAL_CONTRACT');results.push({name:'decimal arithmetic',accepted:true});
 const fakeBefore={TEST_PEDIDOS_SEQ:[{EJERCICIO:new Date().getFullYear(),ULTIMO_NUMERO:1}],TEST_MOVIMIENTOS_BOLSA:[],TEST_BOLSA_COMERCIAL:[]},fakeAfter={...fakeBefore,TEST_PEDIDOS_SEQ:[{EJERCICIO:new Date().getFullYear(),ULTIMO_NUMERO:2}]};
 phase='test:CONFIRM';let phaseError;try{assertPhaseEffects(fakeBefore,fakeAfter);}catch(e){phaseError=e.code;}check(phaseError==='PHASE_SEQUENCE_DELTA_INVALID','SELFTEST_CONFIRM_SEQUENCE_NOT_REJECTED');results.push({name:'sequence increment in confirm rejected',rejected:true});
 phase='test:CREATE';let draftError;try{assertPhaseEffects(fakeBefore,{...fakeAfter,TEST_MOVIMIENTOS_BOLSA:[{ID:1,TIPO:'REGISTRO'}]});}catch(e){draftError=e.code;}check(draftError==='DRAFT_BAG_EFFECT_REJECTED','SELFTEST_DRAFT_BAG_NOT_REJECTED');results.push({name:'bag movement in draft rejected',rejected:true});
 let keyError;try{assertConstraints([{CONSTRAINT_NAME:'UQ',CONSTRAINT_TYPE:'UNIQUE',COLUMN_NAME:'WRONG',ORDINAL_POSITION:1}],[['UQ','UNIQUE',['IDEMPOTENCY_KEY']]]);}catch(e){keyError=e.code;}check(keyError==='EXACT_CONSTRAINT_CONTRACT_INVALID','SELFTEST_WRONG_UQ_NOT_REJECTED');results.push({name:'wrong unique columns rejected',rejected:true});
 let checkError;try{assertAuditChecks(Object.entries(auditCheckContract).map(([CONSTRAINT_NAME,CHECK_CLAUSE])=>({CONSTRAINT_NAME,CHECK_CLAUSE:CHECK_CLAUSE+' OR 1=1'})));}catch(e){checkError=e.code;}check(checkError==='AUDIT_EXACT_CHECK_CONTRACT_INVALID','SELFTEST_PERMISSIVE_CHECK_NOT_REJECTED');results.push({name:'permissive named CHECK rejected',rejected:true});
 check(encode({id:9n,nested:[10n]})==='{"id":"9","nested":["10"]}'&&hash({id:9n})===hash({id:'9'}),'SELFTEST_BIGINT_SERIALIZATION');results.push({name:'native audit BigInt serialization and stable hash',accepted:true});
 process.env.APP_ENV='test';verifyControlTableRouting();results.push({name:'all control targets resolved before connection',accepted:true});
 emit(encode({mode:'SELFTEST',connected:false,tests:results.length,passed:true,results}));process.exit(0);
}
(async()=>{
 const profiles=load('config/app-profile.js'),operation=profiles.resolveAppProfile({APP_ENV:'test'});
 check(operation.valid,'TEST_PROFILE_INVALID');Object.assign(process.env,operation.assignments,{APP_ENV:'test'});
 const profile=profiles.applyAppProfile(process.env);check(profile.verified&&profile.profile==='test'&&profile.tableSet==='isolated_test'&&!profile.erpExportEnabled&&!profile.productionWritesEnabled,'ISOLATED_PROFILE_REQUIRED');evidence.profile=profiles.sanitizeAppProfile(profile);
 evidence.resolvedControlTables=verifyControlTableRouting();
 const cs=`DSN=${process.env.ODBC_DSN||'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
 observer=await odbc.connect(cs);pool=await odbc.pool({connectionString:cs,initialSize:1,maxSize:2});
 const dbPath=require.resolve('./config/db'),dbModule=new Module(dbPath,module);dbModule.filename=dbPath;dbModule.exports=fakeDb;require.cache[dbPath]=dbModule;
 try{
  phase='CATALOG';evidence.catalog={};
  for(const t of [...tables,'TEST_PRECIO_COMPETITIVO',...[...lockTargets].map(t=>t.split('.')[1]).filter(t=>!tables.includes(t))]){
   const cols=await read('SELECT COLUMN_NAME,DATA_TYPE,LENGTH,NUMERIC_PRECISION,NUMERIC_SCALE,IS_NULLABLE,IS_IDENTITY,IDENTITY_GENERATION,COLUMN_DEFAULT,ORDINAL_POSITION FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',['JAVIER',t]);check(cols.length>0,'TEST_TABLE_NOT_FOUND');
   const physical=await read('SELECT SYSTEM_TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',['JAVIER',t]);check(physical.length===1,'TEST_TABLE_AMBIGUOUS');
   const journal=await read("SELECT JOURNALED,JOURNAL_LIBRARY,JOURNAL_NAME,JOURNAL_IMAGES FROM TABLE(QSYS2.OBJECT_STATISTICS('JAVIER','*FILE')) X WHERE OBJNAME=?",[trim(physical[0].SYSTEM_TABLE_NAME)]);
   check(journal.length===1&&trim(journal[0].JOURNALED)==='YES'&&trim(journal[0].JOURNAL_LIBRARY)==='JAVIER'&&trim(journal[0].JOURNAL_NAME)==='QSQJRN'&&trim(journal[0].JOURNAL_IMAGES)==='*BOTH','JOURNAL_UNVERIFIED');
   evidence.catalog[t]={columns:cols,journal};
  }
  assertAuditColumns(evidence.catalog.TEST_PEDIDO_STATE_EVENTS.columns);
  for(const [t,required] of [['TEST_PEDIDO_STATE_EVENTS',[['PK_TEST_PED_STATE_EVENTS','PRIMARY KEY',['ID']],['UQ_TEST_PED_STATE_EVT_IDEMP','UNIQUE',['IDEMPOTENCY_KEY']]]],['TEST_MOVIMIENTOS_BOLSA',[['UQ_TEST_MOV_BOLSA_IDEMP','UNIQUE',['IDEMPOTENCY_KEY']]]],['TEST_BOLSA_COMERCIAL',[['UQ_TEST_BOLSA_VND_MES','UNIQUE',['CODIGOVENDEDOR','EJERCICIO','MES']]]]]){
   const constraints=await read("SELECT C.CONSTRAINT_NAME,C.CONSTRAINT_TYPE,K.COLUMN_NAME,K.ORDINAL_POSITION FROM QSYS2.SYSCST C JOIN QSYS2.SYSKEYCST K ON K.CONSTRAINT_SCHEMA=C.CONSTRAINT_SCHEMA AND K.CONSTRAINT_NAME=C.CONSTRAINT_NAME AND K.TABLE_SCHEMA=C.TABLE_SCHEMA AND K.TABLE_NAME=C.TABLE_NAME WHERE C.TABLE_SCHEMA=? AND C.TABLE_NAME=? AND C.CONSTRAINT_TYPE IN ('PRIMARY KEY','UNIQUE') ORDER BY C.CONSTRAINT_NAME,K.ORDINAL_POSITION",['JAVIER',t]);assertConstraints(constraints,required);evidence.catalog[t].constraints=constraints;
  }
  const checks=await read("SELECT C.CONSTRAINT_NAME,H.CHECK_CLAUSE FROM QSYS2.SYSCST C JOIN QSYS2.SYSCHKCST H ON H.CONSTRAINT_SCHEMA=C.CONSTRAINT_SCHEMA AND H.CONSTRAINT_NAME=C.CONSTRAINT_NAME WHERE C.TABLE_SCHEMA=? AND C.TABLE_NAME=? AND C.CONSTRAINT_TYPE='CHECK'",['JAVIER','TEST_PEDIDO_STATE_EVENTS']);assertAuditChecks(checks);evidence.catalog.TEST_PEDIDO_STATE_EVENTS.checks=checks;
  const indexKeys=await read('SELECT K.INDEX_NAME,K.COLUMN_NAME,K.ORDINAL_POSITION,I.IS_UNIQUE FROM QSYS2.SYSKEYS K JOIN QSYS2.SYSINDEXES I ON I.INDEX_SCHEMA=K.INDEX_SCHEMA AND I.INDEX_NAME=K.INDEX_NAME WHERE I.TABLE_SCHEMA=? AND I.TABLE_NAME=? AND K.INDEX_SCHEMA=? ORDER BY K.INDEX_NAME,K.ORDINAL_POSITION',['JAVIER','TEST_PEDIDO_STATE_EVENTS','JAVIER']);check(encode(indexKeys.filter(k=>trim(k.INDEX_NAME)==='IX_TEST_PED_STATE_EVENT_ORDER').map(k=>trim(k.COLUMN_NAME)))===encode(['PEDIDO_ID','SERVER_OCCURRED_AT']),'AUDIT_TIME_INDEX_ABSENT');evidence.catalog.TEST_PEDIDO_STATE_EVENTS.indexKeys=indexKeys;
  service=load('services/pedidos/index.js');const bolsa=load('services/bolsa-comercial.service.js');check(!service.getPedidosConfirmationTarget().shouldExportToSystem,'ERP_EXPORT_REJECTED');
  const ref=await read('SELECT L.* FROM JAVIER.TEST_PEDIDOS_LIN L JOIN JAVIER.TEST_PEDIDOS_CAB C ON C.ID=L.PEDIDO_ID WHERE L.ID=? AND L.PEDIDO_ID=? AND TRIM(C.CODIGOCLIENTE)=? AND TRIM(C.CODIGOVENDEDOR)=?',[121,106,'4300032160','35']);check(ref.length===1&&trim(ref[0].CODIGOARTICULO)==='3519','REAL_REFERENCE_CHANGED');
  phase='REAL_PRICE';const products=await service.getProducts({search:'3519',clientCode:'4300032160',limit:50,offset:0,includeIva:false});const product=products.find(p=>p.code==='3519');check(product&&Number(product.precioTarifaCliente)>0&&Number(product.codigoTarifaCliente)===1,'REAL_PRICE_UNAVAILABLE');evidence.realProduct=product;
  const competitive=await read('SELECT * FROM JAVIER.TEST_PRECIO_COMPETITIVO WHERE TRIM(CODIGOCLIENTE)=? AND TRIM(CODIGOARTICULO)=? AND VALIDO_DESDE<=CURRENT DATE AND (VALIDO_HASTA IS NULL OR VALIDO_HASTA>=CURRENT DATE) ORDER BY VALIDO_DESDE DESC,ID DESC',['4300032160','3519']);check(competitive.length===1&&fixed(competitive[0].PRECIO_COMPETITIVO)===fixed(ref[0].PRECIOVENTA),'REAL_COMPETITIVE_REFERENCE_CHANGED');evidence.realCompetitiveReference=competitive;
  const r=ref[0],now=new Date(),year=now.getFullYear(),month=now.getMonth()+1;
  const monthlySql='SELECT * FROM JAVIER.TEST_BOLSA_COMERCIAL WHERE TRIM(CODIGOVENDEDOR)=? AND EJERCICIO=? AND MES=? ORDER BY ID';
  let monthly=await read(monthlySql,['35',year,month]);check(monthly.length<=1,'MONTHLY_BAG_DUPLICATE');evidence.monthlyBeforeInitialization=monthly;
  evidence.monthlyFixture={owner:'35',year,month,existedBefore:monthly.length===1,source:'SOURCE_COMMIT services/bolsa-comercial.service.js getOrCreateBolsa',sqlHashes:[],retainedIfCreated:true};
  if(!monthly.length){
   phase='CANONICAL_MONTHLY_INITIALIZATION';const c=await odbc.connect(cs);try{await c.beginTransaction();await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.query('LOCK TABLE JAVIER.TEST_BOLSA_COMERCIAL IN EXCLUSIVE MODE');
    const current=await c.query(monthlySql,['35',year,month]);check(current.length===0,'MONTHLY_BAG_CHANGED');const before={};for(const t of tables)before[t]=await c.query('SELECT * FROM JAVIER.'+t);
    setupConnection=c;const initialized=await bolsa.getOrCreateBolsa('35',year,month);setupConnection=null;bagId=Number(initialized.id);check(Number.isInteger(bagId)&&bagId>0,'CANONICAL_MONTHLY_ID_INVALID');
    const after={};for(const t of tables){after[t]=await c.query('SELECT * FROM JAVIER.'+t);check(hash(invariantRows(t,before[t]))===hash(invariantRows(t,after[t])),'MONTHLY_FOREIGN_DELTA_BEFORE_COMMIT');}
    const added=after.TEST_BOLSA_COMERCIAL.filter(x=>Number(x.ID)===bagId);check(added.length===1&&before.TEST_BOLSA_COMERCIAL.every(x=>Number(x.ID)!==bagId),'MONTHLY_CREATED_ROW_NOT_UNIQUE');evidence.monthlyFixture.createdRow=added[0];await c.commit();evidence.monthlyFixture.commitGuardPassed=true;
   }catch(e){setupConnection=null;await c.rollback();throw e;}finally{setupConnection=null;await c.close();}monthly=await read(monthlySql,['35',year,month]);
  }
  check(monthly.length===1,'MONTHLY_BAG_UNAVAILABLE');bagId=Number(monthly[0].ID);evidence.monthlyBaseline=monthly;
  const fullBefore={};for(const t of tables)fullBefore[t]=await read('SELECT * FROM JAVIER.'+t);
  const seqBefore=fullBefore.TEST_PEDIDOS_SEQ.find(x=>Number(x.EJERCICIO)===year);check(seqBefore&&Number.isInteger(Number(seqBefore.ULTIMO_NUMERO)),'SEQUENCE_UNAVAILABLE');
  async function snapshot(id){
   const [header,lines,reserve,movements,events,bagRows,idempotency,sequence]=await Promise.all([
    read('SELECT * FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=?',[id]),read('SELECT * FROM JAVIER.TEST_PEDIDOS_LIN WHERE PEDIDO_ID=? ORDER BY ID',[id]),read('SELECT * FROM JAVIER.TEST_PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID=? ORDER BY CODIGOARTICULO',[id]),read('SELECT * FROM JAVIER.TEST_MOVIMIENTOS_BOLSA WHERE PEDIDO_ID=? ORDER BY ID',[id]),
    read('SELECT ID,FROM_STATE,TO_STATE,ACTOR_ID,ACTOR_ROLE,DEVICE_ID,REASON,IDEMPOTENCY_KEY,PAYLOAD_JSON,PAYLOAD_HASH,CHAR(ORIGINAL_CLIENT_AT) AS ORIGINAL_CLIENT_AT,CHAR(SERVER_OCCURRED_AT) AS SERVER_OCCURRED_AT FROM JAVIER.TEST_PEDIDO_STATE_EVENTS WHERE PEDIDO_ID=? ORDER BY SERVER_OCCURRED_AT,ID',[id]),read(monthlySql,['35',year,month]),read('SELECT * FROM JAVIER.TEST_PEDIDO_IDEMPOTENCY WHERE PEDIDO_ID=? ORDER BY IDEMPOTENCY_KEY',[id]),read('SELECT * FROM JAVIER.TEST_PEDIDOS_SEQ WHERE EJERCICIO=?',[year])]);
   function sensitive(value){if(!value||typeof value!=='object')return false;return Object.entries(value).some(([k,v])=>/(authorization|cookie|password|passwd|secret|token|jwt|credential)/i.test(k)||sensitive(v));}
   for(const e of events){const json=typeof e.PAYLOAD_JSON==='string'?e.PAYLOAD_JSON:String(e.PAYLOAD_JSON);check(hash(json)===trim(e.PAYLOAD_HASH),'AUDIT_CLOB_HASH_MISMATCH');const payload=JSON.parse(json);check(!sensitive(payload),'AUDIT_SENSITIVE_KEY_REJECTED');check(trim(e.ACTOR_ID)==='35'&&trim(e.ACTOR_ROLE)==='COMERCIAL'&&trim(e.DEVICE_ID)==='QA-LIFECYCLE-TEST','AUDIT_ACTOR_DEVICE_MISMATCH');check(trim(e.SERVER_OCCURRED_AT).length>18,'AUDIT_SERVER_TIMESTAMP_MISSING');}
   return {header,lines,reserve,movements,events,idempotency,sequence,bag:bagRows,stock:Object.fromEntries(await service.getStockBatch(['3519']))};
  }
  function present(s){return {...s,events:s.events.map(({PAYLOAD_JSON,...e})=>{const payload=JSON.parse(String(PAYLOAD_JSON));return {...e,payloadBytes:Buffer.byteLength(String(PAYLOAD_JSON)),payloadHashVerified:true,payloadEvent:payload.event,pricingProvenance:auditPricing(payload,activeFixture)};})};}
  for(const [logical,discount] of [['reference',0],['discount',5]]){
   phase=logical+':BEFORE';const key=crypto.createHash('sha256').update(marker+'|'+logical).digest('hex').slice(0,24),original=new Date(Date.now()-3600000).toISOString(),record={logical,key,originalClientAt:original};evidence.fixtures.push(record);
   check((await read('SELECT ID FROM JAVIER.TEST_PEDIDOS_CAB WHERE OBSERVACIONES=?',[marker+logical])).length===0&&(await read('SELECT PEDIDO_ID FROM JAVIER.TEST_PEDIDO_IDEMPOTENCY WHERE IDEMPOTENCY_KEY=?',[key])).length===0,'FIXTURE_COLLISION');
   const input={clientCode:'4300032160',vendedorCode:'35',userId:'35',userRole:'COMERCIAL',tipoventa:trim(r.TIPOVENTA)||'CC',observaciones:marker+logical,idempotencyKey:key,deviceId:'QA-LIFECYCLE-TEST',originalClientAt:original,descuentoGlobal:discount,lines:[{codigoArticulo:'3519',descripcion:trim(r.DESCRIPCION),cantidadEnvases:Number(r.CANTIDADENVASES),cantidadUnidades:Number(r.CANTIDADUNIDADES),unidadesCaja:Number(r.UNIDADESCAJA),unidadMedida:trim(r.UNIDADMEDIDA),precio:Number(product.precioTarifaCliente),precioTarifaCliente:Number(product.precioTarifaCliente)}]};
   check(input.lines[0].cantidadEnvases>0&&input.lines[0].cantidadUnidades>0&&input.lines[0].unidadesCaja>0&&input.lines[0].unidadMedida==='CAJAS','REFERENCE_QUANTITY_INVALID');record.input=input;activeFixture=record;
   const resolved=service._private.resolveAuthoritativeLinePricing({line:input.lines[0],articleCode:'3519',clientTariff:Number(product.precioTarifa1),serverMin:Number(product.precioMinimo),productPricing:capturedPricing.product,clientPrice:capturedPricing.client,userRole:'COMERCIAL'});check(fixed(resolved.referencePrice)===fixed(product.precioTarifaCliente)&&resolved.line.precioCostoVerificado===true,'AUTHORITATIVE_PRICING_NOT_CONFIRMED');
   check(trim(resolved.line.precioClienteSource)===trim(product.precioClienteSource)&&trim(resolved.line.precioCostoSource)!==''&&trim(resolved.line.precioCostoSource)===trim(product.precioMinimoSource),'CURRENT_PRICING_SOURCE_MISMATCH');
   const dateOnly=v=>v==null?null:(v instanceof Date?v.toISOString():String(v)).slice(0,10);check(product.precioCompetitivoSource==='JAVIER.TEST_PRECIO_COMPETITIVO'&&fixed(product.precioCompetitivo)===fixed(competitive[0].PRECIO_COMPETITIVO)&&fixed(product.margenCompetitivoPct,2)===fixed(competitive[0].MARGEN_PCT,2)&&dateOnly(product.precioCompetitivoValidoDesde)===dateOnly(competitive[0].VALIDO_DESDE)&&dateOnly(product.precioCompetitivoValidoHasta)===dateOnly(competitive[0].VALIDO_HASTA),'COMPETITIVE_PROVENANCE_MISMATCH');
   const price4=fixed(resolved.price),qty4=fixed(input.lines[0].cantidadEnvases),cost4=fixed(resolved.line.precioCosto),lineCents=rounded(price4*qty4,1000000n),costCents=rounded(cost4*qty4,1000000n),baseCents=rounded(lineCents*BigInt(100-discount),100n),ivaCents=rounded(baseCents*fixed(product.ivaRate),10000n);
   record.expected={price4:String(price4),reference4:String(fixed(resolved.referencePrice)),cost4:String(cost4),lineCents:String(lineCents),costCents:String(costCents),baseCents:String(baseCents),ivaCents:String(ivaCents),totalCents:String(baseCents+ivaCents),source:resolved.line.precioClienteSource,costSource:resolved.line.precioCostoSource};
   const stockBefore=Object.fromEntries(await service.getStockBatch(['3519']));record.stockBefore=stockBefore;
   phase=logical+':CREATE';let started=Date.now();const created=await service.createOrder(input);record.createMs=Date.now()-started;const id=idOf(created);check(Number.isInteger(id)&&id>0,'CREATE_ID_UNAVAILABLE');owned.add(id);record.id=id;
   let s=await snapshot(id);record.afterCreate=present(s);check(s.header.length===1&&trim(s.header[0].ESTADO)==='BORRADOR'&&s.lines.length===1&&s.reserve.length===1&&s.events.length===1&&s.idempotency.length===1,'CREATE_ROWS_INCOMPLETE');check(s.events[0].FROM_STATE===null&&trim(s.events[0].TO_STATE)==='BORRADOR','CREATE_EVENT_INVALID');assertEconomics(s.header[0],s.lines[0],record);
   function assertReservedStock(state){const before=stockBefore['3519'],after=state.stock['3519'],reservation=state.reserve[0];check(fixed(before.envases)-fixed(after.envases)===fixed(input.lines[0].cantidadEnvases)&&fixed(before.unidades)-fixed(after.unidades)===fixed(input.lines[0].cantidadUnidades)&&fixed(reservation.CANTIDADENVASES)===fixed(input.lines[0].cantidadEnvases)&&fixed(reservation.CANTIDADUNIDADES)===fixed(input.lines[0].cantidadUnidades),'STOCK_RESERVATION_DELTA_INVALID');}assertReservedStock(s);
   const expectedOriginal=original.replace('T',' ').replace('Z','')+'000';check(trim(s.events[0].ORIGINAL_CLIENT_AT).replace(/-/g,'').replace(/\./g,'').replace(/:/g,'').replace(/ /g,'')===expectedOriginal.replace(/-/g,'').replace(/\./g,'').replace(/:/g,'').replace(/ /g,''),'ORIGINAL_TIMESTAMP_CHANGED');
   const timestampDigits=value=>trim(value).replace(/[^0-9]/g,'');check(timestampDigits(s.events[0].ORIGINAL_CLIENT_AT)<=timestampDigits(s.events[0].SERVER_OCCURRED_AT),'ORIGINAL_AFTER_SERVER_FIELD');record.timestampComparison='stored TIMESTAMP fields; original UTC exact; server column does not encode timezone';
   phase=logical+':CREATE_REPLAY';const replay=await service.createOrder(input);check(idOf(replay)===id&&replay.idempotent===true,'CREATE_REPLAY_INVALID');check(hash(s)===hash(await snapshot(id)),'CREATE_REPLAY_CHANGED_ROWS');record.createReplayPassed=true;
   const expectedBag=await bolsa.validateOrderWithBolsa('35',s.lines,{globalDiscountPct:discount});check(expectedBag.valid,'EXPECTED_BAG_INVALID');record.expectedBag=expectedBag;if(discount===5)check(Number(expectedBag.consumo)>0,'DISCOUNT_MUST_CONSUME_BAG');
   phase=logical+':CONFIRM';started=Date.now();const confirmed=await service.confirmOrder(id,input.tipoventa,{userId:'35',userRole:'COMERCIAL',deviceId:'QA-LIFECYCLE-TEST',idempotencyKey:key+'C'});record.confirmMs=Date.now()-started;check(!confirmed.blocked,'CONFIRM_BLOCKED');s=await snapshot(id);record.afterConfirm=present(s);check(trim(s.header[0].ESTADO)==='CONFIRMADO'&&s.events.length===3&&s.movements.length>0&&s.reserve.length===1,'CONFIRM_ROWS_INCOMPLETE');assertEconomics(s.header[0],s.lines[0],record);assertReservedStock(s);
   check(s.movements.filter(m=>trim(m.TIPO)==='CONSUMO').reduce((v,m)=>v+fixed(m.IMPORTE,2),0n)===fixed(expectedBag.consumo,2)&&s.movements.filter(m=>trim(m.TIPO)==='ACUMULACION').reduce((v,m)=>v+fixed(m.IMPORTE,2),0n)===fixed(expectedBag.acumulacion,2),'BAG_EXPECTED_AMOUNT_MISMATCH');
   const origin=s.movements;check(origin.every(m=>Number(m.BOLSA_ID)===bagId),'MOVEMENT_WRONG_BAG');
   phase=logical+':CONFIRM_REPLAY';const cr=await service.confirmOrder(id,input.tipoventa,{userId:'35',userRole:'COMERCIAL',deviceId:'QA-LIFECYCLE-TEST',idempotencyKey:key+'C'});check(cr.idempotentReplay===true&&hash(s)===hash(await snapshot(id)),'CONFIRM_REPLAY_CHANGED_ROWS');record.confirmReplayPassed=true;
   phase=logical+':CANCEL';started=Date.now();const cancelled=await service.cancelOrder(id,{userId:'35',userRole:'COMERCIAL',deviceId:'QA-LIFECYCLE-TEST',reason:'Anulacion documentada de sonda QA TEST',idempotencyKey:key+'X'});record.cancelMs=Date.now()-started;check(cancelled.cancelled===true,'CANCEL_RESULT_INVALID');s=await snapshot(id);record.afterCancel=present(s);check(trim(s.header[0].ESTADO)==='CANCELADO'&&s.lines.length===1&&s.reserve.length===0&&s.events.length===5,'CANCEL_ROWS_INCOMPLETE');
   check(s.movements.length===origin.length*2&&s.movements.filter(m=>trim(m.TIPO).startsWith('REVERSO_')).length===origin.length,'BAG_REVERSAL_COUNT_INVALID');check(encode(money(s.bag[0]))===encode(money(monthly[0]))&&hash(s.stock)===hash(stockBefore),'STOCK_OR_BAG_NOT_RESTORED');
   for(const m of origin){const reversed=s.movements.filter(x=>trim(x.TIPO)==='REVERSO_'+trim(m.TIPO)&&trim(x.IDEMPOTENCY_KEY)===`pedido-${id}-movement-${Number(m.ID)}-reverse`);check(reversed.length===1&&Number(reversed[0].BOLSA_ID)===Number(m.BOLSA_ID)&&Number(reversed[0].PEDIDO_ID)===Number(m.PEDIDO_ID)&&Number(reversed[0].LINEA_ID)===Number(m.LINEA_ID)&&fixed(reversed[0].IMPORTE,2)===fixed(m.IMPORTE,2),'BAG_EXACT_REVERSAL_INVALID');}
   for(let i=1;i<s.movements.length;i++)check(fixed(s.movements[i].SALDO_ANTERIOR,2)===fixed(s.movements[i-1].SALDO_POSTERIOR,2),'BAG_BALANCE_CHAIN_INVALID');
   check(new Set(s.movements.map(m=>trim(m.IDEMPOTENCY_KEY))).size===s.movements.length&&new Set(s.events.map(e=>trim(e.IDEMPOTENCY_KEY))).size===5,'LEDGER_KEY_DUPLICATE');
   const expectedEvents=['ORDER_CREATED','ORDER_CONFIRMING','ORDER_CONFIRMED','ORDER_CANCELLING','ORDER_CANCELLED'];for(let i=0;i<s.events.length;i++){const e=s.events[i],payload=JSON.parse(e.PAYLOAD_JSON);check(payload.event===expectedEvents[i],'AUDIT_EVENT_PAYLOAD_INVALID');if(i>0)check(trim(e.SERVER_OCCURRED_AT)>=trim(s.events[i-1].SERVER_OCCURRED_AT),'AUDIT_SERVER_TIME_REVERSED');if(i>=3)check(trim(e.REASON)==='Anulacion documentada de sonda QA TEST','AUDIT_CANCELLATION_REASON_CHANGED');}
   check(encode(s.events.map(e=>[e.FROM_STATE===null?null:trim(e.FROM_STATE),trim(e.TO_STATE)]))===encode([[null,'BORRADOR'],['BORRADOR','CONFIRMANDO'],['CONFIRMANDO','CONFIRMADO'],['CONFIRMADO','CANCELANDO'],['CANCELANDO','CANCELADO']]),'AUDIT_TRANSITION_MATRIX_INVALID');
   phase=logical+':CANCEL_REPLAY';const xr=await service.cancelOrder(id,{userId:'35',userRole:'COMERCIAL',deviceId:'QA-LIFECYCLE-TEST',reason:'Anulacion documentada de sonda QA TEST',idempotencyKey:key+'X'});check(xr.idempotentReplay===true&&hash(s)===hash(await snapshot(id)),'CANCEL_REPLAY_CHANGED_ROWS');record.cancelReplayPassed=true;
  }
  phase='ISOLATION';evidence.isolation={};
  for(const record of evidence.fixtures){const final=await snapshot(record.id);check(trim(final.header[0].ESTADO)==='CANCELADO'&&final.lines.length===1&&final.reserve.length===0&&final.events.length===5,'FINAL_RETAINED_LIFECYCLE_INVALID');assertEconomics(final.header[0],final.lines[0],record);record.finalRetainedVerified=true;}
  function unrelated(t,rows){return rows.filter(row=>t==='TEST_PEDIDOS_CAB'?!owned.has(Number(row.ID)):['TEST_PEDIDOS_LIN','TEST_PEDIDOS_STOCK_RESERVE','TEST_PEDIDO_IDEMPOTENCY','TEST_MOVIMIENTOS_BOLSA','TEST_PEDIDO_STATE_EVENTS'].includes(t)?!owned.has(Number(row.PEDIDO_ID)):t==='TEST_PEDIDOS_SEQ'?Number(row.EJERCICIO)!==year:true).map(row=>t==='TEST_BOLSA_COMERCIAL'&&Number(row.ID)===bagId?{...row,UPDATED_AT:null}:row).map(row=>encode(row)).sort();}
  for(const t of tables){const after=await read('SELECT * FROM JAVIER.'+t);const b=hash(unrelated(t,fullBefore[t])),a=hash(unrelated(t,after));check(b===a,'UNRELATED_ROWS_CHANGED');evidence.isolation[t]={beforeHash:b,afterHash:a,passed:true};if(t==='TEST_PEDIDOS_SEQ'){const seq=after.find(x=>Number(x.EJERCICIO)===year);evidence.sequence={before:Number(seqBefore.ULTIMO_NUMERO),after:Number(seq.ULTIMO_NUMERO),rewound:false};check(evidence.sequence.after===evidence.sequence.before+2,'SEQUENCE_DELTA_INVALID');}}
  check(purge.length===4,'PURGE_INTERCEPT_COUNT_INVALID');check(connections.every(c=>c.closed),'PHYSICAL_CONNECTION_NOT_CLOSED');
  evidence.lifecycleIntegrityPassed=true;evidence.status='PARTIAL';evidence.passed=false;evidence.missingCapabilities=['AUDIT_COST_PROVENANCE_MISSING'];evidence.requirementStatus={STATE03:'BLOCKED'};process.exitCode=2;
 }catch(e){evidence.status='FAILED';evidence.lifecycleIntegrityPassed=false;evidence.passed=false;evidence.error={phase,...diagnostic(e)};process.exitCode=1;evidence.compensation=[];
  if(service){for(const record of evidence.fixtures.filter(x=>x.id)){phase='COMPENSATION:'+record.id;activeFixture=record;try{const rows=await read('SELECT ID,ESTADO,OBSERVACIONES FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=?',[record.id]);if(!rows.length)continue;check(trim(rows[0].OBSERVACIONES)===record.input.observaciones,'COMPENSATION_OWNERSHIP_REJECTED');if(trim(rows[0].ESTADO)!=='CANCELADO')await service.cancelOrder(record.id,{userId:'35',userRole:'COMERCIAL',deviceId:'QA-LIFECYCLE-TEST',reason:'Compensacion sonda QA TEST',idempotencyKey:record.key+'F'});const after=await read('SELECT ESTADO FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=?',[record.id]),reserve=await read('SELECT PEDIDO_ID FROM JAVIER.TEST_PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID=?',[record.id]),bag=await read('SELECT * FROM JAVIER.TEST_BOLSA_COMERCIAL WHERE ID=?',[bagId]);check(after.length===1&&trim(after[0].ESTADO)==='CANCELADO'&&reserve.length===0,'COMPENSATION_NOT_VERIFIED');check(bag.length===1&&hash(money(bag[0]))===hash(money(evidence.monthlyBaseline[0]))&&hash(Object.fromEntries(await service.getStockBatch(['3519'])))===hash(record.stockBefore),'COMPENSATION_STOCK_BAG_NOT_RESTORED');evidence.compensation.push({id:record.id,status:'CANCELADO',reservationRows:0,stockAndBagRestored:true});}catch(cleanup){evidence.compensation.push({id:record.id,status:'MANUAL_ACTION_REQUIRED',...diagnostic(cleanup)});}}}
 }
 finally{
  evidence.writeTargets=[...writes].sort();evidence.purgeIntercepts=purge;evidence.connections=connections;evidence.allocatedOrObservedOrderIds=[...owned];
  try{evidence.ownedOrderPostcheck=owned.size?await read(`SELECT ID,ESTADO,IMPORTETOTAL FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID IN (${[...owned].map(()=>'?').join(',')}) ORDER BY ID`,[...owned]):[];evidence.retainedOrderIds=evidence.ownedOrderPostcheck.map(row=>Number(row.ID));}
  catch(error){evidence.postcheckError=diagnostic(error);evidence.status='FAILED';evidence.passed=false;process.exitCode=1;}
  await observer.close();await pool.close();evidence.observerAndPoolClosedBeforeEmission=true;
  emit('ORDER_LIFECYCLE_STATE_PROBE='+encode(evidence));
 }
})().catch(e=>{emit(encode({success:false,phase,...diagnostic(e)}));process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
