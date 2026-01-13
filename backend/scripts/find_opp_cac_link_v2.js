/**
 * Buscar cómo vincular OPP con CAC usando las columnas disponibles
 * OPP tiene: EJERCICIOORDENPREPARACION, NUMEROORDENPREPARACION, DIAREPARTO, etc.
 * Necesitamos encontrar qué campo de CAC o LAC tiene esa información
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('Conectado a DB2\n');
        
        // 1. Obtener una orden del repartidor 79 de enero 2026
        console.log('1. ORDEN DEL REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const opp79 = await conn.query(`
            SELECT EJERCICIOORDENPREPARACION, NUMEROORDENPREPARACION, 
                   DIAREPARTO, MESREPARTO, ANOREPARTO, CODIGOVEHICULO
            FROM DSEDAC.OPP
            WHERE CODIGOREPARTIDOR = '79' AND ANOREPARTO = 2026 AND MESREPARTO = 1
            ORDER BY DIAREPARTO DESC
            FETCH FIRST 1 ROWS ONLY
        `);
        
        if (opp79.length > 0) {
            const o = opp79[0];
            console.log(`   Orden: ${o.EJERCICIOORDENPREPARACION}-${o.NUMEROORDENPREPARACION}`);
            console.log(`   Fecha reparto: ${o.DIAREPARTO}/${o.MESREPARTO}/${o.ANOREPARTO}`);
            console.log(`   Vehículo: ${o.CODIGOVEHICULO}`);
        }

        // 2. Buscar tablas que tengan EJERCICIOORDENPREPARACION Y NUMEROALBARAN
        console.log('\n\n2. TABLAS QUE VINCULEN ORDEN CON ALBARÁN:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const tablasVinculo = await conn.query(`
            SELECT A.TABLE_NAME, 
                   (SELECT COUNT(*) FROM QSYS2.SYSCOLUMNS C2 
                    WHERE C2.TABLE_SCHEMA = 'DSEDAC' 
                      AND C2.TABLE_NAME = A.TABLE_NAME 
                      AND C2.COLUMN_NAME LIKE '%ALBARAN%') as HAS_ALBARAN
            FROM QSYS2.SYSCOLUMNS A
            WHERE A.TABLE_SCHEMA = 'DSEDAC' 
              AND A.COLUMN_NAME = 'NUMEROORDENPREPARACION'
            GROUP BY A.TABLE_NAME
        `);
        
        for (const t of tablasVinculo) {
            console.log(`   ${t.TABLE_NAME}: ${t.HAS_ALBARAN > 0 ? '✓ tiene ALBARAN' : '✗ no tiene ALBARAN'}`);
            
            if (t.HAS_ALBARAN > 0) {
                // Ver columnas
                const cols = await conn.query(`
                    SELECT COLUMN_NAME
                    FROM QSYS2.SYSCOLUMNS
                    WHERE TABLE_SCHEMA = 'DSEDAC' 
                      AND TABLE_NAME = '${t.TABLE_NAME}'
                      AND (COLUMN_NAME LIKE '%ALBARAN%' OR COLUMN_NAME = 'NUMEROORDENPREPARACION')
                `);
                console.log(`       Columnas: ${cols.map(c => c.COLUMN_NAME).join(', ')}`);
            }
        }

        // 3. Verificar OPPL1 (Líneas de orden de preparación)
        console.log('\n\n3. ESTRUCTURA DE OPPL1:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oppl1Cols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPPL1'
            ORDER BY ORDINAL_POSITION
        `);
        
        oppl1Cols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 4. Sample de OPPL1 para el repartidor 79
        console.log('\n\n4. SAMPLE OPPL1 PARA ORDEN DEL REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        if (opp79.length > 0) {
            const numOrden = opp79[0].NUMEROORDENPREPARACION;
            const ejOrden = opp79[0].EJERCICIOORDENPREPARACION;
            
            const oppl1Sample = await conn.query(`
                SELECT * FROM DSEDAC.OPPL1
                WHERE EJERCICIOORDENPREPARACION = ${ejOrden}
                  AND NUMEROORDENPREPARACION = ${numOrden}
                FETCH FIRST 2 ROWS ONLY
            `);
            
            if (oppl1Sample.length > 0) {
                console.log('   ¡ENCONTRADO! Registros OPPL1:');
                oppl1Sample.forEach((row, i) => {
                    console.log(`\n   [${i+1}]:`);
                    Object.entries(row).forEach(([k, v]) => {
                        if (v !== null && v !== 0 && String(v).trim() !== '') {
                            console.log(`       ${k}: ${v}`);
                        }
                    });
                });
            } else {
                console.log(`   No hay registros en OPPL1 para orden ${ejOrden}-${numOrden}`);
            }
        }

        // 5. Contar registros OPPL1 para repartidor 79
        console.log('\n\n5. CONTAR OPPL1 PARA REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const countOppl1 = await conn.query(`
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.OPPL1
            WHERE CODIGOREPARTIDOR = '79'
              AND ANOREPARTO = 2026
        `);
        
        console.log(`   Total registros OPPL1: ${countOppl1[0]?.TOTAL}`);

        // 6. Si hay registros, ver sample con datos de albarán
        if (countOppl1[0]?.TOTAL > 0) {
            console.log('\n\n6. SAMPLE OPPL1 CON DATOS:');
            console.log('═══════════════════════════════════════════════════════════════\n');
            
            const oppl1Full = await conn.query(`
                SELECT * FROM DSEDAC.OPPL1
                WHERE CODIGOREPARTIDOR = '79' AND ANOREPARTO = 2026
                FETCH FIRST 2 ROWS ONLY
            `);
            
            oppl1Full.forEach((row, i) => {
                console.log(`   [${i+1}]:`);
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && v !== 0 && String(v).trim() !== '') {
                        console.log(`       ${k}: ${v}`);
                    }
                });
            });
        }

        await conn.close();
        
    } catch (err) {
        console.error('Error:', err.message);
        if (conn) await conn.close();
    }
}

run();
