require('dotenv').config();
const { kpiQuery } = require('../kpi/config/db');
const { initDb } = require('../config/db');

async function testInsert() {
    try {
        console.log('Initializing DB pools...');
        await initDb();

        console.log('Attempting standard insert into KPI_ALERTS (without cast)...');

        const sql = `INSERT INTO JAVIER.KPI_ALERTS 
      (LOAD_ID, CLIENT_CODE, ALERT_TYPE, SEVERITY, MESSAGE, RAW_DATA, SOURCE_FILE, EXPIRES_AT) 
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP + 7 DAYS)`;

        const loadId = '2026-TEST';
        try {
            await kpiQuery(`INSERT INTO JAVIER.KPI_LOADS (LOAD_ID, STATUS, FILES_PROCESSED) VALUES (?, 'IN_PROGRESS', 'test.csv')`, [loadId]);
        } catch (e) {
            if (!e.message.includes('SQL0803')) console.error('FK creation error:', e.message);
        }
        const clientCode = '1234';
        const alertType = 'TEST_ALERT';
        const severity = 'info';
        const message = 'Test message';
        const rawData = JSON.stringify({ prop: "value" });
        const sourceFile = 'test.csv';

        try {
            await kpiQuery(sql, [loadId, clientCode, alertType, severity, message, rawData, sourceFile]);
            console.log('✅ Standard insert worked.');
        } catch (e) {
            console.error('❌ Standard insert failed:', e.message);

            console.log('\nAttempting insert WITH explicit CAST(? AS CLOB(64K))...');

            const sql2 = `INSERT INTO JAVIER.KPI_ALERTS 
      (LOAD_ID, CLIENT_CODE, ALERT_TYPE, SEVERITY, MESSAGE, RAW_DATA, SOURCE_FILE, EXPIRES_AT) 
      VALUES (?, ?, ?, ?, ?, CAST(? AS CLOB(64K)), ?, CURRENT TIMESTAMP + 7 DAYS)`;

            try {
                await kpiQuery(sql2, [loadId, clientCode, alertType, severity, message, rawData, sourceFile]);
                console.log('✅ Insert with CAST worked.');
            } catch (e2) {
                console.error('❌ Insert with CAST also failed:', e2.message);
            }
        }
    } catch (err) {
        console.error('Fatal test error:', err);
    } finally {
        process.exit(0);
    }
}
testInsert();
