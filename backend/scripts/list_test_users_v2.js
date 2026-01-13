/**
 * Lista de usuarios - queries separadas
 */

const odbc = require('odbc');

async function main() {
    let conn;
    try {
        console.log('Conectando a DB2...\n');
        conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

        // 1. Obtener PINs
        console.log('Obteniendo PINs...');
        const pins = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(CODIGOPIN) as PIN 
            FROM DSEDAC.VDPL1
        `);
        const pinMap = {};
        pins.forEach(p => { pinMap[p.COD] = p.PIN; });
        console.log(`  ${pins.length} PINs encontrados`);

        // 2. Obtener vendedores
        console.log('Obteniendo vendedores...');
        const vendedores = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(NOMBREVENDEDOR) as NOM
            FROM DSEDAC.VDD
            WHERE SITUACION = 'A'
            ORDER BY CODIGOVENDEDOR
        `);
        console.log(`  ${vendedores.length} vendedores activos`);

        // 3. Obtener vehículos
        console.log('Obteniendo vehículos...');
        const vehiculos = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(MATRICULA) as MAT
            FROM DSEDAC.VEH
        `);
        const vehMap = {};
        vehiculos.forEach(v => { vehMap[v.COD] = v.MAT; });
        console.log(`  ${vehiculos.length} vehículos`);

        // Separar
        const comerciales = [];
        const repartidores = [];

        vendedores.forEach(v => {
            const pin = pinMap[v.COD] || '-';
            const matricula = vehMap[v.COD];
            
            if (matricula) {
                repartidores.push({ codigo: v.COD, pin, nombre: v.NOM, matricula });
            } else if (pin !== '-') {
                comerciales.push({ codigo: v.COD, pin, nombre: v.NOM });
            }
        });

        // Mostrar REPARTIDORES
        console.log('\n');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(' REPARTIDORES (con vehículo) - Para probar rol REPARTIDOR');
        console.log('═══════════════════════════════════════════════════════════════\n');
        console.log(' COD  │ PIN    │ MATRÍCULA   │ NOMBRE');
        console.log('──────┼────────┼─────────────┼──────────────────────────────');
        repartidores.forEach(r => {
            const cod = r.codigo.padEnd(4);
            const pin = (r.pin || '-').padEnd(6);
            const mat = (r.matricula || '').padEnd(11);
            console.log(` ${cod} │ ${pin} │ ${mat} │ ${r.nombre}`);
        });
        console.log(`\n Total: ${repartidores.length} repartidores\n`);

        // Mostrar COMERCIALES
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(' COMERCIALES (sin vehículo) - Para probar rol COMERCIAL');
        console.log('═══════════════════════════════════════════════════════════════\n');
        console.log(' COD  │ PIN    │ NOMBRE');
        console.log('──────┼────────┼─────────────────────────────────────────────');
        comerciales.slice(0, 30).forEach(c => {
            const cod = c.codigo.padEnd(4);
            const pin = (c.pin || '-').padEnd(6);
            console.log(` ${cod} │ ${pin} │ ${c.nombre}`);
        });
        if (comerciales.length > 30) {
            console.log(` ... y ${comerciales.length - 30} más`);
        }
        console.log(`\n Total: ${comerciales.length} comerciales\n`);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

main();
