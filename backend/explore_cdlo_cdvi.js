/**
 * Explore CDLO and CDVI tables for visit/reparto day assignments
 * Run with: node explore_cdlo_cdvi.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
    console.log('='.repeat(70));
    console.log('EXPLORING CDLO AND CDVI TABLES FOR VISIT/REPARTO DAYS');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Check CDLO structure (delivery/reparto days)
        console.log('\n1. CDLO TABLE STRUCTURE (Reparto/Delivery days):');
        console.log('-'.repeat(60));

        const cdloCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CDLO'
      ORDER BY ORDINAL_POSITION
    `);
        cdloCols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 2. Check CDVI structure (visit days)
        console.log('\n\n2. CDVI TABLE STRUCTURE (Visit days):');
        console.log('-'.repeat(60));

        const cdviCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CDVI'
      ORDER BY ORDINAL_POSITION
    `);
        cdviCols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 3. Sample CDLO data
        console.log('\n\n3. SAMPLE CDLO DATA (first 5 rows):');
        console.log('-'.repeat(60));

        const cdloSample = await conn.query(`
      SELECT * FROM DSEDAC.CDLO
      FETCH FIRST 5 ROWS ONLY
    `);
        if (cdloSample.length > 0) {
            console.log('  Columns:', Object.keys(cdloSample[0]).join(', '));
            cdloSample.forEach((r, i) => {
                console.log(`\n  Row ${i + 1}:`);
                for (const [k, v] of Object.entries(r)) {
                    const val = String(v || '').trim();
                    if (val && val !== '0' && val !== 'N') console.log(`    ${k}: ${val}`);
                }
            });
        }

        // 4. Sample CDVI data
        console.log('\n\n4. SAMPLE CDVI DATA (first 5 rows):');
        console.log('-'.repeat(60));

        const cdviSample = await conn.query(`
      SELECT * FROM DSEDAC.CDVI
      FETCH FIRST 5 ROWS ONLY
    `);
        if (cdviSample.length > 0) {
            console.log('  Columns:', Object.keys(cdviSample[0]).join(', '));
            cdviSample.forEach((r, i) => {
                console.log(`\n  Row ${i + 1}:`);
                for (const [k, v] of Object.entries(r)) {
                    const val = String(v || '').trim();
                    if (val && val !== '0' && val !== 'N') console.log(`    ${k}: ${val}`);
                }
            });
        }

        // 5. Count clients by visit day (CDVI)
        console.log('\n\n5. CLIENT COUNT BY VISIT DAY (CDVI):');
        console.log('-'.repeat(60));

        const visitCounts = await conn.query(`
      SELECT 
        SUM(CASE WHEN DIAVISITALUNESSN = 'S' THEN 1 ELSE 0 END) as LUNES,
        SUM(CASE WHEN DIAVISITAMARTESSN = 'S' THEN 1 ELSE 0 END) as MARTES,
        SUM(CASE WHEN DIAVISITAMIERCOLESSN = 'S' THEN 1 ELSE 0 END) as MIERCOLES,
        SUM(CASE WHEN DIAVISITAJUEVESSN = 'S' THEN 1 ELSE 0 END) as JUEVES,
        SUM(CASE WHEN DIAVISITAVIERNESSN = 'S' THEN 1 ELSE 0 END) as VIERNES,
        SUM(CASE WHEN DIAVISITASABADOSN = 'S' THEN 1 ELSE 0 END) as SABADO,
        SUM(CASE WHEN DIAVISITADOMINGOSN = 'S' THEN 1 ELSE 0 END) as DOMINGO
      FROM DSEDAC.CDVI
    `);
        if (visitCounts.length > 0) {
            console.log('  Visit:', JSON.stringify(visitCounts[0]));
        }

        // 6. Count clients by reparto day (CDLO)
        console.log('\n\n6. CLIENT COUNT BY REPARTO DAY (CDLO):');
        console.log('-'.repeat(60));

        const repartoCounts = await conn.query(`
      SELECT 
        SUM(CASE WHEN DIAREPARTOLUNESSN = 'S' THEN 1 ELSE 0 END) as LUNES,
        SUM(CASE WHEN DIAREPARTOMARTESSN = 'S' THEN 1 ELSE 0 END) as MARTES,
        SUM(CASE WHEN DIAREPARTOMIERCOLESSN = 'S' THEN 1 ELSE 0 END) as MIERCOLES,
        SUM(CASE WHEN DIAREPARTOJUEVESSN = 'S' THEN 1 ELSE 0 END) as JUEVES,
        SUM(CASE WHEN DIAREPARTOVIERNESSN = 'S' THEN 1 ELSE 0 END) as VIERNES,
        SUM(CASE WHEN DIAREPARTOSABADOSN = 'S' THEN 1 ELSE 0 END) as SABADO,
        SUM(CASE WHEN DIAREPARTDOMINGOSN = 'S' THEN 1 ELSE 0 END) as DOMINGO
      FROM DSEDAC.CDLO
    `);
        if (repartoCounts.length > 0) {
            console.log('  Reparto:', JSON.stringify(repartoCounts[0]));
        }

        // 7. Check key column for client linking
        console.log('\n\n7. KEY COLUMNS FOR CLIENT LINKING:');
        console.log('-'.repeat(60));

        // Check what links CDLO/CDVI to clients
        const linkCheck = await conn.query(`
      SELECT 
        (SELECT COUNT(*) FROM DSEDAC.CDLO) as CDLO_ROWS,
        (SELECT COUNT(*) FROM DSEDAC.CDVI) as CDVI_ROWS,
        (SELECT COUNT(*) FROM DSEDAC.CLI) as CLI_ROWS
    `);
        console.log('  Row counts:', JSON.stringify(linkCheck[0]));

        // 8. Check a specific client (4300008433 - CAMPING)
        console.log('\n\n8. SPECIFIC CLIENT 4300008433 - VISIT/REPARTO DAYS:');
        console.log('-'.repeat(60));

        try {
            const clientCdvi = await conn.query(`
        SELECT * FROM DSEDAC.CDVI 
        WHERE CODIGOCLIENTE = '4300008433'
      `);
            if (clientCdvi.length > 0) {
                console.log('  VISIT days:');
                for (const [k, v] of Object.entries(clientCdvi[0])) {
                    const val = String(v || '').trim();
                    if (val && val !== 'N') console.log(`    ${k}: ${val}`);
                }
            } else {
                console.log('  Client not found in CDVI');
            }
        } catch (e) { console.log('  CDVI Error:', e.message); }

        try {
            const clientCdlo = await conn.query(`
        SELECT * FROM DSEDAC.CDLO 
        WHERE CODIGOCLIENTE = '4300008433'
      `);
            if (clientCdlo.length > 0) {
                console.log('  REPARTO days:');
                for (const [k, v] of Object.entries(clientCdlo[0])) {
                    const val = String(v || '').trim();
                    if (val && val !== 'N') console.log(`    ${k}: ${val}`);
                }
            } else {
                console.log('  Client not found in CDLO');
            }
        } catch (e) { console.log('  CDLO Error:', e.message); }

        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

explore().catch(console.error);
