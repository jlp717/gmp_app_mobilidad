/**
 * Script simplificado - Encontrar cómo vincular OPP con documentos CAC
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('    PASO 1: Obtener un registro de OPP del repartidor 79');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const opp79 = await conn.query(`
            SELECT 
                ID, EJERCICIOORDENPREPARACION, NUMEROORDENPREPARACION,
                CODIGOREPARTIDOR, CODIGOVEHICULO
            FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
            FETCH FIRST 3 ROWS ONLY
        `);
        
        opp79.forEach((r, i) => {
            console.log(`   [${i+1}] OPP.ID=${r.ID}`);
            console.log(`       EJERCICIOORDENPREPARACION=${r.EJERCICIOORDENPREPARACION}`);
            console.log(`       NUMEROORDENPREPARACION=${r.NUMEROORDENPREPARACION}`);
            console.log(`       CODIGOREPARTIDOR=${r.CODIGOREPARTIDOR}, VEHICULO=${r.CODIGOVEHICULO}\n`);
        });

        // Usar el primer registro para buscar en OPC
        if (opp79.length > 0) {
            const ej = opp79[0].EJERCICIOORDENPREPARACION;
            const num = opp79[0].NUMEROORDENPREPARACION;
            
            console.log('═══════════════════════════════════════════════════════════════');
            console.log(`    PASO 2: Buscar en OPC con Ejercicio=${ej}, Num=${num}`);
            console.log('═══════════════════════════════════════════════════════════════\n');
            
            // Columnas de OPC
            const opcCols = await conn.query(`
                SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPC'
                ORDER BY ORDINAL_POSITION
            `);
            console.log('   Columnas OPC:', opcCols.map(c => c.COLUMN_NAME).join(', '));
            
            // Buscar en OPC
            const opcRows = await conn.query(`
                SELECT * FROM DSEDAC.OPC
                WHERE EJERCICIOORDENPREPARACION = ${ej}
                  AND NUMEROORDENPREPARACION = ${num}
                FETCH FIRST 2 ROWS ONLY
            `);
            
            if (opcRows.length > 0) {
                console.log('\n   OPC encontrado:');
                Object.entries(opcRows[0]).forEach(([k, v]) => {
                    if (v !== null && String(v).trim() !== '') {
                        console.log(`       ${k}: ${v}`);
                    }
                });
            } else {
                console.log('   No se encontraron registros en OPC');
            }
        }

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('    PASO 3: Buscar columnas de CAC relacionadas con preparación');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cacPrepCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND (COLUMN_NAME LIKE '%ORDEN%' 
                   OR COLUMN_NAME LIKE '%PREP%' 
                   OR COLUMN_NAME LIKE '%REPARTO%'
                   OR COLUMN_NAME LIKE '%VEHICULO%')
            ORDER BY COLUMN_NAME
        `);
        
        console.log('   Columnas CAC relacionadas:');
        cacPrepCols.forEach(c => console.log(`       ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('    PASO 4: Verificar si CAC tiene algún campo de repartidor');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Buscar cualquier columna con "REPARTIDOR" o "TRANSPORTISTA" o "CONDUCTOR"
        const cacRepCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND (COLUMN_NAME LIKE '%REPARTIDOR%' 
                   OR COLUMN_NAME LIKE '%TRANSPORTISTA%' 
                   OR COLUMN_NAME LIKE '%CONDUCTOR%')
        `);
        
        if (cacRepCols.length > 0) {
            console.log('   ¡ENCONTRADO! Columnas en CAC:');
            cacRepCols.forEach(c => console.log(`       ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } else {
            console.log('   No hay columnas directas de repartidor en CAC');
        }

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('    PASO 5: Verificar tabla LAC (líneas de albarán)');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const lacCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'LAC'
              AND (COLUMN_NAME LIKE '%REPARTIDOR%' 
                   OR COLUMN_NAME LIKE '%TRANSPORTISTA%'
                   OR COLUMN_NAME LIKE '%ORDEN%'
                   OR COLUMN_NAME LIKE '%PREP%')
        `);
        
        console.log('   Columnas LAC relacionadas:');
        lacCols.forEach(c => console.log(`       ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('    PASO 6: Verificar columna directa en CAC');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Ver si hay repartidor 79 en algún lado de CAC
        const cacRep = await conn.query(`
            SELECT COLUMN_NAME 
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND COLUMN_NAME LIKE '%CODIGO%'
            ORDER BY COLUMN_NAME
        `);
        
        console.log('   Columnas CODIGO* en CAC:', cacRep.map(c => c.COLUMN_NAME).join(', '));

        // Verificar si hay CODIGOREPARTIDOR en CAC
        const checkRepCAC = await conn.query(`
            SELECT COUNT(*) as EXISTE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND COLUMN_NAME = 'CODIGOREPARTIDOR'
        `);
        console.log(`\n   ¿CAC tiene CODIGOREPARTIDOR? ${checkRepCAC[0].EXISTE > 0 ? 'SÍ' : 'NO'}`);

        // Verificar en LAC
        const checkRepLAC = await conn.query(`
            SELECT COUNT(*) as EXISTE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'LAC'
              AND COLUMN_NAME = 'CODIGOREPARTIDOR'
        `);
        console.log(`   ¿LAC tiene CODIGOREPARTIDOR? ${checkRepLAC[0].EXISTE > 0 ? 'SÍ' : 'NO'}`);

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('    PASO 7: Si OPC existe, verificar relación con documentos');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Verificar columnas clave de OPC
        const opcKeyCols = await conn.query(`
            SELECT COLUMN_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'OPC'
              AND (COLUMN_NAME LIKE '%DOCUMENTO%' OR COLUMN_NAME LIKE '%NUM%' OR COLUMN_NAME LIKE '%SERIE%')
            ORDER BY COLUMN_NAME
        `);
        
        console.log('   Columnas documento en OPC:', opcKeyCols.map(c => c.COLUMN_NAME).join(', '));
        
    } finally {
        await conn.close();
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
