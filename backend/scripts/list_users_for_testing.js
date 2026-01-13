/**
 * Lista de vendedores/repartidores para pruebas
 * Conexión directa a DB2
 */

const odbc = require('odbc');

async function main() {
    let conn;
    try {
        console.log('Conectando a DB2...\n');
        conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

        // VENDEDORES con PIN (desde VDPL1)
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('VENDEDORES/REPARTIDORES CON CREDENCIALES');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const sql = `
            SELECT 
                TRIM(P.CODIGOVENDEDOR) as CODIGO,
                TRIM(P.CODIGOPIN) as PIN,
                TRIM(D.NOMBREVENDEDOR) as NOMBRE,
                TRIM(COALESCE(V.TIPOVENDEDOR, '')) as TIPO,
                CASE WHEN VEH.CODIGOVEHICULO IS NOT NULL THEN 'REPARTIDOR' ELSE 'COMERCIAL' END as ROL
            FROM DSEDAC.VDPL1 P
            JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
            LEFT JOIN DSEDAC.VDC V ON P.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND V.SUBEMPRESA = 'GMP'
            LEFT JOIN DSEDAC.VEH VEH ON TRIM(VEH.CODIGOVENDEDOR) = TRIM(P.CODIGOVENDEDOR)
            WHERE D.SITUACION = 'A'
            ORDER BY P.CODIGOVENDEDOR
        `;

        const vendedores = await conn.query(sql);

        // Separar por rol
        const comerciales = vendedores.filter(v => v.ROL === 'COMERCIAL');
        const repartidores = vendedores.filter(v => v.ROL === 'REPARTIDOR');

        console.log('──────────────────────────────────────────────────────────────');
        console.log(' REPARTIDORES (con vehículo asignado)');
        console.log('──────────────────────────────────────────────────────────────');
        console.log(' CÓDIGO │ PIN      │ NOMBRE');
        console.log('────────┼──────────┼─────────────────────────────────────────');
        repartidores.forEach(v => {
            console.log(` ${v.CODIGO.padEnd(6)} │ ${v.PIN.padEnd(8)} │ ${v.NOMBRE}`);
        });
        console.log(`\n Total: ${repartidores.length} repartidores\n`);

        console.log('──────────────────────────────────────────────────────────────');
        console.log(' COMERCIALES (vendedores sin vehículo)');
        console.log('──────────────────────────────────────────────────────────────');
        console.log(' CÓDIGO │ PIN      │ NOMBRE');
        console.log('────────┼──────────┼─────────────────────────────────────────');
        comerciales.slice(0, 30).forEach(v => {
            console.log(` ${v.CODIGO.padEnd(6)} │ ${v.PIN.padEnd(8)} │ ${v.NOMBRE}`);
        });
        if (comerciales.length > 30) {
            console.log(` ... y ${comerciales.length - 30} más`);
        }
        console.log(`\n Total: ${comerciales.length} comerciales\n`);

        // Verificar actividad del repartidor 79
        console.log('──────────────────────────────────────────────────────────────');
        console.log(' VERIFICACIÓN REPARTIDOR 79');
        console.log('──────────────────────────────────────────────────────────────');
        
        const rep79 = await conn.query(`
            SELECT 
                TRIM(P.CODIGOVENDEDOR) as CODIGO,
                TRIM(P.CODIGOPIN) as PIN,
                TRIM(D.NOMBREVENDEDOR) as NOMBRE,
                TRIM(VEH.MATRICULA) as MATRICULA
            FROM DSEDAC.VDPL1 P
            JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
            LEFT JOIN DSEDAC.VEH VEH ON TRIM(VEH.CODIGOVENDEDOR) = TRIM(P.CODIGOVENDEDOR)
            WHERE TRIM(P.CODIGOVENDEDOR) = '79'
        `);

        if (rep79.length > 0) {
            console.log(`\n Código:    ${rep79[0].CODIGO}`);
            console.log(` PIN:       ${rep79[0].PIN}`);
            console.log(` Nombre:    ${rep79[0].NOMBRE}`);
            console.log(` Matrícula: ${rep79[0].MATRICULA || 'N/A'}`);
        }

        // Órdenes del 79 en 2026
        const ordenes79 = await conn.query(`
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79' AND ANOREPARTO = 2026
        `);
        console.log(` Órdenes 2026: ${ordenes79[0]?.TOTAL || 0}\n`);

        console.log('═══════════════════════════════════════════════════════════════');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
        process.exit(0);
    }
}

main();
