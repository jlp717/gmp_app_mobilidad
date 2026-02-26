const { query } = require('./config/db');

async function testContenedores() {
    try {
        const vehs = await query(`
      SELECT CODIGOVEHICULO, DESCRIPCIONVEHICULO, CARGAMAXIMA, CONTENEDORVOLUMEN, NUMEROCONTENEDORES, NUMEROSACOS
      FROM DSEDAC.VEH
      WHERE CODIGOVEHICULO IN ('02', '04', '05', '06', '16', '78', '86')
    `);
        console.log(JSON.stringify(vehs, null, 2));
        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}
setTimeout(testContenedores, 1000);
