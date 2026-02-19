/**
 * DIAGNÓSTICO COMPLETO — Warehouse / Load Planner / Personnel
 * Ejecutar: node scripts/diag_warehouse.js
 */
const { query } = require('../config/db');

const SEP = '═'.repeat(60);

async function main() {
  console.log(`\n${SEP}`);
  console.log('  DIAGNÓSTICO WAREHOUSE — Columnas, Datos y Queries');
  console.log(`${SEP}\n`);

  // ═══════════════════════════════════════════════════════════
  // 1. COLUMNAS DE OPP
  // ═══════════════════════════════════════════════════════════
  console.log('1. COLUMNAS DE DSEDAC.OPP:');
  try {
    const oppCols = await query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPP'
      ORDER BY ORDINAL_POSITION
    `);
    oppCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

    // Check specific columns
    const colNames = oppCols.map(c => c.COLUMN_NAME);
    console.log('\n   Verificación columnas usadas:');
    ['CODIGOCLIENTE', 'CODIGOREPARTIDOR', 'CODIGOVEHICULO', 'NUMEROORDENPREPARACION',
     'EJERCICIOORDENPREPARACION', 'DIAREPARTO', 'MESREPARTO', 'ANOREPARTO'].forEach(col => {
      console.log(`   ${colNames.includes(col) ? '✅' : '❌'} ${col}`);
    });
  } catch (e) {
    console.log(`   ERROR: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 2. COLUMNAS DE CPC
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${SEP}`);
  console.log('2. COLUMNAS DE DSEDAC.CPC:');
  try {
    const cpcCols = await query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CPC'
      ORDER BY ORDINAL_POSITION
    `);
    cpcCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

    const colNames = cpcCols.map(c => c.COLUMN_NAME);
    console.log('\n   Verificación columnas usadas:');
    ['CODIGOCLIENTEALBARAN', 'NUMEROORDENPREPARACION', 'EJERCICIOORDENPREPARACION',
     'NUMEROALBARAN', 'EJERCICIOALBARAN', 'SERIEALBARAN'].forEach(col => {
      console.log(`   ${colNames.includes(col) ? '✅' : '❌'} ${col}`);
    });
  } catch (e) {
    console.log(`   ERROR: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 3. COLUMNAS DE LAC
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${SEP}`);
  console.log('3. COLUMNAS DE DSEDAC.LAC:');
  try {
    const lacCols = await query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
      ORDER BY ORDINAL_POSITION
    `);
    lacCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

    const colNames = lacCols.map(c => c.COLUMN_NAME);
    console.log('\n   Verificación columnas usadas:');
    ['CODIGOARTICULO', 'CANTIDADUNIDADES', 'CANTIDADENVASES', 'CANTIDADUNIDADESPEDIDAS',
     'NUMEROALBARAN', 'EJERCICIOALBARAN', 'SERIEALBARAN'].forEach(col => {
      console.log(`   ${colNames.includes(col) ? '✅' : '❌'} ${col}`);
    });
  } catch (e) {
    console.log(`   ERROR: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 4. VEHÍCULOS — CARGAMAXIMA
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${SEP}`);
  console.log('4. VEHÍCULOS — CARGAMAXIMA:');
  try {
    const vehCols = await query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VEH'
      AND (COLUMN_NAME LIKE '%CARGA%' OR COLUMN_NAME LIKE '%PESO%'
           OR COLUMN_NAME LIKE '%TARA%' OR COLUMN_NAME LIKE '%VOLUM%'
           OR COLUMN_NAME LIKE '%CONTENEDOR%' OR COLUMN_NAME LIKE '%CAPACI%')
      ORDER BY ORDINAL_POSITION
    `);
    console.log('   Columnas de capacidad en VEH:');
    vehCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

    const vehs = await query(`
      SELECT TRIM(CODIGOVEHICULO) AS CODE, TRIM(DESCRIPCIONVEHICULO) AS DESC,
             TRIM(MATRICULA) AS MAT, CARGAMAXIMA, TARA, VOLUMEN, CONTENEDORVOLUMEN
      FROM DSEDAC.VEH
      ORDER BY CODIGOVEHICULO
    `);
    console.log(`\n   Total vehículos: ${vehs.length}`);
    vehs.forEach(v => {
      console.log(`   ${v.CODE} | ${v.DESC} | Mat: ${v.MAT} | CargaMax: ${v.CARGAMAXIMA} | Tara: ${v.TARA} | Vol: ${v.VOLUMEN} | ContVol: ${v.CONTENEDORVOLUMEN}`);
    });
  } catch (e) {
    console.log(`   ERROR: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 5. OPP HOY — Qué camiones tienen pedidos
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${SEP}`);
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  // Also try tomorrow
  const tom = new Date(now); tom.setDate(tom.getDate() + 1);
  const ty = tom.getFullYear(), tm = tom.getMonth() + 1, td = tom.getDate();

  console.log(`5. OPP PARA HOY (${d}/${m}/${y}) y MAÑANA (${td}/${tm}/${ty}):`);
  try {
    const todayOrders = await query(`
      SELECT TRIM(OPP.CODIGOVEHICULO) AS VEH, TRIM(OPP.CODIGOREPARTIDOR) AS REP,
             COUNT(DISTINCT OPP.NUMEROORDENPREPARACION) AS ORDENES, COUNT(*) AS LINEAS
      FROM DSEDAC.OPP OPP
      WHERE OPP.ANOREPARTO = ${y} AND OPP.MESREPARTO = ${m} AND OPP.DIAREPARTO = ${d}
        AND TRIM(OPP.CODIGOVEHICULO) <> ''
      GROUP BY TRIM(OPP.CODIGOVEHICULO), TRIM(OPP.CODIGOREPARTIDOR)
      ORDER BY TRIM(OPP.CODIGOVEHICULO)
    `);
    console.log(`   HOY: ${todayOrders.length} camiones con pedidos`);
    todayOrders.forEach(o => console.log(`   VEH: ${o.VEH} | REP: ${o.REP} | Órdenes: ${o.ORDENES} | Líneas: ${o.LINEAS}`));

    const tomOrders = await query(`
      SELECT TRIM(OPP.CODIGOVEHICULO) AS VEH, TRIM(OPP.CODIGOREPARTIDOR) AS REP,
             COUNT(DISTINCT OPP.NUMEROORDENPREPARACION) AS ORDENES, COUNT(*) AS LINEAS
      FROM DSEDAC.OPP OPP
      WHERE OPP.ANOREPARTO = ${ty} AND OPP.MESREPARTO = ${tm} AND OPP.DIAREPARTO = ${td}
        AND TRIM(OPP.CODIGOVEHICULO) <> ''
      GROUP BY TRIM(OPP.CODIGOVEHICULO), TRIM(OPP.CODIGOREPARTIDOR)
      ORDER BY TRIM(OPP.CODIGOVEHICULO)
    `);
    console.log(`\n   MAÑANA: ${tomOrders.length} camiones con pedidos`);
    tomOrders.forEach(o => console.log(`   VEH: ${o.VEH} | REP: ${o.REP} | Órdenes: ${o.ORDENES} | Líneas: ${o.LINEAS}`));
  } catch (e) {
    console.log(`   ERROR: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 6. TEST JOIN COMPLETO (el que usa loadPlanner)
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${SEP}`);
  console.log('6. TEST JOIN OPP → CPC → LAC (query del load planner):');
  try {
    // First find a vehicle with orders today or tomorrow
    const testVeh = await query(`
      SELECT TRIM(CODIGOVEHICULO) AS VEH, ANOREPARTO AS Y, MESREPARTO AS M, DIAREPARTO AS D,
             COUNT(*) AS CNT
      FROM DSEDAC.OPP
      WHERE ANOREPARTO = ${y} AND MESREPARTO >= ${m}
        AND TRIM(CODIGOVEHICULO) <> ''
      GROUP BY TRIM(CODIGOVEHICULO), ANOREPARTO, MESREPARTO, DIAREPARTO
      ORDER BY ANOREPARTO DESC, MESREPARTO DESC, DIAREPARTO DESC
      FETCH FIRST 3 ROWS ONLY
    `);

    if (testVeh.length === 0) {
      console.log('   No hay vehículos con pedidos recientes');
    } else {
      const tv = testVeh[0];
      console.log(`   Probando con vehículo: ${tv.VEH} fecha: ${tv.D}/${tv.M}/${tv.Y} (${tv.CNT} OPPs)`);

      const joinResult = await query(`
        SELECT
          OPP.EJERCICIOORDENPREPARACION AS EJERCICIO,
          OPP.NUMEROORDENPREPARACION AS NUM_ORDEN,
          TRIM(OPP.CODIGOREPARTIDOR) AS REPARTIDOR,
          TRIM(OPP.CODIGOVEHICULO) AS VEHICULO,
          TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
          TRIM(LAC.CODIGOARTICULO) AS ARTICULO,
          LAC.CANTIDADUNIDADES AS CANTIDAD,
          LAC.CANTIDADENVASES AS CAJAS
        FROM DSEDAC.OPP OPP
        INNER JOIN DSEDAC.CPC CPC
          ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
          AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
        INNER JOIN DSEDAC.LAC LAC
          ON CPC.NUMEROALBARAN = LAC.NUMEROALBARAN
          AND CPC.EJERCICIOALBARAN = LAC.EJERCICIOALBARAN
          AND TRIM(CPC.SERIEALBARAN) = TRIM(LAC.SERIEALBARAN)
        WHERE TRIM(OPP.CODIGOVEHICULO) = '${tv.VEH}'
          AND OPP.ANOREPARTO = ${tv.Y}
          AND OPP.MESREPARTO = ${tv.M}
          AND OPP.DIAREPARTO = ${tv.D}
        ORDER BY OPP.NUMEROORDENPREPARACION
        FETCH FIRST 20 ROWS ONLY
      `);

      console.log(`   ✅ JOIN exitoso: ${joinResult.length} filas`);
      joinResult.slice(0, 5).forEach((r, i) => {
        console.log(`   [${i+1}] Orden: ${r.NUM_ORDEN} | Cliente: ${r.CLIENTE} | Art: ${r.ARTICULO} | Cant: ${r.CANTIDAD} | Cajas: ${r.CAJAS}`);
      });
      if (joinResult.length > 5) console.log(`   ... y ${joinResult.length - 5} filas más`);
    }
  } catch (e) {
    console.log(`   ❌ JOIN FALLÓ: ${e.message}`);

    // Try step by step to find the exact failing column
    console.log('\n   Probando paso a paso...');

    try {
      const r1 = await query(`SELECT * FROM DSEDAC.OPP FETCH FIRST 1 ROWS ONLY`);
      console.log(`   ✅ OPP OK — columnas: ${Object.keys(r1[0]).join(', ')}`);
    } catch (e2) { console.log(`   ❌ OPP: ${e2.message}`); }

    try {
      const r2 = await query(`SELECT * FROM DSEDAC.CPC FETCH FIRST 1 ROWS ONLY`);
      console.log(`   ✅ CPC OK — columnas: ${Object.keys(r2[0]).join(', ')}`);
    } catch (e2) { console.log(`   ❌ CPC: ${e2.message}`); }

    try {
      const r3 = await query(`SELECT * FROM DSEDAC.LAC FETCH FIRST 1 ROWS ONLY`);
      console.log(`   ✅ LAC OK — columnas: ${Object.keys(r3[0]).join(', ')}`);
    } catch (e2) { console.log(`   ❌ LAC: ${e2.message}`); }
  }

  // ═══════════════════════════════════════════════════════════
  // 7. ARTÍCULOS — Pesos y dimensiones
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${SEP}`);
  console.log('7. ARTÍCULOS — Peso en DSEDAC.ART + JAVIER.ALMACEN_ART_DIMENSIONES:');
  try {
    const artStats = await query(`
      SELECT
        COUNT(*) AS TOTAL,
        SUM(CASE WHEN PESO > 0 THEN 1 ELSE 0 END) AS CON_PESO,
        AVG(CASE WHEN PESO > 0 THEN PESO END) AS PESO_MEDIO,
        MAX(PESO) AS PESO_MAX,
        SUM(CASE WHEN UNIDADESCAJA > 0 THEN 1 ELSE 0 END) AS CON_UDS_CAJA
      FROM DSEDAC.ART WHERE ANOBAJA = 0
    `);
    const s = artStats[0];
    console.log(`   Total arts activos: ${s.TOTAL}`);
    console.log(`   Con peso: ${s.CON_PESO} | Peso medio: ${parseFloat(s.PESO_MEDIO || 0).toFixed(3)} kg | Max: ${s.PESO_MAX}`);
    console.log(`   Con uds/caja: ${s.CON_UDS_CAJA}`);
  } catch (e) {
    console.log(`   ERROR: ${e.message}`);
  }

  try {
    const dimCount = await query(`SELECT COUNT(*) AS CNT FROM JAVIER.ALMACEN_ART_DIMENSIONES`);
    console.log(`   ALMACEN_ART_DIMENSIONES: ${dimCount[0].CNT} registros`);
  } catch (e) {
    console.log(`   ALMACEN_ART_DIMENSIONES: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 8. ALMACEN_CAMIONES_CONFIG
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${SEP}`);
  console.log('8. JAVIER.ALMACEN_CAMIONES_CONFIG:');
  try {
    const configs = await query(`SELECT * FROM JAVIER.ALMACEN_CAMIONES_CONFIG`);
    console.log(`   Total configs: ${configs.length}`);
    configs.forEach(c => {
      console.log(`   ${c.CODIGOVEHICULO} | ${c.LARGO_INTERIOR_CM}x${c.ANCHO_INTERIOR_CM}x${c.ALTO_INTERIOR_CM} cm | Tol: ${c.TOLERANCIA_EXCESO}%`);
    });
  } catch (e) {
    console.log(`   ERROR (tabla no existe?): ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 9. PERSONAL
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${SEP}`);
  console.log('9. PERSONAL:');

  // Custom table
  try {
    const personnel = await query(`SELECT * FROM JAVIER.ALMACEN_PERSONAL`);
    console.log(`   ALMACEN_PERSONAL: ${personnel.length} registros`);
    personnel.forEach(p => {
      console.log(`   [${p.ID}] ${(p.NOMBRE || '').trim()} | Cod: ${(p.CODIGO_VENDEDOR || '').trim()} | Rol: ${(p.ROL || '').trim()} | Activo: ${p.ACTIVO}`);
    });
  } catch (e) {
    console.log(`   ALMACEN_PERSONAL ERROR: ${e.message}`);
  }

  // VDD
  try {
    const vdd = await query(`
      SELECT TRIM(CODIGOVENDEDOR) AS CODE, TRIM(NOMBREVENDEDOR) AS NOMBRE
      FROM DSEDAC.VDD
      ORDER BY CODIGOVENDEDOR
    `);
    console.log(`\n   DSEDAC.VDD (vendedores/repartidores): ${vdd.length} registros`);
    vdd.forEach(v => {
      console.log(`   ${v.CODE}: ${v.NOMBRE}`);
    });
  } catch (e) {
    console.log(`   VDD ERROR: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 10. ALMACEN_CARGA_HISTORICO
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${SEP}`);
  console.log('10. JAVIER.ALMACEN_CARGA_HISTORICO:');
  try {
    const hist = await query(`SELECT COUNT(*) AS CNT FROM JAVIER.ALMACEN_CARGA_HISTORICO`);
    console.log(`   Total registros: ${hist[0].CNT}`);
  } catch (e) {
    console.log(`   ERROR: ${e.message}`);
  }

  console.log(`\n${SEP}`);
  console.log('  FIN DEL DIAGNÓSTICO');
  console.log(`${SEP}\n`);

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
