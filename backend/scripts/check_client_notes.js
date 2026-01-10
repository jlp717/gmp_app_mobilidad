/**
 * Script para verificar y crear la tabla CLIENT_NOTES si no existe
 */

const db = require('../config/db');

async function checkClientNotes() {
  try {
    await db.initDb();
    console.log('✅ Conectado\n');

    // 1. Intentar SELECT de la tabla
    console.log('1. Verificando si JAVIER.CLIENT_NOTES existe...');
    try {
      const result = await db.query(`
        SELECT COUNT(*) as CNT FROM JAVIER.CLIENT_NOTES
      `, false, false);
      console.log(`✅ Tabla existe con ${result[0]?.CNT || 0} registros`);
    } catch (e) {
      console.log(`❌ Tabla NO existe: ${e.message}`);
      
      // Intentar crear la tabla
      console.log('\n2. Intentando crear la tabla...');
      try {
        // Primero verificar si el schema JAVIER existe
        await db.query(`
          CREATE TABLE JAVIER.CLIENT_NOTES (
            CLIENT_CODE VARCHAR(20) NOT NULL PRIMARY KEY,
            OBSERVACIONES VARCHAR(32000),
            MODIFIED_BY VARCHAR(50),
            MODIFIED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `, false, false);
        console.log('✅ Tabla creada exitosamente');
      } catch (createErr) {
        console.log(`❌ No se pudo crear: ${createErr.message}`);
        console.log('\n💡 La tabla debe ser creada manualmente por un DBA');
      }
    }

    console.log('\n✅ Verificación completada');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

checkClientNotes();
