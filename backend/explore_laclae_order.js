/**
 * Explore LACLAE table structure for order and visit/reparto columns
 * Run with: node explore_laclae_order.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
    console.log('='.repeat(70));
    console.log('EXPLORING LACLAE TABLE FOR ORDER/VISIT/REPARTO COLUMNS');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Get all columns from LACLAE (checking DSED and DSEDAC)
        console.log('\n1. LACLAE COLUMNS (DSEDAC schema):');
        console.log('-'.repeat(60));

        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LACLAE'
        ORDER BY ORDINAL_POSITION
      `);
            console.log(`  Found ${cols.length} columns:`);
            cols.forEach(c => console.log(`    ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) { console.log('  Error:', e.message); }

        // 2. Check DSED schema
        console.log('\n\n2. LACLAE COLUMNS (DSED schema):');
        console.log('-'.repeat(60));

        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSED' AND TABLE_NAME = 'LACLAE'
        ORDER BY ORDINAL_POSITION
      `);
            console.log(`  Found ${cols.length} columns:`);
            cols.forEach(c => console.log(`    ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) { console.log('  Error:', e.message); }

        // 3. Check for columns containing T8 pattern
        console.log('\n\n3. COLUMNS WITH T8 PATTERN (all schemas):');
        console.log('-'.repeat(60));

        try {
            const cols = await conn.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE COLUMN_NAME LIKE '%T8%'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `);
            cols.forEach(c => console.log(`  ${c.TABLE_SCHEMA}.${c.TABLE_NAME}: ${c.COLUMN_NAME}`));
        } catch (e) { console.log('  Error:', e.message); }

        // 4. Check for DIV, ORV columns (visit/reparto)
        console.log('\n\n4. COLUMNS WITH DIV/ORV/OVL PATTERN:');
        console.log('-'.repeat(60));

        try {
            const cols = await conn.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE COLUMN_NAME LIKE '%DIV%' OR COLUMN_NAME LIKE '%OVL%' OR COLUMN_NAME LIKE '%ORV%'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `);
            cols.forEach(c => console.log(`  ${c.TABLE_SCHEMA}.${c.TABLE_NAME}: ${c.COLUMN_NAME}`));
        } catch (e) { console.log('  Error:', e.message); }

        // 5. Sample data from LACLAE in DSEDAC
        console.log('\n\n5. SAMPLE LACLAE DATA:');
        console.log('-'.repeat(60));

        try {
            const sample = await conn.query(`
        SELECT * FROM DSEDAC.LACLAE
        FETCH FIRST 1 ROWS ONLY
      `);
            if (sample.length > 0) {
                console.log('  Columns:', Object.keys(sample[0]).join(', '));
                for (const [k, v] of Object.entries(sample[0])) {
                    const val = String(v || '').trim();
                    if (val) console.log(`    ${k}: ${val.substring(0, 20)}`);
                }
            }
        } catch (e) { console.log('  LACLAE Error:', e.message); }

        // 6. Check RUTSDE or similar tables
        console.log('\n\n6. TABLES WITH RUT PREFIX:');
        console.log('-'.repeat(60));

        try {
            const tables = await conn.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME 
        FROM QSYS2.SYSTABLES 
        WHERE TABLE_NAME LIKE 'RUT%' OR TABLE_NAME LIKE 'LAC%'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `);
            tables.forEach(t => console.log(`  ${t.TABLE_SCHEMA}.${t.TABLE_NAME}`));
        } catch (e) { console.log('  Error:', e.message); }

        // 7. Check DSED schema tables
        console.log('\n\n7. DSED SCHEMA TABLES:');
        console.log('-'.repeat(60));

        try {
            const tables = await conn.query(`
        SELECT TABLE_NAME 
        FROM QSYS2.SYSTABLES 
        WHERE TABLE_SCHEMA = 'DSED'
        ORDER BY TABLE_NAME
        FETCH FIRST 30 ROWS ONLY
      `);
            tables.forEach(t => console.log(`  ${t.TABLE_NAME}`));
        } catch (e) { console.log('  Error:', e.message); }

        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

explore().catch(console.error);
