const pedidosService = require('./services/pedidos.service');
const logger = require('./middleware/logger');

async function testPromos() {
    console.log('--- Testing getActivePromotions enriched logic ---');
    try {
        // Test without clientCode
        console.log('\n1. Fetching all promotions:');
        const allPromos = await pedidosService.getActivePromotions();
        console.log(`Found ${allPromos.length} promotions total.`);
        if (allPromos.length > 0) {
            console.log('Sample Promo:', JSON.stringify(allPromos[0], null, 2));
        }

        // Test with a specific client from our previous data (e.g., 4300009324 which had 3+1 promo)
        const testClient = '4300009324';
        console.log(`\n2. Fetching promotions for client ${testClient}:`);
        const clientPromos = await pedidosService.getActivePromotions(testClient);
        console.log(`Found ${clientPromos.length} promotions for client.`);
        if (clientPromos.length > 0) {
            console.log('First Client Promo:', JSON.stringify(clientPromos[0], null, 2));
        }

        process.exit(0);
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

testPromos();
