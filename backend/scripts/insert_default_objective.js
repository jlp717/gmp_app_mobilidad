const { query, initDb } = require('../config/db');

async function insertDefault() {
    try {
        await initDb();
        console.log('Inserting DEFAULT record into JAVIER.OBJ_CONFIG...');

        // Check if exists again to be safe
        const check = await query(`SELECT * FROM JAVIER.OBJ_CONFIG WHERE CODIGOCLIENTE = '*'`);
        if (check.length > 0) {
            console.log('Default already exists.');
            process.exit(0);
        }

        await query(`
            INSERT INTO JAVIER.OBJ_CONFIG 
            (CODIGOVENDEDOR, CODIGOCLIENTE, TARGET_PERCENTAGE, UPDATED_AT, UPDATED_BY) 
            VALUES ('*', '*', 10.00, CURRENT TIMESTAMP, 'SYSTEM')
        `);

        console.log('Inserted default record selected.');
        process.exit(0);
    } catch (err) {
        console.error('Error inserting default:', err);
        process.exit(1);
    }
}

insertDefault();
