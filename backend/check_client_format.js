/**
 * Check client code format and GPS coordinates tables
 * Run with: node check_client_format.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('CHECKING CLIENT CODE FORMAT AND GPS TABLES');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Search for client 8433 with LIKE
        console.log('\n1. SEARCHING FOR CLIENT 8433 (various formats):');
        console.log('-'.repeat(60));

        const clients = await conn.query(`
      SELECT CODIGOCLIENTE, TRIM(NOMBRECLIENTE) as NOMBRE
      FROM DSEDAC.CLI
      WHERE CODIGOCLIENTE LIKE '%8433%'
      FETCH FIRST 10 ROWS ONLY
    `);
        clients.forEach(c => console.log(`  '${c.CODIGOCLIENTE}': ${c.NOMBRE}`));

        // 2. Check LAC for this client with LIKE
        console.log('\n\n2. LAC SALES FOR CLIENT %8433% in 2025:');
        console.log('-'.repeat(60));

        const lacSales = await conn.query(`
      SELECT 
        CODIGOCLIENTEALBARAN,
        SUM(IMPORTEVENTA) as TOTAL_SALES,
        COUNT(*) as ROWS
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = 2025
        AND CODIGOCLIENTEALBARAN LIKE '%8433%'
      GROUP BY CODIGOCLIENTEALBARAN
    `);
        lacSales.forEach(s => console.log(`  '${s.CODIGOCLIENTEALBARAN}': ${parseFloat(s.TOTAL_SALES || 0).toLocaleString('es-ES')}€ (${s.ROWS} rows)`));

        // 3. Check WTAF.CPC for GPS
        console.log('\n\n3. CHECKING WTAF.CPC FOR GPS COORDINATES:');
        console.log('-'.repeat(60));

        try {
            const cpcCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'WTAF' AND TABLE_NAME = 'CPC'
        ORDER BY ORDINAL_POSITION
        FETCH FIRST 30 ROWS ONLY
      `);
            console.log('  Columns:', cpcCols.map(c => c.COLUMN_NAME).join(', '));

            // Sample data
            const sample = await conn.query(`
        SELECT * FROM WTAF.CPC 
        WHERE LATITUD IS NOT NULL AND LATITUD <> 0
        FETCH FIRST 3 ROWS ONLY
      `);
            if (sample.length > 0) {
                console.log('  Sample with GPS:');
                sample.forEach(s => {
                    console.log(`    Code: ${s.CODIGOCLIENTE || s.CODIGO}, Lat: ${s.LATITUD}, Lon: ${s.LONGITUD}`);
                });
            }
        } catch (e) { console.log('  Error:', e.message); }

        // 4. Check DSEMOVIL.CLIENTES for GPS
        console.log('\n\n4. CHECKING DSEMOVIL.CLIENTES FOR GPS:');
        console.log('-'.repeat(60));

        try {
            const dsmCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEMOVIL' AND TABLE_NAME = 'CLIENTES'
        ORDER BY ORDINAL_POSITION
        FETCH FIRST 20 ROWS ONLY
      `);
            console.log('  Columns:', dsmCols.map(c => c.COLUMN_NAME).join(', '));

            // Sample data with GPS
            const sample = await conn.query(`
        SELECT * FROM DSEMOVIL.CLIENTES 
        WHERE LATITUD IS NOT NULL AND LATITUD <> 0
        FETCH FIRST 3 ROWS ONLY
      `);
            if (sample.length > 0) {
                console.log('  Sample with GPS:');
                sample.forEach(s => {
                    console.log(`    Code: ${s.CODIGOCLIENTE || s.CODIGO}, Lat: ${s.LATITUD}, Lon: ${s.LONGITUD}`);
                });
            }
        } catch (e) { console.log('  Error:', e.message); }

        // 5. Check DSED.CPC for GPS
        console.log('\n\n5. CHECKING DSED.CPC FOR GPS:');
        console.log('-'.repeat(60));

        try {
            const dsCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSED' AND TABLE_NAME = 'CPC'
        ORDER BY ORDINAL_POSITION
      `);
            console.log('  Columns:', dsCols.map(c => c.COLUMN_NAME).join(', '));
        } catch (e) { console.log('  DSED.CPC not found'); }

        // 6. Check DSEDAC tables for coordinates
        console.log('\n\n6. DSEDAC TABLES WITH GPS:');
        console.log('-'.repeat(60));

        const dsedacGps = await conn.query(`
      SELECT TABLE_NAME, COLUMN_NAME 
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' 
        AND (COLUMN_NAME LIKE '%LATIT%' OR COLUMN_NAME LIKE '%LONGIT%')
      ORDER BY TABLE_NAME
    `);
        dsedacGps.forEach(t => console.log(`  ${t.TABLE_NAME}: ${t.COLUMN_NAME}`));

        // 7. Check what the margin calculation should be
        console.log('\n\n7. CLIENT 8433 SALES BREAKDOWN (no filters):');
        console.log('-'.repeat(60));

        const breakdown = await conn.query(`
      SELECT 
        ANODOCUMENTO as YEAR,
        TIPOVENTA,
        SERIEALBARAN,
        SUM(IMPORTEVENTA) as SALES,
        SUM(IMPORTECOSTO) as COST
      FROM DSEDAC.LAC
      WHERE CODIGOCLIENTEALBARAN LIKE '%8433%'
        AND ANODOCUMENTO >= 2024
      GROUP BY ANODOCUMENTO, TIPOVENTA, SERIEALBARAN
      ORDER BY ANODOCUMENTO DESC, SALES DESC
    `);
        breakdown.forEach(b => {
            const sales = parseFloat(b.SALES || 0);
            const cost = parseFloat(b.COST || 0);
            const margin = sales > 0 ? ((sales - cost) / sales * 100) : 0;
            console.log(`  ${b.YEAR} ${b.TIPOVENTA} Serie ${b.SERIEALBARAN}: ${sales.toLocaleString('es-ES')}€ (Margin: ${margin.toFixed(1)}%)`);
        });

        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

check().catch(console.error);
