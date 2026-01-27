const { initDb } = require('../config/db');
const { getClientsForDay, loadLaclaeCache } = require('../services/laclae');

async function verifyList() {
    try {
        await initDb();
        console.log('🔄 Reloading Cache...');
        await loadLaclaeCache();

        console.log('📅 Fetching clients for Vendor 15 - Viernes...');
        // Correct order: (vendedorCodes, day, role)
        const clients = await getClientsForDay('15', 'viernes', 'comercial');

        console.log(`✅ Total Clients Returned: ${clients.length}`);

        // Log found status specifically for our targets
        ['9046', '10334', '10203'].forEach(code => {
            const found = clients.find(c => String(c).includes(code));
            if (found) console.log(`✅ FOUND ${code} in List`);
            else console.log(`❌ ${code} NOT FOUND in List`);
        });

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
verifyList();
