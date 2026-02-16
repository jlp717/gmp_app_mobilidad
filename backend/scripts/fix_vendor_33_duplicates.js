const { query, initDb } = require('../config/db');
const { loadLaclaeCache, getClientDays } = require('../services/laclae');

async function fixVendor33() {
    try {
        await initDb();
        console.log('🏗️ Loading Cache...');
        await loadLaclaeCache();

        const vendor = '33';
        console.log(`🔍 Scanning Vendor ${vendor} for Wednesday ghosts...`);

        // 1. Get all clients with overrides for Vendor 33
        const overrides = await query(`
            SELECT TRIM(CLIENTE) as CLIENTE, TRIM(DIA) as DIA
            FROM JAVIER.RUTERO_CONFIG
            WHERE VENDEDOR = '${vendor}'
        `);

        // Map client -> Set of override days
        const overrideMap = {};
        overrides.forEach(r => {
            if (!overrideMap[r.CLIENTE]) overrideMap[r.CLIENTE] = new Set();
            overrideMap[r.CLIENTE].add(r.DIA.toLowerCase());
        });

        const updates = [];

        // 2. Iterate clients with overrides
        for (const clientCode of Object.keys(overrideMap)) {
            const overrideDays = overrideMap[clientCode];

            // Check Natural Days
            const natural = getClientDays(vendor, clientCode);
            if (!natural) continue; // Should not happen if valid

            const naturalWed = natural.visitDays.includes('miercoles');
            const overrideWed = overrideDays.has('miercoles');
            const blockedWed = overrideDays.has('!miercoles') || overrideDays.has('no_miercoles');

            // CONDITION:
            // 1. Client IS Natural Wednesday
            // 2. Client DOES NOT have explicit Wednesday override (Positive or Negative)
            // 3. Client DOES have override for OTHER days (meaning it was moved?)
            //    (If it has no overrides, it's just natural. If it has override for Mon, but not Wed, and Natural Wed... it shows on both.)

            if (naturalWed && !overrideWed && !blockedWed && overrideDays.size > 0) {
                console.log(`⚠️ Client ${clientCode}: Natural Wed + Overrides [${Array.from(overrideDays).join(', ')}] -> Insert Block!`);
                updates.push(clientCode);
            }
        }

        console.log(`\n📋 Found ${updates.length} clients to block on Wednesday.`);

        if (updates.length > 0) {
            console.log('🚀 Applying blocks...');
            for (const client of updates) {
                await query(`
                   INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, CLIENTE, DIA, ORDEN)
                   VALUES ('${vendor}', '${client}', '!miercoles', 0)
               `);
            }
            console.log('✅ Blocks applied.');
        } else {
            console.log('✅ No fix needed.');
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
fixVendor33();
