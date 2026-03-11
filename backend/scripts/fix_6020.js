/**
 * Script para diagnosticar y corregir el cliente 4300006020
 *
 * PROBLEMA: En CDVI está correctamente asignado al vendedor 33 (miércoles),
 * pero en el rutero aparece para el vendedor 93 en sábado.
 *
 * ANÁLISIS: La caché carga CDVI y LACLAE. Para el vendedor 93, CDVI tiene
 * un registro SIN días de visita, y LACLAE tiene datos históricos.
 * Esto puede causar que el cliente aparezca en la caché del 93 como "huérfano".
 *
 * SOLUCIÓN: Insertar en RUTERO_CONFIG para forzar que el cliente 6020
 * aparezca el miércoles para el vendedor 33.
 */
const odbc = require('odbc');

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;`;

const CLIENT = '4300006020';
const VENDEDOR_CORRECTO = '33';
const DIA_CORRECTO = 'miercoles';

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');

async function main() {
  if (!DRY_RUN && !APPLY) {
    console.log('Uso:');
    console.log('  node scripts/fix_6020.js --dry-run    (solo diagnóstico, no cambia nada)');
    console.log('  node scripts/fix_6020.js --apply      (aplica los cambios)');
    return;
  }

  const conn = await odbc.connect(DB_CONFIG);

  console.log('='.repeat(80));
  console.log(DRY_RUN ? 'MODO DRY-RUN (solo diagnóstico)' : 'MODO APPLY (se aplicarán cambios)');
  console.log('='.repeat(80));

  // 1. Estado actual RUTERO_CONFIG para este cliente (todos los vendedores)
  console.log('\n--- ESTADO ACTUAL RUTERO_CONFIG ---');
  const rutero = await conn.query(`
    SELECT TRIM(VENDEDOR) AS VENDEDOR, TRIM(CLIENTE) AS CLIENTE, TRIM(DIA) AS DIA, ORDEN
    FROM JAVIER.RUTERO_CONFIG
    WHERE TRIM(CLIENTE) = '${CLIENT}'
  `);
  if (rutero.length === 0) {
    console.log('  Sin registros en RUTERO_CONFIG');
  } else {
    rutero.forEach(r => console.log(`  V:${r.VENDEDOR} | Día:${r.DIA} | Orden:${r.ORDEN}`));
  }

  // 2. CDVI para todos los vendedores
  console.log('\n--- CDVI (todos los vendedores) ---');
  const cdvi = await conn.query(`
    SELECT TRIM(CODIGOVENDEDOR) AS V,
      DIAVISITALUNESSN AS L, DIAVISITAMARTESSN AS M, DIAVISITAMIERCOLESSN AS X,
      DIAVISITAJUEVESSN AS J, DIAVISITAVIERNESSN AS VN, DIAVISITASABADOSN AS S
    FROM DSEDAC.CDVI WHERE TRIM(CODIGOCLIENTE) = '${CLIENT}'
  `);
  cdvi.forEach(r => {
    const dias = [];
    if (String(r.L).trim() === 'S') dias.push('L');
    if (String(r.M).trim() === 'S') dias.push('M');
    if (String(r.X).trim() === 'S') dias.push('X');
    if (String(r.J).trim() === 'S') dias.push('J');
    if (String(r.VN).trim() === 'S') dias.push('V');
    if (String(r.S).trim() === 'S') dias.push('S');
    console.log(`  Vendedor ${r.V}: Días=[${dias.join(',')}]`);
  });

  // 3. Simular lo que la caché haría
  console.log('\n--- SIMULACIÓN DE CACHÉ ---');
  // La caché crea entradas para TODOS los registros CDVI, incluso sin días.
  // Luego LACLAE puede añadir datos a esas entradas existentes.
  // El problema: si vendedor 93 tiene un registro CDVI vacío, se crea entrada en caché.
  // Después LACLAE puede añadir días de visita/reparto a esa entrada.

  const laclae93 = await conn.query(`
    SELECT DISTINCT
      TRIM(R1_T8CDVD) AS V,
      R1_T8DIVL AS VL, R1_T8DIVM AS VM, R1_T8DIVX AS VX,
      R1_T8DIVJ AS VJ, R1_T8DIVV AS VV, R1_T8DIVS AS VS, R1_T8DIVD AS VD
    FROM DSED.LACLAE
    WHERE TRIM(LCCDCL) = '${CLIENT}'
      AND LCAADC >= 2025
  `);

  console.log('  LACLAE registros para cliente 6020:');
  laclae93.forEach(r => {
    const dias = [];
    if (String(r.VL).trim() === 'S') dias.push('L');
    if (String(r.VM).trim() === 'S') dias.push('M');
    if (String(r.VX).trim() === 'S') dias.push('X');
    if (String(r.VJ).trim() === 'S') dias.push('J');
    if (String(r.VV).trim() === 'S') dias.push('V');
    if (String(r.VS).trim() === 'S') dias.push('S');
    if (String(r.VD).trim() === 'S') dias.push('D');
    console.log(`    Vendedor ${r.V}: Visita=[${dias.join(',')}]`);
  });

  // 4. Comprobar cuántos clientes tiene el vendedor 33 en miércoles actualmente
  console.log('\n--- CLIENTES DEL VENDEDOR 33 EN MIÉRCOLES (CDVI) ---');
  const mierV33 = await conn.query(`
    SELECT COUNT(*) AS TOTAL FROM DSEDAC.CDVI C
    JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
    WHERE TRIM(C.CODIGOVENDEDOR) = '33'
      AND C.DIAVISITAMIERCOLESSN = 'S'
      AND (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
  `);
  console.log(`  Total clientes vendedor 33 en miércoles: ${mierV33[0].TOTAL}`);

  // 5. Obtener el máximo ORDEN actual en RUTERO_CONFIG para vendedor 33, miércoles
  const maxOrden = await conn.query(`
    SELECT MAX(ORDEN) AS MAXORD FROM JAVIER.RUTERO_CONFIG
    WHERE TRIM(VENDEDOR) = '${VENDEDOR_CORRECTO}' AND TRIM(DIA) = '${DIA_CORRECTO}' AND ORDEN >= 0
  `);
  const nextOrden = (maxOrden[0].MAXORD != null ? maxOrden[0].MAXORD + 10 : 0);
  console.log(`  Máximo ORDEN actual para V33/miércoles: ${maxOrden[0].MAXORD ?? 'N/A'}`);
  console.log(`  Siguiente ORDEN sería: ${nextOrden}`);

  if (APPLY) {
    console.log('\n--- APLICANDO CAMBIOS ---');

    // Paso 1: Limpiar cualquier registro existente para este cliente en RUTERO_CONFIG
    const delResult = await conn.query(`
      DELETE FROM JAVIER.RUTERO_CONFIG
      WHERE TRIM(CLIENTE) = '${CLIENT}'
    `);
    console.log(`  [1/2] Limpiados registros previos de RUTERO_CONFIG para ${CLIENT}`);

    // Paso 2: Insertar override positivo: vendedor 33, miércoles
    await conn.query(`
      INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN)
      VALUES ('${VENDEDOR_CORRECTO}', '${DIA_CORRECTO}', '${CLIENT}', ${nextOrden})
    `);
    console.log(`  [2/2] Insertado: V=${VENDEDOR_CORRECTO}, DIA=${DIA_CORRECTO}, CLIENTE=${CLIENT}, ORDEN=${nextOrden}`);

    // Verificación
    console.log('\n--- VERIFICACIÓN POST-CAMBIO ---');
    const verify = await conn.query(`
      SELECT TRIM(VENDEDOR) AS V, TRIM(DIA) AS D, ORDEN
      FROM JAVIER.RUTERO_CONFIG WHERE TRIM(CLIENTE) = '${CLIENT}'
    `);
    verify.forEach(r => console.log(`  V:${r.V} | Día:${r.D} | Orden:${r.ORDEN}`));

    console.log('\n⚠️  IMPORTANTE: Reinicia el backend para que la caché recargue los datos.');
    console.log('  O bien haz una petición a la API que dispare reloadRuteroConfig().');
  } else {
    console.log('\n--- CAMBIOS QUE SE APLICARÍAN (--apply para ejecutar) ---');
    console.log(`  1. DELETE FROM JAVIER.RUTERO_CONFIG WHERE TRIM(CLIENTE) = '${CLIENT}'`);
    console.log(`  2. INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDEDOR_CORRECTO}', '${DIA_CORRECTO}', '${CLIENT}', ${nextOrden})`);
  }

  console.log('\n' + '='.repeat(80));
  await conn.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
