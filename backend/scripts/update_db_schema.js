const { query, initDb } = require('../config/db');

async function applyUpdates() {
    try {
        await initDb();
        console.log("🚀 Starting Database Updates...");

        // 1. Update Objectives for 02
        console.log("\n1️⃣ Updating Objectives for Commercial 02 (+2.5%)...");
        // First check current value to be safe
        const currentParams = await query(`SELECT TARGET_PERCENTAGE FROM JAVIER.OBJ_CONFIG WHERE CODIGOVENDEDOR = '02' FETCH FIRST 1 ROWS ONLY`, false);

        if (currentParams.length > 0) {
            console.log(`   Current Target: ${currentParams[0].TARGET_PERCENTAGE}%`);

            const updateResult = await query(`
                UPDATE JAVIER.OBJ_CONFIG 
                SET TARGET_PERCENTAGE = TARGET_PERCENTAGE + 2.5 
                WHERE CODIGOVENDEDOR = '02'
            `);
            console.log(`   ✅ Updated rows (Count unavailable in ODBC but query ran).`);

            const newParams = await query(`SELECT TARGET_PERCENTAGE FROM JAVIER.OBJ_CONFIG WHERE CODIGOVENDEDOR = '02' FETCH FIRST 1 ROWS ONLY`, false);
            console.log(`   New Target: ${newParams[0].TARGET_PERCENTAGE}%`);
        } else {
            console.log("   ⚠️ No records found for Commercial 02 in OBJ_CONFIG.");
        }

        // 2. Create Exception Table
        console.log("\n2️⃣ Creating JAVIER.COMMISSION_EXCEPTIONS table...");
        try {
            await query(`
                CREATE TABLE JAVIER.COMMISSION_EXCEPTIONS (
                    CODIGOVENDEDOR VARCHAR(20) NOT NULL PRIMARY KEY,
                    HIDE_COMMISSIONS CHAR(1) DEFAULT 'Y',
                    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log("   ✅ Table created successfully.");
        } catch (e) {
            if (e.message.includes('already exists')) {
                console.log("   ℹ️ Table already exists.");
            } else {
                console.error(`   ❌ Error creating table: ${e.message}`);
            }
        }

        // 3. Insert Exceptions (02, 03, 13)
        console.log("\n3️⃣ Populating Exceptions (02, 03, 13)...");
        const vendors = ['02', '03', '13'];

        for (const v of vendors) {
            try {
                // Try insert, if fails assume exists (MERGE not always reliable in all DB2 versions via ODBC simple query)
                // Using simple check-insert logic
                const check = await query(`SELECT 1 FROM JAVIER.COMMISSION_EXCEPTIONS WHERE CODIGOVENDEDOR = '${v}'`, false);
                if (check.length === 0) {
                    await query(`INSERT INTO JAVIER.COMMISSION_EXCEPTIONS (CODIGOVENDEDOR, HIDE_COMMISSIONS) VALUES ('${v}', 'Y')`);
                    console.log(`   ✅ Added vendor ${v}`);
                } else {
                    console.log(`   ℹ️ Vendor ${v} already in exceptions.`);
                }
            } catch (e) {
                console.error(`   ❌ Error adding vendor ${v}: ${e.message}`);
            }
        }

    } catch (error) {
        console.error("❌ Fatal Error:", error.message);
    } finally {
        process.exit();
    }
}

applyUpdates();
