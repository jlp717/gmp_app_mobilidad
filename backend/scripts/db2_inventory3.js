const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');
const DB_CONFIG = db2ConnectionString({ extras: 'NAM=1;CCSID=1208;CMPTDM=1;CPOOLMAX=3;CPOOLMIN=1;CPTOUT=60;COMMTIMEOUT=90;DBQ=GMP' });

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
  const step = process.argv[2];

  if (step === 'estados') {
    // CAC (not CAC_TEST) status values
    console.log('=== DSEDAC.CAC SITUACIONALBARAN ===');
    try {
      const r = await query(`SELECT SITUACIONALBARAN, COUNT(*) AS CNT FROM DSEDAC.CAC GROUP BY SITUACIONALBARAN ORDER BY CNT DESC FETCH FIRST 20 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('CAC SITUACIONALBARAN ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== DSEDAC.CAC ESTADOENVIO ===');
    try {
      const r = await query(`SELECT ESTADOENVIO, COUNT(*) AS CNT FROM DSEDAC.CAC GROUP BY ESTADOENVIO ORDER BY CNT DESC FETCH FIRST 20 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('CAC ESTADOENVIO ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== DSEDAC.CAC row count ===');
    try {
      const r = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.CAC`);
      console.log('CAC total rows:', r[0].CNT);
    } catch(e) { console.log('CAC count ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== JAVIER.PEDIDOS_CAB ESTADO ===');
    try {
      const r = await query(`SELECT ESTADO, COUNT(*) AS CNT FROM JAVIER.PEDIDOS_CAB GROUP BY ESTADO ORDER BY CNT DESC FETCH FIRST 20 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('PEDIDOS_CAB.ESTADO ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== JAVIER.PEDIDOS_CAB row count ===');
    try {
      const r = await query(`SELECT COUNT(*) AS CNT FROM JAVIER.PEDIDOS_CAB`);
      console.log('PEDIDOS_CAB total rows:', r[0].CNT);
    } catch(e) { console.log('PEDIDOS_CAB count ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== JAVIER.DELIVERY_STATUS sample ===');
    try {
      const r = await query(`SELECT * FROM JAVIER.DELIVERY_STATUS FETCH FIRST 5 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('DELIVERY_STATUS ERROR:', e.message?.substring(0,120)); }
    
    console.log('\n=== JAVIER.REPARTIDOR_COBROS sample ===');
    try {
      const r = await query(`SELECT * FROM JAVIER.REPARTIDOR_COBROS FETCH FIRST 5 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('REPARTIDOR_COBROS ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== JAVIER.RUTERO_CONFIG sample ===');
    try {
      const r = await query(`SELECT * FROM JAVIER.RUTERO_CONFIG FETCH FIRST 5 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('RUTERO_CONFIG ERROR:', e.message?.substring(0,120)); }
  }

  if (step === 'desc_delivery') {
    // Describe JAVIER tables related to delivery/payments
    const tables = ['DELIVERY_STATUS', 'REPARTIDOR_COBROS', 'REPARTIDOR_ENTREGA_LINEAS', 
                    'REPARTIDOR_ENTREGAS', 'REPARTIDOR_FIRMAS', 'REPARTIDOR_LIQUIDACION_OPS',
                    'REPARTIDOR_OBJETIVOS', 'COBROS', 'RUTERO_CONFIG', 'RUTERO_LOG'];
    
    for (const t of tables) {
      try {
        const cols = await query(`SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, COLUMN_TEXT FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION`);
        console.log(`\nJAVIER.${t} (${cols.length} cols):`);
        for (const c of cols) {
          const scale = c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : '';
          const text = c.COLUMN_TEXT ? ' -- ' + c.COLUMN_TEXT.trim() : '';
          console.log(`  ${c.COLUMN_NAME.padEnd(32)} ${String(c.DATA_TYPE).padEnd(10)}(${c.LENGTH}${scale}) ${c.IS_NULLABLE}${text}`);
        }
      } catch(e) {
        console.log(`JAVIER.${t}: ERROR (${e.message?.substring(0,80)})`);
      }
    }
  }

  if (step === 'dsedac_desc') {
    // Describe more DSEDAC key tables
    const tables = ['CCCAB', 'CLI', 'CRUT', 'HRUT', 'RECT', 'RFAC', 'RUT', 'RUTAS', 'VDC'];
    
    for (const t of tables) {
      try {
        const cnt = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.${t}`);
        const cols = await query(`SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, COLUMN_TEXT FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION`);
        console.log(`\nDSEDAC.${t} (${cnt[0].CNT} rows, ${cols.length} cols):`);
        // Only show first 25 columns to avoid timeout
        for (const c of cols.slice(0, 25)) {
          const scale = c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : '';
          const text = c.COLUMN_TEXT ? ' -- ' + c.COLUMN_TEXT.trim() : '';
          console.log(`  ${c.COLUMN_NAME.padEnd(28)} ${String(c.DATA_TYPE).padEnd(10)}(${c.LENGTH}${scale}) ${c.IS_NULLABLE}${text}`);
        }
        if (cols.length > 25) console.log(`  ... (${cols.length - 25} more columns)`);
      } catch(e) {
        console.log(`DSEDAC.${t}: ERROR (${e.message?.substring(0,100)})`);
      }
    }
  }

  if (step === 'views_def') {
    // Get view definitions for key JAVIER views
    const views = ['V_CRUT', 'V_DIM_VENDEDOR', 'V_DIM_CLIENTE', 'V_FACT_VENTAS', 'V_PUENTE_PED_ALB_FRA'];
    
    for (const v of views) {
      try {
        const r = await query(`SELECT VIEW_DEFINITION FROM QSYS2.SYSVIEWS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='${v}'`);
        if (r.length > 0) {
          const def = r[0].VIEW_DEFINITION || r[0].view_definition || '';
          console.log(`\n=== JAVIER.${v} definition (first 500 chars) ===`);
          console.log(def.substring(0, 500));
        } else {
          console.log(`\nJAVIER.${v}: No definition found`);
        }
      } catch(e) {
        console.log(`JAVIER.${v} ERROR: ${e.message?.substring(0,100)}`);
      }
    }
  }

  if (step === 'dseac_pedidos') {
    // Check key DSEDAC pedido-related tables not yet described
    console.log('=== DSEDAC.PEDIDO/PEDIDOS tables search ===');
    try {
      const r = await query(`SELECT TABLE_NAME, TABLE_TYPE FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA='DSEDAC' AND (UPPER(TABLE_NAME) LIKE '%PED%' OR TABLE_NAME LIKE 'PD%' OR TABLE_NAME LIKE 'PV%') ORDER BY TABLE_NAME`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('ERROR:', e.message?.substring(0,100)); }
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });