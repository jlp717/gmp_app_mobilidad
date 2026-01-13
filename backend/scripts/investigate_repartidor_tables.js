/**
 * Script para investigar las tablas que SÍ tienen CODIGOREPARTIDOR
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function investigateRepartidorTables() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║     TABLAS CON CODIGOREPARTIDOR                                ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. Tabla C15 - Parece de comisiones
        console.log('1. TABLA C15 (Comisiones?):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const c15Cols = await conn.query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'C15'
                ORDER BY COLUMN_NAME
            `);
            console.log('   Columnas principales:');
            c15Cols.slice(0, 20).forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
            
            // Ver sample
            const c15Sample = await conn.query(`
                SELECT VENDEDORREPARTIDOR, PORCENTAJEREPARTIDOR, 
                       COMISIONREPARTIDORCONTADO, COMISIONREPARTIDORTOTAL
                FROM DSEDAC.C15
                WHERE VENDEDORREPARTIDOR IS NOT NULL AND TRIM(VENDEDORREPARTIDOR) <> ''
                FETCH FIRST 10 ROWS ONLY
            `);
            
            if (c15Sample.length > 0) {
                console.log('\n   Datos con repartidor:');
                c15Sample.forEach(r => console.log(`   Rep: ${r.VENDEDORREPARTIDOR}, %: ${r.PORCENTAJEREPARTIDOR}, Comisión: ${r.COMISIONREPARTIDORTOTAL}`));
            } else {
                console.log('\n   No hay datos con VENDEDORREPARTIDOR poblado');
            }
        } catch (e) {
            console.log(`   Error: ${e.message.substring(0, 80)}`);
        }

        // 2. Tabla CAPC (Cabecera de Pedidos de Clientes?)
        console.log('\n\n2. TABLA CAPC (con CODIGOREPARTIDOR):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const capcCols = await conn.query(`
                SELECT COLUMN_NAME
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAPC'
                AND (COLUMN_NAME LIKE '%REPARTIDOR%' 
                     OR COLUMN_NAME LIKE '%VENDEDOR%'
                     OR COLUMN_NAME LIKE '%CLIENTE%'
                     OR COLUMN_NAME LIKE '%FECHA%'
                     OR COLUMN_NAME LIKE '%DIA%'
                     OR COLUMN_NAME LIKE '%MES%'
                     OR COLUMN_NAME LIKE '%ANO%')
                ORDER BY COLUMN_NAME
            `);
            console.log('   Columnas relevantes:');
            capcCols.forEach(c => console.log(`   ${c.COLUMN_NAME}`));
            
            // Ver qué repartidores hay
            const capcReps = await conn.query(`
                SELECT DISTINCT TRIM(CODIGOREPARTIDOR) as REP, COUNT(*) as CNT
                FROM DSEDAC.CAPC
                WHERE CODIGOREPARTIDOR IS NOT NULL AND TRIM(CODIGOREPARTIDOR) <> ''
                GROUP BY TRIM(CODIGOREPARTIDOR)
                ORDER BY CNT DESC
                FETCH FIRST 20 ROWS ONLY
            `);
            
            if (capcReps.length > 0) {
                console.log('\n   ✅ REPARTIDORES EN CAPC:');
                capcReps.forEach(r => console.log(`      Repartidor '${r.REP}': ${r.CNT} registros`));
            } else {
                console.log('\n   No hay datos con CODIGOREPARTIDOR poblado');
            }
        } catch (e) {
            console.log(`   Error: ${e.message.substring(0, 80)}`);
        }

        // 3. Tabla OPP (Operaciones de Pedido?)
        console.log('\n\n3. TABLA OPP (con CODIGOREPARTIDOR):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const oppCols = await conn.query(`
                SELECT COLUMN_NAME
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPP'
                AND (COLUMN_NAME LIKE '%REPARTIDOR%' 
                     OR COLUMN_NAME LIKE '%VENDEDOR%'
                     OR COLUMN_NAME LIKE '%CLIENTE%'
                     OR COLUMN_NAME LIKE '%ALBARAN%'
                     OR COLUMN_NAME LIKE '%FECHA%')
                ORDER BY COLUMN_NAME
            `);
            console.log('   Columnas relevantes:');
            oppCols.forEach(c => console.log(`   ${c.COLUMN_NAME}`));
            
            // Ver qué repartidores hay
            const oppReps = await conn.query(`
                SELECT DISTINCT TRIM(CODIGOREPARTIDOR) as REP, COUNT(*) as CNT
                FROM DSEDAC.OPP
                WHERE CODIGOREPARTIDOR IS NOT NULL AND TRIM(CODIGOREPARTIDOR) <> ''
                GROUP BY TRIM(CODIGOREPARTIDOR)
                ORDER BY CNT DESC
                FETCH FIRST 20 ROWS ONLY
            `);
            
            if (oppReps.length > 0) {
                console.log('\n   ✅ REPARTIDORES EN OPP:');
                oppReps.forEach(r => console.log(`      Repartidor '${r.REP}': ${r.CNT} registros`));
            } else {
                console.log('\n   No hay datos con CODIGOREPARTIDOR poblado');
            }
        } catch (e) {
            console.log(`   Error: ${e.message.substring(0, 80)}`);
        }

        // 4. Tabla CACC
        console.log('\n\n4. TABLA CACC (con CODIGOREPARTIDOR):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const caccReps = await conn.query(`
                SELECT DISTINCT TRIM(CODIGOREPARTIDOR) as REP, COUNT(*) as CNT
                FROM DSEDAC.CACC
                WHERE CODIGOREPARTIDOR IS NOT NULL AND TRIM(CODIGOREPARTIDOR) <> ''
                GROUP BY TRIM(CODIGOREPARTIDOR)
                ORDER BY CNT DESC
                FETCH FIRST 20 ROWS ONLY
            `);
            
            if (caccReps.length > 0) {
                console.log('   ✅ REPARTIDORES EN CACC:');
                caccReps.forEach(r => console.log(`      Repartidor '${r.REP}': ${r.CNT} registros`));
                
                // Ver sample de esta tabla
                const caccSample = await conn.query(`
                    SELECT * FROM DSEDAC.CACC
                    WHERE TRIM(CODIGOREPARTIDOR) = '${caccReps[0].REP}'
                    FETCH FIRST 1 ROWS ONLY
                `);
                
                if (caccSample.length > 0) {
                    console.log('\n   Sample de registro:');
                    Object.entries(caccSample[0]).forEach(([k, v]) => {
                        if (v !== null && v !== '' && String(v).trim() !== '') {
                            console.log(`      ${k}: ${v}`);
                        }
                    });
                }
            } else {
                console.log('   No hay datos con CODIGOREPARTIDOR poblado');
            }
        } catch (e) {
            console.log(`   Error: ${e.message.substring(0, 80)}`);
        }

        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

investigateRepartidorTables().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
