/**
 * AS400/iSeries VENDEDOR TABLE SEARCH
 * Using QSYS2 system views for iSeries
 */

const odbc = require('odbc');
const fs = require('fs');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function findVendedorTable() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     AS400/iSeries VENDEDOR TABLE SEARCH                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const conn = await odbc.connect(DB_CONFIG);
    const results = {};

    try {
        // =========================================================================
        // STEP 1: List ALL tables in DSEDAC using QSYS2.SYSTABLES
        // =========================================================================
        console.log('=== ALL DSEDAC TABLES ===\n');

        const allTables = await conn.query(`
      SELECT TABLE_NAME, TABLE_TEXT
      FROM QSYS2.SYSTABLES 
      WHERE TABLE_SCHEMA = 'DSEDAC' 
        AND TABLE_TYPE = 'T'
      ORDER BY TABLE_NAME
    `);

        const tableNames = allTables.map(t => `${t.TABLE_NAME}: ${(t.TABLE_TEXT || '').trim()}`);
        console.log(`Found ${tableNames.length} tables`);

        // Look for vendedor/employee related tables by name or description
        const vendedorTables = allTables.filter(t => {
            const name = (t.TABLE_NAME || '').toUpperCase();
            const text = (t.TABLE_TEXT || '').toUpperCase();
            return name.includes('VEN') || name.includes('EMP') || name.includes('COM') ||
                name.includes('REP') || name.includes('AGE') || name.includes('TRA') ||
                text.includes('VENDEDOR') || text.includes('COMERCIAL') || text.includes('EMPLEADO');
        });

        console.log('\nPotential vendedor/employee tables:');
        for (const t of vendedorTables) {
            console.log(`  ${t.TABLE_NAME}: ${(t.TABLE_TEXT || '').trim()}`);
        }
        results.vendedorRelatedTables = vendedorTables;

        // =========================================================================
        // STEP 2: Try each vendedor-related table
        // =========================================================================
        console.log('\n=== EXPLORING VENDEDOR-RELATED TABLES ===\n');

        for (const table of vendedorTables) {
            const tableName = table.TABLE_NAME;
            try {
                const data = await conn.query(`SELECT * FROM DSEDAC.${tableName} FETCH FIRST 10 ROWS ONLY`);
                if (data.length > 0) {
                    const columns = Object.keys(data[0]);
                    console.log(`\n${tableName} (${table.TABLE_TEXT || 'no description'}):`);
                    console.log(`  Columns: ${columns.join(', ')}`);

                    // Look for code and name columns
                    const hasCode = columns.some(c => c.includes('CODIGO'));
                    const hasName = columns.some(c => c.includes('NOMBRE') || c.includes('DESCRIPCION'));

                    if (hasCode && hasName) {
                        console.log('  *** HAS CODE + NAME COLUMNS - POTENTIAL MASTER TABLE ***');
                        console.log('  Sample data:', JSON.stringify(data.slice(0, 3), null, 2));
                        results[tableName] = { columns, data: data.slice(0, 5), description: table.TABLE_TEXT };
                    }
                }
            } catch (e) {
                console.log(`  ${tableName}: not accessible (${e.message})`);
            }
        }

        // =========================================================================
        // STEP 3: Find columns that might link APPUSUARIOS to LINDTO
        // =========================================================================
        console.log('\n=== FINDING LINKING COLUMNS ===\n');

        // Check if APPUSUARIOS or another table has a CODIGOVENDEDOR column
        try {
            const vendedorColumns = await conn.query(`
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TEXT
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC'
          AND (COLUMN_NAME LIKE '%VENDEDOR%' 
               OR COLUMN_NAME LIKE '%COMERCIAL%'
               OR COLUMN_TEXT LIKE '%VENDEDOR%')
        ORDER BY TABLE_NAME
      `);

            console.log('Tables with VENDEDOR/COMERCIAL columns:');
            for (const col of vendedorColumns) {
                console.log(`  ${col.TABLE_NAME}.${col.COLUMN_NAME}: ${col.COLUMN_TEXT || ''}`);
            }
            results.vendedorColumns = vendedorColumns;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // STEP 4: Check specific tables mentioned in LINEA (LIN) tables
        // =========================================================================
        console.log('\n=== CHECKING TAR (TARIFA) TABLE ===\n');

        // Sometimes tarifa tables have vendedor assignments
        try {
            const tarData = await conn.query(`SELECT * FROM DSEDAC.TAR FETCH FIRST 5 ROWS ONLY`);
            if (tarData.length > 0) {
                console.log('TAR columns:', Object.keys(tarData[0]).join(', '));
                console.log('Sample:', JSON.stringify(tarData.slice(0, 2), null, 2));
                results.TAR = tarData;
            }
        } catch (e) {
            console.log('TAR not accessible');
        }

        // =========================================================================
        // STEP 5: Check RUT (rutas) table for vendedor assignments
        // =========================================================================
        console.log('\n=== CHECKING RUT (RUTAS) TABLE ===\n');

        try {
            const rutData = await conn.query(`SELECT * FROM DSEDAC.RUT FETCH FIRST 20 ROWS ONLY`);
            if (rutData.length > 0) {
                console.log('RUT columns:', Object.keys(rutData[0]).join(', '));
                console.log('Sample:', JSON.stringify(rutData.slice(0, 5), null, 2));
                results.RUT = rutData;

                // Check if routes are assigned to vendedores
                const columns = Object.keys(rutData[0]);
                if (columns.some(c => c.includes('VENDEDOR') || c.includes('COMERCIAL'))) {
                    console.log('*** RUT has vendedor assignments! ***');
                }
            }
        } catch (e) {
            console.log('RUT not accessible');
        }

        // =========================================================================
        // STEP 6: Check if there's a pattern in LINDTO vendedor codes
        // =========================================================================
        console.log('\n=== ANALYZING LINDTO VENDEDOR CODES ===\n');

        try {
            // Get all vendedor codes with sales counts
            const vendedorStats = await conn.query(`
        SELECT 
          CODIGOVENDEDOR,
          COUNT(*) as TOTAL_LINES,
          SUM(IMPORTEVENTA) as TOTAL_EUROS,
          COUNT(DISTINCT CODIGOCLIENTEALBARAN) as TOTAL_CLIENTS,
          MIN(ANODOCUMENTO * 10000 + MESDOCUMENTO * 100 + DIADOCUMENTO) as FIRST_SALE,
          MAX(ANODOCUMENTO * 10000 + MESDOCUMENTO * 100 + DIADOCUMENTO) as LAST_SALE
        FROM DSEDAC.LINDTO
        WHERE ANODOCUMENTO >= 2024
        GROUP BY CODIGOVENDEDOR
        ORDER BY TOTAL_EUROS DESC
      `);

            console.log('Vendedor statistics:');
            console.log(JSON.stringify(vendedorStats, null, 2));
            results.vendedorStats = vendedorStats;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // STEP 7: Check DSED schema specifically (not DSEDAC)
        // =========================================================================
        console.log('\n=== CHECKING DSED SCHEMA ===\n');

        try {
            const dsedTables = await conn.query(`
        SELECT TABLE_NAME, TABLE_TEXT
        FROM QSYS2.SYSTABLES 
        WHERE TABLE_SCHEMA = 'DSED' 
          AND TABLE_TYPE = 'T'
          AND (TABLE_NAME LIKE '%VEN%' OR TABLE_NAME LIKE '%EMP%' OR TABLE_NAME LIKE '%COM%')
        ORDER BY TABLE_NAME
      `);

            console.log('DSED vendedor-related tables:');
            for (const t of dsedTables) {
                console.log(`  ${t.TABLE_NAME}: ${(t.TABLE_TEXT || '').trim()}`);

                try {
                    const data = await conn.query(`SELECT * FROM DSED.${t.TABLE_NAME} FETCH FIRST 5 ROWS ONLY`);
                    if (data.length > 0) {
                        console.log(`    Columns: ${Object.keys(data[0]).join(', ')}`);
                        console.log(`    Sample:`, JSON.stringify(data.slice(0, 2), null, 2));
                        results[`DSED.${t.TABLE_NAME}`] = data;
                    }
                } catch (e) {
                    console.log(`    Not accessible`);
                }
            }
        } catch (e) {
            console.log('Error querying DSED:', e.message);
        }

        // =========================================================================
        // SAVE RESULTS
        // =========================================================================
        console.log('\n=== SAVING RESULTS ===\n');

        fs.writeFileSync('iseries_vendedor_search.json', JSON.stringify(results, null, 2));
        console.log('Results saved to iseries_vendedor_search.json');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await conn.close();
    }
}

findVendedorTable().catch(console.error);
