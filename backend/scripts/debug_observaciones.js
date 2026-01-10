/**
 * Script para investigar el campo OBSERVACIONES en la base de datos
 * Verifica estructura de tablas y columnas disponibles
 */

const db = require('../config/db');

async function debugObservaciones() {
  try {
    await db.initDb();
    console.log('✅ Conectado a la base de datos\n');

    // 1. Probar SELECT * de LACLAE con LIMIT para ver columnas
    console.log('='.repeat(60));
    console.log('1. ESTRUCTURA DE LACLAE (primeras filas)');
    console.log('='.repeat(60));
    
    try {
      const laclaeRows = await db.query('SELECT TOP 1 * FROM LACLAE', false, false);
      if (laclaeRows.length > 0) {
        console.log('Columnas en LACLAE:');
        Object.keys(laclaeRows[0]).forEach(col => {
          const val = laclaeRows[0][col];
          console.log(`  - ${col}: ${typeof val} (ejemplo: ${val === null ? 'NULL' : String(val).substring(0, 50)})`);
        });
      }
    } catch (err) {
      console.log('Error consultando LACLAE:', err.message);
    }

    // 2. Probar SELECT * de LAC con LIMIT para ver columnas
    console.log('\n' + '='.repeat(60));
    console.log('2. ESTRUCTURA DE LAC (primeras filas)');
    console.log('='.repeat(60));
    
    try {
      const lacRows = await db.query('SELECT TOP 1 * FROM LAC', false, false);
      if (lacRows.length > 0) {
        console.log('Columnas en LAC:');
        Object.keys(lacRows[0]).forEach(col => {
          const val = lacRows[0][col];
          console.log(`  - ${col}: ${typeof val} (ejemplo: ${val === null ? 'NULL' : String(val).substring(0, 50)})`);
        });
      }
    } catch (err) {
      console.log('Error consultando LAC:', err.message);
    }

    // 3. Buscar la consulta que tiene OBSERVACIONES en el código
    console.log('\n' + '='.repeat(60));
    console.log('3. PROBANDO CONSULTA CON OBSERVACIONES');
    console.log('='.repeat(60));
    
    try {
      const obsTest = await db.query(`
        SELECT TOP 1 OBSERVACIONES, MODIFIED_BY FROM LACLAE
      `, false, false);
      console.log('✅ OBSERVACIONES existe en LACLAE:', obsTest);
    } catch (err) {
      console.log('❌ OBSERVACIONES NO existe en LACLAE:', err.message);
    }

    try {
      const obsTest2 = await db.query(`
        SELECT TOP 1 OBSERVACIONES, MODIFIED_BY FROM LAC
      `, false, false);
      console.log('✅ OBSERVACIONES existe en LAC:', obsTest2);
    } catch (err) {
      console.log('❌ OBSERVACIONES NO existe en LAC:', err.message);
    }

    // 4. Buscar en otras tablas de clientes
    console.log('\n' + '='.repeat(60));
    console.log('4. BUSCANDO OTRAS TABLAS DE CLIENTES');
    console.log('='.repeat(60));
    
    const tablesToTry = ['CLIENTES', 'CLIENTE', 'CLI', 'CLAE', 'CLIE', 'T_CLIENTES', 'LACLIE'];
    for (const table of tablesToTry) {
      try {
        const rows = await db.query(`SELECT TOP 1 * FROM ${table}`, false, false);
        if (rows.length > 0) {
          console.log(`\n✅ Tabla ${table} encontrada. Columnas:`);
          Object.keys(rows[0]).forEach(col => {
            if (col.includes('OBS') || col.includes('NOTA') || col.includes('MOD') || col.includes('COMMENT')) {
              console.log(`  *** ${col}`);
            }
          });
        }
      } catch (err) {
        // Tabla no existe, silenciar
      }
    }

    // 5. Probar consulta específica que sabemos que funciona
    console.log('\n' + '='.repeat(60));
    console.log('5. LISTAR TODAS LAS COLUMNAS DE LACLAE');
    console.log('='.repeat(60));
    
    try {
      const allCols = await db.query('SELECT TOP 1 * FROM LACLAE', false, false);
      if (allCols.length > 0) {
        const cols = Object.keys(allCols[0]);
        console.log(`Total columnas: ${cols.length}`);
        cols.forEach((col, i) => console.log(`  ${i+1}. ${col}`));
      }
    } catch (err) {
      console.log('Error:', err.message);
    }

    console.log('\n✅ Análisis completado');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

debugObservaciones();
