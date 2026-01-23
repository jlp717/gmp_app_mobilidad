const { query, initDb } = require('../config/db');

async function checkLaclae() {
    try {
        await initDb();
        const client = '4300005862';
        console.log(`🔍 Checking LACLAE for Client ${client}...`);

        const rows = await query(`
            SELECT DISTINCT LCCDVD, TRIM(V.NOMBREVENDEDOR) as NAME
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.VDD V ON L.LCCDVD = V.CODIGOVENDEDOR
            WHERE LCCDCL = '${client}'
              AND LCAADC >= 2024
        `);

        if (rows.length > 0) {
            console.log('Sales found with vendors:');
            rows.forEach(r => console.log(`- ${r.LCCDVD} (${r.NAME})`));
        } else {
            console.log('No sales found in recent years');
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkLaclae();
