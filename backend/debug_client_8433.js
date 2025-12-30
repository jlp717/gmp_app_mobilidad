/**
 * Debug client 8433 sales and explore GPS coordinates tables
 * Run with: node debug_client_8433.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function debug() {
    console.log('='.repeat(70));
    console.log('DEBUGGING CLIENT 8433 AND GPS COORDINATES');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Check client 8433 YTD sales for 2025
        console.log('\n1. CLIENT 8433 YTD SALES 2025 (up to week 51):');
        console.log('-'.repeat(60));

        // Week 51 ends around Dec 22, 2025
        const ytdSales = await conn.query(`
      SELECT 
        SUM(IMPORTEVENTA) as TOTAL_SALES,
        SUM(IMPORTECOSTO) as TOTAL_COST,
        COUNT(*) as NUM_ROWS
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = 2025
        AND CODIGOCLIENTEALBARAN = '8433'
        AND TIPOVENTA IN ('CC', 'VC')
        AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
    `);
        console.log('  2025 YTD Sales:', ytdSales[0]);

        // 2. Check 2024 same period
        console.log('\n\n2. CLIENT 8433 YTD SALES 2024 (same period):');
        console.log('-'.repeat(60));

        const prevYtdSales = await conn.query(`
      SELECT 
        SUM(IMPORTEVENTA) as TOTAL_SALES,
        SUM(IMPORTECOSTO) as TOTAL_COST,
        COUNT(*) as NUM_ROWS
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = 2024
        AND CODIGOCLIENTEALBARAN = '8433'
        AND TIPOVENTA IN ('CC', 'VC')
        AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
    `);
        console.log('  2024 YTD Sales:', prevYtdSales[0]);

        // 3. Check monthly breakdown
        console.log('\n\n3. CLIENT 8433 MONTHLY BREAKDOWN 2025:');
        console.log('-'.repeat(60));

        const monthly = await conn.query(`
      SELECT 
        MESDOCUMENTO as MONTH,
        SUM(IMPORTEVENTA) as SALES
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = 2025
        AND CODIGOCLIENTEALBARAN = '8433'
        AND TIPOVENTA IN ('CC', 'VC')
        AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
    `);
        monthly.forEach(r => console.log(`  Month ${r.MONTH}: ${parseFloat(r.SALES || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`));

        // 4. Check for GPS coordinates tables
        console.log('\n\n4. SEARCHING FOR GPS/COORDINATES TABLES:');
        console.log('-'.repeat(60));

        const gpsTables = await conn.query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME 
      FROM QSYS2.SYSCOLUMNS 
      WHERE (COLUMN_NAME LIKE '%LATIT%' OR COLUMN_NAME LIKE '%LONGIT%' 
             OR COLUMN_NAME LIKE '%COORD%' OR COLUMN_NAME LIKE '%GPS%'
             OR COLUMN_NAME LIKE '%GEOLOC%' OR COLUMN_NAME LIKE '%GEO%')
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `);
        gpsTables.forEach(t => console.log(`  ${t.TABLE_SCHEMA}.${t.TABLE_NAME}: ${t.COLUMN_NAME}`));

        // 5. Check CLI table for coordinates
        console.log('\n\n5. CLI TABLE COLUMNS (location related):');
        console.log('-'.repeat(60));

        const cliCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
        AND (COLUMN_NAME LIKE '%LAT%' OR COLUMN_NAME LIKE '%LON%' 
             OR COLUMN_NAME LIKE '%COORD%' OR COLUMN_NAME LIKE '%DIREC%'
             OR COLUMN_NAME LIKE '%UBIC%' OR COLUMN_NAME LIKE '%GEO%'
             OR COLUMN_NAME LIKE '%GPS%')
      ORDER BY COLUMN_NAME
    `);
        cliCols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 6. Check DSED.LACLAE for visit/delivery days for client 8433
        console.log('\n\n6. CLIENT 8433 VISIT/DELIVERY DAYS (DSED.LACLAE):');
        console.log('-'.repeat(60));

        try {
            const visitDays = await conn.query(`
        SELECT 
          LCCDCL as CLIENT_CODE,
          R1_T8DIVL as VISIT_MON, R1_T8DIVM as VISIT_TUE, R1_T8DIVX as VISIT_WED,
          R1_T8DIVJ as VISIT_THU, R1_T8DIVV as VISIT_FRI, R1_T8DIVS as VISIT_SAT,
          R1_T8DIRL as REPARTO_MON, R1_T8DIRM as REPARTO_TUE, R1_T8DIRX as REPARTO_WED,
          R1_T8DIRJ as REPARTO_THU, R1_T8DIRV as REPARTO_FRI, R1_T8DIRS as REPARTO_SAT,
          R1_T8ORVL as ORDER_MON, R1_T8ORVM as ORDER_TUE
        FROM DSED.LACLAE
        WHERE LCCDCL = '8433'
        FETCH FIRST 1 ROWS ONLY
      `);
            if (visitDays.length > 0) {
                console.log('  Visit Days:', JSON.stringify(visitDays[0], null, 2));
            } else {
                console.log('  Client 8433 not found in DSED.LACLAE');
            }
        } catch (e) { console.log('  Error:', e.message); }

        // 7. Check all CLI columns
        console.log('\n\n7. ALL CLI TABLE COLUMNS:');
        console.log('-'.repeat(60));

        const allCliCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
      ORDER BY ORDINAL_POSITION
    `);
        allCliCols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

debug().catch(console.error);
