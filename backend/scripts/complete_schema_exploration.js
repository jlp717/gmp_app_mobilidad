/**
 * COMPLETE DATABASE EXPLORATION SCRIPT
 * Finds ALL tables related to employees, vendedores, comerciales
 * Discovers the link between user codes (GOYO) and vendedor codes (02, 93)
 * No mocks - Real DB queries only
 */

const odbc = require('odbc');
const fs = require('fs');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function exploreCompleteSchema() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     COMPLETE DATABASE SCHEMA EXPLORATION                     ║');
    console.log('║     Finding ALL employee/vendedor/comercial tables           ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const conn = await odbc.connect(DB_CONFIG);
    const results = {
        timestamp: new Date().toISOString(),
        employeeTables: [],
        vendedorInfo: {},
        userVendedorMapping: {},
        hierarchyInfo: {},
        allRelevantTables: []
    };

    try {
        // =========================================================================
        // STEP 1: Find ALL tables that might contain employee/vendedor info
        // =========================================================================
        console.log('=== STEP 1: Finding employee/vendedor related tables ===\n');

        const employeeKeywords = [
            'EMP', 'VEN', 'COM', 'USU', 'TRA', 'PER', 'AGE',
            'EMPLEADO', 'VENDEDOR', 'COMERCIAL', 'USUARIO', 'TRABAJADOR', 'PERSONAL', 'AGENTE'
        ];

        for (const keyword of employeeKeywords) {
            try {
                const tables = await conn.query(`
          SELECT TABNAME, TABSCHEMA 
          FROM SYSCAT.TABLES 
          WHERE TABSCHEMA = 'DSEDAC' 
            AND UPPER(TABNAME) LIKE '%${keyword}%'
          ORDER BY TABNAME
        `);

                if (tables.length > 0) {
                    console.log(`Found ${tables.length} tables matching '${keyword}':`);
                    for (const t of tables) {
                        console.log(`  - ${t.TABSCHEMA}.${t.TABNAME}`);
                        results.allRelevantTables.push(`${t.TABSCHEMA}.${t.TABNAME}`);
                    }
                }
            } catch (e) {
                // Skip errors
            }
        }

        // =========================================================================
        // STEP 2: Get columns from APPUSUARIOS in detail
        // =========================================================================
        console.log('\n=== STEP 2: APPUSUARIOS structure ===\n');

        try {
            const appUsuariosData = await conn.query(`SELECT * FROM DSEDAC.APPUSUARIOS FETCH FIRST 20 ROWS ONLY`);
            console.log('APPUSUARIOS sample:');
            console.log(JSON.stringify(appUsuariosData, null, 2));
            results.employeeTables.push({
                name: 'DSEDAC.APPUSUARIOS',
                data: appUsuariosData,
                columns: appUsuariosData.length > 0 ? Object.keys(appUsuariosData[0]) : []
            });
        } catch (e) {
            console.log('Error querying APPUSUARIOS:', e.message);
        }

        // =========================================================================
        // STEP 3: Find GOYO in different tables
        // =========================================================================
        console.log('\n=== STEP 3: Finding GOYO in all possible tables ===\n');

        const tablesToSearchForGoyo = [
            'DSEDAC.APPUSUARIOS',
            'DSEDAC.VEN', 'DSEDAC.VEN1', 'DSEDAC.VENL1',
            'DSEDAC.EMP', 'DSEDAC.EMPL1', 'DSEDAC.EMP1',
            'DSEDAC.COM', 'DSEDAC.COML1',
            'DSEDAC.USR', 'DSEDAC.USU',
            'DSEDAC.AGE', 'DSEDAC.AGEL1',
            'DSEDAC.TRA', 'DSEDAC.TRAL1',
            'DSEDAC.REP', 'DSEDAC.REPL1',
            'DSEDAC.CLI', // Maybe comerciales are in clients?
        ];

        for (const table of tablesToSearchForGoyo) {
            try {
                // First get column names
                const sample = await conn.query(`SELECT * FROM ${table} FETCH FIRST 1 ROWS ONLY`);
                if (sample.length > 0) {
                    const columns = Object.keys(sample[0]);
                    console.log(`\n${table} columns: ${columns.join(', ')}`);

                    // Search for GOYO in text columns
                    for (const col of columns) {
                        if (typeof sample[0][col] === 'string' || col.includes('CODIGO') || col.includes('NOMBRE')) {
                            try {
                                const goyoSearch = await conn.query(`
                  SELECT * FROM ${table} 
                  WHERE UPPER(TRIM(CAST(${col} AS VARCHAR(100)))) LIKE '%GOYO%'
                  FETCH FIRST 5 ROWS ONLY
                `);
                                if (goyoSearch.length > 0) {
                                    console.log(`*** FOUND GOYO in ${table}.${col}! ***`);
                                    console.log(JSON.stringify(goyoSearch, null, 2));
                                    results.userVendedorMapping[`${table}.${col}`] = goyoSearch;
                                }
                            } catch (e) {
                                // Column might not be searchable
                            }
                        }
                    }
                }
            } catch (e) {
                // Table doesn't exist or not accessible
            }
        }

        // =========================================================================
        // STEP 4: Get ALL unique vendedor codes from LINDTO
        // =========================================================================
        console.log('\n=== STEP 4: ALL vendedor codes from LINDTO ===\n');

        try {
            const vendedores = await conn.query(`
        SELECT DISTINCT 
          CODIGOVENDEDOR,
          CODIGOCOMERCIAL,
          CODIGOPROMOTORPREVENTA
        FROM DSEDAC.LINDTO
        WHERE ANODOCUMENTO >= 2024
        GROUP BY CODIGOVENDEDOR, CODIGOCOMERCIAL, CODIGOPROMOTORPREVENTA
        ORDER BY CODIGOVENDEDOR
        FETCH FIRST 50 ROWS ONLY
      `);
            console.log('Unique vendedor/comercial codes in LINDTO:');
            console.log(JSON.stringify(vendedores, null, 2));
            results.vendedorInfo.lindtoCodes = vendedores;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // STEP 5: Look for VEN table with vendedor master data
        // =========================================================================
        console.log('\n=== STEP 5: Exploring VEN (vendedor) table ===\n');

        try {
            const venData = await conn.query(`SELECT * FROM DSEDAC.VEN FETCH FIRST 20 ROWS ONLY`);
            console.log('DSEDAC.VEN data:');
            console.log(JSON.stringify(venData, null, 2));
            results.vendedorInfo.venTable = venData;
        } catch (e) {
            console.log('DSEDAC.VEN not accessible:', e.message);
        }

        // =========================================================================
        // STEP 6: Look for EMP table with employee data
        // =========================================================================
        console.log('\n=== STEP 6: Exploring EMP (empleados) table ===\n');

        try {
            const empData = await conn.query(`SELECT * FROM DSEDAC.EMP FETCH FIRST 20 ROWS ONLY`);
            console.log('DSEDAC.EMP data:');
            console.log(JSON.stringify(empData, null, 2));
            results.employeeTables.push({
                name: 'DSEDAC.EMP',
                data: empData,
                columns: empData.length > 0 ? Object.keys(empData[0]) : []
            });
        } catch (e) {
            console.log('DSEDAC.EMP not accessible:', e.message);
        }

        // =========================================================================
        // STEP 7: Find hierarchy/role columns
        // =========================================================================
        console.log('\n=== STEP 7: Finding hierarchy/role information ===\n');

        const hierarchyKeywords = ['CARGO', 'ROL', 'PUESTO', 'CATEGORIA', 'NIVEL', 'JERARQUIA', 'TIPO', 'GRUPO'];

        for (const table of ['DSEDAC.APPUSUARIOS', 'DSEDAC.EMP', 'DSEDAC.VEN']) {
            try {
                const sample = await conn.query(`SELECT * FROM ${table} FETCH FIRST 1 ROWS ONLY`);
                if (sample.length > 0) {
                    const columns = Object.keys(sample[0]);
                    const hierarchyCols = columns.filter(c =>
                        hierarchyKeywords.some(k => c.toUpperCase().includes(k))
                    );
                    if (hierarchyCols.length > 0) {
                        console.log(`${table} has hierarchy columns: ${hierarchyCols.join(', ')}`);

                        // Get unique values
                        for (const col of hierarchyCols) {
                            try {
                                const values = await conn.query(`
                  SELECT DISTINCT ${col}, COUNT(*) as CNT 
                  FROM ${table} 
                  GROUP BY ${col}
                  ORDER BY CNT DESC
                `);
                                console.log(`  ${col} values:`, JSON.stringify(values));
                                results.hierarchyInfo[`${table}.${col}`] = values;
                            } catch (e) { }
                        }
                    }
                }
            } catch (e) { }
        }

        // =========================================================================
        // STEP 8: Explore DSEDAC.VENL1 and similar lookup tables
        // =========================================================================
        console.log('\n=== STEP 8: Exploring vendedor lookup tables ===\n');

        const vendedorLookupTables = ['VENL1', 'VEN1', 'VENDEDOR', 'VENDEDORES', 'COMERCIAL', 'COMERCIALES'];

        for (const tableName of vendedorLookupTables) {
            try {
                const data = await conn.query(`SELECT * FROM DSEDAC.${tableName} FETCH FIRST 30 ROWS ONLY`);
                if (data.length > 0) {
                    console.log(`\nDSEDAC.${tableName} (${data.length} rows):`);
                    console.log('Columns:', Object.keys(data[0]).join(', '));
                    console.log('Sample data:', JSON.stringify(data.slice(0, 5), null, 2));
                    results.vendedorInfo[`DSEDAC.${tableName}`] = data;
                }
            } catch (e) {
                console.log(`DSEDAC.${tableName}: not accessible`);
            }
        }

        // =========================================================================
        // STEP 9: Check if there's a relationship between APPUSUARIOS.CODIGOUSUARIO
        // and the vendedor codes in LINDTO
        // =========================================================================
        console.log('\n=== STEP 9: Checking APPUSUARIOS -> LINDTO relationship ===\n');

        try {
            const users = await conn.query(`SELECT CODIGOUSUARIO, NOMBREUSUARIO FROM DSEDAC.APPUSUARIOS`);

            for (const user of users.slice(0, 15)) {
                const code = (user.CODIGOUSUARIO || '').trim();
                const name = (user.NOMBREUSUARIO || '').trim();

                // Check if this code exists as vendedor in LINDTO
                const asVendedor = await conn.query(`
          SELECT COUNT(*) as CNT FROM DSEDAC.LINDTO 
          WHERE TRIM(CODIGOVENDEDOR) = '${code}' 
             OR TRIM(CODIGOCOMERCIAL) = '${code}'
        `);

                // Check if this name exists somewhere
                const asComercial = await conn.query(`
          SELECT COUNT(*) as CNT FROM DSEDAC.LINDTO 
          WHERE TRIM(CODIGOVENDEDOR) LIKE '%${name.substring(0, 3)}%' 
             OR TRIM(CODIGOCOMERCIAL) LIKE '%${name.substring(0, 3)}%'
        `);

                const vendedorCount = asVendedor[0]?.CNT || 0;
                const comercialCount = asComercial[0]?.CNT || 0;

                console.log(`User: ${code} (${name}) -> Vendedor sales: ${vendedorCount}, Comercial match: ${comercialCount}`);

                results.userVendedorMapping[code] = {
                    name,
                    vendedorSales: vendedorCount,
                    comercialMatch: comercialCount
                };
            }
        } catch (e) {
            console.log('Error:', e.message);
        }

        // =========================================================================
        // STEP 10: Save complete results
        // =========================================================================
        console.log('\n=== SAVING COMPLETE EXPLORATION RESULTS ===\n');

        fs.writeFileSync('complete_schema_exploration.json', JSON.stringify(results, null, 2));
        console.log('Results saved to complete_schema_exploration.json');

    } catch (error) {
        console.error('Exploration error:', error);
    } finally {
        await conn.close();
    }
}

exploreCompleteSchema().catch(console.error);
