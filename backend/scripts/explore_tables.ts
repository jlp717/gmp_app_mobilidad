import odbc from 'odbc';

async function explorarTablas() {
  const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER');
  
  console.log('=== Tablas de ventas, pedidos y facturas ===\n');
  
  // Buscar tablas relevantes
  const tablas = await conn.query(`
    SELECT TABLE_NAME, TABLE_SCHEMA 
    FROM QSYS2.SYSTABLES 
    WHERE TABLE_SCHEMA = 'DSEDAC' 
    AND (TABLE_NAME LIKE '%CAC%' OR TABLE_NAME LIKE '%VEN%' OR TABLE_NAME LIKE '%PED%' OR TABLE_NAME LIKE '%FAC%' OR TABLE_NAME LIKE '%ALB%')
    ORDER BY TABLE_NAME
    FETCH FIRST 50 ROWS ONLY
  `);
  console.log('Tablas encontradas:', JSON.stringify(tablas, null, 2));

  // Explorar CAC (cabecera albaranes/facturas)
  console.log('\n=== Estructura de CAC (cabecera albaranes) ===');
  const cacCols = await conn.query(`
    SELECT COLUMN_NAME, DATA_TYPE 
    FROM QSYS2.SYSCOLUMNS 
    WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
  `);
  console.log(JSON.stringify(cacCols, null, 2));

  // Ejemplo de registros CAC
  console.log('\n=== Muestra de CAC ===');
  const cacSample = await conn.query(`SELECT * FROM DSEDAC.CAC FETCH FIRST 3 ROWS ONLY`);
  console.log(JSON.stringify(cacSample, null, 2));

  // Ver tablas PED si existen
  console.log('\n=== Tablas PED (pedidos) ===');
  const pedTablas = await conn.query(`
    SELECT TABLE_NAME FROM QSYS2.SYSTABLES 
    WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME LIKE 'PED%'
  `);
  console.log(JSON.stringify(pedTablas, null, 2));

  // Explorar ALB (albaranes)
  console.log('\n=== Tablas ALB ===');
  const albTablas = await conn.query(`
    SELECT TABLE_NAME FROM QSYS2.SYSTABLES 
    WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME LIKE 'ALB%'
  `);
  console.log(JSON.stringify(albTablas, null, 2));

  await conn.close();
}

explorarTablas().catch(console.error);
