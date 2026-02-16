const { query, initDb } = require('../config/db');

async function checkClient() {
    try {
        await initDb();
        const client = '4300005862';
        console.log(`🔍 Checking Client ${client}...`);

        // Check CLI
        const cli = await query(`
            SELECT CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGORUTA, ANOBAJA
            FROM DSEDAC.CLI
            WHERE CODIGOCLIENTE = '${client}'
        `);
        if (cli.length > 0) {
            console.log('CLI Data:', cli[0]);
        } else {
            console.log('Not found in CLI');
        }

        // Check CDVI
        const cdvi = await query(`
            SELECT * FROM DSEDAC.CDVI WHERE CODIGOCLIENTE = '${client}'
        `);
        console.log('CDVI Entries:', cdvi.length);
        cdvi.forEach(r => console.log(`- CDVI Vendor: ${r.CODIGOVENDEDOR}`));

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkClient();
