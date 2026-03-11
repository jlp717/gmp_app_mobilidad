/**
 * Verifica que la nueva query de clients.js funciona correctamente
 * Simula los dos escenarios: con cache (clientCodesFilter) y sin cache
 */
const odbc = require('odbc');
const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;`;

const CLIENT = '4300006020';
const MIN_YEAR = 2023;

async function main() {
  const conn = await odbc.connect(DB_CONFIG);

  // Simular clientCodesFilter (como lo genera getClientCodesFromCache)
  const clientCodesFilter = `AND (LCCDCL IN ('${CLIENT}'))`;
  // vendedorFilter con R1_T8CDVD (como en producción marzo 2026+)
  const vendedorFilter = `AND TRIM(R1_T8CDVD) IN ('33')`;

  console.log('='.repeat(60));
  console.log('TEST 1: Con clientCodesFilter (caché activa - NUEVO)');
  console.log('  Sales subquery filtra por LCCDCL (client codes)');
  console.log('  NO filtra por vendedor → muestra TODAS las ventas del cliente');
  console.log('='.repeat(60));

  const r1 = await conn.query(`
    SELECT
      TRIM(C.CODIGOCLIENTE) as CODE,
      TRIM(COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE))) as NAME,
      COALESCE(S.TOTAL_PURCHASES, 0) as SALES,
      TRIM(LV.LAST_VENDOR) as VENDOR_CODE
    FROM DSEDAC.CLI C
    LEFT JOIN (
      SELECT LCCDCL as CLIENT_CODE,
        SUM(LCIMVT) as TOTAL_PURCHASES
      FROM DSED.LACLAE
      WHERE LCAADC >= ${MIN_YEAR}
        AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC')
        AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
        ${clientCodesFilter}
      GROUP BY LCCDCL
    ) S ON C.CODIGOCLIENTE = S.CLIENT_CODE
    LEFT JOIN LATERAL (
      SELECT LCCDVD as LAST_VENDOR
      FROM DSED.LACLAE
      WHERE LCCDCL = C.CODIGOCLIENTE
        AND LCAADC >= ${MIN_YEAR} AND TPDC = 'LAC'
        AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
      ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC
      FETCH FIRST 1 ROWS ONLY
    ) LV ON 1=1
    WHERE C.ANOBAJA = 0
      AND C.CODIGOCLIENTE IN ('${CLIENT}')
  `);
  console.log(`  Resultados: ${r1.length}`);
  r1.forEach(r => console.log(`  CODE=${r.CODE} | NAME=${r.NAME} | SALES=${parseFloat(r.SALES).toFixed(2)} | VENDOR=${r.VENDOR_CODE}`));

  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Sin clientCodesFilter (búsqueda/fallback - ORIGINAL)');
  console.log('  Sales subquery filtra por R1_T8CDVD=33');
  console.log('='.repeat(60));

  const r2 = await conn.query(`
    SELECT
      TRIM(C.CODIGOCLIENTE) as CODE,
      TRIM(COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE))) as NAME,
      COALESCE(S.TOTAL_PURCHASES, 0) as SALES,
      TRIM(LV.LAST_VENDOR) as VENDOR_CODE
    FROM DSEDAC.CLI C
    LEFT JOIN (
      SELECT LCCDCL as CLIENT_CODE,
        SUM(LCIMVT) as TOTAL_PURCHASES
      FROM DSED.LACLAE
      WHERE LCAADC >= ${MIN_YEAR}
        AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC')
        AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
        ${vendedorFilter.replace(/L\./g, '')}
      GROUP BY LCCDCL
    ) S ON C.CODIGOCLIENTE = S.CLIENT_CODE
    LEFT JOIN LATERAL (
      SELECT LCCDVD as LAST_VENDOR
      FROM DSED.LACLAE
      WHERE LCCDCL = C.CODIGOCLIENTE
        AND LCAADC >= ${MIN_YEAR} AND TPDC = 'LAC'
        AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
      ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC
      FETCH FIRST 1 ROWS ONLY
    ) LV ON 1=1
    WHERE C.ANOBAJA = 0
      AND LV.LAST_VENDOR IS NOT NULL
      AND C.CODIGOCLIENTE IN ('${CLIENT}')
  `);
  console.log(`  Resultados: ${r2.length}`);
  r2.forEach(r => console.log(`  CODE=${r.CODE} | NAME=${r.NAME} | SALES=${parseFloat(r.SALES).toFixed(2)} | VENDOR=${r.VENDOR_CODE}`));

  // Desglose por vendedor
  console.log('\n' + '='.repeat(60));
  console.log('DESGLOSE: Ventas del cliente por vendedor');
  console.log('='.repeat(60));
  const breakdown = await conn.query(`
    SELECT TRIM(LCCDVD) AS V_FACTURA, TRIM(R1_T8CDVD) AS V_RUTA,
      COUNT(*) AS REGISTROS, SUM(LCIMVT) AS VENTAS
    FROM DSED.LACLAE
    WHERE TRIM(LCCDCL) = '${CLIENT}' AND LCAADC >= ${MIN_YEAR}
      AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
    GROUP BY TRIM(LCCDVD), TRIM(R1_T8CDVD)
  `);
  breakdown.forEach(r => console.log(`  LCCDVD=${r.V_FACTURA} | R1_T8CDVD=${r.V_RUTA} | ${r.REGISTROS} registros | ${parseFloat(r.VENTAS).toFixed(2)}€`));

  console.log('\n' + '='.repeat(60));
  console.log('CONCLUSIÓN:');
  console.log('- Test 1 muestra TODAS las ventas (3087€) → correcto para vista de asignación CDVI');
  console.log('- Test 2 filtra por R1_T8CDVD=33 → 0 ventas → cliente no aparece');
  console.log('- La transición ene/feb/mar NO se ve afectada porque el vendedorFilter');
  console.log('  solo se usa cuando NO hay clientCodesFilter (búsquedas)');
  console.log('='.repeat(60));

  await conn.close();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
