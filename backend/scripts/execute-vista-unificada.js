#!/usr/bin/env node
/**
 * execute-vista-unificada.js
 * Versión robusta: sin comentarios, sin CREATE OR REPLACE
 */

const fs = require('fs');
const path = require('path');
const odbc = require('odbc');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });


function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(name + " environment variable is required");
  }
  return value;
}

const DB_DSN = process.env.ODBC_DSN || 'GMP';
const DB_UID = requireEnv('ODBC_UID');
const DB_PWD = requireEnv('ODBC_PWD');

const CONNECTION_STRING = [
  `DSN=${DB_DSN}`,
  `UID=${DB_UID}`,
  `PWD=${DB_PWD}`,
  'NAM=1',
  'CCSID=1208',
  'CMPTDM=1',
].join(';');

async function main() {
  let pool = null;
  let conn = null;

  try {
    pool = await odbc.pool(CONNECTION_STRING);
    conn = await pool.connect();
    console.log('✅ Conectado a DB2\n');

    const sqlPath = path.resolve(__dirname, 'sql', 'vista_clientes_unificada.sql');
    let rawSql = fs.readFileSync(sqlPath, 'utf8');

    // Limpiar comentarios
    const cleanSql = rawSql
      .replace(/--.*$/gm, '')  // quitar comentarios de línea
      .replace(/\/\*[\s\S]*?\*\//g, '') // quitar comentarios de bloque
      .replace(/^\s*[\r\n]+/gm, '\n') // líneas vacías
      .trim();

    // Reemplazar CREATE OR REPLACE por CREATE (DB2 for i)
    const finalSql = cleanSql.replace(/CREATE OR REPLACE VIEW/i, 'CREATE VIEW');

    console.log(`📄 SQL: ${sqlPath} (${finalSql.length} chars limpios)`);

    // Dropear vista si existe
    console.log('\n🔨 Preparando...');
    try {
      await conn.query('DROP VIEW JAVIER.VISTA_CLIENTES_UNIFICADA');
      console.log('   Vista anterior eliminada');
    } catch (e) {
      console.log('   No había vista previa (OK)');
    }

    // Ejecutar CREATE VIEW
    console.log('   Creando vista...');
    await conn.query(finalSql);
    console.log('✅ Vista JAVIER.VISTA_CLIENTES_UNIFICADA CREADA\n');

    // Verificar catálogo
    console.log('🔍 Verificando...');
    const catalogQuery = `
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = 'JAVIER'
        AND TABLE_NAME = 'VISTA_CLIENTES_UNIFICADA'
    `;
    const cat = await conn.query(catalogQuery);
    if (cat.length > 0) {
      console.log(`✅ En catálogo: ${cat[0].TABLE_TYPE}`);

      // Columnas
      const colCount = await conn.query(`
        SELECT COUNT(*) AS CNT FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'VISTA_CLIENTES_UNIFICADA'
      `);
      console.log(`   Columnas: ${colCount[0].CNT}`);

      // Filas
      const rowCount = await conn.query('SELECT COUNT(*) AS CNT FROM JAVIER.VISTA_CLIENTES_UNIFICADA');
      console.log(`   Filas: ${rowCount[0].CNT.toLocaleString()}\n`);

      // Muestra
      console.log('📋 Muestra (3 filas):');
      const sample = await conn.query(`
        SELECT CODIGOCLIENTE, NOMBRECLIENTE, POBLACION,
               CLCL1_DIASLIMITECREDITO, CLCL1_DIASLIMITECREDITOCONFECHAALB,
               RUT_CODIGOVENDEDOR, VDD_NOMBREVENDEDOR
        FROM JAVIER.VISTA_CLIENTES_UNIFICADA
        FETCH FIRST 3 ROWS ONLY
      `);
      for (const row of sample) {
        console.log(JSON.stringify(row, null, 2));
      }

      // Estadísticas
      console.log('\n📊 Estadísticas:');
      const stats = [
        ['Total clientes', 'SELECT COUNT(*) AS C FROM JAVIER.VISTA_CLIENTES_UNIFICADA'],
        ['Con crédito (CLCL1)', 'SELECT COUNT(*) AS C FROM JAVIER.VISTA_CLIENTES_UNIFICADA WHERE CLCL1_DIASLIMITECREDITO IS NOT NULL'],
        ['Con extensión (CLIX)', 'SELECT COUNT(*) AS C FROM JAVIER.VISTA_CLIENTES_UNIFICADA WHERE CLIX_CODIGOCLIENTE IS NOT NULL'],
        ['Con ruta (CRUT)', 'SELECT COUNT(*) AS C FROM JAVIER.VISTA_CLIENTES_UNIFICADA WHERE SECUENCIA IS NOT NULL'],
        ['Con vendedor (VDDL1)', 'SELECT COUNT(*) AS C FROM JAVIER.VISTA_CLIENTES_UNIFICADA WHERE VDD_NOMBREVENDEDOR IS NOT NULL'],
        ['DIASLIMITECREDITOCONFECHAALB=S', "SELECT COUNT(*) AS C FROM JAVIER.VISTA_CLIENTES_UNIFICADA WHERE TRIM(CLCL1_DIASLIMITECREDITOCONFECHAALB) = 'S'"],
        ['Con CODIGORUTA asignado', 'SELECT COUNT(*) AS C FROM JAVIER.VISTA_CLIENTES_UNIFICADA WHERE TRIM(CODIGORUTA) <> \'\' AND CODIGORUTA <> \'0000\''],
      ];
      for (const [label, sql] of stats) {
        const r = await conn.query(sql);
        console.log(`   ${label}: ${r[0].C.toLocaleString()}`);
      }

      console.log('\n═══════════════════════════════════════');
      console.log('  ✅ VISTA CREADA Y VERIFICADA');
      console.log('═══════════════════════════════════════');
    } else {
      console.log('⚠️ Vista no aparece en catálogo');
    }

  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}`);
    if (err.odbcErrors) {
      for (const e of err.odbcErrors) {
        console.error(`   STATE=${e.state} CODE=${e.code}: ${e.message}`);
      }
    }
    process.exitCode = 1;
  } finally {
    if (conn) { try { await conn.close(); } catch (_) {} }
    if (pool) { try { await pool.close(); } catch (_) {} }
  }
}

main();
