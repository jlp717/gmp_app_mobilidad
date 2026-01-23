const { query, initDb } = require('../config/db');

async function checkClient() {
    try {
        await initDb();

        const clientCode = '4300008723';
        console.log(`🔍 Checking status for client ${clientCode}...`);

        // Check CLI table for status columns
        const cli = await query(`
            SELECT *
            FROM DSEDAC.CLI
            WHERE CODIGOCLIENTE = '${clientCode}'
        `);

        if (cli.length > 0) {
            const c = cli[0];
            console.log('--- DSEDAC.CLI INFO ---');
            console.log(`Name: ${c.NOMBRECLIENTE}`);
            console.log(`AnoBaja: ${c.ANOBAJA}`); // Check if this column exists and has value
            console.log(`MarcaBaja: ${c.MARCABAJA}`); // potential column
            console.log(`Estado: ${c.ESTADO}`); // potential column
            console.log(`Full keys: ${Object.keys(c).join(', ')}`);
        } else {
            console.log('Client not found in DSEDAC.CLI');
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkClient();
