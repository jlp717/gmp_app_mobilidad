const { query } = require('../config/db');
const logger = require('../middleware/logger');

async function setupTable() {
    try {
        console.log('Checking JAVIER.DELIVERY_STATUS table...');

        // Check if table exists (DB2 specific)
        const checkSql = `
            SELECT COUNT(*) as CNT 
            FROM SYSIBM.SYSTABLES 
            WHERE TRIM(CREATOR) = 'JAVIER' AND TRIM(NAME) = 'DELIVERY_STATUS'
        `;
        const result = await query(checkSql, false);

        if (result[0].CNT > 0) {
            console.log('Table JAVIER.DELIVERY_STATUS already exists.');
        } else {
            console.log('Creating JAVIER.DELIVERY_STATUS...');
            const createSql = `
                CREATE TABLE JAVIER.DELIVERY_STATUS (
                    ID VARCHAR(64) NOT NULL PRIMARY KEY,
                    STATUS VARCHAR(20) DEFAULT 'PENDIENTE',
                    OBSERVACIONES VARCHAR(512),
                    FIRMA_PATH VARCHAR(255),
                    LATITUD DECIMAL(10, 8),
                    LONGITUD DECIMAL(11, 8),
                    UPDATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
                    REPARTIDOR_ID VARCHAR(20)
                )
            `;
            await query(createSql, false);
            console.log('Table created successfully.');
        }

        // Verify columns (optional, assuming create worked)

    } catch (e) {
        console.error('Error setting up table:', e);
    }
}

setupTable();
