/**
 * Explore LACLAE table for K,N,O,G filter columns
 * Run with: node explore_laclae.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('EXPLORING LACLAE TABLE FOR K,N,O,G FILTERS');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. LACLAE columns
        console.log('\n1. LACLAE COLUMNS:');
        console.log('-'.repeat(60));

        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LACLAE'
        ORDER BY ORDINAL_POSITION
      `);
            cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) { console.log('  Error:', e.message); }

        // 2. Check for columns with SERIE, CONTADOR, SECCION in name
        console.log('\n\n2. LACLAE SAMPLE ROW:');
        console.log('-'.repeat(60));

        try {
            const sample = await conn.query(`
        SELECT * FROM DSEDAC.LACLAE
        FETCH FIRST 1 ROWS ONLY
      `);
            if (sample.length > 0) {
                console.log('  Columns:', Object.keys(sample[0]).join(', '));
                for (const [k, v] of Object.entries(sample[0])) {
                    const val = String(v || '').trim();
                    if (val) console.log(`    ${k}: ${val.substring(0, 30)}`);
                }
            }
        } catch (e) { console.log('  Error:', e.message); }

        // 3. Check LAE table
        console.log('\n\n3. LAE TABLE COLUMNS:');
        console.log('-'.repeat(60));

        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAE'
        ORDER BY ORDINAL_POSITION
        FETCH FIRST 30 ROWS ONLY
      `);
            cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) { console.log('  Error:', e.message); }

        // 4. LAE sample unique column values
        console.log('\n\n4. LAE SERIES/CONTADOR VALUES:');
        console.log('-'.repeat(60));

        // Check SERIEALBARAN in LAE
        try {
            const sa = await conn.query(`
        SELECT SERIEALBARAN, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAE 
        WHERE ANODOCUMENTO = 2024
        GROUP BY SERIEALBARAN
        ORDER BY SERIEALBARAN
      `);
            console.log('\n  LAE.SERIEALBARAN:');
            sa.forEach(r => {
                console.log(`    ${(r.SERIEALBARAN || 'NULL').toString().trim()}: ${r.CNT} rows, ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES')}€`);
            });
        } catch (e) { console.log('  LAE.SERIEALBARAN Error:', e.message); }

        // Check SERIEDOCUMENTO in LAE
        try {
            const sd = await conn.query(`
        SELECT SERIEDOCUMENTO, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAE 
        WHERE ANODOCUMENTO = 2024
        GROUP BY SERIEDOCUMENTO
        ORDER BY SERIEDOCUMENTO
      `);
            console.log('\n  LAE.SERIEDOCUMENTO:');
            sd.forEach(r => {
                console.log(`    ${(r.SERIEDOCUMENTO || 'NULL').toString().trim()}: ${r.CNT} rows, ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES')}€`);
            });
        } catch (e) { console.log('  LAE.SERIEDOCUMENTO Error:', e.message); }

        // 5. Total from LAE
        console.log('\n\n5. LAE TOTALS:');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAE 
        WHERE ANODOCUMENTO = 2024
      `);
            console.log(`  LAE Total 2024: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // 6. Combined LAC + LAE (simulating LACLAE)
        console.log('\n\n6. LAC + LAE COMBINED:');
        console.log('-'.repeat(60));

        try {
            const lacTotal = await conn.query(`SELECT SUM(IMPORTEVENTA) as TOTAL FROM DSEDAC.LAC WHERE ANODOCUMENTO = 2024`);
            const laeTotal = await conn.query(`SELECT SUM(IMPORTEVENTA) as TOTAL FROM DSEDAC.LAE WHERE ANODOCUMENTO = 2024`);
            const lacVal = parseFloat(lacTotal[0]?.TOTAL || 0);
            const laeVal = parseFloat(laeTotal[0]?.TOTAL || 0);
            console.log(`  LAC: ${lacVal.toLocaleString('es-ES')}€`);
            console.log(`  LAE: ${laeVal.toLocaleString('es-ES')}€`);
            console.log(`  Combined: ${(lacVal + laeVal).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('  Error:', e.message); }

        console.log('\n  TARGET: 15,052,760€');
        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

check().catch(console.error);
