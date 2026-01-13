/**
 * Lista simple de usuarios para pruebas
 */

const odbc = require('odbc');

async function main() {
    let conn;
    try {
        console.log('Conectando a DB2...\n');
        conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

        // Consulta simple de vendedores con PIN
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('USUARIOS CON PIN (VDPL1 + VDD)');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const sql = `
            SELECT 
                TRIM(P.CODIGOVENDEDOR) as CODIGO,
                TRIM(P.CODIGOPIN) as PIN,
                TRIM(D.NOMBREVENDEDOR) as NOMBRE
            FROM DSEDAC.VDPL1 P
            JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
            WHERE D.SITUACION = 'A'
            ORDER BY P.CODIGOVENDEDOR
        `;

        const vendedores = await conn.query(sql);
        
        console.log(' CÓDIGO │ PIN      │ NOMBRE');
        console.log('────────┼──────────┼────────────────────────────────────────');
        vendedores.forEach(v => {
            console.log(` ${(v.CODIGO || '').padEnd(6)} │ ${(v.PIN || '').padEnd(8)} │ ${v.NOMBRE || ''}`);
        });
        console.log(`\n Total: ${vendedores.length} usuarios\n`);

        // Verificar quienes tienen vehículo (son repartidores)
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('REPARTIDORES (con vehículo asignado en VEH)');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const repartidores = await conn.query(`
            SELECT 
                TRIM(VEH.CODIGOVENDEDOR) as CODIGO,
                TRIM(P.CODIGOPIN) as PIN,
                TRIM(D.NOMBREVENDEDOR) as NOMBRE,
                TRIM(VEH.MATRICULA) as MATRICULA
            FROM DSEDAC.VEH VEH
            JOIN DSEDAC.VDPL1 P ON TRIM(P.CODIGOVENDEDOR) = TRIM(VEH.CODIGOVENDEDOR)
            JOIN DSEDAC.VDD D ON TRIM(D.CODIGOVENDEDOR) = TRIM(VEH.CODIGOVENDEDOR)
            WHERE D.SITUACION = 'A'
            ORDER BY VEH.CODIGOVENDEDOR
        `);

        console.log(' CÓDIGO │ PIN      │ MATRÍCULA   │ NOMBRE');
        console.log('────────┼──────────┼─────────────┼────────────────────────────');
        repartidores.forEach(v => {
            console.log(` ${(v.CODIGO || '').padEnd(6)} │ ${(v.PIN || '').padEnd(8)} │ ${(v.MATRICULA || '').padEnd(11)} │ ${v.NOMBRE || ''}`);
        });
        console.log(`\n Total: ${repartidores.length} repartidores\n`);

        // Verificar el 79
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('VERIFICACIÓN REPARTIDOR 79');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const rep79 = await conn.query(`
            SELECT 
                TRIM(P.CODIGOVENDEDOR) as CODIGO,
                TRIM(P.CODIGOPIN) as PIN,
                TRIM(D.NOMBREVENDEDOR) as NOMBRE
            FROM DSEDAC.VDPL1 P
            JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
            WHERE TRIM(P.CODIGOVENDEDOR) = '79'
        `);

        if (rep79.length > 0) {
            console.log(` Código: ${rep79[0].CODIGO}`);
            console.log(` PIN:    ${rep79[0].PIN}`);
            console.log(` Nombre: ${rep79[0].NOMBRE}`);
        } else {
            console.log(' El usuario 79 NO está en VDPL1');
        }

        // Órdenes del 79
        const ordenes = await conn.query(`
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.OPP
            WHERE CODIGOREPARTIDOR = '79' AND ANOREPARTO = 2026
        `);
        console.log(` Órdenes 2026: ${ordenes[0]?.TOTAL || 0}`);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

main();
