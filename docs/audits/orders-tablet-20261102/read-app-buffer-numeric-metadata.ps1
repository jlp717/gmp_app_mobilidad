[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$job=@'
'use strict';
require('./config/load-env').loadEnv(process.cwd());
const odbc=require('odbc');
const result={readOnly:true,businessRowsRead:0,mutations:0,queries:0,closed:false,phase:'CONNECT',fieldsVerified:false,columns:[]};
let connection,error;
async function read(sql,params){result.queries++;return connection.query(sql,params,{timeout:20});}
(async()=>{
 try{
  connection=await odbc.connect({connectionString:`DSN=${process.env.ODBC_DSN||'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`,connectionTimeout:10,loginTimeout:10});
  result.phase='VERIFY_CATALOG_FIELDS';
  const fields=await read('SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME IN (?,?)',['QSYS2','SYSCOLUMNS','NUMERIC_PRECISION','NUMERIC_SCALE']);
  result.fieldsVerified=['NUMERIC_PRECISION','NUMERIC_SCALE'].every(name=>fields.some(row=>String(row.COLUMN_NAME).trim()===name));
  if(!result.fieldsVerified)throw Object.assign(new Error('CATALOG_NUMERIC_FIELDS_UNAVAILABLE'),{code:'CATALOG_NUMERIC_FIELDS_UNAVAILABLE'});
  result.phase='READ_APP_BUFFER_TYPES';
  result.columns=await read('SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,LENGTH,NUMERIC_PRECISION,NUMERIC_SCALE,IS_NULLABLE FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?,?) ORDER BY TABLE_NAME,ORDINAL_POSITION',['JAVIER','TEST_PEDIDO_STATE_EVENTS','TEST_LIQUIDACION_COMERCIAL','TEST_DEVOLUCIONES_COMERCIAL']);
  result.phase='DONE';
 }catch(cause){error={code:cause.code==='CATALOG_NUMERIC_FIELDS_UNAVAILABLE'?cause.code:'APP_BUFFER_NUMERIC_CATALOG_FAILED',odbc:(cause.odbcErrors||[]).map(item=>({state:/^[A-Z0-9]{5}$/.test(item.state||'')?item.state:null,code:Number.isFinite(Number(item.code))?Number(item.code):null}))};}
 finally{if(connection)try{await connection.close();result.closed=true;}catch{error||={code:'CATALOG_CONNECTION_CLOSE_FAILED'};}}
 result.success=!error;if(error){result.error=error;process.exitCode=1;}
 process.stdout.write(JSON.stringify(result,(_,item)=>typeof item==='bigint'?item.toString():item)+'\n');
})().catch(()=>{process.stdout.write('{"success":false,"code":"UNEXPECTED_NUMERIC_CATALOG_FAILURE"}\n');process.exitCode=1;});
'@
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
