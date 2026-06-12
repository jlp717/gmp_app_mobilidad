const odbc = require('odbc');
const fs = require('fs');
const path = require('path');
const DB_DSN = process.env.ODBC_DSN || 'GMP';
const DB_UID = process.env.ODBC_UID || process.env.DB2_UID;
const DB_PWD = process.env.ODBC_PASSWORD || process.env.ODBC_PWD || process.env.DB2_PASSWORD;
if (!DB_UID || !DB_PWD) {
  throw new Error('Missing DB2 credentials. Set ODBC_UID and ODBC_PASSWORD in the environment.');
}
if (process.env.ALLOW_DB2_DDL !== 'I_UNDERSTAND_THIS_MUTATES_DB2') {
  throw new Error('Refusing DB2 DDL. Set ALLOW_DB2_DDL=I_UNDERSTAND_THIS_MUTATES_DB2 to run this script intentionally.');
}
const CONN = `DSN=${DB_DSN};UID=${DB_UID};PWD=${DB_PWD};NAM=1;CCSID=1208;`;

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();
  console.log('Conectado OK');

  const raw = fs.readFileSync('C:\\Users\\Javier\\Desktop\\Repositorios\\gmp_app_mobilidad\\database_backup_20260513\\recreate_VISTA_DEUDA_BASE_COMPLETA.sql', 'utf8');
  const cleanSql = raw.replace(/--.*$/gm, '').replace(/\n\s*\n/g, '\n').trim();

  // Try using statement (prepare + execute)
  try {
    const stmt = await conn.createStatement();
    await stmt.prepare(cleanSql);
    console.log('Prep OK, executing...');
    await stmt.execute();
    await stmt.close();
    console.log('VISTA_DEUDA_BASE creada correctamente');
  } catch(e) {
    console.log('Error prepare/execute: ' + e.message.substring(0,150));
    
    // Fallback: try direct query
    try {
      await conn.query(cleanSql);
      console.log('Creada via query()');
    } catch(e2) {
      console.log('Error query: ' + e2.message.substring(0,150));
    }
  }

  // Verify
  try {
    const r = await conn.query("SELECT COUNT(*) AS C FROM JAVIER.VISTA_DEUDA_BASE");
    console.log('Filas en vista: ' + r[0].C);
    
    const cols = await conn.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'VISTA_DEUDA_BASE' AND COLUMN_NAME = 'SUBEMPRESAPEDIDO'");
    if (cols.length > 0) console.log('SUBEMPRESAPEDIDO presente OK');
    else console.log('SUBEMPRESAPEDIDO NO encontrado');
  } catch(e) {
    console.log('Verify error: ' + e.message.substring(0,100));
  }

  await conn.close();
  await pool.close();
})().catch(e => console.log('FATAL: ' + e.message));
