/**
 * EXPLORACIÓN DE FORMAS DE PAGO Y CONDICIONES
 * 
 * Ejecutar: node scripts/cobros/explore_formas_pago.js
 * 
 * Este script encuentra:
 * - Todas las formas de pago existentes (DSEDAC.FPA)
 * - Cuáles se usan más en albaranes
 * - Identificación de CTR (Contra Reembolso)
 */

const odbc = require('odbc');
const fs = require('fs');
require('dotenv').config();

const connectionString = `DSN=GMP;UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;`;

async function explorarFormasPago() {
    let conn;
    const resultados = {};

    try {
        console.log('🔌 Conectando a la base de datos...\n');
        conn = await odbc.connect(connectionString);

        // ============================================
        // 1. TABLA DE FORMAS DE PAGO (FPA)
        // ============================================
        console.log('═'.repeat(60));
        console.log('1. FORMAS DE PAGO - TABLA FPA');
        console.log('═'.repeat(60));

        try {
            // Primero ver las columnas
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'FPA'
        ORDER BY ORDINAL_POSITION
      `);
            console.log('\nColumnas de DSEDAC.FPA:');
            console.table(cols);
            resultados.fpa_columnas = cols;

            // Contenido
            const fpa = await conn.query(`SELECT * FROM DSEDAC.FPA FETCH FIRST 30 ROWS ONLY`);
            console.log('\nContenido de FPA:');
            console.table(fpa);
            resultados.formas_pago = fpa;
        } catch (e) {
            console.log('   Error con FPA:', e.message);

            // Buscar tablas alternativas
            const tablas = await conn.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES
        WHERE UPPER(TABLE_NAME) LIKE '%PAGO%' 
          OR UPPER(TABLE_NAME) LIKE '%FPA%'
          OR UPPER(TABLE_NAME) LIKE '%COP%'
        AND TABLE_SCHEMA NOT LIKE 'Q%'
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('Tablas relacionadas con pagos:');
            console.table(tablas);
        }

        // ============================================
        // 2. FORMAS DE PAGO USADAS EN ALBARANES (2026)
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('2. FORMAS DE PAGO MÁS USADAS EN ALBARANES 2026');
        console.log('═'.repeat(60));

        try {
            const usadas = await conn.query(`
        SELECT 
          TRIM(CAC.CODIGOFORMAPAGO) as CODIGO,
          COUNT(*) as TOTAL_ALBARANES,
          SUM(CASE WHEN CAC.IMPORTETOTAL > 0 THEN 1 ELSE 0 END) as CON_IMPORTE
        FROM DSEDAC.CAC
        WHERE CAC.EJERCICIOALBARAN = 2026
          AND CAC.CODIGOFORMAPAGO IS NOT NULL
        GROUP BY TRIM(CAC.CODIGOFORMAPAGO)
        ORDER BY TOTAL_ALBARANES DESC
      `);
            console.table(usadas);
            resultados.formas_pago_usadas = usadas;

            // Intentar join con FPA para nombres
            try {
                const conNombres = await conn.query(`
          SELECT 
            TRIM(CAC.CODIGOFORMAPAGO) as CODIGO,
            TRIM(COALESCE(FPA.DESCRIPCION, FPA.NOMFPA, 'SIN NOMBRE')) as DESCRIPCION,
            COUNT(*) as TOTAL
          FROM DSEDAC.CAC
          LEFT JOIN DSEDAC.FPA ON TRIM(FPA.CODFPA) = TRIM(CAC.CODIGOFORMAPAGO)
          WHERE CAC.EJERCICIOALBARAN = 2026
          GROUP BY TRIM(CAC.CODIGOFORMAPAGO), TRIM(COALESCE(FPA.DESCRIPCION, FPA.NOMFPA, 'SIN NOMBRE'))
          ORDER BY TOTAL DESC
        `);
                console.log('\nFormas de pago con descripción:');
                console.table(conNombres);
                resultados.formas_pago_con_descripcion = conNombres;
            } catch (e) {
                console.log('   No se pudo obtener descripciones:', e.message);
            }
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // ============================================
        // 3. CONDUCTORES/REPARTIDORES EXISTENTES
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('3. CONDUCTORES EN ALBARANES 2026');
        console.log('═'.repeat(60));

        try {
            const conductores = await conn.query(`
        SELECT 
          TRIM(CODIGOCONDUCTOR) as CODIGO_CONDUCTOR,
          COUNT(*) as TOTAL_ALBARANES,
          MIN(ANODOCUMENTO * 10000 + MESDOCUMENTO * 100 + DIADOCUMENTO) as PRIMER_ALBARAN,
          MAX(ANODOCUMENTO * 10000 + MESDOCUMENTO * 100 + DIADOCUMENTO) as ULTIMO_ALBARAN
        FROM DSEDAC.CAC
        WHERE EJERCICIOALBARAN >= 2025
          AND CODIGOCONDUCTOR IS NOT NULL
          AND TRIM(CODIGOCONDUCTOR) <> ''
        GROUP BY TRIM(CODIGOCONDUCTOR)
        ORDER BY TOTAL_ALBARANES DESC
        FETCH FIRST 30 ROWS ONLY
      `);
            console.table(conductores);
            resultados.conductores = conductores;

            console.log(`\n📊 Total de conductores únicos: ${conductores.length}`);
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // ============================================
        // 4. CONDICIONES DE PAGO (COP)
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('4. CONDICIONES DE PAGO (COP)');
        console.log('═'.repeat(60));

        try {
            const cop = await conn.query(`SELECT * FROM DSEDAC.COP FETCH FIRST 20 ROWS ONLY`);
            console.table(cop);
            resultados.condiciones_pago = cop;
        } catch (e) {
            console.log('   Tabla COP no encontrada o error:', e.message);
        }

        // ============================================
        // 5. ANÁLISIS: DETECTAR CTR
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('5. ANÁLISIS: POSIBLES CÓDIGOS CTR (CONTADO/CONTRA REEMBOLSO)');
        console.log('═'.repeat(60));

        // Los códigos típicos de contado/CTR suelen ser:
        // - Descripciones con: CONTADO, EFECTIVO, CTR, REEMBOLSO
        // - Códigos cortos: 01, CO, EF
        console.log(`
NOTA: El CTR (Contra Reembolso) es cuando el repartidor debe cobrar
al entregar. Normalmente son formas de pago con descripción como:
- CONTADO
- EFECTIVO
- CONTRA REEMBOLSO
- CTR

Revisa los resultados anteriores para identificar cuál es.
`);

        // ============================================
        // GUARDAR JSON
        // ============================================
        const outputPath = 'resultados_formas_pago.json';
        fs.writeFileSync(outputPath, JSON.stringify(resultados, null, 2));
        console.log(`\n✅ Resultados guardados en: ${outputPath}`);

    } catch (error) {
        console.error('❌ Error general:', error);
    } finally {
        if (conn) await conn.close();
        console.log('\n🔌 Conexión cerrada');
    }
}

explorarFormasPago();
