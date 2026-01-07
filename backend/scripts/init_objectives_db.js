const { query, initDb } = require('../config/db');

async function createTables() {
    try {
        await initDb();
        console.log('🚀 Initializing Objectives Database Tables...');

        // 1. OBJ_CONFIG table (Current Configuration)
        // Stores the active target percentage for a client/vendor pair.
        // If a client isn't here, we assume the default (e.g. 10%).
        try {
            await query(`
                CREATE TABLE JAVIER.OBJ_CONFIG (
                    CODIGOVENDEDOR VARCHAR(20) NOT NULL,
                    CODIGOCLIENTE VARCHAR(20) NOT NULL,
                    TARGET_PERCENTAGE DECIMAL(5,2) DEFAULT 10.00,
                    UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UPDATED_BY VARCHAR(50),
                    PRIMARY KEY (CODIGOVENDEDOR, CODIGOCLIENTE)
                )
            `);
            console.log('✅ JAVIER.OBJ_CONFIG table created.');
        } catch (e) {
            if (e.message.includes('SQL0601') || e.message.includes('already exists')) {
                console.log('ℹ️ JAVIER.OBJ_CONFIG already exists.');
            } else {
                throw e;
            }
        }

        // 2. OBJ_HISTORY table (Audit Log)
        // Tracks changes over time.
        try {
            await query(`
                CREATE TABLE JAVIER.OBJ_HISTORY (
                    ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    CODIGOVENDEDOR VARCHAR(20),
                    CODIGOCLIENTE VARCHAR(20),
                    NOMBRECLIENTE VARCHAR(100), -- Snapshot of name for convenience
                    OLD_PERCENTAGE DECIMAL(5,2),
                    NEW_PERCENTAGE DECIMAL(5,2),
                    CHANGE_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CHANGED_BY VARCHAR(50)
                )
            `);
            console.log('✅ JAVIER.OBJ_HISTORY table created.');
        } catch (e) {
            if (e.message.includes('SQL0601') || e.message.includes('already exists')) {
                console.log('ℹ️ JAVIER.OBJ_HISTORY already exists.');
            } else {
                throw e;
            }
        }

        // 3. Grant permissions (optional, ensuring app user has access if JAVIER is different)
        // Assuming the connection user has rights or is JAVIER. 
        // If needed: await query('GRANT ALL ON JAVIER.OBJ_CONFIG TO USER ...');

        console.log('🎉 Database initialization complete.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error creating tables:', error);
        process.exit(1);
    }
}

createTables();
