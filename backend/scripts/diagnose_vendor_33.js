const { query, initDb } = require('../config/db');
const { loadLaclaeCache, getClientsForDay, getWeekCountsFromCache } = require('../services/laclae');

async function diagnose() {
    try {
        await initDb();
        console.log('🔧 Loading cache...');
        await loadLaclaeCache();

        const vendor = '33';
        const day = 'sabado';

        console.log(`\n📊 DIAGNOSTIC: Vendor ${vendor} - ${day}`);
        console.log('='.repeat(50));

        // 1. Get week counts
        const counts = getWeekCountsFromCache(vendor, 'comercial');
        console.log('\n1️⃣ Week Counts from Cache:');
        console.log(JSON.stringify(counts, null, 2));

        // 2. Get clients for the specific day
        const clients = getClientsForDay(vendor, day, 'comercial', false); // Custom mode
        console.log(`\n2️⃣ getClientsForDay (Custom Mode): ${clients?.length || 0} clients`);
        if (clients) console.log('Clients:', clients.slice(0, 10).join(', '), '...');

        // 3. Get clients ignoring overrides (Original mode)
        const clientsOriginal = getClientsForDay(vendor, day, 'comercial', true); // Original mode
        console.log(`\n3️⃣ getClientsForDay (Original Mode): ${clientsOriginal?.length || 0} clients`);
        if (clientsOriginal) console.log('Clients:', clientsOriginal.slice(0, 10).join(', '), '...');

        // 4. Check RUTERO_CONFIG for this vendor/day
        const configRows = await query(`
            SELECT TRIM(CLIENTE) as CLIENTE, TRIM(DIA) as DIA, ORDEN
            FROM JAVIER.RUTERO_CONFIG
            WHERE VENDEDOR = '${vendor}'
            ORDER BY DIA, ORDEN
        `);
        console.log(`\n4️⃣ RUTERO_CONFIG entries: ${configRows.length}`);

        // Group by day
        const byDay = {};
        configRows.forEach(r => {
            if (!byDay[r.DIA]) byDay[r.DIA] = [];
            byDay[r.DIA].push(r.CLIENTE);
        });
        console.log('By Day:');
        Object.entries(byDay).forEach(([d, clients]) => {
            console.log(`   ${d}: ${clients.length} clients`);
        });

        // 5. Check for negative overrides
        const negativeOverrides = configRows.filter(r => r.DIA.startsWith('!') || r.DIA.startsWith('no_'));
        console.log(`\n5️⃣ Negative Overrides (!day): ${negativeOverrides.length}`);
        if (negativeOverrides.length > 0) {
            console.log('Sample:', negativeOverrides.slice(0, 5));
        }

        // 6. Specific Saturday check
        const saturdayConfigs = configRows.filter(r => r.DIA === 'sabado');
        console.log(`\n6️⃣ Saturday configs: ${saturdayConfigs.length}`);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}
diagnose();
