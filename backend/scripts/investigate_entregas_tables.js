/**
 * Script para investigar tablas ENTD/ENTP (Entregas) y cómo se asignan repartidores
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function investigateEntregas() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║     INVESTIGANDO TABLAS DE ENTREGAS Y RUTAS                    ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. Columnas de ENTD (Entregas Detalle?)
        console.log('1. COLUMNAS DE DSEDAC.ENTD:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const entdCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ENTD'
            ORDER BY COLUMN_NAME
        `);
        entdCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Columnas de ENTP (Entregas Principal?)
        console.log('\n\n2. COLUMNAS DE DSEDAC.ENTP:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const entpCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ENTP'
            ORDER BY COLUMN_NAME
        `);
        entpCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 3. Sample de ENTP
        console.log('\n\n3. SAMPLE DE DSEDAC.ENTP (últimos registros):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const entpSample = await conn.query(`
                SELECT * FROM DSEDAC.ENTP
                FETCH FIRST 5 ROWS ONLY
            `);
            
            if (entpSample.length > 0) {
                const row = entpSample[0];
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && v !== '' && String(v).trim() !== '') {
                        console.log(`   ${k}: ${v}`);
                    }
                });
            } else {
                console.log('   (tabla vacía)');
            }
        } catch (e) {
            console.log(`   Error: ${e.message.substring(0, 80)}`);
        }

        // 4. Columnas de RUT (Rutas)
        console.log('\n\n4. COLUMNAS DE DSEDAC.RUT:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const rutCols = await conn.query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'RUT'
                ORDER BY COLUMN_NAME
            `);
            rutCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        } catch (e) {
            console.log('   No existe RUT');
        }

        // 5. Ver la tabla RUTAS
        console.log('\n\n5. SAMPLE DE DSEDAC.RUTAS:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const rutasSample = await conn.query(`
                SELECT * FROM DSEDAC.RUTAS
                FETCH FIRST 10 ROWS ONLY
            `);
            
            if (rutasSample.length > 0) {
                rutasSample.forEach((row, i) => {
                    console.log(`   --- Ruta ${i + 1} ---`);
                    Object.entries(row).forEach(([k, v]) => {
                        if (v !== null && v !== '' && String(v).trim() !== '' && !k.includes('L1')) {
                            console.log(`   ${k}: ${v}`);
                        }
                    });
                    console.log('');
                });
            }
        } catch (e) {
            console.log(`   Error: ${e.message.substring(0, 80)}`);
        }

        // 6. Buscar columnas con REPARTIDOR en cualquier tabla
        console.log('\n\n6. COLUMNAS QUE CONTIENEN "REPARTIDOR":');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const repCols = await conn.query(`
            SELECT TABLE_NAME, COLUMN_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC'
            AND COLUMN_NAME LIKE '%REPARTIDOR%'
        `);
        
        if (repCols.length > 0) {
            repCols.forEach(c => console.log(`   ${c.TABLE_NAME}.${c.COLUMN_NAME}`));
        } else {
            console.log('   No hay columnas con REPARTIDOR');
        }

        // 7. Verificar la relación ruta -> vendedor/repartidor en CLI
        console.log('\n\n7. CLIENTES CON RUTA ASIGNADA (CLI.CODIGORUTA):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const clientesRuta = await conn.query(`
            SELECT TRIM(CODIGORUTA) as RUTA, COUNT(*) as CLIENTES
            FROM DSEDAC.CLI
            WHERE CODIGORUTA IS NOT NULL AND TRIM(CODIGORUTA) <> ''
            GROUP BY TRIM(CODIGORUTA)
            ORDER BY CLIENTES DESC
            FETCH FIRST 15 ROWS ONLY
        `);
        clientesRuta.forEach(r => console.log(`   Ruta '${r.RUTA}': ${r.CLIENTES} clientes`));

        // 8. Conclusión: ¿Hay forma de saber qué repartidor entrega qué?
        console.log('\n\n════════════════════════════════════════════════════════════════');
        console.log('                         CONCLUSIÓN');
        console.log('════════════════════════════════════════════════════════════════\n');
        
        console.log('   Los campos de repartidor en CAC están VACÍOS:');
        console.log('   - CODIGOVENDEDORCONDUCTOR: vacío');
        console.log('   - CODIGOVENDEDORREPARTORUTERO: vacío');
        console.log('   - CODIGOCONDUCTOR: vacío');
        console.log('');
        console.log('   Esto significa que la empresa NO está registrando');
        console.log('   qué repartidor entrega cada documento en DB2.');
        console.log('');
        console.log('   OPCIONES PARA TESTING:');
        console.log('   1. Usar un comercial (10, 93, 02, etc.) que SÍ tiene documentos');
        console.log('   2. O la app necesita crear una tabla propia de seguimiento');
        console.log('      de entregas por repartidor');
        
        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

investigateEntregas().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
