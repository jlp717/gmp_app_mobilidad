/**
 * Script para probar la optimización del endpoint by-client
 */

const db = require('../config/db');
const { loadLaclaeCache, getClientCodesFromCache } = require('../services/laclae');

const VENDEDOR = '02';
const CURRENT_YEAR = 2026;
const LACLAE_SALES_FILTER = "TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')";

async function testOptimization() {
  try {
    await db.initDb();
    console.log('✅ Conectado\n');

    // Cargar el caché
    console.log('Cargando LACLAE cache...');
    const cacheStart = Date.now();
    await loadLaclaeCache();
    console.log(`Cache cargado en ${Date.now() - cacheStart}ms\n`);

    // Obtener clientes del caché
    console.log('='.repeat(70));
    console.log('TEST: Obtener clientes del cache vs query directa');
    console.log('='.repeat(70));

    // Método OPTIMIZADO: usar cache
    const cacheQueryStart = Date.now();
    const cachedClients = getClientCodesFromCache(VENDEDOR);
    const cacheTime = Date.now() - cacheQueryStart;
    console.log(`\n1. CACHE: ${cachedClients?.length || 0} clientes en ${cacheTime}ms`);

    // Método ANTERIOR: query directa (pesada)
    const directQueryStart = Date.now();
    const directResult = await db.query(`
      SELECT DISTINCT LCCDCL as CODE
      FROM DSED.LACLAE
      WHERE R1_T8CDVD = '${VENDEDOR}'
        AND R1_T8CDVD IS NOT NULL AND LCCDCL IS NOT NULL
    `, false, false);
    const directTime = Date.now() - directQueryStart;
    console.log(`2. QUERY DIRECTA: ${directResult.length} clientes en ${directTime}ms`);

    console.log(`\n⚡ Mejora: ${Math.round(directTime / Math.max(cacheTime, 1))}x más rápido con cache`);

    // Probar la query completa optimizada
    console.log('\n' + '='.repeat(70));
    console.log('TEST: Query completa by-client optimizada');
    console.log('='.repeat(70));

    if (cachedClients && cachedClients.length > 0) {
      const clientCodesFilter = cachedClients.map(c => `'${c}'`).join(',');
      
      const optimizedStart = Date.now();
      const optimizedResult = await db.query(`
        SELECT 
          C.CODIGOCLIENTE as CODE,
          COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), C.NOMBRECLIENTE) as NAME,
          C.POBLACION as CITY,
          COALESCE(S.SALES, 0) as SALES
        FROM DSEDAC.CLI C
        LEFT JOIN (
          SELECT LCCDCL, SUM(LCIMVT) as SALES
          FROM DSED.LACLAE
          WHERE LCAADC = ${CURRENT_YEAR}
            AND LCMMDC IN(1,2,3,4,5,6,7,8,9,10,11,12)
            AND ${LACLAE_SALES_FILTER}
            AND LCCDCL IN (${clientCodesFilter})
          GROUP BY LCCDCL
        ) S ON C.CODIGOCLIENTE = S.LCCDCL
        WHERE C.CODIGOCLIENTE IN (${clientCodesFilter})
          AND C.ANOBAJA = 0
        ORDER BY COALESCE(S.SALES, 0) DESC
        FETCH FIRST 500 ROWS ONLY
      `, false, false);
      const optimizedTime = Date.now() - optimizedStart;
      
      console.log(`\n3. QUERY OPTIMIZADA: ${optimizedResult.length} clientes en ${optimizedTime}ms`);

      // Comparar con query anterior (pesada)
      const oldQueryStart = Date.now();
      const oldResult = await db.query(`
        SELECT 
          R.LCCDCL as CODE,
          COALESCE(NULLIF(TRIM(MIN(C.NOMBREALTERNATIVO)), ''), MIN(C.NOMBRECLIENTE)) as NAME,
          COALESCE(S.SALES, 0) as SALES
        FROM (
          SELECT DISTINCT LCCDCL, R1_T8CDVD
          FROM DSED.LACLAE
          WHERE R1_T8CDVD IS NOT NULL AND LCCDCL IS NOT NULL
          AND R1_T8CDVD = '${VENDEDOR}'
        ) R
        LEFT JOIN DSEDAC.CLI C ON R.LCCDCL = C.CODIGOCLIENTE
        LEFT JOIN (
          SELECT LCCDCL, SUM(LCIMVT) as SALES
          FROM DSED.LACLAE
          WHERE LCAADC = ${CURRENT_YEAR}
            AND LCMMDC IN(1,2,3,4,5,6,7,8,9,10,11,12)
            AND ${LACLAE_SALES_FILTER}
          GROUP BY LCCDCL
        ) S ON R.LCCDCL = S.LCCDCL
        WHERE C.ANOBAJA = 0
        GROUP BY R.LCCDCL, S.SALES
        ORDER BY COALESCE(S.SALES, 0) DESC
        FETCH FIRST 500 ROWS ONLY
      `, false, false);
      const oldTime = Date.now() - oldQueryStart;
      
      console.log(`4. QUERY ANTERIOR: ${oldResult.length} clientes en ${oldTime}ms`);
      console.log(`\n⚡ Mejora en query completa: ${Math.round(oldTime / Math.max(optimizedTime, 1))}x más rápido`);
    }

    console.log('\n✅ Test completado');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

testOptimization();
