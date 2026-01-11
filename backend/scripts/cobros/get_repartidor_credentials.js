/**
 * Script para obtener credenciales de repartidores
 * Cruza DSEDAC.VEH (repartidores) con DSEDAC.VDD (PIN/Contraseña)
 */
const { odbcPool, dbConfig } = require('../../src/config/database');

async function obtenerCredenciales() {
    try {
        console.log('Conectando a BD DB2...');
        await odbcPool.open(dbConfig.connectionString);

        console.log('Buscando repartidores y sus credenciales...');

        /*
         * Query:
         * 1. Buscar en VEH todos los Vendedores que tienen vehículo (repartidores)
         * 2. Cruzar con VDD para obtener Nombre y Contraseña (PIN)
         */
        const query = `
            SELECT 
                TRIM(VEH.CODIGOVENDEDOR) as CODIGO,
                TRIM(VEH.MATRICULA) as MATRICULA,
                TRIM(VEH.DESCRIPCIONVEHICULO) as VEHICULO,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                TRIM(VDD.CONTRASENA) as PIN,
                TRIM(VDD.TELEFONO) as TELEFONO
            FROM DSEDAC.VEH
            JOIN DSEDAC.VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(VEH.CODIGOVENDEDOR)
            WHERE VEH.CODIGOVENDEDOR IS NOT NULL 
              AND TRIM(VEH.CODIGOVENDEDOR) <> ''
            ORDER BY VEH.CODIGOVENDEDOR
        `;

        const resultados = await odbcPool.query(query);

        console.log('\n=== CREDENCIALES DE REPARTIDORES ===');
        console.log('CODIGO | PIN  | NOMBRE                         | VEHICULO');
        console.log('-------|------|--------------------------------|-------------------------');

        resultados.forEach(r => {
            const codigo = String(r.CODIGO).padEnd(6);
            const pin = String(r.PIN || '????').padEnd(4);
            const nombre = String(r.NOMBRE).substring(0, 30).padEnd(30);
            const vehiculo = String(r.VEHICULO).substring(0, 23);

            console.log(`${codigo} | ${pin} | ${nombre} | ${vehiculo}`);
        });

        console.log('\nTotal encontrados:', resultados.length);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await odbcPool.close();
        process.exit();
    }
}

obtenerCredenciales();
