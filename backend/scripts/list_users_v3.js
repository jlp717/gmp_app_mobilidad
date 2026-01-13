/**
 * Lista de usuarios - ultra simple
 */

const odbc = require('odbc');

async function main() {
    let conn;
    try {
        console.log('Conectando a DB2...\n');
        conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

        // 1. PINs
        const pins = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(CODIGOPIN) as PIN 
            FROM DSEDAC.VDPL1
        `);
        const pinMap = {};
        pins.forEach(p => { pinMap[p.COD] = p.PIN; });

        // 2. Vendedores - sin filtro de situación
        const vendedores = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(NOMBREVENDEDOR) as NOM
            FROM DSEDAC.VDD
            FETCH FIRST 100 ROWS ONLY
        `);

        // 3. Vehículos
        const vehiculos = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(MATRICULA) as MAT
            FROM DSEDAC.VEH
        `);
        const vehMap = {};
        vehiculos.forEach(v => { vehMap[v.COD] = v.MAT; });

        // Separar
        const comerciales = [];
        const repartidores = [];

        vendedores.forEach(v => {
            const pin = pinMap[v.COD];
            if (!pin) return; // Solo los que tienen PIN
            
            const matricula = vehMap[v.COD];
            
            if (matricula) {
                repartidores.push({ codigo: v.COD, pin, nombre: v.NOM, matricula });
            } else {
                comerciales.push({ codigo: v.COD, pin, nombre: v.NOM });
            }
        });

        // Mostrar REPARTIDORES
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(' REPARTIDORES (con vehículo)');
        console.log('═══════════════════════════════════════════════════════════════\n');
        console.log(' COD  │ PIN    │ MATRÍCULA   │ NOMBRE');
        console.log('──────┼────────┼─────────────┼──────────────────────────────');
        repartidores.forEach(r => {
            console.log(` ${r.codigo.padEnd(4)} │ ${r.pin.padEnd(6)} │ ${(r.matricula || '').padEnd(11)} │ ${r.nombre}`);
        });
        console.log(`\n Total: ${repartidores.length}\n`);

        // Mostrar COMERCIALES
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(' COMERCIALES (sin vehículo)');
        console.log('═══════════════════════════════════════════════════════════════\n');
        console.log(' COD  │ PIN    │ NOMBRE');
        console.log('──────┼────────┼─────────────────────────────────────────────');
        comerciales.forEach(c => {
            console.log(` ${c.codigo.padEnd(4)} │ ${c.pin.padEnd(6)} │ ${c.nombre}`);
        });
        console.log(`\n Total: ${comerciales.length}\n`);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

main();
