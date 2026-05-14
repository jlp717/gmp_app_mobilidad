#!/usr/bin/env node
const { query, initDb, closePool } = require('../config/db');
const fs = require('fs');
const path = require('path');

async function main() {
  await initDb();
  
  const sqlFile = path.join(__dirname, 'run_create_view.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');
  
  console.log('Creating V_DIM_CLIENTE view...');
  try {
    await query(sql, false, false);
    console.log('VIEW CREATED OK');
  } catch(e) {
    console.error('ERROR:', e.message);
    if (e.odbcErrors) console.log('ODBC:', JSON.stringify(e.odbcErrors));
    process.exit(1);
  }
  
  const r = await query("SELECT TABLE_NAME, TABLE_TYPE FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='V_DIM_CLIENTE'", false, false);
  console.log('Result:', JSON.stringify(r));
  
  await closePool();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
