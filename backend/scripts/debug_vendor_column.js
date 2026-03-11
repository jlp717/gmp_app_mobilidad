/**
 * Diagnóstico: R1_T8CDVD vs LCCDVD para cliente 6020
 * El problema: CDVI dice vendedor 33, pero LACLAE tiene R1_T8CDVD=93
 */
const odbc = require('odbc');
const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;`;

const CLIENT = '4300006020';

async function main() {
  const conn = await odbc.connect(DB_CONFIG);

  console.log('='.repeat(60));
  console.log('DIAGNÓSTICO R1_T8CDVD vs LCCDVD para cliente 6020');
  console.log('='.repeat(60));

  // 1. Ventas por LCCDVD (facturación)
  console.log('\n[1] Ventas por LCCDVD (vendedor facturación):');
  const byLCCDVD = await conn.query(`
    SELECT TRIM(LCCDVD) AS VENDEDOR, COUNT(*) AS REGISTROS, SUM(LCIMVT) AS VENTAS
    FROM DSED.LACLAE
    WHERE TRIM(LCCDCL) = '${CLIENT}' AND LCAADC >= 2025
      AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
    GROUP BY TRIM(LCCDVD)
  `);
  byLCCDVD.forEach(r => console.log(`  LCCDVD=${r.VENDEDOR}: ${r.REGISTROS} registros, ${parseFloat(r.VENTAS).toFixed(2)}€`));

  // 2. Ventas por R1_T8CDVD (ruta)
  console.log('\n[2] Ventas por R1_T8CDVD (vendedor ruta):');
  const byR1 = await conn.query(`
    SELECT TRIM(R1_T8CDVD) AS VENDEDOR, COUNT(*) AS REGISTROS, SUM(LCIMVT) AS VENTAS
    FROM DSED.LACLAE
    WHERE TRIM(LCCDCL) = '${CLIENT}' AND LCAADC >= 2025
      AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
    GROUP BY TRIM(R1_T8CDVD)
  `);
  byR1.forEach(r => console.log(`  R1_T8CDVD=${r.VENDEDOR}: ${r.REGISTROS} registros, ${parseFloat(r.VENTAS).toFixed(2)}€`));

  // 3. Registros más recientes con ambos campos
  console.log('\n[3] Registros más recientes (ambos campos):');
  const recent = await conn.query(`
    SELECT TRIM(LCCDVD) AS V_FACTURA, TRIM(R1_T8CDVD) AS V_RUTA,
      LCAADC AS ANNO, LCMMDC AS MES, LCDDDC AS DIA, LCIMVT AS IMPORTE
    FROM DSED.LACLAE
    WHERE TRIM(LCCDCL) = '${CLIENT}' AND LCAADC >= 2025
      AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
    ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC
    FETCH FIRST 10 ROWS ONLY
  `);
  recent.forEach(r => {
    const mismatch = r.V_FACTURA !== r.V_RUTA ? ' ⚠️ MISMATCH' : '';
    console.log(`  ${r.ANNO}-${String(r.MES).padStart(2,'0')}-${String(r.DIA).padStart(2,'0')} | LCCDVD=${r.V_FACTURA} | R1_T8CDVD=${r.V_RUTA} | ${parseFloat(r.IMPORTE).toFixed(2)}€${mismatch}`);
  });

  // 4. CDVI
  console.log('\n[4] CDVI (asignación de ruta):');
  const cdvi = await conn.query(`
    SELECT TRIM(CODIGOVENDEDOR) AS V, DIAVISITAMIERCOLESSN AS MIE
    FROM DSEDAC.CDVI WHERE TRIM(CODIGOCLIENTE) = '${CLIENT}'
  `);
  cdvi.forEach(r => console.log(`  CDVI V:${r.V} | Miércoles=${r.MIE}`));

  // 5. Cuántos clientes del vendedor 33 tienen este problema
  console.log('\n[5] Cuántos clientes del V33 en CDVI tienen R1_T8CDVD distinto:');
  const mismatchCount = await conn.query(`
    SELECT COUNT(DISTINCT C.CODIGOCLIENTE) AS TOTAL
    FROM DSEDAC.CDVI C
    JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
    WHERE TRIM(C.CODIGOVENDEDOR) = '33'
      AND (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
      AND (TRIM(C.DIAVISITALUNESSN) = 'S' OR TRIM(C.DIAVISITAMARTESSN) = 'S' OR
           TRIM(C.DIAVISITAMIERCOLESSN) = 'S' OR TRIM(C.DIAVISITAJUEVESSN) = 'S' OR
           TRIM(C.DIAVISITAVIERNESSN) = 'S' OR TRIM(C.DIAVISITASABADOSN) = 'S' OR
           TRIM(C.DIAVISITADOMINGOSN) = 'S')
      AND C.CODIGOCLIENTE IN (
        SELECT DISTINCT LCCDCL FROM DSED.LACLAE
        WHERE TRIM(R1_T8CDVD) <> '33' AND LCAADC >= 2025
          AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC')
      )
      AND C.CODIGOCLIENTE NOT IN (
        SELECT DISTINCT LCCDCL FROM DSED.LACLAE
        WHERE TRIM(R1_T8CDVD) = '33' AND LCAADC >= 2025
          AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC')
      )
  `);
  console.log(`  Clientes CDVI(33) sin ventas R1_T8CDVD=33: ${mismatchCount[0].TOTAL}`);

  console.log('\n' + '='.repeat(60));
  console.log('CONCLUSIÓN:');
  console.log('El cliente tiene LCCDVD=33 (factura) pero R1_T8CDVD=93 (ruta).');
  console.log('Con VENDOR_COLUMN=R1_T8CDVD, clients.js filtra por ruta → no sale para V33.');
  console.log('='.repeat(60));

  await conn.close();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
