/**
 * DEEP VENDEDOR TABLE SEARCH
 * Find the table that maps vendedor names to codes
 */

const odbc = require('odbc');
const fs = require('fs');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function findVendedorMasterTable() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     DEEP VENDEDOR TABLE SEARCH                               ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const conn = await odbc.connect(DB_CONFIG);
    const results = {};

    try {
        // =========================================================================
        // STEP 1: List ALL tables in DSEDAC schema
        // =========================================================================
        console.log('=== ALL DSEDAC TABLES (first 200) ===\n');

        const allTables = await conn.query(`
      SELECT TABNAME FROM SYSCAT.TABLES 
      WHERE TABSCHEMA = 'DSEDAC' 
      ORDER BY TABNAME
      FETCH FIRST 200 ROWS ONLY
    `);

        const tableNames = allTables.map(t => t.TABNAME);
        console.log(`Found ${tableNames.length} tables:`, tableNames.join(', '));
        results.allTables = tableNames;

        // =========================================================================
        // STEP 2: Check specific potential vendedor tables
        // =========================================================================
        console.log('\n=== CHECKING POTENTIAL VENDEDOR MASTER TABLES ===\n');

        const potentialTables = [
            'VENL1', 'VEN1', 'VENS', 'REP', 'REPL1', 'COM', 'COML1',
            'TRA', 'TRAL1', 'AGE', 'AGEL1', 'EMP', 'EMPL1', 'EMP1',
            'CVC', 'CVA', 'TAR', 'TARL1', // Tariff/price lists might have vendedor info
            'DEL', 'DELL1', // Delegaciones
            'ALM', 'ALML1', // Almacenes
            'RUT', 'RUTL1', // Rutas
            'ZON', 'ZONL1', // Zonas
        ];

        for (const tableName of potentialTables) {
            const fullName = `DSEDAC.${tableName}`;
            try {
                const data = await conn.query(`SELECT * FROM ${fullName} FETCH FIRST 5 ROWS ONLY`);
                if (data.length > 0) {
                    const columns = Object.keys(data[0]);
                    console.log(`\n${fullName}:`);
                    console.log(`  Columns: ${columns.join(', ')}`);

                    // Check if any column might be vendedor name
                    const nameColumns = columns.filter(c =>
                        c.includes('NOMBRE') || c.includes('DESCRIPCION') || c.includes('DENOMINACION')
                    );
                    const codeColumns = columns.filter(c =>
                        c.includes('CODIGO') && !c.includes('CLIENTE')
                    );

                    if (nameColumns.length > 0 || codeColumns.length > 0) {
                        console.log(`  Potential name columns: ${nameColumns.join(', ')}`);
                        console.log(`  Potential code columns: ${codeColumns.join(', ')}`);
                        console.log(`  Sample:`, JSON.stringify(data.slice(0, 2), null, 2));
                        results[tableName] = { columns, data: data.slice(0, 5) };
                    }
                }
            } catch (e) {
                console.log(`${fullName}: not accessible`);
            }
        }

        // =========================================================================
        // STEP 3: Search in CAB/DOC tables for vendedor info
        // =========================================================================
        console.log('\n=== CHECKING DOCUMENT HEADERS FOR VENDEDOR INFO ===\n');

        const docTables = ['CAB', 'CABL1', 'DOC', 'DOCL1', 'PED', 'PEDL1', 'ALB', 'ALBL1'];

        for (const tableName of docTables) {
            const fullName = `DSEDAC.${tableName}`;
            try {
                const data = await conn.query(`SELECT * FROM ${fullName} FETCH FIRST 3 ROWS ONLY`);
                if (data.length > 0) {
                    const columns = Object.keys(data[0]);
                    const vendedorCols = columns.filter(c =>
                        c.includes('VENDEDOR') || c.includes('COMERCIAL') || c.includes('PROMO')
                    );

                    if (vendedorCols.length > 0) {
                        console.log(`${fullName} has vendedor columns: ${vendedorCols.join(', ')}`);
                    }
                }
            } catch (e) { }
        }

        // =========================================================================
        // STEP 4: Get ALL tables that have 'VENDEDOR' or 'COMERCIAL' columns
        // =========================================================================
        console.log('\n=== TABLES WITH VENDEDOR/COMERCIAL COLUMNS ===\n');

        try {
            const tablesWithVendedor = await conn.query(`
        SELECT DISTINCT TABNAME, COLNAME
        FROM SYSCAT.COLUMNS
        WHERE TABSCHEMA = 'DSEDAC'
          AND (COLNAME LIKE '%VENDEDOR%' OR COLNAME LIKE '%COMERCIAL%')
        ORDER BY TABNAME
      `);

            console.log('Tables with vendedor/comercial columns:');
            console.log(JSON.stringify(tablesWithVendedor, null, 2));
            results.tablesWithVendedorColumns = tablesWithVendedor;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // STEP 5: Check LINDTO more carefully - get vendedor names from somewhere
        // =========================================================================
        console.log('\n=== CHECKING LINDTO WITH CODIGODELEGACION ===\n');

        // Maybe delegacion can help us identify vendedores
        try {
            const delegaciones = await conn.query(`
        SELECT DISTINCT CODIGOVENDEDOR, CODIGODELEGACION, COUNT(*) as CNT
        FROM DSEDAC.LINDTO
        WHERE ANODOCUMENTO = 2025
        GROUP BY CODIGOVENDEDOR, CODIGODELEGACION
        ORDER BY CNT DESC
        FETCH FIRST 30 ROWS ONLY
      `);
            console.log('Vendedor + Delegacion combinations:');
            console.log(JSON.stringify(delegaciones, null, 2));
            results.vendedorDelegacion = delegaciones;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // STEP 6: Try to find vendedor master in DSED schema (not DSEDAC)
        // =========================================================================
        console.log('\n=== CHECKING DSED SCHEMA FOR VENDEDOR TABLES ===\n');

        try {
            const dsedTables = await conn.query(`
        SELECT TABNAME FROM SYSCAT.TABLES 
        WHERE TABSCHEMA = 'DSED' 
          AND (TABNAME LIKE '%VEN%' OR TABNAME LIKE '%EMP%' OR TABNAME LIKE '%COM%')
        ORDER BY TABNAME
        FETCH FIRST 20 ROWS ONLY
      `);

            console.log('DSED tables:', dsedTables.map(t => t.TABNAME).join(', '));

            for (const table of dsedTables) {
                try {
                    const data = await conn.query(`SELECT * FROM DSED.${table.TABNAME} FETCH FIRST 5 ROWS ONLY`);
                    if (data.length > 0) {
                        console.log(`\nDSED.${table.TABNAME}:`, Object.keys(data[0]).join(', '));
                        console.log('Sample:', JSON.stringify(data.slice(0, 2), null, 2));
                        results[`DSED.${table.TABNAME}`] = data.slice(0, 5);
                    }
                } catch (e) { }
            }
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // STEP 7: Check RUT table for route assignments (might link to vendedores)
        // =========================================================================
        console.log('\n=== CHECKING ROUTE (RUT) TABLE ===\n');

        try {
            const rutData = await conn.query(`SELECT * FROM DSEDAC.RUT FETCH FIRST 10 ROWS ONLY`);
            if (rutData.length > 0) {
                console.log('DSEDAC.RUT columns:', Object.keys(rutData[0]).join(', '));
                console.log('Sample:', JSON.stringify(rutData, null, 2));
                results.RUT = rutData;
            }
        } catch (e) {
            console.log('DSEDAC.RUT not accessible');
        }

        // =========================================================================
        // STEP 8: Try finding VENL1 (vendedor lookup) properly
        // =========================================================================
        console.log('\n=== TRYING VENDEDOR LOOKUP ALTERNATIVES ===\n');

        // Try to get column info from SYSCAT.COLUMNS for VEN* tables
        try {
            const venColumns = await conn.query(`
        SELECT TABNAME, COLNAME, TYPENAME, LENGTH
        FROM SYSCAT.COLUMNS
        WHERE TABSCHEMA = 'DSEDAC'
          AND TABNAME LIKE 'VEN%'
        ORDER BY TABNAME, COLNO
      `);

            console.log('VEN* table columns from catalog:');
            console.log(JSON.stringify(venColumns, null, 2));
            results.venTableColumns = venColumns;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // SAVE RESULTS
        // =========================================================================
        console.log('\n=== SAVING RESULTS ===\n');

        fs.writeFileSync('deep_vendedor_search.json', JSON.stringify(results, null, 2));
        console.log('Results saved to deep_vendedor_search.json');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await conn.close();
    }
}

findVendedorMasterTable().catch(console.error);
