[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$job=@'
'use strict';
require('./config/load-env').loadEnv(process.cwd());
const odbc=require('odbc');
const encode=value=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item);
const result={readOnly:true,businessRowsRead:0,mutations:0,phase:'CONNECT',queries:0,closed:false,tables:[]};
const names=['PEDIDO_STATE_EVENTS','LIQUIDACION_COMERCIAL','DEVOLUCIONES_COMERCIAL','TEST_PEDIDO_STATE_EVENTS','TEST_LIQUIDACION_COMERCIAL','TEST_DEVOLUCIONES_COMERCIAL'];
let connection,error;
async function query(sql,params){if(!/^SELECT /i.test(sql))throw Object.assign(new Error('READ_ONLY_REQUIRED'),{code:'READ_ONLY_REQUIRED'});result.queries++;return connection.query(sql,params,{timeout:20});}
(async()=>{
 try{
  connection=await odbc.connect({connectionString:`DSN=${process.env.ODBC_DSN||'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`,connectionTimeout:10,loginTimeout:10});
  result.phase='CATALOG';
  for(const name of names){
   const tables=await query('SELECT TABLE_TYPE FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',['JAVIER',name]);
   const columns=await query('SELECT COLUMN_NAME, DATA_TYPE, LENGTH, IS_NULLABLE FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',['JAVIER',name]);
   result.tables.push({name:'JAVIER.'+name,exists:tables.length===1,type:tables[0]?.TABLE_TYPE??null,columns:columns.map(row=>({name:String(row.COLUMN_NAME).trim(),type:String(row.DATA_TYPE).trim(),length:row.LENGTH,nullable:String(row.IS_NULLABLE).trim()}))});
  }
  result.phase='DONE';
 }catch(cause){error={code:/^[A-Z][A-Z0-9_]{2,70}$/.test(cause.code||'')?cause.code:'APP_BUFFER_CATALOG_FAILED',odbc:(cause.odbcErrors||[]).map(item=>({state:/^[A-Z0-9]{5}$/.test(item.state||'')?item.state:null,code:Number.isFinite(Number(item.code))?Number(item.code):null}))};}
 finally{if(connection)try{await connection.close();result.closed=true;}catch{error||={code:'CATALOG_CONNECTION_CLOSE_FAILED'};}}
 result.success=!error;if(error){result.error=error;process.exitCode=1;}process.stdout.write(encode(result)+'\n');
})().catch(()=>{process.stdout.write('{"success":false,"code":"UNEXPECTED_CATALOG_HARNESS_FAILURE"}\n');process.exitCode=1;});
'@
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
