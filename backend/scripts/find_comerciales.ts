import odbc from 'odbc';

async function main() {
  const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');
  
  // 1. Ver estructura de APPUSUARIOS
  console.log('=== ESTRUCTURA DE APPUSUARIOS ===');
  const columns = await conn.query(`
    SELECT COLUMN_NAME, DATA_TYPE, LENGTH
    FROM QSYS2.SYSCOLUMNS 
    WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'APPUSUARIOS'
  `);
  console.log(JSON.stringify(columns, null, 2));
  
  // 2. Ver todos los usuarios
  console.log('\n=== USUARIOS DE LA APP ===');
  const usuarios = await conn.query(`
    SELECT * FROM DSEDAC.APPUSUARIOS
    FETCH FIRST 50 ROWS ONLY
  `);
  console.log(JSON.stringify(usuarios, null, 2));
  
  // 3. Buscar BARTOLO
  console.log('\n=== BUSCANDO BARTOLO ===');
  const bartolo = await conn.query(`
    SELECT * FROM DSEDAC.APPUSUARIOS
    WHERE UPPER(NOMBRE) LIKE '%BARTOLO%' 
       OR UPPER(USUARIO) LIKE '%BARTOLO%'
       OR UPPER(DESCRIPCION) LIKE '%BARTOLO%'
    FETCH FIRST 10 ROWS ONLY
  `);
  console.log(JSON.stringify(bartolo, null, 2));
  
  // 4. Buscar tablas con USR o USER
  console.log('\n=== TABLAS CON USUARIOS ===');
  const userTables = await conn.query(`
    SELECT DISTINCT TABLE_NAME FROM QSYS2.SYSCOLUMNS 
    WHERE TABLE_SCHEMA = 'DSEDAC' 
    AND (TABLE_NAME LIKE '%USR%' OR TABLE_NAME LIKE '%USER%' OR TABLE_NAME LIKE '%USUARIO%')
  `);
  console.log(JSON.stringify(userTables, null, 2));
  
  await conn.close();
}

main().catch(console.error);
