// tools/check_config_data.js - moved from scripts/check_config_data.js (WS2 tools consolidation, rama test).
// datos configuracion OBJ_CONFIG lectura
// Uso: node backend/scripts/tools/check_config_data.js Env: pool PG DB2: R (detalle: backend/scripts/tools/README.md).
const { query } = require('../../config/db');

async function checkConfig() {
    console.log('Checking OBJ_CONFIG table...');
    try {
        const rows = await query(`SELECT * FROM JAVIER.OBJ_CONFIG`, false, false);
        console.log(`Found ${rows.length} config rows.`);
        if (rows.length > 0) console.log(rows);
    } catch (e) {
        console.log('Error checking config:', e.message);
    }
    process.exit();
}

checkConfig();
