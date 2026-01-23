const { query, initDb } = require('../config/db');

async function checkOwner() {
    try {
        await initDb();
        const client = '4300003760';
        console.log(`🔍 Checking OWNER for client ${client}...`);

        // Check CDVI
        const cdvi = await query(`
            SELECT CODIGOVENDEDOR 
            FROM DSEDAC.CDVI 
            WHERE CODIGOCLIENTE = '${client}'
        `);
        console.log('CDVI Owners:', cdvi.map(r => r.CODIGOVENDEDOR).join(', '));

        // Check CLI
        const cli = await query(`
            SELECT CODIGOVENDEDOR, NOMBRECLIENTE 
            FROM DSEDAC.CLI 
            WHERE CODIGOCLIENTE = '${client}'
        `);
        console.log('CLI Owner:', cli.length > 0 ? `${cli[0].CODIGOVENDEDOR} (${cli[0].NOMBRECLIENTE})` : 'Not Found');

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkOwner();
