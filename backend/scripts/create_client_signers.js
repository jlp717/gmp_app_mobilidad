const { query, initDb } = require('../config/db');

async function createTable() {
    try {
        await initDb();

        /*
        JAVIER.CLIENT_SIGNERS
        - Stores recent signers for each client to enable autocomplete
        */

        const sql = `
            CREATE TABLE JAVIER.CLIENT_SIGNERS (
                CODIGOCLIENTE VARCHAR(20) NOT NULL,
                DNI VARCHAR(20) NOT NULL,
                NOMBRE VARCHAR(100),
                LAST_USED DATE,
                USAGE_COUNT INTEGER DEFAULT 1,
                PRIMARY KEY (CODIGOCLIENTE, DNI)
            )
        `;

        try {
            await query(sql);
            console.log('Table JAVIER.CLIENT_SIGNERS created successfully');
        } catch (e) {
            if (e.message.includes('already exists') || e.message.includes('object name already exists')) {
                console.log('Table JAVIER.CLIENT_SIGNERS already exists');
            } else {
                throw e;
            }
        }

        console.log('Done.');
        process.exit(0);
    } catch (error) {
        console.error('Error creating table:', error);
        process.exit(1);
    }
}

createTable();
