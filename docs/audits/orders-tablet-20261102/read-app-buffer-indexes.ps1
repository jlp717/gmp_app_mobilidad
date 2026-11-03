[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$job=@'
'use strict';
require('./config/load-env').loadEnv(process.cwd());
const odbc=require('odbc');
const result={readOnly:true,businessRowsRead:0,mutations:0,queries:0,closed:false,indexes:[]};
let connection,error;
(async()=>{
 try{
  connection=await odbc.connect({connectionString:`DSN=${process.env.ODBC_DSN||'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`,connectionTimeout:10,loginTimeout:10});
  result.queries++;
  result.indexes=await connection.query('SELECT I.TABLE_NAME,I.INDEX_NAME,I.IS_UNIQUE,K.COLUMN_NAME,K.ORDINAL_POSITION FROM QSYS2.SYSINDEXES I JOIN QSYS2.SYSKEYS K ON K.INDEX_SCHEMA=I.INDEX_SCHEMA AND K.INDEX_NAME=I.INDEX_NAME WHERE I.TABLE_SCHEMA=? AND I.TABLE_NAME IN (?,?,?) ORDER BY I.TABLE_NAME,I.INDEX_NAME,K.ORDINAL_POSITION',['JAVIER','TEST_PEDIDO_STATE_EVENTS','TEST_LIQUIDACION_COMERCIAL','TEST_DEVOLUCIONES_COMERCIAL'],{timeout:20});
 }catch(cause){error={code:'APP_BUFFER_INDEX_CATALOG_FAILED',odbc:(cause.odbcErrors||[]).map(item=>({state:/^[A-Z0-9]{5}$/.test(item.state||'')?item.state:null,code:Number.isFinite(Number(item.code))?Number(item.code):null}))};}
 finally{if(connection)try{await connection.close();result.closed=true;}catch{error||={code:'CATALOG_CONNECTION_CLOSE_FAILED'};}}
 result.success=!error;if(error){result.error=error;process.exitCode=1;}
 process.stdout.write(JSON.stringify(result,(_,item)=>typeof item==='bigint'?item.toString():item)+'\n');
})().catch(()=>{process.stdout.write('{"success":false,"code":"UNEXPECTED_INDEX_CATALOG_FAILURE"}\n');process.exitCode=1;});
'@
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
