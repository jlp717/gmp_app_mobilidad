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
  const step = process.argv[2];

  if (step === 'final1') {
    console.log('=== JAVIER.PEDIDOS_CAB ESTADO ===');
    try {
      const r = await query(`SELECT ESTADO, COUNT(*) AS CNT FROM JAVIER.PEDIDOS_CAB GROUP BY ESTADO ORDER BY CNT DESC`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== JAVIER.PEDIDOS_CAB count ===');
    try {
      const r = await query(`SELECT COUNT(*) AS CNT FROM JAVIER.PEDIDOS_CAB`);
      console.log('PEDIDOS_CAB total rows:', r[0].CNT);
    } catch(e) { console.log('ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== DSEDAC.CRCB SITUACION (cobros) ===');
    try {
      const cnt = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.RCB`);
      console.log('RCB rows:', cnt[0].CNT);
      const r = await query(`SELECT SITUACION, COUNT(*) AS CNT FROM DSEDAC.RCB GROUP BY SITUACION ORDER BY CNT DESC FETCH FIRST 10 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('RCB ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== DSEDAC.RCO SITUACION (cobros) ===');
    try {
      const cnt = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.RCO`);
      console.log('RCO rows:', cnt[0].CNT);
      const r = await query(`SELECT SITUACION, COUNT(*) AS CNT FROM DSEDAC.RCO GROUP BY SITUACION ORDER BY CNT DESC FETCH FIRST 10 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('RCO ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== DSEDAC.HRUT row count ===');
    try {
      const r = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.HRUT`);
      console.log('HRUT rows:', r[0].CNT);
    } catch(e) { console.log('HRUT ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== DSEDAC.CRUT row count ===');
    try {
      const r = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.CRUT`);
      console.log('CRUT rows:', r[0].CNT);
    } catch(e) { console.log('CRUT ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== DSEDAC.RUT row count ===');
    try {
      const r = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.RUT`);
      console.log('RUT rows:', r[0].CNT);
    } catch(e) { console.log('RUT ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== DSEDAC.RUTAS row count ===');
    try {
      const r = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.RUTAS`);
      console.log('RUTAS rows:', r[0].CNT);
    } catch(e) { console.log('RUTAS ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== DSEDAC.RECT row count ===');
    try {
      const r = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.RECT`);
      console.log('RECT rows:', r[0].CNT);
    } catch(e) { console.log('RECT ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== DSEDAC.LINDTO row count ===');
    try {
      const r = await query(`SELECT COUNT(*) AS CNT FROM DSEDAC.LINDTO`);
      console.log('LINDTO rows:', r[0].CNT);
    } catch(e) { console.log('LINDTO ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== JAVIER.REPARTIDOR_ENTREGAS sample ===');
    try {
      const r = await query(`SELECT * FROM JAVIER.REPARTIDOR_ENTREGAS FETCH FIRST 3 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== JAVIER.REPARTIDOR_COBROS count + STATUS ===');
    try {
      const cnt = await query(`SELECT COUNT(*) AS CNT FROM JAVIER.REPARTIDOR_COBROS`);
      console.log('REPARTIDOR_COBROS rows:', cnt[0].CNT);
      const r = await query(`SELECT STATUS, COUNT(*) AS CNT FROM JAVIER.REPARTIDOR_COBROS GROUP BY STATUS ORDER BY CNT DESC`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('ERROR:', e.message?.substring(0,120)); }

    console.log('\n=== JAVIER.DELIVERY_STATUS count + STATUS ===');
    try {
      const cnt = await query(`SELECT COUNT(*) AS CNT FROM JAVIER.DELIVERY_STATUS`);
      console.log('DELIVERY_STATUS rows:', cnt[0].CNT);
      const r = await query(`SELECT STATUS, SITUACIONALBARAN, COUNT(*) AS CNT FROM JAVIER.DELIVERY_STATUS GROUP BY STATUS, SITUACIONALBARAN ORDER BY CNT DESC FETCH FIRST 15 ROWS ONLY`);
      console.log(JSON.stringify(r, null, 2));
    } catch(e) { console.log('ERROR:', e.message?.substring(0,120)); }
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });