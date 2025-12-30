/**
 * DB2/AS400 DIRECT TABLE PROBER
 * ==============================
 * Since SYSCAT is not accessible, this script probes common table names directly
 * Run: node db_prober.js
 */

const odbc = require('odbc');
const fs = require('fs');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

// Common table names in ERP/sales systems
const TABLES_TO_PROBE = [
    // Sales/Invoices/Orders
    'LINDTO', 'LINDTO23', 'LINDTO24', 'LINDTO25', 'LINDTO2023', 'LINDTO2024', 'LINDTO2025',
    'CABDTO', 'CABDTO23', 'CABDTO24', 'CABDTO25', 'CABDTO2023', 'CABDTO2024', 'CABDTO2025',
    'LIN', 'CAB', 'LINPED', 'CABPED', 'LINPEDIDO', 'CABPEDIDO',
    'LINFAC', 'CABFAC', 'LINFACTURA', 'CABFACTURA',
    'LINALB', 'CABALB', 'LINALBARAN', 'CABALBARAN',
    'VENTAS', 'VENTAS23', 'VENTAS24', 'VENTAS25',
    'PEDIDO', 'PEDIDOS', 'FACTURA', 'FACTURAS', 'ALBARAN', 'ALBARANES',
    'DTOVTA', 'DTOVENTAS', 'MOVVTA', 'MOVVENTAS',
    'HIST', 'HISTLIN', 'HISTCAB', 'HISTORICO',
    'LINDTOH', 'LINDTOHI', 'LINDTOHIS', 'LINDTOHIST',
    'LINHTCO', 'CABHTCO', 'HTCOVENTAS',
    // Clients
    'CLI', 'CLIENTES', 'CLIENTE', 'CLIXXX', 'CLIDATOS', 'CLIMAST',
    'CVC', 'CVCHIST', 'CVCH', 'CVCHIS',
    // Products
    'ART', 'ARTICULOS', 'ARTICULO', 'ARTMAST', 'PRODUCTOS', 'PRODUCTO',
    // Vendors/Salespeople
    'VDC', 'VDDX', 'VENDEDOR', 'VENDEDORES', 'COMERCIAL', 'COMERCIALES',
    // Routes
    'RUT', 'RUTAS', 'RUTA', 'RUTERO', 'RUTEROS',
    // Users
    'APPUSUARIOS', 'USUARIOS', 'USERS',
    // Other common
    'MAESTROS', 'DATOS', 'GENERAL', 'CONFIG', 'PARAM',
    'DSLIND', 'DSCABD', 'DSVENT',
    // Historical patterns
    'MVTO', 'MOVIMIENTO', 'MOVIMIENTOS', 'MVTOS',
    'ESTADISTICA', 'ESTADISTICAS', 'STATS',
    'RESUMEN', 'RESUMENES', 'TOTALES',
    // Date-based patterns for 2024
    'VTA24', 'VTA2024', 'FAC24', 'FAC2024', 'PED24', 'PED2024',
    // More variants
    'LINHIST', 'CABHIST', 'LINHISTORICO', 'CABHISTORICO',
    'DTOLINEAS', 'DTOCABECERA', 'DTOHIST',
    // File library patterns (common in AS400)
    'ELINDDTO', 'ELINDTO', 'GLINDTO', 'HLINDTO',
];

