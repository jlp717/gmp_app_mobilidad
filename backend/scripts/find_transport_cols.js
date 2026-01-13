/**
 * Buscar TODAS las columnas de CAC y encontrar la del repartidor
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    try {
        const conn = await odbc.connect(DB_CONFIG);
        
        // 1. TODAS las columnas de CAC con REPARTIDOR, CONDUCTOR, VEHICULO
        console.log('1. COLUMNAS EN CAC RELACIONADAS CON TRANSPORTE:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const transCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
            AND (COLUMN_NAME LIKE '%REPARTIDOR%' 
                 OR COLUMN_NAME LIKE '%CONDUCTOR%' 
                 OR COLUMN_NAME LIKE '%VEHICULO%'
                 OR COLUMN_NAME LIKE '%TRANSPORTISTA%')
            ORDER BY COLUMN_NAME
        `);
        
        transCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Sample con SELECT * para ver valores
        console.log('\n\n2. SAMPLE VALORES DE CAMPOS TRANSPORTE:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const sample = await conn.query(`SELECT * FROM DSEDAC.CAC WHERE EJERCICIOALBARAN = 2026 FETCH FIRST 5 ROWS ONLY`);
        
        sample.forEach((doc, i) => {
            console.log(`   [${i+1}] Albaran ${doc.EJERCICIOALBARAN}-${doc.NUMEROALBARAN}:`);
            // Mostrar campos de transporte
            Object.entries(doc).forEach(([k, v]) => {
                if (k.includes('REPARTIDOR') || k.includes('CONDUCTOR') || k.includes('VEHICULO') || k.includes('TRANSPORTISTA')) {
                    console.log(`       ${k}: '${v}'`);
                }
            });
        });

        // 3. Ver todas las columnas de CAC que tengan datos
        console.log('\n\n3. COLUMNAS CAC CON DATOS (sample):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const doc = sample[0];
        let count = 0;
        Object.entries(doc).forEach(([k, v]) => {
            if (v !== null && v !== '' && String(v).trim() !== '' && count < 40) {
                console.log(`   ${k}: ${v}`);
                count++;
            }
        });

        // 4. La relación correcta podría ser VEH → CAC por CODIGOVEHICULO
        console.log('\n\n4. VERIFICAR RELACIÓN VEH → CAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Obtener vehículos de VEH
        const vehicles = await conn.query(`
            SELECT CODIGOVEHICULO, MATRICULAVEHICULO, CODIGOREPARTIDOR
            FROM DSEDAC.VEH
            WHERE CODIGOREPARTIDOR IS NOT NULL
            FETCH FIRST 10 ROWS ONLY
        `);
        
        console.log('   Vehículos con repartidor:');
        vehicles.forEach(v => {
            console.log(`   - Veh ${v.CODIGOVEHICULO} (${v.MATRICULAVEHICULO}): Repartidor ${v.CODIGOREPARTIDOR}`);
        });

        // Verificar si algún campo de CAC tiene esos códigos de vehículo
        if (vehicles.length > 0) {
            const vehCode = vehicles[0].CODIGOVEHICULO;
            console.log(`\n   Buscando vehículo '${vehCode}' en CAC...`);
            
            // Buscar en todas las columnas que tengan VEHICULO
            for (const col of transCols.filter(c => c.COLUMN_NAME.includes('VEHICULO'))) {
                const found = await conn.query(`
                    SELECT COUNT(*) as TOTAL
                    FROM DSEDAC.CAC
                    WHERE TRIM(${col.COLUMN_NAME}) = TRIM('${vehCode}')
                `);
                console.log(`   ${col.COLUMN_NAME}: ${found[0]?.TOTAL || 0} registros`);
            }
        }

        // 5. OPP es la clave - vincular OPP con albaranes
        console.log('\n\n5. OPP → CAC VINCULACIÓN:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Ver estructura de OPP
        const oppCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPP'
            AND (COLUMN_NAME LIKE '%ALBARAN%' OR COLUMN_NAME LIKE '%DOCUMENTO%' OR COLUMN_NAME LIKE '%FACTURA%')
        `);
        
        console.log('   Columnas OPP relacionadas con documentos:');
        oppCols.forEach(c => console.log(`   - ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // Ver sample OPP
        const oppSample = await conn.query(`
            SELECT * FROM DSEDAC.OPP
            WHERE CODIGOREPARTIDOR = '79' AND ANOREPARTO = 2026
            FETCH FIRST 1 ROWS ONLY
        `);
        
        if (oppSample.length > 0) {
            console.log('\n   Sample OPP para repartidor 79:');
            Object.entries(oppSample[0]).forEach(([k, v]) => {
                if (v !== null && v !== 0 && String(v).trim() !== '') {
                    console.log(`   ${k}: ${v}`);
                }
            });
        }

        await conn.close();
        
    } catch (err) {
        console.error('Error:', err.message);
    }
}

run();
