/**
 * Debug rutero/day SQL error and explore active client filtering
 */
const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function debug() {
    console.log('='.repeat(60));
    console.log('DEBUG RUTERO DAY SQL AND ACTIVE CLIENTS');
    console.log('='.repeat(60));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Get Monday clients for vendedor 33
        console.log('\n1. CDVI MONDAY CLIENTS FOR VENDEDOR 33:');
        console.log('-'.repeat(50));

        const mondayClients = await conn.query(`
      SELECT CODIGOCLIENTE as CODE
      FROM DSEDAC.CDVI
      WHERE DIAVISITALUNESSN = 'S'
        AND CODIGOVENDEDOR = '33'
      FETCH FIRST 10 ROWS ONLY
    `);
        console.log('  First 10 clients:', mondayClients.map(c => c.CODE?.trim()).join(', '));
        console.log('  Total count (from previous): 66');

        // 2. Show sample client codes (with proper trimming)
        const clientCodes = mondayClients.slice(0, 5).map(c => c.CODE?.trim()).filter(Boolean);
        console.log('\n\n2. TESTING LAC QUERY WITH SAMPLE CLIENTS:');
        console.log('-'.repeat(50));
        console.log('  Client codes:', clientCodes);

        // 3. Try the LAC query that's failing
        if (clientCodes.length > 0) {
            const clientFilter = `L.CODIGOCLIENTEALBARAN IN (${clientCodes.map(c => `'${c}'`).join(',')})`;
            console.log('  Filter:', clientFilter);

            try {
                const lacResult = await conn.query(`
          SELECT 
            L.CODIGOCLIENTEALBARAN as CODE,
            SUM(L.IMPORTEVENTA) as SALES
          FROM DSEDAC.LAC L
          WHERE ${clientFilter}
            AND L.ANODOCUMENTO = 2025
            AND L.TIPOVENTA IN ('CC', 'VC')
            AND L.SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
          GROUP BY L.CODIGOCLIENTEALBARAN
        `);
                console.log('  LAC Result:', lacResult.length, 'rows');
                lacResult.forEach(r => console.log(`    ${r.CODE}: ${r.SALES}`));
            } catch (e) {
                console.log('  LAC Error:', e.message);
            }
        }

        // 4. Check CDVI columns for vacation/active status
        console.log('\n\n3. CDVI COLUMNS (checking for vacation/status fields):');
        console.log('-'.repeat(50));

        const cdviCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CDVI'
      ORDER BY ORDINAL_POSITION
    `);
        cdviCols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 5. Check CDLO columns for vacation status
        console.log('\n\n4. CDLO COLUMNS (looking for vacation fields):');
        console.log('-'.repeat(50));

        const cdloCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CDLO'
        AND (COLUMN_NAME LIKE '%VACA%' OR COLUMN_NAME LIKE '%ACTI%' OR COLUMN_NAME LIKE '%BAJA%' OR COLUMN_NAME LIKE '%INIC%' OR COLUMN_NAME LIKE '%FINAL%')
      ORDER BY COLUMN_NAME
    `);
        cdloCols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 6. Check CLI table for active/baja status
        console.log('\n\n5. CLI COLUMNS (active/baja status):');
        console.log('-'.repeat(50));

        const cliCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
        AND (COLUMN_NAME LIKE '%BAJA%' OR COLUMN_NAME LIKE '%ACTI%' OR COLUMN_NAME LIKE '%VACA%')
      ORDER BY COLUMN_NAME
    `);
        cliCols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 7. Sample client with baja dates
        console.log('\n\n6. SAMPLE CLIENTS WITH BAJA DATES:');
        console.log('-'.repeat(50));

        const samples = await conn.query(`
      SELECT CODIGOCLIENTE, ANOBAJA, MESBAJA, DIABAJA
      FROM DSEDAC.CLI
      WHERE ANOBAJA > 0
      FETCH FIRST 5 ROWS ONLY
    `);
        samples.forEach(s => console.log(`  ${s.CODIGOCLIENTE}: Baja ${s.DIABAJA}/${s.MESBAJA}/${s.ANOBAJA}`));

        console.log('\n' + '='.repeat(60));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

debug().catch(console.error);
