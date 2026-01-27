const { initDb, query } = require('../config/db');
const { getClientsForDay, loadLaclaeCache } = require('../services/laclae');

async function listClients() {
    try {
        await initDb();
        console.log('🔄 Reloading Cache...');
        await loadLaclaeCache();

        console.log('📅 Fetching clients for Vendor 15 - Viernes...');
        // Correct order: 15, viernes
        const clientCodes = await getClientsForDay('15', 'viernes', 'comercial');

        console.log(`✅ Total Clients: ${clientCodes.length}`);

        if (clientCodes.length > 0) {
            const codesStr = clientCodes.map(c => `'${c}'`).join(',');
            const names = await query(`
                SELECT CODIGOCLIENTE, NOMBRECLIENTE, NOMBREALTERNATIVO 
                FROM DSEDAC.CLI 
                WHERE CODIGOCLIENTE IN (${codesStr})
            `);

            console.log('📋 CLIENT LIST:');
            names.forEach(n => {
                const name = n.NOMBREALTERNATIVO && n.NOMBREALTERNATIVO.trim() ? n.NOMBREALTERNATIVO : n.NOMBRECLIENTE;
                console.log(`- [${n.CODIGOCLIENTE}] ${name.trim()}`);
            });
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
listClients();
