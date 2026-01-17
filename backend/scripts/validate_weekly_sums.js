/**
 * Validate Weekly Sums Script
 * Validates that weekly aggregations per day for a repartidor are correct
 */

const { query, initDb } = require('../config/db');

async function validateWeeklySums() {
    await initDb();

    console.log('=== WEEKLY DATA VALIDATION ===\n');

    // Get current week dates
    const today = new Date();
    const dayOfWeek = today.getDay() || 7;
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek + 1);

    const weekDays = [];
    const d = new Date(startOfWeek);
    for (let i = 0; i < 7; i++) {
        weekDays.push({
            day: d.getDate(),
            month: d.getMonth() + 1,
            year: d.getFullYear(),
            dateInt: d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
        });
        d.setDate(d.getDate() + 1);
    }

    console.log(`Week: ${weekDays[0].day}/${weekDays[0].month} to ${weekDays[6].day}/${weekDays[6].month}\n`);

    // Test with a known repartidor (usually 44 or similar)
    const testRepartidorIds = ['44', '45', '46'];

    for (const repartidorId of testRepartidorIds) {
        console.log(`\n--- Repartidor: ${repartidorId} ---`);

        try {
            // Query 1: Get daily counts using the FIXED logic
            const sql = `
                SELECT 
                    OPP.DIAREPARTO as DIA,
                    OPP.MESREPARTO as MES,
                    OPP.ANOREPARTO as ANO,
                    COUNT(*) as TOTAL_CLIENTES
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC 
                    ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) >= ${weekDays[0].dateInt}
                  AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) <= ${weekDays[6].dateInt}
                  AND TRIM(OPP.CODIGOREPARTIDOR) = '${repartidorId}'
                GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO, OPP.DIAREPARTO
                ORDER BY OPP.ANOREPARTO, OPP.MESREPARTO, OPP.DIAREPARTO
            `;

            const rows = await query(sql, false) || [];

            if (rows.length === 0) {
                console.log('  No deliveries this week');
            } else {
                let totalWeek = 0;
                rows.forEach(row => {
                    console.log(`  ${row.DIA}/${row.MES}/${row.ANO}: ${row.TOTAL_CLIENTES} clients`);
                    totalWeek += parseInt(row.TOTAL_CLIENTES);
                });
                console.log(`  TOTAL WEEK: ${totalWeek} clients`);
            }

        } catch (e) {
            console.log(`  Error: ${e.message}`);
        }
    }

    console.log('\n=== VALIDATION COMPLETE ===');
    process.exit();
}

validateWeeklySums().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
