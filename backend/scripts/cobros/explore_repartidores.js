/**
 * EXPLORACIÓN DE BD - REPARTIDORES Y ENTREGAS
 * Busca tablas relacionadas con repartidores, entregas, conductores
 */

const odbc = require('odbc');
require('dotenv').config();

const connectionString = `DSN=GMP;UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;`;

async function explorarRepartidores() {
    let connection;

    try {
        console.log('🔌 Conectando a la base de datos...\n');
        connection = await odbc.connect(connectionString);

        // ============================================
        // 1. BUSCAR TABLAS RELACIONADAS CON REPARTIDORES
        // ============================================
        console.log('='.repeat(60));
        console.log('1. BUSCANDO TABLAS DE REPARTIDORES/CONDUCTORES');
        console.log('='.repeat(60));

        const keywords = ['REPAR', 'COND', 'CHOF', 'DRIVER', 'ENTREGA', 'REPARTO'];

        for (const keyword of keywords) {
            console.log(`\n🔍 Buscando tablas con "${keyword}"...`);
            try {
                const tables = await connection.query(`
          SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
          FROM QSYS2.SYSTABLES
          WHERE UPPER(TABLE_NAME) LIKE '%${keyword}%'
            AND TABLE_SCHEMA NOT LIKE 'Q%'
          ORDER BY TABLE_SCHEMA, TABLE_NAME
          FETCH FIRST 20 ROWS ONLY
        `);

                if (tables.length > 0) {
                    console.table(tables);
                } else {
                    console.log(`   No se encontraron tablas con "${keyword}"`);
                }
            } catch (e) {
                console.log(`   Error buscando "${keyword}": ${e.message}`);
            }
        }

        // ============================================
        // 2. BUSCAR EN TABLAS DE EMPLEADOS
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('2. EXPLORANDO TABLAS DE EMPLEADOS (EMP, VEN, USU)');
        console.log('='.repeat(60));

        // Tabla de empleados
        try {
            console.log('\n📋 Columnas de DSEDAC.EMP (Empleados):');
            const empCols = await connection.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'EMP'
        ORDER BY ORDINAL_POSITION
        FETCH FIRST 30 ROWS ONLY
      `);
            console.table(empCols);
        } catch (e) {
            console.log('   Tabla EMP no encontrada');
        }

        // Buscar tipos de empleado
        try {
            console.log('\n📋 Tipos de empleados únicos en EMP:');
            const tipos = await connection.query(`
        SELECT DISTINCT
          TIPOEMP as TIPO,
          COUNT(*) as CANTIDAD
        FROM DSEDAC.EMP
        GROUP BY TIPOEMP
        ORDER BY CANTIDAD DESC
        FETCH FIRST 10 ROWS ONLY
      `);
            console.table(tipos);
        } catch (e) {
            console.log('   Error consultando tipos: ' + e.message);
        }

        // ============================================
        // 3. BUSCAR TABLAS DE RUTAS/ENTREGAS
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('3. TABLAS DE RUTAS Y ENTREGAS');
        console.log('='.repeat(60));

        const rutaKeywords = ['RUTA', 'ROUTE', 'VIAJE', 'TRIP'];

        for (const keyword of rutaKeywords) {
            try {
                const tables = await connection.query(`
          SELECT TABLE_SCHEMA, TABLE_NAME
          FROM QSYS2.SYSTABLES
          WHERE UPPER(TABLE_NAME) LIKE '%${keyword}%'
            AND TABLE_SCHEMA NOT LIKE 'Q%'
          FETCH FIRST 10 ROWS ONLY
        `);

                if (tables.length > 0) {
                    console.log(`\n🚚 Tablas con "${keyword}":`);
                    console.table(tables);
                }
            } catch (e) {
                // silenciar
            }
        }

        // ============================================
        // 4. EXPLORAR ALBARANES (CAC) - CAMPO REPARTIDOR
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('4. CAMPOS RELACIONADOS CON REPARTIDOR EN CAC (ALBARANES)');
        console.log('='.repeat(60));

        try {
            const cacCols = await connection.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
          AND (UPPER(COLUMN_NAME) LIKE '%REPAR%'
            OR UPPER(COLUMN_NAME) LIKE '%COND%'
            OR UPPER(COLUMN_NAME) LIKE '%CHOF%'
            OR UPPER(COLUMN_NAME) LIKE '%TRANS%'
            OR UPPER(COLUMN_NAME) LIKE '%VEHIC%'
            OR UPPER(COLUMN_NAME) LIKE '%CAMION%')
        ORDER BY COLUMN_NAME
      `);

            if (cacCols.length > 0) {
                console.log('\n📦 Columnas de repartidor/transporte en CAC:');
                console.table(cacCols);
            } else {
                console.log('   No se encontraron columnas específicas de repartidor en CAC');
            }
        } catch (e) {
            console.log('   Error: ' + e.message);
        }

        // ============================================
        // 5. BUSCAR TABLAS EN ESQUEMA JAVIER
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('5. TABLAS EN ESQUEMA JAVIER');
        console.log('='.repeat(60));

        try {
            const javierTables = await connection.query(`
        SELECT TABLE_NAME, TABLE_TYPE
        FROM QSYS2.SYSTABLES
        WHERE TABLE_SCHEMA = 'JAVIER'
        ORDER BY TABLE_NAME
      `);

            if (javierTables.length > 0) {
                console.table(javierTables);
            } else {
                console.log('   No hay tablas en JAVIER');
            }
        } catch (e) {
            console.log('   Error: ' + e.message);
        }

        // ============================================
        // 6. MUESTRA DE DATOS DE VENDEDORES
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('6. MUESTRA DE VENDEDORES (VEN)');
        console.log('='.repeat(60));

        try {
            const vendedores = await connection.query(`
        SELECT 
          CODVEN as CODIGO,
          NOMVEN as NOMBRE,
          TIPOVEN as TIPO
        FROM DSEDAC.VEN
        WHERE CODVEN IS NOT NULL
        ORDER BY CODVEN
        FETCH FIRST 20 ROWS ONLY
      `);
            console.table(vendedores);
        } catch (e) {
            console.log('   Error: ' + e.message);
        }

        // ============================================
        // RESUMEN
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('📊 ANÁLISIS COMPLETADO');
        console.log('='.repeat(60));
        console.log(`
NOTAS:
- Si NO hay tablas específicas de repartidores, el rol de "repartidor"
  probablemente se gestiona como un tipo de vendedor/empleado.
- Los albaranes (CAC) pueden tener campos que indiquen quién entrega.
- Podrías crear una tabla JAVIER.REPARTIDORES para gestionar este rol.
    `);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        if (connection) {
            await connection.close();
            console.log('\n🔌 Conexión cerrada');
        }
    }
}

explorarRepartidores();