async function probeDatabase() {
    let conn;
    const results = [];

    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✅ Connected to DB2/AS400\n');
        console.log('='.repeat(80));
        console.log('PROBING ALL COMMON TABLE NAMES');
        console.log('='.repeat(80));

        for (const table of TABLES_TO_PROBE) {
            process.stdout.write(`Probing ${table}... `);
            try {
                const count = await conn.query(`SELECT COUNT(*) as cnt FROM DSEDAC.${table}`);
                const rowCount = count[0]?.CNT || 0;

                if (rowCount > 0) {
                    console.log(`✅ EXISTS - ${rowCount} rows`);
                    results.push({ table, rows: rowCount, exists: true });

                    // Get sample and date range
                    try {
                        // Check for year column
                        const sample = await conn.query(`SELECT * FROM DSEDAC.${table} FETCH FIRST 1 ROWS ONLY`);
                        const columns = Object.keys(sample[0] || {});

                        // Find date columns
                        const dateCol = columns.find(c =>
                            c.includes('ANO') || c.includes('YEAR') || c.includes('FECHA')
                        );

                        if (dateCol) {
                            const range = await conn.query(`SELECT MIN(${dateCol}) as min_val, MAX(${dateCol}) as max_val FROM DSEDAC.${table}`);
                            console.log(`     Date column ${dateCol}: ${range[0]?.MIN_VAL} to ${range[0]?.MAX_VAL}`);
                            results[results.length - 1].dateRange = `${range[0]?.MIN_VAL}-${range[0]?.MAX_VAL}`;
                        }

                        results[results.length - 1].columns = columns;
                    } catch (e) {
                        // Skip details on error
                    }
                } else {
                    console.log(`⚪ Empty (0 rows)`);
                    results.push({ table, rows: 0, exists: true });
                }
            } catch (e) {
                console.log(`❌ Not found`);
                results.push({ table, exists: false });
            }
        }

        // Summary
        console.log('\n\n' + '='.repeat(80));
        console.log('SUMMARY: TABLES WITH DATA');
        console.log('='.repeat(80));

        const withData = results.filter(r => r.exists && r.rows > 0).sort((a, b) => b.rows - a.rows);
        console.log('\nTABLE'.padEnd(25) + 'ROWS'.padEnd(15) + 'DATE RANGE'.padEnd(20) + 'COLUMNS');
        console.log('-'.repeat(80));

        for (const t of withData) {
            console.log(
                t.table.padEnd(25) +
                String(t.rows).padEnd(15) +
                (t.dateRange || '-').padEnd(20) +
                (t.columns?.slice(0, 5).join(', ') || '')
            );
        }

        // Detailed exploration of tables with significant data
        console.log('\n\n' + '='.repeat(80));
        console.log('DETAILED EXPLORATION OF TABLES WITH 100+ ROWS');
        console.log('='.repeat(80));

        for (const t of withData.filter(x => x.rows >= 100)) {
            console.log('\n' + '-'.repeat(60));
            console.log(`TABLE: DSEDAC.${t.table} (${t.rows} rows)`);
            console.log('-'.repeat(60));

            try {
                // Get 3 sample rows
                const samples = await conn.query(`SELECT * FROM DSEDAC.${t.table} FETCH FIRST 3 ROWS ONLY`);
                console.log('\nColumns:', Object.keys(samples[0] || {}).join(', '));

                console.log('\nSample rows:');
                for (let i = 0; i < samples.length; i++) {
                    console.log(`\n  Row ${i + 1}:`);
                    const row = samples[i];
                    for (const [key, val] of Object.entries(row)) {
                        let value = val === null ? 'NULL' : String(val).substring(0, 60);
                        if (value.length > 60) value += '...';
                        console.log(`    ${key.padEnd(25)}: ${value}`);
                    }
                }

                // Check all year-related columns
                const allCols = Object.keys(samples[0] || {});
                const yearCols = allCols.filter(c =>
                    c.includes('ANO') || c.includes('MES') || c.includes('DIA') ||
                    c.includes('YEAR') || c.includes('MONTH') || c.includes('FECHA')
                );

                if (yearCols.length > 0) {
                    console.log('\nDate/Year column analysis:');
                    for (const col of yearCols) {
                        try {
                            const dist = await conn.query(`
                SELECT ${col} as val, COUNT(*) as cnt 
                FROM DSEDAC.${t.table} 
                GROUP BY ${col} 
                ORDER BY ${col}
              `);
                            console.log(`  ${col}:`);
                            for (const d of dist.slice(0, 15)) {
                                console.log(`    ${d.VAL}: ${d.CNT} rows`);
                            }
                            if (dist.length > 15) console.log(`    ... and ${dist.length - 15} more values`);
                        } catch (e) {
                            // Skip
                        }
                    }
                }

            } catch (e) {
                console.log(`  Error: ${e.message}`);
            }
        }

        // Save report
        const report = {
            timestamp: new Date().toISOString(),
            tablesFound: withData.length,
            totalTables: results.filter(r => r.exists).length,
            details: withData
        };
        fs.writeFileSync('db_probe_results.json', JSON.stringify(report, null, 2));
        console.log('\n\nResults saved to db_probe_results.json');

    } catch (error) {
        console.error('\nFATAL ERROR:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

probeDatabase();
