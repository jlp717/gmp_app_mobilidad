const { query } = require('./config/db');

async function investigateDb() {
    try {
        console.log('--- TABLES WITH CAMION OR VEH IN NAME ---');
        const tableQuery = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME 
      FROM QSYS2.SYSTABLES 
      WHERE TABLE_NAME LIKE '%CAMION%' OR TABLE_NAME LIKE '%VEH'
    `);
        console.log(tableQuery);

        console.log('\n--- VEHICLES FROM DSEDAC.VEH ---');
        const vehQuery = await query(`
      SELECT CODIGOVEHICULO, DESCRIPCIONVEHICULO, MATRICULA, CARGAMAXIMA, TARA, VOLUMEN, CONTENEDORVOLUMEN
      FROM DSEDAC.VEH
      WHERE CODIGOVEHICULO IN ('02', '04', '05', '06')
    `);
        console.log(vehQuery);

        console.log('\n--- CAMIONES CONFIG FROM JAVIER.ALMACEN_CAMIONES_CONFIG ---');
        const configQuery = await query(`
      SELECT * FROM JAVIER.ALMACEN_CAMIONES_CONFIG
      WHERE CODIGOVEHICULO IN ('02', '04', '05', '06')
    `);
        console.log(configQuery);

        console.log('\n--- ARTICULOS DSED ---');
        const artQuery = await query(`
      SELECT CODIGOARTICULO, DESCRIPCIONARTICULO 
      FROM DSEDAC.ART 
      WHERE DESCRIPCIONARTICULO LIKE '%TEST%' OR DESCRIPCIONARTICULO LIKE '%PRUEBA%' OR DESCRIPCIONARTICULO LIKE '%ESTIMADO%' OR DESCRIPCIONARTICULO LIKE '%CT CT%'
      LIMIT 10
    `);
        console.log(artQuery);

        process.exit(0);
    } catch (err) {
        console.error('DB ERROR:', err);
        process.exit(1);
    }
}
setTimeout(investigateDb, 1000); // 1s to allow connection
