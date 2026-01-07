const { getPool, initDb } = require('../config/db');
const { loadLaclaeCache, getClientsForDay } = require('../services/laclae');

async function debugRutero() {
    try {
        await initDb();
        const pool = getPool();

        console.log('🔍 Analyzing Rutero for Vendor 33...');

        // 1. Raw DB Check
        const rawCheck = await pool.query(`
            SELECT 
                COUNT(*) as TOTAL,
                SUM(CASE WHEN R1_T8DIVJ = 'S' THEN 1 ELSE 0 END) as THURSDAY_COUNT,
                SUM(CASE WHEN R1_T8DIVV = 'S' THEN 1 ELSE 0 END) as FRIDAY_COUNT
            FROM DSED.LACLAE
            WHERE TRIM(R1_T8CDVD) = '33'
        `);
        console.log('📊 RAW DB Stats for 33:');
        console.log(rawCheck);

        // 2. Cache Logic Check
        console.log('\n🔄 Loading Cache...');
        // We need to access the internal cache, but it's not exported. 
        // We can test via getClientsForDay provided by the module.
        // But first we must modify laclae.js to allow easier debugging? 
        // No, let's just use the public method.

        // Mock the global cache loading by calling the real function
        // Note: The module singleton might be tricky in a standalone script if not careful.
        // We rely on the required module instance.

        // Need to wait for cache load
        // But loadLaclaeCache is async and sets an internal ready flag.

        // Hack: We can just use the query logic from laclae.js directly in this script to "simulate" the cache build
        // to see if the parsing logic is the issue.

        const rows = await pool.query(`
            SELECT DISTINCT R1_T8CDVD as VENDEDOR, LCCDCL as CLIENTE, 
            R1_T8DIVJ as VIS_J, R1_T8DIVV as VIS_V
            FROM DSED.LACLAE
            WHERE TRIM(R1_T8CDVD) = '33'
        `);

        let thurs = 0;
        let fri = 0;

        rows.forEach(r => {
            if (r.VIS_J === 'S') thurs++;
            if (r.VIS_V === 'S') fri++;
        });

        console.log(`\n🧮 Simulation Match: Thursday=${thurs}, Friday=${fri}`);

        if (rawCheck[0].THURSDAY_COUNT !== thurs) {
            console.error('❌ Mismatch in Thursday counts! Logic error?');
        } else {
            console.log('✅ Counts match. Logic seems fine.');
        }

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

debugRutero();
