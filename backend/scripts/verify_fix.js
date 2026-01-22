/**
 * Verify Fix Script
 * Loads the new Laclae Cache and checks if client 10339 appears on Friday.
 */

const { initDb, closePool } = require('../config/db');
const laclaeService = require('../services/laclae');

async function verifyFix() {
    console.log('='.repeat(60));
    console.log('VERIFYING FIX FOR CLIENT 10339');
    console.log('='.repeat(60));

    try {
        await initDb();

        // 1. Reload Cache
        console.log('\n--- 1. Loading Cache (New Logic) ---');
        await laclaeService.loadLaclaeCache();

        // 2. Check for Client 10339 directly in cache (if exposed or via getter)
        // We'll use getClientDays to inspect
        console.log('\n--- 2. Inspecting Client 10339 ---');
        const clientCode = '4300010339'; // Full code found in CDVI

        // Try precise code
        let days = laclaeService.getClientDays(null, clientCode);

        if (!days) {
            // Try short code if that's how it's stored
            days = laclaeService.getClientDays(null, '10339');
        }

        if (days) {
            console.log(`✅ Client Found!`);
            console.log(`   Visit Days: ${days.visitDays.join(', ')}`);
            console.log(`   Delivery Days: ${days.deliveryDays.join(', ')}`);
            console.log(`   Found in Vendor: ${days.foundVendor}`);

            if (days.visitDays.includes('viernes')) {
                console.log(`🎉 SUCCESS: Client is assigned to VIERNES!`);
            } else {
                console.log(`⚠️ Client found but NOT on Viernes. Days: ${days.visitDays.join(', ')}`);
            }

        } else {
            console.log('❌ Client 10339 NOT found in cache.');

            // Debug: List some vendors to see if any loaded
            const vendors = laclaeService.getVendedoresFromCache();
            console.log(`   Cache has ${vendors ? vendors.length : 0} vendors.`);
        }

        // 3. Check getClientsForDay('viernes')
        console.log('\n--- 3. Checking Scheduler for Friday ---');
        // We need the vendor code. From previous step we saw it was '33' in CDVI.
        const vendorCode = '33';
        const fridayClients = laclaeService.getClientsForDay(vendorCode, 'viernes', 'comercial');

        if (fridayClients && fridayClients.some(c => c.includes('10339'))) {
            console.log(`✅ Client appearing in Vendor ${vendorCode}'s Friday list!`);
        } else {
            console.log(`⚠️ Client NOT in Vendor ${vendorCode}'s Friday list.`);
            if (fridayClients) console.log(`   List size: ${fridayClients.length}`);
        }

    } catch (error) {
        console.error('Fatal Error:', error.message);
    } finally {
        process.exit(0);
    }
}

verifyFix();
