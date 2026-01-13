/**
 * Lista completa de usuarios para pruebas
 */

const odbc = require('odbc');

async function main() {
    let conn;
    try {
        console.log('Conectando a DB2...\n');
        conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

        // 1. Obtener todos los PINs
        const pins = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(CODIGOPIN) as PIN 
            FROM DSEDAC.VDPL1
        `);
        const pinMap = {};
        pins.forEach(p => { pinMap[p.COD] = p.PIN; });

        // 2. Obtener vendedores activos
        const vendedores = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(NOMBREVENDEDOR) as NOM, SITUACION
            FROM DSEDAC.VDD
            WHERE SITUACION = 'A'
            ORDER BY CODIGOVENDEDOR
        `);

        // 3. Obtener repartidores (con vehículo)
        const vehiculos = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(MATRICULA) as MAT
            FROM DSEDAC.VEH
        `);
        const vehMap = {};
        vehiculos.forEach(v => { vehMap[v.COD] = v.MAT; });

        // 4. Contar órdenes de repartidores en 2026
        const ordenes = await conn.query(`
            SELECT CODIGOREPARTIDOR as COD, COUNT(*) as TOTAL
            FROM DSEDAC.OPP
            WHERE ANOREPARTO = 2026
            GROUP BY CODIGOREPARTIDOR
        `);
        const ordenMap = {};
        ordenes.forEach(o => { ordenMap[o.COD?.trim()] = o.TOTAL; });

        // Separar comerciales y repartidores
        const comerciales = [];
        const repartidores = [];

        vendedores.forEach(v => {
            const pin = pinMap[v.COD] || '-';
            const matricula = vehMap[v.COD];
            const ordenesCount = ordenMap[v.COD] || 0;
            
            if (matricula) {
                repartidores.push({ codigo: v.COD, pin, nombre: v.NOM, matricula, ordenes: ordenesCount });
            } else {
                comerciales.push({ codigo: v.COD, pin, nombre: v.NOM });
            }
        });

        // Mostrar REPARTIDORES
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(' REPARTIDORES (con vehículo asignado) - Rol: REPARTIDOR');
        console.log('═══════════════════════════════════════════════════════════════\n');
        console.log(' COD  │ PIN    │ MATRÍCULA   │ ORD.2026 │ NOMBRE');
        console.log('──────┼────────┼─────────────┼──────────┼──────────────────────');
        repartidores.forEach(r => {
            const cod = r.codigo.padEnd(4);
            const pin = (r.pin || '-').padEnd(6);
            const mat = (r.matricula || '').padEnd(11);
            const ord = String(r.ordenes).padEnd(8);
            console.log(` ${cod} │ ${pin} │ ${mat} │ ${ord} │ ${r.nombre}`);
        });
        console.log(`\n Total repartidores: ${repartidores.length}\n`);

        // Mostrar COMERCIALES
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(' COMERCIALES (vendedores) - Rol: COMERCIAL');
        console.log('═══════════════════════════════════════════════════════════════\n');
        console.log(' COD  │ PIN    │ NOMBRE');
        console.log('──────┼────────┼─────────────────────────────────────────────');
        comerciales.slice(0, 40).forEach(c => {
            const cod = c.codigo.padEnd(4);
            const pin = (c.pin || '-').padEnd(6);
            console.log(` ${cod} │ ${pin} │ ${c.nombre}`);
        });
        if (comerciales.length > 40) {
            console.log(` ... y ${comerciales.length - 40} más`);
        }
        console.log(`\n Total comerciales: ${comerciales.length}\n`);

        // Resumen
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(' RESUMEN');
        console.log('═══════════════════════════════════════════════════════════════\n');
        console.log(` Para probar REPARTIDOR: usar código 79, PIN ${pinMap['79'] || 'ver arriba'}`);
        console.log(` Para probar COMERCIAL: usar cualquier código sin vehículo`);
        console.log('\n');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

main();
