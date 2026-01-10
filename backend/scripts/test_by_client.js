/**
 * Script para probar el nuevo conteo de clientes en by-client
 */

const db = require('../config/db');

const VENDEDOR = '02';
const CURRENT_YEAR = 2026;
const LACLAE_SALES_FILTER = "TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')";

async function testByClient() {
  try {
    await db.initDb();
    console.log('✅ Conectado\n');

    // Simular la nueva query del endpoint by-client
    console.log('='.repeat(70));
    console.log('SIMULANDO NUEVO ENDPOINT BY-CLIENT');
    console.log('='.repeat(70));

    const r1VendorFilter = `AND R1_T8CDVD = '${VENDEDOR}'`;
    const yearsFilter = CURRENT_YEAR;
    const monthsFilter = '1,2,3,4,5,6,7,8,9,10,11,12';

    // Query de conteo
    const countResult = await db.query(`
      SELECT COUNT(DISTINCT R.LCCDCL) as TOTAL
      FROM (
          SELECT DISTINCT LCCDCL, R1_T8CDVD
          FROM DSED.LACLAE
          WHERE R1_T8CDVD IS NOT NULL AND LCCDCL IS NOT NULL
          ${r1VendorFilter.replace(/R\./g, '')}
      ) R
      LEFT JOIN DSEDAC.CLI C ON R.LCCDCL = C.CODIGOCLIENTE
      WHERE C.ANOBAJA = 0
    `, false, false);

    console.log(`\n1. Total clientes (rutero activos): ${countResult[0]?.TOTAL || 0}`);

    // Query de datos con ventas
    const dataResult = await db.query(`
      SELECT 
        R.LCCDCL as CODE,
        COALESCE(NULLIF(TRIM(MIN(C.NOMBREALTERNATIVO)), ''), MIN(C.NOMBRECLIENTE)) as NAME,
        COALESCE(S.SALES, 0) as SALES,
        COALESCE(S.COST, 0) as COST
      FROM (
        SELECT DISTINCT LCCDCL, R1_T8CDVD
        FROM DSED.LACLAE
        WHERE R1_T8CDVD IS NOT NULL AND LCCDCL IS NOT NULL
        ${r1VendorFilter.replace(/R\./g, '')}
      ) R
      LEFT JOIN DSEDAC.CLI C ON R.LCCDCL = C.CODIGOCLIENTE
      LEFT JOIN (
        SELECT LCCDCL, SUM(LCIMVT) as SALES, SUM(LCIMCT) as COST
        FROM DSED.LACLAE
        WHERE LCAADC IN(${yearsFilter})
          AND LCMMDC IN(${monthsFilter})
          AND ${LACLAE_SALES_FILTER}
        GROUP BY LCCDCL
      ) S ON R.LCCDCL = S.LCCDCL
      WHERE C.ANOBAJA = 0
      GROUP BY R.LCCDCL, S.SALES, S.COST
      ORDER BY COALESCE(S.SALES, 0) DESC
      FETCH FIRST 500 ROWS ONLY
    `, false, false);

    console.log(`2. Clientes retornados (con limit 500): ${dataResult.length}`);
    
    // Analizar resultados
    const conVentas = dataResult.filter(r => parseFloat(r.SALES) > 0);
    const sinVentas = dataResult.filter(r => parseFloat(r.SALES) === 0);
    
    console.log(`\n3. Análisis:`);
    console.log(`   - Con ventas en ${CURRENT_YEAR}: ${conVentas.length}`);
    console.log(`   - Sin ventas en ${CURRENT_YEAR}: ${sinVentas.length}`);
    
    if (sinVentas.length > 0) {
      console.log(`\n4. Primeros 10 clientes sin ventas en ${CURRENT_YEAR}:`);
      sinVentas.slice(0, 10).forEach(c => {
        console.log(`   - ${c.CODE}: ${c.NAME}`);
      });
    }

    console.log('\n✅ Test completado');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

testByClient();
