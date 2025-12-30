/**
 * EXHAUSTIVE DB2 DATABASE EXPLORER
 * ==================================
 * This script explores every table, column, and sample data in the DB2 database.
 * Run: node db_explorer_full.js > db_report.txt
 */

const odbc = require('odbc');
const fs = require('fs');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

// Schemas to explore
const SCHEMAS_TO_CHECK = ['DSEDAC', 'JAVIER', 'SYSIBM', 'SYSCAT'];

async function exploreDatabase() {
    let conn;
    const report = [];

    const log = (msg) => {
        console.log(msg);
        report.push(msg);
    };

    try {
        conn = await odbc.connect(DB_CONFIG);
        log('='.repeat(100));
        log('EXHAUSTIVE DB2 DATABASE EXPLORATION REPORT');
        log('Generated: ' + new Date().toISOString());
        log('='.repeat(100));
        log('');

        // =====================================================================
        // PART 1: GET ALL SCHEMAS
        // =====================================================================
        log('\n' + '█'.repeat(100));
        log('PART 1: ALL SCHEMAS IN DATABASE');
        log('█'.repeat(100));

        try {
            const schemas = await conn.query(`
        SELECT DISTINCT TABSCHEMA as schema_name, COUNT(*) as table_count
        FROM SYSCAT.TABLES 
        WHERE TABSCHEMA NOT LIKE 'SYS%' AND TABSCHEMA NOT LIKE 'Q%'
        GROUP BY TABSCHEMA
        ORDER BY table_count DESC
      `);

            log('\nSchemas found (excluding system schemas):');
            for (const s of schemas) {
                log(`  - ${s.SCHEMA_NAME}: ${s.TABLE_COUNT} tables`);
            }
        } catch (e) {
            log(`Schema query failed, trying alternative: ${e.message}`);
        }

        // =====================================================================
        // PART 2: ALL TABLES IN DSEDAC SCHEMA
        // =====================================================================
        log('\n' + '█'.repeat(100));
        log('PART 2: ALL TABLES IN DSEDAC SCHEMA');
        log('█'.repeat(100));

        let allTables = [];
        try {
            allTables = await conn.query(`
        SELECT TABNAME as table_name, TABSCHEMA as schema_name, TYPE as table_type,
               CARD as row_count
        FROM SYSCAT.TABLES 
        WHERE TABSCHEMA = 'DSEDAC'
        ORDER BY TABNAME
      `);

            log(`\nFound ${allTables.length} tables in DSEDAC:\n`);
            log('TABLE NAME'.padEnd(40) + 'TYPE'.padEnd(10) + 'APPROX ROWS');
            log('-'.repeat(70));

            for (const t of allTables) {
                log(`${(t.TABLE_NAME || '?').padEnd(40)}${(t.TABLE_TYPE || 'T').padEnd(10)}${t.ROW_COUNT || '?'}`);
            }
        } catch (e) {
            log(`Table list query failed: ${e.message}`);
            // Try alternative method
            try {
                allTables = await conn.query(`SELECT DISTINCT CREATOR as schema_name, NAME as table_name FROM SYSIBM.SYSTABLES WHERE CREATOR = 'DSEDAC'`);
                log(`\nAlternative query found ${allTables.length} tables`);
            } catch (e2) {
                log(`Alternative also failed: ${e2.message}`);
            }
        }

        // =====================================================================
        // PART 3: DETAILED INFO FOR EACH TABLE
        // =====================================================================
        log('\n' + '█'.repeat(100));
        log('PART 3: TABLE DETAILS (COLUMNS, SAMPLE DATA)');
        log('█'.repeat(100));

        // Tables of interest for sales app
        const priorityTables = [
            'LINDTO', 'LINDTO2024', 'LINDTO2023', 'LINDTO_HIST', 'LINDTOHIST',
            'CABDTO', 'CABDTO2024', 'CLI', 'ART', 'VDC', 'VDDX', 'RUT',
            'APPUSUARIOS', 'CVC', 'CVCHIST', 'DTOHIST', 'VENTAS', 'HISTORICO'
        ];

        // Get actual table list
        const tableNames = allTables.map(t => t.TABLE_NAME || t.table_name);

        // Check priority tables first
        for (const tableName of priorityTables) {
            if (tableNames.includes(tableName)) {
                await exploreTable(conn, 'DSEDAC', tableName, log);
            }
        }

        // Then check all other tables
        for (const t of allTables) {
            const tableName = t.TABLE_NAME || t.table_name;
            if (!priorityTables.includes(tableName)) {
                await exploreTable(conn, 'DSEDAC', tableName, log);
            }
        }

        // =====================================================================
        // PART 4: SEARCH FOR SALES/HISTORICAL DATA PATTERNS
        // =====================================================================
        log('\n' + '█'.repeat(100));
        log('PART 4: SEARCHING FOR HISTORICAL SALES DATA');
        log('█'.repeat(100));

        // Search for tables with YEAR columns
        try {
            const tablesWithYear = await conn.query(`
        SELECT TABNAME as table_name, COLNAME as column_name
        FROM SYSCAT.COLUMNS
        WHERE TABSCHEMA = 'DSEDAC' 
          AND (COLNAME LIKE '%ANO%' OR COLNAME LIKE '%YEAR%' OR COLNAME LIKE '%FECHA%' OR COLNAME LIKE '%DATE%')
        ORDER BY TABNAME, COLNAME
      `);

            log('\nTables with date/year columns:');
            const grouped = {};
            for (const row of tablesWithYear) {
                if (!grouped[row.TABLE_NAME]) grouped[row.TABLE_NAME] = [];
                grouped[row.TABLE_NAME].push(row.COLUMN_NAME);
            }
            for (const [table, cols] of Object.entries(grouped)) {
                log(`  ${table}: ${cols.join(', ')}`);
            }
        } catch (e) {
            log(`Year column search failed: ${e.message}`);
        }

        // =====================================================================
        // PART 5: CHECK DATA RANGES IN KEY TABLES
        // =====================================================================
        log('\n' + '█'.repeat(100));
        log('PART 5: DATA RANGES IN KEY TABLES');
        log('█'.repeat(100));

        // List of tables to check for date ranges
        const tablesToCheckDates = ['LINDTO', 'CABDTO', 'CVC', 'RUT'];

        for (const tableName of tablesToCheckDates) {
            try {
                // First check if table exists
                const exists = await conn.query(`SELECT COUNT(*) as cnt FROM DSEDAC.${tableName} FETCH FIRST 1 ROWS ONLY`);
                if (exists) {
                    log(`\n--- ${tableName} Date Range ---`);

                    // Try to find year column
                    const yearCols = ['ANODOCUMENTO', 'ANO', 'YEAR', 'FECHA'];
                    for (const col of yearCols) {
                        try {
                            const range = await conn.query(`
                SELECT MIN(${col}) as min_val, MAX(${col}) as max_val, COUNT(*) as total
                FROM DSEDAC.${tableName}
              `);
                            if (range[0]) {
                                log(`  ${col}: MIN=${range[0].MIN_VAL}, MAX=${range[0].MAX_VAL}, TOTAL=${range[0].TOTAL}`);
                            }
                        } catch (e) {
                            // Column doesn't exist, skip
                        }
                    }
                }
            } catch (e) {
                log(`  Table ${tableName} not found or error: ${e.message.substring(0, 50)}`);
            }
        }

        // =====================================================================
        // PART 6: FIND ALL TABLES WITH SIGNIFICANT DATA
        // =====================================================================
        log('\n' + '█'.repeat(100));
        log('PART 6: TABLES SORTED BY ROW COUNT (ACTUAL COUNT)');
        log('█'.repeat(100));

        const tableCounts = [];
        for (const t of allTables.slice(0, 50)) { // Limit to first 50 to avoid timeout
            const tableName = t.TABLE_NAME || t.table_name;
            try {
                const count = await conn.query(`SELECT COUNT(*) as cnt FROM DSEDAC.${tableName}`);
                tableCounts.push({ table: tableName, count: count[0]?.CNT || 0 });
            } catch (e) {
                tableCounts.push({ table: tableName, count: 'ERROR' });
            }
        }

        tableCounts.sort((a, b) => (b.count || 0) - (a.count || 0));
        log('\nTop tables by row count:');
        log('TABLE'.padEnd(40) + 'ROW COUNT');
        log('-'.repeat(55));
        for (const t of tableCounts.slice(0, 30)) {
            log(`${t.table.padEnd(40)}${t.count}`);
        }

        // =====================================================================
        // PART 7: VENDEDOR DATA ANALYSIS
        // =====================================================================
        log('\n' + '█'.repeat(100));
        log('PART 7: VENDEDOR (SALESPERSON) DATA ANALYSIS');
        log('█'.repeat(100));

        try {
            const vendedores = await conn.query(`
        SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, X.JEFEVENTASSN, X.CORREOELECTRONICO
        FROM DSEDAC.VDC V
        LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
        WHERE V.SUBEMPRESA = 'GMP'
        ORDER BY V.CODIGOVENDEDOR
      `);

            log(`\nFound ${vendedores.length} vendedores in GMP:`);
            log('\nCODE'.padEnd(10) + 'TYPE'.padEnd(8) + 'JEFE?'.padEnd(8) + 'EMAIL');
            log('-'.repeat(80));
            for (const v of vendedores.slice(0, 20)) {
                log(
                    (v.CODIGOVENDEDOR?.trim() || '-').padEnd(10) +
                    (v.TIPOVENDEDOR?.trim() || '-').padEnd(8) +
                    (v.JEFEVENTASSN === 'S' ? 'YES' : 'NO').padEnd(8) +
                    (v.CORREOELECTRONICO?.trim() || '-')
                );
            }
        } catch (e) {
            log(`Vendedor query failed: ${e.message}`);
        }

        // =====================================================================
        // PART 8: LOOK FOR ALTERNATIVE SALES TABLES
        // =====================================================================
        log('\n' + '█'.repeat(100));
        log('PART 8: SEARCH FOR ALTERNATIVE SALES/INVOICE TABLES');
        log('█'.repeat(100));

        const salesKeywords = ['VENTA', 'FACTURA', 'PEDIDO', 'ALBARAN', 'INVOICE', 'ORDER', 'HIST'];
        try {
            const salesTables = await conn.query(`
        SELECT TABNAME as table_name
        FROM SYSCAT.TABLES 
        WHERE TABSCHEMA = 'DSEDAC'
        ORDER BY TABNAME
      `);

            log('\nPotential sales-related tables:');
            for (const t of salesTables) {
                const name = t.TABLE_NAME || '';
                for (const kw of salesKeywords) {
                    if (name.toUpperCase().includes(kw)) {
                        log(`  - ${name}`);
                        break;
                    }
                }
            }
        } catch (e) {
            log(`Sales table search failed: ${e.message}`);
        }

        // Write full report to file
        fs.writeFileSync('db_full_report.txt', report.join('\n'), 'utf8');
        log('\n\n' + '='.repeat(100));
        log('REPORT SAVED TO: db_full_report.txt');
        log('='.repeat(100));

    } catch (error) {
        log(`\n\nFATAL ERROR: ${error.message}`);
        log(error.stack);
    } finally {
        if (conn) await conn.close();
    }
}

