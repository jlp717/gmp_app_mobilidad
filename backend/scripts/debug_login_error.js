const { query, initDb } = require('../config/db');

async function debugTables() {
    try {
        await initDb();
        console.log('✅ Connected. Testing tables...');

        // 1. Check if tables exist
        const tables = ['DSEDAC.VDPL1', 'DSEDAC.VDD', 'DSEDAC.VDC', 'DSEDAC.VDDX', 'JAVIER.COMMISSION_EXCEPTIONS'];

        for (const t of tables) {
            try {
                const [schema, name] = t.split('.');
                console.log(`\n🔍 Checking ${t}...`);
                const rows = await query(`SELECT * FROM ${t} FETCH FIRST 1 ROWS ONLY`);
                console.log(`   ✅ Exists. Row count: ${rows.length}`);
                if (rows.length > 0) {
                    console.log(`   Columns: ${Object.keys(rows[0]).join(', ')}`);
                }
            } catch (e) {
                console.log(`   ❌ ERROR accessing ${t}: ${e.message}`);
                // Try selecting 1 col to see if * is the problem
                try {
                    const testCols = await query(`SELECT COUNT(*) FROM ${t}`);
                    console.log(`   ⚠️ Could count rows though: ${testCols[0]['1']}`);
                } catch (e2) {
                    console.log(`   💀 Table definitely inaccessible.`);
                }
            }
        }

        // 2. Test the specific LOGIN JOIN query
        console.log('\n🔍 Testing Full Join Query...');
        const loginQuery = `
            SELECT P.CODIGOVENDEDOR, P.CODIGOPIN, 
                   TRIM(D.NOMBREVENDEDOR) as NOMBREVENDEDOR,
                   V.TIPOVENDEDOR, X.JEFEVENTASSN,
                   E.HIDE_COMMISSIONS
            FROM DSEDAC.VDPL1 P
            JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
            JOIN DSEDAC.VDC V ON P.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND V.SUBEMPRESA = 'GMP'
            LEFT JOIN DSEDAC.VDDX X ON P.CODIGOVENDEDOR = X.CODIGOVENDEDOR
            LEFT JOIN JAVIER.COMMISSION_EXCEPTIONS E ON P.CODIGOVENDEDOR = E.CODIGOVENDEDOR
            FETCH FIRST 1 ROWS ONLY
        `;

        try {
            const res = await query(loginQuery);
            console.log(`✅ Join Query Works! Result: ${JSON.stringify(res[0])}`);
        } catch (e) {
            console.log(`❌ Join Query Failed: ${e.message}`);
        }

    } catch (e) {
        console.error('Fatal error:', e);
    }
    process.exit(0);
}

debugTables();
