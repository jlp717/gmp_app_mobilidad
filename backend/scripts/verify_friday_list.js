const { initDb } = require('../config/db');
const { getClientsForDay, loadLaclaeCache } = require('../services/laclae');

async function verifyList() {
    try {
        await initDb();
        console.log('🔄 Reloading Cache...');
        await loadLaclaeCache(); // Direct call ensures readiness

        console.log('📅 Fetching clients for Vendor 15 - Viernes...');
        // Simulate "viernes"
        const clients = await getClientsForDay('viernes', '15', 'comercial');

        console.log(`✅ Total Clients Returned: ${clients.length}`);

        const target = clients.find(c => c.code.includes('9046'));
        if (target) {
            console.log('✅ FOUND Client 9046 in List:', target);
        } else {
            console.log('❌ Client 9046 NOT FOUND in List');
            console.log('Sample of first 5:', clients.slice(0, 5));
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
verifyList();
