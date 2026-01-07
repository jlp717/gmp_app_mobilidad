const { query, initDb } = require('../config/db');

async function createTrigger() {
    try {
        await initDb();
        console.log('Creating Trigger TRG_OBJ_HISTORY...');

        // Drop if exists (might fail if not exists, but try catch)
        try {
            await query(`DROP TRIGGER JAVIER.TRG_OBJ_HISTORY`);
            console.log('Dropped existing trigger.');
        } catch (e) { /* ignore */ }

        const sql = `
            CREATE TRIGGER JAVIER.TRG_OBJ_HISTORY
            AFTER UPDATE ON JAVIER.OBJ_CONFIG
            REFERENCING OLD AS O NEW AS N
            FOR EACH ROW
            MODE DB2SQL
            INSERT INTO JAVIER.OBJ_HISTORY (
                CODIGOVENDEDOR, 
                CODIGOCLIENTE, 
                NOMBRECLIENTE,
                OLD_PERCENTAGE, 
                NEW_PERCENTAGE, 
                CHANGE_DATE, 
                CHANGED_BY
            )
            VALUES (
                O.CODIGOVENDEDOR, 
                O.CODIGOCLIENTE, 
                'Unknown', -- Name not in Config table
                O.TARGET_PERCENTAGE, 
                N.TARGET_PERCENTAGE, 
                CURRENT TIMESTAMP, 
                N.UPDATED_BY
            )
        `;

        await query(sql);
        console.log('Trigger created successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Error creating trigger:', err);
        process.exit(1);
    }
}

createTrigger();
