[CmdletBinding()]
param([switch]$Run)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$eventSource=(& git -C $taskRoot show 'c9a99bd:backend/services/pedidos/order-state-events.js') -join "`n"
if($LASTEXITCODE -ne 0){throw 'Reviewed audit source unavailable.'}
if(-not $Run){[ordered]@{mode='DRY_RUN';connected=$false;orderId=112;marker='OTDstate2026110222f9c03be8reference';operation='BORRADOR to CANCELADO, release owned reservation, append two maintenance events';writes=@('JAVIER.TEST_PEDIDOS_CAB','JAVIER.TEST_PEDIDOS_STOCK_RESERVE','JAVIER.TEST_PEDIDO_STATE_EVENTS');physicalDeletes='owned stock reservation only';ddl=$false}|ConvertTo-Json;exit 0}
$event64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($eventSource))
$job=@'
'use strict';
require('./config/load-env').loadEnv(process.cwd());
const odbc=require('odbc'),Module=require('module'),crypto=require('crypto');
const encode=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:encode(value)).digest('hex');
const trim=value=>String(value??'').trim();
function check(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
function diagnostic(error){return {code:/^[A-Z][A-Z0-9_]{2,70}$/.test(error.code||'')?error.code:'COMPENSATION_NATIVE_FAILED',odbc:(error.odbcErrors||[]).map(x=>({state:/^[A-Z0-9]{5}$/.test(x.state)?x.state:null,code:Number.isFinite(Number(x.code))?Number(x.code):null}))};}
const id=112,marker='OTDstate2026110222f9c03be8reference',reason='Compensacion controlada de sonda STATE TEST; sin confirmacion ni impacto en bolsa';
const tables=['TEST_PEDIDOS_CAB','TEST_PEDIDOS_LIN','TEST_PEDIDOS_STOCK_RESERVE','TEST_PEDIDO_IDEMPOTENCY','TEST_PEDIDOS_SEQ','TEST_BOLSA_COMERCIAL','TEST_MOVIMIENTOS_BOLSA','TEST_PEDIDO_STATE_EVENTS'];
const guards=['TEST_REPARTO_CONFIRMACIONES','TEST_REPARTO_EVIDENCIAS','TEST_REPARTO_CONFIRM_EVIDENCIAS','TEST_REPARTIDOR_COBROS','TEST_COBROS'];
const evidence={operation:'owned TEST fixture compensation only; not a product cancellation PASS',orderId:id,marker,sourceCommit:'c9a99bd',sourceAuditSha256:null,phase:'SETUP',sequenceRewound:false,identityRewound:false};
const source=Buffer.from('EVENT_SOURCE','base64').toString('utf8');evidence.sourceAuditSha256=hash(source);
const auditModule=new Module(process.cwd()+'/services/pedidos/order-state-events.reviewed.js',module);
auditModule.filename=process.cwd()+'/services/pedidos/order-state-events.reviewed.js';
auditModule.require=request=>{if(request==='crypto')return crypto;check(request==='../../utils/db2-schemas','UNREVIEWED_AUDIT_DEPENDENCY');return {db2AppTable:name=>{check(name==='PEDIDOS_CAB','UNEXPECTED_AUDIT_TABLE_REQUEST');return 'JAVIER.TEST_PEDIDOS_CAB';}};};
auditModule._compile(source,auditModule.filename);const {appendOrderStateEvent}=auditModule.exports;
const snapshot=async connection=>{const result={};for(const table of tables)result[table]=await connection.query('SELECT * FROM JAVIER.'+table);return result;};
function foreignRows(table,rows){return rows.filter(row=>table==='TEST_PEDIDOS_CAB'?Number(row.ID)!==id:['TEST_PEDIDOS_STOCK_RESERVE','TEST_PEDIDO_STATE_EVENTS'].includes(table)?Number(row.PEDIDO_ID)!==id:true).map(row=>encode(row)).sort();}
const normalize=sql=>sql.replace(/\s+/g,' ').trim();
const auditRead='SELECT PAYLOAD_HASH, FROM_STATE, TO_STATE FROM JAVIER.TEST_PEDIDO_STATE_EVENTS WHERE IDEMPOTENCY_KEY = ?';
const auditInsert='INSERT INTO JAVIER.TEST_PEDIDO_STATE_EVENTS (PEDIDO_ID, FROM_STATE, TO_STATE, ACTOR_ID, ACTOR_ROLE, DEVICE_ID, REASON, IDEMPOTENCY_KEY, PAYLOAD_JSON, PAYLOAD_HASH, ORIGINAL_CLIENT_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
const eventKeys=['qa-compensation-112-20261102-start','qa-compensation-112-20261102-done'];
function assertExactLedger(events){
 check(events.length===3&&new Set(events.map(event=>String(event.ID))).size===3,'EXACT_LEDGER_COUNT_INVALID');
 const original=events.filter(event=>String(event.ID)==='9');check(original.length===1&&original[0].FROM_STATE===null&&trim(original[0].TO_STATE)==='BORRADOR'&&trim(original[0].ACTOR_ID)==='35'&&trim(original[0].ACTOR_ROLE)==='COMERCIAL'&&trim(original[0].DEVICE_ID)==='QA-LIFECYCLE-TEST'&&trim(original[0].IDEMPOTENCY_KEY)==='pedido-112-created-ab8bb12560b056566fd8ae5c'&&trim(original[0].PAYLOAD_HASH)==='2a2dfb4e79f57909ebc3a4d412cb9488d2eeaeaf23d018a520a2bc68de2fa6c4','ORIGINAL_LEDGER_EVENT_CHANGED');
 for(const event of events)check(hash(String(event.PAYLOAD_JSON))===trim(event.PAYLOAD_HASH),'EXACT_LEDGER_CLOB_HASH_INVALID');
 for(const [index,key] of eventKeys.entries()){
  const found=events.filter(event=>trim(event.IDEMPOTENCY_KEY)===key);check(found.length===1,'MAINTENANCE_LEDGER_KEY_INVALID');const event=found[0],payload=JSON.parse(String(event.PAYLOAD_JSON));
  check(trim(event.FROM_STATE)===(index===0?'BORRADOR':'CANCELANDO')&&trim(event.TO_STATE)===(index===0?'CANCELANDO':'CANCELADO')&&trim(event.ACTOR_ID)==='QA_COORDINATOR'&&trim(event.ACTOR_ROLE)==='SYSTEM_TEST'&&trim(event.DEVICE_ID)==='QA-MAINTENANCE'&&trim(event.REASON)===reason,'MAINTENANCE_LEDGER_METADATA_INVALID');
  check(payload.event===(index===0?'TEST_PROBE_COMPENSATION_STARTED':'TEST_PROBE_COMPENSATED')&&payload.marker===marker&&payload.originalEventHash===original[0].PAYLOAD_HASH&&Number(payload.before?.header?.ID)===id,'MAINTENANCE_LEDGER_PAYLOAD_INVALID');
 }
}
(async()=>{
 check(String(process.env.REPARTO_TABLE_SET).trim()==='isolated_test','ISOLATED_TEST_REQUIRED');
 const cs=`DSN=${process.env.ODBC_DSN||'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
 const connection=await odbc.connect(cs),observer=await odbc.connect(cs);let active=false;
 try{
  evidence.phase='CATALOG';
  for(const table of [...tables,...guards]){const metadata=await observer.query('SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',['JAVIER',table]);check(metadata.length>0,'REQUIRED_TEST_TABLE_ABSENT');}
  evidence.phase='LOCK';await connection.beginTransaction();active=true;await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  for(const table of ['TEST_PEDIDOS_STOCK_RESERVE','TEST_PEDIDOS_CAB',...guards])await connection.query('LOCK TABLE JAVIER.'+table+' IN EXCLUSIVE MODE');
  const before=await snapshot(connection),header=before.TEST_PEDIDOS_CAB.filter(row=>Number(row.ID)===id),lines=before.TEST_PEDIDOS_LIN.filter(row=>Number(row.PEDIDO_ID)===id),reserve=before.TEST_PEDIDOS_STOCK_RESERVE.filter(row=>Number(row.PEDIDO_ID)===id),events=before.TEST_PEDIDO_STATE_EVENTS.filter(row=>Number(row.PEDIDO_ID)===id);
  check(header.length===1&&trim(header[0].OBSERVACIONES)===marker&&trim(header[0].CODIGOCLIENTE)==='4300032160'&&trim(header[0].CODIGOVENDEDOR)==='35'&&Number(header[0].IMPORTETOTAL)===30.29,'EXACT_FIXTURE_OWNERSHIP_UNVERIFIED');
  check(lines.length===1&&Number(lines[0].ID)===128&&trim(lines[0].CODIGOARTICULO)==='3519'&&Number(lines[0].PRECIOVENTA)===27.54&&Number(lines[0].CANTIDADENVASES)===1&&Number(lines[0].CANTIDADUNIDADES)===1,'EXACT_FIXTURE_LINE_CHANGED');
  evidence.before={header,lines,reserve,events};
  if(trim(header[0].ESTADO)==='CANCELADO'){check(reserve.length===0,'REPLAY_NOT_VERIFIED');assertExactLedger(events);evidence.replay=true;await connection.rollback();active=false;evidence.passed=true;}
  else{
   check(trim(header[0].ESTADO)==='BORRADOR'&&reserve.length===1&&Number(reserve[0].ID)===84&&Number(reserve[0].CANTIDADENVASES)===1&&Number(reserve[0].CANTIDADUNIDADES)===1&&events.length===1&&String(events[0].ID)==='9'&&trim(events[0].PAYLOAD_HASH)==='2a2dfb4e79f57909ebc3a4d412cb9488d2eeaeaf23d018a520a2bc68de2fa6c4','FIXTURE_STATE_CHANGED');
   check(before.TEST_MOVIMIENTOS_BOLSA.every(row=>Number(row.PEDIDO_ID)!==id),'UNEXPECTED_BAG_IMPACT');
   const documentId='PED-112-4300032160',legacyReference=trim(header[0].SERIEPEDIDO)+'-'+Number(header[0].NUMEROPEDIDO),stableReference='PEDIDO:112:'+legacyReference;
   for(const table of ['TEST_REPARTO_CONFIRMACIONES','TEST_REPARTO_EVIDENCIAS'])check((await connection.query('SELECT ID FROM JAVIER.'+table+' WHERE DOCUMENT_ID=?',[documentId])).length===0,'DOWNSTREAM_ACTIVITY_PRESENT');
   check((await connection.query("SELECT ID FROM JAVIER.TEST_REPARTIDOR_COBROS WHERE UPPER(TRIM(COALESCE(PANTALLA_ORIGEN,'')))='RUTERO' AND LOCATE(?,UPPER(TRIM(COALESCE(OBSERVACIONES,''))))>0",[documentId])).length===0,'DRIVER_COLLECTION_PRESENT');
   check((await connection.query('SELECT ID FROM JAVIER.TEST_COBROS WHERE TRIM(CODIGO_CLIENTE)=? AND TRIM(REFERENCIA) IN (?,?,?)',['4300032160',stableReference,legacyReference,documentId])).length===0,'COMMERCIAL_COLLECTION_PRESENT');
   check((await connection.query('SELECT ID FROM JAVIER.TEST_PEDIDO_STATE_EVENTS WHERE IDEMPOTENCY_KEY IN (?,?)',eventKeys)).length===0,'COMPENSATION_KEY_COLLISION');
   const original=(await connection.query('SELECT CHAR(ORIGINAL_CLIENT_AT) AS ORIGINAL_AT FROM JAVIER.TEST_PEDIDO_STATE_EVENTS WHERE ID=?',[9]))[0].ORIGINAL_AT;
   const match=/^(\d{4}-\d{2}-\d{2})-(\d{2})\.(\d{2})\.(\d{2})\.(\d{6})$/.exec(trim(original));check(match,'ORIGINAL_TIMESTAMP_FORMAT_CHANGED');const originalIso=`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
   const queryAudit=async(sql,params)=>{const normalized=normalize(sql);check(normalized===auditRead||normalized===auditInsert,'UNREVIEWED_AUDIT_SQL');check(eventKeys.includes(params[normalized===auditRead?0:7]),'AUDIT_KEY_SCOPE_REJECTED');if(normalized===auditInsert)check(Number(params[0])===id&&params[3]==='QA_COORDINATOR'&&params[4]==='SYSTEM_TEST'&&params[5]==='QA-MAINTENANCE'&&params[6]===reason&&hash(params[8])===params[9],'AUDIT_PARAMETERS_REJECTED');return connection.query(sql,params);};
   evidence.phase='COMPENSATE';await connection.query("UPDATE JAVIER.TEST_PEDIDOS_CAB SET ESTADO='CANCELANDO',UPDATED_AT=CURRENT TIMESTAMP WHERE ID=? AND ESTADO='BORRADOR' AND OBSERVACIONES=?",[id,marker]);
   check(trim((await connection.query('SELECT ESTADO FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=?',[id]))[0].ESTADO)==='CANCELANDO','CLAIM_NOT_VERIFIED');
   const auditCommon={pedidoId:id,actorId:'QA_COORDINATOR',actorRole:'SYSTEM_TEST',deviceId:'QA-MAINTENANCE',reason,originalClientAt:originalIso};
   await appendOrderStateEvent(queryAudit,{...auditCommon,fromState:'BORRADOR',toState:'CANCELANDO',idempotencyKey:eventKeys[0],payload:{event:'TEST_PROBE_COMPENSATION_STARTED',marker,before:{header:header[0],lines,reservations:reserve},originalEventHash:events[0].PAYLOAD_HASH}});
   await connection.query('DELETE FROM JAVIER.TEST_PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID=? AND ID=?',[id,84]);
   await connection.query("UPDATE JAVIER.TEST_PEDIDOS_CAB SET ESTADO='CANCELADO',UPDATED_AT=CURRENT TIMESTAMP WHERE ID=? AND ESTADO='CANCELANDO' AND OBSERVACIONES=?",[id,marker]);
   const afterHeader=await connection.query('SELECT * FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=?',[id]);check(afterHeader.length===1&&trim(afterHeader[0].ESTADO)==='CANCELADO','CANCEL_NOT_VERIFIED');
   await appendOrderStateEvent(queryAudit,{...auditCommon,fromState:'CANCELANDO',toState:'CANCELADO',idempotencyKey:eventKeys[1],payload:{event:'TEST_PROBE_COMPENSATED',marker,before:{header:header[0],lines,reservations:reserve},after:{header:afterHeader[0],lines,reservations:[]},originalEventHash:events[0].PAYLOAD_HASH}});
   evidence.phase='PRECOMMIT';const after=await snapshot(connection);evidence.foreignHashes={};for(const table of tables){const a=hash(foreignRows(table,before[table])),b=hash(foreignRows(table,after[table]));check(a===b,'FOREIGN_DELTA_REJECTED');evidence.foreignHashes[table]={before:a,after:b};}
   const afterEvents=after.TEST_PEDIDO_STATE_EVENTS.filter(row=>Number(row.PEDIDO_ID)===id);check(afterEvents.length===3&&afterEvents.some(row=>encode(row)===encode(events[0])),'ORIGINAL_AUDIT_CHANGED');
   assertExactLedger(afterEvents);
   check(after.TEST_PEDIDOS_STOCK_RESERVE.every(row=>Number(row.PEDIDO_ID)!==id),'RESERVATION_NOT_RELEASED');
   const stableHeader=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['ESTADO','UPDATED_AT'].includes(key)));check(hash(stableHeader(header[0]))===hash(stableHeader(afterHeader[0])),'HEADER_BUSINESS_VALUES_CHANGED');
   await connection.commit();active=false;evidence.passed=true;evidence.compensated=true;
  }
  evidence.phase='POSTCHECK';evidence.after={header:await observer.query('SELECT ID,ESTADO,IMPORTETOTAL,OBSERVACIONES FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=?',[id]),reserve:await observer.query('SELECT * FROM JAVIER.TEST_PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID=?',[id]),events:await observer.query('SELECT * FROM JAVIER.TEST_PEDIDO_STATE_EVENTS WHERE PEDIDO_ID=? ORDER BY ID',[id])};
  check(evidence.after.header.length===1&&trim(evidence.after.header[0].ESTADO)==='CANCELADO'&&evidence.after.reserve.length===0&&evidence.after.events.length===3,'POSTCHECK_FAILED');
  assertExactLedger(evidence.after.events);evidence.after.events=evidence.after.events.map(({PAYLOAD_JSON,...event})=>({...event,payloadHashVerified:true}));
 }catch(error){if(active)await connection.rollback();evidence.passed=false;evidence.error=diagnostic(error);process.exitCode=1;}finally{await connection.close();await observer.close();console.log('OWNED_FIXTURE_COMPENSATION='+encode(evidence));}
})().catch(error=>{console.error(encode({passed:false,error:diagnostic(error)}));process.exitCode=1;});
'@
$job=$job.Replace('EVENT_SOURCE',$event64)
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=8 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
