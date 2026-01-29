const { query, initDb } = require('../config/db');

async function checkAnobaja() {
    try {
        await initDb();
        const vendor = '33';
        const clientCodes = [
            '4300009440', '4300028033', '4300008278', '4300008255',
            '4300008509', '4300008516', '4300008517', '4300009163', '4300009699'
        ];

        console.log(`Checking ANOBAJA for ${clientCodes.length} clients...`);

        const rows = await query(`
            SELECT CODIGOCLIENTE, NOMBRECLIENTE, ANOBAJA 
            FROM DSEDAC.CLI 
            WHERE CODIGOCLIENTE IN (${clientCodes.map(c => `'${c}'`).join(',')})
        `);

        console.log('Resultados:');
        rows.forEach(r => {
            const status = (r.ANOBAJA === 0 || r.ANOBAJA === null) ? 'ACTIVE' : `BAJA (${r.ANOBAJA})`;
            console.log(`${r.CODIGOCLIENTE.trim()} - ${status} - ${r.NOMBRECLIENTE.trim()}`);
        });

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

checkAnobaja();