async function exploreTable(conn, schema, tableName, log) {
    log('\n' + '-'.repeat(80));
    log(`TABLE: ${schema}.${tableName}`);
    log('-'.repeat(80));

    try {
        // Get columns
        let columns = [];
        try {
            columns = await conn.query(`
        SELECT COLNAME as name, TYPENAME as type, LENGTH as length, SCALE as scale, NULLS as nullable
        FROM SYSCAT.COLUMNS
        WHERE TABSCHEMA = '${schema}' AND TABNAME = '${tableName}'
        ORDER BY COLNO
      `);
        } catch (e) {
            // Try alternative
            columns = await conn.query(`
        SELECT NAME as name, COLTYPE as type, LENGTH as length
        FROM SYSIBM.SYSCOLUMNS
        WHERE TBNAME = '${tableName}' AND TBCREATOR = '${schema}'
        ORDER BY COLNO
      `);
        }

        if (columns.length > 0) {
            log('\nColumns:');
            log('  ' + 'COLUMN NAME'.padEnd(30) + 'TYPE'.padEnd(15) + 'LENGTH'.padEnd(10) + 'NULLABLE');
            log('  ' + '-'.repeat(65));
            for (const col of columns) {
                const name = col.NAME || col.name || '?';
                const type = col.TYPE || col.type || '?';
                const len = col.LENGTH || col.length || '';
                const nullable = col.NULLABLE === 'Y' ? 'YES' : 'NO';
                log(`  ${name.padEnd(30)}${type.padEnd(15)}${String(len).padEnd(10)}${nullable}`);
            }
        }

        // Get row count
        const countResult = await conn.query(`SELECT COUNT(*) as cnt FROM ${schema}.${tableName}`);
        const rowCount = countResult[0]?.CNT || 0;
        log(`\nTotal rows: ${rowCount}`);

        // If table has data, show sample
        if (rowCount > 0) {
            log('\nSample data (first 3 rows):');
            const sample = await conn.query(`SELECT * FROM ${schema}.${tableName} FETCH FIRST 3 ROWS ONLY`);
            for (let i = 0; i < sample.length; i++) {
                log(`  Row ${i + 1}:`);
                const row = sample[i];
                for (const [key, val] of Object.entries(row)) {
                    const value = val === null ? 'NULL' : String(val).substring(0, 50);
                    log(`    ${key}: ${value}`);
                }
            }

            // Check for year/date columns and show range
            const yearCols = columns.filter(c => {
                const name = (c.NAME || c.name || '').toUpperCase();
                return name.includes('ANO') || name.includes('YEAR') || name.includes('FECHA') || name.includes('MES');
            });

            if (yearCols.length > 0) {
                log('\nDate/Year column ranges:');
                for (const col of yearCols) {
                    const colName = col.NAME || col.name;
                    try {
                        const range = await conn.query(`
              SELECT MIN(${colName}) as min_val, MAX(${colName}) as max_val
              FROM ${schema}.${tableName}
            `);
                        log(`  ${colName}: MIN=${range[0]?.MIN_VAL}, MAX=${range[0]?.MAX_VAL}`);
                    } catch (e) {
                        // Skip if error
                    }
                }
            }
        }

    } catch (e) {
        log(`  ERROR exploring table: ${e.message}`);
    }
}

// Run
exploreDatabase().then(() => {
    console.log('\n\nExploration complete!');
}).catch(err => {
    console.error('Fatal error:', err);
});
