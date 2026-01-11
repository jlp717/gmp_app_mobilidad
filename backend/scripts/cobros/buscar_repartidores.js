/**
 * BÚSQUEDA PROFUNDA DE TABLAS DE REPARTIDORES/CONDUCTORES
 * 
 * Ejecutar: node scripts/cobros/buscar_repartidores.js
 * 
 * Busca en TODOS los esquemas:
 * - Tablas con nombres relacionados a conductor, repartidor, chofer, driver
 * - Columnas con estos nombres
 * - Tablas de empleados, personal, trabajadores
 */

const odbc = require('odbc');
const fs = require('fs');
require('dotenv').config();

const connectionString = `DSN=GMP;UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;`;

async function buscarRepartidores() {
    let conn;
    const resultados = {};

    try {
        console.log('🔌 Conectando a la base de datos...\n');
        conn = await odbc.connect(connectionString);

        // ============================================
        // 1. BUSCAR TABLAS POR NOMBRE
        // ============================================
        console.log('═'.repeat(70));
        console.log('1. TABLAS CON NOMBRES RELACIONADOS A REPARTIDORES');
        console.log('═'.repeat(70));

        const palabrasClave = [
            '%COND%',      // conductor
            '%REPAR%',     // repartidor  
            '%CHOFER%',
            '%DRIVER%',
            '%TRANSP%',    // transporte
            '%CAMION%',
            '%VEHIC%',
            '%EMP%',       // empleado
            '%PERSON%',    // personal
            '%TRAB%',      // trabajador
            '%OPERARI%',
            '%RUTA%'
        ];

        for (const palabra of palabrasClave) {
            try {
                const tablas = await conn.query(`
          SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
          FROM QSYS2.SYSTABLES
          WHERE UPPER(TABLE_NAME) LIKE '${palabra}'
            AND TABLE_SCHEMA NOT LIKE 'Q%'
            AND TABLE_SCHEMA NOT LIKE 'SYS%'
          ORDER BY TABLE_SCHEMA, TABLE_NAME
          FETCH FIRST 20 ROWS ONLY
        `);

                if (tablas.length > 0) {
                    console.log(`\n📋 Tablas con "${palabra}":`);
                    console.table(tablas);
                    resultados[`tablas_${palabra.replace(/%/g, '')}`] = tablas;
                }
            } catch (e) { }
        }

        // ============================================
        // 2. BUSCAR COLUMNAS CON NOMBRES RELEVANTES
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('2. COLUMNAS CON NOMBRES DE CONDUCTOR/REPARTIDOR');
        console.log('═'.repeat(70));

        try {
            const columnas = await conn.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
        FROM QSYS2.SYSCOLUMNS
        WHERE (
          UPPER(COLUMN_NAME) LIKE '%COND%'
          OR UPPER(COLUMN_NAME) LIKE '%REPAR%'
          OR UPPER(COLUMN_NAME) LIKE '%CHOFER%'
          OR UPPER(COLUMN_NAME) LIKE '%DRIVER%'
        )
        AND TABLE_SCHEMA NOT LIKE 'Q%'
        AND TABLE_SCHEMA NOT LIKE 'SYS%'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
        FETCH FIRST 50 ROWS ONLY
      `);

            console.table(columnas);
            resultados.columnas_conductor = columnas;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 3. EXPLORAR ESQUEMAS DISPONIBLES
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('3. ESQUEMAS DISPONIBLES (NO SISTEMA)');
        console.log('═'.repeat(70));

        try {
            const esquemas = await conn.query(`
        SELECT DISTINCT TABLE_SCHEMA, COUNT(*) as NUM_TABLAS
        FROM QSYS2.SYSTABLES
        WHERE TABLE_SCHEMA NOT LIKE 'Q%'
          AND TABLE_SCHEMA NOT LIKE 'SYS%'
        GROUP BY TABLE_SCHEMA
        ORDER BY NUM_TABLAS DESC
        FETCH FIRST 30 ROWS ONLY
      `);
            console.table(esquemas);
            resultados.esquemas = esquemas;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 4. EXPLORAR TABLAS EN DSEDAC RELACIONADAS
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('4. TABLAS EN DSEDAC (ESQUEMA PRINCIPAL)');
        console.log('═'.repeat(70));

        try {
            const dsedac = await conn.query(`
        SELECT TABLE_NAME
        FROM QSYS2.SYSTABLES
        WHERE TABLE_SCHEMA = 'DSEDAC'
        ORDER BY TABLE_NAME
      `);

            // Filtrar las relevantes
            const relevantes = dsedac.filter(t =>
                /CON|EMP|PER|TRA|RUT|VEH|ALM|REP|CHO|DRI|OPE/i.test(t.TABLE_NAME)
            );

            console.log('Tablas potencialmente relevantes:');
            console.table(relevantes);
            resultados.dsedac_relevantes = relevantes;

            // Mostrar todas
            console.log('\nTodas las tablas en DSEDAC (primeras 50):');
            console.table(dsedac.slice(0, 50));
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 5. BUSCAR TABLA VEN (VENDEDORES COMPLETA)
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('5. TABLA VEN (SI EXISTE)');
        console.log('═'.repeat(70));

        try {
            const venCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VEN'
        ORDER BY ORDINAL_POSITION
      `);

            if (venCols.length > 0) {
                console.log('Columnas de VEN:');
                console.table(venCols);
                resultados.ven_columnas = venCols;

                // Contenido
                const venData = await conn.query(`SELECT * FROM DSEDAC.VEN FETCH FIRST 10 ROWS ONLY`);
                console.log('\nMuestra de VEN:');
                console.log(JSON.stringify(venData, null, 2));
                resultados.ven_muestra = venData;
            }
        } catch (e) {
            console.log('Tabla VEN no existe o error:', e.message);
        }

        // ============================================
        // 6. EXPLORAR VDD COMPLETO - BUSCAR TIPO
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('6. VDD - TODOS LOS VENDEDORES CON TIPO');
        console.log('═'.repeat(70));

        try {
            // Ver si hay campo TIPO o similar
            const vddTipos = await conn.query(`
        SELECT 
          CODIGOVENDEDOR,
          TRIM(NOMBREVENDEDOR) as NOMBRE,
          CLAVE1,
          CLAVE2,
          OBSERVACIONES
        FROM DSEDAC.VDD
        ORDER BY CODIGOVENDEDOR
      `);
            console.table(vddTipos);
            resultados.vdd_todos = vddTipos;

            // Buscar patrones en OBSERVACIONES que indiquen repartidor
            console.log('\n📌 Buscando "REPAR" o "COND" en observaciones:');
            const conObs = vddTipos.filter(v =>
                v.OBSERVACIONES && (
                    /REPAR|COND|CHOFER|TRANS/i.test(v.OBSERVACIONES) ||
                    /REPAR|COND|CHOFER|TRANS/i.test(v.NOMBRE)
                )
            );
            if (conObs.length > 0) {
                console.table(conObs);
            } else {
                console.log('Ninguno encontrado');
            }
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 7. BUSCAR EN OTROS ESQUEMAS COMUNES
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('7. TABLAS EN OTROS ESQUEMAS');
        console.log('═'.repeat(70));

        const otrosEsquemas = ['JAVIER', 'DATOS', 'DATA', 'MASTER', 'ALMACEN', 'LOGIST'];

        for (const esquema of otrosEsquemas) {
            try {
                const tablas = await conn.query(`
          SELECT TABLE_NAME
          FROM QSYS2.SYSTABLES
          WHERE TABLE_SCHEMA = '${esquema}'
          FETCH FIRST 30 ROWS ONLY
        `);

                if (tablas.length > 0) {
                    console.log(`\n📂 Tablas en ${esquema}:`);
                    console.table(tablas);
                }
            } catch (e) { }
        }

        // ============================================
        // GUARDAR RESULTADOS
        // ============================================
        fs.writeFileSync('resultados_busqueda_repartidores.json', JSON.stringify(resultados, null, 2));
        console.log('\n✅ Resultados guardados en: resultados_busqueda_repartidores.json');

    } catch (error) {
        console.error('❌ Error general:', error);
    } finally {
        if (conn) await conn.close();
        console.log('\n🔌 Conexión cerrada');
    }
}

buscarRepartidores();
