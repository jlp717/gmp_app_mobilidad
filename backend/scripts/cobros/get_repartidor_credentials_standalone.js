/**
 * Script standalone para obtener credenciales de repartidores
 * PIN = últimos 4 dígitos del NIF/DNI
 */
const odbc = require('odbc');
const path = require('path');
const dotenv = require('dotenv');

// Cargar .env desde backend/.env
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

async function obtenerCredenciales() {
    let connection;
    try {
        const uid = process.env.ODBC_UID;
        const pwd = process.env.ODBC_PWD;

        if (!uid || !pwd) {
            console.error('Error: ODBC_UID o ODBC_PWD no definidos en .env');
            process.exit(1);
        }

        const connectionString = `DSN=GMP;UID=${uid};PWD=${pwd};NAM=1;`;
        console.log('Conectando a DB2 (DSN=GMP)...');
        connection = await odbc.connect(connectionString);

        console.log('Buscando repartidores...');

        // Buscar códigos en VEH y sus datos en VDD
        const query = `
            SELECT 
                TRIM(VEH.CODIGOVENDEDOR) as CODIGO,
                TRIM(VEH.MATRICULA) as MATRICULA,
                TRIM(VEH.DESCRIPCIONVEHICULO) as VEHICULO,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                TRIM(VDD.NIF) as NIF,
                TRIM(VDD.TELEFONO1) as TELEFONO
            FROM DSEDAC.VEH
            JOIN DSEDAC.VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(VEH.CODIGOVENDEDOR)
            WHERE VEH.CODIGOVENDEDOR IS NOT NULL 
              AND TRIM(VEH.CODIGOVENDEDOR) <> ''
            ORDER BY VEH.CODIGOVENDEDOR
        `;

        const resultados = await connection.query(query);

        console.log('\n=== CREDENCIALES DE REPARTIDORES ===');
        console.log('CODIGO | PIN  | NOMBRE                         | VEHICULO');
        console.log('-------|------|--------------------------------|-------------------------');

        let count = 0;
        resultados.forEach(r => {
            const codigo = String(r.CODIGO).padEnd(6);

            // Lógica PIN: 4 dígitos antes de la letra final del NIF
            // NIF ejemplo: 23270397D -> 0397
            let pin = '????';
            const nif = String(r.NIF || '').trim();

            if (nif.length >= 5) {
                // Si termina en letra, quitarla y coger 4 ultimos
                const match = nif.match(/(\d{4})[A-Z]?$/);
                if (match) {
                    pin = match[1];
                } else {
                    pin = nif.substring(nif.length - 4);
                }
            }

            const pinStr = pin.padEnd(4);
            const nombre = String(r.NOMBRE).substring(0, 30).padEnd(30);
            const vehiculo = String(r.VEHICULO).substring(0, 23);

            console.log(`${codigo} | ${pinStr} | ${nombre} | ${vehiculo}`);
            count++;
        });

        console.log('\nTotal encontrados:', count);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) { }
        }
        process.exit();
    }
}

obtenerCredenciales();
