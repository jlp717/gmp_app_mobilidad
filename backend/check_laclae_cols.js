const { query, initDb } = require('./config/db');

async function checkLACLAEColumns() {
    await initDb();
    
    console.log('=== LACLAE COLUMNS FOR MATRIX ===\n');
    
    // Check what columns LACLAE has
    const cols = await query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSED' AND TABLE_NAME = 'LACLAE'
        ORDER BY ORDINAL_POSITION
    `, false, false);
    
    console.log('All LACLAE columns:');
    cols.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    // Sample a row to see actual data
    console.log('\n\nSample row for PUA (4300009622):');
    const sample = await query(`
        SELECT *
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '4300009622'
          AND L.LCAADC = 2025
          AND L.TPDC = 'LAC'
        FETCH FIRST 1 ROWS ONLY
    `, false, false);
    
    if (sample.length > 0) {
        Object.entries(sample[0]).forEach(([k, v]) => {
            if (v !== null && v !== '' && v !== 0) {
                console.log(`  ${k}: ${v}`);
            }
        });
    }
    
    process.exit(0);
}

checkLACLAEColumns().catch(console.error);
