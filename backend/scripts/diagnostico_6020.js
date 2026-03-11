/**
 * Diagnóstico completo del cliente terminado en 6020
 * Analiza CDVI, LACLAE, RUTERO_CONFIG y CLI
 */
const odbc = require('odbc');

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;`;

async function main() {
  const conn = await odbc.connect(DB_CONFIG);

  const clientPattern = '%6020';

  console.log('='.repeat(80));
  console.log('DIAGNÓSTICO CLIENTE *6020');
  console.log('='.repeat(80));

  // 1. Buscar el cliente en CLI (datos maestros)
  console.log('\n--- 1. DATOS MAESTROS (DSEDAC.CLI) ---');
  const cli = await conn.query(`
    SELECT
      TRIM(CODIGOCLIENTE) AS CODIGO,
      TRIM(NOMBRECLIENTE) AS NOMBRE,
      ANOBAJA
    FROM DSEDAC.CLI
    WHERE TRIM(CODIGOCLIENTE) LIKE '${clientPattern}'
  `);
  console.log('Clientes encontrados:', cli.length);
  cli.forEach(c => {
    console.log(`  Cliente: ${c.CODIGO} | Nombre: ${c.NOMBRE} | Año baja: ${c.ANOBAJA}`);
  });

  if (cli.length === 0) {
    console.log('ERROR: No se encontró ningún cliente terminado en 6020');
    await conn.close();
    return;
  }

  const clientCode = cli[0].CODIGO;
  console.log(`\nUsando cliente: ${clientCode}`);

  // 2. CDVI - Asignación natural de visita
  console.log('\n--- 2. CUADRO DE VISITAS (DSEDAC.CDVI) ---');
  const cdvi = await conn.query(`
    SELECT
      TRIM(CODIGOVENDEDOR) AS VENDEDOR,
      TRIM(CODIGOCLIENTE) AS CLIENTE,
      MARCAACTUALIZACION,
      DIAVISITALUNESSN AS LUN,
      DIAVISITAMARTESSN AS MAR,
      DIAVISITAMIERCOLESSN AS MIE,
      DIAVISITAJUEVESSN AS JUE,
      DIAVISITAVIERNESSN AS VIE,
      DIAVISITASABADOSN AS SAB,
      DIAVISITADOMINGOSN AS DOM,
      ORDENVISITALUNES AS ORD_L,
      ORDENVISITAMARTES AS ORD_M,
      ORDENVISITAMIERCOLES AS ORD_X,
      ORDENVISITAJUEVES AS ORD_J,
      ORDENVISITAVIERNES AS ORD_V,
      ORDENVISITASABADO AS ORD_S,
      ORDENVISITADOMINGO AS ORD_D
    FROM DSEDAC.CDVI
    WHERE TRIM(CODIGOCLIENTE) = '${clientCode}'
  `);
  console.log('Registros CDVI:', cdvi.length);
  cdvi.forEach(r => {
    const dias = [];
    if (r.LUN === 'S') dias.push(`Lunes(ord:${r.ORD_L})`);
    if (r.MAR === 'S') dias.push(`Martes(ord:${r.ORD_M})`);
    if (r.MIE === 'S') dias.push(`Miércoles(ord:${r.ORD_X})`);
    if (r.JUE === 'S') dias.push(`Jueves(ord:${r.ORD_J})`);
    if (r.VIE === 'S') dias.push(`Viernes(ord:${r.ORD_V})`);
    if (r.SAB === 'S') dias.push(`Sábado(ord:${r.ORD_S})`);
    if (r.DOM === 'S') dias.push(`Domingo(ord:${r.ORD_D})`);
    console.log(`  Vendedor: ${r.VENDEDOR} | Marca: ${r.MARCAACTUALIZACION} | Días visita: ${dias.join(', ') || 'NINGUNO'}`);
  });

  // 3. RUTERO_CONFIG - Overrides personalizados
  console.log('\n--- 3. RUTERO CONFIG (JAVIER.RUTERO_CONFIG) ---');
  const rutero = await conn.query(`
    SELECT
      TRIM(VENDEDOR) AS VENDEDOR,
      TRIM(CLIENTE) AS CLIENTE,
      TRIM(DIA) AS DIA,
      ORDEN
    FROM JAVIER.RUTERO_CONFIG
    WHERE TRIM(CLIENTE) = '${clientCode}'
  `);
  console.log('Registros RUTERO_CONFIG:', rutero.length);
  if (rutero.length === 0) {
    console.log('  (Sin overrides personalizados)');
  } else {
    rutero.forEach(r => {
      const tipo = r.ORDEN === -1 ? 'BLOQUEO' : `POSICIÓN ${r.ORDEN}`;
      console.log(`  Vendedor: ${r.VENDEDOR} | Día: ${r.DIA} | Orden: ${r.ORDEN} (${tipo})`);
    });
  }

  // 4. LACLAE - Datos históricos de visita/reparto
  console.log('\n--- 4. DATOS LACLAE (DSED.LACLAE) ---');
  const laclae = await conn.query(`
    SELECT DISTINCT
      TRIM(R1_T8CDVD) AS VENDEDOR,
      TRIM(LCCDCL) AS CLIENTE,
      R1_T8DIVL AS VIS_L, R1_T8DIVM AS VIS_M, R1_T8DIVX AS VIS_X,
      R1_T8DIVJ AS VIS_J, R1_T8DIVV AS VIS_V, R1_T8DIVS AS VIS_S, R1_T8DIVD AS VIS_D,
      R1_T8DIRL AS REP_L, R1_T8DIRM AS REP_M, R1_T8DIRX AS REP_X,
      R1_T8DIRJ AS REP_J, R1_T8DIRV AS REP_V, R1_T8DIRS AS REP_S, R1_T8DIRD AS REP_D
    FROM DSED.LACLAE
    WHERE TRIM(LCCDCL) = '${clientCode}'
      AND R1_T8CDVD IS NOT NULL
      AND LCAADC >= 2025
  `);
  console.log('Registros LACLAE:', laclae.length);
  laclae.forEach(r => {
    const visita = [];
    const reparto = [];
    if (r.VIS_L === 'S') visita.push('Lunes');
    if (r.VIS_M === 'S') visita.push('Martes');
    if (r.VIS_X === 'S') visita.push('Miércoles');
    if (r.VIS_J === 'S') visita.push('Jueves');
    if (r.VIS_V === 'S') visita.push('Viernes');
    if (r.VIS_S === 'S') visita.push('Sábado');
    if (r.VIS_D === 'S') visita.push('Domingo');
    if (r.REP_L === 'S') reparto.push('Lunes');
    if (r.REP_M === 'S') reparto.push('Martes');
    if (r.REP_X === 'S') reparto.push('Miércoles');
    if (r.REP_J === 'S') reparto.push('Jueves');
    if (r.REP_V === 'S') reparto.push('Viernes');
    if (r.REP_S === 'S') reparto.push('Sábado');
    if (r.REP_D === 'S') reparto.push('Domingo');
    console.log(`  Vendedor: ${r.VENDEDOR} | Visita: ${visita.join(', ') || 'NINGUNO'} | Reparto: ${reparto.join(', ') || 'NINGUNO'}`);
  });

  // 5. Verificar vendedor 33 y 93
  console.log('\n--- 5. DATOS VENDEDORES 33 y 93 ---');
  const vendedores = await conn.query(`
    SELECT
      TRIM(CODIGOVENDEDOR) AS CODIGO,
      TRIM(NOMBREVENDEDOR) AS NOMBRE
    FROM DSEDAC.VDD
    WHERE TRIM(CODIGOVENDEDOR) IN ('33', '93')
  `);
  vendedores.forEach(v => {
    console.log(`  Vendedor ${v.CODIGO}: ${v.NOMBRE}`);
  });

  // 6. Verificar si el vendedor 33 tiene al cliente en CDVI para miércoles
  console.log('\n--- 6. CDVI ESPECÍFICO: Vendedor 33 + Cliente 6020 ---');
  const cdvi33 = await conn.query(`
    SELECT
      TRIM(CODIGOVENDEDOR) AS VENDEDOR,
      DIAVISITAMIERCOLESSN AS MIERCOLES,
      ORDENVISITAMIERCOLES AS ORDEN_MIER,
      MARCAACTUALIZACION AS MARCA
    FROM DSEDAC.CDVI
    WHERE TRIM(CODIGOCLIENTE) = '${clientCode}'
      AND TRIM(CODIGOVENDEDOR) = '33'
  `);
  if (cdvi33.length === 0) {
    console.log('  *** NO EXISTE registro CDVI para vendedor 33 + cliente 6020 ***');
    console.log('  Esto explica por qué no aparece en el rutero del miércoles para el 33');
  } else {
    cdvi33.forEach(r => {
      console.log(`  Vendedor 33: Miércoles=${r.MIERCOLES} | Orden=${r.ORDEN_MIER} | Marca=${r.MARCA}`);
    });
  }

  // 7. Verificar CDVI del vendedor 93 con este cliente
  console.log('\n--- 7. CDVI ESPECÍFICO: Vendedor 93 + Cliente 6020 ---');
  const cdvi93 = await conn.query(`
    SELECT
      TRIM(CODIGOVENDEDOR) AS VENDEDOR,
      DIAVISITALUNESSN AS LUN, DIAVISITAMARTESSN AS MAR, DIAVISITAMIERCOLESSN AS MIE,
      DIAVISITAJUEVESSN AS JUE, DIAVISITAVIERNESSN AS VIE, DIAVISITASABADOSN AS SAB,
      MARCAACTUALIZACION AS MARCA
    FROM DSEDAC.CDVI
    WHERE TRIM(CODIGOCLIENTE) = '${clientCode}'
      AND TRIM(CODIGOVENDEDOR) = '93'
  `);
  if (cdvi93.length === 0) {
    console.log('  NO EXISTE registro CDVI para vendedor 93 + cliente 6020');
  } else {
    cdvi93.forEach(r => {
      const dias = [];
      if (r.LUN === 'S') dias.push('Lunes');
      if (r.MAR === 'S') dias.push('Martes');
      if (r.MIE === 'S') dias.push('Miércoles');
      if (r.JUE === 'S') dias.push('Jueves');
      if (r.VIE === 'S') dias.push('Viernes');
      if (r.SAB === 'S') dias.push('Sábado');
      console.log(`  Vendedor 93: Días=${dias.join(', ')} | Marca=${r.MARCA}`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('FIN DEL DIAGNÓSTICO');
  console.log('='.repeat(80));

  await conn.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
