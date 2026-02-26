const fs = require('fs');
const { query } = require('./config/db');

async function investigateDb() {
    let out = '';
    try {
        const vehQuery = await query(`
      SELECT CODIGOVEHICULO, DESCRIPCIONVEHICULO, CARGAMAXIMA, TARA, VOLUMEN, CONTENEDORVOLUMEN
      FROM DSEDAC.VEH
      WHERE CODIGOVEHICULO IN ('02', '04', '05', '06')
    `);
        out += '\n--- VEHICLES FROM DSEDAC.VEH ---\n' + JSON.stringify(vehQuery, null, 2);

        const configQuery = await query(`
      SELECT * FROM JAVIER.ALMACEN_CAMIONES_CONFIG
      WHERE CODIGOVEHICULO IN ('02', '04', '05', '06')
    `);
        out += '\n\n--- CAMIONES CONFIG FROM JAVIER.ALMACEN_CAMIONES_CONFIG ---\n' + JSON.stringify(configQuery, null, 2);

        fs.writeFileSync('db_out.txt', out);
        console.log('Done writing to db_out.txt');
        process.exit(0);
    } catch (err) {
        console.error('DB ERROR:', err);
        process.exit(1);
    }
}
setTimeout(investigateDb, 1000);
