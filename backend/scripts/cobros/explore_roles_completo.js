/**
 * EXPLORACIÓN COMPLETA DE ESTRUCTURA DE ROLES
 * 
 * Ejecutar: node scripts/cobros/explore_roles_completo.js
 * 
 * Busca:
 * - Cómo identificar JEFES (campo JEFEVENTASSN en VDD?)
 * - Cómo se registran REPARTIDORES/CONDUCTORES
 * - Relación cliente-comercial-repartidor
 * - Estructura de entregas/rutas
 */

const odbc = require('odbc');
const fs = require('fs');
require('dotenv').config();

const connectionString = `DSN=GMP;UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;`;

async function explorarRoles() {
    let conn;
    const resultados = {};

    try {
        console.log('🔌 Conectando a la base de datos...\n');
        conn = await odbc.connect(connectionString);

        // ============================================
        // 1. ESTRUCTURA DE VENDEDORES (VDD)
        // ============================================
        console.log('═'.repeat(60));
        console.log('1. COLUMNAS DE VENDEDORES (VDD)');
        console.log('═'.repeat(60));

        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VDD'
        ORDER BY ORDINAL_POSITION
      `);
            console.table(cols);
            resultados.vdd_columnas = cols;

            // Buscar campo de JEFE
            const jefeFields = cols.filter(c =>
                /JEFE|SUPER|ADMIN|DIRECTOR|TIPO/i.test(c.COLUMN_NAME)
            );
            if (jefeFields.length > 0) {
                console.log('\n📌 Campos posibles para identificar JEFE:');
                console.table(jefeFields);
            }
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 2. VENDEDORES CON DATOS COMPLETOS
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('2. MUESTRA DE VENDEDORES (BUSCANDO GOYO)');
        console.log('═'.repeat(60));

        try {
            // Buscar GOYO
            const goyo = await conn.query(`
        SELECT * FROM DSEDAC.VDD
        WHERE UPPER(NOMBREVENDEDOR) LIKE '%GOYO%'
        FETCH FIRST 5 ROWS ONLY
      `);
            console.log('\n🔍 GOYO:');
            if (goyo.length > 0) {
                console.log(JSON.stringify(goyo, null, 2));
                resultados.goyo = goyo;
            } else {
                console.log('No encontrado con LIKE GOYO');
            }

            // Buscar MARICARMEN
            const maricarmen = await conn.query(`
        SELECT * FROM DSEDAC.VDD
        WHERE UPPER(NOMBREVENDEDOR) LIKE '%MARICARMEN%' OR UPPER(NOMBREVENDEDOR) LIKE '%MARIA%CARMEN%'
        FETCH FIRST 5 ROWS ONLY
      `);
            console.log('\n🔍 MARICARMEN:');
            if (maricarmen.length > 0) {
                console.log(JSON.stringify(maricarmen, null, 2));
                resultados.maricarmen = maricarmen;
            }

            // Todos los vendedores
            const todos = await conn.query(`
        SELECT 
          CODIGOVENDEDOR,
          TRIM(NOMBREVENDEDOR) as NOMBRE,
          JEFEVENTASSN,
          TIPOVENDEDOR
        FROM DSEDAC.VDD
        ORDER BY CODIGOVENDEDOR
        FETCH FIRST 50 ROWS ONLY
      `);
            console.log('\n📋 TODOS LOS VENDEDORES:');
            console.table(todos);
            resultados.vendedores = todos;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 3. IDENTIFICAR JEFES DE VENTAS
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('3. JEFES DE VENTAS (JEFEVENTASSN = S o similar)');
        console.log('═'.repeat(60));

        try {
            const jefes = await conn.query(`
        SELECT 
          CODIGOVENDEDOR,
          TRIM(NOMBREVENDEDOR) as NOMBRE,
          JEFEVENTASSN,
          TIPOVENDEDOR
        FROM DSEDAC.VDD
        WHERE JEFEVENTASSN = 'S' OR JEFEVENTASSN = '1' OR JEFEVENTASSN = 'Y'
           OR TIPOVENDEDOR = 'J' OR TIPOVENDEDOR = 'JEFE'
        FETCH FIRST 20 ROWS ONLY
      `);

            if (jefes.length > 0) {
                console.log('✅ JEFES encontrados:');
                console.table(jefes);
                resultados.jefes = jefes;
            } else {
                console.log('No se encontraron jefes con JEFEVENTASSN=S');

                // Mostrar valores únicos de JEFEVENTASSN
                const valores = await conn.query(`
          SELECT DISTINCT JEFEVENTASSN, COUNT(*) as TOTAL
          FROM DSEDAC.VDD
          GROUP BY JEFEVENTASSN
        `);
                console.log('\nValores únicos de JEFEVENTASSN:');
                console.table(valores);
            }
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 4. CONDUCTORES/REPARTIDORES EN ALBARANES
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('4. CONDUCTORES ACTIVOS EN ALBARANES 2026');
        console.log('═'.repeat(60));

        try {
            const conductores = await conn.query(`
        SELECT 
          TRIM(CODIGOCONDUCTOR) as CODIGO_CONDUCTOR,
          COUNT(*) as TOTAL_ALBARANES,
          COUNT(DISTINCT CODIGOCLIENTEFACTURA) as CLIENTES_DISTINTOS
        FROM DSEDAC.CAC
        WHERE EJERCICIOALBARAN = 2026
          AND CODIGOCONDUCTOR IS NOT NULL
          AND TRIM(CODIGOCONDUCTOR) <> ''
        GROUP BY TRIM(CODIGOCONDUCTOR)
        ORDER BY TOTAL_ALBARANES DESC
        FETCH FIRST 30 ROWS ONLY
      `);
            console.table(conductores);
            resultados.conductores = conductores;

            if (conductores.length > 0) {
                console.log(`\n📊 ${conductores.length} conductores encontrados`);
            } else {
                console.log('\n⚠️ No hay conductores registrados en CAC');
                console.log('   Puede que usen otro campo para identificar repartidores');
            }
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 5. BUSCAR TABLA DE EMPLEADOS (EMP)
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('5. TABLA DE EMPLEADOS (EMP) - BUSCAR REPARTIDORES');
        console.log('═'.repeat(60));

        try {
            const empCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'EMP'
        ORDER BY ORDINAL_POSITION
      `);
            console.log('Columnas de EMP:');
            console.table(empCols);

            // Buscar empleados por tipo
            const empleados = await conn.query(`
        SELECT * FROM DSEDAC.EMP
        FETCH FIRST 20 ROWS ONLY
      `);
            console.log('\nMuestra de empleados:');
            console.table(empleados);
            resultados.empleados = empleados;
        } catch (e) {
            console.log('Tabla EMP no encontrada:', e.message);
        }

        // ============================================
        // 6. RELACIÓN CLIENTE - VENDEDOR (RUTA)
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('6. RELACIÓN CLIENTE - VENDEDOR (quién atiende a quién)');
        console.log('═'.repeat(60));

        try {
            // Clientes con su vendedor asignado
            const clientesVendedor = await conn.query(`
        SELECT 
          TRIM(CLI.CODIGOCLIENTE) as CLIENTE,
          TRIM(CLI.NOMBREFISCAL) as NOMBRE,
          TRIM(CLI.CODIGOVENDEDOR) as VENDEDOR,
          TRIM(CLI.CODIGORUTA) as RUTA
        FROM DSEDAC.CLI
        WHERE CLI.CODIGOVENDEDOR IS NOT NULL
        ORDER BY CLI.CODIGOVENDEDOR
        FETCH FIRST 30 ROWS ONLY
      `);
            console.table(clientesVendedor);
            resultados.clientes_vendedor = clientesVendedor;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 7. ESTRUCTURA DE RUTAS
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('7. TABLAS DE RUTAS');
        console.log('═'.repeat(60));

        try {
            const tablasRutas = await conn.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM QSYS2.SYSTABLES
        WHERE UPPER(TABLE_NAME) LIKE '%RUTA%'
          AND TABLE_SCHEMA NOT LIKE 'Q%'
        FETCH FIRST 10 ROWS ONLY
      `);
            console.table(tablasRutas);

            // Si existe tabla de rutas
            for (const t of tablasRutas) {
                try {
                    const muestra = await conn.query(`
            SELECT * FROM ${t.TABLE_SCHEMA}.${t.TABLE_NAME}
            FETCH FIRST 5 ROWS ONLY
          `);
                    console.log(`\nMuestra de ${t.TABLE_NAME}:`);
                    console.table(muestra);
                } catch { }
            }
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 8. BUSCAR TABLAS EN JAVIER
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('8. TABLAS EN ESQUEMA JAVIER');
        console.log('═'.repeat(60));

        try {
            const javierTables = await conn.query(`
        SELECT TABLE_NAME, TABLE_TYPE
        FROM QSYS2.SYSTABLES
        WHERE TABLE_SCHEMA = 'JAVIER'
        ORDER BY TABLE_NAME
      `);

            // Filtrar tablas relevantes
            const relevantes = javierTables.filter(t =>
                /RUTA|VISIT|REPER|COND|USER|ROL|LOGIN/i.test(t.TABLE_NAME)
            );

            if (relevantes.length > 0) {
                console.log('Tablas relevantes para roles/rutas:');
                console.table(relevantes);
            } else {
                console.log('No hay tablas de roles en JAVIER todavía');
            }

            // Mostrar todas de JAVIER
            console.log('\nTodas las tablas en JAVIER:');
            console.table(javierTables.slice(0, 30));
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // GUARDAR RESULTADOS
        // ============================================
        fs.writeFileSync('resultados_roles_completo.json', JSON.stringify(resultados, null, 2));
        console.log('\n✅ Resultados guardados en: resultados_roles_completo.json');

        // ============================================
        // RESUMEN
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('📊 RESUMEN');
        console.log('═'.repeat(60));
        console.log(`
PARA IDENTIFICAR JEFE DE VENTAS:
- Campo VDD.JEFEVENTASSN = 'S' (o el valor que encuentres arriba)
- Si GOYO con PIN 9584 es jefe, revisa su registro completo arriba

PARA IDENTIFICAR REPARTIDORES:
- Si CAC.CODIGOCONDUCTOR tiene valores → son los repartidores
- Si no, puede que usen tabla EMP con un campo TIPO
- O puede que sean vendedores con TIPOVENDEDOR específico

RELACIÓN CLIENTE-VENDEDOR:
- CLI.CODIGOVENDEDOR indica qué vendedor atiende cada cliente
- CLI.CODIGORUTA indica la ruta del cliente
    `);

    } catch (error) {
        console.error('❌ Error general:', error);
    } finally {
        if (conn) await conn.close();
        console.log('\n🔌 Conexión cerrada');
    }
}

explorarRoles();
