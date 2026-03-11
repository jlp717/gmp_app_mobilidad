/**
 * Verificar impacto del fix de entradas zombi en CDVI
 * Compara cuántos registros se cargan antes vs después del filtro
 */
const odbc = require('odbc');

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;`;

async function main() {
  const conn = await odbc.connect(DB_CONFIG);

  // Total CDVI sin filtro (antes)
  const antes = await conn.query(`
    SELECT COUNT(*) AS TOTAL FROM DSEDAC.CDVI C
    JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
    WHERE (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
  `);

  // Total CDVI con filtro (después)
  const despues = await conn.query(`
    SELECT COUNT(*) AS TOTAL FROM DSEDAC.CDVI C
    JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
    WHERE (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
      AND (
        TRIM(C.DIAVISITALUNESSN) = 'S' OR TRIM(C.DIAVISITAMARTESSN) = 'S' OR
        TRIM(C.DIAVISITAMIERCOLESSN) = 'S' OR TRIM(C.DIAVISITAJUEVESSN) = 'S' OR
        TRIM(C.DIAVISITAVIERNESSN) = 'S' OR TRIM(C.DIAVISITASABADOSN) = 'S' OR
        TRIM(C.DIAVISITADOMINGOSN) = 'S'
      )
  `);

  // Entradas zombi (las que se eliminarían)
  const zombis = await conn.query(`
    SELECT COUNT(*) AS TOTAL FROM DSEDAC.CDVI C
    JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
    WHERE (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
      AND TRIM(COALESCE(C.DIAVISITALUNESSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITAMARTESSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITAMIERCOLESSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITAJUEVESSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITAVIERNESSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITASABADOSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITADOMINGOSN,'')) <> 'S'
  `);

  // Ejemplos de zombis
  const ejemplos = await conn.query(`
    SELECT TRIM(C.CODIGOVENDEDOR) AS VENDEDOR, TRIM(C.CODIGOCLIENTE) AS CLIENTE,
      TRIM(K.NOMBRECLIENTE) AS NOMBRE
    FROM DSEDAC.CDVI C
    JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
    WHERE (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
      AND TRIM(COALESCE(C.DIAVISITALUNESSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITAMARTESSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITAMIERCOLESSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITAJUEVESSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITAVIERNESSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITASABADOSN,'')) <> 'S'
      AND TRIM(COALESCE(C.DIAVISITADOMINGOSN,'')) <> 'S'
    FETCH FIRST 15 ROWS ONLY
  `);

  // Verificar que el cliente 6020 para vendedor 33 NO es zombi (debe pasar el filtro)
  const check6020 = await conn.query(`
    SELECT TRIM(C.CODIGOVENDEDOR) AS V, C.DIAVISITAMIERCOLESSN AS MIE
    FROM DSEDAC.CDVI C
    WHERE TRIM(C.CODIGOCLIENTE) = '4300006020' AND TRIM(C.CODIGOVENDEDOR) = '33'
      AND (
        TRIM(C.DIAVISITALUNESSN) = 'S' OR TRIM(C.DIAVISITAMARTESSN) = 'S' OR
        TRIM(C.DIAVISITAMIERCOLESSN) = 'S' OR TRIM(C.DIAVISITAJUEVESSN) = 'S' OR
        TRIM(C.DIAVISITAVIERNESSN) = 'S' OR TRIM(C.DIAVISITASABADOSN) = 'S' OR
        TRIM(C.DIAVISITADOMINGOSN) = 'S'
      )
  `);

  console.log('='.repeat(60));
  console.log('IMPACTO DEL FIX');
  console.log('='.repeat(60));
  console.log(`Registros CDVI ANTES del filtro:  ${antes[0].TOTAL}`);
  console.log(`Registros CDVI DESPUÉS del filtro: ${despues[0].TOTAL}`);
  console.log(`Entradas ZOMBI eliminadas:         ${zombis[0].TOTAL}`);
  console.log(`Porcentaje eliminado:              ${((zombis[0].TOTAL / antes[0].TOTAL) * 100).toFixed(1)}%`);

  console.log('\n--- Ejemplos de zombis (primeros 15) ---');
  ejemplos.forEach(e => console.log(`  V:${e.VENDEDOR} | ${e.CLIENTE} | ${e.NOMBRE}`));

  console.log(`\n--- Verificación cliente 6020 (vendedor 33) ---`);
  if (check6020.length > 0) {
    console.log(`  ✅ PASA el filtro correctamente (MIE=${check6020[0].MIE})`);
  } else {
    console.log(`  ❌ ERROR: El cliente 6020 para vendedor 33 NO pasa el filtro`);
  }

  await conn.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
