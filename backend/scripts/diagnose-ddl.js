#!/usr/bin/env node
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const CONN = db2ConnectionString();

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();

  console.log('=== DIAGNÃ“STICO DDL ===\n');

  // Test 1: SELECT funciona?
  try {
    const r = await conn.query('SELECT COUNT(*) AS C FROM DSEDAC.CLIL1');
    console.log(`âœ… SELECT: ${r[0].C} filas`);
  } catch(e) {
    console.log(`âŒ SELECT: ${e.message.substring(0,100)}`);
  }

  // Test 2: Current schema
  try {
    const r = await conn.query('SELECT CURRENT_SCHEMA FROM SYSIBM.SYSDUMMY1');
    console.log(`   Current schema: ${JSON.stringify(r[0])}`);
  } catch(e) {
    console.log(`   Current schema error: ${e.message.substring(0,100)}`);
  }

  // Test 3: Check JAVIER schema exists
  try {
    const r = await conn.query("SELECT SCHEMA_NAME FROM QSYS2.SYSSCHEMAS WHERE SCHEMA_NAME = 'JAVIER'");
    console.log(`   Schema JAVIER: ${r.length > 0 ? 'EXISTS' : 'NOT FOUND'}`);
  } catch(e) {
    console.log(`   Schema check error: ${e.message.substring(0,100)}`);
  }

  // Test 4: CREATE TABLE (DDL test)
  try {
    await conn.query('DROP TABLE JAVIER.TEST_DDL');
  } catch(_) {}
  try {
    await conn.query('CREATE TABLE JAVIER.TEST_DDL (ID INTEGER, NAME VARCHAR(50))');
    console.log('âœ… CREATE TABLE: OK');
    await conn.query('DROP TABLE JAVIER.TEST_DDL');
  } catch(e) {
    const odbcE = (e.odbcErrors || [])[0] || {};
    console.log(`âŒ CREATE TABLE: ${e.message.substring(0,150)}`);
  }

  // Test 5: CREATE VIEW sin schema (default schema)
  try {
    await conn.query('DROP VIEW TEST_DDL_V');
  } catch(_) {}
  try {
    await conn.query('CREATE VIEW TEST_DDL_V AS SELECT CODIGOCLIENTE FROM DSEDAC.CLIL1');
    console.log('âœ… CREATE VIEW (default schema): OK');
    const r = await conn.query('SELECT * FROM TEST_DDL_V FETCH FIRST 1 ROW ONLY');
    console.log(`   View data: ${JSON.stringify(r[0])}`);
    await conn.query('DROP VIEW TEST_DDL_V');
  } catch(e) {
    const odbcE = (e.odbcErrors || [])[0] || {};
    console.log(`âŒ CREATE VIEW (default schema): ${e.message.substring(0,200)}`);
  }

  // Test 6: CREATE VIEW con JAVIER schema
  try {
    await conn.query('DROP VIEW JAVIER.TEST_DDL_V');
  } catch(_) {}
  try {
    await conn.query('CREATE VIEW JAVIER.TEST_DDL_V AS SELECT CODIGOCLIENTE FROM DSEDAC.CLIL1');
    console.log('âœ… CREATE VIEW JAVIER: OK');
    await conn.query('DROP VIEW JAVIER.TEST_DDL_V');
  } catch(e) {
    const odbcE = (e.odbcErrors || [])[0] || {};
    console.log(`âŒ CREATE VIEW JAVIER: ${e.message.substring(0,200)}`);
  }

  // Test 7: Usando QCMDEXC
  try {
    await conn.query("CALL QSYS.QCMDEXC('DLTSQLVW JAVIER/TEST_QCMD_V', 0000000024.00000)");
  } catch(_) {}
  try {
    const sql = "CREATE VIEW JAVIER.TEST_QCMD_V AS SELECT CODIGOCLIENTE FROM DSEDAC.CLIL1";
    // Try with longer string
    await conn.query(`CALL QSYS.QCMDEXC('RUNSQLSTM SRCSTMF(''CREATE VIEW JAVIER.TEST_QCMD_V AS SELECT CODIGOCLIENTE FROM DSEDAC.CLIL1'')', 0000000099.00000)`);
    console.log('âœ… QCMDEXC attempt');
  } catch(e) {
    console.log(`âŒ QCMDEXC: ${e.message.substring(0,200)}`);
  }

  // Test 8: Check special authorities
  try {
    const r = await conn.query('SELECT SPECIAL_AUTHORITIES FROM QSYS2.USER_INFO WHERE AUTHORIZATION_NAME = CURRENT_USER');
    console.log(`   Special auths: ${JSON.stringify(r[0])}`);
  } catch(e) {
    console.log(`   Auth check error: ${e.message.substring(0,100)}`);
  }

  await conn.close();
  await pool.close();
})();
