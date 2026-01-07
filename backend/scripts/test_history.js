const { query, initDb } = require('../config/db');

async function testHistory() {
    try {
        await initDb();
        console.log('Testing History Trigger...');

        // 1. Get current count of history
        const initialHistory = await query(`SELECT COUNT(*) as CNT FROM JAVIER.OBJ_HISTORY`);
        const initialCount = parseInt(initialHistory[0].CNT);
        console.log('Initial History Count:', initialCount);

        // 2. Update the default record
        console.log('Updating TARGET_PERCENTAGE to 12.00...');
        await query(`UPDATE JAVIER.OBJ_CONFIG SET TARGET_PERCENTAGE = 12.00 WHERE CODIGOCLIENTE = '*'`);

        // 3. Check history count
        const finalHistory = await query(`SELECT COUNT(*) as CNT FROM JAVIER.OBJ_HISTORY`);
        const finalCount = parseInt(finalHistory[0].CNT);
        console.log('Final History Count:', finalCount);

        if (finalCount > initialCount) {
            console.log('SUCCESS: History record created.');
            const latest = await query(`SELECT * FROM JAVIER.OBJ_HISTORY ORDER BY CHANGE_DATE DESC FETCH FIRST 1 ROWS ONLY`);
            console.log('Latest history:', latest[0]);
        } else {
            console.log('WARNING: No history record created. Trigger might be missing.');
        }

        // 4. Revert
        console.log('Reverting to 10.00...');
        await query(`UPDATE JAVIER.OBJ_CONFIG SET TARGET_PERCENTAGE = 10.00 WHERE CODIGOCLIENTE = '*'`);

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

testHistory();
