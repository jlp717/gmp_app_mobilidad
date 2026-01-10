/**
 * Script para verificar la diferencia por año
 */

const db = require('../config/db');

const VENDEDOR = '02';
const MIN_YEAR = 2024;

async function verifyByYear() {
  try {
    await db.initDb();
    console.log('✅ Conectado\n');

    // Clientes con ventas por año
    for (const year of [2024, 2025, 2026]) {
      try {
        const result = await db.query(`
          SELECT COUNT(DISTINCT TRIM(LCCDCL)) as CNT
          FROM DSED.LACLAE L
          WHERE L.LCAADC = ${year}
            AND TRIM(L.LCCDVD) = '${VENDEDOR}'
            AND L.TPDC = 'LAC'
            AND L.LCTPVT IN ('CC', 'VC')
            AND L.LCCLLN IN ('AB', 'VT')
            AND L.LCSRAB NOT IN ('N', 'Z')
        `, false, false);
        console.log(`Clientes con ventas en ${year}: ${result[0]?.CNT || 0}`);
      } catch (e) {
        console.log(`Error ${year}:`, e.message);
      }
    }

    // Clientes con ventas en cualquier año >= MIN_YEAR
    try {
      const result = await db.query(`
        SELECT COUNT(DISTINCT TRIM(LCCDCL)) as CNT
        FROM DSED.LACLAE L
        WHERE L.LCAADC >= ${MIN_YEAR}
          AND TRIM(L.LCCDVD) = '${VENDEDOR}'
          AND L.TPDC = 'LAC'
          AND L.LCTPVT IN ('CC', 'VC')
          AND L.LCCLLN IN ('AB', 'VT')
          AND L.LCSRAB NOT IN ('N', 'Z')
      `, false, false);
      console.log(`\nClientes con ventas desde ${MIN_YEAR}: ${result[0]?.CNT || 0}`);
    } catch (e) {
      console.log('Error:', e.message);
    }

    // Clientes en rutero (R1_T8CDVD) sin filtro de ventas
    try {
      const result = await db.query(`
        SELECT COUNT(DISTINCT TRIM(LCCDCL)) as CNT
        FROM DSED.LACLAE
        WHERE R1_T8CDVD = '${VENDEDOR}'
          AND LCCDCL IS NOT NULL
      `, false, false);
      console.log(`Clientes en rutero (R1_T8CDVD): ${result[0]?.CNT || 0}`);
    } catch (e) {
      console.log('Error:', e.message);
    }

    // Verificar clientes activos en CLI
    try {
      const result = await db.query(`
        SELECT COUNT(DISTINCT C.CODIGOCLIENTE) as CNT
        FROM DSEDAC.CLI C
        INNER JOIN DSED.LACLAE L ON C.CODIGOCLIENTE = L.LCCDCL
        WHERE L.R1_T8CDVD = '${VENDEDOR}'
          AND C.ANOBAJA = 0
      `, false, false);
      console.log(`Clientes activos en CLI (ANOBAJA=0) asignados a ${VENDEDOR}: ${result[0]?.CNT || 0}`);
    } catch (e) {
      console.log('Error:', e.message);
    }

    console.log('\n✅ Análisis completado');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

verifyByYear();
