/**
 * Script para verificar qué tablas/vistas están disponibles para el Rutero
 */

const odbc = require('odbc');

async function main() {
    console.log('Verificando tablas de Rutero...\n');

    try {
        const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');
        console.log('Conexión exitosa!\n');

        // Lista de posibles tablas/vistas para rutero
        const testTables = [
            'DSED.LACLAE',
            'DSEDAC.LACLAE',
            'DSEDAC.CLI',
            'DSEDAC.CLR',  // Clientes + Rutas?
            'DSEDAC.RUT',  // Rutas
            'DSEDAC.CRU',  // Clientes-Rutas?
        ];

        for (const table of testTables) {
            try {
                const result = await conn.query(`SELECT * FROM ${table} FETCH FIRST 1 ROWS ONLY`);
                if (result.length > 0) {
                    console.log(`✅ ${table}: EXISTE`);
                    console.log(`   Columnas: ${Object.keys(result[0]).join(', ')}`);

                    // Buscar columnas relacionadas con días
                    const cols = Object.keys(result[0]);
                    const dayCols = cols.filter(c =>
                        c.includes('DIV') || c.includes('DIA') || c.includes('LUN') ||
                        c.includes('MAR') || c.includes('MIE') || c.includes('JUE') ||
                        c.includes('VIE') || c.includes('SAB') || c.includes('DOM')
                    );
                    if (dayCols.length > 0) {
                        console.log(`   🗓️ Columnas de día: ${dayCols.join(', ')}`);
                    }
                } else {
                    console.log(`✅ ${table}: EXISTE (0 filas)`);
                }
            } catch (e) {
                console.log(`❌ ${table}: ${e.message.includes('not found') ? 'NO EXISTE' : 'ERROR'}`);
            }
            console.log();
        }

        // Probar CLI con campos de visita
        console.log('=== Verificando DSEDAC.CLI para campos de día ===');
        try {
            const cli = await conn.query(`SELECT * FROM DSEDAC.CLI FETCH FIRST 1 ROWS ONLY`);
            if (cli.length > 0) {
                const cols = Object.keys(cli[0]);
                const visitCols = cols.filter(c =>
                    c.includes('VISITA') || c.includes('RUTA') || c.includes('COMERCIAL') ||
                    c.includes('VENDEDOR') || c.includes('REPARTO')
                );
                console.log('Columnas relevantes:', visitCols.join(', ') || 'ninguna');
            }
        } catch (e) {
            console.log('Error:', e.message);
        }

        await conn.close();
        console.log('\n✅ Verificación completada');

    } catch (e) {
        console.error('Error de conexión:', e.message);
    }
}

main();
