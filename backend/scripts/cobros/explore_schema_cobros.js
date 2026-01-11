/**
 * EXPLORACIÓN COMPLETA DE BD PARA COBROS
 * 
 * INSTRUCCIONES: Ejecutar con: node explore_schema_cobros.js
 * 
 * Este script explora:
 * 1. Estructura de DSEDAC.LACLAE (líneas de albarán extendida)
 * 2. Formas de pago disponibles
 * 3. Repartidores/Conductores
 * 4. Tablas de pendientes de cobro
 */

const odbc = require('odbc');
const fs = require('fs');
require('dotenv').config();

const connectionString = `DSN=GMP;UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;`;

async function explorar() {
    let conn;
    const resultados = {};

    try {
        console.log('🔌 Conectando...\n');
        conn = await odbc.connect(connectionString);

        // ============================================
        // 1. ESTRUCTURA DE DSEDAC.LACLAE
        // ============================================
        console.log('═'.repeat(60));
        console.log('1. COLUMNAS DE DSEDAC.LACLAE (Líneas Albarán Extendida)');
        console.log('═'.repeat(60));

        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LACLAE'
        ORDER BY ORDINAL_POSITION
      `);
            console.table(cols.slice(0, 50)); // Primeras 50
            resultados.laclae_columns = cols;
        } catch (e) {
            console.log('   Error o tabla no existe:', e.message);
        }

        // ============================================
        // 2. FORMAS DE PAGO
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('2. FORMAS DE PAGO (FPA)');
        console.log('═'.repeat(60));

        try {
            const formasPago = await conn.query(`
        SELECT * FROM DSEDAC.FPA
        FETCH FIRST 30 ROWS ONLY
      `);
            console.table(formasPago);
            resultados.formas_pago = formasPago;
        } catch (e) {
            console.log('   Error:', e.message);
            // Intentar buscar tabla de formas de pago
            try {
                const tablas = await conn.query(`
          SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES
          WHERE UPPER(TABLE_NAME) LIKE '%PAGO%' OR UPPER(TABLE_NAME) LIKE '%FPA%'
          AND TABLE_SCHEMA NOT LIKE 'Q%'
          FETCH FIRST 10 ROWS ONLY
        `);
                console.log('Tablas relacionadas con pagos:');
                console.table(tablas);
            } catch (e2) { }
        }

        // ============================================
        // 3. CONDICIONES DE PAGO
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('3. CONDICIONES DE PAGO');
        console.log('═'.repeat(60));

        try {
            const condiciones = await conn.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES
        WHERE (UPPER(TABLE_NAME) LIKE '%COND%' AND UPPER(TABLE_NAME) LIKE '%PAG%')
          OR UPPER(TABLE_NAME) LIKE '%COP%'
        AND TABLE_SCHEMA NOT LIKE 'Q%'
        FETCH FIRST 10 ROWS ONLY
      `);
            console.table(condiciones);

            // Si existe COP
            try {
                const cop = await conn.query(`SELECT * FROM DSEDAC.COP FETCH FIRST 20 ROWS ONLY`);
                console.log('\nContenido de DSEDAC.COP:');
                console.table(cop);
                resultados.condiciones_pago = cop;
            } catch (e) { }
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // ============================================
        // 4. REPARTIDORES / CONDUCTORES
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('4. BUSCANDO TABLA DE REPARTIDORES/CONDUCTORES');
        console.log('═'.repeat(60));

        // Buscar tablas relacionadas
        const keywords = ['REPAR', 'COND', 'CHOF', 'TRANSP', 'VEHIC', 'CAMION'];
        for (const kw of keywords) {
            try {
                const tablas = await conn.query(`
          SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES
          WHERE UPPER(TABLE_NAME) LIKE '%${kw}%'
            AND TABLE_SCHEMA NOT LIKE 'Q%'
          FETCH FIRST 5 ROWS ONLY
        `);
                if (tablas.length > 0) {
                    console.log(`\n🔍 Tablas con "${kw}":`);
                    console.table(tablas);
                }
            } catch (e) { }
        }

        // ============================================
        // 5. CAMPOS DE CAC (ALBARANES) RELACIONADOS CON REPARTO
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('5. CAMPOS DE REPARTO EN ALBARANES (CAC)');
        console.log('═'.repeat(60));

        try {
            const cacCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
        ORDER BY ORDINAL_POSITION
      `);

            // Filtrar columnas relevantes
            const relevantes = cacCols.filter(c =>
                /REPAR|COND|CHOF|TRANS|VEHIC|CAMION|RUTA|FORMA|PAGO|CTR|REEMB/i.test(c.COLUMN_NAME)
            );

            if (relevantes.length > 0) {
                console.log('Columnas relevantes para reparto/cobro:');
                console.table(relevantes);
            } else {
                console.log('Primeras 40 columnas de CAC:');
                console.table(cacCols.slice(0, 40));
            }
            resultados.cac_columns = cacCols;
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // ============================================
        // 6. MUESTRA DE DATOS CAC (Albaranes de hoy)
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('6. MUESTRA DE ALBARANES (CAC)');
        console.log('═'.repeat(60));

        try {
            const albaranes = await conn.query(`
        SELECT 
          NUMEROALBARAN,
          CODIGOCLIENTEFACTURA,
          CODIGOFORMAPAGO,
          IMPORTETOTAL,
          ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO
        FROM DSEDAC.CAC
        WHERE EJERCICIOALBARAN = 2026
        ORDER BY NUMEROALBARAN DESC
        FETCH FIRST 10 ROWS ONLY
      `);
            console.table(albaranes);
            resultados.muestra_albaranes = albaranes;
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // ============================================
        // 7. TABLA VEN (VENDEDORES) - TIPOS
        // ============================================
        console.log('\n' + '═'.repeat(60));
        console.log('7. TIPOS DE VENDEDOR EN VEN');
        console.log('═'.repeat(60));

        try {
            const ven = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VEN'
        ORDER BY ORDINAL_POSITION
      `);
            console.log('Columnas de VEN:');
            console.table(ven);
            resultados.ven_columns = ven;
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // ============================================
        // GUARDAR RESULTADOS
        // ============================================
        fs.writeFileSync(
            'resultados_exploracion_cobros.json',
            JSON.stringify(resultados, null, 2)
        );
        console.log('\n✅ Resultados guardados en: resultados_exploracion_cobros.json');

    } catch (error) {
        console.error('❌ Error general:', error);
    } finally {
        if (conn) await conn.close();
    }
}

explorar();
