/**
 * Script para probar el conteo para jefe de ventas (todos los vendedores)
 */

const db = require('../config/db');

const CURRENT_YEAR = 2026;
const LACLAE_SALES_FILTER = "TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')";

async function testJefeVentas() {
  try {
    await db.initDb();
    console.log('✅ Conectado\n');

    console.log('='.repeat(70));
    console.log('SIMULANDO ENDPOINT BY-CLIENT PARA JEFE DE VENTAS (TODOS)');
    console.log('='.repeat(70));

    const yearsFilter = CURRENT_YEAR;
    const monthsFilter = '1,2,3,4,5,6,7,8,9,10,11,12';

    // Query de conteo (sin filtro de vendedor = ALL)
    const countResult = await db.query(`
      SELECT COUNT(DISTINCT R.LCCDCL) as TOTAL
      FROM (
          SELECT DISTINCT LCCDCL, R1_T8CDVD
          FROM DSED.LACLAE
          WHERE R1_T8CDVD IS NOT NULL AND LCCDCL IS NOT NULL
      ) R
      LEFT JOIN DSEDAC.CLI C ON R.LCCDCL = C.CODIGOCLIENTE
      WHERE C.ANOBAJA = 0
    `, false, false);

    console.log(`\n1. Total clientes (todos vendedores, activos): ${countResult[0]?.TOTAL || 0}`);

    // Query con limit
    const dataResult = await db.query(`
      SELECT 
        R.LCCDCL as CODE,
        COALESCE(S.SALES, 0) as SALES
      FROM (
        SELECT DISTINCT LCCDCL, R1_T8CDVD
        FROM DSED.LACLAE
        WHERE R1_T8CDVD IS NOT NULL AND LCCDCL IS NOT NULL
      ) R
      LEFT JOIN DSEDAC.CLI C ON R.LCCDCL = C.CODIGOCLIENTE
      LEFT JOIN (
        SELECT LCCDCL, SUM(LCIMVT) as SALES
        FROM DSED.LACLAE
        WHERE LCAADC IN(${yearsFilter})
          AND LCMMDC IN(${monthsFilter})
          AND ${LACLAE_SALES_FILTER}
        GROUP BY LCCDCL
      ) S ON R.LCCDCL = S.LCCDCL
      WHERE C.ANOBAJA = 0
      GROUP BY R.LCCDCL, S.SALES
      ORDER BY COALESCE(S.SALES, 0) DESC
      FETCH FIRST 1000 ROWS ONLY
    `, false, false);

    console.log(`2. Clientes retornados (con limit 1000): ${dataResult.length}`);
    
    const conVentas = dataResult.filter(r => parseFloat(r.SALES) > 0);
    const sinVentas = dataResult.filter(r => parseFloat(r.SALES) === 0);
    
    console.log(`\n3. Análisis:`);
    console.log(`   - Con ventas en ${CURRENT_YEAR}: ${conVentas.length}`);
    console.log(`   - Sin ventas en ${CURRENT_YEAR}: ${sinVentas.length}`);

    // También probar por vendedor individual para comparar
    console.log('\n' + '='.repeat(70));
    console.log('COMPARACIÓN POR VENDEDOR');
    console.log('='.repeat(70));

    const vendedores = ['02', '03', '05', '10'];
    for (const vend of vendedores) {
      try {
        const result = await db.query(`
          SELECT COUNT(DISTINCT LCCDCL) as CNT
          FROM DSED.LACLAE
          WHERE R1_T8CDVD = '${vend}'
            AND LCCDCL IS NOT NULL
        `, false, false);
        
        const activeResult = await db.query(`
          SELECT COUNT(DISTINCT R.LCCDCL) as CNT
          FROM (
            SELECT DISTINCT LCCDCL FROM DSED.LACLAE WHERE R1_T8CDVD = '${vend}' AND LCCDCL IS NOT NULL
          ) R
          LEFT JOIN DSEDAC.CLI C ON R.LCCDCL = C.CODIGOCLIENTE
          WHERE C.ANOBAJA = 0
        `, false, false);
        
        console.log(`  Vendedor ${vend}: ${result[0]?.CNT || 0} total, ${activeResult[0]?.CNT || 0} activos`);
      } catch (e) {
        console.log(`  Vendedor ${vend}: Error`);
      }
    }

    console.log('\n✅ Test completado');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

testJefeVentas();
