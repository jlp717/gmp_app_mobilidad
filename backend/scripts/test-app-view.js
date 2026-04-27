#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// Usar la conexión nativa de la app
const db = require('../config/db');

(async () => {
  try {
    await db.initDb();
    console.log('✅ Pool inicializado\n');

    // Test: CREATE VIEW usando la función query de la app
    console.log('Test 1: CREATE VIEW usando db.query()...');
    
    // Dropear primero
    try { await db.query('DROP TABLE JAVIER.TEST_VIEW_TABLE', false, false); } catch(_) {}

    // Crear tabla (confirmar DDL funciona)
    try {
      await db.query('CREATE TABLE JAVIER.TEST_VIEW_TABLE (ID INTEGER, NOMBRE VARCHAR(50))', false, false);
      console.log('✅ CREATE TABLE con app query: OK');
      await db.query('DROP TABLE JAVIER.TEST_VIEW_TABLE', false, false);
    } catch(e) {
      console.log('❌ CREATE TABLE con app:', e.message.substring(0,150));
    }

    // Intentar CREATE VIEW
    try { 
      await db.query('DROP VIEW JAVIER.TEST_VIEW2', false, false); 
    } catch(_) {}
    
    try {
      await db.query('CREATE VIEW JAVIER.TEST_VIEW2 AS SELECT CODIGOCLIENTE, NOMBRECLIENTE FROM DSEDAC.CLIL1', false, false);
      console.log('✅ CREATE VIEW con app query: OK');
      
      // Leer datos
      const r = await db.query('SELECT * FROM JAVIER.TEST_VIEW2 FETCH FIRST 1 ROW ONLY');
      console.log(`   Datos: ${JSON.stringify(r[0])}`);
      
      await db.query('DROP VIEW JAVIER.TEST_VIEW2', false, false);
    } catch(e) {
      console.log('❌ CREATE VIEW con app:', e.message.substring(0,200));
      if (e.odbcErrors) {
        for (const oe of e.odbcErrors) {
          console.log(`   ODBC: state=${oe.state} code=${oe.code}: ${oe.message}`);
        }
      }
    }

    await db.closePool();
  } catch(e) {
    console.error('FATAL:', e.message);
  }
})();
