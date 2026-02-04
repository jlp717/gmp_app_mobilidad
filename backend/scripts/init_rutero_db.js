
const { query } = require('../config/db');
const logger = require('../middleware/logger');

async function initRuteroDB() {
    console.log('🚀 Starting Rutero DB Initialization...');

    const tables = [
        {
            name: 'JAVIER.DELIVERY_STATUS',
            sql: `CREATE TABLE JAVIER.DELIVERY_STATUS (
                ID VARCHAR(50) NOT NULL PRIMARY KEY,
                STATUS VARCHAR(20) DEFAULT 'PENDIENTE',
                OBSERVACIONES VARCHAR(1000),
                FIRMA_PATH VARCHAR(255),
                LATITUD DOUBLE,
                LONGITUD DOUBLE,
                REPARTIDOR_ID VARCHAR(20),
                UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        },
        {
            name: 'JAVIER.CLIENT_SIGNERS',
            sql: `CREATE TABLE JAVIER.CLIENT_SIGNERS (
                CODIGOCLIENTE VARCHAR(20) NOT NULL,
                DNI VARCHAR(20) NOT NULL,
                NOMBRE VARCHAR(100),
                LAST_USED DATE,
                USAGE_COUNT INT DEFAULT 1,
                PRIMARY KEY (CODIGOCLIENTE, DNI)
            )`
        }
    ];

    try {
        for (const table of tables) {
            console.log(`🔨 Checking ${table.name}...`);
            try {
                // Try selecting 1 row to see if it exists
                // Note: FETCH FIRST 1 ROWS ONLY is standard DB2 syntax
                await query(`SELECT ID FROM ${table.name} FETCH FIRST 1 ROWS ONLY`, false, false);
                console.log(`   ✅ ${table.name} exists and is accessible.`);
            } catch (checkErr) {
                console.log(`   ℹ️ ${table.name} not accessible or missing (${checkErr.message}). Attempting creation...`);

                try {
                    await query(table.sql, false, true);
                    console.log(`   ✅ Created ${table.name} successfully.`);
                } catch (createErr) {
                    // Check common "already exists" errors just in case
                    if (createErr.message && (createErr.message.includes('already exists') || createErr.message.includes('42710'))) {
                        console.log(`   ✅ ${table.name} already exists (race condition check).`);
                    } else {
                        console.error(`   ❌ Failed to create ${table.name}: ${createErr.message}`);
                    }
                }
            }
        }
        console.log('🏁 Initialization complete.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Critical Script Error:', err);
        process.exit(1);
    }
}

// Ensure 5s wait for pool init inside query check if needed, but db.js handles it.
initRuteroDB();
