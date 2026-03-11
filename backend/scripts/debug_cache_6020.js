/**
 * Simula EXACTAMENTE lo que hace loadLaclaeCache() para el cliente 6020
 * y getClientCodesFromCache/getClientsForDay para verificar si aparece.
 */
const odbc = require('odbc');
const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;`;

const CLIENT = '4300006020';

async function main() {
  const conn = await odbc.connect(DB_CONFIG);
  const laclaeCache = {};
  const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

  console.log('='.repeat(60));
  console.log('SIMULACIÓN COMPLETA DE CACHÉ PARA CLIENTE 6020');
  console.log('='.repeat(60));

  // ========== PASO 1: CDVI (con filtro anti-zombi) ==========
  console.log('\n--- PASO 1: Carga CDVI (con filtro anti-zombi) ---');
  const cdviRows = await conn.query(`
    SELECT
      TRIM(C.CODIGOVENDEDOR) as VENDEDOR,
      TRIM(C.CODIGOCLIENTE) as CLIENTE,
      C.DIAVISITALUNESSN as VIS_L, C.DIAVISITAMARTESSN as VIS_M,
      C.DIAVISITAMIERCOLESSN as VIS_X, C.DIAVISITAJUEVESSN as VIS_J,
      C.DIAVISITAVIERNESSN as VIS_V, C.DIAVISITASABADOSN as VIS_S,
      C.DIAVISITADOMINGOSN as VIS_D,
      C.ORDENVISITAMIERCOLES as OR_X
    FROM DSEDAC.CDVI C
    JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
    WHERE TRIM(C.CODIGOCLIENTE) = '${CLIENT}'
      AND (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
      AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
      AND (
        TRIM(C.DIAVISITALUNESSN) = 'S' OR TRIM(C.DIAVISITAMARTESSN) = 'S' OR
        TRIM(C.DIAVISITAMIERCOLESSN) = 'S' OR TRIM(C.DIAVISITAJUEVESSN) = 'S' OR
        TRIM(C.DIAVISITAVIERNESSN) = 'S' OR TRIM(C.DIAVISITASABADOSN) = 'S' OR
        TRIM(C.DIAVISITADOMINGOSN) = 'S'
      )
  `);

  console.log(`  Registros CDVI que pasan el filtro: ${cdviRows.length}`);
  cdviRows.forEach(row => {
    console.log(`  V:${row.VENDEDOR} | VIS_X(raw)='${row.VIS_X}' | trim='${String(row.VIS_X).trim()}' | OR_X=${row.OR_X}`);

    // Simular lógica de loadLaclaeCache
    if (!row.VENDEDOR || !row.CLIENTE) return;
    if (!laclaeCache[row.VENDEDOR]) laclaeCache[row.VENDEDOR] = {};
    if (!laclaeCache[row.VENDEDOR][row.CLIENTE]) {
      laclaeCache[row.VENDEDOR][row.CLIENTE] = {
        visitDays: new Set(),
        deliveryDays: new Set(),
        naturalOrder: { miercoles: Number(row.OR_X) || 0 }
      };
    }
    const entry = laclaeCache[row.VENDEDOR][row.CLIENTE];
    if (String(row.VIS_D).trim() === 'S') entry.visitDays.add('domingo');
    if (String(row.VIS_L).trim() === 'S') entry.visitDays.add('lunes');
    if (String(row.VIS_M).trim() === 'S') entry.visitDays.add('martes');
    if (String(row.VIS_X).trim() === 'S') entry.visitDays.add('miercoles');
    if (String(row.VIS_J).trim() === 'S') entry.visitDays.add('jueves');
    if (String(row.VIS_V).trim() === 'S') entry.visitDays.add('viernes');
    if (String(row.VIS_S).trim() === 'S') entry.visitDays.add('sabado');
  });

  // ========== PASO 2: LACLAE ==========
  console.log('\n--- PASO 2: Carga LACLAE ---');
  const currentYear = new Date().getFullYear();
  const laclaeRows = await conn.query(`
    SELECT DISTINCT
      TRIM(L.R1_T8CDVD) as VENDEDOR,
      TRIM(L.LCCDCL) as CLIENTE,
      L.R1_T8DIVL as VIS_L, L.R1_T8DIVM as VIS_M, L.R1_T8DIVX as VIS_X,
      L.R1_T8DIVJ as VIS_J, L.R1_T8DIVV as VIS_V, L.R1_T8DIVS as VIS_S, L.R1_T8DIVD as VIS_D,
      L.R1_T8DIRL as DEL_L, L.R1_T8DIRM as DEL_M, L.R1_T8DIRX as DEL_X,
      L.R1_T8DIRJ as DEL_J, L.R1_T8DIRV as DEL_V, L.R1_T8DIRS as DEL_S, L.R1_T8DIRD as DEL_D
    FROM DSED.LACLAE L
    JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
    WHERE TRIM(L.LCCDCL) = '${CLIENT}'
      AND L.R1_T8CDVD IS NOT NULL
      AND L.LCAADC >= ${currentYear - 1}
      AND (C.ANOBAJA = 0 OR C.ANOBAJA IS NULL)
  `);

  console.log(`  Registros LACLAE: ${laclaeRows.length}`);
  const visitCols = ['VIS_D', 'VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S'];
  const deliveryCols = ['DEL_D', 'DEL_L', 'DEL_M', 'DEL_X', 'DEL_J', 'DEL_V', 'DEL_S'];

  laclaeRows.forEach(row => {
    const vendedor = row.VENDEDOR?.trim() || '';
    const cliente = row.CLIENTE?.trim() || '';
    if (!vendedor || !cliente) return;

    console.log(`  V:${vendedor} | VIS flags: L=${row.VIS_L} M=${row.VIS_M} X=${row.VIS_X} J=${row.VIS_J} V=${row.VIS_V} S=${row.VIS_S}`);
    console.log(`           | DEL flags: L=${row.DEL_L} M=${row.DEL_M} X=${row.DEL_X} J=${row.DEL_J} V=${row.DEL_V} S=${row.DEL_S}`);

    if (!laclaeCache[vendedor]) laclaeCache[vendedor] = {};
    if (!laclaeCache[vendedor][cliente]) {
      laclaeCache[vendedor][cliente] = {
        visitDays: new Set(),
        deliveryDays: new Set()
      };
    }
    const entry = laclaeCache[vendedor][cliente];
    for (let i = 0; i < 7; i++) {
      if (row[visitCols[i]] === 'S') entry.visitDays.add(dayNames[i]);
      if (row[deliveryCols[i]] === 'S') entry.deliveryDays.add(dayNames[i]);
    }
  });

  // Convert Sets to Arrays
  Object.values(laclaeCache).forEach(vendorClients => {
    Object.values(vendorClients).forEach(clientData => {
      clientData.visitDays = Array.from(clientData.visitDays);
      clientData.deliveryDays = Array.from(clientData.deliveryDays);
    });
  });

  // ========== PASO 3: Estado final de la caché ==========
  console.log('\n--- PASO 3: Estado final de la caché ---');
  Object.entries(laclaeCache).forEach(([vendedor, clients]) => {
    Object.entries(clients).forEach(([clientCode, data]) => {
      console.log(`  laclaeCache['${vendedor}']['${clientCode}']:`);
      console.log(`    visitDays: [${data.visitDays.join(', ')}]`);
      console.log(`    deliveryDays: [${data.deliveryDays.join(', ')}]`);
    });
  });

  // ========== PASO 4: Simular getClientCodesFromCache ==========
  console.log('\n--- PASO 4: getClientCodesFromCache ---');
  for (const v of ['33', '93']) {
    const vendorClients = laclaeCache[v] || {};
    const codes = Object.keys(vendorClients);
    const has6020 = codes.includes(CLIENT);
    console.log(`  getClientCodesFromCache('${v}'): ${has6020 ? '✅ INCLUYE' : '❌ NO INCLUYE'} cliente ${CLIENT} (total: ${codes.length})`);
  }

  // ========== PASO 5: Simular getClientsForDay ==========
  console.log('\n--- PASO 5: getClientsForDay (rutero) ---');
  for (const v of ['33', '93']) {
    for (const day of ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']) {
      const vendorClients = laclaeCache[v] || {};
      const clientData = vendorClients[CLIENT];
      if (clientData) {
        const included = clientData.visitDays.includes(day);
        if (included) {
          console.log(`  getClientsForDay('${v}', '${day}'): ✅ INCLUYE ${CLIENT}`);
        }
      }
    }
  }

  // ========== PASO 6: RUTERO_CONFIG overrides ==========
  console.log('\n--- PASO 6: RUTERO_CONFIG overrides ---');
  const rutero = await conn.query(`
    SELECT TRIM(VENDEDOR) AS V, TRIM(DIA) AS D, ORDEN
    FROM JAVIER.RUTERO_CONFIG WHERE TRIM(CLIENTE) = '${CLIENT}'
  `);
  rutero.forEach(r => console.log(`  V:${r.V} | DIA:${r.D} | ORDEN:${r.ORDEN} → ${r.ORDEN >= 0 ? 'POSITIVO (incluir)' : 'BLOQUEO'}`));

  // ========== PASO 7: Verificar SQL de clients.js ==========
  console.log('\n--- PASO 7: ¿La query SQL de clients.js devuelve el cliente para V33? ---');
  // El clients.js filtra por vendedorCodes en LACLAE (ventas)
  const salesV33 = await conn.query(`
    SELECT COUNT(*) AS TOTAL FROM DSED.LACLAE
    WHERE TRIM(LCCDCL) = '${CLIENT}' AND TRIM(R1_T8CDVD) = '33'
      AND LCAADC >= ${currentYear - 3}
      AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
  `);
  const salesV93 = await conn.query(`
    SELECT COUNT(*) AS TOTAL FROM DSED.LACLAE
    WHERE TRIM(LCCDCL) = '${CLIENT}' AND TRIM(R1_T8CDVD) = '93'
      AND LCAADC >= ${currentYear - 3}
      AND TPDC = 'LAC' AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
  `);
  console.log(`  Ventas de ${CLIENT} con vendedor 33: ${salesV33[0].TOTAL}`);
  console.log(`  Ventas de ${CLIENT} con vendedor 93: ${salesV93[0].TOTAL}`);

  if (parseInt(salesV33[0].TOTAL) === 0) {
    console.log('\n  ⚠️ PROBLEMA ENCONTRADO: El cliente NO tiene ventas con vendedor 33 en LACLAE.');
    console.log('  La query de clients.js filtra por vendedor en las ventas (LACLAE),');
    console.log('  pero el pre-filtro de caché (getClientCodesFromCache) sí lo incluye.');
    console.log('  Esto puede causar que el cliente aparezca en el listado con datos vacíos');
    console.log('  o no aparezca si el SQL no lo encuentra en la subquery de ventas.');
  }

  console.log('\n' + '='.repeat(60));
  await conn.close();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
