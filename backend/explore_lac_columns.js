/**
 * Explore LAC columns to understand filter field names
 * Run with: node explore_lac_columns.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
    console.log('='.repeat(70));
    console.log('EXPLORING LAC TABLE COLUMNS FOR FILTERS');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Get columns from LAC
        console.log('\n1. LAC COLUMNS:');
        console.log('-'.repeat(60));

        const cols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
      ORDER BY ORDINAL_POSITION
    `);

        cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 2. Look for LPCVT-like columns
        console.log('\n\n2. CHECKING VALUES FOR KEY COLUMNS:');
        console.log('-'.repeat(60));

        // Check TIPOVENTACONTADO (C/C, S/C)
        try {
            console.log('\n  TIPOVENTACONTADO values:');
            const tv = await conn.query(`
        SELECT TIPOVENTACONTADO, COUNT(*) as CNT 
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
        GROUP BY TIPOVENTACONTADO
      `);
            tv.forEach(r => console.log(`    ${(r.TIPOVENTACONTADO || 'NULL').toString().trim()}: ${r.CNT}`));
        } catch (e) { console.log('    Error:', e.message); }

        // Check TIPODOCUMENTO (for TPDC)
        try {
            console.log('\n  TIPODOCUMENTO values:');
            const td = await conn.query(`
        SELECT TIPODOCUMENTO, COUNT(*) as CNT 
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
        GROUP BY TIPODOCUMENTO
      `);
            td.forEach(r => console.log(`    ${(r.TIPODOCUMENTO || 'NULL').toString().trim()}: ${r.CNT}`));
        } catch (e) { console.log('    Error:', e.message); }

        // Check CODIGOSECCIONRABAT (for LCSRAB filtering K, N, O, G)
        try {
            console.log('\n  CODIGOSECCIONRABAT values:');
            const sr = await conn.query(`
        SELECT CODIGOSECCIONRABAT, COUNT(*) as CNT, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
        GROUP BY CODIGOSECCIONRABAT
        ORDER BY TOTAL DESC
      `);
            sr.forEach(r => console.log(`    ${(r.CODIGOSECCIONRABAT || 'NULL').toString().trim().padEnd(5)}: ${r.CNT} rows, ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES')}€`));
        } catch (e) { console.log('    Error:', e.message); }

        // 3. Calculate totals with different filters
        console.log('\n\n3. TOTAL SALES WITH DIFFERENT FILTERS:');
        console.log('-'.repeat(60));

        // Current total (without filters)
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
      `);
            console.log(`  Total 2024 (sin filtros): ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('    Error:', e.message); }

        // With TIPOVENTACONTADO filter (removing S/C)
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
          AND TIPOVENTACONTADO <> 'SC'
      `);
            console.log(`  Sin SC (TIPOVENTACONTADO): ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('    Error:', e.message); }

        // With LCSRAB filter (removing K, N, O, G)
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
          AND CODIGOSECCIONRABAT NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  Sin K,N,O,G (SECCIONRABAT): ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('    Error:', e.message); }

        // Combined filters
        try {
            const total = await conn.query(`
        SELECT SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2024
          AND TIPOVENTACONTADO <> 'SC'
          AND CODIGOSECCIONRABAT NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  Sin SC + Sin K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES')}€`);
        } catch (e) { console.log('    Error:', e.message); }

        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

explore().catch(console.error);
