const { query, initDb } = require('../config/db');

async function checkJavierTables() {
    await initDb();

    // List all tables in JAVIER schema
    console.log('=== Tables in JAVIER Schema ===');
    try {
        const tables = await query(`
            SELECT TABLE_NAME 
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'JAVIER'
            ORDER BY TABLE_NAME
        `, false);
        console.log('Tables found:', tables.map(t => t.TABLE_NAME).join(', '));
    } catch (e) {
        console.log('Error:', e.message);
    }

    // Check for specific objective/commission tables
    console.log('\n=== Checking for Objective/Commission Tables ===');
    const possibleNames = ['OBJETIVOS', 'COMISIONES', 'TARGETS', 'METAS', 'GOAL', 'COMMERCIAL'];

    for (const name of possibleNames) {
        try {
            const cols = await query(`
                SELECT COLUMN_NAME 
                FROM QSYS2.SYSCOLUMNS 
                WHERE TABLE_SCHEMA = 'JAVIER' 
                AND TABLE_NAME LIKE '%${name}%'
            `, false);
            if (cols.length > 0) {
                console.log(`Found columns for ${name}:`, cols.map(c => c.COLUMN_NAME).join(', '));
            }
        } catch (e) {
            // Ignore
        }
    }

    // Check for any existing % improvement table mentioned by user
    console.log('\n=== Sample Data from Potential Config Tables ===');
    try {
        const allTables = await query(`
            SELECT TABLE_NAME 
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'JAVIER'
        `, false);

        for (const t of allTables) {
            try {
                const sample = await query(`SELECT * FROM JAVIER.${t.TABLE_NAME} FETCH FIRST 3 ROWS ONLY`, false);
                if (sample.length > 0) {
                    console.log(`\n${t.TABLE_NAME}:`, JSON.stringify(sample[0], null, 2));
                }
            } catch (e) {
                // Skip tables that error
            }
        }
    } catch (e) {
        console.log('Error scanning tables:', e.message);
    }

    process.exit();
}

checkJavierTables();
