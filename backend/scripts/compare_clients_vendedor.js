/**
 * Script para comparar clientes entre Listado, Rutero y Objetivos para comercial 02
 * Investiga la discrepancia de conteo: Listado=264, Rutero=260, Objetivos=99
 */

const db = require('../config/db');

const VENDEDOR = '02'; // Comercial BARTOLO
const MIN_YEAR = 2024;
const CURRENT_YEAR = 2026;

async function compareClients() {
  try {
    await db.initDb();
    console.log('✅ Conectado a la base de datos\n');
    console.log(`Analizando clientes para vendedor: ${VENDEDOR}`);
    console.log('='.repeat(70));

    // 1. CLIENTES EN RUTERO (cache LACLAE - R1_T8CDVD)
    console.log('\n1. CLIENTES EN RUTERO (LACLAE con R1_T8CDVD)');
    console.log('-'.repeat(70));
    
    let clientesRutero = [];
    try {
      // Esta es la query que usa el cache del rutero
      const ruteroQuery = `
        SELECT DISTINCT TRIM(LCCDCL) as CODE
        FROM DSED.LACLAE
        WHERE R1_T8CDVD = '${VENDEDOR}'
          AND R1_T8CDVD IS NOT NULL 
          AND LCCDCL IS NOT NULL
      `;
      clientesRutero = await db.query(ruteroQuery, false, false);
      console.log(`Total clientes en RUTERO: ${clientesRutero.length}`);
    } catch (e) {
      console.log('Error en query rutero:', e.message);
    }

    // 2. CLIENTES EN OBJETIVOS/MATRIZ (by-client endpoint con LCCDVD)
    console.log('\n2. CLIENTES EN MATRIZ OBJETIVOS (LACLAE con LCCDVD y ventas)');
    console.log('-'.repeat(70));
    
    let clientesObjetivos = [];
    try {
      // Esta es la query del endpoint by-client
      const objetivosQuery = `
        SELECT DISTINCT TRIM(LCCDCL) as CODE
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (${CURRENT_YEAR})
          AND TRIM(L.LCCDVD) = '${VENDEDOR}'
          AND L.TPDC = 'LAC'
          AND L.LCTPVT IN ('CC', 'VC')
          AND L.LCCLLN IN ('AB', 'VT')
          AND L.LCSRAB NOT IN ('N', 'Z')
      `;
      clientesObjetivos = await db.query(objetivosQuery, false, false);
      console.log(`Total clientes en OBJETIVOS (LCCDVD): ${clientesObjetivos.length}`);
    } catch (e) {
      console.log('Error en query objetivos:', e.message);
    }

    // 3. Clientes si usamos R1_T8CDVD en objetivos (igual que rutero)
    console.log('\n3. CLIENTES OBJETIVOS si usamos R1_T8CDVD (igual que rutero)');
    console.log('-'.repeat(70));
    
    let clientesObjetivosR1 = [];
    try {
      const objetivosR1Query = `
        SELECT DISTINCT TRIM(LCCDCL) as CODE
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (${CURRENT_YEAR})
          AND L.R1_T8CDVD = '${VENDEDOR}'
          AND L.TPDC = 'LAC'
          AND L.LCTPVT IN ('CC', 'VC')
          AND L.LCCLLN IN ('AB', 'VT')
          AND L.LCSRAB NOT IN ('N', 'Z')
      `;
      clientesObjetivosR1 = await db.query(objetivosR1Query, false, false);
      console.log(`Total clientes OBJETIVOS (R1_T8CDVD): ${clientesObjetivosR1.length}`);
    } catch (e) {
      console.log('Error en query objetivos R1:', e.message);
    }

    // 4. CLIENTES EN LISTADO DE CLIENTES (clients.js)
    console.log('\n4. CLIENTES EN LISTADO (LACLAE + CLI)');
    console.log('-'.repeat(70));
    
    let clientesListado = [];
    try {
      // Esta es la query del endpoint /clients
      const listadoQuery = `
        SELECT DISTINCT S.CODIGOCLIENTEALBARAN as CODE
        FROM (
          SELECT LCCDCL as CODIGOCLIENTEALBARAN, MAX(LCCDVD) as LAST_VENDOR
          FROM DSED.LACLAE 
          WHERE LCAADC >= ${MIN_YEAR}
            AND TPDC = 'LAC'
            AND LCTPVT IN ('CC', 'VC')
            AND LCCLLN IN ('AB', 'VT')
            AND LCSRAB NOT IN ('N', 'Z')
            AND TRIM(LCCDVD) = '${VENDEDOR}'
          GROUP BY LCCDCL
        ) S
      `;
      clientesListado = await db.query(listadoQuery, false, false);
      console.log(`Total clientes en LISTADO: ${clientesListado.length}`);
    } catch (e) {
      console.log('Error en query listado:', e.message);
    }

    // 5. Comparar LCCDVD vs R1_T8CDVD
    console.log('\n5. DIFERENCIA ENTRE LCCDVD y R1_T8CDVD');
    console.log('-'.repeat(70));
    
    try {
      const diffQuery = `
        SELECT 
          TRIM(LCCDCL) as CLIENT,
          TRIM(LCCDVD) as LCCDVD,
          TRIM(R1_T8CDVD) as R1_T8CDVD
        FROM DSED.LACLAE
        WHERE (TRIM(LCCDVD) = '${VENDEDOR}' OR R1_T8CDVD = '${VENDEDOR}')
          AND (TRIM(LCCDVD) <> R1_T8CDVD OR LCCDVD IS NULL OR R1_T8CDVD IS NULL)
          AND LCAADC = ${CURRENT_YEAR}
        FETCH FIRST 20 ROWS ONLY
      `;
      const diffs = await db.query(diffQuery, false, false);
      console.log(`Registros con diferencia entre LCCDVD y R1_T8CDVD: ${diffs.length}`);
      if (diffs.length > 0) {
        console.log('Ejemplos:');
        diffs.slice(0, 10).forEach(d => {
          console.log(`  Cliente ${d.CLIENT}: LCCDVD='${d.LCCDVD}' vs R1_T8CDVD='${d.R1_T8CDVD}'`);
        });
      }
    } catch (e) {
      console.log('Error en query diff:', e.message);
    }

    // 6. ANÁLISIS DE DIFERENCIAS
    console.log('\n' + '='.repeat(70));
    console.log('6. RESUMEN Y ANÁLISIS');
    console.log('='.repeat(70));

    const setRutero = new Set(clientesRutero.map(c => c.CODE));
    const setObjetivos = new Set(clientesObjetivos.map(c => c.CODE));
    const setObjetivosR1 = new Set(clientesObjetivosR1.map(c => c.CODE));
    const setListado = new Set(clientesListado.map(c => c.CODE));

    console.log(`\nResumen de conteos:`);
    console.log(`  - Rutero (R1_T8CDVD): ${setRutero.size} clientes`);
    console.log(`  - Objetivos (LCCDVD): ${setObjetivos.size} clientes`);
    console.log(`  - Objetivos (R1_T8CDVD): ${setObjetivosR1.size} clientes`);
    console.log(`  - Listado (LCCDVD): ${setListado.size} clientes`);

    // Clientes en Rutero pero no en Objetivos
    const enRuteroNoObjetivos = [...setRutero].filter(c => !setObjetivos.has(c));
    console.log(`\nClientes en Rutero pero NO en Objetivos (LCCDVD): ${enRuteroNoObjetivos.length}`);
    if (enRuteroNoObjetivos.length > 0 && enRuteroNoObjetivos.length <= 20) {
      console.log(`  Códigos: ${enRuteroNoObjetivos.join(', ')}`);
    }

    // Clientes en Objetivos R1 vs Objetivos LCCDVD
    const diffR1vsLCCDVD = [...setObjetivosR1].filter(c => !setObjetivos.has(c));
    console.log(`\nClientes en Objetivos(R1) pero NO en Objetivos(LCCDVD): ${diffR1vsLCCDVD.length}`);

    console.log('\n✅ Análisis completado');
    console.log('\n📌 CONCLUSIÓN:');
    if (setObjetivosR1.size > setObjetivos.size) {
      console.log('  El endpoint by-client debería usar R1_T8CDVD (igual que el rutero)');
      console.log('  para que el conteo de clientes sea consistente.');
    } else if (setObjetivos.size > setObjetivosR1.size) {
      console.log('  LCCDVD tiene más clientes que R1_T8CDVD.');
    } else {
      console.log('  Ambos campos dan el mismo conteo de clientes.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

compareClients();
