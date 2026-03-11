/**
 * Simula exactamente la query de clients.js para vendedor 33 con el cliente 6020
 */
const odbc = require('odbc');
const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;`;

const CLIENT = '4300006020';
const MIN_YEAR = 2023;

async function main() {
  const conn = await odbc.connect(DB_CONFIG);

  // Simular la query EXACTA de clients.js para vendedor 33
  // clientCodesFilter incluye el cliente (viene de getClientCodesFromCache('33'))
  const vendedorFilter = `AND TRIM(LCCDVD) IN ('33')`;

  console.log('='.repeat(60));
  console.log('Test 1: Query con clientCodesFilter (como getClientCodesFromCache)');
  console.log('='.repeat(60));

  const result = await conn.query(`
    SELECT
      TRIM(C.CODIGOCLIENTE) as CODE,
      TRIM(COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE))) as NAME,
      COALESCE(S.TOTAL_PURCHASES, 0) as SALES,
      LV.LAST_VENDOR as VENDOR_CODE
    FROM DSEDAC.CLI C
    LEFT JOIN (
      SELECT
        LCCDCL as CLIENT_CODE,
        SUM(LCIMVT) as TOTAL_PURCHASES
      FROM DSED.LACLAE
      WHERE LCAADC >= ${MIN_YEAR}
        AND TPDC = 'LAC'
        AND LCTPVT IN ('CC', 'VC')
        AND LCCLLN IN ('AB', 'VT')
        AND LCSRAB NOT IN ('N', 'Z')
        ${vendedorFilter.replace(/L\./g, '')}
      GROUP BY LCCDCL
    ) S ON C.CODIGOCLIENTE = S.CLIENT_CODE
    LEFT JOIN LATERAL (
      SELECT LCCDVD as LAST_VENDOR
      FROM DSED.LACLAE
      WHERE LCCDCL = S.CLIENT_CODE
        AND LCAADC >= ${MIN_YEAR}
        AND TPDC = 'LAC'
        AND LCTPVT IN ('CC', 'VC')
        AND LCCLLN IN ('AB', 'VT')
        AND LCSRAB NOT IN ('N', 'Z')
      ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC
      FETCH FIRST 1 ROWS ONLY
    ) LV ON 1=1
    WHERE C.ANOBAJA = 0
      AND C.CODIGOCLIENTE IN ('${CLIENT}')
    ORDER BY COALESCE(S.TOTAL_PURCHASES, 0) DESC
  `);

  console.log(`  Resultados: ${result.length}`);
  result.forEach(r => {
    console.log(`  CODE=${r.CODE} | NAME=${r.NAME} | SALES=${r.SALES} | VENDOR=${r.VENDOR_CODE}`);
  });

  // Test 2: Misma query para vendedor 93
  console.log('\n' + '='.repeat(60));
  console.log('Test 2: Query para vendedor 93');
  console.log('='.repeat(60));

  const result2 = await conn.query(`
    SELECT
      TRIM(C.CODIGOCLIENTE) as CODE,
      TRIM(COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE))) as NAME,
      COALESCE(S.TOTAL_PURCHASES, 0) as SALES,
      LV.LAST_VENDOR as VENDOR_CODE
    FROM DSEDAC.CLI C
    LEFT JOIN (
      SELECT
        LCCDCL as CLIENT_CODE,
        SUM(LCIMVT) as TOTAL_PURCHASES
      FROM DSED.LACLAE
      WHERE LCAADC >= ${MIN_YEAR}
        AND TPDC = 'LAC'
        AND LCTPVT IN ('CC', 'VC')
        AND LCCLLN IN ('AB', 'VT')
        AND LCSRAB NOT IN ('N', 'Z')
        AND TRIM(LCCDVD) IN ('93')
      GROUP BY LCCDCL
    ) S ON C.CODIGOCLIENTE = S.CLIENT_CODE
    LEFT JOIN LATERAL (
      SELECT LCCDVD as LAST_VENDOR
      FROM DSED.LACLAE
      WHERE LCCDCL = S.CLIENT_CODE
        AND LCAADC >= ${MIN_YEAR}
        AND TPDC = 'LAC'
        AND LCTPVT IN ('CC', 'VC')
        AND LCCLLN IN ('AB', 'VT')
        AND LCSRAB NOT IN ('N', 'Z')
      ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC
      FETCH FIRST 1 ROWS ONLY
    ) LV ON 1=1
    WHERE C.ANOBAJA = 0
      AND C.CODIGOCLIENTE IN ('${CLIENT}')
    ORDER BY COALESCE(S.TOTAL_PURCHASES, 0) DESC
  `);

  console.log(`  Resultados: ${result2.length}`);
  result2.forEach(r => {
    console.log(`  CODE=${r.CODE} | NAME=${r.NAME} | SALES=${r.SALES} | VENDOR=${r.VENDOR_CODE}`);
  });

  // Test 3: cuantos clientes tiene el 33 en caché vs en LACLAE
  console.log('\n' + '='.repeat(60));
  console.log('Test 3: Clientes que estan en CDVI(33) pero NO en LACLAE(33)');
  console.log('='.repeat(60));

  const cdviOnly = await conn.query(`
    SELECT COUNT(*) AS TOTAL FROM DSEDAC.CDVI C
    JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
    WHERE TRIM(C.CODIGOVENDEDOR) = '33'
      AND (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
      AND (TRIM(C.DIAVISITALUNESSN) = 'S' OR TRIM(C.DIAVISITAMARTESSN) = 'S' OR
           TRIM(C.DIAVISITAMIERCOLESSN) = 'S' OR TRIM(C.DIAVISITAJUEVESSN) = 'S' OR
           TRIM(C.DIAVISITAVIERNESSN) = 'S' OR TRIM(C.DIAVISITASABADOSN) = 'S' OR
           TRIM(C.DIAVISITADOMINGOSN) = 'S')
      AND C.CODIGOCLIENTE NOT IN (
        SELECT DISTINCT LCCDCL FROM DSED.LACLAE
        WHERE TRIM(R1_T8CDVD) = '33'
          AND LCAADC >= ${MIN_YEAR}
          AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
      )
  `);
  console.log(`  Clientes en CDVI(33) sin ventas en LACLAE(33): ${cdviOnly[0].TOTAL}`);
  console.log('  → Estos clientes aparecerán en el rutero pero NO en la pestaña clientes');

  await conn.close();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
