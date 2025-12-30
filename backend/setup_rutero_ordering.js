const odbc = require('odbc');
const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    const conn = await odbc.connect(CONNECTION_STRING);
    try {
        const tableName = 'JAVIER.RUTERO_CONFIG';

        // 1. Check if table exists
        try {
            await conn.query(`SELECT COUNT(*) FROM ${tableName} FETCH FIRST 1 ROWS ONLY`);
            console.log(`Table ${tableName} already exists.`);
        } catch (e) {
            console.log(`Table ${tableName} does not exist. Creating...`);

            // 2. Create Table
            await conn.query(`
            CREATE TABLE ${tableName} (
                VENDEDOR VARCHAR(10) NOT NULL,
                DIA VARCHAR(20) NOT NULL,
                CLIENTE VARCHAR(20) NOT NULL,
                ORDEN INTEGER DEFAULT 0,
                UPDATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
                PRIMARY KEY (VENDEDOR, DIA, CLIENTE)
            )
        `);
            console.log(`Table ${tableName} created successfully.`);
        }

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await conn.close();
    }
}

main();
