/**
 * THOROUGH VENDEDOR TABLE EXPLORATION
 * User confirmed table exists with vendedor codes + names + roles
 * Checking DSED.LACLAE and exploring ALL views more carefully
 */

const odbc = require('odbc');
const fs = require('fs');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function deepVendedorExploration() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     DEEP VENDEDOR TABLE EXPLORATION                          ║');
    console.log('║     Looking for code + name + role mapping                   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const conn = await odbc.connect(DB_CONFIG);
    const results = {};

    try {
        // =========================================================================
        // STEP 1: Check DSED.LACLAE (user mentioned this)
        // =========================================================================
        console.log('=== STEP 1: DSED.LACLAE ===\n');

        try {
            const laclaeData = await conn.query(`SELECT * FROM DSED.LACLAE FETCH FIRST 30 ROWS ONLY`);
            if (laclaeData.length > 0) {
                console.log('DSED.LACLAE columns:', Object.keys(laclaeData[0]).join(', '));
                console.log('Sample data:', JSON.stringify(laclaeData, null, 2));
                results['DSED.LACLAE'] = laclaeData;
            }
        } catch (e) {
            console.log('DSED.LACLAE error:', e.message);
        }

        // =========================================================================
        // STEP 2: Get ALL tables and views in DSED schema
        // =========================================================================
        console.log('\n=== STEP 2: ALL DSED TABLES AND VIEWS ===\n');

        try {
            const dsedObjects = await conn.query(`
        SELECT TABLE_NAME, TABLE_TYPE, TABLE_TEXT
        FROM QSYS2.SYSTABLES 
        WHERE TABLE_SCHEMA = 'DSED'
        ORDER BY TABLE_NAME
      `);

            console.log(`Found ${dsedObjects.length} objects in DSED:`);
            for (const obj of dsedObjects) {
                console.log(`  ${obj.TABLE_TYPE === 'V' ? 'VIEW' : 'TABLE'} ${obj.TABLE_NAME}: ${(obj.TABLE_TEXT || '').trim()}`);
            }
            results.dsedObjects = dsedObjects;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // STEP 3: Check ALL views/tables starting with LA*, VE*, CO*, EM*
        // =========================================================================
        console.log('\n=== STEP 3: POTENTIAL VENDEDOR/EMPLOYEE TABLES ===\n');

        const prefixes = ['LA', 'VE', 'VEN', 'CO', 'COM', 'EM', 'EMP', 'PE', 'PER', 'AG', 'RE', 'REP'];

        for (const prefix of prefixes) {
            try {
                const tables = await conn.query(`
          SELECT TABLE_NAME, TABLE_SCHEMA, TABLE_TYPE
          FROM QSYS2.SYSTABLES 
          WHERE (TABLE_SCHEMA = 'DSED' OR TABLE_SCHEMA = 'DSEDAC')
            AND TABLE_NAME LIKE '${prefix}%'
          ORDER BY TABLE_SCHEMA, TABLE_NAME
        `);

                for (const t of tables) {
                    const fullName = `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`;
                    try {
                        const data = await conn.query(`SELECT * FROM ${fullName} FETCH FIRST 5 ROWS ONLY`);
                        if (data.length > 0) {
                            const columns = Object.keys(data[0]);

                            // Check for vendedor-related columns
                            const hasVendedor = columns.some(c =>
                                c.includes('VENDEDOR') || c.includes('COMERCIAL') ||
                                c.includes('REPRESENTANTE') || c.includes('CODIGO')
                            );
                            const hasName = columns.some(c =>
                                c.includes('NOMBRE') || c.includes('DESCRIPCION') || c.includes('DENOM')
                            );
                            const hasRole = columns.some(c =>
                                c.includes('CARGO') || c.includes('PUESTO') || c.includes('ROL') ||
                                c.includes('TIPO') || c.includes('CATEGORIA') || c.includes('DIRECTOR') ||
                                c.includes('JEFE') || c.includes('COMERCIAL')
                            );

                            if (hasVendedor || hasName) {
                                console.log(`\n*** ${fullName} (${t.TABLE_TYPE}) ***`);
                                console.log(`  Columns: ${columns.join(', ')}`);
                                console.log(`  Has vendedor cols: ${hasVendedor}, Has name cols: ${hasName}, Has role cols: ${hasRole}`);
                                console.log(`  Sample:`, JSON.stringify(data.slice(0, 3), null, 2));
                                results[fullName] = { columns, data: data.slice(0, 10) };
                            }
                        }
                    } catch (e) {
                        // Skip inaccessible tables
                    }
                }
            } catch (e) { }
        }

        // =========================================================================
        // STEP 4: Look for view definitions in DSED
        // =========================================================================
        console.log('\n=== STEP 4: VIEW DEFINITIONS ===\n');

        try {
            const views = await conn.query(`
        SELECT VIEW_NAME, VIEW_DEFINITION
        FROM QSYS2.SYSVIEWS
        WHERE VIEW_SCHEMA = 'DSED'
        FETCH FIRST 20 ROWS ONLY
      `);

            for (const view of views) {
                console.log(`VIEW ${view.VIEW_NAME}:`);
                console.log(`  ${(view.VIEW_DEFINITION || '').substring(0, 200)}...`);
            }
            results.viewDefinitions = views;
        } catch (e) {
            console.log('Error getting view definitions:', e.message);
        }

        // =========================================================================
        // STEP 5: Search for DIRECTOR, JEFE, COMERCIAL keywords in any table
        // =========================================================================
        console.log('\n=== STEP 5: SEARCHING FOR ROLE COLUMNS ===\n');

        try {
            const roleColumns = await conn.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TEXT
        FROM QSYS2.SYSCOLUMNS
        WHERE (TABLE_SCHEMA = 'DSED' OR TABLE_SCHEMA = 'DSEDAC')
          AND (COLUMN_NAME LIKE '%DIRECTOR%' 
               OR COLUMN_NAME LIKE '%JEFE%' 
               OR COLUMN_NAME LIKE '%CARGO%'
               OR COLUMN_NAME LIKE '%ROL%'
               OR COLUMN_NAME LIKE '%TIPO%'
               OR COLUMN_NAME LIKE '%CATEGORIA%'
               OR COLUMN_TEXT LIKE '%DIRECTOR%'
               OR COLUMN_TEXT LIKE '%JEFE%')
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `);

            console.log('Columns with role-related keywords:');
            console.log(JSON.stringify(roleColumns, null, 2));
            results.roleColumns = roleColumns;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // STEP 6: Find tables with both CODIGO and NOMBRE columns
        // =========================================================================
        console.log('\n=== STEP 6: TABLES WITH CODE + NAME COLUMNS ===\n');

        try {
            const codeNameTables = await conn.query(`
        SELECT DISTINCT A.TABLE_SCHEMA, A.TABLE_NAME
        FROM QSYS2.SYSCOLUMNS A
        WHERE A.TABLE_SCHEMA IN ('DSED', 'DSEDAC')
          AND A.COLUMN_NAME LIKE '%CODIGO%'
          AND EXISTS (
            SELECT 1 FROM QSYS2.SYSCOLUMNS B 
            WHERE B.TABLE_SCHEMA = A.TABLE_SCHEMA 
              AND B.TABLE_NAME = A.TABLE_NAME
              AND (B.COLUMN_NAME LIKE '%NOMBRE%' OR B.COLUMN_NAME LIKE '%DESCRIPCION%')
          )
        ORDER BY A.TABLE_SCHEMA, A.TABLE_NAME
      `);

            console.log('Tables with CODIGO + NOMBRE:');
            for (const t of codeNameTables) {
                const fullName = `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`;
                console.log(`  ${fullName}`);

                // If small table, show contents
                try {
                    const count = await conn.query(`SELECT COUNT(*) as CNT FROM ${fullName}`);
                    if (count[0].CNT < 100) {
                        const data = await conn.query(`SELECT * FROM ${fullName}`);
                        if (data.length > 0 && data.length < 30) {
                            const cols = Object.keys(data[0]);
                            if (cols.some(c => c.includes('VENDEDOR') || c.includes('COMERCIAL'))) {
                                console.log(`    *** POTENTIAL VENDEDOR MASTER: ${data.length} rows ***`);
                                console.log(`    Columns: ${cols.join(', ')}`);
                                console.log(`    Data:`, JSON.stringify(data, null, 2));
                                results[fullName] = data;
                            }
                        }
                    }
                } catch (e) { }
            }
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // STEP 7: Specific check for VEN, VEN1, VENL1 in both schemas
        // =========================================================================
        console.log('\n=== STEP 7: VEN TABLES SPECIFIC CHECK ===\n');

        const venTables = ['DSED.VEN', 'DSED.VEN1', 'DSED.VENL1', 'DSEDAC.VEN', 'DSEDAC.VEN1', 'DSEDAC.VENL1',
            'DSED.VENDEDOR', 'DSEDAC.VENDEDOR', 'DSED.VENDEDORES', 'DSEDAC.VENDEDORES'];

        for (const tableName of venTables) {
            try {
                const data = await conn.query(`SELECT * FROM ${tableName} FETCH FIRST 20 ROWS ONLY`);
                if (data.length > 0) {
                    console.log(`\n*** FOUND: ${tableName} ***`);
                    console.log(`Columns: ${Object.keys(data[0]).join(', ')}`);
                    console.log(`Data:`, JSON.stringify(data, null, 2));
                    results[tableName] = data;
                }
            } catch (e) {
                console.log(`${tableName}: not accessible`);
            }
        }

        // =========================================================================
        // SAVE RESULTS
        // =========================================================================
        console.log('\n=== SAVING RESULTS ===\n');

        fs.writeFileSync('thorough_vendedor_search.json', JSON.stringify(results, null, 2));
        console.log('Results saved to thorough_vendedor_search.json');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await conn.close();
    }
}

deepVendedorExploration().catch(console.error);
