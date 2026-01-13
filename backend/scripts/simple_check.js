/**
 * Script simplificado - Buscar datos del repartidor paso a paso
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        // 1. Ver un documento cualquiera de 2026 con todos los campos de conductor/vehiculo
        console.log('1. SAMPLE DOCUMENTO 2026 - CAMPOS CONDUCTOR/VEHICULO:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const sample = await conn.query(`
            SELECT 
                EJERCICIO, NUMDOCUMENTO,
                CODIGOCONDUCTOR,
                CODIGOVENDEDORCONDUCTOR,
                CODIGOVEHICULO
            FROM DSEDAC.CAC
            WHERE EJERCICIO = 2026
            FETCH FIRST 10 ROWS ONLY
        `);
        
        sample.forEach((r, i) => {
            console.log(`   [${i+1}] Doc ${r.EJERCICIO}-${r.NUMDOCUMENTO}`);
            console.log(`       CODIGOCONDUCTOR: '${r.CODIGOCONDUCTOR}'`);
            console.log(`       CODIGOVENDEDORCONDUCTOR: '${r.CODIGOVENDEDORCONDUCTOR}'`);
            console.log(`       CODIGOVEHICULO: '${r.CODIGOVEHICULO}'`);
        });

        // 2. Ver documentos donde algún campo tenga '79'
        console.log('\n\n2. DOCUMENTOS CON "79" EN CAMPOS CONDUCTOR:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Buscar en CODIGOVENDEDORCONDUCTOR (que es CHAR(2) como el código de vendedor/repartidor)
        const docs79 = await conn.query(`
            SELECT 
                EJERCICIO, NUMDOCUMENTO,
                TRIM(CODIGOCLIENTE) as CLIENTE,
                CODIGOVENDEDORCONDUCTOR,
                IMPORTETOTALDOCUMENTO / 100.0 as TOTAL
            FROM DSEDAC.CAC
            WHERE CODIGOVENDEDORCONDUCTOR = '79'
              AND EJERCICIO = 2026
            FETCH FIRST 10 ROWS ONLY
        `);
        
        if (docs79.length > 0) {
            console.log('   ¡ENCONTRADO! Documentos con CODIGOVENDEDORCONDUCTOR = 79:');
            docs79.forEach((r, i) => {
                console.log(`   [${i+1}] ${r.EJERCICIO}-${r.NUMDOCUMENTO}, Cliente: ${r.CLIENTE}, Total: ${r.TOTAL}€`);
            });
            
            // Contar total
            const count79 = await conn.query(`
                SELECT COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE CODIGOVENDEDORCONDUCTOR = '79'
                  AND EJERCICIO = 2026
            `);
            console.log(`\n   Total documentos en 2026: ${count79[0]?.TOTAL || 0}`);
        } else {
            console.log('   No hay documentos con CODIGOVENDEDORCONDUCTOR = 79');
        }

        // 3. Ver qué valores hay en CODIGOVENDEDORCONDUCTOR
        console.log('\n\n3. VALORES ÚNICOS EN CODIGOVENDEDORCONDUCTOR (2026):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const valsCond = await conn.query(`
            SELECT 
                CODIGOVENDEDORCONDUCTOR as COND,
                COUNT(*) as TOTAL
            FROM DSEDAC.CAC
            WHERE EJERCICIO = 2026
            GROUP BY CODIGOVENDEDORCONDUCTOR
            ORDER BY TOTAL DESC
            FETCH FIRST 20 ROWS ONLY
        `);
        
        console.log('   CONDUCTOR │ TOTAL');
        console.log('   ──────────┼───────');
        valsCond.forEach(v => {
            const cond = v.COND === null ? '(null)' : `'${v.COND}'`;
            console.log(`   ${cond.padEnd(9)} │ ${v.TOTAL}`);
        });

        // 4. Información del usuario 79 en VDD
        console.log('\n\n4. INFORMACIÓN DEL USUARIO 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const vdd79 = await conn.query(`
            SELECT 
                CODIGOVENDEDOR,
                NOMBREVENDEDOR
            FROM DSEDAC.VDD
            WHERE CODIGOVENDEDOR = '79'
        `);
        
        if (vdd79.length > 0) {
            console.log(`   Código: ${vdd79[0].CODIGOVENDEDOR}`);
            console.log(`   Nombre: ${vdd79[0].NOMBREVENDEDOR}`);
        }

        // 5. Verificar si hay vehículo para 79 en VEH
        console.log('\n\n5. VEHÍCULO ASIGNADO A 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const veh79 = await conn.query(`
            SELECT * FROM DSEDAC.VEH
            WHERE CODIGOREPARTIDOR = '79'
        `);
        
        if (veh79.length > 0) {
            Object.entries(veh79[0]).forEach(([k, v]) => {
                if (v !== null && (typeof v !== 'string' || v.trim() !== '')) {
                    console.log(`   ${k}: ${v}`);
                }
            });
        } else {
            console.log('   No hay vehículo asignado a 79 en VEH');
        }

        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
