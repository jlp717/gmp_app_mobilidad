/**
 * QUICK VENDEDOR TABLE FINDER
 * Find the table with vendedor codes + names
 */

const odbc = require('odbc');
const fs = require('fs');

async function findVendedorMaster() {
    console.log('Connecting to DB...');
    const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');
    const results = {};

    console.log('Connected! Searching for vendedor master table...\n');

    // Tables that might be vendedor master
    const tablesToTry = [
        'DSEDAC.VDC',      // Vendedor Comisiones - has TIPOVENDEDOR
        'DSEDAC.VDCL1',    // Vendedor Comisiones L1
        'DSEDAC.VDDX',     // Vendedor Data Extended - has JEFEVENTASSN
        'DSEDAC.VDDXL1',   // Vendedor Data Extended L1
        'DSEDAC.REP',      // Representantes
        'DSEDAC.REPL1',    // Representantes L1
        'DSEDAC.COM',      // Comerciales
        'DSEDAC.COML1',    // Comerciales L1
        'DSEDAC.VEN',      // Vendedores
        'DSEDAC.VENL1',    // Vendedores L1
        'DSEDAC.AGE',      // Agentes
        'DSEDAC.AGEL1',    // Agentes L1
    ];

    for (const table of tablesToTry) {
        console.log(`Trying ${table}...`);
        try {
            const data = await conn.query(`SELECT * FROM ${table} FETCH FIRST 50 ROWS ONLY`);
            if (data.length > 0) {
                console.log(`  ✓ Found ${data.length} rows!`);
                console.log(`  Columns: ${Object.keys(data[0]).join(', ')}`);
                results[table] = data;

                // Print first few rows
                console.log('  Sample:');
                for (const row of data.slice(0, 3)) {
                    const shortRow = {};
                    for (const [k, v] of Object.entries(row)) {
                        if (v && String(v).trim()) {
                            shortRow[k] = String(v).trim().substring(0, 30);
                        }
                    }
                    console.log('    ', JSON.stringify(shortRow));
                }
                console.log('');
            } else {
                console.log(`  Empty table`);
            }
        } catch (e) {
            console.log(`  ✗ Not accessible: ${e.message.substring(0, 50)}`);
        }
    }

    // Save results
    fs.writeFileSync('vendedor_master_search.json', JSON.stringify(results, null, 2));
    console.log('\nResults saved to vendedor_master_search.json');

    await conn.close();
}

findVendedorMaster().catch(console.error);
