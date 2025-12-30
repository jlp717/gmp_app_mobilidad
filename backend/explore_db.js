const odbc = require('odbc');

async function explore() {
    const c = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

    try {
        // First, list all schemas
        console.log('=== LISTING ALL SCHEMAS ===');
        const schemas = await c.query(`
      SELECT DISTINCT TABLE_SCHEMA 
      FROM QSYS2.SYSTABLES 
      WHERE TABLE_TYPE = 'T'
      FETCH FIRST 100 ROWS ONLY
    `);
        console.log('Schemas found:', schemas.map(s => s.TABLE_SCHEMA).join(', '));

        // Search for tables with "CLI" or "CUSTOMER" in name across all schemas
        console.log('\n=== SEARCHING CLIENT TABLES ===');
        const clientTables = await c.query(`
      SELECT TABLE_SCHEMA, TABLE_NAME 
      FROM QSYS2.SYSTABLES 
      WHERE TABLE_TYPE = 'T' 
      AND (UPPER(TABLE_NAME) LIKE '%CLI%' 
           OR UPPER(TABLE_NAME) LIKE '%CUSTOMER%' 
           OR UPPER(TABLE_NAME) LIKE '%CLIENT%')
      FETCH FIRST 50 ROWS ONLY
    `);
        console.log('Client tables:', JSON.stringify(clientTables, null, 2));

        // Now search for GPS-like columns in those specific tables
        console.log('\n=== SEARCHING GPS COLUMNS ===');
        for (const t of clientTables.slice(0, 5)) { // Check first 5 tables
            console.log(`\nChecking ${t.TABLE_SCHEMA}.${t.TABLE_NAME}:`);
            const cols = await c.query(`
        SELECT COLUMN_NAME 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = '${t.TABLE_SCHEMA}' 
        AND TABLE_NAME = '${t.TABLE_NAME}'
        AND (UPPER(COLUMN_NAME) LIKE '%LAT%' 
             OR UPPER(COLUMN_NAME) LIKE '%LON%'
             OR UPPER(COLUMN_NAME) LIKE '%GPS%'
             OR UPPER(COLUMN_NAME) LIKE '%COORD%'
             OR UPPER(COLUMN_NAME) LIKE '%X_%'
             OR UPPER(COLUMN_NAME) LIKE '%Y_%'
             OR UPPER(COLUMN_NAME) LIKE '%POSICIO%')
        FETCH FIRST 20 ROWS ONLY
      `);
            if (cols.length > 0) {
                console.log('  GPS columns found:', cols.map(c => c.COLUMN_NAME).join(', '));
            } else {
                console.log('  No GPS columns found');
            }
        }

    } catch (err) {
        console.error('Error:', err.message);
    }

    await c.close();
}

explore();
