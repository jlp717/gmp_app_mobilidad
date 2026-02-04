
const odbc = require('odbc');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function initDB() {
    console.log('🔌 Connecting to AS400...');
    const connectionString = `DRIVER={IBM i Access ODBC Driver};SYSTEM=${process.env.DB_HOST};UID=${process.env.DB_USER};PWD=${process.env.DB_PASSWORD};`;

    let connection;
    try {
        connection = await odbc.connect(connectionString);
        console.log('✅ Connected!');

        // Define tables to create
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

        for (const table of tables) {
            console.log(`🔨 Checking ${table.name}...`);
            try {
                // Try to create. If it exists, it might throw or just fail.
                // "IF NOT EXISTS" is not standard in some DB2 versions, so we just try CREATE.
                await connection.query(table.sql);
                console.log(`   ✅ Created ${table.name}`);
            } catch (err) {
                // Check for "already exists" error (SQL State 42710 usually, or message content)
                if (err.message.includes('already exists') || err.message.includes('42710')) {
                    console.log(`   ℹ️ ${table.name} already exists.`);
                } else {
                    console.log(`   ⚠️ Error creating ${table.name}: ${err.message}`);
                    console.log(`   (This might be fine if table exists but error message is different)`);
                }
            }
        }

        console.log('🏁 Initialization complete.');

    } catch (error) {
        console.error('❌ Connection/Script Error:', error);
    } finally {
        if (connection) {
            await connection.close();
            console.log('🔌 Disconnected.');
        }
    }
}

initDB();
