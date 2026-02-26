const fs = require('fs');
const { query } = require('./config/db');

async function deepSearch() {
    let out = '';
    try {
        console.log('Searching for columns related to dimensions/weight/volume in any table containing VEH/CAMION/TRANSP/FLOTA...');

        // QSYS2.SYSCOLUMNS has table and column information in AS400/DB2
        const sysQuery = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TEXT 
      FROM QSYS2.SYSCOLUMNS 
      WHERE (
        TABLE_NAME LIKE '%VEH%' OR 
        TABLE_NAME LIKE '%CAMIO%' OR 
        TABLE_NAME LIKE '%TRANSP%' OR 
        TABLE_NAME LIKE '%FLOT%'
      ) AND (
        COLUMN_NAME LIKE '%LARGO%' OR 
        COLUMN_NAME LIKE '%ANCHO%' OR 
        COLUMN_NAME LIKE '%ALTO%' OR 
        COLUMN_NAME LIKE '%DIMEN%' OR 
        COLUMN_NAME LIKE '%PES%' OR 
        COLUMN_NAME LIKE '%VOL%' OR 
        COLUMN_NAME LIKE '%KILOS%' OR 
        COLUMN_NAME LIKE '%CAP%' OR
        COLUMN_NAME LIKE '%MAX%'
      ) AND TABLE_SCHEMA NOT IN ('QSYS', 'QSYS2', 'SYSIBM')
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `);

        out += '--- POTENTIAL COLUMNS FOR TRUCK DIMENSIONS ---\n';
        out += JSON.stringify(sysQuery, null, 2);

        console.log(`Found ${sysQuery.length} potential columns.`);

        // Also look for any tables that might be "truck types" or "models"
        const tablesQuery = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TEXT 
      FROM QSYS2.SYSTABLES 
      WHERE (
        TABLE_NAME LIKE '%VEH%' OR 
        TABLE_NAME LIKE '%CAMIO%' OR 
        TABLE_NAME LIKE '%TRANSP%'
      ) AND TABLE_SCHEMA NOT IN ('QSYS', 'QSYS2', 'SYSIBM')
    `);

        out += '\n\n--- ALL VEHICLE RELATED TABLES ---\n';
        out += JSON.stringify(tablesQuery, null, 2);

        fs.writeFileSync('deep_explore_out.txt', out);
        console.log('Results written to deep_explore_out.txt');
        process.exit(0);
    } catch (err) {
        console.error('DB ERROR:', err);
        process.exit(1);
    }
}

// Give DB connection time to initialize
setTimeout(deepSearch, 1500);
