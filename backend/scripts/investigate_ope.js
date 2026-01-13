/**
 * Investigar tabla OPE que podría tener la vinculación con albaranes
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    try {
        const conn = await odbc.connect(DB_CONFIG);
        
        // 1. Estructura OPE
        console.log('1. ESTRUCTURA DE OPE:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const opeCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPE'
            ORDER BY ORDINAL_POSITION
        `);
        
        opeCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Sample OPE
        console.log('\n\n2. SAMPLE OPE:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const opeSample = await conn.query(`SELECT * FROM DSEDAC.OPE FETCH FIRST 2 ROWS ONLY`);
        
        if (opeSample.length > 0) {
            opeSample.forEach((row, i) => {
                console.log(`   [${i+1}]:`);
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && v !== 0 && String(v).trim() !== '') {
                        console.log(`       ${k}: ${v}`);
                    }
                });
            });
        }

        // 3. Buscar OPE con la orden del repartidor 79
        console.log('\n\n3. BUSCAR OPE CON ORDEN 1732 (del repartidor 79):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const ope1732 = await conn.query(`
            SELECT * FROM DSEDAC.OPE
            WHERE NUMEROORDENPREPARACION = 1732
              AND EJERCICIOORDENPREPARACION = 2026
            FETCH FIRST 5 ROWS ONLY
        `);
        
        if (ope1732.length > 0) {
            console.log('   ¡ENCONTRADO!');
            ope1732.forEach((row, i) => {
                console.log(`   [${i+1}]:`);
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && v !== 0 && String(v).trim() !== '') {
                        console.log(`       ${k}: ${v}`);
                    }
                });
            });
        } else {
            console.log('   No se encontró');
        }

        // 4. Estructura OPER
        console.log('\n\n4. ESTRUCTURA DE OPER:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const operCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPER'
            ORDER BY ORDINAL_POSITION
        `);
        
        operCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 5. Buscar OPER para orden 1732
        console.log('\n\n5. BUSCAR OPER CON ORDEN 1732:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oper1732 = await conn.query(`
            SELECT * FROM DSEDAC.OPER
            WHERE NUMEROORDENPREPARACION = 1732
            FETCH FIRST 5 ROWS ONLY
        `);
        
        if (oper1732.length > 0) {
            console.log('   ¡ENCONTRADO!');
            oper1732.forEach((row, i) => {
                console.log(`   [${i+1}]:`);
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && v !== 0 && String(v).trim() !== '') {
                        console.log(`       ${k}: ${v}`);
                    }
                });
            });
        } else {
            console.log('   No se encontró');
        }

        // 6. Contar registros OPE para repartidor 79 (vía OPP)
        console.log('\n\n6. CONTAR REGISTROS OPE PARA ÓRDENES DEL REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const countOpe = await conn.query(`
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.OPE OPE
            INNER JOIN DSEDAC.OPP OPP 
                ON OPE.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                AND OPE.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE OPP.CODIGOREPARTIDOR = '79'
              AND OPP.ANOREPARTO = 2026
        `);
        
        console.log(`   Total líneas OPE: ${countOpe[0]?.TOTAL}`);

        await conn.close();
        
    } catch (err) {
        console.error('Error:', err.message);
    }
}

run();
