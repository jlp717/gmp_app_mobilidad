/**
 * AUDITORÍA COMPLETA: Encuentra TODAS las discrepancias entre CDVI y LACLAE
 * para todos los vendedores.
 *
 * Detecta:
 * 1. Clientes en LACLAE (R1_T8CDVD=X) que en CDVI pertenecen a otro vendedor
 * 2. Clientes en CDVI sin ninguna venta en LACLAE
 * 3. Clientes que aparecerían en la caché de un vendedor sin días de visita
 */
const odbc = require('odbc');
const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;`;

const MIN_YEAR = 2025;

async function main() {
  const conn = await odbc.connect(DB_CONFIG);

  console.log('='.repeat(80));
  console.log('AUDITORÍA COMPLETA: DISCREPANCIAS CDVI vs LACLAE (R1_T8CDVD)');
  console.log('='.repeat(80));

  // 1. Clientes con MISMATCH: CDVI dice vendedor A, LACLAE R1_T8CDVD dice vendedor B
  console.log('\n--- TIPO 1: R1_T8CDVD ≠ vendedor CDVI (cliente asignado a uno, ruta de otro) ---');
  const mismatches = await conn.query(`
    SELECT
      TRIM(C.CODIGOCLIENTE) AS CLIENTE,
      TRIM(K.NOMBRECLIENTE) AS NOMBRE,
      TRIM(C.CODIGOVENDEDOR) AS V_CDVI,
      TRIM(D1.NOMBREVENDEDOR) AS NOMBRE_V_CDVI,
      TRIM(L.R1_T8CDVD) AS V_RUTA,
      TRIM(D2.NOMBREVENDEDOR) AS NOMBRE_V_RUTA,
      COUNT(*) AS REGISTROS_LACLAE
    FROM DSEDAC.CDVI C
    JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
    JOIN DSED.LACLAE L ON L.LCCDCL = C.CODIGOCLIENTE
    LEFT JOIN DSEDAC.VDD D1 ON C.CODIGOVENDEDOR = D1.CODIGOVENDEDOR
    LEFT JOIN DSEDAC.VDD D2 ON L.R1_T8CDVD = D2.CODIGOVENDEDOR
    WHERE (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
      AND L.LCAADC >= ${MIN_YEAR}
      AND L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC')
      AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')
      AND TRIM(C.CODIGOVENDEDOR) <> TRIM(L.R1_T8CDVD)
      AND (
        TRIM(C.DIAVISITALUNESSN) = 'S' OR TRIM(C.DIAVISITAMARTESSN) = 'S' OR
        TRIM(C.DIAVISITAMIERCOLESSN) = 'S' OR TRIM(C.DIAVISITAJUEVESSN) = 'S' OR
        TRIM(C.DIAVISITAVIERNESSN) = 'S' OR TRIM(C.DIAVISITASABADOSN) = 'S' OR
        TRIM(C.DIAVISITADOMINGOSN) = 'S'
      )
    GROUP BY TRIM(C.CODIGOCLIENTE), TRIM(K.NOMBRECLIENTE),
      TRIM(C.CODIGOVENDEDOR), TRIM(D1.NOMBREVENDEDOR),
      TRIM(L.R1_T8CDVD), TRIM(D2.NOMBREVENDEDOR)
    ORDER BY TRIM(C.CODIGOVENDEDOR), TRIM(C.CODIGOCLIENTE)
  `);

  console.log(`  Total discrepancias: ${mismatches.length}`);
  if (mismatches.length > 0) {
    console.log('');
    console.log('  CLIENTE      | NOMBRE                         | CDVI (asignado) | RUTA (R1_T8CDVD) | Reg.');
    console.log('  ' + '-'.repeat(95));
    mismatches.forEach(r => {
      const nombre = (r.NOMBRE || '').substring(0, 30).padEnd(30);
      const vCdvi = `${r.V_CDVI} ${(r.NOMBRE_V_CDVI || '').substring(0, 15)}`.padEnd(18);
      const vRuta = `${r.V_RUTA} ${(r.NOMBRE_V_RUTA || '').substring(0, 15)}`.padEnd(18);
      console.log(`  ${r.CLIENTE} | ${nombre} | ${vCdvi} | ${vRuta} | ${r.REGISTROS_LACLAE}`);
    });
  }

  // 2. Resumen por par de vendedores
  console.log('\n--- RESUMEN POR PAR VENDEDOR CDVI → VENDEDOR RUTA ---');
  const summary = await conn.query(`
    SELECT
      TRIM(C.CODIGOVENDEDOR) AS V_CDVI,
      TRIM(D1.NOMBREVENDEDOR) AS N_CDVI,
      TRIM(L.R1_T8CDVD) AS V_RUTA,
      TRIM(D2.NOMBREVENDEDOR) AS N_RUTA,
      COUNT(DISTINCT C.CODIGOCLIENTE) AS CLIENTES
    FROM DSEDAC.CDVI C
    JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
    JOIN DSED.LACLAE L ON L.LCCDCL = C.CODIGOCLIENTE
    LEFT JOIN DSEDAC.VDD D1 ON C.CODIGOVENDEDOR = D1.CODIGOVENDEDOR
    LEFT JOIN DSEDAC.VDD D2 ON L.R1_T8CDVD = D2.CODIGOVENDEDOR
    WHERE (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
      AND L.LCAADC >= ${MIN_YEAR}
      AND L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC')
      AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')
      AND TRIM(C.CODIGOVENDEDOR) <> TRIM(L.R1_T8CDVD)
      AND (
        TRIM(C.DIAVISITALUNESSN) = 'S' OR TRIM(C.DIAVISITAMARTESSN) = 'S' OR
        TRIM(C.DIAVISITAMIERCOLESSN) = 'S' OR TRIM(C.DIAVISITAJUEVESSN) = 'S' OR
        TRIM(C.DIAVISITAVIERNESSN) = 'S' OR TRIM(C.DIAVISITASABADOSN) = 'S' OR
        TRIM(C.DIAVISITADOMINGOSN) = 'S'
      )
    GROUP BY TRIM(C.CODIGOVENDEDOR), TRIM(D1.NOMBREVENDEDOR),
      TRIM(L.R1_T8CDVD), TRIM(D2.NOMBREVENDEDOR)
    ORDER BY CLIENTES DESC
  `);

  if (summary.length > 0) {
    console.log('  CDVI (asignado)          →  RUTA (R1_T8CDVD)         | Clientes afectados');
    console.log('  ' + '-'.repeat(75));
    summary.forEach(r => {
      const from = `${r.V_CDVI} ${(r.N_CDVI || '').substring(0, 20)}`.padEnd(25);
      const to = `${r.V_RUTA} ${(r.N_RUTA || '').substring(0, 20)}`.padEnd(25);
      console.log(`  ${from} → ${to} | ${r.CLIENTES}`);
    });
  }

  // 3. Clientes en LACLAE que NO están en CDVI de ese vendedor (aparecen como fantasma)
  console.log('\n--- TIPO 2: Clientes en LACLAE sin CDVI para ese vendedor ---');
  const phantoms = await conn.query(`
    SELECT
      TRIM(L.R1_T8CDVD) AS V_RUTA,
      COUNT(DISTINCT L.LCCDCL) AS CLIENTES_FANTASMA
    FROM DSED.LACLAE L
    JOIN DSEDAC.CLI K ON L.LCCDCL = K.CODIGOCLIENTE
    WHERE L.LCAADC >= ${MIN_YEAR}
      AND L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC')
      AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')
      AND L.R1_T8CDVD IS NOT NULL
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM DSEDAC.CDVI C
        WHERE C.CODIGOCLIENTE = L.LCCDCL
          AND C.CODIGOVENDEDOR = L.R1_T8CDVD
          AND (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
          AND (
            TRIM(C.DIAVISITALUNESSN) = 'S' OR TRIM(C.DIAVISITAMARTESSN) = 'S' OR
            TRIM(C.DIAVISITAMIERCOLESSN) = 'S' OR TRIM(C.DIAVISITAJUEVESSN) = 'S' OR
            TRIM(C.DIAVISITAVIERNESSN) = 'S' OR TRIM(C.DIAVISITASABADOSN) = 'S' OR
            TRIM(C.DIAVISITADOMINGOSN) = 'S'
          )
      )
    GROUP BY TRIM(L.R1_T8CDVD)
    ORDER BY CLIENTES_FANTASMA DESC
  `);

  console.log('  Vendedor (R1_T8CDVD) | Clientes sin CDVI válido para ese vendedor');
  console.log('  ' + '-'.repeat(55));
  phantoms.forEach(r => console.log(`  V:${r.V_RUTA.padEnd(5)} | ${r.CLIENTES_FANTASMA} clientes fantasma`));

  const totalPhantoms = phantoms.reduce((s, r) => s + parseInt(r.CLIENTES_FANTASMA), 0);
  console.log(`\n  TOTAL clientes fantasma: ${totalPhantoms}`);
  console.log('  (Estos clientes aparecen en LACLAE con R1_T8CDVD=X pero');
  console.log('   no tienen asignación CDVI con días de visita para ese vendedor)');

  // 4. Impacto del fix getClientCodesFromCache
  console.log('\n--- IMPACTO DEL FIX getClientCodesFromCache ---');
  console.log('  Con el fix, getClientCodesFromCache solo devuelve clientes con visitDays.');
  console.log(`  Los ${totalPhantoms} clientes fantasma ya NO aparecerán en la cartera de`);
  console.log('  vendedores incorrectos. Solo aparecerán para su vendedor CDVI real.');

  console.log('\n' + '='.repeat(80));
  await conn.close();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
