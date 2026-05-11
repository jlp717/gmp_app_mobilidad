const odbc = require('odbc');
const DB_CONFIG = `DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208;CMPTDM=1;CPOOLMAX=3;CPOOLMIN=1;CPTOUT=60;COMMTIMEOUT=90;DBQ=GMP;`;

async function query(sql) {
  let pool = null, conn = null;
  try {
    pool = await odbc.pool(DB_CONFIG);
    conn = await pool.connect();
    return await conn.query(sql);
  } finally {
    if (conn) try { await conn.close(); } catch(e) {}
    if (pool) try { await pool.close(); } catch(e) {}
  }
}

async function main() {
  const step = process.argv[2] || 'a';

  if (step === 'a') {
    // JAVIER: all tables + tables only
    console.log('=== JAVIER tables ===');
    const r = await query(`SELECT TABLE_NAME, TABLE_TYPE FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'JAVIER' ORDER BY TABLE_NAME`);
    console.log(JSON.stringify(r, null, 2));
  }

  if (step === 'b') {
    // Key JAVIER tables: describe columns
    const javierTables = [
      'PEDIDOS_CAB', 'PEDIDOS_LIN', 'PEDIDOS_SEQ', 'PEDIDOS_STOCK_RESERVE',
      'REPARTIDOR_COBROS', 'REPARTIDOR_ENTREGA_LINEAS', 'COBROS',
      'RUTERO_CONFIG', 'RUTERO_LOG',
      'CLIENT_SIGNERS', 'VENDOR_PIN_HASHES', 'VENTAS_B'
    ];
    
    for (const t of javierTables) {
      try {
        const cols = await query(`SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, COLUMN_TEXT FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION`);
        console.log(`\nJAVIER.${t} (${cols.length} cols):`);
        for (const c of cols) {
          const scale = c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : '';
          const text = c.COLUMN_TEXT ? ' -- ' + c.COLUMN_TEXT.trim() : '';
          console.log(`  ${c.COLUMN_NAME.padEnd(30)} ${String(c.DATA_TYPE).padEnd(10)}(${c.LENGTH}${scale}) ${c.IS_NULLABLE}${text}`);
        }
      } catch (e) {
        console.log(`JAVIER.${t}: ERROR (${e.message?.substring(0,80)})`);
      }
    }
  }

  if (step === 'c') {
    // DSEDAC key tables: PEDIDO/ALBARAN/CABECERA/LINEA status columns
    console.log('=== DSEDAC: ESTADO/STATUS column search ===');
    const statusCols = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH, COLUMN_TEXT
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND (UPPER(COLUMN_NAME) LIKE '%ESTADO%' 
          OR UPPER(COLUMN_NAME) LIKE '%STATUS%'
          OR UPPER(COLUMN_NAME) LIKE '%STSPED%'
          OR UPPER(COLUMN_NAME) LIKE '%SIT%'
          OR UPPER(COLUMN_NAME) LIKE '%SITUACION%')
      ORDER BY TABLE_NAME, COLUMN_NAME
      FETCH FIRST 50 ROWS ONLY
    `);
    console.log(JSON.stringify(statusCols, null, 2));
  }

  if (step === 'd') {
    // Key DSEDAC tables: CCCAB (cabecera pedidos), LINDTO (lineas), CVC$ALB, etc.
    const dsedacTables = ['CCCAB', 'LINDTO', 'CLI', 'CRUT', 'HRUT', 'RECT', 'RFAC', 'RUT', 'RUTAS', 'CVC$ALB', 'CAC_TEST'];
    
    for (const t of dsedacTables) {
      try {
        const cols = await query(`SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, COLUMN_TEXT FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION`);
        console.log(`\nDSEDAC.${t} (${cols.length} cols):`);
        for (const c of cols) {
          const scale = c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : '';
          const text = c.COLUMN_TEXT ? ' -- ' + c.COLUMN_TEXT.trim() : '';
          console.log(`  ${c.COLUMN_NAME.padEnd(30)} ${String(c.DATA_TYPE).padEnd(10)}(${c.LENGTH}${scale}) ${c.IS_NULLABLE}${text}`);
        }
      } catch (e) {
        console.log(`DSEDAC.${t}: ERROR (${e.message?.substring(0,80)})`);
      }
    }
  }

  if (step === 'e') {
    // DISTINCT values for key DSEDAC status columns  
    console.log('=== DISTINCT SITUACIONALBARAN from CAC_TEST ===');
    try {
      const r = await query(`SELECT SITUACIONALBARAN, COUNT(*) AS CNT FROM DSEDAC.CAC_TEST GROUP BY SITUACIONALBARAN ORDER BY CNT DESC FETCH FIRST 20 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('SITUACIONALBARAN ERROR:', e.message?.substring(0,100)); }

    console.log('\n=== DISTINCT ESTADOENVIO from CAC_TEST ===');
    try {
      const r = await query(`SELECT ESTADOENVIO, COUNT(*) AS CNT FROM DSEDAC.CAC_TEST GROUP BY ESTADOENVIO ORDER BY CNT DESC FETCH FIRST 20 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('ESTADOENVIO ERROR:', e.message?.substring(0,100)); }

    console.log('\n=== DISTINCT CODIGOVENDEDOR from CAC_TEST (top sellers) ===');
    try {
      const r = await query(`SELECT CODIGOVENDEDOR, COUNT(*) AS CNT FROM DSEDAC.CAC_TEST GROUP BY CODIGOVENDEDOR ORDER BY CNT DESC FETCH FIRST 20 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('CODIGOVENDEDOR ERROR:', e.message?.substring(0,100)); }
    
    console.log('\n=== DISTINCT ESTADO from JAVIER.PEDIDOS_CAB ===');
    try {
      const r = await query(`SELECT ESTADO, COUNT(*) AS CNT FROM JAVIER.PEDIDOS_CAB GROUP BY ESTADO ORDER BY CNT DESC FETCH FIRST 20 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('PEDIDOS_CAB.ESTADO ERROR:', e.message?.substring(0,100)); }

    console.log('\n=== JAVIER.REPARTIDOR_COBROS sample ===');
    try {
      const r = await query(`SELECT * FROM JAVIER.REPARTIDOR_COBROS FETCH FIRST 5 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('REPARTIDOR_COBROS ERROR:', e.message?.substring(0,100)); }

    console.log('\n=== JAVIER.RUTERO_CONFIG sample ===');
    try {
      const r = await query(`SELECT * FROM JAVIER.RUTERO_CONFIG FETCH FIRST 5 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('RUTERO_CONFIG ERROR:', e.message?.substring(0,100)); }

    console.log('\n=== JAVIER.PEDIDOS_CAB sample ===');
    try {
      const r = await query(`SELECT * FROM JAVIER.PEDIDOS_CAB FETCH FIRST 3 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('PEDIDOS_CAB ERROR:', e.message?.substring(0,100)); }
  }

  if (step === 'f') {
    // Structural overlap DSEDAC vs JAVIER
    console.log('=== Tables in both DSEDAC and JAVIER ===');
    const overlap = await query(`
      SELECT A.TABLE_NAME FROM QSYS2.SYSTABLES A
      INNER JOIN QSYS2.SYSTABLES B ON A.TABLE_NAME = B.TABLE_NAME
      WHERE A.TABLE_SCHEMA = 'DSEDAC' AND B.TABLE_SCHEMA = 'JAVIER'
      ORDER BY A.TABLE_NAME
    `);
    console.log('Overlap:', overlap.map(r=>r.TABLE_NAME).join(', '));
    
    // Also check DSED vs JAVIER
    const overlap2 = await query(`
      SELECT A.TABLE_NAME FROM QSYS2.SYSTABLES A
      INNER JOIN QSYS2.SYSTABLES B ON A.TABLE_NAME = B.TABLE_NAME
      WHERE A.TABLE_SCHEMA = 'DSED' AND B.TABLE_SCHEMA = 'JAVIER'
      ORDER BY A.TABLE_NAME
    `);
    console.log('DSED ∩ JAVIER:', overlap2.map(r=>r.TABLE_NAME).join(', ') || 'NONE');
    
    // JAVIER view definitions
    console.log('\n=== JAVIER V_CRUT view definition ===');
    try {
      const vd = await query(`SELECT VIEW_DEFINITION FROM QSYS2.SYSVIEWS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='V_CRUT'`);
      console.log(JSON.stringify(vd, null, 2));
    } catch(e) { console.log('V_CRUT:', e.message?.substring(0,80)); }

    console.log('\n=== JAVIER V_DIM_VENDEDOR view definition ===');
    try {
      const vd = await query(`SELECT VIEW_DEFINITION FROM QSYS2.SYSVIEWS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='V_DIM_VENDEDOR'`);
      console.log(JSON.stringify(vd, null, 2));
    } catch(e) { console.log('V_DIM_VENDEDOR:', e.message?.substring(0,80)); }
    
    console.log('\n=== JAVIER V_FACT_VENTAS view definition ===');
    try {
      const vd = await query(`SELECT VIEW_DEFINITION FROM QSYS2.SYSVIEWS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='V_FACT_VENTAS'`);
      console.log(JSON.stringify(vd, null, 2));
    } catch(e) { console.log('V_FACT_VENTAS:', e.message?.substring(0,80)); }
  }

  if (step === 'g') {
    // DSEDAC.CCCAB describe
    console.log('=== DSEDAC.CCCAB describe ===');
    try {
      const cols = await query(`SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, COLUMN_TEXT FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='CCCAB' ORDER BY ORDINAL_POSITION`);
      console.log(JSON.stringify(cols, null, 2));
    } catch(e) { console.log('ERROR:', e.message?.substring(0,100)); }

    // Count distinct values for CCCAB columns
    console.log('\n=== DSEDAC.CCCAB row count ===');
    try {
      const cnt = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.CCCAB`);
      console.log('CCCAB rows:', cnt[0].CNT);
    } catch(e) { console.log('ERROR:', e.message?.substring(0,100)); }

    // DSEDAC key entities - CLI, VDC for relationships
    console.log('\n=== DSEDAC.VDC describe ===');
    try {
      const cols = await query(`SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, COLUMN_TEXT FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='VDC' ORDER BY ORDINAL_POSITION`);
      console.log(`\nDSEDAC.VDC (${cols.length} cols):`);
      for (const c of cols) {
        const scale = c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : '';
        console.log(`  ${c.COLUMN_NAME.padEnd(25)} ${String(c.DATA_TYPE).padEnd(10)}(${c.LENGTH}${scale}) ${c.COLUMN_TEXT || ''}`);
      }
    } catch(e) { console.log('VDC ERROR:', e.message?.substring(0,100)); }

    // CCCAB primary keys sample
    console.log('\n=== DSEDAC.CCCAB SAMPLE ===');
    try {
      const r = await query(`SELECT * FROM DSEDAC.CCCAB FETCH FIRST 5 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('CCCAB SAMPLE ERROR:', e.message?.substring(0,100)); }
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });