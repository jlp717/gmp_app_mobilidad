/**
 * Lista simple de vendedores para pruebas
 */

const odbc = require('odbc');

async function main() {
    let conn;
    try {
        conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;TRANSLATE=1');
        console.log('Conectado a DB2\n');

        // Ver estructura VDD
        const vddCols = await conn.query(`
            SELECT COLUMN_NAME
            FROM SYSIBM.COLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VDD'
            ORDER BY ORDINAL_POSITION
        `);
        console.log('Columnas VDD:', vddCols.map(c => c.COLUMN_NAME).join(', '));

        // Consulta simple de vendedores
        console.log('\n\nVENDEDORES ACTIVOS:');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const vendedores = await conn.query(`
            SELECT *
            FROM DSEDAC.VDD
            WHERE SITUACION = 'A'
            ORDER BY CODIGOVENDEDOR
            FETCH FIRST 30 ROWS ONLY
        `);
        
        // Mostrar primeros 3 con todas sus columnas para ver estructura
        if (vendedores.length > 0) {
            console.log('Ejemplo de registro completo:');
            const sample = vendedores[0];
            Object.keys(sample).forEach(k => {
                if (sample[k] !== null && sample[k] !== '' && sample[k] !== 0) {
                    console.log(`   ${k}: ${sample[k]}`);
                }
            });
        }

        console.log('\n\nTABLA DE VENDEDORES:');
        console.log('───────────────────────────────────────────────────────────────');
        
        vendedores.forEach(v => {
            const codigo = String(v.CODIGOVENDEDOR || '').trim();
            const nombre = String(v.NOMBREVENDEDOR || '').trim();
            // Buscar cualquier campo que parezca clave/pin
            const clave = v.CLAVE || v.CLAVEAPP || v.PIN || v.PASSWORD || '-';
            console.log(`${codigo.padEnd(4)} | ${String(clave).trim().padEnd(8)} | ${nombre}`);
        });

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    } finally {
        if (conn) await conn.close();
    }
}

main();
