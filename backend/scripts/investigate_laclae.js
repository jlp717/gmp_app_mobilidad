/**
 * Script simplificado para investigar cliente 10339
 */

const { query, initDb } = require('../config/db');

async function investigate() {
    console.log('='.repeat(60));
    console.log('INVESTIGACIÓN CLIENTE 10339');
    console.log('='.repeat(60));

    try {
        await initDb();

        // 1. Buscar en CLI
        console.log('\n1. CLIENTE EN DSEDAC.CLI');
        try {
            const cli = await query(`
                SELECT * FROM DSEDAC.CLI 
                WHERE CODIGOCLIENTE LIKE '%10339'
                FETCH FIRST 1 ROW ONLY
            `);
            if (cli.length > 0) {
                const cols = Object.keys(cli[0]);
                console.log('   Encontrado. Columnas:', cols.length);
                console.log('   CODIGOCLIENTE:', cli[0].CODIGOCLIENTE);
                console.log('   NOMBRECLIENTE:', cli[0].NOMBRECLIENTE);
                console.log('   CODIGOVENDEDOR:', cli[0].CODIGOVENDEDOR);
            } else {
                console.log('   NO encontrado');
            }
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // 2. Buscar en LACLAE
        console.log('\n2. CLIENTE EN DSED.LACLAE');
        try {
            const lac = await query(`
                SELECT * FROM DSED.LACLAE 
                WHERE LCCDCL LIKE '%10339'
                FETCH FIRST 1 ROW ONLY
            `);
            if (lac.length > 0) {
                console.log('   Encontrado en LACLAE');
                const cols = Object.keys(lac[0]);
                const r1Cols = cols.filter(c => c.startsWith('R1_T8'));
                console.log('   Columnas R1_T8*:', r1Cols.join(', '));
                r1Cols.forEach(c => {
                    if (lac[0][c]) console.log(`   ${c} = ${lac[0][c]}`);
                });
            } else {
                console.log('   NO encontrado en LACLAE (sin ventas)');
            }
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // 3. Ver estructura de LACLAE
        console.log('\n3. ESTRUCTURA DE LACLAE (columnas R1_T8*)');
        try {
            const sample = await query(`
                SELECT * FROM DSED.LACLAE FETCH FIRST 1 ROW ONLY
            `);
            if (sample.length > 0) {
                const cols = Object.keys(sample[0]);
                const r1Cols = cols.filter(c => c.startsWith('R1_T8'));
                console.log('   Columnas relacionadas con rutero:');
                r1Cols.forEach(c => console.log(`   - ${c}`));
            }
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // 4. Buscar tabla T8 directamente
        console.log('\n4. BUSCAR TABLA T8 (origen de días de visita)');
        try {
            const t8 = await query(`
                SELECT * FROM DSED.T8 
                WHERE T8CDCL LIKE '%10339'
                FETCH FIRST 1 ROW ONLY
            `);
            if (t8.length > 0) {
                console.log('   Encontrado en DSED.T8');
                Object.keys(t8[0]).forEach(c => {
                    if (t8[0][c]) console.log(`   ${c} = ${t8[0][c]}`);
                });
            } else {
                console.log('   NO encontrado o tabla T8 vacía');
            }
        } catch (e) {
            console.log('   DSED.T8: ' + e.message);
        }

        // 5. Probar DSEDAC.T8
        try {
            const t8b = await query(`
                SELECT * FROM DSEDAC.T8 
                WHERE T8CDCL LIKE '%10339'
                FETCH FIRST 1 ROW ONLY
            `);
            if (t8b.length > 0) {
                console.log('   Encontrado en DSEDAC.T8');
                Object.keys(t8b[0]).forEach(c => {
                    if (t8b[0][c] && (c.includes('DIV') || c.includes('DIR'))) {
                        console.log(`   ${c} = ${t8b[0][c]}`);
                    }
                });
            }
        } catch (e) {
            console.log('   DSEDAC.T8: ' + e.message);
        }

        console.log('\n' + '='.repeat(60));
        console.log('CONCLUSIÓN');
        console.log('='.repeat(60));
        console.log(`
Si el cliente NO aparece en LACLAE, es porque no tiene ventas.
Los campos R1_T8* vienen de un JOIN con la tabla T8.
Para que aparezca en el rutero, debemos:
1. Consultar la tabla T8 directamente, o
2. Usar CLICAB si tiene los dias de visita ahí
        `);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        process.exit(0);
    }
}

investigate();
