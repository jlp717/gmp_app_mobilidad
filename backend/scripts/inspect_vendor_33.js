const { query, initDb } = require('../config/db');

async function inspectVendor33() {
    try {
        await initDb();
        console.log('🔍 Inspecting Vendor 33 (Wed/Fri)...');

        // 1. Check for duplicates or weird states
        const rows = await query(`
            SELECT TRIM(CLIENTE) as CLIENTE, TRIM(DIA) as DIA, ORDEN
            FROM JAVIER.RUTERO_CONFIG
            WHERE VENDEDOR = '33'
            ORDER BY CLIENTE, DIA
        `);

        console.log(`📋 Found ${rows.length} overrides for Vendor 33.`);

        // Check for specific clients with multiple day entries (Multi-Day Logic check)
        const clientCounts = {};
        rows.forEach(r => {
            if (!clientCounts[r.CLIENTE]) clientCounts[r.CLIENTE] = [];
            clientCounts[r.CLIENTE].push(r.DIA);
        });

        const multiDayClients = Object.entries(clientCounts).filter(([k, v]) => v.length > 1);
        if (multiDayClients.length > 0) {
            console.log('\n⚠️ Clients with overrides on MULTIPLE days (Potential Conflict?):');
            multiDayClients.forEach(([c, days]) => {
                console.log(`  Client ${c}: ${days.join(', ')}`);
            });
        }

        // Check for "miercoles" specific strange entries
        const wedOverrides = rows.filter(r => r.DIA === 'miercoles');
        console.log(`\n📅 Wednesday Overrides: ${wedOverrides.length}`);
        if (wedOverrides.length > 0) console.log('Sample:', wedOverrides.slice(0, 5));

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
inspectVendor33();
