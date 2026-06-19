require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');
function cs(){const pwd=process.env.ODBC_PWD||process.env.ODBC_PASSWORD;return `DSN=${process.env.ODBC_DSN||'GMP'};UID=${process.env.ODBC_UID||'JAVIER'};PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=${process.env.ODBC_DSN||'GMP'}`;}
(async()=>{const c=await odbc.connect(cs());const r=await c.query(`SELECT TRIM(CODIGOVENDEDOR) V,EJERCICIO,MES,COUNT(*) C FROM JAVIER.MOVIMIENTOS_BOLSA GROUP BY TRIM(CODIGOVENDEDOR),EJERCICIO,MES ORDER BY COUNT(*) DESC FETCH FIRST 3 ROWS ONLY`);console.log(JSON.stringify(r,null,2));await c.close();})().catch(e=>{console.error(e);process.exit(1);});
